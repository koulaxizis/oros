// The .oroscycle file (Cycle, phase 4b record apps): every period,
// logged day, symptom and medication through the shared kit
// (recordpkg.js) and bundle.js; opening adds only what is missing,
// with its ids; a day already here (its id is the date) keeps the
// local values. No device settings in the file. Plus the app wiring
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
const P = require(path.join(ROOT, "cycle/package.js"));
const F = require(path.join(ROOT, "fileopen.js"));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const D = P.DESC;
const NOW = 1790000000000;            // 2026-09-21, before the real clock (norm clamps with Date.now())
const clone = (x) => JSON.parse(JSON.stringify(x));
const mid = (y, m, d) => new Date(y, m - 1, d).getTime();

function day(id, extra) {
  const [y, m, d] = id.slice(2).split("-").map(Number);
  return Object.assign({ id, day: mid(y, m, d), mtime: NOW - 500, sym: [], meds: [], note: "",
    fm: { sym: NOW - 500, meds: 0, note: 0 }, sb: 0, ss: {} }, extra || {});
}
function slice() {
  return {
    ver: 1, sm: NOW - 10, om: NOW - 20, pm: NOW - 30,
    periods: [
      { id: "p2", start: mid(2026, 9, 28), end: null, flow: 3, mtime: NOW - 400 },
      { id: "p1", start: mid(2026, 9, 1), end: mid(2026, 9, 5), flow: 2, mtime: NOW - 900 }
    ],
    days: [
      day("d-2026-09-01", { sym: ["seed-sym-0", "my-sym"], ss: { "seed-sym-0": NOW - 500, "my-sym": NOW - 500 },
        meds: [{ id: "i1", med: "seed-med-1", at: NOW - 500 }], fm: { sym: NOW - 500, meds: NOW - 500, note: 0, fl: NOW - 500 }, fl: 3 }),
      day("d-2026-09-14", { bbt: 3672, cm: 4, note: "=HYPERLINK(\"x\")\nline 2",
        fm: { sym: 0, meds: 0, note: NOW - 500, bbt: NOW - 500, cm: NOW - 500 } })
    ],
    cols: {
      sym: [{ id: "seed-sym-0", label: "Cramps", bi: { en: "Cramps", el: "Σπασμοί" }, mtime: 0, pos: 0 },
            { id: "my-sym", label: "Dizzy", mtime: NOW - 800, pos: 1 }],
      med: [{ id: "seed-med-1", label: "Ibuprofen", bi: { en: "Ibuprofen", el: "Ιβουπροφαίνη" }, mtime: 0, pos: 0 }]
    },
    prefs: { remind: false, bbt: true },
    deleted: { "p-gone": NOW - 100, "d-2026-08-01": NOW - 100 }
  };
}
function fresh() {
  return { ver: 1, sm: 0, om: 0, periods: [], days: [], deleted: {},
    cols: { sym: [{ id: "seed-sym-0", label: "Cramps", bi: { en: "Cramps", el: "Σπασμοί" }, mtime: 0, pos: 0 }],
            med: [{ id: "seed-med-1", label: "Ibuprofen", bi: { en: "Ibuprofen", el: "Ιβουπροφαίνη" }, mtime: 0, pos: 0 }] },
    prefs: { remind: true } };
}

test("cycle: round trip through bundle.js; the file has no tombstones or device settings", async () => {
  const o = K.pack(D, slice(), { title: "Cycle", lang: "en", now: NOW });
  assert.equal(o.mime, "application/x-oros-cycle");
  assert.equal(o.generator, "orOS Cycle");
  assert.equal(o.content.kind, "oros-cycle-package");
  assert.deepEqual(Object.keys(o.content.data).sort(), ["cols", "days", "periods", "ver"]);
  const json = JSON.stringify(o.content);
  ["prefs", "remind", "deleted", "p-gone", "\"pm\"", "\"sm\"", "\"om\""].forEach((k) => assert.ok(!json.includes(k), k));
  const bytes = await B.write(o);
  assert.equal(B.sniff(bytes.subarray(0, 128)), "application/x-oros-cycle");
  const r = await B.read(bytes, { mime: D.mime });
  assert.equal(r.content.kind, "oros-cycle-package");
  assert.deepEqual(r.content.data.periods, slice().periods);
  assert.deepEqual(r.content.data.days, slice().days);
  // previews: Markdown, periods.csv, days.csv (formula guard)
  const pv = (n) => o.preview.find((p) => p.name === n).data;
  assert.match(pv("cycle.md"), /^# Cycle\n\n## Periods\n\n- 2026-09-01 – 2026-09-05 \(normal\)\n- 2026-09-28 – ongoing \(heavy\)/);
  assert.match(pv("cycle.md"), /- \*\*2026-09-01\*\* · Flow: heavy · Symptoms: Cramps, Dizzy · Pain relief: Ibuprofen/);
  assert.equal(pv("periods.csv"), "start,end,flow\r\n2026-09-01,2026-09-05,normal\r\n2026-09-28,,heavy\r\n");
  assert.match(pv("days.csv"), /^date,flow,temperature_c,mucus,symptoms,pain_relief,note\r\n2026-09-01,heavy,,,Cramps; Dizzy,Ibuprofen,\r\n2026-09-14,,36.72,egg white,,,"'=HYPERLINK\(""x""\)\nline 2"\r\n$/);
  const el = K.pack(D, slice(), { lang: "el", now: NOW }).preview.find((p) => p.name === "cycle.md").data;
  assert.match(el, /^# Κύκλος/);
  assert.match(el, /Συμπτώματα: Σπασμοί, Dizzy/);
  // into a device with only its seeds
  const res = K.open(D, fresh(), r.content, { now: NOW });
  assert.deepEqual(res.report, { added: 5, skipped: 2, updated: 0 });   // p2 p1, two days, my-sym | the two seeds
  assert.deepEqual(res.addedIds.slice().sort(), ["d-2026-09-01", "d-2026-09-14", "my-sym", "p1", "p2"]);
  assert.deepEqual(res.next.prefs, { remind: true });                   // this device's settings stay
  assert.deepEqual(res.next.deleted, {});
  assert.deepEqual(res.next.days, slice().days);
  // and again: nothing
  const again = K.open(D, res.next, r.content, { now: NOW });
  assert.equal(again.report.added, 0);
  assert.deepEqual(again.next, res.next);
});

test("cycle: a day logged here keeps the local values; deleted stays deleted; update takes newer", () => {
  const theirs = slice();
  theirs.days[1].note = "theirs"; theirs.days[1].mtime = NOW - 1; theirs.days[1].fm.note = NOW - 1;
  theirs.days.push(day("d-2026-08-01", { note: "deleted here", mtime: NOW - 50, fm: { sym: 0, meds: 0, note: NOW - 50 } }));
  theirs.periods.push({ id: "p-gone", start: mid(2026, 7, 1), end: null, flow: 1, mtime: NOW - 50 });
  theirs.periods.push({ id: "p0", start: mid(2026, 8, 3), end: mid(2026, 8, 7), flow: 1, mtime: NOW - 50 });
  const mine = slice();
  const c = K.pack(D, theirs, { now: NOW }).content;
  const res = K.open(D, mine, c, { now: NOW });
  assert.deepEqual(res.addedIds, ["p0"]);
  assert.equal(res.next.days.find((d) => d.id === "d-2026-09-14").note, "=HYPERLINK(\"x\")\nline 2");
  assert.ok(!res.next.days.some((d) => d.id === "d-2026-08-01"));
  assert.ok(!res.next.periods.some((p) => p.id === "p-gone"));
  assert.deepEqual(res.next.prefs, mine.prefs);
  assert.deepEqual(res.next.deleted, mine.deleted);
  const upd = K.open(D, mine, c, { update: true, now: NOW });
  assert.deepEqual(upd.updatedIds, ["d-2026-09-14"]);
  assert.equal(upd.next.days.find((d) => d.id === "d-2026-09-14").note, "theirs");
  assert.equal(P.kindOf("p0", res.next), "period");
  assert.equal(P.kindOf("d-2026-09-01", res.next), "day");
  assert.equal(P.kindOf("my-sym", res.next), "sym");
  assert.equal(P.kindOf("seed-med-1", res.next), "med");
  assert.equal(P.kindOf("nope", res.next), "");
});

test("cycle: settle keeps the local symptom of the same name and fixes the added days", () => {
  const theirs = slice();
  theirs.cols.sym[1] = { id: "their-dizzy", label: "  dizzy ", mtime: NOW - 1, pos: 1 };
  theirs.days = [day("d-2026-10-02", { sym: ["their-dizzy"], ss: { "their-dizzy": NOW - 500 } })];
  theirs.periods = [];
  const mine = slice();
  const res = K.open(D, mine, K.pack(D, theirs, { now: NOW }).content, { now: NOW });
  const ids = res.addedIds.slice();
  assert.deepEqual(ids.sort(), ["d-2026-10-02", "their-dizzy"]);
  const next = P.settle(mine, clone(res.next), res.addedIds);
  assert.deepEqual(res.addedIds, ["d-2026-10-02"]);                    // Undo list without the dropped one
  assert.deepEqual(next.cols.sym.map((v) => v.id), ["seed-sym-0", "my-sym"]);
  const d = next.days.find((x) => x.id === "d-2026-10-02");
  assert.deepEqual(d.sym, ["my-sym"]);
  assert.deepEqual(d.ss, { "my-sym": NOW - 500 });
  assert.deepEqual(next.days.find((x) => x.id === "d-2026-09-01").sym, ["seed-sym-0", "my-sym"]);  // local day untouched
});

test("cycle: the normaliser cuts hostile content down", () => {
  const big = "x".repeat(5000);
  const n = D.norm({
    periods: [{ id: "ok", start: mid(2026, 1, 1), end: mid(2025, 1, 1), flow: 9, mtime: "x", evil: 1 },
              { id: "bad id", start: 1 }, { id: "inf", start: Infinity }, "junk", { id: "__proto__", start: 1 }],
    days: [
      { id: "d-2026-02-30", note: "no such date" },
      { id: "../etc", note: "x" },
      { id: "d-2026-03-03", day: 1, mtime: NOW, sym: ["a", "a", 5, "<b>"], meds: [{ id: "m", med: "x", at: 9e15 }, { id: "n" }, null],
        note: big + "\u0000", fl: 7, bbt: 99999, cm: 2, fm: { sym: 1, onclick: 2 }, ss: { a: 1, "bad key": 2 }, sb: 9e15,
        onload: "x" }
    ],
    cols: { sym: [{ id: "s", label: "a\u0000b" + big, bi: { en: 5, el: "ε" }, mtime: 1, pos: 2, color: "x" }, { id: "" }], med: "nope" },
    prefs: { remind: true }, sm: 5
  });
  assert.deepEqual(n.periods, [{ id: "ok", start: mid(2026, 1, 1), end: null, flow: 2, mtime: 0 }]);
  assert.equal(n.days.length, 1);
  const d = n.days[0];
  assert.equal(d.day, mid(2026, 3, 3));                                 // the date comes from the id
  assert.deepEqual(d.sym, ["a"]);
  assert.equal(d.meds.length, 1);
  assert.ok(d.meds[0].at < Date.now() + 6 * 60 * 1000);
  assert.ok(d.sb < Date.now() + 6 * 60 * 1000);
  assert.equal(d.note.length, 2000);
  assert.deepEqual([d.fl, d.bbt, d.cm, d.onload], [undefined, undefined, 2, undefined]);
  assert.deepEqual(d.fm, { sym: 1 });
  assert.deepEqual(d.ss, { a: 1 });
  assert.equal(n.cols.sym.length, 1);
  assert.equal(n.cols.sym[0].label.length, 40);
  assert.equal(n.cols.sym[0].label.slice(0, 3), "a b");
  assert.deepEqual(n.cols.sym[0].bi, { en: "", el: "ε" });
  assert.equal(n.cols.sym[0].color, undefined);
  assert.deepEqual(n.cols.med, []);
  assert.equal(n.prefs, undefined);
  assert.equal(D.norm("x"), null);
  // stamps from the future are clamped by the kit (mtime, fm, ss)
  const c = { kind: "oros-cycle-package", ver: 1, data: { periods: [], cols: {},
    days: [day("d-2026-10-10", { mtime: NOW * 2, fm: { sym: NOW * 2, meds: 0, note: 0 }, ss: { x: NOW * 2 }, sym: ["x"] })] } };
  const res = K.open(D, fresh(), c, { now: NOW });
  const dd = res.next.days[0];
  assert.deepEqual([dd.mtime, dd.fm.sym, dd.ss.x], [NOW + K.FUTURE, NOW + K.FUTURE, NOW + K.FUTURE]);
  assert.throws(() => K.open(D, fresh(), { kind: "oros-todo-package", ver: 1, data: {} }), /notpackage/);
});

test("cycle: wiring (scripts, buttons, Open with, strings, help, file types)", () => {
  const html = read("cycle/index.html");
  ["../bundle.js?v=2.49.00", "../recordpkg.js?v=2.49.00", "package.js?v=2.49.00", "cycle.js?v=2.49.00"].forEach((s) =>
    assert.ok(html.includes('src="' + s + '"'), s));
  assert.ok(html.indexOf("package.js") < html.indexOf('src="cycle.js'));
  const js = read("cycle/cycle.js");
  assert.match(js, /RP\.ui\(CPK\.DESC,/);
  assert.match(js, /if \(t && t\.openFile\) \{ if \(recFile\) recFile\.openTarget\(t\.openFile\); return; \}/);
  assert.match(js, /__orosTakeFile\(/);
  assert.match(js, /window\.__orosOpenAt = openSearchTarget;/);
  assert.equal((js.match(/window\.__orosOpenAt\s*=/g) || []).length, 1);
  ["pkg-save", "pkg-open", "pkg-folder"].forEach((id) => assert.ok(js.includes('"' + id + '"'), id));
  assert.match(js, /CPK\.settle\(state,/);
  assert.match(js, /mergeCycleStates\(state, n\)/);
  assert.match(js, /"pkg\.save":\s+"orOS file \(\.oroscycle\)"/);
  assert.match(js, /"pkg\.save":\s+"Αρχείο orOS \(\.oroscycle\)"/);
  assert.match(js, /"pkg\.folder":\s+"Αποσυμπιεσμένος φάκελος orOS…"/);
  for (const f of ["cycle/help.en.txt", "cycle/help.el.txt"]) assert.ok(read(f).includes(".oroscycle"), f);
  assert.deepEqual(F.appsFor(".oroscycle"), ["cycle"]);
  assert.deepEqual(B.TYPES[".oroscycle"], { app: "cycle", mime: "application/x-oros-cycle" });
});
