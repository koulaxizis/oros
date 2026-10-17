// ============================================================
// orOS Quote — accept.js (the client's page, wave 46)
// quote/accept.html#q1.… shows a quote that travels inside the link
// (accept-core.js) and lets the client accept it with their name.
// The answer is a link back to the sender's own Quote app
// (…/quote/#acc=a1.…): nothing is stored or sent by this page; the
// client copies, shares or emails the answer themselves.
// Hostile input: accept-core normalizes everything; this file only
// writes text (textContent) and links it built itself.
// ============================================================
(function () {
  "use strict";

  var A = window.OrosQuoteAccept, QC = window.OrosQuoteCore;
  var $ = function (id) { return document.getElementById(id); };

  var STR = {
    en: {
      sub: "Quote", loading: "Opening…",
      privacy: "This page opened the quote that is inside the link, right here in your browser. Nothing was sent to a server.",
      what: "What is orOS?",
      empty: "This page opens quotes sent with orOS. The link you opened has no quote in it, or it was cut short.",
      bad: "This link is damaged or incomplete. Ask the sender for it again.",
      big: "This quote is too big to open.", zip: "This browser is too old to open this link.",
      kind: "Quote", from: "From", to: "For", date: "Date", until: "Valid until", expired: "This quote was valid until {d}. You can still accept it; the sender decides.",
      code: "Code", desc: "Description", qty: "Qty", price: "Unit price", disc: "Disc.", vat: "VAT", amount: "Amount",
      sub_t: "Subtotal", disc_t: "Discount {r} %", vat_t: "VAT", total: "Total",
      ins: "Instalments", pay: "Payment terms", notes: "Notes",
      acceptH: "Accept this quote", name: "Your full name", note: "A message (optional)",
      agree: "I accept this quote as shown above.", accept: "Accept", needName: "Type your name first.", needAgree: "Tick the box to accept.",
      print: "Print or save as PDF",
      doneH: "Accepted", doneText: "Send this answer to {f} so they can record it. Until they get it, nothing is recorded.",
      doneAnon: "Send this answer to the sender so they can record it. Until they get it, nothing is recorded.",
      copy: "Copy the answer", copied: "Copied", copyFail: "Could not copy: select the text and copy it.",
      share: "Share…", email: "Email it to {f}", emailAnon: "Email it",
      mailSubject: "Quote {n} accepted", mailBody: "Hello,\n\nI accept quote {n}.\n\nPlease open this link to record it:\n{l}\n\n{name}",
      answerLabel: "Your answer", crypto: "This browser cannot accept quotes (no secure crypto).",
      safety: "Your answer carries a fingerprint of the quote you saw, so the sender can tell it is the quote they sent."
    },
    el: {
      sub: "Προσφορά", loading: "Άνοιγμα…",
      privacy: "Η σελίδα άνοιξε την προσφορά που έχει μέσα ο σύνδεσμος, εδώ, στον browser σου. Τίποτα δεν στάλθηκε σε server.",
      what: "Τι είναι το orOS;",
      empty: "Εδώ ανοίγουν προσφορές που στέλνονται με το orOS. Ο σύνδεσμος που άνοιξες δεν έχει προσφορά ή κόπηκε.",
      bad: "Ο σύνδεσμος είναι χαλασμένος ή κομμένος. Ζήτα τον ξανά από τον αποστολέα.",
      big: "Η προσφορά είναι πολύ μεγάλη για να ανοίξει.", zip: "Αυτός ο browser είναι πολύ παλιός για να ανοίξει τον σύνδεσμο.",
      kind: "Προσφορά", from: "Από", to: "Προς", date: "Ημερομηνία", until: "Ισχύει έως", expired: "Η προσφορά ίσχυε έως {d}. Μπορείς να την αποδεχτείς· αποφασίζει ο αποστολέας.",
      code: "Κωδ.", desc: "Περιγραφή", qty: "Ποσ.", price: "Τιμή μον.", disc: "Έκπτ.", vat: "ΦΠΑ", amount: "Αξία",
      sub_t: "Υποσύνολο", disc_t: "Έκπτωση {r} %", vat_t: "ΦΠΑ", total: "Σύνολο",
      ins: "Δόσεις", pay: "Όροι πληρωμής", notes: "Σημειώσεις",
      acceptH: "Αποδοχή της προσφοράς", name: "Ονοματεπώνυμο", note: "Μήνυμα (προαιρετικό)",
      agree: "Αποδέχομαι την προσφορά όπως φαίνεται παραπάνω.", accept: "Αποδοχή", needName: "Γράψε πρώτα το όνομά σου.", needAgree: "Τσέκαρε το κουτί για αποδοχή.",
      print: "Εκτύπωση ή αποθήκευση PDF",
      doneH: "Αποδεκτή", doneText: "Στείλε αυτή την απάντηση στον/στην {f} για να την καταχωρίσει. Μέχρι να τη λάβει, δεν έχει καταχωριστεί τίποτα.",
      doneAnon: "Στείλε αυτή την απάντηση στον αποστολέα για να την καταχωρίσει. Μέχρι να τη λάβει, δεν έχει καταχωριστεί τίποτα.",
      copy: "Αντιγραφή της απάντησης", copied: "Αντιγράφηκε", copyFail: "Η αντιγραφή απέτυχε: επίλεξε το κείμενο και αντέγραψέ το.",
      share: "Κοινοποίηση…", email: "Email στον/στην {f}", emailAnon: "Αποστολή με email",
      mailSubject: "Αποδοχή προσφοράς {n}", mailBody: "Καλησπέρα,\n\nαποδέχομαι την προσφορά {n}.\n\nΑνοίξτε αυτόν τον σύνδεσμο για να την καταχωρίσετε:\n{l}\n\n{name}",
      answerLabel: "Η απάντησή σου", crypto: "Αυτός ο browser δεν μπορεί να αποδεχτεί προσφορές (λείπει η ασφαλής κρυπτογραφία).",
      safety: "Η απάντησή σου έχει ένα «αποτύπωμα» της προσφοράς που είδες, ώστε ο αποστολέας να ξέρει ότι είναι αυτή που έστειλε."
    }
  };
  // orosI18n (../i18n.js): a chosen pack language (oros-lang, ?lang=);
  // else, as before, English or Greek by the browser (a customer
  // without orOS has no oros-lang).
  var LANG = (function () {
    var c = window.orosI18n ? window.orosI18n.lang() : "en";
    if (c !== "en") return c;
    try {
      var l = localStorage.getItem("oros-lang");
      if (l === "el" || l === "en") return l;
    } catch (e) {}
    return /^el\b/i.test(navigator.language || "") ? "el" : "en";
  })();
  if (window.orosI18n) window.orosI18n.table(STR, "quote", LANG);
  var LOC = window.orosI18n ? window.orosI18n.locale(LANG) : (LANG === "el" ? "el-GR" : "en-GB");
  function t(k, p) {
    var s = (STR[LANG] || STR.en)[k];
    if (s === undefined) s = STR.en[k] || k;
    Object.keys(p || {}).forEach(function (x) { s = s.split("{" + x + "}").join(String(p[x])); });
    return s;
  }

  // ---------- Palette (same rules as share/view.js) ----------
  var PAL_VARS = ["--bg", "--text", "--text-dim", "--accent", "--accent-soft", "--panel-bg", "--border"];
  function inheritPalette() {
    var root = document.documentElement, theme = null;
    try {
      var pRoot = window.parent !== window ? window.parent.document.documentElement : null;
      if (pRoot) {
        theme = pRoot.getAttribute("data-theme");
        var cs = window.parent.getComputedStyle(pRoot);
        PAL_VARS.forEach(function (v) {
          var val = cs.getPropertyValue(v).trim();
          if (val) root.style.setProperty(v, val);
        });
      }
    } catch (e) { /* standalone */ }
    if (!theme) { try { theme = localStorage.getItem("oros-theme"); } catch (e) {} }
    if (theme !== "light" && theme !== "dark") {
      theme = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    }
    root.setAttribute("data-theme", theme);
  }
  function watchPalette() {
    try {
      if (window.parent !== window) {
        new MutationObserver(inheritPalette).observe(window.parent.document.documentElement,
          { attributes: true, attributeFilter: ["data-skin", "data-theme"] });
        return;
      }
    } catch (e) {}
    try { window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", inheritPalette); } catch (e) {}
  }

  // ---------- DOM helpers (text only) ----------
  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt !== undefined && txt !== null) e.textContent = txt;
    return e;
  }
  function btn(label, cls, fn) {
    var b = el("button", cls, label);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }
  function toast(msg) {
    var old = document.querySelector(".toast");
    if (old) old.remove();
    var d = el("div", "toast", msg);
    d.setAttribute("role", "status");
    document.body.appendChild(d);
    setTimeout(function () { d.remove(); }, 2600);
  }
  function money(n, c) { return QC ? QC.fmtMoney(n, c, LANG) : n.toFixed(2) + " " + c; }
  function num(n) {
    try { return new Intl.NumberFormat(LOC, { maximumFractionDigits: 3 }).format(n); }
    catch (e) { return String(n); }
  }
  function day(ymd) {
    if (!ymd) return "—";
    var p = ymd.split("-");
    if (LANG === "el") return +p[2] + "/" + +p[1] + "/" + p[0];
    if (LANG === "en") return p[2] + "/" + p[1] + "/" + p[0];
    try {
      return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString(LOC, { day: "numeric", month: "numeric", year: "numeric" });
    } catch (e) { return p[2] + "/" + p[1] + "/" + p[0]; }
  }
  function todayYmd() {
    var d = new Date(), p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }
  function state(msg, err) {
    var card = $("card");
    card.textContent = "";
    var p = el("p", "state" + (err ? " err" : ""), msg);
    card.appendChild(p);
  }

  // ---------- The quote ----------
  function render(s) {
    var card = $("card");
    card.textContent = "";
    card.appendChild(el("p", "kind", t("kind")));
    card.appendChild(el("h1", "", s.n || t("kind")));
    var dl = el("dl", "fields");
    function row(k, v) { if (!v) return; dl.appendChild(el("dt", "", k)); dl.appendChild(el("dd", "pre", v)); }
    row(t("from"), s.f);
    row(t("to"), [s.cl.n, s.cl.a, s.cl.t].filter(Boolean).join("\n"));
    row(t("date"), s.d ? day(s.d) : "");
    row(t("until"), s.u ? day(s.u) : "");
    card.appendChild(dl);
    if (s.u && s.u < todayYmd()) card.appendChild(el("p", "hint warn", t("expired", { d: day(s.u) })));

    var tt = A.totals(s);
    var wrap = el("div", "qa-table-wrap");
    var tbl = el("table", "qa-table");
    var thead = el("thead"), hr = el("tr");
    var anyCode = s.it.some(function (x) { return x.c; }), anyDisc = s.it.some(function (x) { return x.x; });
    var cols = [anyCode ? ["code", ""] : null, ["desc", ""], ["qty", "num"], ["price", "num"], anyDisc ? ["disc", "num"] : null, ["vat", "num"], ["amount", "num"]].filter(Boolean);
    cols.forEach(function (c) { hr.appendChild(el("th", c[1], t(c[0]))); });
    thead.appendChild(hr);
    tbl.appendChild(thead);
    var tb = el("tbody");
    s.it.forEach(function (x, i) {
      var tr = el("tr");
      if (anyCode) tr.appendChild(el("td", "", x.c));
      tr.appendChild(el("td", "desc", x.d));
      tr.appendChild(el("td", "num", num(x.q)));
      tr.appendChild(el("td", "num", money(x.p, s.c)));
      if (anyDisc) tr.appendChild(el("td", "num", x.x ? num(x.x) + "%" : ""));
      tr.appendChild(el("td", "num", num(x.v) + "%"));
      tr.appendChild(el("td", "num", money(tt.lines[i], s.c)));
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    wrap.appendChild(tbl);
    card.appendChild(wrap);

    var tot = el("dl", "qa-totals");
    function trow(k, v, cls) { var dt = el("dt", cls, k), dd = el("dd", cls, v); tot.appendChild(dt); tot.appendChild(dd); }
    trow(t("sub_t"), money(tt.sub, s.c));
    if (tt.disc) trow(t("disc_t", { r: num(s.g) }), "−" + money(tt.disc, s.c));
    trow(t("vat_t"), money(tt.vat, s.c));
    trow(t("total"), money(tt.total, s.c), "grand");
    card.appendChild(tot);

    if (s.ins.length) {
      card.appendChild(el("h2", "", t("ins")));
      var ul = el("ul", "plain");
      s.ins.forEach(function (x) { ul.appendChild(el("li", "", day(x.d) + " — " + money(x.a, s.c))); });
      card.appendChild(ul);
    }
    if (s.pay) { card.appendChild(el("h2", "", t("pay"))); card.appendChild(el("p", "pre", s.pay)); }
    if (s.no) { card.appendChild(el("h2", "", t("notes"))); card.appendChild(el("p", "pre", s.no)); }

    card.appendChild(acceptForm(s));
  }

  function acceptForm(s) {
    var box = el("section", "qa-accept");
    box.appendChild(el("h2", "", t("acceptH")));
    var nameL = el("label", "qa-field");
    nameL.appendChild(el("span", "", t("name")));
    var name = el("input");
    name.type = "text";
    name.maxLength = 80;
    name.autocomplete = "name";
    name.id = "qa-name";
    nameL.appendChild(name);
    box.appendChild(nameL);
    var noteL = el("label", "qa-field");
    noteL.appendChild(el("span", "", t("note")));
    var note = el("textarea");
    note.rows = 2;
    note.maxLength = 500;
    note.id = "qa-note";
    noteL.appendChild(note);
    box.appendChild(noteL);
    var agreeL = el("label", "qa-check");
    var agree = el("input");
    agree.type = "checkbox";
    agree.id = "qa-agree";
    agreeL.appendChild(agree);
    agreeL.appendChild(el("span", "", t("agree")));
    box.appendChild(agreeL);
    var msg = el("p", "state err");
    msg.hidden = true;
    box.appendChild(msg);
    var acts = el("div", "acts");
    var go = btn(t("accept"), "prim", function () {
      var n = name.value.replace(/\s+/g, " ").trim();
      if (!n) { msg.textContent = t("needName"); msg.hidden = false; name.focus(); return; }
      if (!agree.checked) { msg.textContent = t("needAgree"); msg.hidden = false; agree.focus(); return; }
      go.disabled = true;
      A.digest(s).then(function (h) {
        var code = A.makeReply({ i: s.id, t: s.tok, h: h, n: n, at: Date.now(), m: note.value });
        if (!code) throw new Error("bad");
        done(s, code, n, box);
      }).catch(function () { go.disabled = false; msg.textContent = t("crypto"); msg.hidden = false; });
    });
    go.id = "qa-accept";
    acts.appendChild(go);
    acts.appendChild(btn(t("print"), "", function () { window.print(); }));
    box.appendChild(acts);
    box.appendChild(el("p", "hint", t("safety")));
    return box;
  }

  function done(s, code, name, box) {
    var link = location.origin + location.pathname.replace(/[^\/]*$/, "") + "#acc=" + code;
    box.textContent = "";
    box.classList.add("qa-done");
    box.appendChild(el("h2", "", "✓ " + t("doneH")));
    box.appendChild(el("p", "", s.f ? t("doneText", { f: s.f }) : t("doneAnon")));
    var lab = el("label", "qa-field");
    lab.appendChild(el("span", "", t("answerLabel")));
    var out = el("textarea", "qa-answer");
    out.readOnly = true;
    out.rows = 3;
    out.value = link;
    out.id = "qa-answer";
    lab.appendChild(out);
    box.appendChild(lab);
    var acts = el("div", "acts");
    acts.appendChild(btn(t("copy"), "prim", function () {
      var ok = function () { toast(t("copied")); };
      var fail = function () { out.select(); try { if (document.execCommand("copy")) { ok(); return; } } catch (e) {} toast(t("copyFail")); };
      try { navigator.clipboard.writeText(link).then(ok, fail); } catch (e) { fail(); }
    }));
    if (typeof navigator.share === "function") {
      acts.appendChild(btn(t("share"), "", function () {
        navigator.share({ title: t("mailSubject", { n: s.n }), text: t("mailSubject", { n: s.n }), url: link }).catch(function () {});
      }));
    }
    var mail = el("a", "btn", s.f ? t("email", { f: s.f }) : t("emailAnon"));
    mail.href = "mailto:" + encodeURIComponent(s.fe || "") + "?subject=" + encodeURIComponent(t("mailSubject", { n: s.n })) +
      "&body=" + encodeURIComponent(t("mailBody", { n: s.n, l: link, name: name }));
    acts.appendChild(mail);
    box.appendChild(acts);
    out.focus();
    out.select();
  }

  // ---------- Boot ----------
  function boot() {
    document.documentElement.lang = LANG;
    $("top-sub").textContent = t("sub");
    $("privacy").textContent = t("privacy");
    $("what").textContent = t("what");
    inheritPalette();
    watchPalette();
    state(t("loading"));
    var code = A ? A.offerCodeFromHash(location.hash) : "";
    if (!code) { state(t("empty")); return; }
    A.decodeOffer(code).then(function (r) {
      if (r.error) { state(t(r.error === "big" ? "big" : r.error === "zip" ? "zip" : "bad"), true); return; }
      document.title = "orOS · " + t("kind") + " " + (r.snap.n || "");
      render(r.snap);
    }, function () { state(t("bad"), true); });
  }
  window.addEventListener("hashchange", boot);
  boot();
})();
