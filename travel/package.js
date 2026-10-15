// ============================================================
// orOS Travel — .orostrip package (travel/package.js,
// window.OrosTravelPackage). One trip = one orOS bundle
// (../bundle.js, docs/oros-bundle.md). Pure (no DOM, no storage),
// so the app and `node --test` run the same code:
//   build(trip, keys)   the trip in the app's own model (the synced
//                       slice's shape, field stamps included) →
//                       content = { kind: "oros-travel-package", ver: 1,
//                       trip { id, name, dest, start, end, people,
//                       notes, cur, bplan, geo, f, pack[], plan[],
//                       docs[], spend[], jrnl[] } }. docs[].file is
//                       the media key of the attachment or journal
//                       photo (keys: { "<disk file>": "<sha256>.<ext>" });
//                       a doc whose bytes could not be read is left out.
//   parse(content, o)   content.json → { trip, files }: a NEW trip,
//                       fresh ids for it and every entry, owners
//                       (docs[].of) remapped, journal days keyed like
//                       the app keys them (o.jrnlId). docs[].file is
//                       "" until the app has written the bytes; files
//                       = [{ doc, key }] says which media key each doc
//                       wants. The app still runs the result through
//                       its own normaliser (mergeTravel). Throws
//                       Error("notpackage") for anything else.
// ============================================================
(function (root) {
  "use strict";

  var KIND = "oros-travel-package", VER = 1;
  var LISTS = ["pack", "plan", "docs", "spend", "jrnl"];
  var LIM = { pack: 500, plan: 300, docs: 300, spend: 1000, jrnl: 400 };
  var KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
  var YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  function build(trip, keys) {
    keys = keys || {};
    var t = clone(trip);
    LISTS.forEach(function (k) { if (!Array.isArray(t[k])) t[k] = []; });
    t.docs = t.docs.filter(function (d) {
      if (!d || !keys[d.file]) return false;
      d.file = keys[d.file];
      return true;
    });
    return { kind: KIND, ver: VER, trip: t };
  }

  function parse(content, o) {
    o = o || {};
    if (!isObj(content) || content.kind !== KIND || !isObj(content.trip)) throw new Error("notpackage");
    var newId = o.newId, jrnlId = o.jrnlId, now = typeof o.now === "number" ? o.now : Date.now();
    var src = content.trip, ids = {}, out = {}, files = [];
    // every value is copied as it is (the app's normaliser decides what
    // stays); only ids, stamps and the file links are the importer's
    function stamps(x) {
      var f = {};
      Object.keys(x).forEach(function (k) { if (k !== "id" && k !== "f") f[k] = now; });
      return f;
    }
    function copy(x) {
      var y = {};
      Object.keys(x).forEach(function (k) {
        if (k === "id" || k === "f" || k === "__proto__" || LISTS.indexOf(k) >= 0) return;
        y[k] = x[k];
      });
      return y;
    }
    var trip = copy(src);
    trip.id = newId();
    trip.f = stamps(trip);
    ids[typeof src.id === "string" ? src.id : ""] = trip.id;
    var usedJ = {};
    LISTS.forEach(function (k) {
      var list = Array.isArray(src[k]) ? src[k].slice(0, LIM[k]) : [];
      out[k] = [];
      list.forEach(function (x) {
        if (!isObj(x)) return;
        var y = copy(x);
        if (k === "jrnl" && jrnlId && typeof y.day === "string" && YMD_RE.test(y.day)) {
          y.id = jrnlId(trip.id, y.day);
          if (usedJ[y.id]) return;              // one journal entry per day
          usedJ[y.id] = 1;
        } else y.id = newId();
        y.f = stamps(y);
        if (typeof x.id === "string" && !(x.id in ids)) ids[x.id] = y.id;
        out[k].push(y);
      });
    });
    // docs: owner remapped (a doc of something not in the file is dropped),
    // the bytes come later from media/<key>
    // Journal photos may belong to a day whose entry has no text yet:
    // their owner is the day's fixed id (o.jrnlId) of the old trip.
    var oldTrip = typeof src.id === "string" ? src.id : "";
    function owner(of) {
      if (typeof of !== "string") return "";
      if (Object.prototype.hasOwnProperty.call(ids, of)) return ids[of];
      var m = /^j(\d{4})(\d{2})(\d{2})-(.+)$/.exec(of);
      if (m && jrnlId && oldTrip && m[4] === oldTrip.slice(0, 31)) return jrnlId(trip.id, m[1] + "-" + m[2] + "-" + m[3]);
      return "";
    }
    out.docs = out.docs.filter(function (d) {
      var of = owner(d.of);
      var key = typeof d.file === "string" && KEY_RE.test(d.file) ? d.file : "";
      if (!of || !key) return false;
      d.of = of;
      d.file = "";
      files.push({ doc: d.id, key: key });
      return true;
    });
    LISTS.forEach(function (k) { trip[k] = out[k]; });
    return { trip: trip, files: files };
  }

  var api = { KIND: KIND, VER: VER, build: build, parse: parse };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrosTravelPackage = api;
})(this);
