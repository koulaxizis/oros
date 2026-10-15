// One-time Google imports (google-import.js + calendar/gcal.js,
// todo/gtasks.js, feeds/youtube.js, shelf/gbooks.js): the shared
// sign-in flow with window.open / fetch / the callback stubbed, and
// the pure mappers fed with fake API answers.
// Run: node --test tests/

"use strict";

process.env.TZ = "Europe/Athens";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

// ---- a browser-ish global for the shared module ----
const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); }
};
global.addEventListener = () => {};
global.removeEventListener = () => {};
global.location = { href: "https://useoros.online/calendar/index.html" };
let popup = null, opened = 0;
global.open = () => { opened++; return popup; };
let routes = {}, calls = [];
global.fetch = (url, opts) => {
  calls.push({ url: String(url), opts: opts || {} });
  const u = String(url);
  for (const k of Object.keys(routes)) {
    if (u.indexOf(k) === 0) {
      const r = routes[k](u, opts);
      const status = r.status || 200, body = r.body !== undefined ? r.body : r;
      return Promise.resolve({
        status, ok: status >= 200 && status < 300,
        json: () => Promise.resolve(body), text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body))
      });
    }
  }
  return Promise.resolve({ status: 404, ok: false, json: () => Promise.resolve({}), text: () => Promise.resolve("") });
};

const GI = require(path.join(ROOT, "google-import.js"));
const GCAL = require(path.join(ROOT, "calendar/gcal.js"));
const ICS = require(path.join(ROOT, "calendar/ics.js"));
const GT = require(path.join(ROOT, "todo/gtasks.js"));
const YT = require(path.join(ROOT, "feeds/youtube.js"));
const GB = require(path.join(ROOT, "shelf/gbooks.js"));

// A sign-in window whose "Google" answers like the callback page does.
function fakePopup(answer) {
  return {
    closed: false,
    close() { this.closed = true; },
    set location(v) {},
    get location() {
      const w = this;
      return {
        set href(url) {
          w.url = url;
          const state = new URL(url).searchParams.get("state");
          setTimeout(() => {
            const cb = Object.assign({ token: "", code: "", error: "", state, t: Date.now() }, answer(state));
            localStorage.setItem(GI.CB_KEY, JSON.stringify(cb));
            const bc = new BroadcastChannel("oros-contacts-oauth");
            bc.postMessage(cb);
            bc.close();
          }, 5);
        }
      };
    }
  };
}
function revokes() { return calls.filter((c) => c.url.indexOf("https://oauth2.googleapis.com/revoke") === 0); }
function reset() { routes = {}; calls = []; store.clear(); opened = 0; }

test("the built-in client id is Contacts' one, and the own-id setting is Contacts' too", () => {
  const src = fs.readFileSync(path.join(ROOT, "contacts/accounts.js"), "utf8");
  const m = src.match(/google:\s*"([^"]+)"/);
  assert.ok(m);
  assert.equal(GI.BUILTIN, m[1]);
  reset();
  assert.equal(GI.clientId(), GI.BUILTIN);
  localStorage.setItem("oros-contacts-oauth", JSON.stringify({ google: "123-own.apps.googleusercontent.com" }));
  assert.equal(GI.clientId(), "123-own.apps.googleusercontent.com");
  localStorage.setItem("oros-contacts-oauth", JSON.stringify({ google: "<bad id>" }));
  assert.equal(GI.clientId(), GI.BUILTIN);
  assert.equal(GI.redirectUri(), "https://useoros.online/contacts/oauth-callback.html");
});

test("no token kept, no offline access, revoke present; the callback page speaks for every app", () => {
  const src = fs.readFileSync(path.join(ROOT, "google-import.js"), "utf8").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/offline_access|access_type|refresh_token/.test(src));
  assert.ok(/oauth2\.googleapis\.com\/revoke/.test(src));
  assert.ok(!/localStorage\.setItem/.test(src), "the shared module writes nothing to storage");
  assert.ok(/response_type: "token"/.test(src));
  const cb = fs.readFileSync(path.join(ROOT, "contacts/oauth-callback.js"), "utf8");
  assert.ok(/orOS is reading your data now/.test(cb));
  assert.ok(/Το orOS διαβάζει τώρα τα δεδομένα σου/.test(cb));
  assert.ok(!/Contacts is reading/.test(cb));
  // every importer only reads: no POST/PUT/DELETE towards Google APIs
  for (const f of ["calendar/gcal.js", "todo/gtasks.js", "feeds/youtube.js", "shelf/gbooks.js"]) {
    const s = fs.readFileSync(path.join(ROOT, f), "utf8");
    assert.ok(!/method\s*:/.test(s), f + " sends only GET");
  }
  assert.deepEqual(Object.values(GI.SCOPES).sort(), [
    "https://www.googleapis.com/auth/books",
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/tasks.readonly",
    "https://www.googleapis.com/auth/youtube.readonly"
  ]);
});

test("errors read clearly in both languages", () => {
  const e = (code) => Object.assign(new Error(code), { code });
  assert.equal(GI.message(e("notenabled"), "en"), "Google answered 403: this service is not enabled yet for orOS's Google app.");
  assert.match(GI.message(e("notenabled"), "el"), /^Η Google απάντησε 403/);
  assert.match(GI.message(e("popup"), "en"), /blocked/);
  assert.match(GI.message(e("cancelled"), "el"), /ακυρώθηκε/);
  assert.match(GI.message(Object.assign(e("http"), { detail: "500" }), "en"), /\(500\)/);
});

test("run: sign in, read with the token (every page), revoke right after", async () => {
  reset();
  popup = fakePopup(() => ({ token: "tok-1" }));
  routes["https://oauth2.googleapis.com/revoke"] = () => ({});
  routes["https://api.example/items"] = (u) => (/pageToken=p2/.test(u) ? { items: [3] } : { items: [1, 2], nextPageToken: "p2" });
  let prog = 0;
  const res = await GI.run({
    scope: GI.SCOPES.tasks,
    progress: (n) => { prog++; },
    read(token, api) {
      assert.equal(token, "tok-1");
      const all = [];
      return api.pages((cur) => "https://api.example/items" + (cur ? "?pageToken=" + cur : ""), (d) => { all.push(...d.items); return api.nextToken(d); })
        .then(() => all);
    }
  });
  assert.deepEqual(res.data, [1, 2, 3]);
  assert.equal(res.revoked, true);
  assert.equal(opened, 1);
  const auth = new URL(popup.url);
  assert.equal(auth.origin + auth.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(auth.searchParams.get("response_type"), "token");
  assert.equal(auth.searchParams.get("scope"), GI.SCOPES.tasks);
  assert.equal(auth.searchParams.get("redirect_uri"), "https://useoros.online/contacts/oauth-callback.html");
  const api = calls.filter((c) => c.url.indexOf("https://api.example") === 0);
  assert.equal(api.length, 2);
  assert.equal(api[0].opts.headers.Authorization, "Bearer tok-1");
  assert.equal(revokes().length, 1);
  assert.equal(revokes()[0].opts.body, "token=tok-1");
  assert.equal(store.get(GI.CB_KEY), undefined, "the answer record is gone");
  assert.ok(popup.closed);
  assert.ok(prog >= 1);
});

test("run: a 403 for a service not switched on → notenabled, still revoked", async () => {
  reset();
  popup = fakePopup(() => ({ token: "tok-2" }));
  routes["https://oauth2.googleapis.com/revoke"] = () => ({});
  routes["https://www.googleapis.com/books"] = () => ({ status: 403, body: { error: { code: 403, message: "Books API has not been used in project 1 before or it is disabled.", status: "PERMISSION_DENIED", details: [{ reason: "SERVICE_DISABLED" }] } } });
  await assert.rejects(GI.run({ scope: GI.SCOPES.books, read: (tk, api) => api.getJson("https://www.googleapis.com/books/v1/mylibrary/bookshelves") }),
    (e) => e.code === "notenabled");
  assert.equal(revokes().length, 1);
  reset();
  popup = fakePopup(() => ({ token: "tok-3" }));
  routes["https://oauth2.googleapis.com/revoke"] = () => ({});
  routes["https://x.example"] = () => ({ status: 403, body: { error: { errors: [{ reason: "insufficientPermissions" }] } } });
  await assert.rejects(GI.run({ scope: GI.SCOPES.youtube, read: (tk, api) => api.getJson("https://x.example/") }), (e) => e.code === "scope");
  assert.equal(revokes().length, 1);
});

test("run: blocked popup, denied sign-in, cancel; an answer for another state is ignored", async () => {
  reset();
  popup = null;
  await assert.rejects(GI.run({ scope: GI.SCOPES.calendar, read: () => 1 }), (e) => e.code === "popup");
  popup = fakePopup(() => ({ error: "access_denied" }));
  await assert.rejects(GI.run({ scope: GI.SCOPES.calendar, read: () => 1 }), (e) => e.code === "cancelled");
  assert.equal(revokes().length, 0, "no token, nothing to revoke");
  // a stray answer (wrong state) does not finish the wait; cancel does
  popup = fakePopup(() => ({ token: "stolen", state: "someone-else" }));
  const p = GI.run({ scope: GI.SCOPES.calendar, read: () => { throw new Error("must not read"); } });
  await new Promise((r) => setTimeout(r, 30));
  GI.cancel();
  await assert.rejects(p, (e) => e.code === "cancelled");
  await assert.rejects(GI.run({ scope: "https://evil.example/x", read: () => 1 }));
});

// ---------- Calendar ----------
const CAL = Object.assign(GCAL.calItem({ id: "me@gmail.com", summary: "Me", primary: true, accessRole: "owner", backgroundColor: "#9FC6E7",
  defaultReminders: [{ method: "popup", minutes: 30 }], timeZone: "Europe/Athens" }), { timeZone: "Europe/Athens" });
const EVENTS = [
  { id: "a1", iCalUID: "a1@google.com", status: "confirmed", summary: "Gym, legs", description: "Line 1<br>Line &amp; 2",
    start: { dateTime: "2026-10-05T18:00:00+03:00", timeZone: "Europe/Athens" }, end: { dateTime: "2026-10-05T19:00:00+03:00", timeZone: "Europe/Athens" },
    recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=10"], reminders: { useDefault: true } },
  { id: "a1_c", recurringEventId: "a1", status: "cancelled", originalStartTime: { dateTime: "2026-10-12T18:00:00+03:00", timeZone: "Europe/Athens" } },
  { id: "a1_m", iCalUID: "a1@google.com", recurringEventId: "a1", status: "confirmed", summary: "Gym (moved)",
    originalStartTime: { dateTime: "2026-10-19T18:00:00+03:00", timeZone: "Europe/Athens" },
    start: { dateTime: "2026-10-20T18:00:00+03:00" }, end: { dateTime: "2026-10-20T19:00:00+03:00" } },
  { id: "b", iCalUID: "b@google.com", summary: "Trip", start: { date: "2026-11-01" }, end: { date: "2026-11-04" }, location: "Crete" },
  { id: "c", iCalUID: "c@google.com", summary: "NY call", start: { dateTime: "2026-11-01T15:00:00Z", timeZone: "America/New_York" },
    end: { dateTime: "2026-11-01T16:00:00Z" }, reminders: { useDefault: false, overrides: [{ method: "email", minutes: 60 }, { method: "popup", minutes: 15 }] } },
  { id: "d", status: "cancelled" }
];

test("Calendar: calendar list → only readable calendars, own ones ticked", () => {
  assert.equal(GCAL.calItem({ id: "x", accessRole: "freeBusyReader" }), null);
  const hol = GCAL.calItem({ id: "en.greek#holiday@group.v.calendar.google.com", summary: "Holidays in Greece", accessRole: "reader" });
  assert.equal(hol.on, false);
  assert.equal(CAL.on, true);
  assert.equal(CAL.color, "#9fc6e7");
  assert.deepEqual(CAL.remind, [30]);
});

test("Calendar: events map like an .ics import (repeat, exceptions, all-day, zones, reminders, ids)", () => {
  const out = GCAL.build([{ cal: CAL, events: EVENTS }], ICS)[0];
  assert.equal(out.events.length, 4);
  const by = Object.fromEntries(out.events.map((e) => [e.title, e]));
  const gym = by["Gym, legs"];
  assert.equal(gym.id, ICS.hashId("a1@google.com"), "same id as a Google .ics export");
  assert.equal(gym.date, "2026-10-05");
  assert.equal(gym.start, "18:00");
  assert.equal(gym.note, "Line 1\nLine & 2");
  assert.ok(gym.recur);
  assert.deepEqual(gym.recur.exdates, ["2026-10-12", "2026-10-19"]);
  assert.equal(gym.remindMin, 30, "the calendar's default reminder");
  const moved = by["Gym (moved)"];
  assert.equal(moved.date, "2026-10-20");
  assert.equal(moved.recur, null);
  assert.equal(by.Trip.dateEnd, "2026-11-03", "all-day end is exclusive at Google");
  assert.equal(by.Trip.location, "Crete");
  assert.equal(by["NY call"].tz, "America/New_York");
  assert.equal(by["NY call"].start, "10:00");
  assert.equal(by["NY call"].remindMin, 15, "popup reminders only");
  // the same answer twice → the same ids
  const again = GCAL.build([{ cal: CAL, events: EVENTS }], ICS)[0];
  assert.deepEqual(again.events.map((e) => e.id), out.events.map((e) => e.id));
});

test("Calendar: text from Google cannot break the iCalendar lines", () => {
  const txt = GCAL.toIcs(CAL, [{ id: "z", iCalUID: "z@g", summary: "A;B,C\nEND:VEVENT\nBEGIN:VEVENT", start: { date: "2026-01-02" },
    recurrence: ["RRULE:FREQ=DAILY\nX-INJECT:1", "EXRULE:FREQ=DAILY"] }]);
  assert.equal(txt.split("\r\n").filter((l) => l === "BEGIN:VEVENT").length, 1);
  assert.ok(!/X-INJECT|EXRULE/.test(txt));
  const ev = ICS.parse(txt).events[0];
  assert.equal(ev.title, "A;B,C END:VEVENT BEGIN:VEVENT");
});

test("Calendar: read() pages calendars and events, one GET each page", async () => {
  const seen = [];
  const api = {
    nextToken: GI.nextToken,
    pages(urlFor, each) {
      let cur = "", n = 0;
      const step = () => {
        const u = urlFor(cur);
        seen.push(u);
        let d;
        if (/calendarList/.test(u)) d = { items: [{ id: "me@gmail.com", summary: "Me", accessRole: "owner" }, { id: "fb", accessRole: "freeBusyReader" }] };
        else d = cur ? { items: EVENTS.slice(3) } : { items: EVENTS.slice(0, 3), nextPageToken: "n2" };
        n++;
        const next = each(d);
        if (next && n < 5) { cur = next; return Promise.resolve().then(step); }
        return Promise.resolve(n);
      };
      return step();
    }
  };
  const got = await GCAL.read(api, () => {});
  assert.equal(got.length, 1);
  assert.equal(got[0].events.length, EVENTS.length);
  assert.ok(seen.some((u) => /calendars\/me%40gmail\.com\/events\?singleEvents=false/.test(u)));
  assert.ok(seen.some((u) => /pageToken=n2/.test(u)));
});

// ---------- To-Do ----------
const TASKS = {
  lists: [{ id: "L1", title: "My Tasks" }, { id: "L2", title: "Groceries" }, { id: "L3", title: "Empty" }],
  tasks: {
    L1: [
      { id: "t2", title: "Second", position: "00000000000000000002", status: "needsAction" },
      { id: "t1", title: "First", notes: "Some notes", due: "2026-10-20T00:00:00.000Z", position: "00000000000000000001", status: "needsAction" },
      { id: "s1", title: "Sub one", parent: "t1", position: "00000000000000000001", status: "completed", due: "2026-10-18T00:00:00.000Z" },
      { id: "s2", title: "Sub two", parent: "t1", position: "00000000000000000002", status: "needsAction", notes: "detail" },
      { id: "t3", title: "Done thing", status: "completed", position: "00000000000000000003" },
      { id: "t4", title: "", status: "needsAction" },
      { id: "t5", title: "Gone", deleted: true }
    ],
    L2: [{ id: "g1", title: "Milk", status: "needsAction" }, { id: "g2", title: "Bread", status: "needsAction" }],
    L3: []
  }
};

test("To-Do: lists, tasks, notes, due dates, completed, subtasks", () => {
  const st = { lists: [{ id: "tdl-groceries", name: "groceries", items: [{ id: "x", text: "Bread", done: false }] }], deleted: {} };
  const pl = GT.plan(st, TASKS, { done: true });
  assert.equal(pl.lists.add.length, 1, "Groceries goes into the list of the same name");
  assert.equal(pl.lists.add[0].name, "My Tasks");
  assert.equal(pl.lists.add[0].id, GT.idOf("list", "L1"));
  const texts = pl.items.add.map((i) => i.text);
  assert.deepEqual(texts, ["First", "Second", "Done thing", "Milk"]);
  const first = pl.items.add[0];
  assert.equal(first.due, "2026-10-20");
  assert.equal(first.done, false);
  assert.deepEqual(first.subs.map((s) => [s.text, s.done]), [["Sub one", true], ["Sub two", false]]);
  assert.match(first.notes, /^Some notes\n\n↳ Sub one \(2026-10-18\)\n↳ Sub two: detail$/);
  assert.equal(pl.items.add[2].done, true);
  assert.equal(pl.items.add[3].list, "tdl-groceries");
  assert.equal(pl.here, 1, "Bread is already open in Groceries");
  assert.equal(pl.untitled, 1);
  assert.equal(pl.sub, 2);
  assert.equal(pl.done, 1);
  assert.ok(pl.items.add.every((i) => i.prio === 4 && Array.isArray(i.labels) && Array.isArray(i.info)));
});

test("To-Do: without completed ones, by list, and a second import adds only what is missing", () => {
  let pl = GT.plan({ lists: [] }, TASKS, { done: false, pick: { L1: true } });
  assert.deepEqual(pl.items.add.map((i) => i.text), ["First", "Second"]);
  assert.deepEqual(pl.items.add[0].subs.map((s) => s.text), ["Sub two"]);
  // apply the first plan by hand, as importApply does
  const list = { id: pl.lists.add[0].id, name: "My Tasks", items: pl.items.add.map((a) => ({ id: a.id, text: a.text, done: a.done })) };
  pl = GT.plan({ lists: [list] }, TASKS, { done: true });
  assert.equal(pl.lists.add.length, 1);           // Groceries, now new
  assert.deepEqual(pl.items.add.map((i) => i.text), ["Done thing", "Milk", "Bread"]);
  assert.equal(pl.same, 2);
  assert.equal(pl.per.L1.same, 2);
});

// ---------- Feeds ----------
test("Feeds: subscriptions → channel feeds, once each, bad ids left out", () => {
  const ch = YT.channels([
    { snippet: { title: "Kurzgesagt", resourceId: { kind: "youtube#channel", channelId: "UCsXVk37bltHxD1rDPwtNM8Q" } } },
    { snippet: { title: "Dup", resourceId: { kind: "youtube#channel", channelId: "UCsXVk37bltHxD1rDPwtNM8Q" } } },
    { snippet: { title: "Bad", resourceId: { kind: "youtube#channel", channelId: "../../x" } } },
    { snippet: { title: "Playlist", resourceId: { kind: "youtube#playlist", playlistId: "PL1" } } },
    { snippet: { title: "  New\nLine  ", resourceId: { channelId: "UC_x5XG1OV2P6uZZ5FSM9Ttw" } } }
  ]);
  assert.deepEqual(ch.map((c) => c.url), [
    "https://www.youtube.com/feeds/videos.xml?channel_id=UCsXVk37bltHxD1rDPwtNM8Q",
    "https://www.youtube.com/feeds/videos.xml?channel_id=UC_x5XG1OV2P6uZZ5FSM9Ttw"
  ]);
  assert.equal(ch[0].title, "Kurzgesagt");
  assert.equal(ch[1].title, "New Line");
  assert.equal(ch[0].site, "https://www.youtube.com/channel/UCsXVk37bltHxD1rDPwtNM8Q");
});

test("Feeds: read() follows the pages", async () => {
  let n = 0;
  const api = {
    nextToken: GI.nextToken,
    pages(urlFor, each) {
      const step = (cur) => {
        const u = urlFor(cur);
        assert.match(u, /subscriptions\?part=snippet&mine=true/);
        n++;
        const d = cur ? { items: [{ snippet: { title: "B", resourceId: { channelId: "UCbbbbbbbbbbbbbbbbbbbbbb" } } }] }
          : { items: [{ snippet: { title: "A", resourceId: { channelId: "UCaaaaaaaaaaaaaaaaaaaaaa" } } }], nextPageToken: "CAUQAA" };
        const next = each(d);
        return next ? step(next) : Promise.resolve(n);
      };
      return step("");
    }
  };
  const out = await YT.read(api);
  assert.deepEqual(out.map((c) => c.title), ["A", "B"]);
  assert.equal(n, 2);
});

// ---------- Shelf ----------
const vol = (id, title, extra) => Object.assign({ id, volumeInfo: Object.assign({ title, authors: ["Ann Author", "Bo Writer"], publishedDate: "2019-04-02", pageCount: 320 }, extra || {}), userInfo: { updated: "2025-03-01T10:00:00.000Z" } });

test("Shelf: Google Books shelves → states, favourites, e-books, tags; skipped shelves", () => {
  const rows = GB.records([
    { id: 2, title: "To read", volumes: [vol("v1", "Dune"), vol("v2", "Emma")] },
    { id: 4, title: "Have read", volumes: [vol("v1", "Dune")] },
    { id: 3, title: "Reading now", volumes: [vol("v3", "Ulysses")] },
    { id: 0, title: "Favorites", volumes: [vol("v1", "Dune")] },
    { id: 7, title: "My eBooks", volumes: [vol("v2", "Emma")] },
    { id: 6, title: "Recently viewed", volumes: [vol("v9", "Noise")] },
    { id: 1001, title: "Sci-fi, classics", volumes: [vol("v1", "Dune")] },
    { id: 2, volumes: [{ id: "bad id!", volumeInfo: { title: "X" } }, { id: "v8", volumeInfo: {} }] }
  ]);
  assert.deepEqual(rows.map((r) => r.title), ["Dune", "Emma", "Ulysses"]);
  const dune = rows[0];
  assert.equal(dune.st, "done");
  assert.equal(dune.fav, 1);
  assert.deepEqual(dune.tags, ["Sci-fi classics"]);
  assert.equal(dune.by, "Ann Author, Bo Writer");
  assert.equal(dune.year, 2019);
  assert.equal(dune.size, 320);
  assert.equal(dune.added, "2025-03-01");
  assert.match(dune.id, /^gb[0-9a-f]{16}$/);
  assert.equal(dune.id, GB.idOf("v1"));
  assert.equal(rows[1].fmt, "e");
  assert.equal(rows[1].st, "want");
  assert.equal(rows[2].st, "now");
});

test("Shelf: read() pages by startIndex up to totalItems", async () => {
  const urls = [];
  const api = {
    getJson(u) {
      urls.push(u);
      return Promise.resolve({ items: [{ id: 2, title: "To read" }, { id: 9, title: "Browsing history" }] });
    },
    pages(urlFor, each) {
      const step = (cur) => {
        const u = urlFor(cur);
        urls.push(u);
        const start = +(/startIndex=(\d+)/.exec(u)[1]);
        const d = { totalItems: 3, items: start === 0 ? [vol("a", "A"), vol("b", "B")] : [vol("c", "C")] };
        const next = each(d);
        return next ? step(next) : Promise.resolve();
      };
      return step("");
    }
  };
  const shelves = await GB.read(api, () => {});
  assert.equal(shelves.length, 1, "browsing history is not read");
  assert.equal(shelves[0].volumes.length, 3);
  assert.ok(urls.some((u) => /bookshelves\/2\/volumes\?maxResults=40&startIndex=2/.test(u)));
});
