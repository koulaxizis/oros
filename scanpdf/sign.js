// ============================================================
// orOS Scanner & PDF — sign.js: the signing page (sign.html)
// ------------------------------------------------------------
// scanpdf/sign.html#r1.… (or #q1.… with an access code) opens a
// signature request (sign-core.js) in any browser, with no orOS and
// no account: the PDF comes from the relay as encrypted pieces and is
// opened here with the key in the link. The person reads it, fills
// the fields in (signature, initials, name, date, text, tick), agrees
// to sign electronically and signs; or declines with a reason. The
// signed PDF (with a certificate page and the record attached) is
// made here and downloaded at once, and the reply goes back to the
// relay as a new encrypted item; its link (…/scanpdf/#signed=…) is
// for the sender, who copies, shares or emails it themselves.
// Hostile input: sign-core cleans the request and the reply; this
// file writes text only (textContent) and links it built itself.
// ============================================================
(function () {
  "use strict";

  var C = window.ScanPdfCore, OPS = window.ScanPdfOps, S = window.ScanPdfSign, R = window.OrosShareRelay;
  var $ = function (id) { return document.getElementById(id); };

  var STR = {
    en: {
      "sg.sub": "Sign", "sg.loading": "Opening…", "sg.what": "What is orOS?",
      "sg.privacy": "The document travelled encrypted. Only this browser could open it, with the key that is in the link.",
      "sg.empty": "This page opens documents sent with orOS to be signed. The link you opened has no document in it, or it was cut short.",
      "sg.bad": "This link is damaged or incomplete. Ask the sender for it again.",
      "sg.gone": "This request is no longer here: it expired or the sender took it back. Ask the sender for a new link.",
      "sg.net": "Could not reach the orOS server. Check your connection and try again.",
      "sg.big": "This document is too big to open here.", "sg.crypto": "This browser cannot open signature requests (no secure crypto).",
      "sg.changed": "The document does not match its fingerprint, so it was not opened. Ask the sender for a new link.",
      "sg.again": "Try again",
      "sg.codeH": "Access code", "sg.codeText": "The sender locked this document with an access code. They told it to you another way (by phone, in a message).",
      "sg.code": "Access code", "sg.open": "Open", "sg.wrongCode": "That access code is not right.",
      "sg.kind": "Please sign", "sg.from": "From", "sg.for": "For", "sg.until": "Sign by", "sg.pages": "Pages",
      "sg.message": "Message", "sg.howTo": "Tap each yellow box to fill it in. Boxes marked * must be filled.",
      "sg.f.sig": "Sign here", "sg.f.init": "Initials", "sg.f.name": "Name", "sg.f.date": "Date", "sg.f.text": "Text",
      "sg.f.check": "Tick", "sg.req": "*", "sg.filled": "Filled: {label}", "sg.empty1": "Empty: {label}",
      "sg.page": "Page {n} of {total}", "sg.pageLoading": "Page {n}…",
      "sg.padSig": "Your signature", "sg.padInit": "Your initials", "sg.draw": "Draw", "sg.type": "Type",
      "sg.drawHint": "Sign in the box with your finger, a pen or the mouse.", "sg.clear": "Start again",
      "sg.cancel": "Cancel", "sg.use": "Use it", "sg.padEmpty": "Draw or type first.",
      "sg.textH": "Fill in", "sg.ok": "OK",
      "sg.finishH": "Sign", "sg.yourName": "Your full name",
      "sg.consent": "I agree to sign this document electronically, and that my electronic signature counts like a handwritten one for this document.",
      "sg.records": "Signing records the time, your time zone and the name of your browser. Nothing else about you is kept.",
      "sg.sign": "Sign", "sg.decline": "Decline", "sg.need": "Still to fill in: {list}.", "sg.needName": "Type your name first.",
      "sg.needConsent": "Tick the box to agree to sign electronically.",
      "sg.making": "Making the signed PDF…", "sg.sending": "Sending your answer…",
      "sg.declineH": "Decline to sign", "sg.why": "Why (optional, the sender will see it)", "sg.declineGo": "Decline",
      "sg.doneH": "Signed", "sg.doneText": "Your signed copy was downloaded. Keep it: it is your proof. Now send this answer to {f}, so they get the signed PDF too.",
      "sg.declinedH": "Declined", "sg.declinedText": "Send this answer to {f}, so they know.",
      "sg.download": "Download my signed copy again", "sg.copy": "Copy the answer", "sg.copied": "Copied",
      "sg.copyFail": "Could not copy: select the text and copy it.", "sg.share": "Share…", "sg.email": "Email it to {f}",
      "sg.answer": "Your answer (a link)", "sg.answerNote": "Until {f} opens it, they don't know you signed. The answer stays on the orOS server for 30 days, encrypted.",
      "sg.doneAuto": "Your signed copy was downloaded. Keep it: it is your proof. Your answer went back to {f} on its own: there is nothing more to do.",
      "sg.declinedAuto": "Your answer went back to {f} on its own: there is nothing more to do.",
      "sg.autoNote": "It waits for {f} on the orOS server, encrypted, and goes when they open orOS (at most 30 days after the link's end).",
      "sg.mailSubject": "Signed: {n}", "sg.mailSubjectNo": "Declined: {n}",
      "sg.mailBody": "Hello,\n\nI signed \"{n}\". Please open this link to get the signed PDF:\n{l}\n\n{name}",
      "sg.mailBodyNo": "Hello,\n\nI declined to sign \"{n}\". Open this link to see my answer:\n{l}\n\n{name}",
      "sg.sendFail": "Your answer could not be sent. Your signed copy is downloaded; try sending again.", "sg.sendAgain": "Send again",
      "sg.buildFail": "The signed PDF could not be made in this browser.",
      "sg.legal": "A simple electronic signature under the EU eIDAS rules. It is not a qualified electronic signature.",
      "sg.fileName": "{n} (signed).pdf"
    },
    el: {
      "sg.sub": "Υπογραφή", "sg.loading": "Άνοιγμα…", "sg.what": "Τι είναι το orOS;",
      "sg.privacy": "Το έγγραφο ταξίδεψε κρυπτογραφημένο. Μόνο αυτός ο browser μπορούσε να το ανοίξει, με το κλειδί που έχει ο σύνδεσμος.",
      "sg.empty": "Εδώ ανοίγουν έγγραφα που στέλνονται με το orOS για υπογραφή. Ο σύνδεσμος που άνοιξες δεν έχει έγγραφο ή κόπηκε.",
      "sg.bad": "Ο σύνδεσμος είναι χαλασμένος ή κομμένος. Ζήτα τον ξανά από τον αποστολέα.",
      "sg.gone": "Το αίτημα δεν υπάρχει πια: έληξε ή ο αποστολέας το πήρε πίσω. Ζήτα νέο σύνδεσμο από τον αποστολέα.",
      "sg.net": "Δεν βρέθηκε ο server του orOS. Έλεγξε τη σύνδεσή σου και δοκίμασε ξανά.",
      "sg.big": "Το έγγραφο είναι πολύ μεγάλο για να ανοίξει εδώ.", "sg.crypto": "Αυτός ο browser δεν μπορεί να ανοίξει αιτήματα υπογραφής (λείπει η ασφαλής κρυπτογραφία).",
      "sg.changed": "Το έγγραφο δεν ταιριάζει με το αποτύπωμά του, γι' αυτό δεν άνοιξε. Ζήτα νέο σύνδεσμο από τον αποστολέα.",
      "sg.again": "Δοκίμασε ξανά",
      "sg.codeH": "Κωδικός πρόσβασης", "sg.codeText": "Ο αποστολέας κλείδωσε το έγγραφο με κωδικό πρόσβασης. Σου τον είπε με άλλο τρόπο (στο τηλέφωνο, σε μήνυμα).",
      "sg.code": "Κωδικός πρόσβασης", "sg.open": "Άνοιγμα", "sg.wrongCode": "Ο κωδικός πρόσβασης δεν είναι σωστός.",
      "sg.kind": "Για υπογραφή", "sg.from": "Από", "sg.for": "Προς", "sg.until": "Υπογραφή έως", "sg.pages": "Σελίδες",
      "sg.message": "Μήνυμα", "sg.howTo": "Πάτησε κάθε κίτρινο πλαίσιο για να το συμπληρώσεις. Όσα έχουν * είναι υποχρεωτικά.",
      "sg.f.sig": "Υπόγραψε εδώ", "sg.f.init": "Μονογραφή", "sg.f.name": "Όνομα", "sg.f.date": "Ημερομηνία", "sg.f.text": "Κείμενο",
      "sg.f.check": "Τικ", "sg.req": "*", "sg.filled": "Συμπληρωμένο: {label}", "sg.empty1": "Κενό: {label}",
      "sg.page": "Σελίδα {n} από {total}", "sg.pageLoading": "Σελίδα {n}…",
      "sg.padSig": "Η υπογραφή σου", "sg.padInit": "Η μονογραφή σου", "sg.draw": "Σχεδίασε", "sg.type": "Πληκτρολόγησε",
      "sg.drawHint": "Υπόγραψε στο πλαίσιο με το δάχτυλο, γραφίδα ή το ποντίκι.", "sg.clear": "Από την αρχή",
      "sg.cancel": "Άκυρο", "sg.use": "Χρήση", "sg.padEmpty": "Πρώτα σχεδίασε ή γράψε.",
      "sg.textH": "Συμπλήρωση", "sg.ok": "OK",
      "sg.finishH": "Υπογραφή", "sg.yourName": "Ονοματεπώνυμο",
      "sg.consent": "Συμφωνώ να υπογράψω το έγγραφο ηλεκτρονικά και ότι η ηλεκτρονική μου υπογραφή μετρά όπως η ιδιόχειρη για αυτό το έγγραφο.",
      "sg.records": "Με την υπογραφή καταγράφονται η ώρα, η ζώνη ώρας σου και το όνομα του browser σου. Τίποτα άλλο για σένα δεν κρατιέται.",
      "sg.sign": "Υπογραφή", "sg.decline": "Άρνηση", "sg.need": "Μένουν να συμπληρωθούν: {list}.", "sg.needName": "Γράψε πρώτα το όνομά σου.",
      "sg.needConsent": "Τσέκαρε το κουτί για να συμφωνήσεις στην ηλεκτρονική υπογραφή.",
      "sg.making": "Φτιάχνεται το υπογεγραμμένο PDF…", "sg.sending": "Στέλνεται η απάντησή σου…",
      "sg.declineH": "Άρνηση υπογραφής", "sg.why": "Γιατί (προαιρετικό, θα το δει ο αποστολέας)", "sg.declineGo": "Άρνηση",
      "sg.doneH": "Υπογράφηκε", "sg.doneText": "Το υπογεγραμμένο αντίγραφό σου κατέβηκε. Κράτησέ το: είναι η απόδειξή σου. Τώρα στείλε αυτή την απάντηση στον/στην {f}, για να πάρει κι εκείνος/η το υπογεγραμμένο PDF.",
      "sg.declinedH": "Αρνήθηκες", "sg.declinedText": "Στείλε αυτή την απάντηση στον/στην {f}, για να το ξέρει.",
      "sg.download": "Κατέβασε ξανά το αντίγραφό μου", "sg.copy": "Αντιγραφή της απάντησης", "sg.copied": "Αντιγράφηκε",
      "sg.copyFail": "Η αντιγραφή απέτυχε: επίλεξε το κείμενο και αντέγραψέ το.", "sg.share": "Κοινοποίηση…", "sg.email": "Email στον/στην {f}",
      "sg.answer": "Η απάντησή σου (σύνδεσμος)", "sg.answerNote": "Μέχρι να την ανοίξει ο/η {f}, δεν ξέρει ότι υπέγραψες. Η απάντηση μένει κρυπτογραφημένη στον server του orOS για 30 ημέρες.",
      "sg.doneAuto": "Το υπογεγραμμένο αντίγραφό σου κατέβηκε. Κράτησέ το: είναι η απόδειξή σου. Η απάντησή σου πήγε μόνη της στον/στην {f}: δεν χρειάζεται να κάνεις κάτι άλλο.",
      "sg.declinedAuto": "Η απάντησή σου πήγε μόνη της στον/στην {f}: δεν χρειάζεται να κάνεις κάτι άλλο.",
      "sg.autoNote": "Περιμένει τον/την {f} κρυπτογραφημένη στον server του orOS και φεύγει όταν ανοίξει το orOS (το πολύ 30 ημέρες μετά τη λήξη του συνδέσμου).",
      "sg.mailSubject": "Υπογράφηκε: {n}", "sg.mailSubjectNo": "Άρνηση: {n}",
      "sg.mailBody": "Καλησπέρα,\n\nυπέγραψα το «{n}». Ανοίξτε αυτόν τον σύνδεσμο για να πάρετε το υπογεγραμμένο PDF:\n{l}\n\n{name}",
      "sg.mailBodyNo": "Καλησπέρα,\n\nδεν υπέγραψα το «{n}». Ανοίξτε αυτόν τον σύνδεσμο για να δείτε την απάντησή μου:\n{l}\n\n{name}",
      "sg.sendFail": "Η απάντησή σου δεν στάλθηκε. Το υπογεγραμμένο αντίγραφο κατέβηκε· δοκίμασε να τη στείλεις ξανά.", "sg.sendAgain": "Στείλε ξανά",
      "sg.buildFail": "Το υπογεγραμμένο PDF δεν μπόρεσε να φτιαχτεί σε αυτόν τον browser.",
      "sg.legal": "Απλή ηλεκτρονική υπογραφή κατά τους κανόνες eIDAS της ΕΕ. Δεν είναι εγκεκριμένη ηλεκτρονική υπογραφή.",
      "sg.fileName": "{n} (υπογεγραμμένο).pdf"
    }
  };
  // orosI18n (../i18n.js): a chosen language (oros-lang, ?lang=); else
  // the browser's (the signer usually has no orOS), English otherwise.
  var LANG = (function () {
    var c = window.orosI18n ? window.orosI18n.lang() : "en";
    if (c !== "en") return c;
    try {
      var l = localStorage.getItem("oros-lang");
      if (l) return l;
    } catch (e) {}
    var nav = String(navigator.language || "");
    return /^el\b/i.test(nav) ? "el" : /^de\b/i.test(nav) ? "de" : "en";
  })();
  if (window.orosI18n) window.orosI18n.table(STR, "scanpdf", LANG);
  var LOC = window.orosI18n ? window.orosI18n.locale(LANG) : (LANG === "el" ? "el-GR" : "en-GB");
  function t(k, p) {
    var s = (STR[LANG] || STR.en)[k];
    if (s === undefined) s = STR.en[k] || k;
    Object.keys(p || {}).forEach(function (x) { s = s.split("{" + x + "}").join(String(p[x])); });
    return s;
  }

  // ---------- Palette (as share/view.js) ----------
  function applyTheme() {
    var root = document.documentElement, theme = null;
    try { theme = localStorage.getItem("oros-theme"); } catch (e) {}
    if (theme !== "light" && theme !== "dark") {
      theme = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    }
    root.setAttribute("data-theme", theme);
  }
  function watchTheme() {
    try { window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", applyTheme); } catch (e) {}
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
  function state(msg, err, retry) {
    var card = $("card");
    card.textContent = "";
    var p = el("p", "state" + (err ? " err" : ""), msg);
    card.appendChild(p);
    if (retry) { var a = el("div", "acts"); a.appendChild(btn(t("sg.again"), "prim", retry)); card.appendChild(a); }
  }
  function fmtDay(ms) {
    try { return new Date(ms).toLocaleDateString(LOC, { day: "numeric", month: "long", year: "numeric" }); }
    catch (e) { return new Date(ms).toISOString().slice(0, 10); }
  }
  function today() {
    try { return new Date().toLocaleDateString(LOC); } catch (e) { return new Date().toISOString().slice(0, 10); }
  }
  function label(f) { return t("sg.f." + f.k); }

  // ---------- state ----------
  var code = "", rid = "", req = null, pdf = null, expires = 0, password = "", rbox = null;
  var vals = {}, opened = 0, consented = 0, signedBlob = null, sigs = { sig: null, init: null };
  var fieldEls = {};

  // ---------- opening ----------
  function open() {
    state(t("sg.loading"));
    R.open(code, { password: password || undefined }).then(function (r) {
      if (r.error === "pass") { askCode(!!password); return; }
      if (r.error) { state(t("sg." + (["gone", "net", "big"].indexOf(r.error) >= 0 ? r.error : "bad")), true, r.error === "net" ? open : null); return; }
      var e = r.e, rq = e && e.k === "sign" ? S.cleanRequest(e.d) : null;
      if (!rq || !r.bin || !r.bin.length) { state(t("sg.bad"), true); return; }
      var bytes = new Uint8Array(r.bin);
      return S.sha256(bytes).then(function (h) {
        if (h !== rq.h) { state(t("sg.changed"), true); return; }
        req = rq; pdf = bytes; expires = r.x; opened = Date.now();
        rbox = S.cleanBox(e.d.bx, "w");
        show();
      });
    }).catch(function () { state(t("sg.crypto"), true); });
  }
  function askCode(wrong) {
    var card = $("card");
    card.textContent = "";
    card.appendChild(el("h1", "", t("sg.codeH")));
    card.appendChild(el("p", "meta", t("sg.codeText")));
    var form = el("form", "pass");
    var lab = el("label", "sg-field");
    lab.appendChild(el("span", "", t("sg.code")));
    var inp = el("input");
    inp.type = "password"; inp.autocomplete = "one-time-code"; inp.required = true; inp.maxLength = 200;
    lab.appendChild(inp);
    form.appendChild(lab);
    var msg = el("p", "sg-msg err", wrong ? t("sg.wrongCode") : "");
    msg.hidden = !wrong;
    form.appendChild(msg);
    var acts = el("div", "acts"), go = el("button", "prim", t("sg.open"));
    go.type = "submit";
    acts.appendChild(go);
    form.appendChild(acts);
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (!inp.value) return;
      password = inp.value;
      open();
    });
    card.appendChild(form);
    inp.focus();
  }

  // ---------- the document ----------
  function show() {
    var card = $("card");
    card.textContent = "";
    card.appendChild(el("p", "kind", t("sg.kind")));
    card.appendChild(el("h1", "", req.n));
    var dl = el("dl", "fields");
    function row(k, v) { if (!v) return; dl.appendChild(el("dt", "", k)); dl.appendChild(el("dd", "pre", v)); }
    row(t("sg.from"), req.by + (req.be ? " <" + req.be + ">" : ""));
    row(t("sg.for"), req.to);
    row(t("sg.until"), expires ? fmtDay(expires) : "");
    row(t("sg.pages"), String(req.pages));
    row(t("sg.message"), req.msg || "");
    card.appendChild(dl);
    card.appendChild(el("p", "hint", t("sg.howTo")));
    req.fields.forEach(function (f) { if (f.k === "date") vals[f.id] = today(); if (f.k === "name") vals[f.id] = req.to; });
    renderPages();
    renderFinish();
  }

  var pdfjsP = null;
  function pdfjs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (pdfjsP) return pdfjsP;
    pdfjsP = new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.type = "module"; s.src = "../vendor/pdfjs/pdf.min.js";
      s.onload = function () {
        if (window.pdfjsLib) { window.pdfjsLib.GlobalWorkerOptions.workerSrc = "../vendor/pdfjs/pdf.worker.min.js"; res(window.pdfjsLib); }
        else rej(new Error("pdfjs"));
      };
      s.onerror = function () { pdfjsP = null; rej(new Error("pdfjs")); };
      document.head.appendChild(s);
    });
    return pdfjsP;
  }
  function renderPages() {
    var box = $("pages");
    box.textContent = "";
    box.hidden = false;
    var byPage = {};
    req.fields.forEach(function (f) { (byPage[f.pg] = byPage[f.pg] || []).push(f); });
    var holders = [];
    for (var i = 0; i < req.pages; i++) {
      var pg = el("div", "sg-page");
      pg.setAttribute("aria-label", t("sg.page", { n: i + 1, total: req.pages }));
      pg.setAttribute("role", "group");
      var cv = el("canvas");
      cv.setAttribute("aria-hidden", "true");
      pg.appendChild(cv);
      pg.appendChild(el("span", "sg-pload", t("sg.pageLoading", { n: i + 1 })));
      var layer = el("div", "sg-layer");
      (byPage[i] || []).forEach(function (f) { layer.appendChild(fieldEl(f)); });
      pg.appendChild(layer);
      box.appendChild(pg);
      holders.push(pg);
    }
    pdfjs().then(function (lib) {
      return lib.getDocument({ data: pdf.slice(), isEvalSupported: false, enableXfa: false, disableAutoFetch: true,
                                disableStream: true, stopAtErrors: false }).promise;
    }).then(function (doc) {
      var chain = Promise.resolve();
      holders.forEach(function (pg, i) {
        chain = chain.then(function () { return doc.getPage(i + 1); }).then(function (p) {
          var v1 = p.getViewport({ scale: 1 });
          pg.style.aspectRatio = v1.width + " / " + v1.height;
          var w = Math.max(320, pg.clientWidth || 640), dpr = Math.min(2, window.devicePixelRatio || 1);
          var vp = p.getViewport({ scale: (w * dpr) / v1.width });
          var cv = pg.querySelector("canvas");
          cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
          var ctx = cv.getContext("2d");
          ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
          return p.render({ canvasContext: ctx, viewport: vp }).promise.then(function () {
            var l = pg.querySelector(".sg-pload");
            if (l) l.remove();
          });
        });
      });
      return chain;
    }).catch(function () {
      [].forEach.call(box.querySelectorAll(".sg-pload"), function (n) { n.textContent = t("sg.buildFail"); });
    });
  }
  function fieldEl(f) {
    var b = el("button", "sg-f sg-f-" + f.k);
    b.type = "button";
    b.style.left = ((f.fx - f.w / 2) * 100) + "%";
    b.style.top = ((f.fy - f.h / 2) * 100) + "%";
    b.style.width = (f.w * 100) + "%";
    b.style.height = (f.h * 100) + "%";
    b.addEventListener("click", function () { fill(f); });
    fieldEls[f.id] = b;
    paint(f);
    return b;
  }
  function paint(f) {
    var b = fieldEls[f.id];
    if (!b) return;
    b.textContent = "";
    var v = vals[f.id], has = v !== undefined && S.cleanValue(f, v) !== null;
    b.classList.toggle("on", has);
    b.setAttribute("aria-label", t(has ? "sg.filled" : "sg.empty1", { label: label(f) }) + (f.req ? " " + t("sg.req") : ""));
    if (!has) { b.appendChild(el("span", "sg-ph", label(f) + (f.req ? " " + t("sg.req") : ""))); return; }
    if (f.k === "sig" || f.k === "init") {
      var im = el("img");
      im.src = v.src; im.alt = ""; im.draggable = false;
      b.appendChild(im);
    } else if (f.k === "check") {
      b.appendChild(el("span", "sg-tick", "✓"));
    } else {
      var s = el("span", "sg-val", v);
      b.appendChild(s);
    }
  }
  function fill(f) {
    if (signedBlob) return;
    if (f.k === "check") { if (vals[f.id] === true) delete vals[f.id]; else vals[f.id] = true; paint(f); return; }
    if (f.k === "sig" || f.k === "init") { openPad(f.k); return; }
    textDialog(f);
  }
  function textDialog(f) {
    var v = vals[f.id];
    var ans = window.prompt(t("sg.textH") + ": " + label(f), typeof v === "string" ? v : "");
    if (ans === null) return;
    ans = ans.trim();
    if (ans) vals[f.id] = ans.slice(0, f.k === "date" ? 40 : 200); else delete vals[f.id];
    paint(f);
  }

  // ---------- signature pad ----------
  var pad = { kind: "sig", mode: "draw", strokes: [], cur: null };
  function openPad(kind) {
    pad.kind = kind; pad.strokes = []; pad.cur = null;
    $("pad-title").textContent = t(kind === "init" ? "sg.padInit" : "sg.padSig");
    $("pad-name").value = kind === "init" ? initials(nameNow()) : nameNow();
    padMode("draw");
    $("pad-msg").hidden = true;
    $("pad-veil").hidden = false;
    drawPad();
    setTimeout(function () { $("pad-draw").focus(); }, 0);
  }
  function closePad() { $("pad-veil").hidden = true; }
  function nameNow() { var n = $("sg-name"); return n && n.value.trim() ? n.value.trim() : req.to; }
  function initials(n) {
    return n.split(/\s+/).filter(Boolean).map(function (w) { return w.charAt(0).toUpperCase() + "."; }).join(" ").slice(0, 12);
  }
  function padMode(m) {
    pad.mode = m;
    $("pad-draw").setAttribute("aria-selected", m === "draw" ? "true" : "false");
    $("pad-type").setAttribute("aria-selected", m === "type" ? "true" : "false");
    $("pad-drawbox").hidden = m !== "draw";
    $("pad-typebox").hidden = m !== "type";
    $("pad-clear").hidden = m !== "draw";
    $("pad-preview").textContent = $("pad-name").value;
    if (m === "type") $("pad-name").focus();
  }
  function drawPad() {
    var cv = $("pad-canvas"), ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.strokeStyle = "#c8c2b3"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(30, cv.height - 40); ctx.lineTo(cv.width - 30, cv.height - 40); ctx.stroke();
    ctx.strokeStyle = "#121217"; ctx.lineWidth = 4; ctx.lineCap = "round"; ctx.lineJoin = "round";
    pad.strokes.forEach(function (st) {
      ctx.beginPath();
      st.forEach(function (p, i) { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); });
      if (st.length === 1) ctx.lineTo(st[0][0] + 0.1, st[0][1]);
      ctx.stroke();
    });
  }
  function padPoint(e) {
    var cv = $("pad-canvas"), r = cv.getBoundingClientRect();
    return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height];
  }
  function wirePad() {
    var cv = $("pad-canvas");
    cv.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      pad.cur = [padPoint(e)];
      pad.strokes.push(pad.cur);
      try { cv.setPointerCapture(e.pointerId); } catch (x) {}
      drawPad();
    });
    cv.addEventListener("pointermove", function (e) {
      if (!pad.cur) return;
      e.preventDefault();
      if (pad.cur.length < 2000) pad.cur.push(padPoint(e));
      drawPad();
    });
    function up() { pad.cur = null; }
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", up);
    $("pad-draw").addEventListener("click", function () { padMode("draw"); });
    $("pad-type").addEventListener("click", function () { padMode("type"); });
    $("pad-name").addEventListener("input", function () { $("pad-preview").textContent = $("pad-name").value; });
    $("pad-clear").addEventListener("click", function () { pad.strokes = []; drawPad(); });
    $("pad-cancel").addEventListener("click", closePad);
    $("pad-ok").addEventListener("click", padDone);
    $("pad-veil").addEventListener("keydown", function (e) { if (e.key === "Escape") { e.preventDefault(); closePad(); } });
  }
  // The signature as a PNG with a see-through background, cropped.
  function padDone() {
    var out = pad.mode === "draw" ? drawnPng() : typedPng($("pad-name").value.trim());
    if (!out) { $("pad-msg").textContent = t("sg.padEmpty"); $("pad-msg").hidden = false; return; }
    sigs[pad.kind] = out;
    req.fields.forEach(function (f) { if (f.k === pad.kind) { vals[f.id] = out; paint(f); } });
    closePad();
  }
  function drawnPng() {
    var pts = [].concat.apply([], pad.strokes);
    if (!pts.length) return null;
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    pts.forEach(function (p) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); });
    var pad0 = 8, w = Math.ceil(x1 - x0 + pad0 * 2), h = Math.ceil(y1 - y0 + pad0 * 2);
    var cv = document.createElement("canvas");
    cv.width = Math.max(8, w); cv.height = Math.max(8, h);
    var ctx = cv.getContext("2d");
    ctx.strokeStyle = "#121217"; ctx.lineWidth = 4; ctx.lineCap = "round"; ctx.lineJoin = "round";
    pad.strokes.forEach(function (st) {
      ctx.beginPath();
      st.forEach(function (p, i) { var x = p[0] - x0 + pad0, y = p[1] - y0 + pad0; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      if (st.length === 1) ctx.lineTo(st[0][0] - x0 + pad0 + 0.1, st[0][1] - y0 + pad0);
      ctx.stroke();
    });
    return { src: cv.toDataURL("image/png"), w: cv.width, h: cv.height };
  }
  function typedPng(text) {
    if (!text) return null;
    var cv = document.createElement("canvas"), ctx = cv.getContext("2d"), size = 72;
    var font = "italic " + size + "px \"ScanPdfSig\", \"Noto Serif\", serif";
    ctx.font = font;
    var w = Math.ceil(ctx.measureText(text).width) + 24;
    cv.width = Math.min(1600, Math.max(40, w)); cv.height = Math.round(size * 1.5);
    ctx = cv.getContext("2d");
    ctx.font = font;
    ctx.fillStyle = "#121217";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 12, cv.height / 2);
    return { src: cv.toDataURL("image/png"), w: cv.width, h: cv.height };
  }

  // ---------- signing ----------
  function renderFinish() {
    var box = $("finish");
    box.textContent = "";
    box.hidden = false;
    box.appendChild(el("h2", "", t("sg.finishH")));
    var lab = el("label", "sg-field");
    lab.appendChild(el("span", "", t("sg.yourName")));
    var nm = el("input");
    nm.id = "sg-name"; nm.type = "text"; nm.autocomplete = "name"; nm.maxLength = 120; nm.value = req.to;
    lab.appendChild(nm);
    box.appendChild(lab);
    var ck = el("label", "sg-check"), cb = el("input");
    cb.type = "checkbox"; cb.id = "sg-consent";
    cb.addEventListener("change", function () { consented = cb.checked ? Date.now() : 0; });
    ck.appendChild(cb);
    ck.appendChild(el("span", "", t("sg.consent")));
    box.appendChild(ck);
    box.appendChild(el("p", "hint small", t("sg.records")));
    var msg = el("p", "sg-msg err");
    msg.id = "sg-err"; msg.hidden = true;
    box.appendChild(msg);
    var acts = el("div", "acts");
    acts.appendChild(btn(t("sg.sign"), "prim", sign));
    acts.appendChild(btn(t("sg.decline"), "", declineForm));
    box.appendChild(acts);
    box.appendChild(el("p", "hint small", t("sg.legal")));
  }
  function err(m) { var e = $("sg-err"); e.textContent = m; e.hidden = !m; }
  function sign() {
    var nm = $("sg-name").value.trim();
    if (!nm) { err(t("sg.needName")); $("sg-name").focus(); return; }
    var miss = S.missing(req, vals);
    if (miss.length) {
      var names = req.fields.filter(function (f) { return miss.indexOf(f.id) >= 0; }).map(function (f) {
        return label(f) + " (" + t("sg.page", { n: f.pg + 1, total: req.pages }) + ")";
      });
      err(t("sg.need", { list: names.join(", ") }));
      var first = fieldEls[miss[0]];
      if (first) { first.scrollIntoView({ block: "center", behavior: "smooth" }); first.focus({ preventScroll: true }); }
      return;
    }
    if (!consented) { err(t("sg.needConsent")); $("sg-consent").focus(); return; }
    err("");
    var reply = S.cleanReply({ v: 1, rq: rid, h: req.h, st: "signed", nm: nm, vals: vals, op: opened, ca: consented,
                               at: Date.now(), tz: tz(), ua: ua(), lang: LANG }, req);
    if (!reply) { err(t("sg.buildFail")); return; }
    busy(t("sg.making"));
    makeSigned(reply).then(function (blob) {
      signedBlob = blob;
      download();
      lockFields();
      send(reply);
    }, function () { busy(""); err(t("sg.buildFail")); });
  }
  function tz() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) { return ""; } }
  // The browser and system names only (never the full user agent).
  function ua() {
    var u = String(navigator.userAgent || ""), b = "", o = "";
    var m = /(Edg|OPR|Firefox|Chrome|Version)\/(\d+)/.exec(u);
    if (m) b = (m[1] === "Edg" ? "Edge" : m[1] === "OPR" ? "Opera" : m[1] === "Version" ? "Safari" : m[1]) + " " + m[2];
    o = /Android/.test(u) ? "Android" : /iPhone|iPad/.test(u) ? "iOS" : /Windows/.test(u) ? "Windows" : /Mac OS X/.test(u) ? "macOS" :
        /CrOS/.test(u) ? "ChromeOS" : /Linux/.test(u) ? "Linux" : "";
    return [b, o].filter(Boolean).join(" · ");
  }
  var fontP = null;
  function loadFont() {
    if (!fontP) {
      var kit = window.fontkit ? Promise.resolve() : new Promise(function (res, rej) {
        var s = document.createElement("script");
        s.src = "../vendor/pdf-lib/fontkit.umd.min.js"; s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
      });
      var bytes = fetch("../vendor/noto/NotoSans-Regular.ttf").then(function (r) { if (!r.ok) throw new Error("font"); return r.arrayBuffer(); });
      fontP = Promise.all([kit, bytes]).then(function (a) { return { fontkit: window.fontkit, bytes: new Uint8Array(a[1]) }; });
      fontP.catch(function () { fontP = null; });
    }
    return fontP;
  }
  function makeSigned(reply) {
    var lib = window.PDFLib;
    return Promise.all([loadFont(), OPS.load(lib, pdf), S.record(rid, req, reply, {})]).then(function (a) {
      var font = a[0], loaded = a[1], out = a[2];
      if (loaded.err) throw new Error(loaded.err);
      var items = S.stampItems(req, reply, OPS.pageGeoms(lib, loaded.doc));
      return OPS.stamp(lib, pdf, items, { font: font, cert: S.cert(out),
        attach: { name: "signing-record.json", bytes: new TextEncoder().encode(out.json), at: reply.at,
                  description: "orOS signing record" } });
    }).then(function (bytes) { return new Blob([bytes], { type: "application/pdf" }); });
  }
  function download() {
    if (!signedBlob) return;
    var a = document.createElement("a"), url = URL.createObjectURL(signedBlob);
    a.href = url;
    a.download = t("sg.fileName", { n: C.cleanName(req.n) || "Document" });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }
  function lockFields() {
    Object.keys(fieldEls).forEach(function (id) { fieldEls[id].disabled = true; });
  }
  function busy(text) {
    var b = document.querySelector(".sg-busy");
    if (!text) { if (b) b.remove(); return; }
    if (!b) { b = el("div", "sg-busy"); b.setAttribute("role", "status"); document.body.appendChild(b); }
    b.textContent = text;
  }
  // The answer goes into the sender's reply box when the request has
  // one (it comes back to them on its own); else, or when that fails
  // (too big for the box, the box gone), as a link to send back.
  function send(reply) {
    busy(t("sg.sending"));
    if (!rbox || !R.putBox) { sendLink(reply); return; }
    var env = { v: 1, k: "signed", d: reply };
    R.putBox({ id: rbox.id, key: rbox.k, wt: rbox.w }, env, { exp: Date.now() + 30 * 86400000 }).then(function () {
      busy("");
      done(reply, "");
    }, function (e) {
      if (e && e.message === "net") { sendFailed(reply); return; }
      rbox = null;
      sendLink(reply);
    });
  }
  function sendFailed(reply) {
    busy("");
    var box = $("finish");
    box.textContent = "";
    box.appendChild(el("p", "sg-msg err", t("sg.sendFail")));
    var acts = el("div", "acts");
    acts.appendChild(btn(t("sg.sendAgain"), "prim", function () { send(reply); }));
    if (signedBlob) acts.appendChild(btn(t("sg.download"), "", download));
    box.appendChild(acts);
  }
  function sendLink(reply) {
    busy(t("sg.sending"));
    R.create({ v: 1, k: "signed", d: reply }, { days: 30 }).then(function (r) {
      busy("");
      done(reply, S.replyLink(location.origin, r.code));
    }, function () { sendFailed(reply); });
  }
  function declineForm() {
    var box = $("finish");
    box.textContent = "";
    box.appendChild(el("h2", "", t("sg.declineH")));
    var lab = el("label", "sg-field");
    lab.appendChild(el("span", "", t("sg.why")));
    var ta = el("textarea");
    ta.rows = 3; ta.maxLength = 500;
    lab.appendChild(ta);
    box.appendChild(lab);
    var acts = el("div", "acts");
    acts.appendChild(btn(t("sg.declineGo"), "prim", function () {
      var reply = S.cleanReply({ v: 1, rq: rid, h: req.h, st: "declined", why: ta.value, nm: nameNow(), at: Date.now(),
                                 op: opened, tz: tz(), ua: ua(), lang: LANG }, req);
      if (!reply) return;
      lockFields();
      signedBlob = null;
      send(reply);
    }));
    acts.appendChild(btn(t("sg.cancel"), "", renderFinish));
    box.appendChild(acts);
    ta.focus();
  }
  function done(reply, link) {
    var box = $("finish"), f = req.by, signedOk = reply.st === "signed";
    box.textContent = "";
    box.classList.add("sg-done");
    box.appendChild(el("h2", "", t(signedOk ? "sg.doneH" : "sg.declinedH")));
    if (!link) {                                     // it went into the reply box
      box.appendChild(el("p", "", t(signedOk ? "sg.doneAuto" : "sg.declinedAuto", { f: f })));
      if (signedOk) { var only = el("div", "acts"); only.appendChild(btn(t("sg.download"), "prim", download)); box.appendChild(only); }
      box.appendChild(el("p", "hint small", t("sg.autoNote", { f: f })));
      box.scrollIntoView({ block: "start", behavior: "smooth" });
      return;
    }
    box.appendChild(el("p", "", t(signedOk ? "sg.doneText" : "sg.declinedText", { f: f })));
    var lab = el("label", "sg-field");
    lab.appendChild(el("span", "", t("sg.answer")));
    var out = el("textarea", "sg-answer");
    out.readOnly = true; out.rows = 3; out.value = link;
    lab.appendChild(out);
    box.appendChild(lab);
    var acts = el("div", "acts");
    acts.appendChild(btn(t("sg.copy"), "prim", function () {
      var ok = function () { toast(t("sg.copied")); };
      var fail = function () { out.select(); try { if (document.execCommand("copy")) { ok(); return; } } catch (e) {} toast(t("sg.copyFail")); };
      try { navigator.clipboard.writeText(link).then(ok, fail); } catch (e) { fail(); }
    }));
    var subj = t(signedOk ? "sg.mailSubject" : "sg.mailSubjectNo", { n: req.n });
    if (typeof navigator.share === "function") {
      acts.appendChild(btn(t("sg.share"), "", function () { navigator.share({ title: subj, text: subj, url: link }).catch(function () {}); }));
    }
    var mail = el("a", "btn", t("sg.email", { f: f }));
    mail.href = "mailto:" + encodeURIComponent(req.be || "") + "?subject=" + encodeURIComponent(subj) +
      "&body=" + encodeURIComponent(t(signedOk ? "sg.mailBody" : "sg.mailBodyNo", { n: req.n, l: link, name: reply.nm || "" }));
    acts.appendChild(mail);
    if (signedOk) acts.appendChild(btn(t("sg.download"), "", download));
    box.appendChild(acts);
    box.appendChild(el("p", "hint small", t("sg.answerNote", { f: f })));
    box.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  // ---------- boot ----------
  function boot() {
    document.documentElement.lang = LANG;
    applyTheme();
    watchTheme();
    $("top-sub").textContent = t("sg.sub");
    $("privacy").textContent = t("sg.privacy");
    $("what").textContent = t("sg.what");
    $("pad-draw").textContent = t("sg.draw");
    $("pad-type").textContent = t("sg.type");
    $("pad-hint").textContent = t("sg.drawHint");
    $("pad-clear").textContent = t("sg.clear");
    $("pad-cancel").textContent = t("sg.cancel");
    $("pad-ok").textContent = t("sg.use");
    $("pad-name").setAttribute("aria-label", t("sg.yourName"));
    $("pad-canvas").setAttribute("aria-label", t("sg.drawHint"));
    wirePad();
    code = S.requestCode(location.hash);
    var c = code && R.parse(code);
    if (!c) { state(t("sg.empty"), true); return; }
    rid = c.id;
    if (!window.crypto || !window.crypto.subtle || !window.PDFLib) { state(t("sg.crypto"), true); return; }
    if (c.kind === "q1") askCode(false); else open();
  }
  boot();
})();
