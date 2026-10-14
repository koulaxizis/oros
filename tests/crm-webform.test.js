// CRM web form, app side: the synced record data.wf (crm/core.js
// normWf + merge), the HTML for the user's site and how a message
// becomes a lead (crm/webform.js, pure part). The last test sends a
// form through the real relay code (relay/core.js + relay/crmform.js)
// over an in-memory D1 and feeds what CRM would open to apply().
// Run: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const C = require(path.join(__dirname, "..", "crm/core.js"));
const W = require(path.join(__dirname, "..", "crm/webform.js"));

const NOW = Date.UTC(2026, 9, 14, 10, 0, 0);
const PRIV = { kty: "RSA", n: "n1", e: "AQAB", d: "d1", p: "p", q: "q", dp: "dp", dq: "dq", qi: "qi" };
const WF = { m: 1000, k: "abcdefgh12345678", sec: "A".repeat(32), priv: PRIV, back: "https://my.site/thanks", dev: "devaaa1", at: 5 };
const WORDS = { name: "Name", phone: "Phone", company: "Company", noMsg: "No message." };
function opts(extra) {
  let s = NOW;
  return Object.assign({ now: NOW, stamp: () => ++s, src: "Web form", words: WORDS }, extra || {});
}
function cust(id, extra) { return Object.assign({ id, m: 1000, name: "Client " + id, st: "active" }, extra || {}); }

test("normWf: validated, absent until used, private key parts only", () => {
  assert.equal(C.normWf(null), null);
  assert.equal(C.normWf(Object.assign({}, WF, { m: 0 })), null);
  assert.equal(C.normWf(Object.assign({}, WF, { k: "short" })), null);
  assert.equal(C.normWf(Object.assign({}, WF, { sec: "x" })), null);
  assert.equal(C.normWf(Object.assign({}, WF, { priv: Object.assign({}, PRIV, { d: "bad value!" }) })), null);
  const w = C.normWf(Object.assign({}, WF, { extra: 1, priv: Object.assign({ ext: true, key_ops: ["decrypt"] }, PRIV) }));
  assert.deepEqual(Object.keys(w), ["m", "k", "sec", "priv", "back", "dev", "at"]);
  assert.deepEqual(Object.keys(w.priv), ["kty", "alg", "n", "e", "d", "p", "q", "dp", "dq", "qi"]);
  for (const back of ["javascript:alert(1)", "http://my.site/", "https://u:p@my.site/", "https://x/\"><script>"]) {
    assert.equal(C.normWf(Object.assign({}, WF, { back })).back, undefined, back);
  }
  assert.deepEqual(C.normWf({ m: 7, off: 1, k: "x" }), { m: 7, off: 1 });
  // data without a form keeps its exact bytes
  const plain = C.norm({ cust: [cust("aaaaaa1")] });
  assert.equal("wf" in plain, false);
  assert.equal(JSON.stringify(C.norm(JSON.parse(JSON.stringify(plain)))), JSON.stringify(plain));
});

test("merge: the form is last-writer-wins, 'off' travels, symmetric and idempotent", () => {
  const a = C.norm({ cust: [cust("aaaaaa1")], wf: WF });
  const b = C.norm({ cust: [cust("bbbbbb1")] });
  const ab = C.merge(a, b), ba = C.merge(b, a);
  assert.deepEqual(ab, ba);
  assert.equal(ab.wf.k, WF.k);
  assert.equal(ab.cust.length, 2);
  const here = C.norm(Object.assign({}, a, { wf: Object.assign({}, WF, { m: 2000, dev: "devbbb2" }) }));
  assert.equal(C.merge(a, here).wf.dev, "devbbb2");
  const off = C.norm(Object.assign({}, a, { wf: { m: 3000, off: 1 } }));
  assert.deepEqual(C.merge(here, off).wf, { m: 3000, off: 1 });
  assert.deepEqual(C.merge(off, here).wf, { m: 3000, off: 1 });
  // a new form made after "off" wins again
  const again = C.norm(Object.assign({}, a, { wf: Object.assign({}, WF, { m: 4000, k: "newform000000000" }) }));
  assert.equal(C.merge(off, again).wf.k, "newform000000000");
  assert.deepEqual(C.merge(ab, ab), ab);
  // an older device's copy (no wf at all) never removes it
  assert.equal(C.merge(ab, b).wf.k, WF.k);
  // equal m: the larger canonical JSON wins on both sides
  const x = C.norm({ wf: Object.assign({}, WF, { back: "https://a.example/" }) }), y = C.norm({ wf: Object.assign({}, WF, { back: "https://b.example/" }) });
  assert.deepEqual(C.merge(x, y).wf, C.merge(y, x).wf);
  // a backup carries it and a restore merges it
  assert.equal(C.restore(C.empty(), C.backup(ab)).wf.k, WF.k);
});

test("HTML snippet: the relay's address, honeypot, language, escaped, no script", () => {
  const w = C.normWf(WF);
  const en = W.snippet(w, "https://relay.example", "en");
  assert.match(en, /^<form method="post" action="https:\/\/relay\.example\/crm\/f\/abcdefgh12345678" accept-charset="utf-8">/);
  for (const n of ["name", "email", "phone", "company", "website"]) assert.match(en, new RegExp('name="' + n + '"'));
  assert.match(en, /<textarea name="message" maxlength="2000"/);
  assert.match(en, /name="email" required maxlength="200"/);
  assert.match(en, /name="lang" value="en"/);
  assert.match(en, /aria-hidden="true"><input type="text" name="website" tabindex="-1" autocomplete="off">/);
  assert.match(en, />Send<\/button>/);
  assert.doesNotMatch(en, /<script|on\w+=/i);
  const el = W.snippet(w, "https://relay.example", "el");
  assert.match(el, /name="lang" value="el"/);
  assert.match(el, />Αποστολή<\/button>/);
  assert.match(el, /Τηλέφωνο/);
  assert.match(W.snippet(w, "https://r.example/\"><x", "en"), /action="https:\/\/r\.example\/&quot;&gt;&lt;x\/crm\/f\//);
  assert.equal(W.snippet(null, "https://r", "en"), "");
  assert.equal(W.snippet({ m: 1, off: 1 }, "https://r", "en"), "");
  assert.equal(W.relayOf({ relay: { url: "https://my.relay/ " } }), "https://my.relay");
  assert.match(W.relayOf({ relay: { url: "http://insecure" } }), /^https:\/\/oros-mail-relay\./);
  assert.equal(W.validBack(""), true);
  assert.equal(W.validBack("https://my.site/ok"), true);
  assert.equal(W.validBack("http://my.site/"), false);
  assert.equal(W.validBack("https://u:p@my.site/"), false);
});

test("apply: a new person lead, a company lead with its person, a message with no text", () => {
  const d = C.norm({});
  const r = W.apply(C, d, [
    { e: "Maria@Example.com", n: "Μαρία Παπά", p: "+30 210 1", m: "Θα ήθελα προσφορά.", l: "el", t: NOW - 1000 },
    { e: "nikos@acme.gr", n: "Nikos", c: "Acme ΑΕ", l: "en", t: NOW - 500 },
    { e: "no-name@x.gr", l: "en", t: NOW }
  ], opts());
  assert.deepEqual([r.added, r.merged, r.same, r.over, r.bad], [3, 0, 0, 0, 0]);
  assert.equal(r.ids.length, 6);
  const n = C.norm(d);
  const maria = n.cust.find((c) => c.name === "Μαρία Παπά");
  assert.deepEqual([maria.kind, maria.st, maria.src, maria.email, maria.phone, maria.ct], ["person", "lead", "Web form", "maria@example.com", "+30 210 1", NOW - 1000]);
  const acme = n.cust.find((c) => c.name === "Acme ΑΕ");
  assert.equal(acme.kind, "co");
  assert.deepEqual(acme.people, [{ c: "", n: "Nikos", email: "nikos@acme.gr" }]);
  assert.equal(n.cust.find((c) => c.email === "no-name@x.gr").name, "no-name@x.gr");
  const act = n.acts.find((a) => a.cust === maria.id);
  assert.deepEqual([act.k, act.at, act.text, act.who], ["msg", NOW - 1000, "Θα ήθελα προσφορά.", "Μαρία Παπά"]);
  assert.equal(n.acts.find((a) => a.cust === acme.id).text, "No message.");
  // the new leads count on the dashboard
  assert.equal(C.dashboard(n, NOW, C.ymdOf(NOW)).byStatus.lead, 3);
});

test("apply: an e-mail CRM has (customer's or a person's, any case) gets a history entry, not a duplicate", () => {
  const d = C.norm({ cust: [
    cust("aaaaaa1", { name: "Eleni K", email: "eleni@x.gr", phone: "111" }),
    cust("bbbbbb1", { name: "Beta Ltd", kind: "co", people: [{ n: "Kostas", email: "Kostas@Beta.gr" }] }),
    cust("cccccc1", { name: "Gamma", kind: "co", people: [{ c: "contact-1", n: "" }] })
  ] });
  const before = d.cust.length;
  const r = W.apply(C, d, [
    { e: "ELENI@x.gr", n: "Eleni Konstantinou", p: "222", c: "Eleni Studio", m: "Call me back", t: NOW },
    { e: "kostas@beta.gr", n: "Kostas", m: "Hi", t: NOW + 1 },
    { e: "linked@gamma.gr", m: "From a Contacts-linked person", t: NOW + 2 }
  ], opts({ emailOf: (p) => (p.c === "contact-1" ? "Linked@Gamma.gr" : p.email) }));
  assert.deepEqual([r.added, r.merged], [0, 3]);
  assert.equal(d.cust.length, before);
  const n = C.norm(d);
  const e = n.acts.find((a) => a.cust === "aaaaaa1");
  assert.equal(e.text, "Call me back\n\nName: Eleni Konstantinou\nPhone: 222\nCompany: Eleni Studio");
  assert.equal(n.cust.find((c) => c.id === "aaaaaa1").phone, "111");                    // the record is not changed
  assert.equal(n.acts.find((a) => a.cust === "bbbbbb1").text, "Hi");   // a person of the customer by that name: no extra line
  assert.equal(n.acts.find((a) => a.cust === "cccccc1").text, "From a Contacts-linked person");
  // the same messages again (a pull repeated after a failed ack): nothing new
  const again = W.apply(C, d, [
    { e: "eleni@x.gr", n: "Eleni Konstantinou", p: "222", c: "Eleni Studio", m: "Call me back", t: NOW },
    { e: "kostas@beta.gr", n: "Kostas", m: "Hi", t: NOW + 1 }
  ], opts());
  assert.deepEqual([again.added, again.merged, again.same, again.ids.length], [0, 0, 2, 0]);
  // two messages from one new address in one batch: one customer, two entries
  const two = W.apply(C, d, [{ e: "new@x.gr", m: "one", t: NOW }, { e: "NEW@x.gr", m: "two", t: NOW + 5 }], opts());
  assert.deepEqual([two.added, two.merged], [1, 1]);
  assert.equal(C.norm(d).cust.filter((c) => c.email === "new@x.gr").length, 1);
});

test("apply: bad input and the limits", () => {
  const d = C.norm({});
  const r = W.apply(C, d, [null, {}, { e: "not an address" }, { e: "a@x.gr", n: "<b>x</b>\u0007", m: "x".repeat(5000), t: NOW * 10 }], opts());
  assert.equal(r.bad, 3);
  assert.equal(r.added, 1);
  const n = C.norm(d);
  assert.equal(n.cust[0].name, "<b>x</b>");                 // plain text, shown with textContent
  assert.equal(n.acts[0].text.length, 2000);
  assert.equal(n.acts[0].at, NOW);                          // a time from the future → now
  const full = C.norm({});
  for (let i = 0; i < C.LIMITS.cust; i++) full.cust.push({ id: "c" + String(i).padStart(6, "0"), m: 1, name: "C" + i, kind: "person", st: "lead" });
  const o = W.apply(C, full, [{ e: "late@x.gr", t: NOW }], opts());
  assert.deepEqual([o.added, o.over], [0, 1]);
});

// ---------- through the real relay ----------
const ORIGIN = "https://useoros.online";
function fakeD1(F) {
  const forms = new Map(), rows = [];
  let seq = 0;
  function exec(sql, a) {
    const S = F.CRMF_SQL;
    switch (sql) {
      case S.form: case S.queue: case S.index: case S.indexAt: return {};
      case S.getForm: { const f = forms.get(a[0]); return { first: f ? { ...f } : null }; }
      case S.countForms: return { first: { n: forms.size } };
      case S.addForm: forms.set(a[0], { pub: a[1], sec: a[2], back: a[3], at: a[4], day: 0, n: 0 }); return {};
      case S.setForm: Object.assign(forms.get(a[0]), { pub: a[1], back: a[2], at: a[3] }); return {};
      case S.bump: Object.assign(forms.get(a[0]), { day: a[1], n: a[2] }); return {};
      case S.countRows: return { first: { n: rows.filter((r) => r.k === a[0]).length } };
      case S.addRow: rows.push({ id: ++seq, k: a[0], v: a[1], at: a[2] }); return {};
      case S.purge: for (let i = rows.length - 1; i >= 0; i--) if (rows[i].at < a[0]) rows.splice(i, 1); return {};
      case S.pull: return { all: rows.filter((r) => r.k === a[0] && r.id > a[1]).slice(0, a[2]).map((r) => ({ ...r })) };
      case S.ack: { const n = rows.length; for (let i = rows.length - 1; i >= 0; i--) if (rows[i].k === a[0] && rows[i].id <= a[1]) rows.splice(i, 1); return { meta: { changes: n - rows.length } }; }
      case S.dropRows: for (let i = rows.length - 1; i >= 0; i--) if (rows[i].k === a[0]) rows.splice(i, 1); return {};
      case S.dropForm: forms.delete(a[0]); return {};
    }
    throw new Error("unknown SQL " + sql);
  }
  const stmt = (sql, args) => ({ bind: (...b) => stmt(sql, b), first: async () => exec(sql, args || []).first,
    all: async () => ({ results: exec(sql, args || []).all }), run: async () => exec(sql, args || []), _run: () => exec(sql, args || []) });
  return { forms, rows, prepare: (sql) => stmt(sql), batch: async (ss) => ss.map((s) => s._run()) };
}
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function openSealed(priv, v) {
  const o = JSON.parse(atob(v));
  const raw = await crypto.subtle.decrypt({ name: "RSA-OAEP" }, priv, unb64(o.w));
  const key = await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["decrypt"]);
  return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(o.iv) }, key, unb64(o.c))));
}

test("end to end: a form from the snippet, sent to the relay, picked up and added as a lead", async () => {
  const { handle } = await import("../relay/core.js");
  const F = await import("../relay/crmform.js");
  const D = fakeD1(F);
  const env = { ALLOWED_ORIGINS: ORIGIN, NL_DB: D };
  let ip = 0;
  const op = async (body) => {
    const res = await handle(new Request("https://relay.example/v1", { method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json", "CF-Connecting-IP": "10.6.0." + (ip++ % 250) },
      body: JSON.stringify(body) }), env, null, NOW);
    return res.json();
  };
  // what crm/webform.js create() makes and keeps in data.wf
  const kp = await crypto.subtle.generateKey({ name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["encrypt", "decrypt"]);
  const wf = C.normWf({ m: 1, k: "webform000000001", sec: "S".repeat(32), priv: await crypto.subtle.exportKey("jwk", kp.privateKey) });
  assert.ok(wf);
  const reg = await op({ op: "crmf", act: "reg", k: wf.k, sec: wf.sec, pub: { kty: "RSA", alg: "RSA-OAEP-256", n: wf.priv.n, e: wf.priv.e }, back: "" });
  assert.equal(reg.ok, true, JSON.stringify(reg));
  // the snippet's fields, as a browser posts them
  const html = W.snippet(wf, "https://relay.example", "el");
  const action = /action="([^"]+)"/.exec(html)[1];
  const names = [...html.matchAll(/name="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(names, ["name", "email", "phone", "company", "message", "lang", "website"]);
  const body = new URLSearchParams({ name: "Γιώργος", email: "giorgos@example.gr", phone: "6900000000", company: "", message: "Καλησπέρα!\nΘέλω ραντεβού.", lang: "el", website: "" });
  const res = await handle(new Request(action, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "CF-Connecting-IP": "10.6.1.1" }, body: body.toString() }), env, null, NOW);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Το μήνυμα στάλθηκε/);
  // CRM's check: pull, open with the private key from data.wf, apply, ack
  const pulled = await op({ op: "crmf", act: "pull", k: wf.k, sec: wf.sec, after: 0 });
  const priv = await crypto.subtle.importKey("jwk", wf.priv, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["decrypt"]);
  const leads = await Promise.all(pulled.data.rows.map((r) => openSealed(priv, r.v)));
  const d = C.norm({});
  const r = W.apply(C, d, leads, opts());
  assert.equal(r.added, 1);
  const ack = await op({ op: "crmf", act: "ack", k: wf.k, sec: wf.sec, upto: pulled.data.rows[0].id });
  assert.equal(ack.data.n, 1);
  assert.equal(D.rows.length, 0);
  const n = C.norm(d);
  assert.deepEqual([n.cust[0].name, n.cust[0].email, n.cust[0].phone, n.cust[0].st, n.cust[0].src], ["Γιώργος", "giorgos@example.gr", "6900000000", "lead", "Web form"]);
  assert.equal(n.acts[0].text, "Καλησπέρα!\nΘέλω ραντεβού.");
  assert.equal(n.acts[0].at, NOW);
});
