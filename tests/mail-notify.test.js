// Mail new-mail notices (mail/notify.js): which Inbox headers count
// as new, and the notification deep link. The relay call, the sealed
// password and the shell timers run in a real browser (PR notes).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const N = require("../mail/notify.js");

const msg = (uid, seen) => ({ uid, flags: seen ? ["\\Seen"] : [], hdr: "" });

test("notify: the first check only takes the mark", () => {
  const r = N.freshMessages({ uidvalidity: 7, msgs: [msg(10), msg(12), msg(11)] }, null);
  assert.deepEqual(r.mark, { v: 7, m: 12 });
  assert.deepEqual(r.fresh, []);
});

test("notify: new = above the mark and unread, newest first", () => {
  const r = N.freshMessages({ uidvalidity: 7, msgs: [msg(14), msg(12), msg(13, true), msg(15)] }, { v: 7, m: 12 });
  assert.deepEqual(r.fresh.map((x) => x.uid), [15, 14]);
  assert.deepEqual(r.newer.map((x) => x.uid), [15, 14, 13]);   // rules see read ones too
  assert.deepEqual(r.mark, { v: 7, m: 15 });
  // nothing new: mark stays, never goes back
  const again = N.freshMessages({ uidvalidity: 7, msgs: [msg(15), msg(14)] }, r.mark);
  assert.deepEqual(again.fresh, []);
  assert.deepEqual(again.mark, { v: 7, m: 15 });
  const deleted = N.freshMessages({ uidvalidity: 7, msgs: [msg(9)] }, r.mark);
  assert.deepEqual(deleted.mark, { v: 7, m: 15 });
});

test("notify: a new UIDVALIDITY resets the mark silently; an empty Inbox is fine", () => {
  const r = N.freshMessages({ uidvalidity: 8, msgs: [msg(3)] }, { v: 7, m: 99 });
  assert.deepEqual(r, { mark: { v: 8, m: 3 }, fresh: [], newer: [] });
  assert.deepEqual(N.freshMessages({ uidvalidity: 8, msgs: [] }, { v: 8, m: 3 }), { mark: { v: 8, m: 3 }, fresh: [], newer: [] });
  assert.deepEqual(N.freshMessages({ uidvalidity: 8 }, null), { mark: { v: 8, m: 0 }, fresh: [], newer: [] });
});

test("notify: shell wiring (script tag, toggle, deep link bridge)", () => {
  const root = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const iN = html.indexOf('src="notifications.js'), iM = html.indexOf('src="mail/notify.js');
  assert.ok(iN > 0 && iM > iN, "mail/notify.js loads after notifications.js");
  const nsrc = fs.readFileSync(path.join(root, "notifications.js"), "utf8");
  assert.match(nsrc, /KNOWN_APPS = \[[^\]]*'mail'/);
  // run the bridge from the real source
  const start = nsrc.indexOf("    mail:     function (p) {");
  const end = nsrc.indexOf("\n    }", start) + 6;
  const calls = [];
  const window = { __orosOpenAt: (app, t) => calls.push([app, t]) };
  const bridge = new Function("window", "return {" + nsrc.slice(start, end) + "}.mail;")(window);
  bridge("abc123def.42");
  bridge("bad id.1");
  bridge("abc123def.x");
  assert.deepEqual(calls, [["mail", { acct: "abc123def", folder: "INBOX", uid: 42 }]]);
});
