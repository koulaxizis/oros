// ============================================================
// orOS relay — "oasa" operation (Maps: live bus arrivals in Athens)
// OASA Telematics (telematics.oasa.gr) answers plain GETs with JSON
// but sends no CORS headers, so a page cannot read it. This
// operation asks it for the Maps app. The host is fixed and the URL
// is built here, never taken from the client; `act` comes from an
// exact allowlist and every parameter is a stop code (digits only).
// GET only, no cookies, redirects are errors, an 8 s timeout, at most
// 64 KB read, and only parsed JSON goes back (never the raw text).
// Errors are fixed codes; nothing is logged. A short shared cache
// (15 s per URL) spares OASA when several people watch one stop.
//
// Request:  POST /v1 { op: "oasa", act, p1 }
//   act: getStopArrivals | getRoutesForStop | getStopNameAndXY
//   p1:  OASA stop code, ^\d{1,10}$ (e.g. "061260")
// Answer:   { ok: true, data: <OASA JSON, or null> }
//   or      { ok: false, error: { code: "upstream" | "timeout" | "too-big" | "bad-request" } }
// ============================================================

export const OASA_LIMITS = {
  bytes: 64 * 1024,
  timeout: 8000,       // ms
  cacheSec: 15
};
const BASE = "https://telematics.oasa.gr/api/";
const ACTS = { getStopArrivals: 1, getRoutesForStop: 1, getStopNameAndXY: 1 };
const CODE_RE = /^\d{1,10}$/;

export class OasaError extends Error {
  constructor(code) { super(code); this.code = code; }
}

export function validOasa(b) {
  if (typeof b.act !== "string" || !Object.prototype.hasOwnProperty.call(ACTS, b.act)) return "act";
  if (typeof b.p1 !== "string" || !CODE_RE.test(b.p1)) return "p1";
  return "";
}

export function oasaUrl(b) {
  return BASE + "?act=" + b.act + "&p1=" + b.p1;
}

async function readCapped(res, max) {
  if (!res.body || !res.body.getReader) {
    const t = await res.text();
    if (t.length > max) throw new OasaError("too-big");
    return t;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > max) { try { reader.cancel(); } catch (e) {} throw new OasaError("too-big"); }
    chunks.push(value);
  }
  const all = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.length; }
  return new TextDecoder().decode(all);
}

// fetchFn(url, init) → Response; cache: Cloudflare's caches.default (or null).
export async function runOasa(b, fetchFn, cache) {
  const url = oasaUrl(b);
  const key = cache ? new Request(url) : null;
  if (cache) {
    try {
      const hit = await cache.match(key);
      if (hit) return JSON.parse(await hit.text());
    } catch (e) { /* a cache miss */ }
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), OASA_LIMITS.timeout);
  let res, text;
  try {
    res = await fetchFn(url, { method: "GET", redirect: "manual", signal: ctl.signal, headers: { Accept: "application/json" } });
    if (res.status !== 200) throw new OasaError("upstream");        // 3xx included: redirects are not followed
    text = await readCapped(res, OASA_LIMITS.bytes);
  } catch (e) {
    if (e instanceof OasaError) throw e;
    if (ctl.signal.aborted || (e && (e.name === "AbortError" || e.name === "TimeoutError"))) throw new OasaError("timeout");
    throw new OasaError("upstream");
  } finally {
    clearTimeout(timer);
  }
  let data;
  try { data = JSON.parse(text.trim() || "null"); } catch (e) { throw new OasaError("upstream"); }
  if (data !== null && typeof data !== "object") throw new OasaError("upstream");
  if (cache) {
    try {
      await cache.put(key, new Response(JSON.stringify(data), {
        headers: { "Content-Type": "application/json", "Cache-Control": "max-age=" + OASA_LIMITS.cacheSec }
      }));
    } catch (e) { /* best effort */ }
  }
  return data;
}
