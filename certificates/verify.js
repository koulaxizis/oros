// ============================================================
// orOS Certificates — the check page (verify.html), v1.0.0
// Opens from the QR code on a certificate:
//   verify.html#c1.<payload>.<public key>.<signature>  (see sign.js)
// Checks the ECDSA signature with WebCrypto, right here, offline;
// nothing is sent anywhere (the part after # never reaches a server).
// Shows the signed details and the key fingerprint, which the
// issuer publishes so people can trust it. Every value is shown as
// text (textContent), never as HTML.
// ============================================================
(function () {
  "use strict";
  var S = window.CertSign;

  var STR = {
    en: {
      "top.sub": "Certificate check", "state.loading": "Checking…",
      "ask.label": "Paste the link of the QR code", "ask.go": "Check",
      "foot.privacy": "The check runs right here in your browser, even offline. Nothing is sent to a server.",
      "foot.what": "What is orOS?",
      "none": "Scan the QR code on a certificate made with orOS, or paste its link below.",
      "noCrypto": "This browser cannot check signatures. Open the link in an up-to-date browser.",
      "ok": "Genuine signature", "okSub": "These details were signed with the key below and have not been changed.",
      "bad": "Not valid", "badSub": "This code was changed or is damaged. The details cannot be trusted.",
      "broken": "This is not a certificate check link, or part of it is missing.",
      "vf.no": "Number", "vf.n": "Name", "vf.t": "For", "vf.dates": "Dates", "vf.place": "Place", "vf.hours": "Hours",
      "vf.g": "Grade", "vf.issuer": "Issued by", "vf.idate": "Issued on", "vf.fp": "Key",
      "note.fp": "Compare this key with the one the organisation publishes (website, emails). The same key means the certificate comes from them.",
      "note.rv": "A certificate the organisation withdrew after it was issued still shows as signed here. When in doubt, ask them."
    },
    el: {
      "top.sub": "Έλεγχος πιστοποιητικού", "state.loading": "Γίνεται έλεγχος…",
      "ask.label": "Επικολλήστε τον σύνδεσμο του κωδικού QR", "ask.go": "Έλεγχος",
      "foot.privacy": "Ο έλεγχος γίνεται εδώ, στον browser σας, ακόμη και χωρίς σύνδεση. Δεν στέλνεται τίποτα σε server.",
      "foot.what": "Τι είναι το orOS;",
      "none": "Σκανάρετε τον κωδικό QR ενός πιστοποιητικού που φτιάχτηκε με το orOS ή επικολλήστε τον σύνδεσμό του παρακάτω.",
      "noCrypto": "Αυτός ο browser δεν μπορεί να ελέγξει υπογραφές. Ανοίξτε τον σύνδεσμο σε έναν ενημερωμένο browser.",
      "ok": "Γνήσια υπογραφή", "okSub": "Τα στοιχεία υπογράφηκαν με το παρακάτω κλειδί και δεν έχουν αλλάξει.",
      "bad": "Δεν είναι έγκυρο", "badSub": "Ο κωδικός άλλαξε ή είναι κατεστραμμένος. Τα στοιχεία δεν είναι αξιόπιστα.",
      "broken": "Αυτός δεν είναι σύνδεσμος ελέγχου πιστοποιητικού ή λείπει κομμάτι του.",
      "vf.no": "Αριθμός", "vf.n": "Όνομα", "vf.t": "Για", "vf.dates": "Ημερομηνίες", "vf.place": "Τόπος", "vf.hours": "Ώρες",
      "vf.g": "Βαθμός", "vf.issuer": "Φορέας", "vf.idate": "Ημερομηνία έκδοσης", "vf.fp": "Κλειδί",
      "note.fp": "Συγκρίνετε αυτό το κλειδί με αυτό που δημοσιεύει ο φορέας (ιστότοπος, email). Ίδιο κλειδί σημαίνει ότι το πιστοποιητικό προέρχεται από αυτόν.",
      "note.rv": "Ένα πιστοποιητικό που ο φορέας ανακάλεσε μετά την έκδοση εξακολουθεί να φαίνεται υπογεγραμμένο εδώ. Αν έχετε αμφιβολία, ρωτήστε τον φορέα."
    }
  };
  // orosI18n (../i18n.js): the orOS language of this browser, a pack
  // language included; without a stored choice, the browser's.
  var I18N = window.orosI18n || null;
  var LANG = (function () {
    var l = null;
    try { l = localStorage.getItem("oros-lang"); } catch (e) {}
    if (I18N && I18N.known(l)) return I18N.lang();
    if (l === "el" || l === "en") return l;
    return /^el\b/i.test(navigator.language || "") ? "el" : "en";
  })();
  if (I18N) I18N.table(STR, "certificates", LANG);
  function t(k) { return (STR[LANG] && STR[LANG][k]) || STR.en[k] || k; }

  // ---------- palette: the orOS theme of this browser, else the system's ----------
  function theme() {
    var th = null;
    try { th = localStorage.getItem("oros-theme"); } catch (e) {}
    if (th !== "light" && th !== "dark") th = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", th);
  }

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, txt) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt !== undefined && txt !== null) n.textContent = txt;
    return n;
  }
  function fmtDay(ymd, lang) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || "");
    if (!m) return "";
    try {
      return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString(I18N && I18N.known(lang) ? I18N.locale(lang) : lang === "el" ? "el-GR" : "en-GB", { day: "numeric", month: "long", year: "numeric" });
    } catch (e) { return ymd; }
  }

  var subtle = (function () { try { return window.crypto && window.crypto.subtle || null; } catch (e) { return null; } })();

  function show(nodes) {
    var card = $("card");
    card.textContent = "";
    nodes.forEach(function (n) { card.appendChild(n); });
  }
  function message(txt) { show([el("p", "state", txt)]); }
  function verdict(ok) {
    var v = el("div", "verdict " + (ok ? "ok" : "bad"));
    v.setAttribute("role", "status");
    v.appendChild(el("div", "mark", ok ? "✓" : "!"));
    var b = el("div");
    b.appendChild(el("strong", null, t(ok ? "ok" : "bad")));
    b.appendChild(el("span", null, t(ok ? "okSub" : "badSub")));
    v.appendChild(b);
    return v;
  }

  var run = 0;
  function check(src) {
    var mine = ++run;
    $("ask").hidden = false;
    if (!S) { message(t("broken")); return; }
    var x = S.parseLink(src);
    if (!src || !/c1\./.test(src)) { message(t("none")); return; }
    if (!x) { show([verdict(false), el("p", "note", t("broken"))]); return; }
    if (!subtle) { message(t("noCrypto")); return; }
    message(t("state.loading"));
    Promise.all([S.verify(subtle, x), S.fingerprint(subtle, x.pub)]).then(function (r) {
      if (mine !== run) return;
      var ok = r[0], fp = r[1], d = x.data;
      if (!ok) { show([verdict(false)]); return; }
      $("ask").hidden = true;
      var out = [verdict(true)];
      out.push(el("h1", null, d.n || "—"));
      if (d.t) out.push(el("p", "sub", d.t));
      var dl = el("dl");
      function row(key, val, cls) {
        if (!val) return;
        dl.appendChild(el("dt", null, t(key)));
        dl.appendChild(el("dd", cls || null, val));
      }
      row("vf.no", d.no);
      row("vf.dates", d.dates);
      row("vf.place", d.place);
      row("vf.hours", d.hours);
      row("vf.g", d.g);
      row("vf.issuer", d.issuer);
      row("vf.idate", fmtDay(d.idate, d.lang));
      row("vf.fp", fp, "fp");
      out.push(dl);
      out.push(el("p", "note", t("note.fp")));
      out.push(el("p", "note", t("note.rv")));
      show(out);
    }, function () { if (mine === run) show([verdict(false)]); });
  }

  function boot() {
    theme();
    document.documentElement.lang = LANG;
    document.title = "orOS · " + t("top.sub");
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) { n.textContent = t(n.getAttribute("data-i18n")); });
    $("ask").addEventListener("submit", function (e) {
      e.preventDefault();
      var v = $("ask-in").value.trim();
      var h = v.indexOf("#");
      // a pasted link becomes this page's own address, so it can be shared as is
      if (h >= 0 || /^c1\./.test(v)) {
        var code = h >= 0 ? v.slice(h + 1) : v;
        if (location.hash.slice(1) !== code) { location.hash = code; return; }
      }
      check(v);
    });
    window.addEventListener("hashchange", function () { check(location.hash); });
    check(location.hash);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
