// ============================================================
// calculator.js — orOS Calculator (full rewrite)
// Structure:
//   1. i18n (EN/EL, lazy — normal + troll string packs)
//   2. Palette bridge (inheritPalette / watchPalette, mood.js
//      canonical pattern — CI requirement)
//   3. State + persistence (slice "calculator", LWW + tombstones)
//   4. Engine (standard calculator semantics, full keyboard)
//   5. Troll mode (teasing language ALWAYS, plausible lies ~1/3,
//      never consecutive)
//   6. Rendering (display, keypad, history)
//   7. Sync slice registration (parent orosSync, cache key)
//   8. Contract B forwarding (Ctrl+Alt+Shift shell shortcuts)
//   9. Boot logs, wiring
// Mantras honored: offline first, mobile first, no external
// dependencies, full sync + snapshots + manual/auto export via
// the slice contract (zero shell changes needed).
// ============================================================
(function () {
  "use strict";

  var CALC_VER = "1.0.0";
  var LS_KEY = "oros-calculator-data";   // slice cache key (same as
                                         // radio/mood pattern)
  var HISTORY_MAX = 50;

  // ---------- 1. i18n ----------
  function lang() {
    return (window.orosLang === "el") ? "el" : "en";
  }

  var STRINGS = {
    en: {
      "calc.title": "Calculator",
      "calc.key.ac": "AC",
      "calc.key.back": "Backspace",
      "calc.history": "History",
      "calc.history.clear": "Clear",
      "calc.history.empty": "Nothing here yet.",
      "calc.troll": "Troll mode",
      "calc.troll.on": "On",
      "calc.troll.off": "Off"
    },
    el: {
      "calc.title": "Αριθμομηχανή",
      "calc.key.ac": "AC",
      "calc.key.back": "Πάτημα",
      "calc.history": "Ιστορικό",
      "calc.history.clear": "Καθαρισμός",
      "calc.history.empty": "Τίποτα εδώ ακόμα.",
      "calc.troll": "Λειτουργία πειράγματος",
      "calc.troll.on": "Ενεργό",
      "calc.troll.off": "Ανενεργό"
    }
  };

  // Troll pack — used ONLY when troll mode is on. These REPLACE
  // the display hint strings, so the app talks smack regardless of
  // whether the current result is right or wrong.
  var TROLL_STRINGS = {
    en: {
      "calc.history": "Receipts of my crimes",
      "calc.history.empty": "You haven't annoyed me yet.",
      "calc.troll.hint": "Trust me. I'm a calculator.",
      "toast.true": "Fine, take your correct answer. Nerd.",
      "toast.false.1": "Math is hard. You understand, right?",
      "toast.false.2": "I did the math. Probably. Mostly. Trust me.",
      "toast.false.3": "That's the answer. Any other calculator would agree*.\n*terms apply",
      "toast.false.4": "Rounded for your convenience. Generously.",
      "toast.false.5": "Confidently calculated. Confidence is free."
    },
    el: {
      "calc.history": "Αποδείξεις των εγκλημάτων μου",
      "calc.history.empty": "Δεν με έχεις εκνευρίσει ακόμα.",
      "calc.troll.hint": "Έμπισέ με. Είμαι αριθμομηχανή.",
      "toast.true": "Πάλι καλά που το πήρες σωστό. Φροντισμένος/η.",
      "toast.false.1": "Τα μαθηματικά είναι δύσκολα. Με καταλαβαίνεις, έτσι;",
      "toast.false.2": "Το υπολόγισα. Πιθανόν. Κυρίως. Έμπισέ με.",
      "toast.false.3": "Αυτή είναι η απάντηση. Οποιαδήποτε άλλη αριθμομηχανή θα συμφωνούσε*.\n*με όρους",
      "toast.false.4": "Στρογγυλοποιήθηκε για την ευκολία σου. Γενναιόδωρα.",
      "toast.false.5": "Υπολογίστηκε με σιγουριά. Η σιγουριά είναι δωρεάν."
    }
  };

  function t(key) {
    if (state.troll && TROLL_STRINGS[lang()][key]) {
      return TROLL_STRINGS[lang()][key];
    }
    return STRINGS[lang()][key] || STRINGS.en[key] || key;
  }

  // ---------- 2. Palette bridge (mood.js canonical) ----------
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
        var val = cs.getPropertyValue(v).trim();
        if (val) document.documentElement.style.setProperty(v, val);
      });
    } catch (e) { /* standalone — fallback palette stands */ }
  }

  function watchPalette() {
    try {
      new MutationObserver(function () {
        inheritPalette();
      }).observe(
        window.parent.document.documentElement,
        { attributes: true, attributeFilter: ["data-skin", "data-theme"] }
      );
    } catch (e) { /* standalone */ }
  }

  // ---------- 3. State + persistence ----------
  var state = {
    lang: lang(),
    troll: false,        // travels in the slice
    history: [],         // [{id, expr, res, ts}] newest-first, cap 50
    deleted: {},         // tombstone map (id → ts) for merge
    // --- transient (not persisted) ---
    cur: "0",            // current entry string
    acc: null,           // accumulated value
    op: null,            // pending operator
    fresh: true,         // true = next digit starts fresh
    lastTrolled: false,  // prevents consecutive troll lies
    lastAnswer: null     // reused by keyboard (= on empty entry)
  };

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function readLS() {
    try {
      var raw = JSON.parse(localStorage.getItem(LS_KEY));
      if (!raw || typeof raw !== "object") return null;
      return raw;
    } catch (e) { return null; }
  }

  function persist(notifyParent) {
    var payload = {
      ver: 1,
      troll: !!state.troll,
      history: state.history.slice(0, HISTORY_MAX),
      deleted: state.deleted
    };
    try { localStorage.setItem(LS_KEY, JSON.stringify(payload)); } catch (e) {}
    if (notifyParent) markDirty();
  }

  function hydrate() {
    var raw = readLS();
    if (!raw) {
      // Fresh install — check for a pending remote arrival
      var remote = takePendingRemote();
      if (remote) applyRemote(remote, false);
      return;
    }
    if (typeof raw.troll === "boolean") state.troll = raw.troll;
    if (Array.isArray(raw.history)) {
      state.history = raw.history.filter(function (h) {
        return h && typeof h.expr === "string" &&
               typeof h.res === "string" && !state.deleted[h.id];
      }).slice(0, HISTORY_MAX);
    }
    if (raw.deleted && typeof raw.deleted === "object") state.deleted = raw.deleted;
  }

  // LWW by ts per entry, tombstones honored, cap enforced post-merge.
  function applyRemote(data, notifyUser) {
    if (!data || typeof data !== "object") return 0;
    var local = readLS() || { troll: false, history: [], deleted: {} };
    var remoteDeleted = (data.deleted && typeof data.deleted === "object")
      ? data.deleted : {};
    var mergedDeleted = {};
    var k;
    for (k in local.deleted)  mergedDeleted[k] = local.deleted[k];
    for (k in remoteDeleted)  mergedDeleted[k] = remoteDeleted[k];

    var map = {};
    var push = function (h) {
      if (!h || !h.id || typeof h.ts !== "number") return;
      if (mergedDeleted[h.id]) return;   // tombstone wins
      var prev = map[h.id];
      if (!prev || (h.ts || 0) > (prev.ts || 0)) map[h.id] = h;
    };
    (local.history || []).forEach(push);
    if (Array.isArray(data.history)) data.history.forEach(push);

    var merged = Object.keys(map).map(function (id) { return map[id]; })
      .sort(function (a, b) { return b.ts - a.ts; })
      .slice(0, HISTORY_MAX);

    // Troll pref: LWW by presence of fresher history ts, else keep local
    var newTroll = (typeof data.troll === "boolean")
      ? data.troll : !!local.troll;
    var newDeletedObj = mergedDeleted;
    if (data._deletedMap) newDeletedObj = data._deletedMap;

    state.deleted = newDeletedObj || {};
    state.history = merged;
    state.troll = newTroll;

    var payload = { ver: 1, troll: newTroll, history: merged, deleted: state.deleted };
    try { localStorage.setItem(LS_KEY, JSON.stringify(payload)); } catch (e) {}

    if (notifyUser) {
      transientNote(t("calc.title"),
        lang() === "el" ? "Τα δεδομένα συγχρονίστηκαν." : "Data synced.");
    }
    return merged.length;
  }

  // Pending-remote staging (engine pushes when app is closed)
  var REMOTE_PENDING_KEY = "oros-calculator-remote";
  function stagePendingRemote(data) {
    try {
      localStorage.setItem(REMOTE_PENDING_KEY, JSON.stringify(data));
    } catch (e) {}
  }
  function takePendingRemote() {
    try {
      var raw = localStorage.getItem(REMOTE_PENDING_KEY);
      if (raw) {
        localStorage.removeItem(REMOTE_PENDING_KEY);
        return JSON.parse(raw);
      }
    } catch (e) {}
    return null;
  }

  function markDirty() {
    try {
      var sync = window.parent.orosSync || window.orosSync;
      if (sync && typeof sync.markDirty === "function") sync.markDirty();
    } catch (e) {}
  }

  // ---------- Unified notifications (transient only — this app
  // has no reminders, so nothing ever enters the inbox) ----------
  function transientNote(title, body) {
    try {
      var N = window.parent.orosNotifs || window.orosNotifs;
      if (N && typeof N.transient === "function") {
        N.transient({ ns: "calculator", title: title, body: body });
        return;
      }
    } catch (e) {}
    // Fallback: console (standalone or stale bundle)
    console.log("[calc]", title, "—", body);
  }

  // ---------- 4. Engine ----------
  var OPS = {
    add: function (a, b) { return a + b; },
    sub: function (a, b) { return a - b; },
    mul: function (a, b) { return a * b; },
    div: function (a, b) { return a / b; }
  };
  var OP_GLYPH = { add: "+", sub: "−", mul: "×", div: "÷" };

  function numToString(n) {
    if (!isFinite(n)) return "Error";
    // Strip float noise: 0.1+0.2 → 0.3
    var s = String(parseFloat(n.toPrecision(12)));
    return s;
  }

  function fmtDisplay(s) {
    // Group integer part with thin spaces (locale-friendly)
    if (s === "Error" || s === "-" ) return s;
    var neg = s.charAt(0) === "-";
    var body = neg ? s.slice(1) : s;
    var parts = body.split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    return (neg ? "-" : "") + parts.join(".");
  }

  function computePending() {
    if (state.op === null || state.acc === null) return null;
    var b = parseFloat(state.cur);
    if (isNaN(b)) return null;
    var r = OPS[state.op](state.acc, b);
    if (!isFinite(r)) return "Error";
    return r;
  }

  function pressDigit(d) {
    if (state.fresh) {
      state.cur = d;
      state.fresh = false;
    } else {
      if (state.cur.replace("-", "").replace(".", "").length >= 15) return;
      if (d === "." ) {
        if (state.cur.indexOf(".") !== -1) return;
        state.cur = state.cur === "" ? "0." : state.cur + ".";
      } else {
        state.cur = state.cur === "0" ? d : state.cur + d;
      }
    }
    render();
  }

  function pressOp(op) {
    if (state.op !== null && state.acc !== null && !state.fresh) {
      // Chain: 2 + 3 + → evaluate first
      var r = computePending();
      if (r === "Error") { renderError(); return; }
      state.acc = r;
      state.cur = numToString(r);
    } else {
      state.acc = parseFloat(state.cur);
      if (isNaN(state.acc)) state.acc = 0;
    }
    state.op = op;
    state.fresh = true;
    render();
  }

  function pressEq() {
    if (state.op === null || state.acc === null) {
      // Bare "=" on a fresh number — troll still comments
      if (state.troll && state.cur !== "0") {
        trollToast(true);
      }
      return;
    }
    var a = state.acc;
    var op = state.op;
    var b = parseFloat(state.cur);
    if (isNaN(b)) b = 0;

    var exprStr = fmtDisplay(numToString(a)) + " " + OP_GLYPH[op] + " " +
                  fmtDisplay(String(b));

    var result = OPS[op](a, b);
    var shown = (isFinite(result)) ? numToString(result) : "Error";

    var lied = false;
    if (state.troll && isFinite(result) && shouldLie()) {
      shown = numToString(applyLie(result));
      lied = true;
      state.lastTrolled = true;
    } else if (state.troll) {
      state.lastTrolled = false;
    }

    // History entry (skip pure-error results)
    if (shown !== "Error") {
      state.history.unshift({
        id: uid(),
        expr: exprStr,
        res: shown,
        ts: Date.now(),
        lied: lied    // local-only annotation, merges fine (unused by
                      // other devices for decisions)
      });
      if (state.history.length > HISTORY_MAX) {
        state.history.length = HISTORY_MAX;
      }
      persist(true);
      renderHistory();
    }

    state.cur = shown;
    state.acc = null;
    state.op = null;
    state.fresh = true;
    state.lastAnswer = shown;

    render();

    if (state.troll) trollToast(!lied);
  }

  function pressAc() {
    state.cur = "0";
    state.acc = null;
    state.op = null;
    state.fresh = true;
    render();
  }

  function pressBack() {
    if (state.fresh) { pressAc(); return; }
    state.cur = state.cur.slice(0, -1);
    if (state.cur === "" || state.cur === "-") state.cur = "0";
    render();
  }

  function pressSign() {
    if (state.cur === "0") return;
    if (state.cur.charAt(0) === "-") state.cur = state.cur.slice(1);
    else state.cur = "-" + state.cur;
    render();
  }

  function pressPercent() {
    // Binary %: reduces b relative to a (iOS/Android semantics):
    // 200 + 10% → 220 ; unary on fresh entry: 50% → 0.5
    if (state.op !== null && state.acc !== null && !state.fresh) {
      var b = parseFloat(state.cur);
      state.cur = numToString(state.acc * b / 100);
    } else {
      var v = parseFloat(state.cur);
      if (!isNaN(v)) state.cur = numToString(v / 100);
    }
    render();
  }

  function reuseHistory(id) {
    for (var i = 0; i < state.history.length; i++) {
      if (state.history[i].id === id) {
        state.cur = state.history[i].res;
        state.fresh = true;
        state.acc = null;
        state.op = null;
        render();
        return;
      }
    }
  }

  function clearHistory() {
    var now = Date.now();
    state.history.forEach(function (h) {
      state.deleted[h.id] = now;   // tombstone — survives merge, travels
    });
    state.history = [];
    persist(true);
    renderHistory();
  }

  // ---------- 5. Troll logic ----------
  // Lie cadence: ~1 in 3 evaluations, NEVER two consecutive lies.
  // If the last evaluation trolled, this one is honest.
  function shouldLie() {
    if (state.lastTrolled) return false;
    return Math.random() < 0.34;
  }

  // Plausible lie: off by a small relative error (1–6%).
  function applyLie(result) {
    var magnitude = Math.abs(result);
    if (magnitude === 0) return result + (Math.random() < 0.5 ? 1 : -1);
    var pct = 0.01 + Math.random() * 0.05;           // 1%–6%
    var sign = Math.random() < 0.5 ? 1 : -1;
    var lied = result + sign * pct * magnitude;
    // Round to a "believable" precision (never surgically identical)
    return parseFloat(lied.toPrecision(
      Math.max(2, String(Math.round(magnitude)).length + 1)));
  }

  // In troll mode, EVERY action gets commentary — even the honest
  // answers. Snark always; only the TRUTH varies.
  function trollToast(honest) {
    var pack = TROLL_STRINGS[lang()];
    var key;
    if (honest) {
      key = "toast.true";
    } else {
      var pool = ["toast.false.1", "toast.false.2", "toast.false.3",
                  "toast.false.4", "toast.false.5"];
      key = pool[Math.floor(Math.random() * pool.length)];
    }
    transientNote(pack[key], "");
  }

  function toggleTroll() {
    state.troll = !state.troll;
    persist(true);
    render();
    if (state.troll) {
      transientNote(t("calc.troll"),
        lang() === "el"
          ? "Θα σε φροντίσω… με τον δικό μου τρόπο."
          : "I'll take good care of you… my way.");
    }
  }

  // ---------- 6. Rendering ----------
  var els = {};

  function render() {
    // Display
    els.expr.textContent = (state.op !== null && state.acc !== null)
      ? fmtDisplay(numToString(state.acc)) + " " + OP_GLYPH[state.op] +
        (state.fresh ? "" : " " + fmtDisplay(state.cur))
      : "";
    els.res.textContent = fmtDisplay(state.cur);

    // Troll flavor on the display itself
    if (state.troll) {
      els.root.setAttribute("data-troll", "on");
      els.res.title = t("calc.troll.hint");
    } else {
      els.root.removeAttribute("data-troll");
      els.res.title = "";
    }

    // Toggle button state
    els.trollToggle.setAttribute("aria-pressed", state.troll ? "true" : "false");
    els.trollState.textContent = state.troll ? t("calc.troll.on") : t("calc.troll.off");

    applyI18nText();
  }

  function applyI18nText() {
    var nodes = document.querySelectorAll("[data-i18n]");
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].textContent = t(nodes[i].getAttribute("data-i18n"));
    }
  }

  function renderHistory() {
    els.historyList.innerHTML = "";
    var frag = document.createDocumentFragment();
    state.history.forEach(function (h) {
      var li = document.createElement("li");
      li.dataset.id = h.id;

      var expr = document.createElement("div");
      expr.className = "h-expr";
      expr.textContent = h.expr + " =";

      var res = document.createElement("div");
      res.className = "h-res";
      res.textContent = fmtDisplay(h.res);

      li.appendChild(expr);
      li.appendChild(res);
      li.addEventListener("click", function () {
        reuseHistory(this.dataset.id);
      });
      frag.appendChild(li);
    });
    els.historyList.appendChild(frag);
    els.historyEmpty.hidden = state.history.length > 0;
  }

  // ---------- 7. Sync slice registration ----------
  function registerSlice() {
    try {
      var sync = window.parent.orosSync;
      if (!sync || typeof sync.registerSlice !== "function") return;
      sync.registerSlice("calculator", sliceGet, sliceSet, LS_KEY);
      console.log("[calc] slice registered: calculator");
    } catch (e) {
      console.warn("[calc] slice registration skipped (standalone?)");
    }
  }

  function sliceGet() {
    return readLS();
  }

  function sliceSet(data) {
    if (!data) return;
    applyRemote(data, false);
    render();
    renderHistory();
  }

  // ---------- 8. Contract B forwarding ----------
  function wireShortcutForwarding() {
    document.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && e.altKey && e.shiftKey) {
        try {
          if (window.parent.orosShortcuts &&
              typeof window.parent.orosShortcuts.handle === "function") {
            if (window.parent.orosShortcuts.handle(e)) {
              e.preventDefault();
              e.stopPropagation();
            }
          }
        } catch (e2) {}
      }
    }, true);   // capture phase — shell combos never reach app logic
  }

  // ---------- 9. Keyboard (app-level) ----------
  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var k = e.key;
    if (k >= "0" && k <= "9") { pressDigit(k); }
    else if (k === "." || k === ",") { pressDigit("."); }
    else if (k === "+") { pressOp("add"); }
    else if (k === "-") { pressOp("sub"); }
    else if (k === "*") { pressOp("mul"); }
    else if (k === "/") { pressOp("div"); e.preventDefault(); }
    else if (k === "Enter" || k === "=") {
      pressEq();
      flashEq();
      e.preventDefault();
    }
    else if (k === "Backspace") { pressBack(); e.preventDefault(); }
    else if (k === "Escape") { pressAc(); }
    else if (k === "%") { pressPercent(); }
    else if (k === "Delete") { pressAc(); }
  }

  function flashEq() {
    var eq = document.querySelector('.key[data-k="eq"]');
    if (!eq) return;
    eq.classList.add("flash");
    setTimeout(function () { eq.classList.remove("flash"); }, 120);
  }

  // ---------- Boot ----------
  function wireUI() {
    els.root = document.getElementById("calc-root");
    els.expr = document.getElementById("calc-expr");
    els.res = document.getElementById("calc-res");
    els.trollToggle = document.getElementById("troll-toggle");
    els.trollState = document.getElementById("troll-state");
    els.historyList = document.getElementById("calc-history");
    els.historyEmpty = document.getElementById("history-empty");

    document.getElementById("calc-pad").addEventListener("click", function (e) {
      var btn = e.target.closest("button.key");
      if (!btn) return;
      var k = btn.dataset.k;
      if (OPS[k]) pressOp(k);
      else if (k === "eq") { pressEq(); flashEq(); }
      else if (k === "ac") pressAc();
      else if (k === "back") pressBack();
      else if (k === "sign") pressSign();
      else if (k === "pcnt") pressPercent();
      else if (k === "dot") pressDigit(".");
      else pressDigit(k);
    });

    els.trollToggle.addEventListener("click", toggleTroll);
    document.getElementById("history-clear").addEventListener("click", clearHistory);

    document.addEventListener("keydown", onKey);
  }

  function boot() {
    inheritPalette();   // before first paint — correct contrast frame 1
    watchPalette();
    hydrate();
    wireUI();
    wireShortcutForwarding();
    registerSlice();
    render();
    renderHistory();

    console.log("[calc] calculator v" + CALC_VER + " booted — troll:" +
      (state.troll ? "on" : "off") + " history:" + state.history.length);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();