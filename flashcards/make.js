// ============================================================
// orOS Flashcards — cards from other apps' text (FlashcardsMake)
// Another app hands a page, an article, a selection or a table
// through "Send to…" (send/core.js receiver "flashcards", target
// { make: { title, text } } or { make: { title, rows } }). This file
// finds the cards in it; the app shows them in a preview where the
// user unticks or edits them before anything is saved.
//   - a line "Question :: Answer"      → a Basic card
//     ("Question ::: Answer"           → Basic and reversed)
//   - a line with ==highlights==       → a Fill-in-the-gap card,
//                                         one gap per highlight
//   - a line already holding {{c1::…}} → a Fill-in-the-gap card
//   - a heading and the text under it  → a Basic card (heading on the
//     front), from the lines the two rules above did not take
//   - a table: row 1 is the heading row, then column 1 = front and
//     column 2 = back (the first two cells that are not empty)
//   - none of these: one Basic card, the title on the front and the
//     whole text on the back, for the user to shape
// Pure: no DOM, no storage. window.FlashcardsMake or module.exports.
// ============================================================
(function (root) {
  "use strict";

  var MAX_CARDS = 500;
  var TEXT_MAX = 200000;
  var FIELD_MAX = 20000;          // core.js LIMITS.field
  var HEAD_RE = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/;
  var BULLET_RE = /^\s*(?:[-*+•]|\d{1,4}[.)])\s+/;
  var CLOZE_RE = /\{\{c\d{1,3}::[\s\S]*?\}\}/g;
  var HL_RE = /==(?=\S)([^\n]*?\S)==/g;
  var SEP_RE = /^(.*?\S)\s*(:{2,3})\s+(\S.*)$|^(.*?\S)\s+(:{2,3})\s*(\S.*)$/;

  function str(s, max) {
    return typeof s === "string" ? s.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").slice(0, max) : "";
  }
  function oneLine(s, max) { return str(s, max * 2).replace(/\s+/g, " ").trim().slice(0, max); }
  function unbullet(s) { return s.replace(BULLET_RE, ""); }

  // "Q :: A" (two colons) or "Q ::: A" (three) → { q, a, rev } | null.
  // The colons need a space on at least one side, so "a::b" in code or
  // a time like 10::30 is left alone; a cloze line never splits.
  function splitLine(line) {
    if (line.indexOf("::") < 0 || /\{\{c\d{1,3}::/.test(line)) return null;
    var m = SEP_RE.exec(line);
    if (!m) return null;
    var q = m[1] !== undefined ? m[1] : m[4], sep = m[2] || m[5], a = m[3] !== undefined ? m[3] : m[6];
    q = unbullet(q).trim();
    a = a.trim();
    if (!q || !a || /^:/.test(a)) return null;
    return { q: q, a: a, rev: sep.length === 3 };
  }
  // A line with ==highlights== → the line with {{c1::…}}, {{c2::…}}, … ; "" when none.
  function highlightCloze(line) {
    var n = 0;
    var out = line.replace(HL_RE, function (all, inner) {
      if (inner.indexOf("}}") >= 0) return all;
      n++;
      return "{{c" + n + "::" + inner + "}}";
    });
    return n ? unbullet(out).trim() : "";
  }

  function fromText(text, title) {
    text = str(text, TEXT_MAX);
    title = oneLine(title, 200);
    var lines = text.split("\n"), cards = [], head = "", body = [];
    function push(c) { if (cards.length < MAX_CARDS) cards.push(c); }
    function endSection() {
      var b = body.join("\n").replace(/^\s*\n/, "").replace(/\s+$/, "");
      if (head && b.trim()) push({ k: "basic", f: { q: head, a: b.slice(0, FIELD_MAX) } });
      body = [];
    }
    lines.forEach(function (line) {
      var h = HEAD_RE.exec(line);
      if (h) { endSection(); head = h[1].slice(0, FIELD_MAX); return; }
      var qa = splitLine(line);
      if (qa) {
        push({ k: qa.rev ? "rev" : "basic", f: { q: qa.q.slice(0, FIELD_MAX), a: qa.a.slice(0, FIELD_MAX) } });
        return;
      }
      var cz = highlightCloze(line);
      if (!cz && /\{\{c\d{1,3}::/.test(line)) cz = unbullet(line).trim();
      if (cz) {
        push({ k: "cloze", f: { x: cz.slice(0, FIELD_MAX), e: head } });
        return;
      }
      body.push(line);
    });
    endSection();
    var found = dedupe(cards);
    if (found.length) return { cards: found, guess: false };
    var all = text.trim();
    if (!all) return { cards: [], guess: false };
    return { cards: [{ k: "basic", f: { q: title, a: all.slice(0, FIELD_MAX) } }], guess: true };
  }

  function cell(c) {
    if (typeof c === "number") return isFinite(c) ? String(c) : "";
    return oneLine(c, FIELD_MAX);
  }
  // Rows of a table (row 1 = the heading row, as "Send to…" hands it).
  function fromRows(rows) {
    if (!Array.isArray(rows)) return { cards: [], guess: false };
    var cards = [];
    rows.slice(rows.length > 1 ? 1 : 0).forEach(function (r) {
      if (!Array.isArray(r) || cards.length >= MAX_CARDS) return;
      var cells = r.map(cell).filter(function (c) { return !!c; });
      if (cells.length >= 2) cards.push({ k: "basic", f: { q: cells[0], a: cells[1] } });
    });
    return { cards: dedupe(cards), guess: false };
  }

  function keyOf(c) { return c.k + "\u0000" + JSON.stringify(c.f); }
  function dedupe(list) {
    var seen = {};
    return list.filter(function (c) {
      var k = keyOf(c);
      if (seen[k]) return false;
      seen[k] = 1;
      return true;
    });
  }

  // target.make → { title, cards, guess } | null (a target from another app is data, never trusted).
  function fromTarget(mk) {
    if (!mk || typeof mk !== "object") return null;
    var title = oneLine(mk.title, 200);
    var r = Array.isArray(mk.rows) ? fromRows(mk.rows) : fromText(mk.text, title);
    if (!r.cards.length) return null;
    return { title: title, cards: r.cards, guess: r.guess };
  }

  var API = { MAX_CARDS: MAX_CARDS, splitLine: splitLine, highlightCloze: highlightCloze, fromText: fromText, fromRows: fromRows, fromTarget: fromTarget };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root && typeof window !== "undefined") root.FlashcardsMake = API;
})(typeof window !== "undefined" ? window : globalThis);
