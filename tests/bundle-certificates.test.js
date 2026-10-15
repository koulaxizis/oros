// Certificates .oroscert (certificates/package.js + bundle.js): one set
// of certificates (event + people) packs into content.json, its
// pictures as media/<sha256>.<ext> and the register as
// preview/people.csv; the signing keys never go in; it reads back as a
// NEW event with fresh ids, and hostile content.json is cut down.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const B = require(path.join(ROOT, "bundle.js"));
const C = require(path.join(ROOT, "certificates", "core.js"));
const P = require(path.join(ROOT, "certificates", "package.js"));

const LOGO = "a".repeat(64) + ".png";
const SIG = "b".repeat(64) + ".jpg";
const K = "A".repeat(43);

function sample() {
  const ev = C.normEvent({
    id: "eaaaaaa1", m: 100, t: "Σεμινάριο Α", kind: "attend", lang: "el", sty: "classic", issuer: "Org",
    d1: "2026-05-01", hours: "8", logo: { a: LOGO, w: 200, h: 100 }, seal: { a: LOGO, w: 200, h: 100 },
    sigs: [{ n: "Director", r: "Role", a: SIG, w: 300, h: 100 }, { n: "No picture", r: "" }],
    qr: 1, pre: "A-", next: 3
  });
  const other = C.normEvent({ id: "ebbbbbb2", m: 50, t: "Other", kind: "award" });
  const ppl = [
    { id: "paaaaaa1", m: 110, e: ev.id, n: "Μαρία", em: "m@x.gr", g: "Άριστα", no: 1, iss: "2026-05-02", at: 1, ms: 1234, o: 2 },
    { id: "paaaaaa2", m: 120, e: ev.id, n: "=HYPERLINK(\"x\")", no: 2, rv: 1, o: 1 },
    { id: "pbbbbbb1", m: 10, e: other.id, n: "Elsewhere", o: 0 }
  ];
  return C.merge({ ver: 1, evs: [ev, other], ppl: ppl, tombs: { eccccc99: 5 },
    keys: [{ id: "kaaaaaa1", m: 1, made: 1, x: K, y: K, d: K }] }, null);
}

test("build: only this event and its people, list order, no keys", () => {
  const data = sample();
  assert.ok(data.keys && data.keys.length, "sample has a key");
  const b = P.build(data, "eaaaaaa1", "en");
  const c = b.content;
  assert.equal(c.kind, "oros-certificates-package");
  assert.equal(c.ver, 1);
  assert.deepEqual(c.ev, C.eventById(data, "eaaaaaa1"));
  assert.deepEqual(c.ppl.map((p) => p.id), ["paaaaaa2", "paaaaaa1"]);
  assert.deepEqual(Object.keys(c).sort(), ["ev", "kind", "ppl", "ver"]);
  const json = JSON.stringify(c);
  assert.ok(!json.includes(K), "no key material");
  assert.ok(!json.includes("kaaaaaa1"));
  assert.ok(!json.includes("Elsewhere"));
  assert.deepEqual(b.assets, [LOGO, SIG]);
  assert.equal(b.title, "Σεμινάριο Α");
  assert.equal(b.modified, 120);
  assert.equal(b.preview.length, 1);
  assert.equal(b.preview[0].name, "people.csv");
  const csv = b.preview[0].data;
  assert.ok(csv.startsWith("﻿Number,Name"));
  assert.ok(csv.includes("'=HYPERLINK"), "formula guard");
  assert.ok(csv.includes("A-0001"));
  assert.throws(() => P.build(data, "enope000"), /noevent/);
});

test("parse: a new event, fresh ids, people re-pointed, details kept", () => {
  const data = sample();
  const c = JSON.parse(JSON.stringify(P.build(data, "eaaaaaa1", "el").content));
  const r = P.parse(c, { now: 5000 });
  assert.notEqual(r.ev.id, "eaaaaaa1");
  assert.match(r.ev.id, C.EV_RE);
  assert.equal(r.ev.m, 5000);
  const { id, m, ...rest } = r.ev;
  const { id: id0, m: m0, ...rest0 } = c.ev;
  assert.deepEqual(rest, rest0);
  assert.equal(r.ppl.length, 2);
  r.ppl.forEach((p) => {
    assert.equal(p.e, r.ev.id);
    assert.match(p.id, C.P_RE);
    assert.ok(!["paaaaaa1", "paaaaaa2"].includes(p.id));
  });
  const maria = r.ppl.find((p) => p.n === "Μαρία");
  assert.deepEqual([maria.no, maria.iss, maria.at, maria.ms, maria.g, maria.em, maria.o], [1, "2026-05-02", 1, 1234, "Άριστα", "m@x.gr", 2]);
  assert.equal(r.ppl.find((p) => p.no === 2).rv, 1);
  assert.deepEqual(r.assets, [LOGO, SIG]);
  // twice → two different events
  assert.notEqual(P.parse(c, { now: 5000 }).ev.id, r.ev.id);
  // and it goes into the data as a new event next to the old one
  const r1 = C.putEvent(data, r.ev, 6000);
  assert.ok(r1.ok);
  const r2 = C.putPeople(r1.data, r.ppl, 6000);
  assert.equal(r2.added, 2);
  assert.equal(r2.data.evs.length, 3);
  assert.equal(C.eventPeople(r2.data, "eaaaaaa1").length, 2);
});

test("parse: hostile or foreign content is refused or cut down", () => {
  assert.throws(() => P.parse(null), /notpackage/);
  assert.throws(() => P.parse({ kind: "oros-notes-package", ev: {} }), /notpackage/);
  assert.throws(() => P.parse({ kind: "oros-certificates-package", ver: 1 }), /notpackage/);
  const r = P.parse({
    kind: "oros-certificates-package", ver: 1,
    ev: { t: "x".repeat(5000), kind: "evil", acc: "red; background:url(x)", logo: { a: "../../etc/passwd", w: 1, h: 1 },
      sigs: [1, 2, 3, 4, 5].map((i) => ({ n: "s" + i })), keys: [{ d: K }], __proto__: { polluted: 1 } },
    ppl: [null, 7, { n: "" }, { n: "ok", no: -4, e: "eother000", id: "../x" }].concat(Array.from({ length: 2100 }, (_, i) => ({ n: "p" + i })))
  }, { now: 1 });
  assert.equal(r.ev.t.length, C.LIM.title);
  assert.equal(r.ev.kind, "attend");
  assert.equal(r.ev.acc, C.STYLE_DEF.classic.acc);
  assert.equal(r.ev.logo, null);
  assert.equal(r.ev.sigs.length, 3);
  assert.equal(r.ev.keys, undefined);
  assert.deepEqual(r.assets, []);
  assert.equal(r.ppl.length, C.LIM.perEvent);
  assert.equal(r.ppl[0].n, "ok");
  assert.equal(r.ppl[0].no, undefined);
  assert.equal(r.ppl[0].e, r.ev.id);
  assert.equal({}.polluted, undefined);
});

test("bundle round trip: media, preview, a wrong type refused", async () => {
  const data = sample();
  const b = P.build(data, "eaaaaaa1", "en");
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 4, 5, 6]);
  // media keys are the designkit ids: the sha256 of the bytes
  const logo = (await B.sha256(png)) + ".png", sig = (await B.sha256(jpg)) + ".jpg";
  const content = JSON.parse(JSON.stringify(b.content).split(LOGO).join(logo).split(SIG).join(sig));
  const bytes = await B.write({
    mime: "application/x-oros-cert", app: "certificates", schema: "certificates/1", content,
    meta: { title: b.title, language: "en", generator: "orOS Certificates" },
    media: { [logo]: png, [sig]: jpg }, preview: b.preview, date: new Date(0)
  });
  assert.equal(B.sniff(bytes.slice(0, 128)), "application/x-oros-cert");
  const r = await B.read(bytes, { mime: "application/x-oros-cert" });
  assert.equal(r.app, "certificates");
  assert.deepEqual(Object.keys(r.media).sort(), [logo, sig].sort());
  assert.deepEqual(Array.from(r.media[logo].bytes), Array.from(png));
  const back = P.parse(r.content, { now: 9 });
  assert.deepEqual(back.assets, [logo, sig]);
  assert.equal(back.ppl.length, 2);
  // a wrong type is refused
  await assert.rejects(B.read(bytes, { mime: "application/x-oros-notes" }));
});
