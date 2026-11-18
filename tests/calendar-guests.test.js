// Calendar events with guests, wave E1 (calendar/guests.js): the
// "calguests" slice merge, places and the waiting list, check-in,
// CSV and the screen filter.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const G = require(path.join(ROOT, "calendar/guests.js"));

const EV = "lx1abcde";
function put(st, raw, now) { const r = G.putGuest(st, EV, raw, now); assert.ok(r.state, JSON.stringify(r)); return r; }
const canon = (x) => JSON.stringify(G.merge(x, null));

test("guests: canonical slice (merge(get, get) = get)", () => {
  let st = G.empty();
  st = put(st, { id: "g2", n: "  Maria \n Pappa ", m: "maria@example.org", s: "y", k: 1 }, 10).state;
  st = put(st, { id: "g1", n: "Nikos", p: "+30 690-000 000x", s: "i" }, 11).state;
  const once = G.merge(st, st);
  assert.equal(JSON.stringify(G.merge(once, once)), JSON.stringify(once));
  assert.equal(JSON.stringify(once), canon(st));
  const l = G.listOf(once, EV);
  assert.deepEqual(l.g.map((g) => g.id), ["g1", "g2"]);
  assert.equal(l.g[1].n, "Maria Pappa");
  assert.equal(l.g[0].p, "+30 690-000 000");
  assert.ok(!("m" in l.g[0]) && !("w" in l.g[0]) && !("in" in l.g[0]) && !("x" in l.g[0]), "optional keys absent");
});

test("guests: bad rows are refused or cleaned", () => {
  assert.equal(G.normGuest({ id: "g1", n: "" }), null);
  assert.equal(G.normGuest({ id: "a/b", n: "x" }), null);
  assert.equal(G.normGuest({ id: "g1", n: "x" }, true), null, "no mtime at merge time");
  const g = G.normGuest({ id: "g1", n: "x", m: "not an email", s: "zz", k: 99, x: "<b>hi</b>", mtime: 1 });
  assert.equal(g.m, undefined);
  assert.equal(g.s, "i");
  assert.equal(g.k, 20);
  assert.equal(g.x, "<b>hi</b>", "kept as text; the page shows it with textContent");
  assert.ok(G.putGuest(G.empty(), "a/b", { id: "g1", n: "x" }, 1).error, "event id with a slash refused");
});

test("guests: two phones check in different guests, both stay", () => {
  let base = G.empty();
  base = put(base, { id: "ga", n: "A", s: "y" }, 1).state;
  base = put(base, { id: "gb", n: "B", s: "y" }, 2).state;
  const p1 = G.checkIn(base, EV, "ga", true, 100);
  const p2 = G.checkIn(base, EV, "gb", true, 101);
  const m = G.merge(p1, p2);
  assert.equal(JSON.stringify(m), JSON.stringify(G.merge(p2, p1)), "order does not matter");
  const l = G.listOf(m, EV);
  assert.equal(l.g.find((g) => g.id === "ga").in, 100);
  assert.equal(l.g.find((g) => g.id === "gb").in, 101);
  assert.equal(G.counts(l).inN, 2);
});

test("guests: a removal beats an older copy, a later edit brings the guest back", () => {
  let st = put(G.empty(), { id: "ga", n: "A" }, 1).state;
  const removed = G.removeGuest(st, EV, "ga", 5);
  assert.equal(G.listOf(G.merge(removed, st), EV).g.length, 0, "stale copy does not resurrect");
  assert.ok(G.merge(removed, st).deleted.some((d) => d.id === EV + "/ga"));
  const edited = put(st, { id: "ga", n: "A2" }, 9).state;
  const m = G.merge(removed, edited);
  assert.equal(G.listOf(m, EV).g[0].n, "A2");
  assert.ok(!m.deleted.some((d) => d.id === EV + "/ga"), "tombstone cancelled");
});

test("guests: a dropped list removes its guests and their tombstones", () => {
  let st = put(G.empty(), { id: "ga", n: "A" }, 1).state;
  st = put(st, { id: "gb", n: "B" }, 2).state;
  st = G.removeGuest(st, EV, "gb", 3);
  const gone = G.dropList(st, EV, 10);
  assert.equal(G.listOf(gone, EV), null);
  assert.deepEqual(gone.deleted, [{ id: EV, mtime: 10 }], "covered guest tombstone dropped");
  assert.equal(G.listOf(G.merge(gone, st), EV), null, "an older copy does not bring it back");
});

test("guests: places, the waiting list and the next one up", () => {
  let st = G.setCap(G.empty(), EV, 3, 1);
  st = put(st, { id: "g1", n: "One", s: "y", k: 1 }, 2).state;          // 2 seats
  let r = put(st, { id: "g2", n: "Two", s: "y", k: 1 }, 3);             // 2 more: full
  assert.equal(r.guest.s, "w");
  assert.equal(r.bumped, true);
  assert.equal(r.guest.w, 3);
  st = r.state;
  st = put(st, { id: "g3", n: "Three", s: "y" }, 4).state;              // 1 seat fits
  let l = G.listOf(st, EV);
  let c = G.counts(l);
  assert.deepEqual([c.yes, c.seats, c.wait, c.free], [2, 3, 1, 0]);
  assert.equal(G.nextUp(l), null, "no free place");
  st = put(st, { id: "g1", s: "n" }, 5).state;                          // One cancels: 2 free
  l = G.listOf(st, EV);
  assert.equal(G.nextUp(l).id, "g2");
  // the waiting time is kept while the guest keeps waiting
  st = put(st, { id: "g2", x: "late" }, 6).state;
  assert.equal(G.listOf(st, EV).g.find((g) => g.id === "g2").w, 3);
  r = put(st, { id: "g2", s: "y" }, 7);
  assert.equal(r.guest.s, "y");
  assert.ok(!("w" in r.guest));
  assert.equal(G.counts(G.listOf(r.state, EV)).free, 0);
});

test("guests: no limit means nobody waits", () => {
  let st = G.empty();
  for (let i = 0; i < 30; i++) st = put(st, { id: "g" + i, n: "N" + i, s: "y" }, i + 1).state;
  const l = G.listOf(st, EV);
  assert.equal(G.counts(l).free, null);
  assert.equal(G.nextUp(l), null);
});

test("guests: check-in seats a guest who was waiting", () => {
  let st = G.setCap(G.empty(), EV, 1, 1);
  st = put(st, { id: "g1", n: "A", s: "y" }, 2).state;
  st = put(st, { id: "g2", n: "B", s: "y" }, 3).state;
  assert.equal(G.listOf(st, EV).g[1].s, "w");
  st = G.checkIn(st, EV, "g2", true, 50);
  const g2 = G.listOf(st, EV).g[1];
  assert.equal(g2.s, "y");
  assert.ok(!("w" in g2));
  st = G.checkIn(st, EV, "g2", false, 60);
  assert.ok(!("in" in G.listOf(st, EV).g[1]), "check-in can be undone");
});

test("guests: CSV escapes formulas and quotes", () => {
  let st = put(G.empty(), { id: "g1", n: "=HYPERLINK(\"x\")", m: "a@b.co", s: "y", x: "says \"hi\", ok" }, 1).state;
  st = put(st, { id: "g2", n: "+Bob", s: "i" }, 2).state;
  const out = G.csv(G.listOf(st, EV), {
    head: ["Name", "Email", "Phone", "Answer", "Plus", "Waiting since", "Checked in", "Note"],
    status: { i: "No answer", y: "Coming", m: "Maybe", n: "Not coming", w: "Waiting" }
  }, (ms) => "t" + ms);
  assert.ok(out.startsWith("﻿Name,Email"));
  assert.ok(out.includes("\"'=HYPERLINK(\"\"x\"\")\",a@b.co,,Coming,0,,,\"says \"\"hi\"\", ok\""));
  assert.ok(out.includes("'+Bob,,,No answer,0"));
});

test("guests: search ignores accents and case, filters by answer", () => {
  let st = put(G.empty(), { id: "g1", n: "Μαρία Παππά", s: "y" }, 1).state;
  st = put(st, { id: "g2", n: "Nikos", s: "n" }, 2).state;
  st = G.checkIn(st, EV, "g1", true, 3);
  const l = G.listOf(st, EV);
  assert.deepEqual(G.view(l, "μαρια", "all").map((g) => g.id), ["g1"]);
  assert.deepEqual(G.view(l, "", "n").map((g) => g.id), ["g2"]);
  assert.deepEqual(G.view(l, "", "in").map((g) => g.id), ["g1"]);
  assert.deepEqual(G.view(l, "", "all").map((g) => g.id), ["g1", "g2"], "coming first");
});

test("guests: a Contacts card becomes a guest", () => {
  const g = G.fromContact({ id: "c1", emails: [{ v: "x@y.gr" }], phones: [{ v: "210 1234567" }] }, "Eleni");
  assert.deepEqual(g, { n: "Eleni", c: "c1", m: "x@y.gr", p: "210 1234567" });
});

test("guests: guests.js stays pure (no DOM, no storage, no clock)", () => {
  const src = fs.readFileSync(path.join(ROOT, "calendar/guests.js"), "utf8").replace(/\/\/.*$/gm, "");
  assert.ok(!/document\.|localStorage|Date\.now|innerHTML/.test(src));
});

// ---------- wave E3: tickets ----------
const subtle = require("crypto").webcrypto.subtle;
const R1 = new Uint8Array(32).fill(7), R2 = new Uint8Array(32).fill(200);

test("tickets: the key is made once and the smallest wins a clash", () => {
  let st = put(G.empty(), { id: "g1", n: "A", s: "y" }, 1).state;
  const a = G.withKey(st, EV, R1, 2), b = G.withKey(st, EV, R2, 3);
  const ka = G.listOf(a, EV).sk, kb = G.listOf(b, EV).sk;
  assert.match(ka, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(G.listOf(G.withKey(a, EV, R2, 9), EV).sk, ka, "an existing key is kept");
  const m1 = G.merge(a, b), m2 = G.merge(b, a);
  assert.equal(JSON.stringify(m1), JSON.stringify(m2));
  assert.equal(G.listOf(m1, EV).sk, ka < kb ? ka : kb);
  assert.equal(G.listOf(G.setCap(m1, EV, 5, 99), EV).sk, G.listOf(m1, EV).sk, "a later head edit keeps the key");
});

test("tickets: signed per event and guest, checked offline", async () => {
  let st = put(G.empty(), { id: "g1", n: "A", s: "y" }, 1).state;
  st = put(st, { id: "g2", n: "B", s: "m" }, 2).state;
  st = G.withKey(st, EV, R1, 3);
  const l = G.listOf(st, EV);
  const t1 = await G.ticket(subtle, l, "g1");
  assert.match(t1, /^OT1\.g1\.[A-Za-z0-9_-]{22}$/);
  assert.equal((await G.check(subtle, l, t1)).r, "ok");
  assert.equal((await G.check(subtle, l, await G.ticket(subtle, l, "g2"))).r, "ask");
  assert.equal((await G.check(subtle, l, t1.replace("OT1.g1", "OT1.g2"))).r, "bad", "a signature for another guest");
  assert.equal((await G.check(subtle, l, "https://example.org")).r, "bad");
  // the same guest id under another event's key
  const other = G.listOf(G.withKey(put(G.empty(), { id: "g1", n: "A" }, 1).state, "evother", R1, 2), "evother");
  assert.equal((await G.check(subtle, other, t1)).r, "bad", "a ticket of another event");
  let st2 = G.checkIn(st, EV, "g1", true, 50);
  const again = await G.check(subtle, G.listOf(st2, EV), t1);
  assert.equal(again.r, "in");
  assert.equal(again.g.in, 50);
  st2 = G.removeGuest(st2, EV, "g1", 60);
  assert.equal((await G.check(subtle, G.listOf(st2, EV), t1)).r, "removed");
});

test("guests: both Calendar guest scripts parse in strict mode", () => {
  const vm = require("vm");
  for (const f of ["calendar/guests.js", "calendar/guestsui.js", "calendar/rsvp.js"]) {
    assert.doesNotThrow(() => new vm.Script("\"use strict\";" + fs.readFileSync(path.join(ROOT, f), "utf8"), { filename: f }), f);
  }
});

// ---------- wave E2: RSVP links ----------
async function rvKeys() {
  const kp = await subtle.generateKey({ name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["encrypt", "decrypt"]);
  const priv = await subtle.exportKey("jwk", kp.privateKey);
  return { k: "abcdefgh12345678", sec: "A".repeat(32), key: "k".repeat(43), priv };
}

test("rsvp: links carry the ticket and the name, parse back", async () => {
  let st = put(G.empty(), { id: "g1", n: "Μαρία", s: "i" }, 1).state;
  st = G.withKey(st, EV, R1, 2);
  st = G.withRsvp(st, EV, await rvKeys(), 3);
  const l = G.listOf(st, EV);
  const code = await G.ticket(subtle, l, "g1");
  const open = G.rsvpLink(l);
  assert.equal(open, "https://useoros.online/calendar/rsvp.html#abcdefgh12345678." + "k".repeat(43));
  assert.deepEqual(G.parseRsvp(open), { k: "abcdefgh12345678", key: "k".repeat(43) });
  const one = G.rsvpLink(l, code, "Μαρία");
  assert.deepEqual(G.parseRsvp(one), { k: "abcdefgh12345678", key: "k".repeat(43), code, name: "Μαρία" });
  assert.equal(G.parseRsvp("#abc.def"), null);
  assert.equal(G.parseRsvp(open + "~<b>"), null);
});

test("rsvp: the form's secrets are kept once, smallest wins, head fields merge", async () => {
  const a = await rvKeys(), b = Object.assign({}, a, { k: "zzzzzzzz12345678" });
  let st = put(G.empty(), { id: "g1", n: "A" }, 1).state;
  const s1 = G.withRsvp(st, EV, a, 2), s2 = G.withRsvp(st, EV, b, 3);
  assert.equal(G.listOf(G.withRsvp(s1, EV, b, 9), EV).rv.k, a.k, "kept");
  const m = G.merge(s2, s1);
  assert.equal(JSON.stringify(m), JSON.stringify(G.merge(s1, s2)));
  assert.equal(G.listOf(m, EV).rv.k, a.k);
  assert.ok(!G.listOf(G.withRsvp(st, EV, { k: "x" }, 2), EV).rv, "bad secrets refused");
  let h = G.setRsvp(m, EV, { ms: 2, op: 1 }, 20);
  assert.equal(G.maxSeats(G.listOf(h, EV)), 2);
  assert.equal(G.listOf(h, EV).op, 1);
  h = G.setRsvp(h, EV, { ms: 99, off: 1 }, 21);
  assert.equal(G.listOf(h, EV).ms, 21);
  assert.equal(JSON.stringify(G.merge(h, h)), JSON.stringify(h), "canonical");
  assert.equal(G.maxSeats(G.listOf(G.setRsvp(h, EV, { ms: 4 }, 22), EV)), 4);
  assert.ok(!("ms" in G.listOf(G.setRsvp(h, EV, { ms: 4 }, 22), EV)), "default not stored");
});

test("rsvp: an answer changes only its own guest, open sign-ups add guests", async () => {
  let st = G.setCap(G.empty(), EV, 3, 1);
  st = put(st, { id: "g1", n: "A" }, 2).state;
  st = put(st, { id: "g2", n: "B" }, 3).state;
  st = G.withKey(st, EV, R1, 4);
  st = G.withRsvp(st, EV, await rvKeys(), 5);
  st = G.setRsvp(st, EV, { ms: 3 }, 6);
  const l = G.listOf(st, EV);
  const c1 = await G.ticket(subtle, l, "g1");
  let r = await G.rsvpAnswer(subtle, st, EV, { id: 1, at: 10 }, { rsvp: 1, s: "y", k: 9, x: "veggie", t: c1 }, 10);
  assert.equal(r.r, "upd");
  let g1 = G.listOf(r.state, EV).g.find((g) => g.id === "g1");
  assert.deepEqual([g1.s, g1.k, g1.x], ["y", 2, "veggie"], "plus-ones clamped to maxSeats - 1");
  st = r.state;
  // a forged code for g2 made from g1's
  r = await G.rsvpAnswer(subtle, st, EV, { id: 2, at: 11 }, { rsvp: 1, s: "n", t: c1.replace("OT1.g1.", "OT1.g2.") }, 11);
  assert.equal(r.r, "bad");
  assert.equal(r.state, st);
  // open sign-up while closed
  r = await G.rsvpAnswer(subtle, st, EV, { id: 3, at: 12 }, { rsvp: 1, s: "y", n: "Walk-in" }, 12);
  assert.equal(r.r, "closed");
  st = G.setRsvp(st, EV, { op: 1 }, 13);
  // the relay said "wait": stays waiting even when a seat looks free here
  r = await G.rsvpAnswer(subtle, st, EV, { id: 4, at: 14, w: 1 }, { rsvp: 1, s: "y", n: "Walk-in", m: "w@x.gr" }, 14);
  assert.equal(r.r, "new");
  const w = G.listOf(r.state, EV).g.find((g) => g.id === "r4");
  assert.deepEqual([w.n, w.m, w.s, w.w], ["Walk-in", "w@x.gr", "w", 14]);
  // the same row again (an ack that did not arrive) does not add twice
  const again = await G.rsvpAnswer(subtle, r.state, EV, { id: 4, at: 14, w: 1 }, { rsvp: 1, s: "y", n: "Walk-in" }, 15);
  assert.equal(G.listOf(again.state, EV).g.length, 3);
  // a removed guest's link
  st = G.removeGuest(r.state, EV, "g1", 20);
  r = await G.rsvpAnswer(subtle, st, EV, { id: 5, at: 21 }, { rsvp: 1, s: "m", t: c1 }, 21);
  assert.equal(r.r, "gone");
  assert.equal((await G.rsvpAnswer(subtle, st, EV, { id: 6 }, { s: "y" }, 22)).r, "bad");
});

test("rsvp: the page's form, the closing time and the .ics", () => {
  const l = { id: EV, cap: 0, mtime: 1, g: [], ms: 2, op: 1 };
  const d = G.rsvpDef(l, { t: "Launch\nparty", s: Date.UTC(2026, 11, 5, 18), e: Date.UTC(2026, 11, 5, 21), loc: "Athens, Greece", d: "Bring; friends", tz: "Europe/Athens" }, "el");
  assert.deepEqual(d, { v: 1, cal: 1, ev: { t: "Launch party", s: Date.UTC(2026, 11, 5, 18), e: Date.UTC(2026, 11, 5, 21), loc: "Athens, Greece", d: "Bring; friends", tz: "Europe/Athens" }, ms: 2, op: 1, l: "el" });
  const now = Date.UTC(2026, 10, 14);
  assert.equal(G.rsvpClose(d.ev, now), d.ev.e + 86400000);
  assert.equal(G.rsvpClose({ e: now + 400 * 86400000 }, now), now + 90 * 86400000);
  const ics = G.icsText(d, "u1", now);
  assert.ok(ics.includes("DTSTART:20261205T180000Z\r\nDTEND:20261205T210000Z"));
  assert.ok(ics.includes("LOCATION:Athens\\, Greece"));
  assert.ok(ics.includes("DESCRIPTION:Bring\\; friends"));
  const allDay = G.icsText({ ev: { t: "Fair", s: Date.UTC(2026, 11, 5), ad: 1 } }, "u2", now);
  assert.ok(allDay.includes("DTSTART;VALUE=DATE:20261205\r\nDTEND;VALUE=DATE:20261206"));
});

test("rsvp: the public page shows text only and keeps its strict policy", () => {
  const js = fs.readFileSync(path.join(ROOT, "calendar/rsvp.js"), "utf8").replace(/\/\/.*$/gm, "");
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/.test(js));
  const html = fs.readFileSync(path.join(ROOT, "calendar/rsvp.html"), "utf8");
  const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)[1];
  assert.match(csp, /script-src 'self';/);
  assert.match(csp, /connect-src https:\/\/oros-mail-relay\.koulaxizis\.workers\.dev;/);
  assert.ok(!/unsafe/.test(csp));
  assert.ok(!/<script>/.test(html), "no inline script");
});
