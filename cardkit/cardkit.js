// ============================================================
// orOS cardkit — shared playing cards (v1.0.0)
// NOT an app (no apps.json entry, no slice, no storage). A plain
// script that card games load next to their own files:
//
//   <link rel="stylesheet" href="../cardkit/cardkit.css">
//   <script src="../cardkit/cardkit.js"></script>
//
// It only defines window.orosCards. Nothing touches the DOM at load
// time, so the file also runs in Node (tests/solitaire.test.js).
// Used by: Solitaire (solitaire/). Planned: Xeri.
//
// Cards are small integers:  id = suit * 13 + (rank - 1)
//   suit 0 ♠ spades · 1 ♥ hearts · 2 ♦ diamonds · 3 ♣ clubs
//   rank 1 ace · 2..10 · 11 jack · 12 queen · 13 king
// A multi-deck game (Spider) repeats ids: a card on the table is
// identified by where it lies, never by its id alone.
//
// API (window.orosCards):
//   VERSION                     "1.0.0"
//   SUITS                       ["S", "H", "D", "C"] (index = suit)
//   make(rank, suit) → id       rank(id) → 1..13    suit(id) → 0..3
//   isRed(id) → bool            code(id) → "QH", "10S"   parse("QH") → id | -1
//   newDeck({ suits, copies })  ids in order (A..K per suit, suit by suit,
//                               copy by copy); default 4 suits × 1 = 52
//   randInt(n)                  crypto integer in [0, n), no modulo bias
//   shuffle(arr)                crypto Fisher–Yates, in place, returns arr
//   seededRandom(seed) → fn     deterministic [0, 1) stream (mulberry32);
//                               seed: integer or string
//   seededShuffle(arr, seed)    Fisher–Yates with that stream, in place
//   rankLabel(rank, style)      "A".."K" ("intl", default) or Greek "Α 2..10 Β Ν Ρ" ("el")
//   suitName(suit, lang)        "hearts" / "κούπα"
//   cardName(id, lang)          "Queen of hearts" / "Ντάμα κούπα" (aria labels)
//   suitSvg(suit)               <svg> pip, fill currentColor
//   cardEl(id, { faceUp, labels })   a card element (DOM only, no images):
//                               div.ock-card.ock-up[.ock-red] or div.ock-card.ock-down
//   setFace(el, id, faceUp, opts)    re-paint an element in place
//   paintCard(ctx, id, x, y, w, opts)  the same face on a 2D canvas
//                               (opts.faceUp false → the back)
//   dragHelper(root, opts) → { cancel, destroy }
//                               pointer drag + tap + double tap for the
//                               elements under root that match opts.selector
//
// Sizing: the stylesheet sizes every card from the CSS variable --ock-w
// (card width, px) on any ancestor; height = 1.4 × width. The corner
// font follows the width with a 12px floor, so a 32px card (ten columns
// on a 360px phone) still shows a readable "10♥". Add the class
// "ock-roomy" to an ancestor to also draw the bottom-right corner.
// ============================================================
(function (root) {
  "use strict";

  var SUITS = ["S", "H", "D", "C"];
  var RANK_INTL = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  var RANK_EL   = ["", "Α", "2", "3", "4", "5", "6", "7", "8", "9", "10", "Β", "Ν", "Ρ"];
  var NAMES = {
    en: {
      ranks: ["", "Ace", "2", "3", "4", "5", "6", "7", "8", "9", "10", "Jack", "Queen", "King"],
      suits: ["spades", "hearts", "diamonds", "clubs"],
      pattern: "{r} of {s}"
    },
    el: {
      ranks: ["", "Άσσος", "2", "3", "4", "5", "6", "7", "8", "9", "10", "Βαλές", "Ντάμα", "Ρήγας"],
      suits: ["μπαστούνι", "κούπα", "καρό", "σπαθί"],
      pattern: "{r} {s}"
    }
  };

  // Suit pips in a 24×24 box (own drawings, filled with currentColor).
  var PIPS = [
    // spade
    "M12 1.8C9.6 4.6 2.6 9.4 2.6 14.2c0 2.8 2.1 4.6 4.5 4.6 1.8 0 3.3-.9 4.1-2.3-.2 2.4-1.2 4.2-2.8 5.7h7.2c-1.6-1.5-2.6-3.3-2.8-5.7.8 1.4 2.3 2.3 4.1 2.3 2.4 0 4.5-1.8 4.5-4.6C21.4 9.4 14.4 4.6 12 1.8z",
    // heart
    "M12 21.4C9.4 19.1 2 14 2 8.3 2 5.2 4.4 2.9 7.3 2.9c2 0 3.7 1.1 4.7 2.8 1-1.7 2.7-2.8 4.7-2.8 2.9 0 5.3 2.3 5.3 5.4 0 5.7-7.4 10.8-10 13.1z",
    // diamond
    "M12 1.5 20.2 12 12 22.5 3.8 12z",
    // club
    "M7.4 6.6a4.6 4.6 0 1 1 9.2 0a4.6 4.6 0 1 1-9.2 0zM2.4 13.4a4.6 4.6 0 1 1 9.2 0a4.6 4.6 0 1 1-9.2 0z" +
    "M12.4 13.4a4.6 4.6 0 1 1 9.2 0a4.6 4.6 0 1 1-9.2 0zM9 9h6v5H9zM13 14.5c.2 3 1.2 5.5 2.8 7.3H8.2c1.6-1.8 2.6-4.3 2.8-7.3z"
  ];

  var FACE_INK = "#1d1d1f", FACE_RED = "#c62828", FACE_BG = "#fdfcf7";

  // ---------- Identity ----------
  function make(rank, suit) { return suit * 13 + (rank - 1); }
  function rank(id) { return id % 13 + 1; }
  function suit(id) { return Math.floor(id / 13) % 4; }
  function isRed(id) { var s = suit(id); return s === 1 || s === 2; }

  function code(id) { return RANK_INTL[rank(id)] + SUITS[suit(id)]; }
  function parse(str) {
    var m = /^(A|[2-9]|10|T|J|Q|K)([SHDC])$/.exec(String(str || "").toUpperCase());
    if (!m) return -1;
    var r = m[1] === "T" ? 10 : RANK_INTL.indexOf(m[1]);
    return make(r, SUITS.indexOf(m[2]));
  }

  function newDeck(opts) {
    var o = opts || {};
    var suits = (o.suits || [0, 1, 2, 3]).map(function (s) {
      return typeof s === "string" ? SUITS.indexOf(s.toUpperCase()) : s;
    });
    var copies = o.copies > 0 ? Math.floor(o.copies) : 1, out = [];
    for (var c = 0; c < copies; c++) {
      suits.forEach(function (s) {
        if (!(s >= 0 && s <= 3)) throw new Error("orosCards.newDeck: bad suit " + s);
        for (var r = 1; r <= 13; r++) out.push(make(r, s));
      });
    }
    return out;
  }

  // ---------- Randomness ----------
  function cryptoObj() {
    var c = (root && root.crypto) || (typeof crypto !== "undefined" ? crypto : null);
    if (!c || typeof c.getRandomValues !== "function") throw new Error("orosCards: no crypto.getRandomValues");
    return c;
  }

  // Rejection sampling: no modulo bias.
  function randInt(n) {
    if (!(n >= 1)) return 0;
    var buf = new Uint32Array(1), lim = 4294967296 - (4294967296 % n), c = cryptoObj();
    while (true) {
      c.getRandomValues(buf);
      if (buf[0] < lim) return buf[0] % n;
    }
  }

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = randInt(i + 1), x = arr[i];
      arr[i] = arr[j]; arr[j] = x;
    }
    return arr;
  }

  // mulberry32; a string seed is hashed with FNV-1a first.
  function seededRandom(seed) {
    var a;
    if (typeof seed === "string") {
      a = 2166136261;
      for (var i = 0; i < seed.length; i++) { a ^= seed.charCodeAt(i); a = Math.imul(a, 16777619); }
    } else {
      a = Math.floor(Number(seed) || 0);
    }
    a = a >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function seededShuffle(arr, seed) {
    var rnd = seededRandom(seed);
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1)), x = arr[i];
      arr[i] = arr[j]; arr[j] = x;
    }
    return arr;
  }

  // ---------- Names ----------
  function rankLabel(r, style) { return (style === "el" ? RANK_EL : RANK_INTL)[r] || ""; }
  function suitName(s, lang) { return (NAMES[lang] || NAMES.en).suits[s] || ""; }
  function cardName(id, lang) {
    var n = NAMES[lang] || NAMES.en;
    return n.pattern.split("{r}").join(n.ranks[rank(id)]).split("{s}").join(n.suits[suit(id)]);
  }

  // ---------- DOM faces ----------
  var SVGNS = "http://www.w3.org/2000/svg";
  function suitSvg(s) {
    var svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", "ock-pip");
    var p = document.createElementNS(SVGNS, "path");
    p.setAttribute("d", PIPS[s]);
    p.setAttribute("fill", "currentColor");
    svg.appendChild(p);
    return svg;
  }

  function span(cls, text) {
    var n = document.createElement("span");
    n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function corner(id, labels, extra) {
    var c = span("ock-corner" + (extra ? " " + extra : ""));
    c.appendChild(span("ock-rank", rankLabel(rank(id), labels)));
    c.appendChild(suitSvg(suit(id)));
    return c;
  }

  function paintFace(el, id, faceUp, opts) {
    var o = opts || {};
    while (el.firstChild) el.removeChild(el.firstChild);
    el.className = "ock-card " + (faceUp ? "ock-up" + (isRed(id) ? " ock-red" : "") : "ock-down");
    if (!faceUp) return el;
    var labels = o.labels === "el" ? "el" : "intl", r = rank(id);
    el.appendChild(corner(id, labels));
    var mid = span("ock-mid" + (r > 10 ? " ock-court" : ""));
    if (r > 10) mid.appendChild(span("ock-letter", rankLabel(r, labels)));
    mid.appendChild(suitSvg(suit(id)));
    el.appendChild(mid);
    el.appendChild(corner(id, labels, "ock-corner-b"));
    return el;
  }

  function cardEl(id, opts) {
    var o = opts || {};
    return paintFace(document.createElement("div"), id, o.faceUp !== false, o);
  }
  function setFace(el, id, faceUp, opts) { return paintFace(el, id, faceUp !== false, opts); }

  // ---------- Canvas faces ----------
  var pathCache = [];
  function pipPath(s) {
    if (!pathCache[s] && typeof Path2D === "function") pathCache[s] = new Path2D(PIPS[s]);
    return pathCache[s];
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function drawPip(ctx, s, x, y, size) {
    var p = pipPath(s);
    if (!p) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(size / 24, size / 24);
    ctx.fill(p);
    ctx.restore();
  }
  // opts: { faceUp (default true), labels, back (CSS colour of the back) }
  function paintCard(ctx, id, x, y, w, opts) {
    var o = opts || {}, h = Math.round(w * 1.4), r = Math.max(3, w * 0.08);
    ctx.save();
    roundRect(ctx, x, y, w, h, r);
    if (o.faceUp === false) {
      ctx.fillStyle = o.back || "#2b5aa8";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.6)";
      ctx.lineWidth = Math.max(1, w * 0.04);
      roundRect(ctx, x + w * 0.1, y + w * 0.1, w * 0.8, h - w * 0.2, r * 0.6);
      ctx.stroke();
      ctx.restore();
      return;
    }
    ctx.fillStyle = FACE_BG;
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 1;
    ctx.stroke();
    var ink = isRed(id) ? FACE_RED : FACE_INK, f = Math.max(10, Math.round(w * 0.3)), s = suit(id), rk = rank(id);
    ctx.fillStyle = ink;
    ctx.font = "800 " + f + "px system-ui, -apple-system, 'Segoe UI', sans-serif";
    ctx.textBaseline = "top";
    var label = rankLabel(rk, o.labels === "el" ? "el" : "intl");
    ctx.fillText(label, x + w * 0.08, y + w * 0.07);
    var tw = ctx.measureText(label).width;
    drawPip(ctx, s, x + w * 0.08 + tw + 1, y + w * 0.07 + f * 0.05, f * 0.85);
    if (rk > 10) {
      ctx.font = "800 " + Math.round(w * 0.5) + "px system-ui, -apple-system, 'Segoe UI', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(label, x + w / 2, y + h * 0.36);
      drawPip(ctx, s, x + w / 2 - w * 0.13, y + h * 0.7, w * 0.26);
    } else {
      drawPip(ctx, s, x + w * 0.2, y + h * 0.36, w * 0.6);
    }
    ctx.restore();
  }

  // ---------- Pointer helper ----------
  // dragHelper(root, opts) handles pointer input for every element under
  // root that matches opts.selector (default ".ock-card"):
  //   opts.pick(el, ev) → null (ignore) | { data, els }
  //       data is handed back to tap/drop; els are the elements that move
  //       with the pointer (empty → tap only, e.g. a face-down stock card)
  //   opts.tap(data, count, ev)         a press without movement; count 2
  //       when it follows a tap on the same spot within opts.doubleMs (350)
  //   opts.over(data, rect, ev)         while dragging (rect: lead element)
  //   opts.drop(data, rect, ev) → bool  true = accepted; false = the
  //       elements glide back to where they were
  //   opts.end(data)                    after every drag (accepted or not)
  //   opts.threshold                    px before a press becomes a drag (6)
  // The dragged elements get the class "ock-dragging" and a transform;
  // the app re-renders after an accepted drop.
  function dragHelper(rootEl, opts) {
    var o = opts || {}, sel = o.selector || ".ock-card", thr = o.threshold || 6, dbl = o.doubleMs || 350;
    var st = null, lastTap = null;
    var reduce = !!(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches);

    function clear(els) {
      els.forEach(function (n) { n.classList.remove("ock-dragging", "ock-return"); n.style.transform = ""; });
    }
    function snapBack(els) {
      if (reduce || !els.length) { clear(els); return; }
      els.forEach(function (n) { n.classList.add("ock-return"); n.style.transform = ""; });
      setTimeout(function () { clear(els); }, 200);
    }
    function down(e) {
      if (st || (e.pointerType === "mouse" && e.button !== 0)) return;
      var el = e.target && e.target.closest ? e.target.closest(sel) : null;
      if (!el || !rootEl.contains(el)) return;
      var pick = o.pick ? o.pick(el, e) : { data: el, els: [el] };
      if (!pick) return;
      pick.els = pick.els || [];
      st = { id: e.pointerId, x0: e.clientX, y0: e.clientY, el: el, pick: pick, drag: false };
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* old browser */ }
      if (pick.els.length) e.preventDefault();      // no text selection, no native image drag
    }
    function move(e) {
      if (!st || e.pointerId !== st.id) return;
      var dx = e.clientX - st.x0, dy = e.clientY - st.y0;
      if (!st.drag) {
        if (!st.pick.els.length || Math.abs(dx) + Math.abs(dy) < thr) return;
        st.drag = true;
        st.pick.els.forEach(function (n) { n.classList.add("ock-dragging"); });
      }
      e.preventDefault();
      st.pick.els.forEach(function (n) { n.style.transform = "translate(" + dx + "px," + dy + "px)"; });
      if (o.over) o.over(st.pick.data, st.pick.els[0].getBoundingClientRect(), e);
    }
    function up(e) {
      if (!st || e.pointerId !== st.id) return;
      var s = st;
      st = null;
      if (s.drag) {
        lastTap = null;
        var ok = false;
        try { ok = o.drop ? !!o.drop(s.pick.data, s.pick.els[0].getBoundingClientRect(), e) : false; }
        finally {
          if (!ok) snapBack(s.pick.els); else clear(s.pick.els);
          if (o.end) o.end(s.pick.data);
        }
        return;
      }
      var now = Date.now(), count = 1;
      if (lastTap && now - lastTap.t < dbl && Math.abs(e.clientX - lastTap.x) < 24 && Math.abs(e.clientY - lastTap.y) < 24) count = 2;
      lastTap = count === 2 ? null : { t: now, x: e.clientX, y: e.clientY };
      if (o.tap) o.tap(s.pick.data, count, e);
    }
    function cancel(e) {
      if (!st || (e && e.pointerId !== st.id)) return;
      var s = st;
      st = null;
      if (s.drag) { snapBack(s.pick.els); if (o.end) o.end(s.pick.data); }
    }
    rootEl.addEventListener("pointerdown", down);
    rootEl.addEventListener("pointermove", move);
    rootEl.addEventListener("pointerup", up);
    rootEl.addEventListener("pointercancel", cancel);
    return {
      cancel: function () { cancel(); },
      destroy: function () {
        rootEl.removeEventListener("pointerdown", down);
        rootEl.removeEventListener("pointermove", move);
        rootEl.removeEventListener("pointerup", up);
        rootEl.removeEventListener("pointercancel", cancel);
      }
    };
  }

  root.orosCards = {
    VERSION: "1.0.0",
    SUITS: SUITS.slice(),
    make: make, rank: rank, suit: suit, isRed: isRed, code: code, parse: parse,
    newDeck: newDeck,
    randInt: randInt, shuffle: shuffle, seededRandom: seededRandom, seededShuffle: seededShuffle,
    rankLabel: rankLabel, suitName: suitName, cardName: cardName,
    suitSvg: suitSvg, cardEl: cardEl, setFace: setFace, paintCard: paintCard,
    dragHelper: dragHelper
  };
})(typeof window !== "undefined" ? window : this);
