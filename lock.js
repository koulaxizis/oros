// ============================================================
// orOS Core — Screen lock (lock.js, window.orosLock)
// Optional, off by default, set in Settings › Screen lock. A PIN
// or a passphrase is asked when orOS starts, after N idle minutes
// and (optional) when the page is hidden. The lock screen is a
// modal <dialog> over the whole shell: the bar, the menu, the
// desktop and every app frame turn inert behind it, while the apps
// keep running (music plays on, sync keeps syncing).
//   - Only a slow hash is kept: PBKDF2-SHA-256, 600 000 rounds,
//     16-byte random salt (as the Passwords fallback KDF), in the
//     device-local key "oros-lock". It is never synced, never in a
//     backup file, and the factory reset sweep removes it (oros-*).
//   - Forgotten PIN: the sync passphrase opens it (checked by
//     orosSync.checkPassphrase: this device's copy, else the cloud
//     blob, never applied), and the lock turns off. Last resort:
//     reset THIS device (shell hook: unsynced changes are sent first
//     when sync can, then the local wipe; the cloud stays).
//   - Fingerprint or face (LK-BIO, 2026-11-12): on Android (the orOS
//     app and the single app "orOS Passwords") the lock also opens
//     with strong biometrics, through the same native path as
//     Passwords (BR-PHONE pw-bio, phone.js orosPhone.bio, use "lock").
//     The app keeps a 32-byte secret D sealed by a per-use Keystore
//     key; this page keeps, in device-local "oros-lock-bio", a random
//     token wrapped with D (AES-256-GCM, AAD oros-lock/1/bio/<kid>).
//     Only D from the app opens it. The PIN / passphrase stays the
//     root: it is asked every 14 days, and a new fingerprint ends it.
//   - Honest limit: it keeps people away from the screen. Anyone who
//     can read the disk, or open the browser's developer tools, gets
//     past it; the data on the device is not encrypted by it.
// Loaded by index.html right after translations.js, before sync.js
// and shell.js, so a locked start never paints the desktop and its
// keydown guard runs before the shell's shortcut handler.
// Sections:
//   1. Core (pure: config, secrets, tries; Node-tested)
//   2. Crypto
//   3. State, storage, activity
//   4. Lock screen
//   5. Public API + boot
// Versioning: orOS-wide version lives ONLY in shell.js.
// ============================================================
(function (root) {
  "use strict";

  // ---------- 1. Core ----------
  var KEY = "oros-lock";             // localStorage, device-local
  var TRIES_KEY = "oros-lock-tries"; // localStorage, device-local
  var SEEN_KEY = "oros-lock-seen";   // sessionStorage: last activity while open
  var ITER = 600000;
  var ITER_MIN = 100000, ITER_MAX = 5000000;   // a crafted value must not hang the tab
  var IDLES = [0, 1, 2, 5, 10, 15, 30, 60];    // minutes; 0 = never
  var DEFAULT_IDLE = 5;
  var GRACE_MAX = 10 * 60 * 1000;    // a reload in the same tab stays open this long at most
  var FREE_TRIES = 5;
  var WAIT_BASE = 30 * 1000, WAIT_MAX = 15 * 60 * 1000;
  var PIN_RE = /^[0-9]{4,12}$/;
  var PASS_MIN = 6, SECRET_MAX = 256;
  var BIO_KEY = "oros-lock-bio";     // localStorage, device-local, never synced
  var BIO_DAYS = 14;
  var DAY = 86400000;
  var BIO_KID = /^[0-9a-f]{24}$/;
  var B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

  function norm(s) {
    s = String(s == null ? "" : s);
    try { s = s.normalize("NFC"); } catch (e) {}
    return s;
  }

  // "ok", or why a new PIN / passphrase is refused.
  function secretProblem(kind, secret) {
    var s = norm(secret);
    if (kind === "pin") return PIN_RE.test(s) ? "ok" : "pin";
    if (kind !== "pass") return "kind";
    if (s.length > SECRET_MAX) return "long";
    return (s.trim().length >= PASS_MIN) ? "ok" : "short";
  }

  // The stored record → a clean config, or null (= no lock).
  function parseCfg(raw) {
    var c;
    try { c = JSON.parse(raw || "null"); } catch (e) { return null; }
    if (!c || typeof c !== "object" || c.v !== 1) return null;
    if (c.kind !== "pin" && c.kind !== "pass") return null;
    if (typeof c.salt !== "string" || typeof c.hash !== "string" || !c.salt || !c.hash) return null;
    if (typeof c.i !== "number" || c.i !== Math.floor(c.i) || c.i < ITER_MIN || c.i > ITER_MAX) return null;
    return { v: 1, kind: c.kind, salt: c.salt, hash: c.hash, i: c.i,
             idle: IDLES.indexOf(c.idle) !== -1 ? c.idle : DEFAULT_IDLE,
             hidden: c.hidden === true };
  }

  function parseTries(raw) {
    var v;
    try { v = JSON.parse(raw || "null"); } catch (e) { v = null; }
    var n = (v && typeof v.n === "number" && v.n > 0) ? Math.floor(v.n) : 0;
    var until = (v && typeof v.until === "number") ? v.until : 0;
    return { n: n, until: until };
  }

  // After FREE_TRIES wrong answers each one waits longer: 30 s, 1 min,
  // 2 min … up to 15 min.
  function afterFail(tries, now) {
    var n = tries.n + 1, until = 0;
    if (n >= FREE_TRIES) until = now + Math.min(WAIT_MAX, WAIT_BASE * Math.pow(2, n - FREE_TRIES));
    return { n: n, until: until };
  }

  // Milliseconds still to wait (a clock set back cannot stretch it
  // past WAIT_MAX).
  function waitLeft(tries, now) {
    var left = tries.until - now;
    if (left <= 0) return 0;
    return Math.min(left, WAIT_MAX);
  }

  // Does a reload find this tab still open? `seen` = last activity
  // stored in sessionStorage while it was unlocked.
  function stillOpen(cfg, seen, now) {
    if (!seen || now < seen) return false;
    var grace = cfg.idle ? Math.min(cfg.idle * 60000, GRACE_MAX) : GRACE_MAX;
    return now - seen < grace;
  }

  function sameText(a, b) {
    a = String(a); b = String(b);
    if (a.length !== b.length) return false;
    var d = 0;
    for (var i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return d === 0;
  }

  // The fingerprint record → a clean one, or null. iv: 12 bytes,
  // ct: a 32-byte token + the 16-byte tag (base64 64 characters).
  function parseBio(raw) {
    var r;
    try { r = typeof raw === "string" ? JSON.parse(raw) : raw; } catch (e) { return null; }
    if (!r || typeof r !== "object" || r.v !== 1) return null;
    if (typeof r.kid !== "string" || !BIO_KID.test(r.kid)) return null;
    if (typeof r.iv !== "string" || r.iv.length !== 16 || !B64_RE.test(r.iv)) return null;
    if (typeof r.ct !== "string" || r.ct.length !== 64 || !B64_RE.test(r.ct)) return null;
    if (typeof r.at !== "number" || !isFinite(r.at) || r.at <= 0) return null;
    return { v: 1, kid: r.kid, iv: r.iv, ct: r.ct, at: r.at };
  }

  // May the fingerprint open it now? "none" (no record), "days" (the
  // PIN / passphrase was last typed more than 14 days ago, or the clock
  // says it was typed in the future), "ok".
  function bioDue(rec, now) {
    if (!rec) return "none";
    if (rec.at > now + DAY || now - rec.at > BIO_DAYS * DAY) return "days";
    return "ok";
  }

  var Core = {
    BIO_KEY: BIO_KEY, BIO_DAYS: BIO_DAYS, parseBio: parseBio, bioDue: bioDue,
    KEY: KEY, TRIES_KEY: TRIES_KEY, SEEN_KEY: SEEN_KEY, ITER: ITER, IDLES: IDLES,
    DEFAULT_IDLE: DEFAULT_IDLE, FREE_TRIES: FREE_TRIES, WAIT_MAX: WAIT_MAX, GRACE_MAX: GRACE_MAX,
    norm: norm, secretProblem: secretProblem, parseCfg: parseCfg, parseTries: parseTries,
    afterFail: afterFail, waitLeft: waitLeft, stillOpen: stillOpen, sameText: sameText
  };

  // ---------- 2. Crypto ----------
  function subtle() {
    var c = root && root.crypto;
    return (c && c.subtle && typeof root.TextEncoder === "function") ? c.subtle : null;
  }
  function b64(buf) {
    var a = new Uint8Array(buf), s = "";
    for (var i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
    return root.btoa(s);
  }
  function unb64(s) {
    var bin = root.atob(s), a = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return a;
  }
  function derive(secret, salt, iter) {
    var S = subtle();
    if (!S) return Promise.reject(new Error("no-crypto"));
    var bytes = new root.TextEncoder().encode(norm(secret));
    return S.importKey("raw", bytes, "PBKDF2", false, ["deriveBits"]).then(function (k) {
      return S.deriveBits({ name: "PBKDF2", salt: salt, iterations: iter, hash: "SHA-256" }, k, 256);
    }).then(b64);
  }
  // A new record for `secret` (keeps the given idle / hidden choices).
  function makeCfg(kind, secret, prev) {
    var salt = new Uint8Array(16);
    root.crypto.getRandomValues(salt);
    return derive(secret, salt, ITER).then(function (hash) {
      return { v: 1, kind: kind, salt: b64(salt), hash: hash, i: ITER,
               idle: prev ? prev.idle : DEFAULT_IDLE, hidden: prev ? prev.hidden : false };
    });
  }
  function matches(cfg, secret) {
    var salt;
    try { salt = unb64(cfg.salt); } catch (e) { return Promise.resolve(false); }
    return derive(secret, salt, cfg.i).then(function (h) { return sameText(h, cfg.hash); });
  }
  Core.makeCfg = makeCfg;
  Core.matches = matches;

  function bioAad(kid) { return new root.TextEncoder().encode("oros-lock/1/bio/" + kid); }
  function bioKey(d, use) {
    return subtle().importKey("raw", d, { name: "AES-GCM" }, false, [use]);
  }
  // A new record: a random token wrapped with the app's secret D.
  function bioWrap(kid, d, now) {
    if (!subtle() || !BIO_KID.test(String(kid)) || !d || d.length !== 32) return Promise.reject(new Error("bio-failed"));
    var iv = new Uint8Array(12), tok = new Uint8Array(32);
    root.crypto.getRandomValues(iv);
    root.crypto.getRandomValues(tok);
    return bioKey(d, "encrypt").then(function (k) {
      return subtle().encrypt({ name: "AES-GCM", iv: iv, additionalData: bioAad(kid) }, k, tok);
    }).then(function (ct) {
      tok.fill(0);
      return { v: 1, kid: kid, iv: b64(iv), ct: b64(ct), at: now };
    });
  }
  // Does D open this record? (AES-GCM's tag: a wrong D, kid or a
  // changed record answers false.)
  function bioOpens(rec, d) {
    if (!subtle() || !rec || !d || d.length !== 32) return Promise.resolve(false);
    var iv, ct;
    try { iv = unb64(rec.iv); ct = unb64(rec.ct); } catch (e) { return Promise.resolve(false); }
    return bioKey(d, "decrypt").then(function (k) {
      return subtle().decrypt({ name: "AES-GCM", iv: iv, additionalData: bioAad(rec.kid) }, k, ct);
    }).then(function (tok) { new Uint8Array(tok).fill(0); return true; }, function () { return false; });
  }
  Core.bioWrap = bioWrap;
  Core.bioOpens = bioOpens;
  Core.unb64 = function (s) { return unb64(s); };

  if (typeof module !== "undefined" && module.exports) module.exports = Core;
  if (!root || !root.document || root.orosLock) return;

  // ---------- 3. State, storage, activity ----------
  var doc = root.document;
  var cfg = null;
  var locked = false;
  var busy = false;
  var lastActive = Date.now();
  var listeners = [];
  var hooks = { reset: null, recovered: null };
  var bc = null;

  function load() {
    try { cfg = parseCfg(root.localStorage.getItem(KEY)); } catch (e) { cfg = null; }
    return cfg;
  }
  function save(c) {
    try {
      if (c) root.localStorage.setItem(KEY, JSON.stringify(c));
      else root.localStorage.removeItem(KEY);
    } catch (e) { return false; }
    cfg = c ? parseCfg(JSON.stringify(c)) : null;
    return true;
  }
  function tries() {
    try { return parseTries(root.localStorage.getItem(TRIES_KEY)); } catch (e) { return { n: 0, until: 0 }; }
  }
  function failOnce() {
    try { root.localStorage.setItem(TRIES_KEY, JSON.stringify(afterFail(tries(), Date.now()))); } catch (e) {}
  }
  function clearTries() {
    try { root.localStorage.removeItem(TRIES_KEY); } catch (e) {}
  }
  function waitMs() { return waitLeft(tries(), Date.now()); }

  function markSeen() {
    if (locked || !cfg) return;
    try { root.sessionStorage.setItem(SEEN_KEY, String(lastActive)); } catch (e) {}
  }
  function clearSeen() {
    try { root.sessionStorage.removeItem(SEEN_KEY); } catch (e) {}
  }

  function emit() {
    listeners.slice().forEach(function (fn) {
      try { fn(); } catch (e) {
        // A closed app frame that never unsubscribed: drop it.
        var i = listeners.indexOf(fn);
        if (i !== -1) listeners.splice(i, 1);
      }
    });
  }

  // Activity anywhere: the shell and every same-origin app frame
  // (frames are hooked on each tick; a reloaded frame is a new
  // window, so it is hooked again).
  var ACTIVITY = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll"];
  function poke() { if (!locked) lastActive = Date.now(); }
  function hookWin(w) {
    try {
      if (!w || w.__orosLockHooked) return;
      w.__orosLockHooked = true;
      ACTIVITY.forEach(function (ev) { w.addEventListener(ev, poke, { capture: true, passive: true }); });
    } catch (e) {}
  }
  function hookFrames(d, depth) {
    if (depth > 2) return;
    var fr;
    try { fr = d.querySelectorAll("iframe"); } catch (e) { return; }
    for (var i = 0; i < fr.length; i++) {
      try {
        var w = fr[i].contentWindow;
        if (w && w.document) { hookWin(w); hookFrames(w.document, depth + 1); }
      } catch (e) { /* another origin */ }
    }
  }

  // ----- Fingerprint or face (LK-BIO) -----
  // The computer (wave 2): orOS Portable, the desktop apps and orOS USB.
  // Their System extension marks the page with data-oros-sys-bio and
  // passes the DOM event "oros-bio" {n, op, kid, text} to the native host
  // (Windows Hello or fprintd); "oros-bio-done" {n, ok, …} answers. Same
  // shape as orosPhone.bio, so the rest of this file uses either.
  var desk = (function () {
    var info = null, waits = {}, subs = [];
    function fire() { subs.slice().forEach(function (fn) { try { fn(); } catch (e) {} }); }
    function on() {
      try { return doc.documentElement.getAttribute("data-oros-sys-bio") === "1"; } catch (e) { return false; }
    }
    function nonce() {
      var b = new Uint8Array(16), s = "";
      root.crypto.getRandomValues(b);
      for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? "0" : "") + b[i].toString(16);
      return s;
    }
    doc.addEventListener("oros-bio-done", function (ev) {
      var r = null;
      try { r = JSON.parse(String(ev.detail)); } catch (e) { return; }
      var w = r && typeof r.n === "string" ? waits[r.n] : null;
      if (!w) return;
      delete waits[r.n];
      clearTimeout(w.timer);
      w.done(r);
    });
    function ask(op, kid, text) {
      return new Promise(function (done) {
        if (!on()) { done({ ok: false, error: "unavailable" }); return; }
        var n = nonce();
        waits[n] = { done: done, timer: setTimeout(function () {
          if (waits[n]) { delete waits[n]; done({ ok: false, error: "timeout" }); }
        }, op === "seal" || op === "open" ? 150000 : 15000) };
        try {
          doc.dispatchEvent(new root.CustomEvent("oros-bio", { detail: JSON.stringify({ n: n, op: op, kid: kid || "", text: text || "" }) }));
        } catch (e) { delete waits[n]; done({ ok: false, error: "unavailable" }); }
      });
    }
    function refresh() {
      if (!on()) return false;
      ask("state").then(function (r) {
        if (!r.ok) return;
        info = { can: /^(ok|none|no-hw)$/.test(r.can) ? r.can : "no-hw",
                 kind: r.kind === "hello" ? "hello" : "finger",
                 kids: (Array.isArray(r.kids) ? r.kids : []).filter(function (k) { return BIO_KID.test(String(k)); }).slice(0, 16) };
        fire();
      });
      return true;
    }
    function secret(op, kid) {
      return ask(op, kid, t("lock.bio.prompt")).then(function (r) {
        refresh();
        if (r.ok && typeof r.d === "string" && /^[A-Za-z0-9+/]{43}=$/.test(r.d)) return r.d;
        var c = /^[a-z-]{1,20}$/.test(String(r.error)) ? r.error : "failed";
        throw new Error("bio-" + (c === "no-hw" ? "unavailable" : c));
      });
    }
    // The extension sets its mark after the page loads.
    try {
      new root.MutationObserver(function () { if (on() && !info) refresh(); fire(); })
        .observe(doc.documentElement, { attributes: true, attributeFilter: ["data-oros-sys-bio"] });
    } catch (e) {}
    return {
      available: on,
      info: function () { return info; },
      refresh: refresh,
      seal: function (kid) { return secret("seal", kid); },
      open: function (kid) { return secret("open", kid); },
      clear: function (kid) { if (!BIO_KID.test(String(kid))) return false; ask("clear", kid).then(refresh); return true; },
      onChange: function (fn) {
        subs.push(fn);
        return function () { var i = subs.indexOf(fn); if (i !== -1) subs.splice(i, 1); };
      }
    };
  })();
  var deskSource = { bio: desk, onChange: desk.onChange, desk: true };

  // The phone: phone.js (orosPhone.bio), in this window; it loads after
  // this file, so it is looked up when needed. A computer with the System
  // extension uses desk.
  function phone() {
    var p = root.orosPhone;
    try {
      if (p && p.bio && typeof p.bio.available === "function" && typeof p.bio.open === "function" && p.bio.available()) return p;
    } catch (e) {}
    if (desk.available()) return deskSource;
    try { return (p && p.bio && typeof p.bio.available === "function" && typeof p.bio.open === "function") ? p : null; }
    catch (e) { return null; }
  }
  // "phone", "hello" (Windows Hello) or "finger" (fprintd).
  function bioKind() {
    var p = phone();
    if (!p || !p.desk) return "phone";
    var i = desk.info();
    return i ? i.kind : "finger";
  }
  function bioLinked() { var p = phone(); try { return !!(p && p.bio.available()); } catch (e) { return false; } }
  function bioInfo() { var p = phone(); try { return p ? p.bio.info() : null; } catch (e) { return null; } }
  function bioRec() {
    try { return parseBio(root.localStorage.getItem(BIO_KEY)); } catch (e) { return null; }
  }
  function bioStore(r) {
    try {
      if (r) root.localStorage.setItem(BIO_KEY, JSON.stringify(r));
      else root.localStorage.removeItem(BIO_KEY);
      return true;
    } catch (e) { return false; }
  }
  // Ends fingerprint unlock here: the record and the app's secret.
  function bioForget() {
    var r = bioRec(), p = phone();
    bioStore(null);
    if (r && p) { try { p.bio.clear(r.kid); } catch (e) {} }
  }
  // The PIN / passphrase was typed: the 14 days count from now.
  function bioTyped() {
    var r = bioRec();
    if (r) { r.at = Date.now(); bioStore(r); }
  }
  // The app holds the secret, and the 14 days have not run out.
  function bioReady() {
    var r = bioRec(), info = bioInfo();
    return !!(cfg && r && bioLinked() && info && info.can === "ok" &&
              info.kids.indexOf(r.kid) >= 0 && bioDue(r, Date.now()) === "ok");
  }
  function bioKid() {
    var b = new Uint8Array(12), s = "";
    root.crypto.getRandomValues(b);
    for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? "0" : "") + b[i].toString(16);
    return s;
  }
  // "invalidated" (a new fingerprint), "none" (the app lost its
  // secret), "wrong" (the secret does not open the record) end it.
  function bioCode(e) {
    var c = String((e && e.message) || "").replace(/^bio-/, "");
    return /^(cancel|lockout|invalidated|none|wrong|timeout|unavailable)$/.test(c) ? c : "failed";
  }
  // The phone's answers repaint the lock screen and Settings; only a
  // change of what it says about fingerprints counts.
  var bioSeen = "", bioOff = null, bioTries = 0;
  function bioChanged() {
    var now = JSON.stringify([bioLinked(), bioInfo()]);
    if (now === bioSeen) return;
    bioSeen = now;
    if (ui && !ui.bioBusy) fillBio();
    emit();
  }
  desk.onChange(bioChanged);
  function bioWatch() {
    if (bioOff) return;
    var p = root.orosPhone;
    if (!p || typeof p.onChange !== "function") return;
    bioOff = p.onChange(bioChanged);
    bioSeen = JSON.stringify([bioLinked(), bioInfo()]);
    // The port may have come before this watch: the lock screen asks now.
    if (ui && !ui.bioBusy) fillBio();
  }
  // phone.js loads after this file and the app's port comes later:
  // look for it for a while after boot.
  var bioTimer = setInterval(function () {
    bioWatch();
    if (bioOff || ++bioTries > 60) { clearInterval(bioTimer); bioTimer = null; }
  }, 500);

  function idleDue() {
    return !!(cfg && cfg.idle && Date.now() - lastActive >= cfg.idle * 60000);
  }
  function tick() {
    if (!cfg || locked) return;
    hookFrames(doc, 0);
    if (idleDue()) { lock("idle"); return; }
    markSeen();
  }

  // ---------- 4. Lock screen ----------
  function lang() {
    var I = root.orosI18n;
    var l = root.orosLang || (I && typeof I.lang === "function" ? I.lang() : null);
    if (!l) { try { l = root.localStorage.getItem("oros-lang"); } catch (e) {} }
    return l || "en";
  }
  function t(key, vars) {
    var T = root.OROS_TRANSLATIONS || { en: {} }, l = lang(), tbl = T[l];
    if (!tbl && root.orosI18n && typeof root.orosI18n.table === "function") {
      try { tbl = root.orosI18n.table(T, "shell", l); } catch (e) { tbl = null; }
    }
    var s = (tbl && tbl[key] !== undefined) ? tbl[key] : (T.en && T.en[key] !== undefined ? T.en[key] : key);
    if (vars) Object.keys(vars).forEach(function (k) { s = s.split("{" + k + "}").join(String(vars[k])); });
    return s;
  }
  function locale() {
    var I = root.orosI18n;
    try { if (I && typeof I.locale === "function") return I.locale(lang()); } catch (e) {}
    return lang() === "el" ? "el-GR" : "en-GB";
  }

  var LOCK_SVG = '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15.5" r="1.3" fill="currentColor"/></svg>';

  var ui = null;           // { dlg, … } while locked
  var inerted = [];
  var watcher = null;
  var clockTimer = null;
  var view = "main";       // "main" | "forgot"
  var resetArmed = 0, resetting = false;

  function node(tag, cls, text) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function inertOne(n) {
    if (!n || n.nodeType !== 1 || (ui && n === ui.dlg)) return;
    if (n.tagName === "SCRIPT" || n.tagName === "STYLE") return;
    if (n.hasAttribute("inert")) return;
    n.setAttribute("inert", "");
    inerted.push(n);
  }
  // Another modal dialog opened after the lock would sit above it in
  // the top layer: put the lock back on top.
  function restack() {
    if (!ui || !ui.modal) return;
    ui.restacking = true;
    try { ui.dlg.close(); ui.dlg.showModal(); } catch (e) {}
    ui.restacking = false;
    focusField();
  }
  function guardStart() {
    Array.prototype.forEach.call(doc.body.children, inertOne);
    if (typeof root.MutationObserver !== "function") return;
    watcher = new root.MutationObserver(function (muts) {
      var again = false;
      muts.forEach(function (m) {
        if (m.type === "childList" && m.target === doc.body) {
          Array.prototype.forEach.call(m.addedNodes, inertOne);
        }
        if (m.type === "attributes" && m.target !== (ui && ui.dlg) &&
            m.target.tagName === "DIALOG" && m.target.hasAttribute("open")) again = true;
      });
      if (again) restack();
    });
    watcher.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["open"] });
  }
  function guardStop() {
    if (watcher) { watcher.disconnect(); watcher = null; }
    inerted.forEach(function (n) { n.removeAttribute("inert"); });
    inerted = [];
  }

  // Focus that sits inside an app frame leaves it (the frame is inert
  // from now on, but a caret could still blink there).
  function blurAll() {
    try {
      var ae = doc.activeElement;
      if (ae && ae.tagName === "IFRAME") {
        var inner = ae.contentWindow.document.activeElement;
        if (inner && inner.blur) inner.blur();
      }
      if (ae && ae.blur) ae.blur();
    } catch (e) {}
  }

  function focusField() {
    if (!ui) return;
    var f = view === "forgot" ? (ui.recInput || ui.rbtn) : (ui.bioBtn && !ui.bioBtn.disabled ? ui.bioBtn : ui.input);
    if (f && !f.disabled) { try { f.focus(); } catch (e) {} }
  }

  function paintClock() {
    if (!ui) return;
    var d = new Date(), loc = locale();
    try {
      ui.time.textContent = d.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" });
      ui.date.textContent = d.toLocaleDateString(loc, { weekday: "long", day: "numeric", month: "long" });
    } catch (e) {
      ui.time.textContent = d.toTimeString().slice(0, 5);
    }
  }

  function say(el, key, kind, vars) {
    if (!el) return;
    el.textContent = key ? t(key, vars) : "";
    el.className = "lk-msg" + (kind ? " lk-" + kind : "");
  }
  function sayWait(el) {
    var s = Math.ceil(waitMs() / 1000);
    if (s > 90) say(el, "lock.msg.waitMin", "err", { n: Math.ceil(s / 60) });
    else say(el, "lock.msg.wait", "err", { n: s });
  }

  function secretField(id, kind) {
    var inp = node("input", "lk-input");
    inp.id = id;
    inp.type = "password";
    inp.autocomplete = "off";
    inp.spellcheck = false;
    inp.setAttribute("autocapitalize", "off");
    if (kind === "pin") {
      inp.inputMode = "numeric";
      inp.maxLength = 12;
      inp.setAttribute("pattern", "[0-9]*");
    } else {
      inp.maxLength = SECRET_MAX;
    }
    return inp;
  }

  function build() {
    var dlg = node("dialog", "lk");
    dlg.id = "oros-lock";
    dlg.setAttribute("aria-labelledby", "oros-lock-title");
    var box = node("div", "lk-box");
    var clock = node("div", "lk-clock");
    var time = node("div", "lk-time");
    var date = node("div", "lk-date");
    clock.appendChild(time);
    clock.appendChild(date);
    box.appendChild(clock);
    var ico = node("div", "lk-ico");
    ico.innerHTML = LOCK_SVG;                          // static icon
    box.appendChild(ico);
    var title = node("h2", "lk-title", t("lock.title"));
    title.id = "oros-lock-title";
    box.appendChild(title);

    // Main view: PIN or passphrase.
    var main = node("form", "lk-view");
    main.setAttribute("autocomplete", "off");
    var kind = cfg ? cfg.kind : "pin";
    var bioBox = node("div", "lk-bio");
    main.appendChild(bioBox);
    var lab = node("label", "lk-label", t(kind === "pin" ? "lock.enterPin" : "lock.enterPass"));
    lab.htmlFor = "oros-lock-input";
    main.appendChild(lab);
    var input = secretField("oros-lock-input", kind);
    main.appendChild(input);
    var go = node("button", "lk-btn lk-primary", t("lock.unlock"));
    go.type = "submit";
    main.appendChild(go);
    var msg = node("p", "lk-msg");
    msg.setAttribute("role", "status");
    msg.setAttribute("aria-live", "polite");
    main.appendChild(msg);
    var forgot = node("button", "lk-link", t(kind === "pin" ? "lock.forgotPin" : "lock.forgotPass"));
    forgot.type = "button";
    main.appendChild(forgot);
    box.appendChild(main);

    // Forgot view: filled when it opens (sync.js loads after this file).
    var fv = node("div", "lk-view");
    fv.hidden = true;
    box.appendChild(fv);
    dlg.appendChild(box);

    main.addEventListener("submit", function (e) {
      e.preventDefault();
      var v = input.value;
      input.value = "";
      tryUnlock(v);
    });
    forgot.addEventListener("click", function () { show("forgot"); });
    // Esc must not close it; if a browser closes it anyway, it opens again.
    dlg.addEventListener("cancel", function (e) { e.preventDefault(); });
    dlg.addEventListener("close", function () {
      if (locked && ui && !ui.restacking) { try { dlg.showModal(); } catch (e) {} focusField(); }
    });
    return { dlg: dlg, time: time, date: date, main: main, input: input, msg: msg, fv: fv,
             kind: kind, recInput: null, recMsg: null, rbtn: null, modal: false, restacking: false,
             bioBox: bioBox, bioBtn: null, bioBusy: false, bioAsked: false };
  }

  // The sync passphrase (when this device is connected), else only
  // the reset of this device.
  function fillForgot() {
    var fv = ui.fv, kind = ui.kind;
    fv.textContent = "";
    fv.appendChild(node("h3", "lk-sub", t(kind === "pin" ? "lock.forgotPin" : "lock.forgotPass")));
    var S = root.orosSync;
    var canSync = false;
    try { canSync = !!(S && typeof S.checkPassphrase === "function" && S.isConnected()); } catch (e) {}
    ui.recInput = null;
    ui.recMsg = null;
    if (canSync) {
      var recForm = node("form", "lk-rec");
      recForm.setAttribute("autocomplete", "off");
      recForm.appendChild(node("p", "lk-hint", t("lock.rec.hint")));
      var rl = node("label", "lk-label", t("lock.rec.label"));
      rl.htmlFor = "oros-lock-rec";
      recForm.appendChild(rl);
      var recInput = secretField("oros-lock-rec", "pass");
      recForm.appendChild(recInput);
      var rgo = node("button", "lk-btn lk-primary", t("lock.rec.go"));
      rgo.type = "submit";
      recForm.appendChild(rgo);
      var recMsg = node("p", "lk-msg");
      recMsg.setAttribute("role", "status");
      recMsg.setAttribute("aria-live", "polite");
      recForm.appendChild(recMsg);
      recForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var v = recInput.value;
        recInput.value = "";
        tryRecover(v);
      });
      fv.appendChild(recForm);
      ui.recInput = recInput;
      ui.recMsg = recMsg;
    } else {
      fv.appendChild(node("p", "lk-hint", t("lock.rec.none")));
    }
    var rs = node("div", "lk-reset");
    rs.appendChild(node("p", "lk-hint", t("lock.reset.hint")));
    var rbtn = node("button", "lk-btn lk-danger", t("lock.reset"));
    rbtn.type = "button";
    rbtn.addEventListener("click", function () {
      if (resetting) return;
      if (Date.now() < resetArmed) {
        resetArmed = 0;
        resetDevice();
        return;
      }
      resetArmed = Date.now() + 10000;
      rbtn.textContent = t("lock.reset.confirm");
      rbtn.classList.add("lk-armed");
      setTimeout(function () {
        if (!ui || resetting || Date.now() < resetArmed) return;
        rbtn.textContent = t("lock.reset");
        rbtn.classList.remove("lk-armed");
      }, 10100);
    });
    rs.appendChild(rbtn);
    fv.appendChild(rs);
    ui.rbtn = rbtn;
    var back = node("button", "lk-link", t("lock.back"));
    back.type = "button";
    back.addEventListener("click", function () { show("main"); });
    fv.appendChild(back);
  }

  function show(v) {
    view = v;
    if (!ui) return;
    if (v === "forgot") { resetArmed = 0; fillForgot(); }
    ui.main.hidden = v !== "main";
    ui.fv.hidden = v !== "forgot";
    if (waitMs() && (v === "main" || ui.recMsg)) sayWait(v === "main" ? ui.msg : ui.recMsg);
    focusField();
  }

  function lock(reason) {
    if (locked || !cfg) return false;
    if (!doc.body) {
      doc.addEventListener("DOMContentLoaded", function () { lock(reason); });
      return false;
    }
    locked = true;
    clearSeen();
    view = "main";
    resetArmed = 0;
    blurAll();
    ui = build();
    doc.body.appendChild(ui.dlg);
    if (typeof ui.dlg.showModal === "function") {
      try { ui.dlg.showModal(); ui.modal = true; } catch (e) { ui.dlg.setAttribute("open", ""); }
    } else {
      ui.dlg.setAttribute("open", "");
    }
    guardStart();
    paintClock();
    clockTimer = setInterval(paintClock, 15000);
    bioWatch();
    fillBio();
    show("main");
    if (reason === "now" && bc) { try { bc.postMessage("lock"); } catch (e) {} }
    emit();
    return true;
  }

  function unlock() {
    if (!locked) return;
    locked = false;
    busy = false;
    clearInterval(clockTimer);
    clockTimer = null;
    guardStop();
    if (ui) {
      var d = ui.dlg;
      ui = null;               // the close handler sees no ui and lets it go
      try { if (d.open && typeof d.close === "function") d.close(); } catch (e) {}
      if (d.parentNode) d.parentNode.removeChild(d);
    }
    lastActive = Date.now();
    markSeen();
    emit();
  }

  function setBusy(on) {
    busy = on;
    if (!ui) return;
    Array.prototype.forEach.call(ui.dlg.querySelectorAll("button, input"), function (b) { b.disabled = on; });
    if (!on) focusField();
  }

  // The fingerprint button above the PIN, or why the PIN is asked.
  function fillBio() {
    if (!ui) return;
    var box = ui.bioBox, had = !!ui.bioBtn;
    box.textContent = "";
    ui.bioBtn = null;
    var r = bioRec();
    if (!r || !bioLinked()) return;
    if (bioDue(r, Date.now()) === "days") {
      box.appendChild(node("p", "lk-hint", t(ui.kind === "pass" ? "lock.bio.daysPass" : "lock.bio.days")));
      return;
    }
    if (!bioInfo() && !ui.bioAsked) {
      ui.bioAsked = true;
      try { phone().bio.refresh(); } catch (e) {}
    }
    if (!bioReady()) return;
    var k = bioKind();
    var b = node("button", "lk-btn lk-primary lk-bio-btn", t(k === "hello" ? "lock.bio.unlockHello" : k === "finger" ? "lock.bio.unlockFinger" : "lock.bio.unlock"));
    b.type = "button";
    b.addEventListener("click", tryBio);
    box.appendChild(b);
    ui.bioBtn = b;
    if (!had && view === "main" && !busy) focusField();
  }

  // Must run inside the tap: the app's prompt opens from an intent
  // link, which Chrome follows only on a user gesture.
  function tryBio() {
    if (busy || !ui || ui.bioBusy || !bioReady()) return;
    var r = bioRec(), p = phone(), b = ui.bioBtn;
    ui.bioBusy = true;
    if (b) b.disabled = true;
    say(ui.msg, bioKind() === "finger" ? "lock.bio.touch" : null, "dim");
    var asked;
    try { asked = p.bio.open(r.kid, "lock"); } catch (e) { asked = Promise.reject(e); }
    asked.then(function (d64) {
      var d;
      try { d = unb64(d64); } catch (e) { throw new Error("bio-wrong"); }
      return bioOpens(r, d).then(function (ok) {
        d.fill(0);
        if (!ok) throw new Error("bio-wrong");
      });
    }).then(function () {
      if (!ui) return;
      ui.bioBusy = false;
      clearTries();
      unlock();
    }, function (e) {
      if (!ui) return;
      ui.bioBusy = false;
      var c = bioCode(e);
      if (c === "invalidated" || c === "none" || c === "wrong") {
        bioForget();
        say(ui.msg, c === "invalidated" ? "lock.bio.err.invalidated" : bioKind() === "phone" ? "lock.bio.err.none" : "lock.bio.err.nonePc", "err");
      } else if (c === "cancel") {
        say(ui.msg, null);
      } else {
        say(ui.msg, c === "lockout" ? "lock.bio.err.lockout" : c === "timeout" ? "lock.bio.err.timeout" : "lock.bio.err.failed", "err");
      }
      fillBio();
      if (ui.bioBtn) ui.bioBtn.disabled = false;
      if (c !== "cancel") { try { ui.input.focus(); } catch (x) {} }
    });
  }

  function tryUnlock(secret) {
    if (busy || !ui) return;
    if (waitMs()) { sayWait(ui.msg); return; }
    if (!secret) { say(ui.msg, cfg && cfg.kind === "pass" ? "lock.msg.emptyPass" : "lock.msg.emptyPin", "err"); return; }
    if (!load()) { unlock(); return; }       // the lock was turned off in another tab
    setBusy(true);
    say(ui.msg, "lock.msg.checking", "dim");
    matches(cfg, secret).then(function (ok) {
      setBusy(false);
      if (ok) { clearTries(); bioTyped(); unlock(); return; }
      failOnce();
      if (!ui) return;
      if (waitMs()) sayWait(ui.msg);
      else say(ui.msg, cfg.kind === "pass" ? "lock.msg.wrongPass" : "lock.msg.wrongPin", "err");
    }, function () {
      setBusy(false);
      say(ui && ui.msg, "lock.msg.error", "err");
    });
  }

  function tryRecover(pw) {
    if (busy || !ui) return;
    if (waitMs()) { sayWait(ui.recMsg); return; }
    if (!pw) { say(ui.recMsg, "lock.msg.emptyPass", "err"); return; }
    var S = root.orosSync;
    if (!S || typeof S.checkPassphrase !== "function") { say(ui.recMsg, "lock.msg.cantCheck", "err"); return; }
    setBusy(true);
    say(ui.recMsg, "lock.msg.checking", "dim");
    Promise.resolve().then(function () { return S.checkPassphrase(pw); }).then(function (r) {
      setBusy(false);
      if (r === true) {
        clearTries();
        save(null);
        bioForget();
        unlock();
        if (hooks.recovered) { try { hooks.recovered(); } catch (e) {} }
        return;
      }
      if (!ui) return;
      if (r === false) {
        failOnce();
        if (waitMs()) sayWait(ui.recMsg);
        else say(ui.recMsg, "lock.msg.wrongSync", "err");
      } else {
        say(ui.recMsg, "lock.msg.cantCheck", "err");
      }
    }, function () {
      setBusy(false);
      say(ui && ui.recMsg, "lock.msg.cantCheck", "err");
    });
  }

  function resetDevice() {
    if (!ui || typeof hooks.reset !== "function") return;
    resetting = true;
    setBusy(true);
    ui.rbtn.textContent = t("lock.reset.working");
    try { hooks.reset(); } catch (e) {
      resetting = false;
      setBusy(false);
      ui.rbtn.textContent = t("lock.reset");
    }
  }

  // While locked: no shell shortcut (Ctrl+Alt+Shift+…, Ctrl+K) may run
  // behind the lock, and Tab stays inside it. Registered before
  // shell.js, so it runs first.
  root.addEventListener("keydown", function (e) {
    if (!locked) return;
    if (e.ctrlKey || e.altKey || e.metaKey) e.stopImmediatePropagation();
    if (e.key === "Tab" && ui) {
      var f = Array.prototype.filter.call(ui.dlg.querySelectorAll("input, button"), function (b) {
        return !b.disabled && b.offsetParent !== null;
      });
      if (!f.length) { e.preventDefault(); return; }
      var i = f.indexOf(doc.activeElement);
      if (i === -1 || (e.shiftKey && i === 0) || (!e.shiftKey && i === f.length - 1)) {
        e.preventDefault();
        f[e.shiftKey ? f.length - 1 : 0].focus();
      }
    }
  }, true);

  // ---------- 5. Public API + boot ----------
  function available() { return !!(subtle() && root.crypto.getRandomValues && root.btoa); }

  // Settings › Screen lock. Every call answers { ok, code }:
  // code = "pin" | "short" | "long" (new secret refused), "wrong"
  // (current one), "wait" (too many tries), "storage", "crypto".
  function guard(kind, secret) {
    if (!available()) return "crypto";
    if (busy) return "busy";
    return secretProblem(kind, secret) === "ok" ? "ok" : secretProblem(kind, secret);
  }
  function checkCurrent(current) {
    if (!load()) return Promise.resolve({ ok: true });
    if (waitMs()) return Promise.resolve({ ok: false, code: "wait", wait: waitMs() });
    return matches(cfg, current || "").then(function (ok) {
      if (ok) { clearTries(); return { ok: true }; }
      failOnce();
      return { ok: false, code: waitMs() ? "wait" : "wrong", wait: waitMs() };
    });
  }
  function run(p) {
    busy = true;
    emit();
    return p.then(function (r) { busy = false; emit(); return r; },
                  function () { busy = false; emit(); return { ok: false, code: "crypto" }; });
  }

  var api = {
    v: 1,
    core: Core,
    available: available,
    isOn: function () { return !!load(); },
    isLocked: function () { return locked; },
    snapshot: function () {
      var c = load();
      return { available: available(), on: !!c, kind: c ? c.kind : null,
               idle: c ? c.idle : DEFAULT_IDLE, hidden: c ? c.hidden : false,
               idles: IDLES.slice(), busy: busy, locked: locked, wait: waitMs() };
    },
    // Turn the lock on (no lock yet) with a new PIN / passphrase.
    enable: function (kind, secret) {
      var g = guard(kind, secret);
      if (g !== "ok") return Promise.resolve({ ok: false, code: g });
      if (load()) return Promise.resolve({ ok: false, code: "on" });
      return run(makeCfg(kind, secret, null).then(function (c) {
        if (!save(c)) return { ok: false, code: "storage" };
        if (bioRec()) bioForget();         // a leftover from a lock turned off elsewhere
        lastActive = Date.now();
        markSeen();
        return { ok: true };
      }));
    },
    // New PIN / passphrase: the current one first.
    change: function (current, kind, secret) {
      var g = guard(kind, secret);
      if (g !== "ok") return Promise.resolve({ ok: false, code: g });
      return run(checkCurrent(current).then(function (r) {
        if (!r.ok) return r;
        bioTyped();
        var prev = cfg;
        return makeCfg(kind, secret, prev).then(function (c) {
          return save(c) ? { ok: true } : { ok: false, code: "storage" };
        });
      }));
    },
    // Turn the lock off: the current one first.
    disable: function (current) {
      if (busy) return Promise.resolve({ ok: false, code: "busy" });
      return run(checkCurrent(current).then(function (r) {
        if (!r.ok) return r;
        if (!save(null)) return { ok: false, code: "storage" };
        bioForget();
        return { ok: true };
      }));
    },
    // "idle" (minutes, one of IDLES) or "hidden" (bool). No PIN asked:
    // the person is already past the lock.
    option: function (name, value) {
      var c = load();
      if (!c) return false;
      if (name === "idle" && IDLES.indexOf(Number(value)) !== -1) c.idle = Number(value);
      else if (name === "hidden") c.hidden = !!value;
      else return false;
      var ok = save(c);
      lastActive = Date.now();
      emit();
      return ok;
    },
    lock: function () { return lock("now"); },
    // Fingerprint or face on this phone (LK-BIO): Settings › Screen lock.
    bio: {
      // linked: the orOS app's bridge answers; can: what the phone says
      // (ok | none | no-hw | no-lock | old, null = not yet); on: this
      // page's record and the app's secret are both here; due: "ok" or
      // "days" (the PIN is asked first); at: the PIN last typed.
      state: function () {
        var r = bioRec(), info = bioInfo();
        return { linked: bioLinked(), can: info ? info.can : null,
                 on: !!(r && info && info.kids.indexOf(r.kid) >= 0), rec: !!r,
                 due: r ? bioDue(r, Date.now()) : "none", at: r ? r.at : 0, days: BIO_DAYS, kind: bioKind() };
      },
      refresh: function () { var p = phone(); try { return !!(p && p.bio.refresh()); } catch (e) { return false; } },
      // Turn on with the current PIN / passphrase. Must run inside the
      // tap: the phone's prompt opens first (it needs the gesture), then
      // the PIN is checked; a wrong one throws the new secret away.
      // { ok, code }: off | busy | wait | wrong | unavailable | cancel |
      // lockout | invalidated | timeout | failed | storage.
      enable: function (current) {
        if (!load()) return Promise.resolve({ ok: false, code: "off" });
        if (busy) return Promise.resolve({ ok: false, code: "busy" });
        if (waitMs()) return Promise.resolve({ ok: false, code: "wait", wait: waitMs() });
        if (!current) return Promise.resolve({ ok: false, code: "wrong" });
        var p = phone(), info = bioInfo();
        if (!p || !bioLinked() || !info || info.can !== "ok") return Promise.resolve({ ok: false, code: "unavailable" });
        var kid = bioKid(), asked;
        try { asked = p.bio.seal(kid, "lock"); } catch (e) { asked = Promise.reject(e); }
        busy = true;
        emit();
        return asked.then(function (d64) {
          var d = unb64(d64);
          return checkCurrent(current).then(function (r) {
            if (!r.ok) { d.fill(0); try { p.bio.clear(kid); } catch (e) {} return r; }
            return bioWrap(kid, d, Date.now()).then(function (rec) {
              d.fill(0);
              var old = bioRec();
              if (!bioStore(rec)) { try { p.bio.clear(kid); } catch (e) {} return { ok: false, code: "storage" }; }
              if (old && old.kid !== kid) { try { p.bio.clear(old.kid); } catch (e) {} }
              return { ok: true };
            });
          });
        }).then(null, function (e) {
          return { ok: false, code: bioCode(e) === "wrong" ? "failed" : bioCode(e) };
        }).then(function (r) {
          busy = false;
          try { p.bio.refresh(); } catch (e) {}
          emit();
          return r;
        });
      },
      // Turn off: no PIN asked (it only takes a way in away).
      disable: function () { bioForget(); var p = phone(); try { if (p) p.bio.refresh(); } catch (e) {} emit(); return true; }
    },
    onChange: function (fn) {
      if (typeof fn !== "function") return function () {};
      listeners.push(fn);
      return function () {
        var i = listeners.indexOf(fn);
        if (i !== -1) listeners.splice(i, 1);
      };
    },
    // The shell: reset = wipe this device (no cloud), recovered = the
    // sync passphrase opened it (the lock is off now).
    setHooks: function (h) {
      if (h && typeof h.reset === "function") hooks.reset = h.reset;
      if (h && typeof h.recovered === "function") hooks.recovered = h.recovered;
    }
  };
  root.orosLock = api;

  // Other tabs of orOS: "Lock now" locks them too; a lock turned off
  // (or changed) there is read again here.
  try {
    if (typeof root.BroadcastChannel === "function") {
      bc = new root.BroadcastChannel("oros-lock");
      bc.onmessage = function (e) { if (e && e.data === "lock") lock("remote"); };
    }
  } catch (e) { bc = null; }
  root.addEventListener("storage", function (e) {
    if (e.key !== KEY && e.key !== BIO_KEY && e.key !== null) return;
    load();
    if (!cfg && locked) unlock();
    emit();
  });

  ACTIVITY.forEach(function (ev) { root.addEventListener(ev, poke, { capture: true, passive: true }); });
  doc.addEventListener("visibilitychange", function () {
    if (!load() || locked) return;
    if (doc.visibilityState === "hidden") {
      if (cfg.hidden) lock("hidden");
      else markSeen();
    } else if (idleDue()) {
      lock("idle");
    }
  });
  root.addEventListener("pagehide", markSeen);
  setInterval(tick, 5000);

  // Start: locked, unless this same tab was open a moment ago (an
  // update reload, a return from the Dropbox sign-in).
  if (load()) {
    var seen = 0;
    try { seen = Number(root.sessionStorage.getItem(SEEN_KEY)) || 0; } catch (e) {}
    if (stillOpen(cfg, seen, Date.now())) lastActive = seen;
    else lock("start");
  }
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : null));
