// ============================================================
// orOS Connected services — Spreadsheet platforms (links/sheets.js, v1.0.0)
// Pure: the requests that read the Notion databases shared with the
// user's own integration (integrations wave 6E), what the answers mean,
// one table per database, and the plan that brings them into
// Spreadsheet. No DOM, no storage, no network: spreadsheet/platforms.js
// makes the calls through the shell (orosLinks.call, always via the
// relay: Notion doesn't answer browsers) and spreadsheet.js applies it.
//   searchReq(cursor) → the POST that lists databases (100 a page)
//   readSearch(data) → { dbs: [{ xid, title, cols: [{ name, type }] }], next }
//   queryReq(id, cursor) → the POST that reads one database's rows
//   readRows(data, cols) → { rows: [[cell, …]], next }
//   table(db) → [[header…], [row…], …] (cells as Spreadsheet stores them)
//   plan(st, got, ctx) → what changes in Spreadsheet (st = its sheets)
//   count(plan) → { add, upd }
// The platform is only read; Spreadsheet stays the source of truth:
//   - one sheet per database, row 1 = the property names (title first)
//   - ids from L.extId: a second import finds the sheet again
//   - a sheet deleted here is not brought back unless asked
//   - an update (opt-in, off by default) replaces the sheet's values
//     with the database's; its name, formats and place stay
// A cell is plain text: one starting with = + - @ gets an apostrophe,
// so it never runs as a formula (the same rule as "Open in Spreadsheet").
// ============================================================
(function (root) {
  "use strict";

  var L = typeof module !== "undefined" && module.exports ? require("./core.js") : root.OrosLinksCore;

  var PLATFORMS = ["notion"];
  var PAGE = 100;
  // 500 rows × 64 columns is Spreadsheet's largest sheet (row 1 = names)
  var MAX = { dbs: 20, rows: 499, cols: 64, rowPages: 5 };
  var NAME_LEN = 31, CELL_LEN = 500;
  var ID_RE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/;

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function nid(v) { return typeof v === "string" && ID_RE.test(v) ? v.replace(/-/g, "").toLowerCase().replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5") : ""; }
  function plain(arr) {
    if (!Array.isArray(arr)) return "";
    return arr.map(function (r) { return r && typeof r.plain_text === "string" ? r.plain_text : ""; }).join("");
  }
  function str(v) { return typeof v === "string" ? v : ""; }
  function names(arr, key) {
    return (Array.isArray(arr) ? arr : []).map(function (x) { return x && typeof x[key || "name"] === "string" ? x[key || "name"] : ""; })
      .filter(function (s) { return s; }).join(", ");
  }
  // "2026-10-13" stays; "2026-10-13T09:30:00.000+03:00" → "2026-10-13 09:30"
  function when(v) {
    if (typeof v !== "string") return "";
    var m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/.exec(v);
    return m ? m[1] + (m[2] ? " " + m[2] : "") : "";
  }
  function dateOf(d) {
    if (!d || typeof d !== "object") return "";
    var s = when(d.start), e = when(d.end);
    return s && e ? s + " → " + e : s;
  }
  function num(v) { return typeof v === "number" && isFinite(v) ? v : ""; }

  // One property value → a number or a string ("" = empty)
  function valueOf(pr) {
    if (!pr || typeof pr !== "object" || typeof pr.type !== "string") return "";
    var v = pr[pr.type];
    switch (pr.type) {
      case "title": case "rich_text": return plain(v);
      case "number": return num(v);
      case "select": case "status": return v && typeof v.name === "string" ? v.name : "";
      case "multi_select": return names(v);
      case "date": return dateOf(v);
      case "checkbox": return v === true ? "TRUE" : "FALSE";
      case "url": case "email": case "phone_number": return str(v);
      case "people": return names(v);
      case "files": return names(v);
      case "created_time": case "last_edited_time": return when(v);
      case "created_by": case "last_edited_by": return v && typeof v.name === "string" ? v.name : "";
      case "relation": return Array.isArray(v) ? v.length : "";
      case "unique_id": return v && typeof v.number === "number" ? (typeof v.prefix === "string" && v.prefix ? v.prefix + "-" : "") + v.number : "";
      case "formula":
        if (!v || typeof v !== "object") return "";
        if (v.type === "number") return num(v.number);
        if (v.type === "string") return str(v.string);
        if (v.type === "boolean") return v.boolean === true ? "TRUE" : v.boolean === false ? "FALSE" : "";
        if (v.type === "date") return dateOf(v.date);
        return "";
      case "rollup":
        if (!v || typeof v !== "object") return "";
        if (v.type === "number") return num(v.number);
        if (v.type === "date") return dateOf(v.date);
        if (v.type === "array" && Array.isArray(v.array)) return v.array.map(function (x) { var y = valueOf(x); return typeof y === "number" ? String(y) : y; }).filter(function (s) { return s; }).join(", ");
        return "";
      default: return "";
    }
  }
  // A value as Spreadsheet stores it: a string, plain text
  function cell(v) {
    if (typeof v === "number") return isFinite(v) ? String(v) : "";
    if (typeof v !== "string") return "";
    v = v.replace(/\r\n?|\n/g, " ").replace(/[\u0000-\u0008\u000b-\u001f\u007f\u2028\u2029]/g, " ").slice(0, CELL_LEN);
    return /^[=+\-@]/.test(v) ? "'" + v : v;
  }
  function sheetName(s) {
    return String(s || "").replace(/[\u0000-\u001f\u007f\\\/\?\*\[\]:]/g, " ").replace(/\s+/g, " ").slice(0, NAME_LEN).trim();
  }

  var SEARCH_FILTER = { property: "object", value: "database" };
  function searchReq(cursor) {
    var body = { filter: SEARCH_FILTER, page_size: PAGE };
    if (cursor) body.start_cursor = cursor;
    return { m: "POST", path: "/search", body: body };
  }
  function queryReq(id, cursor) {
    var d = nid(id);
    if (!d) return null;
    var body = { page_size: PAGE };
    if (cursor) body.start_cursor = nid(cursor);
    return { m: "POST", path: "/databases/" + d + "/query", body: body };
  }
  function next(data) {
    return data && data.has_more === true ? nid(data.next_cursor) : "";
  }

  // Columns: the title property first, then the rest as Notion lists them
  function readSearch(data) {
    var list = data && Array.isArray(data.results) ? data.results : [];
    var dbs = [];
    list.forEach(function (db) {
      if (!db || db.object !== "database" || db.archived === true || db.in_trash === true) return;
      var id = nid(db.id);
      if (!id) return;
      var props = db.properties && typeof db.properties === "object" ? db.properties : {};
      var cols = [], title = null;
      Object.keys(props).forEach(function (k) {
        var pr = props[k];
        if (!pr || typeof pr.type !== "string") return;
        var c = { name: typeof pr.name === "string" ? pr.name : k, key: k, type: pr.type };
        if (pr.type === "title") title = c; else cols.push(c);
      });
      if (title) cols.unshift(title);
      dbs.push({ xid: id, title: plain(db.title).replace(/\s+/g, " ").trim(), cols: cols.slice(0, MAX.cols) });
    });
    return { dbs: dbs, next: next(data) };
  }
  function readRows(data, cols) {
    var list = data && Array.isArray(data.results) ? data.results : [];
    var rows = [];
    list.forEach(function (pg) {
      if (!pg || pg.object !== "page" || pg.archived === true || pg.in_trash === true) return;
      var props = pg.properties && typeof pg.properties === "object" ? pg.properties : {};
      rows.push((cols || []).map(function (c) { return has(props, c.key) ? valueOf(props[c.key]) : ""; }));
    });
    return { rows: rows, next: next(data) };
  }

  // db: { cols, rows } → the sheet's values (row 1 = the column names)
  function table(db) {
    var out = [(db.cols || []).map(function (c) { return cell(c.name); })];
    (db.rows || []).slice(0, MAX.rows).forEach(function (r) { out.push(r.slice(0, MAX.cols).map(cell)); });
    return trim(out);
  }
  // Trailing empty cells and rows out, so two tables compare by content
  function trim(rows) {
    var out = rows.map(function (r) {
      var a = (r || []).map(function (v) { return typeof v === "string" ? v : ""; });
      while (a.length && a[a.length - 1] === "") a.pop();
      return a;
    });
    while (out.length && !out[out.length - 1].length) out.pop();
    return out;
  }
  function same(a, b) { return JSON.stringify(trim(a || [])) === JSON.stringify(trim(b || [])); }

  // st: { sheets: { id: values (rows of strings) }, deleted: { id: ts } }
  // got: { dbs: [{ xid, title, cols, rows }] }
  // ctx: { p, acct, untitled, upd, revive }
  function plan(st, got, ctx) {
    var sheets = st && st.sheets && typeof st.sheets === "object" ? st.sheets : {};
    var deleted = st && st.deleted && typeof st.deleted === "object" ? st.deleted : {};
    var out = { add: [], upd: [], same: 0, gone: 0 };
    ((got && got.dbs) || []).forEach(function (db) {
      if (!db || !db.xid) return;
      var id = L.extId(ctx.p, ctx.acct, "sheet", db.xid), rows = table(db);
      if (has(sheets, id)) {
        if (ctx.upd && !same(sheets[id], rows)) out.upd.push({ id: id, rows: rows });
        else out.same++;
        return;
      }
      if (has(deleted, id) && !ctx.revive) { out.gone++; return; }
      out.add.push({ id: id, name: sheetName(db.title) || sheetName(ctx.untitled) || "Notion", rows: rows });
    });
    return out;
  }
  function count(pl) { return { add: pl.add.length, upd: pl.upd.length }; }

  var api = { PLATFORMS: PLATFORMS, PAGE: PAGE, MAX: MAX, SEARCH_FILTER: SEARCH_FILTER,
              searchReq: searchReq, readSearch: readSearch, queryReq: queryReq, readRows: readRows,
              valueOf: valueOf, cell: cell, table: table, trim: trim, plan: plan, count: count };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosLinksSheets = api;
})(typeof window !== "undefined" ? window : this);
