// CalDAV wave 6: round trips against a REAL DAV server (Radicale), in
// CI (quality.yml job "radicale"). The unit tests use tests/dav-fake.js;
// this checks the same code against a server orOS did not write:
// discovery and the probe (davkit.connect), then davsync.js with the
// Calendar, To-Do and Contacts mappers: up, down, a change made by
// another client, deletions both ways, a second device that binds
// without writing, and a both-sides change kept as a (conflict) copy.
//
//   RADICALE_URL=http://127.0.0.1:5232/ node --test .github/qa/radicale.js
// Without RADICALE_URL every test is skipped. Radicale runs with
// [auth] type = none (any user / password), so "u" / "p" is fine.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const ROOT = path.join(__dirname, "..", "..");
const DK = require(path.join(ROOT, "davkit.js"));
const DS = require(path.join(ROOT, "davsync.js"));
const CAL = require(path.join(ROOT, "calendar", "dav.js"));
const TODO = require(path.join(ROOT, "todo", "dav.js"));
const CARD = require(path.join(ROOT, "contacts", "dav.js"));

const BASE = process.env.RADICALE_URL || "";
const skip = BASE ? false : "RADICALE_URL is not set";
const RUN = Date.now().toString(36);
const USER = "u";
const AUTH = "Basic " + Buffer.from(USER + ":p").toString("base64");

let clock = Date.now();
const tick = () => (clock += 60000);

async function raw(method, url, body, headers) {
  const res = await fetch(url, { method, body, headers: Object.assign({ Authorization: AUTH }, headers || {}) });
  return { status: res.status, etag: res.headers.get("ETag"), text: await res.text() };
}
async function makeCal(name, comp) {
  const url = new URL("/" + USER + "/" + name + "/", BASE).href;
  const body = '<?xml version="1.0"?><c:mkcalendar xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:set><d:prop>' +
    "<d:displayname>" + name + '</d:displayname><c:supported-calendar-component-set><c:comp name="' + comp + '"/>' +
    "</c:supported-calendar-component-set></d:prop></d:set></c:mkcalendar>";
  const r = await raw("MKCALENDAR", url, body, { "Content-Type": "application/xml" });
  assert.equal(r.status, 201, "MKCALENDAR " + r.status + " " + r.text);
  return url;
}
async function makeBook(name) {
  const url = new URL("/" + USER + "/" + name + "/", BASE).href;
  const body = '<?xml version="1.0"?><d:mkcol xmlns:d="DAV:" xmlns:r="urn:ietf:params:xml:ns:carddav"><d:set><d:prop>' +
    "<d:resourcetype><d:collection/><r:addressbook/></d:resourcetype><d:displayname>" + name +
    "</d:displayname></d:prop></d:set></d:mkcol>";
  const r = await raw("MKCOL", url, body, { "Content-Type": "application/xml" });
  assert.equal(r.status, 201, "MKCOL " + r.status + " " + r.text);
  return url;
}

// One orOS device for one link: items by id, the engine's state, a pass.
function device(url, map, fields) {
  const d = { items: {}, store: DS.memStore(), conf: DK.normConf({ url: BASE, user: USER }) };
  d.local = () => ({ items: Object.keys(d.items).map((id) => ({ id, item: d.items[id] })), find: (id) => d.items[id] || null });
  d.apply = (r) => {
    const now = tick();
    for (const it of r.upsert) {
      const x = { id: it.id, mtime: now };
      for (const f of fields) x[f] = it[f];
      d.items[it.id] = x;
    }
    for (const id of r.remove) delete d.items[id];
  };
  d.pass = async (o) => {
    const st = await d.store.get("k");
    return DS.sync(Object.assign({ client: DK.client(d.conf, "p"), url, readOnly: false, state: st, map }, o || {}),
      d.local, d.apply, (s) => d.store.set("k", s));
  };
  d.find = (pred) => Object.values(d.items).find(pred);
  return d;
}
async function listed(url) {
  const r = await raw("PROPFIND", url, '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getetag/></d:prop></d:propfind>',
    { Depth: "1", "Content-Type": "application/xml" });
  const hrefs = [...r.text.matchAll(/<(?:\w+:)?href>([^<]+)<\/(?:\w+:)?href>/g)].map((m) => m[1]);
  const own = new URL(url).pathname;
  return hrefs.filter((h) => h !== own);
}
const writes = (r) => r.stats.up + r.stats.del + r.stats.merged;

// The same round trip for each kind.
async function roundTrip(o) {
  const A = device(o.url, o.map(), o.fields), B = device(o.url, o.map(), o.fields);
  A.items.a1 = Object.assign({ id: "a1", mtime: tick() }, o.make("First"));
  A.items.a2 = Object.assign({ id: "a2", mtime: tick() }, o.make("Second"));
  // An item made by another client.
  const other = await raw("PUT", o.url + "other-" + RUN + o.ext, o.foreign("From elsewhere"),
    { "Content-Type": o.type, "If-None-Match": "*" });
  assert.equal(other.status, 201);

  const pv = await DS.run({ client: DK.client(A.conf, "p"), url: o.url, state: null, local: A.local(), map: o.map(), dry: true });
  assert.deepEqual([pv.stats.down, pv.stats.up], [1, 2], "the preview counts");
  await A.pass();
  assert.equal((await listed(o.url)).length, 3, "both went up");
  assert.ok(A.find((x) => o.title(x) === "From elsewhere"), "the other client's item came down");

  // DAV-6: nothing changed → nothing written.
  const quiet = await A.pass();
  assert.equal(writes(quiet), 0);

  // Changed by the other client: comes down; what orOS does not model stays.
  const g = await raw("GET", o.url + "other-" + RUN + o.ext);
  const changed = g.text.split("From elsewhere").join("Changed elsewhere");
  const put = await raw("PUT", o.url + "other-" + RUN + o.ext, changed, { "Content-Type": o.type, "If-Match": g.etag });
  assert.ok(put.status === 204 || put.status === 201, "PUT " + put.status);
  await A.pass();
  const mine = A.find((x) => o.title(x) === "Changed elsewhere");
  assert.ok(mine, "the change came down");

  // Edited here: patched there, the foreign line kept.
  o.edit(mine, "Edited in orOS");
  mine.mtime = tick();
  await A.pass();
  const after = await raw("GET", o.url + "other-" + RUN + o.ext);
  assert.ok(after.text.includes("Edited in orOS"), "patched on the server");
  assert.ok(after.text.includes("X-OTHER-APP:keep"), "the other app's line survived");

  // A second device binds to what is there and writes nothing.
  const first = await B.pass();
  assert.equal(writes(first), 0, "the second device wrote nothing");
  assert.equal(Object.keys(B.items).length, 3);

  // Both sides change the same item: the newer wins, the other is a copy.
  const a1 = A.items.a1;
  const g2 = await raw("GET", o.url + "a1" + o.ext);
  await raw("PUT", o.url + "a1" + o.ext, g2.text.split("First").join("First there"), { "Content-Type": o.type, "If-Match": g2.etag });
  o.edit(a1, "First here");
  a1.mtime = Date.now() + 3600000;
  const c = await A.pass();
  assert.equal(c.stats.conflicts, 1);
  assert.ok(A.find((x) => /\(conflict\)$/.test(o.title(x))), "the other version is kept as a copy");

  // Deleted here → DELETE with If-Match; deleted there → removed here.
  delete A.items.a2;
  await A.pass();
  assert.equal((await raw("GET", o.url + "a2" + o.ext)).status, 404, "deleted on the server");
  const g3 = await raw("GET", o.url + "other-" + RUN + o.ext);
  const gone = await raw("DELETE", o.url + "other-" + RUN + o.ext, null, { "If-Match": g3.etag });
  assert.ok(gone.status === 200 || gone.status === 204, "DELETE " + gone.status);
  await A.pass();
  assert.ok(!A.find((x) => /orOS$/.test(o.title(x))), "removed here too");
}

test("Radicale: discovery and the probe pass, nothing is saved before", { skip }, async () => {
  await makeCal("cal-" + RUN, "VEVENT");
  await makeCal("todo-" + RUN, "VTODO");
  await makeBook("card-" + RUN);
  const store = DK.memStore();
  const acc = await DK.connect({ url: BASE, user: USER }, "p", undefined, store);
  const names = acc.cols.map((c) => c.name);
  for (const n of ["cal-" + RUN, "todo-" + RUN, "card-" + RUN]) assert.ok(names.includes(n), n + " found");
  assert.ok(DK.load(store), "saved after the probe");
  assert.equal((await listed(new URL("/" + USER + "/cal-" + RUN + "/", BASE).href)).length, 0, "the probe left nothing behind");
});

const wrapIcs = (comp, uid, title, extra) => ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Other//EN", "BEGIN:" + comp,
  "UID:" + uid, "DTSTAMP:20261001T000000Z", "SUMMARY:" + title, "X-OTHER-APP:keep"].concat(extra, ["END:" + comp, "END:VCALENDAR", ""]).join("\r\n");

test("Radicale: Calendar events both ways", { skip }, async () => {
  const url = new URL("/" + USER + "/cal-" + RUN + "/", BASE).href;
  await roundTrip({
    url, ext: ".ics", type: "text/calendar; charset=utf-8",
    map: () => CAL.mapper(url, {}),
    fields: ["date", "dateEnd", "start", "end", "title", "note", "location", "recur", "remindMin"],
    make: (title) => ({ date: "2026-11-10", dateEnd: null, start: "10:00", end: "11:00", title, note: "", location: "",
                        recur: null, remindMin: null }),
    foreign: (title) => wrapIcs("VEVENT", "other-" + RUN, title, ["DTSTART;VALUE=DATE:20261112", "DTEND;VALUE=DATE:20261113"]),
    title: (x) => x.title, edit: (x, v) => { x.title = v; }
  });
});

test("Radicale: To-Do tasks both ways", { skip }, async () => {
  const url = new URL("/" + USER + "/todo-" + RUN + "/", BASE).href;
  await roundTrip({
    url, ext: ".ics", type: "text/calendar; charset=utf-8",
    map: () => TODO.mapper(url, {}),
    fields: ["text", "notes", "due", "prio", "done", "rec", "cats", "sub", "puid"],
    make: (text) => ({ text, notes: "", due: "2026-11-07", prio: 2, done: false, rec: null, cats: ["Home"], sub: false }),
    foreign: (title) => wrapIcs("VTODO", "other-" + RUN, title, ["PRIORITY:1", "STATUS:NEEDS-ACTION"]),
    title: (x) => x.text, edit: (x, v) => { x.text = v; }
  });
});

test("Radicale: Contacts both ways", { skip }, async () => {
  const url = new URL("/" + USER + "/card-" + RUN + "/", BASE).href;
  const name = (x) => [x.given, x.family].filter(Boolean).join(" ");
  await roundTrip({
    url, ext: ".vcf", type: "text/vcard; charset=utf-8",
    map: () => CARD.mapper(url, {}),
    fields: ["given", "middle", "family", "nickname", "org", "jobTitle", "phones", "emails", "addresses", "websites",
             "im", "events", "note", "starred", "avatar", "cats"],
    make: (given) => ({ given, middle: "", family: "Person", nickname: "", org: "", jobTitle: "", phones: [], emails: [],
                        addresses: [], websites: [], im: [], events: [], note: "", starred: false, avatar: null, cats: [] }),
    foreign: (given) => ["BEGIN:VCARD", "VERSION:3.0", "PRODID:-//Other//EN", "UID:other-" + RUN, "N:Person;" + given + ";;;",
      "FN:" + given + " Person", "X-OTHER-APP:keep", "END:VCARD", ""].join("\r\n"),
    title: (x) => x.given, edit: (x, v) => { x.given = v; }
  });
});
