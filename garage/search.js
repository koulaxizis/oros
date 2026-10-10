// ============================================================
// orOS Garage — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-garage-data, never writes.
// Hits:
//   • a vehicle: its name; make, model, year, plate, notes as text
//   • a renewal (KTEO, insurance, …): its name; provider, policy
//     ref, notes, vehicle as text; the date shown is the expiry
//   • a service plan: item name + label; vehicle as text
//   • a tyre set: its label; brand, size, notes, vehicle as text
//   • a service visit: its items; shop, notes, vehicle; its day
//   • a fill-up / charge with a station or notes; its day
//   • an other cost with notes; its day
// Item / renewal names come from OrosGarageCore (loaded by the
// shell); without it the language-free id is shown. Archived
// vehicles and their rows are skipped; deleted rows leave the lists
// (tombstones in tombs{}), and a row whose tombstone is at or after
// its m is skipped too, the way the merge hides it.
// Opens through the existing Garage bridge (__orosOpenGarage):
// target = the vehicle, renewal, plan or tyre id (the bridge opens
// the vehicle, or the row's editor). Visits, fill-ups and costs have
// no editor in the bridge: their target is their vehicle's id.
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-garage-data";
  var YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

  function str(v) { return typeof v === "string" ? v.trim() : ""; }
  function arr(a) { return Array.isArray(a) ? a : []; }
  function dayMs(s) {
    var m = typeof s === "string" && YMD.exec(s);
    return m ? new Date(+m[1], +m[2] - 1, +m[3], 12).getTime() : 0;
  }
  function firstLine(s) {
    return String(s || "").split("\n").map(function (l) { return l.trim(); })
      .filter(Boolean)[0] || "";
  }
  function core() { return root && root.OrosGarageCore ? root.OrosGarageCore : null; }
  function itemName(it, lang) {
    var c = core();
    return c && typeof c.itemName === "function" ? c.itemName(it, lang) : String(it || "");
  }
  function renewalName(kind, lang) {
    var c = core();
    return c && typeof c.renewalName === "function" ? c.renewalName(kind, lang) : String(kind || "");
  }

  var PROVIDER = {
    id: "garage",
    keys: [KEY],
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [], el = ctx.lang === "el";
      if (!d || !Array.isArray(d.vehicles)) return out;
      var tombs = d.tombs && typeof d.tombs === "object" ? d.tombs : {};
      function gone(x) {
        return !x || typeof x.id !== "string" ||
          (typeof tombs[x.id] === "number" && tombs[x.id] >= (Number(x.m) || 0));
      }
      var veh = {};
      d.vehicles.forEach(function (v) {
        if (gone(v) || v.arch === 1) return;
        var name = str(v.name) || (el ? "Όχημα χωρίς όνομα" : "Unnamed vehicle");
        veh[v.id] = name;
        out.push({
          id: v.id,
          title: name,
          text: [[str(v.make), str(v.model)].filter(Boolean).join(" "),
                 v.year ? String(v.year) : "", str(v.plate), str(v.notes)]
            .filter(Boolean).join(" · "),
          target: v.id
        });
      });
      function rows(list, f) {
        arr(list).forEach(function (x) {
          if (gone(x) || typeof x.v !== "string" || !veh[x.v]) return;
          var h = f(x, veh[x.v]);
          if (h) out.push(h);
        });
      }
      rows(d.renewals, function (r, vn) {
        var kind = renewalName(r.kind, ctx.lang), label = str(r.label);
        return {
          id: r.id,
          title: r.kind === "other" && label ? label : [kind, label].filter(Boolean).join(" · "),
          text: [str(r.prov), str(r.ref), str(r.n), vn].filter(Boolean).join(" · "),
          when: dayMs(r.exp),
          target: r.id
        };
      });
      rows(d.plans, function (p, vn) {
        return {
          id: p.id,
          title: [itemName(p.item, ctx.lang), str(p.label)].filter(Boolean).join(" · "),
          text: vn,
          target: p.id
        };
      });
      rows(d.tyres, function (t, vn) {
        return {
          id: t.id,
          title: str(t.label) || (el ? "Ελαστικά" : "Tyres"),
          text: [str(t.brand), str(t.size), str(t.n), vn].filter(Boolean).join(" · "),
          target: t.id
        };
      });
      rows(d.service, function (s, vn) {
        return {
          id: s.id,
          title: arr(s.items).map(function (it) { return itemName(it, ctx.lang); })
            .filter(Boolean).join(", ") || (el ? "Σέρβις" : "Service"),
          text: [str(s.shop), str(s.n), vn].filter(Boolean).join(" · "),
          when: dayMs(s.d),
          target: s.v
        };
      });
      rows(d.fuel, function (f, vn) {
        var st = str(f.st), n = str(f.n);
        if (!st && !n) return null;
        return {
          id: f.id,
          title: st || firstLine(n).slice(0, 60),
          text: [st ? n : "", vn].filter(Boolean).join(" · "),
          when: dayMs(f.d),
          target: f.v
        };
      });
      rows(d.costs, function (c, vn) {
        var n = str(c.n);
        if (!n) return null;
        return {
          id: c.id,
          title: firstLine(n).slice(0, 60),
          text: [n, vn].join(" · "),
          when: dayMs(c.d),
          target: c.v
        };
      });
      return out;
    },
    open: function (target, win) {
      if (typeof target === "string" && win && typeof win.__orosOpenGarage === "function") {
        win.__orosOpenGarage(target);
      } else if (win && typeof win.__orosOpenAt === "function") {
        win.__orosOpenAt("garage", null);
      }
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosSearchProviders = root.orosSearchProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
