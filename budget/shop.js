// ============================================================
// orOS Budget — shop records (budget/shop.js, PL-1)
// A WooCommerce shop that runs Production Ledger (noxpress 1.0+)
// answers GET /wc/v3/pl/records: its paid orders and its costs, with
// fixed ids and modification times. Budget reads them through
// Connected services (parent.orosLinks; links/core.js allows only that
// read) and keeps them as linked entries (BR-B3, src "pl"):
//   - one income entry per paid order (products + shipping, VAT
//     included: what the customer paid), dated the day it was paid;
//   - one entry per ledger cost (expense) or off-site sale (income),
//     net + VAT;
//   - a cancelled or refunded order, a deleted entry: its entry goes.
// Your own changes win (links.js plan). Which shops feed Budget is
// synced (set.pl, with the categories new entries get, set.plci /
// plco); when each was last read, on this device only
// ("oros-budget-shop-pulled", R30: small, bounded). Reading happens
// when Budget opens or comes back to the screen, at most every 6
// hours per shop, and on "Read now". Nothing is ever written to the
// shop. The bank import then marks the bank's lines for the same
// money as duplicates (bank.js crossTwin "shop" / "payout").
// ============================================================
(function (root) {
  "use strict";
  var A = null;                                   // the app's helpers (init)
  var PULL_KEY = "oros-budget-shop-pulled";
  var EVERY = 6 * 3600 * 1000;
  var MAX_RECS = 50000;
  var SPAN = 390;                                 // days one request may span (the shop allows 400)
  var DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  var running = {};

  var S = {
    en: {
      "shop.btn": "Shop records", "shop.title": "Shop records",
      "shop.intro": "Budget keeps your shop's paid orders as income and its costs as expenses, read from Production Ledger (a Noxpress plugin) on the shop. Amounts include VAT; an order counts on the day it was paid. A cancelled or refunded order leaves again by itself. Your own changes here win. When you import a bank statement, its lines for the same money (a bank transfer for an order, a payout from Viva, Stripe, PayPal or the courier) are marked as already here.",
      "shop.none": "Connect your WooCommerce shop in Settings › Connected services first.",
      "shop.openSettings": "Open Connected services", "shop.noShell": "Open Budget from the orOS desktop to read shop records.",
      "shop.feeds": "Keep this shop's records here", "shop.catIn": "Category for orders", "shop.catOut": "Category for costs",
      "shop.save": "Save and read now", "shop.reading": "Reading {name}…", "shop.close": "Close",
      "shop.never": "Not read yet on this device.",
      "shop.last": "Read {when}: {o} orders, {e} costs.",
      "shop.changed": "{name}: {n} entries added or changed here.",
      "shop.same": "{name}: nothing new.",
      "shop.check": "{name}, {mk}: the shop's total for {kind} is {want}, the records read add up to {got}.",
      "shop.checkOk": "Monthly totals match the shop's to the cent.",
      "shop.kindI": "income", "shop.kindO": "costs", "shop.stopped": "Not kept here any more: {name}. Its entries stay.",
      "shop.err.nopl": "This shop doesn't answer as Production Ledger. Install it (1.0 or later) and turn on its orOS module.",
      "shop.err.cur": "The shop's currency ({c}) is not Budget's ({cur}): nothing read.",
      "shop.err.site": "The connection has no shop address.",
      "shop.err.big": "More than {n} records: read stopped.",
      "shop.err.auth": "The shop refused the key. Check it in Settings › Connected services (a read key is enough).",
      "shop.err.keys": "This device doesn't have the shop's key yet. Enter it in Settings › Connected services.",
      "shop.err.offline": "You're offline.", "shop.err.busy": "The shop asks to slow down. Try again in a minute.",
      "shop.err.notfound": "This shop doesn't answer as Production Ledger. Install it (1.0 or later) and turn on its orOS module.",
      "shop.err.other": "Couldn't reach the shop. Try again later."
    },
    el: {
      "shop.btn": "Εγγραφές καταστήματος", "shop.title": "Εγγραφές καταστήματος",
      "shop.intro": "Τα Έσοδα & Έξοδα κρατούν τις πληρωμένες παραγγελίες του καταστήματός σου ως έσοδα και τα κόστη του ως έξοδα, όπως τα γράφει το Production Ledger (πρόσθετο Noxpress) στο κατάστημα. Τα ποσά είναι με ΦΠΑ· μια παραγγελία μετρά τη μέρα που πληρώθηκε. Μια παραγγελία που ακυρώνεται ή επιστρέφεται φεύγει μόνη της. Οι δικές σου αλλαγές εδώ υπερισχύουν. Όταν φέρνεις κίνηση τράπεζας, οι γραμμές της για τα ίδια χρήματα (μεταφορά για μια παραγγελία, εκκαθάριση από Viva, Stripe, PayPal ή courier) σημειώνονται ως ήδη καταχωρημένες.",
      "shop.none": "Σύνδεσε πρώτα το κατάστημα WooCommerce στις Ρυθμίσεις › Συνδεδεμένες υπηρεσίες.",
      "shop.openSettings": "Άνοιγμα Συνδεδεμένων υπηρεσιών", "shop.noShell": "Άνοιξε τα Έσοδα & Έξοδα από την επιφάνεια εργασίας του orOS για να διαβαστούν οι εγγραφές του καταστήματος.",
      "shop.feeds": "Κράτα εδώ τις εγγραφές αυτού του καταστήματος", "shop.catIn": "Κατηγορία για παραγγελίες", "shop.catOut": "Κατηγορία για κόστη",
      "shop.save": "Αποθήκευση και ανάγνωση τώρα", "shop.reading": "Ανάγνωση {name}…", "shop.close": "Κλείσιμο",
      "shop.never": "Δεν έχει διαβαστεί ακόμα σε αυτή τη συσκευή.",
      "shop.last": "Διαβάστηκε {when}: {o} παραγγελίες, {e} κόστη.",
      "shop.changed": "{name}: {n} εγγραφές προστέθηκαν ή άλλαξαν εδώ.",
      "shop.same": "{name}: τίποτα νέο.",
      "shop.check": "{name}, {mk}: το σύνολο του καταστήματος για {kind} είναι {want}, οι εγγραφές που διαβάστηκαν κάνουν {got}.",
      "shop.checkOk": "Τα σύνολα των μηνών συμφωνούν με του καταστήματος στο λεπτό.",
      "shop.kindI": "έσοδα", "shop.kindO": "κόστη", "shop.stopped": "Δεν κρατιέται πια εδώ: {name}. Οι εγγραφές του μένουν.",
      "shop.err.nopl": "Αυτό το κατάστημα δεν απαντά ως Production Ledger. Εγκατάστησέ το (1.0 ή νεότερο) και άνοιξε τη λειτουργία orOS.",
      "shop.err.cur": "Το νόμισμα του καταστήματος ({c}) δεν είναι αυτό της εφαρμογής ({cur}): δεν διαβάστηκε τίποτα.",
      "shop.err.site": "Η σύνδεση δεν έχει διεύθυνση καταστήματος.",
      "shop.err.big": "Πάνω από {n} εγγραφές: η ανάγνωση σταμάτησε.",
      "shop.err.auth": "Το κατάστημα απέρριψε το κλειδί. Έλεγξέ το στις Ρυθμίσεις › Συνδεδεμένες υπηρεσίες (αρκεί κλειδί ανάγνωσης).",
      "shop.err.keys": "Αυτή η συσκευή δεν έχει ακόμα το κλειδί του καταστήματος. Πέρασέ το στις Ρυθμίσεις › Συνδεδεμένες υπηρεσίες.",
      "shop.err.offline": "Είσαι εκτός σύνδεσης.", "shop.err.busy": "Το κατάστημα ζητά να πάμε πιο αργά. Δοκίμασε ξανά σε ένα λεπτό.",
      "shop.err.notfound": "Αυτό το κατάστημα δεν απαντά ως Production Ledger. Εγκατάστησέ το (1.0 ή νεότερο) και άνοιξε τη λειτουργία orOS.",
      "shop.err.other": "Δεν ήταν δυνατή η σύνδεση με το κατάστημα. Δοκίμασε αργότερα."
    }
  };
  // orosI18n (../i18n.js): S[<pack language>] from the pack "budget".
  if (root.orosI18n) root.orosI18n.table(S, "budget", root.orosI18n.lang());
  function t(k, params) {
    var tab = (A && S[A.lang]) || S.en;
    var s = tab[k] !== undefined ? tab[k] : S.en[k] !== undefined ? S.en[k] : k;
    return s.replace(/\{(\w+)\}/g, function (m, n) { return params && params[n] !== undefined ? String(params[n]) : m; });
  }
  function L() { return root.OrosBudgetLinks; }
  function links() {
    try { var p = root.parent; return p && p !== root && p.orosLinks && typeof p.orosLinks.call === "function" ? p.orosLinks : null; }
    catch (e) { return null; }
  }
  function shops() {
    var Lk = links();
    try { return Lk ? Lk.list("woo") : []; } catch (e) { return []; }
  }
  function chosen() {
    var v = A && A.set().pl;
    return typeof v === "string" && v ? v.split(" ") : [];
  }
  function cats() { var s = A.set(); return { i: s.plci || "", o: s.plco || "" }; }

  // ---------- When each shop was last read (this device) ----------
  function readState() {
    try {
      var o = JSON.parse(localStorage.getItem(PULL_KEY) || "{}");
      return o && typeof o === "object" && !Array.isArray(o) ? o : {};
    } catch (e) { return {}; }
  }
  function writeState(id, v) {
    var st = readState(), keep = {};
    chosen().concat([id]).forEach(function (k) { if (st[k]) keep[k] = st[k]; });   // bounded: chosen shops only
    keep[id] = v;
    try { localStorage.setItem(PULL_KEY, JSON.stringify(keep)); } catch (e) {}
  }

  // ---------- Reading ----------
  function fail(code, params) { var e = new Error(code); e.code = code; e.params = params || {}; return e; }
  function ask(id, reqs) {
    return links().call(id, reqs).then(function (res) {
      return (res || []).map(function (r) {
        var code = links().statusCode(r);
        if (code) throw fail(code === "notfound" ? "nopl" : code);
        return r.data;
      });
    });
  }
  function addDays(ymd, n) {
    var d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10) + n));
    return d.toISOString().slice(0, 10);
  }
  function span(a, b) { return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000); }
  function okEnv(j) {
    return j && typeof j === "object" && j.source === "production-ledger" && Array.isArray(j.records) &&
           typeof j.pages === "number" && j.pages >= 1 && j.pages <= 1000 && DAY_RE.test(j.from || "") && DAY_RE.test(j.to || "");
  }
  function addMonths(into, mo) {
    if (!mo || typeof mo !== "object" || Array.isArray(mo)) return;
    Object.keys(mo).forEach(function (mk) {
      var w = mo[mk] || {}, x = (into[mk] = into[mk] || { income_net: 0, income_vat: 0, expense_net: 0, expense_vat: 0 });
      Object.keys(x).forEach(function (f) { if (typeof w[f] === "number" && isFinite(w[f])) x[f] += w[f]; });
    });
  }
  // One shop → { recs, months } (every page of every window).
  function readAll(acct, onPage) {
    var today = A.today(), recs = [], months = {};
    function window1(from, to, first) {
      var got = first ? Promise.resolve(first) : ask(acct.id, [L().shopReq(from, to, 1)]).then(function (r) { return r[0]; });
      return got.then(function (env) {
        if (!okEnv(env)) throw fail("nopl");
        if (env.currency !== A.cur()) throw fail("cur", { c: String(env.currency || "?").slice(0, 3), cur: A.cur() });
        recs = recs.concat(env.records);
        addMonths(months, env.months);
        if (onPage) onPage(recs.length);
        var pages = [];
        for (var p = 2; p <= env.pages; p++) pages.push(p);
        return pages.reduce(function (chain, p) {
          return chain.then(function () {
            if (recs.length > MAX_RECS) throw fail("big", { n: MAX_RECS });
            return ask(acct.id, [L().shopReq(env.from, env.to, p)]).then(function (r) {
              if (!okEnv(r[0])) throw fail("nopl");
              recs = recs.concat(r[0].records);
              if (onPage) onPage(recs.length);
            });
          });
        }, Promise.resolve()).then(function () { return env; });
      });
    }
    // The first page tells where the shop's records start.
    return ask(acct.id, [L().shopReq("", today, 1)]).then(function (r) {
      var env = r[0];
      if (!okEnv(env)) throw fail("nopl");
      var start = DAY_RE.test(env.start || "") ? env.start : env.from;
      if (span(start, today) <= SPAN) return window1(env.from, env.to, env);
      // a longer history: windows of SPAN days, oldest first
      var wins = [], f = start;
      while (f <= today) { var to = addDays(f, SPAN - 1); if (to > today) to = today; wins.push([f, to]); f = addDays(to, 1); }
      return wins.reduce(function (chain, w) {
        return chain.then(function () { return window1(w[0], w[1], null); });
      }, Promise.resolve());
    }).then(function () { return { recs: recs, months: months }; });
  }
  // Read one shop and keep its records here → Promise<result>.
  function pull(acct, onPage) {
    if (running[acct.id]) return running[acct.id];
    var tag = L().shopTag(acct.site);
    var p = !tag ? Promise.reject(fail("site")) : readAll(acct, onPage).then(function (got) {
      var rows = L().shopRows(got.recs, tag, cats());
      var o = 0, e = 0;
      rows.forEach(function (r) { if (!r.del) { if (/-o\d+$/.test(r.key)) o++; else e++; } });
      var res = { n: A.apply(rows), o: o, e: e, bad: L().shopCheck(got.recs, got.months) };
      writeState(acct.id, { t: Date.now(), o: o, e: e, bad: res.bad.length });
      return res;
    }, function (err) {
      writeState(acct.id, Object.assign({}, readState()[acct.id] || {}, { err: (err && err.code) || "other", et: Date.now() }));
      throw err;
    });
    running[acct.id] = p;
    var done = function () { delete running[acct.id]; };
    p.then(done, done);
    return p;
  }
  // Budget opened or came back: read the chosen shops not read for 6 h.
  function auto() {
    if (!A || !has() || (typeof navigator !== "undefined" && navigator.onLine === false)) return;
    var ids = chosen();
    if (!ids.length) return;
    var st = readState(), now = Date.now();
    shops().forEach(function (a) {
      if (ids.indexOf(a.id) < 0) return;
      var s = st[a.id] || {};
      if (now - Math.max(s.t || 0, s.et || 0) < EVERY) return;
      pull(a).catch(function () {});             // shown in the dialog (its last error)
    });
  }

  // ---------- Dialog ----------
  function el(tag, cls, text) { return A.el(tag, cls, text); }
  function errText(e) {
    var c = e && e.code;
    var known = { nopl: 1, cur: 1, site: 1, big: 1, auth: 1, keys: 1, offline: 1, busy: 1, notfound: 1 };
    return t(known[c] ? "shop.err." + c : "shop.err.other", (e && e.params) || { n: MAX_RECS });
  }
  function when(ms) {
    var d = new Date(ms), p = function (n) { return (n < 10 ? "0" : "") + n; };
    return p(d.getDate()) + "/" + p(d.getMonth() + 1) + "/" + d.getFullYear() + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }
  function statusOf(id) {
    var s = readState()[id];
    if (!s) return t("shop.never");
    var out = s.t ? t("shop.last", { when: when(s.t), o: s.o || 0, e: s.e || 0 }) : t("shop.never");
    if (s.err && (s.et || 0) > (s.t || 0)) out += " " + errText({ code: s.err });
    return out;
  }
  function open() {
    var dlg = A.makeDialog("bd-shop", t("shop.title"));
    dlg.appendChild(el("p", "pay-hint", t("shop.intro")));
    var acts = el("div", "dlg-actions");
    var closeBtn = A.button(t("shop.close"), "", function () { dlg.close(); });
    var Lk = links(), list = shops();
    if (!Lk || !list.length) {
      dlg.appendChild(el("p", "", Lk ? t("shop.none") : t("shop.noShell")));
      acts.appendChild(closeBtn);
      if (Lk) acts.appendChild(A.button(t("shop.openSettings"), "primary", function () {
        dlg.close();
        try { root.parent.__orosOpenAt("settings", { section: "services" }); } catch (e) {}
      }));
      dlg.appendChild(acts);
      A.showDialog(dlg);
      return;
    }
    var on = chosen(), boxes = [];
    list.forEach(function (a, i) {
      var row = el("div", "shop-acct");
      var lab = el("label", "shop-chk");
      var cb = el("input");
      cb.type = "checkbox";
      cb.checked = on.indexOf(a.id) >= 0;
      cb.setAttribute("data-k", "shop.feed." + i);
      lab.appendChild(cb);
      lab.appendChild(el("span", "", a.name + (a.site ? " · " + String(a.site).replace(/^https?:\/\//, "").replace(/\/$/, "") : "")));
      row.appendChild(lab);
      row.appendChild(el("p", "pay-hint shop-st", statusOf(a.id)));
      row.setAttribute("title", t("shop.feeds"));
      cb.setAttribute("aria-label", t("shop.feeds") + ": " + a.name);
      dlg.appendChild(row);
      boxes.push({ a: a, cb: cb, st: row.lastChild });
    });
    var c0 = cats();
    var cIn = A.catSelect("i", c0.i || "i-free"), cOut = A.catSelect("o", c0.o || "o-other");
    var r2 = el("div", "fld-row");
    r2.appendChild(A.field(t("shop.catIn"), cIn, "bd-shop-cin"));
    r2.appendChild(A.field(t("shop.catOut"), cOut, "bd-shop-cout"));
    dlg.appendChild(r2);
    var msg = el("div", "pay-msg");
    msg.setAttribute("aria-live", "polite");
    dlg.appendChild(msg);
    function line(text, cls) { msg.appendChild(el("p", cls || "pay-hint", text)); }
    var busy = false;
    var go = A.button(t("shop.save"), "primary", function () {
      if (busy) return;
      var was = chosen();
      var ids = boxes.filter(function (b) { return b.cb.checked; }).map(function (b) { return b.a.id; }).slice(0, 5);
      A.saveSet({ pl: ids.join(" "), plci: cIn.value === "i-free" ? "" : cIn.value, plco: cOut.value === "o-other" ? "" : cOut.value });
      msg.textContent = "";
      boxes.forEach(function (b) { if (was.indexOf(b.a.id) >= 0 && ids.indexOf(b.a.id) < 0) line(t("shop.stopped", { name: b.a.name })); });
      busy = true;
      go.disabled = true;
      var allOk = true;
      boxes.filter(function (b) { return ids.indexOf(b.a.id) >= 0; }).reduce(function (chain, b) {
        return chain.then(function () {
          var p = el("p", "pay-hint", t("shop.reading", { name: b.a.name }));
          msg.appendChild(p);
          return pull(b.a, function (n) { p.textContent = t("shop.reading", { name: b.a.name }) + " " + n; }).then(function (res) {
            p.className = "pay-plan";
            p.textContent = res.n ? t("shop.changed", { name: b.a.name, n: res.n }) : t("shop.same", { name: b.a.name });
            res.bad.slice(0, 6).forEach(function (x) {
              allOk = false;
              line(t("shop.check", { name: b.a.name, mk: x.mk, kind: t(x.k === "i" ? "shop.kindI" : "shop.kindO"), want: A.money(x.want), got: A.money(x.got) }), "pay-plan");
            });
          }, function (e) {
            allOk = false;
            p.textContent = b.a.name + ": " + errText(e);
          }).then(function () { b.st.textContent = statusOf(b.a.id); });
        });
      }, Promise.resolve()).then(function () {
        if (allOk && ids.length) line(t("shop.checkOk"));
        busy = false;
        go.disabled = false;
      });
    });
    go.setAttribute("data-k", "shop.go");
    acts.appendChild(closeBtn);
    acts.appendChild(go);
    dlg.appendChild(acts);
    dlg.addEventListener("close", function () { A.refresh(); });
    A.showDialog(dlg);
    if (boxes[0]) boxes[0].cb.focus();
  }

  function has() { return !!links() && !!L(); }
  root.OrosBudgetShop = {
    init: function (api) { A = api; },
    open: open,
    auto: auto,
    has: has,
    label: function () { return t("shop.btn"); }
  };
})(typeof window !== "undefined" ? window : this);
