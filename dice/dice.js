// ============================================================
// orOS Dice & Coin — App logic
// New in v0.4 (merge-aware sync):
//   - history entries carry id + ts + mtime, merged by union-by-id,
//     LWW by ts with lexicographic JSON tie-break (R5), sorted
//     newest-first, trimmed to cap 50
//   - soft deletes: state.deleted = { <entryId>: ts } tombstones,
//     pruned deterministically on dataset max mtime - 30 days
//     (Storage/Quote doctrine — never wall-clock)
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
  var DATA_VER = 2;   // v2: + presets[]
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
      "coin.face.heads":   "H",
      "coin.face.tails":   "T",
      "share.coin":        "Coin",
      "toast.copyfail":    "Copy failed",
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
      "notation.placeholder": "2d20+5 · 4d6 dl · 8d6 kh",
      "notation.apply":    "Apply",
      "notation.bad":      "Unknown notation",
      "presets.add":       "Save preset",
      "presets.prompt":    "Preset name",
      "presets.saved":     "Preset saved",
      "presets.deleted":   "Preset deleted",
      "history.stats":     "Stats",
      "history.export":    "Export",
      "stats.title":       "Statistics",
      "stats.dicerolls":   "Dice rolls",
      "stats.coinflips":   "Coin flips",
      "stats.avg":         "avg {v}",
      "stats.crits":       "Max rolls",
      "stats.fumbles":     "Fumbles",
      "stats.empty":       "No data yet",
      "export.done":       "History exported",
      "export.filename":   "oros-dice-history.txt",
      "export.header":     "orOS Dice & Coin — History",
      "export.exported":   "Exported: {time}"
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
      "coin.face.heads":   "Κ",
      "coin.face.tails":   "Γ",
      "share.coin":        "Κέρμα",
      "toast.copyfail":    "Αποτυχία αντιγραφής",
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
      "notation.placeholder": "2d20+5 · 4d6 dl · 8d6 kh",
      "notation.apply":    "Εφαρμογή",
      "notation.bad":      "Άγνωστη σημειογραφία",
      "presets.add":       "Αποθήκευση preset",
      "presets.prompt":    "Όνομα preset",
      "presets.saved":     "Το preset αποθηκεύτηκε",
      "presets.deleted":   "Το preset διαγράφηκε",
      "history.stats":     "Στατιστικά",
      "history.export":    "Εξαγωγή",
      "stats.title":       "Στατιστικά",
      "stats.dicerolls":   "Ρίψεις ζαριών",
      "stats.coinflips":   "Ρίψεις κέρματος",
      "stats.avg":         "μ.ό. {v}",
      "stats.crits":       "Μέγιστες ρίψεις",
      "stats.fumbles":     "Fumbles",
      "stats.empty":       "Δεν υπάρχουν δεδομένα ακόμα",
      "export.done":       "Το ιστορικό εξήχθη",
      "export.filename":   "oros-dice-history.txt",
      "export.header":     "orOS Ζάρια & Κέρμα — Ιστορικό",
      "export.exported":   "Εξήχθη: {time}"
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
  function esc(s) {
    if (typeof s !== "string") s = String(s);
    return s.replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c];
    });
  }

  function fmtTimestamp(ts) {
    // Manual, locale-independent: dd/mm/yyyy HH:MM (24h) — orOS date doctrine
    var d = new Date(ts);
    function p2(n) { return n < 10 ? "0" + n : String(n); }
    return p2(d.getDate()) + "/" + p2(d.getMonth() + 1) + "/" + d.getFullYear() +
      " " + p2(d.getHours()) + ":" + p2(d.getMinutes());
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
    // Deterministic: dataset max mtime/ts (never wall-clock — Bible
    // Storage/Quote doctrine). Empty dataset → keep all tombstones.
    var max = datasetMaxTs(st);
    if (!max) return;
    var cutoff = max - TOMB_LIFETIME_MS;
    Object.keys(st.deleted || {}).forEach(function (id) {
      if (st.deleted[id] < cutoff) delete st.deleted[id];
    });
  }

  function datasetMaxTs(st) {
    var m = 0;
    ((st && st.history) || []).forEach(function (h) {
      var v = h.mtime || h.ts || 0;
      if (v > m) m = v;
    });
    return m;
  }

  function defaultState() {
    return { ver: DATA_VER, sm: 0, deleted: {}, history: [], presets: [] };
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var data = JSON.parse(raw);
        if (data && Array.isArray(data.history)) {
          state = data;
          if (!Array.isArray(state.presets)) state.presets = [];   // v1 → v2
          state.ver = DATA_VER;
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
      renderPresets();
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
    // Deterministic pruning: dataset max mtime (fall back to ts for
    // legacy entries) across BOTH sides — never wall-clock.
    var maxTs = datasetMaxTs({ history: (a.history || []).concat(b.history || []) });
    if (maxTs) {
      var cutoff = maxTs - TOMB_LIFETIME_MS;
      Object.keys(tomb).forEach(function (id) {
        if (tomb[id] < cutoff) delete tomb[id];
      });
    }

    // --- presets: union by name, LWW by ts (same doctrine as history) ---
    var pres = {};
    [a.presets || [], b.presets || []].forEach(function (list) {
      list.forEach(function (p) {
        var ex = pres[p.name];
        if (!ex || (p.ts || 0) > (ex.ts || 0)) pres[p.name] = p;
      });
    });
    var presetArr = Object.keys(pres).map(function (n) { return pres[n]; });
    presetArr.sort(function (x, y) { return x.name.localeCompare(y.name); });
    if (presetArr.length > 20) presetArr = presetArr.slice(0, 20);   // cap

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
          // tie on ts: lexicographic JSON tie-break (R5 — provably
          // symmetric; identical payloads pick either, same result)
          map[h.id] = (JSON.stringify(h) < JSON.stringify(existing)) ? h : existing;
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
      history: arr,
      presets: presetArr
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
    playSfx("dice");
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
    var finalRot = result === "heads" ? 0 : 180;
    var turns = randInt(3, 6) * 360 + finalRot;   // lands exactly on target face
    coin.style.transform = "";                     // clear leftover before animating
    coin.style.setProperty("--flip-turns", turns + "deg");

    setTimeout(function () {
      coin.classList.remove("flipping");
      coin.style.transform = "rotateY(" + finalRot + "deg)";

      playSfx("coin");
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
      totalEl.textContent = "0";
      totalEl.style.animation = "none";
      void totalEl.offsetWidth;
      totalEl.style.animation = "countUp 0.3s ease-out";
      var target = lastResult.total;
      var current = 0;
      var step = Math.ceil(target / 12);
      var timer = setInterval(function () {
        current += step;
        if (current >= target) { current = target; clearInterval(timer); }
        totalEl.textContent = String(current);
      }, 28);
      diceRow.innerHTML = "";
      lastResult.rolls.forEach(function (val, idx) {
        var die = document.createElement("span");
        die.className = "die";
        die.setAttribute("data-type", String(lastResult.type));
        die.setAttribute("data-value", String(val));
        die.textContent = val;
        if (lastResult.kept && !lastResult.kept[idx]) die.classList.add("dropped");
        if (val === lastResult.type) {
          die.classList.add("crit");
        }
        if (val === 1 && lastResult.rolls.length === 1) {
          die.classList.add("fumble");
        }
        diceRow.appendChild(die);
      });
      critBadge.hidden = !lastResult.isCrit;
      fumbleBadge.hidden = !lastResult.isFumble;
    } else {
      notationEl.textContent = t("actions.coin");
      totalEl.textContent = t(lastResult.result === "heads" ? "coin.face.heads" : "coin.face.tails");
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
      if (lastResult.isCrit) details += " — " + t("badge.crit");
      if (lastResult.isFumble) details += " — " + t("badge.fumble");
    } else {
      details = t(lastResult.result === "heads" ? "coin.heads" : "coin.tails");
    }

    var card = t("share.card", {
      time: time,
      notation: lastResult.kind === "dice" ? lastResult.notation : t("share.coin"),
      total: String(lastResult.kind === "dice" ? lastResult.total : ""),
      details: details
    });

    navigator.clipboard.writeText(card).then(function () {
      showToast(t("toast.share"), false);
    }).catch(function () {
      showToast(t("toast.copyfail"), false);
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
  
    // ---------- 10b. Free notation parser ----------
  // Accepts: NdM, NdM+K, NdM-K, optional mode suffix kh/kl/dl (e.g. 4d6 dl)
  function parseNotation(input) {
    var s = String(input || "").trim().toLowerCase().replace(/\s+/g, "");
    var m = s.match(/^(\d{1,2})d(\d{1,3})(?:([+-])(\d{1,2}))?(kh|kl|dl)?$/);
    if (!m) return null;
    var count = parseInt(m[1], 10);
    var type = parseInt(m[2], 10);
    var mod = m[3] ? (m[3] === "-" ? -1 : 1) * parseInt(m[4], 10) : 0;
    var allowed = [4, 6, 8, 10, 12, 20, 100];
    if (count < 1 || count > 30) return null;
    if (allowed.indexOf(type) === -1) return null;
    var modeMap = { kh: "keep-high", kl: "keep-low", dl: "drop-low" };
    return {
      count: count,
      type: type,
      mod: mod,
      mode: (m[5] && modeMap[m[5]]) || "normal"
    };
  }

  function applyNotation() {
    var input = $("notation-input");
    var parsed = parseNotation(input.value);
    if (!parsed) {
      input.classList.add("err");
      setTimeout(function () { input.classList.remove("err"); }, 900);
      return;
    }
    input.classList.remove("err");
    $("dice-count").value = parsed.count;
    $("dice-type").value = String(parsed.type);
    $("dice-mod").value = parsed.mod;
    var btn = document.querySelector('#modes .mode-btn[data-mode="' + parsed.mode + '"]');
    if (btn) btn.click();
    rollDice();
  }

  // ---------- 10c. Presets ----------
  function currentBuilderConfig() {
    return {
      name: "",
      count: Math.min(30, Math.max(1, parseInt($("dice-count").value, 10) || 1)),
      type: parseInt($("dice-type").value, 10),
      mod: parseInt($("dice-mod").value, 10) || 0,
      mode: getCurrentMode()
    };
  }

  function setMode(mode) {
    var target = document.querySelector('#modes .mode-btn[data-mode="' + mode + '"]');
    if (target) target.click();
  }

  function renderPresets() {
    var list = $("preset-list");
    if (!list) return;
    list.innerHTML = "";
    (state.presets || []).forEach(function (p) {
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "preset-chip";
      chip.title = p.count + "d" + p.type +
        (p.mod ? (p.mod > 0 ? "+" : "") + p.mod : "") +
        (p.mode !== "normal" ? " " + p.mode : "");

      var label = document.createElement("span");
      label.textContent = p.name;
      chip.appendChild(label);

      var del = document.createElement("span");
      del.className = "preset-del";
      del.setAttribute("role", "button");
      del.textContent = "✕";
      del.title = t("presets.deleted");
      chip.appendChild(del);

      chip.addEventListener("click", function (e) {
        if (e.target === del || del.contains(e.target)) return;   // delete handled below
        $("dice-count").value = p.count;
        $("dice-type").value = String(p.type);
        $("dice-mod").value = p.mod;
        setMode(p.mode);
      });
      del.addEventListener("click", function (e) {
        e.stopPropagation();
        state.presets = (state.presets || []).filter(function (x) { return x.name !== p.name; });
        touch();
        save();
        renderPresets();
        showToast(t("presets.deleted"));
      });
      list.appendChild(chip);
    });
  }

  function addPreset() {
    var cfg = currentBuilderConfig();
    var name = prompt(t("presets.prompt"),
      cfg.count + "d" + cfg.type + (cfg.mod ? (cfg.mod > 0 ? "+" : "") + cfg.mod : ""));
    if (!name) return;
    name = name.trim().slice(0, 24);
    if (!name) return;
    if (!state.presets) state.presets = [];
    state.presets = state.presets.filter(function (x) { return x.name !== name; });
    state.presets.push({
      name: name,
      count: cfg.count,
      type: cfg.type,
      mod: cfg.mod,
      mode: cfg.mode,
      ts: Date.now()
    });
    touch();
    save();
    renderPresets();
    showToast(t("presets.saved"));
  }

  // ---------- 10d. Statistics ----------
  function buildStats() {
    var diceRolls = 0, coinFlips = 0, crits = 0, fumbles = 0;
    var byType = {};   // type -> {count, sum}
    var heads = 0, tails = 0;
    state.history.forEach(function (h) {
      if (state.deleted[h.id]) return;
      if (h.kind === "dice") {
        diceRolls++;
        if (h.isCrit) crits++;
        if (h.isFumble) fumbles++;
        if (!byType[h.type]) byType[h.type] = { count: 0, sum: 0 };
        (h.rolls || []).forEach(function (v, i) {
          if (!h.kept || h.kept[i]) {
            byType[h.type].count++;
            byType[h.type].sum += v;
          }
        });
      } else if (h.kind === "coin") {
        coinFlips++;
        if (h.result === "heads") heads++; else tails++;
      }
    });
    return { diceRolls: diceRolls, coinFlips: coinFlips, crits: crits,
             fumbles: fumbles, byType: byType, heads: heads, tails: tails };
  }

  function statsDialog() {
    var s = buildStats();
    var stale = document.getElementById("dice-stats-dialog");
    if (stale) stale.remove();

    var dlg = document.createElement("dialog");
    dlg.id = "dice-stats-dialog";
    dlg.style.cssText =
      "border:1px solid var(--border);border-radius:12px;" +
      "background:var(--panel-bg);color:var(--text);padding:18px;" +
      "width:min(340px,calc(100vw - 32px));";

    var title = document.createElement("div");
    title.style.cssText = "font-size:13px;font-weight:800;text-transform:uppercase;" +
      "letter-spacing:1px;color:var(--text-dim);margin-bottom:14px;";
    title.textContent = t("stats.title");
    dlg.appendChild(title);

    if (s.diceRolls + s.coinFlips === 0) {
      var em = document.createElement("div");
      em.style.cssText = "font-size:13px;color:var(--text-dim);padding:8px 0 4px;";
      em.textContent = t("stats.empty");
      dlg.appendChild(em);
    } else {
      var rows = [
        [t("stats.dicerolls"), String(s.diceRolls)],
        [t("stats.coinflips"), s.coinFlips + " (" + s.heads + " / " + s.tails + ")"],
        [t("stats.crits"), String(s.crits)],
        [t("stats.fumbles"), String(s.fumbles)]
      ];
      Object.keys(s.byType).sort(function (a, b) { return a - b; }).forEach(function (tp) {
        var d = s.byType[tp];
        var avg = d.count ? (d.sum / d.count).toFixed(1) : "0";
        rows.push(["d" + tp, t("stats.avg", { v: avg })]);
      });
      rows.forEach(function (r) {
        var row = document.createElement("div");
        row.style.cssText = "display:flex;justify-content:space-between;" +
          "font-size:13px;padding:5px 0;border-bottom:1px solid var(--border);";
        var k = document.createElement("span");
        k.style.cssText = "color:var(--text-dim);";
        k.textContent = r[0];
        var v = document.createElement("strong");
        v.style.cssText = "color:var(--accent);font-variant-numeric:tabular-nums;";
        v.textContent = r[1];
        row.appendChild(k); row.appendChild(v);
        dlg.appendChild(row);
      });
    }

    var close = document.createElement("button");
    close.type = "button";
    close.textContent = "OK";
    close.style.cssText = "margin-top:14px;width:100%;min-height:38px;border-radius:7px;" +
      "border:1px solid var(--border);background:transparent;color:var(--accent);" +
      "font-weight:700;font-size:13px;cursor:pointer;";
    close.addEventListener("click", function () { dlg.close(); });
    dlg.appendChild(close);

    dlg.addEventListener("click", function (e) {
      if (e.target === dlg) dlg.close();
    });
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  // ---------- 10e. History export (TXT) ----------
  function exportHistory() {
    var visible = state.history.filter(function (h) { return !state.deleted[h.id]; });
    var lines = [t("export.header"),
                 t("export.exported", { time: fmtTimestamp(Date.now()) }), ""];
    visible.forEach(function (h) {
      if (h.kind === "dice") {
        lines.push("[" + fmtTimestamp(h.ts) + "] " + h.notation + " → " + h.total +
          "  (" + (h.rolls || []).join(", ") + ")" +
          (h.isCrit ? " MAX!" : "") + (h.isFumble ? " Fumble" : ""));
      } else {
        lines.push("[" + fmtTimestamp(h.ts) + "] " +
          t(h.result === "heads" ? "coin.heads" : "coin.tails"));
      }
    });
    var blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = t("export.filename");
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    showToast(t("export.done"));
  }

  // ---------- 10f. SFX (WebAudio synth — no external files) ----------
  var sfxCtx = null;
  function sfxEnabled() { return localStorage.getItem("oros-dice-sfx") === "1"; }

  function paintSfxBtn() {
    var b = $("sfx-btn");
    b.setAttribute("aria-pressed", sfxEnabled() ? "true" : "false");
    b.textContent = sfxEnabled() ? "🔊" : "🔇";
  }

  function playSfx(kind) {
    if (!sfxEnabled()) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!sfxCtx) sfxCtx = new AC();
      var ctx = sfxCtx;
      if (ctx.state === "suspended") ctx.resume();
      if (kind === "dice") {
        var buf = ctx.createBuffer(1, 2400, 22050);
        var d = buf.getChannelData(0);
        for (var i = 0; i < d.length; i++) {
          d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
        }
        var src = ctx.createBufferSource(); src.buffer = buf;
        var f = ctx.createBiquadFilter();
        f.type = "bandpass"; f.frequency.value = 2400; f.Q.value = 0.9;
        var g = ctx.createGain(); g.gain.value = 0.5;
        src.connect(f); f.connect(g); g.connect(ctx.destination);
        src.start();
      } else {
        var o = ctx.createOscillator(), og = ctx.createGain();
        o.type = "triangle"; o.frequency.value = 1050;
        og.gain.setValueAtTime(0.25, ctx.currentTime);
        og.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
        o.connect(og); og.connect(ctx.destination);
        o.start(); o.stop(ctx.currentTime + 0.42);
      }
    } catch (e) { /* audio unavailable → silent */ }
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
  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (el) {
      el.textContent = t(el.getAttribute("data-i18n"));
    });
    var fl = document.getElementById("coin-front-letter");
    var bl = document.getElementById("coin-back-letter");
    if (fl) fl.textContent = t("coin.face.heads");
    if (bl) bl.textContent = t("coin.face.tails");
    var ni = document.getElementById("notation-input");
    if (ni) ni.setAttribute("placeholder", t("notation.placeholder"));
  }

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
      // stopPropagation: Space/Enter ανήκουν στο coin, όχι στο
      // document-level shortcut (που αλλιώς ρίχνει και ζάρι)
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        flipCoin();
      }
    });
    $("history-clear").addEventListener("click", clearHistory);
    $("share-btn").addEventListener("click", shareResult);
    $("stats-btn").addEventListener("click", statsDialog);
    $("export-btn").addEventListener("click", exportHistory);
    $("notation-apply").addEventListener("click", applyNotation);
    $("notation-input").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); applyNotation(); }
    });
    $("preset-add").addEventListener("click", addPreset);
    $("sfx-btn").addEventListener("click", function () {
      localStorage.setItem("oros-dice-sfx", sfxEnabled() ? "0" : "1");
      paintSfxBtn();
      if (sfxEnabled()) playSfx("coin");   // audible confirmation
    });

    wireKeyboard();
    paintStaticAria();
  }

  // ---------- Boot ----------
  load();
  applyI18n();
  inheritPalette();
  watchPalette();
  wire();
  paintSfxBtn();
  registerSync();
  scheduleRender();
})();