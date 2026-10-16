// ============================================================
// orOS Sticky Notes — App logic (v1.1.0)
// The notes live on the desktop (stickies/host.js, shell side); this
// app is the list of every note, the Faded bin and the settings.
//   - On the desktop: every note, newest first, search; Edit opens
//     the shell's note editor over the app, Show goes to the desktop
//   - Faded: notes that faded (kept 7 days): Restore, Delete now
//   - Settings: show the notes on this desktop, ring sound (a chime
//     or a Ringtone Composer melody), a sound
//     when a note fades, colour of new notes (all device-local);
//     tidy up the desktop, export as text, save / open an orOS file
//     (.orosstickies, ../recordpkg.js + package.js)
// The app never writes the data itself: every change goes through
// window.parent.orosStickies, the single writer of the synced slice
// "stickies" (oros-stickies-data).
// Sections:
//   1. Constants, i18n, helpers
//   2. Host
//   3. Lists
//   4. Settings
//   5. Tabs, toasts, keyboard
//   6. Palette, wiring & boot
// ============================================================
(function () {
  "use strict";

  var C = window.StickiesCore;
  var VIEWS = ["notes", "faded"];

  // ---------- 1. Constants, i18n, helpers ----------
  function appLang() {
    try {
      var l = localStorage.getItem("oros-lang") ||
              (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  var LANG = appLang();
  var LOCALE = LANG === "el" ? "el-GR" : "en-GB";

  var STRINGS = {
    en: {
      "app.name": "Sticky Notes",
      "sub.count": "{n} on the desktop", "sub.count1": "1 on the desktop", "sub.none": "No notes on the desktop",
      "btn.new": "New note", "btn.more": "Sticky Notes settings", "btn.close": "Close",
      "btn.edit": "Edit", "btn.show": "Show", "btn.delete": "Delete", "btn.restore": "Restore", "btn.deleteNow": "Delete now",
      "btn.test": "Play", "btn.tidy": "Tidy up the desktop", "btn.export": "Export as text",
      "tab.notes": "On the desktop", "tab.faded": "Faded",
      "f.search": "Search your notes", "ph.search": "Search your notes",
      "empty": "No sticky notes yet. New note puts one on the desktop; you can also right-click the desktop or press Ctrl+Alt+Shift+N.",
      "empty.search": "No note has these words.",
      "hidden": "Sticky notes are hidden on this device's desktop (Settings). Edit still works from here.",
      "faded.hint": "Notes that faded stay here for 7 days. Restore puts one back on the desktop.",
      "faded.empty": "Nothing has faded.",
      "faded.when": "Faded {when} · deleted {left}",
      "left.days": "in {n} days", "left.day": "tomorrow", "left.today": "today",
      "rings": "Rings {when}", "ringing": "Ringing", "vanishes": "Vanishes {when}", "vanishDone": "Vanishes when the ring is done",
      "note.empty": "(empty)",
      "more.title": "Sticky Notes settings", "sec.desk": "On this device", "sec.tools": "Notes",
      "set.show": "Show sticky notes on the desktop", "set.sound": "Ring sound",
      "snd.bell": "Bell", "snd.dingdong": "Ding-dong", "snd.wind": "Wind chime", "snd.off": "No sound",
      "set.pop": "A soft sound when a note fades", "set.color": "Colour of new notes",
      "snd.melodies": "Your melodies (Ringtone Composer)", "snd.gone": "A melody that was deleted (the bell plays)",
      "rep.daily": "every day", "rep.weekdays": "Mon–Fri", "rep.weekly": "every week",
      "set.hint": "These settings stay on this device. The notes themselves follow you to every device through orOS sync.",
      "c.yellow": "Yellow", "c.pink": "Pink", "c.green": "Green", "c.blue": "Blue", "c.orange": "Orange", "c.lilac": "Lilac",
      "standalone": "Sticky Notes lives on the orOS desktop. Open it from inside orOS.",
      "toast.full": "60 notes are on the desktop. Delete one first.",
      "toast.restored": "Back on the desktop", "toast.file": "Saved", "toast.tidyPhone": "On a phone the notes are a row of cards, already tidy.",
      "toast.nothing": "No notes to export",
      "file.save": "orOS file (.orosstickies)", "file.open": "Open orOS file…", "file.folder": "Unzipped orOS folder…",
      "aria.note": "Note: {text}"
    },
    el: {
      "app.name": "Post-it",
      "sub.count": "{n} στην επιφάνεια", "sub.count1": "1 στην επιφάνεια", "sub.none": "Κανένα post-it στην επιφάνεια",
      "btn.new": "Νέο post-it", "btn.more": "Ρυθμίσεις για τα post-it", "btn.close": "Κλείσιμο",
      "btn.edit": "Επεξεργασία", "btn.show": "Εμφάνιση", "btn.delete": "Διαγραφή", "btn.restore": "Επαναφορά", "btn.deleteNow": "Διαγραφή τώρα",
      "btn.test": "Άκουσμα", "btn.tidy": "Τακτοποίηση της επιφάνειας", "btn.export": "Εξαγωγή ως κείμενο",
      "tab.notes": "Στην επιφάνεια", "tab.faded": "Ξεθωριασμένα",
      "f.search": "Αναζήτηση στα post-it", "ph.search": "Αναζήτηση στα post-it",
      "empty": "Δεν υπάρχουν ακόμα post-it. Το «Νέο post-it» βάζει ένα στην επιφάνεια· μπορείς επίσης να κάνεις δεξί κλικ στην επιφάνεια ή να πατήσεις Ctrl+Alt+Shift+N.",
      "empty.search": "Κανένα post-it δεν έχει αυτές τις λέξεις.",
      "hidden": "Τα post-it είναι κρυμμένα από την επιφάνεια αυτής της συσκευής (Ρυθμίσεις). Η επεξεργασία δουλεύει κανονικά από εδώ.",
      "faded.hint": "Τα post-it που ξεθώριασαν μένουν εδώ 7 μέρες. Η «Επαναφορά» τα ξαναβάζει στην επιφάνεια.",
      "faded.empty": "Δεν έχει ξεθωριάσει τίποτα.",
      "faded.when": "Ξεθώριασε {when} · σβήνεται {left}",
      "left.days": "σε {n} μέρες", "left.day": "αύριο", "left.today": "σήμερα",
      "rings": "Χτυπάει {when}", "ringing": "Χτυπάει", "vanishes": "Εξαφανίζεται {when}", "vanishDone": "Εξαφανίζεται όταν πατήσεις «Έγινε»",
      "note.empty": "(κενό)",
      "more.title": "Ρυθμίσεις για τα post-it", "sec.desk": "Σε αυτή τη συσκευή", "sec.tools": "Post-it",
      "set.show": "Εμφάνιση των post-it στην επιφάνεια εργασίας", "set.sound": "Ήχος κουδουνίσματος",
      "snd.bell": "Καμπανάκι", "snd.dingdong": "Ντινγκ-ντονγκ", "snd.wind": "Καμπανάκια ανέμου", "snd.off": "Χωρίς ήχο",
      "set.pop": "Απαλός ήχος όταν ξεθωριάζει ένα post-it", "set.color": "Χρώμα για τα νέα post-it",
      "snd.melodies": "Οι μελωδίες σου (Συνθέτης ήχων κλήσης)", "snd.gone": "Μελωδία που διαγράφηκε (παίζει το κουδούνι)",
      "rep.daily": "κάθε μέρα", "rep.weekdays": "Δευ–Παρ", "rep.weekly": "κάθε εβδομάδα",
      "set.hint": "Αυτές οι ρυθμίσεις μένουν σε αυτή τη συσκευή. Τα ίδια τα post-it σε ακολουθούν σε κάθε συσκευή μέσω του συγχρονισμού του orOS.",
      "c.yellow": "Κίτρινο", "c.pink": "Ροζ", "c.green": "Πράσινο", "c.blue": "Μπλε", "c.orange": "Πορτοκαλί", "c.lilac": "Λιλά",
      "standalone": "Τα post-it ζουν στην επιφάνεια εργασίας του orOS. Άνοιξε την εφαρμογή μέσα από το orOS.",
      "toast.full": "Στην επιφάνεια υπάρχουν 60 post-it. Διάγραψε πρώτα ένα.",
      "toast.restored": "Ξανά στην επιφάνεια", "toast.file": "Αποθηκεύτηκε", "toast.tidyPhone": "Στο κινητό τα post-it είναι μια σειρά από καρτέλες, ήδη τακτοποιημένες.",
      "toast.nothing": "Δεν υπάρχουν post-it για εξαγωγή",
      "file.save": "Αρχείο orOS (.orosstickies)", "file.open": "Άνοιγμα αρχείου orOS…", "file.folder": "Αποσυμπιεσμένος φάκελος orOS…",
      "aria.note": "Post-it: {text}"
    }
  };

  function t(key, params) {
    var p = STRINGS[LANG] || STRINGS.en;
    var s = p[key] !== undefined ? p[key] : (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
    if (params) Object.keys(params).forEach(function (k) { s = s.split("{" + k + "}").join(String(params[k])); });
    return s;
  }
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function setLabel(b, label) { b.setAttribute("aria-label", label); b.title = label; }
  function hm(d) { try { return d.toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit", hour12: false }); } catch (e) { return ""; } }
  function when(ms) {
    var d = new Date(ms), now = new Date();
    var day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    var dd = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - day0) / 86400000);
    if (dd === 0) return (LANG === "el" ? "σήμερα " : "today ") + hm(d);
    if (dd === 1) return (LANG === "el" ? "αύριο " : "tomorrow ") + hm(d);
    if (dd === -1) return (LANG === "el" ? "χθες " : "yesterday ") + hm(d);
    try { return d.toLocaleDateString(LOCALE, { weekday: "short", day: "numeric", month: "numeric" }).replace(",", "") + " " + hm(d); }
    catch (e) { return ""; }
  }

  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "").match(/[?&]v=([^&#]+)/);
    document.documentElement.lang = LANG;
    console.log("stickies.js v" + (m ? m[1] : "?") + " boot");
  })();

  // ---------- 2. Host ----------
  function host() {
    try {
      var h = window.parent && window.parent !== window ? window.parent.orosStickies : null;
      return h && typeof h.data === "function" ? h : null;
    } catch (e) { return null; }
  }
  var H = host();
  function data() { return H ? H.data() : C.empty(); }

  // ---------- 3. Lists ----------
  var ICON = {
    more: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'
  };

  function preview(n) {
    if (!n.text) return t("note.empty");
    return C.lines(n.text).map(function (l) { return l.box ? (l.done ? "☑ " : "☐ ") + l.text : l.text; }).join("\n");
  }
  function action(label, fn, cls) {
    var b = el("button", "chip" + (cls ? " " + cls : ""), label);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }

  function renderNotes() {
    var d = data(), now = Date.now(), q = $("q").value.trim();
    var all = C.newestFirst(C.live(d));
    var list = q ? all.filter(function (n) { return C.matches(n, q); }) : all;
    var ul = $("list");
    ul.textContent = "";
    list.forEach(function (n) {
      var li = el("li", "note c-" + n.color);
      li.setAttribute("aria-label", t("aria.note", { text: C.firstLine(n.text) || t("note.empty") }));
      li.appendChild(el("div", "txt", preview(n)));
      var meta = [];
      if (n.ring) meta.push((n.ring.at <= now ? "🔔 " + t("ringing") : "🔔 " + t("rings", { when: when(n.ring.at) })) +
        (n.ring.rep ? " ↻ " + t("rep." + n.ring.rep) : ""));
      if (n.vanish) meta.push("⏳ " + (n.vanish.at ? t("vanishes", { when: when(n.vanish.at) }) : t("vanishDone")));
      if (meta.length) li.appendChild(el("div", "meta", meta.join(" · ")));
      var acts = el("div", "acts");
      acts.appendChild(action(t("btn.edit"), function () { H.edit(n.id); }, "pri"));
      if (H.prefs().show) acts.appendChild(action(t("btn.show"), function () { H.show(n.id); }));
      acts.appendChild(action(t("btn.delete"), function () { H.remove(n.id); }, "danger"));
      li.appendChild(acts);
      ul.appendChild(li);
    });
    $("empty").hidden = list.length > 0;
    $("empty").textContent = q && all.length ? t("empty.search") : t("empty");
    $("hidden-hint").hidden = H.prefs().show;
    $("hidden-hint").textContent = t("hidden");
    var c = all.length;
    $("title-sub").textContent = c === 0 ? t("sub.none") : c === 1 ? t("sub.count1") : t("sub.count", { n: c });
  }

  function leftText(n, now) {
    var days = Math.ceil((C.purgeAt(n) - now) / 86400000);
    if (days <= 0) return t("left.today");
    if (days === 1) return t("left.day");
    return t("left.days", { n: days });
  }
  function renderFaded() {
    var d = data(), now = Date.now(), list = C.faded(d), ul = $("faded-list");
    ul.textContent = "";
    list.forEach(function (n) {
      var li = el("li", "note faded c-" + n.color);
      li.setAttribute("aria-label", t("aria.note", { text: C.firstLine(n.text) || t("note.empty") }));
      li.appendChild(el("div", "txt", preview(n)));
      li.appendChild(el("div", "meta", t("faded.when", { when: when(n.faded), left: leftText(n, now) })));
      var acts = el("div", "acts");
      acts.appendChild(action(t("btn.restore"), function () {
        if (C.live(data()).length >= C.MAX_NOTES) { showToast(t("toast.full")); return; }
        if (H.restore(n.id)) showToast(t("toast.restored"));
      }, "pri"));
      acts.appendChild(action(t("btn.deleteNow"), function () { H.remove(n.id); }, "danger"));
      li.appendChild(acts);
      ul.appendChild(li);
    });
    $("faded-empty").hidden = list.length > 0;
    $("tab-faded").textContent = t("tab.faded") + (list.length ? " (" + list.length + ")" : "");
  }
  function renderAll() { renderNotes(); renderFaded(); }

  // ---------- 4. Settings ----------
  var lastFocus = null;
  function openMore() {
    lastFocus = document.activeElement;
    fillMore();
    $("scrim").hidden = false;
    $("more").hidden = false;
    $("more-close").focus();
  }
  function closeMore() {
    $("scrim").hidden = true;
    $("more").hidden = true;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  // Built-in chimes, then the melodies of Ringtone Composer (read by
  // the host from oros-ringtones-data; nothing is copied here).
  function fillSounds(cur) {
    var sel = $("sound-sel");
    [].slice.call(sel.querySelectorAll("optgroup.mel, option.mel")).forEach(function (o) { o.remove(); });
    var list = [];
    try { list = typeof H.melodies === "function" ? H.melodies() : []; } catch (e) { list = []; }
    var g = null;
    if (list.length) {
      g = document.createElement("optgroup");
      g.className = "mel";
      g.label = t("snd.melodies");
      list.forEach(function (m) {
        var o = document.createElement("option");
        o.value = "rt:" + m.id;
        o.textContent = m.name || "♪";
        g.appendChild(o);
      });
      sel.appendChild(g);
    }
    if (/^rt:/.test(cur) && !list.some(function (m) { return "rt:" + m.id === cur; })) {
      var gone = document.createElement("option");
      gone.className = "mel";
      gone.value = cur;
      gone.textContent = t("snd.gone");
      sel.appendChild(gone);
    }
    sel.value = cur;
  }
  function fillMore() {
    var p = H.prefs();
    $("show-on").checked = p.show;
    fillSounds(p.sound);
    $("pop-on").checked = p.pop;
    [].forEach.call($("colors").children, function (b) {
      var on = b.getAttribute("data-c") === p.color;
      b.setAttribute("aria-checked", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
    });
  }
  function buildColors() {
    C.COLORS.forEach(function (c) {
      var b = el("button", "sw c-" + c);
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("data-c", c);
      setLabel(b, t("c." + c));
      b.addEventListener("click", function () { H.setPref("color", c); fillMore(); });
      b.addEventListener("keydown", function (e) {
        var d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        var i = (C.COLORS.indexOf(c) + d + C.COLORS.length) % C.COLORS.length;
        H.setPref("color", C.COLORS[i]);
        fillMore();
        $("colors").children[i].focus();
      });
      $("colors").appendChild(b);
    });
  }

  function dialogHost() {
    try { return (window.parent && window.parent.orosDialog) || window.orosDialog || null; }
    catch (e) { return window.orosDialog || null; }
  }
  function exportText() {
    var d = data();
    if (!C.live(d).length) { showToast(t("toast.nothing")); return; }
    var blob = new Blob([H.exportText()], { type: "text/plain" });
    var name = "sticky-notes-" + new Date().toISOString().slice(0, 10) + ".txt";
    var dlg = dialogHost();
    if (dlg && typeof dlg.saveFile === "function") {
      dlg.saveFile({ blob: blob, filename: name, mime: "text/plain", types: [{ description: "TXT", accept: { "text/plain": [".txt"] } }] })
        .then(function (r) { if (r && r.ok) showToast(t("toast.file")); });
      return;
    }
    var url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 40000);
    showToast(t("toast.file"));
  }

  // .orosstickies (OBF-4e): every note on the desktop as one orOS file
  // (../recordpkg.js + package.js). Opening ADDS the notes this device
  // lacks, with their ids; a note already here (or deleted here) is
  // kept as it is unless "Update with newer versions" is ticked. The
  // app still never writes: the shell's host.js merges the result in
  // (H.addFromFile → its commit, so sync carries it), and Undo removes
  // the added notes there like Delete (H.removeAdded, tombstones).
  // Positions stay device-local: an added note gets a free spot.
  var RP = window.OrosRecordPkg || null, SPK = window.OrosStickiesPackage || null;
  var lastAdded = [];
  var recFile = H && RP && SPK && window.OrosBundle ? RP.ui(SPK.DESC, {
    lang: function () { return LANG; },
    get: function () { return SPK.stamped(data()); },
    title: function () { return t("app.name"); },
    set: function (next, info) {
      lastAdded = (info && info.addedIds || []).slice();
      H.addFromFile(next);
    },
    deleteIds: function (ids) { H.removeAdded(ids); },
    toast: function (text, undo) {
      if (undo && typeof H.fileAdded === "function") H.fileAdded(text, lastAdded);
      else showToast(text);
    }
  }) : null;

  // ---------- 5. Tabs, toasts, keyboard ----------
  var view = "notes";
  function showView(v) {
    view = VIEWS.indexOf(v) >= 0 ? v : "notes";
    VIEWS.forEach(function (k) {
      var on = k === view, tab = $("tab-" + k);
      $("v-" + k).hidden = !on;
      tab.setAttribute("aria-selected", on ? "true" : "false");
      tab.tabIndex = on ? 0 : -1;
      tab.classList.toggle("on", on);
    });
  }

  function showToast(text) {
    try {
      var n = (window.parent && window.parent !== window && window.parent.orosNotifs) || null;
      if (n && typeof n.transient === "function" && n.transient({ ns: "stickies", title: String(text) })) return;
    } catch (e) {}
    var box = $("toast");
    box.textContent = text;
    box.classList.remove("show");
    void box.offsetWidth;
    box.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(function () { box.classList.remove("show"); }, 4000);
  }

  function wireKeyboard() {
    // Contract Β: forward Ctrl+Alt+Shift shortcuts to the shell (capture)
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
      var p = null;
      try { p = window.parent; } catch (err) { return; }
      if (!(p && p !== window && p.orosShortcuts && typeof p.orosShortcuts.handle === "function")) return;
      if (p.orosShortcuts.handle(e)) e.stopPropagation();
    }, true);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !$("more").hidden) { e.preventDefault(); closeMore(); }
    });
    $("tabs").addEventListener("keydown", function (e) {
      var d = e.key === "ArrowRight" ? 1 : (e.key === "ArrowLeft" ? -1 : 0);
      if (!d) return;
      e.preventDefault();
      var i = (VIEWS.indexOf(view) + d + VIEWS.length) % VIEWS.length;
      showView(VIEWS[i]);
      $("tab-" + VIEWS[i]).focus();
    });
  }

  // ---------- 6. Palette, wiring & boot ----------
  var PAL_VARS = ["--bg", "--bg-desktop", "--bar-bg", "--text", "--text-dim",
                  "--accent", "--accent-hover", "--accent-soft",
                  "--panel-bg", "--border", "--shadow", "--danger"];
  function inheritPalette() {
    try {
      var pRoot = window.parent.document.documentElement;
      document.documentElement.setAttribute("data-theme", pRoot.getAttribute("data-theme") || "dark");
      var cs = window.parent.getComputedStyle(pRoot);
      PAL_VARS.forEach(function (v) {
        var val = cs.getPropertyValue(v).trim();
        if (val) document.documentElement.style.setProperty(v, val);
      });
    } catch (e) { /* standalone */ }
  }
  function watchPalette() {
    try {
      new MutationObserver(inheritPalette).observe(window.parent.document.documentElement,
        { attributes: true, attributeFilter: ["data-skin", "data-theme"] });
    } catch (e) { /* standalone */ }
  }

  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) { n.textContent = t(n.getAttribute("data-i18n")); });
    document.title = t("app.name") + " · orOS";
    $("more-btn").innerHTML = ICON.more; setLabel($("more-btn"), t("btn.more"));
    $("more-close").innerHTML = ICON.close; setLabel($("more-close"), t("btn.close"));
    $("q").placeholder = t("ph.search");
  }

  // Deep link: { note } opens that note's editor. "Open with" an
  // .orosstickies file (fileopen.js): { openFile: { token } }, the File
  // taken once with window.parent.__orosTakeFile(token) (recFile).
  window.__orosOpenAt = function (target) {
    if (!H || !target || typeof target !== "object") return;
    if (target.openFile) { if (recFile) recFile.openTarget(target.openFile); return; }
    if (typeof target.note === "string") H.edit(target.note);
  };

  function boot() {
    applyI18n();
    inheritPalette();
    watchPalette();
    if (!H) {
      ["toolbar", "tabs", "v-notes", "v-faded"].forEach(function (id) { $(id).hidden = true; });
      $("standalone").hidden = false;
      return;
    }
    buildColors();
    $("new-btn").addEventListener("click", function () { H.newNote(); });
    $("more-btn").addEventListener("click", openMore);
    $("more-close").addEventListener("click", closeMore);
    $("scrim").addEventListener("click", closeMore);
    $("show-on").addEventListener("change", function () { H.setPref("show", $("show-on").checked); renderNotes(); });
    $("sound-sel").addEventListener("change", function () { H.setPref("sound", $("sound-sel").value); });
    $("sound-test").addEventListener("click", function () { H.testSound($("sound-sel").value === "off" ? "bell" : $("sound-sel").value); });
    $("pop-on").addEventListener("change", function () { H.setPref("pop", $("pop-on").checked); });
    $("tidy-btn").addEventListener("click", function () { if (!H.tidy()) showToast(t("toast.tidyPhone")); });
    $("exp-btn").addEventListener("click", exportText);
    [["file-save", "file.save", function () { recFile.save(); }],
     ["file-open", "file.open", function () { recFile.open(); }],
     ["file-folder", "file.folder", function () { recFile.openFolder(); }]].forEach(function (b) {
      var btn = $(b[0]);
      if (!btn || !recFile) return;
      btn.textContent = t(b[1]);
      btn.hidden = false;
      btn.addEventListener("click", function () { closeMore(); b[2](); });
    });
    var qt = null;
    $("q").addEventListener("input", function () { clearTimeout(qt); qt = setTimeout(renderNotes, 150); });
    VIEWS.forEach(function (v) { $("tab-" + v).addEventListener("click", function () { showView(v); }); });
    wireKeyboard();
    var off = H.onChange(function () { renderAll(); if (!$("more").hidden) fillMore(); });
    window.addEventListener("pagehide", function () { try { off(); } catch (e) {} });
    showView("notes");
    renderAll();
    setInterval(renderAll, 60000);              // "today 20:00" and the Faded countdown stay right
    try {
      if (window.parent && window.parent !== window && typeof window.parent.__orosTakeTarget === "function") {
        var pending = window.parent.__orosTakeTarget("stickies");
        if (pending) window.__orosOpenAt(pending);
      }
    } catch (e) {}
  }

  boot();
})();
