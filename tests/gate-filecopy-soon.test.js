// GQ-FC (8.53.00): Claude's file copy is refreshed soon after an app's
// export: a later, longer wait does not push back a sooner one, and a
// copy asked for while one runs runs again right after it.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const src = fs.readFileSync(path.join(__dirname, "../gate/gate.js"), "utf8");
function grab(re) { const m = re.exec(src); assert.ok(m, "found " + re); return m[0]; }

function load() {
  const soon = grab(/var fcAt = 0, fcAgain = false;\n  function fileCopySoon\(ms\) \{[\s\S]*?\n  \}\n/);
  const later = grab(/function fcLater\(\) \{[^\n]*\}/);
  const timers = [];
  const box = {
    now: 1000, runs: 0, busy: false, fcTimer: null,
    setTimeout(fn, ms) { const t = { fn, at: box.now + ms, live: true }; timers.push(t); return t; },
    clearTimeout(t) { if (t) t.live = false; }
  };
  box.Date = { now: () => box.now };
  const code = "var fcTimer = null;\n" + soon + later + "\n" +
    "function fileCopy() { if (busy) { fcAgain = true; return false; } runs++; return true; }\n" +
    "this.api = { soon: fileCopySoon, later: fcLater, copy: fileCopy, again: function () { return fcAgain; } };";
  vm.createContext(box);
  vm.runInContext(code, box);
  box.tick = (to) => { box.now = to; timers.filter((t) => t.live && t.at <= to).forEach((t) => { t.live = false; t.fn(); }); };
  return box;
}

test("a sooner refresh is not pushed back by a later, longer one", () => {
  const b = load();
  b.api.soon(3000);       // an export
  b.api.soon(60000);      // the queue's end
  b.tick(1000 + 3000);
  assert.equal(b.runs, 1, "ran at 3 s");
  b.api.soon(60000);
  b.api.soon(3000);       // a sooner one replaces a later one
  b.tick(b.now + 3000);
  assert.equal(b.runs, 2);
});

test("asked while a copy runs: it runs again right after", () => {
  const b = load();
  b.busy = true;
  b.api.soon(0);
  b.tick(b.now);
  assert.equal(b.runs, 0);
  assert.equal(b.api.again(), true, "remembered");
  b.busy = false;
  b.api.later();          // the running copy ended
  b.tick(b.now + 2000);
  assert.equal(b.runs, 1, "ran again");
  assert.equal(b.api.again(), false);
});
