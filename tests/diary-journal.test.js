// One-Sentence Diary wave 30: the longer entry (core.js: long,
// prompts, merge per field), journal.js (safe Markdown, prompts and
// templates, Open-Meteo URLs and parsing, the PIN hash, the book
// days), the search provider and the wiring.
// Run: node --test tests/*.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const { webcrypto } = require("crypto");

const C = require(path.join(__dirname, "..", "diary/core.js"));
const J = require(path.join(__dirname, "..", "diary/journal.js"));
const P = require(path.join(__dirname, "..", "diary/search.js"));
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

const T0 = 1760000000000;
const OLD = { ver: 1, days: { "2026-10-01": { t: "A quiet day.", e: "😊", m: T0 } }, tombs: {} };

test("old data loads unchanged: no long, no prompts keys", () => {
  const m = C.mergeDiary(OLD, OLD);
  assert.deepEqual(m, OLD);
  assert.equal("long" in m, false);
  assert.equal("prompts" in m, false);
  assert.deepEqual(C.longOf(m, "2026-10-01"), { md: "", ph: [], loc: null, wx: null });
  assert.equal(C.hasLong(m, "2026-10-01"), false);
});

test("setLong: one field at a time, stamps move forward, empty is a no-op", () => {
  let d = C.setLong(OLD, "2026-10-01", "md", "# Hi\r\nthere  ", T0 + 5);
  assert.equal(C.longOf(d, "2026-10-01").md, "# Hi\nthere");
  assert.equal(d.long["2026-10-01"].md.m, T0 + 5);
  const same = C.setLong(d, "2026-10-01", "md", "# Hi\nthere", T0 + 9);
  assert.deepEqual(same, d, "same value: unchanged");
  const back = C.setLong(d, "2026-10-01", "md", "x", T0 + 1);     // a clock behind
  assert.equal(back.long["2026-10-01"].md.m, T0 + 6, "never older than before");
  assert.deepEqual(C.setLong(OLD, "2026-10-02", "md", "", T0), C.mergeDiary(OLD, null), "nothing to clear");
  assert.deepEqual(C.setLong(OLD, "bad", "md", "x", T0), OLD);
  d = C.setLong(d, "2026-10-01", "loc", { n: " Thessaloniki\n", la: 40.63647, lo: 22.94422 }, T0 + 7);
  assert.deepEqual(C.longOf(d, "2026-10-01").loc, { n: "Thessaloniki", la: 40.64, lo: 22.94 }, "coarse coordinates");
  d = C.setLong(d, "2026-10-01", "wx", { c: 61, hi: 18.44, lo: 11, junk: 1 }, T0 + 7);
  assert.deepEqual(C.longOf(d, "2026-10-01").wx, { c: 61, hi: 18.4, lo: 11 });
  d = C.setLong(d, "2026-10-01", "ph", ["20261001-abcdef12.jpg", "../evil.jpg", "20261001-abcdef12.jpg"], T0 + 7);
  assert.deepEqual(C.longOf(d, "2026-10-01").ph, ["20261001-abcdef12.jpg"]);
  assert.ok(C.hasLong(d, "2026-10-01"));
});

test("mergeLong: per field LWW, commutative, idempotent, absent side keeps", () => {
  const a = C.setLong(OLD, "2026-10-01", "md", "from A", T0 + 10);
  let b = C.setLong(OLD, "2026-10-01", "md", "from B", T0 + 5);
  b = C.setLong(b, "2026-10-01", "loc", { n: "Volos" }, T0 + 6);
  const ab = C.mergeDiary(a, b), ba = C.mergeDiary(b, a);
  assert.deepEqual(ab, ba);
  assert.deepEqual(C.mergeDiary(ab, ab), ab);
  assert.equal(C.longOf(ab, "2026-10-01").md, "from A", "newer text wins");
  assert.deepEqual(C.longOf(ab, "2026-10-01").loc, { n: "Volos" }, "the place from the other device stays");
  assert.deepEqual(C.mergeDiary(ab, OLD), ab, "an old device (no long key) never deletes");
  // same stamp: the same pick on both sides
  const x = C.setLong(OLD, "2026-10-01", "md", "x", T0), y = C.setLong(OLD, "2026-10-01", "md", "y", T0);
  assert.deepEqual(C.mergeDiary(x, y), C.mergeDiary(y, x));
  // a cleared field is a newer value, not a lost one
  const cl = C.setLong(ab, "2026-10-01", "md", "", T0 + 20);
  assert.equal(C.longOf(C.mergeDiary(cl, a), "2026-10-01").md, "");
});

test("prompts: own questions merge LWW per id with soft delete", () => {
  let d = C.setPrompt(OLD, "p-abcd1", "  What made you laugh?  ", false, T0);
  assert.deepEqual(C.livePrompts(d), [{ id: "p-abcd1", t: "What made you laugh?" }]);
  const del = C.setPrompt(d, "p-abcd1", "", true, T0 + 1);
  assert.deepEqual(C.livePrompts(del), []);
  assert.deepEqual(C.livePrompts(C.mergeDiary(del, d)), [], "a stale copy never brings it back");
  assert.deepEqual(C.mergeDiary(del, d), C.mergeDiary(d, del));
  assert.deepEqual(C.setPrompt(OLD, "p-abcd1", "   ", false, T0), C.mergeDiary(OLD, null), "an empty question is not added");
  assert.equal(C.mergeDiary({ ver: 1, days: {}, tombs: {}, prompts: { "BAD ID!": { t: "x", m: 1 } } }, null).prompts, undefined);
});

test("photos: safe names and paths only", () => {
  assert.equal(C.photoName("2026-10-01", "AbC-def12"), "20261001-abcdef12.jpg");
  assert.equal(C.photoName("2026-10-01", "ab"), null);
  assert.equal(C.photoName("nope", "abcdef12"), null);
  assert.equal(C.photoPath("20261001-abcdef12.jpg"), "/internal/Diary/Photos/20261001-abcdef12.jpg");
  for (const bad of ["../x.jpg", "20261001-abcdef12.png", "a/20261001-abcdef12.jpg", null]) assert.equal(C.photoPath(bad), null, String(bad));
  let d = C.setLong(OLD, "2026-10-01", "ph", ["20261001-aaaaaa.jpg"], T0);
  d = C.setLong(d, "2026-10-02", "ph", ["20261002-bbbbbb.jpg"], T0);
  assert.deepEqual(C.photosOf(d).sort(), ["20261001-aaaaaa.jpg", "20261002-bbbbbb.jpg"]);
  const many = ["a", "b", "c", "d", "e"].map((c) => "20261001-" + c.repeat(6) + ".jpg");
  assert.equal(C.longOf(C.setLong(OLD, "2026-10-01", "ph", many, T0), "2026-10-01").ph.length, C.PH_MAX);
});

test("search: the longer entry and its place are found", () => {
  let d = C.setLong(OLD, "2026-10-01", "md", "We walked to the **lighthouse**.", T0);
  d = C.setLong(d, "2026-10-03", "loc", { n: "Kavala" }, T0);
  d = C.setLong(d, "2026-10-03", "md", "Only a long entry here", T0);
  assert.deepEqual(C.search(d, "lighthouse").map((o) => o.ymd), ["2026-10-01"]);
  const k = C.search(d, "kavala");
  assert.equal(k[0].ymd, "2026-10-03");
  assert.ok(k[0].t.includes("Only a long entry"));
});

test("Markdown: allow-listed blocks and runs; unsafe links stay text", () => {
  const b = J.parseMd("# Title\n\nSome **bold** and *it* and `x<y`\n- one\n2. two\n> quote\n---");
  assert.deepEqual(b.map((x) => x.t), ["h", "p", "li", "li", "q", "hr"]);
  assert.deepEqual(b[1].runs, [{ s: "Some " }, { s: "bold", b: true }, { s: " and " }, { s: "it", i: true }, { s: " and " }, { s: "x<y", c: true }]);
  assert.equal(b[3].n, 2);
  const l = J.parseMd("[ok](https://example.org/a_(b)) [bad](javascript:alert(1)) [d](data:text/html,x) [m](mailto:a@b.c)")[0].runs;
  assert.deepEqual(l.filter((r) => r.href).map((r) => r.href), ["https://example.org/a_(b)", "mailto:a@b.c"]);
  assert.ok(!l.some((r) => /javascript|data:/.test(r.href || "")));
  assert.ok(!J.runsText(l).includes(")"), "no stray brackets");
  assert.equal(J.safeUrl("JaVaScRiPt:alert(1)"), null);
  assert.equal(J.safeUrl("https://x.org/\"onmouseover=1"), null);
  assert.equal(J.plain("# A\n\n**b** c"), "A\nb c");
  // raw HTML is only ever text
  assert.deepEqual(J.parseMd("<img src=x onerror=alert(1)>")[0].runs, [{ s: "<img src=x onerror=alert(1)>" }]);
});

test("prompts and templates: EN and EL, stable per day, own questions join", () => {
  assert.ok(J.PROMPTS.en.length >= 20 && J.PROMPTS.el.length === J.PROMPTS.en.length);
  const a = J.dailyPrompt("2026-10-14", "en", [], 0), b = J.dailyPrompt("2026-10-14", "en", [], 0);
  assert.deepEqual(a, b);
  assert.notDeepEqual(J.dailyPrompt("2026-10-14", "en", [], 1), a, "another question");
  assert.ok(J.PROMPTS.el.includes(J.dailyPrompt("2026-10-14", "el", [], 0).t));
  const own = [{ id: "p-1111", t: "Mine?" }];
  assert.equal(J.promptPool("en", own).length, J.PROMPTS.en.length + 1);
  for (const id of J.TEMPLATE_IDS) for (const lang of ["en", "el"]) {
    const tp = J.template(id, lang);
    assert.ok(tp && tp.name && tp.text, id + " " + lang);
  }
  assert.equal(J.template("nope", "en"), null);
  assert.equal(J.insertBlock("text\n\n", "### Q\n\n"), "text\n\n### Q\n\n");
  assert.equal(J.insertBlock("", "  ### Q"), "### Q");
  assert.equal(J.questionBlock(" What\nnow? "), "### What now?\n\n");
});

test("weather: forecast API for recent days, archive for older, parsing", () => {
  const u = J.wxUrl(40.63647, 22.94422, "2026-10-10", "2026-10-14");
  assert.ok(u.startsWith("https://api.open-meteo.com/v1/forecast?latitude=40.64&longitude=22.94&"));
  assert.ok(u.includes("start_date=2026-10-10&end_date=2026-10-10"));
  assert.ok(J.wxUrl(40, 22, "2025-01-10", "2026-10-14").startsWith("https://archive-api.open-meteo.com/v1/archive?"));
  const d = { daily: { time: ["2026-10-10"], weathercode: [61], temperature_2m_max: [18.44], temperature_2m_min: [11.06] } };
  assert.deepEqual(J.parseWx(d, "2026-10-10"), { c: 61, hi: 18.4, lo: 11.1 });
  assert.equal(J.parseWx(d, "2026-10-11"), null);
  assert.equal(J.parseWx({}, "2026-10-10"), null);
  assert.ok(J.geoUrl("Θεσσαλονίκη & co", "el").endsWith("&name=" + encodeURIComponent("Θεσσαλονίκη & co")));
  assert.deepEqual(J.parseGeo({ results: [{ latitude: 40.6401, longitude: 22.9444, name: "Thessaloniki" }] }), { la: 40.64, lo: 22.94, n: "Thessaloniki" });
  assert.equal(J.parseGeo({ results: [] }), null);
  assert.equal(J.wxText(61, "el"), "Βροχή");
  assert.ok(J.wxLine({ c: 0, hi: 20, lo: 10 }, "en", false).includes("20"));
  assert.ok(J.wxLine({ c: 0, hi: 20, lo: 10 }, "en", true).includes("68"), "°F when the Weather app is imperial");
  assert.equal(J.locLine({ n: "Volos", la: 39.36, lo: 22.94 }), "Volos");
  assert.equal(J.locLine(null), "");
});

test("PIN: salted PBKDF2 hash only, right and wrong PINs, growing wait", async () => {
  assert.ok(J.pinOk("1234") && J.pinOk("12345678"));
  for (const bad of ["123", "123456789", "12a4", "", null]) assert.equal(J.pinOk(bad), false, String(bad));
  const rec = await J.makeLock(webcrypto, "2468", 1000);
  assert.deepEqual(Object.keys(rec).sort(), ["h", "it", "s", "v"]);
  assert.ok(!JSON.stringify(rec).includes("2468"), "the PIN itself is never stored");
  assert.equal(await J.checkPin(webcrypto, rec, "2468"), true);
  assert.equal(await J.checkPin(webcrypto, rec, "2469"), false);
  const rec2 = await J.makeLock(webcrypto, "2468", 1000);
  assert.notEqual(rec2.s, rec.s, "a new salt every time");
  assert.notEqual(rec2.h, rec.h);
  assert.equal(J.readLock({ v: 1, s: "x" }), null);
  assert.deepEqual(J.readLock(JSON.parse(JSON.stringify(rec))), rec);
  assert.ok(J.PIN_ITER >= 100000);
  assert.equal(J.lockWait(0), 0);
  assert.equal(J.lockWait(4), 0);
  assert.equal(J.lockWait(5), 15);
  assert.equal(J.lockWait(6), 30);
  assert.equal(J.lockWait(50), 300);
});

test("bookDays: lines and long-only days of a year, in order", () => {
  let d = C.setLong(OLD, "2026-09-30", "md", "long only", T0);
  d = C.setLong(d, "2025-12-31", "md", "last year", T0);
  const days = J.bookDays(d, C, 2026);
  assert.deepEqual(days.map((x) => x.ymd), ["2026-09-30", "2026-10-01"]);
  assert.equal(days[0].t, "");
  assert.equal(days[1].t, "A quiet day.");
  assert.equal(J.bookDays(d, C, 0).length, 3);
});

test("search provider: long text joins, nothing at all with a PIN lock", () => {
  let d = C.setLong(OLD, "2026-10-01", "md", "Walked to the [lighthouse](https://x.org)", T0);
  d = C.setLong(d, "2026-10-05", "md", "Only long", T0);
  const store = { "oros-diary-data": d };
  const ctx = { readJSON: (k) => store[k] || null, lang: "en" };
  const hits = P.search(ctx);
  assert.equal(hits.length, 2);
  assert.ok(hits.find((h) => h.id === "2026-10-01").text.includes("lighthouse"));
  assert.ok(!hits.find((h) => h.id === "2026-10-01").text.includes("https"));
  store["oros-diary-lock"] = { v: 1, s: "abc", h: "def", it: 1000 };
  assert.deepEqual(P.search(ctx), []);
});

test("wiring: journal.js before diary.js; lock key device-local; help honest", () => {
  const html = read("diary/index.html");
  assert.ok(html.indexOf("journal.js") > html.indexOf("core.js") && html.indexOf("journal.js") < html.indexOf("diary.js"));
  const js = read("diary/diary.js");
  assert.ok(!/innerHTML\s*=\s*[^"';]*(md|\.t\b|loc\.n)/.test(js), "user text never goes through innerHTML");
  assert.ok(js.includes('"../vendor/jspdf.umd.min.js"') && js.includes('"../vendor/noto/"'));
  assert.ok(!/https?:\/\/(cdn|unpkg|fonts\.googleapis)/.test(js));
  const core = read("diary/core.js");
  assert.ok(!core.includes("oros-diary-lock"), "the PIN never enters the synced slice");
  for (const f of ["diary/help.en.txt", "diary/help.el.txt"]) {
    const h = read(f);
    assert.ok(/PIN/.test(h));
  }
  assert.ok(/not encryption/i.test(read("diary/help.en.txt")));
  assert.ok(/όχι κρυπτογράφηση/i.test(read("diary/help.el.txt")));
});
