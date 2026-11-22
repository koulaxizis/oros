// Layout: text and styles (LY-W5): Find/Change in text and GREP mode,
// ready-made and saved queries, a style's next style, GREP styles in
// the layout engine, and every string in English, Greek and German.
// Run: node --test tests/layout-findchange.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const F = require(path.join(ROOT, "layout/findchange.js"));
const T = require(path.join(ROOT, "designkit/text.js"));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

const LYJS = read("layout/layout.js");
const EL_AT = LYJS.indexOf('"home.new": "Νέο έγγραφο"');
function table(part) {
  const out = {}, re = /"([a-z][a-zA-Z0-9.]*)": "((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(part))) if (!(m[1] in out)) out[m[1]] = JSON.parse('"' + m[2] + '"');
  return out;
}
const EN = table(LYJS.slice(0, EL_AT)), EL = table(LYJS.slice(EL_AT));
const DE = table(read("i18n/de/layout.js"));

function doc() {
  return {
    pages: [{ id: "p1", pos: 0 }, { id: "p2", pos: 1 }],
    items: [{ t: "text", story: "s2", pg: "p2", x: 0, y: 0 }, { t: "text", story: "s1", pg: "p1", x: 0, y: 0 }],
    stories: [
      { id: "s2", paras: [{ ps: "ps-body", runs: [{ t: "Δεύτερη  σελίδα." }] }] },
      { id: "s1", paras: [
        { ps: "ps-body", runs: [{ t: "Hello  world " }, { t: "bold", b: 1 }, { t: ' end "quoted"...' }] },
        { ps: "ps-h", runs: [{ t: "Page " }, { f: "pn" }, { t: " of  x" }] }
      ] }
    ]
  };
}
const flat = (p) => F.paraText(p);

test("find/change: compile, text and GREP, case and whole word", () => {
  assert.equal(F.compile({ find: "" }).error, "empty");
  assert.equal(F.compile({ find: "x".repeat(501) }).error, "long");
  assert.equal(F.compile({ find: "(", grep: 1 }).error, "bad");
  assert.equal(F.compile({ find: "a*", grep: 1 }).error, "empty", "a pattern that matches nothing at all");
  // text mode escapes
  assert.ok(F.compile({ find: "a.b" }).re.test("a.b"));
  assert.ok(!F.compile({ find: "a.b" }).re.test("axb"));
  // case
  assert.ok(F.compile({ find: "ΑΛΦΑ" }).re.test("άλφα") === false, "accents count");
  assert.ok(F.compile({ find: "ΑΛΦΑ" }).re.test("αλφα"));
  assert.ok(!F.compile({ find: "ΑΛΦΑ", cs: 1 }).re.test("αλφα"));
  // whole word, letters of any script
  const w = F.compile({ find: "νερό", word: 1 }).re;
  assert.ok(w.test("το νερό."));
  w.lastIndex = 0;
  assert.ok(!w.test("νερόμυλος"));
});

test("find/change: hits in reading order, a style filter, one story", () => {
  const d = doc();
  const h = F.search(d, { find: "  " });
  assert.deepEqual(h.map((x) => [x.sid, x.p, x.s]), [["s1", 0, 5], ["s1", 1, 9], ["s2", 0, 7]], "page 1's story first");
  assert.equal(F.search(d, { find: "  ", ps: "ps-h" }).length, 1);
  assert.equal(F.search(d, { find: "  " }, { sid: "s2" }).length, 1);
  assert.equal(F.search(d, { find: "  " }, { max: 2 }).length, 2);
  assert.equal(F.paraText(d.stories[1].paras[1]), "Page ￼ of  x", "a field is one character");
});

test("find/change: change all keeps formats, skips fields, ready-made clean-ups", () => {
  const d = doc();
  const pre = (id) => F.PRESETS.filter((p) => p.id === id)[0];
  let r = F.change(d, pre("dblspace"), pre("dblspace").change);
  assert.equal(r.n, 3);
  assert.deepEqual(r.stories.sort(), ["s1", "s2"]);
  assert.equal(flat(d.stories[1].paras[0]), 'Hello world bold end "quoted"...');
  assert.ok(d.stories[1].paras[0].runs.some((x) => x.t === "bold" && x.b === 1), "bold stays bold");
  r = F.change(d, pre("quotes"), pre("quotes").change);
  r = F.change(d, pre("dots"), pre("dots").change);
  assert.equal(flat(d.stories[1].paras[0]), "Hello world bold end «quoted»…");
  // a hit over a field is left
  r = F.change(d, { find: "Page ￼" }, "X");
  assert.equal(r.n, 0);
  assert.ok(d.stories[1].paras[1].runs.some((x) => x.f === "pn"));
  assert.equal(F.change(doc(), pre("spacepunct"), "$1").n, 0);
  const sp = { stories: [{ id: "a", paras: [{ ps: "p", runs: [{ t: "Λοιπόν , ναι !" }] }] }], items: [], pages: [] };
  F.change(sp, pre("spacepunct"), pre("spacepunct").change);
  assert.equal(flat(sp.stories[0].paras[0]), "Λοιπόν, ναι!");
  const dash = { stories: [{ id: "a", paras: [{ ps: "p", runs: [{ t: "α - β " }] }] }], items: [], pages: [] };
  F.change(dash, pre("dash"), pre("dash").change);
  F.change(dash, pre("trail"), pre("trail").change);
  assert.equal(flat(dash.stories[0].paras[0]), "α – β");
});

test("find/change: groups, a new paragraph, styles on the change, one hit", () => {
  const d = { stories: [{ id: "a", paras: [{ ps: "p", ext: { k: 1 }, runs: [{ t: "Κεφάλαιο 3: Η θάλασσα" }] }] }], items: [], pages: [] };
  const r = F.change(d, { find: "(Κεφάλαιο \\d+): ", grep: 1 }, "$1\\n", { ps: "ps-h" });
  assert.equal(r.n, 1);
  const ps = d.stories[0].paras;
  assert.equal(ps.length, 2);
  assert.equal(flat(ps[0]), "Κεφάλαιο 3");
  assert.equal(flat(ps[1]), "Η θάλασσα");
  assert.ok(ps.every((p) => p.ps === "ps-h" && p.ext && p.ext.k === 1));
  // in text mode \n is just text, $& the found text
  assert.equal(F.expand("[$&]\\n$$", ["x"], false), "[x]\\n$");
  assert.equal(F.expand("$2-$1\\t", ["ab", "a", "b"], true), "b-a\t");
  // a character style on the changed text; keep = format only
  const c = { stories: [{ id: "a", paras: [{ ps: "p", runs: [{ t: "τα 12 και 345" }] }] }], items: [], pages: [] };
  F.change(c, { find: "\\d+", grep: 1 }, "", { csTo: "cs-num", keep: 1 });
  assert.deepEqual(c.stories[0].paras[0].runs.map((x) => [x.t, x.cs || ""]), [["τα ", ""], ["12", "cs-num"], [" και ", ""], ["345", "cs-num"]]);
  // only one hit
  const o = { stories: [{ id: "a", paras: [{ ps: "p", runs: [{ t: "a a a" }] }] }], items: [], pages: [] };
  assert.equal(F.change(o, { find: "a" }, "b", { only: { sid: "a", p: 0, s: 2 } }).n, 1);
  assert.equal(flat(o.stories[0].paras[0]), "a b a");
});

test("find/change: saved queries are checked", () => {
  assert.deepEqual(F.normQueries(null), []);
  const q = F.normQueries([{ find: "x", change: 5, grep: "yes" }, { find: "" }, null, { name: "N".repeat(80), find: "\\d", change: "#", cs: 1, word: 1 }]);
  assert.deepEqual(q[0], { name: "x", find: "x", change: "", grep: 1, cs: 0, word: 0 });
  assert.equal(q[1].name.length, 60);
  assert.equal(q.length, 2);
  assert.equal(F.normQueries(new Array(50).fill({ find: "a" })).length, 30);
  F.PRESETS.forEach((p) => assert.ok(!F.compile(p).error, p.id));
});

test("GREP styles: matches take the character style in the layout", () => {
  const rules = [{ re: "\\d+", cs: "cs-num" }, { re: "[Α-Ω]{2,}", cs: "cs-cap" }];
  assert.deepEqual(T.grepRuns([{ t: "ΝΙΚΟΣ έχει 12" }], rules), [{ t: "ΝΙΚΟΣ", cs: "cs-cap" }, { t: " έχει " }, { t: "12", cs: "cs-num" }]);
  // a run with its own character style keeps it; bad rules are left out
  assert.deepEqual(T.grepRuns([{ t: "1" }, { t: "2", cs: "own" }], [{ re: "\\d", cs: "c" }, { re: "(", cs: "x" }, { re: "a*", cs: "y" }]), [{ t: "1", cs: "c" }, { t: "2", cs: "own" }]);
  assert.deepEqual(T.grepRuns([{ t: "abc" }], [{ re: "b", cs: "1" }, { re: "bc", cs: "2" }]), [{ t: "a" }, { t: "b", cs: "2" }, { t: "c", cs: "2" }], "a later rule wins");
  const ps = T.resolvePs({ "ps-a": { id: "ps-a", ext: { grep: [{ re: "\\d+", cs: "c" }, { re: "x".repeat(201), cs: "c" }, { re: "y" }] } } }, "ps-a");
  assert.deepEqual(ps.grep, [{ re: "\\d+", cs: "c" }]);
  const L = T.layoutChain({ paras: [{ ps: "p", runs: [{ t: "Room 42 now" }] }] }, [{ id: "a", w: 400, h: 60 }],
    { ps: [{ id: "p", m: 1, name: "P", font: "serif", size: 12, ext: { grep: [{ re: "\\d+", cs: "cs-b" }] } }], cs: [{ id: "cs-b", m: 1, name: "B", b: 1 }] });
  const runs = L.frames.a.lines.reduce((a, l) => a.concat(l.runs), []);
  assert.ok(runs.some((r) => r.t === "42" && r.key === "serif-b"), JSON.stringify(runs.map((r) => [r.t, r.key])));
  assert.ok(runs.some((r) => r.t === "Room" && r.key === "serif-r"));
});

test("next style: Enter at the end of a paragraph takes it", () => {
  const story = read("layout/story.js");
  assert.ok(/function nextPs\(id\)/.test(story));
  assert.ok(story.includes('text === "\\n" && !tail.some('), "only Enter at the end, never a paste");
  assert.ok(read("layout/panels.js").includes("st.ext.next = v"));
  assert.ok(read("layout/inframe.js").includes('insert("\\n")'), "in-frame Enter goes through insertAt");
});

test("W5: every string in English, Greek and German", () => {
  const src = read("layout/findui.js") + read("layout/panels.js");
  const keys = new Set();
  const re = /\bt\("([a-z][a-zA-Z0-9.]*)"(?! \+)/g;
  let m;
  while ((m = re.exec(src))) if (/^(fc|sp)\.|^sty\.(grep|next)|^more\.(find|spell)$/.test(m[1])) keys.add(m[1]);
  F.PRESETS.forEach((p) => keys.add("fc.pre." + p.id));
  ["fc.n", "fc.nMany", "ka.find", "ka.spell"].forEach((k) => keys.add(k));
  assert.ok(keys.size > 60, String(keys.size));
  keys.forEach((k) => {
    assert.ok(EN[k], "EN " + k);
    assert.ok(EL[k], "EL " + k);
    assert.ok(DE[k], "DE " + k);
    const ph = (s) => (s.match(/\{[a-z]+\}/g) || []).sort().join();
    assert.equal(ph(EL[k]), ph(EN[k]), "EL placeholders " + k);
    assert.equal(ph(DE[k]), ph(EN[k]), "DE placeholders " + k);
  });
});

test("W5: wired into Layout", () => {
  const html = read("layout/index.html"), sw = read("sw.js");
  assert.ok(html.indexOf("findchange.js") > 0 && html.indexOf("findchange.js") < html.indexOf('"layout.js'), "findchange.js before layout.js (saved queries)");
  assert.ok(html.indexOf("findui.js") > html.indexOf("comfort.js"));
  assert.ok(sw.includes('"layout/findchange.js"') && sw.includes('"layout/findui.js"'));
  assert.ok(read("layout/smart.js").includes('["find", "Mod+KeyF"]'));
  assert.ok(read("layout/findui.js").includes('new Worker("../writer/spell-worker.js")'), "Writer's dictionaries");
  assert.ok(!html.includes("writer/spell.js"), "spell.js loads on first use (start-up budget)");
});
