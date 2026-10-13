// ============================================================
// orOS Time — Stage tab (v1.0.0, wave 1)
// A conference / stage timer: events with a rundown of items, a
// live countdown with yellow / red warnings and overtime, the day's
// schedule (planned vs expected, behind / ahead), a full-screen stage
// view for the speaker, keyboard and presenter-clicker control.
//
// Pure logic: time/stage-core.js (OrosStageCore). Synced: slice
// "stage", key oros-time-stage (events, items, tombstones). Device-
// local: oros-time-stage-run (the live item and its clock, actual
// times) and oros-time-stage-prefs (sound). The Time slice and the
// Pomodoro -> Timesheet link (BR-TS-POMO) are not touched here.
// Plan: /mnt/project-files/time/stage-timer-plan.md.
// ============================================================
(function () {
  "use strict";

  var C = window.OrosStageCore;
  if (!C || !document.getElementById("pane-stage")) return;

  var DATA_KEY = "oros-time-stage";
  var RUN_KEY = "oros-time-stage-run";
  var PREF_KEY = "oros-time-stage-prefs";

  /* ---------- 1. i18n ---------- */
  var LANG = "en";
  try {
    if (window.parent && window.parent.orosLang) LANG = window.parent.orosLang;
    else if (localStorage.getItem("oros-lang")) LANG = localStorage.getItem("oros-lang");
  } catch (e) {}

  var STR = {
    en: {
      "stg.ev": "Event", "stg.ev.new": "New event", "stg.ev.edit": "Event settings",
      "stg.ev.create": "Create an event", "stg.ev.dup": "Duplicate event", "stg.ev.del": "Delete event",
      "stg.ev.delq": "Tap again to delete", "stg.ev.copy": "{name} (copy)", "stg.ev.untitled": "Event",
      "stg.ev.h.new": "New event", "stg.ev.h.edit": "Event settings",
      "stg.empty": "Plan a conference, a meeting or a show: add the talks and breaks, then run the clock for the speakers.",
      "stg.prev": "◀ Previous", "stg.next": "Next ▶",
      "stg.start": "Start", "stg.pause": "Pause", "stg.resume": "Resume",
      "stg.minus": "−1 min", "stg.plus": "+1 min", "stg.reset": "Restart item", "stg.show": "Stage view",
      "stg.sound": "Sound at yellow, red and zero (this device)",
      "stg.rundown": "Rundown", "stg.add": "Add item",
      "stg.keys": "Keys: Space start / pause · → or Page Down next · ← or Page Up previous · + / − one minute (hold the button: five) · B black screen · F stage view",
      "stg.view": "Stage view", "stg.black": "Black screen", "stg.fs": "Full screen", "stg.close": "Close",
      "stg.save": "Save", "stg.cancel": "Cancel",
      "stg.f.name": "Name", "stg.f.date": "Date", "stg.f.start": "Starts at",
      "stg.f.yellow": "Yellow at (min left)", "stg.f.red": "Red at (min left)",
      "stg.f.flash": "Flash when time is up", "stg.f.default": "event default",
      "stg.f.title": "Title", "stg.f.speaker": "Speaker", "stg.f.kind": "Type",
      "stg.f.dur": "Length (min : s)", "stg.f.min": "Minutes", "stg.f.sec": "Seconds",
      "stg.f.until": "Until (clock time)", "stg.f.auto": "Start the next item by itself at zero",
      "stg.f.notes": "Notes (only you see them)",
      "stg.k.down": "Countdown", "stg.k.up": "Count up", "stg.k.until": "Until a clock time", "stg.k.clock": "Time of day",
      "stg.it.h.new": "New item", "stg.it.h.edit": "Edit item", "stg.it.del": "Delete item",
      "stg.it.delq": "Tap again to delete", "stg.it.untitled": "Item {n}",
      "stg.go": "Start here", "stg.up": "Move up", "stg.down": "Move down",
      "stg.none": "No items yet. Add the first talk or break.",
      "stg.nextup": "Next: {t}", "stg.last": "Last item", "stg.done.all": "All done",
      "stg.ready": "Ready",
      "stg.sum.plan": "Planned end {p} · expected {e}", "stg.sum.exp": "Expected end {e}",
      "stg.sum.behind": "{n} min behind", "stg.sum.ahead": "{n} min ahead", "stg.sum.ontime": "On time",
      "stg.st.done": "ran {d}", "stg.st.skipped": "skipped", "stg.st.live": "live",
      "stg.until": "until {t}", "stg.clock": "clock"
    },
    el: {
      "stg.ev": "Εκδήλωση", "stg.ev.new": "Νέα εκδήλωση", "stg.ev.edit": "Ρυθμίσεις εκδήλωσης",
      "stg.ev.create": "Δημιουργία εκδήλωσης", "stg.ev.dup": "Αντίγραφο εκδήλωσης", "stg.ev.del": "Διαγραφή εκδήλωσης",
      "stg.ev.delq": "Πάτα ξανά για διαγραφή", "stg.ev.copy": "{name} (αντίγραφο)", "stg.ev.untitled": "Εκδήλωση",
      "stg.ev.h.new": "Νέα εκδήλωση", "stg.ev.h.edit": "Ρυθμίσεις εκδήλωσης",
      "stg.empty": "Οργάνωσε ένα συνέδριο, μια συνάντηση ή μια παράσταση: πρόσθεσε τις ομιλίες και τα διαλείμματα και τρέξε το χρονόμετρο για τους ομιλητές.",
      "stg.prev": "◀ Προηγούμενο", "stg.next": "Επόμενο ▶",
      "stg.start": "Έναρξη", "stg.pause": "Παύση", "stg.resume": "Συνέχεια",
      "stg.minus": "−1 λεπτό", "stg.plus": "+1 λεπτό", "stg.reset": "Από την αρχή", "stg.show": "Οθόνη σκηνής",
      "stg.sound": "Ήχος στο κίτρινο, στο κόκκινο και στο μηδέν (αυτή η συσκευή)",
      "stg.rundown": "Πρόγραμμα", "stg.add": "Προσθήκη",
      "stg.keys": "Πλήκτρα: Space έναρξη / παύση · → ή Page Down επόμενο · ← ή Page Up προηγούμενο · + / − ένα λεπτό (κράτα πατημένο το κουμπί: πέντε) · B μαύρη οθόνη · F οθόνη σκηνής",
      "stg.view": "Οθόνη σκηνής", "stg.black": "Μαύρη οθόνη", "stg.fs": "Πλήρης οθόνη", "stg.close": "Κλείσιμο",
      "stg.save": "Αποθήκευση", "stg.cancel": "Άκυρο",
      "stg.f.name": "Όνομα", "stg.f.date": "Ημερομηνία", "stg.f.start": "Ώρα έναρξης",
      "stg.f.yellow": "Κίτρινο στα (λεπτά που μένουν)", "stg.f.red": "Κόκκινο στα (λεπτά που μένουν)",
      "stg.f.flash": "Αναβοσβήνει όταν τελειώσει ο χρόνος", "stg.f.default": "όπως η εκδήλωση",
      "stg.f.title": "Τίτλος", "stg.f.speaker": "Ομιλητής", "stg.f.kind": "Είδος",
      "stg.f.dur": "Διάρκεια (λεπτά : δευτ.)", "stg.f.min": "Λεπτά", "stg.f.sec": "Δευτερόλεπτα",
      "stg.f.until": "Μέχρι (ώρα)", "stg.f.auto": "Ξεκινά μόνο του το επόμενο στο μηδέν",
      "stg.f.notes": "Σημειώσεις (τις βλέπεις μόνο εσύ)",
      "stg.k.down": "Αντίστροφη μέτρηση", "stg.k.up": "Μέτρηση προς τα πάνω", "stg.k.until": "Μέχρι μια ώρα", "stg.k.clock": "Ώρα της ημέρας",
      "stg.it.h.new": "Νέο στοιχείο", "stg.it.h.edit": "Επεξεργασία στοιχείου", "stg.it.del": "Διαγραφή στοιχείου",
      "stg.it.delq": "Πάτα ξανά για διαγραφή", "stg.it.untitled": "Στοιχείο {n}",
      "stg.go": "Έναρξη από εδώ", "stg.up": "Πάνω", "stg.down": "Κάτω",
      "stg.none": "Δεν υπάρχουν στοιχεία ακόμη. Πρόσθεσε την πρώτη ομιλία ή το πρώτο διάλειμμα.",
      "stg.nextup": "Επόμενο: {t}", "stg.last": "Τελευταίο στοιχείο", "stg.done.all": "Τέλος",
      "stg.ready": "Έτοιμο",
      "stg.sum.plan": "Προγραμματισμένο τέλος {p} · αναμενόμενο {e}", "stg.sum.exp": "Αναμενόμενο τέλος {e}",
      "stg.sum.behind": "{n} λεπτά πίσω", "stg.sum.ahead": "{n} λεπτά μπροστά", "stg.sum.ontime": "Στην ώρα μας",
      "stg.st.done": "κράτησε {d}", "stg.st.skipped": "παραλείφθηκε", "stg.st.live": "τώρα",
      "stg.until": "μέχρι {t}", "stg.clock": "ώρα"
    }
  };
  function t(k, vars) {
    var s = (STR[LANG] && STR[LANG][k] !== undefined) ? STR[LANG][k] : (STR.en[k] !== undefined ? STR.en[k] : k);
    if (vars) Object.keys(vars).forEach(function (v) { s = s.split("{" + v + "}").join(vars[v]); });
    return s;
  }
  function $(id) { return document.getElementById(id); }
  function applyI18n() {
    var els = document.querySelectorAll("[data-i18n-s]");
    for (var i = 0; i < els.length; i++) els[i].textContent = t(els[i].getAttribute("data-i18n-s"));
    var phs = document.querySelectorAll("[data-i18n-s-ph]");
    for (var j = 0; j < phs.length; j++) phs[j].placeholder = t(phs[j].getAttribute("data-i18n-s-ph"));
    var als = document.querySelectorAll("[data-i18n-s-a]");
    for (var k = 0; k < als.length; k++) als[k].setAttribute("aria-label", t(als[k].getAttribute("data-i18n-s-a")));
    $("stg-ev").setAttribute("aria-label", t("stg.ev"));
    var ks = $("si-kind");
    ks.innerHTML = "";
    C.KINDS.forEach(function (k2) {
      var o = document.createElement("option");
      o.value = k2; o.textContent = t("stg.k." + k2);
      ks.appendChild(o);
    });
  }

  /* ---------- 2. State ---------- */
  function readJSON(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  }
  var data = C.canon(readJSON(DATA_KEY) || C.empty());
  var run = C.normRun(readJSON(RUN_KEY));
  var prefs = readJSON(PREF_KEY) || {};
  var sound = prefs.sound === true;

  function markDirty() {
    try {
      if (window.parent && window.parent.orosSync && window.parent.orosSync.markDirty) window.parent.orosSync.markDirty();
    } catch (e) {}
  }
  // A user edit: canonical bytes in storage (same form the getter and
  // the merge produce), then tell the engine.
  function save() {
    data = C.canon(data);
    try { localStorage.setItem(DATA_KEY, JSON.stringify(data)); } catch (e) {}
    markDirty();
  }
  function saveRun() {
    try { localStorage.setItem(RUN_KEY, JSON.stringify(run)); } catch (e) {}
  }
  function savePrefs() {
    try { localStorage.setItem(PREF_KEY, JSON.stringify({ sound: sound })); } catch (e) {}
  }
  function newId() {
    var a = new Uint32Array(2);
    crypto.getRandomValues(a);
    return ("s" + a[0].toString(36) + a[1].toString(36)).slice(0, 16);
  }
  function today() {
    var d = new Date();
    return d.getFullYear() + "-" + (d.getMonth() < 9 ? "0" : "") + (d.getMonth() + 1) + "-" + (d.getDate() < 10 ? "0" : "") + d.getDate();
  }

  function events() {
    return data.events.slice().sort(function (a, b) {
      return (b.date || "").localeCompare(a.date || "") || a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1);
    });
  }
  function evById(id) {
    for (var i = 0; i < data.events.length; i++) if (data.events[i].id === id) return data.events[i];
    return null;
  }
  function itemById(id) {
    for (var i = 0; i < data.items.length; i++) if (data.items[i].id === id) return data.items[i];
    return null;
  }
  // The open event: the one this device last used, else the next one
  // on the calendar (today or later), else the latest.
  function curEvent() {
    var ev = evById(run.ev);
    if (ev) return ev;
    var list = events(), d = today(), pick = null;
    list.forEach(function (e) { if (e.date && e.date >= d && (!pick || e.date < pick.date)) pick = e; });
    pick = pick || list[0] || null;
    if (pick) { run = Object.assign({}, run, { ev: pick.id }); saveRun(); }
    return pick;
  }
  function items() {
    var ev = curEvent();
    return ev ? C.rundown(data, ev.id) : [];
  }
  // The item the big clock is about: the live one, else the next to run.
  function focusItem(list, sch) {
    var cur = run.cur ? itemById(run.cur) : null;
    if (cur) return cur;
    for (var i = 0; i < sch.rows.length; i++) if (sch.rows[i].state === "todo") return list[i];
    return null;
  }

  /* ---------- 3. Sounds (device pref, off by default) ---------- */
  var AC = null;
  function audio() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      if (!AC) AC = new Ctx();
      if (AC.state === "suspended") AC.resume();
      return AC;
    } catch (e) { return null; }
  }
  function beep(n, freq) {
    if (!sound) return;
    var ac = audio();
    if (!ac) return;
    try {
      var t0 = ac.currentTime;
      for (var i = 0; i < n; i++) {
        var o = ac.createOscillator(), g = ac.createGain();
        o.type = "sine"; o.frequency.value = freq || 880;
        g.gain.setValueAtTime(0.0001, t0 + i * 0.3);
        g.gain.exponentialRampToValueAtTime(0.2, t0 + i * 0.3 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.3 + 0.25);
        o.connect(g); g.connect(ac.destination);
        o.start(t0 + i * 0.3); o.stop(t0 + i * 0.3 + 0.27);
      }
    } catch (e) {}
  }

  /* ---------- 4. Actions ---------- */
  function setRun(r) { run = r; saveRun(); render(); }
  function act(name, arg) {
    var list = items(), now = Date.now();
    var ev = curEvent();
    if (!ev) return;
    var sch = C.schedule(ev, list, run, now);
    var focus = focusItem(list, sch);
    audio();                                  // a user gesture: unlock sound
    if (name === "go") {
      if (!run.cur) {
        if (!focus) return;
        setRun(C.select(run, focus.id, now, true));
      } else if (run.startedAt && !run.pausedAt) setRun(C.pause(run, now));
      else setRun(C.start(run, now));
    } else if (name === "next") {
      if (!run.cur) {
        if (focus) setRun(C.select(run, focus.id, now, false));
        return;
      }
      var nx = C.neighbour(list, run.cur, 1);
      var going = !!run.startedAt;
      if (nx) setRun(C.select(run, nx, now, going));
      else setRun(C.finish(run, now));
    } else if (name === "prev") {
      var pv = C.neighbour(list, run.cur || (focus && focus.id), -1);
      if (!run.cur && focus && !pv) return;
      if (pv) setRun(C.select(run, pv, now, false));
    } else if (name === "jump") {
      setRun(C.select(run, arg, now, false));
    } else if (name === "add") {
      if (!run.cur) {
        if (!focus) return;
        run = C.select(run, focus.id, now, false);
      }
      setRun(C.addTime(run, arg));
    } else if (name === "reset") {
      if (run.cur) setRun(C.reset(run));
    }
  }

  /* ---------- 5. Rendering ---------- */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function durText(it) {
    if (it.kind === "until" && it.until) return t("stg.until", { t: it.until });
    return C.fmt(it.dur * 1000);
  }

  function render() {
    var list = events();
    var sel = $("stg-ev");
    var ev = curEvent();
    sel.innerHTML = "";
    list.forEach(function (e) {
      var o = el("option", null, (e.name || t("stg.ev.untitled")) + (e.date ? " · " + e.date : ""));
      o.value = e.id;
      if (ev && e.id === ev.id) o.selected = true;
      sel.appendChild(o);
    });
    sel.hidden = !list.length;
    $("stg-ev-edit").hidden = !ev;
    $("stg-empty").hidden = !!ev;
    $("stg-main").hidden = !ev;
    if (!ev) { paint(true); return; }
    renderList();
    paint(true);
  }

  function renderList() {
    var ev = curEvent(), list = items(), now = Date.now();
    var sch = C.schedule(ev, list, run, now);
    var host = $("stg-list");
    host.innerHTML = "";
    if (!list.length) {
      host.appendChild(el("li", "stg-none", t("stg.none")));
      return;
    }
    list.forEach(function (it, i) {
      var r = sch.rows[i];
      var li = el("li", "stg-row st-" + r.state);
      li.setAttribute("data-id", it.id);
      var when = el("div", "stg-when");
      var main = r.planStart !== null ? r.planStart : r.expStart;
      when.appendChild(el("span", "stg-at", main !== null ? C.hm(main) : "—"));
      if (r.planStart !== null && r.expStart !== null && r.state === "todo" &&
          Math.abs(r.expStart - r.planStart) >= 60000) {
        when.appendChild(el("span", "stg-exp " + (r.expStart > r.planStart ? "late" : "early"), C.hm(r.expStart)));
      }
      li.appendChild(when);

      var body = el("button", "stg-body");
      body.type = "button";
      body.appendChild(el("span", "stg-t", it.title || t("stg.it.untitled", { n: i + 1 })));
      if (it.speaker) body.appendChild(el("span", "stg-s", it.speaker));
      var meta = durText(it);
      if (it.kind === "up") meta += " · " + t("stg.k.up").toLowerCase();
      if (it.kind === "clock") meta += " · " + t("stg.clock");
      if (r.state === "done" && r.actual) {
        var d = r.actual.e - r.actual.s;
        meta += " · " + t("stg.st.done", { d: C.fmt(d, true) });
      } else if (r.state === "skipped") meta += " · " + t("stg.st.skipped");
      else if (r.state === "live") meta += " · " + t("stg.st.live");
      body.appendChild(el("span", "stg-m", meta));
      body.addEventListener("click", function () { openItem(it.id); });
      li.appendChild(body);

      var tools = el("div", "stg-tools");
      var go = el("button", "stg-ib", "▶");
      go.type = "button"; go.setAttribute("aria-label", t("stg.go")); go.title = t("stg.go");
      go.addEventListener("click", function () { act("jump", it.id); });
      var up = el("button", "stg-ib", "↑");
      up.type = "button"; up.setAttribute("aria-label", t("stg.up")); up.title = t("stg.up");
      up.disabled = i === 0;
      up.addEventListener("click", function () { move(it.id, -1); });
      var dn = el("button", "stg-ib", "↓");
      dn.type = "button"; dn.setAttribute("aria-label", t("stg.down")); dn.title = t("stg.down");
      dn.disabled = i === list.length - 1;
      dn.addEventListener("click", function () { move(it.id, 1); });
      tools.appendChild(go); tools.appendChild(up); tools.appendChild(dn);
      li.appendChild(tools);
      host.appendChild(li);
    });
  }

  var lastPhase = {}, lastSec = -1, viewOpen = false, black = false;
  // paint(): the live parts, four times a second while visible.
  function paint(force) {
    var ev = curEvent();
    var paneOn = !$("pane-stage").hidden;
    if (!ev) { if (viewOpen) paintView(null, null, null, null); return; }
    if (!force && !paneOn && !viewOpen && !run.startedAt) return;
    var list = items(), now = Date.now();
    var sch = C.schedule(ev, list, run, now);
    var it = focusItem(list, sch);
    var tv = it ? C.timer(it, ev, run, now) : null;

    // auto-advance and sounds run while the app is open, on any tab
    if (it && tv && tv.started && !tv.paused) {
      var prev = lastPhase[it.id];
      if (prev && prev !== tv.phase) {
        if (tv.phase === "warn") beep(1, 660);
        else if (tv.phase === "red") beep(2, 880);
        else if (tv.phase === "over") beep(3, 990);
      }
      lastPhase[it.id] = tv.phase;
      if (it.auto && tv.remaining <= 0 && !(it.kind === "up" && tv.total === 0)) {
        var nx = C.neighbour(list, it.id, 1);
        run = nx ? C.select(run, nx, now, true) : C.finish(run, now);
        saveRun();
        render();
        return;
      }
    }

    var nextIt = null;
    if (it) {
      var idx = list.indexOf(it);
      nextIt = idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null;
    }
    var nextText = it ? (nextIt ? t("stg.nextup", { t: (nextIt.title || "") + (nextIt.speaker ? " — " + nextIt.speaker : "") }) : t("stg.last")) : "";

    if (paneOn || force) {
      $("stg-live-title").textContent = it ? (it.title || t("stg.it.untitled", { n: list.indexOf(it) + 1 })) : (list.length ? t("stg.done.all") : "");
      $("stg-live-spk").textContent = it ? it.speaker : "";
      var tx = timeText(it, tv, now);
      var tm = $("stg-time");
      tm.textContent = tx;
      tm.className = "stg-time ph-" + (tv ? tv.phase : "idle") + (tv && tv.paused ? " paused" : "") +
        (tv && tv.phase === "over" && ev.flash ? " flash" : "");
      $("stg-prog-bar").style.width = tv ? Math.round(tv.progress * 1000) / 10 + "%" : "0%";
      $("stg-prog-bar").className = tv ? "ph-" + tv.phase : "";
      $("stg-next").textContent = nextText;
      $("stg-go").textContent = !run.cur || !run.startedAt ? t("stg.start") : (run.pausedAt ? t("stg.resume") : t("stg.pause"));
      $("stg-go").disabled = !it;
      var sec = Math.floor(now / 1000);
      if (sec !== lastSec || force) {
        lastSec = sec;
        $("stg-sum").textContent = summary(sch);
        if (!force && sec % 15 === 0) renderList();
      }
    }
    if (viewOpen) paintView(it, tv, nextText, now);
  }
  function timeText(it, tv, now) {
    if (!it || !tv) return "--:--";
    if (it.kind === "clock") {
      var d = new Date(now);
      return C.hm(now) + ":" + (d.getSeconds() < 10 ? "0" : "") + d.getSeconds();
    }
    return it.kind === "up" ? C.fmt(tv.shown, true) : C.fmt(tv.shown);
  }
  function summary(sch) {
    if (sch.expEnd === null) return "";
    if (!sch.hasPlan) return t("stg.sum.exp", { e: C.hm(sch.expEnd) });
    var m = Math.round(sch.delta / 60000);
    var d = m >= 1 ? t("stg.sum.behind", { n: m }) : m <= -1 ? t("stg.sum.ahead", { n: -m }) : t("stg.sum.ontime");
    return t("stg.sum.plan", { p: C.hm(sch.planEnd), e: C.hm(sch.expEnd) }) + " · " + d;
  }

  /* ---------- 6. Stage view (what the speaker sees) ---------- */
  function paintView(it, tv, nextText, now) {
    var ev = curEvent();
    $("sv-title").textContent = it ? it.title : "";
    $("sv-spk").textContent = it ? it.speaker : "";
    var tx = timeText(it, tv, now || Date.now());
    var tm = $("sv-time");
    tm.textContent = tx;
    tm.className = "sv-time ph-" + (tv ? tv.phase : "idle") + (tx.length > 6 ? " long" : "") +
      (tv && tv.paused ? " paused" : "");
    $("stg-view").classList.toggle("flash", !!(tv && tv.phase === "over" && ev && ev.flash));
    $("sv-bar").style.width = tv ? Math.round(tv.progress * 1000) / 10 + "%" : "0%";
    $("sv-bar").className = tv ? "ph-" + tv.phase : "";
    $("sv-next").textContent = nextText || "";
    $("sv-clock").textContent = C.hm(now || Date.now());
  }
  function fsDoc() { try { return window.frameElement ? window.parent.document : document; } catch (e) { return document; } }
  function fsOn() { var d = fsDoc(); return !!(d.fullscreenElement || d.webkitFullscreenElement); }
  function fullscreen(on) {
    var d = fsDoc();
    try {
      if (!on) {
        if (!fsOn()) return;
        var x = d.exitFullscreen || d.webkitExitFullscreen;
        var p1 = x && x.call(d); if (p1 && p1.catch) p1.catch(function () {});
      } else if (!fsOn()) {
        var node = window.frameElement || document.documentElement;
        var f = node.requestFullscreen || node.webkitRequestFullscreen;
        var p2 = f && f.call(node); if (p2 && p2.catch) p2.catch(function () {});
      }
    } catch (e) {}
  }
  var toolsTimer = 0;
  function pokeTools() {
    $("sv-tools").classList.add("on");
    clearTimeout(toolsTimer);
    toolsTimer = setTimeout(function () { $("sv-tools").classList.remove("on"); }, 3000);
  }
  function openView() {
    if (!curEvent()) return;
    viewOpen = true;
    $("stg-view").hidden = false;
    fullscreen(true);
    pokeTools();
    paint(true);
  }
  function closeView() {
    viewOpen = false;
    setBlack(false);
    $("stg-view").hidden = true;
    fullscreen(false);
    try { $("stg-show").focus(); } catch (e) {}
  }
  function setBlack(on) {
    black = on;
    $("sv-black").hidden = !on;
  }
  $("stg-show").addEventListener("click", openView);
  $("sv-close").addEventListener("click", closeView);
  $("sv-fs").addEventListener("click", function () { fullscreen(!fsOn()); });
  $("sv-black-btn").addEventListener("click", function () { setBlack(!black); });
  $("sv-black").addEventListener("click", function () { setBlack(false); });
  $("stg-view").addEventListener("pointermove", pokeTools);
  $("stg-view").addEventListener("pointerdown", pokeTools);

  /* ---------- 7. Controls ---------- */
  $("stg-go").addEventListener("click", function () { act("go"); });
  $("stg-nxt").addEventListener("click", function () { act("next"); });
  $("stg-prev").addEventListener("click", function () { act("prev"); });
  $("stg-reset").addEventListener("click", function () { act("reset"); });
  // ±1 minute; a long press gives ±5
  function holdButton(id, sec) {
    var b = $(id), timer = 0, long = false;
    b.addEventListener("pointerdown", function () {
      long = false;
      clearTimeout(timer);
      timer = setTimeout(function () { long = true; act("add", sec * 5); }, 550);
    });
    ["pointerup", "pointerleave", "pointercancel"].forEach(function (ev) {
      b.addEventListener(ev, function () { clearTimeout(timer); });
    });
    b.addEventListener("click", function () {
      if (long) { long = false; return; }
      act("add", sec);
    });
  }
  holdButton("stg-plus", 60);
  holdButton("stg-minus", -60);
  $("stg-sound").addEventListener("change", function () {
    sound = this.checked;
    savePrefs();
    if (sound) beep(1, 660);
  });
  $("stg-ev").addEventListener("change", function () {
    // another event: the live item of this one stops here
    var r = C.finish(run, Date.now());
    setRun(Object.assign({}, r, { ev: this.value }));
  });

  function move(id, step) {
    var list = items();
    var i = -1;
    list.forEach(function (x, k) { if (x.id === id) i = k; });
    var j = i + step;
    if (i < 0 || j < 0 || j >= list.length) return;
    var others = list.filter(function (x) { return x.id !== id; });
    // new place: between the neighbours at index j in the list without it
    var before = j > 0 ? others[j - 1].pos : null;
    var after = j < others.length ? others[j].pos : null;
    var it = itemById(id);
    it.pos = C.posBetween(before, after);
    it.mtime = Date.now();
    save();
    render();
  }

  /* ---------- 8. Keyboard and presenter clickers ---------- */
  function stageActive() {
    return viewOpen || !$("pane-stage").hidden;
  }
  function typing(target) {
    if (!target) return false;
    var tag = target.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
  }
  function dialogOpen() {
    return $("stg-ev-dlg").open || $("stg-it-dlg").open || !!document.querySelector("dialog[open]");
  }
  document.addEventListener("keydown", function (e) {
    if (!stageActive() || e.ctrlKey || e.metaKey || e.altKey) return;
    if (typing(e.target) || dialogOpen()) return;
    var k = e.key, done = true;
    if (k === " " || k === "Spacebar") act("go");
    else if (k === "ArrowRight" || k === "PageDown") act("next");
    else if (k === "ArrowLeft" || k === "PageUp") act("prev");
    else if (k === "+" || k === "=") act("add", 60);
    else if (k === "-" || k === "_") act("add", -60);
    else if (k === "b" || k === "B" || k === ".") { if (!viewOpen) openView(); setBlack(!black); }
    else if (k === "f" || k === "F") { if (viewOpen) fullscreen(!fsOn()); else openView(); }
    else if (k === "Escape" && viewOpen) { if (black) setBlack(false); else closeView(); }
    else done = false;
    if (done) { e.preventDefault(); if (viewOpen) pokeTools(); }
  });
  // Space on a focused button would also "click" it on key up.
  document.addEventListener("keyup", function (e) {
    if ((e.key === " " || e.key === "Spacebar") && stageActive() && e.target && e.target.tagName === "BUTTON" &&
        !dialogOpen()) e.preventDefault();
  });

  /* ---------- 9. Event dialog ---------- */
  var editEv = null, armed = "";
  function minutes(sec) { return Math.round(sec / 30) / 2; }
  function readMinutes(input, dflt) {
    var v = parseFloat(String(input.value).replace(",", "."));
    if (!isFinite(v) || v < 0) return dflt;
    return Math.min(3600, Math.round(v * 60));
  }
  function disarm() {
    armed = "";
    $("se-del").textContent = t("stg.ev.del");
    $("si-del").textContent = t("stg.it.del");
  }
  function openEvent(id) {
    var ev = id ? evById(id) : null;
    editEv = ev ? ev.id : null;
    disarm();
    $("stg-ev-h").textContent = t(ev ? "stg.ev.h.edit" : "stg.ev.h.new");
    $("se-name").value = ev ? ev.name : "";
    $("se-date").value = ev ? ev.date : today();
    $("se-start").value = ev ? ev.start : "";
    $("se-yellow").value = minutes(ev ? ev.yellow : C.DEF_YELLOW);
    $("se-red").value = minutes(ev ? ev.red : C.DEF_RED);
    $("se-flash").checked = ev ? ev.flash : true;
    $("se-dup").hidden = !ev;
    $("se-del").hidden = !ev;
    $("stg-ev-dlg").showModal();
    $("se-name").focus();
  }
  $("stg-ev-new").addEventListener("click", function () { openEvent(null); });
  $("stg-empty-new").addEventListener("click", function () { openEvent(null); });
  $("stg-ev-edit").addEventListener("click", function () { var ev = curEvent(); if (ev) openEvent(ev.id); });
  $("se-cancel").addEventListener("click", function () { $("stg-ev-dlg").close(); });
  $("se-save").addEventListener("click", function () {
    var old = editEv ? evById(editEv) : null;
    var next = C.normEvent({
      id: old ? old.id : newId(),
      name: $("se-name").value.trim() || t("stg.ev.untitled"),
      date: $("se-date").value,
      start: $("se-start").value,
      yellow: readMinutes($("se-yellow"), C.DEF_YELLOW),
      red: readMinutes($("se-red"), C.DEF_RED),
      flash: $("se-flash").checked,
      mtime: 0
    });
    $("stg-ev-dlg").close();
    if (!next) return;
    // a zero-edit close stamps nothing
    if (old && JSON.stringify(Object.assign({}, old, { mtime: 0 })) === JSON.stringify(next)) return;
    next.mtime = Date.now();
    data.events = data.events.filter(function (e) { return e.id !== next.id; }).concat([next]);
    save();
    if (!old) run = Object.assign({}, C.finish(run, Date.now()), { ev: next.id });
    saveRun();
    render();
  });
  $("se-dup").addEventListener("click", function () {
    var ev = editEv ? evById(editEv) : null;
    if (!ev) return;
    var now = Date.now();
    var copy = Object.assign({}, ev, { id: newId(), name: t("stg.ev.copy", { name: ev.name }).slice(0, 120), mtime: now });
    var its = C.rundown(data, ev.id).map(function (it) {
      return Object.assign({}, it, { id: newId(), ev: copy.id, mtime: now });
    });
    data.events = data.events.concat([copy]);
    data.items = data.items.concat(its);
    save();
    $("stg-ev-dlg").close();
    run = Object.assign({}, C.finish(run, now), { ev: copy.id });
    saveRun();
    render();
  });
  $("se-del").addEventListener("click", function () {
    if (armed !== "ev") { armed = "ev"; this.textContent = t("stg.ev.delq"); return; }
    var id = editEv, now = Date.now();
    var gone = [id].concat(C.rundown(data, id).map(function (it) { return it.id; }));
    data.events = data.events.filter(function (e) { return e.id !== id; });
    data.items = data.items.filter(function (it) { return it.ev !== id; });
    data.tombs = data.tombs.filter(function (d) { return gone.indexOf(d.id) < 0; })
      .concat(gone.map(function (g) { return { id: g, t: now }; }));
    save();
    $("stg-ev-dlg").close();
    run = Object.assign({}, C.normRun({}), { ev: "" });
    saveRun();
    render();
  });

  /* ---------- 10. Item dialog ---------- */
  var editIt = null;
  function kindUi() {
    var k = $("si-kind").value;
    var until = k === "until";
    $("si-until").hidden = !until; $("si-until-l").hidden = !until;
    $("si-dur-w").hidden = until; $("si-dur-l").hidden = until;
  }
  $("si-kind").addEventListener("change", kindUi);
  function openItem(id) {
    var it = id ? itemById(id) : null;
    editIt = it ? it.id : null;
    disarm();
    $("stg-it-h").textContent = t(it ? "stg.it.h.edit" : "stg.it.h.new");
    $("si-title").value = it ? it.title : "";
    $("si-spk").value = it ? it.speaker : "";
    $("si-kind").value = it ? it.kind : "down";
    var dur = it ? it.dur : 600;
    $("si-min").value = Math.floor(dur / 60);
    $("si-sec").value = dur % 60;
    $("si-until").value = it ? it.until : "";
    $("si-yellow").value = it && it.yellow !== null ? minutes(it.yellow) : "";
    $("si-red").value = it && it.red !== null ? minutes(it.red) : "";
    $("si-auto").checked = it ? it.auto : false;
    $("si-notes").value = it ? it.notes : "";
    $("si-del").hidden = !it;
    kindUi();
    $("stg-it-dlg").showModal();
    $("si-title").focus();
  }
  $("stg-add").addEventListener("click", function () { openItem(null); });
  $("si-cancel").addEventListener("click", function () { $("stg-it-dlg").close(); });
  $("si-save").addEventListener("click", function () {
    var ev = curEvent();
    if (!ev) return;
    var old = editIt ? itemById(editIt) : null;
    var list = items();
    var mins = parseInt($("si-min").value, 10), ss = parseInt($("si-sec").value, 10);
    var dur = (isFinite(mins) ? Math.max(0, mins) : 0) * 60 + (isFinite(ss) ? Math.max(0, Math.min(59, ss)) : 0);
    var opt = function (input) { return String(input.value).trim() === "" ? null : readMinutes(input, null); };
    var next = C.normItem({
      id: old ? old.id : newId(),
      ev: old ? old.ev : ev.id,
      pos: old ? old.pos : C.posBetween(list.length ? list[list.length - 1].pos : null, null),
      title: $("si-title").value,
      speaker: $("si-spk").value,
      kind: $("si-kind").value,
      dur: dur,
      until: $("si-until").value,
      auto: $("si-auto").checked,
      yellow: opt($("si-yellow")),
      red: opt($("si-red")),
      notes: $("si-notes").value,
      mtime: 0
    });
    $("stg-it-dlg").close();
    if (!next) return;
    if (old && JSON.stringify(Object.assign({}, old, { mtime: 0 })) === JSON.stringify(next)) return;
    next.mtime = Date.now();
    data.items = data.items.filter(function (x) { return x.id !== next.id; }).concat([next]);
    save();
    render();
  });
  $("si-del").addEventListener("click", function () {
    if (armed !== "it") { armed = "it"; this.textContent = t("stg.it.delq"); return; }
    var id = editIt, now = Date.now();
    data.items = data.items.filter(function (x) { return x.id !== id; });
    data.tombs = data.tombs.filter(function (d) { return d.id !== id; }).concat([{ id: id, t: now }]);
    save();
    $("stg-it-dlg").close();
    if (run.cur === id) run = Object.assign({}, run, { cur: "", startedAt: 0, pausedAt: 0, adj: 0 });
    saveRun();
    render();
  });
  ["stg-ev-dlg", "stg-it-dlg"].forEach(function (id) {
    // a click on the backdrop (outside the box) closes it; the box's
    // own padding is part of the dialog element, so test the rect
    $(id).addEventListener("click", function (ev) {
      if (ev.target !== this) return;
      var r = this.getBoundingClientRect();
      if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) this.close();
    });
    $(id).addEventListener("close", disarm);
  });

  /* ---------- 11. Sync slice "stage" ---------- */
  // Pull-fed setter: adopt the merged copy, persist, repaint. Never
  // markDirty (pull -> set -> push would loop).
  function setFromSync(incoming) {
    if (!incoming || typeof incoming !== "object") return;
    data = C.canon(incoming);
    try { localStorage.setItem(DATA_KEY, JSON.stringify(data)); } catch (e) {}
    if ($("stg-it-dlg").open && editIt && !itemById(editIt)) $("stg-it-dlg").close();
    if ($("stg-ev-dlg").open && editEv && !evById(editEv)) $("stg-ev-dlg").close();
    if (run.cur && !itemById(run.cur)) { run = Object.assign({}, run, { cur: "", startedAt: 0, pausedAt: 0, adj: 0 }); saveRun(); }
    render();
  }
  try {
    var api = window.parent && window.parent.orosSync;
    if (api && typeof api.registerSlice === "function") {
      api.registerSlice(
        "stage",
        function () { return C.canon(readJSON(DATA_KEY) || data); },
        setFromSync,
        DATA_KEY,
        C.merge
      );
    }
  } catch (e) { /* standalone preview: no sync */ }

  /* ---------- 12. Boot ---------- */
  applyI18n();
  $("stg-sound").checked = sound;
  render();
  // the tab buttons of time.js switch panes; repaint when Stage shows
  var tabs = document.querySelectorAll(".tab");
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].addEventListener("click", function () { if (this.getAttribute("data-pane") === "pane-stage") render(); });
  }
  setInterval(function () { paint(false); }, 250);
})();
