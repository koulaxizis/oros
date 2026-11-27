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
  // 6.01.02: ids of the calls this device ran (device-local, 7 days, ≤ 100),
  // so a change the box also queued after a late answer is not done twice.
  var RAN_KEY = "oros-gate-ran", RAN_MAX = 100, RAN_MS = 7 * 86400000;
  // The daily email of Claude's changes (5.79.00), synced: { on, acct (a
  // Mail account id, "" = the first that can send), m (settings changed),
  // d (the day sent or being sent, YYYY-MM-DD), dv (the device sending
  // it), fd/fn (failures that day), at (sent at) }.
  var DIG_KEY = "oros-gate-digest", DIG_HOUR = 20, DIG_TRIES = 3;
  var RELAY = "https://oros-mail-relay.koulaxizis.workers.dev";   // = mail.js; the gate box lives there
  // Never offered, whatever a setting says (BR-GATE).
  // Never offered: Passwords (secrets) and the Assistant itself.
  var NEVER = ["assistant", "passwords"];
  // Sensitive (5.90.00, Chris 08/11: «ως επιλογή με σαφές warning»):
  // offered only after a clear warning on the device, read only (never
  // changed by Claude), and never in the closed-orOS copy, so they leave
  // the device only while orOS is open and Claude asks.
  var SENSITIVE = ["baby", "cycle", "diary", "fitness", "health", "mail", "mood"];
  function sensitive(id) { return SENSITIVE.indexOf(id) >= 0; }
  var SUMMARY = { budget: 1, stock: 1, kanban: 1, studio: 1 };   // studio: STUDIO-POD P4, read only
  // AS-SUM8 (2026-11-17): apps outside ACT whose app_summary the frame
  // answers (assistant/summary.js), read only: never a change tool.
  var SUM_READ = ["scanpdf", "transfer", "whiteboard"];
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
  var OWN_TX = { id: 1, m: 1, d: 1, a: 1, k: 1, c: 1, n: 1, ac: 1, ot: 1, fit: 1, src: 1, pp: 1, oc: 1, oa: 1, rc: 1, dm: 1 };

  // AR-INV (6.01.00): Budget's areas (budget.js normArea), live ones by
  // name: { id, m, col, n, q, iv?, pc?, sh? }.
  function liveAreas(d) {
    var tombs = isObj(d.tombs) ? d.tombs : {};
    return (Array.isArray(d.area) ? d.area : []).filter(function (a) {
      return isObj(a) && typeof a.id === "string" && typeof a.n === "string" && a.n && !deadIn(tombs, "area", a);
    }).sort(function (a, b) { var x = fold(a.n), y = fold(b.n); return x < y ? -1 : x > y ? 1 : (a.id < b.id ? -1 : 1); });
  }
  // How Claude sees an area; series = the Invoices series ids (a list
  // with their prefixes when the device has Invoices: budget_areas).
  function areaOut(a) {
    var o = { name: a.n, words: String(a.q || "") };
    if (a.iv) o.invoice_series = String(a.iv).split(" ");
    if (a.sh === 1) o.shared_costs = true;
    else if (typeof a.pc === "number" && a.pc > 0) o.share = a.pc;
    if (a.ps === 1 && a.sh !== 1) o.personal = true;     // AR-VIEW
    return o;
  }

  // AR-CAT (6.02.00): the stored categories as Claude sees them, by
  // kind then name: { name, kind, main?, area? } (built-in ones that were
  // never changed are not stored and show on lines as their ids, o-… / i-…).
  // A subcategory takes its main category's area (budget.js categoryList).
  function catsOut(d, ars) {
    var tombs = isObj(d.tombs) ? d.tombs : {}, live = {}, list = [];
    (Array.isArray(d.cats) ? d.cats : []).forEach(function (c) {
      if (isObj(c) && typeof c.id === "string" && (c.k === "o" || c.k === "i") && !deadIn(tombs, "cat", c)) { live[c.id] = c; list.push(c); }
    });
    return list.map(function (c) {
      var o = { name: String(c.name || c.id), kind: c.k === "i" ? "income" : "expense" };
      var m = typeof c.p === "string" && live[c.p] && live[c.p].k === c.k && !live[c.p].p ? live[c.p] : null;
      if (m) o.main = String(m.name || m.id);
      var dm = m ? m.dm : c.dm;
      if (typeof dm === "string" && ars[dm]) o.area = ars[dm];
      return o;
    }).sort(function (x, y) { return x.kind < y.kind ? -1 : x.kind > y.kind ? 1 : (fold(x.name) < fold(y.name) ? -1 : fold(x.name) > fold(y.name) ? 1 : 0); });
  }

  // budget_lines: raw = the parsed oros-budget-data, args from Claude.
  // → { ok:true, data } | { ok:false, err }
  function budgetLines(raw, args, L) {
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
    var accs = {}, cats = {}, ars = {};
    (Array.isArray(d.acc) ? d.acc : []).forEach(function (a) { if (isObj(a) && typeof a.id === "string" && !deadIn(tombs, "acc", a)) accs[a.id] = String(a.n || a.id); });
    (Array.isArray(d.cats) ? d.cats : []).forEach(function (c) { if (isObj(c) && typeof c.id === "string" && !deadIn(tombs, "cat", c)) cats[c.id] = String(c.name || c.id); });
    var areaList = liveAreas(d);
    areaList.forEach(function (a) { ars[a.id] = a.n; });
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
      if (x.dm && ars[x.dm]) o.area = ars[x.dm];      // AR-INV: an area that is gone reads as none
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
    if (areaList.length) data.areas = areaList.map(areaOut);
    var catOut = catsOut(d, ars);
    if (catOut.length) data.categories = catOut;
    if (offset + PAGE < rows.length) data.next_offset = offset + PAGE;
    if (acc) data.account = accs[acc];
    // AC-GATE (6.04.00): the accounts with their balances at the end of
    // `to`, and purchases that look read twice among the days asked
    var accOut = accountsOut(d, L || null, to);
    if (accOut.length) data.accounts = accOut;
    var dups = dupPairs(rows, 100);
    if (dups.length) data.possible_duplicates = dups;
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
  function invoiceList(C, raw, args, today, budgetRaw) {
    if (!isObj(args)) return { ok: false, err: "The arguments must be an object." };
    var areaNames = null;
    if (isObj(budgetRaw)) { areaNames = {}; liveAreas(budgetRaw).forEach(function (a) { areaNames[a.id] = a.n; }); }
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
          // INV-EXT: what invoices_record kept with a document issued elsewhere
          if (x.kind === "ext") {
            if (typeof x.dm === "string" && areaNames && areaNames[x.dm]) o.area = areaNames[x.dm];
            put(o, "source", typeof x.xs === "string" ? x.xs : "");
            put(o, "provider_uid", typeof x.xu === "string" ? x.xu : "");
            put(o, "auth_code", typeof x.xa === "string" ? x.xa : "");
            put(o, "mydata_type", typeof x.xt === "string" ? x.xt : "");
          }
          var shown = x.kind === "ext" ? x.xl : x.lines;
          if (Array.isArray(shown) && shown.length) {
            o.lines = shown.slice(0, 50).map(function (l) {
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

  // INV-EXT (7.52.00, thread «Καταγραφή εξωτερικών τιμολογίων στο orOS»,
  // Chris 2026-11-18 card «Νέο εργαλείο στο Gate»): invoices_record —
  // documents ISSUED ELSEWHERE (another invoicing provider, myDATA)
  // recorded in Invoices as kind "ext": issued at once, never a draft,
  // no orOS series or number, nothing sent anywhere. C =
  // OrosInvoicesCore, raw = oros-invoices-data, budgetRaw =
  // oros-budget-data (its areas), now = the stamp, at most XR.docs per
  // call, checked all or none; a document whose number (or provider
  // uid) Invoices already has is skipped, not refused. A client is
  // matched as Invoices does (tax id, then name) or made. paid adds one
  // payment of the whole amount, never one that goes to Budget by
  // itself (no ab: Budget gets the money from the bank lines).
  // → { ok, data, ids, skipped, undo } | { ok: false, err }
  var XR = { docs: 100, lines: 50, text: 500, num: 40, name: 120, afm: 60, mark: 60, src: 60, uid: 80, note: 2000, all: 20000 };
  var XT_RE = /^\d{1,2}\.\d{1,2}$/, XR_HOWS = ["bank", "cash", "card", "iris", "paypal", "other"];
  function zCents(v) {                           // a decimal ≥ 0 → cents, else null
    var s = typeof v === "number" ? String(v) : String(v == null ? "" : v).trim();
    if (!/^\d{1,10}(\.\d{1,2})?$/.test(s)) return null;
    return Math.round(parseFloat(s) * 100);
  }
  function xText(v, max) { return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : ""; }
  function numKey(s) { return fold(s).replace(/[\s.\-_\/]+/g, ""); }
  function whtRate(net, w) {                     // the % (2 decimals) that gives w on net, or null
    if (!w) return 0;
    if (!net) return null;
    var r0 = Math.round(w / net * 10000);
    for (var k = 0; k <= 2; k++) {
      var c = [r0 - k, r0 + k];
      for (var j = 0; j < 2; j++) { var r = c[j] / 100; if (r > 0 && r <= 100 && Math.round(net * r / 100) === w) return r; }
    }
    return null;
  }
  function invoicesRecord(C, raw, budgetRaw, args, now) {
    if (!isObj(args)) return { ok: false, err: "The arguments must be an object." };
    var list = args.documents;
    if (!Array.isArray(list) || !list.length || list.length > XR.docs) return { ok: false, err: "documents must be a list of 1 to " + XR.docs + " documents." };
    if (raw != null && !(isObj(raw) && Array.isArray(raw.docs))) return { ok: false, err: "Invoices' data on this device could not be read; nothing was recorded." };
    var d = C.normalize(isObj(raw) ? raw : C.empty());
    var areas = isObj(budgetRaw) ? liveAreas(budgetRaw).map(function (a) { return { id: a.id, n: a.n }; }) : [];
    var have = {}, uids = {};
    C.live(d.docs).forEach(function (x) {
      if (x.st === "draft") return;
      if (x.num) have[numKey(x.num)] = x.id;
      if (typeof x.xu === "string" && x.xu) uids[x.xu] = x.id;
    });
    var rows = [], skipped = [], seen = {};
    for (var i = 0; i < list.length; i++) {
      var e = list[i], w = "documents[" + i + "]: ";
      if (!isObj(e)) return { ok: false, err: w + "must be an object." };
      var num = xText(e.number, XR.num);
      if (!num) return { ok: false, err: w + "number is required (series and number as printed, e.g. \"ΤΠΥ0148\")." };
      var date = String(e.date || "");
      if (!YMD.test(date) || isNaN(Date.parse(date))) return { ok: false, err: w + "date must be a day as YYYY-MM-DD." };
      var name = xText(e.client, XR.name);
      if (!name) return { ok: false, err: w + "client is required (the name on the document)." };
      var afm = xText(e.client_vat_id, XR.afm).replace(/\s+/g, "");
      var net = zCents(e.net), vat = zCents(e.vat);
      if (net === null) return { ok: false, err: w + "net must be an amount such as \"600.00\" (0 or more)." };
      if (vat === null) return { ok: false, err: w + "vat must be an amount such as \"144.00\" (0 or more)." };
      var wa = e.withholding === undefined || e.withholding === null || e.withholding === "" ? 0 : zCents(e.withholding);
      if (wa === null) return { ok: false, err: w + "withholding must be an amount such as \"120.00\"." };
      var rate = whtRate(net, wa);
      if (rate === null) return { ok: false, err: w + "withholding " + cents(wa) + " is no whole percentage of net " + cents(net) + "." };
      var pay = net + vat - Math.round(net * rate / 100);
      if (e.total_payable !== undefined && e.total_payable !== null && e.total_payable !== "") {
        var tp = zCents(e.total_payable);
        if (tp === null || tp !== pay) return { ok: false, err: w + "total_payable " + String(e.total_payable).slice(0, 20) + " is not net + vat − withholding = " + cents(pay) + "." };
      }
      var cur = e.currency === undefined || e.currency === "" ? "EUR" : String(e.currency);
      if (!C.curOk(cur)) return { ok: false, err: w + "currency must be a 3-letter ISO code such as EUR." };
      var lines = [];
      if (e.lines !== undefined) {
        if (!Array.isArray(e.lines) || e.lines.length > XR.lines) return { ok: false, err: w + "lines is a list of at most " + XR.lines + " lines." };
        for (var j = 0; j < e.lines.length; j++) {
          var L = e.lines[j], lw = w + "lines[" + j + "]: ";
          if (!isObj(L)) return { ok: false, err: lw + "must be an object with text." };
          var tx = xText(L.text, XR.text);
          if (!tx) return { ok: false, err: lw + "text is required." };
          var q = L.qty === undefined || L.qty === null || L.qty === "" ? 1 : Number(L.qty);
          if (!isFinite(q) || q <= 0 || q > 1000000) return { ok: false, err: lw + "qty must be more than 0." };
          var pr = L.price === undefined || L.price === null || L.price === "" ? 0 : zCents(L.price);
          if (pr === null) return { ok: false, err: lw + "price must be an amount before VAT such as \"25.00\"." };
          var vr = L.vat_rate === undefined || L.vat_rate === null || L.vat_rate === "" ? 0 : Number(L.vat_rate);
          if (!isFinite(vr) || vr < 0 || vr > 100) return { ok: false, err: lw + "vat_rate must be a % from 0 to 100." };
          lines.push({ code: "", d: tx, q: Math.round(q * 1000) / 1000, unit: "", p: pr, disc: 0, vat: Math.round(vr * 100) / 100 });
        }
      }
      var dm = "";
      if (e.area !== undefined && e.area !== "") {
        var ar = findIn(areas, e.area);
        if (!ar) return { ok: false, err: w + (areas.length ? "no Budget area \"" + String(e.area).slice(0, 60) + "\". Areas: " + areas.map(function (a) { return a.n; }).join(", ") : "Budget has no areas on this device (or Claude may not read Budget); leave area out.") };
        dm = ar.id;
      }
      var xt = e.mydata_type === undefined || e.mydata_type === "" ? "" : String(e.mydata_type).trim();
      if (xt && !XT_RE.test(xt)) return { ok: false, err: w + "mydata_type is a myDATA document type such as \"2.1\" or \"11.1\"." };
      var paid = null;
      if (e.paid !== undefined && e.paid !== null) {
        if (!isObj(e.paid) || XR_HOWS.indexOf(e.paid.method) < 0) return { ok: false, err: w + "paid must be { method: " + XR_HOWS.join(" | ") + ", date? }." };
        var pd = e.paid.date === undefined || e.paid.date === "" ? date : String(e.paid.date);
        if (!YMD.test(pd) || isNaN(Date.parse(pd))) return { ok: false, err: w + "paid.date must be a day as YYYY-MM-DD." };
        if (pay <= 0) return { ok: false, err: w + "a document with nothing to pay takes no paid." };
        paid = { how: e.paid.method, date: pd };
      }
      var uid = xText(e.provider_uid, XR.uid);
      var key = numKey(num);
      if (have[key] || (uid && uids[uid])) { skipped.push({ i: i, number: num, id: have[key] || uids[uid], why: "already in Invoices" }); continue; }
      if (seen[key] !== undefined) { skipped.push({ i: i, number: num, why: "twice in this call (as documents[" + seen[key] + "])" }); continue; }
      seen[key] = i;
      if (uid) uids[uid] = "new";
      rows.push({ i: i, num: num, date: date, name: name, afm: afm, net: net, vat: vat, rate: rate, cur: cur, lines: lines, dm: dm, xt: xt, paid: paid, uid: uid,
                  mark: xText(e.mark, XR.mark), src: xText(e.source, XR.src), auth: xText(e.auth_code, XR.uid), note: typeof e.note === "string" ? e.note.slice(0, XR.note) : "" });
    }
    if (C.live(d.docs).length + rows.length > XR.all) return { ok: false, err: "Invoices would hold more than " + XR.all + " documents; nothing was recorded." };
    var s = stampAfter(now, 0), ids = [], undo = { app: "invoices", docs: [], pays: [], clients: [] };
    rows.forEach(function (o) {
      var cl = C.matchClient(d, { afm: o.afm, name: o.name }), id;
      if (!cl) {
        do { id = C.newId(); } while (C.anyId(d.clients, id));
        cl = C.normClient({ id: id, name: o.name, afm: o.afm, doy: "", job: "", addr: "", country: "", email: "", phone: "", note: "", m: s });
        d.clients.push(cl);
        undo.clients.push({ id: cl.id, m: cl.m });
      }
      do { id = C.newId(); } while (C.anyId(d.docs, id));
      var party = C.partyOfClient(cl);
      if (o.afm) party.afm = o.afm;
      var x = { id: id, kind: "ext", st: "issued", ser: "", seq: 0, num: o.num, date: o.date, due: "", cur: o.cur, cli: cl.id,
                c: party, lines: [], gDisc: 0, wht: o.rate, exempt: "", terms: "", notes: o.note, ref: "", crm: cl.crm || "",
                mark: o.mark, file: "", sent: "", plang: "", xnet: o.net, xvat: o.vat, m: s };
      if (o.lines.length) x.xl = o.lines;
      if (o.dm) x.dm = o.dm;
      if (o.src) x.xs = o.src;
      if (o.uid) x.xu = o.uid;
      if (o.auth) x.xa = o.auth;
      if (o.xt) x.xt = o.xt;
      var nd = C.normDoc(x);
      if (!nd) return;
      d.docs.push(nd);
      ids.push({ i: o.i, id: id, number: o.num });
      undo.docs.push({ id: id, m: nd.m });
      if (o.paid) {
        var pid;
        do { pid = C.newId(); } while (C.anyId(d.pays, pid));
        var np = C.normPay({ id: pid, doc: id, date: o.paid.date, amt: C.totals(nd).pay, how: o.paid.how, note: "", m: s });
        if (np) { d.pays.push(np); undo.pays.push({ id: pid, m: np.m }); }
      }
    });
    if (!ids.length) return { ok: true, data: null, ids: [], skipped: skipped, undo: null };
    return { ok: true, data: C.normalize(d), ids: ids, skipped: skipped, undo: undo };
  }
  // Undo of invoices_record: tombstones what it made while unchanged
  // since (a client only while no other live document uses it).
  // → { ok, data, n, kept } | { ok: false }
  function invoicesUndo(C, raw, u, now) {
    if (!isObj(u) || !Array.isArray(u.docs) || !isObj(raw) || !Array.isArray(raw.docs)) return { ok: false };
    var d = C.normalize(raw), n = 0, kept = 0;
    function drop(listName, rec) {
      var cur = C.anyId(d[listName], rec.id);
      if (!cur || cur.del) return false;
      if (cur.m !== rec.m) { kept++; return false; }
      d[listName] = d[listName].map(function (y) { return y.id === rec.id ? { id: y.id, m: stampAfter(now, y.m), del: 1 } : y; });
      return true;
    }
    (u.pays || []).forEach(function (r) { if (isObj(r)) drop("pays", r); });
    u.docs.forEach(function (r) {
      if (!isObj(r)) return;
      if (C.live(d.pays).some(function (p) { return p.doc === r.id; })) { kept++; return; }   // a payment the owner added since
      if (drop("docs", r)) n++;
    });
    (u.clients || []).forEach(function (r) {
      if (!isObj(r)) return;
      if (C.live(d.docs).some(function (x) { return x.cli === r.id; })) return;
      drop("clients", r);
    });
    return { ok: true, data: C.normalize(d), n: n, kept: kept };
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
  // wave M1: music releases (title.mt, lists trk and med)
  var MTS = { single: "single", ep: "ep", album: "album", comp: "compilation" };
  var MEDS = { dig: "digital", cd: "cd", vin: "vinyl", cas: "cassette", ot: "other" };
  var CRS = { art: "artist", feat: "featured", comp: "composer", lyr: "lyricist", arr: "arranger", prod: "producer", mix: "mixing", mast: "mastering", eng: "engineer", mus: "musician", o: "other" };
  function isrcOut(c) { return typeof c === "string" && /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(c) ? c.slice(0, 2) + "-" + c.slice(2, 5) + "-" + c.slice(5, 7) + "-" + c.slice(7) : ""; }
  function publishTitles(raw, args) {
    if (!isObj(args)) return { ok: false, err: "The arguments must be an object." };
    // PUB-NODATA: no Publishing store on this device is not "no titles"; an empty answer led to a duplicate create
    if (!isObj(raw)) return { ok: false, err: "Publishing has no data on this device (it was not opened here yet), so this is not a list of the owner's titles. Do not create titles from this answer; ask again when orOS with Publishing is open." };
    var d = raw, tombs = isObj(d.tombs) ? d.tombs : {};
    function live(r) { return isObj(r) && typeof r.id === "string" && typeof r.ti === "string" && !(typeof tombs[r.id] === "number" && tombs[r.id] >= (Number(r.m) || 0)); }
    var trks = {}, meds = {};
    (Array.isArray(d.trk) ? d.trk : []).filter(live).forEach(function (r) { (trks[r.ti] = trks[r.ti] || []).push(r); });
    (Array.isArray(d.med) ? d.med : []).filter(live).forEach(function (r) { (meds[r.ti] = meds[r.ti] || []).push(r); });
    Object.keys(trks).forEach(function (k) { trks[k].sort(function (a, b) { return (a.disc || 1) - (b.disc || 1) || (a.no || 0) - (b.no || 0) || (a.id < b.id ? -1 : 1); }); });
    var st = args.status ? String(args.status) : "";
    var stKey = "";
    Object.keys(TITLE_ST).forEach(function (k) { if (k === st || TITLE_ST[k] === st) stKey = k; });
    if (st && !stKey) return { ok: false, err: "status must be one of: idea, in production, published, out of print." };
    var q = args.query ? fold(String(args.query).slice(0, 200)) : "";
    var rows = (Array.isArray(d.titles) ? d.titles : []).filter(function (x) {
      if (!isObj(x) || typeof x.id !== "string" || (typeof tombs[x.id] === "number" && tombs[x.id] >= (Number(x.m) || 0))) return false;
      if (stKey && x.st !== stKey) return false;
      if (q) {
        var hay = [x.t, x.sub, x.ser].concat((x.ppl || []).map(function (p) { return p && p.n; }), (x.fmts || []).map(function (f) { return f && f.isbn; }),
          (trks[x.id] || []).map(function (r) { return [r.t, r.isrc, isrcOut(r.isrc)].join(" "); }), (meds[x.id] || []).map(function (r) { return r.upc; }));
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
          // Publishing keeps the list price in units with 2 decimals (publish/core.js), not cents
          if (typeof f.price === "number" && isFinite(f.price)) r.price = (Math.round(f.price * 100) / 100).toFixed(2);
          if (f.pages) r.pages = f.pages;
          if (f.dur) r.duration = f.dur;
          put(r, "binding", f.bind); put(r, "paper", f.paper); put(r, "note", f.note);
          return r;
        });
        if (fm.length) o.formats = fm;
        if (isObj(x.mt)) {
          o.type = MTS[x.mt.k] || "single";
          put(o, "label", x.mt.lbl); put(o, "genre", x.mt.gen); put(o, "p_line", x.mt.pl); put(o, "c_line", x.mt.cl);
          var tr = (trks[x.id] || []).map(function (r) {
            var t = { no: r.no || 1, title: String(r.t || "") };
            if ((r.disc || 1) > 1) t.disc = r.disc;
            put(t, "version", r.ver); put(t, "artist", r.art); put(t, "isrc", isrcOut(r.isrc)); put(t, "language", r.lang);
            if (r.dur) t.length = Math.floor(r.dur / 60) + ":" + (r.dur % 60 < 10 ? "0" : "") + (r.dur % 60);
            if (r.ex === 1) t.explicit = true;
            // PB-MUS M2: who made it and who owns what (the change_item names)
            var cr = (Array.isArray(r.cr) ? r.cr : []).filter(isObj).map(function (c) { var y = { role: CRS[c.r] || "other", name: String(c.n || "") }; put(y, "instrument", c.ins); return y; });
            if (cr.length) t.credits = cr;
            [["sw", "writers"], ["sm", "masters"]].forEach(function (k) {
              var l = (Array.isArray(r[k[0]]) ? r[k[0]] : []).filter(isObj).map(function (x) {
                var y = { name: String(x.n || ""), share: typeof x.pct === "number" && isFinite(x.pct) ? x.pct : 0 };
                put(y, "society", x.soc); put(y, "ipi", x.ipi);
                return y;
              });
              if (l.length) t[k[1]] = l;
            });
            return t;
          });
          if (tr.length) o.tracks = tr;
          var ed = (meds[x.id] || []).map(function (r) {
            var e = { edition: MEDS[r.k] || "other" };
            put(e, "upc", r.upc); put(e, "catalogue_no", r.cat); put(e, "distributor", r.dist); put(e, "note", r.note);
            if (typeof r.price === "number" && r.price > 0) e.price = (Math.round(r.price * 100) / 100).toFixed(2);
            return e;
          });
          if (ed.length) o.editions = ed;
        }
        if (x.blurb) o.blurb = String(x.blurb).slice(0, TEXT_MAX);
        if (x.notes) o.notes = String(x.notes).slice(0, TEXT_MAX);
        if (x.kw) o.keywords = x.kw;
        return o;
      });
    var pg = pageOf(rows, args);
    if (pg.err) return { ok: false, err: pg.err };
    var data = { total: pg.total, titles: pg.rows };
    if (pg.next_offset) data.next_offset = pg.next_offset;
    return { ok: true, data: data };
  }

  // DOCS-1 W5: what search_data finds in Files' Documents (files/docs-due.js
  // searchHits); kept word for word in assistant/core.js search_data.
  var DOCS_NOTE = "search_data in Files also finds Documents: type, date, sender, tags, amount, expiry and keep-until dates, the file and the first 300 characters of the text. Files and folders on the disk also show their tag names (Tags: …), so a tag name finds them. Private documents (medical, IDs, or linked to Health, Cycle or Baby) never appear, and neither do their tags.";
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

  // APPLOCK-1: an app locked (or hidden) in Settings › Screen lock on
  // this device is never offered, open or not (shell.js
  // __orosAppLocked; none in Node).
  function lockedHere(id) {
    var f = root && root.__orosAppLocked;
    try { return typeof f === "function" && !!f(id); } catch (e) { return true; }
  }
  function barred(id) { return NEVER.indexOf(id) >= 0 || lockedHere(id); }
  // The apps Claude may read: offered (searchable and installed), not
  // NEVER or locked here, and set to "read" on this device.
  function allowed(offered, lv) {
    var l = isObj(lv) ? lv : {};
    return (Array.isArray(offered) ? offered : []).filter(function (a) {
      return a && !barred(a.id) && (l[a.id] === "read" || l[a.id] === "write");
    });
  }
  function toolsOf(id) {
    var t = ["search_data", "read_item"];
    if (SUMMARY[id] || ACT.indexOf(id) >= 0 || SUM_READ.indexOf(id) >= 0) t.push("app_summary");
    if (DOCS.indexOf(id) >= 0) t.push("read_in_app");
    if (LINES[id]) t.push(LINES[id]);
    if (id === "files") t = t.concat(FILE_READ);
    if (id === "layout") t = t.concat(FILE_READ);   // GL-2: its proofs and PDFs, read only
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
    // PEND-1: a queued change keeps its queue id (q) and, for create_items,
    // the items it made by index (p: { "<i>": { app, target, title, id } }),
    // so a p- ref finds its item on any device.
    if (typeof e.q === "string" && /^[A-Za-z0-9_-]{16}$/.test(e.q)) o.q = e.q;
    if (isObj(e.p)) {
      var pm = {};
      Object.keys(e.p).slice(0, 50).forEach(function (k) { var r = e.p[k]; if (/^\d{1,2}$/.test(k) && isObj(r) && typeof r.app === "string") pm[k] = r; });
      if (Object.keys(pm).length) o.p = pm;
    }
    if (typeof e.at === "number" && e.at > 0) o.at = Math.floor(e.at);
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
      if (!m.q && (o.q || e.q)) m.q = o.q || e.q;
      if (!m.p && (o.p || e.p)) m.p = clone(o.p || e.p);
      if (!m.at && (o.at || e.at)) m.at = o.at || e.at;
      by[e.id] = m;
    });
    var list = Object.keys(by).map(function (k) { return by[k]; })
      .sort(function (x, y) { return x.t - y.t || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0); });
    if (list.length > CHG_MAX) list = list.slice(list.length - CHG_MAX);
    list.forEach(function (e, i) { if (i < list.length - UNDO_MAX || e.done) delete e.x; if (i < list.length - UNDO_MAX) delete e.p; });
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
    (Array.isArray(d.acc) ? d.acc : []).forEach(function (a) { if (isObj(a) && typeof a.id === "string" && !deadIn(tombs, "acc", a)) accs.push({ id: a.id, n: String(a.n || a.id), cur: typeof a.cur === "string" ? a.cur : "" }); });
    (Array.isArray(d.cats) ? d.cats : []).forEach(function (c) { if (isObj(c) && typeof c.id === "string" && !deadIn(tombs, "cat", c)) cats.push({ id: c.id, n: String(c.name || c.id), k: c.k === "i" ? "i" : "o", p: typeof c.p === "string" ? c.p : "", dm: typeof c.dm === "string" ? c.dm : "" }); });
    return { accs: accs, cats: cats, areas: liveAreas(d).map(function (a) { return { id: a.id, n: a.n }; }) };
  }
  function findIn(list, v) {
    var f = fold(v), hit = null;
    list.forEach(function (x) { if (!hit && (x.id === String(v) || fold(x.n) === f)) hit = x; });
    return hit;
  }
  // A category: a stored one of that kind by name or id, or a built-in
  // id as budget_lines shows it (o-…, i-…).
  // Budget's built-in categories (budget.js SEEDS / SEED_NAMES), stored
  // only once changed. 6.05.03 (Chris 2026-11-10: «Uncategorized» in
  // Charts): an id like o-transport that is none of them was taken as a
  // built-in and Budget showed it as no category; now only these (by id
  // or their English or Greek name) are.
  var SEED_CATS = {
    "o-groc": ["Groceries", "Σούπερ μάρκετ"], "o-eat": ["Eating out", "Φαγητό έξω"], "o-bills": ["Bills", "Λογαριασμοί"],
    "o-home": ["Rent & home", "Ενοίκιο & σπίτι"], "o-trans": ["Transport", "Μεταφορές"], "o-health": ["Health", "Υγεία"],
    "o-fun": ["Entertainment", "Ψυχαγωγία"], "o-cloth": ["Clothing", "Ρούχα"], "o-gift": ["Gifts", "Δώρα"], "o-other": ["Other", "Άλλα"],
    "i-salary": ["Salary", "Μισθός"], "i-free": ["Freelance", "Ελεύθερο επάγγελμα"], "i-gift": ["Gifts", "Δώρα"], "i-other": ["Other", "Άλλα"]
  };
  function catOf(ix, v, k) {
    var mine = ix.cats.filter(function (c) { return c.k === k; });
    var hit = findIn(mine, v);
    if (hit) return hit.id;
    var s = String(v), f = fold(v), id = "";
    Object.keys(SEED_CATS).forEach(function (sid) {
      if (id || sid.charAt(0) !== k || mine.some(function (c) { return c.id === sid; })) return;
      if (sid === s || SEED_CATS[sid].some(function (n) { return fold(n) === f; })) id = sid;
    });
    return id;
  }
  function catList(ix, k) {
    var mine = ix.cats.filter(function (c) { return c.k === k; });
    var seeds = Object.keys(SEED_CATS).filter(function (sid) { return sid.charAt(0) === k && !mine.some(function (c) { return c.id === sid; }); });
    return mine.map(function (c) { return c.n; }).concat(seeds.map(function (sid) { return sid + " (" + SEED_CATS[sid][0] + ")"; })).join(", ");
  }
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
    if (e.area !== undefined) {
      if (e.area === "" || e.area === null) delete x.dm;
      else {
        var ar = findIn(ix.areas, e.area);
        if (!ar) return w + (ix.areas.length ? "no area \"" + String(e.area).slice(0, 60) + "\". Areas: " + ix.areas.map(function (a) { return a.n; }).join(", ") : "Budget has no areas yet (budget_areas makes them).");
        x.dm = ar.id;
      }
    }
    if (e.note !== undefined) {
      var n = String(e.note == null ? "" : e.note).replace(/\s+/g, " ").trim();
      if (n.length > NOTE_LEN) return w + "note is longer than " + NOTE_LEN + " characters.";
      x.n = n;
    }
    return "";
  }
  function emptyBudget() { return { ver: 1, tx: [], cats: [], acc: [], area: [], set: { m: 0, cur: "EUR" }, tombs: {} }; }

  // AR-INV (6.01.00): budget_areas — Budget's areas by name (budget.js
  // normArea). series = [{ id, prefix, kind }] from Invoices on this
  // device, or null when Invoices is not loaded. → { err } | { done }
  // and d.area / d.tombs changed in place, undo.r / undo.ra filled.
  var AREAS_MAX = 12, AREA_NAME = 40, AREA_WORDS = 300, AREA_SER = 20, SER_ID = /^[A-Za-z0-9_-]{1,64}$/;
  function areaKeys(o) {                       // budget.js key order: id, m, col, iv, n, pc, ps, q, sh, then extras
    var out = { id: o.id, m: o.m, col: o.col };
    if (o.iv) out.iv = o.iv;
    out.n = o.n;
    if (o.pc) out.pc = o.pc;
    if (o.ps === 1 && o.sh !== 1) out.ps = 1;
    out.q = o.q || "";
    if (o.sh === 1) out.sh = 1;
    Object.keys(o).sort().forEach(function (k) { if (!(k in out) && ["iv", "pc", "ps", "sh"].indexOf(k) < 0) out[k] = o[k]; });
    return out;
  }
  function areasWrite(d, args, now, newId, series, undo) {
    var list = args.areas;
    if (!Array.isArray(list) || !list.length || list.length > AREAS_MAX) return { err: "areas must be a list of 1 to " + AREAS_MAX + " areas." };
    if (!Array.isArray(d.area)) d.area = [];
    var live = liveAreas(d), touched = {}, i;
    function before(a) { if (!Object.prototype.hasOwnProperty.call(undo.r, a.id)) undo.r[a.id] = clone(a); }
    function find(name) {
      var f = fold(name), hit = null;
      live.forEach(function (a) { if (!hit && (a.id === String(name) || fold(a.n) === f)) hit = a; });
      return hit;
    }
    function serOf(v, w) {
      if (!series) return { err: w + "Invoices is not loaded on the device, so its series can't be checked; try again in a moment." };
      var s0 = String(v == null ? "" : v).trim(), f = fold(s0);
      var hit = series.filter(function (x) { return x.id === s0; });
      if (!hit.length) hit = series.filter(function (x) { return fold(x.prefix) === f; });
      if (hit.length === 1) return { id: hit[0].id };
      return { err: w + (hit.length ? "more than one Invoices series has the prefix \"" + s0.slice(0, 20) + "\"; use its id. " : "no Invoices series \"" + s0.slice(0, 20) + "\". ") +
        "Series: " + series.map(function (x) { return (x.prefix || "—") + " (" + x.id + ", " + x.kind + ")"; }).join(", ") };
    }
    for (i = 0; i < list.length; i++) {
      var e = list[i], w = "areas[" + i + "]: ";
      if (!isObj(e)) return { err: w + "must be an object." };
      var name = String(e.name == null ? "" : e.name).replace(/\s+/g, " ").trim();
      if (!name || name.length > AREA_NAME) return { err: w + "name is 1 to " + AREA_NAME + " characters." };
      var a = find(name);
      if (touched[a ? a.id : "new:" + fold(name)]) return { err: w + "the area \"" + name + "\" is in the list twice." };
      if (e.remove === true) {
        if (!a) return { err: w + "there is no area \"" + name + "\" to remove." };
        before(a);
        d.area = d.area.filter(function (y) { return !(isObj(y) && y.id === a.id); });
        d.tombs["area:" + a.id] = stampAfter(now, Math.max(d.tombs["area:" + a.id] || 0, a.m || 0));
        undo.ra[a.id] = null;
        touched[a.id] = 1;
        live = liveAreas(d);
        continue;
      }
      var y = a ? clone(a) : null;
      if (!y) {
        if (live.length >= AREAS_MAX) return { err: "Budget has " + AREAS_MAX + " areas already; remove one first." };
        var used = {}, col = 0, id;
        live.forEach(function (x) { used[x.col] = 1; });
        while (col < 8 && used[col]) col++;
        do { id = String(newId()); } while (!TX_ID.test(id) || d.area.some(function (x) { return isObj(x) && x.id === id; }) || d.tombs["area:" + id] !== undefined);
        y = { id: id, m: 0, col: col, n: name, q: "" };
        undo.r[id] = null;
      } else before(a);
      if (e.rename !== undefined) {
        var nn = String(e.rename == null ? "" : e.rename).replace(/\s+/g, " ").trim();
        if (!nn || nn.length > AREA_NAME) return { err: w + "rename is 1 to " + AREA_NAME + " characters." };
        var other = find(nn);
        if (other && other.id !== y.id) return { err: w + "an area \"" + nn + "\" exists already." };
        y.n = nn;
      }
      if (e.words !== undefined) {
        var q = String(e.words == null ? "" : e.words).replace(/\s+/g, " ").trim();
        if (q.length > AREA_WORDS) return { err: w + "words are at most " + AREA_WORDS + " characters." };
        y.q = q;
      }
      if (e.invoice_series !== undefined) {
        if (!Array.isArray(e.invoice_series) || e.invoice_series.length > AREA_SER) return { err: w + "invoice_series is a list of at most " + AREA_SER + " series (prefixes or ids)." };
        var ids = [];
        for (var j = 0; j < e.invoice_series.length; j++) {
          var r = serOf(e.invoice_series[j], w);
          if (r.err) return { err: r.err };
          if (ids.indexOf(r.id) < 0) ids.push(r.id);
        }
        ids.sort();
        if (ids.length) y.iv = ids.join(" "); else delete y.iv;
      }
      if (e.share !== undefined) {
        if (!(typeof e.share === "number" && Math.floor(e.share) === e.share && e.share >= 0 && e.share <= 100)) return { err: w + "share is a whole number from 0 to 100 (% of the shared costs)." };
        if (e.share) y.pc = e.share; else delete y.pc;
      }
      if (e.shared_costs !== undefined) {
        if (typeof e.shared_costs !== "boolean") return { err: w + "shared_costs is true or false." };
        if (e.shared_costs) {
          y.sh = 1; delete y.pc; delete y.ps;
          live.forEach(function (x) {                // one area of shared costs
            if (x.id === y.id || x.sh !== 1) return;
            before(x);
            var z = clone(x); delete z.sh; z.m = stampAfter(now, x.m);
            d.area = d.area.map(function (q2) { return isObj(q2) && q2.id === x.id ? areaKeys(z) : q2; });
            undo.ra[x.id] = z.m;
          });
        } else delete y.sh;
      }
      if (e.personal !== undefined) {               // AR-VIEW: a personal area
        if (typeof e.personal !== "boolean") return { err: w + "personal is true or false." };
        if (e.personal) { y.ps = 1; delete y.pc; } else delete y.ps;
      }
      if (y.ps === 1 && y.sh === 1) return { err: w + "the area of shared costs can't be personal." };
      if (y.ps === 1 && e.share) return { err: w + "a personal area has no share of the shared costs." };
      if (y.sh === 1 && e.share) return { err: w + "the area of shared costs has no share of itself." };
      touched[a ? a.id : "new:" + fold(name)] = 1;
      if (a && JSON.stringify(areaKeys(Object.assign({}, y, { m: a.m }))) === JSON.stringify(areaKeys(a))) {
        if (!Object.prototype.hasOwnProperty.call(undo.ra, a.id)) delete undo.r[a.id];   // nothing changed in it
        continue;
      }
      y.m = stampAfter(now, a ? a.m : (d.tombs["area:" + y.id] || 0));
      y = areaKeys(y);
      if (a) d.area = d.area.map(function (q3) { return isObj(q3) && q3.id === a.id ? y : q3; });
      else d.area.push(y);
      undo.ra[y.id] = y.m;
      touched[y.id] = 1;
      live = liveAreas(d);
    }
    var sum = 0;
    live.forEach(function (x) { if (x.sh !== 1 && typeof x.pc === "number") sum += x.pc; });
    if (sum > 100) return { err: "The shares would add up to " + sum + "%; at most 100%. Nothing was changed." };
    d.area.sort(function (p1, p2) { return p1.id < p2.id ? -1 : p1.id > p2.id ? 1 : 0; });
    var n = Object.keys(undo.ra).length;
    return { done: "Areas now: " + live.map(function (x) { return x.n; }).join(", ") + " (" + n + " changed).", n: n };
  }

  // AR-CAT (6.02.00): budget_categories — Budget's own categories by
  // kind and name (budget.js normCat: keys id, m, k, name, col, then the
  // extras in name order: dm (area), ic, p (main category), pv). All or
  // none. → { err } | { done, n }; d.cats / d.tombs changed in place,
  // undo.c (category before | null) and undo.ca (m after | null) filled.
  var CAT_NAME = 30, CATS_MAX = 60, CATS_CALL = 30, CAT_ID = /^[a-z0-9-]{1,64}$/;
  function catKeys(o) {
    var out = { id: o.id, m: o.m, k: o.k, name: o.name, col: o.col };
    Object.keys(o).sort().forEach(function (k) { if (!(k in out)) out[k] = o[k]; });
    return out;
  }
  function catsWrite(d, args, now, newId, undo) {
    var list = args.categories;
    if (!Array.isArray(list) || !list.length || list.length > CATS_CALL) return { err: "categories must be a list of 1 to " + CATS_CALL + " categories." };
    if (!Array.isArray(d.cats)) d.cats = [];
    var areas = liveAreas(d), n = 0, i;
    function live() { return d.cats.filter(function (c) { return isObj(c) && typeof c.id === "string" && (c.k === "o" || c.k === "i") && !deadIn(d.tombs, "cat", c); }); }
    function find(k, v) {
      var f = fold(v), hit = null;
      live().forEach(function (c) { if (!hit && c.k === k && (c.id === String(v) || fold(c.name || c.id) === f)) hit = c; });
      return hit;
    }
    function before(c) { if (!Object.prototype.hasOwnProperty.call(undo.c, c.id)) undo.c[c.id] = clone(c); }
    function put(y) {
      d.cats = d.cats.filter(function (q) { return !(isObj(q) && q.id === y.id); }).concat([catKeys(y)]);
      undo.ca[y.id] = y.m; n++;
    }
    for (i = 0; i < list.length; i++) {
      var e = list[i], w = "categories[" + i + "]: ";
      if (!isObj(e)) return { err: w + "must be an object." };
      if (e.kind !== "expense" && e.kind !== "income") return { err: w + "kind must be expense or income." };
      var k = e.kind === "income" ? "i" : "o";
      var name = String(e.name == null ? "" : e.name).replace(/\s+/g, " ").trim();
      if (!name || name.length > CAT_NAME) return { err: w + "name is 1 to " + CAT_NAME + " characters." };
      var c = find(k, name);
      if (e.remove === true) {
        if (!c) return { err: w + "there is no " + e.kind + " category \"" + name + "\" to remove." };
        var used = (Array.isArray(d.tx) ? d.tx : []).filter(function (x) { return isObj(x) && x.c === c.id && !deadIn(d.tombs, "tx", x); }).length;
        if (used) return { err: w + used + " entr" + (used === 1 ? "y uses" : "ies use") + " \"" + name + "\"; give them another category first. Nothing was changed." };
        if (live().some(function (y) { return y.p === c.id; })) return { err: w + "\"" + name + "\" has subcategories; move or remove them first. Nothing was changed." };
        before(c);
        d.cats = d.cats.filter(function (q) { return !(isObj(q) && q.id === c.id); });
        d.tombs["cat:" + c.id] = stampAfter(now, Math.max(d.tombs["cat:" + c.id] || 0, c.m || 0));
        undo.ca[c.id] = null; n++;
        continue;
      }
      var y = c ? clone(c) : null;
      if (!y) {
        if (live().length >= CATS_MAX) return { err: "Budget has " + CATS_MAX + " stored categories already; remove one first." };
        var cols = {}, col = 0, id;
        live().forEach(function (x) { if (x.k === k) cols[x.col] = 1; });
        while (col < 8 && cols[col]) col++;
        do { id = "u" + String(newId()); } while (!CAT_ID.test(id) || d.cats.some(function (x) { return isObj(x) && x.id === id; }) || d.tombs["cat:" + id] !== undefined);
        y = { id: id, m: 0, k: k, name: name, col: col % 8 };
        undo.c[id] = null;
      } else before(c);
      if (e.rename !== undefined) {
        var nn = String(e.rename == null ? "" : e.rename).replace(/\s+/g, " ").trim();
        if (!nn || nn.length > CAT_NAME) return { err: w + "rename is 1 to " + CAT_NAME + " characters." };
        var other = find(k, nn);
        if (other && other.id !== y.id) return { err: w + "an " + e.kind + " category \"" + nn + "\" exists already." };
        y.name = nn;
      }
      if (e.main !== undefined) {
        if (e.main === "" || e.main === null) delete y.p;
        else {
          var m = find(k, e.main);
          if (!m || m.id === y.id) return { err: w + "no other " + e.kind + " category \"" + String(e.main).slice(0, 40) + "\" to put it under." };
          if (m.p) return { err: w + "\"" + (m.name || m.id) + "\" is a subcategory itself; one level only." };
          if (live().some(function (x) { return x.p === y.id; })) return { err: w + "\"" + name + "\" has subcategories, so it stays a main category." };
          y.p = m.id;
        }
      }
      if (e.area !== undefined) {
        if (e.area === "" || e.area === null) delete y.dm;
        else {
          var ar = findIn(areas, e.area);
          if (!ar) return { err: w + (areas.length ? "no area \"" + String(e.area).slice(0, 60) + "\". Areas: " + areas.map(function (a) { return a.n; }).join(", ") : "Budget has no areas yet (budget_areas makes them).") };
          y.dm = ar.id;
        }
      }
      if (y.p && y.dm) return { err: w + "a subcategory takes its main category's area; set the area on the main one." };
      if (c && JSON.stringify(catKeys(Object.assign({}, y, { m: c.m }))) === JSON.stringify(catKeys(c))) {
        if (!Object.prototype.hasOwnProperty.call(undo.ca, c.id)) delete undo.c[c.id];
        continue;
      }
      y.m = stampAfter(now, c ? c.m : (d.tombs["cat:" + y.id] || 0));
      put(y);
    }
    d.cats.sort(function (p1, p2) { return p1.id < p2.id ? -1 : p1.id > p2.id ? 1 : 0; });
    var changed = Object.keys(undo.ca).length;
    return { done: changed + " categor" + (changed === 1 ? "y" : "ies") + " changed.", n: changed };
  }
  // AR-XF (6.02.00): budget_transfer — an entry that is money moved
  // between the owner's own accounts becomes a transfer (budget.js
  // normXfer: { id, m, d, a, f, t, n }), with its other side on the other
  // account when given (budget.js canXfer / xferTwins). The entries are
  // deleted (tombed); undo.b / undo.a hold them, undo.x / undo.xa the transfer.
  function canXferTx(x) { return isObj(x) && typeof x.id === "string" && x.id.indexOf("l-") !== 0 && !x.rc && typeof x.oc !== "string" && typeof x.a === "number" && x.a > 0; }
  function xferWrite(d, args, now, newId, ix, undo) {
    var id = String(args.id || ""), at = liveTx(d, id);
    if (at < 0) return { err: "No Budget entry with id " + id.slice(0, 64) + "." };
    var x = d.tx[at];
    if (!canXferTx(x)) return { err: id.indexOf("l-") === 0 ? "That entry comes from another app or a shop; it can't become a transfer." : "That entry has receipts or another currency; turn it into a transfer in Budget." };
    var mine = x.ac ? findIn(ix.accs, x.ac) : null;
    if (!mine || mine.id !== x.ac) return { err: "That entry has no Budget account; give it one first (budget_change account)." };
    var oth = findIn(ix.accs, args.other_account);
    if (!oth) return { err: "no Budget account \"" + String(args.other_account == null ? "" : args.other_account).slice(0, 60) + "\". Accounts: " + ix.accs.map(function (a) { return a.n; }).join(", ") };
    if (oth.id === mine.id) return { err: "other_account is the entry's own account." };
    if ((mine.cur || "") !== (oth.cur || "")) return { err: "The two accounts have different currencies; make this transfer in Budget." };
    var twin = null;
    if (args.other_id !== undefined && args.other_id !== null && args.other_id !== "") {
      var tid = String(args.other_id), tk = liveTx(d, tid);
      if (tk < 0) return { err: "No Budget entry with id " + tid.slice(0, 64) + "." };
      twin = d.tx[tk];
      var gap = Math.abs(dayDiff(x.d, twin.d));
      if (!canXferTx(twin) || twin.id === x.id || twin.ac !== oth.id || twin.k === x.k || twin.a !== x.a || !(gap <= 5)) {
        return { err: tid + " is not the other side of " + id + " (it must be on " + oth.n + ", the opposite kind, the same amount, at most 5 days apart, without receipts)." };
      }
    }
    var xid;
    do { xid = String(newId()); } while (!TX_ID.test(xid) || (Array.isArray(d.xfer) && d.xfer.some(function (q) { return isObj(q) && q.id === xid; })) || d.tombs["xfer:" + xid] !== undefined);
    var note = String(x.n || x.ot || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, NOTE_LEN);
    var nx = { id: xid, m: stampAfter(now, 0), d: x.d, a: x.a, f: x.k === "o" ? mine.id : oth.id, t: x.k === "o" ? oth.id : mine.id, n: note };
    if (!Array.isArray(d.xfer)) d.xfer = [];
    d.xfer.push(nx);
    d.xfer.sort(function (p1, p2) { return p1.id < p2.id ? -1 : p1.id > p2.id ? 1 : 0; });
    undo.x[xid] = null; undo.xa[xid] = nx.m;
    var ids = [x.id].concat(twin ? [twin.id] : []);
    ids.forEach(function (tid2) {
      var k = liveTx(d, tid2), gone = d.tx.splice(k, 1)[0];
      undo.b[tid2] = clone(gone); undo.a[tid2] = null;
      d.tombs["tx:" + tid2] = stampAfter(now, Math.max(d.tombs["tx:" + tid2] || 0, gone.m || 0));
    });
    return { done: "Transfer " + xid + " from " + (x.k === "o" ? mine.n : oth.n) + " to " + (x.k === "o" ? oth.n : mine.n) + " made; deleted " + ids.join(", ") + ".", ids: [xid].concat(ids) };
  }

  // AC-GATE (6.04.00, Chris 2026-11-10 «zero difference every day»):
  // accounts' balances as Budget counts them (= budget.js accBalances,
  // tests/budget-accounts.test.js keeps the two equal), L = budget/loans.js
  // when loaded. → { accountId: cents }, live accounts only.
  function accBals(d, L, upto) {
    var tombs = isObj(d.tombs) ? d.tombs : {}, bal = {};
    function live(key, tomb) { return (Array.isArray(d[key]) ? d[key] : []).filter(function (x) { return isObj(x) && typeof x.id === "string" && !deadIn(tombs, tomb, x); }); }
    live("acc", "acc").forEach(function (a) { bal[a.id] = typeof a.o === "number" ? a.o : 0; });
    live("tx", "tx").forEach(function (x) { if (x.ac && bal[x.ac] !== undefined && x.d <= upto) bal[x.ac] += x.k === "i" ? x.a : -x.a; });
    live("xfer", "xfer").forEach(function (x) {
      if (x.d > upto) return;
      if (bal[x.f] !== undefined) bal[x.f] -= x.a;
      if (bal[x.t] !== undefined) bal[x.t] += x.a;
    });
    live("adj", "adj").forEach(function (x) { if (x.d <= upto && bal[x.ac] !== undefined) bal[x.ac] += x.a; });
    if (L && typeof L.balanceMoves === "function") {
      var mv = L.balanceMoves(live("loan", "loan"), live("lpay", "lpay"), upto);
      Object.keys(mv).forEach(function (id) { if (bal[id] !== undefined) bal[id] += mv[id]; });
    }
    return bal;
  }
  // The bank's last balance for an account (BK-5: bnk rows, PayPal's left out).
  function bankBal(d, a, cu) {
    var r = null;
    (Array.isArray(d.bnk) ? d.bnk : []).forEach(function (x) {
      if (isObj(x) && x.src !== "pp" && x.ac === a.id && x.bc === cu && typeof x.bb === "number" && typeof x.bd === "string" && YMD.test(x.bd) && (!r || x.bd > r.bd)) r = x;
    });
    return r;
  }
  // budget_lines `accounts`: each live account with its balance at the
  // end of `upto`, and the bank's last balance next to Budget's on that day.
  function accountsOut(d, L, upto) {
    var tombs = isObj(d.tombs) ? d.tombs : {}, ars = {};
    var main = isObj(d.set) && typeof d.set.cur === "string" && /^[A-Z]{3}$/.test(d.set.cur) ? d.set.cur : "EUR";
    liveAreas(d).forEach(function (a) { ars[a.id] = a.n; });
    var bal = accBals(d, L, upto), memo = {};
    return (Array.isArray(d.acc) ? d.acc : []).filter(function (a) { return isObj(a) && typeof a.id === "string" && !deadIn(tombs, "acc", a); }).map(function (a) {
      var cu = typeof a.cur === "string" && /^[A-Z]{3}$/.test(a.cur) ? a.cur : main;
      var o = { name: String(a.n || a.id), id: a.id, currency: cu, balance: cents(bal[a.id]) };
      if (typeof a.dm === "string" && ars[a.dm]) o.area = ars[a.dm];
      if (typeof a.cys === "number") o.credit_card = true;
      if (typeof a.chk === "string") o.checked = a.chk;
      if (a.am === true) o.auto_match = true;
      var r = bankBal(d, a, cu);
      if (r) {
        if (!memo[r.bd]) memo[r.bd] = accBals(d, L, r.bd);
        var mine = memo[r.bd][a.id] || 0;
        o.bank = { day: r.bd, balance: cents(r.bb), budget_that_day: cents(mine), difference: cents(r.bb - mine) };
      }
      return o;
    }).sort(function (x, y) { return fold(x.name) < fold(y.name) ? -1 : fold(x.name) > fold(y.name) ? 1 : 0; });
  }
  // budget_lines `possible_duplicates`: the same purchase read twice,
  // e.g. from the card's feed and days later from the account it is
  // charged to (Chris's check of 10/11: 26 pairs in Aug–Sep). Two
  // expenses of the same amount, 0–4 days apart, not the same bank
  // line, on different accounts (or one without), whose texts share a
  // word once Greek look-alike letters are read as Latin ones.
  var GR_LOOK = { "α": "a", "β": "b", "ε": "e", "ζ": "z", "η": "h", "ι": "i", "κ": "k", "μ": "m", "ν": "n", "ο": "o", "ρ": "p", "τ": "t", "υ": "y", "χ": "x" };
  var GR_LAT = { "α": "a", "β": "v", "γ": "g", "δ": "d", "ε": "e", "ζ": "z", "η": "i", "θ": "th", "ι": "i", "κ": "k", "λ": "l", "μ": "m", "ν": "n", "ξ": "x", "ο": "o", "π": "p", "ρ": "r", "σ": "s", "τ": "t", "υ": "y", "φ": "f", "χ": "ch", "ψ": "ps", "ω": "o" };
  var DUP_SKIP = { agora: 1, aghora: 1, purchase: 1, pos: 1, card: 1, karta: 1, pliromi: 1, plir: 1, apo: 1, pros: 1, the: 1, com: 1, www: 1, ltd: 1, ike: 1 };
  function dupWords(s) {
    var out = {};
    fold(s).split(/[^a-zα-ω]+/).forEach(function (w) {
      if (!w) return;
      var mixed = /[a-z]/.test(w) && /[α-ω]/.test(w), map = mixed ? GR_LOOK : GR_LAT;
      var v = w.replace(/[α-ω]/g, function (c) { return map[c] || ""; });
      if (v.length >= 3 && !DUP_SKIP[v]) out[v.slice(0, 6)] = 1;
    });
    return out;
  }
  function dupPairs(rows, max) {
    var ex = rows.filter(function (x) { return x.k === "o" && typeof x.a === "number" && x.a > 0; });
    var words = {}, used = {}, out = [];
    ex.forEach(function (x) { words[x.id] = dupWords((x.n || "") + " " + (x.ot || "")); });
    var cand = [];
    ex.forEach(function (x, i) {
      for (var j = i + 1; j < ex.length; j++) {
        var y = ex[j], gap = Math.abs(dayDiff(x.d, y.d));
        if (y.a !== x.a || gap > 4) continue;
        if (x.ac && y.ac && x.ac === y.ac) continue;
        if (typeof x.fit === "string" && x.fit === y.fit) continue;
        var share = Object.keys(words[x.id]).some(function (w) { return words[y.id][w]; });
        if (share) cand.push({ x: x, y: y, gap: gap });
      }
    });
    cand.sort(function (p, q) { return p.gap - q.gap || (p.x.d < q.x.d ? -1 : p.x.d > q.x.d ? 1 : 0); });
    cand.forEach(function (c) {
      if (out.length >= max || used[c.x.id] || used[c.y.id]) return;
      used[c.x.id] = used[c.y.id] = 1;
      var a = c.x.d <= c.y.d ? c.x : c.y, b = a === c.x ? c.y : c.x;
      out.push({ ids: [a.id, b.id], amount: cents(a.a), dates: [a.d, b.d], texts: [String(a.n || a.ot || ""), String(b.n || b.ot || "")] });
    });
    return out.sort(function (p, q) { return p.dates[0] < q.dates[0] ? -1 : p.dates[0] > q.dates[0] ? 1 : 0; });
  }
  // 6.05.02 (Chris 2026-11-10 «Πρέπει να μπορείς να δουλεύεις και με
  // κλειστό το orOS»): Budget's lines for the closed-orOS copy = every
  // line of the 400 days up to `today` as budget_lines gives them, with
  // its accounts, areas, categories and possible duplicates; the oldest
  // days go first when it is over max bytes. → JSON text | "" (relay/gate.js
  // closedLines answers budget_lines from it)
  function bglCopy(raw, today, L, max) {
    if (!isObj(raw) || !YMD.test(today)) return "";
    var t0 = new Date(Date.parse(today + "T00:00:00Z") - SPAN_DAYS * 86400000).toISOString().slice(0, 10);
    var lines = [], head = null, off = 0, r;
    do {
      r = budgetLines(raw, { from: t0, to: today, offset: off }, L);
      if (!r.ok) return "";
      if (!head) head = r.data;
      lines = lines.concat(r.data.lines);
      off = r.data.next_offset || 0;
    } while (off);
    var out = { from: t0, to: today, currency: head.currency, lines: lines };
    ["areas", "categories", "accounts", "possible_duplicates"].forEach(function (k) { if (head[k]) out[k] = head[k]; });
    var txt = JSON.stringify(out);
    while (utf8Len(txt) > max && out.lines.length) {
      var day = out.lines[0].date, cut = Math.max(1, Math.ceil(out.lines.length / 10));
      while (cut < out.lines.length && out.lines[cut].date === out.lines[cut - 1].date) cut++;
      out.lines = out.lines.slice(cut);
      out.from = out.lines.length ? out.lines[0].date : today;
      if (out.from === day) break;
      var keep = {};
      out.lines.forEach(function (x) { keep[x.id] = 1; });
      if (out.possible_duplicates) out.possible_duplicates = out.possible_duplicates.filter(function (p) { return keep[p.ids[0]] && keep[p.ids[1]]; });
      txt = JSON.stringify(out);
    }
    return utf8Len(txt) > max ? "" : txt;
  }
  // AC-GATE: budget_balances — the owner's real balance of an account on
  // a day; Budget is brought to it as Budget's own "Update balance" does
  // (budget.js correctBal, AC-2): an account with nothing but a starting
  // balance has that changed, any other gets a balance correction (adj)
  // on that day, never income or an expense. chk = the day. All or none.
  var BAL_MAX = 20;
  function toSigned(v) {
    var s = typeof v === "number" ? String(v) : String(v == null ? "" : v).trim().replace(/\s/g, "").replace(/^−/, "-").replace(",", ".");
    if (!/^-?\d{1,12}(\.\d{1,2})?$/.test(s)) return null;
    var c = Math.round(parseFloat(s) * 100);
    return Math.abs(c) <= MAX_CENTS ? c : null;
  }
  function accKeys(o) {                        // budget.js normAcc key order: id, m, n, o, col, then extras by name
    var y = { id: o.id, m: o.m, n: o.n, o: o.o, col: o.col };
    Object.keys(o).filter(function (k) { return !(k in y); }).sort().forEach(function (k) { y[k] = o[k]; });
    Object.keys(y).forEach(function (k) { if (y[k] === undefined) delete y[k]; });
    return y;
  }
  function balWrite(d, args, now, newId, ix, L, undo) {
    var list = args.accounts;
    if (!Array.isArray(list) || !list.length) return { err: "accounts must be a list of 1 to " + BAL_MAX + " accounts." };
    if (list.length > BAL_MAX) return { err: "At most " + BAL_MAX + " accounts per call." };
    if (!Array.isArray(d.acc)) d.acc = [];
    if (!Array.isArray(d.adj)) d.adj = [];
    var seen = {}, plan = [], i;
    for (i = 0; i < list.length; i++) {
      var e = list[i], w = "accounts[" + i + "]: ";
      if (!isObj(e)) return { err: w + "must be an object." };
      var a = findIn(ix.accs, e.account);
      if (!a) return { err: w + "no Budget account \"" + String(e.account == null ? "" : e.account).slice(0, 60) + "\". Accounts: " + ix.accs.map(function (q) { return q.n; }).join(", ") };
      if (seen[a.id]) return { err: w + a.n + " is in the list twice." };
      seen[a.id] = 1;
      var day = String(e.date || "");
      if (!YMD.test(day) || isNaN(Date.parse(day))) return { err: w + "date must be the day of that balance, YYYY-MM-DD." };
      var want = toSigned(e.balance);
      if (want === null) return { err: w + "balance must be an amount with at most 2 decimals, e.g. \"2770.56\" or \"-1447.37\" (a card's or a loan's debt is negative)." };
      plan.push({ a: a, day: day, want: want });
    }
    var done = [], ids = [];
    plan.forEach(function (p) {
      var mine = accBals(d, L, p.day)[p.a.id] || 0, diff = p.want - mine;
      var acc = d.acc.filter(function (x) { return isObj(x) && x.id === p.a.id && !deadIn(d.tombs, "acc", x); })[0];
      if (!acc) return;
      if (!diff) { done.push(p.a.n + " already " + cents(p.want)); return; }
      function before() { if (!Object.prototype.hasOwnProperty.call(undo.ac, acc.id)) undo.ac[acc.id] = clone(acc); }
      var used = (d.tx || []).some(function (x) { return isObj(x) && x.ac === acc.id && !deadIn(d.tombs, "tx", x); }) ||
        (d.xfer || []).some(function (x) { return isObj(x) && (x.f === acc.id || x.t === acc.id) && !deadIn(d.tombs, "xfer", x); }) ||
        d.adj.some(function (x) { return isObj(x) && x.ac === acc.id && !deadIn(d.tombs, "adj", x); }) ||
        (d.loan || []).some(function (x) { return isObj(x) && x.ac === acc.id; }) ||
        (d.lpay || []).some(function (x) { return isObj(x) && x.ac === acc.id; });
      before();
      var y = clone(acc);
      if (!used) {
        var o = (typeof y.o === "number" ? y.o : 0) + diff;
        if (Math.abs(o) > MAX_CENTS) return;
        y.o = o;
      } else {
        var jid;
        do { jid = String(newId()); } while (!TX_ID.test(jid) || d.adj.some(function (q) { return isObj(q) && q.id === jid; }) || d.tombs["adj:" + jid] !== undefined);
        var j = { id: jid, m: stampAfter(now, 0), a: diff, ac: acc.id, d: p.day, n: "" };
        d.adj.push(j);
        undo.j[jid] = null; undo.ja[jid] = j.m;
        ids.push(jid);
      }
      y.chk = p.day > (typeof acc.chk === "string" ? acc.chk : "") ? p.day : acc.chk;
      y.m = stampAfter(now, acc.m);
      y = accKeys(y);
      d.acc = d.acc.map(function (q) { return q === acc ? y : q; });
      undo.aca[acc.id] = y.m;
      ids.push(acc.id);
      done.push(p.a.n + " " + cents(mine) + " → " + cents(p.want) + " (" + (diff > 0 ? "+" : "") + cents(diff) + (used ? ", balance correction on " + p.day : ", starting balance") + ")");
    });
    d.adj.sort(function (p1, p2) { return p1.id < p2.id ? -1 : p1.id > p2.id ? 1 : 0; });
    return { done: done.join("; ") + ".", ids: ids, n: Object.keys(undo.aca).length };
  }

  // op = "add" | "change" | "delete"; raw = oros-budget-data; now = ms;
  // newId() → a fresh id. → { ok, data, undo, ids, text } | { ok:false, err }
  // undo = { b: { id: entry before | null }, a: { id: m after | null } }
  function budgetWrite(op, raw, args, now, newId, series, L) {
    if (!isObj(args)) return { ok: false, err: "The arguments must be an object." };
    var d = isObj(raw) ? clone(raw) : emptyBudget();
    if (!Array.isArray(d.tx)) d.tx = [];
    if (!isObj(d.tombs)) d.tombs = {};
    var ix = bgIndex(d), undo = { b: {}, a: {} }, ids = [], i, err;
    if (op === "areas") {
      undo.r = {}; undo.ra = {};
      var ar = areasWrite(d, args, now, newId, series === undefined ? null : series, undo);
      if (ar.err) return { ok: false, err: ar.err };
      if (!ar.n) return { ok: false, err: "Nothing would change: the areas already look like that." };
      var t2 = {};
      Object.keys(d.tombs).sort().forEach(function (k) { t2[k] = d.tombs[k]; });
      d.tombs = t2;
      return { ok: true, data: d, undo: undo, ids: Object.keys(undo.ra).sort(), text: ar.done };
    }
    if (op === "cats") {
      undo.c = {}; undo.ca = {};
      var cr = catsWrite(d, args, now, newId, undo);
      if (cr.err) return { ok: false, err: cr.err };
      if (!cr.n) return { ok: false, err: "Nothing would change: the categories already look like that." };
      sortTx(d);
      return { ok: true, data: d, undo: undo, ids: Object.keys(undo.ca).sort(), text: cr.done };
    }
    if (op === "bal") {
      undo.ac = {}; undo.aca = {}; undo.j = {}; undo.ja = {};
      var br = balWrite(d, args, now, newId, ix, L || null, undo);
      if (br.err) return { ok: false, err: br.err };
      if (!br.n) return { ok: false, err: "Nothing would change: " + br.done };
      return { ok: true, data: d, undo: undo, ids: br.ids, text: br.done };
    }
    if (op === "xfer") {
      undo.x = {}; undo.xa = {};
      var xr = xferWrite(d, args, now, newId, ix, undo);
      if (xr.err) return { ok: false, err: xr.err };
      sortTx(d);
      return { ok: true, data: d, undo: undo, ids: xr.ids, text: xr.done };
    }
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
      var keys = ["date", "amount", "category", "account", "area", "note"].filter(function (k) { return args[k] !== undefined; });
      // AR-INV: an entry from another app or a shop takes only an area here
      // (as in Budget's own form, where yours wins over the source)
      if (cid.indexOf("l-") === 0 && !(keys.length === 1 && keys[0] === "area")) return { ok: false, err: "That entry comes from another app or a shop; change it there (only its area can change here)." };
      var cx = d.tx[at], before = clone(cx), y = clone(cx);
      if (!keys.length) return { ok: false, err: "Say what to change: date, amount, category, account, area or note." };
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
    // AR-INV: an areas change (u.r = area before | null, u.ra = m after
    // | null); AR-CAT: categories (u.c / u.ca); AR-XF: the transfer made
    // (u.x / u.xa). Each item only while it still looks as the change left it.
    function coll(key, tomb, r, ra) {
      if (!isObj(r) || !isObj(ra)) return;
      if (!Array.isArray(d[key])) d[key] = [];
      Object.keys(r).forEach(function (id) {
        var cur = d[key].filter(function (x) { return isObj(x) && x.id === id && !deadIn(d.tombs, tomb, x); })[0] || null;
        var was = r[id], after = ra[id];
        if (after === null) {                       // the change removed it
          if (cur || !isObj(was)) { kept++; return; }
          var x = clone(was);
          x.m = stampAfter(now, Math.max(x.m || 0, d.tombs[tomb + ":" + id] || 0));
          delete d.tombs[tomb + ":" + id];
          d[key] = d[key].filter(function (y) { return !(isObj(y) && y.id === id); }).concat([x]);
          n++;
          return;
        }
        if (!cur || cur.m !== after) { kept++; return; }
        if (was === null) {                         // the change made it
          d.tombs[tomb + ":" + id] = stampAfter(now, Math.max(d.tombs[tomb + ":" + id] || 0, cur.m || 0));
          d[key] = d[key].filter(function (y) { return !(isObj(y) && y.id === id); });
          n++;
          return;
        }
        var back = clone(was);
        back.m = stampAfter(now, cur.m);
        d[key] = d[key].map(function (y) { return isObj(y) && y.id === id ? back : y; });
        n++;
      });
      d[key].sort(function (p1, p2) { return p1.id < p2.id ? -1 : p1.id > p2.id ? 1 : 0; });
    }
    coll("area", "area", u.r, u.ra);
    coll("cats", "cat", u.c, u.ca);
    coll("xfer", "xfer", u.x, u.xa);
    coll("adj", "adj", u.j, u.ja);
    coll("acc", "acc", u.ac, u.aca);
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
  var KB_TEXT = 500, KB_NOTES = 5000, KB_ADD = 50, KB_MOVE = 100, KB_COLS = 20; var KB_SUBS = 30, KB_SUBS_MAX = 100;
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
  // KB-LABEL (Chris 2026-11-23): labels made through the Gate, in Kanban's
  // own 8 colours by name (the next unused one when left out).
  var KB_COLORS = { red: "#e06c75", yellow: "#ecc75f", green: "#87cf3e", teal: "#4fc4cf", purple: "#6d4aff", pink: "#e09ecf", orange: "#f28c5a", grey: "#9aa4b0" };
  var KB_COLOR_LIST = ["#e06c75", "#ecc75f", "#87cf3e", "#4fc4cf", "#6d4aff", "#e09ecf", "#f28c5a", "#9aa4b0"];
  var KB_LABELS_MAX = 100;
  function kbLiveLabels(b) {
    return (Array.isArray(b.labels) ? b.labels : []).filter(function (l) {
      return isObj(l) && typeof l.id === "string" && !(isObj(b.deleted) && typeof b.deleted[l.id] === "number" && b.deleted[l.id] >= (l.mtime || 0));
    });
  }
  // list = [{ name, color? } | "name"] → { add: [{ name, color }] } | { err }; names already on b are skipped
  function kbLabelArgs(b, list, what) {
    if (!Array.isArray(list) || !list.length || list.length > 30) return { err: what + " must hold 1 to 30 labels." };
    var have = kbLiveLabels(b), seen = {}, add = [], recolor = [], used = have.map(function (l) { return String(l.color || "").toLowerCase(); }), i;
    for (i = 0; i < list.length; i++) {
      var o = isObj(list[i]) ? list[i] : { name: list[i] }, tag = what + " " + (i + 1) + ": ";
      var r = kbText(o.name, 40, "text");
      if (r.err || !r.s) return { err: tag + "a label needs a name of at most 40 characters." };
      if (o.color !== undefined && !Object.prototype.hasOwnProperty.call(KB_COLORS, o.color)) return { err: tag + "color must be one of " + Object.keys(KB_COLORS).join(", ") + "." };
      var old = have.filter(function (l) { return fold(l.name) === fold(r.s); })[0];
      // KB-RECOLOR (Chris 2026-11-23): a colour given for a label the board has already changes its colour
      if (old && o.color && !seen[fold(r.s)] && String(old.color || "").toLowerCase() !== KB_COLORS[o.color]) recolor.push({ l: old, color: KB_COLORS[o.color] });
      if (seen[fold(r.s)] || old) { seen[fold(r.s)] = 1; continue; }
      seen[fold(r.s)] = 1;
      add.push({ name: r.s, color: o.color ? KB_COLORS[o.color] : "" });
    }
    if (have.length + add.length > KB_LABELS_MAX) return { err: "A board holds at most " + KB_LABELS_MAX + " labels." };
    add.forEach(function (x) {
      if (x.color) { used.push(x.color); return; }
      var free = KB_COLOR_LIST.filter(function (c) { return used.indexOf(c) < 0; });
      x.color = free.length ? free[0] : KB_COLOR_LIST[(have.length + used.length) % KB_COLOR_LIST.length];
      used.push(x.color);
    });
    return { add: add, recolor: recolor };
  }
  // KB-RECOLOR: new colours for labels the board has; Undo puts the old colour back while the label is as left
  function kbRecolor(rc, now, undo) {
    return rc.map(function (x) {
      var at = Math.max(now, (x.l.mtime || 0) + 1);
      if (undo) { if (!isObj(undo.lcol)) undo.lcol = {}; undo.lcol[x.l.id] = { c: x.l.color || "", a: at }; }
      x.l.color = x.color; x.l.mtime = at;
      return x.l;
    });
  }
  function kbMakeLabels(b, add, now, newId, undo) {
    if (!Array.isArray(b.labels)) b.labels = [];
    return add.map(function (x) {
      var l = { id: newId(), name: x.name, color: x.color, mtime: now, pos: b.labels.length };
      b.labels.push(l);
      if (undo) { if (!isObj(undo.labs)) undo.labs = {}; undo.labs[l.id] = now; }
      return l;
    });
  }
  // KB-KEY (Chris 2026-11-23): a card by its id, or else by its key on this board.
  function kbCardRef(b, ref) {
    var k = String(ref == null ? "" : ref).trim();
    if (!k) return null;
    var at = kbCard(b, k);
    if (at) return at;
    var cols = kbCols(b);
    for (var i = 0; i < cols.length; i++) {
      var cs = Array.isArray(cols[i].cards) ? cols[i].cards : [];
      for (var j = 0; j < cs.length; j++) if (isObj(cs[j]) && typeof cs[j].key === "string" && cs[j].key === k) return { col: cols[i], at: j, card: cs[j] };
    }
    return null;
  }
  function kbKeyArg(M, v, tag) {
    if (v === undefined) return { k: undefined };
    if (typeof v !== "string") return { err: tag + "key must be text." };
    var k = M.cleanKey(v);
    if (!k && v.trim()) return { err: tag + "key must be at most " + M.KEY_MAX + " characters." };
    return { k: k };
  }
  function kbLinksArg(M, v, tag) {
    if (v === undefined) return { l: undefined };
    if (!Array.isArray(v) || v.length > M.LINKS_MAX) return { err: tag + "links must be a list of at most " + M.LINKS_MAX + " links ([] clears them)." };
    var list = v.map(function (x) { return typeof x === "string" ? { u: x } : isObj(x) ? { u: x.url, t: x.title } : null; });
    var ok = M.cleanLinks(list);
    for (var i = 0; i < list.length; i++) {
      if (!list[i] || !ok.some(function (y) { return y.u === String(list[i].u || "").trim(); })) return { err: tag + "link " + (i + 1) + " must be an https address or a path on the orOS disk starting with / (no ..)." };
    }
    return { l: ok };
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
             l: Array.isArray(card.labels) ? card.labels.slice() : [], g: kbPlan(card), e: kbLinkVal(card) };
  }
  // KB-LINK: key and links, group e (model.js linksOf, kept here for older models)
  function kbLinkVal(c) {
    var o = {};
    if (typeof c.key === "string" && c.key) o.key = c.key;
    if (Array.isArray(c.links) && c.links.length) o.links = clone(c.links);
    return o;
  }
  function kbSetLinks(c, v) {
    if (v && v.key) c.key = v.key; else delete c.key;
    if (v && v.links && v.links.length) c.links = clone(v.links); else delete c.links;
  }
  // KB-GANTT (G3): the plan fields, group g (model.js planOf).
  function kbPlan(c) {
    return { start: typeof c.start === "string" && YMD.test(c.start) ? c.start : null, ms: !!c.ms,
             deps: Array.isArray(c.deps) ? c.deps.filter(function (x) { return typeof x === "string"; }) : [] };
  }
  function kbSetPlan(c, p) {
    if (p.start) c.start = p.start; else delete c.start;
    if (p.ms) c.ms = 1; else delete c.ms;
    if (p.deps && p.deps.length) c.deps = p.deps.slice(); else delete c.deps;
  }
  function kbAll(b) {
    var out = [];
    kbCols(b).forEach(function (col) { (Array.isArray(col.cards) ? col.cards : []).forEach(function (c) { if (isObj(c) && typeof c.id === "string") out.push(c); }); });
    return out;
  }
  function kbLoop(all, cardId, predId) {
    var by = {}, seen = {}, stack = [predId];
    all.forEach(function (x) { by[x.id] = x; });
    while (stack.length) {
      var id = stack.pop();
      if (id === cardId) return true;
      if (seen[id] || !by[id]) continue;
      seen[id] = 1;
      (Array.isArray(by[id].deps) ? by[id].deps : []).forEach(function (p) { stack.push(p); });
    }
    return false;
  }
  // start / milestone / depends_on of a call → the new plan, or { err }.
  function kbPlanArgs(b, card, a, due) {
    var np = kbPlan(card), v;
    if (a.start !== undefined) { v = kbDue(a.start); if (v.err) return { err: "start must be YYYY-MM-DD, or \"\" to clear it." }; np.start = v.d; }
    if (a.milestone !== undefined) { if (typeof a.milestone !== "boolean") return { err: "milestone must be true or false." }; np.ms = a.milestone; }
    if (np.start && due && np.start > due && !np.ms) return { err: "start " + np.start + " is after the due date " + due + "." };
    if (a.depends_on !== undefined) {
      if (!Array.isArray(a.depends_on) || a.depends_on.length > 20) return { err: "depends_on must be a list of at most 20 card ids ([] clears it)." };
      var all = kbAll(b), ids = [];
      for (var i = 0; i < a.depends_on.length; i++) {
        var key = String(a.depends_on[i] == null ? "" : a.depends_on[i]).trim();
        var hit = all.filter(function (x) { return x.id === key; });
        if (!hit.length) hit = all.filter(function (x) { return String(x.text || "").trim().toLowerCase() === key.toLowerCase(); });
        if (!hit.length) return { err: "depends_on: no card " + JSON.stringify(key) + " on " + (b.name || "this board") + "." };
        if (hit.length > 1) return { err: "depends_on: more than one card reads " + JSON.stringify(key) + "; use its id." };
        if (hit[0].id === card.id) return { err: "depends_on: a card cannot wait for itself." };
        if (kbLoop(all, card.id, hit[0].id)) return { err: "depends_on: " + JSON.stringify(hit[0].text || hit[0].id) + " already waits for this card; that would make a loop." };
        if (ids.indexOf(hit[0].id) < 0) ids.push(hit[0].id);
      }
      np.deps = ids;
    }
    return { p: np };
  }
  function kbPlace(col, card, top) {
    if (!Array.isArray(col.cards)) col.cards = [];
    if (top) col.cards.unshift(card); else col.cards.push(card);
  }
  // KB-BOARD (Chris 2026-11-23, card «Νέο εργαλείο Gate»): a new board
  // with its columns, like Kanban's New board. A name an open or archived
  // board already has is refused (one board per name, so a routine never
  // makes a second one). Undo takes the board away only while it is as
  // made: same name, the same columns, no card.
  function kbAddBoard(M, raw, args, now, newId) {
    var d = isObj(raw) && Array.isArray(raw.boards) ? clone(raw) : { om: 0, boardDeleted: {}, boards: [] };
    args = isObj(args) ? args : {};
    var nm = kbText(args.name, 60, "name");
    nm.s = nm.err ? "" : nm.s.replace(/\s+/g, " ").trim();
    if (!nm.s) return { ok: false, err: "A board needs a name of at most 60 characters." };
    var gone = isObj(d.boardDeleted) ? d.boardDeleted : {};
    var same = d.boards.filter(function (b) {
      return isObj(b) && typeof b.id === "string" && b.id.indexOf("tpl-") !== 0 && fold(b.name) === fold(nm.s) &&
        !(typeof gone[b.id] === "number" && gone[b.id] >= (b.mtime || 0));
    })[0];
    if (same) return { ok: false, err: "A board called " + JSON.stringify(same.name) + " is already there (id " + same.id + (same.archived ? ", archived: the owner can bring it back from Kanban's archive" : "; add columns to it with kanban_add_columns") + "). Nothing was made." };
    var list = Array.isArray(args.columns) ? args.columns : null;
    if (!list || !list.length || list.length > KB_COLS) return { ok: false, err: "columns must hold 1 to " + KB_COLS + " columns." };
    var cols = [], seen = {}, i;
    for (i = 0; i < list.length; i++) {
      var r = kbText(isObj(list[i]) ? list[i].name : list[i], 60, "text");
      if (r.err || !r.s) return { ok: false, err: "Column " + (i + 1) + ": a column needs a name of at most 60 characters." };
      if (seen[fold(r.s)]) return { ok: false, err: "Column " + (i + 1) + ": two columns are called " + JSON.stringify(r.s) + "." };
      seen[fold(r.s)] = 1;
      cols.push({ id: newId(), name: r.s, mtime: now, om: 0, pos: i, cards: [] });
    }
    var b = { id: newId(), name: nm.s, mtime: now, om: now, deleted: {}, labels: [], columns: cols };
    // KB-LABEL (Chris 2026-11-23): the board's labels, made with it (Undo takes them with the board)
    if (args.labels !== undefined) {
      var lba = kbLabelArgs(b, args.labels, "labels");
      if (lba.err) return { ok: false, err: lba.err };
      kbMakeLabels(b, lba.add, now, newId, null);
    }
    d.boards.push(b);
    d.om = now;
    var undo = { k: "kanban", board: b.id, cards: {}, cols: {}, nb: now };
    cols.forEach(function (c) { undo.cols[c.id] = now; });
    return { ok: true, data: M.canonState(d, now), undo: undo, ids: [b.id].concat(cols.map(function (c) { return c.id; })),
             text: "Made the board " + JSON.stringify(b.name) + " (id " + b.id + ") with " + cols.length + " column" + (cols.length === 1 ? "" : "s") + ": " +
                   cols.map(function (c) { return c.name + " (" + c.id + ")"; }).join(", ") + "." +
                   (b.labels.length ? " Labels: " + b.labels.map(function (l) { return l.name; }).join(", ") + "." : "") };
  }
  function kanbanWrite(M, op, raw, args, now, newId) {
    if (!M || typeof M.canonState !== "function") return { ok: false, err: "Kanban is not loaded on the device yet; try again in a moment." };
    if (op === "add_board") return kbAddBoard(M, raw, args, now, newId);
    var d = isObj(raw) ? clone(raw) : null;
    if (!d || !Array.isArray(d.boards)) return { ok: false, err: "Kanban has no boards yet." };
    args = isObj(args) ? args : {};
    var fb = kbFind(kbBoards(d), args.board, "board");
    if (fb.err) return { ok: false, err: fb.err + (fb.err.indexOf("No board") === 0 ? " (Archived boards and templates cannot be changed.)" : "") };
    var b = fb.x;
    if (!isObj(b.deleted)) b.deleted = {};
    var undo = { k: "kanban", board: b.id, cards: {}, cols: {} }, ids = [], i, r;

    if (op === "add_columns") {
      // KB-COLREN (Chris 2026-11-21): rename_columns [{ column, name }] renames columns (header stamp, LWW), before any adds
      var ren = args.rename_columns, rn = [];
      if (ren !== undefined) {
        if (!Array.isArray(ren) || !ren.length || ren.length > KB_COLS) return { ok: false, err: "rename_columns must hold 1 to " + KB_COLS + " columns." };
        var renSeen = {};
        for (i = 0; i < ren.length; i++) {
          var rc = isObj(ren[i]) ? ren[i] : {}, rtag = "rename_columns " + (i + 1) + ": ";
          var fr = kbFind(kbCols(b), rc.column, "column");
          if (fr.err) return { ok: false, err: rtag + fr.err };
          r = kbText(rc.name, 60, "text");
          if (r.err || !r.s) return { ok: false, err: rtag + "a column needs a name of at most 60 characters." };
          if (renSeen[fr.x.id]) return { ok: false, err: rtag + "that column is already renamed in this call." };
          renSeen[fr.x.id] = 1;
          if (r.s === fr.x.name) continue;
          var clash = kbCols(b).filter(function (c) { return c !== fr.x && String(c.name || "").trim().toLowerCase() === r.s.toLowerCase(); })[0];
          if (clash) return { ok: false, err: rtag + "another column is already called " + JSON.stringify(clash.name) + "." };
          rn.push({ col: fr.x, from: String(fr.x.name || ""), to: r.s });
        }
        if (!rn.length && args.columns === undefined && args.portal_columns === undefined && args.add_labels === undefined) return { ok: false, err: "Nothing to change: the columns already have these names." };
      }
      // KB-COLAP (Chris 2026-11-22): portal_columns [{ column, step?, finish?, name?, name_en?, about?, about_en? }] sets a
      // column's Author Portal step (col.ap, AP-FLOW) like Column settings › Author Portal: keys left out stay, "" clears a text
      var pcs = args.portal_columns, pa = [];
      if (pcs !== undefined) {
        if (typeof M.colAp !== "function") return { ok: false, err: "This orOS is too old for Author Portal steps; update orOS on the device." };
        if (!Array.isArray(pcs) || !pcs.length || pcs.length > KB_COLS) return { ok: false, err: "portal_columns must hold 1 to " + KB_COLS + " columns." };
        var apSeen = {}, AP_ARG = { name: ["n", 80], name_en: ["ne", 80], about: ["a", 600], about_en: ["ae", 600] };
        for (i = 0; i < pcs.length; i++) {
          var pc = isObj(pcs[i]) ? pcs[i] : {}, ptag = "portal_columns " + (i + 1) + ": ";
          var fp = kbFind(kbCols(b), pc.column, "column");
          if (fp.err) return { ok: false, err: ptag + fp.err };
          if (apSeen[fp.x.id]) return { ok: false, err: ptag + "that column is already set in this call." };
          apSeen[fp.x.id] = 1;
          var cur = fp.x.ap ? M.colAp(fp.x.ap) : null, nx = cur ? clone(cur) : { on: 0 }, any = false;
          if (pc.step !== undefined) { if (typeof pc.step !== "boolean") return { ok: false, err: ptag + "step must be true or false." }; nx.on = pc.step ? 1 : 0; any = true; }
          if (pc.finish !== undefined) { if (typeof pc.finish !== "boolean") return { ok: false, err: ptag + "finish must be true or false." }; if (pc.finish) nx.e = 1; else delete nx.e; any = true; }
          for (var ak in AP_ARG) {
            if (pc[ak] === undefined) continue;
            if (typeof pc[ak] !== "string" || pc[ak].length > AP_ARG[ak][1]) return { ok: false, err: ptag + ak + " must be text of at most " + AP_ARG[ak][1] + " characters." };
            nx[AP_ARG[ak][0]] = pc[ak]; any = true;
          }
          if (!any) return { ok: false, err: ptag + "give step, finish or a text to set." };
          var nap = M.colAp(nx);
          if (JSON.stringify(cur) === JSON.stringify(nap)) continue;
          pa.push({ col: fp.x, from: cur, to: nap });
        }
        if (!pa.length && args.columns === undefined && !rn.length && args.add_labels === undefined) return { ok: false, err: "Nothing to change: the columns already have these Author Portal settings." };
      }
      if (args.columns === undefined && ren === undefined && pcs === undefined && args.add_labels === undefined) return { ok: false, err: "Give columns to add, rename_columns, portal_columns or add_labels." };
      // KB-LABEL (Chris 2026-11-23): new labels on the board (names it has already are skipped)
      var labAdd = null;
      if (args.add_labels !== undefined) {
        labAdd = kbLabelArgs(b, args.add_labels, "add_labels");
        if (labAdd.err) return { ok: false, err: labAdd.err };
        if (!labAdd.add.length && !labAdd.recolor.length && args.columns === undefined && !rn.length && !pa.length) return { ok: false, err: "Nothing to change: the board already has these labels in these colours." };
      }
      undo.ren = {};
      var renTxt = rn.map(function (x) {
        var at = Math.max(now, (x.col.mtime || 0) + 1);
        x.col.name = x.to; x.col.mtime = at;
        undo.ren[x.col.id] = { n: x.from, a: at };
        return JSON.stringify(x.from) + " → " + JSON.stringify(x.to);
      });
      undo.ap = {};
      var apTxt = pa.map(function (x) {
        var at = undo.ren[x.col.id] ? x.col.mtime : Math.max(now, (x.col.mtime || 0) + 1);   // a column renamed in this call keeps one stamp
        if (x.to) x.col.ap = x.to; else delete x.col.ap;
        x.col.mtime = at;
        undo.ap[x.col.id] = { p: x.from, a: at };
        return JSON.stringify(String(x.col.name || "")) + (x.to && x.to.on ? (x.to.e ? " (step, finish)" : " (step)") : " (not a step)");
      });
      var list = args.columns === undefined ? [] : Array.isArray(args.columns) ? args.columns : null;
      if (!list || (args.columns !== undefined && !list.length) || list.length > KB_COLS) return { ok: false, err: "columns must hold 1 to " + KB_COLS + " columns." };
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
      var labs = labAdd && labAdd.add.length ? kbMakeLabels(b, labAdd.add, now, newId, undo) : [];
      var recs = labAdd && labAdd.recolor.length ? kbRecolor(labAdd.recolor, now, undo) : [];
      if (ids.length || labs.length || recs.length) b.om = now;
      var said = [];
      if (labs.length) said.push("Made the label" + (labs.length === 1 ? " " : "s ") + labs.map(function (l) { return JSON.stringify(l.name); }).join(", ") + ".");
      if (recs.length) said.push("New colour for " + recs.map(function (l) { return JSON.stringify(l.name); }).join(", ") + ".");
      if (renTxt.length) said.push("Renamed " + renTxt.join(", ") + ".");
      if (apTxt.length) said.push("Author Portal: " + apTxt.join(", ") + ".");
      if (ids.length) said.push("Added " + ids.length + " column" + (ids.length === 1 ? "" : "s") + " to " + (b.name || "the board") + ".");
      return { ok: true, data: M.canonState(d, now), undo: undo, ids: ids, renamed: renTxt.length + apTxt.length + labs.length + recs.length, text: said.join(" ") };
    }

    if (op === "add_cards") {
      var add = Array.isArray(args.cards) ? args.cards : [];
      if (!add.length || add.length > KB_ADD) return { ok: false, err: "cards must hold 1 to " + KB_ADD + " cards." };
      if (args.create_labels !== undefined && typeof args.create_labels !== "boolean") return { ok: false, err: "create_labels must be true or false." };
      // KB-LABEL: create_labels makes the label names the board does not have yet (once each)
      if (args.create_labels === true) {
        var want = [];
        add.forEach(function (a) { if (isObj(a) && Array.isArray(a.labels)) a.labels.slice(0, 20).forEach(function (n) { if (typeof n === "string" && !want.some(function (w) { return fold(w) === fold(n); }) && !kbLiveLabels(b).some(function (l) { return l.id === n; })) want.push(n); }); });
        if (want.length) {
          var la = kbLabelArgs(b, want, "labels");
          if (la.err) return { ok: false, err: la.err };
          if (la.add.length) { kbMakeLabels(b, la.add, now, newId, undo); b.om = now; }
        }
      }
      if (args.adopt_by_text !== undefined && typeof args.adopt_by_text !== "boolean") return { ok: false, err: "adopt_by_text must be true or false." };
      var touched = [], updated = [], adopted = [], made = {}, pos = [];      // KB-PREF: pos[i] = card i's id (its p- ref with orOS closed)
      for (i = 0; i < add.length; i++) {
        var a = isObj(add[i]) ? add[i] : {}, tag = "Card " + (i + 1) + ": ";
        var fc = kbFind(kbCols(b), a.column, "column");
        if (fc.err) return { ok: false, err: tag + fc.err };
        var ky = kbKeyArg(M, a.key, tag);
        if (ky.err) return { ok: false, err: ky.err };
        var lk = kbLinksArg(M, a.links, tag);
        if (lk.err) return { ok: false, err: lk.err };
        if (a.move !== undefined && typeof a.move !== "boolean") return { ok: false, err: tag + "move must be true or false." };
        var tx = kbText(a.text, KB_TEXT, "text");
        if (tx.err) return { ok: false, err: tag + tx.err };
        var nt = a.notes === undefined ? null : kbText(a.notes, KB_NOTES, "notes");
        if (nt && nt.err) return { ok: false, err: tag + nt.err };
        var du = a.due === undefined ? null : kbDue(a.due);
        if (du && du.err) return { ok: false, err: tag + du.err };
        var lb = a.labels === undefined ? null : kbLabels(b, a.labels);
        if (lb && lb.err) return { ok: false, err: tag + lb.err + (args.create_labels ? "" : " (create_labels: true makes missing labels.)") };
        // KB-KEY upsert: a card with this key on the board is brought up to date, not added twice
        var hitK = null, adopt = false;
        if (ky.k) {
          hitK = made[ky.k] ? kbCard(b, made[ky.k]) : null;
          var same = hitK ? null : kbAll(b).filter(function (x) { return x.key === ky.k; })[0];
          if (same) hitK = kbCard(b, same.id);
          // KB-ADOPT (Chris 2026-11-23): a card made before keys, with the same text, takes the key instead of a copy being added
          if (!hitK && args.adopt_by_text === true) {
            var twins = kbAll(b).filter(function (x) { return !(typeof x.key === "string" && x.key) && fold(x.text || "") === fold(tx.s); });
            if (twins.length > 1) return { ok: false, err: tag + twins.length + " cards without a key read " + JSON.stringify(tx.s) + " (" + twins.slice(0, 10).map(function (x) { return x.id; }).join(", ") + "). Give one of them the key with kanban_change_card (card: its id, key), then sync again. Nothing was changed." };
            if (twins.length === 1) { hitK = kbCard(b, twins[0].id); adopt = true; }
          }
        }
        if (hitK) {
          var c1 = hitK.card, g1 = [], snap1 = kbSnap(c1, hitK.col, hitK.at);
          var isNew = undo.cards[c1.id] && undo.cards[c1.id].b === null;
          if (tx.s !== (c1.text || "")) { c1.text = tx.s; g1.push("t"); }
          if (nt && nt.s !== (c1.notes || "")) { c1.notes = nt.s; g1.push("n"); }
          if (du && du.d !== (c1.due || null)) { c1.due = du.d; g1.push("d"); }
          if (lb && JSON.stringify(lb.ids) !== JSON.stringify(c1.labels || [])) { c1.labels = lb.ids; g1.push("l"); }
          if (a.start !== undefined || a.milestone !== undefined) {
            var pa1 = kbPlanArgs(b, c1, { start: a.start, milestone: a.milestone }, c1.due || null);
            if (pa1.err) return { ok: false, err: tag + pa1.err };
            if (JSON.stringify(pa1.p) !== JSON.stringify(kbPlan(c1))) { kbSetPlan(c1, pa1.p); g1.push("g"); }
          }
          if (lk.l !== undefined || adopt) {
            var ev = { key: ky.k }, evl = lk.l !== undefined ? lk.l : (Array.isArray(c1.links) ? clone(c1.links) : []);
            if (evl.length) ev.links = evl;
            if (JSON.stringify(ev) !== JSON.stringify(kbLinkVal(c1))) { kbSetLinks(c1, ev); g1.push("e"); }
          }
          if (a.move === true && hitK.col !== fc.x) {
            hitK.col.cards.splice(hitK.at, 1);
            kbPlace(fc.x, c1, a.position === "top");
            [hitK.col, fc.x].forEach(function (c) { if (touched.indexOf(c) < 0) touched.push(c); });
            g1.push("p");
          }
          if (g1.length) {
            M.stampCard(c1, g1, now);
            if (isNew) undo.cards[c1.id].a = c1.mtime;               // still an add for Undo
            else if (undo.cards[c1.id]) { undo.cards[c1.id].a = c1.mtime; undo.cards[c1.id].g = (undo.cards[c1.id].g || []).concat(g1.filter(function (g) { return undo.cards[c1.id].g.indexOf(g) < 0; })); }
            else undo.cards[c1.id] = { b: snap1, a: c1.mtime, g: g1 };
          }
          if (ids.indexOf(c1.id) < 0) ids.push(c1.id);
          if (!isNew && updated.indexOf(c1.id) < 0) updated.push(c1.id);
          if (adopt) adopted.push(c1.id);
          pos[i] = c1.id;
          continue;
        }
        var card = { id: newId(), text: tx.s, notes: nt ? nt.s : "", due: du ? du.d : null, labels: lb ? lb.ids : [], subtasks: [], info: [], mtime: now, pos: 0, fm: M.freshFm(now) };
        if (ky.k) { card.key = ky.k; made[ky.k] = card.id; }
        if (lk.l && lk.l.length) card.links = lk.l;
        if (a.start !== undefined || a.milestone !== undefined) {
          var pa = kbPlanArgs(b, card, { start: a.start, milestone: a.milestone }, card.due);
          if (pa.err) return { ok: false, err: tag + pa.err };
          kbSetPlan(card, pa.p);
        }
        kbPlace(fc.x, card, a.position === "top");
        if (touched.indexOf(fc.x) < 0) touched.push(fc.x);
        undo.cards[card.id] = { b: null, a: now };
        ids.push(card.id);
        pos[i] = card.id;
      }
      touched.forEach(function (c) { c.om = now; });
      var nAdd = ids.length - updated.length, labs = isObj(undo.labs) ? Object.keys(undo.labs).length : 0;
      // a sync that finds everything as it is: fine, nothing saved
      if (!nAdd && !labs && !updated.some(function (id) { return undo.cards[id]; })) return { ok: true, noop: true, ids: ids, pos: pos, updated: updated, text: "Nothing to change: the cards with these keys already look like this." };
      return { ok: true, data: M.canonState(d, now), undo: undo, ids: ids, pos: pos, updated: updated, adopted: adopted.length ? adopted : undefined,
               text: [nAdd ? "Added " + nAdd + " card" + (nAdd === 1 ? "" : "s") + "." : "",
                      adopted.length ? "Gave the key to " + adopted.length + " card" + (adopted.length === 1 ? "" : "s") + " made before keys (same text)." : "",
                      updated.length ? "Brought " + updated.length + " card" + (updated.length === 1 ? "" : "s") + " with the same key up to date" + (updated.some(function (id) { return !undo.cards[id]; }) ? " (some already were)" : "") + "." : "",
                      labs ? "Made " + labs + " label" + (labs === 1 ? "" : "s") + "." : ""].filter(Boolean).join(" ") };
    }

    if (op === "move_cards") {
      var mv = Array.isArray(args.moves) ? args.moves : [];
      if (!mv.length || mv.length > KB_MOVE) return { ok: false, err: "moves must hold 1 to " + KB_MOVE + " moves." };
      var seen = {}, changedCols = [];
      for (i = 0; i < mv.length; i++) {
        var m = isObj(mv[i]) ? mv[i] : {}, mt = "Move " + (i + 1) + ": ";
        var at = kbCardRef(b, m.card), id = at ? at.card.id : String(m.card || "");   // KB-KEY: an id or a card's key
        if (!at) return { ok: false, err: mt + "no card with id or key " + id + " on " + (b.name || "this board") + " (ids come from app_summary or search_data)." };
        if (seen[id]) return { ok: false, err: mt + "card " + id + " is moved twice in one call." };
        seen[id] = 1;
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
      var hit = kbCardRef(b, args.card);                  // KB-KEY: an id or a card's key
      if (!hit) return { ok: false, err: "No card with id or key " + String(args.card || "") + " on " + (b.name || "this board") + "." };
      var c0 = hit.card, groups = [], snap = kbSnap(c0, hit.col, hit.at), v;
      // KB-LINK: links (the whole new list) and the key, one group e
      if (args.links !== undefined || args.key !== undefined) {
        var kv = kbKeyArg(M, args.key, ""), lv = kbLinksArg(M, args.links, "");
        if (kv.err) return { ok: false, err: kv.err };
        if (lv.err) return { ok: false, err: lv.err };
        var ev0 = kbLinkVal(c0), ev1 = clone(ev0);
        if (kv.k !== undefined) {
          if (kv.k && kbAll(b).some(function (x) { return x !== c0 && x.key === kv.k; })) return { ok: false, err: "Another card on " + (b.name || "this board") + " has the key " + JSON.stringify(kv.k) + "." };
          if (kv.k) ev1.key = kv.k; else delete ev1.key;
        }
        if (lv.l !== undefined) { if (lv.l.length) ev1.links = lv.l; else delete ev1.links; }
        if (JSON.stringify(ev1) !== JSON.stringify(ev0)) { kbSetLinks(c0, ev1); groups.push("e"); }
      }
      if (args.text !== undefined) { v = kbText(args.text, KB_TEXT, "text"); if (v.err) return { ok: false, err: v.err }; if (v.s !== (c0.text || "")) { c0.text = v.s; groups.push("t"); } }
      if (args.notes !== undefined) { v = kbText(args.notes, KB_NOTES, "notes"); if (v.err) return { ok: false, err: v.err }; if (v.s !== (c0.notes || "")) { c0.notes = v.s; groups.push("n"); } }
      if (args.due !== undefined) { v = kbDue(args.due); if (v.err) return { ok: false, err: v.err }; if (v.d !== (c0.due || null)) { c0.due = v.d; groups.push("d"); } }
      if (args.start !== undefined || args.milestone !== undefined || args.depends_on !== undefined) {
        v = kbPlanArgs(b, c0, args, c0.due || null); if (v.err) return { ok: false, err: v.err };
        if (JSON.stringify(v.p) !== JSON.stringify(kbPlan(c0))) { kbSetPlan(c0, v.p); groups.push("g"); }
      }
      if (args.labels !== undefined) {
        v = kbLabels(b, args.labels); if (v.err) return { ok: false, err: v.err };
        var old = Array.isArray(c0.labels) ? c0.labels : [];
        if (JSON.stringify(v.ids) !== JSON.stringify(old)) { c0.labels = v.ids; groups.push("l"); }
      }
      // Subtasks (KB-SUB): add new ones at the end, tick, untick or reword them by id
      // or exact text; KB-SUBDEL (Chris 2026-11-20): remove them by id or exact
      // text (a deletion: the device asks the owner first, kanbanChange). Undo
      // takes back only these.
      var sa = [], sc = {}, sr = [];
      if (args.add_subtasks !== undefined || args.change_subtasks !== undefined || args.remove_subtasks !== undefined) {
        if (!Array.isArray(c0.subtasks)) c0.subtasks = [];
        var subs = c0.subtasks, addS = args.add_subtasks, chk = args.change_subtasks;
        if (addS !== undefined) {
          if (!Array.isArray(addS) || !addS.length || addS.length > KB_SUBS) return { ok: false, err: "add_subtasks must hold 1 to " + KB_SUBS + " texts." };
          if (subs.length + addS.length > KB_SUBS_MAX) return { ok: false, err: "A card holds at most " + KB_SUBS_MAX + " subtasks; it has " + subs.length + "." };
          for (i = 0; i < addS.length; i++) {
            v = kbText(addS[i], KB_TEXT, "text");
            if (v.err) return { ok: false, err: "Subtask " + (i + 1) + ": " + v.err };
          }
        }
        if (chk !== undefined) {
          if (!Array.isArray(chk) || !chk.length || chk.length > KB_SUBS_MAX) return { ok: false, err: "change_subtasks must hold 1 to " + KB_SUBS_MAX + " entries." };
          for (i = 0; i < chk.length; i++) {
            var ce = isObj(chk[i]) ? chk[i] : {}, key = String(ce.subtask == null ? "" : ce.subtask).trim(), ct = "change_subtasks " + (i + 1) + ": ";
            if (!key) return { ok: false, err: ct + "subtask (its id or exact text) is missing." };
            if (ce.done !== undefined && typeof ce.done !== "boolean") return { ok: false, err: ct + "done must be true or false." };
            var nt2 = ce.text === undefined ? null : kbText(ce.text, KB_TEXT, "text");
            if (nt2 && nt2.err) return { ok: false, err: ct + nt2.err };
            if (ce.done === undefined && !nt2) return { ok: false, err: ct + "give done, text or both." };
            var byId = subs.filter(function (x) { return isObj(x) && x.id === key; });
            var byTx = byId.length ? byId : subs.filter(function (x) { return isObj(x) && String(x.text || "").trim() === key; });
            if (!byTx.length) return { ok: false, err: ct + "no subtask " + JSON.stringify(key) + " on this card." };
            if (byTx.length > 1) return { ok: false, err: ct + "more than one subtask reads " + JSON.stringify(key) + "; use its id." };
            var st0 = byTx[0];
            if (sc[st0.id] !== undefined) return { ok: false, err: ct + "the subtask is named twice in one call." };
            var was0 = { c: !!st0.completed, t: String(st0.text || "") }, moved = false;
            if (ce.done !== undefined && !!st0.completed !== ce.done) { st0.completed = ce.done; moved = true; }
            if (nt2 && nt2.s !== was0.t) { st0.text = nt2.s; moved = true; }
            if (moved) { sc[st0.id] = was0; st0.m = now; }
          }
        }
        var rmS = args.remove_subtasks;
        if (rmS !== undefined) {
          if (!Array.isArray(rmS) || !rmS.length || rmS.length > KB_SUBS_MAX) return { ok: false, err: "remove_subtasks must hold 1 to " + KB_SUBS_MAX + " entries." };
          var rmIds = [];
          for (i = 0; i < rmS.length; i++) {
            var rk = String(rmS[i] == null ? "" : rmS[i]).trim(), rt = "remove_subtasks " + (i + 1) + ": ";
            if (!rk) return { ok: false, err: rt + "give the subtask's id or exact text." };
            var rId = subs.filter(function (x) { return isObj(x) && x.id === rk; });
            var rTx = rId.length ? rId : subs.filter(function (x) { return isObj(x) && String(x.text || "").trim() === rk; });
            if (!rTx.length) return { ok: false, err: rt + "no subtask " + JSON.stringify(rk) + " on this card." };
            if (rTx.length > 1) return { ok: false, err: rt + "more than one subtask reads " + JSON.stringify(rk) + "; use its id." };
            if (rmIds.indexOf(rTx[0].id) >= 0) return { ok: false, err: rt + "the subtask is named twice in one call." };
            if (sc[rTx[0].id] !== undefined) return { ok: false, err: rt + "the subtask is changed and removed in one call." };
            rmIds.push(rTx[0].id);
          }
          subs.forEach(function (x, ix) { if (isObj(x) && rmIds.indexOf(x.id) >= 0) sr.push({ i: ix, x: clone(x) }); });
          c0.subtasks = subs = subs.filter(function (x) { return !(isObj(x) && rmIds.indexOf(x.id) >= 0); });
        }
        if (addS !== undefined) addS.forEach(function (t) {
          var ns = { id: newId(), text: kbText(t, KB_TEXT, "text").s, completed: false, m: now };
          subs.push(ns); sa.push(ns.id);
        });
        if (sa.length || Object.keys(sc).length || sr.length) groups.push("s");
      }
      if (!groups.length) return { ok: false, err: "Nothing to change: the card already looks like this." };
      M.stampCard(c0, groups, now);
      if (groups.indexOf("s") >= 0) c0.subtasks.forEach(function (x) { if (isObj(x) && (sa.indexOf(x.id) >= 0 || sc[x.id] !== undefined)) x.m = c0.mtime; });
      if (sr.length) {                                   // a removed subtask's tombstone (merge: an item older than it goes)
        if (!isObj(b.deleted)) b.deleted = {};
        sr.forEach(function (r) { b.deleted[M.itemTomb(c0.id, r.x.id)] = Math.max(now, c0.mtime || 0, (typeof r.x.m === "number" ? r.x.m : 0) + 1); });
      }
      undo.cards[c0.id] = { b: snap, a: c0.mtime, g: groups };
      if (sa.length) undo.cards[c0.id].sa = sa;
      if (Object.keys(sc).length) undo.cards[c0.id].sc = sc;
      if (sr.length) undo.cards[c0.id].sr = sr;
      return { ok: true, data: M.canonState(d, now), undo: undo, ids: [c0.id].concat(sa), removed: sr.map(function (r) { return String(r.x.text || ""); }),
               text: "Changed the card." + (sa.length ? " Added " + sa.length + " subtask" + (sa.length === 1 ? "" : "s") + "." : "") +
                     (sr.length ? " Removed " + sr.length + " subtask" + (sr.length === 1 ? "" : "s") + "." : "") +
                     (Object.keys(sc).length ? " Changed " + Object.keys(sc).length + " subtask" + (Object.keys(sc).length === 1 ? "" : "s") + "." : "") };
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
    if (typeof u.nb === "number") {                         // KB-BOARD: the change made this board
      if (!b) return { ok: true, data: d, n: 0, kept: 0 };
      var bc = kbCols(b), asMade = (b.mtime || 0) === u.nb && !b.archived && !kbAll(b).length &&
        bc.length === Object.keys(u.cols).length && bc.every(function (c) { return u.cols[c.id] === (c.mtime || 0); });
      if (!asMade) return { ok: true, data: d, n: 0, kept: 1 };
      d.boards.splice(d.boards.indexOf(b), 1);
      if (!isObj(d.boardDeleted)) d.boardDeleted = {};
      d.boardDeleted[b.id] = Math.max(now, (b.mtime || 0) + 1);
      d.om = now;
      return { ok: true, data: M.canonState(d, now), n: 1, kept: 0 };
    }
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
        if (e.g.indexOf("g") >= 0 && isObj(s.g)) { kbSetPlan(card, s.g); groups.push("g"); }
        if (e.g.indexOf("e") >= 0) { kbSetLinks(card, isObj(s.e) ? s.e : {}); groups.push("e"); }
        if (e.g.indexOf("p") >= 0) {                        // KB-KEY: an upsert that also moved the card
          var home0 = kbCols(b).filter(function (c) { return c.id === s.col; })[0];
          if (home0 && home0 !== at.col) {
            at.col.cards.splice(at.at, 1);
            if (!Array.isArray(home0.cards)) home0.cards = [];
            home0.cards.splice(Math.min(s.at, home0.cards.length), 0, card);
            groups.push("p");
            oms.push(at.col, home0);
          }
        }
        if (e.g.indexOf("s") >= 0 && Array.isArray(card.subtasks)) {
          var gone = Array.isArray(e.sa) ? e.sa : [], was = isObj(e.sc) ? e.sc : {};
          card.subtasks = card.subtasks.filter(function (x) {
            if (isObj(x) && gone.indexOf(x.id) >= 0) { b.deleted[M.itemTomb(card.id, x.id)] = Math.max(now, (card.mtime || 0) + 1); return false; }
            return true;
          });
          card.subtasks.forEach(function (x) { if (isObj(x) && isObj(was[x.id])) { x.completed = was[x.id].c; x.text = was[x.id].t; x.touch = 1; } });
          // KB-SUBDEL: removed subtasks come back in their places, newer than their tombstone
          (Array.isArray(e.sr) ? e.sr : []).forEach(function (r) {
            if (!isObj(r) || !isObj(r.x) || typeof r.x.id !== "string" || card.subtasks.some(function (x) { return isObj(x) && x.id === r.x.id; })) return;
            var back = clone(r.x); back.touch = 1; back.tomb = b.deleted[M.itemTomb(card.id, back.id)] || 0;
            card.subtasks.splice(Math.min(typeof r.i === "number" ? r.i : card.subtasks.length, card.subtasks.length), 0, back);
          });
          groups.push("s");
        }
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
      if (Array.isArray(card.subtasks)) card.subtasks.forEach(function (x) {
        if (!isObj(x) || !x.touch) return;
        var tb = typeof x.tomb === "number" ? x.tomb : 0;
        delete x.touch; delete x.tomb;
        x.m = Math.max(card.mtime, tb + 1);
      });
      n++;
    });
    // KB-COLREN / KB-COLAP: a renamed column gets its old name, a column whose Author Portal step was set its old
    // setting, unless the column changed since (both checked against the stamp before either is put back)
    var hdr = {};
    if (isObj(u.ren)) Object.keys(u.ren).forEach(function (id) { hdr[id] = 1; });
    if (isObj(u.ap)) Object.keys(u.ap).forEach(function (id) { hdr[id] = 1; });
    Object.keys(hdr).forEach(function (id) {
      var c = kbCols(b).filter(function (x) { return x.id === id; })[0], e = isObj(u.ren) ? u.ren[id] : null, p = isObj(u.ap) ? u.ap[id] : null;
      var okR = isObj(e) && c && (c.mtime || 0) === e.a, okP = isObj(p) && c && (c.mtime || 0) === p.a, at = 0;
      if (e && !okR) kept++;
      if (p && !okP) kept++;
      if (okR) { c.name = e.n; at = e.a; n++; }
      if (okP) { if (p.p) c.ap = p.p; else delete c.ap; at = p.a; n++; }
      if (at) c.mtime = Math.max(now, at + 1);
    });
    Object.keys(u.cols).forEach(function (id) {
      var cols = kbCols(b), c = cols.filter(function (x) { return x.id === id; })[0];
      if (!c || (c.mtime || 0) !== u.cols[id] || (Array.isArray(c.cards) && c.cards.length)) { kept++; return; }
      b.columns.splice(b.columns.indexOf(c), 1);
      b.deleted[id] = Math.max(now, (c.mtime || 0) + 1);
      b.om = now; n++;
    });
    // KB-LABEL: a label the change made goes while it is as made and no card has it
    if (isObj(u.labs)) Object.keys(u.labs).forEach(function (id) {
      var l = kbLiveLabels(b).filter(function (x) { return x.id === id; })[0];
      if (!l) return;
      if ((l.mtime || 0) !== u.labs[id] || kbAll(b).some(function (k) { return Array.isArray(k.labels) && k.labels.indexOf(id) >= 0; })) { kept++; return; }
      b.labels.splice(b.labels.indexOf(l), 1);
      b.deleted[id] = Math.max(now, (l.mtime || 0) + 1);
      b.om = now; n++;
    });
    // KB-RECOLOR: the old colour comes back while the label is as the change left it
    if (isObj(u.lcol)) Object.keys(u.lcol).forEach(function (id) {
      var l = kbLiveLabels(b).filter(function (x) { return x.id === id; })[0], e = u.lcol[id];
      if (!l || !isObj(e)) return;
      if ((l.mtime || 0) !== e.a) { kept++; return; }
      l.color = typeof e.c === "string" ? e.c : ""; l.mtime = Math.max(now, e.a + 1);
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
  // INV-EXT: gate tools for apps that are also in ACT (their other
  // changes go through the Assistant's tools).
  var OWN_WRITES = { invoices: ["invoices_record"] };
  var WRITES = { budget: ["budget_add", "budget_change", "budget_delete", "budget_areas", "budget_categories", "budget_transfer", "budget_balances", "budget_refresh"],
                 kanban: ["kanban_add_cards", "kanban_move_cards", "kanban_change_card", "kanban_add_columns", "kanban_add_board"] };
  // GATE-ACT (2026-11-08): the apps Claude may change with the
  // Assistant's own tools, run in a hidden Assistant frame
  // (assistant.js GATE). = the Assistant's create / change apps, less
  // NEVER, the apps with their own tools above (Budget, Kanban) and
  // Files (tests/gate-act.test.js). Base: BASE-1 B4b.
  var ACT = ["base", "bookmarks", "calendar", "chores", "contacts", "crm", "feeds", "flashcards", "garage", "habits", "invoices",
             "library", "meals", "music", "notes", "petcare", "plants", "podcasts", "publish", "quote", "shelf", "split", "stickies", "stock",
             "timesheet", "todo", "travel", "wiki"];
  // W5 (2026-11-08, Chris: "Ναι, ορατά στην οθόνη"): the documents the
  // Assistant changes with edit_in_app (assistant.js EDIT_SRC). The app
  // opens on the owner's screen and applies the commands there.
  var DOCS = ["atelier", "layout", "mindmap", "mockups", "montage", "photolab", "slides", "spreadsheet", "studio", "whiteboard", "writer"];
  // GATE-FILES F1 (2026-11-13, Chris «Προχώρα, όλα τα κύματα»): Files
  // joins the gate with its own tools (assistant/claudefiles.js), only
  // inside Claude's folders (FILES_KEY, synced). Files stays outside
  // ACT: change_item on files is not offered through the gate.
  var FILE_READ = ["files_list", "files_read"], FILE_WRITE = ["files_write", "files_move", "files_delete"];
  var FRESH_COPY = FILE_WRITE.concat(["export_pdf", "export_epub", "edit_in_app"]);
  // The changes the relay may queue while orOS is closed (relay/gate.js
  // closedCall): its own change tools less budget_delete and
  // budget_transfer (it deletes entries too), and
  // create_items. applyQueue runs nothing else (defence in depth).
  var QUEUED = ["budget_add", "budget_change", "budget_areas", "budget_categories", "budget_balances", "budget_delete", "budget_transfer", "kanban_add_cards", "kanban_move_cards", "kanban_change_card", "kanban_add_columns", "kanban_add_board", "create_items",
                "invoices_record",   // INV-EXT
                "local_folders_request",   // TRAY-2: the owner's answer on a screen
                "claude_folders_request",   // CF-ASK: the same for a folder of the orOS disk
                // 5.96.00: by refs from the copy's index (kept on the device); never action delete
                "change_item", "link_items", "link_contact",
                // GATE-FILES F3: checked against the closed copy's index; deletes wait for the owner's yes here
                "files_write", "files_move", "files_delete"]
                // GATE-SCREEN (Chris 2026-11-19): the tools that work on the owner's screen wait for one
                .concat(["propose_entry", "propose_automation", "propose_rule", "newsletter_add", "newsletter_check", "book_cover",
                         "rebuild_in_layout", "learn_house_style", "layout_book", "add_house_rule", "export_epub", "export_pdf", "edit_in_app",
                         "mockup_render"]);   // GATE-PL10: a picture into Claude's folders or a local folder, never over a file
  var ACT_TOOLS = ["search_data", "read_item", "app_summary", "list_fonts", "read_in_app", "edit_in_app", "do_action", "change_item", "create_items", "link_contact", "link_items", "change_history", "undo_change",
                   "propose_entry", "propose_automation", "propose_rule", "newsletter_add", "newsletter_check", "book_cover",
                   "rebuild_in_layout", "learn_house_style", "layout_book", "add_house_rule", "export_epub", "export_pdf"].concat(FILE_READ, FILE_WRITE, ["mockup_render"]);
  // GATE-PAR P3: tools that open an app on the owner's screen with the
  // work (= core.js GATE_OPEN); like do_action they need an app Claude
  // may change, no pause, and the frame checks the target app.
  var ACT_OPEN = ACT_TOOLS.slice(13, 25);
  var ACT_WRITE = ["create_items", "change_item", "link_contact", "link_items", "undo_change", "edit_in_app"].concat(FILE_WRITE);
  var DOC_WRITE = ["edit_in_app", "undo_change"];
  // GATE-SCREEN (Chris 2026-11-19 «Τα εγκρίνω και τα 3»): the tools that
  // open an app on the owner's screen (ACT_OPEN, and edit_in_app less its
  // dry run) are not refused, nor left to time out, while nobody sees
  // orOS (a hidden tab or window, the background host, behind the lock
  // on orOS USB): the device answers SCREEN_HELD and the relay keeps the
  // call, encrypted, for the next device that shows orOS on screen
  // (sendHeld, as 7.48.00 does for deletions). do_action is never kept:
  // playing or opening something hours later is not what was asked.
  var SCREEN_HELD = "__screen";
  // GATE-PL10: mockup_render draws on the device (WebGL), like Layout's work
  function screenTool(name, args) { return ACT_OPEN.indexOf(name) >= 0 || name === "mockup_render" || (name === "edit_in_app" && !(isObj(args) && args.dry_run === true)); }
  function offScreen() { return away() || document.visibilityState !== "visible"; }
  // TRAY-1 (Chris 2026-11-21 «να δουλεύεις με το orOS κλειστό στο tray»):
  // Layout's book work and edit_in_app need nobody to look at them. On the
  // background host (the tray keeps orOS open headless) and in an orOS
  // desktop window that is minimised or behind others (orOS Setup /
  // Portable, its own browser) they run at once; proposals that the owner
  // reads (propose_*, newsletter_*) still wait for a screen, and so does
  // every deletion (askDelete answers "none" off screen → __held).
  var BACK_OK = ["book_cover", "rebuild_in_layout", "learn_house_style", "layout_book", "add_house_rule", "export_epub", "export_pdf", "edit_in_app", "mockup_render"];
  function deskApp() { return typeof location !== "undefined" && /^http:\/\/(localhost|127\.0\.0\.1):47800$/.test(String(location.origin || "")); }
  // TRAY-3 (Chris 2026-11-21 «εφάρμοσε τις ίδιες δυνατότητες για όλες
  // τις εργασίες του Gate»): in an orOS desktop window that is minimised
  // or behind others, every screen tool runs too; a proposal's form stays
  // open in that window for the owner to check when they look. The
  // headless tray host has no window to keep it in, so there proposals
  // still wait for a screen (the phone answers them too).
  function backOk(name) {
    if (strictOn()) return false;
    var desk = deskApp() && !away() && !(root.orosLock && root.orosLock.isLocked && root.orosLock.isLocked());
    if (BACK_OK.indexOf(name) < 0) return desk && ACT_OPEN.indexOf(name) >= 0;
    if (HOST.ok && HOST.kind === "bg") return true;
    return desk;
  }
  // a screen tool that must wait here for a person at the screen
  function screenWait(name, args) {
    if (name === "local_folders_request" || name === "claude_folders_request") return offScreen() || !!(root.orosLock && root.orosLock.isLocked && root.orosLock.isLocked());   // TRAY-2: a question for the owner
    if (!screenTool(name, args) || backOk(name)) return false;
    return offScreen() || !!(root.orosLock && root.orosLock.isLocked && root.orosLock.isLocked());
  }
  function writable(id) { return !sensitive(id) && (!!WRITES[id] || ACT.indexOf(id) >= 0 || DOCS.indexOf(id) >= 0 || id === "files"); }
  function actable(id) { return ACT.indexOf(id) >= 0 || DOCS.indexOf(id) >= 0 || id === "files"; }
  // One rule, orOS open or closed (Chris 08/11, 5.78.00): Claude may
  // change an app set to "write", unless the owner paused changes
  // (hold = paused until, ms). Every change is notified and undoable.
  // BK-AO (Chris 2026-11-18 «ρύθμισε το orOS ώστε να κάνει αυτόματα την
  // ενημέρωση»): budget_refresh asks Budget's banks for new bookings now,
  // as Update now does (shell.js __orosBankNow). Never queued: the bank
  // key is on the device. At most once per BANK_GAP per device (banks
  // allow about 4 unattended reads a day). r = __orosBankNow's answer.
  var BANK_GAP = 10 * 60000;
  var BANK_WHY = {
    nobanks: "Budget has no bank connected (Budget › More › Banks). Nothing was read.",
    noapp: "Budget is not installed on this device. Nothing was read.",
    offline: "The owner's device is offline (or cannot reach the banks from here). Nothing was read.",
    busy: "A bank update is already running on the device; read budget_lines in a minute.",
    pending: "The owner is connecting a bank right now; try again in a few minutes.",
    slow: "The update started and is still running on the device; its entries come into Budget by themselves. Read budget_lines in a minute."
  };
  function bankNowText(r, now) {
    var o = isObj(r) ? r : {};
    var last = typeof o.last === "number" && o.last > 0 ? new Date(o.last).toISOString() : null;
    if (o.gap) return { ok: true, c: JSON.stringify({ done: "Not read again: the banks were read on this device at " + last + ", less than 10 minutes ago. Use budget_lines.", last_update: last }) };
    if (o.why) return { ok: o.why === "slow" || o.why === "busy", c: JSON.stringify({ done: BANK_WHY[o.why] || "Nothing was read.", last_update: last }) };
    var errs = Array.isArray(o.errs) ? o.errs.slice(0, 10).map(function (x) { return { code: String(x.c || ""), text: String(x.text || "").slice(0, 300) }; }) : [];
    var n = typeof o.n === "number" && o.n > 0 ? Math.floor(o.n) : 0;
    var out = { done: n ? n + " new entries from the banks are in Budget." : "The banks have nothing new.", new_entries: n, last_update: last || new Date(now).toISOString() };
    if (errs.length) {
      out.failed = errs;
      out.note = "These bank accounts could not be read (the others were). consent = the owner renews the bank's access in Budget › More › Banks; keys = this device has no bank key (another device of the owner's may).";
    }
    return { ok: true, c: JSON.stringify(out) };
  }
  function canWrite(lv, hold, id, now) {
    return !!(isObj(lv) && lv[id] === "write" && writable(id) && !barred(id) && !(typeof hold === "number" && hold > now));
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
          tools: { budget_add: "added Budget entries", budget_change: "changed a Budget entry", budget_delete: "deleted Budget entries", budget_areas: "changed Budget's areas", budget_categories: "changed Budget's categories", budget_transfer: "turned a Budget entry into a transfer", budget_balances: "matched Budget's account balances",
                   kanban_add_cards: "added Kanban cards", kanban_move_cards: "moved Kanban cards", kanban_change_card: "changed a Kanban card",
                   kanban_add_columns: "added, renamed or set up Kanban columns", kanban_add_board: "made a Kanban board", invoices_record: "recorded invoices issued elsewhere",
                   create_items: "added items in {app}", change_item: "changed items in {app}", link_contact: "linked contacts in {app}",
                   link_items: "linked items in {app}", undo_change: "undid changes in {app}", edit_in_app: "changed documents in {app}", files_write: "wrote files", files_move: "moved files", files_delete: "deleted files" } },
    el: { subject: "orOS: οι αλλαγές του Claude στις {day}", intro: "Ο Claude έκανε σήμερα αυτές τις αλλαγές στο orOS σου ({n}):",
          undone: "αναιρέθηκε", undo: "Για αναίρεση: orOS › Ρυθμίσεις › Claude (orOS Gate) › Αλλαγές του Claude.", items: "{n} στοιχεία",
          tools: { budget_add: "πρόσθεσε εγγραφές στο Budget", budget_change: "άλλαξε μια εγγραφή του Budget", budget_delete: "έσβησε εγγραφές του Budget", budget_areas: "άλλαξε τους τομείς του Budget", budget_categories: "άλλαξε τις κατηγορίες του Budget", budget_transfer: "έκανε μια εγγραφή του Budget μεταφορά", budget_balances: "συμφώνησε τα υπόλοιπα λογαριασμών του Budget",
                   kanban_add_cards: "πρόσθεσε κάρτες στο Kanban", kanban_move_cards: "μετακίνησε κάρτες στο Kanban", kanban_change_card: "άλλαξε μια κάρτα του Kanban",
                   kanban_add_columns: "πρόσθεσε, μετονόμασε ή ρύθμισε στήλες στο Kanban", kanban_add_board: "έφτιαξε πίνακα στο Kanban", invoices_record: "κατέγραψε παραστατικά που εκδόθηκαν αλλού",
                   create_items: "πρόσθεσε εγγραφές ({app})", change_item: "άλλαξε εγγραφές ({app})", link_contact: "συνέδεσε επαφές ({app})",
                   link_items: "συνέδεσε εγγραφές ({app})", undo_change: "αναίρεσε αλλαγές ({app})", edit_in_app: "άλλαξε έγγραφα ({app})", files_write: "έγραψε αρχεία", files_move: "μετακίνησε αρχεία", files_delete: "έσβησε αρχεία" } },
    de: { subject: "orOS: Claudes Änderungen am {day}", intro: "Claude hat heute Folgendes in deinem orOS geändert ({n}):",
          undone: "rückgängig gemacht", undo: "Rückgängig machen: orOS › Einstellungen › Claude (orOS Gate) › Claudes Änderungen.", items: "{n} Einträge",
          tools: { budget_add: "Budget-Einträge hinzugefügt", budget_change: "einen Budget-Eintrag geändert", budget_delete: "Budget-Einträge gelöscht", budget_areas: "die Bereiche im Budget geändert", budget_categories: "die Kategorien im Budget geändert", budget_transfer: "einen Budget-Eintrag in eine Umbuchung verwandelt", budget_balances: "die Kontostände im Budget abgeglichen",
                   kanban_add_cards: "Kanban-Karten hinzugefügt", kanban_move_cards: "Kanban-Karten verschoben", kanban_change_card: "eine Kanban-Karte geändert",
                   kanban_add_columns: "Kanban-Spalten hinzugefügt, umbenannt oder eingestellt", kanban_add_board: "ein Kanban-Board angelegt", invoices_record: "anderswo ausgestellte Rechnungen erfasst",
                   create_items: "Einträge hinzugefügt ({app})", change_item: "Einträge geändert ({app})", link_contact: "Kontakte verknüpft ({app})",
                   link_items: "Einträge verknüpft ({app})", undo_change: "Änderungen rückgängig gemacht ({app})", edit_in_app: "Dokumente geändert ({app})", files_write: "Dateien geschrieben", files_move: "Dateien verschoben", files_delete: "Dateien gelöscht" } }
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

  // 6.01.02: a call read after the box's deadline dl (its clock; off =
  // our clock minus the box's, from its "hi"), with a 2 s margin, is late:
  // the box already answered Claude. No dl or no clock (an older relay): never late.
  function isLate(dl, off, now) {
    return typeof dl === "number" && isFinite(dl) && typeof off === "number" && isFinite(off) && now - off > dl - 2000;
  }

  // ---- PEND-1 (Chris 2026-11-16, cards «Ναι, και τα δύο»): queued changes ----
  // e2: a change Claude asked for while orOS was closed is applied with
  // the time Claude asked (at), not the time it runs. The time is kept
  // within the box's 7 days and never after now.
  var AT_SPAN = 8 * 86400000;
  // KB-QRES (Chris 2026-11-27, Noxpress gap 11): a queued change's result,
  // as change_history shows it: applied (with the start of its answer, e.g.
  // the new board's id), late (the owner changed it since) or refused (why).
  function qOutcome(res) {
    var c = res && typeof res.c === "string" ? res.c.replace(/\s+/g, " ").trim().slice(0, 300) : "";
    var o = { how: res && res.ok ? "applied" : res && res.late ? "late" : "refused" };
    if (c && !(res && res.late)) o.c = c;
    return o;
  }
  function queuedAt(t, now) {
    return typeof t === "number" && isFinite(t) && t > now - AT_SPAN ? Math.min(Math.floor(t), now) : 0;
  }
  // e2: the change would overwrite something that was itself changed at
  // or after at (by the owner or another device). b = the app's data
  // before, a = after (never written yet). An object is touched when one
  // of its own fields differs (a field that is an unstamped object or
  // list counts as its own) or it is removed; its stamp (m, mtime,
  // modified, om; with a per-field fm, the changed fields' fm, else the
  // stamp) at or after at makes the change late. A container whose only
  // change is a new stamped child (an add) or a touched stamped child is
  // not touched itself, so an add never waits for an older edit.
  var STAMP_KEYS = ["m", "mtime", "modified", "om"];
  function lateIn(b, a, at) {
    if (!(typeof at === "number" && at > 0)) return false;
    var hit = false;
    var isO = function (v) { return !!v && typeof v === "object" && !Array.isArray(v); };
    var stamped = function (o) { return isO(o) && (isO(o.fm) || STAMP_KEYS.some(function (k) { return typeof o[k] === "number"; })); };
    var same = function (x, y) { try { return JSON.stringify(x) === JSON.stringify(y); } catch (e) { return false; } };
    var objList = function (v) { return Array.isArray(v) && v.length > 0 && v.every(isO); };
    var own = function (o, keys) {
      if (isO(o.fm) && keys) { keys.forEach(function (k) { var s = typeof o.fm[k] === "number" ? o.fm[k] : STAMP_KEYS.reduce(function (m, sk) { return typeof o[sk] === "number" ? Math.max(m, o[sk]) : m; }, 0); if (s >= at) hit = true; }); return; }
      STAMP_KEYS.forEach(function (k) { if (typeof o[k] === "number" && o[k] >= at) hit = true; });
      if (isO(o.fm)) Object.keys(o.fm).forEach(function (k) { if (typeof o.fm[k] === "number" && o.fm[k] >= at) hit = true; });
    };
    // → true when x's change is not covered by a stamped object at or below x
    function walk(x, y, depth) {
      if (hit || same(x, y)) return false;
      if (depth > 8) return true;
      if (Array.isArray(x)) {
        if (!Array.isArray(y)) return true;
        var byId = {}, used = {}, loose = false;
        y.slice(0, 5000).forEach(function (v, i) { if (isO(v) && typeof v.id === "string") byId[v.id] = i; });
        x.slice(0, 5000).forEach(function (v, i) {
          var j = isO(v) && typeof v.id === "string" ? (byId[v.id] !== undefined ? byId[v.id] : -1) : i;
          if (j >= 0) used[j] = 1;
          var w = j >= 0 ? y[j] : undefined;
          if (isO(v) && w === undefined) { if (stamped(v)) own(v); else loose = true; return; }
          if (isO(v) && isO(w)) { if (walk(v, w, depth + 1)) loose = true; return; }
          if (!same(v, w)) loose = true;
        });
        y.slice(0, 5000).forEach(function (v, j) { if (!used[j] && !stamped(v)) loose = true; });   // a new stamped child is an add
        return loose;
      }
      if (!isO(x)) return true;
      if (!isO(y)) { if (stamped(x)) { own(x); return false; } return true; }
      var keys = {}, changed = [];
      Object.keys(x).concat(Object.keys(y)).forEach(function (k) { keys[k] = 1; });
      Object.keys(keys).forEach(function (k) {
        if (k === "fm" || STAMP_KEYS.indexOf(k) >= 0 || same(x[k], y[k])) return;
        var deep = (isO(x[k]) && isO(y[k])) || (objList(x[k]) && Array.isArray(y[k]));
        if (deep ? walk(x[k], y[k], depth + 1) : true) changed.push(k);
      });
      if (!changed.length) return false;
      if (!stamped(x)) return true;
      own(x, changed);
      return false;
    }
    walk(b, a, 0);
    return hit;
  }
  // a: the p- refs (p-<queue id>.<item>) in a change's arguments, the
  // same places relay/gate.js refsIn looks.
  var P_REF = /^p-[A-Za-z0-9_-]{16}\.\d{1,2}$/;
  var REF_KEYS = ["ref", "customer", "contact", "item", "deal", "trip"];
  function mapRefs(a, fn) {
    if (!isObj(a)) return a;
    var o = clone(a);
    var one = function (v) { if (typeof v !== "string") return v; var r = v.replace(/^oros:/, "").trim(); return P_REF.test(r) ? fn(r) : v; };
    var obj = function (x) { if (!isObj(x)) return x; REF_KEYS.forEach(function (k) { if (x[k] !== undefined) x[k] = one(x[k]); }); return x; };
    obj(o);
    ["refs", "items"].forEach(function (k) { if (Array.isArray(o[k])) o[k] = o[k].map(function (v) { return typeof v === "string" ? one(v) : obj(v); }); });
    ["changes", "links"].forEach(function (k) { if (Array.isArray(o[k])) o[k] = o[k].map(obj); });
    return o;
  }
  function pRefsIn(a) {
    var out = [];
    mapRefs(a, function (r) { if (out.indexOf(r) < 0) out.push(r); return r; });
    return out;
  }

  // The relay orOS uses (Mail › relay, a self-hosted one), else orOS's own.
  function relayOf(mail) {
    var u = isObj(mail) && isObj(mail.relay) && typeof mail.relay.url === "string" ? mail.relay.url.trim().replace(/\/+$/, "") : "";
    return /^https:\/\/[^\s/?#]+(\/[^\s?#]*)?$/.test(u) ? u : RELAY;
  }

  // HELPER-1 (7.16.00, Chris 16/11): who helps with the owner's data,
  // synced (slice "aihelper", localStorage "oros-ai-helper" { v, m }):
  //   "both"      the Assistant and Claude (through orOS Gate), the default;
  //   "assistant" the Assistant only: the Gate is off on every device and
  //               cannot be turned on;
  //   "claude"    Claude only: the Assistant leaves the menu and every way
  //               into it opens Claude (desktop or claude.ai) instead.
  var HELPERS = ["both", "assistant", "claude"];
  function helperClean(o) {
    var v = isObj(o) && HELPERS.indexOf(o.v) >= 0 ? o.v : "both";
    var m = isObj(o) && typeof o.m === "number" && isFinite(o.m) && o.m > 0 ? o.m : 0;
    return { v: v, m: m };
  }
  // The later choice wins; on a tie a fixed order, so two devices agree.
  function helperMerge(a, b) {
    a = helperClean(a); b = helperClean(b);
    if (a.m !== b.m) return a.m > b.m ? a : b;
    return HELPERS.indexOf(a.v) >= HELPERS.indexOf(b.v) ? a : b;
  }

  // 7.44.00: how many items a queued call deletes (0: none). change_item
  // delete by ref (1), by refs (each), or changes with action delete;
  // budget_delete its ids. An unlink deletes no item; files_delete has
  // its own question (askFiles).
  function delCount(name, a) {
    if (!isObj(a)) return 0;
    if (name === "budget_delete") return Array.isArray(a.ids) ? Math.max(1, a.ids.length) : 1;
    if (name === "kanban_change_card") return Array.isArray(a.remove_subtasks) ? a.remove_subtasks.length : 0;   // KB-SUBDEL
    if (name !== "change_item") return 0;
    if (Array.isArray(a.changes)) return a.changes.filter(function (c) { return isObj(c) && c.action === "delete"; }).length;
    if (a.action !== "delete") return 0;
    return Array.isArray(a.refs) ? Math.max(1, refsOf(a).length) : 1;
  }
  function refsOf(a) {
    var out = [];
    function add(v) { v = String(v == null ? "" : v).replace(/^oros:/, "").trim(); if ((/^r\d{1,9}$/.test(v) || /^p-[A-Za-z0-9_-]{16}\.\d{1,2}$/.test(v)) && out.indexOf(v) < 0) out.push(v); }
    if (!isObj(a)) return out;
    if (Array.isArray(a.refs)) a.refs.forEach(add); else add(a.ref);
    if (Array.isArray(a.changes)) a.changes.forEach(function (c) { if (isObj(c) && c.action === "delete") add(c.ref); });
    return out;
  }
  // The question's words: the app(s) and up to 10 titles, one per line,
  // from the Assistant frame's peek ([{ a: app name, t: title }]).
  function delWhat(name, items, n, more) {
    if (name === "budget_delete") return { app: "Budget", list: "" };
    if (name === "kanban_change_card") items = (Array.isArray(items) ? items : []).map(function (t) { return { a: "Kanban", t: String(t) }; });   // KB-SUBDEL: subtask texts
    var l = Array.isArray(items) ? items.filter(function (x) { return isObj(x) && typeof x.t === "string"; }) : [];
    var apps = [];
    l.forEach(function (x) { var a = String(x.a || ""); if (a && apps.indexOf(a) < 0) apps.push(a); });
    var shown = l.slice(0, 10), list = shown.map(function (x) { return x.t.slice(0, 100); }).join("\n");
    if (n > shown.length && shown.length) list += "\n" + String(more || "+{n}").replace("{n}", String(n - shown.length));
    return { app: apps.join(", "), list: list };
  }

  // KB-PREF (Chris 2026-11-23): p- refs of a board, its columns or cards that
  // waited with orOS closed (p-<change id>.<n>) → their ids here, from the
  // change record of the add that made them (chgTag p: { n: { kb: id } });
  // find(ref) → that record (the device's pFind).
  function kbMapP(args, find) {
    var miss = [];
    function walk(v) {
      if (typeof v === "string") {
        var r = v.trim();
        if (!P_REF.test(r)) return v;
        var rec = find(r);
        if (rec && typeof rec.kb === "string" && rec.kb) return rec.kb;
        if (miss.indexOf(r) < 0) miss.push(r);
        return v;
      }
      if (Array.isArray(v)) return v.map(walk);
      if (isObj(v)) { var o = {}; Object.keys(v).forEach(function (k) { o[k] = walk(v[k]); }); return o; }
      return v;
    }
    var out = walk(args);
    return miss.length ? { miss: miss } : { a: out };
  }
  // the ids an add made, by the position its p- ref names
  function kbMade(op, args, r) {
    var l = op === "add_cards" ? (Array.isArray(r.pos) ? r.pos : []) : op === "add_board" || op === "add_columns" ? (Array.isArray(r.ids) ? r.ids : []) : [];
    if (op === "add_columns" && !(isObj(args) && Array.isArray(args.columns))) l = [];
    var out = [];
    l.slice(0, 50).forEach(function (id, i) { if (typeof id === "string" && id) out.push({ i: i, rec: { kb: id } }); });
    return out;
  }
  var core = { screenTool: screenTool, SCREEN_HELD: SCREEN_HELD, BACK_OK: BACK_OK, delCount: delCount, refsOf: refsOf, delWhat: delWhat, NEVER: NEVER, SENSITIVE: SENSITIVE, sensitive: sensitive, HELPERS: HELPERS, helperClean: helperClean, helperMerge: helperMerge, budgetLines: budgetLines, bankNowText: bankNowText, BANK_GAP: BANK_GAP, accBals: accBals, dupPairs: dupPairs, bglCopy: bglCopy, invoiceList: invoiceList, invoicesRecord: invoicesRecord, invoicesUndo: invoicesUndo, OWN_WRITES: OWN_WRITES, stockItems: stockItems, publishTitles: publishTitles,
               relayOf: relayOf, RELAY: RELAY, isLate: isLate, budgetWrite: budgetWrite, budgetUndo: budgetUndo, canWrite: canWrite,
               kanbanWrite: kanbanWrite, kanbanUndo: kanbanUndo, lvFrom: lvFrom, joinHash: joinHash, chgMerge: chgMerge, seatMerge: seatMerge, seatClean: seatClean,
               stableArgs: stableArgs, digMerge: digMerge, digClean: digClean, digDue: digDue, digText: digText, ymd: ymd,
               WRITES: WRITES, ACT: ACT, DOCS: DOCS, QUEUED: QUEUED, actable: actable, ACT_TOOLS: ACT_TOOLS, ACT_OPEN: ACT_OPEN, ACT_WRITE: ACT_WRITE, writable: writable, ASK_OVER: ASK_OVER, packHits: packHits, allowed: allowed, toolsOf: toolsOf,
               pushLog: pushLog, cents: cents, LOG_MAX: LOG_MAX, PAGE: PAGE,
               queuedAt: queuedAt, qOutcome: qOutcome, lateIn: lateIn, mapRefs: mapRefs, pRefsIn: pRefsIn, P_REF: P_REF, kbMapP: kbMapP, kbMade: kbMade };
  if (typeof module !== "undefined" && module.exports) module.exports = core;
  if (!root || !root.document) return;
  root.orosGateCore = core;

  /* ---------- device ---------- */
  function readJSON(k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function writeJSON(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); }
    catch (e) { toast(tr("gate.saveFail")); return false; }   // R30: never silent
    // SY-AD (5.96.00): Budget or Kanban changed here may never have been
    // opened on this device; their data must still sync.
    var am = /^oros-([a-z]+)-data$/.exec(k);
    if (am && WRITES[am[1]]) { try { if (root.orosSync && typeof root.orosSync.adoptKey === "function") root.orosSync.adoptKey(k); } catch (e) {} }
    return true;
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
  // 6.01.02: the box's clock minus ours (from its "hi"), the last ping
  // tick and when the page was hidden: after a sleep the socket is renewed.
  var hiOff = null, pingAt = 0, hidAt = 0, PING_MS = 45000, SLEPT_MS = 60000;
  // 6.05.03 (Chris 2026-11-10 19:25: orOS open, yet Claude got the
  // closed-orOS copy): a window whose socket another window of this
  // browser replaced (4001, "other") waited for good, and renew() skipped
  // it, so when that window closed or slept nobody answered. The window
  // with the socket stamps LIVE_KEY on each ping; one in "other" checks
  // every OTHER_MS and takes over once the stamp is older than 2.5 pings.
  var LIVE_KEY = "oros-gate-live", OTHER_MS = 60000, otherTimer = null, TAB = Math.random().toString(36).slice(2, 10);
  function liveStamp() { try { localStorage.setItem(LIVE_KEY, JSON.stringify({ t: Date.now(), tab: TAB })); } catch (e) {} }
  function liveStale(now) {
    var o = readJSON(LIVE_KEY);
    return !isObj(o) || typeof o.t !== "number" || o.tab === TAB || (now || Date.now()) - o.t > PING_MS * 2.5;
  }
  function watchOther() {
    clearTimeout(otherTimer);
    otherTimer = setTimeout(function () {
      if (wsState !== "other" || ws || !pref().on) return;
      if (liveStale()) { retry = 0; clearTimeout(retryTimer); connect(); } else watchOther();
    }, OTHER_MS);
  }
  function setWs(s) { if (wsState !== s) { wsState = s; changed(); } }
  // GATE-AWAKE (Chris 2026-11-19 «Τα εγκρίνω και τα 3»): an orOS tab in
  // the background keeps answering. (1) The ping ticks in a small worker:
  // a hidden page's own timers are throttled to once a minute or less
  // (Chrome's intensive throttling), a worker's are not. Without a
  // worker (blocked, old browser) the page's own timer, as before.
  // (2) While the gate is on, the tab holds a Web Lock: Chrome and Edge
  // do not freeze a page that holds one. Neither keeps a tab the browser
  // discards for memory, nor a phone's: those still fall back to the
  // copy and the queue. The background host needs neither (its browser
  // runs with throttling off).
  var tickW = null, tickFn = null, tickBad = false, awakeEnd = null;
  function pingStart(fn) {
    pingStop();
    tickFn = fn;
    if (!tickBad && !HOST.bg && typeof Worker === "function" && typeof Blob === "function" && typeof URL !== "undefined" && URL.createObjectURL) {
      try {
        if (!tickW) {
          var u = URL.createObjectURL(new Blob(["var t=0;onmessage=function(e){clearInterval(t);t=e.data>0?setInterval(function(){postMessage(0)},e.data):0;};"], { type: "text/javascript" }));
          tickW = new Worker(u);
          URL.revokeObjectURL(u);
          tickW.onmessage = function () { if (tickFn) tickFn(); };
          tickW.onerror = function () { tickBad = true; try { tickW.terminate(); } catch (e) {} tickW = null; if (tickFn) { var f = tickFn; pingTimer = setInterval(f, PING_MS); } };
        }
        tickW.postMessage(PING_MS);
        return;
      } catch (e) { tickBad = true; tickW = null; }
    }
    pingTimer = setInterval(fn, PING_MS);
  }
  function pingStop() {
    clearInterval(pingTimer); pingTimer = null; tickFn = null;
    if (tickW) { try { tickW.postMessage(0); } catch (e) {} }
  }
  function awakeOn() {
    if (awakeEnd || HOST.bg) return;
    try {
      var L = typeof navigator !== "undefined" ? navigator.locks : null;
      if (!L || typeof L.request !== "function") return;
      awakeEnd = function () {};
      L.request("oros-gate-awake", { mode: "shared" }, function () {
        return new Promise(function (done) { awakeEnd = done; });
      }).then(null, function () { awakeEnd = null; });
    } catch (e) { awakeEnd = null; }
  }
  function awakeOff() { var f = awakeEnd; awakeEnd = null; if (typeof f === "function") { try { f(); } catch (e) {} } }
  function connect() {
    var p = pref();
    if (!p.on || !p.id || !p.tok || ws) return;
    if (HOST.bg && !HOST.ok) return;                 // GATE-HOST: an unconfirmed or stopped background host stays off
    if (helperRead().v === "assistant") { helperApply(); return; }   // HELPER-1: the Gate goes off here
    if (isObj(p.lv) && p.lv.kanban === "write") kanbanModel().then(null, function () {});   // Undo needs it at hand
    clearTimeout(retryTimer);
    setWs("connecting");
    var sock;
    try { sock = new WebSocket(relay().replace(/^https:/, "wss:") + "/gate/ws/" + p.id, ["gt1", "t." + p.tok]); }
    catch (e) { schedule(); return; }
    ws = sock;
    hiOff = null;
    sock.onopen = function () {
      retry = 0;
      setWs("on");
      liveStamp();
      sendVis(sock);
      if (pref().lvd) sendLv(sock);
      else sendBase(sock);
      lfSend(sock);
      pushReg();
      copySoon(4000);
      fileCopySoon(60000);
      awakeOn();
      pingAt = Date.now();
      pingStart(function () {
        var gap = Date.now() - pingAt;
        pingAt = Date.now();
        if (gap > PING_MS * 2.5) { renew(); return; }   // the page was frozen: the box counts this socket asleep
        try { sock.send("ping"); } catch (e) {}
        liveStamp();
      });
    };
    sock.onmessage = function (ev) {
      if (typeof ev.data !== "string" || ev.data === "pong") return;
      if (ev.data.indexOf('{"hi"') === 0) { onHi(ev.data); return; }
      if (ev.data.indexOf('{"lv"') === 0) { onLv(ev.data); return; }
      if (ev.data.indexOf('{"lf"') === 0) { onLf(sock, ev.data); return; }
      if (ev.data.indexOf('{"upd"') === 0) { onUpd(); return; }
      if (ev.data.indexOf('{"cq"') === 0) { applyQueue(sock, ev.data); return; }
      if (ev.data.indexOf('{"snapok"') === 0) return;
      if (ev.data.indexOf('{"fidxok"') === 0) { fileCopyAck(); return; }
      onCall(sock, ev.data);
    };
    sock.onclose = function (ev) {
      if (ws !== sock) return;                        // an old socket this device renewed
      ws = null;
      pingStop();
      // 4001: a newer connection of this gate took over; 4004: the gate is gone.
      if (ev && ev.code === 4004) { setWs("gone"); return; }
      if (ev && ev.code === 4001) { setWs("other"); watchOther(); return; }
      schedule();
    };
    sock.onerror = function () {};
  }
  function onHi(text) {
    var o;
    try { o = JSON.parse(text); } catch (e) { return; }
    if (isObj(o) && typeof o.hi === "number" && isFinite(o.hi)) hiOff = Date.now() - o.hi;
  }
  // A fresh socket after a sleep: the box sends the changes that waited
  // meanwhile, and it counts this device awake again.
  function renew() {
    if (!pref().on || wsState === "gone") return;
    // another window of this browser has the socket: take over only once it went quiet
    if (wsState === "other" && !ws && !liveStale()) { watchOther(); return; }
    if (ws) { var old = ws; ws = null; pingStop(); try { old.close(1000, "renew"); } catch (e) {} }
    retry = 0; clearTimeout(retryTimer);
    connect();
  }
  function ranList() {
    var l = readJSON(RAN_KEY), now = Date.now();
    return (Array.isArray(l) ? l : []).filter(function (e) { return isObj(e) && typeof e.id === "string" && typeof e.t === "number" && now - e.t < RAN_MS; });
  }
  function ranAdd(id) { var l = ranList(); l.push({ id: id, t: Date.now() }); writeJSON(RAN_KEY, l.slice(-RAN_MAX)); }
  function ranHas(id) { return ranList().some(function (e) { return e.id === id; }); }
  function ranDrop(id) { writeJSON(RAN_KEY, ranList().filter(function (e) { return e.id !== id; })); }
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
  // PEND-1 (e3, Chris 2026-11-16 «Ναι, μία φορά τη μέρα»): the second
  // packet, sent by the box when a change has waited 6 hours (once a day).
  var PUSH_WAIT = { en: "Claude's changes are waiting: open orOS to apply them", el: "Αλλαγές του Claude περιμένουν: άνοιξε το orOS για να εφαρμοστούν", de: "Änderungen von Claude warten: Öffne orOS, um sie anzuwenden" };
  var PUSH_V = 2;                                     // 2: the box also has the "waiting" packet
  var pushBusy = false;
  function pushReg() {
    var P = root.orosPush, p = pref();
    if (pushBusy || !p.on || !p.id || !p.tok || !P || typeof P.wakeToken !== "function") return;
    var want = P.enabled && P.enabled() ? P.deviceId() : "";
    var pp = isObj(p.pp) ? p.pp : null;
    if (want ? pp && pp.pid === want && pp.g === p.id && pp.v === PUSH_V : !pp) return;
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
        return P.wakePacket("gate:waiting", "orOS Gate", PUSH_WAIT[lang] || PUSH_WAIT.en, "gate:changes", "gate").then(function (cw) {
          return devCall({ act: "ping", id: p.id, tok: p.tok, pid: want, wt: wt, ct: ct, cw: cw }).then(function () { done({ pid: want, wt: wt, g: p.id, v: PUSH_V }); });
        });
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
    if (locked()) return;
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
  // Bytes (UTF-8) of the copy before sealing: the sealed text (base64url)
  // must stay under the relay's 900 KB (GATE_LIMITS.copyChars).
  function utf8Len(str) { try { return new TextEncoder().encode(str).length; } catch (e) { return str.length * 2; } }
  // 6.05.02: Budget's lines in the copy (bglCopy): at most this many bytes
  var BGL_MAX = 300000;
  var COPY_MAX = 640000, copyTimer = null, copyBusy = false, copyLast = "", copyAt = 0;
  function adoptWritten() {
    var p = pref(), S = root.orosSync;
    if (!p.on || !isObj(p.lv) || !S || typeof S.adoptKey !== "function") return;
    Object.keys(p.lv).forEach(function (id) {
      if (p.lv[id] !== "write" || !writable(id)) return;
      var key = id === "montage" ? "oros-montage" : "oros-" + id + "-data";
      // only real data: an empty copy here must not count as work to push
      try {
        var o = JSON.parse(localStorage.getItem(key) || "null");
        if (isObj(o) && Object.keys(o).some(function (f) { return Array.isArray(o[f]) && o[f].length > 0; })) S.adoptKey(key, true);
      } catch (e) {}
    });
  }
  function copySoon(ms) { clearTimeout(copyTimer); copyTimer = setTimeout(sendCopy, typeof ms === "number" ? ms : 5000); }
  function sendCopy() {
    var p = pref(), k = gateKey();
    if (copyBusy || !p.on || !k || !ws || ws.readyState !== 1) return;
    if (locked()) return;
    copyBusy = true;
    var ok = allowed(offered(), p.lv).map(function (a) { return a.id; }).filter(function (id) { return !sensitive(id); });
    var d = new Date(), month = d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2);
    var pd = new Date(d.getFullYear(), d.getMonth() - 1, 1), prev = pd.getFullYear() + "-" + ("0" + (pd.getMonth() + 1)).slice(-2);
    var calls = [["list_apps", {}]];
    ok.forEach(function (id) {
      if (SUMMARY[id]) {
        calls.push(["app_summary", { app: id }]);
        if (id === "studio") { /* no month: one summary of every show */ }
        else if (id !== "kanban") { calls.push(["app_summary", { app: id, month: month }]); calls.push(["app_summary", { app: id, month: prev }]); }
        // each board by its name too (5.96.00: «δουλεύεις και σε κλειστό orOS»)
        else {
          // KB-LIST (2026-11-23): the boards alone, first (small, so the
          // copy's size cap never drops it); the relay checks every closed
          // Kanban change against it (KB-CLOSED)
          calls.splice(1, 0, ["app_summary", { app: "kanban", boards_only: true }]);
          var kb = readStore("oros-kanban-data"), seen = {};
          (isObj(kb) ? kbBoards(kb) : []).slice(0, 30).forEach(function (b) {
            var nm = String(b.name || "").trim();
            if (nm && !seen[fold(nm)]) { seen[fold(nm)] = 1; calls.push(["app_summary", { app: "kanban", board: nm }]); }
          });
        }
      }
      // GATE-ACT: the everyday apps' summaries (the frame answers them)
      else if (ACT.indexOf(id) >= 0 || SUM_READ.indexOf(id) >= 0) calls.push(["app_summary", { app: id }]);
      // budget_lines needs a range: since 6.05.02 the copy keeps its lines
      // of about 400 days (ans.__bgl, bglCopy) and the relay answers any range
      if (LINES[id] && id !== "budget") calls.push([LINES[id], {}]);
    });
    // 6.05.02: what Claude changed (the last 30 days), as the default answer
    calls.push(["change_history", { _def: 1 }]);
    var ans = {}, size = 0, skipped = 0;
    calls.reduce(function (chain, c) {
      return chain.then(function () {
        var a = Object.assign({}, c[1]), def = !!a._def;
        delete a._def;
        return run(c[0], a).then(function (r) {
          if (!r || !r.ok || typeof r.c !== "string") return;
          var b = utf8Len(r.c) * (def ? 2 : 1);
          if (size + b > COPY_MAX) { skipped++; return; }
          ans[c[0] + " " + stableArgs(a)] = r.c; size += b;
          if (def) ans[c[0] + " {}"] = r.c;
        }, function () {});
      });
    }, Promise.resolve()).then(function () {
      if (ok.indexOf("budget") >= 0) {
        var bg = bglCopy(readStore("oros-budget-data"), localDay(), root.OrosBudgetLoans || null, BGL_MAX);
        if (bg) { ans.__bgl = bg; size += utf8Len(bg); }
      }
      // The search index (5.96.00): every item of the allowed apps with
      // its ref, so search_data and the queued changes work with orOS
      // closed. The refs stay on this device (assistant.js gateIndex).
      if (!ok.length) return;
      return actFrame().then(function (F) {
        if (!F || typeof F.index !== "function") { ans.__ixerr = "no index on this device"; return; }
        return F.index(ok).then(function (r) {
          if (!r || !r.ok) { ans.__ixerr = r && r.c ? String(r.c) : "no index"; return; }
          var list = [], n = 0;
          for (var i = 0; i < r.items.length; i++) {
            var one = JSON.stringify(r.items[i]), b = utf8Len(one) + 1;
            if (size + b > COPY_MAX) break;
            list.push(r.items[i]); size += b; n++;
          }
          ans.__index = JSON.stringify(list);
          if (n < r.items.length) ans.__ixpart = String(r.items.length);
          // GATE-PL11: edit_in_app's commands and the documents' names, so
          // the relay checks a dry run (and every queued edit) with orOS closed
          if (typeof F.editPack !== "function") return;
          // KB-HIST: Claude's changes of the last 30 days as a list, so the
          // relay answers change_history's app / from / to with orOS closed
          var hp = typeof F.hist === "function" ? F.hist(ok).then(function (hl) {
            var all = Array.isArray(hl) ? hl.slice(0, 500) : [], list = all, txt = JSON.stringify(list);
            while (list.length && size + utf8Len(txt) > COPY_MAX) { list = list.slice(0, Math.floor(list.length / 2)); txt = JSON.stringify(list); }
            if (list.length || !all.length) { ans.__hist = txt; size += utf8Len(txt); if (list.length < all.length) ans.__histpart = String(all.length); }
          }, function () {}) : Promise.resolve();
          return hp.then(function () { return F.editPack(); }).then(function (pk) {
            var txt = isObj(pk) && Object.keys(pk).length ? JSON.stringify(pk) : "", b = utf8Len(txt);
            if (txt && size + b <= COPY_MAX) { ans.__edit = txt; size += b; }
            // GATE-PL10: the mockups' names, for mockup_render with orOS closed
            if (ok.indexOf("mockups") >= 0) {
              var names = [];
              ["oros-mockups-data", "oros-mockups-goods"].forEach(function (k) {
                var d = readStore(k);
                (isObj(d) && Array.isArray(d.prj) ? d.prj : []).forEach(function (x) { if (isObj(x) && !x.del && typeof x.nm === "string" && x.nm.trim()) names.push(x.nm.trim().slice(0, 120)); });
              });
              var mt = JSON.stringify({ tpl: names.slice(0, 300) }), mb = utf8Len(mt);
              if (size + mb <= COPY_MAX) { ans.__mock = mt; size += mb; }
            }
          }, function () {});
        });
      }).then(null, function () { ans.__ixerr = "index failed"; });
    }).then(function () {
      if (skipped) ans.__skipped = String(skipped);
      var body = JSON.stringify({ lv: p.lv || {}, hold: typeof p.hold === "number" ? p.hold : 0, ans: ans });
      if (body === copyLast && Date.now() - copyAt < 6 * 3600000) return;      // nothing new
      return seal(k, JSON.stringify({ at: Date.now(), lv: p.lv || {}, hold: typeof p.hold === "number" ? p.hold : 0, ans: ans, dv: devName() })).then(function (sealed) {   // GATE-WHO: the device, in the sealed copy only
        if (!ws || ws.readyState !== 1) return;
        ws.send(JSON.stringify({ snap: sealed }));
        copyLast = body; copyAt = Date.now();
      });
    }).then(function () { copyBusy = false; }, function () { copyBusy = false; });
  }
  // Changes Claude left while orOS was closed: applied here, in order,
  // with the same rules as a live call (the switches and a pause as they
  // are now), then the box is told which ones are done.
  // F3: queued deletions waiting for the owner (id → queue item).
  var cqHeld = {}, cqBusy = {}, HELD = { held: 1 }, BUSY = { busy: 1 }, KEEP = { keep: 1 }, DECL = { ok: false, c: "declined" };
  // GQ-SETTLE (2026-11-22): orOS checks for a new release as it starts and
  // reloads into it, which cut a queued change off half done (and the new
  // copy then took it as done). The queue waits until that check is over:
  // no worker installing or waiting, and 10 s since the page started.
  var Q_SETTLE_MS = 10000, Q_SETTLE_TRIES = 45;
  function queueSettled(fn, n) {
    n = n || 0;
    var sw = null;
    try { sw = typeof navigator !== "undefined" && navigator.serviceWorker && typeof navigator.serviceWorker.getRegistration === "function" ? navigator.serviceWorker : null; } catch (e) { sw = null; }
    if (!sw || n >= Q_SETTLE_TRIES) { fn(); return; }
    sw.getRegistration().then(function (r) {
      if (!r) { fn(); return; }                     // no service worker here: nothing reloads it
      var age = typeof performance !== "undefined" && performance.now ? performance.now() : Q_SETTLE_MS;
      if (r.installing || r.waiting) { setTimeout(function () { queueSettled(fn, n + 1); }, 2000); return; }
      if (age < Q_SETTLE_MS) { setTimeout(function () { queueSettled(fn, n + 1); }, Q_SETTLE_MS - age + 50); return; }
      fn();
    }, function () { fn(); });
  }
  function heldAgain() {
    var ids = Object.keys(cqHeld);
    if (!ids.length || !ws || ws.readyState !== 1 || document.visibilityState !== "visible") return;
    applyQueue(ws, JSON.stringify({ cq: ids.map(function (id) { return cqHeld[id]; }) }));
  }
  function applyQueue(sock, text) {
    var o, k = gateKey();
    try { o = JSON.parse(text); } catch (e) { return; }
    if (!isObj(o) || !Array.isArray(o.cq) || !k || !pref().on) return;
    queueSettled(function () { whenOpen(function () {
      var done = [], files = false, held = [], outs = {};   // KB-QRES: outs = what became of each, for change_history
      o.cq.slice(0, 50).reduce(function (chain, it) {
        return chain.then(function () {
          if (!isObj(it) || typeof it.id !== "string") return;
          if (ranHas(it.id)) { done.push(it.id); return; }   // done live already (answered late), or sent twice (6.01.02)
          if (cqBusy[it.id]) return BUSY;                     // F3: its dialog is open now
          ranAdd(it.id);
          return unseal(k, it.c).then(function (plain) {
            var x = JSON.parse(plain);
            if (!isObj(x) || typeof x.n !== "string") return { ok: false, c: "refused" };
            // GQ-KEEP (2026-11-22): a change this orOS does not know (an older
            // copy, e.g. the cached one that runs before an update) stays queued
            // for a newer one, never acknowledged as done
            if (QUEUED.indexOf(x.n) < 0) { ranDrop(it.id); throw KEEP; }
            // 7.44.00 (Chris 2026-11-11 «Ρύθμισε το gate ώστε να δουλεύεις και με
            // το orOS κλειστό»): a deletion of items (change_item delete, budget_delete)
            // waits like files_delete: always asked here (askQueued, one question per
            // call, whatever its size); hidden, locked or unanswered, it stays queued.
            var nDel = core.delCount(x.n, x.a);
            if (nDel && (away() || document.visibilityState !== "visible" || (root.orosLock && root.orosLock.isLocked && root.orosLock.isLocked()))) { ranDrop(it.id); cqHeld[it.id] = it; throw HELD; }
            // F3: a deletion waits for the owner's Delete on this device; hidden,
            // locked or unanswered, it stays queued (offered again when orOS is
            // on screen, and on the next connect). Writes keep a conflict copy.
            if (x.n === "files_delete" && (away() || document.visibilityState !== "visible" || (root.orosLock && root.orosLock.isLocked && root.orosLock.isLocked()))) { ranDrop(it.id); cqHeld[it.id] = it; throw HELD; }
            // GATE-SCREEN: a tool for the owner's screen runs only with orOS on screen and unlocked
            if (screenWait(x.n, x.a)) { ranDrop(it.id); cqHeld[it.id] = it; throw HELD; }
            if (FILE_WRITE.indexOf(x.n) >= 0) { files = true; if (x.n === "files_write") x.a = Object.assign({}, isObj(x.a) ? x.a : {}, { __q: 1 }); }
            cqBusy[it.id] = 1;
            askLast = "";
            var at = queuedAt(x.t, Date.now());       // PEND-1 (e2): the time Claude asked
            return (nDel ? askQueued(x, nDel) : Promise.resolve("yes")).then(function (how) {
              if (how === "none") { ranDrop(it.id); cqHeld[it.id] = it; throw HELD; }   // nobody answered: asked again later
              if (how === "no") {                       // Keep: dropped, logged, nothing deleted
                delete cqBusy[it.id]; delete cqHeld[it.id];
                writeJSON(LOG_KEY, pushLog(readJSON(LOG_KEY), { t: Date.now(), n: String(x.n).slice(0, 20), a: [], k: 0, ok: 0, q: 1 }));
                outs[it.id] = { how: "declined" };
                return DECL;
              }
              preYes = nDel;                            // the owner just said Delete to these: no second question
              askLast = "";
              return run(x.n, x.a, { at: at, q: 1 }).then(function (res) { preYes = 0; return res; }, function (e) { preYes = 0; throw e; });
            }).then(function (res) {
              if (res === DECL) return res;
              delete cqBusy[it.id];
              if (res && res.ok && res.u) chgTag(res.u, it.id, at, res.made);   // PEND-1: q, p (items by index), at
              if ((x.n === "files_delete" || x.n === "local_folders_request" || x.n === "claude_folders_request" || (x.n === "edit_in_app" && !res.ok)) && askLast === "none") { ranDrop(it.id); cqHeld[it.id] = it; throw HELD; }   // asked, nobody answered
              delete cqHeld[it.id];
              var entry = { t: Date.now(), n: String(x.n).slice(0, 20), a: (res.a || []).slice(0, 10), k: res.k || 0, ok: res.ok ? 1 : 0, q: 1 };
              if (res.u) entry.u = res.u;
              writeJSON(LOG_KEY, pushLog(readJSON(LOG_KEY), entry));
              outs[it.id] = qOutcome(res);
              return res;
            });
          }).then(function (r) { if (r !== BUSY) done.push(it.id); }, function (e) {
            delete cqBusy[it.id];
            if (e === HELD) held.push(it.id);
            else if (e !== KEEP) { done.push(it.id); if (!outs[it.id]) outs[it.id] = { how: "failed", c: String(e && e.message || e || "").slice(0, 200) }; }
          });   // never in a loop
        });
      }, Promise.resolve()).then(function () {
        // KB-QRES: cqr = each one's outcome, sealed with the gate key (the box keeps it for change_history)
        var cqr = {};
        return Promise.all(done.filter(function (id) { return outs[id]; }).map(function (id) {
          return seal(k, JSON.stringify(outs[id])).then(function (x) { cqr[id] = x; }, function () {});
        })).then(function () { return cqr; });
      }).then(function (cqr) {
        // 7.48.00: cqh = deletions held for the owner here; the box offers them to a device on screen
        var msg = { cqa: done };
        if (held.length) msg.cqh = held;
        if (Object.keys(cqr).length) msg.cqr = cqr;
        try { if (sock.readyState === 1) sock.send(JSON.stringify(msg)); } catch (e) {}
        changed();
        copySoon(2000);
        if (files) fileCopySoon(60000);
      });
    }); });
  }
  function seatRead() { return seatClean(readJSON(SEAT_KEY)); }
  // GL-8 (Chris 2026-11-21): a file Claude uploaded (relay files_upload),
  // sealed in the box under FK = HMAC-K("orOS-gate-up|" + id): fetched in
  // calls of up to 20 pieces, opened, checked against its SHA-256 → Blob.
  function upFetch(id, path) {
    var p = pref(), k = gateKey();
    if (!k || !p.id || !p.tok) return Promise.reject(new Error("no gate key"));
    var te = new TextEncoder();
    return crypto.subtle.importKey("raw", keyBytes(k), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]).then(function (hk) {
      return crypto.subtle.sign("HMAC", hk, te.encode("orOS-gate-up|" + id));
    }).then(function (raw) {
      return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["decrypt"]);
    }).then(function (fk) {
      var parts = [], head = null;
      function more(from) {
        return devCall({ act: "up", id: p.id, tok: p.tok, up: id, from: from }).then(function (d) {
          if (!isObj(d) || !Array.isArray(d.p) || typeof d.n !== "number") throw new Error("bad answer");
          head = d;
          return d.p.reduce(function (ch, sealed, j) {
            return ch.then(function () {
              var x = String(sealed).split(".");
              return crypto.subtle.decrypt({ name: "AES-GCM", iv: keyBytes(x[0]), additionalData: te.encode("orOS-gate-up|" + id + "|" + (from + j)) }, fk, keyBytes(x[1] || ""));
            }).then(function (pt) { parts.push(new Uint8Array(pt)); });
          }, Promise.resolve()).then(function () {
            return from + d.p.length < d.n && d.p.length ? more(from + d.p.length) : null;
          });
        }, function (e) { throw new Error(e && e.code === "gone" ? "gone" : "the box did not answer"); });
      }
      return more(0).then(function () {
        var blob = new Blob(parts, { type: upType(path) !== "application/octet-stream" ? upType(path) : upType(head.name) });
        if (blob.size !== head.s) throw new Error("size");
        return blob.arrayBuffer().then(function (buf) { return crypto.subtle.digest("SHA-256", buf); }).then(function (h) {
          var hex = Array.prototype.map.call(new Uint8Array(h), function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
          if (hex !== head.h) throw new Error("checksum");
          return blob;
        });
      });
    });
  }
  function upDrop(id) {
    var p = pref();
    if (p.id && p.tok) devCall({ act: "up", id: p.id, tok: p.tok, up: id, from: 0, del: true }).catch(function () {});
  }
  var UP_TYPES = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", tif: "image/tiff", tiff: "image/tiff",
                   pdf: "application/pdf", svg: "image/svg+xml", otf: "font/otf", ttf: "font/ttf", woff2: "font/woff2" };
  function upType(name) { var m = /\.([a-z0-9]{1,5})$/i.exec(String(name || "")); return m && UP_TYPES[m[1].toLowerCase()] || "application/octet-stream"; }
  function dirty() { try { if (root.orosSync && typeof root.orosSync.markDirty === "function") root.orosSync.markDirty(); } catch (e) {} }
  // ---- HELPER-1: who helps with the data (synced) ----
  var HELPER_KEY = "oros-ai-helper", helperBusy = false;
  function helperRead() { return helperClean(readJSON(HELPER_KEY)); }
  function helperTell() {
    changed();
    try { root.dispatchEvent(new CustomEvent("oros-ai-helper", { detail: helperRead().v })); } catch (e) {}
  }
  // "Assistant only" turns the Gate off on this device (its box at the
  // relay and its closed copy go too, as with the owner's own switch).
  function helperApply() {
    if (helperBusy || helperRead().v !== "assistant" || !pref().on) return;
    helperBusy = true;
    api.disable().then(function () { helperBusy = false; }, function () { helperBusy = false; });
  }
  function helperSlice(n) {
    var S = root.orosSync;
    if (S && typeof S.registerSlice === "function") {
      S.registerSlice("aihelper", function () { var raw = null; try { raw = localStorage.getItem(HELPER_KEY); } catch (e) {} return raw ? helperRead() : null; },
        function (data) {
          if (!isObj(data)) return;
          var before = helperRead().v, next = helperMerge(helperRead(), data);
          if (!writeJSON(HELPER_KEY, next)) return;
          if (next.v !== before) { helperTell(); helperApply(); }
        }, HELPER_KEY, helperMerge);
      return;
    }
    if (n < 40) setTimeout(function () { helperSlice(n + 1); }, 500);
  }
  function helperOff() { var e = new Error("helper"); e.code = "helper"; return Promise.reject(e); }
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
    if (helperRead().v === "assistant") return Promise.resolve(false);   // HELPER-1
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
  // TRAY-2: the computer folders (localroots.js, "oros-local-pc") go to
  // the gate's other devices sealed with the gate's key: the relay keeps
  // and passes on a blob it cannot read. Every device sends the list it
  // has merged, so the newest of each folder wins everywhere; a device
  // that gets a list missing something it knows answers with its own.
  function localL() { return root.orosLocal && typeof root.orosLocal.mergeShared === "function" ? root.orosLocal : null; }
  function lfSend(sock) {
    var L = localL(), k = gateKey();
    sock = sock || ws;
    if (!L || !k || !sock || sock.readyState !== 1) return;
    var list = L.shared();
    if (!list.length) return;
    seal(k, JSON.stringify({ v: 1, l: list })).then(function (sealed) {
      try { if (sock.readyState === 1) sock.send(JSON.stringify({ lf: sealed })); } catch (e) {}
    }, function () {});
  }
  var lfTimer = 0;
  root.orosLocalShare = function () { clearTimeout(lfTimer); lfTimer = setTimeout(function () { lfSend(); }, 300); };
  function onLf(sock, text) {
    var o, L = localL(), k = gateKey();
    try { o = JSON.parse(text); } catch (e) { return; }
    if (!isObj(o) || typeof o.lf !== "string" || !L || !k) return;
    unseal(k, o.lf).then(function (t) {
      var d = JSON.parse(t);
      if (!isObj(d) || d.v !== 1 || !Array.isArray(d.l)) return;
      return Promise.resolve(L.mergeShared(d.l)).then(function () {
        // the other side lacks something this device has: send the merged list back
        if (JSON.stringify(L.shared()) !== JSON.stringify(L.pcMerge(d.l, [], Date.now()))) lfSend(sock);
      });
    }).then(null, function () {});
  }
  // TRAY-2: Claude asks for a folder of the owner's computer; the owner
  // allows it on any device where orOS is on screen (the phone too).
  // Nobody at a screen (hidden, background host, locked) → __held, and
  // the box keeps it for the next device on screen. → Promise of the
  // answer to Claude.
  // FOLDER-WAIT (Chris 2026-11-23): a folder question nobody answered here
  // stays as a notice (synced, so the phone shows it too) until it is
  // answered; it opens Settings › orOS Gate, and orOS on screen asks again.
  var askNotes = {};
  function askNotice(kind, shown, how) {
    try {
      var N = root.orosNotifs, key = "gate-ask:" + kind + ":" + fold(shown).slice(0, 200) + ":" + Math.floor(Date.now() / 86400000);
      if (!N) return;
      if (how === "none") {
        if (askNotes[key] || typeof N.emit !== "function") return;
        var id = N.emit({ ns: "system", key: key, type: "gate-ask", title: tr("gate.ask.note"), body: tr("gate.ask.noteBody").replace("{path}", shown), deepLink: "gate:asks", ttlDays: 30 });
        if (id) askNotes[key] = id;
      } else if (askNotes[key]) {
        if (typeof N.markAsRead === "function") N.markAsRead(askNotes[key]);
        delete askNotes[key];
      }
    } catch (e) {}
  }
  function localAsk(args, p) {
    var L = localL();
    if (!L) return Promise.resolve({ ok: false, c: "This orOS has no local folders yet; ask the owner to update orOS." });
    if (typeof p.hold === "number" && p.hold > Date.now()) return Promise.resolve({ ok: false, c: "The owner paused Claude's changes until " + new Date(p.hold).toISOString() + ". Nothing was asked." });
    var typed = typeof args.path === "string" ? args.path.trim().slice(0, 400) : "", pc = L.pcPath(typed);
    if (!pc) return Promise.resolve({ ok: false, c: "path must be a full folder path of the owner's computer, e.g. C:\\Users\\<name>\\Documents\\<folder> (or ~/<folder>). Nothing was asked." });
    if (L.pcRisky(pc)) return Promise.resolve({ ok: false, c: "That folder cannot be opened for Claude (a whole drive or home folder, or a system, program or key folder). Ask for the folder of the work itself. Nothing was asked." });
    var mode = args.access === "write" ? "w" : "r", days = Math.max(1, Math.min(90, Math.floor(+args.days || 30)));
    var why = typeof args.reason === "string" ? args.reason.replace(/\s+/g, " ").trim().slice(0, 300) : "";
    var now = Date.now(), same = L.shared().filter(function (e) { return !e.gone && e.pc.toLowerCase() === pc.toLowerCase() && e.mode === mode && e.exp > now + days * 86400000 - 86400000; })[0];
    if (same) return Promise.resolve({ ok: true, a: [], k: 0, c: "Already open for Claude: local:" + same.name + " (" + typed + "), " + (mode === "w" ? "write (new files only)" : "read") + ", until " + new Date(same.exp).toISOString().slice(0, 10) + ". Nothing was asked." });
    return new Promise(function (ok) {
      var settled = false, wrap = null;
      function end(v, how) { if (settled) return; settled = true; askLast = how; askNotice("pc", typed, how); if (wrap) wrap.remove(); ok(v); }
      if (offScreen() || locked() || (root.orosLock && root.orosLock.isLocked && root.orosLock.isLocked())) { end(false, "none"); return; }
      var body = tr(mode === "w" ? "gate.lf.bodyW" : "gate.lf.bodyR").replace("{days}", String(days));
      var list = typed + (why ? "\n\n" + tr("gate.lf.why").replace("{why}", why) : "");
      wrap = dialog(tr("gate.lf.title"), body, list, tr("gate.lf.no"), tr("gate.lf.yes"),
        function () { end(false, "no"); }, function () { end(true, "yes"); });
      setTimeout(function () { end(false, "none"); }, 60000);
    }).then(function (yes) {
      if (!yes) return askLast === "none" ? { ok: false, c: "__held" } : { ok: false, c: "The owner did not open that folder for Claude. Nothing was opened." };
      return Promise.resolve(L.addPc(typed, { mode: mode, days: days, anywhere: true, by: "claude" })).then(function (r) {
        return { ok: true, a: [], k: 1, c: "The owner opened it for Claude: local:" + r.name + " (" + typed + "), " + (mode === "w" ? "write (new files only, never replacing one)" : "read only") + ", until " + new Date(r.exp).toISOString().slice(0, 10) +
          ". It works on the owner's computer where orOS runs (a window, minimised, or in the tray); that computer gets it as soon as orOS runs there. Use local:" + r.name + "/<path inside it>." };
      }, function (e) {
        return { ok: false, c: "The owner allowed it, but the folder could not be opened" + (e && e.why === "notFolder" ? ": it is not a folder on that computer" : e && e.why === "tooMany" ? ": there are already 8 local folders (the owner closes one in Settings › Connected services › orOS Gate)" : "") + ". Nothing was opened." };
      });
    });
  }
  // CF-ASK (Chris 2026-11-22 «Πρόσθεσε τους φακέλους που χρειάζεσαι, σου
  // δίνω έγκριση»): Claude asks for a folder of the orOS disk among
  // Claude's folders. Asked on a screen like localAsk; on Yes it joins the
  // synced list (setFolders), as if the owner added it in Settings.
  function claudeAsk(args, p) {
    if (typeof p.hold === "number" && p.hold > Date.now()) return Promise.resolve({ ok: false, c: "The owner paused Claude's changes until " + new Date(p.hold).toISOString() + ". Nothing was asked." });
    return claudeFiles().then(function (CF) {
      var typed = typeof args.path === "string" ? args.path.trim().slice(0, 1024) : "", path = CF.normPath(typed);
      if (!path || path === "/internal") return { ok: false, c: "path must be a folder of the orOS disk, e.g. \"Studio/Podcasts\" (not the whole disk). Nothing was asked." };
      if (CF.secret(path)) return { ok: false, c: "\"" + CF.show(path) + "\" looks like a folder of keys or secrets; it is never opened for Claude. Nothing was asked." };
      var cur = foldersEff(), wantW = args.access === "write";   // GATE-PL9: app folders count
      var filesW = isObj(p.lv) && p.lv.files === "write", wNote = wantW && !filesW ? " Writing there also needs the owner's switch for Files at write (it is not now)." : "";
      var has = cur.filter(function (f) { return path === f || path.indexOf(f + "/") === 0; })[0];
      if (has) return { ok: true, a: [], k: 0, c: "Already one of Claude's folders" + (has === path ? "" : " (inside " + CF.show(has) + ")") + ": " + path + ". Nothing was asked." + wNote };
      if (cur.length >= 50) return { ok: false, c: "Claude's folders are full (50); the owner removes one in Settings › Connected services › orOS Gate. Nothing was asked." };
      var why = typeof args.reason === "string" ? args.reason.replace(/\s+/g, " ").trim().slice(0, 300) : "";
      return new Promise(function (ok) {
        var settled = false, wrap = null;
        function end(v, how) { if (settled) return; settled = true; askLast = how; askNotice("disk", CF.show(path), how); if (wrap) wrap.remove(); ok(v); }
        if (offScreen() || locked() || (root.orosLock && root.orosLock.isLocked && root.orosLock.isLocked())) { end(false, "none"); return; }
        var list = CF.show(path) + (why ? "\n\n" + tr("gate.lf.why").replace("{why}", why) : "");
        wrap = dialog(tr("gate.cf.title"), tr(wantW ? "gate.cf.bodyW" : "gate.cf.bodyR"), list, tr("gate.lf.no"), tr("gate.lf.yes"),
          function () { end(false, "no"); }, function () { end(true, "yes"); });
        setTimeout(function () { end(false, "none"); }, 60000);
      }).then(function (yes) {
        if (!yes) return askLast === "none" ? { ok: false, c: "__held" } : { ok: false, c: "The owner did not add that folder to Claude's folders. Nothing was opened." };
        return api.setFolders(cur.concat([path])).then(function (f) {
          if (f.indexOf(path) < 0 && !f.some(function (x) { return path.indexOf(x + "/") === 0; })) return { ok: false, c: "The owner allowed it, but the folder could not be added. Nothing was opened." };
          return { ok: true, a: ["files"], k: 1, c: "The owner added it to Claude's folders: " + path + " (synced to every device; the owner can remove it in Settings › Connected services › orOS Gate). Use paths inside it with files_list, files_write, studio_import and the others." + wNote };
        }, function () { return { ok: false, c: "The owner allowed it, but the folder list could not be saved on this device. Nothing was opened." }; });
      });
    }, function () { return { ok: false, c: "This orOS could not load Claude's folders; ask the owner to update orOS. Nothing was asked." }; });
  }
  // The relay asks a device whose orOS is on screen first (5.73.00):
  // a phone in the background loses its socket, a computer keeps it.
  function sendVis(sock) {
    try { if (sock && sock.readyState === 1) sock.send((HOST.ok && HOST.kind === "bg") || document.visibilityState === "hidden" ? "v0" : "v1"); } catch (e) {}
    // TRAY-1: this device runs Layout's work unseen, so the box also offers it the calls kept for a screen
    try { if (sock && sock.readyState === 1 && ((HOST.ok && HOST.kind === "bg") || deskApp())) sock.send("b1"); } catch (e) {}
    // GL-6 (Chris 2026-11-21): this orOS's version, so the box asks the newest device first
    try { var av = String(root.__orosAppVersion || ""); if (sock && sock.readyState === 1 && /^\d{1,3}\.\d{2}\.\d{2}$/.test(av)) sock.send("ver:" + av); } catch (e) {}
  }
  // GL-7 (Chris 2026-11-21 «Πρέπει να βρούμε λύσεις»): the owner pressed
  // "Update orOS on my computers" on another device, or Claude asked
  // (relay tool oros_update). The orOS desktop app asks its launcher to
  // download and swap in the newest orOS now (oros-portable /__oros/update,
  // 0.9.5+); every orOS then asks its service worker for the new version,
  // which reloads the page by itself. Nothing in the owner's data changes.
  var updAt = 0, UPD_GAP = 5 * 60 * 1000;
  function swCheck() {
    try { if (navigator.serviceWorker) navigator.serviceWorker.getRegistration().then(function (r) { if (r) r.update().then(null, function () {}); }, function () {}); } catch (e) {}
  }
  function onUpd() {
    var now = Date.now();
    if (now - updAt < UPD_GAP) return;
    updAt = now;
    var go = deskApp() ? fetch("/__oros/update", { method: "POST", cache: "no-store", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-Oros-Gate": "1" }, body: "{}" }).then(null, function () {}) : Promise.resolve();
    go.then(function () {
      swCheck();
      // the download takes a minute or two on the desktop app: ask again
      [90, 180, 300, 600].forEach(function (s) { setTimeout(swCheck, s * 1000); });
    });
  }
  // → true when the ask went to the box (it passes it to the other devices)
  function askUpdate() {
    try { if (ws && ws.readyState === 1) { ws.send('{"upd":1}'); return true; } } catch (e) {}
    return false;
  }
  try {
    document.addEventListener("visibilitychange", function () {
      var hidden = document.visibilityState === "hidden";
      if (hidden) hidAt = Date.now();
      else if (hidAt && Date.now() - hidAt > SLEPT_MS && pref().on) { hidAt = 0; renew(); return; }   // 6.01.02
      else hidAt = 0;
      if (ws) { sendVis(ws); if (!hidden) setTimeout(heldAgain, 1500); return; }
      if (!hidden && pref().on && wsState !== "gone") { retry = 0; clearTimeout(retryTimer); connect(); }
    });
    // Page Lifecycle: a frozen page that runs again (Chrome, Android).
    document.addEventListener("resume", function () { if (pref().on) renew(); });
  } catch (e) {}
  function schedule() {
    if (!pref().on) { setWs("off"); return; }
    setWs("connecting");
    retry = Math.min(retry + 1, 6);
    clearTimeout(retryTimer);
    retryTimer = setTimeout(connect, [2, 4, 8, 15, 30, 60][retry - 1] * 1000);
  }
  function drop() {
    clearTimeout(retryTimer); pingStop(); awakeOff();
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
  // opt (PEND-1): { at: the time Claude asked, for a queued change }.
  function run(name, args, opt) {
    opt = isObj(opt) ? opt : {};
    if (locked()) {
      return Promise.resolve({ ok: false, c: "orOS is locked on the owner's device. Ask the owner to unlock it." });
    }
    if (away() && name === "do_action") return Promise.resolve({ ok: false, c: HOST_TXT });
    var p = pref();
    var all = offered(), ok = allowed(all, p.lv), names = appNames(all), okIds = ok.map(function (a) { return a.id; });
    args = isObj(args) ? args : {};
    if (name === "list_apps") {
      return Promise.resolve({ ok: true, a: [], k: ok.length, c: JSON.stringify({
        apps: ok.map(function (a) {
          var o = { id: a.id, name: a.name, tools: toolsOf(a.id) };
          // DOCS-1 W5 (Chris 2026-11-15): the same words as the Assistant's search_data.
          if (a.id === "files") o.documents = DOCS_NOTE;
          if (sensitive(a.id)) o.sensitive = "Personal app the owner allowed after a warning: read only, only while orOS is open (never in the closed copy). Read only what the owner's request needs.";
          if (p.lv[a.id] === "write" && writable(a.id)) {
            o.change_tools = WRITES[a.id] ? WRITES[a.id].slice() : DOCS.indexOf(a.id) >= 0 ? DOC_WRITE.slice() : a.id === "files" ? FILE_WRITE.concat("undo_change")
              : ACT_WRITE.filter(function (n) { return n !== "edit_in_app" && FILE_WRITE.indexOf(n) < 0; });
            if (OWN_WRITES[a.id]) o.change_tools = o.change_tools.concat(OWN_WRITES[a.id]);
            o.changes = canWrite(p.lv, p.hold, a.id, Date.now()) ? "allowed (the owner is notified of each change)" : "paused by the owner until " + new Date(p.hold).toISOString();
          }
          return o;
        }),
        note: ok.length ? "Find items with search_data or app_summary (each item has a ref), then change them by ref. The owner is notified of each change and can undo it." : "The owner has not allowed any app yet (orOS › Settings › Connected services › orOS Gate)."
      }) });
    }
    if (name === "__tools") {
      return actFrame().then(function (F) {
        // GL-9: a frame that did not start answers not-ok, so the relay
        // keeps the list it has instead of storing an empty one
        if (!F) return { ok: false, c: "orOS could not start its tools on the device.", quiet: 1 };
        var list;
        try { list = F.tools() || []; } catch (e) { return { ok: false, c: "orOS could not list its tools.", quiet: 1 }; }
        return { ok: true, c: JSON.stringify(list), quiet: 1 };
      });
    }
    var budgetish = name === "app_summary" && (args.app === "budget" || args.app === "stock" || args.app === "kanban" || args.app === "studio");
    if (ACT_TOOLS.indexOf(name) >= 0 && !budgetish) {
      if ((ACT_WRITE.indexOf(name) >= 0 || name === "do_action" || ACT_OPEN.indexOf(name) >= 0) && !ok.some(function (a) { return p.lv[a.id] === "write" && actable(a.id); })) {
        return Promise.resolve({ ok: false, c: "The owner lets Claude change none of these apps (orOS › Settings › Connected services › orOS Gate: «Claude may also change …» per app)." });
      }
      // GATE-SCREEN: nobody sees orOS here → kept for a screen (a queued one is checked in applyQueue)
      if (!opt.q && screenTool(name, args) && offScreen() && !backOk(name)) {
        if (typeof p.hold === "number" && p.hold > Date.now()) return Promise.resolve({ ok: false, c: "The owner paused Claude's changes until " + new Date(p.hold).toISOString() + ". Nothing was done." });
        return Promise.resolve({ ok: false, c: SCREEN_HELD });
      }
      return actFrame().then(function (F) {
        if (!F) {
          if (name === "search_data") return own();
          return { ok: false, c: "orOS could not start its tools on the device; try again in a moment." };
        }
        var now = Date.now();
        // PEND-1: p- refs (items a queued create_items made) → this device's refs
        var prs = pRefsIn(args), pm = {}, miss = [];
        if (prs.length) {
          if (typeof F.ref !== "function") return { ok: false, c: "This device's orOS is too old for refs of items added while orOS was closed; use search_data." };
          prs.forEach(function (r) { var rec = pFind(r), loc = rec ? F.ref(rec) : ""; if (loc) pm[r] = loc; else miss.push(r); });
          if (miss.length) return { ok: false, c: "No item for " + miss.slice(0, 5).join(", ") + ": its add was not applied (refused, cancelled or still waiting). Find the item with search_data. Nothing was changed." };
          args = mapRefs(args, function (r) { return pm[r]; });
        }
        // GL-8: files_write with an upload → the file's bytes from the box
        var upId = name === "files_write" && typeof args.upload === "string" ? args.upload : "";
        return (upId ? upFetch(upId, args.path).then(function (blob) {
          var a2 = Object.assign({}, args, { blob: blob });
          delete a2.upload;
          return a2;
        }) : Promise.resolve(args)).then(function (args2) {
          return F.run(name, args2, opt.at ? { at: opt.at } : undefined);
        }, function (e) {
          return { ok: false, c: e && e.message === "gone" ? "That upload is no longer in the box (it expired after 7 days or was written already). Nothing was written." : "The upload could not be opened on the device (" + (e && e.message || "error") + "). Nothing was written." };
        }).then(function (r) {
          if (upId && r && r.ok) upDrop(upId);
          var out = { ok: !!r.ok, c: r.c || "", a: Array.isArray(r.a) ? r.a : [], k: r.k || 0 };
          if (r.ok && Array.isArray(r.made) && r.made.length) out.made = r.made;
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
      if (!SUMMARY[app]) return Promise.resolve({ ok: false, c: "app must be budget, stock, kanban or studio." });
      if (okIds.indexOf(app) < 0) return Promise.resolve({ ok: false, c: "The owner does not let Claude read " + app + "." });
      return summary().then(function (S) {
        var n = S.normArgs({ app: app, month: args.month, board: args.board, show: args.show }, localDay());
        if (!n.ok) return { ok: false, c: n.err };
        var lang = (root.orosLang || "en").slice(0, 2);
        var out = app === "budget" ? S.budgetMonth(readStore("oros-budget-data"), n.month, lang)
                : app === "stock" ? S.stockMonth(readStore("oros-stock-data"), n.month, lang)
                : app === "studio" ? S.studioShows(readStore("oros-studio-data"), { show: n.show })
                : S.kanbanBoards(readStore("oros-kanban-data"), { board: n.board, today: localDay(), boardsOnly: args.boards_only === true });   // KB-LIST
        if (out && out.ok === false) return { ok: false, c: out.err };
        return { ok: true, a: [app], k: out && out.items ? out.items.length : 1, c: JSON.stringify(out) };
      });
    }
    var line = null;
    Object.keys(LINES).forEach(function (id) { if (LINES[id] === name) line = id; });
    if (line) {
      if (okIds.indexOf(line) < 0) return Promise.resolve({ ok: false, c: "The owner does not let Claude read " + (names[line] || line) + "." });
      var r;
      if (line === "budget") r = budgetLines(readStore("oros-budget-data"), args, root.OrosBudgetLoans || null);
      else if (line === "invoices") r = root.OrosInvoicesCore ? invoiceList(root.OrosInvoicesCore, readStore("oros-invoices-data"), args, localDay(), okIds.indexOf("budget") >= 0 ? readStore("oros-budget-data") : null) : null;
      else if (line === "stock") r = root.OrosStockCore ? stockItems(root.OrosStockCore, readStore("oros-stock-data"), args) : null;
      else r = publishTitles(readStore("oros-publish-data"), args);
      if (!r) return Promise.resolve({ ok: false, c: "This app is not loaded on the device yet; try again in a moment." });
      if (!r.ok) return Promise.resolve({ ok: false, c: r.err });
      var dd = r.data, k = (dd.lines || dd.documents || dd.items || dd.titles || []).length;
      return Promise.resolve({ ok: true, a: [line], k: k, c: JSON.stringify(dd) });
    }
    if (name === "budget_refresh") {
      var nowB = Date.now();
      if (okIds.indexOf("budget") < 0) return Promise.resolve({ ok: false, c: "The owner does not let Claude read Budget." });
      if (!canWrite(p.lv, p.hold, "budget", nowB)) return Promise.resolve({ ok: false, c: closedMsg(p, "budget", names.budget || "Budget") });
      if (typeof root.__orosBankNow !== "function") return Promise.resolve({ ok: false, c: "This device's orOS is too old for budget_refresh. Nothing was read." });
      var devB = null;
      try { devB = JSON.parse(localStorage.getItem("oros-budget-bank-dev") || "null"); } catch (e) { devB = null; }
      var lastB = devB && typeof devB.t === "number" ? devB.t : 0;
      if (lastB && nowB - lastB >= 0 && nowB - lastB < BANK_GAP) return Promise.resolve(Object.assign({ a: ["budget"], k: 0 }, bankNowText({ gap: 1, last: lastB }, nowB)));
      return Promise.resolve(root.__orosBankNow(20000)).then(function (r) {
        return Object.assign({ a: ["budget"], k: r && typeof r.n === "number" ? r.n : 0 }, bankNowText(r, Date.now()));
      }, function () { return { ok: false, c: "The bank update failed on the device. Nothing was read." }; });
    }
    var op = { budget_add: "add", budget_change: "change", budget_delete: "delete", budget_areas: "areas", budget_categories: "cats", budget_transfer: "xfer", budget_balances: "bal" }[name];
    if (op) return change(op, args, p, names, opt.at);
    var kop = { kanban_add_cards: "add_cards", kanban_move_cards: "move_cards", kanban_change_card: "change_card", kanban_add_columns: "add_columns", kanban_add_board: "add_board" }[name];
    if (kop) return kanbanChange(kop, args, p, names, opt.at);
    if (name === "invoices_record") return invoicesChange(args, p, names, okIds, opt.at);
    if (name === "local_folders_request") return localAsk(args, p);   // TRAY-2
    if (name === "claude_folders_request") return claudeAsk(args, p);   // CF-ASK
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
  // AR-INV: Invoices' series whose payments come to Budget, or null
  // when Invoices' core is not loaded here.
  function invSeries() {
    var I = root.OrosInvoicesCore;
    if (!I || typeof I.seriesList !== "function") return null;
    try {
      var raw = null;
      try { raw = localStorage.getItem("oros-invoices-data"); } catch (e0) { raw = null; }
      var d = typeof I.parse === "function" ? I.parse(raw) : null;
      return I.seriesList(d).filter(function (x) { return x && SER_ID.test(x.id) && (x.kind === "inv" || x.kind === "rcpt"); })
        .map(function (x) { return { id: x.id, prefix: String(x.prefix || ""), kind: x.kind }; });
    } catch (e) { return null; }
  }
  // PEND-1 (e2): the words of a queued change that came too late.
  var LATE_TXT = "The owner changed this after you asked for the change (orOS was closed then); their change stays and yours was not applied.";
  function change(op, args, p, names, at) {
    var now = Date.now();
    if (!canWrite(p.lv, p.hold, "budget", now)) {
      return Promise.resolve({ ok: false, c: closedMsg(p, "budget", names.budget || "Budget") });
    }
    var n = op === "delete" && Array.isArray(args.ids) ? args.ids.length : 0;
    var asked = n > ASK_OVER && n <= 100 ? askDelete(n) : Promise.resolve(true);
    return asked.then(function (yes) {
      if (!yes) return { ok: false, c: "The owner did not confirm deleting " + n + " entries on the device; nothing was deleted." };
      var bd = readStore("oros-budget-data");
      var r = budgetWrite(op, bd, args, at || Date.now(), newTxId, op === "areas" ? invSeries() : undefined, root.OrosBudgetLoans || null);
      if (!r.ok) return { ok: false, c: r.err };
      if (at && lateIn(bd, r.data, at)) return { ok: false, late: 1, c: LATE_TXT };
      if (!writeJSON("oros-budget-data", r.data)) return { ok: false, c: "orOS could not save the change on the device; nothing was changed." };
      try { if (root.orosSync && typeof root.orosSync.markDirty === "function") root.orosSync.markDirty(); } catch (e) {}
      var uid = remember("budget", { cats: "budget_categories", xfer: "budget_transfer", bal: "budget_balances" }[op] || "budget_" + op, r.undo, now, r.ids.length);
      return { ok: true, a: ["budget"], k: r.ids.length, u: uid, c: JSON.stringify({ done: r.text, ids: r.ids }) };
    });
  }
  // INV-EXT: invoices_record on this device (Invoices set to «may
  // change»; Budget's areas only when Claude may read Budget).
  function invoicesChange(args, p, names, okIds, at) {
    var now = Date.now(), C = root.OrosInvoicesCore;
    if (!canWrite(p.lv, p.hold, "invoices", now)) return Promise.resolve({ ok: false, c: closedMsg(p, "invoices", names.invoices || "Invoices") });
    if (!C) return Promise.resolve({ ok: false, c: "Invoices is not loaded on the device yet; try again in a moment. Nothing was recorded." });
    var iv = readStore("oros-invoices-data");
    var r = invoicesRecord(C, iv, okIds.indexOf("budget") >= 0 ? readStore("oros-budget-data") : null, args, at || now);
    if (!r.ok) return Promise.resolve({ ok: false, c: r.err });
    var out = { recorded: r.ids, skipped: r.skipped };
    if (!r.data) return Promise.resolve({ ok: true, a: ["invoices"], k: 0, c: JSON.stringify(Object.assign(out, { note: "Nothing new: every document is in Invoices already." })) });
    if (at && lateIn(iv, r.data, at)) return Promise.resolve({ ok: false, late: 1, c: LATE_TXT });
    if (!writeJSON("oros-invoices-data", r.data)) return Promise.resolve({ ok: false, c: "orOS could not save the change on the device; nothing was recorded." });
    try { if (root.orosSync && typeof root.orosSync.adoptKey === "function") root.orosSync.adoptKey("oros-invoices-data"); } catch (e0) {}
    try { if (root.orosSync && typeof root.orosSync.markDirty === "function") root.orosSync.markDirty(); } catch (e) {}
    var uid = remember("invoices", "invoices_record", r.undo, now, r.ids.length);
    return Promise.resolve({ ok: true, a: ["invoices"], k: r.ids.length, u: uid, c: JSON.stringify(out) });
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
  // PEND-1: a queued change's record gets its queue id, the time Claude
  // asked and, for create_items, the items it made by index (synced, so
  // a p- ref finds its item from any device: pFind).
  function chgTag(uid, qid, at, made) {
    var l = chgList(), e = null;
    l.forEach(function (x) { if (x.id === uid) e = x; });
    if (!e) return;
    var o = Object.assign({}, e, { q: qid });
    if (at) o.at = at;
    if (Array.isArray(made) && made.length) {
      var pm = {};
      made.slice(0, 50).forEach(function (m) { if (isObj(m) && typeof m.i === "number" && m.i >= 0 && m.i < 100 && isObj(m.rec)) pm[String(m.i)] = m.rec; });
      if (Object.keys(pm).length) o.p = pm;
    }
    if (writeJSON(CHG_KEY, chgMerge(l.filter(function (x) { return x.id !== uid; }), [o]))) dirty();
  }
  function pFind(ref) {
    var m = /^p-([A-Za-z0-9_-]{16})\.(\d{1,2})$/.exec(String(ref || "")), hit = null;
    if (!m) return null;
    chgList().forEach(function (e) { if (e.q === m[1] && isObj(e.p) && isObj(e.p[m[2]])) hit = e.p[m[2]]; });
    return hit;
  }
  function kanbanChange(op, args, p, names, at) {
    var now = Date.now();
    if (!canWrite(p.lv, p.hold, "kanban", now)) {
      return Promise.resolve({ ok: false, c: closedMsg(p, "kanban", names.kanban || "Kanban") });
    }
    var mp = kbMapP(args, pFind);
    if (mp.miss) return Promise.resolve({ ok: false, c: "No board, column or card for " + mp.miss.slice(0, 5).join(", ") + " yet: the change that makes it was not applied (refused, cancelled or still waiting). Use the name (or the card's key), or app_summary kanban boards_only. Nothing was changed." });
    args = mp.a;
    return kanbanModel().then(function (M) {
      var kd = readStore("oros-kanban-data");
      var r = kanbanWrite(M, op, kd, args, at || Date.now(), kbId);
      if (!r.ok) return { ok: false, c: r.err };
      if (r.noop) return { ok: true, a: ["kanban"], k: 0, c: JSON.stringify({ done: r.text, ids: r.ids, updated: r.updated, unchanged: true }) };   // KB-KEY: a sync with nothing new
      // KB-SUBDEL: removing subtasks is a deletion: always the owner's Delete here first
      var nr = Array.isArray(r.removed) ? r.removed.length : 0;
      if (!nr) return kbSave(r);
      return askSubs(r.removed).then(function (yes) {
        if (!yes) return { ok: false, c: askLast === "none" ? "Nobody answered on the owner's screen; nothing was removed." : "The owner chose not to remove these " + nr + " subtasks; nothing was removed." };
        return kbSave(r);
      });
    }, function () { return { ok: false, c: "Kanban is not loaded on the device yet; try again in a moment." }; });
    function kbSave(r) {
      var kd = readStore("oros-kanban-data");             // read again: the owner may have changed it while asked
      if (Array.isArray(r.removed) && r.removed.length) {
        r = kanbanWrite(root.OrosKanbanModel, op, kd, args, at || Date.now(), kbId);
        if (!r.ok) return { ok: false, c: r.err };
      }
      if (at && lateIn(kd, r.data, at)) return { ok: false, late: 1, c: LATE_TXT };
      if (!writeJSON("oros-kanban-data", r.data)) return { ok: false, c: "orOS could not save the change on the device; nothing was changed." };
      try { if (root.orosSync && typeof root.orosSync.markDirty === "function") root.orosSync.markDirty(); } catch (e) {}
      var uid = remember("kanban", "kanban_" + op, r.undo, now, r.ids.length + (Array.isArray(r.removed) ? r.removed.length : 0) + (r.renamed || 0));
      var outK = { done: r.text, ids: r.ids };
      if (Array.isArray(r.updated) && r.updated.length) outK.updated = r.updated;      // KB-KEY: cards found by key and brought up to date
      if (Array.isArray(r.adopted) && r.adopted.length) outK.adopted = r.adopted;    // KB-ADOPT: keyless cards that took their key by text
      var made = kbMade(op, args, r);
      return { ok: true, a: ["kanban"], k: r.ids.length, u: uid, c: JSON.stringify(outK), made: made.length ? made : undefined };
    }
  }
  // KB-SUBDEL: the texts of the subtasks a kanban_change_card would remove (for the question).
  function kbRemovePeek(a) {
    if (!isObj(a) || !Array.isArray(a.remove_subtasks)) return Promise.resolve([]);
    return kanbanModel().then(function (M) {
      var r = kanbanWrite(M, "change_card", readStore("oros-kanban-data"), a, Date.now(), kbId);
      return r.ok && Array.isArray(r.removed) ? r.removed : [];
    }, function () { return []; });
  }
  // KB-SUBDEL: the owner's Delete for removing subtasks, with their texts
  // (at most 10 shown). A queued call the owner just confirmed (preYes)
  // is not asked twice. askLast as askDelete: "none" = nobody at the
  // screen or no answer in 20 s (onCall then hands it back as __held).
  function askSubs(texts) {
    var n = texts.length;
    if (preYes && n <= preYes) { preYes = 0; askLast = "yes"; return Promise.resolve(true); }
    return new Promise(function (ok) {
      var settled = false, wrap = null, w = core.delWhat("kanban_change_card", texts, n, tr("gate.fdel.more"));
      function end(v, how) { if (settled) return; settled = true; askLast = how; if (wrap) wrap.remove(); ok(v); }
      if (away() || document.visibilityState !== "visible" || (root.orosLock && root.orosLock.isLocked && root.orosLock.isLocked())) { end(false, "none"); return; }
      wrap = dialog(tr("gate.qdel.title"), tr("gate.qdel.body").replace("{n}", String(n)).replace("{app}", "Kanban"), w.list, tr("gate.del.no"), tr("gate.del.yes"),
        function () { end(false, "no"); }, function () { end(true, "yes"); });
      setTimeout(function () { end(false, "none"); }, 20000);
    });
  }
  // More than ASK_OVER deletions: the owner says yes on the device
  // within 20 s (the relay waits 25 s for the answer).
  // 7.48.00: askLast says how it ended: "yes", "no" (Don't delete) or
  // "none" (nobody at this screen: hidden, locked, the background host,
  // or no answer in 20 s). A live deletion that ends "none" is not
  // refused: onCall answers __held and the box queues it for a screen.
  function askDelete(n) {
    if (preYes && n <= preYes) { preYes = 0; askLast = "yes"; return Promise.resolve(true); }   // 7.44.00: a queued deletion the owner confirmed a moment ago
    return new Promise(function (ok) {
      var settled = false, wrap = null;
      function end(v, how) { if (settled) return; settled = true; askLast = how; if (wrap) wrap.remove(); ok(v); }
      if (away() || document.visibilityState !== "visible" || (root.orosLock && root.orosLock.isLocked && root.orosLock.isLocked())) { end(false, "none"); return; }
      wrap = dialog(tr("gate.del.title"), tr("gate.del.body").replace("{n}", String(n)), "", tr("gate.del.no"), tr("gate.del.yes"),
        function () { end(false, "no"); }, function () { end(true, "yes"); });
      setTimeout(function () { end(false, "none"); }, 20000);
    });
  }

  // GATE-FILES: deleting files is always asked here, naming them (at
  // most 10 shown); no answer within 20 s, or orOS hidden or locked = no.
  // F3: askLast tells a queued deletion "no" (Keep) from "none" (nobody
  // answered, or orOS hidden or locked: the deletion keeps waiting).
  var askLast = "";
  // 7.44.00: a queued deletion of items: what goes (the app, up to 10
  // titles from the frame's peek), Delete or Keep. → Promise<"yes" |
  // "no" | "none"> (none: no answer in 60 s, or orOS hidden or locked;
  // it stays queued and heldAgain asks again when orOS is on screen).
  var preYes = 0;
  function askQueued(x, n) {
    var what = x.n === "change_item" ? actFrame().then(function (F) { return F && typeof F.peek === "function" ? F.peek(core.refsOf(x.a)) : []; }, function () { return []; })
      : x.n === "kanban_change_card" ? kbRemovePeek(x.a) : Promise.resolve([]);
    return what.then(function (items) {
      return new Promise(function (ok) {
        var settled = false, wrap = null, w = core.delWhat(x.n, items, n, tr("gate.fdel.more"));
        function end(v) { if (settled) return; settled = true; askLast = v; if (wrap) wrap.remove(); ok(v); }
        if (away() || document.visibilityState !== "visible" || (root.orosLock && root.orosLock.isLocked && root.orosLock.isLocked())) { end("none"); return; }
        var body = tr("gate.qdel.body").replace("{n}", String(n)).replace("{app}", w.app || "orOS");
        wrap = dialog(tr("gate.qdel.title"), body, w.list, tr("gate.del.no"), tr("gate.del.yes"),
          function () { end("no"); }, function () { end("yes"); });
        setTimeout(function () { end("none"); }, 60000);
      });
    });
  }
  function askFiles(names) {
    return new Promise(function (ok) {
      var settled = false, wrap = null, list = Array.isArray(names) ? names.map(String) : [];
      function end(v, how) { if (settled) return; settled = true; askLast = how; if (wrap) wrap.remove(); ok(v); }
      if (!list.length || away() || document.visibilityState !== "visible" || (root.orosLock && root.orosLock.isLocked && root.orosLock.isLocked())) { end(false, "none"); return; }
      var shown = list.slice(0, 10).join("\n") + (list.length > 10 ? "\n" + tr("gate.fdel.more").replace("{n}", String(list.length - 10)) : "");
      wrap = dialog(tr("gate.fdel.title"), tr("gate.fdel.body").replace("{n}", String(list.length)), shown, tr("gate.del.no"), tr("gate.fdel.yes"),
        function () { end(false, "no"); }, function () { end(true, "yes"); });
      setTimeout(function () { end(false, "none"); }, 20000);
    });
  }
  // Claude's folders (synced slice "gatefiles"): { ver, m, f: [path] };
  // the newer m wins whole, a tie goes to the larger JSON (R5).
  var FILES_KEY = "oros-gate-files";
  // Kept as written (setFolders cleans with claudefiles.js); a pulled
  // list is held to plain disk paths here and cleaned again before use.
  function foldersClean(x) {
    if (!isObj(x) || typeof x.m !== "number" || !Array.isArray(x.f)) return { ver: 1, m: 0, f: [] };
    var f = x.f.filter(function (p, i, l) {
      return typeof p === "string" && p.length <= 1024 && p.indexOf("/internal/") === 0 && !/(^|\/)\.|[\u0000-\u001f]/.test(p.slice(10)) && l.indexOf(p) === i;
    }).slice(0, 50).sort();
    var out = { ver: 1, m: Math.floor(x.m), f: f };
    if (typeof x.q === "number" && isFinite(x.q) && x.q >= 52428800) out.q = Math.min(Math.floor(x.q), 1e12);   // F2: the closed copy's quota (bytes)
    // GATE-PL9: the app folders the owner took off the list
    var nd = Array.isArray(x.nd) ? x.nd.filter(function (p, i, l) { return appFolder(p) && l.indexOf(p) === i; }).sort() : [];
    if (nd.length) out.nd = nd;
    return out;
  }
  // GATE-PL9 (Chris 2026-11-22, dogfooding the podcast «Πλανόδιο», item 9):
  // each of these apps, when installed, brings its own folder into
  // Claude's folders without any setup, so studio_import, montage_import
  // and mockup_render have a place for their files. They are not stored
  // in the list (a device that has not pulled the owner's list yet must
  // not write over it); the owner can take one off (nd, synced), and
  // writing there follows the Files switch like every other folder.
  var APP_FOLDERS = { studio: "/internal/Studio/Podcasts", montage: "/internal/Montage/Projects", mockups: "/internal/Mockups/Claude" };
  function appFolder(p) { return Object.keys(APP_FOLDERS).some(function (id) { return APP_FOLDERS[id] === p; }); }
  function appFoldersOn(fr) {
    var have = {}, nd = fr && Array.isArray(fr.nd) ? fr.nd : [];
    offered().forEach(function (a) { if (a && a.id) have[a.id] = 1; });
    return Object.keys(APP_FOLDERS).filter(function (id) { return have[id] && nd.indexOf(APP_FOLDERS[id]) < 0; }).map(function (id) { return APP_FOLDERS[id]; });
  }
  // The folders Claude may use: the owner's list and the app folders
  // (cleaned again by claudefiles.js where they are used).
  function foldersEff() {
    var fr = foldersRead(), out = fr.f.slice();
    appFoldersOn(fr).forEach(function (p) { if (out.indexOf(p) < 0) out.push(p); });
    return out.sort();
  }
  // The app folders exist on the disk (made once, empty; never removed).
  var appDirsDone = {};
  function appFoldersMake() {
    var FS = root.orosFS;
    if (!pref().on || locked() || !FS || typeof FS.mkdir !== "function" || typeof FS.stat !== "function") return Promise.resolve();
    return appFoldersOn(foldersRead()).filter(function (p) { return !appDirsDone[p]; }).reduce(function (pr, p) {
      return pr.then(function () {
        return Promise.resolve().then(function () { return FS.stat(p); }).then(function (st) { return st ? st : FS.mkdir(p); }, function () { return FS.mkdir(p); })
          .then(function () { appDirsDone[p] = 1; }, function () {});
      });
    }, Promise.resolve());
  }
  var cfP = null;
  function claudeFiles() {
    if (root.OrosClaudeFiles) return Promise.resolve(root.OrosClaudeFiles);
    if (!cfP) {
      cfP = new Promise(function (ok, no) {
        var s = document.createElement("script");
        var v = root.orosTodayEnv && root.orosTodayEnv.version ? "?v=" + encodeURIComponent(root.orosTodayEnv.version) : "";
        s.src = "assistant/claudefiles.js" + v;
        s.onload = function () { root.OrosClaudeFiles ? ok(root.OrosClaudeFiles) : no(new Error("claudefiles")); };
        s.onerror = function () { cfP = null; no(new Error("claudefiles")); };
        document.head.appendChild(s);
      });
    }
    return cfP;
  }
  function foldersRead() { return foldersClean(readJSON(FILES_KEY)); }
  function foldersMerge(a, b) {
    var A = foldersClean(a), B = foldersClean(b);
    if (A.m !== B.m) return A.m > B.m ? A : B;
    return JSON.stringify(A) >= JSON.stringify(B) ? A : B;
  }
  function foldersSlice(n) {
    var S = root.orosSync;
    if (S && typeof S.registerSlice === "function") {
      S.registerSlice("gatefiles", function () { var raw = null; try { raw = localStorage.getItem(FILES_KEY); } catch (e) {} return raw ? foldersRead() : null; },
        function (data) {
          var v = foldersClean(data), cur = foldersRead();
          if (JSON.stringify(v) === JSON.stringify(cur)) return;
          writeJSON(FILES_KEY, v);                         // pulled: never markDirty
          changed();
        }, FILES_KEY, foldersMerge);
      return;
    }
    if (n < 40) setTimeout(function () { foldersSlice(n + 1); }, 500);
  }

  // ---- GATE-FILES F2: the closed copy of Claude's folders ----
  // gate/filecopy.js seals; sync.js gateDrop stores the pieces in
  // Dropbox (/gate/<gate id>/) behind shared links; the sealed index
  // goes to the gate box ({ fidx }), which reads it only during a call.
  // Never while Sensitive work is on (window.orosStrict, PR #1010) or
  // the device is locked; one run at a time; unchanged files are not
  // read again (FC_KEY keeps size, time and hash per path).
  var FC_KEY = "oros-gate-fcopy", FIDX_MAX = 880000, fcBusy = false, fcTimer = null, fcErr = "";
  var fcModP = null;
  function fcMod() {
    if (root.OrosGateFileCopy) return Promise.resolve(root.OrosGateFileCopy);
    if (!fcModP) {
      fcModP = new Promise(function (ok, no) {
        var s = document.createElement("script");
        var v = root.orosTodayEnv && root.orosTodayEnv.version ? "?v=" + encodeURIComponent(root.orosTodayEnv.version) : "";
        s.src = "gate/filecopy.js" + v;
        s.onload = function () { root.OrosGateFileCopy ? ok(root.OrosGateFileCopy) : no(new Error("filecopy")); };
        s.onerror = function () { fcModP = null; no(new Error("filecopy")); };
        document.head.appendChild(s);
      });
    }
    return fcModP;
  }
  function strictOn() {
    try { var S = root.orosStrict; return !!(S && typeof S.level === "function" && S.level()); } catch (e) { return false; }
  }
  // GATE-HOST (PEND-1 wave 2, b; Chris 2026-11-16 «Ναι, μετά το a»): an
  // installed orOS Portable / orOS USB can keep this profile's orOS open
  // without a window while every orOS window is closed (the owner's
  // opt-in on that computer, Settings › orOS Gate). The launcher starts
  // its browser headless at /?gate-host=<nonce> and confirms the nonce at
  // /__oros/gate-host, so no other page can claim to be it. Only there
  // the Gate works over the screen lock (nobody is at the screen; the
  // lock guards the screen, not the disk); dialogs, apps on screen and
  // deletions that ask the owner stay for a screen. Never under
  // Sensitive work: the host then turns itself off.
  // Two kinds (the launcher says which): "bg", the headless browser above;
  // "lock", an orOS window on orOS USB (which never closes), where the
  // same opt-in only lets the Gate work behind the screen lock.
  var HOST = { ok: false, n: "", kind: "", bg: false };
  (function () {
    var m = typeof location !== "undefined" ? /[?&]gate-host=([A-Za-z0-9_-]{16,64})(?:&|$)/.exec(location.search || "") : null;
    if (m) HOST.n = m[1];
    HOST.bg = !!(m && typeof navigator !== "undefined" && /HeadlessChrome/.test(navigator.userAgent || ""));
  })();
  function hostCheck() {
    if (!HOST.n || typeof fetch !== "function") return Promise.resolve(false);
    return fetch("/__oros/gate-host?n=" + encodeURIComponent(HOST.n), { cache: "no-store", credentials: "same-origin" }).then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (o) {
      if (!isObj(o) || o.host !== true) return false;
      if (strictOn()) { hostSet(false); return false; }
      HOST.kind = o.kind === "lock" ? "lock" : "bg";
      if (HOST.bg !== (HOST.kind === "bg")) return false;   // a window never acts as the background host
      HOST.ok = true;
      return true;
    }, function () { return false; });
  }
  // → Promise of { can, on, running, tray } from this computer's orOS
  // Portable / orOS USB, or null where it has none (a web browser).
  function hostState() {
    if (typeof fetch !== "function" || !/^http:\/\/(localhost|127\.0\.0\.1):47800$/.test(String(location.origin || ""))) return Promise.resolve(null);
    return fetch("/__oros/gate-host", { cache: "no-store", credentials: "same-origin" }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (o) { return isObj(o) && typeof o.can === "boolean" ? o : null; }, function () { return null; });
  }
  function hostSet(on) {
    if (typeof fetch !== "function") return Promise.resolve(null);
    return fetch("/__oros/gate-host", { method: "POST", cache: "no-store", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-Oros-Gate": "1" }, body: JSON.stringify({ on: !!on }) })
      .then(function (r) { return r.ok ? r.json() : null; }, function () { return null; })
      .then(function (o) {
        // Turned on in a window: the launcher hands it the lock-rule nonce.
        if (on && isObj(o) && typeof o.win === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(o.win) && !HOST.ok && !HOST.bg) { HOST.n = o.win; hostCheck(); }
        if (!on && !HOST.bg) HOST.ok = false;
        return o;
      });
  }
  function hostBye() {
    HOST.ok = false;
    drop();
    setTimeout(function () {
      fetch("/__oros/gate-host?n=" + encodeURIComponent(HOST.n) + "&bye=1", { cache: "no-store", credentials: "same-origin" }).then(null, function () {});
    }, 6000);
  }
  // locked for the Gate: the screen lock, except on the host (above)
  function locked() {
    if (HOST.ok && !strictOn()) return false;
    var L = root.orosLock;
    return !!(L && typeof L.isLocked === "function" && L.isLocked());
  }
  // nobody at a screen: the background host, or a lock-rule window
  // behind its screen lock. Dialogs and apps on screen wait for a person.
  function away() {
    if (!HOST.ok) return false;
    if (HOST.kind === "bg") return true;
    var L = root.orosLock;
    return !!(L && typeof L.isLocked === "function" && L.isLocked());
  }
  var HOST_TXT = "orOS runs in the background or behind the screen lock on the owner's computer, with nobody at the screen: this needs orOS open and unlocked on a screen. Nothing was done.";
  function fcDrop() { var S = root.orosSync; return S && S.gateDrop && typeof S.gateDrop.available === "function" && S.gateDrop.available() ? S.gateDrop : null; }
  function fcState() { var o = readJSON(FC_KEY); return isObj(o) ? o : {}; }
  // GQ-FC (2026-11-22: a PNG an app had just saved into Claude's folders
  // stayed "not in the copy" for files_link): a later, longer wait no
  // longer pushes back a sooner one, and a copy asked for while one runs
  // runs again right after it.
  var fcAt = 0, fcAgain = false;
  function fileCopySoon(ms) {
    ms = typeof ms === "number" ? ms : 60000;
    var at = Date.now() + ms;
    if (fcTimer && fcAt && fcAt <= at) return;
    clearTimeout(fcTimer);
    fcAt = at;
    fcTimer = setTimeout(function () { fcTimer = null; fcAt = 0; fileCopy(); }, ms);
  }
  // GX-1 (Chris 2026-11-21 «δώσε στο gate τη δυνατότητα να μπορεί να
  // κάνει εξαγωγή σε τοπικό φάκελο ή/και orOS Files»): an app's export
  // also goes to out, a local write folder the owner opened
  // (local:<root>/<folder>, localroots.js) or a folder of Claude's on the
  // orOS disk while Files is at «may change» and not paused. Never
  // replaces a file (name-2.ext, -3…). → the saved path, or throws { why }.
  var EXPORT_WHY = ["noBridge", "gateOff", "locked", "notAllowed", "paused", "outside", "badName", "noDisk", "nameTaken", "error"];
  function exportTo(out, name, blob, tool) {
    out = typeof out === "string" ? out.trim() : "";
    var fail = function (why) { return Promise.reject({ why: why }); };
    if (!out || !blob || typeof blob.size !== "number") return fail("error");
    if (/^local:/i.test(out)) {
      var L = root.orosLocal;
      if (!L || typeof L.write !== "function") return fail("noBridge");
      return Promise.resolve(L.write(out, name, blob, String(tool || "export").slice(0, 40))).then(null, function (e) { throw { why: e && typeof e.why === "string" ? e.why : "error" }; });
    }
    return claudeFiles().then(function (CF) {
      var p = pref(), dir = CF.normPath(out), now = Date.now();
      name = typeof name === "string" ? name.trim() : "";
      var why = !p.on ? "gateOff" : locked() ? "locked" : !isObj(p.lv) || p.lv.files !== "write" || barred("files") ? "notAllowed"
        : !canWrite(p.lv, p.hold, "files", now) ? "paused" : CF.reach(dir, CF.cleanFolders(foldersEff())) ? "outside" : CF.validName(name) ? "badName" : "";
      if (why) throw { why: why };
      var FS = root.orosFS;
      if (!FS || typeof FS.write !== "function" || typeof FS.stat !== "function") throw { why: "noDisk" };
      var dot = name.lastIndexOf("."), base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : "";
      var free = function (k) {
        if (k > 99) return Promise.resolve("");
        var path = dir + "/" + (k === 1 ? name : base + "-" + k + ext);
        return Promise.resolve().then(function () { return FS.stat(path); }).then(function (st) { return st ? free(k + 1) : path; }, function () { return path; });
      };
      return Promise.resolve(typeof FS.mkdir === "function" ? FS.mkdir(dir) : null).then(null, function () {}).then(function () { return free(1); }).then(function (path) {
        if (!path) throw { why: "nameTaken" };
        return Promise.resolve(FS.write(path, blob)).then(function () { fileCopySoon(3000); return path; }, function () { throw { why: "error" }; });
      });
    });
  }
  // GX-2: several files (an app's export) to each place of out (≤ 2)
  // → { saved: [paths], outFail: [{ to, why }] }
  function exportAll(outs, files, tool) {
    var list = (Array.isArray(outs) ? outs : typeof outs === "string" && outs ? [outs] : []).filter(function (x) { return typeof x === "string" && x.trim(); }).slice(0, 2);
    var saved = [], outFail = [];
    return list.reduce(function (pr, o) {
      return pr.then(function () {
        return (Array.isArray(files) ? files : []).slice(0, 200).reduce(function (p2, f) {
          return p2.then(function () {
            if (outFail.some(function (x) { return x.to === o; })) return;
            return exportTo(o, f && f.name, f && f.blob, tool).then(function (p) { saved.push(p); }, function (e) { outFail.push({ to: o, why: e && e.why || "error" }); });
          });
        }, Promise.resolve());
      });
    }, Promise.resolve()).then(function () { return { saved: saved, outFail: outFail }; });
  }
  function fcFilesOn(p) { return isObj(p.lv) && (p.lv.files === "read" || p.lv.files === "write"); }
  // Every file under the folders: [{ p, s, m, cloud: { h } | null }]
  function fcWalk(CF, folders) {
    var FS = root.orosFS, V = root.orosVault, rows = [], seen = {};
    function go(dir, d) {
      if (rows.length >= 3000 || d > 12) return Promise.resolve();
      return Promise.resolve().then(function () { return FS.ls(dir); }).catch(function () { return []; }).then(function (list) {
        return (list || []).reduce(function (pr, e) {
          return pr.then(function () {
            if (!e || !e.name || e.name.charAt(0) === ".") return;
            var p = dir + "/" + e.name;
            if (CF.secret(p)) return;
            if (e.dir) return go(p, d + 1);
            return Promise.resolve().then(function () { return FS.stat(p); }).catch(function () { return null; }).then(function (st) {
              if (!st || st.dir || seen[p]) return;
              seen[p] = 1;
              rows.push({ p: p, s: st.size || 0, m: st.mtime || 0, cloud: null });
            });
          });
        }, Promise.resolve());
      });
    }
    return folders.reduce(function (pr, f) { return pr.then(function () { return go(f, 0); }); }, Promise.resolve()).then(function () {
      if (V && typeof V.remoteOnly === "function") {
        folders.forEach(function (f) {
          var l = [];
          try { l = V.remoteOnly(f) || []; } catch (e) { l = []; }
          l.forEach(function (e) {
            if (!e || typeof e.path !== "string" || seen[e.path] || CF.secret(e.path) || /\/\./.test(e.path.slice(f.length))) return;
            seen[e.path] = 1;
            rows.push({ p: e.path, s: e.s || 0, m: e.m || 0, cloud: { h: String(e.h || "") } });
          });
        });
      }
      return rows;
    });
  }
  function fcBytes(r) {
    if (r.cloud) return root.orosVault.peek(r.p).then(function (b) { return new Uint8Array(b); });
    return Promise.resolve(root.orosFS.read(r.p)).then(function (b) { return b && typeof b.arrayBuffer === "function" ? b.arrayBuffer() : b; }).then(function (b) { return new Uint8Array(b); });
  }
  // The version files_* tools give (assistant.js cfVer): sha256[0:16]; a
  // file over 32 MB that was not read, from its size and time.
  function fcMetaVer(FC, r) { return FC.sha256(new TextEncoder().encode("size:" + r.s + ":" + (r.m || 0))).then(function (h) { return h.slice(0, 16); }); }
  function fcLater() { if (fcAgain) { fcAgain = false; fileCopySoon(2000); } }
  function fileCopy() {
    var p = pref(), k = gateKey(), D = fcDrop();
    if (fcBusy) { fcAgain = true; return Promise.resolve(false); }
    if (!p.on || !k || !ws || ws.readyState !== 1 || !fcFilesOn(p) || strictOn() || !D) return Promise.resolve(false);
    if (locked()) return Promise.resolve(false);
    if (!root.orosFS) return Promise.resolve(false);
    var fr = foldersRead(), eff = foldersEff();      // GATE-PL9: the app folders too
    if (!eff.length) return Promise.resolve(false);
    fcBusy = true;
    fcErr = "";
    var kRaw = keyBytes(k), gid = p.id, st = fcState(), cache = isObj(st.c) ? st.c : {}, FC, CF;
    var have = {}, names = {}, newCache = {}, files = [], rows;
    var known = {}, spaceOk = true, put = 0;
    return Promise.all([fcMod(), claudeFiles()]).then(function (m) {
      FC = m[0]; CF = m[1];
      known = FC.known(st.idx);
      return appFoldersMake().then(function () { return fcWalk(CF, CF.cleanFolders(eff)); });
    }).then(function (r) {
      rows = r;
      // hashes: cloud entries carry theirs; unchanged files keep theirs
      return rows.reduce(function (pr, x) {
        return pr.then(function () {
          x.kind = CF.kindOf(x.p.slice(x.p.lastIndexOf("/") + 1));
          var c = cache[x.p];
          if (x.cloud && /^[0-9a-f]{64}$/.test(x.cloud.h)) x.h = x.cloud.h;
          else if (isObj(c) && c.s === x.s && c.m === x.m && typeof c.h === "string") x.h = c.h;
          else if (FC.wants(x).c) return fcBytes(x).then(function (b) { return FC.sha256(b); }).then(function (h) { x.h = h; }, function () { x.h = ""; });
        }).then(function () {
          if (x.h) newCache[x.p] = { s: x.s, m: x.m, h: x.h };
        });
      }, Promise.resolve());
    }).then(function () {
      return D.list(gid).then(function (l) { l.forEach(function (e) { have[e.name] = e; }); }, function () {});
    }).then(function () {
      return D.space().then(function (sp) { if (sp && sp.allocated && (sp.allocated - sp.used) < sp.allocated * 0.1) spaceOk = false; });
    }).then(function () {
      var pl = FC.plan(rows.filter(function (x) { return !FC.wants(x).c || x.h; }).map(function (x) { return { p: x.p, s: x.s, kind: x.kind }; }), FC.quotaOf(fr.q));
      // one part ("c" / "t") of one file: its links, uploading only what is
      // new. n = its piece count when known (content), else from the bytes.
      function reuse(x, tag, n) {
        var old = known[x.h + "|" + tag];
        if (!old || (n && old.length !== n)) return Promise.resolve(null);
        return Promise.all(old.map(function (_, i) { return FC.pieceName(kRaw, x.h, tag, i); })).then(function (nms) {
          if (!nms.every(function (nm) { return have[nm]; })) return null;
          nms.forEach(function (nm) { names[nm] = 1; });
          return old;
        });
      }
      function part(x, tag, n, getBytes) {
        return reuse(x, tag, n).then(function (old) {
          if (old) return old;
          return getBytes().then(function (bytes) {
            if (!bytes) return null;
            var cnt = FC.count(bytes.length), links = [], chain = Promise.resolve();
            for (var i = 0; i < cnt; i++) (function (i) {
              chain = chain.then(function () { return FC.pieceName(kRaw, x.h, tag, i); }).then(function (nm) {
                names[nm] = 1;
                var up = have[nm] ? Promise.resolve() : !spaceOk ? Promise.reject(new Error("space")) :
                  FC.seal(kRaw, x.h, tag, i, bytes.slice(i * FC.PIECE, (i + 1) * FC.PIECE)).then(function (b) { put += b.length; return D.put(gid + "/" + nm, b); });
                return up.then(function () { have[nm] = { name: nm }; return D.share(gid + "/" + nm); }).then(function (u) { links[i] = u; });
              });
            })(i);
            return chain.then(function () { return links; });
          });
        });
      }
      return rows.reduce(function (pr, x) {
        return pr.then(function () {
          var e = { p: x.p, s: x.s, m: x.m, k: x.kind };
          files.push(e);
          var t = pl.take[x.p];
          var vP = x.h && !(x.s > 33554432 && !x.cloud) ? Promise.resolve(x.h.slice(0, 16)) : fcMetaVer(FC, x);
          return vP.then(function (v) {
            e.v = v;
            if (!t) { e.x = pl.out[x.p] || "none"; return; }
            e.h = x.h;
            return part(x, "c", FC.count(x.s), function () { return fcBytes(x); }).then(function (c) {
              e.c = c;
              if (!t.t) return;
              return part(x, "t", 0, function () {
                return actFrame().then(function (F) {
                  if (!F || typeof F.text !== "function") return null;
                  return F.text(x.p).then(function (r) { return r && r.ok && r.text ? FC.textBytes(r.text) : null; });
                });
              }).then(function (tl) { if (tl) e.t = tl; });
            }).catch(function (err) {
              delete e.c; delete e.t; delete e.h;
              e.x = err && err.message === "space" ? "space" : "err";
              if (err && /dropbox-scope/.test(err.message || "")) fcErr = "scope";
              if (err && /dropbox-full/.test(err.message || "")) { fcErr = "full"; spaceOk = false; }
            });
          });
        });
      }, Promise.resolve()).then(function () { return pl; });
    }).then(function (pl) {
      var pp = pref();
      var idx = { v: 1, at: Date.now(), f: CF.cleanFolders(eff), q: FC.quotaOf(fr.q), used: pl.used, files: files,
                  w: isObj(pp.lv) && pp.lv.files === "write" ? 1 : 0 };   // F3: the relay checks closed changes against these
      if (typeof pp.hold === "number" && pp.hold > Date.now()) idx.hold = pp.hold;
      var text = JSON.stringify(idx);
      while (utf8Len(text) > FIDX_MAX && idx.files.length) { idx.files.pop(); idx.cut = 1; text = JSON.stringify(idx); }
      return seal(k, text).then(function (sealed) {
        if (!ws || ws.readyState !== 1) throw new Error("offline");
        ws.send(JSON.stringify({ fidx: sealed }));
        writeJSON(FC_KEY, { at: idx.at, c: newCache, idx: { files: files.map(function (e) { return { h: e.h, c: e.c, t: e.t }; }).filter(function (e) { return e.h; }) }, n: Object.keys(names), up: put, used: pl.used, err: fcErr });
        changed();
      });
    }).then(function () { fcBusy = false; fcLater(); return true; }, function () { fcBusy = false; fcLater(); return false; });
  }
  // The box kept the new index: pieces no index names any more go, once
  // they are a day old (another device may still name them for a while).
  function fileCopyAck() {
    var p = pref(), D = fcDrop(), st = fcState();
    if (!D || !p.id || !Array.isArray(st.n)) return;
    var keep = {};
    st.n.forEach(function (n) { keep[n] = 1; });
    D.list(p.id).then(function (l) {
      var old = l.filter(function (e) { return !keep[e.name] && e.at && Date.now() - e.at > 86400000; }).slice(0, 200);
      return old.reduce(function (pr, e) { return pr.then(function () { return D.remove(p.id + "/" + e.name).catch(function () {}); }); }, Promise.resolve());
    }).catch(function () {});
  }
  // Sensitive work (and the owner) can drop Claude's closed copy at once:
  // the box forgets the copy and the file index, and the pieces leave Dropbox.
  function dropCopyNow() {
    var p = pref();
    if (!p.on || !p.id) { var e1 = new Error("gate-off"); e1.code = "gate-off"; return Promise.reject(e1); }
    if (root.orosLock && root.orosLock.isLocked && root.orosLock.isLocked()) { var e2 = new Error("locked"); e2.code = "locked"; return Promise.reject(e2); }
    if (!ws || ws.readyState !== 1) { var e3 = new Error("offline"); e3.code = "offline"; return Promise.reject(e3); }
    ws.send(JSON.stringify({ fdrop: 1 }));
    copyLast = "";
    try { localStorage.removeItem(FC_KEY); } catch (e) {}
    var D = fcDrop();
    changed();
    return (D ? D.remove(p.id).catch(function () {}) : Promise.resolve()).then(function () { return { ok: true }; });
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
      var lk = locked();
      try { sock.send(JSON.stringify({ r: q.q, ok: !!(p.on && k && !lk), c: p.on && k && !lk ? k : "" })); } catch (e) {}
      return;
    }
    if (!p.on) { done({ ok: false, c: "The gate is off." }); return; }
    // 6.01.02: read after the box gave up (a sleep): not started, the box
    // already answered Claude (a change waits in its queue).
    if (isLate(q.dl, hiOff, Date.now())) {
      try { sock.send(JSON.stringify({ r: q.q, ok: false, c: "late" })); } catch (e) {}
      return;
    }
    askLast = "";
    run(q.n, q.a).then(function (res) {
      if (res && res.ok && q.n !== "__tools") ranAdd(q.q);
      // GX-4: what Claude just wrote or exported is in the files copy within
      // seconds, so files_link finds it (it was 60 s and more)
      if (res && res.ok && FRESH_COPY.indexOf(q.n) >= 0) fileCopySoon(3000);
      // 7.48.00: a deletion this screen could not ask about (nobody here)
      // is handed back to the box, which queues it for a device on screen.
      if (res && !res.ok && askLast === "none" && (core.delCount(q.n, q.a) || q.n === "edit_in_app")) {   // TRAY-3: Layout's removals too
        try { sock.send(JSON.stringify({ r: q.q, ok: false, c: "__held" })); } catch (e) {}
        return;
      }
      done(res);
    }, function () { done({ ok: false, c: "The call failed on the device." }); });
  }

  /* ---------- API for Settings ---------- */
  var api = {
    askUpdate: askUpdate,   // GL-7: Settings › orOS Gate › Update orOS on my computers
    // For the hidden Assistant frame (assistant.js GATE).
    frameReady: function () { if (actReady) actReady(); },
    act: ACT.concat(DOCS, ["files"]),
    levels: function () {
      var p = pref(), out = {};
      if (!p.on || !isObj(p.lv)) return out;
      Object.keys(p.lv).forEach(function (id) { if (!barred(id) && (p.lv[id] === "read" || p.lv[id] === "write")) out[id] = p.lv[id]; });
      return out;
    },
    // "" = Claude may change this app now; else why not (sent to Claude).
    writeOk: function (id) {
      var p = pref(), now = Date.now();
      if (!p.on) return "The gate is off.";
      if (locked()) return "orOS is locked on the owner's device.";
      if (!id || !actable(id) || !isObj(p.lv) || p.lv[id] !== "write") return "The owner does not let Claude change " + (id || "this app") + " (orOS › Settings › Connected services › orOS Gate).";
      if (!canWrite(p.lv, p.hold, id, now)) return closedMsg(p, id, id);
      return "";
    },
    // do_action (W5): "" = Claude may do it now in this app; else why not.
    actionOk: function (id) {
      var p = pref(), now = Date.now();
      if (!p.on) return "The gate is off.";
      if (away()) return HOST_TXT;
      if (locked()) return "orOS is locked on the owner's device.";
      if (!id || barred(id)) return "Claude may never open " + (id || "this app") + ".";
      if (typeof p.hold === "number" && p.hold > now) return "The owner paused Claude's changes until " + new Date(p.hold).toISOString() + ". Nothing was done.";
      return "";
    },
    askDelete: function (n) { return askDelete(n); },
    // GATE-FILES: every delete of files is asked on the device, with the names.
    askFiles: function (names) { return askFiles(names); },
    // F2: drop Claude's closed copy now (Sensitive work, Settings) → Promise<{ ok }>;
    // rejects with e.code "gate-off" | "offline" | "locked"
    dropCopy: function () { return dropCopyNow(); },
    // F2: the closed copy of the files: { at, used, quota, up, err } (err "scope": sign in to Dropbox again)
    fileCopyInfo: function () { var st = fcState(); return { at: st.at || 0, used: st.used || 0, quota: (foldersRead().q || 262144000), up: st.up || 0, err: st.err || "" }; },
    setQuota: function (bytes) {
      var cur = foldersRead(), q = Math.floor(+bytes || 0);
      if (!(q >= 52428800)) return false;
      var next = { ver: 1, m: stampAfter(Date.now(), cur.m), f: cur.f, q: q };
      if (cur.nd) next.nd = cur.nd;
      if (!writeJSON(FILES_KEY, next)) return false;
      dirty(); changed(); fileCopySoon(5000);
      return true;
    },
    refreshFileCopy: function () { return fileCopy(); },
    // Claude's folders on the orOS disk (synced): [path], with the app
    // folders (GATE-PL9), none inside another one on the list
    folders: function () { var l = foldersEff(); return l.filter(function (p) { return !l.some(function (q) { return q !== p && p.indexOf(q + "/") === 0; }); }); },
    // GATE-PL9: the app folders of this device (for Settings to mark them)
    appFolders: function () { return appFoldersOn({}); },
    exportAll: exportAll,   // GX-2: an app's files to out
    exportTo: exportTo,   // GX-1: an export also into a local folder or Claude's folders on the orOS disk
    EXPORT_WHY: EXPORT_WHY,
    // → Promise<[path] saved> (cleaned: valid, no secrets, none inside another)
    setFolders: function (list) {
      return claudeFiles().then(function (CF) {
        var cur = foldersRead(), all = CF.cleanFolders(list), mine = appFoldersOn({});
        // GATE-PL9: an app folder left off the list is taken off (nd); one
        // inside another folder of the list is still reachable, not off
        var nd = mine.filter(function (d) { return all.indexOf(d) < 0 && !all.some(function (q) { return d.indexOf(q + "/") === 0; }); })
          .concat((cur.nd || []).filter(function (d) { return mine.indexOf(d) < 0; })).sort();
        // only this device's app folders are computed; another app's stays as listed
        var f = all.filter(function (d) { return mine.indexOf(d) < 0; });
        if (JSON.stringify(f) === JSON.stringify(cur.f) && JSON.stringify(nd) === JSON.stringify(cur.nd || [])) return all;
        var next = { ver: 1, m: stampAfter(Date.now(), cur.m), f: f };
        if (cur.q) next.q = cur.q;
        if (nd.length) next.nd = nd;
        if (!writeJSON(FILES_KEY, next)) throw new Error("save");
        dirty(); changed(); fileCopySoon(5000);
        return all;
      });
    },
    relayUrl: function () { return relay() + "/mcp"; },
    // The relay this gate runs on, and which kind: own | mail | shared.
    relayInfo: function () {
      var r = relay(), own = ownRelay();
      return { url: r, own: own, mine: mineRelay(), kind: own && r === own ? "own" : r === RELAY ? "shared" : "mail" };
    },
    // STRUCT-4: the one orOS relay (shell orosRelay, Settings › Connected
    // services); this stays for callers of the older name.
    setOwnRelay: function (u) {
      if (root.orosRelay && typeof root.orosRelay.set === "function") {
        var done = root.orosRelay.set(u);
        if (done) { try { localStorage.removeItem(OWN_KEY); } catch (e) {} changed(); }
        return done;
      }
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
    sensitive: SENSITIVE.slice(),
    state: function () {
      var p = pref();
      // moved: Mail's relay changed after the gate was made; the gate
      // stays on the old one until it is turned off and on again.
      var h = typeof p.hold === "number" && p.hold > Date.now() ? p.hold : 0;
      return { on: !!p.on, conn: wsState, at: p.at || 0, gid: p.on && typeof p.id === "string" ? p.id.slice(0, 6) : "", moved: !!(p.on && p.r && p.r !== relayNow()), hold: h,
               lv: isObj(p.lv) ? JSON.parse(JSON.stringify(p.lv)) : {} };
    },
    apps: function () {
      var lv = pref().lv || {};
      return offered().filter(function (a) { return !barred(a.id); }).map(function (a) {
        return { id: a.id, name: a.name, read: lv[a.id] === "read" || lv[a.id] === "write", write: lv[a.id] === "write",
                 canWrite: writable(a.id), sensitive: sensitive(a.id), tools: toolsOf(a.id) };
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
    // Never-apps, "write" for an app that cannot be changed and turning
    // on a personal app (it needs its warning) are skipped, the rest go. → the number of apps set, or -1 when
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
        if (level && sensitive(id) && p.lv[id] !== "read") return;   // turned on only after its warning (setApp)
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
      if (e.app === "invoices") {                     // INV-EXT: invoices_record
        var IC = root.OrosInvoicesCore, ir = IC ? invoicesUndo(IC, readStore("oros-invoices-data"), e.x, Date.now()) : { ok: false };
        if (!ir.ok || !writeJSON("oros-invoices-data", ir.data)) return { ok: false };
        try { if (root.orosSync && typeof root.orosSync.markDirty === "function") root.orosSync.markDirty(); } catch (e3) {}
        if (writeJSON(CHG_KEY, chgMerge(l, [Object.assign({}, e, { done: Date.now() })]))) dirty();
        changed();
        return { ok: true, n: ir.n, kept: ir.kept };
      }
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
    // HELPER-1: "both" | "assistant" | "claude" (synced).
    helper: function () { return helperRead().v; },
    setHelper: function (v) {
      if (HELPERS.indexOf(v) < 0) return false;
      var cur = helperRead();
      if (!writeJSON(HELPER_KEY, { v: v, m: Math.max(Date.now(), cur.m + 1) })) return false;
      dirty();
      helperTell();
      helperApply();
      return true;
    },
    enable: function () {
      var p = pref();
      if (helperRead().v === "assistant") return helperOff();
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
      if (helperRead().v === "assistant") return helperOff();
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
      if (p.id && fcDrop()) fcDrop().remove(p.id).catch(function () {});   // F2: the closed copy's pieces
      try { localStorage.removeItem(FC_KEY); } catch (e) {}
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
    // GATE-HOST: this computer's background Gate (orOS Portable / USB)
    host: { state: function () { return hostState(); }, set: function (on) { return hostSet(on); }, active: function () { return HOST.ok; } },
    // LOCAL-1: a read or write through the local-folder bridge
    // (localroots.js): kind list|read|write, the local: path, bytes, the
    // command that asked
    localLog: function (e) {
      if (!isObj(e)) return;
      var kind = /^(list|read|write)$/.test(e.kind) ? e.kind : "read";
      writeJSON(LOG_KEY, pushLog(readJSON(LOG_KEY), { t: Date.now(), n: "local-" + kind, a: [], k: 1, ok: 1,
        lp: String(e.path || "").slice(0, 300), sz: Math.max(0, Math.floor(+e.size || 0)), c: String(e.cmd || "").slice(0, 40) }));
      changed();
    },
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
      nt.style.cssText = "margin:0 0 16px;line-height:1.45;opacity:.8;font-size:.92rem;white-space:pre-line;overflow-wrap:anywhere;max-height:40vh;overflow:auto";
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
    var note = helperRead().v === "assistant" ? tr("gate.ask.helper") : pref().on ? tr("gate.ask.on") : tr("gate.ask.off");
    var m = modal(tr("gate.ask.title"), tr("gate.ask.body"), note, tr("gate.ask.deny"), tr("gate.ask.allow"),
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
  // The Gate's own work (the queue): also on the host, over the lock.
  function whenOpen(fn) {
    if (locked()) { setTimeout(function () { whenOpen(fn); }, 800); return; }
    fn();
  }
  function whenUnlocked(fn) {
    var L = root.orosLock;
    if (L && typeof L.isLocked === "function" && L.isLocked()) { setTimeout(function () { whenUnlocked(fn); }, 800); return; }
    fn();
  }
  function start() {
    if (HOST.n && !HOST.bg) { hostCheck(); startOpen(); return; }   // a lock-rule window
    if (HOST.n) {
      hostCheck().then(function (ok) {
        if (!ok || HOST.kind !== "bg") return;
        if (!pref().on) return;                        // a computer without the Gate: nothing to do
        connect();
        chgSlice(0); digSlice(0); foldersSlice(0); seatSlice(0); helperSlice(0); helperApply();
        setTimeout(appFoldersMake, 12000);             // GATE-PL9
        setInterval(function () { copySoon(0); }, 30 * 60000);
        setInterval(function () { fileCopySoon(0); }, 30 * 60000);
        setInterval(function () { if (strictOn()) { hostSet(false); hostBye(); } }, 60000);
        // A window wants this profile (or the owner turned it off): stop
        // taking Claude's calls, give the browser time to write what changed,
        // then say bye; the launcher ends this browser.
        var yieldT = setInterval(function () {
          if (!HOST.ok) return;
          fetch("/__oros/gate-host?n=" + encodeURIComponent(HOST.n), { cache: "no-store", credentials: "same-origin" })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (h) { if (h && (h.yield || !h.host)) { clearInterval(yieldT); hostBye(); } }, function () {});
        }, 2000);
        clearInterval(digTimer);
        digTimer = setInterval(digCheck, 10 * 60000);
        setTimeout(function () { if (pref().on) makeSeat(); }, 3000);
        root.addEventListener("online", function () { api.reconnect(); });
      });
      return;
    }
    startOpen();
  }
  function startOpen() {
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
    helperSlice(0);
    helperApply();
    seatSlice(0);
    chgSlice(0);
    digSlice(0);
    foldersSlice(0);
    setInterval(function () { copySoon(0); }, 30 * 60000);
    setInterval(function () { fileCopySoon(0); }, 30 * 60000);
    // SY-AD (5.96.00): data Claude wrote before this version for an app
    // never opened on this device (Publishing, CRM…) reaches sync now.
    setTimeout(adoptWritten, 8000);
    setTimeout(appFoldersMake, 12000);               // GATE-PL9: the app folders exist on the disk
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
