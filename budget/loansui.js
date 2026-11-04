// ============================================================
// orOS Budget — Loans and debts (budget/loansui.js)
// The Loans section at the end of the Plan tab, over budget/loans.js
// (pure): what you lent and borrowed, what was paid back, what is
// left, due dates. A loan is neither income nor expense; with an
// account it moves that account's balance like a transfer. `Write
// off` (lent) or `Forgiven` (borrowed) adds one entry for what was
// left (an expense or an income, without an account, since the money
// already moved) and closes the loan; Undo takes both back.
// Data: the synced collections "loan" and "lpay" (tombstones
// "loan:<id>", "lpay:<id>"). Everything the app owns comes in through
// init(api). Every user text goes in with textContent.
// ============================================================
(function (root) {
  "use strict";
  var L = root.OrosBudgetLoans;
  var A = null;
  var MAX = 100, MAX_PAY = 500;

  var S = {
    en: {
      "ln.h": "Loans and debts", "ln.new": "New loan", "ln.edit": "Edit loan",
      "ln.empty": "Money you lent to someone or borrowed from someone. It is neither income nor expense; repayments are added as they come.",
      "ln.toMe": "Owed to you", "ln.byMe": "You owe", "ln.n": "{n} open",
      "ln.kl": "I lent", "ln.kb": "I borrowed", "ln.kind": "What happened",
      "ln.person": "Who", "ln.person.ph": "A name", "ln.amount": "Amount", "ln.d": "Date", "ln.due": "Pay back by (optional)",
      "ln.acc": "Account", "ln.accNone": "No account (cash in hand, or not tracked)", "ln.note": "Note",
      "ln.lentTo": "Lent to {n}", "ln.borrowedFrom": "Borrowed from {n}",
      "ln.paidOf": "{a} of {b} paid back", "ln.left": "{a} left", "ln.dueOn": "Due {d}", "ln.late": "Overdue since {d}",
      "ln.paid": "Paid back", "ln.off": "Written off", "ln.forgiven": "Forgiven", "ln.closed": "Closed ({n})",
      "ln.pay": "Repayment", "ln.payTitle": "Repayment: {n}", "ln.payNote": "Note (optional)", "ln.pays": "Repayments so far",
      "ln.payDel": "Delete repayment of {a}, {d}", "ln.paySaved": "Repayment saved", "ln.payDeleted": "Repayment deleted",
      "ln.writeOff": "Write off what is left", "ln.forgive": "Mark as forgiven",
      "ln.offDone": "Written off: {a} added as an expense", "ln.forgDone": "Forgiven: {a} added as income",
      "ln.offEntry": "Loan to {n}, written off", "ln.forgEntry": "Loan from {n}, forgiven",
      "ln.reopen": "Open again", "ln.save": "Loan saved", "ln.del": "Delete loan", "ln.deleted": "Loan deleted",
      "ln.full": "Up to {n} loans", "ln.payFull": "Up to {n} repayments",
      "ln.needName": "Write who it is with", "ln.needDate": "Pick a date", "ln.needDue": "The due date must be on or after the date",
      "ln.ov": "Loans", "ln.ovNone": "No open loans.", "ln.ovMore": "Plan",
      "ln.plan": "Monthly installments (a bank loan)", "ln.rate": "Interest, % a year", "ln.months": "Installments (months)",
      "ln.ins": "Installment (optional)", "ln.insHint": "Empty: a fixed installment worked out from the amount, interest and months. Or type the one your bank gives.",
      "ln.needMonths": "Installments: a number of months from 1 to 600", "ln.needRate": "Interest: a yearly percentage from 0 to 100",
      "ln.inst": "Installment {a}", "ln.intPaid": "interest paid {a}", "ln.ends": "last installment {d}", "ln.never": "The installment does not cover the interest",
      "ln.sched": "Installment schedule", "ln.schedT": "Schedule: {n}", "ln.sDate": "Date", "ln.sInt": "Interest", "ln.sPrin": "Principal", "ln.sBal": "Left",
      "ln.sSum": "{n} installments to go, {i} interest in total", "ln.payInt": "{i} interest, {p} principal"
    },
    el: {
      "ln.h": "Δάνεια και χρέη", "ln.new": "Νέο δάνειο", "ln.edit": "Αλλαγή δανείου",
      "ln.empty": "Χρήματα που δάνεισες σε κάποιον ή δανείστηκες από κάποιον. Δεν είναι ούτε έσοδο ούτε έξοδο· οι επιστροφές προστίθενται όπως έρχονται.",
      "ln.toMe": "Σου χρωστάνε", "ln.byMe": "Χρωστάς", "ln.n": "{n} ανοιχτά",
      "ln.kl": "Δάνεισα", "ln.kb": "Δανείστηκα", "ln.kind": "Τι έγινε",
      "ln.person": "Με ποιον", "ln.person.ph": "Ένα όνομα", "ln.amount": "Ποσό", "ln.d": "Ημερομηνία", "ln.due": "Επιστροφή ως (προαιρετικό)",
      "ln.acc": "Λογαριασμός", "ln.accNone": "Χωρίς λογαριασμό (μετρητά στο χέρι ή δεν παρακολουθείται)", "ln.note": "Σημείωση",
      "ln.lentTo": "Δάνεισα: {n}", "ln.borrowedFrom": "Δανείστηκα από: {n}",
      "ln.paidOf": "Επιστράφηκαν {a} από {b}", "ln.left": "Μένουν {a}", "ln.dueOn": "Ως {d}", "ln.late": "Καθυστερεί από {d}",
      "ln.paid": "Επιστράφηκε", "ln.off": "Διαγράφηκε ως απώλεια", "ln.forgiven": "Χαρίστηκε", "ln.closed": "Κλεισμένα ({n})",
      "ln.pay": "Επιστροφή", "ln.payTitle": "Επιστροφή: {n}", "ln.payNote": "Σημείωση (προαιρετική)", "ln.pays": "Επιστροφές ως τώρα",
      "ln.payDel": "Διαγραφή επιστροφής {a}, {d}", "ln.paySaved": "Η επιστροφή αποθηκεύτηκε", "ln.payDeleted": "Η επιστροφή διαγράφηκε",
      "ln.writeOff": "Διαγραφή του υπολοίπου ως απώλεια", "ln.forgive": "Σημείωσε ότι χαρίστηκε",
      "ln.offDone": "Διαγράφηκε: {a} μπήκαν ως έξοδο", "ln.forgDone": "Χαρίστηκε: {a} μπήκαν ως έσοδο",
      "ln.offEntry": "Δάνειο σε {n}, απώλεια", "ln.forgEntry": "Δάνειο από {n}, χαρίστηκε",
      "ln.reopen": "Άνοιξέ το ξανά", "ln.save": "Το δάνειο αποθηκεύτηκε", "ln.del": "Διαγραφή δανείου", "ln.deleted": "Το δάνειο διαγράφηκε",
      "ln.full": "Έως {n} δάνεια", "ln.payFull": "Έως {n} επιστροφές",
      "ln.needName": "Γράψε με ποιον είναι", "ln.needDate": "Διάλεξε ημερομηνία", "ln.needDue": "Η ημερομηνία επιστροφής πρέπει να είναι ίδια ή μετά την ημερομηνία",
      "ln.ov": "Δάνεια", "ln.ovNone": "Κανένα ανοιχτό δάνειο.", "ln.ovMore": "Πλάνο",
      "ln.plan": "Μηνιαίες δόσεις (τραπεζικό δάνειο)", "ln.rate": "Επιτόκιο, % τον χρόνο", "ln.months": "Δόσεις (μήνες)",
      "ln.ins": "Δόση (προαιρετικό)", "ln.insHint": "Κενό: σταθερή δόση από το ποσό, το επιτόκιο και τους μήνες. Ή γράψε αυτή που δίνει η τράπεζα.",
      "ln.needMonths": "Δόσεις: αριθμός μηνών από 1 ως 600", "ln.needRate": "Επιτόκιο: ετήσιο ποσοστό από 0 ως 100",
      "ln.inst": "Δόση {a}", "ln.intPaid": "τόκοι που πληρώθηκαν {a}", "ln.ends": "τελευταία δόση {d}", "ln.never": "Η δόση δεν καλύπτει τον τόκο",
      "ln.sched": "Πρόγραμμα δόσεων", "ln.schedT": "Πρόγραμμα: {n}", "ln.sDate": "Ημερομηνία", "ln.sInt": "Τόκος", "ln.sPrin": "Κεφάλαιο", "ln.sBal": "Μένει",
      "ln.sSum": "{n} δόσεις ακόμα, {i} τόκοι συνολικά", "ln.payInt": "{i} τόκος, {p} κεφάλαιο"
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
  function loans() { return D().loan || []; }
  function pays() { return D().lpay || []; }
  function title(l) { return t(l.k === "l" ? "ln.lentTo" : "ln.borrowedFrom", { n: l.n }); }
  function stateLabel(l, st) {
    if (st.state === "off") return t(l.k === "l" ? "ln.off" : "ln.forgiven");
    if (st.state === "paid") return t("ln.paid");
    if (st.state === "late") return t("ln.late", { d: A.dateShort(l.due) });
    return l.due ? t("ln.dueOn", { d: A.dateShort(l.due) }) : "";
  }
  // Open loans first (the soonest due first), then the closed ones.
  function sorted() {
    var by = L.paysBy(pays()), today = A.today();
    return loans().map(function (l) { return { l: l, st: L.status(l, by[l.id], today) }; })
      .sort(function (x, y) {
        var ox = x.st.state === "open" || x.st.state === "late", oy = y.st.state === "open" || y.st.state === "late";
        if (ox !== oy) return ox ? -1 : 1;
        var dx = x.l.due || "9999", dy = y.l.due || "9999";
        return dx < dy ? -1 : dx > dy ? 1 : (x.l.d > y.l.d ? -1 : x.l.d < y.l.d ? 1 : (x.l.id < y.l.id ? -1 : 1));
      });
  }

  function render(box) {
    box.innerHTML = "";
    var card = el("section", "card ln-sec");
    var head = el("div", "ov-head");
    head.appendChild(el("h2", "", t("ln.h")));
    var add = el("button", "mini", t("ln.new"));
    add.type = "button";
    add.addEventListener("click", function () { dialog(null); });
    head.appendChild(add);
    card.appendChild(head);
    var all = sorted();
    if (!all.length) {
      card.appendChild(el("p", "hint", t("ln.empty")));
      box.appendChild(card);
      return;
    }
    var sum = L.summary(loans(), pays(), A.today());
    var tiles = el("div", "ln-tiles");
    [["ln.toMe", sum.toMe, sum.nToMe, "in"], ["ln.byMe", sum.byMe, sum.nByMe, "neg"]].forEach(function (z) {
      var x = el("div", "tile");
      x.appendChild(el("span", "tile-k", t(z[0])));
      x.appendChild(el("span", "tile-v" + (z[1] ? " " + z[3] : ""), A.money(z[1])));
      x.appendChild(el("span", "hint", t("ln.n", { n: z[2] })));
      tiles.appendChild(x);
    });
    card.appendChild(tiles);
    var open = all.filter(function (r) { return r.st.state === "open" || r.st.state === "late"; });
    var closed = all.filter(function (r) { return !(r.st.state === "open" || r.st.state === "late"); });
    var ul = el("ul", "ln-list");
    open.forEach(function (r) { ul.appendChild(row(r.l, r.st)); });
    card.appendChild(ul);
    if (closed.length) {
      var det = el("details", "ln-closed");
      det.appendChild(el("summary", "", t("ln.closed", { n: closed.length })));
      var ul2 = el("ul", "ln-list");
      closed.forEach(function (r) { ul2.appendChild(row(r.l, r.st)); });
      det.appendChild(ul2);
      card.appendChild(det);
    }
    box.appendChild(card);
  }
  function row(l, st) {
    var li = el("li", "ln-row " + st.state);
    li.setAttribute("data-loan", l.id);
    var top = el("div", "ln-top");
    var name = el("button", "ln-name link-btn", title(l));
    name.type = "button";
    name.addEventListener("click", function () { dialog(l.id); });
    top.appendChild(name);
    top.appendChild(el("span", "ln-amt" + (l.k === "l" ? " in" : " neg"), st.state === "open" || st.state === "late" ? t("ln.left", { a: A.money(st.left) }) : A.money(l.a)));
    li.appendChild(top);
    var bar = el("div", "bar ln-bar");
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    bar.setAttribute("aria-valuenow", String(st.pct));
    bar.setAttribute("aria-label", title(l) + ": " + t("ln.paidOf", { a: A.money(st.paid), b: A.money(l.a) }));
    var f = el("span", "bar-fill");
    f.style.width = st.pct + "%";
    bar.appendChild(f);
    li.appendChild(bar);
    var bot = el("div", "ln-bot");
    var plan = L.hasPlan(l), open = st.state === "open" || st.state === "late";
    var info = [plan ? t("ln.paidOf", { a: A.money(st.prin), b: A.money(l.a) }) : t("ln.paidOf", { a: A.money(st.paid), b: A.money(l.a) })];
    if (plan) {
      if (open) info.push(t("ln.inst", { a: A.money(L.installment(l)) }));
      if (st.int) info.push(t("ln.intPaid", { a: A.money(st.int) }));
      var sc = open ? L.schedule(l, L.paysBy(pays())[l.id]) : null;
      if (sc && sc.never) info.push(t("ln.never"));
      else if (sc && sc.end && !l.due) info.push(t("ln.ends", { d: A.dateShort(sc.end) }));
    }
    var sl = stateLabel(l, st);
    if (sl) info.push(sl);
    var acc = l.ac ? A.accName(l.ac) : "";
    if (acc) info.push(acc);
    bot.appendChild(el("span", "hint" + (st.state === "late" ? " late" : ""), info.join(" · ")));
    if (st.state === "open" || st.state === "late") {
      var pb = el("button", "mini", t("ln.pay"));
      pb.type = "button";
      pb.setAttribute("aria-label", t("ln.payTitle", { n: l.n }));
      pb.addEventListener("click", function () { payDialog(l.id); });
      bot.appendChild(pb);
      if (plan) {
        var sb = el("button", "mini", t("ln.sched"));
        sb.type = "button";
        sb.setAttribute("aria-label", t("ln.schedT", { n: l.n }));
        sb.addEventListener("click", function () { schedDialog(l.id); });
        bot.appendChild(sb);
      }
    }
    li.appendChild(bot);
    if (l.nt) li.appendChild(el("p", "hint ln-nt", l.nt));
    return li;
  }

  function accSelect(selected) {
    var sel = el("select");
    var none = el("option", "", t("ln.accNone")); none.value = ""; sel.appendChild(none);
    A.accs().forEach(function (a) { var o = el("option", "", a.n); o.value = a.id; sel.appendChild(o); });
    sel.value = selected || "";
    if (sel.value !== (selected || "")) sel.value = "";
    return sel;
  }

  function dialog(id) {
    var l = id ? A.findIn(loans(), id) : null;
    if (!l && loans().length >= MAX) { A.showToast(t("ln.full", { n: MAX })); return; }
    var dlg = A.makeDialog("bd-loan", t(l ? "ln.edit" : "ln.new"));
    var form = el("form");
    var kind = el("select");
    ["l", "b"].forEach(function (k) { var o = el("option", "", t("ln.k" + k)); o.value = k; kind.appendChild(o); });
    kind.value = l ? l.k : "l";
    form.appendChild(A.field(t("ln.kind"), kind, "ln-k"));
    var who = el("input");
    who.maxLength = 60;
    who.placeholder = t("ln.person.ph");
    who.value = l ? l.n : "";
    who.autocomplete = "off";
    // earlier names as suggestions
    var dl = el("datalist");
    dl.id = "ln-names";
    var seen = {};
    loans().forEach(function (x) { if (!seen[x.n]) { seen[x.n] = 1; var o = el("option"); o.value = x.n; dl.appendChild(o); } });
    who.setAttribute("list", "ln-names");
    form.appendChild(A.field(t("ln.person"), who, "ln-n"));
    form.appendChild(dl);
    var amt = el("input");
    amt.inputMode = "decimal";
    amt.autocomplete = "off";
    amt.value = l ? A.centsToInput(l.a) : "";
    form.appendChild(A.field(t("ln.amount") + " (" + A.cur() + ")", amt, "ln-a"));
    var r = el("div", "fld-row");
    var d = el("input"); d.type = "date"; d.value = l ? l.d : A.today();
    var due = el("input"); due.type = "date"; due.value = l ? l.due : "";
    r.appendChild(A.field(t("ln.d"), d, "ln-d"));
    r.appendChild(A.field(t("ln.due"), due, "ln-due"));
    form.appendChild(r);
    var acc = null;
    if (A.accs().length) {
      acc = accSelect(l ? l.ac : "");
      form.appendChild(A.field(t("ln.acc"), acc, "ln-ac"));
    }
    // LN-I: a bank loan in monthly installments, with interest
    var det = el("details", "ln-plan");
    det.open = !!(l && L.hasPlan(l));
    det.appendChild(el("summary", "", t("ln.plan")));
    var r2 = el("div", "fld-row");
    var rate = el("input"); rate.inputMode = "decimal"; rate.autocomplete = "off"; rate.placeholder = "0";
    rate.value = l && L.hasPlan(l) ? A.centsToInput(l.r) : "";
    var mon = el("input"); mon.inputMode = "numeric"; mon.autocomplete = "off"; mon.placeholder = "120";
    mon.value = l && L.hasPlan(l) ? String(l.nm) : "";
    r2.appendChild(A.field(t("ln.rate"), rate, "ln-r"));
    r2.appendChild(A.field(t("ln.months"), mon, "ln-nm"));
    det.appendChild(r2);
    var ins = el("input"); ins.inputMode = "decimal"; ins.autocomplete = "off";
    ins.value = l && L.hasPlan(l) && l.ins ? A.centsToInput(l.ins) : "";
    det.appendChild(A.field(t("ln.ins") + " (" + A.cur() + ")", ins, "ln-ins"));
    var insHint = el("p", "hint", t("ln.insHint"));
    det.appendChild(insHint);
    function rateOf(v) {                 // "" or "0" → 0; parseAmount refuses zero
      v = v.trim();
      if (!v || /^0+([.,]0*)?$/.test(v)) return 0;
      return A.parseAmount(v);
    }
    function preview() {
      var nm = parseInt(mon.value, 10), a0 = A.parseAmount(amt.value), rr = rateOf(rate.value);
      if (!(nm > 0 && nm <= 600) || !a0 || rr === null || ins.value.trim()) { insHint.textContent = t("ln.insHint"); return; }
      insHint.textContent = t("ln.insHint") + " " + t("ln.inst", { a: A.money(L.installment({ a: a0, nm: nm, r: rr || 0, ins: 0 })) });
    }
    [rate, mon, ins, amt].forEach(function (x) { x.addEventListener("input", preview); });
    preview();
    form.appendChild(det);
    var nt = el("input");
    nt.maxLength = 200;
    nt.value = l ? l.nt : "";
    form.appendChild(A.field(t("ln.note"), nt, "ln-nt"));
    var err = A.errLine();
    form.appendChild(err);
    var acts = el("div", "dlg-actions");
    if (l) {
      var st = L.status(l, L.paysBy(pays())[l.id], A.today());
      if (st.state === "off") acts.appendChild(A.button(t("ln.reopen"), "", function () { dlg.close(); reopen(l.id); }));
      else if (st.left) acts.appendChild(A.button(t(l.k === "l" ? "ln.writeOff" : "ln.forgive"), "", function () { dlg.close(); writeOff(l.id); }));
      acts.appendChild(A.button(t("ln.del"), "danger", function () { dlg.close(); remove(l.id); }));
    }
    acts.appendChild(A.button(A.tt("dlg.cancel"), "", function () { dlg.close(); }));
    var ok = A.button(A.tt("dlg.save"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var n = who.value.replace(/\s+/g, " ").trim();
      if (!n) { A.showErr(err, t("ln.needName"), who); return; }
      var a = A.parseAmount(amt.value);
      if (a === null) { A.showErr(err, A.tt("err.amount"), amt); return; }
      if (!L.okYmd(d.value)) { A.showErr(err, t("ln.needDate"), d); return; }
      if (due.value && (!L.okYmd(due.value) || due.value < d.value)) { A.showErr(err, t("ln.needDue"), due); return; }
      var nm = 0, rr = 0, insC = 0;
      if (mon.value.trim()) {
        nm = /^\d{1,3}$/.test(mon.value.trim()) ? parseInt(mon.value, 10) : 0;
        if (!(nm >= 1 && nm <= 600)) { det.open = true; A.showErr(err, t("ln.needMonths"), mon); return; }
        rr = rateOf(rate.value);     // "4,75" → 475 (hundredths of a percent)
        if (rr === null || rr > 10000) { det.open = true; A.showErr(err, t("ln.needRate"), rate); return; }
        insC = ins.value.trim() ? A.parseAmount(ins.value) : 0;
        if (insC === null) { det.open = true; A.showErr(err, A.tt("err.amount"), ins); return; }
      }
      var lid = l ? l.id : A.newId();
      var m = A.stamp(Math.max(l ? l.m : 0, D().tombs["loan:" + lid] || 0));
      var next = L.normLoan({ id: lid, m: m, a: a, ac: acc ? acc.value : (l ? l.ac : ""), crm: l ? l.crm : "", d: d.value,
                              due: due.value, k: kind.value, n: n, nt: nt.value, wo: l ? l.wo : false,
                              nm: nm, r: rr || 0, ins: insC || 0 });
      if (!next) { A.showErr(err, A.tt("err.amount"), amt); return; }
      D().loan = loans().filter(function (x) { return x.id !== lid; }).concat([next]);
      A.untomb("loan", lid);
      A.commit();
      A.renderAll();
      A.showToast(t("ln.save"));
      dlg.close();
    });
    dlg.appendChild(form);
    A.showDialog(dlg);
    (l ? amt : who).focus();
  }

  function payDialog(id) {
    var l = A.findIn(loans(), id);
    if (!l) return;
    var mine = L.paysBy(pays())[l.id] || [];
    var st = L.status(l, mine, A.today());
    var dlg = A.makeDialog("bd-lpay", t("ln.payTitle", { n: l.n }));
    var form = el("form");
    var plan = L.hasPlan(l);
    form.appendChild(el("p", "hint", t("ln.paidOf", { a: A.money(plan ? st.prin : st.paid), b: A.money(l.a) }) + " · " + t("ln.left", { a: A.money(st.left) })));
    var amt = el("input");
    amt.inputMode = "decimal";
    amt.autocomplete = "off";
    // LN-I: the next installment (the last one: what is left with its interest)
    var nextPay = plan ? (L.schedule(l, mine).rows[0] || null) : null;
    amt.value = nextPay ? A.centsToInput(nextPay.pay) : st.left ? A.centsToInput(st.left) : "";
    form.appendChild(A.field(t("ln.amount") + " (" + A.cur() + ")", amt, "lp-a"));
    var d = el("input"); d.type = "date"; d.value = A.today();
    form.appendChild(A.field(t("ln.d"), d, "lp-d"));
    var acc = null;
    if (A.accs().length) {
      acc = accSelect(l.ac);
      form.appendChild(A.field(t("ln.acc"), acc, "lp-ac"));
    }
    var nt = el("input");
    nt.maxLength = 80;
    form.appendChild(A.field(t("ln.payNote"), nt, "lp-n"));
    if (mine.length) {
      form.appendChild(el("h3", "sub-h", t("ln.pays")));
      var ul = el("ul", "ln-pays");
      mine.slice().reverse().forEach(function (p) {
        var li = el("li");
        li.appendChild(el("span", "", A.dateShort(p.d)));
        var spl = plan ? L.split(l, mine).rows.filter(function (x) { return x.p.id === p.id; })[0] : null;
        li.appendChild(el("span", "ln-pn", [p.n, spl && spl.int ? t("ln.payInt", { i: A.money(spl.int), p: A.money(spl.prin) }) : ""].filter(Boolean).join(" · ")));
        li.appendChild(el("span", "ln-pa", A.money(p.a)));
        var del = el("button", "icon-btn");
        del.type = "button";
        del.innerHTML = A.icon("trash");
        del.setAttribute("aria-label", t("ln.payDel", { a: A.money(p.a), d: A.dateShort(p.d) }));
        del.addEventListener("click", function () { dlg.close(); removePay(p.id); });
        li.appendChild(del);
        ul.appendChild(li);
      });
      form.appendChild(ul);
    }
    var err = A.errLine();
    form.appendChild(err);
    var acts = el("div", "dlg-actions");
    acts.appendChild(A.button(A.tt("dlg.cancel"), "", function () { dlg.close(); }));
    var ok = A.button(A.tt("dlg.save"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (pays().length >= MAX_PAY * 4) { A.showErr(err, t("ln.payFull", { n: MAX_PAY * 4 }), amt); return; }
      if (mine.length >= MAX_PAY) { A.showErr(err, t("ln.payFull", { n: MAX_PAY }), amt); return; }
      var a = A.parseAmount(amt.value);
      if (a === null) { A.showErr(err, A.tt("err.amount"), amt); return; }
      if (!L.okYmd(d.value)) { A.showErr(err, t("ln.needDate"), d); return; }
      var p = L.normPay({ id: A.newId(), m: A.stamp(0), a: a, ac: acc ? acc.value : l.ac, d: d.value, l: l.id, n: nt.value });
      if (!p) { A.showErr(err, A.tt("err.amount"), amt); return; }
      D().lpay = pays().concat([p]);
      A.commit();
      A.renderAll();
      A.showToast(t("ln.paySaved"));
      dlg.close();
    });
    dlg.appendChild(form);
    A.showDialog(dlg);
    amt.focus();
    amt.select();
  }

  // LN-I: what is still to come, one row a month
  function schedDialog(id) {
    var l = A.findIn(loans(), id);
    if (!l || !L.hasPlan(l)) return;
    var sc = L.schedule(l, L.paysBy(pays())[l.id]);
    var dlg = A.makeDialog("bd-lsched", t("ln.schedT", { n: l.n }));
    dlg.classList.add("wide");
    if (sc.never) dlg.appendChild(el("p", "err", t("ln.never")));
    var tot = 0;
    sc.rows.forEach(function (r) { tot += r.int; });
    if (sc.rows.length) dlg.appendChild(el("p", "hint", t("ln.sSum", { n: sc.rows.length, i: A.money(tot) }) + " · " + t("ln.inst", { a: A.money(L.installment(l)) })));
    var wrap = el("div", "ln-sched");
    var tb = el("table", "tbl");
    var hr = el("tr");
    ["ln.sDate", "ln.sInt", "ln.sPrin", "ln.sBal"].forEach(function (k) { var th = el("th", "", t(k)); th.scope = "col"; hr.appendChild(th); });
    var th0 = el("thead"); th0.appendChild(hr); tb.appendChild(th0);
    var body = el("tbody");
    sc.rows.forEach(function (r) {
      var tr = el("tr");
      [A.dateShort(r.d), A.money(r.int), A.money(r.prin), A.money(r.bal)].forEach(function (v, i) { tr.appendChild(el(i ? "td" : "th", i ? "num" : "", v)); });
      body.appendChild(tr);
    });
    tb.appendChild(body);
    wrap.appendChild(tb);
    dlg.appendChild(wrap);
    var acts = el("div", "dlg-actions");
    acts.appendChild(A.button(A.tt("dlg.close"), "primary", function () { dlg.close(); }));
    dlg.appendChild(acts);
    A.showDialog(dlg);
  }

  function removePay(id) {
    var p = A.findIn(pays(), id);
    if (!p) return;
    D().lpay = pays().filter(function (x) { return x.id !== id; });
    A.tombstone("lpay", id);
    A.commit();
    A.renderAll();
    A.undoToast(t("ln.payDeleted"), function () {
      if (A.findIn(pays(), id)) return;
      D().lpay = pays().concat([Object.assign({}, p, { m: A.stamp(Math.max(p.m, D().tombs["lpay:" + id] || 0)) })]);
      A.untomb("lpay", id);
      A.commit();
      A.renderAll();
    });
  }

  // Deleting a loan deletes its repayments too; Undo brings all back.
  function remove(id) {
    var l = A.findIn(loans(), id);
    if (!l) return;
    var mine = pays().filter(function (p) { return p.l === id; });
    D().loan = loans().filter(function (x) { return x.id !== id; });
    D().lpay = pays().filter(function (p) { return p.l !== id; });
    A.tombstone("loan", id);
    mine.forEach(function (p) { A.tombstone("lpay", p.id); });
    A.commit();
    A.renderAll();
    A.undoToast(t("ln.deleted"), function () {
      if (A.findIn(loans(), id)) return;
      D().loan = loans().concat([Object.assign({}, l, { m: A.stamp(Math.max(l.m, D().tombs["loan:" + id] || 0)) })]);
      A.untomb("loan", id);
      mine.forEach(function (p) {
        if (A.findIn(pays(), p.id)) return;
        D().lpay = pays().concat([Object.assign({}, p, { m: A.stamp(Math.max(p.m, D().tombs["lpay:" + p.id] || 0)) })]);
        A.untomb("lpay", p.id);
      });
      A.commit();
      A.renderAll();
    });
  }

  function setWo(id, on) {
    var l = A.findIn(loans(), id);
    if (!l) return null;
    var next = Object.assign({}, l, { wo: on, m: A.stamp(l.m) });
    D().loan = loans().filter(function (x) { return x.id !== id; }).concat([next]);
    return next;
  }
  // What was left becomes one entry (no account: the money moved when
  // the loan was made) and the loan closes.
  function writeOff(id) {
    var l = A.findIn(loans(), id);
    if (!l) return;
    var st = L.status(l, L.paysBy(pays())[l.id], A.today());
    if (!st.left) return;
    var lent = l.k === "l";
    var txId = A.addEntry({ d: A.today(), a: st.left, k: lent ? "o" : "i", c: lent ? "o-other" : "i-other",
                            n: t(lent ? "ln.offEntry" : "ln.forgEntry", { n: l.n }).slice(0, 200) });
    setWo(id, true);
    A.commit();
    A.renderAll();
    A.undoToast(t(lent ? "ln.offDone" : "ln.forgDone", { a: A.money(st.left) }), function () {
      A.removeEntry(txId);
      setWo(id, false);
      A.commit();
      A.renderAll();
    });
  }
  function reopen(id) {
    if (!setWo(id, false)) return;
    A.commit();
    A.renderAll();
  }

  // The Overview card: what is owed both ways and the open loans.
  function overviewCard(card) {
    var sum = L.summary(loans(), pays(), A.today());
    var open = sorted().filter(function (r) { return r.st.state === "open" || r.st.state === "late"; });
    if (!open.length) { card.appendChild(el("p", "hint", t("ln.ovNone"))); return; }
    var tiles = el("div", "ln-tiles");
    [["ln.toMe", sum.toMe, "in"], ["ln.byMe", sum.byMe, "neg"]].forEach(function (z) {
      var x = el("div", "tile");
      x.appendChild(el("span", "tile-k", t(z[0])));
      x.appendChild(el("span", "tile-v" + (z[1] ? " " + z[2] : ""), A.money(z[1])));
      tiles.appendChild(x);
    });
    card.appendChild(tiles);
    var ul = el("ul", "ln-list");
    open.slice(0, 3).forEach(function (r) { ul.appendChild(row(r.l, r.st)); });
    card.appendChild(ul);
  }

  root.OrosBudgetLoansUI = {
    init: function (api) { A = api; },
    render: function (box) { if (A) render(box); },
    overviewCard: function (card) { if (A) overviewCard(card); },
    t: function (k, p) { return A ? t(k, p) : k; }
  };
})(typeof window !== "undefined" ? window : this);
