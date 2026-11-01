// Typing Tutor wave 3: kids mode, Letter rain, Certificates link,
// pet cheer, more words (OROS_BIBLE.md Part III Typing Tutor).
// Run: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const C = require("../typing/core.js");
const K = require("../typing/layouts.js");
const W = require("../typing/words.js");
const CO = require("../typing/course.js");
const R = require("../typing/rain.js");
const CC = require("../certificates/core.js");

const src = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const T0 = new Date(2026, 10, 1, 18).getTime();

test("words: kids' words exist and type on their own layout", () => {
  for (const l of ["el", "en", "de"]) {
    assert.ok(W.KIDS[l].length >= 50, l + " has kids' words");
    assert.ok(new Set(W.WORDS[l]).size >= 650, l + " has a bigger word list");
    for (const w of W.KIDS[l]) for (const ch of Array.from(w.normalize("NFC"))) assert.ok(K.strokes(l, ch), l + ": '" + w + "' is typeable");
  }
});

test("kids lessons: shorter, only learned keys, no sentences, same seed same text", () => {
  for (const l of ["el", "en", "de"]) {
    for (const x of CO.lessons(l)) {
      const ok = CO.allowed(l, CO.indexOf(x.id));
      const kid = CO.build(l, x.id, 5, { kid: true });
      assert.equal(CO.build(l, x.id, 5, { kid: true }), kid);
      assert.ok(kid.length >= 60 && kid.length <= CO.KID_TARGET + 60, l + " " + x.id + ": " + kid.length + " characters");
      assert.ok(kid.length < CO.build(l, x.id, 5).length, l + " " + x.id + " is shorter than the grown-up lesson");
      for (const ch of Array.from(kid)) assert.ok(ok[ch], l + " " + x.id + ": '" + ch + "' was learned");
    }
    // the final text: kids' words, no sentence (no full stop after a word)
    const fin = CO.build(l, "f1", 3, { kid: true });
    const kw = new Set(W.KIDS[l].map((w) => w.normalize("NFC")));
    assert.ok(fin.split(" ").filter((w) => kw.has(w)).length >= 5, l + ": the final text uses kids' words");
    assert.ok(!/\p{L}\. \p{Lu}/u.test(fin), l + ": no sentences");
  }
});

test("kids stars: accuracy only (85 / 92 / 97), grown-up stars unchanged", () => {
  assert.equal(C.stars(3, 84, true), 0);
  assert.equal(C.stars(3, 85, true), 1);
  assert.equal(C.stars(3, 92, true), 2);
  assert.equal(C.stars(3, 97, true), 3);
  assert.equal(C.stars(3, 97), 1, "a grown-up needs speed for more stars");
  let d = C.record(C.empty(), { lay: "en", lesson: "h1", kid: 1, chars: 97, errors: 3, ms: 120000, keys: {} }, T0, "aaa");
  assert.equal(C.progress(d, "en", "h1").s, 3);
  d = C.record(C.empty(), { lay: "en", lesson: "h1", chars: 97, errors: 3, ms: 120000, keys: {} }, T0, "aaa");
  assert.equal(C.progress(d, "en", "h1").s, 1);
  // the setting syncs like the others
  const k = C.setPrefs(C.empty(), { kid: 1 }, T0);
  assert.equal(C.merge(C.empty(), k).set.kid, 1);
});

test("Letter rain: learned letters only, home row before the first lesson", () => {
  const up = CO.indexOf("t2");
  const ok = CO.allowed("el", up);
  const ls = R.letters("el", up);
  assert.ok(ls.length >= 8);
  ls.forEach((c) => assert.ok(ok[c] && /\p{Ll}/u.test(c)));
  assert.deepEqual(R.letters("en", -1), ["a", "d", "f", "g", "h", "j", "k", "l", "s"]);
});

test("Letter rain: letters fall, a hit takes the lowest, a miss costs a life, three end it", () => {
  const g = R.create(["a", "s"], 7, false);
  R.step(g, 16);
  assert.equal(g.items.length, 1, "the first letter comes at once");
  const ch = g.items[0].ch;
  // same seed, same game
  const g2 = R.create(["a", "s"], 7, false);
  R.step(g2, 16);
  assert.deepEqual(g2.items, g.items);
  // a wrong key counts, takes nothing
  assert.equal(R.hit(g, ch === "a" ? "s" : "a"), null);
  assert.equal(g.wrong, 1);
  assert.equal(R.hit(g, ch).ch, ch);
  assert.equal(g.score, 1);
  assert.equal(g.items.length, 0);
  // no hits: letters reach the bottom one after another
  let lost = 0, n = 0;
  while (!g.over && n++ < 10000) lost += R.step(g, 100).length;
  assert.ok(g.over);
  assert.equal(g.lives, 0);
  assert.equal(lost, 3);
  assert.deepEqual(R.step(g, 100), [], "a finished game does not move");
  assert.equal(R.hit(g, "a"), null);
});

test("Letter rain: the lowest copy goes, levels every 10, faster and denser, kids slower", () => {
  const g = R.create(["a"], 1, false);
  g.items = [{ id: 1, ch: "a", x: 0.5, y: 0.2 }, { id: 2, ch: "a", x: 0.4, y: 0.7 }];
  g.nextAt = 1e9;
  assert.equal(R.hit(g, "a").id, 2);
  for (let i = 0; i < 9; i++) { g.items.push({ id: 10 + i, ch: "a", x: 0, y: 0 }); R.hit(g, "a"); }
  assert.equal(g.score, 10);
  assert.equal(g.level, 2);
  assert.ok(R.speed(2) > R.speed(1));
  assert.ok(R.gap(2) < R.gap(1));
  assert.ok(R.speed(1, true) < R.speed(1));
  assert.ok(R.gap(1, true) > R.gap(1));
  assert.ok(R.speed(99) <= 0.35 && R.gap(99) >= 500, "speed and gap have limits");
});

test("Certificates: the newEvent target fills the New dialog and creates nothing", () => {
  const cs = src("certificates/certificates.js");
  const i = cs.indexOf("tg.newEvent");
  assert.ok(i > 0);
  const block = cs.slice(i, cs.indexOf("typeof tg.ev !== \"string\"", i));
  assert.match(block, /openNew\(\)/);
  assert.match(block, /C\.KINDS\.indexOf\(tg\.newEvent\.kind\)/);
  assert.ok(!/createEvent|blankEvent|save/.test(block), "nothing is created or saved");
  assert.ok(CC.KINDS.includes("kids") && CC.KINDS.includes("complete"));
});

test("wiring: kids mode, Letter rain, certificate and pet in the app", () => {
  const app = src("typing/app.js");
  const html = src("typing/index.html");
  for (const k of ["CO.build(lay(), id, seed, { kid: isKid() })", "rec.kid = 1", "data-kid", "target.rain",
    "__orosOpenAt(\"certificates\", { newEvent: { kind: isKid() ? \"kids\" : \"complete\"", "orosPet.line(\"speech.happy\")",
    "installed(\"certificates\")", "installed(\"typewriter\")", "screen === \"rain\" ? rainChar : typeChar"]) assert.ok(app.includes(k), k);
  // the typing field sits outside the screens, so Letter rain can use it
  assert.ok(html.indexOf('id="cap"') > html.indexOf("</main>"));
  assert.match(html, /<script src="rain\.js\?v=[^"]+"><\/script>/);
  assert.ok(html.indexOf("rain.js") > html.indexOf("course.js") && html.indexOf("rain.js") < html.indexOf("app.js"));
  // user text only through textContent
  assert.ok(!/innerHTML\s*=(?!\s*ICON[.[])/.test(app));
  // help in every language
  for (const f of ["typing/help.en.txt", "typing/help.el.txt", "i18n/de/help/typing.txt"]) assert.match(src(f), /app:certificates/, f);
});
