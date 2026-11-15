// ============================================================
// orOS Notes — expire.js: pages that delete themselves (STRICT-5,
// v1.0.0). Pure: no DOM, no storage. Exposes window.orosNotesExpire
// (browser) or module.exports (Node tests).
//
// A page may carry `exp` (ms since epoch). Once that time has passed,
// the first orOS that runs (Notes open, or the shell with Notes
// closed) deletes it the way Notes' own Delete does: a tomb (delete
// wins on every device on the next sync), its sub-pages move up one
// level with a fresh structure clock. Conflict copies of the page
// carry the same `exp` (notes.js mergePage).
// ============================================================
(function (root) {
  "use strict";

  var HOUR = 3600000, DAY = 24 * HOUR;
  // The choices the page menu offers (ms from now).
  var CHOICES = [{ id: "1h", ms: HOUR }, { id: "1d", ms: DAY }, { id: "7d", ms: 7 * DAY }, { id: "30d", ms: 30 * DAY }];

  function validExp(v) { return typeof v === "number" && isFinite(v) && v > 0; }

  // The same clocks as notes.js (NO-3).
  function oldCode(p) { return typeof p.ct === "number" && typeof p.st === "number" && (p.mtime || 0) > Math.max(p.ct, p.st); }
  function contentStamp(p) { return (typeof p.ct !== "number" || oldCode(p)) ? (p.mtime || 0) : p.ct; }

  // Ids of the pages whose time has come.
  function dueIds(pages, now) {
    return (pages || []).filter(function (p) { return p && validExp(p.exp) && p.exp <= now; })
      .map(function (p) { return p.id; });
  }

  // Quick check on the stored text (no parse when nothing can be due).
  function mayHave(raw) { return typeof raw === "string" && raw.indexOf('"exp":') !== -1; }

  // data: the stored Notes data { pages, tombs, … }. Changed in place.
  // → the ids deleted ([] = nothing to do).
  function expire(data, now) {
    if (!data || !Array.isArray(data.pages)) return [];
    if (!data.tombs || typeof data.tombs !== "object") data.tombs = {};
    var done = [], guard = 0, ids;
    while ((ids = dueIds(data.pages, now)).length && guard++ < 1000) {
      var id = ids[0];
      var gone = null;
      data.pages.forEach(function (p) { if (p.id === id) gone = p; });
      var upTo = gone ? (gone.parent || null) : null, nb = gone ? gone.nb : null;
      data.tombs[id] = now;
      data.pages = data.pages.filter(function (p) { return p.id !== id; });
      var kids = data.pages.filter(function (p) { return p.parent === id; }).sort(function (a, b) { return (a.pos || 0) - (b.pos || 0); });
      if (kids.length) {
        var maxPos = 0;
        data.pages.forEach(function (s) { if ((s.parent || null) === upTo && s.nb === nb && (s.pos || 0) > maxPos) maxPos = s.pos || 0; });
        kids.forEach(function (p) {
          p.parent = upTo;
          p.pos = ++maxPos;
          p.ct = contentStamp(p);
          p.st = now;
          p.mtime = now;
        });
      }
      done.push(id);
    }
    return done;
  }

  // "Deletes in 3 days" — the largest whole unit left. → { n, unit }
  // unit: "m" minutes, "h" hours, "d" days; n 0 = due now.
  function left(exp, now) {
    var ms = Math.max(0, exp - now);
    if (ms >= DAY) return { n: Math.floor(ms / DAY), unit: "d" };
    if (ms >= HOUR) return { n: Math.floor(ms / HOUR), unit: "h" };
    return { n: Math.ceil(ms / 60000), unit: "m" };
  }

  var api = { version: "1.0.0", CHOICES: CHOICES, validExp: validExp, dueIds: dueIds, mayHave: mayHave, expire: expire, left: left };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.orosNotesExpire = api;
})(typeof window !== "undefined" ? window : this);
