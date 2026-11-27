// i18n-inline-ok: the Greek connector words are parser data (DANGLE), no UI text
// ============================================================
// orOS To-Do — tasks from text, a photo or a PDF (todo/fromtext.js, TD-FT v1.0.0)
// Paste notes, or pick a photo (a whiteboard, a handwritten list) or a
// PDF: the text is split into tasks, with due dates where the text
// names a day, and shown for review. NOTHING is saved before "Add";
// then todo.js's importApply makes the one write, with Undo.
//
// Where the text comes from (all on this device):
//   - pasted or typed into the box (or pasted into the add box: more
//     than one line opens this window with it);
//   - a photo: ../ocrkit.js (Tesseract, Greek + English, the engine is
//     downloaded once with the person's yes, the flag shared with
//     Files and Documents);
//   - a PDF: its text through PDF.js (eval off, no XFA, no scripts:
//     nothing in a file is ever run); a scanned PDF without text has
//     its first pages read by ocrkit.
// Optional, off by default (device-local "oros-todo-ft" { ai: 1 }):
// the Assistant's AI (../feeds/ai.js, the Assistant's own order of
// services, AS-CHAIN) splits the text instead of the rules; the window
// names the service before anything is sent, and the rules take over
// when it does not answer.
//
// Pure part (Node tests, window.OrosTodoFromText):
//   split(text, o) -> { head, tasks: [{ text, due, notes, done, subs[] }] }
//     o: { today "YYYY-MM-DD", quick (calendar/quickadd.js), scan }
//     - bullets (- * + • · ▪ ◦ – —), numbering (1. 1) (1) a)), check
//       boxes ([ ] [x] ☐ ☑ ✓) start a task; "[x]" / ☑ / ✓ = done;
//     - a bullet indented under another becomes its subtask;
//     - text without bullets: one task per line; in a bulleted text a
//       line that is not a bullet continues the task above when it is
//       indented (or, from a scan, starts with a small letter);
//     - scan: a line wrapped by the picture (small letter after a line
//       without a full stop, or a word broken by a hyphen) is joined;
//     - "Shopping:" (a short line ending in a colon) is a heading: the
//       first one is offered as a new list's name; a heading that is
//       only a day ("Monday:", "15/12:") gives that day to the tasks
//       under it;
//     - a line with two or more ";" is several tasks;
//     - "p1"…"p3" in a task set its priority, as in the add box;
//     - days in a task ("tomorrow", "Παρασκευή", "15/12") become its
//       due date (calendar/quickadd.js, EN + EL) and leave its text; a
//       time goes into the notes; repeating words stay in the text;
//     - at most MAX tasks, text TEXT_LEN, no task twice, no noise (a
//       line needs two letters).
//   fromAi(answer, o) -> the same shape from the AI's JSON, or null
//   aiPrompt(today) -> the AI's instructions
//   pdfText(items) -> text from PDF.js text items [{ x, y, s, p }]
// Browser part: init(api), has(), label(), open({ text }).
//   api: { lang, data() (To-Do's state), list() (the open list's id),
//          apply(plan, doneText) (todo.js importApply), toast(text) }
// Everything read is data: it reaches the page only through
// textContent and input values, never as HTML.
// ============================================================
(function (root) {
  "use strict";

  var VERSION = "1.0.0";
  var MAX = 200, TEXT_LEN = 300, NOTE_LEN = 1000, SUB_MAX = 100, NAME_LEN = 60, IN_MAX = 20000, AI_IN = 8000;
  var YMD = /^\d{4}-\d{2}-\d{2}$/;
  var LETTER = /[A-Za-zÀ-ɏͰ-Ͽἀ-῿Ѐ-ӿ]/g;
  var LOWER = /^[a-zß-ÿά-ώἀ-῿а-я]/;
  var CHECK_DONE = /^(?:\[[xX✓✔]\]|[☑☒✓✔✅])\s*/;
  var CHECK_OPEN = /^(?:\[\s?\]|[☐□])\s*/;
  var BULLET = /^(?:[-*+•·▪▫◦‣○●■–—⁃➢→>](?=\s|\[|$)|\d{1,3}[.)](?=\s)|\(\d{1,3}\)|[a-zα-ω][)](?=\s))\s*/;
  // what a picture's bullet is often read as (only when two lines agree)
  var OCR_BULLET = /^([oe©«»®°¢])\s+/;
  // words left hanging when the day is taken out ("pay the bill by")
  var DANGLE = ["by", "until", "till", "on", "due", "before", "the", "at", "for",
    "έως", "μέχρι", "ως", "την", "τη",
    "τον", "το", "στις", "για", "πριν", "μέχρις"];

  var DANGLE_F = null;
  function str(v) { return typeof v === "string" ? v : v == null ? "" : String(v); }
  function fold(s) {
    s = str(s).toLowerCase();
    if (s.normalize) s = s.normalize("NFD").replace(/[̀-ͯ]/g, "");
    return s.replace(/ς/g, "σ").replace(/\s+/g, " ").trim();
  }
  function tidy(s, n) {
    s = str(s);
    if (s.normalize) s = s.normalize("NFC");
    s = s.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim();
    return n && s.length > n ? s.slice(0, n).trim() : s;
  }
  function letters(s) { var m = str(s).match(LETTER); return m ? m.length : 0; }
  // the end of a task: no trailing comma / semicolon / full stop / colon
  function trimEnd(s) { return s.replace(/[\s,;.:·]+$/, "").trim(); }

  // ---------- one line → { ind, bullet, done, text } ----------
  function lineOf(raw, ocrMark) {
    var m = /^[ \t]*/.exec(raw), ind = m[0].replace(/\t/g, "    ").length, s = raw.slice(m[0].length).trim();
    var bullet = false, done = false, b;
    if (ocrMark && OCR_BULLET.test(s)) { s = s.replace(OCR_BULLET, ""); bullet = true; }
    else if ((b = BULLET.exec(s))) { s = s.slice(b[0].length); bullet = true; }
    if ((b = CHECK_DONE.exec(s))) { s = s.slice(b[0].length); bullet = done = true; }
    else if ((b = CHECK_OPEN.exec(s))) { s = s.slice(b[0].length); bullet = true; }
    return { ind: ind, bullet: bullet, done: done, text: s.trim() };
  }

  // ---------- a day in the text (calendar/quickadd.js) ----------
  function dateOf(text, o) {
    if (!DANGLE_F) DANGLE_F = DANGLE.map(fold);
    var Q = o && o.quick;
    if (!Q || typeof Q.parse !== "function") return null;
    var r;
    try { r = Q.parse(text, { today: o.today }); } catch (e) { return null; }
    if (!r || !r.found || !r.found.date || r.found.repeat || !YMD.test(r.date || "")) return null;
    var title = str(r.title).trim();
    // the place quickadd took out ("στο φαρμακείο") goes back, with its word
    if (r.location) {
      var at = text.indexOf(r.location);
      if (at > 0) {
        var before = text.slice(0, at).replace(/\s+$/, ""), w = before.split(/\s+/).pop();
        title = (title + " " + (w ? w + " " : "") + r.location).trim();
      } else title = (title + " " + r.location).trim();
    }
    var words = title.split(/\s+/);
    while (words.length > 1 && DANGLE_F.indexOf(fold(words[words.length - 1]).replace(/[^\wͰ-Ͽ]/g, "")) !== -1) words.pop();
    title = trimEnd(words.join(" "));
    var time = r.start ? r.start + (r.end ? "–" + r.end : "") : "";
    return { date: r.date, text: title, time: time };
  }

  function finish(t, o, dayDue) {
    var text = trimEnd(tidy(t.text, 2000)), notes = "", due = "", prio = 0;
    // "p1"…"p3" as in the add box (p4 = no priority)
    text = text.replace(/(^|\s)[pP]([1-4])(?=\s|$)/g, function (m, sp, n) { if (!prio) prio = +n; return sp; }).replace(/\s+/g, " ").trim();
    if (prio === 4) prio = 0;
    var d = dateOf(text, o);
    if (d && letters(d.text) >= 2) { text = d.text; due = d.date; if (d.time) notes = d.time; }
    else if (d && !letters(d.text)) return null;              // only a day: not a task
    if (!due && dayDue) due = dayDue;
    text = tidy(text, TEXT_LEN);
    if (letters(text) < 2) return null;
    var subs = [];
    t.subs.forEach(function (s) {
      var x = trimEnd(tidy(s.text, TEXT_LEN));
      if (letters(x) >= 1 && subs.length < SUB_MAX) subs.push({ text: x, done: !!s.done });
    });
    return { text: text, due: due, notes: notes, done: !!t.done, subs: subs, prio: prio };
  }

  function split(text, o) {
    o = o || {};
    var src = str(text).slice(0, IN_MAX).replace(/\r\n?/g, "\n");
    if (src.normalize) src = src.normalize("NFC");
    src = src.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029]/g, " ");
    var raws = src.split("\n");
    // a picture's bullet: an odd mark (« © e o …) at a line's start, when
    // two lines or more start with a bullet of some kind
    var ocrMark = "";
    if (o.scan) {
      var odd = 0, marks = 0;
      raws.forEach(function (r) { r = r.trim(); if (OCR_BULLET.test(r)) odd++; if (OCR_BULLET.test(r) || BULLET.test(r)) marks++; });
      if (odd && marks >= 2) ocrMark = "1";
    }
    var lines = raws.map(function (r) { return lineOf(r, ocrMark); });
    var bulleted = lines.some(function (l) { return l.bullet && l.text; });
    var out = [], head = "", dayDue = "", top = null, prevEmpty = true, prevLine = null;

    function push(t) { out.push(t); top = t; }
    function addTask(text, done, ind) {
      // several tasks on one line, separated by ";"
      var parts = (text.match(/;/g) || []).length >= 2 ? text.split(";") : [text];
      parts.forEach(function (p) { p = p.trim(); if (p) push({ text: p, done: done, ind: ind, subs: [], due: dayDue }); });
    }
    function cont(l) {
      var last = top && top.subs.length && prevLine && prevLine.ind > top.ind ? top.subs[top.subs.length - 1] : top;
      if (!last) return false;
      if (/[-­‐]$/.test(last.text) && LOWER.test(l.text)) last.text = last.text.replace(/[-­‐]$/, "") + l.text;
      else last.text += " " + l.text;
      return true;
    }

    lines.forEach(function (l) {
      if (!l.text) { prevEmpty = true; prevLine = null; if (!bulleted) top = null; return; }
      // a heading: a short line ending in a colon, not a bullet
      if (!l.bullet && /:$/.test(l.text) && l.text.length <= NAME_LEN + 1) {
        var name = trimEnd(l.text), d = dateOf(name, o);
        if (d && !letters(d.text)) dayDue = d.date;
        else {
          if (!head && !out.length && letters(name) >= 2) head = tidy(name, NAME_LEN);
          dayDue = d ? d.date : "";
        }
        top = null; prevEmpty = false; prevLine = l;
        return;
      }
      if (l.bullet) {
        if (top && l.ind > top.ind + 1 && top.subs.length < SUB_MAX) top.subs.push({ text: l.text, done: l.done });
        else addTask(l.text, l.done, l.ind);
      } else if (bulleted) {
        // a line that is not a bullet in a bulleted text
        var follows = top && !prevEmpty && prevLine;
        if (follows && (l.ind > 0 || (o.scan && (LOWER.test(l.text) || /[-­‐]$/.test(prevLine.text))))) cont(l);
        else addTask(l.text, false, l.ind);
      } else {
        var joins = o.scan && top && !prevEmpty && prevLine &&
          ((LOWER.test(l.text) && !/[.!?;:]$/.test(prevLine.text)) || /[-­‐]$/.test(prevLine.text));
        if (joins) cont(l);
        else addTask(l.text, false, l.ind);
      }
      prevEmpty = false; prevLine = l;
    });

    var seen = {}, tasks = [];
    out.forEach(function (t) {
      if (tasks.length >= MAX) return;
      var f = finish(t, o, t.due);
      if (!f) return;
      var k = fold(f.text);
      if (seen[k]) return;
      seen[k] = 1;
      tasks.push(f);
    });
    return { head: head, tasks: tasks, capped: out.length > MAX };
  }

  // ---------- the Assistant's AI (optional) ----------
  function aiPrompt(today) {
    return "You turn a person's notes into a to-do list. Answer with only a JSON array and nothing else. " +
      "Each element is {\"text\": \"one short task\", \"due\": \"YYYY-MM-DD\" or \"\", \"subs\": [\"step\", …]}. " +
      "Today is " + (YMD.test(str(today)) ? today : "unknown") + "; turn days the notes name (tomorrow, Friday, 15/12) into dates. " +
      "Keep the language and the words of the notes; do not translate, do not invent tasks, leave out headings, " +
      "greetings and lines that are not things to do. Steps written under a task go into its subs.";
  }
  function fromAi(answer, o) {
    var s = str(answer), a = s.indexOf("["), b = s.lastIndexOf("]");
    if (a < 0 || b <= a) return null;
    var arr;
    try { arr = JSON.parse(s.slice(a, b + 1)); } catch (e) { return null; }
    if (!Array.isArray(arr)) return null;
    var seen = {}, tasks = [];
    arr.forEach(function (x) {
      if (tasks.length >= MAX) return;
      if (typeof x === "string") x = { text: x };
      if (!x || typeof x !== "object") return;
      var text = trimEnd(tidy(x.text, TEXT_LEN));
      if (letters(text) < 2) return;
      var k = fold(text);
      if (seen[k]) return;
      seen[k] = 1;
      var subs = [];
      (Array.isArray(x.subs) ? x.subs : []).forEach(function (sb) {
        var v = trimEnd(tidy(typeof sb === "string" ? sb : sb && sb.text, TEXT_LEN));
        if (letters(v) >= 1 && subs.length < SUB_MAX) subs.push({ text: v, done: false });
      });
      var due = YMD.test(str(x.due)) && !isNaN(Date.parse(x.due)) ? x.due : "";
      tasks.push({ text: text, due: due, notes: "", done: false, subs: subs, prio: 0 });
    });
    return tasks.length ? { head: "", tasks: tasks, capped: arr.length > MAX } : null;
  }

  // ---------- a PDF's text items → lines ----------
  function pdfText(items) {
    var pages = {};
    (Array.isArray(items) ? items : []).forEach(function (it) {
      if (!it || typeof it.s !== "string" || !isFinite(it.x) || !isFinite(it.y)) return;
      var p = +it.p || 1;
      (pages[p] = pages[p] || []).push({ x: +it.x, y: +it.y, s: it.s });
    });
    var out = [];
    Object.keys(pages).map(Number).sort(function (a, b) { return a - b; }).forEach(function (p) {
      var its = pages[p].sort(function (a, b) { return b.y - a.y || a.x - b.x; }), rows = [];
      its.forEach(function (it) {
        var r = rows[rows.length - 1];
        if (r && Math.abs(r.y - it.y) <= 3) r.items.push(it);
        else rows.push({ y: it.y, items: [it] });
      });
      var lastY = null;
      rows.forEach(function (r) {
        var line = r.items.sort(function (a, b) { return a.x - b.x; }).map(function (i) { return i.s; }).join(" ").replace(/\s+/g, " ").trim();
        if (!line) return;
        // a gap of more than two lines is a new paragraph
        if (lastY !== null && lastY - r.y > 30) out.push("");
        out.push(line);
        lastY = r.y;
      });
      out.push("");
    });
    return out.join("\n").trim();
  }

  var pure = { VERSION: VERSION, MAX: MAX, split: split, fromAi: fromAi, aiPrompt: aiPrompt, pdfText: pdfText, fold: fold };
  if (typeof module !== "undefined" && module.exports) { module.exports = pure; return; }

  // ============================================================
  // Browser
  // ============================================================
  var VQ = (function () {
    var m = ((document.currentScript && document.currentScript.src) || "").match(/[?&]v=([^&#]+)/);
    return m ? "?v=" + m[1] : "";
  })();
  var PREFS = "oros-todo-ft";
  var MAX_FILE = 30 * 1024 * 1024, PDF_PAGES = 20, SCAN_PAGES = 5;

  var S = {
    en: {
      "ft.btn": "Tasks from text, photo or PDF…",
      "ft.title": "Tasks from text, photo or PDF",
      "ft.intro": "Paste your notes, or read a photo (a whiteboard, a handwritten list) or a PDF. Each line or bullet becomes a task; days such as “tomorrow” or “15/12” become due dates. You check the list before anything is added.",
      "ft.ph": "Paste or type your notes here",
      "ft.photo": "Photo…", "ft.pdf": "PDF…",
      "ft.ai": "Split with the Assistant’s AI",
      "ft.aiNone": "No AI is set up in the Assistant on this device. The rules split the text.",
      "ft.aiLocal": "{name} reads the text on this device or your own computer.",
      "ft.aiSend": "The text is sent to {name}, the service you chose in the Assistant, with your own key.",
      "ft.aiFail": "{name} did not answer: the rules split the text.",
      "ft.aiWorking": "{name} is splitting the text…",
      "ft.find": "Find tasks", "ft.back": "Back", "ft.cancel": "Cancel",
      "ft.ocrAsk": "To-Do reads the text with the same recognition as Files and Scanner & PDF (Greek and English). The first time it downloads the engine once; the picture never leaves this device.",
      "ft.ocrYes": "Download and read",
      "ft.reading": "Reading the text… {p}%", "ft.readingPdf": "Reading the PDF…",
      "ft.readingPage": "Reading page {n} of {all}… {p}%",
      "ft.stop": "Stop",
      "ft.noText": "No text was found.", "ft.offline": "The reading engine could not be downloaded. Check the connection and try again.",
      "ft.failImg": "This picture could not be read here.", "ft.failPdf": "This PDF could not be read here.",
      "ft.big": "The file is too big.",
      "ft.none": "No tasks were found in this text.",
      "ft.found": "{n} tasks found. Untick what you do not want and correct the text or the dates.",
      "ft.capped": "Only the first {n} tasks are shown.",
      "ft.list": "List", "ft.newl": "New list: {name}", "ft.newBlank": "New list",
      "ft.dup": "already on the list", "ft.doneHint": "ticked in the text",
      "ft.subs": "Subtasks: {s}",
      "ft.due": "Due date", "ft.text": "Task",
      "ft.go": "Add {n}", "ft.done": "{n} tasks added to {list}"
    },
    el: {
      "ft.btn": "Εργασίες από κείμενο, φωτογραφία ή PDF…",
      "ft.title": "Εργασίες από κείμενο, φωτογραφία ή PDF",
      "ft.intro": "Επικόλλησε τις σημειώσεις σου ή διάβασε μια φωτογραφία (πίνακα, χειρόγραφη λίστα) ή ένα PDF. Κάθε γραμμή ή κουκκίδα γίνεται εργασία· μέρες όπως «αύριο» ή «15/12» γίνονται προθεσμίες. Ελέγχεις τη λίστα πριν προστεθεί οτιδήποτε.",
      "ft.ph": "Επικόλλησε ή γράψε εδώ τις σημειώσεις σου",
      "ft.photo": "Φωτογραφία…", "ft.pdf": "PDF…",
      "ft.ai": "Χωρισμός με το AI του Βοηθού",
      "ft.aiNone": "Δεν έχει ρυθμιστεί AI στον Βοηθό σε αυτή τη συσκευή. Το κείμενο το χωρίζουν οι κανόνες.",
      "ft.aiLocal": "Το {name} διαβάζει το κείμενο σε αυτή τη συσκευή ή στον δικό σου υπολογιστή.",
      "ft.aiSend": "Το κείμενο στέλνεται στο {name}, την υπηρεσία που διάλεξες στον Βοηθό, με το δικό σου κλειδί.",
      "ft.aiFail": "Το {name} δεν απάντησε: το κείμενο το χώρισαν οι κανόνες.",
      "ft.aiWorking": "Το {name} χωρίζει το κείμενο…",
      "ft.find": "Εύρεση εργασιών", "ft.back": "Πίσω", "ft.cancel": "Άκυρο",
      "ft.ocrAsk": "Το To-Do διαβάζει το κείμενο με την ίδια αναγνώριση που έχουν τα Αρχεία και ο Σαρωτής & PDF (ελληνικά και αγγλικά). Την πρώτη φορά κατεβάζει μία φορά τη μηχανή· η εικόνα δεν φεύγει ποτέ από τη συσκευή.",
      "ft.ocrYes": "Λήψη και ανάγνωση",
      "ft.reading": "Διαβάζεται το κείμενο… {p}%", "ft.readingPdf": "Διαβάζεται το PDF…",
      "ft.readingPage": "Διαβάζεται η σελίδα {n} από {all}… {p}%",
      "ft.stop": "Διακοπή",
      "ft.noText": "Δεν βρέθηκε κείμενο.", "ft.offline": "Η μηχανή ανάγνωσης δεν κατέβηκε. Έλεγξε τη σύνδεση και ξαναδοκίμασε.",
      "ft.failImg": "Αυτή η εικόνα δεν διαβάζεται εδώ.", "ft.failPdf": "Αυτό το PDF δεν διαβάζεται εδώ.",
      "ft.big": "Το αρχείο είναι πολύ μεγάλο.",
      "ft.none": "Δεν βρέθηκαν εργασίες σε αυτό το κείμενο.",
      "ft.found": "Βρέθηκαν {n} εργασίες. Ξετσέκαρε ό,τι δεν θέλεις και διόρθωσε το κείμενο ή τις ημερομηνίες.",
      "ft.capped": "Φαίνονται μόνο οι πρώτες {n} εργασίες.",
      "ft.list": "Λίστα", "ft.newl": "Νέα λίστα: {name}", "ft.newBlank": "Νέα λίστα",
      "ft.dup": "υπάρχει ήδη στη λίστα", "ft.doneHint": "τσεκαρισμένη στο κείμενο",
      "ft.subs": "Υποεργασίες: {s}",
      "ft.due": "Προθεσμία", "ft.text": "Εργασία",
      "ft.go": "Προσθήκη {n}", "ft.done": "{n} εργασίες μπήκαν στη λίστα «{list}»"
    }
  };
  var A = null;
  function t(k, params) {
    var code = A && A.lang ? A.lang : "en";
    var tab = S[code] || (window.orosI18n ? window.orosI18n.table(S, "todo", code) : S.en);
    var s = tab[k] !== undefined ? tab[k] : S.en[k];
    return String(s).replace(/\{(\w+)\}/g, function (m, n) { return params && params[n] !== undefined ? String(params[n]) : m; });
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function button(text, cls, fn) {
    var b = el("button", cls, text);
    b.type = "button";
    if (fn) b.addEventListener("click", fn);
    return b;
  }
  function prefs() { try { var p = JSON.parse(localStorage.getItem(PREFS) || "null"); return p && typeof p === "object" ? p : {}; } catch (e) { return {}; } }
  function setPref(k, v) { var p = prefs(); p[k] = v; try { localStorage.setItem(PREFS, JSON.stringify(p)); } catch (e) {} }
  function todayISO() {
    var d = new Date();
    return d.getFullYear() + "-" + (d.getMonth() < 9 ? "0" : "") + (d.getMonth() + 1) + "-" + (d.getDate() < 10 ? "0" : "") + d.getDate();
  }
  function uid() { return "tft-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  // scripts loaded on first use (all precached)
  var loading = {};
  function script(src, name) {
    if (window[name]) return Promise.resolve(window[name]);
    if (loading[name]) return loading[name];
    loading[name] = new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = src + VQ;
      s.onload = function () { window[name] ? res(window[name]) : rej(new Error(name)); };
      s.onerror = function () { s.remove(); delete loading[name]; rej(new Error(name)); };
      document.head.appendChild(s);
    });
    return loading[name];
  }
  function quick() { return script("../calendar/quickadd.js", "OrosCalQuick").catch(function () { return null; }); }
  function ocr() { return script("../ocrkit.js", "OrosOcr"); }
  function ai() { return script("../feeds/ai.js", "orosFeedsAI").catch(function () { return null; }); }

  var LIBSRC = "../vendor/pdfjs/pdf.min.js", WORKER = "../vendor/pdfjs/pdf.worker.min.js", libP = null;
  function pdfjs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (libP) return libP;
    libP = new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.type = "module"; s.src = LIBSRC;
      s.onload = function () {
        if (window.pdfjsLib) { if (!window.pdfjsLib.GlobalWorkerOptions.workerSrc) window.pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER; res(window.pdfjsLib); }
        else { libP = null; rej(new Error("pdfjs")); }
      };
      s.onerror = function () { libP = null; rej(new Error("pdfjs")); };
      document.head.appendChild(s);
    });
    return libP;
  }
  function openPdf(bytes) {
    return pdfjs().then(function (lib) {
      return lib.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, enableXfa: false,
                               disableAutoFetch: true, disableStream: true, stopAtErrors: false }).promise;
    });
  }
  function pdfItems(pdf) {
    var n = Math.min(pdf.numPages, PDF_PAGES), out = [], chain = Promise.resolve();
    for (var i = 1; i <= n; i++) (function (k) {
      chain = chain.then(function () { return pdf.getPage(k); }).then(function (pg) {
        return pg.getTextContent().then(function (tc) {
          (tc.items || []).forEach(function (it) {
            if (it && typeof it.str === "string" && it.transform) out.push({ x: it.transform[4], y: it.transform[5], s: it.str, p: k });
          });
        });
      });
    })(i);
    return chain.then(function () { return out; });
  }
  function pageCanvas(pdf, k) {
    return pdf.getPage(k).then(function (pg) {
      var v0 = pg.getViewport({ scale: 1 }), sc = Math.min(3, 2200 / Math.max(v0.width, v0.height));
      var vp = pg.getViewport({ scale: sc }), cv = document.createElement("canvas");
      cv.width = Math.max(1, Math.round(vp.width)); cv.height = Math.max(1, Math.round(vp.height));
      var cx = cv.getContext("2d");
      cx.fillStyle = "#fff"; cx.fillRect(0, 0, cv.width, cv.height);
      return pg.render({ canvasContext: cx, viewport: vp }).promise.then(function () { return cv; });
    });
  }
  function pickFile(accept) {
    return new Promise(function (resolve) {
      var inp = document.createElement("input");
      inp.type = "file"; inp.accept = accept; inp.hidden = true;
      document.body.appendChild(inp);
      inp.addEventListener("change", function () { var f = inp.files && inp.files[0]; inp.remove(); resolve(f || null); });
      inp.addEventListener("cancel", function () { inp.remove(); resolve(null); });
      inp.click();
    });
  }

  // ---------- the window ----------
  function open(o) {
    o = o || {};
    if (!A) return;
    var old = document.getElementById("todo-ft");
    if (old) old.remove();
    var dlg = el("dialog");
    dlg.id = "todo-ft";
    dlg.setAttribute("aria-labelledby", "ft-h");
    var h = el("h3", "", t("ft.title"));
    h.id = "ft-h";
    dlg.appendChild(h);
    var body = el("div", "ft-body");
    dlg.appendChild(body);
    var job = null, scanned = false, aiCtl = null;
    dlg.addEventListener("close", function () {
      if (job) job.stop = true;
      if (aiCtl) try { aiCtl.abort(); } catch (e) {}
      dlg.remove();
    });
    document.body.appendChild(dlg);
    dlg.showModal();
    var draft = tidyIn(o.text);
    source();

    function tidyIn(v) { return str(v).slice(0, IN_MAX); }

    // step 1: the text
    function source() {
      body.textContent = "";
      body.appendChild(el("p", "hint", t("ft.intro")));
      var ta = el("textarea", "ft-text");
      ta.rows = 8; ta.maxLength = IN_MAX; ta.spellcheck = false;
      ta.placeholder = t("ft.ph");
      ta.setAttribute("aria-label", t("ft.ph"));
      ta.value = draft;
      body.appendChild(ta);
      var row = el("div", "ft-src");
      var bPhoto = button(t("ft.photo"), "ghost", function () { pickFile("image/*").then(function (f) { if (f) readImage(f); }); });
      var bPdf = button(t("ft.pdf"), "ghost", function () { pickFile(".pdf,application/pdf").then(function (f) { if (f) readPdf(f); }); });
      row.appendChild(bPhoto); row.appendChild(bPdf);
      body.appendChild(row);
      var st = el("div", "ft-status");
      st.setAttribute("aria-live", "polite");
      body.appendChild(st);
      var aiRow = el("label", "ft-ai"), aiCb = el("input"), aiHint = el("p", "hint ft-aihint");
      aiCb.type = "checkbox";
      aiCb.checked = prefs().ai === 1;
      aiRow.appendChild(aiCb); aiRow.appendChild(el("span", "", t("ft.ai")));
      body.appendChild(aiRow); body.appendChild(aiHint);
      var conf = null;
      function aiInfo() {
        aiHint.textContent = "";
        conf = null;
        if (!aiCb.checked) return;
        ai().then(function (L) { return L ? L.ready() : null; }).then(function (cf) {
          if (!aiCb.checked) return;
          conf = cf || null;
          if (!cf) { aiHint.textContent = t("ft.aiNone"); return; }
          var local = !!(cf.p && (cf.p.local || cf.p.builtin));
          aiHint.textContent = t(local ? "ft.aiLocal" : "ft.aiSend", { name: cf.name });
        }, function () { aiHint.textContent = t("ft.aiNone"); });
      }
      aiCb.addEventListener("change", function () { setPref("ai", aiCb.checked ? 1 : 0); aiInfo(); });
      aiInfo();
      var menu = el("menu");
      menu.appendChild(button(t("ft.cancel"), "plain", function () { dlg.close(); }));
      menu.appendChild(el("span", "spacer"));
      var go = button(t("ft.find"), "", function () {
        draft = tidyIn(ta.value);
        if (!draft.trim()) { ta.focus(); return; }
        find(draft, aiCb.checked ? conf : null, st, go);
      });
      menu.appendChild(go);
      body.appendChild(menu);
      ta.addEventListener("input", function () { draft = ta.value; go.disabled = !ta.value.trim(); });
      go.disabled = !ta.value.trim();
      setTimeout(function () { ta.focus(); }, 50);

      function busy(on) { bPhoto.disabled = bPdf.disabled = go.disabled = on; ta.readOnly = on; }
      function say(text, stop) {
        st.textContent = "";
        if (!text) return;
        st.appendChild(el("span", "", text));
        if (stop) st.appendChild(button(t("ft.stop"), "ghost ft-stop", function () { if (job) job.stop = true; }));
      }
      function addText(txt) {
        txt = str(txt).trim();
        if (!txt) { say(t("ft.noText")); return; }
        scanned = true;
        ta.value = tidyIn((ta.value.trim() ? ta.value.replace(/\s+$/, "") + "\n\n" : "") + txt);
        draft = ta.value;
        go.disabled = false;
        say("");
      }
      // OCR needs the person's yes once (the engine download)
      function withOcr(fn) {
        busy(true);
        ocr().then(function (K) {
          if (K.allowed()) { fn(K); return; }
          busy(false);
          st.textContent = "";
          st.appendChild(el("p", "", t("ft.ocrAsk")));
          var r = el("div", "ft-src");
          r.appendChild(button(t("ft.cancel"), "plain", function () { say(""); }));
          r.appendChild(button(t("ft.ocrYes"), "ghost", function () { K.allow(); busy(true); fn(K); }));
          st.appendChild(r);
        }, function () { busy(false); say(t("ft.offline")); });
      }
      function ocrErr(e, key) { busy(false); job = null; say(e && e.code === "stop" ? "" : t(e && e.code === "offline" ? "ft.offline" : key)); }
      function readImage(f) {
        if (f.size > MAX_FILE) { say(t("ft.big")); return; }
        withOcr(function (K) {
          job = { stop: false };
          say(t("ft.reading", { p: 0 }), true);
          K.read(f, { job: job, onStep: function (p) { if (job) say(t("ft.reading", { p: p }), true); } }).then(function (r) {
            busy(false); job = null; addText(r && r.text);
          }, function (e) { ocrErr(e, "ft.failImg"); });
        });
      }
      function readPdf(f) {
        if (f.size > MAX_FILE) { say(t("ft.big")); return; }
        busy(true);
        say(t("ft.readingPdf"));
        var doc = null;
        f.arrayBuffer().then(openPdf).then(function (pdf) {
          doc = pdf;
          return pdfItems(pdf);
        }).then(function (items) {
          var txt = pdfText(items);
          if (letters(txt) >= 20) { busy(false); addText(txt); try { doc.destroy(); } catch (e) {} return; }
          // no text layer: a scan. Its first pages are read like a photo.
          withOcr(function (K) {
            job = { stop: false };
            var n = Math.min(doc.numPages, SCAN_PAGES), parts = [], chain = Promise.resolve();
            for (var k = 1; k <= n; k++) (function (k) {
              chain = chain.then(function () {
                if (!job || job.stop) { var e = new Error("stop"); e.code = "stop"; throw e; }
                say(t("ft.readingPage", { n: k, all: n, p: 0 }), true);
                return pageCanvas(doc, k);
              }).then(function (cv) {
                return K.read(cv, { job: job, onStep: function (p) { if (job) say(t("ft.readingPage", { n: k, all: n, p: p }), true); } });
              }).then(function (r) { if (r && r.text) parts.push(r.text); });
            })(k);
            chain.then(function () {
              busy(false); job = null; try { doc.destroy(); } catch (e) {}
              addText(parts.join("\n\n"));
            }, function (e) { try { doc.destroy(); } catch (e2) {} ocrErr(e, "ft.failPdf"); });
          });
        }).catch(function () { busy(false); say(t("ft.failPdf")); });
      }
    }

    function find(text, cf, st, go) {
      go.disabled = true;
      quick().then(function (Q) {
        var o2 = { today: todayISO(), quick: Q, scan: scanned };
        var rules = function () { return split(text, o2); };
        if (!cf) { review(rules(), ""); return; }
        st.textContent = t("ft.aiWorking", { name: cf.name });
        aiCtl = typeof AbortController !== "undefined" ? new AbortController() : null;
        ai().then(function (L) {
          return L.ask(cf, { system: aiPrompt(o2.today), user: text.slice(0, AI_IN) }, aiCtl ? aiCtl.signal : null, null, null);
        }).then(function (ans) {
          aiCtl = null;
          var r = fromAi(ans, o2);
          if (!r) throw new Error("ai");
          r.head = rules().head;
          review(r, "");
        }).catch(function () {
          aiCtl = null;
          if (!dlg.open) return;
          review(rules(), t("ft.aiFail", { name: cf.name }));
        });
      });
    }

    // step 2: the review
    function review(res, note) {
      body.textContent = "";
      if (note) body.appendChild(el("p", "hint", note));
      if (!res.tasks.length) {
        body.appendChild(el("p", "", t("ft.none")));
        var m0 = el("menu");
        m0.appendChild(button(t("ft.cancel"), "plain", function () { dlg.close(); }));
        m0.appendChild(el("span", "spacer"));
        m0.appendChild(button(t("ft.back"), "", source));
        body.appendChild(m0);
        return;
      }
      body.appendChild(el("p", "hint", t("ft.found", { n: res.tasks.length }) + (res.capped ? " " + t("ft.capped", { n: MAX }) : "")));
      var st = A.data(), lists = st && Array.isArray(st.lists) ? st.lists : [];
      var lab = el("label", "", t("ft.list"));
      lab.htmlFor = "ft-list";
      body.appendChild(lab);
      var sel = el("select");
      sel.id = "ft-list";
      var NEW = "\u0000new";
      lists.forEach(function (l) { var op = el("option", "", l.name || "—"); op.value = l.id; sel.appendChild(op); });
      var nOpt = el("option", "", res.head ? t("ft.newl", { name: res.head }) : t("ft.newBlank"));
      nOpt.value = NEW;
      sel.appendChild(nOpt);
      var cur = A.list();
      // a heading that names a list here picks that list
      var named = "";
      if (res.head) lists.forEach(function (l) { if (!named && fold(l.name) === fold(res.head)) named = l.id; });
      sel.value = named || (res.head ? NEW : (lists.some(function (l) { return l.id === cur; }) ? cur : (lists[0] ? lists[0].id : NEW)));
      body.appendChild(sel);
      var ul = el("ul", "ft-items"), rows = [];
      res.tasks.forEach(function (tk, i) {
        var li = el("li", "ft-row"), cb = el("input"), tx = el("input"), du = el("input"), meta = el("div", "ft-meta");
        cb.type = "checkbox"; cb.setAttribute("aria-label", tk.text);
        tx.type = "text"; tx.value = tk.text; tx.maxLength = TEXT_LEN; tx.className = "ft-t"; tx.setAttribute("aria-label", t("ft.text") + " " + (i + 1));
        du.type = "date"; du.value = tk.due || ""; du.className = "ft-d"; du.setAttribute("aria-label", t("ft.due"));
        var info = el("small", "ft-info");
        li.appendChild(cb); li.appendChild(tx); li.appendChild(du);
        if (tk.subs.length) meta.appendChild(el("small", "", t("ft.subs", { s: tk.subs.map(function (s) { return s.text; }).join(" · ") })));
        if (tk.notes) meta.appendChild(el("small", "", tk.notes));
        if (tk.prio) meta.appendChild(el("small", "", "P" + tk.prio));
        meta.appendChild(info);
        li.appendChild(meta);
        ul.appendChild(li);
        var r = { tk: tk, cb: cb, tx: tx, du: du, info: info, touched: false };
        cb.addEventListener("change", function () { r.touched = true; count(); });
        tx.addEventListener("input", function () { if (!r.touched && tx.value.trim()) { cb.checked = true; } count(); });
        rows.push(r);
      });
      body.appendChild(ul);
      var menu = el("menu");
      menu.appendChild(button(t("ft.back"), "plain", source));
      menu.appendChild(el("span", "spacer"));
      var go = button("", "", add);
      menu.appendChild(go);
      body.appendChild(menu);
      function openKeys() {
        var k = {}, l = null;
        lists.forEach(function (x) { if (x.id === sel.value) l = x; });
        (l && Array.isArray(l.items) ? l.items : []).forEach(function (it) { if (it && !it.done) k[fold(it.text)] = 1; });
        return k;
      }
      function marks() {
        var have = sel.value === NEW ? {} : openKeys();
        rows.forEach(function (r) {
          var dup = !!have[fold(r.tk.text)];
          r.info.textContent = dup ? t("ft.dup") : r.tk.done ? t("ft.doneHint") : "";
          if (!r.touched) r.cb.checked = !dup && !r.tk.done;
        });
        count();
      }
      function count() {
        var n = rows.filter(function (r) { return r.cb.checked && r.tx.value.trim(); }).length;
        go.textContent = t("ft.go", { n: n });
        go.disabled = !n;
      }
      sel.addEventListener("change", marks);
      marks();
      setTimeout(function () { go.focus(); }, 50);

      function add() {
        var pick = rows.filter(function (r) { return r.cb.checked && letters(r.tx.value) >= 1; });
        if (!pick.length) return;
        var plan = { labels: { add: [] }, lists: { add: [], upd: [] }, items: { add: [], upd: [] } };
        var listId = sel.value, name = "";
        lists.forEach(function (x) { if (x.id === listId) name = x.name; });
        if (listId === NEW || !lists.some(function (x) { return x.id === listId; })) {
          listId = "tdl-" + uid().slice(4);
          name = res.head || t("ft.newBlank");
          plan.lists.add.push({ id: listId, name: name });
        }
        var now = Date.now();
        pick.forEach(function (r) {
          var due = YMD.test(r.du.value) ? r.du.value : null;
          plan.items.add.push({
            id: uid(), list: listId, text: tidy(r.tx.value, TEXT_LEN), due: due, notes: r.tk.notes || "",
            labels: [], info: [], prio: r.tk.prio || 0, done: false,
            subs: r.tk.subs.map(function (s) { return { id: uid(), text: s.text, done: !!s.done, mtime: now }; })
          });
        });
        dlg.close();
        A.apply(plan, t("ft.done", { n: pick.length, list: name }));
        if (A.show) A.show(listId);
      }
    }
  }

  root.OrosTodoFromText = {
    VERSION: VERSION, split: split, fromAi: fromAi, aiPrompt: aiPrompt, pdfText: pdfText,
    init: function (api) { A = api; },
    has: function () { return typeof document !== "undefined" && typeof HTMLDialogElement !== "undefined"; },
    label: function () { return t("ft.btn"); },
    open: open
  };
})(typeof window !== "undefined" ? window : this);
