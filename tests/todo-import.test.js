// To-Do "Import a file" (todo/import.js): detection and mapping of
// Todoist (project CSV + backup ZIP), TickTick backup CSV, Google
// Takeout Tasks.json (through gtasks.js's plan), todo.txt / done.txt,
// iCalendar VTODO and Remember The Milk JSON; the plan (importApply's
// shape): stable ids, re-import adds nothing twice, deleted stays
// deleted, open duplicates skipped, existing lists / labels reused.
// Fixtures follow the documented export shapes; zips are built here
// with atelier/zip.js write().
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const I = require(path.join(ROOT, "todo/import.js"));
const G = require(path.join(ROOT, "todo/gtasks.js"));
const Z = require(path.join(ROOT, "atelier/zip.js"));

const enc = (s) => new TextEncoder().encode(s);
const empty = () => ({ lists: [], labels: [], deleted: {} });
const listOf = (res, name) => res.lists.find((l) => l.name === name);
const add = (pl, text) => pl.items.add.find((x) => x.text === text);
// a state that already holds what a plan adds (as importApply would)
function applied(st, pl) {
  const s = JSON.parse(JSON.stringify(st));
  pl.labels.add.forEach((lb) => s.labels.push({ id: lb.id, name: lb.name }));
  pl.lists.add.forEach((l) => s.lists.push({ id: l.id, name: l.name, items: [] }));
  pl.items.add.forEach((x) => s.lists.find((l) => l.id === x.list).items.push({ id: x.id, text: x.text, done: !!x.done }));
  return s;
}

// ---------- fixtures ----------
const TODOIST =
  "TYPE,CONTENT,DESCRIPTION,PRIORITY,INDENT,AUTHOR,RESPONSIBLE,DATE,DATE_LANG,TIMEZONE,DURATION,DURATION_UNIT\n" +
  "task,Plan trip @travel @fun,Book early,1,1,Ann (1),,2024-03-05,en,Europe/Athens,,\n" +
  "task,Book flights,,4,2,Ann (1),,,en,Europe/Athens,,\n" +
  "task,Seat choice,,4,3,Ann (1),,,en,Europe/Athens,,\n" +
  "note,Check baggage rules,,,,Ann (1),,,,,,\n" +
  ",,,,,,,,,,,\n" +
  "section,Errands,,,,,,,,,,\n" +
  "task,Water plants,,2,1,Ann (1),,every monday,en,Europe/Athens,,\n" +
  "task,\"Email ann@example.com, re: \"\"plan\"\"\",,4,1,Ann (1),,Mar 9 2024,en,,,\n";

const TICK =
  '"Date: 2024-03-01+0000"\n"Version: 7.1"\n"Status: \n0 Normal\n1 Completed\n2 Archived"\n' +
  '"Folder Name","List Name","Title","Kind","Tags","Content","Is Check list","Start Date","Due Date","Reminder","Repeat","Priority","Status","Created Time","Completed Time","Order","Timezone","Is All Day","Is Floating","Column Name","Column Order","View Mode","taskId","parentId"\n' +
  '"Home","Chores","Clean kitchen","CHECKLIST","home, weekly","Wipe tops\n▫Sink\n▪Floor","Y","","2024-03-04T22:00:00+0000","","","5","0","2024-02-01T10:00:00+0000","","-100","Europe/Athens","true","false","Doing","0","kanban","t1",""\n' +
  '"Home","Chores","Fix shelf","TEXT","","","N","","","","RRULE:FREQ=WEEKLY","3","2","2024-02-01T10:00:00+0000","2024-02-03T10:00:00+0000","-50","Europe/Athens","true","false","","","list","t2",""\n' +
  '"Home","Chores","Buy screws","TEXT","","for the shelf","N","","","","","0","0","2024-02-01T10:00:00+0000","","-40","Europe/Athens","true","false","","","list","t3","t1"\n' +
  '"","Work","Report","TEXT","work","","N","","2024-03-10T21:00:00+0000","","","1","0","2024-02-01T10:00:00+0000","","-10","Europe/Athens","true","false","","","list","t4",""\n';

const TAKEOUT = JSON.stringify({
  kind: "tasks#taskLists",
  items: [
    { kind: "tasks#taskList", id: "L1", title: "My Tasks", updated: "2024-01-01T00:00:00Z", items: [
      { kind: "tasks#task", id: "a", title: "Pay rent", notes: "by card", status: "needsAction", due: "2024-04-01T00:00:00.000Z" },
      { kind: "tasks#task", id: "b", title: "Rent receipt", status: "completed", completed: "2024-03-02T10:00:00Z", parent: "a" },
      { kind: "tasks#task", id: "c", title: "Old thing", status: "completed", completed: "2024-01-02T10:00:00Z" }
    ] },
    { kind: "tasks#taskList", id: "L2", title: "Shopping", items: [] }
  ]
});

const TODOTXT =
  "(A) 2024-01-01 Call mom +Family @phone due:2024-02-01\n" +
  "x 2024-01-02 2024-01-01 Pay bills +Home @computer pri:B\n" +
  "Read https://example.com/x +Home +Reading @tablet t:2024-01-05\n" +
  "Loose task\n" +
  "\n";

const ICS =
  "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\nX-WR-CALNAME:Work to-dos\r\n" +
  "BEGIN:VTODO\r\nUID:p1@x\r\nSUMMARY:Write the quarterly\r\n  report\r\nDESCRIPTION:Line one\\nLine two\\, more\r\nDUE;VALUE=DATE:20240315\r\nPRIORITY:1\r\nCATEGORIES:Work,Q1\r\n" +
  "BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:ignored\r\nEND:VALARM\r\nEND:VTODO\r\n" +
  "BEGIN:VTODO\r\nUID:c1@x\r\nSUMMARY:Collect numbers\r\nRELATED-TO:p1@x\r\nSTATUS:COMPLETED\r\nCOMPLETED:20240301T100000Z\r\nEND:VTODO\r\n" +
  "BEGIN:VTODO\r\nUID:x1@x\r\nSUMMARY:Dropped idea\r\nSTATUS:CANCELLED\r\nEND:VTODO\r\n" +
  "BEGIN:VTODO\r\nUID:d1@x\r\nSUMMARY:Medium thing\r\nPRIORITY:5\r\nDUE:20240320T120000\r\nEND:VTODO\r\n" +
  "BEGIN:VEVENT\r\nUID:e1\r\nSUMMARY:Not a task\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

const RTM = JSON.stringify({
  config: {},
  lists: [{ id: "10", name: "Inbox" }, { id: "11", name: "Personal" }],
  tasks: [
    { id: "100", series_id: "s100", list_id: "11", name: "Renew passport", priority: "P1", date_due: Date.UTC(2024, 4, 2, 12), tags: ["admin", "travel"] },
    { id: "101", series_id: "s101", list_id: "11", name: "Photos", parent_id: "100", priority: "PN" },
    { id: "102", series_id: "s102", list_id: "10", name: "Done thing", date_completed: 1704100000000, priority: "P3" },
    { id: "103", series_id: "s103", list_id: "10", name: "Trashed", date_trashed: 1704100000000 }
  ],
  notes: [{ id: "n1", series_id: "s100", title: "Office", content: "Open 9-5" }]
});

// ---------- detection + mapping ----------
test("Todoist project CSV: project → list, indent → subtasks, notes, sections, labels, priority, dates", async () => {
  const res = await I.parse({ name: "Trip [2203306141].csv", bytes: enc(TODOIST) });
  assert.equal(res.source, "todoist");
  assert.equal(res.lists.length, 1);
  assert.equal(res.lists[0].name, "Trip");
  const pl = I.plan(empty(), res, { done: true, section: "Section" });
  assert.equal(pl.lists.add.length, 1);
  assert.equal(pl.items.add.length, 3);
  const trip = add(pl, "Plan trip");
  assert.ok(trip, "labels taken out of the text");
  assert.equal(trip.prio, 1);
  assert.equal(trip.due, "2024-03-05");
  assert.deepEqual(trip.subs.map((s) => s.text), ["Book flights", "Seat choice"]);
  assert.match(trip.notes, /Book early/);
  assert.match(trip.notes, /Check baggage rules/, "the note under the deepest task folds into its top task");
  assert.equal(trip.labels.length, 2);
  assert.deepEqual(pl.labels.add.map((l) => l.name).sort(), ["fun", "travel"]);
  const water = add(pl, "Water plants");
  assert.equal(water.prio, 2);
  assert.equal(water.due, null);
  assert.match(water.notes, /every monday/);
  assert.deepEqual(water.info.map((f) => [f.label, f.value]), [["Section", "Errands"]]);
  assert.equal(pl.rec, 1);
  const mail = add(pl, 'Email ann@example.com, re: "plan"');
  assert.ok(mail, "an e-mail address is not a label");
  assert.equal(mail.due, "2024-03-09");
  assert.equal(mail.prio, 4);
  assert.equal(pl.from, "2024-03-05");
  assert.equal(pl.to, "2024-03-09");
});

test("Todoist backup ZIP: one list per project CSV", async () => {
  const zip = Z.write([
    { name: "Trip [2203306141].csv", data: TODOIST },
    { name: "Inbox [1].csv", data: "TYPE,CONTENT,DESCRIPTION,PRIORITY,INDENT,AUTHOR,RESPONSIBLE,DATE,DATE_LANG,TIMEZONE\ntask,Call bank,,3,1,,,,en,\n" },
    { name: "__MACOSX/._Inbox.csv", data: "junk" }
  ]);
  const res = await I.parse({ name: "backup.zip", bytes: zip });
  assert.equal(res.source, "todoist");
  assert.deepEqual(res.lists.map((l) => l.name).sort(), ["Inbox", "Trip"]);
  const pl = I.plan(empty(), res, { done: true });
  assert.equal(add(pl, "Call bank").prio, 3);
});

test("TickTick backup CSV: preamble, checklist → subtasks, parentId, tags, priority, status", async () => {
  const res = await I.parse({ name: "TickTick-backup.csv", bytes: enc(TICK) });
  assert.equal(res.source, "ticktick");
  assert.deepEqual(res.lists.map((l) => l.name), ["Chores", "Work"]);
  const pl = I.plan(empty(), res, { done: true, section: "Section" });
  const k = add(pl, "Clean kitchen");
  assert.equal(k.prio, 1);
  assert.equal(k.notes.split("\n")[0], "Wipe tops");
  assert.deepEqual(k.subs.map((s) => [s.text, s.done]), [["Sink", false], ["Floor", true], ["Buy screws", false]]);
  assert.match(k.notes, /↳ Buy screws: for the shelf/);
  assert.match(k.due, /^2024-03-0[45]$/);
  assert.equal(k.info[0].value, "Doing");
  assert.equal(k.labels.length, 2);
  const shelf = add(pl, "Fix shelf");
  assert.equal(shelf.done, true);
  assert.equal(shelf.prio, 2);
  assert.equal(pl.rec, 1);
  assert.equal(add(pl, "Report").prio, 3);
  // without completed tasks
  const open = I.plan(empty(), res, { done: false });
  assert.equal(add(open, "Fix shelf"), undefined);
  assert.equal(open.done, 0);
});

test("Google Takeout Tasks.json goes through gtasks.js's plan (same ids as the sign-in import)", async () => {
  const res = await I.parse({ name: "Tasks.json", bytes: enc(TAKEOUT) });
  assert.equal(res.source, "gtasks");
  const pl = I.plan(empty(), res, { done: true });
  const rent = add(pl, "Pay rent");
  assert.equal(rent.id, G.idOf("task", "a"));
  assert.equal(rent.due, "2024-04-01");
  assert.deepEqual(rent.subs.map((s) => [s.text, s.done]), [["Rent receipt", true]]);
  assert.equal(add(pl, "Old thing").done, true);
  assert.equal(pl.lists.add.length, 1, "an empty Google list is not created");
  // inside a Takeout ZIP
  const zip = Z.write([{ name: "Takeout/Tasks/Tasks.json", data: TAKEOUT }, { name: "Takeout/archive_browser.html", data: "<html>" }]);
  const z = await I.parse({ name: "takeout-2024.zip", bytes: zip });
  assert.equal(z.source, "gtasks");
  // what was deleted here stays deleted
  const st = empty();
  st.deleted[G.idOf("task", "c")] = 1;
  const p2 = I.plan(st, res, { done: true });
  assert.equal(add(p2, "Old thing"), undefined);
  assert.equal(p2.gone, 1);
  // not ticked ones only
  assert.equal(add(I.plan(empty(), res, { done: false }), "Old thing"), undefined);
});

test("todo.txt: done, priority, +project → list, @context → labels, due, key:value → notes", async () => {
  const res = await I.parse({ name: "todo.txt", bytes: enc(TODOTXT) });
  assert.equal(res.source, "todotxt");
  assert.deepEqual(res.lists.map((l) => l.name), ["Family", "Home", "todo"]);
  const pl = I.plan(empty(), res, { done: true });
  const call = add(pl, "Call mom");
  assert.equal(call.prio, 1);
  assert.equal(call.due, "2024-02-01");
  assert.deepEqual(pl.labels.add.filter((l) => call.labels.indexOf(l.id) >= 0).map((l) => l.name), ["phone"]);
  const bills = add(pl, "Pay bills");
  assert.equal(bills.done, true);
  assert.equal(bills.prio, 2);
  const read = add(pl, "Read https://example.com/x");
  assert.ok(read, "a URL stays in the text");
  assert.equal(read.notes, "t:2024-01-05");
  assert.equal(read.labels.length, 2, "@tablet and the second +project");
  assert.ok(add(pl, "Loose task"));
  // done.txt with a line already completed: the same id as in todo.txt once ticked there
  const done = await I.parse({ name: "done.txt", bytes: enc("x 2024-02-02 2024-01-01 Call mom +Family @phone due:2024-02-01 pri:A\n") });
  const st = applied(empty(), pl);
  const p2 = I.plan(st, done, { done: true });
  assert.equal(p2.items.add.length, 0);
  assert.equal(p2.same, 1);
});

test("iCalendar VTODO: unfolding, escapes, due, status, priority, RELATED-TO, categories, calendar name", async () => {
  const res = await I.parse({ name: "export.ics", bytes: enc(ICS) });
  assert.equal(res.source, "ics");
  assert.equal(res.lists[0].name, "Work to-dos");
  assert.equal(res.skipped, 1);
  const pl = I.plan(empty(), res, { done: true });
  assert.equal(pl.items.add.length, 2);
  const rep = add(pl, "Write the quarterly report");
  assert.equal(rep.notes.split("\n")[0], "Line one");
  assert.match(rep.notes, /Line two, more/);
  assert.equal(rep.due, "2024-03-15");
  assert.equal(rep.prio, 1);
  assert.deepEqual(rep.subs.map((s) => [s.text, s.done]), [["Collect numbers", true]]);
  assert.deepEqual(pl.labels.add.map((l) => l.name), ["Work", "Q1"]);
  const med = add(pl, "Medium thing");
  assert.equal(med.prio, 2);
  assert.equal(med.due, "2024-03-20");
  // no calendar name → the file name
  const bare = await I.parse({ name: "chores.ics", bytes: enc(ICS.replace("X-WR-CALNAME:Work to-dos\r\n", "")) });
  assert.equal(bare.lists[0].name, "chores");
});

test("Remember The Milk JSON: lists, notes, tags, parent, completed, trashed skipped", async () => {
  const res = await I.parse({ name: "rememberthemilk_export.json", bytes: enc(RTM) });
  assert.equal(res.source, "rtm");
  assert.equal(res.skipped, 1);
  const pl = I.plan(empty(), res, { done: true });
  const pass = add(pl, "Renew passport");
  assert.equal(pass.prio, 1);
  assert.equal(pass.due, "2024-05-02");
  assert.match(pass.notes, /Office\nOpen 9-5/);
  assert.deepEqual(pass.subs.map((s) => s.text), ["Photos"]);
  assert.equal(pass.labels.length, 2);
  const d = add(pl, "Done thing");
  assert.equal(d.done, true);
  assert.equal(d.prio, 3);
  assert.equal(pl.items.add.find((x) => x.text === "Trashed"), undefined);
});

// ---------- the plan: merge rules ----------
test("re-import adds nothing; deleted stays deleted; open duplicates skipped; lists and labels reused by name", async () => {
  const res = await I.parse({ name: "export.ics", bytes: enc(ICS) });
  const pl = I.plan(empty(), res, { done: true });
  pl.items.add.forEach((x) => assert.match(x.id, /^imp-/));
  const st = applied(empty(), pl);
  const again = I.plan(st, res, { done: true });
  assert.equal(again.items.add.length, 0);
  assert.equal(again.lists.add.length, 0);
  assert.equal(again.labels.add.length, 0);
  assert.equal(again.same, 2);
  // the same ids from a second parse
  const res2 = await I.parse({ name: "export.ics", bytes: enc(ICS) });
  assert.deepEqual(I.plan(empty(), res2, { done: true }).items.add.map((x) => x.id), pl.items.add.map((x) => x.id));
  // deleted here
  const st2 = empty();
  st2.deleted[add(pl, "Medium thing").id] = 123;
  const p3 = I.plan(st2, res, { done: true });
  assert.equal(p3.gone, 1);
  assert.equal(add(p3, "Medium thing"), undefined);
  // a list and a label of the same name are used; an open task of the same text is skipped
  const mine = { lists: [{ id: "L-mine", name: "work TO-DOS", items: [{ id: "u1", text: "medium thing", done: false }] }],
                 labels: [{ id: "lb-w", name: "work" }], deleted: {} };
  const p4 = I.plan(mine, res, { done: true });
  assert.equal(p4.lists.add.length, 0);
  assert.equal(p4.here, 1);
  assert.equal(add(p4, "Write the quarterly report").list, "L-mine");
  assert.ok(add(p4, "Write the quarterly report").labels.indexOf("lb-w") >= 0);
  assert.deepEqual(p4.labels.add.map((l) => l.name), ["Q1"]);
  // picking lists
  const tick = await I.parse({ name: "t.csv", bytes: enc(TICK) });
  const p5 = I.plan(empty(), tick, { done: true, pick: { work: true } });
  assert.deepEqual(p5.items.add.map((x) => x.text), ["Report"]);
  assert.equal(p5.per.chores.add, 2);
});

test("unknown or hostile input: null, never throws; text stays text", async () => {
  assert.equal(await I.parse({ name: "x.csv", bytes: enc("a,b,c\n1,2,3\n") }), null);
  assert.equal(await I.parse({ name: "x.json", bytes: enc("{\"foo\":1}") }), null);
  assert.equal(await I.parse({ name: "x.json", bytes: enc("{broken") }), null);
  assert.equal(await I.parse({ name: "x.zip", bytes: Z.write([{ name: "a.bin", data: "hi" }]) }), null);
  assert.equal(await I.parse({ name: "x.zip", bytes: enc("PK\u0003\u0004garbage") }), null);
  assert.equal(await I.parse({ name: "empty.txt", bytes: enc("") }), null);
  const res = await I.parse({ name: "todo.txt", bytes: enc("<img src=x onerror=alert(1)> +<b>list</b>\n" + "y".repeat(2000) + "\n") });
  const pl = I.plan(empty(), res, { done: true });
  assert.equal(pl.items.add[0].text, "<img src=x onerror=alert(1)>");
  assert.equal(pl.lists.add[0].name, "<b>list</b>");
  assert.ok(pl.items.add[1].text.length <= 500);
  // control characters are dropped
  const c = I.parseText("Bad\u0007  task\n", "todo.txt");
  assert.equal(c.lists[0].tasks[0].text, "Bad task");
});
