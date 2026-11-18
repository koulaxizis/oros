// ============================================================
// orOS Core — ocrkit.js: copy text from a picture (LIVE-TEXT, v1.0.0)
// ------------------------------------------------------------
// The shared engine behind the Text button of Files (picture preview
// and Photos viewer), Screen Capture and Photo Lab. Text recognition
// itself is Tesseract.js (Apache-2.0, vendor/tesseract/, Greek +
// English), the same engine, files and browser cache as Scanner & PDF
// and Documents, so one download serves them all. It is loaded only
// when Text is pressed; nothing leaves the device.
//
// Loaded by an app on the first press (never at boot), next to the
// app's page: <app>/ → "../ocrkit.js?v=<version>". It loads
// ocrkit-ui.js + ocrkit-ui.css for open().
//
// API (window.OrosOcr, or module.exports in Node for the pure parts):
//   VERSION, FLAG, MIN_CONF, SIDE
//   wordsOf(data, iw, ih) -> [{ t, x, y, w, h, ln, pa }]
//       Tesseract's result data (blocks › paragraphs › lines › words,
//       bbox in pixels of the iw × ih picture read) as words in reading
//       order; x, y, w, h fractions of the picture, ln the line number
//       and pa the paragraph number (both count up from 0 over the
//       whole picture). Words under MIN_CONF are dropped.
//   textOf(words, idx?) -> string: the words (all, or the indices in
//       idx) as text: words of a line joined by a space, lines by "\n",
//       paragraphs by a blank line; a word broken at a line end
//       ("κεί-" + "μενο") is joined again.
//   between(words, a, b) -> indices a..b (reading order), either way.
//   lineOf(words, i) / paraOf(words, i) -> indices of i's line / paragraph.
//   inRect(words, r) -> indices of the words a rectangle { x, y, w, h }
//       (fractions) covers at least half of.
//   nearest(words, x, y) -> the index of the word under, or else
//       closest to, the point (fractions of the picture); -1 if none.
//   fit(w, h, side) -> the scale that puts the long side at `side`
//       (at most 2: small pictures are enlarged, which reads better).
//   links(text) -> ["https://…"]: up to MAX_LINKS web addresses in the
//       text (http(s):// or www.), trailing punctuation cut off.
//   chips(text, D, today) -> [{ k, v, label, ev? }] (wave W3): what the
//       text holds that another app can act on, in this order: k "url"
//       (links), "event" (the first day / time, D.event = send/
//       detect.js with calendar/quickadd.js), "email", "phone" (D.card
//       with contacts/cardtext.js) and one "contact" when there is a
//       phone or an e-mail. Without D only the links.
//   allowed() / allow(): the device-local yes to the engine download,
//       shared with Documents (FLAG).
//   read(source, o) -> Promise<{ words, text, w, h }>: source an
//       <img>, <canvas>, ImageBitmap or Blob; o { onStep(pct 0-100),
//       job: { stop } }. Errors carry code "offline" (the engine
//       could not be fetched), "stop" or "ocr".
//   release(): ends the worker (also after IDLE ms unused).
//   open(o) -> Promise<controller>: the Text mode over a picture on
//       screen (ocrkit-ui.js; o documented there).
// Rules: text recognised is data. It reaches the page only through
// textContent and the clipboard, never as HTML or code.
// ============================================================
(function (root) {
  "use strict";

  var VERSION = "1.0.0";
  var FLAG = "oros-files-docs-ocr";        // device-local "1": the download was agreed to (Documents' flag)
  var CACHE = "oros-scanpdf-ocr";          // Tesseract's data cache, shared with Scanner & PDF
  var MIN_CONF = 35;                       // words Tesseract is less sure of are noise on photos
  var SIDE = 2400;                         // pixels on the long side for recognition
  var IDLE = 90000;                        // the worker is let go after 90 s unused
  var MAX_WORDS = 6000;
  var LANGS = ["ell", "eng"];

  function arr(a) { return Array.isArray(a) ? a : []; }
  function num(n) { n = Number(n); return isFinite(n) ? n : 0; }
  function r5(n) { return Math.round(n * 100000) / 100000; }

  // Same clean-up as scanpdf/ocr.js: no control characters, NFC, and
  // the micro sign Tesseract sometimes reads for Greek mu.
  var GREEK = /[\u0370-\u03ff\u1f00-\u1fff]/;
  function fixText(s) {
    s = String(s == null ? "" : s);
    if (s.normalize) s = s.normalize("NFC");
    s = s.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, "").trim();
    if (s.indexOf("\u00b5") !== -1 && GREEK.test(s)) s = s.replace(/\u00b5/g, "\u03bc");
    return s;
  }

  function wordsOf(data, iw, ih) {
    iw = Math.max(1, num(iw)); ih = Math.max(1, num(ih));
    var out = [], ln = 0, pa = 0;
    arr(data && data.blocks).forEach(function (bl) {
      arr(bl && bl.paragraphs).forEach(function (p) {
        var any = false;
        arr(p && p.lines).forEach(function (l) {
          var lineAny = false;
          arr(l && l.words).forEach(function (w) {
            if (!w || !w.bbox || num(w.confidence) < MIN_CONF || out.length >= MAX_WORDS) return;
            var t = fixText(w.text), b = w.bbox;
            var x0 = num(b.x0), y0 = num(b.y0), x1 = num(b.x1), y1 = num(b.y1);
            if (!t || x1 <= x0 || y1 <= y0) return;
            out.push({ t: t, x: r5(x0 / iw), y: r5(y0 / ih), w: r5((x1 - x0) / iw), h: r5((y1 - y0) / ih), ln: ln, pa: pa });
            lineAny = any = true;
          });
          if (lineAny) ln++;
        });
        if (any) pa++;
      });
    });
    return out;
  }

  // A line that ends in a hyphen and a next line that starts with a
  // small letter: one word broken in two.
  var HY = /[-\u00ad\u2010]$/;
  var LOWER = /^[a-z\u00df-\u00ff\u03ac-\u03ce\u1f00-\u1fff]/;
  function textOf(words, idx) {
    words = arr(words);
    var list = idx ? arr(idx).filter(function (i) { return i >= 0 && i < words.length; }) : words.map(function (w, i) { return i; });
    list = list.slice().sort(function (a, b) { return a - b; }).filter(function (v, k, a) { return k === 0 || a[k - 1] !== v; });
    var s = "", prev = null;
    list.forEach(function (i) {
      var w = words[i];
      if (!w || typeof w.t !== "string") return;
      if (prev === null) s = w.t;
      else if (w.ln === prev.ln) s += " " + w.t;
      else if (HY.test(s) && LOWER.test(w.t) && w.pa === prev.pa) s = s.replace(HY, "") + w.t;
      else s += (w.pa === prev.pa ? "\n" : "\n\n") + w.t;
      prev = w;
    });
    return s;
  }

  function between(words, a, b) {
    var n = arr(words).length;
    if (!n || a < 0 || b < 0) return [];
    a = Math.min(a, n - 1); b = Math.min(b, n - 1);
    var lo = Math.min(a, b), hi = Math.max(a, b), out = [];
    for (var i = lo; i <= hi; i++) out.push(i);
    return out;
  }
  function sameField(words, i, key) {
    words = arr(words);
    if (!words[i]) return [];
    var v = words[i][key], out = [];
    words.forEach(function (w, k) { if (w[key] === v) out.push(k); });
    return out;
  }
  function lineOf(words, i) { return sameField(words, i, "ln"); }
  function paraOf(words, i) { return sameField(words, i, "pa"); }

  function inRect(words, r) {
    if (!r) return [];
    var rx0 = Math.min(r.x, r.x + r.w), rx1 = Math.max(r.x, r.x + r.w);
    var ry0 = Math.min(r.y, r.y + r.h), ry1 = Math.max(r.y, r.y + r.h), out = [];
    arr(words).forEach(function (w, i) {
      var ox = Math.max(0, Math.min(rx1, w.x + w.w) - Math.max(rx0, w.x));
      var oy = Math.max(0, Math.min(ry1, w.y + w.h) - Math.max(ry0, w.y));
      if (w.w > 0 && w.h > 0 && ox * oy >= 0.5 * w.w * w.h) out.push(i);
    });
    return out;
  }

  function nearest(words, x, y) {
    var best = -1, bd = Infinity;
    arr(words).forEach(function (w, i) {
      var dx = x < w.x ? w.x - x : x > w.x + w.w ? x - w.x - w.w : 0;
      var dy = y < w.y ? w.y - y : y > w.y + w.h ? y - w.y - w.h : 0;
      var d = dx * dx + dy * dy * 4;         // a word of another line is "further"
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }

  // ---------- W3: what the text holds ----------
  var MAX_LINKS = 3, MAX_EACH = 2;
  var URL_RE = /(?:https?:\/\/|www\.)[^\s<>"'\u00ab\u00bb\u201c\u201d]+/gi;
  var HOST_RE = /^[a-z0-9\u00a1-\uffff]([a-z0-9\u00a1-\uffff-]*[a-z0-9\u00a1-\uffff])?(\.[a-z0-9\u00a1-\uffff]([a-z0-9\u00a1-\uffff-]*[a-z0-9\u00a1-\uffff])?)+$/i;
  function links(text) {
    var out = [], m, src = String(text == null ? "" : text).slice(0, 20000);
    URL_RE.lastIndex = 0;
    while ((m = URL_RE.exec(src)) && out.length < MAX_LINKS) {
      var u = m[0].replace(/[.,;:!?\u00b7\u2026)\]}]+$/, "");
      if (/^www\./i.test(u)) u = "https://" + u;
      var hm = u.match(/^https?:\/\/([^\/?#:@]+)(:\d{1,5})?([\/?#]|$)/i);
      if (!hm || !HOST_RE.test(hm[1]) || !/[a-z\u00a1-\uffff]{2,}$/i.test(hm[1])) continue;
      if (u.length > 500 || out.indexOf(u) !== -1) continue;
      out.push(u);
    }
    return out;
  }
  function shortUrl(u) {
    var s = u.replace(/^https?:\/\//i, "").replace(/\/$/, "");
    return s.length > 40 ? s.slice(0, 39) + "\u2026" : s;
  }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function chips(text, D, today) {
    var out = [];
    links(text).forEach(function (u) { out.push({ k: "url", v: u, label: shortUrl(u) }); });
    if (!D) return out;
    var ev = null, card = null;
    try { ev = typeof D.event === "function" ? D.event(text, today) : null; } catch (e) { ev = null; }
    try { card = typeof D.card === "function" ? D.card(text) : null; } catch (e) { card = null; }
    if (ev && /^\d{4}-\d{2}-\d{2}$/.test(ev.date)) {
      var p = ev.date.split("-");
      out.push({ k: "event", v: ev.date, label: p[2] + "/" + p[1] + "/" + p[0] + (ev.start ? " " + ev.start : ""), ev: ev });
    }
    var any = false;
    if (card) {
      arr(card.emails).slice(0, MAX_EACH).forEach(function (e) {
        // the links found inside an address are not links of their own
        out = out.filter(function (c) { return !(c.k === "url" && e.indexOf(c.label) !== -1); });
        out.push({ k: "email", v: e, label: e.length > 40 ? e.slice(0, 39) + "\u2026" : e }); any = true;
      });
      arr(card.phones).slice(0, MAX_EACH).forEach(function (ph) {
        var v = String(ph).replace(/[^+0-9]/g, "");
        if (v.length >= 5) { out.push({ k: "phone", v: v, label: ph }); any = true; }
      });
    }
    if (any) out.push({ k: "contact", v: "", label: "" });
    return out;
  }

  function fit(w, h, side) {
    var m = Math.max(num(w), num(h));
    return m > 0 ? Math.min(2, (side || SIDE) / m) : 1;
  }

  var pure = { VERSION: VERSION, FLAG: FLAG, MIN_CONF: MIN_CONF, SIDE: SIDE, fixText: fixText,
    wordsOf: wordsOf, textOf: textOf, between: between, lineOf: lineOf, paraOf: paraOf,
    inRect: inRect, nearest: nearest, fit: fit, links: links, chips: chips };
  if (typeof module !== "undefined" && module.exports) { module.exports = pure; return; }
  if (root.OrosOcr && root.OrosOcr.VERSION) return;

  // ---------- browser: where the kit and the engine live ----------
  var HERE = (function () {
    var s = document.currentScript && document.currentScript.src;
    return s ? s.replace(/[?#].*$/, "").replace(/[^/]*$/, "") : new URL("../", location.href).href;
  })();
  var VQ = (function () {
    var m = ((document.currentScript && document.currentScript.src) || "").match(/[?&]v=([^&#]+)/);
    return m ? "?v=" + m[1] : "";
  })();
  var BASE = HERE + "vendor/tesseract/";

  function codeErr(c) { var e = new Error(c); e.code = c; return e; }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function allowed() { return lsGet(FLAG) === "1"; }
  function allow() { lsSet(FLAG, "1"); }

  var engineP = null, worker = null, workerP = null, idleT = 0, cur = null;
  function engine() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (engineP) return engineP;
    engineP = new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = BASE + "tesseract.min.js";
      s.onload = function () { window.Tesseract ? res(window.Tesseract) : rej(codeErr("ocr")); };
      s.onerror = function () { s.remove(); engineP = null; rej(codeErr("offline")); };
      document.head.appendChild(s);
    });
    return engineP;
  }
  function getWorker() {
    clearTimeout(idleT);
    if (worker) return Promise.resolve(worker);
    if (workerP) return workerP;
    workerP = engine().then(function (T) {
      return T.createWorker(LANGS, 1, {
        workerPath: BASE + "worker.min.js",
        corePath: BASE + "tesseract-core-lstm.js",
        langPath: BASE.replace(/\/$/, ""),
        workerBlobURL: false,
        cachePath: CACHE,
        logger: function (m) {
          if (!cur || !m || typeof m.progress !== "number") return;
          // loading the data counts as the first fifth, reading as the rest
          var p = m.status === "recognizing text" ? 20 + m.progress * 80 : m.progress * 20;
          try { cur(Math.max(0, Math.min(100, Math.round(p)))); } catch (e) {}
        }
      });
    }).then(function (w) { worker = w; workerP = null; return w; },
      function (e) { workerP = null; throw e && e.code ? e : codeErr("offline"); });
    return workerP;
  }
  function idle() { clearTimeout(idleT); idleT = setTimeout(release, IDLE); }
  function release() {
    clearTimeout(idleT);
    var w = worker;
    worker = null;
    if (w) try { w.terminate(); } catch (e) {}
  }

  // The picture as a canvas, white behind it, long side at SIDE.
  function canvasOf(src) {
    var p = (typeof Blob !== "undefined" && src instanceof Blob) || (src && /Blob|File/.test(Object.prototype.toString.call(src)))
      ? createImageBitmap(src) : Promise.resolve(src);
    return p.then(function (img) {
      var iw = img.naturalWidth || img.videoWidth || img.width || 0;
      var ih = img.naturalHeight || img.videoHeight || img.height || 0;
      if (!iw || !ih) throw codeErr("ocr");
      var k = fit(iw, ih, SIDE), cv = document.createElement("canvas");
      cv.width = Math.max(1, Math.round(iw * k)); cv.height = Math.max(1, Math.round(ih * k));
      var c = cv.getContext("2d");
      c.fillStyle = "#fff"; c.fillRect(0, 0, cv.width, cv.height);
      c.drawImage(img, 0, 0, cv.width, cv.height);
      if (img !== src && img.close) try { img.close(); } catch (e) {}
      return cv;
    });
  }

  var queue = Promise.resolve();
  function read(source, o) {
    o = o || {};
    var job = o.job || {};
    var run = function () {
      if (job.stop) throw codeErr("stop");
      return canvasOf(source).then(function (cv) {
        if (job.stop) throw codeErr("stop");
        cur = o.onStep || null;
        return getWorker().then(function (w) {
          if (job.stop) throw codeErr("stop");
          return new Promise(function (res, rej) {
            var done = false;
            // Tesseract cannot stop one picture midway: Stop ends the worker.
            var stopT = setInterval(function () {
              if (!job.stop || done) return;
              done = true; clearInterval(stopT);
              if (worker === w) release();
              rej(codeErr("stop"));
            }, 150);
            w.recognize(cv, {}, { text: true, blocks: true }).then(function (r) {
              if (done) return;
              done = true; clearInterval(stopT);
              var d = (r && r.data) || {}, words = wordsOf(d, cv.width, cv.height);
              res({ words: words, text: textOf(words), w: cv.width, h: cv.height });
            }, function (e) {
              if (done) return;
              done = true; clearInterval(stopT);
              rej(e && e.code ? e : codeErr("ocr"));
            });
          });
        });
      }).then(function (res) { cur = null; idle(); return res; }, function (e) { cur = null; idle(); throw e; });
    };
    var p = queue.then(run, run);
    queue = p.catch(function () {});
    return p;
  }

  // ---------- the Text mode (ocrkit-ui.js + .css, on first use) ----------
  var uiP = null;
  function ui() {
    if (window.OrosOcrUI) return Promise.resolve(window.OrosOcrUI);
    if (uiP) return uiP;
    uiP = new Promise(function (res, rej) {
      if (!document.querySelector("link[data-ocrkit]")) {
        var l = document.createElement("link");
        l.rel = "stylesheet"; l.href = HERE + "ocrkit-ui.css" + VQ; l.setAttribute("data-ocrkit", "1");
        document.head.appendChild(l);
      }
      var s = document.createElement("script");
      s.src = HERE + "ocrkit-ui.js" + VQ;
      s.onload = function () { window.OrosOcrUI ? res(window.OrosOcrUI) : rej(codeErr("ocr")); };
      s.onerror = function () { s.remove(); uiP = null; rej(codeErr("offline")); };
      document.head.appendChild(s);
    });
    return uiP;
  }
  function open(o) { return ui().then(function (U) { return U.open(o || {}, api); }); }

  var api = {};
  Object.keys(pure).forEach(function (k) { api[k] = pure[k]; });
  api.allowed = allowed; api.allow = allow; api.read = read; api.release = release; api.open = open;
  // W3: the readers of days, phones and e-mail addresses that "Send to…"
  // already uses (precached), loaded only when a text was found.
  var helpP = null;
  function helpers() {
    if (window.OrosSendDetect && window.OrosCalQuick && window.OrosContactsCard) return Promise.resolve(window.OrosSendDetect);
    if (helpP) return helpP;
    function load(src, has) {
      if (has()) return Promise.resolve();
      return new Promise(function (res) {
        var s = document.createElement("script");
        s.src = HERE + src + VQ;
        s.onload = res;
        s.onerror = function () { s.remove(); res(); };
        document.head.appendChild(s);
      });
    }
    helpP = Promise.all([
      load("calendar/quickadd.js", function () { return !!window.OrosCalQuick; }),
      load("contacts/cardtext.js", function () { return !!window.OrosContactsCard; })
    ]).then(function () { return load("send/detect.js", function () { return !!window.OrosSendDetect; }); })
      .then(function () { helpP = null; return window.OrosSendDetect || null; });
    return helpP;
  }
  api.helpers = helpers;
  root.OrosOcr = api;
})(typeof window !== "undefined" ? window : this);
