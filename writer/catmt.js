// ============================================================
// orOS Writer — catmt.js: machine suggestions for book translation
// (WR-CAT, wave T5). No DOM, no storage: it asks the shared engine of
// Text Tools (window.OrosTranslate, translate/engine.js, Bible
// "TRANSLATE") and keeps the answers in memory. Tested in Node with a
// fake engine (tests/writer-catmt.test.js).
//   - off by default; the person turns it on per device (cat.js)
//   - a suggestion is offered under the open segment, never put in by
//     itself; "fill empty segments" writes drafts only
//   - the open segment and the next few untranslated ones go to the
//     engine together (one model load, the next segment is ready)
//   - the glossary's terms of those segments go along (the engine uses
//     them on its AI path; models ignore them)
//   - the engine keeps ⟦n⟧ tags; tagsOk false = some did not come back
// Ctl(engine, from, to) → { status, suggest, cached, fill, drop }
// Exposes window.WriterCatMT (browser) or module.exports.
// ============================================================
(function (root) {
  "use strict";

  var node = typeof module !== "undefined" && module.exports;
  var C = node ? require("./catcore.js") : root.WriterCatCore;

  var AHEAD = 5;        // untranslated segments sent along with the open one
  var BATCH = 32;       // segments per call when filling
  var MAX_TERMS = 50;
  var LETTER = /\p{L}/u;     // numbers alone are not sent

  function err(code) { var e = new Error(code); e.code = code; return e; }

  // the glossary terms found in some segments → [{ src, tgt }] (≤ 50)
  function termsFor(terms, texts) {
    var out = [], seen = {};
    if (!terms || typeof terms.find !== "function") return out;
    texts.forEach(function (s) {
      terms.find(String(s || "").replace(C.TAG_RX, " ")).forEach(function (h) {
        var e = h.e;
        if (!e || !e.tgt || seen[e.term] || out.length >= MAX_TERMS) return;
        seen[e.term] = 1;
        out.push({ src: e.term, tgt: e.tgt });
      });
    });
    return out;
  }
  // a segment without a translation yet (no text, not marked done)
  function empty(rows, i) {
    var r = rows && rows[i];
    return !r || (!r[0].trim() && r[1] < C.ST_DONE);
  }
  function clean(res) {
    var r = res && typeof res === "object" ? res : {};
    var o = { text: String(r.text == null ? "" : r.text).slice(0, C.MAX_TEXT), engine: r.engine === "ai" ? "ai" : "bergamot", tagsOk: r.tagsOk !== false };
    if (o.engine === "ai" && typeof r.via === "string") o.via = r.via.slice(0, 60);
    return o;
  }

  function Ctl(engine, from, to) {
    if (!engine || typeof engine.translateMany !== "function") throw err("engine");
    var self = this, cache = {}, flight = {};
    // what the person can do now: { ok, legs, need, mb, ai, unsupported }
    self.status = function () {
      var ai = !!(engine.ai && typeof engine.ai.on === "function" && engine.ai.on());
      return Promise.resolve(engine.status(from, to)).then(function (st) {
        st = st || {};
        return { ok: !!st.ok || (!st.legs && ai), legs: st.legs || null, need: st.need || [], mb: st.mb || 0, ai: ai };
      });
    };
    self.cached = function (src, i) {
      var c = cache[i];
      return c && c.s === src.segs[i].s ? c.r : null;
    };
    // the suggestion for segment i (and the next few empty ones) → Promise<{ text, engine, tagsOk, via? }>
    self.suggest = function (src, rows, i, terms) {
      var hit = self.cached(src, i);
      if (hit) return Promise.resolve(hit);
      if (flight[i]) return flight[i];
      var ids = [i];
      for (var k = i + 1; k < src.segs.length && ids.length <= AHEAD; k++) {
        if (!flight[k] && !self.cached(src, k) && empty(rows, k)) ids.push(k);
      }
      var texts = ids.map(function (k) { return src.segs[k].s; });
      var p = Promise.resolve(engine.translateMany(texts, { from: from, to: to, terms: termsFor(terms, texts), engine: "auto" })).then(function (list) {
        ids.forEach(function (k, j) { cache[k] = { s: src.segs[k].s, r: clean(list && list[j]) }; delete flight[k]; });
        return cache[i].r;
      }, function (e) {
        ids.forEach(function (k) { delete flight[k]; });
        throw e;
      });
      ids.forEach(function (k) { flight[k] = p; });
      return p;
    };
    // every empty segment → { "<i>": text } (texts the engine gave back
    // empty are left out). opts: { progress(done, total), cancelled(), terms }
    self.fill = function (src, rows, opts) {
      opts = opts || {};
      var cancelled = opts.cancelled || function () { return false; };
      var todo = [];
      src.segs.forEach(function (sg, i) { if (empty(rows, i) && LETTER.test(C.plainText(src, i))) todo.push(i); });
      var out = {}, done = 0;
      function step(at) {
        if (at >= todo.length) return Promise.resolve(out);
        if (cancelled()) return Promise.reject(err("cancelled"));
        var ids = [], texts = [];
        todo.slice(at, at + BATCH).forEach(function (i) {
          var hit = self.cached(src, i);
          if (hit) { if (hit.text.trim()) out[i] = hit.text; done++; } else { ids.push(i); texts.push(src.segs[i].s); }
        });
        var go = ids.length ? Promise.resolve(engine.translateMany(texts, { from: from, to: to, terms: termsFor(opts.terms, texts), engine: "auto", cancelled: cancelled })) : Promise.resolve([]);
        return go.then(function (list) {
          ids.forEach(function (i, j) {
            var r = clean(list && list[j]);
            cache[i] = { s: src.segs[i].s, r: r };
            if (r.text.trim()) out[i] = r.text;
            done++;
          });
          if (opts.progress) opts.progress(done, todo.length);
          return step(at + BATCH);
        });
      }
      return step(0);
    };
    self.count = function (src, rows) {
      var n = 0;
      src.segs.forEach(function (sg, i) { if (empty(rows, i) && LETTER.test(C.plainText(src, i))) n++; });
      return n;
    };
    self.drop = function () { cache = {}; flight = {}; };
  }

  var api = { Ctl: Ctl, termsFor: termsFor, AHEAD: AHEAD, BATCH: BATCH };
  if (node) module.exports = api;
  else root.WriterCatMT = api;
})(this);
