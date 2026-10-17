// ============================================================
// orOS "Send to someone" — share/view.js (the receiving page)
// Opens the item inside the link (#1.… / #p1.…, see kinds.js), or
// fetches and decrypts a link with an expiry (#r1.… / #q1.…, see
// relay.js: only ciphertext comes from the relay), and shows it. Works without orOS (copy, download); with orOS in this
// browser "Add to my orOS" hands the item to the right app.
// Hostile input: kinds.js normalizes everything, and this file only
// ever writes text (textContent) and links it checked itself.
// ============================================================
(function () {
  "use strict";

  var K = window.OrosShareKinds;
  var R = window.OrosShareRelay || null;
  var M = window.OrosMealsCore || null;
  var $ = function (id) { return document.getElementById(id); };

  var STR = {
    en: {
      "top.sub": "Shared with you", "state.loading": "Opening…",
      "foot.privacy": "This page opened what is inside the link, right here in your browser. Nothing was sent to a server.",
      "foot.what": "What is orOS?",
      empty: "This page opens things people send with orOS. The link you opened has nothing in it, or it was cut short.",
      emptyFile: "Got it as a file? Open it here.",
      bad: "This link is damaged or incomplete. Ask for it again, or for the file.",
      big: "This is too big to open.",
      crypto: "This browser cannot open locked links.",
      lockedMsg: "This is locked with a password.", pass: "Password", unlock: "Open", wrong: "Wrong password.",
      add: "Add to my orOS", copyText: "Copy text", download: "Download", openFile: "Open a file",
      "addHint.list": "Opens To-Do with the items ready to add.", "addHint.note": "Makes a new page in Notes.",
      "addHint.contact": "Opens Contacts and asks before saving.", "addHint.event": "Opens Calendar and asks before saving.",
      "addHint.recipe": "Opens the Meal Planner with the recipe ready to save.", "addHint.links": "Opens Bookmarks.",
      "addHint.wiki": "Opens Wiki with the article ready to save.",
      "addHint.cal": "Opens Calendar, shows how many events are new and asks before saving.",
      "dl.contact": "Download (.vcf)", "dl.event": "Add to calendar (.ics)", "dl.links": "Download (.html)", "dl.wiki": "Download (.md)",
      "dl.cal": "Add to calendar (.ics)",
      calMonth: "Month", calList: "List", calPrev: "Previous month", calNext: "Next month",
      calNoneDay: "Nothing on this day.", calNoneMonth: "Nothing this month.",
      calZone: "Times are in your time zone ({z}).", calAllDay: "all day",
      alHint: "Tap a photo to see it large and save it.", alSave: "Save photo", alClose: "Close",
      alPrev: "Previous photo", alNext: "Next photo", alOf: "{i} of {n}", alBad: "{n} photos could not be shown.",
      copiedShort: "Copied", copyFailShort: "Could not copy",
      tickHint: "Ticks here are only for you and are not saved.",
      phone: "Phone", email: "Email", address: "Address", web: "Website", im: "Chat",
      noFile: "No orOS link in that file.",
      slPick: "Pick a time that suits you.", slNone: "None of these times is still ahead. Ask for new ones.",
      slZone: "Times are in your time zone ({z}).", slPicked: "You picked",
      slMail: "Email {n} to confirm", slMailAnon: "Email to confirm", slNoMail: "No email address came with these times: let the sender know another way.",
      slIcs: "Add to calendar (.ics)", slOros: "Add to my orOS", slOther: "Pick another time",
      slHint: "Nothing is booked until the sender gets your answer.",
      gone: "This link has expired or the sender took it back.",
      net: "Could not reach the orOS server. Check your connection and try again.", retry: "Try again",
      availUntil: "Available until {d}", refs: "References", docTitle: "orOS · Shared with you",
      privRelay: "This came encrypted from the orOS server and was opened here with the key in the link. The server cannot see what is inside."
    },
    el: {
      "top.sub": "Σου το έστειλαν", "state.loading": "Άνοιγμα…",
      "foot.privacy": "Η σελίδα άνοιξε ό,τι έχει μέσα ο σύνδεσμος, εδώ, στον browser σου. Τίποτα δεν στάλθηκε σε server.",
      "foot.what": "Τι είναι το orOS;",
      empty: "Εδώ ανοίγουν όσα στέλνει κανείς με το orOS. Ο σύνδεσμος που άνοιξες δεν έχει τίποτα μέσα ή κόπηκε.",
      emptyFile: "Το έλαβες ως αρχείο; Άνοιξέ το εδώ.",
      bad: "Ο σύνδεσμος είναι χαλασμένος ή κομμένος. Ζήτα τον ξανά ή ζήτα το αρχείο.",
      big: "Είναι πολύ μεγάλο για να ανοίξει.",
      crypto: "Αυτός ο browser δεν ανοίγει κλειδωμένους συνδέσμους.",
      lockedMsg: "Είναι κλειδωμένο με κωδικό.", pass: "Κωδικός", unlock: "Άνοιγμα", wrong: "Λάθος κωδικός.",
      add: "Πρόσθεσέ το στο orOS μου", copyText: "Αντιγραφή κειμένου", download: "Λήψη", openFile: "Άνοιγμα αρχείου",
      "addHint.list": "Ανοίγει το To-Do με τα είδη έτοιμα για προσθήκη.", "addHint.note": "Φτιάχνει νέα σελίδα στις Σημειώσεις.",
      "addHint.contact": "Ανοίγει τις Επαφές και ρωτά πριν αποθηκεύσει.", "addHint.event": "Ανοίγει το Ημερολόγιο και ρωτά πριν αποθηκεύσει.",
      "addHint.recipe": "Ανοίγει το Πλάνο γευμάτων με τη συνταγή έτοιμη για αποθήκευση.", "addHint.links": "Ανοίγει τους Σελιδοδείκτες.",
      "addHint.wiki": "Ανοίγει το Wiki με το άρθρο έτοιμο για αποθήκευση.",
      "addHint.cal": "Ανοίγει το Ημερολόγιο, δείχνει πόσα γεγονότα είναι καινούργια και ρωτά πριν αποθηκεύσει.",
      "dl.contact": "Λήψη (.vcf)", "dl.event": "Προσθήκη σε ημερολόγιο (.ics)", "dl.links": "Λήψη (.html)", "dl.wiki": "Λήψη (.md)",
      "dl.cal": "Προσθήκη σε ημερολόγιο (.ics)",
      calMonth: "Μήνας", calList: "Λίστα", calPrev: "Προηγούμενος μήνας", calNext: "Επόμενος μήνας",
      calNoneDay: "Τίποτα αυτή τη μέρα.", calNoneMonth: "Τίποτα αυτόν τον μήνα.",
      calZone: "Οι ώρες είναι στη ζώνη ώρας σου ({z}).", calAllDay: "όλη μέρα",
      alHint: "Πάτα μια φωτογραφία για να τη δεις μεγάλη και να την αποθηκεύσεις.", alSave: "Αποθήκευση φωτογραφίας", alClose: "Κλείσιμο",
      alPrev: "Προηγούμενη φωτογραφία", alNext: "Επόμενη φωτογραφία", alOf: "{i} από {n}", alBad: "{n} φωτογραφίες δεν εμφανίστηκαν.",
      copiedShort: "Αντιγράφηκε", copyFailShort: "Η αντιγραφή απέτυχε",
      tickHint: "Τα τικ εδώ είναι μόνο για σένα και δεν αποθηκεύονται.",
      phone: "Τηλέφωνο", email: "Email", address: "Διεύθυνση", web: "Ιστότοπος", im: "Chat",
      noFile: "Δεν βρέθηκε σύνδεσμος orOS σε αυτό το αρχείο.",
      slPick: "Διάλεξε μια ώρα που σε βολεύει.", slNone: "Καμία από αυτές τις ώρες δεν είναι πια μπροστά. Ζήτα καινούργιες.",
      slZone: "Οι ώρες είναι στη ζώνη ώρας σου ({z}).", slPicked: "Διάλεξες",
      slMail: "Email για επιβεβαίωση ({n})", slMailAnon: "Email για επιβεβαίωση", slNoMail: "Δεν ήρθε διεύθυνση email με τις ώρες: ενημέρωσε τον αποστολέα με άλλον τρόπο.",
      slIcs: "Προσθήκη σε ημερολόγιο (.ics)", slOros: "Πρόσθεσέ το στο orOS μου", slOther: "Άλλη ώρα",
      slHint: "Τίποτα δεν κλείνεται μέχρι ο αποστολέας να πάρει την απάντησή σου.",
      gone: "Ο σύνδεσμος έληξε ή ο αποστολέας τον ανακάλεσε.",
      net: "Δεν ήταν δυνατή η σύνδεση με τον server του orOS. Έλεγξε τη σύνδεσή σου και δοκίμασε ξανά.", retry: "Δοκίμασε ξανά",
      availUntil: "Διαθέσιμο έως {d}", refs: "Παραπομπές", docTitle: "orOS · Σου το έστειλαν",
      privRelay: "Ήρθε κρυπτογραφημένο από τον server του orOS και άνοιξε εδώ με το κλειδί του συνδέσμου. Ο server δεν βλέπει τι έχει μέσα."
    }
  };
  // The orOS language of this browser (a pack language too, through
  // ../i18n.js and its "share" pack); without one, Greek for a Greek
  // browser, else English.
  var LANG = (function () {
    var I = window.orosI18n;
    if (I) {
      var c = I.lang();
      if (c !== "en") return c;
      try { if (localStorage.getItem("oros-lang") === "en") return "en"; } catch (e) {}
      if (/[?&]lang=en(?:&|$)/.test(location.search)) return "en";
    }
    try {
      var l = localStorage.getItem("oros-lang");
      if (l === "el" || l === "en") return l;
    } catch (e) {}
    return /^el\b/i.test(navigator.language || "") ? "el" : "en";
  })();
  if (window.orosI18n) window.orosI18n.table(STR, "share", LANG);
  var LOC = window.orosI18n ? window.orosI18n.locale(LANG) : (LANG === "el" ? "el-GR" : "en-GB");
  function t(k) { return (STR[LANG] || STR.en)[k]; }

  // ---------- Palette ----------
  // Standalone (the usual case): the orOS theme of this browser when
  // there is one, else the system's. Framed: the shell's own palette.
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
    if (!theme) {
      try { theme = localStorage.getItem("oros-theme"); } catch (e) {}
    }
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
    try {
      window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", inheritPalette);
    } catch (e) {}
  }

  // ---------- Tiny DOM helpers (text only) ----------
  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt !== undefined && txt !== null) e.textContent = txt;
    return e;
  }
  function link(href, txt) {
    var a = el("a", "", txt);
    a.href = href;
    if (/^https?:/i.test(href)) { a.target = "_blank"; a.rel = "noopener noreferrer"; }
    return a;
  }
  function btn(label, cls, fn) {
    var b = el("button", cls, label);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }
  var toastTimer = 0;
  function toast(msg) {
    var old = document.querySelector(".toast");
    if (old) old.remove();
    var d = el("div", "toast", msg);
    d.setAttribute("role", "status");
    document.body.appendChild(d);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { d.remove(); }, 2600);
  }
  function card() { var c = $("card"); c.textContent = ""; return c; }
  function stateMsg(key, err) {
    var c = card();
    c.appendChild(el("p", "state" + (err ? " err" : ""), t(key)));
    return c;
  }

  // ---------- Views per kind ----------
  function field(dl, label, node) {
    dl.appendChild(el("dt", "", label));
    var dd = el("dd");
    if (typeof node === "string") dd.textContent = node; else dd.appendChild(node);
    dl.appendChild(dd);
  }
  function telHref(v) { var d = v.replace(/[^\d+]/g, ""); return d.length >= 3 ? "tel:" + d : ""; }
  // A Wiki article: wiki/core.js builds DOM nodes (textContent only);
  // links inside it lead nowhere here, so they become plain text.
  function wikiBody(x) {
    var C = window.WikiCore;
    if (!C) return el("p", "pre", x);
    var box = el("div", "wk");
    box.appendChild(C.render(document, C.parseDoc(x), { refs: t("refs") }));
    [].slice.call(box.querySelectorAll("a")).forEach(function (a) {
      if (a.classList.contains("xl")) return;
      var sp = el("span", a.className, a.textContent);
      a.parentNode.replaceChild(sp, a);
    });
    [].slice.call(box.querySelectorAll("img, .ref-up")).forEach(function (n) { n.remove(); });
    return box;
  }
  function render(env, bin) {
    var c = card(), d = env.d, S = K.strings(LANG);
    c.appendChild(el("p", "kind", S[env.k]));
    c.appendChild(el("h1", "", env.k === "recipe" && d.e ? d.e + " " + K.title(env, LANG) : K.title(env, LANG)));
    if (env.k === "list") {
      var ul = el("ul", "items");
      d.i.forEach(function (it) {
        var li = el("li"), lab = el("label"), cb = el("input"), sp = el("span", it.d ? "done" : "", it.x);
        cb.type = "checkbox";
        cb.checked = it.d === 1;
        cb.addEventListener("change", function () { sp.className = cb.checked ? "done" : ""; });
        lab.appendChild(cb);
        var wrap = el("span");
        wrap.appendChild(sp);
        if (it.n) wrap.appendChild(el("small", "", it.n));
        lab.appendChild(wrap);
        li.appendChild(lab);
        ul.appendChild(li);
      });
      c.appendChild(ul);
      c.appendChild(el("p", "hint", t("tickHint")));
    } else if (env.k === "note") {
      if (d.x) c.appendChild(el("p", "pre", d.x));
    } else if (env.k === "wiki") {
      if (d.x) c.appendChild(wikiBody(d.x));
    } else if (env.k === "contact") {
      var sub = [d.nn ? "“" + d.nn + "”" : "", d.j, d.o].filter(Boolean).join(" · ");
      if (sub) c.appendChild(el("p", "meta", sub));
      var dl = el("dl", "fields");
      d.p.forEach(function (r) { var h = telHref(r.v); field(dl, t("phone"), h ? link(h, r.v) : r.v); });
      d.e.forEach(function (r) { field(dl, t("email"), link("mailto:" + encodeURIComponent(r.v).replace(/%40/g, "@"), r.v)); });
      d.a.forEach(function (a) { field(dl, t("address"), K.addrText(a)); });
      d.u.forEach(function (r) { field(dl, t("web"), link(r.v, r.v)); });
      d.im.forEach(function (r) { field(dl, t("im"), r.v); });
      d.ev.forEach(function (e) {
        field(dl, e.ty === "custom" ? (e.l || S.event) : S[e.ty], (e.y ? e.y + "-" : "") + e.d);
      });
      if (dl.childNodes.length) c.appendChild(dl);
      if (d.x) { c.appendChild(el("h2", "", S.noteL)); c.appendChild(el("p", "pre", d.x)); }
    } else if (env.k === "event") {
      c.appendChild(el("p", "meta", K.whenText(d, LANG)));
      if (d.r) c.appendChild(el("p", "meta", S.repeats + ": " + K.repeatText(d.r, LANG)));
      if (d.l) c.appendChild(el("p", "", S.where + ": " + d.l));
      if (d.x) c.appendChild(el("p", "pre", d.x));
    } else if (env.k === "recipe") {
      var meta = [S.serv.replace("{n}", d.sv)];
      if (d.pt) meta.push(S.prep.replace("{n}", d.pt));
      if (d.ct) meta.push(S.cook.replace("{n}", d.ct));
      c.appendChild(el("p", "meta", meta.join(" · ")));
      if (d.ig.length) {
        c.appendChild(el("h2", "", S.ings));
        var g = null, list = null;
        d.ig.forEach(function (ing) {
          if (!list || (ing.g || "") !== g) {
            g = ing.g || "";
            if (g) c.appendChild(el("p", "meta", g));
            list = el("ul", "plain");
            c.appendChild(list);
          }
          list.appendChild(el("li", "", ingLine(ing)));
        });
      }
      if (d.st.length) {
        c.appendChild(el("h2", "", S.steps));
        var ol = el("ol", "steps");
        d.st.forEach(function (s) { ol.appendChild(el("li", "", s)); });
        c.appendChild(ol);
      }
      if (d.no) c.appendChild(el("p", "pre", d.no));
      if (d.src) {
        var p = el("p", "meta", S.source + ": ");
        p.appendChild(/^https?:\/\//i.test(d.src) ? link(d.src, d.src) : document.createTextNode(d.src));
        c.appendChild(p);
      }
    } else if (env.k === "slots") {
      renderSlots(c, env);
      return;
    } else if (env.k === "album") {
      renderAlbum(c, env, bin);
      return;
    } else if (env.k === "cal") {
      renderCal(c, env);
    } else if (env.k === "links") {
      var lu = el("ul", "items links");
      d.i.forEach(function (it) {
        var li = el("li");
        li.appendChild(link(it.u, it.t || it.u));
        li.appendChild(el("span", "u", it.u));
        if (it.n) li.appendChild(el("small", "", it.n));
        lu.appendChild(li);
      });
      c.appendChild(lu);
    }
    actions(c, env);
  }
  // ---------- Free times: pick one, then answer ----------
  function myZone() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) { return ""; }
  }
  function dayHead(ymd) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
    try {
      return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString(LOC,
        { weekday: "long", day: "numeric", month: "long" });
    } catch (e) { return ymd; }
  }
  function renderSlots(c, env) {
    var d = env.d, S = K.strings(LANG);
    var meta = [d.n ? S.slotWith.replace("{n}", d.n) : "", S.slotLen.replace("{n}", d.len)].filter(Boolean).join(" · ");
    c.appendChild(el("p", "meta", meta));
    if (d.l) c.appendChild(el("p", "", S.where + ": " + d.l));
    if (d.x) c.appendChild(el("p", "pre", d.x));
    // Every time in the receiver's own zone, grouped by its local day;
    // times already past are left out.
    var now = Date.now(), groups = [], byDay = {}, shifted = false;
    d.s.forEach(function (x) {
      x.m.forEach(function (min) {
        var w = K.slotWhen(d, x.d, min);
        if (w.shifted) shifted = true;
        var p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(w.d), hm = w.s.split(":");
        if (new Date(+p[1], +p[2] - 1, +p[3], +hm[0], +hm[1]).getTime() < now) return;
        if (!byDay[w.d]) { byDay[w.d] = []; groups.push(w.d); }
        byDay[w.d].push({ day: x.d, min: min, w: w });
      });
    });
    groups.sort();
    var zone = myZone();
    if (shifted && zone) c.appendChild(el("p", "hint", t("slZone").replace("{z}", zone)));
    var pick = el("div", "slots");
    if (!groups.length) {
      pick.appendChild(el("p", "state", t("slNone")));
    } else {
      pick.appendChild(el("p", "", t("slPick")));
      groups.forEach(function (g) {
        pick.appendChild(el("h2", "", dayHead(g)));
        var row = el("div", "slot-row");
        byDay[g].forEach(function (x) {
          row.appendChild(btn(x.w.s, "slot", function () { picked(c, env, x, pick); }));
        });
        pick.appendChild(row);
      });
    }
    c.appendChild(pick);
    var acts = el("div", "acts");
    acts.appendChild(btn(t("copyText"), "", function () { copyText(K.text(env, LANG, helpers)); }));
    c.appendChild(acts);
  }
  function picked(c, env, x, pick) {
    var d = env.d;
    var old = c.querySelector(".slot-done");
    if (old) old.remove();
    var evData = K.slotEvent(d, x.day, x.min, LANG);
    var ev = { v: 1, k: "event", d: evData };
    var box = el("div", "slot-done");
    box.appendChild(el("h2", "", t("slPicked")));
    box.appendChild(el("p", "meta", K.whenText(evData, LANG)));
    var acts = el("div", "acts");
    var mail = K.slotMail(d, x.day, x.min, LANG);
    if (mail) {
      var a = link(mail, d.n ? t("slMail").replace("{n}", d.n) : t("slMailAnon"));
      a.className = "btn prim";
      acts.appendChild(a);
    }
    acts.appendChild(btn(t("slIcs"), mail ? "" : "prim", function () { download(K.file(ev, LANG)); }));
    acts.appendChild(btn(t("slOros"), "", function () { addToOros(ev); }));
    acts.appendChild(btn(t("slOther"), "", function () { box.remove(); pick.hidden = false; }));
    box.appendChild(acts);
    if (!mail) box.appendChild(el("p", "hint", t("slNoMail")));
    box.appendChild(el("p", "hint", t("slHint")));
    pick.hidden = true;
    c.insertBefore(box, pick);
    try { box.scrollIntoView({ block: "nearest" }); } catch (e) {}
  }

  // ---------- An album: a grid, one photo large ----------
  // Each photo is its own slice of the item's byte run; it is shown only
  // when its first bytes say JPEG / PNG / WebP, from a blob: URL.
  var albumUrls = [];
  function renderAlbum(c, env, bin) {
    var d = env.d, S = K.strings(LANG);
    albumUrls.forEach(function (u) { URL.revokeObjectURL(u); });
    albumUrls = [];
    var photos = [], bad = 0;
    d.p.forEach(function (x) {
      var bytes = bin && x.o + x.n <= bin.length ? bin.subarray(x.o, x.o + x.n) : null;
      var type = bytes ? K.photoType(bytes) : "";
      if (!type) { bad++; return; }
      var url = URL.createObjectURL(new Blob([bytes], { type: type }));
      albumUrls.push(url);
      photos.push({ url: url, type: type, c: x.c || "", w: x.w, h: x.h });
    });
    c.appendChild(el("p", "meta", photos.length === 1 ? S.album1 : S.albumN.replace("{n}", photos.length)));
    if (bad) c.appendChild(el("p", "hint", t("alBad").replace("{n}", bad)));
    var grid = el("div", "al-grid");
    photos.forEach(function (ph, i) {
      var b = btn("", "al-cell", function () { lightbox(photos, i, b); });
      var im = el("img");
      im.src = ph.url;
      im.alt = ph.c || S.photo.replace("{n}", i + 1);
      im.loading = "lazy";
      im.decoding = "async";
      b.appendChild(im);
      b.setAttribute("aria-label", im.alt);
      grid.appendChild(b);
    });
    c.appendChild(grid);
    if (photos.length) c.appendChild(el("p", "hint", t("alHint")));
  }
  function photoName(ph, i) {
    var base = (ph.c || "").replace(/[\\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
    var ext = ph.type === "image/png" ? ".png" : ph.type === "image/webp" ? ".webp" : ".jpg";
    return (base || "orOS photo " + (i + 1)) + ext;
  }
  function lightbox(photos, at, from) {
    var S = K.strings(LANG), i = at;
    var box = el("div", "al-box");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    var img = el("img"), cap = el("p", "al-cap"), count = el("span", "al-count");
    var bar = el("div", "al-bar");
    var prev = btn("\u2039", "al-nav", function () { go(-1); });
    var next = btn("\u203a", "al-nav", function () { go(1); });
    prev.setAttribute("aria-label", t("alPrev"));
    next.setAttribute("aria-label", t("alNext"));
    var save = btn(t("alSave"), "prim", function () {
      var a = el("a");
      a.href = photos[i].url;
      a.download = photoName(photos[i], i);
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
    var close = btn(t("alClose"), "", shut);
    bar.appendChild(prev);
    bar.appendChild(count);
    bar.appendChild(next);
    bar.appendChild(save);
    bar.appendChild(close);
    var stage = el("div", "al-stage");
    stage.appendChild(img);
    box.appendChild(stage);
    box.appendChild(cap);
    box.appendChild(bar);
    stage.addEventListener("click", function (e) { if (e.target === stage) shut(); });
    function go(n) { i = (i + n + photos.length) % photos.length; show(); }
    function show() {
      var ph = photos[i];
      img.src = ph.url;
      img.alt = ph.c || S.photo.replace("{n}", i + 1);
      cap.textContent = ph.c;
      cap.hidden = !ph.c;
      count.textContent = t("alOf").replace("{i}", i + 1).replace("{n}", photos.length);
      prev.hidden = next.hidden = photos.length < 2;
    }
    function key(e) {
      if (e.key === "Escape") shut();
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
    }
    function shut() {
      document.removeEventListener("keydown", key);
      box.remove();
      document.body.classList.remove("al-open");
      try { from.focus(); } catch (e) {}
    }
    document.addEventListener("keydown", key);
    document.body.classList.add("al-open");
    document.body.appendChild(box);
    show();
    close.focus();
  }

  // ---------- A calendar: month grid or list, one month at a time ----------
  // Occurrences come from the Calendar's own rules (calendar/occur.js);
  // timed events are converted from the sender's zone to this one.
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function ymdOf(y, m, d) { var x = new Date(Date.UTC(y, m, d)); return x.getUTCFullYear() + "-" + pad2(x.getUTCMonth() + 1) + "-" + pad2(x.getUTCDate()); }
  function calItems(d) {
    var O = window.OrosCalOccur;
    if (!O) return [];
    return d.ev.map(function (e) {
      var ce = { date: e.d, dateEnd: e.de || null, start: e.s || null, end: e.s ? (e.e || null) : null,
                 tz: e.s ? (e.z || d.tz || null) : null, recur: null };
      if (e.r) {
        var r = null;
        if (e.r.x) { var fr = O.fromRrule(e.r.x, e.d); r = fr && fr.recur ? fr.recur : null; }
        else r = { freq: e.r.f, interval: e.r.i, until: e.r.u || null };
        if (r) { r.exdates = e.xd || []; ce.recur = O.normRecur(r, e.d); }
      }
      return { e: e, c: ce };
    });
  }
  function renderCal(c, env) {
    var d = env.d, O = window.OrosCalOccur, S = K.strings(LANG);
    var loc = LOC;
    var meta = [d.ev.length === 1 ? S.cal1 : S.calN.replace("{n}", d.ev.length), K.calRange(d, LANG)].filter(Boolean).join(" · ");
    c.appendChild(el("p", "meta", meta));
    if (!O) return;
    var items = calItems(d), lb = d.lb || [];
    if (lb.some(function (l) { return l.n; })) {
      var leg = el("div", "cal-leg");
      lb.forEach(function (l) {
        if (!l.n) return;
        var chip = el("span", "chip"), dot = el("i", "dot");
        if (l.c) dot.style.background = l.c;
        chip.appendChild(dot);
        chip.appendChild(document.createTextNode(l.n));
        leg.appendChild(chip);
      });
      c.appendChild(leg);
    }
    var zoneNote = el("p", "hint");
    zoneNote.hidden = true;
    c.appendChild(zoneNote);
    // The month to open on: today's when it is inside the range, else
    // the range's first, else the earliest event's.
    var today = (function () { var n = new Date(); return ymdOf(n.getFullYear(), n.getMonth(), n.getDate()); })();
    var first = d.f || d.ev.reduce(function (a, e) { return !a || e.d < a ? e.d : a; }, "");
    var start = (!d.f || today >= d.f) && (!d.u || today <= d.u) ? today : first;
    var ym = { y: +start.slice(0, 4), m: +start.slice(5, 7) - 1 };
    var mode = "month", sel = null;

    var bar = el("div", "cal-bar");
    var prev = btn("\u2039", "cal-arrow", function () { step(-1); });
    var next = btn("\u203a", "cal-arrow", function () { step(1); });
    prev.setAttribute("aria-label", t("calPrev"));
    next.setAttribute("aria-label", t("calNext"));
    var head = el("h2", "cal-head");
    head.setAttribute("aria-live", "polite");
    var tabs = el("div", "cal-tabs");
    tabs.setAttribute("role", "group");
    var tMonth = btn(t("calMonth"), "", function () { mode = "month"; draw(); });
    var tList = btn(t("calList"), "", function () { mode = "list"; draw(); });
    tabs.appendChild(tMonth);
    tabs.appendChild(tList);
    bar.appendChild(prev);
    bar.appendChild(head);
    bar.appendChild(next);
    c.appendChild(bar);
    c.appendChild(tabs);
    var box = el("div", "cal-box");
    c.appendChild(box);

    var minYm = d.f ? +d.f.slice(0, 4) * 12 + +d.f.slice(5, 7) - 1 : -Infinity;
    var maxYm = d.u ? +d.u.slice(0, 4) * 12 + +d.u.slice(5, 7) - 1 : Infinity;
    function step(n) {
      var v = ym.y * 12 + ym.m + n;
      if (v < minYm || v > maxYm) return;
      ym = { y: Math.floor(v / 12), m: v % 12 };
      sel = null;
      draw();
    }
    // day → [{ e, inst }] for the device days [from, to], inside the range.
    function collect(from, to) {
      var lo = d.f && d.f > from ? d.f : from, hi = d.u && d.u < to ? d.u : to, by = {}, zoned = false;
      if (lo > hi) return { by: by, zoned: false };
      items.forEach(function (it) {
        O.instancesBetween(it.c, lo, hi, function (inst) {
          if (inst.zoned) zoned = true;
          var day = inst.date < lo ? lo : inst.date, last = inst.dateEnd && inst.dateEnd < hi ? inst.dateEnd : (inst.dateEnd ? hi : inst.date);
          for (var g = 0; day <= last && g < 62; g++) {
            (by[day] = by[day] || []).push({ e: it.e, inst: inst });
            day = O.addDays(day, 1);
          }
          return true;
        });
      });
      Object.keys(by).forEach(function (k) {
        by[k].sort(function (a, b) {
          var sa = a.inst.start && a.inst.date === k ? a.inst.start : "", sb = b.inst.start && b.inst.date === k ? b.inst.start : "";
          return sa < sb ? -1 : sa > sb ? 1 : 0;
        });
      });
      return { by: by, zoned: zoned };
    }
    function color(e) { var l = typeof e.b === "number" ? lb[e.b] : null; return l && l.c ? l.c : ""; }
    function evRow(x, day) {
      var li = el("li"), dot = el("i", "dot");
      var col = color(x.e);
      if (col) dot.style.background = col;
      li.appendChild(dot);
      var tm = !x.inst.start ? t("calAllDay")
        : (x.inst.date === day ? x.inst.start : "\u2026") + (x.inst.end && (x.inst.dateEnd || x.inst.date) === day ? "\u2013" + x.inst.end : "");
      li.appendChild(el("span", "tm", tm));
      var w = el("span", "what", x.e.t || S.untitled);
      if (x.e.l) w.appendChild(el("small", "", x.e.l));
      li.appendChild(w);
      return li;
    }
    function dayList(by, day, emptyKey) {
      var list = by[day] || [];
      if (!list.length) return el("p", "state", t(emptyKey));
      var ul = el("ul", "cal-evs");
      list.forEach(function (x) { ul.appendChild(evRow(x, day)); });
      return ul;
    }
    function dayHead2(day) {
      var p = day.split("-");
      try { return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString(loc, { weekday: "long", day: "numeric", month: "long" }); }
      catch (e) { return day; }
    }
    function draw() {
      tMonth.setAttribute("aria-pressed", mode === "month" ? "true" : "false");
      tList.setAttribute("aria-pressed", mode === "list" ? "true" : "false");
      var v = ym.y * 12 + ym.m;
      prev.disabled = v <= minYm;
      next.disabled = v >= maxYm;
      try { head.textContent = new Date(ym.y, ym.m, 1).toLocaleDateString(loc, { month: "long", year: "numeric" }); }
      catch (e) { head.textContent = ym.y + "-" + pad2(ym.m + 1); }
      var mFirst = ymdOf(ym.y, ym.m, 1), mLast = ymdOf(ym.y, ym.m + 1, 0);
      var gFirst = O.addDays(mFirst, -((O.wdOf(mFirst) + 6) % 7));
      var gLast = O.addDays(mLast, (7 - O.wdOf(mLast)) % 7);
      var got = collect(mode === "month" ? gFirst : mFirst, mode === "month" ? gLast : mLast), by = got.by;
      var zone = myZone();
      zoneNote.hidden = !(got.zoned && zone);
      zoneNote.textContent = zone ? t("calZone").replace("{z}", zone) : "";
      box.textContent = "";
      if (mode === "list") {
        var days = Object.keys(by).filter(function (k) { return k >= mFirst && k <= mLast; }).sort();
        if (!days.length) { box.appendChild(el("p", "state", t("calNoneMonth"))); return; }
        days.forEach(function (k) {
          box.appendChild(el("h2", "", dayHead2(k)));
          box.appendChild(dayList(by, k, "calNoneDay"));
        });
        return;
      }
      var grid = el("div", "cal-grid");
      var mon = O.addDays("2024-01-01", 0);                   // a Monday
      for (var w = 0; w < 7; w++) {
        var wd = mon.split("-");
        var name = "";
        try { name = new Date(+wd[0], +wd[1] - 1, +wd[2] + w).toLocaleDateString(loc, { weekday: "narrow" }); } catch (e) {}
        grid.appendChild(el("span", "wd", name));
      }
      if (!sel || sel < mFirst || sel > mLast) sel = today >= mFirst && today <= mLast ? today : mFirst;
      for (var day = gFirst; day <= gLast; day = O.addDays(day, 1)) {
        (function (day) {
          var list = by[day] || [];
          var b = btn("", "cal-day" + (day < mFirst || day > mLast ? " out" : "") + (day === today ? " today" : "") +
            (day === sel ? " sel" : "") + ((d.f && day < d.f) || (d.u && day > d.u) ? " off" : ""), function () {
            sel = day;
            draw();
          });
          b.appendChild(el("span", "n", String(+day.slice(8))));
          if (list.length) {
            var dots = el("span", "dots");
            list.slice(0, 3).forEach(function (x) {
              var dt = el("i", "dot"), col = color(x.e);
              if (col) dt.style.background = col;
              dots.appendChild(dt);
            });
            if (list.length > 3) dots.appendChild(el("small", "", "+" + (list.length - 3)));
            b.appendChild(dots);
          }
          b.setAttribute("aria-label", dayHead2(day) + (list.length ? ", " + (list.length === 1 ? S.cal1 : S.calN.replace("{n}", list.length)) : ""));
          if (day === sel) b.setAttribute("aria-current", "date");
          grid.appendChild(b);
        })(day);
      }
      box.appendChild(grid);
      box.appendChild(el("h2", "", dayHead2(sel)));
      box.appendChild(dayList(by, sel, "calNoneDay"));
    }
    draw();
  }

  function ingLine(ing) {
    if (M && typeof M.ingToLine === "function") {
      try { return M.ingToLine(ing, LANG, 1); } catch (e) {}
    }
    return [ing.q === null ? "" : ing.q, ing.u, ing.n].filter(function (x) { return x !== ""; }).join(" ") + (ing.x ? ", " + ing.x : "");
  }
  var helpers = { ingLine: function (ing) { return ingLine(ing); } };

  // ---------- Actions ----------
  function actions(c, env) {
    var acts = el("div", "acts");
    acts.appendChild(btn(t("add"), "prim", function () { addToOros(env); }));
    acts.appendChild(btn(t("copyText"), "", function () { copyText(K.text(env, LANG, helpers)); }));
    var f = K.file(env, LANG);
    acts.appendChild(btn(t("dl." + env.k) || t("download"), "", function () { download(f); }));
    c.appendChild(acts);
    c.appendChild(el("p", "hint", t("addHint." + env.k)));
  }
  function addToOros(env) {
    try {
      sessionStorage.setItem("oros-share-in", JSON.stringify({ at: Date.now(), k: env.k, d: env.d }));
    } catch (e) { toast(t("copyFailShort")); return; }
    location.href = "../?share-in=1";
  }
  function copyText(s) {
    var ok = function () { toast(t("copiedShort")); }, bad = function () { toast(t("copyFailShort")); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(s).then(ok, bad);
      return;
    }
    var ta = el("textarea");
    ta.value = s;
    ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    var done = false;
    try { done = document.execCommand("copy"); } catch (e) {}
    ta.remove();
    (done ? ok : bad)();
  }
  function download(f) {
    var url = URL.createObjectURL(new Blob([f.text], { type: f.mime }));
    var a = el("a");
    a.href = url;
    a.download = f.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  // ---------- Opening ----------
  function show(code, password) {
    if (R && R.parse(code)) { showRelay(code, password); return; }
    K.decode(code, password).then(function (r) {
      if (r.env) { render(r.env); return; }
      if (r.error === "pass") { askPass(code, !!password); return; }
      stateMsg(r.error === "big" ? "big" : (r.error === "crypto" ? "crypto" : "bad"), true);
      if (r.error === "bad") fileOffer($("card"));
    });
  }
  // A link with an expiry: the pieces come from the relay, the key
  // from the link; what opens goes through the same normalizers.
  function showRelay(code, password) {
    var p = $("privacy");
    if (p) p.textContent = t("privRelay");
    R.open(code, { password: password }).then(function (r) {
      if (r.error === "pass") { askPass(code, !!password); return; }
      if (r.error) {
        var c = stateMsg(r.error === "gone" ? "gone" : r.error === "net" ? "net" : r.error === "big" ? "big" : "bad", true);
        if (r.error === "net") {
          var acts = el("div", "acts");
          acts.appendChild(btn(t("retry"), "prim", function () { stateMsg("state.loading"); showRelay(code, password); }));
          c.appendChild(acts);
        }
        return;
      }
      var env = r.e && r.e.v === 1 && typeof r.e.k === "string" ? K.pack(r.e.k, r.e.d) : null;
      if (!env) { stateMsg("bad", true); return; }
      render(env, r.bin || null);
      var d = new Date(r.x);
      $("card").appendChild(el("p", "hint", t("availUntil").replace("{d}", d.toLocaleString(LOC,
        { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }))));
    });
  }
  function askPass(code, wrong) {
    var c = card();
    c.appendChild(el("h1", "", t("lockedMsg")));
    var f = el("form", "pass");
    var inp = el("input");
    inp.type = "password";
    inp.autocomplete = "off";
    inp.placeholder = t("pass");
    inp.setAttribute("aria-label", t("pass"));
    f.appendChild(inp);
    if (wrong) f.appendChild(el("p", "state err", t("wrong")));
    var acts = el("div", "acts");
    var go = el("button", "prim", t("unlock"));
    go.type = "submit";
    acts.appendChild(go);
    f.appendChild(acts);
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!inp.value) { inp.focus(); return; }
      go.disabled = true;
      go.textContent = t("state.loading");
      show(code, inp.value);
    });
    c.appendChild(f);
    inp.focus();
  }
  function fileOffer(c) {
    var p = el("p", "hint", t("emptyFile") + " ");
    var inp = el("input");
    inp.type = "file";
    inp.accept = ".txt,text/plain";
    inp.hidden = true;
    inp.addEventListener("change", function () {
      var f = inp.files && inp.files[0];
      if (!f) return;
      if (f.size > 2 * 1024 * 1024) { toast(t("big")); return; }
      f.text().then(function (txt) {
        var m = /\/share\/#((?:0|1|p1|r1|q1)\.[A-Za-z0-9_.-]+)/.exec(txt);
        if (!m) { toast(t("noFile")); return; }
        show(m[1]);
      }, function () { toast(t("noFile")); });
    });
    var b = btn(t("openFile"), "", function () { inp.click(); });
    var acts = el("div", "acts");
    acts.appendChild(b);
    c.appendChild(p);
    c.appendChild(acts);
    c.appendChild(inp);
  }
  function route() {
    var code = K ? K.codeFromHash(location.hash) : "";
    if (!code && R) {
      var h = String(location.hash || "").replace(/^#/, "");
      if (R.parse(h)) code = h;
    }
    if (!K) { stateMsg("bad", true); return; }
    if (!code) {
      var c = stateMsg("empty");
      fileOffer(c);
      return;
    }
    stateMsg("state.loading");
    show(code);
  }

  function applyI18n() {
    document.documentElement.lang = LANG;
    Array.prototype.forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      var v = t(n.getAttribute("data-i18n"));
      if (typeof v === "string") n.textContent = v;
    });
    if (LANG !== "en") document.title = t("docTitle");
  }

  inheritPalette();
  watchPalette();
  applyI18n();
  route();
  window.addEventListener("hashchange", route);
})();
