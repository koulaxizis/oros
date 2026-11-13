// ============================================================
// orOS Files — docs-core.js (v1.0.0): the document archive, pure.
// ------------------------------------------------------------
// Files' "Documents" place (files/docs.js) turns files of the disk
// into documents: a type, tags, who it is from, the document date,
// an amount, an expiry date and a "keep until" date. Only these
// details are kept here; the files stay where they are on the disk
// (Chris 2026-11-13: "stay where they are") and Vault Drive syncs them as
// before. New files added from the Documents place go to
// /internal/Documents/<year>/.
//
// DOCS v1 (synced slice "files-docs", key oros-files-docs):
//   { v: 1,
//     docs:  [{ id "d-…", m, p, h?, t, ty?, tg [], co?, d?, amt?, cur?,
//               ex?, kp?, no?, ln [], x? }],
//     types: [{ id "ty-…", m, n, kY?, kx?, pv? }],   own types and edits
//     tags:  [{ id "tg-…", m, n, c? }],
//     corr:  [{ id "co-…", m, n }],
//     tombs: { id: time } }
//   p   the file's path on the disk; h its SHA-256 (hex) when known,
//       so a file moved by another app or device is found again.
//   d / ex / kp  "YYYY-MM-DD"; kp may also be "forever".
//   ln  links to items of other apps, [{ a: app id, r: target, t }]
//       (wave W4; kept as they are until then).
//   x   a bag for fields of later waves, kept verbatim (≤ 4 KB).
// Merge (R5, R17, R26, R27): per row the bigger m wins, a tie goes to
// the larger canonical JSON; a tombstone at or after a row's m hides
// it and a newer edit brings it back; lists sorted by id, tombs by
// key; the merge result is canonical: norm(merge(a, b)) == merge(a, b).
// Built-in types are code, not data (R16): two fresh devices never
// make duplicates; editing one stores a row with the built-in id (its
// name then as typed); removing one stores its tombstone.
// Exposes window.OrosDocsCore (browser) or module.exports (tests).
// ============================================================
(function (root) {
  "use strict";

  var KEY = "oros-files-docs";
  var SLICE = "files-docs";
  var ROOT = "/internal";
  var DOCS_DIR = ROOT + "/Documents";
  var TRASH = ROOT + "/.trash";
  var MAX_DOCS = 5000;
  var WARN_DOCS = 4000;
  var MAX_TOMBS = 3000;
  var MAX_TAGS = 20;
  var MAX_LINKS = 30;
  var FOREVER = "forever";
  var DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  var ID_RE = /^(d|ty|tg|co)-[0-9a-z][0-9a-z_-]{0,40}$/;
  var HASH_RE = /^[0-9a-f]{64}$/;
  var CUR_RE = /^[A-Z]{3}$/;
  var APP_RE = /^[a-z][a-z0-9-]{0,30}$/;
  var DAY = 86400000;

  // Built-in types: kY = suggested years to keep after the document
  // date (-1 = for ever), kx = keep until the expiry date, pv = private
  // (never shown to the Assistant or Claude). The years are
  // suggestions the person changes; never legal advice.
  // Names come from the view's string table (docs.js "doc.ty.<id>",
  // so a pack language translates them); EN is the fallback here.
  var BUILTIN = [
    { id: "ty-receipt",   en: "Receipt",        kY: 5 },
    { id: "ty-invoice",   en: "Invoice",        kY: 5 },
    { id: "ty-bill",      en: "Bill",           kY: 5 },
    { id: "ty-contract",  en: "Contract",       kx: true },
    { id: "ty-warranty",  en: "Warranty",       kx: true },
    { id: "ty-insurance", en: "Insurance",      kx: true },
    { id: "ty-tax",       en: "Tax",            kY: 5 },
    { id: "ty-bank",      en: "Bank",           kY: 5 },
    { id: "ty-medical",   en: "Medical",        kY: -1, pv: true },
    { id: "ty-vehicle",   en: "Vehicle",        kx: true },
    { id: "ty-id",        en: "ID or passport", kx: true, pv: true },
    { id: "ty-cert",      en: "Certificate",    kY: -1 },
    { id: "ty-other",     en: "Other" }
  ];
  var BUILTIN_IDS = BUILTIN.map(function (b) { return b.id; });

  // ---------- small helpers ----------
  function isObj(o) { return !!o && typeof o === "object" && !Array.isArray(o); }
  function str(s, max) {
    if (typeof s !== "string") return "";
    s = s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
    if (s.normalize) s = s.normalize("NFC");
    return s.length > max ? s.slice(0, max) : s;
  }
  function stamp(n) { n = Math.floor(Number(n)); return isFinite(n) && n > 0 ? n : 0; }
  function okId(id) { return typeof id === "string" && ID_RE.test(id); }
  function okDate(s) {
    var m = DATE_RE.exec(s || "");
    if (!m) return false;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (y < 1900 || y > 9999 || mo < 1 || mo > 12 || d < 1) return false;
    var dt = new Date(Date.UTC(y, mo - 1, d));
    return dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
  }
  function date(s) { return okDate(s) ? s : ""; }
  function isDiskPath(p) {
    if (typeof p !== "string" || p.length > 4096 || p.indexOf(ROOT + "/") !== 0) return false;
    var segs = p.slice(ROOT.length + 1).split("/");
    for (var i = 0; i < segs.length; i++) {
      if (segs[i] === "" || segs[i] === "." || segs[i] === "..") return false;
    }
    return true;
  }
  function isTrashPath(p) { return typeof p === "string" && (p === TRASH || p.indexOf(TRASH + "/") === 0); }
  function under(p, dir) { return p === dir || p.indexOf(dir + "/") === 0; }
  function byId(a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; }
  function canon(o) { return JSON.stringify(o); }
  function randId(prefix, rnd) {
    var r = String(rnd == null ? Math.random().toString(36).slice(2) : rnd).toLowerCase().replace(/[^0-9a-z]/g, "");
    while (r.length < 8) r += "0";
    return prefix + "-" + r.slice(0, 16);
  }
  function newId(prefix, now, rnd) {
    var t = Math.max(0, Math.floor(now || 0)).toString(36);
    return randId(prefix, t + String(rnd == null ? Math.random().toString(36).slice(2, 10) : rnd));
  }

  // ---------- normalisation ----------
  function normName(n) {
    if (isObj(n)) {
      var en = str(n.en, 80), el = str(n.el, 80);
      if (!en && !el) return "";
      var o = {};
      if (el) o.el = el;
      if (en) o.en = en;
      return o;
    }
    return str(n, 80);
  }
  function normLink(l) {
    if (!isObj(l) || typeof l.a !== "string" || !APP_RE.test(l.a)) return null;
    var r = l.r;
    if (r == null || (typeof r !== "string" && !isObj(r))) return null;
    var rs = canon(r);
    if (rs.length > 1000) return null;
    var o = { a: l.a, r: JSON.parse(rs) };
    var t = str(l.t, 200);
    if (t) o.t = t;
    return o;
  }
  function normDoc(o) {
    if (!isObj(o) || !okId(o.id) || o.id.indexOf("d-") !== 0) return null;
    var m = stamp(o.m);
    if (!m || !isDiskPath(o.p)) return null;
    var d = { id: o.id, m: m, p: o.p };
    if (typeof o.h === "string" && HASH_RE.test(o.h)) d.h = o.h;
    d.t = str(o.t, 200);
    if (okId(o.ty) && o.ty.indexOf("ty-") === 0) d.ty = o.ty;
    var tg = [];
    (Array.isArray(o.tg) ? o.tg : []).forEach(function (x) {
      if (okId(x) && x.indexOf("tg-") === 0 && tg.indexOf(x) === -1 && tg.length < MAX_TAGS) tg.push(x);
    });
    d.tg = tg.sort();
    if (okId(o.co) && o.co.indexOf("co-") === 0) d.co = o.co;
    if (date(o.d)) d.d = o.d;
    var amt = Number(o.amt);
    if (o.amt != null && o.amt !== "" && isFinite(amt) && Math.abs(amt) < 1e12) d.amt = Math.round(amt * 100) / 100;
    if (typeof o.cur === "string" && CUR_RE.test(o.cur)) d.cur = o.cur;
    if (date(o.ex)) d.ex = o.ex;
    if (o.kp === FOREVER || date(o.kp)) d.kp = o.kp;
    var no = str(o.no, 2000);
    if (no) d.no = no;
    var ln = [], seen = {};
    (Array.isArray(o.ln) ? o.ln : []).forEach(function (l) {
      var n = normLink(l);
      if (!n || ln.length >= MAX_LINKS) return;
      var k = n.a + ":" + canon(n.r);
      if (seen[k]) return;
      seen[k] = true;
      ln.push(n);
    });
    d.ln = ln;
    if (isObj(o.x)) {
      var xs = canon(o.x);
      if (xs.length <= 4096) d.x = JSON.parse(xs);
    }
    return d;
  }
  function normType(o) {
    if (!isObj(o) || !okId(o.id) || o.id.indexOf("ty-") !== 0) return null;
    var m = stamp(o.m), n = normName(o.n);
    // A built-in whose settings changed but not its name keeps no
    // name: it stays translated in every language.
    if (!m || (!n && BUILTIN_IDS.indexOf(o.id) === -1)) return null;
    var r = { id: o.id, m: m };
    if (n) r.n = n;
    var kY = Math.floor(Number(o.kY));
    if (o.kY != null && isFinite(kY) && (kY === -1 || (kY >= 1 && kY <= 100))) r.kY = kY;
    if (o.kx === true) r.kx = true;
    if (o.pv === true) r.pv = true;
    return r;
  }
  function normTag(o) {
    if (!isObj(o) || !okId(o.id) || o.id.indexOf("tg-") !== 0) return null;
    var m = stamp(o.m), n = str(o.n, 60);
    if (!m || !n) return null;
    var r = { id: o.id, m: m, n: n };
    var c = Math.floor(Number(o.c));
    if (o.c != null && isFinite(c) && c >= 0 && c <= 11) r.c = c;
    return r;
  }
  function normCorr(o) {
    if (!isObj(o) || !okId(o.id) || o.id.indexOf("co-") !== 0) return null;
    var m = stamp(o.m), n = str(o.n, 120);
    if (!m || !n) return null;
    return { id: o.id, m: m, n: n };
  }

  // One list: the newest row per id (tie: larger JSON), then the
  // tombstones hide what they cover.
  function winner(a, b) {
    if (!a) return b;
    if (!b) return a;
    if (a.m !== b.m) return a.m > b.m ? a : b;
    return canon(a) >= canon(b) ? a : b;
  }
  function list(rows, normFn, tombs) {
    var map = {};
    (Array.isArray(rows) ? rows : []).forEach(function (r) {
      var n = normFn(r);
      if (n) map[n.id] = winner(map[n.id], n);
    });
    return Object.keys(map).map(function (k) { return map[k]; })
      .filter(function (r) { return !(tombs[r.id] >= r.m); })
      .sort(byId);
  }
  function normTombs(t) {
    var out = {};
    if (!isObj(t)) return out;
    Object.keys(t).forEach(function (k) {
      var v = stamp(t[k]);
      if (okId(k) && v && (!out[k] || v > out[k])) out[k] = v;
    });
    return out;
  }
  function sortTombs(t) {
    var keys = Object.keys(t);
    if (keys.length > MAX_TOMBS) {
      keys.sort(function (a, b) { return t[b] - t[a] || (a < b ? -1 : 1); });
      keys = keys.slice(0, MAX_TOMBS);
    }
    var out = {};
    keys.sort().forEach(function (k) { out[k] = t[k]; });
    return out;
  }

  function norm(raw) {
    var o = isObj(raw) ? raw : {};
    var tombs = sortTombs(normTombs(o.tombs));
    var docs = list(o.docs, normDoc, tombs);
    if (docs.length > MAX_DOCS) {
      docs = docs.slice().sort(function (a, b) { return b.m - a.m || (a.id < b.id ? -1 : 1); })
        .slice(0, MAX_DOCS).sort(byId);
    }
    return {
      v: 1,
      docs: docs,
      types: list(o.types, normType, tombs),
      tags: list(o.tags, normTag, tombs),
      corr: list(o.corr, normCorr, tombs),
      tombs: tombs
    };
  }

  function merge(a, b) {
    a = norm(a); b = norm(b);
    var tombs = {};
    [a.tombs, b.tombs].forEach(function (t) {
      Object.keys(t).forEach(function (k) { if (!tombs[k] || t[k] > tombs[k]) tombs[k] = t[k]; });
    });
    return norm({
      v: 1,
      docs: a.docs.concat(b.docs),
      types: a.types.concat(b.types),
      tags: a.tags.concat(b.tags),
      corr: a.corr.concat(b.corr),
      tombs: tombs
    });
  }

  // ---------- reading ----------
  function find(arr, id) {
    for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
    return null;
  }
  function getDoc(s, id) { return find(s.docs, id); }
  function docAt(s, p) {
    for (var i = 0; i < s.docs.length; i++) if (s.docs[i].p === p) return s.docs[i];
    return null;
  }
  function docsUnder(s, dir) { return s.docs.filter(function (d) { return under(d.p, dir); }); }
  // Is this file a document (for Photos, which hides documents)?
  function isDocument(s, p, h) {
    if (p && (under(p, DOCS_DIR))) return true;
    for (var i = 0; i < s.docs.length; i++) {
      var d = s.docs[i];
      if (d.p === p || (h && d.h === h)) return true;
    }
    return false;
  }

  function nameOf(n, lang) {
    if (typeof n === "string") return n;
    if (!isObj(n)) return "";
    var base = String(lang || "en").slice(0, 2);
    return n[base] || n.en || n.el || "";
  }
  // Built-ins first in their order (own edits applied), then own
  // types by name. names(id) → a built-in's name in the language
  // shown (the view's strings); English when it gives none.
  var builtinName = null;
  function setNames(fn) { builtinName = typeof fn === "function" ? fn : null; }
  function types(s, lang) {
    var out = [];
    BUILTIN.forEach(function (b) {
      if (s.tombs[b.id]) {
        var own = find(s.types, b.id);
        if (!own) return;                         // removed
      }
      var o = find(s.types, b.id);
      var name = (o && o.n) ? nameOf(o.n, lang) : ((builtinName && builtinName(b.id)) || b.en);
      var k = o || b;
      out.push({ id: b.id, name: name, kY: k.kY, kx: !!k.kx, pv: !!k.pv, builtin: true });
    });
    s.types.filter(function (t) { return BUILTIN_IDS.indexOf(t.id) === -1; })
      .map(function (t) { return { id: t.id, name: nameOf(t.n, lang), kY: t.kY, kx: !!t.kx, pv: !!t.pv, builtin: false }; })
      .sort(function (a, b) { return a.name.localeCompare(b.name, lang); })
      .forEach(function (t) { out.push(t); });
    return out;
  }
  function typeOf(s, id, lang) {
    if (!id) return null;
    var all = types(s, lang);
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }
  function tagsSorted(s, lang) {
    return s.tags.slice().sort(function (a, b) { return a.n.localeCompare(b.n, lang); });
  }
  function corrSorted(s, lang) {
    return s.corr.slice().sort(function (a, b) { return a.n.localeCompare(b.n, lang); });
  }
  // A document is private when its type is (Medical, ID) or a Health
  // item is linked to it: it never reaches the Assistant or Claude.
  function isPrivate(s, d) {
    var ty = typeOf(s, d.ty, "en");
    if (ty && ty.pv) return true;
    return (d.ln || []).some(function (l) { return l.a === "health" || l.a === "cycle" || l.a === "baby"; });
  }

  // ---------- writing (every change stamps only the changed row, R27) ----------
  function nextM(old, now) { return Math.max(Math.floor(now), old ? old.m + 1 : 1); }
  function clone(s) { return JSON.parse(canon(s)); }

  // Put a row in (or replace it); returns a new state. A row that is
  // the same as the stored one (apart from m) changes nothing.
  function putRow(s, listName, normFn, row, now) {
    var n = clone(s);
    var arr = n[listName], old = find(arr, row.id);
    // A row put back after its removal must beat the tombstone on
    // every device, so its stamp goes past it.
    var m = Math.max(nextM(old, now), (n.tombs[row.id] || 0) + 1);
    var cand = normFn(Object.assign({}, row, { m: m }));
    if (!cand) return s;
    if (old) {
      var a = Object.assign({}, old, { m: 0 }), b = Object.assign({}, cand, { m: 0 });
      if (canon(a) === canon(b)) return s;
    }
    var at = old ? arr.indexOf(old) : -1;
    if (at >= 0) arr[at] = cand; else arr.push(cand);
    arr.sort(byId);
    return norm(n);
  }
  function dropRow(s, listName, id, now) {
    var n = clone(s), old = find(n[listName], id);
    var isBuiltin = listName === "types" && BUILTIN_IDS.indexOf(id) !== -1;
    if (!old && !isBuiltin) return s;
    if (!old && isBuiltin && n.tombs[id]) return s;
    n.tombs[id] = Math.max(Math.floor(now), old ? old.m : 0, n.tombs[id] || 0);
    n[listName] = n[listName].filter(function (r) { return r.id !== id; });
    // A removed tag or sender leaves the documents that named it.
    if (listName === "tags" || listName === "corr" || listName === "types") {
      var field = listName === "tags" ? "tg" : listName === "corr" ? "co" : "ty";
      n.docs = n.docs.map(function (d) {
        var hit = field === "tg" ? d.tg.indexOf(id) !== -1 : d[field] === id;
        if (!hit) return d;
        var e = Object.assign({}, d, { m: nextM(d, now) });
        if (field === "tg") e.tg = d.tg.filter(function (x) { return x !== id; });
        else delete e[field];
        return e;
      });
    }
    return norm(n);
  }

  function putDoc(s, d, now) { return putRow(s, "docs", normDoc, d, now); }
  function dropDoc(s, id, now) { return dropRow(s, "docs", id, now); }
  function putTag(s, t, now) { return putRow(s, "tags", normTag, t, now); }
  function dropTag(s, id, now) { return dropRow(s, "tags", id, now); }
  function putCorr(s, c, now) { return putRow(s, "corr", normCorr, c, now); }
  function dropCorr(s, id, now) { return dropRow(s, "corr", id, now); }
  function putType(s, t, now) { return putRow(s, "types", normType, t, now); }
  function dropType(s, id, now) { return dropRow(s, "types", id, now); }

  // Tag / sender by name: the existing one (folded name) or a new row.
  function fold(x) {
    var s = String(x || "").toLowerCase();
    if (s.normalize) s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return s.replace(/\u03c2/g, "\u03c3").replace(/\s+/g, " ").trim();
  }
  function ensureNamed(s, listName, prefix, name, now, rnd) {
    var n = str(name, listName === "corr" ? 120 : 60);
    if (!n) return { state: s, id: "" };
    var f = fold(n), arr = s[listName];
    for (var i = 0; i < arr.length; i++) if (fold(arr[i].n) === f) return { state: s, id: arr[i].id };
    var id = newId(prefix, now, rnd);
    var row = { id: id, n: n };
    return { state: (listName === "tags" ? putTag : putCorr)(s, row, now), id: id };
  }
  function ensureTag(s, name, now, rnd) { return ensureNamed(s, "tags", "tg", name, now, rnd); }
  function ensureCorr(s, name, now, rnd) { return ensureNamed(s, "corr", "co", name, now, rnd); }

  // A new document for a file: title from its name, date from the
  // file's time (the person changes it).
  function titleFromName(name) {
    var n = String(name || "");
    var dot = n.lastIndexOf(".");
    if (dot > 0) n = n.slice(0, dot);
    return str(n.replace(/[_]+/g, " "), 200);
  }
  function isoDay(ms) {
    var d = new Date(ms);
    if (!isFinite(d.getTime())) return "";
    function p2(x) { return (x < 10 ? "0" : "") + x; }
    return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate());
  }
  function makeDoc(p, opts, now, rnd) {
    opts = opts || {};
    var d = { id: newId("d", now, rnd), p: p, t: titleFromName(p.slice(p.lastIndexOf("/") + 1)), tg: [], ln: [] };
    if (opts.h) d.h = opts.h;
    if (opts.mtime) d.d = isoDay(opts.mtime);
    return d;
  }
  // Add files as documents; a file that already is one is left alone.
  function addFiles(s, files, now, rnd) {
    var added = [], st = s;
    (files || []).forEach(function (f, i) {
      if (!f || !isDiskPath(f.p) || isTrashPath(f.p) || docAt(st, f.p)) return;
      var d = makeDoc(f.p, f, now, rnd == null ? null : String(rnd) + i);
      var before = st;
      st = putDoc(st, d, now);
      if (st !== before) added.push(d.id);
    });
    return { state: st, added: added };
  }

  // Files moved or renamed in Files carry their documents.
  function carry(s, from, to, now) {
    if (!isDiskPath(from) || !isDiskPath(to) || from === to) return s;
    var st = s;
    s.docs.forEach(function (d) {
      if (!under(d.p, from)) return;
      st = putDoc(st, Object.assign({}, d, { p: to + d.p.slice(from.length) }), now);
    });
    return st;
  }
  // A file moved somewhere Files did not see: find it again by its
  // SHA-256 among the paths the vault knows (path → { h }).
  function relocate(s, entries, now) {
    var byHash = {};
    (entries || []).forEach(function (e) {
      if (e && HASH_RE.test(e.h || "") && isDiskPath(e.p) && !isTrashPath(e.p)) {
        (byHash[e.h] = byHash[e.h] || []).push(e.p);
      }
    });
    var known = {};
    (entries || []).forEach(function (e) { if (e && e.p) known[e.p] = true; });
    var st = s, moved = 0;
    s.docs.forEach(function (d) {
      if (!d.h || known[d.p] || !byHash[d.h]) return;
      var cands = byHash[d.h].filter(function (p) { return !docAt(st, p); }).sort();
      if (!cands.length) return;
      st = putDoc(st, Object.assign({}, d, { p: cands[0] }), now);
      moved++;
    });
    return { state: st, moved: moved };
  }

  // ---------- dates ----------
  function addYears(day, years) {
    var m = DATE_RE.exec(day || "");
    if (!m) return "";
    var y = +m[1] + years, mo = +m[2], d = +m[3];
    if (mo === 2 && d === 29 && !okDate(y + "-02-29")) d = 28;
    function p2(x) { return (x < 10 ? "0" : "") + x; }
    var out = y + "-" + p2(mo) + "-" + p2(d);
    return okDate(out) ? out : "";
  }
  // The type's suggested "keep until" for a document (Chris
  // 2026-11-13 "yes, as a suggestion"): written when the type is chosen and
  // "keep until" is empty; always editable. "" = no suggestion.
  function suggestKeep(type, d, today) {
    if (!type) return "";
    if (type.kY === -1) return FOREVER;
    if (type.kx) return date(d.ex) || "";
    if (type.kY >= 1) {
      var from = date(d.d) || date(today);
      return from ? addYears(from, type.kY) : "";
    }
    return "";
  }
  function dayDiff(a, b) {
    var ma = DATE_RE.exec(a || ""), mb = DATE_RE.exec(b || "");
    if (!ma || !mb) return null;
    return Math.round((Date.UTC(+mb[1], +mb[2] - 1, +mb[3]) - Date.UTC(+ma[1], +ma[2] - 1, +ma[3])) / DAY);
  }
  // Expiry within `days` days (or passed): the number of days left.
  function expiresIn(d, today) { return d.ex ? dayDiff(today, d.ex) : null; }
  function keepPassed(d, today) {
    if (!d.kp || d.kp === FOREVER) return false;
    var n = dayDiff(today, d.kp);
    return n !== null && n < 0;
  }

  // ---------- filter + search ----------
  // q = { text, ty, tg, co, year, flag: "soon" | "keep" | "untyped" },
  // newest document date first (no date: by the time added).
  function haystack(s, d, lang) {
    var ty = typeOf(s, d.ty, lang), co = find(s.corr, d.co || "");
    var parts = [d.t, d.p.slice(d.p.lastIndexOf("/") + 1), d.no || "", ty ? ty.name : "", co ? co.n : ""];
    d.tg.forEach(function (id) { var t = find(s.tags, id); if (t) parts.push(t.n); });
    if (d.amt != null) parts.push(String(d.amt));
    (d.ln || []).forEach(function (l) { if (l.t) parts.push(l.t); });
    return fold(parts.join(" \u0001 "));
  }
  function filter(s, q, today, lang, extraText) {
    q = q || {};
    var words = fold(q.text || "").split(" ").filter(Boolean);
    var out = s.docs.filter(function (d) {
      if (q.ty && (q.ty === "-" ? !!d.ty : d.ty !== q.ty)) return false;
      if (q.tg && d.tg.indexOf(q.tg) === -1) return false;
      if (q.co && d.co !== q.co) return false;
      if (q.year && String(d.d || "").slice(0, 4) !== String(q.year)) return false;
      if (q.flag === "soon") {
        var n = expiresIn(d, today);
        if (n === null || n > 30) return false;
      }
      if (q.flag === "keep" && !keepPassed(d, today)) return false;
      if (q.flag === "untyped" && d.ty) return false;
      if (words.length) {
        var h = haystack(s, d, lang);
        var more = extraText ? fold(extraText(d) || "") : "";
        for (var i = 0; i < words.length; i++) {
          if (h.indexOf(words[i]) === -1 && more.indexOf(words[i]) === -1) return false;
        }
      }
      return true;
    });
    return out.sort(function (a, b) {
      var da = a.d || "", db = b.d || "";
      if (da !== db) return da < db ? 1 : -1;
      return b.m - a.m || (a.id < b.id ? -1 : 1);
    });
  }
  function years(s) {
    var y = {};
    s.docs.forEach(function (d) { if (d.d) y[d.d.slice(0, 4)] = true; });
    return Object.keys(y).sort().reverse();
  }
  function counts(s, today) {
    var c = { all: s.docs.length, soon: 0, keep: 0, untyped: 0 };
    s.docs.forEach(function (d) {
      var n = expiresIn(d, today);
      if (n !== null && n <= 30) c.soon++;
      if (keepPassed(d, today)) c.keep++;
      if (!d.ty) c.untyped++;
    });
    return c;
  }

  // ---------- export / import ----------
  // documents.json inside the archive ZIP: the details with each file's
  // place in the ZIP (`f`), never device data. Paths in the ZIP are the
  // disk paths without /internal/.
  function zipName(p) { return p.slice(ROOT.length + 1); }
  function exportJson(s, docs, lang, now) {
    var ids = {};
    docs.forEach(function (d) { ids[d.id] = true; });
    var used = { ty: {}, tg: {}, co: {} };
    var out = docs.map(function (d) {
      var o = JSON.parse(canon(d));
      delete o.m;
      o.f = zipName(d.p);
      delete o.p;
      if (d.ty) used.ty[d.ty] = true;
      if (d.co) used.co[d.co] = true;
      d.tg.forEach(function (t) { used.tg[t] = true; });
      return o;
    });
    return {
      format: "oros-documents", v: 1, at: new Date(now).toISOString(),
      docs: out,
      types: types(s, lang).filter(function (t) { return used.ty[t.id]; })
        .map(function (t) { var o = { id: t.id, n: t.name }; if (t.kY != null) o.kY = t.kY; if (t.kx) o.kx = true; if (t.pv) o.pv = true; return o; }),
      tags: s.tags.filter(function (t) { return used.tg[t.id]; }).map(function (t) { var o = { id: t.id, n: t.n }; if (t.c != null) o.c = t.c; return o; }),
      corr: s.corr.filter(function (c) { return used.co[c.id]; }).map(function (c) { return { id: c.id, n: c.n }; })
    };
  }
  function csvCell(v) {
    var s = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;                 // no formulas in spreadsheets
    return /[",\n\r;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function exportCsv(s, docs, lang, heads) {
    var rows = [heads.join(",")];
    docs.forEach(function (d) {
      var ty = typeOf(s, d.ty, lang), co = find(s.corr, d.co || "");
      var tg = d.tg.map(function (id) { var t = find(s.tags, id); return t ? t.n : ""; }).filter(Boolean).join("; ");
      rows.push([d.t, ty ? ty.name : "", tg, co ? co.n : "", d.d || "", d.amt == null ? "" : d.amt, d.cur || "",
        d.ex || "", d.kp || "", zipName(d.p), d.no || ""].map(csvCell).join(","));
    });
    return "\ufeff" + rows.join("\r\n") + "\r\n";
  }
  // Read an archive's documents.json. place(f) → the disk path the
  // file was written to (null = it was not). Types, tags and senders
  // join the existing ones by name; documents keep their ids, so a
  // second import of the same archive changes nothing new.
  function importJson(s, json, place, now, lang) {
    if (!isObj(json) || json.format !== "oros-documents" || !Array.isArray(json.docs)) return { state: s, added: 0, error: "format" };
    var st = s, map = { ty: {}, tg: {}, co: {} }, added = 0;
    var have = types(st, lang);
    (Array.isArray(json.types) ? json.types : []).forEach(function (t, i) {
      if (!isObj(t) || !okId(t.id)) return;
      var name = typeof t.n === "string" ? str(t.n, 80) : nameOf(t.n, lang);
      if (BUILTIN_IDS.indexOf(t.id) !== -1) { map.ty[t.id] = t.id; return; }
      var f = fold(name), hit = null;
      have.forEach(function (h) { if (!hit && fold(h.name) === f) hit = h.id; });
      if (hit) { map.ty[t.id] = hit; return; }
      if (!name) return;
      var row = { id: okId(t.id) && t.id.indexOf("ty-") === 0 ? t.id : newId("ty", now, i), n: name };
      if (t.kY != null) row.kY = t.kY;
      if (t.kx) row.kx = true;
      if (t.pv) row.pv = true;
      st = putType(st, row, now);
      map.ty[t.id] = row.id;
    });
    (Array.isArray(json.tags) ? json.tags : []).forEach(function (t, i) {
      if (!isObj(t) || !okId(t.id)) return;
      var r = ensureTag(st, t.n, now, "i" + i);
      st = r.state;
      if (r.id) map.tg[t.id] = r.id;
    });
    (Array.isArray(json.corr) ? json.corr : []).forEach(function (c, i) {
      if (!isObj(c) || !okId(c.id)) return;
      var r = ensureCorr(st, c.n, now, "c" + i);
      st = r.state;
      if (r.id) map.co[c.id] = r.id;
    });
    json.docs.forEach(function (o) {
      if (!isObj(o) || typeof o.f !== "string") return;
      var p = place(o.f);
      if (!p || !isDiskPath(p)) return;
      var d = Object.assign({}, o, { p: p });
      delete d.f;
      d.ty = o.ty ? map.ty[o.ty] : undefined;
      d.co = o.co ? map.co[o.co] : undefined;
      d.tg = (Array.isArray(o.tg) ? o.tg : []).map(function (x) { return map.tg[x]; }).filter(Boolean);
      if (!okId(d.id) || d.id.indexOf("d-") !== 0) d.id = newId("d", now, added);
      var old = getDoc(st, d.id), other = docAt(st, p);
      if (other && other.id !== d.id) return;              // that file already is another document
      var before = st;
      st = putDoc(st, d, now);
      if (st !== before && !old) added++;
    });
    return { state: st, added: added, error: "" };
  }

  // Where a new file added from the Documents place goes.
  function addDir(now) { return DOCS_DIR + "/" + new Date(now).getFullYear(); }

  var API = {
    VERSION: "1.0.0", KEY: KEY, SLICE: SLICE, ROOT: ROOT, DOCS_DIR: DOCS_DIR,
    MAX_DOCS: MAX_DOCS, WARN_DOCS: WARN_DOCS, FOREVER: FOREVER, BUILTIN: BUILTIN, setNames: setNames,
    norm: norm, merge: merge, okDate: okDate, isDiskPath: isDiskPath, fold: fold,
    getDoc: getDoc, docAt: docAt, docsUnder: docsUnder, isDocument: isDocument,
    nameOf: nameOf, types: types, typeOf: typeOf, tagsSorted: tagsSorted, corrSorted: corrSorted,
    isPrivate: isPrivate,
    putDoc: putDoc, dropDoc: dropDoc, putTag: putTag, dropTag: dropTag, putCorr: putCorr,
    dropCorr: dropCorr, putType: putType, dropType: dropType, ensureTag: ensureTag, ensureCorr: ensureCorr,
    newId: newId, titleFromName: titleFromName, isoDay: isoDay, makeDoc: makeDoc, addFiles: addFiles,
    carry: carry, relocate: relocate,
    addYears: addYears, suggestKeep: suggestKeep, dayDiff: dayDiff, expiresIn: expiresIn, keepPassed: keepPassed,
    filter: filter, years: years, counts: counts,
    exportJson: exportJson, exportCsv: exportCsv, importJson: importJson, addDir: addDir
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.OrosDocsCore = API;
})(typeof window !== "undefined" ? window : globalThis);
