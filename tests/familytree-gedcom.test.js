// Family Tree GEDCOM (familytree/ft-core.js section 10): dates,
// decoding (UTF-8 / ANSEL / Windows-1252), import into a new tree
// (hostile and broken files), export (GEDCOM 5.5.1) and round trip.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const F = require(path.join(__dirname, "..", "familytree/ft-core.js"));

let seq = 0;
function newId() { return "g" + (++seq).toString(36).padStart(4, "0"); }
function parse(text, local) { return F.parseGedcom(text, local || null, { name: "Test file", now: 1000, newId }); }
function ged(lines) { return ["0 HEAD", "1 GEDC", "2 VERS 5.5.1", "1 CHAR UTF-8"].concat(lines, ["0 TRLR"]).join("\n"); }
function byGiven(d, g) { return d.people.find((p) => p.given === g); }
function unionOf(d, p) { return d.unions.find((u) => u.id === p.parents[0].u); }

const FAMILY = ged([
  "0 @I1@ INDI", "1 NAME John /Smith/ Jr.", "1 SEX M",
  "1 BIRT", "2 DATE ABT 12 MAR 1900", "2 PLAC Athens, Greece",
  "1 DEAT", "2 DATE BEF 1970", "1 FAMS @F1@", "1 NOTE @N1@",
  "0 @I2@ INDI", "1 NAME Mary /Jones/", "2 TYPE married", "1 NAME Mary /Brown/", "2 TYPE birth",
  "1 SEX F", "1 BURI", "1 FAMS @F1@",
  "0 @I3@ INDI", "1 NAME Ann /Smith/", "1 SEX F", "1 BIRT", "2 DATE 1652/53",
  "1 FAMC @F1@", "2 PEDI adopted",
  "0 @I4@ INDI", "1 NAME Bob /Smith/", "1 SEX X",
  "0 @I5@ INDI", "1 NAME Edward_VII  /Wettin/",
  "0 @F1@ FAM", "1 HUSB @I1@", "1 WIFE @I2@", "1 MARR", "2 DATE 1925", "1 DIV", "2 DATE JUN 1940",
  "1 CHIL @I3@", "1 CHIL @I4@", "2 _FREL Step", "2 _MREL Step", "1 CHIL @VOID@",
  "0 @N1@ NOTE First line", "1 CONT second line with a sp", "1 CONC lit word and @@ sign"
]);

test("GEDCOM dates map to partial dates with qualifiers", () => {
  const cases = {
    "12 MAR 1900": { d: "1900-03-12", q: "" }, "MAR 1900": { d: "1900-03", q: "" }, "1900": { d: "1900", q: "" },
    "ABT 1900": { d: "1900", q: "abt" }, "EST 1900": { d: "1900", q: "abt" }, "CAL 1900": { d: "1900", q: "abt" },
    "BEF 1900": { d: "1900", q: "bef" }, "AFT 1900": { d: "1900", q: "aft" }, "TO 1900": { d: "1900", q: "bef" },
    "BET 1900 AND 1910": { d: "1900", q: "abt" }, "FROM 1900 TO 1910": { d: "1900", q: "abt" },
    "INT 1900 (from a letter)": { d: "1900", q: "" }, "1652/53": { d: "1653", q: "" }, "  8 mar 1137/1138": { d: "1138-03-08", q: "" },
    "@#DJULIAN@ 12 MAR 1600": { d: "1600-03-12", q: "" }, "JULIAN 1600": { d: "1600", q: "" }, "476": { d: "0476", q: "" }
  };
  Object.keys(cases).forEach((s) => assert.deepEqual(F.gedDate(s), cases[s], s));
  ["10 JAN", "30 FEB 1900", "12 1900", "@#DHEBREW@ 5700", "(sometime)", "44 B.C.", "1900 XYZ", "3000", ""].forEach((s) => {
    assert.equal(F.gedDate(s), null, s);
  });
});

test("import: people, names, events, notes, families into one new tree", () => {
  const r = parse(FAMILY);
  assert.ok(r.ok);
  const d = r.data;
  assert.equal(d.trees.length, 1);
  assert.equal(d.trees[0].name, "Test file");
  assert.deepEqual([r.stats.people, r.stats.unions, r.stats.refs, r.stats.dropped], [5, 1, 0, 0]);
  const john = byGiven(d, "John");
  assert.equal(john.family, "Smith Jr.");
  assert.equal(john.sex, "m");
  assert.deepEqual(john.birth, { d: "1900-03-12", q: "abt", place: "Athens, Greece" });
  assert.deepEqual([john.death.d, john.death.q, john.dead], ["1970", "bef", true]);
  assert.equal(john.note, "First line\nsecond line with a split word and @ sign");
  assert.equal(d.trees[0].home, john.id);
  const mary = byGiven(d, "Mary");
  assert.deepEqual([mary.family, mary.birthName, mary.sex, mary.dead], ["Jones", "Brown", "f", true]);
  const ann = byGiven(d, "Ann"), bob = byGiven(d, "Bob");
  assert.equal(ann.birth.d, "1653");
  assert.deepEqual(ann.parents.map((x) => x.kind), ["adopted"]);
  assert.deepEqual(bob.parents.map((x) => x.kind), ["step"]);
  assert.equal(bob.sex, "x");
  const u = unionOf(d, ann);
  assert.deepEqual([u.a, u.b, u.kind, u.start.d, u.end.d], [john.id, mary.id, "divorced", "1925", "1940-06"]);
  assert.equal(byGiven(d, "Edward VII").family, "Wettin");
  d.people.concat(d.unions).forEach((x) => assert.equal(x.tree, d.trees[0].id));
});

test("import: broken references are cut and counted, loops refused", () => {
  const r = parse(ged([
    "0 @I1@ INDI", "1 NAME A /X/", "1 FAMC @F2@", "1 FAMC @NOPE@",
    "0 @I2@ INDI", "1 NAME B /X/", "1 FAMC @F1@",
    "0 @F1@ FAM", "1 HUSB @I1@", "1 WIFE @GONE@", "1 CHIL @I2@", "1 CHIL @MISSING@",
    "0 @F2@ FAM", "1 HUSB @I2@", "1 CHIL @I1@",
    "0 @I1@ INDI", "1 NAME Duplicate /X/"
  ]));
  assert.ok(r.ok);
  assert.equal(r.stats.people, 2);
  assert.equal(r.stats.dropped, 1);
  assert.equal(r.stats.refs, 3);                    // @NOPE@, @GONE@, @MISSING@
  assert.equal(r.stats.cycles, 1);                  // A child of B child of A
  const a = byGiven(r.data, "A"), b = byGiven(r.data, "B");
  assert.equal(a.parents.length + b.parents.length, 1);
});

test("import refuses what is not a usable GEDCOM file", () => {
  assert.equal(parse("not a gedcom").err, "format");
  assert.equal(parse("0 INDI\n1 NAME x").err, "format");
  assert.equal(parse(ged(["0 @S1@ SUBM", "1 NAME x"])).err, "empty");
  assert.equal(parse(42).err, "format");
  assert.equal(parse("0 HEAD\n" + "x".repeat(F.GED_MAX)).err, "size");
  const many = [];
  for (let i = 0; i <= F.MAX_PEOPLE; i++) many.push("0 @I" + i + "@ INDI");
  assert.equal(parse(ged(many)).err, "toolarge");
});

test("import of hostile values: text only, capped, no stray records", () => {
  const evil = "<img src=x onerror=alert(1)>‮\u0000";
  const r = parse(ged([
    "0 @I1@ INDI", "1 NAME " + evil + " /" + "L".repeat(500) + "/", "1 SEX <b>",
    "1 NOTE " + "n".repeat(5000), "1 BIRT", "2 DATE javascript:alert(1)", "2 PLAC " + evil,
    "0 @__proto__@ INDI", "1 NAME Proto", "1 FAMC @constructor@",
    "3 NAME orphan line at a deeper level", "garbage line", "0 @F1@ FAM", "1 HUSB @__proto__@"
  ]));
  assert.ok(r.ok);
  const p = r.data.people.find((x) => x.given.indexOf("<img") === 0);
  assert.equal(p.given, "<img src=x onerror=alert(1)>");          // a plain string, shown with textContent
  assert.equal(p.family.length, F.NAME_LEN);
  assert.equal(p.note.length, F.NOTE_LEN);
  assert.equal(p.sex, "u");
  assert.equal(p.birth.d, "");
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(r.data.people.length, 2);
  r.data.people.forEach((x) => assert.ok(F.isId(x.id)));
  assert.equal(byGiven(r.data, "Proto").parents.length, 0);
  assert.equal(r.data.unions[0].a, byGiven(r.data, "Proto").id);
});

test("decoding: BOM UTF-8, plain UTF-8, ANSEL, Windows-1252, UTF-16", () => {
  const enc = (s) => new TextEncoder().encode(s);
  const head = (ch) => "0 HEAD\n1 CHAR " + ch + "\n0 @I1@ INDI\n1 NAME ";
  assert.equal(F.decodeGedcom(Uint8Array.from([0xEF, 0xBB, 0xBF, ...enc("0 HEAD")])), "0 HEAD");
  assert.ok(F.decodeGedcom(enc(head("UTF-8") + "Γιώργος")).endsWith("Γιώργος"));
  // ANSEL: combining acute (E2) BEFORE the letter, then ł (B1)
  const ansel = Uint8Array.from([...enc(head("ANSEL") + "Jos"), 0xE2, 0x65, 0x20, 0xB1, 0x6F]);
  assert.ok(F.decodeGedcom(ansel).endsWith("José ło"));
  const cp = Uint8Array.from([...enc(head("ANSI") + "Fran"), 0xE7, 0x6F, 0x69, 0x73]);
  assert.ok(F.decodeGedcom(cp).endsWith("François"));
  // No CHAR and not valid UTF-8: Windows-1252
  assert.ok(F.decodeGedcom(Uint8Array.from([...enc("0 HEAD\n1 NAME M"), 0xFC, 0x6C, 0x6C, 0x65, 0x72])).endsWith("Müller"));
  const u16 = Buffer.from("﻿0 HEAD", "utf16le");
  assert.equal(F.decodeGedcom(new Uint8Array(u16)), "0 HEAD");
});

test("export: GEDCOM 5.5.1 that reads back the same", () => {
  const d = parse(FAMILY).data;
  const longNote = "word ".repeat(120) + "\nline two @ home";
  byGiven(d, "Ann").note = longNote;
  const text = F.exportGedcom(d, d.trees[0].id, { date: new Date(Date.UTC(2026, 9, 10)) });
  const lines = text.split("\r\n");
  assert.deepEqual(lines.slice(0, 4), ["0 HEAD", "1 SOUR orOS", "2 NAME orOS Family Tree", "1 DATE 10 OCT 2026"]);
  assert.ok(lines.includes("2 VERS 5.5.1") && lines.includes("1 CHAR UTF-8"));
  assert.equal(lines[lines.length - 2], "0 TRLR");
  lines.filter(Boolean).forEach((l) => {
    assert.ok(l.length <= 255, "line too long");
    assert.match(l, /^\d+ (@[A-Z0-9]+@ )?[A-Z_0-9]+( .*)?$/);
  });
  assert.ok(lines.includes("2 PEDI adopted"));
  assert.ok(lines.includes("2 _FREL Step"));
  assert.ok(lines.includes("1 SEX U"));             // X is not in 5.5.1
  assert.ok(lines.includes("2 DATE ABT 12 MAR 1900"));
  assert.ok(lines.some((l) => l.startsWith("3 CONC") || l.startsWith("2 CONC")));
  assert.ok(lines.includes("2 CONT line two @@ home"));

  seq = 1000;
  const back = parse(text).data;
  const sig = (x) => x.people.map((p) => [p.given, p.family, p.birthName, p.birth.d, p.birth.q, p.birth.place,
    p.death.d, p.death.q, p.dead, p.note, p.parents.map((r) => r.kind).join()].join("|")).sort();
  assert.deepEqual(sig(back), sig(d));
  const u = back.unions[0];
  assert.deepEqual([u.kind, u.start.d, u.end.d], ["divorced", "1925", "1940-06"]);
});

test("export: hide details of the living; partners and single parents", () => {
  const d = F.merge({
    trees: [{ id: "t1", m: 1, name: "T", home: "" }],
    people: [
      { id: "p1", m: 1, tree: "t1", given: "Live", family: "A/B", sex: "f", birth: { d: "1990-01-02", place: "Here" }, note: "secret", parents: [] },
      { id: "p2", m: 1, tree: "t1", given: "Old", family: "C", sex: "m", birth: { d: "1900" }, dead: true, note: "kept", parents: [] },
      { id: "p3", m: 1, tree: "t1", given: "Kid", family: "C", parents: [{ u: "u1", kind: "foster" }, { u: "u2", kind: "birth" }] }
    ],
    unions: [
      { id: "u1", m: 1, tree: "t1", a: "p1", b: "p2", kind: "married", start: { d: "2010" } },
      { id: "u2", m: 1, tree: "t1", a: "", b: "", kind: "unknown" }
    ],
    tombs: {}
  }, {});
  const hid = F.exportGedcom(d, "t1", { living: true });
  assert.ok(!hid.includes("1990") && !hid.includes("Here") && !hid.includes("secret") && !hid.includes("2010"));
  assert.ok(hid.includes("1 NAME Live /A-B/") && hid.includes("kept") && hid.includes("2 DATE 1900"));
  assert.ok(hid.includes("1 HUSB @I2@") && hid.includes("1 WIFE @I1@"));   // by sex
  assert.ok(hid.includes("1 MARR Y"));
  const full = F.exportGedcom(d, "t1", {});
  assert.ok(full.includes("2 DATE 2 JAN 1990") && full.includes("secret") && full.includes("2 PEDI foster"));
  const back = parse(full).data;
  const kid = byGiven(back, "Kid");
  assert.deepEqual(kid.parents.map((r) => r.kind).sort(), ["birth", "foster"]);
});
