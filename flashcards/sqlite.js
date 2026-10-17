// ============================================================
// orOS Flashcards — a small READ-ONLY SQLite reader (FlashcardsSqlite)
// Reads the tables of an SQLite 3 database file held in memory, enough
// for Anki collections (wave 3 import). It never writes and never runs
// SQL: it walks the B-tree pages described in the public file-format
// document (https://www.sqlite.org/fileformat2.html, public domain).
//   - table B-trees (rowid tables) and index B-trees (WITHOUT ROWID
//     tables, whose rows live in the index cells, interior ones too);
//   - records with every serial type, overflow pages, UTF-8/UTF-16;
//   - INTEGER PRIMARY KEY columns read back as the rowid.
// Not read: the WAL file, freelist pages, indexes of rowid tables.
// Hostile files: every page is bounds-checked, a page is visited at
// most once per scan (no loops), and row and byte counts are capped.
// Pure: no DOM. window.FlashcardsSqlite (browser) or module.exports.
// ============================================================
(function (root) {
  "use strict";

  var MAGIC = "SQLite format 3\u0000";
  var MAX_ROWS = 2000000;

  function fail(why) { var e = new Error("sqlite"); e.code = "sqlite"; e.why = why; return e; }

  function open(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length < 512) throw fail("short");
    for (var i = 0; i < 16; i++) if (bytes[i] !== MAGIC.charCodeAt(i)) throw fail("magic");
    var pageSize = (bytes[16] << 8) | bytes[17];
    if (pageSize === 1) pageSize = 65536;
    if (pageSize < 512 || pageSize > 65536 || (pageSize & (pageSize - 1))) throw fail("pagesize");
    var reserved = bytes[20];
    var usable = pageSize - reserved;
    if (usable < 480) throw fail("reserved");
    var encNo = ((bytes[56] << 24) | (bytes[57] << 16) | (bytes[58] << 8) | bytes[59]) >>> 0;
    var dec = new TextDecoder(encNo === 2 ? "utf-16le" : encNo === 3 ? "utf-16be" : "utf-8");
    var pageCount = Math.floor(bytes.length / pageSize);

    function pageOff(n) {
      if (!(n >= 1 && n <= pageCount)) throw fail("page");
      return (n - 1) * pageSize;
    }
    function u16(o) { return (bytes[o] << 8) | bytes[o + 1]; }
    function u32(o) { return ((bytes[o] << 24) >>> 0) + (bytes[o + 1] << 16) + (bytes[o + 2] << 8) + bytes[o + 3]; }
    // Varint: 1-9 bytes, big-endian groups of 7 bits, the 9th byte whole.
    function varint(o) {
      var v = 0;
      for (var k = 0; k < 8; k++) {
        var b = bytes[o + k];
        if (b === undefined) throw fail("varint");
        v = v * 128 + (b & 0x7f);
        if (!(b & 0x80)) return [v, k + 1];
      }
      if (bytes[o + 8] === undefined) throw fail("varint");
      return [v * 256 + bytes[o + 8], 9];
    }

    // Payload of a cell: the local part plus the overflow chain.
    function payload(o, total, isIndex) {
      var X = isIndex ? Math.floor((usable - 12) * 64 / 255) - 23 : usable - 35;
      if (total <= X) {
        if (o + total > bytes.length) throw fail("cell");
        return bytes.subarray(o, o + total);
      }
      var M = Math.floor((usable - 12) * 32 / 255) - 23;
      var K = M + ((total - M) % (usable - 4));
      var local = K <= X ? K : M;
      if (total > 64 * 1024 * 1024) throw fail("toobig");
      var out = new Uint8Array(total);
      out.set(bytes.subarray(o, o + local), 0);
      var have = local, next = u32(o + local), seen = {};
      while (have < total) {
        if (!next || seen[next]) throw fail("overflow");
        seen[next] = 1;
        var po = pageOff(next), take = Math.min(usable - 4, total - have);
        out.set(bytes.subarray(po + 4, po + 4 + take), have);
        have += take;
        next = u32(po);
      }
      return out;
    }

    // A record → array of values.
    function record(p) {
      // varint on the payload buffer
      function vi(buf, o) {
        var v = 0;
        for (var k = 0; k < 8; k++) {
          var b = buf[o + k];
          if (b === undefined) throw fail("record");
          v = v * 128 + (b & 0x7f);
          if (!(b & 0x80)) return [v, k + 1];
        }
        if (buf[o + 8] === undefined) throw fail("record");
        return [v * 256 + buf[o + 8], 9];
      }
      var h = vi(p, 0), hdr = h[0];
      if (hdr > p.length) throw fail("record");
      var types = [], o = h[1];
      while (o < hdr) { var t = vi(p, o); types.push(t[0]); o += t[1]; }
      var vals = [], d = hdr;
      types.forEach(function (st) {
        var n;
        if (st === 0) { vals.push(null); return; }
        if (st === 8) { vals.push(0); return; }
        if (st === 9) { vals.push(1); return; }
        if (st >= 1 && st <= 6) {
          n = [0, 1, 2, 3, 4, 6, 8][st];
          if (d + n > p.length) throw fail("record");
          vals.push(readInt(p, d, n));
          d += n;
          return;
        }
        if (st === 7) {
          if (d + 8 > p.length) throw fail("record");
          vals.push(new DataView(p.buffer, p.byteOffset + d, 8).getFloat64(0, false));
          d += 8;
          return;
        }
        if (st >= 12) {
          n = st % 2 === 0 ? (st - 12) / 2 : (st - 13) / 2;
          if (d + n > p.length) throw fail("record");
          var part = p.subarray(d, d + n);
          vals.push(st % 2 === 0 ? part.slice() : dec.decode(part));
          d += n;
          return;
        }
        throw fail("serial");
      });
      return vals;
    }
    function readInt(p, o, n) {
      var neg = p[o] & 0x80, v = 0;
      for (var k = 0; k < n; k++) v = v * 256 + p[o + k];
      return neg ? v - Math.pow(2, 8 * n) : v;
    }
    function varintIn(o) { return varint(o); }

    // Visit every row of the B-tree at `rootPage`: fn(values, rowid) (rowid null for index trees).
    function walk(rootPage, fn, maxRows) {
      var count = 0, seen = {}, stack = [rootPage];
      maxRows = Math.min(maxRows || MAX_ROWS, MAX_ROWS);
      while (stack.length) {
        var pg = stack.pop();
        if (seen[pg]) throw fail("loop");
        seen[pg] = 1;
        var base = pageOff(pg), h = pg === 1 ? base + 100 : base;
        var type = bytes[h], cells = u16(h + 3);
        var interior = type === 2 || type === 5, isIndex = type === 2 || type === 10;
        if (type !== 2 && type !== 5 && type !== 10 && type !== 13) throw fail("pagetype");
        var ptrs = h + (interior ? 12 : 8);
        if (ptrs + cells * 2 > base + pageSize) throw fail("cells");
        var kids = [];
        for (var c = 0; c < cells; c++) {
          var o = base + u16(ptrs + c * 2);
          if (o < base || o >= base + pageSize) throw fail("cellptr");
          if (type === 5) { kids.push(u32(o)); continue; }
          if (type === 2) { kids.push(u32(o)); o += 4; }
          var ps = varintIn(o); o += ps[1];
          var rowid = null;
          if (type === 13) { var r = varintIn(o); rowid = r[0]; o += r[1]; }
          if (count >= maxRows) return count;
          fn(record(payload(o, ps[0], isIndex)), rowid);
          count++;
        }
        if (interior) kids.push(u32(h + 8));
        // Children are pushed in reverse so they are read in key order.
        for (var k = kids.length - 1; k >= 0; k--) stack.push(kids[k]);
      }
      return count;
    }

    // sqlite_master lives in page 1.
    var master = [];
    walk(1, function (v) { master.push({ type: v[0], name: v[1], tbl: v[2], root: v[3], sql: v[4] }); });
    var tables = {};
    master.forEach(function (m) {
      if (m.type !== "table" || typeof m.name !== "string" || !(m.root > 0)) return;
      tables[m.name.toLowerCase()] = { name: m.name, root: m.root, sql: String(m.sql || ""), cols: null };
    });

    function info(name) {
      var t = tables[String(name).toLowerCase()];
      if (!t) return null;
      if (!t.cols) t.cols = parseColumns(t.sql);
      return t;
    }
    return {
      pageSize: pageSize,
      tables: function () { return Object.keys(tables).map(function (k) { return tables[k].name; }).sort(); },
      has: function (name) { return !!info(name); },
      columns: function (name) { var t = info(name); return t ? t.cols.names.slice() : []; },
      // Rows as objects keyed by column name.
      rows: function (name, max) {
        var t = info(name), out = [];
        if (!t) return out;
        var cols = t.cols;
        walk(t.root, function (vals, rowid) {
          var o = {};
          cols.names.forEach(function (c, i) {
            var v = i < vals.length ? vals[i] : null;
            if (i === cols.rowidAlias && v === null && rowid !== null) v = rowid;
            o[c] = v;
          });
          if (rowid !== null) o.__rowid = rowid;
          out.push(o);
        }, max);
        return out;
      }
    };
  }

  // Column names from CREATE TABLE text, and which one is the rowid alias.
  function splitTop(s) {
    var out = [], depth = 0, cur = "", q = "";
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (q) { cur += ch; if (ch === q) q = ""; continue; }
      if (ch === "'" || ch === "\"" || ch === "`" || ch === "[") { q = ch === "[" ? "]" : ch; cur += ch; continue; }
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) { out.push(cur); cur = ""; continue; }
      cur += ch;
    }
    if (cur.trim()) out.push(cur);
    return out;
  }
  function unquote(n) {
    n = String(n || "").trim();
    var m = /^(["`[])([\s\S]*)["`\]]$/.exec(n);
    return m ? m[2] : n;
  }
  function parseColumns(sql) {
    var a = sql.indexOf("("), b = sql.lastIndexOf(")");
    var names = [], alias = -1;
    if (a < 0 || b <= a) return { names: names, rowidAlias: alias };
    var withoutRowid = /\)\s*without\s+rowid\s*;?\s*$/i.test(sql);
    splitTop(sql.slice(a + 1, b)).forEach(function (def) {
      def = def.trim();
      if (/^(constraint|primary\s+key|unique|check|foreign\s+key)\b/i.test(def)) return;
      var m = /^("(?:[^"]|"")*"|`[^`]*`|\[[^\]]*\]|'[^']*'|[^\s(]+)\s*([\s\S]*)$/.exec(def);
      if (!m) return;
      var name = unquote(m[1]);
      if (!withoutRowid && /^integer\b[\s\S]*\bprimary\s+key\b/i.test(m[2].trim())) alias = names.length;
      names.push(name);
    });
    return { names: names, rowidAlias: alias };
  }

  var API = { open: open, parseColumns: parseColumns };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root && typeof window !== "undefined") root.FlashcardsSqlite = API;
})(typeof window !== "undefined" ? window : globalThis);
