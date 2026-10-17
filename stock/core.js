// ============================================================
// orOS Stock — core.js (shared logic, v1.7.0; 1.7 adds the point of
// sale lists sales / pls / zs, see "Point of sale" below)
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
//   purchase orders (1.1): normPo, poSrc, poView(data, po), poViews,
//     onOrder(data), poNext(data, today)
//   reports (1.1): valueByCat(data), periodSummary(data, from, to),
//     deadStock(data, today, days), reportRange(key, today)
//   photos (1.2): normPic, picName, picPath, picOf(data, itemId), picsInUse
//   barcodes (1.2): eanCheck, ean13, code128, barcodeFor(item), barSvg
//   other apps (1.3): outRequest(data, req, today) (BR-ST-OUT),
//     srcUses(data, src), catalog(data)
//   warehouses (1.4): WH_MAIN, normWh, whName, whQty(data), qtyIn(data, w)
//   lots (1.5): LOT_LEN, lotsOf(data, itemId), allLots(data),
//     expiring(data, today, days), lotNames(data, itemId)
//   closing a period (1.6): normClose, closePeriod(data, d, nowMs, id),
//     openMove(data), OPEN_ID, closeInfo(data, d)
// Data (synced slice "stock", key oros-stock-data):
//   { ver: 1, items, cats, units, sups, pos, moves: [row…] each sorted
//     by id, settings: { m, cur, vat, neg }, tombs: { id: deletedAt } }
//   pos (1.1) is a top-level list: a 1.0 device drops it on its own
//   merge, which costs nothing (a pull never marks dirty, a 1.1
//   device keeps it). A receipt against an order is a normal "in"
//   movement with src "po:<order id>" (1.0 already carries src).
//   pics (1.2) is a top-level list too, one row per product photo
//   { id: itemId, m, f: file name | "" }: a separate list rather than a
//   field of the item, so a 1.0/1.1 device that edits the item can
//   never drop the photo (its own merge only drops the whole list).
//   whs (1.4): warehouses { id, m, name, arch }, LWW + tombs; the row
//   with id WH_MAIN only names the main warehouse. A movement may carry
//   w (its warehouse; none = main). Type "xfer" (transfer) moves its
//   positive line quantities from w to w2 and changes no total: a 1.3
//   device drops it (its totals stay right) and the union keeps it on
//   the others. A 1.3 device also strips w from the movements it
//   re-uploads, so a tie on m prefers the copy that carries w / w2.
//   lots (1.5): a line may carry lot (≤ 40 chars; not on count / fix /
//   xfer) and, on a receipt or a customer return, exp (YYYY-MM-DD).
//   What is left of each lot is derived (lotsOf): sales name a lot or
//   take the first to expire. Same tie rule: the copy with lots wins.
//   close (1.6): one object { id, m, d, at, bal, avg, ls, fs, rcv, ids }:
//   the books are closed through day d. The movements up to d were
//   archived (a JSON file in Files) and replaced by an opening balance
//   (bal lines per item / warehouse / lot, avg costs, last sale day ls,
//   first day fs, PO receipts rcv). ids lists the archived movement ids
//   for 90 days: a movement dated ≤ d that is NOT listed (typed on a
//   device that was offline, or backdated later) stays live and counts
//   on top of the opening. After 90 days the list goes and anything
//   dated ≤ d with m ≤ at is dropped. Merge keeps the close with the
//   latest d; a tombstone on its id reopens the period. A 1.5 device
//   doesn't know close: it keeps showing full history until updated.
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
      TEL_LEN = 40, EMAIL_LEN = 120, VATNO_LEN = 20, LOT_LEN = 40;
  var MAX_ITEMS = 20000, MAX_LIST = 2000, MAX_MOVES = 100000, MAX_LINES = 500;
  var TOMB_DAYS = 365;
  var Q_MAX = 1000000000000;      // thousandths: a billion units
  var C_MAX = 99999999999;        // cents: just under a billion
  var CURRENCIES = ["EUR", "USD", "GBP", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "RON", "BGN", "TRY", "CAD", "AUD", "JPY"];
  var VAT_RATES = [24, 13, 6, 0];

  // Ready units: language-free ids. dec = decimals shown and allowed
  // (a piece is whole, a kilo has grams).
  // Names: UNIT_NAMES (a { en, el } table of the "stock" pack, so a pack
  // language shows its own short names). Import reads the English and
  // Greek names back (unitWords in importPlan).
  var UNITS = {
    pcs:  { dec: 0 }, box:  { dec: 0 }, pack: { dec: 0 }, pair: { dec: 0 }, set: { dec: 0 },
    kg:   { dec: 3 }, g:    { dec: 0 }, l:    { dec: 3 }, ml:   { dec: 0 }, m:   { dec: 2 },
    m2:   { dec: 2 }
  };
  var UNIT_NAMES = {
    en: {
      "unit.pcs": "pcs", "unit.box": "box", "unit.pack": "pack", "unit.pair": "pair", "unit.set": "set",
      "unit.kg": "kg", "unit.g": "g", "unit.l": "L", "unit.ml": "mL", "unit.m": "m", "unit.m2": "m²"
    },
    el: {
      "unit.pcs": "τεμ.", "unit.box": "κιβ.", "unit.pack": "πακ.", "unit.pair": "ζεύγ.", "unit.set": "σετ",
      "unit.kg": "κιλά", "unit.g": "γρ.", "unit.l": "λίτρα", "unit.ml": "ml", "unit.m": "μέτρα", "unit.m2": "τ.μ."
    }
  };
  Object.keys(UNITS).forEach(function (u) { UNITS[u].n = [UNIT_NAMES.en["unit." + u], UNIT_NAMES.el["unit." + u]]; });
  var UNIT_IDS = Object.keys(UNITS);
  // lang: "en", "el" or a pack language (window.orosI18n, when loaded;
  // in the shell or in Node: English).
  function unitName(id, lang) {
    if (!UNITS[id]) return null;
    var tb = UNIT_NAMES[lang];
    if (!tb && typeof window !== "undefined" && window.orosI18n && lang) tb = window.orosI18n.table(UNIT_NAMES, "stock", lang);
    return (tb && tb["unit." + id]) || UNIT_NAMES.en["unit." + id];
  }

  // Movement types and the sign their lines must have:
  //   in   receive from a supplier (+, unit cost c)
  //   out  sale / issue (−, unit price p)
  //   ret  return from a customer (+)
  //   rts  return to a supplier (−)
  //   loss damage / loss / expiry (−)
  //   count stock count (difference, any sign or 0; n = counted)
  //   fix  correction (any sign, not 0)
  var MOVE_TYPES = ["in", "out", "ret", "rts", "loss", "count", "fix", "xfer"];
  var SIGN = { "in": 1, out: -1, ret: 1, rts: -1, loss: -1, count: 0, fix: 0, xfer: 1 };

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
    if (t !== "count" && t !== "fix" && t !== "xfer") {
      var lot = cleanText(l.lot, LOT_LEN, false);
      if (lot) out.lot = lot;
      if (lot && (t === "in" || t === "ret") && isYmd(l.exp)) out.exp = l.exp;
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
    var w = whRef(x.w), w2 = whRef(x.w2);
    if (x.t === "xfer") {
      if (w === w2) return null;            // a transfer goes somewhere else
      if (w2) out.w2 = w2;
    }
    if (w) out.w = w;
    if (x.v === 1) out.v = 1;
    return out;
  }
  // a warehouse reference: "" = the main warehouse
  function whRef(v) { var r = ref(v); return r === WH_MAIN ? "" : r; }
  function normSettings(x) {
    var s = x && typeof x === "object" ? x : {};
    return {
      m: isInt(s.m) && s.m >= 0 ? s.m : 0,
      cur: CURRENCIES.indexOf(s.cur) >= 0 ? s.cur : "EUR",
      vat: clampInt(s.vat, 0, 100) === null ? 24 : s.vat,
      neg: s.neg === 0 ? 0 : 1
    };
  }

  // Purchase order: what was ordered from a supplier. What arrived is
  // NOT stored here: it is the sum of the live "in" movements whose src
  // is "po:<id>" (so a receipt voided later un-receives by itself, and
  // two devices receiving parts at the same time both count).
  //   st: draft (being written) | sent | closed (nothing more is
  //   coming) | cancel. "partial" and "received" are derived.
  var PO_ST = ["draft", "sent", "closed", "cancel"];
  function normPo(x) {
    if (!base(x) || !isYmd(x.d) || !Array.isArray(x.lines)) return null;
    var lines = [], seen = dict();
    for (var i = 0; i < x.lines.length && lines.length < MAX_LINES; i++) {
      var l = x.lines[i];
      if (!l || typeof l !== "object" || typeof l.i !== "string" || !ID_RE.test(l.i) || seen[l.i]) continue;
      var q = clampInt(l.q, 1, Q_MAX);
      if (q === null) continue;
      seen[l.i] = true;
      var line = { i: l.i, q: q };
      if (clampInt(l.c, 0, C_MAX) !== null) line.c = l.c;
      lines.push(line);
    }
    if (!lines.length) return null;
    return {
      id: x.id, m: x.m, no: cleanText(x.no, REF_LEN, false), sup: ref(x.sup), d: x.d,
      exp: isYmd(x.exp) ? x.exp : "", st: PO_ST.indexOf(x.st) >= 0 ? x.st : "draft",
      note: cleanText(x.note, MNOTE_LEN, true), lines: lines
    };
  }

  // Product photo: the row's id IS the item id (one photo per item; a
  // tombstone of the item hides it too). f = the JPEG's file name on
  // the orOS disk, "" = removed (an LWW edit, no tombstone needed).
  var PHOTO_DIR = "/internal/Stock/Photos";
  var PIC_RE = /^\d{8}-[a-z0-9]{6,40}-[a-z0-9]{4,12}\.jpg$/;
  function normPic(x) {
    if (!base(x)) return null;
    return { id: x.id, m: x.m, f: typeof x.f === "string" && PIC_RE.test(x.f) ? x.f : "" };
  }

  // Warehouses (1.4). WH_MAIN's row only gives the main warehouse a
  // name (it can't be archived); movements never carry it as w.
  var WH_MAIN = "whmain";
  function normWh(x) {
    if (!base(x)) return null;
    var name = cleanText(x.name, NAME_LEN, false);
    if (!name) return null;
    return { id: x.id, m: x.m, name: name, arch: x.arch === 1 && x.id !== WH_MAIN ? 1 : 0 };
  }

  // ---------- Point of sale (1.7, wave 46) ----------
  // Three more top-level lists, written only when they have rows (so
  // data without a sale stays byte-identical, and a 1.6 device drops
  // them on its own merge without ever marking dirty, like pos/pics):
  //   sales  one row per receipt, never deleted (void wins, like a
  //          movement): { id, m, d, at, no, pay, pl?, given?, mv?, w?,
  //          v?, lines: [{ i, q, p, vat, n }] } — q thousandths, p net
  //          unit price in cents, vat %, n the name as printed. The
  //          stock comes off through its own "out" movement (id mv,
  //          src "pos:<sale id>"), so quantities keep their one rule.
  //   pls    price lists (LWW + tombs): { id, m, name, pct, p: { itemId:
  //          net cents } } — p overrides; else the sale price ± pct %.
  //          Retail (the products' own sale price) is built in.
  //   zs     closed days (Z reports, LWW): { id "z"+YYYYMMDD, m, d, at,
  //          no, n, g, net, vat, cash, card, other } — the totals as
  //          they were when the day was closed.
  var PAYS = ["cash", "card", "other"];
  var SALE_NO_LEN = 24, MAX_SALES = 50000, MAX_PLS = 50, MAX_ZS = 4000;
  var Z_RE = /^z\d{8}$/;
  function normSale(x) {
    if (!base(x) || !isYmd(x.d) || !Array.isArray(x.lines)) return null;
    var lines = [];
    for (var i = 0; i < x.lines.length && lines.length < MAX_LINES; i++) {
      var l = x.lines[i];
      if (!l || typeof l !== "object" || typeof l.i !== "string" || !ID_RE.test(l.i)) continue;
      var q = clampInt(l.q, 1, Q_MAX), p = clampInt(l.p, 0, C_MAX);
      if (q === null || p === null) continue;
      var vat = clampInt(l.vat, 0, 100);
      lines.push({ i: l.i, q: q, p: p, vat: vat === null ? 0 : vat, n: cleanText(l.n, NAME_LEN, false) });
    }
    if (!lines.length) return null;
    var out = {
      id: x.id, m: x.m, d: x.d, at: clampInt(x.at, 0, 4102444800000) || 0,
      no: cleanText(x.no, SALE_NO_LEN, false), pay: PAYS.indexOf(x.pay) >= 0 ? x.pay : "cash", lines: lines
    };
    if (ref(x.pl)) out.pl = x.pl;
    var given = clampInt(x.given, 1, C_MAX);
    if (given !== null) out.given = given;
    if (ref(x.mv)) out.mv = x.mv;
    var w = whRef(x.w);
    if (w) out.w = w;
    if (x.v === 1) out.v = 1;
    return out;
  }
  function normPl(x) {
    if (!base(x)) return null;
    var name = cleanText(x.name, NAME_LEN, false);
    if (!name) return null;
    var p = {}, src = x.p && typeof x.p === "object" && !Array.isArray(x.p) ? x.p : {};
    Object.keys(src).filter(function (k) { return ID_RE.test(k); }).sort(cmpStr).slice(0, MAX_ITEMS).forEach(function (k) {
      var c = clampInt(src[k], 0, C_MAX);
      if (c !== null) p[k] = c;
    });
    var pct = clampInt(x.pct, -90, 500);
    return { id: x.id, m: x.m, name: name, pct: pct === null ? 0 : pct, p: p };
  }
  function normZ(x) {
    if (!base(x) || !Z_RE.test(x.id) || !isYmd(x.d) || x.id !== "z" + x.d.replace(/-/g, "")) return null;
    function c(v) { var n = clampInt(v, -C_MAX, C_MAX); return n === null ? 0 : n; }
    return {
      id: x.id, m: x.m, d: x.d, at: clampInt(x.at, 0, 4102444800000) || 0, no: clampInt(x.no, 1, 1000000) || 1,
      n: clampInt(x.n, 0, MAX_SALES) || 0, g: c(x.g), net: c(x.net), vat: c(x.vat),
      cash: c(x.cash), card: c(x.card), other: c(x.other)
    };
  }
  // union by id; a void is final (the voided copy wins whatever its m)
  function mergeSales(la, lb) {
    var best = dict();
    [la, lb].forEach(function (list) {
      if (!Array.isArray(list)) return;
      list.forEach(function (raw) {
        var x = normSale(raw);
        if (!x) return;
        var cur = best[x.id];
        if (!cur) { best[x.id] = x; return; }
        if ((x.v === 1) !== (cur.v === 1)) { if (x.v === 1) best[x.id] = x; return; }
        lww(best, x);
      });
    });
    var ids = Object.keys(best).sort(cmpStr);
    if (ids.length > MAX_SALES) ids = ids.slice(ids.length - MAX_SALES);   // the newest stay
    return ids.map(function (id) { return best[id]; });
  }

  var LISTS = { items: normItem, cats: normCat, units: normUnit, sups: normSup, pos: normPo, pics: normPic, whs: normWh };
  var LIST_KEYS = ["items", "cats", "units", "sups", "pos", "pics", "whs"];

  function canon(v) { return JSON.stringify(v); }
  function lww(best, x) {
    var cur = best[x.id];
    if (!cur || x.m > cur.m || (x.m === cur.m && canon(x) > canon(cur))) best[x.id] = x;
  }
  // A void is final: the voided copy always wins, whatever its m.
  // knows more than a 1.3 / 1.4 copy of itself: a warehouse or lots
  function richer(x) {
    return !!(x.w || x.w2 || x.lines.some(function (l) { return l.lot || l.exp; }));
  }
  function moveWins(best, x) {
    var cur = best[x.id];
    if (!cur) { best[x.id] = x; return; }
    var xv = x.v === 1, cv = cur.v === 1;
    if (xv !== cv) { if (xv) best[x.id] = x; return; }
    // same m: the copy that knows its warehouse wins over one a 1.3
    // device stripped
    var xw = richer(x), cw = richer(cur);
    if (x.m === cur.m && xw !== cw) { if (xw) best[x.id] = x; return; }
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
    // the closed period (1.6): the latest close that is not tombstoned
    var close = null;
    [a.close, b.close].forEach(function (raw) {
      var c = normClose(raw);
      if (!c || (c.id in tombs && tombs[c.id] >= c.m)) return;
      if (!close || c.d > close.d || (c.d === close.d && (c.m > close.m || (c.m === close.m && canon(c) > canon(close))))) close = c;
    });
    if (close && close.ids && now - close.at > CLOSE_IDS_DAYS * DAY_MS) close.ids = "";
    var gone = null;
    if (close && close.ids) { gone = dict(); close.ids.split(",").forEach(function (id) { gone[id] = true; }); }
    function archived(x) {
      if (!close || x.d > close.d) return false;
      return gone ? !!gone[x.id] : x.m <= close.at;
    }
    // movements first: they decide which items must stay
    var bestM = dict();
    [a.moves, b.moves].forEach(function (list) {
      if (Array.isArray(list)) list.forEach(function (raw) { var x = normMove(raw); if (x && !archived(x)) moveWins(bestM, x); });
    });
    var moves = [], used = dict();
    Object.keys(bestM).sort(cmpStr).forEach(function (id) {
      if (moves.length >= MAX_MOVES) return;
      var x = bestM[id];
      moves.push(x);
      x.lines.forEach(function (l) { used[l.i] = true; });
      if (x.w) used[x.w] = true;
      if (x.w2) used[x.w2] = true;
    });
    if (close) close.bal.forEach(function (l) { used[l.i] = true; if (l.w) used[l.w] = true; });
    function pick(key, norm, cap) {
      var best = dict();
      [a[key], b[key]].forEach(function (list) {
        if (Array.isArray(list)) list.forEach(function (raw) { var x = norm(raw); if (x) lww(best, x); });
      });
      var out = [];
      Object.keys(best).sort(cmpStr).forEach(function (id) {
        var x = best[id];
        if (id in tombs && tombs[id] >= x.m && !((key === "items" || key === "whs") && used[id])) return;
        if (out.length >= cap) return;
        out.push(x);
      });
      return out;
    }
    var out = { ver: DATA_VER };
    LIST_KEYS.forEach(function (k) { out[k] = pick(k, LISTS[k], k === "items" ? MAX_ITEMS : MAX_LIST); });
    out.moves = moves;
    if (close) out.close = close;
    // point of sale (1.7): only when there is something
    var sales = mergeSales(a.sales, b.sales);
    if (sales.length) out.sales = sales;
    var pls = pick("pls", normPl, MAX_PLS);
    if (pls.length) out.pls = pls;
    var zs = pick("zs", normZ, MAX_ZS);
    if (zs.length) out.zs = zs;
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
  // live movements that change totals: a transfer only moves stock
  // between warehouses, so totals, costs and reports skip it
  function live(moves) { return (moves || []).filter(function (x) { return x.v !== 1 && x.t !== "xfer"; }); }
  function liveAll(moves) { return (moves || []).filter(function (x) { return x.v !== 1; }); }
  // Chronological order: day, then id (ids start with the creation
  // time), so every device walks the ledger the same way.
  function chrono(moves) {
    return live(moves).slice().sort(byTime);
  }
  // time order; the opening balance comes first, whatever its day: a
  // late movement dated inside the closed period counts on top of it
  function byTime(x, y) {
    return (x.t === "open" ? 0 : 1) - (y.t === "open" ? 0 : 1) || cmpStr(x.d, y.d) || cmpStr(x.id, y.id);
  }
  // the movements plus the opening balance of a closed period (1.6)
  function ledger(data) {
    var o = openMove(data), list = (data && data.moves) || [];
    return o ? [o].concat(list) : list;
  }
  function qtyMap(data) {
    var q = dict();
    live(ledger(data)).forEach(function (x) {
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
    // a closed period starts from its quantities and average costs
    var cl = data && data.close;
    if (cl) {
      cl.bal.forEach(function (l) { q[l.i] = (q[l.i] || 0) + l.q; });
      Object.keys(cl.avg).forEach(function (i) { avg[i] = cl.avg[i]; });
    }
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
    liveAll(ledger(data)).slice().sort(byTime).forEach(function (x) {
      x.lines.forEach(function (l) {
        if (l.i !== itemId) return;
        if (x.t !== "xfer") run += l.q;       // a transfer leaves the total
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
    var list = ledger(data);
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
  // mainLabel given (several warehouses): + [warehouse, to warehouse].
  // withLots: + [lot, expiry].
  function csvMoves(data, names, mainLabel, withLots) {
    var nm = names || {}, items = dict(), sups = dict();
    ((data && data.items) || []).forEach(function (x) { items[x.id] = x; });
    ((data && data.sups) || []).forEach(function (x) { sups[x.id] = x.name; });
    var rows = [];
    ((data && data.moves) || []).forEach(function (x) {
      x.lines.forEach(function (l) {
        var it = items[l.i] || { sku: "", name: "?" };
        var money = typeof l.c === "number" ? l.c / 100 : (typeof l.p === "number" ? l.p / 100 : null);
        var row = [x.d, has(nm, x.t) ? nm[x.t] : x.t, x.ref, sups[x.sup] || "", it.sku, it.name, l.q / 1000, money, x.note, x.v === 1 ? (nm.voided || "void") : ""];
        if (mainLabel) row.push(whName(data, x.w, mainLabel), x.t === "xfer" ? whName(data, x.w2, mainLabel) : "");
        if (withLots) row.push(l.lot || "", l.exp || "");
        row.push(x.id);
        rows.push(row);
      });
    });
    rows.sort(function (p, r) { return cmpStr(p[0], r[0]) || cmpStr(p[p.length - 1], r[r.length - 1]); });
    return rows.map(function (r) { return r.slice(0, r.length - 1); });
  }

  // ---------- Purchase orders ----------
  function poSrc(id) { return "po:" + id; }
  // What arrived per item for each order: { poId: { itemId: q } }
  function receivedMap(data) {
    var by = dict(), cl = data && data.close;
    if (cl) Object.keys(cl.rcv).forEach(function (po) {
      var r = by[po] = dict();
      Object.keys(cl.rcv[po]).forEach(function (i) { r[i] = cl.rcv[po][i]; });
    });
    live(data && data.moves).forEach(function (x) {
      if (x.t !== "in" || typeof x.src !== "string" || x.src.indexOf("po:") !== 0) return;
      var id = x.src.slice(3), r = by[id] || (by[id] = dict());
      x.lines.forEach(function (l) { r[l.i] = (r[l.i] || 0) + l.q; });
    });
    return by;
  }
  // { po, lines: [{ i, q, c?, got, left }], got (anything arrived),
  //   left (sum left), state: draft|sent|partial|received|closed|cancel,
  //   open (still expected: sent or partial), receipts: [move] }
  function poView(data, po, recv) {
    var r = (recv || receivedMap(data))[po.id] || dict(), any = false, left = 0;
    var lines = po.lines.map(function (l) {
      var got = r[l.i] || 0, rest = Math.max(0, l.q - got);
      if (got > 0) any = true;
      left += rest;
      var o = { i: l.i, q: l.q, got: got, left: rest };
      if (typeof l.c === "number") o.c = l.c;
      return o;
    });
    // an item received against the order but not on it still counts
    Object.keys(r).forEach(function (id) { if (r[id] > 0) any = true; });
    var st = po.st;
    if (st === "draft" || st === "sent") st = left === 0 ? "received" : (any ? "partial" : st);
    return { po: po, lines: lines, got: any, left: left, state: st, open: st === "sent" || st === "partial" };
  }
  // All orders, newest first (order date, then id).
  function poViews(data) {
    var recv = receivedMap(data);
    return ((data && data.pos) || []).map(function (p) { return poView(data, p, recv); })
      .sort(function (x, y) { return cmpStr(y.po.d, x.po.d) || cmpStr(y.po.id, x.po.id); });
  }
  // Still expected per item from open orders: { itemId: q }
  function onOrder(data) {
    var map = dict();
    poViews(data).forEach(function (v) {
      if (!v.open) return;
      v.lines.forEach(function (l) { if (l.left > 0) map[l.i] = (map[l.i] || 0) + l.left; });
    });
    return map;
  }
  // "PO-261012-3": the day plus the next free number of that day on
  // this device's copy (a clash with another device only looks odd).
  function poNext(data, today) {
    var day = isYmd(today) ? today : ymdOf(Date.now());
    var pre = "PO-" + day.slice(2, 4) + day.slice(5, 7) + day.slice(8, 10) + "-", n = 0;
    ((data && data.pos) || []).forEach(function (p) {
      if (p.no.indexOf(pre) !== 0) return;
      var k = parseInt(p.no.slice(pre.length), 10);
      if (isFinite(k) && k > n) n = k;
    });
    return pre + (n + 1);
  }

  // ---------- Photos ----------
  function picName(ymd, itemId, rnd) {
    var r = typeof rnd === "string" ? rnd.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12) : "";
    if (!isYmd(ymd) || typeof itemId !== "string" || !ID_RE.test(itemId) || r.length < 4) return null;
    return ymd.replace(/-/g, "") + "-" + itemId + "-" + r + ".jpg";
  }
  function picPath(name) { return typeof name === "string" && PIC_RE.test(name) ? PHOTO_DIR + "/" + name : null; }
  function picOf(data, itemId) {
    var list = (data && data.pics) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === itemId) return list[i].f;
    return "";
  }
  // Every file name some live product still points at
  function picsInUse(data) {
    var items = dict(), out = [];
    ((data && data.items) || []).forEach(function (it) { items[it.id] = true; });
    ((data && data.pics) || []).forEach(function (p) { if (p.f && items[p.id]) out.push(p.f); });
    return out;
  }

  // ---------- Barcodes (pure: module strings "1" bar / "0" space) ----------
  // EAN-13: the check digit of 12 digits
  function eanCheck(d12) {
    if (!/^\d{12}$/.test(d12)) return null;
    var sum = 0;
    for (var i = 0; i < 12; i++) sum += (+d12[i]) * (i % 2 ? 3 : 1);
    return String((10 - sum % 10) % 10);
  }
  var EAN_L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
  var EAN_G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"];
  var EAN_P = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];
  function ean13(code) {
    if (!/^\d{13}$/.test(code) || eanCheck(code.slice(0, 12)) !== code[12]) return null;
    var par = EAN_P[+code[0]], out = "101";
    for (var i = 1; i <= 6; i++) out += (par[i - 1] === "L" ? EAN_L : EAN_G)[+code[i]];
    out += "01010";
    for (var j = 7; j <= 12; j++) out += EAN_L[+code[j]].replace(/[01]/g, function (c) { return c === "0" ? "1" : "0"; });
    return out + "101";
  }
  // Code 128 (set B: printable ASCII 32–126), widths bar/space/…
  var C128 = ("212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 " +
    "221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 " +
    "221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 " +
    "212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 " +
    "231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 " +
    "231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 " +
    "314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 " +
    "112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 " +
    "111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 " +
    "214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 " +
    "114131 311141 411131 211412 211214 211232 2331112").split(" ");
  function code128(text) {
    var s = String(text || "");
    if (!s || s.length > 40) return null;
    var vals = [104];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 32 || c > 126) return null;
      vals.push(c - 32);
    }
    var sum = 104;
    for (var k = 1; k < vals.length; k++) sum += vals[k] * k;
    vals.push(sum % 103, 106);
    var out = "";
    vals.forEach(function (v) {
      var w = C128[v];
      for (var j = 0; j < w.length; j++) out += new Array(+w[j] + 1).join(j % 2 ? "0" : "1");
    });
    return out;
  }
  // The barcode a label prints for an item: its barcode as EAN-13 when
  // it is one (12 digits get their check digit), else Code 128 of the
  // barcode or the SKU. → { type, text, modules } | null
  function barcodeFor(item) {
    var bc = item && item.bc ? String(item.bc) : "", sku = item && item.sku ? String(item.sku) : "";
    if (/^\d{12}$/.test(bc)) bc += eanCheck(bc);
    if (/^\d{13}$/.test(bc) && ean13(bc)) return { type: "ean13", text: bc, modules: ean13(bc) };
    var src = bc || sku, m = code128(src);
    return m ? { type: "code128", text: src, modules: m } : null;
  }
  // An SVG of the bars (quiet zone of 10 modules each side), width in
  // modules; height h in the same units. Only rects: nothing from the
  // item's text goes into the markup.
  function barSvg(modules, h) {
    var q = 10, hh = h || 50, w = modules.length + 2 * q, rects = [], i = 0;
    while (i < modules.length) {
      if (modules[i] !== "1") { i++; continue; }
      var j = i;
      while (j < modules.length && modules[j] === "1") j++;
      rects.push('<rect x="' + (i + q) + '" y="0" width="' + (j - i) + '" height="' + hh + '"/>');
      i = j;
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + " " + hh + '" preserveAspectRatio="none" shape-rendering="crispEdges">' +
      '<rect width="' + w + '" height="' + hh + '" fill="#fff"/><g fill="#000">' + rects.join("") + "</g></svg>";
  }

  // ---------- Reports ----------
  // Period keys: "30" (last 30 days) | "month" | "year" | "all"
  function reportRange(key, today) {
    if (key === "month") return { from: today.slice(0, 8) + "01", to: today };
    if (key === "year") return { from: today.slice(0, 5) + "01-01", to: today };
    if (key === "all") return { from: "1900-01-01", to: "2200-12-31" };
    return { from: addDays(today, -29), to: today };
  }
  // Stock value per category (live items): { total, rows: [{ cat, value, n }] }
  // cat "" = no category; biggest value first.
  function valueByCat(data) {
    var cats = dict(), by = dict(), total = 0;
    ((data && data.cats) || []).forEach(function (c) { cats[c.id] = true; });
    stockRows(data).forEach(function (r) {
      if (r.item.arch) return;
      var k = cats[r.item.cat] ? r.item.cat : "";
      var row = by[k] || (by[k] = { cat: k, value: 0, n: 0 });
      row.value += r.value;
      row.n++;
      total += r.value;
    });
    var rows = Object.keys(by).map(function (k) { return by[k]; })
      .sort(function (x, y) { return y.value - x.value || cmpStr(x.cat, y.cat); });
    return { total: total, rows: rows };
  }
  // What moved between two days (inclusive), per item and in total.
  // Quantities are positive amounts; money in cents. sales = Σ q × p of
  // sales lines with a price; buys = Σ q × c of receipts with a cost;
  // lossValue = losses at the average cost of today.
  //   { rows: [{ i, inQ, outQ, retQ, rtsQ, lossQ, adj, sales, buys }]
  //     (most sold first), sales, buys, lossValue, moves }
  function periodSummary(data, from, to) {
    var by = dict(), totals = { sales: 0, buys: 0, lossValue: 0, moves: 0 };
    var avg = costMap(data);
    live(data && data.moves).forEach(function (x) {
      if (x.d < from || x.d > to) return;
      totals.moves++;
      x.lines.forEach(function (l) {
        var r = by[l.i] || (by[l.i] = { i: l.i, inQ: 0, outQ: 0, retQ: 0, rtsQ: 0, lossQ: 0, adj: 0, sales: 0, buys: 0 });
        var a = Math.abs(l.q);
        if (x.t === "in") {
          r.inQ += a;
          if (typeof l.c === "number") { var b = Math.round(a * l.c / 1000); r.buys += b; totals.buys += b; }
        } else if (x.t === "out") {
          r.outQ += a;
          if (typeof l.p === "number") { var s = Math.round(a * l.p / 1000); r.sales += s; totals.sales += s; }
        } else if (x.t === "ret") r.retQ += a;
        else if (x.t === "rts") r.rtsQ += a;
        else if (x.t === "loss") {
          r.lossQ += a;
          totals.lossValue += Math.round(a * (avg[l.i] || 0) / 1000);
        } else r.adj += l.q;
      });
    });
    var rows = Object.keys(by).map(function (k) { return by[k]; })
      .sort(function (x, y) { return y.outQ - x.outQ || y.sales - x.sales || cmpStr(x.i, y.i); });
    return { rows: rows, sales: totals.sales, buys: totals.buys, lossValue: totals.lossValue, moves: totals.moves };
  }
  // Dead stock: live items with stock that sold nothing (no sale, no
  // return to supplier, no loss) for `days` days or more. last = the
  // last such day or null (never). Biggest value first.
  function deadStock(data, today, days) {
    var n = days || 90, since = addDays(today, -(n - 1)), last = dict(), first = dict();
    var cl = data && data.close;
    if (cl) {
      Object.keys(cl.ls).forEach(function (i) { last[i] = cl.ls[i]; });
      Object.keys(cl.fs).forEach(function (i) { first[i] = cl.fs[i]; });
    }
    live(data && data.moves).forEach(function (x) {
      if (x.t !== "out" && x.t !== "rts" && x.t !== "loss") return;
      x.lines.forEach(function (l) { if (!last[l.i] || x.d > last[l.i]) last[l.i] = x.d; });
    });
    live(data && data.moves).forEach(function (x) {
      x.lines.forEach(function (l) { if (!first[l.i] || x.d < first[l.i]) first[l.i] = x.d; });
    });
    return stockRows(data).filter(function (r) {
      if (r.item.arch || r.q <= 0) return false;
      if (last[r.item.id] && last[r.item.id] >= since) return false;
      // stock that arrived inside the window is not "dead" yet
      return !first[r.item.id] || first[r.item.id] < since;
    }).map(function (r) { return { row: r, last: last[r.item.id] || null }; })
      .sort(function (x, y) { return y.row.value - x.row.value || cmpStr(x.row.item.id, y.row.item.id); });
  }

  // ---------- Prefs (device-local, oros-stock-prefs; the shell reads them too) ----------
  function readPrefs(raw) {
    var p = raw && typeof raw === "object" ? raw : {};
    return { notify: p.notify === false ? false : true };
  }

  // ---------- BR-ST-OUT (1.3): a sale asked for by another app ----------
  // Invoices (or any app) calls __orosOpenAt("stock", { out: req }):
  //   req = { ref?, src?: "invoices:<id>", d?: "YYYY-MM-DD",
  //           t?: "out" | "ret", lines: [{ code | sku, q, p? }] }
  //   q is a plain number of units (2.5), p the net unit price in cents.
  // Stock opens a PREFILLED movement; nothing is written until Save.
  // outRequest only reads and cleans: lines are matched to products by
  // SKU or barcode (findByCode), the same product twice is summed, and
  // what can't be matched comes back in miss. used = live movements that
  // already carry this src (the invoice was taken out of stock before).
  function outRequest(data, req, today) {
    if (!req || typeof req !== "object" || !Array.isArray(req.lines)) return null;
    var tt = req.t === "ret" ? "ret" : "out";
    var src = typeof req.src === "string" && SRC_RE.test(req.src) ? req.src : "";
    var d = isYmd(req.d) && dayNum(req.d) <= dayNum(addDays(today, 1)) ? req.d : today;
    var lines = [], at = dict(), miss = [];
    req.lines.slice(0, MAX_LINES).forEach(function (l) {
      if (!l || typeof l !== "object") return;
      var code = cleanText(typeof l.code === "string" && l.code ? l.code : l.sku, SKU_LEN, false);
      var q = typeof l.q === "number" && isFinite(l.q) ? Math.abs(l.q) : 0;
      if (!code) return;
      var it = findByCode(data, code);
      if (!it) { if (miss.indexOf(code) < 0 && miss.length < 50) miss.push(code); return; }
      var step = Math.pow(10, 3 - unitDec(data, it.unit));
      var qq = Math.round(q * 1000 / step) * step;
      if (!(qq > 0) || qq > Q_MAX) return;
      var p = typeof l.p === "number" && isFinite(l.p) && l.p >= 0 && l.p <= C_MAX ? Math.round(l.p) : null;
      if (at[it.id] !== undefined) {
        var o = lines[at[it.id]];
        o.q = Math.min(Q_MAX, o.q + qq);
        if (o.p !== undefined && p !== null && p !== o.p) delete o.p;    // two prices: let the person type it
        return;
      }
      var line = { i: it.id, q: qq };
      if (p !== null) line.p = p;
      at[it.id] = lines.length;
      lines.push(line);
    });
    return {
      t: tt, d: d, src: src, ref: cleanText(req.ref, REF_LEN, false),
      lines: lines, miss: miss, used: src ? srcUses(data, src) : 0
    };
  }
  function srcUses(data, src) {
    return liveAll(data && data.moves).filter(function (x) { return x.src === src; }).length;
  }
  // Read-only list for another app's product picker: live products with
  // their code (SKU, else barcode), prices, VAT and current quantity.
  function catalog(data) {
    return stockRows(data).filter(function (r) { return !r.item.arch; }).map(function (r) {
      var it = r.item;
      return {
        id: it.id, code: it.sku || it.bc, name: it.name, unit: it.unit,
        price: it.price, vat: it.vat, q: r.q / 1000
      };
    });
  }

  // ---------- Warehouses (1.4) ----------
  // { itemId: { warehouseId ("" = main): thousandths } }, transfers
  // included: −q where they leave, +q where they arrive.
  function whQty(data) {
    var q = dict();
    function add(i, w, n) { var r = q[i] || (q[i] = dict()); r[w] = (r[w] || 0) + n; }
    liveAll(ledger(data)).forEach(function (x) {
      var w = x.w || "";
      x.lines.forEach(function (l) {
        if (x.t === "xfer") { add(l.i, w, -l.q); add(l.i, x.w2 || "", l.q); }
        else add(l.i, x.t === "open" ? (l.w || "") : w, l.q);
      });
    });
    return q;
  }
  // { itemId: thousandths } in one warehouse ("" = main)
  function qtyIn(data, w) {
    var all = whQty(data), out = dict(), key = w || "";
    Object.keys(all).forEach(function (i) { if (all[i][key]) out[i] = all[i][key]; });
    return out;
  }
  function whName(data, w, mainLabel) {
    var id = w || WH_MAIN, list = (data && data.whs) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i].name;
    return w ? "?" : (mainLabel || "Main");
  }

  // ---------- Lots and expiry (1.5) ----------
  // What is left of each lot of one item, walking the ledger in time
  // order (transfers skipped: lots are business-wide). Incoming lines
  // with a lot fill it (its expiry = the earliest one given); incoming
  // lines without one are "none". Outgoing lines take from the lot they
  // name, then from the lots that expire first (no expiry last), then
  // from "none". → { lots: [{ lot, exp, q }] (q > 0, soonest first),
  // none: thousandths without a lot (may go below zero) }
  function cmpExp(x, y) {
    return (x.exp ? 0 : 1) - (y.exp ? 0 : 1) || cmpStr(x.exp, y.exp) || cmpStr(x.lot, y.lot);
  }
  function walkLots(data, only) {
    var by = dict();
    chrono(ledger(data)).forEach(function (x) {
      x.lines.forEach(function (l) {
        if (only && l.i !== only) return;
        var st = by[l.i] || (by[l.i] = { lots: dict(), none: 0 });
        // the opening balance's minus lines are what "none" owed
        if (x.t === "open" && l.q < 0) { st.none += l.q; return; }
        if (l.q > 0) {
          if (!l.lot) { st.none += l.q; return; }
          var r = st.lots[l.lot] || (st.lots[l.lot] = { lot: l.lot, exp: "", q: 0 });
          r.q += l.q;
          if (l.exp && (!r.exp || l.exp < r.exp)) r.exp = l.exp;
          return;
        }
        var need = -l.q;
        if (l.lot && st.lots[l.lot] && st.lots[l.lot].q > 0) {
          var a = Math.min(need, st.lots[l.lot].q);
          st.lots[l.lot].q -= a; need -= a;
        }
        if (need > 0) {
          Object.keys(st.lots).map(function (k) { return st.lots[k]; }).filter(function (r2) { return r2.q > 0; })
            .sort(cmpExp).forEach(function (r2) {
              if (need <= 0) return;
              var b = Math.min(need, r2.q);
              r2.q -= b; need -= b;
            });
        }
        st.none -= need;
      });
    });
    return by;
  }
  function lotsOut(st) {
    if (!st) return { lots: [], none: 0 };
    return {
      lots: Object.keys(st.lots).map(function (k) { return st.lots[k]; }).filter(function (r) { return r.q > 0; }).sort(cmpExp),
      none: st.none
    };
  }
  function lotsOf(data, itemId) { return lotsOut(walkLots(data, itemId)[itemId]); }
  function allLots(data) {
    var by = walkLots(data, null), out = dict();
    Object.keys(by).forEach(function (i) { out[i] = lotsOut(by[i]); });
    return out;
  }
  // Lots with stock left that expire on or before today + days (already
  // expired included), soonest first: [{ item, lot, exp, q }]. Archived
  // products are left out.
  function expiring(data, today, days) {
    var last = addDays(today, days || 0), all = allLots(data), out = [];
    ((data && data.items) || []).forEach(function (it) {
      if (it.arch || !all[it.id]) return;
      all[it.id].lots.forEach(function (r) {
        if (r.exp && r.exp <= last) out.push({ item: it, lot: r.lot, exp: r.exp, q: r.q });
      });
    });
    return out.sort(function (x, y) { return cmpStr(x.exp, y.exp) || cmpStr(fold(x.item.name), fold(y.item.name)) || cmpStr(x.lot, y.lot); });
  }
  // Every lot name this item ever had (newest first), for the editor
  function lotNames(data, itemId) {
    var seen = dict(), out = [];
    liveAll(ledger(data)).slice().sort(function (x, y) { return byTime(y, x); }).forEach(function (x) {
      x.lines.forEach(function (l) { if (l.i === itemId && l.lot && !seen[l.lot]) { seen[l.lot] = true; out.push(l.lot); } });
    });
    return out;
  }

  // ---------- Closing a period (1.6) ----------
  var CLOSE_IDS_DAYS = 90, OPEN_ID = "!open", IDS_RE = /^[a-z0-9]{6,40}(,[a-z0-9]{6,40})*$/;
  // the archive: a JSON file in Files, named by the close (f)
  var ARCHIVE_DIR = "/internal/Stock/Archive", ARCH_RE = /^stock-until-\d{4}-\d{2}-\d{2}-[a-z0-9]{4,12}\.json$/;
  function archivePath(f) { return ARCHIVE_DIR + "/" + f; }
  function normClose(x) {
    if (!base(x) || !isYmd(x.d) || !isInt(x.at) || x.at < 0) return null;
    var bal = [];
    (Array.isArray(x.bal) ? x.bal : []).slice(0, MAX_ITEMS * 4).forEach(function (l) {
      if (!l || typeof l !== "object" || !ID_RE.test(String(l.i))) return;
      var q = clampInt(l.q, -Q_MAX, Q_MAX);
      if (!q) return;
      var o = { i: l.i, q: q }, w = whRef(l.w);
      if (w) o.w = w;
      var lot = q > 0 ? cleanText(l.lot, LOT_LEN, false) : "";
      if (lot) { o.lot = lot; if (isYmd(l.exp)) o.exp = l.exp; }
      bal.push(o);
    });
    function idMap(v, ok) {
      var out = {};
      if (v && typeof v === "object") Object.keys(v).sort(cmpStr).forEach(function (k) { if (ID_RE.test(k) && ok(v[k])) out[k] = v[k]; });
      return out;
    }
    var avg = idMap(x.avg, function (n) { return typeof n === "number" && isFinite(n) && n >= 0 && n <= C_MAX; });
    Object.keys(avg).forEach(function (k) { avg[k] = Math.round(avg[k] * 10000) / 10000; });
    var rcv = {};
    if (x.rcv && typeof x.rcv === "object") Object.keys(x.rcv).sort(cmpStr).forEach(function (po) {
      if (!ID_RE.test(po)) return;
      var r = idMap(x.rcv[po], function (n) { return isInt(n) && n > 0 && n <= Q_MAX; });
      if (Object.keys(r).length) rcv[po] = r;
    });
    return {
      id: x.id, m: x.m, d: x.d, at: x.at, bal: bal, avg: avg,
      ls: idMap(x.ls, isYmd), fs: idMap(x.fs, isYmd), rcv: rcv,
      ids: typeof x.ids === "string" && x.ids.length <= 4000000 && IDS_RE.test(x.ids) ? x.ids : "",
      f: typeof x.f === "string" && ARCH_RE.test(x.f) ? x.f : ""
    };
  }
  // The opening balance as a read-only movement (never stored, never
  // voided): lines carry their own warehouse and lot.
  function openMove(data) {
    var cl = data && data.close;
    if (!cl || !cl.bal.length) return null;
    return { id: OPEN_ID, m: cl.m, d: cl.d, t: "open", ref: "", sup: "", note: "", lines: cl.bal };
  }
  // What closing through day d would do: { n: movements archived,
  // ok: d is before today and after the current close }
  function closeInfo(data, d, today) {
    var cl = data && data.close;
    var ok = isYmd(d) && d < today && (!cl || d > cl.d);
    var n = ((data && data.moves) || []).filter(function (x) { return x.d <= d; }).length;
    return { ok: ok, n: n };
  }
  // Close the books through day d. Pure: returns the new data (the
  // caller archives the old one first). The opening balance keeps, per
  // item, the quantity of each warehouse and what is left of each lot
  // (lots spread over the warehouses that hold stock), the average
  // cost, the last sale and first day, and what each order received.
  function closePeriod(data, d, nowMs, id, file) {
    if (!isYmd(d) || !ID_RE.test(String(id))) return null;
    var cl = data.close;
    if (cl && d <= cl.d) return null;
    var upTo = data.moves.filter(function (x) { return x.d <= d; });
    var sub = {}; Object.keys(data).forEach(function (k) { sub[k] = data[k]; });
    sub.moves = upTo;
    var whq = whQty(sub), lots = allLots(sub), avg = costMap(sub), rcvAll = receivedMap(sub);
    var ls = dict(), fs = dict();
    if (cl) {
      Object.keys(cl.ls).forEach(function (i) { ls[i] = cl.ls[i]; });
      Object.keys(cl.fs).forEach(function (i) { fs[i] = cl.fs[i]; });
    }
    live(upTo).forEach(function (x) {
      x.lines.forEach(function (l) {
        if ((x.t === "out" || x.t === "rts" || x.t === "loss") && (!ls[l.i] || x.d > ls[l.i])) ls[l.i] = x.d;
        if (!fs[l.i] || x.d < fs[l.i]) fs[l.i] = x.d;
      });
    });
    var bal = [], avgOut = {}, lsOut = {}, fsOut = {};
    Object.keys(whq).sort(cmpStr).forEach(function (i) {
      var per = whq[i], L = lots[i] || { lots: [], none: 0 };
      var ws = Object.keys(per).filter(function (w) { return per[w]; }).sort(cmpStr);
      if (!ws.length) return;
      // pool: the lots (soonest first), then stock without a lot
      var pool = L.lots.map(function (r) { return { lot: r.lot, exp: r.exp, q: r.q }; });
      if (L.none > 0) pool.push({ lot: "", exp: "", q: L.none });
      function take(w, need) {
        while (need > 0 && pool.length) {
          var c = pool[0], n = Math.min(need, c.q), o = { i: i, q: n };
          if (w) o.w = w;
          if (c.lot) { o.lot = c.lot; if (c.exp) o.exp = c.exp; }
          bal.push(o);
          c.q -= n; need -= n;
          if (!c.q) pool.shift();
        }
        return need;
      }
      ws.forEach(function (w) {
        if (per[w] <= 0) return;
        var rest = take(w, per[w]);
        if (rest > 0) { var o = { i: i, q: rest }; if (w) o.w = w; bal.push(o); }
      });
      ws.forEach(function (w) {
        if (per[w] >= 0) return;
        var o = { i: i, q: per[w] }; if (w) o.w = w; bal.push(o);
      });
      // lots left over (stock without a lot was below zero): in the
      // main warehouse, balanced by a minus line there
      var extra = pool.reduce(function (a, c) { return a + c.q; }, 0);
      if (extra > 0) { take("", extra); bal.push({ i: i, q: -extra }); }
    });
    // every average that isn't just the item's own purchase price
    (data.items || []).forEach(function (it) { if (typeof avg[it.id] === "number" && avg[it.id] !== it.cost) avgOut[it.id] = avg[it.id]; });
    Object.keys(ls).sort(cmpStr).forEach(function (i) { lsOut[i] = ls[i]; });
    Object.keys(fs).sort(cmpStr).forEach(function (i) { fsOut[i] = fs[i]; });
    var rcv = {};
    Object.keys(rcvAll).sort(cmpStr).forEach(function (po) { rcv[po] = rcvAll[po]; });
    var close = normClose({
      id: id, m: nowMs, d: d, at: nowMs, bal: bal, avg: avgOut, ls: lsOut, fs: fsOut, rcv: rcv,
      ids: upTo.map(function (x) { return x.id; }).sort(cmpStr).join(","), f: file || ""
    });
    var out = {}; Object.keys(data).forEach(function (k) { out[k] = data[k]; });
    out.moves = data.moves.filter(function (x) { return x.d > d; });
    out.close = close;
    return merge(out, out, nowMs);
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
    csvProducts: csvProducts, csvMoves: csvMoves, readPrefs: readPrefs,
    PO_ST: PO_ST, normPo: normPo, poSrc: poSrc, receivedMap: receivedMap, poView: poView,
    poViews: poViews, onOrder: onOrder, poNext: poNext,
    reportRange: reportRange, valueByCat: valueByCat, periodSummary: periodSummary, deadStock: deadStock,
    PHOTO_DIR: PHOTO_DIR, PIC_RE: PIC_RE, normPic: normPic, picName: picName, picPath: picPath, picOf: picOf, picsInUse: picsInUse,
    eanCheck: eanCheck, ean13: ean13, code128: code128, barcodeFor: barcodeFor, barSvg: barSvg,
    outRequest: outRequest, srcUses: srcUses, catalog: catalog,
    WH_MAIN: WH_MAIN, normWh: normWh, whName: whName, whQty: whQty, qtyIn: qtyIn,
    LOT_LEN: LOT_LEN, lotsOf: lotsOf, allLots: allLots, expiring: expiring, lotNames: lotNames,
    OPEN_ID: OPEN_ID, normClose: normClose, openMove: openMove, closeInfo: closeInfo, closePeriod: closePeriod,
    ARCHIVE_DIR: ARCHIVE_DIR, ARCH_RE: ARCH_RE, archivePath: archivePath,
    PAYS: PAYS, normSale: normSale, normPl: normPl, normZ: normZ, mergeSales: mergeSales
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosStockCore = api;
})(typeof window !== "undefined" ? window : this);
