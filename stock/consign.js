// ============================================================
// orOS Stock — consignment (stock/consign.js, v1.0.0)
// A warehouse can be a shop that sells your goods on consignment (a
// bookshop, a gallery, a deli). The rules live in core.js 1.8
// ("Consignment"); this file is the UI:
//   - settings(api, whId): on / off, the shop's discount %, a
//     reminder every n months, the name to invoice;
//   - open(api): the consignment shops with what each holds, when it
//     was last settled and whether a settlement is due;
//   - settle(api, whId): what is left on the shop's shelf, per
//     product → one "out" movement for what was sold (and, if asked,
//     a transfer of the rest back to the main warehouse), then
//     Invoices opens prefilled (BR-INV-NEW) at the shop's discount.
// Nothing is written before Save. Names are shown with textContent.
// Loaded by stock/index.html before stock.js, which calls
// window.OrosStockConsign.open / settings / settle with its helpers.
// ============================================================
(function () {
  "use strict";

  var STR = {
    en: {
      "cons.title": "Consignment", "cons.tile": "Consignment", "cons.link": "Consignment…",
      "cons.hint": "Shops that sell your goods and pay you for what sold. Send stock with a Transfer; when the shop tells you what is left, settle: the difference is recorded as sold and Invoices opens with the lines at the shop's discount.",
      "cons.none": "No consignment shops yet. In Settings › Warehouses, add the shop as a warehouse and choose Consignment… next to it.",
      "cons.on": "This warehouse is a shop that sells on consignment",
      "cons.disc": "Shop's discount (%)", "cons.every": "Remind me to settle every (months, 0 = never)",
      "cons.who": "Invoice to (empty = the warehouse's name)",
      "cons.badDisc": "The discount is a whole number from 0 to 90.", "cons.badEvery": "Months are a whole number from 0 to 24.",
      "cons.holds": "{n} products · {q} pieces there", "cons.empty": "Nothing there now",
      "cons.last": "Last settled {d}", "cons.never": "Not settled yet",
      "cons.due": "Settlement due since {d}", "cons.dueN": "{n} due",
      "cons.settle": "Settle…", "cons.setTitle": "Settle with {w}",
      "cons.setHint": "Type what is still on the shop's shelf. The rest was sold.",
      "cons.there": "There: {q}", "cons.left": "Left on the shelf", "cons.day": "Day",
      "cons.back": "Bring what is left back to {w}",
      "cons.sum": "Sold: {n} pieces · {v} at sale price · {s} after the shop's {d}%",
      "cons.sumNone": "Nothing sold yet: lower a quantity left on the shelf.",
      "cons.badQty": "Check the quantities: none can be more than what is there.",
      "cons.locked": "The books are closed through {d}.",
      "cons.save": "Record", "cons.saved": "Sale recorded in {w}", "cons.backDone": "What was left is back in {w}",
      "cons.invoice": "Make the invoice", "cons.nothing": "Nothing was sold and nothing came back.",
      "cons.ref": "Consignment", "cons.close": "Close", "cons.cancel": "Cancel", "cons.saveSet": "Save",
      "cons.tooMany": "The invoice takes the first 50 products; add the rest by hand."
    },
    el: {
      "cons.title": "Παρακαταθήκες", "cons.tile": "Παρακαταθήκες", "cons.link": "Παρακαταθήκη…",
      "cons.hint": "Καταστήματα που πουλάνε τα προϊόντα σου και σε πληρώνουν για όσα πούλησαν. Στέλνεις απόθεμα με Μεταφορά· όταν το κατάστημα σου πει τι έμεινε, κάνεις εκκαθάριση: η διαφορά καταγράφεται ως πώληση και ανοίγει το Τιμολόγιο με τις γραμμές στην έκπτωση του καταστήματος.",
      "cons.none": "Δεν υπάρχουν ακόμα καταστήματα με παρακαταθήκη. Στις Ρυθμίσεις › Αποθήκες, πρόσθεσε το κατάστημα ως αποθήκη και διάλεξε Παρακαταθήκη… δίπλα του.",
      "cons.on": "Αυτή η αποθήκη είναι κατάστημα που πουλά με παρακαταθήκη",
      "cons.disc": "Έκπτωση καταστήματος (%)", "cons.every": "Υπενθύμιση εκκαθάρισης κάθε (μήνες, 0 = ποτέ)",
      "cons.who": "Τιμολόγηση σε (κενό = το όνομα της αποθήκης)",
      "cons.badDisc": "Η έκπτωση είναι ακέραιος από 0 έως 90.", "cons.badEvery": "Οι μήνες είναι ακέραιος από 0 έως 24.",
      "cons.holds": "{n} προϊόντα · {q} τεμάχια εκεί", "cons.empty": "Τίποτα εκεί τώρα",
      "cons.last": "Τελευταία εκκαθάριση {d}", "cons.never": "Χωρίς εκκαθάριση ακόμα",
      "cons.due": "Εκκρεμεί εκκαθάριση από {d}", "cons.dueN": "{n} για εκκαθάριση",
      "cons.settle": "Εκκαθάριση…", "cons.setTitle": "Εκκαθάριση με {w}",
      "cons.setHint": "Γράψε τι υπάρχει ακόμα στο ράφι του καταστήματος. Τα υπόλοιπα πουλήθηκαν.",
      "cons.there": "Εκεί: {q}", "cons.left": "Έμειναν στο ράφι", "cons.day": "Ημέρα",
      "cons.back": "Να γυρίσουν όσα έμειναν στην {w}",
      "cons.sum": "Πουλήθηκαν: {n} τεμάχια · {v} σε τιμή πώλησης · {s} μετά την έκπτωση {d}%",
      "cons.sumNone": "Τίποτα δεν πουλήθηκε ακόμα: μείωσε μια ποσότητα στο ράφι.",
      "cons.badQty": "Έλεγξε τις ποσότητες: καμία δεν μπορεί να είναι πάνω από όσα υπάρχουν εκεί.",
      "cons.locked": "Τα βιβλία είναι κλεισμένα έως {d}.",
      "cons.save": "Καταχώριση", "cons.saved": "Η πώληση καταχωρίστηκε στο {w}", "cons.backDone": "Όσα έμειναν γύρισαν στην {w}",
      "cons.invoice": "Έκδοση τιμολογίου", "cons.nothing": "Δεν πουλήθηκε ούτε γύρισε τίποτα.",
      "cons.ref": "Παρακαταθήκη", "cons.close": "Κλείσιμο", "cons.cancel": "Ακύρωση", "cons.saveSet": "Αποθήκευση",
      "cons.tooMany": "Το τιμολόγιο παίρνει τα πρώτα 50 προϊόντα· πρόσθεσε τα υπόλοιπα με το χέρι."
    }
  };

  var api = null, LANG = "en";
  function init(a) {
    api = a;
    // orosI18n (../i18n.js): the full language code, a pack language included.
    LANG = window.orosI18n ? window.orosI18n.lang() : (a.lang === "el" ? "el" : "en");
    if (window.orosI18n && !STR[LANG]) window.orosI18n.table(STR, "stock", LANG);
  }
  function t(k, p) {
    var s = (STR[LANG] || STR.en)[k];
    if (s === undefined) s = STR.en[k] !== undefined ? STR.en[k] : k;
    Object.keys(p || {}).forEach(function (x) { s = s.split("{" + x + "}").join(String(p[x])); });
    return s;
  }
  function C() { return api.core; }
  function D() { return api.data(); }
  function el(tag, cls, txt) { return api.el(tag, cls, txt); }
  function btn(label, cls, fn) { return api.button(label, cls, fn); }
  function whRow(id) { return (D().whs || []).filter(function (w) { return w.id === id; })[0] || null; }
  function consRow(id) { return (D().cons || []).filter(function (c) { return c.id === id; })[0] || null; }
  function textIn(value, max, mode) {
    var i = el("input");
    i.type = "text";
    i.value = value;
    i.autocomplete = "off";
    if (max) i.maxLength = max;
    if (mode) i.inputMode = mode;
    return i;
  }
  function intOf(input, lo, hi) {
    var s = String(input.value || "").trim();
    if (!s) return 0;
    if (!/^\d{1,3}$/.test(s)) return null;
    var n = +s;
    return n >= lo && n <= hi ? n : null;
  }

  // ---------- Settings of one warehouse ----------
  function settings(a, w) {
    init(a);
    var wh = whRow(w);
    if (!wh) return;
    var cur = consRow(w) || { on: 0, disc: 0, every: 0, who: "" };
    var dlg = api.makeDialog("st-cons-set");
    dlg.appendChild(el("div", "dlg-title", t("cons.title") + " · " + wh.name));
    dlg.appendChild(el("p", "hint", t("cons.hint")));
    var on = api.checkRow(t("cons.on"), cur.on === 1);
    dlg.appendChild(on);
    var disc = textIn(cur.disc ? String(cur.disc) : "", 2, "numeric");
    var every = textIn(cur.every ? String(cur.every) : "", 2, "numeric");
    var who = textIn(cur.who || "", C().NAME_LEN);
    who.placeholder = wh.name;
    var box = el("div", "cons-fields");
    box.appendChild(api.field(t("cons.disc"), disc, "st-cons-disc"));
    box.appendChild(api.field(t("cons.every"), every, "st-cons-every"));
    box.appendChild(api.field(t("cons.who"), who, "st-cons-who"));
    dlg.appendChild(box);
    var cb = on.querySelector("input");
    function sync() { box.hidden = !cb.checked; }
    cb.addEventListener("change", sync);
    sync();
    var err = el("p", "err-msg");
    err.hidden = true;
    dlg.appendChild(err);
    var acts = el("div", "dlg-actions");
    acts.appendChild(btn(t("cons.cancel"), "", function () { dlg.close(); }));
    acts.appendChild(btn(t("cons.saveSet"), "primary", function () {
      var d = intOf(disc, 0, 90), e = intOf(every, 0, 24);
      if (cb.checked && d === null) { err.textContent = t("cons.badDisc"); err.hidden = false; disc.focus(); return; }
      if (cb.checked && e === null) { err.textContent = t("cons.badEvery"); err.hidden = false; every.focus(); return; }
      var row = cb.checked
        ? { id: w, on: 1, disc: d, every: e, who: C().cleanText(who.value, C().NAME_LEN, false) }
        : { id: w, on: 0, disc: cur.disc || 0, every: cur.every || 0, who: cur.who || "" };
      api.putCons(row);
      dlg.close();
      if (api.after) api.after();
    }));
    dlg.appendChild(acts);
    api.showDialog(dlg);
  }

  // ---------- The consignment shops ----------
  function piecesIn(w) {
    var have = C().qtyIn(D(), w), n = 0, q = 0;
    Object.keys(have).forEach(function (i) { if (have[i] > 0 && api.byItem(i)) { n++; q += have[i]; } });
    return { n: n, q: q };
  }
  function open(a) {
    init(a);
    var dlg = api.makeDialog("st-cons");
    dlg.appendChild(el("div", "dlg-title", t("cons.title")));
    var ul = el("ul", "vlist cons-list");
    dlg.appendChild(ul);
    function draw() {
      ul.innerHTML = "";
      var list = C().consList(D()), due = {};
      C().consDue(D(), api.todayYmd()).forEach(function (x) { due[x.wh.id] = x.due; });
      if (!list.length) ul.appendChild(el("li", "muted pad", t("cons.none")));
      list.forEach(function (r) {
        var w = r.wh.id, li = el("li", "row cons-row");
        var body = el("div", "r-body");
        body.appendChild(el("div", "r-name", r.wh.name));
        var h = piecesIn(w), last = C().lastSettle(D(), w);
        var sub = [h.n ? t("cons.holds", { n: h.n, q: api.fmtNum(h.q) }) : t("cons.empty"),
                   last ? t("cons.last", { d: api.fmtDay(last, true) }) : t("cons.never")];
        if (r.cons.disc) sub.push(r.cons.disc + "%");
        body.appendChild(el("div", "r-sub", sub.join(" · ")));
        if (due[w]) body.appendChild(el("span", "badge warn", t("cons.due", { d: api.fmtDay(due[w], true) })));
        li.appendChild(body);
        var acts = el("div", "cons-acts");
        var set = el("button", "link-btn", t("cons.link"));
        set.type = "button";
        set.addEventListener("click", function () { settings(api, w); });
        acts.appendChild(set);
        if (h.n) acts.appendChild(btn(t("cons.settle"), due[w] ? "primary" : "", function () { settle(api, w, draw); }));
        li.appendChild(acts);
        ul.appendChild(li);
      });
    }
    api.after = draw;
    draw();
    var acts = el("div", "dlg-actions");
    acts.appendChild(btn(t("cons.close"), "primary", function () { dlg.close(); }));
    dlg.appendChild(acts);
    api.showDialog(dlg);
  }

  // ---------- Settle ----------
  function settle(a, w, done) {
    init(a);
    var wh = whRow(w), cons = C().consOf(D(), w);
    if (!wh || !cons) return;
    var have = C().qtyIn(D(), w);
    var ids = Object.keys(have).filter(function (i) { return have[i] > 0 && api.byItem(i); })
      .sort(function (x, y) { return api.byItem(x).name.localeCompare(api.byItem(y).name, api.locale) || (x < y ? -1 : 1); });
    var dlg = api.makeDialog("st-cons-settle", true);
    dlg.appendChild(el("div", "dlg-title", t("cons.setTitle", { w: wh.name })));
    dlg.appendChild(el("p", "hint", t("cons.setHint")));
    var day = el("input");
    day.type = "date";
    day.value = api.todayYmd();
    day.max = C().addDays(api.todayYmd(), 1);
    dlg.appendChild(api.field(t("cons.day"), day, "st-cons-day"));
    var ul = el("ul", "vlist cons-lines");
    var inputs = {};
    ids.forEach(function (i, n) {
      var it = api.byItem(i), li = el("li", "row cons-line");
      var body = el("div", "r-body");
      body.appendChild(el("div", "r-name", it.name));
      body.appendChild(el("div", "r-sub", (it.sku ? it.sku + " · " : "") + t("cons.there", { q: api.fmtQ(have[i], it) })));
      li.appendChild(body);
      var inp = textIn(api.qtyStr(have[i], it), 14, "decimal");
      inp.id = "st-cons-q" + n;
      inp.className = "cons-q";
      inp.setAttribute("aria-label", t("cons.left") + ": " + it.name);
      inp.addEventListener("input", paint);
      inputs[i] = inp;
      li.appendChild(inp);
      ul.appendChild(li);
    });
    dlg.appendChild(ul);
    var main = api.mainWh();
    var back = api.checkRow(t("cons.back", { w: main }), false);
    dlg.appendChild(back);
    var sum = el("p", "cons-sum");
    sum.setAttribute("aria-live", "polite");
    dlg.appendChild(sum);
    var err = el("p", "err-msg");
    err.hidden = true;
    dlg.appendChild(err);

    // → { left: { id: thousandths }, bad: bool }
    function read() {
      var left = {}, bad = false;
      ids.forEach(function (i) {
        var q = api.readQty(inputs[i], api.byItem(i));
        var wrong = q === null || q > have[i];
        inputs[i].classList.toggle("bad", wrong);
        if (wrong) bad = true; else left[i] = q;
      });
      return { left: left, bad: bad };
    }
    function paint() {
      var r = read(), n = 0, v = 0;
      if (!r.bad) ids.forEach(function (i) {
        var s = have[i] - r.left[i];
        if (s > 0) { n += s; v += Math.round(s * api.byItem(i).price / 1000); }
      });
      sum.textContent = r.bad ? t("cons.badQty") : (n ? t("cons.sum", {
        n: api.fmtNum(n), v: api.money(v), s: api.money(Math.round(v * (100 - cons.disc) / 100)), d: cons.disc
      }) : t("cons.sumNone"));
      sum.classList.toggle("bad", r.bad);
    }
    paint();

    var acts = el("div", "dlg-actions");
    acts.appendChild(btn(t("cons.cancel"), "", function () { dlg.close(); }));
    acts.appendChild(btn(t("cons.save"), "primary", function () {
      var r = read(), d = day.value;
      err.hidden = true;
      if (r.bad) { err.textContent = t("cons.badQty"); err.hidden = false; return; }
      if (!C().isYmd(d)) d = api.todayYmd();
      var cl = D().close;
      if (cl && d <= cl.d) { err.textContent = t("cons.locked", { d: api.fmtDay(cl.d, true) }); err.hidden = false; return; }
      var mv = C().settleMove(D(), w, r.left, d, api.newId(), Date.now());
      var ret = null;
      if (back.querySelector("input").checked) {
        var lines = ids.filter(function (i) { return r.left[i] > 0; }).map(function (i) { return { i: i, q: r.left[i] }; });
        if (lines.length) ret = { id: api.newId(), t: "xfer", d: d, w: w, w2: "", ref: t("cons.ref"), note: "", lines: lines };
      }
      if (!mv && !ret) { err.textContent = t("cons.nothing"); err.hidden = false; return; }
      if (mv) mv.ref = t("cons.ref");
      api.addMoves([mv, ret].filter(Boolean));
      dlg.close();
      if (done) done();
      var inv = mv ? C().consInvoice(D(), w, mv) : null;
      var msg = [mv ? t("cons.saved", { w: wh.name }) : "", ret ? t("cons.backDone", { w: main }) : ""].filter(Boolean).join(" · ");
      if (inv && api.openAt()) {
        if (mv.lines.length > 50) msg += " · " + t("cons.tooMany");
        api.actionToast(msg, t("cons.invoice"), function () {
          var p = api.openAt();
          if (p) p.__orosOpenAt("invoices", { "new": inv });
        });
      } else api.toast(msg);
    }));
    dlg.appendChild(acts);
    api.showDialog(dlg);
  }

  window.OrosStockConsign = { open: open, settings: settings, settle: settle, TEXT: STR };
})();
