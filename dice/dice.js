// ============================================================
// orOS Dice & Coin — App logic
// New in v0.4 (merge-aware sync):
//   - history entries carry uid + ts, merged by union-by-id
//     then sorted by ts ascending, trimmed to cap 50
//   - soft deletes: state.deleted = { <entryId>: ts } tombstones,
//     pruned after 30 days (same contract as To-Do)
//   - coinStats (heads/tails counts) are DERIVED from the merged
//     history on load/render — never stored directly, zero merge
//     conflicts on counters
//   - Clear history → tombstone all entries, trim to 0
// Carried over from Soffitta inspiration:
//   - dice builder (count 1–30, type d4–d100, modifier -99 to +99)
//   - 4 modes: Normal / Keep Highest / Keep Lowest / Drop Lowest
//   - Crit/Fumble badges (any die type: max=crit, 1=fumble)
//   - Coin flip with 3D animation + persistent stats
//   - History: 50 entries, full timestamp (EL: ηη/μμ/εεεε HH:MM)
//   - Clipboard share (plain text card)
//   - Keyboard: Space=roll, C=coin (scoped to app window)
// Sections:
//   1. Constants, i18n, helpers
//   2. Data model, storage, migration, IDs
//   2b. Cross-device merge engine (union by id + trim)
//   3. RNG (crypto.getRandomValues + rejection sampling)
//   4. Roll logic + crit/fumble detection
//   5. Coin flip (animation + state update)
//   6. Render: result box + dice row + badges
//   7. Render: history list
//   8. Clipboard share
//   9. Keyboard handlers (scoped)
//  10. Undo / toast
//  11. Sync slice (Dropbox, merge-registered) + palette
//  12. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY = "oros-dice-data";
  var DATA_VER = 1;
  var HISTORY_CAP = 50;
  var TOMB_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;   // 30 days

  // ---------- 1. Constants, i18n, helpers ----------
  var LANG = localStorage.getItem("oros-lang") === "el" ? "el" : "en";

  var STRINGS = {
    en: {
      "builder.count":     "Count",
      "builder.type":      "Type",
      "builder.modifier":  "Modifier",
      "mode.normal":       "Normal",
      "mode.keepHigh":     "Keep Highest",
      "mode.keepLow":      "Keep Lowest",
      "mode.dropLow":      "Drop Lowest",
      "actions.roll":      "Roll",
      "actions.coin":      "Flip Coin",
      "result.none":       "Press Roll to start",
      "result.notation":   "{count}{type}{modifier}",
      "result.total":      "Total: {total}",
      "result.dice":       "Dice: {dice}",
      "coin.heads":        "Heads",
      "coin.tails":        "Tails",
      "history.title":     "History",
      "history.share":     "Share",
      "history.clear":     "Clear",
      "history.empty":     "No rolls yet",
      "badge.crit":        "MAX!",
      "badge.fumble":      "Fumble",
      "toast.share":       "Copied to clipboard",
      "toast.cleared":     "History cleared",
      "confirm.cleared":   "Clear all history?",
      "confirm.no":        "Cancel",
      "share.card":        "🎲 Dice & Coin — {time}\n{notation} → {total}\n{details}\n\nvia orOS",
      "toast.merged":      "Synced changes from another device"
    },
    el: {
      "builder.count":     "Πλήθος",
      "builder.type":      "Τύπος",
      "builder.modifier":  "Διόρθωση",
      "mode.normal":       "Κανονικό",
      "mode.keepHigh":     "Κράτα Υψηλά",
      "mode.keepLow":      "Κράτα Χαμηλά",
      "mode.dropLow":      "Πέτα Χαμηλό",
      "actions.roll":      "Ρίξε",
      "actions.coin":      "Ρίξε Κέρμα",
      "result.none":       "Πάτα Ρίξε για ξεκίνημα",
      "result.notation":   "{count}{type}{modifier}",
      "result.total":      "Σύνολο: {total}",
      "result.dice":       "Ζάρια: {dice}",
      "coin.heads":        "Κεφάλια",
      "coin.tails":        "Γράμματα",
      "history.title":     "Ιστορικό",
      "history.share":     "Μοιραστείτε",
      "history.clear":     "Καθαρισμός",
      "history.empty":     "Καμία ρίψη ακόμα",
      "badge.crit":        "MAX!",
      "badge.fumble":      "Fumble",
      "toast.share":       "Αντιγράφηκε στο πρόχειρο",
      "toast.cleared":     "Το ιστορικό εκκαθαρίστηκε",
      "confirm.cleared":   "Εκκαθάριση όλου του ιστορικού;",
      "confirm.no":        "Άκυρο",
      "share.card":        "🎲 Ζάρια & Κέρμα — {time}\n{notation} → {total}\n{details}\n\nvia orOS",
      "toast.merged":      "Συγχρονίστηκαν αλλαγές από άλλη συσκευή"
    }
  };

  function t(key, params) {
    var p = STRINGS[LANG] || STRINGS.en;
    var str = p[key] !== undefined ? p[key] : (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
    if (params) {
      Object.keys(params).forEach(function (k) {
        str = str.replace(new RegExp("\\{" + k + "\\}", "g"), params[k]);
      });
    }
    return str;
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function $(id) { return document.getElementById(id); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function fmtTimestamp(ts) {
    var d = new Date(ts);
    var loc = LANG === "el" ? "el-GR" : "en-GB";
   var dateStr = d.toLocaleDateString(loc, { day: "2-digit", month: "2-digit", year: "numeric" });
    var timeStr = d.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit", hour12: false });
    return dateStr + " " + timeStr;
  }

  // BOOT MARKER
  var SCRIPT_V = "";
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    document.documentElement.lang = LANG;
    console.log("dice.js v" + (SCRIPT_V || "?") + " boot");
  })();

  // ---------- 2. Data model, storage, migration ----------
  // state = {
  //   ver: 1,
  //   sm: <root mtime>,
  //   deleted: { <historyId>: ts },   // tombstones for clear history
  //   history: [{ id, kind, ...data, ts }]
  // }
  // coinStats derived on render: count heads/tails from non-tombstoned history
  var state = null;
  var lastResult = null;

  function touch() { state.sm = Date.now(); }
  function tombstone(id) {
    if (!state.deleted) state.deleted = {};
    state.deleted[id] = Date.now();
  }
  function pruneTombstones(st) {
    var cutoff = Date.now() - TOMB_LIFETIME_MS;
    Object.keys(st.deleted || {}).forEach(function (id) {
      if (st.deleted[id] < cutoff) delete st.deleted[id];
    });
  }

  function defaultState() {
    return { ver: DATA_VER, sm: 0, deleted: {}, history: [] };
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var data = JSON.parse(raw);
        if (data && Array.isArray(data.history)) {
          state = data;
          pruneTombstones(state);
          return;
        }
      }
    } catch (e) { /* corrupted → fresh start */ }
    state = defaultState();
    save();
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { /* quota */ }
    if (window.__orosSyncApi) window.__orosSyncApi.dirty();
  }

  function scheduleRender() {
    requestAnimationFrame(function () {
      renderResult();
      renderHistory();
      renderCoinStats();
    });
  }

  // ---------- 2b. Merge engine (union by id + trim) ----------
  function mergeDiceStates(A, B) {
    var a = A || {}, b = B || {};
    var tomb = {};
    var aDel = a.deleted || {}, bDel = b.deleted || {};
    Object.keys(aDel).forEach(function (id) { tomb[id] = aDel[id]; });
    Object.keys(bDel).forEach(function (id) {
      tomb[id] = Math.max(tomb[id] || 0, bDel[id]);
    });
    // Pruning based on max mtime from history (deterministic, not wall-clock)
    var maxMtime = 0;
    (a.history || []).forEach(function (h) { if (h.mtime && h.mtime > maxMtime) maxMtime = h.mtime; });
    (b.history || []).forEach(function (h) { if (h.mtime && h.mtime > maxMtime) maxMtime = h.mtime; });
    // Fallback to max ts if mtime missing, but prefer mtime as per data model contract
    var cutoff = (maxMtime > 0 ? maxMtime : (arr.reduce(function(m, h){ return h.ts > m ? h.ts : m; }, 0))) - TOMB_LIFETIME_MS;
    Object.keys(tomb).forEach(function (id) {
      if (tomb[id] < cutoff) delete tomb[id];
    });

    var map = {};
    (a.history || []).forEach(function (h) { map[h.id] = h; });
    (b.history || []).forEach(function (h) {
      var existing = map[h.id];
      if (!existing) {
        map[h.id] = h;
      } else {
        var tsCompare = (h.ts || 0) - (existing.ts || 0);
        if (tsCompare > 0) {
          map[h.id] = h;
        } else if (tsCompare < 0) {
          // keep existing
        } else {
          // tie: lexicographic id comparison (deterministic)
          map[h.id] = (h.id < existing.id) ? h : existing;
        }
      }
    });

    var arr = [];
    Object.keys(map).forEach(function (id) {
      if (tomb[id] === undefined || (map[id].ts || 0) > tomb[id]) {
        arr.push(map[id]);
      }
    });

    arr.sort(function (x, y) { return (y.ts || 0) - (x.ts || 0); });  // newest first (canonical)
    if (arr.length > HISTORY_CAP) arr = arr.slice(0, HISTORY_CAP);     // trim oldest (tail)

    var out = {
      ver: DATA_VER,
      sm: Math.max(a.sm || 0, b.sm || 0),
      deleted: tomb,
      history: arr
    };
    if (out.history.length === 0 && out.sm === 0) return null;
    return out;
  }

  // ---------- 3. RNG (crypto.getRandomValues) ----------
  function randInt(min, max) {
    var range = max - min + 1;
    var array = new Uint32Array(1);
    while (true) {
      crypto.getRandomValues(array);
      var val = array[0] % range;
      if (val < (0xFFFFFFFF - (0xFFFFFFFF % range))) {
        return min + val;
      }
    }
  }

  // ---------- 4. Roll logic ----------
  function getCurrentMode() {
    var btn = document.querySelector("#modes .mode-btn.active");
    return btn ? btn.dataset.mode : "normal";
  }

  function rollDice() {
    var count = Math.min(30, Math.max(1, parseInt($("dice-count").value, 10) || 1));
    var type = parseInt($("dice-type").value, 10);
    var mod = parseInt($("dice-mod").value, 10) || 0;
    var mode = getCurrentMode();

    var rolls = [];
    for (var i = 0; i < count; i++) {
      rolls.push(randInt(1, type));
    }

    var processed = rolls.slice();
    var dropCount = 0;

    // kept[i] — μετράει το ζάρι i στο σύνολο;
    // δείκτης-βάσει (όχι τιμή-βάσει) για σωστή αντιμετώπιση ισοβαθμιών
    var kept = rolls.map(function () { return true; });

    if (mode === "drop-low" && count >= 2) {
      var lowIdx = 0;
      for (var d = 1; d < count; d++) if (rolls[d] < rolls[lowIdx]) lowIdx = d;
      kept[lowIdx] = false;
    } else if (mode === "keep-high" && count >= 2) {
      kept = rolls.map(function () { return false; });
      var hiIdx = 0;
      for (var h = 1; h < count; h++) if (rolls[h] > rolls[hiIdx]) hiIdx = h;
      kept[hiIdx] = true;
    } else if (mode === "keep-low" && count >= 2) {
      kept = rolls.map(function () { return false; });
      var loIdx = 0;
      for (var l = 1; l < count; l++) if (rolls[l] < rolls[loIdx]) loIdx = l;
      kept[loIdx] = true;
    }

    var total = mod;
    rolls.forEach(function (v, i) { if (kept[i]) total += v; });

    var notation = count + "d" + type;
    if (mod !== 0) notation += (mod > 0 ? "+" : "") + mod;
    if (mode !== "normal") notation += " (" + mode.replace("-", " ") + ")";

    var isCrit = false, isFumble = false;
    if (count === 1) {
      if (rolls[0] === type) isCrit = true;
      if (rolls[0] === 1) isFumble = true;
    } else if (rolls.every(function (r) { return r === type; })) {
      isCrit = true;
    }

    var now = Date.now();
    var entry = {
      id: uid(),
      kind: "dice",
      notation: notation,
      total: total,
      rolls: rolls,
      kept: kept,
      type: type,
      mod: mod,
      mode: mode,
      isCrit: isCrit,
      isFumble: isFumble,
      ts: now,
      mtime: now
    };

    lastResult = entry;
    state.history.unshift(entry);
    if (state.history.length > HISTORY_CAP) {
      var removed = state.history.splice(HISTORY_CAP);
      removed.forEach(function (h) { tombstone(h.id); });
    }
    touch();
    save();
    scheduleRender();
  }

  // ---------- 5. Coin flip ----------
  function flipCoin() {
    var coin = $("coin");
    if (coin.classList.contains("flipping")) return;   // debounce mid-flip
    coin.classList.add("flipping");

    var result = randInt(0, 1) === 0 ? "heads" : "tails";
    var turns = randInt(3, 6) * 360;
    coin.style.setProperty("--flip-turns", turns + "deg");

    setTimeout(function () {
      coin.classList.remove("flipping");
      var finalRot = result === "heads" ? 0 : 180;
      coin.style.transform = "rotateY(" + finalRot + "deg)";

      var now = Date.now();
      var entry = {
        id: uid(),
        kind: "coin",
        result: result,
        ts: now,
        mtime: now
      };
      state.history.unshift(entry);
      if (state.history.length > HISTORY_CAP) {
        var removed = state.history.splice(HISTORY_CAP);
        removed.forEach(function (h) { tombstone(h.id); });
      }
      touch();
      save();
      scheduleRender();
    }, 1000);
  }

  // ---------- 6. Render: result box ----------
  function renderResult() {
    var notationEl = $("result-notation");
    var totalEl = $("result-total");
    var diceRow = $("result-dice-row");
    var critBadge = $("crit-badge");
    var fumbleBadge = $("fumble-badge");

    if (!lastResult) {
      notationEl.textContent = t("result.none");
      totalEl.textContent = "";
      diceRow.innerHTML = "";
      critBadge.hidden = true;
      fumbleBadge.hidden = true;
      return;
    }

    if (lastResult.kind === "dice") {
      notationEl.textContent = lastResult.notation;
      totalEl.textContent = t("result.total", { total: lastResult.total });
      diceRow.innerHTML = "";
      lastResult.rolls.forEach(function (val, idx) {
        var die = document.createElement("span");
        die.className = "die";
        if (lastResult.kept && !lastResult.kept[idx]) die.classList.add("dropped");
        if (val === lastResult.type) die.classList.add("crit");   // max face
        die.textContent = val;
        diceRow.appendChild(die);
      });
      critBadge.hidden = !lastResult.isCrit;
      fumbleBadge.hidden = !lastResult.isFumble;
    } else {
      notationEl.textContent = t("result.none");
      totalEl.textContent = lastResult.result === "heads" ? "H" : "T";
      diceRow.innerHTML = "";
      critBadge.hidden = true;
      fumbleBadge.hidden = true;
    }
  }

  // ---------- 7. Render: history ----------
  function renderCoinStats() {
    var heads = 0, tails = 0;
    state.history.forEach(function (h) {
      if (state.deleted[h.id]) return;
      if (h.kind === "coin") {
        if (h.result === "heads") heads++;
        else if (h.result === "tails") tails++;
      }
    });
    $("heads-count").textContent = String(heads);
    $("tails-count").textContent = String(tails);
  }

  function renderHistory() {
    var list = $("history-list");
    var empty = $("history-empty");
    list.innerHTML = "";

    var visible = state.history.filter(function (h) {
      return !state.deleted[h.id];
    });

    if (visible.length === 0) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    visible.forEach(function (h) {
      var li = document.createElement("li");
      li.className = "hist-entry";

      var kind = document.createElement("span");
      kind.className = "hist-kind" + (h.kind === "coin" ? " coin" : "");
      kind.textContent = h.kind === "coin" ? "◎" : "⚄";
      li.appendChild(kind);

      var body = document.createElement("div");
      body.className = "hist-body";

      var main = document.createElement("div");
      main.className = "hist-main";
      if (h.kind === "dice") {
        main.textContent = h.notation;
      } else {
        main.textContent = t(h.result === "heads" ? "coin.heads" : "coin.tails");
      }
      body.appendChild(main);

      var sub = document.createElement("div");
      sub.className = "hist-sub";
      if (h.kind === "dice" && h.rolls) {
        sub.textContent = t("result.dice", { dice: h.rolls.join(", ") });
      }
      body.appendChild(sub);

      var time = document.createElement("span");
      time.className = "hist-time";
      time.textContent = fmtTimestamp(h.ts);
      body.appendChild(time);

      li.appendChild(body);

      if (h.kind === "dice") {
        var tot = document.createElement("span");
        tot.className = "hist-total";
        tot.textContent = String(h.total);
        li.appendChild(tot);
      }

      list.appendChild(li);
    });
  }

  // ---------- 8. Clipboard share ----------
  function shareResult() {
    if (!lastResult) return;
    var time = fmtTimestamp(lastResult.ts);
    var details = "";
    if (lastResult.kind === "dice") {
      details = t("result.dice", { dice: lastResult.rolls.join(", ") });
      if (lastResult.isCrit) details += " — Max!";
      if (lastResult.isFumble) details += " — Fumble";
    } else {
      details = lastResult.result === "heads" ? "Heads" : "Tails";
    }

    var card = t("share.card", {
      time: esc(time),
      notation: esc(lastResult.kind === "dice" ? lastResult.notation : "Coin"),
      total: esc(String(lastResult.kind === "dice" ? lastResult.total : "")),
      details: esc(details)
    });

    navigator.clipboard.writeText(card).then(function () {
      showToast(t("toast.share"), false);
    }).catch(function () {
      showToast("Copy failed", false);
    });
  }

  // ---------- 9. Keyboard handlers ----------
  function wireKeyboard() {
    // Scoped app shortcuts (Space=roll, C=coin) — ignore inputs, ignore modifiers
    document.addEventListener("keydown", function (e) {
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;   // never steal OS combos
      if (e.code === "Space") {
        e.preventDefault();
        rollDice();
      } else if (e.key === "c" || e.key === "C") {
        e.preventDefault();
        flipCoin();
      }
    });

    // Contract Β: forward Ctrl+Alt+Shift shortcuts to shell (capture phase)
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
      var p = window.parent;
      if (!(p && p.orosShortcuts && typeof p.orosShortcuts.handle === "function")) return;
      if (p.orosShortcuts.handle(e)) e.stopPropagation();
    }, true);  // capture phase
  }

  // ---------- 10. Undo / toast ----------
  var toastTimer = null;

  function showToast(text) {
    var el = $("toast");
    el.innerHTML = "";
    el.classList.remove("show");

    var span = document.createElement("span");
    span.textContent = text;
    el.appendChild(span);

    void el.offsetWidth;
    el.classList.add("show");

    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, 5000);
  }

  function confirmDialog(msgKey, onYes) {
    var stale = document.getElementById("dice-confirm");
    if (stale) stale.remove();

    var dlg = document.createElement("dialog");
    dlg.id = "dice-confirm";
    dlg.style.cssText =
      "border:1px solid var(--border);border-radius:12px;" +
      "background:var(--panel-bg);color:var(--text);padding:18px;" +
      "width:min(340px,calc(100vw - 32px));";

    var form = document.createElement("form");
    form.method = "dialog";

    var msg = document.createElement("div");
    msg.style.cssText = "font-size:13px;line-height:1.5;margin-bottom:16px;";
    msg.textContent = t(msgKey);
    form.appendChild(msg);

    var row = document.createElement("div");
    row.style.cssText = "display:flex;gap:8px;justify-content:flex-end;";

    var no = document.createElement("button");
    no.type = "button";
    no.style.cssText =
      "border:1px solid var(--border);border-radius:7px;background:transparent;" +
      "color:var(--text-dim);padding:7px 14px;font-size:12.5px;font-weight:600;" +
      "cursor:pointer;";
    no.textContent = t("confirm.no");
    no.addEventListener("click", function () { dlg.close(); });
    row.appendChild(no);

    var yes = document.createElement("button");
    yes.type = "submit";
    yes.style.cssText =
      "border:1px solid var(--danger);border-radius:7px;background:transparent;" +
      "color:var(--danger);padding:7px 14px;font-size:12.5px;font-weight:600;" +
      "cursor:pointer;";
    yes.textContent = t("history.clear");
    row.appendChild(yes);

    form.appendChild(row);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      dlg.close();
      onYes();
    });
    dlg.appendChild(form);
    dlg.addEventListener("click", function (e) {
      if (e.target === dlg) dlg.close();
    });
    document.body.appendChild(dlg);
    dlg.showModal();
    setTimeout(function () { no.focus(); }, 50);
  }

  function clearHistory() {
    confirmDialog("confirm.cleared", function () {
      state.history.forEach(function (h) { tombstone(h.id); });
      state.history = [];
      lastResult = null;
      touch();
      save();
      scheduleRender();
      showToast(t("toast.cleared"), false);
    });
  }

  // ---------- 11. Sync slice + palette ----------
  var PAL_VARS = ["--bg", "--bg-desktop", "--bar-bg", "--text", "--text-dim",
                  "--accent", "--accent-hover", "--accent-soft",
                  "--panel-bg", "--border", "--shadow", "--danger"];

  function inheritPalette() {
    try {
      var pRoot = window.parent.document.documentElement;
      document.documentElement.setAttribute("data-theme",
        pRoot.getAttribute("data-theme") || "dark");
      var cs = window.parent.getComputedStyle(pRoot);
      PAL_VARS.forEach(function (v) {
        document.documentElement.style.setProperty(v, cs.getPropertyValue(v).trim());
      });
    } catch (e) { /* standalone */ }
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
    window.__orosSyncApi = {
      _suppress: false,
      dirty: function () {
        if (this._suppress) return;
        if (api && typeof api.markDirty === "function") api.markDirty();
      }
    };
    if (!api || typeof api.registerSlice !== "function") return;
    api.registerSlice("dice", sliceGet, sliceSet, "oros-dice-data", mergeDiceStates);
  }

  function sliceGet() {
    return JSON.parse(JSON.stringify(state));
  }

  function sliceSet(data, info) {
    if (!data || !Array.isArray(data.history)) return;
    window.__orosSyncApi._suppress = true;
    try {
      state = data;
      pruneTombstones(state);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    scheduleRender();
    // No toast on merge — sync feedback = taskbar dot only (Bible doctrine)
  }

  // ---------- 12. Wiring & boot ----------
  function paintStaticAria() {
    var pairs = [
      ["roll-btn", "actions.roll"],
      ["coin-btn", "actions.coin"]
    ];
    pairs.forEach(function (pair) {
      var el = $(pair[0]);
      if (!el) return;
      el.setAttribute("aria-label", t(pair[1]));
      el.setAttribute("title", t(pair[1]));
    });
  }

  function wire() {
    [].forEach.call(document.querySelectorAll("#modes .mode-btn"), function (btn) {
      btn.addEventListener("click", function () {
        var cur = document.querySelector("#modes .mode-btn.active");
        if (cur) cur.classList.remove("active");
        btn.classList.add("active");
      });
    });
    $("roll-btn").addEventListener("click", rollDice);
    $("coin-btn").addEventListener("click", flipCoin);
    $("coin").addEventListener("click", flipCoin);
    $("coin").addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flipCoin(); }
    });
    $("history-clear").addEventListener("click", clearHistory);
    $("share-btn").addEventListener("click", shareResult);

    wireKeyboard();
    paintStaticAria();
  }

  // ---------- Boot ----------
  load();
  inheritPalette();
  watchPalette();
  wire();
  registerSync();
  scheduleRender();
})();