// Wiki wave 2 (wiki/core.js 1.1.0, wiki/pdf.js): pictures, galleries,
// infobox, references, the renderer's safety for them (an <img> never
// gets a src from markup), the editing helpers behind the toolbar
// dialogs (table, infobox, citation, picture text) and the PDF.
// Run: node --test tests/*.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const C = require(path.join(ROOT, "wiki/core.js"));
const PDF = require(path.join(ROOT, "wiki/pdf.js"));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

const ID = "0123456789abcdef".repeat(4) + ".jpg";
const PNG = "fedcba9876543210".repeat(4) + ".png";

// Minimal DOM that records every attribute written.
function fakeDoc() {
  const attrs = [];
  function node(tag) {
    return {
      tagName: tag, children: [], attrs: {}, style: {}, className: "", id: "",
      appendChild(c) { this.children.push(c); return c; },
      setAttribute(k, v) { this.attrs[k] = String(v); attrs.push([tag, k, String(v)]); },
      get lastElementChild() { return this.children.filter((c) => c.tagName).slice(-1)[0] || null; },
      set textContent(v) { this.children = [{ text: String(v) }]; },
      set innerHTML(v) { throw new Error("innerHTML used"); },
      set src(v) { throw new Error("src set by the renderer"); }
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

const SAMPLE = `{{infobox
| title = Olive tree
| image = File:${ID}
| caption = An old tree
| Family = [[Oleaceae]]
| Native to = the
  Mediterranean
| Empty =
}}
The **olive**[^1] is a tree.[^b] Again[^1].

[[File:${PNG}|left|200px|A [[grove]] in Crete]]

{{gallery
File:${ID}|One
[[Αρχείο:${PNG}|Δύο]]
File:../../etc/passwd|Bad
}}

## Uses
Oil.

[^1]: *Trees*. Oxford, 2001.
[^b]: [Olive](https://example.com)
  continued.
[^z]: Unused.
[[Category:Trees]]`;

test("parser: infobox, picture, gallery and references", () => {
  const d = C.parseDoc(SAMPLE);
  assert.deepEqual(d.blocks.map((b) => b.k), ["ibox", "p", "fig", "gal", "h", "p"]);
  const ib = d.blocks[0];
  assert.equal(C.inlineText(ib.title), "Olive tree");
  assert.equal(ib.img.id, ID);
  assert.deepEqual(ib.rows.map((r) => [C.inlineText(r.k), C.inlineText(r.v)]), [["Family", "Oleaceae"], ["Native to", "the Mediterranean"]]);
  const fig = d.blocks[2];
  assert.deepEqual([fig.id, fig.al, fig.w, C.inlineText(fig.c)], [PNG, "left", 200, "A grove in Crete"]);
  const gal = d.blocks[3];
  assert.deepEqual(gal.items.map((i) => i.id), [ID, PNG, ""]);
  assert.equal(gal.items[2].raw, "../../etc/passwd");
  // links inside the infobox and captions count; categories still work
  assert.deepEqual(d.links, ["Oleaceae", "grove"]);
  assert.deepEqual(d.cats, ["Trees"]);
  // references: numbered by first use, uses counted, unused definitions listed last
  assert.deepEqual(d.refs.map((r) => [r.key, r.n, r.uses, C.inlineText(r.c)]), [
    ["1", 1, 2, "Trees. Oxford, 2001."], ["b", 2, 1, "Olive continued."], ["z", 3, 0, "Unused."]
  ]);
  const refsInText = d.blocks[1].c.filter((n) => n.k === "ref");
  assert.deepEqual(refsInText.map((n) => [n.n, n.i]), [[1, 1], [2, 1], [1, 2]]);
  assert.deepEqual(C.images(d), [ID, PNG]);
});

test("parser: picture options, Greek words, bad ids, escapes and code", () => {
  const p = C.fileParts(`Αρχείο:${ID}|κέντρο|alt=Two trees|99999px|thumb|Caption \\| with pipe`);
  assert.deepEqual([p.id, p.al, p.w, p.alt, p.cap], [ID, "center", 1200, "Two trees", "Caption \\| with pipe"]);
  assert.equal(C.fileParts("File:ABC.jpg").id, "");
  assert.equal(C.fileParts(`File:${ID.toUpperCase()}`).id, ID);           // ids are lower case
  assert.equal(C.fileParts("File:javascript:alert(1)").id, "");
  // escaped and fenced forms stay text
  const d = C.parseDoc("\\[^1] and `[^2]`\n\n```\n[[File:" + ID + "]]\n{{infobox\n```\n");
  assert.deepEqual(d.refs, []);
  assert.deepEqual(d.blocks.map((b) => b.k), ["p", "pre"]);
  // a picture inside a sentence is an inline picture
  const inl = C.parseDoc(`Leaf [[File:${ID}|20px|leaf]] here`).blocks[0].c;
  assert.deepEqual(inl.map((n) => n.k), ["t", "img", "t"]);
  // {{references}} places the list; an unknown {{word}} is just text
  assert.deepEqual(C.parseDoc("a[^1]\n\n{{παραπομπές}}\n\n{{unknown}}\n\n[^1]: x").blocks.map((b) => b.k), ["p", "refs", "p"]);
});

test("renderer: pictures carry only data-img (no src), references link inside the page", () => {
  const D = fakeDoc();
  const frag = C.render(D, C.parseDoc(SAMPLE + "\n\n<img src=x onerror=alert(1)>"), { state: () => "ok", refs: "References", refUp: "Back", refMissing: "missing" });
  const imgs = find(frag, (n) => n.tagName === "img");
  assert.equal(imgs.length, 4);                                      // infobox, figure, 2 good ones in the gallery
  assert.ok(imgs.every((i) => C.IMG_RE.test(i.attrs["data-img"]) && i.attrs.src === undefined));
  assert.equal(find(frag, (n) => n.className === "img-bad").length, 1);   // the ../../etc/passwd item
  assert.match(textOf(frag), /<img src=x onerror=alert\(1\)>/);          // still text
  assert.equal(find(frag, (n) => n.tagName === "aside" && n.className === "ibox").length, 1);
  assert.equal(find(frag, (n) => n.tagName === "figure" && /fig-left/.test(n.className))[0].style.width, "200px");
  // references: sup links, the list in its own last section, back links
  const sups = find(frag, (n) => n.tagName === "sup");
  assert.deepEqual(sups.map((s) => [s.attrs.id, textOf(s)]), [["cite-1-1", "[1]"], ["cite-b-1", "[2]"], ["cite-1-2", "[1]"]]);
  const sec = find(frag, (n) => n.className === "sec refs-sec");
  assert.equal(sec.length, 1);
  assert.equal(textOf(find(sec[0], (n) => n.tagName === "h2")[0]), "References");
  const lis = find(sec[0], (n) => n.tagName === "li");
  assert.deepEqual(lis.map((l) => l.attrs.id), ["ref-1", "ref-b", "ref-z"]);
  assert.equal(find(lis[0], (n) => n.attrs && n.attrs["data-cite"])[0].attrs["data-cite"], "cite-1-1");
  assert.equal(find(lis[2], (n) => n.attrs && n.attrs["data-cite"]).length, 0);   // unused: no back link
  const allowed = new Set(["href", "target", "rel", "data-to", "data-frag", "data-cat", "data-anchor", "data-sec", "type",
    "data-img", "alt", "loading", "width", "id", "data-ref", "data-cite", "aria-label", "value", "scope"]);
  assert.ok(D.attrs.every(([, k]) => allowed.has(k)), JSON.stringify(D.attrs.filter(([, k]) => !allowed.has(k))));
  assert.ok(D.attrs.filter(([, k]) => k === "href").every(([, , v]) => v === "#" || /^(https?:|mailto:)/.test(v)));
});

test("renderer: {{references}} places the list once; a missing definition is marked", () => {
  const D = fakeDoc();
  const frag = C.render(D, C.parseDoc("A[^x].\n\n## Notes\n{{references}}\n\n## After\nz"), { refMissing: "no text" });
  assert.equal(find(frag, (n) => n.className === "sec refs-sec").length, 0);
  const ol = find(frag, (n) => n.tagName === "ol" && n.className === "refs");
  assert.equal(ol.length, 1);
  assert.match(textOf(ol[0]), /no text/);
});

test("plain text and search include captions, infobox facts and references", () => {
  const x = C.plainText(SAMPLE);
  for (const s of ["Olive tree", "Family: Oleaceae", "A grove in Crete", "One", "Trees. Oxford, 2001."]) assert.ok(x.includes(s), s);
  assert.ok(!x.includes(ID));
  const P = require(path.join(ROOT, "wiki/search.js"));
  const d = { wikis: [{ id: "wabc1234", n: "Home" }], arts: [{ id: "aabc1234", m: 1, w: "wabc1234", t: "Olive", x: SAMPLE }], tombs: {} };
  const hit = P.search({ readJSON: () => d })[0];
  assert.ok(!hit.text.includes(ID) && !hit.text.includes("{{") && !hit.text.includes("[^"), hit.text);
  assert.ok(hit.text.includes("Oleaceae") && hit.text.includes("One"), hit.text);
});

test("table editor helpers: find the table at the caret, write it back, keep pipes", () => {
  const text = "Intro\n\n| A | B |\n|:--|--:|\n| [[x|y]] | a\\|b |\n| `c|d` |  |\n\nAfter";
  const t = C.tableAt(text, text.indexOf("a\\|b"));
  assert.deepEqual([t.head, t.al, t.rows], [["A", "B"], ["left", "right"], [["[[x|y]]", "a\\|b"], ["`c|d`", ""]]]);
  assert.equal(text.slice(t.start, t.end).split("\n").length, 4);
  const out = C.tableText(["A", "B|C", ""], [["1"], ["x\ny", "", "z"]], ["", "center"]);
  assert.equal(out, "| A | B\\|C |  |\n|---|:---:|---|\n| 1 |  |  |\n| x y |  | z |");
  const back = C.parseDoc(out).blocks[0];
  assert.equal(back.k, "table");
  assert.equal(C.inlineText(back.head[1]), "B|C");
  // round trip: what the dialog reads is what it writes
  assert.equal(C.tableText(t.head, t.rows, t.al), text.slice(t.start, t.end).replace("|:--|--:|", "|:---|---:|"));
  assert.equal(C.tableAt("no table here", 3), null);
  assert.equal(C.tableAt("| just | one line |", 3), null);
});

test("infobox helpers: read the block, write it in EN or EL, keep other text", () => {
  const blk = C.blockAt(SAMPLE, 9999, "ibox");                    // caret elsewhere: the first one
  assert.equal(SAMPLE.slice(blk.start, blk.end).split("\n").pop(), "}}");
  const o = C.iboxParse(blk.body);
  assert.deepEqual(o, { title: "Olive tree", image: ID, caption: "An old tree", rows: [["Family", "[[Oleaceae]]"], ["Native to", "the Mediterranean"], ["Empty", ""]] });
  const el = C.iboxText(Object.assign({}, o, { rows: o.rows.concat([["Bad = key | x", "v\nw"], ["title", "dropped"]]) }), "el");
  assert.equal(el.split("\n")[0], "{{πλαίσιο");
  assert.ok(el.includes("| εικόνα = Αρχείο:" + ID));
  assert.ok(el.includes("| Bad key x = v w"));
  assert.ok(!el.includes("dropped"));
  // what was written parses back to the same fields
  const again = C.iboxParse(C.templates(el)[0].body);
  assert.equal(again.title, "Olive tree");
  assert.equal(again.image, ID);
  assert.equal(C.iboxText({ title: "T", image: "nope.jpg", rows: [] }, "en"), "{{infobox\n| title = T\n}}");
  // blocks inside code are not templates
  assert.deepEqual(C.templates("```\n{{infobox\n```\n"), []);
});

test("picture + gallery text, citations and references", () => {
  assert.equal(C.fileText(ID, { al: "left", w: 9000, cap: "A | b ]] c" }, "en"), `[[File:${ID}|left|1200px|A \\| b ] ] c]]`);
  assert.equal(C.fileText(ID, { al: "right" }, "el"), `[[Αρχείο:${ID}]]`);
  const g = C.galleryText([{ id: ID, cap: "One" }, { id: PNG, cap: "" }], "el");
  assert.equal(g, `{{γκαλερί\nΑρχείο:${ID}|One\nΑρχείο:${PNG}\n}}`);
  assert.deepEqual(C.parseDoc(g).blocks[0].items.map((i) => i.id), [ID, PNG]);
  // citations: markup signs in fields are escaped, unsafe URLs dropped
  assert.equal(C.citeText("book", { author: "Smith, J.", title: "Olives *and* oil", publisher: "OUP", year: "2001", pages: "12", isbn: "978" }, { pages: "σ." }),
    "Smith, J. *Olives \\*and\\* oil*. OUP, 2001. σ. 12. ISBN 978.");
  assert.equal(C.citeText("web", { title: "Olive", url: "https://ex.org/a", site: "Ex", date: "2026-10-14" }, { retrieved: "Ανακτήθηκε" }),
    "[Olive](https://ex.org/a). *Ex*. Ανακτήθηκε 2026-10-14.");
  assert.equal(C.citeText("web", { title: "x", url: "javascript:alert(1)" }, {}), "x.");
  assert.equal(C.citeText("person", { name: "Maria", how: "" , date: "2020" }, { interview: "Interview" }), "Maria. Interview, 2020.");
  assert.equal(C.citeText("note", {}, {}), "");
  const cite = C.parseInline(C.citeText("web", { title: "a](javascript:x)", url: "https://ok.org" }, {}), 0, { links: [], cats: [], noRef: true }).nodes;
  assert.equal(cite.filter((n) => n.k === "xl").map((n) => n.href).join(), "https://ok.org");
  // references: the next number, the mark at the caret, the line before the categories
  assert.equal(C.nextRefName("a[^2] b[^10] c[^x]"), "11");
  const r = C.addRef("Hello world.\n\n[[Category:A]]\n", 5, "1", "Def");
  assert.equal(r.text, "Hello[^1] world.\n\n[^1]: Def\n\n[[Category:A]]\n");
  assert.equal(r.pos, 9);
  const r2 = C.addRef(r.text, 0, "2", "Second");
  assert.equal(r2.text, "[^2]Hello[^1] world.\n\n[^1]: Def\n[^2]: Second\n\n[[Category:A]]\n");
  assert.deepEqual(C.parseDoc(r2.text).refs.map((x) => C.inlineText(x.c)), ["Second", "Def"]);
});

test("pdf: an article with every block becomes a PDF (Greek fonts, pictures)", () => {
  const { jsPDF } = require(path.join(ROOT, "vendor/jspdf.umd.min.js"));
  const fonts = {};
  PDF.FONTS.forEach((n) => { fonts[n] = fs.readFileSync(path.join(ROOT, "vendor/noto", n + ".ttf")).toString("base64"); });
  // a 2 × 2 PNG
  const png = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==", "base64"));
  const x = SAMPLE + "\n\n- α\n  - β\n1. γ\n\n> παράθεση\n\n| Α | Β |\n|---|--:|\n| 1 | 2 |\n\n```\ncode\n```\n\n---\n" + "\n\nΚείμενο. ".repeat(400);
  const pdf = PDF.build(jsPDF, fonts, { title: "Ελιά", sub: "Wiki · today", parsed: C.parseDoc(x), imgs: { [PNG]: { data: png, w: 2, h: 2 } }, L: { refs: "Παραπομπές", missingImg: "χωρίς εικόνα" } });
  assert.ok(pdf.getNumberOfPages() >= 2);
  const out = Buffer.from(pdf.output("arraybuffer"));
  assert.equal(out.slice(0, 5).toString(), "%PDF-");
  assert.ok(out.length > 20000);
  // inline runs keep styles and the reference number
  const runs = PDF.runs(C.parseInline("a **b** [[c]] `d`", 0).nodes.concat([{ k: "ref", n: 3 }]));
  assert.deepEqual(runs.map((r) => [r.s, !!r.b, !!r.link, !!r.code, !!r.sup]), [["a ", false, false, false, false], ["b", true, false, false, false], [" ", false, false, false, false], ["c", false, true, false, false], [" ", false, false, false, false], ["d", false, false, true, false], ["[3]", false, false, false, true]]);
});

test("wiring: assets + pdf scripts, toolbar tools, hydrate sets src only from blob: URLs", () => {
  const html = read("wiki/index.html");
  const js = read("wiki/wiki.js");
  assert.ok(html.indexOf("../designkit/assets.js") < html.indexOf("wiki.js"));
  assert.ok(html.indexOf("pdf.js") > -1 && html.indexOf("pdf.js") < html.indexOf("wiki.js"));
  for (const id of ["form", "form-body", "form-actions", "lightbox", "lb-img"]) assert.match(html, new RegExp('id="' + id + '"'));
  for (const k of ["img", "gal", "ibox", "cite", "table"]) assert.match(js, new RegExp('\\["' + k + '", '));
  // the only places that set a picture's src
  const srcs = js.match(/\w+\.src = [^;]+;/g) || [];
  assert.deepEqual(srcs.sort(), ["box.src = im.src;", "im.src = imgUrls[id];", "im.src = u;", 'sc.src = "../vendor/jspdf.umd.min.js";'].sort());
  assert.match(js, /imgUrls\[id\] = URL\.createObjectURL\(b\)/);
  // help pages describe the new tools
  assert.match(read("wiki/help.en.txt"), /infobox/i);
  assert.match(read("wiki/help.el.txt"), /παραπομπ/i);
});
