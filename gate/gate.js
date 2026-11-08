// ============================================================
// orOS Gate — Claude reads this orOS through this open device
// (optional, off by default; Settings › Connected services).
// The device holds a WebSocket to its gate box on the relay
// (relay/gate.js). A tool call from Claude arrives there, is checked
// HERE against the gate, the lock and each app's level, runs on this
// device's own data and goes back as text. The relay stores nothing
// of it. Read-only: nothing here writes app data.
//
// Per device, never synced:
//   localStorage "oros-gate"      { on, id, tok, r (relay it lives on), lv{appId: "read" | "write"}, hold (Claude's changes paused until, ms; 5.78.00), at, out?, lvd?, sf? }
//   localStorage "oros-gate-log"  [{ t, n, a[app ids], k (items), ok, u? (undo id) }] ≤ 300
//   localStorage "oros-gate-undo" [{ id, t, app, n, x (budgetWrite or kanbanWrite undo) }] ≤ 20
// Changes only to apps set to "write" (one rule since 5.78.00: no write
// window; the owner can pause them, every change is notified and can be
// undone from any device); more than 5 deletions in one call are asked
// on the device.
// Pure core (Node-tested, tests/gate-core.test.js): window.orosGateCore.
// ============================================================
(function (root) {
  "use strict";

  var SEAT_KEY = "oros-gate-seat";   // synced slice "gate": { id, ss, r, m } (5.77.00)
  var PREF_KEY = "oros-gate", LOG_KEY = "oros-gate-log", LOG_MAX = 300, UNDO_KEY = "oros-gate-undo", UNDO_MAX = 20;
  // Claude's changes, synced (slice "gatechanges", 5.78.00): seen and undone from any device.
  var CHG_KEY = "oros-gate-changes", CHG_MAX = 100;
  // The daily email of Claude's changes (5.79.00), synced: { on, acct (a
  // Mail account id, "" = the first that can send), m (settings changed),
  // d (the day sent or being sent, YYYY-MM-DD), dv (the device sending
  // it), fd/fn (failures that day), at (sent at) }.
  var DIG_KEY = "oros-gate-digest", DIG_HOUR = 20, DIG_TRIES = 3;
  var RELAY = "https://oros-mail-relay.koulaxizis.workers.dev";   // = mail.js; the gate box lives there
  // Never offered, whatever a setting says (BR-GATE).
  var NEVER = ["assistant", "baby", "cycle", "diary", "fitness", "health", "mail", "mood", "passwords"];   // fitness: Chris 2026-11-08
  var SUMMARY = { budget: 1, stock: 1, kanban: 1 };
  // App-specific line tools (wave 2: Invoices, Stock, Publishing).
  var LINES = { budget: "budget_lines", invoices: "invoice_list", stock: "stock_items", publish: "publish_titles" };
  var PAGE = 500, TEXT_MAX = 1500, HITS_MAX = 60, SPAN_DAYS = 400;
  var YMD = /^\d{4}-\d{2}-\d{2}$/;

  /* ---------- pure core ---------- */
  function isObj(o) { return !!o && typeof o === "object" && !Array.isArray(o); }
  function cents(a) {
    var n = Math.round(Number(a) || 0), s = n < 0 ? "-" : "";
    n = Math.abs(n);
    return s + Math.floor(n / 100) + "." + ("0" + (n % 100)).slice(-2);
  }
  // i18n-inline-ok: final sigma folded for name matching, data not text
  function fold(s) {
    return String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/ς/g, "σ").trim();
  }
  function dayDiff(a, b) { return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000); }
  function deadIn(tombs, prefix, x) {
    var ts = tombs[prefix + ":" + x.id];
    return typeof ts === "number" && ts >= (Number(x.m) || 0);
  }
  // Fields an entry may carry that are not Budget's own (forward
  // compatibility, Part IV): passed on as they are, flat values only.
  var OWN_TX = { id: 1, m: 1, d: 1, a: 1, k: 1, c: 1, n: 1, ac: 1, ot: 1, fit: 1, src: 1, pp: 1, oc: 1, oa: 1, rc: 1 };

  // budget_lines: raw = the parsed oros-budget-data, args from Claude.
  // → { ok:true, data } | { ok:false, err }
  function budgetLines(raw, args) {
    if (!isObj(args)) return { ok: false, err: "The arguments must be an object." };
    var from = String(args.from || ""), to = String(args.to || "");
    if (!YMD.test(from) || !YMD.test(to) || isNaN(Date.parse(from)) || isNaN(Date.parse(to))) return { ok: false, err: "from and to must be days as YYYY-MM-DD." };
    if (to < from) return { ok: false, err: "to is before from." };
    if (dayDiff(from, to) > SPAN_DAYS) return { ok: false, err: "At most " + SPAN_DAYS + " days per call." };
    var offset = args.offset === undefined ? 0 : args.offset;
    if (!(typeof offset === "number" && Math.floor(offset) === offset && offset >= 0)) return { ok: false, err: "offset must be a whole number ≥ 0." };
    var d = isObj(raw) ? raw : {};
    var tombs = isObj(d.tombs) ? d.tombs : {};
    var cur = isObj(d.set) && typeof d.set.cur === "string" && /^[A-Z]{3}$/.test(d.set.cur) ? d.set.cur : "EUR";
    var accs = {}, cats = {};
    (Array.isArray(d.acc) ? d.acc : []).forEach(function (a) { if (isObj(a) && typeof a.id === "string" && !deadIn(tombs, "acc", a)) accs[a.id] = String(a.n || a.id); });
    (Array.isArray(d.cats) ? d.cats : []).forEach(function (c) { if (isObj(c) && typeof c.id === "string" && !deadIn(tombs, "cat", c)) cats[c.id] = String(c.name || c.id); });
    var acc = null;
    if (args.account !== undefined && args.account !== null && args.account !== "") {
      var want = fold(args.account);
      Object.keys(accs).forEach(function (id) { if (!acc && (id === String(args.account) || fold(accs[id]) === want)) acc = id; });
      if (!acc) return { ok: false, err: "No Budget account with that name or id. Accounts: " + Object.keys(accs).map(function (id) { return accs[id]; }).join(", ") };
    }
    var rows = (Array.isArray(d.tx) ? d.tx : []).filter(function (x) {
      if (!isObj(x) || typeof x.id !== "string" || typeof x.d !== "string" || deadIn(tombs, "tx", x)) return false;
      if (x.d < from || x.d > to) return false;
      if (acc && x.ac !== acc) return false;
      if (args.bank === true && !(x.src === "bank" || x.pp === 1 || typeof x.fit === "string")) return false;
      return true;
    }).sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); });
    var page = rows.slice(offset, offset + PAGE).map(function (x) {
      var o = { id: x.id, date: x.d, kind: x.k === "i" ? "income" : "expense", amount: cents(x.a) };
      if (x.c) o.category = cats[x.c] || String(x.c);
      if (x.ac) o.account = accs[x.ac] || "(deleted account)";
      if (x.n) o.note = String(x.n);
      if (x.ot) o.bank_text = String(x.ot);
      if (x.fit) o.bank_id = String(x.fit);
      if (x.src) o.source = String(x.src);
      if (x.pp === 1) o.paypal = true;
      if (typeof x.oc === "string" && x.oa !== undefined) { o.original_currency = x.oc; o.original_amount = cents(x.oa); }
      if (x.rc) o.receipts = String(x.rc).split(" ").length;
      Object.keys(x).sort().forEach(function (k) {
        if (OWN_TX[k] || o[k] !== undefined) return;
        var v = x[k];
        if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") o[k] = v;
      });
      return o;
    });
    var data = { currency: cur, from: from, to: to, total: rows.length, lines: page };
    if (offset + PAGE < rows.length) data.next_offset = offset + PAGE;
    if (acc) data.account = accs[acc];
    return { ok: true, data: data };
  }

  function pageOf(rows, args) {
    var offset = args.offset === undefined ? 0 : args.offset;
    if (!(typeof offset === "number" && Math.floor(offset) === offset && offset >= 0)) return { err: "offset must be a whole number ≥ 0." };
    var out = { total: rows.length, rows: rows.slice(offset, offset + PAGE) };
    if (offset + PAGE < rows.length) out.next_offset = offset + PAGE;
    return out;
  }
  function span(args) {
    var from = String(args.from || ""), to = String(args.to || "");
    if (!YMD.test(from) || !YMD.test(to) || isNaN(Date.parse(from)) || isNaN(Date.parse(to))) return { err: "from and to must be days as YYYY-MM-DD." };
    if (to < from) return { err: "to is before from." };
    if (dayDiff(from, to) > SPAN_DAYS) return { err: "At most " + SPAN_DAYS + " days per call." };
    return { from: from, to: to };
  }
  function put(o, k, v) { if (v !== undefined && v !== null && v !== "") o[k] = v; }
  var DOC_KINDS = { inv: "invoice", rcpt: "receipt", pro: "proforma", cred: "credit note", ext: "issued elsewhere" };

  // invoice_list: C = OrosInvoicesCore, raw = oros-invoices-data.
  // Issued documents (drafts left out) between two days, or with
  // received: true the invoices received from suppliers.
  function invoiceList(C, raw, args, today) {
    if (!isObj(args)) return { ok: false, err: "The arguments must be an object." };
    var sp = span(args);
    if (sp.err) return { ok: false, err: sp.err };
    var d = C.normalize(isObj(raw) ? raw : null), rows;
    if (args.received === true) {
      rows = C.live(d.bills).filter(function (b) { return b.date >= sp.from && b.date <= sp.to; })
        .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.id < b.id ? -1 : 1); })
        .map(function (b) {
          var o = { id: b.id, number: b.num || "", date: b.date, currency: b.cur || "EUR" };
          put(o, "due", b.due);
          put(o, "supplier", b.sup && b.sup.name);
          put(o, "supplier_vat_id", b.sup && b.sup.afm);
          o.net = cents(b.net || 0); o.vat = cents(b.vat || 0); o.total = cents(C.billTotal(b));
          o.paid = cents(C.billPaid(d, b.id)); o.balance = cents(C.billBalance(d, b)); o.status = C.billStatus(d, b, today);
          put(o, "note", b.note);
          return o;
        });
    } else {
      rows = C.live(d.docs).filter(function (x) { return x.st !== "draft" && x.date >= sp.from && x.date <= sp.to; })
        .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (String(a.num) < String(b.num) ? -1 : String(a.num) > String(b.num) ? 1 : (a.id < b.id ? -1 : 1)); })
        .map(function (x) {
          var tt = C.totals(x), sg = C.sign(x);
          var o = { id: x.id, number: x.num || "", kind: DOC_KINDS[x.kind] || x.kind, status: C.status(d, x, today), date: x.date, currency: x.cur || "EUR" };
          put(o, "due", x.due);
          put(o, "client", C.partyName(d, x));
          put(o, "client_vat_id", x.c && x.c.afm);
          o.net = cents(sg * tt.net); o.vat = cents(sg * tt.vat); o.total = cents(sg * tt.total);
          if (tt.wht) o.withheld = cents(sg * tt.wht);
          o.to_pay = cents(sg * tt.pay); o.paid = cents(C.paidOf(d, x.id)); o.balance = cents(C.balance(d, x));
          put(o, "mark", x.mark);
          if (Array.isArray(x.lines) && x.lines.length) {
            o.lines = x.lines.slice(0, 50).map(function (l) {
              var r = { text: String(l.d || ""), qty: (Number(l.q) || 0), price: cents(l.p || 0), vat_rate: Number(l.vat) || 0 };
              put(r, "code", l.code);
              if (l.disc) r.discount = Number(l.disc);
              return r;
            });
          }
          return o;
        });
    }
    var pg = pageOf(rows, args);
    if (pg.err) return { ok: false, err: pg.err };
    var data = { kind: args.received === true ? "received" : "issued", from: sp.from, to: sp.to, total: pg.total, documents: pg.rows };
    if (pg.next_offset) data.next_offset = pg.next_offset;
    return { ok: true, data: data };
  }

  // stock_items: S = OrosStockCore, raw = oros-stock-data. Products
  // with the quantity on hand (the sum of movements, never stored).
  function stockItems(S, raw, args) {
    if (!isObj(args)) return { ok: false, err: "The arguments must be an object." };
    var d = S.merge(isObj(raw) ? raw : null, isObj(raw) ? raw : null);
    var cats = {}, sups = {};
    (d.cats || []).forEach(function (c) { cats[c.id] = c.name; });
    (d.sups || []).forEach(function (x) { sups[x.id] = x.name; });
    var q = args.query ? fold(String(args.query).slice(0, 200)) : "";
    var rows = S.stockRows(d).filter(function (r) {
      var it = r.item;
      if (it.arch && args.archived !== true) return false;
      if (args.low === true && !r.low && !r.out) return false;
      if (q && [it.name, it.sku, it.bc, cats[it.cat], sups[it.sup]].map(fold).join(" ").indexOf(q) < 0) return false;
      return true;
    }).sort(function (a, b) { var x = fold(a.item.name), y = fold(b.item.name); return x < y ? -1 : x > y ? 1 : (a.item.id < b.item.id ? -1 : 1); })
      .map(function (r) {
        var it = r.item, dec = S.unitDec(d, it.unit);
        var o = { id: it.id, name: it.name, unit: it.unit, on_hand: (r.q / 1000).toFixed(dec) };
        put(o, "sku", it.sku); put(o, "barcode", it.bc); put(o, "category", cats[it.cat]); put(o, "supplier", sups[it.sup]);
        if (it.min) o.minimum = (it.min / 1000).toFixed(dec);
        if (it.cost) o.cost = cents(it.cost);
        if (it.price) o.price = cents(it.price);
        if (it.vat) o.vat_rate = it.vat;
        if (r.avg) o.average_cost = cents(r.avg);
        if (r.value) o.value = cents(r.value);
        if (r.low) o.low = true;
        if (r.out) o.out = true;
        if (it.arch) o.archived = true;
        put(o, "place", it.loc); put(o, "note", it.note);
        return o;
      });
    var pg = pageOf(rows, args);
    if (pg.err) return { ok: false, err: pg.err };
    var cur = isObj(d.set) && typeof d.set.cur === "string" ? d.set.cur : "EUR";
    var data = { currency: cur, total: pg.total, items: pg.rows };
    if (pg.next_offset) data.next_offset = pg.next_offset;
    return { ok: true, data: data };
  }

  // publish_titles: raw = oros-publish-data (PUBLISH v1, Part IV).
  var TITLE_ST = { idea: "idea", prod: "in production", out: "published", oop: "out of print" };
  var ROLES = { a: "author", t: "translator", i: "illustrator", e: "editor", c: "cover", n: "narrator", o: "other" };
  var FMTS = { pb: "paperback", hb: "hardback", eb: "ebook", ab: "audiobook", ot: "other" };
  function publishTitles(raw, args) {
    if (!isObj(args)) return { ok: false, err: "The arguments must be an object." };
    var d = isObj(raw) ? raw : {}, tombs = isObj(d.tombs) ? d.tombs : {};
    var st = args.status ? String(args.status) : "";
    var stKey = "";
    Object.keys(TITLE_ST).forEach(function (k) { if (k === st || TITLE_ST[k] === st) stKey = k; });
    if (st && !stKey) return { ok: false, err: "status must be one of: idea, in production, published, out of print." };
    var q = args.query ? fold(String(args.query).slice(0, 200)) : "";
    var rows = (Array.isArray(d.titles) ? d.titles : []).filter(function (x) {
      if (!isObj(x) || typeof x.id !== "string" || (typeof tombs[x.id] === "number" && tombs[x.id] >= (Number(x.m) || 0))) return false;
      if (stKey && x.st !== stKey) return false;
      if (q) {
        var hay = [x.t, x.sub, x.ser].concat((x.ppl || []).map(function (p) { return p && p.n; }), (x.fmts || []).map(function (f) { return f && f.isbn; }));
        if (hay.map(fold).join(" ").indexOf(q) < 0) return false;
      }
      return true;
    }).sort(function (a, b) { var x = fold(a.t), y = fold(b.t); return x < y ? -1 : x > y ? 1 : (a.id < b.id ? -1 : 1); })
      .map(function (x) {
        var o = { id: x.id, title: String(x.t || "") };
        put(o, "subtitle", x.sub); put(o, "series", x.ser);
        if (x.sn) o.series_number = x.sn;
        put(o, "status", TITLE_ST[x.st]); put(o, "release", x.rel); put(o, "language", x.lang);
        var ppl = (Array.isArray(x.ppl) ? x.ppl : []).filter(isObj).map(function (p) { return { role: ROLES[p.r] || "other", name: String(p.n || "") }; });
        if (ppl.length) o.people = ppl;
        var fm = (Array.isArray(x.fmts) ? x.fmts : []).filter(isObj).map(function (f) {
          var r = { format: FMTS[f.k] || "other" };
          put(r, "isbn", f.isbn);
          if (typeof f.price === "number") r.price = cents(f.price);
          if (f.pages) r.pages = f.pages;
          if (f.dur) r.duration = f.dur;
          put(r, "binding", f.bind); put(r, "paper", f.paper); put(r, "note", f.note);
          return r;
        });
        if (fm.length) o.formats = fm;
        if (x.blurb) o.blurb = String(x.blurb).slice(0, TEXT_MAX);
        if (x.kw) o.keywords = x.kw;
        return o;
      });
    var pg = pageOf(rows, args);
    if (pg.err) return { ok: false, err: pg.err };
    var data = { total: pg.total, titles: pg.rows };
    if (pg.next_offset) data.next_offset = pg.next_offset;
    return { ok: true, data: data };
  }

  // search_data: groups from orosAssistSearch → items for Claude.
  function packHits(groups, names) {
    var out = [];
    (Array.isArray(groups) ? groups : []).forEach(function (g) {
      (g && Array.isArray(g.hits) ? g.hits : []).forEach(function (h) {
        if (!h || out.length >= HITS_MAX) return;
        var text = String(h.text || "").replace(/\r\n?/g, "\n");
        var it = { app: g.id, app_name: names[g.id] || g.id, id: String(h.id == null ? "" : h.id), title: String(h.title || "") };
        if (h.when) { var dt = new Date(h.when); if (!isNaN(dt)) it.date = dt.toISOString().slice(0, 10); }
        if (text) it.text = text.length > TEXT_MAX ? text.slice(0, TEXT_MAX) + "…" : text;
        out.push(it);
      });
    });
    return out;
  }

  // The apps Claude may read: offered (searchable and installed), not
  // NEVER, and set to "read" on this device.
  function allowed(offered, lv) {
    var l = isObj(lv) ? lv : {};
    return (Array.isArray(offered) ? offered : []).filter(function (a) {
      return a && NEVER.indexOf(a.id) < 0 && (l[a.id] === "read" || l[a.id] === "write");
    });
  }
  function toolsOf(id) {
    var t = ["search_data", "read_item"];
    if (SUMMARY[id] || ACT.indexOf(id) >= 0) t.push("app_summary");
    if (DOCS.indexOf(id) >= 0) t.push("read_in_app");
    if (LINES[id]) t.push(LINES[id]);
    return t;
  }
  function pushLog(list, entry) {
    var l = Array.isArray(list) ? list.slice() : [];
    l.push(entry);
    return l.length > LOG_MAX ? l.slice(l.length - LOG_MAX) : l;
  }

  // The synced list of Claude's changes: [{ id, t, app, n, k, dv, x?, done? }]
  // x = the undo record (kept for the newest UNDO_MAX), done = undone at.
  // merge: union by id, undone wins (the later done), newest CHG_MAX kept.
  function chgClean(e) {
    if (!isObj(e) || typeof e.id !== "string" || !/^[a-z0-9]{4,32}$/.test(e.id) || typeof e.t !== "number" || !(e.t > 0)) return null;
    var o = { id: e.id, t: Math.floor(e.t), app: String(e.app || "").slice(0, 40), n: String(e.n || "").slice(0, 40),
              k: typeof e.k === "number" && e.k >= 0 ? Math.floor(e.k) : 0, dv: String(e.dv || "").slice(0, 40) };
    if (isObj(e.x)) o.x = e.x;
    if (typeof e.done === "number" && e.done > 0) o.done = Math.floor(e.done);
    return o;
  }
  function chgMerge(a, b) {
    var by = {};
    [].concat(Array.isArray(a) ? a : [], Array.isArray(b) ? b : []).forEach(function (raw) {
      var e = chgClean(raw);
      if (!e) return;
      var o = by[e.id];
      if (!o) { by[e.id] = e; return; }
      var m = JSON.stringify(o) >= JSON.stringify(e) ? clone(o) : clone(e);
      if (o.done || e.done) m.done = Math.max(o.done || 0, e.done || 0);
      if (!m.x && (o.x || e.x)) m.x = clone(o.x || e.x);
      by[e.id] = m;
    });
    var list = Object.keys(by).map(function (k) { return by[k]; })
      .sort(function (x, y) { return x.t - y.t || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0); });
    if (list.length > CHG_MAX) list = list.slice(list.length - CHG_MAX);
    list.forEach(function (e, i) { if (i < list.length - UNDO_MAX || e.done) delete e.x; });
    return list;
  }

  /* ---------- wave 3: changes to Budget (apps set to "write", 5.78.00 one rule) ---------- */
  var NOTE_LEN = 140, MAX_CENTS = 100000000000, ADD_MAX = 50, DEL_MAX = 100, ASK_OVER = 5;
  var TX_ID = /^[a-z0-9-]{1,64}$/;
  function stampAfter(now, old) { return Math.max(Math.floor(now), (Number(old) || 0) + 1); }
  function clone(o) { return o === undefined ? undefined : JSON.parse(JSON.stringify(o)); }
  function toCents(v) {
    var s = typeof v === "number" ? String(v) : String(v == null ? "" : v).trim().replace(",", ".");
    if (!/^\d{1,12}(\.\d{1,2})?$/.test(s)) return null;
    var c = Math.round(parseFloat(s) * 100);
    return c > 0 && c <= MAX_CENTS ? c : null;
  }
  function bgIndex(d) {
    var tombs = isObj(d.tombs) ? d.tombs : {}, accs = [], cats = [];
    (Array.isArray(d.acc) ? d.acc : []).forEach(function (a) { if (isObj(a) && typeof a.id === "string" && !deadIn(tombs, "acc", a)) accs.push({ id: a.id, n: String(a.n || a.id) }); });
    (Array.isArray(d.cats) ? d.cats : []).forEach(function (c) { if (isObj(c) && typeof c.id === "string" && !deadIn(tombs, "cat", c)) cats.push({ id: c.id, n: String(c.name || c.id), k: c.k === "i" ? "i" : "o" }); });
    return { accs: accs, cats: cats };
  }
  function findIn(list, v) {
    var f = fold(v), hit = null;
    list.forEach(function (x) { if (!hit && (x.id === String(v) || fold(x.n) === f)) hit = x; });
    return hit;
  }
  // A category: a stored one of that kind by name or id, or a built-in
  // id as budget_lines shows it (o-…, i-…).
  function catOf(ix, v, k) {
    var hit = findIn(ix.cats.filter(function (c) { return c.k === k; }), v);
    if (hit) return hit.id;
    var s = String(v);
    return TX_ID.test(s) && s.charAt(0) === k && s.charAt(1) === "-" ? s : "";
  }
  function catList(ix, k) { return ix.cats.filter(function (c) { return c.k === k; }).map(function (c) { return c.n; }).join(", "); }
  function liveTx(d, id) {
    var tombs = isObj(d.tombs) ? d.tombs : {};
    for (var i = 0; i < d.tx.length; i++) {
      var x = d.tx[i];
      if (isObj(x) && x.id === id && !deadIn(tombs, "tx", x)) return i;
    }
    return -1;
  }
  function sortTx(d) {
    d.tx.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
    var t = {};
    Object.keys(d.tombs).sort().forEach(function (k) { t[k] = d.tombs[k]; });
    d.tombs = t;
  }
  // Shared by add and change: the fields Claude may set.
  function setFields(x, e, ix, w) {
    if (e.date !== undefined) {
      if (!YMD.test(String(e.date)) || isNaN(Date.parse(e.date))) return w + "date must be a day as YYYY-MM-DD.";
      x.d = String(e.date);
    }
    if (e.amount !== undefined) {
      if (typeof x.oc === "string") return w + "this entry was typed in another currency; change its amount in Budget.";
      var a = toCents(e.amount);
      if (a === null) return w + "amount must be a number greater than 0 with at most 2 decimals, e.g. \"12.50\".";
      x.a = a;
    }
    if (e.category !== undefined) {
      if (e.category === "" || e.category === null) x.c = "";
      else {
        var c = catOf(ix, e.category, x.k);
        if (!c) return w + "no " + (x.k === "i" ? "income" : "expense") + " category \"" + String(e.category).slice(0, 60) + "\". Categories: " + catList(ix, x.k);
        x.c = c;
      }
    }
    if (e.account !== undefined) {
      if (e.account === "" || e.account === null) delete x.ac;
      else {
        var ac = findIn(ix.accs, e.account);
        if (!ac) return w + "no Budget account \"" + String(e.account).slice(0, 60) + "\". Accounts: " + ix.accs.map(function (a) { return a.n; }).join(", ");
        x.ac = ac.id;
      }
    }
    if (e.note !== undefined) {
      var n = String(e.note == null ? "" : e.note).replace(/\s+/g, " ").trim();
      if (n.length > NOTE_LEN) return w + "note is longer than " + NOTE_LEN + " characters.";
      x.n = n;
    }
    return "";
  }
  function emptyBudget() { return { ver: 1, tx: [], cats: [], acc: [], set: { m: 0, cur: "EUR" }, tombs: {} }; }

  // op = "add" | "change" | "delete"; raw = oros-budget-data; now = ms;
  // newId() → a fresh id. → { ok, data, undo, ids, text } | { ok:false, err }
  // undo = { b: { id: entry before | null }, a: { id: m after | null } }
  function budgetWrite(op, raw, args, now, newId) {
    if (!isObj(args)) return { ok: false, err: "The arguments must be an object." };
    var d = isObj(raw) ? clone(raw) : emptyBudget();
    if (!Array.isArray(d.tx)) d.tx = [];
    if (!isObj(d.tombs)) d.tombs = {};
    var ix = bgIndex(d), undo = { b: {}, a: {} }, ids = [], i, err;
    if (op === "add") {
      var list = args.entries;
      if (!Array.isArray(list) || !list.length) return { ok: false, err: "entries must be a list of 1 to " + ADD_MAX + " entries." };
      if (list.length > ADD_MAX) return { ok: false, err: "At most " + ADD_MAX + " entries per call." };
      var made = [];
      for (i = 0; i < list.length; i++) {
        var e = list[i], w = "entries[" + i + "]: ";
        if (!isObj(e)) return { ok: false, err: w + "must be an object." };
        if (e.kind !== "expense" && e.kind !== "income") return { ok: false, err: w + "kind must be expense or income." };
        if (e.date === undefined || e.amount === undefined) return { ok: false, err: w + "date and amount are required." };
        var id;
        do { id = String(newId()); } while (liveTx(d, id) >= 0 || d.tombs["tx:" + id] !== undefined);
        if (!TX_ID.test(id)) return { ok: false, err: "bad id" };
        var x = { id: id, m: 0, d: "", a: 0, k: e.kind === "income" ? "i" : "o", c: "", n: "" };
        err = setFields(x, e, ix, w);
        if (err) return { ok: false, err: err };
        x.m = stampAfter(now, 0);
        made.push(x);
      }
      made.forEach(function (x) { d.tx.push(x); undo.b[x.id] = null; undo.a[x.id] = x.m; ids.push(x.id); });
      sortTx(d);
      return { ok: true, data: d, undo: undo, ids: ids, text: "Added " + ids.length + " entr" + (ids.length === 1 ? "y" : "ies") + ": " + ids.join(", ") };
    }
    if (op === "change") {
      var cid = String(args.id || "");
      var at = liveTx(d, cid);
      if (at < 0) return { ok: false, err: "No Budget entry with id " + cid.slice(0, 64) + "." };
      if (cid.indexOf("l-") === 0) return { ok: false, err: "That entry comes from another app or a shop; change it there." };
      var cx = d.tx[at], before = clone(cx), y = clone(cx);
      var keys = ["date", "amount", "category", "account", "note"].filter(function (k) { return args[k] !== undefined; });
      if (!keys.length) return { ok: false, err: "Say what to change: date, amount, category, account or note." };
      err = setFields(y, args, ix, "");
      if (err) return { ok: false, err: err };
      if (JSON.stringify(y) === JSON.stringify(cx)) return { ok: false, err: "Nothing would change: the entry already looks like that." };
      y.m = stampAfter(now, cx.m);
      d.tx[at] = y;
      undo.b[cid] = before; undo.a[cid] = y.m; ids.push(cid);
      sortTx(d);
      return { ok: true, data: d, undo: undo, ids: ids, text: "Changed " + cid + " (" + keys.join(", ") + ")." };
    }
    if (op === "delete") {
      var del = args.ids;
      if (!Array.isArray(del) || !del.length) return { ok: false, err: "ids must be a list of 1 to " + DEL_MAX + " entry ids." };
      if (del.length > DEL_MAX) return { ok: false, err: "At most " + DEL_MAX + " entries per call." };
      for (i = 0; i < del.length; i++) {
        var did = String(del[i]), k = liveTx(d, did);
        if (k < 0) return { ok: false, err: "No Budget entry with id " + did.slice(0, 64) + "; nothing was deleted." };
        if (did.indexOf("l-") === 0) return { ok: false, err: did + " comes from another app or a shop; delete it there. Nothing was deleted." };
        if (d.tx[k].rc) return { ok: false, err: did + " has receipts on the orOS disk; delete it in Budget. Nothing was deleted." };
        if (undo.b[did] !== undefined) continue;
        var gone = d.tx.splice(k, 1)[0];
        undo.b[did] = clone(gone);
        d.tombs["tx:" + did] = stampAfter(now, Math.max(d.tombs["tx:" + did] || 0, gone.m || 0));
        undo.a[did] = null;
        ids.push(did);
      }
      sortTx(d);
      return { ok: true, data: d, undo: undo, ids: ids, text: "Deleted " + ids.length + " entr" + (ids.length === 1 ? "y" : "ies") + "." };
    }
    return { ok: false, err: "unknown change" };
  }
  // Puts back what one change did, entry by entry, only while an entry
  // still looks as the change left it. → { ok, data, n (put back), kept (changed since) }
  function budgetUndo(raw, u, now) {
    if (!isObj(u) || !isObj(u.b) || !isObj(u.a)) return { ok: false, err: "bad undo" };
    var d = isObj(raw) ? clone(raw) : emptyBudget();
    if (!Array.isArray(d.tx)) d.tx = [];
    if (!isObj(d.tombs)) d.tombs = {};
    var n = 0, kept = 0;
    Object.keys(u.b).forEach(function (id) {
      var at = liveTx(d, id), before = u.b[id], after = u.a[id];
      if (after === null) {                         // the change deleted it
        if (at >= 0 || !isObj(before)) { kept++; return; }
        var x = clone(before);
        x.m = stampAfter(now, Math.max(x.m || 0, d.tombs["tx:" + id] || 0));
        delete d.tombs["tx:" + id];
        d.tx = d.tx.filter(function (y) { return !(isObj(y) && y.id === id); });
        d.tx.push(x); n++;
        return;
      }
      if (at < 0 || d.tx[at].m !== after) { kept++; return; }
      if (before === null) {                         // the change added it
        d.tombs["tx:" + id] = stampAfter(now, Math.max(d.tombs["tx:" + id] || 0, d.tx[at].m || 0));
        d.tx.splice(at, 1); n++;
        return;
      }
      var back = clone(before);
      back.m = stampAfter(now, d.tx[at].m);
      d.tx[at] = back; n++;
    });
    sortTx(d);
    return { ok: true, data: d, n: n, kept: kept };
  }
  /* ---------- changes to Kanban (5.68.00; one rule since 5.78.00) ---------- */
  // Pure: kanbanWrite(M, op, raw, args, now, newId) with M = OrosKanbanModel
  // (kanban/model.js). Every edit follows Kanban's own sync rules: a new
  // card gets fresh field stamps, a move stamps the placement group "p",
  // an edit stamps only the groups it changes, and the column (or board)
  // whose order changed gets om = now, so the next merge keeps this order.
  // All or none per call. → { ok, data (canonical), undo, ids, text } | { ok:false, err }
  var KB_TEXT = 500, KB_NOTES = 5000, KB_ADD = 50, KB_MOVE = 100, KB_COLS = 20;
  function kbBoards(d) {
    var gone = isObj(d.boardDeleted) ? d.boardDeleted : {};
    return (Array.isArray(d.boards) ? d.boards : []).filter(function (b) {
      return isObj(b) && typeof b.id === "string" && b.id.indexOf("tpl-") !== 0 && !b.archived &&
        !(typeof gone[b.id] === "number" && gone[b.id] >= (b.mtime || 0));
    });
  }
  function kbFind(list, key, what) {
    var k = String(key == null ? "" : key).trim();
    if (!k) return { err: what + " is missing." };
    var byId = list.filter(function (x) { return x.id === k; });
    if (byId.length) return { x: byId[0] };
    var f = fold(k), hit = list.filter(function (x) { return fold(x.name) === f; });
    if (hit.length === 1) return { x: hit[0] };
    if (hit.length > 1) return { err: "More than one " + what + " is called \"" + k + "\"; use its id." };
    return { err: "No " + what + " \"" + k + "\". " + what.charAt(0).toUpperCase() + what.slice(1) + "s: " +
      list.slice(0, 80).map(function (x) { return (x.name || "—") + " (" + x.id + ")"; }).join(", ") + "." };
  }
  function kbCols(b) { return (Array.isArray(b.columns) ? b.columns : []).filter(function (c) { return isObj(c) && typeof c.id === "string"; }); }
  function kbCard(b, id) {
    var cols = kbCols(b);
    for (var i = 0; i < cols.length; i++) {
      var cs = Array.isArray(cols[i].cards) ? cols[i].cards : [];
      for (var j = 0; j < cs.length; j++) if (isObj(cs[j]) && cs[j].id === id) return { col: cols[i], at: j, card: cs[j] };
    }
    return null;
  }
  function kbLabels(b, names) {
    if (!Array.isArray(names)) return { err: "labels must be a list of label names." };
    var list = (Array.isArray(b.labels) ? b.labels : []).filter(function (l) {
      return isObj(l) && typeof l.id === "string" && !(isObj(b.deleted) && typeof b.deleted[l.id] === "number" && b.deleted[l.id] >= (l.mtime || 0));
    });
    var out = [];
    for (var i = 0; i < names.length && i < 20; i++) {
      var r = kbFind(list, names[i], "label");
      if (r.err) return r;
      if (out.indexOf(r.x.id) < 0) out.push(r.x.id);
    }
    return { ids: out };
  }
  function kbText(v, max, what) {
    var s = String(v == null ? "" : v).replace(/\r\n?/g, "\n");
    if (what === "text") s = s.replace(/\s+/g, " ").trim();
    if (what === "text" && !s) return { err: "A card needs text." };
    if (s.length > max) return { err: what + " is longer than " + max + " characters." };
    return { s: s };
  }
  function kbDue(v) {
    if (v === "" || v === null) return { d: null };
    var s = String(v);
    if (!YMD.test(s) || isNaN(Date.parse(s + "T00:00:00Z"))) return { err: "due must be YYYY-MM-DD, or \"\" to clear it." };
    return { d: s };
  }
  function kbSnap(card, col, at) {
    return { col: col.id, at: at, t: card.text || "", n: card.notes || "", d: card.due || null,
             l: Array.isArray(card.labels) ? card.labels.slice() : [] };
  }
  function kbPlace(col, card, top) {
    if (!Array.isArray(col.cards)) col.cards = [];
    if (top) col.cards.unshift(card); else col.cards.push(card);
  }
  function kanbanWrite(M, op, raw, args, now, newId) {
    if (!M || typeof M.canonState !== "function") return { ok: false, err: "Kanban is not loaded on the device yet; try again in a moment." };
    var d = isObj(raw) ? clone(raw) : null;
    if (!d || !Array.isArray(d.boards)) return { ok: false, err: "Kanban has no boards yet." };
    args = isObj(args) ? args : {};
    var fb = kbFind(kbBoards(d), args.board, "board");
    if (fb.err) return { ok: false, err: fb.err + (fb.err.indexOf("No board") === 0 ? " (Archived boards and templates cannot be changed.)" : "") };
    var b = fb.x;
    if (!isObj(b.deleted)) b.deleted = {};
    var undo = { k: "kanban", board: b.id, cards: {}, cols: {} }, ids = [], i, r;

    if (op === "add_columns") {
      var list = Array.isArray(args.columns) ? args.columns : [];
      if (!list.length || list.length > KB_COLS) return { ok: false, err: "columns must hold 1 to " + KB_COLS + " columns." };
      for (i = 0; i < list.length; i++) {
        var nc = isObj(list[i]) ? list[i] : {};
        r = kbText(nc.name, 60, "text");
        if (r.err) return { ok: false, err: "Column " + (i + 1) + ": a column needs a name of at most 60 characters." };
        var cols = kbCols(b), where = cols.length;
        if (nc.after != null && String(nc.after).trim()) {
          var fa = kbFind(cols, nc.after, "column");
          if (fa.err) return { ok: false, err: "Column " + (i + 1) + ": " + fa.err };
          where = b.columns.indexOf(fa.x) + 1;
        }
        var col = { id: newId(), name: r.s, mtime: now, om: 0, pos: 0, cards: [] };
        b.columns.splice(where, 0, col);
        undo.cols[col.id] = now;
        ids.push(col.id);
      }
      b.om = now;
      return { ok: true, data: M.canonState(d, now), undo: undo, ids: ids, text: "Added " + ids.length + " column" + (ids.length === 1 ? "" : "s") + " to " + (b.name || "the board") + "." };
    }

    if (op === "add_cards") {
      var add = Array.isArray(args.cards) ? args.cards : [];
      if (!add.length || add.length > KB_ADD) return { ok: false, err: "cards must hold 1 to " + KB_ADD + " cards." };
      var touched = [];
      for (i = 0; i < add.length; i++) {
        var a = isObj(add[i]) ? add[i] : {}, tag = "Card " + (i + 1) + ": ";
        var fc = kbFind(kbCols(b), a.column, "column");
        if (fc.err) return { ok: false, err: tag + fc.err };
        var tx = kbText(a.text, KB_TEXT, "text");
        if (tx.err) return { ok: false, err: tag + tx.err };
        var nt = kbText(a.notes, KB_NOTES, "notes");
        if (nt.err) return { ok: false, err: tag + nt.err };
        var du = a.due === undefined ? { d: null } : kbDue(a.due);
        if (du.err) return { ok: false, err: tag + du.err };
        var lb = a.labels === undefined ? { ids: [] } : kbLabels(b, a.labels);
        if (lb.err) return { ok: false, err: tag + lb.err };
        var card = { id: newId(), text: tx.s, notes: nt.s, due: du.d, labels: lb.ids, subtasks: [], info: [], mtime: now, pos: 0, fm: M.freshFm(now) };
        kbPlace(fc.x, card, a.position === "top");
        if (touched.indexOf(fc.x) < 0) touched.push(fc.x);
        undo.cards[card.id] = { b: null, a: now };
        ids.push(card.id);
      }
      touched.forEach(function (c) { c.om = now; });
      return { ok: true, data: M.canonState(d, now), undo: undo, ids: ids, text: "Added " + ids.length + " card" + (ids.length === 1 ? "" : "s") + "." };
    }

    if (op === "move_cards") {
      var mv = Array.isArray(args.moves) ? args.moves : [];
      if (!mv.length || mv.length > KB_MOVE) return { ok: false, err: "moves must hold 1 to " + KB_MOVE + " moves." };
      var seen = {}, changedCols = [];
      for (i = 0; i < mv.length; i++) {
        var m = isObj(mv[i]) ? mv[i] : {}, mt = "Move " + (i + 1) + ": ";
        var id = String(m.card || "");
        if (seen[id]) return { ok: false, err: mt + "card " + id + " is moved twice in one call." };
        seen[id] = 1;
        var at = kbCard(b, id);
        if (!at) return { ok: false, err: mt + "no card with id " + id + " on " + (b.name || "this board") + " (ids come from app_summary or search_data)." };
        var to = kbFind(kbCols(b), m.column, "column");
        if (to.err) return { ok: false, err: mt + to.err };
        if (to.x === at.col && m.position !== "top" && m.position !== "bottom") return { ok: false, err: mt + "the card is already in " + (to.x.name || "that column") + "." };
        undo.cards[id] = { b: kbSnap(at.card, at.col, at.at), a: 0 };
        at.col.cards.splice(at.at, 1);
        kbPlace(to.x, at.card, m.position === "top");
        M.stampCard(at.card, ["p"], now);            // the placement is its own field group
        undo.cards[id].a = at.card.mtime;
        [at.col, to.x].forEach(function (c) { if (changedCols.indexOf(c) < 0) changedCols.push(c); });
        ids.push(id);
      }
      changedCols.forEach(function (c) { c.om = now; });
      return { ok: true, data: M.canonState(d, now), undo: undo, ids: ids, text: "Moved " + ids.length + " card" + (ids.length === 1 ? "" : "s") + "." };
    }

    if (op === "change_card") {
      var hit = kbCard(b, String(args.card || ""));
      if (!hit) return { ok: false, err: "No card with id " + String(args.card || "") + " on " + (b.name || "this board") + "." };
      var c0 = hit.card, groups = [], snap = kbSnap(c0, hit.col, hit.at), v;
      if (args.text !== undefined) { v = kbText(args.text, KB_TEXT, "text"); if (v.err) return { ok: false, err: v.err }; if (v.s !== (c0.text || "")) { c0.text = v.s; groups.push("t"); } }
      if (args.notes !== undefined) { v = kbText(args.notes, KB_NOTES, "notes"); if (v.err) return { ok: false, err: v.err }; if (v.s !== (c0.notes || "")) { c0.notes = v.s; groups.push("n"); } }
      if (args.due !== undefined) { v = kbDue(args.due); if (v.err) return { ok: false, err: v.err }; if (v.d !== (c0.due || null)) { c0.due = v.d; groups.push("d"); } }
      if (args.labels !== undefined) {
        v = kbLabels(b, args.labels); if (v.err) return { ok: false, err: v.err };
        var old = Array.isArray(c0.labels) ? c0.labels : [];
        if (JSON.stringify(v.ids) !== JSON.stringify(old)) { c0.labels = v.ids; groups.push("l"); }
      }
      if (!groups.length) return { ok: false, err: "Nothing to change: the card already looks like this." };
      M.stampCard(c0, groups, now);
      undo.cards[c0.id] = { b: snap, a: c0.mtime, g: groups };
      return { ok: true, data: M.canonState(d, now), undo: undo, ids: [c0.id], text: "Changed the card." };
    }
    return { ok: false, err: "unknown change" };
  }
  // Puts back what one Kanban change did, only for the cards and columns
  // that still look as the change left them. → { ok, data, n, kept }
  function kanbanUndo(M, raw, u, now) {
    if (!M || !isObj(u) || u.k !== "kanban" || !isObj(u.cards) || !isObj(u.cols)) return { ok: false, err: "bad undo" };
    var d = isObj(raw) ? clone(raw) : null;
    if (!d || !Array.isArray(d.boards)) return { ok: false, err: "no board" };
    var b = d.boards.filter(function (x) { return isObj(x) && x.id === u.board; })[0];
    if (!b) return { ok: true, data: d, n: 0, kept: Object.keys(u.cards).length + Object.keys(u.cols).length };
    if (!isObj(b.deleted)) b.deleted = {};
    var n = 0, kept = 0, oms = [];
    Object.keys(u.cards).forEach(function (id) {
      var e = u.cards[id], at = kbCard(b, id);
      if (!at || (at.card.mtime || 0) !== e.a) { kept++; return; }
      if (e.b === null) {                                   // the change added it
        at.col.cards.splice(at.at, 1);
        b.deleted[id] = Math.max(now, (at.card.mtime || 0) + 1);
        oms.push(at.col); n++;
        return;
      }
      var s = e.b, groups = [], card = at.card;
      if (Array.isArray(e.g)) {
        if (e.g.indexOf("t") >= 0) { card.text = s.t; groups.push("t"); }
        if (e.g.indexOf("n") >= 0) { card.notes = s.n; groups.push("n"); }
        if (e.g.indexOf("d") >= 0) { card.due = s.d; groups.push("d"); }
        if (e.g.indexOf("l") >= 0) { card.labels = s.l.slice(); groups.push("l"); }
      } else {                                              // a move: back to its column and place
        var home = kbCols(b).filter(function (c) { return c.id === s.col; })[0];
        if (!home) { kept++; return; }
        at.col.cards.splice(at.at, 1);
        if (!Array.isArray(home.cards)) home.cards = [];
        home.cards.splice(Math.min(s.at, home.cards.length), 0, card);
        groups.push("p");
        oms.push(at.col, home);
      }
      M.stampCard(card, groups, now);
      n++;
    });
    Object.keys(u.cols).forEach(function (id) {
      var cols = kbCols(b), c = cols.filter(function (x) { return x.id === id; })[0];
      if (!c || (c.mtime || 0) !== u.cols[id] || (Array.isArray(c.cards) && c.cards.length)) { kept++; return; }
      b.columns.splice(b.columns.indexOf(c), 1);
      b.deleted[id] = Math.max(now, (c.mtime || 0) + 1);
      b.om = now; n++;
    });
    oms.forEach(function (c) { c.om = now; });
    return { ok: true, data: M.canonState(d, now), n: n, kept: kept };
  }
  // App switches from another device of the gate (via the relay):
  // only "read", and "write" for apps that may be changed; never-apps
  // stay off whatever arrives (5.77.00).
  function lvFrom(raw) {
    var out = {};
    if (!isObj(raw)) return out;
    Object.keys(raw).slice(0, 80).forEach(function (k) {
      if (NEVER.indexOf(k) >= 0) return;
      if (raw[k] === "write") out[k] = writable(k) ? "write" : "read";
      else if (raw[k] === "read") out[k] = "read";
    });
    return out;
  }
  // Apps whose items Claude may change, and the tools for them.
  var WRITES = { budget: ["budget_add", "budget_change", "budget_delete"],
                 kanban: ["kanban_add_cards", "kanban_move_cards", "kanban_change_card", "kanban_add_columns"] };
  // GATE-ACT (2026-11-08): the apps Claude may change with the
  // Assistant's own tools, run in a hidden Assistant frame
  // (assistant.js GATE). = the Assistant's create / change apps, less
  // NEVER, the apps with their own tools above (Budget, Kanban) and
  // Files (tests/gate-act.test.js).
  var ACT = ["bookmarks", "calendar", "chores", "contacts", "crm", "feeds", "flashcards", "garage", "habits", "invoices",
             "library", "meals", "music", "notes", "petcare", "plants", "podcasts", "publish", "shelf", "split", "stickies", "stock",
             "timesheet", "todo", "travel", "wiki"];
  // W5 (2026-11-08, Chris: "Ναι, ορατά στην οθόνη"): the documents the
  // Assistant changes with edit_in_app (assistant.js EDIT_SRC). The app
  // opens on the owner's screen and applies the commands there.
  var DOCS = ["atelier", "layout", "mindmap", "montage", "photolab", "slides", "spreadsheet", "studio", "whiteboard", "writer"];
  // The changes the relay may queue while orOS is closed (relay/gate.js
  // closedCall): its own change tools less budget_delete, and
  // create_items. applyQueue runs nothing else (defence in depth).
  var QUEUED = ["budget_add", "budget_change", "kanban_add_cards", "kanban_move_cards", "kanban_change_card", "kanban_add_columns", "create_items"];
  var ACT_TOOLS = ["search_data", "read_item", "app_summary", "read_in_app", "edit_in_app", "do_action", "change_item", "create_items", "link_contact", "link_items", "change_history", "undo_change",
                   "propose_entry", "propose_automation", "propose_rule", "newsletter_add", "newsletter_check", "book_cover",
                   "rebuild_in_layout", "learn_house_style", "layout_book", "add_house_rule"];
  // GATE-PAR P3: tools that open an app on the owner's screen with the
  // work (= core.js GATE_OPEN); like do_action they need an app Claude
  // may change, no pause, and the frame checks the target app.
  var ACT_OPEN = ACT_TOOLS.slice(12);
  var ACT_WRITE = ["create_items", "change_item", "link_contact", "link_items", "undo_change", "edit_in_app"];
  var DOC_WRITE = ["edit_in_app", "undo_change"];
  function writable(id) { return !!WRITES[id] || ACT.indexOf(id) >= 0 || DOCS.indexOf(id) >= 0; }
  function actable(id) { return ACT.indexOf(id) >= 0 || DOCS.indexOf(id) >= 0; }
  // One rule, orOS open or closed (Chris 08/11, 5.78.00): Claude may
  // change an app set to "write", unless the owner paused changes
  // (hold = paused until, ms). Every change is notified and undoable.
  function canWrite(lv, hold, id, now) {
    return !!(isObj(lv) && lv[id] === "write" && writable(id) && NEVER.indexOf(id) < 0 && !(typeof hold === "number" && hold > now));
  }

  // The copy's key for a call (= relay/gate.js stableArgs).
  function stableArgs(a) {
    var o = isObj(a) ? a : {}, out = {};
    Object.keys(o).sort().forEach(function (k) { if (o[k] !== undefined && o[k] !== null && o[k] !== "") out[k] = o[k]; });
    return JSON.stringify(out);
  }
  // ---- the daily email (5.79.00) ----
  function ymd(t) {
    var d = new Date(t);
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  }
  var DAY_RE = /^\d{4}-\d{2}-\d{2}$/, ACCT_RE = /^[a-z0-9]{6,40}$/;
  function digClean(o) {
    o = isObj(o) ? o : {};
    var r = { on: o.on !== false, acct: typeof o.acct === "string" && ACCT_RE.test(o.acct) ? o.acct : "",
              m: typeof o.m === "number" && o.m > 0 ? Math.floor(o.m) : 0,
              d: typeof o.d === "string" && DAY_RE.test(o.d) ? o.d : "",
              dv: typeof o.dv === "string" ? o.dv.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24) : "" };
    if (typeof o.fd === "string" && DAY_RE.test(o.fd) && typeof o.fn === "number" && o.fn > 0) { r.fd = o.fd; r.fn = Math.min(99, Math.floor(o.fn)); }
    if (typeof o.at === "number" && o.at > 0) r.at = Math.floor(o.at);
    return r;
  }
  // Settings: the newer m wins. The day: the later one wins; on the
  // same day the lower device tag wins, so two devices that both claimed
  // it agree on one sender once sync meets.
  function digMerge(a, b) {
    a = digClean(a); b = digClean(b);
    var s = b.m > a.m ? b : a, d = a.d > b.d ? a : b.d > a.d ? b : (a.dv <= b.dv ? a : b);
    var f = (a.fd || "") > (b.fd || "") ? a : (b.fd || "") > (a.fd || "") ? b : ((a.fn || 0) >= (b.fn || 0) ? a : b);
    var r = { on: s.on, acct: s.acct, m: s.m, d: d.d, dv: d.dv };
    if (f.fd) { r.fd = f.fd; r.fn = f.fn; }
    var at = Math.max(a.at || 0, b.at || 0);
    if (at) r.at = at;
    return r;
  }
  // Today's changes (local day of now), oldest first.
  function digToday(list, now) {
    var day = ymd(now);
    return (Array.isArray(list) ? list : []).filter(function (e) { return isObj(e) && typeof e.t === "number" && ymd(e.t) === day; })
      .sort(function (x, y) { return x.t - y.t; });
  }
  // Is the email due now? on, at or after 20:00, not sent today, not
  // failed 3 times today, and Claude changed something today.
  function digDue(dg, list, now) {
    dg = digClean(dg);
    var day = ymd(now);
    if (!dg.on || new Date(now).getHours() < DIG_HOUR || dg.d === day) return false;
    if (dg.fd === day && dg.fn >= DIG_TRIES) return false;
    return digToday(list, now).length > 0;
  }
  var DIG_TXT = {
    en: { subject: "orOS: Claude's changes on {day}", intro: "Claude changed these in your orOS today ({n}):",
          undone: "undone", undo: "To undo one: orOS › Settings › Claude (orOS Gate) › Claude's changes.", items: "{n} items",
          tools: { budget_add: "added Budget entries", budget_change: "changed a Budget entry", budget_delete: "deleted Budget entries",
                   kanban_add_cards: "added Kanban cards", kanban_move_cards: "moved Kanban cards", kanban_change_card: "changed a Kanban card",
                   kanban_add_columns: "added Kanban columns",
                   create_items: "added items in {app}", change_item: "changed items in {app}", link_contact: "linked contacts in {app}",
                   link_items: "linked items in {app}", undo_change: "undid changes in {app}", edit_in_app: "changed documents in {app}" } },
    el: { subject: "orOS: οι αλλαγές του Claude στις {day}", intro: "Ο Claude έκανε σήμερα αυτές τις αλλαγές στο orOS σου ({n}):",
          undone: "αναιρέθηκε", undo: "Για αναίρεση: orOS › Ρυθμίσεις › Claude (orOS Gate) › Αλλαγές του Claude.", items: "{n} στοιχεία",
          tools: { budget_add: "πρόσθεσε εγγραφές στο Budget", budget_change: "άλλαξε μια εγγραφή του Budget", budget_delete: "έσβησε εγγραφές του Budget",
                   kanban_add_cards: "πρόσθεσε κάρτες στο Kanban", kanban_move_cards: "μετακίνησε κάρτες στο Kanban", kanban_change_card: "άλλαξε μια κάρτα του Kanban",
                   kanban_add_columns: "πρόσθεσε στήλες στο Kanban",
                   create_items: "πρόσθεσε εγγραφές ({app})", change_item: "άλλαξε εγγραφές ({app})", link_contact: "συνέδεσε επαφές ({app})",
                   link_items: "συνέδεσε εγγραφές ({app})", undo_change: "αναίρεσε αλλαγές ({app})", edit_in_app: "άλλαξε έγγραφα ({app})" } },
    de: { subject: "orOS: Claudes Änderungen am {day}", intro: "Claude hat heute Folgendes in deinem orOS geändert ({n}):",
          undone: "rückgängig gemacht", undo: "Rückgängig machen: orOS › Einstellungen › Claude (orOS Gate) › Claudes Änderungen.", items: "{n} Einträge",
          tools: { budget_add: "Budget-Einträge hinzugefügt", budget_change: "einen Budget-Eintrag geändert", budget_delete: "Budget-Einträge gelöscht",
                   kanban_add_cards: "Kanban-Karten hinzugefügt", kanban_move_cards: "Kanban-Karten verschoben", kanban_change_card: "eine Kanban-Karte geändert",
                   kanban_add_columns: "Kanban-Spalten hinzugefügt",
                   create_items: "Einträge hinzugefügt ({app})", change_item: "Einträge geändert ({app})", link_contact: "Kontakte verknüpft ({app})",
                   link_items: "Einträge verknüpft ({app})", undo_change: "Änderungen rückgängig gemacht ({app})", edit_in_app: "Dokumente geändert ({app})" } }
  };
  function fill(s, o) { return String(s).replace(/\{(\w+)\}/g, function (m, k) { return o[k] !== undefined ? o[k] : m; }); }
  // → { subject, text } in the owner's language (en, el, de).
  function digText(list, now, lang) {
    var T = DIG_TXT[lang] || DIG_TXT.en, today = digToday(list, now), d = new Date(now);
    var day = ("0" + d.getDate()).slice(-2) + "/" + ("0" + (d.getMonth() + 1)).slice(-2) + "/" + d.getFullYear();
    var lines = today.map(function (e) {
      var t = new Date(e.t);
      return "- " + ("0" + t.getHours()).slice(-2) + ":" + ("0" + t.getMinutes()).slice(-2) + " · " + fill(T.tools[e.n] || e.n, { app: e.app || "" }) +
        " (" + fill(T.items, { n: e.k || 0 }) + ")" + (e.dv ? " · " + e.dv : "") + (e.done ? " · " + T.undone : "");
    });
    return { subject: fill(T.subject, { day: day }), text: [fill(T.intro, { n: today.length }), ""].concat(lines, ["", T.undo]).join("\n") };
  }

  // The relay orOS uses (Mail › relay, a self-hosted one), else orOS's own.
  function relayOf(mail) {
    var u = isObj(mail) && isObj(mail.relay) && typeof mail.relay.url === "string" ? mail.relay.url.trim().replace(/\/+$/, "") : "";
    return /^https:\/\/[^\s/?#]+(\/[^\s?#]*)?$/.test(u) ? u : RELAY;
  }

  var core = { NEVER: NEVER, budgetLines: budgetLines, invoiceList: invoiceList, stockItems: stockItems, publishTitles: publishTitles,
               relayOf: relayOf, RELAY: RELAY, budgetWrite: budgetWrite, budgetUndo: budgetUndo, canWrite: canWrite,
               kanbanWrite: kanbanWrite, kanbanUndo: kanbanUndo, lvFrom: lvFrom, joinHash: joinHash, chgMerge: chgMerge, seatMerge: seatMerge, seatClean: seatClean,
               stableArgs: stableArgs, digMerge: digMerge, digClean: digClean, digDue: digDue, digText: digText, ymd: ymd,
               WRITES: WRITES, ACT: ACT, DOCS: DOCS, QUEUED: QUEUED, actable: actable, ACT_TOOLS: ACT_TOOLS, ACT_OPEN: ACT_OPEN, ACT_WRITE: ACT_WRITE, writable: writable, ASK_OVER: ASK_OVER, packHits: packHits, allowed: allowed, toolsOf: toolsOf,
               pushLog: pushLog, cents: cents, LOG_MAX: LOG_MAX, PAGE: PAGE };
  if (typeof module !== "undefined" && module.exports) module.exports = core;
  if (!root || !root.document) return;
  root.orosGateCore = core;

  /* ---------- device ---------- */
  function readJSON(k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function writeJSON(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; }
    catch (e) { toast(tr("gate.saveFail")); return false; }   // R30: never silent
  }
  function pref() { var p = readJSON(PREF_KEY); return isObj(p) ? p : { on: false }; }
  function tr(k) { return typeof root.t === "function" ? root.t(k) : k; }
  function toast(text) {
    try { if (root.orosNotifs && root.orosNotifs.transient) root.orosNotifs.transient({ ns: "system", title: text }); } catch (e) {}
  }
  function randomB64u(n) {
    var b = new Uint8Array(n), s = "";
    crypto.getRandomValues(b);
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function sha256hex(s) {
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (x) { return (x < 16 ? "0" : "") + x.toString(16); }).join("");
    });
  }
  // The gate's seat (synced slice "gate", 5.77.00): the gate id, a
  // secret whose hash the gate box keeps, and the relay. Every device
  // of the owner gets it through orOS's encrypted sync and joins the
  // gate with it by itself (act "sit"). The newer seat wins.
  function seatOk(x) {
    return isObj(x) && typeof x.id === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(x.id) &&
      typeof x.ss === "string" && /^[A-Za-z0-9_-]{43}$/.test(x.ss) &&
      typeof x.r === "string" && /^https:\/\/[^\s/?#]+(\/[^\s?#]*)?$/.test(x.r) && typeof x.m === "number" && x.m > 0;
  }
  // k (5.80.00): the gate key, 32 bytes base64url, for the copy and the
  // waiting changes while orOS is closed (relay/gate.js keeps it only
  // wrapped under Claude's live tokens).
  function seatClean(x) {
    if (!seatOk(x)) return null;
    var o = { id: x.id, ss: x.ss, r: x.r, m: Math.floor(x.m) };
    if (typeof x.k === "string" && /^[A-Za-z0-9_-]{43}$/.test(x.k)) o.k = x.k;
    return o;
  }
  function seatMerge(a, b) {
    var A = seatClean(a), B = seatClean(b);
    if (!A || !B) return A || B;
    if (A.m !== B.m) return A.m > B.m ? A : B;
    return JSON.stringify(A) >= JSON.stringify(B) ? A : B;
  }
  // A device joins by scanning the code's QR: "#gate-join=XXXXXXXX".
  function joinHash(h) {
    var m = /^#gate-join=([ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8})$/.exec(String(h || ""));
    return m ? m[1] : "";
  }
  // The relay of this gate: the one it was made on while it is on, else
  // the one orOS uses now.
  // The owner's own relay for the gate (5.82.00, Settings › orOS Gate):
  // a Worker they deployed from relay/ (see relay/README.md), so the
  // gate never uses orOS's shared one. Else Mail's relay, else orOS's.
  var OWN_KEY = "oros-gate-relay";
  function ownRelay() { var u = readJSON(OWN_KEY); return typeof u === "string" && HTTPS_RE.test(u) ? u : ""; }
  var HTTPS_RE = /^https:\/\/[^\s/?#]+(\/[^\s?#]*)?$/;
  function relayNow() { return ownRelay() || relayOf(readJSON("oros-mail-data")); }
  // The owner set a relay of their own here or in Mail.
  function mineRelay() { return !!ownRelay() || relayOf(readJSON("oros-mail-data")) !== RELAY; }
  function relay() { var p = pref(); return p.on && typeof p.r === "string" && p.r ? p.r : relayNow(); }
  function devCall(body, base) {
    return fetch((base || relay()) + "/gate/dev", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return null; }).then(function (j) {
        if (!r.ok || !j || !j.ok) { var e = new Error("gate"); e.code = j && j.error && j.error.code || ("http-" + r.status); throw e; }
        return j.data;
      }); });
  }

  var listeners = [], pendingJoin = "";
  function changed() {
    listeners.slice().forEach(function (fn) { try { fn(); } catch (e) {} });
    if (typeof copySoon === "function") copySoon();
  }

  var ws = null, wsState = "off", retry = 0, retryTimer = null, pingTimer = null, winTimer = null;
  function setWs(s) { if (wsState !== s) { wsState = s; changed(); } }
  function connect() {
    var p = pref();
    if (!p.on || !p.id || !p.tok || ws) return;
    if (isObj(p.lv) && p.lv.kanban === "write") kanbanModel().then(null, function () {});   // Undo needs it at hand
    clearTimeout(retryTimer);
    setWs("connecting");
    var sock;
    try { sock = new WebSocket(relay().replace(/^https:/, "wss:") + "/gate/ws/" + p.id, ["gt1", "t." + p.tok]); }
    catch (e) { schedule(); return; }
    ws = sock;
    sock.onopen = function () {
      retry = 0;
      setWs("on");
      sendVis(sock);
      if (pref().lvd) sendLv(sock);
      else sendBase(sock);
      pushReg();
      copySoon(4000);
      clearInterval(pingTimer);
      pingTimer = setInterval(function () { try { sock.send("ping"); } catch (e) {} }, 45000);
    };
    sock.onmessage = function (ev) {
      if (typeof ev.data !== "string" || ev.data === "pong") return;
      if (ev.data.indexOf('{"lv"') === 0) { onLv(ev.data); return; }
      if (ev.data.indexOf('{"cq"') === 0) { applyQueue(sock, ev.data); return; }
      if (ev.data.indexOf('{"snapok"') === 0) return;
      onCall(sock, ev.data);
    };
    sock.onclose = function (ev) {
      if (ws === sock) ws = null;
      clearInterval(pingTimer);
      // 4001: a newer connection of this gate took over; 4004: the gate is gone.
      if (ev && ev.code === 4004) { setWs("gone"); return; }
      if (ev && ev.code === 4001) { setWs("other"); return; }
      schedule();
    };
    sock.onerror = function () {};
  }
  function chgList() {
    var l = readJSON(CHG_KEY);
    if (!Array.isArray(l)) {                          // before 5.78.00: this device's own undo list
      var old = readJSON(UNDO_KEY);
      l = chgMerge([], (Array.isArray(old) ? old : []).map(function (e) { return isObj(e) ? Object.assign({ k: 0, dv: "" }, e) : null; }));
      if (l.length && writeJSON(CHG_KEY, l)) { try { localStorage.removeItem(UNDO_KEY); } catch (e) {} }
    }
    return chgMerge(l, []);
  }
  function chgSlice(n) {
    var S = root.orosSync;
    if (S && typeof S.registerSlice === "function") {
      S.registerSlice("gatechanges", function () { var raw = null; try { raw = localStorage.getItem(CHG_KEY); } catch (e) {} return raw ? chgList() : null; },
        function (data) { if (!Array.isArray(data)) return; writeJSON(CHG_KEY, chgMerge(data, [])); changed(); }, CHG_KEY, chgMerge);
      return;
    }
    if (n < 40) setTimeout(function () { chgSlice(n + 1); }, 500);
  }
  // "Claude changed something" on the owner's devices (5.78.00): with
  // notifications on (webpush.js), this device gives the gate's box its
  // push box id, a wake token that can only wake it and one generic
  // packet encrypted here; the relay wakes it after a change, at most
  // once per 15 minutes. The details and Undo stay in Claude's changes.
  var PUSH_TXT = { en: "Claude changed something in orOS", el: "Ο Claude έκανε αλλαγές στο orOS", de: "Claude hat etwas in orOS geändert" };
  var pushBusy = false;
  function pushReg() {
    var P = root.orosPush, p = pref();
    if (pushBusy || !p.on || !p.id || !p.tok || !P || typeof P.wakeToken !== "function") return;
    var want = P.enabled && P.enabled() ? P.deviceId() : "";
    var pp = isObj(p.pp) ? p.pp : null;
    if (want ? pp && pp.pid === want && pp.g === p.id : !pp) return;
    var lang = "en";
    try { lang = String(root.orosI18n && root.orosI18n.lang ? root.orosI18n.lang() : "en").slice(0, 2); } catch (e) {}
    pushBusy = true;
    var done = function (np) {
      pushBusy = false;
      var q = pref();
      if (!q.on || q.id !== p.id) return;
      if (np) q.pp = np; else delete q.pp;
      writeJSON(PREF_KEY, q);
    };
    if (!want) {
      devCall({ act: "ping", id: p.id, tok: p.tok, pid: "" }).then(function () {
        if (pp.wt && typeof P.dropWake === "function") P.dropWake(pp.wt).catch(function () {});
        done(null);
      }, function () { pushBusy = false; });
      return;
    }
    Promise.resolve(pp && pp.pid === want && pp.wt ? pp.wt : P.wakeToken()).then(function (wt) {
      return P.wakePacket("gate:changes", "orOS Gate", PUSH_TXT[lang] || PUSH_TXT.en, "gate:changes", "gate").then(function (ct) {
        return devCall({ act: "ping", id: p.id, tok: p.tok, pid: want, wt: wt, ct: ct }).then(function () { done({ pid: want, wt: wt, g: p.id }); });
      });
    }).catch(function () { pushBusy = false; });
  }
  // ---- the daily email (5.79.00): from the owner's own Mail account to
  // itself, sent by the first device that is open after 20:00 on a day
  // Claude changed something. It claims the day in the synced slice
  // "gatedigest", waits for sync to carry the claim, and sends only if it
  // still holds it. No key or address reaches the relay's gate.
  var digTimer = null, digBusy = false;
  function digRead() { return digClean(readJSON(DIG_KEY)); }
  function digWrite(v) { if (writeJSON(DIG_KEY, digClean(v))) { dirty(); changed(); return true; } return false; }
  function digTag() {
    var p = pref();
    if (typeof p.dt === "string" && /^[A-Za-z0-9_-]{8,24}$/.test(p.dt)) return p.dt;
    p.dt = randomB64u(9).slice(0, 12);
    writeJSON(PREF_KEY, p);
    return p.dt;
  }
  function mailData() { var d = readJSON("oros-mail-data"); return isObj(d) && Array.isArray(d.accounts) ? d : null; }
  // Mail accounts that can send (as Certificates and Newsletter read them).
  function sendAccounts() {
    var d = mailData();
    if (!d) return [];
    var tombs = isObj(d.tombs) ? d.tombs : {};
    return d.accounts.filter(function (a) {
      return isObj(a) && typeof a.id === "string" && ACCT_RE.test(a.id) && a.imap && a.imap.host && a.smtp && a.smtp.host && a.email && !(tombs[a.id] >= a.m);
    }).map(function (a) { return { id: a.id, email: String(a.email), name: String(a.name || "").trim(), a: a }; });
  }
  function mailPass(acctId) {
    return new Promise(function (resolve) {
      var rq;
      try { rq = indexedDB.open("oros-mail"); } catch (e) { resolve(null); return; }
      rq.onupgradeneeded = function () { try { rq.transaction.abort(); } catch (e) {} };
      rq.onerror = function (e) { if (e && e.preventDefault) e.preventDefault(); resolve(null); };
      rq.onblocked = function () { resolve(null); };
      rq.onsuccess = function () {
        var d = rq.result;
        if (!d.objectStoreNames.contains("keys") || !d.objectStoreNames.contains("creds")) { d.close(); resolve(null); return; }
        var tx = d.transaction(["keys", "creds"], "readonly");
        var get = function (st, k) { return new Promise(function (ok, no) { var r = tx.objectStore(st).get(k); r.onsuccess = function () { ok(r.result); }; r.onerror = function (e) { if (e && e.preventDefault) e.preventDefault(); no(r.error); }; }); };
        Promise.all([get("keys", "device"), get("creds", acctId)]).then(function (r) {
          d.close();
          var key = r[0], rec = r[1];
          if (!key || !rec || !rec.iv || !rec.data) return null;
          return crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(rec.iv) }, key, rec.data).then(function (plain) { return new TextDecoder().decode(plain); });
        }).then(resolve, function () { try { d.close(); } catch (e) {} resolve(null); });
      };
    });
  }
  function mailSend(acc, subject, text) {
    var MC = root.orosMailCompose;
    if (!MC || typeof MC.build !== "function") return Promise.reject({ code: "nocompose" });
    return mailPass(acc.id).then(function (pw) {
      if (!pw) throw { code: "nopass" };
      var a = acc.a, user = a.imap.user || a.email;
      var me = { name: acc.name || "orOS", addr: acc.email };
      return Promise.resolve(MC.build({ from: me, to: [me], subject: subject, text: text })).then(function (m) {
        return fetch(relayNow() + "/v1", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer",
          body: JSON.stringify({ op: "send", acct: { host: a.imap.host, port: a.imap.port, sec: a.imap.sec, user: user, pass: pw },
                                 smtp: { host: a.smtp.host, port: a.smtp.port, sec: a.smtp.sec, user: a.smtp.user || user, pass: pw },
                                 from: acc.email, rcpt: [acc.email], raw: MC.b64(m && m.bin !== undefined ? m.bin : m) }) });
      }).then(function (r) { return r.json().catch(function () { return null; }); }).then(function (j) {
        if (!j || !j.ok) throw { code: (j && j.error && j.error.code) || "relay" };
      });
    });
  }
  function digLang() {
    var l = "en";
    try { l = String(root.orosI18n && root.orosI18n.lang ? root.orosI18n.lang() : "en").slice(0, 2); } catch (e) {}
    return l === "el" || l === "de" ? l : "en";
  }
  function digCheck() {
    var now = Date.now(), dg = digRead();
    if (digBusy || !digDue(dg, chgList(), now)) return;
    if (root.orosLock && root.orosLock.isLocked && root.orosLock.isLocked()) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    var accs = sendAccounts(), acc = accs.filter(function (a) { return a.id === dg.acct; })[0] || accs[0];
    if (!acc) return;                                 // Settings says a Mail account is needed
    var day = ymd(now), tag = digTag();
    dg.d = day; dg.dv = tag;
    if (!digWrite(dg)) return;
    digBusy = true;
    setTimeout(function () {                          // let sync carry the claim; another device may hold it
      var cur = digRead();
      if (cur.d !== day || cur.dv !== tag) { digBusy = false; return; }
      var m = digText(chgList(), now, digLang());
      mailSend(acc, m.subject, m.text).then(function () {
        var c = digRead(); c.at = Date.now(); digWrite(c); digBusy = false;
      }, function (e) {
        var c = digRead();
        if (c.d === day && c.dv === tag) c.d = "";     // give the day back: next check, at most 3 times today
        c.fn = c.fd === day ? (c.fn || 0) + 1 : 1; c.fd = day;
        digWrite(c);
        digBusy = false;
      });
    }, 90000);
  }
  function digSlice(n) {
    var S = root.orosSync;
    if (S && typeof S.registerSlice === "function") {
      S.registerSlice("gatedigest", function () { var raw = null; try { raw = localStorage.getItem(DIG_KEY); } catch (e) {} return raw ? digRead() : null; },
        function (data) { if (!isObj(data)) return; writeJSON(DIG_KEY, digMerge(digRead(), data)); changed(); }, DIG_KEY, digMerge);
      return;
    }
    if (n < 40) setTimeout(function () { digSlice(n + 1); }, 500);
  }
  // ---- orOS closed (5.80.00) ----
  // The copy: the answers this device would give Claude now (list_apps,
  // the summaries, the lists with their default filters), for the allowed
  // apps only, encrypted with the gate key, sent to the gate's box after
  // a change and every 30 minutes. While no device is open Claude reads
  // it; changes wait (encrypted) and the first device that opens applies
  // them. The relay wipes it all after 7 days without an open device.
  function gateKey() { var p = pref(), st = seatRead(); return st && st.id === p.id && st.k ? st.k : ""; }
  function keyBytes(k) {
    var t = k.replace(/-/g, "+").replace(/_/g, "/"), bin = atob(t + "===".slice((t.length + 3) % 4)), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function bytesB64u(b) { var s = ""; for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
  function seal(k, text) {
    var iv = crypto.getRandomValues(new Uint8Array(12));
    return crypto.subtle.importKey("raw", keyBytes(k), { name: "AES-GCM" }, false, ["encrypt"]).then(function (key) {
      return crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, new TextEncoder().encode(text));
    }).then(function (ct) { return bytesB64u(iv) + "." + bytesB64u(new Uint8Array(ct)); });
  }
  function unseal(k, sealed) {
    var parts = String(sealed || "").split(".");
    return crypto.subtle.importKey("raw", keyBytes(k), { name: "AES-GCM" }, false, ["decrypt"]).then(function (key) {
      return crypto.subtle.decrypt({ name: "AES-GCM", iv: keyBytes(parts[0]) }, key, keyBytes(parts[1] || ""));
    }).then(function (pt) { return new TextDecoder().decode(pt); });
  }
  var COPY_MAX = 600000, copyTimer = null, copyBusy = false, copyLast = "", copyAt = 0;
  function copySoon(ms) { clearTimeout(copyTimer); copyTimer = setTimeout(sendCopy, typeof ms === "number" ? ms : 5000); }
  function sendCopy() {
    var p = pref(), k = gateKey();
    if (copyBusy || !p.on || !k || !ws || ws.readyState !== 1) return;
    if (root.orosLock && root.orosLock.isLocked && root.orosLock.isLocked()) return;
    copyBusy = true;
    var ok = allowed(offered(), p.lv).map(function (a) { return a.id; });
    var d = new Date(), month = d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2);
    var pd = new Date(d.getFullYear(), d.getMonth() - 1, 1), prev = pd.getFullYear() + "-" + ("0" + (pd.getMonth() + 1)).slice(-2);
    var calls = [["list_apps", {}]];
    ok.forEach(function (id) {
      if (SUMMARY[id]) {
        calls.push(["app_summary", { app: id }]);
        if (id !== "kanban") { calls.push(["app_summary", { app: id, month: month }]); calls.push(["app_summary", { app: id, month: prev }]); }
      }
      // GATE-ACT: the everyday apps' summaries (the frame answers them)
      else if (ACT.indexOf(id) >= 0) calls.push(["app_summary", { app: id }]);
      // budget_lines needs a range: the copy has this and last month, also
      // kept as the tool's default answer.
      if (LINES[id]) calls.push([LINES[id], id === "budget" ? { from: prev + "-01", to: localDay(), _def: 1 } : {}]);
    });
    var ans = {}, size = 0;
    calls.reduce(function (chain, c) {
      return chain.then(function () {
        var a = Object.assign({}, c[1]), def = !!a._def;
        delete a._def;
        return run(c[0], a).then(function (r) {
          if (!r || !r.ok || typeof r.c !== "string" || size + r.c.length > COPY_MAX) return;
          ans[c[0] + " " + stableArgs(a)] = r.c; size += r.c.length;
          if (def) ans[c[0] + " {}"] = r.c;
        }, function () {});
      });
    }, Promise.resolve()).then(function () {
      var body = JSON.stringify({ lv: p.lv || {}, hold: typeof p.hold === "number" ? p.hold : 0, ans: ans });
      if (body === copyLast && Date.now() - copyAt < 6 * 3600000) return;      // nothing new
      return seal(k, JSON.stringify({ at: Date.now(), lv: p.lv || {}, hold: typeof p.hold === "number" ? p.hold : 0, ans: ans })).then(function (sealed) {
        if (!ws || ws.readyState !== 1) return;
        ws.send(JSON.stringify({ snap: sealed }));
        copyLast = body; copyAt = Date.now();
      });
    }).then(function () { copyBusy = false; }, function () { copyBusy = false; });
  }
  // Changes Claude left while orOS was closed: applied here, in order,
  // with the same rules as a live call (the switches and a pause as they
  // are now), then the box is told which ones are done.
  function applyQueue(sock, text) {
    var o, k = gateKey();
    try { o = JSON.parse(text); } catch (e) { return; }
    if (!isObj(o) || !Array.isArray(o.cq) || !k || !pref().on) return;
    whenUnlocked(function () {
      var done = [];
      o.cq.slice(0, 50).reduce(function (chain, it) {
        return chain.then(function () {
          if (!isObj(it) || typeof it.id !== "string") return;
          return unseal(k, it.c).then(function (plain) {
            var x = JSON.parse(plain);
            if (!isObj(x) || typeof x.n !== "string" || QUEUED.indexOf(x.n) < 0) return { ok: false, c: "refused" };
            return run(x.n, x.a).then(function (res) {
              var entry = { t: Date.now(), n: String(x.n).slice(0, 20), a: (res.a || []).slice(0, 10), k: res.k || 0, ok: res.ok ? 1 : 0, q: 1 };
              if (res.u) entry.u = res.u;
              writeJSON(LOG_KEY, pushLog(readJSON(LOG_KEY), entry));
              return res;
            });
          }).then(function () { done.push(it.id); }, function () { done.push(it.id); });   // never in a loop
        });
      }, Promise.resolve()).then(function () {
        try { if (sock.readyState === 1) sock.send(JSON.stringify({ cqa: done })); } catch (e) {}
        changed();
        copySoon(2000);
      });
    });
  }
  function seatRead() { return seatClean(readJSON(SEAT_KEY)); }
  function dirty() { try { if (root.orosSync && typeof root.orosSync.markDirty === "function") root.orosSync.markDirty(); } catch (e) {} }
  // This device has the gate: give the owner's other devices its seat.
  function makeSeat() {
    var p = pref(), cur = seatRead();
    if (!p.on || !p.id || !p.tok) return;
    if (cur && cur.id === p.id) {
      if (!cur.k) { cur.k = randomB64u(32); cur.m = Date.now(); if (writeJSON(SEAT_KEY, cur)) dirty(); }   // a seat from before 5.80.00
      return;
    }
    if (cur && cur.m > (p.at || 0)) return;            // a newer gate of the owner: leave it
    var ss = randomB64u(32);
    sha256hex(ss).then(function (sh) { return devCall({ act: "seat", id: p.id, tok: p.tok, sh: sh }); }).then(function () {
      var q = pref();
      if (!q.on || q.id !== p.id) return;
      if (writeJSON(SEAT_KEY, { id: p.id, ss: ss, r: relay(), m: Date.now(), k: randomB64u(32) })) dirty();
    }, function () {});
  }
  // Join the gate from its seat (no code). force: the owner turned the
  // switch on here; else only when this device was never turned off.
  // → Promise<boolean> (true = joined).
  var sitBusy = false;
  function sit(force) {
    var p = pref(), seat = seatRead();
    if (sitBusy || p.on || !seat || (!force && (p.out || p.sf === seat.m))) return Promise.resolve(false);
    if (root.orosLock && root.orosLock.isLocked && root.orosLock.isLocked() && !force) return Promise.resolve(false);
    sitBusy = true;
    var tok = randomB64u(32);
    return sha256hex(tok).then(function (th) { return devCall({ act: "sit", id: seat.id, ss: seat.ss, th: th }, seat.r); }).then(function (d) {
      sitBusy = false;
      var lv = lvFrom(d && d.lv);
      var np = { on: true, id: seat.id, tok: tok, r: seat.r, at: Date.now(), lv: Object.keys(lv).length ? lv : (isObj(p.lv) ? p.lv : {}) };
      if (!writeJSON(PREF_KEY, np)) return false;
      if (np.lv.kanban === "write") kanbanModel().then(null, function () {});
      changed();
      connect();
      return true;
    }, function () {
      sitBusy = false;
      var q = pref(); q.sf = seat.m;                  // this seat failed here: not again until a new one comes
      writeJSON(PREF_KEY, q);
      return false;
    });
  }
  function seatGet() { var raw = null; try { raw = localStorage.getItem(SEAT_KEY); } catch (e) {} return raw ? seatRead() : null; }
  function seatSet(data) {
    var v = seatClean(data);
    if (!v) return;
    var cur = seatRead();
    if (cur && JSON.stringify(cur) === JSON.stringify(v)) return;
    writeJSON(SEAT_KEY, v);                            // pulled: never markDirty
    setTimeout(function () { sit(false); }, 0);
  }
  function seatSlice(n) {
    var S = root.orosSync;
    if (S && typeof S.registerSlice === "function") { S.registerSlice("gate", seatGet, seatSet, SEAT_KEY, seatMerge); return; }
    if (n < 40) setTimeout(function () { seatSlice(n + 1); }, 500);
  }
  // The app switches are shared by the gate's devices (5.77.00): a
  // change here goes to the relay, which passes it to the others; one
  // made while offline (lvd) goes on the next connection and wins.
  function sendLv(sock) {
    var p = pref();
    try {
      if (!sock || sock.readyState !== 1) return;
      sock.send(JSON.stringify({ lv: isObj(p.lv) ? p.lv : {} }));
      delete p.lvd;
      writeJSON(PREF_KEY, p);
    } catch (e) {}
  }
  // Switches set before 5.77.00 never reached the box: offer them once on
  // each connection; the box keeps them only if it has none.
  function sendBase(sock) {
    var p = pref();
    try { if (sock && sock.readyState === 1 && isObj(p.lv) && Object.keys(p.lv).length) sock.send(JSON.stringify({ lv: p.lv, base: 1 })); } catch (e) {}
  }
  function onLv(text) {
    var o;
    try { o = JSON.parse(text); } catch (e) { return; }
    var p = pref();
    if (!isObj(o) || !p.on || p.lvd) return;
    var lv = lvFrom(o.lv);
    if (JSON.stringify(lv) === JSON.stringify(isObj(p.lv) ? p.lv : {})) return;
    p.lv = lv;
    if (!writeJSON(PREF_KEY, p)) return;
    if (lv.kanban === "write") kanbanModel().then(null, function () {});
    changed();
  }
  // The relay asks a device whose orOS is on screen first (5.73.00):
  // a phone in the background loses its socket, a computer keeps it.
  function sendVis(sock) {
    try { if (sock && sock.readyState === 1) sock.send(document.visibilityState === "hidden" ? "v0" : "v1"); } catch (e) {}
  }
  try {
    document.addEventListener("visibilitychange", function () {
      if (ws) { sendVis(ws); return; }
      if (document.visibilityState === "visible" && pref().on && wsState !== "gone") { retry = 0; clearTimeout(retryTimer); connect(); }
    });
  } catch (e) {}
  function schedule() {
    if (!pref().on) { setWs("off"); return; }
    setWs("connecting");
    retry = Math.min(retry + 1, 6);
    clearTimeout(retryTimer);
    retryTimer = setTimeout(connect, [2, 4, 8, 15, 30, 60][retry - 1] * 1000);
  }
  function drop() {
    clearTimeout(retryTimer); clearInterval(pingTimer);
    if (ws) { var s = ws; ws = null; try { s.close(1000, "off"); } catch (e) {} }
    setWs("off");
  }

  function offered() {
    try { return typeof root.orosAssistApps === "function" ? root.orosAssistApps() : []; } catch (e) { return []; }
  }
  function appNames(list) { var n = {}; list.forEach(function (a) { n[a.id] = a.name; }); return n; }
  function readStore(k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }

  var summaryP = null;
  function summary() {
    if (root.OrosAssistSummary) return Promise.resolve(root.OrosAssistSummary);
    if (!summaryP) {
      summaryP = new Promise(function (ok, no) {
        var s = document.createElement("script");
        var v = root.orosTodayEnv && root.orosTodayEnv.version ? "?v=" + encodeURIComponent(root.orosTodayEnv.version) : "";
        s.src = "assistant/summary.js" + v;
        s.onload = function () { root.OrosAssistSummary ? ok(root.OrosAssistSummary) : no(new Error("summary")); };
        s.onerror = function () { summaryP = null; no(new Error("summary")); };
        document.head.appendChild(s);
      });
    }
    return summaryP;
  }

  function localDay() {
    var t = new Date();
    return t.getFullYear() + "-" + ("0" + (t.getMonth() + 1)).slice(-2) + "-" + ("0" + t.getDate()).slice(-2);
  }

  // One call from Claude → { ok, c (text), a (apps), k (items) }.
  function run(name, args) {
    if (root.orosLock && typeof root.orosLock.isLocked === "function" && root.orosLock.isLocked()) {
      return Promise.resolve({ ok: false, c: "orOS is locked on the owner's device. Ask the owner to unlock it." });
    }
    var p = pref();
    var all = offered(), ok = allowed(all, p.lv), names = appNames(all), okIds = ok.map(function (a) { return a.id; });
    args = isObj(args) ? args : {};
    if (name === "list_apps") {
      return Promise.resolve({ ok: true, a: [], k: ok.length, c: JSON.stringify({
        apps: ok.map(function (a) {
          var o = { id: a.id, name: a.name, tools: toolsOf(a.id) };
          if (p.lv[a.id] === "write" && writable(a.id)) {
            o.change_tools = WRITES[a.id] ? WRITES[a.id].slice() : DOCS.indexOf(a.id) >= 0 ? DOC_WRITE.slice() : ACT_WRITE.filter(function (n) { return n !== "edit_in_app"; });
            o.changes = canWrite(p.lv, p.hold, a.id, Date.now()) ? "allowed (the owner is notified of each change)" : "paused by the owner until " + new Date(p.hold).toISOString();
          }
          return o;
        }),
        note: ok.length ? "Find items with search_data or app_summary (each item has a ref), then change them by ref. The owner is notified of each change and can undo it." : "The owner has not allowed any app yet (orOS › Settings › Connected services › orOS Gate)."
      }) });
    }
    if (name === "__tools") {
      return actFrame().then(function (F) {
        var list = [];
        try { list = F ? F.tools() || [] : []; } catch (e) { list = []; }
        return { ok: true, c: JSON.stringify(list), quiet: 1 };
      });
    }
    var budgetish = name === "app_summary" && (args.app === "budget" || args.app === "stock" || args.app === "kanban");
    if (ACT_TOOLS.indexOf(name) >= 0 && !budgetish) {
      if ((ACT_WRITE.indexOf(name) >= 0 || name === "do_action" || ACT_OPEN.indexOf(name) >= 0) && !ok.some(function (a) { return p.lv[a.id] === "write" && actable(a.id); })) {
        return Promise.resolve({ ok: false, c: "The owner lets Claude change none of these apps (orOS › Settings › Connected services › orOS Gate: «Claude may also change …» per app)." });
      }
      return actFrame().then(function (F) {
        if (!F) {
          if (name === "search_data") return own();
          return { ok: false, c: "orOS could not start its tools on the device; try again in a moment." };
        }
        var now = Date.now();
        return F.run(name, args).then(function (r) {
          var out = { ok: !!r.ok, c: r.c || "", a: Array.isArray(r.a) ? r.a : [], k: r.k || 0 };
          // One record per change (5.78.00 remember): synced, notified, in
          // the daily email; x = the Assistant's change id and its undo
          // data, so Undo works from any device (actUndo).
          if (r.ok && r.u && ACT_WRITE.indexOf(name) >= 0) {
            out.u = remember(out.a[0] || String(args.app || ""), name, { a: String(r.u), m: isObj(r.x) ? r.x : null }, now, out.k);
          }
          // undo_change: the gate's records of what it undid are done too
          if (r.ok && Array.isArray(r.ud) && r.ud.length) actDone(r.ud.map(String));
          return out;
        });
      });
    }
    return own();
    function own() {
    if (name === "search_data") {
      var q = String(args.query || "").replace(/\s+/g, " ").trim().slice(0, 200);
      if (!q) return Promise.resolve({ ok: false, c: "query is empty." });
      var ids = okIds;
      if (Array.isArray(args.apps) && args.apps.length) {
        var want = args.apps.slice(0, 50).map(function (x) { return String(x).toLowerCase(); });
        ids = okIds.filter(function (id) { return want.indexOf(id) >= 0; });
      }
      if (!ids.length) return Promise.resolve({ ok: false, c: "None of these apps may be read. Call list_apps." });
      if (typeof root.orosAssistSearch !== "function") return Promise.resolve({ ok: false, c: "Search is not available on this device." });
      return Promise.resolve(root.orosAssistSearch(q, ids)).then(function (groups) {
        var items = packHits(groups, names);
        var used = [];
        items.forEach(function (it) { if (used.indexOf(it.app) < 0) used.push(it.app); });
        return { ok: true, a: used, k: items.length, c: JSON.stringify({ query: q, items: items }) };
      });
    }
    if (name === "app_summary") {
      var app = String(args.app || "");
      if (!SUMMARY[app]) return Promise.resolve({ ok: false, c: "app must be budget, stock or kanban." });
      if (okIds.indexOf(app) < 0) return Promise.resolve({ ok: false, c: "The owner does not let Claude read " + app + "." });
      return summary().then(function (S) {
        var n = S.normArgs({ app: app, month: args.month, board: args.board }, localDay());
        if (!n.ok) return { ok: false, c: n.err };
        var lang = (root.orosLang || "en").slice(0, 2);
        var out = app === "budget" ? S.budgetMonth(readStore("oros-budget-data"), n.month, lang)
                : app === "stock" ? S.stockMonth(readStore("oros-stock-data"), n.month, lang)
                : S.kanbanBoards(readStore("oros-kanban-data"), { board: n.board, today: localDay() });
        if (out && out.ok === false) return { ok: false, c: out.err };
        return { ok: true, a: [app], k: out && out.items ? out.items.length : 1, c: JSON.stringify(out) };
      });
    }
    var line = null;
    Object.keys(LINES).forEach(function (id) { if (LINES[id] === name) line = id; });
    if (line) {
      if (okIds.indexOf(line) < 0) return Promise.resolve({ ok: false, c: "The owner does not let Claude read " + (names[line] || line) + "." });
      var r;
      if (line === "budget") r = budgetLines(readStore("oros-budget-data"), args);
      else if (line === "invoices") r = root.OrosInvoicesCore ? invoiceList(root.OrosInvoicesCore, readStore("oros-invoices-data"), args, localDay()) : null;
      else if (line === "stock") r = root.OrosStockCore ? stockItems(root.OrosStockCore, readStore("oros-stock-data"), args) : null;
      else r = publishTitles(readStore("oros-publish-data"), args);
      if (!r) return Promise.resolve({ ok: false, c: "This app is not loaded on the device yet; try again in a moment." });
      if (!r.ok) return Promise.resolve({ ok: false, c: r.err });
      var dd = r.data, k = (dd.lines || dd.documents || dd.items || dd.titles || []).length;
      return Promise.resolve({ ok: true, a: [line], k: k, c: JSON.stringify(dd) });
    }
    var op = { budget_add: "add", budget_change: "change", budget_delete: "delete" }[name];
    if (op) return change(op, args, p, names);
    var kop = { kanban_add_cards: "add_cards", kanban_move_cards: "move_cards", kanban_change_card: "change_card", kanban_add_columns: "add_columns" }[name];
    if (kop) return kanbanChange(kop, args, p, names);
    return Promise.resolve({ ok: false, c: "Unknown tool." });
    }
  }

  /* ---------- GATE-ACT: the Assistant's tools in a hidden frame ---------- */
  var actP = null, actReady = null, actEl = null;
  function actFrame() {
    if (actEl && actEl.contentWindow && actEl.contentWindow.__asGate) return Promise.resolve(actEl.contentWindow.__asGate);
    if (actP) return actP;
    actP = new Promise(function (resolve) {
      var t = setTimeout(function () { done(null); }, 20000);
      function done(v) { clearTimeout(t); actReady = null; if (!v) { actP = null; if (actEl) { actEl.remove(); actEl = null; } } resolve(v); }
      actReady = function () { done(actEl && actEl.contentWindow ? actEl.contentWindow.__asGate || null : null); };
      try {
        var v = root.orosTodayEnv && root.orosTodayEnv.version ? encodeURIComponent(root.orosTodayEnv.version) : "";
        actEl = document.createElement("iframe");
        actEl.setAttribute("aria-hidden", "true");
        actEl.setAttribute("tabindex", "-1");
        actEl.title = "orOS Gate";
        actEl.style.cssText = "position:fixed;width:1px;height:1px;left:-9999px;top:0;border:0;opacity:0;pointer-events:none";
        actEl.src = "assistant/index.html?gate=1" + (v ? "&v=" + v : "");
        document.body.appendChild(actEl);
      } catch (e) { done(null); }
    });
    return actP;
  }
  function actDrop() { if (actEl) { actEl.remove(); actEl = null; } actP = null; }
  // Marks the records of these Assistant change ids done (undone).
  function actDone(ids) {
    var l = chgList(), hit = l.filter(function (e) { return !e.done && isObj(e.x) && ids.indexOf(String(e.x.a)) >= 0; });
    if (!hit.length) return;
    if (writeJSON(CHG_KEY, chgMerge(l, hit.map(function (e) { return Object.assign({}, e, { done: Date.now() }); })))) dirty();
    changed();
  }
  // Undo of a change made with the Assistant's tools → Promise<{ ok, n }>
  // (any device: the frame runs the stored undo data when the change
  // was made elsewhere; a document's undo stays on the device that made it).
  function actUndo(e) {
    return actFrame().then(function (F) {
      if (!F || typeof F.undo !== "function") return { ok: false };
      return Promise.resolve(F.undo(String(e.x.a), e.x.m || null)).then(function (ok) {
        if (!ok) return { ok: false };
        actDone([String(e.x.a)]);
        return { ok: true, n: e.k || 1, kept: 0 };
      });
    }, function () { return { ok: false }; });
  }

  function closedMsg(p, id, name) {
    if (p.lv[id] === "write" && typeof p.hold === "number" && p.hold > Date.now()) {
      return "The owner paused Claude's changes until " + new Date(p.hold).toISOString() + ". Nothing was changed.";
    }
    return "Claude may not change " + name + ". Ask the owner to set " + name + " to «may change» in orOS › Settings › Connected services › orOS Gate.";
  }
  function newTxId() {
    var r = new Uint32Array(1);
    crypto.getRandomValues(r);
    return Date.now().toString(36) + (r[0] % 46656).toString(36);   // = budget.js newId
  }
  function change(op, args, p, names) {
    var now = Date.now();
    if (!canWrite(p.lv, p.hold, "budget", now)) {
      return Promise.resolve({ ok: false, c: closedMsg(p, "budget", names.budget || "Budget") });
    }
    var n = op === "delete" && Array.isArray(args.ids) ? args.ids.length : 0;
    var asked = n > ASK_OVER && n <= 100 ? askDelete(n) : Promise.resolve(true);
    return asked.then(function (yes) {
      if (!yes) return { ok: false, c: "The owner did not confirm deleting " + n + " entries on the device; nothing was deleted." };
      var r = budgetWrite(op, readStore("oros-budget-data"), args, Date.now(), newTxId);
      if (!r.ok) return { ok: false, c: r.err };
      if (!writeJSON("oros-budget-data", r.data)) return { ok: false, c: "orOS could not save the change on the device; nothing was changed." };
      try { if (root.orosSync && typeof root.orosSync.markDirty === "function") root.orosSync.markDirty(); } catch (e) {}
      var uid = remember("budget", "budget_" + op, r.undo, now, r.ids.length);
      return { ok: true, a: ["budget"], k: r.ids.length, u: uid, c: JSON.stringify({ done: r.text, ids: r.ids }) };
    });
  }
  // Kanban's sync model (kanban/model.js), loaded on first use.
  var modelP = null;
  function kanbanModel() {
    if (root.OrosKanbanModel) return Promise.resolve(root.OrosKanbanModel);
    if (!modelP) {
      modelP = new Promise(function (ok, no) {
        var s = document.createElement("script");
        var v = root.orosTodayEnv && root.orosTodayEnv.version ? "?v=" + encodeURIComponent(root.orosTodayEnv.version) : "";
        s.src = "kanban/model.js" + v;
        s.onload = function () { root.OrosKanbanModel ? ok(root.OrosKanbanModel) : no(new Error("model")); };
        s.onerror = function () { modelP = null; no(new Error("model")); };
        document.head.appendChild(s);
      });
    }
    return modelP;
  }
  function kbId() { return Date.now().toString(36) + randomB64u(6).replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 5); }   // = kanban.js uid
  function devName() {
    var n = "";
    try { var P = root.orosPush, me = P && P.devices ? P.devices().filter(function (d) { return d.self; })[0] : null; n = me && me.name || ""; } catch (e) {}
    if (!n) { try { n = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || ""; } catch (e) {} }
    return String(n).slice(0, 40);
  }
  function remember(app, n, x, now, k) {
    var uid = now.toString(36) + randomB64u(3).replace(/[^a-z0-9]/gi, "").toLowerCase();
    var cl = chgMerge(readJSON(CHG_KEY), [{ id: uid, t: now, app: app, n: n, k: k || 0, dv: devName(), x: x }]);
    if (writeJSON(CHG_KEY, cl)) dirty();
    return uid;
  }
  function kanbanChange(op, args, p, names) {
    var now = Date.now();
    if (!canWrite(p.lv, p.hold, "kanban", now)) {
      return Promise.resolve({ ok: false, c: closedMsg(p, "kanban", names.kanban || "Kanban") });
    }
    return kanbanModel().then(function (M) {
      var r = kanbanWrite(M, op, readStore("oros-kanban-data"), args, Date.now(), kbId);
      if (!r.ok) return { ok: false, c: r.err };
      if (!writeJSON("oros-kanban-data", r.data)) return { ok: false, c: "orOS could not save the change on the device; nothing was changed." };
      try { if (root.orosSync && typeof root.orosSync.markDirty === "function") root.orosSync.markDirty(); } catch (e) {}
      var uid = remember("kanban", "kanban_" + op, r.undo, now, r.ids.length);
      return { ok: true, a: ["kanban"], k: r.ids.length, u: uid, c: JSON.stringify({ done: r.text, ids: r.ids }) };
    }, function () { return { ok: false, c: "Kanban is not loaded on the device yet; try again in a moment." }; });
  }
  // More than ASK_OVER deletions: the owner says yes on the device
  // within 20 s (the relay waits 25 s for the answer).
  function askDelete(n) {
    return new Promise(function (ok) {
      var settled = false, wrap = null;
      function end(v) { if (settled) return; settled = true; if (wrap) wrap.remove(); ok(v); }
      if (document.visibilityState !== "visible" || (root.orosLock && root.orosLock.isLocked && root.orosLock.isLocked())) { end(false); return; }
      wrap = dialog(tr("gate.del.title"), tr("gate.del.body").replace("{n}", String(n)), "", tr("gate.del.no"), tr("gate.del.yes"),
        function () { end(false); }, function () { end(true); });
      setTimeout(function () { end(false); }, 20000);
    });
  }

  function onCall(sock, text) {
    var q;
    try { q = JSON.parse(text); } catch (e) { return; }
    if (!isObj(q) || typeof q.q !== "string" || typeof q.n !== "string") return;
    var p = pref();
    var done = function (res) {
      var c = typeof res.c === "string" ? res.c : "";
      if (c.length > 880000) { res = { ok: false, c: "The answer is too big; ask for a shorter period or fewer apps." }; c = res.c; }
      try { sock.send(JSON.stringify({ r: q.q, ok: !!res.ok, c: c })); } catch (e) {}
      if (res.quiet) return;
      var entry = { t: Date.now(), n: q.n.slice(0, 20), a: (res.a || []).slice(0, 10), k: res.k || 0, ok: res.ok ? 1 : 0 };
      if (res.u) entry.u = res.u;
      writeJSON(LOG_KEY, pushLog(readJSON(LOG_KEY), entry));
      changed();
    };
    if (q.n === "_key") {                              // the relay wraps it for a token of Claude's; not logged
      var k = gateKey();
      var locked = root.orosLock && root.orosLock.isLocked && root.orosLock.isLocked();
      try { sock.send(JSON.stringify({ r: q.q, ok: !!(p.on && k && !locked), c: p.on && k && !locked ? k : "" })); } catch (e) {}
      return;
    }
    if (!p.on) { done({ ok: false, c: "The gate is off." }); return; }
    run(q.n, q.a).then(done, function () { done({ ok: false, c: "The call failed on the device." }); });
  }

  /* ---------- API for Settings ---------- */
  var api = {
    // For the hidden Assistant frame (assistant.js GATE).
    frameReady: function () { if (actReady) actReady(); },
    act: ACT.concat(DOCS),
    levels: function () {
      var p = pref(), out = {};
      if (!p.on || !isObj(p.lv)) return out;
      Object.keys(p.lv).forEach(function (id) { if (NEVER.indexOf(id) < 0 && (p.lv[id] === "read" || p.lv[id] === "write")) out[id] = p.lv[id]; });
      return out;
    },
    // "" = Claude may change this app now; else why not (sent to Claude).
    writeOk: function (id) {
      var p = pref(), now = Date.now();
      if (!p.on) return "The gate is off.";
      if (root.orosLock && typeof root.orosLock.isLocked === "function" && root.orosLock.isLocked()) return "orOS is locked on the owner's device.";
      if (!id || !actable(id) || !isObj(p.lv) || p.lv[id] !== "write") return "The owner does not let Claude change " + (id || "this app") + " (orOS › Settings › Connected services › orOS Gate).";
      if (!canWrite(p.lv, p.hold, id, now)) return closedMsg(p, id, id);
      return "";
    },
    // do_action (W5): "" = Claude may do it now in this app; else why not.
    actionOk: function (id) {
      var p = pref(), now = Date.now();
      if (!p.on) return "The gate is off.";
      if (root.orosLock && typeof root.orosLock.isLocked === "function" && root.orosLock.isLocked()) return "orOS is locked on the owner's device.";
      if (!id || NEVER.indexOf(id) >= 0) return "Claude may never open " + (id || "this app") + ".";
      if (typeof p.hold === "number" && p.hold > now) return "The owner paused Claude's changes until " + new Date(p.hold).toISOString() + ". Nothing was done.";
      return "";
    },
    askDelete: function (n) { return askDelete(n); },
    relayUrl: function () { return relay() + "/mcp"; },
    // The relay this gate runs on, and which kind: own | mail | shared.
    relayInfo: function () {
      var r = relay(), own = ownRelay();
      return { url: r, own: own, mine: mineRelay(), kind: own && r === own ? "own" : r === RELAY ? "shared" : "mail" };
    },
    setOwnRelay: function (u) {
      u = String(u || "").trim().replace(/\/+$/, "");
      if (u && !HTTPS_RE.test(u)) return false;
      if (!u) { try { localStorage.removeItem(OWN_KEY); } catch (e) { return false; } changed(); return true; }
      var ok = writeJSON(OWN_KEY, u);
      if (ok) changed();
      return ok;
    },
    // → Promise<boolean>: the address answers like an orOS relay with the gate.
    testRelay: function (u) {
      u = String(u || "").trim().replace(/\/+$/, "");
      if (!HTTPS_RE.test(u)) return Promise.resolve(false);
      return fetch(u + "/.well-known/oauth-authorization-server", { cache: "no-store", credentials: "omit" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { return !!(j && typeof j.token_endpoint === "string" && /\/gate\/token$/.test(j.token_endpoint)); }, function () { return false; });
    },
    // orOS sync is on here: the owner's synced devices join by themselves.
    syncOn: function () { try { return !!(root.orosSync && root.orosSync.isConnected && root.orosSync.isConnected()); } catch (e) { return false; } },
    // The address a phone opens by scanning the join QR (useoros.online or this orOS).
    joinLink: function (code) {
      var base = "";
      try { base = root.location.origin + root.location.pathname; } catch (e) {}
      return (/^https?:/.test(base) ? base : "https://useoros.online/") + "#gate-join=" + String(code || "");
    },
    // A code that came in a scanned QR, once (Settings fills it in).
    takeJoin: function () { var c = pendingJoin; pendingJoin = ""; return c; },
    never: NEVER.slice(),
    state: function () {
      var p = pref();
      // moved: Mail's relay changed after the gate was made; the gate
      // stays on the old one until it is turned off and on again.
      var h = typeof p.hold === "number" && p.hold > Date.now() ? p.hold : 0;
      return { on: !!p.on, conn: wsState, at: p.at || 0, moved: !!(p.on && p.r && p.r !== relayNow()), hold: h,
               lv: isObj(p.lv) ? JSON.parse(JSON.stringify(p.lv)) : {} };
    },
    apps: function () {
      var lv = pref().lv || {};
      return offered().filter(function (a) { return NEVER.indexOf(a.id) < 0; }).map(function (a) {
        return { id: a.id, name: a.name, read: lv[a.id] === "read" || lv[a.id] === "write", write: lv[a.id] === "write",
                 canWrite: writable(a.id), tools: toolsOf(a.id) };
      });
    },
    // level: "read" | "write" | false (off)
    setApp: function (id, level) {
      var p = pref();
      if (NEVER.indexOf(id) >= 0) return false;
      if (level === true) level = "read";
      if (level === "write" && !writable(id)) return false;
      p.lv = isObj(p.lv) ? p.lv : {};
      if (level === "read" || level === "write") p.lv[id] = level; else delete p.lv[id];
      if (id === "kanban" && level === "write") kanbanModel().then(null, function () {});
      if (p.on) p.lvd = 1;
      var okW = writeJSON(PREF_KEY, p);
      if (okW && p.on && ws) sendLv(ws);
      changed();
      return okW;
    },
    // Many switches at once (Settings: all on/off, all may change):
    // { id: "read" | "write" | false }, one save, one send to the relay.
    // Never-apps and "write" for an app that cannot be changed are
    // skipped, the rest still go. → the number of apps set, or -1 when
    // the save failed.
    setApps: function (levels) {
      var p = pref(), n = 0, kb = false;
      if (!isObj(levels)) return 0;
      p.lv = isObj(p.lv) ? p.lv : {};
      Object.keys(levels).forEach(function (id) {
        var level = levels[id];
        if (NEVER.indexOf(id) >= 0) return;
        if (level === true) level = "read";
        if (level === "write" && !writable(id)) return;
        if (level === "read" || level === "write") p.lv[id] = level; else delete p.lv[id];
        if (id === "kanban" && level === "write") kb = true;
        n++;
      });
      if (!n) return 0;
      if (kb) kanbanModel().then(null, function () {});
      if (p.on) p.lvd = 1;
      var okW = writeJSON(PREF_KEY, p);
      if (okW && p.on && ws) sendLv(ws);
      changed();
      return okW ? n : -1;
    },
    // Pause Claude's changes on this device for minutes (Infinity: until
    // resumed); minutes ≤ 0 resumes. Reads go on.
    setPause: function (minutes) {
      var p = pref();
      if (!p.on) return false;
      delete p.w;                                     // the old write window (before 5.78.00)
      if (minutes > 0) p.hold = minutes === Infinity ? 8.64e15 : Date.now() + Math.min(minutes, 7 * 24 * 60) * 60000; else delete p.hold;
      var okW = writeJSON(PREF_KEY, p);
      clearTimeout(winTimer);
      if (p.hold && p.hold < 8.64e15) winTimer = setTimeout(changed, Math.min(p.hold - Date.now() + 500, 2147483000));
      changed();
      return okW;
    },
    canUndo: function (uid) { return chgList().some(function (e) { return e.id === uid && e.x && !e.done; }); },
    // Claude's changes from every device, newest first.
    // The daily email: { on, acct, at (last sent), fails today, accounts [{id, email}] }.
    digest: function () {
      var dg = digRead(), day = ymd(Date.now());
      return { on: dg.on, acct: dg.acct, at: dg.at || 0, fails: dg.fd === day ? dg.fn || 0 : 0,
               accounts: sendAccounts().map(function (a) { return { id: a.id, email: a.email }; }) };
    },
    setDigest: function (o) {
      var dg = digRead();
      if (isObj(o) && typeof o.on === "boolean") dg.on = o.on;
      if (isObj(o) && typeof o.acct === "string" && (o.acct === "" || ACCT_RE.test(o.acct))) dg.acct = o.acct;
      dg.m = Date.now();
      return digWrite(dg);
    },
    changes: function () { return chgList().slice().reverse().map(function (e) { return { id: e.id, t: e.t, app: e.app, n: e.n, k: e.k, dv: e.dv, done: e.done || 0, undo: !!(e.x && !e.done) }; }); },
    // → { ok, n, kept } | { ok:false }
    undo: function (uid) {
      var l = chgList();
      var e = l.filter(function (x) { return x.id === uid && x.x && !x.done; })[0];
      if (!e) return { ok: false };
      if (isObj(e.x) && typeof e.x.a === "string") return actUndo(e);   // GATE-ACT: a Promise
      var kb = e.app === "kanban", M = root.OrosKanbanModel;
      if (kb && !M) { kanbanModel().then(changed, function () {}); return { ok: false, later: true }; }
      var key = kb ? "oros-kanban-data" : "oros-budget-data";
      var r = kb ? kanbanUndo(M, readStore(key), e.x, Date.now()) : budgetUndo(readStore(key), e.x, Date.now());
      if (!r.ok || !writeJSON(key, r.data)) return { ok: false };
      try { if (root.orosSync && typeof root.orosSync.markDirty === "function") root.orosSync.markDirty(); } catch (e2) {}
      if (writeJSON(CHG_KEY, chgMerge(l, [Object.assign({}, e, { done: Date.now() })]))) dirty();
      changed();
      return { ok: true, n: r.n, kept: r.kept };
    },
    enable: function () {
      var p = pref();
      if (p.on && p.id && p.tok) { connect(); return Promise.resolve(); }
      // A gate of this owner already exists (its seat came through sync): sit in it.
      return sit(true).then(function (done) {
        if (done) return;
        // Only on the owner's own relay (Chris 08/11, 5.85.00): a new gate
        // never goes to orOS's shared one; joining an existing gate is fine.
        if (!mineRelay()) { var ne = new Error("norelay"); ne.code = "norelay"; throw ne; }
        p = pref();
        var id = randomB64u(16).slice(0, 22), tok = randomB64u(32), base = relayNow();
        return sha256hex(tok).then(function (th) { return devCall({ act: "new", id: id, th: th }, base); }).then(function () {
          p.on = true; p.id = id; p.tok = tok; p.r = base; p.at = Date.now(); p.lv = isObj(p.lv) ? p.lv : {};
          delete p.out;
          if (!writeJSON(PREF_KEY, p)) throw new Error("save");
          changed();
          connect();
          makeSeat();
        });
      });
    },
    // Another device of the owner: this one asks the relay for a join
    // code (10 minutes, one use), the other types it in (join).
    invite: function () {
      var p = pref();
      if (!p.on) return Promise.reject(new Error("off"));
      return devCall({ act: "invite", id: p.id, tok: p.tok, lv: isObj(p.lv) ? p.lv : {} });
    },
    join: function (code) {
      var p = pref(), jc = String(code || "").toUpperCase().replace(/[\s-]+/g, "");
      if (p.on && p.id && p.tok) return Promise.reject(new Error("on"));
      if (!/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/.test(jc)) { var e = new Error("gate"); e.code = "nojoin"; return Promise.reject(e); }
      var tok = randomB64u(32), base = relayNow();
      return sha256hex(tok).then(function (th) { return devCall({ act: "join", jc: jc, th: th }, base); }).then(function (d) {
        var lv = {};
        if (isObj(d.lv)) Object.keys(d.lv).forEach(function (k) {
          if (NEVER.indexOf(k) < 0 && (d.lv[k] === "read" || (d.lv[k] === "write" && writable(k)))) lv[k] = d.lv[k];
        });
        var np = { on: true, id: d.id, tok: tok, r: base, at: Date.now(), lv: lv };
        if (!writeJSON(PREF_KEY, np)) throw new Error("save");
        if (lv.kanban === "write") kanbanModel().then(null, function () {});
        changed();
        connect();
      });
    },
    disable: function () {
      var p = pref();
      actDrop();
      var gone = p.id && p.tok ? devCall({ act: "del", id: p.id, tok: p.tok }).catch(function () {}) : Promise.resolve();
      drop();
      return gone.then(function () {
        writeJSON(PREF_KEY, { on: false, lv: isObj(p.lv) ? p.lv : {}, out: 1 });   // out: no automatic join here
        changed();
      });
    },
    revoke: function () {
      var p = pref();
      if (!p.on) return Promise.resolve();
      return devCall({ act: "revoke", id: p.id, tok: p.tok }).then(function () {
        // A new gate key too (5.80.00): a copy made with the old one is useless.
        var st = seatRead();
        if (st && st.id === p.id) { st.k = randomB64u(32); st.m = Date.now(); if (writeJSON(SEAT_KEY, st)) dirty(); }
        copyLast = "";
        changed();
      });
    },
    info: function () {
      var p = pref();
      if (!p.on) return Promise.resolve({ links: 0, last: 0 });
      return devCall({ act: "info", id: p.id, tok: p.tok });
    },
    // The code from the relay's sign-in page (orOS Portable / installed
    // orOS, whose own browser is not the one Claude opened). → Promise;
    // rejects with e.code "nopair" (wrong or expired) or "rate".
    pair: function (code) {
      var p = pref(), pc = String(code || "").toUpperCase().replace(/[\s-]+/g, "");
      if (!p.on || !p.id || !p.tok) return Promise.reject(new Error("off"));
      if (!/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/.test(pc)) { var e = new Error("gate"); e.code = "nopair"; return Promise.reject(e); }
      return devCall({ act: "pair", id: p.id, tok: p.tok, pc: pc }).then(function () {
        writeJSON(LOG_KEY, pushLog(readJSON(LOG_KEY), { t: Date.now(), n: "sign-in", a: [], k: 0, ok: 1 }));
        changed();
      });
    },
    reconnect: function () { if (!ws) { retry = 0; connect(); } },
    log: function () { var l = readJSON(LOG_KEY); return Array.isArray(l) ? l.slice().reverse() : []; },
    clearLog: function () { try { localStorage.removeItem(LOG_KEY); } catch (e) {} changed(); },
    onChange: function (fn) {
      listeners.push(fn);
      return function () { listeners = listeners.filter(function (f) { return f !== fn; }); };
    }
  };
  root.orosGate = api;

  /* ---------- Claude's sign-in: ?gate=… (from the relay's /gate/authorize) ---------- */
  function readAsk() {
    var m = /[?&]gate=([A-Za-z0-9_-]{10,2000})/.exec(location.search);
    if (!m) return null;
    try {
      var s = atob(m[1].replace(/-/g, "+").replace(/_/g, "/") + "===".slice((m[1].length + 3) % 4));
      var o = JSON.parse(decodeURIComponent(escape(s)));
      if (!isObj(o) || ["https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback"].indexOf(o.r) < 0) return null;
      if (typeof o.c !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(o.c) || typeof o.s !== "string" || o.s.length > 500) return null;
      return o;
    } catch (e) { return null; }
  }
  function back(ask, query) {
    location.href = ask.r + "?" + query + (ask.s ? "&state=" + encodeURIComponent(ask.s) : "");
  }
  // A centred modal (R32) with two buttons. → { wrap, yes, no, err }
  function modal(title, body, note, noLabel, yesLabel, onNo, onYes) {
    var wrap = document.createElement("div");
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-modal", "true");
    wrap.setAttribute("aria-labelledby", "gate-ask-title");
    wrap.style.cssText = "position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.55)";
    var box = document.createElement("div");
    box.style.cssText = "max-width:440px;width:100%;background:var(--panel-bg,#2a2a2e);color:var(--text,#fff);border-radius:12px;padding:20px;box-shadow:0 10px 40px rgba(0,0,0,.4);font:inherit";
    var h = document.createElement("h2");
    h.id = "gate-ask-title";
    h.style.cssText = "margin:0 0 10px;font-size:1.15rem";
    h.textContent = title;
    var pTxt = document.createElement("p");
    pTxt.style.cssText = "margin:0 0 10px;line-height:1.45";
    pTxt.textContent = body;
    box.appendChild(h); box.appendChild(pTxt);
    if (note) {
      var nt = document.createElement("p");
      nt.style.cssText = "margin:0 0 16px;line-height:1.45;opacity:.8;font-size:.92rem";
      nt.textContent = note;
      box.appendChild(nt);
    }
    var err = document.createElement("p");
    err.style.cssText = "margin:0 0 12px;color:#ff7b72";
    err.hidden = true;
    var row = document.createElement("div");
    row.style.cssText = "display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap";
    function btn(label, primary) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.style.cssText = "min-height:40px;padding:0 16px;border-radius:8px;border:1px solid rgba(127,127,127,.4);font:inherit;cursor:pointer;" +
        (primary ? "background:var(--accent,#3584e4);color:var(--accent-ink,#fff);border-color:transparent" : "background:transparent;color:inherit");
      return b;
    }
    var no = btn(noLabel, false), yes = btn(yesLabel, true);
    no.addEventListener("click", onNo);
    yes.addEventListener("click", onYes);
    wrap.addEventListener("keydown", function (e) { if (e.key === "Escape") no.click(); });
    row.appendChild(no); row.appendChild(yes);
    box.appendChild(err); box.appendChild(row);
    wrap.appendChild(box);
    document.body.appendChild(wrap);
    yes.focus();
    return { wrap: wrap, yes: yes, no: no, err: err };
  }
  function dialog(title, body, note, noLabel, yesLabel, onNo, onYes) {
    return modal(title, body, note, noLabel, yesLabel, onNo, onYes).wrap;
  }
  function consent(ask) {
    var m = modal(tr("gate.ask.title"), tr("gate.ask.body"), pref().on ? tr("gate.ask.on") : tr("gate.ask.off"), tr("gate.ask.deny"), tr("gate.ask.allow"),
      function () { m.wrap.remove(); back(ask, "error=access_denied"); },
      function () {
        m.yes.disabled = true; m.no.disabled = true; m.err.hidden = true;
        api.enable().then(function () {
          var p = pref();
          return devCall({ act: "code", id: p.id, tok: p.tok, c: ask.c, r: ask.r });
        }).then(function (d) {
          back(ask, "code=" + encodeURIComponent(pref().id + "." + d.code));
        }, function (e) {
          m.yes.disabled = false; m.no.disabled = false;
          m.err.textContent = tr("gate.ask.fail") + (e && e.code ? " (" + String(e.code).replace(/[^a-z0-9-]/gi, "").slice(0, 20) + ")" : "");
          m.err.hidden = false;
        });
      });
  }
  // Never over the lock screen: the dialog waits until orOS is unlocked.
  function whenUnlocked(fn) {
    var L = root.orosLock;
    if (L && typeof L.isLocked === "function" && L.isLocked()) { setTimeout(function () { whenUnlocked(fn); }, 800); return; }
    fn();
  }
  function start() {
    var ask = readAsk();
    if (/[?&]gate=/.test(location.search)) {
      try { history.replaceState(null, "", location.pathname + location.search.replace(/([?&])gate=[^&]*&?/, "$1").replace(/[?&]$/, "") + location.hash); } catch (e) {}
    }
    if (ask) whenUnlocked(function () { consent(ask); });
    // A scanned join QR: Settings › orOS Gate opens with the code filled in.
    var jc = joinHash(location.hash);
    if (jc) {
      pendingJoin = jc;
      try { history.replaceState(history.state, "", location.pathname + location.search); } catch (e) {}
      var openJ = function (n) {
        if (typeof root.__orosOpenAt === "function") root.__orosOpenAt("settings", { section: "services", item: "gate" });
        else if (n < 20) setTimeout(function () { openJ(n + 1); }, 500);
      };
      whenUnlocked(function () { setTimeout(function () { openJ(0); }, 600); });
    }
    connect();
    seatSlice(0);
    chgSlice(0);
    digSlice(0);
    setInterval(function () { copySoon(0); }, 30 * 60000);
    setTimeout(digCheck, 60000);
    clearInterval(digTimer);
    digTimer = setInterval(digCheck, 10 * 60000);
    (function pushWatch(n) {                          // webpush.js may load after this file
      var P = root.orosPush;
      if (P && typeof P.onChange === "function") { P.onChange(function () { setTimeout(pushReg, 500); }); return; }
      if (n < 40) setTimeout(function () { pushWatch(n + 1); }, 500);
    })(0);
    setTimeout(function () { if (pref().on) makeSeat(); else whenUnlocked(function () { sit(false); }); }, 3000);
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") api.reconnect(); else copySoon(0); });
    root.addEventListener("online", function () { api.reconnect(); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})(typeof window !== "undefined" ? window : globalThis);
