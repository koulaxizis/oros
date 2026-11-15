// ============================================================
// orOS Forms — publishing and picking up answers (forms/share.js,
// window.OrosFormsShare; FORMS-2). The app's side of relay/forms.js,
// through forms/pub.js:
//   publish   new keys on the first time (pub.js newKeys), the form
//             encrypted with the link key, "put" at the relay
//   setState  open / closed and the closing time ("upd")
//   unpublish "drop": the link stops working, waiting answers go
//   collect   "pull" → open each answer here → store(rows) (the app
//             saves them in the answers slice) → only then "ack"
//             (deleted at the relay). A row that can't be opened is
//             counted (bad) and deleted too: nobody can ever open it.
//   peek      how many answers wait (shell notices, forms/host.js)
//   pushOn    this device's push box wakes for new answers (relay
//             wake, webpush.js wakeToken / wakePacket); one wake token
//             per device for all forms; the packet is a fixed text
// Device-local, never synced: localStorage "oros-forms-dev"
//   { dev, wt?, pushed: { formId: 1 }, last: { formId: ms } }
// One device collects each form (x.dev); another can take over.
// ============================================================
(function (root) {
  "use strict";
  var P = root.OrosFormsPub, C = root.OrosFormsCore, E = root.OrosFormsEngine;
  var DEV_KEY = "oros-forms-dev";
  var MAX_PAGES = 10;

  function rnd(n) {
    var b = crypto.getRandomValues(new Uint8Array(n)), abc = "abcdefghijklmnopqrstuvwxyz0123456789", out = "";
    for (var i = 0; i < n; i++) out += abc.charAt(b[i] % abc.length);
    return out;
  }
  function devState() {
    var s = null;
    try { s = JSON.parse(localStorage.getItem(DEV_KEY) || "null"); } catch (e) {}
    if (!s || typeof s !== "object" || Array.isArray(s)) s = {};
    if (typeof s.dev !== "string" || !/^[a-z0-9]{6,20}$/.test(s.dev)) { s.dev = rnd(10); s.pushed = {}; s.last = {}; saveDev(s); }
    if (!s.pushed || typeof s.pushed !== "object") s.pushed = {};
    if (!s.last || typeof s.last !== "object") s.last = {};
    return s;
  }
  function saveDev(s) { try { localStorage.setItem(DEV_KEY, JSON.stringify(s)); } catch (e) {} }

  // The public page always talks to orOS's own relay (its CSP allows only
  // that one), so a form is published there whatever Mail uses.
  function formRelay() { return P.RELAY; }
  function callForm(body) {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return Promise.reject({ code: "offline" });
    return P.call(formRelay(), body);
  }

  // What the page gets: the form as people see it, the key answers are
  // sealed for, and the owner's language (the page's buttons).
  function defObj(rec, x, lang) {
    var f = E.normForm(rec);
    return { v: 1, form: { id: f.id, title: f.title, desc: f.desc, qs: f.qs, set: f.set }, pub: P.pubOf(x.priv), l: lang };
  }

  // → Promise<x> (the record's new x; the app commits it)
  function publish(rec, lang, now) {
    var made = rec.x ? Promise.resolve(null) : P.newKeys()["catch"](function () { throw { code: "crypto" }; });
    return made.then(function (keys) {
      var x = rec.x ? Object.assign({}, rec.x) :
        { k: keys.k, sec: keys.sec, key: keys.key, priv: keys.priv, open: 1, close: 0, at: now || Date.now(), dev: devState().dev };
      return P.encDef(x.key, x.k, defObj(rec, x, lang)).then(function (def) {
        if (def.length > 65536) throw { code: "big" };
        var body = { act: "put", k: x.k, sec: x.sec, def: def, open: x.open === 0 ? 0 : 1 };
        if (x.close) body.close = x.close;
        return callForm(body).then(function () {
          x.pubH = C.fingerprint(rec);
          if (x.open) delete x.rep;
          return x;
        });
      });
    });
  }
  function setState(rec, st) {
    var x = Object.assign({}, rec.x), body = { act: "upd", k: x.k, sec: x.sec };
    if (st.open === 0 || st.open === 1) { body.open = st.open; x.open = st.open; if (st.open) delete x.rep; }
    if (typeof st.close === "number") { body.close = st.close; x.close = st.close; }
    return callForm(body).then(function () { return x; });
  }
  function unpublish(rec) {
    var x = rec.x;
    var st = devState();
    var wasPushed = !!st.pushed[rec.id];
    delete st.pushed[rec.id];
    delete st.last[rec.id];
    saveDev(st);
    if (wasPushed) dropTokenIfUnused();
    return callForm({ act: "drop", k: x.k, sec: x.sec })["catch"](function (e) {
      if (!(e && e.code === "gone")) throw e;                    // already gone at the relay
    });
  }
  function peek(rec) {
    var x = rec.x;
    return callForm({ act: "peek", k: x.k, sec: x.sec });
  }

  // Fetch, open, store, then delete at the relay (only once stored).
  // store(rows) → true when saved. → { added, bad, open, rep, taken }
  var busy = {};
  function collect(rec, store) {
    if (busy[rec.id]) return busy[rec.id];
    var x = rec.x, tally = { added: 0, bad: 0, open: x.open, rep: x.rep ? 1 : 0, taken: 0 };
    var p = Promise.resolve().then(function () {
      function page(n) {
        return callForm({ act: "pull", k: x.k, sec: x.sec, after: 0 }).then(function (res) {
          tally.open = res.open; tally.rep = res.rep; tally.taken = res.taken | 0;
          var rows = Array.isArray(res.rows) ? res.rows : [];
          if (!rows.length) return;
          var opened = [];
          return rows.reduce(function (q, r) {
            return q.then(function () {
              return P.open(x.priv, r.v).then(function (o) {
                if (!o || typeof o !== "object") { tally.bad++; return; }
                var row = { id: x.k + "." + r.id, at: r.at, a: o.a };
                if (r.w) row.w = 1;
                if (typeof o.l === "string") row.l = o.l;
                opened.push(row);
              }, function () { tally.bad++; });
            });
          }, Promise.resolve()).then(function () {
            var added = store(opened);
            if (added === false) throw { code: "full" };
            tally.added += typeof added === "number" ? added : opened.length;
            return callForm({ act: "ack", k: x.k, sec: x.sec, upto: rows[rows.length - 1].id });
          }).then(function () { if (res.more && n < MAX_PAGES) return page(n + 1); });
        });
      }
      return page(1);
    }).then(function () {
      var st = devState();
      st.last[rec.id] = Date.now();
      saveDev(st);
      // what forms/host.js counted as waiting is here now (Today, notices)
      try {
        var w = JSON.parse(localStorage.getItem("oros-forms-wait") || "null");
        if (w && typeof w === "object" && w[rec.id]) { delete w[rec.id]; localStorage.setItem("oros-forms-wait", JSON.stringify(w)); }
      } catch (e) {}
      return tally;
    });
    busy[rec.id] = p;
    p.then(function () { delete busy[rec.id]; }, function () { delete busy[rec.id]; });
    return p;
  }
  function lastCheck(id) { return devState().last[id] || 0; }

  // ---------- push (this device, orOS closed) ----------
  function pushApi() {
    try { return (root.parent && root.parent !== root && root.parent.orosPush) || root.orosPush || null; } catch (e) { return root.orosPush || null; }
  }
  function pushReady() { var p = pushApi(); return !!(p && p.enabled && p.enabled() && p.deviceId && p.deviceId()); }
  function pushed(id) { return !!devState().pushed[id]; }
  // words: { title, body } (fixed text: no form name, no answer)
  function pushOn(rec, on, words) {
    var x = rec.x, st = devState();
    if (!on) {
      delete st.pushed[rec.id];
      saveDev(st);
      return callForm({ act: "upd", k: x.k, sec: x.sec, push: null }).then(function () { dropTokenIfUnused(); });
    }
    var pp = pushApi();
    if (!pushReady()) return Promise.reject({ code: "pushoff" });
    var wt = st.wt ? Promise.resolve(st.wt) : pp.wakeToken();
    return wt.then(function (token) {
      st.wt = token;
      saveDev(st);
      return pp.wakePacket("forms", words.title, words.body, "system:open:forms").then(function (ct) {
        return callForm({ act: "upd", k: x.k, sec: x.sec, push: { pid: pp.deviceId(), wt: token, ct: ct } });
      });
    }).then(function () {
      var s2 = devState();
      s2.pushed[rec.id] = 1;
      s2.wt = st.wt;
      saveDev(s2);
    });
  }
  function dropTokenIfUnused() {
    var st = devState();
    if (!st.wt || Object.keys(st.pushed).length) return;
    var pp = pushApi(), wt = st.wt;
    delete st.wt;
    saveDev(st);
    try { if (pp && pp.dropWake) pp.dropWake(wt)["catch"](function () {}); } catch (e) {}
  }

  // ---------- link, embed, QR ----------
  function link(x) { return P.link(x.k, x.key); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]; });
  }
  function embed(x, title) {
    return "<iframe src=\"" + esc(link(x)) + "\" title=\"" + esc(title || "Form") + "\" width=\"100%\" height=\"900\" " +
      "style=\"border:0;max-width:720px\" loading=\"lazy\" referrerpolicy=\"no-referrer\"></iframe>";
  }
  var qrLoad = null;
  function qrLib() {
    if (root.orosQR) return Promise.resolve(root.orosQR);
    if (!qrLoad) {
      qrLoad = new Promise(function (resolve, reject) {
        var s = document.createElement("script");
        s.src = "../qr/qr-encode.js";
        s.onload = function () { root.orosQR ? resolve(root.orosQR) : reject(new Error("qr")); };
        s.onerror = function () { qrLoad = null; reject(new Error("qr")); };
        document.head.appendChild(s);
      });
    }
    return qrLoad;
  }
  // → Promise<data: URL of an SVG>
  function qrUrl(text) {
    return qrLib().then(function (Q) {
      var qr = Q.encode(text, { ecl: "M" });
      return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(Q.svg(qr, { margin: 4, scale: 6 }));
    });
  }

  root.OrosFormsShare = {
    dev: function () { return devState().dev; }, publish: publish, setState: setState, unpublish: unpublish,
    collect: collect, peek: peek, lastCheck: lastCheck, pushReady: pushReady, pushed: pushed, pushOn: pushOn,
    link: link, embed: embed, qrUrl: qrUrl, defObj: defObj, DEV_KEY: DEV_KEY
  };
})(window);
