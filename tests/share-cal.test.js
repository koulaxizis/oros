// "Send to someone", kind "cal" (share wave 3): a whole calendar or a
// date range. The normalizer's caps, the .ics it builds (read back with
// the Calendar's own parser), the receiver it targets and the plain-link
// size guard.
// Run: node --test tests/
"use strict";

process.env.TZ = "Europe/Athens";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const K = require(path.join(ROOT, "share/kinds.js"));
const ICS = require(path.join(ROOT, "calendar/ics.js"));
const OCC = require(path.join(ROOT, "calendar/occur.js"));

function cal(extra) {
  return Object.assign({
    t: "Work", tz: "Europe/Athens",
    lb: [{ n: "Job", c: "#7AA2F7" }, { n: "Home", c: "red" }],
    ev: [
      { id: "a1", t: "Standup", d: "2026-11-02", s: "09:00", e: "09:15",
        r: { f: "W", i: 1, x: "FREQ=WEEKLY;BYDAY=MO,WE" }, xd: ["2026-11-04", "2026-11-04", "bad"], b: 0 },
      { id: "a2", t: "Trip", d: "2026-11-10", de: "2026-11-12", xd: ["2026-11-11"], b: 7 },
      { id: "a3", t: "Call NY", d: "2026-11-05", s: "10:00", e: "11:00", z: "America/New_York", b: 1 }
    ]
  }, extra || {});
}

test("cal: labels, excluded dates, zones and label indexes are cleaned", () => {
  const d = K.norm("cal", cal({ f: "2026-11-01", u: "2026-11-30" }));
  assert.equal(d.t, "Work");
  assert.equal(d.tz, "Europe/Athens");
  assert.deepEqual(d.lb, [{ n: "Job", c: "#7aa2f7" }, { n: "Home", c: "" }]);
  assert.deepEqual(d.ev[0].xd, ["2026-11-04"]);
  assert.equal(d.ev[0].b, 0);
  assert.equal(d.ev[1].xd, undefined, "excluded dates only on a series");
  assert.equal(d.ev[1].b, undefined, "a label index out of range is dropped");
  assert.equal(d.ev[2].z, "America/New_York");
  assert.equal(d.ev[2].b, 1);
  assert.equal(d.f, "2026-11-01");
  assert.equal(d.u, "2026-11-30");
});

test("cal: refusals and caps", () => {
  assert.equal(K.norm("cal", { t: "x", ev: [] }), null);
  assert.equal(K.norm("cal", { t: "x", ev: [{ t: "no date" }] }), null);
  const d = K.norm("cal", { t: "x", tz: "../../etc", f: "2026-12-01", u: "2026-11-01",
    ev: [{ id: "same", t: "a", d: "2026-01-01" }, { id: "same", t: "b", d: "2026-01-02" }, { t: "c", d: "2026-01-03", z: "Europe/Paris" }] });
  assert.equal(d.tz, undefined);
  assert.equal(d.f, "2026-12-01");
  assert.equal(d.u, undefined, "an end before the start is dropped");
  assert.equal(d.ev.length, 2, "one event per id");
  assert.match(d.ev[1].id, /^c[0-9a-f]{8}$/, "an event without id gets a stable one");
  assert.equal(d.ev[1].z, undefined, "an all-day event has no zone");
  const many = K.norm("cal", { t: "x", ev: Array.from({ length: 6000 }, (_, i) => ({ id: "e" + i, t: "E", d: "2026-01-01" })) });
  assert.equal(many.ev.length, 5000);
  const fat = K.norm("cal", { t: "x", ev: Array.from({ length: 5000 }, (_, i) => ({ id: "e" + i, t: "T".repeat(200), d: "2026-01-01", l: "L".repeat(200), x: "X".repeat(500) })) });
  assert.ok(JSON.stringify(fat).length <= 3100000, "about 3 MB at most");
  assert.ok(fat.ev.length < 5000);
});

test("cal: the .ics reads back in the Calendar with rules, excluded dates, zones and labels", () => {
  const d = K.norm("cal", cal());
  const f = K.file({ v: 1, k: "cal", d }, "en");
  assert.equal(f.name, "Work.ics");
  assert.match(f.mime, /^text\/calendar/);
  assert.match(f.text, /X-WR-CALNAME:Work/);
  const r = ICS.parse(f.text);
  assert.equal(r.events.length, 3);
  assert.equal(r.simplified, 0);
  const by = Object.fromEntries(r.events.map((e) => [e.title, e]));
  assert.equal(by.Standup.date, "2026-11-02");
  assert.equal(by.Standup.start, "09:00");
  assert.deepEqual(by.Standup.recur.byday, [1, 3]);
  assert.deepEqual(by.Standup.recur.exdates, ["2026-11-04"]);
  assert.deepEqual(by.Standup.cats, ["Job"]);
  assert.equal(by.Trip.dateEnd, "2026-11-12");
  assert.equal(by.Trip.start, null);
  assert.equal(by["Call NY"].tz, "America/New_York", "a zone other than this device's is kept");
  assert.equal(by["Call NY"].start, "10:00");
  // A second import of the same file updates instead of duplicating.
  assert.deepEqual(ICS.parse(f.text).events.map((e) => e.id), r.events.map((e) => e.id));
});

test("cal: summary, text and Add to my orOS", () => {
  const env = K.pack("cal", cal({ f: "2026-11-01", u: "2026-11-30" }));
  assert.equal(K.summary(env, "en"), "Calendar «Work» · 3 events");
  assert.equal(K.summary(env, "el"), "Ημερολόγιο «Work» · 3 γεγονότα");
  const txt = K.text(env, "en");
  assert.match(txt, /from .*1 November 2026 to .*30 November 2026/);
  assert.ok(txt.indexOf("Standup") < txt.indexOf("Call NY") && txt.indexOf("Call NY") < txt.indexOf("Trip"), "sorted by date");
  const go = K.target(env, "en");
  assert.equal(go.app, "calendar");
  assert.equal(go.target.importIcs.name, "Work.ics");
  assert.equal(ICS.parse(go.target.importIcs.text).events.length, 3);
  const src = fs.readFileSync(path.join(ROOT, "calendar/calendar.js"), "utf8");
  assert.match(src, /target\.importIcs/);
  assert.equal(K.title(K.pack("cal", { ev: [{ t: "a", d: "2026-01-01" }] }), "el"), "Ημερολόγιο");
});

test("cal: the receiving page's occurrences come from the Calendar's rules", () => {
  // The same conversion view.js makes (calItems): RRULE text → recur,
  // excluded dates kept, the sender's zone on timed events.
  const d = K.norm("cal", cal());
  const e = d.ev[0];
  const r = OCC.fromRrule(e.r.x, e.d).recur;
  r.exdates = e.xd;
  const ce = { date: e.d, start: e.s, end: e.e, tz: d.tz, recur: OCC.normRecur(r, e.d) };
  const days = [];
  OCC.instancesBetween(ce, "2026-11-01", "2026-11-15", (i) => { days.push(i.date); return true; });
  assert.deepEqual(days, ["2026-11-02", "2026-11-09", "2026-11-11"]);
  const view = fs.readFileSync(path.join(ROOT, "share/view.js"), "utf8");
  assert.match(view, /O\.fromRrule\(e\.r\.x, e\.d\)/);
  assert.match(view, /r\.exdates = e\.xd \|\| \[\]/);
  const page = fs.readFileSync(path.join(ROOT, "share/index.html"), "utf8");
  assert.match(page, /<script src="\.\.\/calendar\/occur\.js\?v=[^"]+"><\/script>/);
  assert.ok(page.indexOf("calendar/occur.js") < page.indexOf("view.js"));
});

test("cal: too much for a plain link is refused there (it goes with an expiry)", async () => {
  const ev = Array.from({ length: 4500 }, (_, i) => ({ id: "e" + i, t: "Event number " + i, d: "2026-01-01", l: "Somewhere " + i }));
  const big = K.pack("cal", { t: "Big", ev });
  assert.ok(JSON.stringify(big).length > K.MAX_JSON);
  await assert.rejects(K.encode(big), /big/);
  const small = K.pack("cal", cal());
  const code = await K.encode(small);
  const back = await K.decode(code);
  assert.deepEqual(back.env, small);
  const send = fs.readFileSync(path.join(ROOT, "share/send.js"), "utf8");
  assert.match(send, /codeFor\(0, ""\)\.then\(sizeCheck, tooBig\)/);
});

test("cal: the Calendar offers it, EN and EL", () => {
  const html = fs.readFileSync(path.join(ROOT, "calendar/index.html"), "utf8");
  const js = fs.readFileSync(path.join(ROOT, "calendar/calendar.js"), "utf8");
  ["mm-send", "scal-dlg", "sc-lbl", "sc-range", "sc-from", "sc-to", "sc-go", "sc-no", "sc-sum"].forEach((id) =>
    assert.match(html, new RegExp('id="' + id + '"'), id));
  assert.match(js, /api\.open\(\{ kind: "cal", data: data \}\)/);
  const keys = [...html.matchAll(/data-i18n="(sc\.[a-z.0-9]+|mm\.send)"/g)].map((m) => m[1]);
  assert.ok(keys.length >= 6);
  ["mm.send", "sc.title", "sc.text", "sc.which", "sc.all", "sc.range", "sc.r.all", "sc.r.month", "sc.r.3m", "sc.r.year",
   "sc.r.pick", "sc.from", "sc.to", "sc.sum", "sc.sum1", "sc.none", "sc.cap", "sc.go", "sc.calName"].forEach((k) => {
    const n = js.split('"' + k + '":').length - 1;
    assert.equal(n, 2, k + " in EN and EL");
  });
});
