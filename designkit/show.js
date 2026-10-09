// ============================================================
// orOS designkit — show.js (slide show player, v1.0.0)
// Plays a sequence of slides full screen: keyboard, clicker, touch,
// transitions, black/white screen, jump to a number, laser pointer,
// speaker notes, presenter view on a second window and rehearsal
// timings. It does NOT know what a slide looks like: the caller
// passes renderSlide(index, canvas, cssW, cssH) and draws (designkit
// render.js in Slides; Atelier's presentation mode can reuse it).
//
// Owner: the Slides (Presentations) thread. Other designkit files:
// model/text/render/pdf/assets.js (Layout), media/fx.js (Atelier).
//
// Pure parts (keyAction, Nav, fmtClock, fmtElapsed, summary) work in
// Node for the tests; start() needs a DOM.
//
// API (window.orosDK.show like the other designkit modules, or
// module.exports under Node):
//   start(opts) -> controller { go(i), next(), prev(), close(), state() }
//   opts: {
//     count, renderSlide(i, canvas, cssW, cssH), aspect (w/h, default 16/9),
//     hidden: [bool], notes(i) -> string, title(i) -> string,
//     transition(i) -> "none"|"fade"|"slide"|"push"|"zoom",
//     startAt (index), lang ("en"|"el"), presenter (bool),
//     doc (default: document), onEnd(summary)
//   }
//   onEnd gets { total, per: [{ index, ms }] }: time on each slide, so
//   every show doubles as a rehearsal.
//   start() must run inside a user gesture (full screen and the
//   presenter window both need one).
// ============================================================
(function (root) {
  "use strict";

  var STRINGS = {
    en: {
      next: "Next", prev: "Previous", end: "End show", notes: "Notes", noNotes: "No notes for this slide.",
      endOfShow: "End of slide show. Click or press any key to exit.",
      slideOf: "Slide {n} of {t}", elapsed: "Elapsed", pause: "Pause", resume: "Resume", reset: "Reset",
      black: "Black screen", nextUp: "Next", lastSlide: "End of show", clock: "Time",
      fsHint: "Click here for full screen. Move this window to the projector first.",
      popupBlocked: "The second window was blocked, so the show runs here. Allow pop-ups for the presenter view.",
      help: "Help", helpTitle: "Keys",
      helpRows: [
        ["→  Space  PageDown  click", "Next"],
        ["←  Backspace  PageUp", "Previous"],
        ["Home / End", "First / last slide"],
        ["number + Enter", "Go to slide"],
        ["B / W", "Black / white screen"],
        ["L", "Laser pointer"],
        ["N", "Speaker notes"],
        ["Esc", "End show"]
      ],
      bigger: "Larger notes", smaller: "Smaller notes", laser: "Laser pointer", close: "Close"
    },
    el: {
      next: "Επόμενη", prev: "Προηγούμενη", end: "Τέλος προβολής", notes: "Σημειώσεις", noNotes: "Αυτή η διαφάνεια δεν έχει σημειώσεις.",
      endOfShow: "Τέλος της προβολής. Πάτησε ένα πλήκτρο ή κάνε κλικ για έξοδο.",
      slideOf: "Διαφάνεια {n} από {t}", elapsed: "Χρόνος", pause: "Παύση", resume: "Συνέχεια", reset: "Μηδενισμός",
      black: "Μαύρη οθόνη", nextUp: "Επόμενη", lastSlide: "Τέλος προβολής", clock: "Ώρα",
      fsHint: "Κάνε κλικ εδώ για πλήρη οθόνη. Πρώτα μετακίνησε αυτό το παράθυρο στον προβολέα.",
      popupBlocked: "Το δεύτερο παράθυρο μπλοκαρίστηκε, οπότε η προβολή γίνεται εδώ. Επίτρεψε τα αναδυόμενα παράθυρα για το presenter view.",
      help: "Βοήθεια", helpTitle: "Πλήκτρα",
      helpRows: [
        ["→  Space  PageDown  κλικ", "Επόμενη"],
        ["←  Backspace  PageUp", "Προηγούμενη"],
        ["Home / End", "Πρώτη / τελευταία"],
        ["αριθμός + Enter", "Μετάβαση σε διαφάνεια"],
        ["B / W", "Μαύρη / λευκή οθόνη"],
        ["L", "Δείκτης laser"],
        ["N", "Σημειώσεις ομιλητή"],
        ["Esc", "Τέλος προβολής"]
      ],
      bigger: "Μεγαλύτερα γράμματα", smaller: "Μικρότερα γράμματα", laser: "Δείκτης laser", close: "Κλείσιμο"
    }
  };
  var TRANSITIONS = ["none", "fade", "slide", "push", "zoom"];
  var DUR = 450;

  // ---------- Pure: keys ----------
  // Layout-agnostic where it matters: letters by e.code (KeyB works
  // under the Greek layout too, R12), the rest by e.key. Clickers send
  // PageUp/PageDown (some send arrows, B or "." for black).
  function keyAction(key, code) {
    switch (key) {
      case "ArrowRight": case "ArrowDown": case "PageDown": case " ": case "Spacebar": case "Enter": case "MediaTrackNext":
        return key === "Enter" ? "enter" : "next";
      case "ArrowLeft": case "ArrowUp": case "PageUp": case "Backspace": case "MediaTrackPrevious":
        return "prev";
      case "Home": return "first";
      case "End": return "last";
      case "Escape": case "Esc": return "end";
      case ".": return "black";
      case ",": return "white";
      case "?": return "help";
    }
    if (/^[0-9]$/.test(key)) return "digit:" + key;
    switch (code) {
      case "KeyB": return "black";
      case "KeyW": return "white";
      case "KeyL": return "laser";
      case "KeyN": return "notes";
      case "KeyH": return "help";
      case "KeyP": return "prev";
    }
    return null;
  }

  // ---------- Pure: navigation over visible slides ----------
  // pos runs over the visible slides; pos === order.length is the
  // "end of show" screen.
  function Nav(count, hidden, startAt) {
    var order = [];
    for (var i = 0; i < count; i++) if (!(hidden && hidden[i])) order.push(i);
    this.order = order;
    this.pos = 0;
    if (typeof startAt === "number") {
      for (var k = 0; k < order.length; k++) if (order[k] >= startAt) { this.pos = k; break; }
    }
  }
  Nav.prototype.index = function () { return this.pos < this.order.length ? this.order[this.pos] : -1; };
  Nav.prototype.atEnd = function () { return this.pos >= this.order.length; };
  Nav.prototype.nextIndex = function () { return this.pos + 1 < this.order.length ? this.order[this.pos + 1] : -1; };
  Nav.prototype.next = function () { if (this.pos < this.order.length) { this.pos++; return true; } return false; };
  Nav.prototype.prev = function () { if (this.pos > 0) { this.pos--; return true; } return false; };
  Nav.prototype.first = function () { var c = this.pos !== 0; this.pos = 0; return c; };
  Nav.prototype.last = function () {
    var p = Math.max(0, this.order.length - 1), c = this.pos !== p; this.pos = p; return c;
  };
  // 1-based number among the visible slides.
  Nav.prototype.goNumber = function (n) {
    if (!(n >= 1 && n <= this.order.length)) return false;
    var c = this.pos !== n - 1; this.pos = n - 1; return c;
  };
  // Jump to a slide index (hidden slides: the next visible one).
  Nav.prototype.goIndex = function (i) {
    for (var k = 0; k < this.order.length; k++) if (this.order[k] >= i) { var c = this.pos !== k; this.pos = k; return c; }
    return false;
  };

  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function fmtElapsed(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return (h ? h + ":" + pad2(m) : m) + ":" + pad2(s % 60);
  }
  function fmtClock(d) { return pad2(d.getHours()) + ":" + pad2(d.getMinutes()); }
  // Rehearsal: time per slide index, in the order first shown.
  function summary(times, total) {
    var per = Object.keys(times).map(function (k) { return { index: Number(k), ms: times[k] }; })
      .sort(function (a, b) { return a.index - b.index; });
    return { total: total, per: per };
  }

  // ---------- DOM ----------
  var CSS = [
    ".oshow{position:fixed;inset:0;z-index:2147483000;background:#000;color:#fff;font:15px/1.4 system-ui,-apple-system,'Segoe UI',Roboto,'Noto Sans',sans-serif;",
    "  user-select:none;-webkit-user-select:none;touch-action:none;overflow:hidden;outline:none}",
    ".oshow-stage{position:absolute;overflow:hidden;background:#000}",
    ".oshow-stage canvas{position:absolute;inset:0;width:100%;height:100%;display:block}",
    ".oshow-blank{position:absolute;inset:0;display:none}",
    ".oshow-endmsg{position:absolute;inset:0;display:none;align-items:center;justify-content:center;text-align:center;padding:24px;color:#bbb;background:#000}",
    ".oshow-laser{position:absolute;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;background:#ff2a2a;",
    "  box-shadow:0 0 10px 4px rgba(255,40,40,.6);pointer-events:none;display:none}",
    ".oshow-num{position:absolute;right:16px;top:16px;padding:6px 12px;border-radius:8px;background:rgba(0,0,0,.7);font-size:22px;display:none}",
    ".oshow-toast{position:absolute;left:50%;bottom:72px;transform:translateX(-50%);max-width:min(92%,560px);padding:10px 14px;border-radius:10px;",
    "  background:rgba(20,20,20,.92);color:#fff;text-align:center;display:none}",
    ".oshow-bar{position:absolute;left:50%;bottom:12px;transform:translateX(-50%);display:flex;gap:6px;padding:6px;border-radius:14px;",
    "  background:rgba(20,20,20,.82);opacity:0;transition:opacity .25s;pointer-events:none}",
    ".oshow-bar.on{opacity:1;pointer-events:auto}",
    ".oshow button{min-width:44px;min-height:44px;border:0;border-radius:10px;background:transparent;color:#fff;font:inherit;cursor:pointer;padding:0 10px}",
    ".oshow button:hover,.oshow button:focus-visible{background:rgba(255,255,255,.14);outline:none}",
    ".oshow-count{align-self:center;padding:0 6px;color:#ccc;font-variant-numeric:tabular-nums;white-space:nowrap}",
    ".oshow-notes{position:absolute;left:0;right:0;bottom:0;max-height:45%;overflow:auto;padding:16px 16px 72px;background:rgba(0,0,0,.84);",
    "  white-space:pre-wrap;display:none;font-size:18px}",
    ".oshow-help{position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.7)}",
    ".oshow-help>div{background:#1b1b1b;border-radius:14px;padding:18px 20px;max-width:92%;max-height:90%;overflow:auto}",
    ".oshow-help table{border-collapse:collapse}.oshow-help td{padding:4px 10px;vertical-align:top}.oshow-help td:first-child{color:#9cf;white-space:nowrap}",
    ".oshow-fs{position:absolute;inset:0;display:flex;align-items:flex-end;justify-content:center;padding-bottom:28px;cursor:pointer}",
    ".oshow-fs span{background:rgba(20,20,20,.9);padding:10px 16px;border-radius:10px;max-width:92%;text-align:center}",
    // Presenter view
    ".oshow-pv{position:absolute;inset:0;display:grid;grid-template-columns:minmax(0,3fr) minmax(0,2fr);grid-template-rows:auto minmax(0,1fr) auto;",
    "  gap:12px;padding:12px;background:#121212}",
    ".oshow-pv-top{grid-column:1/3;display:flex;gap:16px;align-items:center;flex-wrap:wrap}",
    ".oshow-pv-big{font-size:28px;font-variant-numeric:tabular-nums}",
    ".oshow-pv-cur{position:relative;min-height:0;display:flex;align-items:center;justify-content:center}",
    ".oshow-pv-side{display:flex;flex-direction:column;gap:10px;min-height:0}",
    ".oshow-pv-next{position:relative;flex:0 0 auto;aspect-ratio:16/9;background:#000;border-radius:6px;overflow:hidden}",
    ".oshow-pv-next canvas{width:100%;height:100%;display:block}",
    ".oshow-pv-notes{flex:1 1 auto;overflow:auto;background:#1c1c1c;border-radius:8px;padding:12px;white-space:pre-wrap;font-size:20px;user-select:text;-webkit-user-select:text}",
    ".oshow-pv-ctl{grid-column:1/3;display:flex;gap:6px;flex-wrap:wrap;align-items:center}",
    ".oshow-pv .oshow-stage{position:relative;border-radius:6px}",
    ".oshow-muted{color:#9a9a9a}",
    "@media (max-width:760px){.oshow-pv{grid-template-columns:1fr;grid-template-rows:auto auto auto minmax(0,1fr) auto}",
    "  .oshow-pv-top,.oshow-pv-ctl{grid-column:1}.oshow-pv-cur{height:38vh}}"
  ].join("\n");

  function el(doc, tag, cls, text) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function addStyle(doc) {
    if (doc.getElementById("oshow-style")) return;
    var st = doc.createElement("style");
    st.id = "oshow-style";
    st.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(st);
  }
  function reducedMotion(win) {
    try { return !!(win.matchMedia && win.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { return false; }
  }
  function fsElement(doc) { return doc.fullscreenElement || doc.webkitFullscreenElement || null; }
  function requestFs(node) {
    try {
      var f = node.requestFullscreen || node.webkitRequestFullscreen;
      if (!f) return false;
      var p = f.call(node);
      if (p && p.catch) p.catch(function () {});
      return true;
    } catch (e) { return false; }
  }
  function exitFs(doc) {
    try {
      if (!fsElement(doc)) return;
      var f = doc.exitFullscreen || doc.webkitExitFullscreen;
      var p = f && f.call(doc);
      if (p && p.catch) p.catch(function () {});
    } catch (e) { /* already out */ }
  }

  // A stage: two canvases (for transitions), blank cover, end message,
  // laser dot. Fits the largest box of the aspect inside `box`.
  function Stage(doc, parent, aspect, endText) {
    this.doc = doc;
    this.aspect = aspect;
    this.node = el(doc, "div", "oshow-stage");
    this.a = el(doc, "canvas");
    this.b = el(doc, "canvas");
    this.blank = el(doc, "div", "oshow-blank");
    this.endMsg = el(doc, "div", "oshow-endmsg", endText);
    this.laser = el(doc, "div", "oshow-laser");
    this.node.appendChild(this.a);
    this.node.appendChild(this.b);
    this.node.appendChild(this.endMsg);
    this.node.appendChild(this.blank);
    this.node.appendChild(this.laser);
    this.front = this.b;
    parent.appendChild(this.node);
  }
  Stage.prototype.fit = function (bw, bh, absolute) {
    var w = bw, h = bw / this.aspect;
    if (h > bh) { h = bh; w = bh * this.aspect; }
    w = Math.max(1, Math.floor(w)); h = Math.max(1, Math.floor(h));
    var s = this.node.style;
    s.width = w + "px"; s.height = h + "px";
    if (absolute) { s.left = Math.floor((bw - w) / 2) + "px"; s.top = Math.floor((bh - h) / 2) + "px"; }
    this.w = w; this.h = h;
  };
  // Copy a rendered buffer into the back canvas and bring it forward.
  Stage.prototype.show = function (buf, kind, dir, animate) {
    var back = this.front === this.a ? this.b : this.a;
    back.width = buf.width; back.height = buf.height;
    var g = back.getContext("2d");
    g.clearRect(0, 0, back.width, back.height);
    g.drawImage(buf, 0, 0);
    var old = this.front;
    this.front = back;
    back.style.zIndex = "2"; old.style.zIndex = "1";
    back.style.transform = ""; back.style.opacity = "";
    old.style.transform = ""; old.style.opacity = "";
    if (!animate || kind === "none" || !back.animate) return;
    var d = dir < 0 ? -1 : 1, opt = { duration: DUR, easing: "cubic-bezier(.2,.7,.2,1)" };
    if (kind === "fade") back.animate([{ opacity: 0 }, { opacity: 1 }], opt);
    else if (kind === "zoom") back.animate([{ opacity: 0, transform: "scale(.86)" }, { opacity: 1, transform: "scale(1)" }], opt);
    else if (kind === "slide") back.animate([{ transform: "translateX(" + (100 * d) + "%)" }, { transform: "translateX(0)" }], opt);
    else if (kind === "push") {
      back.animate([{ transform: "translateX(" + (100 * d) + "%)" }, { transform: "translateX(0)" }], opt);
      old.animate([{ transform: "translateX(0)" }, { transform: "translateX(" + (-100 * d) + "%)" }], opt);
    }
  };
  Stage.prototype.setBlank = function (mode) {
    this.blank.style.display = mode ? "block" : "none";
    this.blank.style.background = mode === "w" ? "#fff" : "#000";
  };
  Stage.prototype.setEnd = function (on) { this.endMsg.style.display = on ? "flex" : "none"; };
  Stage.prototype.setLaser = function (fx, fy) {
    if (fx == null) { this.laser.style.display = "none"; return; }
    this.laser.style.display = "block";
    this.laser.style.left = (fx * 100) + "%";
    this.laser.style.top = (fy * 100) + "%";
  };

  function start(opts) {
    opts = opts || {};
    var doc = opts.doc || root.document;
    var win = doc.defaultView || root;
    var T = STRINGS[opts.lang === "el" ? "el" : "en"];
    var count = Math.max(0, opts.count | 0);
    var aspect = opts.aspect > 0 ? opts.aspect : 16 / 9;
    var nav = new Nav(count, opts.hidden, opts.startAt);
    var noteOf = typeof opts.notes === "function" ? opts.notes : function () { return ""; };
    var trOf = typeof opts.transition === "function" ? opts.transition : function () { return "none"; };
    var still = reducedMotion(win);
    var closed = false, blank = null, laserOn = false, digits = "", notesOn = false, helpOn = false;
    var t0 = Date.now(), paused = 0, pauseAt = 0, shownAt = Date.now(), times = {};
    var timers = [], cleanups = [];
    var wakeLock = null;

    // Render once into a buffer of the host document (its fonts), then
    // copy to whichever stage shows it (the presenter window too).
    var cache = {};
    function buffer(i, w, h) {
      var dpr = Math.min(3, win.devicePixelRatio || 1);
      var key = i + ":" + w + "x" + h + "@" + dpr;
      if (cache[key]) return cache[key];
      var c = doc.createElement("canvas");
      c.width = Math.max(1, Math.round(w * dpr)); c.height = Math.max(1, Math.round(h * dpr));
      try { opts.renderSlide(i, c, w, h); } catch (e) { /* a broken slide must not end the show */ }
      var keys = Object.keys(cache);
      if (keys.length > 8) delete cache[keys[0]];
      cache[key] = c;
      return c;
    }

    // ----- audience surface (here, or in the presenter window) -----
    var root0 = el(doc, "div", "oshow");
    root0.tabIndex = -1;
    root0.setAttribute("role", "dialog");
    root0.setAttribute("aria-label", T.end);
    addStyle(doc);
    doc.body.appendChild(root0);

    var pop = null, audDoc = doc, audRoot = root0, popupFailed = false;
    if (opts.presenter) {
      try { pop = win.open("", "oros-show-" + Date.now().toString(36), "popup=yes,width=1024,height=600"); } catch (e) { pop = null; }
      if (pop && pop.document) {
        audDoc = pop.document;
        audDoc.title = (opts.title && opts.title(nav.index())) || T.end;
        var meta = audDoc.createElement("meta"); meta.setAttribute("charset", "utf-8");
        (audDoc.head || audDoc.documentElement).appendChild(meta);
        addStyle(audDoc);
        audDoc.body.style.margin = "0";
        audDoc.body.style.background = "#000";
        audRoot = el(audDoc, "div", "oshow");
        audDoc.body.appendChild(audRoot);
      } else {
        pop = null; popupFailed = true;
      }
    }
    var aud = new Stage(audDoc, audRoot, aspect, T.endOfShow);
    var numBox = el(audDoc, "div", "oshow-num");
    audRoot.appendChild(numBox);

    // Full-screen hint on the projector window: its first click goes
    // full screen there (a click in the other window cannot).
    if (pop) {
      var fs = el(audDoc, "div", "oshow-fs");
      fs.appendChild(el(audDoc, "span", "", T.fsHint));
      audRoot.appendChild(fs);
      fs.addEventListener("click", function (e) {
        e.stopPropagation();
        requestFs(audRoot);
        if (fs.parentNode) fs.parentNode.removeChild(fs);
      });
    }

    // ----- local UI: presenter view, or the show itself -----
    var pv = null, toast, bar, countBox, notesBox, helpBox;
    function button(parent, d, label, fn, text) {
      var b = el(d, "button", "", text || label);
      b.type = "button";
      b.setAttribute("aria-label", label);
      b.title = label;
      b.addEventListener("click", function (e) { e.stopPropagation(); fn(); });
      parent.appendChild(b);
      return b;
    }
    if (pop) {
      pv = { node: el(doc, "div", "oshow-pv") };
      var top = el(doc, "div", "oshow-pv-top");
      pv.elapsed = el(doc, "span", "oshow-pv-big", "0:00");
      pv.clock = el(doc, "span", "oshow-pv-big oshow-muted", fmtClock(new Date()));
      pv.count = el(doc, "span", "oshow-muted");
      top.appendChild(pv.elapsed); top.appendChild(pv.clock); top.appendChild(pv.count);
      pv.cur = el(doc, "div", "oshow-pv-cur");
      var side = el(doc, "div", "oshow-pv-side");
      side.appendChild(el(doc, "div", "oshow-muted", T.nextUp));
      pv.nextBox = el(doc, "div", "oshow-pv-next");
      pv.nextBox.style.aspectRatio = String(aspect);
      pv.nextCanvas = el(doc, "canvas");
      pv.nextBox.appendChild(pv.nextCanvas);
      side.appendChild(pv.nextBox);
      pv.notes = el(doc, "div", "oshow-pv-notes");
      side.appendChild(pv.notes);
      var ctl = el(doc, "div", "oshow-pv-ctl");
      button(ctl, doc, T.prev, function () { act("prev"); }, "◀");
      button(ctl, doc, T.next, function () { act("next"); }, "▶");
      button(ctl, doc, T.black, function () { act("black"); }, "■");
      button(ctl, doc, T.laser, function () { act("laser"); }, "●");
      pv.pauseBtn = button(ctl, doc, T.pause, togglePause);
      button(ctl, doc, T.reset, function () { t0 = Date.now(); paused = 0; if (pauseAt) pauseAt = t0; tick(); });
      button(ctl, doc, T.smaller, function () { zoomNotes(-2); }, "A−");
      button(ctl, doc, T.bigger, function () { zoomNotes(2); }, "A+");
      button(ctl, doc, T.end, close);
      pv.node.appendChild(top); pv.node.appendChild(pv.cur); pv.node.appendChild(side); pv.node.appendChild(ctl);
      root0.appendChild(pv.node);
      pv.stage = new Stage(doc, pv.cur, aspect, T.endOfShow);
    } else {
      bar = el(doc, "div", "oshow-bar");
      button(bar, doc, T.prev, function () { act("prev"); }, "◀");
      countBox = el(doc, "span", "oshow-count");
      bar.appendChild(countBox);
      button(bar, doc, T.next, function () { act("next"); }, "▶");
      button(bar, doc, T.notes, function () { act("notes"); });
      button(bar, doc, T.help, function () { act("help"); }, "?");
      button(bar, doc, T.end, close, "✕");
      notesBox = el(doc, "div", "oshow-notes");
      root0.appendChild(notesBox);
      root0.appendChild(bar);
    }
    toast = el(doc, "div", "oshow-toast");
    root0.appendChild(toast);
    helpBox = el(doc, "div", "oshow-help");
    var hb = el(doc, "div");
    hb.appendChild(el(doc, "h3", "", T.helpTitle));
    var tbl = el(doc, "table");
    T.helpRows.forEach(function (r) {
      var tr = el(doc, "tr");
      tr.appendChild(el(doc, "td", "", r[0]));
      tr.appendChild(el(doc, "td", "", r[1]));
      tbl.appendChild(tr);
    });
    hb.appendChild(tbl);
    helpBox.appendChild(hb);
    helpBox.addEventListener("click", function (e) { e.stopPropagation(); act("help"); });
    root0.appendChild(helpBox);

    function showToast(msg, ms) {
      toast.textContent = msg;
      toast.style.display = "block";
      var t = win.setTimeout(function () { toast.style.display = "none"; }, ms || 3000);
      timers.push(t);
    }
    var notesSize = 20;
    function zoomNotes(d) {
      notesSize = Math.max(12, Math.min(44, notesSize + d));
      pv.notes.style.fontSize = notesSize + "px";
    }

    // ----- layout + paint -----
    function layout() {
      if (closed) return;
      var aw = audRoot.clientWidth || (audDoc.defaultView && audDoc.defaultView.innerWidth) || 800;
      var ah = audRoot.clientHeight || (audDoc.defaultView && audDoc.defaultView.innerHeight) || 450;
      aud.fit(aw, ah, true);
      if (pv) {
        pv.stage.fit(pv.cur.clientWidth || 400, pv.cur.clientHeight || 225, false);
        var nw = pv.nextBox.clientWidth || 240;
        pv.nextW = nw; pv.nextH = Math.round(nw / aspect);
      }
      paint(0, false);
    }
    function paint(dir, animate) {
      if (closed) return;
      var i = nav.index();
      var tr = (i >= 0 && !still) ? trOf(i) : "none";
      var kind = TRANSITIONS.indexOf(tr) >= 0 ? tr : "none";
      aud.setEnd(nav.atEnd());
      if (i >= 0) aud.show(buffer(i, aud.w, aud.h), kind, dir, animate);
      if (pv) {
        pv.stage.setEnd(nav.atEnd());
        if (i >= 0) pv.stage.show(buffer(i, pv.stage.w, pv.stage.h), "none", 0, false);
        var ni = nav.nextIndex();
        var nc = pv.nextCanvas, g;
        if (ni >= 0) {
          var nb = buffer(ni, pv.nextW, pv.nextH);
          nc.width = nb.width; nc.height = nb.height;
          g = nc.getContext("2d"); g.clearRect(0, 0, nc.width, nc.height); g.drawImage(nb, 0, 0);
        } else {
          nc.width = 2; nc.height = 2;
        }
        pv.nextBox.title = ni >= 0 ? "" : T.lastSlide;
        var n = i >= 0 ? String(noteOf(i) || "") : "";
        pv.notes.textContent = n || T.noNotes;
        pv.notes.className = "oshow-pv-notes" + (n ? "" : " oshow-muted");
        pv.notes.scrollTop = 0;
        pv.count.textContent = nav.atEnd() ? T.lastSlide : T.slideOf.replace("{n}", nav.pos + 1).replace("{t}", nav.order.length);
      } else {
        countBox.textContent = nav.atEnd() ? "–" : (nav.pos + 1) + " / " + nav.order.length;
        if (notesOn) fillNotes();
      }
      if (pop && opts.title && i >= 0) audDoc.title = opts.title(i) || audDoc.title;
    }
    function fillNotes() {
      var i = nav.index();
      var n = i >= 0 ? String(noteOf(i) || "") : "";
      notesBox.textContent = n || T.noNotes;
    }

    // ----- timing -----
    function now() { return pauseAt || Date.now(); }
    function leaveSlide() {
      var i = nav.index(), t = now();
      if (i >= 0 && !pauseAt) times[i] = (times[i] || 0) + (t - shownAt);
      shownAt = t;
    }
    function togglePause() {
      if (pauseAt) { var d = Date.now() - pauseAt; paused += d; shownAt += d; pauseAt = 0; }
      else pauseAt = Date.now();
      if (pv) pv.pauseBtn.textContent = pauseAt ? T.resume : T.pause;
      tick();
    }
    function tick() {
      if (closed || !pv) return;
      pv.elapsed.textContent = fmtElapsed(now() - t0 - paused);
      pv.clock.textContent = fmtClock(new Date());
    }
    if (pv) timers.push(win.setInterval(tick, 1000));

    // ----- actions -----
    function move(fn, dir) {
      var before = nav.pos;
      if (nav.atEnd() && dir > 0) { close(); return; }
      leaveSlide();
      if (fn()) {
        blank = null; aud.setBlank(null); if (pv) pv.stage.setBlank(null);
        paint(nav.pos > before ? 1 : -1, true);
      }
    }
    function setBlank(mode) {
      blank = blank === mode ? null : mode;
      aud.setBlank(blank);
      if (pv) pv.stage.setBlank(blank);
    }
    function act(a) {
      if (closed) return;
      if (helpOn && a !== "help" && a !== "end") { toggleHelp(); return; }
      if (a && a.indexOf("digit:") === 0) {
        digits = (digits + a.slice(6)).slice(-4);
        numBox.textContent = digits; numBox.style.display = "block";
        return;
      }
      if (a === "enter" && digits) {
        var n = parseInt(digits, 10);
        digits = ""; numBox.style.display = "none";
        move(function () { return nav.goNumber(n); }, 0);
        return;
      }
      digits = ""; numBox.style.display = "none";
      switch (a) {
        case "next": case "enter": move(function () { return nav.next(); }, 1); break;
        case "prev": move(function () { return nav.prev(); }, -1); break;
        case "first": move(function () { return nav.first(); }, -1); break;
        case "last": move(function () { return nav.last(); }, 1); break;
        case "black": setBlank("b"); break;
        case "white": setBlank("w"); break;
        case "laser":
          laserOn = !laserOn;
          if (!laserOn) { aud.setLaser(null); if (pv) pv.stage.setLaser(null); }
          root0.style.cursor = laserOn ? "none" : "";
          break;
        case "notes":
          if (pv) break;
          notesOn = !notesOn;
          notesBox.style.display = notesOn ? "block" : "none";
          if (notesOn) fillNotes();
          break;
        case "help": toggleHelp(); break;
        case "end": close(); break;
      }
    }
    function toggleHelp() {
      helpOn = !helpOn;
      helpBox.style.display = helpOn ? "flex" : "none";
    }

    // ----- input -----
    function onKey(e) {
      if (closed) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ""))) return;
      var a = keyAction(e.key, e.code);
      if (!a) return;
      e.preventDefault();
      e.stopPropagation();
      act(a);
    }
    function listen(target, type, fn, o) {
      target.addEventListener(type, fn, o);
      cleanups.push(function () { try { target.removeEventListener(type, fn, o); } catch (e) { /* window gone */ } });
    }
    listen(doc, "keydown", onKey, true);
    if (pop) listen(audDoc, "keydown", onKey, true);

    // Pointer: tap right two thirds = next, left third = previous;
    // horizontal swipe; the bar shows on movement near the bottom.
    function pointerOn(surface, stage) {
      var sx = 0, sy = 0, down = false, moved = false;
      listen(surface, "pointerdown", function (e) {
        if (e.button > 0) return;
        down = true; moved = false; sx = e.clientX; sy = e.clientY;
      });
      listen(surface, "pointermove", function (e) {
        if (down && (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10)) moved = true;
        if (laserOn) {
          var r = stage.node.getBoundingClientRect();
          var fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
          if (fx >= 0 && fx <= 1 && fy >= 0 && fy <= 1) { aud.setLaser(fx, fy); if (pv) pv.stage.setLaser(fx, fy); }
          else { aud.setLaser(null); if (pv) pv.stage.setLaser(null); }
        }
        if (bar && surface === root0) showBar(e.clientY > (surface.clientHeight || 0) - 140 || e.pointerType !== "mouse");
      });
      listen(surface, "pointerup", function (e) {
        if (!down) return;
        down = false;
        if (e.target && e.target.closest && e.target.closest("button,.oshow-notes,.oshow-pv-notes,.oshow-fs,.oshow-help")) return;
        var dx = e.clientX - sx, dy = e.clientY - sy;
        if (moved) {
          if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) act(dx < 0 ? "next" : "prev");
          return;
        }
        if (laserOn) return;
        if (nav.atEnd()) { close(); return; }
        if (bar && e.pointerType !== "mouse") showBar(true);
        var r = surface.getBoundingClientRect();
        act(e.clientX - r.left < r.width / 3 ? "prev" : "next");
      });
    }
    var barTimer = 0;
    function showBar(on) {
      if (!bar) return;
      if (on) {
        bar.className = "oshow-bar on";
        win.clearTimeout(barTimer);
        barTimer = win.setTimeout(function () { bar.className = "oshow-bar"; }, 2600);
      }
    }
    if (pv) {
      pointerOn(pv.cur, pv.stage);
      pointerOn(audRoot, aud);
    } else {
      pointerOn(root0, aud);
    }
    listen(win, "resize", layout);
    if (pop) {
      listen(pop, "resize", layout);
      listen(pop, "pagehide", function () { if (!closed) close(); });
      timers.push(win.setInterval(function () { if (pop.closed && !closed) close(); }, 1000));
    }
    // Leaving full screen (Esc is eaten by the browser) ends the show.
    var wasFs = false;
    function onFs() {
      if (fsElement(doc)) wasFs = true;
      else if (wasFs && !pop) close();
      layout();
    }
    listen(doc, "fullscreenchange", onFs);
    listen(doc, "webkitfullscreenchange", onFs);

    // ----- start -----
    if (!pop) requestFs(root0);
    try { root0.focus({ preventScroll: true }); } catch (e) { /* old engines */ }
    try {
      if (win.navigator && win.navigator.wakeLock) {
        win.navigator.wakeLock.request("screen").then(function (l) {
          if (closed) { l.release(); return; }
          wakeLock = l;
        }, function () {});
      }
    } catch (e) { /* no wake lock: the screen may dim, nothing else */ }
    layout();
    if (pop) timers.push(win.setTimeout(layout, 60));  // the new window may not have its size yet
    if (popupFailed) showToast(T.popupBlocked, 5000);
    if (!pop) showBar(true);

    function close() {
      if (closed) return;
      leaveSlide();
      closed = true;
      timers.forEach(function (t) { win.clearTimeout(t); win.clearInterval(t); });
      win.clearTimeout(barTimer);
      cleanups.forEach(function (f) { f(); });
      exitFs(doc);
      if (root0.parentNode) root0.parentNode.removeChild(root0);
      if (pop) { try { pop.close(); } catch (e) { /* closed by the user */ } }
      if (wakeLock) { try { wakeLock.release(); } catch (e) { /* released */ } }
      cache = {};
      if (typeof opts.onEnd === "function") {
        opts.onEnd(summary(times, Date.now() - t0 - paused - (pauseAt ? Date.now() - pauseAt : 0)));
      }
    }

    return {
      go: function (i) { move(function () { return nav.goIndex(i); }, 0); },
      next: function () { act("next"); },
      prev: function () { act("prev"); },
      close: close,
      state: function () {
        return { index: nav.index(), pos: nav.pos, visible: nav.order.length, atEnd: nav.atEnd(),
                 blank: blank, laser: laserOn, presenter: !!pop, closed: closed };
      }
    };
  }

  var API = {
    VER: "1.0.0", STRINGS: STRINGS, TRANSITIONS: TRANSITIONS,
    keyAction: keyAction, Nav: Nav, fmtElapsed: fmtElapsed, fmtClock: fmtClock, summary: summary,
    start: start
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else { root.orosDK = root.orosDK || {}; root.orosDK.show = API; }
})(typeof window !== "undefined" ? window : this);
