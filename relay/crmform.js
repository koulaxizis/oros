// ============================================================
// orOS Mail relay — CRM web form: a contact form the user puts on
// their own website; each message waits in Cloudflare D1 (binding
// NL_DB, tables crm_form / crm_q) until the user's CRM picks it up.
// See relay/README.md.
//
// Public (no Origin check, no CORS; any browser posts the form):
//   POST /crm/f/<k>     name?, email, phone?, company?, message?, lang?,
//                       website (honeypot)
// App (POST /v1, origin-gated): { op: "crmf", act, k, sec, ... }
//   reg { pub, back } → { ok }        pull { after } → { rows, more }
//   ack { upto } → { n }              drop → { ok }
// A message is stored only encrypted for the form (the same hybrid
// AES-256-GCM + RSA-OAEP-256 seal as Newsletter's sign-ups); in clear
// only the form key and the time. The form's secret is kept as its
// SHA-256. Rows older than 30 days are deleted even if never fetched.
// Nothing is logged. Without NL_DB the form page answers 503 "off"
// and the op 503 "nostore". Every D1 call is inside a try: a storage
// failure is a 503, never an exception out of handle().
// The helpers (seal, secret check, e-mail check, honeypot, page) are
// Newsletter's own (relay/newsletter.js), not copies.
// ============================================================

import { seal, sha256Hex, sameHex, validEmail, validBack, validPub, importPub,
         readSmall, langOf, renderPage, isBot, oneLine, K_RE, SEC_RE } from "./newsletter.js";

export const CRMF_LIMITS = {
  formBytes: 8192,      // the whole POST body
  message: 2000,        // characters of the message
  field: 200,           // characters of every other field
  pending: 500,         // messages waiting per form
  perDay: 100,          // messages stored per form per UTC day (spam floods)
  forms: 5000,          // forms in all
  pull: 100,            // rows per pull
  ttlDays: 30           // a message not picked up by then is deleted
};
const DAY = 86400000;

export class CrmfError extends Error {
  constructor(code, status, msg) { super(msg || code); this.code = code; this.status = status || 200; }
}

export const CRMF_SQL = {
  form: "CREATE TABLE IF NOT EXISTS crm_form (k TEXT PRIMARY KEY, pub TEXT NOT NULL, sec TEXT NOT NULL, back TEXT, at INTEGER NOT NULL, day INTEGER NOT NULL DEFAULT 0, n INTEGER NOT NULL DEFAULT 0)",
  queue: "CREATE TABLE IF NOT EXISTS crm_q (id INTEGER PRIMARY KEY AUTOINCREMENT, k TEXT NOT NULL, v TEXT NOT NULL, at INTEGER NOT NULL)",
  index: "CREATE INDEX IF NOT EXISTS crm_q_k ON crm_q (k, id)",
  indexAt: "CREATE INDEX IF NOT EXISTS crm_q_at ON crm_q (at)",
  getForm: "SELECT pub, sec, back, day, n FROM crm_form WHERE k = ?1",
  countForms: "SELECT COUNT(*) AS n FROM crm_form",
  addForm: "INSERT INTO crm_form (k, pub, sec, back, at, day, n) VALUES (?1, ?2, ?3, ?4, ?5, 0, 0)",
  setForm: "UPDATE crm_form SET pub = ?2, back = ?3, at = ?4 WHERE k = ?1",
  bump: "UPDATE crm_form SET day = ?2, n = ?3 WHERE k = ?1",
  countRows: "SELECT COUNT(*) AS n FROM crm_q WHERE k = ?1",
  addRow: "INSERT INTO crm_q (k, v, at) VALUES (?1, ?2, ?3)",
  purge: "DELETE FROM crm_q WHERE at < ?1",
  pull: "SELECT id, v, at FROM crm_q WHERE k = ?1 AND id > ?2 ORDER BY id LIMIT ?3",
  ack: "DELETE FROM crm_q WHERE k = ?1 AND id <= ?2",
  dropRows: "DELETE FROM crm_q WHERE k = ?1",
  dropForm: "DELETE FROM crm_form WHERE k = ?1"
};

// ---------- storage ----------
let schemaFor = null, schemaP = null;
function db(env) {
  const d = env && env.NL_DB;
  if (!d || typeof d.prepare !== "function") throw new CrmfError("nostore", 503, "web forms are not set up on this relay");
  if (schemaFor !== d || !schemaP) {
    schemaFor = d;
    schemaP = d.batch([d.prepare(CRMF_SQL.form), d.prepare(CRMF_SQL.queue), d.prepare(CRMF_SQL.index), d.prepare(CRMF_SQL.indexAt)])
      .catch((e) => { schemaP = null; throw e; });
  }
  return schemaP.then(() => d);
}
function q(d, sql, ...args) { return d.prepare(sql).bind(...args); }
// Messages nobody fetched within ttlDays leave (on every form POST and op).
function purge(d, now) { return q(d, CRMF_SQL.purge, now - CRMF_LIMITS.ttlDays * DAY).run(); }

// ---------- fields ----------
// The message keeps its line breaks; every other control character goes.
export function cleanMessage(s) {
  return String(s || "").replace(/\r\n?/g, "\n").replace(/\t/g, " ")
    .replace(/[\u0000-\u0009\u000B-\u001f\u007f\u2028\u2029]/g, "")
    .replace(/[ ]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, CRMF_LIMITS.message);
}
// The form fields → what is sealed, or null when the e-mail is not one.
export function leadOf(f, lang, now) {
  const email = (f.get("email") || "").trim();
  if (email.length > CRMF_LIMITS.field || !validEmail(email)) return null;
  const o = { e: email, l: lang, t: now };
  const put = (k, name) => { const v = oneLine(f.get(name), CRMF_LIMITS.field); if (v) o[k] = v; };
  put("n", "name");
  put("p", "phone");
  put("c", "company");
  const m = cleanMessage(f.get("message"));
  if (m) o.m = m;
  return o;
}

// ---------- the app's op ----------
export function validCrmf(b) {
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
  const row = await q(d, CRMF_SQL.getForm, k).first();
  if (!row) throw new CrmfError("gone", 404, "unknown form");
  if (!sameHex(row.sec, await sha256Hex(sec))) throw new CrmfError("auth", 403, "wrong form secret");
  return row;
}

export async function runCrmf(b, env, now) {
  const d = await db(env);
  await purge(d, now);
  if (b.act === "reg") {
    try { await importPub(b.pub); } catch (e) { throw new CrmfError("bad-request", 400, "invalid pub"); }
    const pub = JSON.stringify({ kty: "RSA", alg: "RSA-OAEP-256", e: b.pub.e, n: b.pub.n });
    const back = b.back || "";
    const row = await q(d, CRMF_SQL.getForm, b.k).first();
    const hash = await sha256Hex(b.sec);
    if (row) {
      if (!sameHex(row.sec, hash)) throw new CrmfError("auth", 403, "wrong form secret");
      await q(d, CRMF_SQL.setForm, b.k, pub, back, now).run();
      return { ok: true };
    }
    const n = await q(d, CRMF_SQL.countForms).first();
    if (n && n.n >= CRMF_LIMITS.forms) throw new CrmfError("full", 200, "no room for more forms");
    await q(d, CRMF_SQL.addForm, b.k, pub, hash, back, now).run();
    return { ok: true };
  }
  await owned(d, b.k, b.sec);
  if (b.act === "pull") {
    const res = await q(d, CRMF_SQL.pull, b.k, b.after, CRMF_LIMITS.pull + 1).all();
    const rows = (res && res.results) || [];
    return { rows: rows.slice(0, CRMF_LIMITS.pull).map((r) => ({ id: r.id, v: r.v, at: r.at })),
             more: rows.length > CRMF_LIMITS.pull };
  }
  if (b.act === "ack") {
    const r = await q(d, CRMF_SQL.ack, b.k, b.upto).run();
    return { n: (r && r.meta && r.meta.changes) || 0 };
  }
  await d.batch([q(d, CRMF_SQL.dropRows, b.k), q(d, CRMF_SQL.dropForm, b.k)]);
  return { ok: true };
}

// ---------- the public page ----------
const TXT = {
  en: {
    thanks: ["Message sent", "Thank you. Your message has been sent and we will get back to you soon."],
    bad: ["Check the address", "That e-mail address doesn't look right. Go back and try again."],
    big: ["Message too long", "Your message is too long. Go back, shorten it and try again."],
    gone: ["Form not available", "This form isn't available any more."],
    off: ["Not available", "This form isn't available right now. Please try again later."],
    busy: ["Too many requests", "Please wait a minute and try again."]
  },
  el: {
    thanks: ["Το μήνυμα στάλθηκε", "Ευχαριστούμε. Το μήνυμά σας στάλθηκε και θα επικοινωνήσουμε μαζί σας σύντομα."],
    bad: ["Ελέγξτε τη διεύθυνση", "Η διεύθυνση email δεν φαίνεται σωστή. Γυρίστε πίσω και δοκιμάστε ξανά."],
    big: ["Πολύ μεγάλο μήνυμα", "Το μήνυμά σας είναι πολύ μεγάλο. Γυρίστε πίσω, συντομέψτε το και δοκιμάστε ξανά."],
    gone: ["Η φόρμα δεν είναι διαθέσιμη", "Αυτή η φόρμα δεν είναι πια διαθέσιμη."],
    off: ["Μη διαθέσιμο", "Η φόρμα δεν είναι διαθέσιμη αυτή τη στιγμή. Δοκιμάστε ξανά αργότερα."],
    busy: ["Πάρα πολλά αιτήματα", "Περιμένετε ένα λεπτό και δοκιμάστε ξανά."]
  }
};
// A fixed page: nothing the visitor sent is ever put in it.
export function crmPage(status, lang, key) {
  const t = (TXT[lang] || TXT.en)[key];
  return renderPage(status, lang === "el" ? "el" : "en", t[0], t[1], "", "");
}

// Every request under /crm/ (after the rate limit in core.js). Never
// throws: anything unexpected is the "not available" page.
export async function handleCrmForm(request, env, url, now) {
  let lang = "en";
  try {
    lang = langOf(request, url.searchParams.get("lang"));
    const parts = url.pathname.split("/");          // "", "crm", "f", k
    const k = parts[3] || "";
    if (!(parts.length === 4 && parts[2] === "f" && K_RE.test(k))) return crmPage(404, lang, "gone");
    if (request.method !== "POST") {
      const r = crmPage(405, lang, "gone");
      r.headers.set("Allow", "POST");
      return r;
    }
    const text = await readSmall(request, CRMF_LIMITS.formBytes);
    if (text === null) return crmPage(413, lang, "big");
    const f = new URLSearchParams(text);
    lang = langOf(request, f.get("lang") || url.searchParams.get("lang"));
    return await afterRead(env, now, k, f, lang);
  } catch (e) {
    return crmPage(503, lang, "off");
  }
}
async function afterRead(env, now, k, f, lang) {
  const d = await db(env);
  await purge(d, now);
  const form = await q(d, CRMF_SQL.getForm, k).first();
  if (!form) return crmPage(404, lang, "gone");
  // The thank-you address is the one registered with the form, never
  // anything from the request.
  const thanks = () => (form.back && validBack(form.back)
    ? new Response(null, { status: 303, headers: { Location: form.back, "Referrer-Policy": "no-referrer", "Cache-Control": "no-store" } })
    : crmPage(200, lang, "thanks"));
  if (isBot(f)) return thanks();
  const lead = leadOf(f, lang, now);
  if (!lead) return crmPage(400, lang, "bad");
  // Floods: past the day's cap or the waiting cap, nothing is stored
  // (the visitor still sees the thank-you page).
  const today = Math.floor(now / DAY);
  const used = form.day === today ? (form.n | 0) : 0;
  if (used >= CRMF_LIMITS.perDay) return thanks();
  const n = await q(d, CRMF_SQL.countRows, k).first();
  if (n && n.n >= CRMF_LIMITS.pending) return thanks();
  let pub;
  try { pub = JSON.parse(form.pub); } catch (e) { return crmPage(503, lang, "off"); }
  const v = await seal(pub, lead);
  await d.batch([q(d, CRMF_SQL.addRow, k, v, now), q(d, CRMF_SQL.bump, k, today, used + 1)]);
  return thanks();
}
