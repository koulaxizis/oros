// Time › Stage (conference timer): the pure core (time/stage-core.js)
// — normalize, the sync merge (slice "stage"), the live timer with its
// warnings and overtime, the day's schedule (planned vs expected,
// behind / ahead), the run-state transitions — plus a two-device round
// trip through the real sync engine (tests/harness.js) and the page
// wiring (tab, pane, scripts, deep link, i18n parity).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const C = require("../time/stage-core.js");
const { FakeDropbox, createDevice, readKey, writeKey } = require("./harness");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const json = (x) => JSON.stringify(x);
const KEY = "oros-time-stage";
const at = (h, m, s) => new Date(2026, 9, 20, h, m || 0, s || 0).getTime();   // 2026-10-20, local
const MIN = 60000;

const ev = (o) => Object.assign({ id: "evaaaa1", name: "Conf", date: "2026-10-20", start: "09:00", yellow: 120, red: 30, flash: true, mtime: 1 }, o || {});
const it = (id, pos, o) => Object.assign({ id, ev: "evaaaa1", pos, title: id, speaker: "", kind: "down", dur: 600, until: "", auto: false, yellow: null, red: null, notes: "", mtime: 1 }, o || {});
const model = (o) => C.canon(Object.assign({ v: 1, events: [ev()], items: [], tombs: [] }, o || {}));

// ---------------------------------------------------------------
// Normalize
// ---------------------------------------------------------------

test("normalize: bad rows dropped, text cleaned, numbers clamped, defaults filled", () => {
  const d = C.canon({
    events: [ev({ name: "  Big\nday\u0001 ", date: "2026-13-01", start: "25:00", yellow: -5, red: 99999 }), { id: "BAD ID" }, null],
    items: [
      it("itaaaa1", 1, { kind: "nope", dur: 999999, until: "7:00", yellow: "x", title: "<b>Hi</b>", notes: "a\nb" }),
      it("itaaaa2", 2, { ev: "" }),
      { id: "itaaaa3" }
    ],
    tombs: [{ id: "x" }, { id: "gone001", t: 5 }]
  });
  assert.equal(d.events.length, 1);
  const e = d.events[0];
  assert.equal(e.name, "Big day");
  assert.equal(e.date, "");
  assert.equal(e.start, "");
  assert.equal(e.yellow, 0);
  assert.equal(e.red, 3600);
  assert.equal(d.items.length, 1);
  const i = d.items[0];
  assert.equal(i.kind, "down");
  assert.equal(i.dur, 24 * 3600);
  assert.equal(i.until, "");
  assert.equal(i.yellow, null);
  assert.equal(i.title, "<b>Hi</b>", "kept as text; the page renders with textContent");
  assert.equal(i.notes, "a\nb");
  assert.deepEqual(d.tombs, [{ id: "gone001", t: 5 }]);
});

// ---------------------------------------------------------------
// Merge
// ---------------------------------------------------------------

test("merge: union by id, newer mtime wins, equal mtime picks the same copy on both sides", () => {
  const a = model({ items: [it("itaaaa1", 1, { title: "A", mtime: 5 }), it("itaaaa2", 2)] });
  const b = model({ items: [it("itaaaa1", 1, { title: "B", mtime: 9 }), it("itaaaa3", 3)] });
  const m = C.merge(a, b);
  assert.deepEqual(m.items.map((x) => x.id), ["itaaaa1", "itaaaa2", "itaaaa3"]);
  assert.equal(m.items[0].title, "B");
  const x = model({ items: [it("itaaaa1", 1, { title: "X", mtime: 7 })] });
  const y = model({ items: [it("itaaaa1", 1, { title: "Y", mtime: 7 })] });
  assert.equal(json(C.merge(x, y)), json(C.merge(y, x)));
});

test("merge: deletion wins ties, a later edit brings an item back, a deleted event's items stay deleted", () => {
  const base = model({ items: [it("itaaaa1", 1, { mtime: 10 }), it("itaaaa2", 2, { mtime: 10 })] });
  const del = Object.assign({}, base, { items: [base.items[1]], tombs: [{ id: "itaaaa1", t: 10 }] });
  assert.deepEqual(C.merge(base, del).items.map((x) => x.id), ["itaaaa2"]);
  const edited = model({ items: [it("itaaaa1", 1, { mtime: 11 })] });
  const back = C.merge(del, edited);
  assert.ok(back.items.some((x) => x.id === "itaaaa1"));
  assert.ok(!back.tombs.some((t) => t.id === "itaaaa1"), "a survivor clears its tombstone");

  // the page tombstones an event AND its items; an item edited
  // elsewhere after that stays as data (not shown: its event is gone)
  const evGone = { v: 1, events: [], items: [], tombs: [{ id: "evaaaa1", t: 20 }, { id: "itaaaa1", t: 20 }] };
  const late = model({ items: [it("itaaaa1", 1, { mtime: 10 }), it("itaaaa9", 9, { mtime: 25 })] });
  const m = C.merge(late, evGone);
  assert.equal(m.events.length, 0);
  assert.deepEqual(m.items.map((x) => x.id), ["itaaaa9"]);
  assert.deepEqual(C.rundown(m, "evaaaa1").map((x) => x.id), ["itaaaa9"], "the page shows no rundown without its event");
});

test("merge fuzz: symmetric, idempotent, merge(s, s) = s, inputs untouched", () => {
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const ids = ["itaaaa1", "itaaaa2", "itaaaa3", "itaaaa4", "evaaaa1", "evbbbb2"];
  const side = () => {
    const events = [], items = [], tombs = [];
    ["evaaaa1", "evbbbb2"].forEach((id) => { if (rnd(3)) events.push(ev({ id, name: "n" + rnd(3), mtime: rnd(5) })); });
    for (let i = 0; i < 4; i++) {
      if (rnd(3)) items.push(it(ids[i], rnd(4) * 1000, { ev: rnd(2) ? "evaaaa1" : "evbbbb2", title: "t" + rnd(3), mtime: rnd(5) }));
    }
    for (let i = 0; i < 2; i++) if (!rnd(3)) tombs.push({ id: ids[rnd(ids.length)], t: rnd(6) });
    return { v: 1, events, items, tombs };
  };
  for (let n = 0; n < 2000; n++) {
    const a = side(), b = side(), c = side();
    const a0 = json(a), b0 = json(b);
    const ab = C.merge(a, b);
    assert.equal(json(ab), json(C.merge(b, a)), "symmetric");
    assert.equal(json(C.merge(ab, ab)), json(ab), "canonical");
    assert.equal(json(C.merge(ab, b)), json(ab), "idempotent");
    assert.equal(json(C.merge(C.merge(a, b), c)), json(C.merge(a, C.merge(b, c))), "associative");
    assert.equal(json(a), a0); assert.equal(json(b), b0);
  }
});

test("rundown order and posBetween: moving one item never renumbers the others", () => {
  const d = model({ items: [it("itaaaa2", 2000), it("itaaaa1", 1000), it("itaaaa3", 3000), it("itother", 1, { ev: "evzzzz9" })] });
  assert.deepEqual(C.rundown(d, "evaaaa1").map((x) => x.id), ["itaaaa1", "itaaaa2", "itaaaa3"]);
  assert.equal(C.posBetween(1000, 2000), 1500);
  assert.equal(C.posBetween(null, 1000), 0);
  assert.equal(C.posBetween(3000, null), 4000);
  assert.equal(C.posBetween(null, null), 1000);
});

// ---------------------------------------------------------------
// Timer
// ---------------------------------------------------------------

test("timer: countdown phases ok → warn → red → over, overtime keeps counting", () => {
  const e = ev(), i = it("itaaaa1", 1, { dur: 300 });
  const run = C.select({}, "itaaaa1", at(9), true);
  const p = (ms) => C.timer(i, e, run, at(9) + ms);
  assert.equal(C.timer(i, e, C.select({}, "itaaaa1", at(9), false), at(9)).phase, "idle");
  assert.equal(p(0).phase, "ok");
  assert.equal(p(179000).phase, "ok");
  assert.equal(p(181000).phase, "warn");
  assert.equal(p(271000).phase, "red");
  assert.equal(p(300000).phase, "over");
  assert.equal(C.fmt(p(300000 + 135000).shown), "−02:15");
  assert.equal(p(150000).progress, 0.5);
});

test("timer: per-item thresholds override the event, count-up and time-of-day", () => {
  const e = ev();
  const i = it("itaaaa1", 1, { dur: 600, yellow: 300, red: 60 });
  const run = C.select({}, "itaaaa1", at(9), true);
  assert.equal(C.timer(i, e, run, at(9, 4, 30)).phase, "ok");
  assert.equal(C.timer(i, e, run, at(9, 5, 30)).phase, "warn");
  assert.equal(C.timer(i, e, run, at(9, 9, 30)).phase, "red");
  const up = it("itaaaa1", 1, { kind: "up", dur: 0 });
  const tu = C.timer(up, e, run, at(9, 3));
  assert.equal(tu.phase, "ok");
  assert.equal(C.fmt(tu.shown, true), "03:00");
  const clock = it("itaaaa1", 1, { kind: "clock" });
  assert.equal(C.timer(clock, e, run, at(9, 3)).phase, "clock");
});

test("timer: 'until' items end at a clock time, pause freezes, +1 minute extends", () => {
  const e = ev();
  const i = it("itaaaa1", 1, { kind: "until", until: "11:00" });
  let run = C.select({}, "itaaaa1", at(10, 40), true);
  assert.equal(C.fmt(C.timer(i, e, run, at(10, 50)).shown), "10:00");
  run = C.addTime(run, 60);
  assert.equal(C.fmt(C.timer(i, e, run, at(10, 50)).shown), "11:00");

  const d = it("itaaaa2", 2, { dur: 600 });
  let r2 = C.select({}, "itaaaa2", at(9), true);
  r2 = C.pause(r2, at(9, 2));
  assert.equal(C.fmt(C.timer(d, e, r2, at(9, 7)).shown), "08:00", "paused: no time passes");
  assert.equal(C.timer(d, e, r2, at(9, 7)).paused, true);
  r2 = C.start(r2, at(9, 7));
  assert.equal(C.fmt(C.timer(d, e, r2, at(9, 8)).shown), "07:00", "resumes where it stopped");
});

test("fmt: count-downs round up, overtime rounds down, hours when needed", () => {
  assert.equal(C.fmt(10200), "00:11");
  assert.equal(C.fmt(0), "00:00");
  assert.equal(C.fmt(-500), "00:00");
  assert.equal(C.fmt(-1500), "−00:01");
  assert.equal(C.fmt(3723000), "1:02:03");
  assert.equal(C.fmt(59900, true), "00:59");
});

// ---------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------

test("schedule: planned times from the event start, 'until' breaks end on the clock", () => {
  const list = [it("itaaaa1", 1, { dur: 1800 }), it("itaaaa2", 2, { kind: "until", until: "10:00" }), it("itaaaa3", 3, { dur: 900 })];
  const s = C.schedule(ev(), list, C.normRun({}), at(8));
  assert.deepEqual(s.rows.map((r) => C.hm(r.planStart)), ["09:00", "09:30", "10:00"]);
  assert.equal(C.hm(s.planEnd), "10:15");
  assert.equal(s.delta, 0, "before the start nothing is late");
  assert.equal(C.hm(s.rows[0].expStart), "09:00");
});

test("schedule: overtime pushes the rest of the day, a short talk pulls it forward", () => {
  const list = [it("itaaaa1", 1, { dur: 1800 }), it("itaaaa2", 2, { dur: 1800 }), it("itaaaa3", 3, { dur: 900 })];
  // first talk starts on time and runs 10 minutes over
  let run = C.select({ ev: "evaaaa1" }, "itaaaa1", at(9), true);
  let s = C.schedule(ev(), list, run, at(9, 40));
  assert.equal(s.rows[0].state, "live");
  assert.equal(Math.round(s.delta / MIN), 10);
  assert.equal(C.hm(s.rows[1].expStart), "09:40");
  assert.equal(C.hm(s.expEnd), "10:25");
  // next: the first is done, the second ends 5 minutes early
  run = C.select(run, "itaaaa2", at(9, 40), true);
  s = C.schedule(ev(), list, run, at(10, 5));
  assert.equal(s.rows[0].state, "done");
  assert.equal(Math.round((s.rows[0].actual.e - s.rows[0].actual.s) / MIN), 40);
  run = C.select(run, "itaaaa3", at(10, 5), true);
  s = C.schedule(ev(), list, run, at(10, 5));
  assert.equal(Math.round(s.delta / MIN), 5, "now only 5 minutes behind");
  // finish all
  run = C.finish(run, at(10, 15));
  s = C.schedule(ev(), list, run, at(11));
  assert.deepEqual(s.rows.map((r) => r.state), ["done", "done", "done"]);
  assert.equal(C.hm(s.expEnd), "10:15");
  assert.equal(s.delta, 0);
});

test("schedule: jumping ahead marks skipped items; no start time = expected times only", () => {
  const list = [it("itaaaa1", 1), it("itaaaa2", 2), it("itaaaa3", 3)];
  const run = C.select({}, "itaaaa3", at(9), true);
  const s = C.schedule(ev(), list, run, at(9, 1));
  assert.deepEqual(s.rows.map((r) => r.state), ["skipped", "skipped", "live"]);
  const s2 = C.schedule(ev({ start: "" }), list, C.normRun({}), at(14));
  assert.equal(s2.hasPlan, false);
  assert.equal(s2.rows[0].planStart, null);
  assert.equal(C.hm(s2.rows[0].expStart), "14:00");
  assert.equal(C.hm(s2.expEnd), "14:30");
});

test("run: select again clears the old result, reset restarts, normRun cleans junk", () => {
  let run = C.select({}, "itaaaa1", at(9), true);
  run = C.select(run, "itaaaa2", at(9, 10), true);
  assert.deepEqual(run.log.itaaaa1, { s: at(9), e: at(9, 10) });
  run = C.select(run, "itaaaa1", at(9, 20), false);
  assert.equal(run.log.itaaaa1, undefined, "running an item again starts it fresh");
  assert.equal(run.log.itaaaa2.e, at(9, 20));
  run = C.start(run, at(9, 21));
  run = C.reset(run);
  assert.equal(run.startedAt, 0);
  assert.equal(run.log.itaaaa1, undefined);
  const junk = C.normRun({ ev: "<x>", cur: 5, startedAt: "a", adj: 1e12, log: { "bad id": { s: 1 }, itaaaa1: { s: "x" }, itaaaa2: { s: 3 } } });
  assert.deepEqual(junk, { ev: "", cur: "", startedAt: 0, pausedAt: 0, adj: 86400, log: { itaaaa2: { s: 3, e: null } } });
  assert.equal(C.neighbour([it("a1aaaa"), it("b2bbbb")], "a1aaaa", 1), "b2bbbb");
  assert.equal(C.neighbour([it("a1aaaa"), it("b2bbbb")], "b2bbbb", 1), null);
});

// ---------------------------------------------------------------
// Sync: two devices through the real engine
// ---------------------------------------------------------------

test("sync: edits on two devices converge through the 'stage' slice, then nothing re-uploads", async () => {
  const db = new FakeDropbox();
  const A = await createDevice(db, "A");
  const B = await createDevice(db, "B");
  const reg = (dev) => dev.sync.registerSlice("stage",
    () => C.canon(readKey(dev, KEY) || C.empty()),
    (data) => writeKey(dev, KEY, C.canon(data)),
    KEY, C.merge);
  reg(A); reg(B);
  writeKey(A, KEY, model({ items: [it("itaaaa1", 1000, { mtime: 2 })] }));
  A.sync.markDirty();
  await A.sync.push();
  await B.sync.pull();
  assert.equal(readKey(B, KEY).items.length, 1);

  const edit = (dev, fn) => { const cur = readKey(dev, KEY); fn(cur); writeKey(dev, KEY, C.canon(cur)); dev.sync.markDirty(); };
  edit(A, (d) => d.items.push(it("itaaaa2", 2000, { title: "Keynote", mtime: 3 })));
  edit(B, (d) => { d.items = []; d.tombs.push({ id: "itaaaa1", t: 4 }); d.items.push(it("itbbbb3", 3000, { mtime: 4 })); });
  await A.sync.push();
  await B.sync.push();
  await A.sync.pull();
  const a = readKey(A, KEY), b = readKey(B, KEY);
  assert.equal(json(a), json(b));
  assert.deepEqual(a.items.map((x) => x.id), ["itaaaa2", "itbbbb3"]);
  assert.equal(A.sync.isDirty(), false);
  assert.equal(B.sync.isDirty(), false);
  await B.sync.pull();
  assert.equal(B.sync.isDirty(), false, "a pull of the same state marks nothing dirty");
});

// ---------------------------------------------------------------
// Page wiring
// ---------------------------------------------------------------

test("page: Stage tab, pane and scripts in order; deep link 'stage'; EN/EL strings match", () => {
  const html = read("time/index.html");
  assert.match(html, /data-pane="pane-stage"/);
  assert.match(html, /id="pane-stage"/);
  const iCore = html.indexOf("stage-core.js"), iStage = html.indexOf("stage.js?"), iTime = html.indexOf("time.js?");
  assert.ok(iTime > 0 && iCore > iTime && iStage > iCore, "time.js, then stage-core.js, then stage.js");
  const tjs = read("time/time.js");
  assert.match(tjs, /stage:\s*"pane-stage"/);
  assert.match(tjs, /"tab\.stage": "Stage"/);
  assert.match(tjs, /"tab\.stage": "Σκηνή"/);

  const src = read("time/stage.js");
  const block = (lang) => {
    const i = src.indexOf("    " + lang + ": {"), j = src.indexOf("\n    }", i);
    return new Set([...src.slice(i, j).matchAll(/"(stg\.[a-z0-9.]+)":/g)].map((m) => m[1]));
  };
  const en = block("en"), el = block("el");
  assert.ok(en.size > 40);
  assert.deepEqual([...en].sort(), [...el].sort(), "same keys in both languages");
  const used = new Set([...html.matchAll(/data-i18n-s(?:-ph|-a)?="([^"]+)"/g)].map((m) => m[1]));
  used.forEach((k) => assert.ok(en.has(k), "missing string " + k));
  assert.deepEqual([...src.matchAll(/innerHTML\s*=\s*([^;]+);/g)].map((m) => m[1].trim()).filter((v) => v !== '""'), [], "innerHTML only ever cleared");
  assert.match(src, /registerSlice\(\s*"stage",[\s\S]*?DATA_KEY,\s*C\.merge\s*\)/, "five-argument registration");
});

// ---------------------------------------------------------------
// Wave 2: saved messages, stage output state, display window
// ---------------------------------------------------------------

test("msgs: saved speaker messages merge like items; the key is left out when empty", () => {
  assert.equal("msgs" in C.canon(model()), false, "a wave-1 device writes the same bytes");
  const a = model({ msgs: [{ id: "msaaaa1", text: " Wrap up\n", mtime: 2 }, { id: "msbbbb2", text: "", mtime: 2 }] });
  assert.deepEqual(a.msgs, [{ id: "msaaaa1", text: "Wrap up", mtime: 2 }], "trimmed, empty dropped");
  const b = { v: 1, events: [ev()], items: [], tombs: [{ id: "msaaaa1", t: 2 }] };
  const m = C.merge(a, b);
  assert.equal("msgs" in m, false, "deleted (delete wins ties)");
  assert.equal(json(m), json(C.merge(b, a)));
  const c = model({ msgs: [{ id: "msaaaa1", text: "Wrap up now", mtime: 3 }] });
  assert.equal(C.merge(m, c).msgs[0].text, "Wrap up now", "a later edit comes back");
});

test("normShow: layouts, colours and the message are cleaned; an empty message is never on", () => {
  assert.deepEqual(C.normShow(null), { black: false, layout: "full", mirror: false, logoAt: 0,
    msg: { text: "", on: false, flash: false, color: "white", at: 0 } });
  const s = C.normShow({ black: true, layout: "agenda", mirror: 1, msg: { text: " Louder\tplease ", on: true, color: "pink", flash: true } });
  assert.equal(s.layout, "agenda");
  assert.equal(s.mirror, false, "only true is true");
  assert.equal(s.msg.text, "Louder please");
  assert.equal(s.msg.color, "white");
  assert.equal(C.normShow({ layout: "huge", msg: { text: "  ", on: true } }).msg.on, false);
  assert.equal(C.normShow({ layout: "huge" }).layout, "full");
});

test("focus: the live item, else the next one to run, else none", () => {
  const list = [it("itaaaa1", 1), it("itaaaa2", 2)];
  let run = C.normRun({});
  assert.equal(C.focus(list, C.schedule(ev(), list, run, at(9)), run).id, "itaaaa1");
  run = C.select(run, "itaaaa2", at(9), true);
  assert.equal(C.focus(list, C.schedule(ev(), list, run, at(9)), run).id, "itaaaa2");
  run = C.finish(C.select(run, "itaaaa1", at(9, 1), true), at(9, 2));
  run = C.finish(C.select(run, "itaaaa2", at(9, 2), true), at(9, 3));
  assert.equal(C.focus(list, C.schedule(ev(), list, run, at(9, 4)), run), null);
});

test("display window: own page with the shared renderer, writes nothing, no DL-1 redirect", () => {
  const html = read("time/display.html");
  const i1 = html.indexOf("stage-core.js"), i2 = html.indexOf("stage-view.js"), i3 = html.indexOf("display.js");
  assert.ok(i1 > 0 && i2 > i1 && i3 > i2);
  assert.match(html, /stage-view\.css/);
  assert.doesNotMatch(html, /window\.top === window\.self/, "a popup window, not an app page");
  const js = read("time/display.js") + read("time/stage-view.js");
  assert.doesNotMatch(js, /localStorage\.setItem|markDirty|registerSlice/, "reads storage only");
  assert.doesNotMatch(js, /innerHTML/);
  const tindex = read("time/index.html");
  const v = tindex.indexOf("stage-view.js?");
  assert.ok(v > tindex.indexOf("stage-core.js?") && v < tindex.indexOf("stage.js?"), "core, view, then stage.js");
  assert.match(read("time/stage.js"), /window\.open\("display\.html\?standalone"/);
});

// ---------------------------------------------------------------
// Wave 3: paired devices (remote-link.js, time/stage-link.js)
// ---------------------------------------------------------------
const snapData = () => model({
  items: [it("itaaaa1", 1, { title: "Keynote", speaker: "Maria", notes: "private: bring water" }), it("itaaaa2", 2), it("itaaaa3", 3, { ev: "evother1" })],
  msgs: [{ id: "msaaaa1", text: "Wrap up now", mtime: 5 }]
});
const liveRun = () => C.select(C.normRun({ ev: "evaaaa1" }), "itaaaa1", at(9), true);

test("remote link: the shared module speaks Studio's protocol; another namespace is another room and key", async () => {
  globalThis.window = globalThis;
  require("../remote-link.js");
  require("../studio/remote.js");
  const L = globalThis.OrosRemoteLink, S = globalThis.StudioRemote._test;
  const a = await L.derive("123456"), s = await S.derive("123456"), t = await L.derive("123456", "oros-time-stage");
  assert.equal(a.room, s.room, "default namespace = Studio's rooms");
  assert.notEqual(t.room, a.room);
  const box = await S.seal(s.key, { k: "app", d: { t: "hi" } });
  assert.deepEqual(await L.unseal(a.key, box), { k: "app", d: { t: "hi" } }, "and Studio's key");
  assert.equal(await L.unseal(t.key, box), null, "Time's key opens nothing of Studio's");
  assert.equal((await L.derive("123456", "Bad NS!")).room, a.room, "a bad namespace falls back");
  assert.match(L.newCode(), /^[1-9][0-9]{5}$/);
  const src = read("remote-link.js");
  assert.match(src, /if \(okRid && r !== okRid\) \{ frame\(\{ k: "deny" \}\); return; \}/, "one device per code");
  assert.match(src, /var okRid = self\.role === "host" && RID_RE\.test\(o\.allow \|\| ""\) \? o\.allow : ""/, "only a well-formed id comes back after a reload");
  assert.doesNotMatch(src, /\beval\(|new Function|innerHTML|document\.write/);
});

test("devState: only the open event, no private notes, the logo stays home, messages only for the remote", () => {
  const st = C.devState(snapData(), liveRun(), { black: true, logoAt: 99, layout: "agenda" }, "display", 1234);
  assert.equal(st.t, "st");
  assert.equal(st.role, "display");
  assert.equal(st.now, 1234);
  assert.deepEqual(st.items.map((x) => x.id), ["itaaaa1", "itaaaa2"]);
  assert.ok(!json(st).includes("private"), "notes are never sent");
  assert.ok(!("notes" in st.items[0]) && !("mtime" in st.items[0]));
  assert.equal(st.show.logoAt, 0);
  assert.equal(st.show.black, true);
  assert.deepEqual(st.msgs, []);
  assert.deepEqual(C.devState(snapData(), liveRun(), {}, "remote", 0).msgs, ["Wrap up now"]);
  assert.equal(C.devState(snapData(), liveRun(), {}, "admin", 0), null);
  assert.equal(C.devState(snapData(), C.normRun({}), {}, "moderator", 0).ev, null, "no open event: nothing to show");
});

test("devState: a very long rundown is cut around the live item and fits the link", () => {
  const items = [];
  for (let i = 0; i < 300; i++) items.push(it("itlong" + String(i).padStart(3, "0"), i, { title: "A long talk title number " + i + " ".repeat(5) + "x".repeat(150), speaker: "Speaker with a long name " + "y".repeat(90) }));
  const data = model({ items });
  const run = C.select(C.normRun({ ev: "evaaaa1" }), "itlong150", at(9), true);
  const st = C.devState(data, run, {}, "moderator", 0);
  assert.ok(json(st).length <= 11000, "fits: " + json(st).length);
  assert.equal(st.cut, true);
  assert.ok(st.items.some((x) => x.id === "itlong150"), "the live item is in it");
  assert.ok(st.items[0].id <= "itlong150" && st.items.length > 3);
  const short = C.devState(snapData(), liveRun(), {}, "moderator", 0);
  assert.equal(short.cut, undefined);
});

test("devAdopt: what a device receives is checked field by field and draws like the PC", () => {
  const st = C.devState(snapData(), liveRun(), { msg: { text: "Hi", on: true } }, "display", at(9, 1));
  const a = C.devAdopt(JSON.parse(json(st)));
  assert.equal(a.role, "display");
  assert.equal(a.data.events.length, 1);
  assert.deepEqual(a.data.items.map((x) => x.id), ["itaaaa1", "itaaaa2"]);
  const host = C.timer(C.rundown(snapData(), "evaaaa1")[0], snapData().events[0], liveRun(), at(9, 3));
  const dev = C.timer(a.data.items[0], a.data.events[0], a.run, at(9, 3));
  assert.deepEqual(dev, host, "same clock from the same instant");
  assert.equal(a.show.msg.text, "Hi");
  // junk and forgeries
  assert.equal(C.devAdopt(null), null);
  assert.equal(C.devAdopt({ t: "st", v: 2, role: "display" }), null);
  assert.equal(C.devAdopt({ t: "st", v: 1, role: "root" }), null);
  const bad = C.devAdopt({
    t: "st", v: 1, role: "remote", ev: { id: "evaaaa1", name: "<img src=x onerror=alert(1)>\n" + "z".repeat(500) },
    items: [it("itaaaa1", 1, { notes: "smuggled" }), it("itbbbb1", 2, { ev: "evzzzz9" }), { id: "../x", ev: "evaaaa1" }],
    run: { cur: "itaaaa1", startedAt: "soon", adj: 1e12 }, show: { layout: "evil", msg: { text: 5 } }, msgs: ["ok", 7, "", "x".repeat(400)]
  });
  assert.equal(bad.data.events[0].name.length, 120, "capped, kept as text");
  assert.ok(!bad.data.events[0].name.includes("\n"));
  assert.deepEqual(bad.data.items.map((x) => x.id), ["itaaaa1"], "other events and bad ids dropped");
  assert.equal(bad.data.items[0].notes, "");
  assert.equal(bad.run.startedAt, 0);
  assert.equal(bad.run.adj, 24 * 3600);
  assert.equal(bad.show.layout, "full");
  assert.deepEqual(bad.msgs.map((m) => m.length), [2, 200]);
});

test("devCommand: each role may only do its own things", () => {
  const ok = (role, c) => C.devCommand(role, c);
  assert.deepEqual(ok("remote", { t: "a", a: "go" }), { t: "a", a: "go" });
  assert.deepEqual(ok("remote", { t: "add", s: -300 }), { t: "add", s: -300 });
  assert.equal(ok("remote", { t: "add", s: 3600 }), null, "only ±1 and ±5 minutes");
  assert.equal(ok("remote", { t: "a", a: "jump" }), null);
  assert.deepEqual(ok("remote", { t: "black", on: true }), { t: "black", on: true });
  assert.equal(ok("remote", { t: "black", on: "yes" }), null);
  assert.deepEqual(ok("remote", { t: "msg", text: "  Wrap\nup ", color: "pink", flash: 1 }), { t: "msg", text: "Wrap up", color: "white", flash: false });
  assert.equal(ok("remote", { t: "msg", text: "   " }), null);
  assert.deepEqual(ok("remote", { t: "msgoff" }), { t: "msgoff" });
  // the moderator asks, nothing else; the display only listens
  ["moderator", "display"].forEach((r) => {
    [{ t: "a", a: "go" }, { t: "add", s: 60 }, { t: "black", on: true }, { t: "msg", text: "x" }, { t: "msgoff" }].forEach((c) => assert.equal(ok(r, c), null, r + " " + c.t));
  });
  assert.deepEqual(ok("moderator", { t: "ask", text: "1 more minute please", id: "abc12345" }), { t: "ask", text: "1 more minute please", id: "abc12345" });
  assert.equal(ok("moderator", { t: "ask", text: "x", id: "<b>" }).id, "");
  assert.equal(ok("remote", { t: "ask", text: "x" }), null);
  assert.equal(ok("display", { t: "ask", text: "x" }), null);
  ["remote", "display", "moderator"].forEach((r) => {
    assert.deepEqual(ok(r, { t: "hi" }), { t: "hi" });
    assert.deepEqual(ok(r, { t: "leave" }), { t: "leave" });
    assert.deepEqual(ok(r, { t: "tk", c: 5 }), { t: "tk", c: 5 });
    assert.equal(ok(r, { t: "tk", c: "5" }), null);
  });
  [null, 5, "go", {}, { t: 1 }, { t: "__proto__" }].forEach((c) => assert.equal(ok("remote", c), null));
});

test("clockOffset: the shortest round trip wins; junk is ignored", () => {
  assert.equal(C.clockOffset([]), 0);
  assert.equal(C.clockOffset([{ c: 1000, h: 5050, r: 1100 }]), 4000);
  assert.equal(C.clockOffset([{ c: 1000, h: 9000, r: 3000 }, { c: 4000, h: 8010, r: 4020 }, { c: 0, h: 0, r: -5 }, { c: NaN, h: 1, r: 2 }]), 4000);
});

test("page: paired devices wired after stage.js, strings in both languages, nothing written to the PC's data", () => {
  const html = read("time/index.html");
  const iStage = html.indexOf('src="stage.js?'), iQr = html.indexOf('src="../qr/qr-encode.js?'), iL = html.indexOf('src="../remote-link.js?'), iSl = html.indexOf('src="stage-link.js?');
  assert.ok(iStage > 0 && iQr > iStage && iL > iQr && iSl > iL, "stage.js, qr, remote-link, stage-link");
  ["stg-join", "sl-add", "sl-list", "sl-asks", "sl-pair-dlg", "sl-qr", "sl-code", "sl-allow", "sl-deny", "sl-join-dlg", "sl-join-code", "sl-dev", "sd-root", "sd-ctl", "sd-askp", "sd-go", "sd-leave"]
    .forEach((id) => assert.ok(html.includes('id="' + id + '"'), id));
  const src = read("time/stage-link.js");
  const block = (lang) => {
    const i = src.indexOf("    " + lang + ": {"), j = src.indexOf("\n    }", i);
    return new Set([...src.slice(i, j).matchAll(/"(sl\.[a-z0-9.]+)":/g)].map((m) => m[1]));
  };
  const en = block("en"), el = block("el");
  assert.ok(en.size > 60);
  assert.deepEqual([...en].sort(), [...el].sort(), "same keys in both languages");
  [...html.matchAll(/data-i18n-l(?:-ph|-a)?="([^"]+)"/g)].map((m) => m[1]).concat([...src.matchAll(/t\("(sl\.[a-z0-9.]+)"/g)].map((m) => m[1]).filter((k) => !k.endsWith(".")))
    .forEach((k) => assert.ok(en.has(k), "missing string " + k));
  assert.doesNotMatch(src, /innerHTML|\beval\(|new Function|insertAdjacentHTML/);
  assert.doesNotMatch(src, /markDirty|registerSlice|"oros-time-stage"\s*,/, "devices never touch the synced data");
  assert.match(src, /var c = C\.devCommand\(d\.role, m\);\s*if \(!c\) return;/, "every command is checked first");
  assert.match(src, /var a = C\.devAdopt\(m\);\s*if \(!a\) return;/, "every snapshot is checked first");
  assert.match(src, /ns: NS/);
  assert.match(read("time/stage.js"), /window\.OrosStage = \{/);
  assert.match(read("time/help.en.txt"), /another device/i);
  assert.match(read("time/help.el.txt"), /άλλη συσκευή/i);
});
