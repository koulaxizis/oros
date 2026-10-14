// Wiki (wiki/core.js): the data model and its merge (sync slice
// "wiki", parallel edits kept as alt), the markup parser, sections,
// the renderer's safety (text only, safe links), diff, queries
// (redirects, backlinks, wanted, categories, search), revision files,
// the search provider and the app's wiring (palette, deep link, help).
// Run: node --test tests/*.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const C = require(path.join(ROOT, "wiki/core.js"));
const P = require(path.join(ROOT, "wiki/search.js"));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

const W = "wabc1234";
function art(over) {
  return C.normArt(Object.assign({ id: "aabc1234", m: 1000, w: W, t: "Olive trees", x: "Text", r: "rabc0001", anc: [], alt: [] }, over || {}));
}
function doc(arts, extra) {
  return C.normData(Object.assign({ ver: 1, wikis: [{ id: W, m: 1, n: "Home", main: "" }], arts: arts, tombs: {} }, extra || {}));
}

// ---------- model + merge ----------

test("normalize: bad ids, empty titles and unknown fields are dropped; titles cleaned", () => {
  const d = C.normData({
    wikis: [{ id: W, m: 5, n: "  Home  wiki ", main: "zz", extra: 1 }, { id: "bad", m: 1 }],
    arts: [
      { id: "aabc1234", m: 9, w: W, t: " Olive  [trees]|# ", x: "a\r\nb", r: "rabc0001", foo: 1 },
      { id: "aabc9999", m: 9, w: W, t: "   ", x: "no title" },
      { id: "nope", m: 9, w: W, t: "x" }
    ],
    tombs: { x: 1, aabc0000: 5 }
  });
  assert.deepEqual(d.wikis, [{ id: W, m: 5, n: "Home wiki", main: "" }]);
  assert.equal(d.arts.length, 1);
  assert.equal(d.arts[0].t, "Olive trees");
  assert.equal(d.arts[0].x, "a\nb");
  assert.equal(d.arts[0].foo, undefined);
  assert.deepEqual(d.tombs, { aabc0000: 5 });
});

test("merge: canonical, idempotent and symmetric", () => {
  const a = doc([art({ id: "aaaa0001", t: "B" }), art({ id: "aaaa0002", t: "A" })]);
  const b = doc([art({ id: "aaaa0001", m: 2000, t: "B2", r: "rabc0002", anc: ["rabc0001"] })]);
  assert.deepEqual(C.merge(a, null), a);
  assert.deepEqual(C.merge(a, a), a);
  assert.deepEqual(C.merge(a, b), C.merge(b, a));
  const m = C.merge(a, b);
  assert.equal(m.arts.find((x) => x.id === "aaaa0001").t, "B2");
  assert.deepEqual(m.arts.map((x) => x.id), ["aaaa0001", "aaaa0002"]);
  assert.equal(JSON.stringify(C.merge(m, null)), JSON.stringify(m));
});

test("merge: a later edit that descends from the other copy wins without a conflict", () => {
  const old = art({ r: "rabc0001", m: 1000, x: "old" });
  const next = art({ r: "rabc0003", m: 3000, x: "new", anc: ["rabc0002", "rabc0001"] });
  const m = C.mergeArt(old, next);
  assert.equal(m.x, "new");
  assert.deepEqual(m.alt, []);
  // a descendant wins even when its clock is behind (device clock skew)
  const skew = art({ r: "rabc0004", m: 500, x: "child", anc: ["rabc0001"] });
  assert.equal(C.mergeArt(old, skew).x, "child");
  assert.equal(C.mergeArt(skew, old).x, "child");
});

test("merge: parallel edits keep both texts (alt) until resolved", () => {
  const base = "rabc0001";
  const a = art({ r: "rdeva0001", m: 2000, x: "device A text", anc: [base] });
  const b = art({ r: "rdevb0001", m: 2500, x: "device B text", anc: [base] });
  const ab = C.mergeArt(a, b), ba = C.mergeArt(b, a);
  assert.deepEqual(ab, ba);
  assert.equal(ab.x, "device B text");
  assert.deepEqual(ab.alt, [{ r: "rdeva0001", m: 2000, t: "Olive trees", x: "device A text" }]);
  // merging again with either side changes nothing (no upload loop)
  assert.deepEqual(C.mergeArt(ab, a), ab);
  assert.deepEqual(C.mergeArt(ab, b), ab);
  // resolving: a new revision that lists the alt as an ancestor
  const res = art({ r: "rres00001", m: 3000, x: "device B text", anc: ["rdevb0001", "rdeva0001", base], alt: [] });
  const after = C.mergeArt(ab, res);
  assert.equal(after.r, "rres00001");
  assert.deepEqual(after.alt, []);
  assert.deepEqual(C.mergeArt(res, ab), after);
  // a stale copy of the alt arriving later does not bring the note back
  assert.deepEqual(C.mergeArt(after, a).alt, []);
});

test("merge: alt list is capped and ancestry is bounded", () => {
  let x = art({ r: "rbase0000", m: 1 });
  for (let i = 1; i <= 8; i++) x = C.mergeArt(x, art({ r: "rpar0000" + i, m: 100 + i, x: "v" + i }));
  assert.equal(x.alt.length, 5);
  const anc = Array.from({ length: 80 }, (_, i) => "ranc" + String(i).padStart(4, "0"));
  assert.equal(art({ anc }).anc.length, C.MAX_ANC);
});

test("tombstones: delete wins ties, a newer edit comes back", () => {
  const a = art({ m: 1000 });
  assert.equal(C.merge(doc([a]), doc([], { tombs: { aabc1234: 1000 } })).arts.length, 0);
  const newer = art({ m: 1500, r: "rabc0009", anc: ["rabc0001"] });
  assert.equal(C.merge(doc([newer]), doc([], { tombs: { aabc1234: 1000 } })).arts.length, 1);
});

test("deleting a wiki takes its articles; an article edited after the delete brings it back nameless", () => {
  const gone = C.merge(doc([art({ m: 1000 })]), { wikis: [], arts: [], tombs: { [W]: 2000, aabc1234: 2000 } });
  assert.equal(gone.wikis.length, 0);
  assert.equal(gone.arts.length, 0);
  const later = C.merge({ wikis: [], arts: [art({ id: "aabc7777", m: 3000 })], tombs: { [W]: 2000 } }, null);
  assert.equal(later.wikis.length, 1);
  assert.equal(later.wikis[0].n, "");
  assert.ok(later.wikis[0].m > 2000);
  assert.deepEqual(C.merge(later, null), later);
});

// ---------- parser ----------

test("parser: headings, lists, quote, code, table, rule, links and categories", () => {
  const d = C.parseDoc([
    "Lead **bold** *it* ~~s~~ `c|d` [[Some page|label]] [[Category:Trees]] https://example.org/x.",
    "",
    "## History",
    "- a",
    "  - b",
    "1. one",
    "== Use ==",
    "> said **this**",
    "| A | B |",
    "|---|:-:|",
    "| [[x|y]] | `a|b` |",
    "```",
    "<b>raw</b>",
    "```",
    "---",
    "### Deep [[Other]]"
  ].join("\n"));
  assert.deepEqual(d.heads.map((h) => [h.lvl, h.text, h.anchor, h.line, h.n]),
    [[2, "History", "history", 2, 1], [2, "Use", "use", 6, 2], [3, "Deep Other", "deep_other", 15, 3]]);
  assert.deepEqual(d.links, ["Some page", "x", "Other"]);
  assert.deepEqual(d.cats, ["Trees"]);
  assert.deepEqual(d.blocks.map((b) => b.k), ["p", "h", "ul", "ol", "h", "quote", "table", "pre", "hr", "h"]);
  assert.equal(d.blocks[2].items[0].sub.items[0].c[0].v, "b");
  assert.equal(d.blocks[6].al[1], "center");
  assert.equal(d.blocks[7].v, "<b>raw</b>");
  const lead = d.blocks[0].c;
  assert.deepEqual(lead.filter((n) => n.k !== "t").map((n) => n.k), ["b", "i", "s", "code", "wl", "xl"]);
  assert.equal(lead.find((n) => n.k === "xl").href, "https://example.org/x");
});

test("parser: redirects, section links, category links, escapes, snake_case", () => {
  assert.equal(C.parseDoc("#REDIRECT [[Olive trees]]\n").redirect, "Olive trees");
  assert.equal(C.parseDoc("  #ανακατεύθυνση [[Ελιές|x]]").redirect, "Ελιές");
  const n = C.parseInline("[[#Use|up]] [[:Category:Trees]] \\*not\\* snake_case_name _it_").nodes;
  assert.deepEqual(n[0], { k: "wl", to: "", frag: "Use", v: "up" });
  assert.equal(n[2].k, "cl");
  assert.ok(!n.some((x) => x.k === "i" && x.c[0].v === "case"));
  assert.ok(n.some((x) => x.k === "i" && x.c[0].v === "it"));
  assert.match(C.inlineText(n), /\*not\*/);
});

test("parser: unsafe links never become links", () => {
  for (const u of ["javascript:alert(1)", "data:text/html,x", "vbscript:x", "https://", "//evil.com", "https://x\"onmouseover=1"]) {
    const nodes = C.parseInline("[go](" + u + ")").nodes;
    assert.ok(!nodes.some((x) => x.k === "xl"), u);
  }
  assert.equal(C.safeUrl("mailto:me@example.gr"), "mailto:me@example.gr");
  assert.equal(C.safeUrl("https://example.gr/a?b=1#c"), "https://example.gr/a?b=1#c");
  assert.equal(C.safeUrl("JavaScript:alert(1)"), "");
});

test("titles: cleaned and folded (case, accents, final sigma, underscores)", () => {
  assert.equal(C.cleanTitle("  a_b [c] {d} | e # f <g> "), "a b c d e f g");
  assert.equal(C.fold("Ελιές_ΚΑΙ  Λάδι"), C.fold("ελιεσ και λαδι"));
  assert.equal(C.slug("Ιστορία & χρήση"), "ιστορια_χρηση");
});

// ---------- sections ----------

test("sections: read and replace one section, lead is section 0", () => {
  const t = "Lead\n\n## A\naa\n### A1\na1\n## B\nbb";
  assert.equal(C.getSection(t, 0), "Lead");
  assert.equal(C.getSection(t, 1), "## A\naa\n### A1\na1");
  assert.equal(C.getSection(t, 2), "### A1\na1");
  assert.equal(C.getSection(t, 4), null);
  assert.equal(C.setSection(t, 1, "## A!\nnew"), "Lead\n\n## A!\nnew\n\n## B\nbb");
  assert.equal(C.setSection(t, 3, "## B\nchanged\n\n"), "Lead\n\n## A\naa\n### A1\na1\n## B\nchanged");
  assert.equal(C.setSection(t, 0, "New lead"), "New lead\n\n## A\naa\n### A1\na1\n## B\nbb");
});

// ---------- renderer ----------

// Minimal DOM: enough for the renderer, and it records every
// attribute so the test can check that nothing unsafe is written.
function fakeDoc() {
  const attrs = [];
  function node(tag) {
    return {
      tagName: tag, children: [], attrs: {}, style: {}, className: "", id: "", _text: "",
      appendChild(c) { this.children.push(c); return c; },
      setAttribute(k, v) { this.attrs[k] = String(v); attrs.push([tag, k, String(v)]); },
      get lastElementChild() { return this.children.filter((c) => c.tagName).slice(-1)[0] || null; },
      set textContent(v) { this.children = [{ text: String(v) }]; },
      set innerHTML(v) { throw new Error("innerHTML used"); }
    };
  }
  return {
    attrs,
    createElement: (t) => node(t),
    createTextNode: (t) => ({ text: String(t) }),
    createDocumentFragment: () => node("#frag")
  };
}
function textOf(n) { return n.text !== undefined ? n.text : n.children.map(textOf).join(""); }
function find(n, pred, out = []) { if (pred(n)) out.push(n); (n.children || []).forEach((c) => find(c, pred, out)); return out; }

test("renderer: text only, red links, safe external links, contents box, section edit", () => {
  const D = fakeDoc();
  const src = "<img src=x onerror=alert(1)> [[Known]] [[Missing]] [x](https://ok.example)\n\n## One\na\n## Two\nb\n### Three\nc";
  const frag = C.render(D, C.parseDoc(src), { state: (t) => (t === "Known" ? "ok" : "new"), edit: "edit", toc: "Contents" });
  assert.match(textOf(frag), /<img src=x onerror=alert\(1\)>/);         // shown as text
  assert.ok(!find(frag, (n) => n.tagName === "img").length);
  const links = find(frag, (n) => n.tagName === "a" && n.attrs["data-to"]);
  assert.deepEqual(links.map((l) => [l.attrs["data-to"], l.className]), [["Known", "wl"], ["Missing", "wl new"]]);
  const xl = find(frag, (n) => n.tagName === "a" && n.className === "xl")[0];
  assert.equal(xl.attrs.href, "https://ok.example");
  assert.equal(xl.attrs.rel, "noopener noreferrer nofollow");
  assert.equal(find(frag, (n) => n.className === "toc").length, 1);
  assert.deepEqual(find(frag, (n) => n.className === "sec-edit").map((b) => b.attrs["data-sec"]), ["1", "2", "3"]);
  assert.equal(find(frag, (n) => n.tagName === "section").length, 2);
  assert.ok(find(frag, (n) => /^h\d$/.test(n.tagName)).every((h) => h.id.indexOf("s-") === 0));
  // the only attributes ever written are these
  const allowed = new Set(["href", "target", "rel", "data-to", "data-frag", "data-cat", "data-anchor", "data-sec", "type"]);
  assert.ok(D.attrs.every(([, k]) => allowed.has(k)), JSON.stringify(D.attrs));
  assert.ok(D.attrs.filter(([, k]) => k === "href").every(([, , v]) => v === "#" || /^(https?:|mailto:)/.test(v)));
});

test("renderer: never uses innerHTML (source check)", () => {
  const src = read("wiki/core.js");
  assert.ok(!/\.innerHTML\s*=/.test(src));
  const app = read("wiki/wiki.js");
  // the app sets innerHTML only for its own constant icons
  const uses = app.match(/\.innerHTML\s*=\s*[^;]+;/g) || [];
  assert.ok(uses.length > 0 && uses.every((u) => /ICON\.\w+;$/.test(u)), uses.join("\n"));
});

// ---------- diff ----------

test("diff: lines with word changes inside, context and stats", () => {
  const rows = C.diffText("one\ntwo three\nfour", "one\ntwo 3\nfour\nfive");
  assert.deepEqual(rows.map((r) => r.op + r.v), ["=one", "-two three", "+two 3", "=four", "+five"]);
  assert.deepEqual(rows[1].parts.filter((p) => p.op === "-").map((p) => p.v), ["three"]);
  assert.deepEqual(rows[2].parts.filter((p) => p.op === "+").map((p) => p.v), ["3"]);
  assert.deepEqual(C.diffStats(rows), { add: 2, del: 1 });
  const long = Array.from({ length: 20 }, (_, i) => "l" + i);
  const changed = long.slice(); changed[10] = "X";
  const ctx = C.diffContext(C.diffText(long.join("\n"), changed.join("\n")), 2);
  assert.deepEqual(ctx.map((r) => r.op), ["gap", "=", "=", "-", "+", "=", "=", "gap"]);
  assert.equal(ctx[0].n, 8);
  assert.deepEqual(C.diffText("same", "same").filter((r) => r.op !== "="), []);
});

// ---------- queries ----------

test("queries: redirects, backlinks, wanted, categories, search, suggest", () => {
  const d = doc([
    art({ id: "aaaa0001", t: "Olive trees", x: "About [[Olive oil]] and [[Pruning]].\n[[Category:Trees]]", c: 1 }),
    art({ id: "aaaa0002", t: "Olives", x: "#REDIRECT [[Olive trees]]", c: 2 }),
    art({ id: "aaaa0003", t: "Olive oil", x: "Made from [[olives]]. [[Category:Food]] [[Category:Trees]]", c: 3 }),
    art({ id: "aaaa0004", t: "Lemons", x: "Not about it. Mentions pruning.", c: 4 })
  ]);
  const r = C.resolve(d, W, "olives");
  assert.equal(r.art.id, "aaaa0001");
  assert.equal(r.from.id, "aaaa0002");
  assert.deepEqual(C.backlinks(d, W, C.byId(d, "aaaa0001")).map((a) => a.id), ["aaaa0003", "aaaa0002"]);
  assert.deepEqual(C.wanted(d, W).map((x) => [x.title, x.n]), [["Pruning", 1]]);
  assert.deepEqual(C.categories(d, W).map((c) => [c.name, c.arts.length]), [["Food", 1], ["Trees", 2]]);
  assert.deepEqual(C.search(d, W, "olive").map((a) => a.id).slice(0, 2).sort(), ["aaaa0001", "aaaa0003"]);
  assert.ok(C.search(d, W, "pruning").some((a) => a.id === "aaaa0004"));
  assert.deepEqual(C.suggest(d, W, "ol").map((a) => a.t), ["Olive oil", "Olive trees", "Olives"]);
  assert.equal(C.snippet("## H\nSome **bold** text [[A|b]]", 100), "H Some bold text b");
  // redirect loops stop
  const loop = doc([art({ id: "aaaa0011", t: "A", x: "#REDIRECT [[B]]" }), art({ id: "aaaa0012", t: "B", x: "#REDIRECT [[A]]" })]);
  assert.ok(C.resolve(loop, W, "A").art);
});

// ---------- revisions ----------

test("revisions: file names sort by time, files parse back, bad files are refused", () => {
  const a = art({ m: 1700000000000, r: "rabc0042", s: "Fixed a date" });
  assert.equal(C.revPath(a.id, a.m, a.r), "/internal/Wiki/History/aabc1234/1700000000000-rabc0042.json");
  assert.deepEqual(C.parseRevName("1700000000000-rabc0042.json"), { m: 1700000000000, r: "rabc0042" });
  assert.equal(C.parseRevName("x.json"), null);
  const f = C.parseRevFile(JSON.stringify(C.revFile(a, "rabc0041", "")));
  assert.equal(f.x, "Text");
  assert.equal(f.p, "rabc0041");
  assert.equal(f.s, "Fixed a date");
  assert.equal(C.parseRevFile("{bad"), null);
  assert.equal(C.parseRevFile({ a: "x", r: "y" }), null);
  assert.ok(C.revName(5, "rabc0001") < C.revName(40, "rabc0001"));
});

// ---------- search provider ----------

test("search provider: titles + plain text, skips redirects and tombstones", () => {
  const d = doc([
    art({ id: "aaaa0001", t: "Olive trees", x: "## Care\nWater **twice** a [[Month|month]].\n| a | b |\n|---|---|\n[[Category:Trees]]" }),
    art({ id: "aaaa0002", t: "Olives", x: "#REDIRECT [[Olive trees]]" }),
    art({ id: "aaaa0003", t: "Gone", x: "x", m: 5 })
  ], { tombs: { aaaa0003: 5 } });
  const hits = P.search({ readJSON: () => d, lang: "en" });
  assert.deepEqual(hits.map((h) => h.title), ["Olive trees"]);
  assert.equal(hits[0].text, "Home · Care Water twice a month. a · b");
  assert.deepEqual(hits[0].target, { a: "aaaa0001" });
  assert.deepEqual(P.search({ readJSON: () => null, lang: "en" }), []);
});

// ---------- wiring ----------

test("wiring: palette contract, direct link, deep link, slice, help, i18n keys", () => {
  const html = read("wiki/index.html");
  const js = read("wiki/wiki.js");
  assert.match(html, /location\.replace\("\.\.\/\?open=wiki"/);
  assert.ok(html.indexOf("core.js") < html.indexOf("wiki.js"));
  assert.match(js, /function inheritPalette/);
  assert.match(js, /function watchPalette/);
  assert.match(js, /registerSlice\("wiki", sliceGet, sliceSet, C\.DATA_KEY, C\.merge\)/);
  assert.match(js, /window\.__orosOpenAt = openTarget;/);
  assert.match(js, /__orosTakeTarget\("wiki"\)/);
  assert.ok(fs.existsSync(path.join(ROOT, "wiki/help.en.txt")));
  assert.ok(fs.existsSync(path.join(ROOT, "wiki/help.el.txt")));
  // every t("…") key used by the app exists in both languages
  const src = js.slice(js.indexOf("var STRINGS"));
  const vm = require("vm");
  const box = {};
  vm.runInNewContext(js.slice(js.indexOf("var STRINGS"), js.indexOf("function t(k, vars)")) + ";this.S = STRINGS;", box);
  const used = new Set([...js.matchAll(/\bt\("([\w.]+)"[,)]/g)].map((m) => m[1]));
  for (const k of used) {
    assert.ok(box.S.en[k] !== undefined, "en " + k);
    assert.ok(box.S.el[k] !== undefined, "el " + k);
  }
  for (const k of Object.keys(box.S.en)) assert.ok(box.S.el[k] !== undefined, "el missing " + k);
  assert.ok(src.length > 0);
});
