// Writer book translation, XLIFF 1.2 and 2.0 (writer/catxlf.js, WR-CAT
// T4): export with tags and status, read back by id or by source,
// other tools' inline codes, no DTD.
// Run: node --test tests/

"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const X = require("../writer/catxlf.js");
const C = require("../writer/catcore.js");

const src = C.extract({ html: "<p>The <b>old</b> man.<br>He slept &amp; dreamt.</p><p>Lions.</p><p>Lions.</p>" }, "en");

test("xliff: segments, tags and status out and back (1.2 and 2.0)", () => {
  assert.deepEqual(src.segs.map(s => s.s), ["The ⟦1⟧old⟦/1⟧ man.", "He slept & dreamt.", "Lions.", "Lions."]);
  const rows = { 0: ["Ο ⟦1⟧γέρος⟦/1⟧ άντρας.", 3, 5], 1: ["Κοιμήθηκε & <ονειρεύτηκε>.", 1, 5], 2: ["Λιοντάρια.", 2, 5] };
  const a = X.xliff(src, rows, { from: "en", to: "el", file: "book.docx", version: "1.2" });
  assert.match(a, /<file original="book.docx" source-language="en" target-language="el" datatype="plaintext">/);
  assert.match(a, /<trans-unit id="u0" xml:space="preserve" approved="yes"><source>The <g id="1" ctype="x-b">old<\/g> man\.<\/source><target state="signed-off">Ο <g id="1" ctype="x-b">γέρος<\/g> άντρας\.<\/target>/);
  assert.match(a, /<target state="needs-review-translation">Κοιμήθηκε &amp; &lt;ονειρεύτηκε&gt;\.<\/target>/);
  assert.match(a, /<trans-unit id="u3" xml:space="preserve"><source>Lions\.<\/source><\/trans-unit>/);
  const back = X.parseXliff(a, src);
  assert.equal(back.err, "");
  assert.equal(back.matched, 3);
  assert.deepEqual(back.rows, { 0: ["Ο ⟦1⟧γέρος⟦/1⟧ άντρας.", 3], 1: ["Κοιμήθηκε & <ονειρεύτηκε>.", 1], 2: ["Λιοντάρια.", 2] });
  const b = X.xliff(src, rows, { from: "en", to: "el", version: "2.0" });
  assert.match(b, /<xliff xmlns="urn:oasis:names:tc:xliff:document:2.0" version="2.0" srcLang="en" trgLang="el">/);
  assert.match(b, /<unit id="u0"><segment state="final"><source xml:space="preserve">The <pc id="1">old<\/pc> man\.<\/source>/);
  assert.deepEqual(X.parseXliff(b, src).rows, back.rows);
  // a broken translation still gives well-formed XML
  const c = X.xliff(src, { 0: ["⟦/1⟧Ο ⟦1⟧γέρος", 1, 1] }, { version: "1.2" });
  assert.match(c, /<target state="needs-review-translation">Ο <g id="1" ctype="x-b">γέρος<\/g><\/target>/);
});

test("xliff: another tool's file: other ids, codes, mrk, states, a DTD", () => {
  const other = `<?xml version="1.0"?><!DOCTYPE xliff [<!ENTITY e SYSTEM "file:///etc/passwd">]>
<xliff version="1.2"><file source-language="en" target-language="el"><body>
<trans-unit id="77"><source>Lions.</source><seg-source><mrk mtype="seg" mid="1">Lions.</mrk></seg-source>
<target state="translated"><mrk mtype="seg" mid="1">Λιοντάρια&e;.</mrk></target></trans-unit>
<trans-unit id="u0"><source>The <bpt id="1">&lt;b&gt;</bpt>old<ept id="1">&lt;/b&gt;</ept> man.</source>
<target state="new">Ο <bpt id="1">&lt;b&gt;</bpt>γέρος<ept id="1">&lt;/b&gt;</ept> άντρας. <ph id="9">x</ph></target></trans-unit>
<trans-unit id="u1"><source>Something else.</source><target>Κάτι.</target></trans-unit>
</body></file></xliff>`;
  const r = X.parseXliff(other, src);
  assert.equal(r.matched, 2);
  assert.equal(r.skipped, 1);
  assert.deepEqual(r.rows[2], ["Λιοντάρια&e;.", 2]);              // the entity is never read
  assert.deepEqual(r.rows[0], ["Ο ⟦1⟧γέρος⟦/1⟧ άντρας. ", 1]);     // ph 9 is not one of ours: left out
  const v2 = `<xliff xmlns="urn:oasis:names:tc:xliff:document:2.0" version="2.0" srcLang="en" trgLang="el"><file id="f"><unit id="u0">
<segment state="reviewed"><source>The <sc id="1"/>old<ec startRef="1"/> man.</source><target>Ο <sc id="1"/>γέρος<ec startRef="1"/> άντρας<cp hex="21"/></target></segment></unit>
<unit id="u1"><segment><source>He slept &amp; </source><target>Κοιμήθηκε &amp; </target></segment><segment><source>dreamt.</source><target>ονειρεύτηκε.</target></segment></unit></file></xliff>`;
  const r2 = X.parseXliff(v2, src);
  assert.deepEqual(r2.rows, { 0: ["Ο ⟦1⟧γέρος⟦/1⟧ άντρας!", 3], 1: ["Κοιμήθηκε & ονειρεύτηκε.", 1] });
  assert.equal(X.parseXliff("<tmx/>", src).err, "notxliff");
});
