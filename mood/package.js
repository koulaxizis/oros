// ============================================================
// orOS Mood — .orosmood file (mood/package.js,
// window.OrosMoodPackage). The descriptor of Mood for the record
// apps' kit (../recordpkg.js, docs/oros-bundle.md "Record apps"):
// every entry, own location / person / trigger, feeling and activity
// definition and goal in one orOS bundle; opening one ADDS what this
// device lacks, with its ids. Pure (no DOM, no storage), so the app
// and `node --test` run the same code. Needs vocab.js (loaded first
// in the page; required in Node).
//   DESC                     the kit descriptor (no merge: the kit's
//                            plain insert; mood.js then runs the result
//                            through its own migrate + save + sync)
//   DESC.norm(data)          a file's data → known fields only, typed
//                            and capped (entries through the same rules
//                            as migrate, vocabulary and goals through
//                            vocab.js)
//   DESC.strip(state)        the slice → { ver, entries, cols, vocab?,
//                            goals? }: no tombstones (deleted, deleted
//                            goals, entries a tombstone still covers),
//                            no merge / device stamps (sm, om,
//                            trigSeeded, the vocabulary's reset rs)
//   DESC.tombIds(state)      the ids in state.deleted + deleted goals
//                            + state.__folded (the get hook's device-only
//                            list of values foldCols folded)
//   DESC.previews(state, l)  mood.md (readable) and mood.csv
//   addedByColl(prev, next, ids)  the added ids per collection (Undo)
//   foldCols(prev, next, ids)     an added location / person / trigger
//                            whose name is already here becomes the
//                            value here (its entries follow): no twin
//                            chips, and the local value is kept
// ============================================================
(function (root) {
  "use strict";

  var V = (typeof module === "object" && module.exports) ? require("./vocab.js") : root.OrosMoodVocab;

  var LIM = { entries: 50000, emos: 40, colVals: 500, label: 80, note: 10000, defs: 500, goals: 24 };
  // The built-in yes / no pairs of mood.js (BUILTIN_HABITS; a test
  // keeps the two lists equal).
  var HABITS = ["water", "food", "sleep", "move", "som", "caf", "alc", "scr", "meds",
                "meditate", "read", "tv", "music", "games", "cook", "walk", "nap",
                "journal", "chores", "bedtime", "outdoor"];
  var FIELDS = ["emotions", "loc", "person", "trig", "note"].concat(HABITS, ["acts"]);
  var COLS = ["loc", "trig", "person"];
  // Preview words (keys as in mood.js: one "mood" pack).
  var EMO = {
    en: { "app.title": "Mood", "emo.happy": "Happy", "emo.calm": "Calm", "emo.excited": "Excited", "emo.sad": "Sad",
          "emo.angry": "Angry", "emo.anxious": "Anxious", "emo.tired": "Tired", "emo.stressed": "Stressed",
          "emo.numb": "Numb" },
    el: { "app.title": "Διάθεση", "emo.happy": "Χαρούμενος", "emo.calm": "Ήρεμος", "emo.excited": "Ενθουσιασμένος",
          "emo.sad": "Λυπημένος", "emo.angry": "Θυμωμένος", "emo.anxious": "Αγχωμένος",
          "emo.tired": "Κουρασμένος", "emo.stressed": "Πιεσμένος", "emo.numb": "Άδειος" }
  };

  var hasOwn = Object.prototype.hasOwnProperty;
  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function num(v) { return isNum(v) ? v : 0; }
  function str(v, max) { return typeof v === "string" ? v.slice(0, max) : ""; }
  function line(v, max) { return str(v, max).replace(/[\u0000-\u001f\u007f]/g, " "); }
  function okId(v) { return typeof v === "string" && /^[A-Za-z0-9_.:-]{1,80}$/.test(v) && v !== "__proto__"; }
  function idOrNull(v) { return okId(v) ? v : null; }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  // ---------- norm ----------
  function normEntry(e) {
    if (!isObj(e) || !okId(e.id) || !isNum(e.ts)) return null;
    var seen = {}, emos = [];
    (Array.isArray(e.emotions) ? e.emotions : []).forEach(function (m) {
      if (!isObj(m) || typeof m.k !== "string" || !/^[a-z0-9][a-z0-9_-]{0,39}$/i.test(m.k) || seen[m.k]) return;
      seen[m.k] = 1;
      emos.push({ k: m.k, i: Math.max(1, Math.min(5, Math.round(num(m.i)) || 3)) });
    });
    var o = { id: e.id, ts: e.ts, mtime: isNum(e.mtime) ? e.mtime : e.ts, emotions: emos.slice(0, LIM.emos),
              loc: idOrNull(e.loc), person: idOrNull(e.person), trig: idOrNull(e.trig),
              note: str(e.note, LIM.note), trigger: "" };
    HABITS.forEach(function (f) { o[f] = e[f] === "yes" || e[f] === "no" ? e[f] : null; });
    var acts = V.normActs(e.acts);
    if (acts) o.acts = acts;
    if (isObj(e.fm)) {
      var fm = {}, any = false;
      FIELDS.forEach(function (f) { if (isNum(e.fm[f])) { fm[f] = e.fm[f]; any = true; } });
      if (any) o.fm = fm;
    }
    return o;
  }
  function normColVal(v) {
    if (!isObj(v) || !okId(v.id)) return null;
    var o = { id: v.id, label: line(v.label, LIM.label), mtime: num(v.mtime), pos: num(v.pos) };
    if (isObj(v.bi) && typeof v.bi.en === "string" && typeof v.bi.el === "string")
      o.bi = { en: line(v.bi.en, LIM.label), el: line(v.bi.el, LIM.label) };
    return o;
  }
  function list(v, max, fn) {
    var out = [], seen = {};
    (Array.isArray(v) ? v : []).slice(0, max).forEach(function (x) {
      var c = fn(x);
      if (c && !hasOwn.call(seen, c.id)) { seen[c.id] = 1; out.push(c); }
    });
    return out;
  }
  function norm(data) {
    if (!isObj(data)) return null;
    var out = { ver: 3, entries: list(data.entries, LIM.entries, normEntry), cols: {} };
    var cols = isObj(data.cols) ? data.cols : {};
    COLS.forEach(function (c) { out.cols[c] = list(cols[c], LIM.colVals, normColVal); });
    if (isObj(data.vocab)) {
      var vo = {}, any = false;
      ["emo", "act"].forEach(function (k) {
        var l = list(data.vocab[k], LIM.defs, V.normDef);
        if (l.length) { vo[k] = l; any = true; }
      });
      ["eo", "ao"].forEach(function (k) {
        var od = V.normOrd(data.vocab[k]);
        if (od) { od.ids = od.ids.slice(0, LIM.defs); vo[k] = od; any = true; }
      });
      if (any) out.vocab = vo;
    }
    var goals = list(data.goals, LIM.goals, V.normGoal);
    if (goals.length) out.goals = goals;
    if (isObj(data.deleted)) out.deleted = data.deleted;          // strip and tombIds see it, then it goes
    return out;
  }

  // ---------- strip / tombIds ----------
  function strip(state) {
    var s = isObj(state) ? state : {}, del = isObj(s.deleted) ? s.deleted : {};
    var out = { ver: 3, entries: [], cols: {} };
    (Array.isArray(s.entries) ? s.entries : []).forEach(function (e) {
      if (!isObj(e)) return;
      if (hasOwn.call(del, e.id) && !(num(e.mtime) > num(del[e.id]))) return;   // dead under its tombstone
      out.entries.push(e);
    });
    var cols = isObj(s.cols) ? s.cols : {};
    COLS.forEach(function (c) {
      out.cols[c] = (Array.isArray(cols[c]) ? cols[c] : []).filter(function (v) {
        return isObj(v) && !(hasOwn.call(del, v.id) && !(num(v.mtime) > num(del[v.id])));
      });
    });
    if (isObj(s.vocab)) {
      var vo = {}, any = false;
      ["emo", "act", "eo", "ao"].forEach(function (k) { if (s.vocab[k] !== undefined) { vo[k] = s.vocab[k]; any = true; } });
      if (any) out.vocab = vo;
    }
    var goals = (Array.isArray(s.goals) ? s.goals : []).filter(function (g) { return isObj(g) && !g.x; });
    if (goals.length) out.goals = goals;
    return clone(out);
  }
  function tombIds(state) {
    if (!isObj(state)) return [];
    var out = isObj(state.deleted) ? Object.keys(state.deleted) : [];
    // values an earlier open folded into one here (mood.js keeps that
    // list on this device only): they count as here, never as new
    if (isObj(state.__folded)) out = out.concat(Object.keys(state.__folded));
    (Array.isArray(state.goals) ? state.goals : []).forEach(function (g) { if (isObj(g) && g.x && okId(g.id)) out.push(g.id); });
    return out;
  }

  // ---------- previews ----------
  function csvCell(v) {
    var s = v == null ? "" : String(v);
    var f = /^[=+\-@\t\r]/.test(s);
    return /[",\r\n]/.test(s) || f ? '"' + (f ? "'" : "") + s.replace(/"/g, '""') + '"' : s;
  }
  function p2(n) { return (n < 10 ? "0" : "") + n; }
  function stamp(ts) {
    var d = new Date(ts);
    if (isNaN(d.getTime())) return ["", ""];
    return [d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()), p2(d.getHours()) + ":" + p2(d.getMinutes())];
  }
  function oneLine(s) { return String(s || "").replace(/\s*[\r\n]+\s*/g, " ").trim(); }
  function previews(state, lang) {
    var el = lang === "el", L = el ? EMO.el : EMO.en;
    var vo = isObj(state.vocab) ? state.vocab : {}, emo = {}, act = {}, cv = {};
    (vo.emo || []).forEach(function (d) { if (d && d.lab) emo[d.id] = d.lab; });
    (vo.act || []).forEach(function (d) { if (d && d.lab) act[d.id] = d.lab; });
    COLS.forEach(function (c) {
      ((state.cols || {})[c] || []).forEach(function (v) {
        cv[v.id] = v.bi && v.bi[el ? "el" : "en"] ? v.bi[el ? "el" : "en"] : v.label;
      });
    });
    function emoName(k) { return emo[k] || L["emo." + k] || k; }
    var md = ["# " + L["app.title"], ""];
    var csv = [["date", "time", "feelings", "location", "with", "trigger", "habits", "activities", "note"].join(",")];
    var day = "";
    (state.entries || []).slice().sort(function (a, b) { return b.ts - a.ts || (a.id < b.id ? -1 : 1); }).forEach(function (e) {
      var w = stamp(e.ts);
      var feel = (e.emotions || []).map(function (m) { return emoName(m.k) + " " + m.i + "/5"; }).join("; ");
      var habs = HABITS.filter(function (f) { return e[f] === "yes" || e[f] === "no"; })
        .map(function (f) { return f + ": " + e[f]; }).join("; ");
      var acts = (e.acts || []).map(function (id) { return act[id] || id; }).join("; ");
      var ctx = [cv[e.loc], cv[e.person], cv[e.trig]].filter(Boolean);
      if (w[0] !== day) { day = w[0]; md.push("## " + day, ""); }
      md.push("- " + w[1] + " " + (feel || "—") + (ctx.length ? " (" + ctx.join(", ") + ")" : ""));
      if (habs || acts) md.push("  - " + [habs, acts].filter(Boolean).join("; "));
      if (e.note) md.push("  - " + oneLine(e.note));
      csv.push([w[0], w[1], feel, cv[e.loc] || "", cv[e.person] || "", cv[e.trig] || "", habs, acts, e.note || ""]
        .map(csvCell).join(","));
    });
    if (md[md.length - 1] !== "") md.push("");
    return { "mood.md": md.join("\n"), "mood.csv": csv.join("\r\n") + "\r\n" };
  }

  // ---------- after open (mood.js) ----------
  // The ids open() added, per collection: { entries, loc, trig,
  // person, emo, act, goals }; an id counts only where prev lacked it.
  function addedByColl(prev, next, ids) {
    var want = {}, out = { entries: [], loc: [], trig: [], person: [], emo: [], act: [], goals: [] };
    (ids || []).forEach(function (id) { want[id] = 1; });
    function scan(key, a, b) {
      var had = {};
      (Array.isArray(a) ? a : []).forEach(function (r) { if (isObj(r)) had[r.id] = 1; });
      (Array.isArray(b) ? b : []).forEach(function (r) {
        if (isObj(r) && want[r.id] && !had[r.id]) out[key].push(r.id);
      });
    }
    var p = isObj(prev) ? prev : {}, n = isObj(next) ? next : {};
    scan("entries", p.entries, n.entries);
    COLS.forEach(function (c) { scan(c, (p.cols || {})[c], (n.cols || {})[c]); });
    scan("emo", (p.vocab || {}).emo, (n.vocab || {}).emo);
    scan("act", (p.vocab || {}).act, (n.vocab || {}).act);
    scan("goals", p.goals, n.goals);
    return out;
  }
  function normLabel(s) { return String(s == null ? "" : s).trim().toLowerCase().replace(/\s+/g, " "); }
  // next (changed in place) → { next, folded: { addedId: localId } }
  function foldCols(prev, next, ids) {
    var add = addedByColl(prev, next, ids), remap = {};
    COLS.forEach(function (c) {
      var mine = {};
      ((prev && prev.cols || {})[c] || []).forEach(function (v) {
        if (isObj(v)) { var k = normLabel(v.label); if (k && !mine[k]) mine[k] = v.id; }
      });
      var drop = {};
      add[c].forEach(function (id) { drop[id] = 1; });
      next.cols[c] = next.cols[c].filter(function (v) {
        if (!drop[v.id]) return true;
        var to = mine[normLabel(v.label)];
        if (!to) return true;
        remap[v.id] = to;
        return false;
      });
    });
    if (Object.keys(remap).length) {
      var newE = {};
      add.entries.forEach(function (id) { newE[id] = 1; });
      next.entries.forEach(function (e) {
        if (!newE[e.id]) return;
        ["loc", "person", "trig"].forEach(function (f) { if (e[f] && remap[e[f]]) e[f] = remap[e[f]]; });
      });
    }
    return { next: next, folded: remap };
  }

  var DESC = {
    app: "mood", title: "Mood", slice: "mood", ext: ".orosmood", mime: "application/x-oros-mood",
    colls: {
      entries: { shape: "array", id: "id", stamp: "mtime", clampIn: ["fm"] },
      "cols.loc": { shape: "array", id: "id", stamp: "mtime" },
      "cols.trig": { shape: "array", id: "id", stamp: "mtime" },
      "cols.person": { shape: "array", id: "id", stamp: "mtime" },
      "vocab.emo": { shape: "array", id: "id", stamp: "mtime" },
      "vocab.act": { shape: "array", id: "id", stamp: "mtime" },
      goals: { shape: "array", id: "id", stamp: "mtime" }
    },
    norm: norm, strip: strip, tombIds: tombIds, previews: previews
  };

  var api = { DESC: DESC, HABITS: HABITS, LIM: LIM, addedByColl: addedByColl, foldCols: foldCols };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrosMoodPackage = api;
})(this);
