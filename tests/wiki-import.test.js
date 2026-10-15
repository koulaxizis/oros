// Wiki wave 4 (wiki/import.js): import from Notion, TiddlyWiki,
// MediaWiki, Confluence (and plain Markdown) with stable ids, updates
// of untouched articles, edited ones left alone, sync-safe Undo.
// Fixtures are built here from the documented export shapes.
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const C = require(path.join(ROOT, "wiki/core.js"));
const W = require(path.join(ROOT, "wiki/import.js"));
const Zip = require(path.join(ROOT, "atelier/zip.js"));

const enc = (s) => new TextEncoder().encode(s);
const zip = (files) => Zip.write(Object.keys(files).map((name) => ({ name, data: typeof files[name] === "string" ? enc(files[name]) : files[name] })));
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const OPT = { lang: "en", untitled: "Untitled" };
const WID = "wtestwiki01";
function bundle(items) { return W.readBundle(items, Zip); }
function byT(res, t) { return res.pages.filter((p) => p.t === t)[0]; }
// parse → plan → apply into data; returns { data, pl, r }
function run(data, res, extra) {
  const pl = W.plan(data, WID, res, { untitled: "Untitled" });
  const r = W.apply(data, pl, res, Object.assign({ now: 1800000000000, sum: "Imported", lang: "en", catWord: "Category", picIds: res.pics.map(() => "") }, extra || {}));
  return { data: C.merge(r.data, null), pl, r };
}
function art(data, t) { return data.arts.filter((a) => a.t === t)[0]; }
const emptyWiki = () => C.merge({ ver: 1, wikis: [{ id: WID, m: 1, n: "Mine", main: "" }], arts: [], tombs: {} }, null);

// ---------- Notion ----------
const G = "0123456789abcdef0123456789abcdef", O = "fedcba9876543210fedcba9876543210";
const D = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", F = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
function notionZip(gardenText) {
  const inner = zip({
    [`Garden ${G}.md`]: gardenText || `# Garden\n\nSee [Olives](Garden%20${G}/Olives%20${O}.md) and [Plants](Garden%20${G}/Plants%20${D}.csv).\n\n![](Garden%20${G}/photo.png)\n\nAlso [web](https://www.notion.so/Olives-${O}).`,
    [`Garden ${G}/Olives ${O}.md`]: `# Olives\n\nBack to [Garden](../Garden%20${G}.md).`,
    [`Garden ${G}/Plants ${D}.csv`]: "Name,Kind\nFig,Tree\nRose,Bush\n",
    [`Garden ${G}/Plants ${D}_all.csv`]: "﻿Name,Kind\nFig,Tree\nRose,Bush\nMint,Herb|x\n",
    [`Garden ${G}/Plants ${D}/Fig ${F}.md`]: "# Fig\n\nKind: Tree",
    [`Garden ${G}/photo.png`]: PNG
  });
  return zip({ "Export-1234-Part-1.zip": inner });
}

test("Notion: ZIP in a ZIP, ids stripped, subpages, links, database table, picture", async () => {
  const b = await bundle([{ name: "Export-1234.zip", bytes: notionZip() }]);
  assert.strictEqual(W.detect(b), "notion");
  const res = W.parse(b, OPT);
  assert.deepStrictEqual(res.pages.map((p) => p.t).sort(), ["Fig", "Garden", "Olives", "Plants"]);
  assert.strictEqual(res.pics.length, 1);
  const { data } = run(emptyWiki(), res, { picIds: ["c".repeat(64) + ".png"] });
  const g = art(data, "Garden").x;
  assert.match(g, /\[\[Olives\]\]/);
  assert.match(g, /\[\[Plants\]\]/);
  assert.match(g, /\[\[Olives\|web\]\]/);                 // notion.so link to a page of the export
  assert.match(g, /\[\[File:c{64}\.png/);
  assert.ok(![G, O, D].some((id) => g.indexOf(id) >= 0), "no Notion ids left");
  assert.match(art(data, "Olives").x, /Back to \[\[Garden\]\]\.\n\n\[\[Category:Garden\]\]$/);
  const pl = art(data, "Plants").x;
  assert.match(pl, /^\| Name \| Kind \|/);
  assert.match(pl, /\| \[\[Fig\]\] \| Tree \|/);         // row page linked
  assert.match(pl, /Mint \| Herb\\\|x/);                // the _all.csv won, | escaped
  assert.match(pl, /\[\[Category:Garden\]\]$/);
  assert.match(art(data, "Fig").x, /\[\[Category:Plants\]\]$/);
  assert.strictEqual(data.arts.length, 4);
});

test("Re-import: same → nothing, changed source → update, edited by you → kept; Undo is sync-safe", async () => {
  const res1 = W.parse(await bundle([{ name: "n.zip", bytes: notionZip() }]), OPT);
  const first = run(emptyWiki(), res1);
  assert.strictEqual(first.pl.n.add, 4);
  let data = first.data;
  // same file again: nothing to do
  const again = W.plan(data, WID, res1, {});
  assert.deepStrictEqual([again.n.add, again.n.update, again.n.same], [0, 0, 4]);
  // the person edits Olives (a normal save: new random revision)
  const ol = art(data, "Olives");
  data = C.merge(Object.assign({}, data, { arts: data.arts.map((a) => a.id === ol.id ? C.normArt(Object.assign({}, a, { x: "My own text", r: C.uid("r"), anc: [a.r].concat(a.anc), m: a.m + 5 })) : a) }), null);
  // a newer export: Garden changed, Olives too
  const z2 = notionZip(`# Garden\n\nNew text about [Olives](Garden%20${G}/Olives%20${O}.md).`);
  const res2 = W.parse(await bundle([{ name: "n.zip", bytes: z2 }]), OPT);
  const second = run(data, res2, { now: 1800000001000 });
  assert.strictEqual(second.pl.n.update, 1);
  assert.strictEqual(second.pl.n.edited, 1);
  assert.strictEqual(second.pl.n.add, 0);
  assert.strictEqual(art(second.data, "Olives").x, "My own text");
  assert.match(art(second.data, "Garden").x, /^New text about \[\[Olives\]\]\./);
  assert.strictEqual(second.data.arts.length, 4);
  // another device got the import, then this one undoes it
  const other = C.merge(second.data, null);
  const undone = C.merge(W.undo(second.data, second.r.info, 1800000002000), null);
  assert.match(art(undone, "Garden").x, /^See \[\[Olives\]\]/);
  const synced = C.merge(other, undone);
  assert.deepStrictEqual(synced.arts.map((a) => [a.t, a.x]), undone.arts.map((a) => [a.t, a.x]));
  assert.deepStrictEqual(synced.arts.every((a) => !a.alt.length), true);
  // the restored text is still "imported, untouched": a re-import updates it again
  assert.strictEqual(W.plan(undone, WID, res2, {}).n.update, 1);
  // undo of a first import: tombstones newer than the articles
  const gone = C.merge(W.undo(first.data, first.r.info, 1800000003000), null);
  assert.strictEqual(gone.arts.length, 0);
  assert.strictEqual(C.merge(first.data, gone).arts.length, 0);
});

test("Titles taken by the person's own articles get a number, links follow", async () => {
  const mine = C.normArt({ id: "amine000001", m: 5, w: WID, t: "Olives", x: "mine", r: "rmine000001", anc: [], alt: [] });
  const data = C.merge(Object.assign(emptyWiki(), { arts: [mine] }), null);
  const res = W.parse(await bundle([{ name: "n.zip", bytes: notionZip() }]), OPT);
  const { data: d, pl } = run(data, res);
  assert.strictEqual(pl.n.renamed, 1);
  assert.strictEqual(art(d, "Olives").x, "mine");
  assert.match(art(d, "Garden").x, /\[\[Olives \(2\)\|Olives\]\]/);
});

// ---------- TiddlyWiki ----------
const TIDDLERS = [
  { title: "$:/SiteTitle", text: "Plant notes" },
  { title: "$:/core/ui/x", text: "system" },
  { title: "HelloThere", text: "! Welcome\n\n''Bold'' and //italic// at https://example.com//x\n\n* one\n** two\n# first\n\nSee [[Second Tiddler]], [[the other|Second Tiddler]], [[ext|https://example.org]] and {{Second Tiddler||tpl}}.\n<<list-links>> <$button>x</$button>\n\n|!A|!B|h\n|1|2|\n\n!!! Small", tags: "[[Start Here]] notes $:/tags/x", created: "20240102030405006", modified: "20250607080910111", type: "text/vnd.tiddlywiki" },
  { title: "Second Tiddler", text: "Back to [[HelloThere]]", created: "20230101000000000" },
  { title: "Picture", text: "iVBORw0KGgo=", type: "image/png" },
  { title: "Draft of 'X'", text: "draft", "draft.of": "X" }
];
test("TiddlyWiki JSON: system tiddlers skipped, WikiText → markup, tags → categories", async () => {
  const b = await bundle([{ name: "tiddlers.json", bytes: enc(JSON.stringify(TIDDLERS)) }]);
  assert.strictEqual(W.detect(b), "tiddlywiki");
  const res = W.parse(b, OPT);
  assert.strictEqual(res.name, "Plant notes");
  assert.deepStrictEqual(res.pages.map((p) => p.t), ["HelloThere", "Second Tiddler"]);
  assert.deepStrictEqual(res.skipped, { system: 3, other: 1, empty: 0, cut: 0 });
  assert.deepStrictEqual(res.range, [Date.UTC(2023, 0, 1), Date.UTC(2025, 5, 7, 8, 9, 10, 111)]);
  const { data } = run(emptyWiki(), res);
  const x = art(data, "HelloThere").x;
  assert.match(x, /^== Welcome ==/);
  assert.match(x, /\*\*Bold\*\* and \*italic\* at https:\/\/example\.com\/\/x/);
  assert.match(x, /^- one\n  - two\n1\. first$/m);
  assert.match(x, /See \[\[Second Tiddler\]\], \[\[Second Tiddler\|the other\]\], \[ext\]\(https:\/\/example\.org\) and \[\[Second Tiddler\]\]\./);
  assert.ok(!/<<|\$button|<\$/.test(x));
  assert.match(x, /\| A \| B \|\n\|---\|---\|\n\| 1 \| 2 \|/);
  assert.match(x, /==== Small ====/);
  assert.match(x, /\[\[Category:Start Here\]\]\n\[\[Category:notes\]\]$/);
  assert.strictEqual(art(data, "HelloThere").c, Date.UTC(2024, 0, 2, 3, 4, 5, 6));
  assert.match(art(data, "Second Tiddler").x, /^Back to \[\[HelloThere\]\]$/);
});

test("TiddlyWiki HTML: tiddler store and the older storeArea, read as text", async () => {
  const store = JSON.stringify(TIDDLERS.slice(2, 4)).replace(/</g, "\\u003C");
  const html = `<!doctype html><html><head><script>window.bad = 1</script></head><body>
<script class="tiddlywiki-tiddler-store" type="application/json">${store}</script></body></html>`;
  const res = W.parse(await bundle([{ name: "wiki.html", bytes: enc(html) }]), OPT);
  assert.strictEqual(res.source, "tiddlywiki");
  assert.deepStrictEqual(res.pages.map((p) => p.t), ["HelloThere", "Second Tiddler"]);
  const old = `<html><body><div id="storeArea"><div title="Old &amp; gold" tags="classic" created="20200101000000000"><pre>!! Head
x &lt;b&gt; [[New one]]</pre></div><div title="$:/temp">t</div></div></body></html>`;
  const res2 = W.parse(await bundle([{ name: "old.html", bytes: enc(old) }]), OPT);
  assert.deepStrictEqual(res2.pages.map((p) => p.t), ["Old & gold"]);
  const { data } = run(emptyWiki(), res2);
  assert.match(art(data, "Old & gold").x, /^=== Head ===\n\nx +\[\[New one\]\]\n\n\[\[Category:classic\]\]$/);
});

// ---------- MediaWiki ----------
const MW = `<mediawiki xmlns="http://www.mediawiki.org/xml/export-0.11/" version="0.11">
<siteinfo><sitename>Fan Wiki</sitename><namespaces><namespace key="14" case="first-letter">Κατηγορία</namespace></namespaces></siteinfo>
<page><title>Main Page</title><ns>0</ns><id>1</id>
<revision><id>1</id><timestamp>2020-01-01T00:00:00Z</timestamp><text xml:space="preserve">old text</text></revision>
<revision><id>2</id><timestamp>2021-05-01T10:00:00Z</timestamp><text xml:space="preserve">== Intro ==
'''Bold''' and ''italic''. See [[Second page|the second]] and [http://example.com Example].
* a
*# b
{{Some template|x=1}}
{| class="wikitable"
! H1 !! H2
|-
| c1 || c2
|}
[[Category:Topics]] [[Κατηγορία:Θέματα]]</text></revision></page>
<page><title>Second page</title><ns>0</ns><revision><timestamp>2022-02-02T00:00:00Z</timestamp><text>Hi &lt;b&gt;there&lt;/b&gt; [[Main Page]]</text></revision></page>
<page><title>Old name</title><ns>0</ns><redirect title="Second page" /><revision><timestamp>2022-02-02T00:00:00Z</timestamp><text>#REDIRECT [[Second page]]</text></revision></page>
<page><title>User:Me</title><ns>2</ns><revision><timestamp>2022-02-02T00:00:00Z</timestamp><text>me</text></revision></page>
</mediawiki>`;
test("MediaWiki XML: latest revision, main namespace, wikitext → markup, categories, redirects", async () => {
  const b = await bundle([{ name: "dump.xml", bytes: enc(MW) }]);
  assert.strictEqual(W.detect(b), "mediawiki");
  const res = W.parse(b, OPT);
  assert.strictEqual(res.name, "Fan Wiki");
  assert.deepStrictEqual(res.pages.map((p) => p.t), ["Main Page", "Second page", "Old name"]);
  assert.strictEqual(res.skipped.other, 1);
  const { data } = run(emptyWiki(), res);
  const x = art(data, "Main Page").x;
  assert.ok(!/old text/.test(x));
  assert.match(x, /^== Intro ==/);
  assert.match(x, /\*\*Bold\*\* and \*italic\*\. See \[\[Second page\|the second\]\] and \[Example\]\(http:\/\/example\.com\)\./);
  assert.match(x, /- a\n\s+1\. b/);
  assert.match(x, /\| H1 \| H2 \|\n\|---\|---\|\n\| c1 \| c2 \|/);
  assert.match(x, /\[\[Category:Topics\]\]\n\[\[Category:Θέματα\]\]$/);
  assert.ok(!/Some template/.test(x));
  assert.match(art(data, "Second page").x, /Hi \*\*there\*\* \[\[Main Page\]\]/);
  assert.strictEqual(C.info(art(data, "Old name")).redirect, "Second page");
});

// ---------- Confluence ----------
function page(title, crumbs, body) {
  return `<!DOCTYPE html><html><head><title>Team Space : ${title}</title><script>alert(1)</script></head><body>
<div id="main-header"><div id="breadcrumb-section"><ol id="breadcrumbs">${crumbs}</ol></div>
<h1 id="title-heading" class="pagetitle"><span id="title-text"> Team Space : ${title} </span></h1></div>
<div id="content" class="view"><div id="main-content" class="wiki-content group">${body}</div>
<div class="pageSection group"><h2 id="attachments">Attachments:</h2></div></div>
<div id="footer">Document generated by Confluence</div></body></html>`;
}
test("Confluence space export: HTML → markup, breadcrumbs → categories, links and pictures", async () => {
  const z = zip({
    "TS/index.html": "<html><head><title>Team Space</title></head><body><h2>Available Pages:</h2></body></html>",
    "TS/Home_65537.html": page("Home", '<li><a href="index.html">Team Space</a></li>',
      '<h2>Start</h2><p>Hello <strong>team</strong> &amp; <em>friends</em>, see <a href="Child-Page_65538.html">the child</a> or <a href="https://example.com/x">site</a>.<p># not a heading<ul><li>one<ul><li>nested</li></ul><li>two</ul><ol><li>first</li></ol>' +
      '<div class="code panel pdl"><div class="codeContent panelContent pdl"><pre class="syntaxhighlighter-pre">let a = 1 &lt; 2;\nrun()</pre></div></div>' +
      '<div class="table-wrap"><table class="confluenceTable"><tbody><tr><th>K</th><th>V</th></tr><tr><td>a|b</td><td><p>x</p><table><tr><td>inner</td></tr></table></td></tr></tbody></table></div>' +
      '<p><img class="confluence-embedded-image" src="attachments/65537/123.png" alt="Diagram"><img src="images/icons/emoticons/smile.png" alt="(smile)"></p><script>bad()</script>'),
    "TS/Child-Page_65538.html": page("Child Page", '<li><a href="index.html">Team Space</a></li><li><a href="Home_65537.html">Home</a></li>',
      '<p>Up: <a href="/pages/viewpage.action?pageId=65537">home</a>, file <a href="attachments/65538/doc.pdf">doc.pdf</a></p>'),
    "TS/attachments/65537/123.png": PNG,
    "TS/styles/site.css": "body{}"
  });
  const b = await bundle([{ name: "Confluence-space-export.zip", bytes: z }]);
  assert.strictEqual(W.detect(b), "confluence");
  const res = W.parse(b, OPT);
  assert.strictEqual(res.name, "Team Space");
  assert.deepStrictEqual(res.pages.map((p) => p.t), ["Home", "Child Page"]);
  assert.strictEqual(res.pics.length, 1);
  const { data } = run(emptyWiki(), res);
  const x = art(data, "Home").x;
  assert.match(x, /^== Start ==\n\nHello \*\*team\*\* & \*friends\*, see \[\[Child Page\|the child\]\] or \[site\]\(https:\/\/example\.com\/x\)\./);
  assert.match(x, /\n\\# not a heading\n/);
  assert.match(x, /- one\n  - nested\n- two\n\n1\. first/);
  assert.match(x, /```\nlet a = 1 < 2;\nrun\(\)\n```/);
  assert.match(x, /\| K \| V \|\n\|---\|---\|\n\| a\\\|b \| x inner \|/);
  assert.match(x, /Diagram/);
  assert.ok(!/alert|bad\(\)|smile\.png/.test(x));
  const c = art(data, "Child Page").x;
  assert.match(c, /^Up: \[\[Home\]\], file doc\.pdf\n\n\[\[Category:Home\]\]$/);
});

// ---------- Markdown (the wave 3 import, now with stable ids) ----------
test("Markdown .zip: folders → categories, .md links, re-import adds nothing", async () => {
  const z = zip({ "Vault/Trees/Olive.md": "# Olive\n\nSee [fig](Fig.md).", "Vault/Trees/Fig.md": "Figs.", "Vault/media/a.png": PNG });
  const res = W.parse(await bundle([{ name: "v.zip", bytes: z }]), OPT);
  assert.strictEqual(res.source, "markdown");
  const { data } = run(emptyWiki(), res);
  assert.match(art(data, "Olive").x, /^See \[\[Fig\]\]\.\n\n\[\[Category:Trees\]\]$/);
  assert.strictEqual(W.plan(data, WID, res, {}).n.same, 2);
});

test("Nothing from a file becomes a token; ids are valid; detect is empty for unknown files", async () => {
  const b = await bundle([{ name: "x.md", bytes: enc("# T\n\nA \u0004 0 \u0004 and \u0002 0 \u0002 x \u0003") }]);
  const res = W.parse(b, OPT);
  assert.ok(!/[\u0001-\u0005]/.test(res.pages[0].x));
  assert.match(W.artId(WID, "notion", "k"), C.ART_RE);
  const b2 = await bundle([{ name: "a.bin", bytes: enc("hello") }]);
  assert.strictEqual(W.detect(b2), "");
  assert.strictEqual(W.parse(b2, OPT), null);
});
