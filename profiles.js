// ============================================================
// orOS — profiles.js (first-run "What will you do with orOS?", v1.0.0)
// ------------------------------------------------------------
// A shell component, like launcher.js: it runs IN the shell document.
// New users only (shell.js decides when) see one screen before the
// tour: "Everything" (first, chosen already) or one or more profiles
// (Home, Work/Business, School, Creating, Games), then a list of every
// app with a tick box. Profiles only tick boxes; the user has the last
// word on each app.
//   • Continue with "Everything", the X, Escape: nothing is written,
//     the menu stays as it is today.
//   • Otherwise the unticked apps are hidden from the MENU only
//     (launcher.js slice "menu"): search, deep links, the desktop, the
//     Dock and other apps still open them. Written through
//     orosLauncher.presetMenuHidden (mtime 1), so a choice the user
//     made on another device always wins the merge.
//   • Settings › Menu › "Choose a profile" opens the same screen over
//     the current menu; there Save writes real choices (setMenuHidden).
// Apps released later have no item, so they appear in the menu.
// No storage of its own, nothing synced, text only through textContent.
// Pure logic (profile lists, picking) is unit-tested in node
// (tests/profiles.test.js).
// ============================================================
(function (root) {
  "use strict";

  var VER = "1.0.0";

  // ---------- 1. Model (pure) ----------
  // Always ticked by a profile: the system, and what everybody uses.
  var BASE = ["settings", "help", "today", "assistant", "files", "notes", "todo", "calendar",
              "contacts", "calculator", "weather", "time", "passwords"];

  var PROFILES = {
    home: ["budget", "meals", "chores", "water", "habits", "health", "plants", "petcare", "garage",
           "travel", "split", "radio", "music", "podcasts", "maps", "feeds"],
    work: ["writer", "spreadsheet", "slides", "kanban", "mail", "timesheet", "invoices", "quote", "crm",
           "stock", "newsletter", "signature", "certificates", "converter", "storage"],
    school: ["writer", "spreadsheet", "slides", "wiki", "mindmap", "units", "texttools", "library",
             "museum", "sky", "maps", "habits", "pubdomain", "qr"],
    create: ["atelier", "photolab", "pixel", "mockups", "layout", "writer", "slides", "prompter",
             "studio", "montage", "mixer", "wallpaper", "labels", "typewriter"],
    games: ["gamecenter", "memory", "connect4", "dots", "tictactoe", "simon", "slider", "lightsout",
            "whack", "snake", "g2048", "wordle", "spot", "hexagon", "chess", "sudoku", "tetris",
            "minesweeper", "mahjong", "gomoku", "bubble", "checkers", "mastermind", "battleship", "rps",
            "hangman", "flow", "nonogram", "breakout", "reversi", "mancala", "pong", "backgammon",
            "wordsearch", "solitaire", "jigsaw", "crossword", "xeri", "petworld", "dice", "wheel", "scores"]
  };
  var ORDER = ["home", "work", "school", "create", "games"];

  // The apps a set of profiles shows, in `appIds` order. No profile =
  // every app ("Everything"). Ids not in `appIds` are dropped.
  function pick(profiles, appIds) {
    var ids = Array.isArray(appIds) ? appIds : [];
    var list = (Array.isArray(profiles) ? profiles : []).filter(function (p) {
      return Object.prototype.hasOwnProperty.call(PROFILES, p);
    });
    if (!list.length) return ids.slice();
    var want = {};
    BASE.forEach(function (id) { want[id] = true; });
    list.forEach(function (p) { PROFILES[p].forEach(function (id) { want[id] = true; }); });
    return ids.filter(function (id) { return want[id] === true; });
  }

  // The apps of `appIds` that `shown` leaves out, in `appIds` order.
  function hiddenOf(shown, appIds) {
    var on = {};
    (Array.isArray(shown) ? shown : []).forEach(function (id) { on[id] = true; });
    return (Array.isArray(appIds) ? appIds : []).filter(function (id) { return on[id] !== true; });
  }

  var model = { VER: VER, BASE: BASE, PROFILES: PROFILES, ORDER: ORDER, pick: pick, hiddenOf: hiddenOf };
  if (typeof module !== "undefined" && module.exports) module.exports = model;
  if (!root || !root.document) return;

  // ---------- 2. Strings ----------
  // The shell's table (translations.js "pf.<key>"), German and other
  // languages from the shell pack.
  var STR_KEYS = ["title", "intro", "introSettings", "all", "home", "work", "school", "create", "games", "profiles", "apps", "count", "cont", "save", "cancel", "close", "already"];
  function strings() {
    var L = {}, f = root.t;
    STR_KEYS.forEach(function (k) { var v = typeof f === "function" ? f("pf." + k) : ""; L[k] = v && v !== "pf." + k ? v : k; });
    return L;
  }


  // ---------- 3. Styles (injected once; skin variables only) ----------
  var CSS = [
    "#oros-profiles{position:fixed;inset:0;z-index:10050;background:rgba(0,0,0,.55);display:flex;",
    "align-items:center;justify-content:center;padding:16px;box-sizing:border-box}",
    "#oros-profiles .pf-card{box-sizing:border-box;width:min(600px,100%);max-height:100%;display:flex;flex-direction:column;",
    "background:var(--panel-bg);color:var(--text);border:1px solid var(--border);border-radius:12px;",
    "box-shadow:0 10px 30px var(--shadow);overflow:hidden}",
    "#oros-profiles .pf-head{position:relative;padding:16px 56px 0 18px}",
    "#oros-profiles h2{margin:0 0 6px;font-size:18px;outline:none}",
    "#oros-profiles .pf-intro{margin:0 0 12px;font-size:14px;line-height:1.45;color:var(--text-dim)}",
    "#oros-profiles .pf-x{position:absolute;top:8px;right:8px;width:44px;height:44px;border:none;border-radius:8px;",
    "background:transparent;color:var(--text);font-size:22px;line-height:1;cursor:pointer}",
    "#oros-profiles .pf-x:hover,#oros-profiles .pf-x:focus-visible{background:var(--accent-soft)}",
    "#oros-profiles .pf-chips{display:flex;flex-wrap:wrap;gap:8px;padding:0 18px 10px;margin:0;border:none}",
    "#oros-profiles .pf-chip{min-height:40px;padding:0 14px;border-radius:20px;border:1px solid var(--border);",
    "background:transparent;color:var(--text);font:inherit;font-size:14px;cursor:pointer}",
    "#oros-profiles .pf-chip[aria-pressed=true]{background:var(--accent);border-color:var(--accent);color:var(--accent-text,#fff)}",
    "#oros-profiles .pf-count{margin:0;padding:6px 18px 8px;font-size:13px;color:var(--text-dim);border-top:1px solid var(--border)}",
    "#oros-profiles .pf-list{flex:1 1 auto;min-height:120px;overflow-y:auto;padding:0 18px 8px}",
    "#oros-profiles .pf-cat{margin:10px 0 4px;font-size:13px;font-weight:600;color:var(--text-dim)}",
    "#oros-profiles .pf-apps{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:0 12px}",
    "#oros-profiles .pf-app{display:flex;align-items:center;gap:8px;min-height:40px;font-size:14px;cursor:pointer;min-width:0}",
    "#oros-profiles .pf-app input{width:18px;height:18px;margin:0;flex:0 0 auto;accent-color:var(--accent)}",
    "#oros-profiles .pf-app span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    "#oros-profiles .pf-foot{display:flex;flex-wrap:wrap;align-items:center;gap:8px;justify-content:flex-end;",
    "padding:10px 18px 14px;border-top:1px solid var(--border)}",
    "#oros-profiles .pf-foot button{min-height:40px;padding:0 16px;border-radius:8px;border:1px solid var(--border);",
    "background:transparent;color:var(--text);font:inherit;font-size:14px;cursor:pointer}",
    "#oros-profiles .pf-foot .pf-go{background:var(--accent);border-color:var(--accent);color:var(--accent-text,#fff);font-weight:600}",
    "#oros-profiles .pf-foot .pf-already{margin-right:auto;border:none;padding:0 4px;color:var(--accent);text-decoration:underline;text-align:left}",
    "@media (max-width:480px){#oros-profiles{padding:0}#oros-profiles .pf-card{width:100%;height:100%;max-height:none;border-radius:0;border:none}",
    "#oros-profiles .pf-apps{grid-template-columns:1fr 1fr}#oros-profiles .pf-foot .pf-already{flex:1 1 100%;margin:0}}"
  ].join("");
  var styled = false;
  function style() {
    if (styled) return;
    styled = true;
    var s = root.document.createElement("style");
    s.id = "oros-profiles-css";
    s.textContent = CSS;
    root.document.head.appendChild(s);
  }

  // ---------- 4. The screen ----------
  // opts = {
  //   mode:   "first" | "settings",
  //   lang:   "en" | "el",
  //   apps:   [{ id, name, cat, catName }]  every internal app, menu order,
  //   shown:  [id]   apps the menu shows now (settings mode),
  //   done:   function (result)  result = { hidden: [id] | null, shown: [id],
  //           already: bool } — hidden null = nothing to write
  // }
  var open = null;

  function show(opts) {
    if (open) return false;
    var doc = root.document;
    var L = strings();
    var first = opts.mode !== "settings";
    var apps = Array.isArray(opts.apps) ? opts.apps : [];
    var ids = apps.map(function (a) { return a.id; });
    var on = {};
    var start = first ? ids : (Array.isArray(opts.shown) ? opts.shown : ids);
    start.forEach(function (id) { on[id] = true; });
    var chosen = [];                         // profile keys pressed
    style();

    function el(tag, cls, text) {
      var n = doc.createElement(tag);
      if (cls) n.className = cls;
      if (text != null) n.textContent = text;
      return n;
    }

    var box = el("div");
    box.id = "oros-profiles";
    var card = el("div", "pf-card");
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-labelledby", "pf-title");
    card.setAttribute("aria-describedby", "pf-intro");
    var head = el("div", "pf-head");
    var h = el("h2", null, L.title);
    h.id = "pf-title";
    h.tabIndex = -1;
    var intro = el("p", "pf-intro", first ? L.intro : L.introSettings);
    intro.id = "pf-intro";
    var x = el("button", "pf-x", "×");
    x.type = "button";
    x.setAttribute("aria-label", L.close);
    head.appendChild(h);
    head.appendChild(intro);
    head.appendChild(x);

    var chips = el("div", "pf-chips");
    chips.setAttribute("role", "group");
    chips.setAttribute("aria-label", L.profiles);
    var chipBtns = {};
    ["all"].concat(ORDER).forEach(function (k) {
      var b = el("button", "pf-chip", L[k]);
      b.type = "button";
      b.setAttribute("data-k", k);
      b.addEventListener("click", function () { pressChip(k); });
      chipBtns[k] = b;
      chips.appendChild(b);
    });

    var count = el("p", "pf-count");
    count.setAttribute("aria-live", "polite");
    var list = el("div", "pf-list");
    list.setAttribute("role", "group");
    list.setAttribute("aria-label", L.apps);
    var boxes = {};
    var cats = [], byCat = {};
    apps.forEach(function (a) {
      if (!byCat[a.cat]) { byCat[a.cat] = { name: a.catName, apps: [] }; cats.push(a.cat); }
      byCat[a.cat].apps.push(a);
    });
    // Categories in the order of the name the user reads, like the menu.
    cats.sort(function (a, b) { return String(byCat[a].name).localeCompare(String(byCat[b].name), root.orosI18n ? root.orosI18n.locale() : (opts.lang === "el" ? "el" : "en")); });
    cats.forEach(function (c) {
      list.appendChild(el("h3", "pf-cat", byCat[c].name));
      var grid = el("div", "pf-apps");
      byCat[c].apps.forEach(function (a) {
        var lab = el("label", "pf-app");
        var cb = el("input");
        cb.type = "checkbox";
        cb.setAttribute("data-id", a.id);
        cb.addEventListener("change", function () {
          on[a.id] = cb.checked;
          paint();
        });
        boxes[a.id] = cb;
        lab.appendChild(cb);
        lab.appendChild(el("span", null, a.name));
        grid.appendChild(lab);
      });
      list.appendChild(grid);
    });

    var foot = el("div", "pf-foot");
    var already = null;
    if (first) {
      already = el("button", "pf-already", L.already);
      already.type = "button";
      foot.appendChild(already);
    } else {
      var cancel = el("button", "pf-cancel", L.cancel);
      cancel.type = "button";
      cancel.addEventListener("click", function () { finish(null); });
      foot.appendChild(cancel);
    }
    var go = el("button", "pf-go", first ? L.cont : L.save);
    go.type = "button";
    foot.appendChild(go);

    card.appendChild(head);
    card.appendChild(chips);
    card.appendChild(count);
    card.appendChild(list);
    card.appendChild(foot);
    box.appendChild(card);

    function shownIds() { return ids.filter(function (id) { return on[id] === true; }); }

    function pressChip(k) {
      if (k === "all") chosen = [];
      else {
        var at = chosen.indexOf(k);
        if (at >= 0) chosen.splice(at, 1); else chosen.push(k);
      }
      on = {};
      pick(chosen, ids).forEach(function (id) { on[id] = true; });
      paint();
    }

    function paint() {
      var n = shownIds().length;
      var all = n === ids.length;
      chipBtns.all.setAttribute("aria-pressed", String(all && !chosen.length));
      ORDER.forEach(function (k) { chipBtns[k].setAttribute("aria-pressed", String(chosen.indexOf(k) >= 0)); });
      ids.forEach(function (id) { boxes[id].checked = on[id] === true; });
      count.textContent = L.count.replace("{n}", n).replace("{total}", ids.length);
    }

    function finish(result) {
      if (!open) return;
      root.removeEventListener("keydown", onKey, true);
      if (box.parentNode) box.parentNode.removeChild(box);
      open = null;
      try { if (typeof opts.done === "function") opts.done(result); } catch (e) {}
    }

    // First run: X / Escape keep everything; Settings: they cancel.
    function dismiss() { finish(first ? { hidden: null, shown: ids.slice(), already: false } : null); }

    x.addEventListener("click", dismiss);
    go.addEventListener("click", function () {
      var shown = shownIds();
      var hidden = hiddenOf(shown, ids);
      finish({ hidden: (first && !hidden.length) ? null : hidden, shown: shown, already: false });
    });
    if (already) already.addEventListener("click", function () {
      finish({ hidden: null, shown: ids.slice(), already: true });
    });
    // The dimmed page takes no clicks (no accidental app opens).
    box.addEventListener("click", function (e) { e.stopPropagation(); });

    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); dismiss(); return; }
      if (e.key === "Tab") {
        // Keep focus inside the card (aria-modal).
        var f = Array.prototype.filter.call(card.querySelectorAll("button, input"), function (n) {
          return !n.disabled && n.offsetParent !== null;
        });
        if (!f.length) return;
        var at = f.indexOf(doc.activeElement);
        if (e.shiftKey && at <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && at === f.length - 1) { e.preventDefault(); f[0].focus(); }
        else if (at < 0) { e.preventDefault(); f[0].focus(); }
        return;
      }
      // Shell shortcuts wait while the screen is up; typing in it works.
      if (e.ctrlKey && e.altKey && e.shiftKey) e.stopImmediatePropagation();
    }

    doc.body.appendChild(box);
    open = box;
    root.addEventListener("keydown", onKey, true);
    paint();
    (first ? chipBtns.all : h).focus();
    return true;
  }

  root.orosProfiles = {
    VER: VER,
    model: model,
    show: show,
    isOpen: function () { return !!open; }
  };
})(typeof window !== "undefined" ? window : globalThis);
