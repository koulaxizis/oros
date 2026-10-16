// The .oroschores file (Chore Wheel, a phase 4b record app): every
// member, chore and event through the shared kit (recordpkg.js) and
// bundle.js; opening adds only what is missing, with its ids. Plus the
// app wiring (Save, Open, unzipped folder, "Open with").
// Run: node --test tests/*.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const B = require(path.join(ROOT, "bundle.js"));
const K = require(path.join(ROOT, "recordpkg.js"));
const C = require(path.join(ROOT, "chores/core.js"));
const P = require(path.join(ROOT, "chores/package.js"));
const F = require(path.join(ROOT, "fileopen.js"));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const D = P.DESC;
// norm clamps with the real clock, so the stamps here are real ones
const NOW = Date.now() - 60000;
const TODAY = C.dnToYmd(C.localDn(new Date()));
const YDAY = C.dnToYmd(C.localDn(new Date()) - 1);

const A = "memberaaa1", Bm = "memberbbb2", T1 = "taskdish01", T2 = "tasktrash2";
function slice() {
  return {
    ver: 1,
    members: [
      { id: A, m: NOW - 900, name: "Anna", color: 0, icon: "👩", away: null, order: 0, om: 0 },
      { id: Bm, m: NOW - 800, name: "Bob", color: 1, icon: "", away: ["2026-12-01", "2026-12-05"], order: 1, om: NOW - 800 }
    ],
    tasks: [
      { id: T1, m: NOW - 700, name: "Dishes", icon: "🍽️", freq: { k: "d" }, weight: 1, mode: "rr", who: [], start: "2026-01-01", off: 0 },
      { id: T2, m: NOW - 600, name: "=cmd", icon: "", freq: { k: "wd", d: [0, 3] }, weight: 2, mode: "bal", who: [A, Bm], start: "2026-01-01", off: 1 }
    ],
    done: { [T1 + "|" + YDAY]: [1, A, NOW - 500], [T1 + "|" + TODAY]: [2, "", NOW - 400] },
    set: { [T1 + "|" + TODAY]: [Bm, NOW - 300] },
    tombs: { taskgone01: NOW - 100 }
  };
}
const canon = (s) => C.mergeChores(s, s);

test("chores: round trip through bundle.js; the file has no tombstones", async () => {
  const o = K.pack(D, canon(slice()), { title: "Chore Wheel", lang: "en", now: NOW });
  assert.equal(o.mime, "application/x-oros-chores");
  assert.equal(o.generator, "orOS Chore Wheel");
  assert.deepEqual(Object.keys(o.content.data).sort(), ["done", "members", "set", "tasks", "ver"]);
  const bytes = await B.write(o);
  assert.equal(B.sniff(bytes.subarray(0, 128)), "application/x-oros-chores");
  const r = await B.read(bytes, { mime: D.mime });
  assert.equal(r.content.kind, "oros-chores-package");
  assert.deepEqual(r.content.data.tasks, canon(slice()).tasks);
  assert.deepEqual(r.content.data.done, canon(slice()).done);
  // previews: Markdown, chores CSV with a formula guard, history CSV
  const pv = (n) => o.preview.find((p) => p.name === n).data;
  assert.match(pv("chores.md"), /^# Chore Wheel\n\n## Members\n\n- 👩 Anna\n- Bob \(away 2026-12-01 – 2026-12-05\)\n\n## Chores\n\n- 🍽️ Dishes: Every day · Easy · In turn · everyone \(from 2026-01-01\)/);
  assert.match(pv("chores.csv"), /^chore,icon,how often,effort,who gets it,who takes part,starts\r\nDishes,🍽️,Every day,Easy,In turn,everyone,2026-01-01\r\n"'=cmd",,Mon · Thu,Medium,Balanced,"Anna, Bob",2026-01-01\r\n$/);
  assert.equal(pv("history.csv"), "date,chore,state,by\r\n" + YDAY + ",Dishes,done,Anna\r\n" + TODAY + ",Dishes,skipped,\r\n");
  const el = K.pack(D, canon(slice()), { lang: "el", now: NOW }).preview.find((p) => p.name === "chores.md").data;
  assert.match(el, /^# Τροχός δουλειών\n\n## Μέλη/);

  // into a device that has another household member and a chore
  const other = canon({ ver: 1, members: [{ id: "memberzzz9", m: NOW - 50, name: "Zoe", color: 2, icon: "", away: null, order: 0, om: 0 }],
    tasks: [{ id: "taskvacuum", m: NOW - 50, name: "Vacuum", icon: "", freq: { k: "w" }, weight: 2, mode: "rr", who: [], start: TODAY, off: 0 }],
    done: {}, set: {}, tombs: {} });
  const res = K.open(D, other, r.content, { now: NOW });
  assert.deepEqual(res.report, { added: 7, skipped: 0, updated: 0 });   // 2 members, 2 chores, 2 done, 1 set
  assert.deepEqual(res.next.members.map((m) => m.id).sort(), [A, Bm, "memberzzz9"]);
  assert.deepEqual(res.next.tasks.map((t) => t.id).sort(), [T1, T2, "taskvacuum"]);
  assert.deepEqual(res.next.done, canon(slice()).done);
  assert.deepEqual(res.next.set, canon(slice()).set);
  assert.deepEqual(res.next.tombs, {});
  assert.deepEqual(res.next, canon(res.next));                           // canonical (core.js merge)
  // and again: nothing
  const again = K.open(D, res.next, r.content, { now: NOW });
  assert.equal(again.report.added, 0);
  assert.equal(again.report.skipped, 7);
  assert.deepEqual(again.next, res.next);
});

test("chores: a clash keeps the local record; deleted stays deleted; update takes newer", () => {
  const theirs = slice();
  theirs.members[0].name = "Anna from file"; theirs.members[0].m = NOW - 10;
  theirs.tasks.push({ id: "taskgone01", m: NOW - 200, name: "Gone here", icon: "", freq: { k: "d" }, weight: 1, mode: "rr", who: [], start: "2026-01-01", off: 0 });
  theirs.done[T1 + "|" + YDAY] = [0, "", NOW - 5];                        // a newer event for a key here
  theirs.done[T1 + "|" + C.dnToYmd(C.localDn(new Date()) - 2)] = [1, Bm, NOW - 5];
  delete theirs.tombs;
  const mine = canon(slice());
  const c = K.pack(D, theirs, { now: NOW }).content;
  const res = K.open(D, mine, c, { now: NOW });
  assert.equal(res.report.added, 1);
  assert.deepEqual(res.addedIds, [T1 + "|" + C.dnToYmd(C.localDn(new Date()) - 2)]);
  assert.equal(res.next.members.find((m) => m.id === A).name, "Anna");   // kept as it is here
  assert.ok(!res.next.tasks.some((t) => t.id === "taskgone01"));          // deleted here: stays deleted
  assert.deepEqual(res.next.done[T1 + "|" + YDAY], [1, A, NOW - 500]);    // events never overwritten
  assert.deepEqual(res.next.tombs, mine.tombs);
  const upd = K.open(D, mine, c, { update: true, now: NOW });
  assert.deepEqual(upd.updatedIds, [A]);
  assert.equal(upd.next.members.find((m) => m.id === A).name, "Anna from file");
  assert.deepEqual(upd.next.tombs, mine.tombs);
  assert.equal(P.kindOf(A, res.next), "member");
  assert.equal(P.kindOf(T1, res.next), "task");
  assert.equal(P.kindOf(T1 + "|" + TODAY, res.next), "event");
  assert.equal(P.kindOf("nope", res.next), "");
});

test("chores: hostile content is cut down", () => {
  const far = Date.now() + 365 * 864e5;
  const many = [];
  for (let i = 0; i < 100; i++) many.push({ id: "member" + String(i).padStart(4, "0"), m: 1, name: "M" + i });
  const n = D.norm({
    members: many.concat([{ id: "BAD ID", m: 1, name: "x" }]),
    tasks: [
      { id: "taskevil01", m: far, name: "a\u0000b <script>", icon: "<img onerror=x>", freq: { k: "n", n: 999 }, start: "2026-01-01", evil: 1 },
      { id: "taskgood01", m: far, name: "  ok  \n", icon: "🧹", freq: { k: "wd", d: [9, 1, 1, "x"] }, weight: 7, mode: "zz",
        who: ["memberaaa1", "../x", 5], start: "2026-02-30x", off: -1 },
      { id: "taskgood02", m: 5, name: "fine", freq: { k: "d" }, start: "2026-01-01", onclick: "x" }
    ],
    done: { ["taskgood02|" + TODAY]: [1, "", far], ["taskgood02|" + YDAY]: [1, "memberaaa1", far, "extra"],
            ["orphanxx01|" + TODAY]: [1, "memberaaa1", 1], "__proto__": [1, "memberaaa1", 1], ["taskgood02|1999-01-01"]: [1, "memberaaa1", 1] },
    set: { ["taskgood02|" + TODAY]: ["memberaaa1", far] },
    tombs: { taskgood03: 10, "bad key!": 5 }
  });
  assert.equal(n.members.length, C.MAX_MEMBERS);
  assert.deepEqual(n.tasks.map((t) => t.id), ["taskgood02"]);            // bad freq + bad start dropped
  const tk = n.tasks[0];
  assert.equal(tk.onclick, undefined);
  assert.ok(tk.m === 5);
  assert.deepEqual(Object.keys(n.done), ["taskgood02|" + YDAY]);        // done without "by", orphan, too old: gone
  assert.ok(n.done["taskgood02|" + YDAY][2] <= Date.now() + K.FUTURE);    // stamps clamped
  assert.ok(n.set["taskgood02|" + TODAY][1] <= Date.now() + K.FUTURE);
  assert.equal(D.norm("x"), null);
  // names are normalised by core.js
  const m = D.norm({ members: [{ id: "memberaaa1", m: 1, name: "a\u0007\nb", icon: "<b>", color: 99, order: -4, om: far }] }).members[0];
  assert.deepEqual([m.name, m.icon, m.color, m.order], ["ab", "", 0, 0]);   // control chars dropped, whitespace folded
  assert.ok(m.om <= Date.now() + K.FUTURE);
  // a file of another app is refused
  assert.throws(() => K.open(D, canon(slice()), { kind: "oros-todo-package", ver: 1, data: {} }), /notpackage/);
  assert.throws(() => K.open(D, canon(slice()), { kind: "oros-chores-package", ver: 9, data: {} }), /newer/);
});

test("chores: wiring (scripts, buttons, Open with, help, file types)", () => {
  const html = read("chores/index.html");
  ["../bundle.js?v=", "../recordpkg.js?v=", "package.js?v=", "chores.js?v="].forEach((s) =>
    assert.ok(html.includes('src="' + s), s));
  assert.ok(html.indexOf('src="core.js') < html.indexOf('src="package.js'));
  assert.ok(html.indexOf("recordpkg.js") < html.indexOf('src="chores.js'));
  ["o-save", "o-open", "o-folder", "file-sec"].forEach((id) => assert.ok(html.includes('id="' + id + '"'), id));
  const js = read("chores/chores.js");
  assert.match(js, /RP\.ui\(CPK\.DESC,/);
  assert.match(js, /if \(t && t\.openFile\) \{ if \(recFile\) recFile\.openTarget\(t\.openFile\); return; \}/);
  assert.match(js, /__orosTakeFile\(/);
  assert.match(js, /window\.__orosOpenAt = openSearchTarget;/);
  assert.equal((js.match(/window\.__orosOpenAt\s*=/g) || []).length, 1);
  assert.match(js, /__orosTakeTarget\("chores"\)/);
  for (const f of ["chores/help.en.txt", "chores/help.el.txt"]) assert.ok(read(f).includes(".oroschores"), f);
  assert.deepEqual(F.appsFor(".oroschores"), ["chores"]);
  assert.deepEqual(B.TYPES[".oroschores"], { app: "chores", mime: "application/x-oros-chores" });
});
