// ============================================================
// orOS Minimalism — App logic (version stamped by CI)
// One guided suggestion per day, two streams: physical & digital.
// 365-day cycle, deterministic (same day → same proposal on
// every device — the schedule is COMPUTED from content.js,
// never stored). No streak penalties: days you never opened
// the app are transparent; only a deliberate Skip touches
// the streak. Years repeat forever — nothing zeroes, ever.
// Sections:
//   1. Constants, i18n, helpers
//   2. Schedule engine (deterministic day → proposal)
//   3. Data model + storage (day entities, prefs, tombstones)
//   4. Merge engine (mood-contract, compact)
//   5. Views: today card, skip dialog, history, settings
//   6. Sync slice + palette
//   7. Deep link + boot
// Data:
//   slice "oros-minimalism-data" → travels (days + prefs)
//   day entity: { id: "<ymd>:<level>", date, level,
//                 status: "done"|"skip", reason, mtime }
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-minimalism-data";
  var DATA_VER    = 1;
  var CYCLE_DAYS  = 365;

  // ---------- 1. Constants, i18n, helpers ----------

  var LANG = localStorage.getItem("oros-lang") === "el" ? "el" : "en";

  var STRINGS = {
    en: {
      "app.title":      "Minimalism",
      "tab.today":      "Today",
      "tab.history":    "History",
      "card.day":       "Day",
      "card.of":        "of 365",
      "lvl.phys":       "Physical",
      "lvl.dig":        "Digital",
      "act.done":       "Done",
      "act.skip":       "Skip",
      "act.undo":       "Undo",
      "status.done":    "Done",
      "status.skip":    "Skipped",
      "skip.title":     "Why skip?",
      "skip.r1":        "Not today",
      "skip.r2":        "Doesn't fit me",
      "skip.other.ph":  "Something else… (optional)",
      "skip.ok":        "Skip",
      "skip.cancel":    "Cancel",
      "streak.label":   "day streak",
      "hist.title":     "Last 30 days",
      "hist.empty":     "Nothing yet — your days will appear here.",
      "hist.today":     "Today",
      "back.today":     "Back to today",
      "set.remind":     "Daily reminder",
      "set.oclock":     ":00",
      "saved.done":     "Marked as done",
      "saved.skip":     "Skipped — no penalty, ever",
      "saved.undo":     "Unmarked",
      "saved.pref":     "Setting saved",
      "sync.pull":      "Updated from sync",
      "content.missing": "Content file missing — check minimalism/content.js",
      "viewing.day":    "Viewing"
    },
    el: {
      "app.title":      "Μινιμαλισμός",
      "tab.today":      "Σήμερα",
      "tab.history":    "Ιστορικό",
      "card.day":       "Ημέρα",
      "card.of":        "των 365",
      "lvl.phys":       "Φυσικός",
      "lvl.dig":        "Ψηφιακός",
      "act.done":       "Το έκανα",
      "act.skip":       "Παράλειψη",
      "act.undo":       "Αναίρεση",
      "status.done":    "Έγινε",
      "status.skip":    "Παραλείφθηκε",
      "skip.title":     "Γιατί να το παραλείψεις;",
      "skip.r1":        "Όχι σήμερα",
      "skip.r2":        "Δεν μου ταιριάζει",
      "skip.other.ph":  "Κάτι άλλο… (προαιρετικό)",
      "skip.ok":        "Παράλειψη",
      "skip.cancel":    "Ακύρωση",
      "streak.label":   "ημέρες συνεχόμενες",
      "hist.title":     "Τελευταίες 30 ημέρες",
      "hist.empty":     "Τίποτα ακόμα — οι μέρες σου θα εμφανιστούν εδώ.",
      "hist.today":     "Σήμερα",
      "back.today":     "Επιστροφή στο σήμερα",
      "set.remind":     "Καθημερινή υπενθύμιση",
      "set.oclock":     ":00",
      "saved.done":     "Σημειώθηκε ως έγινε",
      "saved.skip":     "Παραλείφθηκε — καμία ποινή, ποτέ",
      "saved.undo":     "Αφαιρέθηκε",
      "saved.pref":     "Η ρύθμιση αποθηκεύτηκε",
      "sync.pull":      "Ενημερώθηκε από συγχρονισμό",
      "content.missing": "Λείπει το αρχείο περιεχομένου — έλεγξε το minimalism/content.js",
      "viewing.day":    "Προβολή"
    }
  };

  function t(key) {
    var p = STRINGS[LANG] || STRINGS.en;
    return p[key] !== undefined ? p[key]
         : (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
  }

  function $(id) { return document.getElementById(id); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ---------- 2. Schedule engine ----------
  // The 365-day program is COMPUTED, never stored: every device
  // derives the same day from the calendar alone. Content arrays
  // shorter than 365 (partial batches) wrap via modulo — always
  // a valid proposal, never a crash.

  function ymdOf(d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function todayYmd() { return ymdOf(new Date()); }
  function dateFromYmd(s) {
    var p = String(s).split("-");
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }
  // Date.UTC math — immune to DST shifts (local ms diffs lie
  // by ±1h across a switch; UTC noon-basis never does).
  function dayOfYear(d) {
    return Math.round(
      (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) -
       Date.UTC(d.getFullYear(), 0, 0)) / 86400000);
  }
  function cycleIndex(ymd) {                 // 0-based, wraps yearly
    return (dayOfYear(dateFromYmd(ymd)) - 1) % CYCLE_DAYS;
  }

  function contentList(level) {
    var pack = window.MINIMALISM_CONTENT || {};
    var arr = pack[LANG] || pack.en;
    if (!Array.isArray(arr)) return [];
    return arr.filter(function (c) { return c && c.level === level; });
  }
  function proposalFor(level, ymd) {
    var list = contentList(level);
    if (!list.length) return null;
    return list[cycleIndex(ymd) % list.length];
  }

  // ---------- 3. Data model + storage ----------
  // state = {
  //   ver: 1, sm, om,
  //   prefs: { remindHour: 10, mtime },
  //   days:  [{ id: "<ymd>:<level>", date, level,
  //             status: "done"|"skip", reason, mtime }],
  //   deleted: { <dayId>: <tombstone ts> }
  // }

  var state = null;

  function newState() {
    return {
      ver: DATA_VER, sm: 0, om: 0,
      prefs: { remindHour: 10, mtime: 0 },
      days: [], deleted: {}
    };
  }

  function migrate(data) {
    if (!data || !Array.isArray(data.days)) return null;
    if (!data.prefs || typeof data.prefs !== "object") {
      data.prefs = { remindHour: 10, mtime: 0 };
    }
    if (typeof data.prefs.remindHour !== "number" ||
        data.prefs.remindHour < 0 || data.prefs.remindHour > 23) {
      data.prefs.remindHour = 10;
    }
    if (typeof data.prefs.mtime !== "number") data.prefs.mtime = 0;
    if (!data.deleted || typeof data.deleted !== "object") data.deleted = {};
    if (typeof data.sm !== "number") data.sm = 0;
    if (typeof data.om !== "number") data.om = 0;
    data.days = data.days.filter(function (e) {
      return e && typeof e.id === "string" && !!e.id;
    });
    data.days.forEach(function (e) {
      var parts = e.id.split(":");
      if (typeof e.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) {
        e.date = parts[0] || todayYmd();
      }
      if (e.level !== "phys" && e.level !== "dig") {
        e.level = parts[1] === "dig" ? "dig" : "phys";
      }
      if (e.status !== "done" && e.status !== "skip") e.status = "done";
      if (typeof e.reason !== "string") e.reason = "";
      if (typeof e.mtime !== "number") e.mtime = 0;
    });
    data.ver = DATA_VER;
    return data;
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var data = migrate(JSON.parse(raw));
        if (data) { state = data; return; }
      }
    } catch (e) { /* corrupted → fresh */ }
    state = newState();
    save();
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { /* quota */ }
    if (window.__orosSyncApi) window.__orosSyncApi.dirty();
  }

  function dayById(id) {
    for (var i = 0; i < state.days.length; i++) {
      if (state.days[i].id === id) return state.days[i];
    }
    return null;
  }

  // Mark / unmark. status=null → tombstone (merge-safe delete);
  // re-marking resurrects with fresh mtime (strict > tombstone).
  function setStatus(ymd, level, status, reason) {
    var id = ymd + ":" + level;
    if (status === null) {
      state.days = state.days.filter(function (x) { return x.id !== id; });
      state.deleted[id] = Date.now();
    } else {
      var e = dayById(id);
      if (!e) {
        e = { id: id, date: ymd, level: level };
        state.days.push(e);
      }
      e.status = status;
      e.reason = reason || "";
      e.mtime = Date.now();
      delete state.deleted[id];
    }
    state.sm = Date.now();
    save();
    render();
  }

  // ---------- 4. Merge engine (mood-contract, compact) ----------
  // Deterministic + symmetric: merge(A,B) === merge(B,A).
  //   · days — union by id, content LWW by mtime (ties by
  //     lexicographic JSON — identical both sides)
  //   · prefs — single object, LWW by prefs.mtime
  //   · tombstones — union with max ts; newer edits resurrect

  function newerObj(a, b) {
    if ((a.mtime || 0) !== (b.mtime || 0)) {
      return (a.mtime || 0) > (b.mtime || 0) ? a : b;
    }
    return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
  }

  function mergeUnionList(a, b, tomb) {
    var map = {};
    (a || []).forEach(function (x) { map[x.id] = x; });
    (b || []).forEach(function (x) {
      map[x.id] = map[x.id] ? newerObj(map[x.id], x) : x;
    });
    var alive = [];
    Object.keys(map).forEach(function (id) {
      var ts = tomb ? tomb[id] : undefined;
      if (ts === undefined || (map[id].mtime || 0) > ts) alive.push(map[id]);
    });
    return alive;
  }

  function mergePrefs(pa, pb) {
    var a = pa || { remindHour: 10, mtime: 0 };
    var b = pb || { remindHour: 10, mtime: 0 };
    if ((a.mtime || 0) !== (b.mtime || 0)) {
      return (a.mtime || 0) > (b.mtime || 0) ? a : b;
    }
    return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
  }

  function mergeMinimalismStates(A, B) {
    var a = A || {}, b = B || {};

    var tomb = {};
    Object.keys(a.deleted || {}).forEach(function (id) { tomb[id] = a.deleted[id]; });
    Object.keys(b.deleted || {}).forEach(function (id) {
      tomb[id] = Math.max(tomb[id] || 0, b.deleted[id]);
    });

    var days = mergeUnionList(a.days, b.days, tomb)
      .sort(function (x, y) {              // timeline order: date desc
        if (x.date !== y.date) return x.date < y.date ? 1 : -1;
        return x.id < y.id ? -1 : (x.id > y.id ? 1 : 0);
      });

    return {
      ver: DATA_VER,
      prefs: mergePrefs(a.prefs, b.prefs),
      sm: Math.max(a.sm || 0, b.sm || 0),
      om: Math.max(a.om || 0, b.om || 0),
      days: days,
      deleted: tomb
    };
  }

  // ---------- 5. Views ----------

  var viewMode = "today";    // "today" | "history"
  var viewYmd  = null;       // null = today; set → viewing a past day

  // Streak, per level. Schedule-aware walking (habits contract):
  // days with NO record are TRANSPARENT (don't count, don't
  // break) — only a deliberate Skip breaks the walk. Nothing
  // zeroes, nobody is punished.
  function streakFor(level) {
    var byDate = {};
    state.days.forEach(function (e) {
      if (e.level === level) byDate[e.date] = e.status;
    });
    var s = 0, guard = 0;
    var cur = new Date();
    while (guard++ < 380) {               // bounded walk, never spins
      var st = byDate[ymdOf(cur)];
      if (st === "skip") break;
      if (st === "done") s++;
      cur.setDate(cur.getDate() - 1);     // DST-safe calendar step
    }
    return s;
  }

  // Lazy toast (mood pattern — index ships no toast node)
  var toastEl = null, toastTimer = null, toastAction = null;
  function showToast(text, actionLabel, actionFn) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.style.cssText =
        "position:fixed;top:calc(12px + env(safe-area-inset-top,0px));right:12px;transform:translateY(-8px);" +
        "z-index:1200;background:var(--panel-bg,#1b1914);border:1px solid var(--border,#2a2824);" +
        "border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.4);padding:9px 14px;" +
        "font-size:13px;color:var(--text,#e8eaf0);opacity:0;transition:opacity .3s,transform .3s;" +
        "max-width:calc(100vw - 32px);";
      document.body.appendChild(toastEl);
    }
    if (toastAction) { toastAction.remove(); toastAction = null; }
    toastEl.textContent = "";                              // stale text dies here
    toastEl.appendChild(document.createTextNode(text));   // text FIRST

    if (actionLabel && typeof actionFn === "function") {
      toastAction = document.createElement("button");
      toastAction.type = "button";
      toastAction.textContent = actionLabel;
      toastAction.style.cssText =
        "margin-left:10px;background:transparent;color:var(--accent,#6d4aff);" +
        "border:none;border-left:1px solid var(--border,#2a2824);padding:0 0 0 10px;" +
        "font-size:13px;font-weight:700;cursor:pointer;";
      toastAction.addEventListener("click", function () {
        actionFn();
        hideToast();
      });
      toastEl.appendChild(toastAction);                  // action SECOND
    }
    void toastEl.offsetWidth;
    toastEl.style.opacity = "1";
    toastEl.style.transform = "translateY(0)";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 5000);
  }
  function hideToast() {
    if (!toastEl) return;
    toastEl.style.opacity = "0";
    toastEl.style.transform = "translateY(-8px)";
    setTimeout(function () {
      // guard: a re-show within the window raised opacity again —
      // never wipe the NEW text
      if (toastEl.style.opacity === "0") toastEl.textContent = "";
      if (toastAction) { toastAction.remove(); toastAction = null; }
    }, 320);
  }

  function buildSkeleton() {
    var root = $("app-root");
    root.innerHTML = "";

    var tabs = document.createElement("div");
    tabs.className = "nav-tabs";
    tabs.id = "min-tabs";

    var bt = document.createElement("button");
    bt.type = "button";
    bt.className = "nav-tab";
    bt.id = "tab-today";
    bt.textContent = t("tab.today");
    bt.addEventListener("click", function () {
      viewMode = "today"; viewYmd = null; render();
    });
    tabs.appendChild(bt);

    var bh = document.createElement("button");
    bh.type = "button";
    bh.className = "nav-tab";
    bh.id = "tab-history";
    bh.textContent = t("tab.history");
    bh.addEventListener("click", function () {
      viewMode = "history"; render();
    });
    tabs.appendChild(bh);

    root.appendChild(tabs);

    var content = document.createElement("div");
    content.id = "min-content";
    root.appendChild(content);
  }

  function paintTabs() {
    var bt = $("tab-today"), bh = $("tab-history");
    if (bt) bt.classList.toggle("active", viewMode === "today");
    if (bh) bh.classList.toggle("active", viewMode === "history");
  }

  // -- skip dialog: preset reasons + optional free text --
  function askSkip(ymd, level) {
    var dlg = document.createElement("dialog");

    var h = document.createElement("h3");
    h.className = "dialog-title";
    h.textContent = t("skip.title");
    dlg.appendChild(h);

    var body = document.createElement("div");
    body.className = "dialog-body reason-buttons";

    var picked = null;
    var mkReason = function (label) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "reason-btn";
      b.textContent = label;
      b.addEventListener("click", function () {
        picked = label;
        var all = body.querySelectorAll(".reason-btn");
        for (var i = 0; i < all.length; i++) all[i].classList.remove("selected");
        b.classList.add("selected");
      });
      body.appendChild(b);
    };
    mkReason(t("skip.r1"));
    mkReason(t("skip.r2"));

    var inp = document.createElement("input");
    inp.type = "text";
    inp.className = "reason-input";
    inp.placeholder = t("skip.other.ph");
    inp.maxLength = 120;
    inp.addEventListener("input", function () {
      picked = inp.value.trim() || null;
    });
    dlg.appendChild(body);
    dlg.appendChild(inp);

    var acts = document.createElement("div");
    acts.className = "dialog-actions";
    var cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn btn-secondary";
    cancel.textContent = t("skip.cancel");
    cancel.addEventListener("click", function () { dlg.close(); });
    acts.appendChild(cancel);
    var ok = document.createElement("button");
    ok.type = "button";
    ok.className = "btn btn-primary";
    ok.textContent = t("skip.ok");
    ok.addEventListener("click", function () {
      var reason = inp.value.trim() || picked || t("skip.r1");
      dlg.close();
      setStatus(ymd, level, "skip", reason);
      showToast(t("saved.skip"));
    });
    acts.appendChild(ok);
    dlg.appendChild(acts);

    document.body.appendChild(dlg);
    dlg.addEventListener("close", function () { dlg.remove(); });  // Esc too
    // outside click closes (calendar/mood pattern)
    dlg.addEventListener("click", function (e) {
      if (e.target === dlg) dlg.close();
    });
    dlg.showModal();
    inp.focus();
  }

  // -- proposal block for one level on one day --
  function buildProposal(host, level, ymd) {
    var prop = proposalFor(level, ymd);
    var block = document.createElement("div");
    block.className = "proposal-block " + level;

    var lvl = document.createElement("div");
    lvl.className = "proposal-level " + level;
    lvl.textContent = t("lvl." + level);
    block.appendChild(lvl);

    if (!prop) {
      var miss = document.createElement("p");
      miss.className = "proposal-why";
      miss.textContent = t("content.missing");
      block.appendChild(miss);
      host.appendChild(block);
      return;
    }

    var ttl = document.createElement("p");
    ttl.className = "proposal-title";
    ttl.textContent = prop.title || "";
    block.appendChild(ttl);

    if (prop.why) {
      var why = document.createElement("p");
      why.className = "proposal-why";
      why.textContent = prop.why;
      block.appendChild(why);
    }

    var entry = dayById(ymd + ":" + level);

    var acts = document.createElement("div");
    acts.className = "card-actions";

    if (entry) {
      // already decided today → status chip + undo (both are
      // reversible: unmark = tombstone, re-mark = resurrect)
      var st = document.createElement("span");
      st.className = "history-status " + entry.status;
      st.textContent = t("status." + entry.status);
      if (entry.reason) st.title = entry.reason;
      acts.appendChild(st);

      var undo = document.createElement("button");
      undo.type = "button";
      undo.className = "btn btn-skip";
      undo.textContent = t("act.undo");
      undo.addEventListener("click", function () {
        setStatus(ymd, level, null);
        showToast(t("saved.undo"));
      });
      acts.appendChild(undo);
    } else if (ymd === todayYmd()) {
      var done = document.createElement("button");
      done.type = "button";
      done.className = "btn btn-done";
      done.textContent = t("act.done");
      done.addEventListener("click", function () {
        setStatus(ymd, level, "done", "");
        showToast(t("saved.done"));
      });
      acts.appendChild(done);

      var skip = document.createElement("button");
      skip.type = "button";
      skip.className = "btn btn-skip";
      skip.textContent = t("act.skip");
      skip.addEventListener("click", function () { askSkip(ymd, level); });
      acts.appendChild(skip);
    }
    // past days are read-only: no done/skip for yesterday —
    // the ritual is TODAY's card only (minimalism, not guilt)

    block.appendChild(acts);
    host.appendChild(block);
  }

  function renderToday() {
    var host = $("min-content");
    if (!host) return;
    host.innerHTML = "";

    var ymd = viewYmd || todayYmd();

    var card = document.createElement("div");
    card.className = "day-card";

    var head = document.createElement("div");
    head.className = "card-header";

    var lab = document.createElement("span");
    lab.className = "card-day-label";
    var d = dateFromYmd(ymd);
    var nice = d.toLocaleDateString(LANG === "el" ? "el-GR" : "en-GB",
      { weekday: "long", day: "numeric", month: "long" });
    lab.textContent = (ymd === todayYmd() ? "" : t("viewing.day") + " · ") + nice;
    head.appendChild(lab);

    var prog = document.createElement("span");
    prog.className = "card-progress";
    prog.textContent = t("card.day") + " " + (cycleIndex(ymd) + 1) + "/" + CYCLE_DAYS +
      " · " + t("card.of");
    head.appendChild(prog);
    card.appendChild(head);

    var body = document.createElement("div");
    body.className = "card-body";
    buildProposal(body, "phys", ymd);
    buildProposal(body, "dig", ymd);
    card.appendChild(body);

    // streak chips (per level — the two streams live independent lives)
    var streaks = document.createElement("div");
    streaks.className = "streaks";
    ["phys", "dig"].forEach(function (lvl) {
      var chip = document.createElement("span");
      chip.className = "streak-chip " + lvl;
      var v = document.createElement("span");
      v.className = "streak-value";
      v.textContent = String(streakFor(lvl));
      chip.appendChild(v);
      var l = document.createElement("span");
      l.className = "streak-label";
      l.textContent = t("lvl." + lvl) + " · " + t("streak.label");
      chip.appendChild(l);
      var today = dayById(todayYmd() + ":" + lvl);
      if (today && today.status === "done") chip.classList.add("streak-today");
      streaks.appendChild(chip);
    });
    card.appendChild(streaks);

    if (viewYmd && viewYmd !== todayYmd()) {
      var back = document.createElement("button");
      back.type = "button";
      back.className = "btn btn-secondary history-toggle";
      back.textContent = t("back.today");
      back.addEventListener("click", function () {
        viewYmd = null; render();
      });
      card.appendChild(back);
    }

    host.appendChild(card);
  }

  function renderHistory() {
    var host = $("min-content");
    if (!host) return;
    host.innerHTML = "";

    var wrap = document.createElement("div");
    wrap.className = "history-view";

    var head = document.createElement("div");
    head.className = "history-header";
    var h = document.createElement("h2");
    h.textContent = t("hist.title");
    head.appendChild(h);
    wrap.appendChild(head);

    var list = document.createElement("div");
    list.className = "history-list";

    var any = false;
    for (var d = 0; d < 30; d++) {
      var dd = new Date();                     // DST-safe calendar step
      dd.setDate(dd.getDate() - d);
      var ymd = ymdOf(dd);
      var pe = dayById(ymd + ":phys");
      var de = dayById(ymd + ":dig");
      if (!pe && !de) continue;                // days with nothing: invisible
      any = true;

      var row = document.createElement("button");
      row.type = "button";
      row.className = "history-entry";

      var dateLab = document.createElement("span");
      dateLab.className = "history-date";
      dateLab.textContent = (d === 0 ? t("hist.today") + " · " : "") +
        dd.toLocaleDateString(LANG === "el" ? "el-GR" : "en-GB",
          { weekday: "short", day: "numeric", month: "short" });
      row.appendChild(dateLab);

      var stat = document.createElement("span");
      stat.className = "history-status-group";
      if (pe) {
        var s1 = document.createElement("span");
        s1.className = "history-status " + pe.status;
        s1.textContent = t("lvl.phys").slice(0, 1) + " · " + t("status." + pe.status);
        if (pe.reason) s1.title = pe.reason;
        stat.appendChild(s1);
      }
      if (de) {
        var s2 = document.createElement("span");
        s2.className = "history-status " + de.status;
        s2.textContent = t("lvl.dig").slice(0, 1) + " · " + t("status." + de.status);
        if (de.reason) s2.title = de.reason;
        stat.appendChild(s2);
      }
      row.appendChild(stat);

      (function (kk) {
        row.addEventListener("click", function () {
          viewMode = "today"; viewYmd = kk; render();
        });
      })(ymd);

      list.appendChild(row);
    }
    wrap.appendChild(list);

    if (!any) {
      var emp = document.createElement("div");
      emp.className = "empty-state";
      var empTx = document.createElement("div");
      empTx.className = "empty-state-text";
      empTx.textContent = t("hist.empty");
      emp.appendChild(empTx);
      wrap.appendChild(emp);
    }

    // -- settings: reminder hour (feeds the Wave 2 shell
    //    detector; travels in the slice — Cycle prefs pattern) --
    var set = document.createElement("div");
    set.className = "history-header";
    var setLab = document.createElement("h3");
    setLab.textContent = t("set.remind");
    set.appendChild(setLab);

    var sel = document.createElement("select");
    sel.className = "reason-input";
    sel.style.minHeight = "0";
    sel.setAttribute("aria-label", t("set.remind"));
    for (var hr = 6; hr <= 22; hr++) {
      var opt = document.createElement("option");
      opt.value = String(hr);
      opt.textContent = pad(hr) + t("set.oclock");
      if (state.prefs.remindHour === hr) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener("change", function () {
      state.prefs.remindHour = parseInt(sel.value, 10);
      state.prefs.mtime = Date.now();
      state.sm = Date.now();
      save();
      showToast(t("saved.pref"));
    });
    set.appendChild(sel);
    wrap.appendChild(set);

    host.appendChild(wrap);
  }

  function render() {
    paintTabs();
    if (viewMode === "history") renderHistory();
    else renderToday();
  }

  // ---------- 6. Sync slice + palette ----------

  var PAL_VARS = ["--bg", "--bg-desktop", "--bar-bg", "--text", "--text-dim",
                  "--accent", "--accent-hover", "--accent-soft",
                  "--panel-bg", "--border", "--shadow"];

  function inheritPalette() {
    try {
      var pRoot = window.parent.document.documentElement;
      document.documentElement.setAttribute("data-theme",
        pRoot.getAttribute("data-theme") || "dark");
      var cs = window.parent.getComputedStyle(pRoot);
      PAL_VARS.forEach(function (v) {
        document.documentElement.style.setProperty(v, cs.getPropertyValue(v).trim());
      });
    } catch (e) { /* standalone — fallback palette stands */ }
  }

  function watchPalette() {
    try {
      new MutationObserver(inheritPalette).observe(
        window.parent.document.documentElement,
        { attributes: true, attributeFilter: ["data-skin", "data-theme"] }
      );
    } catch (e) { /* standalone */ }
  }

  function registerSync() {
    var api = (window.parent && window.parent.orosSync) || window.orosSync;
    if (!api || typeof api.registerSlice !== "function") return;
    api.registerSlice("minimalism", sliceGet, sliceSet, STORAGE_KEY,
      mergeMinimalismStates);
  }

  function sliceGet() {
    var out = JSON.parse(JSON.stringify(state));
    // MD-4: deterministic tombstone pruning (HB-3 pattern). The
    // cutoff derives from the dataset's newest timestamp, never
    // the wall clock — same data yields the same payload on
    // every device at any time. Payload-only: local state
    // keeps everything.
    var maxTs = 0, i;
    for (i = 0; i < (out.days || []).length; i++) {
      if (out.days[i].mtime > maxTs) maxTs = out.days[i].mtime;
    }
    if ((out.prefs || {}).mtime > maxTs) maxTs = out.prefs.mtime;
    Object.keys(out.deleted || {}).forEach(function (id) {
      if (out.deleted[id] > maxTs) maxTs = out.deleted[id];
    });
    var CUTOFF = maxTs - 30 * 24 * 60 * 60 * 1000;
    Object.keys(out.deleted).forEach(function (id) {
      if (out.deleted[id] < CUTOFF) delete out.deleted[id];
    });
    return out;
  }

  function sliceSet(data, info) {
    data = migrate(JSON.parse(JSON.stringify(data || null)));
    if (!data || !Array.isArray(data.days)) return;

    window.__orosSyncApi._suppress = true;
    try {
      state = data;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } finally {
      window.__orosSyncApi._suppress = false;
    }

    // guard drifted state (post-condition of the merge)
    state.days.sort(function (x, y) {
      if (x.date !== y.date) return x.date < y.date ? 1 : -1;
      return x.id < y.id ? -1 : (x.id > y.id ? 1 : 0);
    });

    render();                               // repaint live
    if (info && info.merged) showToast(t("sync.pull"));   // receipt, not save
  }

  // Contract Β: shell-owned combos forward FIRST (capture phase).
  document.addEventListener("keydown", function (e) {
    if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
    var p = window.parent;
    if (!(p && p.orosShortcuts && typeof p.orosShortcuts.handle === "function")) return;
    if (p.orosShortcuts.handle(e)) e.stopPropagation();
  }, true);

  // ---------- 7. Deep link + boot ----------

  // Wave 2 receiver: the shell (__orosOpenMinimalism) calls this
  // on the LIVE iframe; a closed app gets the staged-ymd path at
  // boot below. ymd arrives bare from the DL_BRIDGES router.
  window.__orosMinimalismOpen = function (ymd) {
    if (typeof ymd !== "string") return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return;   // never garbage
    viewMode = "today";
    viewYmd = ymd;
    render();
  };

  var SCRIPT_V = "";
  (function () {
    var m = (document.currentScript && document.currentScript.src || "")
      .match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    document.documentElement.lang = LANG;
    console.log("minimalism.js v" + (SCRIPT_V || "?") + " boot");
  })();

  // MO2: dirty hook BEFORE load() — the fresh-install path calls
  // save() at boot, and the hook must exist by then. Slice
  // registration still comes later: state must exist first.
  window.__orosSyncApi = {
    _suppress: false,
    dirty: function () {
      var api = (window.parent && window.parent.orosSync) || window.orosSync;
      if (this._suppress) return;
      if (api && typeof api.markDirty === "function") api.markDirty();
    }
  };

  load();
  buildSkeleton();
  render();
  registerSync();
  inheritPalette();
  watchPalette();

  // Boot-time deep-link take: the shell staged a ymd (Minimalism
  // was closed when the notification was tapped). Consume exactly
  // ONCE — the parent funnel owns the take when we run in the
  // shell; standalone reads sessionStorage directly.
  var pendingMin = null;
  try {
    if (window.parent && window.parent !== window &&
        typeof window.parent.__orosMinimalismTakePending === "function") {
      pendingMin = window.parent.__orosMinimalismTakePending();
    } else {
      var mid = sessionStorage.getItem("oros-minimalism-open");
      if (mid) {
        sessionStorage.removeItem("oros-minimalism-open");
        pendingMin = mid;
      }
    }
  } catch (e) { pendingMin = null; }
  if (pendingMin) window.__orosMinimalismOpen(pendingMin);

  // Splash removal — the app is up, the loading veil goes.
  // (The 8s fail-safe in index.html is the only other writer.)
  var sp = document.getElementById("min-splash");
  if (sp && sp.parentNode) sp.parentNode.removeChild(sp);

})();