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
