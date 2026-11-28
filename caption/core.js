// ============================================================
// orOS captions — caption/core.js (pure part, CAPTION v1)
// ------------------------------------------------------------
// The parts of Microsoft's Florence-2 base-ft (MIT) that need no
// browser: the picture → tensor step, the fixed task prompts, the
// greedy step with Florence's "no repeated 3-gram" rule, and the
// byte-level BPE (BART) ids → text step. caption/caption.js fetches
// and keeps the models, caption/worker.js runs them; apps (Photos,
// Writer, Layout) only call OrosCaption. Nothing here touches the
// network or storage.
//   SIZE = 768 (the model's square input), DIM = 768
//   PROMPTS[task] → Int32Array of input ids, task "short" | "detail"
//     ("short" = Florence's <CAPTION> "What does the image describe?",
//      "detail" = <DETAILED_CAPTION> "Describe in detail what is shown
//      in the image."), ids made by the BART tokenizer of the model
//      once (tests check them against vocab.json + merges.txt)
//   MAX_NEW[task] → how many tokens a description may take
//   pixels(rgba, w, h) → Float32Array(3 × w × h), CHW, ImageNet mean
//     and std; the caller draws the whole picture stretched to 768 ×
//     768 (Florence's processor resizes without keeping the aspect)
//   pick(logits, gen, step) → the next token id (step 0 is forced to
//     <s> 0; any token that would repeat a 3-gram of gen is skipped)
//   decoder(vocab) → { text(ids) } (special ids 0-3 left out)
//   tidy(text) → one clean sentence block: spaces collapsed, Florence's
//     "In this image we can see …" style openings cut, first letter
//     upper case, ends with a full stop
// UMD: module.exports in Node (tests), self.OrosCaptionCore in the
// browser and in the worker.
// ============================================================
(function (root) {
  "use strict";

  var SIZE = 768, DIM = 768;
  var BOS = 0, PAD = 1, EOS = 2;
  var MEAN = [0.485, 0.456, 0.406];
  var STD = [0.229, 0.224, 0.225];
  var PROMPTS = {
    "short": [0, 2264, 473, 5, 2274, 6190, 116, 2],
    "detail": [0, 47066, 21700, 11, 4617, 99, 16, 2343, 11, 5, 2274, 4, 2]
  };
  var TEXT = {
    "short": "What does the image describe?",
    "detail": "Describe in detail what is shown in the image."
  };
  var MAX_NEW = { "short": 48, "detail": 160 };

  function pixels(rgba, w, h) {
    var n = w * h, out = new Float32Array(3 * n);
    for (var i = 0; i < n; i++) {
      var j = i * 4;
      out[i] = (rgba[j] / 255 - MEAN[0]) / STD[0];
      out[n + i] = (rgba[j + 1] / 255 - MEAN[1]) / STD[1];
      out[2 * n + i] = (rgba[j + 2] / 255 - MEAN[2]) / STD[2];
    }
    return out;
  }

  // Florence's generation config: decoder starts with </s> 2, the first
  // generated token is forced to <s> 0, no_repeat_ngram_size 3. Greedy
  // (the config's 3 beams cost 3× the time for little gain here).
  function banned(gen) {
    var out = {}, n = gen.length;
    if (n < 2) return out;
    var a = gen[n - 2], b = gen[n - 1];
    for (var i = 0; i + 2 < n; i++) if (gen[i] === a && gen[i + 1] === b) out[gen[i + 2]] = true;
    return out;
  }
  function pick(logits, gen, step) {
    if (step === 0) return BOS;
    var ban = banned(gen), best = -1, bv = -Infinity;
    for (var i = 0; i < logits.length; i++) {
      if (ban[i]) continue;
      var v = logits[i];
      if (v > bv) { bv = v; best = i; }
    }
    return best < 0 ? EOS : best;
  }

  // GPT-2's byte → printable character table, which BART shares.
  function byteTable() {
    var bs = [], cs, n = 0, b;
    for (b = 33; b <= 126; b++) bs.push(b);
    for (b = 161; b <= 172; b++) bs.push(b);
    for (b = 174; b <= 255; b++) bs.push(b);
    cs = bs.slice();
    for (b = 0; b < 256; b++) if (bs.indexOf(b) === -1) { bs.push(b); cs.push(256 + n); n++; }
    var out = {};
    bs.forEach(function (x, i) { out[String.fromCharCode(cs[i])] = x; });
    return out;
  }
  function utf8Decode(bytes) {
    if (typeof TextDecoder === "function") return new TextDecoder("utf-8").decode(bytes);
    return Buffer.from(bytes).toString("utf8");
  }
  function decoder(vocab) {
    var inv = [], u2b = byteTable();
    Object.keys(vocab || {}).forEach(function (k) { inv[vocab[k]] = k; });
    return {
      text: function (ids) {
        var s = "";
        for (var i = 0; i < ids.length; i++) {
          var id = ids[i];
          if (id <= 3 || inv[id] == null) continue;     // <s> <pad> </s> <unk>
          if (/^<[^>]*>$/.test(inv[id])) continue;      // Florence's own task / location tokens
          s += inv[id];
        }
        var bytes = new Uint8Array(s.length), n = 0;
        for (var j = 0; j < s.length; j++) {
          var b = u2b[s.charAt(j)];
          if (b != null) bytes[n++] = b;
        }
        return utf8Decode(bytes.subarray(0, n));
      }
    };
  }

  var OPENINGS = [
    /^in (this|the) (image|picture|photo|photograph),? (we|you) can see\s+/i,
    /^in (this|the) (image|picture|photo|photograph),?\s+/i,
    /^(this|the) (image|picture|photo|photograph) (shows|is showing|depicts|features|contains)\s+/i,
    /^(this|the) (image|picture|photo|photograph) is (an image|a picture|a photo) of\s+/i,
    /^(we|you) can see\s+/i
  ];
  function tidy(text) {
    var s = String(text == null ? "" : text).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    for (var i = 0; i < OPENINGS.length; i++) {
      var cut = s.replace(OPENINGS[i], "");
      if (cut !== s && cut.length > 2) { s = cut; break; }
    }
    s = s.replace(/\s+([.,;:!?])/g, "$1");
    if (!s) return "";
    s = s.charAt(0).toUpperCase() + s.slice(1);
    if (!/[.!?]$/.test(s)) s += ".";
    return s;
  }

  var api = {
    SIZE: SIZE, DIM: DIM, BOS: BOS, PAD: PAD, EOS: EOS, MEAN: MEAN, STD: STD,
    PROMPTS: PROMPTS, TEXT: TEXT, MAX_NEW: MAX_NEW,
    pixels: pixels, banned: banned, pick: pick, decoder: decoder, tidy: tidy
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrosCaptionCore = api;
})(typeof self !== "undefined" ? self : this);
