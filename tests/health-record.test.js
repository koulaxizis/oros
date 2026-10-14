// Health wave 3 (health/core.js): the medical record — Medical ID,
// allergies, conditions, emergency contacts, vaccinations,
// appointments, documents — its merge, reminders, the QR text, the
// phone's alarms (phone.js reminderRows), Health Connect readings
// (phone.js healthIn), and the Today / search / Calendar wiring.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const C = require("../health/core.js");

const at = (d, h, m) => new Date(2026, 9, d, h, m || 0).getTime();   // October 2026, local
function data(parts) { return Object.assign(C.emptyData(), parts || {}); }
function ap(id, extra) {
  return C.normAppt(Object.assign({ id, m: 1000, dr: "Dr A", sp: "Cardiology", pl: "Main St 1", at: at(20, 10), du: 30, rm: 60, nt: "" }, extra || {}));
}
function vx(id, extra) {
  return C.normVax(Object.assign({ id, m: 1000, n: "Tetanus", d: "2016-10-20", nx: "2026-10-20", rm: 1, lt: "", nt: "" }, extra || {}));
}
function med(id, extra) {
  return C.normMed(Object.assign({ id, m: 1000, n: "Med " + id, s: "", f: "tab", q: 100, k: "d",
    tm: [480, 1200], sd: "2026-10-01", ed: "", rm: 1, sk: -1, rw: 7, ar: 0, ca: 0, nt: "" }, extra || {}));
}

test("record normalizers: required fields, limits, canonical shapes", () => {
  assert.deepEqual(C.normAllergy({ id: "a1", m: 1, n: "  Penicillin ", sv: 3, r: "rash", nt: "x" }),
    { id: "a1", m: 1, n: "Penicillin", sv: 3, r: "rash", nt: "x" });
  assert.equal(C.normAllergy({ id: "a1", m: 1, n: " " }), null, "name required");
  assert.equal(C.normAllergy({ id: "a1", m: 1, n: "X", sv: 9 }).sv, 0);
  assert.equal(C.normCond({ id: "c1", m: 1, n: "Asthma", sd: "2026-02-30" }).sd, "", "bad date dropped");
  const ec = C.normContact({ id: "e1", m: 1, n: "Maria", rl: "Sister", ph: "+30 690<script> 000", ci: "c1" });
  assert.equal(ec.ph, "+30 690 000", "only phone characters kept");
  assert.equal(C.normContact({ id: "e1", m: 1, n: "Maria", ph: "abc" }), null, "a phone needs digits");
  assert.equal(C.normContact({ id: "e1", m: 1, n: "Maria", ph: "1", ci: "<bad>" }).ci, "");
  assert.equal(vx("v1", { nx: "2016-01-01" }).nx, "", "next before given dropped");
  assert.equal(vx("v1", { nx: "" }).rm, 0, "no next dose, no reminder");
  assert.equal(vx("v1", { d: "nope" }), null);
  assert.equal(ap("p1", { dr: "", sp: "" }), null, "doctor or specialty");
  assert.equal(ap("p1", { rm: 99999 }).rm, -1, "lead out of range → off");
  assert.equal(ap("p1", { du: 5000 }).du, 0);
  assert.equal(ap("p1", { at: -5 }), null);
  const doc = C.normDoc({ id: "dabcdef1", m: 1, k: "rx", n: "Prescription", d: "2026-10-01", nt: "",
    sc: ["20261001-dabcdef1-abcd.jpg", "bad.exe", "20261001-dabcdef1-abcd.jpg", "../../x.pdf"] });
  assert.deepEqual(doc.sc, ["20261001-dabcdef1-abcd.jpg"], "file names checked, unique");
  assert.ok(!("sc" in C.normDoc({ id: "dabcdef1", m: 1, n: "X", d: "2026-10-01" })), "no files → no sc key");
  assert.equal(C.normDoc({ id: "d-1", m: 1, n: "X", d: "2026-10-01" }), null, "a document id carries no dash (file names split on it)");
  assert.equal(C.normDoc({ id: "dabcdef1", m: 1, n: "X", d: "2026-10-01", k: "zzz" }).k, "oth");
  assert.deepEqual(C.normProfile({ m: 2, nm: "Chris", bd: "1980-05-01", bt: "AB-", od: 1, nt: "lenses", sm: 0 }),
    { m: 2, nm: "Chris", bd: "1980-05-01", bt: "AB-", od: 1, nt: "lenses", sm: 0 });
  assert.equal(C.normProfile({ m: 2, bt: "Z+" }).bt, "");
  assert.equal(C.normProfile({ bt: "A+" }), null, "a stamp is needed");
});

test("attachments: names, paths on the orOS disk, every name in use", () => {
  assert.equal(C.atName("2026-10-01", "dabcdef1", "AbC9x", "jpg"), "20261001-dabcdef1-abc9x.jpg");
  assert.equal(C.atName("2026-10-01", "d-bad", "abcd", "jpg"), null);
  assert.equal(C.atName("2026-10-01", "dabcdef1", "ab", "jpg"), null, "random part ≥ 4");
  assert.equal(C.atName("2026-10-01", "dabcdef1", "abcd", "exe"), null);
  assert.equal(C.atPath("20261001-dabcdef1-abcd.pdf"), "/internal/Health/20261001-dabcdef1-abcd.pdf");
  assert.equal(C.atPath("../etc/passwd"), null);
  const d = C.merge(data({ dc: [{ id: "dabcdef1", m: 1, n: "A", d: "2026-10-01", sc: ["20261001-dabcdef1-abcd.jpg"] },
                               { id: "dabcdef2", m: 1, n: "B", d: "2026-10-01" }] }), null);
  assert.deepEqual(C.attachmentsOf(d), ["20261001-dabcdef1-abcd.jpg"]);
});

test("merge: record collections and the profile are symmetric, idempotent, tombstoned; old data loads", () => {
  const A = data({ al: [C.normAllergy({ id: "a1", m: 5, n: "Penicillin", sv: 3 })], ap: [ap("p1")],
                   pf: { m: 10, nm: "Chris", bt: "A+", od: 0, nt: "", sm: 1, bd: "" } });
  const B = data({ al: [C.normAllergy({ id: "a1", m: 7, n: "Penicillin", sv: 2 })], vx: [vx("v1")],
                   pf: { m: 12, nm: "Chris K", bt: "A+", od: 1, nt: "", sm: 1, bd: "" }, tombs: { "ap:p1": 2000 } });
  const ab = C.merge(A, B), ba = C.merge(B, A);
  assert.deepEqual(ab, ba, "symmetric");
  assert.deepEqual(C.merge(ab, ab), ab, "idempotent");
  assert.equal(ab.al[0].sv, 2, "newer allergy row wins");
  assert.equal(ab.ap.length, 0, "tombstone newer than the row deletes it");
  assert.equal(ab.vx.length, 1);
  assert.equal(ab.pf.nm, "Chris K", "profile LWW as a whole");
  const old = { ver: 1, en: [], ty: [], md: [], dl: [], rf: [], sy: [], sk: [], set: null, tombs: {} };
  const m = C.merge(old, old);
  assert.deepEqual([m.al, m.cn, m.ec, m.vx, m.ap, m.dc, m.pf], [[], [], [], [], [], [], null], "wave-2 data loads with an empty record");
  assert.deepEqual(C.merge(m, old), m, "an older device's copy merges without loss or churn");
  const resurrect = C.merge(data({ ap: [ap("p1", { m: 3000 })] }), { tombs: { "ap:p1": 2000 } });
  assert.equal(resurrect.ap.length, 1, "a newer edit resurrects");
});

test("Medical ID: age, order, current medicines, QR text within its byte budget", () => {
  const d = data({
    al: [C.normAllergy({ id: "a1", m: 1, n: "Pollen", sv: 1 }), C.normAllergy({ id: "a2", m: 1, n: "Penicillin", sv: 3 })],
    cn: [C.normCond({ id: "c1", m: 1, n: "Asthma" })],
    ec: [C.normContact({ id: "e1", m: 1, n: "Maria", rl: "Sister", ph: "+30 690 000 0001" })],
    md: [med("ma", { n: "Metformin", s: "500 mg" }), med("mb", { n: "Old", ar: 1 }), med("mc", { n: "Later", sd: "2026-12-01" })],
    pf: C.normProfile({ m: 1, nm: "Chris", bd: "1980-10-14", bt: "O-", od: 1, nt: "Pacemaker", sm: 1 })
  });
  const s = C.medicalId(d, at(14, 12));
  assert.equal(s.age, 46, "birthday today counts");
  assert.equal(C.ageOn("1980-10-15", at(14, 12)), 45);
  assert.deepEqual(s.al.map((a) => a.n), ["Penicillin", "Pollen"], "severe first");
  assert.deepEqual(s.md.map((m) => m.n), ["Metformin"], "only medicines taken now");
  const L = { head: "MEDICAL ID", name: "Name", born: "Born", blood: "Blood", donor: "Donor", yes: "yes", no: "no",
              al: "Allergies", cn: "Conditions", md: "Medicines", ec: "Call", nt: "Notes", sev: ["", "mild", "moderate", "severe"], more: "+{n}" };
  assert.equal(C.idText(s, L, 1000), [
    "MEDICAL ID", "Name: Chris", "Born: 1980-10-14 (46)", "Blood: O-", "Donor: yes",
    "Allergies: Penicillin (severe); Pollen (mild)", "Conditions: Asthma", "Medicines: Metformin 500 mg",
    "Call: Maria (Sister) +30 690 000 0001", "Notes: Pacemaker"].join("\n"));
  const many = data(Object.assign({}, d, {
    md: Array.from({ length: 30 }, (_, i) => med("m" + i, { n: "Μεγάλο όνομα φαρμάκου " + i })),
    al: Array.from({ length: 10 }, (_, i) => C.normAllergy({ id: "a" + i, m: 1, n: "Αλλεργία " + i, sv: 3 }))
  }));
  const t = C.idText(C.medicalId(many, at(14, 12)), L, 600);
  assert.ok(C.utf8Len(t) <= 600, "within the budget");
  assert.ok(!/Notes:/.test(t), "notes go first");
  assert.ok(/Allergies: Αλλεργία 0 .*Αλλεργία 9 /.test(t), "allergies kept while medicines can be cut");
  assert.ok(/Medicines: .*\+\d+/.test(t) || !/Medicines:/.test(t), "cut lists say how many more");
  assert.ok(/Call: Maria/.test(t), "one emergency contact always stays");
  assert.equal(C.utf8Len("aé€😀"), 1 + 2 + 3 + 4);
  const off = C.medicalId(data({ md: d.md, pf: C.normProfile({ m: 1, sm: 0 }) }), at(14, 12));
  assert.deepEqual(off.md, [], "medicines can be left off the card");
});

test("vaccinations: the newest of a name waits for its next dose; notices a week before and on the day", () => {
  const d = data({ vx: [vx("v1"), vx("v2", { n: "Flu", d: "2025-10-01", nx: "2026-10-01" }), vx("v3", { n: "flu", d: "2026-10-05", nx: "" }),
                         vx("v4", { n: "HepB", nx: "2026-11-30", rm: 0 })] });
  assert.deepEqual(C.vaxOpen(d).map((v) => v.id), ["v1", "v4"], "a later Flu row closes the earlier one (case-insensitive)");
  assert.deepEqual(C.dueVax(d, at(13, 8, 59)), [], "before 09:00 of the week-before day");
  assert.deepEqual(C.dueVax(d, at(13, 9)).map((r) => r.key), ["v-v1-20261020-w"]);
  assert.deepEqual(C.dueVax(d, at(19, 23)).map((r) => r.key), ["v-v1-20261020-w"]);
  assert.deepEqual(C.dueVax(d, at(20, 8)), [], "the day itself rings from 09:00");
  assert.deepEqual(C.dueVax(d, at(22, 20)).map((r) => r.key), ["v-v1-20261020-d"]);
  assert.deepEqual(C.dueVax(d, at(23, 0, 1)), [], "three days on the day, then quiet");
  assert.deepEqual(C.recordOn(d, "2026-10-20").map((r) => r.k + ":" + (r.vx || r.ap).id), ["vx:v1"]);
});

test("appointments: due from the lead until the start; at the time for an hour; by day; upcoming", () => {
  const d = data({ ap: [ap("p1"), ap("p2", { at: at(20, 8), rm: 0 }), ap("p3", { at: at(20, 12), rm: -1 }), ap("p4", { at: at(2, 9) })] });
  const key = (a) => "a-" + a.id + "-" + a.at.toString(36) + "-" + a.rm;
  assert.deepEqual(C.dueAppts(d, at(20, 8, 59)).map((r) => r.key), [key(d.ap[1])], "at the time: from 08:00 for an hour");
  assert.deepEqual(C.dueAppts(d, at(20, 9, 0)).map((r) => r.key), [key(d.ap[0])], "one hour before 10:00");
  assert.deepEqual(C.dueAppts(d, at(20, 10)), [], "over once it starts");
  assert.equal(C.apptKey(d.ap[0]), key(d.ap[0]));
  assert.deepEqual(C.recordOn(d, "2026-10-20").map((r) => r.ap.id), ["p2", "p1", "p3"], "by time");
  assert.deepEqual(C.upcomingAppts(d, at(20, 11)).map((a) => a.id), ["p2", "p1", "p3"], "today's earlier ones stay in Coming up");
});

test("alarmsBetween: the phone's alarms for doses, snoozes, appointments and vaccines", () => {
  const d = C.merge(data({
    md: [med("ma", { n: "Lisinopril", s: "10 mg" }), med("mb", { rm: 0 }), med("mc", { ar: 1 }), med("md", { ca: at(14, 9) })],
    dl: [C.normDose({ id: C.doseKey("ma", "2026-10-14", 1200), m: 5, md: "ma", d: "2026-10-14", tm: 1200, s: "z", ta: at(14, 20, 1), zu: at(14, 20, 31) }),
         C.normDose({ id: C.doseKey("ma", "2026-10-15", 480), m: 5, md: "ma", d: "2026-10-15", tm: 480, s: "t", ta: at(15, 7, 50) })],
    ap: [ap("p1", { at: at(16, 10), rm: 1440 }), ap("p2", { at: at(15, 10), rm: 1440 })],
    vx: [vx("v1", { nx: "2026-10-22" })]
  }), null);
  const rows = C.alarmsBetween(d, at(14, 20, 10), at(16, 20, 10));
  assert.deepEqual(rows.map((r) => [r.key, new Date(r.at).getDate() + " " + new Date(r.at).toTimeString().slice(0, 5), r.k]), [
    ["d-ma-20261014-2000-z" + at(14, 20, 31).toString(36), "14 20:31", "dose"],
    ["d-md-20261015-0800", "15 08:00", "dose"],
    ["v-v1-20261022-w", "15 09:00", "vax"],
    ["a-p1-" + at(16, 10).toString(36) + "-1440", "15 10:00", "appt"],
    ["d-ma-20261015-2000", "15 20:00", "dose"],
    ["d-md-20261015-2000", "15 20:00", "dose"],
    ["d-ma-20261016-0800", "16 08:00", "dose"],
    ["d-md-20261016-0800", "16 08:00", "dose"],
    ["d-ma-20261016-2000", "16 20:00", "dose"],
    ["d-md-20261016-2000", "16 20:00", "dose"]
  ], "marked, stopped and reminder-off doses never ring; a snoozed one rings when it ends; past alarms (md 14 20:00, p2) are the shell's");
  const dueNow = C.dueDoses(d, at(14, 20, 40)).map((r) => r.key);
  assert.ok(dueNow.includes("d-ma-20261014-2000-z" + at(14, 20, 31).toString(36)), "the shell uses the same snooze key");
  assert.deepEqual(C.alarmsBetween(d, 10, 5), []);
});

test("phone bridge: Health rows in reminderRows with the shell's keys and words", () => {
  const P = require(path.join(__dirname, "..", "phone.js"));
  const raw = data({ md: [med("ma", { n: "Lisinopril", s: "10 mg" })], ap: [ap("p1", { at: at(15, 10), rm: 60 })], vx: [vx("v1", { nx: "2026-10-22" })] });
  const now = at(14, 12);
  const rows = P.reminderRows({ lang: "el", healthTitle: "Υγεία", health: { core: C, data: JSON.parse(JSON.stringify(raw)) } }, now);
  const h = rows.filter((r) => r.ns === "health");
  assert.deepEqual(h.map((r) => r.id), [
    "health:d-ma-20261014-2000", "health:d-ma-20261015-0800", "health:a-p1-" + at(15, 10).toString(36) + "-60",
    "health:v-v1-20261022-w", "health:d-ma-20261015-2000", "health:d-ma-20261016-0800"]);
  const dose = h[0];
  assert.deepEqual([dose.kind, dose.title, dose.body, dose.link], ["note", "Υγεία", "Ώρα για το φάρμακο: Lisinopril 10 mg (20:00)", "health:meds"]);
  assert.equal(h.find((r) => /:a-/.test(r.id)).body, "Ραντεβού με γιατρό: Dr A · Cardiology, 15/10 10:00");
  assert.equal(h.find((r) => /:a-/.test(r.id)).link, "health:appts");
  assert.equal(h.find((r) => /:v-/.test(r.id)).body, "Επόμενη δόση εμβολίου σε μία εβδομάδα: Tetanus (22/10)");
  assert.ok(h.every((r) => r.at > now && r.at <= now + 48 * 3600000), "the next 48 hours");
  // the shell's engine emits the same dedup keys (ns "health" + ":" + key)
  const shell = fs.readFileSync(path.join(__dirname, "..", "shell.js"), "utf8");
  assert.ok(/Core\.dueAppts\(d, now\)/.test(shell) && /Core\.dueVax\(d, now\)/.test(shell), "shell engine reads appointments and vaccines");
  assert.ok(shell.includes('"Doctor\'s appointment: "') && shell.includes('"Time for your medicine: "'), "same words in the shell");
  const ph = fs.readFileSync(path.join(__dirname, "..", "phone.js"), "utf8");
  assert.ok(/localStorage\.getItem\("oros-health-data"\)\]\.join/.test(ph), "a Health change re-sends the reminders");
  assert.deepEqual(P.reminderRows({ health: { core: C, data: null } }, now), []);
});

test("Health Connect readings (v6): one Health reading each, checked, once, never over a deletion", () => {
  const P = require(path.join(__dirname, "..", "phone.js"));
  const now = at(14, 12);
  const ref = (n) => n + "0a1b2c3-4e5f-6071-8293-a4b5c6d7e8f9";
  const inc = { vitals: [
    { k: "wt", ref: ref(1), at: at(13, 7), v: [72400] },
    { k: "hr", ref: ref(2), at: at(13, 7), v: [58] },
    { k: "sl", ref: ref(3), at: at(12, 23), v: [431] },
    { k: "bp", ref: ref(4), at: at(13, 8), v: [128, 82], a: 2, p: 1 },
    { k: "gl", ref: ref(5), at: at(13, 8), v: [954], c: 1 },
    { k: "o2", ref: ref(6), at: at(13, 8), v: [97] },
    { k: "bp", ref: ref(7), at: at(13, 8), v: [80, 120] },          // diastolic above systolic
    { k: "wt", ref: ref(8), at: at(13, 8), v: [10] },              // out of range
    { k: "zz", ref: ref(9), at: at(13, 8), v: [1] },               // unknown kind
    { k: "hr", ref: "x", at: at(13, 8), v: [60] }                  // id too short
  ] };
  const r = P.healthIn({ health: null }, inc, now, {});
  const H = C.merge(r.health, r.health);
  assert.deepEqual(H.en.map((e) => [e.t, e.v, e.c, e.a, e.p]).sort(), [
    ["bp", [128, 82, 0], 0, 2, 1], ["gl", [954], 1, 0, 0], ["hr", [58], 0, 0, 0], ["o2", [97], 0, 0, 0],
    ["sl", [431, 0], 0, 0, 0], ["wt", [72400], 0, 0, 0]].sort(), "every reading passes Health's own normalizer");
  assert.ok(H.en.every((e) => /^hc-[a-z0-9]{2}-[0-9a-f]{32}$/.test(e.id)));
  const again = P.healthIn({ health: H }, inc, now + 1000, {});
  assert.equal(again.health, null, "nothing new the second time");
  const tomb = { ver: 1, en: [], ty: [], set: null, tombs: { ["en:" + H.en[0].id]: now } };
  const back = P.healthIn({ health: tomb }, inc, now + 2000, {});
  assert.ok(!back.health.en.some((e) => e.id === H.en[0].id), "a deleted reading does not come back");
  const kt = fs.readFileSync(path.join(__dirname, "..", "android/app/src/main/java/online/useoros/twa/HealthBridge.kt"), "utf8");
  const gen = fs.readFileSync(path.join(__dirname, "..", "android/tools/gen.js"), "utf8");
  [["WeightRecord", "READ_WEIGHT"], ["RestingHeartRateRecord", "READ_RESTING_HEART_RATE"], ["SleepSessionRecord", "READ_SLEEP"],
   ["BloodPressureRecord", "READ_BLOOD_PRESSURE"], ["BloodGlucoseRecord", "READ_BLOOD_GLUCOSE"], ["OxygenSaturationRecord", "READ_OXYGEN_SATURATION"]]
    .forEach(([rec, perm]) => {
      assert.ok(kt.includes("HealthPermission.getReadPermission(" + rec + "::class)"), rec + " asked");
      assert.ok(!kt.includes("HealthPermission.getWritePermission(" + rec + "::class)"), rec + " never written");
      assert.ok(gen.includes("android.permission.health." + perm), perm + " declared");
      assert.ok(!gen.includes("android.permission.health." + perm.replace("READ_", "WRITE_")), perm + ": no write declared");
    });
});

test("Today provider: appointments as events up to the horizon, vaccines due as tasks", () => {
  globalThis.OrosHealthCore = C;
  const P = require("../health/today.js");
  const raw = data({ ap: [ap("p1", { at: at(14, 15) }), ap("p2", { at: at(16, 9, 30), dr: "", sp: "Dentist", pl: "" }), ap("p3", { at: at(25, 9) })],
                     vx: [vx("v1", { nx: "2026-10-16" }), vx("v2", { n: "Flu", nx: "2026-08-01" }), vx("v3", { n: "HepB", nx: "2026-09-20" })] });
  const ctx = { readJSON: () => JSON.parse(JSON.stringify(raw)), today: "2026-10-14", horizon: 3, lang: "en", now: at(14, 12) };
  const rows = P.collect(ctx);
  assert.deepEqual(rows.map((r) => [r.id, r.due, r.time, r.kind, r.title]), [
    ["ap@p1", "2026-10-14", "15:00", "event", "Dr A · Cardiology"],
    ["ap@p2", "2026-10-16", "09:30", "event", "Dentist"],
    ["vx@v3", "2026-09-20", null, "task", "HepB"],
    ["vx@v1", "2026-10-16", null, "task", "Tetanus"]
  ], "later appointments and vaccines more than 30 days late stay out");
  assert.equal(rows[0].text, "Doctor's appointment · Main St 1");
  let opened = null;
  P.open({ appt: "p1" }, { __orosOpenAt: (app, t) => { opened = [app, t]; } });
  assert.deepEqual(opened, ["health", { appt: "p1" }]);
});

test("search provider: record rows open their editors; Calendar feed wired and opt-in", () => {
  const S = require(path.join(__dirname, "..", "search.js"));
  const P = require(path.join(__dirname, "..", "health", "search.js"));
  const d = data({ ap: [ap("p1", { nt: "bring results" })], vx: [vx("v1")], al: [C.normAllergy({ id: "a1", m: 1, n: "Penicillin", r: "rash" })],
                   cn: [C.normCond({ id: "c1", m: 1, n: "Asthma" })], dc: [C.normDoc({ id: "dabcdef1", m: 1, n: "Blood test", d: "2026-10-01" })],
                   tombs: { "cn:c1": 5 } });
  const store = { getItem: (k) => (k === "oros-health-data" ? JSON.stringify(d) : null) };
  const hits = P.search({ q: "", words: [], fold: S.fold, lang: "en", limit: 50, readJSON: S.makeReader(store) });
  const map = {};
  hits.forEach((h) => { map[h.id] = h; });
  assert.deepEqual(map["ap:p1"].target, { appt: "p1" });
  assert.equal(map["ap:p1"].text, "Main St 1 · bring results");
  assert.deepEqual(map["vx:v1"].target, { vax: "v1" });
  assert.deepEqual(map["al:a1"].target, { al: "a1" });
  assert.deepEqual(map["dc:dabcdef1"].target, { doc: "dabcdef1" });
  assert.ok(!map["cn:c1"], "tombstoned rows are skipped");
  let opened = null;
  P.open({ doc: "dabcdef1" }, { __orosOpenAt: (app, t) => { opened = [app, t]; } });
  assert.deepEqual(opened, ["health", { doc: "dabcdef1" }]);
  const cal = fs.readFileSync(path.join(__dirname, "../calendar/calendar.js"), "utf8");
  assert.ok(/OPT_IN_FEEDS = \[[^\]]*"lbl-feed-appts"/.test(cal), "opt-in");
  assert.ok(cal.includes(".concat(apptsFeedOn(dateStr))"));
  assert.ok(cal.includes('_openAt: { app: "health", target: { appt: a.id } }'));
  const app = fs.readFileSync(path.join(__dirname, "../health/health.js"), "utf8");
  assert.ok(/REC_TARGETS = \{ appt: \["ap", "appt"\], vax: \["vx", "vax"\], doc: \["dc", "docs"\]/.test(app), "the app receives the targets");
  const idx = fs.readFileSync(path.join(__dirname, "../health/index.html"), "utf8");
  assert.ok(idx.includes('src="../qr/qr-encode.js?v='), "QR encoder shared with QR Generator");
});
