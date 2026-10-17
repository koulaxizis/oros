// ============================================================
// orOS Storage — import.js ("Import from another app", v1.0.0)
// Reads a home-inventory export and turns it into Storage places and
// items. Pure: no DOM, no storage; storage.js runs the picker, the
// preview, the one write and the Undo.
//
// Sources (detected from the header row):
//   homebox  Homebox, Tools › Export inventory (CSV): HB.import_ref,
//            HB.location ("Garage/Shelf 1": "/" nests), HB.labels
//            ("a; b"), HB.quantity, HB.name, HB.description,
//            HB.insured, HB.serial_number, HB.model_number,
//            HB.manufacturer, HB.notes, HB.purchase_from,
//            HB.purchase_price, HB.purchase_time,
//            HB.lifetime_warranty, HB.warranty_expires,
//            HB.warranty_details, HB.sold_* (a sold item is skipped).
//   sortly   Sortly, Export (CSV): Entry Name, Variant Details, Sortly
//            ID (SID), Unit, Min Level, Price, Value, Quantity, Notes,
//            Tags, Barcode/QR, the folder as "Folder 1 > Folder 2"
//            (or Folder 1, Folder 2… columns). Folder rows are skipped.
//   generic  any CSV: the columns are guessed (name / item, location /
//            place / room / box, quantity, notes, tags, value) and the
//            preview shows what was picked.
//
// Places: Storage has a fixed hierarchy Space › Room › Furniture ›
// Position › items. A location path fills it from the top (under a
// space the user picks, from the Room down); deeper parts are joined
// into the Position name ("Box 3 / Bag"); missing levels get a place
// called General (bilingual). A place with the same name (any case or
// accent) under the same parent is reused, so nothing is doubled.
//
// parseText(text, lab) → result | null:
//   { source, items: [{ key, name, path: [..], qty, note, tags, val,
//     bought, warr }], skipped, sold, cols (generic: header used per
//     field) }  lab: the app's words for the note lines
// plan(db, res, opts) → { rows, stats, undo }; opts: { now, under
//   (a space id, "" = the path's first part is the space) }.
//   Ids are "imp-" + hash(source | the file's own id, or name + path),
//   so the same file twice adds nothing; a live item with the same id,
//   or the same name in the same place, is the user's and is kept; a
//   deleted one comes back.
// apply(db, plan) → db (a copy) · undo(db, undoInfo, now) → db: every
//   added or revived row becomes a tombstone newer than itself.
// UMD: window.OrosStorageImport in the browser, module.exports in Node.
// ============================================================
(function (root) {
  "use strict";

  var NODE = typeof module !== "undefined" && module.exports && typeof require === "function";
  function kit() { return NODE ? require("../importkit.js") : root.OrosImportKit; }
  function core() { return NODE ? require("./core.js") : root.OrosStorageCore; }

  var MAX_FILE = 10 * 1024 * 1024;
  var MAX_ITEMS = 10000;              // items read from one file
  var NAME_LEN = 120, SEG_LEN = 80;
  var ACCEPT = ".csv,.tsv,.txt,text/csv,text/plain";
  var SRC_NAME = { homebox: "Homebox", sortly: "Sortly" };
  var LEVEL_ORDER = ["space", "room", "furniture", "position"];
  // bilingual seed names, from core.js's texts
  var GENERAL = core().seedPair("seed.general");
  var IMPORTED = core().seedPair("seed.imported");

  function str(v) { return v == null ? "" : String(v); }
  function low(v) { return str(v).trim().toLowerCase(); }
  function hid(s) { var K = kit(); return "imp-" + K.hash(s) + K.hash("~" + s); }
  function g(rec, names) { return str(kit().get(rec, names)).trim(); }

  // ---------- detection ----------
  var SIGS = [
    { id: "homebox", need: ["HB.name"] },
    { id: "sortly", need: ["Entry Name", ["Sortly ID (SID)", "Sortly ID", "SID", "Variant Details", "Min Level"]] }
  ];
  function detect(head) { return kit().detect(head, SIGS); }

  // Generic column guesses, best name first.
  var GUESS = {
    name: ["name", "item", "item name", "title", "object", "thing", "product", "όνομα", "αντικείμενο", "είδος", "περιγραφή είδους", "artikel", "gegenstand", "bezeichnung"],
    loc: ["location", "location path", "path", "place", "where", "folder", "τοποθεσία", "θέση", "χώρος", "φάκελος", "ort", "standort", "pfad", "ordner"],
    room: ["room", "δωμάτιο", "raum", "zimmer"],
    furn: ["furniture", "shelf", "cabinet", "cupboard", "έπιπλο", "ράφι", "ντουλάπι", "möbel", "regal", "schrank"],
    box: ["box", "container", "bin", "drawer", "position", "κουτί", "συρτάρι", "κιβώτιο", "kiste", "schublade", "behälter"],
    qty: ["quantity", "qty", "count", "amount", "pieces", "pcs", "ποσότητα", "τεμάχια", "πλήθος", "menge", "anzahl", "stück"],
    note: ["notes", "note", "comments", "comment", "description", "details", "σημειώσεις", "σημείωση", "περιγραφή", "σχόλια", "notizen", "notiz", "beschreibung", "kommentar"],
    tags: ["tags", "labels", "tag", "label", "category", "ετικέτες", "κατηγορία", "schlagwörter", "kategorie"],
    val: ["value", "price", "cost", "purchase price", "αξία", "τιμή", "κόστος", "wert", "preis", "kosten"]
  };

  // ---------- small helpers ----------
  function seg(s) { return kit().clean(s, SEG_LEN); }
  function splitPath(s, re) {
    return str(s).split(re).map(seg).filter(Boolean);
  }
  function cents(v) {
    var n = kit().num(v);
    return isFinite(n) && n > 0 ? Math.min(99999999999, Math.round(n * 100)) : 0;
  }
  function day(v) {
    var y = kit().ymd(v);
    return y && core().isYmd(y) ? y : "";
  }
  function qtyOf(v) {
    if (str(v).trim() === "") return { q: 1, frac: "" };
    var n = kit().num(v);
    if (!isFinite(n) || n <= 0) return { q: 1, frac: "" };
    var q = Math.max(1, Math.min(1000000, Math.round(n)));
    return { q: q, frac: q !== n ? String(Math.round(n * 1000) / 1000) : "" };
  }
  // note: the main text, then "Label: value" lines, ≤ NOTE_MAX
  function noteOf(main, extra) {
    var K = kit(), max = core().NOTE_MAX, tail = extra.filter(Boolean).join("\n");
    var room = max - (tail ? tail.length + 1 : 0);
    var body = K.cleanText(main, 4000);
    if (body.length > room) body = room > 1 ? body.slice(0, room - 1).trim() + "…" : "";
    return K.cleanText([body, tail].filter(Boolean).join("\n"), max);
  }
  function line(label, v) { v = kit().clean(v, 120); return v ? label + ": " + v : ""; }
  function truthy(v) { return /^(true|yes|y|1|ναι|x)$/i.test(str(v).trim()); }

  // ---------- parse ----------
  function parseHomebox(t, lab) {
    var out = [], skipped = 0, sold = 0, seen = {};
    t.rows.forEach(function (r) {
      var name = kit().clean(g(r, ["HB.name"]), NAME_LEN);
      if (!name) { skipped++; return; }
      if (day(g(r, ["HB.sold_time"])) || g(r, ["HB.sold_to"])) { sold++; return; }
      var ref = low(g(r, ["HB.import_ref"]));
      var path = splitPath(g(r, ["HB.location"]), /\s*\/\s*/);
      var key = ref ? "r:" + ref : "n:" + low(name) + "|" + path.map(low).join("/");
      seen[key] = (seen[key] || 0) + 1;
      if (seen[key] > 1) { if (ref) { skipped++; return; } key += "|" + seen[key]; }
      var qt = qtyOf(g(r, ["HB.quantity"]));
      var warr = day(g(r, ["HB.warranty_expires"]));
      var desc = [g(r, ["HB.description"]), g(r, ["HB.notes"])].filter(Boolean).join("\n");
      out.push({
        key: key, name: name, path: path, qty: qt.q,
        note: noteOf(desc, [
          qt.frac ? line(lab.qty, qt.frac) : "",
          line(lab.maker, [g(r, ["HB.manufacturer"]), g(r, ["HB.model_number"])].filter(Boolean).join(" ")),
          line(lab.serial, g(r, ["HB.serial_number"])),
          line(lab.from, g(r, ["HB.purchase_from"])),
          truthy(g(r, ["HB.lifetime_warranty"])) ? lab.lifetime : "",
          line(lab.warranty, g(r, ["HB.warranty_details"])),
          truthy(g(r, ["HB.insured"])) ? lab.insured : ""
        ]),
        tags: core().cleanTags(g(r, ["HB.labels"])),
        val: cents(g(r, ["HB.purchase_price"])),
        bought: day(g(r, ["HB.purchase_time"])), warr: warr
      });
    });
    return { source: "homebox", items: out, skipped: skipped, sold: sold, cols: null };
  }

  function parseSortly(t, lab) {
    var out = [], skipped = 0, seen = {};
    var fcols = t.head.filter(function (h) { return /^(sub)?folder\s*\d+$/i.test(h); });
    t.rows.forEach(function (r) {
      var name = kit().clean(g(r, ["Entry Name", "Name"]), NAME_LEN);
      if (!name || /^folder$/i.test(g(r, ["Entry Type", "Type"]))) { skipped++; return; }
      var vd = kit().clean(g(r, ["Variant Details", "Variant"]), 60);
      if (vd) name = kit().clean(name + " (" + vd + ")", NAME_LEN);
      var path = fcols.length ? fcols.map(function (h) { return seg(r[h]); }).filter(Boolean)
        : splitPath(g(r, ["Folder path", "Folder Path", "Folder", "Folders", "Path", "Location"]), /\s*[>›]\s*/);
      var sid = low(g(r, ["Sortly ID (SID)", "Sortly ID", "SID"]));
      var key = sid ? "r:" + sid : "n:" + low(name) + "|" + path.map(low).join("/");
      seen[key] = (seen[key] || 0) + 1;
      if (seen[key] > 1) { if (sid) { skipped++; return; } key += "|" + seen[key]; }
      var qt = qtyOf(g(r, ["Quantity", "Qty"]));
      var unit = kit().clean(g(r, ["Unit"]), 20);
      var price = cents(g(r, ["Price"])), value = cents(g(r, ["Value", "Total Value"]));
      var bc = kit().clean(g(r, ["Barcode/QR1-Data", "Barcode/QR", "Barcode", "QR"]), 80);
      out.push({
        key: key, name: name, path: path, qty: qt.q,
        note: noteOf(g(r, ["Notes", "Note"]), [
          qt.frac || (unit && !/^(units?|pcs|pieces?|ea|each)$/i.test(unit)) ? line(lab.qty, (qt.frac || qt.q) + (unit ? " " + unit : "")) : "",
          line(lab.min, g(r, ["Min Level", "Min Quantity"])),
          line(lab.code, bc)
        ]),
        tags: core().cleanTags(g(r, ["Tags"])),
        val: price || (value ? Math.round(value / qt.q) : 0), bought: "", warr: ""
      });
    });
    return { source: "sortly", items: out, skipped: skipped, sold: 0, cols: null };
  }

  function parseGeneric(t) {
    var K = kit(), cols = {};
    Object.keys(GUESS).forEach(function (k) {
      var i = K.col(t.head, GUESS[k]);
      if (i !== -1 && !Object.keys(cols).some(function (o) { return cols[o] === t.head[i]; })) cols[k] = t.head[i];
    });
    if (!cols.name) {
      // no name column: the first column nothing else took
      for (var i = 0; i < t.head.length; i++) {
        var h = t.head[i];
        if (h && !Object.keys(cols).some(function (o) { return cols[o] === h; })) { cols.name = h; break; }
      }
    }
    if (!cols.name) return null;
    var out = [], skipped = 0, seen = {};
    t.rows.forEach(function (r) {
      var name = K.clean(r[cols.name], NAME_LEN);
      if (!name) { skipped++; return; }
      var path = cols.loc ? splitPath(r[cols.loc], /\s*[>›\/\\]\s*/) : [];
      ["room", "furn", "box"].forEach(function (k) { if (cols[k]) { var s = seg(r[cols[k]]); if (s) path.push(s); } });
      var key = "n:" + low(name) + "|" + path.map(low).join("/");
      seen[key] = (seen[key] || 0) + 1;
      if (seen[key] > 1) key += "|" + seen[key];
      var qt = cols.qty ? qtyOf(r[cols.qty]) : { q: 1, frac: "" };
      out.push({
        key: key, name: name, path: path, qty: qt.q,
        note: cols.note ? noteOf(r[cols.note], []) : "",
        tags: cols.tags ? core().cleanTags(r[cols.tags]) : [],
        val: cols.val ? cents(r[cols.val]) : 0, bought: "", warr: ""
      });
    });
    return { source: "generic", items: out, skipped: skipped, sold: 0, cols: cols };
  }

  var LAB = { qty: "Quantity", maker: "Make", serial: "Serial no.", from: "Bought from", lifetime: "Lifetime warranty",
              warranty: "Warranty", insured: "Insured", min: "Min level", code: "Barcode" };
  function parseText(text, lab) {
    var K = kit();
    text = str(text);
    if (text.length > MAX_FILE || !K.clean(text)) return null;
    var t = K.records(text, { maxRows: MAX_ITEMS });
    if (!t.head.length || !t.rows.length) return null;
    var l = {};
    Object.keys(LAB).forEach(function (k) { l[k] = lab && lab[k] ? lab[k] : LAB[k]; });
    var src = detect(t.head);
    var res = src === "homebox" ? parseHomebox(t, l) : src === "sortly" ? parseSortly(t, l) : parseGeneric(t);
    if (!res || !res.items.length) return null;
    res.items = res.items.slice(0, MAX_ITEMS);
    return res;
  }

  // ---------- plan ----------
  function idOf(source, key) { return hid(source + "|" + key); }
  function sameName(e, f) {
    var C = core();
    return C.fold(e.name || "") === f || (!e.name && e.bi && (C.fold(e.bi.en) === f || C.fold(e.bi.el) === f));
  }
  // The space the file's places go under by default: none when the
  // first part of some path is already a space here, else the first
  // space (the seeded "Home").
  function defaultUnder(db, res) {
    var C = core();
    var spaces = (db.ents || []).filter(function (e) { return e.type === "space" && !e.del; })
      .sort(function (a, b) { return a.pos - b.pos || (a.id < b.id ? -1 : 1); });
    if (!spaces.length) return "";
    var hit = res.items.some(function (x) {
      return x.path.length && spaces.some(function (s) { return sameName(s, C.fold(x.path[0])); });
    });
    return hit ? "" : spaces[0].id;
  }

  function plan(db, res, opts) {
    var C = core(), o = opts || {};
    var now = o.now || Date.now();
    var ents = (db && db.ents) || [];
    var byId = {}, kids = {}, had = {};
    ents.forEach(function (e) {
      byId[e.id] = e;
      had[e.id] = true;
      if (e.del) return;
      var p = e.parentId || "";
      (kids[p] || (kids[p] = [])).push(e);
    });
    var under = o.under && byId[o.under] && !byId[o.under].del && byId[o.under].type === "space" ? o.under : "";
    var rows = [], undoIds = [];
    var stats = { items: 0, places: 0, back: 0, same: 0, skipped: res.skipped || 0, sold: res.sold || 0, from: "", to: "" };
    function stampOf(id) { var old = byId[id]; return old ? Math.max(now, old.mtime + 1) : now; }
    // a live place of this type and name under parent, or a new one
    function place(parent, type, name, bi) {
      var f = C.fold(name || bi.en);
      var list = kids[parent || ""] || [];
      for (var i = 0; i < list.length; i++) {
        var e = list[i];
        if (e.type === type && (sameName(e, f) || (bi && sameName(e, C.fold(bi.el))))) return e.id;
      }
      var id = hid("place|" + (parent || "") + "|" + type + "|" + f);
      var row = { id: id, type: type, name: bi ? "" : name, bi: bi ? { en: bi.en, el: bi.el } : null,
                  parentId: parent || null, pos: list.length, mtime: stampOf(id), del: false };
      rows.push(row);
      undoIds.push(id);
      (kids[parent || ""] || (kids[parent || ""] = [])).push(row);
      byId[id] = row;
      return id;
    }
    function positionFor(path) {
      var segs = path.slice(), levels = under ? LEVEL_ORDER.slice(1) : LEVEL_ORDER;
      if (!under && !segs.length) segs = [null];         // the "Imported" space
      if (segs.length > levels.length) {
        segs = segs.slice(0, levels.length - 1).concat([kit().clean(segs.slice(levels.length - 1).join(" / "), SEG_LEN)]);
      }
      var parent = under;
      levels.forEach(function (type, i) {
        var s = segs[i];
        if (s === null) parent = place(parent, type, "", IMPORTED);
        else if (s) parent = place(parent, type, s, null);
        else parent = place(parent, type, "", GENERAL);
      });
      return parent;
    }
    res.items.forEach(function (x) {
      var id = idOf(res.source, x.key), old = byId[id];
      if (old && !old.del) { stats.same++; return; }
      var pid = positionFor(x.path);
      var f = C.fold(x.name);
      if ((kids[pid] || []).some(function (e) { return e.type === "item" && C.fold(e.name) === f; })) { stats.same++; return; }
      var row = { id: id, type: "item", name: x.name, bi: null, parentId: pid, pos: (kids[pid] || []).length,
                  mtime: stampOf(id), del: false, qty: x.qty };
      if (x.note) row.note = x.note;
      if (x.tags && x.tags.length) row.tags = x.tags;
      if (x.val) row.val = x.val;
      if (x.bought) row.bought = x.bought;
      if (x.warr) row.warr = x.warr;
      var clean = C.mergeRow(row);
      if (!clean) { stats.skipped++; return; }
      rows.push(clean);
      undoIds.push(id);
      (kids[pid] || (kids[pid] = [])).push(clean);
      byId[id] = clean;
      stats.items++;
      [x.bought, x.warr].forEach(function (d) {
        if (!d) return;
        if (!stats.from || d < stats.from) stats.from = d;
        if (!stats.to || d > stats.to) stats.to = d;
      });
    });
    // positionFor may have made places for items that then were "same":
    // keep only places something new sits in
    var need = {};
    rows.forEach(function (r) { if (r.type === "item") { var p = r.parentId; while (p && !need[p]) { need[p] = true; p = byId[p] && byId[p].parentId; } } });
    var made = {};
    rows = rows.filter(function (r) { if (r.type === "item" || need[r.id]) return true; made[r.id] = true; return false; });
    undoIds = undoIds.filter(function (id) { return !made[id]; });
    stats.places = rows.filter(function (r) { return r.type !== "item"; }).length;
    stats.back = rows.filter(function (r) { return had[r.id]; }).length;
    return { source: res.source, rows: rows, stats: stats, under: under, undo: { ids: undoIds } };
  }

  function apply(db, p) {
    var d = JSON.parse(JSON.stringify(db || { ver: 1, ents: [] }));
    var ids = {};
    p.rows.forEach(function (r) { ids[r.id] = true; });
    d.ents = (d.ents || []).filter(function (e) { return !ids[e.id]; }).concat(JSON.parse(JSON.stringify(p.rows)));
    return d;
  }
  // Every row the import added or brought back → a tombstone newer
  // than the row (sync carries it; the merge's "newer mtime wins").
  function undo(db, info, now) {
    var d = JSON.parse(JSON.stringify(db || { ver: 1, ents: [] }));
    now = now || Date.now();
    var gone = {};
    info.ids.forEach(function (id) { gone[id] = true; });
    d.ents.forEach(function (e) {
      if (gone[e.id] && !e.del) { e.del = true; e.mtime = Math.max(now, e.mtime + 1); }
    });
    return d;
  }

  var API = {
    ACCEPT: ACCEPT, MAX_FILE: MAX_FILE, SRC_NAME: SRC_NAME, GENERAL: GENERAL, IMPORTED: IMPORTED,
    detect: detect, parseText: parseText, idOf: idOf, defaultUnder: defaultUnder,
    plan: plan, apply: apply, undo: undo
  };
  if (NODE) module.exports = API;
  else root.OrosStorageImport = API;
})(typeof self !== "undefined" ? self : this);
