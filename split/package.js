// ============================================================
// orOS Split — .orossplit file (split/package.js,
// window.OrosSplitPackage). The descriptor of Split for the record
// apps' kit (../recordpkg.js, docs/oros-bundle.md "Record apps"):
// groups with their people, expenses, payments and repeating
// expenses in one orOS bundle, the receipt photos in media/; opening
// one ADDS what this device lacks, with its ids. Pure (no DOM, no
// storage), so the app and `node --test` run the same code.
//   DESC                     the kit descriptor (no merge: the kit's
//                            plain insert; split.js then runs the
//                            result through mergeSplit + commit, so
//                            sync carries it)
//   DESC.norm(data)          a file's data → { ver, groups, people,
//                            exp, pay, rec, receipts } with split.js's
//                            own record checks (normGroup … normRec,
//                            the same rules; a test keeps them equal):
//                            children only of a group in the file, the
//                            first copy of an id, the app's limits per
//                            group; tombstones in the file are ignored
//   DESC.strip(state)        the slice → { ver, groups, people, exp,
//                            pay, rec?, receipts? }: no tombstones
//                            (tombs), never `mine` (who you are in a
//                            group is yours, as in the group file)
//   DESC.tombIds(state)      the ids tombs name that are not live
//   DESC.previews(state, l)  NN-<group>.csv per group: the app's
//                            "Export CSV" (its buildCsv, the format the
//                            app uses by default for that language)
//   forLocal(getLocal)       DESC whose norm also drops the children of
//                            a group deleted on this device (the kit
//                            keeps that group deleted, so its people
//                            and expenses must not come back)
//   groupSlice(state, gid)   one group with its children (Save inside
//                            a group: the file you send your friends)
//   kindOf(id, state)        "group" | "person" | "exp" | "pay" | "rec" | ""
//   receiptsOf(data)         { "<receipt file>": "<sha256>.jpg" }, checked
// Receipts: an expense's `ph` stays its file name in Split/Receipts
// (the same on every device); data.receipts maps that name to its
// media key, filled by the app's files() hook while it saves.
// ============================================================
(function (root) {
  "use strict";

  // The limits and patterns of split.js (section 1 and 3)
  var DATA_VER = 1, NAME_LEN = 40, PERSON_LEN = 30, TITLE_LEN = 60, NOTE_LEN = 140;
  var MAX_CENTS = 100000000000, MAX_GROUPS = 200, MAX_PEOPLE = 30, MAX_EXP = 3000;
  var MAX_SHARES = 1000, PCT_FULL = 10000, COLOR_SLOTS = 9, MAX_ITEMS = 60, ITEM_LEN = 40, MAX_RULES = 50;
  var CURRENCIES = ["EUR", "USD", "GBP", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK",
                    "HUF", "RON", "BGN", "TRY", "CAD", "AUD", "JPY"];
  var MODES = { eq: 1, ex: 1, sh: 1, pc: 1 };
  var CATS = { food: 1, groc: 1, stay: 1, trans: 1, bills: 1, fun: 1, other: 1 };
  var EVERY = { w: 1, m: 1, y: 1 };
  var GID_RE = /^[a-z0-9]{1,24}$/;
  var CHILD_RE = /^[a-z0-9]{1,24}\.[a-z0-9]{1,24}$/;
  var TOMB_RE = /^(grp:[a-z0-9]{1,24}|(per|exp|pay|rec):[a-z0-9]{1,24}\.[a-z0-9]{1,24})$/;
  var CUR_RE = /^[A-Z]{3}$/;
  var PH_RE = /^\d{8}-[a-z0-9]{1,24}-[a-z0-9]{1,24}-[a-z0-9]{4,12}\.jpg$/;
  var KEY_RE = /^[0-9a-f]{64}\.jpg$/;
  var YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  // [slice key, tomb prefix, kind]
  var KEYS = [["groups", "grp", "group"], ["people", "per", "person"], ["exp", "exp", "exp"],
              ["pay", "pay", "pay"], ["rec", "rec", "rec"]];

  var hasOwn = Object.prototype.hasOwnProperty;
  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function groupOf(id) { var i = id.indexOf("."); return i < 0 ? id : id.slice(0, i); }
  function normText(s, max) {
    return typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
  }
  function okStamp(m) { return isInt(m) && m >= 0; }
  function okCents(a) { return isInt(a) && a > 0 && a <= MAX_CENTS; }
  function isChildOf(id, gid) { return typeof id === "string" && CHILD_RE.test(id) && groupOf(id) === gid; }
  function daysIn(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function parseYmd(s) {
    var x = typeof s === "string" ? YMD_RE.exec(s) : null;
    if (!x) return null;
    var y = +x[1], m = +x[2], d = +x[3];
    if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > daysIn(y, m)) return null;
    return { y: y, m: m, d: d };
  }
  function roundRate(r) { return Number(Number(r).toPrecision(6)); }
  function convertCents(oa, r) { return Math.round(oa * r); }
  // split.js allot: `total` in proportion to the weights, the cents left
  // over to the largest remainders, ties by key order from `rot`
  function allot(w, total, rot) {
    var out = {};
    var ids = Object.keys(w).filter(function (k) { return w[k] > 0; }).sort(cmpStr);
    if (!ids.length) return out;
    var W = 0, maxw = 0;
    ids.forEach(function (k) { W += w[k]; if (w[k] > maxw) maxw = w[k]; });
    var n = ids.length, r0 = isInt(rot) ? ((rot % n) + n) % n : 0;
    var big = total * maxw > 9007199254740991 || W > 9007199254740991;
    var given = 0, rems = [];
    ids.forEach(function (k, i) {
      var q, r;
      if (big) {
        var p = BigInt(total) * BigInt(w[k]), bw = BigInt(W);
        q = Number(p / bw);
        r = Number(p % bw);
      } else {
        var pp = total * w[k];
        q = Math.floor(pp / W);
        r = pp % W;
      }
      out[k] = q;
      given += q;
      rems.push({ k: k, r: r, o: (i - r0 + n) % n });
    });
    rems.sort(function (p, q) { return q.r - p.r || p.o - q.o; });
    for (var i = 0; given < total; i++, given++) out[rems[i % rems.length].k]++;
    return out;
  }
  function itemShares(it) {
    var sub = {};
    it.l.forEach(function (r, i) {
      var one = {};
      r.p.forEach(function (k) { one[k] = 1; });
      var s = allot(one, r.a, i);
      Object.keys(s).forEach(function (k) { sub[k] = (sub[k] || 0) + s[k]; });
    });
    var extra = (it.x || 0) + (it.tp || 0);
    if (extra) {
      var e = allot(sub, extra, 0);
      Object.keys(e).forEach(function (k) { sub[k] = (sub[k] || 0) + e[k]; });
    }
    var out = {};
    Object.keys(sub).sort(cmpStr).forEach(function (k) { out[k] = sub[k]; });
    return out;
  }
  function sharesOf(x) {
    var out = {};
    if (x.mode === "ex") { Object.keys(x.w).sort(cmpStr).forEach(function (k) { out[k] = x.w[k]; }); return out; }
    return allot(x.w, x.a, 0);
  }
  function dropZero(m) {
    var o = {};
    Object.keys(m).sort(cmpStr).forEach(function (k) { if (m[k] > 0) o[k] = m[k]; });
    return o;
  }
  function sameMap(p, q) {
    var a = Object.keys(p), b = Object.keys(q);
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (p[a[i]] !== q[a[i]]) return false;
    return true;
  }

  // ---------- the record checks of split.js (section 3) ----------
  function normMap(x, gid, ok) {
    if (!isObj(x)) return null;
    var keys = Object.keys(x);
    if (!keys.length || keys.length > MAX_PEOPLE * 2) return null;
    keys.sort(cmpStr);
    var out = {}, sum = 0;
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i], v = x[k];
      if (!isChildOf(k, gid) || !ok(v)) return null;
      out[k] = v;
      sum += v;
    }
    return [out, sum];
  }
  function okOne(v) { return v === 1; }
  function okShare(v) { return isInt(v) && v > 0 && v <= MAX_SHARES; }
  function okPct(v) { return isInt(v) && v > 0 && v <= PCT_FULL; }

  function normGroup(x) {
    if (!isObj(x) || typeof x.id !== "string" || !GID_RE.test(x.id) || !okStamp(x.m)) return null;
    var n = normText(x.n, NAME_LEN);
    if (!n) return null;
    return { id: x.id, m: x.m, n: n,
             col: isInt(x.col) && x.col >= 0 && x.col < COLOR_SLOTS ? x.col : 0,
             cur: CURRENCIES.indexOf(x.cur) >= 0 ? x.cur : "EUR",
             arch: x.arch ? 1 : 0 };
  }
  function normPerson(x) {
    if (!isObj(x) || typeof x.id !== "string" || !CHILD_RE.test(x.id) || !okStamp(x.m)) return null;
    var n = normText(x.n, PERSON_LEN);
    return n ? { id: x.id, m: x.m, n: n } : null;
  }
  function normExp(x) {
    if (!isObj(x) || typeof x.id !== "string" || !CHILD_RE.test(x.id) ||
        !okStamp(x.m) || !okCents(x.a) || !parseYmd(x.d) || !MODES[x.mode]) return null;
    var g = groupOf(x.id);
    var by = normMap(x.by, g, okCents);
    if (!by || by[1] !== x.a) return null;
    var ok = { eq: okOne, sh: okShare, pc: okPct, ex: okCents }[x.mode];
    var w = normMap(x.w, g, ok);
    if (!w) return null;
    if (x.mode === "pc" && w[1] !== PCT_FULL) return null;
    if (x.mode === "ex" && w[1] !== x.a) return null;
    var out = { id: x.id, m: x.m, t: normText(x.t, TITLE_LEN), a: x.a, d: x.d,
                c: CATS[x.c] === 1 ? x.c : "other", by: by[0], mode: x.mode, w: w[0], n: normText(x.n, NOTE_LEN) };
    var fx = normFx(x.fx, out);
    if (fx) out.fx = fx;
    if (out.mode === "ex") {
      var it = normIt(x.it, out);
      if (it) out.it = it;
    }
    if (typeof x.ph === "string" && PH_RE.test(x.ph)) out.ph = x.ph;
    if (isChildOf(x.r, g) && x.r !== x.id) out.r = x.r;
    return out;
  }
  function normFx(f, e) {
    if (!isObj(f) || !CUR_RE.test(f.c) || !okCents(f.a)) return null;
    if (typeof f.r !== "number" || !isFinite(f.r) || f.r <= 0 || f.r >= 1000000 || roundRate(f.r) !== f.r) return null;
    if (convertCents(f.a, f.r) !== e.a) return null;
    var g = groupOf(e.id);
    var out = { c: f.c, a: f.a, r: f.r, s: f.s === "ecb" ? "ecb" : "man" };
    if (out.s === "ecb" && parseYmd(f.d)) out.d = f.d;
    if (f.by !== undefined) {
      var by = normMap(f.by, g, okCents);
      if (!by || by[1] !== f.a || !sameMap(dropZero(allot(by[0], e.a, 0)), e.by)) return null;
      out.by = by[0];
    }
    if (f.w !== undefined) {
      var w = normMap(f.w, g, okCents);
      if (e.mode !== "ex" || !w || w[1] !== f.a || !sameMap(dropZero(allot(w[0], e.a, 0)), e.w)) return null;
      out.w = w[0];
    }
    return out;
  }
  function normIt(x, e) {
    if (!isObj(x) || !Array.isArray(x.l) || !x.l.length || x.l.length > MAX_ITEMS) return null;
    var g = groupOf(e.id), l = [], sum = 0;
    for (var i = 0; i < x.l.length; i++) {
      var r = x.l[i];
      if (!isObj(r) || !okCents(r.a) || !Array.isArray(r.p) || !r.p.length || r.p.length > MAX_PEOPLE) return null;
      var p = r.p.slice().sort(cmpStr);
      for (var j = 0; j < p.length; j++) if (!isChildOf(p[j], g) || p[j] === p[j - 1]) return null;
      l.push({ n: normText(r.n, ITEM_LEN), a: r.a, p: p });
      sum += r.a;
    }
    var tax = x.x === undefined ? 0 : x.x, tip = x.tp === undefined ? 0 : x.tp;
    if (!isInt(tax) || tax < 0 || tax > MAX_CENTS || !isInt(tip) || tip < 0 || tip > MAX_CENTS) return null;
    var out = { l: l, x: tax, tp: tip };
    if (sum + tax + tip !== (e.fx ? e.fx.a : e.a)) return null;
    var sh = itemShares(out);
    if (e.fx) sh = allot(sh, e.a, 0);
    return sameMap(dropZero(sh), e.w) ? out : null;
  }
  function normRec(x) {
    if (!isObj(x) || !EVERY[x.f]) return null;
    var y = {};
    Object.keys(x).forEach(function (k) { if (k !== "ph" && k !== "r") y[k] = x[k]; });
    var e = normExp(y);
    if (!e) return null;
    e.f = x.f;
    if (parseYmd(x.u) && x.u >= e.d) e.u = x.u;
    return e;
  }
  function normPay(x) {
    if (!isObj(x) || typeof x.id !== "string" || !CHILD_RE.test(x.id) ||
        !okStamp(x.m) || !okCents(x.a) || !parseYmd(x.d)) return null;
    var g = groupOf(x.id);
    if (!isChildOf(x.f, g) || !isChildOf(x.to, g) || x.f === x.to) return null;
    return { id: x.id, m: x.m, f: x.f, to: x.to, a: x.a, d: x.d };
  }
  var NORM = { groups: normGroup, people: normPerson, exp: normExp, pay: normPay, rec: normRec };

  // { "<receipt file>": "<sha256>.jpg" } of a data object, checked
  function receiptsOf(data) {
    var out = {}, r = isObj(data) && isObj(data.receipts) ? data.receipts : null;
    if (r) Object.keys(r).forEach(function (k) {
      if (PH_RE.test(k) && typeof r[k] === "string" && KEY_RE.test(r[k])) out[k] = r[k];
    });
    return out;
  }

  // a file's data → the slice's shape, the app's checks, its limits
  function norm(data) {
    if (!isObj(data)) return null;
    var out = { ver: DATA_VER, groups: [], people: [], exp: [], pay: [], rec: [] };
    var live = Object.create(null), seen = Object.create(null), count = Object.create(null);
    function take(key, ok) {
      var list = Array.isArray(data[key]) ? data[key] : [];
      var once = seen[key] = Object.create(null);
      for (var i = 0; i < list.length && i < 200000; i++) {
        var x = NORM[key](list[i]);
        if (!x || once[x.id] || !ok(x)) continue;
        once[x.id] = 1;
        out[key].push(x);
      }
    }
    take("groups", function (g) {
      if (out.groups.length >= MAX_GROUPS) return false;
      live[g.id] = 1;
      return true;
    });
    function cap(what, max) {
      return function (x) {
        var g = groupOf(x.id), k = what + "\u0001" + g;
        if (live[g] !== 1 || (count[k] || 0) >= max) return false;
        count[k] = (count[k] || 0) + 1;
        return true;
      };
    }
    take("people", cap("per", MAX_PEOPLE));
    var entries = cap("ent", MAX_EXP);
    take("exp", entries);
    take("pay", entries);
    take("rec", cap("rec", MAX_RULES));
    var used = {};
    out.exp.forEach(function (x) { if (x.ph) used[x.ph] = 1; });
    var rc = receiptsOf(data), keep = {}, any = false;
    Object.keys(rc).forEach(function (k) { if (used[k]) { keep[k] = rc[k]; any = true; } });
    if (any) out.receipts = keep;
    return out;
  }

  function strip(state) {
    var s = isObj(state) ? state : {}, out = { ver: DATA_VER };
    ["groups", "people", "exp", "pay"].forEach(function (k) { out[k] = Array.isArray(s[k]) ? s[k] : []; });
    if (Array.isArray(s.rec) && s.rec.length) out.rec = s.rec;
    var rc = receiptsOf(s), used = {}, keep = {}, any = false;
    out.exp.forEach(function (x) { if (isObj(x) && typeof x.ph === "string") used[x.ph] = 1; });
    Object.keys(rc).forEach(function (k) { if (used[k]) { keep[k] = rc[k]; any = true; } });
    if (any) out.receipts = keep;
    return JSON.parse(JSON.stringify(out));
  }

  // the ids the tombs name, unless the record is live (a newer edit
  // brought it back: it may still be updated)
  function tombIds(state) {
    if (!isObj(state) || !isObj(state.tombs)) return [];
    var live = {};
    KEYS.forEach(function (k) {
      (Array.isArray(state[k[0]]) ? state[k[0]] : []).forEach(function (x) { if (isObj(x)) live[k[1] + ":" + x.id] = 1; });
    });
    return Object.keys(state.tombs).filter(function (k) { return TOMB_RE.test(k) && !live[k]; })
      .map(function (k) { return k.slice(4); });
  }

  function forLocal(getLocal) {
    var d = {};
    Object.keys(DESC).forEach(function (k) { d[k] = DESC[k]; });
    d.norm = function (data) {
      var out = norm(data);
      if (!out) return out;
      var loc = getLocal(), dead = {};
      if (isObj(loc) && isObj(loc.tombs)) {
        var here = {};
        (Array.isArray(loc.groups) ? loc.groups : []).forEach(function (g) { if (isObj(g)) here[g.id] = 1; });
        Object.keys(loc.tombs).forEach(function (k) {
          if (k.slice(0, 4) === "grp:" && !here[k.slice(4)]) dead[k.slice(4)] = 1;
        });
      }
      ["people", "exp", "pay", "rec"].forEach(function (k) {
        out[k] = out[k].filter(function (x) { return dead[groupOf(x.id)] !== 1; });
      });
      return out;
    };
    return d;
  }

  // one group and its children, in the slice's shape (no tombs, no mine)
  function groupSlice(state, gid) {
    var s = isObj(state) ? state : {}, out = { ver: DATA_VER, groups: [], people: [], exp: [], pay: [], tombs: {} };
    out.groups = (Array.isArray(s.groups) ? s.groups : []).filter(function (g) { return isObj(g) && g.id === gid; });
    ["people", "exp", "pay", "rec"].forEach(function (k) {
      var list = (Array.isArray(s[k]) ? s[k] : []).filter(function (x) { return isObj(x) && typeof x.id === "string" && groupOf(x.id) === gid; });
      if (k !== "rec" || list.length) out[k] = list;
    });
    if (isObj(s.receipts)) out.receipts = s.receipts;
    return JSON.parse(JSON.stringify(out));
  }

  function kindOf(id, state) {
    var s = isObj(state) ? state : {};
    for (var i = 0; i < KEYS.length; i++) {
      var list = Array.isArray(s[KEYS[i][0]]) ? s[KEYS[i][0]] : [];
      for (var j = 0; j < list.length; j++) if (isObj(list[j]) && list[j].id === id) return KEYS[i][2];
    }
    return "";
  }

  // ---------- previews: the app's "Export CSV", one file per group ----------
  var COLS = {
    en: { date: "Date", type: "Type", title: "What for", cat: "Category", amount: "Amount", cur: "Currency",
          by: "Paid by", share: "Share: {p}", note: "Note", orig: "Original amount", ocur: "Original currency",
          rate: "Rate", exp: "Expense", pay: "Payment", unknown: "Unknown",
          food: "Food & drinks", groc: "Groceries", stay: "Accommodation", trans: "Transport",
          bills: "Bills & rent", fun: "Activities", other: "Other" },
    el: { date: "Ημερομηνία", type: "Τύπος", title: "Για τι", cat: "Κατηγορία", amount: "Ποσό", cur: "Νόμισμα",
          by: "Πλήρωσε", share: "Μερίδιο: {p}", note: "Σημείωση", orig: "Αρχικό ποσό", ocur: "Αρχικό νόμισμα",
          rate: "Ισοτιμία", exp: "Έξοδο", pay: "Πληρωμή", unknown: "Άγνωστος",
          food: "Φαγητό & ποτό", groc: "Σούπερ μάρκετ", stay: "Διαμονή", trans: "Μεταφορές",
          bills: "Λογαριασμοί & ενοίκιο", fun: "Δραστηριότητες", other: "Άλλα" }
  };
  // split.js csvCell / buildCsv: RFC 4180, a formula guard (a leading
  // apostrophe before = + - @ tab CR), a BOM; "excel" = ";" and "12,50"
  function csvCell(v, sep) {
    var s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    if (s.indexOf(sep) >= 0 || /["\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  function centsPlain(c, decSep) {
    var neg = c < 0, a = Math.abs(c);
    return (neg ? "-" : "") + Math.floor(a / 100) + decSep + pad2(a % 100);
  }
  function centsToInput(c, lang) {
    return (Math.floor(c / 100)) + (c % 100 ? (lang === "el" ? "," : ".") + pad2(c % 100) : "");
  }
  function buildCsv(head, rows, fmt) {
    var sep = fmt === "excel" ? ";" : ",", dec = fmt === "excel" ? "," : ".";
    var lines = [head.map(function (h) { return csvCell(h, sep); }).join(sep)];
    rows.forEach(function (r) {
      lines.push(r.map(function (v) {
        return typeof v === "number" ? centsPlain(v, dec) : csvCell(v, sep);
      }).join(sep));
    });
    return "﻿" + lines.join("\r\n") + "\r\n";
  }
  // One group as the app's Export CSV (exportCsv in split.js)
  function groupCsv(state, g, lang) {
    var L = COLS[lang === "el" ? "el" : "en"], fmt = lang === "el" ? "excel" : "std";
    var names = {};
    (state.people || []).forEach(function (p) { names[p.id] = p.n; });
    var name = function (id) { return hasOwn.call(names, id) ? names[id] : L.unknown; };
    var people = (state.people || []).filter(function (p) { return groupOf(p.id) === g.id; })
      .sort(function (a, b) { return a.n.localeCompare(b.n) || cmpStr(a.id, b.id); });
    var head = [L.date, L.type, L.title, L.cat, L.amount, L.cur, L.by]
      .concat(people.map(function (p) { return L.share.replace("{p}", p.n); }))
      .concat([L.note, L.orig, L.ocur, L.rate]);
    var rate = function (r) { var s = String(r); return fmt === "excel" ? s.replace(".", ",") : s; };
    var en = [];
    (state.exp || []).forEach(function (x) { if (groupOf(x.id) === g.id) en.push({ k: "e", x: x }); });
    (state.pay || []).forEach(function (x) { if (groupOf(x.id) === g.id) en.push({ k: "p", x: x }); });
    en.sort(function (p, q) { return cmpStr(p.x.d, q.x.d) || p.x.m - q.x.m || cmpStr(p.x.id, q.x.id); });
    var rows = en.map(function (e) {
      var x = e.x;
      if (e.k === "p") {
        return [x.d, L.pay, name(x.f) + " → " + name(x.to), "", x.a, g.cur, name(x.f)]
          .concat(people.map(function () { return ""; })).concat(["", "", "", ""]);
      }
      var sh = sharesOf(x), payers = Object.keys(x.by);
      return [x.d, L.exp, x.t, L[CATS[x.c] === 1 ? x.c : "other"], x.a, g.cur,
              payers.map(function (k) { return name(k) + (payers.length > 1 ? " " + centsToInput(x.by[k], lang) : ""); }).join(", ")]
        .concat(people.map(function (p) { return sh[p.id] ? sh[p.id] : ""; }))
        .concat([x.n].concat(x.fx ? [x.fx.a, x.fx.c, rate(x.fx.r)] : ["", "", ""]));
    });
    return buildCsv(head, rows, fmt);
  }
  function fileSlug(s) {
    var x = String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
    return x || "group";
  }
  function previews(state, lang) {
    var out = {}, s = isObj(state) ? state : {};
    (Array.isArray(s.groups) ? s.groups : []).slice()
      .sort(function (a, b) { return a.n.localeCompare(b.n) || cmpStr(a.id, b.id); })
      .forEach(function (g, i) {
        out[(i < 9 ? "0" : "") + (i + 1) + "-" + fileSlug(g.n) + ".csv"] = groupCsv(s, g, lang);
      });
    return out;
  }

  var DESC = {
    app: "split", title: "Split", slice: "split", ext: ".orossplit", mime: "application/x-oros-split",
    colls: {
      groups: { shape: "array", id: "id", stamp: "m" },
      people: { shape: "array", id: "id", stamp: "m" },
      exp: { shape: "array", id: "id", stamp: "m" },
      pay: { shape: "array", id: "id", stamp: "m" },
      rec: { shape: "array", id: "id", stamp: "m" }
    },
    norm: norm, strip: strip, tombIds: tombIds, previews: previews
  };

  var api = { DESC: DESC, forLocal: forLocal, groupSlice: groupSlice, kindOf: kindOf, receiptsOf: receiptsOf,
              groupCsv: groupCsv, buildCsv: buildCsv, PH_RE: PH_RE, KEY_RE: KEY_RE,
              LIM: { groups: MAX_GROUPS, people: MAX_PEOPLE, entries: MAX_EXP, rules: MAX_RULES } };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrosSplitPackage = api;
})(typeof window !== "undefined" ? window : this);
