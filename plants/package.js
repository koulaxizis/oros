// ============================================================
// orOS Plant Care — .orosplants file (plants/package.js,
// window.OrosPlantsPackage). The descriptor of Plant Care for the
// record apps' kit (../recordpkg.js, docs/oros-bundle.md "Record
// apps"): every plant (schedule, room, notes) and its care history in
// one orOS bundle; opening one ADDS what this device lacks, with its
// ids. Pure (no DOM, no storage), so the app and `node --test` run the
// same code. Needs core.js (window.OrosPlantsCore; require("./core.js")
// under Node).
//   DESC                     the kit descriptor; merge = core.js merge
//                            (pure: plants LWW per id, log union, this
//                            device's tombstones kept), which only ever
//                            sees the records the kit let through, so a
//                            clash keeps the local plant
//   DESC.norm(data)          a file's data → { ver, plants, log } with
//                            core.js's own normPlant / normLog (invalid
//                            rows dropped), capped counts; a history
//                            entry whose plant is not in the file goes
//   DESC.strip(state)        the slice → { ver, plants, log }: no
//                            tombstones. Device prefs (reminder hour,
//                            hemisphere, tab, room filter, the Pl@ntNet
//                            key) live in oros-plants-prefs, never here
//   DESC.tombIds(state)      the ids in state.tombs
//   DESC.previews(state, l)  plants.md (readable), plants.csv and
//                            history.csv (CSV with a formula guard)
//   kindOf(id, state)        "plant" | "log" | ""
// No photos: Plant Care keeps none (an identification photo is sent
// to Pl@ntNet and not kept), so the file has no media/.
// ============================================================
(function (root) {
  "use strict";

  var C = typeof module === "object" && module.exports ? require("./core.js") : root.OrosPlantsCore;
  var LIM = { plants: C.MAX_PLANTS, log: 50000 };

  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  function norm(data) {
    if (!isObj(data)) return null;
    var out = { ver: C.DATA_VER, plants: [], log: [] }, have = {};
    (Array.isArray(data.plants) ? data.plants : []).slice(0, LIM.plants).forEach(function (x) {
      var p = C.normPlant(x);
      if (p && !have[p.id]) { have[p.id] = 1; out.plants.push(p); }
    });
    (Array.isArray(data.log) ? data.log : []).slice(0, LIM.log).forEach(function (x) {
      var e = C.normLog(x);
      if (e && have[e.p]) out.log.push(e);
    });
    if (isObj(data.tombs)) {                   // strip and tombIds see them, then they go
      out.tombs = {};
      Object.keys(data.tombs).forEach(function (id) { if (C.ID_RE.test(id)) out.tombs[id] = 1; });
    }
    return out;
  }
  function strip(state) {
    var s = isObj(state) ? state : {};
    return clone({ ver: C.DATA_VER,
                   plants: Array.isArray(s.plants) ? s.plants : [],
                   log: Array.isArray(s.log) ? s.log : [] });
  }
  function tombIds(state) {
    return isObj(state) && isObj(state.tombs) ? Object.keys(state.tombs) : [];
  }

  // ---------- previews ----------
  var HEAD = {
    en: {
      title: "Plants", history: "History",
      plants: ["Name", "Species", "Scientific name", "Room", "Where", "Water every (days)", "In winter every (days)",
               "Fertilize every (days)", "Mist every (days)", "Repot every (days)", "Last watered", "Notes"],
      log: ["Date", "Plant", "Task", "Skipped"],
      kinds: { water: "Water", fert: "Fertilize", mist: "Mist", repot: "Repot" },
      indoor: "Indoor", outdoor: "Outdoor", yes: "yes", no: "no", every: "every {n} days",
      winter: "in winter every {n} days", last: "last watered {d}"
    },
    el: {
      title: "Φυτά", history: "Ιστορικό",
      plants: ["Όνομα", "Είδος", "Επιστημονική ονομασία", "Δωμάτιο", "Πού", "Πότισμα κάθε (μέρες)", "Τον χειμώνα κάθε (μέρες)",
               "Λίπασμα κάθε (μέρες)", "Ψέκασμα κάθε (μέρες)", "Μεταφύτευση κάθε (μέρες)", "Τελευταίο πότισμα", "Σημειώσεις"],
      log: ["Ημερομηνία", "Φυτό", "Εργασία", "Παραλείφθηκε"],
      kinds: { water: "Πότισμα", fert: "Λίπασμα", mist: "Ψέκασμα", repot: "Μεταφύτευση" },
      indoor: "Εσωτερικό", outdoor: "Εξωτερικό", yes: "ναι", no: "όχι", every: "κάθε {n} μέρες",
      winter: "τον χειμώνα κάθε {n} μέρες", last: "τελευταίο πότισμα {d}"
    }
  };
  // A cell that starts with = + - @ tab CR gets an apostrophe, so a
  // spreadsheet never runs it as a formula.
  function csvCell(v) {
    var s = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) || s.charAt(0) === "'" ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function csv(head, rows) {
    return [head].concat(rows).map(function (r) { return r.map(csvCell).join(","); }).join("\r\n") + "\r\n";
  }
  function mdText(s) { return String(s || "").replace(/[\\`*_[\]<>#|]/g, "\\$&").replace(/\s*\n\s*/g, " "); }

  function previews(state, lang) {
    var L = lang === "el" ? "el" : "en", H = HEAD[L];
    var plants = (state && state.plants) || [], log = (state && state.log) || [];
    var last = C.lastByKind({ log: log.filter(function (x) { return !x.s; }) }), names = {};
    function sp(p) { var x = C.PRESETS[p.sp]; return x ? (x[L] || x.en)[0] : ""; }
    function n(v) { return v ? String(v) : ""; }
    plants = plants.slice().sort(function (a, b) {
      var x = a.name.toLowerCase(), y = b.name.toLowerCase();
      return x < y ? -1 : x > y ? 1 : (a.id < b.id ? -1 : 1);
    });
    var md = ["# " + H.title, ""], rows = [];
    plants.forEach(function (p) {
      names[p.id] = p.name;
      var lw = (last[p.id] && last[p.id].water) || "";
      rows.push([p.name, sp(p), p.sci || "", p.room, p.out ? H.outdoor : H.indoor, p.w, n(p.ww), n(p.f), n(p.mi), n(p.r), lw, p.notes]);
      var bits = [H.kinds.water + " " + H.every.replace("{n}", p.w)];
      if (p.ww) bits.push(H.winter.replace("{n}", p.ww));
      ["fert", "mist", "repot"].forEach(function (k) {
        var v = p[C.KIND_KEY[k]];
        if (v) bits.push(H.kinds[k] + " " + H.every.replace("{n}", v));
      });
      if (lw) bits.push(H.last.replace("{d}", lw));
      md.push("## " + mdText(p.name), "");
      var sub = [sp(p), p.sci, p.room, p.out ? H.outdoor : H.indoor].filter(Boolean).map(mdText);
      md.push(sub.join(" · "), "");
      bits.forEach(function (b) { md.push("- " + mdText(b)); });
      if (p.notes) md.push("", mdText(p.notes));
      md.push("");
    });
    var hist = log.filter(function (x) { return names[x.p] !== undefined; }).sort(function (a, b) {
      return a.d < b.d ? -1 : a.d > b.d ? 1 : (a.id < b.id ? -1 : 1);
    }).map(function (x) { return [x.d, names[x.p], H.kinds[x.k] || x.k, x.s ? H.yes : H.no]; });
    var out = {};
    if (!plants.length) return out;
    out["plants.md"] = md.join("\n");
    out["plants.csv"] = csv(H.plants, rows);
    if (hist.length) out["history.csv"] = csv(H.log, hist);
    return out;
  }

  // What an id names in a state (Undo tombstones each the app's way).
  function kindOf(id, state) {
    var s = isObj(state) ? state : {}, k = "";
    (s.plants || []).forEach(function (x) { if (x && x.id === id) k = "plant"; });
    if (!k) (s.log || []).forEach(function (x) { if (x && x.id === id) k = "log"; });
    return k;
  }

  var DESC = {
    app: "plants", title: "Plant Care", slice: "plants", ext: ".orosplants", mime: "application/x-oros-plants",
    colls: {
      plants: { shape: "array", id: "id", stamp: "m" },
      log: { shape: "array", id: "id", stamp: "m" }
    },
    norm: norm, strip: strip, tombIds: tombIds, previews: previews,
    merge: function (local, remote) { return C.merge(local, remote); }
  };

  var api = { DESC: DESC, kindOf: kindOf, LIM: LIM, csvCell: csvCell };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrosPlantsPackage = api;
})(this);
