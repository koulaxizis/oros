// UPD-SYS: "Check for updates" on orOS USB / Portable opens the System
// extension's System update; elsewhere it says when nothing is new.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

function checkFn() {
  const src = read("shell.js");
  const start = src.indexOf("function scCheckUpdates()");
  let depth = 0, i = src.indexOf("{", start);
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) break;
  }
  return src.slice(start, i + 1);
}

function run(attr, reg) {
  const events = [], msgs = [];
  const ctx = {
    document: { documentElement: { hasAttribute: (k) => attr && k === "data-oros-sys-update" }, dispatchEvent: (e) => events.push(e.type) },
    CustomEvent: function (type) { this.type = type; },
    navigator: { serviceWorker: { getRegistration: () => Promise.resolve(reg) } },
    window: { t: (k) => ({ "update.none": "orOS is up to date ({v}).", "update.checking": "Checking…" })[k] },
    setSyncMsgRaw: (kind, text) => msgs.push(kind + ":" + text),
    APP_VERSION: "9.9.9",
  };
  vm.runInNewContext(checkFn() + "\nscCheckUpdates();", ctx);
  return new Promise((r) => setTimeout(() => r({ events, msgs }), 10));
}

test("with the System extension's update: it opens there, no web check", async () => {
  let asked = false;
  const out = await run(true, { update: () => { asked = true; return Promise.resolve(); } });
  assert.deepEqual(out.events, ["oros-sys-update"]);
  assert.equal(asked, false);
  assert.deepEqual(out.msgs, []);
});

test("on the web: nothing new is said; a new version is left to its own notice", async () => {
  let out = await run(false, { update: () => Promise.resolve() });
  assert.deepEqual(out.msgs, ["dim:Checking…", "ok:orOS is up to date (9.9.9)."]);
  const reg = { update: () => { reg.installing = {}; return Promise.resolve(); } };
  out = await run(false, reg);
  assert.deepEqual(out.msgs, ["dim:Checking…"]);
});

test("the message exists in EN, EL and DE", () => {
  assert.match(read("translations.js"), /"update\.none":\s+"orOS is up to date \(\{v\}\)\."/);
  assert.match(read("translations.js"), /"update\.none":\s+"Το orOS είναι ενημερωμένο \(\{v\}\)\."/);
  assert.match(read("i18n/de/shell.js"), /"update\.none": ".*\{v\}/);
});
