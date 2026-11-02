// ============================================================
// orOS Budget — Flexible budgets (budget/budgetsui.js)
// The Budgets section at the top of the Limits tab, over
// budget/budgets.js (pure): each budget with its current period, what
// is spent and left, what is left a day, and its past periods. A
// dialog makes or changes one: name, amount, how it repeats (every
// week, every month from any day, every N days, once from–to), which
// expense categories and which accounts count.
// Data: the synced collection "bgt" (tombstones "bgt:<id>"). Monthly
// limits ("bud") are not touched. Everything the app owns comes in
// through init(api). Every user text goes in with textContent.
// ============================================================
(function (root) {
  "use strict";
  var G = root.OrosBudgetBudgets;
  var A = null;
  var MAX = 30;

  var S = {
    en: {
      "bg.h": "Budgets", "bg.new": "New budget", "bg.edit": "Edit budget", "bg.empty": "A budget is an amount for a stretch of time: a week, a month from payday, a holiday. Pick which expenses count.",
      "bg.pw": "Every week", "bg.pm": "Every month", "bg.pd": "Every few days", "bg.po": "Once",
      "bg.every": "Every {n} days", "bg.monthFrom": "Every month from the {d}", "bg.weekFrom": "Every week from {w}",
      "bg.name": "Name", "bg.name.ph": "Groceries, a trip to Crete…", "bg.amount": "Amount", "bg.rep": "Repeats",
      "bg.nd": "Number of days", "bg.s": "First day", "bg.e": "Last day", "bg.cats": "Which expenses count", "bg.allCats": "All expenses",
      "bg.accs": "From which accounts", "bg.allAccs": "All accounts, and entries without one",
      "bg.of": "{a} of {b}", "bg.left": "{a} left", "bg.over": "{a} over", "bg.perDay": "{a} a day for {n} days", "bg.perDay1": "{a} for today",
      "bg.ahead": "Starts {d}", "bg.done": "Ended {d}", "bg.range": "{a} – {b}",
      "bg.hist": "Past periods", "bg.avg": "Average {a}", "bg.histTip": "{r}: {a}",
      "bg.save": "Budget saved", "bg.del": "Delete budget", "bg.deleted": "Budget deleted", "bg.full": "Up to {n} budgets",
      "bg.needName": "Give the budget a name", "bg.needCats": "Pick at least one category, or All expenses", "bg.needNd": "Pick 1 to 366 days",
      "bg.needEnd": "The last day must be on or after the first", "bg.needDate": "Pick a date",
      "bg.limits": "Monthly limits", "bg.pace": "An even pace would have spent {a} by today"
    },
    el: {
      "bg.h": "Προϋπολογισμοί", "bg.new": "Νέος προϋπολογισμός", "bg.edit": "Αλλαγή προϋπολογισμού", "bg.empty": "Ένας προϋπολογισμός είναι ένα ποσό για ένα διάστημα: μια εβδομάδα, έναν μήνα από τη μέρα της πληρωμής, τις διακοπές. Διάλεξε ποια έξοδα μετράνε.",
      "bg.pw": "Κάθε εβδομάδα", "bg.pm": "Κάθε μήνα", "bg.pd": "Κάθε λίγες μέρες", "bg.po": "Μία φορά",
      "bg.every": "Κάθε {n} μέρες", "bg.monthFrom": "Κάθε μήνα από τις {d}", "bg.weekFrom": "Κάθε εβδομάδα από {w}",
      "bg.name": "Όνομα", "bg.name.ph": "Σούπερ μάρκετ, ταξίδι στην Κρήτη…", "bg.amount": "Ποσό", "bg.rep": "Επανάληψη",
      "bg.nd": "Πόσες μέρες", "bg.s": "Πρώτη μέρα", "bg.e": "Τελευταία μέρα", "bg.cats": "Ποια έξοδα μετράνε", "bg.allCats": "Όλα τα έξοδα",
      "bg.accs": "Από ποιους λογαριασμούς", "bg.allAccs": "Όλοι οι λογαριασμοί, και κινήσεις χωρίς λογαριασμό",
      "bg.of": "{a} από {b}", "bg.left": "Μένουν {a}", "bg.over": "{a} πάνω", "bg.perDay": "{a} τη μέρα για {n} μέρες", "bg.perDay1": "{a} για σήμερα",
      "bg.ahead": "Ξεκινά {d}", "bg.done": "Έληξε {d}", "bg.range": "{a} – {b}",
      "bg.hist": "Προηγούμενες περίοδοι", "bg.avg": "Μέσος όρος {a}", "bg.histTip": "{r}: {a}",
      "bg.save": "Ο προϋπολογισμός αποθηκεύτηκε", "bg.del": "Διαγραφή προϋπολογισμού", "bg.deleted": "Ο προϋπολογισμός διαγράφηκε", "bg.full": "Έως {n} προϋπολογισμοί",
      "bg.needName": "Δώσε όνομα στον προϋπολογισμό", "bg.needCats": "Διάλεξε τουλάχιστον μία κατηγορία, ή Όλα τα έξοδα", "bg.needNd": "Διάλεξε από 1 έως 366 μέρες",
      "bg.needEnd": "Η τελευταία μέρα πρέπει να είναι ίδια ή μετά την πρώτη", "bg.needDate": "Διάλεξε ημερομηνία",
      "bg.limits": "Μηνιαία όρια", "bg.pace": "Με σταθερό ρυθμό θα είχαν ξοδευτεί {a} ως σήμερα"
    }
  };
  // orosI18n (../i18n.js): S[<pack language>] from the pack "budget".
  if (root.orosI18n) root.orosI18n.table(S, "budget", root.orosI18n.lang());

  function t(k, p) {
    var tab = S[A.lang] || S.en;
    var s = tab[k] !== undefined ? tab[k] : (S.en[k] !== undefined ? S.en[k] : k);
    if (p) Object.keys(p).forEach(function (x) { s = s.split("{" + x + "}").join(String(p[x])); });
    return s;
  }
  function el(tag, cls, text) { return A.el(tag, cls, text); }
  function D() { return A.data(); }
  // Entries with subcategories also under their main category (sc = own).
  function TX() { return A.rolledTx ? A.rolledTx() : D().tx; }
  function list() {
    return (D().bgt || []).slice().sort(function (a, b) { return a.n.localeCompare(b.n) || (a.id < b.id ? -1 : 1); });
  }
  function repLabel(b) {
    if (b.p === "o") return t("bg.po");
    if (b.p === "d") return t("bg.every", { n: b.nd });
    if (b.p === "w") return t("bg.weekFrom", { w: A.weekday(b.s) });
    return t("bg.monthFrom", { d: +b.s.slice(8, 10) });
  }
  function range(from, to) { return t("bg.range", { a: A.dateShort(from), b: A.dateShort(to) }); }

  // The budgets running today, for the Overview's Limits card.
  function current() {
    var today = A.today();
    return list().map(function (b) {
      var st = G.status(b, TX(), today);
      return st.when === "now" ? { name: b.n, col: b.col, spent: st.spent, limit: b.a } : null;
    }).filter(Boolean);
  }

  function render(box) {
    box.innerHTML = "";
    var head = el("div", "sec-head");
    head.appendChild(el("h2", "sub-h", t("bg.h")));
    var nb = el("button", "mini", t("bg.new"));
    nb.type = "button";
    nb.addEventListener("click", function () { dialog(null); });
    head.appendChild(nb);
    box.appendChild(head);
    var all = list();
    if (!all.length) { box.appendChild(el("p", "hint bg-empty", t("bg.empty"))); }
    all.forEach(function (b) { box.appendChild(card(b)); });
    box.appendChild(el("h2", "sub-h", t("bg.limits")));
  }

  function card(b) {
    var today = A.today(), st = G.status(b, TX(), today);
    var c = el("div", "lim bg");
    var h = el("div", "lim-head");
    h.appendChild(A.swatch(b.col));
    var nm = el("button", "goal-name", b.n);
    nm.type = "button";
    nm.setAttribute("aria-label", t("bg.edit") + ": " + b.n);
    nm.addEventListener("click", function () { dialog(b.id); });
    h.appendChild(nm);
    h.appendChild(el("span", "bg-rep", repLabel(b)));
    c.appendChild(h);
    c.appendChild(el("div", "lim-sub", range(st.from, st.to)));
    var bar = el("div", "bar " + st.state);
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    bar.setAttribute("aria-valuenow", String(Math.min(100, st.pct)));
    bar.setAttribute("aria-label", b.n + ": " + st.pct + "%");
    var f = el("span");
    f.style.width = Math.min(100, st.pct) + "%";
    bar.appendChild(f);
    if (st.when === "now") {
      var mark = el("i", "bg-ideal");
      mark.style.left = Math.min(100, st.ideal * 100 / b.a) + "%";
      mark.title = t("bg.pace", { a: A.money(st.ideal) });
      bar.appendChild(mark);
    }
    c.appendChild(bar);
    var sub = el("div", "lim-sub");
    sub.appendChild(el("span", "", t("bg.of", { a: A.money(st.spent), b: A.money(b.a) }) + " · " + st.pct + "%"));
    var right;
    if (st.when === "ahead") right = t("bg.ahead", { d: A.dateShort(st.from) });
    else if (st.left < 0) right = t("bg.over", { a: A.money(-st.left) });
    else if (st.when === "done") right = t("bg.done", { d: A.dateShort(st.to) }) + " · " + t("bg.left", { a: A.money(st.left) });
    else right = t("bg.left", { a: A.money(st.left) }) + " · " + (st.days > 1 ? t("bg.perDay", { a: A.money(st.perDay), n: st.days }) : t("bg.perDay1", { a: A.money(st.perDay) }));
    sub.appendChild(el("span", "lim-state " + (st.left < 0 ? "over" : st.state === "warn" ? "warn" : ""), right));
    c.appendChild(sub);
    var hist = G.history(b, TX(), today, 6);
    if (hist.length) {
      var hb = el("div", "bg-hist");
      hb.setAttribute("role", "list");
      hb.setAttribute("aria-label", t("bg.hist"));
      var max = b.a, sum = 0;
      hist.forEach(function (p) { max = Math.max(max, p.spent); sum += p.spent; });
      var cols = el("div", "bg-cols");
      var line = el("i", "bg-line");
      line.style.bottom = (b.a * 100 / max) + "%";
      cols.appendChild(line);
      hist.forEach(function (p) {
        var col = el("span", "bg-col" + (p.over ? " over" : ""));
        col.setAttribute("role", "listitem");
        var tip = t("bg.histTip", { r: range(p.from, p.to), a: A.money(p.spent) });
        col.setAttribute("aria-label", tip);
        col.title = tip;
        col.style.height = Math.max(2, p.spent * 100 / max) + "%";
        cols.appendChild(col);
      });
      hb.appendChild(cols);
      hb.appendChild(el("span", "hint", t("bg.hist") + " · " + t("bg.avg", { a: A.money(Math.round(sum / hist.length)) })));
      c.appendChild(hb);
    }
    return c;
  }

  function dialog(id) {
    var b = id ? A.findIn(D().bgt, id) : null;
    if (!b && (D().bgt || []).length >= MAX) { A.showToast(t("bg.full", { n: MAX })); return; }
    var dlg = A.makeDialog("bd-bgt", t(b ? "bg.edit" : "bg.new"));
    var form = el("form");
    var name = el("input");
    name.maxLength = 40;
    name.placeholder = t("bg.name.ph");
    name.value = b ? b.n : "";
    form.appendChild(A.field(t("bg.name"), name, "bg-n"));
    var amt = el("input");
    amt.inputMode = "decimal";
    amt.autocomplete = "off";
    amt.value = b ? A.centsToInput(b.a) : "";
    form.appendChild(A.field(t("bg.amount") + " (" + A.cur() + ")", amt, "bg-a"));
    var rep = el("select");
    ["m", "w", "d", "o"].forEach(function (p) { var o = el("option", "", t("bg.p" + p)); o.value = p; rep.appendChild(o); });
    rep.value = b ? b.p : "m";
    form.appendChild(A.field(t("bg.rep"), rep, "bg-p"));
    var nd = el("input");
    nd.type = "number"; nd.min = "1"; nd.max = "366"; nd.inputMode = "numeric";
    nd.value = b && b.nd ? String(b.nd) : "14";
    var ndF = A.field(t("bg.nd"), nd, "bg-nd");
    form.appendChild(ndF);
    var row = el("div", "fld-row");
    var s = el("input"); s.type = "date"; s.value = b ? b.s : A.today().slice(0, 8) + "01";
    var e = el("input"); e.type = "date"; e.value = b && b.e ? b.e : "";
    row.appendChild(A.field(t("bg.s"), s, "bg-s"));
    var eF = A.field(t("bg.e"), e, "bg-e");
    row.appendChild(eF);
    form.appendChild(row);
    function sync() { ndF.hidden = rep.value !== "d"; eF.hidden = rep.value !== "o"; }
    rep.addEventListener("change", sync);
    sync();
    // which expenses
    var chosen = {};
    (b ? b.cs : "").split(" ").forEach(function (x) { if (x) chosen[x] = 1; });
    var fsC = el("fieldset", "bg-pick");
    fsC.appendChild(el("legend", "dlg-lbl", t("bg.cats")));
    var allC = check(fsC, "bg-call", t("bg.allCats"), !b || !b.cs, null);
    var catBoxes = [];
    var grid = el("div", "bg-grid");
    A.cats().filter(function (c) { return c.k === "o"; }).forEach(function (c) {
      catBoxes.push({ id: c.id, cb: check(grid, "bg-c-" + c.id, c.name, !!chosen[c.id], c.col) });
    });
    fsC.appendChild(grid);
    function syncC() { catBoxes.forEach(function (x) { x.cb.disabled = allC.checked; }); grid.classList.toggle("off", allC.checked); }
    allC.addEventListener("change", syncC);
    syncC();
    form.appendChild(fsC);
    var accBoxes = [], allA = null;
    if (A.accs().length) {
      var chA = {};
      (b ? b.as : "").split(" ").forEach(function (x) { if (x) chA[x] = 1; });
      var fsA = el("fieldset", "bg-pick");
      fsA.appendChild(el("legend", "dlg-lbl", t("bg.accs")));
      allA = check(fsA, "bg-aall", t("bg.allAccs"), !b || !b.as, null);
      var ga = el("div", "bg-grid");
      A.accs().forEach(function (a) { accBoxes.push({ id: a.id, cb: check(ga, "bg-a-" + a.id, a.n, !!chA[a.id], a.col) }); });
      fsA.appendChild(ga);
      var syncA = function () { accBoxes.forEach(function (x) { x.cb.disabled = allA.checked; }); ga.classList.toggle("off", allA.checked); };
      allA.addEventListener("change", syncA);
      syncA();
      form.appendChild(fsA);
    }
    var err = A.errLine();
    form.appendChild(err);
    var acts = el("div", "dlg-actions");
    if (b) acts.appendChild(A.button(t("bg.del"), "danger", function () { remove(b.id); dlg.close(); }));
    acts.appendChild(A.button(A.tt("dlg.cancel"), "", function () { dlg.close(); }));
    var ok = A.button(A.tt("dlg.save"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var n = name.value.replace(/\s+/g, " ").trim();
      if (!n) { A.showErr(err, t("bg.needName"), name); return; }
      var a = A.parseAmount(amt.value);
      if (a === null) { A.showErr(err, A.tt("err.amount"), amt); return; }
      if (!G.okYmd(s.value)) { A.showErr(err, t("bg.needDate"), s); return; }
      var p = rep.value, ndv = 0, ev2 = "";
      if (p === "d") {
        ndv = Number(nd.value);
        if (!(Math.floor(ndv) === ndv && ndv >= 1 && ndv <= 366)) { A.showErr(err, t("bg.needNd"), nd); return; }
      }
      if (p === "o") {
        if (!G.okYmd(e.value)) { A.showErr(err, t("bg.needDate"), e); return; }
        if (e.value < s.value) { A.showErr(err, t("bg.needEnd"), e); return; }
        ev2 = e.value;
      }
      var cs = allC.checked ? "" : catBoxes.filter(function (x) { return x.cb.checked; }).map(function (x) { return x.id; }).join(" ");
      if (!allC.checked && !cs) { A.showErr(err, t("bg.needCats"), allC); return; }
      var as = !allA || allA.checked ? "" : accBoxes.filter(function (x) { return x.cb.checked; }).map(function (x) { return x.id; }).join(" ");
      var bid = b ? b.id : A.newId();
      var m = A.stamp(Math.max(b ? b.m : 0, D().tombs["bgt:" + bid] || 0));
      var next = G.norm({ id: bid, m: m, a: a, as: as, col: b ? b.col : (D().bgt || []).length % 8, cs: cs, e: ev2, n: n, nd: ndv, p: p, s: s.value });
      if (!next) { A.showErr(err, A.tt("err.amount"), amt); return; }
      D().bgt = (D().bgt || []).filter(function (x) { return x.id !== bid; }).concat([next]);
      A.untomb("bgt", bid);
      A.commit();
      A.renderAll();
      A.showToast(t("bg.save"));
      dlg.close();
    });
    dlg.appendChild(form);
    A.showDialog(dlg);
    name.focus();
  }
  function check(parent, id, label, on, col) {
    var w = el("label", "bg-chk");
    var cb = el("input");
    cb.type = "checkbox";
    cb.id = id;
    cb.checked = on;
    w.appendChild(cb);
    if (col !== null) w.appendChild(A.swatch(col));
    w.appendChild(el("span", "", label));
    parent.appendChild(w);
    return cb;
  }

  function remove(id) {
    var b = A.findIn(D().bgt || [], id);
    if (!b) return;
    D().bgt = D().bgt.filter(function (x) { return x.id !== id; });
    A.tombstone("bgt", id);
    A.commit();
    A.renderAll();
    A.undoToast(t("bg.deleted"), function () {
      if (A.findIn(D().bgt, id)) return;
      var back = Object.assign({}, b, { m: A.stamp(Math.max(b.m, D().tombs["bgt:" + id] || 0)) });
      D().bgt = D().bgt.concat([back]);
      A.untomb("bgt", id);
      A.commit();
      A.renderAll();
    });
  }

  root.OrosBudgetBudgetsUI = {
    init: function (api) { A = api; },
    render: function (box) { if (A) render(box); },
    current: function () { return A ? current() : []; },
    t: function (k, p) { return A ? t(k, p) : k; }
  };
})(typeof window !== "undefined" ? window : this);
