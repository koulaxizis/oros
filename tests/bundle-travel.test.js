// Travel .orostrip (travel/package.js + bundle.js): one trip packs into
// content.json with its attachments as media, reads back as a NEW trip
// with fresh ids and remapped owners, and junk content.json is refused.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const B = require(path.join(ROOT, "bundle.js"));
const P = require(path.join(ROOT, "travel", "package.js"));

const MIME = "application/x-oros-trip";
const NOW = 1760000000000;
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const PDF = new TextEncoder().encode("%PDF-1.4 hello");

function jrnlId(tripId, day) { return "j" + day.replace(/-/g, "") + "-" + tripId.slice(0, 31); }
function counter() { let n = 0; return () => "new" + String(++n).padStart(4, "0"); }

function sampleTrip() {
  const f = (o) => Object.fromEntries(Object.keys(o).map((k) => [k, 5]));
  const trip = { id: "trip-aaaa", name: "Κρήτη / Crete", dest: "Chania", start: "2026-07-01", end: "2026-07-05",
    people: ["Ann", "Bo"], notes: "line 1\nline 2", cur: "EUR", bplan: { stay: 50000 }, geo: { lat: 35.5, lon: 24 } };
  trip.f = f(trip);
  const ent = (o) => Object.assign(o, { f: f(o) });
  trip.pack = [ent({ id: "pk01", name: "Hat", qty: 1, rule: null, grp: "clothes", who: "", note: "", done: true })];
  trip.plan = [ent({ id: "pl01", kind: "flight", title: "", day: "2026-07-01", t1: "09:00", day2: "", t2: "",
    place: "", from: "ATH", to: "CHQ", ref: "XY12", note: "", pos: 0, num: "A3 1", prov: "Aegean", cost: 9900,
    ccur: "EUR", geo: { lat: 35.5, lon: 24.1 }, geo0: { lat: 37.9, lon: 23.9 } })];
  trip.spend = [ent({ id: "sp01", cat: "food", amt: 2500, cur: "EUR", day: "2026-07-02", what: "Dinner", who: "Ann" })];
  trip.jrnl = [ent({ id: jrnlId("trip-aaaa", "2026-07-02"), day: "2026-07-02", text: "Sea", trk: "" })];
  trip.docs = [
    ent({ id: "dc01", of: "pl01", file: "dc01.pdf", name: "boarding.pdf" }),
    ent({ id: "dc02", of: trip.jrnl[0].id, file: "dc02.jpg", name: "beach.jpg" }),
    // a journal photo of a day that has no text yet (no jrnl entry)
    ent({ id: "dc03", of: jrnlId("trip-aaaa", "2026-07-03"), file: "dc03.jpg", name: "boat.jpg" }),
    ent({ id: "dc04", of: "nobody", file: "dc04.jpg", name: "orphan.jpg" }),
    ent({ id: "dc05", of: "pl01", file: "dc05.pdf", name: "not on disk.pdf" })
  ];
  return trip;
}

async function packed() {
  const trip = sampleTrip();
  const bytes = { "dc01.pdf": PDF, "dc02.jpg": JPG, "dc03.jpg": JPG, "dc04.jpg": JPG };
  const keys = {}, media = {};
  for (const d of trip.docs) {
    if (!bytes[d.file]) continue;
    const k = (await B.sha256(bytes[d.file])) + "." + d.file.split(".").pop();
    keys[d.file] = k;
    media[k] = bytes[d.file];
  }
  const content = P.build(trip, keys);
  return { trip, content, bundle: await B.write({ mime: MIME, app: "travel", schema: "travel/1", content,
    meta: { title: trip.name, id: trip.id, language: "el", generator: "orOS Travel" }, media,
    preview: [{ name: "trip.md", data: "# x\n", type: "text/markdown" }], date: new Date(NOW) }) };
}

test("build: the trip as synced, docs point at media keys, unreadable ones left out", async () => {
  const { trip, content } = await packed();
  assert.equal(content.kind, "oros-travel-package");
  assert.equal(content.ver, 1);
  assert.equal(content.trip.id, trip.id);
  assert.deepEqual(content.trip.plan, trip.plan);
  assert.deepEqual(content.trip.f, trip.f);
  assert.equal(content.trip.docs.length, 4);
  content.trip.docs.forEach((d) => assert.match(d.file, /^[0-9a-f]{64}\.(jpg|pdf)$/));
  assert.equal(trip.docs[0].file, "dc01.pdf", "the live trip is not changed");
});

test("round trip through the bundle: a new trip, fresh ids, owners remapped", async () => {
  const { content, bundle } = await packed();
  const r = await B.read(bundle, { mime: MIME });
  assert.equal(r.app, "travel");
  assert.equal(r.meta.title, "Κρήτη / Crete");
  assert.equal(Object.keys(r.media).length, 2, "same bytes share one key");
  const res = P.parse(r.content, { newId: counter(), jrnlId, now: NOW });
  const t = res.trip;
  assert.notEqual(t.id, "trip-aaaa");
  assert.equal(t.name, "Κρήτη / Crete");
  assert.deepEqual(t.bplan, { stay: 50000 });
  assert.equal(t.f.name, NOW);
  assert.notEqual(t.plan[0].id, "pl01");
  assert.equal(t.plan[0].ref, "XY12");
  assert.deepEqual(t.plan[0].geo0, { lat: 37.9, lon: 23.9 });
  assert.equal(t.pack[0].done, true);
  assert.equal(t.spend[0].what, "Dinner");
  assert.equal(t.jrnl[0].id, jrnlId(t.id, "2026-07-02"));
  // the orphan doc is dropped; the rest are remapped and wait for their bytes
  assert.equal(t.docs.length, 3);
  assert.equal(t.docs[0].of, t.plan[0].id);
  assert.equal(t.docs[1].of, t.jrnl[0].id);
  assert.equal(t.docs[2].of, jrnlId(t.id, "2026-07-03"));
  t.docs.forEach((d) => assert.equal(d.file, ""));
  assert.equal(res.files.length, 3);
  res.files.forEach((x) => assert.ok(r.media[x.key], "media for " + x.key));
  assert.equal(res.files[0].key, content.trip.docs[0].file);
  assert.equal(r.media[res.files[0].key].type, "application/pdf");
  const ids = new Set([t.id].concat(...["pack", "plan", "docs", "spend", "jrnl"].map((k) => t[k].map((x) => x.id))));
  assert.equal(ids.size, 1 + 1 + 1 + 3 + 1 + 1);
});

test("an unzipped folder with a swapped photo reads with the photo's new key", async () => {
  const { bundle } = await packed();
  const r0 = await B.read(bundle, { mime: MIME });
  const NEW = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9]);
  const list = [
    { path: "Trip/mimetype", bytes: new TextEncoder().encode(MIME) },
    { path: "Trip/content.json", bytes: new TextEncoder().encode(JSON.stringify(r0.content)) }
  ];
  for (const k of Object.keys(r0.media)) list.push({ path: "Trip/media/" + k, bytes: /\.jpg$/.test(k) ? NEW : r0.media[k].bytes });
  const r = await B.readFolder(list, { mime: MIME });
  const res = P.parse(r.content, { newId: counter(), jrnlId, now: NOW });
  const photo = res.files.find((x) => /\.jpg$/.test(x.key));
  assert.deepEqual(Array.from(r.media[photo.key].bytes), Array.from(NEW));
});

test("junk content is refused, hostile fields are not trusted", () => {
  const o = { newId: counter(), jrnlId, now: NOW };
  assert.throws(() => P.parse(null, o), /notpackage/);
  assert.throws(() => P.parse({ kind: "oros-kanban-package", trip: {} }, o), /notpackage/);
  assert.throws(() => P.parse({ kind: "oros-travel-package", trip: [] }, o), /notpackage/);
  const res = P.parse({ kind: "oros-travel-package", ver: 1, trip: { id: "x", name: "N", plan: "nope",
    pack: [null, 3, { id: "a", name: "ok" }], docs: [{ id: "d", of: "x", file: "../../etc/passwd" }],
    jrnl: [{ day: "2026-01-01" }, { day: "2026-01-01" }] } }, o);
  assert.deepEqual(res.trip.plan, []);
  assert.equal(res.trip.pack.length, 1);
  assert.equal(res.trip.docs.length, 0, "a bad media key is dropped");
  assert.equal(res.trip.jrnl.length, 1, "one journal entry per day");
});
