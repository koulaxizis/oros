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
//   localStorage "oros-gate"      { on, id, tok, r (relay it lives on), lv{appId: "read" | "write"}, w (write window ends, ms), at }
//   localStorage "oros-gate-log"  [{ t, n, a[app ids], k (items), ok, u? (undo id) }] ≤ 300
//   localStorage "oros-gate-undo" [{ id, t, app, n, x (budgetWrite or kanbanWrite undo) }] ≤ 20
// Changes (wave 3) only to apps set to "write", only while the write
// window the owner opened on this device is open; more than 5
// deletions in one call are asked on the device.
// Pure core (Node-tested, tests/gate-core.test.js): window.orosGateCore.
// ============================================================
(function (root) {
  "use strict";

  var PREF_KEY = "oros-gate", LOG_KEY = "oros-gate-log", LOG_MAX = 300, UNDO_KEY = "oros-gate-undo", UNDO_MAX = 20;
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
    if (LINES[id]) t.push(LINES[id]);
    return t;
  }
  function pushLog(list, entry) {
    var l = Array.isArray(list) ? list.slice() : [];
    l.push(entry);
    return l.length > LOG_MAX ? l.slice(l.length - LOG_MAX) : l;
  }

  /* ---------- wave 3: changes to Budget (write window only) ---------- */
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
  /* ---------- changes to Kanban (write window only, 5.68.00) ---------- */
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
  // Apps whose items Claude may change, and the tools for them.
  var WRITES = { budget: ["budget_add", "budget_change", "budget_delete"],
                 kanban: ["kanban_add_cards", "kanban_move_cards", "kanban_change_card", "kanban_add_columns"] };
  // GATE-ACT (2026-11-08): the apps Claude may change with the
  // Assistant's own tools, run in a hidden Assistant frame
  // (assistant.js GATE). = the Assistant's create / change apps, less
  // NEVER, the apps with their own tools above (Budget, Kanban) and
  // Files (tests/gate-act.test.js).
  var ACT = ["bookmarks", "calendar", "chores", "contacts", "crm", "feeds", "flashcards", "garage", "habits", "invoices",
             "library", "meals", "music", "notes", "petcare", "plants", "podcasts", "shelf", "split", "stickies", "stock",
             "timesheet", "todo", "travel", "wiki"];
  var ACT_TOOLS = ["search_data", "read_item", "app_summary", "read_in_app", "change_item", "create_items", "link_contact", "link_items", "change_history", "undo_change"];
  var ACT_WRITE = ["create_items", "change_item", "link_contact", "link_items", "undo_change"];
  function writable(id) { return !!WRITES[id] || ACT.indexOf(id) >= 0; }
  function canWrite(lv, win, id, now) {
    return !!(isObj(lv) && lv[id] === "write" && writable(id) && NEVER.indexOf(id) < 0 && typeof win === "number" && win > now);
  }

  // The relay orOS uses (Mail › relay, a self-hosted one), else orOS's own.
  function relayOf(mail) {
    var u = isObj(mail) && isObj(mail.relay) && typeof mail.relay.url === "string" ? mail.relay.url.trim().replace(/\/+$/, "") : "";
    return /^https:\/\/[^\s/?#]+(\/[^\s?#]*)?$/.test(u) ? u : RELAY;
  }

  var core = { NEVER: NEVER, budgetLines: budgetLines, invoiceList: invoiceList, stockItems: stockItems, publishTitles: publishTitles,
               relayOf: relayOf, RELAY: RELAY, budgetWrite: budgetWrite, budgetUndo: budgetUndo, canWrite: canWrite,
               kanbanWrite: kanbanWrite, kanbanUndo: kanbanUndo,
               WRITES: WRITES, ACT: ACT, ACT_TOOLS: ACT_TOOLS, ACT_WRITE: ACT_WRITE, writable: writable, ASK_OVER: ASK_OVER, packHits: packHits, allowed: allowed, toolsOf: toolsOf,
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
  // The relay of this gate: the one it was made on while it is on, else
  // the one orOS uses now.
  function relayNow() { return relayOf(readJSON("oros-mail-data")); }
  function relay() { var p = pref(); return p.on && typeof p.r === "string" && p.r ? p.r : relayNow(); }
  function devCall(body, base) {
    return fetch((base || relay()) + "/gate/dev", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return null; }).then(function (j) {
        if (!r.ok || !j || !j.ok) { var e = new Error("gate"); e.code = j && j.error && j.error.code || ("http-" + r.status); throw e; }
        return j.data;
      }); });
  }

  var listeners = [];
  function changed() { listeners.slice().forEach(function (fn) { try { fn(); } catch (e) {} }); }

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
      clearInterval(pingTimer);
      pingTimer = setInterval(function () { try { sock.send("ping"); } catch (e) {} }, 45000);
    };
    sock.onmessage = function (ev) { if (typeof ev.data === "string" && ev.data !== "pong") onCall(sock, ev.data); };
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
  // The relay asks a device whose orOS is on screen first (5.70.00):
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
            o.change_tools = WRITES[a.id] ? WRITES[a.id].slice() : ACT_WRITE.slice();
            o.write_window = canWrite(p.lv, p.w, a.id, Date.now()) ? "open until " + new Date(p.w).toISOString() : "closed";
          }
          return o;
        }),
        note: ok.length ? "Find items with search_data or app_summary (each item has a ref), then change them by ref. Changes need the owner's write window." : "The owner has not allowed any app yet (orOS › Settings › Connected services › orOS Gate)."
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
      if (ACT_WRITE.indexOf(name) >= 0 && !ok.some(function (a) { return p.lv[a.id] === "write" && ACT.indexOf(a.id) >= 0; })) {
        return Promise.resolve({ ok: false, c: "The owner lets Claude change none of these apps (orOS › Settings › Connected services › orOS Gate: a change switch per app, then a write window)." });
      }
      return actFrame().then(function (F) {
        if (!F) {
          if (name === "search_data") return own();
          return { ok: false, c: "orOS could not start its tools on the device; try again in a moment." };
        }
        return F.run(name, args).then(function (r) {
          var out = { ok: !!r.ok, c: r.c || "", a: Array.isArray(r.a) ? r.a : [], k: r.k || 0 };
          if (r.u) out.u = "a:" + r.u;
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

  function newTxId() {
    var r = new Uint32Array(1);
    crypto.getRandomValues(r);
    return Date.now().toString(36) + (r[0] % 46656).toString(36);   // = budget.js newId
  }
  function change(op, args, p, names) {
    var now = Date.now();
    if (!canWrite(p.lv, p.w, "budget", now)) {
      return Promise.resolve({ ok: false, c: "Changes to " + (names.budget || "Budget") + " are closed. Ask the owner to allow changes to Budget and open a write window in orOS › Settings › Connected services › orOS Gate." });
    }
    var n = op === "delete" && Array.isArray(args.ids) ? args.ids.length : 0;
    var asked = n > ASK_OVER && n <= 100 ? askDelete(n) : Promise.resolve(true);
    return asked.then(function (yes) {
      if (!yes) return { ok: false, c: "The owner did not confirm deleting " + n + " entries on the device; nothing was deleted." };
      var r = budgetWrite(op, readStore("oros-budget-data"), args, Date.now(), newTxId);
      if (!r.ok) return { ok: false, c: r.err };
      if (!writeJSON("oros-budget-data", r.data)) return { ok: false, c: "orOS could not save the change on the device; nothing was changed." };
      try { if (root.orosSync && typeof root.orosSync.markDirty === "function") root.orosSync.markDirty(); } catch (e) {}
      var uid = remember("budget", "budget_" + op, r.undo, now);
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
  function remember(app, n, x, now) {
    var uid = now.toString(36) + randomB64u(3).replace(/[^a-z0-9]/gi, "").toLowerCase();
    var ul = readJSON(UNDO_KEY);
    ul = (Array.isArray(ul) ? ul : []).concat([{ id: uid, t: now, app: app, n: n, x: x }]);
    writeJSON(UNDO_KEY, ul.length > UNDO_MAX ? ul.slice(ul.length - UNDO_MAX) : ul);
    return uid;
  }
  function kanbanChange(op, args, p, names) {
    var now = Date.now();
    if (!canWrite(p.lv, p.w, "kanban", now)) {
      return Promise.resolve({ ok: false, c: "Changes to " + (names.kanban || "Kanban") + " are closed. Ask the owner to allow changes to Kanban and open a write window in orOS › Settings › Connected services › orOS Gate." });
    }
    return kanbanModel().then(function (M) {
      var r = kanbanWrite(M, op, readStore("oros-kanban-data"), args, Date.now(), kbId);
      if (!r.ok) return { ok: false, c: r.err };
      if (!writeJSON("oros-kanban-data", r.data)) return { ok: false, c: "orOS could not save the change on the device; nothing was changed." };
      try { if (root.orosSync && typeof root.orosSync.markDirty === "function") root.orosSync.markDirty(); } catch (e) {}
      var uid = remember("kanban", "kanban_" + op, r.undo, now);
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
    if (!p.on) { done({ ok: false, c: "The gate is off." }); return; }
    run(q.n, q.a).then(done, function () { done({ ok: false, c: "The call failed on the device." }); });
  }

  /* ---------- API for Settings ---------- */
  var api = {
    // For the hidden Assistant frame (assistant.js GATE).
    frameReady: function () { if (actReady) actReady(); },
    act: ACT.slice(),
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
      if (!id || ACT.indexOf(id) < 0 || !isObj(p.lv) || p.lv[id] !== "write") return "The owner does not let Claude change " + (id || "this app") + " (orOS › Settings › Connected services › orOS Gate).";
      if (!canWrite(p.lv, p.w, id, now)) return "Changes are closed: the owner's write window is not open. Ask the owner to open it in orOS › Settings › Connected services › orOS Gate (or Quick settings).";
      return "";
    },
    askDelete: function (n) { return askDelete(n); },
    relayUrl: function () { return relay() + "/mcp"; },
    never: NEVER.slice(),
    state: function () {
      var p = pref();
      // moved: Mail's relay changed after the gate was made; the gate
      // stays on the old one until it is turned off and on again.
      var w = typeof p.w === "number" && p.w > Date.now() ? p.w : 0;
      return { on: !!p.on, conn: wsState, at: p.at || 0, moved: !!(p.on && p.r && p.r !== relayNow()), win: w,
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
      var okW = writeJSON(PREF_KEY, p);
      changed();
      return okW;
    },
    // The write window: Claude may change the apps set to "write" until
    // it ends. minutes ≤ 0 closes it.
    setWindow: function (minutes) {
      var p = pref();
      if (!p.on) return false;
      if (minutes > 0) p.w = Date.now() + Math.min(minutes, 24 * 60) * 60000; else delete p.w;
      var okW = writeJSON(PREF_KEY, p);
      clearTimeout(winTimer);
      if (p.w) winTimer = setTimeout(changed, p.w - Date.now() + 500);
      changed();
      return okW;
    },
    canUndo: function (uid) {
      if (/^a:/.test(String(uid))) return true;
      var l = readJSON(UNDO_KEY); return Array.isArray(l) && l.some(function (e) { return e && e.id === uid; });
    },
    // GATE-ACT: a change made with the Assistant's tools → Promise<{ ok, n }>
    undoAct: function (uid) {
      var id = String(uid).replace(/^a:/, "");
      return actFrame().then(function (F) {
        if (!F || typeof F.undo !== "function") return { ok: false };
        return F.undo(id).then(function (ok) {
          if (ok) {
            var l = readJSON(LOG_KEY);
            if (Array.isArray(l)) writeJSON(LOG_KEY, l.map(function (e) { if (e && e.u === uid) { e = JSON.parse(JSON.stringify(e)); delete e.u; } return e; }));
            changed();
          }
          return { ok: !!ok, n: ok ? 1 : 0 };
        });
      });
    },
    // → { ok, n, kept } | { ok:false }
    undo: function (uid) {
      var l = readJSON(UNDO_KEY);
      l = Array.isArray(l) ? l : [];
      var e = l.filter(function (x) { return x && x.id === uid; })[0];
      if (!e) return { ok: false };
      var kb = e.app === "kanban", M = root.OrosKanbanModel;
      if (kb && !M) { kanbanModel().then(changed, function () {}); return { ok: false }; }
      var key = kb ? "oros-kanban-data" : "oros-budget-data";
      var r = kb ? kanbanUndo(M, readStore(key), e.x, Date.now()) : budgetUndo(readStore(key), e.x, Date.now());
      if (!r.ok || !writeJSON(key, r.data)) return { ok: false };
      try { if (root.orosSync && typeof root.orosSync.markDirty === "function") root.orosSync.markDirty(); } catch (e2) {}
      writeJSON(UNDO_KEY, l.filter(function (x) { return x && x.id !== uid; }));
      changed();
      return { ok: true, n: r.n, kept: r.kept };
    },
    enable: function () {
      var p = pref();
      if (p.on && p.id && p.tok) { connect(); return Promise.resolve(); }
      var id = randomB64u(16).slice(0, 22), tok = randomB64u(32), base = relayNow();
      return sha256hex(tok).then(function (th) { return devCall({ act: "new", id: id, th: th }, base); }).then(function () {
        p.on = true; p.id = id; p.tok = tok; p.r = base; p.at = Date.now(); p.lv = isObj(p.lv) ? p.lv : {};
        if (!writeJSON(PREF_KEY, p)) throw new Error("save");
        changed();
        connect();
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
        writeJSON(PREF_KEY, { on: false, lv: isObj(p.lv) ? p.lv : {} });
        changed();
      });
    },
    revoke: function () {
      var p = pref();
      if (!p.on) return Promise.resolve();
      return devCall({ act: "revoke", id: p.id, tok: p.tok }).then(function () { changed(); });
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
    connect();
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") api.reconnect(); });
    root.addEventListener("online", function () { api.reconnect(); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})(typeof window !== "undefined" ? window : globalThis);
