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
  const later = F.normalize({ modes: [{ id: "work", digest: { at: [8] }, Bad: 1 }] });
  assert.deepEqual(F.modeOf(later, "work").digest, { at: [8] }, "a later wave's field is kept");
  assert.equal(F.modeOf(later, "work").Bad, undefined);
  const edited = F.edited(later, "work", { allow: ["mail"] }, day(16, 9));
  assert.deepEqual(F.modeOf(edited, "work").digest, { at: [8] });
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

// ---------- F3: hide widgets and desktop/Dock icons, the bar icon ----------
test("F3 hide: checked ids, CSS only for the running mode, nothing else", () => {
  let f = F.edited(null, "work", { hide: { widgets: ["today", "today", "Bad"], apps: ["games", "x\"}body{", "chess"] } }, day(16, 8));
  assert.deepEqual(F.modeOf(f, "work").hide, { widgets: ["today"], apps: ["chess", "games"] });
  assert.equal(F.hideCss(f, null), "");
  const css = F.hideCss(f, { id: "work" });
  assert.equal(css, '.wg-card[data-wg="today"], #ld-desk [data-app="chess"], #ld-dock [data-app="chess"], #ld-desk [data-app="games"], #ld-dock [data-app="games"] { display: none !important; }');
  assert.doesNotMatch(css, /body\{/);
  assert.equal(F.hideCss(f, { id: "personal" }), "", "another mode hides nothing");
  f = F.edited(f, "work", { hide: { widgets: [], apps: [] } }, day(16, 9));
  assert.equal(F.modeOf(f, "work").hide, undefined, "an empty choice is dropped");
  const g = F.normalize({ modes: [{ id: "dnd", hide: { apps: ["mail"] } }] });
  assert.deepEqual(F.modeOf(g, "dnd").hide, { widgets: [], apps: ["mail"] });
});

test("F3 wiring: shell style, Settings picker, launcher list, bar icon, strings", () => {
  const core = read("focus/core.js");
  assert.match(core, /st\.id = "oros-focus-hide"/);
  assert.match(core, /paintHide\(hideCss\(f0, cur\)\)/);
  const s = read("settings/settings.js");
  assert.match(s, /function focusHide\(c5, F, m\)/);
  assert.match(s, /F\.edit\(m\.id, \{ hide: next \}\)/);
  assert.doesNotMatch(s.slice(s.indexOf("function focusHide"), s.indexOf("function focusWhen")), /innerHTML/);
  assert.match(read("launcher.js"), /placed: function \(\) \{ return \{ desk: shown\("desk"\), dock: shown\("dock"\) \}; \}/);
  assert.match(read("qsettings.js"), /html \+= focusIcon\(\) \|\| IC\.bellOff/);
  const sc = read("settings/core.js"), sde = read("i18n/de/settings.js");
  for (const k of ["n.focus.hide", "n.focus.hide.hint", "n.focus.hide.widgets", "n.focus.hide.apps", "n.focus.hide.none"]) {
    assert.equal((sc.match(new RegExp('"' + k.replace(/\./g, "\\.") + '":', "g")) || []).length, 2, k + " EN+EL");
    assert.ok(sde.includes('"' + k + '":'), k + " DE");
  }
});

// ---------- F4: summary (D4), Web Push, Automations (D5) ----------
test("F4 summary: cleaned, own stamp, merged on it, holds only on chosen apps", () => {
  const f = F.normalize({ digest: { on: 1, apps: ["mail", "system", "mail", "Bad"], times: [36, 16, 16, 99, 1, 2, 3, 4, 5], st: 5 } });
  assert.deepEqual(f.digest, { on: true, apps: ["mail"], times: [1, 2, 3, 4, 16, 36], st: 5 });
  assert.equal(F.normalize(null).digest.on, false);
  const g = F.digestEdited(F.normalize(null), { on: true, apps: ["mail", "todo"], times: [36] }, 1000);
  assert.equal(g.digest.st, 1000);
  assert.equal(F.digestEdited(g, { on: true }, 2000).digest.st, 1000, "no change, no stamp");
  assert.ok(F.touched(g));
  const h = F.digestEdited(g, { apps: ["todo"] }, 3000);
  assert.deepEqual(F.merge(g, h).digest.apps, ["todo"]);
  assert.deepEqual(F.merge(h, g), F.merge(g, h));
  // a mode list change elsewhere never undoes the summary
  const e = F.edited(F.normalize(null), "work", { name: "Office" }, 9000);
  assert.deepEqual(F.merge(e, h).digest.apps, ["todo"]);
  assert.equal(F.modeOf(F.merge(e, h), "work").name, "Office");
  const now = at(12);
  assert.equal(F.why(h, {}, "todo", now, []), "digest");
  assert.equal(F.why(h, {}, "mail", now, []), "");
  assert.ok(F.silent(h, {}, "todo", now, []));
  // a running mode names itself first
  const run = F.started(h, "dnd", 0, now);
  assert.equal(F.why(run, {}, "todo", now, []), "dnd");
  assert.equal(F.why(F.digestEdited(h, { on: false }, 4000), {}, "todo", now, []), "");
});

test("F4 summary times: the due slot, what it counts, missed times give one notice", () => {
  const f = F.digestEdited(F.normalize(null), { on: true, apps: ["mail"], times: [16, 36] }, 1);   // 08:00, 18:00
  assert.equal(F.digestDue(f, at(7), at(6)), null, "before the first time");
  const d = F.digestDue(f, at(8, 5), at(7));
  assert.equal(d.slot, at(8));
  assert.equal(d.from, new Date(2026, 10, 17, 18).getTime(), "from yesterday's 18:00");
  assert.equal(F.digestDue(f, at(9), at(8)), null, "already done");
  const late = F.digestDue(f, at(19), new Date(2026, 10, 16, 18).getTime());
  assert.equal(late.slot, at(18));
  assert.equal(late.from, new Date(2026, 10, 16, 18).getTime(), "counts from its own last summary");
  assert.equal(F.digestDue(F.digestEdited(f, { apps: [] }, 2), at(9), at(7)), null, "no apps, no summary");
  const items = [
    { ns: "mail", createdAt: at(7), readAt: null }, { ns: "mail", createdAt: at(7, 30), readAt: null },
    { ns: "todo", createdAt: at(7), readAt: null }, { ns: "mail", createdAt: at(7), readAt: at(7, 10) },
    { ns: "system", createdAt: at(7), readAt: null }, { ns: "mail", createdAt: at(9), readAt: null },
    { ns: "crm", createdAt: at(6), readAt: null }
  ];
  const r = F.tally(items, d.from, d.slot, (ns) => ns === "mail" || ns === "crm" || ns === "system");
  assert.deepEqual(r, { n: 3, apps: ["mail", "crm"] }, "unread, in the window, never orOS's own");
});

test("F4 Web Push: the 48-hour timeline matches activeAt, and sw.js keeps the same rule", () => {
  const sched = { on: true, days: [0, 1, 2, 3, 4, 5, 6], from: 18, to: 34 };   // 09:00-17:00
  let f = F.edited(F.normalize(null), "work", { sched }, 1);
  f = F.digestEdited(f, { on: true, apps: ["todo"], times: [36] }, 2);
  const now = at(6, 10);
  const snap = F.timeline(f, QH, now, [], 48);
  assert.equal(snap.v, 1);
  assert.equal(snap.until, now + 48 * 3600000);
  assert.deepEqual(snap.wait, ["todo"]);
  for (let t = now; t < snap.until; t += 7 * 60000) {
    const cur = F.activeAt(f, QH, t, []);
    const m = cur ? F.modeOf(f, cur.id) : null;
    for (const ns of ["mail", "calendar", "weather"]) {
      const want = !!(m && m.allow.indexOf(ns) < 0);
      assert.equal(F.snapQuiet({ ...snap, wait: [] }, ns, t), want, ns + " at " + new Date(t).toString());
    }
  }
  assert.ok(F.snapQuiet(snap, "todo", at(12)), "summary apps wait");
  assert.equal(F.snapQuiet(snap, "mail", snap.until + 1), false, "an old snapshot never hushes");
  const manual = F.timeline(F.started(F.normalize(null), "dnd", at(7), now), {}, now, [], 48);
  assert.deepEqual(manual.spans, [{ s: now, e: at(7), allow: [] }]);
  // the service worker's copy answers the same
  const sw = read("sw.js");
  const src = sw.slice(sw.indexOf("function focusQuiet("), sw.indexOf("self.addEventListener(\"message\", function (event) {\n  var m = event.data;\n  if (!m || m.t !== \"oros-focus\""));
  const focusQuiet = new Function(src + "; return focusQuiet;")();
  for (let t = now; t < snap.until; t += 23 * 60000) {
    for (const ns of ["mail", "todo", "calendar"]) assert.equal(focusQuiet(snap, ns, t), F.snapQuiet(snap, ns, t));
  }
  assert.ok(sw.includes("silent: hush") && sw.includes('"oros-focus"') && /keep = \[[^\]]*FOCUS_CACHE/.test(sw));
});

test("F4 wiring: quiet notices never pop up later, summaries, Automations event and action, strings", () => {
  const nt = read("notifications.js");
  assert.ok(nt.includes("else item.firedAt = now;"), "emit stamps a quiet notice");
  assert.ok(nt.includes("if (quietFor(item.ns, now)) { item.firedAt = now; return false; }"), "boot sweep");
  assert.ok(nt.includes("if (quietFor(it.ns, cuNow)) { it.firedAt = cuNow;"), "pull catch-up");
  const fc = read("focus/core.js");
  for (const k of ['"focus-sum:"', '"focus-end:"', '"focus.start"', '"focus.end"', '"oros-focus"', "setDigest"]) assert.ok(fc.includes(k), k);
  const C = require(path.join(ROOT, "automations/core.js"));
  assert.ok(C.EVENTS.includes("focus.start") && C.EVENTS.includes("focus.end"));
  assert.ok(C.ACTIONS.includes("focus") && C.LOCAL.focus);
  assert.deepEqual(C.cleanAction({ a: "focus", mode: "work", min: 30 }), { a: "focus", mode: "work", min: 30 });
  assert.deepEqual(C.cleanAction({ a: "focus", mode: "off", min: 30 }), { a: "focus", mode: "off" });
  assert.deepEqual(C.cleanAction({ a: "focus", mode: "<b>", min: 99999 }), { a: "focus", mode: "dnd" });
  assert.deepEqual(C.cleanAction({ a: "focus", mode: "m_abc12345" }), { a: "focus", mode: "m_abc12345" });
  const sig = { kind: "event", name: "focus.start", key: "focus:work:123:start", text: "Work" };
  const rule = C.cleanRule({ id: "r1", m: 1, name: "", on: true, when: { t: "event", ev: "focus.start", word: "work" }, "do": [{ a: "focus", mode: "dnd", min: 0 }] });
  assert.ok(rule && C.matches(rule, sig, at(12)));
  assert.equal(C.matches(rule, { ...sig, text: "Sleep" }, at(12)), null, "the word picks the mode");
  const host = read("automations/host.js");
  assert.ok(host.includes('if (a.a === "focus") focusStep(a);') && host.includes("now - focusAt < 60000"));
  assert.ok(read("automations/app.js").includes('a.a === "focus"'));
  const de = read("i18n/de/automations.js");
  for (const k of ["ev.focus.start", "ev.focus.end", "act.focus", "act.focusMin", "act.focusOff", "a.focus", "x.focusMode", "x.focusOff", "x.focusMin", "h.focus"]) assert.ok(de.includes('"' + k + '":'), k + " DE");
  for (const k of ["ev.focus.start", "act.focusOff"]) assert.equal((read("automations/core.js").match(new RegExp('"' + k.replace(/\./g, "\\.") + '":', "g")) || []).length, 2, k + " EN+EL");
  const tr = read("translations.js"), dsh = read("i18n/de/shell.js");
  for (const k of ["focus.sum.title", "focus.sum.end", "focus.sum.one", "focus.sum.many"]) {
    assert.equal((tr.match(new RegExp('"' + k.replace(/\./g, "\\.") + '":', "g")) || []).length, 2, k + " EN+EL");
    assert.ok(dsh.includes('"' + k + '":'), k + " DE");
  }
  const sc = read("settings/core.js"), sde = read("i18n/de/settings.js");
  for (const k of ["n.focus.sum", "n.focus.sum.hint", "n.focus.sum.times", "n.focus.sum.add", "n.focus.sum.rm", "n.focus.sum.apps", "n.focus.sum.apps.hint", "n.focus.sum.empty", "n.focus.sum.end"]) {
    assert.equal((sc.match(new RegExp('"' + k.replace(/\./g, "\\.") + '":', "g")) || []).length, 2, k + " EN+EL");
    assert.ok(sde.includes('"' + k + '":'), k + " DE");
  }
  assert.ok(read("settings/settings.js").includes("focusDigest(host, F, N);"));
});
