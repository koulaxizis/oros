// Family Tree Gramps XML import (familytree/gramps.js): the tolerant
// XML tokenizer (entities, CDATA, comments, DOCTYPE, broken markup),
// gzip (.gramps) and plain .xml, people / names / events / places /
// notes, families (kinds, dates, child relations), the GEDCOM path's
// checks (broken links, loops), stable ids (a second import goes into
// the same tree and adds only what is new; nothing here is changed)
// and hostile input.
// Fixtures are built here from the documented Gramps XML shape.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("zlib");
const path = require("path");
const G = require(path.join(__dirname, "..", "familytree/gramps.js"));
const F = require(path.join(__dirname, "..", "familytree/ft-core.js"));

let seq = 0;
function newId() { return "g" + (++seq).toString(36).padStart(4, "0"); }
const NOW = 1790000000000;
function parse(text, local, now) { return G.parse(text, local || null, { name: "Smith family", now: now || NOW, newId }); }
function db(body) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<!DOCTYPE database PUBLIC "-//Gramps//DTD Gramps XML 1.7.1//EN" "http://gramps-project.org/xml/1.7.1/grampsxml.dtd">\n' +
    '<database xmlns="http://gramps-project.org/xml/1.7.1/">\n<header><created date="2026-10-01" version="5.2.3"/></header>\n' +
    body + "\n</database>\n";
}
const XML = db(`
  <!-- a comment with <person> in it -->
  <events>
    <event handle="_e1" id="E0001"><type>Birth</type><dateval val="1900-03-12" type="about"/><place hlink="_pl1"/></event>
    <event handle="_e2" id="E0002"><type>Death</type><dateval val="1970" type="before"/></event>
    <event handle="_e3" id="E0003"><type>Burial</type></event>
    <event handle="_e4" id="E0004"><type>Marriage</type><dateval val="1925-00-00"/></event>
    <event handle="_e5" id="E0005"><type>Divorce</type><dateval val="1940-06"/></event>
    <event handle="_e6" id="E0006"><type>Birth</type><daterange start="1950" stop="1952"/></event>
    <event handle="_e7" id="E0007"><type>Birth</type><dateval val="5700" cformat="Hebrew"/></event>
    <event handle="_e8" id="E0008"><type>Birth</type><datestr val="ABT 12 MAR 1890"/></event>
    <event handle="_e9" id="E0009"><type>Birth</type><dateval val="1930-02-30"/></event>
  </events>
  <people>
    <person handle="_p1" id="I0001">
      <gender>M</gender>
      <name type="Birth Name"><first>John</first><surname prefix="van">Smith</surname><suffix>Jr.</suffix></name>
      <eventref hlink="_e1" role="Primary"/><eventref hlink="_e2" role="Primary"/>
      <parentin hlink="_f1"/><noteref hlink="_n1"/>
    </person>
    <person handle="_p2" id="I0002">
      <gender>F</gender>
      <name type="Married Name"><first>Mary</first><surname>Smith</surname></name>
      <name alt="1" type="Birth Name"><first>Mary</first><surname>Brown</surname></name>
      <eventref hlink="_e3" role="Primary"/><eventref hlink="_e1" role="Witness"/>
      <parentin hlink="_f1"/>
    </person>
    <person handle="_p3" id="I0003">
      <gender>F</gender>
      <name type="Birth Name"><first>Ann &amp; Co &#233;&#x3b1; <![CDATA[<b>x</b>]]></first><surname>Smith</surname></name>
      <eventref hlink="_e6"/><childof hlink="_f1"/>
    </person>
    <person handle="_p4" id="I0004">
      <gender>U</gender><name><first>Bob</first></name>
      <eventref hlink="_e7"/><childof hlink="_f1"/><childof hlink="_fX"/>
    </person>
    <person handle="_p5" id="I0005"><gender>X</gender><name><first>Dee</first></name><eventref hlink="_e8"/></person>
    <person handle="_p6" id="I0006"><name><first>Eve</first></name><eventref hlink="_e9"/></person>
  </people>
  <families>
    <family handle="_f1" id="F0001">
      <rel type="Married"/><father hlink="_p1"/><mother hlink="_p2"/>
      <eventref hlink="_e4" role="Family"/><eventref hlink="_e5" role="Family"/>
      <childref hlink="_p3" mrel="Adopted" frel="Adopted"/><childref hlink="_p4" frel="Stepchild"/>
      <childref hlink="_pGone"/>
    </family>
    <family handle="_f2" id="F0002"><rel type="Unmarried"/><father hlink="_p5"/><mother hlink="_p6"/></family>
  </families>
  <places>
    <placeobj handle="_pl0" id="P0000" type="Country"><pname value="Greece"/></placeobj>
    <placeobj handle="_pl1" id="P0001" type="City"><pname value="Athens"/><placeref hlink="_pl0"/></placeobj>
  </places>
  <notes>
    <note handle="_n1" id="N0001" type="Person Note"><text>First line
second line &lt;i&gt;</text></note>
  </notes>`);

function byGiven(d, g) { return d.people.find((p) => p.given.indexOf(g) === 0); }

test("tokenizer: elements, attributes, entities, CDATA; comments and DOCTYPE skipped", () => {
  const t = G.xml('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e "boom">]><a x=\'1\' y="&lt;2&gt;"><!-- <b/> --><b/>t&e;<c>&#65;<![CDATA[<z>]]></c></a>');
  const a = t.k[0];
  assert.equal(a.n, "a");
  assert.deepEqual([a.a.x, a.a.y], ["1", "<2>"]);
  assert.deepEqual(a.k.map((k) => k.n), ["b", "c"]);
  assert.equal(a.t, "t&e;");                                 // DTD entities are never expanded
  assert.equal(a.k[1].t, "A<z>");
  // broken markup is forgiven
  const b = G.xml("<r><p><q>1</r><s a=1>2</s></unknown>");
  assert.deepEqual(b.k.map((k) => k.n), ["r", "s"]);      // </r> closes p and q too
  assert.equal(b.k[0].k[0].k[0].t, "1");
  assert.equal(b.k[1].a.a, "1");
  assert.equal(G.gDate("1925-00-00"), "1925");
  assert.equal(G.gDate("1940-06"), "1940-06");
  assert.equal(G.gDate("1930-02-30"), "");
});

test("people, names, events, places and notes", () => {
  const r = parse(XML);
  assert.equal(r.ok, true, JSON.stringify(r));
  const d = r.data;
  assert.equal(d.trees.length, 1);
  assert.equal(d.trees[0].name, "Smith family");
  assert.equal(r.into, "");
  assert.equal(d.people.length, 6);
  const john = byGiven(d, "John");
  assert.equal(john.family, "van Smith Jr.");
  assert.equal(john.sex, "m");
  assert.deepEqual(john.birth, { d: "1900-03-12", q: "abt", place: "Athens, Greece" });
  assert.deepEqual(john.death, { d: "1970", q: "bef", place: "" });
  assert.equal(john.dead, true);
  assert.equal(john.note, "First line\nsecond line <i>");
  const mary = byGiven(d, "Mary");
  assert.equal(mary.family, "Smith");
  assert.equal(mary.birthName, "Brown");
  assert.equal(mary.dead, true);                            // burial
  assert.deepEqual(mary.birth, { d: "", q: "", place: "" }); // a witness role is not her birth
  const ann = byGiven(d, "Ann");
  assert.equal(ann.given, "Ann & Co éα <b>x</b>");           // text, never markup
  assert.deepEqual(ann.birth, { d: "1950", q: "abt", place: "" });
  assert.deepEqual(byGiven(d, "Bob").birth.d, "");          // Hebrew calendar left out
  assert.equal(byGiven(d, "Bob").sex, "u");
  assert.deepEqual(byGiven(d, "Dee").birth, { d: "1890-03-12", q: "abt", place: "" });
  assert.equal(byGiven(d, "Dee").sex, "x");
  assert.equal(byGiven(d, "Eve").birth.d, "");              // 30 February
  assert.equal(d.trees[0].home, byGiven(d, "John").id);
});

test("families: kinds, dates, child relations; broken links counted", () => {
  const r = parse(XML);
  const d = r.data;
  const john = byGiven(d, "John"), mary = byGiven(d, "Mary");
  const f1 = d.unions.find((u) => u.a === john.id);
  assert.equal(f1.b, mary.id);
  assert.equal(f1.kind, "divorced");
  assert.deepEqual(f1.start, { d: "1925", q: "" });
  assert.deepEqual(f1.end, { d: "1940-06", q: "" });
  const f2 = d.unions.find((u) => u.a === byGiven(d, "Dee").id);
  assert.equal(f2.kind, "partner");
  assert.deepEqual(byGiven(d, "Ann").parents, [{ u: f1.id, kind: "adopted" }]);
  assert.deepEqual(byGiven(d, "Bob").parents, [{ u: f1.id, kind: "step" }]);
  assert.equal(r.stats.refs, 2);                            // _pGone, _fX
  assert.equal(r.stats.people, 6);
  assert.equal(r.stats.unions, 2);
  // every id is a valid Family Tree id with the import prefix
  d.people.concat(d.unions, d.trees).forEach((x) => assert.match(x.id, /^imp-[a-z0-9]+$/));
});

test("a .gramps file is gzip; sniff knows both", async () => {
  const gz = new Uint8Array(zlib.gzipSync(Buffer.from(XML, "utf8")));
  assert.equal(G.sniff(gz, "family.gramps"), true);
  assert.equal(G.sniff(gz, "x.bin"), true);
  const plain = new TextEncoder().encode(XML);
  assert.equal(G.sniff(plain, "export.xml"), true);
  assert.equal(G.sniff(new TextEncoder().encode("0 HEAD\n1 CHAR UTF-8\n"), "a.ged"), false);
  assert.equal(G.sniff(new TextEncoder().encode("<?xml version='1.0'?><html/>"), "a.xml"), false);
  const text = await G.decode(gz);
  assert.equal(text, XML);
  assert.equal(await G.decode(plain), XML);
  await assert.rejects(G.decode(new Uint8Array([0x1f, 0x8b, 8, 0, 1, 2, 3])), /gzip/);
});

test("a second import goes into the same tree and adds only what is new", () => {
  const first = parse(XML);
  const local = F.merge(first.data, {});
  // the person edited Ann here meanwhile
  const ann = byGiven(local, "Ann");
  ann.given = "Annie";
  ann.m = NOW + 10;
  // a newer export: one more child of family _f1
  const xml2 = XML.replace("</people>", '<person handle="_p7" id="I0007"><gender>M</gender><name><first>Tom</first></name><childof hlink="_f1"/></person></people>');
  const r = parse(xml2, local, NOW + 100);
  assert.equal(r.ok, true);
  assert.equal(r.into, local.trees[0].id);
  assert.equal(r.stats.have, 6);
  assert.deepEqual(r.data.people.map((p) => p.given), ["Tom"]);
  assert.equal(r.data.unions.length, 0);
  assert.equal(r.data.trees[0].id, local.trees[0].id);
  const f1 = local.unions.find((u) => u.a === byGiven(local, "John").id);
  assert.deepEqual(r.data.people[0].parents, [{ u: f1.id, kind: "birth" }]);
  // merged: Ann keeps the edit, nothing else changes
  const merged = F.merge(local, r.data);
  assert.equal(merged.people.length, 7);
  assert.equal(byGiven(merged, "Annie").m, NOW + 10);
  assert.deepEqual(merged.trees, local.trees);
  // the very same file again: nothing new
  const same = parse(XML, merged, NOW + 200);
  assert.equal(same.data.people.length, 0);
  assert.equal(same.data.unions.length, 0);
});

test("loops are cut, as in GEDCOM", () => {
  const loop = db(`<people>
    <person handle="_a"><name><first>A</first></name><childof hlink="_fb"/><parentin hlink="_fa"/></person>
    <person handle="_b"><name><first>B</first></name><childof hlink="_fa"/><parentin hlink="_fb"/></person>
  </people><families>
    <family handle="_fa"><father hlink="_a"/><childref hlink="_b"/></family>
    <family handle="_fb"><father hlink="_b"/><childref hlink="_a"/></family>
  </families>`);
  const r = parse(loop);
  assert.equal(r.ok, true);
  assert.equal(r.stats.cycles, 1);
});

test("not Gramps, empty, too large and hostile files", () => {
  assert.deepEqual(parse("<html><body/></html>"), { ok: false, err: "format" });
  assert.deepEqual(parse("not xml at all"), { ok: false, err: "format" });
  assert.deepEqual(parse(db("<people></people>")), { ok: false, err: "empty" });
  assert.deepEqual(G.parse(null, null, {}), { ok: false, err: "format" });
  // duplicate handles: the second is dropped; "__proto__" is just a handle
  const r = parse(db(`<people>
    <person handle="__proto__"><name><first>${"x".repeat(500)}</first></name></person>
    <person handle="__proto__"><name><first>Dup</first></name></person>
    <person handle="_z"><name><first>Z‮\u0007</first></name><noteref hlink="__proto__"/><childof hlink="constructor"/></person>
  </people>`));
  assert.equal(r.ok, true);
  assert.equal(r.data.people.length, 2);
  assert.equal(r.stats.dropped, 1);
  assert.equal(r.data.people[0].given.length <= F.NAME_LEN, true);
  assert.ok(r.data.people.some((p) => p.given === "Z"));
  // an unclosed tag at the end of the file does not hang
  assert.equal(G.xml("<database><people><person handle=\"x").k[0].n, "database");
});
