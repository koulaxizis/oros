// ============================================================
// orOS relay — "canva" operation (Atelier: bring designs over from
// a Canva account through the Canva Connect API)
// The Connect API keeps its token exchange to servers (client
// secret, no CORS), so the relay holds the integration's client
// secret and passes the user's own calls through. Stateless like
// the rest of the relay: the user's tokens live on their device,
// travel with each call and are never stored or logged here.
//
// Secrets (Cloudflare › Worker › Settings › Variables and secrets):
//   CANVA_CLIENT_ID, CANVA_CLIENT_SECRET   (without them: configured:false)
//
// Request:  POST /v1 { op: "canva", act, ...args }
//   act "config"                          → { configured, clientId }
//   act "token"   { code, verifier, redirect } → { access, refresh, expires, scope }
//   act "refresh" { refresh }             → same
//   act "designs" { token, cont?, query? } → { items: [...], cont }
//   act "export"  { token, id }           → { job, status, urls, err }   (PPTX)
//   act "job"     { token, job }          → same
//   act "file"    { url }                 → the exported file's bytes
//                  (application/octet-stream; only https *.canva.com)
// Answer (all but "file"): { ok: true, data } | { ok: false, error: { code, msg } }
//   codes: "canva-off" (no secrets), "auth" (token refused: connect
//   again), "rate", "canva" (Canva said no; msg is its text),
//   "too-big", "url" (a download redirected off Canva), "network"
// ============================================================

export const CANVA_LIMITS = {
  fileBytes: 60 * 1024 * 1024,     // one exported .pptx
  timeout: 20000,                  // ms, per Canva call
  redirects: 3,                    // hops of an export download
  pageSize: 50
};

const API = "https://api.canva.com/rest/v1";
const ACTS = { config: 1, token: 1, refresh: 1, designs: 1, export: 1, job: 1, file: 1 };

function str(v, max) { return typeof v === "string" && v.length > 0 && v.length <= max && !/[\r\n\0]/.test(v); }
const ID = /^[A-Za-z0-9_-]{1,100}$/;

// "" when the request is well formed, else what is wrong.
// origins: the relay's ALLOWED_ORIGINS (the redirect must be one of their pages)
export function validCanva(b, origins) {
  if (!ACTS[b.act]) return "act";
  if (b.act === "token") {
    if (!str(b.code, 2000)) return "code";
    if (typeof b.verifier !== "string" || !/^[A-Za-z0-9._~-]{43,128}$/.test(b.verifier)) return "verifier";
    let u;
    try { u = new URL(b.redirect); } catch (e) { return "redirect"; }
    if (u.protocol !== "https:" || (origins || []).indexOf(u.origin) < 0 || u.search || u.hash) return "redirect";
  }
  if (b.act === "refresh" && !str(b.refresh, 4096)) return "refresh";
  if (b.act === "designs" || b.act === "export" || b.act === "job") {
    if (!str(b.token, 4096)) return "token";
  }
  if (b.act === "designs") {
    if (b.cont !== undefined && !str(b.cont, 2000)) return "cont";
    if (b.query !== undefined && !(typeof b.query === "string" && b.query.length <= 255 && !/[\r\n\0]/.test(b.query))) return "query";
  }
  if (b.act === "export" && !(typeof b.id === "string" && ID.test(b.id))) return "id";
  if (b.act === "job" && !(typeof b.job === "string" && ID.test(b.job))) return "job";
  if (b.act === "file" && !fileUrl(b.url)) return "url";
  return "";
}

// Exported files come from Canva's own download hosts.
export function fileUrl(u) {
  if (typeof u !== "string" || u.length > 4000) return null;
  let x;
  try { x = new URL(u); } catch (e) { return null; }
  if (x.protocol !== "https:" || x.username || x.password || x.port) return null;
  const h = x.hostname.toLowerCase();
  if (h !== "canva.com" && !h.endsWith(".canva.com")) return null;
  return x;
}

export class CanvaError extends Error {
  constructor(code, msg) { super(msg || code); this.code = code; }
}

async function call(fetchFn, url, init) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), CANVA_LIMITS.timeout);
  let r;
  try { r = await fetchFn(url, Object.assign({ signal: ctl.signal, redirect: "follow" }, init)); }
  catch (e) { throw new CanvaError("network", "Canva could not be reached"); }
  finally { clearTimeout(timer); }
  return r;
}

async function jsonOf(r) {
  let j = null;
  try { j = await r.json(); } catch (e) { /* not JSON */ }
  if (r.status === 401 || (j && (j.error === "invalid_grant" || j.code === "invalid_access_token" || j.code === "revoked_access_token"))) {
    throw new CanvaError("auth", "connect to Canva again");
  }
  if (r.status === 429) throw new CanvaError("rate", "Canva asks to slow down");
  if (!r.ok || !j) {
    const m = j && (j.message || j.error_description || j.error || j.code);
    throw new CanvaError("canva", String(m || "Canva answered " + r.status).slice(0, 300));
  }
  return j;
}

async function tokenCall(env, fetchFn, form) {
  const basic = btoa(env.CANVA_CLIENT_ID + ":" + env.CANVA_CLIENT_SECRET);
  const r = await call(fetchFn, API + "/oauth/token", {
    method: "POST",
    headers: { "Authorization": "Basic " + basic, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString()
  });
  const j = await jsonOf(r);
  if (typeof j.access_token !== "string" || typeof j.refresh_token !== "string") throw new CanvaError("canva", "no token");
  return { access: j.access_token, refresh: j.refresh_token, expires: +j.expires_in || 0, scope: String(j.scope || "") };
}

function bearer(token) { return { "Authorization": "Bearer " + token }; }

function design(d) {
  const th = d && d.thumbnail;
  return {
    id: String(d.id || ""),
    title: String(d.title || "").slice(0, 255),
    thumb: th && typeof th.url === "string" && /^https:\/\//.test(th.url) ? th.url : "",
    tw: th ? +th.width || 0 : 0, th: th ? +th.height || 0 : 0,
    pages: +d.page_count || 0,
    updated: +d.updated_at || 0,
    types: Array.isArray(d.design_types) ? d.design_types.filter((x) => typeof x === "string").slice(0, 5) : []
  };
}

function jobOf(j) {
  const job = (j && j.job) || {};
  return {
    job: String(job.id || ""),
    status: job.status === "success" || job.status === "failed" ? job.status : "in_progress",
    urls: Array.isArray(job.urls) ? job.urls.filter((u) => fileUrl(u)) : [],
    err: job.error ? String(job.error.code || "failed").slice(0, 60) : ""
  };
}

// JSON operations. Throws CanvaError.
export async function runCanva(b, env, fetchFn) {
  const on = !!(env && env.CANVA_CLIENT_ID && env.CANVA_CLIENT_SECRET);
  if (b.act === "config") return { configured: on, clientId: on ? env.CANVA_CLIENT_ID : "" };
  if (!on) throw new CanvaError("canva-off", "the relay has no Canva integration");
  switch (b.act) {
    case "token":
      return tokenCall(env, fetchFn, { grant_type: "authorization_code", code: b.code, code_verifier: b.verifier, redirect_uri: b.redirect });
    case "refresh":
      return tokenCall(env, fetchFn, { grant_type: "refresh_token", refresh_token: b.refresh });
    case "designs": {
      const q = new URLSearchParams({ limit: String(CANVA_LIMITS.pageSize), sort_by: b.query ? "relevance" : "modified_descending" });
      if (b.cont) q.set("continuation", b.cont);
      if (b.query) q.set("query", b.query);
      const j = await jsonOf(await call(fetchFn, API + "/designs?" + q.toString(), { headers: bearer(b.token) }));
      return { items: (Array.isArray(j.items) ? j.items : []).map(design).filter((d) => ID.test(d.id)), cont: typeof j.continuation === "string" ? j.continuation : "" };
    }
    case "export": {
      const r = await call(fetchFn, API + "/exports", {
        method: "POST",
        headers: Object.assign({ "Content-Type": "application/json" }, bearer(b.token)),
        body: JSON.stringify({ design_id: b.id, format: { type: "pptx" } })
      });
      return jobOf(await jsonOf(r));
    }
    case "job":
      return jobOf(await jsonOf(await call(fetchFn, API + "/exports/" + encodeURIComponent(b.job), { headers: bearer(b.token) })));
  }
  throw new CanvaError("canva", "unknown");
}

// The "file" act: stream the exported file back, capped.
// cors: the CORS headers for the calling page. Returns a Response.
export async function canvaFile(b, fetchFn, cors) {
  // follow redirects by hand: every hop must stay on https *.canva.com
  let x = fileUrl(b.url), r = null;
  for (let hop = 0; hop <= CANVA_LIMITS.redirects; hop++) {
    r = await call(fetchFn, x.toString(), { headers: { "Accept": "*/*" }, redirect: "manual" });
    if (r.status < 300 || r.status > 399) break;
    const loc = r.headers.get("Location");
    let next = null;
    try { next = loc ? fileUrl(new URL(loc, x).toString()) : null; } catch (e) { next = null; }
    if (!next) throw new CanvaError("url", "the export redirected outside Canva");
    if (hop === CANVA_LIMITS.redirects) throw new CanvaError("url", "too many redirects");
    x = next;
  }
  if (!r.ok || !r.body) throw new CanvaError("canva", "the export file could not be read (" + r.status + ")");
  const len = +(r.headers.get("Content-Length") || 0);
  if (len > CANVA_LIMITS.fileBytes) throw new CanvaError("too-big", "the file is too big");
  let n = 0;
  const cap = new TransformStream({
    transform(chunk, ctl) {
      n += chunk.length;
      if (n > CANVA_LIMITS.fileBytes) { ctl.error(new Error("too-big")); return; }
      ctl.enqueue(chunk);
    }
  });
  // no Content-Length copied: a compressed upstream body would not match it
  const h = Object.assign({ "Content-Type": "application/octet-stream", "Cache-Control": "no-store",
                            "X-Content-Type-Options": "nosniff" }, cors);
  return new Response(r.body.pipeThrough(cap), { status: 200, headers: h });
}
