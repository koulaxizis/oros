// ============================================================
// orOS Time — Stage: rundown tools (v1.3.0, wave 4)
//   Quick add   ready-made items ("Keynote 20 + Q&A 10", "Panel 45"…)
//   Import      a rundown from a CSV file (title, speaker, duration,
//               start; a header row in English or Greek, or that
//               order) or from a day of the orOS Calendar (timed
//               events in order, the gaps as breaks). Always added to
//               the end of the open event; nothing is replaced.
//   Export      the rundown as CSV (reads back with Import).
//   Report      planned vs actual per item from this device's record
//               of the day (oros-time-stage-run, device-local); CSV
//               and a print view (PDF through the browser).
// The logic is OrosStageCore (csvPlan, calPlan, toCsv, report,
// reportCsv); the page writes through window.OrosStage.addPlan only.
// A file is read as text and parsed as data, never run; everything is
// drawn with textContent.
// ============================================================
(function () {
  "use strict";
  var C = window.OrosStageCore, S = window.OrosStage;
  if (!C || !S || !document.getElementById("st-imp-dlg")) return;

  var LANG = S.lang || "en";     // the full code (stage.js, orosI18n)
  var MAX_BYTES = 2 * 1024 * 1024;
  var STR = {
    en: {
      "st.quick": "Quick add", "st.import": "Import…", "st.export": "Export CSV", "st.report": "Report",
      "st.close": "Close",
      "st.q.talk": "Talk", "st.q.keynote": "Keynote", "st.q.qa": "Q&A", "st.q.panel": "Panel",
      "st.q.break": "Coffee break", "st.q.lunch": "Lunch", "st.q.added": "Added: {t}",
      "st.imp.h": "Import a rundown", "st.imp.into": "The items are added to the end of the open event.",
      "st.imp.csv": "From a CSV file",
      "st.imp.csvh": "Columns title, speaker, duration, start, or a header row that names them (English or Greek). Duration: minutes (20), mm:ss (12:30) or h:mm:ss.",
      "st.imp.pick": "Choose a file…",
      "st.imp.cal": "From a Calendar day", "st.imp.calh": "The day's timed events in order; the gaps between them become breaks of that length.",
      "st.imp.read": "Read the day",
      "st.imp.found": "{n} items found", "st.imp.found1": "1 item found", "st.imp.skipped": " ({n} rows without a title skipped)",
      "st.imp.start": "The event starts at {t}.", "st.imp.go": "Add {n} items", "st.imp.go1": "Add 1 item",
      "st.imp.none": "No items could be read from this file.", "st.imp.big": "The file is too large (2 MB at most).",
      "st.imp.nocal": "No timed events in the Calendar on that day.", "st.imp.done": "{n} items added.",
      "st.imp.break": "Break", "st.imp.noev": "Create an event first.",
      "st.h.title": "Title", "st.h.speaker": "Speaker", "st.h.dur": "Duration", "st.h.start": "Start", "st.h.notes": "Notes",
      "st.h.planStart": "Planned start", "st.h.actStart": "Actual start", "st.h.plan": "Planned", "st.h.ran": "Actual",
      "st.h.over": "Over (+) / under (−)", "st.h.total": "Total",
      "st.rep.h": "Report: {name}", "st.rep.sum": "{done} of {n} items ran · planned {plan} · actual {ran} · {over}",
      "st.rep.over": "{t} over", "st.rep.under": "{t} under", "st.rep.even": "on time",
      "st.rep.span": "From {a} to {b}.", "st.rep.none": "Nothing has run yet on this device.",
      "st.rep.local": "Actual times are what this device recorded while running the clock.",
      "st.rep.csv": "Download CSV", "st.rep.print": "Print / PDF", "st.rep.skip": "not run", "st.rep.open": "not finished"
    },
    el: {
      "st.quick": "Γρήγορη προσθήκη", "st.import": "Εισαγωγή…", "st.export": "Εξαγωγή CSV", "st.report": "Αναφορά",
      "st.close": "Κλείσιμο",
      "st.q.talk": "Ομιλία", "st.q.keynote": "Κεντρική ομιλία", "st.q.qa": "Ερωτήσεις", "st.q.panel": "Πάνελ",
      "st.q.break": "Διάλειμμα καφέ", "st.q.lunch": "Μεσημεριανό", "st.q.added": "Προστέθηκε: {t}",
      "st.imp.h": "Εισαγωγή προγράμματος", "st.imp.into": "Τα στοιχεία προστίθενται στο τέλος της ανοιχτής εκδήλωσης.",
      "st.imp.csv": "Από αρχείο CSV",
      "st.imp.csvh": "Στήλες τίτλος, ομιλητής, διάρκεια, έναρξη, ή μια γραμμή επικεφαλίδων που τις ονομάζει (ελληνικά ή αγγλικά). Διάρκεια: λεπτά (20), λλ:δδ (12:30) ή ω:λλ:δδ.",
      "st.imp.pick": "Επιλογή αρχείου…",
      "st.imp.cal": "Από μια μέρα του Ημερολογίου", "st.imp.calh": "Τα γεγονότα της μέρας με ώρα, με τη σειρά· τα κενά ανάμεσα γίνονται διαλείμματα της ίδιας διάρκειας.",
      "st.imp.read": "Ανάγνωση μέρας",
      "st.imp.found": "Βρέθηκαν {n} στοιχεία", "st.imp.found1": "Βρέθηκε 1 στοιχείο", "st.imp.skipped": " (παραλείφθηκαν {n} γραμμές χωρίς τίτλο)",
      "st.imp.start": "Η εκδήλωση ξεκινά στις {t}.", "st.imp.go": "Προσθήκη {n} στοιχείων", "st.imp.go1": "Προσθήκη 1 στοιχείου",
      "st.imp.none": "Δεν διαβάστηκαν στοιχεία από αυτό το αρχείο.", "st.imp.big": "Το αρχείο είναι πολύ μεγάλο (έως 2 MB).",
      "st.imp.nocal": "Δεν υπάρχουν γεγονότα με ώρα στο Ημερολόγιο εκείνη τη μέρα.", "st.imp.done": "Προστέθηκαν {n} στοιχεία.",
      "st.imp.break": "Διάλειμμα", "st.imp.noev": "Δημιούργησε πρώτα μια εκδήλωση.",
      "st.h.title": "Τίτλος", "st.h.speaker": "Ομιλητής", "st.h.dur": "Διάρκεια", "st.h.start": "Έναρξη", "st.h.notes": "Σημειώσεις",
      "st.h.planStart": "Προγραμματισμένη έναρξη", "st.h.actStart": "Πραγματική έναρξη", "st.h.plan": "Προγραμματισμένη", "st.h.ran": "Πραγματική",
      "st.h.over": "Πάνω (+) / κάτω (−)", "st.h.total": "Σύνολο",
      "st.rep.h": "Αναφορά: {name}", "st.rep.sum": "Έτρεξαν {done} από {n} στοιχεία · προγραμματισμένα {plan} · πραγματικά {ran} · {over}",
      "st.rep.over": "{t} παραπάνω", "st.rep.under": "{t} λιγότερο", "st.rep.even": "στην ώρα",
      "st.rep.span": "Από {a} έως {b}.", "st.rep.none": "Τίποτα δεν έχει τρέξει ακόμη σε αυτή τη συσκευή.",
      "st.rep.local": "Οι πραγματικοί χρόνοι είναι όσοι κατέγραψε αυτή η συσκευή τρέχοντας το ρολόι.",
      "st.rep.csv": "Λήψη CSV", "st.rep.print": "Εκτύπωση / PDF", "st.rep.skip": "δεν έτρεξε", "st.rep.open": "δεν ολοκληρώθηκε"
    }
  };
  if (window.orosI18n) window.orosI18n.table(STR, "time", LANG);
  function t(k, vars) {
    var s = (STR[LANG] && STR[LANG][k] !== undefined) ? STR[LANG][k] : (STR.en[k] !== undefined ? STR.en[k] : k);
    if (vars) Object.keys(vars).forEach(function (v) { s = s.split("{" + v + "}").join(vars[v]); });
    return s;
  }
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text, parent) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  }
  function applyI18n() {
    var els = document.querySelectorAll("[data-i18n-t]");
    for (var i = 0; i < els.length; i++) els[i].textContent = t(els[i].getAttribute("data-i18n-t"));
    var als = document.querySelectorAll("[data-i18n-t-a]");
    for (var k = 0; k < als.length; k++) als[k].setAttribute("aria-label", t(als[k].getAttribute("data-i18n-t-a")));
  }
  function note(text) {
    var n = $("stg-out-note");
    if (!n) return;
    n.textContent = text; n.hidden = false; n.classList.add("ok");
    clearTimeout(note.tm);
    note.tm = setTimeout(function () { n.hidden = true; n.classList.remove("ok"); }, 4000);
  }
  function fileName(ev, what) {
    var base = String(ev.name || "event").toLowerCase().replace(/[^a-z0-9Ͱ-Ͽ]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "event";
    return "oros-stage-" + base + (ev.date ? "-" + ev.date : "") + (what ? "-" + what : "") + ".csv";
  }
  function dialogHost() {
    if (window.orosDialog) return window.orosDialog;
    try { return window.parent.orosDialog || null; } catch (e) { return null; }
  }
  function saveText(text, name) {
    var host = dialogHost();
    if (host && typeof host.saveFile === "function") {
      host.saveFile({ text: text, filename: name, mime: "text/csv", types: [{ description: "CSV", accept: { "text/csv": [".csv"] } }] });
      return;
    }
    var url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    var a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 40000);
  }
  function pickFile(accept) {
    var host = dialogHost();
    if (host && typeof host.openFile === "function") return host.openFile(accept);
    return new Promise(function (res) {
      var inp = document.createElement("input");
      inp.type = "file"; inp.accept = accept; inp.hidden = true;
      inp.addEventListener("change", function () { res(inp.files && inp.files[0] ? inp.files[0] : null); inp.remove(); });
      document.body.appendChild(inp);
      inp.click();
    });
  }
  function closeOnBackdrop(dlg) {
    dlg.addEventListener("click", function (ev) {
      if (ev.target !== dlg) return;
      var r = dlg.getBoundingClientRect();
      if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) dlg.close();
    });
  }

  /* ---------- Quick add ---------- */
  function renderQuick() {
    var host = $("st-quick");
    host.textContent = "";
    C.TEMPLATES.forEach(function (tp) {
      var label = tp.items.map(function (x) { return t("st.q." + x.k) + " " + x.m; }).join(" + ");
      var b = el("button", "qchip", label, host);
      b.type = "button";
      b.addEventListener("click", function () {
        if (!S.ev()) { S.newEvent(); return; }
        var n = S.addPlan({ items: tp.items.map(function (x) { return { title: t("st.q." + x.k), dur: x.m * 60 }; }) });
        if (n) note(t("st.q.added", { t: label }));
      });
    });
  }

  /* ---------- Import ---------- */
  var plan = null;
  function openImport() {
    if (!S.ev()) { S.newEvent(); return; }
    plan = null;
    $("st-imp-plan").hidden = true;
    $("st-imp-err").hidden = true;
    var ev = S.ev();
    if (!$("st-imp-day").value) $("st-imp-day").value = ev.date || new Date().toISOString().slice(0, 10);
    $("st-imp-dlg").showModal();
  }
  function showErr(k) {
    plan = null;
    $("st-imp-plan").hidden = true;
    $("st-imp-err").textContent = t(k);
    $("st-imp-err").hidden = false;
  }
  function showPlan(p) {
    plan = p;
    $("st-imp-err").hidden = true;
    var n = p.items.length;
    $("st-imp-sum").textContent = (n === 1 ? t("st.imp.found1") : t("st.imp.found", { n: n })) +
      (p.bad ? t("st.imp.skipped", { n: p.bad }) : "") + (p.start && !S.ev().start ? " " + t("st.imp.start", { t: p.start }) : "");
    var ol = $("st-imp-list");
    ol.textContent = "";
    p.items.slice(0, 8).forEach(function (x) {
      el("li", null, x.title + (x.speaker ? " — " + x.speaker : "") + " · " + (x.kind === "until" ? "→ " + x.until : C.mmss(x.dur)), ol);
    });
    if (n > 8) el("li", "st-more", "…", ol);
    $("st-imp-go").textContent = n === 1 ? t("st.imp.go1") : t("st.imp.go", { n: n });
    $("st-imp-plan").hidden = false;
  }
  $("st-imp-file").addEventListener("click", function () {
    pickFile(".csv,.tsv,.txt,text/csv,text/plain").then(function (file) {
      if (!file) return;
      if (file.size > MAX_BYTES) { showErr("st.imp.big"); return; }
      return file.text().then(function (text) {
        var p = C.csvPlan(text);
        if (p) showPlan(p); else showErr("st.imp.none");
      });
    }).catch(function () { showErr("st.imp.none"); });
  });
  $("st-imp-cal").addEventListener("click", function () {
    var day = $("st-imp-day").value, OCC = window.OrosCalOccur, cal = null;
    try { cal = JSON.parse(localStorage.getItem("oros-calendar-data")); } catch (e) { cal = null; }
    var evs = OCC && cal && Array.isArray(cal.events) && C.YMD_RE.test(day) ? OCC.eventsOn(cal, day) : [];
    var p = C.calPlan(evs, t("st.imp.break"));
    if (p) showPlan(p); else showErr("st.imp.nocal");
  });
  $("st-imp-go").addEventListener("click", function () {
    if (!plan) return;
    var n = S.addPlan(plan);
    plan = null;
    $("st-imp-dlg").close();
    note(t("st.imp.done", { n: n }));
  });
  $("st-imp-close").addEventListener("click", function () { $("st-imp-dlg").close(); });
  $("st-import").addEventListener("click", openImport);
  closeOnBackdrop($("st-imp-dlg"));

  /* ---------- Export ---------- */
  function heads() {
    return { title: t("st.h.title"), speaker: t("st.h.speaker"), dur: t("st.h.dur"), start: t("st.h.start"), notes: t("st.h.notes"),
      planStart: t("st.h.planStart"), plan: t("st.h.plan"), ran: t("st.h.ran"), over: t("st.h.over"), total: t("st.h.total") };
  }
  $("st-export").addEventListener("click", function () {
    var ev = S.ev();
    if (!ev) return;
    saveText(C.toCsv(ev, S.items(), heads()), fileName(ev, ""));
  });

  /* ---------- Report ---------- */
  function signed(sec) { return (sec > 0 ? "+" : "") + C.mmss(sec); }
  function buildReport(host, rep, ev) {
    host.textContent = "";
    var thead = el("thead", null, null, host), tr = el("tr", null, null, thead);
    ["st.h.title", "st.h.planStart", "st.h.actStart", "st.h.plan", "st.h.ran", "st.h.over"].forEach(function (k) { el("th", null, t(k), tr); });
    var tb = el("tbody", null, null, host);
    rep.rows.forEach(function (r) {
      var row = el("tr", r.ran === null ? "st-skip" : r.over > 59 ? "st-long" : r.over < -59 ? "st-short" : "", null, tb);
      var c = el("td", "st-rt", null, row);
      el("span", null, r.title, c);
      if (r.speaker) el("small", null, r.speaker, c);
      el("td", null, r.planStart !== null ? C.hm(r.planStart) : "—", row);
      el("td", null, r.start !== null ? C.hm(r.start) : "—", row);
      el("td", null, C.mmss(r.plan), row);
      el("td", null, r.ran !== null ? C.mmss(r.ran) : t(r.start !== null ? "st.rep.open" : "st.rep.skip"), row);
      el("td", null, r.over !== null ? signed(r.over) : "", row);
    });
    var tf = el("tfoot", null, null, host), fr = el("tr", null, null, tf);
    el("td", null, t("st.h.total"), fr); el("td", null, "", fr); el("td", null, "", fr);
    el("td", null, C.mmss(rep.planTotal), fr); el("td", null, C.mmss(rep.ranTotal), fr); el("td", null, signed(rep.over), fr);
  }
  function summaryText(rep) {
    if (!rep.done) return t("st.rep.none");
    var o = Math.round(rep.over);
    var over = Math.abs(o) < 60 ? t("st.rep.even") : o > 0 ? t("st.rep.over", { t: C.mmss(o) }) : t("st.rep.under", { t: C.mmss(-o) });
    return t("st.rep.sum", { done: rep.done, n: rep.rows.length, plan: C.mmss(rep.planTotal), ran: C.mmss(rep.ranTotal), over: over }) +
      " " + t("st.rep.span", { a: C.hm(rep.first), b: C.hm(rep.last) });
  }
  var lastRep = null;
  function openReport() {
    var ev = S.ev();
    if (!ev) return;
    var rep = C.report(ev, S.items(), S.run().ev === ev.id ? S.run() : {});
    lastRep = { ev: ev, rep: rep };
    $("st-rep-h").textContent = t("st.rep.h", { name: ev.name + (ev.date ? " · " + ev.date : "") });
    $("st-rep-sum").textContent = summaryText(rep);
    buildReport($("st-rep-table"), rep, ev);
    $("st-rep-dlg").showModal();
  }
  $("st-report").addEventListener("click", openReport);
  $("st-rep-csv").addEventListener("click", function () {
    if (lastRep) saveText(C.reportCsv(lastRep.rep, heads()), fileName(lastRep.ev, LANG === "el" ? "anafora" : "report"));
  });
  // Print: a copy of the report outside the dialog, the only thing
  // the print stylesheet shows; the browser's own dialog makes the PDF.
  $("st-rep-print").addEventListener("click", function () {
    if (!lastRep) return;
    var p = $("st-print");
    p.textContent = "";
    el("h1", null, $("st-rep-h").textContent, p);
    el("p", null, $("st-rep-sum").textContent, p);
    buildReport(el("table", "st-rep", null, p), lastRep.rep, lastRep.ev);
    $("st-rep-dlg").close();
    document.body.classList.add("st-printing");
    var done = function () { document.body.classList.remove("st-printing"); window.removeEventListener("afterprint", done); };
    window.addEventListener("afterprint", done);
    try { window.print(); } catch (e) {}
    setTimeout(done, 60000);
  });
  $("st-rep-close").addEventListener("click", function () { $("st-rep-dlg").close(); });
  closeOnBackdrop($("st-rep-dlg"));

  applyI18n();
  renderQuick();
})();
