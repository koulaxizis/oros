// Flashcards wave 4: cards from other apps' text (make.js), the
// "cards waiting" summary (core.dueSummary + due.js), the Today row and
// the study reminder wiring.
// Run: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const C = require("../flashcards/core.js");
const F = require("../flashcards/fsrs.js");
const M = require("../flashcards/make.js");
const D = require("../flashcards/due.js");
const P = require("../flashcards/today.js");

const ROOT = path.join(__dirname, "..");
const src = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

// ---------- make.js ----------
test("lines with :: and :::, highlights, cloze lines and headings become cards", () => {
  const text = [
    "# Spanish",
    "- hola :: hello",
    "- adiós ::: goodbye",
    "The ==sun== is a ==star==.",
    "## Verbs",
    "ser = to be",
    "estar = to be (state)",
    "",
    "# Places",
    "{{c1::Athens}} is in Greece",
    "# Nothing under this heading"
  ].join("\n");
  const r = M.fromText(text, "Lesson");
  assert.equal(r.guess, false);
  assert.deepEqual(r.cards, [
    { k: "basic", f: { q: "hola", a: "hello" } },
    { k: "rev", f: { q: "adiós", a: "goodbye" } },
    { k: "cloze", f: { x: "The {{c1::sun}} is a {{c2::star}}.", e: "Spanish" } },
    { k: "basic", f: { q: "Verbs", a: "ser = to be\nestar = to be (state)" } },
    { k: "cloze", f: { x: "{{c1::Athens}} is in Greece", e: "Places" } }
  ]);
  // Every card found is a card the app can save.
  r.cards.forEach((c) => {
    const v = C.normNote({ id: "n1", m: 1, k: c.k, f: c.f });
    assert.ok(v && C.ords(v).length >= 1, JSON.stringify(c));
  });
  assert.deepEqual(C.ords(C.normNote({ id: "n1", m: 1, k: "cloze", f: r.cards[2].f })), [1, 2]);
});

test("colons without a space, times and empty sides are not split", () => {
  assert.equal(M.splitLine("key::value"), null);
  assert.equal(M.splitLine("At 10::30"), null);
  assert.equal(M.splitLine("Note ::"), null);
  assert.equal(M.splitLine(":: answer"), null);
  assert.equal(M.splitLine("{{c1::x}} :: y"), null);
  assert.deepEqual(M.splitLine("1. Capital of France :: Paris"), { q: "Capital of France", a: "Paris", rev: false });
  assert.deepEqual(M.splitLine("dog ::cat"), { q: "dog", a: "cat", rev: false });
  assert.equal(M.highlightCloze("no marks == here"), "");
  assert.equal(M.highlightCloze("a ==b== c"), "a {{c1::b}} c");
  assert.equal(M.highlightCloze("x ==a}}b== y"), "", "a highlight that would break the gap stays text");
});

test("plain text without any rule: one card to shape, title on the front", () => {
  const r = M.fromText("Just some text\nmore", "My page");
  assert.equal(r.guess, true);
  assert.deepEqual(r.cards, [{ k: "basic", f: { q: "My page", a: "Just some text\nmore" } }]);
  assert.deepEqual(M.fromText("   \n ", "T").cards, []);
  assert.equal(M.fromTarget({ text: "  " }), null);
});

test("tables: row 1 is the heading row, the first two cells make the card", () => {
  const r = M.fromRows([["Word", "Meaning"], ["perro", "dog"], ["", ""], ["", "gato", 3], ["solo"]]);
  assert.deepEqual(r.cards, [{ k: "basic", f: { q: "perro", a: "dog" } }, { k: "basic", f: { q: "gato", a: "3" } }]);
  assert.deepEqual(M.fromRows([["perro", "dog"]]).cards, [{ k: "basic", f: { q: "perro", a: "dog" } }], "one row only: it is the card");
  assert.deepEqual(M.fromTarget({ title: "W", rows: [["a", "b"], ["c", "d"]] }), { title: "W", cards: [{ k: "basic", f: { q: "c", a: "d" } }], guess: false });
});

test("hostile or odd targets: no crash, caps hold, duplicates once", () => {
  for (const bad of [null, 1, "x", [], { text: 5 }, { rows: "x" }, { rows: [null, 5, [{}]] }, { text: null, title: {} }]) {
    assert.equal(M.fromTarget(bad), null, JSON.stringify(bad));
  }
  const many = Array.from({ length: 900 }, (_, i) => "q" + i + " :: a" + i).join("\n");
  assert.equal(M.fromText(many).cards.length, M.MAX_CARDS);
  assert.equal(M.fromText("a :: b\na :: b\nA :: b").cards.length, 2);
  const big = M.fromText("q :: " + "x".repeat(50000));
  assert.equal(big.cards[0].f.a.length, 20000);
  assert.ok(!/[\u0000-\u0008]/.test(M.fromText("a\u0001b :: c").cards[0].f.q));
  assert.doesNotMatch(src("flashcards/make.js"), /innerHTML|document\.|localStorage|fetch\(/);
});

// ---------- dueSummary + due.js ----------
function deckWithCards(now) {
  const slice = C.addDeck(C.addDeck(C.empty(), "Words", now - 1e6, { id: "d1", cfg: { nd: 3, rd: 100 } }), "Sub", now - 1e6, { id: "d2", par: "d1" });
  const notes = C.foldNotes({}, [
    { id: "n1", m: 1, k: "rev", dk: "d1", f: { q: "a", a: "b" } },
    { id: "n2", m: 1, k: "basic", dk: "d2", f: { q: "c", a: "d" } },
    { id: "n3", m: 1, k: "basic", dk: "d1", f: { q: "e", a: "f" } },
    { id: "n4", m: 1, k: "basic", dk: "d1", f: { q: "g", a: "h" } },
    { id: "n5", m: 1, k: "basic", dk: "gone", f: { q: "i", a: "j" } }
  ]);
  return { slice, notes };
}

test("dueSummary: today's counts follow the deck limits, later days count reviews", () => {
  const now = new Date(2026, 9, 17, 12).getTime();
  const { slice, notes } = deckWithCards(now);
  let revs = [];
  let s = C.dueSummary(slice, C.schedule(slice, notes, revs, F), revs, now);
  assert.equal(s.day, "2026-10-17");
  // d1 tree: 5 new cards, 3 a day, one per note → 3; orphan deck (d0) adds 1.
  assert.deepEqual([s.n, s.rv, s.nd, s.fresh], [4, 0, 3 + 20, 6]);
  assert.deepEqual(s.days, {});
  // n3 answered Good twice earlier: a review some days ahead.
  const t0 = now - 3 * 86400000;
  revs = C.mergeReviews(revs, [{ i: "ra", c: "n3.0", t: t0, g: 3 }, { i: "rb", c: "n3.0", t: t0 + 600000, g: 3 }]);
  const sched = C.schedule(slice, notes, revs, F, { fuzz: false });
  s = C.dueSummary(slice, sched, revs, now);
  const due = sched["n3.0"].card.due;
  if (due >= C.dayEnd(now, slice.set.ro)) {
    assert.equal(s.days[C.ymdOf(C.dayStart(due, slice.set.ro))], 1);
  } else {
    assert.equal(s.rv, 1);
  }
  // Suspended cards are never waiting.
  revs = C.mergeReviews(revs, [{ i: "rc", c: "n5.0", t: now - 1, f: "s" }]);
  s = C.dueSummary(slice, C.schedule(slice, notes, revs, F), revs, now);
  assert.equal(s.fresh, 4);
  // The summary is what due.js reads.
  const back = D.read(JSON.stringify(s));
  assert.equal(back.day, s.day);
  assert.equal(D.count(back, s.day), s.n + s.rv);
});

test("due.js: count on the day, later days and before; junk reads as nothing", () => {
  const sum = D.read({ v: 1, at: 5, day: "2026-10-17", n: 4, rv: 2, nd: 10, fresh: 3, days: { "2026-10-18": 5, "2026-10-20": 1, bad: 9 } });
  assert.equal(D.count(sum, "2026-10-17"), 6);
  assert.equal(D.count(sum, "2026-10-18"), 2 + 5 + 3, "left over + due that day + new cards (fewer than the limit)");
  assert.equal(D.count(sum, "2026-10-21"), 2 + 6 + 3);
  assert.equal(D.count(sum, "2026-10-16"), 0);
  assert.equal(D.count(null, "2026-10-17"), 0);
  assert.ok(!("bad" in sum.days));
  for (const bad of ["", "nope", "{}", "{\"v\":2,\"day\":\"2026-10-17\"}", "{\"v\":1,\"day\":\"17/10\"}"]) assert.equal(D.read(bad), null, bad);
  assert.deepEqual(D.read({ v: 1, day: "2026-10-17", n: -3, rv: "x", nd: 1e99, days: [] }), { v: 1, at: 0, day: "2026-10-17", n: 0, rv: 0, nd: 10000000, fresh: 0, days: {} });
});

test("the study reminder: off by default, from the chosen time on, once a day while cards wait", () => {
  const sum = D.read({ v: 1, day: "2026-10-17", n: 1, rv: 0, nd: 5, fresh: 1, days: {} });
  const at = (h, m) => new Date(2026, 9, 17, h, m).getTime();
  assert.deepEqual(D.readRem(null), { on: false, at: "19:00" });
  assert.deepEqual(D.readRem("{\"on\":true,\"at\":\"25:00\"}"), { on: true, at: "19:00" });
  assert.equal(D.reminderDue(sum, null, at(20, 0)), null, "off by default");
  assert.equal(D.reminderDue(sum, { on: true, at: "19:00" }, at(18, 59)), null);
  assert.deepEqual(D.reminderDue(sum, { on: true, at: "19:00" }, at(19, 0)), { key: "study-2026-10-17", n: 1 });
  assert.deepEqual(D.reminderDue(sum, "{\"on\":true,\"at\":\"07:30\"}", at(23, 59)), { key: "study-2026-10-17", n: 1 });
  assert.equal(D.reminderDue(D.read({ v: 1, day: "2026-10-17", days: {} }), { on: true }, at(20, 0)), null, "nothing waiting");
  assert.deepEqual(D.reminderText(1, "en"), { title: "Flashcards", body: "1 card is waiting for you today." });
  assert.equal(D.reminderText(12, "el").body, "12 κάρτες σε περιμένουν σήμερα.");
});

test("Today: one row while cards wait, read-only", () => {
  const raw = JSON.stringify({ v: 1, day: "2026-10-17", n: 3, rv: 2, nd: 5, fresh: 3, days: {} });
  const ctx = (today, lang) => ({ today, lang, readRaw: (k) => (k === D.KEY ? raw : null) });
  globalThis.FlashcardsDue = D;
  try {
    assert.deepEqual(P.collect(ctx("2026-10-17", "en")), [{ id: "due-2026-10-17", due: "2026-10-17", kind: "task", title: "5 cards to study", target: { home: 1 } }]);
    assert.deepEqual(P.collect(ctx("2026-10-16", "en")), []);
    assert.deepEqual(P.collect({ today: "2026-10-17", lang: "en", readRaw: () => null }), []);
  } finally { delete globalThis.FlashcardsDue; }
  assert.deepEqual(P.keys, ["oros-flashcards-due"]);
  assert.doesNotMatch(src("flashcards/today.js") + src("flashcards/due.js"), /setItem|removeItem|fetch\(|innerHTML/);
});

test("wiring: apps.json, precache, shell reminder, notification toggle, deep link", () => {
  const apps = JSON.parse(src("apps.json"));
  const list = Array.isArray(apps) ? apps : apps.apps;
  const fc = list.find((a) => a.id === "flashcards");
  assert.deepEqual(fc.today, ["due.js", "today.js"]);
  const sw = src("sw.js");
  for (const f of ["make.js", "due.js", "today.js"]) assert.match(sw, new RegExp("\"flashcards/" + f.replace(".", "\\.") + "\""));
  assert.match(src("index.html"), /<script src="flashcards\/due\.js\?v=[\d.]+"><\/script>/);
  const shell = src("shell.js");
  assert.match(shell, /tickSafe\("flashcardsCheckTick", flashcardsCheckTickThrottled\)/);
  assert.match(shell, /ns: "flashcards", key: due\.key/);
  assert.match(src("notifications.js"), /KNOWN_APPS = \[[^\]]*'flashcards'/);
  const html = src("flashcards/index.html");
  assert.ok(html.indexOf("make.js") > 0 && html.indexOf("due.js") > 0 && html.indexOf("due.js") < html.indexOf("app.js"));
  const app = src("flashcards/app.js");
  assert.match(app, /target\.make/);
  assert.match(app, /writeLS\(D\.KEY/);
  assert.match(app, /writeLS\(D\.REM_KEY/);
});
