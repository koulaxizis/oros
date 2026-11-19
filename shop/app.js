// ============================================================
// orOS Shop — the app inside the shell frame
// The person's own WooCommerce shops at a glance: today, money,
// products, partners' shares and consignments. Read only: nothing
// here changes the shop. Figures come through Connected services
// (window.parent.orosLinks, the shop's Read key typed on the device),
// on open and every 15 minutes while the app is on screen; the last
// read is kept (synced, encrypted) so the app opens offline too.
// Rules (shop/core.js header): aggregates only, no customer data.
// Boot order (OROS_BIBLE.md Part VI): load → applyI18n → wire →
// registerSync → inheritPalette → watchPalette → render → deep link
// → first read.
// ============================================================
(function () {
  "use strict";

  var SCRIPT_V = "";
  (function () {
    var m = (document.currentScript && document.currentScript.src || "").match(/[?&]v=([^&#]+)/);
    SCRIPT_V = m ? m[1] : "";
    console.log("shop/app.js v" + (SCRIPT_V || "?") + " boot");
  })();

  var APP_ID = "shop";
  var C = window.OrosShopCore;
  var STORAGE_KEY = C.KEY;
  var PREFS_KEY = "oros-shop-prefs";          // device-local: { acct, tab }
  var NOXPRESS = "https://noxpress.tech/";

  // ---------- 1. Language ----------
  var STR = {
    en: {
      "app.name": "Shop",
      "refresh": "Refresh",
      "shop.pick": "Shop",
      "tab.today": "Today",
      "tab.money": "Money",
      "tab.products": "Products",
      "tab.partners": "Partner shares",
      "tab.stores": "Consignments",
      "upd": "Updated {t}",
      "upd.never": "Not read yet",
      "reading": "Reading the shop…",
      "none.title": "Connect your shop",
      "none.text": "Shop shows the figures of your own WooCommerce shop: today's orders, this month and this year, best-selling products and stock. Add the shop with a Read key in Settings › Connected services.",
      "none.btn": "Open Connected services",
      "err.keys": "The shop's keys are not on this device. Type them in Settings › Connected services.",
      "err.auth": "The shop refused the key. Check that it is a Read key of a user who manages the shop.",
      "err.offline": "You are offline. These are the figures of the last read.",
      "err.notfound": "The shop's REST API was not found at this address.",
      "err.denied": "orOS refused this request.",
      "err.busy": "The shop is busy. orOS tries again later.",
      "err.other": "The shop could not be read just now. orOS tries again later.",
      "per.today": "Today",
      "per.month": "This month",
      "per.year": "This year",
      "k.orders": "Orders",
      "k.gross": "Sales",
      "k.net": "Net sales",
      "k.items": "Items",
      "k.aov": "Average order",
      "k.cust": "Customers",
      "k.own": "Your share",
      "k.refunds": "Refunds",
      "k.pending": "Waiting for payment",
      "k.cancelled": "Cancelled",
      "src.x": "paid orders (orOS Connect)",
      "src.base": "WooCommerce report",
      "st.title": "Stock",
      "st.low": "Running low ({n} or fewer): {c}",
      "st.out": "Out of stock: {c}",
      "st.none": "Nothing is running low.",
      "st.more": "and {n} more",
      "x.missing.title": "More with orOS Connect",
      "x.missing": "Profit and costs, partners' shares, consignments and stock come from the free orOS Connect plugin (version 1.4 or newer, module «Data for orOS») on your shop. Without it, Shop shows WooCommerce's own figures.",
      "x.link": "About orOS Connect",
      "x.auth": "orOS Connect is on the shop, but this key's user cannot read its data. The key needs a user who manages the shop.",
      "x.error": "orOS Connect did not answer just now; the other figures are WooCommerce's own.",
      "x.src": "Not on this shop: {list}",
      "area.sales": "sales figures",
      "area.titles": "sales per product",
      "area.stock": "stock",
      "area.splits": "partners' shares",
      "area.costs": "costs and result",
      "area.bookstores": "consignments",
      "m.result": "Costs and result",
      "m.range": "{a} – {b}",
      "m.rev": "Revenue",
      "m.costs": "Costs",
      "m.net": "Result",
      "m.units": "Units",
      "m.general": "General costs",
      "m.all": "Result after general costs",
      "m.owed": "Owed to partners",
      "m.shelf": "On consignment shelves",
      "m.storesOwed": "Owed by resellers",
      "m.perProduct": "Per product",
      "m.noCosts": "No costs are recorded for this period yet.",
      "p.filter": "Find a product",
      "p.name": "Product",
      "p.qty": "Sold",
      "p.sales": "Sales",
      "p.net": "Net",
      "p.orders": "Orders",
      "p.out": "out of stock",
      "p.back": "on backorder",
      "p.none": "No sales this year yet.",
      "p.base": "WooCommerce's best sellers of this year. With orOS Connect also sales and net per product.",
      "s.since": "Sales since {d}",
      "s.name": "Partner",
      "s.sales": "Sales",
      "s.inc": "Income",
      "s.ded": "Deductions",
      "s.pay": "Paid",
      "s.rem": "To pay",
      "c.name": "Reseller",
      "c.given": "Given",
      "c.sold": "Sold",
      "c.ret": "Returned",
      "c.open": "On shelf",
      "c.val": "Sold value",
      "c.owed": "Owed",
      "c.due": "Settle by {d}",
      "c.late": "overdue",
      "c.asOf": "As of {d}",
      "total": "Total",
      "full": "This device is out of storage space. The figures were not kept."
    },
    el: {
      "app.name": "Κατάστημα",
      "refresh": "Ανανέωση",
      "shop.pick": "Κατάστημα",
      "tab.today": "Σήμερα",
      "tab.money": "Χρήματα",
      "tab.products": "Προϊόντα",
      "tab.partners": "Μερίσματα",
      "tab.stores": "Παρακαταθήκες",
      "upd": "Ενημέρωση {t}",
      "upd.never": "Δεν έχει διαβαστεί ακόμα",
      "reading": "Διαβάζω το κατάστημα…",
      "none.title": "Σύνδεσε το κατάστημά σου",
      "none.text": "Το Κατάστημα δείχνει τα νούμερα του δικού σου καταστήματος WooCommerce: τις σημερινές παραγγελίες, τον μήνα και τη χρονιά, τα προϊόντα που πουλάνε και το απόθεμα. Πρόσθεσε το κατάστημα με κλειδί Read στις Ρυθμίσεις › Συνδεδεμένες υπηρεσίες.",
      "none.btn": "Άνοιγμα Συνδεδεμένων υπηρεσιών",
      "err.keys": "Τα κλειδιά του καταστήματος δεν είναι σε αυτή τη συσκευή. Γράψ' τα στις Ρυθμίσεις › Συνδεδεμένες υπηρεσίες.",
      "err.auth": "Το κατάστημα δεν δέχτηκε το κλειδί. Έλεγξε ότι είναι κλειδί Read χρήστη που διαχειρίζεται το κατάστημα.",
      "err.offline": "Δεν έχεις σύνδεση. Αυτά είναι τα νούμερα της τελευταίας ανάγνωσης.",
      "err.notfound": "Δεν βρέθηκε το REST API του καταστήματος σε αυτή τη διεύθυνση.",
      "err.denied": "Το orOS δεν επέτρεψε αυτό το αίτημα.",
      "err.busy": "Το κατάστημα είναι απασχολημένο. Το orOS θα ξαναδοκιμάσει αργότερα.",
      "err.other": "Το κατάστημα δεν διαβάστηκε αυτή τη στιγμή. Το orOS θα ξαναδοκιμάσει αργότερα.",
      "per.today": "Σήμερα",
      "per.month": "Αυτόν τον μήνα",
      "per.year": "Φέτος",
      "k.orders": "Παραγγελίες",
      "k.gross": "Πωλήσεις",
      "k.net": "Καθαρές πωλήσεις",
      "k.items": "Τεμάχια",
      "k.aov": "Μέση παραγγελία",
      "k.cust": "Πελάτες",
      "k.own": "Το μερίδιό σου",
      "k.refunds": "Επιστροφές χρημάτων",
      "k.pending": "Περιμένουν πληρωμή",
      "k.cancelled": "Ακυρωμένες",
      "src.x": "πληρωμένες παραγγελίες (orOS Connect)",
      "src.base": "αναφορά του WooCommerce",
      "st.title": "Απόθεμα",
      "st.low": "Λίγα κομμάτια ({n} ή λιγότερα): {c}",
      "st.out": "Εξαντλημένα: {c}",
      "st.none": "Δεν τελειώνει τίποτα.",
      "st.more": "και {n} ακόμα",
      "x.missing.title": "Περισσότερα με το orOS Connect",
      "x.missing": "Κόστη και αποτέλεσμα, μερίσματα συνεργατών, παρακαταθήκες και απόθεμα έρχονται από το δωρεάν plugin orOS Connect (έκδοση 1.4 ή νεότερη, ενότητα «Δεδομένα για orOS») στο κατάστημά σου. Χωρίς αυτό, το Κατάστημα δείχνει τα νούμερα του ίδιου του WooCommerce.",
      "x.link": "Για το orOS Connect",
      "x.auth": "Το orOS Connect υπάρχει στο κατάστημα, αλλά ο χρήστης αυτού του κλειδιού δεν μπορεί να διαβάσει τα δεδομένα του. Χρειάζεται κλειδί χρήστη που διαχειρίζεται το κατάστημα.",
      "x.error": "Το orOS Connect δεν απάντησε αυτή τη στιγμή· τα υπόλοιπα νούμερα είναι του ίδιου του WooCommerce.",
      "x.src": "Δεν υπάρχουν σε αυτό το κατάστημα: {list}",
      "area.sales": "νούμερα πωλήσεων",
      "area.titles": "πωλήσεις ανά προϊόν",
      "area.stock": "απόθεμα",
      "area.splits": "μερίσματα συνεργατών",
      "area.costs": "κόστη και αποτέλεσμα",
      "area.bookstores": "παρακαταθήκες",
      "m.result": "Κόστη και αποτέλεσμα",
      "m.range": "{a} – {b}",
      "m.rev": "Έσοδα",
      "m.costs": "Κόστη",
      "m.net": "Αποτέλεσμα",
      "m.units": "Τεμάχια",
      "m.general": "Γενικά έξοδα",
      "m.all": "Αποτέλεσμα μετά τα γενικά έξοδα",
      "m.owed": "Οφείλονται σε συνεργάτες",
      "m.shelf": "Στα ράφια των παρακαταθηκών",
      "m.storesOwed": "Οφείλουν τα σημεία πώλησης",
      "m.perProduct": "Ανά προϊόν",
      "m.noCosts": "Δεν έχουν καταγραφεί ακόμα κόστη για αυτή την περίοδο.",
      "p.filter": "Βρες προϊόν",
      "p.name": "Προϊόν",
      "p.qty": "Πουλήθηκαν",
      "p.sales": "Πωλήσεις",
      "p.net": "Καθαρά",
      "p.orders": "Παραγγελίες",
      "p.out": "εξαντλημένο",
      "p.back": "σε προπαραγγελία",
      "p.none": "Δεν υπάρχουν ακόμα πωλήσεις φέτος.",
      "p.base": "Τα προϊόντα που πούλησαν περισσότερο φέτος, κατά το WooCommerce. Με το orOS Connect και πωλήσεις και καθαρά ανά προϊόν.",
      "s.since": "Πωλήσεις από {d}",
      "s.name": "Συνεργάτης",
      "s.sales": "Πωλήσεις",
      "s.inc": "Έσοδα",
      "s.ded": "Κρατήσεις",
      "s.pay": "Πληρώθηκαν",
      "s.rem": "Προς πληρωμή",
      "c.name": "Σημείο πώλησης",
      "c.given": "Δόθηκαν",
      "c.sold": "Πουλήθηκαν",
      "c.ret": "Επιστράφηκαν",
      "c.open": "Στο ράφι",
      "c.val": "Αξία πωλήσεων",
      "c.owed": "Οφείλουν",
      "c.due": "Εκκαθάριση έως {d}",
      "c.late": "εκπρόθεσμη",
      "c.asOf": "Στις {d}",
      "total": "Σύνολο",
      "full": "Ο χώρος αποθήκευσης της συσκευής γέμισε. Τα νούμερα δεν κρατήθηκαν."
    }
  };

  var LANG = window.orosI18n ? window.orosI18n.lang() : (function () {
    try { return localStorage.getItem("oros-lang") === "el" ? "el" : "en"; } catch (e) { return "en"; }
  })();
  if (window.orosI18n) window.orosI18n.table(STR, "shop", LANG);
  function locale() { return window.orosI18n ? window.orosI18n.locale(LANG) : (LANG === "el" ? "el-GR" : "en-GB"); }
  function t(k, p) {
    var s = (STR[LANG] && STR[LANG][k] !== undefined) ? STR[LANG][k] : (STR.en[k] !== undefined ? STR.en[k] : k);
    Object.keys(p || {}).forEach(function (x) { s = s.split("{" + x + "}").join(String(p[x])); });
    return s;
  }
  function applyI18n() {
    document.documentElement.lang = LANG;
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) { n.textContent = t(n.getAttribute("data-i18n")); });
    [].forEach.call(document.querySelectorAll("[data-i18n-ph]"), function (n) { n.placeholder = t(n.getAttribute("data-i18n-ph")); });
    [].forEach.call(document.querySelectorAll("[data-i18n-aria]"), function (n) { n.setAttribute("aria-label", t(n.getAttribute("data-i18n-aria"))); });
    document.title = t("app.name") + " · orOS";
  }

  // numbers and money in the active language
  var NF = null, MF = {};
  function num(n) {
    try { if (!NF) NF = new Intl.NumberFormat(locale()); return NF.format(n); } catch (e) { return String(n); }
  }
  function money(c, cur) {
    var v = (Number(c) || 0) / 100;
    cur = cur || "";
    try {
      if (!MF[cur]) MF[cur] = cur ? new Intl.NumberFormat(locale(), { style: "currency", currency: cur }) : new Intl.NumberFormat(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return MF[cur].format(v);
    } catch (e) { return v.toFixed(2); }
  }
  function dayText(ymd) {
    if (!ymd) return "";
    var p = ymd.split("-");
    return LANG === "en" || LANG === "el" ? p[2] + "/" + p[1] + "/" + p[0] : new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString(locale());
  }
  function timeText(ms) {
    var d = new Date(ms), now = new Date();
    var hm = ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
    return C.dayOf(d) === C.dayOf(now) ? hm : dayText(C.dayOf(d)) + " " + hm;
  }

  // ---------- 2. Data: local first, then sync ----------
  var data = C.empty();
  var prefs = { acct: "", tab: "today" };

  function syncApi() {
    try { return (window.parent && window.parent.orosSync) || null; } catch (e) { return null; }
  }
  function links() {
    try { var p = window.parent; return p && p !== window && p.orosLinks && typeof p.orosLinks.call === "function" ? p.orosLinks : null; }
    catch (e) { return null; }
  }
  function load() {
    try { data = C.normalize(JSON.parse(localStorage.getItem(STORAGE_KEY) || "null")); } catch (e) { data = C.empty(); }
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (p && typeof p === "object") {
        if (typeof p.acct === "string") prefs.acct = p.acct.slice(0, 64);
        if (typeof p.tab === "string") prefs.tab = p.tab.slice(0, 20);
      }
    } catch (e) { /* defaults */ }
  }
  function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) { /* convenience only */ } }
  function persist() {
    try { localStorage.setItem(STORAGE_KEY, C.serialize(data)); return true; }
    catch (e) { toast(t("full")); return false; }
  }
  // a new read from this device: kept, then sync is told
  function keep(next) {
    var before = C.serialize(data);
    data = next;
    if (C.serialize(data) === before) return;
    if (!persist()) return;
    var api = syncApi();
    if (api && typeof api.markDirty === "function") api.markDirty();
  }
  function sliceGet() { return C.normalize(data); }
  function sliceSet(incoming) {
    var merged = C.merge(data, incoming);
    if (C.serialize(merged) === C.serialize(data)) return;
    data = merged;
    persist();              // R6: no markDirty for what sync brought
    render();
  }
  function registerSync() {
    var api = syncApi();
    if (!api || typeof api.registerSlice !== "function") return;
    try { api.registerSlice(APP_ID, sliceGet, sliceSet, STORAGE_KEY, C.merge); } catch (e) { /* the next boot registers again */ }
  }

  // ---------- 3. Palette (G3) ----------
  var PAL_VARS = ["--bg", "--text", "--text-dim", "--accent", "--accent-hover",
                  "--accent-soft", "--accent-ink", "--panel-bg", "--border", "--danger"];
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

  // ---------- 4. Reading the shops ----------
  var busy = {}, fail = {};             // account id → true / last error code (this session)
  function shops() {
    var L = links();
    if (!L) return [];
    try { return (L.list("woo") || []).filter(function (a) { return a && a.id && a.d !== 1; }); } catch (e) { return []; }
  }
  function current(list) {
    list = list || shops();
    for (var i = 0; i < list.length; i++) if (list[i].id === prefs.acct) return list[i];
    return list[0] || null;
  }
  function shopName(a) { return a ? (a.name || a.site || "").replace(/^https?:\/\//, "") : ""; }

  function read(acct, fresh) {
    var L = links();
    if (!L || !acct || busy[acct.id]) return Promise.resolve();
    busy[acct.id] = true;
    render();
    var today = C.dayOf(new Date());
    return Promise.resolve(L.call(acct.id, C.reqs(today, fresh))).then(function (res) {
      var e = C.fromAnswers(acct.id, res, Date.now(), today, L.statusCode);
      if (e.fail) { fail[acct.id] = e.fail; return; }
      delete fail[acct.id];
      keep(C.put(data, e));
    }, function (err) {
      fail[acct.id] = (err && err.code) || "other";
    }).then(function () {
      delete busy[acct.id];
      render();
    });
  }
  // every shop whose last read is older than 15 minutes, while on screen
  function readDue() {
    if (document.visibilityState === "hidden") return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    var now = Date.now();
    shops().forEach(function (a) {
      if (C.stale(data.shops[a.id], now) && !(fail[a.id] && failAt[a.id] && now - failAt[a.id] < C.PULL_MS)) {
        failAt[a.id] = now;
        read(a, false);
      }
    });
  }
  var failAt = {};

  // ---------- 5. Screen ----------
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  var toastTimer = 0;
  function toast(msg) {
    var box = $("toast");
    box.textContent = msg;
    box.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.classList.remove("show"); }, 3000);
  }
  function openAt(app, target) {
    try { var p = window.parent; if (p && p !== window && typeof p.__orosOpenAt === "function") p.__orosOpenAt(app, target); } catch (e) { /* standalone */ }
  }

  var filter = { products: "", partners: "", stores: "" };

  function tile(box, label, value, sub, cls) {
    var d = el("div", "tile" + (cls ? " " + cls : ""));
    d.appendChild(el("div", "tl", label));
    d.appendChild(el("div", "tv", value));
    if (sub) d.appendChild(el("div", "ts", sub));
    box.appendChild(d);
    return d;
  }
  function section(parent, title) {
    var s = el("section", "sec");
    if (title) s.appendChild(el("h2", "", title));
    parent.appendChild(s);
    return s;
  }
  function note(parent, text, cls) { var p = el("p", "note" + (cls ? " " + cls : ""), text); parent.appendChild(p); return p; }
  // a table: cols = [{ k, label, num }], rows = arrays of cells (text)
  function table(parent, cols, rows, foot) {
    var wrap = el("div", "tw"), tb = el("table");
    var th = el("thead"), tr = el("tr");
    cols.forEach(function (c) { var h = el("th", c.num ? "n" : "", c.label); h.scope = "col"; tr.appendChild(h); });
    th.appendChild(tr); tb.appendChild(th);
    var body = el("tbody");
    rows.forEach(function (r) {
      var row = el("tr");
      r.forEach(function (cell, i) {
        var td = el("td", cols[i].num ? "n" : "");
        if (cell && typeof cell === "object" && cell.nodeType) td.appendChild(cell);
        else td.textContent = cell;
        row.appendChild(td);
      });
      body.appendChild(row);
    });
    tb.appendChild(body);
    if (foot) {
      var tf = el("tfoot"), fr = el("tr");
      foot.forEach(function (cell, i) { fr.appendChild(el("td", cols[i].num ? "n" : "", cell)); });
      tf.appendChild(fr); tb.appendChild(tf);
    }
    wrap.appendChild(tb);
    parent.appendChild(wrap);
  }
  function filterBox(parent, key, ph) {
    var inp = el("input", "filter");
    inp.type = "search";
    inp.placeholder = ph;
    inp.setAttribute("aria-label", ph);
    inp.value = filter[key];
    inp.addEventListener("input", function () {
      filter[key] = inp.value;
      var pos = inp.selectionStart;
      render();
      var again = document.querySelector("input.filter");
      if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch (e) { /* type=search */ } }
    });
    parent.appendChild(inp);
  }
  function matches(q, text) {
    var w = C.fold(q).split(/\s+/).filter(Boolean), f = C.fold(text);
    return w.every(function (x) { return f.indexOf(x) >= 0; });
  }

  function extrasNote(parent, e) {
    if (!e) return;
    if (e.xs === "missing") {
      var s = section(parent, t("x.missing.title"));
      s.classList.add("hintbox");
      note(s, t("x.missing"));
      var a = el("a", "link", t("x.link"));
      a.href = NOXPRESS;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      s.appendChild(a);
      return;
    }
    if (e.xs === "auth") { note(parent, t("x.auth"), "warn"); return; }
    if (e.xs === "error") { note(parent, t("x.error"), "warn"); return; }
    var miss = e.x ? Object.keys(e.x.err).filter(function (k) { return e.x.err[k] === "source_missing"; }) : [];
    if (miss.length) note(parent, t("x.src", { list: miss.map(function (k) { return t("area." + k); }).join(", ") }), "dim");
  }

  function vToday(main, e) {
    var cur = e.cur, kp = el("div", "tiles");
    ["today", "month", "year"].forEach(function (k) {
      var p = C.period(e, k);
      if (!p) return;
      var sub = t("k.orders") + ": " + num(p.o) + (p.aov ? " · " + t("k.aov") + " " + money(p.aov, cur) : "");
      tile(kp, t("per." + k), money(p.g, cur), sub, k === "today" ? "big" : "");
    });
    main.appendChild(kp);
    var td = C.period(e, "today");
    if (td && td.src === "x") {
      var line = [];
      if (td.pe) line.push(t("k.pending") + ": " + num(td.pe));
      if (td.ca) line.push(t("k.cancelled") + ": " + num(td.ca));
      if (td.rf) line.push(t("k.refunds") + ": " + num(td.rf) + " · " + money(td.ra, cur));
      if (line.length) note(main, line.join(" · "), "dim");
    }
    var src = C.period(e, "year");
    if (src) note(main, src.src === "x" ? t("src.x") : t("src.base"), "dim small");

    var st = e.x && e.x.stock;
    if (st) {
      var s = section(main, t("st.title"));
      if (!st.lc && !st.oc) note(s, t("st.none"));
      function list(label, items, count) {
        if (!count) return;
        s.appendChild(el("h3", "", label));
        var ul = el("ul", "plain");
        items.slice(0, 12).forEach(function (i) { ul.appendChild(el("li", "", i.n + (i.s > 0 ? " · " + num(i.s) : ""))); });
        if (count > 12) ul.appendChild(el("li", "dim", t("st.more", { n: num(count - Math.min(12, items.length)) })));
        s.appendChild(ul);
      }
      list(t("st.out", { c: num(st.oc) }), st.out, st.oc);
      list(t("st.low", { n: num(st.th), c: num(st.lc) }), st.low, st.lc);
    }
    extrasNote(main, e);
  }

  function vMoney(main, e) {
    var cur = e.cur, kp = el("div", "tiles");
    ["month", "year"].forEach(function (k) {
      var p = C.period(e, k);
      if (!p) return;
      var d = tile(kp, t("per." + k), money(p.g, cur), t("k.orders") + ": " + num(p.o));
      if (p.own !== undefined) d.appendChild(el("div", "ts", t("k.own") + ": " + money(p.own, cur)));
      else if (p.n !== undefined) d.appendChild(el("div", "ts", t("k.net") + ": " + money(p.n, cur)));
    });
    var pt = C.partners(e), owed = pt.reduce(function (s, r) { return s + (r.rem > 0 ? r.rem : 0); }, 0);
    if (pt.length) tile(kp, t("m.owed"), money(owed, cur), "", "warnv");
    var sr = C.stores(e);
    if (sr.length) {
      tile(kp, t("m.storesOwed"), money(sr.reduce(function (s, r) { return s + r.owed; }, 0), cur),
        t("m.shelf") + ": " + num(sr.reduce(function (s, r) { return s + r.open; }, 0)));
    }
    main.appendChild(kp);

    var c = e.x && e.x.costs;
    if (c) {
      var ccur = c.cur || cur;
      var s = section(main, t("m.result"));
      if (c.from && c.to) note(s, t("m.range", { a: dayText(c.from), b: dayText(c.to) }), "dim small");
      var kc = el("div", "tiles");
      tile(kc, t("m.rev"), money(c.rev, ccur), t("m.units") + ": " + num(c.u));
      tile(kc, t("m.costs"), money(c.ct, ccur));
      tile(kc, t("m.net"), money(c.nt, ccur), "", c.nt < 0 ? "neg" : "pos");
      if (c.gen) tile(kc, t("m.all"), money(c.all, ccur), t("m.general") + ": " + money(c.gen, ccur), c.all < 0 ? "neg" : "pos");
      s.appendChild(kc);
      if (!c.rows.length) note(s, t("m.noCosts"));
      else {
        s.appendChild(el("h3", "", t("m.perProduct")));
        var rows = c.rows.slice().sort(function (a, b) { return Math.abs(b.nt) - Math.abs(a.nt) || (a.n < b.n ? -1 : 1); }).slice(0, 100);
        table(s, [{ label: t("p.name") }, { label: t("m.units"), num: 1 }, { label: t("m.rev"), num: 1 }, { label: t("m.costs"), num: 1 }, { label: t("m.net"), num: 1 }],
          rows.map(function (r) { return [r.n, num(r.u), money(r.rev, ccur), money(r.ct, ccur), money(r.nt, ccur)]; }),
          [t("total"), num(c.u), money(c.rev, ccur), money(c.ct, ccur), money(c.nt, ccur)]);
      }
    }
    extrasNote(main, e);
  }

  function vProducts(main, e) {
    var cur = e.cur, all = C.products(e), xt = !!(e.x && e.x.titles);
    filterBox(main, "products", t("p.filter"));
    var rows = all.filter(function (r) { return !filter.products || matches(filter.products, r.n); });
    if (!all.length) { note(main, t("p.none")); extrasNote(main, e); return; }
    if (!xt) {
      note(main, t("p.base"), "dim small");
      table(main, [{ label: t("p.name") }, { label: t("p.qty"), num: 1 }], rows.map(function (r) { return [r.n, num(r.q)]; }));
    } else {
      var T = e.x.titles;
      table(main, [{ label: t("p.name") }, { label: t("p.qty"), num: 1 }, { label: t("p.sales"), num: 1 }, { label: t("p.net"), num: 1 }, { label: t("p.orders"), num: 1 }],
        rows.map(function (r) {
          var n = el("span", "", r.n);
          if (r.st) { var b = el("span", "badge", r.st === "out" ? t("p.out") : t("p.back")); n.appendChild(document.createTextNode(" ")); n.appendChild(b); }
          return [n, num(r.q), money(r.s, cur), money(r.nt, cur), num(r.o)];
        }),
        filter.products ? null : [t("total"), num(T.q), money(T.s, cur), money(T.nt, cur), num(T.o)]);
    }
    extrasNote(main, e);
  }

  function vPartners(main, e) {
    var cur = e.cur, S = e.x && e.x.splits, all = C.partners(e);
    if (S && S.since) note(main, t("s.since", { d: dayText(S.since) }), "dim small");
    filterBox(main, "partners", t("p.filter"));
    var rows = all.filter(function (r) { return !filter.partners || matches(filter.partners, r.n); });
    var sum = function (k) { return rows.reduce(function (s, r) { return s + r[k]; }, 0); };
    table(main, [{ label: t("s.name") }, { label: t("s.sales"), num: 1 }, { label: t("s.inc"), num: 1 }, { label: t("s.ded"), num: 1 }, { label: t("s.pay"), num: 1 }, { label: t("s.rem"), num: 1 }],
      rows.map(function (r) { return [r.n, money(r.s, cur), money(r.inc, cur), money(r.ded, cur), money(r.pay, cur), money(r.rem, cur)]; }),
      [t("total"), money(sum("s"), cur), money(sum("inc"), cur), money(sum("ded"), cur), money(sum("pay"), cur), money(sum("rem"), cur)]);
  }

  function vStores(main, e) {
    var cur = e.cur, X = e.x && e.x.stores, all = C.stores(e);
    if (X && X.asOf) note(main, t("c.asOf", { d: dayText(X.asOf) }), "dim small");
    filterBox(main, "stores", t("p.filter"));
    var rows = all.filter(function (r) { return !filter.stores || matches(filter.stores, r.n + " " + r.city); });
    var sum = function (k) { return rows.reduce(function (s, r) { return s + r[k]; }, 0); };
    table(main, [{ label: t("c.name") }, { label: t("c.given"), num: 1 }, { label: t("c.sold"), num: 1 }, { label: t("c.ret"), num: 1 }, { label: t("c.open"), num: 1 }, { label: t("c.val"), num: 1 }, { label: t("c.owed"), num: 1 }],
      rows.map(function (r) {
        var n = el("span", "", r.n + (r.city ? " · " + r.city : ""));
        if (r.od) { n.appendChild(document.createTextNode(" ")); n.appendChild(el("span", "badge late", t("c.late"))); }
        else if (r.due) n.appendChild(el("div", "ts", t("c.due", { d: dayText(r.due) })));
        return [n, num(r.given), num(r.sold), num(r.ret), num(r.open), money(r.val, cur), money(r.owed, cur)];
      }),
      [t("total"), num(sum("given")), num(sum("sold")), num(sum("ret")), num(sum("open")), money(sum("val"), cur), money(sum("owed"), cur)]);
  }

  var VIEWS = { today: vToday, money: vMoney, products: vProducts, partners: vPartners, stores: vStores };

  function render() {
    var list = shops(), acct = current(list), main = $("main"), tabsBox = $("tabs"), pick = $("shop-pick");
    main.textContent = "";
    tabsBox.textContent = "";
    // the shop picker (more than one shop)
    pick.textContent = "";
    pick.hidden = list.length < 2;
    list.forEach(function (a) { var o = el("option", "", shopName(a)); o.value = a.id; pick.appendChild(o); });
    if (acct) pick.value = acct.id;
    $("refresh").hidden = !acct;
    if (!acct) {
      $("status").textContent = "";
      var s = section(main, t("none.title"));
      s.classList.add("hintbox");
      note(s, t("none.text"));
      var b = el("button", "chip pri", t("none.btn"));
      b.type = "button";
      b.addEventListener("click", function () { openAt("settings", "services"); });
      s.appendChild(b);
      return;
    }
    var e = data.shops[acct.id] || null;
    $("refresh").disabled = !!busy[acct.id];
    $("status").textContent = busy[acct.id] ? t("reading") : e ? t("upd", { t: timeText(e.m) }) : t("upd.never");
    var f = fail[acct.id];
    if (f) note(main, t("err." + (["keys", "auth", "offline", "notfound", "denied", "busy"].indexOf(f) >= 0 ? f : "other")), "warn");
    if (!e) return;
    var tabs = C.tabs(e);
    if (tabs.indexOf(prefs.tab) < 0) prefs.tab = "today";
    tabs.forEach(function (k) {
      var b = el("button", "tab" + (k === prefs.tab ? " on" : ""), t("tab." + k));
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", k === prefs.tab ? "true" : "false");
      b.addEventListener("click", function () { prefs.tab = k; savePrefs(); render(); });
      tabsBox.appendChild(b);
    });
    VIEWS[prefs.tab](main, e);
  }

  function wire() {
    $("refresh").addEventListener("click", function () { var a = current(); if (a) { delete fail[a.id]; read(a, true); } });
    $("shop-pick").addEventListener("change", function () {
      prefs.acct = $("shop-pick").value; savePrefs(); render();
      var a = current(); if (a && C.stale(data.shops[a.id], Date.now())) read(a, false);
    });
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") readDue(); });
    window.addEventListener("online", readDue);
    setInterval(readDue, 60000);
    var L = links();
    if (L && typeof L.onChange === "function") { try { L.onChange(function () { render(); readDue(); }); } catch (e) { /* older shell */ } }
  }

  // ---------- 6. Deep link: search hits, Today and other apps ----------
  // target = { view: "today"|"money"|"products"|"partners"|"stores", q?, shop? }
  window.__orosOpenAt = function (target) {
    if (!target || typeof target !== "object") return;
    if (typeof target.shop === "string") prefs.acct = target.shop.slice(0, 64);
    if (typeof target.view === "string" && VIEWS[target.view]) prefs.tab = target.view;
    if (typeof target.q === "string" && filter[prefs.tab] !== undefined) filter[prefs.tab] = target.q.slice(0, 120);
    savePrefs();
    render();
  };
  function takePending() {
    try {
      var p = window.parent;
      if (p && p !== window && typeof p.__orosTakeTarget === "function") {
        var pending = p.__orosTakeTarget(APP_ID);
        if (pending) window.__orosOpenAt(pending);
      }
    } catch (e) { /* standalone */ }
  }

  // ---------- 7. Boot ----------
  function boot() {
    load();
    applyI18n();
    wire();
    registerSync();
    inheritPalette();
    watchPalette();
    render();
    takePending();
    readDue();
  }
  boot();
})();
