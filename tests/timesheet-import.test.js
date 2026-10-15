// Timesheet "Import from another app" (timesheet/import.js): Kimai
// (CSV and .xlsx), Jira Tempo worklogs CSV, an .xlsx Toggl export
// handed on to the Wave 5 importer, stable ids (same file twice adds
// nothing), the user filter, and Undo (tombstones that win on every
// device). Fixtures follow the documented export shapes.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const I = require(path.join(ROOT, "timesheet/import.js"));
const C = require(path.join(ROOT, "timesheet/core.js"));
const X = require(path.join(ROOT, "vendor/xlsx.full.min.js"));

const enc = (s) => new TextEncoder().encode(s);
const read = (s) => I.readBytes(enc(s), "f.csv");
const at = (y, m, d, h, mi) => new Date(y, m - 1, d, h, mi || 0).getTime();

const KIMAI =
  "Date,From,To,Duration,Currency,Rate,Hourly rate,User,Customer,Project,Activity,Description,Exported,Billable,Tags\n" +
  "15.03.2024,09:00,10:30,1:30,EUR,120,80,anna,Acme Ltd,Website,Development,Header fix,no,yes,\"web, urgent\"\n" +
  "15.03.2024,23:00,01:00,2:00,EUR,160,80,anna,Acme Ltd,Website,Support,Night deploy,yes,yes,\n" +
  "16.03.2024,10:00,11:00,1:00,EUR,0,0,bob,,Internal,Meeting,,no,no,\n" +
  "bad,10:00,11:00,1:00,EUR,0,0,bob,,Internal,Meeting,,no,no,\n";

const TEMPO =
  "Issue Key,Issue summary,Hours,Work date,Username,Full name,Period,Account Key,Account Name,Account Customer,Project Key,Project Name,Work Description,Billed Hours\n" +
  "WEB-12,Login page,2.5,2024-03-05 00:00,jdoe,Jane Doe,Mar,ACC,Acme,Acme Ltd,WEB,Website,Styled the form,2.5\n" +
  "WEB-13,Logout,1,2024-03-05 00:00,jdoe,Jane Doe,Mar,ACC,Acme,Acme Ltd,WEB,Website,,0\n" +
  "OPS-1,Backups,0.5,05/Mar/24 2:15 PM,jdoe,Jane Doe,Mar,,,,OPS,Ops,Checked,\n";

const empty = () => C.empty();

test("Kimai CSV: times, overnight, client / project / task, rate, tags", async () => {
  const r = await read(KIMAI);
  const p = I.planAny(r, empty(), "dmy", "");
  assert.equal(p.source, "kimai");
  assert.equal(p.fresh, 3);
  assert.equal(p.bad, 1);
  assert.deepEqual(p.users, ["anna", "bob"]);
  assert.equal(p.from, "2024-03-15");
  assert.equal(p.to, "2024-03-16");
  const [a, b] = p.add.entries;
  assert.equal(a.s, at(2024, 3, 15, 9));
  assert.equal(a.e, at(2024, 3, 15, 10, 30));
  assert.equal(a.task, "Development");
  assert.equal(a.desc, "Header fix");
  assert.deepEqual(a.tags, ["web", "urgent"]);
  assert.equal(b.e, at(2024, 3, 16, 1), "past midnight");
  assert.equal(b.billed, 1);
  const web = p.add.projects.find((x) => x.name === "Website");
  assert.equal(web.rate, 8000);
  assert.equal(web.bill, 1);
  assert.equal(p.add.clients[0].name, "Acme Ltd");
  assert.equal(p.add.projects.find((x) => x.name === "Internal").bill, 0);
  assert.ok(p.add.entries.every((x) => C.ID_RE.test(x.id)));
});

test("Kimai: one user only; merge, then the same file adds nothing", async () => {
  const r = await read(KIMAI);
  const only = I.planAny(r, empty(), "dmy", "bob");
  assert.equal(only.fresh, 1);
  assert.equal(only.other, 2);
  const all = I.planAny(r, empty(), "dmy", "");
  const d1 = C.mergeTimesheet(empty(), all.add);
  assert.equal(C.live(d1.entries).length, 3);
  const again = I.planAny(r, d1, "dmy", "");
  assert.equal(again.fresh, 0);
  assert.equal(again.dup, 3);
});

test("Kimai .xlsx through SheetJS (dates and times as cells)", async () => {
  const aoa = [["Date", "From", "To", "Duration", "Customer", "Project", "Activity", "Description", "User"],
    [new Date(2024, 2, 15), "09:00", "10:30", 1.5, "Acme Ltd", "Website", "Development", "Header", "anna"]];
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(aoa, { cellDates: true }), "Export");
  const bytes = new Uint8Array(X.write(wb, { type: "array", bookType: "xlsx" }));
  let asked = 0;
  const r = await I.readBytes(bytes, "kimai.xlsx", () => { asked++; return Promise.resolve(X); });
  assert.equal(asked, 1);
  const p = I.planAny(r, empty(), "dmy", "");
  assert.equal(p.source, "kimai");
  assert.equal(p.add.entries[0].s, at(2024, 3, 15, 9));
  assert.equal(p.add.entries[0].e, at(2024, 3, 15, 10, 30));
  assert.deepEqual(await I.readBytes(bytes, "k.xlsx", () => Promise.reject(new Error("x"))), { error: "lib" });
});

test("Tempo worklogs: bare days laid from 09:00, a time kept, task = key + summary", async () => {
  const p = I.planAny(await read(TEMPO), empty(), "mdy", "");
  assert.equal(p.source, "tempo");
  assert.equal(p.fresh, 3);
  const [a, b, c] = p.add.entries;
  assert.equal(a.s, at(2024, 3, 5, 9));
  assert.equal(a.e, at(2024, 3, 5, 11, 30));
  assert.equal(b.s, at(2024, 3, 5, 11, 30), "the day's second row follows the first");
  assert.equal(c.s, at(2024, 3, 5, 14, 15));
  assert.equal(c.e, at(2024, 3, 5, 14, 45));
  assert.equal(a.task, "WEB-12 Login page");
  assert.equal(a.desc, "Styled the form");
  const web = p.add.projects.find((x) => x.name === "Website");
  assert.equal(web.bill, 1);
  assert.equal(p.add.clients.length, 1);
  assert.equal(p.add.projects.find((x) => x.name === "Ops").client, "");
  assert.deepEqual(p.users, ["Jane Doe"]);
});

test("an Excel Toggl export goes on to the Wave 5 importer", async () => {
  const aoa = [["User", "Email", "Client", "Project", "Task", "Description", "Billable", "Start date", "Start time", "End date", "End time", "Duration", "Tags"],
    ["Ann", "a@x.io", "Acme", "Site", "", "Copy", "Yes", new Date(2024, 2, 5), "09:00:00", new Date(2024, 2, 5), "10:00:00", "01:00:00", ""]];
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(aoa, { cellDates: true }), "Report");
  const r = await I.readBytes(new Uint8Array(X.write(wb, { type: "array", bookType: "xlsx" })), "t.xlsx", () => Promise.resolve(X));
  const p = I.planAny(r, empty(), "dmy", "");
  assert.equal(p.source, "toggl");
  assert.equal(p.fresh, 1);
  assert.equal(p.add.entries[0].s, at(2024, 3, 5, 9));
  // and a plain CSV that is none of them: null
  assert.equal(I.planAny(await read("a,b\n1,2\n"), empty(), "dmy", ""), null);
});

test("undo: tombstones newer than the rows, kept by every device's merge", async () => {
  const p = I.planAny(await read(KIMAI), empty(), "dmy", "");
  const d0 = empty();
  d0.projects.push({ id: "own0000001", name: "Mine", client: "", color: 0, rate: 0, bill: 0, arch: 0, m: 5 });
  d0.entries.push({ id: "own0000002", p: "own0000001", desc: "", s: at(2024, 3, 1, 9), e: at(2024, 3, 1, 10), billed: 0, m: 5 });
  const d1 = C.mergeTimesheet(d0, p.add);
  const info = I.undoInfo(p);
  const d2 = I.undo(d1, info, Date.now());
  assert.deepEqual(C.live(d2.entries).map((x) => x.id), ["own0000002"]);
  assert.deepEqual(C.live(d2.projects).map((x) => x.id), ["own0000001"]);
  assert.equal(C.live(d2.clients).length, 0);
  // a device that still has the import: the tombstones win
  const m = C.mergeTimesheet(d1, d2);
  assert.equal(C.live(m.entries).length, 1);
  assert.equal(JSON.stringify(C.mergeTimesheet(d2, d1)), JSON.stringify(m));
});

test("date and time helpers", () => {
  assert.deepEqual(I.dayParts("05/Mar/24"), [2024, 3, 5]);
  assert.deepEqual(I.dayParts("03/05/2024", "mdy"), [2024, 3, 5]);
  assert.deepEqual(I.dayParts(45356), [2024, 3, 5]);
  assert.deepEqual(I.timeParts("9:05 PM"), [21, 5, 0]);
  assert.deepEqual(I.timeParts(0.375), [9, 0, 0]);
  assert.equal(I.timeParts("2024-03-05"), null);
  assert.equal(I.hoursOf("1:45"), 1.75);
  assert.equal(I.hoursOf("1,5"), 1.5);
});
