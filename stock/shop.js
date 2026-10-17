// ============================================================
// orOS Stock — the shop (stock/shop.js, v1.0.0)
// Stock ↔ a WooCommerce shop connected in Settings › Connected
// services. Everything goes through the shell's orosLinks (keys
// sealed there, calls checked there); this file never sees a key.
//   Products: get the shop's products (simple + variations) as a
//     Stock import (links/woo.js productPlan; matched by the id made
//     for that shop product, then SKU, then name), optionally with a
//     stock count to the shop's quantities. Then the differences:
//     send this app's quantity to the shop, or take the shop's (a
//     stock count line).
//   Orders: the shop's recent orders, live (nothing stored). Per
//     order: record the sale in Stock (BR-ST-OUT prefill, src
//     "woo:<account>-<order>" so a second time is flagged), make an
//     invoice (Invoices {new}), log it in CRM (BR-CRM-MAIL), add it to
//     Budget (BR-B1), mark it completed in the shop.
// Writes to the shop happen only on a button, never in the
// background. Everything from the shop is plain text (textContent).
// Loaded by stock/index.html after links/core.js and links/woo.js;
// stock.js calls window.OrosStockShop.open(api).
// ============================================================
(function () {
  "use strict";

  var W = window.OrosLinksWoo, L = window.OrosLinksCore;

  var STR = {
    en: {
      title: "Shop", products: "Products", orders: "Orders",
      none: "No shop connected yet. Connect your WooCommerce shop in Settings › Connected services.",
      connect: "Open Connected services", acct: "Shop",
      noKeys: "This device doesn't have the shop's keys yet. Enter them in Settings › Connected services.",
      get: "Get products from the shop", getting: "Reading the shop… {n} products",
      plan: "{n} products in the shop: {a} new, {u} changed, {s} the same here.",
      setQty: "Also set the quantities here to the shop's ({n} products)",
      import: "Import into Stock", imported: "{a} added, {u} updated",
      nothing: "Everything is already here.",
      diffTitle: "Quantities that differ", diffNone: "Quantities here and in the shop match.",
      diffHint: "Only products whose stock the shop manages. The shop keeps whole units.",
      here: "here {q}", shop: "shop {q}",
      send: "Send to shop", take: "Take the shop's", sendAll: "Send all to the shop",
      sent: "Sent to the shop: {n}", sendFail: "{n} could not be sent",
      took: "Counted at the shop's quantity", countRef: "WooCommerce",
      importFirst: "Import the products first: these shop products aren't in Stock yet.",
      ord: "Status", ordOpen: "To process", ordDone: "Completed", ordAll: "All",
      ordLoad: "Show orders", ordLoading: "Reading orders…", ordNone: "No orders in the last 30 days.",
      ordDays: "Last 30 days, newest first.",
      recSale: "Record the sale", recorded: "Sale recorded", invoice: "Invoice", crm: "Customer in CRM",
      budget: "Add to Budget", complete: "Mark completed", completeQ: "Mark order #{n} completed in the shop? The customer may get an e-mail from the shop.",
      completed: "Order #{n} is completed", noCode: "Without a code in Stock: {list}",
      shipping: "Shipping", st_pending: "Pending payment", "st_processing": "Processing", "st_on-hold": "On hold",
      st_completed: "Completed", st_cancelled: "Cancelled", st_refunded: "Refunded", st_failed: "Failed",
      close: "Close", yes: "Yes", cancel: "Cancel",
      "err.offline": "You are offline.", "err.auth": "The shop refused the keys. Check them in Settings › Connected services.",
      "err.notfound": "The shop's REST API was not found at this address.", "err.network": "The shop could not be reached.",
      "err.relay": "The shop does not answer this browser and the orOS relay did not answer either.",
      "err.server": "The shop answered with an error.", "err.busy": "The shop asks to wait a little.",
      "err.keys": "This device doesn't have the shop's keys.", "err.denied": "orOS does not allow that call.",
      "err.gone": "This shop was disconnected.", "err.bad": "Something went wrong."
    },
    el: {
      title: "Κατάστημα", products: "Προϊόντα", orders: "Παραγγελίες",
      none: "Δεν έχεις συνδέσει κατάστημα ακόμα. Σύνδεσε το WooCommerce σου στις Ρυθμίσεις › Συνδεδεμένες υπηρεσίες.",
      connect: "Άνοιγμα: Συνδεδεμένες υπηρεσίες", acct: "Κατάστημα",
      noKeys: "Αυτή η συσκευή δεν έχει ακόμα τα κλειδιά του καταστήματος. Πέρασέ τα στις Ρυθμίσεις › Συνδεδεμένες υπηρεσίες.",
      get: "Φέρε τα προϊόντα του καταστήματος", getting: "Διαβάζω το κατάστημα… {n} προϊόντα",
      plan: "{n} προϊόντα στο κατάστημα: {a} νέα, {u} με αλλαγές, {s} ίδια με εδώ.",
      setQty: "Να γίνουν και οι ποσότητες εδώ ίδιες με του καταστήματος ({n} προϊόντα)",
      import: "Εισαγωγή στο Απόθεμα", imported: "{a} νέα, {u} ενημερώθηκαν",
      nothing: "Όλα υπάρχουν ήδη εδώ.",
      diffTitle: "Ποσότητες που διαφέρουν", diffNone: "Οι ποσότητες εδώ και στο κατάστημα συμφωνούν.",
      diffHint: "Μόνο προϊόντα των οποίων το απόθεμα διαχειρίζεται το κατάστημα. Το κατάστημα κρατά ακέραιες μονάδες.",
      here: "εδώ {q}", shop: "κατάστημα {q}",
      send: "Στείλε στο κατάστημα", take: "Πάρε του καταστήματος", sendAll: "Στείλε όλα στο κατάστημα",
      sent: "Στάλθηκαν στο κατάστημα: {n}", sendFail: "{n} δεν στάλθηκαν",
      took: "Καταμετρήθηκε στην ποσότητα του καταστήματος", countRef: "WooCommerce",
      importFirst: "Κάνε πρώτα εισαγωγή: αυτά τα προϊόντα του καταστήματος δεν είναι ακόμα στο Απόθεμα.",
      ord: "Κατάσταση", ordOpen: "Προς εκτέλεση", ordDone: "Ολοκληρωμένες", ordAll: "Όλες",
      ordLoad: "Δείξε τις παραγγελίες", ordLoading: "Διαβάζω τις παραγγελίες…", ordNone: "Καμία παραγγελία τις τελευταίες 30 ημέρες.",
      ordDays: "Τελευταίες 30 ημέρες, οι νεότερες πρώτες.",
      recSale: "Καταχώριση πώλησης", recorded: "Η πώληση καταχωρίστηκε", invoice: "Παραστατικό", crm: "Πελάτης στο CRM",
      budget: "Στα Έσοδα & Έξοδα", complete: "Ολοκλήρωση", completeQ: "Να ολοκληρωθεί η παραγγελία #{n} στο κατάστημα; Ο πελάτης μπορεί να πάρει e-mail από το κατάστημα.",
      completed: "Η παραγγελία #{n} ολοκληρώθηκε", noCode: "Χωρίς κωδικό στο Απόθεμα: {list}",
      shipping: "Μεταφορικά", st_pending: "Αναμονή πληρωμής", "st_processing": "Σε επεξεργασία", "st_on-hold": "Σε αναμονή",
      st_completed: "Ολοκληρωμένη", st_cancelled: "Ακυρωμένη", st_refunded: "Επιστράφηκε", st_failed: "Απέτυχε",
      close: "Κλείσιμο", yes: "Ναι", cancel: "Άκυρο",
      "err.offline": "Είσαι εκτός σύνδεσης.", "err.auth": "Το κατάστημα δεν δέχτηκε τα κλειδιά. Έλεγξέ τα στις Ρυθμίσεις › Συνδεδεμένες υπηρεσίες.",
      "err.notfound": "Δεν βρέθηκε το REST API του καταστήματος σε αυτή τη διεύθυνση.", "err.network": "Το κατάστημα δεν απάντησε.",
      "err.relay": "Το κατάστημα δεν απαντά σε αυτόν τον browser και δεν απάντησε ούτε το relay του orOS.",
      "err.server": "Το κατάστημα απάντησε με σφάλμα.", "err.busy": "Το κατάστημα ζητά λίγη αναμονή.",
      "err.keys": "Αυτή η συσκευή δεν έχει τα κλειδιά του καταστήματος.", "err.denied": "Το orOS δεν επιτρέπει αυτή την κλήση.",
      "err.gone": "Αυτό το κατάστημα αποσυνδέθηκε.", "err.bad": "Κάτι πήγε στραβά."
    }
  };

  function links() {
    try { return window.parent && window.parent !== window && window.parent.orosLinks && typeof window.parent.orosLinks.list === "function" ? window.parent.orosLinks : null; }
    catch (e) { return null; }
  }
  function available() { return !!(links() && W && L); }

  // per session: what the last read of each shop gave
  var cache = { acct: "", products: null, plan: null, orders: null, ost: "open" };

  function open(api) {
    // orosI18n (../i18n.js): the full language code, a pack language included.
    var LANG = window.orosI18n ? window.orosI18n.lang() : (api.lang === "el" ? "el" : "en");
    var LOCALE = window.orosI18n ? window.orosI18n.locale(LANG) : (LANG === "el" ? "el-GR" : "en-GB");
    // shared modules (links/woo.js) pick between their en/el texts
    var BASE = LANG === "el" ? "el" : "en";
    if (window.orosI18n && !STR[LANG]) window.orosI18n.table(STR, "stock", LANG);
    function t(k, vars) {
      var tb = STR[LANG] || STR.en;
      var s = tb[k] !== undefined ? tb[k] : (STR.en[k] !== undefined ? STR.en[k] : k);
      if (vars) Object.keys(vars).forEach(function (n) { s = s.split("{" + n + "}").join(String(vars[n])); });
      return s;
    }
    var el = api.el, button = api.button;
    var Lk = links();
    var dlg = api.makeDialog("st-shop", true);
    dlg.classList.add("shop-dlg");
    dlg.appendChild(el("div", "dlg-title", "🛍️ " + t("title")));
    var body = el("div", "shop-body");
    dlg.appendChild(body);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("close"), "primary", function () { dlg.close(); }));
    dlg.appendChild(acts);
    api.showDialog(dlg);

    var accts = Lk ? Lk.list("woo") : [];
    if (!accts.length) {
      body.appendChild(el("p", "confirm-msg", t("none")));
      body.appendChild(el("div", "dlg-actions").appendChild(button(t("connect"), "", toSettings)).parentNode);
      return;
    }
    if (!accts.some(function (a) { return a.id === cache.acct; })) {
      cache = { acct: accts[0].id, products: null, plan: null, orders: null, ost: "open" };
    }
    var tab = "products";

    function toSettings() {
      dlg.close();
      try { window.parent.__orosOpenAt("settings", "services"); } catch (e) {}
    }
    function errText(e) {
      var code = (e && e.code) || (typeof e === "string" ? e : "bad");
      return t("err." + code) === "err." + code ? t("err.bad") : t("err." + code);
    }
    // "2026-10-12 18:20" (the shop's own time) → "12 Oct, 18:20"
    function when(at) {
      var m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(at || "");
      if (!m) return at || "";
      var d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
      try { return d.toLocaleString(LOCALE, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }); }
      catch (e) { return at; }
    }
    function moneyIn(cents, cur) {
      try { return new Intl.NumberFormat(LOCALE, { style: "currency", currency: cur }).format(cents / 100); }
      catch (e) { return (cents / 100).toFixed(2) + " " + cur; }
    }
    // one call (≤ 10 requests) → the results, or throws a code
    function call(reqs) {
      return Lk.call(cache.acct, reqs).then(function (res) {
        res.forEach(function (x) { var c = Lk.statusCode(x); if (c) throw { code: c }; });
        return res.map(function (x) { return x.data; });
      });
    }

    function draw() {
      body.innerHTML = "";
      if (accts.length > 1) {
        var sel = api.selectInput(accts.map(function (a) { return [a.id, a.name]; }), cache.acct);
        sel.addEventListener("change", function () {
          cache = { acct: sel.value, products: null, plan: null, orders: null, ost: "open" };
          draw();
        });
        body.appendChild(api.field(t("acct"), sel, "st-shop-acct"));
      } else {
        body.appendChild(el("p", "dlg-sub", accts[0].name + " · " + accts[0].site.replace(/^https:\/\//, "")));
      }
      var tabs = el("div", "shop-tabs");
      tabs.setAttribute("role", "tablist");
      [["products", t("products")], ["orders", t("orders")]].forEach(function (x) {
        var b = button(x[1], "shop-tab" + (tab === x[0] ? " primary" : ""), function () { tab = x[0]; draw(); });
        b.setAttribute("role", "tab");
        b.setAttribute("aria-selected", tab === x[0] ? "true" : "false");
        tabs.appendChild(b);
      });
      body.appendChild(tabs);
      var pane = el("div", "shop-pane");
      body.appendChild(pane);
      Lk.hasKeys(cache.acct).then(function (h) {
        if (!h) {
          pane.appendChild(el("p", "confirm-msg", t("noKeys")));
          pane.appendChild(el("div", "dlg-actions").appendChild(button(t("connect"), "", toSettings)).parentNode);
          return;
        }
        if (tab === "products") drawProducts(pane); else drawOrders(pane);
      });
    }

    // ---------- Products ----------
    // Through the relay a call stays small (the Worker's CPU limit): 2 pages
    // or 4 variation lists instead of 5 / 10 when the browser goes direct.
    function viaRelay() { return typeof Lk.mode === "function" && Lk.mode(cache.acct) === "relay"; }
    function readAll(status) {
      // pages of 100; then the variations of variable products
      var products = [], page = 1;
      function next() {
        status.textContent = t("getting", { n: products.length });
        var reqs = [], n = viaRelay() ? 2 : 5;
        for (var i = 0; i < n; i++) reqs.push({ m: "GET", path: "/products?per_page=100&page=" + (page + i) + "&orderby=id&order=asc" });
        return call(reqs).then(function (pages) {
          var done = false;
          pages.forEach(function (p) {
            if (done) return;
            var list = Array.isArray(p) ? p : [];
            products = products.concat(list);
            if (list.length < 100) done = true;
          });
          page += n;
          if (!done && products.length < 5000) return next();
        });
      }
      var vars = {};
      return next().then(function () {
        var parents = products.filter(function (p) { return p && p.type === "variable" && typeof p.id === "number"; }).map(function (p) { return p.id; });
        function batch() {
          if (!parents.length) return Promise.resolve();
          var ids = parents.splice(0, viaRelay() ? 4 : 10);
          return call(ids.map(function (id) { return { m: "GET", path: "/products/" + id + "/variations?per_page=100" }; })).then(function (res) {
            ids.forEach(function (id, i) { vars[id] = Array.isArray(res[i]) ? res[i] : []; });
            status.textContent = t("getting", { n: products.length });
            return batch();
          });
        }
        return batch();
      }).then(function () { return { products: products, vars: vars }; });
    }
    function makePlan(setQty) {
      return W.productPlan(api.core, api.data(), cache.products.products, cache.products.vars,
        { acct: cache.acct, now: Date.now(), today: api.todayYmd(), setQty: setQty, vat: api.data().settings.vat });
    }
    function drawProducts(pane) {
      var status = el("p", "hint");
      status.setAttribute("aria-live", "polite");
      var getBtn = button(t("get"), cache.products ? "" : "primary", function () {
        getBtn.disabled = true;
        readAll(status).then(function (r) {
          cache.products = r;
          draw();
        }, function (e) {
          getBtn.disabled = false;
          status.textContent = errText(e);
          status.classList.add("warn");
        });
      });
      pane.appendChild(el("div", "dlg-actions tight").appendChild(getBtn).parentNode);
      pane.appendChild(status);
      if (!cache.products) return;

      var plan = makePlan(false), probe = makePlan(true);
      var s = plan.stats;
      pane.appendChild(el("p", "confirm-msg", t("plan", { n: plan.links.length, a: s.added, u: s.updated, s: s.same })));
      var qrow = null;
      if (probe.stats.qty > 0) {
        qrow = api.checkRow(t("setQty", { n: probe.stats.qty }), false);
        pane.appendChild(qrow);
      }
      if (s.added || s.updated || probe.stats.qty) {
        pane.appendChild(el("div", "dlg-actions tight").appendChild(button(t("import"), "primary", function () {
          var use = qrow && qrow.querySelector("input").checked ? probe : plan;
          if (use.move) use.move.ref = t("countRef");
          api.applyPlan(use);
          api.toast(t("imported", { a: use.stats.added, u: use.stats.updated }));
          draw();
        })).parentNode);
      } else {
        pane.appendChild(el("p", "hint", t("nothing")));
      }
      drawDiff(pane, plan);
    }
    function drawDiff(pane, plan) {
      pane.appendChild(el("div", "dlg-lbl", t("diffTitle")));
      var known = plan.links.filter(function (l) { return api.byItem(l.item); });
      if (known.length < plan.links.length && plan.stats.added) pane.appendChild(el("p", "hint", t("importFirst")));
      var rows = W.compare(api.core, api.data(), known);
      if (!rows.length) { pane.appendChild(el("p", "hint", t("diffNone"))); return; }
      pane.appendChild(el("p", "hint", t("diffHint")));
      var list = el("ul", "vlist shop-list");
      rows.slice(0, 300).forEach(function (r) {
        var li = el("li", "shop-row");
        var head = el("div", "shop-name", r.item.name + (r.item.sku ? " · " + r.item.sku : ""));
        li.appendChild(head);
        li.appendChild(el("div", "hint", t("here", { q: api.fmtQ(r.mine, r.item) }) + " · " + t("shop", { q: api.fmtQ(r.shop, r.item) })));
        var a = el("div", "dlg-actions tight wrap");
        a.appendChild(button(t("send"), "", function () { send([r]); }));
        a.appendChild(button(t("take"), "", function () { take(r); }));
        li.appendChild(a);
        list.appendChild(li);
      });
      pane.appendChild(list);
      if (rows.length > 1) pane.appendChild(el("div", "dlg-actions").appendChild(button(t("sendAll"), "primary", function () { send(rows); })).parentNode);
    }
    function send(rows) {
      var todo = rows.slice(), ok = 0, bad = 0;
      function step() {
        if (!todo.length) return Promise.resolve();
        var part = todo.splice(0, 10);
        return Lk.call(cache.acct, part.map(function (r) { return W.stockReq(r.link, r.mine); })).then(function (res) {
          part.forEach(function (r, i) {
            if (!Lk.statusCode(res[i])) {
              ok++;
              // the shop now has whole units of what is here
              r.link.q = Math.round(r.mine / 1000) * 1000;
              updateCached(r.link);
            } else bad++;
          });
          return step();
        });
      }
      step().then(function () {
        api.toast(t("sent", { n: ok }) + (bad ? " · " + t("sendFail", { n: bad }) : ""));
        draw();
      }, function (e) { api.toast(errText(e)); draw(); });
    }
    // keep the cached product in line with what the shop now holds
    function updateCached(link) {
      var P = cache.products;
      if (!P) return;
      var list = link.vid ? P.vars[link.pid] : P.products;
      (list || []).forEach(function (p) { if (p && p.id === (link.vid || link.pid)) p.stock_quantity = link.q / 1000; });
    }
    function take(r) {
      var have = r.mine, target = Math.max(0, r.shop);
      if (target === have) return;
      api.applyPlan({ items: [], cats: [], sups: [], units: [], links: [], stats: {},
        move: { id: api.newId(), m: Date.now(), d: api.todayYmd(), t: "count", ref: t("countRef"), sup: "", note: "",
                lines: [{ i: r.item.id, q: target - have, n: target }] } });
      api.toast(t("took"));
      draw();
    }

    // ---------- Orders ----------
    var ST = { open: "processing,on-hold,pending", done: "completed", all: "" };
    function drawOrders(pane) {
      var sel = api.selectInput([["open", t("ordOpen")], ["done", t("ordDone")], ["all", t("ordAll")]], cache.ost);
      var status = el("p", "hint");
      status.setAttribute("aria-live", "polite");
      function load() {
        status.textContent = t("ordLoading");
        var after = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 19);
        var q = { status: ST[cache.ost], after: after, per_page: 50, orderby: "date", order: "desc" };
        call([{ m: "GET", path: "/orders" + L.query(q) }]).then(function (res) {
          cache.orders = (Array.isArray(res[0]) ? res[0] : []).map(W.normOrder).filter(Boolean);
          draw();
        }, function (e) { status.textContent = errText(e); status.classList.add("warn"); });
      }
      sel.addEventListener("change", function () { cache.ost = sel.value; cache.orders = null; load(); });
      var r = el("div", "fld-row");
      r.appendChild(api.field(t("ord"), sel, "st-shop-ost"));
      var lb = el("div", "fld");
      lb.appendChild(button(t("ordLoad"), cache.orders ? "" : "primary", load));
      r.appendChild(lb);
      pane.appendChild(r);
      pane.appendChild(status);
      if (!cache.orders) return;
      status.textContent = t("ordDays");
      if (!cache.orders.length) { pane.appendChild(el("p", "hint", t("ordNone"))); return; }
      var list = el("ul", "vlist shop-list");
      cache.orders.forEach(function (o) { list.appendChild(orderRow(o)); });
      pane.appendChild(list);
    }
    function orderRow(o) {
      var li = el("li", "shop-row");
      var who = o.bill.company || o.bill.name || o.bill.email || "—";
      li.appendChild(el("div", "shop-name", "#" + o.no + " · " + who));
      li.appendChild(el("div", "hint", [when(o.at), moneyIn(o.total, o.cur), t("st_" + o.st), o.pay].filter(Boolean).join(" · ")));
      var lines = o.lines.map(function (l) { return l.q + " × " + l.name + (l.sku ? " (" + l.sku + ")" : ""); });
      if (o.ship) lines.push(t("shipping") + ": " + moneyIn(o.ship, o.cur));
      li.appendChild(el("div", "notes", lines.join("\n")));
      if (o.note) li.appendChild(el("div", "notes hint", o.note));
      var a = el("div", "dlg-actions tight wrap");
      var src = "woo:" + cache.acct + "-" + o.id;
      var used = api.srcUses(src);
      a.appendChild(button(used ? "✓ " + t("recorded") : t("recSale"), used ? "" : "primary", function () {
        var out = W.outRequest(o, cache.acct, codeFor);
        if (out.nocode.length) api.toast(t("noCode", { list: out.nocode.slice(0, 5).join(", ") }));
        dlg.close();
        api.openOut(out.req);
      }));
      var P = window.parent;
      if (P && typeof P.__orosOpenAt === "function") {
        a.appendChild(button(t("invoice"), "", function () { P.__orosOpenAt("invoices", { "new": W.invoicePrefill(o, cache.acct, BASE) }); }));
        var log = W.crmLog(o, BASE, moneyIn(o.total, o.cur));
        if (log) a.appendChild(button(t("crm"), "", function () { P.__orosOpenAt("crm", { log: log }); }));
      }
      var bud = W.budgetPrefill(o, BASE);
      if (bud && P && typeof P.__orosOpenBudgetNew === "function") {
        a.appendChild(button(t("budget"), "", function () { P.__orosOpenBudgetNew(bud); }));
      }
      if (o.st !== "completed" && o.st !== "cancelled" && o.st !== "refunded" && o.st !== "failed") {
        a.appendChild(button(t("complete"), "", function () {
          api.confirm(t("completeQ", { n: o.no }), t("yes"), false, function () {
            call([{ m: "PUT", path: "/orders/" + o.id, body: { status: "completed" } }]).then(function () {
              o.st = "completed";
              api.toast(t("completed", { n: o.no }));
              draw();
            }, function (e) { api.toast(errText(e)); });
          });
        }));
      }
      li.appendChild(a);
      return li;
    }
    // the Stock code of an order line: the product imported for it (its
    // SKU or barcode), else the line's own SKU
    function codeFor(l) {
      var it = api.byItem(L.extId("woo", cache.acct, "p", l.pid + ":" + (l.vid || 0)));
      if (it && (it.sku || it.bc)) return it.sku || it.bc;
      return l.sku;
    }

    draw();
  }

  window.OrosStockShop = { available: available, open: open };
})();
