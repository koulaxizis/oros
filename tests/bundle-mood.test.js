// The .orosmood file (Mood): every entry, own value, feeling /
// activity definition and goal through the shared kit (recordpkg.js)
// and bundle.js; opening adds only what is missing, with its ids. Plus
// the app wiring (Save, Open, unzipped folder, "Open with").
// Run: node --test tests/*.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const B = require(path.join(ROOT, "bundle.js"));
const K = require(path.join(ROOT, "recordpkg.js"));
const P = require(path.join(ROOT, "mood/package.js"));
const F = require(path.join(ROOT, "fileopen.js"));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const D = P.DESC;
const NOW = 1800000000000;
const clone = (x) => JSON.parse(JSON.stringify(x));

function habits(over) {
  const o = {};
  P.HABITS.forEach((f) => { o[f] = null; });
  return Object.assign(o, over || {});
}
function slice() {
  return {
    ver: 3, trigSeeded: true, sm: NOW - 10, om: NOW - 20,
    entries: [
      Object.assign({ id: "e2", ts: NOW - 3600000, mtime: NOW - 500, emotions: [{ k: "c-joyx1", i: 4 }],
        loc: "loc-gym", person: null, trig: null, note: "=HYPERLINK(\"x\")", trigger: "", acts: ["c-runx1"] },
        habits({ sleep: "no" })),
      Object.assign({ id: "e1", ts: NOW - 90000000, mtime: NOW - 900, emotions: [{ k: "happy", i: 5 }, { k: "calm", i: 3 }],
        loc: "seed-loc-0", person: "seed-per-1", trig: null, note: "good day\nreally", trigger: "",
        fm: Object.assign(habits(), { emotions: NOW - 900, loc: 0, person: 0, trig: 0, note: NOW - 900 }) },
        habits({ water: "yes" }))
    ],
    cols: {
      loc: [{ id: "seed-loc-0", label: "At home", bi: { en: "At home", el: "Στο σπίτι" }, mtime: 0, pos: 0 },
            { id: "loc-gym", label: "Gym", mtime: NOW - 800, pos: 1 }],
      trig: [], person: [{ id: "seed-per-1", label: "Partner", bi: { en: "Partner", el: "Σύντροφος" }, mtime: 0, pos: 0 }]
    },
    deleted: { "e-gone": NOW - 100, "seed-per-0": 5 },
    vocab: { emo: [{ id: "c-joyx1", mtime: NOW - 700, lab: "Joy", ic: "✨", col: "#87cf3e" }],
             act: [{ id: "c-runx1", mtime: NOW - 700, lab: "Run" }], ao: { ids: ["c-runx1", "water"], m: NOW - 700 }, rs: NOW - 99999999 },
    goals: [{ id: "g1", act: "c-runx1", n: 3, per: "w", mtime: NOW - 600 }, { id: "g0", act: "water", n: 2, per: "w", mtime: NOW - 50, x: 1 }]
  };
}
// Fix the fm habit stamps to numbers (habits() gave null)
function fixFm(s) { s.entries.forEach((e) => { if (e.fm) P.HABITS.forEach((f) => { e.fm[f] = 0; }); }); return s; }

test("mood: round trip through bundle.js; the file has no tombstones or device stamps", async () => {
  const src = fixFm(slice());
  const o = K.pack(D, src, { title: "Mood", lang: "en", now: NOW });
  assert.equal(o.mime, "application/x-oros-mood");
  assert.equal(o.generator, "orOS Mood");
  assert.deepEqual(Object.keys(o.content.data).sort(), ["cols", "entries", "goals", "ver", "vocab"]);
  assert.deepEqual(o.content.data.goals.map((g) => g.id), ["g1"]);           // the deleted goal stays home
  assert.equal(o.content.data.vocab.rs, undefined);
  const bytes = await B.write(o);
  assert.equal(B.sniff(bytes.subarray(0, 128)), "application/x-oros-mood");
  const r = await B.read(bytes, { mime: D.mime });
  assert.equal(r.content.kind, "oros-mood-package");
  assert.deepEqual(r.content.data.entries, src.entries);
  // previews: Markdown by day, CSV with a formula guard
  const md = o.preview.find((p) => p.name === "mood.md").data;
  assert.match(md, /^# Mood\n\n## \d{4}-\d\d-\d\d\n\n- \d\d:\d\d Joy 4\/5 \(Gym\)\n  - sleep: no; Run\n  - =HYPERLINK/);
  assert.match(md, /Happy 5\/5; Calm 3\/5 \(At home, Partner\)\n  - water: yes\n  - good day really/);
  const csv = o.preview.find((p) => p.name === "mood.csv").data;
  assert.match(csv, /^date,time,feelings,location,with,trigger,habits,activities,note\r\n/);
  assert.match(csv, /,Joy 4\/5,Gym,,,sleep: no,Run,"'=HYPERLINK\(""x""\)"\r\n/);
  const elmd = K.pack(D, src, { lang: "el", now: NOW }).preview.find((p) => p.name === "mood.md").data;
  assert.match(elmd, /^# Διάθεση/);
  assert.match(elmd, /Χαρούμενος 5\/5; Ήρεμος 3\/5 \(Στο σπίτι, Σύντροφος\)/);
  // into a fresh device: only the seeds
  const fresh = { ver: 3, trigSeeded: true, sm: 0, om: 0, entries: [], deleted: {},
    cols: { loc: [{ id: "seed-loc-0", label: "At home", mtime: 0, pos: 0 }], trig: [], person: [{ id: "seed-per-1", label: "Partner", mtime: 0, pos: 0 }] } };
  const res = K.open(D, fresh, r.content, { now: NOW });
  assert.deepEqual(res.report, { added: 6, skipped: 2, updated: 0 });       // e2 e1 loc-gym joy run g1 | 2 seeds kept
  assert.deepEqual(res.addedIds.slice().sort(), ["c-joyx1", "c-runx1", "e1", "e2", "g1", "loc-gym"]);
  assert.deepEqual(res.next.entries, src.entries);
  assert.deepEqual(res.next.deleted, {});
  assert.equal(res.next.vocab.ao, undefined);                               // orders stay the device's
  const by = P.addedByColl(fresh, res.next, res.addedIds);
  assert.deepEqual(by, { entries: ["e2", "e1"], loc: ["loc-gym"], trig: [], person: [], emo: ["c-joyx1"], act: ["c-runx1"], goals: ["g1"] });
  // and again: nothing
  const again = K.open(D, res.next, r.content, { now: NOW });
  assert.equal(again.report.added, 0);
  assert.deepEqual(again.next, res.next);
});

test("mood: a clash keeps the local record, a deletion here stays, update takes newer", () => {
  const theirs = fixFm(slice());
  theirs.entries[1].note = "changed there"; theirs.entries[1].mtime = NOW - 1;
  theirs.entries.push(Object.assign({ id: "e-gone", ts: NOW - 5, mtime: NOW - 2, emotions: [{ k: "sad", i: 2 }], note: "", trigger: "" }, habits()));
  theirs.entries.push(Object.assign({ id: "e3", ts: NOW - 4, mtime: NOW + 999999999, emotions: [{ k: "sad", i: 2 }], note: "", trigger: "",
    fm: { emotions: NOW + 999999999 } }, habits()));
  theirs.cols.person.push({ id: "seed-per-0", label: "Alone", mtime: 0, pos: 1 });   // deleted here
  const mine = fixFm(slice());
  const c = K.pack(D, theirs, { now: NOW }).content;
  const res = K.open(D, mine, c, { now: NOW });
  assert.deepEqual(res.addedIds, ["e3"]);
  assert.equal(res.next.entries.find((e) => e.id === "e1").note, "good day\nreally");
  assert.ok(!res.next.entries.some((e) => e.id === "e-gone"));
  assert.ok(!res.next.cols.person.some((v) => v.id === "seed-per-0"));
  const e3 = res.next.entries.find((e) => e.id === "e3");
  assert.equal(e3.mtime, NOW + K.FUTURE);                                    // clamped
  assert.equal(e3.fm.emotions, NOW + K.FUTURE);
  const upd = K.open(D, mine, c, { update: true, now: NOW });
  assert.deepEqual(upd.updatedIds, ["e1"]);
  assert.equal(upd.next.entries.find((e) => e.id === "e1").note, "changed there");
  assert.deepEqual(upd.next.deleted, mine.deleted);
  assert.equal(upd.next.goals.find((g) => g.id === "g0").x, 1);              // the soft-deleted goal stays deleted
});

test("mood: an added value whose name is here folds into the local one", () => {
  const mine = fixFm(slice());
  const theirs = { ver: 3, entries: [Object.assign({ id: "n1", ts: NOW - 7, mtime: NOW - 7, emotions: [{ k: "calm", i: 2 }],
    loc: "loc-gym-2", person: null, trig: "t-x", note: "", trigger: "" }, habits())],
    cols: { loc: [{ id: "loc-gym-2", label: " gym ", mtime: NOW - 3, pos: 0 }], trig: [{ id: "t-x", label: "Exam", mtime: NOW - 3, pos: 0 }], person: [] } };
  const res = K.open(D, mine, { kind: "oros-mood-package", ver: 1, data: theirs }, { now: NOW });
  assert.deepEqual(res.addedIds.slice().sort(), ["loc-gym-2", "n1", "t-x"]);
  const f = P.foldCols(mine, res.next, res.addedIds);
  assert.deepEqual(f.folded, { "loc-gym-2": "loc-gym" });
  assert.deepEqual(res.next.cols.loc.map((v) => v.id), ["seed-loc-0", "loc-gym"]);
  assert.deepEqual(res.next.cols.trig.map((v) => v.id), ["t-x"]);
  const n1 = res.next.entries.find((e) => e.id === "n1");
  assert.equal(n1.loc, "loc-gym");
  assert.equal(n1.trig, "t-x");
  assert.equal(mine.cols.loc.length, 2);                                     // prev untouched
  // the device remembers the fold: the same file again finds nothing new
  const here = Object.assign(clone(res.next), { __folded: f.folded });
  const again = K.open(D, here, { kind: "oros-mood-package", ver: 1, data: theirs }, { now: NOW });
  assert.equal(again.report.added, 0);
  assert.equal(K.pack(D, here, { now: NOW }).content.data.__folded, undefined);   // never saved into a file
});

test("mood: the normaliser keeps known fields only, typed and capped", () => {
  const n = D.norm({
    entries: [
      { id: "a", ts: 5, emotions: [{ k: "happy", i: 9 }, { k: "happy", i: 1 }, { k: "<b>", i: 2 }, "x"], loc: "../x", person: 7,
        water: "maybe", sleep: "no", note: { x: 1 }, onclick: "x", acts: ["c-zzzz1", "bad", "c-zzzz1"], fm: { note: 3, evil: 4 } },
      { id: "no ts" }, { id: "bad id with spaces", ts: 1 }, null, { id: "__proto__", ts: 1 }],
    cols: { loc: [{ id: "L", label: "a\u0000b".repeat(50), bi: { en: "x" }, x: "<script>" }, { id: "L", label: "dup" }], trig: "junk" },
    vocab: { emo: [{ id: "c-abcd1", mtime: 4, ic: "<img>", col: "red", lab: "Y" }, { id: "../", mtime: 1 }], rs: NOW, eo: { ids: ["happy", 5], m: 2 } },
    goals: [{ id: "g", act: "water", n: 99, per: "d" }, { id: "g2", act: "<x>" }],
    deleted: { a: 1 }
  });
  const e = n.entries[0];
  assert.equal(n.entries.length, 1);
  assert.deepEqual(e.emotions, [{ k: "happy", i: 5 }]);
  assert.deepEqual([e.loc, e.person, e.water, e.sleep, e.note, e.onclick, e.mtime], [null, null, null, "no", "", undefined, 5]);
  assert.deepEqual(e.acts, ["c-zzzz1"]);
  assert.deepEqual(e.fm, { note: 3 });
  assert.equal(n.cols.loc.length, 1);
  assert.equal(n.cols.loc[0].label.length, 80);
  assert.ok(!/\u0000/.test(n.cols.loc[0].label));
  assert.equal(n.cols.loc[0].bi, undefined);
  assert.equal(n.cols.loc[0].x, undefined);
  assert.deepEqual(n.cols.trig, []);
  assert.deepEqual(n.vocab.emo, [{ id: "c-abcd1", mtime: 4, lab: "Y" }]);
  assert.equal(n.vocab.rs, undefined);
  assert.deepEqual(n.vocab.eo, { ids: ["happy"], m: 2 });
  assert.deepEqual(n.goals, [{ id: "g", act: "water", n: 7, per: "w", mtime: 0 }]);
  assert.equal(D.norm("x"), null);
  // the file's tombstones never reach the device
  const res = K.open(D, { ver: 3, entries: [], cols: { loc: [], trig: [], person: [] }, deleted: {} },
    { kind: "oros-mood-package", ver: 1, data: { entries: [{ id: "q", ts: 1, mtime: 1 }], deleted: { zz: 1 } } }, { now: NOW });
  assert.deepEqual(res.next.deleted, {});
  assert.deepEqual(res.addedIds, ["q"]);
  assert.throws(() => K.open(D, {}, { kind: "oros-todo-package", ver: 1, data: {} }), /notpackage/);
});

test("mood: the habit list matches mood.js", () => {
  const js = read("mood/mood.js");
  const block = js.slice(js.indexOf("var BUILTIN_HABITS = ["), js.indexOf("];", js.indexOf("var BUILTIN_HABITS = [")));
  const fields = [...block.matchAll(/\{ f: "(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(fields, P.HABITS);
});

test("mood: wiring (scripts, buttons, Open with, help, file types)", () => {
  const html = read("mood/index.html");
  ["../bundle.js?v=", "../recordpkg.js?v=", "package.js?v=", "mood.js?v="].forEach((s) =>
    assert.ok(html.includes('src="' + s), s));
  assert.ok(html.indexOf("vocab.js") < html.indexOf('src="package.js'));
  assert.ok(html.indexOf("recordpkg.js") < html.indexOf('src="mood.js'));
  const js = read("mood/mood.js");
  assert.match(js, /RP\.ui\(MPK\.DESC,/);
  ["oros-save", "oros-open", "oros-folder"].forEach((id) => assert.ok(js.includes('"' + id + '"'), id));
  assert.match(js, /if \(tg && typeof tg === "object" && tg\.openFile\) \{ if \(recFile\) recFile\.openTarget\(tg\.openFile\); return; \}/);
  assert.equal((js.match(/window\.__orosOpenAt\s*=/g) || []).length, 1);
  assert.match(js, /__orosTakeTarget\("mood"\)/);
  assert.match(js, /STRINGS\.en\["oros\.save"\]\s*=\s*"orOS file \(\.orosmood\)"/);
  assert.match(js, /STRINGS\.el\["oros\.save"\]\s*=\s*"Αρχείο orOS \(\.orosmood\)"/);
  for (const f of ["mood/help.en.txt", "mood/help.el.txt"]) assert.ok(read(f).includes(".orosmood"), f);
  assert.deepEqual(F.appsFor(".orosmood"), ["mood"]);
  assert.deepEqual(B.TYPES[".orosmood"], { app: "mood", mime: "application/x-oros-mood" });
});
