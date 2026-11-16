// ============================================================
// orOS Base — .orosbase file (base/package.js, window.OrosBasePackage).
// The descriptor of Base for the record apps' kit (../recordpkg.js,
// docs/oros-bundle.md "Record apps"): one base (or all of them) with
// its tables, fields, views, records and links in one orOS bundle,
// for a copy or to move it. Opening one ADDS what this device lacks,
// with its ids (the kit's add-only open); a row here, or deleted here,
// is kept as it is unless "Update with newer versions" is ticked.
// Nothing here is ever deleted. Pure (no DOM, no storage), so the app
// and `node --test` run the same code. Needs core.js (OrosBaseCore).
//   DESC                   the kit descriptor: norm = core.normalize
//                          (every row cleaned, links checked),
//                          merge = core.merge (records per field),
//                          strip drops the tombstones, tombIds = the
//                          slice's tombstones, previews = one CSV per
//                          table (preview/<table>.csv)
//   settle(next, local, addedIds)
//                          what an open may add, before save: added
//                          records over the 20,000 cap are left out,
//                          never one of this device
//   descFor(local)         DESC whose norm also runs dropDead(file,
//                          local()): rows under a base, table, field
//                          or record deleted here are left out
//   undo(data, ids, now)   Undo of an opened file: tombstones for the
//                          added rows (at or above their stamp); the
//                          core's cascade takes what hangs on them
// Never in the file: tombstones, device prefs (column widths, the
// open place).
// ============================================================
(function (root) {
  "use strict";

  var NODE = typeof module === "object" && module.exports;
  function core() { return NODE ? require("./core.js") : root.OrosBaseCore; }

  var KINDS = ["bases", "tables", "fields", "views", "recs", "links"];
  var colls = {};
  KINDS.forEach(function (k) { colls[k] = { shape: "array", id: "id", stamp: "m" }; });
  colls.recs.clampIn = ["fm"];

  function strip(state) {
    var out = core().normalize(state || {});
    out.tombs = {};
    return out;
  }
  function slugOf(s) {
    var x = String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60);
    return x || "table";
  }
  // one CSV per table (the view-less export: every field, record order)
  function previews(state) {
    var C = core(), d = C.normalize(state || {}), ix = C.index(d), out = {}, used = {};
    d.tables.forEach(function (t) {
      var fields = (ix.tbFields[t.id] || []).slice(0, 64);
      var recs = d.recs.filter(function (r) { return r.t === t.id; });
      var name = slugOf(t.name), n = 2;
      while (used[name]) name = slugOf(t.name) + "-" + n++;
      used[name] = 1;
      out[name + ".csv"] = C.toCsv(ix, fields, recs);
    });
    return out;
  }

  var DESC = {
    app: "base", title: "Base", slice: "base", ext: ".orosbase", mime: "application/x-oros-base",
    colls: colls,
    norm: function (x) { return core().normalize(x); },
    merge: function (a, b) { return core().merge(a, b); },
    strip: strip,
    tombIds: function (s) { return Object.keys((s && s.tombs) || {}); },
    previews: previews
  };

  // Added records over the cap are left out (the newest file rows last).
  function settle(next, local, addedIds) {
    var C = core(), d = C.normalize(next || {});
    var room = C.MAX_RECS - ((local && local.recs) || []).length;
    var added = {};
    (addedIds || []).forEach(function (id) { added[id] = 1; });
    var n = 0;
    d.recs = d.recs.filter(function (r) {
      if (!added[r.id]) return true;
      if (n >= room) return false;
      n++;
      return true;
    });
    return C.normalize(d);
  }

  function undo(data, ids, now) {
    var C = core(), d = C.normalize(data || {}), at = {};
    KINDS.forEach(function (k) { (d[k] || []).forEach(function (r) { at[r.id] = r.m || 0; }); });
    (ids || []).forEach(function (id) {
      if (!Object.prototype.hasOwnProperty.call(at, id)) return;
      d.tombs[id] = Math.max(d.tombs[id] || 0, now, at[id]);
    });
    return C.normalize(d);
  }

  // The file's rows that hang on a base, table, field or record deleted
  // here are left out before the open counts them (a deleted base stays
  // deleted, as in every record app, and its tables are not "new").
  function dropDead(inc, local) {
    var dead = Object.assign({}, (local && local.tombs) || {});
    function gone(id) { return Object.prototype.hasOwnProperty.call(dead, id); }
    var d = inc;
    d.bases = (d.bases || []).filter(function (b) { return !gone(b.id); });
    var keepB = {};
    d.bases.forEach(function (b) { keepB[b.id] = 1; });
    function sweep(list, ok) {
      return (list || []).filter(function (x) {
        if (gone(x.id) || !ok(x)) { dead[x.id] = 1; return false; }
        return true;
      });
    }
    // a table of a base the file does not carry may belong to a base here
    d.tables = sweep(d.tables, function (t) { return !gone(t.base); });
    d.fields = sweep(d.fields, function (f) { return !gone(f.tb); });
    d.views = sweep(d.views, function (v) { return !gone(v.tb); });
    d.recs = sweep(d.recs, function (r) { return !gone(r.t); });
    d.links = sweep(d.links, function (l) { return !gone(l.f) && !gone(l.a) && !gone(l.b); });
    return d;
  }
  // DESC with dropDead against this device's state (local() → slice)
  function descFor(local) {
    var out = {};
    Object.keys(DESC).forEach(function (k) { out[k] = DESC[k]; });
    out.norm = function (x) { return dropDead(core().normalize(x), local()); };
    return out;
  }

  var API = { DESC: DESC, descFor: descFor, dropDead: dropDead, settle: settle, undo: undo, previews: previews };
  if (NODE) module.exports = API;
  else root.OrosBasePackage = API;
})(typeof window !== "undefined" ? window : globalThis);
