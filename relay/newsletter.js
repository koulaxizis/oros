// ============================================================
// orOS Mail relay — Newsletter: public sign-up form and one-click
// unsubscribe (RFC 8058), kept in Cloudflare D1 (binding NL_DB) until
// the list's own orOS pulls them. See relay/README.md.
//
// Public (no Origin check; browsers and mail clients call them):
//   POST /nl/s/<k>          sign-up form: email, name?, lang?, website (honeypot)
//   GET  /nl/u/<k>/<tok>    a page with one button (never unsubscribes)
//   POST /nl/u/<k>/<tok>    unsubscribe (List-Unsubscribe=One-Click or the button)
// App (POST /v1, origin-gated): { op: "nl", act, k, sec, ... }
//   reg { pub, back } → { ok }        pull { after } → { rows, more }
//   ack { upto } → { n }              drop → { ok }
// A sign-up is stored only encrypted for the list (AES-256-GCM, its key
// wrapped with the list's RSA-OAEP-256 public key); an unsubscribe only
// as the subscriber's random token. The list's secret is kept as its
// SHA-256. Without the NL_DB binding every route answers 503 "nostore".
// ============================================================

export const NL_LIMITS = {
  formBytes: 4096,      // a form or one-click POST
  pending: 2000,        // rows waiting per list (the real flood guard)
  lists: 5000,          // lists in all
  pull: 200,            // rows per pull
  pubJson: 1024,        // the public key JWK
  back: 300             // the "thank you" address
};

export class NlError extends Error {
  constructor(code, status, msg) { super(msg || code); this.code = code; this.status = status || 200; }
}

export const SQL = {
  list: "CREATE TABLE IF NOT EXISTS nl_list (k TEXT PRIMARY KEY, pub TEXT NOT NULL, sec TEXT NOT NULL, back TEXT, at INTEGER NOT NULL)",
  queue: "CREATE TABLE IF NOT EXISTS nl_q (id INTEGER PRIMARY KEY AUTOINCREMENT, k TEXT NOT NULL, kind TEXT NOT NULL, v TEXT NOT NULL, at INTEGER NOT NULL)",
  index: "CREATE INDEX IF NOT EXISTS nl_q_k ON nl_q (k, id)",
  getList: "SELECT pub, sec, back FROM nl_list WHERE k = ?1",
  countLists: "SELECT COUNT(*) AS n FROM nl_list",
  addList: "INSERT INTO nl_list (k, pub, sec, back, at) VALUES (?1, ?2, ?3, ?4, ?5)",
  setList: "UPDATE nl_list SET pub = ?2, back = ?3, at = ?4 WHERE k = ?1",
  countRows: "SELECT COUNT(*) AS n FROM nl_q WHERE k = ?1",
  addRow: "INSERT INTO nl_q (k, kind, v, at) VALUES (?1, ?2, ?3, ?4)",
  seenUnsub: "SELECT id FROM nl_q WHERE k = ?1 AND kind = 'u' AND v = ?2 AND at > ?3 LIMIT 1",
  pull: "SELECT id, kind, v, at FROM nl_q WHERE k = ?1 AND id > ?2 ORDER BY id LIMIT ?3",
  ack: "DELETE FROM nl_q WHERE k = ?1 AND id <= ?2",
  dropRows: "DELETE FROM nl_q WHERE k = ?1",
  dropList: "DELETE FROM nl_list WHERE k = ?1"
};

const K_RE = /^[a-z0-9]{16}$/;
const TOK_RE = /^[a-z0-9]{8,16}$/;
const SEC_RE = /^[A-Za-z0-9]{32}$/;
const DAY = 86400000;

// ---------- storage ----------
// The tables are made once per isolate, so the database needs no setup.
let schemaFor = null, schemaP = null;
function db(env) {
  const d = env && env.NL_DB;
  if (!d || typeof d.prepare !== "function") throw new NlError("nostore", 503, "sign-ups are not set up on this relay");
  if (schemaFor !== d || !schemaP) {
    schemaFor = d;
    schemaP = d.batch([d.prepare(SQL.list), d.prepare(SQL.queue), d.prepare(SQL.index)])
      .catch((e) => { schemaP = null; throw e; });
  }
  return schemaP.then(() => d);
}
function q(d, sql, ...args) { return d.prepare(sql).bind(...args); }

// ---------- small helpers ----------
function b64(bytes) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
async function sha256Hex(s) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return Array.from(h, (b) => (b < 16 ? "0" : "") + b.toString(16)).join("");
}
// Equal-length hex strings compared in full (no early exit).
function sameHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}
function validEmail(e) {
  return typeof e === "string" && e.length >= 3 && e.length <= 254 && !/[\r\n\0]/.test(e) &&
    /^[^\s<>()",;:\\\[\]@]+@[^\s<>()",;:\\\[\]@]+\.[^\s<>()",;:\\\[\]@]+$/.test(e);
}
function oneLine(s, max) {
  return String(s || "").replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}
function validBack(v) {
  if (v === "" || v === undefined || v === null) return true;
  if (typeof v !== "string" || v.length > NL_LIMITS.back) return false;
  let u;
  try { u = new URL(v); } catch (e) { return false; }
  return u.protocol === "https:" && !u.username && !u.password && !/[\s<>"']/.test(v);
}
function validPub(p) {
  if (!p || typeof p !== "object" || Array.isArray(p)) return false;
  if (JSON.stringify(p).length > NL_LIMITS.pubJson) return false;
  return p.kty === "RSA" && p.alg === "RSA-OAEP-256" && p.e === "AQAB" &&
    typeof p.n === "string" && p.n.length >= 342 && p.n.length <= 344 && /^[A-Za-z0-9_-]+$/.test(p.n) && modulusOk(p.n);
}
// A real 2048-bit modulus: 256 bytes, top bit set, odd.
function modulusOk(n) {
  let bin;
  try { bin = atob(n.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "") + "==".slice(0, (4 - n.length % 4) % 4)); } catch (e) { return false; }
  return bin.length === 256 && bin.charCodeAt(0) >= 0x80 && (bin.charCodeAt(255) & 1) === 1;
}
function importPub(jwk) {
  return crypto.subtle.importKey("jwk", { kty: "RSA", alg: "RSA-OAEP-256", e: jwk.e, n: jwk.n, ext: true },
    { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
}
// Hybrid: a fresh AES-256-GCM key encrypts the JSON; RSA-OAEP wraps
// only that key (RSA alone holds at most 190 bytes).
export async function seal(pubJwk, obj) {
  const pub = await importPub(pubJwk);
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const c = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
  const raw = await crypto.subtle.exportKey("raw", key);
  const w = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, pub, raw);
  return btoa(JSON.stringify({ w: b64(w), iv: b64(iv), c: b64(c) }));
}

// ---------- the app's op ----------
export function validNl(b) {
  if (["reg", "pull", "ack", "drop"].indexOf(b.act) < 0) return "act";
  if (typeof b.k !== "string" || !K_RE.test(b.k)) return "k";
  if (typeof b.sec !== "string" || !SEC_RE.test(b.sec)) return "sec";
  if (b.act === "reg") {
    if (!validPub(b.pub)) return "pub";
    if (!validBack(b.back)) return "back";
  }
  if (b.act === "pull" && !(Number.isSafeInteger(b.after) && b.after >= 0)) return "after";
  if (b.act === "ack" && !(Number.isSafeInteger(b.upto) && b.upto >= 0)) return "upto";
  return "";
}

async function owned(d, k, sec) {
  const row = await q(d, SQL.getList, k).first();
  if (!row) throw new NlError("gone", 404, "unknown list");
  if (!sameHex(row.sec, await sha256Hex(sec))) throw new NlError("auth", 403, "wrong list secret");
  return row;
}

export async function runNl(b, env, now) {
  const d = await db(env);
  if (b.act === "reg") {
    try { await importPub(b.pub); } catch (e) { throw new NlError("bad-request", 400, "invalid pub"); }
    const pub = JSON.stringify({ kty: "RSA", alg: "RSA-OAEP-256", e: b.pub.e, n: b.pub.n });
    const back = b.back || "";
    const row = await q(d, SQL.getList, b.k).first();
    const hash = await sha256Hex(b.sec);
    if (row) {
      if (!sameHex(row.sec, hash)) throw new NlError("auth", 403, "wrong list secret");
      await q(d, SQL.setList, b.k, pub, back, now).run();
      return { ok: true };
    }
    const n = await q(d, SQL.countLists).first();
    if (n && n.n >= NL_LIMITS.lists) throw new NlError("full", 200, "no room for more lists");
    await q(d, SQL.addList, b.k, pub, hash, back, now).run();
    return { ok: true };
  }
  await owned(d, b.k, b.sec);
  if (b.act === "pull") {
    const res = await q(d, SQL.pull, b.k, b.after, NL_LIMITS.pull + 1).all();
    const rows = (res && res.results) || [];
    return { rows: rows.slice(0, NL_LIMITS.pull).map((r) => ({ id: r.id, kind: r.kind, v: r.v, at: r.at })),
             more: rows.length > NL_LIMITS.pull };
  }
  if (b.act === "ack") {
    const r = await q(d, SQL.ack, b.k, b.upto).run();
    return { n: (r && r.meta && r.meta.changes) || 0 };
  }
  await d.batch([q(d, SQL.dropRows, b.k), q(d, SQL.dropList, b.k)]);
  return { ok: true };
}

// ---------- public pages ----------
const TXT = {
  en: {
    thanks: ["Almost done", "Thank you. You will get an e-mail asking you to confirm your subscription."],
    ask: ["Unsubscribe", "Press the button to stop getting this newsletter.", "Unsubscribe"],
    done: ["You are unsubscribed", "You will get no more issues of this newsletter."],
    gone: ["Link not valid", "This link isn't valid any more."],
    bad: ["Check the address", "That e-mail address doesn't look right. Go back and try again."],
    off: ["Not available", "This form isn't available right now. Please try again later."],
    busy: ["Too many requests", "Please wait a minute and try again."]
  },
  el: {
    thanks: ["Σχεδόν έτοιμο", "Ευχαριστούμε. Θα λάβεις ένα email για να επιβεβαιώσεις την εγγραφή σου."],
    ask: ["Διαγραφή", "Πάτησε το κουμπί για να μη λαμβάνεις πια αυτό το ενημερωτικό δελτίο.", "Διαγραφή"],
    done: ["Η διαγραφή έγινε", "Δεν θα λάβεις άλλα τεύχη από αυτό το ενημερωτικό δελτίο."],
    gone: ["Ο σύνδεσμος δεν ισχύει", "Αυτός ο σύνδεσμος δεν ισχύει πια."],
    bad: ["Έλεγξε τη διεύθυνση", "Η διεύθυνση email δεν φαίνεται σωστή. Γύρισε πίσω και δοκίμασε ξανά."],
    off: ["Μη διαθέσιμο", "Η φόρμα δεν είναι διαθέσιμη αυτή τη στιγμή. Δοκίμασε ξανά αργότερα."],
    busy: ["Πάρα πολλά αιτήματα", "Περίμενε ένα λεπτό και δοκίμασε ξανά."]
  }
};
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]);
}
function langOf(request, given) {
  if (given === "el" || given === "en") return given;
  return /^\s*el\b/i.test(request.headers.get("Accept-Language") || "") ? "el" : "en";
}
const PAGE_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "no-store"
};
export function page(status, lang, key, formAction) {
  const t = (TXT[lang] || TXT.en)[key];
  const form = formAction
    ? `<form method="post" action="${esc(formAction)}"><input type="hidden" name="List-Unsubscribe" value="One-Click">` +
      `<button type="submit">${esc(t[2])}</button></form>`
    : "";
  const body = `<!doctype html><html lang="${esc(lang)}"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(t[0])}</title>` +
    `<style>body{font:16px/1.5 system-ui,sans-serif;margin:0;padding:48px 16px;background:#f6f5f2;color:#222}` +
    `main{max-width:440px;margin:0 auto;background:#fff;border-radius:12px;padding:28px 24px;box-shadow:0 1px 4px #0002}` +
    `h1{font-size:22px;margin:0 0 12px}button{font:inherit;padding:10px 18px;border:0;border-radius:8px;background:#2f6fde;color:#fff;cursor:pointer}` +
    `@media (prefers-color-scheme:dark){body{background:#1a1a1a;color:#eee}main{background:#262626}}</style></head>` +
    `<body><main><h1>${esc(t[0])}</h1><p>${esc(t[1])}</p>${form}</main></body></html>`;
  return new Response(body, { status, headers: PAGE_HEADERS });
}

async function readSmall(request) {
  const len = +(request.headers.get("Content-Length") || 0);
  if (len > NL_LIMITS.formBytes) return null;
  const reader = request.body ? request.body.getReader() : null;
  if (!reader) return "";
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > NL_LIMITS.formBytes) { try { await reader.cancel(); } catch (e) {} return null; }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.length; }
  return new TextDecoder().decode(all);
}

// Every request under /nl/ (after the rate limit in core.js).
export async function handleNl(request, env, url, now) {
  const parts = url.pathname.split("/");          // "", "nl", "s"|"u", k, tok?
  const kind = parts[2], k = parts[3] || "", tok = parts[4] || "";
  let lang = langOf(request, url.searchParams.get("lang"));
  const shapeOk = (kind === "s" && parts.length === 4 && K_RE.test(k)) ||
                  (kind === "u" && parts.length === 5 && K_RE.test(k) && TOK_RE.test(tok));
  if (!shapeOk) return page(404, lang, "gone");
  const method = request.method;
  if (!(method === "POST" || (kind === "u" && (method === "GET" || method === "HEAD")))) {
    const r = page(405, lang, "gone");
    r.headers.set("Allow", kind === "u" ? "GET, POST" : "POST");
    return r;
  }
  let text = "";
  if (method === "POST") {
    text = await readSmall(request);
    if (text === null) return page(413, lang, "bad");
  }
  // Any storage failure (a transient D1 error, a quota) → a page, never
  // the platform's raw error.
  try {
    return await afterRead(request, env, url, now, kind, k, tok, lang, text);
  } catch (e) {
    return page(503, lang, "off");
  }
}
async function afterRead(request, env, url, now, kind, k, tok, lang, text) {
  const method = request.method;
  const d = await db(env);
  const list = await q(d, SQL.getList, k).first();
  if (!list) return page(404, lang, "gone");

  if (kind === "u") {
    if (method !== "POST") return page(200, lang, "ask", url.pathname);
    // RFC 8058 senders always POST; the body's content beyond its size
    // does not matter (the page's button sends the same thing).
    const seen = await q(d, SQL.seenUnsub, k, tok, now - DAY).first();
    if (!seen) {
      const n = await q(d, SQL.countRows, k).first();
      if (!n || n.n < NL_LIMITS.pending) await q(d, SQL.addRow, k, "u", tok, now).run();
    }
    return page(200, lang, "done");
  }

  // sign-up
  const f = new URLSearchParams(text);
  lang = langOf(request, f.get("lang") || url.searchParams.get("lang"));
  const thanks = () => (list.back && validBack(list.back)
    ? new Response(null, { status: 303, headers: { Location: list.back, "Referrer-Policy": "no-referrer", "Cache-Control": "no-store" } })
    : page(200, lang, "thanks"));
  if ((f.get("website") || "").trim()) return thanks();          // a bot filled the hidden field
  const email = (f.get("email") || "").trim();
  if (!validEmail(email)) return page(400, lang, "bad");
  const n = await q(d, SQL.countRows, k).first();
  if (n && n.n >= NL_LIMITS.pending) return thanks();
  let pub;
  try { pub = JSON.parse(list.pub); } catch (e) { return page(503, lang, "off"); }
  const v = await seal(pub, { e: email, n: oneLine(f.get("name"), 120), l: lang, t: now });
  await q(d, SQL.addRow, k, "s", v, now).run();
  return thanks();
}
