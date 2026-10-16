// ============================================================
// orOS Storage — .orosinventory file (storage/package.js,
// window.OrosStoragePackage). The descriptor of Storage for the
// record apps' kit (../recordpkg.js, docs/oros-bundle.md "Record
// apps"): every space, room, furniture, position and item in one orOS
// bundle; item photos and receipts (Files › Storage/Photos and
// Storage/Receipts) go in media/<sha256>.jpg (a PDF receipt:
// <sha256>.pdf). Opening one ADDS what this device lacks, with its
// ids. Pure (no DOM, no storage), so the app and `node --test` run the
// same code. Needs core.js (OrosStorageCore).
//   DESC                     the kit descriptor (no merge: the kit's
//                            plain insert; storage.js then runs settle
//                            and its own normalize + save, so sync
//                            carries it). core.mergeData is pure, but
//                            its pruning would let the file's newest
//                            stamp push this device's tombstones out
//   DESC.norm(data)          a file's data → { ver, ents, phs?, rcs? }:
//                            every row through core.mergeRow (the
//                            slice's own strict normalizer), ids and
//                            parent ids checked, names and qty capped;
//                            photo and receipt names only when they
//                            carry the row's own id (core.photoName)
//   DESC.strip(state)        the slice → { ver, ents, phs?, rcs? }: no
//                            tombstones (rows with del). Device prefs
//                            (reminder hour, currency) and the
//                            reminders' state are never in the slice
//   DESC.tombIds(state)      the ids of the rows with del
//   DESC.previews(state, l)  inventory.csv (columns Storage's own CSV
//                            import reads back: Location, Name,
//                            Quantity, Value, Tags, Notes, …) and
//                            inventory.md (the tree, readable)
//   phs / rcs                photos / receipts: { "<file name>":
//                            "<sha256>.jpg|pdf" }, the media key of each
//                            file a row names (storage.js's files hook
//                            fills them)
//   settle(next, local, addedIds, updatedIds)
//                            what an open may keep, before save: an added
//                            row that does not hang under a live space
//                            here (its parent was deleted here, or the
//                            levels do not fit) is left out; an updated
//                            one takes this device's copy back
// ============================================================
(function (root) {
  "use strict";

  var NODE = typeof module === "object" && module.exports;
  function core() { return NODE ? require("./core.js") : root.OrosStorageCore; }

  var VER = 1;
  var MAX_ROWS = 100000;
  var NAME_MAX = 200;
  var QTY_MAX = 1000000000;
  var ID_RE = /^[A-Za-z0-9_-]{1,64}$/;           // core.js boxLink / parseBox
  var KEY_RE = /^[0-9a-f]{64}\.(jpg|pdf)$/;

  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function ctl(s, max) { return String(s).replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max); }
  // core.photoName's stem: the file names of a row start with it
  function stem(id) { return String(id || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 40); }
  function ownFile(name, id) { var s = stem(id); return s.length >= 4 && typeof name === "string" && name.indexOf(s + "-") === 0; }

  // one row of a file: core.mergeRow, then what a file must not bring
  function normRow(raw) {
    if (!isObj(raw) || !ID_RE.test(String(raw.id))) return null;
    var e = core().mergeRow(raw);
    if (!e) return null;
    e.name = ctl(e.name, NAME_MAX);
    if (e.bi) {
      e.bi = { en: typeof e.bi.en === "string" ? ctl(e.bi.en, NAME_MAX) : "",
               el: typeof e.bi.el === "string" ? ctl(e.bi.el, NAME_MAX) : "" };
      if (!e.bi.en && !e.bi.el) e.bi = null;
    }
    if (e.parentId !== null && !ID_RE.test(e.parentId)) e.parentId = null;
    if (e.parentId === e.id) return null;
    if (typeof e.qty === "number" && e.qty > QTY_MAX) e.qty = QTY_MAX;
    if (e.ph) {
      e.ph = e.ph.filter(function (n) { return ownFile(n, e.id); });
      if (!e.ph.length) delete e.ph;
    }
    if (e.rc && !ownFile(e.rc, e.id)) delete e.rc;
    if (e.note === undefined) delete e.note;
    return e;
  }

  // a files map: names some live row holds → a <sha256>.<ext> key whose
  // extension is the name's
  function normMap(map, ents, field) {
    var out = {}, used = {};
    if (!isObj(map)) return out;
    (ents || []).forEach(function (e) {
      if (!isObj(e) || e.del) return;
      [].concat(e[field] || []).forEach(function (n) { if (typeof n === "string") used[n] = 1; });
    });
    Object.keys(map).sort().forEach(function (n) {
      var key = map[n];
      if (!has(used, n) || typeof key !== "string" || !KEY_RE.test(key)) return;
      if (key.slice(-4) !== n.slice(-4)) return;
      out[n] = key;
    });
    return out;
  }
  function withMaps(out, src) {
    var phs = normMap(src.phs, out.ents, "ph"), rcs = normMap(src.rcs, out.ents, "rc");
    if (Object.keys(phs).length) out.phs = phs;
    if (Object.keys(rcs).length) out.rcs = rcs;
    return out;
  }

  function norm(data) {
    if (!isObj(data)) return null;
    var out = { ver: VER, ents: [] }, seen = {};
    (Array.isArray(data.ents) ? data.ents : []).slice(0, MAX_ROWS * 2).forEach(function (r) {
      if (out.ents.length >= MAX_ROWS) return;
      var e = normRow(r);
      if (!e || has(seen, e.id)) return;
      seen[e.id] = 1;
      out.ents.push(e);
    });
    return withMaps(out, data);
  }
  function strip(state) {
    var s = isObj(state) ? state : {};
    var out = { ver: VER, ents: (Array.isArray(s.ents) ? s.ents : []).filter(function (e) { return isObj(e) && !e.del; }) };
    out.ents = clone(out.ents);
    return withMaps(out, s);
  }
  function tombIds(state) {
    var out = [];
    if (isObj(state) && Array.isArray(state.ents)) state.ents.forEach(function (e) { if (isObj(e) && e.del && e.id != null) out.push(String(e.id)); });
    return out;
  }

  // ---------- after an open, before save ----------
  function settle(next, local, addedIds, updatedIds) {
    var C = core(), out = clone(isObj(next) ? next : {});
    if (!Array.isArray(out.ents)) return out;
    var add = {}, upd = {}, mine = {};
    (addedIds || []).forEach(function (id) { add[String(id)] = 1; });
    (updatedIds || []).forEach(function (id) { upd[String(id)] = 1; });
    ((isObj(local) && Array.isArray(local.ents)) ? local.ents : []).forEach(function (e) {
      if (isObj(e) && !has(mine, e.id)) mine[e.id] = e;
    });
    // first the updated rows that hang under nothing take this device's
    // copy back (again until none does: a copy put back can free
    // another), then the added rows that still hang under nothing go;
    // a row that hangs under a live space keeps doing so
    for (var pass = 0; pass < 16; pass++) {
      var I = C.index(out.ents), changed = false;
      out.ents = out.ents.map(function (e) {
        if (!isObj(e) || e.del || !upd[e.id] || C.isAlive(I, e.id)) return e;
        changed = true;
        delete upd[e.id];
        return has(mine, e.id) ? clone(mine[e.id]) : null;
      }).filter(Boolean);
      if (!changed) break;
    }
    var J = C.index(out.ents);
    out.ents = out.ents.filter(function (e) { return !isObj(e) || e.del || !add[e.id] || C.isAlive(J, e.id); });
    return out;
  }

  // ---------- previews: inventory.csv + inventory.md ----------
  var HEAD = {
    en: { csv: ["Location", "Name", "Quantity", "Value", "Tags", "Notes", "Purchase date", "Warranty until", "Lent to", "Lent on", "Return by"],
          title: "Inventory" },
    el: { csv: ["Τοποθεσία", "Όνομα", "Ποσότητα", "Αξία", "Ετικέτες", "Σημειώσεις", "Ημερομηνία αγοράς", "Εγγύηση έως", "Δανεισμένο σε", "Δανείστηκε στις", "Επιστροφή έως"],
          title: "Απογραφή" }
  };
  // CSV cell; a cell starting with = + - @ tab CR gets an apostrophe
  // (spreadsheet formula injection)
  function csvCell(v, sep) {
    var s = v == null ? "" : String(v);
    var inj = /^[=+\-@\t\r]/.test(s);
    if (inj) s = "'" + s;
    return inj || s.indexOf(sep) >= 0 || /["\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function amount(cents, el) {
    if (!cents) return "";
    var s = (cents / 100).toFixed(2).replace(/\.00$/, "");
    return el ? s.replace(".", ",") : s;
  }
  function mdText(s) { return String(s || "").replace(/[\r\n]+/g, " ").replace(/([\\`*_[\]<>#|])/g, "\\$1"); }
  function previews(state, lang) {
    var C = core(), el = lang === "el", H = HEAD[el ? "el" : "en"], sep = el ? ";" : ",";
    var ents = (isObj(state) && Array.isArray(state.ents) ? state.ents : []).filter(function (e) { return isObj(e) && !e.del; });
    var I = C.index(ents), rows = [];
    function name(e) { return C.nameOf(e, el ? "el" : "en"); }
    var md = ["# " + H.title, ""];
    (function walk(p, depth) {
      (I.kids[p] || []).forEach(function (e) {
        if (!C.isAlive(I, e.id)) return;
        if (e.type === "item") {
          var path = C.pathNames(I, e.id, el ? "el" : "en") || [];
          rows.push([path.join(" › "), name(e), e.qty || 1, amount(e.val, el), (e.tags || []).join(", "), e.note || "",
                     e.bought || "", e.warr || "", e.lent ? e.lent.to : "", e.lent ? e.lent.on : "", e.lent && e.lent.due || ""]);
          md.push(new Array(depth).join("  ") + "- " + mdText(name(e)) + ((e.qty || 1) > 1 ? " × " + e.qty : "") +
                  (e.note ? " — " + mdText(e.note) : ""));
          return;
        }
        if (depth === 0) md.push("## " + mdText(name(e)), "");
        else md.push(new Array(depth).join("  ") + "- **" + mdText(name(e)) + "**" + (e.note ? " — " + mdText(e.note) : ""));
        walk(e.id, depth + 1);
        if (depth === 0) md.push("");
      });
    })("", 0);
    var out = {};
    if (!ents.length) return out;
    if (rows.length) {
      var lines = [H.csv.map(function (h) { return csvCell(h, sep); }).join(sep)];
      rows.forEach(function (r) { lines.push(r.map(function (v) { return csvCell(v, sep); }).join(sep)); });
      out["inventory.csv"] = "﻿" + lines.join("\r\n") + "\r\n";
    }
    out["inventory.md"] = md.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
    return out;
  }

  var DESC = {
    app: "storage", title: "Storage", slice: "storage", ext: ".orosinventory", mime: "application/x-oros-inventory",
    colls: {
      ents: { shape: "array", id: "id", stamp: "mtime" }
    },
    norm: norm, strip: strip, tombIds: tombIds, previews: previews
  };

  var api = { DESC: DESC, settle: settle, KEY_RE: KEY_RE, ID_RE: ID_RE, HEAD: HEAD, ownFile: ownFile };
  if (NODE) module.exports = api;
  else root.OrosStoragePackage = api;
})(typeof window !== "undefined" ? window : this);
