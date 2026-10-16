// The .orosplants file (Plant Care, a record app): every plant and its
// care history through the shared kit (recordpkg.js) and bundle.js;
// opening adds only what is missing, with its ids. Plus the app wiring
// (Save, Open, unzipped folder, "Open with").
// Run: node --test tests/*.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const B = require(path.join(ROOT, "bundle.js"));
const K = require(path.join(ROOT, "recordpkg.js"));
const C = require(path.join(ROOT, "plants/core.js"));
const P = require(path.join(ROOT, "plants/package.js"));
const F = require(path.join(ROOT, "fileopen.js"));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const D = P.DESC;
const NOW = Date.now();               // core.merge prunes by the real clock
const TODAY = C.ymdOf(new Date(NOW));
const D1 = C.addDays(TODAY, -10), D2 = C.addDays(TODAY, -3);

function plant(id, o) {
  return Object.assign({ id, m: NOW - 1000, name: "Plant " + id, sp: "", room: "Kitchen", out: 0, em: "",
                         w: 7, ww: 0, f: 0, mi: 0, r: 0, st: D1, sn: {}, notes: "" }, o || {});
}
function slice() {
  return C.merge({
    ver: 1,
    plants: [plant("plantaaa01", { name: "Monty", sp: "monstera", sci: "Monstera deliciosa", ww: 14, mi: 7, notes: "By the window" }),
             plant("plantaaa02", { name: "Basil", sp: "basil", out: 1, w: 2 }),
             plant("plantgone1", { m: NOW - 9000 })],
    log: [{ id: "logaaa0001", p: "plantaaa01", k: "water", d: D1, s: 0, m: NOW - 900 },
          { id: "logaaa0002", p: "plantaaa01", k: "water", d: D2, s: 0, m: NOW - 800 },
          { id: "logaaa0003", p: "plantaaa02", k: "water", d: D2, s: 1, m: NOW - 700 },
          { id: "loggone001", p: "plantaaa02", k: "mist", d: D2, s: 0, m: NOW - 9000 }],
    tombs: { plantgone1: NOW - 500, loggone001: NOW - 500 }
  }, null, NOW);
}

test("plants: round trip through bundle.js; the file has no tombstones and no prefs", async () => {
  const s = slice();
  assert.deepEqual(s.plants.map((p) => p.id), ["plantaaa01", "plantaaa02"]);
  const o = K.pack(D, s, { title: "Plant Care", lang: "en", now: NOW });
  assert.equal(o.mime, "application/x-oros-plants");
  assert.equal(o.generator, "orOS Plant Care");
  assert.deepEqual(Object.keys(o.content.data).sort(), ["log", "plants", "ver"]);
  assert.deepEqual(o.content.data.log.map((x) => x.id), ["logaaa0001", "logaaa0002", "logaaa0003"]);
  const bytes = await B.write(o);
  assert.equal(B.sniff(bytes.subarray(0, 128)), "application/x-oros-plants");
  const r = await B.read(bytes, { mime: D.mime });
  assert.equal(r.content.kind, "oros-plants-package");
  assert.deepEqual(r.content.data.plants, s.plants);
  assert.ok(!JSON.stringify(r.content).includes("pnKey"));
  // previews
  const names = o.preview.map((p) => p.name).sort();
  assert.deepEqual(names, ["history.csv", "plants.csv", "plants.md"]);
  const csv = o.preview.find((p) => p.name === "plants.csv").data;
  assert.equal(csv.split("\r\n")[0], "Name,Species,Scientific name,Room,Where,Water every (days),In winter every (days)," +
    "Fertilize every (days),Mist every (days),Repot every (days),Last watered,Notes");
  assert.ok(csv.includes("Monty,Monstera,Monstera deliciosa,Kitchen,Indoor,7,14,,7,," + D2 + ",By the window\r\n"));
  assert.ok(csv.includes("Basil,Basil,,Kitchen,Outdoor,2,,,,,,\r\n"));        // a skipped watering is not "last watered"
  const hist = o.preview.find((p) => p.name === "history.csv").data;
  assert.equal(hist, "Date,Plant,Task,Skipped\r\n" + D1 + ",Monty,Water,no\r\n" + D2 + ",Monty,Water,no\r\n" + D2 + ",Basil,Water,yes\r\n");
  const md = o.preview.find((p) => p.name === "plants.md").data;
  assert.match(md, /^# Plants\n/);
  assert.match(md, /## Monty\n\nMonstera · Monstera deliciosa · Kitchen · Indoor\n/);
  const el = K.pack(D, s, { lang: "el", now: NOW }).preview.find((p) => p.name === "plants.csv").data;
  assert.match(el, /^Όνομα,Είδος,/);
  assert.ok(el.includes("Monty,Μονστέρα,"));
  // into a device with other data
  const other = C.merge({ plants: [plant("plantbbb01", { name: "Fern" })],
                          log: [{ id: "logbbb0001", p: "plantbbb01", k: "water", d: D2, s: 0, m: NOW - 5000 }] }, null, NOW);
  const res = K.open(D, other, r.content, { now: NOW });
  assert.deepEqual(res.report, { added: 5, skipped: 0, updated: 0 });
  assert.deepEqual(res.addedIds.slice().sort(), ["logaaa0001", "logaaa0002", "logaaa0003", "plantaaa01", "plantaaa02"]);
  assert.deepEqual(res.next.plants.map((p) => p.id), ["plantaaa01", "plantaaa02", "plantbbb01"]);
  assert.equal(res.next.log.length, 4);
  assert.deepEqual(res.next, C.merge(res.next, res.next, NOW));      // canonical, as the slice wants
  // and again: nothing
  const again = K.open(D, res.next, r.content, { now: NOW });
  assert.equal(again.report.added, 0);
  assert.equal(again.report.skipped, 5);
  assert.deepEqual(again.next, res.next);
  // an empty slice gives no previews
  assert.deepEqual(K.pack(D, C.merge(null, null, NOW), { now: NOW }).preview, []);
});

test("plants: a clash keeps the local plant; deleted stays deleted; new history of a known plant is added; update takes newer", () => {
  const mine = slice();
  const theirs = clone(slice());
  theirs.plants[0].name = "Renamed"; theirs.plants[0].m = NOW - 1;           // the same plant, changed later
  theirs.plants.push(plant("plantgone1", { name: "Back?", m: NOW - 1 }));    // deleted here, live there
  theirs.log.push({ id: "logccc0001", p: "plantaaa01", k: "fert", d: D2, s: 0, m: NOW - 1 });
  const c = K.pack(D, theirs, { now: NOW }).content;
  const res = K.open(D, mine, c, { now: NOW });
  assert.deepEqual(res.addedIds, ["logccc0001"]);
  assert.deepEqual(res.report, { added: 1, skipped: 6, updated: 0 });
  assert.equal(res.next.plants.find((p) => p.id === "plantaaa01").name, "Monty");
  assert.ok(!res.next.plants.some((p) => p.id === "plantgone1"));
  assert.ok(res.next.tombs.plantgone1);
  assert.ok(res.next.log.some((x) => x.id === "logccc0001"));
  // "Update with newer versions": the plant takes the file's; the tombstone stays
  const upd = K.open(D, mine, c, { update: true, now: NOW });
  assert.deepEqual(upd.updatedIds, ["plantaaa01"]);
  assert.equal(upd.next.plants.find((p) => p.id === "plantaaa01").name, "Renamed");
  assert.ok(!upd.next.plants.some((p) => p.id === "plantgone1"));
  // an older copy never wins, even with update
  const old = clone(slice()); old.plants[0].name = "Old"; old.plants[0].m = NOW - 99999;
  const u2 = K.open(D, mine, K.pack(D, old, { now: NOW }).content, { update: true, now: NOW });
  assert.equal(u2.next.plants.find((p) => p.id === "plantaaa01").name, "Monty");
  assert.equal(P.kindOf("plantaaa01", res.next), "plant");
  assert.equal(P.kindOf("logccc0001", res.next), "log");
  assert.equal(P.kindOf("nope", res.next), "");
});

function clone(x) { return JSON.parse(JSON.stringify(x)); }

test("plants: hostile content is cut down; stamps are clamped; wrong kinds refused", () => {
  const evil = {
    kind: "oros-plants-package", ver: 1,
    data: {
      ver: 1, prefs: { remind: 3, pnKey: "x" }, tombs: { plantokay1: 1, "BAD ID": 1 },
      plants: [
        plant("plantokay2", { m: NOW * 2, name: "  <b>Ok</b>\u0000\n", onclick: "x", sp: "nope", em: "🌿🌿🌿🌿🌿🌿", notes: "x".repeat(900) }),
        plant("BAD ID"), plant("short"), plant("__proto__"),
        plant("plantnoname", { name: "  " }),
        plant("plantwater0", { w: 0 }), plant("plantwater9", { w: 999 }),
        plant("plantbadst1", { st: "2026-02-30" }), plant("plantfrac01", { m: 1.5 }),
        plant("plantokay1", { m: 3 }),                         // a file's tombstones are ignored
        plant("plantokay2", { name: "dupe" }),
        "junk", null, 7
      ],
      log: [
        { id: "logokay001", p: "plantokay2", k: "water", d: D2, s: 7, m: 5, x: 1 },
        { id: "logorphan1", p: "plantother", k: "water", d: D2, s: 0, m: 5 },      // its plant is not in the file
        { id: "logbadkind", p: "plantokay2", k: "burn", d: D2, s: 0, m: 5 },
        { id: "logbadday1", p: "plantokay2", k: "water", d: "yesterday", s: 0, m: 5 }
      ]
    }
  };
  const res = K.open(D, C.merge(null, null, NOW), evil, { now: NOW });
  assert.deepEqual(res.addedIds.slice().sort(), ["logokay001", "plantokay1", "plantokay2"]);
  const p = res.next.plants.find((x) => x.id === "plantokay2");
  assert.equal(res.next.plants.length, 2);
  assert.equal(p.name, "<b>Ok</b>");                  // plain text; the app renders with textContent
  assert.equal(p.sp, "");
  assert.equal(p.onclick, undefined);
  assert.equal(p.em.length <= C.EM_LEN, true);
  assert.equal(p.notes.length, C.NOTES_LEN);
  assert.equal(p.m, NOW + K.FUTURE);
  assert.deepEqual(res.next.log, [{ id: "logokay001", p: "plantokay2", k: "water", d: D2, s: 0, m: 5 }]);
  assert.deepEqual(res.next.tombs, {});                // a file never brings tombstones
  assert.equal(res.next.prefs, undefined);
  assert.equal(D.norm("x"), null);
  assert.equal(D.norm([1, 2]), null);
  assert.deepEqual(D.norm({}), { ver: 1, plants: [], log: [] });
  assert.throws(() => K.open(D, slice(), { kind: "oros-todo-package", ver: 1, data: {} }), /notpackage/);
  assert.throws(() => K.open(D, slice(), { kind: "oros-plants-package", ver: 9, data: {} }), /newer/);
  // caps
  const many = { plants: [] };
  for (let i = 0; i < P.LIM.plants + 5; i++) many.plants.push(plant("plant" + String(i).padStart(6, "0")));
  assert.equal(D.norm(many).plants.length, P.LIM.plants);
  // CSV formula guard
  assert.equal(P.csvCell("=HYPERLINK(1)"), "\"'=HYPERLINK(1)\"");
  assert.equal(P.csvCell("@x"), "\"'@x\"");
  assert.equal(P.csvCell("a,b"), "\"a,b\"");
  const f = clone(slice()); f.plants[0].name = "=cmd|x"; f.plants[0].notes = "+1";
  const csv = K.pack(D, f, { now: NOW }).preview.find((x) => x.name === "plants.csv").data;
  assert.ok(csv.includes("\"'=cmd|x\""));
  assert.ok(csv.includes("\"'+1\""));
});

test("plants: wiring (scripts, buttons, Open with, Undo, help, file types)", () => {
  const html = read("plants/index.html");
  ["core.js?v=", "../bundle.js?v=2.52.00", "../recordpkg.js?v=2.52.00", "package.js?v=2.52.00", "plants.js?v=2.52.00"].forEach((s) =>
    assert.ok(html.includes('src="' + s), s));
  assert.ok(html.indexOf('src="core.js') < html.indexOf('src="package.js'));
  assert.ok(html.indexOf("recordpkg.js") < html.indexOf('src="plants.js'));
  const js = read("plants/plants.js");
  assert.match(js, /RP\.ui\(PPK\.DESC,/);
  assert.match(js, /if \(tg && tg\.openFile\) \{ if \(recFile\) recFile\.openTarget\(tg\.openFile\); return; \}/);
  ["openFile", "__orosTakeFile(", "window.__orosOpenAt =", '__orosTakeTarget("plants")', "deleteIds:"].forEach((s) => assert.ok(js.includes(s), s));
  assert.equal(js.split("window.__orosOpenAt =").length, 2);
  ["pc-osave", "pc-oopen", "pc-ofolder"].forEach((id) => assert.ok(js.includes('"' + id + '"'), id));
  assert.ok(js.includes('"set.osave": "orOS file (.orosplants)"'));
  assert.ok(js.includes('"set.osave": "Αρχείο orOS (.orosplants)"'));
  assert.ok(js.includes('"set.oopen": "Άνοιγμα αρχείου orOS…"'));
  assert.ok(js.includes('"set.ofolder": "Αποσυμπιεσμένος φάκελος orOS…"'));
  for (const f of ["plants/help.en.txt", "plants/help.el.txt"]) assert.ok(read(f).includes(".orosplants"), f);
  assert.deepEqual(F.appsFor(".orosplants"), ["plants"]);
  assert.deepEqual(B.TYPES[".orosplants"], { app: "plants", mime: "application/x-oros-plants" });
});
