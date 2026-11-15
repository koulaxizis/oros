// ============================================================
// orOS Forms — new-answer notices with the Forms window closed
// (forms/host.js, FORMS-2). Runs in the SHELL window (index.html loads
// it after notifications.js).
//   - every 10 minutes while orOS is open and online (first ~30 s after
//     start, again when the tab comes back): for each published form
//     this device picks up (x.dev = this device, forms/share.js), one
//     relay "peek" (relay/forms.js): how many answers wait. Nothing is
//     fetched or opened here; Forms picks them up when it opens.
//   - more waiting than at the last check → one orOS notice per form,
//     key "w:<formId>:<n>", deep link "system:open:forms"
//   - device-local "oros-forms-wait" { formId: { n, at } }: the counts,
//     read by Today (forms/today.js); never synced
//   - Forms open in this shell: it checks itself, so nothing here
// Reads oros-forms-data (the synced slice) and oros-forms-dev (this
// device's id); writes only oros-forms-wait. orOS closed = Web Push
// (the relay wakes the device's push box), not this file.
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-forms-data", DEV_KEY = "oros-forms-dev", WAIT_KEY = "oros-forms-wait";
  var RELAY = "https://oros-mail-relay.koulaxizis.workers.dev";   // = forms/pub.js
  var EVERY_MS = 10 * 60000, CALL_TIMEOUT = 20000;
  var K_RE = /^[a-z0-9]{16}$/, SEC_RE = /^[A-Za-z0-9]{32}$/;
  var W = {
    en: { "host.title": "New answers: {x}", "host.body1": "1 answer is waiting. Open Forms to pick it up.", "host.body": "{n} answers are waiting. Open Forms to pick them up.", "host.untitled": "Untitled form" },
    el: { "host.title": "Νέες απαντήσεις: {x}", "host.body1": "1 απάντηση περιμένει. Άνοιξε τις Φόρμες για να την παραλάβεις.", "host.body": "{n} απαντήσεις περιμένουν. Άνοιξε τις Φόρμες για να τις παραλάβεις.", "host.untitled": "Φόρμα χωρίς τίτλο" }
  };

  // ---------- pure ----------
  // The forms this device picks up: [{ id, title, k, sec }]
  function mine(data, dev) {
    var out = [];
    ((data && data.forms) || []).forEach(function (r) {
      var x = r && !r.del && r.x;
      if (!x || x.dev !== dev || !K_RE.test(x.k || "") || !SEC_RE.test(x.sec || "")) return;
      out.push({ id: r.id, title: typeof r.title === "string" ? r.title : "", k: x.k, sec: x.sec });
    });
    return out;
  }
  // A notice is due when more wait than last time (a pick-up resets it).
  function shouldTell(prev, n) { return n > 0 && n > ((prev && prev.n) | 0); }

  var api = { v: 1, mine: mine, shouldTell: shouldTell, W: W };
  if (typeof module === "object" && module.exports) { module.exports = api; return; }
  if (!root || !root.document || root.__orosFormsHost) return;
  root.__orosFormsHost = api;

  // ---------- shell ----------
  function read(key) { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (e) { return null; } }
  function lang() {
    var I = root.orosI18n, l = I ? I.lang() : (root.orosLang || "en");
    if (!W[l] && I) I.table(W, "forms", l);
    return W[l] ? l : "en";
  }
  function tr(k, p) {
    var s = (W[lang()] || W.en)[k] || W.en[k];
    Object.keys(p || {}).forEach(function (x) { s = s.split("{" + x + "}").join(String(p[x])); });
    return s;
  }
  function formsOpen() {
    var docs = [];
    try {
      if (typeof root.__orosAppDocs === "function") docs = root.__orosAppDocs() || [];
      else {
        var f = root.document.getElementById("app-frame");
        if (f && f.contentDocument) docs = [f.contentDocument];
      }
    } catch (e) { return false; }
    for (var i = 0; i < docs.length; i++) {
      try {
        var w = docs[i].defaultView;
        if (w && /\/forms\/(index\.html)?$/.test(w.location.pathname) && w.OrosFormsShare) return true;
      } catch (e2) {}
    }
    return false;
  }
  function peek(f) {
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, CALL_TIMEOUT);
    return fetch(RELAY + "/v1", { method: "POST", headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ op: "frm", act: "peek", k: f.k, sec: f.sec }),
                                  signal: ctl.signal, credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" })
      .then(function (r) { return r.json(); })
      .then(function (j) { clearTimeout(timer); return j && j.ok && j.data ? j.data : null; },
            function () { clearTimeout(timer); return null; });
  }
  var busy = false, lastAt = 0, timer = 0;
  function check() {
    clearTimeout(timer);
    timer = setTimeout(check, EVERY_MS);
    if (busy || navigator.onLine === false || formsOpen()) return;
    var dev = (read(DEV_KEY) || {}).dev;
    if (typeof dev !== "string" || !dev) return;
    var list = mine(read(KEY), dev);
    if (!list.length) return;
    busy = true;
    lastAt = Date.now();
    var wait = read(WAIT_KEY);
    if (!wait || typeof wait !== "object" || Array.isArray(wait)) wait = {};
    var next = {};
    list.reduce(function (p, f) {
      return p.then(function () {
        return peek(f).then(function (d) {
          if (!d || typeof d.n !== "number") { if (wait[f.id]) next[f.id] = wait[f.id]; return; }
          if (shouldTell(wait[f.id], d.n)) notice(f, d.n);
          if (d.n > 0) next[f.id] = { n: d.n, at: Date.now() };
        });
      });
    }, Promise.resolve()).then(function () {
      try { localStorage.setItem(WAIT_KEY, JSON.stringify(next)); } catch (e) {}
      busy = false;
    }, function () { busy = false; });
  }
  function notice(f, n) {
    var N = root.orosNotifs;
    if (!N || typeof N.emit !== "function") return;
    try {
      N.emit({ ns: "forms", key: "w:" + f.id + ":" + n, type: "reminder", title: tr("host.title", { x: f.title || tr("host.untitled") }),
               body: n === 1 ? tr("host.body1") : tr("host.body", { n: n }), deepLink: "system:open:forms", ttlDays: 7 });
    } catch (e) {}
  }
  function soon() { if (Date.now() - lastAt > 60000) check(); }
  timer = setTimeout(check, 30000);
  root.addEventListener("online", soon);
  root.document.addEventListener("visibilitychange", function () { if (root.document.visibilityState === "visible") soon(); });
})(typeof window !== "undefined" ? window : globalThis);
