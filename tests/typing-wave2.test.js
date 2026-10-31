// Typing Tutor wave 2: texts, My texts slice, adaptive practice, Today,
// Habits, reminder and search (OROS_BIBLE.md Part I, R5/R17/R26).
// Run: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const C = require("../typing/core.js");
const K = require("../typing/layouts.js");
const CO = require("../typing/course.js");
const TX = require("../typing/texts.js");
const D = require("../typing/due.js");
const TODAY = require("../typing/today.js");
const SEARCH = require("../typing/search.js");

const src = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const DAY = 864e5;
const T0 = new Date(2026, 9, 31, 20).getTime();
const seq = (n) => CO.rng(n * 7919 + 1);

test("library: every passage types on its own layout, with author, work and year", () => {
  const ids = new Set();
  for (const x of TX.LIB) {
    assert.ok(!ids.has(x.id), "unique id " + x.id);
    ids.add(x.id);
    assert.ok(K.LAYOUT_IDS.includes(x.l));
    assert.ok(x.a && x.w && x.y > 1700 && x.y < 1956, x.id + " is old enough to be public domain");
    const c = TX.clean(x.l, x.t);
    assert.equal(c.dropped, 0, x.id + " loses no character");
    for (const ch of Array.from(c.text)) assert.ok(K.strokes(x.l, ch), x.id + ": '" + ch + "' is typeable");
  }
  for (const l of K.LAYOUT_IDS) assert.ok(TX.library(l).length >= 4, l + " has passages");
});

test("clean: quotes, dashes and line breaks become plain, the rest is dropped and counted", () => {
  assert.deepEqual(TX.clean("en", "“Hi” — it’s\nfine… ☺"), { text: "\"Hi\" - it's fine...", dropped: 1 });
  assert.deepEqual(TX.clean("el", "«Ναι»· είπε"), { text: "\"Ναι\", είπε", dropped: 0 });
  assert.equal(TX.clean("en", "café").text, "cafe", "an accent the layout lacks falls back to the letter");
  assert.equal(TX.clean("de", "Straße über").text, "Straße über");
  assert.equal(TX.clean("el", "abc").dropped, 3);
});

test("parts: long texts split after a sentence, nothing lost, short tails join", () => {
  const long = TX.LIB.find((x) => x.id === "en-gettysburg").t;
  const ps = TX.parts(long);
  assert.ok(ps.length >= 2);
  assert.equal(ps.join(" ").replace(/\s+/g, " "), long.replace(/\s+/g, " "));
  ps.slice(0, -1).forEach((p) => assert.ok(Array.from(p).length <= TX.PART));
  assert.deepEqual(TX.parts("short text"), ["short text"]);
  assert.deepEqual(TX.parts(""), []);
});

test("My texts: add, delete, merge symmetric, idempotent and associative", () => {
  let a = TX.emptyMine();
  const r1 = TX.addMine(a, "Poem", "Σα βγεις στον πηγαιμό", T0, seq(1));
  a = r1.data;
  assert.match(r1.id, /^t[a-z0-9]{10}$/);
  const r2 = TX.addMine(TX.emptyMine(), "", "Line one\r\nline two", T0 + 5, seq(2));
  const b = r2.data;
  assert.equal(b.items[0].t, "Line one\nline two");
  assert.equal(TX.titleOf(b.items[0]), "Line one line two");
  const c = TX.removeMine(a, r1.id, T0 + 10);
  const ab = TX.serializeMine(TX.mergeMine(a, b));
  assert.equal(ab, TX.serializeMine(TX.mergeMine(b, a)));
  assert.equal(TX.serializeMine(TX.mergeMine(JSON.parse(ab), b)), ab);
  assert.equal(TX.serializeMine(TX.mergeMine(TX.mergeMine(a, b), c)), TX.serializeMine(TX.mergeMine(a, TX.mergeMine(b, c))));
  const m = TX.mergeMine(TX.mergeMine(a, b), c);
  assert.deepEqual(m.items.map((x) => x.id), [r2.id], "the delete wins over the older text");
  // a newer edit of the same id comes back after the delete
  const back = TX.mergeMine(m, { items: [{ id: r1.id, m: T0 + 20, n: "Poem", t: "again" }] });
  assert.ok(TX.mineById(back, r1.id));
  // empty and broken input
  assert.equal(TX.addMine(a, "x", "   ", T0, seq(3)).id, "");
  assert.deepEqual(TX.normMine({ items: [{ id: "bad", m: 1, t: "x" }, { id: "tabcde", m: 0, t: "x" }, "x"], tombs: { "!": 5 } }),
    { ver: 1, items: [], tombs: {} });
});

test("My texts: at most 50, the newest stay on every device", () => {
  let d = TX.emptyMine();
  for (let i = 0; i < 55; i++) d = TX.addMine(d, "n" + i, "text " + i, T0 + i, seq(i + 10)).data;
  assert.equal(d.items.length, 50);
  assert.ok(!d.items.some((x) => x.n === "n0"));
  assert.ok(d.items.some((x) => x.n === "n54"));
});

test("practice: only learned keys, the weak ones first, same seed same text", () => {
  for (const lay of K.LAYOUT_IDS) {
    const up = CO.indexOf("t3");
    const ok = CO.allowed(lay, up);
    const letters = Object.keys(ok).filter((c) => /\p{Ll}/u.test(c));
    const weakOne = letters[3];
    const ks = {};
    letters.forEach((c) => { ks[c] = { r: 50, w: 0, ms: 50 * 200 }; });
    ks[weakOne] = { r: 30, w: 20, ms: 30 * 200 };
    assert.equal(CO.weak(lay, ks, up, 5)[0], weakOne, lay + ": the most wrong key comes first");
    const p = CO.practice(lay, ks, up, 9);
    assert.equal(p.keys[0], weakOne);
    assert.deepEqual(CO.practice(lay, ks, up, 9), p);
    assert.ok(p.text.length >= 200);
    for (const ch of Array.from(p.text)) assert.ok(ok[ch], lay + ": '" + ch + "' was learned");
    assert.ok(p.text.split(weakOne).length - 1 >= 8, lay + ": the weak key comes up often");
  }
  // no stats yet: still a round from the learned letters
  const fresh = CO.practice("en", {}, 0, 1);
  assert.ok(fresh.text.length > 100);
  for (const ch of Array.from(fresh.text)) assert.ok(CO.allowed("en", 0)[ch]);
});

test("due: minutes from every device, reset rows left out, the goal from the settings", () => {
  let d = C.setPrefs(C.empty(), { goal: 15 }, T0 - 3 * DAY);
  d = C.record(d, { lay: "el", chars: 100, errors: 0, ms: 5 * 60000, keys: {} }, T0, "aaa");
  d = C.record(d, { lay: "el", chars: 100, errors: 0, ms: 4 * 60000, keys: {} }, T0 + 1000, "bbb");
  const sum = D.read(JSON.stringify(d));
  assert.equal(sum.goal, 15);
  assert.equal(D.minutes(sum, D.ymd(T0)), 9);
  assert.ok(D.active(sum, T0 + 6 * DAY));
  assert.ok(!D.active(sum, T0 + 7 * DAY));
  const reset = C.resetProgress(d, T0 + 2000);
  assert.deepEqual(D.read(reset).days, {});
  assert.deepEqual(D.read("not json"), { goal: 10, days: {} });
});

test("due: the reminder comes once a day after its time while the goal is not reached", () => {
  let d = C.record(C.empty(), { lay: "en", chars: 50, errors: 0, ms: 3 * 60000, keys: {} }, T0, "aaa");
  const sum = D.read(d);
  const at = new Date(T0); at.setHours(19, 0, 0, 0);
  assert.equal(D.reminderDue(sum, null, at.getTime()), null, "off at first");
  assert.equal(D.reminderDue(sum, { on: true, at: "21:00" }, at.getTime()), null, "not before its time");
  assert.deepEqual(D.reminderDue(sum, JSON.stringify({ on: true }), at.getTime()), { key: "practice-" + D.ymd(T0), n: 3, g: 10 });
  d = C.record(d, { lay: "en", chars: 50, errors: 0, ms: 8 * 60000, keys: {} }, T0 + 1000, "aaa");
  assert.equal(D.reminderDue(D.read(d), { on: true }, at.getTime()), null, "goal reached");
  const txt = D.reminderText(3, 10, "el");
  assert.equal(txt.title, "Τυφλό σύστημα");
  assert.match(txt.body, /3 από 10/);
});

test("Today: a row while the goal is not reached and only for someone who practises", () => {
  const ctx = (raw, now) => ({ today: "2026-10-31", now, lang: "en", readRaw: () => raw });
  global.TypingDue = D;
  try {
    assert.deepEqual(TODAY.collect(ctx(null, T0)), []);
    const d = C.record(C.empty(), { lay: "en", chars: 50, errors: 0, ms: 4 * 60000, keys: {} }, T0, "aaa");
    const rows = TODAY.collect(ctx(JSON.stringify(d), T0));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, "Practise typing: 4 of 10 minutes today");
    assert.deepEqual(rows[0].target, { home: 1 });
    assert.deepEqual(TODAY.collect(ctx(JSON.stringify(d), T0 + 9 * DAY)), [], "not practised in a week");
  } finally { delete global.TypingDue; }
});

test("Habits feed: minutes a day, done when the goal is reached", () => {
  assert.equal(D.feedDays(null), null);
  let d = C.setPrefs(C.empty(), { goal: 5 }, T0 - DAY * 3);
  d = C.record(d, { lay: "en", chars: 50, errors: 0, ms: 6 * 60000, keys: {} }, T0 - DAY, "aaa");
  d = C.record(d, { lay: "en", chars: 50, errors: 0, ms: 2 * 60000, keys: {} }, T0, "aaa");
  const f = D.feedDays(JSON.stringify(d));
  const y = D.ymd(T0 - DAY), t = D.ymd(T0);
  const dash = (k) => k.slice(0, 4) + "-" + k.slice(4, 6) + "-" + k.slice(6);
  assert.deepEqual(f.days, { [dash(y)]: true });
  assert.deepEqual(f.vals, { [dash(y)]: 6, [dash(t)]: 2 });
  assert.equal(f.goal, 5);
  assert.match(D.FEED.id, /^[a-z0-9-]{1,30}$/);
  assert.match(D.FEED.color, /^#[0-9a-f]{6}$/);
  assert.ok(D.FEED.icon.startsWith("<svg"));
});

test("search: My texts by title and body, deleted ones left out", () => {
  const data = { items: [{ id: "tabc12", m: 5, n: "Poem", t: "Σα βγεις\nστον πηγαιμό" }, { id: "tdel99", m: 5, n: "Gone", t: "x" }],
    tombs: { tdel99: 6 } };
  const hits = SEARCH.search({ readJSON: () => data });
  assert.deepEqual(hits, [{ id: "text:tabc12", title: "Poem", text: "Σα βγεις στον πηγαιμό", target: { text: "m:tabc12" } }]);
  assert.deepEqual(SEARCH.search({ readJSON: () => null }), []);
});

test("wiring: shell reminder, notifications toggle, Habits feed, Send to, deep links", () => {
  assert.match(src("shell.js"), /tickSafe\("typingCheckTick"/);
  assert.match(src("shell.js"), /ns: "typing", key: due\.key/);
  assert.match(src("index.html"), /<script src="typing\/due\.js\?v=/);
  assert.match(src("notifications.js"), /KNOWN_APPS = \[[^\]]*'typing'/);
  assert.match(src("habits/index.html"), /<script src="\.\.\/typing\/due\.js\?v=[^"]*"><\/script>\s*\n[\s\S]*habits\.js/);
  const app = src("typing/app.js");
  for (const k of ["target.addText", "target.practice", "target.text", "target.home", "registerSlice(\"typingtexts\""]) assert.ok(app.includes(k), k);
  // user text only through textContent
  assert.ok(!/innerHTML\s*=(?!\s*ICON[.[])/.test(app), "innerHTML only for the app's own icons");
});
