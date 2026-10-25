// ============================================================
// orOS Publishing — data model, ISBN and barcode math (pure, no DOM)
// Loaded by index.html before app.js, by search.js callers and by
// Node in the tests. For any small publisher: nothing here names a
// real house.
// Data in localStorage "oros-publish-data" (slice "publish"):
//   { ver: 1,
//     titles: [{ id, m, t, sub, ser, sn, st, rel "YYYY-MM-DD"|"", lang,
//                ppl: [{ r, n, crm? }], fmts: [{ id, k, isbn, price,
//                pages, w, h, sp, wt, bind, paper, dur, note }],
//                blurb, bio, kw, notes, cov }],
//     blocks: [{ id, m, p, note }],      ISBN blocks: p = the prefix as
//                the agency gave it, with hyphens ("978-618-5321")
//     isbnx:  [{ id, m, note }],         numbers used outside the app or
//                spoiled; id = the 13 digits
//     set:    { m, cur },
//     tombs:  { id: ms } }
//   Later waves add lists of { id, m, … } rows; until a device knows a
//   list it keeps and merges it as it came (LWW by m per id), so an
//   older device never drops what a newer one wrote (forward safe).
//   A title keeps fields it does not know the same way.
// Sync rules (OROS_BIBLE.md Part I, Part VI):
//   - merge(a, b) === merge(b, a): union by id, the newer m wins, a
//     tie goes to the larger JSON (R5), never "local wins";
//   - merge(a, a) === a, so a pull never makes the slice dirty;
//   - a tombstone at least as new as the row deletes it, a newer edit
//     brings it back (R17);
//   - no uid() or Date.now() inside the merge; bad rows are dropped;
//   - serialize() is canonical: lists sorted by id, keys in order.
// The cover picture is never stored here: only its path on the orOS
// disk (/internal/Publishing/Covers/…), the file travels with Vault.
// ============================================================
(function (root) {
  "use strict";

  var VER = 1;
  var LISTS = ["titles", "blocks", "isbnx"];
  var STATUS = ["idea", "prod", "out", "oop"];
  var FMT_KINDS = ["pb", "hb", "eb", "ab", "ot"];
  var ROLES = ["a", "t", "i", "e", "c", "n", "o"];
  var MAX_PPL = 12, MAX_FMTS = 8, MAX_ROWS = 5000, MAX_EXTRA = 8000;
  var COVER_DIR = "/internal/Publishing/Covers";
  var COVER_RE = /^[a-z0-9-]{1,80}\.(jpg|png)$/;
  var CURS = /^[A-Z]{3}$/;

  // ---------- small checks ----------
  var YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  function str(v, max) { return typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029]/g, " ").slice(0, max) : ""; }
  function line(v, max) { return str(v, max * 2).replace(/[\r\n\t]+/g, " ").trim().slice(0, max); }
  function text(v, max) { return str(v, max).replace(/\r\n?/g, "\n"); }
  function ms(v) { return typeof v === "number" && isFinite(v) && v > 0 ? Math.floor(v) : 0; }
  function num(v, min, max, dec) {
    var n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v.replace(",", ".")) : NaN;
    if (!isFinite(n) || n < min || n > max) return 0;
    var k = Math.pow(10, dec || 0);
    return Math.round(n * k) / k;
  }
  function okYmd(s) {
    var m = YMD_RE.exec(typeof s === "string" ? s : "");
    if (!m) return false;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (y < 1450 || y > 2200 || mo < 1 || mo > 12 || d < 1) return false;
    var leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    return d <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  }
  function okId(v) { return typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v); }
  function byId(a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; }
  function oneOf(v, list, def) { return list.indexOf(v) >= 0 ? v : def; }
  function canon(v) {
    if (Array.isArray(v)) return v.map(canon);
    if (v && typeof v === "object") {
      var o = {};
      Object.keys(v).sort().forEach(function (k) { if (v[k] !== undefined) o[k] = canon(v[k]); });
      return o;
    }
    return v;
  }
  // A JSON-safe copy of what we do not know, or null when it is too big
  // or not plain data.
  function plain(v, depth) {
    if (v === null || typeof v === "boolean" || typeof v === "string") return v;
    if (typeof v === "number") return isFinite(v) ? v : null;
    if ((depth || 0) > 4) return null;
    if (Array.isArray(v)) return v.slice(0, 500).map(function (x) { return plain(x, (depth || 0) + 1); });
    if (v && typeof v === "object") {
      var o = {};
      Object.keys(v).slice(0, 100).forEach(function (k) {
        if (k === "__proto__" || k === "constructor" || k === "prototype") return;
        o[k] = plain(v[k], (depth || 0) + 1);
      });
      return o;
    }
    return null;
  }

  // ---------- ISBN ----------
  function digits(s) { return typeof s === "string" ? s.replace(/[\s‐-―-]/g, "") : ""; }
  function check13(d12) {
    if (!/^\d{12}$/.test(d12)) return null;
    var sum = 0;
    for (var i = 0; i < 12; i++) sum += (+d12[i]) * (i % 2 ? 3 : 1);
    return String((10 - sum % 10) % 10);
  }
  function check10(d9) {
    if (!/^\d{9}$/.test(d9)) return null;
    var sum = 0;
    for (var i = 0; i < 9; i++) sum += (+d9[i]) * (10 - i);
    var c = (11 - sum % 11) % 11;
    return c === 10 ? "X" : String(c);
  }
  // Any spelling of an ISBN-13 or ISBN-10 → { ok, isbn (13 digits),
  // why }. why: "" | "len" | "check" | "prefix".
  function parseIsbn(s) {
    var d = digits(typeof s === "string" ? s.replace(/^\s*isbn(-1[03])?:?\s*/i, "") : "").toUpperCase();
    if (/^\d{9}[\dX]$/.test(d)) {
      if (check10(d.slice(0, 9)) !== d[9]) return { ok: false, isbn: "", why: "check" };
      var d12 = "978" + d.slice(0, 9);
      return { ok: true, isbn: d12 + check13(d12), why: "" };
    }
    if (!/^\d{13}$/.test(d)) return { ok: false, isbn: "", why: "len" };
    if (!/^97[89]/.test(d)) return { ok: false, isbn: "", why: "prefix" };
    if (check13(d.slice(0, 12)) !== d[12]) return { ok: false, isbn: "", why: "check" };
    return { ok: true, isbn: d, why: "" };
  }
  // ISBN-10 of a 978 number ("" for 979).
  function isbn10(isbn) {
    if (!/^978\d{10}$/.test(isbn || "")) return "";
    var d9 = isbn.slice(3, 12);
    return d9 + check10(d9);
  }
  // A block prefix "978-618-5321": 3 groups, digits only, 978/979, and
  // 9-11 digits in all (so the block holds 10, 100 or 1000 numbers).
  function parseBlock(p) {
    var s = line(p, 40).replace(/[\s‐-―]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    var parts = s.split("-");
    var d = parts.join("");
    if (!/^\d+$/.test(d) || !/^97[89]/.test(d) || d.length < 9 || d.length > 11) return null;
    if (parts.length < 2 || parts.some(function (x) { return !x; })) return null;
    return { p: s, d: d, n: 12 - d.length, size: Math.pow(10, 12 - d.length) };
  }
  function pad(n, w) { var s = String(n); while (s.length < w) s = "0" + s; return s; }
  // The i-th number of a block (0-based), or "" when outside.
  function blockIsbn(b, i) {
    var pb = parseBlock(b && b.p);
    if (!pb || !(i >= 0 && i < pb.size) || Math.floor(i) !== i) return "";
    var d12 = pb.d + pad(i, pb.n);
    return d12 + check13(d12);
  }
  function inBlock(b, isbn) {
    var pb = parseBlock(b && b.p);
    return !!pb && typeof isbn === "string" && isbn.length === 13 && isbn.indexOf(pb.d) === 0;
  }
  // Hyphenated for people inside a known block (its own groups); other
  // numbers stay plain digits (the groups need the agency's tables).
  function hyphen(isbn, blocks) {
    if (!/^\d{13}$/.test(isbn || "")) return isbn || "";
    var list = blocks || [];
    for (var i = 0; i < list.length; i++) {
      var pb = parseBlock(list[i] && list[i].p);
      if (pb && isbn.indexOf(pb.d) === 0) return pb.p + "-" + isbn.slice(pb.d.length, 12) + "-" + isbn[12];
    }
    return isbn;
  }

  // ---------- EAN-13 bars ----------
  var EAN_L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
  var EAN_G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"];
  var EAN_P = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];
  function ean13(code) {
    if (!/^\d{13}$/.test(code || "") || check13(code.slice(0, 12)) !== code[12]) return null;
    var par = EAN_P[+code[0]], out = "101";
    for (var i = 1; i <= 6; i++) out += (par[i - 1] === "L" ? EAN_L : EAN_G)[+code[i]];
    out += "01010";
    for (var j = 7; j <= 12; j++) out += EAN_L[+code[j]].replace(/[01]/g, function (c) { return c === "0" ? "1" : "0"; });
    return out + "101";
  }
  // A book barcode as SVG: "ISBN 978-…" above, the bars (guards longer),
  // the digits below. 1 unit = 1 module (0.33 mm at 100 %: the SVG
  // carries width/height in mm). Only digits and hyphens reach the
  // markup, so nothing a person typed can inject anything.
  function barcodeSvg(isbn, blocks, opts) {
    var bars = ean13(isbn);
    if (!bars) return "";
    var o = opts || {}, mod = 0.33 * (o.scale || 1);
    var q = 11, top = o.noTitle ? 2 : 12, bh = 60, gh = 66, w = 95 + q + 7, h = top + gh + 10;
    var guard = { 0: 1, 1: 1, 2: 1, 45: 1, 46: 1, 47: 1, 48: 1, 49: 1, 92: 1, 93: 1, 94: 1 };
    var rects = [];
    for (var i = 0; i < bars.length; i++) {
      if (bars[i] !== "1") continue;
      var j = i;
      while (j < bars.length && bars[j] === "1" && !!guard[j] === !!guard[i]) j++;
      rects.push('<rect x="' + (i + q) + '" y="' + top + '" width="' + (j - i) + '" height="' + (guard[i] ? gh : bh) + '"/>');
      i = j - 1;
    }
    var f = 'font-family="OCR-B, Consolas, monospace" font-size="9" text-anchor="middle"';
    var y = top + bh + 8.5;
    var txt = '<text x="' + (q - 5) + '" y="' + y + '" ' + f + '>' + isbn[0] + '</text>' +
      '<text x="' + (q + 3 + 21) + '" y="' + y + '" ' + f + ' textLength="40">' + isbn.slice(1, 7) + '</text>' +
      '<text x="' + (q + 50 + 21) + '" y="' + y + '" ' + f + ' textLength="40">' + isbn.slice(7) + '</text>';
    var title = o.noTitle ? "" : '<text x="' + (q + 47.5) + '" y="9" ' + f.replace('font-size="9"', 'font-size="8"') +
      ' textLength="95" lengthAdjust="spacingAndGlyphs">ISBN ' + hyphen(isbn, blocks).replace(/[^\d-]/g, "") + '</text>';
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + (w * mod).toFixed(2) + 'mm" height="' + (h * mod).toFixed(2) +
      'mm" viewBox="0 0 ' + w + " " + h + '"><rect width="' + w + '" height="' + h + '" fill="#fff"/><g fill="#000">' +
      rects.join("") + title + txt + "</g></svg>";
  }

  // ---------- rows ----------
  function cleanPerson(raw) {
    if (!raw || typeof raw !== "object") return null;
    var n = line(raw.n, 120);
    if (!n) return null;
    var p = { r: oneOf(raw.r, ROLES, "a"), n: n };
    if (okId(raw.crm)) p.crm = raw.crm;
    return p;
  }
  function cleanFmt(raw) {
    if (!raw || typeof raw !== "object" || !okId(raw.id)) return null;
    var pi = parseIsbn(typeof raw.isbn === "string" ? raw.isbn : "");
    return {
      id: raw.id, k: oneOf(raw.k, FMT_KINDS, "pb"), isbn: pi.ok ? pi.isbn : "",
      price: num(raw.price, 0, 1e6, 2), pages: num(raw.pages, 0, 100000, 0),
      w: num(raw.w, 0, 2000, 1), h: num(raw.h, 0, 2000, 1), sp: num(raw.sp, 0, 500, 1),
      wt: num(raw.wt, 0, 100000, 0), bind: line(raw.bind, 60), paper: line(raw.paper, 80),
      dur: num(raw.dur, 0, 100000, 0), note: line(raw.note, 200)
    };
  }
  var TITLE_KEYS = ["id", "m", "t", "sub", "ser", "sn", "st", "rel", "lang", "ppl", "fmts", "blurb", "bio", "kw", "notes", "cov"];
  function cleanTitle(raw) {
    if (!raw || typeof raw !== "object" || !okId(raw.id)) return null;
    var t = line(raw.t, 200);
    if (!t) return null;
    var fids = {};
    var out = {
      id: raw.id, m: ms(raw.m), t: t, sub: line(raw.sub, 200), ser: line(raw.ser, 120), sn: line(raw.sn, 12),
      st: oneOf(raw.st, STATUS, "idea"), rel: okYmd(raw.rel) ? raw.rel : "", lang: line(raw.lang, 40),
      ppl: (Array.isArray(raw.ppl) ? raw.ppl : []).map(cleanPerson).filter(Boolean).slice(0, MAX_PPL),
      fmts: (Array.isArray(raw.fmts) ? raw.fmts : []).map(cleanFmt).filter(function (f) {
        if (!f || fids[f.id]) return false;
        fids[f.id] = 1;
        return true;
      }).slice(0, MAX_FMTS),
      blurb: text(raw.blurb, 4000), bio: text(raw.bio, 3000), kw: line(raw.kw, 400), notes: text(raw.notes, 4000),
      cov: typeof raw.cov === "string" && COVER_RE.test(raw.cov) ? raw.cov : ""
    };
    // Fields of a later version ride along unchanged (bounded).
    var extra = {}, any = false;
    Object.keys(raw).forEach(function (k) {
      if (TITLE_KEYS.indexOf(k) >= 0 || !/^[a-z][A-Za-z0-9]{0,23}$/.test(k)) return;
      extra[k] = plain(raw[k]);
      any = true;
    });
    if (any && JSON.stringify(extra).length <= MAX_EXTRA) Object.keys(extra).forEach(function (k) { out[k] = extra[k]; });
    return out;
  }
  function cleanBlock(raw) {
    if (!raw || typeof raw !== "object" || !okId(raw.id)) return null;
    var pb = parseBlock(raw.p);
    if (!pb) return null;
    return { id: raw.id, m: ms(raw.m), p: pb.p, note: line(raw.note, 200) };
  }
  function cleanX(raw) {
    if (!raw || typeof raw !== "object") return null;
    var pi = parseIsbn(typeof raw.id === "string" ? raw.id : "");
    if (!pi.ok || pi.isbn !== raw.id) return null;
    return { id: raw.id, m: ms(raw.m), note: line(raw.note, 200) };
  }
  // A row of a list this version does not know: needs id + m, plain data.
  function cleanUnknown(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || !okId(raw.id)) return null;
    var p = plain(raw);
    if (!p || JSON.stringify(p).length > MAX_EXTRA) return null;
    p.m = ms(raw.m);
    return p;
  }
  var CLEAN = { titles: cleanTitle, blocks: cleanBlock, isbnx: cleanX };

  function empty() { return { ver: VER, titles: [], blocks: [], isbnx: [], set: { m: 0, cur: "EUR" }, tombs: {} }; }

  function cleanSet(raw) {
    var s = raw && typeof raw === "object" ? raw : {};
    return { m: ms(s.m), cur: typeof s.cur === "string" && CURS.test(s.cur) ? s.cur : "EUR" };
  }

  function newer(a, b) {
    if (a.m !== b.m) return a.m > b.m;
    return JSON.stringify(canon(a)) > JSON.stringify(canon(b));
  }

  function mergeLists(list) {
    var rows = {}, tombs = {}, set = null, unknown = {};
    LISTS.forEach(function (k) { rows[k] = {}; });
    list.forEach(function (d) {
      if (!d || typeof d !== "object") return;
      LISTS.forEach(function (k) {
        (Array.isArray(d[k]) ? d[k] : []).forEach(function (raw) {
          var r = CLEAN[k](raw);
          if (r && (!rows[k][r.id] || newer(r, rows[k][r.id]))) rows[k][r.id] = r;
        });
      });
      Object.keys(d).forEach(function (k) {
        if (LISTS.indexOf(k) >= 0 || !/^[a-z][a-z0-9]{1,15}$/.test(k) || !Array.isArray(d[k]) ||
            k === "tombs" || k === "set" || k === "ver") return;
        var bag = unknown[k] = unknown[k] || {};
        d[k].forEach(function (raw) {
          var r = cleanUnknown(raw);
          if (r && (!bag[r.id] || newer(r, bag[r.id]))) bag[r.id] = r;
        });
      });
      var s = cleanSet(d.set);
      if (!set || newer(s, set)) set = s;
      var t = d.tombs && typeof d.tombs === "object" ? d.tombs : {};
      Object.keys(t).forEach(function (id) {
        var at = ms(t[id]);
        if (at && id.length <= 64 && at > (tombs[id] || 0)) tombs[id] = at;
      });
    });
    var out = empty();
    function live(bag) {
      return Object.keys(bag).map(function (id) { return bag[id]; })
        .filter(function (r) { return !(tombs[r.id] >= r.m); })
        .sort(byId).slice(0, MAX_ROWS);
    }
    LISTS.forEach(function (k) { out[k] = live(rows[k]); });
    Object.keys(unknown).sort().forEach(function (k) { out[k] = live(unknown[k]).map(canon); });
    out.set = set || cleanSet(null);
    var tk = {};
    Object.keys(tombs).sort().forEach(function (id) { tk[id] = tombs[id]; });
    delete out.tombs;
    out.tombs = tk;
    return out;
  }

  function normalize(d) { return mergeLists([d]); }
  function merge(a, b) { return mergeLists([a, b]); }
  function serialize(d) { return JSON.stringify(normalize(d)); }

  // ---------- edits (the app passes the clock in) ----------
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function bump(old, now) { return Math.max(now, (old || 0) + 1); }

  // Put a row (title, block, ISBN note) in its list; the stamp is newer
  // than the copy it replaces.
  function put(d, list, row, now) {
    var out = normalize(d);
    if (LISTS.indexOf(list) < 0) return out;
    var old = out[list].filter(function (r) { return r.id === row.id; })[0];
    var r = CLEAN[list](Object.assign({}, row, { m: bump(old && old.m, now) }));
    if (!r) return out;
    out[list] = out[list].filter(function (x) { return x.id !== r.id; }).concat([r]);
    if (out.tombs[r.id] >= r.m) delete out.tombs[r.id];
    return normalize(out);
  }
  function remove(d, list, id, now) {
    var out = normalize(d);
    var old = (out[list] || []).filter(function (r) { return r.id === id; })[0];
    if (!old) return out;
    out.tombs[id] = bump(old.m, now);
    return normalize(out);
  }
  function setCur(d, cur, now) {
    var out = normalize(d);
    if (!CURS.test(cur || "")) return out;
    out.set = { m: bump(out.set.m, now), cur: cur };
    return out;
  }
  function find(d, list, id) { return ((d && d[list]) || []).filter(function (r) { return r.id === id; })[0] || null; }

  // ---------- ISBN register ----------
  // Every number in use: { isbn: [{ title, fmt } | { x: true }] }
  function used(d) {
    var u = Object.create(null);
    (d.titles || []).forEach(function (t) {
      (t.fmts || []).forEach(function (f) {
        if (!f.isbn) return;
        (u[f.isbn] = u[f.isbn] || []).push({ title: t.id, fmt: f.id });
      });
    });
    (d.isbnx || []).forEach(function (x) { (u[x.id] = u[x.id] || []).push({ x: true }); });
    return u;
  }
  // Numbers given to more than one format (or to a format and marked
  // used elsewhere): [{ isbn, uses }]
  function clashes(d) {
    var u = used(d);
    return Object.keys(u).sort().filter(function (k) { return u[k].length > 1; })
      .map(function (k) { return { isbn: k, uses: u[k] }; });
  }
  // The first free number of a block, skipping what is used and `skip`
  // (numbers the app already offered in this edit). "" = block full.
  function nextFree(d, blockId, skip) {
    var b = find(d, "blocks", blockId), pb = b && parseBlock(b.p);
    if (!pb) return "";
    var u = used(d), s = skip || [];
    for (var i = 0; i < pb.size; i++) {
      var n = blockIsbn(b, i);
      if (!u[n] && s.indexOf(n) < 0) return n;
    }
    return "";
  }
  // Per block: { id, p, size, used, free, rows: [{ i, isbn, uses }] }
  // rows only for numbers in use (the free ones are counted).
  function blockUsage(d, blockId) {
    var b = find(d, "blocks", blockId), pb = b && parseBlock(b.p);
    if (!pb) return null;
    var u = used(d), rows = [];
    Object.keys(u).sort().forEach(function (k) {
      if (k.indexOf(pb.d) === 0) rows.push({ i: +k.slice(pb.d.length, 12), isbn: k, uses: u[k] });
    });
    return { id: b.id, p: pb.p, size: pb.size, used: rows.length, free: pb.size - rows.length, rows: rows };
  }

  // ---------- titles ----------
  function fold(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ς/g, "σ");   // i18n-inline-ok: Greek final sigma folds to σ for search
  }
  function authors(t) {
    return (t.ppl || []).filter(function (p) { return p.r === "a"; }).map(function (p) { return p.n; });
  }
  function haystack(t) {
    var parts = [t.t, t.sub, t.ser, t.kw, t.notes, t.blurb];
    (t.ppl || []).forEach(function (p) { parts.push(p.n); });
    (t.fmts || []).forEach(function (f) { parts.push(f.isbn, isbn10(f.isbn)); });
    return fold(parts.join(" "));
  }
  // filter: { q, st } ; sort: "rel" (newest release first, no date last),
  // "t" (A-Z), "m" (last edited)
  function list(d, filter, sort, locale) {
    var f = filter || {}, words = fold(f.q || "").split(/\s+/).filter(Boolean);
    var digitsQ = digits(f.q || "");
    var rows = (d.titles || []).filter(function (t) {
      if (f.st && t.st !== f.st) return false;
      if (!words.length) return true;
      var h = haystack(t);
      if (/^\d{9,13}X?$/i.test(digitsQ) && h.indexOf(digitsQ.toLowerCase()) >= 0) return true;
      return words.every(function (w) { return h.indexOf(w) >= 0; });
    });
    var coll = typeof Intl !== "undefined" && Intl.Collator ? new Intl.Collator(locale || "en", { sensitivity: "base", numeric: true }) : null;
    function cmpT(a, b) { return coll ? coll.compare(a.t, b.t) : (a.t < b.t ? -1 : a.t > b.t ? 1 : 0); }
    rows.sort(function (a, b) {
      if (sort === "t") return cmpT(a, b) || byId(a, b);
      if (sort === "m") return b.m - a.m || byId(a, b);
      if (a.rel !== b.rel) return !a.rel ? 1 : !b.rel ? -1 : a.rel < b.rel ? 1 : -1;
      return cmpT(a, b) || byId(a, b);
    });
    return rows;
  }
  // What is missing before a title can go out: ["isbn", "price", …]
  function gaps(t) {
    var g = [];
    if (!authors(t).length) g.push("author");
    if (!t.fmts.length) g.push("fmt");
    t.fmts.forEach(function (f) {
      if (!f.isbn && g.indexOf("isbn") < 0) g.push("isbn");
      if (!f.price && g.indexOf("price") < 0) g.push("price");
      if ((f.k === "pb" || f.k === "hb") && !f.pages && g.indexOf("pages") < 0) g.push("pages");
    });
    if (!t.blurb.trim()) g.push("blurb");
    if (!t.rel) g.push("rel");
    if (!t.cov) g.push("cov");
    return g;
  }
  function coverPath(name) { return typeof name === "string" && COVER_RE.test(name) ? COVER_DIR + "/" + name : null; }
  function coversInUse(d) { return (d.titles || []).map(function (t) { return t.cov; }).filter(Boolean); }

  // A new title from another app's prefill ({ new: {…} } deep link):
  // only known, cleaned fields; never an id or stamp from outside.
  function fromPrefill(p, id, now, fmtId) {
    var src = p && typeof p === "object" ? p : {};
    var raw = {
      id: id, m: now, t: src.t || src.title, sub: src.sub, ser: src.ser, st: src.st, rel: src.rel,
      lang: src.lang, blurb: src.blurb, bio: src.bio, kw: src.kw, notes: src.notes,
      ppl: Array.isArray(src.ppl) ? src.ppl : (typeof src.author === "string" ? [{ r: "a", n: src.author }] : []),
      fmts: src.isbn || src.price || src.pages ? [{ id: fmtId, k: src.k || "pb", isbn: src.isbn, price: src.price, pages: src.pages }] : []
    };
    var t = cleanTitle(raw);
    if (!t) return null;
    Object.keys(t).forEach(function (k) { if (TITLE_KEYS.indexOf(k) < 0) delete t[k]; });
    return t;
  }

  var API = {
    VER: VER, LISTS: LISTS, STATUS: STATUS, FMT_KINDS: FMT_KINDS, ROLES: ROLES, MAX_PPL: MAX_PPL, MAX_FMTS: MAX_FMTS,
    COVER_DIR: COVER_DIR, COVER_RE: COVER_RE,
    empty: empty, normalize: normalize, merge: merge, serialize: serialize, canon: canon,
    uid: uid, put: put, remove: remove, setCur: setCur, find: find,
    check13: check13, check10: check10, parseIsbn: parseIsbn, isbn10: isbn10, parseBlock: parseBlock,
    blockIsbn: blockIsbn, inBlock: inBlock, hyphen: hyphen, ean13: ean13, barcodeSvg: barcodeSvg,
    used: used, clashes: clashes, nextFree: nextFree, blockUsage: blockUsage,
    fold: fold, authors: authors, list: list, gaps: gaps, okYmd: okYmd, num: num,
    coverPath: coverPath, coversInUse: coversInUse, fromPrefill: fromPrefill
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.OrosPublishCore = API;
})(typeof window !== "undefined" ? window : globalThis);
