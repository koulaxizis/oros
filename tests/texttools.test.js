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

// ---------- Wave 2: extract, encode / decode, compare ----------

test("extract: emails, links, phones, numbers, #hashtags, @names", () => {
  const em = run1("extract", "Γράψε στο a.b@ex.gr, x@y.com. Ξανά: A.B@EX.gr και Γιώργος@παράδειγμα.ελ");
  assert.equal(em.text, "a.b@ex.gr\nx@y.com\nΓιώργος@παράδειγμα.ελ\n");
  assert.equal(em.notes[0].n, 3);
  assert.equal(out("extract", "a@b.gr a@b.gr", { unique: false }), "a@b.gr\na@b.gr\n");
  assert.equal(out("extract", "Δες https://el.wikipedia.org/wiki/Αθήνα_(πόλη)). και www.oros.gr, http://a.b/c?d=1&e=2.", { what: "links" }),
    "https://el.wikipedia.org/wiki/Αθήνα_(πόλη)\nwww.oros.gr\nhttp://a.b/c?d=1&e=2\n");
  assert.equal(out("extract", "Τηλ. 210 123 4567, +30 6912345678 και (210) 555-1234. Ημ. 12/10/2026, 2026-10-12, ποσό 1.234,56 €", { what: "phones" }),
    "210 123 4567\n+30 6912345678\n(210) 555-1234\n");
  assert.equal(out("extract", "Κόστος 12,50€ και -3 και 1.234,56 και 45% και A12", { what: "numbers" }), "12,50\n-3\n1.234,56\n45%\n");
  assert.equal(out("extract", "#orOS #καλημέρα #2026 a#b &#39; #orOS", { what: "hashtags" }), "#orOS\n#καλημέρα\n");
  assert.equal(out("extract", "@chris, @άννα. x@y.com @chris", { what: "mentions" }), "@chris\n@άννα\n");
  assert.equal(out("extract", "c@x.gr b@x.gr a@x.gr", { sort: true }), "a@x.gr\nb@x.gr\nc@x.gr\n");
  assert.equal(out("extract", "nothing here"), "");
});

test("URL encode / decode: parts, whole address, broken % runs stay", () => {
  assert.equal(out("url", "a b&c=Ελλάδα\nx/y\n"), "a%20b%26c%3D%CE%95%CE%BB%CE%BB%CE%AC%CE%B4%CE%B1\nx%2Fy\n");
  assert.equal(out("url", "https://x.gr/α?q=1&r=β", { full: true }), "https://x.gr/%CE%B1?q=1&r=%CE%B2");
  assert.equal(out("url", "a%20b%26c%3D%CE%95 %E0%A4 q+r", { dir: "dec" }), "a b&c=Ε %E0%A4 q+r");
  assert.equal(out("url", "q+r", { dir: "dec", plus: true }), "q r");
});

test("Base64: UTF-8 both ways, URL-safe, per line, not-Base64 noted", () => {
  const s = "Γειά σου κόσμε 😀";
  const enc = out("base64", s);
  assert.equal(enc, Buffer.from(s, "utf8").toString("base64") + "\n");
  assert.equal(out("base64", enc, { dir: "dec" }), s);
  assert.equal(out("base64", "??>", { urlsafe: true }), Buffer.from("??>").toString("base64url") + "\n");
  assert.equal(out("base64", Buffer.from("??>").toString("base64url"), { dir: "dec" }), "??>");
  assert.equal(out("base64", "α\nβ\n", { each: true }), "zrE=\nzrI=\n");
  assert.equal(out("base64", "zrE=\nzrI=\n", { dir: "dec", each: true }), "α\nβ\n");
  assert.equal(run1("base64", "@@@", { dir: "dec" }).notes[0].err, "b64");
  assert.equal(run1("base64", "//79", { dir: "dec" }).notes[0].err, "b64");   // bytes that are not UTF-8 text
  for (let n = 1; n < 40; n++) {
    const x = "ωx€😀".repeat(n % 5) + "a".repeat(n);
    assert.equal(T.b64dec(T.b64enc(x)), x);
    assert.equal(T.b64enc(x), Buffer.from(x, "utf8").toString("base64"));
  }
});

test("HTML entities: encode, all non-ASCII, decode named and numeric", () => {
  assert.equal(out("html", "<a href=\"x\">Tom & Jerry's</a>"), "&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;");
  assert.equal(out("html", "Ωé😀", { all: true }), "&#937;&#233;&#128512;");
  const d = run1("html", "&lt;b&gt; &amp;amp; &eacute;&Uuml; &Omega;&sigmaf; &#x1F600; &#39; &bogus; &#xD800;", { dir: "dec" });
  assert.equal(d.text, "<b> &amp; éÜ Ως 😀 ' &bogus; &#xD800;");
  assert.equal(d.notes[0].n, 9);
});

test("slug: Greek to Latin, keep Greek, separator, length", () => {
  assert.equal(out("slug", "Καλή Χρονιά! 2026\n\n  Ευχές & ούζο  \n"), "kali-chronia-2026\n\nevches-ouzo\n");
  assert.equal(out("slug", "Καλή Χρονιά!", { greek: "keep", sep: "under" }), "καλη_χρονια");
  assert.equal(out("slug", "Crème Brûlée — São Paulo"), "creme-brulee-sao-paulo");
  assert.equal(out("slug", "one two three four", { max: 12 }), "one-two");
});

test("compare: line diff, options, show modes, second text needed", () => {
  const r = T.run("a\nb\nc\nd\ne\n", [{ tool: "diff", opts: {} }], { other: "a\nB\nc\ne\nf\n" });
  assert.equal(r.text, "  a\n- b\n+ B\n  c\n- d\n  e\n+ f\n");
  assert.deepEqual(r.notes[0].x, { add: 2, del: 2 });
  const d = (opts) => T.run("a\nb\n", [{ tool: "diff", opts }], { other: "A\nb\nc\n" }).text;
  assert.equal(d({ icase: true, show: "changes" }), "+ c\n");
  assert.equal(d({ show: "added" }), "A\nc\n");
  assert.equal(d({ show: "removed" }), "a\n");
  assert.equal(d({ show: "same" }), "b\n");
  assert.equal(T.run(" x \nά", [{ tool: "diff", opts: { trim: true, iaccent: true } }], { other: "x\nα" }).notes[0].n, 0);
  assert.equal(T.run("x", [{ tool: "diff", opts: {} }]).notes[0].err, "noother");
  assert.equal(T.usesOther([{ tool: "sort" }, { tool: "diff" }]), true);
  assert.equal(T.usesOther([{ tool: "sort" }]), false);
});

test("compare: the diff is the shortest one and keeps every line", () => {
  const rnd = (n) => Array.from({ length: n }, () => "abcd"[Math.floor(Math.random() * 4)]);
  const check = (a, b) => {
    const ops = T.diffLines(a, b), ra = [], rb = [];
    let same = 0;
    ops.forEach((o) => {
      if (o[0] <= 0) ra.push(a[o[1]]);
      if (o[0] === 0) { rb.push(b[o[2]]); same++; assert.equal(a[o[1]], b[o[2]]); }
      if (o[0] > 0) rb.push(b[o[1]]);
    });
    assert.deepEqual(ra, a);
    assert.deepEqual(rb, b);
    return same;
  };
  for (let t = 0; t < 400; t++) {
    const a = rnd(Math.floor(Math.random() * 12)), b = rnd(Math.floor(Math.random() * 12));
    const L = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
      L[i][j] = a[i - 1] === b[j - 1] ? L[i - 1][j - 1] + 1 : Math.max(L[i - 1][j], L[i][j - 1]);
    assert.equal(check(a, b), L[a.length][b.length]);
  }
  // very different big texts: anchored diff, still every line, no freeze
  const A = [], B = [];
  for (let i = 0; i < 30000; i++) { A.push("line " + i); B.push(i % 7 === 0 ? "changed " + i : "line " + i); }
  const t0 = Date.now();
  check(A, B);
  check(A.map((x, i) => "a" + i), B.map((x, i) => "b" + i));
  assert.ok(Date.now() - t0 < 20000);
});

test("UI strings: English and Greek have the same keys, every tool and option is labelled", () => {
  const src = require("fs").readFileSync(require("path").join(__dirname, "..", "texttools", "texttools.js"), "utf8");
  const block = (name) => {
    const i = src.indexOf("\n    " + name + ": {"), j = src.indexOf("\n    }", i);
    return Object.fromEntries([...src.slice(i, j).matchAll(/"([a-zA-Z0-9.]+)":\s*"/g)].map((m) => [m[1], 1]));
  };
  const en = block("en"), el = block("el");
  assert.deepEqual(Object.keys(en).sort(), Object.keys(el).sort());
  T.GROUPS.forEach((g) => assert.ok(en["grp." + g], "grp." + g));
  T.TOOL_IDS.forEach((id) => {
    assert.ok(en["tool." + id] && en["hint." + id], id);
    Object.keys(T.TOOLS[id].f).forEach((k) => {
      assert.ok(en["opt." + id + "." + k] || en["opt." + k], id + "." + k);
      const f = T.TOOLS[id].f[k];
      if (f[0] === "sel") f[1].forEach((v) => assert.ok(en["val." + k + "." + v] || en["dl." + v], id + "." + k + "=" + v));
    });
  });
});
