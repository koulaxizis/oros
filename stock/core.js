// ============================================================
// orOS Stock — core.js (shared logic, v1.0.0)
// Business inventory: products with SKU / barcode, suppliers and a
// ledger of stock movements. One file holds the rules, so the app,
// the shell's low-stock check and the search provider can never
// disagree:
//   - the Stock app (stock/index.html)
//   - the shell (index.html → stockCheckTick, works while the app
//     is closed; wired in the release commit)
// Pure functions, no DOM, no network.
//
// THE RULE THAT MATTERS: a quantity is NEVER stored. It is the sum
// of the movement lines (receive, sell, return, loss, count, fix).
// Movements are only ever added (union by id) and at most voided,
// so two devices that sell at the same time never lose a movement
// (an LWW quantity would keep one of the two sales). A stock count
// stores the difference it found (counted − computed at that
// moment), so a sale on another device at the same time still
// counts.
//
// Units: quantities are integer thousandths (1 kg = 1000, 1 piece =
// 1000), money is integer cents, dates are local days "YYYY-MM-DD".
//
// API (window.OrosStockCore):
//   DATA_VER, ID_RE, UNITS, UNIT_IDS, MOVE_TYPES, CURRENCIES, limits
//   ymdOf, isYmd, dayNum, addDays, cleanText, parseNum(str, lang), fold
//   norm* (strict: invalid rows are dropped), merge(A, B, nowMs)
//   unitDec(data, unitId), qtyMap(data), costMap(data), stockRows(data)
//   lowList(data) · suggestQty(row) · outRate(data, itemId, today, days)
//   itemMoves(data, itemId) · findByCode(data, code) · hasMoves(data, id)
//   toNotify(lowIds, notified) → { fresh, next }
//   csvCell, parseCsv(text), importPlan(data, text, opts)
//   csvProducts(data, names) · csvMoves(data, names)
//   readPrefs(raw)
// Data (synced slice "stock", key oros-stock-data):
//   { ver: 1, items, cats, units, sups, moves: [row…] each sorted by
//     id, settings: { m, cur, vat, neg }, tombs: { id: deletedAt } }
// ============================================================
(function (root) {
  "use strict";

  var DATA_VER = 1;
  var ID_RE  = /^[a-z0-9]{6,40}$/;
  var YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  var SRC_RE = /^[a-z]{2,20}:[A-Za-z0-9._-]{1,60}$/;
  var DAY_MS = 86400000;
  var NAME_LEN = 80, SKU_LEN = 40, BC_LEN = 40, LOC_LEN = 60, REF_LEN = 60,
      NOTE_LEN = 500, MNOTE_LEN = 300, UNIT_LEN = 16, PERSON_LEN = 60,
      TEL_LEN = 40, EMAIL_LEN = 120, VATNO_LEN = 20;
  var MAX_ITEMS = 20000, MAX_LIST = 2000, MAX_MOVES = 100000, MAX_LINES = 500;
  var TOMB_DAYS = 365;
  var Q_MAX = 1000000000000;      // thousandths: a billion units
  var C_MAX = 99999999999;        // cents: just under a billion
  var CURRENCIES = ["EUR", "USD", "GBP", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "RON", "BGN", "TRY", "CAD", "AUD", "JPY"];
  var VAT_RATES = [24, 13, 6, 0];

  // Ready units: language-free ids. dec = decimals shown and allowed
  // (a piece is whole, a kilo has grams).
  var UNITS = {
    pcs:  { dec: 0, n: ["pcs", "τεμ."] },
    box:  { dec: 0, n: ["box", "κιβ."] },
    pack: { dec: 0, n: ["pack", "πακ."] },
    pair: { dec: 0, n: ["pair", "ζεύγ."] },
    set:  { dec: 0, n: ["set", "σετ"] },
    kg:   { dec: 3, n: ["kg", "κιλά"] },
    g:    { dec: 0, n: ["g", "γρ."] },
    l:    { dec: 3, n: ["L", "λίτρα"] },
    ml:   { dec: 0, n: ["mL", "ml"] },
    m:    { dec: 2, n: ["m", "μέτρα"] },
    m2:   { dec: 2, n: ["m²", "τ.μ."] }
  };
  var UNIT_IDS = Object.keys(UNITS);
  function unitName(id, lang) { var u = UNITS[id]; return u ? u.n[lang === "el" ? 1 : 0] : null; }

  // Movement types and the sign their lines must have:
  //   in   receive from a supplier (+, unit cost c)
  //   out  sale / issue (−, unit price p)
  //   ret  return from a customer (+)
  //   rts  return to a supplier (−)
  //   loss damage / loss / expiry (−)
  //   count stock count (difference, any sign or 0; n = counted)
  //   fix  correction (any sign, not 0)
  var MOVE_TYPES = ["in", "out", "ret", "rts", "loss", "count", "fix"];
  var SIGN = { "in": 1, out: -1, ret: 1, rts: -1, loss: -1, count: 0, fix: 0 };

  // ---------- Dates ----------
  function p2(n) { return (n < 10 ? "0" : "") + n; }
  function ymdOf(date) {
    var d = date instanceof Date ? date : new Date(date);
    return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate());
  }
  function isYmd(s) {
    if (typeof s !== "string") return false;
    var m = YMD_RE.exec(s);
    if (!m) return false;
    var y = +m[1], mo = +m[2], da = +m[3];
    if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || da < 1) return false;
    return da <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
  }
  function dayNum(ymd) {
    var m = YMD_RE.exec(ymd);
    return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY_MS);
  }
  function ymdFromDay(n) {
    var d = new Date(n * DAY_MS);
    return d.getUTCFullYear() + "-" + p2(d.getUTCMonth() + 1) + "-" + p2(d.getUTCDate());
  }
  function addDays(ymd, n) { return ymdFromDay(dayNum(ymd) + n); }

  // ---------- Helpers ----------
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function clampInt(v, lo, hi) { return isInt(v) && v >= lo && v <= hi ? v : null; }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  // maps keyed by ids or user text: no prototype ("constructor" is a valid id)
  function dict() { return Object.create(null); }
  function cleanText(s, max, multiline) {
    if (typeof s !== "string") return "";
    s = s.replace(multiline ? /[\u0000-\u0008\u000b-\u001f\u007f\u2028\u2029]/g : /[\u0000-\u001f\u007f\u2028\u2029]/g, multiline ? "" : " ");
    s = multiline ? s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim()
                  : s.replace(/\s+/g, " ").trim();
    return s.slice(0, max);
  }
  // Case, accents and final sigma folded: "Κωδικός" ≡ "κωδικοσ" ≡ "ΚΩΔΙΚΟΣ"
  function fold(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/ς/g, "σ").replace(/\s+/g, " ").trim();
  }

  // "1.234,5" · "1,234.5" · "42,3" · "42.3" · "1 234" → number, or
  // null. With both separators the LAST one is the decimal mark.
  // With only one kind: a comma is decimal; a dot is decimal too,
  // except in Greek where "1.234" (groups of exactly 3) is thousands.
  // (Same rules as Garage.)
  function parseNum(str, lang) {
    if (typeof str === "number") return isFinite(str) ? str : null;
    if (typeof str !== "string") return null;
    var s = str.replace(/[\s\u00a0\u202f']/g, "");
    if (!s) return null;
    if (!/^-?[0-9.,]+$/.test(s)) return null;
    var lc = s.lastIndexOf(","), ld = s.lastIndexOf(".");
    if (lc >= 0 && ld >= 0) {
      var dec = lc > ld ? "," : ".", grp = dec === "," ? "." : ",";
      s = s.split(grp).join("");
      if (s.indexOf(dec) !== s.lastIndexOf(dec)) return null;
      s = s.replace(dec, ".");
    } else if (lc >= 0) {
      if (s.indexOf(",") !== lc) {
        if (!/^-?\d{1,3}(,\d{3})+$/.test(s)) return null;
        s = s.split(",").join("");
      } else s = s.replace(",", ".");
    } else if (ld >= 0) {
      if (s.indexOf(".") !== ld || (lang === "el" && /^-?\d{1,3}(\.\d{3})+$/.test(s))) {
        if (!/^-?\d{1,3}(\.\d{3})+$/.test(s)) return null;
        s = s.split(".").join("");
      }
    }
    if (!/^-?\d*\.?\d+$/.test(s) && !/^-?\d+\.$/.test(s)) return null;
    var n = parseFloat(s);
    return isFinite(n) ? n : null;
  }

  // ---------- Normalizers (strict: invalid rows are DROPPED) ----------
  function base(x) {
    return x && typeof x === "object" && typeof x.id === "string" && ID_RE.test(x.id) &&
           isInt(x.m) && x.m >= 0;
  }
  function ref(v) { return typeof v === "string" && ID_RE.test(v) ? v : ""; }
  function qty0(v) { return clampInt(v, 0, Q_MAX) || 0; }

  function normItem(x) {
    if (!base(x)) return null;
    var name = cleanText(x.name, NAME_LEN, false);
    if (!name) return null;
    var unit = has(UNITS, x.unit) || ID_RE.test(String(x.unit || "")) ? String(x.unit) : "pcs";
    return {
      id: x.id, m: x.m, name: name,
      sku: cleanText(x.sku, SKU_LEN, false),
      bc: cleanText(x.bc, BC_LEN, false).replace(/\s+/g, ""),
      cat: ref(x.cat), unit: unit,
      min: qty0(x.min), rq: qty0(x.rq),
      sup: ref(x.sup), ssku: cleanText(x.ssku, SKU_LEN, false),
      cost: clampInt(x.cost, 0, C_MAX) || 0, price: clampInt(x.price, 0, C_MAX) || 0,
      vat: clampInt(x.vat, 0, 100) === null ? 24 : x.vat,
      loc: cleanText(x.loc, LOC_LEN, false), note: cleanText(x.note, NOTE_LEN, true),
      arch: x.arch === 1 ? 1 : 0
    };
  }
  function normCat(x) {
    if (!base(x)) return null;
    var name = cleanText(x.name, NAME_LEN, false);
    return name ? { id: x.id, m: x.m, name: name } : null;
  }
  function normUnit(x) {
    if (!base(x) || has(UNITS, x.id)) return null;
    var name = cleanText(x.name, UNIT_LEN, false);
    return name ? { id: x.id, m: x.m, name: name, dec: clampInt(x.dec, 0, 3) === null ? 0 : x.dec } : null;
  }
  function normSup(x) {
    if (!base(x)) return null;
    var name = cleanText(x.name, NAME_LEN, false);
    if (!name) return null;
    return {
      id: x.id, m: x.m, name: name,
      person: cleanText(x.person, PERSON_LEN, false), tel: cleanText(x.tel, TEL_LEN, false),
      email: cleanText(x.email, EMAIL_LEN, false), vatno: cleanText(x.vatno, VATNO_LEN, false),
      lead: clampInt(x.lead, 0, 365) || 0, note: cleanText(x.note, NOTE_LEN, true)
    };
  }
  // A line keeps the sign its movement type demands; a count line may
  // be 0 (nothing was missing) and carries n = the counted quantity.
  function normLine(l, t) {
    if (!l || typeof l !== "object" || typeof l.i !== "string" || !ID_RE.test(l.i)) return null;
    var q = clampInt(l.q, -Q_MAX, Q_MAX);
    if (q === null) return null;
    var s = SIGN[t];
    if (s === 1 && q <= 0) return null;
    if (s === -1 && q >= 0) return null;
    if (t === "fix" && q === 0) return null;
    var out = { i: l.i, q: q };
    if (t === "in" && clampInt(l.c, 0, C_MAX) !== null) out.c = l.c;
    if (t === "out" && clampInt(l.p, 0, C_MAX) !== null) out.p = l.p;
    if (t === "count") {
      if (clampInt(l.n, 0, Q_MAX) === null) return null;
      out.n = l.n;
    }
    return out;
  }
  function normMove(x) {
    if (!base(x) || MOVE_TYPES.indexOf(x.t) < 0 || !isYmd(x.d) || !Array.isArray(x.lines)) return null;
    var lines = [];
    for (var i = 0; i < x.lines.length && lines.length < MAX_LINES; i++) {
      var l = normLine(x.lines[i], x.t);
      if (l) lines.push(l);
    }
    if (!lines.length) return null;
    var out = {
      id: x.id, m: x.m, d: x.d, t: x.t,
      ref: cleanText(x.ref, REF_LEN, false),
      sup: x.t === "in" || x.t === "rts" ? ref(x.sup) : "",
      note: cleanText(x.note, MNOTE_LEN, true),
      lines: lines
    };
    if (typeof x.src === "string" && SRC_RE.test(x.src)) out.src = x.src;
    if (x.v === 1) out.v = 1;
    return out;
  }
  function normSettings(x) {
    var s = x && typeof x === "object" ? x : {};
    return {
      m: isInt(s.m) && s.m >= 0 ? s.m : 0,
      cur: CURRENCIES.indexOf(s.cur) >= 0 ? s.cur : "EUR",
      vat: clampInt(s.vat, 0, 100) === null ? 24 : s.vat,
      neg: s.neg === 0 ? 0 : 1
    };
  }

  var LISTS = { items: normItem, cats: normCat, units: normUnit, sups: normSup };
  var LIST_KEYS = ["items", "cats", "units", "sups"];

  function canon(v) { return JSON.stringify(v); }
  function lww(best, x) {
    var cur = best[x.id];
    if (!cur || x.m > cur.m || (x.m === cur.m && canon(x) > canon(cur))) best[x.id] = x;
  }
  // A void is final: the voided copy always wins, whatever its m.
  function moveWins(best, x) {
    var cur = best[x.id];
    if (!cur) { best[x.id] = x; return; }
    var xv = x.v === 1, cv = cur.v === 1;
    if (xv !== cv) { if (xv) best[x.id] = x; return; }
    lww(best, x);
  }

  // Symmetric, canonical merge (R5, R26). Items, categories, units and
  // suppliers: LWW per id; tombstones max-merged; a tombstone at or
  // after a row's m hides it, a newer edit resurrects (R17) — EXCEPT
  // an item that has movements: it never disappears (its history and
  // quantity must stay readable), so a delete on one device racing a
  // sale on another keeps the item. Movements: union by id, never
  // deleted, a void wins. Settings LWW by m. Tombstones expire after
  // a year (the same rule everywhere, so nothing returns with a pull).
  function merge(A, B, nowMs) {
    function own(o) {
      var r = {};
      if (o && typeof o === "object") Object.keys(o).forEach(function (k) { r[k] = o[k]; });
      return r;
    }
    var a = own(A), b = own(B);
    var now = isInt(nowMs) ? nowMs : Date.now();
    var tombs = dict();
    [a.tombs, b.tombs].forEach(function (tm) {
      if (!tm || typeof tm !== "object") return;
      Object.keys(tm).forEach(function (id) {
        if (!ID_RE.test(id) || !isInt(tm[id]) || tm[id] < 0) return;
        if (now - tm[id] > TOMB_DAYS * DAY_MS) return;
        if (!(id in tombs) || tm[id] > tombs[id]) tombs[id] = tm[id];
      });
    });
    // movements first: they decide which items must stay
    var bestM = dict();
    [a.moves, b.moves].forEach(function (list) {
      if (Array.isArray(list)) list.forEach(function (raw) { var x = normMove(raw); if (x) moveWins(bestM, x); });
    });
    var moves = [], used = dict();
    Object.keys(bestM).sort(cmpStr).forEach(function (id) {
      if (moves.length >= MAX_MOVES) return;
      var x = bestM[id];
      moves.push(x);
      x.lines.forEach(function (l) { used[l.i] = true; });
    });
    function pick(key, norm, cap) {
      var best = dict();
      [a[key], b[key]].forEach(function (list) {
        if (Array.isArray(list)) list.forEach(function (raw) { var x = norm(raw); if (x) lww(best, x); });
      });
      var out = [];
      Object.keys(best).sort(cmpStr).forEach(function (id) {
        var x = best[id];
        if (id in tombs && tombs[id] >= x.m && !(key === "items" && used[id])) return;
        if (out.length >= cap) return;
        out.push(x);
      });
      return out;
    }
    var out = { ver: DATA_VER };
    LIST_KEYS.forEach(function (k) { out[k] = pick(k, LISTS[k], k === "items" ? MAX_ITEMS : MAX_LIST); });
    out.moves = moves;
    var sa = normSettings(a.settings), sb = normSettings(b.settings);
    out.settings = sb.m > sa.m || (sb.m === sa.m && canon(sb) > canon(sa)) ? sb : sa;
    var sortedTombs = {};
    Object.keys(tombs).sort(cmpStr).forEach(function (id) { sortedTombs[id] = tombs[id]; });
    out.tombs = sortedTombs;
    return out;
  }

  // ---------- Stock math ----------
  function unitDec(data, unitId) {
    if (has(UNITS, unitId)) return UNITS[unitId].dec;
    var list = (data && data.units) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === unitId) return list[i].dec;
    return 0;
  }
  function live(moves) { return (moves || []).filter(function (x) { return x.v !== 1; }); }
  // Chronological order: day, then id (ids start with the creation
  // time), so every device walks the ledger the same way.
  function chrono(moves) {
    return live(moves).slice().sort(function (x, y) { return cmpStr(x.d, y.d) || cmpStr(x.id, y.id); });
  }
  function qtyMap(data) {
    var q = dict();
    live(data && data.moves).forEach(function (x) {
      x.lines.forEach(function (l) { q[l.i] = (q[l.i] || 0) + l.q; });
    });
    return q;
  }
  // Weighted average cost per unit (cents, may be fractional): walks
  // the ledger in time order; a receipt with a unit cost blends in,
  // anything else leaves the average. Stock that came in without a
  // cost (an opening count, a return) is valued at the item's own
  // purchase price until the first costed receipt blends with it.
  // With stock at or below zero the next receipt sets the average. No
  // receipt with a cost yet → the item's own purchase price.
  function costMap(data) {
    var q = dict(), avg = dict(), own = dict();
    ((data && data.items) || []).forEach(function (it) { own[it.id] = it.cost; });
    chrono(data && data.moves).forEach(function (x) {
      x.lines.forEach(function (l) {
        var before = q[l.i] || 0;
        if (x.t === "in" && typeof l.c === "number") {
          var prior = l.i in avg ? avg[l.i] : (own[l.i] || 0);
          if (before <= 0 || (!(l.i in avg) && !own[l.i])) avg[l.i] = l.c;
          else avg[l.i] = (before * prior + l.q * l.c) / (before + l.q);
        }
        q[l.i] = before + l.q;
      });
    });
    ((data && data.items) || []).forEach(function (it) { if (!(it.id in avg)) avg[it.id] = it.cost; });
    return avg;
  }
  // One row per item: { item, q, avg, value (cents, 0 when q ≤ 0),
  // low (min set and q ≤ min), out (q ≤ 0) }
  function stockRows(data) {
    var q = qtyMap(data), avg = costMap(data);
    return ((data && data.items) || []).map(function (it) {
      var qq = q[it.id] || 0, a = avg[it.id] || 0;
      return {
        item: it, q: qq, avg: a,
        value: qq > 0 ? Math.round(qq * a / 1000) : 0,
        low: it.min > 0 && qq <= it.min,
        out: qq <= 0
      };
    });
  }
  // How much to order: the item's reorder quantity, else enough to
  // reach twice the minimum; rounded UP to what the unit allows.
  function suggestQty(row, dec) {
    var it = row.item, need = it.rq > 0 ? it.rq : Math.max(2 * it.min - row.q, it.min);
    var step = Math.pow(10, 3 - Math.max(0, Math.min(3, dec || 0)));
    return Math.max(step, Math.ceil(need / step) * step);
  }
  // Live items below or at their minimum, grouped later by supplier.
  function lowList(data) {
    return stockRows(data).filter(function (r) { return !r.item.arch && r.low; })
      .sort(function (x, y) { return cmpStr(x.item.sup, y.item.sup) || cmpStr(fold(x.item.name), fold(y.item.name)) || cmpStr(x.item.id, y.item.id); });
  }
  // Units leaving per day over the last `days` days (sales, returns to
  // supplier and losses; counts and fixes do not count): thousandths/day.
  function outRate(data, itemId, today, days) {
    var n = days || 30, from = addDays(today, -(n - 1)), sum = 0;
    live(data && data.moves).forEach(function (x) {
      if (x.d < from || x.d > today || (x.t !== "out" && x.t !== "rts" && x.t !== "loss")) return;
      x.lines.forEach(function (l) { if (l.i === itemId) sum -= l.q; });
    });
    return sum / n;
  }
  // Every movement of one item, newest first: { move, line, after }
  // where after = the quantity right after it (voided ones: null).
  function itemMoves(data, itemId) {
    var run = 0, out = [];
    chrono(data && data.moves).forEach(function (x) {
      x.lines.forEach(function (l) {
        if (l.i !== itemId) return;
        run += l.q;
        out.push({ move: x, line: l, after: run });
      });
    });
    ((data && data.moves) || []).forEach(function (x) {
      if (x.v !== 1) return;
      x.lines.forEach(function (l) { if (l.i === itemId) out.push({ move: x, line: l, after: null }); });
    });
    out.sort(function (p, r) { return cmpStr(r.move.d, p.move.d) || cmpStr(r.move.id, p.move.id); });
    return out;
  }
  function hasMoves(data, itemId) {
    var list = (data && data.moves) || [];
    for (var i = 0; i < list.length; i++) {
      for (var j = 0; j < list[i].lines.length; j++) if (list[i].lines[j].i === itemId) return true;
    }
    return false;
  }
  // A scanned or typed code: exact SKU or barcode, case-insensitive,
  // live items before archived ones. null when none or not one.
  function findByCode(data, code) {
    var c = fold(code).replace(/\s+/g, "");
    if (!c) return null;
    var hits = ((data && data.items) || []).filter(function (it) {
      return (it.sku && fold(it.sku).replace(/\s+/g, "") === c) || (it.bc && fold(it.bc) === c);
    });
    var liveHits = hits.filter(function (it) { return !it.arch; });
    var pool = liveHits.length ? liveHits : hits;
    return pool.length === 1 ? pool[0] : null;
  }
  // Low-stock notice: an item is announced once when it ENTERS the
  // low list; it is announced again only after it left it. notified
  // is device-local { itemId: 1 }.
  function toNotify(lowIds, notified) {
    var n = notified && typeof notified === "object" ? notified : {};
    var next = dict(), fresh = [];
    lowIds.forEach(function (id) {
      next[id] = 1;
      if (!has(n, id)) fresh.push(id);
    });
    return { fresh: fresh, next: next };
  }

  // ---------- CSV ----------
  // A cell can never start a formula in a spreadsheet (= + - @ tab
  // CR): such text gets a leading apostrophe. Numbers pass as is.
  function csvCell(v) {
    if (v === null || v === undefined) return "";
    if (typeof v === "number") return String(v);
    var s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",;\t\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  // RFC 4180 with the separator guessed from the first line (, ; tab).
  // Returns { sep, rows } — rows of strings, empty lines dropped.
  function parseCsv(text) {
    var s = String(text || "").replace(/^\ufeff/, "");
    var first = s.split(/\r?\n/)[0] || "", cnt = { ",": 0, ";": 0, "\t": 0 }, inQ = false;
    for (var k = 0; k < first.length; k++) {
      var ch0 = first[k];
      if (ch0 === '"') inQ = !inQ;
      else if (!inQ && has(cnt, ch0)) cnt[ch0]++;
    }
    var sep = cnt[";"] > cnt[","] && cnt[";"] >= cnt["\t"] ? ";" : (cnt["\t"] > cnt[","] ? "\t" : ",");
    var rows = [], row = [], cell = "", q = false;
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (q) {
        if (ch === '"') {
          if (s[i + 1] === '"') { cell += '"'; i++; } else q = false;
        } else cell += ch;
      } else if (ch === '"' && cell === "") q = true;
      else if (ch === sep) { row.push(cell); cell = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && s[i + 1] === "\n") i++;
        row.push(cell); cell = "";
        if (row.some(function (c) { return c.trim() !== ""; })) rows.push(row);
        row = [];
      } else cell += ch;
    }
    row.push(cell);
    if (row.some(function (c) { return c.trim() !== ""; })) rows.push(row);
    return { sep: sep, rows: rows };
  }

  // Column names this app writes, plus WooCommerce's product export
  // (English and Greek) and common spreadsheet words. Matched folded,
  // with any "(…)" removed ("Cost (EUR)" → "cost").
  var HEAD = {
    sku: ["sku", "κωδικοσ", "κωδικοσ sku", "code", "item code", "κωδ"],
    name: ["name", "ονομα", "product", "product name", "προιον", "ειδοσ", "item"],
    bc: ["barcode", "ean", "gtin", "upc", "gtin, upc, ean, or isbn", "gtin, upc, ean η isbn", "γραμμωτοσ κωδικασ"],
    cat: ["category", "categories", "κατηγορια", "κατηγοριεσ"],
    unit: ["unit", "μοναδα", "μ.μ", "μμ"],
    qty: ["quantity", "stock", "qty", "on hand", "ποσοτητα", "αποθεμα"],
    min: ["min", "minimum", "low stock amount", "reorder point", "ελαχιστο", "οριο", "ποσοτητα χαμηλου αποθεματοσ"],
    rq: ["reorder qty", "reorder quantity", "ποσοτητα παραγγελιασ"],
    sup: ["supplier", "vendor", "προμηθευτησ"],
    ssku: ["supplier code", "κωδικοσ προμηθευτη"],
    cost: ["cost", "unit cost", "purchase price", "κοστοσ", "τιμη αγορασ"],
    price: ["price", "regular price", "sale price per unit", "τιμη", "τιμη πωλησησ", "κανονικη τιμη"],
    vat: ["vat", "vat %", "tax", "φπα", "φπα %"],
    loc: ["location", "bin", "θεση"],
    note: ["note", "notes", "σημειωση", "σημειωσεισ"],
    type: ["type", "τυποσ"]
  };
  function headKey(h) {
    var f = fold(String(h).replace(/\([^)]*\)/g, "")).replace(/[^a-z0-9α-ω%,. ]+/g, " ").replace(/\s+/g, " ").trim();
    var keys = Object.keys(HEAD);
    for (var i = 0; i < keys.length; i++) if (HEAD[keys[i]].indexOf(f) >= 0) return keys[i];
    return null;
  }
  // WooCommerce "Clothing > Hoodies, Accessories" → "Hoodies"
  function firstCategory(s) {
    var str = String(s || ""), first = "";
    for (var i = 0; i < str.length; i++) {
      if (str[i] === "\\" && str[i + 1] === ",") { first += ","; i++; }
      else if (str[i] === ",") break;
      else first += str[i];
    }
    var parts = first.split(">");
    return cleanText(parts[parts.length - 1], NAME_LEN, false);
  }

  // Products from a CSV, as a plan the app applies (nothing is written
  // here). opts: { lang, newId(), now (ms), today (ymd), setQty (bool),
  // unitNames {id: [en, el]} optional }.
  // Rows match existing items by SKU (folded), else by name (folded).
  // Columns present and non-empty overwrite; absent ones keep the
  // item's value. Categories, suppliers and units are found by name or
  // created. With setQty and a quantity column, ONE stock count
  // movement (ref "CSV") brings each item to the file's quantity.
  // WooCommerce parent rows (variable / grouped / external) are
  // skipped: their variations carry the stock.
  function importPlan(data, text, opts) {
    var o = opts || {}, P = parseCsv(text), rows = P.rows;
    var res = { items: [], cats: [], sups: [], units: [], move: null,
                stats: { added: 0, updated: 0, same: 0, skipped: 0, qty: 0 }, ok: false };
    if (rows.length < 2) return res;
    var cols = {};
    rows[0].forEach(function (h, i) { var k = headKey(h); if (k && !(k in cols)) cols[k] = i; });
    if (!("name" in cols) && !("sku" in cols)) return res;
    res.ok = true;
    var numLang = P.sep === ";" ? "el" : "en";
    var now = isInt(o.now) ? o.now : Date.now();
    var items = (data && data.items) || [];
    var bySku = dict(), byName = dict();
    items.forEach(function (it) {
      if (it.sku) bySku[fold(it.sku)] = it;
      if (!byName[fold(it.name)]) byName[fold(it.name)] = it;
    });
    function finder(list, made) {
      var map = dict();
      ((data && data[list]) || []).forEach(function (x) { map[fold(x.name)] = x.id; });
      return function (name, extra) {
        var n = cleanText(name, list === "units" ? UNIT_LEN : NAME_LEN, false);
        if (!n) return "";
        var f = fold(n);
        if (map[f]) return map[f];
        var row = Object.assign({ id: o.newId(), m: now, name: n }, extra || {});
        map[f] = row.id;
        made.push(row);
        return row.id;
      };
    }
    var catId = finder("cats", res.cats), supId = finder("sups", res.sups), unitIdOf = finder("units", res.units);
    var unitWords = dict();
    UNIT_IDS.forEach(function (u) { UNITS[u].n.forEach(function (w) { unitWords[fold(w).replace(/\.$/, "")] = u; }); unitWords[u] = u; });
    function cell(r, k) { return k in cols ? String(r[cols[k]] === undefined ? "" : r[cols[k]]).trim() : ""; }
    function num(r, k) { var c = cell(r, k); return c === "" ? null : parseNum(c, numLang); }
    function qtyIn(dec) {
      return function (val) { return val === null || val < 0 ? null : Math.min(Q_MAX, Math.round(val * Math.pow(10, dec)) * Math.pow(10, 3 - dec)); };
    }
    function cn(val) { return val === null || val < 0 ? null : Math.min(C_MAX, Math.round(val * 100)); }
    var q = qtyMap(data), lines = [], seen = dict();
    for (var ri = 1; ri < rows.length; ri++) {
      var r = rows[ri];
      var typ = fold(cell(r, "type"));
      if (/^(variable|grouped|external|μεταβλητο|ομαδοποιημενο|εξωτερικο)/.test(typ)) { res.stats.skipped++; continue; }
      var name = cleanText(cell(r, "name"), NAME_LEN, false), sku = cleanText(cell(r, "sku"), SKU_LEN, false);
      if (!name && !sku) { res.stats.skipped++; continue; }
      var key = sku ? "s:" + fold(sku) : "n:" + fold(name);
      if (seen[key]) { res.stats.skipped++; continue; }
      seen[key] = true;
      var cur = (sku && bySku[fold(sku)]) || (name && byName[fold(name)]) || null;
      if (!cur && !name) { res.stats.skipped++; continue; }
      var row = cur ? JSON.parse(JSON.stringify(cur)) : normItem({ id: o.newId(), m: now, name: name, vat: (data && data.settings && data.settings.vat) });
      if (name) row.name = name;
      if (sku) row.sku = sku;
      var bc = cleanText(cell(r, "bc"), BC_LEN, false).replace(/\s+/g, "");
      if (bc) row.bc = bc;
      if (cell(r, "cat")) row.cat = catId(firstCategory(cell(r, "cat")));
      if (cell(r, "sup")) row.sup = supId(cell(r, "sup"));
      if (cell(r, "ssku")) row.ssku = cleanText(cell(r, "ssku"), SKU_LEN, false);
      if (cell(r, "loc")) row.loc = cleanText(cell(r, "loc"), LOC_LEN, false);
      if (cell(r, "note")) row.note = cleanText(cell(r, "note"), NOTE_LEN, true);
      var uw = fold(cell(r, "unit")).replace(/\.$/, "");
      if (uw) row.unit = unitWords[uw] || unitIdOf(cell(r, "unit"), { dec: 0 });
      var dec = has(UNITS, row.unit) ? UNITS[row.unit].dec : 3;
      var qn = qtyIn(dec), v;
      if ((v = qn(num(r, "min"))) !== null) row.min = v;
      if ((v = qn(num(r, "rq"))) !== null) row.rq = v;
      if ((v = cn(num(r, "cost"))) !== null) row.cost = v;
      if ((v = cn(num(r, "price"))) !== null) row.price = v;
      var vat = num(r, "vat");
      if (vat !== null && vat >= 0 && vat <= 100) row.vat = Math.round(vat);
      var clean = normItem(row);
      if (!clean) { res.stats.skipped++; continue; }
      if (!cur) { clean.m = now; res.items.push(clean); res.stats.added++; }
      else {
        clean.m = cur.m;
        if (canon(clean) === canon(cur)) res.stats.same++;
        else { clean.m = Math.max(now, cur.m + 1); res.items.push(clean); res.stats.updated++; }
      }
      if (o.setQty && "qty" in cols) {
        var target = qn(num(r, "qty"));
        if (target !== null) {
          var delta = target - (q[clean.id] || 0);
          if (delta !== 0) { lines.push({ i: clean.id, q: delta, n: target }); res.stats.qty++; }
        }
      }
    }
    if (lines.length) {
      res.move = { id: o.newId(), m: now, d: isYmd(o.today) ? o.today : ymdOf(now), t: "count", ref: "CSV", sup: "", note: "", lines: lines.slice(0, MAX_LINES) };
    }
    return res;
  }

  // Products: [sku, name, barcode, category, unit, qty, min, reorder,
  // supplier, supplier code, cost, price, vat, location, value, note]
  // (money in currency units, quantities in units). names: { unit id →
  // label } for ready units.
  function csvProducts(data, names) {
    var nm = names || {}, cats = dict(), sups = dict(), units = dict();
    ((data && data.cats) || []).forEach(function (x) { cats[x.id] = x.name; });
    ((data && data.sups) || []).forEach(function (x) { sups[x.id] = x.name; });
    ((data && data.units) || []).forEach(function (x) { units[x.id] = x.name; });
    return stockRows(data).filter(function (r) { return !r.item.arch; }).map(function (r) {
      var it = r.item;
      return [it.sku, it.name, it.bc, cats[it.cat] || "", has(nm, it.unit) ? nm[it.unit] : (units[it.unit] || ""),
              r.q / 1000, it.min / 1000, it.rq / 1000, sups[it.sup] || "", it.ssku,
              it.cost / 100, it.price / 100, it.vat, it.loc, r.value / 100, it.note];
    }).sort(function (x, y) { return cmpStr(fold(x[1]), fold(y[1])) || cmpStr(String(x[0]), String(y[0])); });
  }
  // Movements, one row per line: [date, type, ref, supplier, sku, name,
  // qty, unit cost / price, note, voided] — types by names[type].
  function csvMoves(data, names) {
    var nm = names || {}, items = dict(), sups = dict();
    ((data && data.items) || []).forEach(function (x) { items[x.id] = x; });
    ((data && data.sups) || []).forEach(function (x) { sups[x.id] = x.name; });
    var rows = [];
    ((data && data.moves) || []).forEach(function (x) {
      x.lines.forEach(function (l) {
        var it = items[l.i] || { sku: "", name: "?" };
        var money = typeof l.c === "number" ? l.c / 100 : (typeof l.p === "number" ? l.p / 100 : null);
        rows.push([x.d, has(nm, x.t) ? nm[x.t] : x.t, x.ref, sups[x.sup] || "", it.sku, it.name, l.q / 1000, money, x.note, x.v === 1 ? (nm.voided || "void") : "", x.id]);
      });
    });
    rows.sort(function (p, r) { return cmpStr(p[0], r[0]) || cmpStr(p[10], r[10]); });
    return rows.map(function (r) { return r.slice(0, 10); });
  }

  // ---------- Prefs (device-local, oros-stock-prefs; the shell reads them too) ----------
  function readPrefs(raw) {
    var p = raw && typeof raw === "object" ? raw : {};
    return { notify: p.notify === false ? false : true };
  }

  var api = {
    DATA_VER: DATA_VER, ID_RE: ID_RE, UNITS: UNITS, UNIT_IDS: UNIT_IDS, unitName: unitName,
    MOVE_TYPES: MOVE_TYPES, SIGN: SIGN, CURRENCIES: CURRENCIES, VAT_RATES: VAT_RATES, LIST_KEYS: LIST_KEYS,
    NAME_LEN: NAME_LEN, SKU_LEN: SKU_LEN, BC_LEN: BC_LEN, LOC_LEN: LOC_LEN, REF_LEN: REF_LEN,
    NOTE_LEN: NOTE_LEN, MNOTE_LEN: MNOTE_LEN, UNIT_LEN: UNIT_LEN, PERSON_LEN: PERSON_LEN,
    TEL_LEN: TEL_LEN, EMAIL_LEN: EMAIL_LEN, VATNO_LEN: VATNO_LEN,
    MAX_ITEMS: MAX_ITEMS, MAX_MOVES: MAX_MOVES, MAX_LINES: MAX_LINES, Q_MAX: Q_MAX, C_MAX: C_MAX, TOMB_DAYS: TOMB_DAYS,
    ymdOf: ymdOf, isYmd: isYmd, dayNum: dayNum, addDays: addDays,
    cleanText: cleanText, parseNum: parseNum, fold: fold,
    normItem: normItem, normCat: normCat, normUnit: normUnit, normSup: normSup,
    normMove: normMove, normSettings: normSettings, merge: merge,
    unitDec: unitDec, qtyMap: qtyMap, costMap: costMap, stockRows: stockRows,
    suggestQty: suggestQty, lowList: lowList, outRate: outRate, itemMoves: itemMoves,
    hasMoves: hasMoves, findByCode: findByCode, toNotify: toNotify,
    csvCell: csvCell, parseCsv: parseCsv, headKey: headKey, importPlan: importPlan,
    csvProducts: csvProducts, csvMoves: csvMoves, readPrefs: readPrefs
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosStockCore = api;
})(typeof window !== "undefined" ? window : this);
