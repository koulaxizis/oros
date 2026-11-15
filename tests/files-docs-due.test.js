// DOCS-1 wave 3: Documents' dates (files/docs-due.js), the Today
// provider (files/today.js) and the wiring in the shell, Calendar,
// Files and Automations.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const D = require("../files/docs-due.js");
const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

function slice(docs, extra) {
  return Object.assign({ v: 1, docs: docs, types: [], tags: [], corr: [], tombs: {} }, extra || {});
}
const doc = (id, o) => Object.assign({ id: id, m: 10, p: "/internal/Documents/2026/" + id + ".pdf", t: "Doc " + id, tg: [], ln: [] }, o);

test("expiry steps 30 / 7 / 0 and a week late", () => {
  const raw = slice([
    doc("d-a", { ex: "2026-12-13" }),       // 30 days
    doc("d-b", { ex: "2026-11-20" }),       // 7 days
    doc("d-c", { ex: "2026-11-13" }),       // today
    doc("d-d", { ex: "2026-11-08" }),       // 5 days late
    doc("d-e", { ex: "2026-11-01" }),       // 12 days late: too old
    doc("d-f", { ex: "2026-12-20" }),       // 37 days: not yet
    doc("d-g", { ex: "2026-11-25" })        // 12 days: step 30
  ]);
  const all = D.alerts(raw, "2026-11-13");
  const by = Object.fromEntries(all.map((a) => [a.id, a]));
  assert.deepStrictEqual(Object.keys(by).sort(), ["d-a", "d-b", "d-c", "d-d", "d-g"]);
  assert.strictEqual(by["d-a"].step, 30);
  assert.strictEqual(by["d-g"].step, 30);
  assert.strictEqual(by["d-b"].step, 7);
  assert.strictEqual(by["d-c"].step, 0);
  assert.strictEqual(by["d-d"].step, 0);
  assert.strictEqual(by["d-d"].left, -5);
  assert.strictEqual(all[0].id, "d-d", "the latest first");
});

test("keep-until passed in the last week is a note; forever never", () => {
  const raw = slice([
    doc("d-a", { kp: "2026-11-10" }),
    doc("d-b", { kp: "2026-11-13" }),       // today: not passed yet
    doc("d-c", { kp: "forever" }),
    doc("d-d", { kp: "2026-10-01" })        // long ago: the list shows it, no notice
  ]);
  const all = D.alerts(raw, "2026-11-13");
  assert.deepStrictEqual(all.map((a) => a.key), ["kp:d-a:2026-11-10"]);
  assert.strictEqual(all[0].kind, "kp");
});

test("each step is told once; a later step is told again; gone keys are pruned", () => {
  const raw = slice([doc("d-a", { ex: "2026-11-20" })]);
  let done = {};
  let all = D.alerts(raw, "2026-11-13");
  let fresh = D.toNotify(all, done);
  assert.strictEqual(fresh.length, 1);
  done = D.nextNotified(all, fresh, done);
  assert.deepStrictEqual(done, { "ex:d-a:2026-11-20": 7 });
  assert.strictEqual(D.toNotify(D.alerts(raw, "2026-11-14"), done).length, 0, "same step: quiet");
  all = D.alerts(raw, "2026-11-20");
  fresh = D.toNotify(all, done);
  assert.strictEqual(fresh.length, 1, "the day itself is told");
  done = D.nextNotified(all, fresh, Object.assign({ "ex:d-x:2026-01-01": 0 }, done));
  assert.deepStrictEqual(Object.keys(done), ["ex:d-a:2026-11-20"], "keys of alerts that are gone are dropped");
  // a new expiry date is a new alert
  const moved = slice([doc("d-a", { ex: "2026-11-27", m: 11 })]);
  assert.strictEqual(D.toNotify(D.alerts(moved, "2026-11-20"), done).length, 1);
});

test("tombstones hide documents; bad rows are skipped", () => {
  const raw = slice([doc("d-a", { ex: "2026-11-13" }), doc("d-b", { ex: "2026-11-13", m: 30 }), { id: "x", ex: "2026-11-13" }, null],
    { tombs: { "d-a": 10, "d-b": 20 } });
  assert.deepStrictEqual(D.alerts(raw, "2026-11-13").map((a) => a.id), ["d-b"], "a tomb at or after m hides, a newer edit wins");
  assert.deepStrictEqual(D.alerts(null, "2026-11-13"), []);
  assert.deepStrictEqual(D.alerts(raw, "not a day"), []);
});

test("lines in three languages; private documents show their type only", () => {
  const raw = slice([
    doc("d-a", { t: "Car insurance", ex: "2026-11-20" }),
    doc("d-b", { t: "Passport Maria", ty: "ty-id", ex: "2026-11-14" }),
    doc("d-c", { t: "Blood test", ln: [{ a: "health", r: { id: "x" }, t: "" }], ex: "2026-11-13" }),
    doc("d-d", { t: "Own secret", ty: "ty-own", ex: "2026-11-12" }),
    doc("d-e", { t: "", p: "/internal/scan 4.pdf", kp: "2026-11-10" })
  ], { types: [{ id: "ty-own", m: 1, n: "Secret", pv: true }, { id: "ty-id", m: 2, n: "Pass", pv: false }] });
  const all = D.alerts(raw, "2026-11-13");
  const line = (id, lang) => D.alertLine(all.find((a) => a.id === id), raw, lang);
  assert.strictEqual(line("d-a", "en"), "Car insurance expires in 7 days");
  assert.strictEqual(line("d-a", "el"), "Car insurance: λήγει σε 7 μέρες");
  assert.strictEqual(line("d-a", "de"), "Car insurance läuft in 7 Tagen ab");
  assert.strictEqual(line("d-b", "en"), "Passport Maria expires tomorrow", "an own edit of the ID type that is not private");
  assert.strictEqual(line("d-c", "en"), "A private document expires today", "linked to Health");
  assert.strictEqual(line("d-d", "en"), "A private document expired yesterday", "an own private type");
  assert.strictEqual(line("d-e", "en"), "scan 4.pdf: kept long enough (until 2026-11-10)", "no title: the file name");
  const plain = slice([doc("d-b", { t: "Passport Maria", ty: "ty-id", ex: "2026-11-14" })]);
  assert.strictEqual(D.alertLine(D.alerts(plain, "2026-11-13")[0], plain, "en"), "An ID or passport expires tomorrow");
  assert.ok(!JSON.stringify(D.feedRows(plain, "en")).includes("Maria"), "the calendar never shows a private title");
});

test("calendar rows on the expiry and keep-until days", () => {
  const raw = slice([doc("d-a", { t: "Lease", ex: "2027-03-01", kp: "2032-03-01" }), doc("d-b", { kp: "forever" })]);
  assert.deepStrictEqual(D.feedRows(raw, "en"), [
    { day: "2027-03-01", id: "d-a", key: "exd-a", title: "Lease expires" },
    { day: "2032-03-01", id: "d-a", key: "kpd-a", title: "Lease: keep until" }
  ]);
});

test("prefs: 09:00 by default, -1 is off, bad values fall back", () => {
  assert.deepStrictEqual(D.readPrefs(null), { remind: 9 });
  assert.deepStrictEqual(D.readPrefs({ remind: -1 }), { remind: -1 });
  assert.deepStrictEqual(D.readPrefs({ remind: 7 }), { remind: 7 });
  assert.deepStrictEqual(D.readPrefs({ remind: 24 }), { remind: 9 });
  assert.deepStrictEqual(D.readPrefs({ remind: "x" }), { remind: 9 });
});

test("Today provider: expiries in the horizon as tasks, passed keep-until as today's note", () => {
  global.OrosDocsDue = D;
  const P = require("../files/today.js");
  const raw = slice([
    doc("d-a", { ex: "2026-11-15" }), doc("d-b", { ex: "2026-12-10" }), doc("d-c", { ex: "2026-11-10" }), doc("d-d", { kp: "2026-11-12" })
  ]);
  const rows = P.collect({ today: "2026-11-13", horizon: 7, lang: "en", readJSON: () => raw });
  assert.deepStrictEqual(rows.map((r) => [r.id, r.due, r.kind]), [
    ["ex:d-c:2026-11-10", "2026-11-10", "task"],
    ["kp:d-d:2026-11-12", "2026-11-13", "info"],
    ["ex:d-a:2026-11-15", "2026-11-15", "task"]
  ]);
  assert.deepStrictEqual(rows[0].target, { doc: "d-c" });
  let opened = null;
  P.open({ doc: "d-c" }, { __orosOpenAt: (a, t) => { opened = [a, t]; } });
  assert.deepStrictEqual(opened, ["files", { doc: "d-c" }]);
  assert.deepStrictEqual(P.collect({ today: "2026-11-13", horizon: 7, lang: "en", readJSON: () => null }), []);
  delete global.OrosDocsDue;
});

test("wiring: shell reminder, deep link, Calendar feed, Files, Automations", () => {
  const shell = read("shell.js");
  assert.match(shell, /tickSafe\("docsCheckTick", docsCheckTickThrottled\)/);
  assert.match(shell, /function docsCheckTick\(\)[\s\S]*ns: "files"[\s\S]*deepLink: "files:"/);
  assert.match(shell, /todayAbsorbs\("files"\)/, "quiet when Today said it");
  assert.match(read("index.html"), /<script src="files\/docs-due\.js\?v=[^"]+"><\/script>/);
  const notifs = read("notifications.js");
  assert.match(notifs, /files:\s+function \(target\)[\s\S]*__orosOpenAt\('files'/);
  const cal = read("calendar/calendar.js");
  assert.match(cal, /\.concat\(docsFeedOn\(dateStr\)\)/);
  assert.match(cal, /id: "lbl-feed-docs"/);
  assert.match(cal, /_openAt: \{ app: "files", target: \{ doc: r\.id \} \}/);
  assert.match(read("calendar/index.html"), /<script src="\.\.\/files\/docs-due\.js\?v=[^"]+"><\/script>/);
  const files = read("files/files.js");
  assert.match(files, /typeof t\.doc === "string" \|\| typeof t\.docs === "string"/);
  assert.match(read("files/docs.js"), /show: function \(flag\)/);
  const A = require("../automations/core.js");
  const tp = A.templates("en").find((x) => x.id === "doc-renew");
  assert.ok(tp && tp.rule.when.t === "notice" && tp.rule.when.app === "files" && tp.rule.when.word === "expire");
  assert.ok(A.cleanWhen(tp.rule.when), "a valid notice rule");
});
