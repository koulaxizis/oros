// ============================================================
// orOS Slides — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-slides-data, never writes.
// One hit per slide: its title placeholder (else its first line of
// text, else "Slide n") as the title; the other text boxes, picture
// descriptions, speaker notes (and, on the first slide, the
// presentation's title) as text. A presentation without slides gets
// one hit of its own.
// The date is the slide's last change (its m / nm / tm clocks).
// Skipped: ghosts (deleted decks and slides live in ghosts{}, never
// read), and anything a tombstone covers, as core.js mergeSlides
// does (deck: max(m, tm) > its tomb; slide: max(m, nm, tm) > its own
// and its deck's tomb; item: m > its own, its slide's and deck's).
// Opens through the generic deep link: target { deck, slide }.
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-slides-data";

  function own(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function vals(o) { return o && typeof o === "object" ? Object.keys(o).map(function (k) { return o[k]; }) : []; }
  function num(v) { return typeof v === "number" && isFinite(v) ? v : 0; }
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function str(v) { return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : ""; }
  function paras(it) {
    return (Array.isArray(it.paras) ? it.paras : []).map(function (p) {
      return p && Array.isArray(p.r) ? p.r.map(function (r) { return r && typeof r.t === "string" ? r.t : ""; }).join("") : "";
    }).map(str).filter(Boolean);
  }

  var PROVIDER = {
    id: "slides",
    keys: [KEY],
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [];
      if (!d || !d.decks || typeof d.decks !== "object") return out;
      var tombs = d.tombs && typeof d.tombs === "object" ? d.tombs : {};
      function tomb(id) { return own(tombs, id) ? num(tombs[id]) : 0; }
      var el = ctx.lang === "el";
      var decks = {};
      vals(d.decks).forEach(function (dk) {
        if (dk && typeof dk.id === "string" && Math.max(num(dk.m), num(dk.tm)) > tomb(dk.id)) decks[dk.id] = dk;
      });
      var byDeck = {};
      vals(d.slides).forEach(function (s) {
        if (!s || typeof s.id !== "string" || !own(decks, s.d)) return;
        if (!(Math.max(num(s.m), num(s.nm), num(s.tm)) > Math.max(tomb(s.id), tomb(s.d)))) return;
        (byDeck[s.d] = byDeck[s.d] || []).push(s);
      });
      var bySlide = {};
      vals(d.items).forEach(function (it) {
        if (!it || typeof it.id !== "string" || typeof it.s !== "string") return;
        (bySlide[it.s] = bySlide[it.s] || []).push(it);
      });
      Object.keys(decks).forEach(function (deckId) {
        var dk = decks[deckId];
        var deckTitle = str(dk.t) || (el ? "Παρουσίαση χωρίς τίτλο" : "Untitled presentation");
        if (!byDeck[deckId]) {      // a presentation without slides: one hit for it
          out.push({ id: deckId, title: deckTitle, text: "", when: Math.max(num(dk.m), num(dk.tm)),
                     target: { deck: deckId } });
          return;
        }
        byDeck[deckId].sort(function (x, y) { return cmpStr(x.p, y.p) || cmpStr(x.id, y.id); })
          .forEach(function (s, idx) {
            var cut = Math.max(tomb(s.id), tomb(deckId));
            var items = (bySlide[s.id] || []).filter(function (it) {
              return num(it.m) > Math.max(cut, tomb(it.id));
            }).sort(function (x, y) { return num(x.z) - num(y.z) || cmpStr(x.id, y.id); });
            var title = "", rest = [];
            items.forEach(function (it) {
              if (it.k === "text") {
                var ps = paras(it);
                if (!ps.length) return;
                if (it.ph === "title" && !title) { title = ps.join(" "); return; }
                rest.push(ps.join(" "));
              } else if (it.k === "image" && it.img && str(it.img.alt)) {
                rest.push(str(it.img.alt));
              }
            });
            if (!title) {
              var firstText = null;
              items.forEach(function (it) { if (!firstText && it.k === "text" && paras(it).length) firstText = it; });
              if (firstText) {
                var ps = paras(firstText);
                title = ps[0];
                var i = rest.indexOf(ps.join(" "));
                if (i !== -1) { rest.splice(i, 1); if (ps.length > 1) rest.unshift(ps.slice(1).join(" ")); }
              }
            }
            out.push({
              id: s.id,
              title: title || (el ? "Διαφάνεια " : "Slide ") + (idx + 1),
              text: rest.concat([str(s.n), idx === 0 ? deckTitle : ""]).filter(Boolean).join(" · "),
              when: Math.max(num(s.m), num(s.nm), num(s.tm)),
              target: { deck: deckId, slide: s.id }
            });
          });
      });
      return out;
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosSearchProviders = root.orosSearchProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
