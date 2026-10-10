// ============================================================
// orOS Travel — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-travel-data, never writes.
// Hits:
//   • a trip: its name (else the destination); destination,
//     travellers and notes as text; the date shown is the start
//   • an itinerary entry: its title (else its kind); place, from →
//     to, booking ref, note and the trip as text; its day
//   • a packing item: its name; note, who, custom group and the
//     trip as text
// Templates are not searched (reusable lists, not trips). Deleted
// trips / items / entries: a tombstone in tombs{} at or after the
// entity's life (its newest field stamp in f{}) hides it, exactly
// as the merge does; a deleted trip hides all it holds.
// Opens through the generic deep link: target { trip, tab, item }
// (tab "pack" | "plan" or null for a trip; item = the entry or
// packing item id, null for a trip).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-travel-data";
  var YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
  var KIND = {
    en: { flight: "Flight", train: "Train", bus: "Bus", ferry: "Ferry", car: "Car",
          stay: "Stay", activity: "Activity", food: "Food", other: "Other" },
    el: { flight: "Πτήση", train: "Τρένο", bus: "Λεωφορείο", ferry: "Πλοίο", car: "Αυτοκίνητο",
          stay: "Διαμονή", activity: "Δραστηριότητα", food: "Φαγητό", other: "Άλλο" }
  };

  function str(v) { return typeof v === "string" ? v.trim() : ""; }
  function arr(a) { return Array.isArray(a) ? a : []; }
  function dayMs(s) {
    var m = typeof s === "string" && YMD.exec(s);
    return m ? new Date(+m[1], +m[2] - 1, +m[3], 12).getTime() : 0;
  }
  function life(e) {
    var m = 0, f = e && e.f && typeof e.f === "object" ? e.f : {};
    Object.keys(f).forEach(function (k) { if (typeof f[k] === "number" && f[k] > m) m = f[k]; });
    return m;
  }

  var PROVIDER = {
    id: "travel",
    keys: [KEY],
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [], el = ctx.lang === "el";
      if (!d || !Array.isArray(d.trips)) return out;
      var tombs = d.tombs && typeof d.tombs === "object" ? d.tombs : {};
      function gone(x) {
        return !x || typeof x.id !== "string" ||
          (typeof tombs[x.id] === "number" && tombs[x.id] >= life(x));
      }
      d.trips.forEach(function (tr) {
        if (gone(tr)) return;
        var tname = str(tr.name) || str(tr.dest) || (el ? "Ταξίδι χωρίς όνομα" : "Untitled trip");
        out.push({
          id: tr.id,
          title: tname,
          text: [str(tr.name) ? str(tr.dest) : "",
                 arr(tr.people).map(str).filter(Boolean).join(", "),
                 str(tr.notes)].filter(Boolean).join(" · "),
          when: dayMs(tr.start),
          target: { trip: tr.id, tab: null, item: null }
        });
        arr(tr.plan).forEach(function (p) {
          if (gone(p)) return;
          var kind = (el ? KIND.el : KIND.en)[p.kind] || (el ? KIND.el.other : KIND.en.other);
          var route = [str(p.from), str(p.to)].filter(Boolean).join(" → ");
          out.push({
            id: p.id,
            title: str(p.title) || kind,
            text: [str(p.title) ? kind : "", str(p.place), route, str(p.ref), str(p.note), tname]
              .filter(Boolean).join(" · "),
            when: dayMs(p.day),
            target: { trip: tr.id, tab: "plan", item: p.id }
          });
        });
        arr(tr.pack).forEach(function (p) {
          if (gone(p) || !str(p.name)) return;
          var grp = str(p.grp);
          out.push({
            id: p.id,
            title: str(p.name),
            text: [str(p.note), str(p.who), grp.charAt(0) === "@" ? "" : grp, tname]
              .filter(Boolean).join(" · "),
            target: { trip: tr.id, tab: "pack", item: p.id }
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
