// ============================================================
// orOS Budget — Overview tab (budget/overviewui.js)
// The first screen: the month at a glance, as cards the person can
// hide and reorder (set.ov, synced on every device):
//   safe  what is safe to spend a day until the month ends
//   pace  expenses added up day by day, next to last month and the
//         average of the three months before (and the overall limit)
//   acc   net worth and each account's balance
//   lim   the limits closest to their end, as rings
//   up    recurring entries in the next 7 days
//   goal  savings goals
//   top   the biggest expense categories, with the change against
//         last month
// Numbers come from budget/overview.js (pure). Everything the app
// owns (data, writes, dialogs, chart helpers) comes in through
// init(api). Every user text goes in with textContent.
// ============================================================
(function (root) {
  "use strict";
  var O = root.OrosBudgetOverview;
  var P = root.OrosBudgetPlan;
  var A = null;

  var S = {
    en: {
      "ov.safe": "Safe to spend", "ov.perDay": "{a} a day", "ov.days": "for {n} days, to the end of the month", "ov.day1": "for today, the last day of the month",
      "ov.leftLim": "{a} left under your monthly limit", "ov.leftInc": "{a} left of what came in",
      "ov.overLim": "{a} over your monthly limit", "ov.overInc": "{a} more going out than coming in",
      "ov.toCome": "Recurring still to come: {i} in, {o} out",
      "ov.noLim": "Without a monthly limit, this is what came in minus what went out. Set one under Limits › All expenses.",
      "ov.ended": "How the month ended", "ov.saved": "Saved {p}% of what came in", "ov.overspent": "{a} more went out than came in",
      "ov.noInc": "No income this month",
      "ov.ahead": "Coming this month", "ov.plan": "Recurring: {i} in, {o} out",
      "ov.pace": "Spending pace", "ov.thisM": "This month", "ov.lastM": "Last month", "ov.avg": "Average of {n} months",
      "ov.limit": "Limit", "ov.less": "{a} less than last month by this day", "ov.more": "{a} more than last month by this day",
      "ov.same": "The same as last month by this day", "ov.paceNone": "No expenses yet in this month or the one before.",
      "ov.dayTip": "Day {d}: {a}", "ov.dayTipPrev": "last month {a}", "ov.dayTipAvg": "average {a}",
      "ov.day": "Day", "ov.ahead.pace": "This month has not started yet.",
      "ov.bkBal": "Bank {a} ({d})", "ov.bkBoth": "Bank {a} · available {v} ({d})", "ov.bkAvail": "Bank: available {v} ({d})", "ov.bkSame": "same", "ov.bkMatch": "Match", "ov.bkMatchHint": "Changes the account's starting balance so that Budget shows the bank's balance on that day",
      "ov.bkMatched": "Starting balance changed by {a}",
      "ov.cyStmt": "Statement {d}: {a}",
      "ov.ivPaid": "paid {a}", "ov.ivPx": "{q} {s} at {p} ({w})", "ov.ivOz": "oz", "ov.ivG": "g", "ov.ivOld": "last saved price",
      "ov.ivLoading": "Getting the price…", "ov.ivNoPrice": "No price: CoinGecko can't be reached. Type a price in the account.", "ov.ivType": "Type a price in the account to see its value.", "ov.cyNone": "Statement {d}: nothing to pay", "ov.cyPaid": "paid {a}", "ov.cyAll": "paid in full",
      "ov.cyLeft": "{a} by {d}", "ov.cyDays": "{n} days left", "ov.cyToday": "due today", "ov.cyTomorrow": "due tomorrow", "ov.cyLate": "{a} not paid by {d}",
      "ov.cyEst": "Interest if not paid in full: about {a}", "ov.cyFee": "Add interest", "ov.cyFeeTip": "Add the interest or fees on your card statement as an expense: {a}", "ov.bkUnmapped": "Your banks' balances show here once each bank fills a Budget account (Banks › Fills).", "ov.bkBanks": "Banks",
      "ov.acc": "Accounts", "ov.nw": "Net worth", "ov.accNone": "Add your cash, cards and bank accounts to see their balances here.",
      "ov.accAdd": "Accounts", "ov.accTip": "Show the entries of {a}",
      "ov.flowAll": "All accounts, {m}", "ov.flowAria": "in {i}, out {o}, difference {d}", "ov.noAcc": "Without an account",
      "ov.flowHint": "Balance today, then the month's income, expenses and their difference. Transfers between your accounts are not counted.",
      "ov.lim": "Limits", "ov.limNone": "Give a category a monthly limit to see here how much of it is left.",
      "ov.limSet": "Set limits", "ov.limLeft": "{a} left", "ov.limOver": "{a} over", "ov.limAll": "All expenses",
      "ov.up": "Next 7 days", "ov.upNone": "No recurring entries in the next 7 days.", "ov.today": "Today", "ov.tomorrow": "Tomorrow",
      "ov.upSum": "In {i} · out {o}",
      "ov.goal": "Savings goals", "ov.goalNone": "A trip, a new laptop, a safety net: set a target and see how close you are.",
      "ov.goalNew": "New goal", "ov.accEdit": "Rename or change {a}", "ov.accNew": "New account", "ov.bkNow": "Update from banks", "ov.bkBusy": "Updating…", "ov.bkLast": "Last update {d}", "ov.bkNever": "Not updated on this device yet", "ov.bkWeb": "Banks update only at useoros.online", "ov.loan": "Loans and debts",
      "ov.top": "Where the money went", "ov.topNone": "No expenses this month.", "ov.new": "new",
      "ov.up%": "{p}% more than last month", "ov.down%": "{p}% less than last month", "ov.new.aria": "Nothing in this category last month",
      "ov.edit": "Edit the overview", "ov.editHint": "Pick the cards to show and their order. It applies on all your devices.",
      "ov.upBtn": "Move up: {c}", "ov.downBtn": "Move down: {c}", "ov.reset": "Default order", "ov.saveDone": "Overview saved",
      "ov.open": "More",
      "ov.lessAll": "{a} less than the month before", "ov.moreAll": "{a} more than the month before", "ov.sameAll": "The same as the month before"
    },
    el: {
      "ov.safe": "Μπορείς να ξοδέψεις", "ov.perDay": "{a} τη μέρα", "ov.days": "για {n} μέρες, ως το τέλος του μήνα", "ov.day1": "για σήμερα, την τελευταία μέρα του μήνα",
      "ov.leftLim": "Μένουν {a} ως το μηνιαίο όριο", "ov.leftInc": "Μένουν {a} από όσα μπήκαν",
      "ov.overLim": "{a} πάνω από το μηνιαίο όριο", "ov.overInc": "Βγαίνουν {a} περισσότερα από όσα μπαίνουν",
      "ov.toCome": "Πάγια που έρχονται: {i} έσοδα, {o} έξοδα",
      "ov.noLim": "Χωρίς μηνιαίο όριο, αυτό είναι όσα μπήκαν μείον όσα βγήκαν. Βάλε ένα στα Όρια › Όλα τα έξοδα.",
      "ov.ended": "Πώς έκλεισε ο μήνας", "ov.saved": "Έμεινε το {p}% όσων μπήκαν", "ov.overspent": "Βγήκαν {a} περισσότερα από όσα μπήκαν",
      "ov.noInc": "Κανένα έσοδο αυτόν τον μήνα",
      "ov.ahead": "Τι έρχεται αυτόν τον μήνα", "ov.plan": "Πάγια: {i} έσοδα, {o} έξοδα",
      "ov.pace": "Ρυθμός εξόδων", "ov.thisM": "Αυτός ο μήνας", "ov.lastM": "Προηγούμενος μήνας", "ov.avg": "Μέσος όρος {n} μηνών",
      "ov.limit": "Όριο", "ov.less": "{a} λιγότερα από τον προηγούμενο μήνα ως σήμερα", "ov.more": "{a} περισσότερα από τον προηγούμενο μήνα ως σήμερα",
      "ov.same": "Όσα και τον προηγούμενο μήνα ως σήμερα", "ov.paceNone": "Κανένα έξοδο ακόμη σε αυτόν ή στον προηγούμενο μήνα.",
      "ov.dayTip": "{d} του μήνα: {a}", "ov.dayTipPrev": "προηγούμενος {a}", "ov.dayTipAvg": "μέσος όρος {a}",
      "ov.day": "Μέρα", "ov.ahead.pace": "Αυτός ο μήνας δεν έχει αρχίσει ακόμη.",
      "ov.bkBal": "Τράπεζα {a} ({d})", "ov.bkBoth": "Τράπεζα {a} · διαθέσιμο {v} ({d})", "ov.bkAvail": "Τράπεζα: διαθέσιμο {v} ({d})", "ov.bkSame": "ίδιο", "ov.bkMatch": "Ταίριαξε", "ov.bkMatchHint": "Αλλάζει το αρχικό υπόλοιπο του λογαριασμού ώστε η εφαρμογή να δείχνει το υπόλοιπο της τράπεζας εκείνη τη μέρα",
      "ov.bkMatched": "Το αρχικό υπόλοιπο άλλαξε κατά {a}",
      "ov.cyStmt": "Κλείσιμο {d}: {a}",
      "ov.ivPaid": "πληρώθηκαν {a}", "ov.ivPx": "{q} {s} προς {p} ({w})", "ov.ivOz": "oz", "ov.ivG": "γρ.", "ov.ivOld": "τελευταία αποθηκευμένη τιμή",
      "ov.ivLoading": "Παίρνω την τιμή…", "ov.ivNoPrice": "Χωρίς τιμή: το CoinGecko δεν απαντά. Γράψε μια τιμή στον λογαριασμό.", "ov.ivType": "Γράψε μια τιμή στον λογαριασμό για να δεις την αξία του.", "ov.cyNone": "Κλείσιμο {d}: τίποτα για πληρωμή", "ov.cyPaid": "πληρώθηκαν {a}", "ov.cyAll": "εξοφλήθηκε",
      "ov.cyLeft": "{a} ως {d}", "ov.cyDays": "μένουν {n} ημέρες", "ov.cyToday": "λήγει σήμερα", "ov.cyTomorrow": "λήγει αύριο", "ov.cyLate": "{a} απλήρωτα από {d}",
      "ov.cyEst": "Τόκος αν δεν εξοφληθεί: περίπου {a}", "ov.cyFee": "Πρόσθεσε τόκους", "ov.cyFeeTip": "Πρόσθεσε ως έξοδο τους τόκους ή τις χρεώσεις του λογαριασμού της κάρτας: {a}", "ov.bkUnmapped": "Τα υπόλοιπα των τραπεζών σου φαίνονται εδώ μόλις κάθε τράπεζα γεμίζει έναν λογαριασμό της εφαρμογής (Τράπεζες › Γεμίζει).", "ov.bkBanks": "Τράπεζες",
      "ov.acc": "Λογαριασμοί", "ov.nw": "Καθαρή θέση", "ov.accNone": "Πρόσθεσε μετρητά, κάρτες και τραπεζικούς λογαριασμούς για να βλέπεις εδώ τα υπόλοιπά τους.",
      "ov.accAdd": "Λογαριασμοί", "ov.accTip": "Οι κινήσεις του {a}",
      "ov.flowAll": "Όλοι οι λογαριασμοί, {m}", "ov.flowAria": "έσοδα {i}, έξοδα {o}, διαφορά {d}", "ov.noAcc": "Χωρίς λογαριασμό",
      "ov.flowHint": "Υπόλοιπο σήμερα, μετά τα έσοδα, τα έξοδα και η διαφορά τους στον μήνα. Οι μεταφορές ανάμεσα στους λογαριασμούς σου δεν μετράνε.",
      "ov.lim": "Όρια", "ov.limNone": "Δώσε σε μια κατηγορία μηνιαίο όριο για να βλέπεις εδώ πόσα μένουν.",
      "ov.limSet": "Ορισμός ορίων", "ov.limLeft": "μένουν {a}", "ov.limOver": "{a} πάνω", "ov.limAll": "Όλα τα έξοδα",
      "ov.up": "Επόμενες 7 μέρες", "ov.upNone": "Κανένα πάγιο τις επόμενες 7 μέρες.", "ov.today": "Σήμερα", "ov.tomorrow": "Αύριο",
      "ov.upSum": "Έσοδα {i} · έξοδα {o}",
      "ov.goal": "Στόχοι αποταμίευσης", "ov.goalNone": "Ένα ταξίδι, ένας νέος υπολογιστής, ένα αποθεματικό: βάλε στόχο και δες πόσο κοντά είσαι.",
      "ov.goalNew": "Νέος στόχος", "ov.accEdit": "Όνομα και ρυθμίσεις: {a}", "ov.accNew": "Νέος λογαριασμός", "ov.bkNow": "Ενημέρωση από τράπεζες", "ov.bkBusy": "Ενημέρωση…", "ov.bkLast": "Τελευταία ενημέρωση {d}", "ov.bkNever": "Δεν έχει γίνει ακόμα ενημέρωση σε αυτή τη συσκευή", "ov.bkWeb": "Οι τράπεζες ενημερώνονται μόνο στο useoros.online", "ov.loan": "Δάνεια και χρέη",
      "ov.top": "Πού πήγαν τα χρήματα", "ov.topNone": "Κανένα έξοδο αυτόν τον μήνα.", "ov.new": "νέα",
      "ov.up%": "{p}% περισσότερα από τον προηγούμενο μήνα", "ov.down%": "{p}% λιγότερα από τον προηγούμενο μήνα", "ov.new.aria": "Τίποτα σε αυτή την κατηγορία τον προηγούμενο μήνα",
      "ov.edit": "Προσαρμογή σύνοψης", "ov.editHint": "Διάλεξε ποιες κάρτες φαίνονται και με ποια σειρά. Ισχύει σε όλες τις συσκευές σου.",
      "ov.upBtn": "Πάνω: {c}", "ov.downBtn": "Κάτω: {c}", "ov.reset": "Αρχική σειρά", "ov.saveDone": "Η σύνοψη αποθηκεύτηκε",
      "ov.open": "Περισσότερα",
      "ov.lessAll": "{a} λιγότερα από τον προηγούμενο μήνα", "ov.moreAll": "{a} περισσότερα από τον προηγούμενο μήνα", "ov.sameAll": "Όσα και τον προηγούμενο μήνα"
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
  function lastDayOf(mk) { return mk + "-" + (O.daysIn(mk) < 10 ? "0" : "") + O.daysIn(mk); }

  var TITLE = { safe: "ov.safe", pace: "ov.pace", acc: "ov.acc", lim: "ov.lim", up: "ov.up", goal: "ov.goal", loan: "ov.loan", top: "ov.top" };
  var BUILD = { safe: cardSafe, pace: cardPace, acc: cardAcc, lim: cardLim, up: cardUp, goal: cardGoal, loan: cardLoan, top: cardTop };

  function render(box) {
    A.hideTip();
    box.innerHTML = "";
    var grid = el("div", "ov-grid");
    box.appendChild(grid);
    O.cardList(D().set.ov).forEach(function (c) {
      if (!c.on || !BUILD[c.id] || (c.id === "loan" && !A.loansCard)) return;
      var card = el("section", "card ov-card ovc-" + c.id);
      card.setAttribute("aria-labelledby", "ov-h-" + c.id);
      grid.appendChild(card);
      BUILD[c.id](card);
    });
    var edit = el("button", "txt-btn ov-edit", t("ov.edit"));
    edit.type = "button";
    edit.addEventListener("click", editDialog);
    box.appendChild(edit);
  }

  // A card's heading, with an optional link to the tab behind it.
  function head(card, id, title, linkText, onLink) {
    var h = el("div", "ov-head");
    var h2 = el("h2", "", title);
    h2.id = "ov-h-" + id;
    h.appendChild(h2);
    if (linkText) {
      var b = el("button", "mini", linkText);
      b.type = "button";
      b.addEventListener("click", onLink);
      h.appendChild(b);
    }
    card.appendChild(h);
  }
  function hint(card, text, btnText, onBtn) {
    card.appendChild(el("p", "hint", text));
    if (btnText) {
      var b = el("button", "mini ov-cta", btnText);
      b.type = "button";
      b.addEventListener("click", onBtn);
      card.appendChild(b);
    }
  }

  // ---------- safe to spend ----------
  function cardSafe(card) {
    var mk = A.viewMk(), today = A.today(), tt = A.totals(mk);
    var from = mk === today.slice(0, 7) ? P.addDays(today, 1) : mk + "-01";
    var rest = mk < today.slice(0, 7) ? [] : O.upcoming(D(), from, lastDayOf(mk));
    var s = O.safe(tt, A.limitOf("all"), rest, mk, today);
    if (s.when === "past") {
      head(card, "safe", t("ov.ended"));
      var bal = tt.inc - tt.out;
      card.appendChild(el("div", "ov-big" + (bal < 0 ? " neg" : ""), A.money(bal)));
      card.appendChild(el("p", "ov-sub", !tt.inc ? t("ov.noInc") : bal >= 0 ? t("ov.saved", { p: Math.round(bal * 100 / tt.inc) })
                                                                               : t("ov.overspent", { a: A.money(-bal) })));
      return;
    }
    if (s.when === "ahead") {
      head(card, "safe", t("ov.ahead"));
      var net = s.upIn - s.upOut;
      card.appendChild(el("div", "ov-big" + (net < 0 ? " neg" : ""), A.money(net)));
      card.appendChild(el("p", "ov-sub", t("ov.plan", { i: A.money(s.upIn), o: A.money(s.upOut) })));
      return;
    }
    head(card, "safe", t("ov.safe"));
    var big = el("div", "ov-big" + (s.left < 0 ? " neg" : ""), s.left < 0 ? A.money(0) : t("ov.perDay", { a: A.money(s.perDay) }));
    card.appendChild(big);
    card.appendChild(el("p", "ov-sub", s.days > 1 ? t("ov.days", { n: s.days }) : t("ov.day1")));
    var line = s.left >= 0 ? t(s.mode === "limit" ? "ov.leftLim" : "ov.leftInc", { a: A.money(s.left) })
                           : t(s.mode === "limit" ? "ov.overLim" : "ov.overInc", { a: A.money(-s.left) });
    card.appendChild(el("p", "ov-line" + (s.left < 0 ? " neg" : ""), line));
    if (s.upIn || s.upOut) card.appendChild(el("p", "hint", t("ov.toCome", { i: A.money(s.upIn), o: A.money(s.upOut) })));
    if (s.mode === "income") card.appendChild(el("p", "hint", t("ov.noLim")));
  }

  // ---------- spending pace ----------
  function cardPace(card) {
    head(card, "pace", t("ov.pace"));
    var mk = A.viewMk(), pc = O.pace(D().tx, mk, A.today()), limit = A.limitOf("all");
    if (!pc.upto) { card.appendChild(el("p", "hint", t("ov.ahead.pace"))); return; }
    var lastCur = pc.cur[pc.cur.length - 1] || 0;
    if (!lastCur && !pc.prev[pc.days - 1]) { card.appendChild(el("p", "hint", t("ov.paceNone"))); return; }
    // How this month compares with the last one on the same day
    var i = pc.upto - 1, diff = lastCur - pc.prev[i];
    var sfx = pc.upto === pc.days ? "All" : "";   // a whole month: against the whole month before
    var msg = diff < 0 ? t("ov.less" + sfx, { a: A.money(-diff) }) : diff > 0 ? t("ov.more" + sfx, { a: A.money(diff) }) : t("ov.same" + sfx);
    card.appendChild(el("p", "ov-line" + (diff > 0 ? " neg" : " good"), msg));
    var legend = el("div", "legend wrap");
    function lg(cls, text) {
      var s = el("span", "lg");
      var k = el("span", "ov-key " + cls);
      k.setAttribute("aria-hidden", "true");
      s.appendChild(k);
      s.appendChild(el("span", "", text));
      legend.appendChild(s);
    }
    lg("k-cur", t("ov.thisM"));
    lg("k-prev", t("ov.lastM"));
    if (pc.avgN) lg("k-avg", t("ov.avg", { n: pc.avgN }));
    if (limit) lg("k-lim", t("ov.limit"));
    card.appendChild(legend);
    var box = el("div", "ov-chart");
    card.appendChild(box);
    var W = A.chartWidth(box), H = 190, L = 50, Rm = 8, T = 10, B = 22;
    var max = Math.max.apply(null, [1, lastCur, pc.prev[pc.days - 1] || 0, limit || 0].concat(pc.avg.length ? [pc.avg[pc.days - 1]] : []));
    var step = A.niceStep(max / 4), topV = Math.max(step, Math.ceil(max / step) * step);
    var pw = W - L - Rm, ph = H - T - B;
    var x = function (d) { return L + (pc.days > 1 ? d * pw / (pc.days - 1) : 0); };
    var y = function (v) { return T + ph - v / topV * ph; };
    var svg = A.sv("svg", { viewBox: "0 0 " + W + " " + H, width: W, height: H, "class": "chart pace", role: "img",
                            "aria-label": t("ov.pace") + ", " + A.monthLabel(mk) + ": " + msg });
    for (var v = 0; v <= topV + 0.5; v += step) {
      svg.appendChild(A.sv("line", { x1: L, x2: W - Rm, y1: y(v), y2: y(v), "class": v === 0 ? "base" : "grid" }));
      svg.appendChild(A.svText(L - 6, y(v) + 4, A.moneyShort(v), "ax", "end"));
    }
    [1, 8, 15, 22, pc.days].forEach(function (d) {
      svg.appendChild(A.svText(x(d - 1), H - 6, String(d), "ax", "middle"));
    });
    function path(arr, cls) {
      if (!arr.length) return;
      var d = arr.map(function (val, j) { return (j ? "L" : "M") + x(j).toFixed(1) + "," + y(val).toFixed(1); }).join(" ");
      svg.appendChild(A.sv("path", { d: d, "class": "line " + cls }));
    }
    if (limit) {
      svg.appendChild(A.sv("line", { x1: L, x2: W - Rm, y1: y(limit), y2: y(limit), "class": "ov-lim" }));
      svg.appendChild(A.sv("line", { x1: x(0), x2: x(pc.days - 1), y1: y(0), y2: y(limit), "class": "ov-ideal" }));
    }
    path(pc.avg, "ov-avg");
    path(pc.prev, "ov-prev");
    path(pc.cur, "ov-cur");
    svg.appendChild(A.sv("circle", { cx: x(i), cy: y(lastCur), r: 4, "class": "dot ov-dot" }));
    var colW = pc.days > 1 ? pw / (pc.days - 1) : pw;
    for (var d = 0; d < pc.days; d++) {
      var parts = [t("ov.dayTip", { d: d + 1, a: d < pc.upto ? A.money(pc.cur[d]) : "–" }), t("ov.dayTipPrev", { a: A.money(pc.prev[d]) })];
      if (pc.avg.length) parts.push(t("ov.dayTipAvg", { a: A.money(pc.avg[d]) }));
      var target = A.sv("rect", { x: Math.max(L, x(d) - colW / 2), y: T, width: colW, height: ph, fill: "transparent" });
      A.hit(target, parts.join(" · "), null);
      target.removeAttribute("tabindex");   // 31 stops are too many for the keyboard: the table below has them all
      svg.appendChild(target);
    }
    box.appendChild(svg);
    var rows = [];
    for (var r = 0; r < pc.days; r++) {
      var row = [String(r + 1), r < pc.upto ? A.money(pc.cur[r]) : "–", A.money(pc.prev[r])];
      if (pc.avg.length) row.push(A.money(pc.avg[r]));
      rows.push(row);
    }
    var cols = [t("ov.day"), t("ov.thisM"), t("ov.lastM")];
    if (pc.avg.length) cols.push(t("ov.avg", { n: pc.avgN }));
    card.appendChild(A.tableTwin(cols, rows));
  }

  // ---------- accounts ----------
  // Each account: its balance today and what came in, went out and the
  // difference in the month you are looking at; on top the total of all.
  function flowLine(f) {
    var net = f.inc - f.out;
    var line = el("span", "ov-flow");
    line.appendChild(el("span", "in", "+" + A.money(f.inc)));
    line.appendChild(el("span", "", "−" + A.money(f.out)));
    line.appendChild(el("span", net < 0 ? "neg" : "pos", "= " + (net < 0 ? "−" : "+") + A.money(Math.abs(net))));
    return line;
  }
  function flowAria(f) {
    return t("ov.flowAria", { i: A.money(f.inc), o: A.money(f.out), d: A.money(f.inc - f.out) });
  }
  // BK-7: under an account, the balance of each bank that fills it (as
  // read on the last update, BK-5) and Match when Budget differs on that
  // day; nothing changes without the button (Undo).
  function bankLines(li, a, bnk) {
    if (!li || !A.accBalAt) return;
    bnk.forEach(function (r) {
      if (r.ac !== a.id || !r.bc || r.bc !== (a.cur || A.cur())) return;
      var hasB = typeof r.bb === "number", hasA = typeof r.ba === "number";
      if (!hasB && !hasA) return;
      var line = el("div", "ov-bkline");
      // BK-8: a card shows its debt and what is left to spend
      var txt = !hasB ? t("ov.bkAvail", { v: A.money(r.ba, r.bc), d: A.dateShort(r.bd) })
              : hasA ? t("ov.bkBoth", { a: A.money(r.bb, r.bc), v: A.money(r.ba, r.bc), d: A.dateShort(r.bd) })
              : t("ov.bkBal", { a: A.money(r.bb, r.bc), d: A.dateShort(r.bd) });
      line.appendChild(el("span", "", txt));
      if (!hasB) { li.appendChild(line); return; }
      var mine = A.accBalAt(a.id, r.bd);
      if (mine === r.bb) line.appendChild(el("span", "ov-bk-ok", " · " + t("ov.bkSame")));
      else if (mine !== null && A.shiftStart) {
        var diff = r.bb - mine;
        var b = el("button", "mini", t("ov.bkMatch"));
        b.type = "button";
        b.title = t("ov.bkMatchHint");
        b.setAttribute("aria-label", t("ov.bkMatch") + ": " + a.n + ", " + t("ov.bkBal", { a: A.money(r.bb, r.bc), d: A.dateShort(r.bd) }));
        b.addEventListener("click", function () { A.shiftStart(a.id, diff, t("ov.bkMatched", { a: A.money(diff, r.bc) })); });
        line.appendChild(b);
      }
      li.appendChild(line);
    });
  }
  // CC-1: a credit card's cycle under its account: the last statement,
  // what was paid, what is left by the due date, the interest estimate.
  function cycleLines(li, a) {
    if (!li || !A.cardCycle) return;
    var c = A.cardCycle(a.id);
    if (!c) return;
    var cu = a.cur || A.cur();
    var line = el("div", "ov-bkline ov-cy" + (c.state === "late" ? " late" : ""));
    var parts;
    if (c.state === "none") parts = [t("ov.cyNone", { d: A.dateShort(c.s) })];
    else {
      parts = [t("ov.cyStmt", { d: A.dateShort(c.s), a: A.money(c.stmt, cu) })];
      if (c.paid && c.left) parts.push(t("ov.cyPaid", { a: A.money(c.paid, cu) }));
      if (c.state === "paid") parts.push(t("ov.cyAll"));
      else if (c.state === "late") parts.push(t("ov.cyLate", { a: A.money(c.left, cu), d: A.dateShort(c.due) }));
      else parts.push(t("ov.cyLeft", { a: A.money(c.left, cu), d: A.dateShort(c.due) }) + " (" + (c.days > 1 ? t("ov.cyDays", { n: c.days }) : c.days === 1 ? t("ov.cyTomorrow") : t("ov.cyToday")) + ")");
    }
    line.appendChild(el("span", "", parts.join(" · ")));
    li.appendChild(line);
    if (c.est || A.addCardFee) {
      var l2 = el("div", "ov-bkline ov-cy");
      if (c.est) l2.appendChild(el("span", "", t("ov.cyEst", { a: A.money(c.est, cu) })));
      if (A.addCardFee) {
        var b = el("button", "mini", t("ov.cyFee"));
        b.type = "button";
        b.setAttribute("aria-label", t("ov.cyFeeTip", { a: a.n }));
        b.addEventListener("click", function () { A.addCardFee(a.id, c.est); });
        l2.appendChild(b);
      }
      li.appendChild(l2);
    }
  }
  // INV-1: under an investment account, what was paid, the gain or
  // loss, and the price it was valued at (live, or typed on a day).
  function investLines(li, a, iv, paid) {
    if (!li || !iv) return;
    var cu = a.cur || A.cur(), line = el("div", "ov-bkline ov-iv");
    if (!iv.val) {
      line.appendChild(el("span", "", iv.live ? (iv.failed ? t("ov.ivNoPrice") : t("ov.ivLoading")) : t("ov.ivType")));
      li.appendChild(line);
      return;
    }
    var gain = iv.val.v - paid, parts = [t("ov.ivPaid", { a: A.money(paid, cu) })];
    var pct = paid > 0 ? Math.round(gain / paid * 1000) / 10 : null;
    parts.push((gain >= 0 ? "+" : "") + A.money(gain, cu) + (pct !== null ? " (" + (pct >= 0 ? "+" : "") + String(pct).replace(".", A.lang === "el" ? "," : ".") + " %)" : ""));
    line.appendChild(el("span", "", parts.join(" · ")));
    li.appendChild(line);
    var l2 = el("div", "ov-bkline ov-iv");
    var unit = iv.c.k === "m" ? (iv.c.u === "g" ? t("ov.ivG") : t("ov.ivOz")) : "";
    var when = iv.val.src === "live" ? (A.whenShort ? A.whenShort(iv.val.t) : "") + (iv.failed ? " · " + t("ov.ivOld") : "") : iv.val.d ? A.dateShort(iv.val.d) : "";
    l2.appendChild(el("span", "", t("ov.ivPx", { q: iv.c.q.toLocaleString(A.lang === "el" ? "el-GR" : "en-GB", { maximumFractionDigits: 12 }) + (unit ? " " + unit : ""),
      s: iv.c.s, p: A.money(iv.val.px, cu), w: when }) + (iv.val.src === "live" ? " · CoinGecko" : "")));
    li.appendChild(l2);
  }
  function cardAcc(card) {
    var list = A.accs();
    head(card, "acc", t("ov.acc"), list.length ? t("ov.open") : null, A.accountsDialog);
    if (!list.length) { hint(card, t("ov.accNone"), t("ov.accAdd"), A.accountsDialog); return; }
    var mk = A.viewMk(), tt = A.totals(mk);
    var flows = O.perAccount(D().tx, mk, list.map(function (a) { return a.id; }));
    var nw = P.netWorth(D(), A.today(), A.cur(), A.fx, A.investValue);
    var top = el("div", "ov-nw");
    top.appendChild(el("span", "ov-k", t("ov.nw")));
    top.appendChild(el("span", "ov-big" + (nw.tot < 0 ? " neg" : ""), A.money(nw.tot)));
    var all = { inc: tt.inc, out: tt.out };
    var tl = el("span", "ov-k ov-mk", t("ov.flowAll", { m: A.monthLabel(mk) }));
    top.appendChild(tl);
    var fl = flowLine(all);
    fl.setAttribute("aria-label", t("ov.flowAll", { m: A.monthLabel(mk) }) + ": " + flowAria(all));
    top.appendChild(fl);
    card.appendChild(top);
    var bal = A.balNow();
    var ul = el("ul", "ov-rows ov-accs");
    function row(name, col, balTxt, neg, f, onClick, onEdit) {
      var li = el("li");
      if (onEdit) li.className = "ov-acc-li";
      var b = el(onClick ? "button" : "div", "ov-row ov-accrow");
      if (onClick) { b.type = "button"; b.addEventListener("click", onClick); }
      var l1 = el("span", "ov-top-l");
      l1.appendChild(A.swatch(col));
      l1.appendChild(el("span", "ov-n", name));
      if (balTxt) l1.appendChild(el("span", "ov-v" + (neg ? " neg" : ""), balTxt));
      b.appendChild(l1);
      b.appendChild(flowLine(f));
      b.setAttribute("aria-label", (onClick ? t("ov.accTip", { a: name }) : name) + (balTxt ? ", " + balTxt : "") + ", " + flowAria(f));
      li.appendChild(b);
      if (onEdit) {
        var e = el("button", "icon-btn ov-acc-edit");
        e.type = "button";
        e.innerHTML = A.icon("edit");
        e.setAttribute("aria-label", t("ov.accEdit", { a: name }));
        e.addEventListener("click", onEdit);
        li.appendChild(e);
      }
      ul.appendChild(li);
    }
    var bnk = (D().bnk || []).filter(function (r) { return r && r.src !== "pp"; });
    list.forEach(function (a) {
      var iv = A.investInfo ? A.investInfo(a) : null, shown = iv && iv.val ? iv.val.v : bal[a.id];
      row(a.n, a.col, A.money(shown, a.cur), shown < 0, flows.by[a.id], function () { A.showFilter("a:" + a.id); },
          A.accDialog ? function () { A.accDialog(a.id); } : null);
      bankLines(ul.lastChild, a, bnk);
      cycleLines(ul.lastChild, a);
      investLines(ul.lastChild, a, iv, bal[a.id]);
    });
    if (flows.none.inc || flows.none.out) row(t("ov.noAcc"), 8, "", false, flows.none, null);
    card.appendChild(ul);
    // banks linked, none filling an account: say where that is set
    if (bnk.length && !bnk.some(function (r) { return r.ac; }) && A.banksOpen) {
      var um = el("p", "hint ov-bk-um", t("ov.bkUnmapped") + " ");
      var go = el("button", "link-btn", t("ov.bkBanks"));
      go.type = "button";
      go.addEventListener("click", A.banksOpen);
      um.appendChild(go);
      card.appendChild(um);
    }
    card.appendChild(el("p", "hint ov-foot", t("ov.flowHint")));
    // New account (a wallet, cash) and, with banks linked, an update now.
    var acts = el("div", "ov-acts");
    var bk = A.bankState ? A.bankState() : null;
    if (bk && bk.linked) {
      var ub = el("button", "mini", bk.busy ? t("ov.bkBusy") : t("ov.bkNow"));
      ub.type = "button";
      ub.disabled = bk.busy || !bk.reach;
      ub.addEventListener("click", function () {
        ub.disabled = true;
        ub.textContent = t("ov.bkBusy");
        A.bankRefresh();
      });
      acts.appendChild(ub);
      acts.appendChild(el("span", "hint ov-bk-when", !bk.reach ? t("ov.bkWeb") : bk.last ? t("ov.bkLast", { d: A.whenShort(bk.last) }) : t("ov.bkNever")));
    }
    if (A.accDialog) {
      var nb = el("button", "mini", t("ov.accNew"));
      nb.type = "button";
      nb.addEventListener("click", function () { A.accDialog(null); });
      acts.appendChild(nb);
    }
    if (acts.childNodes.length) card.appendChild(acts);
  }

  // ---------- limits ----------
  function ring(pct, st) {
    var R = 20, C = 2 * Math.PI * R;
    var svg = A.sv("svg", { viewBox: "0 0 48 48", width: 48, height: 48, "class": "ov-ring " + st, "aria-hidden": "true" });
    svg.appendChild(A.sv("circle", { cx: 24, cy: 24, r: R, "class": "ov-ring-bg" }));
    var f = Math.max(0, Math.min(1, pct / 100));
    if (f > 0) svg.appendChild(A.sv("circle", { cx: 24, cy: 24, r: R, "class": "ov-ring-fg",
      "stroke-dasharray": (C * f).toFixed(2) + " " + C.toFixed(2), transform: "rotate(-90 24 24)" }));
    svg.appendChild(A.svText(24, 28, Math.min(pct, 999) + "%", "ov-ring-t", "middle"));
    return svg;
  }
  function cardLim(card) {
    head(card, "lim", t("ov.lim"), t("ov.open"), function () { A.setTab("limits"); });
    var tt = A.totals(A.viewMk()), items = [];
    var all = A.limitOf("all");
    A.cats().forEach(function (c) {
      if (c.k !== "o") return;
      var l = A.limitOf(c.id);
      if (l) items.push({ name: c.name, col: c.col, spent: tt.byCat["o:" + c.id] || 0, limit: l });
    });
    A.budgets().forEach(function (b) { items.push(b); });   // flexible budgets running today (C3)
    items.sort(function (x, y) { return y.spent * x.limit - x.spent * y.limit || x.name.localeCompare(y.name); });
    items = items.slice(0, all ? 3 : 4);
    if (all) items.unshift({ name: t("ov.limAll"), col: null, spent: tt.out, limit: all });
    if (!items.length) { hint(card, t("ov.limNone"), t("ov.limSet"), function () { A.setTab("limits"); }); return; }
    var grid = el("div", "ov-rings");
    items.forEach(function (it) {
      var pct = Math.round(it.spent * 100 / it.limit), st = A.limitState(it.spent, it.limit);
      var b = el("button", "ov-ring-b");
      b.type = "button";
      var left = it.limit - it.spent;
      var sub = left >= 0 ? t("ov.limLeft", { a: A.money(left) }) : t("ov.limOver", { a: A.money(-left) });
      b.setAttribute("aria-label", it.name + ": " + pct + "%, " + sub);
      b.appendChild(ring(pct, st));
      var txt = el("span", "ov-ring-l");
      txt.appendChild(el("span", "ov-n", it.name));
      txt.appendChild(el("span", "ov-s " + st, sub));
      b.appendChild(txt);
      b.addEventListener("click", function () { A.setTab("limits"); });
      grid.appendChild(b);
    });
    card.appendChild(grid);
  }

  // ---------- next 7 days ----------
  function cardUp(card) {
    head(card, "up", t("ov.up"), t("ov.open"), function () { A.setTab("rec"); });
    var today = A.today(), tomorrow = P.addDays(today, 1);
    var list = O.upcoming(D(), today, P.addDays(today, 6));
    if (!list.length) { hint(card, t("ov.upNone")); return; }
    var inc = 0, out = 0;
    var ul = el("ul", "ov-rows");
    list.forEach(function (o) {
      if (o.k === "i") inc += o.a; else out += o.a;
      var li = el("li");
      var b = el("button", "ov-row");
      b.type = "button";
      var when = o.d === today ? t("ov.today") : o.d === tomorrow ? t("ov.tomorrow") : A.dayLabel(o.d);
      var name = o.n || A.catName(o.c);
      b.setAttribute("aria-label", when + ", " + name + ", " + (o.k === "i" ? "+" : "−") + A.money(o.a));
      b.appendChild(A.swatch(A.catCol(o.c)));
      var mid = el("span", "ov-n");
      mid.appendChild(el("span", "ov-when", when));
      mid.appendChild(el("span", "", name));
      b.appendChild(mid);
      b.appendChild(el("span", "ov-v" + (o.k === "i" ? " in" : ""), (o.k === "i" ? "+" : "−") + A.money(o.a)));
      b.addEventListener("click", function () { A.setTab("rec"); A.recDialog(o.id); });
      li.appendChild(b);
      ul.appendChild(li);
    });
    card.appendChild(ul);
    card.appendChild(el("p", "hint ov-foot", t("ov.upSum", { i: A.money(inc), o: A.money(out) })));
  }

  // ---------- loans and debts (budget/loansui.js) ----------
  function cardLoan(card) {
    head(card, "loan", t("ov.loan"), t("ov.open"), function () { A.setTab("plan"); });
    A.loansCard(card);
  }

  // ---------- savings goals ----------
  function goalSaved(g) {
    if (!g.ac) return g.sv;
    var nw = A.accBalanceMain(g.ac);
    return nw === null ? g.sv : nw;
  }
  function cardGoal(card) {
    var goals = D().goal || [];
    head(card, "goal", t("ov.goal"), goals.length ? t("ov.open") : null, function () { A.setTab("plan"); });
    if (!goals.length) { hint(card, t("ov.goalNone"), A.goalDialog ? t("ov.goalNew") : null, function () { A.goalDialog(null); }); return; }
    var list = goals.slice().sort(function (a, b) {
      var x = a.d || "9999", y = b.d || "9999";
      return x < y ? -1 : x > y ? 1 : a.n.localeCompare(b.n);
    }).slice(0, 4);
    list.forEach(function (g) {
      var st = P.goalStatus(g, goalSaved(g), A.today());
      var b = el("button", "ov-goal");
      b.type = "button";
      b.addEventListener("click", function () { A.setTab("plan"); });
      var top = el("span", "ov-goal-top");
      top.appendChild(A.swatch(g.col));
      top.appendChild(el("span", "ov-n", g.n));
      top.appendChild(el("span", "ov-v", st.pct + "%"));
      b.appendChild(top);
      var bar = el("span", "bar " + (st.late ? "over" : "ok"));
      bar.setAttribute("role", "progressbar");
      bar.setAttribute("aria-valuemin", "0");
      bar.setAttribute("aria-valuemax", "100");
      bar.setAttribute("aria-valuenow", String(st.pct));
      bar.setAttribute("aria-label", g.n + ": " + st.pct + "%");
      var f = el("span");
      f.style.width = st.pct + "%";
      f.style.background = "var(--c" + g.col + ")";
      bar.appendChild(f);
      b.appendChild(bar);
      b.appendChild(el("span", "ov-s", A.money(st.saved) + " / " + A.money(g.t)));
      card.appendChild(b);
    });
  }

  // ---------- where the money went ----------
  function cardTop(card) {
    var mk = A.viewMk();
    head(card, "top", t("ov.top"), t("ov.open"), function () { A.setTab("charts"); });
    var list = O.topCats(A.rolledTx ? A.rolledTx() : D().tx, mk, 5);
    if (!list.length) { hint(card, t("ov.topNone")); return; }
    var ul = el("ul", "ov-rows");
    list.forEach(function (r) {
      var name = A.catName(r.c);
      var li = el("li");
      var b = el("button", "ov-row ov-toprow");
      b.type = "button";
      var chg = r.pct === null ? t("ov.new.aria") : r.pct >= 0 ? t("ov.up%", { p: r.pct }) : t("ov.down%", { p: -r.pct });
      b.setAttribute("aria-label", name + ", " + A.money(r.a) + ", " + chg);
      var line = el("span", "ov-top-l");
      line.appendChild(A.swatch(A.catCol(r.c)));
      line.appendChild(el("span", "ov-n", name));
      var chip = el("span", "ov-chip " + (r.pct === null ? "new" : r.pct > 0 ? "up" : r.pct < 0 ? "down" : "flat"),
                    r.pct === null ? t("ov.new") : (r.pct > 0 ? "▲ " : r.pct < 0 ? "▼ " : "") + Math.abs(r.pct) + "%");
      chip.title = chg;
      line.appendChild(chip);
      line.appendChild(el("span", "ov-v", A.money(r.a)));
      b.appendChild(line);
      var bar = el("span", "rank-bar");
      var f = el("span");
      f.style.width = (r.a * 100 / list[0].a) + "%";
      f.style.background = "var(--c" + A.catCol(r.c) + ")";
      bar.appendChild(f);
      b.appendChild(bar);
      b.addEventListener("click", function () { A.showFilter("c:" + r.c); });
      li.appendChild(b);
      ul.appendChild(li);
    });
    card.appendChild(ul);
  }

  // ---------- edit: which cards, in what order ----------
  function editDialog() {
    var list = O.cardList(D().set.ov);
    var dlg = A.makeDialog("bd-ov", t("ov.edit"));
    dlg.appendChild(el("p", "hint", t("ov.editHint")));
    var ul = el("ul", "ov-edit-list");
    dlg.appendChild(ul);
    function draw(focusId, focusDir) {
      ul.innerHTML = "";
      list.forEach(function (c, i) {
        if (!c.known) return;   // a newer Budget's card: kept, not shown here
        var li = el("li");
        var id = "ov-cb-" + c.id;
        var cb = el("input");
        cb.type = "checkbox";
        cb.id = id;
        cb.checked = c.on;
        cb.addEventListener("change", function () { c.on = cb.checked; });
        var lab = el("label", "", t(TITLE[c.id]));
        lab.setAttribute("for", id);
        li.appendChild(cb);
        li.appendChild(lab);
        [["up", -1, "ov.upBtn", "▲"], ["down", 1, "ov.downBtn", "▼"]].forEach(function (d) {
          var b = el("button", "mini ov-mv", d[3]);
          b.type = "button";
          b.setAttribute("aria-label", t(d[2], { c: t(TITLE[c.id]) }));
          var j = i + d[1];
          b.disabled = j < 0 || j >= list.length;
          b.addEventListener("click", function () {
            var tmp = list[j]; list[j] = list[i]; list[i] = tmp;
            draw(c.id, d[0]);
          });
          li.appendChild(b);
          if (focusId === c.id && focusDir === d[0]) setTimeout(function () { (b.disabled ? cb : b).focus(); }, 0);
        });
        ul.appendChild(li);
      });
    }
    draw();
    var row = el("div", "dlg-actions");
    row.appendChild(A.button(t("ov.reset"), "", function () { list = O.cardList(""); draw(); }));
    row.appendChild(A.button(A.tt("dlg.cancel"), "", function () { dlg.close(); }));
    row.appendChild(A.button(A.tt("dlg.save"), "primary", function () {
      var v = O.cardString(list), set = D().set;
      if (v === O.cardString(O.cardList(""))) v = "";
      if ((set.ov || "") !== v) {
        if (v) set.ov = v; else delete set.ov;
        set.m = A.stamp(set.m);
        A.commit();
        A.renderAll();
        A.showToast(t("ov.saveDone"));
      }
      dlg.close();
    }));
    dlg.appendChild(row);
    A.showDialog(dlg);
  }

  root.OrosBudgetOverviewUI = {
    init: function (api) { A = api; },
    render: function (box) { if (A) render(box); },
    t: function (k, p) { return A ? t(k, p) : k; }
  };
})(typeof window !== "undefined" ? window : this);
