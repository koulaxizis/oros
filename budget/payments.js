// ============================================================
// orOS Budget — payments (budget/payments.js)
// Bring a Stripe account's balance history into Budget (integrations
// wave 4B): charges as income, Stripe's fees, refunds and disputes as
// expenses. The account and its restricted key live in the shell
// (Settings › Connected services, parent.orosLinks); this file never
// sees a key. links/pay.js builds the requests, reads the answers and
// makes the plan; here are the dialog and the one write (with Undo).
// Nothing is ever written to Stripe. Nothing of its own is stored:
// the ids of what came in (L.extId) are how the next import knows it.
// ============================================================
(function (root) {
  "use strict";
  var P = root.OrosLinksPay;
  var A = null;                                   // the app's helpers (init)

  var S = {
    en: {
      btn: "Import from Stripe", title: "Stripe",
      intro: "Bring your Stripe payments here: charges as income, Stripe's fees, refunds and disputes as expenses. Payouts to your bank are left out (they are your own money moving). orOS only reads Stripe.",
      none: "Connect Stripe in Settings › Connected services first.",
      openSettings: "Open Connected services", noShell: "Open Budget from the orOS desktop to import from Stripe.",
      acct: "Stripe account", from: "From", catIn: "Income category", catOut: "Expense category", ac: "Budget account",
      read: "Read Stripe", reading: "Reading Stripe… {n}",
      plan: "{i} income and {o} expense entries to add · {s} already here",
      gone: "{n} deleted here earlier: not brought back.",
      otherCur: "{n} in another currency than Budget's ({cur}): left out.",
      skip: "{n} payouts, transfers and other moves: left out.",
      capped: "More than {n} transactions; only the first {n} were read. Pick a later start date.",
      nothing: "Nothing new: Budget already has everything.",
      go: "Import", done: "Imported: {n} entries", fee: "Stripe fee",
      "err.auth": "Stripe refused the key. Check it in Settings › Connected services.",
      "err.denied": "The key can't read the balance. Give the restricted key read access to Balance.",
      "err.keys": "This device doesn't have the account's key yet. Enter it in Settings › Connected services.",
      "err.offline": "You're offline.", "err.busy": "Stripe asks to slow down. Try again in a minute.",
      "err.other": "Couldn't reach Stripe. Try again later.", close: "Close"
    },
    el: {
      btn: "Εισαγωγή από Stripe", title: "Stripe",
      intro: "Φέρε εδώ τις πληρωμές σου από το Stripe: οι χρεώσεις ως έσοδα, οι προμήθειες του Stripe, οι επιστροφές και οι αμφισβητήσεις ως έξοδα. Οι μεταφορές στην τράπεζά σου μένουν έξω (είναι δικά σου χρήματα που μετακινούνται). Το orOS μόνο διαβάζει το Stripe.",
      none: "Σύνδεσε πρώτα το Stripe στις Ρυθμίσεις › Συνδεδεμένες υπηρεσίες.",
      openSettings: "Άνοιγμα Συνδεδεμένων υπηρεσιών", noShell: "Άνοιξε τα Έσοδα & Έξοδα από την επιφάνεια εργασίας του orOS για εισαγωγή από Stripe.",
      acct: "Λογαριασμός Stripe", from: "Από", catIn: "Κατηγορία εσόδων", catOut: "Κατηγορία εξόδων", ac: "Λογαριασμός εδώ",
      read: "Ανάγνωση Stripe", reading: "Ανάγνωση Stripe… {n}",
      plan: "{i} έσοδα και {o} έξοδα για προσθήκη · {s} υπάρχουν ήδη",
      gone: "{n} διαγράφηκαν εδώ παλιότερα: δεν επανέρχονται.",
      otherCur: "{n} σε άλλο νόμισμα από αυτό της εφαρμογής ({cur}): μένουν έξω.",
      skip: "{n} μεταφορές στην τράπεζα και άλλες κινήσεις: μένουν έξω.",
      capped: "Πάνω από {n} συναλλαγές· διαβάστηκαν μόνο οι πρώτες {n}. Διάλεξε μεταγενέστερη ημερομηνία.",
      nothing: "Τίποτα νέο: όλα υπάρχουν ήδη εδώ.",
      go: "Εισαγωγή", done: "Εισαγωγή: {n} κινήσεις", fee: "Προμήθεια Stripe",
      "err.auth": "Το Stripe απέρριψε το κλειδί. Έλεγξέ το στις Ρυθμίσεις › Συνδεδεμένες υπηρεσίες.",
      "err.denied": "Το κλειδί δεν μπορεί να διαβάσει το υπόλοιπο. Δώσε στο restricted key δικαίωμα ανάγνωσης (Read) στο Balance.",
      "err.keys": "Αυτή η συσκευή δεν έχει ακόμα το κλειδί του λογαριασμού. Πέρασέ το στις Ρυθμίσεις › Συνδεδεμένες υπηρεσίες.",
      "err.offline": "Είσαι εκτός σύνδεσης.", "err.busy": "Το Stripe ζητά να πάμε πιο αργά. Δοκίμασε ξανά σε ένα λεπτό.",
      "err.other": "Δεν ήταν δυνατή η σύνδεση με το Stripe. Δοκίμασε αργότερα.", close: "Κλείσιμο"
    }
  };
  function t(k, params) {
    var tab = S[A && A.lang === "el" ? "el" : "en"];
    var s = tab[k] !== undefined ? tab[k] : S.en[k] !== undefined ? S.en[k] : k;
    return s.replace(/\{(\w+)\}/g, function (m, n) { return params && params[n] !== undefined ? String(params[n]) : m; });
  }
  function links() {
    try { var p = root.parent; return p && p !== root && p.orosLinks && typeof p.orosLinks.call === "function" ? p.orosLinks : null; }
    catch (e) { return null; }
  }
  function accounts() {
    var Lk = links();
    return Lk ? Lk.list().filter(function (a) { return a.p === "stripe"; }) : [];
  }
  function errText(e) {
    var c = e && e.code;
    return t(c === "auth" || c === "denied" || c === "keys" || c === "offline" || c === "busy" ? "err." + c : "err.other");
  }
  function ask(acct, req) {
    return links().call(acct, [req]).then(function (res) {
      var r = res && res[0];
      // 403: the restricted key works but lacks this permission
      var code = r && r.status === 403 ? "denied" : links().statusCode(r);
      if (code) { var e = new Error(code); e.code = code; throw e; }
      return r.data;
    });
  }
  function el(tag, cls, text) { return A.el(tag, cls, text); }

  function open() {
    var dlg = A.makeDialog("bd-pay", t("title"));
    dlg.appendChild(el("p", "pay-hint", t("intro")));
    var acts = el("div", "dlg-actions");
    var closeBtn = A.button(t("close"), "", function () { dlg.close(); });
    var Lk = links(), accts = accounts();
    if (!Lk || !accts.length) {
      dlg.appendChild(el("p", "", Lk ? t("none") : t("noShell")));
      acts.appendChild(closeBtn);
      if (Lk) acts.appendChild(A.button(t("openSettings"), "primary", function () {
        dlg.close();
        try { root.parent.__orosOpenAt("settings", { section: "services" }); } catch (e) {}
      }));
      dlg.appendChild(acts);
      A.showDialog(dlg);
      return;
    }
    var sel = el("select");
    accts.forEach(function (a) { var o = el("option", "", a.name); o.value = a.id; sel.appendChild(o); });
    sel.setAttribute("data-k", "pay.acct");
    dlg.appendChild(A.field(t("acct"), sel, "bd-pay-acct"));
    var from = el("input");
    from.type = "date";
    from.value = A.daysAgo(30);
    from.setAttribute("data-k", "pay.from");
    var row = el("div", "fld-row");
    row.appendChild(A.field(t("from"), from, "bd-pay-from"));
    var cIn = A.catSelect("i", "i-free"), cOut = A.catSelect("o", "o-bills");
    row.appendChild(A.field(t("catIn"), cIn, "bd-pay-cin"));
    dlg.appendChild(row);
    var row2 = el("div", "fld-row");
    row2.appendChild(A.field(t("catOut"), cOut, "bd-pay-cout"));
    var acSel = null;
    if (A.hasAccounts()) { acSel = A.accSelect(""); row2.appendChild(A.field(t("ac"), acSel, "bd-pay-ac")); }
    dlg.appendChild(row2);
    var msg = el("div", "pay-msg");
    msg.setAttribute("aria-live", "polite");
    dlg.appendChild(msg);
    var items = null, capped = false, plan = null, busy = false;
    var go = A.button(t("read"), "primary", function () {
      if (busy) return;
      if (!items) return readNow();
      apply();
    });
    go.setAttribute("data-k", "pay.go");
    acts.appendChild(closeBtn);
    acts.appendChild(go);
    dlg.appendChild(acts);
    function reset() { items = null; plan = null; msg.textContent = ""; go.textContent = t("read"); go.disabled = false; }
    [sel, from].forEach(function (x) { x.addEventListener("change", reset); });
    [cIn, cOut].concat(acSel ? [acSel] : []).forEach(function (x) { x.addEventListener("change", function () { if (items && !busy) compute(); }); });
    function line(text, cls) { msg.appendChild(el("p", cls || "pay-hint", text)); }
    function compute() {
      plan = P.plan(A.data(), items, { acct: sel.value, src: "Stripe", feeNote: t("fee"), catIn: cIn.value, catOut: cOut.value, ac: acSel ? acSel.value : "" });
      msg.textContent = "";
      if (capped) line(t("capped", { n: P.MAX }));
      var ni = plan.add.filter(function (x) { return x.k === "i"; }).length;
      if (!plan.add.length) line(t("nothing"), "pay-plan");
      else line(t("plan", { i: ni, o: plan.add.length - ni, s: plan.same }), "pay-plan");
      if (plan.gone) line(t("gone", { n: plan.gone }));
      if (plan.otherCur) line(t("otherCur", { n: plan.otherCur, cur: A.data().cur }));
      if (plan.skip) line(t("skip", { n: plan.skip }));
      go.textContent = t("go");
      go.disabled = !plan.add.length;
    }
    function readNow() {
      var a = sel.value, d = from.value;
      var sec = /^\d{4}-\d{2}-\d{2}$/.test(d) ? Math.floor(new Date(d + "T00:00:00").getTime() / 1000) : 0;
      busy = true;
      go.disabled = true;
      msg.textContent = t("reading", { n: 0 });
      var got = [];
      capped = false;
      (function page(after) {
        return ask(a, P.req(sec, after)).then(function (data) {
          var r = P.read(data);
          got = got.concat(r.items);
          msg.textContent = t("reading", { n: got.length });
          if (got.length >= P.MAX) { got = got.slice(0, P.MAX); capped = true; return; }
          if (r.next) return page(r.next);
        });
      })("").then(function () {
        busy = false;
        items = got;
        compute();
      }, function (e) {
        busy = false;
        go.disabled = false;
        msg.textContent = errText(e);
      });
    }
    function apply() {
      if (!plan || !plan.add.length) return;
      A.addEntries(plan.add, t("done", { n: plan.add.length }));
      dlg.close();
    }
    A.showDialog(dlg);
    sel.focus();
  }

  root.OrosBudgetPay = {
    init: function (api) { A = api; },
    open: open,
    has: function () { return !!links() && !!P; },
    label: function () { return t("btn"); }
  };
})(typeof window !== "undefined" ? window : this);
