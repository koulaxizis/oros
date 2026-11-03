// ============================================================
// orOS Assistant — per-app summaries (v1.2.0)
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
//   todoList(raw, opts)          To-Do, one list by name: its tasks
//   notesBooks / bookmarksFolders / contactsLabels / shelfItems /
//   libraryBooks(raw, opts)      AS-STRUCT: how the app is organised
//                                 (notebooks, folders, labels, kinds,
//                                 tags) and its items with targets
//   kanbanBoards(raw, opts)      Kanban: every board (KB-ALL), its
//                                 columns with how many cards each
//                                 has, late / due today, and the cards
//                                 of every board (or of one board)
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
//   crmPartner(C, data, q, today, build)
//                                 CRM: one partner's card (partner card
//                                 W5): what is open both ways, stock,
//                                 hours, royalties, contracts, contact
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
  var OWN = { budget: "month", timesheet: "month", todo: "lists", stock: "month", kanban: "boards",
              notes: "notebooks", bookmarks: "folders", contacts: "labels", shelf: "kinds", library: "books" };   // AS-STRUCT

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
    if (app === "crm" && typeof args.partner === "string" && args.partner.trim()) {
      out.partner = args.partner.replace(/\s+/g, " ").trim().slice(0, 120);
    }
    if (app === "kanban" && typeof args.board === "string" && args.board.trim()) {
      out.board = args.board.replace(/\s+/g, " ").trim().slice(0, 120);
    }
    // AS-STRUCT: the group of an app to list (a name, as the user said it).
    function word(k, max) {
      return typeof args[k] === "string" && args[k].trim() ? args[k].replace(/\s+/g, " ").trim().slice(0, max || 120) : "";
    }
    var grp = { todo: ["list"], notes: ["notebook"], bookmarks: ["folder", "tag"], contacts: ["label"],
                shelf: ["kind", "status", "tag"], library: ["status", "tag"] }[app] || [];
    grp.forEach(function (k) {
      var v = word(k, k === "folder" ? 240 : 120);
      if (v) out[k] = k === "kind" || k === "status" ? v.toLowerCase() : v;
    });
    if (app === "calendar") {
      out.monthSet = monthSet;
      if (typeof args.label === "string" && args.label.trim()) out.label = args.label.replace(/\s+/g, " ").trim().slice(0, 40);
    }
    return out;
  }

  // ---------- CRM: one partner (partner card W5) ----------
  // C = OrosCrmCore, data = CRM data (C.norm), q = the partner's name as
  // the user said it, build(c) = the partner card's Overview
  // (OrosCrmOverview.build with the other apps' cores) or null. Several
  // matches → only their names, so the model asks which one. Amounts
  // in currency units, per currency.
  function crmPartner(C, data, q, today, build) {
    var out = { app: "crm", partner: q };
    var words = C.fold(q).split(/\s+/).filter(Boolean);
    var hits = data.cust.filter(function (c) {
      var hay = C.fold([c.name, c.alias || "", c.afm || "", c.email || ""].join(" "));
      return words.every(function (w) { return hay.indexOf(w) >= 0; });
    });
    var exact = hits.filter(function (c) { return C.fold(c.name) === C.fold(q) || C.fold(c.alias || "") === C.fold(q); });
    if (exact.length === 1) hits = exact;
    if (!hits.length) { out.found = false; return out; }
    if (hits.length > 1) {
      out.found = false;
      out.matches = hits.slice(0, 20).map(function (c) { return C.custName(c); });
      if (hits.length > 20) out.more_matches = hits.length - 20;
      return out;
    }
    var c = hits[0], x = build ? build(c) : null;
    out.found = true;
    out.name = C.custName(c);
    out.roles = C.rolesOf(data, c);
    out.target = { cust: c.id };
    function units(map, f) {
      var o = {};
      Object.keys(map || {}).forEach(function (cur) { var v = f ? f(map[cur]) : map[cur]; if (v) o[cur] = money(v); });
      return o;
    }
    out.contracts = C.contractsOf ? C.contractsOf(data, c.id, today).slice(0, 10).map(function (k) {
      return { title: k.t, from: k.from || "", to: k.to || "", state: C.ctrState(k, today) };
    }) : [];
    if (!x) return out;
    out.owes_you = units(x.money["in"], function (v) { return v.open; });
    out.owes_you_overdue = units(x.money["in"], function (v) { return v.overdue; });
    out.you_owe = units(x.money.out);
    out.received_invoices = { count: x.bills.n, open: units(x.bills.open, function (v) { return v.open; }) };
    out.consignment = x.shops.map(function (r) {
      return { shop: r.name, pieces: Math.round(r.q / 1000), value: money(r.value), currency: r.cur, settlement_due: r.due || "",
               last_settled: r.last || "", settled_not_invoiced: r.unbilled.n };
    });
    out.orders = x.sups.map(function (r) { return { supplier: r.name, open_orders: r.open, pieces_to_come: Math.round(r.left / 1000), value: money(r.value), currency: r.cur }; });
    out.hours_not_billed = x.work.map(function (r) { return { client: r.name, hours: hours(r.ms), amount: money(r.amount), currency: r.cur }; });
    out.titles = x.pub.titles.slice(0, 20).map(function (r) { return r.t; });
    out.royalties_due = units(x.pub.due);
    out.advance_left = units(x.pub.adv);
    out.last_contact = x.crm.last ? new Date(x.crm.last).toISOString().slice(0, 10) : "";
    out.next_followup = x.crm.next || "";
    out.open_deals = { count: x.crm.deals, value: money(x.crm.val), currency: data.prefs.cur };
    if (x.budget.n) out.budget = { entries: x.budget.n, currency: x.budget.cur, this_year_income: money(x.budget.year.i), this_year_expenses: money(x.budget.year.o) };
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

  // ---------- Kanban (KB-ALL) ----------
  // Same data and the same rules as kanban/search.js and the
  // Assistant's Kanban edits (oros-kanban-data): every board in stored
  // order, not only the one open in Kanban. Templates ("tpl-") and
  // deleted boards stay out; archived boards are named only (Kanban
  // opens and changes them only after they are restored). A card is
  // late when its due date passed and it is not in its board's last
  // column (the "Done" column, as Today and the Calendar feed count).
  // opts: { board?, today }
  var MAX_BOARDS = 60, MAX_COLS = 30;
  function kanbanBoards(raw, opts) {
    opts = opts || {};
    var d = isObj(raw) ? raw : {}, today = opts.today || "";
    var gone = isObj(d.boardDeleted) ? d.boardDeleted : {};
    var out = { app: "kanban", today: today, boards: [] }, live = [], archived = [];
    arr(d.boards).forEach(function (b) {
      if (!isObj(b) || typeof b.id !== "string" || !b.id || b.id.indexOf("tpl-") === 0) return;
      if (typeof gone[b.id] === "number" && gone[b.id] >= (b.mtime || 0)) return;
      if (b.archived) { archived.push(str(b.name, 80) || "—"); return; }
      live.push(b);
    });
    var want = null;
    if (opts.board) {
      var f = foldName(opts.board);
      var hits = live.filter(function (b) { return foldName(b.name) === f; });
      if (!hits.length) {
        return { ok: false, err: "Kanban has no open board named \"" + opts.board + "\". Its boards: " +
          (live.length ? live.map(function (b) { return str(b.name, 80) || "—"; }).join(", ") : "none") + "." +
          (archived.length ? " Archived (restore them in Kanban first): " + archived.join(", ") + "." : "") };
      }
      if (hits.length > 1) return { ok: false, err: "Kanban has more than one board called " + opts.board + "; ask the user which one." };
      want = hits[0];
    }
    var items = [], cards = 0, late = 0, dueToday = 0;
    live.forEach(function (b) {
      var lbl = {};
      arr(b.labels).forEach(function (l) { if (isObj(l) && typeof l.id === "string" && str(l.name, 40)) lbl[l.id] = str(l.name, 40); });
      var cols = arr(b.columns).filter(function (c) { return isObj(c) && typeof c.id === "string"; });
      var row = { name: str(b.name, 80) || "—", cards: 0, late: 0, due_today: 0, columns: [] };
      cols.forEach(function (c, ci) {
        var last = ci === cols.length - 1 && cols.length > 1;
        var cr = { name: str(c.name, 60) || "—", cards: 0 };
        arr(c.cards).forEach(function (k) {
          if (!isObj(k) || typeof k.id !== "string") return;
          cr.cards++;
          var due = typeof k.due === "string" && YMD.test(k.due) ? k.due : "";
          var isLate = !!(due && today && due < today && !last);
          if (isLate) row.late++;
          if (due && due === today && !last) row.due_today++;
          if (want && b !== want) return;
          var it = { title: str(k.text, 160) || "—", where: row.name + " › " + cr.name };
          if (due) it.date = due;
          if (isLate) it.late = true;
          var ln = arr(k.labels).map(function (id) { return lbl[id] || ""; }).filter(Boolean);
          if (ln.length) it.labels = ln.slice(0, 10);
          var st = arr(k.subtasks).filter(isObj);
          if (st.length) it.subtasks = st.filter(function (x) { return x.done; }).length + "/" + st.length;
          it.target = { board: b.id, col: c.id, card: k.id };   // → a ref (assistant.js)
          items.push(it);
        });
        row.cards += cr.cards;
        row.columns.push(cr);
      });
      if (row.columns.length > MAX_COLS) { row.more_columns = row.columns.length - MAX_COLS; row.columns = row.columns.slice(0, MAX_COLS); }
      cards += row.cards; late += row.late; dueToday += row.due_today;
      out.boards.push(row);
    });
    out.cards = cards; out.late = late; out.due_today = dueToday;
    if (out.boards.length > MAX_BOARDS) {
      out.more_boards = out.boards.length - MAX_BOARDS;
      out.boards = out.boards.slice(0, MAX_BOARDS);
    }
    if (archived.length) out.archived_boards = archived.slice(0, MAX_BOARDS);
    if (want) out.board = str(want.name, 80) || "—";
    out.items = items.slice(0, MAX_EVENTS);
    out.listed = items.length;
    if (items.length > MAX_EVENTS) out.more_items = items.length - MAX_EVENTS;
    return out;
  }

  // ---------- Structure of six more apps (AS-STRUCT) ----------
  // Chris (2026-11-03): the Assistant guessed names because it never
  // saw how an app is organised. Each summary below lists the app's
  // own groups (lists, notebooks, folders, labels, kinds, tags) with
  // their counts, then the items (all, or of one group by name) with
  // the same target as the app's search provider, so a row becomes a
  // ref for change_item. Same rules as each app's search.js: what it
  // skips (deleted, tombstoned) stays out here too. Titles and groups
  // only: no note text, phone, e-mail or highlight leaves this way
  // (read_item / search_data do that, item by item).
  // An unknown or ambiguous group name is an error that names them all.
  function pickGroup(names, q, what, app) {
    var f = foldName(q), hits = [];
    names.forEach(function (n, i) { if (foldName(n) === f) hits.push(i); });
    if (hits.length === 1) return { i: hits[0] };
    if (hits.length > 1) return { err: app + " has more than one " + what + " called " + q + "; ask the user which one." };
    return { err: app + " has no " + what + " named \"" + q + "\". Its " + what + "s: " +
      (names.length ? names.slice(0, 80).join(", ") : "none") + "." };
  }
  function capItems(out, items) {
    out.items = items.slice(0, MAX_EVENTS);
    out.listed = items.length;
    if (items.length > MAX_EVENTS) out.more_items = items.length - MAX_EVENTS;
    return out;
  }
  function capList(out, key, max) {
    if (out[key].length > max) { out["more_" + key] = out[key].length - max; out[key] = out[key].slice(0, max); }
  }
  function ymdOf(ms) {
    if (typeof ms !== "number" || !(ms > 0)) return "";
    var d = new Date(ms);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function firstLine(s) {
    return String(s || "").split("\n").map(function (l) { return l.trim(); }).filter(Boolean)[0] || "";
  }
  function liveLabels(list, dead, deadKey) {
    var out = {};
    arr(list).forEach(function (l) {
      if (!isObj(l) || typeof l.id !== "string" || !str(l.name, 40)) return;
      var ts = dead ? dead[(deadKey || "") + l.id] : undefined;
      if (typeof ts === "number" && ts >= (l.mtime || 0)) return;
      out[l.id] = str(l.name, 40);
    });
    return out;
  }
  function labelRows(names, count) {
    return Object.keys(names).map(function (id) { return { name: names[id], n: count[id] || 0 }; });
  }

  // To-Do, one list (opts.list): its tasks, open first, with a target
  // { list, item } like todo/search.js. Without a list: todoLists.
  function todoList(d, opts) {
    var today = opts.today || "";
    var lists = isObj(d) ? arr(d.lists).filter(function (l) { return isObj(l) && typeof l.id === "string" && Array.isArray(l.items); }) : [];
    var g = pickGroup(lists.map(function (l) { return str(l.name, 80) || "—"; }), opts.list, "list", "To-Do");
    if (g.err) return { ok: false, err: g.err };
    var l = lists[g.i], dead = isObj(d.deleted) ? d.deleted : {};
    var lbl = liveLabels(d.labels, dead);
    var out = { app: "todo", today: today, list: str(l.name, 80) || "—", open: 0, done: 0, overdue: 0, due_today: 0 };
    var items = [];
    l.items.forEach(function (it) {
      if (!isObj(it) || typeof it.id !== "string") return;
      var row = { title: str(it.text, 160) || "—" };
      var due = typeof it.due === "string" && YMD.test(it.due) ? it.due : "";
      if (due) row.date = due;
      if (it.done) { row.done = true; out.done++; }
      else {
        out.open++;
        if (due && due < today) { row.late = true; out.overdue++; }
        else if (due && due === today) out.due_today++;
      }
      if (it.prio === 1 || it.prio === 2 || it.prio === 3) row.priority = it.prio;
      var ln = arr(it.labels).map(function (id) { return lbl[id] || ""; }).filter(Boolean);
      if (ln.length) row.labels = ln.slice(0, 10);
      var subs = arr(it.subs).filter(isObj);
      if (subs.length) row.subtasks = subs.filter(function (x) { return x.done; }).length + "/" + subs.length;
      row.target = { list: l.id, item: it.id };
      items.push(row);
    });
    items.sort(function (a, b) { return (a.done ? 1 : 0) - (b.done ? 1 : 0); });
    return capItems(out, items);
  }

  // Notes: notebooks (with how many pages), labels, and the pages with
  // notebook › parent page and the day last changed. opts.notebook:
  // only that notebook's pages. Target { page, nb } (notes/search.js).
  function notesBooks(d, opts) {
    d = isObj(d) ? d : {};
    var tombs = isObj(d.tombs) ? d.tombs : {};
    var nbs = arr(d.notebooks).filter(function (n) {
      return isObj(n) && typeof n.id === "string" && !(typeof tombs["nb:" + n.id] === "number" && tombs["nb:" + n.id] >= (n.mtime || 0));
    }).sort(function (a, b) { return (Number(a.pos) || 0) - (Number(b.pos) || 0); });
    var pages = arr(d.pages).filter(function (p) { return isObj(p) && typeof p.id === "string"; });
    var byId = {};
    pages.forEach(function (p) { byId[p.id] = p; });
    var lbl = liveLabels(d.labels, tombs, "lbl:"), lcount = {};
    var out = { app: "notes", pages: pages.length, notebooks: [] }, nbIdx = {};
    nbs.forEach(function (n, i) { nbIdx[n.id] = i; out.notebooks.push({ name: str(n.name, 80) || "—", pages: 0 }); });
    var want = null;
    if (opts.notebook) {
      var g = pickGroup(out.notebooks.map(function (n) { return n.name; }), opts.notebook, "notebook", "Notes");
      if (g.err) return { ok: false, err: g.err };
      want = nbs[g.i].id;
      out.notebook = out.notebooks[g.i].name;
    }
    function titleOf(p) { return str(p.title, 160) || str(firstLine(p.text), 60) || "—"; }
    function path(p) {
      var up = [], seen = {}, cur = p.parent;
      while (typeof cur === "string" && byId[cur] && !seen[cur] && up.length < 4) { seen[cur] = 1; up.unshift(titleOf(byId[cur])); cur = byId[cur].parent; }
      return up;
    }
    var items = [];
    pages.forEach(function (p) {
      var ni = nbIdx[p.nb];
      if (ni !== undefined) out.notebooks[ni].pages++;
      arr(p.labels).forEach(function (id) { if (lbl[id]) lcount[id] = (lcount[id] || 0) + 1; });
      if (want && p.nb !== want) return;
      var row = { title: titleOf(p) };
      row.where = [ni !== undefined ? out.notebooks[ni].name : ""].concat(path(p)).filter(Boolean).join(" › ");
      if (!row.where) delete row.where;
      var day = ymdOf(p.mtime);
      if (day) row.changed = day;
      if (p.pinned) row.pinned = true;
      var ln = arr(p.labels).map(function (id) { return lbl[id] || ""; }).filter(Boolean);
      if (ln.length) row.labels = ln.slice(0, 10);
      row.target = { page: p.id, nb: typeof p.nb === "string" ? p.nb : null };
      items.push(row);
    });
    out.labels = labelRows(lbl, lcount);
    capList(out, "notebooks", MAX_LISTS);
    capList(out, "labels", MAX_LISTS);
    return capItems(out, items);
  }

  // Bookmarks: the folder tree ("Parent › Child", bookmarks in each),
  // the tags with counts, and the bookmarks with folder, address and
  // tags. opts.folder (a name or a whole "A › B" path): that folder and
  // its subfolders. opts.tag: only bookmarks with that tag. Target
  // { id } (bookmarks/search.js).
  function bookmarksFolders(d, opts) {
    d = isObj(d) ? d : {};
    var items = isObj(d.items) ? d.items : {}, folders = isObj(d.folders) ? d.folders : {};
    var del = isObj(d.deleted) ? d.deleted : {};
    var ROOT_F = "unsorted";
    function fpath(id) {
      var out = [], seen = {}, cur = id;
      while (cur && Object.prototype.hasOwnProperty.call(folders, cur) && isObj(folders[cur]) && !seen[cur] && out.length < 12) {
        seen[cur] = 1;
        out.unshift(str(folders[cur].name, 60) || "—");
        var p = folders[cur].parent;
        cur = typeof p === "string" && p !== cur && p !== ROOT_F ? p : "";
      }
      return out;
    }
    var fids = Object.keys(folders).filter(function (id) { return isObj(folders[id]) && !del[id]; });
    var rows = fids.map(function (id) { return { id: id, path: fpath(id).join(" › "), n: 0 }; });
    rows.sort(function (a, b) { return a.path < b.path ? -1 : a.path > b.path ? 1 : 0; });
    var rowOf = {};
    rows.forEach(function (r) { rowOf[r.id] = r; });
    var want = null;
    if (opts.folder) {
      var f = foldName(opts.folder), hits = rows.filter(function (r) {
        return foldName(r.path) === f || foldName(fpath(r.id).slice(-1)[0] || "") === f;
      });
      if (!hits.length) return { ok: false, err: "Bookmarks has no folder named \"" + opts.folder + "\". Its folders: " + (rows.length ? rows.slice(0, 80).map(function (r) { return r.path; }).join(", ") : "none") + "." };
      if (hits.length > 1) return { ok: false, err: "Bookmarks has more than one folder called " + opts.folder + ": " + hits.map(function (r) { return r.path; }).join(", ") + ". Give the whole path." };
      want = hits[0];
    }
    var tagN = {}, list = [], total = 0, unsorted = 0;
    Object.keys(items).forEach(function (id) {
      var it = items[id];
      if (!isObj(it) || del[id]) return;
      total++;
      var tags = arr(it.tags).map(function (x) { return str(x, 40); }).filter(Boolean);
      tags.forEach(function (x) { tagN[x] = (tagN[x] || 0) + 1; });
      var fr = rowOf[it.folderId];
      if (fr && it.folderId !== ROOT_F) fr.n++; else { unsorted++; if (fr) fr.n++; }
      if (want && !(fr && (fr === want || fr.path.indexOf(want.path + " › ") === 0))) return;
      if (opts.tag && tags.map(foldName).indexOf(foldName(opts.tag)) < 0) return;
      var url = str(it.url, 200);
      var row = { title: str(it.title, 160) || url || "—" };
      if (url) row.url = url;
      if (fr && it.folderId !== ROOT_F) row.where = fr.path;
      if (tags.length) row.labels = tags.slice(0, 10);
      if (it.fav === true) row.favorite = true;
      row.target = { id: id };
      list.push(row);
    });
    var out = { app: "bookmarks", bookmarks: total, unsorted: unsorted,
      folders: rows.filter(function (r) { return r.id !== ROOT_F; }).map(function (r) { return { name: r.path, bookmarks: r.n }; }),
      tags: Object.keys(tagN).sort(function (a, b) { return tagN[b] - tagN[a] || (a < b ? -1 : 1); }).map(function (k) { return { name: k, n: tagN[k] }; }) };
    if (want) out.folder = want.path;
    if (opts.tag) out.tag = opts.tag;
    capList(out, "folders", MAX_BOARDS);
    capList(out, "tags", MAX_LISTS);
    return capItems(out, list);
  }

  // Contacts: the labels (groups) with how many contacts each has,
  // favourites, and the contacts by name with company and labels (no
  // phone, e-mail or address). opts.label ("none" = without a label).
  // Target: the contact's id (contacts/search.js).
  function contactsLabels(d, opts) {
    d = isObj(d) ? d : {};
    var lbl = liveLabels(d.labels), lcount = {};
    var people = arr(d.contacts).filter(function (c) { return isObj(c) && typeof c.id === "string"; });
    var want = null, none = false;
    if (opts.label) {
      if (foldName(opts.label) === "none") none = true;
      else {
        var ids = Object.keys(lbl);
        var g = pickGroup(ids.map(function (id) { return lbl[id]; }), opts.label, "label", "Contacts");
        if (g.err) return { ok: false, err: g.err };
        want = ids[g.i];
      }
    }
    var out = { app: "contacts", contacts: people.length, favorites: 0, no_label: 0 }, items = [];
    people.forEach(function (c) {
      var lids = arr(c.labelIds).filter(function (id) { return lbl[id]; });
      lids.forEach(function (id) { lcount[id] = (lcount[id] || 0) + 1; });
      if (!lids.length) out.no_label++;
      if (c.starred) out.favorites++;
      if (none && lids.length) return;
      if (want && lids.indexOf(want) < 0) return;
      var name = [str(c.given, 60), str(c.middle, 60), str(c.family, 60)].filter(Boolean).join(" ") || str(c.nickname, 60) || str(c.org, 80) || "—";
      var row = { title: name };
      var org = str(c.org, 80);
      if (org && org !== name) row.org = org;
      if (lids.length) row.labels = lids.map(function (id) { return lbl[id]; }).slice(0, 10);
      if (c.starred) row.favorite = true;
      row.target = c.id;
      items.push(row);
    });
    out.labels = labelRows(lbl, lcount);
    if (want) out.label = lbl[want];
    if (none) out.label = "none";
    capList(out, "labels", MAX_LISTS);
    return capItems(out, items);
  }

  // Media Shelf: per kind (book, film, series, album = music, podcast,
  // game) how many are wanted, in progress, done and dropped; the tags;
  // the items with kind, status, creator, year, rating. opts.kind,
  // opts.status, opts.tag narrow the items. Target { item }.
  var SHELF_KINDS = ["book", "film", "series", "album", "podcast", "game"];
  var SHELF_ST = ["want", "now", "done", "drop"];
  function shelfItems(d, opts) {
    d = isObj(d) ? d : {};
    var tombs = isObj(d.tombs) ? d.tombs : {};
    var kind = opts.kind === "music" ? "album" : opts.kind;
    if (kind && SHELF_KINDS.indexOf(kind) < 0) return { ok: false, err: "kind must be one of " + SHELF_KINDS.join(", ") + " (music = album)." };
    if (opts.status && SHELF_ST.indexOf(opts.status) < 0) return { ok: false, err: "status for Media Shelf must be one of " + SHELF_ST.join(", ") + " (now = in progress)." };
    var kinds = {}, tagN = {}, items = [], total = 0;
    arr(d.items).forEach(function (it) {
      if (!isObj(it) || typeof it.id !== "string") return;
      if (typeof tombs[it.id] === "number" && tombs[it.id] >= (Number(it.m) || 0)) return;
      total++;
      var k = SHELF_KINDS.indexOf(it.type) >= 0 ? it.type : "book";
      var st = SHELF_ST.indexOf(it.st) >= 0 ? it.st : "want";
      var kr = kinds[k] || (kinds[k] = { kind: k, total: 0, want: 0, now: 0, done: 0, drop: 0 });
      kr.total++; kr[st]++;
      var tags = arr(it.tags).map(function (x) { return str(x, 40); }).filter(Boolean);
      tags.forEach(function (x) { tagN[x] = (tagN[x] || 0) + 1; });
      if (kind && k !== kind) return;
      if (opts.status && st !== opts.status) return;
      if (opts.tag && tags.map(foldName).indexOf(foldName(opts.tag)) < 0) return;
      var row = { title: str(it.title, 160) || "—", kind: k, status: st };
      var by = str(it.by, 80); if (by) row.by = by;
      if (typeof it.year === "number" && it.year > 0) row.year = it.year;
      if (typeof it.rate === "number" && it.rate > 0) row.rating = it.rate / 2;
      if (it.fav === 1) row.favorite = true;
      if (tags.length) row.labels = tags.slice(0, 10);
      row.target = { item: it.id };
      items.push(row);
    });
    var out = { app: "shelf", items_total: total,
      kinds: SHELF_KINDS.filter(function (k) { return kinds[k]; }).map(function (k) { return kinds[k]; }),
      tags: Object.keys(tagN).sort(function (a, b) { return tagN[b] - tagN[a] || (a < b ? -1 : 1); }).map(function (k) { return { name: k, n: tagN[k] }; }) };
    if (kind) out.kind = kind;
    if (opts.status) out.status = opts.status;
    if (opts.tag) out.tag = opts.tag;
    capList(out, "tags", MAX_LISTS);
    return capItems(out, items);
  }

  // Library: how many books are reading (opened, not finished),
  // finished and unread; the tags; the books with author, format,
  // progress or the day finished. opts.status (reading, finished,
  // unread), opts.tag. Highlights stay out (search_data finds them).
  // Target { book } (library/search.js).
  var LIB_ST = ["reading", "finished", "unread"];
  function libraryBooks(d, opts) {
    d = isObj(d) ? d : {};
    if (opts.status && LIB_ST.indexOf(opts.status) < 0) return { ok: false, err: "status for Library must be one of " + LIB_ST.join(", ") + "." };
    var tombs = isObj(d.tombs) ? d.tombs : {}, pos = isObj(d.pos) ? d.pos : {};
    var out = { app: "library", books: 0, reading: 0, finished: 0, unread: 0 }, tagN = {}, items = [];
    arr(d.books).forEach(function (b) {
      if (!isObj(b) || typeof b.id !== "string") return;
      if (typeof tombs[b.id] === "number" && tombs[b.id] >= (Number(b.m) || 0)) return;
      out.books++;
      var p = isObj(pos[b.id]) ? pos[b.id] : null;
      var fin = typeof b.fin === "string" && YMD.test(b.fin) ? b.fin : "";
      var st = fin ? "finished" : p ? "reading" : "unread";
      out[st]++;
      var tags = arr(b.tags).map(function (x) { return str(x, 40); }).filter(Boolean);
      tags.forEach(function (x) { tagN[x] = (tagN[x] || 0) + 1; });
      if (opts.status && st !== opts.status) return;
      if (opts.tag && tags.map(foldName).indexOf(foldName(opts.tag)) < 0) return;
      var row = { title: str(b.title, 160) || "—", status: st };
      var by = str(b.by, 80); if (by) row.by = by;
      row.format = String(b.kind || b.fmt || "epub").toUpperCase();
      if (typeof b.year === "number") row.year = b.year;
      if (st === "reading" && typeof p.pct === "number") row.progress = Math.round(p.pct / 10) + "%";
      if (fin) row.finished = fin;
      if (tags.length) row.labels = tags.slice(0, 10);
      row.target = { book: b.id };
      items.push(row);
    });
    out.tags = Object.keys(tagN).sort(function (a, b) { return tagN[b] - tagN[a] || (a < b ? -1 : 1); }).map(function (k) { return { name: k, n: tagN[k] }; });
    if (opts.status) out.status = opts.status;
    if (opts.tag) out.tag = opts.tag;
    capList(out, "tags", MAX_LISTS);
    return capItems(out, items);
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
          lbls: "Labels", lbl: "Label", nolbl: "No label", stMain: "Own stock", stSold: "sold",
          pick: "Which one", over: "overdue", nopart: "No partner called “{q}”", owes: "Owes you", owe: "You owe", settle: "settlement due",
          orders: "open orders", roy: "Royalties to pay", ctr: "Contract", next: "Next follow-up",
          kbCard: "card", kbCards: "cards", kbArch: "Archived",
          stLists: "Lists", stNbs: "Notebooks", stPages: "pages", stFolders: "Folders", stUnsorted: "Unsorted", stTags: "Tags",
          stBm: "bookmarks", stCt: "contacts", stFav: "favourites", stItems: "items", stBooks: "books",
          stReading: "reading", stFinished: "finished", stUnread: "unread", stWant: "want", stNow: "in progress", stDrop: "dropped",
          kBook: "Books", kFilm: "Films", kSeries: "Series", kAlbum: "Music", kPodcast: "Podcasts", kGame: "Games" },
    el: { inc: "Έσοδα", exp: "Έξοδα", net: "Υπόλοιπο", ent: "καταχωρήσεις", h: "ώ", bill: "χρεώσιμες",
          open: "ανοιχτές", done: "έγιναν", late: "εκπρόθεσμες", today: "για σήμερα", none: "Τίποτα σε αυτή την περίοδο.",
          run: "Τρέχει τώρα", more: "+{n} ακόμη", uncat: "Χωρίς κατηγορία",
          lbls: "Ετικέτες", lbl: "Ετικέτα", nolbl: "Χωρίς ετικέτα", stMain: "Δικό σου απόθεμα", stSold: "πουλήθηκαν",
          pick: "Ποιος από αυτούς", over: "ληξιπρόθεσμα", nopart: "Κανένας συνεργάτης με όνομα «{q}»", owes: "Σου χρωστά", owe: "Του χρωστάς", settle: "οφείλεται εκκαθάριση",
          orders: "ανοιχτές παραγγελίες", roy: "Δικαιώματα προς πληρωμή", ctr: "Σύμβαση", next: "Επόμενο follow-up",
          kbCard: "κάρτα", kbCards: "κάρτες", kbArch: "Στο αρχείο",
          stLists: "Λίστες", stNbs: "Τετράδια", stPages: "σελίδες", stFolders: "Φάκελοι", stUnsorted: "Χωρίς φάκελο", stTags: "Ετικέτες",
          stBm: "σελιδοδείκτες", stCt: "επαφές", stFav: "αγαπημένες", stItems: "στοιχεία", stBooks: "βιβλία",
          stReading: "διαβάζεις", stFinished: "τελείωσαν", stUnread: "αδιάβαστα", stWant: "θέλω", stNow: "σε εξέλιξη", stDrop: "παρατημένα",
          kBook: "Βιβλία", kFilm: "Ταινίες", kSeries: "Σειρές", kAlbum: "Μουσική", kPodcast: "Podcasts", kGame: "Παιχνίδια" }
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
    } else if (s.app === "todo" && Array.isArray(s.lists)) {
      out.push(s.open + " " + w.open + " · " + s.overdue + " " + w.late + " · " + s.due_today + " " + w.today + " · " + s.done + " " + w.done);
      s.lists.forEach(function (l) {
        out.push((l.name || "—") + ": " + l.open + " " + w.open + (l.overdue ? ", " + l.overdue + " " + w.late : "") +
                 (l.due_today ? ", " + l.due_today + " " + w.today : ""));
      });
      more(s.more_lists);
    } else if (s.app === "crm" && s.partner) {
      if (!s.found) out.push(s.matches ? w.pick + ": " + s.matches.join(", ") : w.nopart.replace("{q}", s.partner));
      else {
        var cm = function (o) { return Object.keys(o || {}).map(function (k) { return amt(o[k], k); }).join(", "); };
        out.push(s.name);
        if (cm(s.owes_you)) out.push(w.owes + ": " + cm(s.owes_you) + (cm(s.owes_you_overdue) ? " (" + w.over + " " + cm(s.owes_you_overdue) + ")" : ""));
        if (cm(s.you_owe)) out.push(w.owe + ": " + cm(s.you_owe));
        (s.consignment || []).forEach(function (r) { out.push(r.shop + ": " + r.pieces + " · " + amt(r.value, r.currency) + (r.settlement_due ? " · " + w.settle + " " + r.settlement_due : "")); });
        (s.orders || []).forEach(function (r) { if (r.open_orders) out.push(r.supplier + ": " + r.open_orders + " " + w.orders); });
        (s.hours_not_billed || []).forEach(function (r) { if (r.hours) out.push(r.client + ": " + r.hours.toFixed(2) + " " + w.h); });
        if (cm(s.royalties_due)) out.push(w.roy + ": " + cm(s.royalties_due));
        (s.contracts || []).forEach(function (k) { out.push(w.ctr + ": " + k.title + (k.to ? " → " + k.to : "")); });
        if (s.next_followup) out.push(w.next + ": " + s.next_followup);
      }
    } else if (s.app === "stock" && Array.isArray(s.products)) {
      out.push(s.month + " · " + s.units + " " + w.stSold + " · " + amt(s.amount, s.currency));
      if (s.places.length > 1) out.push(s.places.map(function (p) { return p.name + ": " + p.units; }).join(" · "));
      s.products.forEach(function (p) {
        out.push(p.name + ": " + p.units + " · " + amt(p.amount, s.currency) +
                 (p.places.length > 1 ? " (" + p.places.map(function (x) { return x.name + " " + x.units; }).join(", ") + ")" : ""));
      });
      more(s.more_products);
      if (!s.sales) out.push(w.none);
    } else if (s.app === "kanban" && Array.isArray(s.boards)) {
      s.boards.forEach(function (b) {
        out.push(b.name + ": " + b.cards + " " + (b.cards === 1 ? w.kbCard : w.kbCards) + (b.late ? ", " + b.late + " " + w.late : "") +
                 (b.due_today ? ", " + b.due_today + " " + w.today : "") + " (" +
                 b.columns.map(function (c) { return c.name + " " + c.cards; }).join(" · ") + ")");
      });
      if (s.more_boards) more(s.more_boards);
      if (s.archived_boards) out.push(w.kbArch + ": " + s.archived_boards.join(", "));
    } else if (s.app === "todo" && s.list) {
      out.push(s.list + ": " + s.open + " " + w.open + (s.overdue ? ", " + s.overdue + " " + w.late : "") + (s.due_today ? ", " + s.due_today + " " + w.today : "") + " · " + s.done + " " + w.done);
    } else if (s.app === "notes" && Array.isArray(s.notebooks)) {
      out.push(s.pages + " " + w.stPages);
      out.push(w.stNbs + ": " + s.notebooks.map(function (n) { return n.name + " (" + n.pages + ")"; }).join(", "));
      more(s.more_notebooks);
      if (s.labels.length) out.push(w.lbls + ": " + s.labels.map(function (l) { return l.name + " (" + l.n + ")"; }).join(", "));
    } else if (s.app === "bookmarks" && Array.isArray(s.folders)) {
      out.push(s.bookmarks + " " + w.stBm + " · " + w.stUnsorted + " " + s.unsorted);
      if (s.folders.length) out.push(w.stFolders + ": " + s.folders.map(function (f) { return f.name + " (" + f.bookmarks + ")"; }).join(", "));
      more(s.more_folders);
      if (s.tags.length) out.push(w.stTags + ": " + s.tags.map(function (x) { return x.name + " (" + x.n + ")"; }).join(", "));
    } else if (s.app === "contacts" && Array.isArray(s.labels)) {
      out.push(s.contacts + " " + w.stCt + " · " + s.favorites + " " + w.stFav);
      out.push(w.lbls + ": " + s.labels.map(function (l) { return l.name + " (" + l.n + ")"; }).concat([w.nolbl + " (" + s.no_label + ")"]).join(", "));
    } else if (s.app === "shelf" && Array.isArray(s.kinds)) {
      out.push(s.items_total + " " + w.stItems);
      var KW = { book: w.kBook, film: w.kFilm, series: w.kSeries, album: w.kAlbum, podcast: w.kPodcast, game: w.kGame };
      s.kinds.forEach(function (k) {
        out.push((KW[k.kind] || k.kind) + ": " + k.total + " (" + [[k.want, w.stWant], [k.now, w.stNow], [k.done, w.stFinished], [k.drop, w.stDrop]]
          .filter(function (x) { return x[0]; }).map(function (x) { return x[0] + " " + x[1]; }).join(", ") + ")");
      });
      if (s.tags.length) out.push(w.stTags + ": " + s.tags.map(function (x) { return x.name + " (" + x.n + ")"; }).join(", "));
    } else if (s.app === "library" && typeof s.books === "number") {
      out.push(s.books + " " + w.stBooks + " · " + s.reading + " " + w.stReading + " · " + s.finished + " " + w.stFinished + " · " + s.unread + " " + w.stUnread);
      if (s.tags.length) out.push(w.stTags + ": " + s.tags.map(function (x) { return x.name + " (" + x.n + ")"; }).join(", "));
    } else if (s.app === "calendar" && Array.isArray(s.labels)) {
      out.push(w.lbls + ": " + s.labels.map(function (l) { return l.name + " (" + l.events + ")"; })
        .concat([w.nolbl + " (" + s.no_label + ")"]).join(", "));
      if (s.filter_label || s.month) out.push([s.month || "", s.filter_label ? w.lbl + ": " + (s.filter_label === "none" ? w.nolbl : s.filter_label) : ""].filter(Boolean).join(" · "));
    }
    if (Array.isArray(s.items)) {
      if (s.from && !s.coming) out.push(s.from + " → " + s.to);
      s.items.forEach(function (it) {
        out.push([it.date || "", it.time || "", it.title, it.label ? w.lbl + ": " + it.label : "", it.where || "", it.by || "", it.org || "",
                  Array.isArray(it.labels) ? it.labels.join(", ") : "", it.location || "", it.text || it.note || ""].filter(Boolean).join(" · ") +
                 (it.late ? " (" + w.late + ")" : "") + (it.done ? " (" + w.done + ")" : ""));
      });
      more(s.more_items);
      if (!s.items.length) out.push(w.none);
    }
    if (Array.isArray(s.coming) && s.coming.length) {   // AS-STRUCT: what Today lists for the app
      if (s.from) out.push(s.from + " → " + s.to);
      s.coming.forEach(function (it) { out.push([it.date || "", it.time || "", it.title].filter(Boolean).join(" · ") + (it.late ? " (" + w.late + ")" : "")); });
    }
    return out;
  }

  var API = {
    VERSION: "1.2.0", OWN: OWN, SEED_NAMES: SEED_NAMES,
    normArgs: normArgs, budgetMonth: budgetMonth, timesheetMonth: timesheetMonth, stockMonth: stockMonth,
    todoLists: todoLists, todoList: todoList, kanbanBoards: kanbanBoards, notesBooks: notesBooks,
    bookmarksFolders: bookmarksFolders, contactsLabels: contactsLabels, shelfItems: shelfItems, libraryBooks: libraryBooks, calendarEvents: calendarEvents, crmPartner: crmPartner, agenda: agenda, preview: preview, addDays: addDays, lastDay: lastDay
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root && root.document) root.OrosAssistSummary = API;
})(typeof window !== "undefined" ? window : globalThis);
