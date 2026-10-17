// ============================================================
// orOS Chore Wheel — .oroschores file (chores/package.js,
// window.OrosChoresPackage). The descriptor of Chore Wheel for the
// record apps' kit (../recordpkg.js, docs/oros-bundle.md "Record
// apps"): every member, chore and event (done / skipped / undone,
// hand-overs and spin results) in one orOS bundle; opening one ADDS
// what this device lacks, with its ids. Pure (no DOM, no storage),
// so the app and `node --test` run the same code.
//   DESC                     the kit descriptor; merge = core.js
//                            mergeChores (pure, the sync slice's own)
//   DESC.norm(data)          a file's data → the slice shape through
//                            core.js (known fields only, typed), at
//                            most 12 members and 40 chores, events
//                            only of the file's own chores, every
//                            stamp clamped to now + 5 min
//   DESC.strip(state)        the slice → { ver, members, tasks, done,
//                            set }: no tombstones (tombs). The slice
//                            has no device-only fields (who I am here,
//                            the reminder hour and the open tab live
//                            in oros-chores-prefs)
//   DESC.tombIds(state)      the ids in state.tombs
//   DESC.previews(state, l)  chores.md (readable), chores.csv and
//                            history.csv (with a formula guard)
//   kindOf(id, state)        "member" | "task" | "event" (a key of done
//                            and/or set) | ""
// ============================================================
(function (root) {
  "use strict";

  var C = typeof module === "object" && module.exports ? require("./core.js") : root.OrosChoresCore;
  var FUTURE = 5 * 60 * 1000;
  var MAX_EVENTS = 20000;              // per map (40 chores × 13 months is ~16 000)

  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function clampNum(v, lim) { return typeof v === "number" && v > lim ? lim : v; }

  // Events of the file, at most MAX_EVENTS, stamp (index mi) clamped.
  function events(map, mi, lim) {
    var out = {};
    if (!isObj(map)) return out;
    Object.keys(map).slice(0, MAX_EVENTS).forEach(function (k) {
      var v = map[k];
      if (k === "__proto__" || !Array.isArray(v)) return;
      v = v.slice(0, 3);
      v[mi] = clampNum(v[mi], lim);
      out[k] = v;
    });
    return out;
  }
  function ents(list, max, lim) {
    return (Array.isArray(list) ? list : []).slice(0, max * 4).map(function (x) {
      if (!isObj(x)) return null;
      var y = JSON.parse(JSON.stringify(x));
      y.m = clampNum(y.m, lim);
      if ("om" in y) y.om = clampNum(y.om, lim);
      return y;
    });
  }

  function norm(data) {
    if (!isObj(data)) return null;
    var lim = Date.now() + FUTURE;
    var raw = {
      ver: C.DATA_VER,
      members: ents(data.members, C.MAX_MEMBERS, lim),
      tasks: ents(data.tasks, C.MAX_TASKS, lim),
      done: events(data.done, 2, lim),
      set: events(data.set, 1, lim),
      tombs: isObj(data.tombs) ? data.tombs : {}
    };
    // core.js's own merge with itself: every record through
    // normMember / normTask / the event checks, tombstoned records and
    // events older than 13 months gone, sorted by id
    var out = C.mergeChores(raw, raw);
    out.members = out.members.slice(0, C.MAX_MEMBERS);
    out.tasks = out.tasks.slice(0, C.MAX_TASKS);
    var have = {};
    out.tasks.forEach(function (tk) { have[tk.id] = 1; });
    ["done", "set"].forEach(function (f) {
      Object.keys(out[f]).forEach(function (k) {
        if (!have[k.split("|")[0]]) delete out[f][k];      // events of chores not in the file
      });
    });
    return out;
  }
  function strip(state) {
    var s = isObj(state) ? state : {};
    return JSON.parse(JSON.stringify({
      ver: C.DATA_VER,
      members: Array.isArray(s.members) ? s.members : [],
      tasks: Array.isArray(s.tasks) ? s.tasks : [],
      done: isObj(s.done) ? s.done : {},
      set: isObj(s.set) ? s.set : {}
    }));
  }
  function tombIds(state) {
    return isObj(state) && isObj(state.tombs) ? Object.keys(state.tombs) : [];
  }

  // ---------- previews ----------
  var WORDS = {
    en: {
      title: "Chore Wheel", members: "Members", chores: "Chores", away: "away",
      d: "Every day", n: "Every {n} days", w: "Every week", mo: "Every month",
      "dow.0": "Mon", "dow.1": "Tue", "dow.2": "Wed", "dow.3": "Thu", "dow.4": "Fri", "dow.5": "Sat", "dow.6": "Sun",
      w1: "Easy", w2: "Medium", w3: "Heavy",
      rr: "In turn", bal: "Balanced", spin: "Spin", all: "everyone",
      st0: "not done", st1: "done", st2: "skipped",
      starts: "from"
    },
    el: {
      title: "Τροχός δουλειών", members: "Μέλη", chores: "Δουλειές", away: "λείπει",
      d: "Κάθε μέρα", n: "Κάθε {n} μέρες", w: "Κάθε εβδομάδα", mo: "Κάθε μήνα",
      "dow.0": "Δευ", "dow.1": "Τρί", "dow.2": "Τετ", "dow.3": "Πέμ", "dow.4": "Παρ", "dow.5": "Σάβ", "dow.6": "Κυρ",
      w1: "Εύκολη", w2: "Μέτρια", w3: "Βαριά",
      rr: "Κυκλικά", bal: "Ισορροπημένα", spin: "Γύρισμα", all: "όλοι",
      st0: "δεν έγινε", st1: "έγινε", st2: "προσπεράστηκε",
      starts: "από"
    }
  };
  function freqText(f, W) {
    if (!f) return "";
    if (f.k === "n") return W.n.replace("{n}", f.n);
    if (f.k === "wd") return (f.d || []).map(function (d) { return W["dow." + d] || ""; }).join(" · ");
    return W[f.k] || "";
  }
  function csvCell(v) {
    var s = v == null ? "" : String(v);
    var f = /^[=+\-@\t\r]/.test(s);
    return f || /[",\r\n]/.test(s) ? '"' + (f ? "'" : "") + s.replace(/"/g, '""') + '"' : s;
  }
  function mdText(s) { return String(s == null ? "" : s).replace(/([\\`*_\[\]<>#|])/g, "\\$1"); }

  function previews(state, lang) {
    // A pack language (orosI18n, ../i18n.js): English overlaid with the
    // "chores" pack; in node (tests) en/el only.
    var I = typeof window !== "undefined" && window.orosI18n;
    var W = lang === "el" || lang === "en" || !I ? WORDS[lang === "el" ? "el" : "en"] : (WORDS[lang] || I.table(WORDS, "chores", lang));
    var s = isObj(state) ? state : {};
    var members = Array.isArray(s.members) ? s.members.slice() : [];
    var tasks = Array.isArray(s.tasks) ? s.tasks.slice() : [];
    members.sort(function (x, y) { return (x.order || 0) - (y.order || 0) || (x.id < y.id ? -1 : 1); });
    var names = {}, tnames = {};
    members.forEach(function (mb) { names[mb.id] = mb.name || ""; });
    tasks.forEach(function (tk) { tnames[tk.id] = tk.name || ""; });
    function whoText(tk) {
      return (tk.who || []).length ? tk.who.map(function (id) { return names[id] || ""; }).filter(Boolean).join(", ") : W.all;
    }
    var md = ["# " + W.title, "", "## " + W.members, ""];
    members.forEach(function (mb) {
      md.push("- " + (mb.icon ? mb.icon + " " : "") + mdText(mb.name) +
              (mb.away ? " (" + W.away + " " + mb.away[0] + " – " + mb.away[1] + ")" : ""));
    });
    md.push("", "## " + W.chores, "");
    var csv = [["chore", "icon", "how often", "effort", "who gets it", "who takes part", "starts"].join(",")];
    tasks.forEach(function (tk) {
      var row = [tk.name, tk.icon || "", freqText(tk.freq, W), W["w" + tk.weight] || "", W[tk.mode] || "", whoText(tk), tk.start];
      md.push("- " + (tk.icon ? tk.icon + " " : "") + mdText(tk.name) + ": " + row.slice(2, 6).map(mdText).join(" · ") +
              " (" + W.starts + " " + tk.start + ")");
      csv.push(row.map(csvCell).join(","));
    });
    md.push("");
    var hist = [["date", "chore", "state", "by"].join(",")];
    var keys = Object.keys(isObj(s.done) ? s.done : {}).sort(function (a, b) {
      var x = a.split("|")[1], y = b.split("|")[1];
      return x < y ? -1 : (x > y ? 1 : (a < b ? -1 : 1));
    });
    keys.forEach(function (k) {
      var d = s.done[k], p = k.split("|");
      if (!Array.isArray(d) || !d[0]) return;            // undone: nothing happened
      hist.push([p[1], tnames[p[0]] || "", W["st" + d[0]], names[d[1]] || ""].map(csvCell).join(","));
    });
    return { "chores.md": md.join("\n"), "chores.csv": csv.join("\r\n") + "\r\n",
             "history.csv": hist.join("\r\n") + "\r\n" };
  }

  // What an id names in a state (Undo removes each the right way).
  function kindOf(id, state) {
    var s = isObj(state) ? state : {}, k = "";
    (s.members || []).forEach(function (mb) { if (mb.id === id) k = "member"; });
    (s.tasks || []).forEach(function (tk) { if (tk.id === id) k = "task"; });
    if (!k && ((isObj(s.done) && Object.prototype.hasOwnProperty.call(s.done, id)) ||
               (isObj(s.set) && Object.prototype.hasOwnProperty.call(s.set, id)))) k = "event";
    return k;
  }

  var DESC = {
    app: "chores", title: "Chore Wheel", slice: "chores", ext: ".oroschores", mime: "application/x-oros-chores",
    colls: {
      members: { shape: "array", id: "id", stamp: "m" },
      tasks: { shape: "array", id: "id", stamp: "m" },
      done: { shape: "map" },
      set: { shape: "map" }
    },
    norm: norm, strip: strip, tombIds: tombIds, previews: previews,
    merge: function (local, remote) { return C.mergeChores(local, remote); }
  };

  var api = { DESC: DESC, kindOf: kindOf, WORDS: WORDS };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrosChoresPackage = api;
})(this);
