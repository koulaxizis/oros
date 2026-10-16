// ============================================================
// orOS Cycle — .oroscycle file (cycle/package.js,
// window.OrosCyclePackage). The descriptor of Cycle for the record
// apps' kit (../recordpkg.js, docs/oros-bundle.md "Record apps"):
// every period, logged day, symptom and medication in one orOS
// bundle; opening one ADDS what this device lacks, with its ids.
// Pure (no DOM, no storage), so the app and `node --test` run the
// same code.
//   DESC                     the kit descriptor (no merge: the kit's
//                            plain insert; cycle.js then runs the
//                            result through settle + its own merge +
//                            migrate + save, so sync carries it)
//   DESC.norm(data)          a file's data → { ver, periods, days,
//                            cols } with known fields only, typed and
//                            capped; a day's date comes from its id
//   DESC.strip(state)        the slice → { ver, periods, days, cols }:
//                            no tombstones (deleted), no device
//                            settings (prefs: reminders, temperature
//                            view; pm, sm, om)
//   DESC.tombIds(state)      the ids in state.deleted
//   DESC.previews(state, l)  cycle.md (readable), periods.csv, days.csv
//   settle(local, next, ids) a symptom or medication the file adds
//                            under a name this device already has is
//                            left out: the added days point at the
//                            local one (ids loses it, so Undo is right)
//   kindOf(id, state)        "period" | "day" | "sym" | "med" | ""
// Day ids are the date ("d-YYYY-MM-DD"): a day logged on both
// devices is a clash and keeps the local values (unless "Update with
// newer versions"; cycle.js then merges that day field by field).
// ============================================================
(function (root) {
  "use strict";

  var LIM = { periods: 2000, days: 40000, cols: 300, meds: 100, sym: 300,
              note: 2000, label: 40 };
  var FUTURE = 5 * 60 * 1000;
  var DAY_ID = /^d-(\d{4})-(\d{2})-(\d{2})$/;
  var T_MIN = -2208988800000, T_MAX = 7258118400000;      // 1900 … 2200

  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function num(v) { return typeof v === "number" && isFinite(v) ? v : 0; }
  function stamp(v, lim) { var n = num(v); return n < 0 ? 0 : (n > lim ? lim : n); }
  function line(v, max) { return typeof v === "string" ? v.slice(0, max).replace(/[\u0000-\u001f\u007f]/g, " ") : ""; }
  function text(v, max) { return typeof v === "string" ? v.slice(0, max).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "") : ""; }
  function okId(v) { return typeof v === "string" && /^[A-Za-z0-9_.:-]{1,80}$/.test(v) && v !== "__proto__"; }
  function okTime(v) { return typeof v === "number" && isFinite(v) && v >= T_MIN && v <= T_MAX; }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(ts) { var d = new Date(ts); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  // local midnight of a "d-YYYY-MM-DD" id (the app's dayTsFromKey), or null
  function dayTs(id) {
    var m = DAY_ID.exec(id);
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1900 || y > 2199) return null;
    var dt = new Date(y, mo - 1, d);
    return dt.getMonth() === mo - 1 ? dt.getTime() : null;
  }
  function validFlow(v) { return v === 1 || v === 2 || v === 3; }
  function validBbt(v) { return typeof v === "number" && Math.floor(v) === v && v >= 3400 && v <= 4300; }
  function validCm(v) { return v === 1 || v === 2 || v === 3 || v === 4; }

  function normPeriod(p) {
    if (!isObj(p) || !okId(p.id) || !okTime(p.start)) return null;
    var end = okTime(p.end) && p.end >= p.start ? p.end : null;
    return { id: p.id, start: p.start, end: end, flow: validFlow(p.flow) ? p.flow : 2, mtime: num(p.mtime) };
  }
  function normDay(d, lim) {
    if (!isObj(d) || typeof d.id !== "string") return null;
    var ts = dayTs(d.id);
    if (ts === null) return null;
    var sym = [], seen = {};
    (Array.isArray(d.sym) ? d.sym : []).forEach(function (s) {
      if (okId(s) && !seen[s] && sym.length < LIM.sym) { seen[s] = 1; sym.push(s); }
    });
    var meds = [];
    (Array.isArray(d.meds) ? d.meds : []).forEach(function (m) {
      if (meds.length >= LIM.meds || !isObj(m) || !okId(m.id) || !okId(m.med)) return;
      meds.push({ id: m.id, med: m.med, at: stamp(m.at, lim) });
    });
    var o = { id: d.id, day: ts, mtime: num(d.mtime), sym: sym, meds: meds, note: text(d.note, LIM.note) };
    if (validFlow(d.fl)) o.fl = d.fl;
    if (validBbt(d.bbt)) o.bbt = d.bbt;
    if (validCm(d.cm)) o.cm = d.cm;
    if (isObj(d.fm)) {
      var fm = {};
      ["sym", "meds", "note", "fl", "bbt", "cm"].forEach(function (k) {
        if (typeof d.fm[k] === "number" && isFinite(d.fm[k])) fm[k] = d.fm[k];
      });
      o.fm = fm;
      o.sb = stamp(d.sb, lim);
      var ss = {};
      if (isObj(d.ss)) Object.keys(d.ss).slice(0, LIM.sym).forEach(function (k) {
        if (okId(k) && typeof d.ss[k] === "number" && isFinite(d.ss[k])) ss[k] = d.ss[k];
      });
      o.ss = ss;
    }
    return o;
  }
  function normCol(v) {
    if (!isObj(v) || !okId(v.id)) return null;
    var o = { id: v.id, label: line(v.label, LIM.label).trim() || "?", mtime: num(v.mtime), pos: num(v.pos) };
    if (isObj(v.bi)) {
      var en = line(v.bi.en, LIM.label), el = line(v.bi.el, LIM.label);
      if (en || el) o.bi = { en: en, el: el };
    }
    return o;
  }
  function norm(data) {
    if (!isObj(data)) return null;
    var lim = Date.now() + FUTURE;
    var out = { ver: 1, periods: [], days: [], cols: { sym: [], med: [] } };
    if (isObj(data.deleted)) out.deleted = data.deleted;        // strip and tombIds see it, then it goes
    (Array.isArray(data.periods) ? data.periods : []).slice(0, LIM.periods).forEach(function (p) {
      var c = normPeriod(p);
      if (c) out.periods.push(c);
    });
    (Array.isArray(data.days) ? data.days : []).slice(0, LIM.days).forEach(function (d) {
      var c = normDay(d, lim);
      if (c) out.days.push(c);
    });
    var cols = isObj(data.cols) ? data.cols : {};
    ["sym", "med"].forEach(function (k) {
      (Array.isArray(cols[k]) ? cols[k] : []).slice(0, LIM.cols).forEach(function (v) {
        var c = normCol(v);
        if (c) out.cols[k].push(c);
      });
    });
    return out;
  }
  function strip(state) {
    var s = isObj(state) ? state : {}, c = isObj(s.cols) ? s.cols : {};
    return JSON.parse(JSON.stringify({
      ver: 1,
      periods: Array.isArray(s.periods) ? s.periods : [],
      days: Array.isArray(s.days) ? s.days : [],
      cols: { sym: Array.isArray(c.sym) ? c.sym : [], med: Array.isArray(c.med) ? c.med : [] }
    }));
  }
  function tombIds(state) {
    return isObj(state) && isObj(state.deleted) ? Object.keys(state.deleted) : [];
  }

  // ---------- settle (after the kit's open, before the app's merge) ----------
  function normLabel(s) { return String(s == null ? "" : s).trim().toLowerCase().replace(/\s+/g, " "); }
  function settle(local, next, addedIds) {
    var ids = Array.isArray(addedIds) ? addedIds : [], added = {}, remap = {};
    ids.forEach(function (id) { added[id] = 1; });
    var lc = isObj(local) && isObj(local.cols) ? local.cols : {};
    if (!isObj(next) || !isObj(next.cols)) return next;
    ["sym", "med"].forEach(function (k) {
      var mine = {};
      (Array.isArray(lc[k]) ? lc[k] : []).forEach(function (v) {
        if (!isObj(v)) return;
        [v.label, v.bi && v.bi.en, v.bi && v.bi.el].forEach(function (l) {
          var n = normLabel(l);
          if (n && n !== "?" && !(n in mine)) mine[n] = v.id;
        });
      });
      if (!Array.isArray(next.cols[k])) return;
      next.cols[k] = next.cols[k].filter(function (v) {
        if (!isObj(v) || !added[v.id]) return true;
        var n = normLabel(v.label), to = n in mine ? mine[n] : undefined;
        if (to === undefined || to === v.id) return true;
        remap[v.id] = to;
        return false;
      });
    });
    if (!Object.keys(remap).length) return next;
    (Array.isArray(next.days) ? next.days : []).forEach(function (d) {
      if (!isObj(d) || !added[d.id]) return;                    // local days are not touched
      if (Array.isArray(d.sym)) {
        d.sym = d.sym.map(function (s) { return remap[s] || s; })
          .filter(function (s, i, a) { return a.indexOf(s) === i; });
      }
      if (isObj(d.ss)) Object.keys(d.ss).forEach(function (s) {
        if (!remap[s]) return;
        d.ss[remap[s]] = Math.max(d.ss[remap[s]] || 0, d.ss[s]);
        delete d.ss[s];
      });
      (Array.isArray(d.meds) ? d.meds : []).forEach(function (m) { if (m && remap[m.med]) m.med = remap[m.med]; });
    });
    for (var i = ids.length - 1; i >= 0; i--) if (remap[ids[i]]) ids.splice(i, 1);
    return next;
  }

  // ---------- previews ----------
  function csvCell(v) {
    var s = v == null ? "" : String(v);
    var f = /^[=+\-@\t\r]/.test(s);
    return /[",\r\n]/.test(s) || f ? '"' + (f ? "'" : "") + s.replace(/"/g, '""') + '"' : s;
  }
  var WORDS = {
    en: { title: "Cycle", periods: "Periods", days: "Logged days", ongoing: "ongoing", none: "Nothing logged.",
          flow: ["", "light", "normal", "heavy"], cm: ["", "dry", "moist", "creamy", "egg white"],
          sym: "Symptoms", med: "Pain relief", temp: "Temperature", mucus: "Mucus", fl: "Flow",
          note: "Self-tracked data, informational only — not a medical diagnosis or advice." },
    el: { title: "Κύκλος", periods: "Περίοδοι", days: "Ημέρες με καταγραφή", ongoing: "σε εξέλιξη", none: "Καμία καταγραφή.",
          flow: ["", "ελαφριά", "κανονική", "έντονη"], cm: ["", "ξηρή", "υγρή", "κρεμώδης", "ασπράδι αυγού"],
          sym: "Συμπτώματα", med: "Ανακούφιση πόνου", temp: "Θερμοκρασία", mucus: "Βλέννα", fl: "Ροή",
          note: "Δεδομένα αυτο-καταγραφής, μόνο ενημερωτικά — όχι ιατρική διάγνωση ή συμβουλή." }
  };
  function previews(state, lang) {
    var L = lang === "el" ? "el" : "en", W = WORDS[L], names = { sym: {}, med: {} };
    var s = isObj(state) ? state : {}, cols = isObj(s.cols) ? s.cols : {};
    ["sym", "med"].forEach(function (k) {
      (Array.isArray(cols[k]) ? cols[k] : []).forEach(function (v) {
        if (isObj(v)) names[k][v.id] = (v.bi && v.bi[L]) || v.label || "";
      });
    });
    function bbt(v) { return validBbt(v) ? (v / 100).toFixed(2) : ""; }
    var periods = (Array.isArray(s.periods) ? s.periods : []).filter(function (p) { return isObj(p) && okTime(p.start); })
      .slice().sort(function (a, b) { return a.start - b.start; });
    var days = (Array.isArray(s.days) ? s.days : []).filter(function (d) { return isObj(d) && dayTs(String(d.id)) !== null; })
      .slice().sort(function (a, b) { return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0); });
    var md = ["# " + W.title, ""], pcsv = ["start,end,flow"];
    var dcsv = ["date,flow,temperature_c,mucus,symptoms,pain_relief,note"];
    md.push("## " + W.periods, "");
    if (!periods.length) md.push(W.none);
    periods.forEach(function (p) {
      var end = okTime(p.end) ? ymd(p.end) : "";
      md.push("- " + ymd(p.start) + " – " + (end || W.ongoing) + " (" + (W.flow[p.flow] || W.flow[2]) + ")");
      pcsv.push([ymd(p.start), end, W.flow[p.flow] || W.flow[2]].map(csvCell).join(","));
    });
    md.push("", "## " + W.days, "");
    if (!days.length) md.push(W.none);
    days.forEach(function (d) {
      var date = String(d.id).slice(2), parts = [];
      var sym = (Array.isArray(d.sym) ? d.sym : []).map(function (id) { return names.sym[id] || ""; }).filter(Boolean);
      var med = (Array.isArray(d.meds) ? d.meds : []).map(function (m) { return (m && names.med[m.med]) || ""; }).filter(Boolean);
      if (validFlow(d.fl)) parts.push(W.fl + ": " + W.flow[d.fl]);
      if (validBbt(d.bbt)) parts.push(W.temp + ": " + bbt(d.bbt) + " °C");
      if (validCm(d.cm)) parts.push(W.mucus + ": " + W.cm[d.cm]);
      if (sym.length) parts.push(W.sym + ": " + sym.join(", "));
      if (med.length) parts.push(W.med + ": " + med.join(", "));
      var note = typeof d.note === "string" ? d.note : "";
      md.push("- **" + date + "**" + (parts.length ? " · " + parts.join(" · ") : "") +
              (note ? "\n  " + note.replace(/\r?\n/g, "\n  ") : ""));
      dcsv.push([date, validFlow(d.fl) ? W.flow[d.fl] : "", bbt(d.bbt), validCm(d.cm) ? W.cm[d.cm] : "",
                 sym.join("; "), med.join("; "), note].map(csvCell).join(","));
    });
    md.push("", "_" + W.note + "_", "");
    return { "cycle.md": md.join("\n"), "periods.csv": pcsv.join("\r\n") + "\r\n", "days.csv": dcsv.join("\r\n") + "\r\n" };
  }

  // What an id names in a state (Undo removes each the right way).
  function kindOf(id, state) {
    var s = isObj(state) ? state : {}, c = isObj(s.cols) ? s.cols : {}, k = "";
    function has(list) { return (Array.isArray(list) ? list : []).some(function (r) { return isObj(r) && r.id === id; }); }
    if (has(s.periods)) k = "period";
    else if (has(s.days)) k = "day";
    else if (has(c.sym)) k = "sym";
    else if (has(c.med)) k = "med";
    return k;
  }

  var DESC = {
    app: "cycle", title: "Cycle", slice: "cycle", ext: ".oroscycle", mime: "application/x-oros-cycle",
    colls: {
      periods: { shape: "array", id: "id", stamp: "mtime" },
      days: { shape: "array", id: "id", stamp: "mtime", clampIn: ["fm", "ss"] },
      "cols.sym": { shape: "array", id: "id", stamp: "mtime" },
      "cols.med": { shape: "array", id: "id", stamp: "mtime" }
    },
    norm: norm, strip: strip, tombIds: tombIds, previews: previews
  };

  var api = { DESC: DESC, settle: settle, kindOf: kindOf, LIM: LIM };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrosCyclePackage = api;
})(this);
