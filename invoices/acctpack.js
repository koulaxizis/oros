// ============================================================
// orOS Invoices — the month's pack for the accountant
// (invoices/acctpack.js, v1.0.0, publisher wave P11)
// One button on the Dashboard: pick a month and what goes in, and
// one ZIP is made in Files (Invoices/Accountant) with
//   summary.txt          what is inside and the month's totals
//   documents.csv        this app's documents (not drafts), as the
//                        Dashboard's own CSV export
//   payments.csv         payments received
//   pdf/…                a PDF of every document issued here
//   budget.csv           Budget's income and expenses of the month
//   receipts/…           the receipt files those entries carry
//   stock.csv            Stock's purchases, returns and sales (money
//                        movements only; counts and transfers are not)
//   shop-orders.csv      the connected WooCommerce shop's orders of
//                        the month, read live (nothing is stored)
// then Mail opens a message to the accountant with the ZIP attached
// and the summary as text (sent only by you, from Mail). Each part
// is there only when its app has data on this device. Nothing is
// sent anywhere without your click; the accountant's address stays on
// this device (prefs).
//
// Pure part (Node tests, window.OrosAcctPack):
//   months(today, n) → ["YYYY-MM"…] this month first, n months back
//   monthRange(mk) → [from, to]
//   budgetRows(bud, mk, catName) → [{ d, k, cat, a, n, rc: [names] }]
//   stockRows(stock, from, to) → [{ d, t, ref, sup, sku, name, q, u, tot }]
//   orderRows(orders, from, to) → normalized orders (links/woo.js
//     normOrder) of the month, oldest first
//   csv(rows) · money(c, lang) · totals(parts) → for summary.txt
// The UI (open(api)) is the browser part below.
// ============================================================
(function (root) {
  "use strict";

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function months(today, n) {
    var y = +today.slice(0, 4), m = +today.slice(5, 7), out = [];
    for (var i = 0; i < (n || 12); i++) {
      out.push(y + "-" + pad(m));
      m--;
      if (!m) { m = 12; y--; }
    }
    return out;
  }
  function monthRange(mk) {
    var y = +mk.slice(0, 4), m = +mk.slice(5, 7);
    var last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return [mk + "-01", mk + "-" + pad(last)];
  }
  function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

  // Budget's synced data (oros-budget-data): tx { id, d, k "i"|"o", a
  // cents, c category id, n note, rc "file names" }; tombstoned and
  // malformed rows were already dropped by Budget.
  function budgetRows(bud, mk, catName) {
    var tombs = (bud && bud.tombs) || {};
    return ((bud && Array.isArray(bud.tx)) ? bud.tx : []).filter(function (x) {
      return x && typeof x.d === "string" && x.d.slice(0, 7) === mk && (x.k === "i" || x.k === "o") &&
             typeof x.a === "number" && isFinite(x.a) && !(tombs[x.id] >= x.m);
    }).map(function (x) {
      return { d: x.d, k: x.k, cat: catName ? catName(x.c || "") : (x.c || ""), a: Math.round(x.a), n: typeof x.n === "string" ? x.n : "",
               rc: typeof x.rc === "string" ? x.rc.split(" ").filter(function (s) { return /^[A-Za-z0-9._-]{1,120}$/.test(s); }) : [] };
    }).sort(function (a, b) { return cmp(a.d, b.d) || cmp(a.n, b.n); });
  }

  // Stock's synced data (oros-stock-data): money movements of the
  // period. in / rts at the line's unit cost c, out / ret at the unit
  // price p (cents); q in thousandths. Voided ones out.
  var STOCK_T = { "in": 1, rts: 1, out: 1, ret: 1 };
  function stockRows(stock, from, to) {
    var items = {}, sups = {};
    ((stock && stock.items) || []).forEach(function (x) { items[x.id] = x; });
    ((stock && stock.sups) || []).forEach(function (x) { sups[x.id] = x.name; });
    var rows = [];
    ((stock && stock.moves) || []).forEach(function (x) {
      if (!x || x.v === 1 || !STOCK_T[x.t] || !(x.d >= from && x.d <= to) || !Array.isArray(x.lines)) return;
      x.lines.forEach(function (l) {
        var it = items[l.i] || { sku: "", name: "?" };
        var u = x.t === "in" || x.t === "rts" ? l.c : l.p;
        u = typeof u === "number" && isFinite(u) ? u : 0;
        var q = Math.abs(l.q || 0) / 1000;
        rows.push({ d: x.d, t: x.t, ref: x.ref || "", sup: sups[x.sup] || "", sku: it.sku || "", name: it.name || "?", q: q, u: u, tot: Math.round(q * u) });
      });
    });
    return rows.sort(function (a, b) { return cmp(a.d, b.d) || cmp(a.t, b.t) || cmp(a.name, b.name); });
  }

  function orderRows(orders, from, to) {
    return (orders || []).filter(function (o) { return o && o.d >= from && o.d <= to; })
      .sort(function (a, b) { return cmp(a.d, b.d) || a.id - b.id; });
  }

  // ";" separated, BOM, CRLF, formula-safe (same as the Invoices CSV)
  function cell(v) {
    var s = String(v === null || v === undefined ? "" : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[";\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function csv(rows) { return "﻿" + rows.map(function (r) { return r.map(cell).join(";"); }).join("\r\n") + "\r\n"; }
  function money(c, lang) {
    var s = (Math.abs(c) / 100).toFixed(2);
    if (lang && lang !== "en") s = s.replace(".", ",");
    return (c < 0 ? "-" : "") + s;
  }
  function qty(q, lang) {
    var s = String(Math.round(q * 1000) / 1000);
    return lang && lang !== "en" ? s.replace(".", ",") : s;
  }

  // The month's sums: budget in / out, stock purchases (in − rts) and
  // sales (out − ret), shop orders that count (not cancelled, failed,
  // pending or refunded) and their tax.
  var ORDER_COUNTS = { processing: 1, completed: 1, "on-hold": 1 };
  function totals(p) {
    var t = { bin: 0, bout: 0, buy: 0, sell: 0, ord: 0, ordN: 0, ordTax: 0 };
    (p.budget || []).forEach(function (r) { if (r.k === "i") t.bin += r.a; else t.bout += r.a; });
    (p.stock || []).forEach(function (r) {
      if (r.t === "in") t.buy += r.tot; else if (r.t === "rts") t.buy -= r.tot;
      else if (r.t === "out") t.sell += r.tot; else if (r.t === "ret") t.sell -= r.tot;
    });
    (p.orders || []).forEach(function (o) { if (ORDER_COUNTS[o.st]) { t.ord += o.total; t.ordTax += o.tax; t.ordN++; } });
    return t;
  }

  var API = { months: months, monthRange: monthRange, budgetRows: budgetRows, stockRows: stockRows, orderRows: orderRows,
              csv: csv, money: money, qty: qty, totals: totals };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }
  root.OrosAcctPack = API;

  // ---------- Browser: the dialog ----------
  var STR = {
    en: {
      "ap.btn": "Pack for the accountant…", "ap.title": "The month for your accountant",
      "ap.hint": "One ZIP with the month's documents, PDFs, payments and, from the other apps on this device, Budget entries with their receipts, Stock purchases and sales and your shop's orders. It is saved in Files › Invoices/Accountant; then Mail opens a message to your accountant with it attached. Nothing is sent until you send it.",
      "ap.month": "Month", "ap.email": "Accountant's e-mail (kept on this device)",
      "ap.docs": "Documents ({n}) and their CSV", "ap.pdf": "A PDF of each document issued here ({n})", "ap.pays": "Payments received ({n})",
      "ap.budget": "Budget: income and expenses ({n}, {r} receipts)", "ap.stock": "Stock: purchases and sales ({n} lines)",
      "ap.shop": "Shop orders (WooCommerce {s}, read now)",
      "ap.make": "Make the pack", "ap.busy": "Making the pack… {s}", "ap.close": "Close",
      "ap.none": "Nothing to put in the pack for this month.", "ap.badMail": "Check the e-mail address.",
      "ap.done": "Saved in Files: {f} ({z}).", "ap.mail": "E-mail to the accountant", "ap.files": "Open in Files", "ap.save": "Save a copy",
      "ap.big": "The pack is over {m}, too big for one e-mail: send it another way (Files, Drive).",
      "ap.noFs": "Files is not available, so the pack could not be saved.", "ap.fail": "The pack could not be made.",
      "ap.shopFail": "The shop's orders could not be read ({e}); the pack is made without them.",
      "ap.pdfFail": "{n} PDFs could not be made.",
      "ap.subject": "{who}: {m}", "ap.hi": "Hello,", "ap.body": "Attached is {m}: {f}.", "ap.bye": "Thank you.",
      "ap.s.head": "{who}: {m}", "ap.s.made": "Made with orOS on {d}.",
      "ap.s.docs": "Documents: {n} · net {net} · VAT {vat} · total {tot} ({cur})", "ap.s.docsMulti": "Documents: {n} in {c} currencies (see documents.csv)",
      "ap.s.pays": "Payments received: {n} · {tot}", "ap.s.budget": "Budget: income {i} · expenses {o} · {r} receipts",
      "ap.s.stock": "Stock: purchases {b} · sales at sale price {s}", "ap.s.shop": "Shop orders: {n} that count · {tot} · of which tax {tax}",
      "ap.s.files": "Files",
      "ap.c.date": "Date", "ap.c.type": "Type", "ap.c.ref": "Reference", "ap.c.sup": "Supplier", "ap.c.sku": "Code", "ap.c.name": "Product",
      "ap.c.qty": "Quantity", "ap.c.unit": "Unit amount", "ap.c.total": "Total", "ap.c.cat": "Category", "ap.c.amt": "Amount", "ap.c.note": "Note", "ap.c.rc": "Receipts",
      "ap.c.no": "Order", "ap.c.status": "Status", "ap.c.cust": "Customer", "ap.c.tax": "Tax", "ap.c.ship": "Shipping", "ap.c.pay": "Payment", "ap.c.cur": "Currency",
      "ap.k.i": "Income", "ap.k.o": "Expense",
      "ap.t.in": "Purchase", "ap.t.rts": "Return to supplier", "ap.t.out": "Sale", "ap.t.ret": "Customer return",
      "ap.o.pending": "Pending payment", "ap.o.processing": "Processing", "ap.o.on-hold": "On hold", "ap.o.completed": "Completed",
      "ap.o.cancelled": "Cancelled", "ap.o.refunded": "Refunded", "ap.o.failed": "Failed"
    },
    el: {
      "ap.btn": "Πακέτο για τον λογιστή…", "ap.title": "Ο μήνας για τον λογιστή σου",
      "ap.hint": "Ένα ZIP με τα παραστατικά του μήνα, τα PDF, τις πληρωμές και, από τις άλλες εφαρμογές αυτής της συσκευής, τις κινήσεις των Εσόδων & Εξόδων με τις αποδείξεις τους, τις αγορές και πωλήσεις του Αποθέματος και τις παραγγελίες του καταστήματός σου. Αποθηκεύεται στα Αρχεία › Invoices/Accountant· μετά ανοίγει το Mail με μήνυμα προς τον λογιστή σου και το συνημμένο. Τίποτα δεν στέλνεται πριν το στείλεις εσύ.",
      "ap.month": "Μήνας", "ap.email": "E-mail λογιστή (μένει σε αυτή τη συσκευή)",
      "ap.docs": "Παραστατικά ({n}) και το CSV τους", "ap.pdf": "PDF για κάθε παραστατικό που εκδόθηκε εδώ ({n})", "ap.pays": "Πληρωμές που εισπράχθηκαν ({n})",
      "ap.budget": "Έσοδα & Έξοδα: κινήσεις ({n}, {r} αποδείξεις)", "ap.stock": "Απόθεμα: αγορές και πωλήσεις ({n} γραμμές)",
      "ap.shop": "Παραγγελίες καταστήματος (WooCommerce {s}, διαβάζονται τώρα)",
      "ap.make": "Φτιάξε το πακέτο", "ap.busy": "Φτιάχνεται το πακέτο… {s}", "ap.close": "Κλείσιμο",
      "ap.none": "Δεν υπάρχει τίποτα για το πακέτο αυτού του μήνα.", "ap.badMail": "Έλεγξε τη διεύθυνση e-mail.",
      "ap.done": "Αποθηκεύτηκε στα Αρχεία: {f} ({z}).", "ap.mail": "E-mail στον λογιστή", "ap.files": "Άνοιγμα στα Αρχεία", "ap.save": "Αποθήκευση αντιγράφου",
      "ap.big": "Το πακέτο ξεπερνά τα {m}, είναι μεγάλο για ένα e-mail: στείλ' το αλλιώς (Αρχεία, Drive).",
      "ap.noFs": "Τα Αρχεία δεν είναι διαθέσιμα, οπότε το πακέτο δεν αποθηκεύτηκε.", "ap.fail": "Το πακέτο δεν φτιάχτηκε.",
      "ap.shopFail": "Οι παραγγελίες του καταστήματος δεν διαβάστηκαν ({e})· το πακέτο φτιάχνεται χωρίς αυτές.",
      "ap.pdfFail": "{n} PDF δεν φτιάχτηκαν.",
      "ap.subject": "{who}: {m}", "ap.hi": "Καλησπέρα σας,", "ap.body": "Σας επισυνάπτω {m}: {f}.", "ap.bye": "Ευχαριστώ.",
      "ap.s.head": "{who}: {m}", "ap.s.made": "Φτιάχτηκε με το orOS στις {d}.",
      "ap.s.docs": "Παραστατικά: {n} · καθαρή αξία {net} · ΦΠΑ {vat} · σύνολο {tot} ({cur})", "ap.s.docsMulti": "Παραστατικά: {n} σε {c} νομίσματα (δες το documents.csv)",
      "ap.s.pays": "Πληρωμές που εισπράχθηκαν: {n} · {tot}", "ap.s.budget": "Έσοδα & Έξοδα: έσοδα {i} · έξοδα {o} · {r} αποδείξεις",
      "ap.s.stock": "Απόθεμα: αγορές {b} · πωλήσεις σε τιμή πώλησης {s}", "ap.s.shop": "Παραγγελίες καταστήματος: {n} που μετράνε · {tot} · από αυτά φόρος {tax}",
      "ap.s.files": "Αρχεία",
      "ap.c.date": "Ημερομηνία", "ap.c.type": "Είδος", "ap.c.ref": "Αναφορά", "ap.c.sup": "Προμηθευτής", "ap.c.sku": "Κωδικός", "ap.c.name": "Προϊόν",
      "ap.c.qty": "Ποσότητα", "ap.c.unit": "Ποσό μονάδας", "ap.c.total": "Σύνολο", "ap.c.cat": "Κατηγορία", "ap.c.amt": "Ποσό", "ap.c.note": "Σημείωση", "ap.c.rc": "Αποδείξεις",
      "ap.c.no": "Παραγγελία", "ap.c.status": "Κατάσταση", "ap.c.cust": "Πελάτης", "ap.c.tax": "Φόρος", "ap.c.ship": "Μεταφορικά", "ap.c.pay": "Πληρωμή", "ap.c.cur": "Νόμισμα",
      "ap.k.i": "Έσοδο", "ap.k.o": "Έξοδο",
      "ap.t.in": "Αγορά", "ap.t.rts": "Επιστροφή σε προμηθευτή", "ap.t.out": "Πώληση", "ap.t.ret": "Επιστροφή πελάτη",
      "ap.o.pending": "Σε αναμονή πληρωμής", "ap.o.processing": "Σε επεξεργασία", "ap.o.on-hold": "Σε αναμονή", "ap.o.completed": "Ολοκληρώθηκε",
      "ap.o.cancelled": "Ακυρώθηκε", "ap.o.refunded": "Επιστράφηκαν χρήματα", "ap.o.failed": "Απέτυχε"
    }
  };
  var api = null, LANG = "en";
  function t(k, p) {
    var s = (STR[LANG] || STR.en)[k];
    if (s === undefined) s = STR.en[k] !== undefined ? STR.en[k] : k;
    Object.keys(p || {}).forEach(function (x) { s = s.split("{" + x + "}").join(String(p[x])); });
    return s;
  }
  function readLs(key) {
    try { var v = JSON.parse(localStorage.getItem(key) || "null"); return v && typeof v === "object" ? v : null; } catch (e) { return null; }
  }
  function links() {
    try { return window.parent && window.parent !== window && window.parent.orosLinks && typeof window.parent.orosLinks.list === "function" ? window.parent.orosLinks : null; }
    catch (e) { return null; }
  }
  function shell() {
    try { return window.parent && window.parent !== window && typeof window.parent.__orosOpenAt === "function" ? window.parent : null; } catch (e) { return null; }
  }
  function mailReady() {
    var d = readLs("oros-mail-data");
    return !!(shell() && d && Array.isArray(d.accounts) && d.accounts.length);
  }
  var BUDGET_SEEDS = {
    en: { "o-groc": "Groceries", "o-eat": "Eating out", "o-bills": "Bills", "o-home": "Rent & home", "o-trans": "Transport", "o-health": "Health",
          "o-fun": "Entertainment", "o-cloth": "Clothing", "o-gift": "Gifts", "o-other": "Other", "i-salary": "Salary", "i-free": "Freelance", "i-gift": "Gifts", "i-other": "Other" },
    el: { "o-groc": "Σούπερ μάρκετ", "o-eat": "Φαγητό έξω", "o-bills": "Λογαριασμοί", "o-home": "Ενοίκιο & σπίτι", "o-trans": "Μεταφορές", "o-health": "Υγεία",
          "o-fun": "Ψυχαγωγία", "o-cloth": "Ρούχα", "o-gift": "Δώρα", "o-other": "Άλλα", "i-salary": "Μισθός", "i-free": "Ελεύθερο επάγγελμα", "i-gift": "Δώρα", "i-other": "Άλλα" }
  };
  function budgetCat(bud) {
    var own = {};
    ((bud && bud.cats) || []).forEach(function (c) { if (c && c.name) own[c.id] = c.name; });
    if (window.orosI18n && !BUDGET_SEEDS[LANG]) window.orosI18n.table(BUDGET_SEEDS, "budget", LANG);
    var seeds = BUDGET_SEEDS[LANG] || BUDGET_SEEDS.en;
    return function (id) { return own[id] || seeds[id] || id; };
  }
  var RC_DIR = "/internal/Budget/Receipts", OUT_DIR = "/internal/Invoices/Accountant";
  var MAIL_MAX = 7 * 1024 * 1024;
  function safeName(s) { return String(s || "").replace(/[\\\/:*?\x22<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80); }
  function enc(s) { return new TextEncoder().encode(s); }
  function size(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB"; }

  function open(a) {
    api = a;
    LANG = window.orosI18n ? window.orosI18n.lang() : (a.lang === "el" ? "el" : "en");
    if (window.orosI18n && !STR[LANG]) window.orosI18n.table(STR, "invoices", LANG);
    var C = api.core, el = api.el, btn = api.btn;
    var dlg = api.makeDialog("inv-acct", "🧾 " + t("ap.title"));
    dlg.appendChild(el("p", "hint", t("ap.hint")));
    var mks = months(api.today(), 13);              // this month, then 12 back; last month is picked
    var sel = el("select");
    mks.forEach(function (mk, i) { var o = el("option", "", api.monthName(mk)); o.value = mk; if (i === 1) o.selected = true; sel.appendChild(o); });
    dlg.appendChild(api.field(t("ap.month"), sel));
    var mail = el("input");
    mail.type = "email";
    mail.maxLength = 200;
    mail.autocomplete = "off";
    mail.value = api.prefs().acct || "";
    dlg.appendChild(api.field(t("ap.email"), mail));
    var boxes = el("div", "ap-parts");
    dlg.appendChild(boxes);
    var msg = el("p", "ap-msg");
    dlg.appendChild(msg);
    var acts = el("div", "dlg-actions");
    acts.appendChild(el("span", "spacer"));
    acts.appendChild(btn(t("ap.close"), "", function () { dlg.close(); }));
    var go = btn(t("ap.make"), "primary", make);
    acts.appendChild(go);
    dlg.appendChild(acts);
    var after = el("div", "dlg-actions ap-after");
    after.hidden = true;
    dlg.insertBefore(after, acts);

    var stockD = readLs("oros-stock-data"), budD = readLs("oros-budget-data");
    var Lk = links(), shops = Lk && window.OrosLinksWoo ? Lk.list("woo") : [];
    var parts = {};
    function part(key, label, on, show) {
      var lab = el("label", "check-row");
      var cb = el("input");
      cb.type = "checkbox";
      cb.checked = on;
      lab.appendChild(cb);
      lab.appendChild(el("span", "", label));
      lab.hidden = !show;
      boxes.appendChild(lab);
      parts[key] = cb;
      return cb;
    }
    function scan() {
      var r = monthRange(sel.value), d = api.data();
      var docs = C.live(d.docs).filter(function (x) { return x.st !== "draft" && x.date >= r[0] && x.date <= r[1]; });
      var own = docs.filter(function (x) { return x.kind !== "ext"; });
      var pays = C.live(d.pays).filter(function (p) { return p.date >= r[0] && p.date <= r[1]; });
      var b = budgetRows(budD, sel.value, null), rc = 0;
      b.forEach(function (x) { rc += x.rc.length; });
      var s = stockRows(stockD, r[0], r[1]);
      boxes.innerHTML = "";
      part("docs", t("ap.docs", { n: docs.length }), true, true);
      part("pdf", t("ap.pdf", { n: own.length }), own.length > 0, own.length > 0);
      part("pays", t("ap.pays", { n: pays.length }), pays.length > 0, true);
      part("budget", t("ap.budget", { n: b.length, r: rc }), b.length > 0, !!budD);
      part("stock", t("ap.stock", { n: s.length }), s.length > 0, !!stockD);
      part("shop", t("ap.shop", { s: shops.length ? shops[0].name : "" }), shops.length > 0, shops.length > 0);
    }
    sel.addEventListener("change", function () { scan(); after.hidden = true; msg.textContent = ""; });
    scan();
    api.openDialog(dlg);

    function say(s) { msg.textContent = s; }
    function on(k) { return parts[k] && parts[k].checked && !parts[k].parentNode.hidden; }

    function readOrders(from, to) {
      if (!on("shop")) return Promise.resolve(null);
      var acct = shops[0].id, out = [], page = 1;
      function next() {
        return Lk.call(acct, [{ m: "GET", path: "/orders?after=" + from + "T00:00:00&per_page=100&page=" + page + "&orderby=date&order=asc" }]).then(function (res) {
          var c = Lk.statusCode(res[0]);
          if (c) throw { code: c };
          var list = Array.isArray(res[0].data) ? res[0].data : [];
          var past = false;
          list.forEach(function (o) {
            var n = window.OrosLinksWoo.normOrder(o);
            if (!n) return;
            if (n.d > to) past = true; else out.push(n);
          });
          if (list.length < 100 || past || page >= 20) return out;
          page++;
          return next();
        });
      }
      return next().then(function (o) { return orderRows(o, from, to); });
    }

    function make() {
      var addr = mail.value.trim();
      if (addr && !/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(addr)) { say(t("ap.badMail")); mail.focus(); return; }
      api.setPref("acct", addr);
      var fs = api.fs();
      if (!fs) { say(t("ap.noFs")); return; }
      var mk = sel.value, r = monthRange(mk), d = api.data(), lang = LANG;
      var who = (d.prof && (d.prof.trade || d.prof.name)) || "";
      var title = api.monthName(mk);
      go.disabled = true;
      after.hidden = true;
      var entries = [], files = [], notes = [], sum = [t("ap.s.head", { who: who || "orOS", m: title }), t("ap.s.made", { d: api.fmtDay(api.today()) }), ""];
      function add(name, data, deflate) { entries.push({ name: name, data: data, deflate: deflate !== false }); files.push(name); }
      var docs = C.live(d.docs).filter(function (x) { return x.st !== "draft" && x.date >= r[0] && x.date <= r[1]; });
      var parts2 = {};
      say(t("ap.busy", { s: "" }));
      var chain = Promise.resolve();
      if (on("docs") && docs.length) {
        add("documents.csv", enc(C.docsCsv(d, r[0], r[1], api.docsHead(), api.kindName, api.statusName, lang, api.today())));
        var curs = {}, net = 0, vat = 0, tot = 0;
        docs.forEach(function (x) { var tt = C.totals(x), sg = C.sign(x); curs[x.cur] = 1; net += sg * tt.net; vat += sg * tt.vat; tot += sg * tt.total; });
        var cl = Object.keys(curs);
        sum.push(cl.length === 1 ? t("ap.s.docs", { n: docs.length, net: money(net, lang), vat: money(vat, lang), tot: money(tot, lang), cur: cl[0] })
                                 : t("ap.s.docsMulti", { n: docs.length, c: cl.length }));
      }
      if (on("pays")) {
        var pays = C.live(d.pays).filter(function (p) { return p.date >= r[0] && p.date <= r[1]; });
        if (pays.length) {
          add("payments.csv", enc(C.paysCsv(d, r[0], r[1], api.paysHead(), api.howName, lang)));
          var pt = 0;
          pays.forEach(function (p) { pt += p.amt; });
          sum.push(t("ap.s.pays", { n: pays.length, tot: money(pt, lang) }));
        }
      }
      if (on("pdf")) {
        var own = docs.filter(function (x) { return x.kind !== "ext"; }), bad = 0, used = {};
        own.forEach(function (x, i) {
          chain = chain.then(function () {
            say(t("ap.busy", { s: "PDF " + (i + 1) + "/" + own.length }));
            return new Promise(function (res) { api.pdfBlob(x, res); }).then(function (blob) {
              if (!blob) { bad++; return; }
              var nm = api.pdfName(x).replace(/[\/\\]/g, " "), k = nm, n = 2;
              while (used[k]) k = nm.replace(/\.pdf$/, "") + " (" + (n++) + ").pdf";
              used[k] = 1;
              add("pdf/" + k, blob, false);
            });
          });
        });
        chain = chain.then(function () { if (bad) notes.push(t("ap.pdfFail", { n: bad })); });
      }
      var budget = [], stock = [], orders = [];
      if (on("budget")) {
        budget = budgetRows(budD, mk, budgetCat(budD));
        var head = [t("ap.c.date"), t("ap.c.type"), t("ap.c.cat"), t("ap.c.amt"), t("ap.c.cur"), t("ap.c.note"), t("ap.c.rc")];
        var cur = (budD.set && budD.set.cur) || "EUR";
        add("budget.csv", enc(csv([head].concat(budget.map(function (x) {
          return [x.d, t("ap.k." + x.k), x.cat, money(x.k === "i" ? x.a : -x.a, lang), cur, x.n, x.rc.join(" ")];
        })))));
        var rcs = [];
        budget.forEach(function (x) { x.rc.forEach(function (n) { if (rcs.indexOf(n) < 0) rcs.push(n); }); });
        rcs.forEach(function (n) {
          chain = chain.then(function () {
            return Promise.resolve().then(function () { return fs.readBlob(RC_DIR + "/" + n); }).then(function (b) { if (b) add("receipts/" + n, b, false); }, function () {});
          });
        });
        parts2.rc = rcs.length;
      }
      if (on("stock")) {
        stock = stockRows(stockD, r[0], r[1]);
        var cs = (stockD.settings && stockD.settings.cur) || "EUR";
        add("stock.csv", enc(csv([[t("ap.c.date"), t("ap.c.type"), t("ap.c.ref"), t("ap.c.sup"), t("ap.c.sku"), t("ap.c.name"), t("ap.c.qty"), t("ap.c.unit"), t("ap.c.total"), t("ap.c.cur")]]
          .concat(stock.map(function (x) { return [x.d, t("ap.t." + x.t), x.ref, x.sup, x.sku, x.name, qty(x.q, lang), money(x.u, lang), money(x.tot, lang), cs]; })))));
      }
      chain.then(function () {
        say(t("ap.busy", { s: on("shop") ? "WooCommerce" : "" }));
        return readOrders(r[0], r[1]).then(function (o) { orders = o || []; }, function (e) {
          notes.push(t("ap.shopFail", { e: (e && e.code) || "?" }));
        });
      }).then(function () {
        if (orders.length) {
          add("shop-orders.csv", enc(csv([[t("ap.c.date"), t("ap.c.no"), t("ap.c.status"), t("ap.c.cust"), t("ap.c.total"), t("ap.c.tax"), t("ap.c.ship"), t("ap.c.cur"), t("ap.c.pay")]]
            .concat(orders.map(function (o) {
              var b = o.bill || {};
              return [o.d, o.no, t("ap.o." + o.st), b.company || b.name || "", money(o.total, lang), money(o.tax, lang), money(o.ship, lang), o.cur, o.pay];
            })))));
        }
        var tt = totals({ budget: budget, stock: stock, orders: orders });
        if (budget.length) sum.push(t("ap.s.budget", { i: money(tt.bin, lang), o: money(tt.bout, lang), r: parts2.rc || 0 }));
        if (stock.length) sum.push(t("ap.s.stock", { b: money(tt.buy, lang), s: money(tt.sell, lang) }));
        if (orders.length) sum.push(t("ap.s.shop", { n: tt.ordN, tot: money(tt.ord, lang), tax: money(tt.ordTax, lang) }));
        if (!files.length) { say(t("ap.none")); go.disabled = false; return; }
        notes.forEach(function (n) { sum.push("", n); });
        sum.push("", t("ap.s.files") + ":");
        files.slice().sort().forEach(function (f) { sum.push("- " + f); });
        var text = sum.join("\n");
        entries.unshift({ name: "summary.txt", data: enc(text), deflate: true });
        var zname = safeName((who ? who + " " : "") + mk) + ".zip";
        return window.OrosBundle._zip(entries, new Date()).then(function (bytes) {
          var blob = new Blob([bytes], { type: "application/zip" }), path = OUT_DIR + "/" + zname;
          return Promise.resolve(fs.writeBlob(path, blob)).then(function () {
            go.disabled = false;
            say(t("ap.done", { f: "Invoices/Accountant/" + zname, z: size(blob.size) }) + (notes.length ? " " + notes.join(" ") : ""));
            after.innerHTML = "";
            after.hidden = false;
            if (mailReady()) {
              if (blob.size > MAIL_MAX) after.appendChild(el("p", "hint", t("ap.big", { m: size(MAIL_MAX) })));
              else after.appendChild(btn("✉️ " + t("ap.mail"), "primary", function () {
                var body = [t("ap.hi"), "", t("ap.body", { m: title, f: zname }), "", text, "", t("ap.bye"), who].join("\n");
                dlg.close();
                shell().__orosOpenAt("mail", { compose: { to: addr, subject: t("ap.subject", { who: who || "orOS", m: title }).slice(0, 300), body: body.slice(0, 20000), attach: [{ name: zname, path: path }] } });
              }));
            }
            if (shell()) after.appendChild(btn(t("ap.files"), "", function () { dlg.close(); shell().__orosOpenAt("files", { path: OUT_DIR, dir: true }); }));
            after.appendChild(btn(t("ap.save"), "", function () { api.saveBlob(blob, zname, "application/zip", ".zip", "ZIP"); }));
          });
        });
      }).catch(function (e) {
        try { console.error(e); } catch (x) {}
        go.disabled = false;
        say(t("ap.fail"));
      });
    }
  }

  root.OrosAcctPack.open = open;
  root.OrosAcctPack.STR = STR;
})(typeof window !== "undefined" ? window : globalThis);
