// "Report a problem" (Settings › System): the error journal in i18n.js
// (window.orosDiag, device-local "oros-diag-log") and the report file
// built by settings/report.js. The file must hold no user data.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const R = require(path.join(ROOT, "settings", "report.js"));
const I18N = fs.readFileSync(path.join(ROOT, "i18n.js"), "utf8");
const DIAG = fs.readFileSync(path.join(ROOT, "diag.js"), "utf8");

// i18n.js in a fake page; frames share the top window's journal.
function page(opts) {
  opts = opts || {};
  const store = opts.store || {};
  const listeners = {};
  const timers = [];
  const win = {
    addEventListener: (k, fn) => { (listeners[k] = listeners[k] || []).push(fn); },
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; }
    },
    location: { search: "", href: "https://useoros.online/" },
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    navigator: { language: "en" }
  };
  win.window = win;
  win.top = opts.top || win;
  win.parent = win.top;
  win.document = {
    currentScript: { src: "https://useoros.online/i18n.js?v=1", getAttribute: (k) => (k === "data-app" ? (opts.app || "shell") : null) },
    readyState: "complete", write: () => {}
  };
  const ctx = vm.createContext(Object.assign(win, { JSON, Date, Array, String, Object }));
  vm.runInContext(I18N, ctx);
  const fire = (k, ev) => (listeners[k] || []).forEach((fn) => fn(ev));
  if (opts.early) opts.early(win, fire);
  if (win.top === win) vm.runInContext(DIAG, ctx);
  return {
    win, store,
    fire,
    flush: () => { while (timers.length) timers.shift()(); }
  };
}

test("journal: errors are kept, cleaned and counted", () => {
  const p = page();
  const D = p.win.orosDiag;
  assert.ok(D, "the top window has orosDiag");
  p.fire("error", { message: "TypeError: x is undefined at https://useoros.online/notes/notes.js?v=4.66.00#top", filename: "https://useoros.online/notes/notes.js?v=4.66.00", lineno: 12, colno: 3 });
  p.fire("error", { message: "TypeError: x is undefined at https://useoros.online/notes/notes.js?v=4.66.00#top", filename: "https://useoros.online/notes/notes.js?v=4.66.00", lineno: 12, colno: 3 });
  p.fire("error", { message: "" });   // a failed image: not a script error
  p.fire("unhandledrejection", { reason: { name: "QuotaExceededError", message: "full" } });
  const l = D.list();
  assert.equal(l.length, 2);
  assert.equal(l[0].msg, "TypeError: x is undefined at /notes/notes.js");
  assert.equal(l[0].at, "/notes/notes.js:12:3");
  assert.equal(l[0].n, 2);
  assert.equal(l[1].kind, "promise");
  assert.equal(l[1].msg, "QuotaExceededError: full");
  p.flush();
  assert.equal(JSON.parse(p.store["oros-diag-log"]).length, 2, "stored device-local");
  D.clear();
  assert.equal(D.list().length, 0);
  assert.equal(p.store["oros-diag-log"], undefined);
});

test("journal: an app frame hands its errors to the top window", () => {
  const top = page();
  const frame = page({ top: top.win, app: "calendar" });
  assert.equal(frame.win.orosDiag, undefined, "frames keep no journal of their own");
  frame.fire("error", { message: "boom", filename: "https://useoros.online/calendar/calendar.js", lineno: 5, colno: 1 });
  const l = top.win.orosDiag.list();
  assert.equal(l.length, 1);
  assert.equal(l[0].app, "calendar");
});

test("journal: errors before diag.js runs are kept", () => {
  const p = page({ early: (w, fire) => fire("error", { message: "too early", filename: "https://useoros.online/shell.js?v=1", lineno: 9, colno: 1 }) });
  const l = p.win.orosDiag.list();
  assert.equal(l.length, 1);
  assert.equal(l[0].msg, "too early");
  assert.equal(l[0].at, "/shell.js:9:1");
  assert.equal(p.win.__orosDiagQ, null);
});

test("journal: bounded size and message length", () => {
  const p = page();
  for (let i = 0; i < 100; i++) p.fire("error", { message: "e" + i + " " + "x".repeat(1000) });
  const l = p.win.orosDiag.list();
  assert.equal(l.length, 60);
  assert.ok(l.every((e) => e.msg.length <= 240));
  assert.ok(l[59].msg.startsWith("e99 "));
});

test("report: sections, values and no user data", () => {
  const text = R.build({
    now: new Date("2026-10-31T12:00:00Z"),
    version: "4.67.00", sw: "activated", caches: ["oros-v4.67.00"], origin: "https://useoros.online",
    runsIn: "web browser", lang: "el", theme: "dark", apps: 120, multitask: "off", pcfiles: "not offered",
    ua: "Mozilla/5.0", platform: "Windows", mobile: false, screen: "1920×1080 @1x", viewport: "1280×800",
    usage: 10485760, quota: 104857600, persisted: true, lsKeys: 300, lsBytes: 2097152,
    sync: { provider: "webdav", connected: true, unlocked: true, dirty: false, interval: 5,
      msg: { kind: "err", text: "Sign-in for chris@example.com expired" } },
    backup: { folder: true, lapsed: false, autoexport: true },
    errors: [{ t: "2026-10-31T11:59:00Z", app: "notes", kind: "error", n: 3, msg: "boom from a@b.gr", at: "/notes/notes.js:1:2" }]
  });
  for (const h of ["===== orOS", "===== browser and device", "===== storage", "===== sync and backup", "===== errors (1, newest last)"]) {
    assert.ok(text.includes(h), h);
  }
  assert.ok(text.includes("version: 4.67.00"));
  assert.ok(text.includes("sync: webdav"));
  assert.ok(text.includes("every: 5 min"));
  assert.ok(text.includes("used / available: 10.0 MB / 100.0 MB"));
  assert.ok(text.includes("notes error x3: boom from [address]  @ /notes/notes.js:1:2"));
  assert.ok(!/@example\.com|a@b\.gr/.test(text), "no e-mail addresses");
  assert.ok(text.includes("[address] expired"));
  assert.equal(R.fileName(new Date(2026, 9, 31, 9, 5, 7)), "orOS-report-20261031-090507.txt");
});

test("report: an empty context still makes a file", () => {
  const text = R.build({});
  assert.ok(text.includes("sync: off"));
  assert.ok(text.includes("(none)"));
});

test("report: gather reads the backup folder as yes/no and never the account", async () => {
  const P = {
    location: { origin: "https://useoros.online", host: "useoros.online" },
    document: { documentElement: { getAttribute: () => null } },
    navigator: { userAgent: "UA", languages: ["el-GR"], onLine: true },
    screen: { width: 360, height: 800 }, innerWidth: 360, innerHeight: 700, devicePixelRatio: 3,
    localStorage: { length: 0, key: () => null, getItem: () => null },
    orosDiag: { list: () => [] }
  };
  const ctx = await R.gather(P, {
    version: "4.67.00", lang: "el",
    sync: { provider: "dropbox", connected: true, unlocked: true, email: "chris@example.com", interval: 3 },
    backup: { folder: "Private orOS backups", lapsed: false, autoexport: false }
  });
  const text = R.build(ctx);
  assert.ok(!text.includes("chris@example.com"));
  assert.ok(!text.includes("Private orOS backups"));
  assert.ok(text.includes("backup folder: chosen"));
  assert.ok(text.includes("screen: 360×800 @3x"));
  assert.ok(text.includes("runs in: web browser"));
});

test("settings: the report card talks to the System extension only through string events", () => {
  const APP = fs.readFileSync(path.join(ROOT, "settings", "settings.js"), "utf8");
  assert.ok(APP.includes('new p.CustomEvent("oros-report", { detail: JSON.stringify('));
  assert.ok(APP.includes('"oros-report-done"'));
  const html = fs.readFileSync(path.join(ROOT, "settings", "index.html"), "utf8");
  assert.ok(html.indexOf("report.js") > html.indexOf("core.js") && html.indexOf("report.js") < html.indexOf("settings.js?"));
});
