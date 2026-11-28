// ============================================================
// orOS — semantic-core.js (search by meaning, pure part, v1.0.0)
// ------------------------------------------------------------
// The parts of "search by meaning" that need no DOM, no storage and
// no model runtime, so they run the same in the shell, in
// semantic-worker.js and in Node (tests/semantic-core.test.js).
// The model is multilingual-e5-small (MIT; int8 ONNX export by
// Xenova), from our mirror koulaxizis/oros-models-vision.
//
//   normalize(s)            → the text as the e5 tokenizer sees it
//                             (NFKC, no control characters, single
//                             spaces; tokenizer.json's Precompiled +
//                             Replace normalizers)
//   makeTokenizer(json)     → { encode(text, max) → number[] }
//                             XLM-R Unigram (SentencePiece) over
//                             tokenizer.json's vocab: Metaspace "▁"
//                             words, Viterbi best split, unknown
//                             characters as <unk> (fused), then
//                             <s> … </s>, cut to max tokens.
//   pool(hidden, mask, n, len, dim) → [Float32Array(dim)] mean over
//                             the real tokens, length 1 (e5's pooling)
//   query(s) / passage(s)   → the "query: " / "passage: " prefixes e5
//                             was trained with
//   passages(hit)           → 1–3 passage texts for one search hit
//                             (title + text, cut at word ends)
//   pack(vec) / unpack(i8)  → Float32 ↔ Int8Array (direction only,
//                             largest number ±127), 384 bytes
//   score(q, i8)            → cosine of a query vector and a packed one
//   hash(s)                 → FNV-1a 32 as 8 hex characters: an index
//                             entry is made again only when it changes
//   rank(q, entries, opts)  → [{ k, s }] best first: over a floor, over
//                             the collection's mean + 1.5σ (20+ items)
//                             and within `spread` of the best
// UMD: window/self.OrosSemanticCore, or module.exports in Node.
// ============================================================
(function (root) {
  "use strict";

  var DIM = 384;
  var MAX_TOKENS = 256;        // per passage (the model takes 512; 256 is twice as fast)
  var CHUNK_CHARS = 1000;      // one passage ≈ 1,000 characters ≈ 200–250 tokens
  var MAX_CHUNKS = 3;          // a long note or mail: its first ~3,000 characters
  var FLOOR = 0.78;            // e5 cosines bunch up high (0.75–0.90): under this is unrelated
  var SPREAD = 0.04;           // keep hits within this of the best one
  var LIFT = 1.5;              // with 20+ items: a hit must stand this many σ over the mean
  var SP = "▁";           // SentencePiece's "▁" word mark

  // ---------- 1. Normalizing ----------
  // eslint-disable-next-line no-control-regex
  var CTRL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​‎‏‪-‮⁠﻿]/g;
  function normalize(s) {
    s = String(s == null ? "" : s);
    if (s.normalize) s = s.normalize("NFKC");
    return s.replace(CTRL, "").replace(/\s+/g, " ").trim();
  }

  // ---------- 2. Tokenizer (XLM-R Unigram) ----------
  function makeTokenizer(json) {
    var t = typeof json === "string" ? JSON.parse(json) : json;
    if (!t || !t.model || t.model.type !== "Unigram" || !Array.isArray(t.model.vocab)) {
      throw new Error("tokenizer");
    }
    var vocab = t.model.vocab, map = new Map(), maxLen = 1, minScore = 0;
    var special = {};
    (Array.isArray(t.added_tokens) ? t.added_tokens : []).forEach(function (a) {
      if (a && typeof a.content === "string") special[a.content] = a.id;
    });
    for (var i = 0; i < vocab.length; i++) {
      var piece = vocab[i][0], sc = vocab[i][1];
      if (special[piece] === i) continue;           // <s>, <pad>, </s>, <unk>, <mask> are never matched in text
      map.set(piece, i);
      var n = Array.from(piece).length;
      if (n > maxLen) maxLen = n;
      if (sc < minScore) minScore = sc;
    }
    var scores = new Float64Array(vocab.length);
    for (var j = 0; j < vocab.length; j++) scores[j] = vocab[j][1];
    var UNK = typeof t.model.unk_id === "number" ? t.model.unk_id : 3;
    var BOS = special["<s>"] !== undefined ? special["<s>"] : 0;
    var EOS = special["</s>"] !== undefined ? special["</s>"] : 2;
    var unkScore = minScore - 10;

    // Best split of one "▁word" (Viterbi over code points).
    function word(chars, out) {
      var n = chars.length;
      var best = new Float64Array(n + 1), from = new Int32Array(n + 1), tok = new Int32Array(n + 1);
      for (var e = 1; e <= n; e++) best[e] = -Infinity;
      best[0] = 0;
      for (var s = 0; s < n; s++) {
        if (best[s] === -Infinity) continue;
        var str = "", single = false;
        for (var l = 1; l <= maxLen && s + l <= n; l++) {
          str += chars[s + l - 1];
          var id = map.get(str);
          if (id === undefined) continue;
          if (l === 1) single = true;
          var v = best[s] + scores[id];
          if (v > best[s + l]) { best[s + l] = v; from[s + l] = s; tok[s + l] = id; }
        }
        if (!single) {
          var u = best[s] + unkScore;
          if (u > best[s + 1]) { best[s + 1] = u; from[s + 1] = s; tok[s + 1] = UNK; }
        }
      }
      var ids = [];
      for (var p = n; p > 0; p = from[p]) ids.push(tok[p]);
      ids.reverse();
      for (var k = 0; k < ids.length; k++) {
        if (ids[k] === UNK && out.length && out[out.length - 1] === UNK) continue;   // fuse_unk
        out.push(ids[k]);
      }
    }
    function encode(text, max) {
      max = max > 2 ? max : MAX_TOKENS;
      var s = normalize(text), out = [];
      if (s) {
        var words = s.split(" ");
        for (var i = 0; i < words.length && out.length < max - 2; i++) {
          if (words[i]) word(Array.from(SP + words[i]), out);
        }
      }
      if (out.length > max - 2) out.length = max - 2;
      return [BOS].concat(out, [EOS]);
    }
    return { encode: encode, size: vocab.length };
  }

  // ---------- 3. Pooling and vectors ----------
  // hidden: Float32Array [n × len × dim], mask: per row the number of
  // real tokens (padding is at the end).
  function pool(hidden, lens, n, len, dim) {
    var out = [];
    for (var r = 0; r < n; r++) {
      var v = new Float32Array(dim), cnt = Math.max(1, lens[r]);
      for (var t = 0; t < lens[r]; t++) {
        var base = (r * len + t) * dim;
        for (var d = 0; d < dim; d++) v[d] += hidden[base + d];
      }
      var norm = 0;
      for (var d2 = 0; d2 < dim; d2++) { v[d2] /= cnt; norm += v[d2] * v[d2]; }
      norm = Math.sqrt(norm) || 1;
      for (var d3 = 0; d3 < dim; d3++) v[d3] /= norm;
      out.push(v);
    }
    return out;
  }
  // Packed vectors keep only the direction: each one is scaled so its
  // largest number is ±127 (four to five times finer than ×127 for
  // e5's spread-out vectors); score() divides the length out again.
  function pack(vec) {
    var max = 0;
    for (var i = 0; i < vec.length; i++) { var a = Math.abs(vec[i]); if (a > max) max = a; }
    var q = new Int8Array(vec.length), k = max ? 127 / max : 0;
    for (var j = 0; j < vec.length; j++) {
      var x = Math.round(vec[j] * k);
      q[j] = x > 127 ? 127 : x < -127 ? -127 : x;
    }
    return q;
  }
  function unpack(q) {
    var v = new Float32Array(q.length), n = 0;
    for (var i = 0; i < q.length; i++) n += q[i] * q[i];
    n = Math.sqrt(n) || 1;
    for (var j = 0; j < q.length; j++) v[j] = q[j] / n;
    return v;
  }
  function score(qv, packed) {
    var s = 0, n2 = 0;
    for (var i = 0; i < qv.length; i++) { s += qv[i] * packed[i]; n2 += packed[i] * packed[i]; }
    return n2 ? s / Math.sqrt(n2) : 0;   // packed vectors lose a little length: divide it out
  }

  // ---------- 4. Texts ----------
  function query(s) { return "query: " + normalize(s); }
  function passage(s) { return "passage: " + normalize(s); }
  function cut(s, max) {
    if (s.length <= max) return [s, ""];
    var at = s.lastIndexOf(" ", max);
    if (at < max * 0.6) at = max;
    return [s.slice(0, at), s.slice(at).replace(/^ /, "")];
  }
  function passages(hit) {
    if (!hit) return [];
    var title = normalize(hit.title), text = normalize(hit.text);
    var all = title && text ? title + ". " + text : title || text;
    var out = [];
    while (all && out.length < MAX_CHUNKS) {
      var c = cut(all, CHUNK_CHARS);
      out.push(passage(out.length && title ? title + ". " + c[0] : c[0]));
      all = c[1];
    }
    return out;
  }
  function hash(s) {
    s = String(s);
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return ("0000000" + h.toString(16)).slice(-8);
  }

  // ---------- 5. Ranking ----------
  // entries: [{ k, v: [Int8Array, …] }] (one vector per passage; the
  // best passage counts). opts { floor, spread, max }.
  function rank(qv, entries, opts) {
    opts = opts || {};
    var floor = typeof opts.floor === "number" ? opts.floor : FLOOR;
    var spread = typeof opts.spread === "number" ? opts.spread : SPREAD;
    var max = opts.max > 0 ? opts.max : 8;
    var all = [], sum = 0, sum2 = 0;
    (entries || []).forEach(function (e) {
      if (!e || !Array.isArray(e.v)) return;
      var best = -1;
      e.v.forEach(function (p) { if (p && p.length === qv.length) { var s = score(qv, p); if (s > best) best = s; } });
      if (best < 0) return;
      all.push({ k: e.k, s: best });
      sum += best; sum2 += best * best;
    });
    var cutAt = floor;
    if (all.length >= 20) {
      var mean = sum / all.length, sd = Math.sqrt(Math.max(0, sum2 / all.length - mean * mean));
      cutAt = Math.max(floor, mean + LIFT * sd);
    }
    var out = all.filter(function (x) { return x.s >= cutAt; });
    out.sort(function (a, b) { return b.s - a.s || (a.k < b.k ? -1 : a.k > b.k ? 1 : 0); });
    if (!out.length) return out;
    var top = out[0].s;
    return out.filter(function (x) { return x.s >= top - spread; }).slice(0, max);
  }

  var api = {
    DIM: DIM, MAX_TOKENS: MAX_TOKENS, FLOOR: FLOOR, SPREAD: SPREAD,
    normalize: normalize, makeTokenizer: makeTokenizer, pool: pool,
    pack: pack, unpack: unpack, score: score, query: query, passage: passage,
    passages: passages, hash: hash, rank: rank
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosSemanticCore = api;
})(typeof self !== "undefined" ? self : (typeof window !== "undefined" ? window : globalThis));
