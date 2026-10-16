// The .orosdiary file (One-Sentence Diary): every day's line, longer
// entry and own question through the shared kit (recordpkg.js) and
// bundle.js, the photos in media/; opening adds only the days that are
// missing, with their dates. Plus the app wiring (Save, Open, unzipped
// folder, "Open with", the PIN lock).
// Run: node --test tests/*.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const B = require(path.join(ROOT, "bundle.js"));
const K = require(path.join(ROOT, "recordpkg.js"));
const P = require(path.join(ROOT, "diary/package.js"));
const C = require(path.join(ROOT, "diary/core.js"));
const F = require(path.join(ROOT, "fileopen.js"));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const D = P.DESC;
const NOW = 1800000000000;
const clone = (x) => JSON.parse(JSON.stringify(x));
const PH = "20261001-abc123xyz.jpg";
const KEY = "a".repeat(64) + ".jpg";

function slice() {
  return {
    ver: 1,
    days: {
      "2026-10-01": { t: "Rain all day", e: "😔", m: NOW - 900 },
      "2026-10-02": { t: "=HYPERLINK(\"x\")", e: "", m: NOW - 800 }
    },
    tombs: { "2026-09-30": NOW - 950 },
    long: {
      "2026-10-01": { md: { v: "# Walk\nwet shoes", m: NOW - 900 }, ph: { v: [PH], m: NOW - 900 },
                      loc: { v: { n: "Thessaloniki", la: 40.64, lo: 22.94 }, m: NOW - 900 }, wx: { v: { c: 61, hi: 14, lo: 9 }, m: NOW - 900 } },
      "2026-09-29": { md: { v: "", m: NOW - 990 } }                       // cleared: a tombstone
    },
    prompts: { "p-abc123": { t: "What made you smile?", m: NOW - 700 }, "p-gone99": { t: "old", m: NOW - 600, x: 1 } }
  };
}

test("diary: round trip through bundle.js; the file has no tombstones; photos by hash", async () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
  const KEY = (await B.sha256(jpeg)) + ".jpg";
  const st = P.forKit(slice());
  st.phs = { [PH]: KEY };                                              // as the app's files hook sets it
  const o = K.pack(D, st, { title: "One-Sentence Diary", lang: "en", now: NOW, files: [{ key: KEY, bytes: jpeg, type: "image/jpeg" }] });
  assert.equal(o.mime, "application/x-oros-diary");
  assert.deepEqual(Object.keys(o.content.data).sort(), ["days", "long", "phs", "prompts", "ver"]);
  assert.deepEqual(Object.keys(o.content.data.long), ["2026-10-01"]);        // the cleared entry is left out
  assert.deepEqual(Object.keys(o.content.data.prompts), ["p-abc123"]);       // the deleted question too
  assert.equal(o.content.data.long["2026-10-01"].m, NOW - 900);
  const bytes = await B.write(o);
  assert.equal(B.sniff(bytes.subarray(0, 128)), "application/x-oros-diary");
  const r = await B.read(bytes, { mime: D.mime });
  assert.equal(r.content.kind, "oros-diary-package");
  assert.deepEqual(r.content.data.days, slice().days);
  assert.deepEqual(r.content.data.phs, { [PH]: KEY });
  assert.ok(r.media[KEY]);
  // previews: Markdown with the long entry and place, CSV with a formula guard
  const md = o.preview.find((p) => p.name === "diary.md").data;
  assert.match(md, /^# One-Sentence Diary\n\n## 2026-10-01 😔\n\nRain all day\n\n# Walk\nwet shoes\n\n📍 Thessaloniki\n\n## 2026-10-02\n\n=HYPERLINK/);
  const csv = o.preview.find((p) => p.name === "diary.csv").data;
  assert.equal(csv, "date,text,emoji\r\n2026-10-01,Rain all day,😔\r\n2026-10-02,\"'=HYPERLINK(\"\"x\"\")\",\r\n");
  // into a device with other days
  const other = { ver: 1, days: { "2026-10-05": { t: "Mine", e: "", m: NOW - 100 } }, tombs: {} };
  const res = K.open(D, P.forKit(other), r.content, { now: NOW });
  assert.deepEqual(res.report, { added: 4, skipped: 0, updated: 0 });         // 2 days, 1 longer entry, 1 question
  assert.deepEqual(res.addedIds.slice().sort(), ["2026-10-01", "2026-10-01", "2026-10-02", "p-abc123"]);
  assert.deepEqual(Object.keys(res.next.days).sort(), ["2026-10-01", "2026-10-02", "2026-10-05"]);
  assert.deepEqual(res.next.long["2026-10-01"].ph.v, [PH]);
  assert.equal(res.next.long["2026-10-01"].m, undefined);                    // mergeDiary drops the kit's stamp
  assert.equal(res.next.phs, undefined);
  assert.deepEqual(res.next, C.mergeDiary(res.next, res.next));             // the app's own shape
  assert.deepEqual(P.added(other, res.next), { days: ["2026-10-01", "2026-10-02"], long: ["2026-10-01"], prompts: ["p-abc123"] });
  // and again: nothing
  const again = K.open(D, P.forKit(res.next), r.content, { now: NOW });
  assert.equal(again.report.added, 0);
  assert.equal(again.report.updated, 0);
  assert.deepEqual(again.next, res.next);
});

test("diary: a clash keeps the local day; deleted here stays deleted; update takes newer per field", () => {
  const theirs = slice();
  theirs.days["2026-10-01"] = { t: "Their line", e: "🎉", m: NOW - 10 };
  theirs.days["2026-09-30"] = { t: "deleted here", e: "", m: NOW - 5 };      // newer than my tombstone
  theirs.long["2026-10-01"].md = { v: "their text", m: NOW - 10 };
  theirs.prompts["p-gone99"] = { t: "back?", m: NOW - 1 };
  delete theirs.tombs;
  const mine = slice();
  const c = K.pack(D, P.forKit(theirs), { now: NOW }).content;
  const res = K.open(D, P.forKit(mine), c, { now: NOW });
  assert.deepEqual(res.addedIds, []);
  assert.equal(res.report.added, 0);
  assert.equal(res.next.days["2026-10-01"].t, "Rain all day");
  assert.equal(res.next.days["2026-09-30"], undefined);
  assert.equal(res.next.prompts["p-gone99"].x, 1);
  assert.equal(res.next.long["2026-10-01"].md.v, "# Walk\nwet shoes");
  const upd = K.open(D, P.forKit(mine), c, { update: true, now: NOW });
  assert.deepEqual(upd.updatedIds.sort(), ["2026-10-01", "2026-10-01"]);    // the line and the long entry
  assert.equal(upd.next.days["2026-10-01"].t, "Their line");
  assert.equal(upd.next.long["2026-10-01"].md.v, "their text");
  assert.deepEqual(upd.next.long["2026-10-01"].ph.v, [PH]);                // the fields not newer stay
  assert.equal(upd.next.days["2026-09-30"], undefined);
  assert.deepEqual(upd.next.tombs, mine.tombs);
});

test("diary: hostile content is cut down; stamps clamped", () => {
  const n = D.norm({
    days: { "2026-10-01": { t: "a\u0000b\nc " + "x".repeat(400), e: "<img>", m: 5, evil: 1 }, "2026-02-30": { t: "no", m: 1 },
            "__proto__": { t: "x", m: 1 }, "2026-10-03": { t: "", m: 1 }, "2026-10-04": { t: "ok", m: -1 } },
    long: { "2026-10-01": { md: { v: 7, m: 2 }, ph: { v: ["../../etc/passwd", PH, PH, "20261001-zzzzzz.jpg", "20261001-yyyyyy.jpg", "20261001-wwwwww.jpg"], m: 2 },
                            loc: { v: { n: "x".repeat(200), la: 40.123456, lo: 999 }, m: 2 }, wx: { v: { c: 500 }, m: 2 }, evil: { v: 1, m: 2 } } },
    prompts: { "BAD ID": { t: "x", m: 1 }, "p-okay1": { t: "q r", m: 1, onclick: "x" } },
    phs: { [PH]: KEY, "20261001-zzzzzz.jpg": "../x.jpg", "20261231-unused1.jpg": KEY },
    tombs: { "2026-10-09": 1 }, evil: "<script>"
  });
  assert.deepEqual(Object.keys(n.days), ["2026-10-01"]);
  assert.equal(n.days["2026-10-01"].t, Array.from("a b c " + "x".repeat(400)).slice(0, 280).join(""));
  assert.equal(n.days["2026-10-01"].e, "");
  assert.equal(n.days["2026-10-01"].evil, undefined);
  const L = n.long["2026-10-01"];
  assert.equal(L.md.v, "");
  assert.deepEqual(L.ph.v, [PH, "20261001-zzzzzz.jpg", "20261001-yyyyyy.jpg", "20261001-wwwwww.jpg"]);
  assert.equal(L.loc.v.n.length, 80);
  assert.equal(L.loc.v.la, undefined);
  assert.equal(L.wx.v, null);
  assert.equal(L.evil, undefined);
  assert.deepEqual(n.prompts, { "p-okay1": { t: "q r", m: 1 } });
  assert.deepEqual(n.phs, { [PH]: KEY });                                    // bad key and unused name dropped
  assert.equal(n.evil, undefined);
  assert.equal(D.strip(n).tombs, undefined);
  assert.equal(D.norm("x"), null);
  assert.throws(() => K.open(D, P.forKit(slice()), { kind: "oros-todo-package", ver: 1, data: {} }), /notpackage/);
  assert.throws(() => K.open(D, P.forKit(slice()), { kind: "oros-diary-package", ver: 9, data: {} }), /newer/);
  // stamps from the future come down to now + 5 min
  const far = { kind: "oros-diary-package", ver: 1, data: { days: { "2027-01-01": { t: "future", m: NOW * 2 } },
    long: { "2027-01-01": { md: { v: "x", m: NOW * 2 } } } } };
  const res = K.open(D, P.forKit({ ver: 1, days: {}, tombs: {} }), far, { now: NOW });
  assert.equal(res.next.days["2027-01-01"].m, NOW + K.FUTURE);
  assert.equal(res.next.long["2027-01-01"].md.m, NOW + K.FUTURE);
  // a flood of questions is capped
  const many = {};
  for (let i = 0; i < 700; i++) many["p-" + String(i).padStart(6, "0")] = { t: "q" + i, m: 1 };
  assert.equal(Object.keys(D.norm({ days: {}, prompts: many }).prompts).length, P.LIM.prompts);
  assert.equal(P.csvCell("@x"), "\"'@x\"");
  assert.equal(P.csvCell("-1"), "\"'-1\"");
});

test("diary: Undo through the app's own delete path leaves tombstones that sync", () => {
  const other = { ver: 1, days: { "2026-10-05": { t: "Mine", e: "", m: NOW - 100 } }, tombs: {} };
  const res = K.open(D, P.forKit(other), K.pack(D, P.forKit(slice()), { now: NOW }).content, { now: NOW });
  let data = C.mergeDiary(res.next, res.next);
  const a = P.added(other, data), t = NOW + 1000;
  a.days.forEach((y) => { data = C.setDay(data, y, "", "", t); });
  a.long.forEach((y) => C.LONG_FIELDS.forEach((f) => { data = C.setLong(data, y, f, f === "md" ? "" : (f === "ph" ? [] : null), t); }));
  a.prompts.forEach((id) => { data = C.setPrompt(data, id, "", true, t); });
  assert.deepEqual(Object.keys(data.days), ["2026-10-05"]);
  assert.deepEqual(Object.keys(data.tombs).sort(), ["2026-10-01", "2026-10-02"]);
  assert.equal(C.hasLong(data, "2026-10-01"), false);
  assert.deepEqual(C.livePrompts(data), []);
  // the other device (still holding the added days) loses them in the sync merge
  const merged = C.mergeDiary(res.next, data);
  assert.deepEqual(Object.keys(merged.days), ["2026-10-05"]);
  // and the same file opened again here adds nothing (deleted here)
  const again = K.open(D, P.forKit(data), K.pack(D, P.forKit(slice()), { now: NOW }).content, { now: NOW });
  assert.equal(again.report.added, 0);
});

test("diary: wiring (scripts, buttons, Open with, PIN lock, photos, help, file types)", () => {
  const html = read("diary/index.html");
  ["../bundle.js?v=", "../recordpkg.js?v=", "package.js?v=", "diary.js?v="].forEach((s) =>
    assert.ok(html.includes('src="' + s), s));
  assert.ok(html.indexOf('src="core.js') < html.indexOf('src="package.js'));
  assert.ok(html.indexOf('src="package.js') < html.indexOf('src="diary.js'));
  ["oros-save", "oros-open", "oros-folder"].forEach((id) => assert.ok(html.includes('id="' + id + '"'), id));
  const js = read("diary/diary.js");
  assert.match(js, /RP\.ui\(DPK\.DESC,/);
  assert.match(js, /get: function \(\) \{ return DPK\.forKit\(sliceGet\(\)\); \}/);
  assert.match(js, /if \(target && typeof target === "object" && target\.openFile\) \{ openFileTarget\(target\.openFile\); return; \}/);
  assert.equal((js.match(/window\.__orosOpenAt = /g) || []).length, 1);
  assert.match(js, /__orosTakeTarget\("diary"\)/);
  assert.match(js, /p\.__orosTakeFile\(o\.token\)/);                         // taken at once while locked
  assert.match(js, /if \(lockRec && \(locked \|\| !booted\)\)|!\(lockRec && \(locked \|\| !booted\)\)/);
  assert.match(js, /runWaitingFile\(\);\n  \}\n  function tryUnlock/);
  assert.match(js, /encodePhoto\(blob\)/);                                  // photos from a file: the picker's checks
  assert.match(js, /data = C\.setDay\(data, ymd, "", "", now\)/);           // Undo through tombstones
  ["\"oros.save\": \"orOS file (.orosdiary)\"", "\"oros.save\": \"Αρχείο orOS (.orosdiary)\"",
   "\"oros.open\": \"Open orOS file…\"", "\"oros.open\": \"Άνοιγμα αρχείου orOS…\"",
   "\"oros.folder\": \"Unzipped orOS folder…\"", "\"oros.folder\": \"Αποσυμπιεσμένος φάκελος orOS…\""].forEach((s) => assert.ok(js.includes(s), s));
  assert.ok(/"oros\.hint": "[^"]*not encrypted/.test(js) && /"oros\.hint": "[^"]*δεν είναι κρυπτογραφημένο/.test(js));
  const en = read("diary/help.en.txt"), el = read("diary/help.el.txt");
  for (const h of [en, el]) assert.ok(h.includes(".orosdiary"));
  assert.deepEqual(en.match(/^## /gm).length, el.match(/^## /gm).length);
  assert.deepEqual(F.appsFor(".orosdiary"), ["diary"]);
  assert.deepEqual(B.TYPES[".orosdiary"], { app: "diary", mime: "application/x-oros-diary" });
});
