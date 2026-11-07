// ============================================================
// orOS Discover — weekly app suggestion, shell side (v1.0.0, CH-2)
// Runs in the SHELL window (index.html late bundle, after
// gamekit/daily.js and discover/core.js).
//   - keeps the synced slice "discover" (oros-discover-data, see
//     core.js for the shape and the merge)
//   - notes every app the first time it opens (shell.js openApp →
//     orosDiscover.seen), and once per device the apps that already
//     have data of their own here (they were opened before this
//     feature), so a person who has used orOS for months is not told
//     about Notes
//   - once a week from Monday 10:00 (or the first start after it that
//     week), ONE notice: ns "discover", key "week-<n>" (the synced
//     inbox shows it once on every device), deep link
//     system:open:<app>; the same suggestion is a card in Today
// Mute: the "Weekly app suggestion" notification switch (Settings ›
// Notifications, synced); muted = no notice and no card. "Not for
// me": that app is never suggested again (synced).
// Device-local: oros-discover-local { init: 1, last: <week> } (the
// first look at the apps' own data was done; the week the notice was
// decided). Runs on the shell's clock tick (orosDiscover.tick,
// throttled by the shell): no timer of its own.
// ============================================================
(function (root) {
  "use strict";
  var C = root.orosDiscoverCore, DK = root.orosDaily;
  if (!C || !DK) return;                        // stale bundle without the cores

  var KEY = "oros-discover-data";
  var LOCAL_KEY = "oros-discover-local";
  var NS = "discover";
  var NOTICE_HOUR = 10;
  var SYNC_WAIT_MS = 90000;
  var bootAt = Date.now();
  var syncDoneAt = 0;
  var lines = {};
  var sending = false;

  var NOTE = {
    en: {
      "n.title": "Suggestion of the week: {app}",
      "n.body": "An app you have not opened yet. Tap to try it.",
      "n.game": "A game you have not played yet. Tap to try it."
    },
    el: {
      "n.title": "Πρόταση της εβδομάδας: {app}",
      "n.body": "Μια εφαρμογή που δεν έχεις ανοίξει ακόμα. Πάτα για να τη δοκιμάσεις.",
      "n.game": "Ένα παιχνίδι που δεν έχεις παίξει ακόμα. Πάτα για να το δοκιμάσεις."
    }
  };
  var packAsked = {};
  function code() {
    var I = root.orosI18n;
    try { return I ? I.lang() : (root.orosLang === "el" ? "el" : "en"); } catch (e) { return "en"; }
  }
  function words() {
    var I = root.orosI18n, c = code();
    if (NOTE[c]) return NOTE[c];
    if (!I || (I.known && !I.known(c))) return NOTE.en;
    var tab = I.table(NOTE, "discover", c);
    if (!packAsked[c] && typeof I.ensure === "function") {
      packAsked[c] = true;
      try { I.ensure(c, "discover", function () { delete NOTE[c]; }); } catch (x) {}
    }
    return tab;
  }

  function S() { return root.orosSync || null; }
  function N() { return root.orosNotifs || null; }
  function env() { return root.orosTodayEnv || null; }

  // ---------- Slice ----------
  function read() {
    try { return C.norm(JSON.parse(localStorage.getItem(KEY))); }
    catch (e) { return C.norm(null); }
  }
  function write(d) {
    try { localStorage.setItem(KEY, JSON.stringify(C.norm(d))); return true; }
    catch (e) { return false; }
  }
  function save(d) {
    if (!d) return true;
    var next = C.norm(d);
    if (JSON.stringify(next) === JSON.stringify(read())) return true;
    if (!write(next)) return false;
    var s = S();
    if (s && typeof s.markDirty === "function") s.markDirty();
    return true;
  }
  function sliceGet() { return read(); }
  function sliceSet(d) {                        // R6: a pull never marks dirty
    if (!d || typeof d !== "object") return;
    var next = C.norm(d);
    if (JSON.stringify(next) === JSON.stringify(read())) return;
    write(next);
  }
  function registerSlice() {
    var s = S();
    if (!s || typeof s.registerSlice !== "function") { setTimeout(registerSlice, 100); return; }
    s.registerSlice("discover", sliceGet, sliceSet, null, C.merge);
    if (typeof s.onAutoSync === "function") {
      s.onAutoSync(function (kind) { if (kind === "done" || kind === "fail") syncDoneAt = Date.now(); });
    }
  }

  function readLocal() {
    try {
      var o = JSON.parse(localStorage.getItem(LOCAL_KEY));
      if (o && typeof o === "object") return { init: o.init === 1 ? 1 : 0, last: typeof o.last === "number" ? o.last : -1 };
    } catch (e) {}
    return { init: 0, last: -1 };
  }
  function writeLocal(o) {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify({ init: o.init, last: o.last })); } catch (e) {}
  }

  // ---------- Apps ----------
  function apps() {
    var e = env();
    try { return e ? e.apps() : []; } catch (x) { return []; }
  }
  function appById(id) {
    var list = apps();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function isGame(id) {
    var G = root.orosGameCore;
    return !!(G && G.GAMES.indexOf(id) >= 0) || id === "gamecenter";
  }

  // Once per device: the apps with keys of their own here count as
  // opened (today), before the first pick.
  function initOnce() {
    var loc = readLocal();
    if (loc.init) return true;
    var list = apps();
    if (!list.length) return false;              // apps.json not in yet
    var keys = [];
    try { for (var i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i)); } catch (e) { return false; }
    var day = DK.today(), found = [];
    list.forEach(function (a) {
      var pre = "oros-" + a.id + "-";
      for (var j = 0; j < keys.length; j++) {
        if (keys[j] && keys[j].indexOf(pre) === 0) { found.push({ id: a.id, day: day }); break; }
      }
    });
    save(C.addSeen(read(), found));
    loc.init = 1;
    writeLocal(loc);
    return true;
  }

  // shell.js openApp: the first open of an app on any device.
  function seen(id) {
    id = String(id || "");
    if (!/^[a-z0-9]{1,24}$/.test(id)) return;
    var d = read();
    if (typeof d.seen[id] === "number") return;  // already known: nothing to write
    save(C.addSeen(d, [{ id: id, day: DK.today() }]));
  }

  function muted() {
    var n = N();
    try { return !!(n && typeof n.getAppToggle === "function" && !n.getAppToggle(NS)); } catch (e) { return false; }
  }
  function installedIds() { return apps().map(function (a) { return a.id; }); }

  // The first sentence line of the app's own help page (R38), in the
  // orOS language: "" when it cannot be read. Cached per app and
  // language.
  function helpLine(id) {
    var c = code(), k = c + ":" + id;
    if (lines[k] !== undefined) return Promise.resolve(lines[k]);
    var url = c === "el" ? id + "/help.el.txt" : c === "en" ? id + "/help.en.txt" : "i18n/" + c + "/help/" + id + ".txt";
    function get(u) {
      return fetch(u).then(function (r) { return r.ok ? r.text() : ""; }).catch(function () { return ""; });
    }
    return get(url).then(function (txt) {
      return txt || (c === "el" || c === "en" ? "" : get(id + "/help.en.txt"));
    }).then(function (txt) {
      var out = "";
      String(txt || "").split(/\r?\n/).some(function (l) {
        l = l.trim();
        if (!l || l.charAt(0) === "#") return false;
        out = firstSentence(l.replace(/`/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1"));
        return true;
      });
      lines[k] = out;
      return out;
    });
  }

  // The first sentence, at most MAX_LINE characters (cut at a word,
  // with an ellipsis).
  var MAX_LINE = 160;
  function firstSentence(l) {
    var m = /^(.+?[.!?;])(\s|$)/.exec(l);
    var out = m ? m[1] : l;
    if (out.length > MAX_LINE) {
      out = out.slice(0, MAX_LINE);
      var sp = out.lastIndexOf(" ");
      out = (sp > 60 ? out.slice(0, sp) : out).replace(/[,:;·\s]+$/, "") + "…";
    }
    return out;
  }

  // ---------- For the Today card ----------
  // → Promise<null | { week, id, name, line, opened, game }>
  function state() {
    initOnce();
    if (muted()) return Promise.resolve(null);
    var d = read(), week = C.weekOf(DK.today()), id = C.pick(installedIds(), d, week);
    var app = id ? appById(id) : null;
    if (!app) return Promise.resolve(null);
    return helpLine(id).then(function (line) {
      return { week: week, id: id, name: app.name, line: line, opened: typeof read().seen[id] === "number", game: isGame(id) };
    });
  }
  function notForMe(id) {
    if (!appById(String(id || ""))) return false;
    return save(C.setNo(read(), id, true, Date.now()));
  }
  function mute(on) {
    var n = N();
    if (!n || typeof n.setAppToggle !== "function") return false;
    n.setAppToggle(NS, !on);
    return true;
  }

  // ---------- The weekly notice ----------
  function settled() {
    var s = S(), connected = false;
    try { connected = !!(s && s.isConnected()); } catch (e) {}
    return !connected || syncDoneAt > 0 || Date.now() - bootAt > SYNC_WAIT_MS;
  }
  function registered() { return apps().length > 0; }
  function tick() {
    if (sending || !registered() || !settled() || !initOnce()) return;
    var n = N();
    if (!n || typeof n.emit !== "function") return;
    var day = DK.today(), week = C.weekOf(day), loc = readLocal();
    if (loc.last === week) return;
    if (day === C.weekStart(week) && new Date().getHours() < NOTICE_HOUR) return;   // Monday before 10:00
    var id = C.pick(installedIds(), read(), week), app = id ? appById(id) : null;
    if (!app || muted() || typeof read().seen[id] === "number") {
      loc.last = week;                           // nothing to say this week, or muted
      writeLocal(loc);
      return;
    }
    sending = true;
    helpLine(id).then(function (line) {
      sending = false;
      var w = words();
      n.emit({
        ns: NS,
        key: "week-" + week,
        type: "reminder",
        title: w["n.title"].replace("{app}", app.name),
        body: line || (isGame(id) ? w["n.game"] : w["n.body"]),
        deepLink: "system:open:" + id
      });
      var l2 = readLocal();
      l2.last = week;
      writeLocal(l2);
    }, function () { sending = false; });
  }

  root.orosDiscover = {
    VERSION: "1.0.0",
    state: state,
    seen: seen,
    notForMe: notForMe,
    mute: mute,
    muted: muted,
    tick: tick
  };
  registerSlice();
})(window);
