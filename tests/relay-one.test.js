// STRUCT-4 (structure review 2026-11-22): one relay address for all of
// orOS, shell window.orosRelay over the synced "oros-mail-data" relay.
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

function shellRelay(store) {
  const src = read("shell.js");
  const a = src.indexOf('  var MAIL_CACHE_KEY = "oros-mail-data";');
  const b = src.indexOf("  function registerMailProxySlice() {");
  assert.ok(a > 0 && b > a);
  const ls = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  };
  const win = { orosSync: { dirty: 0, markDirty() { this.dirty++; } } };
  const fn = new Function("window", "localStorage", src.slice(a, b) + "\nreturn { api: window.orosRelay, migrateGateRelay: migrateGateRelay };");
  const out = fn(win, ls);
  out.win = win;
  return out;
}

test("orosRelay: empty = the shared relay; set writes Mail's synced relay with a newer stamp", () => {
  const store = {};
  const { api, win } = shellRelay(store);
  assert.equal(api.own(), "");
  assert.equal(api.url(), api.SHARED);
  assert.equal(api.mine(), false);
  let told = 0;
  api.onChange(() => told++);
  assert.equal(api.set("https://my.relay.example.workers.dev/"), true);
  const d = JSON.parse(store["oros-mail-data"]);
  assert.deepEqual(d.accounts, [], "Mail's slice keeps its shape");
  assert.equal(d.relay.url, "https://my.relay.example.workers.dev");
  assert.ok(d.relay.m > 0);
  assert.equal(api.url(), "https://my.relay.example.workers.dev");
  assert.equal(api.mine(), true);
  assert.equal(win.orosSync.dirty, 1);
  assert.equal(told, 1);
  const m1 = d.relay.m;
  assert.equal(api.set("https://my.relay.example.workers.dev"), true, "same address: nothing to write");
  assert.equal(win.orosSync.dirty, 1);
  assert.equal(api.set(""), true);
  const d2 = JSON.parse(store["oros-mail-data"]);
  assert.equal(d2.relay.url, "");
  assert.ok(d2.relay.m > m1, "a newer stamp carries it to the other devices");
  assert.equal(api.set(api.SHARED), true, "the shared address counts as empty");
  assert.equal(api.own(), "");
});

test("orosRelay: refuses what Mail would refuse, keeps Mail's accounts", () => {
  const store = { "oros-mail-data": JSON.stringify({ accounts: [{ id: "a1" }], relay: { url: "", m: 5 } }) };
  const { api } = shellRelay(store);
  for (const bad of ["http://relay.example.com", "ftp://x", "https://a b", "javascript:alert(1)"]) {
    assert.equal(api.set(bad), false, bad);
  }
  assert.equal(api.set("http://localhost:8787"), true, "a local relay while developing");
  const d = JSON.parse(store["oros-mail-data"]);
  assert.deepEqual(d.accounts, [{ id: "a1" }]);
});

test("orosRelay: the Gate's own relay moves into the one address once and wins over Mail's", () => {
  const store = {
    "oros-mail-data": JSON.stringify({ accounts: [], relay: { url: "https://mail.relay.example", m: 9 } }),
    "oros-gate-relay": JSON.stringify("https://gate.relay.example")
  };
  const { api, migrateGateRelay } = shellRelay(store);
  migrateGateRelay();
  assert.equal(api.own(), "https://gate.relay.example");
  assert.ok(!("oros-gate-relay" in store));
  migrateGateRelay();   // nothing left to move
  assert.equal(api.own(), "https://gate.relay.example");
});

test("one field: Settings has the orOS relay card; Mail, Feeds and the Gate have no relay field of their own", () => {
  const ss = read("settings/settings.js");
  assert.match(ss, /function secRelay\(host\)/);
  assert.match(ss, /secAiCard\(host\);\n    secRelay\(host\);/);
  const gate = ss.slice(ss.indexOf("function gateInto"), ss.indexOf("function gateInto") + 4000);
  assert.ok(!/f-gt-relay/.test(gate), "no Gate relay input");
  assert.match(gate, /rl\.goto/);
  const mail = read("mail/mail.js");
  assert.ok(!/ml-relay2/.test(mail));
  assert.match(mail, /__orosOpenAt\("settings", \{ section: "services", item: "relay" \}\)/);
  const feeds = read("feeds/feeds.js");
  assert.ok(!/id = "set-relay"/.test(feeds));
  assert.match(feeds, /function moveRelay\(\)/);
  const C = require("../settings/core.js");
  assert.ok(C.FIND.some((f) => f[0] === "relay" && f[1] === "services"));
  assert.equal(C.scopeOf("relay"), "all");
  const de = read("i18n/de/settings.js");
  for (const k of ["rl.title", "rl.field", "rl.hint", "rl.now.shared", "rl.now.own", "rl.save", "rl.saved", "rl.cleared", "rl.goto", "w.relay"]) {
    assert.ok(C.STRINGS.en[k] && C.STRINGS.el[k], k);
    assert.ok(de.includes('"' + k + '"'), "de " + k);
  }
});

test("sensitive work also marks your own relay", () => {
  const sh = read("shell.js");
  assert.match(sh, /rl\.push\(new URL\(own\)\.host\.toLowerCase\(\)\)/);
  assert.match(sh, /window\.orosRelay\.onChange\(strictTellSW\)/);
});

// STRUCT-5: no "Through the orOS relay" switches; one question per server.
function shellAsk(store, strict) {
  const src = read("shell.js");
  const a = src.indexOf('  var MAIL_CACHE_KEY = "oros-mail-data";');
  const b = src.indexOf("  function registerMailProxySlice() {");
  const ls = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  const win = { orosSync: { markDirty() {} }, t: (k) => k };
  const shown = [];
  const doc = { createElement: () => { throw new Error("no dialog expected"); }, body: { appendChild: (x) => shown.push(x) } };
  const fn = new Function("window", "localStorage", "document", "strictLevelNow",
    src.slice(a, b) + "\nreturn window.orosRelay;");
  return fn(win, ls, doc, () => strict);
}

test("relay question: Sensitive work answers no without asking; a kept yes answers yes", async () => {
  const store = { "oros-relay-ok": JSON.stringify({ "dav.example.com": 1 }) };
  const R = shellAsk(store, "on");
  assert.equal(await R.ask("https://dav.example.com/remote.php"), false, "Sensitive work: never");
  const R2 = shellAsk(store, null);
  assert.equal(await R2.ask("https://dav.example.com/remote.php"), true, "yes kept for that server");
  assert.equal(R2.allowed("https://DAV.example.com/x"), true);
  assert.equal(R2.allowed("https://other.example.com/"), false);
  assert.equal(await R2.ask("not a url"), false);
});

test("relay question: the switches are gone and each flow asks only when the browser was not let in", () => {
  const ss = read("settings/settings.js");
  for (const k of ['"dav-relay"', '"cd-relay"', 't("y.dav.relay")', 't("cd.relay")']) assert.ok(!ss.includes(k), k);
  assert.match(ss, /function cdNeedsRelay\(e\)/);
  assert.match(ss, /code === "unreachable" \|\| code === "etag"/);
  const sh = read("shell.js");
  assert.match(sh, /function davNeedsRelay\(err\)/);
  assert.match(sh, /m === "dav-unreachable" \|\| m === "dav-etag"/);
  assert.equal((sh.match(/window\.orosRelay\.ask\(form\.url\)/g) || []).length, 3, "connect, move, Nextcloud");
  assert.match(sh, /if \(strictLevelNow\(\)\) return Promise\.resolve\(false\);/);
  const hh = read("household/app.js"), hhtml = read("household/index.html");
  assert.ok(!/new-dav-relay/.test(hh + hhtml));
  assert.match(hh, /code === "dav-cors" && !dav\.relay && R/);
  const st = read("studio/podcastui.js"), sthtml = read("studio/index.html");
  assert.ok(!/pod-dav-relay/.test(st + sthtml));
  assert.match(st, /e\.code === "dav-cors" && !c\.relay && R/);
  for (const f of ["translations.js", "i18n/de/shell.js"]) {
    const s = read(f);
    for (const k of ["relay.ask.title", "relay.ask.text", "relay.ask.yes", "relay.ask.no", "sync.nc.again"]) assert.ok(s.includes('"' + k + '"'), f + " " + k);
  }
});
