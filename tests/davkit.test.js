// CalDAV / CardDAV wave 2: davkit.js (the DAV client) against the
// fake server in tests/dav-fake.js.
// Run: node --test tests/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("../davkit.js");
const { fakeDav } = require("./dav-fake.js");

const FORM = { url: "https://dav.test/dav/", user: "u" };
const CAL = "https://dav.test/dav/calendars/u/personal/";
const CARD = "https://dav.test/dav/addressbooks/u/contacts/";

function ics(uid, summary) {
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", "UID:" + uid, "DTSTART:20261101T100000Z",
    "SUMMARY:" + summary, "END:VEVENT", "END:VCALENDAR", ""].join("\r\n");
}

test("normConf: https only (http for this computer), no user info, the relay needs a public https server", () => {
  assert.deepEqual(D.normConf({ url: " https://cloud.example.com/remote.php/dav ", user: " me " }),
    { url: "https://cloud.example.com/remote.php/dav/", user: "me" });
  assert.equal(D.normConf({ url: "http://localhost:5232", user: "u" }).url, "http://localhost:5232/");
  for (const url of ["http://cloud.example.com/", "ftp://x.example/", "https://a:b@x.example/", "https://x.example/?q=1", "nonsense"]) {
    assert.throws(() => D.normConf({ url, user: "u" }), /cd-url/, url);
  }
  assert.throws(() => D.normConf({ url: "https://x.example/", user: "" }), /cd-url/);
  assert.throws(() => D.normConf({ url: "http://localhost:5232/", user: "u", relay: true }), /cd-relay-target/);
  assert.equal(D.normConf({ url: "https://x.example/", user: "u", relay: true }).relay, true);
});

test("parseXml / multistatus: prefixes, default namespace, entities, CDATA, statuses per propstat", () => {
  const xml = '<?xml version="1.0"?><!-- c --><multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">' +
    "<response><href>/a/b%20c.ics</href><propstat><prop><getetag>\"x&amp;1\"</getetag>" +
    "<C:calendar-data><![CDATA[BEGIN:VCALENDAR\r\n<x>]]></C:calendar-data></prop><status>HTTP/1.1 200 OK</status></propstat>" +
    "<propstat><prop><displayname/></prop><status>HTTP/1.1 404 Not Found</status></propstat></response>" +
    "<response><href>/a/gone.ics</href><status>HTTP/1.1 404 Not Found</status></response></multistatus>";
  const rs = D.multistatus(xml, "https://h.example/a/");
  assert.equal(rs.length, 2);
  assert.equal(rs[0].href, "https://h.example/a/b%20c.ics");
  assert.equal(rs[0].props["DAV:|getetag"].text, '"x&1"');
  assert.equal(rs[0].props["urn:ietf:params:xml:ns:caldav|calendar-data"].text, "BEGIN:VCALENDAR\r\n<x>");
  assert.equal(rs[0].missing["DAV:|displayname"], 404);
  assert.equal(rs[1].status, 404);
  assert.deepEqual(D.multistatus("not xml at all", "https://h.example/"), []);
  assert.equal(D.etagOf("abc"), '"abc"');
  assert.equal(D.etagOf('W/"abc"'), 'W/"abc"');
});

test("connect: discovery from the address, collections, probe, then the account is saved on this device only", async () => {
  const S = fakeDav();
  const store = D.memStore();
  const r = await D.connect(FORM, "p", S.fetch, store);
  assert.equal(r.conf.principal, "https://dav.test/dav/principals/u/");
  assert.equal(r.conf.calHome, "https://dav.test/dav/calendars/u/");
  assert.equal(r.conf.cardHome, "https://dav.test/dav/addressbooks/u/");
  const byUrl = Object.fromEntries(r.cols.map((c) => [c.url, c]));
  assert.deepEqual(Object.keys(byUrl).sort(), [CARD, CAL, "https://dav.test/dav/calendars/u/tasks/"].sort(),
    "the journal-only calendar is left out");
  assert.deepEqual(byUrl[CAL].comps, ["VEVENT", "VTODO"]);
  assert.equal(byUrl[CAL].color, "#3366cc");
  assert.equal(byUrl[CAL].name, "Personal");
  assert.equal(byUrl[CARD].kind, "card");
  assert.equal(Object.keys(S.items).length, 0, "the probe leaves nothing behind");
  assert.ok(S.log.some((l) => /^PUT \/dav\/calendars\/u\/personal\/oros-probe-/.test(l)), "probed in a calendar of the person");
  const a = D.load(store);
  assert.equal(a.pass, "p");
  assert.equal(a.conf.user, "u");
  assert.equal(a.cols.length, 3);
  D.disconnect(store);
  assert.equal(D.load(store), null);
  assert.equal(store.getItem(D.PASS_KEY), null);
});

test("connect: /.well-known when the typed address has no principal; through the relay the redirect is followed here", async () => {
  const S = fakeDav();
  const r = await D.connect({ url: "https://dav.test/", user: "u" }, "p", S.fetch, D.memStore());
  assert.equal(r.conf.principal, "https://dav.test/dav/principals/u/");

  const R = fakeDav({ relay: D.RELAY });
  const seen = [];
  const f = (url, init) => { seen.push([url, new Headers(init.headers).get("X-Oros-Target")]); return R.fetch(url, init); };
  const rr = await D.connect({ url: "https://dav.test/", user: "u", relay: true }, "p", f, D.memStore());
  assert.equal(rr.conf.relay, true);
  assert.ok(seen.every(([u]) => u === D.RELAY), "every request goes to the relay");
  assert.ok(seen.some(([, t]) => t === "https://dav.test/dav/"), "the reported redirect was followed");
});

test("connect refuses, and saves nothing: wrong password, conditions ignored, weak ETags, read-only, not DAV", async () => {
  const cases = [
    [{}, "x", "cd-auth"],
    [{ ignoreConditions: true }, "p", "cd-conditions"],
    [{ weakEtag: true }, "p", "cd-conditions"],
    [{ readOnly: true }, "p", "cd-readonly"],
    [{ rootNoPrincipal: true, noWellKnown: true }, "p", "cd-notdav"]
  ];
  for (const [opts, pass, code] of cases) {
    const S = fakeDav(opts);
    const store = D.memStore();
    await assert.rejects(D.connect(FORM, pass, S.fetch, store), new RegExp(code), JSON.stringify(opts));
    assert.equal(D.load(store), null, code + ": nothing saved");
    assert.equal(Object.keys(S.items).length, 0, code + ": nothing left on the server");
  }
  await assert.rejects(D.connect(FORM, "p", () => Promise.reject(new TypeError("Failed to fetch")), D.memStore()), /cd-unreachable/);
});

test("a PUT that answers without an ETag is read again for the real one", async () => {
  const S = fakeDav({ noPutEtag: true });
  await D.connect(FORM, "p", S.fetch, D.memStore());
  const cl = D.client(D.normConf(FORM), "p", S.fetch);
  const r = await cl.put(CAL + "a.ics", ics("a", "A"), "text/calendar", { create: true });
  assert.equal(r.ok, true);
  assert.equal(r.etag, S.items["/dav/calendars/u/personal/a.ics"].etag);
});

test("put / del are always conditional; 412 is reported, never overwritten", async () => {
  const S = fakeDav();
  const cl = D.client(D.normConf(FORM), "p", S.fetch);
  const a = await cl.put(CAL + "a.ics", ics("a", "A"), "text/calendar", { create: true });
  assert.equal(a.ok, true);
  const again = await cl.put(CAL + "a.ics", ics("a", "B"), "text/calendar", { create: true });
  assert.deepEqual([again.ok, again.status], [false, 412]);
  await assert.rejects(cl.put(CAL + "a.ics", ics("a", "C"), "text/calendar", {}), /cd-conditions/, "no condition = no write");
  const stale = await cl.put(CAL + "a.ics", ics("a", "D"), "text/calendar", { etag: '"old"' });
  assert.equal(stale.ok, false);
  assert.match(S.items["/dav/calendars/u/personal/a.ics"].data, /SUMMARY:A/);
  const b = await cl.put(CAL + "a.ics", ics("a", "E"), "text/calendar", { etag: a.etag });
  assert.equal(b.ok, true);
  assert.notEqual(b.etag, a.etag);
  assert.equal(await cl.del(CAL + "a.ics", a.etag), false, "a stale delete is refused");
  assert.ok(S.items["/dav/calendars/u/personal/a.ics"]);
  await assert.rejects(cl.del(CAL + "a.ics", ""), /cd-conditions/);
  assert.equal(await cl.del(CAL + "a.ics", b.etag), true);
  assert.equal(await cl.del(CAL + "a.ics", b.etag), true, "already gone counts as removed");
});

test("syncCollection: first pass lists all, then only changes and removals; an unknown token is cd-token", async () => {
  const S = fakeDav();
  const cl = D.client(D.normConf(FORM), "p", S.fetch);
  S.put("/dav/calendars/u/personal/1.ics", ics("1", "One"));
  S.put("/dav/calendars/u/personal/2.ics", ics("2", "Two"));
  S.put("/dav/addressbooks/u/contacts/x.vcf", "BEGIN:VCARD\r\nEND:VCARD\r\n");
  const first = await cl.syncCollection(CAL, "");
  assert.deepEqual(first.changed.map((c) => c.href).sort(), [CAL + "1.ics", CAL + "2.ics"]);
  assert.deepEqual(first.removed, []);
  assert.ok(first.token);
  S.put("/dav/calendars/u/personal/2.ics", ics("2", "Two b"));
  S.remove("/dav/calendars/u/personal/1.ics");
  const next = await cl.syncCollection(CAL, first.token);
  assert.deepEqual(next.changed.map((c) => c.href), [CAL + "2.ics"]);
  assert.equal(next.changed[0].etag, S.items["/dav/calendars/u/personal/2.ics"].etag);
  assert.deepEqual(next.removed, [CAL + "1.ics"]);
  const none = await cl.syncCollection(CAL, next.token);
  assert.deepEqual([none.changed, none.removed], [[], []]);
  await assert.rejects(cl.syncCollection(CAL, "http://dav.test/sync/99999"), /cd-token/);
});

test("listEtags (no sync tokens) and multiget (in batches of 50)", async () => {
  const S = fakeDav({ noSyncToken: true });
  const cl = D.client(D.normConf(FORM), "p", S.fetch);
  for (let i = 0; i < 120; i++) S.put("/dav/calendars/u/personal/e" + i + ".ics", ics("e" + i, "Event " + i));
  await assert.rejects(cl.syncCollection(CAL, ""), /cd-token|cd-http/, "the engine then falls back to listEtags");
  const all = await cl.listEtags(CAL);
  assert.equal(all.length, 120);
  const got = await cl.multiget(CAL, "cal", all.map((x) => x.href));
  assert.equal(got.length, 120);
  assert.equal(S.log.filter((l) => l === "REPORT /dav/calendars/u/personal/").length, 3 + 1, "3 multigets + the refused sync");
  const one = got.find((g) => g.href === CAL + "e7.ics");
  assert.match(one.data, /SUMMARY:Event 7/);
  assert.equal(one.etag, S.items["/dav/calendars/u/personal/e7.ics"].etag);

  S.put("/dav/addressbooks/u/contacts/p 1.vcf", "BEGIN:VCARD\r\nFN:A & B\r\nEND:VCARD\r\n");
  const cards = await cl.multiget(CARD, "card", [CARD + "p%201.vcf"]);
  assert.equal(cards.length, 1);
  assert.match(cards[0].data, /FN:A & B/);
});

test("refresh lists the collections again with the saved account", async () => {
  const S = fakeDav();
  const store = D.memStore();
  await D.connect(FORM, "p", S.fetch, store);
  S.cols["/dav/calendars/u/work/"] = { kind: "cal", name: "Work", color: "", comps: ["VEVENT"] };
  const cols = await D.refresh(S.fetch, store);
  assert.ok(cols.some((c) => c.name === "Work"));
  assert.equal(D.load(store).cols.length, 4);
});
