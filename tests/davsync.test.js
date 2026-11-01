// CalDAV wave 3: davsync.js (the per-link sync engine) with the
// Calendar's mapper (calendar/dav.js), two orOS devices and one fake
// CalDAV server (tests/dav-fake.js). The rules DAV-1..DAV-6 of the
// Bible's Part II "CalDAV / CardDAV W3".
// Run: node --test tests/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const DK = require("../davkit.js");
const DS = require("../davsync.js");
const CD = require("../calendar/dav.js");
const ICS = require("../calendar/ics.js");
const { fakeDav } = require("./dav-fake.js");

const CAL = "https://dav.test/dav/calendars/u/personal/";
const P = "/dav/calendars/u/personal/";
const CONF = DK.normConf({ url: "https://dav.test/dav/", user: "u" });
const LID = "L1";

let clock = Date.UTC(2026, 10, 1, 9, 0);
const tick = () => (clock += 60000);

function ics(uid, summary, extra, lm) {
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Other//EN", "BEGIN:VEVENT", "UID:" + uid,
    "DTSTAMP:20261001T000000Z", "LAST-MODIFIED:" + (lm || "20261001T000000Z"),
    "DTSTART;VALUE=DATE:20261105", "DTEND;VALUE=DATE:20261106", "SUMMARY:" + summary]
    .concat(extra || [], ["END:VEVENT", "END:VCALENDAR", ""]).join("\r\n");
}
function ev(id, title, extra) {
  return Object.assign({ id, date: "2026-11-10", dateEnd: null, start: null, end: null, title, note: "", location: "",
                         labelId: LID, recur: null, remindMin: null, mtime: tick() }, extra || {});
}

// One orOS device: its Calendar events, its own sync state, a pass.
function device(server) {
  const d = { events: [], deleted: [], store: DS.memStore() };
  const map = CD.mapper(CAL, { now: () => clock });
  d.local = () => ({
    items: d.events.filter((e) => e.labelId === LID).map((e) => ({ id: e.id, item: e })),
    find: (id) => d.events.find((e) => e.id === id) || null
  });
  d.apply = (r) => {
    const now = tick();
    for (const it of r.upsert) {
      const e = Object.assign({}, it, { labelId: LID, mtime: now });
      const i = d.events.findIndex((x) => x.id === e.id);
      if (i >= 0) d.events[i] = e; else d.events.push(e);
      d.deleted = d.deleted.filter((t) => t.id !== e.id);
    }
    for (const id of r.remove) {
      d.events = d.events.filter((x) => x.id !== id);
      d.deleted.push({ id, mtime: now });
    }
  };
  d.pass = async (o) => {
    const st = await d.store.get("cal");
    return DS.sync(Object.assign({ client: DK.client(CONF, "p", server.fetch), url: CAL, readOnly: false, state: st, map }, o || {}),
      d.local, d.apply, (s) => d.store.set("cal", s));
  };
  d.preview = () => DS.run({ client: DK.client(CONF, "p", server.fetch), url: CAL, state: null, local: d.local(), map, dry: true });
  d.get = (id) => d.events.find((e) => e.id === id);
  return d;
}
// orOS sync between two devices (the Calendar's merge, in short:
// newer wins per id, a tombstone wins its tie).
function orosSync(a, b) {
  const by = {}, tomb = {};
  for (const e of a.events.concat(b.events)) if (!by[e.id] || e.mtime > by[e.id].mtime) by[e.id] = e;
  for (const t of a.deleted.concat(b.deleted)) if (!tomb[t.id] || t.mtime > tomb[t.id].mtime) tomb[t.id] = t;
  const events = Object.values(by).filter((e) => !(tomb[e.id] && tomb[e.id].mtime >= e.mtime));
  const deleted = Object.values(tomb).filter((t) => !events.some((e) => e.id === t.id));
  for (const d of [a, b]) { d.events = events.map((e) => Object.assign({}, e)); d.deleted = deleted.slice(); }
}
const writes = (S) => S.log.filter((l) => /^(PUT|DELETE) /.test(l));
const onServer = (S) => Object.keys(S.items).filter((p) => p.indexOf(P) === 0);

test("first link: the preview counts before anything is written, then events go both ways, an imported copy is bound", async () => {
  const S = fakeDav();
  S.put(P + "a.ics", ics("a@other", "Server only"));
  S.put(P + "b.ics", ics("b@other", "Imported before"));
  const A = device(S);
  A.events.push(ev("mine1", "Made in orOS"));
  // The same event imported from an .ics file earlier, in another label.
  A.events.push(ev(ICS.hashId("b@other"), "Imported before", { date: "2026-11-05", labelId: "other" }));
  const before = writes(S).length;
  const pv = await A.preview();
  assert.deepEqual([pv.stats.down, pv.stats.up, pv.stats.same], [1, 1, 1]);
  assert.equal(pv.state, null);
  assert.equal(writes(S).length, before, "the preview writes nothing");

  const r = await A.pass();
  assert.equal(r.retry, false);
  assert.equal(onServer(S).length, 3);
  assert.match(S.items[P + "mine1.ics"].data, /UID:mine1@oros\.calendar/);
  const down = A.events.find((e) => e.title === "Server only");
  assert.match(down.id, /^dav-/);
  const bound = A.get(ICS.hashId("b@other"));
  assert.equal(bound.labelId, LID, "the imported copy moved into the linked label, not doubled");
  assert.equal(A.events.filter((e) => e.title === "Imported before").length, 1);
});

test("DAV-6: a pass with no change writes nothing; an edit here is a conditional PUT, an edit there comes down", async () => {
  const S = fakeDav();
  S.put(P + "a.ics", ics("a@other", "Lunch", ["ATTENDEE:mailto:bob@example.com", "X-KEEP:1"]));
  const A = device(S);
  await A.pass();
  const n = writes(S).length;
  for (let i = 0; i < 3; i++) {
    const r = await A.pass();
    assert.deepEqual([r.upsert.length, r.remove.length], [0, 0]);
  }
  assert.equal(writes(S).length, n, "nothing written by passes that changed nothing");

  const e = A.events[0];
  e.title = "Lunch with Bob";
  e.mtime = tick();
  const etag = S.items[P + "a.ics"].etag;
  await A.pass();
  const text = S.items[P + "a.ics"].data;
  assert.match(text, /SUMMARY:Lunch with Bob/);
  assert.match(text, /ATTENDEE:mailto:bob@example.com/);
  assert.match(text, /X-KEEP:1/);
  assert.notEqual(S.items[P + "a.ics"].etag, etag);
  assert.equal(writes(S).length, n + 1);

  S.put(P + "a.ics", ics("a@other", "Lunch moved", [], "20261102T000000Z"));
  await A.pass();
  assert.equal(A.events[0].title, "Lunch moved");
  assert.equal(writes(S).length, n + 1, "orOS wrote nothing back (S.put is the other client, not logged)");
});

test("DAV-1 / DAV-2: deletions with a base; a copy changed since is uploaded again; a refused DELETE brings it back", async () => {
  const S = fakeDav();
  for (const k of ["a", "b", "c", "d", "e", "f"]) S.put(P + k + ".ics", ics(k + "@other", "Ev " + k));
  const A = device(S);
  await A.pass();
  assert.equal(A.events.length, 6);
  const id = (t) => A.events.find((e) => e.title === t).id;

  // Deleted here → DELETE If-Match.
  const ia = id("Ev a");
  A.events = A.events.filter((e) => e.id !== ia);
  await A.pass();
  assert.ok(!S.items[P + "a.ics"]);

  // Deleted there, unchanged here → removed here.
  S.remove(P + "b.ics");
  const ib = id("Ev b");
  await A.pass();
  assert.ok(!A.get(ib));

  // Deleted there, changed here since → uploaded again (local wins).
  const ic = id("Ev c");
  A.get(ic).title = "Ev c, changed";
  A.get(ic).mtime = tick();
  S.remove(P + "c.ics");
  await A.pass();
  assert.ok(A.get(ic));
  assert.ok(Object.values(S.items).some((x) => /SUMMARY:Ev c\\, changed/.test(x.data)));

  // Deleted here while changed there → the DELETE is refused, it comes back.
  const idd = id("Ev d");
  A.events = A.events.filter((e) => e.id !== idd);
  const st = await A.store.get("cal");                // this device's base, before the outside change
  S.put(P + "d.ics", ics("d@other", "Ev d, changed there", [], "20261103T000000Z"));
  // A pass that does not hear about the change first (its listing is
  // older): the DELETE If-Match is refused (412), the engine reads again.
  const real = DK.client(CONF, "p", S.fetch);
  let stale = true;
  const cl = Object.assign({}, real, { syncCollection: (u, t) => {
    if (stale) { stale = false; return Promise.resolve({ token: t, changed: [], removed: [] }); }
    return real.syncCollection(u, t);
  } });
  const dels = S.log.filter((l) => l.startsWith("DELETE")).length;
  const r = await DS.sync({ client: cl, url: CAL, readOnly: false, state: st, map: CD.mapper(CAL, { now: () => clock }) },
    A.local, A.apply, (s) => A.store.set("cal", s));
  assert.equal(S.log.filter((l) => l.startsWith("DELETE")).length, dels + 1, "one DELETE tried");
  assert.ok(S.items[P + "d.ics"], "nothing deleted there");
  assert.equal(A.get(idd).title, "Ev d, changed there");
  assert.equal(r.retry, false);
});

test("DAV-3: an empty listing deletes nothing; many deletions wait for the person, then go or come back", async () => {
  const S = fakeDav({ noSyncToken: true });
  for (let i = 0; i < 10; i++) S.put(P + "e" + i + ".ics", ics("e" + i + "@other", "Ev " + i));
  const A = device(S);
  await A.pass();
  assert.equal(A.events.length, 10);
  for (let i = 0; i < 10; i++) S.remove(P + "e" + i + ".ics");
  await A.pass();
  assert.equal(A.events.length, 10, "an empty calendar there deletes nothing here");
  for (let i = 0; i < 10; i++) S.put(P + "e" + i + ".ics", ics("e" + i + "@other", "Ev " + i));

  const T = fakeDav();
  for (let i = 0; i < 10; i++) T.put(P + "e" + i + ".ics", ics("e" + i + "@other", "Ev " + i));
  const B = device(T);
  await B.pass();
  const gone = B.events.slice(0, 6).map((e) => e);
  B.events = B.events.slice(6);
  const held = await B.pass();
  assert.deepEqual(held.held, { local: 0, server: 6 });
  assert.equal(onServer(T).length, 10, "nothing deleted while it waits");
  const again = await B.pass();
  assert.ok(again.held, "still waiting");
  const back = await B.pass({ decision: "restore" });
  assert.equal(back.held, null);
  assert.equal(B.events.length, 10, "brought back");
  assert.ok(gone.every((g) => B.get(g.id)));
  B.events = B.events.slice(6);
  await B.pass();
  const ok = await B.pass({ decision: "allow" });
  assert.equal(ok.stats.delServer, 6);
  assert.equal(onServer(T).length, 4);
});

test("both changed: the newer wins and the other is kept as a (conflict) copy, which then goes up too", async () => {
  const S = fakeDav();
  S.put(P + "a.ics", ics("a@other", "Plan"));
  const A = device(S);
  await A.pass();
  const e = A.events[0];
  // There first (older), here later (newer): here wins.
  S.put(P + "a.ics", ics("a@other", "Plan there", [], "20261101T090500Z"));
  e.title = "Plan here";
  e.mtime = Date.UTC(2026, 10, 1, 10, 0);
  clock = Date.UTC(2026, 10, 1, 10, 1);
  const r = await A.pass();
  assert.equal(r.stats.conflicts, 1);
  assert.match(S.items[P + "a.ics"].data, /SUMMARY:Plan here/);
  const copy = A.events.find((x) => x.title === "Plan there (conflict)");
  assert.ok(copy, "the server's version kept as a copy");
  assert.ok(Object.values(S.items).some((x) => /SUMMARY:Plan there \(conflict\)/.test(x.data)), "the copy uploaded");

  // Here first (older), there later (newer): there wins.
  const e2 = A.get(e.id);
  e2.title = "Plan here again";
  e2.mtime = Date.UTC(2026, 10, 1, 10, 5);
  S.put(P + "a.ics", ics("a@other", "Plan there again", [], "20261101T110000Z"));
  clock = Date.UTC(2026, 10, 1, 11, 1);
  await A.pass();
  assert.equal(A.get(e.id).title, "Plan there again");
  assert.ok(A.events.some((x) => x.title === "Plan here again (conflict)"));
});

test("two orOS devices, one server: the same id everywhere, a create race ends in one item, nothing doubles", async () => {
  const S = fakeDav();
  S.put(P + "a.ics", ics("a@other", "From the phone"));
  const A = device(S), B = device(S);
  await A.pass();
  orosSync(A, B);
  const n0 = writes(S).length;
  await B.pass();                                    // B's first pass: everything already here
  assert.equal(writes(S).length, n0, "B wrote nothing");
  assert.equal(B.events.length, 1);

  // The same new orOS event reaches both devices before either uploads.
  A.events.push(ev("new1", "New in orOS"));
  orosSync(A, B);
  await A.pass();
  const r = await B.pass();                           // If-None-Match: * → 412 → read it again
  assert.equal(onServer(S).filter((p) => /new1/.test(p)).length, 1);
  assert.equal(B.events.filter((e) => e.title === "New in orOS").length, 1);
  assert.ok(r.stats);

  // Changed on the phone; A brings it down, orOS sync carries it to B
  // before B's own pass: B is in step, no conflict copy, no write.
  await B.pass();
  S.put(P + "a.ics", ics("a@other", "From the phone, edited", [], "20261101T080000Z"));
  await A.pass();
  orosSync(A, B);
  const w0 = writes(S).length;
  const rb = await B.pass();
  assert.equal(rb.stats.conflicts, 0);
  assert.equal(writes(S).length, w0);
  assert.equal(B.events.filter((e) => /From the phone/.test(e.title)).length, 1);

  // A server item reaches B by orOS sync before B saw it on the server:
  // the full listing binds it (same dav- id), no second upload.
  S.put(P + "z.ics", ics("z@other", "Zed"));
  await A.pass();
  orosSync(A, B);
  const before = writes(S).length;
  await B.pass();
  assert.equal(writes(S).length, before);
  assert.equal(B.events.filter((e) => e.title === "Zed").length, 1);
});

test("read-only: an item orOS cannot show exactly and a read-only calendar — the server wins, nothing goes up", async () => {
  const S = fakeDav();
  S.put(P + "r.ics", ics("r@other", "Odd repeat", ["RRULE:FREQ=MONTHLY;BYMONTHDAY=1,15"]));
  S.put(P + "s.ics", ics("s@other", "Weekly", ["RRULE:FREQ=WEEKLY"]).replace("END:VCALENDAR",
    ["BEGIN:VEVENT", "UID:s@other", "RECURRENCE-ID;VALUE=DATE:20261112", "DTSTART;VALUE=DATE:20261113", "SUMMARY:Weekly, moved",
     "END:VEVENT", "END:VCALENDAR"].join("\r\n")));
  S.put(P + "t.ics", ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VTODO", "UID:t@other", "SUMMARY:A task", "END:VTODO", "END:VCALENDAR", ""].join("\r\n"));
  const A = device(S);
  const r = await A.pass();
  assert.equal(A.events.length, 3, "the odd repeat, the series and its moved occurrence; the task is not an event");
  const odd = A.events.find((e) => e.title === "Odd repeat");
  assert.ok(r.ro[odd.id]);
  const moved = A.events.find((e) => e.title === "Weekly, moved");
  assert.ok(r.ro[moved.id]);
  const n = writes(S).length;
  odd.title = "Changed here";
  odd.mtime = tick();
  A.events = A.events.filter((e) => e !== moved);
  await A.pass();
  assert.equal(writes(S).length, n, "nothing written");
  assert.equal(A.events.find((e) => e.id === odd.id).title, "Odd repeat", "the server wins");
  assert.ok(A.events.some((e) => e.title === "Weekly, moved"), "the occurrence comes back");
  assert.match(S.items[P + "t.ics"].data, /A task/, "the task untouched");

  const R = fakeDav();
  R.put(P + "a.ics", ics("a@other", "Shared"));
  const B = device(R);
  B.events.push(ev("loc", "Only here"));
  await B.pass({ readOnly: true });
  const m = writes(R).length;
  B.events.find((e) => e.title === "Shared").title = "Edited";
  await B.pass({ readOnly: true });
  B.events = B.events.filter((e) => e.title !== "Shared");
  await B.pass({ readOnly: true });
  assert.equal(writes(R).length, m, "a read-only calendar is never written");
  assert.ok(B.events.some((e) => e.title === "Shared"));
  assert.ok(B.events.some((e) => e.title === "Only here"));
});
