// ============================================================
// orOS Forms — the public fill-in page (forms/f/, FORMS-2)
// Opens https://useoros.online/forms/f/#<k>.<key>: fetches the form
// from the relay (relay/forms.js GET /fm/<k>), opens it with the key
// from the #fragment (never sent anywhere), draws it with render.js,
// seals the answers for the form's own key (pub.js) and sends them.
// Shown from the form: text only (render.js uses textContent). Fixed
// warning on top (never enter passwords or card numbers), no password
// fields exist (engine.js has no such type), the "after sending" page
// is a visible link, never a redirect. "One answer per browser" is a
// note in this browser's storage (oros-forms-sent), nothing more.
// ============================================================
(function () {
  "use strict";
  var E = window.OrosFormsEngine, R = window.OrosFormsRender, P = window.OrosFormsPub;
  var SENT_KEY = "oros-forms-sent";

  var STRINGS = {
    en: {
      "p.sub": "Forms", "p.loading": "Opening the form…",
      "p.privacy": "Your answers are encrypted in this browser. Only the person who made the form can read them.",
      "p.what": "What is orOS?", "p.report": "Report this form",
      "p.reportAsk": "Is this form trying to get passwords, card numbers or money, or is it abusive? Reporting is anonymous. A form several people report is closed.",
      "p.reportGo": "Report", "p.reported": "Thank you. The report was sent.",
      "p.noLink": "This link is incomplete. Ask the person who sent it for the whole link.",
      "p.gone": "This form isn't available any more.",
      "p.bad": "This form can't be opened. The link may be incomplete or changed.",
      "p.off": "The form can't be reached right now. Please try again later.",
      "p.busy": "Too many requests. Please wait a minute and try again.",
      "p.closed": "This form is closed and doesn't take answers any more.",
      "p.once": "You have already answered this form in this browser.",
      "p.back": "Continue", "p.wait": "The places are full: you are on the waiting list.",
      "p.retry": "Try again"
    },
    el: {
      "p.sub": "Φόρμες", "p.loading": "Άνοιγμα της φόρμας…",
      "p.privacy": "Οι απαντήσεις σας κρυπτογραφούνται σε αυτόν τον browser. Μόνο όποιος έφτιαξε τη φόρμα μπορεί να τις διαβάσει.",
      "p.what": "Τι είναι το orOS;", "p.report": "Αναφορά της φόρμας",
      "p.reportAsk": "Προσπαθεί αυτή η φόρμα να πάρει κωδικούς, αριθμούς καρτών ή χρήματα, ή είναι καταχρηστική; Η αναφορά είναι ανώνυμη. Μια φόρμα που αναφέρουν αρκετοί κλείνει.",
      "p.reportGo": "Αναφορά", "p.reported": "Ευχαριστούμε. Η αναφορά στάλθηκε.",
      "p.noLink": "Ο σύνδεσμος είναι ελλιπής. Ζητήστε ολόκληρο τον σύνδεσμο από όποιον σας τον έστειλε.",
      "p.gone": "Αυτή η φόρμα δεν είναι πια διαθέσιμη.",
      "p.bad": "Η φόρμα δεν μπορεί να ανοίξει. Ο σύνδεσμος ίσως είναι ελλιπής ή αλλαγμένος.",
      "p.off": "Η φόρμα δεν είναι προσβάσιμη αυτή τη στιγμή. Δοκιμάστε ξανά αργότερα.",
      "p.busy": "Πάρα πολλά αιτήματα. Περιμένετε ένα λεπτό και δοκιμάστε ξανά.",
      "p.closed": "Η φόρμα έκλεισε και δεν δέχεται πια απαντήσεις.",
      "p.once": "Έχετε ήδη απαντήσει σε αυτή τη φόρμα από αυτόν τον browser.",
      "p.back": "Συνέχεια", "p.wait": "Οι θέσεις γέμισαν: είστε στη λίστα αναμονής.",
      "p.retry": "Δοκιμάστε ξανά"
    }
  };
  // The page's buttons speak the form's language when the form says it
  // (obj.l), else this browser's.
  function browserLang() {
    try { var s = localStorage.getItem("oros-lang"); if (s === "el" || s === "en" || s === "de") return s; } catch (e) {}
    var n = String(navigator.language || "");
    return /^el\b/i.test(n) ? "el" : (/^de\b/i.test(n) ? "de" : "en");
  }
  var LANG = "en", TBL = STRINGS.en;
  function setLang(l, done) {
    var I = window.orosI18n;
    var go = function () {
      Object.keys(R.STRINGS).forEach(function (code) {
        Object.keys(R.STRINGS[code]).forEach(function (k) { if (STRINGS[code] && STRINGS[code][k] === undefined) STRINGS[code][k] = R.STRINGS[code][k]; });
      });
      LANG = l === "el" || l === "de" ? l : "en";
      TBL = I ? I.table(STRINGS, "forms", LANG) : (STRINGS[LANG] || STRINGS.en);
      document.documentElement.lang = LANG;
      [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) { n.textContent = t(n.getAttribute("data-i18n")); });
      done();
    };
    if (I && l === "de" && typeof I.ensure === "function") I.ensure("de", "forms", go); else go();
  }
  function t(k, v) {
    var s = TBL[k] !== undefined ? TBL[k] : (STRINGS.en[k] !== undefined ? STRINGS.en[k] : k);
    if (v) Object.keys(v).forEach(function (n) { s = s.split("{" + n + "}").join(String(v[n])); });
    return s;
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function $(id) { return document.getElementById(id); }

  // Colours: the orOS default skin, light or dark like the device.
  try {
    if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) document.documentElement.setAttribute("data-theme", "light");
  } catch (e) {}

  function sentMap() {
    try { var m = JSON.parse(localStorage.getItem(SENT_KEY) || "null"); return m && typeof m === "object" && !Array.isArray(m) ? m : {}; } catch (e) { return {}; }
  }
  function markSent(k) {
    var m = sentMap();
    m[k] = Date.now();
    var keys = Object.keys(m).sort(function (a, b) { return m[b] - m[a]; });
    keys.slice(200).forEach(function (x) { delete m[x]; });       // a short memory
    try { localStorage.setItem(SENT_KEY, JSON.stringify(m)); } catch (e) {}
  }

  function message(text, title, retry) {
    var host = $("form");
    host.textContent = "";
    var card = el("div", "ff-card");
    if (title) card.appendChild(el("h2", "ff-title", title));
    card.appendChild(el("p", "ff-text", text));
    if (retry) {
      var b = el("button", "ff-btn", t("p.retry"));
      b.type = "button";
      b.addEventListener("click", start);
      card.appendChild(b);
    }
    host.appendChild(card);
  }

  var link = P.parse(location.hash);
  P.banner($("warn"), browserLang() === "de" ? "de" : (browserLang() === "el" ? "el" : "en"));

  function start() {
    if (!link) { setLang(browserLang(), function () { message(t("p.noLink")); }); return; }
    $("form").textContent = "";
    $("form").appendChild(el("p", "ff-dim", t("p.loading")));
    P.fetchDef(link.k, link.key).then(function (res) {
      var obj = res.obj;
      if (obj.v !== 1 || !obj.form || !obj.pub || typeof obj.pub.n !== "string") throw { code: "bad" };
      var form = E.normForm(obj.form);
      setLang(typeof obj.l === "string" ? obj.l : browserLang(), function () { show(form, obj, res); });
    })["catch"](function (e) {
      var c = e && e.code;
      setLang(browserLang(), function () {
        if (c === "gone") message(t("p.gone"));
        else if (c === "bad") message(t("p.bad"));
        else if (c === "busy") message(t("p.busy"), null, true);
        else message(t("p.off"), null, true);
      });
    });
  }

  function show(form, obj, res) {
    document.title = (form.title || t("f.untitled")) + " · orOS";
    // the warning in the form's language too
    $("warn").textContent = "";
    P.banner($("warn"), LANG);
    if (!res.open) { message(t("p.closed"), form.title || t("f.untitled")); return; }
    if (form.set.once && sentMap()[link.k]) { message(t("p.once"), form.title || t("f.untitled")); return; }
    var host = $("form");
    host.textContent = "";
    R.mount(host, form, {
      t: t,
      send: function (answers) {
        return P.send(link.k, obj.pub, { a: answers, t: Date.now(), l: LANG }, { hp: $("hp-in").value }).then(function (r) {
          markSent(link.k);
          return r;
        });
      },
      after: function (card, r) {
        if (r && r.wait) card.appendChild(el("p", "ff-note", t("p.wait")));
        if (form.set.back && E.validBack(form.set.back)) {
          var a = el("a", "ff-btn pri", t("p.back"));
          a.href = form.set.back;
          a.rel = "noopener noreferrer nofollow";
          a.target = "_top";
          var p = el("p", "ff-backline");
          p.appendChild(a);
          card.appendChild(p);
          card.appendChild(el("p", "ff-dim ff-host", hostOf(form.set.back)));
        }
      }
    });
  }
  function hostOf(u) { try { return new URL(u).host; } catch (e) { return ""; } }

  // ---------- reporting ----------
  $("report-btn").addEventListener("click", function () { $("report").hidden = !$("report").hidden; });
  $("report-go").addEventListener("click", function () {
    var go = $("report-go");
    if (!link) return;
    go.disabled = true;
    P.report(link.k).then(done, done);
    function done() {
      var box = $("report");
      box.textContent = "";
      box.appendChild(el("p", "", t("p.reported")));
    }
  });

  setLang(browserLang(), start);
  window.addEventListener("hashchange", function () { link = P.parse(location.hash); start(); });
})();
