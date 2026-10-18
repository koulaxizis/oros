// Newsletter phase 2: segments, templates, bilingual issues and
// scheduling in the core (newsletter/core.js), the bilingual renderer,
// the shared sending engine (newsletter/engine.js) driven in a sandbox
// with a fake relay, fake IndexedDB and virtual timers, the shell
// runner (newsletter/runner.js) and the Today provider.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const C = require("../newsletter/core.js");
const R = require("../newsletter/render.js");
const M = require("../mail/compose.js");

const ROOT = path.join(__dirname, "..");
const LIST = { id: "list-1", m: 1, name: "Friends", chan: "chan-1", from: "me@example.com", reply: "", lang: "en",
  addr: "1 Main St, Athens", why: "You signed up on my site.", theme: "classic", color: "#2f6fde", salt: "abcdefgh12" };
const CHAN = { id: "chan-1", m: 1, name: "My mail", kind: "mail", acct: "acct01", rate: 1, cap: 300 };
function sub(email, extra) {
  return Object.assign({ id: C.subId("list-1", email), m: 5, list: "list-1", email, name: "", tags: [], src: "manual",
    basis: "consent", at: 10, conf: 10, off: 0 }, extra || {});
}
function issue(id, extra) {
  return Object.assign({ id, m: 3, list: "list-1", subj: "Hello {first|friend}", pre: "News", fmt: "blocks",
    blocks: [{ k: "h", t: "Hi" }, { k: "p", t: "Some news." }], tags: [], st: "draft" }, extra || {});
}
function model(o) {
  return C.normalize(Object.assign({ chans: [CHAN], lists: [LIST], subs: [], issues: [] }, o || {}));
}

// ---------------------------------------------------------------
// Core
// ---------------------------------------------------------------

test("segments: tags any/all and language; a deleted segment sends to nobody", () => {
  const d = model({
    subs: [sub("a@x.gr", { tags: ["vip", "athens"], lang: "el" }), sub("b@x.gr", { tags: ["vip"] }), sub("c@x.gr", { tags: ["athens"] })],
    segs: [{ id: "seg-any", m: 1, list: "list-1", name: "Any", tags: ["vip", "athens"], match: "any" },
           { id: "seg-all", m: 1, list: "list-1", name: "All", tags: ["vip", "athens"], match: "all" },
           { id: "seg-el", m: 1, list: "list-1", name: "Greek", tags: [], lang: "el" },
           { id: "seg-orphan", m: 1, list: "gone-list", name: "x", tags: [] }]
  });
  assert.deepEqual(d.segs.map((g) => g.id), ["seg-all", "seg-any", "seg-el"]);
  const aud = (seg) => C.audience(d, C.normIssue(issue("iss-1", { seg }))).map((s) => s.email).sort();
  assert.deepEqual(aud("seg-any"), ["a@x.gr", "b@x.gr", "c@x.gr"]);
  assert.deepEqual(aud("seg-all"), ["a@x.gr"]);
  assert.deepEqual(aud("seg-el"), ["a@x.gr"]);
  assert.deepEqual(aud("seg-nope"), []);                      // never everyone
  const x = C.normIssue(issue("iss-1", { seg: "seg-nope" }));
  assert.ok(C.preflight(d, x, { chan: CHAN, aud: 0 }).some((r) => r.k === "segGone"));
  assert.deepEqual(C.segsOf(d, "list-1").length, 3);
});

test("segments and templates merge per record; deletes win a tie", () => {
  const base = model({ segs: [{ id: "seg-1", m: 5, list: "list-1", name: "A", tags: [] }],
                       tpls: [{ id: "tpl-1", m: 5, name: "Monthly", subj: "S", fmt: "md", md: "Hi" }] });
  const a = JSON.parse(JSON.stringify(base)), b = JSON.parse(JSON.stringify(base));
  a.segs[0] = { id: "seg-1", m: 6, list: "list-1", name: "Renamed", tags: ["vip"], match: "all", lang: "" };
  b.tpls[0] = { id: "tpl-1", m: 6, del: 1 };
  const ab = C.mergeNewsletter(a, b), ba = C.mergeNewsletter(b, a);
  assert.deepEqual(ab, ba);
  assert.equal(C.seg(ab, "seg-1").name, "Renamed");
  assert.equal(C.live(ab.tpls).length, 0);
  const t = C.normTpl({ id: "tpl-2", m: 1, name: "  x ", subj: "S", fmt: "blocks", blocks: [{ k: "p", t: "a" }, { k: "zz" }],
                        l2: { lang: "el", subj: "Θ", fmt: "md", md: "Γεια" } });
  assert.equal(t.blocks.length, 2);       // { k: "zz" } is kept for the newer orOS that wrote it
  assert.equal(t.l2.lang, "el");
});

test("bilingual issue: each subscriber gets their language, preflight checks both", () => {
  const x = C.normIssue(issue("iss-1", { l2: { lang: "el", subj: "Γεια {first|φίλε}", pre: "Νέα", fmt: "md", md: "Καλημέρα **όλοι**" } }));
  assert.equal(x.l2.lang, "el");
  assert.equal(C.contentFor(x, "el").subj, "Γεια {first|φίλε}");
  assert.equal(C.contentFor(x, "en").subj, "Hello {first|friend}");
  assert.equal(C.normIssue(issue("iss-2", { l2: { lang: "fr", subj: "x" } })).l2, null);
  const el = sub("a@x.gr", { name: "Μαρία Π", lang: "el" }), en = sub("b@x.gr", { name: "Bob" });
  const opts = (s) => ({ issue: x, list: LIST, sub: s, lang: C.langOf(s, LIST), unsub: "mailto:x", tok: "nl-x", mailbox: LIST.from, img: () => "" });
  const ge = R.email(opts(el)), ee = R.email(opts(en));
  assert.equal(ge.subject, "Γεια Μαρία");
  assert.match(ge.html, /Καλημέρα <strong>όλοι<\/strong>/);
  assert.equal(ee.subject, "Hello Bob");
  assert.doesNotMatch(ee.html, /Καλημέρα/);
  const d = model({ subs: [el, en] });
  const bad = C.normIssue(issue("iss-3", { l2: { lang: "el", subj: "", fmt: "md", md: "" } }));
  const res = C.preflight(d, bad, { chan: CHAN, aud: 2 });
  assert.ok(res.some((r) => r.k === "noSubj") && res.some((r) => r.k === "noBody"));
  assert.equal(new Set(res.map((r) => r.lvl + r.k)).size, res.length);
});

test("scheduling: needs a time, keeps the scheduling device, due only there", () => {
  assert.equal(C.normIssue(issue("iss-1", { st: "sched" })).st, "draft");
  const x = C.normIssue(issue("iss-1", { st: "sched", when: 1000, lock: { dev: "devaaa1", at: 5 } }));
  assert.equal(x.st, "sched");
  assert.deepEqual(x.lock, { dev: "devaaa1", at: 5 });
  const d = model({ issues: [x, issue("iss-2", { st: "sched", when: 5000, lock: { dev: "devbbb1", at: 5 } })] });
  assert.deepEqual(C.schedDue(d, 2000, "devaaa1").map((y) => y.id), ["iss-1"]);
  assert.deepEqual(C.schedDue(d, 9000, "devaaa1").map((y) => y.id), ["iss-1"]);
  assert.deepEqual(C.schedDue(d, 9000, "devbbb1").map((y) => y.id), ["iss-2"]);
  assert.equal(C.normIssue(issue("iss-3", { st: "draft", when: 1000 })).when, 0);
});

// ---------------------------------------------------------------
// The engine in a sandbox
// ---------------------------------------------------------------

const { sandbox } = require("./newsletter-sandbox.js");

test("engine: sends an issue to each subscriber once, then marks it sent", async () => {
  const now = Date.now();
  const d = model({
    subs: [sub("a@x.gr", { lang: "el", name: "Άννα" }), sub("b@x.gr"), sub("c@x.gr", { off: 20, offSt: "off" })],
    issues: [issue("iss-1", { st: "sending", start: now, lock: { dev: "devaaa1", at: now },
                              l2: { lang: "el", subj: "Γεια {first|φίλε}", fmt: "md", md: "Νέα" } })]
  });
  const S = await sandbox(d);
  await S.run(20);
  assert.deepEqual(S.sent.map((m) => m.to).sort(), ["a@x.gr", "b@x.gr"]);
  const greek = S.sent.find((m) => m.to === "a@x.gr").raw;
  assert.match(greek, /Subject: =\?UTF-8\?/);                      // the Greek subject, encoded
  const out = S.read();
  const x = out.issues.find((y) => y.id === "iss-1");
  assert.equal(x.st, "sent");
  assert.equal(x.n, 2);
  assert.deepEqual(out.sent["iss-1"] ? out.sent["iss-1"].length : 2, 2);
  assert.ok(S.notes.some(([k]) => k === "done"));
  const dev = JSON.parse(S.localStorage.getItem("oros-newsletter-dev"));
  assert.equal(Object.values(dev.used)[0].n, 2);
});

test("engine: merge-on-write keeps what another window wrote meanwhile", async () => {
  const now = Date.now();
  const d = model({ subs: [sub("a@x.gr"), sub("b@x.gr")],
                    issues: [issue("iss-1", { st: "sending", start: now, lock: { dev: "devaaa1", at: now } })] });
  const S = await sandbox(d);
  // the app adds a subscriber and a draft while the engine runs
  const other = JSON.parse(JSON.stringify(d));
  other.subs.push(C.normSub(sub("late@x.gr", { m: 99, at: now + 1, conf: now + 1 })));
  other.issues.push(C.normIssue(issue("iss-2", { m: 99 })));
  S.E.write(other);
  await S.run(20);
  const out = S.read();
  assert.ok(out.issues.some((y) => y.id === "iss-2"), "the draft survived");
  assert.ok(out.subs.some((s) => s.email === "late@x.gr"), "the new subscriber survived");
});

test("engine: a scheduled issue starts on its device when due; skips who left", async () => {
  const d = model({ subs: [sub("a@x.gr"), sub("b@x.gr")],
                    issues: [issue("iss-1", { st: "sched", when: Date.now() - 1000, lock: { dev: "devaaa1", at: 1 } }),
                             issue("iss-2", { st: "sched", when: Date.now() - 1000, lock: { dev: "devzzz9", at: 1 } })] });
  const S = await sandbox(d);
  // b@ unsubscribes (another device) before the engine starts
  const cur = S.E.read();
  const b = cur.subs.find((s) => s.email === "b@x.gr");
  b.off = Date.now(); b.offSt = "off"; b.m = Date.now();
  S.E.write(cur);
  await S.run(20);
  const out = S.read();
  assert.ok(S.notes.some(([k, i]) => k === "started" && i.issue.id === "iss-1"));
  assert.equal(out.issues.find((y) => y.id === "iss-1").st, "sent");
  assert.equal(out.issues.find((y) => y.id === "iss-2").st, "sched", "another device's schedule waits for it");
  assert.deepEqual(S.sent.map((m) => m.to), ["a@x.gr"]);
});

test("engine: a missing password pauses the issue with a stored code", async () => {
  const now = Date.now();
  const d = model({ subs: [sub("a@x.gr")], issues: [issue("iss-1", { st: "sending", start: now, lock: { dev: "devaaa1", at: now } })] });
  const S = await sandbox(d);
  S.ctx.indexedDB.dbs["oros-mail"].stores.creds.clear();
  await S.run(10);
  const x = S.read().issues.find((y) => y.id === "iss-1");
  assert.equal(x.st, "paused");
  assert.equal(x.err, "nopass");
  assert.ok(S.notes.some(([k, i]) => k === "paused" && i.err === "nopass"));
  assert.equal(S.sent.length, 0);
});

// ---------------------------------------------------------------
// Shell runner and Today
// ---------------------------------------------------------------

test("runner: owns the sync slice in the shell and merges pulls without marking dirty", () => {
  const store = new Map();
  const reg = [];
  let dirty = 0;
  const ctx = {
    console, localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
    navigator: { onLine: true }, setTimeout: () => 0, clearTimeout() {}, addEventListener() {},
    orosSync: { registerSlice: (...a) => reg.push(a), markDirty: () => dirty++, onAutoSync() {}, isConnected: () => false, hasPassphrase: () => false }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ["newsletter/core.js", "newsletter/render.js", "mail/compose.js", "newsletter/engine.js", "newsletter/runner.js"]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx, { filename: f });
  }
  assert.equal(reg.length, 1);
  const [name, get, set, key] = reg[0];
  assert.equal(name, "newsletter");
  assert.equal(key, "oros-newsletter-data");
  set(model({ subs: [sub("a@x.gr")] }));
  set(model({ subs: [sub("b@x.gr")] }));
  assert.equal(JSON.stringify(get().subs.map((s) => s.email).sort()), JSON.stringify(["a@x.gr", "b@x.gr"]));
  assert.equal(dirty, 0);
  const R2 = ctx.orosNewsletterRunner;
  assert.ok(R2.v >= 1);
  assert.equal(R2.state().k, "wait-sync");
  let calls = 0;
  const off = R2.on(() => calls++);
  set(model({ subs: [sub("c@x.gr")] }));
  assert.equal(calls, 1);
  off();
  set(model({ subs: [sub("d@x.gr")] }));
  assert.equal(calls, 1);
});

test("Today provider: sending, paused, scheduled and new subscribers; read-only", () => {
  const P = require("../newsletter/today.js");
  global.OrosNewsletterCore = C;
  try {
    const now = new Date(2026, 9, 12, 10, 0).getTime();
    const d = model({
      subs: [sub("a@x.gr", { at: now - 3600e3, conf: now - 3600e3 }), sub("b@x.gr", { at: now - 3600e3, conf: 0, basis: "optin" }), sub("old@x.gr")],
      issues: [issue("iss-1", { st: "sending", start: now, lock: { dev: "devaaa1", at: now } }),
               issue("iss-2", { st: "paused", subj: "" }),
               issue("iss-3", { st: "sched", when: new Date(2026, 9, 14, 9, 30).getTime(), lock: { dev: "devaaa1", at: 1 } }),
               issue("iss-4", { st: "sched", when: new Date(2026, 11, 1, 9, 30).getTime() })]
    });
    const raw = JSON.stringify(d);
    const ctx = { today: "2026-10-12", horizon: 7, now, lang: "el", readRaw: () => raw, readJSON: () => JSON.parse(raw),
                  addDays: (s, n) => { const [y, m, dd] = s.split("-").map(Number); const t = new Date(y, m - 1, dd + n);
                    return t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0"); } };
    const rows = P.collect(ctx);
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    assert.equal(by["send-iss-1"].kind, "info");
    assert.equal(by["send-iss-1"].title, "Αποστολή «Hello friend»");
    assert.equal(by["paused-iss-2"].kind, "task");
    assert.match(by["paused-iss-2"].title, /χωρίς θέμα/);
    assert.deepEqual([by["sched-iss-3"].due, by["sched-iss-3"].time, by["sched-iss-3"].kind], ["2026-10-14", "09:30", "event"]);
    assert.ok(!by["sched-iss-4"], "beyond the horizon");
    assert.equal(by["subs-2026-10-12"].title, "2 νέοι συνδρομητές");
    assert.deepEqual(by["subs-2026-10-12"].target, { list: "list-1" });
    assert.equal(raw, JSON.stringify(d));
  } finally { delete global.OrosNewsletterCore; }
});

test("message for one language: Mail's builder gets the Greek subject", () => {
  const x = C.normIssue(issue("iss-1", { l2: { lang: "el", subj: "Νέα", fmt: "md", md: "Γεια" } }));
  const e = R.email({ issue: x, list: LIST, sub: null, lang: "el", unsub: "", tok: "nl-test", mailbox: LIST.from, img: () => "" });
  const msg = R.message(M, { from: { name: "", addr: LIST.from }, to: { name: "", addr: "t@x.gr" }, subject: e.subject,
                             text: e.text, html: e.html, inline: [], listId: LIST.id, listName: LIST.name, unsub: "", tag: x.id });
  assert.match(msg.bin, /Subject: =\?UTF-8\?B\?/);
});
