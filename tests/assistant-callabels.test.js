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
  for (let i = 0; i < 210; i++) d.events.push({ id: "n" + i, date: "2025-01-" + String(1 + (i % 28)).padStart(2, "0"), title: "N" + i, mtime: 1 });
  const s = S.calendarEvents(d, { label: "none" });
  assert.equal(s.items.length, 200);
  assert.equal(s.listed, 213);
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
test("tools: change_item takes label, labels, priority and refs; app_summary takes label; the prompt names labels", () => {
  const tools = C.toolsFor({ data: true, summary: true, changes: true });
  const chg = tools.find((t) => t.name === "change_item"), sum = tools.find((t) => t.name === "app_summary");
  assert.ok(chg.params.properties.label && chg.params.properties.labels && chg.params.properties.priority && chg.params.properties.refs);
  const srch = tools.find((t) => t.name === "search_data");
  assert.ok(srch.params.properties.label);
  assert.equal(srch.params.required, undefined);
  assert.deepEqual(chg.params.required, ["action"]);
  assert.ok(sum.params.properties.label);
  const base = { lang: "en", now: NOW, changes: ["Calendar (calendar)"] };
  assert.match(C.systemPrompt(Object.assign({ apps: ["Calendar (calendar)"] }, base)), /For Calendar, app_summary/);
  assert.doesNotMatch(C.systemPrompt(Object.assign({ apps: ["Notes (notes)"] }, base)), /For Calendar, app_summary/);
  assert.match(C.systemPrompt(Object.assign({ apps: ["Notes (notes)"] }, base)), /search_data with label/);
});

test("assistant.js: refs go through one card, are checked again on Apply, and undo all or none", () => {
  const src = fs.readFileSync(path.join(ROOT, "assistant/assistant.js"), "utf8");
  const many = src.slice(src.indexOf("function changeMany("), src.indexOf("function changeList("));
  assert.match(many, /args\.action !== "update"/);
  assert.match(many, /MANY_MAX/);
  assert.match(many, /refs must all be items of the same app/);
  assert.match(many, /E\.apply\(app\.id, d, p\.x\.target, p\.x\.ch, t2, p\.pl\.before\)/);
  assert.equal((many.match(/writeStore\(/g) || []).length, 1);
  const undo = src.slice(src.indexOf("function runUndo("), src.indexOf("function undoById("));
  assert.match(undo, /mem\.undos\.length - 1; i >= 0 && res\.ok; i--/);
  assert.match(src, /if \(a\.app === "calendar"\) \{\s*own = S\.calendarEvents/);
});

// ---------- labels everywhere (Chris 2026-10-24) ----------
const TODO = () => ({
  ver: 3, deleted: { "lb-old": 50 },
  labels: [{ id: "lb-home", name: "Home", color: "#fff", mtime: 1 }, { id: "lb-urgent", name: "Urgent", color: "#fff", mtime: 1 },
           { id: "lb-old", name: "Old", color: "#fff", mtime: 1 }],
  lists: [{ id: "l1", name: "Inbox", mtime: 1, items: [
    { id: "t1", text: "Call plumber", done: false, due: "", notes: "", labels: ["lb-home"], mtime: 1 },
    { id: "t2", text: "Pay rent", done: true, due: "", notes: "", labels: [], prio: 1, mtime: 1 }
  ] }]
});

test("todo: labels replace, label adds, none clears; a deleted label is unknown; priority 1-4", () => {
  const d = TODO();
  let ap = E.apply("todo", d, { list: "l1", item: "t1" }, ok({ ref: "r1", action: "update", label: "urgent" }), NOW);
  assert.deepEqual(ap.data.lists[0].items[0].labels, ["lb-home", "lb-urgent"]);
  assert.equal(ap.data.lists[0].items[0].fm.labels, NOW);
  ap = E.apply("todo", d, { list: "l1", item: "t1" }, ok({ ref: "r1", action: "update", labels: ["Urgent"] }), NOW);
  assert.deepEqual(ap.data.lists[0].items[0].labels, ["lb-urgent"]);
  ap = E.apply("todo", d, { list: "l1", item: "t1" }, ok({ ref: "r1", action: "update", label: "none" }), NOW);
  assert.deepEqual(ap.data.lists[0].items[0].labels, []);
  const old = E.plan("todo", d, { list: "l1", item: "t1" }, ok({ ref: "r1", action: "update", label: "Old" }), NOW);
  assert.match(old.err, /no label named "Old".*Home, Urgent/);
  const pl = E.plan("todo", d, { list: "l1", item: "t1" }, ok({ ref: "r1", action: "update", priority: 2 }), NOW);
  assert.deepEqual(pl.rows, [{ f: "priority", b: "", a: "P2" }]);
  const pr = E.apply("todo", d, { list: "l1", item: "t2" }, ok({ ref: "r1", action: "update", priority: "p4" }), NOW);
  assert.equal(pr.data.lists[0].items[1].prio, undefined);
  assert.equal(pr.data.lists[0].items[1].xf.prio, NOW);
  const un = E.undo("todo", pr.data, pr.undo, NOW + 1);
  assert.equal(un.ok, true, un.err);
  assert.equal(un.data.lists[0].items[1].prio, 1);
  assert.equal(E.normArgs({ ref: "r1", action: "update", priority: 7 }).ok, false);
  assert.equal(E.normArgs({ ref: "r1", action: "update", label: "a", labels: ["b"] }).ok, false);
});

test("kanban: card labels from the board's labels, group l stamped, Undo puts them back", () => {
  const d = { ver: 1, boards: [{ id: "b1", name: "Home", mtime: 1, om: 1, labels: [{ id: "k1", name: "Bug", color: "#f00" }, { id: "k2", name: "Idea", color: "#0f0" }],
    deleted: {}, columns: [{ id: "c1", name: "To do", mtime: 1, om: 1, cards: [{ id: "x1", text: "Fix tap", notes: "", labels: [], subtasks: [], info: [], mtime: 1 }] }] }] };
  const ap = E.apply("kanban", d, { board: "b1", card: "x1" }, ok({ ref: "r1", action: "update", labels: ["idea", "BUG"] }), NOW);
  const card = ap.data.boards[0].columns[0].cards[0];
  assert.deepEqual(card.labels, ["k2", "k1"]);
  assert.equal(card.fm.l, NOW);
  assert.match(E.plan("kanban", d, { board: "b1", card: "x1" }, ok({ ref: "r1", action: "update", label: "Later" }), NOW).err, /Bug, Idea/);
  const un = E.undo("kanban", ap.data, ap.undo, NOW + 1);
  assert.deepEqual(un.data.boards[0].columns[0].cards[0].labels, []);
});

test("contacts: labels by name (a seed in either language), kept sorted, stamped per field", () => {
  const d = { ver: 1, labels: [{ id: "lbl-work", name: "Εργασία", color: "#e06c75", mtime: 0 }, { id: "lbl-x", name: "Gym", color: "#7aa2f7", mtime: 4 }],
    contacts: [{ id: "c1", given: "Anna", family: "P", labelIds: [], mtime: 1 }], deleted: [] };
  const ap = E.apply("contacts", d, "c1", ok({ ref: "r1", action: "update", labels: ["gym", "Work"] }), NOW);
  const c = ap.data.contacts[0];
  assert.deepEqual(c.labelIds, ["lbl-work", "lbl-x"]);
  assert.equal(c.fm.labelIds, c.mtime);
  assert.equal(ap.rows ? ap.rows.find((r) => r.f === "labels").a : "", "Εργασία, Gym");
  const un = E.undo("contacts", ap.data, ap.undo, NOW + 1);
  assert.deepEqual(un.data.contacts[0].labelIds, []);
});

test("bookmarks: tags are free words; label adds keeping an old spelling, labels sets, none clears; Undo", () => {
  const d = { items: { b1: { id: "b1", url: "https://x.org", title: "X", note: "", tags: ["News"], modified: 1 } }, deleted: {} };
  let ap = E.apply("bookmarks", d, { id: "b1" }, ok({ ref: "r1", action: "update", label: "read later" }), NOW);
  assert.deepEqual(ap.data.items.b1.tags, ["News", "read later"]);
  assert.equal(ap.data.items.b1.modified, NOW);
  ap = E.apply("bookmarks", d, { id: "b1" }, ok({ ref: "r1", action: "update", labels: ["news", "AI"] }), NOW);
  assert.deepEqual(ap.data.items.b1.tags, ["News", "AI"]);
  const un = E.undo("bookmarks", ap.data, ap.undo, NOW + 1);
  assert.deepEqual(un.data.items.b1.tags, ["News"]);
  assert.deepEqual(E.apply("bookmarks", d, { id: "b1" }, ok({ ref: "r1", action: "update", label: "none" }), NOW).data.items.b1.tags, []);
});

// ---------- reading and the filter ----------
const PROV = (app) => require("../" + app + "/search.js");
test("search hits carry labels and the hidden fields: To-Do, Kanban, Contacts, Notes, Shelf, Bookmarks", () => {
  const ctx = (data, lang) => ({ lang: lang || "en", code: lang || "en", readJSON: () => data });
  const td = PROV("todo").search(ctx(TODO()));
  const t2 = td.find((h) => h.id === "t2"), t1 = td.find((h) => h.id === "t1");
  assert.match(t2.text, /^Done · Priority 1/);
  assert.deepEqual(t1.labels, ["Home"]);
  assert.match(t1.text, /Labels: Home/);
  assert.deepEqual(t2.labels, []);
  assert.match(PROV("todo").search(ctx(TODO(), "el")).find((h) => h.id === "t1").text, /Ετικέτες: Home/);
  const ct = PROV("contacts").search(ctx({ labels: [{ id: "l1", name: "Gym" }], contacts: [{ id: "c1", given: "Anna", labelIds: ["l1"], starred: true }] }));
  assert.equal(ct[0].text, "Favorite · Labels: Gym");
  assert.deepEqual(ct[0].labels, ["Gym"]);
  const nt = PROV("notes").search(ctx({ notebooks: [{ id: "n1", name: "Work" }], labels: [{ id: "a", name: "Draft" }], pages: [{ id: "p1", nb: "n1", title: "Plan", text: "body", labels: ["a"] }] }));
  assert.equal(nt[0].text, "📓 Work · Labels: Draft · body");
  assert.deepEqual(nt[0].labels, ["Draft"]);
  const bm = PROV("bookmarks").search(ctx({ items: { b: { id: "b", url: "https://x.org", title: "X", tags: ["ai"] } } }));
  assert.deepEqual(bm[0].labels, ["ai"]);
  const S2 = require("../search.js");
  assert.deepEqual(S2.cleanHit({ title: "x", labels: ["a", 3, " b "] }).labels, ["a", "b"]);
  assert.equal(S2.cleanHit({ title: "x" }).labels, undefined);
});

test("label filter: none, a name with its seed names, apps without labels drop out, 200 per app", () => {
  assert.equal(C.labelHit([], "none"), true);
  assert.equal(C.labelHit(["Work"], "none"), false);
  assert.equal(C.labelHit(["Εργασία"], "work"), true);
  assert.equal(C.labelHit(["Arbeit"], "ΕΡΓΑΣΙΑ"), true);
  assert.equal(C.labelHit(["Workout"], "work"), false);
  assert.equal(C.labelHit(undefined, "none"), false);
  const hits = [];
  for (let i = 0; i < 210; i++) hits.push({ id: "h" + i, title: "E" + i, text: "", labels: [] });
  const f = C.filterLabel([{ id: "calendar", hits }, { id: "files", hits: [{ id: "f", title: "doc" }] }], "none");
  assert.deepEqual(f.apps, ["calendar"]);
  assert.deepEqual(f.more, { calendar: 10 });
  const packed = C.packHits(f.groups, (id) => id, { wide: true, label: true });
  assert.equal(packed.length, 200);
  assert.equal(C.packHits(f.groups, (id) => id, { wide: true }).length, 50);
  assert.equal(C.packHits(f.groups, (id) => id).length, 8);
  const res = JSON.parse(C.searchResult("", packed.slice(0, 1).map((x) => Object.assign(x, { ref: "r1" })), { label: "none", more: { Calendar: 10 }, noLabels: ["Files"] }));
  assert.equal(res.label, "none");
  assert.deepEqual(res.results[0].labels, []);
  assert.deepEqual(res.apps_without_labels, ["Files"]);
});

test("shell: the Assistant's search has an all-items mode for the label filter", () => {
  const sh = fs.readFileSync(path.join(ROOT, "shell.js"), "utf8");
  assert.match(sh, /window\.orosAssistSearch = function \(q, ids, opts\)/);
  assert.match(sh, /if \(opts && opts\.all\) \{/);
  const src = fs.readFileSync(path.join(ROOT, "assistant/assistant.js"), "utf8");
  assert.match(src, /orosAssistSearch\(q, ids, \{ all: !q \}\)/);
  assert.match(src, /C\.filterLabel\(groups, label\)/);
});

// ---------- 200 in one card (Chris 2026-10-25) ----------
test("refs take up to 200; label lists and calendar lists reach 200; the card sums up and shows 10 first", () => {
  const src = fs.readFileSync(path.join(ROOT, "assistant/assistant.js"), "utf8");
  assert.match(src, /var MANY_MAX = 200;/);
  assert.match(src, /var CHG_SHOWN = 10;/);
  assert.match(src, /"chg\.showAll":/);
  assert.match(src, /label: !!label \}\);/);
  const C2 = C;
  assert.equal(C2.WIDE, 50);
  assert.equal(C2.LABEL_WIDE, 200);
  const g = [{ id: "calendar", hits: Array.from({ length: 250 }, (_, i) => ({ id: "e" + i, title: "E" + i, text: "", labels: [] })) }];
  assert.equal(C2.packHits(g, (x) => x, { wide: true, label: true }).length, 200);
  assert.equal(C2.packHits(g, (x) => x, { wide: true }).length, 50);
  const f = C2.filterLabel(g, "none");
  assert.equal(f.more.calendar, 50);
  const S2 = S;
  const events = Array.from({ length: 230 }, (_, i) => ({ id: "e" + i, title: "E" + i, date: "2026-11-" + String(1 + (i % 28)).padStart(2, "0") }));
  const out = S2.calendarEvents({ events: events, labels: [] }, { label: "none" });
  assert.equal(out.items.length, 200);
  assert.equal(out.more_items, 30);
});
