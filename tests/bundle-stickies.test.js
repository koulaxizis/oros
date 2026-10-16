// The .orosstickies file (Sticky Notes, a record app): every note on
// the desktop through the shared kit (recordpkg.js) and bundle.js;
// opening adds only what is missing, with its ids. Plus the app wiring
// (Save, Open, unzipped folder, "Open with") and the shell side
// (host.js addFromFile / removeAdded / fileAdded).
// Run: node --test tests/*.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const B = require(path.join(ROOT, "bundle.js"));
const K = require(path.join(ROOT, "recordpkg.js"));
const C = require(path.join(ROOT, "stickies/core.js"));
const P = require(path.join(ROOT, "stickies/package.js"));
const F = require(path.join(ROOT, "fileopen.js"));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const D = P.DESC;
const NOW = 1800000000000;
const clone = (x) => JSON.parse(JSON.stringify(x));
const fm = (t) => ({ text: t, color: t, ring: 0, vanish: 0, faded: 0 });

function slice() {
  return C.merge({
    ver: 1,
    notes: [
      { id: "sn-aaa", text: "Buy milk\n[ ] eggs", color: "pink", ring: { at: NOW + 3600000 }, vanish: null, faded: 0, ct: NOW - 900, fm: Object.assign(fm(NOW - 900), { ring: NOW - 800 }) },
      { id: "sn-bbb", text: "=SUM(A1)", color: "blue", ring: null, vanish: { at: 0, onDone: true }, faded: 0, ct: NOW - 700, fm: Object.assign(fm(NOW - 700), { vanish: NOW - 700 }) },
      { id: "sn-faded", text: "old", color: "yellow", ring: null, vanish: null, faded: NOW - 500, ct: NOW - 2000, fm: Object.assign(fm(NOW - 2000), { faded: NOW - 500 }) }
    ],
    tombs: { "sn-gone": NOW - 100 }
  }, null);
}
// what the app hands the kit (hooks.get)
const local = (s) => P.stamped(s);
// what host.js addFromFile commits
const commitOf = (have, next) => C.merge(have, { notes: next.notes });

test("stickies: round trip through bundle.js; no tombstones, no faded notes, no positions", async () => {
  const o = K.pack(D, local(slice()), { title: "Sticky Notes", lang: "en", now: NOW });
  assert.equal(o.mime, "application/x-oros-stickies");
  assert.equal(o.generator, "orOS Sticky Notes");
  assert.deepEqual(Object.keys(o.content.data).sort(), ["notes", "ver"]);
  assert.deepEqual(o.content.data.notes.map((n) => n.id), ["sn-aaa", "sn-bbb"]);
  assert.equal(o.content.data.notes[0].m, NOW - 800);           // newest field stamp
  assert.ok(!JSON.stringify(o.content).includes("sn-gone"));
  assert.ok(!/"x"|"fold"|"z"/.test(JSON.stringify(o.content.data)));
  const bytes = await B.write(o);
  assert.equal(B.sniff(bytes.subarray(0, 128)), "application/x-oros-stickies");
  const r = await B.read(bytes, { mime: D.mime });
  assert.equal(r.content.kind, "oros-stickies-package");
  // preview: the app's own "Export as text"
  const txt = o.preview.find((p) => p.name === "notes.txt").data;
  assert.equal(txt, C.toText(slice()));
  assert.equal(txt, "=SUM(A1)\n\n—\n\nBuy milk\n[ ] eggs\n");
  // into a device with other notes
  const other = C.merge({ notes: [{ id: "sn-ccc", text: "mine", color: "green", ct: NOW - 5000, fm: fm(NOW - 5000) }],
                          tombs: { "sn-old": NOW - 4000 } }, null);
  const res = K.open(D, local(other), r.content, { now: NOW });
  assert.deepEqual(res.report, { added: 2, skipped: 0, updated: 0 });
  assert.deepEqual(res.addedIds.slice().sort(), ["sn-aaa", "sn-bbb"]);
  const next = commitOf(other, res.next);
  assert.deepEqual(next.notes.map((n) => n.id), ["sn-aaa", "sn-bbb", "sn-ccc"]);
  assert.deepEqual(next.tombs, other.tombs);                     // the local tombs stay
  assert.deepEqual(C.find(next, "sn-aaa"), C.find(slice(), "sn-aaa"));   // the same note, no "m"
  assert.deepEqual(next, C.merge(next, null));                   // canonical
  // and again: nothing
  const again = K.open(D, local(next), r.content, { now: NOW });
  assert.equal(again.report.added, 0);
  assert.equal(again.report.skipped, 2);
  assert.deepEqual(commitOf(next, again.next), next);
  // Undo (host.js removeAdded): Delete's tombstones
  let u = next;
  res.addedIds.forEach((id) => { u = C.remove(u, id, NOW + 10); });
  assert.deepEqual(C.live(u).map((n) => n.id), ["sn-ccc"]);
  assert.ok(u.tombs["sn-aaa"] >= NOW && u.tombs["sn-bbb"] >= NOW);
  // an empty desktop saves no preview
  assert.deepEqual(D.previews(C.empty()), {});
});

test("stickies: a clash keeps the local note; deleted stays deleted; update takes newer", () => {
  const mine = slice();
  const theirs = clone(mine);
  theirs.notes[0].text = "Buy oat milk"; theirs.notes[0].fm.text = NOW - 1;     // changed later there
  theirs.notes.push({ id: "sn-gone", text: "back?", color: "pink", ring: null, vanish: null, faded: 0, ct: NOW - 50, fm: fm(NOW - 50) });
  theirs.notes.push({ id: "sn-new", text: "new", color: "lilac", ring: null, vanish: null, faded: 0, ct: NOW - 10, fm: fm(NOW - 10) });
  // the note faded here is live in the file: kept faded here
  theirs.notes[2].faded = 0; theirs.notes[2].fm.faded = NOW - 400;
  const c = K.pack(D, local(C.merge(theirs, null)), { now: NOW }).content;
  const res = K.open(D, local(mine), c, { now: NOW });
  assert.deepEqual(res.addedIds, ["sn-new"]);
  assert.deepEqual(res.report, { added: 1, skipped: 4, updated: 0 });
  const next = commitOf(mine, res.next);
  assert.equal(C.find(next, "sn-aaa").text, "Buy milk\n[ ] eggs");
  assert.equal(C.find(next, "sn-gone"), null);
  assert.ok(next.tombs["sn-gone"]);
  assert.ok(C.find(next, "sn-faded").faded);
  // "Update with newer versions": the newer copy wins, the tombstone stays
  const upd = K.open(D, local(mine), c, { update: true, now: NOW });
  assert.deepEqual(upd.updatedIds.slice().sort(), ["sn-aaa", "sn-faded"]);
  const n2 = commitOf(mine, upd.next);
  assert.equal(C.find(n2, "sn-aaa").text, "Buy oat milk");
  assert.equal(C.find(n2, "sn-aaa").color, "pink");
  assert.equal(C.find(n2, "sn-gone"), null);
  // a file's copy NOT newer never wins, even with update
  const old = clone(mine); old.notes[0].text = "stale"; old.notes[0].fm.text = NOW - 99999;
  const u2 = K.open(D, local(mine), K.pack(D, local(C.merge(old, null)), { now: NOW }).content, { update: true, now: NOW });
  assert.equal(u2.report.updated, 0);
  assert.equal(C.find(commitOf(mine, u2.next), "sn-aaa").text, "Buy milk\n[ ] eggs");
});

test("stickies: hostile content is cut down; stamps are clamped; wrong kinds refused", () => {
  const long = "x".repeat(5000);
  const evil = {
    kind: "oros-stickies-package", ver: 1,
    data: {
      ver: 1, tombs: { "sn-ccc": NOW }, prefs: { show: false }, pos: { "sn-ok": { x: 0.5, y: 0.5 } },
      notes: [
        { id: "sn-ok", text: long + "\u0000<script>", color: "#f00", ring: { at: "soon" }, vanish: { at: -5, onDone: "yes" },
          faded: 0, ct: NOW * 3, fm: { text: NOW * 2, color: 1, ring: "x" }, onclick: "x", m: 1, x: 0.1 },
        { id: "BAD ID", text: "x", fm: fm(1) },
        { id: "__proto__", text: "x", fm: fm(1) },
        { id: "sn-nostamp", text: "x", fm: {} },
        { id: "sn-fadedin", text: "x", faded: 5, fm: Object.assign(fm(1), { faded: 5 }) },
        { id: "sn-ccc", text: "tomb in file", fm: fm(1) },
        "junk", null, 7
      ]
    }
  };
  const mine = C.merge({ notes: [{ id: "sn-ccc", text: "mine", color: "green", ct: 1, fm: fm(10) }] }, null);
  const res = K.open(D, local(mine), evil, { now: NOW });
  assert.deepEqual(res.addedIds, ["sn-ok"]);                     // the file's tombs never delete
  const next = commitOf(mine, res.next);
  assert.equal(C.find(next, "sn-ccc").text, "mine");
  const ok = C.find(next, "sn-ok");
  assert.equal(Array.from(ok.text).length, C.MAX_LEN);
  assert.ok(!/[\u0000]/.test(ok.text));
  assert.equal(ok.color, "yellow");
  assert.equal(ok.ring, null);
  assert.equal(ok.vanish, null);
  assert.equal(ok.fm.text, NOW + K.FUTURE);                      // a future stamp → clamped
  assert.ok(!("onclick" in ok) && !("m" in ok) && !("x" in ok));
  assert.ok(!("prefs" in res.next) && !("pos" in res.next));
  assert.equal(D.norm("x"), null);
  assert.equal(D.norm([1, 2]), null);
  assert.deepEqual(D.norm({}), { ver: 1, notes: [] });
  assert.throws(() => K.open(D, C.empty(), { kind: "oros-todo-package", ver: 1, data: {} }), /notpackage/);
  assert.throws(() => K.open(D, C.empty(), { kind: "oros-stickies-package", ver: 9, data: {} }), /newer/);
  // caps: at most MAX_NOTES notes per file
  const many = { notes: [] };
  for (let i = 0; i < C.MAX_NOTES + 20; i++) many.notes.push({ id: "sn-" + i, text: "n" + i, fm: fm(1) });
  assert.equal(D.norm(many).notes.length, C.MAX_NOTES);
});

test("stickies: wiring (scripts, buttons, Open with, shell side, help, file types)", () => {
  const html = read("stickies/index.html");
  ["core.js?v=", "../bundle.js?v=", "../recordpkg.js?v=", "package.js?v=", "stickies.js?v="].forEach((s) =>
    assert.ok(html.includes('src="' + s), s));
  assert.ok(html.indexOf('src="core.js') < html.indexOf('src="package.js'));
  assert.ok(html.indexOf("recordpkg.js") < html.indexOf('src="stickies.js'));
  ["file-save", "file-open", "file-folder"].forEach((id) => assert.ok(html.includes('id="' + id + '"'), id));
  const js = read("stickies/stickies.js");
  assert.match(js, /RP\.ui\(SPK\.DESC,/);
  assert.match(js, /if \(target\.openFile\) \{ if \(recFile\) recFile\.openTarget\(target\.openFile\); return; \}/);
  ["openFile", "window.__orosOpenAt =", '__orosTakeTarget("stickies")', "H.addFromFile(", "H.removeAdded(", "H.fileAdded("].forEach((s) =>
    assert.ok(js.includes(s), s));
  assert.equal(js.split("window.__orosOpenAt =").length, 2);
  assert.ok(read("recordpkg.js").includes("__orosTakeFile("));
  assert.ok(js.includes('"file.save": "orOS file (.orosstickies)"'));
  assert.ok(js.includes('"file.save": "Αρχείο orOS (.orosstickies)"'));
  assert.ok(js.includes('"file.folder": "Αποσυμπιεσμένος φάκελος orOS…"'));
  const host = read("stickies/host.js");
  ["addFromFile: addFromFile", "removeAdded: removeAdded", "fileAdded: function"].forEach((s) => assert.ok(host.includes(s), s));
  assert.match(host, /return commit\(C\.merge\(cur\(\), \{ notes: notes \}\)\);/);   // merged, never replaced
  for (const f of ["stickies/help.en.txt", "stickies/help.el.txt"]) assert.ok(read(f).includes(".orosstickies"), f);
  assert.deepEqual(F.appsFor(".orosstickies"), ["stickies"]);
  assert.deepEqual(B.TYPES[".orosstickies"], { app: "stickies", mime: "application/x-oros-stickies" });
});
