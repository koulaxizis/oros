// ============================================================
// orOS Assistant — per-app summaries (v1.0.0)
// The app_summary tool: totals worked out ON THE DEVICE from what an
// app keeps in localStorage, so the model gets a few numbers instead
// of every entry. Pure: no DOM, no storage, never writes. The
// assistant (assistant.js) reads the app's data, calls one of these
// and shows the result to the user before it is shared (the app's
// own "Ask first / Always / Never" permission decides).
//   normArgs(args, today)        → { ok, app, month, days } | { ok:false, err }
//   budgetMonth(raw, month, lang) Budget: income, expenses and each
//                                 category of one month
//   timesheetMonth(core, data, month, now)
//                                 Timesheet: hours (and amounts) of one
//                                 month per project, with the app's own
//                                 rounding (OrosTimesheetCore.report)
//   todoLists(raw, today)        To-Do: open / done / late / due today,
//                                 in total and per list
//   calendarEvents(raw, opts)    Calendar: the user's labels with how
//                                 many events each has, and, with a
//                                 label ("none" = no label) and/or a
//                                 month, those events with every field
//   stockMonth(raw, month, lang) Stock: what sold in one month, per
//                                 product and per place (your own
//                                 stock, each consignment shop or
//                                 other warehouse), returns taken off
//   agenda(rows, today, days)    any app with a Today provider
//                                 (today/host.js agenda): what is late,
//                                 today and in the next days
//   preview(sum, lang)           → [line] what the consent card shows
// Exposes window.OrosAssistSummary and, under Node, module.exports.
// ============================================================
(function (root) {
  "use strict";

  var YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
  var YM = /^(\d{4})-(\d{2})$/;
  var MAX_CATS = 40, MAX_PROJECTS = 40, MAX_LISTS = 40, MAX_ITEMS = 60,
      MAX_EVENTS = 200;   // calendarEvents (by label / month): as many as refs take
  // Apps with a summary of their own; any other app needs a Today provider.
  var OWN = { budget: "month", timesheet: "month", todo: "lists", stock: "month" };

  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function arr(a) { return Array.isArray(a) ? a : []; }
  function str(v, max) { return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max || 120) : ""; }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function money(cents) { return Math.round(cents) / 100; }
  function hours(ms) { return Math.round(ms / 36000) / 100; }
  function lastDay(month) {
    var m = YM.exec(month);
    return month + "-" + pad(new Date(Date.UTC(+m[1], +m[2], 0)).getUTCDate());
  }
  function addDays(ymd, n) {
    var m = YMD.exec(ymd);
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + n));
    return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
  }

  // ---------- Arguments ----------
  function normArgs(args, today) {
    if (!isObj(args)) return { ok: false, err: "The arguments must be an object." };
    var app = String(args.app || "").toLowerCase();
    if (!/^[a-z0-9_-]{1,40}$/.test(app)) return { ok: false, err: "app must be an app id from list_apps." };
    var month = today.slice(0, 7), monthSet = false;
    if (args.month !== undefined && args.month !== null && args.month !== "") {
      var m = YM.exec(String(args.month).trim());
      if (!m || +m[2] < 1 || +m[2] > 12 || +m[1] < 2000 || +m[1] > 2100) {
        return { ok: false, err: "month must be YYYY-MM." };
      }
      month = m[0];
      monthSet = true;
    }
    var days = 7;
    if (args.days !== undefined && args.days !== null && args.days !== "") {
      var n = typeof args.days === "number" ? args.days : parseInt(args.days, 10);
      if (!(n >= 1 && n <= 31) || Math.floor(n) !== n) return { ok: false, err: "days must be a whole number from 1 to 31." };
      days = n;
    }
    var out = { ok: true, app: app, month: month, days: days };
    if (app === "calendar") {
      out.monthSet = monthSet;
      if (typeof args.label === "string" && args.label.trim()) out.label = args.label.replace(/\s+/g, " ").trim().slice(0, 40);
    }
    return out;
  }

  // ---------- Budget ----------
  // Same names and tombstone rule as budget/search.js.
  var SEED_NAMES = {
    en: { "o-groc": "Groceries", "o-eat": "Eating out", "o-bills": "Bills", "o-home": "Rent & home",
          "o-trans": "Transport", "o-health": "Health", "o-fun": "Entertainment", "o-cloth": "Clothing",
          "o-gift": "Gifts", "o-other": "Other", "i-salary": "Salary", "i-free": "Freelance",
          "i-gift": "Gifts", "i-other": "Other" },
    el: { "o-groc": "Σούπερ μάρκετ", "o-eat": "Φαγητό έξω", "o-bills": "Λογαριασμοί", "o-home": "Ενοίκιο & σπίτι",
          "o-trans": "Μεταφορές", "o-health": "Υγεία", "o-fun": "Ψυχαγωγία", "o-cloth": "Ρούχα",
          "o-gift": "Δώρα", "o-other": "Άλλα", "i-salary": "Μισθός", "i-free": "Ελεύθερο επάγγελμα",
          "i-gift": "Δώρα", "i-other": "Άλλα" }
  };
  function budgetMonth(d, month, lang) {
    lang = SEED_NAMES[lang] && L[lang] ? lang : "en";
    var out = { app: "budget", month: month, currency: "EUR", income: 0, expenses: 0, net: 0, entries: 0, categories: [] };
    if (!isObj(d)) return out;
    var tombs = isObj(d.tombs) ? d.tombs : {}, seeds = SEED_NAMES[lang];
    if (d.set && typeof d.set.cur === "string" && /^[A-Z]{3}$/.test(d.set.cur)) out.currency = d.set.cur;
    function dead(kind, x) {
      var ts = tombs[kind + ":" + x.id];
      return typeof ts === "number" && ts >= (Number(x.m) || 0);
    }
    var stored = {};
    arr(d.cats).forEach(function (c) {
      if (c && typeof c.id === "string" && !dead("cat", c)) stored[c.id] = c;
    });
    function catName(id) {
      if (!id) return L[lang].uncat;
      var c = stored[id];
      if (c && str(c.name)) return str(c.name, 60);
      if (seeds[id] && !(("cat:" + id) in tombs && !c)) return seeds[id];
      return L[lang].uncat;
    }
    var cats = {}, inc = 0, exp = 0;
    arr(d.tx).forEach(function (x) {
      if (!x || typeof x.id !== "string" || dead("tx", x)) return;
      if (typeof x.d !== "string" || x.d.slice(0, 7) !== month) return;
      if (typeof x.a !== "number" || !isFinite(x.a)) return;
      var k = x.k === "i" ? "i" : "o", a = Math.abs(Math.round(x.a));
      var name = catName(x.c), key = k + ":" + name;
      var g = cats[key] || (cats[key] = { kind: k === "i" ? "income" : "expense", name: name, total: 0, entries: 0 });
      g.total += a;
      g.entries++;
      if (k === "i") inc += a; else exp += a;
      out.entries++;
    });
    out.income = money(inc);
    out.expenses = money(exp);
    out.net = money(inc - exp);
    var list = Object.keys(cats).map(function (k) { return cats[k]; });
    list.sort(function (a, b) { return (a.kind < b.kind ? 1 : a.kind > b.kind ? -1 : 0) || b.total - a.total || (a.name < b.name ? -1 : 1); });
    out.categories = list.slice(0, MAX_CATS).map(function (g) {
      return { kind: g.kind, name: g.name, total: money(g.total), entries: g.entries };
    });
    if (list.length > MAX_CATS) out.more_categories = list.length - MAX_CATS;
    return out;
  }

  // ---------- Stock (publisher wave P14) ----------
  // Sales of one month from Stock's movements: "out" sells, "ret" is a
  // customer return; voided and deleted movements don't count. A
  // movement's warehouse is the place (a consignment shop's settlement
  // is an "out" in that shop). Quantities are kept in thousandths.
  var MAX_PRODUCTS = 60;
  function stockMonth(d, month, lang) {
    lang = L[lang] ? lang : "en";
    var out = { app: "stock", month: month, currency: "EUR", units: 0, amount: 0, sales: 0, products: [], places: [] };
    if (!isObj(d)) return out;
    var tombs = isObj(d.tombs) ? d.tombs : {};
    function dead(x) { var ts = tombs[x.id]; return typeof ts === "number" && ts >= (Number(x.m) || 0); }
    if (isObj(d.settings) && typeof d.settings.cur === "string" && /^[A-Z]{3}$/.test(d.settings.cur)) out.currency = d.settings.cur;
    var items = {}, whs = {};
    arr(d.items).forEach(function (it) { if (it && typeof it.id === "string" && !dead(it)) items[it.id] = it; });
    arr(d.whs).forEach(function (w) { if (w && typeof w.id === "string" && !dead(w)) whs[w.id] = str(w.name, 60); });
    function place(w) { return typeof w === "string" && w && w !== "whmain" ? whs[w] || "?" : L[lang].stMain; }
    var prods = {}, places = {}, units = 0, amount = 0;
    arr(d.moves).forEach(function (mv) {
      if (!mv || typeof mv.id !== "string" || dead(mv) || mv.v) return;
      if ((mv.t !== "out" && mv.t !== "ret") || typeof mv.d !== "string" || mv.d.slice(0, 7) !== month) return;
      var pl = place(mv.w), any = false;
      arr(mv.lines).forEach(function (l) {
        if (!l || typeof l.q !== "number" || !isFinite(l.q) || !items[l.i]) return;
        var q = mv.t === "out" ? Math.abs(l.q) : -Math.abs(l.q);
        var a = typeof l.p === "number" && isFinite(l.p) ? q * l.p / 1000 : 0;
        var it = items[l.i];
        var g = prods[l.i] || (prods[l.i] = { name: str(it.name, 120), sku: str(it.sku, 40), q: 0, a: 0, at: {} });
        g.q += q; g.a += a;
        g.at[pl] = (g.at[pl] || 0) + q;
        var P = places[pl] || (places[pl] = { q: 0, a: 0 });
        P.q += q; P.a += a;
        units += q; amount += a;
        any = true;
      });
      if (any) out.sales++;
    });
    function u(q) { return Math.round(q) / 1000; }
    out.units = u(units);
    out.amount = money(amount);
    var list = Object.keys(prods).map(function (k) { return prods[k]; }).filter(function (g) { return g.q !== 0 || g.a !== 0; });
    list.sort(function (a, b) { return b.q - a.q || b.a - a.a || (a.name < b.name ? -1 : 1); });
    out.products = list.slice(0, MAX_PRODUCTS).map(function (g) {
      var o = { name: g.name, units: u(g.q), amount: money(g.a), places: Object.keys(g.at).sort().map(function (n) { return { name: n, units: u(g.at[n]) }; }) };
      if (g.sku) o.sku = g.sku;
      return o;
    });
    if (list.length > MAX_PRODUCTS) out.more_products = list.length - MAX_PRODUCTS;
    out.places = Object.keys(places).sort().map(function (n) { return { name: n, units: u(places[n].q), amount: money(places[n].a) }; });
    return out;
  }

  // ---------- Timesheet ----------
  // core = OrosTimesheetCore, data = core.parse(raw).
  function timesheetMonth(core, data, month, now) {
    var out = { app: "timesheet", month: month, hours: 0, billable_hours: 0, amount: 0, currency: "EUR", entries: 0, projects: [] };
    if (!core || !data) return out;
    var from = month + "-01", to = lastDay(month);
    var rep = core.report(data, from, to, { group: "project" }, now);
    out.currency = data.prefs && data.prefs.cur || "EUR";
    out.hours = hours(rep.total.ms);
    out.billable_hours = hours(rep.total.billMs);
    out.amount = money(rep.total.amount);
    out.entries = rep.ids.length;
    out.projects = rep.rows.slice(0, MAX_PROJECTS).map(function (g) {
      var p = core.project(data, g.key), c = p ? core.projectClient(data, p) : null;
      var row = { name: p ? p.name : "", hours: hours(g.ms) };
      if (c) row.client = c.name;
      if (g.billMs) row.billable_hours = hours(g.billMs);
      if (g.amount) row.amount = money(g.amount);
      return row;
    });
    if (rep.rows.length > MAX_PROJECTS) out.more_projects = rep.rows.length - MAX_PROJECTS;
    var run = core.running(data);
    if (run.length) out.running = run.map(function (x) { var p = core.project(data, x.p); return p ? p.name : ""; }).slice(0, 5);
    return out;
  }

  // ---------- To-Do ----------
  // Deleted lists and tasks are gone from the blob (todo/core.js).
  function todoLists(d, today) {
    var out = { app: "todo", today: today, open: 0, done: 0, overdue: 0, due_today: 0, lists: [] };
    if (!isObj(d)) return out;
    arr(d.lists).forEach(function (l) {
      if (!isObj(l) || !Array.isArray(l.items)) return;
      var row = { name: str(l.name, 80), open: 0, done: 0, overdue: 0, due_today: 0 };
      l.items.forEach(function (it) {
        if (!isObj(it)) return;
        if (it.done) { row.done++; return; }
        row.open++;
        if (typeof it.due === "string" && YMD.test(it.due)) {
          if (it.due < today) row.overdue++;
          else if (it.due === today) row.due_today++;
        }
      });
      out.open += row.open; out.done += row.done; out.overdue += row.overdue; out.due_today += row.due_today;
      out.lists.push(row);
    });
    if (out.lists.length > MAX_LISTS) {
      out.more_lists = out.lists.length - MAX_LISTS;
      out.lists = out.lists.slice(0, MAX_LISTS);
    }
    return out;
  }

  // ---------- Calendar ----------
  // Same data as calendar/search.js (oros-calendar-data): the user's
  // own labels (calendar.js state.labels; untouched seeds, mtime 0,
  // are stored in English and shown translated, so both names count)
  // and events[] (deleted events are not there). An event whose
  // labelId names no label shows as no label, as in Calendar. Feed
  // rows (birthdays, To-Do…) are not stored here.
  var CAL_SEEDS = {
    en: { "cal.lbl-personal": "Personal", "cal.lbl-work": "Work", "cal.lbl-family": "Family" },
    el: { "cal.lbl-personal": "Προσωπικό", "cal.lbl-work": "Εργασία", "cal.lbl-family": "Οικογένεια" }
  };
  var NO_LABEL = /^(none|no label)$/i;
  function foldName(s) {
    return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  }
  function calLabelNames(l) {
    return l.mtime === 0 && CAL_SEEDS.en["cal." + l.id] ? [CAL_SEEDS.en["cal." + l.id], CAL_SEEDS.el["cal." + l.id]] : [str(l.name, 40)];
  }
  // opts: { label?, month?, today }
  function calendarEvents(raw, opts) {
    opts = opts || {};
    var d = isObj(raw) ? raw : {}, byId = {}, labels = [];
    arr(d.labels).forEach(function (l) {
      if (!isObj(l) || typeof l.id !== "string" || !l.id || typeof l.name !== "string" || byId[l.id]) return;
      byId[l.id] = { name: calLabelNames(l).join(" / "), names: calLabelNames(l), events: 0 };
      labels.push(byId[l.id]);
    });
    var events = arr(d.events).filter(function (e) {
      return isObj(e) && typeof e.id === "string" && typeof e.date === "string" && YMD.test(e.date);
    });
    var none = 0;
    events.forEach(function (e) {
      var l = typeof e.labelId === "string" ? byId[e.labelId] : null;
      if (l) l.events++; else none++;
    });
    var out = { app: "calendar", events: events.length,
                labels: labels.map(function (l) { return { name: l.name, events: l.events }; }), no_label: none };
    if (!opts.label && !opts.month) return out;
    var want = null;
    if (opts.label && !NO_LABEL.test(opts.label)) {
      var f = foldName(opts.label);
      labels.forEach(function (l) {
        if (!want && l.names.some(function (n) { return foldName(n) === f; })) want = l;
      });
      if (!want) {
        return { ok: false, err: "Calendar has no label named \"" + opts.label + "\". Its labels: " +
          (labels.length ? labels.map(function (l) { return l.name; }).join(", ") : "none") + "." };
      }
    }
    var items = [];
    events.forEach(function (e) {
      var l = typeof e.labelId === "string" ? byId[e.labelId] : null;
      if (opts.label && (want ? l !== want : !!l)) return;
      var end = typeof e.dateEnd === "string" && YMD.test(e.dateEnd) && e.dateEnd > e.date ? e.dateEnd : e.date;
      var rep = isObj(e.recur);
      if (opts.month && !rep && (end.slice(0, 7) < opts.month || e.date.slice(0, 7) > opts.month)) return;
      if (opts.month && rep && e.date.slice(0, 7) > opts.month) return;
      var it = { title: str(e.title, 160) || "—", date: e.date };
      if (end !== e.date) it.date_end = end;
      var st = typeof e.start === "string" ? e.start : typeof e.time === "string" ? e.time : "";
      if (/^\d{2}:\d{2}$/.test(st)) it.time = st + (typeof e.end === "string" && /^\d{2}:\d{2}$/.test(e.end) ? "–" + e.end : "");
      it.label = l ? l.name : "";
      if (str(e.location, 150)) it.location = str(e.location, 150);
      if (str(e.note, 240)) it.note = str(e.note, 240);
      if (rep) it.repeats = true;
      it.target = { id: e.id, date: e.date };       // → a ref (assistant.js)
      items.push(it);
    });
    items.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.time || "") < (b.time || "") ? -1 : (a.time || "") > (b.time || "") ? 1 : 0; });
    if (opts.label) out.filter_label = want ? want.name : "none";
    if (opts.month) out.month = opts.month;
    out.items = items.slice(0, MAX_EVENTS);
    out.listed = items.length;
    if (items.length > MAX_EVENTS) out.more_items = items.length - MAX_EVENTS;
    return out;
  }

  // ---------- Agenda (Today providers) ----------
  // rows: today/agg.js clean rows { due, time, title, text, kind }.
  function agenda(app, rows, today, days) {
    var last = addDays(today, days - 1), items = [];
    arr(rows).forEach(function (r) {
      if (!isObj(r) || typeof r.title !== "string") return;
      var due = typeof r.due === "string" && YMD.test(r.due) ? r.due : null;
      if (due && due > last) return;
      if (due && due < today && r.kind !== "task") return;      // a past event is gone, not late
      var it = { title: str(r.title, 160) };
      if (due) it.date = due;
      if (typeof r.time === "string" && /^\d{2}:\d{2}$/.test(r.time)) it.time = r.time;
      if (str(r.text, 240)) it.text = str(r.text, 240);
      if (due && due < today) it.late = true;
      if (r.kind === "info") it.info = true;
      if (r.target !== undefined && r.target !== null) it.target = r.target;   // → a ref (assistant.js)
      items.push(it);
    });
    items.sort(function (a, b) {
      var x = a.date || today, y = b.date || today;
      return (x < y ? -1 : x > y ? 1 : 0) || ((a.time || "") < (b.time || "") ? -1 : (a.time || "") > (b.time || "") ? 1 : 0);
    });
    var out = { app: app, from: today, to: last, items: items.slice(0, MAX_ITEMS) };
    if (items.length > MAX_ITEMS) out.more_items = items.length - MAX_ITEMS;
    return out;
  }

  // ---------- What the consent card shows ----------
  var L = {
    en: { inc: "Income", exp: "Expenses", net: "Balance", ent: "entries", h: "h", bill: "billable",
          open: "open", done: "done", late: "late", today: "due today", none: "Nothing in this period.",
          run: "Running now", more: "+{n} more", uncat: "Uncategorized",
          lbls: "Labels", lbl: "Label", nolbl: "No label", stMain: "Own stock", stSold: "sold" },
    el: { inc: "Έσοδα", exp: "Έξοδα", net: "Υπόλοιπο", ent: "καταχωρήσεις", h: "ώ", bill: "χρεώσιμες",
          open: "ανοιχτές", done: "έγιναν", late: "εκπρόθεσμες", today: "για σήμερα", none: "Τίποτα σε αυτή την περίοδο.",
          run: "Τρέχει τώρα", more: "+{n} ακόμη", uncat: "Χωρίς κατηγορία",
          lbls: "Ετικέτες", lbl: "Ετικέτα", nolbl: "Χωρίς ετικέτα", stMain: "Δικό σου απόθεμα", stSold: "πουλήθηκαν" }
  };
  // A pack language (orosI18n, ../i18n.js) gets its tables here; in Node
  // (tests) there is no window and only en / el exist.
  var I18N = typeof window !== "undefined" && window.orosI18n;
  if (I18N) {
    I18N.table(SEED_NAMES, "assistant", I18N.lang());
    I18N.table(L, "assistant", I18N.lang());
  }
  function amt(n, cur) { return n.toFixed(2) + " " + cur; }
  function preview(s, lang) {
    var w = L[lang] || L.en, out = [];
    if (!isObj(s)) return out;
    function more(n) { if (n) out.push(w.more.replace("{n}", n)); }
    if (s.app === "budget") {
      out.push(s.month);
      out.push(w.inc + ": " + amt(s.income, s.currency) + " · " + w.exp + ": " + amt(s.expenses, s.currency) + " · " + w.net + ": " + amt(s.net, s.currency));
      s.categories.forEach(function (c) {
        out.push((c.kind === "income" ? "+ " : "− ") + c.name + ": " + amt(c.total, s.currency) + " (" + c.entries + ")");
      });
      more(s.more_categories);
      if (!s.entries) out.push(w.none);
    } else if (s.app === "timesheet") {
      out.push(s.month + " · " + s.hours.toFixed(2) + " " + w.h + (s.billable_hours ? " · " + w.bill + " " + s.billable_hours.toFixed(2) + " " + w.h : "") +
               (s.amount ? " · " + amt(s.amount, s.currency) : ""));
      s.projects.forEach(function (p) {
        out.push((p.name || "—") + (p.client ? " (" + p.client + ")" : "") + ": " + p.hours.toFixed(2) + " " + w.h +
                 (p.amount ? " · " + amt(p.amount, s.currency) : ""));
      });
      more(s.more_projects);
      if (s.running) out.push(w.run + ": " + s.running.join(", "));
      if (!s.entries) out.push(w.none);
    } else if (s.app === "todo") {
      out.push(s.open + " " + w.open + " · " + s.overdue + " " + w.late + " · " + s.due_today + " " + w.today + " · " + s.done + " " + w.done);
      s.lists.forEach(function (l) {
        out.push((l.name || "—") + ": " + l.open + " " + w.open + (l.overdue ? ", " + l.overdue + " " + w.late : "") +
                 (l.due_today ? ", " + l.due_today + " " + w.today : ""));
      });
      more(s.more_lists);
    } else if (s.app === "stock" && Array.isArray(s.products)) {
      out.push(s.month + " · " + s.units + " " + w.stSold + " · " + amt(s.amount, s.currency));
      if (s.places.length > 1) out.push(s.places.map(function (p) { return p.name + ": " + p.units; }).join(" · "));
      s.products.forEach(function (p) {
        out.push(p.name + ": " + p.units + " · " + amt(p.amount, s.currency) +
                 (p.places.length > 1 ? " (" + p.places.map(function (x) { return x.name + " " + x.units; }).join(", ") + ")" : ""));
      });
      more(s.more_products);
      if (!s.sales) out.push(w.none);
    } else if (s.app === "calendar" && Array.isArray(s.labels)) {
      out.push(w.lbls + ": " + s.labels.map(function (l) { return l.name + " (" + l.events + ")"; })
        .concat([w.nolbl + " (" + s.no_label + ")"]).join(", "));
      if (s.filter_label || s.month) out.push([s.month || "", s.filter_label ? w.lbl + ": " + (s.filter_label === "none" ? w.nolbl : s.filter_label) : ""].filter(Boolean).join(" · "));
    }
    if (Array.isArray(s.items)) {
      if (s.from) out.push(s.from + " → " + s.to);
      s.items.forEach(function (it) {
        out.push([it.date || "", it.time || "", it.title, it.label ? w.lbl + ": " + it.label : "", it.location || "", it.text || it.note || ""].filter(Boolean).join(" · ") + (it.late ? " (" + w.late + ")" : ""));
      });
      more(s.more_items);
      if (!s.items.length) out.push(w.none);
    }
    return out;
  }

  var API = {
    VERSION: "1.0.0", OWN: OWN, SEED_NAMES: SEED_NAMES,
    normArgs: normArgs, budgetMonth: budgetMonth, timesheetMonth: timesheetMonth, stockMonth: stockMonth,
    todoLists: todoLists, calendarEvents: calendarEvents, agenda: agenda, preview: preview, addDays: addDays, lastDay: lastDay
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root && root.document) root.OrosAssistSummary = API;
})(typeof window !== "undefined" ? window : globalThis);
