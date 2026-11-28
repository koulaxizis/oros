// ============================================================
// orOS voices — Kokoro's input (voicekit/kokoro.js, v1.0.0)
// Kokoro-82M (hexgrad, Apache-2.0) reads token ids, one per phoneme
// symbol, from the vocabulary in its tokenizer.json (model.vocab), with
// 0 at both ends; it takes at most 510 ids at a time. A voice is a
// table of 510 style rows of 256 numbers (voices/<name>.bin): the row
// to use is the one for the number of ids.
//   KokoroIds.ids(ph, vocab)        → [ids] (symbols it does not know are skipped)
//   KokoroIds.chunks(ph, vocab, max?) → [ph] each at most max ids, cut
//                                     after punctuation, else at a space
//   KokoroIds.style(table, n)       → Float32Array(256), the row for n ids
//   KokoroIds.vocabOf(tokenizer)    → the vocab from tokenizer.json
// Pure: no DOM, no network. UMD: module.exports in Node, self.KokoroIds
// in the worker. tests/voicekit-english.test.js.
// ============================================================
(function (root) {
  "use strict";

  var MAX = 510, STYLE = 256;

  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function vocabOf(tok) {
    var v = tok && tok.model && tok.model.vocab;
    return v && typeof v === "object" ? v : {};
  }
  function ids(ph, vocab) {
    var out = [], s = Array.from(String(ph || ""));
    for (var i = 0; i < s.length; i++) if (own(vocab, s[i]) && typeof vocab[s[i]] === "number") out.push(vocab[s[i]]);
    return out;
  }
  // Cut a long sentence so each piece fits: after , ; : — first, then at
  // a space, and as a last resort anywhere.
  function chunks(ph, vocab, max) {
    max = Math.max(8, Math.min(MAX, max || MAX));
    var out = [], rest = String(ph || "").trim();
    while (rest) {
      if (ids(rest, vocab).length <= max) { out.push(rest); break; }
      var chars = Array.from(rest), n = 0, cut = -1, space = -1, i;
      for (i = 0; i < chars.length; i++) {
        if (own(vocab, chars[i])) n++;
        if (n > max) break;
        if (/[,;:—]/.test(chars[i])) cut = i + 1;
        else if (chars[i] === " ") space = i;
      }
      var at = cut > 0 ? cut : space > 0 ? space : i;
      out.push(chars.slice(0, at).join("").trim());
      rest = chars.slice(at).join("").trim();
    }
    return out.filter(Boolean);
  }
  function style(table, n) {
    var rows = Math.floor(table.length / STYLE);
    var r = Math.max(0, Math.min(rows - 1, n | 0));
    return table.subarray(r * STYLE, (r + 1) * STYLE);
  }

  var api = { ids: ids, chunks: chunks, style: style, vocabOf: vocabOf, MAX: MAX };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KokoroIds = api;
})(typeof self !== "undefined" ? self : this);
