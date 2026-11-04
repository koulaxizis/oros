"use strict";
// SY-SW — a second window never erases an app's work (2026-11-04).
// Two windows of one app on one device each kept their data in memory
// and wrote it whole on save; the older window's save wrote over what
// the other had just saved. sync.js now wraps the app frame's
// localStorage.setItem for the slice's key: when storage changed since
// the frame's last write, the write stores merge(write, stored) and the
// app takes the merged data through its setter.
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("vm");
const fs = require("fs");
const path = require("path");
const http = require("http");
const { FakeDropbox, createDevice, lwwRecordMerge } = require("./harness");

// An app frame: its own realm (Function, Storage) over the device's storage.
function frameFor(dev) {
  const map = dev.localStorage;
  const fctx = vm.createContext({ console });
  vm.runInContext(`
    function Storage() {}
    Storage.prototype.getItem = function (k) { return __map.getItem(k); };
    Storage.prototype.setItem = function (k, v) { __map.setItem(k, v); };
    Storage.prototype.removeItem = function (k) { __map.removeItem(k); };
    var localStorage = new Storage();
    this.Storage = Storage; this.localStorage = localStorage;`, Object.assign(fctx, { __map: map }));
  fctx.window = fctx;
  fctx.Function = vm.runInContext("Function", fctx);     // a browser window has it as a property
  const doc = { defaultView: fctx };
  dev.ctx.__orosAppDocs = () => [doc];
  return fctx;
}
// The app in the frame: data in memory, written whole on save.
function app(dev, fctx, key, merge) {
  fctx.__key = key;
  const a = vm.runInContext(`(function () {
    var mem = JSON.parse(localStorage.getItem(__key) || '{"items":{}}');
    return {
      mem: function () { return mem; },
      add: function (id, v, t) { mem.items[id] = { v: v, t: t }; localStorage.setItem(__key, JSON.stringify(mem)); },
      get: function () { return JSON.parse(localStorage.getItem(__key) || "null"); },
      set: function (d) { mem = d; localStorage.setItem(__key, JSON.stringify(mem)); }
    };
  })()`, fctx);
  dev.sync.registerSlice("notes", a.get, a.set, key, merge);
  return a;
}
const flush = () => new Promise((r) => setImmediate(r));

test("SY-SW: the older window's save keeps what another window stored meanwhile", async () => {
  const dev = await createDevice(new FakeDropbox(), "A");
  dev.localStorage.setItem("app-notes", JSON.stringify({ items: { a: { v: "first", t: 1 } } }));
  const fctx = frameFor(dev);
  const A = app(dev, fctx, "app-notes", lwwRecordMerge);
  // Another window (not wrapped) saves a new note.
  dev.localStorage.setItem("app-notes", JSON.stringify({ items: { a: { v: "first", t: 1 }, b: { v: "other window", t: 2 } } }));
  A.add("c", "this window", 3);
  // The stored copy (the timers run in the harness' queue; run them)
  let d = JSON.parse(dev.localStorage.getItem("app-notes"));
  assert.deepEqual(Object.keys(d.items).sort(), ["a", "b", "c"]);
  for (const t of dev.timers.splice(0)) if (t.ms === 0) t.fn();
  await flush();
  assert.deepEqual(Object.keys(A.mem().items).sort(), ["a", "b", "c"], "the app's memory took the merge");
  // Plain saves afterwards are written as they are.
  A.add("d", "x", 4);
  d = JSON.parse(dev.localStorage.getItem("app-notes"));
  assert.deepEqual(Object.keys(d.items).sort(), ["a", "b", "c", "d"]);
});

test("SY-SW: no other writer = the write is stored exactly; a merge that throws stores the write", async () => {
  const dev = await createDevice(new FakeDropbox(), "B");
  const fctx = frameFor(dev);
  let calls = 0;
  const A = app(dev, fctx, "app-notes", (l, r) => { calls++; throw new Error("bad merge"); });
  A.add("a", "one", 1);
  assert.equal(dev.localStorage.getItem("app-notes"), JSON.stringify({ items: { a: { v: "one", t: 1 } } }));
  assert.equal(calls, 0, "nothing changed underneath: no merge");
  dev.localStorage.setItem("app-notes", JSON.stringify({ items: { z: { v: "other", t: 9 } } }));
  A.add("b", "two", 2);
  assert.equal(calls, 1);
  assert.deepEqual(Object.keys(JSON.parse(dev.localStorage.getItem("app-notes")).items).sort(), ["a", "b"], "old behaviour kept");
  // Other keys of the frame are never touched.
  fctx.localStorage.setItem("app-prefs", "x");
  assert.equal(dev.localStorage.getItem("app-prefs"), "x");
});

test("SY-SW: shell-realm slices and mergeless slices are not wrapped", async () => {
  const dev = await createDevice(new FakeDropbox(), "C");
  const fctx = frameFor(dev);
  const before = fctx.Storage.prototype.setItem;
  const own = vm.runInContext("(function () { return null; })", dev.ctx);              // shell realm
  dev.sync.registerSlice("shellish", own, () => {}, "app-x", lwwRecordMerge);
  dev.sync.registerSlice("stranger", () => null, () => {}, "app-z", lwwRecordMerge);  // a realm that is no frame
  assert.equal(fctx.Storage.prototype.setItem, before);
  const g = vm.runInContext("(function () { return null; })", fctx);
  dev.sync.registerSlice("mergeless", g, () => {}, "app-y");
  assert.equal(fctx.Storage.prototype.setItem, before);
});

// ---------- The real shell and app in Chromium ----------
function chromium() {
  for (const mod of ["playwright", "/opt/node22/lib/node_modules/playwright"]) {
    try {
      const pw = require(mod);
      const exe = pw.chromium.executablePath();
      if (exe && fs.existsSync(exe)) return pw;
    } catch (e) {}
  }
  return null;
}
const PW = chromium();
const ROOT = path.join(__dirname, "..");
const MIME = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json",
  ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".txt": "text/plain", ".woff2": "font/woff2" };

test("SY-SW: Notes open in two orOS windows keeps both new pages", { skip: PW ? false : "Playwright / Chromium not installed", timeout: 120000 }, async () => {
  const srv = http.createServer((q, r) => {
    let p = decodeURIComponent(q.url.split("?")[0]);
    if (p.endsWith("/")) p += "index.html";
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
    r.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + srv.address().port + "/";
  const browser = await PW.chromium.launch({ args: ["--no-sandbox"] });
  try {
    const ctx = await browser.newContext({ serviceWorkers: "block" });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem("oros-tour-done", "1");
        localStorage.setItem("oros-lang", "en");
        sessionStorage.setItem("oros-skip-splash", "1");
      } catch (e) {}
      // The older window does not hear storage events (a frozen background tab).
      if (window.top.name === "deaf") addEventListener("storage", (e) => e.stopImmediatePropagation(), true);
    });
    const errors = [];
    async function shell(deaf) {
      const p = await ctx.newPage();
      p.on("pageerror", (e) => errors.push(e.message));
      await p.goto(base + "index.html");
      if (deaf) { await p.evaluate(() => { window.name = "deaf"; }); await p.reload(); }
      await p.waitForFunction(() => window.__orosOpenApp);
      await p.evaluate(() => window.__orosOpenApp("notes"));
      await p.waitForFunction(() => { const f = document.getElementById("app-frame"); return f && f.contentWindow.__orosSw; }, null, { timeout: 15000 });
      await p.waitForTimeout(800);
      return p;
    }
    const frame = (p) => p.frames().find((f) => /\/notes\//.test(f.url()));
    const ids = async (p) => (((await p.evaluate(() => localStorage.getItem("oros-notes-data"))) || "").match(/"id"/g) || []).length;
    const A = await shell(true);
    const start = await ids(A);
    const B = await shell(false);
    await frame(B).click("#btn-new-page");
    await B.waitForTimeout(500);
    assert.equal(await ids(A), start + 1, "B's page stored");
    await frame(A).click("#btn-new-page");
    await A.waitForTimeout(800);
    assert.equal(await ids(A), start + 2, "A's save kept B's page");
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    srv.close();
  }
});
