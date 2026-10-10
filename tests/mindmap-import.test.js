// Mind Map import of other apps' files (mindmap/mm-import.js):
// FreeMind / Freeplane .mm and XMind .xmind (Zen/2020+ content.json
// and XMind 8 content.xml). The fixtures are small, self-made copies
// of the structure of real files (attribute names, nesting,
// namespaces); the .xmind files are zipped here by a tiny ZIP writer.
// Hostile files: entities never expand, deep nesting, broken zips,
// entries that inflate past the cap.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const zlib = require("zlib");
const M = require(path.join(__dirname, "..", "mindmap/mm-core.js"));
const I = require(path.join(__dirname, "..", "mindmap/mm-import.js"));

// ---------- helpers ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
// files: [{ name, data (string|Buffer), store?: true, sizeField? }]
function zip(files) {
  const locals = [], centrals = [];
  let off = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, "utf8");
    const method = f.store ? 0 : 8;
    const body = f.store ? raw : zlib.deflateRawSync(raw);
    const crc = crc32(raw), size = f.sizeField !== undefined ? f.sizeField : raw.length;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(method, 8); lh.writeUInt32LE(0, 10); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(size, 22);
    lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 8); ch.writeUInt16LE(method, 10); ch.writeUInt32LE(0, 12);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(size, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(off, 42);
    locals.push(lh, name, body);
    centrals.push(ch, name);
    off += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, end]));
}
function all(tree) {
  const out = [], st = [tree];
  while (st.length) { const t = st.pop(); out.push(t); for (let i = t.kids.length - 1; i >= 0; i--) st.push(t.kids[i]); }
  return out;
}
function byRef(tree, ref) { return all(tree).find(n => n.ref === ref); }
function depth(tree) {
  let d = 0; const st = [[tree, 1]];
  while (st.length) { const [t, k] = st.pop(); d = Math.max(d, k); t.kids.forEach(c => st.push([c, k + 1])); }
  return d;
}
let seq = 0;
function newId() { return "n" + (++seq).toString(36).padStart(5, "0"); }

// ---------- FreeMind / Freeplane ----------
// Structure of FreeMind 1.0.1's own doc/freemind.mm.
const FM_BASIC = `<map version="1.0.1">
<!-- To view this file, download free mind mapping software FreeMind from http://freemind.sourceforge.net -->
<attribute_registry>
<attribute_name NAME="VERSION" RESTRICTED="true"><attribute_value VALUE="846848357"/></attribute_name>
</attribute_registry>
<node COLOR="#993300" CREATED="1124560950701" ID="ID_911274459" MODIFIED="1255776196712" TEXT="Trip&#xa;plan">
<font NAME="Dialog" SIZE="18"/>
<node CREATED="1" ID="ID_1" LINK="http://freemind.sourceforge.net" MODIFIED="1" POSITION="left" TEXT="Home page">
<font NAME="SansSerif" SIZE="12"/>
</node>
<node COLOR="#006699" FOLDED="true" ID="_Freemind_Link_1091417446" POSITION="right" TEXT="Packing &amp; more">
<edge STYLE="bezier" WIDTH="thin"/>
<node ID="ID_3" TEXT="Socks"><icon BUILTIN="button_ok"/></node>
<node ID="ID_4" TEXT="Idea"><icon BUILTIN="idea"/><icon BUILTIN="help"/></node>
<node ID="ID_5" BACKGROUND_COLOR="#33cc33" TEXT="Green bg"/>
<node ID="ID_6" COLOR="#000000" TEXT="Black text"/>
</node>
<node ID="ID_7" TEXT="Old note">
<hook NAME="accessories/plugins/NodeNote.properties"><text>A note from FreeMind 0.7</text></hook>
</node>
</node>
</map>`;

test("FreeMind: basic tree, ids, icons, colours, old notes", () => {
  const r = I.parseFreeMind(FM_BASIC, "file");
  assert.equal(r.ok, true);
  const t = r.tree;
  assert.equal(t.text, "Trip\nplan");
  assert.equal(t.ref, "ID_911274459");
  assert.equal(t.color, "red");                         // #993300 → nearest key
  assert.deepEqual(t.kids.map(k => k.text), ["Home page", "Packing & more", "Old note"]);
  assert.equal(all(t).length, 8);
  const pk = t.kids[1];
  assert.equal(pk.ref, "_Freemind_Link_1091417446");
  assert.deepEqual(pk.kids.map(k => k.text), ["Socks", "Idea", "Green bg", "Black text"]);
  assert.equal(pk.kids[0].done, true);
  assert.equal(pk.kids[0].emoji, "");
  assert.equal(pk.kids[1].emoji, "\u{1F4A1}");
  assert.equal(pk.kids[2].color, "green");
  assert.equal(pk.kids[3].color, "");                   // black = default, no colour
  assert.equal(t.kids[2].note, "A note from FreeMind 0.7");
  assert.deepEqual(t.links, []);
  for (const n of all(t)) {
    assert.deepEqual(Object.keys(n).filter(k => k !== "links").sort(),
      ["color", "done", "emoji", "kids", "note", "ref", "text", "url"]);
    assert.ok(n.color === "" || M.COLOR_KEYS.includes(n.color));
  }
  // the tree feeds mm-core's treeToRows as is
  const rows = M.treeToRows(t, newId, 5);
  assert.equal(rows.nodes.length, 8);
  assert.equal(rows.nodes[0].text, "Trip\nplan");
});

// Structure of Freeplane 1.9's doc/freeplaneFunctions.mm and
// test_data/RichtextTests.mm: MapStyle hook (style nodes must not
// become map nodes), rich-text node, xml/ note, summary nodes.
const FP_RICH = `<map version="freeplane 1.9.0">
<!--To view this file, download free mind mapping software Freeplane from https://www.freeplane.org -->
<node TEXT="Basic Freeplane&#xa;Functions" FOLDED="false" ID="ID_45488473" BACKGROUND_COLOR="#00ff99">
<icon BUILTIN="bee"/>
<hook NAME="MapStyle">
<properties show_icon_for_attributes="false"/>
<map_styles>
<stylenode LOCALIZED_TEXT="styles.root_node" STYLE="oval">
<stylenode LOCALIZED_TEXT="default" ID="ID_1511227934" COLOR="#000000">
<arrowlink SHAPE="CUBIC_CURVE" DESTINATION="ID_1511227934" STARTARROW="NONE" ENDARROW="DEFAULT"/>
</stylenode>
</stylenode>
</map_styles>
</hook>
<richcontent TYPE="NOTE" CONTENT-TYPE="xml/">
<html>
  <head>

  </head>
  <body>
    <p>
      Hover with the cursor over the <b>different</b> texts.
    </p>
    <p>
      N.B. This is a <i>Note</i> text.
    </p>
  </body>
</html></richcontent>
<node ID="ID_739070756" POSITION="right" TEXT_SHORTENED="true"><richcontent TYPE="NODE">

<html>
  <head>

  </head>
  <body>
    <p>
      <b>Spell check</b>&#160;&amp; Academic&nbsp;Writing
    </p>
    <p>
      first line<br/>second   line
    </p>
  </body>
</html>
</richcontent>
<richcontent TYPE="NOTE" CONTENT-TYPE="xml/">
<html>
  <head>

  </head>
  <body>
    <p>
      <b>See</b>
    </p>
    <ul>
      <li>
        <i>Help &gt;  </i><i>Tutorial</i>&#160;<a href="freeplaneUserGuide.mm#ID_141336344">Spelling dictionaries</a>
      </li>
      <li>
        Second item
      </li>
    </ul>
  </body>
</html></richcontent>
<richcontent TYPE="DETAILS"><html><head></head><body><p>Some details</p></body></html></richcontent>
</node>
<node TEXT="" POSITION="left" ID="ID_1000966299"><hook NAME="FirstGroupNode"/></node>
<node TEXT="Other" POSITION="left" ID="ID_454770946"/>
<node TEXT="" POSITION="left" ID="ID_1520416593"><hook NAME="SummaryNode"/>
<node TEXT="Summary node&#xa;(accolade)" ID="ID_499898058"/>
</node>
<node ID="ID_300419503" STYLE="bubble"><richcontent TYPE="NODE">
<html>
  <head>

  </head>
  <body>
    <img src="Images/doc/freeplaneApplications.png"/>
  </body>
</html>
</richcontent></node>
<node ID="ID_md" TEXT="Markdown note"><richcontent TYPE="NOTE" CONTENT-TYPE="plain/markdown">line *one*
line two</richcontent></node>
</node>
</map>`;

test("Freeplane: rich-text node and notes become plain text; styles and summaries", () => {
  const r = I.parseFreeMind(FP_RICH, "file");
  assert.equal(r.ok, true);
  const t = r.tree;
  assert.equal(t.text, "Basic Freeplane\nFunctions");
  assert.equal(t.emoji, "\u{1F41D}");
  assert.equal(t.note, "Hover with the cursor over the different texts.\nN.B. This is a Note text.");
  assert.deepEqual(t.kids.map(k => k.text),
    ["Spell check & Academic Writing\nfirst line\nsecond line", "Other", "Summary node\n(accolade)", "", "Markdown note"]);
  const rich = t.kids[0];
  assert.equal(rich.ref, "ID_739070756");
  assert.equal(rich.emoji, "");
  assert.equal(rich.note, "See\nHelp > Tutorial Spelling dictionaries\nSecond item\n\nSome details");
  assert.equal(t.kids[3].emoji, "\u{1F5BC}️");     // a picture-only node
  assert.equal(t.kids[4].note, "line *one*\nline two");
  assert.ok(!all(t).some(n => /styles|default/.test(n.text)), "style nodes stay out");
  assert.deepEqual(t.links, [], "the style node's arrow link is not a map link");
});

test("FreeMind: LINK keeps web links only", () => {
  const links = {
    a: ["http://example.com/x?y=1&z=2", "http://example.com/x?y=1&z=2"],
    b: ["https://example.org", "https://example.org"],
    c: ["www.google.com", "https://www.google.com"],
    d: ["javascript:alert(1)", ""],
    e: ["JaVaScRiPt:alert(1)", ""],
    f: ["file:/C:/Program%20Files/", ""],
    g: ["C:/Program%20Files/", ""],
    h: ["/home/", ""],
    i: ["freemind_de.mm", ""],
    j: ["mailto:someone@example.com", ""],
    k: ["#ID_123", ""],
    l: ["%SystemRoot%\\regedit.exe", ""],
    m: ["data:text/html,<script>alert(1)</script>", ""],
    n: ["http://exa mple.com/\"onmouseover=x", ""]
  };
  const body = Object.keys(links).map(k =>
    `<node ID="${k}" TEXT="${k}" LINK="${M.escXml(links[k][0])}"/>`).join("\n");
  const r = I.parseFreeMind(`<map version="1.0.1"><node TEXT="r">${body}</node></map>`);
  assert.equal(r.ok, true);
  for (const k of Object.keys(links)) assert.equal(byRef(r.tree, k).url, links[k][1], k);
});

// Structure of Xholon's exports/mm/relationships01.mm (FreeMind 1.0.1).
test("FreeMind: arrow links become links when both ends exist", () => {
  const xml = `<map version="1.0.1">
<node CREATED="1482417665447" ID="44" TEXT="Physical system">
<node FOLDED="true" ID="45" POSITION="right" TEXT="People">
<node ID="50" TEXT="Ken">
<arrowlink COLOR="#6666ff" DESTINATION="51" MIDDLE_LABEL="friend" ENDARROW="Default" ID="50510" STARTARROW="None"/>
<arrowlink COLOR="#6666ff" DESTINATION="61" MIDDLE_LABEL="daughter" ENDARROW="Default" ID="50611" STARTARROW="None"/>
<arrowlink DESTINATION="999" ID="x1"/>
<arrowlink DESTINATION="50" ID="x2"/>
<arrowlink COLOR="#6666ff" DESTINATION="51" MIDDLE_LABEL="friend" ID="dup"/>
</node>
<node ID="51" TEXT="Andrea"><arrowlink DESTINATION="44" SOURCE_LABEL="src" ENDINCLINATION="41;0;"/></node>
<node TEXT="no id"><arrowlink DESTINATION="51"/></node>
</node>
<node ID="61" TEXT="Jane"/>
</node>
</map>`;
  const r = I.parseFreeMind(xml);
  assert.equal(r.ok, true);
  assert.deepEqual(r.tree.links, [
    { from: "50", to: "51", label: "friend" },
    { from: "50", to: "61", label: "daughter" },
    { from: "51", to: "44", label: "src" }
  ]);
});

test("FreeMind: hostile files", () => {
  // entity definitions in a DOCTYPE never expand (billion laughs, XXE)
  const lol = `<?xml version="1.0"?>
<!DOCTYPE map [
 <!ENTITY a "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA">
 <!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">
 <!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;">
 <!ENTITY xxe SYSTEM "file:///etc/passwd">
]>
<map version="1.0.1"><node ID="r" TEXT="&c;"><node ID="k" TEXT="x&xxe;y&lt;"/></node></map>`;
  const r = I.parseFreeMind(lol, "Fallback");
  assert.equal(r.ok, true);
  assert.ok(!/A/.test(JSON.stringify(r.tree)), "no expansion");
  assert.equal(r.tree.text, "Fallback");                // the root's text was only an entity
  assert.equal(r.tree.kids[0].text, "xy<");

  // very deep nesting: rejected, not a stack overflow
  const deep = "<map><node TEXT=\"r\">" + "<node TEXT=\"d\">".repeat(5000) + "</node>".repeat(5001) + "</map>";
  assert.deepEqual(I.parseFreeMind(deep), { ok: false, err: "format" });
  // deep but within the limit: kept
  const ok = "<map><node TEXT=\"r\">" + "<node TEXT=\"d\">".repeat(90) + "</node>".repeat(91) + "</map>";
  assert.equal(depth(I.parseFreeMind(ok).tree), 91);

  assert.deepEqual(I.parseFreeMind('<opml version="2.0"><body><outline text="x"/></body></opml>'), { ok: false, err: "format" });
  assert.deepEqual(I.parseFreeMind("<map><node TEXT='x'></map>"), { ok: false, err: "format" });
  assert.deepEqual(I.parseFreeMind("just text"), { ok: false, err: "format" });
  assert.deepEqual(I.parseFreeMind('<map version="1.0.1"></map>'), { ok: false, err: "empty" });
  assert.deepEqual(I.parseFreeMind(42), { ok: false, err: "size" });
  assert.deepEqual(I.parseFreeMind(" ".repeat(M.IMPORT_MAX + 1)), { ok: false, err: "size" });

  // controls and bidi overrides out, long text capped
  const r2 = I.parseFreeMind(`<map><node TEXT="a&#x202e;b&#1;c${"x".repeat(5000)}"><richcontent TYPE="NOTE"><html><body><p>${"n".repeat(1000)}</p></body></html></richcontent></node></map>`);
  assert.equal(r2.tree.text.slice(0, 3), "abc");
  assert.equal(r2.tree.text.length, M.TEXT_LEN);
  assert.equal(r2.tree.note.length, 1000);
});

test("FreeMind: at most MAX_NODES nodes", () => {
  const n = M.MAX_NODES + 20;
  const xml = "<map><node TEXT=\"r\">" + "<node TEXT=\"k\"/>".repeat(n - 1) + "</node></map>";
  const r = I.parseFreeMind(xml);
  assert.equal(r.ok, true);
  assert.equal(all(r.tree).length, M.MAX_NODES);
});

// ---------- XMind ----------
// Structure of an XMind 2020+ file (content.json, plus the content.xml
// stub such files carry for XMind 8, which must be ignored).
const ZEN_STUB = `<?xml version="1.0" encoding="UTF-8" standalone="no"?><xmap-content xmlns="urn:xmind:xmap:xmlns:content:2.0" version="2.0"><sheet id="s"><topic id="t"><title>Warning
This file can not be opened normally</title></topic></sheet></xmap-content>`;
function zenSheets() {
  return [{
    id: "9b5a01ac660acf76b0a35b3e2d", class: "sheet", title: "Sheet 1 - Mind Map",
    rootTopic: {
      id: "root-1", class: "topic", title: "Central Topic", structureClass: "org.xmind.ui.map.clockwise",
      notes: { plain: { content: "Root note\n" }, realHTML: { content: "<div>Root note</div>" } },
      children: {
        attached: [
          { id: "a", title: "Web", href: "https://www.google.com", markers: [{ markerId: "priority-1" }] },
          { id: "b", title: "Inner", href: "xmind:#a", markers: [{ markerId: "task-done" }] },
          { id: "c", title: "Local", href: "file:///home/matt/local-file.txt",
            children: { attached: [{ id: "c1", title: "Task", extensions: [{ provider: "org.xmind.ui.task", content: { status: "done" } }] },
                                   { id: "c2", title: "Todo", extensions: [{ provider: "org.xmind.ui.task", content: { status: "todo" } }] }] } },
          { id: "d", attributedTitle: [{ text: "Rich " }, { text: "title" }] },
          { id: "e", title: "Attachment", href: "xap:resources/aac50de1.txt", style: { properties: { "svg:fill": "#FB5151" } } }
        ],
        detached: [{ id: "f", title: "Floating" }],
        summary: [{ id: "g", title: "Summary" }]
      }
    },
    relationships: [
      { id: "r1", end1Id: "a", end2Id: "c1", controlPoints: { 0: { x: 1, y: 2 } } },
      { id: "r2", end1Id: "b", end2Id: "d", title: "Relationship with label" },
      { id: "r3", end1Id: "a", end2Id: "f" },           // floating topic: not imported
      { id: "r4", end1Id: "zz", end2Id: "a" }
    ]
  }, {
    id: "s2", class: "sheet", title: "Sheet 2", rootTopic: { id: "r2t", title: "Other sheet" }
  }];
}

test("XMind Zen: content.json, first sheet, relationships", async () => {
  const bytes = zip([
    { name: "content.xml", data: ZEN_STUB },
    { name: "Thumbnails/", data: "", store: true },
    { name: "metadata.json", data: '{"creator":{"name":"Vana","version":"23.09"}}' },
    { name: "content.json", data: JSON.stringify(zenSheets()) },
    { name: "manifest.json", data: '{"file-entries":{"content.json":{},"metadata.json":{}}}', store: true }
  ]);
  assert.equal(I.sniff(bytes), "zip");
  const r = await I.parseXMind(bytes, "file");
  assert.equal(r.ok, true);
  const t = r.tree;
  assert.equal(t.text, "Central Topic");
  assert.equal(t.ref, "root-1");
  assert.equal(t.note, "Root note");
  assert.equal(t.sheets, 2);
  assert.deepEqual(t.kids.map(k => k.text), ["Web", "Inner", "Local", "Rich title", "Attachment"]);
  assert.equal(all(t).length, 8);                       // no detached / summary topics
  assert.deepEqual(t.kids.map(k => k.url), ["https://www.google.com", "", "", "", ""]);
  assert.equal(t.kids[0].emoji, "1\uFE0F\u20E3");
  assert.equal(t.kids[1].done, true);
  assert.deepEqual(t.kids[2].kids.map(k => k.done), [true, false]);
  assert.equal(t.kids[4].color, "red");
  assert.deepEqual(t.links, [
    { from: "a", to: "c1", label: "" },
    { from: "b", to: "d", label: "Relationship with label" }
  ]);
});

test("XMind Zen: odd and hostile content.json", async () => {
  const one = s => zip([{ name: "content.json", data: s }]);
  assert.deepEqual(await I.parseXMind(one("not json"), "f"), { ok: false, err: "format" });
  assert.deepEqual(await I.parseXMind(one("{}"), "f"), { ok: false, err: "format" });
  assert.deepEqual(await I.parseXMind(one("[]"), "f"), { ok: false, err: "format" });
  assert.deepEqual(await I.parseXMind(one("[{}]"), "f"), { ok: false, err: "empty" });
  assert.deepEqual(await I.parseXMind(one('[{"rootTopic":5}]'), "f"), { ok: false, err: "empty" });
  // untitled root: the sheet's title, then the file name
  let r = await I.parseXMind(one('[{"title":"My sheet","rootTopic":{"id":"x"}}]'), "f");
  assert.equal(r.tree.text, "My sheet");
  r = await I.parseXMind(one('[{"rootTopic":{"id":"x","title":"  "}}]'), "f");
  assert.equal(r.tree.text, "f");
  // wrong types everywhere are ignored, __proto__ keys are only data
  r = await I.parseXMind(one('[{"rootTopic":{"id":{"a":1},"title":7,"href":["x"],"notes":{"plain":{"content":9}},' +
    '"markers":"task-done","children":{"attached":[null,5,"s",{"title":"ok","__proto__":{"done":true}}]}},' +
    '"relationships":{"end1Id":"a"}}]'), "f");
  assert.equal(r.ok, true);
  assert.equal(r.tree.ref, "");
  assert.deepEqual(r.tree.kids.map(k => [k.text, k.done]), [["ok", false]]);
  assert.equal({}.done, undefined);
  // deep nesting: bounded, no stack overflow
  const D = 3000;
  const deep = '[{"rootTopic":' + '{"title":"d","children":{"attached":['.repeat(D) + '{"title":"leaf"}' + "]}}".repeat(D) + "}]";
  r = await I.parseXMind(one(deep), "f");
  assert.equal(r.ok, true);
  assert.equal(depth(r.tree), 101);
  // many nodes: capped
  const kids = [];
  for (let i = 0; i < M.MAX_NODES + 10; i++) kids.push({ title: "k" });
  r = await I.parseXMind(one(JSON.stringify([{ rootTopic: { title: "r", children: { attached: kids } } }])), "f");
  assert.equal(all(r.tree).length, M.MAX_NODES);
});

// Structure of XMind 8's content.xml (namespaces, xlink:href,
// marker-refs, notes with plain + html, relationships).
const X8 = `<?xml version="1.0" encoding="UTF-8" standalone="no"?><xmap-content xmlns="urn:xmind:xmap:xmlns:content:2.0" xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:svg="http://www.w3.org/2000/svg" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:xlink="http://www.w3.org/1999/xlink" modified-by="" timestamp="1460835002898" version="2.0"><sheet id="747f48p2a224f63taco4d0kso8" theme="xminddefaultthemeid" timestamp="1460835002898"><topic id="5jqc29rurhuh9f0qfsk0nnup6a" structure-class="org.xmind.ui.map" timestamp="1460835002898"><title>Shapeshift</title><extensions><extension provider="org.xmind.ui.map.unbalanced"><content><right-number>-1</right-number></content></extension></extensions><children><topics type="attached"><topic id="t1" xlink:href="http://example.com/a?b=1&amp;c=2" timestamp="1"><title svg:width="500">all manner of
scifi tropes</title><notes><plain>Plain note
second line</plain><html><xhtml:p>Plain note</xhtml:p></html></notes><children><topics type="attached"><topic id="t11"><title>robots</title><marker-refs><marker-ref marker-id="star-red"/></marker-refs></topic><topic id="t12"><title>done</title><marker-refs><marker-ref marker-id="task-done"/></marker-refs></topic></topics></children></topic><topic id="t2" xlink:href="xmind:#t1"><title>internal link</title></topic><topic id="t3" xlink:href="file:/C:/x.txt"><title>file link</title></topic></topics><topics type="detached"><topic id="fl"><title>floating</title></topic></topics></children></topic><relationships><relationship end1="t11" end2="t2" id="rel1"><title>uses</title></relationship><relationship end1="t1" end2="fl" id="rel2"/></relationships><title>Sheet 1</title></sheet><sheet id="s2"><topic id="o"><title>Other</title></topic><title>Sheet 2</title></sheet></xmap-content>`;

test("XMind 8: content.xml, first sheet, relationships", async () => {
  const bytes = zip([
    { name: "META-INF/manifest.xml", data: '<?xml version="1.0"?><manifest xmlns="urn:xmind:xmap:xmlns:manifest:1.0"/>' },
    { name: "meta.xml", data: "<meta/>" },
    { name: "content.xml", data: X8 },
    { name: "styles.xml", data: "<xmap-styles/>" },
    { name: "Thumbnails/thumbnail.png", data: Buffer.alloc(100), store: true }
  ]);
  const r = await I.parseXMind(bytes, "file");
  assert.equal(r.ok, true);
  const t = r.tree;
  assert.equal(t.text, "Shapeshift");
  assert.equal(t.ref, "5jqc29rurhuh9f0qfsk0nnup6a");
  assert.equal(t.sheets, 2);
  assert.deepEqual(t.kids.map(k => k.text), ["all manner of\nscifi tropes", "internal link", "file link"]);
  assert.equal(all(t).length, 6);
  assert.deepEqual(t.kids.map(k => k.url), ["http://example.com/a?b=1&c=2", "", ""]);
  assert.equal(t.kids[0].note, "Plain note\nsecond line");
  assert.equal(t.kids[0].kids[0].emoji, "\u2B50");
  assert.equal(t.kids[0].kids[1].done, true);
  assert.deepEqual(t.links, [{ from: "t11", to: "t2", label: "uses" }]);

  // a bare content.xml (no zip) reads the same
  const bare = await I.parseXMind(new Uint8Array(Buffer.from(X8)), "file");
  assert.equal(I.sniff(new Uint8Array(Buffer.from(X8))), "xml");
  assert.deepEqual(bare, r);
});

test("XMind 8: hostile content.xml", async () => {
  const one = s => zip([{ name: "content.xml", data: s }]);
  const lol = `<!DOCTYPE x [<!ENTITY a "AAAAAAAAAA"><!ENTITY b "&a;&a;&a;&a;&a;">]><xmap-content><sheet><topic id="r"><title>&b;T</title></topic></sheet></xmap-content>`;
  const r = await I.parseXMind(one(lol), "f");
  assert.equal(r.ok, true);
  assert.equal(r.tree.text, "T");
  const deep = "<xmap-content><sheet>" + "<topic><children><topics type=\"attached\">".repeat(2000) +
    "</topics></children></topic>".repeat(2000) + "</sheet></xmap-content>";
  assert.deepEqual(await I.parseXMind(one(deep), "f"), { ok: false, err: "format" });
  assert.deepEqual(await I.parseXMind(one("<map><node TEXT='x'/></map>"), "f"), { ok: false, err: "format" });
  assert.deepEqual(await I.parseXMind(one("<xmap-content></xmap-content>"), "f"), { ok: false, err: "empty" });
  assert.deepEqual(await I.parseXMind(one("<xmap-content><sheet/></xmap-content>"), "f"), { ok: false, err: "empty" });
});

test("XMind: broken zips and entries over the cap", async () => {
  const good = zip([{ name: "content.json", data: JSON.stringify(zenSheets()) }]);
  // not a zip at all
  assert.deepEqual(await I.parseXMind(new Uint8Array([1, 2, 3, 4, 5]), "f"), { ok: false, err: "zip" });
  // starts like a zip, no central directory
  const junk = new Uint8Array(200); junk.set([0x50, 0x4b, 0x03, 0x04]);
  assert.deepEqual(await I.parseXMind(junk, "f"), { ok: false, err: "zip" });
  // truncated
  assert.deepEqual(await I.parseXMind(good.slice(0, good.length - 30), "f"), { ok: false, err: "zip" });
  // central directory fine, deflate data garbage
  const bad = good.slice();
  for (let i = 30 + "content.json".length; i < 30 + "content.json".length + 40; i++) bad[i] = 0xff;
  assert.deepEqual(await I.parseXMind(bad, "f"), { ok: false, err: "zip" });
  // central directory points outside the file
  const off = good.slice();
  const cd = Buffer.from(off.buffer).readUInt32LE(off.length - 6);
  Buffer.from(off.buffer).writeUInt32LE(0x7fffffff, cd + 42);
  assert.deepEqual(await I.parseXMind(off, "f"), { ok: false, err: "zip" });
  // a zip without a map
  assert.deepEqual(await I.parseXMind(zip([{ name: "readme.txt", data: "hi" }]), "f"), { ok: false, err: "format" });
  // not bytes
  assert.deepEqual(await I.parseXMind("PK", "f"), { ok: false, err: "format" });
  // ArrayBuffer is fine
  assert.equal((await I.parseXMind(good.buffer.slice(good.byteOffset, good.byteOffset + good.length), "f")).ok, true);

  // over the 5 MB cap: stored entry
  const big = Buffer.alloc(M.IMPORT_MAX + 1, 0x20);
  assert.deepEqual(await I.parseXMind(zip([{ name: "content.json", data: big, store: true }]), "f"), { ok: false, err: "size" });
  // deflated entry whose header lies about its size: caught while inflating
  const bomb = Buffer.alloc(M.IMPORT_MAX * 3, 0x20);
  assert.deepEqual(await I.parseXMind(zip([{ name: "content.json", data: bomb, sizeField: 100 }]), "f"), { ok: false, err: "size" });
  // honest header over the cap: refused before inflating
  assert.deepEqual(await I.parseXMind(zip([{ name: "content.xml", data: bomb }]), "f"), { ok: false, err: "size" });
  // just under the cap is fine
  const pad = JSON.stringify(zenSheets());
  const near = Buffer.from(pad + " ".repeat(M.IMPORT_MAX - pad.length));
  assert.equal((await I.parseXMind(zip([{ name: "content.json", data: near }]), "f")).ok, true);
});

test("sniff", () => {
  assert.equal(I.sniff(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0])), "zip");
  assert.equal(I.sniff(new Uint8Array(Buffer.from("\uFEFF  \n<map/>"))), "xml");
  assert.equal(I.sniff(new Uint8Array(Buffer.from("<?xml version='1.0'?><map/>"))), "xml");
  assert.equal(I.sniff(new Uint8Array(Buffer.from("PK\x05\x06"))), "");
  assert.equal(I.sniff(new Uint8Array(Buffer.from("[{}]"))), "");
  assert.equal(I.sniff(new Uint8Array(0)), "");
  assert.equal(I.sniff(null), "");
  assert.equal(I.sniff(new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer), "zip");
});
