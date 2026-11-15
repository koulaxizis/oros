// ============================================================
// orOS Publishing — distro.js: a music distributor's sales report
// into royalty statements (wave M4 of music releases, PB-MUS)
// ------------------------------------------------------------
// Pure, no DOM. Loaded by publish/index.html after core.js and
// royalty.js, and by Node in the tests.
//
// The person downloads the report from their distributor (DistroKid:
// Bank › See Excel version; others: CSV, TSV or a spreadsheet) and
// opens it here. The file is read as data only: no formula is run
// (a spreadsheet gives its stored values), a cell is a string, and the
// file has a size and row limit.
//   parse(text)            → { rows: [[cell…]], delim } | { err }
//   sheetRows(values)      → the same, from a spreadsheet's first sheet
//   guess(header)          → { preset, map: { field: column index } }
//   read(rows, map, o)     → { lines, bad }   o: { cur, start }
//   match(pub, lines, links) → { tracks, releases, unmatched, from, to, curs }
//   statements(pub, m, o)  → [statement drafts, one per person and currency]
// Matching: a line's ISRC finds the track, else its UPC/EAN finds the
// release. Lines that find nothing are listed, never guessed. Sums
// are kept per currency; nothing is converted.
// Who is paid: a track with master ownership shares (sm, wave M2) pays
// each owner their share of what the track earned; a track without
// them pays the release's royalty terms (title.roy, pct of what came
// in). The rest is the label's and is not a statement.
// ============================================================
(function (root) {
  "use strict";

  var P = typeof module !== "undefined" && module.exports ? require("./core.js") : root.OrosPublishCore;
  var R = typeof module !== "undefined" && module.exports ? require("./royalty.js") : root.OrosPublishRoyalty;

  var MAX_BYTES = 20 * 1024 * 1024, MAX_ROWS = 200000, MAX_CELL = 500;
  var FIELDS = ["month", "isrc", "upc", "qty", "amt", "cur", "title", "artist", "store", "country"];

  // Column names as distributors write them (folded: lower case, no
  // accents, spaces and punctuation as one space). The first preset
  // whose required columns are all there wins.
  var PRESETS = [
    { id: "distrokid", name: "DistroKid", cur: "USD",
      need: ["sale month", "isrc", "quantity", "earnings usd"],
      cols: { month: ["sale month"], isrc: ["isrc"], upc: ["upc"], qty: ["quantity"], amt: ["earnings usd"],
              title: ["title"], artist: ["artist"], store: ["store"], country: ["country of sale"] } }
  ];
  // For any other report: the usual words for each field.
  var WORDS = {
    month: ["sale month", "sales month", "month", "period", "sale period", "reporting period", "statement period", "date", "sale date", "transaction date"],
    isrc: ["isrc", "track isrc", "isrc code"],
    upc: ["upc", "ean", "upc ean", "release upc", "album upc", "barcode", "gtin"],
    qty: ["quantity", "units", "qty", "streams", "plays", "downloads", "sales"],
    amt: ["earnings", "net revenue", "net earnings", "revenue", "royalty", "royalties", "amount", "net amount", "payable", "earnings usd", "earnings eur", "total"],
    cur: ["currency", "currency code", "curr"],
    title: ["title", "track title", "song title", "track", "song", "release title", "product title"],
    artist: ["artist", "artist name", "track artist", "release artist"],
    store: ["store", "service", "platform", "dsp", "retailer", "partner", "shop"],
    country: ["country", "country of sale", "territory", "region"]
  };

  function fold(s) {
    return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
      .replace(/[^a-z0-9]+/g, " ").trim();
  }
  function cell(s) {
    // as data only: control characters out, a bounded length; a cell that
    // looks like a formula stays the text it is
    return String(s).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(0, MAX_CELL);
  }

  // CSV / TSV / semicolon text → rows of cells (RFC 4180 quotes).
  function parse(text) {
    if (typeof text !== "string") return { err: "type" };
    if (text.length > MAX_BYTES) return { err: "big" };
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    var first = text.slice(0, 4000).split(/\r?\n/)[0] || "";
    var counts = { "\t": first.split("\t").length, ",": first.split(",").length, ";": first.split(";").length };
    var delim = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; })[0];
    if (counts[delim] < 2) return { err: "cols" };
    var rows = [], row = [], cur = "", q = false, i = 0, n = text.length;
    for (; i < n; i++) {
      var c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += c;
        continue;
      }
      if (c === '"' && cur === "") { q = true; continue; }
      if (c === delim) { row.push(cell(cur)); cur = ""; continue; }
      if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cell(cur)); cur = "";
        if (row.some(function (x) { return x !== ""; })) rows.push(row);
        row = [];
        if (rows.length > MAX_ROWS) return { err: "rows" };
        continue;
      }
      cur += c;
    }
    row.push(cell(cur));
    if (row.some(function (x) { return x !== ""; })) rows.push(row);
    if (rows.length < 2) return { err: "empty" };
    return { rows: rows, delim: delim };
  }

  // Rows a spreadsheet reader gave (an .xlsx/.ods sheet, values only:
  // numbers, text, dates) → the same clean rows parse() makes.
  function sheetRows(list) {
    if (!Array.isArray(list)) return { err: "type" };
    var rows = [];
    for (var i = 0; i < list.length; i++) {
      var r = Array.isArray(list[i]) ? list[i] : [];
      var row = r.slice(0, 200).map(function (v) {
        if (v instanceof Date) return isNaN(v) ? "" : v.toISOString().slice(0, 10);
        if (typeof v === "number") return isFinite(v) ? String(v) : "";
        return v == null || typeof v === "object" ? "" : cell(v);
      });
      if (row.some(function (x) { return x !== ""; })) rows.push(row);
      if (rows.length > MAX_ROWS) return { err: "rows" };
    }
    if (rows.length < 2) return { err: "empty" };
    return { rows: rows, delim: "" };
  }

  // The header row → the preset it is and a column for each field.
  function guess(header) {
    var h = (header || []).map(fold);
    function find(names) {
      for (var j = 0; j < names.length; j++) { var at = h.indexOf(names[j]); if (at >= 0) return at; }
      return -1;
    }
    for (var p = 0; p < PRESETS.length; p++) {
      var ps = PRESETS[p];
      if (ps.need.every(function (x) { return h.indexOf(x) >= 0; })) {
        var map = {};
        FIELDS.forEach(function (f) { map[f] = ps.cols[f] ? find(ps.cols[f]) : -1; });
        return { preset: ps.id, name: ps.name, cur: ps.cur, map: map };
      }
    }
    var m = {};
    FIELDS.forEach(function (f) { m[f] = find(WORDS[f]); });
    // a column like "Earnings (EUR)" names the currency
    var cur = "", AMT_CUR = /^(earnings|revenue|net revenue|net earnings|amount|royalties|payable|total) ([a-z]{3})$/;
    if (m.amt < 0) h.forEach(function (x, j) { if (m.amt < 0 && AMT_CUR.test(x)) m.amt = j; });
    var g = m.amt >= 0 && AMT_CUR.exec(h[m.amt]);
    if (g) cur = g[2].toUpperCase();
    return { preset: "", name: "", cur: cur, map: m };
  }

  // A number as a report writes it: 1,234.56 · 1.234,56 · 0.00351 · (1.20)
  function number(s) {
    var v = String(s || "").replace(/[\s '’]/g, "").replace(/^[$€£¥]|[$€£¥]$/g, "");
    var neg = /^\(.*\)$/.test(v) || /^-/.test(v);
    v = v.replace(/[()]/g, "").replace(/^[-+]/, "");
    if (!v) return 0;
    if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(v)) v = v.replace(/,/g, "");
    else if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(v)) v = v.replace(/\./g, "").replace(",", ".");
    else if (/^\d+,\d+$/.test(v)) v = v.replace(",", ".");
    if (!/^\d+(\.\d+)?(e-?\d+)?$/i.test(v)) return NaN;
    var x = Number(v);
    return neg ? -x : x;
  }
  // "2026-08" · "2026-08-15" · "08/2026" · "Aug 2026" · "2026/8" → "2026-08"
  var MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  function month(s) {
    var v = String(s || "").trim().toLowerCase(), g;
    function ok(y, m) { return y >= 1990 && y <= 2199 && m >= 1 && m <= 12 ? y + "-" + (m < 10 ? "0" : "") + m : ""; }
    if ((g = /^(\d{4})[-\/.](\d{1,2})(?:[-\/.]\d{1,2})?/.exec(v))) return ok(+g[1], +g[2]);
    if ((g = /^(\d{1,2})[-\/.](\d{4})$/.exec(v))) return ok(+g[2], +g[1]);
    if ((g = /^\d{1,2}[-\/.](\d{1,2})[-\/.](\d{4})$/.exec(v))) return ok(+g[2], +g[1]);
    if ((g = /^([a-z]{3})[a-z]*[ \-,]+(\d{4})$/.exec(v)) && MON[g[1]]) return ok(+g[2], MON[g[1]]);
    return "";
  }
  function curOk(s) { var v = String(s || "").trim().toUpperCase(); return /^[A-Z]{3}$/.test(v) ? v : ""; }

  // rows (header first) + map → clean lines. amt in cents, kept with
  // its fractions (a stream earns a fraction of a cent; the sum is
  // rounded once, per track). A line without a month, an amount, or
  // any code or title is counted as bad and left out.
  function read(rows, map, o) {
    o = o || {};
    var lines = [], bad = 0, start = o.start == null ? 1 : o.start;
    function at(r, f) { return map[f] >= 0 && map[f] < r.length ? r[map[f]] : ""; }
    for (var i = start; i < rows.length; i++) {
      var r = rows[i];
      var ym = month(at(r, "month")), amt = number(at(r, "amt")), q = map.qty >= 0 ? number(at(r, "qty")) : 0;
      var isrc = P.parseIsrc(at(r, "isrc")), upc = P.parseUpc(at(r, "upc"));
      var cur = curOk(at(r, "cur")) || o.cur || "";
      if (!ym || !isFinite(amt) || !isFinite(q) || !cur || (!isrc.ok && !upc.ok && !at(r, "title"))) { bad++; continue; }
      lines.push({ ym: ym, isrc: isrc.ok ? isrc.isrc : "", upc: upc.ok ? upc.upc : "", q: q, amt: amt * 100, cur: cur,
                   title: at(r, "title").slice(0, 200), artist: at(r, "artist").slice(0, 200), store: at(r, "store").slice(0, 80),
                   country: at(r, "country").slice(0, 40) });
    }
    return { lines: lines, bad: bad };
  }

  function lastDay(ym) { var y = +ym.slice(0, 4), m = +ym.slice(5, 7); return ym + "-" + new Date(Date.UTC(y, m, 0)).getUTCDate(); }

  // Lines → sums per track (by ISRC) or release (by UPC/EAN), per
  // currency, with the stores for a breakdown; what found nothing.
  // links: { unmatched key → track id } that the person chose for lines
  // whose codes the release doesn't have yet.
  function unKey(l) { return l.isrc || l.upc || fold(l.title + " " + l.artist); }
  function match(pub, lines, links) {
    links = links || {};
    var d = P.normalize(pub), live = {}, byIsrc = {}, byUpc = {};
    d.titles.forEach(function (t) { live[t.id] = t; });
    d.trk.forEach(function (r) { if (r.isrc && live[r.ti]) byIsrc[r.isrc] = r; });
    d.med.forEach(function (r) { if (r.upc && live[r.ti]) byUpc[P.upcKey(r.upc)] = r; });
    var tracks = {}, releases = {}, un = {}, curs = {}, from = "", to = "";
    function add(box, k, l, extra) {
      var x = box[k + "|" + l.cur] || (box[k + "|" + l.cur] = Object.assign({ cur: l.cur, q: 0, amt: 0, stores: {}, isrcs: [] }, extra));
    if (l.isrc && x.isrcs.indexOf(l.isrc) < 0 && x.isrcs.length < 20) x.isrcs.push(l.isrc);
      x.q += l.q; x.amt += l.amt;
      if (l.store) x.stores[l.store] = (x.stores[l.store] || 0) + l.amt;
    }
    lines.forEach(function (l) {
      curs[l.cur] = 1;
      if (!from || l.ym < from) from = l.ym;
      if (!to || l.ym > to) to = l.ym;
      var tr = (l.isrc && byIsrc[l.isrc]) || (links[unKey(l)] && P.find(d, "trk", links[unKey(l)]));
      if (tr && !live[tr.ti]) tr = null;
      if (tr) { add(tracks, tr.id, l, { ti: tr.ti, tk: tr.id }); return; }
      var ed = l.upc && byUpc[P.upcKey(l.upc)];
      if (ed) { add(releases, ed.ti, l, { ti: ed.ti }); return; }
      add(un, unKey(l), l, { key: unKey(l), isrc: l.isrc, upc: l.upc, title: l.title, artist: l.artist });
    });
    function vals(o) { return Object.keys(o).sort().map(function (k) { return o[k]; }); }
    return { tracks: vals(tracks), releases: vals(releases), unmatched: vals(un).sort(function (a, b) { return Math.abs(b.amt) - Math.abs(a.amt); }),
             from: from ? from + "-01" : "", to: to ? lastDay(to) : "", curs: Object.keys(curs).sort() };
  }

  // Draft statements: one per person and currency. Each row is one
  // track (or a release's sales without a track): fb = what came in
  // (cents, fixed: recompute keeps it), q = units, pct = the share.
  function statements(pub, m, o) {
    o = o || {};
    var d = P.normalize(pub), per = {};
    function title(id) { return P.find(d, "titles", id); }
    function push(name, cur, row) {
      var k = R.key(name) + "|" + cur;
      var s = per[k] || (per[k] = { id: "", m: 0, n: name, from: m.from, to: m.to, cur: cur, rows: [], rec: [], due: 0, paid: "",
                                     note: (o.note || "").slice(0, 1000) });
      s.rows.push(row);
    }
    function row(t, tr, label, x, pct, codes) {
      var b = Math.round(x.amt);
      return Object.assign({ ti: t.id, tr: tr, t: label, k: "", isbn: "", q: Math.round(x.q * 1000) / 1000, base: "net",
                             u: x.q > 0 ? Math.round(b / x.q * 100) / 100 : 0, fb: b, b: b, pct: pct, e: 0 }, codes);
    }
    m.tracks.forEach(function (x) {
      var tr = P.find(d, "trk", x.tk), t = title(x.ti);
      if (!tr || !t) return;
      var label = (t.t !== tr.t ? t.t + " · " : "") + tr.t + (tr.ver ? " (" + tr.ver + ")" : "");
      var codes = { isrc: tr.isrc || (x.isrcs.length === 1 ? x.isrcs[0] : "") };
      if (tr.sm && tr.sm.length) tr.sm.forEach(function (s) { if (s.pct > 0) push(s.n, x.cur, row(t, tr.id, label, x, s.pct, codes)); });
      else (t.roy || []).forEach(function (r) { if (!r.k) push(r.n, x.cur, row(t, r.id, label, x, r.pct, codes)); });
    });
    m.releases.forEach(function (x) {
      var t = title(x.ti);
      if (!t) return;
      var ed = P.editionsOf(d, t.id).filter(function (e) { return e.upc; })[0];
      (t.roy || []).forEach(function (r) { if (!r.k) push(r.n, x.cur, row(t, r.id, t.t, x, r.pct, { upc: ed ? ed.upc : "" })); });
    });
    return Object.keys(per).sort().map(function (k) {
      var s = R.recompute(per[k], d);
      // an earlier statement of the same person that overlaps this period
      s.overlap = (d.stmts || []).some(function (z) { return z.v !== 1 && R.key(z.n) === R.key(s.n) && z.cur === s.cur && z.from <= s.to && z.to >= s.from; });
      return s;
    });
  }

  // After issuing: the ISRC a linked line carried goes onto a track that
  // has none, so the next report matches by itself. → [{ id, isrc }]
  function learn(pub, m) {
    var d = P.normalize(pub), used = {}, out = [];
    d.trk.forEach(function (r) { if (r.isrc) used[r.isrc] = 1; });
    m.tracks.forEach(function (x) {
      var tr = P.find(d, "trk", x.tk);
      if (!tr || tr.isrc || x.isrcs.length !== 1 || used[x.isrcs[0]]) return;
      used[x.isrcs[0]] = 1;
      out.push({ id: tr.id, isrc: x.isrcs[0] });
    });
    return out;
  }

  var API = { FIELDS: FIELDS, PRESETS: PRESETS, MAX_BYTES: MAX_BYTES, parse: parse, guess: guess, number: number, month: month,
              read: read, sheetRows: sheetRows, match: match, statements: statements, learn: learn, unKey: unKey };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.OrosPublishDistro = API;
})(typeof window !== "undefined" ? window : globalThis);
