// Assistant and Calendar labels (AS-LBL): the Assistant reads an
// event's label (search text, app_summary calendar with label / month,
// "none" = no label), changes it with change_item (label = a label's
// name, "none" takes it off), and one card can carry the same update
// to several items (refs). Pure parts in node; static checks on the
// wiring in assistant.js and core.js.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const E = require("../assistant/edits.js");
const S = require("../assistant/summary.js");
const C = require("../assistant/core.js");
const P = require("../calendar/search.js");

const NOW = 1760000000000;
const ok = (args) => { const r = E.normArgs(args); assert.equal(r.ok, true, r.err); return r; };

function cal() {
  return {
    ver: 1,
    labels: [
      { id: "lbl-personal", name: "Personal", color: "#7aa2f7", mtime: 0 },
      { id: "lbl-work", name: "Work", color: "#9ece6a", mtime: 0 },
      { id: "lbl-x", name: "Ίβρος", color: "#e0af68", mtime: 5 }
    ],
    events: [
      { id: "e1", date: "2026-10-12", start: "10:00", end: "11:00", title: "Wave", note: "", location: "Port", labelId: "lbl-work", mtime: 1 },
      { id: "e2", date: "2026-11-03", start: null, end: null, title: "Wave (?)", note: "check", location: "", labelId: null, mtime: 1 },
      { id: "e3", date: "2026-11-09", title: "APG", labelId: "lbl-gone", mtime: 1 },
      { id: "e4", date: "2026-06-05", title: "Ανδρεάδης", mtime: 1 },
      { id: "e5", date: "2026-01-01", title: "Gym", labelId: "lbl-x", recur: { freq: "W" }, mtime: 1 }
    ],
    deleted: []
  };
}

// ---------- reading ----------
test("search text shows the event's label (seeds in the shown language); no label adds nothing", () => {
  const d = cal();
  const run = (lang) => P.search({ lang, readJSON: () => d });
  const en = run("en"), el = run("el");
  assert.match(en.find((h) => h.id === "e1").text, /Label: Work/);
  assert.match(el.find((h) => h.id === "e1").text, /Ετικέτα: Εργασία/);
  assert.match(en.find((h) => h.id === "e5").text, /Label: Ίβρος/);
  assert.doesNotMatch(en.find((h) => h.id === "e2").text, /Label/);
  assert.doesNotMatch(en.find((h) => h.id === "e3").text, /Label/);     // a removed label is no label
});

test("summary args: calendar takes label and says whether a month was given", () => {
  assert.deepEqual(S.normArgs({ app: "calendar", label: "  none " }, "2026-10-23"),
    { ok: true, app: "calendar", month: "2026-10", days: 7, monthSet: false, label: "none" });
  assert.equal(S.normArgs({ app: "calendar", month: "2026-11" }, "2026-10-23").monthSet, true);
  assert.equal(S.normArgs({ app: "budget", label: "x" }, "2026-10-23").label, undefined);
});

test("calendar summary: each label with its count, and how many have none", () => {
  const s = S.calendarEvents(cal(), {});
  assert.deepEqual(s.labels, [
    { name: "Personal / Προσωπικό", events: 0 },
    { name: "Work / Εργασία", events: 1 },
    { name: "Ίβρος", events: 1 }
  ]);
  assert.equal(s.no_label, 3);
  assert.equal(s.events, 5);
  assert.equal(s.items, undefined);
});

test("calendar summary: label none lists the events without a label, every date, with every field and a target", () => {
  const s = S.calendarEvents(cal(), { label: "none" });
  assert.deepEqual(s.items.map((i) => i.title), ["Ανδρεάδης", "Wave (?)", "APG"]);
  assert.equal(s.filter_label, "none");
  const w = s.items.find((i) => i.title === "Wave (?)");
  assert.equal(w.label, "");
  assert.equal(w.note, "check");
  assert.deepEqual(w.target, { id: "e2", date: "2026-11-03" });
});

test("calendar summary: a label by either name (case and accents aside); an unknown one names the real ones", () => {
  assert.deepEqual(S.calendarEvents(cal(), { label: "εργασια" }).items.map((i) => i.title), ["Wave"]);
  assert.deepEqual(S.calendarEvents(cal(), { label: "WORK" }).items.map((i) => i.time), ["10:00–11:00"]);
  assert.deepEqual(S.calendarEvents(cal(), { label: "ιβρος" }).items.map((i) => i.repeats), [true]);
  const bad = S.calendarEvents(cal(), { label: "Holidays" });
  assert.equal(bad.ok, false);
  assert.match(bad.err, /Work \/ Εργασία/);
});

test("calendar summary: a month lists that month's events (a repeating one from its start on)", () => {
  const s = S.calendarEvents(cal(), { month: "2026-11" });
  assert.deepEqual(s.items.map((i) => i.title), ["Gym", "Wave (?)", "APG"]);
  assert.equal(s.month, "2026-11");
  const lines = S.preview(s, "el");
  assert.match(lines[0], /^Ετικέτες: Προσωπικό \/ Προσωπικό|^Ετικέτες: Personal/);
  assert.ok(lines.some((l) => /Χωρίς ετικέτα \(3\)/.test(l)));
  assert.ok(lines.some((l) => /Gym · Ετικέτα: Ίβρος/.test(l)));
});

test("calendar summary: more than the cap is counted, not sent", () => {
  const d = cal();
  for (let i = 0; i < 70; i++) d.events.push({ id: "n" + i, date: "2025-01-" + String(1 + (i % 28)).padStart(2, "0"), title: "N" + i, mtime: 1 });
  const s = S.calendarEvents(d, { label: "none" });
  assert.equal(s.items.length, 60);
  assert.equal(s.listed, 73);
  assert.equal(s.more_items, 13);
});

// ---------- changing ----------
test("normArgs: label is a name, none or empty takes it off", () => {
  assert.equal(ok({ ref: "r1", action: "update", label: " Work " }).set.label, "Work");
  assert.equal(ok({ ref: "r1", action: "update", label: "none" }).set.label, "");
  assert.equal(ok({ ref: "r1", action: "update", label: "" }).set.label, "");
  assert.equal(E.normArgs({ ref: "r1", action: "reschedule", date: "2026-10-20", label: "Work" }).ok, false);
});

test("calendar: a label is set by name (either name of a seed), with a new mtime, and Undo puts the old one back", () => {
  const d = cal();
  const pl = E.plan("calendar", d, { id: "e2" }, ok({ ref: "r1", action: "update", label: "Εργασία" }), NOW);
  assert.equal(pl.ok, true, pl.err);
  assert.deepEqual(pl.rows, [{ f: "label", b: "", a: "Work / Εργασία" }]);
  const ap = E.apply("calendar", d, { id: "e2" }, ok({ ref: "r1", action: "update", label: "Εργασία" }), NOW, pl.before);
  const ev = ap.data.events.find((e) => e.id === "e2");
  assert.equal(ev.labelId, "lbl-work");
  assert.equal(ev.mtime, NOW);
  assert.equal(d.events[1].labelId, null);                   // the input is not touched
  const un = E.undo("calendar", ap.data, ap.undo, NOW + 1);
  assert.equal(un.ok, true, un.err);
  const back = un.data.events.find((e) => e.id === "e2");
  assert.equal(back.labelId, null);
  assert.equal(back.mtime, NOW + 1);
});

test("calendar: none takes the label off; a repeating event's label can change; unknown names are refused", () => {
  const d = cal();
  const off = E.apply("calendar", d, { id: "e1" }, ok({ ref: "r1", action: "update", label: "none" }), NOW);
  assert.equal(off.data.events[0].labelId, null);
  const rep = E.apply("calendar", d, { id: "e5" }, ok({ ref: "r1", action: "update", label: "work" }), NOW);
  assert.equal(rep.ok, true, rep.err);
  const bad = E.plan("calendar", d, { id: "e1" }, ok({ ref: "r1", action: "update", label: "Holidays" }), NOW);
  assert.equal(bad.ok, false);
  assert.match(bad.err, /no label named "Holidays".*Ίβρος.*Manage labels/);
  const same = E.plan("calendar", d, { id: "e1" }, ok({ ref: "r1", action: "update", label: "Work" }), NOW);
  assert.match(same.err, /^Nothing would change/);
  assert.equal(E.plan("todo", { items: {} }, { id: "x" }, ok({ ref: "r1", action: "update", label: "Work" }), NOW).ok, false);
});

test("calendar: Undo refuses when the label changed again since", () => {
  const d = cal();
  const ap = E.apply("calendar", d, { id: "e2" }, ok({ ref: "r1", action: "update", label: "Work" }), NOW);
  const again = E.apply("calendar", ap.data, { id: "e2" }, ok({ ref: "r1", action: "update", label: "Ίβρος" }), NOW + 1);
  assert.equal(E.undo("calendar", again.data, ap.undo, NOW + 2).ok, false);
});

// ---------- wiring ----------
test("tools: change_item takes label and refs; app_summary takes label; the prompt names labels only with Calendar", () => {
  const tools = C.toolsFor({ data: true, summary: true, changes: true });
  const chg = tools.find((t) => t.name === "change_item"), sum = tools.find((t) => t.name === "app_summary");
  assert.ok(chg.params.properties.label && chg.params.properties.refs);
  assert.deepEqual(chg.params.required, ["action"]);
  assert.ok(sum.params.properties.label);
  const base = { lang: "en", now: NOW, changes: ["Calendar (calendar)"] };
  assert.match(C.systemPrompt(Object.assign({ apps: ["Calendar (calendar)"] }, base)), /Calendar events can have a label/);
  assert.doesNotMatch(C.systemPrompt(Object.assign({ apps: ["Notes (notes)"] }, base)), /Calendar events can have a label/);
});

test("assistant.js: refs go through one card, are checked again on Apply, and undo all or none", () => {
  const src = fs.readFileSync(path.join(ROOT, "assistant/assistant.js"), "utf8");
  const many = src.slice(src.indexOf("function changeMany("), src.indexOf("function undoChange("));
  assert.match(many, /args\.action !== "update"/);
  assert.match(many, /MANY_MAX/);
  assert.match(many, /refs must all be items of the same app/);
  assert.match(many, /E\.apply\(app\.id, d, p\.x\.target, p\.x\.ch, t2, p\.pl\.before\)/);
  assert.equal((many.match(/writeStore\(/g) || []).length, 1);
  const undo = src.slice(src.indexOf("function undoChange("), src.indexOf("function chgValue("));
  assert.match(undo, /mem\.undos\.length - 1; i >= 0 && res\.ok; i--/);
  assert.match(src, /if \(a\.app === "calendar"\) \{\s*own = S\.calendarEvents/);
});
