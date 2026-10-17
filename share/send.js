// ============================================================
// orOS "Send to someone" — share/send.js (shell side, v1.0.0)
// Loaded by shell.js on first use (with share/kinds.js), never at
// boot. Two jobs:
//   open(opts)   the send dialog. opts = { kind, data, text? }: an app
//                hands over ONE item; the dialog makes the link
//                (optionally locked with a password) and offers Share,
//                Copy link, QR code, Email (orOS Mail), Save as file
//                and, when the app gave `text`, its old "send as text".
//                "With an expiry" (BR-SHARE-RELAY, share/relay.js) puts
//                the item on the orOS relay, encrypted, for 1 / 7 / 30
//                days; items too long for a plain link always go that
//                way. Such links are kept in "My shared links"
//                (share/out.js, synced) where they can be revoked.
//   links()      the dialog straight on "My shared links" (Settings).
//   deliver(sh)  "Add to my orOS" from the receiving page: the item
//                waits in sessionStorage "oros-share-in" (this tab
//                only, never synced) and goes to the app's existing
//                receiver through __orosOpenAt.
// A plain link stores nothing anywhere; a link with an expiry stores
// only ciphertext on the relay and its secrets in "My shared links".
// ES5, like the shell. Strings EN/EL here (the shell's table stays
// untouched).
// ============================================================
(function () {
  "use strict";

  var K = window.OrosShareKinds;
  var R = window.OrosShareRelay;
  var OUT = window.OrosShareOut;
  var IN_KEY = "oros-share-in";
  var MIN_PASS = 6;
  var EYE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/>' +
    '<circle cx="12" cy="12" r="3"/></svg>';

  var STR = {
    en: {
      title: "Send to someone", close: "Close",
      warn: "Anyone who gets the link can see what is in it. A sent link cannot be taken back and does not expire.",
      warnLock: "The link alone shows nothing. Tell the password another way (in person, by phone).",
      lock: "Lock with a password", pass: "Password", show: "Show password", hide: "Hide password",
      passShort: "At least {n} characters", making: "Making the link…",
      share: "Share…", copy: "Copy link", qr: "QR code", mail: "Email", file: "Save as file", asText: "Send as text",
      copied: "Link copied", copyFail: "Could not copy. Select the link and copy it.",
      long: "Too long for a link ({n} characters). Save it as a file and attach that instead.",
      qrLong: "Too long for a QR code. Use the link or a file.", back: "Back",
      saved: "Saved", textCopied: "Text copied",
      fileHead: "Open this link to see it (orOS):",
      noApp: "This needs the {app} app, which is not in your orOS.",
      inBad: "The shared item could not be read.",
      failed: "Something went wrong. Try again.",
      mailPass: "The password comes separately.",
      exp: "With an expiry", expDays: { 1: "1 day", 7: "7 days", 30: "30 days" },
      warnExp: "Stored encrypted on the orOS server until it expires; the server cannot read it. You can take it back in My shared links.",
      forced: "Too long for a plain link, so it is stored encrypted with an expiry.",
      full: "The orOS server has no room right now. Try a shorter expiry or try later.",
      rate: "You have shared a lot today. Try again tomorrow.",
      nostore: "Links with an expiry are not available right now.",
      net: "Could not reach the orOS server. Check your connection and try again.",
      mine: "My shared links", none: "No links with an expiry yet.",
      until: "Until {d}", revoke: "Take back", sure: "Sure? Take back", revoked: "Taken back. The link no longer opens.",
      revokeFail: "Could not take it back. Check your connection and try again.", locked: "with password"
    },
    el: {
      title: "Στείλε σε κάποιον", close: "Κλείσιμο",
      warn: "Όποιος πάρει τον σύνδεσμο βλέπει τι έχει μέσα. Ό,τι στείλεις δεν παίρνεται πίσω και δεν λήγει.",
      warnLock: "Ο σύνδεσμος μόνος του δεν δείχνει τίποτα. Πες τον κωδικό από άλλο δρόμο (από κοντά, στο τηλέφωνο).",
      lock: "Κλείδωμα με κωδικό", pass: "Κωδικός", show: "Εμφάνιση κωδικού", hide: "Απόκρυψη κωδικού",
      passShort: "Τουλάχιστον {n} χαρακτήρες", making: "Φτιάχνω τον σύνδεσμο…",
      share: "Κοινοποίηση…", copy: "Αντιγραφή συνδέσμου", qr: "Κωδικός QR", mail: "Με email", file: "Αποθήκευση ως αρχείο", asText: "Αποστολή ως κείμενο",
      copied: "Ο σύνδεσμος αντιγράφηκε", copyFail: "Η αντιγραφή απέτυχε. Επίλεξε τον σύνδεσμο και αντίγραψέ τον.",
      long: "Πολύ μεγάλο για σύνδεσμο ({n} χαρακτήρες). Αποθήκευσέ το ως αρχείο και στείλε το συνημμένο.",
      qrLong: "Πολύ μεγάλο για κωδικό QR. Στείλε τον σύνδεσμο ή αρχείο.", back: "Πίσω",
      saved: "Αποθηκεύτηκε", textCopied: "Το κείμενο αντιγράφηκε",
      fileHead: "Άνοιξε αυτόν τον σύνδεσμο για να το δεις (orOS):",
      noApp: "Χρειάζεται την εφαρμογή {app}, που δεν υπάρχει στο orOS σου.",
      inBad: "Δεν ήταν δυνατό να διαβαστεί αυτό που σου έστειλαν.",
      failed: "Κάτι πήγε στραβά. Δοκίμασε ξανά.",
      mailPass: "Τον κωδικό θα τον πάρεις χωριστά.",
      exp: "Με λήξη", expDays: { 1: "1 μέρα", 7: "7 μέρες", 30: "30 μέρες" },
      warnExp: "Αποθηκεύεται κρυπτογραφημένο στον server του orOS μέχρι να λήξει· ο server δεν μπορεί να το διαβάσει. Μπορείς να το πάρεις πίσω από «Οι σύνδεσμοί μου».",
      forced: "Είναι πολύ μεγάλο για απλό σύνδεσμο, οπότε αποθηκεύεται κρυπτογραφημένο με λήξη.",
      full: "Ο server του orOS δεν έχει χώρο αυτή τη στιγμή. Δοκίμασε μικρότερη λήξη ή αργότερα.",
      rate: "Μοιράστηκες πολλά σήμερα. Δοκίμασε ξανά αύριο.",
      nostore: "Οι σύνδεσμοι με λήξη δεν είναι διαθέσιμοι αυτή τη στιγμή.",
      net: "Δεν ήταν δυνατή η σύνδεση με τον server του orOS. Έλεγξε τη σύνδεσή σου και δοκίμασε ξανά.",
      mine: "Οι σύνδεσμοί μου", none: "Δεν υπάρχουν ακόμη σύνδεσμοι με λήξη.",
      until: "Έως {d}", revoke: "Ανάκληση", sure: "Σίγουρα; Ανάκληση", revoked: "Ανακλήθηκε. Ο σύνδεσμος δεν ανοίγει πια.",
      revokeFail: "Η ανάκληση απέτυχε. Έλεγξε τη σύνδεσή σου και δοκίμασε ξανά.", locked: "με κωδικό"
    }
  };
  function lang() { return window.orosLang === "el" ? "el" : "en"; }
  function T(k, p) {
    var s = (STR[lang()] || STR.en)[k];
    if (typeof s !== "string") return s;
    Object.keys(p || {}).forEach(function (x) { s = s.split("{" + x + "}").join(String(p[x])); });
    return s;
  }
  function toast(text) {
    try {
      if (window.orosNotifs && typeof window.orosNotifs.transient === "function") {
        window.orosNotifs.transient({ ns: "system", title: text, body: "" });
        return;
      }
    } catch (e) {}
  }

  // ---------- Look ----------
  var CSS =
    "#osh-dlg{border:1px solid var(--border);border-radius:14px;background:var(--panel-bg);color:var(--text);" +
    "padding:18px;width:min(420px,calc(100vw - 32px));max-height:calc(100dvh - 32px);overflow:auto;box-sizing:border-box}" +
    "#osh-dlg::backdrop{background:rgba(0,0,0,.45)}" +
    "#osh-dlg h3{margin:0 0 4px;font-size:16px}" +
    "#osh-dlg .osh-sum{margin:0 0 10px;font-weight:600;font-size:13.5px;overflow-wrap:anywhere}" +
    "#osh-dlg .osh-warn{margin:0 0 12px;font-size:12.5px;line-height:1.5;color:var(--text-dim)}" +
    "#osh-dlg .osh-lock{display:flex;align-items:center;gap:8px;font-size:13.5px;margin:0 0 8px;cursor:pointer}" +
    "#osh-dlg .osh-pass{display:flex;gap:6px;margin:0 0 6px}" +
    "#osh-dlg .osh-pass input{flex:1;min-width:0;padding:8px 10px;border:1px solid var(--border);border-radius:8px;" +
    "background:var(--panel-bg);color:var(--text);font-size:14px}" +
    "#osh-dlg .osh-eye{width:38px;border:1px solid var(--border);border-radius:8px;background:transparent;color:var(--text-dim);cursor:pointer}" +
    "#osh-dlg .osh-msg{min-height:1.2em;margin:4px 0 10px;font-size:12.5px;color:var(--text-dim)}" +
    "#osh-dlg .osh-msg.err{color:#e5534b}" +
    "#osh-dlg .osh-acts{display:grid;grid-template-columns:1fr 1fr;gap:8px}" +
    "#osh-dlg .osh-acts button,#osh-dlg .osh-foot button{padding:10px 12px;border:1px solid var(--border);border-radius:10px;" +
    "background:transparent;color:var(--text);font:inherit;font-size:13.5px;cursor:pointer;text-align:center}" +
    "#osh-dlg .osh-acts button.prim{background:var(--accent);border-color:var(--accent);color:var(--osh-on-accent,#fff);font-weight:700}" +
    "#osh-dlg .osh-acts button:disabled{opacity:.45;cursor:default}" +
    "#osh-dlg .osh-acts button:not(:disabled):hover,#osh-dlg .osh-foot button:hover{border-color:var(--accent)}" +
    "#osh-dlg .osh-foot{display:flex;justify-content:flex-end;margin-top:12px}" +
    "#osh-dlg .osh-qr{display:flex;flex-direction:column;align-items:center;gap:10px}" +
    "#osh-dlg .osh-qr img{width:min(300px,100%);height:auto;background:#fff;border-radius:8px;image-rendering:pixelated}" +
    "#osh-dlg .osh-days{display:flex;gap:6px;margin:0 0 8px 26px;flex-wrap:wrap}" +
    "#osh-dlg .osh-days button{padding:6px 10px;border:1px solid var(--border);border-radius:999px;background:transparent;" +
    "color:var(--text);font:inherit;font-size:12.5px;cursor:pointer}" +
    "#osh-dlg .osh-days button[aria-pressed=true]{border-color:var(--accent);background:var(--accent-soft,transparent);font-weight:700}" +
    "#osh-dlg .osh-foot{gap:8px;flex-wrap:wrap}" +
    "#osh-dlg .osh-list{list-style:none;margin:0 0 8px;padding:0;display:flex;flex-direction:column;gap:8px}" +
    "#osh-dlg .osh-list li{border:1px solid var(--border);border-radius:10px;padding:10px}" +
    "#osh-dlg .osh-list .osh-t{font-weight:600;font-size:13.5px;overflow-wrap:anywhere}" +
    "#osh-dlg .osh-list .osh-m{font-size:12px;color:var(--text-dim);margin:2px 0 8px}" +
    "#osh-dlg .osh-list .osh-acts{grid-template-columns:1fr 1fr}" +
    "@media (max-width:420px){#osh-dlg .osh-acts{grid-template-columns:1fr}}";
  function ensureCss() {
    if (document.getElementById("osh-css")) return;
    var st = document.createElement("style");
    st.id = "osh-css";
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  // Text on the accent colour: dark on a light accent (the gold of the
  // orOS skin), white on a dark one.
  function onAccent() {
    var v = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(), r, g, b, m;
    if ((m = /^#([0-9a-f]{6})$/i.exec(v))) { r = parseInt(m[1].slice(0, 2), 16); g = parseInt(m[1].slice(2, 4), 16); b = parseInt(m[1].slice(4), 16); }
    else if ((m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(v))) { r = +m[1]; g = +m[2]; b = +m[3]; }
    else return "#fff";
    var lin = function (c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) > 0.3 ? "#14120d" : "#fff";
  }
  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt !== undefined) e.textContent = txt;
    return e;
  }
  function btn(label, cls, fn) {
    var b = el("button", cls || "", label);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }

  // ---------- Helpers ----------
  function baseUrl() {
    var p = location.pathname.replace(/[^\/]*$/, "");
    return location.origin + p + "share/";
  }
  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return legacy(text); });
    }
    return Promise.resolve(legacy(text));
  }
  function legacy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed"; ta.style.opacity = "0";
    (document.querySelector("dialog[open]") || document.body).appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) {}
    ta.remove();
    return ok;
  }
  function mailReady() {
    try {
      var d = JSON.parse(localStorage.getItem("oros-mail-data") || "null");
      return !!(d && Array.isArray(d.accounts) && d.accounts.length);
    } catch (e) { return false; }
  }
  var qrLoad = null;
  function qrLib() {
    if (window.orosQR) return Promise.resolve(window.orosQR);
    if (!qrLoad) {
      qrLoad = new Promise(function (resolve, reject) {
        var s = document.createElement("script");
        s.src = "qr/qr-encode.js" + (window.__orosShareV ? "?v=" + window.__orosShareV : "");
        s.onload = function () { window.orosQR ? resolve(window.orosQR) : reject(new Error("qr")); };
        s.onerror = function () { qrLoad = null; reject(new Error("qr")); };
        document.head.appendChild(s);
      });
    }
    return qrLoad;
  }

  // ---------- The dialog frame ----------
  function frame() {
    ensureCss();
    var stale = document.getElementById("osh-dlg");
    if (stale) { try { stale.close(); } catch (e) {} stale.remove(); }
    var dlg = el("dialog");
    dlg.id = "osh-dlg";
    dlg.style.setProperty("--osh-on-accent", onAccent());
    dlg.setAttribute("aria-labelledby", "osh-h");
    var h = el("h3", "", T("title"));
    h.id = "osh-h";
    dlg.appendChild(h);
    var body = el("div");
    dlg.appendChild(body);
    var foot = el("div", "osh-foot");
    dlg.appendChild(foot);
    return { dlg: dlg, h: h, body: body, foot: foot,
             show: function () {
               document.body.appendChild(dlg);
               dlg.addEventListener("close", function () { dlg.remove(); });
               dlg.showModal();
             } };
  }
  function fmtDay(ms) {
    return new Date(ms).toLocaleString(lang() === "el" ? "el-GR" : "en-GB",
      { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }
  function errText(e) {
    var m = e && e.message;
    return ["full", "rate", "nostore", "net"].indexOf(m) >= 0 ? T(m) : T("failed");
  }

  // ---------- "My shared links" ----------
  // back: when given, a Back button returns to the send window.
  function linksView(f, back) {
    f.h.textContent = T("mine");
    f.body.textContent = "";
    f.foot.textContent = "";
    var msg = el("div", "osh-msg");
    msg.setAttribute("role", "status");
    var items = OUT ? OUT.list() : [];
    if (!items.length) f.body.appendChild(el("p", "osh-warn", T("none")));
    var ul = el("ul", "osh-list");
    var S = K.strings(lang());
    items.forEach(function (it) {
      var li = el("li");
      li.appendChild(el("div", "osh-t", it.t || S.untitled));
      li.appendChild(el("div", "osh-m", [S[it.k] || it.k, T("until", { d: fmtDay(it.x) })].concat(it.p ? [T("locked")] : []).join(" · ")));
      var acts = el("div", "osh-acts");
      acts.appendChild(btn(T("copy"), "", function () {
        copy(baseUrl() + "#" + it.c).then(function (ok) { toast(ok ? T("copied") : T("copyFail")); });
      }));
      var armed = false;
      var rb = btn(T("revoke"), "", function () {
        if (!armed) { armed = true; rb.textContent = T("sure"); return; }
        rb.disabled = true;
        R.revoke(it.id, it.d).then(function () {
          OUT.markRevoked(it.id);
          toast(T("revoked"));
          linksView(f, back);
        }, function () {
          rb.disabled = false;
          msg.className = "osh-msg err";
          msg.textContent = T("revokeFail");
        });
      });
      acts.appendChild(rb);
      li.appendChild(acts);
      ul.appendChild(li);
    });
    if (items.length) f.body.appendChild(ul);
    f.body.appendChild(msg);
    if (back) f.foot.appendChild(btn(T("back"), "", back));
    f.foot.appendChild(btn(T("close"), "", function () { f.dlg.close(); }));
  }
  function links() {
    if (!K || !R) return;
    var f = frame();
    linksView(f, null);
    f.show();
  }

  // ---------- The send dialog ----------
  function open(opts) {
    if (!K) return;
    opts = opts || {};
    var env = K.pack(opts.kind, opts.data);
    if (!env) { toast(T("failed")); return; }
    var f = frame(), dlg = f.dlg, body = f.body;

    var cache = {};                       // JSON [days (0 = plain link), password] → code
    var busy = false;
    var lockOn = false;
    var expOn = false, forced = false, days = 7;
    var canExp = !!(R && OUT);

    function main() {
      f.h.textContent = T("title");
      f.foot.textContent = "";
      if (canExp) f.foot.appendChild(btn(T("mine"), "", function () { linksView(f, main); }));
      f.foot.appendChild(btn(T("close"), "", function () { dlg.close(); }));
      body.textContent = "";
      body.appendChild(el("p", "osh-sum", K.summary(env, lang())));
      var warn = el("p", "osh-warn");
      body.appendChild(warn);
      function warnText() { warn.textContent = expOn ? T("warnExp") : (lockOn ? T("warnLock") : T("warn")); }
      warnText();

      var expLab = el("label", "osh-lock"), ecb = el("input"), dayRow = el("div", "osh-days");
      if (canExp) {
        ecb.type = "checkbox";
        ecb.checked = expOn;
        ecb.disabled = forced;
        expLab.appendChild(ecb);
        expLab.appendChild(el("span", "", T("exp")));
        body.appendChild(expLab);
        R.DAYS.forEach(function (n) {
          var b = btn(T("expDays")[n], "", function () {
            days = n;
            [].forEach.call(dayRow.children, function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
          });
          b.setAttribute("aria-pressed", n === days ? "true" : "false");
          dayRow.appendChild(b);
        });
        dayRow.hidden = !expOn;
        body.appendChild(dayRow);
      }

      var lockLab = el("label", "osh-lock");
      var cb = el("input");
      cb.type = "checkbox";
      cb.checked = lockOn;
      lockLab.appendChild(cb);
      lockLab.appendChild(el("span", "", T("lock")));
      body.appendChild(lockLab);
      var passRow = el("div", "osh-pass");
      var pw = el("input");
      pw.type = "password";
      pw.autocomplete = "new-password";
      pw.placeholder = T("pass");
      pw.setAttribute("aria-label", T("pass"));
      pw.value = curPass;
      var eye = btn("", "osh-eye", function () {
        var showing = pw.type === "text";
        pw.type = showing ? "password" : "text";
        eye.setAttribute("aria-label", showing ? T("show") : T("hide"));
      });
      eye.innerHTML = EYE;
      eye.setAttribute("aria-label", T("show"));
      passRow.appendChild(pw);
      passRow.appendChild(eye);
      passRow.hidden = !lockOn;
      body.appendChild(passRow);

      var msg = el("div", "osh-msg");
      msg.setAttribute("role", "status");
      body.appendChild(msg);

      var acts = el("div", "osh-acts");
      var bShare = navigator.share ? btn(T("share"), "prim", function () { act("share"); }) : null;
      var bCopy = btn(T("copy"), bShare ? "" : "prim", function () { act("copy"); });
      var bQr = btn(T("qr"), "", function () { act("qr"); });
      var bMail = hasMail ? btn(T("mail"), "", function () { act("mail"); }) : null;
      var bFile = btn(T("file"), "", function () { act("file"); });
      var bText = typeof opts.text === "string" && opts.text ? btn(T("asText"), "", sendText) : null;
      [bShare, bCopy, bQr, bMail, bFile, bText].forEach(function (b) { if (b) acts.appendChild(b); });
      body.appendChild(acts);
      var linkBtns = [bShare, bCopy, bQr, bMail].filter(Boolean);

      ecb.addEventListener("change", function () {
        expOn = ecb.checked;
        dayRow.hidden = !expOn;
        warnText();
        check();
      });
      cb.addEventListener("change", function () {
        lockOn = cb.checked;
        passRow.hidden = !lockOn;
        warnText();
        check();
        if (lockOn) pw.focus();
      });
      pw.addEventListener("input", function () { curPass = pw.value; check(); });

      // Link-only buttons are off while a plain link is too long or the
      // password too short; "Save as file" needs only a valid password.
      // A plain link too long for a URL turns "With an expiry" on for good.
      function check() {
        msg.className = "osh-msg";
        msg.textContent = forced ? T("forced") : "";
        var short = lockOn && curPass.length < MIN_PASS;
        if (short) { msg.textContent = T("passShort", { n: MIN_PASS }); }
        linkBtns.forEach(function (b) { b.disabled = short; });
        bFile.disabled = short;
        if (short || expOn) return;
        var key = ck(0, lockOn ? curPass : "");
        if (cache[key]) sizeCheck(cache[key]);
        else if (!lockOn) codeFor(0, "").then(sizeCheck, function () {});
      }
      function sizeCheck(code) {
        if (code.length <= K.MAX_LINK || expOn) return;
        if (canExp) {
          forced = expOn = true;
          ecb.checked = true;
          ecb.disabled = true;
          dayRow.hidden = false;
          warnText();
          msg.className = "osh-msg";
          msg.textContent = T("forced");
          return;
        }
        linkBtns.forEach(function (b) { b.disabled = true; });
        msg.className = "osh-msg err";
        msg.textContent = T("long", { n: code.length });
      }
      function act(what) {
        if (busy) return;
        if (lockOn && curPass.length < MIN_PASS) { check(); pw.focus(); return; }
        var d = expOn ? days : 0, pass = lockOn ? curPass : "";
        busy = true;
        if (!cache[ck(d, pass)]) { msg.className = "osh-msg"; msg.textContent = T("making"); }
        codeFor(d, pass).then(function (code) {
          busy = false;
          msg.textContent = forced ? T("forced") : "";
          if (what !== "file" && !expOn && code.length > K.MAX_LINK) { sizeCheck(code); return; }
          var link = baseUrl() + "#" + code;
          if (what === "share") {
            navigator.share({ title: K.title(env, lang()), url: link }).catch(function () {});
          } else if (what === "copy") {
            copy(link).then(function (ok) { toast(ok ? T("copied") : T("copyFail")); });
          } else if (what === "qr") {
            showQr(link);
          } else if (what === "mail") {
            dlg.close();
            var bodyText = K.summary(env, lang()) + "\n\n" + link + (lockOn ? "\n\n" + T("mailPass") : "") + "\n";
            window.__orosOpenAt("mail", { compose: { subject: K.title(env, lang()).slice(0, 300), body: bodyText } });
          } else if (what === "file") {
            saveFile(link);
          }
        }, function (e) {
          busy = false;
          msg.className = "osh-msg err";
          msg.textContent = errText(e);
        });
      }
      check();
    }
    var curPass = "";
    var hasMail = typeof window.__orosOpenAt === "function" && mailReady();

    // days 0 = a plain link; 1 / 7 / 30 = a link with an expiry, made
    // once per (days, password) choice and kept in My shared links.
    function ck(d, pass) { return JSON.stringify([d, pass]); }
    function codeFor(d, pass) {
      var key = ck(d, pass);
      if (cache[key]) return Promise.resolve(cache[key]);
      if (!d) return K.encode(env, pass || undefined).then(function (code) { cache[key] = code; return code; });
      return R.create(env, { days: d, password: pass || undefined }).then(function (r) {
        OUT.add({ id: r.id, c: r.code, d: r.del, k: env.k, t: K.title(env, lang()), x: r.exp, a: Date.now(), p: pass ? 1 : 0 });
        cache[key] = r.code;
        return r.code;
      });
    }
    function showQr(link) {
      qrLib().then(function (Q) {
        var qr;
        try { qr = Q.encode(link, { ecl: "L" }); } catch (e) { toast(T("qrLong")); return; }
        body.textContent = "";
        var box = el("div", "osh-qr");
        box.appendChild(el("p", "osh-sum", K.summary(env, lang())));
        var img = el("img");
        img.alt = T("qr");
        img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(Q.svg(qr, { margin: 4, scale: 6 }));
        box.appendChild(img);
        box.appendChild(btn(T("back"), "", main));
        body.appendChild(box);
      }, function () { toast(T("failed")); });
    }
    function saveFile(link) {
      var fl = K.file(env, lang());
      var name = fl.name.replace(/\.[a-z]+$/, "") + " (orOS).txt";
      var txt = K.summary(env, lang()) + "\n\n" + T("fileHead") + "\n" + link + "\n";
      var host = window.orosDialog;
      if (host && typeof host.saveFile === "function") {
        host.saveFile({ text: txt, filename: name, mime: "text/plain;charset=utf-8",
          types: [{ description: "Text", accept: { "text/plain": [".txt"] } }] })
          .then(function (r) { if (r && r.ok) toast(T("saved")); });
      }
    }
    function sendText() {
      var t = opts.text;
      var mobile = navigator.share && !/Windows NT|Macintosh|X11|CrOS/.test(navigator.userAgent);
      if (mobile) {
        navigator.share({ title: K.title(env, lang()), text: t }).catch(function () {});
        return;
      }
      copy(t).then(function (ok) { toast(ok ? T("textCopied") : T("copyFail")); });
    }

    main();
    f.show();
  }

  // ---------- "Add to my orOS" ----------
  // sh = { hasApp(id) } from the shell. The item was decoded (and
  // unlocked) by the receiving page; it is normalized again here.
  function deliver(sh) {
    var raw = null;
    try {
      raw = sessionStorage.getItem(IN_KEY);
      sessionStorage.removeItem(IN_KEY);
    } catch (e) {}
    if (!raw || !K) return;
    var env = null;
    try {
      var o = JSON.parse(raw);
      if (o && typeof o.at === "number" && Date.now() - o.at < 30 * 60000) env = K.pack(o.k, o.d);
    } catch (e) { env = null; }
    if (!env) { toast(T("inBad")); return; }
    var go = K.target(env, lang());
    if (!go) { toast(T("inBad")); return; }        // "slots": a time is picked on the page first
    if (!sh || !sh.hasApp(go.app)) {
      var name = typeof window.t === "function" ? window.t("app." + go.app) : go.app;
      toast(T("noApp", { app: name && name !== "app." + go.app ? name : go.app }));
      return;
    }
    window.__orosOpenAt(go.app, go.target);
  }

  window.__orosShareImpl = { open: open, links: links, deliver: deliver };
})();
