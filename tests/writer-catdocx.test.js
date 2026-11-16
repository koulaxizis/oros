// Writer book translation into the original Word file (writer/catdocx.js,
// WR-CAT T4): Word paragraphs as segments, run formatting as tags,
// fields, pieces, and the package written back with only the text
// changed.
// Run: node --test tests/

"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("../writer/catdocx.js");
const C = require("../writer/catcore.js");

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const enc = s => new TextEncoder().encode(s);
const dec = b => new TextDecoder().decode(b);
function pkg(body, more) {
  const list = [
    { name: "[Content_Types].xml", data: enc("<Types/>") },
    { name: "word/document.xml", data: enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${NS}><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`) },
    { name: "word/styles.xml", data: enc(`<w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr><w:lang w:val="en-US" w:eastAsia="en-US" w:bidi="ar-SA"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style><w:style w:type="paragraph" w:styleId="1"><w:name w:val="heading 2"/></w:style></w:styles>`) },
    { name: "word/settings.xml", data: enc(`<w:settings ${NS}><w:proofState w:spelling="clean" w:grammar="clean"/></w:settings>`) },
    { name: "word/media/image1.png", data: new Uint8Array([137, 80, 78, 71, 1, 2, 3]) }
  ];
  return list.concat(more || []);
}
const R = (t, rpr) => `<w:r>${rpr || ""}<w:t xml:space="preserve">${t}</w:t></w:r>`;
const B = "<w:rPr><w:b/></w:rPr>";
const part = (entries, name) => dec(entries.find(e => e.name === name).data);

test("docx: paragraphs, headings, run formatting as tags, pieces", () => {
  const body =
    `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>${R("The Sea")}</w:p>` +
    `<w:p w:rsidR="00A1"><w:pPr><w:jc w:val="both"/></w:pPr><w:bookmarkStart w:id="0" w:name="_GoBack"/>${R("The old man ")}${R("was", B)}${R(" alone. He fished ")}<w:proofErr w:type="spellStart"/>${R("far")}<w:proofErr w:type="spellEnd"/>${R(" out.")}<w:bookmarkEnd w:id="0"/></w:p>` +
    `<w:p><w:r><w:drawing><wp:inline>image</wp:inline></w:drawing></w:r></w:p>` +
    `<w:p>${R("Line one")}<w:r><w:br/></w:r>${R("line two")}<w:r><w:tab/></w:r>${R("end")}</w:p>` +
    `<w:p><w:pPr><w:pStyle w:val="1"/></w:pPr>${R("Part &amp; whole &lt;1&gt;")}</w:p>`;
  const src = D.extract(pkg(body), "en");
  assert.equal(src.fmt, "docx");
  assert.deepEqual(src.segs.map(s => s.s), ["The Sea", "The old man ⟦1⟧was⟦/1⟧ alone.", "He fished far out.", "Line one", "line two⟦1/⟧end", "Part & whole <1>"]);
  assert.equal(src.blocks[0].h, 1);
  assert.equal(src.blocks[3].h, 2);
  assert.deepEqual(C.segTags(src, 1), [{ n: 1, kind: "p", name: "b" }]);
  assert.deepEqual(C.segTags(src, 4), [{ n: 1, kind: "v", name: "tab" }]);
  // the bookmarks are outside the sentences: no tag to move
  assert.match(src.blocks[1].lead, /w:bookmarkStart/);
  assert.match(src.blocks[1].trail, /w:bookmarkEnd/);
  // a stored project reads back the same
  assert.deepEqual(C.readSrc(JSON.parse(JSON.stringify(src))), src);
});

test("docx: build writes only the text, the rest byte for byte", () => {
  const body =
    `<w:p><w:pPr><w:jc w:val="both"/><w:rPr><w:lang w:val="en-GB"/></w:rPr></w:pPr>${R("The old man ")}${R("was", B)}${R(" alone. He fished.")}</w:p>` +
    `<w:tbl><w:tr><w:tc><w:p>${R("Cell text.")}</w:p></w:tc></w:tr></w:tbl>` +
    `<w:p><w:r><w:t>   </w:t></w:r></w:p>`;
  const entries = pkg(body);
  const src = D.extract(entries, "en");
  assert.equal(src.segs.length, 3);
  const rows = { 0: ["Ο γέρος ⟦1⟧ήταν⟦/1⟧ μόνος.", 2, 1], 1: ["Ψάρευε & <ψάρευε>.", 1, 2] };
  const out = D.build(src, rows, entries, { from: "en", to: "el" });
  const doc = part(out, "word/document.xml");
  assert.match(doc, /<w:jc w:val="both"\/><w:rPr><w:lang w:val="el-GR"\/><\/w:rPr><\/w:pPr>/);
  assert.match(doc, /<w:r><w:t xml:space="preserve">Ο γέρος <\/w:t><\/w:r><w:r><w:rPr><w:b\/><\/w:rPr><w:t xml:space="preserve">ήταν<\/w:t><\/w:r><w:r><w:t xml:space="preserve"> μόνος.<\/w:t><\/w:r>/);
  assert.match(doc, /Ψάρευε &amp; &lt;ψάρευε&gt;\./);
  assert.match(doc, /Cell text\./);                       // not translated: the source stays
  assert.match(doc, /<w:tbl><w:tr><w:tc><w:p>/);
  assert.match(doc, /<w:sectPr><w:pgSz w:w="11906" w:h="16838"\/><\/w:sectPr>/);
  assert.match(part(out, "word/styles.xml"), /<w:lang w:val="el-GR" w:eastAsia="en-US" w:bidi="ar-SA"\/>/);
  assert.doesNotMatch(part(out, "word/settings.xml"), /proofState/);
  // other parts are the very same bytes
  assert.equal(out.find(e => e.name === "word/media/image1.png"), entries.find(e => e.name === "word/media/image1.png"));
  assert.equal(out.find(e => e.name === "[Content_Types].xml"), entries[0]);
  // the same text again gives the same package
  const again = D.build(src, {}, entries, {});
  assert.match(part(again, "word/document.xml"), /The old man <\/w:t><\/w:r><w:r><w:rPr><w:b\/><\/w:rPr><w:t xml:space="preserve">was/);
  // another file under the same name is refused
  const other = pkg(body.replace("Cell", "Box"));
  assert.throws(() => D.build(src, rows, other, {}), /changed/);
});

test("docx: hyperlinks, fields, footnotes, pieces lost by the translation come back", () => {
  const body =
    `<w:p>${R("See ")}<w:hyperlink r:id="rId9" w:history="1"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t>the site</w:t></w:r></w:hyperlink>${R(" now")}<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="2"/></w:r>${R(" and later.")}</w:p>` +
    `<w:p>${R("Page ")}<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${R("4")}<w:r><w:fldChar w:fldCharType="end"/></w:r>${R(" of the book.")}</w:p>` +
    `<w:p>${R("See ")}<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> REF x </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${R("chapter one")}<w:r><w:fldChar w:fldCharType="end"/></w:r>${R(".")}</w:p>` +
    // a contents table: one field over three paragraphs stays as it is
    `<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> TOC \\o </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${R("Chapter one")}</w:p>` +
    `<w:p>${R("Chapter two")}</w:p>` +
    `<w:p>${R("Chapter three")}<w:r><w:fldChar w:fldCharType="end"/></w:r>${R(" After.")}</w:p>`;
  const notes = { name: "word/footnotes.xml", data: enc(`<w:footnotes ${NS}><w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:id="2"><w:p><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r>${R(" A note.")}</w:p></w:footnote></w:footnotes>`) };
  const hdr = { name: "word/header1.xml", data: enc(`<w:hdr ${NS}><w:p>${R("The Book")}</w:p></w:hdr>`) };
  const entries = pkg(body, [notes, hdr]);
  const src = D.extract(entries, "en");
  assert.deepEqual(src.segs.map(s => s.s), [
    "See ⟦1⟧the site⟦/1⟧ now⟦2/⟧ and later.", "Page ⟦1⟧4⟦/1⟧ of the book.", "See ⟦1⟧chapter one⟦/1⟧.", "After.", "The Book", "A note."]);
  assert.deepEqual(C.segTags(src, 0).map(x => x.name), ["a", "fn"]);
  assert.deepEqual(src.blocks.map(b => b.k), ["h", "h", "h", "h", "hdr", "fn"]);
  assert.equal(src.blocks[5].id, "2");
  const rows = {
    0: ["Δες ⟦1⟧τη σελίδα⟦/1⟧ τώρα και μετά.", 2, 1],              // the footnote number was left out
    1: ["Σελίδα ⟦1⟧4⟦/1⟧ του βιβλίου.", 2, 1],
    2: ["Δες ⟦1⟧το πρώτο κεφάλαιο.", 2, 1],                // a pair left open closes at the end
    5: ["Μια σημείωση.", 2, 1]
  };
  const out = D.build(src, rows, entries, { from: "en", to: "el" });
  const doc = part(out, "word/document.xml");
  assert.match(doc, /<w:hyperlink r:id="rId9" w:history="1"><w:r><w:rPr><w:rStyle w:val="Hyperlink"\/><\/w:rPr><w:t xml:space="preserve">τη σελίδα<\/w:t><\/w:r><\/w:hyperlink>/);
  assert.match(doc, /τώρα και μετά\.<\/w:t><\/w:r><w:r><w:rPr><w:rStyle w:val="FootnoteReference"\/><\/w:rPr><w:footnoteReference w:id="2"\/><\/w:r><\/w:p>/);
  assert.match(doc, /<w:instrText xml:space="preserve"> PAGE <\/w:instrText><\/w:r><w:r><w:fldChar w:fldCharType="separate"\/><\/w:r><w:r><w:t xml:space="preserve">4<\/w:t><\/w:r><w:r><w:fldChar w:fldCharType="end"\/><\/w:r>/);
  assert.match(doc, /το πρώτο κεφάλαιο\.<\/w:t><\/w:r><w:r><w:fldChar w:fldCharType="end"\/><\/w:r><\/w:p>/);
  assert.match(doc, /Chapter one<\/w:t><\/w:r><\/w:p><w:p><w:r><w:t xml:space="preserve">Chapter two/);
  assert.match(part(out, "word/footnotes.xml"), /<w:footnoteRef\/><\/w:r><w:r><w:t xml:space="preserve"> <\/w:t><\/w:r><w:r><w:t xml:space="preserve">Μια σημείωση\.<\/w:t><\/w:r>/);
  assert.match(part(out, "word/header1.xml"), /The Book/);
});

test("docx: not a Word package, a DTD, line breaks and tabs typed in", () => {
  assert.equal(D.extract([{ name: "content.xml", data: enc("<x/>") }], "en"), null);
  assert.throws(() => D.extract([{ name: "word/document.xml", data: enc(`<!DOCTYPE w [<!ENTITY e "x">]><w:document ${NS}><w:body><w:p>${R("Hi &e;")}</w:p></w:body></w:document>`) }], "en"), /dtd/);
  const entries = pkg(`<w:p>${R("One. Two.")}</w:p>`);
  const src = D.extract(entries, "en");
  const out = D.build(src, { 0: ["Ένα\tκαι\nδύο.", 2, 1], 1: ["", 2, 1] }, entries, {});
  assert.match(part(out, "word/document.xml"), /<w:r><w:t xml:space="preserve">Ένα<\/w:t><w:tab\/><w:t xml:space="preserve">και<\/w:t><w:br\/><w:t xml:space="preserve">δύο\.<\/w:t><\/w:r><w:r><w:t xml:space="preserve"> <\/w:t><\/w:r><\/w:p>/);
  assert.equal(D.outName("Ο γέρος.docx", "el"), "Ο γέρος.el.docx");
  assert.equal(D.outName("a/b:c.DOCX", "en-GB"), "a_b_c.en-GB.docx");
});

test("store: a project keeps its Word file and gives it back", async () => {
  const S = require("../writer/catstore.js");
  const files = new Map();
  const fs = {
    writeText(p, t) { files.set(p, String(t)); return Promise.resolve(); },
    write(p, b) { files.set(p, b); return Promise.resolve(); },
    read(p) { return files.has(p) ? Promise.resolve(files.get(p)) : Promise.reject(new Error("ENOENT")); }
  };
  const st = new S.Store(fs, "deva01", () => 1000);
  const src = D.extract(pkg(`<w:p>${R("Hi there.")}</w:p>`), "en");
  const p = await st.create({ name: "X", from: "en", to: "el", src: "d", data: src, orig: "BYTES", origName: "Book.DOCX" });
  assert.equal(await st.original(p.id, "docx"), "BYTES");
  assert.deepEqual(C.readSrc(JSON.parse(files.get("/internal/Writer/Translations/" + p.id + "/src.json"))).fmt, "docx");
  await assert.rejects(st.original("../etc", "docx"));
  await assert.rejects(st.original(p.id, "../x"));
});
