// ============================================================
// orOS Files — clip-core.js (search photos by description, pure part)
// ------------------------------------------------------------
// The parts of CLIP (OpenAI CLIP ViT-B/32, MIT) that need no browser:
// the byte-level BPE tokenizer of CLIP's text side, the picture →
// tensor step, and the vector maths of the search. clip.js runs the
// two ONNX models (vision and text) and keeps the index; photos.js is
// the screen. Nothing here touches the network or storage.
//   tokenizer(vocab, mergesText) → { encode(text) → Int32Array(77) }
//     CLIP's rules: lower case, whitespace collapsed, words split by
//     CLIP's pattern, each word's bytes → unicode, BPE with "</w>" on
//     the last symbol, <|startoftext|> 49406 first, <|endoftext|>
//     49407 last, padded with 49407 to 77 (the model pools the first
//     49407, so the padding does not change the result)
//   pixels(rgba, w, h) → Float32Array(3 × 224 × 224), CHW, CLIP's mean
//     and std; the caller draws the picture already scaled so its short
//     side is 224 and centred (cropBox gives that rectangle)
//   cropBox(w, h) → { sx, sy, sw, sh } (the centre square of the picture)
//   normalize(vec) → the same vector with length 1 (Float32Array)
//   pack(vec) → Int8Array (length-1 vector × 127, what the index keeps)
//   score(q, packed) → cosine similarity of a query and a packed vector
//   rank(q, items, { min, max }) → [{ k, s }] best first;
//     items = [{ k, v: Int8Array }]
//   blend(a, b) → normalize(a + b) (a description and a photo together)
// UMD: module.exports in Node (tests), window.OrosClipCore in the browser.
// ============================================================
(function (root) {
  "use strict";

  var SIZE = 224, CTX = 77, SOT = 49406, EOT = 49407, DIM = 512;
  var MEAN = [0.48145466, 0.4578275, 0.40821073];
  var STD = [0.26862954, 0.26130258, 0.27577711];
  var PAT = /<\|startoftext\|>|<\|endoftext\|>|'s|'t|'re|'ve|'m|'ll|'d|\p{L}+|\p{N}|[^\s\p{L}\p{N}]+/giu;

  // GPT-2's byte → printable character table, which CLIP shares.
  function byteTable() {
    var bs = [], cs, n = 0, b;
    for (b = 33; b <= 126; b++) bs.push(b);
    for (b = 161; b <= 172; b++) bs.push(b);
    for (b = 174; b <= 255; b++) bs.push(b);
    cs = bs.slice();
    for (b = 0; b < 256; b++) if (bs.indexOf(b) === -1) { bs.push(b); cs.push(256 + n); n++; }
    var out = {};
    bs.forEach(function (x, i) { out[x] = String.fromCharCode(cs[i]); });
    return out;
  }

  function utf8(s) {
    if (typeof TextEncoder === "function") return new TextEncoder().encode(s);
    return Buffer.from(s, "utf8");
  }

  function clean(text) {
    return String(text == null ? "" : text)
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'")
      .normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function tokenizer(vocab, mergesText) {
    var ranks = Object.create(null), lines = String(mergesText || "").split("\n"), r = 0;
    lines.forEach(function (ln) {
      if (!ln || ln.charAt(0) === "#") return;
      var parts = ln.trim().split(" ");
      if (parts.length === 2) ranks[parts[0] + " " + parts[1]] = r++;
    });
    var bytes = byteTable(), cache = Object.create(null);

    function bpe(token) {
      if (cache[token]) return cache[token];
      var word = Array.from(token.slice(0, -1));
      word.push(token.slice(-1) + "</w>");
      if (word.length === 1) return (cache[token] = word);
      for (;;) {
        var best = -1, bestRank = Infinity, i;
        for (i = 0; i < word.length - 1; i++) {
          var rk = ranks[word[i] + " " + word[i + 1]];
          if (rk !== undefined && rk < bestRank) { bestRank = rk; best = i; }
        }
        if (best < 0) break;
        var a = word[best], b = word[best + 1], next = [];
        for (i = 0; i < word.length;) {
          if (i < word.length - 1 && word[i] === a && word[i + 1] === b) { next.push(a + b); i += 2; }
          else { next.push(word[i]); i++; }
        }
        word = next;
        if (word.length === 1) break;
      }
      return (cache[token] = word);
    }

    function encode(text) {
      var ids = [SOT], s = clean(text), m;
      PAT.lastIndex = 0;
      while ((m = PAT.exec(s)) && ids.length < CTX - 1) {
        var u = utf8(m[0]), tok = "";
        for (var i = 0; i < u.length; i++) tok += bytes[u[i]];
        var parts = bpe(tok);
        for (var j = 0; j < parts.length && ids.length < CTX - 1; j++) {
          var id = vocab[parts[j]];
          if (typeof id === "number") ids.push(id);
        }
      }
      ids.push(EOT);
      var out = new Int32Array(CTX);
      for (var k = 0; k < CTX; k++) out[k] = k < ids.length ? ids[k] : EOT;
      return out;
    }
    return { encode: encode, length: function (text) { var e = encode(text), n = 0; while (n < CTX && e[n] !== EOT) n++; return n + 1; } };
  }

  function cropBox(w, h) {
    var s = Math.min(w, h);
    return { sx: Math.floor((w - s) / 2), sy: Math.floor((h - s) / 2), sw: s, sh: s };
  }

  // rgba: the SIZE × SIZE picture (Uint8ClampedArray, 4 bytes a pixel).
  function pixels(rgba, w, h) {
    w = w || SIZE; h = h || SIZE;
    var n = SIZE * SIZE, out = new Float32Array(3 * n);
    for (var y = 0; y < SIZE; y++) {
      for (var x = 0; x < SIZE; x++) {
        var sx = Math.min(w - 1, Math.floor(x * w / SIZE)), sy = Math.min(h - 1, Math.floor(y * h / SIZE));
        var o = (sy * w + sx) * 4, p = y * SIZE + x;
        for (var c = 0; c < 3; c++) out[c * n + p] = (rgba[o + c] / 255 - MEAN[c]) / STD[c];
      }
    }
    return out;
  }

  function normalize(vec) {
    var s = 0, i, out = new Float32Array(vec.length);
    for (i = 0; i < vec.length; i++) s += vec[i] * vec[i];
    s = Math.sqrt(s) || 1;
    for (i = 0; i < vec.length; i++) out[i] = vec[i] / s;
    return out;
  }

  function pack(vec) {
    var v = normalize(vec), out = new Int8Array(v.length);
    for (var i = 0; i < v.length; i++) out[i] = Math.max(-127, Math.min(127, Math.round(v[i] * 127)));
    return out;
  }

  function score(q, packed) {
    var s = 0, n2 = 0;
    for (var i = 0; i < packed.length; i++) { s += q[i] * packed[i]; n2 += packed[i] * packed[i]; }
    return n2 ? s / Math.sqrt(n2) : 0;
  }

  // CLIP's text-to-photo similarities sit close together (about 0.15 to
  // 0.35), so a fixed floor alone either drowns the list or empties it:
  // keep what is at least `min` and within `spread` of the best one.
  function rank(q, items, opts) {
    opts = opts || {};
    var min = opts.min == null ? 0.2 : opts.min, spread = opts.spread == null ? 0.06 : opts.spread, max = opts.max || 500;
    var qn = normalize(q), out = [];
    (items || []).forEach(function (it) {
      if (!it || !it.v || it.v.length !== qn.length) return;
      out.push({ k: it.k, s: score(qn, it.v) });
    });
    out.sort(function (a, b) { return b.s - a.s || (a.k < b.k ? -1 : a.k > b.k ? 1 : 0); });
    if (!out.length) return out;
    var floor = Math.max(min, out[0].s - spread);
    return out.filter(function (x) { return x.s >= floor; }).slice(0, max);
  }

  function blend(a, b) {
    var out = new Float32Array(a.length), na = normalize(a), nb = normalize(b);
    for (var i = 0; i < a.length; i++) out[i] = na[i] + nb[i];
    return normalize(out);
  }

  var api = {
    SIZE: SIZE, CTX: CTX, SOT: SOT, EOT: EOT, DIM: DIM, MEAN: MEAN, STD: STD,
    byteTable: byteTable, clean: clean, tokenizer: tokenizer, cropBox: cropBox, pixels: pixels,
    normalize: normalize, pack: pack, score: score, rank: rank, blend: blend
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrosClipCore = api;
})(typeof self !== "undefined" ? self : this);
