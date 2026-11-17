// Today for Scanner & PDF, Transfer and Base (TODAY-GAP, gap review
// proposal 7, BR-TODAY-19): what each provider shows, that it reads
// only, that Sensitive work (ctx.strict) names nobody, and that the
// shell loads the providers after their cores.
// Run: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const A = require("../today/agg.js");
const S = require("../scanpdf/sign-core.js");
const SP = require("../scanpdf/today.js");
const TC = require("../transfer/core.js");
const TP = require("../transfer/today.js");
const BC = require("../base/core.js");
const BP = require("../base/today.js");
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

const HOUR = 3600000, DAY = 24 * HOUR;
const NOW = new Date(2026, 10, 17, 10, 0).getTime();          // 17 Nov 2026, 10:00 local
const TODAY = "2026-11-17";
function ctxOf(store, o) {
  o = o || {};
  return {
    today: TODAY, horizon: A.HORIZON, now: NOW, lang: o.lang || "en", strict: !!o.strict,
    readJSON: (k) => (k in store ? JSON.parse(JSON.stringify(store[k])) : null),
    readRaw: (k) => (k in store ? JSON.stringify(store[k]) : null), addDays: A.addDays, diff: A.diff
  };
}
const clean = (rows, app) => rows.map((r) => A.cleanRow(r, app)).filter(Boolean);
const all = (rows) => JSON.stringify(rows);

// ---------- Scanner & PDF ----------
function request(over) {
  return Object.assign({ v: 1, n: "Lease", h: "a".repeat(64), pages: 1, by: "Chris", to: "Maria", lang: "en",
    fields: [{ id: "f1", pg: 0, fx: 0.5, fy: 0.8, w: 0.3, h: 0.06, k: "sig", req: true }] }, over || {});
}
function item(id, over) {
  return Object.assign({ id, a: NOW - 2 * DAY, q: request(), x: NOW + 7 * DAY,
    c: "r1." + "A".repeat(22) + "." + "B".repeat(43) + ".1" }, over || {});
}
const I = (n) => "s".repeat(21) + n;

test("Scanner & PDF: waiting requests, a link that ends soon, answers of the last day", () => {
  let s = S.addItem(null, item(I(1)));                                              // waiting, ends in 7 days
  s = S.addItem(s, item(I(2), { q: request({ n: "Offer", to: "Nikos" }), x: NOW + 5 * HOUR }));   // ends today 15:00
  s = S.addItem(s, item(I(3), { q: request({ n: "Deed" }) }));
  s = S.setGot(s, I(3), { at: NOW - 2 * HOUR, st: "signed", nm: "Maria P." });     // signed 2 h ago
  s = S.addItem(s, item(I(4), { q: request({ n: "Old" }) }));
  s = S.setGot(s, I(4), { at: NOW - 3 * DAY, st: "signed", nm: "X" });             // too long ago
  s = S.addItem(s, item(I(5), { q: request({ n: "Loan", to: "Eleni" }) }));
  s = S.setGot(s, I(5), { at: NOW - HOUR, st: "declined", nm: "" });
  s = S.addItem(s, item(I(6), { x: NOW - HOUR }));                                  // expired: nothing
  const store = { "oros-scanpdf-sign": s }, before = all(store);
  const rows = clean(SP.collect(ctxOf(store)), "scanpdf");
  assert.equal(all(store), before, "read-only");
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.deepEqual(Object.keys(by).sort(), ["end-" + I(2), "got-" + I(3), "got-" + I(5), "waiting"].sort());
  assert.equal(by.waiting.title, "2 signature requests waiting");
  assert.equal(by.waiting.kind, "info");
  const end = by["end-" + I(2)];
  assert.equal(end.kind, "event"); assert.equal(end.due, TODAY); assert.equal(end.time, "15:00");
  assert.equal(end.title, "Signing link ends: Offer"); assert.equal(end.text, "To Nikos");
  assert.match(end.tip, /reminder/);
  assert.equal(by["got-" + I(3)].title, "Signed: Deed"); assert.equal(by["got-" + I(3)].text, "By Maria P.");
  assert.equal(by["got-" + I(5)].title, "Declined: Loan"); assert.equal(by["got-" + I(5)].text, "By Eleni");
  rows.forEach((r) => assert.deepEqual(r.target, { signList: 1 }));
  // Greek
  const el = clean(SP.collect(ctxOf(store, { lang: "el" })), "scanpdf");
  assert.equal(el.find((r) => r.id === "waiting").title, "2 αιτήσεις υπογραφής σε αναμονή");
  // nothing stored → nothing
  assert.deepEqual(SP.collect(ctxOf({})), []);
  assert.deepEqual(SP.collect(ctxOf({ "oros-scanpdf-sign": "junk" })), []);
});

test("Scanner & PDF: several signers are one row; Sensitive work names no document or person", () => {
  const G = "g".repeat(22);
  let s = S.addItem(null, item(I(1), { g: { id: G, i: 0, n: 2 } }));
  s = S.addItem(s, item(I(2), { q: request({ to: "Nikos" }), g: { id: G, i: 1, n: 2 } }));
  s = S.setGot(s, I(1), { at: NOW - HOUR, st: "signed", nm: "Maria" });
  const store = { "oros-scanpdf-sign": s };
  const rows = clean(SP.collect(ctxOf(store)), "scanpdf");
  assert.deepEqual(rows.map((r) => [r.id, r.title]), [["waiting", "1 signature request waiting"], ["got-g-" + G, "1 of 2 signed: Lease"]]);
  const veiled = clean(SP.collect(ctxOf(store, { strict: true })), "scanpdf");
  assert.ok(!/Lease|Maria|Nikos/.test(all(veiled)), all(veiled));
  assert.equal(veiled[1].title, "A signature request was answered");
  s = S.setGot(s, I(2), { at: NOW - 60000, st: "signed", nm: "Nikos" });
  assert.equal(clean(SP.collect(ctxOf({ "oros-scanpdf-sign": s })), "scanpdf")[0].title, "Signed by everyone: Lease");
});

// ---------- Transfer ----------
test("Transfer: transfers received in the last day, links of this device that end soon", () => {
  const hist = TC.mergeHistory({ items: [
    { id: "trecv01", at: NOW - HOUR, dir: "recv", n: 3, bytes: 10, what: "Holiday", dev: "Chrome · Android", mode: "direct", dest: "disk", end: "done", folder: "/internal/Transfers/2026-11-17 09.00" },
    { id: "trecv02", at: NOW - 2 * HOUR, dir: "recv", n: 1, bytes: 1, what: "cv.pdf", dev: "", bad: 0, mode: "relay", dest: "device", end: "done" },
    { id: "trecv03", at: NOW - 3 * HOUR, dir: "recv", n: 1, bytes: 1, what: "half", end: "stopped" },
    { id: "trecv04", at: NOW - 2 * DAY, dir: "recv", n: 1, bytes: 1, what: "old", end: "done" },
    { id: "tsent01", at: NOW - HOUR, dir: "sent", n: 1, bytes: 1, what: "mine", end: "done" }
  ] }, null, NOW);
  let links = TC.addLink(null, { id: "lnk00001", exp: NOW + 4 * HOUR, what: "Photos", n: 12 }, NOW);
  links = TC.addLink(links, { id: "lnk00002", exp: NOW + 10 * DAY, what: "Far", n: 1 }, NOW);
  links = TC.addLink(links, { id: "lnk00003", exp: NOW - 1, what: "Gone", n: 1 }, NOW);
  assert.deepEqual(links.items.map((x) => x.id), ["lnk00001", "lnk00002"], "a passed expiry is dropped");
  assert.deepEqual(TC.dropLink(links, "lnk00001", NOW).items.map((x) => x.id), ["lnk00002"]);
  const store = { "oros-transfer-data": hist, "oros-transfer-links": links }, before = all(store);
  const rows = clean(TP.collect(ctxOf(store)), "transfer");
  assert.equal(all(store), before, "read-only");
  assert.deepEqual(rows.map((r) => [r.id, r.kind, r.title]), [
    ["recv-trecv01", "info", "Received: Holiday"],
    ["recv-trecv02", "info", "Received: cv.pdf"],
    ["end-lnk00001", "event", "Transfer link ends: Photos"]
  ]);
  assert.equal(rows[0].text, "3 files · from Chrome · Android");
  assert.deepEqual(rows[0].target, { folder: "/internal/Transfers/2026-11-17 09.00" });
  assert.deepEqual(rows[1].target, { tab: "hist" });
  assert.equal(rows[2].due, TODAY); assert.equal(rows[2].time, "14:00"); assert.equal(rows[2].text, "12 files");
  assert.ok(rows[2].tip);
  const veiled = clean(TP.collect(ctxOf(store, { strict: true })), "transfer");
  assert.ok(!/Holiday|cv\.pdf|Photos|Chrome/.test(all(veiled)), all(veiled));
  assert.equal(veiled[0].title, "A transfer arrived");
  assert.equal(clean(TP.collect(ctxOf(store, { lang: "el" })), "transfer")[0].title, "Λήφθηκε: Holiday");
  assert.deepEqual(TP.collect(ctxOf({})), []);
});

test("Transfer: open goes to the received folder in Files, else to History; a bad folder never opens", () => {
  const calls = [];
  const win = { __orosOpenAt: (app, t) => calls.push([app, t]) };
  TP.open({ folder: "/internal/Transfers/2026-11-17 09.00" }, win);
  TP.open({ folder: "/internal/Notes/../x" }, win);
  TP.open({ tab: "hist" }, win);
  assert.deepEqual(calls, [["files", { path: "/internal/Transfers/2026-11-17 09.00", dir: true }],
    ["transfer", { tab: "hist" }], ["transfer", { tab: "hist" }]]);
  const app = read("transfer/app.js");
  assert.match(app, /keepLink\(r\.id, r\.exp, manifest\);/);
  assert.match(app, /job\.gone = true;\s*forgetLink\(job\.id\);/);
  assert.match(app, /target\.tab === "hist"\) \{ if \(\$\("tab-hist"\)\) tab\("hist"\); return; \}/);
});

// ---------- Base ----------
const NAMES = { field: "Name", grid: "Grid", cards: "Cards" };
function base(cal) {
  let d = BC.addBase(BC.empty(), "Clinic", 100, "b1");
  d = BC.addTable(d, "b1", "Visits", 110, NAMES, { t: "t1", f: "fname", v1: "v1", v2: "v2" });
  d = BC.addField(d, "t1", "Visit", "date", { time: true }, 120, "fday");
  d = BC.addField(d, "t1", "Follow-up", "date", {}, 121, "fup");
  d = BC.addRecord(d, "t1", { fname: "Ann", fday: "2026-11-17T09:30", fup: "2026-11-19" }, 200, "r1").data;
  d = BC.addRecord(d, "t1", { fname: "Bob", fday: "2026-11-16T09:30", fup: "2026-11-25" }, 201, "r2").data;
  if (cal) {
    d.fields.filter((f) => cal.indexOf(f.id) >= 0).forEach((f) => {
      d = BC.putRow(d, "fields", Object.assign({}, f, { opt: Object.assign({}, f.opt, { cal: true }) }), 300);
    });
  }
  return d;
}

test("Base: only date fields with Show in Calendar on, today and the next days, as events", () => {
  assert.deepEqual(BP.collect(ctxOf({ "oros-base-data": base(null) })), [], "off by default");
  const store = { "oros-base-data": base(["fday", "fup"]) }, before = all(store);
  const rows = clean(BP.collect(ctxOf(store)), "base");
  assert.equal(all(store), before, "read-only");
  assert.deepEqual(rows.map((r) => [r.id, r.due, r.time, r.kind, r.title, r.text]), [
    ["r1-fday", TODAY, "09:30", "event", "Ann", "Visits · Visit"],
    ["r1-fup", "2026-11-19", null, "event", "Ann", "Visits · Follow-up"]
  ]);
  assert.deepEqual(rows[0].target, { base: "b1", table: "t1", rec: "r1" });
  const one = clean(BP.collect(ctxOf({ "oros-base-data": base(["fup"]) })), "base");
  assert.deepEqual(one.map((r) => r.id), ["r1-fup"]);
  const veiled = clean(BP.collect(ctxOf(store, { strict: true })), "base");
  assert.ok(!/Ann|Visits|Visit|Follow/.test(all(veiled.map((r) => [r.title, r.text]))), all(veiled));
  assert.equal(veiled[0].title, "Base record");
  assert.equal(clean(BP.collect(ctxOf(store, { strict: true, lang: "el" })), "base")[0].title, "Εγγραφή της Βάσης");
  assert.deepEqual(BP.collect(ctxOf({})), []);
});

// ---------- wiring ----------
test("apps.json loads each provider after its core; the shell passes Sensitive work as ctx.strict", () => {
  const apps = JSON.parse(read("apps.json"));
  const list = apps.apps || apps;
  const get = (id) => list.find((a) => a.id === id);
  assert.deepEqual(get("scanpdf").today, ["core.js", "sign-core.js", "today.js"]);
  assert.deepEqual(get("transfer").today, ["core.js", "today.js"]);
  assert.deepEqual(get("base").today, ["feed.js", "today.js"]);
  const host = read("today/host.js");
  assert.equal((host.match(/strict: strictOn\(\)/g) || []).length, 3, "build, agenda and week");
  assert.match(host, /S\.level\(\)/);
});
