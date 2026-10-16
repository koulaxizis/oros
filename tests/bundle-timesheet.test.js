// The .oroshours file (Timesheet, a phase 4b record app): every
// client, project and finished entry through the shared kit
// (recordpkg.js) and bundle.js; opening adds only what is missing,
// with its ids. A running timer never travels. Plus the app wiring
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
const C = require(path.join(ROOT, "timesheet/core.js"));
const P = require(path.join(ROOT, "timesheet/package.js"));
const F = require(path.join(ROOT, "fileopen.js"));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const D = P.DESC;
const NOW = Date.now() - 60000;
const H = 3600000;
const T0 = new Date(2026, 9, 12, 9, 0).getTime();      // a Monday, local 09:00

function slice() {
  return C.normalize({
    ver: 1,
    clients: [{ id: "cliacme01", name: "Acme", rate: 5000, m: NOW - 900 },
              { id: "cligone01", m: NOW - 100, del: 1 }],
    projects: [{ id: "prjweb001", name: "Website", client: "cliacme01", color: 2, rate: 0, bill: 1, arch: 0, budget: 600, m: NOW - 800 },
               { id: "prjint001", name: "=Internal", client: "", color: 0, rate: 0, bill: 0, arch: 0, m: NOW - 700 }],
    entries: [
      { id: "entaaa001", p: "prjweb001", desc: "Home page", s: T0, e: T0 + 2 * H, billed: 0, task: "Design", tags: ["ui"], m: NOW - 600 },
      { id: "entbbb002", p: "prjint001", desc: "@team sync", s: T0 + 3 * H, e: T0 + 3.5 * H, billed: 1, m: NOW - 500 },
      { id: "entrun003", p: "prjweb001", desc: "still going", s: NOW - H, e: 0, billed: 0, m: NOW - 400 },
      { id: "entgone04", m: NOW - 300, del: 1 }
    ],
    prefs: { cur: "USD", rate: 4000, goal: 480, round: 15, rup: 1 },
    pm: NOW - 1000
  });
}

test("timesheet: round trip through bundle.js; the file has no tombstones, running timer or prefs stamp", async () => {
  const o = K.pack(D, slice(), { title: "Timesheet", lang: "en" });
  assert.equal(o.mime, "application/x-oros-hours");
  assert.equal(o.generator, "orOS Timesheet");
  const data = o.content.data;
  assert.deepEqual(Object.keys(data).sort(), ["clients", "entries", "prefs", "projects", "ver"]);
  assert.deepEqual(data.clients.map((x) => x.id), ["cliacme01"]);
  assert.deepEqual(data.entries.map((x) => x.id), ["entaaa001", "entbbb002"]);   // no tombstone, no running entry
  assert.deepEqual(data.prefs, { cur: "USD", rate: 4000, goal: 480, round: 15, rup: 1 });
  const bytes = await B.write(o);
  assert.equal(B.sniff(bytes.subarray(0, 128)), "application/x-oros-hours");
  const r = await B.read(bytes, { mime: D.mime });
  assert.equal(r.content.kind, "oros-timesheet-package");
  assert.deepEqual(r.content.data, data);
  // the preview: core.js toCsv (; separated, BOM, formula guard)
  const csv = o.preview.find((p) => p.name === "hours.csv").data;
  assert.equal(csv.charCodeAt(0), 0xfeff);
  const lines = csv.slice(1).split("\r\n");
  assert.match(lines[0], /^Date;Start;End;Duration;Hours;Client;Project;Description;Task;Tags;Billable;Rate;Amount;Billed$/);
  assert.equal(lines[1], "2026-10-12;09:00;11:00;2:00;2.00;Acme;Website;Home page;Design;ui;Yes;50.00;100.00;No");
  assert.equal(lines[2], "2026-10-12;12:00;12:30;0:30;0.50;;'=Internal;'@team sync;;;No;0.00;0.00;Yes");
  assert.equal(lines.length, 4);                                             // + the trailing CRLF
  assert.match(K.pack(D, slice(), { lang: "el" }).preview[0].data, /^﻿Ημερομηνία;/);
  // into a device with its own data and a running timer of its own
  const mine = C.normalize({
    ver: 1, clients: [], projects: [],
    entries: [{ id: "entmine01", p: "", desc: "mine", s: NOW - 2 * H, e: 0, billed: 0, m: NOW - 50 }],
    prefs: { cur: "EUR", rate: 0, goal: 0, round: 0, rup: 1 }, pm: NOW - 10
  });
  const res = K.open(D, mine, r.content);
  assert.deepEqual(res.report, { added: 5, skipped: 0, updated: 0 });
  assert.deepEqual(res.addedIds.slice().sort(), ["cliacme01", "entaaa001", "entbbb002", "prjint001", "prjweb001"]);
  assert.deepEqual(res.next.entries.map((x) => x.id), ["entaaa001", "entbbb002", "entmine01"]);
  assert.equal(res.next.entries[2].e, 0);                                    // this device's timer still runs
  assert.equal(C.running(res.next).length, 1);
  assert.deepEqual(res.next.prefs, mine.prefs);                              // settings stay
  assert.equal(res.next.pm, mine.pm);
  assert.deepEqual(res.next.projects.find((p) => p.id === "prjweb001"), slice().projects.find((p) => p.id === "prjweb001"));
  // and again: nothing
  const again = K.open(D, res.next, r.content);
  assert.equal(again.report.added, 0);
  assert.deepEqual(again.next, res.next);
  // into the same device it came from: nothing either
  assert.equal(K.open(D, slice(), r.content).report.added, 0);
});

test("timesheet: a clash keeps the local record, a deleted one stays deleted, update takes newer", () => {
  const theirs = slice();
  theirs.entries.find((x) => x.id === "entaaa001").desc = "changed there";
  theirs.entries.find((x) => x.id === "entaaa001").m = NOW - 1;
  theirs.entries.push({ id: "entnew005", p: "prjweb001", desc: "new", s: T0 + 5 * H, e: T0 + 6 * H, billed: 0, m: NOW - 1 });
  theirs.entries.push({ id: "entgone04", p: "", desc: "deleted here", s: T0, e: T0 + H, billed: 0, m: NOW });
  theirs.clients.push({ id: "cligone01", name: "Back from the dead", rate: 0, m: NOW });
  const c = K.pack(D, C.normalize(theirs)).content;
  const mine = slice();
  const res = K.open(D, mine, c);
  assert.deepEqual(res.addedIds, ["entnew005"]);
  const next = C.normalize(res.next);
  assert.equal(next.entries.find((x) => x.id === "entaaa001").desc, "Home page");    // the local copy
  assert.equal(next.entries.find((x) => x.id === "entgone04").del, 1);               // still deleted
  assert.equal(next.clients.find((x) => x.id === "cligone01").del, 1);
  assert.equal(next.entries.find((x) => x.id === "entrun003").e, 0);                // the local timer
  const upd = K.open(D, mine, c, { update: true });
  assert.deepEqual(upd.updatedIds, ["entaaa001"]);
  assert.equal(upd.next.entries.find((x) => x.id === "entaaa001").desc, "changed there");
  assert.equal(upd.next.entries.find((x) => x.id === "entgone04").del, 1);
  assert.equal(P.kindOf("entnew005", res.next), "entry");
  assert.equal(P.kindOf("prjweb001", res.next), "project");
  assert.equal(P.kindOf("cliacme01", res.next), "client");
  assert.equal(P.kindOf("entgone04", res.next), "");
  assert.equal(P.kindOf("nope", res.next), "");
});

test("timesheet: hostile content is cut down (known fields, typed, capped, stamps clamped)", () => {
  const far = Date.now() + 365 * 24 * H;
  const c = { kind: "oros-timesheet-package", ver: 1, data: {
    clients: [{ id: "cliok0001", name: "a\u0000\u0007b " + "x".repeat(500), rate: -5, m: far, onclick: { x: 1 } },
              { id: "BAD ID", name: "x", m: 1 }, "junk", null],
    projects: [{ id: "prjok0001", name: "<img src=x onerror=alert(1)>", client: "../etc", color: 99, rate: 1e12, bill: "yes", m: 5, budget: -1 }],
    entries: [
      { id: "entok0001", p: "prjok0001", desc: "d ".repeat(400), s: T0, e: T0 + H, billed: "no", task: { a: 1 }, tags: ["#a", "A", 5, "b".repeat(99)], m: far, evil: { nested: 1 } },
      { id: "entrun002", p: "", desc: "running in the file", s: T0, e: 0, billed: 0, m: 5 },
      { id: "entbad003", s: T0, e: T0 - 1, m: 5 },
      { id: "entbad004", s: 1, e: 2, m: 5 },
      { id: "entbad005", s: T0, e: T0 + 400 * 24 * H, m: 5 },
      { id: "__proto__", s: T0, e: T0 + H, m: 5 }
    ],
    prefs: { cur: "XXX", rate: "lots" }
  } };
  const res = K.open(D, C.empty(), c);
  const n = res.next;
  assert.deepEqual(res.addedIds.slice().sort(), ["cliok0001", "entok0001", "prjok0001"]);
  const cl = n.clients[0];
  assert.equal(cl.name.length, C.LIM.name);
  assert.ok(!/[\u0000-\u001f]/.test(cl.name));
  assert.equal(cl.rate, 0);
  assert.equal(cl.onclick, undefined);
  assert.ok(cl.m <= Date.now() + K.FUTURE);                                  // stamp clamped
  const pr = n.projects[0];
  assert.deepEqual([pr.client, pr.color, pr.rate, pr.bill, pr.budget], ["", 0, 0, 1, undefined]);
  const en = n.entries[0];
  assert.equal(en.desc.length <= C.LIM.desc, true);
  assert.deepEqual([en.billed, en.task, en.evil], [1, undefined, undefined]);       // any truthy flag → 1
  assert.deepEqual(en.tags, ["a", "b".repeat(C.LIM.tag)]);                   // "#a" and "A" fold, 5 dropped, the long one cut
  assert.ok(en.m <= Date.now() + K.FUTURE);
  assert.ok(!n.entries.some((x) => x.e === 0));                              // a running entry never comes in
  assert.deepEqual(n.prefs, C.DEFAULT_PREFS);                                // the empty device's prefs, not the file's
  assert.equal(D.norm("x"), null);
  assert.equal(D.norm([1]), null);
  // too many records are capped
  const many = D.norm({ entries: Array.from({ length: 10 }, (_, i) => ({ id: "ent" + String(i).padStart(6, "0"), s: T0, e: T0 + H, m: 1 })) });
  assert.equal(many.entries.length, 10);
  assert.ok(P.LIM.entries >= 100000 && P.LIM.clients > 0 && P.LIM.projects > 0);
  // a file of another app is refused, a newer one too
  assert.throws(() => K.open(D, C.empty(), { kind: "oros-todo-package", ver: 1, data: {} }), /notpackage/);
  assert.throws(() => K.open(D, C.empty(), { kind: "oros-timesheet-package", ver: 9, data: {} }), /newer/);
  // an empty file has no preview
  assert.deepEqual(D.previews({ entries: [] }, "en"), {});
});

test("timesheet: wiring (scripts, buttons, Open with, help, file types)", () => {
  const html = read("timesheet/index.html");
  ["../bundle.js?v=2.51.00", "../recordpkg.js?v=2.51.00", "package.js?v=2.51.00", "timesheet.js?v=2.51.00"].forEach((s) =>
    assert.ok(html.includes('src="' + s + '"'), s));
  assert.ok(html.indexOf('src="core.js') < html.indexOf('src="package.js'));
  assert.ok(html.indexOf("recordpkg.js") < html.indexOf('src="timesheet.js'));
  const js = read("timesheet/timesheet.js");
  assert.match(js, /RP\.ui\(TPK\.DESC,/);
  ["o-save", "o-open", "o-folder"].forEach((id) => assert.ok(js.includes('"' + id + '"'), id));
  ["set.osave", "set.oopen", "set.ofolder"].forEach((k) => assert.equal(js.split('"' + k + '"').length - 1, 3, k));   // en, el, button
  assert.ok(js.includes('"set.osave": "orOS file (.oroshours)"'));
  assert.ok(js.includes('"set.osave": "Αρχείο orOS (.oroshours)"'));
  assert.match(js, /if \(t && t\.openFile\) \{ if \(recFile\) recFile\.openTarget\(t\.openFile\); return; \}/);
  assert.match(js, /__orosTakeFile\(/);
  assert.match(js, /window\.__orosOpenAt = openSearchTarget;/);
  assert.equal((js.match(/window\.__orosOpenAt\s*=/g) || []).length, 1);
  assert.match(js, /__orosTakeTarget\("timesheet"\)/);
  for (const f of ["timesheet/help.en.txt", "timesheet/help.el.txt"]) assert.ok(read(f).includes(".oroshours"), f);
  assert.deepEqual(F.appsFor(".oroshours"), ["timesheet"]);
  assert.deepEqual(B.TYPES[".oroshours"], { app: "timesheet", mime: "application/x-oros-hours" });
});
