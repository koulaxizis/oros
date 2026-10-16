// ============================================================
// orOS One-Sentence Diary — .orosdiary file (diary/package.js,
// window.OrosDiaryPackage). The descriptor of the Diary for the
// record apps' kit (../recordpkg.js, docs/oros-bundle.md "Record
// apps"): every day's line, longer entry and own daily question in
// one orOS bundle, the photos in media/; opening one ADDS what this
// device lacks, with its keys. Pure (no DOM, no storage), so the app
// and `node --test` run the same code. Needs core.js
// (window.DiaryCore; require("./core.js") under Node).
//   DESC                     the kit descriptor; merge = core.js
//                            mergeDiary (the sync merge: pure, LWW per
//                            day, per long-entry field, per question)
//   DESC.norm(data)          a file's data → the slice's shape through
//                            mergeDiary's own normalisers (lines,
//                            emoji, markdown, photo names, place,
//                            weather, questions), questions capped
//   DESC.strip(state)        the slice → { ver, days, long?, prompts?,
//                            phs? }: no tombstones (tombs, cleared
//                            long-entry fields, deleted questions);
//                            nothing device-only is in the slice (the
//                            reminder, the PIN lock and the view stay
//                            in their own keys on the device)
//   DESC.tombIds(state)      the days deleted here (tombs) and the
//                            questions deleted here (x)
//   DESC.previews(state, l)  diary.md (readable: line, longer entry,
//                            place) and diary.csv (the app's CSV
//                            columns, with a formula guard)
//   long[ymd].m              the newest stamp of the entry's fields,
//                            so "Update with newer versions" can
//                            compare; mergeDiary drops it again
//   phs                      photos: { "<photo name>": "<sha256>.jpg" },
//                            the media key of each photo file a long
//                            entry names (Diary/Photos on the orOS disk)
//   forKit(state)            the slice as the kit reads this device:
//                            everything kept, long[ymd].m added
//   added(before, after)     { days, long, prompts }: the keys in after
//                            that before lacks (Undo of an open)
// ============================================================
(function (root) {
  "use strict";

  var C = typeof module === "object" && module.exports ? require("./core.js") : root.DiaryCore;

  var LIM = { prompts: 500 };
  var KEY_RE = /^[0-9a-f]{64}\.jpg$/;
  var hasOwn = Object.prototype.hasOwnProperty;

  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }

  // A long-entry field that says nothing (cleared): a tombstone.
  function emptyField(f) {
    var v = f ? f.v : null;
    return v === "" || v === null || v === undefined || (Array.isArray(v) && !v.length);
  }
  // { "<photo name>": "<media key>" } for the names the entries use
  function normPhs(phs, used) {
    var out = {};
    if (!isObj(phs)) return out;
    Object.keys(phs).sort(cmpStr).forEach(function (n) {
      var k = phs[n];
      if (used[n] === 1 && C.PH_RE.test(n) && typeof k === "string" && KEY_RE.test(k)) out[n] = k;
    });
    return out;
  }
  function usedNames(long) {
    var used = {};
    Object.keys(long || {}).forEach(function (k) {
      var p = long[k].ph;
      (p && Array.isArray(p.v) ? p.v : []).forEach(function (n) { used[n] = 1; });
    });
    return used;
  }
  // The newest field stamp of every long entry (in place).
  function stampLong(long) {
    Object.keys(long || {}).forEach(function (k) {
      var m = 0;
      C.LONG_FIELDS.forEach(function (f) { if (long[k][f] && long[k][f].m > m) m = long[k][f].m; });
      long[k].m = m;
    });
    return long;
  }

  function norm(data) {
    if (!isObj(data)) return null;
    var out = C.mergeDiary(data, null);
    if (out.prompts) {
      var ids = Object.keys(out.prompts);
      if (ids.length > LIM.prompts) {
        var keep = {};
        ids.slice(0, LIM.prompts).forEach(function (id) { keep[id] = out.prompts[id]; });
        out.prompts = keep;
      }
    }
    var phs = normPhs(data.phs, usedNames(out.long));
    if (Object.keys(phs).length) out.phs = phs;
    return out;
  }

  function strip(state) {
    var s = isObj(state) ? state : {}, out = { ver: C.VER, days: {} };
    if (isObj(s.days)) Object.keys(s.days).forEach(function (k) { out.days[k] = s.days[k]; });
    if (isObj(s.long)) {
      var long = {};
      Object.keys(s.long).forEach(function (k) {
        var L = s.long[k], item = {}, any = false;
        if (!isObj(L)) return;
        C.LONG_FIELDS.forEach(function (f) {
          if (isObj(L[f]) && !emptyField(L[f])) { item[f] = L[f]; any = true; }
        });
        if (any) long[k] = item;
      });
      if (Object.keys(long).length) out.long = stampLong(long);
    }
    if (isObj(s.prompts)) {
      var pr = {};
      Object.keys(s.prompts).forEach(function (id) {
        var p = s.prompts[id];
        if (isObj(p) && !p.x) pr[id] = p;
      });
      if (Object.keys(pr).length) out.prompts = pr;
    }
    var phs = normPhs(s.phs, usedNames(out.long));
    if (Object.keys(phs).length) out.phs = phs;
    return clone(out);
  }

  function tombIds(state) {
    var out = [];
    if (!isObj(state)) return out;
    if (isObj(state.tombs)) out = out.concat(Object.keys(state.tombs));
    if (isObj(state.prompts)) Object.keys(state.prompts).forEach(function (id) {
      if (isObj(state.prompts[id]) && state.prompts[id].x) out.push(id);
    });
    return out;
  }

  // The kit's view of this device: all of it, with long[ymd].m.
  function forKit(state) {
    var s = clone(isObj(state) ? state : {});
    if (isObj(s.long)) stampLong(s.long);
    return s;
  }

  // The keys an open added, per collection.
  function added(before, after) {
    var out = { days: [], long: [], prompts: [] };
    var b = isObj(before) ? before : {}, a = isObj(after) ? after : {};
    Object.keys(out).forEach(function (c) {
      var had = isObj(b[c]) ? b[c] : {};
      Object.keys(isObj(a[c]) ? a[c] : {}).forEach(function (k) { if (!hasOwn.call(had, k)) out[c].push(k); });
    });
    return out;
  }

  function csvCell(v) {
    var s = v == null ? "" : String(v);
    var f = /^[=+\-@\t\r]/.test(s);
    return f || /[",\r\n]/.test(s) ? '"' + (f ? "'" : "") + s.replace(/"/g, '""') + '"' : s;
  }
  function previews(state, lang) {
    var el = lang === "el", days = isObj(state.days) ? state.days : {}, long = isObj(state.long) ? state.long : {};
    var keys = {};
    Object.keys(days).forEach(function (k) { keys[k] = 1; });
    Object.keys(long).forEach(function (k) { keys[k] = 1; });
    var md = ["# " + (el ? "Ημερολόγιο μιας πρότασης" : "One-Sentence Diary"), ""];
    var csv = ["date,text,emoji"];
    Object.keys(keys).sort(cmpStr).forEach(function (k) {
      var d = days[k], L = long[k] || {};
      md.push("## " + k + (d && d.e ? " " + d.e : ""), "");
      if (d) md.push(d.t, "");
      if (L.md && L.md.v) md.push(L.md.v, "");
      if (L.loc && L.loc.v && L.loc.v.n) md.push("📍 " + L.loc.v.n, "");
      if (d) csv.push([k, d.t, d.e].map(csvCell).join(","));
    });
    if (!Object.keys(keys).length) return {};
    return { "diary.md": md.join("\n"), "diary.csv": csv.join("\r\n") + "\r\n" };
  }

  var DESC = {
    app: "diary", title: "One-Sentence Diary", slice: "diary", ext: ".orosdiary", mime: "application/x-oros-diary",
    colls: {
      days: { shape: "map", stamp: "m" },
      long: { shape: "map", stamp: "m", clampIn: ["md", "ph", "loc", "wx"] },
      prompts: { shape: "map", stamp: "m" }
    },
    norm: norm, strip: strip, tombIds: tombIds, previews: previews,
    merge: function (local, remote) { return C.mergeDiary(local, remote); }
  };

  var api = { DESC: DESC, LIM: LIM, KEY_RE: KEY_RE, forKit: forKit, added: added, csvCell: csvCell };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrosDiaryPackage = api;
})(typeof window !== "undefined" ? window : this);
