// ============================================================
// orOS Base — data model (base/core.js). Pure: no DOM, no storage.
// Loaded by index.html before app.js, and by Node in the tests.
//
// Slice "base", localStorage "oros-base-data":
//   { ver: 1,
//     bases:  [{ id, m, name, color }],
//     tables: [{ id, m, base, name, ord, pf }],          pf = primary field id
//     fields: [{ id, m, tb, name, type, ord, opt }],
//     views:  [{ id, m, tb, name, kind, ord, cfg }],      kind grid | cards
//     recs:   [{ id, t, c, m, v: { fid: value }, fm: { fid: ms } }],
//     tombs:  { id: deletedAt } }
//
// Sync rules (OROS_BIBLE.md Part I R5, R16, R17, R26, R27):
//   - bases, tables, fields, views: the newer m wins the whole row, an
//     equal m goes to the larger canonical JSON;
//   - records merge PER FIELD: each value carries its own time in fm,
//     so two devices that change different fields of one record keep
//     both changes; the same field → the newer time, then the larger
//     JSON. rec.m = the newest field time, rec.c = the earliest
//     creation time (both sides agree);
//   - a tombstone at least as new as the row deletes it; a newer edit
//     brings it back. A deleted base, table or field takes its tables,
//     fields, views, records and values with it inside the merge;
//   - nothing in the slice moves by itself: autonumber, created and
//     modified times are computed from c and m, never stored;
//   - no uid() or Date.now() inside the merge; output sorted by id.
// ============================================================
(function (root) {
  "use strict";

  var VER = 1;
  var STORAGE_KEY = "oros-base-data";
  var MAX_RECS = 20000;            // all bases together (plan §6.1)
  var MAX_FIELDS = 200;            // per table
  var MAX_TABLES = 100;            // per base
  var MAX_OPTS = 200;              // choices of a select field
  var MAX_NAME = 120;
  var MAX_TEXT = 2000;
  var MAX_LONG = 50000;
  var MAX_ID = 40;

  // Field types of wave B1. A type this code does not know (a newer
  // device) is kept with its options and values exactly as they came.
  var TYPES = ["text", "long", "number", "currency", "percent", "date", "check",
    "select", "multi", "rating", "email", "url", "phone", "auto", "ctime", "mtime"];
  var COMPUTED = { auto: 1, ctime: 1, mtime: 1 };
  var COLORS = ["gray", "red", "orange", "yellow", "green", "teal", "blue", "purple", "pink", "brown"];
  var VIEW_KINDS = { grid: 1, cards: 1 };

  // ---------- small helpers ----------
  function str(v, max) { return typeof v === "string" ? v.slice(0, max) : ""; }
  // one line: no control or bidi-override characters
  function line(v, max) {
    return str(v, max * 2).replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, " ").slice(0, max);
  }
  function para(v, max) {
    return str(v, max * 2).replace(/\r\n?/g, "\n")
      .replace(/[\u0000-\u0009\u000b-\u001f\u007f‪-‮⁦-⁩]/g, " ").slice(0, max);
  }
  function ms(v) { return typeof v === "number" && isFinite(v) && v > 0 ? Math.floor(v) : 0; }
  function okId(v) { return typeof v === "string" && v.length > 0 && v.length <= MAX_ID && /^[A-Za-z0-9_-]+$/.test(v); }
  function num(v) { return typeof v === "number" && isFinite(v) ? v : null; }
  function int(v, lo, hi, dflt) {
    var n = typeof v === "number" && isFinite(v) ? Math.round(v) : dflt;
    return Math.max(lo, Math.min(hi, n));
  }
  function byId(a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function isObj(o) { return !!o && typeof o === "object" && !Array.isArray(o); }

  // Canonical JSON: object keys sorted, so the tie-break is the same
  // on every device whatever order the keys arrived in.
  function canon(v) {
    if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
    if (isObj(v)) {
      return "{" + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ":" + canon(v[k]); }).join(",") + "}";
    }
    return JSON.stringify(v === undefined ? null : v);
  }
  // a plain JSON copy (data from another device, a file), at most `cap` characters
  function plain(v, cap) {
    try {
      var s = JSON.stringify(v);
      if (typeof s !== "string" || s.length > cap) return null;
      return JSON.parse(s);
    } catch (e) { return null; }
  }

  function empty() { return { ver: VER, bases: [], tables: [], fields: [], views: [], recs: [], tombs: {} }; }

  // ---------- options of a field ----------
  function cleanOpt(type, raw) {
    var o = isObj(raw) ? raw : {};
    var out = {};
    if (type === "number" || type === "currency" || type === "percent") {
      out.dec = int(o.dec, 0, 8, type === "currency" ? 2 : 0);
      if (type === "currency") out.sym = line(o.sym, 6) || "€";
    } else if (type === "date") {
      if (o.time === true) out.time = true;
    } else if (type === "rating") {
      out.max = int(o.max, 3, 10, 5);
    } else if (type === "select" || type === "multi") {
      var seen = {}, list = [];
      (Array.isArray(o.ch) ? o.ch : []).forEach(function (c) {
        if (!isObj(c) || !okId(c.id) || seen[c.id] || list.length >= MAX_OPTS) return;
        seen[c.id] = 1;
        list.push({ id: c.id, n: line(c.n, MAX_NAME), c: COLORS.indexOf(c.c) >= 0 ? c.c : "gray" });
      });
      out.ch = list;
    } else if (TYPES.indexOf(type) < 0) {
      return plain(raw, 20000) || {};   // a newer type: kept verbatim
    }
    if (typeof o.desc === "string" && o.desc) out.desc = para(o.desc, 1000);
    return out;
  }

  // ---------- one value, by field type ----------
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/, DT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
  function okDate(s) {
    if (!DATE_RE.test(s.slice(0, 10))) return false;
    var d = new Date(s.slice(0, 10) + "T00:00:00Z");
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s.slice(0, 10) &&
      (s.length === 10 || (DT_RE.test(s) && +s.slice(11, 13) < 24 && +s.slice(14, 16) < 60));
  }
  // undefined = no value (the key is left out). A value that does not
  // fit its field's type is dropped, never "repaired" into another.
  function cleanVal(field, v) {
    var type = field ? field.type : "";
    if (v === null || v === undefined || v === "") return undefined;
    switch (type) {
      case "text": case "email": case "phone":
        var s = line(v, MAX_TEXT).trim(); return s || undefined;
      case "url":
        var u = line(v, MAX_TEXT).trim(); return u || undefined;
      case "long":
        var p = para(v, MAX_LONG); return p.trim() ? p : undefined;
      case "number": case "currency": case "percent":
        var n = num(v); return n === null ? undefined : n;
      case "rating":
        var r = num(v); if (r === null) return undefined;
        r = Math.round(r); var mx = field.opt && field.opt.max || 5;
        return r >= 1 && r <= mx ? r : undefined;
      case "date":
        if (typeof v !== "string" || !okDate(v)) return undefined;
        return field.opt && field.opt.time ? v : v.slice(0, 10);
      case "check":
        return v === true ? true : undefined;
      case "select":
        return okId(v) ? v : undefined;
      case "multi":
        if (!Array.isArray(v)) return undefined;
        var seen = {}, out = [];
        v.forEach(function (x) { if (okId(x) && !seen[x]) { seen[x] = 1; out.push(x); } });
        out.sort();
        return out.length ? out.slice(0, MAX_OPTS) : undefined;
      case "auto": case "ctime": case "mtime":
        return undefined;          // computed, never stored
      default:
        return plain(v, MAX_LONG) === null ? undefined : plain(v, MAX_LONG);   // newer type or unknown field
    }
  }

  // ---------- rows ----------
  function cleanBase(r) {
    if (!isObj(r) || !okId(r.id)) return null;
    return { id: r.id, m: ms(r.m), name: line(r.name, MAX_NAME), color: COLORS.indexOf(r.color) >= 0 ? r.color : "blue" };
  }
  function cleanTable(r) {
    if (!isObj(r) || !okId(r.id) || !okId(r.base)) return null;
    return { id: r.id, m: ms(r.m), base: r.base, name: line(r.name, MAX_NAME), ord: int(r.ord, 0, 1e9, 0), pf: okId(r.pf) ? r.pf : "" };
  }
  function cleanField(r) {
    if (!isObj(r) || !okId(r.id) || !okId(r.tb)) return null;
    var type = typeof r.type === "string" && /^[a-z]{1,16}$/.test(r.type) ? r.type : "text";
    return { id: r.id, m: ms(r.m), tb: r.tb, name: line(r.name, MAX_NAME), type: type, ord: int(r.ord, 0, 1e9, 0), opt: cleanOpt(type, r.opt) };
  }
  var OPS = { eq: 1, ne: 1, gt: 1, lt: 1, gte: 1, lte: 1, has: 1, hasnot: 1, empty: 1, nempty: 1,
    before: 1, after: 1, today: 1, past: 1, future: 1, any: 1, none: 1, checked: 1, unchecked: 1 };
  function cleanCfg(c) {
    c = isObj(c) ? c : {};
    var out = { conj: c.conj === "or" ? "or" : "and", filters: [], sorts: [], groups: [], hidden: [], order: [] };
    (Array.isArray(c.filters) ? c.filters : []).slice(0, 30).forEach(function (f) {
      if (!isObj(f) || !okId(f.f) || !OPS[f.op]) return;
      var x = { f: f.f, op: f.op };
      var v = plain(f.v, 4000);
      if (v !== null && v !== undefined && v !== "") x.v = v;
      out.filters.push(x);
    });
    var seen = {};
    (Array.isArray(c.sorts) ? c.sorts : []).forEach(function (s) {
      if (!isObj(s) || !okId(s.f) || seen[s.f] || out.sorts.length >= 5) return;
      seen[s.f] = 1; out.sorts.push({ f: s.f, d: s.d === -1 ? -1 : 1 });
    });
    seen = {};
    (Array.isArray(c.groups) ? c.groups : []).forEach(function (s) {
      if (!isObj(s) || !okId(s.f) || seen[s.f] || out.groups.length >= 3) return;
      seen[s.f] = 1; out.groups.push({ f: s.f, d: s.d === -1 ? -1 : 1 });
    });
    function ids(a) { var s = {}, o = []; (Array.isArray(a) ? a : []).forEach(function (x) { if (okId(x) && !s[x]) { s[x] = 1; o.push(x); } }); return o.slice(0, MAX_FIELDS); }
    out.hidden = ids(c.hidden).sort();
    out.order = ids(c.order);
    if (typeof c.q === "string" && c.q) out.q = line(c.q, 200);
    return out;
  }
  function cleanView(r) {
    if (!isObj(r) || !okId(r.id) || !okId(r.tb)) return null;
    return { id: r.id, m: ms(r.m), tb: r.tb, name: line(r.name, MAX_NAME), kind: VIEW_KINDS[r.kind] ? r.kind : "grid",
      ord: int(r.ord, 0, 1e9, 0), cfg: cleanCfg(r.cfg) };
  }
  // A record before it meets its fields: values kept as plain JSON,
  // each with its own time. Values are typed against the fields after
  // the merge (finish()), so a record that arrives before its field
  // definition loses nothing.
  function cleanRec(r) {
    if (!isObj(r) || !okId(r.id) || !okId(r.t)) return null;
    var out = { id: r.id, t: r.t, c: ms(r.c), m: 0, v: {}, fm: {} };
    var v = isObj(r.v) ? r.v : {}, fm = isObj(r.fm) ? r.fm : {};
    Object.keys(fm).forEach(function (fid) {
      if (!okId(fid)) return;
      var t = ms(fm[fid]);
      if (!t) return;
      out.fm[fid] = t;
      if (has(v, fid)) {
        var val = plain(v[fid], MAX_LONG);
        if (val !== null && val !== undefined && val !== "") out.v[fid] = val;
      }
    });
    var mm = ms(r.m);
    Object.keys(out.fm).forEach(function (k) { if (out.fm[k] > mm) mm = out.fm[k]; });
    out.m = Math.max(mm, out.c);
    if (!out.c) out.c = out.m;
    return out;
  }

  function newerRow(a, b) {   // true when b beats a
    if (!a) return true;
    if (b.m !== a.m) return b.m > a.m;
    return canon(b) > canon(a);
  }

  function mergeRec(a, b) {
    if (!a) return b;
    var out = { id: a.id, t: a.t, c: 0, m: 0, v: {}, fm: {} };
    // a record never changes table; should two copies disagree, the
    // smaller id wins on both devices
    if (b.t !== a.t) out.t = a.t < b.t ? a.t : b.t;
    var c1 = a.c || b.c, c2 = b.c || a.c;
    out.c = Math.min(c1, c2);
    var keys = {};
    Object.keys(a.fm).forEach(function (k) { keys[k] = 1; });
    Object.keys(b.fm).forEach(function (k) { keys[k] = 1; });
    Object.keys(keys).forEach(function (k) {
      var ta = a.fm[k] || 0, tb = b.fm[k] || 0, src;
      if (ta !== tb) src = ta > tb ? a : b;
      else src = canon(has(b.v, k) ? b.v[k] : null) > canon(has(a.v, k) ? a.v[k] : null) ? b : a;
      out.fm[k] = Math.max(ta, tb);
      if (has(src.v, k)) out.v[k] = src.v[k];
    });
    out.m = Math.max(a.m, b.m);
    return out;
  }

  // ---------- merge / normalize ----------
  function mergeAll(list) {
    var maps = { bases: {}, tables: {}, fields: {}, views: {} };
    var CLEAN = { bases: cleanBase, tables: cleanTable, fields: cleanField, views: cleanView };
    var recs = {}, tombs = {};
    list.forEach(function (d) {
      if (!isObj(d)) return;
      Object.keys(CLEAN).forEach(function (k) {
        (Array.isArray(d[k]) ? d[k] : []).forEach(function (raw) {
          var r = CLEAN[k](raw);
          if (r && newerRow(maps[k][r.id], r)) maps[k][r.id] = r;
        });
      });
      (Array.isArray(d.recs) ? d.recs : []).forEach(function (raw) {
        var r = cleanRec(raw);
        if (r) recs[r.id] = mergeRec(recs[r.id], r);
      });
      var t = isObj(d.tombs) ? d.tombs : {};
      Object.keys(t).forEach(function (id) {
        var at = ms(t[id]);
        if (at && okId(id) && at > (tombs[id] || 0)) tombs[id] = at;
      });
    });
    return finish(maps, recs, tombs);
  }

  function finish(maps, recs, tombs) {
    function alive(map) {
      var o = {};
      Object.keys(map).forEach(function (id) { if (!(tombs[id] >= map[id].m)) o[id] = map[id]; });
      return o;
    }
    var bases = alive(maps.bases);
    var tables = alive(maps.tables);
    Object.keys(tables).forEach(function (id) { if (!bases[tables[id].base]) delete tables[id]; });
    var fields = alive(maps.fields);
    Object.keys(fields).forEach(function (id) { if (!tables[fields[id].tb]) delete fields[id]; });
    var views = alive(maps.views);
    Object.keys(views).forEach(function (id) { if (!tables[views[id].tb]) delete views[id]; });

    var outRecs = [];
    Object.keys(recs).sort().forEach(function (id) {
      var r = recs[id];
      if (!tables[r.t]) return;
      if (tombs[id] >= r.m) return;
      var o = { id: r.id, t: r.t, c: r.c, m: r.m, v: {}, fm: {} };
      Object.keys(r.fm).sort().forEach(function (fid) {
        var f = fields[fid];
        if (!f) {
          // a deleted field takes its values; a field this copy has not
          // seen yet (arrives later) keeps them
          if (tombs[fid]) return;
          o.fm[fid] = r.fm[fid];
          if (has(r.v, fid)) o.v[fid] = r.v[fid];
          return;
        }
        if (f.tb !== r.t) return;
        o.fm[fid] = r.fm[fid];
        if (has(r.v, fid)) {
          var cv = cleanVal(f, r.v[fid]);
          if (cv !== undefined) o.v[fid] = cv;
        }
      });
      outRecs.push(o);
    });

    var out = empty();
    function sorted(map) { return Object.keys(map).sort().map(function (id) { return map[id]; }); }
    out.bases = sorted(bases);
    out.tables = sorted(tables);
    out.fields = sorted(fields);
    out.views = sorted(views);
    out.recs = outRecs;
    Object.keys(tombs).sort().forEach(function (id) { out.tombs[id] = tombs[id]; });
    return out;
  }

  function normalize(d) { return mergeAll([d]); }
  function merge(local, remote) { return mergeAll([local, remote]); }
  function serialize(d) { return JSON.stringify(normalize(d)); }

  // ---------- reading ----------
  function index(d) {
    var ix = { bases: {}, tables: {}, fields: {}, views: {}, recs: {}, tbFields: {}, tbViews: {}, tbRecs: {}, baseTables: {} };
    d.bases.forEach(function (b) { ix.bases[b.id] = b; ix.baseTables[b.id] = []; });
    d.tables.forEach(function (t) {
      ix.tables[t.id] = t; ix.tbFields[t.id] = []; ix.tbViews[t.id] = []; ix.tbRecs[t.id] = [];
      if (ix.baseTables[t.base]) ix.baseTables[t.base].push(t);
    });
    d.fields.forEach(function (f) { ix.fields[f.id] = f; if (ix.tbFields[f.tb]) ix.tbFields[f.tb].push(f); });
    d.views.forEach(function (v) { ix.views[v.id] = v; if (ix.tbViews[v.tb]) ix.tbViews[v.tb].push(v); });
    d.recs.forEach(function (r) { ix.recs[r.id] = r; if (ix.tbRecs[r.t]) ix.tbRecs[r.t].push(r); });
    function byOrd(a, b) { return a.ord - b.ord || byId(a, b); }
    Object.keys(ix.baseTables).forEach(function (k) { ix.baseTables[k].sort(byOrd); });
    Object.keys(ix.tbFields).forEach(function (k) { ix.tbFields[k].sort(byOrd); });
    Object.keys(ix.tbViews).forEach(function (k) { ix.tbViews[k].sort(byOrd); });
    // autonumber: order of creation, the same on every device
    Object.keys(ix.tbRecs).forEach(function (k) {
      ix.tbRecs[k].sort(function (a, b) { return a.c - b.c || byId(a, b); });
    });
    ix.auto = {};
    Object.keys(ix.tbRecs).forEach(function (k) { ix.tbRecs[k].forEach(function (r, i) { ix.auto[r.id] = i + 1; }); });
    return ix;
  }

  // The primary field: the table's pf when it is a live field there,
  // else its first field.
  function primary(ix, tbId) {
    var t = ix.tables[tbId], list = ix.tbFields[tbId] || [];
    if (t && t.pf && ix.fields[t.pf] && ix.fields[t.pf].tb === tbId) return ix.fields[t.pf];
    return list[0] || null;
  }

  // The value of a field on a record, computed fields included.
  function value(ix, rec, f) {
    if (!f) return undefined;
    if (f.type === "auto") return ix.auto[rec.id];
    if (f.type === "ctime") return rec.c;
    if (f.type === "mtime") return rec.m;
    return has(rec.v, f.id) ? rec.v[f.id] : undefined;
  }

  function optOf(f, id) {
    var ch = f.opt && f.opt.ch || [];
    for (var i = 0; i < ch.length; i++) if (ch[i].id === id) return ch[i];
    return null;
  }

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function localYmd(t) { var d = new Date(t); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function localYmdHm(t) { var d = new Date(t); return localYmd(t) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes()); }

  // Plain text of a value: search, CSV, sorting of text, cards.
  // o = { lang, locale } — only for numbers and dates in the screen;
  // without o the output is the stable machine form (CSV).
  function text(ix, rec, f, o) {
    var v = value(ix, rec, f);
    if (v === undefined || v === null) return "";
    switch (f.type) {
      case "number": case "currency": case "percent":
        var dec = f.opt && typeof f.opt.dec === "number" ? f.opt.dec : 0;
        var s;
        if (o && o.locale) {
          try { s = v.toLocaleString(o.locale, { minimumFractionDigits: dec, maximumFractionDigits: dec }); }
          catch (e) { s = v.toFixed(dec); }
        } else s = String(+v.toFixed(dec));
        if (f.type === "currency" && o) return s + " " + (f.opt.sym || "");
        if (f.type === "percent" && o) return s + "%";
        return s;
      case "check": return o ? "✓" : "true";
      case "select": var c = optOf(f, v); return c ? c.n : "";
      case "multi": return v.map(function (id) { var c = optOf(f, id); return c ? c.n : ""; }).filter(Boolean).join(", ");
      case "rating": return o ? new Array(v + 1).join("★") : String(v);
      case "auto": return String(v);
      case "ctime": case "mtime":
        return o && o.locale ? fmtStamp(v, o.locale) : localYmdHm(v);
      case "date":
        return o && o.locale ? fmtDate(v, o.locale) : v;
      default:
        return typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v);
    }
  }
  function fmtDate(v, locale) {
    try {
      var d = new Date(v.slice(0, 10) + "T12:00:00Z");
      var s = d.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
      return v.length > 10 ? s + " " + v.slice(11, 16) : s;
    } catch (e) { return v.replace("T", " "); }
  }
  function fmtStamp(t, locale) {
    try { return new Date(t).toLocaleString(locale, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
    catch (e) { return localYmdHm(t).replace("T", " "); }
  }

  // ---------- filters, sorting, groups ----------
  function isNumType(t) { return t === "number" || t === "currency" || t === "percent" || t === "rating" || t === "auto"; }
  function isDateType(t) { return t === "date" || t === "ctime" || t === "mtime"; }
  function dayOf(f, v) {   // a comparable "YYYY-MM-DD" in local time, or ""
    if (v === undefined || v === null) return "";
    if (f.type === "date") return v.slice(0, 10);
    return localYmd(v);
  }
  function fold(s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); }

  // Which operators each kind of field offers (the app's filter menu).
  function opsFor(type) {
    if (isNumType(type)) return ["eq", "ne", "gt", "lt", "gte", "lte", "empty", "nempty"];
    if (isDateType(type)) return ["eq", "before", "after", "today", "past", "future", "empty", "nempty"];
    if (type === "check") return ["checked", "unchecked"];
    if (type === "select") return ["eq", "ne", "any", "none", "empty", "nempty"];
    if (type === "multi") return ["has", "hasnot", "empty", "nempty"];
    return ["has", "hasnot", "eq", "ne", "empty", "nempty"];
  }
  function needsValue(op) { return !(op === "empty" || op === "nempty" || op === "today" || op === "past" || op === "future" || op === "checked" || op === "unchecked"); }

  // one condition; today = "YYYY-MM-DD" (the app passes the local day)
  function test1(ix, rec, f, c, today) {
    var v = value(ix, rec, f);
    var isEmpty = v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length);
    if (c.op === "empty") return isEmpty;
    if (c.op === "nempty") return !isEmpty;
    if (f.type === "check") return c.op === "checked" ? v === true : v !== true;
    var w = c.v;
    if (needsValue(c.op) && (w === undefined || w === null || w === "" || (Array.isArray(w) && !w.length))) return true;   // unfinished filter: no effect
    if (isNumType(f.type)) {
      var b = typeof w === "number" ? w : parseFloat(String(w).replace(",", "."));
      if (!isFinite(b)) return true;
      if (isEmpty) return c.op === "ne";
      switch (c.op) {
        case "eq": return v === b; case "ne": return v !== b;
        case "gt": return v > b; case "lt": return v < b;
        case "gte": return v >= b; case "lte": return v <= b;
      }
      return true;
    }
    if (isDateType(f.type)) {
      var d = dayOf(f, v);
      if (c.op === "today") return d === today;
      if (c.op === "past") return !!d && d < today;
      if (c.op === "future") return !!d && d > today;
      var x = String(w).slice(0, 10);
      if (!d) return false;
      if (c.op === "eq") return d === x;
      if (c.op === "before") return d < x;
      if (c.op === "after") return d > x;
      return true;
    }
    if (f.type === "select") {
      var list = Array.isArray(w) ? w : [w];
      if (c.op === "eq") return v === w;
      if (c.op === "ne") return v !== w;
      if (c.op === "any") return list.indexOf(v) >= 0;
      if (c.op === "none") return list.indexOf(v) < 0;
      return true;
    }
    if (f.type === "multi") {
      var arr = Array.isArray(v) ? v : [];
      if (c.op === "has") return arr.indexOf(w) >= 0;
      if (c.op === "hasnot") return arr.indexOf(w) < 0;
      return true;
    }
    var hay = fold(text(ix, rec, f)), needle = fold(w);
    if (c.op === "has") return hay.indexOf(needle) >= 0;
    if (c.op === "hasnot") return hay.indexOf(needle) < 0;
    if (c.op === "eq") return hay === needle;
    if (c.op === "ne") return hay !== needle;
    return true;
  }

  function cmpVals(f, a, b) {   // undefined (empty) goes last in both directions: handled by caller
    if (isNumType(f.type) || f.type === "ctime" || f.type === "mtime") return a - b;
    if (f.type === "check") return (a ? 1 : 0) - (b ? 1 : 0);
    if (f.type === "select") {
      var ch = f.opt.ch || [], ia = -1, ib = -1;
      for (var i = 0; i < ch.length; i++) { if (ch[i].id === a) ia = i; if (ch[i].id === b) ib = i; }
      return ia - ib;
    }
    return 0;
  }
  var COLL = null;
  function collator() {
    if (!COLL) { try { COLL = new Intl.Collator(undefined, { sensitivity: "base", numeric: true }); } catch (e) { COLL = { compare: function (a, b) { return a < b ? -1 : a > b ? 1 : 0; } }; } }
    return COLL;
  }
  function compare(ix, f, ra, rb) {
    var a = value(ix, ra, f), b = value(ix, rb, f);
    var ea = a === undefined || (Array.isArray(a) && !a.length), eb = b === undefined || (Array.isArray(b) && !b.length);
    if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1;
    var r = cmpVals(f, a, b);
    if (r || isNumType(f.type) || f.type === "check" || f.type === "select") return r;
    if (f.type === "date") return a < b ? -1 : a > b ? 1 : 0;
    return collator().compare(text(ix, ra, f), text(ix, rb, f));
  }

  // The records a view shows, in its order: [rec]. opt = { today, q }
  // q (the view's search box) matches any shown field's text.
  function query(ix, view, opt) {
    opt = opt || {};
    var cfg = view.cfg, tb = view.tb;
    var recs = (ix.tbRecs[tb] || []).slice();
    var conds = cfg.filters.filter(function (c) { return ix.fields[c.f] && ix.fields[c.f].tb === tb; });
    if (conds.length) {
      recs = recs.filter(function (r) {
        if (cfg.conj === "or") {
          for (var i = 0; i < conds.length; i++) if (test1(ix, r, ix.fields[conds[i].f], conds[i], opt.today || "")) return true;
          return false;
        }
        for (var j = 0; j < conds.length; j++) if (!test1(ix, r, ix.fields[conds[j].f], conds[j], opt.today || "")) return false;
        return true;
      });
    }
    var q = fold(opt.q || "").trim();
    if (q) {
      var shown = visibleFields(ix, view);
      var words = q.split(/\s+/);
      recs = recs.filter(function (r) {
        var hay = shown.map(function (f) { return fold(text(ix, r, f, opt.fmt)); }).join(" \u0001 ");
        return words.every(function (w) { return hay.indexOf(w) >= 0; });
      });
    }
    var keys = cfg.groups.concat(cfg.sorts).filter(function (s) { return ix.fields[s.f] && ix.fields[s.f].tb === tb; });
    if (keys.length) {
      recs.sort(function (ra, rb) {
        for (var i = 0; i < keys.length; i++) {
          var f = ix.fields[keys[i].f];
          var r = compare(ix, f, ra, rb);
          if (r) {
            var a = value(ix, ra, f), b = value(ix, rb, f);
            var ea = a === undefined, eb = b === undefined;
            if (ea || eb) return r;          // empty values last, both directions
            return r * keys[i].d;
          }
        }
        return ra.c - rb.c || byId(ra, rb);
      });
    }
    return recs;
  }

  // Group header key of a record for a group field: [key, label] where
  // label is plain text ("" = empty).
  function groupKey(ix, rec, f) {
    var v = value(ix, rec, f);
    if (v === undefined || (Array.isArray(v) && !v.length)) return "\u0000";
    if (f.type === "multi") return v.join(",");
    if (f.type === "ctime" || f.type === "mtime") return localYmd(v);
    if (f.type === "date") return v.slice(0, 10);
    return canon(v);
  }

  // [{ depth, key, f, rec (first), count, recs? }] rows for the screen:
  // group headers and records interleaved; collapsed = { path: 1 }
  function layout(ix, view, recs, collapsed) {
    var gs = view.cfg.groups.filter(function (g) { return ix.fields[g.f] && ix.fields[g.f].tb === view.tb; });
    var rows = [];
    if (!gs.length) { recs.forEach(function (r) { rows.push({ rec: r }); }); return rows; }
    collapsed = collapsed || {};
    (function walk(list, depth, path) {
      if (depth >= gs.length) { list.forEach(function (r) { rows.push({ rec: r, depth: depth }); }); return; }
      var f = ix.fields[gs[depth].f], order = [], by = {};
      list.forEach(function (r) {
        var k = groupKey(ix, r, f);
        if (!by[k]) { by[k] = []; order.push(k); }
        by[k].push(r);
      });
      order.forEach(function (k) {
        var p = path + "/" + k;
        rows.push({ group: true, depth: depth, f: f, key: k, path: p, first: by[k][0], count: by[k].length, recs: by[k] });
        if (!collapsed[p]) walk(by[k], depth + 1, p);
      });
    })(recs, 0, "");
    return rows;
  }

  // The fields a view shows, in its order: the view's own order first,
  // then the table's order; the primary field always first and shown.
  function visibleFields(ix, view) {
    var list = (ix.tbFields[view.tb] || []).slice();
    var pf = primary(ix, view.tb);
    var pos = {};
    view.cfg.order.forEach(function (id, i) { pos[id] = i; });
    list.sort(function (a, b) {
      if (pf && a.id === pf.id) return -1;
      if (pf && b.id === pf.id) return 1;
      var pa = has(pos, a.id) ? pos[a.id] : 1e6 + a.ord, pb = has(pos, b.id) ? pos[b.id] : 1e6 + b.ord;
      return pa - pb || byId(a, b);
    });
    var hid = {};
    view.cfg.hidden.forEach(function (id) { hid[id] = 1; });
    return list.filter(function (f) { return (pf && f.id === pf.id) || !hid[f.id]; });
  }
  function orderedFields(ix, view) {   // all fields in the view's order (the Fields menu)
    var vis = visibleFields(ix, view), seen = {};
    vis.forEach(function (f) { seen[f.id] = 1; });
    var hidden = (ix.tbFields[view.tb] || []).filter(function (f) { return !seen[f.id]; });
    var pos = {};
    view.cfg.order.forEach(function (id, i) { pos[id] = i; });
    var all = vis.concat(hidden);
    var pf = primary(ix, view.tb);
    all.sort(function (a, b) {
      if (pf && a.id === pf.id) return -1;
      if (pf && b.id === pf.id) return 1;
      var pa = has(pos, a.id) ? pos[a.id] : 1e6 + a.ord, pb = has(pos, b.id) ? pos[b.id] : 1e6 + b.ord;
      return pa - pb || byId(a, b);
    });
    return all;
  }

  // Footer numbers of a field over some records.
  function summary(ix, recs, f) {
    var n = 0, filled = 0, sum = 0, min = null, max = null, checked = 0;
    recs.forEach(function (r) {
      var v = value(ix, r, f);
      n++;
      if (v === undefined || (Array.isArray(v) && !v.length)) return;
      filled++;
      if (v === true) checked++;
      if (typeof v === "number" && (isNumType(f.type))) {
        sum += v;
        if (min === null || v < min) min = v;
        if (max === null || v > max) max = v;
      }
    });
    var out = { count: n, filled: filled, empty: n - filled };
    if (isNumType(f.type) && f.type !== "auto") {
      out.sum = +sum.toFixed(10); out.min = min; out.max = max;
      out.avg = filled ? +(sum / filled).toFixed(10) : null;
    }
    if (f.type === "check") out.checked = checked;
    return out;
  }

  // ---------- edits (the app passes the clock in; never inside merge) ----------
  var SEQ = 0;
  function uid(now) {
    SEQ = (SEQ + 1) % 1296;
    return (now || Date.now()).toString(36) + SEQ.toString(36) + Math.random().toString(36).slice(2, 6);
  }
  function fid() { return "f" + Math.random().toString(36).slice(2, 9); }
  function oid() { return "o" + Math.random().toString(36).slice(2, 8); }

  function clone(d) { return JSON.parse(JSON.stringify(d)); }
  function find(arr, id) { for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i]; return null; }
  function bump(row, now) { row.m = Math.max(now, (row.m || 0) + 1); }
  function nextOrd(arr, key, val) {
    var o = -1;
    arr.forEach(function (x) { if (x[key] === val && x.ord > o) o = x.ord; });
    return o + 1;
  }

  // a change to one row: patch is copied in, the row's m moves only if
  // something really changed (R27)
  function putRow(d, kind, row, now) {
    var out = clone(d);
    var CLEAN = { bases: cleanBase, tables: cleanTable, fields: cleanField, views: cleanView };
    var clean = CLEAN[kind](row);
    if (!clean) return out;
    var cur = find(out[kind], clean.id);
    if (cur) {
      var a = JSON.stringify(Object.assign({}, cur, { m: 0 })), b = JSON.stringify(Object.assign({}, clean, { m: 0 }));
      if (a === b) return out;
      var at = out[kind].indexOf(cur);
      clean.m = Math.max(now, cur.m + 1);
      out[kind][at] = clean;
    } else {
      clean.m = now;
      out[kind].push(clean);
    }
    if (out.tombs[clean.id]) delete out.tombs[clean.id];
    return normalize(out);
  }

  function addBase(d, name, now, id) {
    return putRow(d, "bases", { id: id || uid(now), name: name, color: "blue" }, now);
  }
  // A new table with a primary "Name" field and two views (grid, cards).
  // names = { field, grid, cards } in the app's language.
  function addTable(d, baseId, name, now, names, ids) {
    ids = ids || {};
    var out = normalize(d);
    var t = { id: ids.t || uid(now), base: baseId, name: name, ord: nextOrd(out.tables, "base", baseId), pf: "" };
    var f = { id: ids.f || fid(), tb: t.id, name: names && names.field || "Name", type: "text", ord: 0, opt: {} };
    t.pf = f.id;
    out = putRow(out, "tables", t, now);
    out = putRow(out, "fields", f, now);
    out = putRow(out, "views", { id: ids.v1 || uid(now), tb: t.id, name: names && names.grid || "Grid", kind: "grid", ord: 0, cfg: {} }, now);
    out = putRow(out, "views", { id: ids.v2 || uid(now), tb: t.id, name: names && names.cards || "Cards", kind: "cards", ord: 1, cfg: {} }, now);
    return out;
  }
  function addField(d, tbId, name, type, opt, now, id) {
    var out = normalize(d);
    return putRow(out, "fields", { id: id || fid(), tb: tbId, name: name, type: type, ord: nextOrd(out.fields, "tb", tbId), opt: opt || {} }, now);
  }

  // Delete with a tombstone; Undo = restore the rows with a fresh m.
  function remove(d, id, now) {
    var out = clone(d);
    var row = null;
    ["bases", "tables", "fields", "views", "recs"].forEach(function (k) { row = row || find(out[k], id); });
    var at = Math.max(now, row ? row.m : 0);
    out.tombs[id] = Math.max(out.tombs[id] || 0, at);
    return normalize(out);
  }

  // Values: patch = { fid: value | null } (null clears). Only fields
  // whose stored value really changes get a new time (R27).
  function setValues(d, recId, patch, now) {
    var out = clone(d);
    var ix = index(out);
    var r = find(out.recs, recId);
    if (!r) return out;
    var changed = false;
    Object.keys(patch).forEach(function (k) {
      var f = ix.fields[k];
      if (!f || f.tb !== r.t || COMPUTED[f.type]) return;
      var nv = cleanVal(f, patch[k]);
      // a value that does not fit is ignored; only null, "" or false clear
      var clears = patch[k] === null || patch[k] === "" || patch[k] === false || (Array.isArray(patch[k]) && !patch[k].length);
      if (nv === undefined && !clears) return;
      var cur = has(r.v, k) ? r.v[k] : undefined;
      if (canon(cur === undefined ? null : cur) === canon(nv === undefined ? null : nv)) return;
      if (nv === undefined) delete r.v[k]; else r.v[k] = nv;
      r.fm[k] = Math.max(now, (r.fm[k] || 0) + 1, r.m + 1);
      changed = true;
    });
    if (!changed) return out;
    var mm = 0;
    Object.keys(r.fm).forEach(function (k) { if (r.fm[k] > mm) mm = r.fm[k]; });
    r.m = Math.max(mm, r.m);
    return normalize(out);
  }

  function addRecord(d, tbId, vals, now, id) {
    var out = clone(d);
    var rid = id || uid(now);
    if (find(out.recs, rid)) return { data: normalize(out), id: rid };
    var ix = index(out);
    var r = { id: rid, t: tbId, c: now, m: now, v: {}, fm: {} };
    Object.keys(vals || {}).forEach(function (k) {
      var f = ix.fields[k];
      if (!f || f.tb !== tbId || COMPUTED[f.type]) return;
      var nv = cleanVal(f, vals[k]);
      if (nv === undefined) return;
      r.v[k] = nv; r.fm[k] = now;
    });
    if (out.tombs[rid]) delete out.tombs[rid];
    out.recs.push(r);
    return { data: normalize(out), id: rid };
  }

  // Undo of a delete: the rows come back with a fresh m, newer than the
  // tombstone, so the undo also wins on every other device.
  function restore(d, rows, now) {
    var out = clone(d);
    (rows || []).forEach(function (x) {
      var kind = x.kind, row = clone(x.row);
      delete out.tombs[row.id];
      if (kind === "recs") {
        row.m = Math.max(now, row.m + 1);
        Object.keys(row.fm).forEach(function (k) { row.fm[k] = Math.max(row.fm[k], now); });
        var cur = find(out.recs, row.id);
        if (cur) out.recs.splice(out.recs.indexOf(cur), 1);
        out.recs.push(row);
      } else {
        row.m = Math.max(now, row.m + 1);
        var c2 = find(out[kind], row.id);
        if (c2) out[kind].splice(out[kind].indexOf(c2), 1);
        out[kind].push(row);
      }
    });
    return normalize(out);
  }

  // Everything that goes away with a base / table / field (for Undo).
  function rowsUnder(d, id) {
    var rows = [], ix = index(d);
    function push(kind, row) { if (row) rows.push({ kind: kind, row: clone(row) }); }
    if (ix.bases[id]) {
      push("bases", ix.bases[id]);
      (ix.baseTables[id] || []).forEach(function (t) { rows = rows.concat(rowsUnder(d, t.id)); });
    } else if (ix.tables[id]) {
      push("tables", ix.tables[id]);
      (ix.tbFields[id] || []).forEach(function (f) { push("fields", f); });
      (ix.tbViews[id] || []).forEach(function (v) { push("views", v); });
      (ix.tbRecs[id] || []).forEach(function (r) { push("recs", r); });
    } else if (ix.fields[id]) {
      push("fields", ix.fields[id]);
      var f = ix.fields[id];
      (ix.tbRecs[f.tb] || []).forEach(function (r) { if (has(r.fm, id)) push("recs", r); });
    } else if (ix.views[id]) push("views", ix.views[id]);
    else if (ix.recs[id]) push("recs", ix.recs[id]);
    return rows;
  }

  // Change a field's type: every stored value is converted (the text
  // form is the bridge between types) and written with a new time;
  // values that do not fit become empty. Returns { data, lost }.
  function convert(d, fieldId, type, opt, now) {
    var out = normalize(d);
    var ix = index(out);
    var f = ix.fields[fieldId];
    if (!f) return { data: out, lost: 0 };
    var nf = cleanField(Object.assign({}, f, { type: type, opt: opt || {} }));
    var lost = 0, patches = [];
    // choices for text → select / multi: one per distinct text
    if ((type === "select" || type === "multi") && f.type !== "select" && f.type !== "multi") {
      var names = {}, ch = (nf.opt.ch || []).slice();
      ch.forEach(function (c) { names[fold(c.n)] = c.id; });
      (ix.tbRecs[f.tb] || []).forEach(function (r) {
        var s = text(ix, r, f);
        (type === "multi" ? s.split(/\s*[,;]\s*/) : [s]).forEach(function (p) {
          p = p.trim();
          if (p && !has(names, fold(p)) && ch.length < MAX_OPTS) {
            var id = oid(); names[fold(p)] = id; ch.push({ id: id, n: line(p, MAX_NAME), c: COLORS[ch.length % COLORS.length] });
          }
        });
      });
      nf.opt.ch = ch;
    }
    (ix.tbRecs[f.tb] || []).forEach(function (r) {
      if (!has(r.v, f.id)) return;
      var nv = convertVal(ix, r, f, nf);
      if (nv === undefined) lost++;
      patches.push([r.id, nv]);
    });
    out = putRow(out, "fields", nf, now);
    patches.forEach(function (p) {
      var o = {}; o[fieldId] = p[1] === undefined ? null : p[1];
      out = setValues(out, p[0], o, now);
    });
    return { data: out, lost: lost };
  }
  function convertVal(ix, r, from, to) {
    var v = r.v[from.id];
    if (from.type === to.type) return cleanVal(to, v);
    var s = text(ix, r, from);
    if (to.type === "number" || to.type === "currency" || to.type === "percent" || to.type === "rating") {
      var n = typeof v === "number" ? v : v === true ? 1 : parseNum(s);
      return n === null ? undefined : cleanVal(to, n);
    }
    if (to.type === "check") return v === true || /^(1|true|yes|ναι|ja|x|✓)$/i.test(s.trim()) ? true : undefined;
    if (to.type === "date") return cleanVal(to, parseDate(s));
    if (to.type === "select") {
      var id = choiceId(to, s); return id || undefined;
    }
    if (to.type === "multi") {
      var ids = s.split(/\s*[,;]\s*/).map(function (p) { return choiceId(to, p); }).filter(Boolean);
      return cleanVal(to, ids);
    }
    if (to.type === "long") return cleanVal(to, s);
    return cleanVal(to, s.replace(/\n+/g, " "));
  }
  function choiceId(f, name) {
    var n = fold(String(name).trim());
    if (!n) return "";
    var ch = f.opt.ch || [];
    for (var i = 0; i < ch.length; i++) if (fold(ch[i].n) === n) return ch[i].id;
    return "";
  }
  // "1.234,5" / "1,234.5" / "12,5" / "€ 12" / "12%" → number
  function parseNum(s) {
    s = String(s || "").replace(/[\s €$£%]/g, "");
    if (!s) return null;
    if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
    else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
    else s = s.replace(",", ".");
    if (!/^-?(\d+\.?\d*|\.\d+)(e-?\d+)?$/i.test(s)) return null;
    var n = parseFloat(s);
    return isFinite(n) ? n : null;
  }
  // "2026-11-13", "13/11/2026", "13.11.2026", "2026-11-13 09:30" → ISO (day first, like Europe)
  function parseDate(s) {
    s = String(s || "").trim();
    var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2}))?/);
    if (!m) {
      var e = s.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})(?:[ ,]+(\d{1,2}):(\d{2}))?/);
      if (!e) return "";
      m = [e[0], e[3], e[2], e[1], e[4], e[5]];
    }
    var out = m[1] + "-" + pad(+m[2]) + "-" + pad(+m[3]);
    if (m[4] !== undefined) out += "T" + pad(+m[4]) + ":" + m[5];
    return okDate(out) ? out : "";
  }

  // ---------- CSV ----------
  // RFC 4180 with the delimiter found in the first lines (, ; tab).
  function parseCsv(textIn) {
    var s = String(textIn || "").replace(/^﻿/, "");
    var head = s.slice(0, 4000), counts = { ",": 0, ";": 0, "\t": 0 }, inQ = false;
    for (var i = 0; i < head.length; i++) {
      var ch = head[i];
      if (ch === '"') inQ = !inQ;
      else if (!inQ && has(counts, ch)) counts[ch]++;
      else if (!inQ && ch === "\n") break;
    }
    var delim = ",";
    if (counts[";"] > counts[delim]) delim = ";";
    if (counts["\t"] > counts[delim]) delim = "\t";
    var rows = [], row = [], cell = "", q = false;
    for (var j = 0; j < s.length; j++) {
      var c = s[j];
      if (q) {
        if (c === '"') { if (s[j + 1] === '"') { cell += '"'; j++; } else q = false; }
        else cell += c;
      } else if (c === '"' && cell === "") q = true;
      else if (c === delim) { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && s[j + 1] === "\n") j++;
        row.push(cell); rows.push(row); row = []; cell = "";
      } else cell += c;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (x) { return x.trim() !== ""; }); });
  }

  // A type for a column of text values.
  function guessType(vals) {
    var list = vals.map(function (v) { return String(v || "").trim(); }).filter(Boolean);
    if (!list.length) return { type: "text", opt: {} };
    function all(fn) { return list.every(fn); }
    if (all(function (v) { return /^(true|false|yes|no|ναι|όχι|ja|nein|x|✓|checked)$/i.test(v); }) &&
        list.some(function (v) { return /^(true|yes|ναι|ja|x|✓|checked)$/i.test(v); })) return { type: "check", opt: {} };
    if (all(function (v) { return /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(v); })) return { type: "email", opt: {} };
    if (all(function (v) { return /^https?:\/\/\S+$/i.test(v); })) return { type: "url", opt: {} };
    if (all(function (v) { return parseDate(v) !== ""; })) {
      return { type: "date", opt: list.some(function (v) { return parseDate(v).length > 10; }) ? { time: true } : {} };
    }
    if (all(function (v) { return /[€$£]/.test(v) && parseNum(v) !== null; })) {
      return { type: "currency", opt: { dec: 2, sym: /\$/.test(list[0]) ? "$" : /£/.test(list[0]) ? "£" : "€" } };
    }
    if (all(function (v) { return /%\s*$/.test(v) && parseNum(v) !== null; })) return { type: "percent", opt: { dec: decs(list) } };
    if (all(function (v) { return parseNum(v) !== null && !/^0\d/.test(v.replace(/^-/, "")); })) return { type: "number", opt: { dec: decs(list) } };
    if (all(function (v) { return /^\+?[\d\s()\-.]{7,20}$/.test(v) && /\d{6}/.test(v.replace(/\D/g, "")); })) return { type: "phone", opt: {} };
    if (list.some(function (v) { return v.length > 200 || /\n/.test(v); })) return { type: "long", opt: {} };
    var distinct = {}, n = 0;
    list.forEach(function (v) { if (!has(distinct, fold(v))) { distinct[fold(v)] = v; n++; } });
    if (list.length >= 4 && n <= 12 && n <= list.length / 2) {
      var ch = [], k = 0;
      Object.keys(distinct).forEach(function (key) { ch.push({ id: "o" + (k + 1).toString(36) + Math.random().toString(36).slice(2, 6), n: line(distinct[key], MAX_NAME), c: COLORS[k++ % COLORS.length] }); });
      return { type: "select", opt: { ch: ch } };
    }
    return { type: "text", opt: {} };
  }
  function decs(list) {
    var d = 0;
    list.forEach(function (v) {
      var n = parseNum(v);
      if (n === null) return;
      var s = String(n), p = s.indexOf(".");
      if (p >= 0) d = Math.max(d, Math.min(8, s.length - p - 1));
    });
    return d;
  }

  // The stored value of one CSV cell for a field (import).
  function fromText(f, s) {
    s = String(s == null ? "" : s).trim();
    if (!s) return undefined;
    switch (f.type) {
      case "number": case "currency": case "percent": var n = parseNum(s); return n === null ? undefined : n;
      case "rating": var r = parseNum(s); if (r === null) { var stars = (s.match(/★/g) || []).length; r = stars || null; } return r === null ? undefined : cleanVal(f, r);
      case "check": return /^(true|yes|ναι|ja|x|✓|checked|1)$/i.test(s) ? true : undefined;
      case "date": return cleanVal(f, parseDate(s));
      case "select": return choiceId(f, s) || undefined;
      case "multi": return cleanVal(f, s.split(/\s*[,;]\s*/).map(function (p) { return choiceId(f, p); }).filter(Boolean));
      default: return cleanVal(f, s);
    }
  }

  // Import rows (first = headings) as a new table of a base.
  // Returns { data, table, count, skipped }.
  function importRows(d, baseId, name, rows, now, names) {
    var out = normalize(d);
    rows = rows || [];
    var heads = (rows[0] || []).map(function (h, i) { return line(h, MAX_NAME).trim() || ((names && names.column || "Field") + " " + (i + 1)); });
    var body = rows.slice(1);
    var width = heads.length;
    var room = MAX_RECS - out.recs.length;
    var skipped = Math.max(0, body.length - room);
    body = body.slice(0, Math.max(0, room));
    var t = { id: uid(now), base: baseId, name: name, ord: nextOrd(out.tables, "base", baseId), pf: "" };
    var fields = heads.slice(0, MAX_FIELDS).map(function (h, i) {
      var g = guessType(body.map(function (r) { return r[i]; }));
      if (i === 0 && g.type !== "text") g = { type: "text", opt: {} };   // the primary field names the record
      return { id: "f" + i.toString(36) + Math.random().toString(36).slice(2, 7), tb: t.id, name: h, type: g.type, ord: i, opt: g.opt };
    });
    t.pf = fields.length ? fields[0].id : "";
    out = putRow(out, "tables", t, now);
    fields.forEach(function (f) { out = putRow(out, "fields", f, now); });
    var ix = index(out);
    out = putRow(out, "views", { id: uid(now), tb: t.id, name: names && names.grid || "Grid", kind: "grid", ord: 0, cfg: {} }, now);
    out = putRow(out, "views", { id: uid(now), tb: t.id, name: names && names.cards || "Cards", kind: "cards", ord: 1, cfg: {} }, now);
    var recs = body.map(function (row, k) {
      var r = { id: uid(now) + k.toString(36), t: t.id, c: now + k, m: now + k, v: {}, fm: {} };
      fields.forEach(function (f, i) {
        if (i >= width) return;
        var val = fromText(ix.fields[f.id], row[i]);
        if (val !== undefined) { r.v[f.id] = val; r.fm[f.id] = now + k; }
      });
      return r;
    });
    out.recs = out.recs.concat(recs);
    return { data: normalize(out), table: t.id, count: recs.length, skipped: skipped };
  }

  // CSV of a view's records and fields. Text that a spreadsheet would
  // run as a formula (= + - @ at the start) gets a leading apostrophe.
  function csvCell(s) {
    s = String(s == null ? "" : s);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
    return /[",;\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCsv(ix, fields, recs) {
    var lines = [fields.map(function (f) { return csvCell(f.name); }).join(",")];
    recs.forEach(function (r) { lines.push(fields.map(function (f) { return csvCell(text(ix, r, f)); }).join(",")); });
    return "﻿" + lines.join("\r\n") + "\r\n";
  }
  // Rows for BR-S1 (Open in Spreadsheet): numbers as numbers, dates as text.
  function toTable(ix, fields, recs) {
    var rows = [fields.map(function (f) { return f.name; })];
    recs.forEach(function (r) {
      rows.push(fields.map(function (f) {
        var v = value(ix, r, f);
        if (v === undefined) return "";
        if (typeof v === "number" && isNumType(f.type)) return v;
        return text(ix, r, f);
      }));
    });
    return rows;
  }

  // Characters the slice takes in localStorage (the space meter).
  function size(d) { return serialize(d).length; }

  var API = {
    VER: VER, STORAGE_KEY: STORAGE_KEY, MAX_RECS: MAX_RECS, MAX_FIELDS: MAX_FIELDS, MAX_TABLES: MAX_TABLES,
    MAX_OPTS: MAX_OPTS, TYPES: TYPES, COMPUTED: COMPUTED, COLORS: COLORS,
    empty: empty, normalize: normalize, merge: merge, serialize: serialize, canon: canon,
    index: index, primary: primary, value: value, text: text, optOf: optOf, cleanVal: cleanVal, cleanOpt: cleanOpt,
    opsFor: opsFor, needsValue: needsValue, query: query, layout: layout, groupKey: groupKey,
    visibleFields: visibleFields, orderedFields: orderedFields, summary: summary, compare: compare,
    uid: uid, fid: fid, oid: oid, putRow: putRow, addBase: addBase, addTable: addTable, addField: addField,
    remove: remove, restore: restore, rowsUnder: rowsUnder, setValues: setValues, addRecord: addRecord,
    convert: convert, parseNum: parseNum, parseDate: parseDate, parseCsv: parseCsv, guessType: guessType,
    fromText: fromText, importRows: importRows, toCsv: toCsv, toTable: toTable, csvCell: csvCell,
    localYmd: localYmd, fold: fold, size: size, isNumType: isNumType, isDateType: isDateType
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.OrosBaseCore = API;
})(typeof window !== "undefined" ? window : globalThis);
