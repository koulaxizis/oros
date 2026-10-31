// ============================================================
// orOS Settings — "Report a problem" (settings/report.js)
// One plain-text file that helps whoever looks into a problem:
// versions, the browser and device, how orOS is set up here (sync
// provider and state, backup folder yes/no, multitasking…) and the
// error journal that i18n.js keeps (window.orosDiag, device-local
// "oros-diag-log"). No user data: no notes, files, names, e-mail
// addresses, passphrases or keys; the person sees the whole text
// before it is saved, and nothing is ever sent anywhere by orOS.
// gather() reads the page (async), build() is pure (node tests).
// ============================================================
(function (root) {
  "use strict";

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function stamp(d) {
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "-" +
      pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
  }
  function fileName(d) { return "orOS-report-" + stamp(d) + ".txt"; }

  function yn(v) { return v ? "yes" : "no"; }
  function mb(n) { return (typeof n === "number" && isFinite(n)) ? (n / 1048576).toFixed(1) + " MB" : "?"; }
  // Belt and braces: an e-mail address that slipped into a message
  // (a sync notice, an error text) never reaches the file.
  function scrub(v) { return String(v).replace(/[^\s@<>()"']+@[^\s@<>()"']+\.[A-Za-z]{2,}/g, "[address]"); }
  function line(k, v) { return k + ": " + (v === undefined || v === null || v === "" ? "?" : scrub(v)) + "\n"; }

  // ctx is what gather() found; every field may be missing.
  function build(ctx) {
    ctx = ctx || {};
    var d = ctx.now instanceof Date ? ctx.now : new Date();
    var o = "orOS problem report " + d.toISOString() + "\n";
    o += "No notes, files, names, addresses, passwords or keys are in this file.\n";

    o += "\n===== orOS\n";
    o += line("version", ctx.version);
    o += line("service worker", ctx.sw);
    o += line("caches", (ctx.caches || []).join(", ") || "none");
    o += line("address", ctx.origin);
    o += line("runs in", ctx.runsIn);
    o += line("language", ctx.lang);
    o += line("theme", ctx.theme);
    o += line("apps", ctx.apps);
    o += line("multitasking", ctx.multitask);
    o += line("this computer's files", ctx.pcfiles);

    o += "\n===== browser and device\n";
    o += line("user agent", ctx.ua);
    o += line("brands", ctx.brands);
    o += line("platform", ctx.platform);
    o += line("mobile", ctx.mobile === undefined ? "?" : yn(ctx.mobile));
    o += line("languages", ctx.languages);
    o += line("screen", ctx.screen);
    o += line("window", ctx.viewport);
    o += line("touch points", ctx.touch);
    o += line("cpu threads", ctx.cpus);
    o += line("memory", ctx.memory ? ctx.memory + " GB" : "?");
    o += line("online", ctx.online === undefined ? "?" : yn(ctx.online));
    o += line("installed app window", ctx.standalone === undefined ? "?" : yn(ctx.standalone));
    o += line("time zone", ctx.tz);

    o += "\n===== storage\n";
    o += line("used / available", mb(ctx.usage) + " / " + mb(ctx.quota));
    o += line("kept by the browser", ctx.persisted === undefined ? "?" : yn(ctx.persisted));
    o += line("local storage", ctx.lsKeys === undefined ? "?" : ctx.lsKeys + " keys, " + mb(ctx.lsBytes));

    var s = ctx.sync || {};
    o += "\n===== sync and backup\n";
    o += line("sync", s.connected ? (s.provider || "?") : "off");
    if (s.connected) {
      o += line("unlocked", yn(s.unlocked));
      o += line("changes waiting", yn(s.dirty));
      o += line("every", s.interval === 0 ? "manual" : (s.interval + " min"));
    }
    if (s.msg) o += line("last message", "[" + s.msg.kind + "] " + s.msg.text);
    var b = ctx.backup || {};
    o += line("backup folder", b.folder ? (b.lapsed ? "chosen, permission lapsed" : "chosen") : "none");
    o += line("automatic export", yn(b.autoexport));

    var errs = ctx.errors || [];
    o += "\n===== errors (" + errs.length + ", newest last)\n";
    if (!errs.length) o += "(none)\n";
    errs.forEach(function (e) {
      o += (e.t || "?") + " " + (e.app || "?") + " " + (e.kind || "error") +
        (e.n > 1 ? " x" + e.n : "") + ": " + scrub(e.msg || "") + (e.at ? "  @ " + scrub(e.at) : "") + "\n";
    });
    return o;
  }

  // Reads everything from the shell window P (the parent of Settings).
  function gather(P, snap) {
    P = P || window;
    snap = snap || {};
    var N = P.navigator || {};
    var ctx = { now: new Date(), version: snap.version };
    function safe(fn) { try { fn(); } catch (e) {} }

    safe(function () {
      ctx.origin = P.location.origin;
      var de = P.document.documentElement;
      var sys = de.getAttribute("data-oros-report") === "1";
      if (P.location.host === "localhost:47800") {
        ctx.runsIn = (de.getAttribute("data-oros-kiosk") === "usb" ? "orOS USB" : "orOS Portable or orOS app") +
          (sys ? ", System extension on" : ", no System extension");
      } else ctx.runsIn = "web browser";
    });
    ctx.lang = snap.lang;
    ctx.theme = snap.theme;
    ctx.apps = snap.apps ? snap.apps.length : undefined;
    ctx.multitask = snap.multitask ? (snap.multitask.on ? "on" : "off") : "not offered";
    ctx.pcfiles = snap.pcfiles ? (snap.pcfiles.on ? "on" : "off") : "not offered";
    ctx.sync = snap.sync ? {
      provider: snap.sync.provider, connected: snap.sync.connected, unlocked: snap.sync.unlocked,
      dirty: snap.sync.dirty, interval: snap.sync.interval, msg: snap.sync.msg
    } : null;
    ctx.backup = snap.backup ? {
      folder: !!snap.backup.folder, lapsed: snap.backup.lapsed, autoexport: snap.backup.autoexport
    } : null;

    safe(function () { ctx.ua = N.userAgent; });
    safe(function () {
      var u = N.userAgentData;
      if (u) {
        ctx.brands = (u.brands || []).map(function (x) { return x.brand + " " + x.version; }).join(", ");
        ctx.mobile = !!u.mobile;
        ctx.platform = u.platform || N.platform;
      } else ctx.platform = N.platform;
    });
    safe(function () { ctx.languages = (N.languages || [N.language]).join(", "); });
    safe(function () {
      var sc = P.screen;
      ctx.screen = sc.width + "×" + sc.height + " @" + (P.devicePixelRatio || 1) + "x" +
        (sc.orientation && sc.orientation.type ? ", " + sc.orientation.type : "");
      ctx.viewport = P.innerWidth + "×" + P.innerHeight;
    });
    safe(function () { ctx.touch = N.maxTouchPoints; });
    safe(function () { ctx.cpus = N.hardwareConcurrency; });
    safe(function () { ctx.memory = N.deviceMemory; });
    safe(function () { ctx.online = N.onLine; });
    safe(function () {
      ctx.standalone = !!(P.matchMedia && (P.matchMedia("(display-mode: standalone)").matches ||
        P.matchMedia("(display-mode: window-controls-overlay)").matches));
    });
    safe(function () { ctx.tz = Intl.DateTimeFormat().resolvedOptions().timeZone; });
    safe(function () {
      var ls = P.localStorage, n = 0, bytes = 0;
      for (var i = 0; i < ls.length; i++) {
        var k = ls.key(i);
        n++;
        bytes += (k.length + (ls.getItem(k) || "").length) * 2;
      }
      ctx.lsKeys = n;
      ctx.lsBytes = bytes;
    });
    safe(function () { ctx.errors = P.orosDiag ? P.orosDiag.list() : []; });
    safe(function () {
      var c = N.serviceWorker && N.serviceWorker.controller;
      ctx.sw = c ? (c.state || "active") : "none";
    });

    var waits = [];
    safe(function () {
      if (N.storage && N.storage.estimate) {
        waits.push(N.storage.estimate().then(function (e) { ctx.usage = e.usage; ctx.quota = e.quota; }, function () {}));
      }
      if (N.storage && N.storage.persisted) {
        waits.push(N.storage.persisted().then(function (v) { ctx.persisted = v; }, function () {}));
      }
    });
    safe(function () {
      if (P.caches && P.caches.keys) {
        waits.push(P.caches.keys().then(function (k) { ctx.caches = k.slice().sort(); }, function () {}));
      }
    });
    return Promise.all(waits).then(function () { return ctx; });
  }

  var api = { build: build, scrub: scrub, gather: gather, fileName: fileName };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SettingsReport = api;
})(typeof window !== "undefined" ? window : this);
