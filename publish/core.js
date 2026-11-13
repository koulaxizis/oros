// ============================================================
// orOS Publishing — data model, ISBN, ISRC, UPC and barcode math (pure, no DOM)
// Loaded by index.html before app.js, by search.js callers and by
// Node in the tests. For any small publisher: nothing here names a
// real house.
// Data in localStorage "oros-publish-data" (slice "publish"):
//   { ver: 1,
//     titles: [{ id, m, t, sub, ser, sn, st, rel "YYYY-MM-DD"|"", lang,
//                ppl: [{ r, n, crm? }], fmts: [{ id, k, isbn, price,
//                pages, w, h, sp, wt, bind, paper, dur, note }],
//                blurb, bio, kw, notes, cov, plan?, roy? }],
//                roy (wave P6): royalty terms [{ id, n, pct, base
//                "list"|"net", k "" | format kind, adv }]
//                rc (wave P8): review copies [{ id, n, out, email, d,
//                st "sent"|"rev"|"no", url, q, rd, fu }]
//                eps (LY-EPUB): EPUB ready per e-book format [{ f, d,
//                p, n }] (Layout's EPUB export, recorded here)
//     blocks: [{ id, m, p, note }],      ISBN blocks: p = the prefix as
//                the agency gave it, with hyphens ("978-618-5321")
//     isbnx:  [{ id, m, note }],         numbers used outside the app or
//                spoiled; id = the 13 digits
//     stmts:  [{ id, m, n, from, to, cur, rows, rec, due, paid, v }]
//                royalty statements as issued (wave P6, royalty.js)
//     subs:   [{ id, m, n, email, t, d, st, note, ans, ti }]
//                manuscripts sent to the publisher (wave P7): st new |
//                read | short | yes | no; ans = day last answered; ti =
//                the title made from it
//     set:    { m, cur, imp, tpl?, subDays?, mast?, own? }, imp = the publisher's
//                name (covers, press texts); tpl (wave P7) = the
//                person's own texts { ack, no, yes, con } ("" = the
//                built-in one), subDays = days before an unanswered
//                submission is flagged (90); own (wave P15) = other
//                names the publisher goes by, comma separated; unknown
//                fields ride along
//     trk:    [{ id, m, ti, no, disc, t, ver, art, isrc, dur, lang, ex?,
//                cr?: [{ r, n, ins?, crm? }], sw?: [{ n, pct, soc?, ipi?, crm? }],
//                sm?: [{ n, pct, crm? }] }]   (credits, songwriting and
//                master shares: wave M2)
//                tracks of a music release (wave M1): ti = the title,
//                isrc = 12 characters without hyphens, dur in seconds
//     med:    [{ id, m, ti, k dig|cd|vin|cas|ot, upc, cat, price, dist, note }]
//                editions of a music release (wave M1), upc = the
//                UPC-A (12) or EAN-13 (13) as written
//     isrcb:  [{ id, m, p "GR-A1B", note }]  ISRC prefixes (country +
//                registrant) as the agency gave them
//     upcb:   [{ id, m, p, f upc|ean, note }]  GS1 company prefixes
//     codex:  [{ id, m, note }]  ISRCs / UPCs used outside the app
//     tombs:  { id: ms } }
//   A title with mt { k single|ep|album|comp, gen?, lbl?, pl?, cl? } is
//   a music release (wave M1). Its tracks and editions live in trk / med,
//   never inside the title, so an older device (which keeps a title's
//   unknown fields only up to 8000 bytes and rewrites unknown format
//   kinds) still keeps them as rows of lists it does not know.
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
  var LISTS = ["titles", "blocks", "isbnx", "stmts", "subs", "posts", "trk", "med", "isrcb", "upcb", "codex"];
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
    // o.label (wave M1): "UPC" / "EAN" over a release code instead of the ISBN
    var head = o.label === "UPC" || o.label === "EAN" ? o.label + " " + (o.code || isbn).replace(/\D/g, "") : "ISBN " + hyphen(isbn, blocks).replace(/[^\d-]/g, "");
    var title = o.noTitle ? "" : '<text x="' + (q + 47.5) + '" y="9" ' + f.replace('font-size="9"', 'font-size="8"') +
      ' textLength="95" lengthAdjust="spacingAndGlyphs">' + head + '</text>';
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
    var out = {
      id: raw.id, k: oneOf(raw.k, FMT_KINDS, "pb"), isbn: pi.ok ? pi.isbn : "",
      price: num(raw.price, 0, 1e6, 2), pages: num(raw.pages, 0, 100000, 0),
      w: num(raw.w, 0, 2000, 1), h: num(raw.h, 0, 2000, 1), sp: num(raw.sp, 0, 500, 1),
      wt: num(raw.wt, 0, 100000, 0), bind: line(raw.bind, 60), paper: line(raw.paper, 80),
      dur: num(raw.dur, 0, 100000, 0), note: line(raw.note, 200)
    };
    // the shop product made from it (wave P2): Connected services account + product id
    var wid = raw.wp && typeof raw.wp === "object" ? num(raw.wp.id, 0, 1e12, 0) : 0;
    if (wid > 0 && okId(raw.wp.a)) out.wp = { a: raw.wp.a, id: wid };
    return out;
  }
  var TITLE_KEYS = ["id", "m", "t", "sub", "ser", "sn", "st", "rel", "lang", "ppl", "fmts", "blurb", "bio", "kw", "notes", "cov", "plan", "roy", "rc", "eps", "mt"];
  // Release plan (wave P4): the steps from manuscript to presentation,
  // each with a date counted back from the release date (days).
  var STAGES = ["ms", "ed", "p1", "cov", "p2", "isbn", "p3", "print", "pres",
                "mst", "art", "meta", "up", "pitch", "pre", "wk1", "x"];
  var STAGE_DAYS = { ms: -120, ed: -90, p1: -60, cov: -50, p2: -45, isbn: -40, p3: -30, print: -21, pres: 14,
                     mst: -42, art: -35, meta: -30, up: -28, pitch: -21, pre: -14, wk1: 7 };
  // A music release's plan (wave M3): master, artwork 3000 px, metadata
  // and codes, upload to the distributor (most stores want 3-4 weeks),
  // editorial pitch (Spotify for Artists needs 7 days or more), pre-save
  // and posts, first-week posts. A music step always carries its name
  // (n): a device before M3 reads an unknown kind as an own step, which
  // it keeps only with a name.
  var BOOK_STAGES = ["ms", "ed", "p1", "cov", "p2", "isbn", "p3", "print", "pres"];
  var MUSIC_STAGES = ["mst", "art", "meta", "up", "pitch", "pre", "wk1"];
  // The names a music step gets when the caller gives none (English).
  var MUSIC_STAGE_EN = { mst: "Master ready", art: "Artwork 3000 × 3000 px", meta: "Metadata and codes", up: "Upload to the distributor",
                         pitch: "Editorial pitch", pre: "Pre-save link and posts", wk1: "First-week posts" };
  var MAX_PLAN = 20;
  function cleanStep(raw) {
    if (!raw || typeof raw !== "object" || !okId(raw.id)) return null;
    var k = oneOf(raw.k, STAGES, "x");
    var o = { id: raw.id, k: k, d: okYmd(raw.d) ? raw.d : "", done: raw.done === 1 ? 1 : 0 };
    var n = line(raw.n, 80);
    if (n) o.n = n;
    if (k === "x" && !n) return null;          // an own step needs its name
    return o;
  }
  // Royalty terms (wave P6): who is paid, pct of the list price or of
  // what came in (net), on one format kind or all ("" ), and the
  // advance paid on signing (currency units), recouped first.
  var ROY_BASES = ["list", "net"], MAX_ROY = 8;
  function cleanRoy(raw) {
    if (!raw || typeof raw !== "object" || !okId(raw.id)) return null;
    var n = line(raw.n, 120);
    if (!n) return null;
    return {
      id: raw.id, n: n, pct: num(raw.pct, 0, 100, 2), base: oneOf(raw.base, ROY_BASES, "list"),
      k: FMT_KINDS.indexOf(raw.k) >= 0 ? raw.k : "", adv: num(raw.adv, 0, 1e7, 2)
    };
  }
  // A royalty statement as issued: a record, so later edits of terms or
  // sales never change what was sent. rows: one per title format,
  // rec: one per term (advance before, earned, payable), sums in cents.
  var MAX_STMT_ROWS = 300;
  function cents(v) { return typeof v === "number" && isFinite(v) && Math.abs(v) <= 1e12 ? Math.round(v) : 0; }
  function cleanStmt(raw) {
    if (!raw || typeof raw !== "object" || !okId(raw.id)) return null;
    var n = line(raw.n, 120);
    if (!n || !okYmd(raw.from) || !okYmd(raw.to) || raw.from > raw.to) return null;
    var rows = (Array.isArray(raw.rows) ? raw.rows : []).slice(0, MAX_STMT_ROWS).map(function (r) {
      if (!r || typeof r !== "object" || !okId(r.ti) || !okId(r.tr)) return null;
      var o = { ti: r.ti, tr: r.tr, t: line(r.t, 200), k: FMT_KINDS.indexOf(r.k) >= 0 ? r.k : "",
                isbn: /^\d{13}$/.test(r.isbn || "") ? r.isbn : "", q: num(r.q, -1e7, 1e7, 3),
                base: oneOf(r.base, ROY_BASES, "list"), u: num(r.u, 0, 1e9, 2), b: cents(r.b),
                pct: num(r.pct, 0, 100, 2), e: cents(r.e) };
      return o.t ? o : null;
    }).filter(Boolean);
    var rec = (Array.isArray(raw.rec) ? raw.rec : []).slice(0, MAX_STMT_ROWS).map(function (r) {
      if (!r || typeof r !== "object" || !okId(r.ti) || !okId(r.tr)) return null;
      return { ti: r.ti, tr: r.tr, adv: cents(r.adv), left: cents(r.left), e: cents(r.e), pay: cents(r.pay) };
    }).filter(Boolean);
    var o = { id: raw.id, m: ms(raw.m), n: n, from: raw.from, to: raw.to,
              cur: typeof raw.cur === "string" && CURS.test(raw.cur) ? raw.cur : "EUR",
              rows: rows, rec: rec, due: cents(raw.due), paid: okYmd(raw.paid) ? raw.paid : "", note: text(raw.note, 1000) };
    if (raw.v === 1) o.v = 1;
    return o;
  }
  // A review copy (wave P8): who got the book (n, their outlet, e-mail),
  // the day it went out (d), and what came of it: st sent | rev (a
  // review came: its https link, a quote, its day rd) | no (none will
  // come). fu = the day of the last follow-up.
  var RC_ST = ["sent", "rev", "no"], MAX_RC = 150, RC_DAYS = 21;
  function cleanRc(raw) {
    if (!raw || typeof raw !== "object" || !okId(raw.id)) return null;
    var n = line(raw.n, 120), o = line(raw.out, 120);
    if (!n && !o) return null;
    var email = line(raw.email, 200), url = line(raw.url, 500);
    return {
      id: raw.id, n: n, out: o, email: /^[^\s@<>]+@[^\s@<>]+$/.test(email) ? email : "", d: okYmd(raw.d) ? raw.d : "",
      st: oneOf(raw.st, RC_ST, "sent"), url: /^https:\/\/[^\s<>"]+$/.test(url) ? url : "", q: text(raw.q, 600).trim(),
      rd: okYmd(raw.rd) ? raw.rd : "", fu: okYmd(raw.fu) ? raw.fu : ""
    };
  }
  // EPUB ready (Layout's EPUB export, LY-EPUB): per e-book format the
  // last EPUB made, its day (d), the copy on the orOS disk (p, under
  // /internal/Layout/EPUB/) and its size in bytes (n). One per format.
  var EPS_RE = /^\/internal\/Layout\/EPUB\/[^/]{1,200}\.epub$/;
  function cleanEps(list, fids) {
    var seen = {}, out = [];
    (Array.isArray(list) ? list : []).forEach(function (raw) {
      if (!raw || typeof raw !== "object" || !okId(raw.f) || seen[raw.f] || (fids && !fids[raw.f]) || !okYmd(raw.d)) return;
      seen[raw.f] = 1;
      var o = { f: raw.f, d: raw.d, n: num(raw.n, 0, 2e9, 0) };
      var p = typeof raw.p === "string" && EPS_RE.test(raw.p) ? raw.p : "";
      if (p) o.p = p;
      out.push(o);
    });
    return out.slice(0, MAX_FMTS).sort(function (a, b) { return a.f < b.f ? -1 : a.f > b.f ? 1 : 0; });
  }
  // Copies to follow up: sent, no review yet, and `days` (21) since
  // they went out or since the last follow-up. → [{ title, rc }]
  function rcDue(d, today, days) {
    var n = typeof days === "number" && days > 0 ? days : RC_DAYS, lim = addDays(today, -n), out = [];
    ((d && d.titles) || []).forEach(function (t) {
      (t.rc || []).forEach(function (x) {
        if (x.st !== "sent" || !x.d) return;
        var since = x.fu && x.fu > x.d ? x.fu : x.d;
        if (since <= lim) out.push({ title: t, rc: x });
      });
    });
    return out.sort(function (a, b) { return a.rc.d < b.rc.d ? -1 : a.rc.d > b.rc.d ? 1 : byId(a.rc, b.rc); });
  }
  // The quotes of a title's reviews, newest first: [{ q, who, url }]
  function quotes(t) {
    return (t.rc || []).filter(function (x) { return x.st === "rev" && x.q; })
      .sort(function (a, b) { return (a.rd || "") < (b.rd || "") ? 1 : (a.rd || "") > (b.rd || "") ? -1 : byId(a, b); })
      .map(function (x) { return { q: x.q, who: x.out || x.n, url: x.url }; });
  }
  // Everyone a copy went to, across titles (for the name list): newest
  // details per name
  function pressList(d) {
    var by = {};
    ((d && d.titles) || []).forEach(function (t) {
      (t.rc || []).forEach(function (x) {
        var k = fold(x.n || x.out);
        if (!k) return;
        if (!by[k] || (x.d || "") > (by[k].d || "")) by[k] = { n: x.n, out: x.out, email: x.email, d: x.d };
      });
    });
    return Object.keys(by).sort().map(function (k) { return by[k]; });
  }
  // A manuscript sent in (wave P7). Only what the person typed or Mail
  // passed on; the e-mail itself stays in Mail.
  var SUB_ST = ["new", "read", "short", "yes", "no"];
  function cleanSub(raw) {
    if (!raw || typeof raw !== "object" || !okId(raw.id)) return null;
    var n = line(raw.n, 120), email = line(raw.email, 200);
    if (!n && !email) return null;
    var o = { id: raw.id, m: ms(raw.m), n: n, email: /^[^\s@<>]+@[^\s@<>]+$/.test(email) ? email : "",
              t: line(raw.t, 200), d: okYmd(raw.d) ? raw.d : "", st: oneOf(raw.st, SUB_ST, "new"),
              note: text(raw.note, 4000), ans: okYmd(raw.ans) ? raw.ans : "" };
    if (okId(raw.ti)) o.ti = raw.ti;
    return o;
  }
  // Waiting too long: still new or being read, never answered (or
  // answered only before it arrived) and older than `days`.
  function subsLate(d, today, days) {
    var n = typeof days === "number" && days > 0 ? days : 90;
    var lim = addDays(today, -n);
    return ((d && d.subs) || []).filter(function (x) {
      return (x.st === "new" || x.st === "read") && x.d && x.d <= lim && (!x.ans || x.ans < x.d);
    }).sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : byId(a, b); });
  }
  // A planned social post (wave P12): written once, on its day (and
  // hour) Publishing shows it as due; it is posted by the person, from
  // the network's own page (intent links: no keys, works for anyone).
  // img = a picture on the orOS disk (a title's cover or a file from
  // Files), never the bytes.
  var POST_NETS = ["mastodon", "bluesky", "x", "threads", "facebook", "linkedin", "instagram"];
  var POST_MAX = { mastodon: 500, bluesky: 300, x: 280, threads: 500, facebook: 63206, linkedin: 3000, instagram: 2200 };
  var DISK_RE = /^\/internal\/[^\u0000-\u001f]{1,300}$/;
  function cleanPost(raw) {
    if (!raw || typeof raw !== "object" || !okId(raw.id) || !okYmd(raw.d)) return null;
    var tx = text(raw.tx, 5000), img = typeof raw.img === "string" && DISK_RE.test(raw.img) && raw.img.indexOf("/../") < 0 && !/\/\.\.?$/.test(raw.img) ? raw.img : "";
    if (!tx.trim() && !img) return null;
    var nets = [];
    (Array.isArray(raw.nets) ? raw.nets : []).forEach(function (n) { if (POST_NETS.indexOf(n) >= 0 && nets.indexOf(n) < 0) nets.push(n); });
    nets.sort(function (a, b) { return POST_NETS.indexOf(a) - POST_NETS.indexOf(b); });
    var o = { id: raw.id, m: ms(raw.m), d: raw.d, at: typeof raw.at === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(raw.at) ? raw.at : "",
              tx: tx, img: img, nets: nets, done: okYmd(raw.done) ? raw.done : "" };
    if (okId(raw.ti)) o.ti = raw.ti;
    return o;
  }
  // Posts not marked posted whose day (and hour, when given) has come,
  // oldest first. now = "YYYY-MM-DD HH:MM" (local time).
  function postsDue(d, now) {
    var day = String(now || "").slice(0, 10), hm = String(now || "").slice(11, 16);
    return ((d && d.posts) || []).filter(function (p) {
      return !p.done && (p.d < day || (p.d === day && (!p.at || !hm || p.at <= hm)));
    }).sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : (a.at < b.at ? -1 : a.at > b.at ? 1 : byId(a, b)); });
  }
  // The network's own "new post" page with the text in it; "" when the
  // network has none (Facebook, Instagram: copy, then open the app) or
  // no Mastodon server is set. inst = the person's Mastodon server.
  var MAST_RE = /^(?=.{3,100}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
  function postUrl(net, tx, inst) {
    var q = encodeURIComponent(String(tx || ""));
    switch (net) {
      case "mastodon": return MAST_RE.test(inst || "") ? "https://" + inst + "/share?text=" + q : "";
      case "bluesky": return "https://bsky.app/intent/compose?text=" + q;
      case "x": return "https://x.com/intent/post?text=" + q;
      case "threads": return "https://www.threads.net/intent/post?text=" + q;
      case "linkedin": return "https://www.linkedin.com/feed/?shareActive=true&text=" + q;
      default: return "";
    }
  }
  var POST_HOME = { facebook: "https://www.facebook.com/", instagram: "https://www.instagram.com/" };
  // characters as the networks count them (code points)
  function postLen(tx) { return Array.from(String(tx || "")).length; }

  // {name} → vars.name in a template; unknown names stay as written
  // ---------- Music releases (wave M1) ----------
  // A title with `mt` is a music release (single, EP, album,
  // compilation). Its tracks and editions are rows of their own lists
  // (trk, med), never inside the title: an older device keeps a title's
  // unknown fields only up to MAX_EXTRA and rewrites unknown format
  // kinds, but keeps a whole unknown list row by row (forward safe).
  var MT_KINDS = ["single", "ep", "album", "comp"];
  var MED_KINDS = ["dig", "cd", "vin", "cas", "ot"];
  var MAX_TRK_PER = 200;
  function cleanMt(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    var o = { k: oneOf(raw.k, MT_KINDS, "single") };
    var gen = line(raw.gen, 60), lbl = line(raw.lbl, 120), pl = line(raw.pl, 200), cl = line(raw.cl, 200);
    if (gen) o.gen = gen;
    if (lbl) o.lbl = lbl;
    if (pl) o.pl = pl;            // ℗ line: who owns the recording
    if (cl) o.cl = cl;            // © line: who owns the artwork / texts
    return o;
  }
  function isMusic(t) { return !!(t && t.mt && typeof t.mt === "object"); }

  // ISRC: CC-XXX-YY-NNNNN (country, registrant, year, designation),
  // kept as 12 characters without hyphens.
  var ISRC_RE = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/;
  function parseIsrc(s) {
    var v = typeof s === "string" ? s.replace(/^\s*isrc:?\s*/i, "").replace(/[\s‐-―_.-]/g, "").toUpperCase() : "";
    if (v.length !== 12) return { ok: false, isrc: "", why: "len" };
    if (!ISRC_RE.test(v)) return { ok: false, isrc: "", why: "shape" };
    return { ok: true, isrc: v, why: "" };
  }
  function fmtIsrc(c) {
    return ISRC_RE.test(c || "") ? c.slice(0, 2) + "-" + c.slice(2, 5) + "-" + c.slice(5, 7) + "-" + c.slice(7) : (c || "");
  }
  // An ISRC prefix as the agency gave it: "GR-A1B" (country + registrant).
  function parseIsrcPrefix(p) {
    var v = line(p, 20).replace(/[\s‐-―_.-]/g, "").toUpperCase();
    return /^[A-Z]{2}[A-Z0-9]{3}$/.test(v) ? { p: v.slice(0, 2) + "-" + v.slice(2), d: v } : null;
  }

  // UPC-A (12 digits) and EAN-13 (13 digits): the GS1 mod-10 check,
  // weights 3, 1, 3… from the right. ISBNs (978/979) are not release codes.
  function gtinCheck(data) {
    if (!/^\d{6,17}$/.test(data || "")) return null;
    var sum = 0;
    for (var i = 0; i < data.length; i++) sum += (+data[data.length - 1 - i]) * (i % 2 ? 1 : 3);
    return String((10 - sum % 10) % 10);
  }
  function parseUpc(s) {
    var d = digits(typeof s === "string" ? s.replace(/^\s*(upc|ean|gtin)(-1[23])?:?\s*/i, "") : "");
    if (!/^\d{12,13}$/.test(d)) return { ok: false, upc: "", why: "len" };
    if (gtinCheck(d.slice(0, -1)) !== d[d.length - 1]) return { ok: false, upc: "", why: "check" };
    if (d.length === 13 && /^97[89]/.test(d)) return { ok: false, upc: "", why: "isbn" };
    return { ok: true, upc: d, why: "" };
  }
  // One key for a code however it was written: a UPC-A is the EAN-13
  // with a leading 0.
  function upcKey(c) { return /^\d{12}$/.test(c || "") ? "0" + c : c; }
  // A GS1 company prefix: f "upc" (UPC-A, 6-11 digits) or "ean"
  // (EAN-13, 6-11 digits); the rest of the code numbers the releases.
  function parseUpcPrefix(p, f) {
    var d = digits(line(p, 30)), k = f === "upc" ? "upc" : "ean", len = k === "upc" ? 12 : 13;
    if (!/^\d{6,11}$/.test(d) || (k === "ean" && /^97[89]/.test(d))) return null;
    var n = len - 1 - d.length;
    if (n < 1) return null;
    return { p: d, f: k, d: d, n: n, size: Math.pow(10, n), len: len };
  }
  function blockUpc(b, i) {
    var pb = parseUpcPrefix(b && b.p, b && b.f);
    if (!pb || !(i >= 0 && i < pb.size) || Math.floor(i) !== i) return "";
    var data = pb.d + pad(i, pb.n);
    return data + gtinCheck(data);
  }

  var TRK_KEYS = ["id", "m", "ti", "no", "disc", "t", "ver", "art", "isrc", "dur", "lang", "ex", "cr", "sw", "sm"];
  // Wave M2: who made the track (cr), who wrote it and their share of
  // the song (sw: songwriting / publishing shares), who owns the
  // recording (sm: master shares). Each share list sums to 100 when
  // filled in; the app warns, it never rounds anyone's share away.
  var CR_ROLES = ["art", "feat", "comp", "lyr", "arr", "prod", "mix", "mast", "eng", "mus", "o"];
  var MAX_CR = 30, MAX_SH = 20;
  function cleanCredit(raw) {
    if (!raw || typeof raw !== "object") return null;
    var n = line(raw.n, 120);
    if (!n) return null;
    var o = { r: oneOf(raw.r, CR_ROLES, "o"), n: n };
    var ins = line(raw.ins, 60);
    if (ins) o.ins = ins;            // the instrument (musician) or what they did (other)
    if (okId(raw.crm)) o.crm = raw.crm;
    return o;
  }
  function cleanShare(raw, writer) {
    if (!raw || typeof raw !== "object") return null;
    var n = line(raw.n, 120);
    if (!n) return null;
    var o = { n: n, pct: num(raw.pct, 0, 100, 2) };
    if (writer) {
      var soc = line(raw.soc, 60), ipi = String(raw.ipi == null ? "" : raw.ipi).replace(/\D/g, "");
      if (soc) o.soc = soc;          // the collecting society, free text
      if (/^\d{9,11}$/.test(ipi)) o.ipi = ipi;
    }
    if (okId(raw.crm)) o.crm = raw.crm;
    return o;
  }
  function shareSum(list) { return Math.round((list || []).reduce(function (s, x) { return s + (x.pct || 0); }, 0) * 100) / 100; }
  // "" when the list is empty or sums to 100, else "under" / "over"
  function shareState(list) {
    if (!list || !list.length) return "";
    var s = shareSum(list);
    return s === 100 ? "" : s < 100 ? "under" : "over";
  }
  function rideAlong(raw, keys, out) {
    var extra = {}, any = false;
    Object.keys(raw).forEach(function (k) {
      if (keys.indexOf(k) >= 0 || !/^[a-z][A-Za-z0-9]{0,23}$/.test(k)) return;
      extra[k] = canon(plain(raw[k]));      // keys in order: same bytes on every device
      any = true;
    });
    if (any && JSON.stringify(extra).length <= MAX_EXTRA) Object.keys(extra).forEach(function (k) { out[k] = extra[k]; });
    return out;
  }
  // A track: its release (ti), place (disc, no), title and version,
  // the artist when not the release's, ISRC, length in seconds,
  // language, explicit lyrics. Later fields (credits, splits) ride along.
  function cleanTrk(raw) {
    if (!raw || typeof raw !== "object" || !okId(raw.id) || !okId(raw.ti)) return null;
    var t = line(raw.t, 200);
    if (!t) return null;
    var pi = parseIsrc(typeof raw.isrc === "string" ? raw.isrc : "");
    var o = { id: raw.id, m: ms(raw.m), ti: raw.ti, no: num(raw.no, 1, 999, 0) || 1, disc: num(raw.disc, 1, 99, 0) || 1,
              t: t, ver: line(raw.ver, 120), art: line(raw.art, 200), isrc: pi.ok ? pi.isrc : "",
              dur: num(raw.dur, 0, 36000, 0), lang: line(raw.lang, 40) };
    if (raw.ex === 1) o.ex = 1;
    var cr = (Array.isArray(raw.cr) ? raw.cr : []).map(cleanCredit).filter(Boolean).slice(0, MAX_CR);
    if (cr.length) o.cr = cr;
    var sw = (Array.isArray(raw.sw) ? raw.sw : []).map(function (x) { return cleanShare(x, true); }).filter(Boolean).slice(0, MAX_SH);
    if (sw.length) o.sw = sw;
    var sm = (Array.isArray(raw.sm) ? raw.sm : []).map(function (x) { return cleanShare(x, false); }).filter(Boolean).slice(0, MAX_SH);
    if (sm.length) o.sm = sm;
    return rideAlong(raw, TRK_KEYS, o);
  }
  var MED_KEYS = ["id", "m", "ti", "k", "upc", "cat", "price", "dist", "note"];
  // An edition of a release: digital, CD, vinyl, cassette, other, with
  // its UPC/EAN, catalogue number, price and distributor.
  function cleanMed(raw) {
    if (!raw || typeof raw !== "object" || !okId(raw.id) || !okId(raw.ti)) return null;
    var pu = parseUpc(typeof raw.upc === "string" ? raw.upc : "");
    var o = { id: raw.id, m: ms(raw.m), ti: raw.ti, k: oneOf(raw.k, MED_KINDS, "dig"), upc: pu.ok ? pu.upc : "",
              cat: line(raw.cat, 40), price: num(raw.price, 0, 1e6, 2), dist: line(raw.dist, 80), note: line(raw.note, 200) };
    return rideAlong(raw, MED_KEYS, o);
  }
  function cleanIsrcb(raw) {
    if (!raw || typeof raw !== "object" || !okId(raw.id)) return null;
    var pb = parseIsrcPrefix(raw.p);
    if (!pb) return null;
    return { id: raw.id, m: ms(raw.m), p: pb.p, note: line(raw.note, 200) };
  }
  function cleanUpcb(raw) {
    if (!raw || typeof raw !== "object" || !okId(raw.id)) return null;
    var pb = parseUpcPrefix(raw.p, raw.f);
    if (!pb) return null;
    return { id: raw.id, m: ms(raw.m), p: pb.p, f: pb.f, note: line(raw.note, 200) };
  }
  // A release code used outside the app or spoiled: id = the ISRC (12)
  // or the UPC/EAN as written (12 or 13 digits).
  function cleanCodex(raw) {
    if (!raw || typeof raw !== "object" || typeof raw.id !== "string") return null;
    var pi = parseIsrc(raw.id), pu = parseUpc(raw.id);
    var id = pi.ok ? pi.isrc : pu.ok ? pu.upc : "";
    if (!id || id !== raw.id) return null;
    return { id: id, m: ms(raw.m), note: line(raw.note, 200) };
  }

  function fillTpl(tpl, vars) {
    return String(tpl || "").replace(/\{([a-z]{1,12})\}/g, function (all, k) {
      return Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : all;
    });
  }
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
    var sids = {};
    var plan = (Array.isArray(raw.plan) ? raw.plan : []).map(cleanStep).filter(function (x) {
      if (!x || sids[x.id]) return false;
      sids[x.id] = 1;
      return true;
    }).slice(0, MAX_PLAN);
    if (plan.length) out.plan = plan;
    var rids = {};
    var roy = (Array.isArray(raw.roy) ? raw.roy : []).map(cleanRoy).filter(function (x) {
      if (!x || rids[x.id]) return false;
      rids[x.id] = 1;
      return true;
    }).slice(0, MAX_ROY);
    if (roy.length) out.roy = roy;
    var cids = {};
    var rc = (Array.isArray(raw.rc) ? raw.rc : []).map(cleanRc).filter(function (x) {
      if (!x || cids[x.id]) return false;
      cids[x.id] = 1;
      return true;
    }).slice(0, MAX_RC);
    if (rc.length) out.rc = rc;
    var eps = cleanEps(raw.eps, fids);
    if (eps.length) out.eps = eps;
    var mt = cleanMt(raw.mt);          // wave M1: a music release
    if (mt) out.mt = mt;
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
  var CLEAN = { titles: cleanTitle, blocks: cleanBlock, isbnx: cleanX, stmts: cleanStmt, subs: cleanSub, posts: cleanPost,
                trk: cleanTrk, med: cleanMed, isrcb: cleanIsrcb, upcb: cleanUpcb, codex: cleanCodex };

  function empty() { return { ver: VER, titles: [], blocks: [], isbnx: [], stmts: [], subs: [], set: { m: 0, cur: "EUR", imp: "" }, tombs: {} }; }

  function cleanSet(raw) {
    var s = raw && typeof raw === "object" ? raw : {};
    var out = { m: ms(s.m), cur: typeof s.cur === "string" && CURS.test(s.cur) ? s.cur : "EUR", imp: line(s.imp, 120) };
    // wave P7: own texts for answers and the contract, days to answer
    if (s.tpl && typeof s.tpl === "object") {
      var tp = {};
      TPL_KEYS.forEach(function (k) { var v = text(s.tpl[k], k === "con" ? 20000 : 6000); if (v.trim()) tp[k] = v; });
      if (Object.keys(tp).length) out.tpl = tp;
    }
    var sd = num(s.subDays, 0, 365, 0);
    if (sd) out.subDays = sd;
    // wave P12: the person's Mastodon server, for "post" links
    var ma = line(s.mast, 100).toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (MAST_RE.test(ma)) out.mast = ma;
    // wave P15: other names the publisher goes by (Revenue Splitter's
    // splits), comma separated; set.imp counts already
    var own = line(s.own, 300);
    if (own) out.own = own;
    // Settings of a later version ride along unchanged (bounded).
    var extra = {}, any = false;
    Object.keys(s).forEach(function (k) {
      if (SET_KEYS.indexOf(k) >= 0 || !/^[a-z][A-Za-z0-9]{0,23}$/.test(k)) return;
      extra[k] = plain(s[k]);
      any = true;
    });
    if (any && JSON.stringify(extra).length <= MAX_EXTRA) Object.keys(extra).forEach(function (k) { out[k] = extra[k]; });
    return out;
  }
  var SET_KEYS = ["m", "cur", "imp", "tpl", "subDays", "mast", "own"];
  var TPL_KEYS = ["ack", "no", "yes", "con"];

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
    if (!CURS.test(cur || "")) return normalize(d);
    return setSet(d, { cur: cur }, now);
  }
  // patch: { cur?, imp? } → one settings write (other fields kept)
  function setSet(d, patch, now) {
    var out = normalize(d);
    var s = Object.assign({}, out.set, patch || {});
    s.m = bump(out.set.m, now);
    out.set = cleanSet(s);
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

  // ---------- Music: tracks, editions, code register (wave M1) ----------
  function tracksOf(d, ti) {
    return ((d && d.trk) || []).filter(function (r) { return r.ti === ti; }).sort(function (a, b) {
      return a.disc - b.disc || a.no - b.no || byId(a, b);
    });
  }
  function editionsOf(d, ti) {
    return ((d && d.med) || []).filter(function (r) { return r.ti === ti; }).sort(function (a, b) {
      return MED_KINDS.indexOf(a.k) - MED_KINDS.indexOf(b.k) || byId(a, b);
    });
  }
  // Total length in seconds of a release's tracks.
  function runTime(d, ti) { return tracksOf(d, ti).reduce(function (s, r) { return s + (r.dur || 0); }, 0); }
  // Every release code in use, by key (ISRC as is, UPC as EAN-13):
  // { key: [{ title, trk } | { title, med } | { x: true }] }
  function usedCodes(d) {
    var u = Object.create(null);
    function add(k, v) { (u[k] = u[k] || []).push(v); }
    var live = {};
    ((d && d.titles) || []).forEach(function (t) { live[t.id] = 1; });
    ((d && d.trk) || []).forEach(function (r) { if (r.isrc && live[r.ti]) add(r.isrc, { title: r.ti, trk: r.id }); });
    ((d && d.med) || []).forEach(function (r) { if (r.upc && live[r.ti]) add(upcKey(r.upc), { title: r.ti, med: r.id }); });
    ((d && d.codex) || []).forEach(function (x) { add(ISRC_RE.test(x.id) ? x.id : upcKey(x.id), { x: true }); });
    return u;
  }
  function codeClashes(d) {
    var u = usedCodes(d);
    return Object.keys(u).sort().filter(function (k) { return u[k].length > 1; }).map(function (k) { return { code: k, uses: u[k] }; });
  }
  // The next free ISRC of a prefix for a year (YY), skipping codes in
  // use and `skip`. "" = the year's 99 999 codes are all taken.
  function nextIsrc(d, prefixId, year, skip) {
    var b = find(d, "isrcb", prefixId), pb = b && parseIsrcPrefix(b.p);
    if (!pb || !(year >= 1900 && year <= 2199)) return "";
    var u = usedCodes(d), s = skip || [], head = pb.d + pad(year % 100, 2);
    for (var i = 1; i <= 99999; i++) {
      var c = head + pad(i, 5);
      if (!u[c] && s.indexOf(c) < 0) return c;
    }
    return "";
  }
  function nextUpc(d, prefixId, skip) {
    var b = find(d, "upcb", prefixId), pb = b && parseUpcPrefix(b.p, b.f);
    if (!pb) return "";
    var u = usedCodes(d), s = skip || [];
    for (var i = 0; i < pb.size && i < 1e6; i++) {
      var c = blockUpc(b, i);
      if (!u[upcKey(c)] && s.indexOf(c) < 0) return c;
    }
    return "";
  }
  // Per prefix: { id, p, used, rows: [{ code, uses }] } (codes in use
  // that start with it); for UPC/EAN also size and free.
  function isrcUsage(d, prefixId) {
    var b = find(d, "isrcb", prefixId), pb = b && parseIsrcPrefix(b.p);
    if (!pb) return null;
    var u = usedCodes(d), rows = [];
    Object.keys(u).sort().forEach(function (k) { if (ISRC_RE.test(k) && k.indexOf(pb.d) === 0) rows.push({ code: k, uses: u[k] }); });
    return { id: b.id, p: pb.p, used: rows.length, rows: rows };
  }
  function upcUsage(d, prefixId) {
    var b = find(d, "upcb", prefixId), pb = b && parseUpcPrefix(b.p, b.f);
    if (!pb) return null;
    var u = usedCodes(d), rows = [], head = pb.f === "upc" ? "0" + pb.d : pb.d;
    Object.keys(u).sort().forEach(function (k) { if (/^\d{13}$/.test(k) && k.indexOf(head) === 0) rows.push({ code: k, uses: u[k] }); });
    return { id: b.id, p: pb.p, f: pb.f, size: pb.size, used: rows.length, free: pb.size - rows.length, rows: rows };
  }
  // What is missing before a release can go out.
  function musicGaps(t, d) {
    var g = [];
    if (!authors(t).length) g.push("artist");
    if (d) {
      var tr = tracksOf(d, t.id), ed = editionsOf(d, t.id);
      if (!tr.length) g.push("trk");
      if (tr.some(function (r) { return !r.isrc; })) g.push("isrc");
      if (tr.some(function (r) { return !r.dur; })) g.push("dur");
      if (!ed.length) g.push("ed");
      if (ed.some(function (r) { return !r.upc; })) g.push("upc");
      if (tr.some(function (r) { return shareState(r.sw) || shareState(r.sm); })) g.push("splits");
    }
    if (!t.rel) g.push("rel");
    if (!t.cov) g.push("cov");
    return g;
  }
  // A title and its tracks and editions go together (one write).
  function removeRelease(d, ti, now) {
    var out = normalize(d);
    function stamp(r) { out.tombs[r.id] = bump(r.m, now); }
    var t = find(out, "titles", ti);
    if (!t) return out;
    stamp(t);
    tracksOf(out, ti).forEach(stamp);
    editionsOf(out, ti).forEach(stamp);
    return normalize(out);
  }
  // Put tracks in the given order (ids): numbers 1, 2, 3… per disc as
  // listed; only rows whose number changes are written.
  function orderTracks(d, ti, ids, now) {
    var out = normalize(d), per = {};
    ids.forEach(function (id) {
      var r = find(out, "trk", id);
      if (!r || r.ti !== ti) return;
      per[r.disc] = (per[r.disc] || 0) + 1;
      if (r.no !== per[r.disc]) out = put(out, "trk", Object.assign({}, r, { no: per[r.disc] }), now);
    });
    return out;
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
  // filter.kind: "" | "book" | "mus" (wave M1); music titles are also
  // found by their tracks' names, ISRCs and their editions' UPC/EAN.
  function list(d, filter, sort, locale) {
    var f = filter || {}, words = fold(f.q || "").split(/\s+/).filter(Boolean);
    var digitsQ = digits(f.q || "");
    var more = {};
    if (words.length) {
      (d.trk || []).forEach(function (r) { more[r.ti] = (more[r.ti] || "") + " " + fold(r.t + " " + r.ver + " " + r.art) + " " + r.isrc.toLowerCase() + " " + fmtIsrc(r.isrc).toLowerCase(); });
      (d.med || []).forEach(function (r) { more[r.ti] = (more[r.ti] || "") + " " + r.upc + " " + fold(r.cat); });
    }
    var rows = (d.titles || []).filter(function (t) {
      if (f.st && t.st !== f.st) return false;
      if (f.kind === "mus" && !isMusic(t)) return false;
      if (f.kind === "book" && isMusic(t)) return false;
      if (!words.length) return true;
      var h = haystack(t) + (more[t.id] || "");
      var isr = (f.q || "").replace(/[\s-]/g, "").toLowerCase();
      if (/^[a-z]{2}[a-z0-9]{3}\d{7}$/.test(isr) && h.indexOf(isr) >= 0) return true;
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
  function gaps(t, d) {
    if (isMusic(t)) return musicGaps(t, d);
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

  // ---------- Release plan (wave P4) ----------
  function addDays(ymd, n) {
    var p = ymd.split("-"), d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n));
    return d.toISOString().slice(0, 10);
  }
  // The standard steps dated back from the release date. Steps already
  // in the plan keep their id, their done mark and their own name; a
  // done step keeps its date; own steps ("x") stay as they are.
  // o: { music: true, name: k → the step's name } for a music release.
  function makePlan(rel, plan, newId, o) {
    if (!okYmd(rel)) return (plan || []).slice();
    o = o || {};
    var kinds = o.music ? MUSIC_STAGES : BOOK_STAGES, have = {};
    (plan || []).forEach(function (s) { if (s.k !== "x" && !have[s.k]) have[s.k] = s; });
    var out = kinds.map(function (k) {
      var old = have[k];
      var d = old && old.done && old.d ? old.d : addDays(rel, STAGE_DAYS[k]);
      var s = { id: old ? old.id : newId(), k: k, d: d, done: old ? old.done : 0 };
      var n = old && old.n ? old.n : o.music ? line((o.name && o.name(k)) || MUSIC_STAGE_EN[k], 80) : "";
      if (n) s.n = n;
      return s;
    });
    // own steps, and steps of the other template, stay as they are
    (plan || []).forEach(function (s) { if (s.k === "x" || kinds.indexOf(s.k) < 0) out.push(s); });
    return sortPlan(out).slice(0, MAX_PLAN);
  }
  function sortPlan(plan) {
    return plan.slice().sort(function (a, b) {
      if (!a.d !== !b.d) return a.d ? -1 : 1;
      return a.d < b.d ? -1 : a.d > b.d ? 1 : STAGES.indexOf(a.k) - STAGES.indexOf(b.k);
    });
  }
  // Where a title stands on a day: steps not done whose date has passed
  // (late), and the next open step.
  function planState(t, today) {
    var open = sortPlan((t.plan || []).filter(function (s) { return !s.done && s.d; }));
    return {
      late: open.filter(function (s) { return s.d < today; }),
      next: open.filter(function (s) { return s.d >= today; })[0] || null,
      done: (t.plan || []).filter(function (s) { return s.done; }).length,
      total: (t.plan || []).length
    };
  }
  // Calendar rows (publish/feed.js): release dates of titles not yet
  // out of print, and every open step with a date.
  function byDay(d) {
    var out = {};
    function add(day, row) { (out[day] = out[day] || []).push(row); }
    ((d && d.titles) || []).forEach(function (t) {
      if (t.st === "oop") return;
      if (t.rel) add(t.rel, { title: t.id, k: "rel", t: t.t });
      (t.plan || []).forEach(function (s) { if (!s.done && s.d) add(s.d, { title: t.id, k: s.k, n: s.n || "", t: t.t, step: s.id }); });
    });
    // wave P12: planned posts not yet posted, "Post 10:00 · first words…"
    ((d && d.posts) || []).forEach(function (p) {
      if (p.done) return;
      var first = p.tx.replace(/\s+/g, " ").trim();
      if (first.length > 50) first = first.slice(0, 49).trim() + "…";
      add(p.d, { title: p.ti || "", k: "post", n: p.at, t: first, post: p.id });
    });
    return out;
  }

  // ---------- Arguments from the Assistant and the Gate (waves M1-M2) ----------
  // create_items and change_item describe a track or an edition in
  // words (assistant/additems3.js, assistant/edits4.js). These read one
  // and return only the fields given, cleaned, or an error that says
  // what is wrong; a code is never guessed or dropped.
  var ARG_CR = { artist: "art", featured: "feat", composer: "comp", lyricist: "lyr", arranger: "arr", producer: "prod", mixing: "mix",
                 mastering: "mast", engineer: "eng", musician: "mus", other: "o" };
  var ARG_MED = { digital: "dig", cd: "cd", vinyl: "vin", cassette: "cas", other: "ot" };
  var TRK_ARGS = ["title", "version", "artist", "isrc", "length", "language", "explicit", "credits", "writers", "masters"];
  var MED_ARGS = ["edition", "upc", "catalogue_no", "price", "distributor", "note"];
  function given(x, k) { return x && Object.prototype.hasOwnProperty.call(x, k) && x[k] !== null && x[k] !== undefined && x[k] !== ""; }
  function argText(x, k, max, w, out, key) {
    if (!given(x, k)) return "";
    if (typeof x[k] !== "string" && typeof x[k] !== "number") return w + k + " must be text.";
    var v = line(String(x[k]), max * 4);
    if (v.length > max) return w + k + " has " + v.length + " characters; Publishing keeps " + max + ".";
    out[key] = v;
    return "";
  }
  function argShares(list, k, w, writer) {
    if (!Array.isArray(list)) return { err: w + k + " must be a list of { name, share" + (writer ? ", society, ipi" : "") + " }." };
    if (list.length > MAX_SH) return { err: w + k + ": a track keeps " + MAX_SH + " people here." };
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var y = list[i], yw = w + k + "[" + i + "].", o = {}, e;
      if (!y || typeof y !== "object" || Array.isArray(y)) return { err: yw + " must be an object." };
      if ((e = argText(y, "name", 120, yw, o, "n"))) return { err: e };
      if (!o.n) return { err: yw + "name is required." };
      var s = typeof y.share === "number" ? y.share : given(y, "share") && /^\s*\d+(?:[.,]\d+)?\s*%?\s*$/.test(String(y.share)) ? Number(String(y.share).replace(",", ".").replace("%", "")) : NaN;
      if (!(s >= 0 && s <= 100)) return { err: yw + "share is required: a percent from 0 to 100." };
      o.pct = Math.round(s * 100) / 100;
      if (writer) {
        if ((e = argText(y, "society", 60, yw, o, "soc"))) return { err: e };
        if (given(y, "ipi")) {
          var ipi = String(y.ipi).replace(/\D/g, "");
          if (!/^\d{9,11}$/.test(ipi)) return { err: yw + "ipi must be the 9 to 11 digit IPI number; leave it out when unsure." };
          o.ipi = ipi;
        }
      }
      out.push(o);
    }
    if (out.length && shareSum(out) !== 100) return { err: w + k + " add up to " + shareSum(out) + "%; the shares must make 100%. Ask the user rather than guess." };
    return { v: out };
  }
  function trackArgs(x, w) {
    if (typeof x === "string") x = { title: x };
    if (!x || typeof x !== "object" || Array.isArray(x)) return { err: w + " must be an object (or a title)." };
    var no = Object.keys(x).filter(function (k) { return TRK_ARGS.indexOf(k) < 0; });
    if (no.length) return { err: w + " has no " + no.join(", ") + " (a track takes " + TRK_ARGS.join(", ") + ")." };
    var o = {}, e;
    if ((e = argText(x, "title", 200, w, o, "t") || argText(x, "version", 120, w, o, "ver") || argText(x, "artist", 200, w, o, "art") ||
         argText(x, "language", 40, w, o, "lang"))) return { err: e };
    if (given(x, "isrc")) {
      var pi = parseIsrc(String(x.isrc));
      if (!pi.ok) return { err: w + "isrc " + String(x.isrc).slice(0, 30) + " is not a valid ISRC (CC-XXX-YY-NNNNN). Leave it out when unsure; never make one up." };
      o.isrc = pi.isrc;
    }
    if (given(x, "length")) {
      var v = x.length, m = typeof v === "string" ? /^\s*(?:(\d{1,2}):)?(\d{1,3}):(\d{2})\s*$/.exec(v) : null;
      if (typeof v === "number" && v >= 0 && v <= 36000 && Math.floor(v) === v) o.dur = v;
      else if (m && +m[3] < 60) o.dur = (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]);
      else return { err: w + "length must be the length as m:ss (e.g. 3:45) or whole seconds." };
    }
    if (given(x, "explicit")) {
      if (typeof x.explicit !== "boolean") return { err: w + "explicit must be true or false." };
      o.ex = x.explicit ? 1 : 0;
    }
    if (given(x, "credits") || Array.isArray(x.credits)) {
      if (!Array.isArray(x.credits)) return { err: w + "credits must be a list of { role, name, instrument }." };
      if (x.credits.length > MAX_CR) return { err: w + "credits: a track keeps " + MAX_CR + " credits." };
      o.cr = [];
      for (var i = 0; i < x.credits.length; i++) {
        var y = x.credits[i], yw = w + "credits[" + i + "].", co = {};
        if (!y || typeof y !== "object" || Array.isArray(y)) return { err: yw + " must be an object." };
        var r = given(y, "role") ? String(y.role) : "other";
        if (!Object.prototype.hasOwnProperty.call(ARG_CR, r)) return { err: yw + "role must be one of " + Object.keys(ARG_CR).join(", ") + "." };
        if ((e = argText(y, "name", 120, yw, co, "n") || argText(y, "instrument", 60, yw, co, "ins"))) return { err: e };
        if (!co.n) return { err: yw + "name is required." };
        co.r = ARG_CR[r];
        o.cr.push(co);
      }
    }
    var sh = [["writers", "sw", true], ["masters", "sm", false]];
    for (var j = 0; j < sh.length; j++) {
      if (!(given(x, sh[j][0]) || Array.isArray(x[sh[j][0]]))) continue;
      var rs = argShares(x[sh[j][0]], sh[j][0], w, sh[j][2]);
      if (rs.err) return rs;
      o[sh[j][1]] = rs.v;
    }
    return { v: o };
  }
  function editionArgs(x, w) {
    if (!x || typeof x !== "object" || Array.isArray(x)) return { err: w + " must be an object." };
    var no = Object.keys(x).filter(function (k) { return MED_ARGS.indexOf(k) < 0; });
    if (no.length) return { err: w + " has no " + no.join(", ") + " (an edition takes " + MED_ARGS.join(", ") + ")." };
    var o = {}, e;
    if (given(x, "edition")) {
      if (!Object.prototype.hasOwnProperty.call(ARG_MED, String(x.edition))) return { err: w + "edition must be digital, cd, vinyl, cassette or other." };
      o.k = ARG_MED[String(x.edition)];
    }
    if (given(x, "upc")) {
      var pu = parseUpc(String(x.upc));
      if (!pu.ok) return { err: w + "upc " + String(x.upc).slice(0, 30) + " is not a valid UPC (12 digits) or EAN (13 digits)" + (pu.why === "check" ? " (its check digit is wrong)" : pu.why === "isbn" ? " (it is an ISBN)" : "") + ". Leave it out when unsure; never make one up." };
      o.upc = pu.upc;
    }
    if ((e = argText(x, "catalogue_no", 40, w, o, "cat") || argText(x, "distributor", 80, w, o, "dist") || argText(x, "note", 200, w, o, "note"))) return { err: e };
    if (given(x, "price")) {
      var p = typeof x.price === "number" ? x.price : /^\s*\d+(?:[.,]\d+)?\s*$/.test(String(x.price)) ? Number(String(x.price).replace(",", ".")) : NaN;
      if (!(p >= 0 && p <= 1e6)) return { err: w + "price must be a number from 0." };
      o.price = Math.round(p * 100) / 100;
    }
    return { v: o };
  }
  function argName(map, v) { var k = ""; Object.keys(map).forEach(function (x) { if (map[x] === v) k = x; }); return k; }

  // ---------- Split sheet (wave M2) ----------
  // A plain-text split sheet for one track, for Writer (newDoc): the
  // release, the track and its codes, the writers' shares with society
  // and IPI, the master shares, the credits, and a line to sign for
  // each person. S: the strings in the app's language (app.js "ss.*");
  // roles: { role → its name }.
  function splitSheet(t, r, S, roles, o) {
    o = o || {};
    function f(k, vars) {
      var s = S[k] || "";
      Object.keys(vars || {}).forEach(function (v) { s = s.split("{" + v + "}").join(String(vars[v])); });
      return s;
    }
    function pct(v) { return String(v).replace(".", o.comma ? "," : ".") + "%"; }
    var parts = [f("head", { t: r.t })];
    var info = [f("release", { t: t.t + (authors(t).length ? " · " + authors(t).join(", ") : "") })];
    if (r.ver) info.push(f("version", { v: r.ver }));
    if (r.isrc) info.push("ISRC " + fmtIsrc(r.isrc));
    if (o.date) info.push(f("date", { d: o.date }));
    parts.push(info.join("\n"));
    if (r.sw && r.sw.length) {
      parts.push(S.writers + "\n" + r.sw.map(function (x) {
        return "- " + x.n + " · " + pct(x.pct) + (x.soc ? " · " + x.soc : "") + (x.ipi ? " · IPI " + x.ipi : "");
      }).join("\n") + (shareState(r.sw) ? "\n" + f("sum", { s: pct(shareSum(r.sw)) }) : ""));
    }
    if (r.sm && r.sm.length) {
      parts.push(S.masters + "\n" + r.sm.map(function (x) { return "- " + x.n + " · " + pct(x.pct); }).join("\n") +
        (shareState(r.sm) ? "\n" + f("sum", { s: pct(shareSum(r.sm)) }) : ""));
    }
    if (r.cr && r.cr.length) {
      parts.push(S.credits + "\n" + r.cr.map(function (x) { return "- " + (roles[x.r] || x.r) + (x.ins ? " (" + x.ins + ")" : "") + ": " + x.n; }).join("\n"));
    }
    parts.push(S.agree);
    var who = [];
    (r.sw || []).concat(r.sm || []).forEach(function (x) { if (who.indexOf(x.n) < 0) who.push(x.n); });
    if (who.length) parts.push(who.map(function (n) { return n + "\n" + S.sign; }).join("\n\n"));
    return { title: line(f("doc", { t: r.t }), 200), text: parts.join("\n\n") };
  }

  // ---------- To other apps (wave P2) ----------
  // Each builder is pure: the app sends what it returns through the
  // shell (WooCommerce via orosLinks, the others as deep links), and
  // nothing is saved there until the person saves it.
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function paras(s) {
    return String(s || "").split(/\n\s*\n/).map(function (p) { return p.trim(); }).filter(Boolean)
      .map(function (p) { return "<p>" + esc(p).replace(/\n/g, "<br>") + "</p>"; }).join("");
  }
  // a number as WooCommerce's decimal text: at most 3 decimals, no trailing zeros
  function wcDec(v) {
    if (!(v > 0) || v >= 1e6) return "";
    var s = (Math.round(v * 1000) / 1000).toFixed(3).replace(/\.?0+$/, "");
    return s === "0" ? "" : s;
  }
  var WEIGHT_G = { kg: 1000, g: 1, lbs: 453.59237, oz: 28.349523125 };
  var LEN_MM = { m: 1000, cm: 10, mm: 1, "in": 25.4, yd: 914.4 };
  var DRAFT_BYTES = 15000;          // the relay takes 16 KB per request
  function utf8Len(s) { return typeof TextEncoder !== "undefined" ? new TextEncoder().encode(s).length : unescape(encodeURIComponent(s)).length; }
  // A format as a WooCommerce draft product body (POST /products).
  // o: { label: format name added to the product name ("" = none),
  //      about: heading over the biography, wu / du: the shop's weight
  //      and dimension units ("" = unknown: no weight / dimensions),
  //      price: false leaves the price out (another currency) }
  function shopDraft(t, f, o) {
    o = o || {};
    var name = line(t.t + (o.label ? " (" + o.label + ")" : ""), 200);
    var b = { name: name, type: "simple", status: "draft" };
    if (f.isbn) b.sku = f.isbn;
    if (o.price !== false && f.price > 0) b.regular_price = f.price.toFixed(2);
    var by = authors(t);
    if (by.length) b.short_description = "<p>" + esc(by.join(", ")) + "</p>";
    var blurb = paras(t.blurb), bio = paras(t.bio);
    var desc = blurb + (bio ? "<h3>" + esc(o.about || "") + "</h3>" + bio : "");
    if (f.k === "eb" || f.k === "ab") b.virtual = true;
    else {
      var wu = WEIGHT_G[o.wu], du = LEN_MM[o.du];
      var w = wu && f.wt ? wcDec(f.wt / wu) : "";
      if (w) b.weight = w;
      if (du) {
        var dm = {}, any = false;
        [["length", f.h], ["width", f.w], ["height", f.sp]].forEach(function (x) {
          var v = x[1] ? wcDec(x[1] / du) : "";
          if (v) { dm[x[0]] = v; any = true; }
        });
        if (any) b.dimensions = dm;
      }
    }
    // fits the relay: the biography goes first, then the blurb is cut
    function size(d) { var c = Object.assign({}, b); if (d) c.description = d; return utf8Len(JSON.stringify(c)); }
    function fits(d) { return d.length <= 8000 && size(d) <= DRAFT_BYTES; }
    if (desc && !fits(desc)) desc = blurb;
    var keep = String(t.blurb || "").length;
    while (desc && !fits(desc)) {
      keep = Math.floor(keep * 0.8);
      desc = keep > 0 ? paras(String(t.blurb).slice(0, keep).trim() + "…") : "";
    }
    if (desc) b.description = desc;
    return b;
  }
  // A Stock item prefill ({ newItem } deep link): price in cents.
  function stockPrefill(t, f, label) {
    var p = { name: line(t.t + (label ? " (" + label + ")" : ""), 120), note: authors(t).join(", ") };
    if (f.isbn) { p.sku = f.isbn; p.bc = f.isbn; }
    if (f.price > 0) p.price = Math.round(f.price * 100);
    return p;
  }
  // Newsletter blocks (asAdd deep link): heading, text, and a button
  // to the shop page when the person has one.
  function newsBlocks(t, o) {
    o = o || {};
    var head = [t.sub, authors(t).join(", ")].filter(Boolean).join("\n");
    var out = [{ k: "h", t: line(t.t, 300) }];
    var txt = [head, t.blurb].filter(Boolean).join("\n\n");
    if (txt) out.push({ k: "p", t: txt.slice(0, 4000) });
    // reviews (wave P8): the two newest quotes
    var qs = quotes(t).slice(0, 2).map(function (x) { return "“" + x.q + "” — " + x.who; });
    if (qs.length) out.push({ k: "p", t: qs.join("\n\n").slice(0, 2000) });
    if (o.href && /^https:\/\/[^\s]+$/.test(o.href) && o.btn) out.push({ k: "btn", t: line(o.btn, 80), href: o.href });
    return out;
  }
  // A press release (Writer newDoc): plain text, paragraphs on blank
  // lines. S: the strings in the app's language (see app.js "pr.*").
  function pressRelease(t, fmts, S, o) {
    o = o || {};
    function f(k, vars) {
      var s = S[k] || "";
      Object.keys(vars || {}).forEach(function (v) { s = s.split("{" + v + "}").join(String(vars[v])); });
      return s;
    }
    var by = authors(t).join(", ");
    var parts = [S.head];
    var lead = o.imp ? (by ? f("leadImp", { imp: o.imp, t: t.t, a: by }) : f("leadImpNoA", { imp: o.imp, t: t.t }))
                     : (by ? f("lead", { t: t.t, a: by }) : f("leadNoA", { t: t.t }));
    parts.push(lead + (o.rel ? " " + f("rel", { d: o.rel }) : ""));
    if (t.sub) parts.push(t.sub);
    if (t.blurb) parts.push(t.blurb.trim());
    if (t.bio) parts.push(S.about + "\n" + t.bio.trim());
    var rows = [];
    (fmts || []).forEach(function (x) {
      var bits = [x.label];
      if (x.isbn) bits.push("ISBN " + x.isbn);
      if (x.pages) bits.push(f("pages", { n: x.pages }));
      if (x.price) bits.push(x.price);
      rows.push(bits.join(" · "));
    });
    if (rows.length) parts.push(S.details + "\n" + rows.join("\n"));
    if (o.imp) parts.push(S.contact + "\n" + o.imp);
    return { title: line(f("docTitle", { t: t.t }), 200), text: parts.filter(Boolean).join("\n\n") };
  }

  var API = {
    VER: VER, LISTS: LISTS, STATUS: STATUS, FMT_KINDS: FMT_KINDS, ROLES: ROLES, MAX_PPL: MAX_PPL, MAX_FMTS: MAX_FMTS,
    COVER_DIR: COVER_DIR, COVER_RE: COVER_RE,
    empty: empty, normalize: normalize, merge: merge, serialize: serialize, canon: canon,
    uid: uid, put: put, remove: remove, setCur: setCur, setSet: setSet, find: find,
    check13: check13, check10: check10, parseIsbn: parseIsbn, isbn10: isbn10, parseBlock: parseBlock,
    blockIsbn: blockIsbn, inBlock: inBlock, hyphen: hyphen, ean13: ean13, barcodeSvg: barcodeSvg,
    used: used, clashes: clashes, nextFree: nextFree, blockUsage: blockUsage,
    fold: fold, authors: authors, list: list, gaps: gaps, okYmd: okYmd, num: num,
    coverPath: coverPath, coversInUse: coversInUse, fromPrefill: fromPrefill,
    shopDraft: shopDraft, stockPrefill: stockPrefill, newsBlocks: newsBlocks, pressRelease: pressRelease,
    STAGES: STAGES, STAGE_DAYS: STAGE_DAYS, BOOK_STAGES: BOOK_STAGES, MUSIC_STAGES: MUSIC_STAGES, MUSIC_STAGE_EN: MUSIC_STAGE_EN, MAX_PLAN: MAX_PLAN, addDays: addDays, makePlan: makePlan, sortPlan: sortPlan,
    planState: planState, byDay: byDay,
    ROY_BASES: ROY_BASES, MAX_ROY: MAX_ROY, cleanRoy: cleanRoy, cleanStmt: cleanStmt,
    SUB_ST: SUB_ST, TPL_KEYS: TPL_KEYS, cleanSub: cleanSub, subsLate: subsLate, fillTpl: fillTpl,
    RC_ST: RC_ST, RC_DAYS: RC_DAYS, MAX_RC: MAX_RC, cleanRc: cleanRc, rcDue: rcDue, cleanEps: cleanEps, EPS_RE: EPS_RE, quotes: quotes, pressList: pressList,
    MT_KINDS: MT_KINDS, MED_KINDS: MED_KINDS, MAX_TRK_PER: MAX_TRK_PER, isMusic: isMusic, cleanMt: cleanMt,
    parseIsrc: parseIsrc, fmtIsrc: fmtIsrc, parseIsrcPrefix: parseIsrcPrefix, gtinCheck: gtinCheck, parseUpc: parseUpc,
    upcKey: upcKey, parseUpcPrefix: parseUpcPrefix, blockUpc: blockUpc, cleanTrk: cleanTrk, cleanMed: cleanMed,
    tracksOf: tracksOf, editionsOf: editionsOf, runTime: runTime, usedCodes: usedCodes, codeClashes: codeClashes,
    nextIsrc: nextIsrc, nextUpc: nextUpc, isrcUsage: isrcUsage, upcUsage: upcUsage, musicGaps: musicGaps,
    removeRelease: removeRelease, orderTracks: orderTracks,
    CR_ROLES: CR_ROLES, MAX_CR: MAX_CR, MAX_SH: MAX_SH, cleanCredit: cleanCredit, cleanShare: cleanShare,
    shareSum: shareSum, shareState: shareState, splitSheet: splitSheet,
    ARG_CR: ARG_CR, ARG_MED: ARG_MED, TRK_ARGS: TRK_ARGS, MED_ARGS: MED_ARGS, trackArgs: trackArgs, editionArgs: editionArgs, argName: argName,
    POST_NETS: POST_NETS, POST_MAX: POST_MAX, POST_HOME: POST_HOME, cleanPost: cleanPost, postsDue: postsDue, postUrl: postUrl, postLen: postLen
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.OrosPublishCore = API;
})(typeof window !== "undefined" ? window : globalThis);
