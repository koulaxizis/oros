// Newsletter: clean-up of inactive subscribers (core cleanOf /
// cleanPlan / cleanApply, the engine's daily runClean and how a list's
// clean-up device is chosen).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../newsletter/core.js");
const { sandbox } = require("./newsletter-sandbox.js");

const DAY = 864e5;
const NOW = Date.now();
const LIST = { id: "list-1", m: 1, name: "Friends", chan: "chan-1", from: "me@example.com", reply: "", lang: "en",
  addr: "1 Main St, Athens", why: "You signed up on my site.", theme: "classic", color: "#2f6fde", salt: "abcdefgh12" };
const CHAN = { id: "chan-1", m: 1, name: "My mail", kind: "mail", acct: "acct01", rate: 1, cap: 300 };
const ago = (days) => NOW - days * DAY;
function sub(email, extra) {
  return Object.assign({ id: C.subId("list-1", email), m: ago(400), list: "list-1", email, name: "", tags: [], src: "manual",
    basis: "consent", at: ago(400), conf: ago(400), off: 0 }, extra || {});
}
// on: active; pendOld: request 40 days ago; pendNew: request 10 days ago;
// pendNoInv: request never sent; offOld: left 100 days ago; bncOld: bounced
// 200 days ago; offNew: left 20 days ago; touched: left long ago, changed today
function people() {
  return [
    sub("on@x.gr"),
    sub("pendold@x.gr", { basis: "optin", at: ago(41), conf: 0, inv: ago(40), m: ago(40) }),
    sub("pendnew@x.gr", { basis: "optin", at: ago(11), conf: 0, inv: ago(10), m: ago(10) }),
    sub("pendnoinv@x.gr", { basis: "optin", at: ago(90), conf: 0, inv: 0, m: ago(90) }),
    sub("offold@x.gr", { off: ago(100), offSt: "off", m: ago(100) }),
    sub("bncold@x.gr", { off: ago(200), offSt: "bounce", bnc: 3, m: ago(200) }),
    sub("offnew@x.gr", { off: ago(20), offSt: "off", m: ago(20) }),
    sub("touched@x.gr", { off: ago(100), offSt: "spam", m: NOW - 3600e3 })
  ];
}
function model(o) {
  return C.normalize(Object.assign({ chans: [CHAN], lists: [LIST], subs: people(), issues: [] }, o || {}));
}
const emails = (arr) => arr.map((s) => s.email).sort();

test("settings: defaults 30 / 90 left out, 0 = never, the device kept", () => {
  assert.deepEqual(C.cleanOf(C.normList(LIST)), { pend: 30, gone: 90, idle: 12, dev: "" });
  const l = C.normList(Object.assign({}, LIST, { clnPend: 30, clnGone: 90 }));
  assert.ok(!("clnPend" in l) && !("clnGone" in l), "defaults are not stored");
  const l2 = C.normList(Object.assign({}, LIST, { clnPend: 0, clnGone: 365, clnIdle: 0, clnDev: "devaaa1" }));
  assert.equal(l2.clnPend, 0);
  assert.equal(l2.clnGone, 365);
  assert.equal(l2.clnIdle, 0);
  assert.deepEqual(C.cleanOf(l2), { pend: 0, gone: 365, idle: 0, dev: "devaaa1" });
  assert.ok(!("clnIdle" in C.normList(Object.assign({}, LIST, { clnIdle: 12 }))), "default left out");
  const bad = C.normList(Object.assign({}, LIST, { clnPend: 5, clnGone: "x", clnIdle: 7, clnDev: "BAD DEV" }));
  assert.deepEqual(C.cleanOf(bad), { pend: 30, gone: 90, idle: 12, dev: "" });
  assert.ok(!("clnPend" in bad) && !("clnGone" in bad) && !("clnIdle" in bad) && !("clnDev" in bad));
});

test("plan: who goes, never the active, never before the request, never a record changed today", () => {
  const d = model();
  const p = C.cleanPlan(d, "list-1", NOW);
  assert.deepEqual(emails(p.pend), ["pendold@x.gr"]);
  assert.deepEqual(emails(p.gone), ["bncold@x.gr", "offold@x.gr"]);
  assert.equal(p.n, 3);
  assert.equal(p.all, 8);
  assert.equal(p.ok, true);
  // other settings
  const p2 = C.cleanPlan(d, "list-1", NOW, { pend: 7, gone: 0 });
  assert.deepEqual(emails(p2.pend), ["pendnew@x.gr", "pendold@x.gr"]);
  assert.deepEqual(p2.gone, []);
  const p3 = C.cleanPlan(d, "list-1", NOW, { pend: 0, gone: 365 });
  assert.equal(p3.n, 0);
  // a pending person whose new request is not out yet (inv < at) stays
  const d2 = model({ subs: [sub("again@x.gr", { basis: "optin", at: ago(35), conf: 0, inv: ago(60), m: ago(35) })] });
  assert.equal(C.cleanPlan(d2, "list-1", NOW).n, 0);
});

test("apply: unconfirmed deleted, those who left deleted for good with a fingerprint", () => {
  const d = model();
  const n = C.cleanApply(d, C.cleanPlan(d, "list-1", NOW), NOW);
  assert.deepEqual(n, { pend: 1, gone: 2 });
  const out = C.normalize(d);
  assert.deepEqual(emails(C.subsOf(out, "list-1")), ["offnew@x.gr", "on@x.gr", "pendnew@x.gr", "pendnoinv@x.gr", "touched@x.gr"]);
  const tomb = out.subs.find((s) => s.id === C.subId("list-1", "offold@x.gr"));
  assert.equal(tomb.del, 1);
  assert.ok(!tomb.email, "the address is gone");
  assert.ok(out.supp.includes(C.suppHash("offold@x.gr")));
  assert.ok(out.supp.includes(C.suppHash("bncold@x.gr")));
  assert.ok(!out.supp.includes(C.suppHash("pendold@x.gr")), "never agreed: may be invited again");
  // an import can't add back who left, can add the unconfirmed
  const imp = C.planImport(out, "list-1", [{ email: "offold@x.gr" }, { email: "pendold@x.gr" }], { basis: "optin", src: "csv" });
  assert.equal(imp.supp, 1);
  assert.deepEqual(imp.add.map((s) => s.email), ["pendold@x.gr"]);
  // a second run deletes nothing more
  assert.deepEqual(C.cleanApply(d, C.cleanPlan(d, "list-1", NOW), NOW), { pend: 0, gone: 0 });
});

test("apply re-checks: someone who confirmed since the plan stays", () => {
  const d = model();
  const plan = C.cleanPlan(d, "list-1", NOW);
  const i = d.subs.findIndex((s) => s.email === "pendold@x.gr");
  d.subs[i] = Object.assign({}, d.subs[i], { conf: ago(2), m: ago(2) });
  const n = C.cleanApply(d, plan, NOW);
  assert.deepEqual(n, { pend: 0, gone: 2 });
  assert.ok(C.subsOf(d, "list-1").some((s) => s.email === "pendold@x.gr"));
});

test("merge: the deletion wins over an older copy and stays deleted on both devices", () => {
  const a = model(), b = model();
  C.cleanApply(a, C.cleanPlan(a, "list-1", NOW), NOW);
  const ab = C.mergeNewsletter(a, b), ba = C.mergeNewsletter(b, a);
  assert.deepEqual(ab, ba);
  assert.equal(C.subsOf(ab, "list-1").length, 5);
  // a later sign-up of their own brings them back
  const s = C.normSub({ id: C.subId("list-1", "offold@x.gr"), m: NOW + 10, list: "list-1", email: "offold@x.gr", src: "form",
    basis: "optin", at: NOW + 10, conf: 0 });
  const again = C.mergeNewsletter(ab, Object.assign({}, ab, { subs: ab.subs.map((x) => (x.id === s.id ? s : x)) }));
  assert.equal(C.status(C.sub(again, s.id)), "pend");
});

test("cap: more than 200 or a fifth of the list waits for the user", () => {
  const many = [];
  for (let i = 0; i < 30; i++) many.push(sub("gone" + i + "@x.gr", { off: ago(100), offSt: "off", m: ago(100) }));
  for (let i = 0; i < 70; i++) many.push(sub("on" + i + "@x.gr"));
  const d = model({ subs: many });
  const p = C.cleanPlan(d, "list-1", NOW);
  assert.equal(p.n, 30);
  assert.equal(p.all, 100);
  assert.equal(p.ok, false, "30 of 100 > a fifth");
  // a small list: up to 10 may always go
  const d2 = model({ subs: many.slice(0, 10) });
  assert.equal(C.cleanPlan(d2, "list-1", NOW).ok, true);
  const lots = [];
  for (let i = 0; i < 201; i++) lots.push(sub("g" + i + "@x.gr", { off: ago(100), offSt: "off", m: ago(100) }));
  for (let i = 0; i < 2000; i++) lots.push(sub("o" + i + "@x.gr"));
  assert.equal(C.cleanPlan(model({ subs: lots }), "list-1", NOW).ok, false, "more than 200");
});

test("export: only the people the clean-up names", () => {
  const d = model();
  const p = C.cleanPlan(d, "list-1", NOW);
  const only = {};
  p.pend.concat(p.gone).forEach((s) => { only[s.id] = 1; });
  const csv = C.subsCsv(d, "list-1", ["e"], (x) => x, (x) => x, only);
  const lines = csv.trim().split("\r\n");
  assert.equal(lines.length, 4);
  assert.match(csv, /offold@x\.gr/);
  assert.doesNotMatch(csv, /on@x\.gr/);
});

// ---------------------------------------------------------------
// Engine
// ---------------------------------------------------------------

test("engine: cleans only the lists of this device, once a day", async () => {
  const d = model({ lists: [Object.assign({}, LIST, { clnDev: "devaaa1" }),
                            Object.assign({}, LIST, { id: "list-2", name: "Other", clnDev: "devzzz9" })],
                    subs: people().concat([sub("offold@x.gr", { id: C.subId("list-2", "offold@x.gr"), list: "list-2", off: ago(100), offSt: "off", m: ago(100) })]) });
  const S = await sandbox(d);
  S.engine.stop();
  const res = await S.E.runClean();
  assert.equal(res.length, 1);
  assert.equal(res[0].list.id, "list-1");
  assert.equal(res[0].pend, 1);
  assert.equal(res[0].gone, 2);
  const out = S.read();
  assert.equal(C.subsOf(C.normalize(out), "list-1").length, 5);
  assert.equal(C.subsOf(C.normalize(out), "list-2").length, 1, "another device's list is left alone");
  assert.equal((await S.E.runClean()).length, 0, "once a day");
  assert.equal(JSON.parse(S.localStorage.getItem("oros-newsletter-dev")).dev, "devaaa1", "device state kept");
});

test("engine: no clean-up device yet = nothing deleted; too many = wait", async () => {
  const S = await sandbox(model());
  S.engine.stop();
  assert.equal((await S.E.runClean()).length, 0);
  assert.equal(C.live(S.read().subs).length, 8);
  const many = [];
  for (let i = 0; i < 30; i++) many.push(sub("gone" + i + "@x.gr", { off: ago(100), offSt: "off", m: ago(100) }));
  for (let i = 0; i < 70; i++) many.push(sub("on" + i + "@x.gr"));
  const S2 = await sandbox(model({ lists: [Object.assign({}, LIST, { clnDev: "devaaa1" })], subs: many }));
  S2.engine.stop();
  const res = await S2.E.runClean();
  assert.equal(res.length, 1);
  assert.equal(res[0].wait, 30);
  assert.equal(C.live(S2.read().subs).length, 100, "nothing deleted without the user");
});

test("engine: the device that sends a list's confirmation requests becomes its clean-up device", async () => {
  const S = await sandbox(model({ subs: [sub("new@x.gr", { basis: "optin", at: NOW - 1000, conf: 0, inv: 0, m: NOW - 1000 })] }));
  await S.run(10);
  assert.deepEqual(S.sent.map((m) => m.to), ["new@x.gr"]);
  assert.equal(C.normalize(S.read()).lists[0].clnDev, "devaaa1");
  S.engine.stop();
});

// ---------------------------------------------------------------
// Wave 2: "Do you still want it?"
// ---------------------------------------------------------------

const MONTH = 30 * DAY;
function idlePeople(n, extra) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(sub("old" + String(i).padStart(3, "0") + "@x.gr", Object.assign({ at: ago(400 + i), conf: ago(400 + i), m: ago(400 + i) }, extra || {})));
  return out;
}

test("ask: the field is kept only when set and merges as the latest", () => {
  const a = C.normSub(sub("a@x.gr"));
  assert.ok(!("ask" in a), "never asked: no field, data as before");
  const b = C.normSub(sub("a@x.gr", { ask: ago(3) }));
  assert.equal(b.ask, ago(3));
  const m1 = C.mergeNewsletter(model({ subs: [sub("a@x.gr", { ask: ago(3), m: ago(5) })] }), model({ subs: [sub("a@x.gr", { m: ago(1) })] }));
  assert.equal(C.sub(m1, C.subId("list-1", "a@x.gr")).ask, ago(3), "a newer edit elsewhere keeps the ask time");
});

test("ask: who is due, oldest first, at most 20 a day, never twice, never the pending or gone", () => {
  const d = model({ subs: idlePeople(30).concat([
    sub("recent@x.gr", { at: ago(100), conf: ago(100), m: ago(100) }),
    sub("reconf@x.gr", { at: ago(800), conf: ago(10), m: ago(10) }),
    sub("pend@x.gr", { basis: "optin", at: ago(500), conf: 0, inv: ago(499), m: ago(499) }),
    sub("gone@x.gr", { at: ago(500), conf: ago(500), off: ago(450), offSt: "off", m: ago(450) }),
    sub("asked@x.gr", { at: ago(900), conf: ago(900), ask: ago(5), m: ago(5) })
  ]) });
  const due = C.asksDue(d, "list-1", NOW);
  assert.equal(due.length, 20, "max(20, 5% of 33 active)");
  assert.equal(due[0].email, "old029@x.gr", "the longest silent first");
  assert.ok(due.every((s) => /^old/.test(s.email)));
  assert.equal(C.idleCount(d, "list-1", NOW, 12), 30, "the preview has no daily limit");
  assert.equal(C.idleCount(d, "list-1", NOW, 24), 0, "all silent for less than 24 months");
  assert.equal(C.idleCount(d, "list-1", NOW, 0), 0);
  // the 20 were asked today: nobody more today, the other 10 tomorrow
  due.forEach((s) => { const i = d.subs.findIndex((x) => x.id === s.id); d.subs[i] = Object.assign({}, d.subs[i], { ask: NOW - 3600e3 }); });
  assert.equal(C.asksDue(d, "list-1", NOW).length, 0);
  assert.equal(C.asksDue(d, "list-1", NOW + DAY).length, 10);
  // switched off for the list
  const off = model({ lists: [Object.assign({}, LIST, { clnIdle: 0 })], subs: idlePeople(5) });
  assert.equal(C.asksDue(off, "list-1", NOW).length, 0);
  // 6 months
  const six = model({ lists: [Object.assign({}, LIST, { clnIdle: 6 })], subs: [sub("half@x.gr", { at: ago(200), conf: ago(200), m: ago(200) })] });
  assert.equal(C.asksDue(six, "list-1", NOW).length, 1);
  // a big list: 5% of the active
  assert.equal(C.asksDue(model({ subs: idlePeople(1000) }), "list-1", NOW).length, 50);
});

test("ask: no answer in 30 days unsubscribes; an answer keeps them", () => {
  const d = model({ subs: [
    sub("silent@x.gr", { at: ago(900), conf: ago(900), ask: ago(31), m: ago(31) }),
    sub("waiting@x.gr", { at: ago(900), conf: ago(900), ask: ago(10), m: ago(10) }),
    sub("answered@x.gr", { at: ago(900), conf: ago(20), ask: ago(31), m: ago(20) })
  ] });
  assert.equal(C.askTimeouts(d, "list-1", NOW), 1);
  const st = (e) => C.status(C.sub(d, C.subId("list-1", e)));
  assert.equal(st("silent@x.gr"), "off");
  assert.equal(st("waiting@x.gr"), "on");
  assert.equal(st("answered@x.gr"), "on");
  assert.equal(C.askTimeouts(d, "list-1", NOW), 0, "once");
  // 90 days later the clean-up deletes them like anyone who left
  assert.deepEqual(emails(C.cleanPlan(d, "list-1", NOW + 91 * DAY).gone), ["silent@x.gr"]);
});

test("ask: the e-mail (EN and EL) offers the confirm reply and names the 30 days", () => {
  const R = require("../newsletter/render.js");
  const l = C.normList(LIST);
  const en = R.askEmail({ list: l, sub: { name: "Maria K" }, lang: "en", mailbox: "me@example.com", tok: "nl-abc", confirm: "mailto:me@example.com?subject=confirm%20nl-abc" });
  assert.equal(en.subject, "Do you still want Friends?");
  assert.match(en.text, /Hello Maria,/);
  assert.match(en.text, /within 30 days/);
  assert.match(en.text, /subject: confirm nl-abc/);
  assert.match(en.html, /mailto:me@example\.com\?subject=confirm%20nl-abc/);
  const el = R.askEmail({ list: l, sub: null, lang: "el", mailbox: "me@example.com", tok: "nl-abc", confirm: "mailto:x" });
  assert.match(el.subject, /^Θέλεις να συνεχίσεις να λαμβάνεις το Friends;$/);
  assert.match(el.text, /30 ημέρες/);
});

test("engine: the clean-up device sends “Stay?”, records it and the answer keeps them", async () => {
  const lists = [Object.assign({}, LIST, { clnDev: "devaaa1" })];
  const S = await sandbox(model({ lists, subs: idlePeople(2) }));
  await S.run(12);
  assert.deepEqual(S.sent.map((m) => m.to).sort(), ["old000@x.gr", "old001@x.gr"]);
  assert.match(S.sent[0].raw, /confirm nl-/);
  let out = C.normalize(S.read());
  assert.ok(C.subsOf(out, "list-1").every((s) => s.ask > NOW - 60000), "asked");
  await S.run(6);
  assert.equal(S.sent.length, 2, "not asked again");
  // their reply ("confirm <token>") keeps them on the list
  const s0 = C.subsOf(out, "list-1").find((s) => s.email === "old000@x.gr");
  const tally = { u: 0, s: 0, c: 0, b: 0 };
  const d = S.E.read();
  assert.equal(S.E.applyRequest(d, { act: "confirm", tok: C.token(C.list(d, "list-1"), s0.id) }, {}, tally), true);
  assert.equal(tally.k, 1);
  S.E.write(d);
  out = C.normalize(S.read());
  const kept = C.subsOf(out, "list-1").find((s) => s.email === "old000@x.gr");
  assert.ok(kept.conf > kept.ask, "a fresh sign of life");
  S.engine.stop();
  // another device's list: nothing is sent from here
  const S2 = await sandbox(model({ lists: [Object.assign({}, LIST, { clnDev: "devzzz9" })], subs: idlePeople(2) }));
  await S2.run(8);
  assert.equal(S2.sent.length, 0);
  S2.engine.stop();
});

test("engine: a late answer brings back who was unsubscribed for not answering; an unasked confirm does nothing", async () => {
  const S = await sandbox(model({ subs: [
    sub("late@x.gr", { at: ago(900), conf: ago(900), ask: ago(40), off: ago(9), offSt: "off", m: ago(9) }),
    sub("plain@x.gr", { at: ago(900), conf: ago(900), m: ago(900) }),
    sub("left@x.gr", { at: ago(900), conf: ago(900), off: ago(9), offSt: "off", m: ago(9) })
  ] }));
  S.engine.stop();
  const d = S.E.read(), l = C.list(d, "list-1");
  const tok = (e) => C.token(l, C.subId("list-1", e));
  const tally = { u: 0, s: 0, c: 0, b: 0 };
  assert.equal(S.E.applyRequest(d, { act: "confirm", tok: tok("late@x.gr") }, {}, tally), true);
  assert.equal(C.status(C.sub(d, C.subId("list-1", "late@x.gr"))), "on");
  assert.equal(S.E.applyRequest(d, { act: "confirm", tok: tok("plain@x.gr") }, {}, tally), false);
  assert.equal(S.E.applyRequest(d, { act: "confirm", tok: tok("left@x.gr") }, {}, tally), false, "who left on their own stays out");
});

test("engine: the daily run unsubscribes who did not answer and says so", async () => {
  const S = await sandbox(model({ lists: [Object.assign({}, LIST, { clnDev: "devaaa1" })],
    subs: [sub("silent@x.gr", { at: ago(900), conf: ago(900), ask: ago(31), m: ago(31) }), sub("on@x.gr", { at: ago(10), conf: ago(10), m: ago(10) })] }));
  S.engine.stop();
  const res = await S.E.runClean();
  assert.equal(res.length, 1);
  assert.equal(res[0].off, 1);
  assert.equal(res[0].pend + res[0].gone, 0);
  assert.equal(C.status(C.sub(C.normalize(S.read()), C.subId("list-1", "silent@x.gr"))), "off");
});
