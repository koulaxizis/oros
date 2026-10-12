// Text Tools core: every tool on Greek and English samples, CSV
// quoting, the pipeline, statistics, the recipe merge (symmetric,
// canonical, tombstones) and the recipes file.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../texttools/core.js");

function run1(tool, text, opts) { return T.run(text, [{ tool, opts: opts || {} }]); }
function out(tool, text, opts) { return run1(tool, text, opts).text; }

test("every tool has defaults, fields for each default and a group", () => {
  T.TOOL_IDS.forEach((id) => {
    const t = T.TOOLS[id];
    assert.ok(T.GROUPS.includes(t.g), id);
    Object.keys(t.o).forEach((k) => assert.ok(t.f[k], id + "." + k + " has a field"));
    Object.keys(t.f).forEach((k) => assert.ok(k in t.o, id + "." + k + " has a default"));
    assert.equal(typeof T.run("a\nb\n", [{ tool: id, opts: {} }]).text, "string", id);
  });
});

test("lines: final line break kept, CRLF read as lines", () => {
  assert.equal(out("reverse", "a\r\nb\r\nc\r\n"), "c\nb\na\n");
  assert.equal(out("reverse", "a\nb"), "b\na");
  assert.equal(out("reverse", ""), "");
});

test("sort: Greek alphabet, accents and case ignored, empties last", () => {
  assert.equal(out("sort", "ώρα\nΆλφα\nβήτα\n\nαγάπη\n"), "αγάπη\nΆλφα\nβήτα\nώρα\n\n");
  assert.equal(out("sort", "b\na\nc", { by: "za" }), "c\nb\na");
  assert.equal(out("sort", "file10\nfile2\nfile1", { by: "natural" }), "file1\nfile2\nfile10");
  assert.equal(out("sort", "x 10\ny 2,5\nz\nw -1", { by: "num" }), "w -1\ny 2,5\nx 10\nz");
  assert.equal(out("sort", "ccc\na\nbb", { by: "len" }), "a\nbb\nccc");
  assert.equal(out("sort", "Zeta\nalpha\nBeta"), "alpha\nBeta\nZeta");
  let i = 0;
  const shuffled = T.run("1\n2\n3\n4", [{ tool: "sort", opts: { by: "random" } }], { rand: () => [0.1, 0.9, 0.5][i++ % 3] }).text;
  assert.deepEqual(shuffled.split("\n").sort(), ["1", "2", "3", "4"]);
});

test("dedupe: keep first or last, case / accents / spaces", () => {
  const r = run1("dedupe", "Αθήνα\nαθηνα\n Αθήνα\nΠάτρα\n\n\n");
  assert.equal(r.text, "Αθήνα\nαθηνα\nΠάτρα\n\n\n");
  assert.equal(r.notes[0].n, 1);
  assert.equal(out("dedupe", "Αθήνα\nαθηνα\nΠάτρα", { icase: true, iaccent: true }), "Αθήνα\nΠάτρα");
  assert.equal(out("dedupe", "a\nb\na", { keep: "last" }), "b\na");
  assert.equal(out("dedupe", "a\n\nb\n\n", { empty: true }), "a\n\nb\n");
  assert.equal(out("dedupe", "__proto__\n__proto__\nconstructor"), "__proto__\nconstructor");
});

test("dupes and count", () => {
  assert.equal(out("dupes", "a\nb\na\nc\nb\na"), "a\nb");
  assert.equal(out("count", "apple\npear\napple\n"), "2\tapple\n1\tpear\n");
  assert.equal(out("count", "β\nα\nβ", { order: "az" }), "1\tα\n2\tβ");
  assert.equal(out("count", "x\ny\ny", { order: "first" }), "1\tx\n2\ty");
});

test("empty lines, filter, join, split", () => {
  assert.equal(out("noempty", "a\n \n\nb\n"), "a\nb\n");
  assert.equal(out("squeeze", "a\n\n\n\nb\n \nc"), "a\n\nb\n\nc");
  assert.equal(out("filter", "Apple pie\nbanana\npineapple", { find: "apple" }), "Apple pie\npineapple");
  assert.equal(out("filter", "Apple pie\nbanana\npineapple", { find: "apple", mode: "drop" }), "banana");
  assert.equal(out("filter", "#a\nb#\nc", { find: "#", where: "starts" }), "#a");
  assert.equal(out("filter", "#a\nb#\nc", { find: "#", where: "ends" }), "b#");
  assert.equal(out("filter", "a1\nbb\nc22", { find: "\\d+$", where: "regex" }), "a1\nc22");
  assert.equal(run1("filter", "a", { find: "(", where: "regex" }).notes[0].err, "pattern");
  assert.equal(out("join", "a\nb\n\nc\n"), "a, b, c");
  assert.equal(out("join", "a\nb", { sep: "\\t" }), "a\tb");
  assert.equal(out("split", "a, b,,c"), "a\nb\nc");
  assert.equal(out("split", "a;b", { sep: ";" }), "a\nb");
});

test("spaces: trim, collapse, tabs, unwrap, wrap", () => {
  assert.equal(out("trim", "  a  \n\tb "), "a\nb");
  assert.equal(out("trim", "  a  ", { side: "start" }), "a  ");
  assert.equal(out("trim", "  a  ", { side: "end" }), "  a");
  assert.equal(out("spaces", "  a   b\t\tc"), "  a b c");
  assert.equal(out("spaces", "  a   b", { indent: false }), " a b");
  assert.equal(out("tabs", "\ta\tb", { width: 4 }), "    a   b");
  assert.equal(out("tabs", "        x", { dir: "s2t", width: 4 }), "\t\tx");
  assert.equal(out("unwrap", "one\ntwo\n\nthree\nfour\n"), "one two\n\nthree four\n");
  assert.equal(out("wrap", "aa bb cc dd ee", { width: 10 }), "aa bb cc\ndd ee");
  assert.equal(out("wrap", "short", { width: 10 }), "short");
});

test("clean: invisible characters, nbsp, quotes, dashes, NFC", () => {
  assert.equal(out("clean", "a​b c﻿­"), "ab c");
  assert.equal(out("clean", "“hi” – ‘x’…", { quotes: true, dashes: true }), "\"hi\" - 'x'...");
  assert.equal(out("clean", "ά"), "ά");
  assert.equal(out("eol", "a\nb\r\nc", { to: "crlf" }), "a\r\nb\r\nc");
  assert.equal(out("eol", "a\r\nb\rc"), "a\nb\nc");
});

test("numbering, removing numbers, prefix and suffix", () => {
  assert.equal(out("number", "a\n\nb"), "1. a\n\n2. b");
  assert.equal(out("number", "a\nb", { start: 9, step: 1, pad: 3, style: "paren" }), "009) a\n010) b");
  assert.equal(out("number", "a", { style: "tab" }), "1\ta");
  assert.equal(out("unnumber", "1. a\n2) b\n- c\n• δ\n(3) e\n2024 was\n[x] done"), "a\nb\nc\nδ\ne\n2024 was\ndone");
  assert.equal(out("affix", "a\n\nb", { prefix: "« ", suffix: " »" }), "« a »\n\n« b »");
  assert.equal(out("affix", "a", { prefix: "\\t" }), "\ta");
});

test("CSV: detect, parse with quotes and line breaks, write", () => {
  assert.equal(T.detectDelim("a;b;c\n1;2;3"), ";");
  assert.equal(T.detectDelim("a\tb\n1\t2"), "\t");
  assert.equal(T.detectDelim('"x,y";b\n1;2'), ";");
  assert.deepEqual(T.parseDelimited('a,"b,c","d ""q"""\n"line\nbreak",2', ","),
    [["a", "b,c", 'd "q"'], ["line\nbreak", "2"]]);
  assert.equal(T.writeDelimited([["a", "b;c", 'd"']], ";"), 'a;"b;c";"d"""');
  assert.equal(out("convert", "a,b\n\"x;y\",2\n"), 'a;b\n"x;y";2\n');
  assert.equal(out("convert", "a;b", { to: "tab" }), "a\tb");
  assert.equal(out("convert", "a;b", { to: "custom", toCustom: " :: " }), "a :: b");
  assert.equal(out("convert", "a,b", { to: "comma", quoteAll: true }), '"a","b"');
});

test("columns: keep / reorder / drop, ranges, transpose", () => {
  assert.deepEqual(T.colSpec("3,1, 2-4"), [2, 0, 1, 2, 3]);
  assert.deepEqual(T.colSpec("4-2"), [3, 2, 1]);
  assert.equal(out("columns", "a;b;c\n1;2;3", { cols: "3,1" }), "c;a\n3;1");
  assert.equal(out("columns", "a;b;c\n1;2;3", { cols: "2", mode: "drop" }), "a;c\n1;3");
  assert.equal(run1("columns", "a;b", { cols: "x" }).notes[0].err, "cols");
  assert.equal(out("transpose", "a,b,c\n1,2"), "a,1\nb,2\nc,");
});

test("Markdown table and JSON", () => {
  assert.equal(out("markdown", "Name;Price\nΚαφές;2,5\nA|B;1"),
    "| Name | Price |\n| --- | --- |\n| Καφές | 2,5 |\n| A\\|B | 1 |\n");
  assert.deepEqual(JSON.parse(out("json", "name,name,\nα,1,x")), [{ name: "α", name_2: "1", column3: "x" }]);
  assert.deepEqual(JSON.parse(out("json", "a,b", { header: false })), [["a", "b"]]);
});

test("replace: literal, case, accents, whole word in Greek, patterns", () => {
  let r = run1("replace", "Καλημέρα, καλημερα και ΚΑΛΗΜΕΡΑ", { find: "καλημέρα", repl: "γεια", icase: true, iaccent: true });
  assert.equal(r.text, "γεια, γεια και γεια");
  assert.equal(r.notes[0].n, 3);
  assert.equal(out("replace", "a.b.c", { find: ".", repl: "$&-" }), "a$&-b$&-c");
  assert.equal(out("replace", "γάτα γατάκι", { find: "γάτα", repl: "σκύλος", word: true }), "σκύλος γατάκι");
  assert.equal(out("replace", "cat category", { find: "cat", repl: "dog", word: true }), "dog category");
  assert.equal(out("replace", "2026-10-12", { find: "(\\d+)-(\\d+)-(\\d+)", repl: "$3/$2/$1", regex: true }), "12/10/2026");
  assert.equal(out("replace", "a b", { find: "(?<x>a)", repl: "[$<x>]$$", regex: true }), "[a]$ b");
  assert.equal(out("replace", "a,b", { find: ",", repl: "\\n", regex: true }), "a\nb");
  assert.equal(run1("replace", "x", { find: "[", regex: true }).notes[0].err, "pattern");
  assert.equal(out("replace", "x", { find: "" }), "x");
});

test("pipeline: steps in order, unknown tool noted, bad options fall back", () => {
  const r = T.run("  b\na \n b\n", [
    { tool: "trim", opts: {} }, { tool: "dedupe", opts: {} }, { tool: "nosuch", opts: {} },
    { tool: "sort", opts: { by: "weird" } }, { tool: "number", opts: { pad: 99 } }
  ]);
  assert.equal(r.text, "00000001. a\n00000002. b\n");
  assert.equal(r.notes[2].err, "unknown");
  assert.equal(T.usesPattern({ tool: "replace", opts: { regex: true } }), true);
  assert.equal(T.usesPattern({ tool: "filter", opts: { where: "contains" } }), false);
  assert.equal(T.outKind([{ tool: "convert", opts: { to: "tab" } }]), "tsv");
  assert.equal(T.outKind([{ tool: "markdown", opts: {} }, { tool: "nosuch" }]), "md");
  assert.equal(T.outKind([]), "txt");
});

test("statistics: graphemes, words, sentences, paragraphs", () => {
  const s = T.stats("Γεια σου, κόσμε! Τι κάνεις;\n\nΔεύτερη παράγραφος 👍🏽.\n");
  assert.equal(s.words, 7);
  assert.equal(s.lines, 3);
  assert.equal(s.paras, 2);
  assert.equal(s.sentences, 3);
  assert.equal(s.minutes, 1);
  assert.equal(T.graphemes("ά👍🏽"), 2);
  assert.deepEqual(T.stats(""), { chars: 0, noSpace: 0, words: 0, lines: 0, paras: 0, sentences: 0, minutes: 0, exact: true });
  assert.deepEqual(T.topWords("Τον τόνο, τον ΤΟΝ και άλλο", 2), [{ w: "τον", n: 3 }, { w: "άλλο", n: 1 }]);
});

// ---------- Recipes ----------
const step = (tool, opts) => ({ tool, opts: opts || {} });
const rec = (id, m, name, steps) => ({ id, m, name, steps: steps || [step("trim")] });
const data = (recipes, tombs) => ({ ver: 1, recipes: recipes || [], tombs: tombs || {} });

test("recipes: normalised, invalid ones dropped, unknown options kept", () => {
  const d = T.mergeRecipes(data([
    rec("abc123", 5, "  Clean   list ", [step("trim", { side: "end", future: "x", bad: {} }), step("Bad Tool")]),
    rec("BAD", 1, "x"), rec("abc124", 1, "", [step("trim")]), rec("abc125", 1, "no steps", []),
    { id: "abc126", m: 1.5, name: "x", steps: [step("trim")] }
  ]), null);
  assert.deepEqual(d.recipes, [{ id: "abc123", m: 5, name: "Clean list", steps: [{ tool: "trim", opts: { future: "x", side: "end" } }] }]);
});

test("recipes merge: LWW, symmetric, canonical, tombstones", () => {
  const A = data([rec("aaaaaa", 5, "A1"), rec("bbbbbb", 3, "B")]);
  const B = data([rec("aaaaaa", 7, "A2"), rec("cccccc", 1, "C")], { bbbbbb: 3 });
  const ab = T.mergeRecipes(A, B), ba = T.mergeRecipes(B, A);
  assert.equal(JSON.stringify(ab), JSON.stringify(ba));
  assert.deepEqual(ab.recipes.map((r) => r.name), ["A2", "C"]);
  assert.equal(JSON.stringify(T.mergeRecipes(ab, ab)), JSON.stringify(ab));
  // a newer edit resurrects
  const res = T.mergeRecipes(ab, data([rec("bbbbbb", 4, "B again")]));
  assert.ok(res.recipes.some((r) => r.name === "B again"));
  // equal m: the larger canonical JSON, either way round
  const x = data([rec("dddddd", 9, "X")]), y = data([rec("dddddd", 9, "Y")]);
  assert.equal(JSON.stringify(T.mergeRecipes(x, y)), JSON.stringify(T.mergeRecipes(y, x)));
  assert.equal(T.mergeRecipes(x, y).recipes[0].name, "Y");
});

test("recipes file: export, import validates, wrong files refused", () => {
  const d = data([rec("aaaaaa", 5, "Clean", [step("trim"), step("dedupe", { icase: true })])]);
  const file = T.recipesFile(d, "2026-10-12T10:00:00Z");
  const back = T.parseRecipesFile(file);
  assert.equal(back.ok, true);
  assert.deepEqual(back.recipes, [{ name: "Clean", steps: [{ tool: "trim", opts: {} }, { tool: "dedupe", opts: { icase: true } }] }]);
  assert.equal(T.parseRecipesFile("{").err, "json");
  assert.equal(T.parseRecipesFile('{"app":"wheel","recipes":[]}').err, "kind");
  assert.equal(T.parseRecipesFile('{"app":"texttools","recipes":[{"name":"x","steps":[{"tool":"nosuch"}]}]}').err, "empty");
});

test("hand-over: spreadsheet rows and To-Do items", () => {
  const s = T.sheetRows("a;b\n1;2,5\n3.5;x", 2, 1);
  assert.deepEqual(s.rows, [["a"], [1]]);
  assert.equal(s.cut, true);
  assert.deepEqual(T.todoItems("  milk \n\nbread\nmilk\n", 200), [{ text: "milk" }, { text: "bread" }]);
  assert.equal(T.todoItems(Array.from({ length: 300 }, (_, i) => "x" + i).join("\n"), 200).length, 200);
});
