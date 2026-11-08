// ============================================================
// orOS Quote — shared core (v1.3.0)
// Which quotes need a follow-up, one copy for the shell's due
// reminder (shell.js quoteCheckTick) and the Today summary
// (quote/today.js). Pure: no DOM, no storage, never writes.
//   dueQuotes(data, untilYmd) → the quotes that are "sent" or
//     "accepted" and have a due date on or before untilYmd, earliest
//     first (ties by id). Drafts, rejected and expired quotes, and
//     quotes without a due date, never count.
//   clientName(data, q)       → the client's name or "".
//   total(q)                  → the quote's total with VAT, the same
//     sum as quote.js calcTotals (line discount, global discount, VAT).
//   forClient(data, who)      → BR-CRM-Q (CRM Lite, read-only): the
//     quotes of one customer, who = { name, afm }. A quote belongs to
//     it when its client's tax id equals afm (spaces ignored) or its
//     client's name equals name (case and accents ignored). Deleted
//     quotes never count. Newest date first (ties by num, then id).
//     → [{ id, num, date, due, status, cur, total }]
// Currencies (1.2, wave 46): any ISO 4217 code.
//   curOk(c)                  → c is three capital letters.
//   currencyList()            → common codes first, then the rest the
//     browser knows (Intl.supportedValuesOf), no duplicates.
//   fmtMoney(n, cur, lang, codeOnly) → the amount in that currency with
//     its own decimals (codeOnly: the ISO code instead of a symbol).
//   curDigits(cur)            → the currency's minor digits (JPY 0).
//   convert(amount, rate, to) → amount × rate rounded to the digits of
//     to (display only; the quote keeps its own currency).
// Exposes window.OrosQuoteCore and, under Node, module.exports.
// ============================================================
(function (root) {
  "use strict";

  var YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

  function dueQuotes(data, untilYmd) {
    if (!data || typeof data !== "object" || !Array.isArray(data.quotes)) return [];
    return data.quotes.filter(function (q) {
      return q && typeof q === "object" && typeof q.id === "string" && q.id &&
             (q.status === "sent" || q.status === "accepted") &&
             typeof q.dueDate === "string" && YMD_RE.test(q.dueDate) && q.dueDate <= untilYmd;
    }).sort(function (a, b) {
      return a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    });
  }

  function clientName(data, q) {
    if (!q || !q.clientId || !data || !Array.isArray(data.clients)) return "";
    for (var i = 0; i < data.clients.length; i++) {
      var c = data.clients[i];
      if (c && c.id === q.clientId) return typeof c.name === "string" ? c.name : "";
    }
    return "";
  }

  function r2(n) { return Math.round(n * 100) / 100; }
  function num(v) { return typeof v === "number" && isFinite(v) ? v : 0; }
  function total(q) {
    var sub = 0, vat = 0, g = num(q && q.gDisc);
    ((q && q.items) || []).forEach(function (it) {
      if (!it || typeof it !== "object") return;
      var line = num(it.qty) * num(it.price) * (1 - num(it.disc) / 100);
      sub += line;
      vat += line * (1 - g / 100) * (num(it.vat) / 100);
    });
    return r2(r2(r2(sub) * (1 - g / 100)) + r2(vat));
  }
  function fold(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
  }
  function forClient(data, who) {
    if (!data || typeof data !== "object" || !Array.isArray(data.quotes) || !who) return [];
    var name = fold(who.name), afm = String(who.afm || "").replace(/\s+/g, "");
    if (!name && !afm) return [];
    var mine = {};
    (Array.isArray(data.clients) ? data.clients : []).forEach(function (c) {
      if (!c || typeof c !== "object" || typeof c.id !== "string") return;
      var tax = String(c.taxId || "").replace(/\s+/g, "");
      if ((afm && tax && tax === afm) || (name && fold(c.name) === name)) mine[c.id] = true;
    });
    var gone = data.deleted && typeof data.deleted === "object" ? data.deleted : {};
    return data.quotes.filter(function (q) {
      return q && typeof q === "object" && typeof q.id === "string" && q.id && !gone[q.id] && mine[q.clientId];
    }).map(function (q) {
      return { id: q.id, num: String(q.num || ""), date: YMD_RE.test(q.date || "") ? q.date : "",
               due: YMD_RE.test(q.dueDate || "") ? q.dueDate : "", status: String(q.status || "draft"),
               cur: curOk(q.currency) ? q.currency : "EUR", total: total(q) };
    }).sort(function (a, b) {
      return a.date < b.date ? 1 : a.date > b.date ? -1 : (a.num < b.num ? 1 : a.num > b.num ? -1 : (a.id < b.id ? 1 : -1));
    });
  }

  // ---------- Currencies (wave 46) ----------
  // Any ISO 4217 code (three capital letters). The list offered in the
  // picker comes from the browser (Intl.supportedValuesOf) with a fixed
  // fallback; amounts are formatted with the currency's own minor
  // units (JPY 0 decimals, BHD 3) by Intl, with a plain fallback.
  var CUR_RE = /^[A-Z]{3}$/;
  var COMMON = ["EUR", "USD", "GBP", "CHF", "JPY", "CAD", "AUD", "SEK", "NOK", "DKK", "PLN", "CZK",
                "HUF", "RON", "BGN", "TRY", "CNY", "HKD", "SGD", "KRW", "INR", "BRL", "MXN", "ZAR",
                "ILS", "NZD", "THB", "PHP", "MYR", "IDR", "ISK", "AED", "SAR", "EGP", "RSD", "ALL",
                "MKD", "UAH", "GEL", "MAD", "NGN", "KES", "ARS", "CLP", "COP", "PEN", "TWD", "VND"];
  function curOk(c) { return typeof c === "string" && CUR_RE.test(c); }
  function currencyList() {
    var all = [];
    try {
      if (typeof Intl !== "undefined" && typeof Intl.supportedValuesOf === "function") all = Intl.supportedValuesOf("currency");
    } catch (e) { all = []; }
    var seen = {}, out = [];
    COMMON.concat(all || []).forEach(function (c) {
      if (curOk(c) && !seen[c]) { seen[c] = true; out.push(c); }
    });
    return out;
  }
  var NF = {};
  function fmtMoney(n, cur, lang, codeOnly) {
    cur = curOk(cur) ? cur : "EUR";
    n = typeof n === "number" && isFinite(n) ? n : 0;
    var I = typeof window !== "undefined" && window.orosI18n;
    var loc = lang === "el" ? "el-GR" : (I && typeof lang === "string" && lang !== "en" ? I.locale(lang) : "en-GB");
    var k = loc + cur + (codeOnly ? "c" : "");
    if (!(k in NF)) {
      try { NF[k] = new Intl.NumberFormat(loc, { style: "currency", currency: cur, currencyDisplay: codeOnly ? "code" : "symbol" }); }
      catch (e) { NF[k] = null; }
    }
    if (NF[k]) return NF[k].format(n);
    var s = Math.abs(n).toFixed(2);
    if (loc !== "en-GB") s = s.replace(".", ",");
    return (n < 0 ? "-" : "") + s + " " + cur;
  }
  // The currency's decimals (2 when Intl doesn't know it).
  function curDigits(cur) {
    try { return new Intl.NumberFormat("en", { style: "currency", currency: cur }).resolvedOptions().maximumFractionDigits; }
    catch (e) { return 2; }
  }
  // A total shown in another currency: amount × rate (rate = how many
  // `to` one `from` buys, e.g. UnitsCore.crossRate), rounded to the
  // target's decimals; null without a usable rate.
  function convert(amount, rate, to) {
    if (typeof amount !== "number" || !isFinite(amount) || typeof rate !== "number" || !isFinite(rate) || rate <= 0) return null;
    var d = curDigits(to), f = Math.pow(10, d);
    return Math.round(amount * rate * f) / f;
  }

  // ---------- 1.3 (GATE-PAR P4): the data's canonical form and merge ----------
  // Moved from quote.js unchanged (QT-11, Q-1): quote.js, the sync
  // slice and the Assistant's new quotes (assistant/additems3.js) use
  // this one copy, so a direct write is byte for byte what Quote writes.
  //   canonState(s) → the canonical form (no activeQuoteId, pos =
  //     index, tombstones pruned by the data's own newest mtime)
  //   merge(a, b)   → symmetric, idempotent cross-device merge
  var QT_VER = 1, TOMB_MS = 30 * 24 * 60 * 60 * 1000;
  // Q-1: deterministic tombstone pruning (HB-3 / MD-4 / NT-2
  // pattern). The cutoff derives from the dataset's newest mtime,
  // never the wall clock — same data yields the same payload on
  // every device at any time. Payload-only: local state keeps
  // every tombstone, so a lagging device can never resurrect an
  // entity by re-sending it alive.
  function datasetMaxTs(data) {
    var max = 0;
    ["quotes", "clients", "templates", "payMethods"].forEach(function (k) {
      (data[k] || []).forEach(function (e) {
        if ((e.mtime || 0) > max) max = e.mtime;
      });
    });
    return max;
  }

  function pruneDeletedMap(deleted, data) {
    var tomb = {};
    var cutoff = datasetMaxTs(data) - TOMB_MS;
    Object.keys(deleted || {}).forEach(function (id) {
      if (deleted[id] >= cutoff) tomb[id] = deleted[id];
    });
    return tomb;
  }

  // QT-11: κανονική μορφή — ταξινομημένα keys σε κάθε επίπεδο, pos =
  // θέση στη λίστα, tombstones κλαδεμένα ντετερμινιστικά. Getter,
  // merge και δίσκος δίνουν byte-ίδια έξοδο για τα ίδια δεδομένα,
  // αλλιώς κάθε γύρος sync ανεβάζει ξανά (A67 Q4).
  var ENTITY_LISTS = ["quotes", "clients", "templates", "payMethods"];

  function canonObj(v) {
    if (Array.isArray(v)) return v.map(canonObj);
    if (!v || typeof v !== "object") return v;
    var out = {};
    Object.keys(v).sort().forEach(function (k) {
      if (v[k] !== undefined) out[k] = canonObj(v[k]);
    });
    return out;
  }

  function canonState(s) {
    var src = s || {};
    var out = {};
    Object.keys(src).forEach(function (k) {
      if (k !== "activeQuoteId") out[k] = src[k];
    });
    out = canonObj(out);
    out.ver = QT_VER;
    out.om = typeof out.om === "number" ? out.om : 0;
    ENTITY_LISTS.forEach(function (k) {
      var arr = Array.isArray(out[k]) ? out[k] : [];
      arr.forEach(function (e, i) { e.pos = i; });
      out[k] = arr;
    });
    out.deleted = pruneDeletedMap(out.deleted, out);
    return canonObj(out);
  }

  function mergeEntityMaps(aDel, bDel) {
    var out = {};
    var a = aDel || {}, b = bDel || {};
    Object.keys(a).forEach(function (id) { out[id] = a[id]; });
    Object.keys(b).forEach(function (id) {
      out[id] = Math.max(out[id] || 0, b[id]);
    });
    return out;
  }

  function entAlive(ent, tomb) {
    var ts = tomb[ent.id];
    return ts === undefined || (ent.mtime || 0) > ts;
  }

  function newerEntity(a, b) {
    if ((a.mtime || 0) !== (b.mtime || 0)) {
      return (a.mtime || 0) > (b.mtime || 0) ? a : b;
    }
    // QT-11: tie-break σε κανονική μορφή — η σειρά των keys δεν
    // επιτρέπεται να αλλάζει τον νικητή ανάλογα με τη συσκευή.
    return JSON.stringify(canonObj(a)) >= JSON.stringify(canonObj(b)) ? a : b;
  }

  function unionEntities(aArr, bArr, tomb) {
    var map = {};
    (aArr || []).forEach(function (e) { map[e.id] = e; });
    (bArr || []).forEach(function (e) {
      map[e.id] = map[e.id] ? newerEntity(map[e.id], e) : e;
    });
    var out = [];
    Object.keys(map).forEach(function (id) {
      if (entAlive(map[id], tomb)) out.push(map[id]);
    });
    return out;
  }

  function orderEntities(entities, refArr) {
    var idx = {};
    (refArr || []).forEach(function (e, i) { idx[e.id] = i; });
    entities.sort(function (x, y) {
      var ix = idx[x.id] !== undefined ? idx[x.id] : Infinity;
      var iy = idx[y.id] !== undefined ? idx[y.id] : Infinity;
      if (ix !== iy) return ix - iy;
      if ((x.mtime || 0) !== (y.mtime || 0)) return (x.mtime || 0) - (y.mtime || 0);
      return x.id < y.id ? -1 : (x.id > y.id ? 1 : 0);
    });
    entities.forEach(function (e, i) { e.pos = i; });
    return entities;
  }

  // QT-11: με ίσο om καμία πλευρά δεν είναι «νεότερη». Αναφορά γίνεται
  // η πλευρά που περιέχει ΟΛΑ τα ζωντανά entities· αν το κάνουν και οι
  // δύο με διαφορετική σειρά (ή καμία), η σειρά βγαίνει μόνο από
  // mtime/id. Έτσι η merge είναι συμμετρική, idempotent και
  // merge(merge(a, b), b) = merge(a, b).
  function pickRef(aArr, bArr, aOm, bOm, out) {
    if ((aOm || 0) !== (bOm || 0)) return (aOm || 0) > (bOm || 0) ? aArr : bArr;
    var alive = {};
    out.forEach(function (e) { alive[e.id] = true; });
    var seq = function (arr) {
      return (arr || []).filter(function (e) { return alive[e.id]; })
                        .map(function (e) { return e.id; }).join("\u0001");
    };
    var full = function (arr) {
      var seen = {}, n = 0;
      (arr || []).forEach(function (e) {
        if (alive[e.id] && !seen[e.id]) { seen[e.id] = true; n++; }
      });
      return n === out.length;
    };
    var fa = full(aArr), fb = full(bArr);
    if (fa && fb) return seq(aArr) === seq(bArr) ? aArr : [];
    if (fa) return aArr;
    if (fb) return bArr;
    return [];
  }

  function mergeQuoteStates(A, B) {
    var a = JSON.parse(JSON.stringify(A || {}));
    var b = JSON.parse(JSON.stringify(B || {}));

    // Q-1: pruning moved to the sliceGet payload boundary and made
    // deterministic (dataset maxTs) — never Date.now(). The merge
    // itself stays pure: same inputs, same output, every device.
    var tomb = mergeEntityMaps(a.deleted, b.deleted);

    var quotes   = unionEntities(a.quotes, b.quotes, tomb);
    var clients  = unionEntities(a.clients, b.clients, tomb);
    var templates = unionEntities(a.templates, b.templates, tomb);
    var payMethods = unionEntities(a.payMethods, b.payMethods, tomb);

    return canonState({
      ver: QT_VER,
      om: Math.max(a.om || 0, b.om || 0),
      deleted: tomb,
      quotes: orderEntities(quotes, pickRef(a.quotes, b.quotes, a.om, b.om, quotes)),
      clients: orderEntities(clients, pickRef(a.clients, b.clients, a.om, b.om, clients)),
      templates: orderEntities(templates, pickRef(a.templates, b.templates, a.om, b.om, templates)),
      payMethods: orderEntities(payMethods, pickRef(a.payMethods, b.payMethods, a.om, b.om, payMethods))
    });
  }


  var api = { dueQuotes: dueQuotes, clientName: clientName, total: total, forClient: forClient,
              curOk: curOk, currencyList: currencyList, fmtMoney: fmtMoney, curDigits: curDigits, convert: convert,
              DATA_VER: QT_VER, canonObj: canonObj, canonState: canonState, pruneDeleted: pruneDeletedMap, merge: mergeQuoteStates };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root && root.document) root.OrosQuoteCore = api;
})(typeof window !== "undefined" ? window : globalThis);
