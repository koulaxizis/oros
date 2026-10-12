// ============================================================
// orOS "Send to someone" — share/view.js (the receiving page)
// Opens the item inside the link (#1.… / #p1.…, see kinds.js) and
// shows it. Works without orOS (copy, download); with orOS in this
// browser "Add to my orOS" hands the item to the right app.
// Hostile input: kinds.js normalizes everything, and this file only
// ever writes text (textContent) and links it checked itself.
// ============================================================
(function () {
  "use strict";

  var K = window.OrosShareKinds;
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
      locked: "This is locked with a password.", pass: "Password", unlock: "Open", wrong: "Wrong password.",
      add: "Add to my orOS", copy: "Copy text", download: "Download", openFile: "Open a file",
      addHint: { list: "Opens To-Do with the items ready to add.", note: "Makes a new page in Notes.",
        contact: "Opens Contacts and asks before saving.", event: "Opens Calendar and asks before saving.",
        recipe: "Opens the Meal Planner with the recipe ready to save.", links: "Opens Bookmarks." },
      dl: { contact: "Download (.vcf)", event: "Add to calendar (.ics)", links: "Download (.html)" },
      copied: "Copied", copyFail: "Could not copy",
      tickHint: "Ticks here are only for you and are not saved.",
      phone: "Phone", email: "Email", address: "Address", web: "Website", im: "Chat",
      noFile: "No orOS link in that file."
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
      locked: "Είναι κλειδωμένο με κωδικό.", pass: "Κωδικός", unlock: "Άνοιγμα", wrong: "Λάθος κωδικός.",
      add: "Πρόσθεσέ το στο orOS μου", copy: "Αντιγραφή κειμένου", download: "Λήψη", openFile: "Άνοιγμα αρχείου",
      addHint: { list: "Ανοίγει το To-Do με τα είδη έτοιμα για προσθήκη.", note: "Φτιάχνει νέα σελίδα στις Σημειώσεις.",
        contact: "Ανοίγει τις Επαφές και ρωτά πριν αποθηκεύσει.", event: "Ανοίγει το Ημερολόγιο και ρωτά πριν αποθηκεύσει.",
        recipe: "Ανοίγει το Πλάνο γευμάτων με τη συνταγή έτοιμη για αποθήκευση.", links: "Ανοίγει τους Σελιδοδείκτες." },
      dl: { contact: "Λήψη (.vcf)", event: "Προσθήκη σε ημερολόγιο (.ics)", links: "Λήψη (.html)" },
      copied: "Αντιγράφηκε", copyFail: "Η αντιγραφή απέτυχε",
      tickHint: "Τα τικ εδώ είναι μόνο για σένα και δεν αποθηκεύονται.",
      phone: "Τηλέφωνο", email: "Email", address: "Διεύθυνση", web: "Ιστότοπος", im: "Chat",
      noFile: "Δεν βρέθηκε σύνδεσμος orOS σε αυτό το αρχείο."
    }
  };
  var LANG = (function () {
    try {
      var l = localStorage.getItem("oros-lang");
      if (l === "el" || l === "en") return l;
    } catch (e) {}
    return /^el\b/i.test(navigator.language || "") ? "el" : "en";
  })();
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
  function render(env) {
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
    acts.appendChild(btn(t("copy"), "", function () { copyText(K.text(env, LANG, helpers)); }));
    var f = K.file(env, LANG);
    acts.appendChild(btn((t("dl")[env.k]) || t("download"), "", function () { download(f); }));
    c.appendChild(acts);
    c.appendChild(el("p", "hint", t("addHint")[env.k]));
  }
  function addToOros(env) {
    try {
      sessionStorage.setItem("oros-share-in", JSON.stringify({ at: Date.now(), k: env.k, d: env.d }));
    } catch (e) { toast(t("copyFail")); return; }
    location.href = "../?share-in=1";
  }
  function copyText(s) {
    var ok = function () { toast(t("copied")); }, bad = function () { toast(t("copyFail")); };
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
    K.decode(code, password).then(function (r) {
      if (r.env) { render(r.env); return; }
      if (r.error === "pass") { askPass(code, !!password); return; }
      stateMsg(r.error === "big" ? "big" : (r.error === "crypto" ? "crypto" : "bad"), true);
      if (r.error === "bad") fileOffer($("card"));
    });
  }
  function askPass(code, wrong) {
    var c = card();
    c.appendChild(el("h1", "", t("locked")));
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
        var m = /\/share\/#((?:0|1|p1)\.[A-Za-z0-9_-]+)/.exec(txt);
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
    if (LANG === "el") document.title = "orOS · Σου το έστειλαν";
  }

  inheritPalette();
  watchPalette();
  applyI18n();
  route();
  window.addEventListener("hashchange", route);
})();
