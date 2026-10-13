// ============================================================
// orOS Invoices — myDATA through timologisi.online (Connected services
// wave 2, v1.0.0). Loaded after core.js and ../links/mydata.js, before
// invoices.js, which hands it a small api (helpers + data access).
//
// window.OrosInvoicesMyData:
//   accounts()            the timologisi.online accounts (shell orosLinks)
//   canSend(d)            an issued invoice / receipt / credit note not sent yet
//   actions(d, acts)      adds Send / Check buttons to the viewer
//   card(d)               the ΜΑΡΚ / UID / authentication code / official PDF card
//   locked(d)             sent (or maybe sent): no void, no renumber
//   init(api)
//
// What a sent document keeps (flat extras on the doc, see core.js
// withExtras; an older device keeps them untouched):
//   mark  ΜΑΡΚ (the field Invoices already had)
//   mds   "ok" | "off" (issued while AADE was down, ΜΑΡΚ later) |
//         "?" (sent, the answer never came: look it up before anything)
//   mdx   the account id · mdt the type ("2.1") · mdq series/number as
//         sent ("INV-2026/42") · mdu UID · mda authentication code ·
//         mdp the provider's PDF link
// Nothing is sent by itself: only the person's "Send to myDATA".
// ============================================================
(function (root) {
  "use strict";
  var M = root.OrosMyData, A = null, C = null;

  var S = {
    en: {
      send: "Send to myDATA", check: "Check in myDATA", title: "Send to myDATA",
      intro: "timologisi.online issues this document and sends it to myDATA (AADE). Once sent it cannot be changed or deleted: a mistake is corrected with a credit note.",
      acct: "Account", type: "Document type", goods: "goods", services: "services",
      cc: "Client's country (2 letters)", ccHint: "GR for Greece; e.g. DE, CY; outside the EU e.g. US, GB.",
      pay: "Payment method", exempt: "VAT exemption reason (0 % lines)", wht: "Withholding category",
      test: "Test account: the document is not real, but the provider still e-mails the client's registered addresses. Use the test ΑΦΜ 987654324 for test clients.",
      go: "Send", sending: "Sending…", checking: "Checking…",
      cost: "Uses {n} credit(s) of the account.",
      ok: "Sent to myDATA. ΜΑΡΚ {m}", offline: "Issued while AADE was unreachable. The ΜΑΡΚ comes later: use Check in myDATA.",
      dup: "This document was already in myDATA. ΜΑΡΚ {m} kept.",
      unknown: "No answer came, so it may or may not have arrived. Use Check in myDATA before sending again.",
      notFound: "Not in myDATA. You can send it.", stillOff: "Still waiting for the ΜΑΡΚ from AADE.",
      rejected: "Not issued. myDATA said:", bad: "Not issued. timologisi.online said:", tech: "A temporary problem at AADE or the provider. Nothing was issued; try again later.",
      auth: "The key was refused. Check it in Settings › Connected services.",
      clash: "Another document has the same number. Fix the number first (the bar above the list).",
      card: "myDATA", mark: "ΜΑΡΚ", uid: "UID", auth2: "Authentication code", pdf: "Official PDF",
      pending: "Sent, waiting for an answer: check before anything else.", wait: "Issued offline: waiting for the ΜΑΡΚ.",
      lockedVoid: "This document is in myDATA, so it cannot be cancelled here. Issue a credit note for it instead.",
      lockedNum: "This document is in myDATA, so its number cannot change.",
      envTest: "test", envLive: "live",
      "err.type": "This kind of document can't go to myDATA.", "err.cur": "Only euro documents can be sent.",
      "err.date": "myDATA only takes documents dated today. This one is dated {d}: duplicate it and issue the copy today.",
      "err.vat": "The account has no valid ΑΦΜ.", "err.afm": "The ΑΦΜ in your business details ({a}) is not the account's ({b}).",
      "err.saddr": "Write your business address as “Street Number, PostalCode City” (Settings › Business).",
      "err.sname": "Your business name is missing (Settings › Business).", "err.sjob": "Your business activity is missing (Settings › Business).",
      "err.sdoy": "Your tax office (ΔΟΥ) is missing (Settings › Business).", "err.pay": "Pick a payment method.",
      "err.num": "The number can't be read as a myDATA series and number.", "err.lines": "The document has no lines.",
      "err.rate": "A line has a VAT rate myDATA doesn't know (24, 13, 6, 17, 9, 4 or 0 %).", "err.neg": "Negative lines can't be sent: use a discount.",
      "err.exempt": "Pick the VAT exemption reason for the 0 % lines.", "err.wht": "Pick the withholding category.",
      "err.cc": "Write the client's country as 2 letters.", "err.cafm": "The client's ΑΦΜ / VAT number is missing or not valid.",
      "err.self": "The client's ΑΦΜ is your own.", "err.caddr": "A client abroad needs a name and an address with postal code and city.",
      "err.ref": "The corrected document has no ΜΑΡΚ."
    },
    el: {
      send: "Αποστολή στο myDATA", check: "Έλεγχος στο myDATA", title: "Αποστολή στο myDATA",
      intro: "Το timologisi.online εκδίδει αυτό το παραστατικό και το διαβιβάζει στο myDATA (ΑΑΔΕ). Μετά την αποστολή δεν αλλάζει ούτε διαγράφεται: ένα λάθος διορθώνεται με πιστωτικό.",
      acct: "Λογαριασμός", type: "Τύπος παραστατικού", goods: "αγαθά", services: "υπηρεσίες",
      cc: "Χώρα πελάτη (2 γράμματα)", ccHint: "GR για Ελλάδα· π.χ. DE, CY· εκτός ΕΕ π.χ. US, GB.",
      pay: "Τρόπος πληρωμής", exempt: "Αιτία εξαίρεσης ΦΠΑ (γραμμές 0 %)", wht: "Κατηγορία παρακράτησης",
      test: "Δοκιμαστικός λογαριασμός: το παραστατικό δεν είναι πραγματικό, αλλά ο πάροχος στέλνει email στις δηλωμένες διευθύνσεις του πελάτη. Για δοκιμές βάλε στον πελάτη το ΑΦΜ 987654324.",
      go: "Αποστολή", sending: "Αποστολή…", checking: "Έλεγχος…",
      cost: "Χρεώνει {n} μονάδα(ες) του λογαριασμού.",
      ok: "Στάλθηκε στο myDATA. ΜΑΡΚ {m}", offline: "Εκδόθηκε ενώ η ΑΑΔΕ δεν απαντούσε. Ο ΜΑΡΚ έρχεται αργότερα: πάτα «Έλεγχος στο myDATA».",
      dup: "Το παραστατικό ήταν ήδη στο myDATA. Κρατήθηκε ο ΜΑΡΚ {m}.",
      unknown: "Δεν ήρθε απάντηση, οπότε μπορεί να έφτασε ή όχι. Πάτα «Έλεγχος στο myDATA» πριν το ξαναστείλεις.",
      notFound: "Δεν είναι στο myDATA. Μπορείς να το στείλεις.", stillOff: "Ακόμα περιμένει τον ΜΑΡΚ από την ΑΑΔΕ.",
      rejected: "Δεν εκδόθηκε. Το myDATA απάντησε:", bad: "Δεν εκδόθηκε. Το timologisi.online απάντησε:", tech: "Προσωρινό πρόβλημα στην ΑΑΔΕ ή στον πάροχο. Δεν εκδόθηκε τίποτα· δοκίμασε αργότερα.",
      auth: "Το κλειδί απορρίφθηκε. Έλεγξέ το στις Ρυθμίσεις › Συνδεδεμένες υπηρεσίες.",
      clash: "Άλλο παραστατικό έχει τον ίδιο αριθμό. Διόρθωσε πρώτα τον αριθμό (η γραμμή πάνω από τη λίστα).",
      card: "myDATA", mark: "ΜΑΡΚ", uid: "UID", auth2: "Κωδικός αυθεντικοποίησης", pdf: "Επίσημο PDF",
      pending: "Στάλθηκε, περιμένει απάντηση: κάνε έλεγχο πριν από οτιδήποτε άλλο.", wait: "Εκδόθηκε χωρίς σύνδεση με την ΑΑΔΕ: περιμένει τον ΜΑΡΚ.",
      lockedVoid: "Το παραστατικό είναι στο myDATA, οπότε δεν ακυρώνεται εδώ. Έκδωσε πιστωτικό γι' αυτό.",
      lockedNum: "Το παραστατικό είναι στο myDATA, οπότε ο αριθμός του δεν αλλάζει.",
      envTest: "δοκιμαστικός", envLive: "παραγωγής",
      "err.type": "Αυτό το είδος παραστατικού δεν πάει στο myDATA.", "err.cur": "Στέλνονται μόνο παραστατικά σε ευρώ.",
      "err.date": "Το myDATA δέχεται μόνο παραστατικά με σημερινή ημερομηνία. Αυτό έχει {d}: κάνε αντίγραφο και έκδωσέ το σήμερα.",
      "err.vat": "Ο λογαριασμός δεν έχει έγκυρο ΑΦΜ.", "err.afm": "Το ΑΦΜ στα στοιχεία της επιχείρησης ({a}) δεν είναι του λογαριασμού ({b}).",
      "err.saddr": "Γράψε τη διεύθυνση της επιχείρησης ως «Οδός Αριθμός, ΤΚ Πόλη» (Ρυθμίσεις › Επιχείρηση).",
      "err.sname": "Λείπει η επωνυμία (Ρυθμίσεις › Επιχείρηση).", "err.sjob": "Λείπει η δραστηριότητα (Ρυθμίσεις › Επιχείρηση).",
      "err.sdoy": "Λείπει η ΔΟΥ (Ρυθμίσεις › Επιχείρηση).", "err.pay": "Διάλεξε τρόπο πληρωμής.",
      "err.num": "Ο αριθμός δεν διαβάζεται ως σειρά και αριθμός του myDATA.", "err.lines": "Το παραστατικό δεν έχει γραμμές.",
      "err.rate": "Μια γραμμή έχει συντελεστή ΦΠΑ που δεν δέχεται το myDATA (24, 13, 6, 17, 9, 4 ή 0 %).", "err.neg": "Αρνητικές γραμμές δεν στέλνονται: βάλε έκπτωση.",
      "err.exempt": "Διάλεξε αιτία εξαίρεσης ΦΠΑ για τις γραμμές με 0 %.", "err.wht": "Διάλεξε κατηγορία παρακράτησης.",
      "err.cc": "Γράψε τη χώρα του πελάτη με 2 γράμματα.", "err.cafm": "Το ΑΦΜ / VAT του πελάτη λείπει ή δεν είναι έγκυρο.",
      "err.self": "Το ΑΦΜ του πελάτη είναι το δικό σου.", "err.caddr": "Πελάτης στο εξωτερικό θέλει επωνυμία και διεύθυνση με ΤΚ και πόλη.",
      "err.ref": "Το παραστατικό που διορθώνεται δεν έχει ΜΑΡΚ."
    }
  };
  function t(k, p) {
    var tab = S[A && A.lang === "el" ? "el" : "en"];
    var s = tab[k] !== undefined ? tab[k] : (S.en[k] !== undefined ? S.en[k] : k);
    return String(s).replace(/\{(\w+)\}/g, function (m, n) { return p && p[n] !== undefined ? String(p[n]) : m; });
  }
  function links() { try { return root.parent && root.parent !== root ? root.parent.orosLinks || null : null; } catch (e) { return null; } }
  function accounts() {
    var Lk = links();
    try { return Lk ? Lk.list("tol") : []; } catch (e) { return []; }
  }
  var KINDS = ["inv", "rcpt", "cred"];
  function canSend(d) {
    return !!(M && d && d.st === "issued" && KINDS.indexOf(d.kind) >= 0 && !d.mds && accounts().length);
  }
  function locked(d) { return !!(d && (d.mds === "ok" || d.mds === "off" || d.mds === "?")); }
  var busy = {};

  // ---------- what the document becomes ----------
  function refOf(d) {
    if (d.kind !== "cred" || !d.ref) return null;
    var r = C.anyId(A.data().docs, d.ref);
    return r && !r.del ? r : null;
  }
  function ccOf(d) {
    var c = d.c || {};
    var x = C.euCountry(c.country) || C.vatPrefix(c.afm);
    if (!x && /^(EL|GR)?\d{9}$/i.test(String(c.afm || "").replace(/\s+/g, ""))) x = "GR";
    if (!x && /^[A-Za-z]{2}$/.test(String(c.country || "").trim())) x = c.country.trim().toUpperCase();
    return x;
  }
  function natureOf(type) { return /^(2\.|11\.2)/.test(type) ? "s" : "g"; }
  function typesFor(d, cc) {
    if (d.kind === "rcpt") return ["11.1", "11.2"];
    if (d.kind === "inv") {
      if (!cc || cc === "GR") return ["2.1", "1.1"];
      if (C.EU[cc]) return ["2.2", "1.2"];
      return ["2.3", "1.3"];
    }
    var r = refOf(d), rt = r ? r.mdt || (r.kind === "rcpt" ? "11.1" : "") : "";
    return [M.autoType("cred", cc, natureOf(rt), rt, r && r.mark, C.EU)];
  }
  function defaultPay(d) {
    var by = { bank: 1, cash: 3, card: 7, iris: 8, paypal: 6, other: 5 };
    var pays = (A.data().pays || []).filter(function (p) { return !p.del && p.doc === d.id; });
    if (pays.length && by[pays[0].how]) return by[pays[0].how];
    if (d.kind === "rcpt") return 3;
    var r = refOf(d);
    if (d.kind === "cred" && r && r.kind === "rcpt") return 3;
    return 5;
  }
  function seriesAa(d) {
    var s = C.series(A.data(), d.ser);
    if (!s || !(d.seq > 0)) return null;
    return { series: M.seriesOf(s.prefix, +String(d.date).slice(0, 4), s.year), aa: String(d.seq) };
  }
  function clashing(d) {
    return C.clashes(A.data()).some(function (g) { return g.some(function (x) { return x.id === d.id; }); });
  }

  // ---------- Send dialog ----------
  function openSend(d) {
    var list = accounts();
    if (!list.length) return;
    var dlg = A.makeDialog("inv-mydata", t("title"));
    var form = A.el("form");
    form.method = "dialog";
    form.noValidate = true;
    form.appendChild(A.el("p", "dlg-text", t("intro")));
    var st = { acct: list[0].id, cc: ccOf(d), pay: defaultPay(d), exCat: 0, whtCat: 0, type: "" };
    var aSel = A.select(list.map(function (a) { return [a.id, a.name + " · " + a.vat + " (" + t(a.env === "live" ? "envLive" : "envTest") + ")"]; }), st.acct);
    if (list.length > 1) form.appendChild(A.field(t("acct"), aSel));
    var testNote = A.el("p", "hint");
    form.appendChild(testNote);
    var ccIn = A.input("text", st.cc, 2);
    ccIn.autocapitalize = "characters";
    var retail = d.kind === "rcpt" || (d.kind === "cred" && typesFor(d, st.cc)[0] === "11.4");
    if (!retail) form.appendChild(A.field(t("cc"), ccIn, t("ccHint")));
    var tSel = A.select([], "");
    var tWrap = A.field(t("type"), tSel);
    form.appendChild(tWrap);
    function fillTypes() {
      var opts = typesFor(d, st.cc).map(function (x) {
        return [x, x + " · " + M.LABEL[x][A.lang === "el" ? 0 : 1] + (d.kind !== "cred" ? " (" + t(natureOf(x) === "s" ? "services" : "goods") + ")" : "")];
      });
      var keep = opts.some(function (o) { return o[0] === st.type; }) ? st.type : opts[0][0];
      A.fillSelect(tSel, opts, keep);
      st.type = tSel.value;
    }
    fillTypes();
    var pSel = A.select(M.PAY.map(function (p) { return [String(p[0]), A.lang === "el" ? p[1] : p[2]]; }), String(st.pay));
    form.appendChild(A.field(t("pay"), pSel));
    var zero = (d.lines || []).some(function (l) { return l.vat === 0 && (l.q || l.p); });
    var eSel = null, wSel = null;
    if (zero) {
      eSel = A.select([["0", "—"]].concat(M.EXEMPT.map(function (e) { return [String(e[0]), A.lang === "el" ? e[1] : e[2]]; })), "0");
      form.appendChild(A.field(t("exempt"), eSel, d.exempt || ""));
    }
    if (d.wht > 0) {
      var rows = M.WHT.filter(function (w) { return w[1] === d.wht; });
      wSel = A.select([["0", "—"]].concat(rows.map(function (w) { return [String(w[0]), A.lang === "el" ? w[2] : w[3]]; })), rows.length === 1 ? String(rows[0][0]) : "0");
      form.appendChild(A.field(t("wht"), wSel));
    }
    var errBox = A.el("div", "md-errs");
    errBox.setAttribute("role", "alert");
    form.appendChild(errBox);
    var costNote = A.el("p", "hint");
    form.appendChild(costNote);
    function acct() { return list.filter(function (a) { return a.id === st.acct; })[0] || list[0]; }
    function paint() {
      testNote.textContent = acct().env === "live" ? "" : t("test");
      testNote.hidden = acct().env === "live";
      costNote.textContent = t("cost", { n: M.RETAIL.indexOf(st.type) >= 0 ? "0,50" : "1" });
    }
    paint();
    aSel.addEventListener("change", function () { st.acct = aSel.value; paint(); });
    ccIn.addEventListener("input", function () { st.cc = ccIn.value.trim().toUpperCase(); fillTypes(); paint(); });
    tSel.addEventListener("change", function () { st.type = tSel.value; paint(); });
    pSel.addEventListener("change", function () { st.pay = +pSel.value; });
    if (eSel) eSel.addEventListener("change", function () { st.exCat = +eSel.value; });
    if (wSel) { st.whtCat = +wSel.value; wSel.addEventListener("change", function () { st.whtCat = +wSel.value; }); }

    function showErrs(title, items) {
      errBox.textContent = "";
      if (title) errBox.appendChild(A.el("p", "msg-err", title));
      if (items && items.length) {
        var ul = A.el("ul", "md-err-list");
        items.forEach(function (x) { ul.appendChild(A.el("li", "", x)); });
        errBox.appendChild(ul);
      }
    }
    A.actions(form, [], t("go"));
    var ok = form.querySelector("button[type=submit]");
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (busy[d.id]) return;
      var cur = A.findDoc(d.id);
      if (!cur || cur.mds) { dlg.close(); A.renderViewer(); return; }
      if (clashing(cur)) { showErrs(t("clash")); return; }
      var a = acct(), sa = seriesAa(cur), r = refOf(cur);
      var o = {
        doc: cur, totals: C.totals(cur), seller: C.sellerOf(A.data(), cur), client: cur.c || {}, vat: a.vat,
        series: sa ? sa.series : "", aa: sa ? sa.aa : "", today: A.today(), type: st.type, nature: natureOf(st.type),
        cc: retail ? "" : st.cc, pay: st.pay, exCat: st.exCat, whtCat: st.whtCat, lang: (cur.plang || A.lang) === "el" ? "el" : "en", EU: C.EU,
        ref: r ? { mark: r.mark, label: A.kindName(r.kind) + " " + r.num } : null
      };
      if (cur.kind === "cred" && r) o.nature = natureOf(r.mdt || "");
      var b = M.build(o);
      if (!b.ok) {
        showErrs("", b.errs.map(function (k) {
          return t("err." + k, { d: A.day(cur.date), a: M.clean9(o.seller.afm) || "—", b: a.vat });
        }));
        return;
      }
      busy[d.id] = true;
      ok.disabled = true;
      ok.textContent = t("sending");
      showErrs("");
      // first written down as "sent, no answer yet": a crash or a lost
      // answer leaves a document that must be checked, never re-sent blind
      var pend = JSON.parse(JSON.stringify(cur));
      pend.mds = "?"; pend.mdx = a.id; pend.mdt = st.type; pend.mdq = o.series + "/" + o.aa;
      A.putDoc(pend);
      var Lk = links();
      Lk.call(a.id, [{ m: "POST", path: "/SendInvoices", body: b.body }]).then(function (res) {
        var x = res[0] || {};
        if (x.err) throw { code: "unknown" };
        var p = M.parseSend(x.status, x.data);
        if (p.st === "ok") { done(p, "ok"); return; }
        if (p.st === "offline") { done(p, "off"); return; }
        if (p.st === "dup") return lookup(A.findDoc(d.id), a, b.gross).then(function (f) {
          if (f && f.mark) { done(f, "ok", t("dup", { m: f.mark })); return; }
          clear();
          fail(t("rejected"), p.errs);
        });
        clear();
        if (p.st === "auth") fail(t("auth"));
        else if (p.st === "tech") fail(t("tech"), p.errs);
        else fail(t(p.st === "rejected" ? "rejected" : "bad"), p.errs);
      }).catch(function (er) {
        var code = er && er.code;
        if (code === "unknown" || code === "network" || code === "relay") {
          // it may have arrived: stays "?" until checked
          busy[d.id] = false;
          dlg.close();
          A.toast(t("unknown"));
          A.renderViewer();
          return;
        }
        clear();
        fail(code === "auth" ? t("auth") : t("tech"));
      });
      function clear() {
        var y = JSON.parse(JSON.stringify(A.findDoc(d.id)));
        ["mds", "mdx", "mdt", "mdq"].forEach(function (k) { delete y[k]; });
        A.putDoc(y);
      }
      function fail(title, errs) {
        busy[d.id] = false;
        ok.disabled = false;
        ok.textContent = t("go");
        showErrs(title, (errs || []).map(function (x) { return (x.code ? x.code + ": " : "") + x.message; }));
        A.renderViewer();
      }
      function done(p, state, msg) {
        busy[d.id] = false;
        save(d.id, p, state);
        dlg.close();
        A.toast(msg || (state === "ok" ? t("ok", { m: p.mark }) : t("offline")));
        A.renderViewer();
      }
    });
    form.addEventListener("input", function () { if (!busy[d.id]) errBox.textContent = ""; });
    dlg.appendChild(form);
    A.openDialog(dlg, retail ? tSel : ccIn);
  }
  function save(id, p, state) {
    var y = JSON.parse(JSON.stringify(A.findDoc(id)));
    y.mds = state;
    if (p.mark) y.mark = p.mark;
    if (p.uid) y.mdu = p.uid;
    if (p.auth) y.mda = p.auth;
    if (p.url) y.mdp = p.url;
    A.putDoc(y);
  }
  // RequestTransmittedDocs for this document (series + number + day)
  function lookup(d, a, gross) {
    var q = String(d.mdq || "").split("/");
    var path = "/RequestTransmittedDocs?issuerVatNumber=" + a.vat + "&issuedFrom=" + d.date + "&issuedTo=" + d.date +
               "&series=" + q[0] + "&aa=" + q[1] + "&invoiceType=" + d.mdt;
    return links().call(a.id, [{ m: "GET", path: path }]).then(function (res) {
      var x = res[0] || {};
      if (x.err || !(x.status >= 200 && x.status < 300)) throw { code: x.status === 401 ? "auth" : "network" };
      return M.findSent(x.data, { type: d.mdt, series: q[0], aa: q[1], gross: gross });
    });
  }
  function check(d) {
    var a = accounts().filter(function (x) { return x.id === d.mdx; })[0];
    if (!a || busy[d.id]) { if (!a) A.toast(t("auth")); return; }
    busy[d.id] = true;
    A.renderViewer();
    lookup(d, a, C.totals(d).pay).then(function (f) {
      busy[d.id] = false;
      if (f && f.mark) { save(d.id, f, "ok"); A.toast(t("ok", { m: f.mark })); }
      else if (f) { save(d.id, f, "off"); A.toast(t("stillOff")); }
      else if (d.mds === "?") {
        var y = JSON.parse(JSON.stringify(A.findDoc(d.id)));
        ["mds", "mdx", "mdt", "mdq"].forEach(function (k) { delete y[k]; });
        A.putDoc(y);
        A.toast(t("notFound"));
      } else A.toast(t("stillOff"));
      A.renderViewer();
    }, function (er) {
      busy[d.id] = false;
      A.toast(er && er.code === "auth" ? t("auth") : t("unknown"));
      A.renderViewer();
    });
  }

  // ---------- viewer ----------
  function actions(d, acts) {
    if (!M) return;
    if (canSend(d)) acts.appendChild(A.btn(t("send"), "primary", function () { openSend(d); }));
    if ((d.mds === "?" || d.mds === "off") && accounts().length) {
      acts.appendChild(A.btn(busy[d.id] ? t("checking") : t("check"), d.mds === "?" ? "primary" : "", function () { check(d); }));
    }
  }
  function card(d) {
    if (!d || !d.mds) return null;
    var c = A.el("div", "card md-card");
    c.appendChild(A.el("div", "md-head", t("card")));
    if (d.mds === "?") c.appendChild(A.el("p", "msg-warn", t("pending")));
    if (d.mds === "off") c.appendChild(A.el("p", "msg-warn", t("wait")));
    var dl = A.el("dl", "md-dl");
    [[t("mark"), d.mds === "ok" ? d.mark : ""], [t("uid"), d.mdu], [t("auth2"), d.mda]].forEach(function (x) {
      if (!x[1]) return;
      dl.appendChild(A.el("dt", "", x[0]));
      dl.appendChild(A.el("dd", "", x[1]));
    });
    if (dl.childNodes.length) c.appendChild(dl);
    if (d.mdp && /^https:\/\/provider(-dev)?\.timologisi\.online\//.test(d.mdp)) {
      var a = A.el("a", "dlg-btn", t("pdf"));
      a.href = d.mdp;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      c.appendChild(a);
    }
    return c;
  }

  root.OrosInvoicesMyData = {
    init: function (api) { A = api; C = api.core; },
    accounts: accounts, canSend: canSend, locked: locked, actions: actions, card: card,
    lockedText: function (k) { return t(k === "num" ? "lockedNum" : "lockedVoid"); }
  };
})(typeof window !== "undefined" ? window : this);
