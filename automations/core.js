// ============================================================
// orOS Automations — data model and rules (pure, no DOM)
// Loaded by the shell (late bundle, before automations/host.js), by
// automations/index.html before app.js, and by Node in the tests.
//
// Synced slice "automations" (oros-automations-data), owned by
// automations/host.js in the shell:
//   { ver: 1, rules: [rule], tombs: { id: ms } }
//   rule = { id, m, name, on, when, do: [action] }
//   when = { t: "day",   at: "HH:MM", wd: [0-6] }   (wd empty = every day)
//        | { t: "month", at, md: 1-31 | -1 }      (-1 = the last day)
//        | { t: "year",  at, date: "MM-DD" }
//        | { t: "once",  at, date: "YYYY-MM-DD" }
//        | { t: "open" }                          (orOS opens, once a day)
//   action = { a: "notify" | "todo" | "event" | "note" | "mail" |
//              "budget" | "open" | "timer" | "ask", …fields }
// AUTO-1: a rule is data from a fixed list of actions, never code.
// Every action except "notify" only opens the receiving app with a
// prefill through its existing bridge (BR-W8-6): nothing is written
// in another app until the person saves it there (AUTO-2).
// Sync rules (Part I R5/R17/R26): merge(a, b) === merge(b, a), LWW
// by m, a tie goes to the larger JSON; tombstones max-ts, a delete
// wins ties, a newer edit resurrects; canonical (sorted by id).
// ============================================================
(function (root) {
  "use strict";

  var VER = 1;
  var MAX_RULES = 200, MAX_ACTIONS = 8, MAX_ITEMS = 50;
  var NAME_MAX = 80, TEXT_MAX = 2000, LINE_MAX = 200;
  var CATCH_UP_MS = 36 * 3600000;               // a missed run older than this is skipped
  var ID_RE = /^[a-z0-9_-]{1,64}$/i;
  var APP_RE = /^[a-z][a-z0-9]{1,23}$/;
  var HM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
  var YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  var MD_RE = /^(\d{2})-(\d{2})$/;
  var WHEN = ["day", "month", "year", "once", "open"];
  var ACTIONS = ["notify", "todo", "event", "note", "mail", "budget", "open", "timer", "ask"];
  // Apps an action needs (the shell offers the action only when it is installed).
  var NEEDS = { todo: "todo", event: "calendar", note: "notes", mail: "mail", budget: "budget",
                timer: "time", ask: "assistant" };
  // AUTO-4: never offered, never run.
  var BLOCKED_APPS = { passwords: true };

  function empty() { return { ver: VER, rules: [], tombs: {} }; }
  function str(v, max) { return typeof v === "string" ? v.slice(0, max) : ""; }
  function line(v, max) { return str(v, max || LINE_MAX).replace(/[\r\n\t]+/g, " ").trim(); }
  function ms(v) { return typeof v === "number" && isFinite(v) && v > 0 ? Math.floor(v) : 0; }
  function int(v, lo, hi) {
    var n = typeof v === "number" ? v : typeof v === "string" && /^-?\d+$/.test(v) ? +v : NaN;
    return isFinite(n) && Math.floor(n) === n && n >= lo && n <= hi ? n : null;
  }
  function validYmd(s) {
    var m = typeof s === "string" ? YMD_RE.exec(s) : null;
    if (!m) return false;
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
  }
  function validMd(s) {
    var m = typeof s === "string" ? MD_RE.exec(s) : null;
    return !!m && validYmd("2024-" + s);            // 2024 is a leap year: 02-29 allowed
  }

  // ---------- Normalising (a bad field is dropped, never invented) ----------
  function cleanWhen(w) {
    if (!w || typeof w !== "object" || WHEN.indexOf(w.t) < 0) return null;
    if (w.t === "open") return { t: "open" };
    var at = HM_RE.test(w.at) ? w.at : "09:00";
    if (w.t === "day") {
      var wd = [];
      (Array.isArray(w.wd) ? w.wd : []).forEach(function (x) {
        var n = int(x, 0, 6);
        if (n !== null && wd.indexOf(n) < 0) wd.push(n);
      });
      wd.sort();
      return { t: "day", at: at, wd: wd.length === 7 ? [] : wd };
    }
    if (w.t === "month") {
      var md = int(w.md, -1, 31);
      return md === null || md === 0 ? null : { t: "month", at: at, md: md };
    }
    if (w.t === "year") return validMd(w.date) ? { t: "year", at: at, date: w.date } : null;
    return validYmd(w.date) ? { t: "once", at: at, date: w.date } : null;
  }

  function cleanAction(x) {
    if (!x || typeof x !== "object" || ACTIONS.indexOf(x.a) < 0) return null;
    var a = x.a;
    if (a === "notify") {
      var nt = line(x.text, 300);
      return nt ? { a: a, text: nt } : null;
    }
    if (a === "todo") {
      var items = [];
      (Array.isArray(x.items) ? x.items : []).forEach(function (s) {
        var v = line(s);
        if (v && items.length < MAX_ITEMS) items.push(v);
      });
      if (!items.length) return null;
      var o = { a: a, items: items };
      var nl = line(x.newList, 60);
      if (nl) o.newList = nl;
      return o;
    }
    if (a === "event") {
      var title = line(x.title);
      if (!title) return null;
      var ev = { a: a, title: title, off: int(x.off, 0, 365) || 0 };
      if (HM_RE.test(x.start)) ev.start = x.start;
      return ev;
    }
    if (a === "note") {
      var nTitle = line(x.title, 120);
      if (!nTitle) return null;
      return { a: a, title: nTitle, text: str(x.text, TEXT_MAX) };
    }
    if (a === "mail") {
      var subj = line(x.subject, 200), body = str(x.body, TEXT_MAX);
      if (!subj && !body.trim()) return null;
      var m = { a: a, subject: subj, body: body };
      var to = line(x.to, 320);
      if (to && /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(to)) m.to = to;
      return m;
    }
    if (a === "budget") {
      var cents = int(x.amount, 1, 100000000000);
      if (cents === null) return null;
      return { a: a, k: x.k === "i" ? "i" : "o", amount: cents, note: line(x.note, 200) };
    }
    if (a === "open") {
      var app = typeof x.app === "string" ? x.app : "";
      return APP_RE.test(app) && !BLOCKED_APPS[app] && app !== "automations" ? { a: a, app: app } : null;
    }
    if (a === "timer") {
      var min = int(x.min, 1, 6000);
      return min === null ? null : { a: a, min: min, label: line(x.label, 40) };
    }
    var q = str(x.text, TEXT_MAX).trim();           // ask
    return q ? { a: a, text: q } : null;
  }

  function cleanRule(raw) {
    if (!raw || typeof raw !== "object" || typeof raw.id !== "string" || !ID_RE.test(raw.id)) return null;
    var when = cleanWhen(raw.when);
    if (!when) return null;
    var acts = [];
    (Array.isArray(raw["do"]) ? raw["do"] : []).forEach(function (x) {
      var c = cleanAction(x);
      if (c && acts.length < MAX_ACTIONS) acts.push(c);
    });
    if (!acts.length) return null;
    var r = { id: raw.id, m: ms(raw.m), name: line(raw.name, NAME_MAX), on: raw.on !== false, when: when };
    r["do"] = acts;
    return r;
  }

  function newer(a, b) {
    if (a.m !== b.m) return a.m > b.m;
    return JSON.stringify(a) > JSON.stringify(b);
  }
  function byId(a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; }

  function mergeLists(list) {
    var rules = {}, tombs = {};
    list.forEach(function (d) {
      if (!d || typeof d !== "object") return;
      (Array.isArray(d.rules) ? d.rules : []).forEach(function (raw) {
        var r = cleanRule(raw);
        if (r && (!rules[r.id] || newer(r, rules[r.id]))) rules[r.id] = r;
      });
      var t = d.tombs && typeof d.tombs === "object" ? d.tombs : {};
      Object.keys(t).forEach(function (id) {
        var at = ms(t[id]);
        if (at && ID_RE.test(id) && at > (tombs[id] || 0)) tombs[id] = at;
      });
    });
    var out = empty();
    out.rules = Object.keys(rules).map(function (id) { return rules[id]; })
      .filter(function (r) { return !(tombs[r.id] >= r.m); })
      .sort(byId).slice(0, MAX_RULES);
    Object.keys(tombs).sort().forEach(function (id) { out.tombs[id] = tombs[id]; });
    return out;
  }
  function normalize(d) { return mergeLists([d]); }
  function merge(a, b) { return mergeLists([a, b]); }
  function serialize(d) { return JSON.stringify(normalize(d)); }

  // ---------- Edits (the caller passes the clock in) ----------
  function uid(now) { return "r" + Math.floor(now).toString(36) + Math.random().toString(36).slice(2, 7); }
  function find(d, id) {
    var list = normalize(d).rules;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  // put → { data, rule } (rule null = rejected: nothing changed).
  function put(d, rule, now) {
    var out = normalize(d);
    var draft = JSON.parse(JSON.stringify(rule || {}));
    if (typeof draft.id !== "string" || !ID_RE.test(draft.id)) draft.id = uid(now);
    var old = find(out, draft.id);
    draft.m = Math.max(now, old ? old.m + 1 : 0, (out.tombs[draft.id] || 0) + 1);
    var clean = cleanRule(draft);
    if (!clean) return { data: out, rule: null };
    if (old && JSON.stringify(withM(old, 0)) === JSON.stringify(withM(clean, 0))) return { data: out, rule: old };
    out.rules = out.rules.filter(function (r) { return r.id !== clean.id; });
    out.rules.push(clean);
    return { data: normalize(out), rule: clean };
  }
  function withM(r, m) { var c = JSON.parse(JSON.stringify(r)); c.m = m; return c; }
  function remove(d, id, now) {
    var out = normalize(d), old = find(out, id);
    if (!old) return out;
    out.tombs[id] = Math.max(now, old.m);
    return normalize(out);
  }
  function setOn(d, id, on, now) {
    var r = find(d, id);
    if (!r || r.on === !!on) return normalize(d);
    r.on = !!on;
    return put(d, r, now).data;
  }

  // ---------- Schedule (local clock) ----------
  function hm(at) { var m = HM_RE.exec(at) || [0, "09", "00"]; return [+m[1], +m[2]]; }
  function atDay(y, mo, d, at) { var h = hm(at); return new Date(y, mo, d, h[0], h[1], 0, 0).getTime(); }
  function lastDay(y, mo) { return new Date(y, mo + 1, 0).getDate(); }
  function ymdOf(t) {
    var d = new Date(t);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }

  // The latest planned moment at or before `now` (0 = none). Walks back
  // day by day over 400 days at most, so every kind has one code path.
  function lastAt(when, now) {
    if (!when || when.t === "open") return 0;
    if (when.t === "once") {
      var p = YMD_RE.exec(when.date), t1 = atDay(+p[1], +p[2] - 1, +p[3], when.at);
      return t1 <= now ? t1 : 0;
    }
    var d = new Date(now);
    for (var i = 0; i < 400; i++) {
      var day = new Date(d.getFullYear(), d.getMonth(), d.getDate() - i);
      if (hits(when, day)) {
        var t = atDay(day.getFullYear(), day.getMonth(), day.getDate(), when.at);
        if (t <= now) return t;
      }
    }
    return 0;
  }
  // The next planned moment after `now` (0 = none), for the list.
  function nextAt(when, now) {
    if (!when || when.t === "open") return 0;
    if (when.t === "once") {
      var p = YMD_RE.exec(when.date), t1 = atDay(+p[1], +p[2] - 1, +p[3], when.at);
      return t1 > now ? t1 : 0;
    }
    var d = new Date(now);
    for (var i = 0; i < 400; i++) {
      var day = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i);
      if (hits(when, day)) {
        var t = atDay(day.getFullYear(), day.getMonth(), day.getDate(), when.at);
        if (t > now) return t;
      }
    }
    return 0;
  }
  function hits(when, day) {
    if (when.t === "day") return !when.wd.length || when.wd.indexOf(day.getDay()) >= 0;
    if (when.t === "month") {
      var last = lastDay(day.getFullYear(), day.getMonth());
      var want = when.md === -1 ? last : Math.min(when.md, last);   // the 31st is the 30th in April
      return day.getDate() === want;
    }
    var p = MD_RE.exec(when.date);
    var mo = +p[1] - 1, dd = +p[2];
    if (mo === 1 && dd === 29 && lastDay(day.getFullYear(), 1) === 28) dd = 28;   // 29 Feb → 28 Feb
    return day.getMonth() === mo && day.getDate() === dd;
  }

  // Which run is due now? → { key, at, late } or null.
  //   done = this device's last handled key for the rule ("" = none).
  //   bootAt = this session's start (for "open").
  // The key names one planned run; the shell posts it as the
  // notification key, so the synced inbox runs it once on every device
  // (AUTO-3).
  function due(rule, now, done, bootAt) {
    if (!rule || !rule.on) return null;
    if (rule.when.t === "open") {
      var k = rule.id + "@" + ymdOf(now).replace(/-/g, "");
      return done === k || !bootAt ? null : { key: k, at: bootAt, late: false };
    }
    var at = lastAt(rule.when, now);
    if (!at || now - at > CATCH_UP_MS) return null;
    if (rule.m && at < rule.m - 60000) return null;      // made or changed after that moment
    var key = rule.id + "@" + stamp(at);
    if (done === key) return null;
    return { key: key, at: at, late: now - at > 15 * 60000 };
  }
  function stamp(t) {
    var d = new Date(t);
    return "" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + pad(d.getHours()) + pad(d.getMinutes());
  }

  // ---------- Words (one { en, el } table; a pack adds other languages) ----------
  var STRINGS = {
    en: {
      "wd.0": "Sunday", "wd.1": "Monday", "wd.2": "Tuesday", "wd.3": "Wednesday", "wd.4": "Thursday",
      "wd.5": "Friday", "wd.6": "Saturday",
      "mo.0": "January", "mo.1": "February", "mo.2": "March", "mo.3": "April", "mo.4": "May", "mo.5": "June",
      "mo.6": "July", "mo.7": "August", "mo.8": "September", "mo.9": "October", "mo.10": "November", "mo.11": "December",
      "ws.0": "Sun", "ws.1": "Mon", "ws.2": "Tue", "ws.3": "Wed", "ws.4": "Thu", "ws.5": "Fri", "ws.6": "Sat",
      "when.day": "Every day", "when.wd": "Every {days}", "when.month": "Every month on day {n}",
      "when.monthLast": "On the last day of every month", "when.year": "Every year on {date}",
      "when.once": "Once, on {date}", "when.open": "When orOS opens", "when.at": " at {at}",
      "notice.tap": "Tap to continue: {what}",
      "act.todo": "add {n} to To-Do", "act.event": "add to Calendar", "act.note": "add a note",
      "act.mail": "write an e-mail", "act.budget": "add to Budget", "act.open": "open {app}",
      "act.timer": "start a {n} min timer", "act.ask": "ask the Assistant",
      "tpl.week-plan": "Plan the week",
      "tpl.week-plan.text": "A new week starts. Have a look at your calendar and tasks.",
      "tpl.evening": "End of the day", "tpl.evening.text": "How was your day? Write one sentence about it.",
      "tpl.bills": "Monthly bills", "tpl.bills.list": "Bills {month}",
      "tpl.bills.items": "Rent\nElectricity\nWater\nPhone and internet",
      "tpl.weekend-shop": "Weekend shopping", "tpl.weekend-shop.text": "Time to check the shopping list.",
      "tpl.friday-hours": "Friday: hours and invoices",
      "tpl.friday-hours.text": "Check this week's hours before you invoice.",
      "tpl.backup": "Monthly check of sync and backup",
      "tpl.backup.text": "Make sure sync is on and take a backup.",
      "tpl.morning": "Good morning", "tpl.focus": "Focus hour", "tpl.focus.label": "Focus",
      "tpl.weekly-review": "Weekly review", "tpl.weekly-review.title": "Week review {date}",
      "tpl.weekly-review.text": "What went well:\n\nWhat to change:\n\nNext week:\n",
      "tpl.open-today": "Summary when orOS opens",
      "from": "Automations"
    },
    el: {
      "wd.0": "Κυριακή", "wd.1": "Δευτέρα", "wd.2": "Τρίτη", "wd.3": "Τετάρτη", "wd.4": "Πέμπτη",
      "wd.5": "Παρασκευή", "wd.6": "Σάββατο",
      "mo.0": "Ιανουάριος", "mo.1": "Φεβρουάριος", "mo.2": "Μάρτιος", "mo.3": "Απρίλιος", "mo.4": "Μάιος", "mo.5": "Ιούνιος",
      "mo.6": "Ιούλιος", "mo.7": "Αύγουστος", "mo.8": "Σεπτέμβριος", "mo.9": "Οκτώβριος", "mo.10": "Νοέμβριος", "mo.11": "Δεκέμβριος",
      "ws.0": "Κυρ", "ws.1": "Δευ", "ws.2": "Τρί", "ws.3": "Τετ", "ws.4": "Πέμ", "ws.5": "Παρ", "ws.6": "Σάβ",
      "when.day": "Κάθε μέρα", "when.wd": "Κάθε {days}", "when.month": "Κάθε {n}η του μήνα",
      "when.monthLast": "Την τελευταία μέρα κάθε μήνα", "when.year": "Κάθε χρόνο στις {date}",
      "when.once": "Μία φορά, στις {date}", "when.open": "Όταν ανοίγει το orOS", "when.at": " στις {at}",
      "notice.tap": "Πάτησε για να συνεχίσεις: {what}",
      "act.todo": "{n} στο To-Do", "act.event": "στο Ημερολόγιο", "act.note": "νέα σημείωση",
      "act.mail": "νέο e-mail", "act.budget": "στον Προϋπολογισμό", "act.open": "άνοιγμα: {app}",
      "act.timer": "χρονόμετρο {n} λεπτών", "act.ask": "ερώτηση στον Βοηθό",
      "tpl.week-plan": "Πρόγραμμα εβδομάδας",
      "tpl.week-plan.text": "Ξεκινά νέα εβδομάδα. Ρίξε μια ματιά στο ημερολόγιο και στις εργασίες σου.",
      "tpl.evening": "Τέλος της μέρας", "tpl.evening.text": "Πώς ήταν η μέρα σου; Γράψε μια πρόταση γι' αυτήν.",
      "tpl.bills": "Μηνιαίοι λογαριασμοί", "tpl.bills.list": "Λογαριασμοί {month}",
      "tpl.bills.items": "Ενοίκιο\nΡεύμα\nΝερό\nΤηλέφωνο και ίντερνετ",
      "tpl.weekend-shop": "Ψώνια Σαββατοκύριακου", "tpl.weekend-shop.text": "Ώρα να δεις τη λίστα για ψώνια.",
      "tpl.friday-hours": "Παρασκευή: ώρες και τιμολόγια",
      "tpl.friday-hours.text": "Έλεγξε τις ώρες της εβδομάδας πριν κόψεις τιμολόγια.",
      "tpl.backup": "Μηνιαίος έλεγχος συγχρονισμού και αντιγράφων",
      "tpl.backup.text": "Βεβαιώσου ότι ο συγχρονισμός είναι ενεργός και κράτησε αντίγραφο.",
      "tpl.morning": "Καλημέρα", "tpl.focus": "Ώρα συγκέντρωσης", "tpl.focus.label": "Συγκέντρωση",
      "tpl.weekly-review": "Εβδομαδιαία ανασκόπηση", "tpl.weekly-review.title": "Ανασκόπηση εβδομάδας {date}",
      "tpl.weekly-review.text": "Τι πήγε καλά:\n\nΤι να αλλάξω:\n\nΤην επόμενη εβδομάδα:\n",
      "tpl.open-today": "Σύνοψη όταν ανοίγει το orOS",
      "from": "Αυτοματισμοί"
    }
  };
  // The table for a language: a pack language through orosI18n (in a
  // page), else Greek or English.
  function words(lang) {
    if (lang && STRINGS[lang]) return STRINGS[lang];
    var I = typeof window !== "undefined" ? window.orosI18n : null;
    if (I && typeof I.table === "function" && lang && lang !== "en" && lang !== "el") {
      try { return I.table(STRINGS, "automations", lang); } catch (e) {}
    }
    return STRINGS[lang === "el" ? "el" : "en"];
  }
  function w(lang, k) { return words(lang)[k] || STRINGS.en[k] || k; }
  function sub(s, o) { return s.replace(/\{(\w+)\}/g, function (all, k) { return o[k] !== undefined ? o[k] : all; }); }

  // ---------- Placeholders: {date} {weekday} {month} {year} ----------
  function fill(text, at, lang) {
    var d = new Date(at);
    return String(text).replace(/\{(date|weekday|month|year)\}/g, function (all, k) {
      if (k === "date") return d.getDate() + "/" + (d.getMonth() + 1) + "/" + d.getFullYear();
      if (k === "weekday") return w(lang, "wd." + d.getDay());
      if (k === "month") return w(lang, "mo." + d.getMonth());
      return String(d.getFullYear());
    });
  }

  // ---------- Actions → the receiving app's existing bridge ----------
  // → { fn: "openAt" | "calendarNew" | "budgetNew" | "openApp", app, arg }
  // or null. `at` is the planned moment of the run (placeholders and
  // dates), `from` the source label the receiver shows.
  function call(action, at, lang, from) {
    var a = cleanAction(action);
    if (!a || a.a === "notify") return null;
    var f = function (s) { return fill(s, at, lang); };
    if (a.a === "todo") {
      var add = { from: from, items: a.items.map(function (s) { return { text: f(s).slice(0, LINE_MAX) }; }) };
      if (a.newList) add.newList = f(a.newList).slice(0, 60);
      return { fn: "openAt", app: "todo", arg: { addItems: add } };
    }
    if (a.a === "event") {
      var day = new Date(at);
      var p = { date: ymdOf(new Date(day.getFullYear(), day.getMonth(), day.getDate() + a.off, 12).getTime()),
                title: f(a.title).slice(0, LINE_MAX) };
      if (a.start) p.start = a.start;
      return { fn: "calendarNew", app: "calendar", arg: p };
    }
    if (a.a === "note") return { fn: "openAt", app: "notes", arg: { add: { title: f(a.title).slice(0, 120), text: f(a.text).slice(0, TEXT_MAX) } } };
    if (a.a === "mail") {
      var c = { subject: f(a.subject).slice(0, 200), body: f(a.body).slice(0, TEXT_MAX) };
      if (a.to) c.to = a.to;
      return { fn: "openAt", app: "mail", arg: { compose: c } };
    }
    if (a.a === "budget") {
      return { fn: "budgetNew", app: "budget",
               arg: { k: a.k, a: a.amount, d: ymdOf(at), n: f(a.note).slice(0, 500), src: "automations" } };
    }
    if (a.a === "open") return { fn: "openApp", app: a.app, arg: null };
    if (a.a === "timer") return { fn: "openAt", app: "time", arg: { timer: { sec: a.min * 60, label: f(a.label).slice(0, 40) } } };
    return { fn: "openAt", app: "assistant", arg: { ask: f(a.text).slice(0, 2000) } };
  }
  function needs(action) {
    if (!action) return "";
    return action.a === "open" ? action.app : NEEDS[action.a] || "";
  }
  // Can this rule run on a device with these apps? (AUTO-5)
  function runnable(rule, installed) {
    var ok = true;
    (rule && rule["do"] || []).forEach(function (a) {
      var app = needs(a);
      if (app && installed.indexOf(app) < 0) ok = false;
    });
    return ok;
  }

  // ---------- Words for the list and the notice ----------
  function whenText(when, lang) {
    var at = when.at ? sub(w(lang, "when.at"), { at: when.at }) : "";
    if (when.t === "open") return w(lang, "when.open");
    if (when.t === "day") {
      if (!when.wd.length) return w(lang, "when.day") + at;
      var order = [1, 2, 3, 4, 5, 6, 0].filter(function (n) { return when.wd.indexOf(n) >= 0; });
      return sub(w(lang, "when.wd"), { days: order.map(function (n) { return w(lang, "ws." + n); }).join(", ") }) + at;
    }
    if (when.t === "month") return (when.md === -1 ? w(lang, "when.monthLast") : sub(w(lang, "when.month"), { n: when.md })) + at;
    if (when.t === "year") { var p = MD_RE.exec(when.date); return sub(w(lang, "when.year"), { date: +p[2] + "/" + +p[1] }) + at; }
    var q = YMD_RE.exec(when.date);
    return sub(w(lang, "when.once"), { date: +q[3] + "/" + +q[2] + "/" + q[1] }) + at;
  }
  function actText(a, lang, appName) {
    if (a.a === "todo") return sub(w(lang, "act.todo"), { n: a.items.length });
    if (a.a === "open") return sub(w(lang, "act.open"), { app: appName ? appName(a.app) : a.app });
    if (a.a === "timer") return sub(w(lang, "act.timer"), { n: a.min });
    return a.a === "notify" ? "" : w(lang, "act." + a.a);
  }
  // The notice for one run → { title, body }.
  function notice(rule, at, lang, appName) {
    var parts = [], rest = [];
    rule["do"].forEach(function (a) {
      if (a.a === "notify") parts.push(fill(a.text, at, lang));
      else rest.push(actText(a, lang, appName));
    });
    if (rest.length) parts.push(sub(w(lang, "notice.tap"), { what: rest.join(", ") }));
    return { title: rule.name || whenText(rule.when, lang), body: parts.join("\n").slice(0, 500) };
  }
  function pending(rule) {
    return (rule && rule["do"] || []).filter(function (a) { return a.a !== "notify"; });
  }

  // ---------- Ready-made rules (templates) ----------
  // Texts come from STRINGS ("@key"), so every language gets them (R15).
  var TEMPLATES = [
    { id: "week-plan", when: { t: "day", at: "08:30", wd: [1] },
      "do": [{ a: "notify", text: "@tpl.week-plan.text" }, { a: "open", app: "today" }] },
    { id: "evening", when: { t: "day", at: "21:30", wd: [] },
      "do": [{ a: "notify", text: "@tpl.evening.text" }, { a: "open", app: "diary" }] },
    { id: "bills", when: { t: "month", at: "09:00", md: 1 },
      "do": [{ a: "todo", newList: "@tpl.bills.list", items: "@tpl.bills.items" }] },
    { id: "weekend-shop", when: { t: "day", at: "10:00", wd: [6] },
      "do": [{ a: "notify", text: "@tpl.weekend-shop.text" }, { a: "open", app: "meals" }] },
    { id: "friday-hours", when: { t: "day", at: "17:00", wd: [5] },
      "do": [{ a: "notify", text: "@tpl.friday-hours.text" }, { a: "open", app: "timesheet" }] },
    { id: "backup", when: { t: "month", at: "19:00", md: -1 },
      "do": [{ a: "notify", text: "@tpl.backup.text" }, { a: "open", app: "settings" }] },
    { id: "morning", when: { t: "day", at: "08:00", wd: [1, 2, 3, 4, 5] }, "do": [{ a: "open", app: "today" }] },
    { id: "focus", when: { t: "day", at: "10:00", wd: [1, 2, 3, 4, 5] },
      "do": [{ a: "timer", min: 50, label: "@tpl.focus.label" }] },
    { id: "weekly-review", when: { t: "day", at: "18:00", wd: [0] },
      "do": [{ a: "note", title: "@tpl.weekly-review.title", text: "@tpl.weekly-review.text" }] },
    { id: "open-today", when: { t: "open" }, "do": [{ a: "open", app: "today" }] }
  ];
  function pick(v, lang, k) {
    if (typeof v !== "string" || v.charAt(0) !== "@") return v;
    var s = w(lang, v.slice(1));
    return k === "items" ? s.split("\n") : s;
  }
  // A template in one language, ready for put() (no id: put gives one).
  function fromTemplate(id, lang) {
    var tp = null;
    TEMPLATES.forEach(function (x) { if (x.id === id) tp = x; });
    if (!tp) return null;
    var r = { name: w(lang, "tpl." + id), on: true, when: JSON.parse(JSON.stringify(tp.when)) };
    r["do"] = tp["do"].map(function (a) {
      var o = {};
      Object.keys(a).forEach(function (k) { o[k] = pick(a[k], lang, k); });
      return o;
    });
    return r;
  }
  function templates(lang) {
    return TEMPLATES.map(function (tp) { return { id: tp.id, name: w(lang, "tpl." + tp.id), rule: fromTemplate(tp.id, lang) }; });
  }
  function from(lang) { return w(lang, "from"); }

  var API = {
    VER: VER, MAX_RULES: MAX_RULES, MAX_ACTIONS: MAX_ACTIONS, ACTIONS: ACTIONS.slice(), WHEN: WHEN.slice(),
    CATCH_UP_MS: CATCH_UP_MS, ID_RE: ID_RE, BLOCKED_APPS: BLOCKED_APPS,
    empty: empty, normalize: normalize, merge: merge, serialize: serialize,
    cleanRule: cleanRule, cleanAction: cleanAction, cleanWhen: cleanWhen,
    put: put, remove: remove, setOn: setOn, find: find,
    lastAt: lastAt, nextAt: nextAt, due: due, fill: fill, call: call, needs: needs, runnable: runnable,
    whenText: whenText, actText: actText, notice: notice, pending: pending,
    templates: templates, fromTemplate: fromTemplate, ymdOf: ymdOf, from: from, STRINGS: STRINGS
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.OrosAutoCore = API;
})(typeof window !== "undefined" ? window : globalThis);
