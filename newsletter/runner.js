// ============================================================
// orOS Newsletter — shell side (v1.0.0)
// Runs in the SHELL window (index.html loads it after
// mail/compose.js, mail/mime.js, newsletter/core.js, render.js and
// engine.js), so an issue goes on sending, a scheduled issue starts
// on time and the Inbox is read with the Newsletter window CLOSED,
// as long as orOS is open on this device.
//   - owns the sync slice "newsletter" (always live, merge function):
//     a pull merges into oros-newsletter-data and wakes the engine
//   - waits for the first sync merge (or for sync to be off / to
//     fail) before it sends, so it never sends from stale data
//   - wakes on the app's writes (storage events) and its kick()
//   - notices (ns "newsletter", per-app toggle and quiet hours in
//     notifications.js): an issue went out, an issue paused on an
//     error, a scheduled issue started, new subscribers / unsubscribes
//     / bounces read from the Inbox
// The app talks to it through window.orosNewsletterRunner:
//   { v, kick(), state(), checkInbox() → Promise<tally>, on(fn) → off,
//     fetchItems(url) → Promise<[Reader item]> (v2) }
// RSS to e-mail (v2): every 10 minutes the feeds due on this device
// become issues (newsletter/engine.js runFeeds), read through the
// Reader's network layer (feeds/core.js + feeds/fetch.js), which the
// runner loads into the shell the first time a feed is due.
// List clean-up: every hour (first after 2 minutes) the lists this
// device cleans lose their long-unconfirmed and long-gone subscribers
// (newsletter/engine.js runClean), once a day each.
// fn(kind) is called with "state" or "data".
// Honest limit: orOS closed = nothing is sent; a background tab is
// slowed by the browser (about one message a minute).
// ============================================================
(function (root) {
  "use strict";
  var C = root.OrosNewsletterCore, E = root.OrosNewsletterEngine;
  if (!C || !E || !root.orosMailCompose) return;          // stale bundle — silent
  if (root.orosNewsletterRunner) return;

  var SYNC_WAIT_MS = 60000, FAIL_GRACE_MS = 15000;
  var bootAt = Date.now(), sync = { at: 0, failAt: 0 };
  var listeners = [];
  var VER = (function () {
    var s = root.document && root.document.currentScript;
    var m = s && /[?&]v=([^&#]+)/.exec(s.src || "");
    return m ? m[1] : "";
  })();
  var engine = null;

  var TXT = {
    en: {
      "run.done": "“{s}” went out to {n}", done1: "“{s}” went out to 1",
      paused: "Newsletter paused: “{s}”", pausedBody: "Open Newsletter to see why and resume.",
      started: "Sending “{s}”", startedBody: "The scheduled issue started.",
      inbox: "Newsletter: {list}", subs: "{n} new", unsubs: "{n} unsubscribed", bounced: "{n} bounced",
      inv: "Confirmation requests stopped", invBody: "Open Newsletter: the sending account needs a look.",
      rssDraft: "New draft from RSS: “{s}”", rssDraftBody: "Open Newsletter to look it over and send it.",
      rssSend: "Sending “{s}” (RSS)",
      clean: "Newsletter: {list} cleaned up", cleanBody: "{p} unconfirmed and {g} who had left were deleted.",
      cleanWait: "Newsletter: {list} waits for your OK", cleanWaitBody: "{n} people would be deleted at once. Open Subscribers › Clean up to look and confirm."
    },
    el: {
      "run.done": "Το «{s}» στάλθηκε σε {n}", done1: "Το «{s}» στάλθηκε σε 1",
      paused: "Παύση αποστολής: «{s}»", pausedBody: "Άνοιξε το Ενημερωτικό δελτίο για να δεις γιατί και να συνεχίσεις.",
      started: "Αποστολή «{s}»", startedBody: "Το προγραμματισμένο τεύχος ξεκίνησε.",
      inbox: "Ενημερωτικό δελτίο: {list}", subs: "{n} νέοι", unsubs: "{n} διαγραφές", bounced: "{n} επιστροφές",
      inv: "Σταμάτησαν τα αιτήματα επιβεβαίωσης", invBody: "Άνοιξε το Ενημερωτικό δελτίο: ο λογαριασμός αποστολής θέλει έλεγχο.",
      rssDraft: "Νέο πρόχειρο από RSS: «{s}»", rssDraftBody: "Άνοιξε το Ενημερωτικό δελτίο για να το δεις και να το στείλεις.",
      rssSend: "Αποστολή «{s}» (RSS)",
      clean: "Ενημερωτικό δελτίο: καθαρισμός της λίστας {list}", cleanBody: "Διαγράφηκαν {p} που δεν επιβεβαίωσαν και {g} που είχαν φύγει.",
      cleanWait: "Ενημερωτικό δελτίο: η λίστα {list} περιμένει το ΟΚ σου", cleanWaitBody: "Θα διαγράφονταν {n} άτομα μαζί. Άνοιξε Συνδρομητές › Καθαρισμός για να δεις και να επιβεβαιώσεις."
    }
  };
  // The shell's language; a pack language (orosI18n) reads the
  // "newsletter" pack when the shell has it loaded, else English.
  function lang() {
    try { if (root.orosI18n) return root.orosI18n.lang(); } catch (e) {}
    try { if (root.orosTodayEnv && root.orosTodayEnv.lang() === "el") return "el"; } catch (e) {}
    try { return localStorage.getItem("oros-lang") === "el" ? "el" : "en"; } catch (e) { return "en"; }
  }
  function tx(k, p) {
    var l = lang(), I = root.orosI18n;
    var s = (TXT[l] || (I ? I.table(TXT, "newsletter", l) : TXT.en))[k] || "";
    if (p) Object.keys(p).forEach(function (x) { s = s.split("{" + x + "}").join(String(p[x])); });
    return s;
  }
  function subjOf(x) { return (root.OrosNewsletterRender.personalize(x.subj, null) || "…").slice(0, 80); }

  function emit(o) {
    var N = root.orosNotifs;
    if (!(N && typeof N.emit === "function")) return;
    try {
      o.ns = "newsletter";
      o.deepLink = "system:open:newsletter";
      N.emit(o);
    } catch (e) {}
  }
  function notify(kind, info) {
    if (kind === "done") {
      var x = info.issue;
      emit({ key: "done-" + x.id, type: "info", title: x.n === 1 ? tx("done1", { s: subjOf(x) }) : tx("run.done", { s: subjOf(x), n: x.n }), body: "" });
    } else if (kind === "paused") {
      emit({ key: "paused-" + info.issue.id + "-" + E.dayKey(), type: "reminder", title: tx("paused", { s: subjOf(info.issue) }), body: tx("pausedBody") });
    } else if (kind === "started") {
      emit({ key: "started-" + info.issue.id + "-" + info.issue.start, type: "info", title: tx("started", { s: subjOf(info.issue) }), body: tx("startedBody") });
    } else if (kind === "inbox") {
      var t = info.tally, parts = [];
      if (t.s) parts.push(tx("subs", { n: t.s }));
      if (t.u) parts.push(tx("unsubs", { n: t.u }));
      if (t.b) parts.push(tx("bounced", { n: t.b }));
      if (!parts.length) return;
      var lists = C.live(E.read().lists);
      emit({ key: "inbox-" + Date.now(), type: "info", title: tx("inbox", { list: lists.length === 1 ? lists[0].name : "" }).replace(/: $/, ""),
             body: parts.join(" · ") });
    } else if (kind === "invfail") {
      emit({ key: "inv-" + info.list.id + "-" + E.dayKey(), type: "reminder", title: tx("inv"), body: tx("invBody") });
    }
  }
  // RSS to e-mail: feeds due on this device, read through the Reader's
  // network layer (direct, else the relay's "web" op).
  var RSS_EVERY = 10 * 60 * 1000;
  var feedLib = null;
  function loadScript(src) {
    return new Promise(function (ok, no) {
      var el = root.document.createElement("script");
      el.src = src + (VER ? "?v=" + VER : "");
      el.onload = ok;
      el.onerror = function () { no({ code: "nofeeds" }); };
      root.document.head.appendChild(el);
    });
  }
  function feedsReady() {
    if (root.orosFeedsFetch && root.orosFeedsCore) return Promise.resolve();
    if (!root.document) return Promise.reject({ code: "nofeeds" });
    if (!feedLib) {
      feedLib = (root.orosFeedsCore ? Promise.resolve() : loadScript("feeds/core.js"))
        .then(function () { return root.orosFeedsFetch ? null : loadScript("feeds/fetch.js"); });
      feedLib["catch"](function () { feedLib = null; });
    }
    return feedLib;
  }
  function fetchItems(url) {
    return feedsReady().then(function () { return fetchOne(url); });
  }
  function fetchOne(url) {
    var F = root.orosFeedsFetch, FC = root.orosFeedsCore;
    if (!F || !FC) return Promise.reject({ code: "nofeeds" });
    return F.fetchOne(url, { accept: "application/rss+xml, application/atom+xml, application/feed+json, application/xml;q=0.9, */*;q=0.8" })
      .then(function (r) {
        var f = r.status >= 200 && r.status < 300 ? FC.parseFeed(r.text, r.finalUrl || url, Date.now()) : null;
        if (!f) throw { code: "nofeed" };
        return f.items;
      });
  }
  function feeds() {
    if (!engine) { setTimeout(feeds, RSS_EVERY); return; }
    E.runFeeds(fetchItems).then(function (res) {
      res.forEach(function (o) {
        emit(o.sending ? { key: "rss-" + o.issue.id, type: "info", title: tx("rssSend", { s: subjOf(o.issue) }), body: "" }
                       : { key: "rss-" + o.issue.id, type: "reminder", title: tx("rssDraft", { s: subjOf(o.issue) }), body: tx("rssDraftBody") });
      });
      if (res.length) { fire("data"); engine.kick(); }
    }, function () {}).then(function () { setTimeout(feeds, RSS_EVERY); });
  }
  // List clean-up: once a day per list, on the list's clean-up device.
  var CLEAN_EVERY = 60 * 60 * 1000;
  function clean() {
    if (!engine) { setTimeout(clean, CLEAN_EVERY); return; }
    E.runClean().then(function (res) {
      res.forEach(function (o) {
        var name = o.list.name.slice(0, 60);
        emit(o.wait ? { key: "cleanwait-" + o.list.id + "-" + E.dayKey(), type: "reminder", title: tx("cleanWait", { list: name }), body: tx("cleanWaitBody", { n: o.wait }) }
                    : { key: "clean-" + o.list.id + "-" + E.dayKey(), type: "info", title: tx("clean", { list: name }), body: tx("cleanBody", { p: o.pend, g: o.gone }) });
      });
      if (res.some(function (o) { return !o.wait; })) { dirty(); fire("data"); }
    }, function () {}).then(function () { setTimeout(clean, CLEAN_EVERY); });
  }
  function fire(kind) {
    listeners = listeners.filter(function (fn) {
      try { fn(kind); return true; } catch (e) { return false; }     // a closed app frame
    });
  }

  // ---------- sync slice (always live in the shell) ----------
  function S() { return root.orosSync || null; }
  function sliceGet() { return E.read(); }
  function sliceSet(incoming) {                  // R6: a pull never marks dirty
    if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.subs)) return;
    var before = JSON.stringify(E.read());
    var out = E.write(incoming);
    if (!out || JSON.stringify(out) === before) return;
    fire("data");
    if (engine) engine.kick();
  }
  function registerSlice() {
    var s = S();
    if (!s || typeof s.registerSlice !== "function") { setTimeout(registerSlice, 100); return; }
    s.registerSlice("newsletter", sliceGet, sliceSet, E.KEY, C.mergeNewsletter);
    if (typeof s.onAutoSync === "function") {
      s.onAutoSync(function (kind) {
        if (kind === "done") sync.at = Date.now();
        else if (kind === "fail") sync.failAt = Date.now();
      });
    }
  }
  function settled() {
    var s = S(), connected = false, unlocked = false, now = Date.now();
    try { connected = !!(s && s.isConnected()); } catch (e) {}
    try { unlocked = !!(s && s.hasPassphrase()); } catch (e) {}
    if (!connected) return true;                 // no cloud sync: local data is all there is
    if (!unlocked) return false;                 // locked: wait for the passphrase
    if (sync.at) return true;
    if (sync.failAt && now - sync.failAt >= FAIL_GRACE_MS) return true;
    return now - bootAt >= SYNC_WAIT_MS;
  }
  function dirty() { var s = S(); try { if (s && typeof s.markDirty === "function") s.markDirty(); } catch (e) {} }

  function start() {
    if (engine) return;
    if (!settled()) { setTimeout(start, 3000); return; }
    engine = E.create({
      fs: function () { return root.orosFS || null; },
      dirty: dirty,
      onState: function () { fire("state"); },
      onChange: function () { fire("data"); },
      notify: notify
    });
  }

  // The app's writes (another document) → look again.
  root.addEventListener("storage", function (e) {
    if (e.key === E.KEY && engine) engine.kick();
  });
  root.addEventListener("online", function () { if (engine) engine.kick(); });

  root.orosNewsletterRunner = {
    v: 2,
    fetchItems: fetchItems,
    kick: function () { if (engine) engine.kick(); else start(); },
    state: function () { return engine ? engine.state() : { k: "wait-sync" }; },
    checkInbox: function () { return engine ? engine.checkInbox() : Promise.resolve({ u: 0, s: 0, c: 0, b: 0, err: { code: "wait-sync" } }); },
    on: function (fn) {
      if (typeof fn !== "function") return function () {};
      listeners.push(fn);
      return function () { listeners = listeners.filter(function (f) { return f !== fn; }); };
    }
  };

  registerSlice();
  setTimeout(start, 2000);
  setTimeout(feeds, 30000);
  setTimeout(clean, 120000);
})(window);
