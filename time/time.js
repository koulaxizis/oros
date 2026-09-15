// ============================================================
// orOS Time v0.1.0
// Clock (digital/analog/binary) · world clock · alarms ·
// timer · stopwatch · pomodoro.
// Alarms/timer/pomodoro FIRINGS run in the SHELL engine
// (parent window, same pattern as __orosWeatherUpdate) so they
// survive closing the app. This page only renders + registers.
// ============================================================
(function () {
  "use strict";

  /* ---------- 0. Shell palette inheritance (same-origin iframe) ---------- */
  // Function NAMES are load-bearing: bump-version.yml's G3 palette
  // guard greps every app's JS for inheritPalette + watchPalette.
  // Same contract as todo/kanban/notes/weather/mood.
  function inheritPalette() {
    try {
      var pDoc = window.parent.document;
      var pCs = window.parent.getComputedStyle(pDoc.documentElement);
      ["--bg", "--text", "--text-dim", "--accent", "--accent-hover",
       "--accent-soft", "--panel-bg", "--border", "--shadow"].forEach(function (v) {
        var val = pCs.getPropertyValue(v).trim();
        if (val) document.documentElement.style.setProperty(v, val);
      });
      var th = pDoc.documentElement.getAttribute("data-theme");
      if (th) document.documentElement.setAttribute("data-theme", th);
    } catch (e) { /* standalone load — CSS fallbacks apply */ }
  }
  // Live follow: theme/skin changes in the shell reach an OPEN app
  // without a re-open — the observer re-inherits on attribute change.
  // (Bonus fix: previously the app saw shell theme changes only at
  // its own boot; a theme toggle in the menu left it stale.)
  function watchPalette() {
    try {
      var pRoot = window.parent.document.documentElement;
      if (typeof MutationObserver !== "function") return;
      new MutationObserver(inheritPalette).observe(pRoot, {
        attributes: true, attributeFilter: ["data-theme", "data-skin"]
      });
    } catch (e) { /* standalone — nothing to watch */ }
  }
  inheritPalette();
  watchPalette();

  /* ---------- 1. i18n (own packs; shell keys don't cover the app) ---------- */
  var LANG = "en";
  try {
    if (window.parent && window.parent.orosLang) LANG = window.parent.orosLang;
    else if (localStorage.getItem("oros-lang")) LANG = localStorage.getItem("oros-lang");
  } catch (e) {}

  var STR = {
    en: {
      "sty.digital": "Digital", "sty.analog": "Analog", "sty.binary": "Binary",
      "zones.title": "World clock", "zones.add": "Add", "zones.dlg": "Add time zone",
      "zones.ok": "Add", "zones.cancel": "Cancel", "zones.none": "No zones yet",
      "tab.alarm": "Alarm", "tab.timer": "Timer", "tab.stopwatch": "Stopwatch", "tab.pomodoro": "Pomodoro",
      "al.ph.label": "Label…", "al.daily": "Daily", "al.add": "Add alarm", "al.none": "No alarms",
      "tm.start": "Start", "tm.reset": "Reset", "tm.done": "Timer finished",
      "st.start": "Start", "st.stop": "Stop", "st.reset": "Reset",
      "pm.start": "Start", "pm.reset": "Reset", "pm.work": "Work", "pm.break": "Break",
      "pm.phase.work": "Focus", "pm.phase.break": "Break",
      "pm.done": "{n} session(s) completed"
    },
    el: {
      "sty.digital": "Ψηφιακό", "sty.analog": "Αναλογικό", "sty.binary": "Δυαδικό",
      "zones.title": "Παγκόσμια ώρα", "zones.add": "Προσθήκη", "zones.dlg": "Προσθήκη ζώνης ώρας",
      "zones.ok": "Προσθήκη", "zones.cancel": "Άκυρο", "zones.none": "Δεν έχουν προστεθεί ζώνες",
      "tab.alarm": "Ξυπνητήρι", "tab.timer": "Αντίστροφη μέτρηση", "tab.stopwatch": "Χρονόμετρο", "tab.pomodoro": "Pomodoro",
      "al.ph.label": "Ετικέτα…", "al.daily": "Καθημερινά", "al.add": "Προσθήκη ξυπνητηριού", "al.none": "Κανένα ξυπνητήρι",
      "tm.start": "Έναρξη", "tm.reset": "Επαναφορά", "tm.done": "Η αντίστροφη μέτρηση ολοκληρώθηκε",
      "st.start": "Έναρξη", "st.stop": "Διακοπή", "st.reset": "Επαναφορά",
      "pm.start": "Έναρξη", "pm.reset": "Επαναφορά", "pm.work": "Εργασία", "pm.break": "Διάλειμμα",
      "pm.phase.work": "Εστίαση", "pm.phase.break": "Διάλειμμα",
      "pm.done": "{n} ολοκληρωμένες περίοδοι"
    }
  };
  function t(k) {
    return (STR[LANG] && STR[LANG][k] !== undefined) ? STR[LANG][k]
         : (STR.en[k] !== undefined ? STR.en[k] : k);
  }
  function applyI18n() {
    var els = document.querySelectorAll("[data-i18n]");
    for (var i = 0; i < els.length; i++) els[i].textContent = t(els[i].getAttribute("data-i18n"));
    var phs = document.querySelectorAll("[data-i18n-ph]");
    for (var j = 0; j < phs.length; j++) phs[j].placeholder = t(phs[j].getAttribute("data-i18n-ph"));
  }

  function $(id) { return document.getElementById(id); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }

  /* ---------- 2. State (prefs persist; sync slice deferred to Part 5) ---------- */
    var DATA_KEY = "oros-time-data";
  var lastMinuteKey = -1;
  // zones = entities { tz, mtime }; zonesDeleted = tombstones { tz, mtime }
  // (same merge contract as Calendar). smtime stamps SCALAR-pref edits
  // only — a zone add/delete never clobbers the other device's
  // style/pomodoro-duration settings through the scalar LWW.
  var state = {
    ver: 1, style: 0,
    zones: [], zonesDeleted: [],
    pmWork: 25, pmBreak: 5, pmDone: 0,
    smtime: 0,
    astro: null   // written by astro.js — MUST round-trip or it gets wiped
  };

  function sanitizeZone(z) {
    if (typeof z === "string" && z) return { tz: z, mtime: 0 };   // pre-sync migration
    if (!z || typeof z !== "object" || typeof z.tz !== "string" || !z.tz) return null;
    return {
      tz: z.tz,
      mtime: (typeof z.mtime === "number" && isFinite(z.mtime)) ? z.mtime : 0
    };
  }
  function sanitizeZoneTomb(z) {
    if (!z || typeof z !== "object" || typeof z.tz !== "string" || !z.tz) return null;
    return {
      tz: z.tz,
      mtime: (typeof z.mtime === "number" && isFinite(z.mtime)) ? z.mtime : Date.now()
    };
  }

  function loadState() {
    try {
      var d = JSON.parse(localStorage.getItem(DATA_KEY));
      if (d && typeof d === "object") {
        if (typeof d.style === "number") state.style = d.style;
        if (Array.isArray(d.zones)) state.zones = d.zones.map(sanitizeZone).filter(Boolean);
        if (Array.isArray(d.zonesDeleted)) state.zonesDeleted = d.zonesDeleted.map(sanitizeZoneTomb).filter(Boolean);
        if (typeof d.pmWork === "number") state.pmWork = Math.min(120, Math.max(1, d.pmWork));
        if (typeof d.pmBreak === "number") state.pmBreak = Math.min(60, Math.max(1, d.pmBreak));
        if (typeof d.pmDone === "number") state.pmDone = d.pmDone;
        if (typeof d.smtime === "number" && isFinite(d.smtime)) state.smtime = d.smtime;
        if (d.astro && typeof d.astro.lat === "number" && typeof d.astro.lon === "number") {
          state.astro = { lat: d.astro.lat, lon: d.astro.lon,
            mtime: (typeof d.astro.mtime === "number" && isFinite(d.astro.mtime)) ? d.astro.mtime : 0 };
        }
      }
    } catch (e) {}
  }
  function saveState() {
    try { localStorage.setItem(DATA_KEY, JSON.stringify(state)); } catch (e) {}
    markDirty();
  }

  // Shell sync bridge: same pattern as the other orOS apps. Every
  // saveState() is a USER edit → the engine must hear about it.
  function markDirty() {
    try {
      if (window.parent && window.parent.orosSync && window.parent.orosSync.markDirty) {
        window.parent.orosSync.markDirty();
      }
    } catch (e) {}
  }

  /* ---------- 3. Alarm store: shell engine when available ---------- */
  var alarmsApi;
  if (window.parent && window.parent.orosAlarms) {
    alarmsApi = window.parent.orosAlarms;      // single source of truth
  } else {
    // Standalone fallback: same storage key, in-app firing.
    var AK = "oros-alarms";
    function rd() {
      try { var a = JSON.parse(localStorage.getItem(AK)); return Array.isArray(a) ? a : []; }
      catch (e) { return []; }
    }
    function wr(l) { try { localStorage.setItem(AK, JSON.stringify(l)); } catch (e) {} }
    alarmsApi = {
      add: function (spec) {
        if (!spec || typeof spec.at !== "number" || spec.at <= Date.now()) return null;
        var a = { id: "l" + Date.now().toString(36), at: Math.round(spec.at),
                  label: String(spec.label || "").slice(0, 60),
                  repeat: spec.repeat === "daily" ? "daily" : "once", state: "pending" };
        var l = rd(); l.push(a); wr(l); return a.id;
      },
      remove: function (id) { wr(rd().filter(function (a) { return a.id !== id; })); },
      list: function () { return rd(); }
    };
    setInterval(function () {
      var l = rd(), hit = null;
      for (var i = 0; i < l.length; i++) {
        if (l[i].state === "pending" && l[i].at <= Date.now()) { hit = l[i]; break; }
      }
      if (!hit) return;
      if (hit.repeat === "daily") {
        var d = new Date(hit.at); d.setDate(d.getDate() + 1); hit.at = d.getTime(); wr(l);
      } else {
        wr(l.filter(function (a) { return a.id !== hit.id; }));
      }
      var toast = document.createElement("div");
      toast.setAttribute("role", "alert");
      toast.style.cssText =
        "position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:99;" +
        "background:var(--panel-bg);color:var(--text);border:1px solid var(--accent);" +
        "border-radius:10px;padding:10px 16px;font-size:13.5px;font-weight:700;" +
        "box-shadow:0 8px 24px var(--shadow);";
      toast.textContent = hit.label || t("tab.alarm");
      document.body.appendChild(toast);
      setTimeout(function () { if (toast.parentNode) toast.remove(); }, 15000);
      toast.addEventListener("click", function () { toast.remove(); });
    }, 1000);
  }

  /* ---------- 4. Faces ---------- */
  var binBits = [];
  function buildBinary() {
    var wrap = $("face-binary");
    wrap.innerHTML = "";
    binBits = [];
    for (var c = 0; c < 6; c++) {
      var col = document.createElement("div");
      col.className = "b-col";
      var rows = [];
      for (var b = 0; b < 4; b++) {
        var bit = document.createElement("div");
        bit.className = "b-bit";
        col.appendChild(bit);
        rows.push(bit);
      }
      wrap.appendChild(col);
      binBits.push(rows);
    }
  }

  var hands = {};
  function buildAnalog() {
    var NS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 100 100");
    var face = document.createElementNS(NS, "circle");
    face.setAttribute("cx", "50"); face.setAttribute("cy", "50"); face.setAttribute("r", "48");
    face.setAttribute("fill", "var(--panel-bg)");
    face.setAttribute("stroke", "var(--border)");
    face.setAttribute("stroke-width", "2");
    svg.appendChild(face);
    for (var i = 0; i < 12; i++) {
      var ang = i * Math.PI / 6;
      var tk = document.createElementNS(NS, "line");
      tk.setAttribute("x1", 50 + 42 * Math.sin(ang)); tk.setAttribute("y1", 50 - 42 * Math.cos(ang));
      tk.setAttribute("x2", 50 + 45 * Math.sin(ang)); tk.setAttribute("y2", 50 - 45 * Math.cos(ang));
      tk.setAttribute("stroke", "var(--text-dim)");
      tk.setAttribute("stroke-width", i % 3 === 0 ? "2.5" : "1");
      svg.appendChild(tk);
    }
    function mkHand(width, color) {
      var h = document.createElementNS(NS, "line");
      h.setAttribute("x1", "50"); h.setAttribute("y1", "50");
      h.setAttribute("x2", "50"); h.setAttribute("y2", "50");
      h.setAttribute("stroke", color);
      h.setAttribute("stroke-width", width);
      h.setAttribute("stroke-linecap", "round");
      svg.appendChild(h);
      return h;
    }
    hands.h = mkHand("4", "var(--text)");
    hands.m = mkHand("3", "var(--text)");
    hands.s = mkHand("1.5", "var(--accent)");
    $("face-analog").appendChild(svg);
  }
  function setHand(line, deg, len) {
    var a = (deg - 90) * Math.PI / 180;
    line.setAttribute("x2", (50 + len * Math.cos(a)).toFixed(2));
    line.setAttribute("y2", (50 + len * Math.sin(a)).toFixed(2));
  }
  function renderAnalog(now) {
    setHand(hands.h, ((now.getHours() % 12) + now.getMinutes() / 60) * 30, 26);
    setHand(hands.m, (now.getMinutes() + now.getSeconds() / 60) * 6, 38);
    setHand(hands.s, now.getSeconds() * 6, 41);
  }

  function renderBinary(now) {
    var digits = [
      Math.floor(now.getHours() / 10), now.getHours() % 10,
      Math.floor(now.getMinutes() / 10), now.getMinutes() % 10,
      Math.floor(now.getSeconds() / 10), now.getSeconds() % 10
    ];
    for (var c = 0; c < 6; c++) {
      for (var b = 0; b < 4; b++) {
        binBits[c][b].className = "b-bit" + ((digits[c] & (1 << b)) ? " on" : "");
      }
    }
  }

  function renderSub(now) {
    var loc = LANG === "el" ? "el-GR" : "en-GB";
    var d = now.toLocaleDateString(loc, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    var off = -now.getTimezoneOffset();
    var sign = off >= 0 ? "+" : "-";
    $("face-sub").textContent = d + "  ·  UTC" + sign + pad(Math.floor(Math.abs(off) / 60)) + ":" + pad(Math.abs(off) % 60);
  }

  function applyStyle() {
    var s = state.style;
    $("face-digital").hidden = s !== 0;
    $("face-analog").hidden = s !== 1;
    $("face-binary").hidden = s !== 2;
    for (var i = 0; i < 3; i++) $("sty-" + i).className = "sty" + (i === s ? " active" : "");
  }

  /* ---------- 5. World clock ---------- */
  var ZONE_LIST = [
    "UTC", "Europe/Athens", "Europe/London", "Europe/Lisbon", "Europe/Berlin",
    "Europe/Paris", "Europe/Rome", "Europe/Moscow", "Africa/Cairo",
    "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
    "America/Sao_Paulo", "Asia/Dubai", "Asia/Kolkata", "Asia/Shanghai",
    "Asia/Seoul", "Asia/Tokyo", "Australia/Sydney", "Pacific/Auckland"
  ];
  var zoneFmt = {};
  function zFmt(tz) {
    if (!zoneFmt[tz]) {
      zoneFmt[tz] = new Intl.DateTimeFormat(LANG === "el" ? "el-GR" : "en-GB",
        { timeZone: tz, hour: "2-digit", minute: "2-digit" });
    }
    return zoneFmt[tz];
  }
  function zoneName(tz) {
    return tz.split("/").pop().replace(/_/g, " ");
  }

  function renderZones() {
    var ul = $("zones");
    ul.innerHTML = "";
    if (!state.zones.length) {
      var li0 = document.createElement("li");
      li0.className = "empty";
      li0.textContent = t("zones.none");
      ul.appendChild(li0);
      return;
    }
    state.zones.forEach(function (zc) {
      var tz = zc.tz;
      var li = document.createElement("li");
      li.className = "z-row";
      var nm = document.createElement("span");
      nm.className = "z-name";
      nm.textContent = zoneName(tz);
      var tm = document.createElement("span");
      tm.className = "z-time";
      tm.setAttribute("data-tz", tz);
      var del = document.createElement("button");
      del.type = "button";
      del.className = "z-del";
      del.title = "✕";
      del.textContent = "✕";
      del.addEventListener("click", function () {
        state.zones = state.zones.filter(function (z) { return z.tz !== tz; });
        state.zonesDeleted.push({ tz: tz, mtime: Date.now() });
        saveState();
        renderZones();
      });
      li.appendChild(nm); li.appendChild(tm); li.appendChild(del);
      ul.appendChild(li);
    });
    zoneTick();
  }
  function zoneTick() {
    var cells = document.querySelectorAll("#zones .z-time");
    for (var i = 0; i < cells.length; i++) {
      var tz = cells[i].getAttribute("data-tz");
      try { cells[i].textContent = zFmt(tz).format(new Date()); } catch (e) {}
    }
  }

  $("zone-add").addEventListener("click", function () {
    var sel = $("zone-sel");
    sel.innerHTML = "";
    var taken = {};
    state.zones.forEach(function (z) { taken[z.tz] = true; });
    ZONE_LIST.forEach(function (tz) {
      var op = document.createElement("option");
      op.value = tz;
      op.textContent = zoneName(tz);
      if (taken[tz]) op.disabled = true;
      sel.appendChild(op);
    });
    $("zone-dlg").showModal();
  });
  $("zone-ok").addEventListener("click", function () {
    var tz = $("zone-sel").value;
    $("zone-dlg").close();
    var exists = state.zones.some(function (z) { return z.tz === tz; });
    if (tz && !exists) {
      state.zones.push({ tz: tz, mtime: Date.now() });
      // Re-add cancels an older deletion marker (resurrection)
      state.zonesDeleted = state.zonesDeleted.filter(function (d) { return d.tz !== tz; });
      saveState();
      renderZones();
    }
  });
  $("zone-cancel").addEventListener("click", function () { $("zone-dlg").close(); });
  // Outside-click close: a click whose target IS the dialog hit the backdrop.
  $("zone-dlg").addEventListener("click", function (ev) {
    if (ev.target === this) this.close();
  });

  /* ---------- 6. Tabs ---------- */
  var tabBtns = document.querySelectorAll(".tab");
  for (var tb = 0; tb < tabBtns.length; tb++) {
    tabBtns[tb].addEventListener("click", function () {
      var pane = this.getAttribute("data-pane");
      for (var i = 0; i < tabBtns.length; i++) {
        var on = tabBtns[i].getAttribute("data-pane") === pane;
        tabBtns[i].className = "tab" + (on ? " active" : "");
        $(tabBtns[i].getAttribute("data-pane")).hidden = !on;
      }
    });
  }

  /* ---------- 7. Alarms ---------- */
  function fmtAt(at) {
    var d = new Date(at);
    return pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function renderAlarms() {
    var ul = $("alarm-list");
    ul.innerHTML = "";
    var list = alarmsApi.list().slice().sort(function (a, b) { return a.at - b.at; });
    if (!list.length) {
      var li0 = document.createElement("li");
      li0.className = "empty";
      li0.textContent = t("al.none");
      ul.appendChild(li0);
      return;
    }
    list.forEach(function (a) {
      var li = document.createElement("li");
      li.className = "z-row";
      var main = document.createElement("div");
      main.className = "a-main";
      var tm = document.createElement("span");
      tm.className = "z-time";
      tm.textContent = fmtAt(a.at);
      var lb = document.createElement("span");
      lb.className = "a-lbl";
      lb.textContent = a.label || "";
      main.appendChild(tm);
      if (a.repeat === "daily") {
        var rp = document.createElement("span");
        rp.className = "a-rep";
        rp.textContent = t("al.daily");
        main.appendChild(rp);
      }
      main.appendChild(lb);
      var del = document.createElement("button");
      del.type = "button";
      del.className = "a-del";
      del.textContent = "✕";
      del.addEventListener("click", function () {
        alarmsApi.remove(a.id);
        renderAlarms();
      });
      li.appendChild(main); li.appendChild(del);
      ul.appendChild(li);
    });
  }
  $("al-add").addEventListener("click", function () {
    var v = $("al-time").value;
    if (!/^\d{2}:\d{2}$/.test(v)) return;
    var parts = v.split(":");
    var d = new Date();
    d.setHours(+parts[0], +parts[1], 0, 0);
    if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);   // tomorrow
    var id = alarmsApi.add({
      at: d.getTime(),
      label: $("al-label").value.trim(),
      repeat: $("al-daily").checked ? "daily" : "once"
    });
    if (!id) return;
    $("al-label").value = "";
    renderAlarms();
  });

  /* ---------- 8. Timer ---------- */
  var timerId = null, timerEnd = 0;
  function timerPaint() {
    var left = Math.max(0, Math.ceil((timerEnd - Date.now()) / 1000));
    $("tm-display").textContent = pad(Math.floor(left / 60)) + ":" + pad(left % 60);
    if (left <= 0 && timerId) {
      // Shell engine already fired the alarm — just go idle.
      timerId = null;
      $("tm-start").textContent = t("tm.start");
    }
  }
  function timerStop() {
    if (timerId) { alarmsApi.remove(timerId); timerId = null; }
    $("tm-start").textContent = t("tm.start");
  }
  $("tm-start").addEventListener("click", function () {
    if (timerId) { timerStop(); return; }     // acts as cancel
    var m = Math.max(0, Math.min(999, parseInt($("tm-min").value, 10) || 0));
    var s = Math.max(0, Math.min(59, parseInt($("tm-sec").value, 10) || 0));
    if (m * 60 + s <= 0) return;
    timerEnd = Date.now() + (m * 60 + s) * 1000;
    timerId = alarmsApi.add({ at: timerEnd, label: t("tm.done") });
    $("tm-start").textContent = t("st.stop");
    timerPaint();
  });
  $("tm-reset").addEventListener("click", function () {
    timerStop();
    $("tm-display").textContent = "00:00";
  });

    /* ---------- 9. Stopwatch ---------- */
  var swRun = false, swStart = 0, swBase = 0;
  function swPaint() {
    var ms = swBase + (swRun ? Date.now() - swStart : 0);
    $("st-display").textContent =
      pad(Math.floor(ms / 60000)) + ":" + pad(Math.floor(ms / 1000) % 60) + "." + (Math.floor(ms / 100) % 10);
  }
  $("st-go").addEventListener("click", function () {
    if (swRun) {
      swRun = false;
      swBase += Date.now() - swStart;
      $("st-go").textContent = t("st.start");
    } else {
      swRun = true;
      swStart = Date.now();
      $("st-go").textContent = t("st.stop");
    }
    swPaint();
  });
  $("st-reset").addEventListener("click", function () {
    swRun = false;
    swBase = 0;
    $("st-go").textContent = t("st.start");
    swPaint();
  });

  /* ---------- 10. Pomodoro ---------- */
  var pmPhase = "work", pmRunning = false, pmEnd = 0, pmAlarmId = null;
  function pmLen() { return (pmPhase === "work" ? state.pmWork : state.pmBreak) * 60 * 1000; }
  function pmPaint() {
    var left = pmRunning ? Math.max(0, pmEnd - Date.now()) : pmLen();
    var sec = Math.ceil(left / 1000);
    $("pm-display").textContent = pad(Math.floor(sec / 60)) + ":" + pad(sec % 60);
    $("pm-phase").textContent = t(pmPhase === "work" ? "pm.phase.work" : "pm.phase.break");
    $("pm-count").textContent = t("pm.done").replace("{n}", state.pmDone);
    $("pm-start").textContent = t(pmRunning ? "st.stop" : "pm.start");
  }
  function pmStop() {
    pmRunning = false;
    if (pmAlarmId) { alarmsApi.remove(pmAlarmId); pmAlarmId = null; }
    pmPaint();
  }
    $("pm-start").addEventListener("click", function () {
    if (pmRunning) { pmStop(); return; }
    pmEnd = Date.now() + pmLen();
    var id = alarmsApi.add({
      at: pmEnd,
      label: t(pmPhase === "work" ? "pm.phase.break" : "pm.phase.work")
    });
    if (!id) { pmRunning = false; pmPaint(); return; }   // engine rejected — stay idle
    pmRunning = true;
    pmAlarmId = id;
    pmPaint();
  });
  $("pm-reset").addEventListener("click", function () {
    pmStop();
    pmPhase = "work";
    pmPaint();
  });
  ["pm-work", "pm-break"].forEach(function (id) {
    $(id).addEventListener("change", function () {
      state.pmWork  = Math.min(120, Math.max(1, parseInt($("pm-work").value, 10)  || 25));
      state.pmBreak = Math.min(60,  Math.max(1, parseInt($("pm-break").value, 10) || 5));
      $("pm-work").value = state.pmWork;
      $("pm-break").value = state.pmBreak;
      state.smtime = Date.now();
      saveState();
      if (!pmRunning) pmPaint();
    });
  });

  // Detect a pomodoro leg FINISHED by the shell engine while this
  // page was open: our alarm vanished from the list → advance.
  function pmWatchdog() {
    if (!pmRunning) return;
    if (pmAlarmId && alarmsApi.list().every(function (a) { return a.id !== pmAlarmId; })) {
      if (pmPhase === "work") { state.pmDone++; saveState(); }
      pmPhase = pmPhase === "work" ? "break" : "work";
      pmRunning = false;
      pmAlarmId = null;
      pmPaint();
    }
  }

  /* ---------- 11. Faces wiring ---------- */
  for (var si = 0; si < 3; si++) {
    (function (idx) {
      $("sty-" + idx).addEventListener("click", function () {
        state.style = idx;
        state.smtime = Date.now();
        saveState();
        applyStyle();
      });
    })(si);
  }

  /* ---------- 12. Master tick + boot ---------- */
  function tick() {
    var now = new Date();
    var s = state.style;
    if (s === 0) {
      $("big-hm").textContent = pad(now.getHours()) + ":" + pad(now.getMinutes());
      $("big-ss").textContent = pad(now.getSeconds());
    } else if (s === 1) {
      renderAnalog(now);
    } else {
      renderBinary(now);
    }
    renderSub(now);
    zoneTick();
    timerPaint();
    swPaint();
    if (pmRunning) {
      var left = Math.max(0, pmEnd - Date.now());
      var sec = Math.ceil(left / 1000);
      $("pm-display").textContent = pad(Math.floor(sec / 60)) + ":" + pad(sec % 60);
    }
    pmWatchdog();
    // Minute-boundary refresh of the alarm list ordering (once per minute)
    var minuteKey = now.getHours() * 60 + now.getMinutes();
    if (minuteKey !== lastMinuteKey) { lastMinuteKey = minuteKey; renderAlarms(); }
  }

  // Boot
  loadState();
  applyI18n();
  buildBinary();
  buildAnalog();
  applyStyle();
  renderZones();
  renderAlarms();
  $("pm-work").value = state.pmWork;
  $("pm-break").value = state.pmBreak;
  pmPaint();
  swPaint();
  timerPaint();
  tick();
  setInterval(tick, 250);   // smooth hands + fast bit-flips, trivial cost

  /* ---------- 13. Sync slice registration ---------- */
  // Entity union for zones (tombstoned deletes, idempotent), LWW for
  // scalar prefs via smtime, max() for the pmDone counter. Everything
  // deterministic (sorted output, lexical tie-breaks) — the engine
  // contract. Timer/stopwatch/pomodoro RUNTIME and alarms are
  // deliberately OUT of the slice: runtime state, device-local truth.

  function mergeTime(local, remote) {
    function pick(base) {
      if (!base || typeof base !== "object") return { zones: [], tombs: [] };
      return {
        zones: (Array.isArray(base.zones) ? base.zones : []).map(sanitizeZone).filter(Boolean),
        tombs: (Array.isArray(base.zonesDeleted) ? base.zonesDeleted : []).map(sanitizeZoneTomb).filter(Boolean)
      };
    }
    var a = pick(local), b = pick(remote);

    var tomb = {};
    a.tombs.concat(b.tombs).forEach(function (d) {
      if (!tomb[d.tz] || d.mtime > tomb[d.tz].mtime) tomb[d.tz] = d;
    });
    var zone = {};
    a.zones.concat(b.zones).forEach(function (z) {
      var cur = zone[z.tz];
      if (!cur || z.mtime > cur.mtime) zone[z.tz] = z;
    });

    var zones = [], zonesDeleted = [];
    Object.keys(zone).forEach(function (tz) {
      if (tomb[tz] && tomb[tz].mtime >= zone[tz].mtime) return;   // delete wins (ties included)
      zones.push(zone[tz]);
      delete tomb[tz];                                            // survived/re-added
    });
    Object.keys(tomb).forEach(function (tz) { zonesDeleted.push(tomb[tz]); });
    zones.sort(function (x, y) { return x.tz < y.tz ? -1 : 1; });
    zonesDeleted.sort(function (x, y) { return x.tz < y.tz ? -1 : 1; });

    // Scalars: whole family from the side with newer smtime; ties
    // broken by lexical JSON (identical output on every device).
    var la = local || {}, rb = remote || {};
    var las = (typeof la.smtime === "number" && isFinite(la.smtime)) ? la.smtime : 0;
    var rbs = (typeof rb.smtime === "number" && isFinite(rb.smtime)) ? rb.smtime : 0;
    var pickLocal;
    if (las !== rbs) pickLocal = las > rbs;
    else pickLocal = JSON.stringify([la.style || 0, la.pmWork || 25, la.pmBreak || 5]) <=
                     JSON.stringify([rb.style || 0, rb.pmWork || 25, rb.pmBreak || 5]);

    var mA = (la.astro && typeof la.astro.lat === "number" && typeof la.astro.lon === "number") ? la.astro : null;
    var mB = (rb.astro && typeof rb.astro.lat === "number" && typeof rb.astro.lon === "number") ? rb.astro : null;
    var astro = (mA && mB) ? (((mB.mtime || 0) > (mA.mtime || 0)) ? mB : mA) : (mA || mB || null);

    return {
      ver: 1,
      style:  pickLocal ? (la.style || 0) : (rb.style || 0),
      pmWork: pickLocal ? (la.pmWork || 25) : (rb.pmWork || 25),
      pmBreak: pickLocal ? (la.pmBreak || 5) : (rb.pmBreak || 5),
      pmDone: Math.max(la.pmDone || 0, rb.pmDone || 0),
      smtime: Math.max(las, rbs),
      zones: zones,
      zonesDeleted: zonesDeleted,
      astro: astro
    };
  }

  // Pull-fed setter: validates, adopts, repaints. NEVER markDirty
  // (pull → set → push would loop; the engine owns dirtiness here).
  function setFromSync(data) {
    if (!data || typeof data !== "object") return;
    state.style   = (typeof data.style === "number" && data.style >= 0 && data.style <= 2) ? data.style : state.style;
    state.pmWork  = Math.min(120, Math.max(1, (typeof data.pmWork === "number") ? data.pmWork : state.pmWork));
    state.pmBreak = Math.min(60,  Math.max(1, (typeof data.pmBreak === "number") ? data.pmBreak : state.pmBreak));
    state.pmDone  = (typeof data.pmDone === "number") ? data.pmDone : state.pmDone;
    state.smtime  = (typeof data.smtime === "number" && isFinite(data.smtime)) ? data.smtime : state.smtime;
    state.astro = (data.astro && typeof data.astro.lat === "number" && typeof data.astro.lon === "number")
      ? { lat: data.astro.lat, lon: data.astro.lon, mtime: data.astro.mtime || 0 } : state.astro;
    state.zones        = (Array.isArray(data.zones) ? data.zones : []).map(sanitizeZone).filter(Boolean);
    state.zonesDeleted = (Array.isArray(data.zonesDeleted) ? data.zonesDeleted : []).map(sanitizeZoneTomb).filter(Boolean);
    try { localStorage.setItem(DATA_KEY, JSON.stringify(state)); } catch (e) {}
    applyStyle();
    $("pm-work").value = state.pmWork;
    $("pm-break").value = state.pmBreak;
    pmPaint();
    renderZones();
  }

  try {
    if (window.parent && window.parent.orosSync &&
        typeof window.parent.orosSync.registerSlice === "function") {
      window.parent.orosSync.registerSlice(
        "time",
        function () {     // getter: localStorage is the durable truth
          try { return JSON.parse(localStorage.getItem(DATA_KEY)) || state; }
          catch (e) { return state; }
        },
        setFromSync,
        DATA_KEY,          // persisted → closed-app proxies on next boots
        mergeTime
      );
    }
  } catch (e) { /* standalone preview — sync simply absent */ }
})();