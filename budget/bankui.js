// ============================================================
// orOS Budget — bank statement import + rules (budget/bankui.js)
// The dialogs over budget/bank.js (pure core): pick a file (CSV of
// any bank, OFX / QFX, QIF, CAMT.053), map the columns, choose the
// Budget account, see what is new / a duplicate / skipped, correct
// categories (and turn a correction into a rule), import with Undo.
// The same picker recognises the export of a personal-finance app
// (YNAB, Wallet, Spendee, Money Lover, Monefy, Money Manager, Firefly
// III; budget/import.js) and shows its own preview: accounts mapped,
// categories matched or made, currencies converted.
// Rules manager: list, edit, apply to uncategorised entries.
// Everything the app owns (data, writes, Undo, dialogs, selects)
// comes in through init(api); this file stores nothing itself.
// Every imported text is shown with textContent / option text.
// ============================================================
(function (root) {
  "use strict";
  var B = root.OrosBudgetBank;
  var A = null;
  var MAX_FILE = 8 * 1024 * 1024;
  var SHOW_ROWS = 300;

  var S = {
    en: {
      title: "Import bank statement", pick: "Choose a file",
      intro: "A statement file from your bank: CSV or Excel (any bank), OFX / QFX, QIF, CAMT.053 (XML), MT940, or PayPal's activity file. You see everything before it is added.",
      big: "The file is too big (up to 8 MB).", bad: "Couldn't read this file.", empty: "No transactions found in this file.",
      file: "{f} · {fmt} · {n} rows", other: "Another file",
      prof: "Bank profile", profNew: "New profile", profName: "Remember as", profName_ph: "Bank name, e.g. Eurobank",
      profHint: "The columns and the account are remembered under this name, on all your devices.",
      ac: "Budget account", cols: "Columns and format",
      sep: "Separator", sepTab: "Tab", enc: "Text encoding", encAuto: "Automatic: {e}",
      e_utf8: "UTF-8", e_1253: "Greek (Windows-1253)", e_88597: "Greek (ISO-8859-7)", e_1252: "Western (Windows-1252)",
      cd: "Date", df: "Date order", cp: "Description", cm: "Extra text", colNone: "None",
      amtMode: "Amounts", amtOne: "One column", amtTwo: "Debit and credit columns",
      ca: "Amount", cs: "Debit/credit marker", cdb: "Debit (money out)", ccr: "Credit (money in)",
      dec: "Number format", inv: "Expenses are positive in this file (reverse signs)",
      col: "Column {n}",
      sum: "{new} new · {dup} duplicates · {skip} skipped",
      st_new: "New", st_dup: "Looks like an entry already here", st_same: "Already imported",
      st_gone: "Deleted here earlier", st_skip: "Skipped",
      why_date: "no date", why_amount: "no amount", why_zero: "zero amount", why_cur: "another currency ({c})",
      why_pending: "not booked yet", why_memo: "a hold or note, no money moved",
      dup_inv: "Already here from Invoices", dup_xfer: "Already here as a transfer between your accounts",
      dup_pp: "Already here from PayPal (the same payment)",
      rule: "Rule: {q}", always: "Always do this",
      more: "Showing the first {s} of {n} rows. Import takes every ticked row.",
      go: "Import {n}", go0: "Import", done: "Imported {n} entries", doneU: "Imported {n} entries · {u} without a category",
      tick: "Import {t}",
      curWarn: "This file is in {c}; Budget uses {b}. Rows in {c} are left out.",
      // rules
      rules: "Rules", rulesHint: "Rules fill in the category of imported entries. When several match, the one with the longest text wins.",
      rulesEmpty: "No rules yet. Make one here, or in an import with “Always do this”.",
      newRule: "New rule", editRule: "Edit rule", apply: "Apply to uncategorised entries",
      applied: "{n} entries categorised", applied1: "1 entry categorised", applied0: "No uncategorised entry matches a rule.",
      q: "Description contains", q_ph: "e.g. LIDL", lo: "Amount from", hi: "Amount to", opt: "Optional",
      py: "Rename to", nt: "Add a note", cat: "Category", alsoNow: "Also apply to uncategorised entries now",
      needQ: "Write some text, or an amount range", needC: "Pick a category", badAmt: "Type an amount, for example 12,50",
      saved: "Rule saved", deleted: "Rule deleted",
      ruleTxt: "contains “{q}”", ruleAmt: "{a}", ruleFrom: "from {a}", ruleTo: "up to {a}",
      save: "Save", cancel: "Cancel", del: "Delete", close: "Close",
      fmt_csv: "CSV", fmt_ofx: "OFX", fmt_qif: "QIF", fmt_camt: "CAMT.053", fmt_mt940: "MT940", fmt_paypal: "PayPal",
      // exports of personal-finance apps (budget/import.js)
      appTitle: "Import from {app}", appFile: "{f} · {app} · {n} rows",
      appRange: "From {a} to {b}", appBig: "The file is too big (up to 20 MB).",
      appNoXls: "This spreadsheet isn't an export Budget knows.",
      appAccs: "Accounts", appAccHint: "Where the entries of each account in the file go.",
      appAccNew: "New account “{n}”", appAccNote: "No account (name in the note)",
      appAccN: "{a} · {n} entries",
      appMk: "Make the categories that are missing", appCats: "Categories: {m} match yours.",
      appNew: "New: {l}", appNoCat: "{n} rows stay without a category.",
      appFull: "{n} rows stay without a category: up to {max} categories.",
      appConv: "Converted to {b}: {l}. Where the file has its own converted amount, that one is used; otherwise today's rate.",
      appRate: "No exchange rate for {l}: those rows are left out. Open Budget online once and try again.",
      appCurNone: "{c} (no rate)",
      why_xfer: "transfer between accounts", why_open: "opening balance", why_rate: "no rate for {c}",
      catNone: "No category", catNew: "New category: {c}",
      appDone: "Imported {n} entries from {app}", appDoneC: "Imported {n} entries from {app} · new categories: {c}"
    },
    el: {
      title: "Εισαγωγή κίνησης λογαριασμού", pick: "Επιλογή αρχείου",
      intro: "Ένα αρχείο κινήσεων από την τράπεζά σου: CSV ή Excel (οποιασδήποτε τράπεζας), OFX / QFX, QIF, CAMT.053 (XML), MT940 ή το αρχείο δραστηριότητας του PayPal. Βλέπεις τα πάντα πριν προστεθούν.",
      big: "Το αρχείο είναι πολύ μεγάλο (έως 8 MB).", bad: "Δεν ήταν δυνατή η ανάγνωση του αρχείου.", empty: "Δεν βρέθηκαν κινήσεις σε αυτό το αρχείο.",
      file: "{f} · {fmt} · {n} γραμμές", other: "Άλλο αρχείο",
      prof: "Προφίλ τράπεζας", profNew: "Νέο προφίλ", profName: "Αποθήκευση ως", profName_ph: "Όνομα τράπεζας, π.χ. Eurobank",
      profHint: "Οι στήλες και ο λογαριασμός θυμούνται με αυτό το όνομα, σε όλες τις συσκευές σου.",
      ac: "Λογαριασμός εδώ", cols: "Στήλες και μορφή",
      sep: "Διαχωριστικό", sepTab: "Tab", enc: "Κωδικοποίηση κειμένου", encAuto: "Αυτόματα: {e}",
      e_utf8: "UTF-8", e_1253: "Ελληνικά (Windows-1253)", e_88597: "Ελληνικά (ISO-8859-7)", e_1252: "Δυτικά (Windows-1252)",
      cd: "Ημερομηνία", df: "Σειρά ημερομηνίας", cp: "Περιγραφή", cm: "Επιπλέον κείμενο", colNone: "Καμία",
      amtMode: "Ποσά", amtOne: "Μία στήλη", amtTwo: "Στήλες χρέωσης και πίστωσης",
      ca: "Ποσό", cs: "Ένδειξη χρέωσης/πίστωσης", cdb: "Χρέωση (έξοδα)", ccr: "Πίστωση (έσοδα)",
      dec: "Μορφή αριθμών", inv: "Τα έξοδα είναι θετικά σε αυτό το αρχείο (αντιστροφή προσήμου)",
      col: "Στήλη {n}",
      sum: "{new} νέες · {dup} διπλές · {skip} παραλείπονται",
      st_new: "Νέα", st_dup: "Μοιάζει με κίνηση που υπάρχει ήδη", st_same: "Έχει ήδη εισαχθεί",
      st_gone: "Διαγράφηκε εδώ παλιότερα", st_skip: "Παραλείπεται",
      why_date: "χωρίς ημερομηνία", why_amount: "χωρίς ποσό", why_zero: "μηδενικό ποσό", why_cur: "άλλο νόμισμα ({c})",
      why_pending: "δεν έχει λογιστικοποιηθεί ακόμα", why_memo: "δέσμευση ή σημείωση, δεν κινήθηκαν χρήματα",
      dup_inv: "Υπάρχει ήδη από τα Τιμολόγια", dup_xfer: "Υπάρχει ήδη ως μεταφορά μεταξύ των λογαριασμών σου",
      dup_pp: "Υπάρχει ήδη από το PayPal (η ίδια πληρωμή)",
      rule: "Κανόνας: {q}", always: "Πάντα έτσι",
      more: "Φαίνονται οι πρώτες {s} από {n} γραμμές. Η εισαγωγή παίρνει όλες τις επιλεγμένες.",
      go: "Εισαγωγή {n}", go0: "Εισαγωγή", done: "Εισήχθησαν {n} κινήσεις", doneU: "Εισήχθησαν {n} κινήσεις · {u} χωρίς κατηγορία",
      tick: "Εισαγωγή: {t}",
      curWarn: "Το αρχείο είναι σε {c}· η εφαρμογή χρησιμοποιεί {b}. Οι γραμμές σε {c} μένουν έξω.",
      rules: "Κανόνες", rulesHint: "Οι κανόνες βάζουν μόνοι τους κατηγορία στις κινήσεις που εισάγεις. Όταν ταιριάζουν πολλοί, κερδίζει αυτός με το μεγαλύτερο κείμενο.",
      rulesEmpty: "Δεν υπάρχουν κανόνες ακόμα. Φτιάξε έναν εδώ ή σε μια εισαγωγή με «Πάντα έτσι».",
      newRule: "Νέος κανόνας", editRule: "Επεξεργασία κανόνα", apply: "Εφαρμογή στις κινήσεις χωρίς κατηγορία",
      applied: "Μπήκε κατηγορία σε {n} κινήσεις", applied1: "Μπήκε κατηγορία σε 1 κίνηση", applied0: "Καμία κίνηση χωρίς κατηγορία δεν ταιριάζει σε κανόνα.",
      q: "Η περιγραφή περιέχει", q_ph: "π.χ. ΣΚΛΑΒΕΝΙΤΗΣ", lo: "Ποσό από", hi: "Ποσό έως", opt: "Προαιρετικά",
      py: "Μετονομασία σε", nt: "Προσθήκη σημείωσης", cat: "Κατηγορία", alsoNow: "Εφαρμογή και τώρα στις κινήσεις χωρίς κατηγορία",
      needQ: "Γράψε ένα κείμενο ή ένα εύρος ποσού", needC: "Διάλεξε κατηγορία", badAmt: "Γράψε ένα ποσό, π.χ. 12,50",
      saved: "Ο κανόνας αποθηκεύτηκε", deleted: "Ο κανόνας διαγράφηκε",
      ruleTxt: "περιέχει «{q}»", ruleAmt: "{a}", ruleFrom: "από {a}", ruleTo: "έως {a}",
      save: "Αποθήκευση", cancel: "Άκυρο", del: "Διαγραφή", close: "Κλείσιμο",
      fmt_csv: "CSV", fmt_ofx: "OFX", fmt_qif: "QIF", fmt_camt: "CAMT.053", fmt_mt940: "MT940", fmt_paypal: "PayPal",
      appTitle: "Εισαγωγή από {app}", appFile: "{f} · {app} · {n} γραμμές",
      appRange: "Από {a} έως {b}", appBig: "Το αρχείο είναι πολύ μεγάλο (έως 20 MB).",
      appNoXls: "Αυτό το υπολογιστικό φύλλο δεν είναι εξαγωγή που αναγνωρίζει η εφαρμογή.",
      appAccs: "Λογαριασμοί", appAccHint: "Πού πηγαίνουν οι κινήσεις κάθε λογαριασμού του αρχείου.",
      appAccNew: "Νέος λογαριασμός «{n}»", appAccNote: "Χωρίς λογαριασμό (το όνομα στη σημείωση)",
      appAccN: "{a} · {n} κινήσεις",
      appMk: "Δημιουργία των κατηγοριών που λείπουν", appCats: "Κατηγορίες: {m} ταιριάζουν με τις δικές σου.",
      appNew: "Νέες: {l}", appNoCat: "{n} γραμμές μένουν χωρίς κατηγορία.",
      appFull: "{n} γραμμές μένουν χωρίς κατηγορία: έως {max} κατηγορίες.",
      appConv: "Μετατροπή σε {b}: {l}. Όπου το αρχείο έχει δικό του ποσό μετατροπής, χρησιμοποιείται αυτό· αλλιώς η σημερινή ισοτιμία.",
      appRate: "Δεν υπάρχει ισοτιμία για {l}: αυτές οι γραμμές μένουν έξω. Άνοιξε την εφαρμογή με σύνδεση στο διαδίκτυο και δοκίμασε ξανά.",
      appCurNone: "{c} (χωρίς ισοτιμία)",
      why_xfer: "μεταφορά μεταξύ λογαριασμών", why_open: "αρχικό υπόλοιπο", why_rate: "χωρίς ισοτιμία για {c}",
      catNone: "Χωρίς κατηγορία", catNew: "Νέα κατηγορία: {c}",
      appDone: "Εισήχθησαν {n} κινήσεις από {app}", appDoneC: "Εισήχθησαν {n} κινήσεις από {app} · νέες κατηγορίες: {c}"
    }
  };
  // orosI18n (../i18n.js): S[<pack language>] from the pack "budget".
  if (root.orosI18n) root.orosI18n.table(S, "budget", root.orosI18n.lang());
  function t(k, p) {
    var tab = (A && S[A.lang]) || S.en;
    var s = tab[k] !== undefined ? tab[k] : S.en[k] !== undefined ? S.en[k] : k;
    return s.replace(/\{(\w+)\}/g, function (m, n) { return p && p[n] !== undefined ? String(p[n]) : m; });
  }
  function el(tag, cls, text) { return A.el(tag, cls, text); }
  function opt(sel, v, label) { var o = el("option", "", label); o.value = String(v); sel.appendChild(o); return o; }
  function sel(id, pairs, value) {
    var s = el("select");
    pairs.forEach(function (p) { opt(s, p[0], p[1]); });
    s.value = String(value);
    return s;
  }
  function check(label, on, id) {
    var w = el("label", "bk-check");
    var c = el("input");
    c.type = "checkbox";
    c.checked = !!on;
    if (id) c.id = id;
    w.appendChild(c);
    w.appendChild(el("span", "", label));
    w.box = c;
    return w;
  }
  function signed(a, k) { return (k === "i" ? "+" : "−") + A.money(a); }

  // ---------- Import ----------
  // One picker for both: a bank statement, or the export of a
  // personal-finance app (budget/import.js), recognised by its header
  // row; an .xls / .xlsx is read with the vendored SheetJS.
  var IMP = root.OrosBudgetImport || null;
  var APP_MAX = 20 * 1024 * 1024;
  function isSheet(b) {
    return b.length > 4 && ((b[0] === 0x50 && b[1] === 0x4b && b[2] === 3 && b[3] === 4) ||
                            (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0));
  }
  function open() {
    A.pickFile(".csv,.txt,.tsv,.ofx,.qfx,.qif,.xml,.053,.sta,.mt940,.940,.942,.xls,.xlsx,text/csv,text/plain,application/xml,text/xml,application/x-ofx," +
               "application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").then(function (file) {
      if (!file) return;
      if (file.size > (IMP ? APP_MAX : MAX_FILE)) { A.showToast(t(IMP ? "appBig" : "big")); return; }
      var read = typeof file.arrayBuffer === "function" ? file.arrayBuffer() : new Promise(function (res, rej) {
        var fr = new FileReader();
        fr.onload = function () { res(fr.result); };
        fr.onerror = rej;
        fr.readAsArrayBuffer(file);
      });
      read.then(function (buf) { route(String(file.name || "statement"), new Uint8Array(buf)); },
                function () { A.showToast(t("bad")); });
    });
  }
  function route(name, bytes) {
    if (IMP && isSheet(bytes)) {
      A.xlsx(function (X) {
        var table = null, csv = "";
        try {
          var wb = X.read(bytes, { type: "array", cellDates: true, sheetRows: IMP.MAX_ROWS + 20 });
          (wb.SheetNames || []).some(function (sn) {
            var ws = wb.Sheets[sn];
            var tb = IMP.sheetTable(X.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" }));
            if (IMP.detect(tb.head)) { table = tb; return true; }
            if (!csv) csv = X.utils.sheet_to_csv(ws);
            return false;
          });
        } catch (e) { A.showToast(t("bad")); return; }
        if (table) { appOpen(name, IMP.parse(table)); return; }
        // Not an app's export: a bank's statement saved as a sheet.
        if (!csv || csv.length > MAX_FILE) { A.showToast(t(csv ? "big" : "appNoXls")); return; }
        preview(name, new TextEncoder().encode(csv));
      });
      return;
    }
    if (IMP) {
      try {
        var text = B.decode(bytes, "auto").text;
        if (B.detectFormat(text, name) === "csv") {
          var tb = IMP.csvTable(text);
          if (IMP.detect(tb.head)) { appOpen(name, IMP.parse(tb)); return; }
        }
      } catch (e) {}
    }
    if (bytes.length > MAX_FILE) { A.showToast(t("big")); return; }
    preview(name, bytes);
  }
  function appOpen(name, parsed) {
    if (!parsed || !parsed.items.length) { A.showToast(t("empty")); return; }
    try { appPreview(name, parsed); } catch (e) { A.showToast(t("bad")); }
  }

  // ---------- Import from a personal-finance app ----------
  function appPreview(name, parsed) {
    var app = parsed.name;
    var srcAccs = IMP.accounts(parsed);
    var st = { accMap: IMP.defaultAccMap(parsed, ctx()), mkCats: true, res: null, over: {}, uniq: 0 };
    var dlg = A.makeDialog("bd-app", t("appTitle", { app: app }));
    dlg.classList.add("wide", "bk-dlg");
    var info = el("div", "bk-file");
    var infoTxt = el("span", "bk-file-t");
    info.appendChild(infoTxt);
    info.appendChild(A.button(t("other"), "bk-other", function () { dlg.close(); open(); }));
    dlg.appendChild(info);
    var range = el("p", "hint bk-hint");
    dlg.appendChild(range);

    // The app's accounts → Budget accounts / a new one / the note.
    if (srcAccs.length) {
      var det = el("details", "bk-cols");
      det.open = A.hasAccounts();
      det.appendChild(el("summary", "", t("appAccs")));
      var box = el("div", "bk-cols-body");
      box.appendChild(el("p", "hint", t("appAccHint")));
      srcAccs.forEach(function (a) {
        var key = B.fold(a.name);
        var s = el("select");
        A.accs().forEach(function (x) { opt(s, x.id, x.n); });
        opt(s, "new", t("appAccNew", { n: a.name }));
        opt(s, "", t("appAccNote"));
        s.value = st.accMap[key] || "";
        if (s.value !== (st.accMap[key] || "")) s.value = "";
        s.addEventListener("change", function () { st.accMap[key] = s.value; st.over = {}; refresh(); });
        box.appendChild(A.field(t("appAccN", { a: a.name, n: a.n }), s, "ap-ac" + (++st.uniq)));
      });
      det.appendChild(box);
      dlg.appendChild(det);
    }
    var mk = check(t("appMk"), true, "ap-mk");
    mk.box.addEventListener("change", function () { st.mkCats = mk.box.checked; refresh(); });
    dlg.appendChild(mk);
    var catP = el("p", "hint bk-hint");
    dlg.appendChild(catP);
    var warn = el("p", "bk-warn");
    warn.hidden = true;
    dlg.appendChild(warn);
    var conv = el("p", "hint");
    conv.hidden = true;
    dlg.appendChild(conv);
    var sum = el("p", "bk-sum");
    sum.setAttribute("aria-live", "polite");
    dlg.appendChild(sum);
    var list = el("ul", "bk-list");
    dlg.appendChild(list);
    var moreP = el("p", "hint");
    moreP.hidden = true;
    dlg.appendChild(moreP);
    var acts = el("div", "dlg-actions");
    acts.appendChild(A.button(t("cancel"), "", function () { dlg.close(); }));
    var go = A.button(t("go0"), "primary", doImport);
    go.setAttribute("data-k", "ap.go");
    acts.appendChild(go);
    dlg.appendChild(acts);

    function ctx() {
      var D = A.data();
      return { tx: D.tx, tombs: D.tombs, rules: D.rule, cur: A.cur(), cats: A.importCats(), accs: D.acc,
               fx: A.fx, maxCats: A.maxCats, maxAcc: A.maxAcc };
    }
    function curList(m) {
      return Object.keys(m).sort().map(function (c) { return c + " (" + m[c] + ")"; }).join(", ");
    }
    function refresh() {
      st.res = IMP.plan(parsed, ctx(), { acc: st.accMap, mkCats: st.mkCats });
      st.res.rows.forEach(function (r) {
        var o = r.id && st.over[r.id];
        if (o && o.on !== undefined && r.st !== "same" && r.st !== "skip") r.on = o.on;
      });
      var inf = st.res.info;
      infoTxt.textContent = t("appFile", { f: B.clean(name, 60), app: app, n: parsed.items.length });
      range.textContent = inf.from ? t("appRange", { a: A.dateShort(inf.from), b: A.dateShort(inf.to) }) : "";
      var lines = [t("appCats", { m: inf.matched })];
      if (st.res.newCats.length) lines.push(t("appNew", { l: st.res.newCats.map(function (c) { return c.name; }).join(", ") }));
      if (inf.nocat) lines.push(t("appNoCat", { n: inf.nocat }));
      if (inf.full) lines.push(t("appFull", { n: inf.full, max: A.maxCats }));
      catP.textContent = lines.join(" ");
      var noRate = Object.keys(inf.rate);
      warn.hidden = !noRate.length;
      warn.textContent = noRate.length ? t("appRate", { l: curList(inf.rate) }) : "";
      var cv = Object.keys(inf.conv);
      conv.hidden = !cv.length;
      conv.textContent = cv.length ? t("appConv", { b: A.cur(), l: curList(inf.conv) }) : "";
      draw();
    }
    function count() {
      var c = B.counts(st.res.rows);
      go.textContent = c.on ? t("go", { n: c.on }) : t("go0");
      go.disabled = !c.on;
      return c;
    }
    function draw() {
      var c = count();
      sum.textContent = t("sum", { "new": c["new"], dup: c.dup + c.same + c.gone, skip: c.skip });
      list.innerHTML = "";
      st.res.rows.slice(0, SHOW_ROWS).forEach(function (r) { list.appendChild(rowEl(r)); });
      moreP.hidden = st.res.rows.length <= SHOW_ROWS;
      moreP.textContent = t("more", { s: SHOW_ROWS, n: st.res.rows.length });
    }
    function catText(r) {
      if (r.st === "skip") return "";
      if (r.newCat) return t("catNew", { c: r.cat });
      return r.c ? A.catName(r.c) : t("catNone");
    }
    function rowEl(r) {
      var li = el("li", "bk-row bk-" + r.st + (r.on ? " on" : ""));
      var top = el("div", "bk-top");
      var box = el("input");
      box.type = "checkbox";
      box.checked = r.on;
      box.disabled = r.st === "same" || r.st === "skip";
      box.id = "ap-r" + (++st.uniq);
      box.setAttribute("aria-label", t("tick", { t: (r.d ? A.dateShort(r.d) + ", " : "") + (r.text || "") }));
      box.addEventListener("change", function () {
        r.on = box.checked;
        (st.over[r.id] = st.over[r.id] || {}).on = r.on;
        li.classList.toggle("on", r.on);
        count();
      });
      top.appendChild(box);
      var mid = el("label", "bk-mid");
      mid.setAttribute("for", box.id);
      mid.appendChild(el("span", "bk-text", r.text || r.cat || "—"));
      var st0 = r.st === "skip" ? t("st_skip") + ": " + t("why_" + r.why, { c: r.cur || "" }) : t("st_" + r.st);
      var acn = r.ac ? (A.accName(r.ac) || r.acName) : "";
      mid.appendChild(el("span", "bk-meta", [r.d ? A.dateShort(r.d) : "", st0, catText(r), acn || ""].filter(Boolean).join(" · ")));
      top.appendChild(mid);
      var amt = r.a ? (r.k === "i" ? "+" : "−") + (r.why === "rate" ? A.money(r.a, r.cur) : A.money(r.a)) : "";
      top.appendChild(el("span", "bk-amt " + (r.k === "i" ? "in" : "out"), amt));
      li.appendChild(top);
      if (r.oc && r.oa && r.st !== "skip") {
        var bot = el("div", "bk-bot");
        bot.appendChild(el("span", "bk-rule", A.money(r.oa, r.oc)));
        li.appendChild(bot);
      }
      return li;
    }
    function doImport() {
      var pkg = IMP.entries(st.res);
      if (!pkg.tx.length) return;
      dlg.close();
      A.importApp(pkg, pkg.cats.length ? t("appDoneC", { n: pkg.tx.length, app: app, c: pkg.cats.length })
                                       : t("appDone", { n: pkg.tx.length, app: app }));
    }
    refresh();
    A.showDialog(dlg);
    go.focus();
  }

  function profiles() {
    return A.data().prof.slice().sort(function (x, y) { return x.n.localeCompare(y.n) || (x.id < y.id ? -1 : 1); });
  }

  function preview(name, bytes) {
    var st = { name: name, bytes: bytes, enc: "auto", encUsed: "", fmt: "csv", text: "",
               rows: null, hd: null, map: null, sep: ",", items: [], fileCur: "", acct: "",
               sig: "", prof: "", ac: "", plan: [], over: {}, uniq: 0 };
    var dlg = A.makeDialog("bd-bank", t("title"));
    dlg.classList.add("wide", "bk-dlg");
    var info = el("div", "bk-file");
    var infoTxt = el("span", "bk-file-t");
    info.appendChild(infoTxt);
    info.appendChild(A.button(t("other"), "bk-other", function () { dlg.close(); open(); }));
    dlg.appendChild(info);

    // Profile + account
    var profSel = el("select");
    var profName = el("input");
    profName.maxLength = 30;
    profName.autocomplete = "off";
    profName.placeholder = t("profName_ph");
    var row1 = el("div", "fld-row");
    row1.appendChild(A.field(t("prof"), profSel, "bk-prof"));
    row1.appendChild(A.field(t("profName"), profName, "bk-prof-n"));
    dlg.appendChild(row1);
    var acSel = null;
    if (A.hasAccounts()) {
      acSel = A.accSelect("");
      dlg.appendChild(A.field(t("ac"), acSel, "bk-ac"));
    }
    dlg.appendChild(el("p", "hint bk-hint", t("profHint")));

    // Columns
    var det = el("details", "bk-cols");
    det.appendChild(el("summary", "", t("cols")));
    var colsBox = el("div", "bk-cols-body");
    det.appendChild(colsBox);
    dlg.appendChild(det);

    var warn = el("p", "bk-warn");
    warn.hidden = true;
    dlg.appendChild(warn);
    var sum = el("p", "bk-sum");
    sum.setAttribute("aria-live", "polite");
    dlg.appendChild(sum);
    var list = el("ul", "bk-list");
    dlg.appendChild(list);
    var moreP = el("p", "hint");
    moreP.hidden = true;
    dlg.appendChild(moreP);

    var acts = el("div", "dlg-actions");
    acts.appendChild(A.button(t("cancel"), "", function () { dlg.close(); }));
    var go = A.button(t("go0"), "primary", doImport);
    go.setAttribute("data-k", "bk.go");
    acts.appendChild(go);
    dlg.appendChild(acts);

    function fillProfiles() {
      profSel.innerHTML = "";
      opt(profSel, "", t("profNew"));
      profiles().forEach(function (p) { opt(profSel, p.id, p.n); });
      profSel.value = st.prof;
      if (profSel.value !== st.prof) { st.prof = ""; profSel.value = ""; }
    }
    function profById(id) {
      var l = A.data().prof;
      for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
      return null;
    }
    function profBySig(sig) {
      if (!sig) return null;
      var l = A.data().prof;
      for (var i = 0; i < l.length; i++) if (l[i].sig === sig) return l[i];
      return null;
    }
    function applyProfile(p) {
      if (!p) return;
      st.prof = p.id;
      profName.value = p.n;
      if (acSel) { acSel.value = p.ac || ""; if (acSel.value !== (p.ac || "")) acSel.value = ""; }
      if (st.fmt === "csv" && st.rows) {
        st.map = { cd: p.cd, cp: p.cp, cm: p.cm, ca: p.ca, cdb: p.cdb, ccr: p.ccr, cs: p.cs, df: p.df, dec: p.dec, inv: p.inv };
      }
      if (st.fmt === "qif") st.map = { df: p.df };
    }

    // Decode → parse → (CSV: header + guess) → items
    function load(first) {
      var d = B.decode(st.bytes, st.enc);
      st.text = d.text;
      st.encUsed = d.enc;
      st.fmt = B.detectFormat(st.text, st.name);
      st.fileCur = "";
      st.acct = "";
      if (st.fmt === "csv") {
        var p0 = first ? null : profById(st.prof);
        st.sep = first ? B.guessSep(st.text) : st.sep;
        st.rows = B.parseCsv(st.text, st.sep);
        st.hd = B.findHeader(st.rows);
        st.sig = st.hd.header >= 0 ? B.headerSig(st.rows[st.hd.header]) : "";
        // PayPal's activity file: its own columns and rules (BK-1).
        var ppm = st.hd.header >= 0 ? B.paypalMap(st.rows[st.hd.header]) : null;
        if (ppm) {
          st.fmt = "paypal";
          st.ppMap = ppm;
          st.sig = "paypal";
          if (first) { var pq = profBySig(st.sig); if (pq) applyProfile(pq); det.open = false; }
        } else if (first) {
          var p = profBySig(st.sig);
          if (p && p.sep !== st.sep) { st.sep = p.sep; st.rows = B.parseCsv(st.text, st.sep); st.hd = B.findHeader(st.rows); }
          st.map = B.guessMap(st.rows, st.hd, A.lang);
          if (p) applyProfile(p);
          det.open = !p;
        } else if (!st.map || !p0) st.map = B.guessMap(st.rows, st.hd, A.lang);
      } else if (st.fmt === "qif") {
        if (first || !st.map) st.map = { df: B.detectDateOrder(B.qifDates(st.text), "mdy") };
      } else {
        var r = st.fmt === "ofx" ? B.parseOfx(st.text) : st.fmt === "mt940" ? B.parseMt940(st.text) : B.parseCamt(st.text);
        st.items = r.items;
        st.fileCur = r.cur;
        st.acct = r.acct;
        st.sig = r.acct ? st.fmt + ":" + B.fold(r.acct).replace(/\s/g, "") : "";
        if (first) { var pp = profBySig(st.sig); if (pp) applyProfile(pp); det.open = false; }
      }
    }
    function items() {
      if (st.fmt === "csv") st.items = B.csvItems(st.rows, st.hd.start, st.map);
      else if (st.fmt === "qif") st.items = B.parseQif(st.text, st.map.df).items;
      else if (st.fmt === "paypal") st.items = B.paypalItems(st.rows, st.hd.start, st.ppMap, A.cur());
    }

    function colLabel(i) {
      var h = st.hd && st.hd.header >= 0 ? (st.rows[st.hd.header][i] || "") : "";
      var sample = "";
      for (var r = st.hd ? st.hd.start : 0; r < Math.min(st.rows.length, (st.hd ? st.hd.start : 0) + 5); r++) {
        if (st.rows[r][i]) { sample = st.rows[r][i]; break; }
      }
      var txt = h || sample;
      return t("col", { n: i + 1 }) + (txt ? " · " + B.clean(txt, 28) : "");
    }
    function colSelect(key, withNone) {
      var pairs = [];
      if (withNone) pairs.push([-1, t("colNone")]);
      for (var i = 0; i < (st.hd ? st.hd.width : 0); i++) pairs.push([i, colLabel(i)]);
      var s = sel(null, pairs, st.map[key]);
      if (s.value !== String(st.map[key])) s.value = withNone ? "-1" : "0";
      s.addEventListener("change", function () { st.map[key] = +s.value; refresh(); });
      return s;
    }
    function drawCols() {
      colsBox.innerHTML = "";
      var encSel = sel(null, [["auto", t("encAuto", { e: encLabel(st.encUsed) })], ["utf-8", t("e_utf8")], ["windows-1253", t("e_1253")],
                              ["iso-8859-7", t("e_88597")], ["windows-1252", t("e_1252")]], st.enc);
      encSel.addEventListener("change", function () { st.enc = encSel.value; load(false); drawCols(); refresh(); });
      if (st.fmt !== "csv") {
        var r0 = el("div", "fld-row");
        r0.appendChild(A.field(t("enc"), encSel, "bk-enc"));
        if (st.fmt === "qif") {
          var dq = sel(null, [["dmy", "dd/mm/yyyy"], ["mdy", "mm/dd/yyyy"], ["ymd", "yyyy-mm-dd"]], st.map.df);
          dq.addEventListener("change", function () { st.map.df = dq.value; refresh(); });
          r0.appendChild(A.field(t("df"), dq, "bk-df"));
        }
        colsBox.appendChild(r0);
        return;
      }
      var sepSel = sel(null, [[";", ";"], [",", ","], ["\t", t("sepTab")], ["|", "|"]], st.sep);
      sepSel.addEventListener("change", function () {
        st.sep = sepSel.value;
        st.rows = B.parseCsv(st.text, st.sep);
        st.hd = B.findHeader(st.rows);
        st.sig = st.hd.header >= 0 ? B.headerSig(st.rows[st.hd.header]) : "";
        st.map = B.guessMap(st.rows, st.hd, A.lang);
        drawCols();
        refresh();
      });
      var r1 = el("div", "fld-row");
      r1.appendChild(A.field(t("sep"), sepSel, "bk-sep"));
      r1.appendChild(A.field(t("enc"), encSel, "bk-enc"));
      colsBox.appendChild(r1);
      var r2 = el("div", "fld-row");
      r2.appendChild(A.field(t("cd"), colSelect("cd", false), "bk-cd"));
      var dfSel = sel(null, [["dmy", "dd/mm/yyyy"], ["mdy", "mm/dd/yyyy"], ["ymd", "yyyy-mm-dd"]], st.map.df);
      dfSel.addEventListener("change", function () { st.map.df = dfSel.value; refresh(); });
      r2.appendChild(A.field(t("df"), dfSel, "bk-df"));
      colsBox.appendChild(r2);
      var r3 = el("div", "fld-row");
      r3.appendChild(A.field(t("cp"), colSelect("cp", false), "bk-cp"));
      r3.appendChild(A.field(t("cm"), colSelect("cm", true), "bk-cm"));
      colsBox.appendChild(r3);
      var two = st.map.ca < 0;
      var mode = sel(null, [["1", t("amtOne")], ["2", t("amtTwo")]], two ? "2" : "1");
      mode.addEventListener("change", function () {
        if (mode.value === "2") {
          st.map.ca = -1; st.map.cs = -1;
          if (st.map.cdb < 0) st.map.cdb = 0;
          if (st.map.ccr < 0) st.map.ccr = Math.min(1, st.hd.width - 1);
        } else {
          st.map.ca = st.map.cdb >= 0 ? st.map.cdb : 0;
          st.map.cdb = st.map.ccr = -1;
        }
        drawCols();
        refresh();
      });
      var decSel = sel(null, [[",", "1.234,56"], [".", "1,234.56"]], st.map.dec);
      decSel.addEventListener("change", function () { st.map.dec = decSel.value; refresh(); });
      var r4 = el("div", "fld-row");
      r4.appendChild(A.field(t("amtMode"), mode, "bk-mode"));
      r4.appendChild(A.field(t("dec"), decSel, "bk-dec"));
      colsBox.appendChild(r4);
      var r5 = el("div", "fld-row");
      if (two) {
        r5.appendChild(A.field(t("cdb"), colSelect("cdb", false), "bk-cdb"));
        r5.appendChild(A.field(t("ccr"), colSelect("ccr", false), "bk-ccr"));
      } else {
        r5.appendChild(A.field(t("ca"), colSelect("ca", false), "bk-ca"));
        r5.appendChild(A.field(t("cs"), colSelect("cs", true), "bk-cs"));
      }
      colsBox.appendChild(r5);
      var inv = check(t("inv"), st.map.inv, "bk-inv");
      inv.box.addEventListener("change", function () { st.map.inv = inv.box.checked; refresh(); });
      colsBox.appendChild(inv);
    }
    function encLabel(e) {
      return e === "windows-1253" ? t("e_1253") : e === "iso-8859-7" ? t("e_88597") : e === "windows-1252" ? t("e_1252") : t("e_utf8");
    }

    // Plan + list
    function refresh() {
      items();
      var D = A.data();
      st.ac = acSel ? acSel.value : "";
      st.plan = B.plan(st.items, { tx: D.tx, tombs: D.tombs, ac: st.ac, cur: A.cur(), fileCur: st.fileCur, rules: D.rule,
                               xfer: D.xfer, pp: st.fmt === "paypal" });
      st.plan.forEach(function (r) {
        var o = r.id && st.over[r.id];
        if (!o) return;
        if (o.on !== undefined && r.st !== "same" && r.st !== "skip") r.on = o.on;
        if (o.c !== undefined && o.k === r.k) { r.c = o.c; r.rule = ""; r.manual = true; }
      });
      var curs = {};
      st.plan.forEach(function (r) { if (r.why === "cur") curs[1] = 1; });
      var otherCur = st.fileCur && st.fileCur !== A.cur() ? st.fileCur : "";
      if (!otherCur) st.items.some(function (it) { if (it.cur && it.cur !== A.cur()) { otherCur = it.cur; return true; } return false; });
      warn.hidden = !otherCur;
      warn.textContent = otherCur ? t("curWarn", { c: otherCur, b: A.cur() }) : "";
      infoTxt.textContent = t("file", { f: B.clean(st.name, 60), fmt: t("fmt_" + st.fmt), n: st.items.length });
      draw();
    }
    function draw() {
      var c = B.counts(st.plan);
      sum.textContent = st.items.length ? t("sum", { "new": c["new"], dup: c.dup + c.same + c.gone, skip: c.skip }) : t("empty");
      go.textContent = c.on ? t("go", { n: c.on }) : t("go0");
      go.disabled = !c.on;
      list.innerHTML = "";
      st.plan.slice(0, SHOW_ROWS).forEach(function (r) { list.appendChild(rowEl(r)); });
      moreP.hidden = st.plan.length <= SHOW_ROWS;
      moreP.textContent = t("more", { s: SHOW_ROWS, n: st.plan.length });
    }
    function counts() {
      var c = B.counts(st.plan);
      go.textContent = c.on ? t("go", { n: c.on }) : t("go0");
      go.disabled = !c.on;
    }
    function rowEl(r) {
      var li = el("li", "bk-row bk-" + r.st + (r.on ? " on" : ""));
      var top = el("div", "bk-top");
      var box = el("input");
      box.type = "checkbox";
      box.checked = r.on;
      box.disabled = r.st === "same" || r.st === "skip";
      box.id = "bk-r" + (++st.uniq);
      box.setAttribute("aria-label", t("tick", { t: (r.d ? A.dateShort(r.d) + ", " : "") + (r.text || "") }));
      box.addEventListener("change", function () {
        r.on = box.checked;
        (st.over[r.id] = st.over[r.id] || {}).on = r.on;
        li.classList.toggle("on", r.on);
        counts();
      });
      top.appendChild(box);
      var mid = el("label", "bk-mid");
      mid.setAttribute("for", box.id);
      mid.appendChild(el("span", "bk-text", r.text || "—"));
      var meta = (r.d ? A.dateShort(r.d) : "") + " · " + stText(r);
      mid.appendChild(el("span", "bk-meta", meta));
      top.appendChild(mid);
      top.appendChild(el("span", "bk-amt " + (r.k === "i" ? "in" : "out"), r.a ? signed(r.a, r.k) : ""));
      li.appendChild(top);
      if (r.st === "skip" || r.st === "same") return li;
      var bot = el("div", "bk-bot");
      var cs = A.catSelect(r.k, r.c);
      cs.value = r.c;
      if (cs.value !== r.c) cs.value = "";
      cs.setAttribute("aria-label", t("cat") + ": " + (r.text || ""));
      bot.appendChild(cs);
      var alw = A.button(t("always"), "mini bk-always", function () {
        ruleDialog(null, { k: r.k, c: r.c, q: B.suggestQ(r.text) }, function () { refresh(); });
      });
      alw.hidden = !r.manual || !r.c;
      bot.appendChild(alw);
      if (r.rule) {
        var ru = ruleById(r.rule);
        if (ru) bot.appendChild(el("span", "bk-rule", t("rule", { q: ruleText(ru) })));
      }
      cs.addEventListener("change", function () {
        r.c = cs.value;
        r.manual = true;
        r.rule = "";
        var o = st.over[r.id] = st.over[r.id] || {};
        o.c = r.c; o.k = r.k;
        if (!r.on && r.c && r.st === "new") { r.on = true; box.checked = true; o.on = true; li.classList.add("on"); counts(); }
        var lab = bot.querySelector(".bk-rule");
        if (lab) lab.remove();
        alw.hidden = !r.c;
      });
      li.appendChild(bot);
      return li;
    }
    function stText(r) {
      if (r.st === "skip") return t("st_skip") + ": " + t("why_" + r.why, { c: st.fileCur || r.cur || "" });
      if (r.st === "dup" && r.dk) return t("dup_" + r.dk);
      return t("st_" + r.st);
    }

    function doImport() {
      var rows = B.entries(st.plan, st.ac, st.fmt === "paypal");
      if (!rows.length) return;
      var nm = A.normText(profName.value, 30);
      if (nm) {
        var p = { id: st.prof || "", n: nm, ac: st.ac, sig: st.sig, enc: st.enc };
        if (st.fmt === "csv") {
          var m = st.map;
          p.sep = st.sep; p.cd = m.cd; p.cp = m.cp; p.cm = m.cm; p.ca = m.ca; p.cdb = m.cdb; p.ccr = m.ccr; p.cs = m.cs;
          p.df = m.df; p.dec = m.dec; p.inv = !!m.inv;
        } else if (st.fmt === "qif") p.df = st.map.df;
        A.saveProf(p);
      }
      var u = rows.filter(function (x) { return !x.c; }).length;
      dlg.close();
      A.addEntries(rows, u ? t("doneU", { n: rows.length, u: u }) : t("done", { n: rows.length }));
    }

    profSel.addEventListener("change", function () {
      var p = profById(profSel.value);
      st.prof = profSel.value;
      if (p) {
        if (st.fmt === "csv" && p.sep !== st.sep) {
          st.sep = p.sep; st.rows = B.parseCsv(st.text, st.sep); st.hd = B.findHeader(st.rows);
          st.sig = st.hd.header >= 0 ? B.headerSig(st.rows[st.hd.header]) : "";
        }
        if (p.enc !== st.enc) { st.enc = p.enc; load(false); }
        applyProfile(p);
      } else profName.value = "";
      drawCols();
      refresh();
    });
    if (acSel) acSel.addEventListener("change", function () { st.over = {}; refresh(); });

    try {
      load(true);
      fillProfiles();
      drawCols();
      refresh();
    } catch (e) {
      A.showToast(t("bad"));
      return;
    }
    A.showDialog(dlg);
    profSel.focus();
  }

  // ---------- Rules ----------
  function ruleById(id) {
    var l = A.data().rule;
    for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
    return null;
  }
  function ruleText(r) {
    var parts = [];
    if (r.q) parts.push(t("ruleTxt", { q: r.q }));
    if (r.lo && r.hi) parts.push(t("ruleAmt", { a: A.money(r.lo) + " – " + A.money(r.hi) }));
    else if (r.lo) parts.push(t("ruleFrom", { a: A.money(r.lo) }));
    else if (r.hi) parts.push(t("ruleTo", { a: A.money(r.hi) }));
    return parts.join(", ");
  }
  function rulesDialog() {
    var dlg = A.makeDialog("bd-rules", t("rules"));
    dlg.classList.add("wide");
    dlg.appendChild(el("p", "hint", t("rulesHint")));
    var ul = el("ul", "day-list bk-rules");
    dlg.appendChild(ul);
    var list = A.data().rule.slice().sort(function (x, y) {
      return x.k.localeCompare(y.k) || A.catName(x.c).localeCompare(A.catName(y.c)) || B.fold(x.q).localeCompare(B.fold(y.q));
    });
    if (!list.length) dlg.appendChild(el("p", "hint empty", t("rulesEmpty")));
    list.forEach(function (r) {
      var li = el("li");
      var b = el("button", "tx " + (r.k === "i" ? "in" : "out"));
      b.type = "button";
      b.appendChild(A.swatch(A.catCol(r.c)));
      var mid = el("span", "tx-mid");
      mid.appendChild(el("span", "tx-cat", ruleText(r)));
      mid.appendChild(el("span", "tx-note", "→ " + A.catName(r.c) + [r.py, r.nt].filter(Boolean).map(function (s) { return " · " + s; }).join("")));
      b.appendChild(mid);
      b.addEventListener("click", function () { dlg.close(); ruleDialog(r.id, null, rulesDialog); });
      li.appendChild(b);
      ul.appendChild(li);
    });
    var acts = el("div", "dlg-actions");
    var ap = A.button(t("apply"), "", function () { applyAll([]); });
    ap.hidden = !list.length;
    acts.appendChild(ap);
    acts.appendChild(A.button(t("newRule"), "", function () { dlg.close(); ruleDialog(null, null, rulesDialog); }));
    acts.appendChild(A.button(t("close"), "primary", function () { dlg.close(); }));
    dlg.appendChild(acts);
    A.showDialog(dlg);
  }
  // Re-run rules (all, or only `only`) on the uncategorised entries.
  function applyAll(only) {
    var D = A.data();
    var ch = B.rerun(D.tx, only && only.length ? only : D.rule);
    if (!ch.length) { if (!only || !only.length) A.showToast(t("applied0")); return 0; }
    A.applyChanges(ch, (ch.length === 1 ? t("applied1") : t("applied", { n: ch.length })));
    return ch.length;
  }
  // preset { k, c, q } for a rule made from a correction; then(rule) after Save.
  function ruleDialog(id, preset, then) {
    var r = id ? ruleById(id) : null;
    if (id && !r) return;
    var v = r || preset || { k: "o", c: "", q: "" };
    var dlg = A.makeDialog("bd-rule", t(r ? "editRule" : "newRule"));
    var form = el("form");
    var cat = A.catSelect(v.k, v.c || "");
    var sw = A.kindSwitch(v.k, function (k) { A.fillCatSelect(cat, k, ""); });
    var q = el("input");
    q.maxLength = 60; q.autocomplete = "off"; q.placeholder = t("q_ph"); q.value = v.q || "";
    var lo = el("input"), hi = el("input");
    [lo, hi].forEach(function (x) { x.inputMode = "decimal"; x.autocomplete = "off"; x.placeholder = t("opt"); });
    lo.value = r && r.lo ? A.centsToInput(r.lo) : "";
    hi.value = r && r.hi ? A.centsToInput(r.hi) : "";
    var py = el("input"), nt = el("input");
    py.maxLength = 60; nt.maxLength = 80;
    [py, nt].forEach(function (x) { x.autocomplete = "off"; x.placeholder = t("opt"); });
    py.value = r ? r.py : ""; nt.value = r ? r.nt : "";
    var err = el("p", "err");
    err.setAttribute("role", "alert");
    err.hidden = true;
    form.appendChild(sw);
    form.appendChild(A.field(t("q"), q, "bk-rq"));
    var row = el("div", "fld-row");
    row.appendChild(A.field(t("lo") + " (" + A.cur() + ")", lo, "bk-rlo"));
    row.appendChild(A.field(t("hi") + " (" + A.cur() + ")", hi, "bk-rhi"));
    form.appendChild(row);
    form.appendChild(A.field(t("cat"), cat, "bk-rc"));
    var row2 = el("div", "fld-row");
    row2.appendChild(A.field(t("py"), py, "bk-rpy"));
    row2.appendChild(A.field(t("nt"), nt, "bk-rnt"));
    form.appendChild(row2);
    var also = check(t("alsoNow"), true, "bk-ralso");
    form.appendChild(also);
    form.appendChild(err);
    var acts = el("div", "dlg-actions");
    if (r) acts.appendChild(A.button(t("del"), "danger", function () { dlg.close(); A.deleteRule(r.id, t("deleted")); if (then) then(null); }));
    acts.appendChild(A.button(t("cancel"), "", function () { dlg.close(); if (then && then === rulesDialog) then(null); }));
    var ok = A.button(t("save"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);
    function bad(msg, f) { err.textContent = msg; err.hidden = false; if (f) f.focus(); }
    function amt(inp) {
      var s = inp.value.trim();
      if (!s) return 0;
      var c = A.parseAmount(s);
      return c === null ? null : c;
    }
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var a = amt(lo), b = amt(hi);
      if (a === null) return bad(t("badAmt"), lo);
      if (b === null) return bad(t("badAmt"), hi);
      var qq = A.normText(q.value, 60);
      if (!qq && !a && !b) return bad(t("needQ"), q);
      if (!cat.value) return bad(t("needC"), cat);
      var saved = A.saveRule({ id: r ? r.id : "", k: sw.get(), c: cat.value, q: qq, lo: a, hi: b && a && b < a ? 0 : b,
                               py: A.normText(py.value, 60), nt: A.normText(nt.value, 80) });
      dlg.close();
      if (!saved) return;
      if (then) then(saved);   // first, so the toast below lands in the dialog that is open then
      var n = also.box.checked ? applyAll([saved]) : 0;
      if (!n) A.showToast(t("saved"));
    });
    dlg.appendChild(form);
    A.showDialog(dlg);
    (v.q ? cat : q).focus();
  }

  root.OrosBudgetBankUI = {
    init: function (api) { A = api; },
    open: open,
    route: route,
    rules: rulesDialog,
    ruleFor: function (x) { ruleDialog(null, { k: x.k, c: x.c || "", q: B.suggestQ(x.ot || x.n || "") }, null); },
    rerun: function () { return applyAll([]); },
    has: function () { return !!B; }
  };
})(typeof window !== "undefined" ? window : this);
