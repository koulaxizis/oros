// Wiki wave 3 (wiki/io.js): Notes and Markdown import, Markdown and
// website export, Start from Wikipedia, "Send to someone" kind.
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const C = require(path.join(ROOT, "wiki/core.js"));
const IO = require(path.join(ROOT, "wiki/io.js"));
const K = require(path.join(ROOT, "share/kinds.js"));
const ID = "a".repeat(64) + ".jpg";

test("Notes notebook: tree → categories, labels, links follow renamed titles", () => {
  const nd = {
    notebooks: [{ id: "nb1", name: "Garden" }, { id: "nb2", name: "Other" }],
    labels: [{ id: "l1", name: "Ideas" }],
    pages: [
      { id: "p1", nb: "nb1", parent: null, title: "Trees", text: "See [[Olives]] and [[Garden/Figs|figs]].\n- [ ] prune\n- [x] water", pos: 0 },
      { id: "p2", nb: "nb1", parent: "p1", title: "Olives", text: "# Olives\nOld [[Trees]].", pos: 0, labels: ["l1"] },
      { id: "p3", nb: "nb1", parent: "p1", title: "Figs", text: "```\n- [ ] in code\n```", pos: 1 },
      { id: "p4", nb: "nb2", parent: null, title: "Elsewhere", text: "x", pos: 0 },
      { id: "p5", nb: "nb1", parent: null, title: "Gone", text: "x", pos: 2, mtime: 5 }
    ],
    tombs: { p5: 9 }
  };
  const books = IO.notesBooks(nd);
  assert.deepStrictEqual(books.map(b => [b.id, b.n]), [["nb1", 3], ["nb2", 1]]);
  const taken = { [C.fold("Olives")]: true };      // the wiki already has "Olives"
  const r = IO.fromNotes(nd, "nb1", taken, "Untitled");
  assert.strictEqual(r.name, "Garden");
  assert.deepStrictEqual(r.arts.map(a => a.t), ["Trees", "Olives (2)", "Figs"]);
  const trees = r.arts[0].x;
  assert.match(trees, /\[\[Olives \(2\)\|Olives\]\]/);
  assert.match(trees, /\[\[Figs\|figs\]\]/);
  assert.match(trees, /- ☐ prune\n- ☑ water/);
  assert.match(r.arts[1].x, /\[\[Category:Trees\]\]\n\[\[Category:Ideas\]\]$/);
  assert.match(r.arts[1].x, /^Old \[\[Trees\]\]\./);      // the repeated "# Olives" line went
  assert.match(r.arts[2].x, /- \[ \] in code/);       // code stays as written
  assert.strictEqual(IO.fromNotes(nd, "nope", {}), null);
  assert.deepStrictEqual(IO.notesBooks(null), []);
  // every result parses: categories land where the wiki reads them
  assert.deepStrictEqual(C.parseDoc(r.arts[1].x).cats, ["Trees", "Ideas"]);
});

test("Markdown in: front matter, title line, pictures, links to .md files, Notes footer", () => {
  const seen = [];
  const ctx = {
    img: (p, alt, opts) => { seen.push([p, alt, opts]); return p === "pic.png" ? "[[File:" + ID + "|" + alt + "]]" : ""; },
    page: (p) => (p === "Other page.md" ? "Other page" : "")
  };
  const md = "---\ntitle: \"Real title\"\ntags:\n  - one\n  - two\n---\n# Ignored heading\n\nText ![A cat](pic.png \"left|200px\") and ![x](https://example.com/a.png) and ![[gone.png|Lost]].\n" +
    "Go to [the other](Other%20page.md). <b>bold</b><br>\n- [x] done\n\n---\nMade with orOS | useoros.online\n";
  const a = IO.fromMarkdown("file.md", md, ctx);
  assert.strictEqual(a.t, "Real title");
  assert.deepStrictEqual(a.cats, ["one", "two"]);
  assert.match(a.x, /^Text \[\[File:a{64}\.jpg\|A cat\]\]/);
  assert.match(a.x, /\[x\]\(https:\/\/example\.com\/a\.png\)/);   // web pictures become links
  assert.match(a.x, /and Lost\./);
  assert.match(a.x, /\[\[Other page\|the other\]\]/);
  assert.doesNotMatch(a.x, /<b>|<br>|Made with orOS/);
  assert.match(a.x, /- ☑ done$/);
  assert.deepStrictEqual(seen[0], ["pic.png", "A cat", "left|200px"]);
  const b = IO.fromMarkdown("Plain name.md", "# Head\n\nBody", null);
  assert.strictEqual(b.t, "Head");
  assert.strictEqual(IO.fromMarkdown("Plain name.txt", "no title", null).t, "Plain name");
});

test("Markdown out and back: pictures keep place and size, galleries stay", () => {
  const a = { t: "Cats", x: "Lead [[File:" + ID + "|left|200px|A \\| cat]] text.\n\n{{gallery\nFile:" + ID + "|One\n}}\n\n```\n[[File:" + ID + "]]\n```" };
  const md = IO.toMarkdown(a);
  assert.match(md, /^# Cats\n\nLead !\[A \| cat\]\(media\/a{64}\.jpg "left\|200px"\) text\./);
  assert.match(md, /\{\{gallery\nFile:a{64}\.jpg\|One\n\}\}/);
  assert.match(md, /```\n\[\[File:a{64}\.jpg\]\]\n```/);
  const back = IO.fromMarkdown("Cats.md", md, { img: (p, alt, o) => IO.mediaFile(p.split("/").pop(), alt, o, "en") });
  assert.strictEqual(back.t, "Cats");
  const fig = C.parseDoc(back.x).blocks[0].c.filter(n => n.k === "img")[0];
  assert.strictEqual(fig.id, ID);
  assert.strictEqual(fig.w, 200);
  assert.match(back.x, /\[\[File:a{64}\.jpg\|left\|200px\|A \\\| cat\]\]/);
  // file names: safe, unique, case-insensitive
  const used = {};
  assert.strictEqual(IO.uniqueFile(IO.fileStem("a/b:c?"), ".md", used), "a b c.md");
  assert.strictEqual(IO.uniqueFile(IO.fileStem("A B C"), ".md", used), "A B C (2).md");
  assert.strictEqual(IO.fileStem("..."), "article");
});

test("Wikipedia: wikitext → our markup (infobox, refs, tables, links, no pictures or categories)", () => {
  const wt = "{{Infobox person\n| name = Ada\n| image = Ada.jpg\n| birth_date = {{birth date|1815|12|10}}\n| known_for = [[Engine]]<br>programs\n}}\n" +
    "'''Ada''' was a [[mathematician|maths person]].<ref name=\"a\">{{cite web |url=https://ex.org/a |title=Ada |website=Ex |date=2015}}</ref> Again.<ref name=\"a\"/>\n" +
    "[[File:X.jpg|thumb|A [[caption]]]]\n<!-- hidden -->\n== Life ==\nBorn in [[London]].<ref>Book, p. 1.</ref>\n* one\n** two\n# first\n" +
    "== Empty ==\n=== Also empty ===\n== Works ==\n{| class=\"wikitable\"\n! Year !! Title\n|-\n| 1843 || ''Notes''\n|-\n| style=\"x\" | 1850 || a {{!}} b\n|}\n" +
    "See [https://ex.org/b the site], <math>x^2</math>, <nowiki>[[not a link]]</nowiki>, {{lang|fr|bonjour}}, {{unknown|zap}}.\n" +
    "<script>alert(1)</script><span onclick=\"x()\">kept text</span>\n== References ==\n{{reflist}}\n[[Category:People]]\n[[de:Ada]]\n";
  const x = IO.wtConvert(wt, { title: "Ada", lang: "en" });
  assert.match(x, /^\{\{infobox\n\| title = Ada\n\| Birth date = 1815-12-10\n\| Known for = \[\[Engine\]\], programs\n\}\}/);
  assert.match(x, /\*\*Ada\*\* was a \[\[mathematician\|maths person\]\]\.\[\^1\] Again\.\[\^1\]/);
  assert.doesNotMatch(x, /File:|X\.jpg|Category|People|de:Ada|hidden|zap|<|onclick|alert/);
  assert.match(x, /== Life ==\n\nBorn in \[\[London\]\]\.\[\^2\]\n\n- one\n {2}- two\n1\. first/);
  assert.doesNotMatch(x, /Empty/);
  assert.match(x, /\| Year \| Title \|\n\|---\|---\|\n\| 1843 \| \*Notes\* \|\n\| 1850 \| a \\\| b \|/);
  assert.match(x, /\[the site\]\(https:\/\/ex\.org\/b\), `x\^2`, \\\[\\\[not a link\\\]\\\], bonjour, \./);
  assert.match(x, /kept text/);
  assert.match(x, /== References ==\n\n\{\{references\}\}/);
  assert.match(x, /\[\^1\]: \[Ada\]\(https:\/\/ex\.org\/a\)\. \*Ex\*\. 2015\.\n\[\^2\]: Book, p\. 1\./);
  // what we made is what the wiki reads
  const p = C.parseDoc(x);
  assert.strictEqual(p.refs.length, 2);
  assert.ok(p.blocks.some(b => b.k === "ibox"));
  assert.ok(p.blocks.some(b => b.k === "table"));
  assert.deepStrictEqual(p.links.slice(0, 3), ["Engine", "mathematician", "London"]);
});

test("Wikipedia: credit section, addresses, API answers, size cap", () => {
  const r = IO.fromWikipedia({ title: "Olea (plant)", revid: 42, wikitext: "Text." }, { lang: "el", ui: "en", date: "2026-10-14" });
  assert.strictEqual(r.t, "Olea (plant)");
  assert.match(r.x, /^Text\.\n\n== Source ==\n\nThis article starts from “\[Olea \(plant\)\]\(https:\/\/el\.wikipedia\.org\/wiki\/Olea_%28plant%29\)” on Wikipedia/);
  assert.match(r.x, /\[its authors\]\(https:\/\/el\.wikipedia\.org\/w\/index\.php\?title=Olea_%28plant%29&action=history\)/);
  assert.match(r.x, /\[CC BY-SA 4\.0\]\(https:\/\/creativecommons\.org\/licenses\/by-sa\/4\.0\/\)/);
  assert.match(r.x, /copied on 2026-10-14 \(\[this version\]\(https:\/\/el\.wikipedia\.org\/w\/index\.php\?oldid=42\)\)/);
  // every link in the credit is a real link once rendered
  const xl = [];
  (function walk(ns) { ns.forEach(n => { if (n.k === "xl") xl.push(n.href); if (n.c) walk(n.c); }); })(C.parseDoc(r.x).blocks.filter(b => b.k === "p").pop().c);
  assert.strictEqual(xl.length, 4);
  const el = IO.wpCredit({ lang: "en", title: "X", revid: 0, date: "2026-10-14", ui: "el" });
  assert.match(el, /^== Πηγή ==/);
  assert.match(el, /\(αυτή η έκδοση\)/);
  const big = IO.fromWikipedia({ title: "Big", revid: 1, wikitext: ("Para " + "w ".repeat(400) + "\n\n").repeat(400) }, { lang: "en", ui: "en", date: "d" });
  assert.ok(big.x.length <= C.MAX_TEXT);
  assert.match(big.x, /== Source ==/);
  assert.deepStrictEqual(IO.wpFromUrl("https://el.m.wikipedia.org/wiki/%CE%95%CE%BB%CE%B9%CE%AC_(%CF%86%CF%85%CF%84%CF%8C)#x"), { lang: "el", title: "Ελιά (φυτό)" });
  assert.strictEqual(IO.wpFromUrl("https://evil.example/wiki/X"), null);
  assert.match(IO.wpParseUrl("xx\"><", "A & B"), /^https:\/\/en\.wikipedia\.org\/w\/api\.php\?.*origin=\*&page=A%20%26%20B$/);
  assert.match(IO.wpSearchUrl("el", "ελ"), /^https:\/\/el\.wikipedia\.org\/w\/api\.php\?action=opensearch/);
  assert.deepStrictEqual(IO.wpParseAnswer({ error: { code: "missingtitle" } }), { error: "missing" });
  assert.deepStrictEqual(IO.wpParseAnswer({ parse: { title: 5 } }), { error: "bad" });
  assert.deepStrictEqual(IO.wpParseAnswer("x"), { error: "bad" });
  assert.deepStrictEqual(IO.wpParseAnswer({ parse: { title: "T", revid: "7", wikitext: "w" } }), { title: "T", revid: 7, wikitext: "w" });
  assert.deepStrictEqual(IO.wpSearchAnswer(["q", ["A", 3, "B"]]), ["A", "B"]);
  assert.deepStrictEqual(IO.wpSearchAnswer({}), []);
});

test("Send to someone: pictures out, wiki kind normalized, opens the Wiki editor", () => {
  const x = "Lead [[File:" + ID + "|right|A caption]] and [[File:" + ID + "]].\n{{gallery\nFile:" + ID + "|One\n}}\n{{infobox\n| title = T\n| image = File:" + ID + "\n| Born = 1901\n}}\nEnd";
  const s = IO.shareText(x);
  assert.strictEqual(s, "Lead *A caption* and .\n{{infobox\n| title = T\n| Born = 1901\n}}\nEnd");
  assert.ok(K.KINDS.includes("wiki"));
  const env = K.pack("wiki", { t: "  Olives\n", x: "a\r\nb\u0000", evil: 1 });
  assert.deepStrictEqual(env.d, { t: "Olives", x: "a\nb" });
  assert.strictEqual(K.pack("wiki", { x: "no title" }), null);
  assert.strictEqual(K.pack("wiki", { t: "T", x: "y".repeat(70000) }).d.x.length, 60000);
  assert.deepStrictEqual(K.target(env, "en"), { app: "wiki", target: { addArticle: { t: "Olives", x: "a\nb" } } });
  assert.strictEqual(K.summary(env, "el"), "Άρθρο wiki «Olives»");
  const f = K.file(env, "en");
  assert.strictEqual(f.name, "Olives.md");
  assert.strictEqual(f.text, "# Olives\n\na\nb\n");
  assert.match(K.text(env, "en"), /^Olives\n\na\nb$/);
});

test("Website export: every value escaped, lists link to page files", () => {
  const html = IO.sitePage({ lang: "el\"", wiki: "<W>", title: "A & \"B\"", body: "<p>x</p>", L: { main: "M", all: "All", cats: "C" }, foot: "<f>" });
  assert.match(html, /<html lang="el&quot;">/);
  assert.match(html, /<title>A &amp; &quot;B&quot; · &lt;W&gt;<\/title>/);
  assert.match(html, /<h1>A &amp; &quot;B&quot;<\/h1>\n<p>x<\/p>/);
  assert.match(html, /<footer>&lt;f&gt;<\/footer>/);
  assert.match(html, /script-src 'none'/);
  assert.doesNotMatch(html, /<script/);
  const used = { "index.html": 1 };
  assert.strictEqual(IO.pageFile("Index", used), "index-2.html");
  assert.strictEqual(IO.pageFile("Ελιά δέντρο", used), "ελια-δεντρο.html");
  assert.strictEqual(IO.siteList([{ t: "<x>", file: "ελια.html" }]), "<ul class=\"list\"><li><a href=\"%CE%B5%CE%BB%CE%B9%CE%B1.html\">&lt;x&gt;</a></li></ul>");
  assert.match(IO.SITE_CSS, /prefers-color-scheme:dark/);
});

test("Wave 3 wiring: io.js loaded, share page loads WikiCore, credits name Wiki", () => {
  const idx = fs.readFileSync(path.join(ROOT, "wiki/index.html"), "utf8");
  assert.match(idx, /<script src="io\.js\?v=[^"]+"><\/script>\s*<script src="wiki\.js/);
  assert.match(idx, /id="wiki-io"/);
  assert.match(fs.readFileSync(path.join(ROOT, "share/index.html"), "utf8"), /\.\.\/wiki\/core\.js/);
  const js = fs.readFileSync(path.join(ROOT, "wiki/wiki.js"), "utf8");
  assert.match(js, /addArticle/);
  assert.match(js, /kind: "wiki"/);
  assert.doesNotMatch(js, /innerHTML\s*=(?!\s*ICON)/);
  assert.match(fs.readFileSync(path.join(ROOT, "CREDITS.md"), "utf8"), /Wikipedia[^\n]*Wiki \(Start from Wikipedia/);
  assert.match(fs.readFileSync(path.join(ROOT, "sw.js"), "utf8"), /"wiki\/io\.js"/);
});
