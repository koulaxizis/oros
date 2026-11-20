// Focus modes (focus.js, FOCUS-1 wave F1): the model (modes, manual
// choice, the Sleep schedule = quiet hours, the merge), and the wiring
// in notifications.js, Quick settings, Settings, the page and strings.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const F = require(path.join(ROOT, "focus/core.js"));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const at = (h, m) => new Date(2026, 10, 18, h, m || 0, 0).getTime();
const QH = { enabled: true, quietHoursStart: 22, quietHoursEnd: 8 };

test("normalize: built-ins always first, own modes need a name, at most 10", () => {
  const f = F.normalize(null);
  assert.deepEqual(f.modes.map((m) => m.id), ["dnd", "sleep", "work", "personal"]);
  assert.equal(f.act.id, "");
  assert.equal(F.modeOf(f, "dnd").allow.length, 0);
  assert.ok(F.modeOf(f, "work").allow.includes("calendar"));
  const many = { modes: [{ id: "m_x", name: "" }, { id: "bad id", name: "Bad" }, { id: "dnd", allow: ["mail"] }] };
  for (let i = 0; i < 12; i++) many.modes.push({ id: "m_a" + i, name: "Mode " + i, icon: "nope", allow: ["mail", "mail", "Bad NS"] });
  const g = F.normalize(many);
  assert.equal(g.modes.length, 4 + F.MAX_OWN);
  assert.equal(F.modeOf(g, "dnd").allow.length, 0, "Do Not Disturb lets nothing through");
  assert.equal(F.modeOf(g, "m_x"), null);
  assert.equal(F.modeOf(g, "m_a0").icon, "star");
  assert.deepEqual(F.modeOf(g, "m_a0").allow, ["mail"]);
  assert.equal(F.normalize({ act: { id: "gone", until: 5, at: 9 } }).act.id, "");
});

test("a manual mode: until off, until a time, then the schedule again", () => {
  let f = F.started(null, "work", 0, at(10));
  assert.deepEqual(F.activeAt(f, {}, at(23)), { id: "work", until: 0, by: "manual" });
  f = F.started(null, "work", at(11), at(10));
  assert.equal(F.activeAt(f, {}, at(10, 30)).id, "work");
  assert.equal(F.activeAt(f, {}, at(11)), null);
  assert.equal(F.activeAt(f, QH, at(23)).id, "sleep");
  assert.equal(F.started(null, "nope", 0, at(10)).act.id, "", "an unknown mode never starts");
});

test("quiet hours are the Sleep schedule; off during it lasts until the window ends", () => {
  const se = F.sleepEnds(QH, at(23));
  assert.equal(se, new Date(2026, 10, 19, 8, 0, 0).getTime());
  assert.equal(F.sleepEnds(QH, at(7)), at(8));
  assert.equal(F.sleepEnds(QH, at(12)), 0);
  assert.equal(F.sleepEnds({ enabled: false, quietHoursStart: 22, quietHoursEnd: 8 }, at(23)), 0);
  assert.deepEqual(F.activeAt(null, QH, at(23)), { id: "sleep", until: se, by: "schedule" });
  const off = F.stopped(null, QH, at(23));
  assert.equal(F.activeAt(off, QH, at(23, 30)), null);
  assert.equal(F.activeAt(off, QH, new Date(2026, 10, 19, 22, 30).getTime()).id, "sleep", "the next night it runs again");
  const off2 = F.stopped(F.started(null, "work", 0, at(12)), QH, at(13));
  assert.equal(off2.act.until, 0);
  assert.equal(F.activeAt(off2, QH, at(14)), null);
});

test("silent: only the apps a running mode lets through pop up", () => {
  const f = F.started(null, "work", 0, at(10));
  assert.equal(F.silent(f, {}, "mail", at(10)), false);
  assert.equal(F.silent(f, {}, "games", at(10)), true);
  assert.equal(F.silent(null, {}, "games", at(10)), false, "no mode, no silence");
  assert.equal(F.silent(F.started(null, "dnd", 0, at(10)), {}, "calendar", at(10)), true);
  assert.equal(F.silent(null, QH, "mail", at(23)), true, "Sleep lets nothing through by default");
});

test("edit, add, remove: stamps move only on a real change", () => {
  let f = F.edited(null, "work", { allow: ["mail"] }, at(10));
  assert.deepEqual(F.modeOf(f, "work").allow, ["mail"]);
  const r1 = f.mrev;
  assert.equal(F.edited(f, "work", { allow: ["mail"] }, at(11)).mrev, r1, "no change, no stamp");
  f = F.edited(f, "dnd", { allow: ["mail"], name: "  Quiet\n please ", icon: "leaf" }, at(12));
  assert.deepEqual(F.modeOf(f, "dnd").allow, []);
  assert.equal(F.modeOf(f, "dnd").name, "Quiet please");
  assert.equal(F.modeOf(f, "dnd").icon, "leaf");
  let seq = 0;
  const rand = () => ((seq++ * 7) % 36) / 36;
  const r = F.added(f, "Reading", "book", at(13), rand);
  assert.match(r.id, /^m_[a-z0-9]{8}$/);
  f = F.started(r.f, r.id, 0, at(14));
  assert.equal(F.edited(f, r.id, { name: "" }, at(15)).modes.find((m) => m.id === r.id).name, "Reading", "an own mode keeps a name");
  const gone = F.removed(f, r.id, at(16));
  assert.equal(F.modeOf(gone, r.id), null);
  assert.equal(gone.act.id, "", "a deleted running mode stops");
  assert.equal(F.removed(f, "work", at(16)).modes.length, f.modes.length, "built-ins stay");
  assert.equal(F.added(f, "   ", "star", at(17)).id, null);
});

test("merge: newer list and newer choice win separately, symmetric", () => {
  const listA = F.edited(null, "work", { allow: ["mail"] }, at(10));          // device A edits Work at 10:00
  const actB = F.started(null, "personal", 0, at(11));                         // device B starts Personal at 11:00
  const m1 = F.merge(listA, actB), m2 = F.merge(actB, listA);
  assert.deepEqual(m1, m2);
  assert.deepEqual(F.modeOf(m1, "work").allow, ["mail"]);
  assert.equal(m1.act.id, "personal");
  const offA = F.stopped(actB, {}, at(12));
  assert.equal(F.merge(offA, actB).act.id, "", "a later off wins");
  assert.deepEqual(F.merge(undefined, undefined), F.normalize(null));
  assert.equal(F.touched(undefined), false);
  assert.equal(F.touched(listA), true);
});

test("durations of the menu and shown names", () => {
  const now = at(17, 20);
  assert.equal(F.untilOf("hour", now), now + 3600000);
  assert.equal(F.untilOf("morning", now), new Date(2026, 10, 19, 8, 0).getTime());
  assert.equal(F.untilOf("on", now), 0);
  const t = (k) => "T:" + k;
  assert.equal(F.nameOf({ id: "work", name: "" }, t), "T:focus.m.work");
  assert.equal(F.nameOf({ id: "work", name: "Office" }, t), "Office");
  for (const ic of F.ICONS) assert.match(F.svg(ic), /^<svg [^>]*aria-hidden="true">.*<\/svg>$/);
});

test("wiring: notifications.js asks focus before every pop-up, migrates DND once", () => {
  const n = read("notifications.js");
  assert.match(n, /function quietFor\(ns, now\)/);
  assert.equal((n.match(/quietFor\((item|it)\.ns, /g) || []).length, 3, "boot sweep, pull catch-up, emit");
  assert.doesNotMatch(n, /if \(isQuietHour\(/);
  assert.match(n, /function migrateDnd\(\)/);
  assert.match(n, /migrateDnd\(\);\s*\n\s*bootSweep\(\);/);
  assert.match(n, /settings\.focus = F\.merge\(A\.settings\.focus, B\.settings\.focus\)/);
  assert.match(n, /silent: \(ns\) => quietFor/);
  assert.match(read("automations/host.js"), /N\.silent\("automations"\)/);
  assert.match(read("stickies/host.js"), /N\.silent\("stickies"\)/);
  const page = read("index.html");
  const late = page.indexOf("<template data-oros-late>", page.indexOf('<script src="notifications.js?v='));
  assert.ok(late > 0 && page.indexOf('<script src="focus/core.js?v=') > late, "focus.js comes with the late bundle (start-up script budget)");
  assert.match(n, /focusReady: function \(\)/);
  assert.match(read("focus/core.js"), /root\.orosNotifs\.focusReady\(\)/);
});

test("wiring: Quick settings pill and the Settings card", () => {
  const q = read("qsettings.js");
  assert.match(q, /F\.start\(F\.last\(\), \{ until: 0 \}\)/);
  assert.match(q, /function paintFocus\(F, fa\)/);
  assert.match(q, /item: "focusmodes"/);
  const s = read("settings/settings.js");
  assert.match(s, /function secFocus\(host, N\)/);
  assert.match(s, /nameIn\.value = m\.own \|\| ""/);
  assert.doesNotMatch(s.slice(s.indexOf("function secFocus"), s.indexOf("// In the orOS Android app only")), /innerHTML/);
  const C = require(path.join(ROOT, "settings/core.js"));
  assert.ok(C.findItem("focusmodes"));
});

test("strings: EN, EL and DE for the pill, modes and Settings", () => {
  const tr = read("translations.js"), de = read("i18n/de/shell.js"), sc = read("settings/core.js"), sde = read("i18n/de/settings.js");
  for (const k of ["qs.focus", "qs.focus.more", "qs.focus.modes", "qs.focus.how", "qs.focus.settings", "focus.m.dnd", "focus.m.sleep", "focus.m.work", "focus.m.personal"]) {
    assert.equal((tr.match(new RegExp('"' + k.replace(/\./g, "\\.") + '":', "g")) || []).length, 2, k + " EN+EL");
    assert.ok(de.includes('"' + k + '":'), k + " DE");
  }
  for (const k of ["n.focus", "n.focus.hint", "n.focus.modes", "n.focus.allow", "n.focus.allow.none", "n.focus.m.personal", "n.focus.ic.star", "n.quiet.hint2", "w.focusmodes"]) {
    assert.equal((sc.match(new RegExp('"' + k.replace(/\./g, "\\.") + '":', "g")) || []).length, 2, k + " EN+EL");
    assert.ok(sde.includes('"' + k + '":'), k + " DE");
  }
});

// ---------- F2: weekly schedule, Calendar events, "until the end" ----------
const WEEK = { on: true, days: [1, 2, 3, 4, 5], from: 18, to: 34 };   // Mon-Fri 09:00-17:00
const day = (d, h, m) => new Date(2026, 10, d, h, m || 0, 0).getTime();   // 2026-11-16 is a Monday

test("F2 schedule: days, half hours, past midnight, DST-safe local times", () => {
  assert.equal(F.schedEnds(WEEK, day(16, 9)), day(16, 17));
  assert.equal(F.schedEnds(WEEK, day(16, 8, 59)), 0);
  assert.equal(F.schedEnds(WEEK, day(21, 10)), 0, "Saturday is not chosen");
  const late = { on: true, days: [5], from: 45, to: 3 };               // Fri 22:30 - Sat 01:30
  assert.equal(F.schedEnds(late, day(20, 23)), day(21, 1, 30));
  assert.equal(F.schedEnds(late, day(21, 1)), day(21, 1, 30), "the night after the chosen day");
  assert.equal(F.schedEnds(late, day(22, 1)), 0, "Saturday night is not Friday's");
  assert.equal(F.schedEnds({ on: false, days: [1], from: 18, to: 34 }, day(16, 10)), 0, "off keeps the choice, runs nothing");
  assert.equal(F.schedEnds({ on: true, days: [], from: 18, to: 34 }, day(16, 10)), 0);
  assert.equal(F.schedNextEnd(WEEK, day(16, 7)), day(16, 17));
  assert.equal(F.schedNextEnd(WEEK, day(20, 18)), day(23, 17), "after Friday: next Monday");
  const f = F.normalize({ modes: [{ id: "work", sched: { on: true, days: [9, 1, 1, "x"], from: 99, to: 34 } }, { id: "sleep", sched: WEEK }] });
  assert.deepEqual(F.modeOf(f, "work").sched, { on: true, days: [1], from: 18, to: 34 });
  assert.equal(F.modeOf(f, "sleep").sched, undefined, "Sleep's hours are the quiet hours (D2)");
});

test("F2 activeAt: manual wins, then the first scheduled mode; off holds until the window ends", () => {
  let f = F.edited(null, "work", { sched: WEEK }, day(16, 8));
  assert.deepEqual(F.activeAt(f, QH, day(16, 10)), { id: "work", until: day(16, 17), by: "schedule" });
  assert.equal(F.activeAt(f, QH, day(16, 23)).id, "sleep", "quiet hours still run Sleep");
  assert.equal(F.activeAt(F.started(f, "personal", 0, day(16, 9)), QH, day(16, 10)).id, "personal");
  const off = F.stopped(f, QH, day(16, 10));
  assert.equal(off.act.until, day(16, 17));
  assert.equal(F.activeAt(off, QH, day(16, 16)), null);
  assert.equal(F.activeAt(off, QH, day(17, 10)).id, "work", "the next day it runs again");
  assert.equal(F.silent(f, {}, "mail", day(16, 10)), false, "Work lets Mail through");
  assert.equal(F.silent(f, {}, "games", day(16, 10)), true);
});

test("F2 Calendar trigger: label or title word, timed events only, accents and case ignored", () => {
  let f = F.edited(null, "personal", { cal: { on: true, label: "", word: "Γιόγκα" } }, day(16, 8));
  f = F.edited(f, "work", { cal: { on: true, label: "lbl_w", word: "" } }, day(16, 8));
  const evs = [
    { s: day(16, 19), e: day(16, 20), title: "ΓΙΟΓΚΑ με τη Μαρία", label: "" },
    { s: day(16, 11), e: day(16, 12, 30), title: "Πελάτης", label: "lbl_w" }
  ];
  assert.deepEqual(F.activeAt(f, {}, day(16, 19, 30), evs), { id: "personal", until: day(16, 20), by: "calendar" });
  assert.deepEqual(F.activeAt(f, {}, day(16, 11), evs), { id: "work", until: day(16, 12, 30), by: "calendar" });
  assert.equal(F.activeAt(f, {}, day(16, 13), evs), null);
  assert.equal(F.calEnds({ on: false, word: "Γιόγκα" }, evs, day(16, 19, 30)), 0);
  assert.equal(F.calEnds({ on: true, label: "", word: "" }, evs, day(16, 19, 30)), 0, "nothing chosen, nothing runs");
  assert.equal(F.fold("Συνάντηση"), F.fold("ΣΥΝΑΝΤΗΣΗ"));
  assert.equal(F.modeOf(F.normalize({ modes: [{ id: "work", cal: { on: true, label: "bad label!", word: "x" } }] }), "work").cal.label, "");
});

test("F2 until the end, unknown fields ride along, no change no stamp", () => {
  const f = F.edited(null, "work", { sched: WEEK }, day(16, 8));
  assert.equal(F.endOf(f, QH, "work", day(16, 7)), day(16, 17));
  assert.equal(F.endOf(f, QH, "personal", day(16, 7)), 0, "no schedule, no end");
  assert.equal(F.endOf(f, QH, "sleep", day(16, 12)), day(17, 8), "Sleep: the next end of the quiet hours");
  assert.equal(F.untilOf("end", day(16, 7), day(16, 17)), day(16, 17));
  assert.equal(F.untilOf("end", day(16, 7), 0), 0);
  const later = F.normalize({ modes: [{ id: "work", hide: { widgets: ["clock"] }, Bad: 1 }] });
  assert.deepEqual(F.modeOf(later, "work").hide, { widgets: ["clock"] }, "a later wave's field is kept");
  assert.equal(F.modeOf(later, "work").Bad, undefined);
  const edited = F.edited(later, "work", { allow: ["mail"] }, day(16, 9));
  assert.deepEqual(F.modeOf(edited, "work").hide, { widgets: ["clock"] });
  assert.equal(F.edited(f, "work", { sched: WEEK }, day(16, 9)).mrev, f.mrev, "the same schedule writes nothing");
});

test("F2 wiring: Settings, Quick settings, strings, Calendar data read", () => {
  const s = read("settings/settings.js");
  assert.match(s, /function focusWhen\(c5, F, m\)/);
  assert.match(s, /F\.edit\(m\.id, \{ sched: next \}\)/);
  assert.match(s, /F\.edit\(m\.id, \{ cal: next \}\)/);
  const q = read("qsettings.js");
  assert.match(q, /F\.endOf\(id\)/);
  assert.match(q, /parts\.focusEnd\.hidden = !\(endMs > Date\.now\(\)\)/);
  const core = read("focus/core.js");
  assert.match(core, /localStorage\.getItem\("oros-calendar-data"\)/);
  assert.match(core, /OCC\.instancesBetween/);
  const tr = read("translations.js"), de = read("i18n/de/shell.js"), sc = read("settings/core.js"), sde = read("i18n/de/settings.js");
  assert.equal((tr.match(/"qs\.focus\.end":/g) || []).length, 2);
  assert.ok(de.includes('"qs.focus.end":'));
  for (const k of ["n.focus.sched", "n.focus.sched.hint", "n.focus.sched.sleep", "n.focus.days", "n.focus.sched.empty", "n.focus.sched.night",
                   "n.focus.cal", "n.focus.cal.hint", "n.focus.cal.label", "n.focus.cal.anylabel", "n.focus.cal.word", "n.focus.cal.word.ph",
                   "n.focus.cal.word.hint", "n.focus.cal.empty", "n.focus.by.schedule", "n.focus.by.calendar"]) {
    assert.equal((sc.match(new RegExp('"' + k.replace(/\./g, "\\.") + '":', "g")) || []).length, 2, k + " EN+EL");
    assert.ok(sde.includes('"' + k + '":'), k + " DE");
  }
});
