// The .orosbaby file (Baby, a record app): children, log entries,
// growth, marks and milk-stash bags through the shared kit
// (recordpkg.js) and bundle.js; opening adds only what is missing,
// with its ids. Plus the app wiring (Save, Open, unzipped folder,
// "Open with").
// Run: node --test tests/*.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const B = require(path.join(ROOT, "bundle.js"));
const K = require(path.join(ROOT, "recordpkg.js"));
const C = require(path.join(ROOT, "baby/core.js"));
const P = require(path.join(ROOT, "baby/package.js"));
const F = require(path.join(ROOT, "fileopen.js"));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const D = P.DESC;
const NOW = 1800000000000;
const TS = new Date(2026, 9, 14, 9, 5).getTime();     // local time: the CSV is local
const KID = "kidaaa001";

function slice() {
  return C.normalize({
    ver: 1,
    kids: [{ id: KID, n: "Anna", b: "2026-06-01", s: "f", c: 2, m: NOW - 9000 },
           { id: "kidgone01", m: NOW - 50, del: 1 }],
    ev: [
      { id: "evaaa0001", k: KID, t: "bottle", ts: TS, ml: 120, x: "fm", m: NOW - 900 },
      { id: "evaaa0002", k: KID, t: "sleep", ts: TS + 3600000, e: TS + 7200000, m: NOW - 800 },
      { id: "evaaa0003", k: KID, t: "note", ts: TS + 100, tx: "=HYPERLINK(\"x\")", m: NOW - 700 },
      { id: "evrun0001", k: KID, t: "feed", ts: TS + 9000000, ls: 60, rs: 0, cur: "l", cs: TS + 9000000, m: NOW - 10 },
      { id: "evgone001", m: NOW - 100, del: 1 }
    ],
    gr: [{ id: "graaa0001", k: KID, d: "2026-07-01", g: 4200, l: 540, m: NOW - 600 }],
    mk: [{ id: KID + "xsmile", k: KID, t: "ms", key: "smile", d: "2026-07-10", m: NOW - 500 },
         { id: "mkaaa0001", k: KID, t: "vac", tx: "6-in-1", d: "2026-08-01", m: NOW - 400 }],
    st: [{ id: "staaa0001", ml: 150, d: "2026-10-01", w: "z", u: "2027-04-01", m: NOW - 300 }],
    prefs: { wu: "lb", tu: "f", vu: "oz" },
    pm: NOW - 40
  });
}

test("baby: round trip through bundle.js; no tombstones, no running timer, no units", async () => {
  const o = K.pack(D, slice(), { title: "Baby", lang: "en", now: NOW });
  assert.equal(o.mime, "application/x-oros-baby");
  assert.equal(o.generator, "orOS Baby");
  assert.deepEqual(Object.keys(o.content.data).sort(), ["ev", "gr", "kids", "mk", "st", "ver"]);
  assert.deepEqual(o.content.data.kids.map((k) => k.id), [KID]);
  assert.deepEqual(o.content.data.ev.map((e) => e.id), ["evaaa0001", "evaaa0002", "evaaa0003"]);
  assert.ok(!JSON.stringify(o.content).includes("\"del\""));
  const bytes = await B.write(o);
  assert.equal(B.sniff(bytes.subarray(0, 128)), "application/x-oros-baby");
  const r = await B.read(bytes, { mime: D.mime });
  assert.equal(r.content.kind, "oros-baby-package");
  assert.deepEqual(r.content.data.mk, slice().mk);
  assert.deepEqual(r.content.data.st, slice().st);
  // previews: the app's own CSV exports, with the formula guard
  const log = o.preview.find((p) => p.name === "log.csv").data;
  const gcsv = o.preview.find((p) => p.name === "growth.csv").data;
  assert.equal(gcsv, C.growthCsv(slice()));
  assert.ok(log.startsWith("child,type,start,end,"));
  assert.ok(log.includes("Anna,bottle,2026-10-14 09:05,"));
  assert.ok(log.includes("\"'=HYPERLINK(\"\"x\"\")\""));
  assert.ok(!log.includes("evrun0001") && log.split("\r\n").length === 5);
  // into a device with other data and its own units
  const other = C.normalize({
    kids: [{ id: "kidbbb001", n: "Ben", b: "2025-01-01", m: NOW - 5000 }],
    ev: [{ id: "evbbb0001", k: "kidbbb001", t: "diaper", ts: TS - 86400000, x: "w", m: NOW - 5000 }],
    prefs: { wu: "kg" }, pm: NOW - 4000
  });
  const res = K.open(D, other, r.content, { now: NOW });
  assert.deepEqual(res.report, { added: 8, skipped: 0, updated: 0 });
  assert.deepEqual(res.addedIds.slice().sort(),
    ["evaaa0001", "evaaa0002", "evaaa0003", "graaa0001", KID, KID + "xsmile", "mkaaa0001", "staaa0001"].sort());
  assert.deepEqual(res.next.kids.map((k) => k.id), [KID, "kidbbb001"]);
  assert.deepEqual(res.next.ev.map((e) => e.id), ["evaaa0001", "evaaa0002", "evaaa0003", "evbbb0001"]);
  assert.deepEqual(res.next.prefs, other.prefs);                 // units stay this device's
  assert.equal(res.next.pm, other.pm);
  assert.deepEqual(res.next, C.normalize(res.next));             // canonical, as the slice wants
  // and again: nothing
  const again = K.open(D, res.next, r.content, { now: NOW });
  assert.equal(again.report.added, 0);
  assert.equal(again.report.skipped, 8);
  assert.deepEqual(again.next, res.next);
  // into an empty device
  const fresh = K.open(D, C.empty(), r.content, { now: NOW });
  assert.equal(fresh.report.added, 8);
  assert.deepEqual(C.normalize(fresh.next).kids.map((k) => k.n), ["Anna"]);
});

test("baby: a clash keeps the local record; deleted stays deleted; update takes newer", () => {
  const mine = slice();
  const theirs = slice();
  const ev1 = theirs.ev.find((e) => e.id === "evaaa0001");
  ev1.ml = 200; ev1.m = NOW - 1;                                 // the same bottle, changed later
  const ms = theirs.mk.find((x) => x.key === "smile");
  ms.d = "2026-07-20"; ms.m = NOW - 1;                           // the same seed milestone, another day
  theirs.kids[1] = { id: "kidgone01", n: "Zoe", b: "2026-01-01", m: NOW - 1 };   // deleted here, live there
  theirs.ev.push({ id: "evnew0001", k: KID, t: "bath", ts: TS + 50000, m: NOW - 1 });
  const c = K.pack(D, theirs, { now: NOW }).content;
  const res = K.open(D, mine, c, { now: NOW });
  assert.deepEqual(res.addedIds, ["evnew0001"]);
  assert.deepEqual(res.report, { added: 1, skipped: 9, updated: 0 });
  assert.equal(res.next.ev.find((e) => e.id === "evaaa0001").ml, 120);
  assert.equal(res.next.mk.find((x) => x.key === "smile").d, "2026-07-10");
  assert.deepEqual(res.next.kids.find((k) => k.id === "kidgone01"), mine.kids.find((k) => k.id === "kidgone01"));
  assert.ok(res.next.ev.find((e) => e.id === "evrun0001").cur);  // the running timer here is untouched
  // "Update with newer versions": the bottle and the milestone take the file's; the tombstone stays
  const upd = K.open(D, mine, c, { update: true, now: NOW });
  assert.deepEqual(upd.updatedIds.slice().sort(), ["evaaa0001", KID + "xsmile"]);
  assert.equal(upd.next.ev.find((e) => e.id === "evaaa0001").ml, 200);
  assert.equal(upd.next.mk.find((x) => x.key === "smile").d, "2026-07-20");
  assert.equal(upd.next.kids.find((k) => k.id === "kidgone01").del, 1);
  // a file's record NOT newer than the local one never wins, even with update
  const old = slice(); old.ev[0].ml = 300; old.ev[0].m = NOW - 99999;
  const u2 = K.open(D, mine, K.pack(D, old, { now: NOW }).content, { update: true, now: NOW });
  assert.equal(u2.next.ev.find((e) => e.id === "evaaa0001").ml, 120);
  assert.equal(P.kindOf("evnew0001", res.next), "ev");
  assert.equal(P.kindOf(KID, res.next), "kid");
  assert.equal(P.kindOf("graaa0001", res.next), "gr");
  assert.equal(P.kindOf("mkaaa0001", res.next), "mk");
  assert.equal(P.kindOf("staaa0001", res.next), "st");
  assert.equal(P.kindOf("nope", res.next), "");
});

test("baby: hostile content is cut down; stamps are clamped; wrong kinds refused", () => {
  const evil = {
    kind: "oros-baby-package", ver: 1,
    data: {
      ver: 1, prefs: { wu: "lb" }, pm: NOW * 10, rem: { feed: 120 },
      kids: [
        { id: "kidok0001", n: "  A\u0000<b>x</b>\n" + "y".repeat(100), b: "2026-01-01", s: "q", c: 99, m: NOW * 2, onclick: "x" },
        { id: "kidbad001", n: "", b: "2026-01-01", m: 1 },
        { id: "kidbad002", n: "B", b: "2026-02-30", m: 1 },
        { id: "__proto__", n: "C", b: "2026-01-01", m: 1 },
        { id: "BAD ID", n: "D", b: "2026-01-01", m: 1 },
        "junk", null, 7
      ],
      ev: [
        { id: "evok00001", k: "kidok0001", t: "temp", ts: TS, v: 375, m: 1, html: "<script>" },
        { id: "evbad0001", k: "kidok0001", t: "bottle", ts: TS, ml: 99999, m: 1 },
        { id: "evbad0002", k: "kidok0001", t: "nuke", ts: TS, m: 1 },
        { id: "evbad0003", k: "kidok0001", t: "bath", ts: 8e15, m: 1 },
        { id: "evbad0004", k: "kidok0001", t: "bath", ts: -5, m: 1 },
        { id: "evbad0005", k: "kidok0001", t: "med", ts: TS, tx: "  ", m: 1 },
        { id: "evrun0009", k: "kidok0001", t: "sleep", ts: TS, m: 1 },          // running: left out
        { id: "evdead001", m: 5, del: 1 }
      ],
      gr: [{ id: "grbad0001", k: "kidok0001", d: "2026-03-01", g: 5, m: 1 },
           { id: "grok00001", k: "kidok0001", d: "2026-03-01", g: 5000, h: 9999, m: 1 }],
      mk: [{ id: "kidok0001xwalk", k: "kidok0001", t: "ms", key: "walk", d: "2026-05-01", m: 1 },
           { id: "mkforged1", k: "kidok0001", t: "ms", key: "smile", d: "2026-05-01", m: 1 },   // seed key, wrong id
           { id: "mkbad0001", k: "kidok0001", t: "x", tx: "y", d: "2026-05-01", m: 1 }],
      st: [{ id: "stbad0001", ml: 150, d: "2026-10-01", w: "q", u: "2027-04-01", m: 1 }]
    }
  };
  const res = K.open(D, C.empty(), evil, { now: NOW });
  assert.deepEqual(res.addedIds.slice().sort(), ["evok00001", "grok00001", "kidok0001", "kidok0001xwalk"]);
  const kid = res.next.kids[0];
  assert.deepEqual(Object.keys(kid), ["id", "n", "b", "s", "c", "m"]);
  assert.equal(kid.n.length, C.LIM.name);
  assert.ok(!/[\u0000-\u001f]/.test(kid.n));
  assert.equal(kid.s, ""); assert.equal(kid.c, 0);
  assert.equal(kid.m, NOW + K.FUTURE);                           // a future stamp is clamped
  assert.deepEqual(res.next.ev, [{ id: "evok00001", k: "kidok0001", t: "temp", ts: TS, v: 375, m: 1 }]);
  assert.deepEqual(res.next.gr, [{ id: "grok00001", k: "kidok0001", d: "2026-03-01", g: 5000, m: 1 }]);
  assert.equal(res.next.st, undefined);
  assert.deepEqual(res.next.prefs, C.empty().prefs);            // a file never sets the units
  assert.equal(res.next.pm, 0);
  assert.equal(res.next.rem, undefined);
  assert.equal(D.norm("x"), null);
  assert.equal(D.norm([1, 2]), null);
  assert.deepEqual(D.norm({}), { ver: 1, kids: [], ev: [], gr: [], mk: [], st: [] });
  assert.throws(() => K.open(D, C.empty(), { kind: "oros-todo-package", ver: 1, data: {} }), /notpackage/);
  assert.throws(() => K.open(D, C.empty(), { kind: "oros-baby-package", ver: 9, data: {} }), /newer/);
  // caps
  const many = { kids: [] };
  for (let i = 0; i < P.LIM.kids + 5; i++) many.kids.push({ id: "kid" + String(i).padStart(6, "0"), n: "K", b: "2026-01-01", m: 1 });
  assert.equal(D.norm(many).kids.length, P.LIM.kids);
});

test("baby: wiring (scripts, buttons, Open with, help, file types)", () => {
  const html = read("baby/index.html");
  ["core.js?v=", "../bundle.js?v=2.52.00", "../recordpkg.js?v=2.52.00", "package.js?v=2.52.00", "baby.js?v=2.52.00"].forEach((s) =>
    assert.ok(html.includes('src="' + s), s));
  assert.ok(html.indexOf('src="core.js') < html.indexOf('src="package.js'));
  assert.ok(html.indexOf("recordpkg.js") < html.indexOf('src="baby.js'));
  const js = read("baby/baby.js");
  assert.match(js, /RP\.ui\(BPK\.DESC,/);
  assert.match(js, /if \(t && t\.openFile\) \{ if \(recFile\) recFile\.openTarget\(t\.openFile\); return; \}/);
  ["openFile", "__orosTakeFile(", "window.__orosOpenAt =", '__orosTakeTarget("baby")'].forEach((s) => assert.ok(js.includes(s), s));
  assert.equal(js.split("window.__orosOpenAt =").length, 2);
  ["bb-osave", "bb-oopen", "bb-ofolder"].forEach((id) => assert.ok(js.includes('"' + id + '"'), id));
  assert.ok(js.includes('"set.osave": "orOS file (.orosbaby)"'));
  assert.ok(js.includes('"set.osave": "Αρχείο orOS (.orosbaby)"'));
  assert.ok(js.includes('"set.ofolder": "Αποσυμπιεσμένος φάκελος orOS…"'));
  const en = read("baby/help.en.txt"), el = read("baby/help.el.txt");
  for (const s of [en, el]) assert.ok(s.includes(".orosbaby"));
  assert.equal(en.match(/^## /gm).length, el.match(/^## /gm).length);
  assert.ok(en.includes("## Save and open an orOS file"));
  assert.ok(en.includes("not encrypted"));
  assert.deepEqual(F.appsFor(".orosbaby"), ["baby"]);
  assert.deepEqual(B.TYPES[".orosbaby"], { app: "baby", mime: "application/x-oros-baby" });
});
