// ============================================================
// orOS Stock — the point of sale (stock/pos.js, v1.0.0, wave 46)
// A till screen on top of Stock: product grid with search, categories
// and barcode (scanner or camera), a cart, price lists (retail, plus
// any the user adds, e.g. wholesale), payment method, cash change, a
// receipt printed on 58 or 80 mm roll paper, and the day's Z report.
// Every sale is one "sales" row plus one "out" movement (src
// "pos:<sale id>"): both are union-merged by id, so two registers that
// sell at the same time never lose a sale through sync. Rules live in
// pos-core.js (pure) and core.js (normSale / normPl / normZ).
// Loaded by stock/index.html after pos-core.js; stock.js calls
// window.OrosStockPos.open(api). Everything shown is textContent;
// the printed receipt / Z report escape every text (api.esc).
// ============================================================
(function () {
  "use strict";

  var P = window.OrosStockPosCore;

  var STR = {
    en: {
      title: "Point of sale", pl: "Price list", retail: "Retail", wh: "Warehouse",
      zrep: "Z report", lists: "Price lists", setup: "Receipt settings", close: "Close",
      ph: "Scan or search a product", all: "All", none: "No products match.", more: "Showing {n} of {t}. Type to narrow.",
      left: "{q} left", noPrice: "no price",
      cart: "Sale", empty: "Tap a product or scan a barcode.", unknown: "No product with the code \"{c}\".",
      net: "Net", vat: "VAT", total: "Total",
      pay: "Payment", cash: "Cash", card: "Card", other: "Other",
      given: "Cash given", change: "Change: {c}", short: "{c} short",
      clear: "Clear", clearQ: "Clear this sale?", charge: "Charge {t}",
      sold: "Sale {n} · {t}", receipt: "Receipt", qty: "Quantity", remove: "Remove", less: "One less", moreOne: "One more",
      neg: "{n} would go below zero ({q}).", negBlocked: "Stock below zero is not allowed (Settings).", negQ: "{n} would go below zero ({q}). Sell anyway?", negOk: "Sell",
      print58: "Print 58 mm", print80: "Print 80 mm", newSale: "New sale", receiptTitle: "Receipt {n}",
      zTitle: "Z report", zDay: "Day", zSales: "Sales", zVoids: "Voided", zGross: "Total sales", zNet: "Net", zVat: "VAT",
      zByPay: "By payment", zByVat: "VAT by rate", zByPl: "By price list", zTop: "Best sellers", zList: "Receipts",
      zClose: "Close the day", zClosed: "Day closed at {t} (Z #{n}): {g}.", zAfter: "{n} sales came after the close.",
      zCloseQ: "Close {d}? The day's totals are kept as Z #{n}. You can still sell; later sales show as after the close.",
      zPrint: "Print Z report", zNone: "No sales on this day.", zFirst: "First {a} · last {b}",
      void: "Void", voidQ: "Void sale {n}? Its products go back into stock.", voided: "Sale voided", isVoid: "voided",
      reprint: "Receipt",
      plTitle: "Price lists", plHint: "Retail uses each product's sale price. Another list can change it by a percentage (−10 for wholesale) and set its own price per product.",
      plName: "Name", plPct: "± % on the sale price", plPrices: "Prices…", plAdd: "Add a price list", plNew: "Wholesale",
      plDel: "Delete", plDelQ: "Delete the price list \"{n}\"? Past sales keep their prices.", plSaved: "Price list saved",
      plFor: "Prices: {n}", plSearch: "Search products", plSale: "sale {p}", plUse: "Leave empty to use {p}.",
      plBad: "Check the price of {n}.", save: "Save", cancel: "Cancel",
      stTitle: "Receipt settings", stHead: "Receipt header (shop name, address, VAT no.)", stFoot: "Receipt footer",
      stPaper: "Paper", stDev: "Register code", stDevHint: "Two characters at the start of this device's receipt numbers.",
      stLocal: "These settings stay on this device (each register prints its own).", stSaved: "Saved",
      w: "Time", no: "No.", paid: "Paid", givenR: "Given", changeR: "Change", totalR: "TOTAL",
      notFiscal: "Not a tax receipt."
    },
    el: {
      title: "Σημείο πώλησης (POS)", pl: "Τιμοκατάλογος", retail: "Λιανική", wh: "Αποθήκη",
      zrep: "Αναφορά Ζ", lists: "Τιμοκατάλογοι", setup: "Ρυθμίσεις απόδειξης", close: "Κλείσιμο",
      ph: "Σάρωση ή αναζήτηση προϊόντος", all: "Όλα", none: "Κανένα προϊόν δεν ταιριάζει.", more: "Φαίνονται {n} από {t}. Γράψε για να περιορίσεις.",
      left: "απομένουν {q}", noPrice: "χωρίς τιμή",
      cart: "Πώληση", empty: "Πάτα ένα προϊόν ή σάρωσε barcode.", unknown: "Δεν υπάρχει προϊόν με κωδικό «{c}».",
      net: "Καθαρή αξία", vat: "ΦΠΑ", total: "Σύνολο",
      pay: "Πληρωμή", cash: "Μετρητά", card: "Κάρτα", other: "Άλλο",
      given: "Δόθηκαν μετρητά", change: "Ρέστα: {c}", short: "Λείπουν {c}",
      clear: "Καθαρισμός", clearQ: "Να καθαριστεί η πώληση;", charge: "Χρέωση {t}",
      sold: "Πώληση {n} · {t}", receipt: "Απόδειξη", qty: "Ποσότητα", remove: "Αφαίρεση", less: "Ένα λιγότερο", moreOne: "Ένα ακόμα",
      neg: "Το «{n}» θα πέσει κάτω από το μηδέν ({q}).", negBlocked: "Δεν επιτρέπεται απόθεμα κάτω από το μηδέν (Ρυθμίσεις).", negQ: "Το «{n}» θα πέσει κάτω από το μηδέν ({q}). Να γίνει η πώληση;", negOk: "Πώληση",
      print58: "Εκτύπωση 58 mm", print80: "Εκτύπωση 80 mm", newSale: "Νέα πώληση", receiptTitle: "Απόδειξη {n}",
      zTitle: "Αναφορά Ζ", zDay: "Ημέρα", zSales: "Πωλήσεις", zVoids: "Ακυρωμένες", zGross: "Σύνολο πωλήσεων", zNet: "Καθαρή αξία", zVat: "ΦΠΑ",
      zByPay: "Ανά τρόπο πληρωμής", zByVat: "ΦΠΑ ανά συντελεστή", zByPl: "Ανά τιμοκατάλογο", zTop: "Τα πιο πουλημένα", zList: "Αποδείξεις",
      zClose: "Κλείσιμο ημέρας", zClosed: "Η ημέρα έκλεισε στις {t} (Ζ #{n}): {g}.", zAfter: "{n} πωλήσεις έγιναν μετά το κλείσιμο.",
      zCloseQ: "Να κλείσει η {d}; Τα σύνολα της ημέρας κρατιούνται ως Ζ #{n}. Μπορείς να συνεχίσεις να πουλάς· οι επόμενες πωλήσεις φαίνονται ως μετά το κλείσιμο.",
      zPrint: "Εκτύπωση αναφοράς Ζ", zNone: "Καμία πώληση αυτή την ημέρα.", zFirst: "Πρώτη {a} · τελευταία {b}",
      void: "Ακύρωση", voidQ: "Ακύρωση της πώλησης {n}; Τα προϊόντα της επιστρέφουν στο απόθεμα.", voided: "Η πώληση ακυρώθηκε", isVoid: "ακυρωμένη",
      reprint: "Απόδειξη",
      plTitle: "Τιμοκατάλογοι", plHint: "Η λιανική χρησιμοποιεί την τιμή πώλησης κάθε προϊόντος. Ένας άλλος τιμοκατάλογος την αλλάζει κατά ένα ποσοστό (−10 για χονδρική) και μπορεί να έχει δική του τιμή ανά προϊόν.",
      plName: "Όνομα", plPct: "± % στην τιμή πώλησης", plPrices: "Τιμές…", plAdd: "Νέος τιμοκατάλογος", plNew: "Χονδρική",
      plDel: "Διαγραφή", plDelQ: "Διαγραφή του τιμοκαταλόγου «{n}»; Οι παλιές πωλήσεις κρατούν τις τιμές τους.", plSaved: "Ο τιμοκατάλογος αποθηκεύτηκε",
      plFor: "Τιμές: {n}", plSearch: "Αναζήτηση προϊόντων", plSale: "πώληση {p}", plUse: "Άφησέ το κενό για {p}.",
      plBad: "Έλεγξε την τιμή του {n}.", save: "Αποθήκευση", cancel: "Άκυρο",
      stTitle: "Ρυθμίσεις απόδειξης", stHead: "Κεφαλίδα απόδειξης (επωνυμία, διεύθυνση, ΑΦΜ)", stFoot: "Υποσέλιδο απόδειξης",
      stPaper: "Χαρτί", stDev: "Κωδικός ταμείου", stDevHint: "Δύο χαρακτήρες στην αρχή των αριθμών απόδειξης αυτής της συσκευής.",
      stLocal: "Οι ρυθμίσεις μένουν σε αυτή τη συσκευή (κάθε ταμείο τυπώνει τις δικές του).", stSaved: "Αποθηκεύτηκε",
      w: "Ώρα", no: "Αρ.", paid: "Πληρωμή", givenR: "Δόθηκαν", changeR: "Ρέστα", totalR: "ΣΥΝΟΛΟ",
      notFiscal: "Δεν είναι φορολογική απόδειξη."
    }
  };

  var api = null, LANG = "en", cart = [], payMode = "cash";
  function t(k, p) {
    var s = (STR[LANG] || STR.en)[k];
    if (s === undefined) s = STR.en[k] !== undefined ? STR.en[k] : k;
    Object.keys(p || {}).forEach(function (x) { s = s.split("{" + x + "}").join(String(p[x])); });
    return s;
  }
  function D() { return api.data(); }
  function el(tag, cls, txt) { return api.el(tag, cls, txt); }
  function btn(label, cls, fn) { return api.button(label, cls, fn); }
  function byItem(id) { return api.byItem(id); }
  function gross(p, vat) { return Math.round(p * (100 + (vat || 0)) / 100); }
  function hm(ms) { var d = new Date(ms), z = function (n) { return (n < 10 ? "0" : "") + n; }; return z(d.getHours()) + ":" + z(d.getMinutes()); }
  function prefs() { return api.posPrefs(); }
  function plLabel(id) {
    if (!id) return t("retail");
    var pl = (D().pls || []).filter(function (x) { return x.id === id; })[0];
    return pl ? pl.name : t("retail");
  }

  // ---------- The till ----------
  function open(a) {
    api = a;
    LANG = a.lang === "el" ? "el" : "en";
    var pp = prefs();
    var dlg = api.makeDialog("st-pos", true);
    dlg.classList.add("pos-dlg");

    var top = el("div", "pos-top");
    top.appendChild(el("div", "dlg-title pos-title", "🧾 " + t("title")));
    var plSel = el("select", "pos-pl");
    plSel.setAttribute("aria-label", t("pl"));
    plSel.id = "st-pos-pl";
    function fillPl() {
      plSel.innerHTML = "";
      [["", t("retail")]].concat((D().pls || []).map(function (x) { return [x.id, x.name]; })).forEach(function (o) {
        var op = el("option", "", o[1]);
        op.value = o[0];
        plSel.appendChild(op);
      });
      var want = prefs().pl || "";
      plSel.value = (D().pls || []).some(function (x) { return x.id === want; }) ? want : "";
    }
    fillPl();
    plSel.addEventListener("change", function () { api.setPosPref("pl", plSel.value); cart.forEach(function (l) { delete l.p; }); paint(); });
    top.appendChild(plSel);
    var whSel = null;
    if (api.multiWh()) {
      whSel = api.whSelect(api.defWh());
      whSel.className = "pos-wh";
      whSel.setAttribute("aria-label", t("wh"));
      whSel.addEventListener("change", function () { api.setWh(whSel.value); paint(); });
      top.appendChild(whSel);
    }
    var tools = el("div", "pos-tools");
    tools.appendChild(btn(t("zrep"), "", function () { zDialog(api.todayYmd()); }));
    tools.appendChild(btn(t("lists"), "", function () { plDialog(function () { fillPl(); paint(); }); }));
    tools.appendChild(btn(t("setup"), "", setupDialog));
    tools.appendChild(btn(t("close"), "", function () { dlg.close(); }));
    top.appendChild(tools);
    dlg.appendChild(top);

    var body = el("div", "pos-body");
    var left = el("section", "pos-left");
    var scan = el("input", "ctr-scan pos-scan");
    scan.type = "search";
    scan.id = "st-pos-q";
    scan.placeholder = t("ph");
    scan.autocomplete = "off";
    scan.spellcheck = false;
    scan.setAttribute("enterkeyhint", "done");
    scan.setAttribute("aria-label", t("ph"));
    left.appendChild(api.withCam(scan, true));
    var msg = el("p", "hint warn");
    msg.hidden = true;
    left.appendChild(msg);
    var chips = el("div", "chips pos-cats");
    left.appendChild(chips);
    var grid = el("div", "pos-grid");
    grid.id = "st-pos-grid";
    left.appendChild(grid);
    var note = el("p", "muted");
    left.appendChild(note);
    body.appendChild(left);

    var right = el("section", "pos-right");
    right.appendChild(el("div", "pos-h", t("cart")));
    var ul = el("ul", "rows cart pos-cart");
    ul.id = "st-pos-cart";
    right.appendChild(ul);
    var sums = el("div", "pos-sums");
    right.appendChild(sums);
    var payRow = el("div", "pos-pay");
    payRow.setAttribute("role", "radiogroup");
    payRow.setAttribute("aria-label", t("pay"));
    var payBtns = {};
    P.PAYS.forEach(function (k) {
      var b = el("button", "chip pos-paybtn", t(k));
      b.type = "button";
      b.setAttribute("role", "radio");
      b.addEventListener("click", function () { payMode = k; paint(); });
      payBtns[k] = b;
      payRow.appendChild(b);
    });
    right.appendChild(payRow);
    var givenWrap = el("div", "pos-given");
    var given = el("input");
    given.type = "text";
    given.inputMode = "decimal";
    given.autocomplete = "off";
    given.id = "st-pos-given";
    var gl = el("label", "dlg-lbl", t("given"));
    gl.htmlFor = "st-pos-given";
    givenWrap.appendChild(gl);
    givenWrap.appendChild(given);
    var chg = el("span", "pos-change");
    givenWrap.appendChild(chg);
    right.appendChild(givenWrap);
    given.addEventListener("input", paintChange);
    var acts = el("div", "dlg-actions pos-acts");
    var clearB = btn(t("clear"), "", function () {
      if (!cart.length) return;
      api.confirm(t("clearQ"), t("clear"), true, function () { cart = []; given.value = ""; paint(); scan.focus(); });
    });
    var chargeB = btn(t("charge", { t: "" }), "primary pos-charge", function () { charge(false); });
    chargeB.id = "st-pos-charge";
    acts.appendChild(clearB);
    acts.appendChild(chargeB);
    right.appendChild(acts);
    body.appendChild(right);
    dlg.appendChild(body);

    var cat = "";
    function wh() { return whSel ? whSel.value : ""; }
    function qLeft(id) { return api.qtyAt(id, wh()); }
    function priceFor(it) { return P.priceOf(D(), it, plSel.value); }
    function cartLines() {
      return cart.map(function (l) {
        var it = byItem(l.i);
        return { i: l.i, q: l.q, p: typeof l.p === "number" ? l.p : priceFor(it), vat: it ? it.vat : 0 };
      });
    }
    function add(it, q) {
      msg.hidden = true;
      for (var i = 0; i < cart.length; i++) {
        if (cart[i].i === it.id) {
          cart[i].q += q;
          if (cart[i].q <= 0) cart.splice(i, 1);
          paint();
          api.live(it.name + ": " + (cart[i] ? api.fmtQ(cart[i].q, it) : "0"));
          return;
        }
      }
      if (q <= 0) return;
      cart.push({ i: it.id, q: q });
      paint();
      api.live(it.name);
    }
    function words() { return api.core.fold(scan.value.trim()).split(" ").filter(Boolean); }
    function paintGrid() {
      var d = D();
      chips.innerHTML = "";
      var cats = api.byName((d.cats || []).filter(function (c) {
        return d.items.some(function (it) { return !it.arch && it.cat === c.id; });
      }));
      if (cats.length) {
        [{ id: "", name: t("all") }].concat(cats).forEach(function (c) {
          var b = el("button", "chip" + (cat === c.id ? " on" : ""), c.name);
          b.type = "button";
          b.setAttribute("aria-pressed", cat === c.id ? "true" : "false");
          b.addEventListener("click", function () { cat = c.id; paintGrid(); });
          chips.appendChild(b);
        });
      }
      var w = words();
      var list = api.byName(d.items.filter(function (it) {
        return !it.arch && (!cat || it.cat === cat) && api.matchItem(it, w);
      }));
      grid.innerHTML = "";
      var shown = list.slice(0, 60);
      shown.forEach(function (it) {
        var b = el("button", "pos-prod");
        b.type = "button";
        b.appendChild(el("span", "pos-pn", it.name));
        var p = priceFor(it);
        b.appendChild(el("span", "pos-pp", p ? api.money(gross(p, it.vat)) : t("noPrice")));
        var q = qLeft(it.id);
        b.appendChild(el("span", "pos-pq" + (q <= 0 ? " bad" : ""), t("left", { q: api.fmtQ(q, it) })));
        b.addEventListener("click", function () { add(it, 1000); });
        grid.appendChild(b);
      });
      if (!list.length) grid.appendChild(el("p", "muted pad", t("none")));
      note.textContent = list.length > shown.length ? t("more", { n: shown.length, t: list.length }) : "";
    }
    function paintChange() {
      var tt = P.totals(cartLines());
      if (payMode !== "cash" || !given.value.trim()) { chg.textContent = ""; chg.className = "pos-change"; return; }
      var g = api.readCents(given);
      if (g === null) { chg.textContent = ""; return; }
      var c = P.change(tt.gross, g);
      chg.textContent = c === null ? t("short", { c: api.money(tt.gross - g) }) : t("change", { c: api.money(c) });
      chg.className = "pos-change" + (c === null ? " bad" : " good");
    }
    function paint() {
      cart = cart.filter(function (l) { return byItem(l.i); });
      ul.innerHTML = "";
      if (!cart.length) ul.appendChild(el("li", "muted pad", t("empty")));
      cart.forEach(function (l) {
        var it = byItem(l.i);
        var p = typeof l.p === "number" ? l.p : priceFor(it);
        var li = el("li", "row cart-line");
        var bd = el("span", "r-body");
        bd.appendChild(el("span", "r-name", it.name));
        var sub = el("span", "r-sub");
        sub.appendChild(el("span", "", api.money(gross(p, it.vat)) + " · " + it.vat + "%"));
        bd.appendChild(sub);
        li.appendChild(bd);
        var qb = el("span", "ctr-q");
        var minus = el("button", "icon-btn ctr-btn", "−");
        minus.type = "button";
        minus.setAttribute("aria-label", t("less") + ": " + it.name);
        minus.addEventListener("click", function () { add(it, -1000); });
        var qi = el("input", "pos-qty");
        qi.type = "text";
        qi.inputMode = "decimal";
        qi.value = api.qtyStr(l.q, it);
        qi.setAttribute("aria-label", t("qty") + ": " + it.name);
        qi.addEventListener("change", function () {
          var q = api.readQty(qi, it);
          if (q === null) { qi.value = api.qtyStr(l.q, it); return; }
          l.q = q;
          if (l.q <= 0) cart = cart.filter(function (x) { return x !== l; });
          paint();
        });
        var plus = el("button", "icon-btn ctr-btn", "+");
        plus.type = "button";
        plus.setAttribute("aria-label", t("moreOne") + ": " + it.name);
        plus.addEventListener("click", function () { add(it, 1000); });
        qb.appendChild(minus);
        qb.appendChild(qi);
        qb.appendChild(plus);
        li.appendChild(qb);
        var n = P.lineNet({ q: l.q, p: p });
        li.appendChild(el("span", "r-val", api.money(n + Math.round(n * it.vat / 100))));
        ul.appendChild(li);
      });
      var tt = P.totals(cartLines());
      sums.innerHTML = "";
      function sr(k, v, cls) {
        var r = el("div", "pos-sum" + (cls ? " " + cls : ""));
        r.appendChild(el("span", "", k));
        r.appendChild(el("span", "", v));
        sums.appendChild(r);
      }
      sr(t("net"), api.money(tt.net));
      tt.byVat.forEach(function (r) { sr(t("vat") + " " + r.rate + "%", api.money(r.vat)); });
      sr(t("total"), api.money(tt.gross), "grand");
      P.PAYS.forEach(function (k) {
        payBtns[k].classList.toggle("on", payMode === k);
        payBtns[k].setAttribute("aria-checked", payMode === k ? "true" : "false");
      });
      givenWrap.hidden = payMode !== "cash";
      chargeB.textContent = t("charge", { t: api.money(tt.gross) });
      chargeB.disabled = !cart.length;
      clearB.disabled = !cart.length;
      paintChange();
      paintGrid();
    }
    scan.addEventListener("input", function () { paintGrid(); });
    scan.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      e.preventDefault();
      var q = scan.value.trim();
      if (!q) { if (cart.length && e.ctrlKey) charge(false); return; }
      var it = api.core.findByCode(D(), q);
      if (!it) {
        var w = words();
        var hits = D().items.filter(function (x) { return !x.arch && api.matchItem(x, w); });
        if (hits.length === 1) it = hits[0];
      }
      scan.value = "";
      if (it) add(it, 1000);
      else { msg.textContent = t("unknown", { c: q }); msg.hidden = false; paintGrid(); }
    });

    function charge(force) {
      if (!cart.length) return;
      var lines = cartLines();
      if (!force) {
        var neg = lines.filter(function (l) { var q0 = qLeft(l.i); return q0 - l.q < 0 && q0 - l.q < q0; })[0];
        if (neg) {
          var nit = byItem(neg.i), after = qLeft(neg.i) - neg.q;
          if (D().settings.neg === 0) { msg.textContent = t("neg", { n: nit.name, q: api.fmtQ(after, nit) }) + " " + t("negBlocked"); msg.hidden = false; return; }
          api.confirm(t("negQ", { n: nit.name, q: api.fmtQ(after, nit) }), t("negOk"), false, function () { charge(true); });
          return;
        }
      }
      var tt = P.totals(lines);
      var g = payMode === "cash" && given.value.trim() ? api.readCents(given) : null;
      var now = Date.now();
      var r = P.makeSale({
        data: D(), cart: lines.map(function (l) { return { i: l.i, q: l.q, p: l.p }; }), pl: plSel.value, pay: payMode,
        given: g !== null && g >= tt.gross ? g : undefined, w: wh(), d: api.todayYmd(), now: now, dev: prefs().dev,
        id: api.newId(), mvId: api.newId()
      });
      if (!r) return;
      var saved = api.addSale(r.sale, r.move);
      if (!saved) return;
      cart = [];
      given.value = "";
      paint();
      api.actionToast(t("sold", { n: saved.no, t: api.money(tt.gross) }), t("receipt"), function () { receiptDialog(saved.id); },
        function () { api.voidSale(saved.id); paint(); });
      receiptDialog(saved.id);
      scan.focus();
    }

    api.showDialog(dlg);
    paint();
    scan.focus();
  }

  // ---------- Receipt ----------
  function saleById(id) { return (D().sales || []).filter(function (s) { return s.id === id; })[0] || null; }
  function rowsOf(sale) {
    var pp = prefs();
    return P.receiptRows(sale, {
      head: pp.head, foot: [pp.foot, t("notFiscal")].filter(Boolean).join("\n"), money: api.money,
      qty: function (l) { return api.fmtQ(l.q, byItem(l.i) || { unit: "pcs" }, true); },
      when: api.fmtDay(sale.d, true) + " " + hm(sale.at),
      labels: { no: t("no"), net: t("net"), vat: t("vat"), total: t("totalR"), pay: t("paid"), given: t("givenR"),
                change: t("changeR"), payName: { cash: t("cash"), card: t("card"), other: t("other") } }
    });
  }
  function rollHtml(title, rows, width) {
    var w = width === 80 ? 80 : 58, inner = w === 80 ? 72 : 48, fs = w === 80 ? "9.5pt" : "8.5pt";
    var css = "@page{size:" + w + "mm auto;margin:0}html,body{margin:0;padding:0;background:#fff;color:#000}" +
      "body{width:" + inner + "mm;padding:3mm " + ((w - inner) / 2) + "mm;font:" + fs + "/1.3 'Courier New',Courier,monospace;" +
      "-webkit-print-color-adjust:exact;print-color-adjust:exact}" +
      ".r{display:flex;justify-content:space-between;gap:2mm}.r span:first-child{overflow-wrap:anywhere;min-width:0}" +
      ".r span:last-child{white-space:nowrap;text-align:right}" +
      ".head{text-align:center;font-weight:700}.head.first{font-size:1.2em}" +
      ".meta{border-top:1px dashed #000;border-bottom:1px dashed #000;margin:2mm 0;padding:1mm 0}" +
      ".item{font-weight:700;margin-top:1mm}.sub{padding-left:2mm}" +
      ".sum:first-of-type{margin-top:2mm}.total{font-weight:700;font-size:1.25em;border-top:1px dashed #000;border-bottom:1px dashed #000;margin:1mm 0;padding:1mm 0}" +
      ".foot{text-align:center;margin-top:1mm}.void{text-align:center;font-weight:700;border:1px solid #000;margin:2mm 0}";
    var firstHead = true, lastK = "";
    var body = rows.map(function (r) {
      var cls = r.k;
      if (r.k === "head" && firstHead) { cls += " first"; firstHead = false; }
      if (r.k === "sum" && lastK !== "sum") cls += " gap";
      lastK = r.k;
      if (r.k === "head" || r.k === "foot" || r.k === "void") return '<div class="' + cls + '">' + api.esc(r.l) + "</div>";
      return '<div class="r ' + cls + '"><span>' + api.esc(r.l) + "</span><span>" + api.esc(r.r) + "</span></div>";
    }).join("");
    return '<!DOCTYPE html><html lang="' + LANG + '"><head><meta charset="utf-8"><title>' + api.esc(title) +
      "</title><style>" + css + "</style></head><body>" + body + "</body></html>";
  }
  function receiptDialog(id) {
    var sale = saleById(id);
    if (!sale) return;
    var dlg = api.makeDialog("st-pos-rcpt");
    dlg.appendChild(el("div", "dlg-title", t("receiptTitle", { n: sale.no })));
    var rows = rowsOf(sale);
    if (sale.v === 1) rows.splice(1, 0, { k: "void", l: t("isVoid").toUpperCase(), r: "" });
    var paper = el("div", "pos-paper");
    rows.forEach(function (r) {
      if (r.k === "head" || r.k === "foot" || r.k === "void") { paper.appendChild(el("div", "pp-" + r.k, r.l)); return; }
      var d = el("div", "pp-r pp-" + r.k);
      d.appendChild(el("span", "", r.l));
      d.appendChild(el("span", "", r.r));
      paper.appendChild(d);
    });
    dlg.appendChild(paper);
    var acts = el("div", "dlg-actions wrap");
    var pw = prefs().paper === 80 ? 80 : 58;
    acts.appendChild(btn(t(pw === 80 ? "print80" : "print58"), "primary", function () { api.printHtml(rollHtml(t("receiptTitle", { n: sale.no }), rows, pw)); }));
    acts.appendChild(btn(t(pw === 80 ? "print58" : "print80"), "", function () { api.printHtml(rollHtml(t("receiptTitle", { n: sale.no }), rows, pw === 80 ? 58 : 80)); }));
    acts.appendChild(btn(t("newSale"), "", function () { dlg.close(); }));
    dlg.appendChild(acts);
    api.showDialog(dlg);
    acts.firstChild.focus();
  }

  // ---------- Z report ----------
  function zDialog(day) {
    var dlg = api.makeDialog("st-pos-z", true);
    dlg.appendChild(el("div", "dlg-title", "📊 " + t("zTitle")));
    var dIn = el("input");
    dIn.type = "date";
    dIn.value = day;
    dlg.appendChild(api.field(t("zDay"), dIn, "st-pos-zday"));
    var box = el("div", "pos-z");
    dlg.appendChild(box);
    var acts = el("div", "dlg-actions wrap");
    var printB = btn(t("zPrint"), "", function () { var rep = P.zReport(D(), dIn.value); api.printHtml(rollHtml(t("zTitle") + " " + rep.d, zRows(rep), prefs().paper === 80 ? 80 : 58)); });
    var closeB = btn(t("zClose"), "primary", function () {
      var rep = P.zReport(D(), dIn.value), no = rep.z ? rep.z.no : P.nextZ(D());
      api.confirm(t("zCloseQ", { d: api.fmtDay(rep.d, true), n: no }), t("zClose"), false, function () {
        api.putZ(P.zRow(rep, Date.now(), no));
        paint();
      });
    });
    acts.appendChild(printB);
    acts.appendChild(closeB);
    acts.appendChild(btn(t("close"), "", function () { dlg.close(); }));
    dlg.appendChild(acts);
    dIn.addEventListener("change", function () { if (api.core.isYmd(dIn.value)) paint(); });
    function kv(parent, k, v, cls) {
      var r = el("div", "pos-sum" + (cls ? " " + cls : ""));
      r.appendChild(el("span", "", k));
      r.appendChild(el("span", "", v));
      parent.appendChild(r);
    }
    function paint() {
      var rep = P.zReport(D(), dIn.value);
      box.innerHTML = "";
      printB.disabled = !rep.n && !rep.voids;
      closeB.disabled = !rep.n;
      closeB.hidden = !!rep.z && !rep.after;
      if (rep.z) {
        box.appendChild(el("p", "hint", t("zClosed", { t: hm(rep.z.at), n: rep.z.no, g: api.money(rep.z.g) })));
        if (rep.after) box.appendChild(el("p", "hint warn", t("zAfter", { n: rep.after })));
      }
      if (!rep.n && !rep.voids) { box.appendChild(el("p", "muted pad", t("zNone"))); return; }
      kv(box, t("zSales"), String(rep.n));
      if (rep.voids) kv(box, t("zVoids"), String(rep.voids));
      kv(box, t("zNet"), api.money(rep.net));
      kv(box, t("zVat"), api.money(rep.vat));
      kv(box, t("zGross"), api.money(rep.g), "grand");
      if (rep.first) box.appendChild(el("p", "muted", t("zFirst", { a: hm(rep.first), b: hm(rep.last) })));
      box.appendChild(el("div", "pos-h", t("zByPay")));
      P.PAYS.forEach(function (k) { if (rep.byPay[k]) kv(box, t(k), api.money(rep.byPay[k])); });
      box.appendChild(el("div", "pos-h", t("zByVat")));
      rep.byVat.forEach(function (r) { kv(box, r.rate + "%", api.money(r.net) + " + " + api.money(r.vat)); });
      var pls = Object.keys(rep.byPl);
      if (pls.length > 1 || (pls.length === 1 && pls[0])) {
        box.appendChild(el("div", "pos-h", t("zByPl")));
        pls.forEach(function (k) { kv(box, plLabel(k), api.money(rep.byPl[k])); });
      }
      if (rep.top.length) {
        box.appendChild(el("div", "pos-h", t("zTop")));
        rep.top.forEach(function (x) { var it = byItem(x.i); kv(box, x.n + " × " + api.fmtQ(x.q, it || { unit: "pcs" }, true), api.money(x.g)); });
      }
      box.appendChild(el("div", "pos-h", t("zList")));
      var ul = el("ul", "rows pos-sales");
      P.daySales(D(), rep.d).slice().reverse().forEach(function (s) {
        var tt = P.totals(s.lines);
        var li = el("li", "row" + (s.v === 1 ? " voided" : ""));
        var bd = el("span", "r-body");
        bd.appendChild(el("span", "r-name", s.no));
        bd.appendChild(el("span", "r-sub", hm(s.at) + " · " + t(s.pay) + (s.pl ? " · " + plLabel(s.pl) : "") + (s.v === 1 ? " · " + t("isVoid") : "")));
        li.appendChild(bd);
        li.appendChild(el("span", "r-val", api.money(tt.gross)));
        var ra = el("span", "pos-sale-acts");
        ra.appendChild(btn(t("reprint"), "", function () { receiptDialog(s.id); }));
        if (s.v !== 1) ra.appendChild(btn(t("void"), "danger", function () {
          api.confirm(t("voidQ", { n: s.no }), t("void"), true, function () { api.voidSale(s.id); api.toast(t("voided")); paint(); });
        }));
        li.appendChild(ra);
        ul.appendChild(li);
      });
      box.appendChild(ul);
    }
    api.showDialog(dlg);
    paint();
  }
  function zRows(rep) {
    var pp = prefs(), m = api.money, rows = [];
    String(pp.head || "").split("\n").map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 8)
      .forEach(function (s) { rows.push({ k: "head", l: s, r: "" }); });
    rows.push({ k: "head", l: t("zTitle") + (rep.z ? " #" + rep.z.no : ""), r: "" });
    rows.push({ k: "meta", l: api.fmtDay(rep.d, true), r: rep.first ? hm(rep.first) + "–" + hm(rep.last) : "" });
    rows.push({ k: "sum", l: t("zSales"), r: String(rep.n) });
    if (rep.voids) rows.push({ k: "sum", l: t("zVoids"), r: String(rep.voids) });
    rep.byVat.forEach(function (r) {
      rows.push({ k: "sum", l: t("net") + " " + r.rate + "%", r: m(r.net) });
      rows.push({ k: "sum", l: t("vat") + " " + r.rate + "%", r: m(r.vat) });
    });
    rows.push({ k: "total", l: t("totalR"), r: m(rep.g) });
    P.PAYS.forEach(function (k) { if (rep.byPay[k]) rows.push({ k: "sum", l: t(k), r: m(rep.byPay[k]) }); });
    if (rep.z && rep.after) rows.push({ k: "foot", l: t("zAfter", { n: rep.after }), r: "" });
    rows.push({ k: "foot", l: t("notFiscal"), r: "" });
    return rows;
  }

  // ---------- Price lists ----------
  function plDialog(onDone) {
    var dlg = api.makeDialog("st-pos-pl", true);
    dlg.appendChild(el("div", "dlg-title", t("plTitle")));
    dlg.appendChild(el("p", "dlg-sub", t("plHint")));
    var box = el("div", "pos-pls");
    dlg.appendChild(box);
    function paint() {
      box.innerHTML = "";
      (D().pls || []).forEach(function (pl) {
        var r = el("div", "pos-plrow");
        var name = el("input");
        name.type = "text";
        name.maxLength = 80;
        name.value = pl.name;
        name.setAttribute("aria-label", t("plName"));
        var pct = el("input", "pos-pct");
        pct.type = "text";
        pct.inputMode = "numeric";
        pct.value = String(pl.pct || 0);
        pct.setAttribute("aria-label", t("plPct"));
        function commit() {
          var n = name.value.trim(), pc = parseInt(String(pct.value).replace(/[^\d-]/g, ""), 10);
          if (!n) { name.value = pl.name; return; }
          if (!isFinite(pc) || pc < -90 || pc > 500) { pct.value = String(pl.pct || 0); return; }
          if (n === pl.name && pc === (pl.pct || 0)) return;
          api.putPl({ id: pl.id, m: pl.m, name: n, pct: pc, p: pl.p });
          api.toast(t("plSaved"));
          if (onDone) onDone();
        }
        name.addEventListener("change", commit);
        pct.addEventListener("change", commit);
        r.appendChild(api.field(t("plName"), name, "st-pl-n-" + pl.id));
        r.appendChild(api.field(t("plPct"), pct, "st-pl-p-" + pl.id));
        var ra = el("div", "dlg-actions tight");
        ra.appendChild(btn(t("plPrices"), "", function () { pricesDialog(pl.id, onDone); }));
        ra.appendChild(btn(t("plDel"), "danger", function () {
          api.confirm(t("plDelQ", { n: pl.name }), t("plDel"), true, function () { api.delPl(pl.id); paint(); if (onDone) onDone(); });
        }));
        r.appendChild(ra);
        box.appendChild(r);
      });
    }
    var acts = el("div", "dlg-actions");
    acts.appendChild(btn(t("plAdd"), "", function () {
      api.putPl({ id: api.newId(), m: 0, name: (D().pls || []).length ? t("plNew") + " " + ((D().pls || []).length + 1) : t("plNew"), pct: -10, p: {} });
      paint();
      if (onDone) onDone();
    }));
    acts.appendChild(btn(t("close"), "primary", function () { dlg.close(); }));
    dlg.appendChild(acts);
    api.showDialog(dlg);
    paint();
  }
  function pricesDialog(plId, onDone) {
    var pl = (D().pls || []).filter(function (x) { return x.id === plId; })[0];
    if (!pl) return;
    var dlg = api.makeDialog("st-pos-plp", true);
    dlg.appendChild(el("div", "dlg-title", t("plFor", { n: pl.name })));
    var q = el("input");
    q.type = "search";
    q.placeholder = t("plSearch");
    q.setAttribute("aria-label", t("plSearch"));
    dlg.appendChild(q);
    var list = el("div", "pick-list pos-plp");
    dlg.appendChild(list);
    var edits = {};
    var err = el("p", "hint warn");
    err.hidden = true;
    dlg.appendChild(err);
    function paint() {
      list.innerHTML = "";
      var w = api.core.fold(q.value.trim()).split(" ").filter(Boolean);
      api.byName(D().items.filter(function (it) { return !it.arch && api.matchItem(it, w); })).slice(0, 80).forEach(function (it) {
        var r = el("div", "pos-plp-row");
        var bd = el("span", "r-body");
        bd.appendChild(el("span", "r-name", it.name));
        var auto = pl.pct ? Math.max(0, Math.round(it.price * (100 + pl.pct) / 100)) : it.price;
        bd.appendChild(el("span", "r-sub", t("plSale", { p: api.money(it.price) }) + " · " + t("plUse", { p: api.money(auto) })));
        r.appendChild(bd);
        var inp = el("input", "pos-plp-in");
        inp.type = "text";
        inp.inputMode = "decimal";
        inp.setAttribute("aria-label", it.name);
        var cur = Object.prototype.hasOwnProperty.call(edits, it.id) ? edits[it.id] : (Object.prototype.hasOwnProperty.call(pl.p, it.id) ? api.centsStr(pl.p[it.id]) || "0" : "");
        inp.value = cur;
        inp.placeholder = api.centsStr(auto) || "0";
        inp.addEventListener("input", function () { edits[it.id] = inp.value; });
        r.appendChild(inp);
        list.appendChild(r);
      });
    }
    q.addEventListener("input", paint);
    var acts = el("div", "dlg-actions");
    acts.appendChild(btn(t("cancel"), "", function () { dlg.close(); }));
    acts.appendChild(btn(t("save"), "primary", function () {
      var p = JSON.parse(JSON.stringify(pl.p || {}));
      var bad = null;
      Object.keys(edits).forEach(function (id) {
        var s = String(edits[id]).trim();
        if (!s) { delete p[id]; return; }
        var c = api.readCents({ value: s });
        if (c === null) { bad = bad || id; return; }
        p[id] = c;
      });
      if (bad) { var it = byItem(bad); err.textContent = t("plBad", { n: it ? it.name : "?" }); err.hidden = false; return; }
      api.putPl({ id: pl.id, m: pl.m, name: pl.name, pct: pl.pct, p: p });
      api.toast(t("plSaved"));
      dlg.close();
      if (onDone) onDone();
    }));
    dlg.appendChild(acts);
    api.showDialog(dlg);
    paint();
    q.focus();
  }

  // ---------- Receipt settings (device-local) ----------
  function setupDialog() {
    var pp = prefs();
    var dlg = api.makeDialog("st-pos-set", true);
    dlg.appendChild(el("div", "dlg-title", t("stTitle")));
    var head = el("textarea");
    head.rows = 3;
    head.maxLength = 300;
    head.value = pp.head || "";
    dlg.appendChild(api.field(t("stHead"), head, "st-pos-head"));
    var foot = el("textarea");
    foot.rows = 2;
    foot.maxLength = 200;
    foot.value = pp.foot || "";
    dlg.appendChild(api.field(t("stFoot"), foot, "st-pos-foot"));
    var paper = api.selectInput([["58", "58 mm"], ["80", "80 mm"]], String(pp.paper === 80 ? 80 : 58));
    dlg.appendChild(api.field(t("stPaper"), paper, "st-pos-paper"));
    var dev = el("input");
    dev.type = "text";
    dev.maxLength = 2;
    dev.value = pp.dev;
    dev.autocomplete = "off";
    dlg.appendChild(api.field(t("stDev"), dev, "st-pos-dev"));
    dlg.appendChild(el("p", "dlg-sub", t("stDevHint") + " " + t("stLocal")));
    var acts = el("div", "dlg-actions");
    acts.appendChild(btn(t("cancel"), "", function () { dlg.close(); }));
    acts.appendChild(btn(t("save"), "primary", function () {
      var d = String(dev.value).toUpperCase().replace(/[^A-Z0-9]/g, "");
      api.setPosPref("head", head.value.slice(0, 300));
      api.setPosPref("foot", foot.value.slice(0, 200));
      api.setPosPref("paper", paper.value === "80" ? 80 : 58);
      if (d.length === 2) api.setPosPref("dev", d);
      api.toast(t("stSaved"));
      dlg.close();
    }));
    dlg.appendChild(acts);
    api.showDialog(dlg);
  }

  window.OrosStockPos = { open: open };
})();
