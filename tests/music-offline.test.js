// Music: saving songs for offline (MU-DL, music/core.js dlLine, run by
// music/host.js in the shell). One song at a time; a failed download is
// tried once more; offline it waits for the network; the waiting list is
// saved so a reload picks it up; Stop drops the songs still waiting.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const C = require(path.join(__dirname, "..", "music/core.js")).OrosMusicCore;
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

const ref = (n, extra) => Object.assign({ k: "ia:song00" + n, t: "Song " + n, a: "A", s: "ia", u: "https://archive.org/download/x/" + n + ".mp3", off: 1 }, extra || {});
const tick = () => new Promise((r) => setImmediate(r));
async function settle() { for (let i = 0; i < 30; i++) await tick(); }

function rig(over) {
  const log = { got: [], put: [], saved: [], ev: [] };
  let online = true, onlineWaiters = [];
  const o = Object.assign({
    get: (u, onBytes) => { log.got.push(u); onBytes(5, 10); onBytes(10, 10); return Promise.resolve({ size: 10, type: "audio/mpeg" }); },
    put: (r, b) => { log.put.push(r.k); return Promise.resolve(); },
    save: (l) => log.saved.push(l.map((x) => x.k)),
    notify: (ev, st) => log.ev.push([ev, st]),
    wait: () => Promise.resolve(),
    online: () => online,
    whenOnline: () => new Promise((r) => onlineWaiters.push(r))
  }, over || {});
  const line = C.dlLine(o);
  return { line, log, goOnline() { online = true; onlineWaiters.splice(0).forEach((r) => r()); }, goOffline() { online = false; } };
}

test("canKeep: only off songs of a source a browser can read", () => {
  assert.equal(C.canKeep(ref(1)), true);
  assert.equal(C.canKeep(ref(1, { off: undefined })), false);
  assert.equal(C.canKeep({ k: "km:song001", s: "km", u: "https://incompetech.com/a.mp3", off: 1 }), false);   // no CORS
  assert.equal(C.canKeep({ k: "ia:song001", s: "ia", u: "http://archive.org/a.mp3", off: 1 }), false);
  assert.equal(C.canKeep(null), false);
});

test("songs are saved one at a time, in order, and the list empties", async () => {
  const { line, log } = rig();
  const r = line.add([ref(1), ref(2), ref(3)]);
  assert.deepEqual(r, { add: 3, have: 0, no: 0 });
  await settle();
  assert.deepEqual(log.put, ["ia:song001", "ia:song002", "ia:song003"]);
  const last = log.ev[log.ev.length - 1];
  assert.equal(last[0], "offDone");
  assert.equal(last[1].ok, 3); assert.equal(last[1].n, 3); assert.equal(last[1].busy, false);
  assert.deepEqual(log.saved[log.saved.length - 1], []);   // nothing left to pick up
  assert.ok(log.ev.some((e) => e[0] === "bytes" && e[1].got === 5 && e[1].size === 10));
  assert.equal(log.ev.filter((e) => e[0] === "offOne").length, 3);
});

test("songs already saved or waiting, and songs that cannot be kept, are not added", async () => {
  let release;
  const { line, log } = rig({ get: (u) => { log.got.push(u); return new Promise((r) => { release = () => r({ size: 4, type: "audio/ogg" }); }); } });
  line.add([ref(1), ref(2)], { "ia:song002": 1 });
  assert.deepEqual(line.add([ref(1), ref(3), { k: "jm:song001", s: "jm", u: "https://x/1" }]), { add: 1, have: 1, no: 1 });
  assert.deepEqual(line.status().keys, ["ia:song001", "ia:song003"]);
  assert.equal(line.status().n, 2);
  await settle(); release(); await settle(); release(); await settle();
  assert.deepEqual(log.put, ["ia:song001", "ia:song003"]);
});

test("the waiting list (current song first) is saved for after a reload", async () => {
  let release;
  const { line, log } = rig({ get: () => new Promise((r) => { release = () => r({ size: 4, type: "audio/mpeg" }); }) });
  line.add([ref(1), ref(2)]);
  await settle();
  assert.deepEqual(log.saved[log.saved.length - 1], ["ia:song001", "ia:song002"]);
  const stored = JSON.parse(JSON.stringify(log.saved));
  assert.ok(stored.length);
  release(); await settle();
  assert.deepEqual(log.saved[log.saved.length - 1], ["ia:song002"]);
});

test("a failed download is tried once more, then counted as not saved", async () => {
  let n = 0;
  const { line, log } = rig({ get: (u) => { n++; return u.endsWith("/1.mp3") ? Promise.reject(new Error("cors")) : Promise.resolve({ size: 3, type: "audio/mpeg" }); } });
  line.add([ref(1), ref(2)]);
  await settle();
  assert.equal(n, 3);   // 1 twice, 2 once
  assert.deepEqual(log.put, ["ia:song002"]);
  const last = log.ev[log.ev.length - 1][1];
  assert.equal(last.ok, 1); assert.equal(last.bad, 1);
});

test("a text answer (an error page) or an empty file is never kept", async () => {
  const { line, log } = rig({ get: (u) => Promise.resolve(u.endsWith("/1.mp3") ? { size: 50, type: "text/html" } : { size: 0, type: "" }) });
  line.add([ref(1), ref(2)]);
  await settle();
  assert.deepEqual(log.put, []);
  assert.equal(log.ev[log.ev.length - 1][1].bad, 2);
});

test("offline: it waits for the network, then goes on", async () => {
  const R = rig();
  R.goOffline();
  R.line.add([ref(1)]);
  await settle();
  assert.equal(R.line.status().wait, true);
  assert.deepEqual(R.log.got, []);
  R.goOnline();
  await settle();
  assert.deepEqual(R.log.put, ["ia:song001"]);
  assert.equal(R.line.status().busy, false);
});

test("Stop drops the songs still waiting; the one coming in ends", async () => {
  let release;
  const { line, log } = rig({ get: () => new Promise((r) => { release = () => r({ size: 4, type: "audio/mpeg" }); }) });
  line.add([ref(1), ref(2), ref(3)]);
  await settle();
  assert.equal(line.cancel(), 2);
  assert.equal(line.status().n, 1);
  release(); await settle();
  assert.deepEqual(log.put, ["ia:song001"]);
  assert.equal(line.status().busy, false);
  assert.equal(line.cancel(), 0);
});

test("host.js runs the line in the shell and the app only asks it", () => {
  const h = read("music/host.js"), m = read("music/music.js");
  assert.match(h, /C\.dlLine\(/);
  assert.match(h, /offSave: offSave/);
  assert.match(h, /"oros-music-dlq"/);
  assert.match(h, /C\.DL\.STALL/);
  assert.match(m, /H\.offSave\(todo\)/);
  assert.match(m, /function paintDl\(/);
  // Kevin MacLeod: never offered for offline.
  assert.doesNotMatch(read("music/open.js"), /KM_PAGE, li: "by 4\.0", off: 1/);
});

test("every new string is in English, Greek and German", () => {
  const m = read("music/music.js"), h = read("music/host.js"), de = read("i18n/de/music.js");
  for (const k of ["dl.line", "dl.wait", "dl.stop", "toast.offQueued", "toast.offStop"]) {
    assert.equal((m.match(new RegExp('"' + k.replace(".", "\\.") + '":', "g")) || []).length, 2, k);
    assert.match(de, new RegExp('"' + k.replace(".", "\\.") + '":'), k);
  }
  for (const k of ["host.offDone", "host.offBad"]) {
    assert.equal((h.match(new RegExp('"' + k.replace(".", "\\.") + '":', "g")) || []).length, 2, k);
    assert.match(de, new RegExp('"' + k.replace(".", "\\.") + '":'), k);
  }
});
