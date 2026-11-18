// Phone reminders from eight more apps (BR-PHONE v12, gap review
// proposal 3): Plants, Chores, Garage, Pet care, CRM, Billing, Kanban
// and Sticky Notes in phone.js reminderRows, with the dedupKeys their
// shell engines give (shell.js *CheckTick, stickies/host.js announce),
// worked out by the same app cores. Also the wiring: sources read by
// reminderSource, the notification settings, the Kanban shell engine
// and its deep link, the strings in EN / EL / DE.
// Run: node --test tests/

"use strict";

process.env.TZ = "Europe/Athens";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const P = require(path.join(ROOT, "phone.js"));
const Plants = require(path.join(ROOT, "plants/core.js"));
const Chores = require(path.join(ROOT, "chores/core.js"));
const Garage = require(path.join(ROOT, "garage/core.js"));
const Pet = require(path.join(ROOT, "petcare/core.js"));
const Crm = require(path.join(ROOT, "crm/core.js"));
const Inv = require(path.join(ROOT, "invoices/core.js"));
const Kan = require(path.join(ROOT, "kanban/core.js"));
const Stk = require(path.join(ROOT, "stickies/core.js"));

const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi || 0).getTime();
const NOW = at(2026, 10, 9, 8, 0);          // Friday 2026-10-09 08:00 Athens
const rowsOf = (src, now) => P.reminderRows(Object.assign({ lang: "en" }, src), now || NOW);
const ids = (rows) => rows.map((r) => r.id);

test("Plants: one row a day at the reminder hour, key due-<ymd>, nothing when off", () => {
  const plant = (id, x) => Object.assign({ id, m: 1000, name: "Plant " + id, sp: "", room: "", out: 0, em: "",
    w: 7, ww: 0, f: 0, mi: 0, r: 0, st: "2026-10-01", sn: {}, notes: "" }, x || {});
  const d = Plants.merge({ ver: 1, plants: [plant("aaaaaa", { name: "Basil", w: 2, st: "2026-10-01" }),
                                           plant("bbbbbb", { name: "Fern", w: 30, st: "2026-10-09" })], log: [], tombs: {} }, null);
  const src = { plants: { core: Plants, sets: [d], prefs: Plants.readPrefs({ remind: 9 }) } };
  const rows = rowsOf(src);
  assert.deepEqual(ids(rows), ["plants:due-2026-10-09", "plants:due-2026-10-10"]);
  assert.equal(rows[0].at, at(2026, 10, 9, 9, 0));
  assert.equal(rows[0].ns, "plants");
  assert.equal(rows[0].kind, "note");
  assert.equal(rows[0].title, "Plant Care");
  assert.equal(rows[0].body, "Needs care: Basil");
  assert.equal(rows[0].link, "plants:today");
  // after the hour today: only tomorrow (today's is the open shell's)
  assert.deepEqual(ids(rowsOf(src, at(2026, 10, 9, 9, 30))), ["plants:due-2026-10-10", "plants:due-2026-10-11"]);
  assert.deepEqual(rowsOf({ plants: { core: Plants, sets: [d], prefs: Plants.readPrefs({ remind: -1 }) } }), []);
  assert.deepEqual(rowsOf({ plants: { core: Plants, sets: [], prefs: Plants.readPrefs(null) } }), []);
});

test("Chores: my chores of the day at prefs.rh, key today-<ymd>, no me no row", () => {
  const A = "aaaaaa";
  const mem = { id: A, m: 1, name: "A", color: 0, icon: "", away: null, order: 0, om: 0 };
  const task = { id: "tdishes", m: 1, name: "Dishes", icon: "", freq: { k: "d" }, weight: 1, mode: "rr", who: [], start: "2026-10-05", off: 0 };
  const st = Chores.mergeChores({ members: [mem], tasks: [task], done: {}, set: {}, tombs: {} }, {}, NOW);
  const rows = rowsOf({ chores: { core: Chores, wheels: [{ data: st, me: A }], prefs: Chores.readPrefs({ me: A, rh: 10 }) } });
  assert.deepEqual(ids(rows), ["chores:today-2026-10-09", "chores:today-2026-10-10"]);
  assert.equal(rows[0].at, at(2026, 10, 9, 10, 0));
  assert.match(rows[0].body, /^Today: Dishes/);
  assert.equal(rows[0].link, "chores:today");
  assert.deepEqual(rowsOf({ chores: { core: Chores, wheels: [{ data: st, me: "" }], prefs: Chores.readPrefs({ rh: 10 }) } }), []);
});

test("Garage: run forward day by day from the stored map, the shell's djb2 key", () => {
  const V = "aaaaaa1";
  const d = Garage.merge({ vehicles: [{ id: V, m: 1000, name: "Golf", type: "car", fuel: "petrol" }],
    fuel: [], service: [], plans: [], tyres: [],
    renewals: [{ id: "r000001", m: 1, v: V, kind: "ins", exp: "2026-10-16" }],    // 7 days on the 9th
    costs: [], odo: [], tombs: {} }, null);
  const prefs = Garage.readPrefs({ remind: 9 });
  const src = (notified) => ({ hours: 192, garage: { core: Garage, data: d, prefs, notified } });
  const rows = rowsOf(src({}));
  // today step 7, then the step-1 day (the 15th) and the day itself (step 0)
  const all = Garage.alerts(d, "2026-10-09", prefs);
  const key = (list, ymd) => {
    let h = 5381; const s = list.map((a) => a.key + ":" + a.step).join("|");
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return "garage:alerts-" + ymd + "-" + (h >>> 0).toString(36);
  };
  assert.equal(rows[0].id, key(all, "2026-10-09"));
  assert.equal(rows[0].at, at(2026, 10, 9, 9, 0));
  assert.equal(rows.length, 3);
  assert.equal(rows[1].id, key(Garage.alerts(d, "2026-10-15", prefs), "2026-10-15"));
  assert.equal(rows[2].id, key(Garage.alerts(d, "2026-10-16", prefs), "2026-10-16"));
  assert.match(rows[0].body, /^Golf: /);
  assert.equal(rows[0].link, "garage:upcoming");
  // already said at step 7 on this device: only the 15th
  const said = {}; all.forEach((a) => { said[a.key] = a.step; });
  assert.deepEqual(ids(rowsOf(src(said))), [rows[1].id, rows[2].id]);
  assert.deepEqual(rowsOf({ garage: { core: Garage, data: d, prefs: Garage.readPrefs({ remind: -1 }), notified: {} } }), []);
});

test("Pet care: daily notice with the fired map run forward, doses at their times", () => {
  const pet = { id: "pt0001", m: 1000, name: "Rex", sp: "dog", care: { bath: 30 }, cs: { bath: "2026-09-10" }, food: {}, vet: {} };
  const recs = [
    { id: "r00001", p: "pt0001", k: "vacc", d: "2025-10-16", m: 2000, n: "Rabies", nx: "2026-10-16" },
    { id: "rc0001", p: "pt0001", k: "med", d: "2026-10-05", m: 2000, n: "Amoxicillin", ds: "1 tablet", u: "2026-10-12", tm: ["08:00", "20:00"] }
  ];
  const d = Pet.merge({ ver: 1, pets: [pet], recs, tombs: {} }, null);
  const prefs = Pet.readPrefs({ remind: 9, lead: 7 });
  const rows = rowsOf({ petcare: { core: Pet, data: d, prefs, fired: {} } });
  const daily = rows.filter((r) => r.id.indexOf("petcare:due-") === 0);
  const r9 = Pet.reminders(d, "2026-10-09", 7, {});
  const h31 = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
  assert.equal(daily[0].id, "petcare:due-2026-10-09-" + h31(r9.items.map((it) => it.key + "@" + it.due).join("|")));
  assert.equal(daily[0].at, at(2026, 10, 9, 9, 0));
  assert.match(daily[0].body, /^Rex: /);
  // the 10th says only the bath (the rabies dose was said on the 9th)
  assert.equal(daily.length, 2);
  assert.equal(daily[1].body, "Rex: bath today");
  // doses: 20:00 today, both tomorrow, 08:00 on the 11th = the end of the
  // 48 hours (08:00 today is not after now)
  const doses = rows.filter((r) => r.id.indexOf("petcare:dose-") === 0);
  assert.deepEqual(doses.map((r) => r.at), [at(2026, 10, 9, 20, 0), at(2026, 10, 10, 8, 0), at(2026, 10, 10, 20, 0), at(2026, 10, 11, 8, 0)]);
  const k = "rc0001@2026-10-09T20:00";
  assert.equal(doses[0].id, "petcare:dose-" + k.slice(-16) + "-" + h31(k));
  assert.equal(doses[0].title, "Pet Health Book · dose 20:00");
  assert.equal(doses[0].body, "Rex: Amoxicillin (1 tablet)");
  assert.equal(doses[0].link, "petcare:pt0001");
  const off = rowsOf({ petcare: { core: Pet, data: d, prefs: Pet.readPrefs({ remind: -1, doses: false }), fired: {} } });
  assert.deepEqual(off, []);
});

test("CRM: a follow-up at its time (none: 09:00), the core's key, done ones never", () => {
  const d = Object.assign(Crm.empty(), {
    cust: [{ id: "cccccc01", m: 1000, name: "Acme", st: "active" }],
    fups: [{ id: "ffffff01", m: 1000, cust: "cccccc01", d: "2026-10-09", t: "15:30", text: "Call back" },
           { id: "ffffff02", m: 1000, cust: "cccccc01", d: "2026-10-10", text: "Send offer" },
           { id: "ffffff03", m: 1000, cust: "cccccc01", d: "2026-10-09", t: "07:00", text: "Past" },
           { id: "ffffff04", m: 1000, cust: "cccccc01", d: "2026-10-10", text: "Done", done: "2026-10-08" }]
  });
  const rows = rowsOf({ crm: { core: Crm, data: d } });
  const n = Crm.norm(d);
  const key = (id, ymd, hm) => "crm:fup-" + Crm.reminders(n, ymd, hm, {}).fresh.filter((x) => x.fup.id === id)[0].key;
  assert.deepEqual(ids(rows), [key("ffffff01", "2026-10-09", "15:30"), key("ffffff02", "2026-10-10", "09:00")]);
  assert.deepEqual(rows.map((r) => r.at), [at(2026, 10, 9, 15, 30), at(2026, 10, 10, 9, 0)]);
  assert.equal(rows[0].title, "Follow-up: Acme");
  assert.equal(rows[0].body, "Call back · today 15:30");
  assert.equal(rows[0].link, "crm:ffffff01");
});

test("Billing: overdue + due within 2 days at 09:00, key from invoices/core.js reminder", () => {
  const line = { code: "", d: "Work", q: 1, unit: "", p: 10000, disc: 0, vat: 24 };
  const d = Inv.normalize({ ver: 1, clients: [], pays: [], docs: [{
    id: "inv0001", kind: "inv", st: "issued", ser: "ser-inv", seq: 1, num: "INV-2026-0001",
    date: "2026-10-01", due: "2026-10-11", cur: "EUR", cli: "", c: { name: "Acme" }, lines: [line], gDisc: 0, wht: 0, m: 10 }] });
  const rows = rowsOf({ invoices: { core: Inv, data: d } });
  assert.deepEqual(ids(rows), ["invoices:" + Inv.reminder(d, "2026-10-09", 2).key, "invoices:" + Inv.reminder(d, "2026-10-10", 2).key]);
  assert.equal(rows[0].at, at(2026, 10, 9, 9, 0));
  assert.equal(rows[0].title, "Billing");
  assert.equal(rows[0].body, "1 due soon (unpaid document)");
  assert.equal(rows[0].link, "invoices:inv0001");
});

test("Kanban: cards due or overdue at 09:00 outside the Done column, earliest card's link", () => {
  const data = { boards: [
    { id: "b1", name: "Work", columns: [
      { id: "c1", name: "To do", cards: [{ id: "k1", text: "Report", due: "2026-10-10" }, { id: "k2", text: "Old", due: "2026-10-01" }] },
      { id: "c2", name: "Done", cards: [{ id: "k3", text: "Shipped", due: "2026-10-09" }] }] },
    { id: "b2", name: "Old", archived: true, columns: [{ id: "c9", cards: [{ id: "k9", due: "2026-10-09" }] }] }] };
  const rows = rowsOf({ kanban: { core: Kan, data } });
  assert.deepEqual(ids(rows), ["kanban:due-2026-10-09-1", "kanban:due-2026-10-10-2"]);
  assert.equal(rows[0].body, "1 card is due or overdue");
  assert.equal(rows[1].body, "2 cards are due or overdue");
  assert.equal(rows[0].link, "kanban:b1/c1/k2");
  assert.deepEqual(P.kanbanDue(Kan, data, "2026-10-09"), { count: 1, link: "kanban:b1/c1/k2" });
  assert.deepEqual(P.kanbanDue(Kan, { boards: [] }, "2026-10-09"), { count: 0, link: "system:open:kanban" });
});

test("Sticky Notes: each ring at its moment, key ring-<id>-<at>, faded and past ones never", () => {
  const T0 = NOW - 3600000;
  const note = (id, o) => Object.assign({ id, text: "Buy milk\nand bread", color: "yellow", ring: null, vanish: null, faded: 0, ct: T0,
    fm: { text: T0, color: T0, ring: T0, vanish: 0, faded: 0 } }, o);
  const ring = at(2026, 10, 9, 17, 0);
  const d = Stk.merge({ ver: 1, notes: [note("sn-a-aaaaaa", { ring: { at: ring } }), note("sn-b-bbbbbb", { ring: { at: NOW - 60000 } }),
                                        note("sn-c-cccccc", { ring: { at: ring }, faded: T0 }), note("sn-d-dddddd", { text: "", ring: { at: ring + 1 } })], tombs: {} }, null);
  const rows = rowsOf({ stickies: { core: Stk, data: d, title: "Sticky note", empty: "(empty)" } });
  assert.deepEqual(ids(rows), ["stickies:ring-sn-a-aaaaaa-" + ring, "stickies:ring-sn-d-dddddd-" + (ring + 1)]);
  assert.equal(rows[0].title, "Sticky note");
  assert.equal(rows[0].body, "Buy milk");
  assert.equal(rows[1].body, "(empty)");
  assert.equal(rows[0].link, "stickies:sn-a-aaaaaa");
});

test("a broken source never stops the others; the horizon still caps the rows", () => {
  const bad = { core: { summary() { throw new Error("x"); }, readPrefs: () => ({ remind: 9 }) }, sets: [{}], prefs: { remind: 9, hemi: "n" } };
  const rows = rowsOf({ plants: bad, kanban: { core: Kan, data: { boards: [{ id: "b", columns: [{ id: "c", cards: [{ id: "k", due: "2026-10-09" }] }] }] } } });
  assert.deepEqual(ids(rows), ["kanban:due-2026-10-09-1", "kanban:due-2026-10-10-1"]);
  const week = rowsOf({ hours: 168, kanban: { core: Kan, data: { boards: [{ id: "b", columns: [{ id: "c", cards: [{ id: "k", due: "2026-10-09" }] }] }] } } });
  assert.equal(week.length, 7);
});

test("wiring: sources, settings, veil, shell engine, deep link, strings, late bundle", () => {
  const phone = read("phone.js"), shell = read("shell.js"), notifs = read("notifications.js");
  ["OrosPlantsCore", "OrosChoresCore", "OrosGarageCore", "OrosPetcareCore", "OrosCrmCore", "OrosInvoicesCore",
   "OrosKanbanCore", "StickiesCore", "OrosPlantsHouse", "OrosChoresHouse", "OrosGarageHouse", "OrosPetcareHouse"].forEach((n) => {
    assert.ok(phone.indexOf("R." + n) >= 0, n);
  });
  ["oros-garage-notified", "oros-petcare-fired", "oros-kanban-data", "oros-stickies-data"].forEach((k) => assert.ok(phone.indexOf('"' + k + '"') >= 0, k));
  // settings: an app switched off never rings on the phone either
  assert.match(phone, /getAppToggle\(r\.ns\)/);
  // the veil still covers every row
  assert.match(phone, /if \(veil\) items = veilReminders\(items\)/);
  // Kanban shell engine with the phone's count and key
  assert.match(shell, /tickSafe\("kanbanCheckTick", kanbanCheckTickThrottled\)/);
  assert.match(shell, /P\.kanbanDue\(KC, raw, today\)/);
  assert.match(shell, /key: "due-" \+ today \+ "-" \+ s\.count/);
  assert.match(notifs, /kanban: +function \(p\)/);
  assert.match(read("stickies/host.js"), /text: function \(k\) \{ return T\(String\(k\)\); \}/);
  // kanban/core.js is in the shell's late bundle (and precached)
  assert.match(read("index.html"), /<script src="kanban\/core\.js\?v=[0-9.]+"><\/script>/);
  assert.ok(read("sw.js").indexOf('"kanban/core.js"') >= 0);
  // strings
  const tr = read("translations.js"), de = read("i18n/de/shell.js");
  assert.equal((tr.match(/"rem\.kanban\.(one|other)"/g) || []).length, 4);
  assert.match(de, /"rem\.kanban\.one": "\{n\} Karte ist fällig oder überfällig"/);
  assert.match(de, /"rem\.kanban\.other":/);
});
