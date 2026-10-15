// Slides: LibreOffice Impress (.odp) open (slides/odp.js).
// A small presentation is built here the way Impress writes one
// (content.xml, styles.xml, meta.xml, Pictures/) and read with
// OrosOdp.read(); the plan then goes through OrosSlidesPPTX.build()
// like a .pptx, so the deck must come out with its slides, layouts and
// placeholders, paragraphs / lists / levels / run formatting, sizes,
// pictures, shapes, lines, tables, backgrounds, notes, hidden slides
// and transitions. Also: a flat .fodp, odd namespace prefixes,
// DOCTYPE refused, links to other files never followed, an empty
// placeholder left to the layout, the units of svg lengths.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const ctx = { TextEncoder, TextDecoder, DecompressionStream, atob };
vm.createContext(ctx);
["slides/core.js", "slides/dk.js", "atelier/zip.js", "slides/pptx.js", "slides/odp.js"].forEach((f) =>
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx));
const C = ctx.OrosSlidesCore, X = ctx.OrosSlidesPPTX, O = ctx.OrosOdp, Z = ctx.AtelierZip;
const j = (x) => JSON.parse(JSON.stringify(x));

const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
const IMG = "a".repeat(64) + ".png";

const NSDECL = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" ' +
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" ' +
  'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" ' +
  'xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:dc="http://purl.org/dc/elements/1.1/" ' +
  'xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" ' +
  'xmlns:smil="urn:oasis:names:tc:opendocument:xmlns:smil-compatible:1.0"';

const STYLES = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles ${NSDECL} office:version="1.3">
 <office:styles>
  <style:default-style style:family="graphic"><style:text-properties fo:font-size="18pt"/></style:default-style>
  <style:style style:name="Default-title" style:family="presentation">
   <style:graphic-properties draw:fill="none" draw:textarea-vertical-align="middle"/>
   <style:text-properties fo:font-size="44pt" style:font-name="Liberation Serif"/>
  </style:style>
  <style:style style:name="Default-outline1" style:family="presentation">
   <style:text-properties fo:font-size="32pt"/>
  </style:style>
  <draw:fill-image draw:name="Bitmap_1" xlink:href="Pictures/bg.png" xlink:type="simple"/>
 </office:styles>
 <office:automatic-styles>
  <style:page-layout style:name="PM1"><style:page-layout-properties fo:page-width="28cm" fo:page-height="15.75cm"/></style:page-layout>
 </office:automatic-styles>
 <office:master-styles>
  <style:master-page style:name="Default" style:page-layout-name="PM1"/>
 </office:master-styles>
</office:document-styles>`;

const CONTENT = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content ${NSDECL} office:version="1.3">
 <office:automatic-styles>
  <style:style style:name="dp1" style:family="drawing-page"><style:drawing-page-properties draw:fill="solid" draw:fill-color="#1E1E2E"/></style:style>
  <style:style style:name="dp2" style:family="drawing-page"><style:drawing-page-properties presentation:visibility="hidden" smil:type="fade"/></style:style>
  <style:style style:name="dp3" style:family="drawing-page"><style:drawing-page-properties draw:fill="bitmap" draw:fill-image-name="Bitmap_1"/></style:style>
  <style:style style:name="pr1" style:family="presentation" style:parent-style-name="Default-title"/>
  <style:style style:name="pr2" style:family="presentation" style:parent-style-name="Default-outline1"/>
  <style:style style:name="gr1" style:family="graphic"><style:graphic-properties draw:fill="solid" draw:fill-color="#FF8800" draw:stroke="dash" svg:stroke-color="#000000" svg:stroke-width="0.1cm"/></style:style>
  <style:style style:name="gr2" style:family="graphic"><style:graphic-properties draw:stroke="solid" svg:stroke-color="#3366FF" svg:stroke-width="0.05cm"/></style:style>
  <style:style style:name="P1" style:family="paragraph"><style:paragraph-properties fo:text-align="center"/></style:style>
  <style:style style:name="T1" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>
  <style:style style:name="T2" style:family="text"><style:text-properties fo:font-style="italic" fo:color="#ff0000"/></style:style>
  <style:style style:name="T3" style:family="text"><style:text-properties style:text-underline-style="solid"/></style:style>
  <text:list-style style:name="L1">
   <text:list-level-style-bullet text:level="1" text:bullet-char="●"/>
   <text:list-level-style-bullet text:level="2" text:bullet-char="–"/>
  </text:list-style>
  <text:list-style style:name="L2"><text:list-level-style-number text:level="1" style:num-format="1"/></text:list-style>
 </office:automatic-styles>
 <office:body>
  <office:presentation>
   <draw:page draw:name="page1" draw:style-name="dp1" draw:master-page-name="Default">
    <draw:frame presentation:style-name="pr1" presentation:class="title" svg:x="2cm" svg:y="1cm" svg:width="24cm" svg:height="3cm">
     <draw:text-box><text:p text:style-name="P1">Καλωσήρθατε <text:span text:style-name="T1">όλοι</text:span></text:p></draw:text-box>
    </draw:frame>
    <draw:frame presentation:style-name="pr2" presentation:class="outline" svg:x="2cm" svg:y="4.5cm" svg:width="24cm" svg:height="9cm">
     <draw:text-box>
      <text:list text:style-name="L1">
       <text:list-item><text:p>Πρώτο <text:span text:style-name="T1">έντονο</text:span> και <text:span text:style-name="T2">πλάγιο</text:span></text:p>
        <text:list><text:list-item><text:p>δεύτερο<text:s text:c="2"/>επίπεδο</text:p></text:list-item></text:list>
       </text:list-item>
       <text:list-item><text:p><text:span text:style-name="T3">υπογράμμιση</text:span><text:line-break/>νέα γραμμή</text:p></text:list-item>
      </text:list>
      <text:list text:style-name="L2"><text:list-item><text:p>αριθμός</text:p></text:list-item></text:list>
     </draw:text-box>
    </draw:frame>
    <presentation:notes>
     <draw:page-thumbnail presentation:class="page" svg:x="1cm" svg:y="1cm" svg:width="10cm" svg:height="6cm"/>
     <draw:frame presentation:class="notes" svg:x="1cm" svg:y="8cm" svg:width="18cm" svg:height="10cm">
      <draw:text-box><text:p>Σημείωση &lt;ένα&gt; &amp; δύο</text:p><text:p>δεύτερη γραμμή</text:p></draw:text-box>
     </draw:frame>
    </presentation:notes>
   </draw:page>
   <draw:page draw:name="page2" draw:style-name="dp2" draw:master-page-name="Default">
    <draw:frame presentation:style-name="pr1" presentation:class="title" svg:x="2cm" svg:y="1cm" svg:width="24cm" svg:height="3cm" presentation:placeholder="true"><draw:text-box/></draw:frame>
    <draw:frame draw:name="Picture" svg:x="14cm" svg:y="5cm" svg:width="10cm" svg:height="5cm">
     <draw:image xlink:href="Pictures/vector.svg"/><draw:image xlink:href="Pictures/photo.png"/>
     <svg:title>Ακρόπολη</svg:title>
    </draw:frame>
    <draw:frame svg:x="1cm" svg:y="1cm" svg:width="3cm" svg:height="3cm"><draw:image xlink:href="http://example.com/x.png"/></draw:frame>
    <draw:frame svg:x="1cm" svg:y="1cm" svg:width="3cm" svg:height="3cm"><draw:image xlink:href="../outside.png"/></draw:frame>
    <draw:custom-shape draw:style-name="gr1" svg:x="1in" svg:y="72pt" svg:width="50mm" svg:height="2cm">
     <text:p>Κουτί</text:p>
     <draw:enhanced-geometry draw:type="rectangle"/>
    </draw:custom-shape>
    <draw:ellipse draw:style-name="gr2" svg:x="10cm" svg:y="11cm" svg:width="4cm" svg:height="2cm"/>
    <draw:line draw:style-name="gr2" svg:x1="1cm" svg:y1="14cm" svg:x2="8cm" svg:y2="12cm"/>
    <draw:g>
     <draw:frame svg:width="5cm" svg:height="2cm" draw:transform="rotate (0.523598775598) translate (20cm 12cm)">
      <draw:text-box><text:p>στραμμένο</text:p></draw:text-box>
     </draw:frame>
    </draw:g>
   </draw:page>
   <draw:page draw:name="page3" draw:style-name="dp3" draw:master-page-name="Default">
    <draw:frame svg:x="2cm" svg:y="2cm" svg:width="20cm" svg:height="6cm">
     <table:table>
      <table:table-row><table:table-cell><text:p>Όνομα</text:p></table:table-cell><table:table-cell><text:p>Τιμή</text:p></table:table-cell></table:table-row>
      <table:table-row><table:table-cell><text:p>α</text:p></table:table-cell><table:table-cell><text:p>1</text:p></table:table-cell></table:table-row>
     </table:table>
    </draw:frame>
    <draw:frame svg:x="2cm" svg:y="9cm" svg:width="8cm" svg:height="4cm"><draw:object xlink:href="./Object 1"/></draw:frame>
   </draw:page>
  </office:presentation>
 </office:body>
</office:document-content>`;

const META = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-meta ${NSDECL}><office:meta><dc:title>Ετήσια &lt;αναφορά&gt;</dc:title></office:meta></office:document-meta>`;

function odpZip(content, styles, extra) {
  const files = [
    { name: "mimetype", data: "application/vnd.oasis.opendocument.presentation" },
    { name: "content.xml", data: content },
    { name: "styles.xml", data: styles || STYLES },
    { name: "meta.xml", data: META },
    { name: "Pictures/photo.png", data: PNG },
    { name: "Pictures/vector.svg", data: "<svg xmlns='http://www.w3.org/2000/svg'/>" },
    { name: "Pictures/bg.png", data: PNG }
  ].concat(extra || []);
  return Z.open(Z.write(files));
}
function ids(prefix) {
  let n = 0;
  return () => prefix + String(++n).padStart(4, "0");
}
const paraText = (it) => it.paras.map((p) => p.r.map((r) => r.t).join("")).join("\n");

test("odp: reads slides, placeholders, lists, formatting, notes, title", async () => {
  const zip = odpZip(CONTENT);
  assert.equal(O.isOdp(zip), true);
  const plan = await O.read(zip);
  assert.equal(plan.source, "odp");
  assert.equal(plan.as, "16:9");
  assert.equal(plan.title, "Ετήσια <αναφορά>");
  assert.equal(plan.th, "dark");                       // first slide's background is dark
  assert.equal(plan.slides.length, 3);
  const s1 = plan.slides[0];
  assert.equal(s1.ly, "content");
  assert.equal(s1.bg, "#1e1e2e");
  assert.equal(s1.n, "Σημείωση <ένα> & δύο\nδεύτερη γραμμή");
  const title = s1.items.find((x) => x.ph === "title");
  assert.equal(paraText(title), "Καλωσήρθατε όλοι");
  assert.equal(title.al, "c");
  assert.equal(title.va, "m");
  assert.equal(title.ff, "serif");
  // 44pt on a 15.75cm page: 44 * 2.54/72 cm * 1000/15.75
  assert.ok(Math.abs(title.fs - Math.round(44 * 2.54 / 72 * 1000 / 15.75)) <= 1, "title size " + title.fs);
  assert.ok(title.paras[0].r.every((r) => !r.b), "a title is bold anyway");
  const body = s1.items.find((x) => x.ph === "body");
  assert.deepEqual(j(body.paras), [
    { l: 0, ls: "b", r: [{ t: "Πρώτο " }, { t: "έντονο", b: true }, { t: " και " }, { t: "πλάγιο", i: true, c: "#ff0000" }] },
    { l: 1, ls: "b", r: [{ t: "δεύτερο  επίπεδο" }] },
    { l: 0, ls: "b", r: [{ t: "υπογράμμιση", u: true }] },
    { l: 0, ls: "", r: [{ t: "νέα γραμμή" }] },
    { l: 0, ls: "n", r: [{ t: "αριθμός" }] }
  ]);
  // box: 2cm in on a 28cm wide page that is exactly 16:9
  assert.equal(body.x, Math.round(2 * 1000 / 15.75));
  assert.equal(body.y, Math.round(4.5 * 1000 / 15.75));
});

test("odp: pictures, shapes, lines, rotation, hidden, transition", async () => {
  const plan = await O.read(odpZip(CONTENT));
  const s2 = plan.slides[1];
  assert.equal(s2.hid, true);
  assert.equal(s2.tr, "fade");
  // the empty title placeholder is not an item (build gives the layout's back)
  assert.equal(s2.items.filter((x) => x.ph).length, 0);
  const pics = s2.items.filter((x) => x.k === "image");
  assert.equal(pics.length, 1, "links to the web or outside the file are never followed");
  assert.equal(pics[0].media, "Pictures/photo.png");      // the raster copy wins
  assert.equal(pics[0].alt, "Ακρόπολη");
  assert.deepEqual(Object.keys(plan.media).sort(), ["Pictures/bg.png", "Pictures/photo.png"]);
  assert.ok(plan.count.skipped >= 2);
  const rect = s2.items.find((x) => x.k === "shape" && x.sh === "rect");
  assert.equal(rect.fill, "#ff8800");
  assert.equal(rect.st, "#000000");
  assert.equal(rect.dash, true);
  // 1in, 72pt, 50mm, 2cm → units
  const k = 1000 / 15.75;
  assert.equal(rect.x, Math.round(2.54 * k));
  assert.equal(rect.y, Math.round(2.54 * k));
  assert.equal(rect.w, Math.round(5 * k));
  const label = s2.items.find((x) => x.k === "text" && paraText(x) === "Κουτί");
  assert.ok(label, "a shape's text comes along");
  assert.equal(label.va, "m");
  assert.equal(label.al, "c");
  const ell = s2.items.find((x) => x.sh === "ellipse");
  assert.equal(ell.st, "#3366ff");
  assert.equal(ell.fill, undefined);
  const ln = s2.items.find((x) => x.k === "line");
  assert.equal(ln.flip, true);
  assert.equal(ln.w, Math.round(7 * k));
  const rot = s2.items.find((x) => x.k === "text" && paraText(x) === "στραμμένο");
  assert.equal(rot.r, -30);
  // centre: rotate (w/2, h/2) by 30° then translate (20, 12)
  const a = Math.PI / 6, cx = Math.cos(a) * 2.5 + Math.sin(a) * 1 + 20, cy = -Math.sin(a) * 2.5 + Math.cos(a) * 1 + 12;
  assert.ok(Math.abs(rot.x + rot.w / 2 - cx * k) <= 1.5);
  assert.ok(Math.abs(rot.y + rot.h / 2 - cy * k) <= 1.5);
  const bytes = await plan.get("Pictures/photo.png");
  assert.deepEqual(Array.from(bytes), Array.from(PNG));
  assert.equal(await plan.get("../outside.png"), null);
});

test("odp: background picture, tables, embedded objects", async () => {
  const plan = await O.read(odpZip(CONTENT), { labels: { object: "Αντικείμενο" } });
  const s3 = plan.slides[2];
  const bg = s3.items[0];
  assert.equal(bg.k, "image");
  assert.equal(bg.lk, true);
  assert.equal(bg.media, "Pictures/bg.png");
  assert.equal(bg.w, C.widthOf("16:9"));
  const tb = s3.items.find((x) => x.k === "table");
  assert.deepEqual(j(tb.tb.rows), [["Όνομα", "Τιμή"], ["α", "1"]]);
  const note = s3.items.find((x) => x.k === "text" && x.dash);
  assert.equal(note.paras[0].r[0].t, "Αντικείμενο");
  assert.equal(plan.count.unknown, 1);
});

test("odp: build makes a new deck through the normalizers", async () => {
  const plan = await O.read(odpZip(CONTENT));
  const assets = { "Pictures/photo.png": { id: IMG, w: 800, h: 400 }, "Pictures/bg.png": { id: IMG, w: 1, h: 1 } };
  const r = X.build(plan, assets, 5000, ids("od"));
  assert.equal(r.deck.t, "Ετήσια <αναφορά>");
  assert.equal(r.slides.length, 3);
  assert.equal(r.missing, 0);
  assert.deepEqual(j(r.slides.map((s) => s.ly)), ["content", "title", "blank"]);
  assert.equal(r.slides[1].hid, true);
  assert.equal(r.slides[0].n, "Σημείωση <ένα> & δύο\nδεύτερη γραμμή");
  r.items.forEach((it) => assert.deepEqual(j(C.normItem(it)), j(it)));
  const d = C.emptyData();
  d.decks[r.deck.id] = r.deck;
  r.slides.forEach((s) => { d.slides[s.id] = s; });
  r.items.forEach((it) => { d.items[it.id] = it; });
  assert.equal(C.formatOutline(d, r.deck.id).split("\n")[0], "# Καλωσήρθατε όλοι");
  const pic = r.items.find((x) => x.k === "image" && !x.lk);
  assert.equal(pic.img.a, IMG);
  assert.equal(pic.img.alt, "Ακρόπολη");
});

test("odp: 4:3 page, other prefixes, flat .fodp with inline pictures", async () => {
  const st = STYLES.replace('fo:page-width="28cm" fo:page-height="15.75cm"', 'fo:page-width="10in" fo:page-height="7.5in"');
  const plan = await O.read(odpZip(CONTENT, st));
  assert.equal(plan.as, "4:3");
  // the same document with other namespace prefixes reads the same
  const odd = CONTENT.replace(/xmlns:draw=/, "xmlns:d=").replace(/(<\/?)draw:/g, "$1d:").replace(/ draw:/g, " d:");
  const plan2 = await O.read(odpZip(odd));
  assert.deepEqual(j(plan2.slides), j((await O.read(odpZip(CONTENT))).slides));
  const flat = `<?xml version="1.0"?><office:document ${NSDECL} office:mimetype="application/vnd.oasis.opendocument.presentation">
   <office:meta><dc:title>Flat</dc:title></office:meta>
   <office:automatic-styles><style:page-layout style:name="PM1"><style:page-layout-properties fo:page-width="28cm" fo:page-height="15.75cm"/></style:page-layout></office:automatic-styles>
   <office:master-styles><style:master-page style:name="Default" style:page-layout-name="PM1"/></office:master-styles>
   <office:body><office:presentation><draw:page draw:master-page-name="Default">
    <draw:frame presentation:class="title" svg:x="1cm" svg:y="1cm" svg:width="20cm" svg:height="3cm"><draw:text-box><text:p>Επίπεδο</text:p></draw:text-box></draw:frame>
    <draw:frame svg:x="1cm" svg:y="5cm" svg:width="4cm" svg:height="4cm"><draw:image><office:binary-data>${Buffer.from(PNG).toString("base64")}</office:binary-data></draw:image></draw:frame>
   </draw:page></office:presentation></office:body></office:document>`;
  const fp = O.readFlat(flat);
  assert.equal(fp.title, "Flat");
  assert.equal(fp.slides[0].ly, "title");
  const im = fp.slides[0].items.find((x) => x.k === "image");
  assert.equal(im.media, "bin:0");
  assert.deepEqual(Array.from(await fp.get("bin:0")), Array.from(PNG));
});

test("odp: refuses DTDs and entities, a .pptx is not an .odp", async () => {
  assert.throws(() => O.parseXml('<!DOCTYPE x [<!ENTITY a "b">]><x>&a;</x>'), /xml/);
  await assert.rejects(O.read(odpZip('<!DOCTYPE office:document-content><office:document-content/>')), /xml/);
  await assert.rejects(O.read(odpZip("<office:document-content " + NSDECL + "><office:body/></office:document-content>")), /odp/);
  const pz = Z.open(Z.write([{ name: "ppt/presentation.xml", data: "<p/>" }, { name: "content.xml", data: "<x/>" }]));
  assert.equal(O.isOdp(pz), false);
  // text stays text: markup in a paragraph is never anything else
  const t = O.parseXml("<a><b>1 &lt;script&gt; 2</b></a>");
  assert.equal(t.c[0].c[0].c[0].t, "1 <script> 2");
});

test("odp: svg lengths", () => {
  assert.equal(O.len("2.54cm"), 2.54);
  assert.equal(O.len("1in"), 2.54);
  assert.ok(Math.abs(O.len("72pt") - 2.54) < 1e-9);
  assert.equal(O.len("10mm"), 1);
  assert.ok(Math.abs(O.len("96px") - 2.54) < 1e-9);
  assert.ok(Number.isNaN(O.len("abc")));
});
