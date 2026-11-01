// CalDAV wave 5: davsync.js with the To-Do mapper (todo/dav.js), two
// orOS devices and one fake CalDAV server (tests/dav-fake.js). Tasks
// and subtasks go both ways (a subtask is a server task whose
// RELATED-TO names its task); what orOS does not model survives every
// write; DAV-1..DAV-6 as for the Calendar.
// Run: node --test tests/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const DK = require("../davkit.js");
const DS = require("../davsync.js");
const TD = require("../todo/dav.js");
const { fakeDav } = require("./dav-fake.js");

const COL = "https://dav.test/dav/calendars/u/personal/";
const P = "/dav/calendars/u/personal/";
const CONF = DK.normConf({ url: "https://dav.test/dav/", user: "u" });

let clock = Date.UTC(2026, 10, 1, 9, 0);
const tick = () => (clock += 60000);

function vtodo(uid, summary, extra) {
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Other//EN", "BEGIN:VTODO", "UID:" + uid,
    "DTSTAMP:20261001T000000Z", "LAST-MODIFIED:20261001T000000Z", "SUMMARY:" + summary]
    .concat(extra || [], ["END:VTODO", "END:VCALENDAR", ""]).join("\r\n");
}
function task(id, text, extra) {
  return Object.assign({ id, text, notes: "", due: null, prio: 4, done: false, rec: null, cats: [], subs: [], mtime: tick() },
                       extra || {});
}

// One orOS device with one linked list: the same steps as todo.js
// tdLocal / tdApply, in short.
function device(server) {
  const d = { tasks: [], tomb: {}, store: DS.memStore(), uids: {} };
  const map = TD.mapper(COL, { now: () => clock });
  const uidOf = (id) => d.uids[id] || id + "@oros.todo";
  const keep = (st) => {
    d.uids = {};
    if (st) for (const k of Object.keys(st.items)) d.uids[st.items[k].id] = TD.uidOf(st.raw[k]);
  };
  d.local = () => {
    const items = [];
    for (const t of d.tasks) {
      items.push({ id: t.id, item: Object.assign({}, t, { sub: false }) });
      for (const s of t.subs) {
        items.push({ id: s.id, item: { id: s.id, text: s.text, notes: "", due: null, prio: 4, done: s.done, rec: null,
                                       cats: [], sub: true, parent: t.id, puid: uidOf(t.id), mtime: s.mtime } });
      }
    }
    return { items, find: () => null };
  };
  const subOf = (id) => {
    for (const t of d.tasks) { const s = t.subs.find((x) => x.id === id); if (s) return { t, s }; }
    return null;
  };
  d.apply = (r) => {
    keep(r.state);
    const byUid = {};
    for (const id of Object.keys(d.uids)) byUid[d.uids[id]] = id;
    const now = tick();
    const put = (x) => {
      const h = subOf(x.id);
      if (h) h.t.subs = h.t.subs.filter((s) => s !== h.s);
      const cur = d.get(x.id);
      const fields = { text: x.text, notes: x.notes, due: x.due, prio: x.prio, done: x.done, rec: x.rec, cats: x.cats.slice() };
      if (cur) Object.assign(cur, fields, { mtime: now });
      else d.tasks.push(Object.assign({ id: x.id, subs: [], mtime: now }, fields));
    };
    const subs = [];
    for (const x of r.upsert) { if (x.sub) subs.push(x); else put(x); }
    for (const x of subs) {
      const pid = x.parent || byUid[x.puid] || TD.parentId(COL, x.puid);
      const parent = d.get(pid);
      if (!parent) { put(x); continue; }
      const h = subOf(x.id);
      if (h) { Object.assign(h.s, { text: x.text, done: x.done, mtime: now }); continue; }
      d.tasks = d.tasks.filter((t) => t.id !== x.id);
      parent.subs.push({ id: x.id, text: x.text, done: x.done, mtime: now });
    }
    for (const id of r.remove) {
      const t = d.get(id);
      if (t) { d.tasks = d.tasks.filter((y) => y !== t); d.tomb[id] = now; continue; }
      const h = subOf(id);
      if (h) { h.t.subs = h.t.subs.filter((s) => s !== h.s); d.tomb[id] = now; }
    }
  };
  d.pass = async (o) => {
    const st = await d.store.get("todo");
    keep(st);
    return DS.sync(Object.assign({ client: DK.client(CONF, "p", server.fetch), url: COL, readOnly: false, state: st, map }, o || {}),
      d.local, d.apply, (s) => { keep(s); return d.store.set("todo", s); });
  };
  d.preview = () => DS.run({ client: DK.client(CONF, "p", server.fetch), url: COL, state: null, local: d.local(), map, dry: true });
  d.get = (id) => d.tasks.find((t) => t.id === id);
  return d;
}
function orosSync(a, b) {
  const by = {};
  for (const t of a.tasks.concat(b.tasks)) if (!by[t.id] || t.mtime > by[t.id].mtime) by[t.id] = t;
  const tomb = Object.assign({}, a.tomb, b.tomb);
  const tasks = Object.values(by).filter((t) => !(tomb[t.id] && tomb[t.id] >= t.mtime));
  for (const d of [a, b]) { d.tasks = JSON.parse(JSON.stringify(tasks)); d.tomb = Object.assign({}, tomb); }
}
const writes = (S) => S.log.filter((l) => /^(PUT|DELETE) /.test(l));
const onServer = (S) => Object.keys(S.items).filter((p) => p.indexOf(P) === 0);

test("first link: preview first; server tasks and their subtasks come down, ours go up with RELATED-TO", async () => {
  const S = fakeDav();
  S.put(P + "a.ics", vtodo("srv-a", "Groceries", ["PRIORITY:1", "CATEGORIES:Home", "X-APPLE-SORT-ORDER:3",
    "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT10M", "END:VALARM"]));
  S.put(P + "b.ics", vtodo("srv-b", "Milk", ["RELATED-TO;RELTYPE=PARENT:srv-a"]));
  S.put(P + "c.ics", vtodo("srv-c", "Bread", ["RELATED-TO:srv-a", "DUE;VALUE=DATE:20261105"]));
  S.put(P + "e.ics", ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", "UID:ev", "DTSTART;VALUE=DATE:20261105",
    "SUMMARY:An event", "END:VEVENT", "END:VCALENDAR", ""].join("\r\n"));
  const A = device(S);
  A.tasks.push(task("t1", "Pack", { due: "2026-11-07", subs: [{ id: "s1", text: "Passport", done: false, mtime: tick() }] }));
  const before = writes(S).length;
  const pv = await A.preview();
  assert.deepEqual([pv.stats.down, pv.stats.up, pv.stats.same], [3, 2, 0]);
  assert.equal(writes(S).length, before, "the preview writes nothing");

  await A.pass();
  const g = A.tasks.find((t) => t.text === "Groceries");
  assert.ok(g, "the server task came down");
  assert.deepEqual([g.prio, g.cats], [1, ["Home"]]);
  assert.deepEqual(g.subs.map((s) => s.text), ["Milk"], "a plain child is a subtask");
  assert.ok(A.tasks.find((t) => t.text === "Bread" && t.due === "2026-11-05"), "a child with a date is a task here");
  assert.ok(!A.tasks.some((t) => t.text === "An event"), "events are not tasks");
  assert.equal(onServer(S).length, 6);
  assert.match(S.items[P + "t1.ics"].data, /UID:t1@oros\.todo[\s\S]*DUE;VALUE=DATE:20261107/);
  assert.match(S.items[P + "s1.ics"].data, /RELATED-TO;RELTYPE=PARENT:t1@oros\.todo/);
  // DAV-6: nothing changed → nothing written.
  const n = writes(S).length;
  for (let i = 0; i < 3; i++) await A.pass();
  assert.equal(writes(S).length, n);
  // Ticking the server's task here patches only its status.
  g.done = true; g.mtime = tick();
  await A.pass();
  const text = S.items[P + "a.ics"].data;
  for (const keep of ["PRIORITY:1", "CATEGORIES:Home", "X-APPLE-SORT-ORDER:3", "TRIGGER:-PT10M", "STATUS:COMPLETED"]) {
    assert.ok(text.includes(keep), keep);
  }
  assert.equal(writes(S).length, n + 1);
});

test("subtasks both ways: a new one here goes up under its task, one ticked there comes down", async () => {
  const S = fakeDav();
  S.put(P + "a.ics", vtodo("srv-a", "Trip"));
  const A = device(S);
  await A.pass();
  const trip = A.tasks[0];
  trip.subs.push({ id: "s9", text: "Tickets", done: false, mtime: tick() });
  await A.pass();
  assert.match(S.items[P + "s9.ics"].data, /RELATED-TO;RELTYPE=PARENT:srv-a/);
  // Ticked on the phone (another client).
  S.put(P + "s9.ics", S.items[P + "s9.ics"].data.replace("STATUS:NEEDS-ACTION", "STATUS:COMPLETED"));
  await A.pass();
  assert.equal(A.get(trip.id).subs[0].done, true);
  // Deleted on the phone: gone here too (it was in sync).
  S.remove(P + "s9.ics");
  await A.pass();
  assert.equal(A.get(trip.id).subs.length, 0);
});

test("two devices: the second binds to what the first uploaded, nothing doubles, nothing is written", async () => {
  const S = fakeDav();
  const A = device(S), B = device(S);
  A.tasks.push(task("t1", "Call the bank", { subs: [{ id: "s1", text: "Find the card", done: false, mtime: tick() }] }));
  await A.pass();
  orosSync(A, B);
  const n = writes(S).length;
  await B.pass();
  assert.equal(B.tasks.length, 1);
  assert.equal(B.tasks[0].subs.length, 1);
  assert.equal(writes(S).length, n);
  B.tasks[0].notes = "from B"; B.tasks[0].mtime = tick();
  await B.pass();
  orosSync(A, B);
  const r = await A.pass();
  assert.equal(r.stats.conflicts, 0, "the same change both ways is not a conflict");
  assert.equal(A.tasks[0].notes, "from B");
});

test("both changed: the newer wins and the other stays as a (conflict) copy", async () => {
  const S = fakeDav();
  S.put(P + "a.ics", vtodo("srv-a", "Book the dentist"));
  const A = device(S);
  await A.pass();
  const t = A.tasks[0];
  // There first, then here (here is newer).
  S.put(P + "a.ics", vtodo("srv-a", "Book the dentist for Monday", ["LAST-MODIFIED:20261101T090000Z"]));
  t.text = "Book the dentist (call)"; t.mtime = Date.UTC(2026, 11, 1);
  await A.pass();
  assert.ok(A.tasks.some((x) => x.text === "Book the dentist for Monday (conflict)"));
  assert.ok(S.items[P + "a.ics"].data.includes("SUMMARY:Book the dentist (call)"));
  assert.equal(onServer(S).length, 2, "the copy went up as a task of its own");
});

test("deletions: here → DELETE If-Match; there → removed here; many at once wait (DAV-3)", async () => {
  const S = fakeDav();
  for (let i = 0; i < 8; i++) S.put(P + "p" + i + ".ics", vtodo("p" + i, "Task " + i));
  const A = device(S);
  await A.pass();
  assert.equal(A.tasks.length, 8);
  A.tasks = A.tasks.filter((t) => t.text !== "Task 0");
  await A.pass();
  assert.equal(onServer(S).length, 7);
  S.remove(P + "p1.ics");
  await A.pass();
  assert.equal(A.tasks.length, 6);
  for (const k of ["p2", "p3", "p4", "p5", "p6"]) S.remove(P + k + ".ics");
  const h = await A.pass();
  assert.deepEqual(h.held, { local: 5, server: 0 });
  assert.equal(A.tasks.length, 6);
  await A.pass({ decision: "restore" });
  assert.equal(onServer(S).length, 6, "brought back to the server");
});
