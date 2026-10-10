// ============================================================
// orOS Baby — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-baby-data, never writes.
// Sensitive data: the app ships with "searchOff": true (opt-in).
// Hits:
//   - one per child: the name.
//   - one per logged event with a text (medicine, note, solids…):
//     the kind as title, the text and the child as text; the date
//     shown is the event's start.
//   - one per milestone / vaccine / doctor visit with words: its
//     label (a ready milestone without one: "Milestone") as title,
//     its note and the child as text; the date shown is its day.
// Skipped: tombstones ({ id, m, del: 1 }) and the records of a
// deleted child. Growth rows hold numbers only.
// Opens through the generic deep link: target { kid }, { kid, ev }
// or { kid, mk } (baby.js openSearchTarget picks the child and
// opens the event / mark dialog).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-baby-data";
  var YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
  var KIND = {
    feed:   { en: "Breastfeed",  el: "Θηλασμός" },
    bottle: { en: "Bottle",      el: "Μπιμπερό" },
    solid:  { en: "Solids",      el: "Στερεά" },
    sleep:  { en: "Sleep",       el: "Ύπνος" },
    diaper: { en: "Nappy",       el: "Πάνα" },
    pump:   { en: "Pump",        el: "Άντληση" },
    med:    { en: "Medicine",    el: "Φάρμακο" },
    temp:   { en: "Temperature", el: "Θερμοκρασία" },
    bath:   { en: "Bath",        el: "Μπάνιο" },
    tummy:  { en: "Tummy time",  el: "Μπρούμυτα" },
    note:   { en: "Note",        el: "Σημείωση" },
    ms:     { en: "Milestone",   el: "Ορόσημο" },
    vac:    { en: "Vaccine",     el: "Εμβόλιο" },
    doc:    { en: "Doctor visit", el: "Επίσκεψη" }
  };

  function str(v) { return typeof v === "string" ? v.trim() : ""; }
  function arr(a) { return Array.isArray(a) ? a : []; }
  function dayMs(s) {
    var m = typeof s === "string" && YMD.exec(s);
    return m ? new Date(+m[1], +m[2] - 1, +m[3], 12).getTime() : 0;
  }
  function ok(x) { return x && typeof x === "object" && typeof x.id === "string" && !x.del; }

  var PROVIDER = {
    id: "baby",
    keys: [KEY],
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [];
      if (!d || !Array.isArray(d.kids)) return out;
      var lang = ctx.lang === "el" ? "el" : "en";
      var kids = {};
      d.kids.forEach(function (k) {
        if (!ok(k)) return;
        kids[k.id] = str(k.n);
        if (!kids[k.id]) return;
        out.push({ id: "kid:" + k.id, title: kids[k.id], target: { kid: k.id } });
      });
      arr(d.ev).forEach(function (e) {
        if (!ok(e) || !(e.k in kids) || !KIND[e.t]) return;
        var tx = str(e.tx);
        if (!tx) return;
        out.push({
          id: "ev:" + e.id,
          title: KIND[e.t][lang],
          text: [tx, kids[e.k]].filter(Boolean).join(" · "),
          when: typeof e.ts === "number" ? e.ts : 0,
          target: { kid: e.k, ev: e.id }
        });
      });
      arr(d.mk).forEach(function (x) {
        if (!ok(x) || !(x.k in kids) || !KIND[x.t]) return;
        var tx = str(x.tx), nt = str(x.nt);
        if (!tx && !nt) return;
        out.push({
          id: "mk:" + x.id,
          title: tx || KIND[x.t][lang],
          text: [nt, kids[x.k]].filter(Boolean).join(" · "),
          when: dayMs(x.d),
          target: { kid: x.k, mk: x.id }
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
