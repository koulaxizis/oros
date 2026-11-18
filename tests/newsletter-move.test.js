// Newsletter MV-1 (2026-11, moving from another platform): the domain
// check inside the pre-send Check, one-click unsubscribe from creation
// (the one-time offer), the hosting-mail preset, the moving checklist and
// the previous platform's figures (newsletter/core.js; the UI parts are
// checked by reading newsletter/newsletter.js).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const C = require("../newsletter/core.js");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const NOW = Date.UTC(2026, 10, 18, 12);
const LIST = { id: "list-1", m: 1, name: "News", chan: "chan-1", from: "me@example.com", lang: "en", addr: "Street 1", salt: "abcdefgh12" };
const CHAN = { id: "chan-1", m: 1, kind: "smtp", preset: "other", host: "smtp.example.com", port: 587, user: "me@example.com", rate: 6, cap: 450 };
function issue(id, extra) {
  return Object.assign({ id, m: 1, list: "list-1", subj: "Hello", fmt: "md", md: "Some text", st: "draft" }, extra || {});
}
function data(extra) {
  return C.normalize(Object.assign({ ver: 1, chans: [CHAN], lists: [LIST], subs: [], issues: [issue("iss-1")], supp: [] }, extra || {}));
}
const INFO = { chan: C.normChan(CHAN), inbox: true, imgBytes: 0, aud: 3, relay: false, now: NOW };

test("domFindings: missing SPF / DMARC warn, unreadable DNS warns, never an error", () => {
  assert.deepEqual(C.domFindings(null), []);
  assert.deepEqual(C.domFindings({ spf: "v=spf1 -all", dmarc: "v=DMARC1; p=none", dkim: "" }), []);
  assert.deepEqual(C.domFindings({ spf: "", dmarc: "", dkim: "s1" }).map((r) => r.k), ["noSpf", "noDmarc"]);
  assert.deepEqual(C.domFindings({ fail: true }), [{ lvl: "warn", k: "domUnread" }]);
  [{ spf: "", dmarc: "" }, { fail: true }].forEach((rec) => {
    assert.ok(C.domFindings(rec).every((r) => r.lvl === "warn"));
  });
  assert.equal(C.DNS_TTL, 864e5);
});

test("preflight carries the domain check and still allows sending", () => {
  const d = data();
  const x = C.issue(d, "iss-1");
  const plain = C.preflight(d, x, INFO);
  assert.deepEqual(plain.filter((r) => r.lvl === "err"), []);
  const res = C.preflight(d, x, Object.assign({}, INFO, { dom: { spf: "", dmarc: "", dkim: "" } }));
  assert.deepEqual(res.filter((r) => r.lvl === "err"), []);
  assert.ok(res.some((r) => r.k === "noSpf" && r.lvl === "warn"));
  assert.ok(res.some((r) => r.k === "noDmarc" && r.lvl === "warn"));
  const unread = C.preflight(d, x, Object.assign({}, INFO, { dom: { fail: true } }));
  assert.ok(unread.some((r) => r.k === "domUnread"));
  assert.deepEqual(unread.filter((r) => r.lvl === "err"), []);
});

test("firstSend: no issue of the list went out from orOS yet (imported ones don't count)", () => {
  assert.equal(C.firstSend(data(), issue("iss-1")), true);
  const imp = data({ issues: [issue("iss-1"), issue("old-1", { st: "sent", imp: 1, done: NOW - 5 })] });
  assert.equal(C.firstSend(imp, C.issue(imp, "iss-1")), true);
  const sent = data({ issues: [issue("iss-1"), issue("iss-2", { st: "sent", start: NOW - 9, done: NOW - 5 })] });
  assert.equal(C.firstSend(sent, C.issue(sent, "iss-1")), false);
  // another list's issue doesn't count
  const other = data({ lists: [LIST, Object.assign({}, LIST, { id: "list-2", salt: "zzzzzzzz12" })],
                       issues: [issue("iss-1"), issue("iss-3", { list: "list-2", st: "sent", done: NOW })] });
  assert.equal(C.firstSend(other, C.issue(other, "iss-1")), true);
});

test("oneClickOffers: lists without the relay registration whose offer was never answered", () => {
  const d = data({ lists: [LIST, Object.assign({}, LIST, { id: "list-2", salt: "zzzzzzzz12", ocAsk: NOW })] });
  assert.deepEqual(C.oneClickOffers(d).map((l) => l.id), ["list-1"]);
  assert.equal(C.normList(Object.assign({}, LIST, { ocAsk: NOW })).ocAsk, NOW);
  assert.equal("ocAsk" in C.normList(LIST), false);
});

test("one-click at creation: a new list registers with the relay, turning the form off sets ocAsk", () => {
  const ui = read("newsletter/newsletter.js"), en = read("newsletter/engine.js");
  assert.match(ui, /if \(!l\) E\.formOn\(rec\.id, ""\)/);
  assert.match(en, /y\.form = null;\s*\n\s*if \(!y\.ocAsk\) y\.ocAsk = Date\.now\(\);/);
});

test("hosting preset: generic, slow defaults, host from the user name", () => {
  assert.deepEqual(C.PRESETS.hosting, { host: "", port: 465, rate: 10, cap: 300 });
  assert.equal(C.hostingHost("Me@Example.ORG", ""), "mail.example.org");
  assert.equal(C.hostingHost("someone", "news@shop.example.net"), "mail.shop.example.net");
  assert.equal(C.hostingHost("someone", ""), "");
  assert.equal(C.hostingHost("a@localhost", ""), "");
  const ch = C.normChan({ id: "chan-2", kind: "smtp", preset: "hosting", host: "mail.example.org", port: 465, user: "me@example.org", rate: 10, cap: 300 });
  assert.equal(ch.preset, "hosting");
  assert.equal(ch.sec, C.SECS[465]);
  ["en", "el"].forEach(() => assert.match(read("newsletter/newsletter.js"), /"p\.hosting": /));
});

test("moving checklist: ticks are letters a–h, kept in order, scalars an older orOS keeps", () => {
  assert.deepEqual(C.MOVE_STEPS, ["a", "b", "c", "d", "e", "f", "g", "h"]);
  assert.equal(C.normMove("hzca!"), "ach");
  assert.equal(C.normMove(5), "");
  const l = C.normList(Object.assign({}, LIST, { mv: "ca" }));
  assert.equal(l.mv, "ac");
  assert.equal(C.moveTick(l, "b", true), "abc");
  assert.equal(C.moveTick(l, "a", false), "c");
  assert.equal(C.moveTick(l, "x", true), "ac");
  assert.equal("mv" in C.normList(Object.assign({}, LIST, { mv: "" })), false);
  // a list from a newer orOS keeps them on a save here, and the merge keeps them
  const d = C.mergeNewsletter(data({ lists: [Object.assign({}, LIST, { m: 5, mv: "ab" })] }), data());
  assert.equal(C.list(d, "list-1").mv, "ab");
});

test("previous platform's figures: percent with one decimal, note, nothing when empty", () => {
  assert.equal(C.pct("32,54%"), 32.5);
  assert.equal(C.pct(0), 0);
  assert.equal(C.pct(101), null);
  assert.equal(C.pct("x"), null);
  assert.equal(C.pct(-1), null);
  const l = C.normList(Object.assign({}, LIST, { pvOpen: 41.26, pvClick: "3.9", pvUnsub: 0.2, pvNote: "  average\nof 12 sends " }));
  assert.equal(l.pvOpen, 41.3);
  assert.equal(l.pvClick, 3.9);
  assert.equal(l.pvUnsub, 0.2);
  assert.equal(l.pvNote, "average of 12 sends");
  assert.deepEqual(C.prevFigures(l), { open: 41.3, click: 3.9, unsub: 0.2, note: "average of 12 sends" });
  assert.equal(C.prevFigures(C.normList(LIST)), null);
  assert.deepEqual(C.prevFigures(C.normList(Object.assign({}, LIST, { pvUnsub: 0 }))), { open: undefined, click: undefined, unsub: 0, note: "" });
  assert.deepEqual(C.PREV_KEYS, ["pvOpen", "pvClick", "pvUnsub"]);
});

test("every new string exists in English, Greek and German", () => {
  const ui = read("newsletter/newsletter.js"), de = read("i18n/de/newsletter.js");
  const keys = ["p.hosting", "ch.hostingHint", "ck.noSpf", "ck.noDmarc", "ck.domUnread", "ck.domFirst", "oc.offer", "oc.later",
    "mv.btn", "mv.title", "mv.hint", "mv.goChan", "mv.goTest", "mv.goIssue", "pf.title", "pf.hint", "pf.open", "pf.click",
    "pf.unsub", "pf.note", "pf.notePh", "pf.here"].concat(C.MOVE_STEPS.reduce((a, k) => a.concat(["mv." + k, "mv." + k + "Hint"]), []));
  keys.forEach((k) => {
    assert.equal(ui.split('"' + k + '": ').length - 1, 2, k + " in EN and EL");
    assert.ok(de.indexOf('"' + k + '": ') >= 0, k + " in DE");
  });
  // placeholders match across languages
  assert.match(ui, /"ck\.domFirst": "[^"]*\{d\}[^"]*",[^\n]*/);
  assert.match(de, /"ck\.domFirst": "[^"]*\{d\}/);
  assert.match(de, /"pf\.here": "[^"]*\{u\}/);
});

test("no tracking: the domain check goes to DNS-over-HTTPS only, nothing per reader", () => {
  const ui = read("newsletter/newsletter.js");
  assert.match(ui, /var DNS_KEY = "oros-newsletter-dns";/);
  assert.doesNotMatch(ui, /\/nl\/c\//);
});

// ---------- W2: the pop-up sign-up snippet ----------
const POP_LIST = Object.assign(C.normList(Object.assign({}, LIST, { lang: "el", color: "#AA3300" })),
  { form: { k: "abcdefghij012345" } });
const WORDS = { title: "Stay <close> & \"well\"", text: "News now and then", email: "Your e-mail", name: "Your name", btn: "Subscribe", close: "Close" };

test("popupHtml: the relay form as an accessible pop-up, words escaped", () => {
  assert.equal(C.popupHtml(C.normList(LIST), "https://relay.example", WORDS), "");
  const h = C.popupHtml(POP_LIST, "https://relay.example", WORDS, { delay: 5, days: 7 });
  assert.match(h, /^<div id="onl-abcdefghij012345" hidden role="dialog" aria-modal="true" aria-labelledby="onl-abcdefghij012345-t" lang="el">/);
  assert.match(h, /<form method="post" action="https:\/\/relay\.example\/nl\/s\/abcdefghij012345">/);
  assert.match(h, /<input type="hidden" name="lang" value="el">/);
  assert.match(h, /name="website" tabindex="-1"/);                         // the same honeypot
  assert.match(h, /<label for="onl-abcdefghij012345-e">Your e-mail<\/label>/);
  assert.match(h, /aria-label="Close"/);
  assert.match(h, /Stay &lt;close&gt; &amp; &quot;well&quot;/);
  assert.doesNotMatch(h, /<close>/);
  assert.match(h, /setTimeout\(show,5000\)/);
  assert.match(h, /D=7,/);
  assert.match(h, /"Escape"/);
  assert.match(h, /"Tab"/);
  assert.match(h, /prefers-color-scheme:dark/);
  assert.match(h, /background:#aa3300/);
  assert.ok(h.length < 4096, "small: " + h.length);
});

test("popupHtml: no cookies, no third parties, unknown options fall back", () => {
  const h = C.popupHtml(POP_LIST, "https://relay.example", WORDS, { delay: 7, days: 1000 });
  assert.doesNotMatch(h, /cookie/i);
  assert.doesNotMatch(h, /fetch\(|XMLHttpRequest|sendBeacon|<img|<iframe|src=/);
  const urls = h.match(/https?:\/\/[^"'\s)]+/g);
  assert.deepEqual(urls, ["https://relay.example/nl/s/abcdefghij012345"]);
  assert.match(h, /setTimeout\(show,20000\)/);
  assert.match(h, /D=30,/);
  assert.deepEqual(C.POP_DELAYS, [0, 5, 10, 20, 30, 60]);
  assert.deepEqual(C.POP_DAYS, [1, 7, 30, 90]);
  assert.match(C.popupHtml(POP_LIST, "https://relay.example", WORDS, { delay: 0 }), /setTimeout\(show,0\)/);
  // without a text there is no empty paragraph
  assert.doesNotMatch(C.popupHtml(POP_LIST, "https://relay.example", Object.assign({}, WORDS, { text: "" })), /<p><\/p>/);
});

test("pop-up strings exist in English, Greek and German", () => {
  const ui = read("newsletter/newsletter.js"), de = read("i18n/de/newsletter.js");
  ["fm.pop", "fm.popHint", "fm.popDelay", "fm.popDelayN", "fm.popNow", "fm.popDays", "fm.popDaysN", "fm.popDay1", "fm.popTitle",
   "fm.popText", "fm.popHtml", "pop.title", "pop.text", "pop.close"].forEach((k) => {
    assert.equal(ui.split('"' + k + '": ').length - 1, 2, k + " in EN and EL");
    assert.ok(de.indexOf('"' + k + '": ') >= 0, k + " in DE");
  });
});
