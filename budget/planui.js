// ============================================================
// orOS Budget — Plan tab, subscriptions, reports (budget/planui.js)
// The screens over budget/plan.js (pure core):
//   - Plan tab: envelopes (zero-based budgeting, optional: "To be
//     assigned", assign, move money, roll-over) and savings goals
//   - Recurring tab, "Subscriptions" view: monthly and yearly cost,
//     next charge, reminder hour (device-local)
//   - Charts tab: "Where the money goes" (a year per category per
//     month, chart + table) and net worth over 12 months
// Everything the app owns (data, writes, Undo, dialogs, charts'
// helpers) comes in through init(api); this file stores nothing
// itself except through api. Every user text goes in with
// textContent / option text.
// ============================================================
(function (root) {
  "use strict";
  var P = root.OrosBudgetPlan;
  var A = null;

  var S = {
    en: {
      env: "Envelopes", envIntro: "Zero-based budgeting: give every euro a job. Each month you share out the money that came in among your expense categories; what is left in an envelope, or overspent, moves on to the next month.",
      envStart: "Start envelope budgeting", envStop: "Stop envelope budgeting",
      envStopped: "Envelope budgeting is off. What you assigned stays, if you start again.",
      envLimits: "Your monthly limits keep working next to the envelopes.",
      envBefore: "Envelope budgeting starts in {m}.", envGo: "Go to {m}",
      tba: "To be assigned", tbaPos: "Give these to your envelopes.", tbaZero: "Every euro has a job.",
      tbaNeg: "You assigned {a} more than you have.", tbaFrom: "Income {i} · assigned {s}",
      tbaStart: "Accounts when it started {c} · income {i} · assigned {s}",
      move: "Move money", same: "Same as last month", sameDone: "Assigned like last month", sameNone: "Nothing to copy from last month",
      asg: "Assigned", spent: "Spent", avail: "Available", carry: "From last month", over: "Overspent",
      rowSub: "Assigned {a} · spent {s}", limit: "limit {a}",
      asgDlg: "Assign: {c}", asgThis: "Assigned this month", cover: "Cover the overspending", asgSaved: "Assigned",
      mvFrom: "From", mvTo: "To", mvTbaOpt: "To be assigned ({a})", mvDone: "Moved {a}", mvSame: "Pick two different places",
      uncat: "Uncategorized",
      goals: "Savings goals", goalNew: "New goal", goalEdit: "Edit goal", goalsEmpty: "A trip, a new laptop, a safety net: set a target and see how much to put aside each month.",
      gName: "Name", gName_ph: "Trip to Crete", gTarget: "Target", gDate: "By (optional)", gFrom: "Progress from",
      gManual: "What I put aside by hand", gAcc: "The balance of {a}", gSaved: "Put aside so far",
      gAdd: "Add money", gAddDlg: "Add to {g}", gAddHint: "A minus sign takes money out.", gAdded: "Updated",
      gOf: "{a} of {b}", gPer: "{a} a month until {d}", gDone: "Reached", gLate: "{a} still missing, the date has passed",
      gNoDate: "{a} to go", gDeleted: "Goal deleted", gFull: "Up to {n} goals",
      // subscriptions
      vAll: "All", vSubs: "Subscriptions", subMonth: "A month", subYear: "A year",
      subsEmpty: "No recurring expenses yet. Add one with “New recurring entry”.",
      subNext: "Next: {d}", subIn0: "today", subIn1: "tomorrow", subInN: "in {n} days",
      subPerY: "{a} a year", subBell: "Reminder {n} days before", subBell0: "Reminder on the day", subBell1: "Reminder 1 day before",
      subHour: "Reminders at", subOff: "Off on this device", subHint: "Pick “Remind me” in a recurring expense. The reminder comes at this hour on this device, while orOS is open.",
      // reports
      year: "Where the money goes, {y}", yNone: "No expenses in {y}.", yTot: "Total", yIn: "Income", yOut: "Expenses",
      yOther: "Other", yPrev: "Previous year", yNext: "Next year", yCat: "Category",
      nw: "Net worth", nwNone: "Add accounts (More › Accounts) to see your net worth: the sum of their balances at the end of each month.",
      nwNow: "Today {a}", nwMiss: "{n} account(s) left out: no exchange rate yet.",
      nwFx: "Other currencies at today's rates."
    },
    el: {
      env: "Φάκελοι", envIntro: "Προϋπολογισμός μηδενικής βάσης: κάθε ευρώ αποκτά δουλειά. Κάθε μήνα μοιράζεις όσα μπήκαν στις κατηγορίες εξόδων· ό,τι περισσεύει σε έναν φάκελο, ή ό,τι ξοδεύτηκε παραπάνω, περνά στον επόμενο μήνα.",
      envStart: "Έναρξη φακέλων", envStop: "Διακοπή φακέλων",
      envStopped: "Οι φάκελοι είναι κλειστοί. Όσα μοίρασες μένουν, αν ξεκινήσεις ξανά.",
      envLimits: "Τα μηνιαία όριά σου συνεχίζουν να ισχύουν δίπλα στους φακέλους.",
      envBefore: "Οι φάκελοι ξεκινούν τον {m}.", envGo: "Μετάβαση: {m}",
      tba: "Προς διάθεση", tbaPos: "Μοίρασέ τα στους φακέλους σου.", tbaZero: "Κάθε ευρώ έχει δουλειά.",
      tbaNeg: "Μοίρασες {a} περισσότερα από όσα έχεις.", tbaFrom: "Έσοδα {i} · μοιρασμένα {s}",
      tbaStart: "Λογαριασμοί στην αρχή {c} · έσοδα {i} · μοιρασμένα {s}",
      move: "Μεταφορά χρημάτων", same: "Όπως τον προηγούμενο μήνα", sameDone: "Μοιράστηκαν όπως τον προηγούμενο μήνα", sameNone: "Δεν υπάρχει κάτι να αντιγραφεί από τον προηγούμενο μήνα",
      asg: "Μοιρασμένα", spent: "Ξοδεμένα", avail: "Διαθέσιμα", carry: "Από τον προηγούμενο μήνα", over: "Υπέρβαση",
      rowSub: "Μοιρασμένα {a} · ξοδεμένα {s}", limit: "όριο {a}",
      asgDlg: "Μοίρασμα: {c}", asgThis: "Μοιρασμένα αυτόν τον μήνα", cover: "Κάλυψη της υπέρβασης", asgSaved: "Μοιράστηκε",
      mvFrom: "Από", mvTo: "Προς", mvTbaOpt: "Προς διάθεση ({a})", mvDone: "Μεταφέρθηκαν {a}", mvSame: "Διάλεξε δύο διαφορετικά σημεία",
      uncat: "Χωρίς κατηγορία",
      goals: "Στόχοι αποταμίευσης", goalNew: "Νέος στόχος", goalEdit: "Επεξεργασία στόχου", goalsEmpty: "Ένα ταξίδι, ένας νέος υπολογιστής, ένα αποθεματικό: βάλε έναν στόχο και δες πόσα να βάζεις στην άκρη κάθε μήνα.",
      gName: "Όνομα", gName_ph: "Ταξίδι στην Κρήτη", gTarget: "Στόχος", gDate: "Έως (προαιρετικά)", gFrom: "Η πρόοδος μετριέται από",
      gManual: "Όσα βάζω στην άκρη με το χέρι", gAcc: "Το υπόλοιπο: {a}", gSaved: "Στην άκρη μέχρι τώρα",
      gAdd: "Προσθήκη", gAddDlg: "Προσθήκη στο «{g}»", gAddHint: "Με μείον αφαιρείς χρήματα.", gAdded: "Ενημερώθηκε",
      gOf: "{a} από {b}", gPer: "{a} τον μήνα έως {d}", gDone: "Επιτεύχθηκε", gLate: "Λείπουν {a}, η ημερομηνία πέρασε",
      gNoDate: "Απομένουν {a}", gDeleted: "Ο στόχος διαγράφηκε", gFull: "Έως {n} στόχοι",
      vAll: "Όλα", vSubs: "Συνδρομές", subMonth: "Τον μήνα", subYear: "Τον χρόνο",
      subsEmpty: "Δεν υπάρχουν ακόμα πάγια έξοδα. Πρόσθεσε ένα με «Νέο πάγιο».",
      subNext: "Επόμενη: {d}", subIn0: "σήμερα", subIn1: "αύριο", subInN: "σε {n} ημέρες",
      subPerY: "{a} τον χρόνο", subBell: "Υπενθύμιση {n} ημέρες πριν", subBell0: "Υπενθύμιση την ημέρα της χρέωσης", subBell1: "Υπενθύμιση 1 ημέρα πριν",
      subHour: "Υπενθυμίσεις στις", subOff: "Όχι σε αυτή τη συσκευή", subHint: "Διάλεξε «Υπενθύμιση» σε ένα πάγιο έξοδο. Η υπενθύμιση έρχεται αυτή την ώρα σε αυτή τη συσκευή, όσο το orOS είναι ανοιχτό.",
      year: "Πού πάνε τα χρήματα, {y}", yNone: "Κανένα έξοδο το {y}.", yTot: "Σύνολο", yIn: "Έσοδα", yOut: "Έξοδα",
      yOther: "Υπόλοιπες", yPrev: "Προηγούμενο έτος", yNext: "Επόμενο έτος", yCat: "Κατηγορία",
      nw: "Καθαρή περιουσία", nwNone: "Πρόσθεσε λογαριασμούς (Περισσότερα › Λογαριασμοί) για να δεις την καθαρή σου περιουσία: το άθροισμα των υπολοίπων τους στο τέλος κάθε μήνα.",
      nwNow: "Σήμερα {a}", nwMiss: "{n} λογαριασμοί έμειναν έξω: δεν υπάρχει ακόμα ισοτιμία.",
      nwFx: "Τα άλλα νομίσματα με τις σημερινές ισοτιμίες."
    }
  };
  var MAX_GOALS = 30;
  // orosI18n (../i18n.js): S[<pack language>] from the pack "budget".
  if (root.orosI18n) root.orosI18n.table(S, "budget", root.orosI18n.lang());

  function t(k, p) {
    var tab = S[A.lang] || S.en;
    var s = tab[k] !== undefined ? tab[k] : (S.en[k] !== undefined ? S.en[k] : k);
    if (p) Object.keys(p).forEach(function (x) { s = s.split("{" + x + "}").join(String(p[x])); });
    return s;
  }
  function el(tag, cls, text) { return A.el(tag, cls, text); }
  function opt(sel, v, label) { var o = el("option", "", label); o.value = String(v); sel.appendChild(o); return o; }
  function D() { return A.data(); }
  function signedInput(c) { return (c < 0 ? "-" : "") + A.centsToInput(Math.abs(c)); }
  function liveExpenseCats() { return A.cats().filter(function (c) { return c.k === "o"; }); }
  function envName(c) { return c ? A.catName(c) : t("uncat"); }

  // ---------- Envelopes ----------
  function envOn() { var s = D().set; return s.env === true && P.okMk(s.envs); }
  function monthState(mk) {
    var live = liveExpenseCats().map(function (c) { return c.id; });
    return P.envMonth(D(), mk, D().set.envs, live, A.startCash());
  }
  function asgOf(mk, c) {
    var g = A.findIn(D().asg, P.asgId(mk, c));
    return g ? g.a : 0;
  }
  // [{ c, a }] → write the month's assignments in one commit; Undo
  // puts back the values they had (unless changed again since).
  function setAsg(mk, list, text) {
    var before = [];
    list.forEach(function (ch) {
      var id = P.asgId(mk, ch.c), g = A.findIn(D().asg, id);
      var was = g ? g.a : 0;
      if (was === ch.a) return;
      before.push({ id: id, c: ch.c, a: was, na: ch.a });
      if (g) { g.a = ch.a; g.m = A.stamp(g.m); }
      else D().asg.push({ id: id, m: A.stamp(D().tombs["asg:" + id] || 0), a: ch.a, c: ch.c || "", mk: mk });
    });
    if (!before.length) return false;
    A.commit();
    A.renderAll();
    if (text) A.undoToast(text, function () {
      before.forEach(function (b) {
        var g = A.findIn(D().asg, b.id);
        if (!g || g.a !== b.na) return;
        g.a = b.a; g.m = A.stamp(g.m);
      });
      A.commit();
      A.renderAll();
    });
    return true;
  }
  function startEnv() {
    var s = D().set;
    s.m = A.stamp(s.m);
    s.env = true;
    if (!P.okMk(s.envs)) s.envs = A.today().slice(0, 7);
    A.commit();
    A.renderAll();
  }
  function stopEnv() {
    var s = D().set;
    s.m = A.stamp(s.m);
    delete s.env;
    A.commit();
    A.renderAll();
    A.showToast(t("envStopped"));
  }

  function renderPlan(box) {
    box.innerHTML = "";
    renderEnvelopes(box);
    renderGoals(box);
  }

  function renderEnvelopes(box) {
    var mk = A.viewMk();
    var sec = el("section", "plan-sec");
    sec.appendChild(el("h2", "sub-h", t("env")));
    box.appendChild(sec);
    if (!envOn()) {
      var card = el("div", "card env-intro");
      card.appendChild(el("p", "hint", t("envIntro")));
      card.appendChild(el("p", "hint", t("envLimits")));
      var b = el("button", "txt-btn primary", t("envStart"));
      b.type = "button";
      b.addEventListener("click", startEnv);
      card.appendChild(b);
      sec.appendChild(card);
      return;
    }
    var st = monthState(mk);
    if (st.before) {
      var c0 = el("div", "card");
      c0.appendChild(el("p", "hint", t("envBefore", { m: A.monthLabel(D().set.envs) })));
      var gb = el("button", "mini", t("envGo", { m: A.monthLabel(D().set.envs) }));
      gb.type = "button";
      gb.addEventListener("click", function () { A.setMonth(D().set.envs); });
      c0.appendChild(gb);
      sec.appendChild(c0);
      sec.appendChild(stopRow());
      return;
    }
    // "To be assigned"
    var tb = el("div", "card tba " + (st.tba < 0 ? "neg" : st.tba > 0 ? "pos" : "zero"));
    var top = el("div", "tba-top");
    top.appendChild(el("span", "tba-k", t("tba")));
    top.appendChild(el("span", "tba-v", A.money(st.tba)));
    tb.appendChild(top);
    tb.appendChild(el("p", "tba-msg", st.tba < 0 ? t("tbaNeg", { a: A.money(-st.tba) }) : st.tba > 0 ? t("tbaPos") : t("tbaZero")));
    tb.appendChild(el("p", "hint", st.startCash ? t("tbaStart", { c: A.money(st.startCash), i: A.money(st.income), s: A.money(st.assigned) })
                                                : t("tbaFrom", { i: A.money(st.income), s: A.money(st.assigned) })));
    var acts = el("div", "tba-acts");
    var mv = el("button", "mini", t("move"));
    mv.type = "button";
    mv.addEventListener("click", function () { moveDialog(mk, null, null); });
    acts.appendChild(mv);
    var same = el("button", "mini", t("same"));
    same.type = "button";
    same.addEventListener("click", function () { sameAsLast(mk); });
    acts.appendChild(same);
    tb.appendChild(acts);
    sec.appendChild(tb);
    // envelopes
    var ul = el("ul", "env-list");
    st.rows.forEach(function (r) {
      var li = el("li");
      var b = el("button", "tx env" + (r.avail < 0 ? " over" : ""));
      b.type = "button";
      b.appendChild(A.swatch(r.c ? A.catCol(r.c) : 8));
      var mid = el("span", "tx-mid");
      mid.appendChild(el("span", "tx-cat", envName(r.c)));
      var sub = t("rowSub", { a: A.money(r.asg), s: A.money(r.spent) });
      var lim = r.c ? A.limitOf(r.c) : 0;
      if (lim) sub += " · " + t("limit", { a: A.money(lim) });
      mid.appendChild(el("span", "tx-note", sub));
      b.appendChild(mid);
      var right = el("span", "env-av");
      right.appendChild(el("span", "env-av-v" + (r.avail === 0 ? " zero" : ""), A.money(r.avail)));
      if (r.avail < 0) right.appendChild(el("span", "env-av-k", t("over")));
      b.appendChild(right);
      b.setAttribute("aria-label", envName(r.c) + ", " + t("avail") + " " + A.money(r.avail) + (r.avail < 0 ? " (" + t("over") + ")" : "") +
        ", " + t("asg") + " " + A.money(r.asg) + ", " + t("spent") + " " + A.money(r.spent));
      b.addEventListener("click", function () { asgDialog(mk, r); });
      li.appendChild(b);
      ul.appendChild(li);
    });
    sec.appendChild(ul);
    sec.appendChild(stopRow());
  }
  function stopRow() {
    var w = el("div", "env-stop");
    var b = el("button", "link-btn", t("envStop"));
    b.type = "button";
    b.addEventListener("click", stopEnv);
    w.appendChild(b);
    return w;
  }
  function sameAsLast(mk) {
    var prev = A.mkAdd(mk, -1), list = [];
    liveExpenseCats().forEach(function (c) {
      var p = asgOf(prev, c.id);
      if (p && !A.findIn(D().asg, P.asgId(mk, c.id))) list.push({ c: c.id, a: p });
    });
    if (!setAsg(mk, list, t("sameDone"))) A.showToast(t("sameNone"));
  }
  function asgDialog(mk, r) {
    var dlg = A.makeDialog("bd-asg", t("asgDlg", { c: envName(r.c) }));
    dlg.appendChild(el("div", "dlg-sub", A.monthLabel(mk)));
    var form = el("form");
    var facts = el("dl", "env-facts");
    [[t("carry"), r.carry], [t("spent"), r.spent], [t("avail"), r.avail]].forEach(function (z) {
      facts.appendChild(el("dt", "", z[0]));
      facts.appendChild(el("dd", z[1] < 0 ? "neg" : "", A.money(z[1])));
    });
    form.appendChild(facts);
    var amt = el("input");
    amt.inputMode = "decimal";
    amt.autocomplete = "off";
    amt.className = "amt-in";
    amt.value = r.asg ? signedInput(r.asg) : "";
    amt.placeholder = A.zeroAmt();
    form.appendChild(A.field(t("asgThis") + " (" + A.cur() + ")", amt, "bd-asg-a"));
    var err = A.errLine();
    if (r.avail < 0) {
      var cv = el("button", "mini", t("cover"));
      cv.type = "button";
      cv.addEventListener("click", function () { amt.value = signedInput(r.asg - r.avail); amt.focus(); });
      form.appendChild(cv);
    }
    form.appendChild(err);
    var acts = el("div", "dlg-actions");
    acts.appendChild(A.button(A.tt("dlg.cancel"), "", function () { dlg.close(); }));
    var ok = A.button(A.tt("dlg.save"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var v = A.parseSigned(amt.value);
      if (v === null) { A.showErr(err, A.tt("err.open"), amt); return; }
      dlg.close();
      setAsg(mk, [{ c: r.c, a: v }], t("asgSaved"));
    });
    dlg.appendChild(form);
    A.showDialog(dlg);
    amt.focus();
    amt.select();
  }
  // From / to: "" in the select = "To be assigned".
  function moveDialog(mk, from, to) {
    var st = monthState(mk);
    if (st.before) return;
    var dlg = A.makeDialog("bd-move", t("move"));
    dlg.appendChild(el("div", "dlg-sub", A.monthLabel(mk)));
    var form = el("form");
    function placeSel(v) {
      var s = el("select");
      opt(s, "@", t("mvTbaOpt", { a: A.money(st.tba) }));
      st.rows.forEach(function (r) { opt(s, r.c || "-", envName(r.c) + " (" + A.money(r.avail) + ")"); });
      s.value = v === null ? "@" : (v || "-");
      return s;
    }
    var fs = placeSel(from), ts = placeSel(to);
    if (fs.value === ts.value && st.rows.length) ts.value = st.rows[0].c || "-";
    var row = el("div", "fld-row");
    row.appendChild(A.field(t("mvFrom"), fs, "bd-mv-f"));
    row.appendChild(A.field(t("mvTo"), ts, "bd-mv-t"));
    form.appendChild(row);
    var amt = el("input");
    amt.inputMode = "decimal";
    amt.autocomplete = "off";
    amt.className = "amt-in";
    amt.placeholder = A.zeroAmt();
    form.appendChild(A.field(A.tt("f.amount") + " (" + A.cur() + ")", amt, "bd-mv-a"));
    var err = A.errLine();
    form.appendChild(err);
    var acts = el("div", "dlg-actions");
    acts.appendChild(A.button(A.tt("dlg.cancel"), "", function () { dlg.close(); }));
    var ok = A.button(t("move"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (fs.value === ts.value) { A.showErr(err, t("mvSame"), ts); return; }
      var c = A.parseAmount(amt.value);
      if (c === null) { A.showErr(err, A.tt("err.amount"), amt); return; }
      var f = fs.value === "@" ? null : (fs.value === "-" ? "" : fs.value);
      var to2 = ts.value === "@" ? null : (ts.value === "-" ? "" : ts.value);
      var list = P.moveMoney(function (cc) { return asgOf(mk, cc); }, f, to2, c);
      dlg.close();
      setAsg(mk, list, t("mvDone", { a: A.money(c) }));
    });
    dlg.appendChild(form);
    A.showDialog(dlg);
    amt.focus();
  }

  // ---------- Savings goals ----------
  function goalSaved(g) {
    if (!g.ac) return g.sv;
    var nw = A.accBalanceMain(g.ac);
    return nw === null ? g.sv : nw;
  }
  function renderGoals(box) {
    var sec = el("section", "plan-sec");
    var head = el("div", "sec-head");
    head.appendChild(el("h2", "sub-h", t("goals")));
    var nb = el("button", "mini", t("goalNew"));
    nb.type = "button";
    nb.addEventListener("click", function () { goalDialog(null); });
    head.appendChild(nb);
    sec.appendChild(head);
    var list = D().goal.slice().sort(function (a, b) { return (a.d || "9999") < (b.d || "9999") ? -1 : (a.d || "9999") > (b.d || "9999") ? 1 : a.n.localeCompare(b.n); });
    if (!list.length) sec.appendChild(el("p", "hint", t("goalsEmpty")));
    list.forEach(function (g) {
      var stt = P.goalStatus(g, goalSaved(g), A.today());
      var card = el("div", "lim goal");
      var h = el("div", "lim-head");
      h.appendChild(A.swatch(g.col));
      var nm = el("button", "goal-name", g.n);
      nm.type = "button";
      nm.setAttribute("aria-label", t("goalEdit") + ": " + g.n);
      nm.addEventListener("click", function () { goalDialog(g.id); });
      h.appendChild(nm);
      if (!g.ac) {
        var add = el("button", "mini", t("gAdd"));
        add.type = "button";
        add.setAttribute("aria-label", t("gAdd") + ": " + g.n);
        add.addEventListener("click", function () { addMoneyDialog(g.id); });
        h.appendChild(add);
      }
      card.appendChild(h);
      var bar = el("div", "bar " + (stt.done ? "ok" : stt.late ? "over" : "ok"));
      bar.setAttribute("role", "progressbar");
      bar.setAttribute("aria-valuemin", "0");
      bar.setAttribute("aria-valuemax", "100");
      bar.setAttribute("aria-valuenow", String(stt.pct));
      bar.setAttribute("aria-label", g.n + ": " + stt.pct + "%");
      var f = el("span");
      f.style.width = stt.pct + "%";
      f.style.background = "var(--c" + g.col + ")";
      bar.appendChild(f);
      card.appendChild(bar);
      var sub = el("div", "lim-sub");
      sub.appendChild(el("span", "", t("gOf", { a: A.money(stt.saved), b: A.money(g.t) }) + " · " + stt.pct + "%"));
      var right = stt.done ? t("gDone") : stt.late ? t("gLate", { a: A.money(stt.left) })
                : g.d ? t("gPer", { a: A.money(stt.perMonth), d: A.dateShort(g.d) }) : t("gNoDate", { a: A.money(stt.left) });
      sub.appendChild(el("span", "lim-state" + (stt.late ? " over" : ""), right));
      card.appendChild(sub);
      if (g.ac) card.appendChild(el("div", "lim-sub", t("gAcc", { a: A.accName(g.ac) || "?" })));
      sec.appendChild(card);
    });
    box.appendChild(sec);
  }
  function goalDialog(id) {
    var g = id ? A.findIn(D().goal, id) : null;
    if (id && !g) return;
    if (!g && D().goal.length >= MAX_GOALS) { A.showToast(t("gFull", { n: MAX_GOALS })); return; }
    var dlg = A.makeDialog("bd-goal", t(g ? "goalEdit" : "goalNew"));
    var form = el("form");
    var name = el("input");
    name.maxLength = 40;
    name.autocomplete = "off";
    name.placeholder = t("gName_ph");
    name.value = g ? g.n : "";
    form.appendChild(A.field(t("gName"), name, "bd-g-n"));
    var tgt = el("input");
    tgt.inputMode = "decimal";
    tgt.autocomplete = "off";
    tgt.className = "amt-in";
    tgt.placeholder = A.zeroAmt();
    tgt.value = g ? A.centsToInput(g.t) : "";
    form.appendChild(A.field(t("gTarget") + " (" + A.cur() + ")", tgt, "bd-g-t"));
    var date = el("input");
    date.type = "date";
    date.value = g ? g.d : "";
    form.appendChild(A.field(t("gDate"), date, "bd-g-d"));
    var from = el("select");
    opt(from, "", t("gManual"));
    A.accs().forEach(function (a) { opt(from, a.id, t("gAcc", { a: a.n })); });
    from.value = g ? g.ac : "";
    if (from.value !== (g ? g.ac : "")) from.value = "";
    if (A.accs().length) form.appendChild(A.field(t("gFrom"), from, "bd-g-from"));
    var sv = el("input");
    sv.inputMode = "decimal";
    sv.autocomplete = "off";
    sv.placeholder = A.zeroAmt();
    sv.value = g && g.sv ? A.centsToInput(g.sv) : "";
    var svF = A.field(t("gSaved") + " (" + A.cur() + ")", sv, "bd-g-sv");
    form.appendChild(svF);
    var sync = function () { svF.hidden = !!from.value; };
    from.addEventListener("change", sync);
    sync();
    var err = A.errLine();
    form.appendChild(err);
    var acts = el("div", "dlg-actions");
    if (g) acts.appendChild(A.button(A.tt("dlg.delete"), "danger", function () { dlg.close(); deleteGoal(g.id); }));
    acts.appendChild(A.button(A.tt("dlg.cancel"), "", function () { dlg.close(); }));
    var ok = A.button(A.tt("dlg.save"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var n = A.normText(name.value, 40);
      if (!n) { A.showErr(err, A.tt("err.name"), name); return; }
      var tc = A.parseAmount(tgt.value);
      if (tc === null) { A.showErr(err, A.tt("err.amount"), tgt); return; }
      var s0 = from.value ? (g ? g.sv : 0) : (sv.value.trim() ? A.parseSigned(sv.value) : 0);
      if (s0 === null || s0 < 0) { A.showErr(err, A.tt("err.amount"), sv); return; }
      var vals = { ac: from.value, d: date.value && /^\d{4}-\d{2}-\d{2}$/.test(date.value) ? date.value : "", n: n, sv: s0, t: tc };
      var cur0 = g ? A.findIn(D().goal, g.id) : null;
      if (cur0) {
        var changed = Object.keys(vals).some(function (k) { return cur0[k] !== vals[k]; });
        if (changed) { Object.keys(vals).forEach(function (k) { cur0[k] = vals[k]; }); cur0.m = A.stamp(cur0.m); A.commit(); }
      } else {
        var used = {};
        D().goal.forEach(function (y) { used[y.col] = 1; });
        var col = 2;
        for (var i = 0; i < 8; i++) if (!used[(2 + i) % 8]) { col = (2 + i) % 8; break; }
        var obj = { id: A.newId(), m: A.stamp(0), col: col };
        Object.keys(vals).forEach(function (k) { obj[k] = vals[k]; });
        D().goal.push(obj);
        A.commit();
      }
      dlg.close();
      A.live(A.tt("live.saved"));
      A.renderAll();
    });
    dlg.appendChild(form);
    A.showDialog(dlg);
    if (!g) name.focus();
  }
  function addMoneyDialog(id) {
    var g = A.findIn(D().goal, id);
    if (!g) return;
    var dlg = A.makeDialog("bd-gadd", t("gAddDlg", { g: g.n }));
    var form = el("form");
    var amt = el("input");
    amt.inputMode = "decimal";
    amt.autocomplete = "off";
    amt.className = "amt-in";
    amt.placeholder = A.zeroAmt();
    form.appendChild(A.field(A.tt("f.amount") + " (" + A.cur() + ")", amt, "bd-gadd-a"));
    form.appendChild(el("p", "hint", t("gAddHint")));
    var err = A.errLine();
    form.appendChild(err);
    var acts = el("div", "dlg-actions");
    acts.appendChild(A.button(A.tt("dlg.cancel"), "", function () { dlg.close(); }));
    var ok = A.button(t("gAdd"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var v = A.parseSigned(amt.value);
      if (!v) { A.showErr(err, A.tt("err.amount"), amt); return; }
      var cur0 = A.findIn(D().goal, id);
      if (!cur0) { dlg.close(); return; }
      var was = cur0.sv;
      cur0.sv = Math.max(0, Math.min(P.MAX_CENTS, cur0.sv + v));
      cur0.m = A.stamp(cur0.m);
      A.commit();
      dlg.close();
      A.renderAll();
      A.undoToast(t("gAdded"), function () {
        var x = A.findIn(D().goal, id);
        if (!x) return;
        x.sv = was;
        x.m = A.stamp(x.m);
        A.commit();
        A.renderAll();
      });
    });
    dlg.appendChild(form);
    A.showDialog(dlg);
    amt.focus();
  }
  function deleteGoal(id) {
    var g = A.findIn(D().goal, id);
    if (!g) return;
    var copy = JSON.parse(JSON.stringify(g));
    D().goal = D().goal.filter(function (y) { return y.id !== id; });
    A.tombstone("goal", id);
    A.commit();
    A.renderAll();
    A.undoToast(t("gDeleted"), function () {
      A.untomb("goal", id);
      copy.m = A.stamp(Math.max(copy.m, D().tombs["goal:" + id] || 0));
      if (!A.findIn(D().goal, id)) D().goal.push(copy);
      A.commit();
      A.renderAll();
    });
  }

  // ---------- Subscriptions (Recurring tab) ----------
  function renderRecHead(box, view, onView) {
    box.innerHTML = "";
    var seg = el("div", "seg rec-view");
    seg.setAttribute("role", "radiogroup");
    seg.setAttribute("aria-label", A.tt("tab.rec"));
    [["all", t("vAll")], ["subs", t("vSubs")]].forEach(function (v) {
      var b = el("button", "seg-btn", v[1]);
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", view === v[0] ? "true" : "false");
      b.addEventListener("click", function () { onView(v[0]); });
      seg.appendChild(b);
    });
    box.appendChild(seg);
  }
  function inDays(n) { return n === 0 ? t("subIn0") : n === 1 ? t("subIn1") : t("subInN", { n: n }); }
  function bellText(nd) { return nd === 0 ? t("subBell0") : nd === 1 ? t("subBell1") : t("subBell", { n: nd }); }
  function renderSubs(box) {
    box.innerHTML = "";
    var subs = P.subscriptions(D(), A.today());
    var sum = el("div", "sum sum2");
    [[t("subMonth"), subs.monthly], [t("subYear"), subs.yearly]].forEach(function (z) {
      var tile = el("div", "tile");
      tile.appendChild(el("span", "tile-k", z[0]));
      tile.appendChild(el("span", "tile-v", A.money(z[1])));
      sum.appendChild(tile);
    });
    box.appendChild(sum);
    if (!subs.list.length) box.appendChild(el("p", "hint empty", t("subsEmpty")));
    var ul = el("ul", "day-list");
    subs.list.forEach(function (s) {
      var r = s.r, li = el("li");
      var b = el("button", "tx out");
      b.type = "button";
      b.appendChild(A.swatch(A.catCol(r.c)));
      var mid = el("span", "tx-mid");
      mid.appendChild(el("span", "tx-cat", r.n || A.catName(r.c)));
      var days = P.dayDiff(A.today(), s.next);
      mid.appendChild(el("span", "tx-note", t("subNext", { d: A.dateShort(s.next) }) + " · " + inDays(days) + " · " + A.recWhen(r)));
      b.appendChild(mid);
      var nd = P.normNd(r.nd);
      if (nd >= 0) {
        var bell = el("span", "tx-rec");
        bell.innerHTML = A.icon("bell");
        bell.title = bellText(nd);
        b.appendChild(bell);
      }
      var amt = el("span", "sub-amt");
      amt.appendChild(el("span", "tx-amt", A.money(s.monthly)));
      amt.appendChild(el("span", "sub-y", t("subPerY", { a: A.money(s.yearly) })));
      b.appendChild(amt);
      b.setAttribute("aria-label", (r.n || A.catName(r.c)) + ", " + t("subMonth") + " " + A.money(s.monthly) + ", " +
        t("subPerY", { a: A.money(s.yearly) }) + ", " + t("subNext", { d: A.dateShort(s.next) }) + (nd >= 0 ? ", " + bellText(nd) : ""));
      b.addEventListener("click", function () { A.recDialog(r.id); });
      li.appendChild(b);
      ul.appendChild(li);
    });
    box.appendChild(ul);
    // device-local reminder hour
    var hr = el("select");
    opt(hr, -1, t("subOff"));
    for (var h = 0; h < 24; h++) opt(hr, h, (h < 10 ? "0" : "") + h + ":00");
    hr.value = String(A.notifyHour());
    hr.addEventListener("change", function () { A.setNotifyHour(+hr.value); });
    var w = el("div", "sub-hour");
    w.appendChild(A.field(t("subHour"), hr, "bd-sub-hour"));
    w.appendChild(el("p", "hint", t("subHint")));
    box.appendChild(w);
  }

  // ---------- Reports (Charts tab) ----------
  function renderYear(box) {
    box.innerHTML = "";
    var year = A.viewMk().slice(0, 4);
    var head = el("div", "sec-head");
    head.appendChild(el("h2", "", t("year", { y: year })));
    var nav = el("span", "yr-nav");
    [[-1, "yPrev", A.icon("left")], [1, "yNext", A.icon("right")]].forEach(function (z) {
      var b = el("button", "icon-btn");
      b.type = "button";
      b.innerHTML = z[2];
      b.setAttribute("aria-label", t(z[1]));
      b.title = t(z[1]);
      b.addEventListener("click", function () { A.setMonth(A.mkAdd(A.viewMk(), 12 * z[0])); });
      nav.appendChild(b);
    });
    head.appendChild(nav);
    box.appendChild(head);
    var live = liveExpenseCats().map(function (c) { return c.id; });
    var rep = P.yearReport(D(), year, live);
    if (!rep.rows.length) { box.appendChild(el("p", "hint", t("yNone", { y: year }))); return; }
    // stacked bars: the 6 largest categories + the rest
    var top = rep.rows.slice(0, rep.rows.length > 7 ? 6 : 7);
    var rest = rep.rows.slice(top.length);
    var series = top.map(function (r) { return { name: envName(r.c), col: r.c ? A.catCol(r.c) : 8, by: r.by }; });
    if (rest.length) {
      var by = [];
      for (var i = 0; i < 12; i++) { var s = 0; rest.forEach(function (r) { s += r.by[i]; }); by.push(s); }
      series.push({ name: t("yOther"), col: 8, by: by });
    }
    var legend = el("div", "legend wrap");
    series.forEach(function (sr) {
      var lg = el("span", "lg");
      lg.appendChild(A.swatch(sr.col));
      lg.appendChild(el("span", "", sr.name));
      legend.appendChild(lg);
    });
    box.appendChild(legend);
    var W = A.chartWidth(box), H = 200, L = 46, Rm = 6, T = 10, B = 24;
    var max = Math.max.apply(null, rep.out.concat([1]));
    var step = A.niceStep(max / 4), topV = Math.max(step, Math.ceil(max / step) * step);
    var pw = W - L - Rm, ph = H - T - B;
    var svg = A.sv("svg", { viewBox: "0 0 " + W + " " + H, width: W, height: H, "class": "chart", role: "img",
                            "aria-label": t("year", { y: year }) });
    for (var v = 0; v <= topV + 0.5; v += step) {
      var yy = T + ph - v / topV * ph;
      svg.appendChild(A.sv("line", { x1: L, x2: W - Rm, y1: yy, y2: yy, "class": v === 0 ? "base" : "grid" }));
      svg.appendChild(A.svText(L - 6, yy + 4, A.moneyShort(v), "ax", "end"));
    }
    var gw = pw / 12, bw = Math.max(4, Math.min(22, gw - 6)), narrow = W < 420;
    rep.months.forEach(function (mk, mi) {
      var x = L + mi * gw + (gw - bw) / 2, base = T + ph;
      series.forEach(function (sr) {
        var val = sr.by[mi];
        if (!val) return;
        var h = Math.max(1, ph * val / topV);
        base -= h;
        svg.appendChild(A.sv("rect", { x: x, y: base, width: bw, height: h, style: "fill:var(--c" + sr.col + ")", "class": "stk" }));
      });
      if (!narrow || mi % 2 === 1) svg.appendChild(A.svText(L + mi * gw + gw / 2, H - 6, A.monthShort(mk), mk === A.viewMk() ? "ax cur" : "ax", "middle"));
      var tip = A.monthLabel(mk) + ": " + A.money(rep.out[mi]) + series.filter(function (sr) { return sr.by[mi]; })
        .map(function (sr) { return ", " + sr.name + " " + A.money(sr.by[mi]); }).join("");
      var target = A.sv("rect", { x: L + mi * gw, y: T, width: gw, height: ph + B, fill: "transparent" });
      A.hit(target, tip, mk === A.viewMk() ? null : function () { A.setMonth(mk); });
      svg.appendChild(target);
    });
    box.appendChild(svg);
    // the table: categories × months, totals
    var wrap = el("div", "yr-table");
    var tb = el("table");
    var thead = el("thead"), tr = el("tr");
    var th0 = el("th", "", t("yCat")); th0.scope = "col"; tr.appendChild(th0);
    rep.months.forEach(function (mk) { var th = el("th", "num", A.monthShort(mk)); th.scope = "col"; tr.appendChild(th); });
    var thT = el("th", "num", t("yTot")); thT.scope = "col"; tr.appendChild(thT);
    thead.appendChild(tr);
    tb.appendChild(thead);
    var body = el("tbody");
    function line(name, by, tot, cls) {
      var r = el("tr", cls || "");
      var h = el("th", "", name); h.scope = "row"; r.appendChild(h);
      by.forEach(function (v) { r.appendChild(el("td", "num", v ? A.moneyPlain(v) : "–")); });
      r.appendChild(el("td", "num tot", A.moneyPlain(tot)));
      body.appendChild(r);
    }
    rep.rows.forEach(function (r) { line(envName(r.c), r.by, r.tot); });
    line(t("yOut"), rep.out, rep.totOut, "sumrow");
    line(t("yIn"), rep.inc, rep.totInc, "sumrow in");
    tb.appendChild(body);
    wrap.appendChild(tb);
    wrap.setAttribute("tabindex", "0");
    wrap.setAttribute("role", "region");
    wrap.setAttribute("aria-label", t("year", { y: year }) + " (" + A.cur() + ")");
    box.appendChild(wrap);
  }

  function renderNetWorth(box) {
    box.innerHTML = "";
    box.appendChild(el("h2", "", t("nw")));
    if (!D().acc.length) { box.appendChild(el("p", "hint", t("nwNone"))); return; }
    var months = [];
    for (var i = 11; i >= 0; i--) months.push(A.mkAdd(A.viewMk(), -i));
    var rows = P.netWorthSeries(D(), months, A.today(), A.cur(), A.fx);
    var now = P.netWorth(D(), A.today(), A.cur(), A.fx);
    box.appendChild(el("p", "nw-now" + (now.tot < 0 ? " neg" : ""), t("nwNow", { a: A.money(now.tot) })));
    var W = A.chartWidth(box), H = 180, L = 46, Rm = 10, T = 12, B = 24;
    var lo = 0, hi = 0;
    rows.forEach(function (r) { lo = Math.min(lo, r.tot); hi = Math.max(hi, r.tot); });
    var step = A.niceStep(((hi - lo) || 100) / 4);
    lo = Math.floor(lo / step) * step;
    hi = Math.max(lo + step, Math.ceil(hi / step) * step);
    var pw = W - L - Rm, ph = H - T - B;
    var y = function (v) { return T + ph - (v - lo) / (hi - lo) * ph; };
    var x = function (j) { return L + (j + 0.5) * pw / rows.length; };
    var svg = A.sv("svg", { viewBox: "0 0 " + W + " " + H, width: W, height: H, "class": "chart", role: "img", "aria-label": t("nw") });
    for (var v = lo; v <= hi + 0.5; v += step) {
      svg.appendChild(A.sv("line", { x1: L, x2: W - Rm, y1: y(v), y2: y(v), "class": v === 0 ? "base" : "grid" }));
      svg.appendChild(A.svText(L - 6, y(v) + 4, A.moneyShort(v), "ax", "end"));
    }
    var d = rows.map(function (r, j) { return (j ? "L" : "M") + x(j).toFixed(1) + "," + y(r.tot).toFixed(1); }).join(" ");
    svg.appendChild(A.sv("path", { d: d, "class": "line", style: "stroke:var(--c2)" }));
    var narrow = W < 420;
    rows.forEach(function (r, j) {
      svg.appendChild(A.sv("circle", { cx: x(j), cy: y(r.tot), r: 4, "class": "dot", style: "fill:var(--c2)" }));
      if (!narrow || j % 2 === 1) svg.appendChild(A.svText(x(j), H - 6, A.monthShort(r.mk), r.mk === A.viewMk() ? "ax cur" : "ax", "middle"));
      var target = A.sv("rect", { x: L + j * pw / rows.length, y: T, width: pw / rows.length, height: ph + B, fill: "transparent" });
      A.hit(target, A.monthLabel(r.mk) + ": " + A.money(r.tot), r.mk === A.viewMk() ? null : function () { A.setMonth(r.mk); });
      svg.appendChild(target);
    });
    box.appendChild(svg);
    var fxUsed = D().acc.some(function (a) { return a.cur && a.cur !== A.cur(); });
    if (now.missing.length) box.appendChild(el("p", "hint warn-t", t("nwMiss", { n: now.missing.length })));
    if (fxUsed) box.appendChild(el("p", "hint", t("nwFx") + " " + A.fxNote()));
    box.appendChild(A.tableTwin([A.tt("ch.month"), t("nw")], rows.map(function (r) { return [A.monthLabel(r.mk), A.money(r.tot)]; })));
  }

  root.OrosBudgetPlanUI = {
    init: function (api) { A = api; },
    renderPlan: function (box) { if (A) renderPlan(box); },
    renderRecHead: function (box, view, onView) { if (A) renderRecHead(box, view, onView); },
    renderSubs: function (box) { if (A) renderSubs(box); },
    renderYear: function (box) { if (A) renderYear(box); },
    renderNetWorth: function (box) { if (A) renderNetWorth(box); },
    goalDialog: function (id) { if (A) goalDialog(id); },
    moveDialog: function (mk) { if (A) moveDialog(mk, null, null); },
    t: function (k, p) { return A ? t(k, p) : k; }
  };
})(typeof window !== "undefined" ? window : this);
