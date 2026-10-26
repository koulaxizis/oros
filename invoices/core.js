// ============================================================
// orOS Invoices — shared core (v1.0.0)
// The pure model of the Invoices app: no DOM, no storage writes.
// One copy of the logic for the app, the universal search provider
// and (read-only) CRM Lite. Exposes window.OrosInvoicesCore and,
// under Node, module.exports (tests/invoices.test.js).
// i18n-inline-ok: Greek country names for EU matching and Greek letters in series prefixes (data, no UI text)
//
// Data (synced slice "invoices", key oros-invoices-data):
//   { ver: 1,
//     prof:    { business profile + defaults, m }       one LWW record
//     series:  [ { id, kind, prefix, year, digits, m } | tomb ]
//     clients: [ { id, name, afm, doy, job, addr, country, email,
//                  phone, note, crm?, m } | tomb ]
//     docs:    [ doc | tomb ]
//     pays:    [ { id, doc, date, amt, how, note, m } | tomb ]
//     tpls:    [ { id, name, kind, cli, cur, lines, gDisc, wht, exempt,
//                  terms, notes, rep, next, dom, m } | tomb ],
//     profs:   [ { id, name, trade, job, addr, country, afm, doy, phone,
//                  email, web, iban, logo, terms, footer, m } | tomb ] }
//              (wave 3: more business profiles; the key is left out
//              while empty, and an older device drops it on its own
//              merge, which costs nothing: the union keeps it here)
//     bills:   [ { id, num, date, due, cur, sup{name, afm}, crm, net,
//                  vat, note, m } | tomb ]
//     bpays:   [ { id, bill, date, amt, how, note, m } | tomb ]
//              (wave 7, BR-CRM-LINK partner card: invoices you
//              RECEIVED from suppliers and what you paid on them;
//              left out while empty, like profs. They are never
//              counted in revenue, VAT or myDATA: only what you owe.)
//   Wave 3 fields that ride as flat extras (so an older device keeps
//   them, see withExtras): doc.pid / tpl.pid / series.pid = the profile
//   (none = the main one, prof), prof.qr = 0 turns the payment QR off.
//   tomb = { id, m, del: 1 }
//   doc  = { id, kind inv|rcpt|pro|cred|ext, st draft|issued|void,
//            ser, seq, num, date, due, cur, cli, c{party}, s{party}?,
//            lines[{code, d, q, unit, p, disc, vat}], gDisc, wht,
//            exempt, terms, notes, ref, crm, mark, file, sent, plang,
//            xnet, xvat, m }
//   - money is integer cents; percentages are numbers 0–100 with at
//     most 2 decimals; quantities have at most 3 decimals
//   - totals, paid amounts, balances and statuses are NEVER stored:
//     pure functions of the data (no merge can make them disagree)
//   - a draft has no number; "issue" gives the next number of its
//     series (max + 1, no synced counter) and freezes the document:
//     lines, client and seller are copied into it (c, s)
//   - "ext" = an invoice issued elsewhere (myDATA, a provider) and
//     only recorded here: typed number, net + VAT, optional ΜΑΡΚ
//   - merge: per id, newer m wins, a tombstone wins ties, then the
//     larger JSON (R5, R17); every list sorted by id (R26)
//   - default series are implicit (never stored) until edited (R16)
// Sections:
//   1. Constants + helpers
//   2. Normalize
//   3. Merge, parse, backup
//   4. Series + numbering
//   5. Totals, payments, status
//   6. Lookups for other apps (CRM Lite), due lists, dashboard
//   7. Recurring templates
//   8. Prefill (BR-INV-NEW), parsing + formatting, CSV
// ============================================================
(function (root) {
  "use strict";

  // ---------- 1. Constants + helpers ----------
  var VERSION     = "1.0.0";
  var STORAGE_KEY = "oros-invoices-data";
  var DATA_VER    = 1;
  var KINDS  = ["inv", "rcpt", "pro", "cred", "ext"];
  var STATES = ["draft", "issued", "void"];
  var HOWS   = ["bank", "cash", "card", "iris", "paypal", "other"];
  var REPS   = ["", "m", "q", "y"];
  var CURRENCIES = ["EUR", "USD", "GBP", "CHF", "CAD", "AUD", "SEK", "NOK", "DKK",
                    "PLN", "CZK", "HUF", "RON", "BGN", "TRY", "JPY"];
  var LIM = {
    name: 120, short: 60, addr: 300, note: 1000, terms: 1000, notes: 2000,
    footer: 300, exempt: 300, code: 30, desc: 500, unit: 12, num: 40, mark: 60,
    file: 300, email: 120, phone: 40, iban: 300, lines: 200,
    money: 100000000000,             // 1.000.000.000,00 in cents
    qty: 1000000,
    logo: 200000                     // characters of the data URL (~150 KB)
  };
  var ID_RE  = /^[a-z0-9][a-z0-9-]{2,39}$/;
  var DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  var CUR_RE = /^[A-Z]{3}$/;
  var LOGO_RE = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+\/]+=*$/;
  var SRC_RE = /^[a-z0-9]{1,20}:[A-Za-z0-9_-]{1,60}$/;

  // The series every install starts with: deterministic ids, never
  // stored until the user edits one (then the stored copy wins).
  var DEFAULT_SERIES = [
    { id: "ser-cred", kind: "cred", prefix: "CN",  year: 1, digits: 4, m: 0 },
    { id: "ser-inv",  kind: "inv",  prefix: "INV", year: 1, digits: 4, m: 0 },
    { id: "ser-pro",  kind: "pro",  prefix: "PRO", year: 1, digits: 4, m: 0 },
    { id: "ser-rcpt", kind: "rcpt", prefix: "RCT", year: 1, digits: 4, m: 0 }
  ];
  var DEFAULT_PROF = {
    name: "", trade: "", job: "", addr: "", country: "", afm: "", doy: "",
    phone: "", email: "", web: "", iban: "", logo: "",
    cur: "EUR", vat: 24, days: 30, wht: 0, plang: "", terms: "", footer: "", m: 0
  };

  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function round(v, dec) { var f = Math.pow(10, dec); return Math.round(v * f) / f; }
  // One line: control characters out, whitespace collapsed, capped.
  function cleanText(v, max) {
    if (typeof v !== "string") return "";
    return v.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  }
  // Several lines: newlines kept (at most two in a row), other
  // control characters out, each line trimmed at its end, capped.
  function cleanBlock(v, max) {
    if (typeof v !== "string") return "";
    return v.replace(/\r\n?/g, "\n").replace(/[\u2028\u2029]/g, "\n")
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, " ")
      .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
  }
  function pct(v) { return isNum(v) && v >= 0 && v <= 100 ? round(v, 2) : 0; }
  function cents(v) { return isInt(v) && Math.abs(v) <= LIM.money ? v : 0; }
  function curOk(v) { return typeof v === "string" && CUR_RE.test(v); }

  function dayKey(d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function today() { return dayKey(new Date()); }
  function keyDate(key) {
    var p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || "");
    return p ? new Date(+p[1], +p[2] - 1, +p[3]) : null;
  }
  function validDay(key) {
    if (typeof key !== "string" || !DAY_RE.test(key)) return false;
    var d = keyDate(key);
    return !!d && dayKey(d) === key;
  }
  function addDays(key, n) {
    var d = keyDate(key);
    d.setDate(d.getDate() + n);
    return dayKey(d);
  }
  // Months later, on day `dom` (1–31) clamped to the month's end.
  function addMonths(key, n, dom) {
    var d = keyDate(key);
    var y = d.getFullYear(), mo = d.getMonth() + n;
    var t = new Date(y, mo, 1);
    var last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
    t.setDate(Math.min(dom || d.getDate(), last));
    return dayKey(t);
  }
  function dayDiff(a, b) {   // b − a in whole days
    return Math.round((keyDate(b).getTime() - keyDate(a).getTime()) / 86400000);
  }

  function newId() {
    var r = new Uint32Array(2);
    (root.crypto || require("crypto").webcrypto).getRandomValues(r);
    return Date.now().toString(36) + r[0].toString(36) + r[1].toString(36).slice(0, 4);
  }
  // Deterministic id (two devices make the same one from the same input).
  function hashId(prefix, str) {
    var h1 = 0x811c9dc5, h2 = 0x01000193;
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
      h2 = Math.imul(h2 ^ c, 2246822519) >>> 0;
    }
    return prefix + h1.toString(36) + h2.toString(36);
  }

  // ---------- 2. Normalize ----------
  function baseOk(x) {
    return x && typeof x === "object" && typeof x.id === "string" && ID_RE.test(x.id) &&
           isInt(x.m) && x.m >= 0;
  }
  function tomb(x) { return { id: x.id, m: x.m, del: 1 }; }
  function refId(v) { return typeof v === "string" && ID_RE.test(v) ? v : ""; }
  // CRM ids come from another app: kept as an opaque short token.
  function crmId(v) { return typeof v === "string" && /^[A-Za-z0-9_-]{1,60}$/.test(v) ? v : ""; }

  // Forward compatibility (as in Timesheet and Budget): a flat field
  // this version does not know rides along on its record, sorted by
  // name, so a newer version can add fields without this one
  // stripping them (stripping would make two versions re-upload forever).
  var EXTRA_RE = /^[a-z][a-z0-9]{0,15}$/, EXTRA_MAX = 16;
  var KNOWN = {
    series: ["id", "kind", "prefix", "year", "digits", "m", "del"],
    client: ["id", "name", "afm", "doy", "job", "addr", "country", "email", "phone", "note", "crm", "m", "del"],
    doc:    ["id", "kind", "st", "ser", "seq", "num", "date", "due", "cur", "cli", "c", "s", "lines",
             "gDisc", "wht", "exempt", "terms", "notes", "ref", "crm", "mark", "file", "sent", "plang",
             "xnet", "xvat", "src", "m", "del"],
    pay:    ["id", "doc", "date", "amt", "how", "note", "bud", "m", "del"],
    tpl:    ["id", "name", "kind", "cli", "cur", "lines", "gDisc", "wht", "exempt", "terms", "notes",
             "rep", "next", "dom", "m", "del"],
    prof:   ["name", "trade", "job", "addr", "country", "afm", "doy", "phone", "email", "web", "iban",
             "logo", "cur", "vat", "days", "wht", "plang", "terms", "footer", "m"],
    biz:    ["id", "name", "trade", "job", "addr", "country", "afm", "doy", "phone", "email", "web", "iban",
             "logo", "terms", "footer", "m", "del"],
    bill:   ["id", "num", "date", "due", "cur", "sup", "crm", "net", "vat", "note", "m", "del"],
    bpay:   ["id", "bill", "date", "amt", "how", "note", "m", "del"]
  };
  function withExtras(out, x, known) {
    var n = 0;
    Object.keys(x).filter(function (k) { return EXTRA_RE.test(k) && known.indexOf(k) < 0; })
      .sort(cmpStr).forEach(function (k) {
        var v = x[k];
        var ok = typeof v === "string" ? v.length <= 500
               : typeof v === "boolean" || (typeof v === "number" && isFinite(v));
        if (ok && n < EXTRA_MAX) { out[k] = v; n++; }
      });
    return out;
  }

  // A party = the client or seller details as printed on a document.
  function normParty(p) {
    p = (p && typeof p === "object") ? p : {};
    return {
      name: cleanText(p.name, LIM.name), job: cleanText(p.job, LIM.name),
      addr: cleanBlock(p.addr, LIM.addr), country: cleanText(p.country, LIM.short),
      afm: cleanText(p.afm, LIM.short), doy: cleanText(p.doy, LIM.short),
      email: cleanText(p.email, LIM.email), phone: cleanText(p.phone, LIM.phone)
    };
  }
  // The seller copy also carries the trade name, web and bank lines.
  function normSeller(p) {
    p = (p && typeof p === "object") ? p : {};
    var out = normParty(p);
    out.trade = cleanText(p.trade, LIM.name);
    out.web = cleanText(p.web, LIM.email);
    out.iban = cleanBlock(p.iban, LIM.iban);
    out.logo = typeof p.logo === "string" && p.logo.length <= LIM.logo && LOGO_RE.test(p.logo) ? p.logo : "";
    return out;
  }
  function normLine(l) {
    if (!l || typeof l !== "object") return null;
    var q = isNum(l.q) && Math.abs(l.q) <= LIM.qty ? round(l.q, 3) : 1;
    return {
      code: cleanText(l.code, LIM.code), d: cleanBlock(l.d, LIM.desc),
      q: q, unit: cleanText(l.unit, LIM.unit), p: cents(l.p),
      disc: pct(l.disc), vat: pct(l.vat)
    };
  }
  function normLines(v) {
    if (!Array.isArray(v)) return [];
    var out = [];
    for (var i = 0; i < v.length && out.length < LIM.lines; i++) {
      var l = normLine(v[i]);
      if (l) out.push(l);
    }
    return out;
  }

  function normSeries(x) {
    if (!baseOk(x)) return null;
    if (x.del) return tomb(x);
    if (KINDS.indexOf(x.kind) < 0 || x.kind === "ext") return null;
    var prefix = cleanText(x.prefix, 12).replace(/[^0-9A-Za-zͰ-Ͽἀ-῿.\/_ -]/g, "");
    return withExtras({
      id: x.id, kind: x.kind, prefix: prefix, year: x.year === 0 ? 0 : 1,
      digits: isInt(x.digits) && x.digits >= 1 && x.digits <= 8 ? x.digits : 4, m: x.m
    }, x, KNOWN.series);
  }
  function normClient(x) {
    if (!baseOk(x)) return null;
    if (x.del) return tomb(x);
    var name = cleanText(x.name, LIM.name);
    if (!name) return null;
    var p = normParty(x);
    var out = {
      id: x.id, name: name, afm: p.afm, doy: p.doy, job: p.job, addr: p.addr,
      country: p.country, email: p.email, phone: p.phone, note: cleanBlock(x.note, LIM.note)
    };
    var c = crmId(x.crm);
    if (c) out.crm = c;
    out.m = x.m;
    return withExtras(out, x, KNOWN.client);
  }
  function normDoc(x) {
    if (!baseOk(x)) return null;
    if (x.del) return tomb(x);
    if (KINDS.indexOf(x.kind) < 0) return null;
    var st = STATES.indexOf(x.st) >= 0 ? x.st : "draft";
    if (x.kind === "ext" && st === "draft") st = "issued";   // a record is never a draft
    var out = {
      id: x.id, kind: x.kind, st: st,
      ser: x.kind === "ext" ? "" : refId(x.ser),
      seq: st !== "draft" && x.kind !== "ext" && isInt(x.seq) && x.seq > 0 && x.seq < 1e9 ? x.seq : 0,
      num: st === "draft" ? "" : cleanText(x.num, LIM.num),
      date: validDay(x.date) ? x.date : "",
      due: validDay(x.due) ? x.due : "",
      cur: curOk(x.cur) ? x.cur : "EUR",
      cli: refId(x.cli),
      c: normParty(x.c)
    };
    if (st !== "draft" && x.kind !== "ext" && x.s && typeof x.s === "object") out.s = normSeller(x.s);
    out.lines = x.kind === "ext" ? [] : normLines(x.lines);
    out.gDisc = x.kind === "ext" ? 0 : pct(x.gDisc);
    out.wht = pct(x.wht);
    out.exempt = cleanBlock(x.exempt, LIM.exempt);
    out.terms = cleanBlock(x.terms, LIM.terms);
    out.notes = cleanBlock(x.notes, LIM.notes);
    out.ref = refId(x.ref);
    out.crm = crmId(x.crm);
    out.mark = cleanText(x.mark, LIM.mark);
    out.file = typeof x.file === "string" && /^\/internal\/[^\u0000-\u001f]{1,300}$/.test(x.file) &&
               x.file.indexOf("/../") < 0 ? x.file : "";
    out.sent = validDay(x.sent) ? x.sent : "";
    // wave 7: what the document was made from ("app:id", BR-INV-NEW
    // ref), written only when set; an older device keeps it as an extra
    if (typeof x.src === "string" && SRC_RE.test(x.src)) out.src = x.src;
    out.plang = x.plang === "en" || x.plang === "el" ? x.plang : "";
    if (x.kind === "ext") {
      out.xnet = cents(x.xnet);
      out.xvat = cents(x.xvat);
    }
    out.m = x.m;
    return withExtras(out, x, KNOWN.doc);
  }
  function normPay(x) {
    if (!baseOk(x)) return null;
    if (x.del) return tomb(x);
    if (!refId(x.doc) || !validDay(x.date) || !isInt(x.amt) || x.amt === 0 || Math.abs(x.amt) > LIM.money) return null;
    return withExtras({
      id: x.id, doc: x.doc, date: x.date, amt: x.amt,
      how: HOWS.indexOf(x.how) >= 0 ? x.how : "other",
      note: cleanText(x.note, LIM.short * 2), bud: x.bud === 1 ? 1 : 0, m: x.m
    }, x, KNOWN.pay);
  }
  function normTpl(x) {
    if (!baseOk(x)) return null;
    if (x.del) return tomb(x);
    var name = cleanText(x.name, LIM.short);
    if (!name || ["inv", "rcpt", "pro"].indexOf(x.kind) < 0) return null;
    var rep = REPS.indexOf(x.rep) >= 0 ? x.rep : "";
    var out = {
      id: x.id, name: name, kind: x.kind, cli: refId(x.cli), cur: curOk(x.cur) ? x.cur : "EUR",
      lines: normLines(x.lines), gDisc: pct(x.gDisc), wht: pct(x.wht),
      exempt: cleanBlock(x.exempt, LIM.exempt), terms: cleanBlock(x.terms, LIM.terms),
      notes: cleanBlock(x.notes, LIM.notes), rep: rep,
      next: rep && validDay(x.next) ? x.next : "",
      dom: rep && isInt(x.dom) && x.dom >= 1 && x.dom <= 31 ? x.dom : 0,
      m: x.m
    };
    if (rep && !out.next) { out.rep = ""; out.dom = 0; }
    return withExtras(out, x, KNOWN.tpl);
  }
  // Fixed key order: two devices with the same profile serialize alike.
  function normProf(p) {
    p = (p && typeof p === "object") ? p : {};
    var d = DEFAULT_PROF, s = normSeller(p);
    var out = {
      name: s.name, trade: s.trade, job: s.job, addr: s.addr, country: s.country,
      afm: s.afm, doy: s.doy, phone: s.phone, email: s.email, web: s.web, iban: s.iban, logo: s.logo,
      cur: curOk(p.cur) ? p.cur : d.cur,
      vat: isNum(p.vat) && p.vat >= 0 && p.vat <= 100 ? round(p.vat, 2) : d.vat,
      days: isInt(p.days) && p.days >= 0 && p.days <= 365 ? p.days : d.days,
      wht: pct(p.wht),
      plang: p.plang === "en" || p.plang === "el" ? p.plang : "",
      terms: cleanBlock(p.terms, LIM.terms), footer: cleanBlock(p.footer, LIM.footer),
      m: isInt(p.m) && p.m > 0 ? p.m : 0
    };
    return withExtras(out, p, KNOWN.prof);
  }

  // Wave 3: another business profile (the main one is prof). Seller
  // details only; the defaults (currency, VAT, days…) stay on prof.
  function normBiz(x) {
    if (!baseOk(x)) return null;
    if (x.del) return tomb(x);
    var s = normSeller(x);
    if (!s.name) return null;
    return withExtras({
      id: x.id, name: s.name, trade: s.trade, job: s.job, addr: s.addr, country: s.country,
      afm: s.afm, doy: s.doy, phone: s.phone, email: s.email, web: s.web, iban: s.iban, logo: s.logo,
      terms: cleanBlock(x.terms, LIM.terms), footer: cleanBlock(x.footer, LIM.footer), m: x.m
    }, x, KNOWN.biz);
  }

  // Wave 7: a received invoice (a bill) and a payment you made on it.
  function normBill(x) {
    if (!baseOk(x)) return null;
    if (x.del) return tomb(x);
    var sp = (x.sup && typeof x.sup === "object") ? x.sup : {};
    var sup = { name: cleanText(sp.name, LIM.name), afm: cleanText(sp.afm, LIM.short) };
    if (!sup.name || !validDay(x.date)) return null;
    var out = {
      id: x.id, num: cleanText(x.num, LIM.num), date: x.date, due: validDay(x.due) ? x.due : "",
      cur: curOk(x.cur) ? x.cur : "EUR", sup: sup
    };
    var c = crmId(x.crm);
    if (c) out.crm = c;
    out.net = cents(x.net);
    out.vat = cents(x.vat);
    out.note = cleanBlock(x.note, LIM.note);
    out.m = x.m;
    return withExtras(out, x, KNOWN.bill);
  }
  function normBpay(x) {
    if (!baseOk(x)) return null;
    if (x.del) return tomb(x);
    if (!refId(x.bill) || !validDay(x.date) || !isInt(x.amt) || x.amt === 0 || Math.abs(x.amt) > LIM.money) return null;
    return withExtras({
      id: x.id, bill: x.bill, date: x.date, amt: x.amt,
      how: HOWS.indexOf(x.how) >= 0 ? x.how : "other",
      note: cleanText(x.note, LIM.short * 2), m: x.m
    }, x, KNOWN.bpay);
  }

  // ---------- 3. Merge, parse, backup ----------
  // Newer m wins; equal m: a tombstone wins, then the larger JSON
  // (symmetric, so both devices pick the same record).
  function better(x, cur) {
    if (!cur) return true;
    if (x.m !== cur.m) return x.m > cur.m;
    if (!!x.del !== !!cur.del) return !!x.del;
    return JSON.stringify(x) > JSON.stringify(cur);
  }
  function mergeList(a, b, norm) {
    var best = {};
    [a, b].forEach(function (list) {
      if (!Array.isArray(list)) return;
      list.forEach(function (raw) {
        var x = norm(raw);
        if (x && better(x, best[x.id])) best[x.id] = x;
      });
    });
    return Object.keys(best).sort(cmpStr).map(function (id) { return best[id]; });
  }
  function mergeProf(a, b) {
    var na = normProf(a), nb = normProf(b);
    if (na.m !== nb.m) return na.m > nb.m ? na : nb;
    return JSON.stringify(na) >= JSON.stringify(nb) ? na : nb;
  }
  function mergeInvoices(A, B) {
    var a = (A && typeof A === "object") ? A : {};
    var b = (B && typeof B === "object") ? B : {};
    var out = {
      ver: DATA_VER,
      prof: mergeProf(a.prof, b.prof),
      series: mergeList(a.series, b.series, normSeries),
      clients: mergeList(a.clients, b.clients, normClient),
      docs: mergeList(a.docs, b.docs, normDoc),
      pays: mergeList(a.pays, b.pays, normPay),
      tpls: mergeList(a.tpls, b.tpls, normTpl)
    };
    var profs = mergeList(a.profs, b.profs, normBiz);
    if (profs.length) out.profs = profs;
    var bills = mergeList(a.bills, b.bills, normBill);
    if (bills.length) out.bills = bills;
    var bpays = mergeList(a.bpays, b.bpays, normBpay);
    if (bpays.length) out.bpays = bpays;
    return out;
  }
  function normalize(x) { return mergeInvoices(x, x); }
  function empty() { return normalize(null); }
  function looksLike(o) {
    return !!o && typeof o === "object" && Array.isArray(o.docs) && Array.isArray(o.clients);
  }
  // What localStorage holds → the model; null when unreadable (the
  // caller keeps a rescue copy), an empty model when there is none.
  function parse(raw) {
    if (raw === null || raw === undefined || raw === "") return empty();
    try {
      var o = JSON.parse(raw);
      if (looksLike(o)) return normalize(o);
    } catch (e) {}
    return null;
  }
  // Backup file: the whole model, tombstones included, so a restore
  // merges (never replaces) and deletions stay deleted.
  function toBackup(data) {
    return JSON.stringify({ app: "invoices", ver: DATA_VER, data: normalize(data) }, null, 1);
  }
  function fromBackup(text) {
    var o = null;
    try { o = JSON.parse(text); } catch (e) { return null; }
    if (!o || typeof o !== "object" || o.app !== "invoices" || !looksLike(o.data)) return null;
    return normalize(o.data);
  }

  function live(list) { return (list || []).filter(function (x) { return x && !x.del; }); }
  function byId(list, id) {
    if (!id || !Array.isArray(list)) return null;
    for (var i = 0; i < list.length; i++) if (list[i].id === id && !list[i].del) return list[i];
    return null;
  }
  function anyId(list, id) {   // tombstones count: an id that ever existed
    for (var i = 0; i < (list || []).length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function doc(data, id) { return byId(data.docs, id); }
  function client(data, id) { return byId(data.clients, id); }

  // ---------- 4. Series + numbering ----------
  // Every series in force: the defaults, replaced by a stored copy
  // with the same id; deleted ones (a tomb) are gone. Sorted by kind,
  // then prefix.
  function seriesList(data) {
    var map = {};
    DEFAULT_SERIES.forEach(function (s) { map[s.id] = s; });
    (data && data.series || []).forEach(function (s) {
      if (s.del) {
        if (DEFAULT_SERIES.some(function (d) { return d.id === s.id; })) return;   // a default can't go
        delete map[s.id];
      } else map[s.id] = s;
    });
    return Object.keys(map).map(function (k) { return map[k]; }).sort(function (x, y) {
      return cmpStr(x.kind, y.kind) || cmpStr(x.prefix, y.prefix) || cmpStr(x.id, y.id);
    });
  }
  function series(data, id) {
    var l = seriesList(data);
    for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
    return null;
  }
  function seriesFor(data, kind) {
    return seriesList(data).filter(function (s) { return s.kind === kind; });
  }
  function defaultSeries(kind) { return "ser-" + kind; }
  function seriesSample(s, year, seq) {
    return fmtNum(s, year || new Date().getFullYear(), seq || 1);
  }
  // INV-2026-0042; no prefix → 2026-0042; no year → INV-0042.
  function fmtNum(s, year, seq) {
    var n = String(seq);
    while (n.length < s.digits) n = "0" + n;
    return [s.prefix, s.year ? String(year) : "", n].filter(Boolean).join("-");
  }
  function bucketOf(s, date) { return s.year ? String(date).slice(0, 4) : "*"; }
  // The numbered documents of a series in the bucket of `date` (the
  // year, or all time for a series without year).
  function numbered(data, serId, date) {
    var s = series(data, serId);
    if (!s) return [];
    var b = bucketOf(s, date);
    return live(data.docs).filter(function (d) {
      return d.ser === serId && d.st !== "draft" && d.seq > 0 && bucketOf(s, d.date) === b;
    });
  }
  function nextSeq(data, serId, date) {
    var max = 0;
    numbered(data, serId, date).forEach(function (d) { if (d.seq > max) max = d.seq; });
    return max + 1;
  }
  // Two devices offline can give the same number. Groups of documents
  // that share series + bucket + seq (two or more), sorted by id.
  function clashes(data) {
    var groups = {};
    live(data.docs).forEach(function (d) {
      if (d.st === "draft" || d.kind === "ext" || !d.seq) return;
      var s = series(data, d.ser);
      if (!s) return;
      var k = d.ser + "|" + bucketOf(s, d.date) + "|" + d.seq;
      (groups[k] = groups[k] || []).push(d);
    });
    return Object.keys(groups).sort(cmpStr).map(function (k) { return groups[k]; })
      .filter(function (g) { return g.length > 1; })
      .map(function (g) { return g.sort(function (x, y) { return cmpStr(x.id, y.id); }); });
  }
  // Which document of a clash keeps its number: the one issued first
  // (smaller m), ties by id. The others are offered a new number.
  function clashKeeper(group) {
    return group.slice().sort(function (x, y) { return x.m - y.m || cmpStr(x.id, y.id); })[0];
  }

  // ---------- 5. Totals, payments, status ----------
  function lineNet(l) { return Math.round(l.q * l.p * (100 - l.disc) / 100); }
  // { sub, disc, net, vat, total, wht, pay, rates: [{ rate, base, vat }] }
  // VAT is computed once per rate on the discounted base (no
  // per-line rounding drift). A credit note's amounts are positive:
  // the sign is applied where it matters (balances, dashboard).
  function totals(d) {
    if (!d) return { sub: 0, disc: 0, net: 0, vat: 0, total: 0, wht: 0, pay: 0, rates: [] };
    if (d.kind === "ext") {
      var xn = d.xnet || 0, xv = d.xvat || 0, xw = Math.round(xn * (d.wht || 0) / 100);
      return { sub: xn, disc: 0, net: xn, vat: xv, total: xn + xv, wht: xw, pay: xn + xv - xw, rates: [] };
    }
    var by = {}, sub = 0;
    (d.lines || []).forEach(function (l) {
      var n = lineNet(l);
      sub += n;
      var k = String(l.vat);
      by[k] = (by[k] || 0) + n;
    });
    var rates = Object.keys(by).map(Number).sort(function (x, y) { return y - x; }).map(function (r) {
      var base = Math.round(by[String(r)] * (100 - (d.gDisc || 0)) / 100);
      return { rate: r, base: base, vat: Math.round(base * r / 100) };
    });
    var net = 0, vat = 0;
    rates.forEach(function (r) { net += r.base; vat += r.vat; });
    var wht = Math.round(net * (d.wht || 0) / 100);
    return { sub: sub, disc: sub - net, net: net, vat: vat, total: net + vat, wht: wht, pay: net + vat - wht, rates: rates };
  }
  function paysOf(data, docId) {
    return live(data.pays).filter(function (p) { return p.doc === docId; })
      .sort(function (x, y) { return cmpStr(x.date, y.date) || cmpStr(x.id, y.id); });
  }
  function paidOf(data, docId) {
    var s = 0;
    paysOf(data, docId).forEach(function (p) { s += p.amt; });
    return s;
  }
  // Issued credit notes that correct `docId`.
  function creditsOf(data, docId) {
    return live(data.docs).filter(function (d) { return d.kind === "cred" && d.st === "issued" && d.ref === docId; });
  }
  function owes(d) { return d && d.st === "issued" && (d.kind === "inv" || d.kind === "rcpt" || d.kind === "ext"); }
  // What is still owed on a document (0 for what owes nothing).
  function balance(data, d) {
    if (!owes(d)) return 0;
    var b = totals(d).pay - paidOf(data, d.id);
    creditsOf(data, d.id).forEach(function (c) { b -= totals(c).pay; });
    return b;
  }
  // draft | void | pro | credit | paid | partial | overdue | unpaid
  function status(data, d, day) {
    if (!d) return "";
    if (d.st === "draft") return "draft";
    if (d.st === "void") return "void";
    if (d.kind === "pro") return "pro";
    if (d.kind === "cred") return "credit";
    var bal = balance(data, d);
    if (bal <= 0) return "paid";
    if (d.due && d.due < (day || today())) return "overdue";
    return paidOf(data, d.id) > 0 ? "partial" : "unpaid";
  }
  // Days past the due date (0 when not overdue).
  function lateDays(d, day) {
    if (!d || !d.due) return 0;
    var n = dayDiff(d.due, day || today());
    return n > 0 ? n : 0;
  }
  // A credit note counts negative in revenue.
  function sign(d) { return d.kind === "cred" ? -1 : 1; }
  function counts(d) {   // in revenue: issued invoices, receipts, records, credit notes
    return d.st === "issued" && d.kind !== "pro";
  }

  // ---------- 6. Lookups for other apps, due lists, dashboard ----------
  function clientOf(data, d) { return client(data, d.cli); }
  function partyName(data, d) {
    var c = d.c && d.c.name ? d.c.name : "";
    if (c) return c;
    var cl = clientOf(data, d);
    return cl ? cl.name : "";
  }
  // BR-CRM-INV: the documents of one CRM customer, for CRM Lite to
  // show read-only. A document belongs to it when the document or its
  // client carries that crm id, or the client is one CRM linked to the
  // customer itself and that has no crm id of its own (also: [client
  // id], BR-CRM-LINK). Drafts are left out.
  // → { rows: [{ id, kind, no, date, due, total, paid, status, cur }],
  //     totals: { CUR: { invoiced, paid, open, overdue } } }
  function byCrm(data, id, day, also) {
    var out = { rows: [], totals: {} };
    id = crmId(id);
    if (!id || !data) return out;
    var mine = {};
    live(data.clients).forEach(function (c) {
      if (c.crm ? c.crm === id : Array.isArray(also) && also.indexOf(c.id) >= 0) mine[c.id] = true;
    });
    live(data.docs).forEach(function (d) {
      if (d.st === "draft" || !(d.crm === id || mine[d.cli])) return;
      var tt = totals(d), st = status(data, d, day);
      var paid = paidOf(data, d.id);
      out.rows.push({ id: d.id, kind: d.kind, no: d.num, date: d.date, due: d.due,
                      total: tt.pay, paid: paid, status: st, cur: d.cur });
      if (!counts(d)) return;
      var t = out.totals[d.cur] || (out.totals[d.cur] = { invoiced: 0, paid: 0, open: 0, overdue: 0 });
      t.invoiced += sign(d) * tt.pay;
      t.paid += paid;
      var bal = balance(data, d);
      if (bal > 0) { t.open += bal; if (st === "overdue") t.overdue += bal; }
    });
    out.rows.sort(function (x, y) { return cmpStr(y.date, x.date) || cmpStr(y.id, x.id); });
    return out;
  }
  // Open balance per currency of one client: { CUR: cents }.
  function clientOpen(data, cliId) {
    var out = {};
    live(data.docs).forEach(function (d) {
      if (d.cli !== cliId) return;
      var b = balance(data, d);
      if (b > 0) out[d.cur] = (out[d.cur] || 0) + b;
    });
    return out;
  }
  // Wave 3 — client statement: every document of one client that
  // still owes something, oldest first, with the open total per
  // currency. → { rows: [{ id, num, kind, date, due, total, paid, bal,
  // cur, late }], totals: { CUR: cents } }
  function statement(data, cliId, day) {
    var out = { rows: [], totals: {} };
    if (!cliId || !data) return out;
    day = day || today();
    live(data.docs).forEach(function (d) {
      if (d.cli !== cliId) return;
      var bal = balance(data, d);
      if (bal <= 0) return;
      out.rows.push({ id: d.id, num: d.num, kind: d.kind, date: d.date, due: d.due, total: totals(d).pay,
                      paid: totals(d).pay - bal, bal: bal, cur: d.cur, late: lateDays(d, day) });
      out.totals[d.cur] = (out.totals[d.cur] || 0) + bal;
    });
    out.rows.sort(function (x, y) { return cmpStr(x.date, y.date) || cmpStr(x.num, y.num) || cmpStr(x.id, y.id); });
    return out;
  }

  // Wave 7 — the documents made from one source ("app:id", the ref of
  // a BR-INV-NEW prefill, e.g. "stock:cons-<movement>"), drafts
  // included, cancelled ones left out: [doc].
  function bySrc(data, src) {
    if (!data || typeof src !== "string" || !SRC_RE.test(src)) return [];
    return live(data.docs).filter(function (d) { return d.src === src && d.st !== "void"; });
  }

  // Wave 7 — received invoices (bills): what you owe your suppliers.
  // Totals, paid amounts and statuses are computed, never stored.
  function billTotal(b) { return b && !b.del ? (b.net || 0) + (b.vat || 0) : 0; }
  function billPays(data, billId) {
    return live(data.bpays).filter(function (p) { return p.bill === billId; })
      .sort(function (x, y) { return cmpStr(x.date, y.date) || cmpStr(x.id, y.id); });
  }
  function billPaid(data, billId) {
    var s = 0;
    billPays(data, billId).forEach(function (p) { s += p.amt; });
    return s;
  }
  function billBalance(data, b) { return b && !b.del ? billTotal(b) - billPaid(data, b.id) : 0; }
  // paid | overdue | partial | unpaid
  function billStatus(data, b, day) {
    if (billBalance(data, b) <= 0) return "paid";
    if (b.due && b.due < (day || today())) return "overdue";
    return billPaid(data, b.id) > 0 ? "partial" : "unpaid";
  }
  function bill(data, id) { return byId(data.bills, id); }
  // What you still owe per currency: { CUR: { open, overdue, n } }.
  function billsOpen(data, day) {
    var out = {};
    live(data.bills).forEach(function (b) {
      var bal = billBalance(data, b);
      if (bal <= 0) return;
      var t = out[b.cur] || (out[b.cur] = { open: 0, overdue: 0, n: 0 });
      t.open += bal;
      t.n++;
      if (billStatus(data, b, day) === "overdue") t.overdue += bal;
    });
    return out;
  }
  // The bills of one CRM partner (BR-CRM-LINK): the bill carries that
  // crm id, or it carries none and its supplier's ΑΦΜ is the one given.
  // → { rows: [{ id, num, sup, date, due, total, paid, bal, status, cur }],
  //     totals: { CUR: { billed, paid, open, overdue } } }
  function billsByCrm(data, id, day, afm) {
    var out = { rows: [], totals: {} };
    id = crmId(id);
    if (!data || (!id && !afm)) return out;
    var key = String(afm || "").replace(/\s+/g, "").replace(/^(EL|GR)/i, "").toUpperCase();
    live(data.bills).forEach(function (b) {
      var mine = b.crm ? b.crm === id : !!key && b.sup.afm.replace(/\s+/g, "").replace(/^(EL|GR)/i, "").toUpperCase() === key;
      if (!mine) return;
      var total = billTotal(b), paid = billPaid(data, b.id), bal = total - paid, st = billStatus(data, b, day);
      out.rows.push({ id: b.id, num: b.num, sup: b.sup.name, date: b.date, due: b.due, total: total,
                      paid: paid, bal: bal, status: st, cur: b.cur });
      var t = out.totals[b.cur] || (out.totals[b.cur] = { billed: 0, paid: 0, open: 0, overdue: 0 });
      t.billed += total;
      t.paid += paid;
      if (bal > 0) { t.open += bal; if (st === "overdue") t.overdue += bal; }
    });
    out.rows.sort(function (x, y) { return cmpStr(y.date, x.date) || cmpStr(y.id, x.id); });
    return out;
  }
  // The suppliers you have recorded bills from, newest first, one per
  // name + ΑΦΜ: [{ name, afm, crm }] (the form's suggestions).
  function billSuppliers(data) {
    var seen = {}, out = [];
    live(data.bills).slice().sort(function (x, y) { return y.m - x.m || cmpStr(x.id, y.id); }).forEach(function (b) {
      var k = fold(b.sup.name) + "|" + b.sup.afm;
      if (seen[k]) return;
      seen[k] = 1;
      out.push({ name: b.sup.name, afm: b.sup.afm, crm: b.crm || "" });
    });
    return out;
  }

  // Wave 3 — EU reverse charge helper. A country from what people type
  // (ISO code, English, Greek or the local name) or from the prefix of
  // an EU VAT number ("DE123456789"; Greece uses EL).
  var EU = {
    AT: "austria|osterreich|αυστρια", BE: "belgium|belgique|belgie|belgien|βελγιο",
    BG: "bulgaria|българия|βουλγαρια", HR: "croatia|hrvatska|κροατια", CY: "cyprus|κυπρος",
    CZ: "czechia|czech republic|cesko|τσεχια", DK: "denmark|danmark|δανια",
    EE: "estonia|eesti|εσθονια", FI: "finland|suomi|φινλανδια", FR: "france|γαλλια",
    DE: "germany|deutschland|γερμανια", GR: "greece|hellas|ελλαδα|ελλας", HU: "hungary|magyarorszag|ουγγαρια",
    IE: "ireland|eire|ιρλανδια", IT: "italy|italia|ιταλια", LV: "latvia|latvija|λετονια",
    LT: "lithuania|lietuva|λιθουανια", LU: "luxembourg|λουξεμβουργο", MT: "malta|μαλτα",
    NL: "netherlands|nederland|holland|ολλανδια", PL: "poland|polska|πολωνια",
    PT: "portugal|πορτογαλια", RO: "romania|ρουμανια", SK: "slovakia|slovensko|σλοβακια",
    SI: "slovenia|slovenija|σλοβενια", ES: "spain|espana|ισπανια", SE: "sweden|sverige|σουηδια"
  };
  function euCountry(text) {
    var f = fold(text).replace(/[^a-z\u03b1-\u03c9\u0430-\u044f]+/g, " ").replace(/\s+/g, " ").trim();
    if (!f) return "";
    if (f.length === 2) {
      var up = f.toUpperCase() === "EL" ? "GR" : f.toUpperCase();
      return EU[up] ? up : "";
    }
    var padded = " " + f + " ";
    for (var k in EU) {
      if (EU[k].split("|").some(function (n) { return padded.indexOf(" " + n + " ") >= 0; })) return k;
    }
    return "";
  }
  function vatPrefix(afm) {
    var m = /^([A-Z]{2})[\s-]?[0-9A-Z]{2,13}$/.exec(String(afm || "").toUpperCase().replace(/\s+/g, ""));
    if (!m) return "";
    var c = m[1] === "EL" ? "GR" : m[1];
    return EU[c] ? c : "";
  }
  function partyCountry(p, sellerSide) {
    p = p || {};
    var c = euCountry(p.country) || vatPrefix(p.afm);
    if (!c && sellerSide && /^\d{9}$/.test(String(p.afm || "").replace(/\s+/g, ""))) c = "GR";   // a Greek ΑΦΜ
    return c;
  }
  // → { seller, client } country codes when the client is a business
  // (it has a VAT number) in another EU country than the seller; null
  // otherwise. The person still decides: the app only offers it.
  function reverseCharge(seller, cli) {
    if (!cli || !String(cli.afm || "").trim()) return null;
    var a = partyCountry(seller, true), b = partyCountry(cli, false);
    return a && b && a !== b ? { seller: a, client: b } : null;
  }

  // Wave 3 — payment QR (EPC069-12 "SEPA credit transfer", the code
  // European banking apps scan): the first valid IBAN in the profile's
  // bank lines (mod-97 checked), a EUR amount and the document number.
  function ibanOf(text) {
    var re = /\b([A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30})\b/g, m;
    var src = String(text || "").toUpperCase();
    while ((m = re.exec(src))) {
      var iban = m[1].replace(/ /g, "");
      if (iban.length >= 15 && iban.length <= 34 && ibanOk(iban)) return iban;
    }
    return "";
  }
  function ibanOk(iban) {
    var r = iban.slice(4) + iban.slice(0, 4), rem = 0;
    for (var i = 0; i < r.length; i++) {
      var ch = r.charCodeAt(i), v = ch >= 65 ? String(ch - 55) : r[i];
      for (var j = 0; j < v.length; j++) rem = (rem * 10 + (+v[j])) % 97;
    }
    return rem === 1;
  }
  // "" when it can't be made (no IBAN, no name, amount out of range).
  function epcPayload(name, ibanText, amt, ref) {
    var iban = ibanOf(ibanText);
    var nm = cleanText(name, 70);
    if (!iban || !nm || !isInt(amt) || amt < 1 || amt > 99999999999) return "";
    var eur = Math.floor(amt / 100) + "." + pad(amt % 100);
    return ["BCD", "002", "1", "SCT", "", nm, iban, "EUR" + eur, "", "", cleanText(ref, 140)].join("\n");
  }

  // Wave 46 — "Pay online": the user's OWN payment link (a Stripe
  // Payment Link such as https://buy.stripe.com/…, or any https page of
  // their payment provider), kept on the profile as the extra field
  // `paylink` (withExtras: older versions keep it untouched). orOS
  // never holds a payment key: the link is the user's, the payment
  // happens on the provider's page.
  //   payLinkOk(s)       → the cleaned link, or "" (https only, no
  //                        user:password, no spaces, ≤ 500 chars)
  //   payLinkFor(link, d) → the link for one document: on a Stripe host
  //                        it gets client_reference_id = the document
  //                        number (letters, digits, - and _ only) and
  //                        prefilled_email = the client's email; any
  //                        other host is left exactly as typed.
  function payLinkOk(s) {
    s = typeof s === "string" ? s.trim() : "";
    if (!s || s.length > 500 || /[\s<>"'`\\]/.test(s)) return "";
    var m = /^https:\/\/([a-z0-9.-]+)(?::\d{1,5})?(?:[\/?#].*)?$/i.exec(s);
    if (!m || m[1].indexOf(".") < 1 || /\.\.|^\.|\.$/.test(m[1])) return "";
    return s;
  }
  function payLinkFor(link, d) {
    var url = payLinkOk(link);
    if (!url) return "";
    var host = /^https:\/\/([^\/?#:]+)/i.exec(url)[1].toLowerCase();
    if (!/(^|\.)stripe\.com$/.test(host)) return url;
    var hash = "", hi = url.indexOf("#");
    if (hi >= 0) { hash = url.slice(hi); url = url.slice(0, hi); }
    var add = [];
    var ref = String((d && d.num) || "").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 200);
    if (ref && !/[?&]client_reference_id=/.test(url)) add.push("client_reference_id=" + encodeURIComponent(ref));
    var em = d && d.c && typeof d.c.email === "string" ? d.c.email.trim() : "";
    if (em && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em) && em.length <= 120 && !/[?&]prefilled_email=/.test(url)) {
      add.push("prefilled_email=" + encodeURIComponent(em));
    }
    if (!add.length) return url + hash;
    return url + (url.indexOf("?") >= 0 ? (/[?&]$/.test(url) ? "" : "&") : "?") + add.join("&") + hash;
  }

  // Wave 3 — business profiles. "" (or an unknown / deleted id) = the
  // main profile, prof.
  function profiles(data) {
    return [Object.assign({ id: "" }, data.prof || DEFAULT_PROF)].concat(live(data.profs || []));
  }
  function profileOf(data, pid) {
    return (pid && byId(data.profs, pid)) || data.prof || DEFAULT_PROF;
  }
  // The seller printed on a document: frozen at issue (s), else the
  // document's profile as it is now.
  function sellerOf(data, d) {
    return d && d.s ? d.s : normSeller(profileOf(data, d && d.pid));
  }
  // The series a profile uses for a kind: the first one linked to it
  // (series.pid), else `fallback` (the device's or the default).
  function seriesForProfile(data, kind, pid, fallback) {
    if (pid && byId(data.profs, pid)) {
      var l = seriesFor(data, kind).filter(function (s) { return s.pid === pid; });
      if (l.length) return l[0].id;
    }
    return fallback || defaultSeries(kind);
  }

  // Documents still owed with a due date on or before `until`,
  // earliest first (ties by id). For reminders, Today and Calendar.
  function dueList(data, until) {
    return live(data.docs).filter(function (d) {
      return owes(d) && d.due && d.due <= until && balance(data, d) > 0;
    }).sort(function (x, y) { return cmpStr(x.due, y.due) || cmpStr(x.id, y.id); });
  }
  // Wave 2 — the Calendar feed, the Today provider and the shell
  // reminder all read these, so they can never disagree.
  // Unpaid documents whose due date is `day` (Calendar rows).
  function dueOn(data, day) {
    if (!validDay(day)) return [];
    return live(data.docs).filter(function (d) {
      return owes(d) && d.due === day && balance(data, d) > 0;
    }).sort(function (x, y) { return cmpStr(x.num, y.num) || cmpStr(x.id, y.id); });
  }
  // Unpaid documents due by `until` (overdue ones included), as rows
  // for Today: { id, num, kind, who, due, bal, cur, late }.
  function dueRows(data, day, until) {
    return dueList(data, until).map(function (d) {
      return { id: d.id, num: d.num, kind: d.kind, who: partyName(data, d), due: d.due,
               bal: balance(data, d), cur: d.cur, late: d.due < day };
    });
  }
  // BR-ST-OUT (Stock's receiver, stock/core.js outRequest): the
  // request that takes an issued invoice or receipt out of stock, or
  // puts a credit note's goods back. Only lines with a code (SKU or
  // barcode) go; p = net unit price after the line and global
  // discounts, in cents. Stock opens a prefilled movement and writes
  // nothing until the person saves. null = nothing to send.
  var STOCK_SRC_RE = /^[A-Za-z0-9._-]{1,60}$/;
  function stockOut(d) {
    if (!d || d.st !== "issued" || ["inv", "rcpt", "cred"].indexOf(d.kind) < 0) return null;
    var g = (100 - (d.gDisc || 0)) / 100, lines = [];
    (d.lines || []).forEach(function (l) {
      if (!l || !l.code || !(l.q > 0)) return;
      lines.push({ code: l.code, q: l.q, p: Math.round(l.p * (100 - l.disc) / 100 * g) });
    });
    if (!lines.length) return null;
    var req = { ref: String(d.num || "").slice(0, 60), d: d.date, t: d.kind === "cred" ? "ret" : "out", lines: lines };
    if (STOCK_SRC_RE.test(d.id)) req.src = "invoices:" + d.id;
    return req;
  }
  // The shell reminder: unpaid documents overdue or due within `days`
  // days of `day`. null when there is nothing to say. `key` changes
  // with the day and the counts, so a growing list says it again.
  function reminder(data, day, days) {
    if (!validDay(day)) return null;
    var list = dueList(data, addDays(day, days > 0 ? days : 0));
    if (!list.length) return null;
    var late = list.filter(function (d) { return d.due < day; }).length;
    return { late: late, soon: list.length - late, first: list[0].id,
             key: "due-" + day + "-" + late + "-" + (list.length - late) };
  }
  // Currencies in use (documents that count), the profile's first.
  function currencies(data) {
    var seen = {}, out = [];
    var first = data.prof && data.prof.cur || "EUR";
    seen[first] = true;
    out.push(first);
    live(data.docs).forEach(function (d) {
      if (d.st !== "draft" && !seen[d.cur]) { seen[d.cur] = true; out.push(d.cur); }
    });
    return out;
  }
  // The dashboard of one currency over [from, to] (inclusive days).
  // Outstanding and overdue are as of `day`, whatever the period.
  function dashboard(data, from, to, cur, day) {
    var out = { invoiced: 0, net: 0, vat: 0, wht: 0, collected: 0, outstanding: 0, overdue: 0,
                count: 0, months: [], top: [], rates: [] };
    var months = {}, top = {}, rates = {};
    var mKeys = [];
    if (validDay(from) && validDay(to) && from <= to) {
      var k = from.slice(0, 7) + "-01", guard = 0;
      while (k.slice(0, 7) <= to.slice(0, 7) && guard++ < 240) {
        mKeys.push(k.slice(0, 7));
        k = addMonths(k, 1, 1);
      }
    }
    mKeys.forEach(function (m) { months[m] = { ym: m, inv: 0, col: 0 }; });
    var docsById = {};
    live(data.docs).forEach(function (d) {
      docsById[d.id] = d;
      if (d.cur !== cur || !counts(d)) return;
      var bal = balance(data, d);
      if (bal > 0) {
        out.outstanding += bal;
        if (d.due && d.due < (day || today())) out.overdue += bal;
      }
      if (!d.date || d.date < from || d.date > to) return;
      var tt = totals(d), sg = sign(d);
      out.invoiced += sg * tt.total;
      out.net += sg * tt.net;
      out.vat += sg * tt.vat;
      out.wht += sg * tt.wht;
      if (d.kind !== "cred") out.count++;
      var mo = months[d.date.slice(0, 7)];
      if (mo) mo.inv += sg * tt.total;
      var name = partyName(data, d) || "—";
      var key = d.cli || ("n:" + name.toLowerCase());
      var tp = top[key] || (top[key] = { name: name, cli: d.cli, amt: 0 });
      tp.amt += sg * tt.total;
      if (d.kind === "ext") {
        var rx = rates["x"] || (rates["x"] = { rate: null, base: 0, vat: 0 });
        rx.base += sg * tt.net; rx.vat += sg * tt.vat;
      } else {
        tt.rates.forEach(function (r) {
          var rr = rates[String(r.rate)] || (rates[String(r.rate)] = { rate: r.rate, base: 0, vat: 0 });
          rr.base += sg * r.base; rr.vat += sg * r.vat;
        });
      }
    });
    live(data.pays).forEach(function (p) {
      var d = docsById[p.doc];
      if (!d || d.cur !== cur || !counts(d) || p.date < from || p.date > to) return;
      out.collected += p.amt;
      var mo = months[p.date.slice(0, 7)];
      if (mo) mo.col += p.amt;
    });
    out.months = mKeys.map(function (m) { return months[m]; });
    out.top = Object.keys(top).map(function (k) { return top[k]; })
      .filter(function (x) { return x.amt !== 0; })
      .sort(function (x, y) { return y.amt - x.amt || cmpStr(x.name, y.name); }).slice(0, 5);
    out.rates = Object.keys(rates).map(function (k) { return rates[k]; }).sort(function (x, y) {
      if (x.rate === null) return 1;
      if (y.rate === null) return -1;
      return y.rate - x.rate;
    });
    return out;
  }

  // ---------- 7. Recurring templates ----------
  function stepRep(t, key) {
    var n = t.rep === "m" ? 1 : t.rep === "q" ? 3 : 12;
    return addMonths(key, n, t.dom || keyDate(key).getDate());
  }
  // The drafts a repeating template owes up to `day`: [{ tpl, date, id }],
  // at most 24 per template (a long absence does not flood the list).
  // The draft id is derived from template + date, so two devices that
  // both catch up make the SAME draft (one record after the merge).
  function recurringDue(data, day) {
    var out = [];
    live(data.tpls).forEach(function (t) {
      if (!t.rep || !t.next) return;
      var k = t.next, n = 0;
      while (k <= day && n < 24) {
        out.push({ tpl: t, date: k, id: hashId("rec-", t.id + "|" + k) });
        k = stepRep(t, k);
        n++;
      }
    });
    return out;
  }
  // The first date after `day` (the template's next run once caught up).
  function nextRun(t, day) {
    var k = t.next, guard = 0;
    while (k <= day && guard++ < 2000) k = stepRep(t, k);
    return k;
  }
  // A draft document from a template, on `date`.
  function draftFrom(data, t, date, id, m) {
    var cl = client(data, t.cli);
    var prof = data.prof || DEFAULT_PROF;
    var pid = typeof t.pid === "string" && byId(data.profs, t.pid) ? t.pid : "";
    var x = {
      id: id, kind: t.kind, st: "draft", ser: seriesForProfile(data, t.kind, pid), date: date,
      due: prof.days ? addDays(date, prof.days) : "", cur: t.cur, cli: cl ? cl.id : "",
      c: cl ? partyOfClient(cl) : {}, lines: t.lines, gDisc: t.gDisc, wht: t.wht, exempt: t.exempt,
      terms: t.terms, notes: t.notes, crm: cl && cl.crm ? cl.crm : "", m: m
    };
    if (pid) x.pid = pid;
    return normDoc(x);
  }
  function partyOfClient(c) {
    return { name: c.name, job: c.job, addr: c.addr, country: c.country, afm: c.afm,
             doy: c.doy, email: c.email, phone: c.phone };
  }

  // ---------- 8. Prefill, parsing + formatting, CSV ----------
  // BR-INV-NEW: __orosOpenAt("invoices", { new: {...} }) → a cleaned
  // prefill, or null when nothing usable came. A PREFILL, never data:
  // the app opens a draft and saves only on the user's Save.
  //   new: { crm?, name?, afm?, doy?, job?, addr?, country?, email?,
  //          phone?, cur?, items?: [{ d, q, p }], notes?,
  //          ref?: { app, id } }
  //   items: 1–50 lines, d ≤ 200 chars, 0 < q ≤ 100000, p in currency
  //   units (not cents) −10000000 ≤ p ≤ 10000000.
  function normPrefill(o) {
    if (!o || typeof o !== "object") return null;
    var out = { client: null, crm: crmId(o.crm), cur: "", items: [], notes: cleanBlock(o.notes, 500), ref: null,
                gDisc: isNum(o.gDisc) && o.gDisc > 0 && o.gDisc <= 100 ? round(o.gDisc, 2) : 0 };
    var p = normParty(o);
    if (p.name) out.client = p;
    if (typeof o.cur === "string" && o.cur) {
      if (!curOk(o.cur)) return null;
      out.cur = o.cur;
    }
    if (Array.isArray(o.items)) {
      o.items.slice(0, 50).forEach(function (it) {
        if (!it || typeof it !== "object") return;
        var d = cleanBlock(it.d, 200);
        var q = isNum(it.q) && it.q > 0 && it.q <= 100000 ? round(it.q, 3) : 0;
        var pr = isNum(it.p) && Math.abs(it.p) <= 10000000 ? Math.round(it.p * 100) : NaN;
        if (!d || !q || isNaN(pr)) return;
        var row = { d: d, q: q, p: pr };
        // Optional (Quote, Timesheet): VAT % and discount % per line,
        // code and unit. Left out → the profile's VAT, no discount.
        if (isNum(it.vat) && it.vat >= 0 && it.vat <= 100) row.vat = round(it.vat, 2);
        if (isNum(it.disc) && it.disc > 0 && it.disc <= 100) row.disc = round(it.disc, 2);
        var code = cleanText(it.code, LIM.code), unit = cleanText(it.unit, LIM.unit);
        if (code) row.code = code;
        if (unit) row.unit = unit;
        out.items.push(row);
      });
    }
    if (o.ref && typeof o.ref === "object" && /^[a-z0-9]{1,20}$/.test(o.ref.app || "") &&
        typeof o.ref.id === "string" && /^[A-Za-z0-9_-]{1,60}$/.test(o.ref.id)) {
      out.ref = { app: o.ref.app, id: o.ref.id };
    }
    if (!out.client && !out.items.length && !out.crm) return null;
    return out;
  }
  // The client of this data that a prefill means: crm id, then ΑΦΜ,
  // then the name (case and accents ignored). null when none.
  function fold(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
  }
  function matchClient(data, q) {
    if (!q) return null;
    var list = live(data.clients), i;
    if (q.crm) for (i = 0; i < list.length; i++) if (list[i].crm === q.crm) return list[i];
    var afm = cleanText(q.afm, LIM.short).replace(/\s+/g, "");
    if (afm) for (i = 0; i < list.length; i++) if (list[i].afm.replace(/\s+/g, "") === afm) return list[i];
    var n = fold(q.name);
    if (n) for (i = 0; i < list.length; i++) if (fold(list[i].name) === n) return list[i];
    return null;
  }

  // "45", "45,50", "45.5", "1.250,00", "1,250.00", "-12,5" → cents; NaN when not money.
  function parseMoney(text) {
    var s = String(text === null || text === undefined ? "" : text).trim().replace(/[\s€$£]/g, "");
    if (!s) return 0;
    var neg = false;
    if (s.charAt(0) === "-" || s.charAt(0) === "−") { neg = true; s = s.slice(1); }
    if (!/^\d[\d.,]*$/.test(s)) return NaN;
    var lastSep = Math.max(s.lastIndexOf(","), s.lastIndexOf("."));
    var intPart = s, dec = "";
    if (lastSep >= 0 && s.length - lastSep - 1 <= 2) {
      intPart = s.slice(0, lastSep);
      dec = s.slice(lastSep + 1);
    }
    intPart = intPart.replace(/[.,]/g, "");
    if (!/^\d+$/.test(intPart || "0") || !/^\d{0,2}$/.test(dec)) return NaN;
    var c = parseInt(intPart || "0", 10) * 100 + (dec ? parseInt((dec + "0").slice(0, 2), 10) : 0);
    if (c > LIM.money) return NaN;
    return neg ? -c : c;
  }
  // A plain number with "," or "." as the decimal mark: "1,5" → 1.5.
  // Thousands separators are not accepted here (quantities, %).
  function parseNum(text) {
    var s = String(text === null || text === undefined ? "" : text).trim().replace(",", ".");
    if (!s) return 0;
    if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
    return parseFloat(s);
  }
  // orosI18n (../i18n.js, in the browser): any language's locale.
  function locale(lang) {
    var I = typeof window !== "undefined" && window.orosI18n;
    return I && lang ? I.locale(lang) : (lang === "el" ? "el-GR" : "en-GB");
  }
  // Does the language write "1,5" (el, de, ...) rather than "1.5"?
  function decComma(lang) {
    if (lang === "el") return true;
    if (!lang || lang === "en") return false;
    try { return new Intl.NumberFormat(locale(lang)).format(1.5).indexOf(",") >= 0; } catch (e) { return false; }
  }
  function fmtMoney(c, cur, lang) {
    try {
      return new Intl.NumberFormat(locale(lang), { style: "currency", currency: cur }).format(c / 100);
    } catch (e) { return (c / 100).toFixed(2) + " " + cur; }
  }
  function fmtNumber(v, lang, maxDec) {
    try {
      return new Intl.NumberFormat(locale(lang), { maximumFractionDigits: maxDec === undefined ? 3 : maxDec }).format(v);
    } catch (e) { return String(v); }
  }
  // Money for an input field: "45" or "45,50" (el, de) / "45.50" (en).
  function moneyInput(c, lang) {
    if (!c) return "";
    var neg = c < 0;
    c = Math.abs(c);
    var whole = Math.floor(c / 100), dec = c % 100;
    return (neg ? "-" : "") + (dec ? whole + (decComma(lang) ? "," : ".") + pad(dec) : String(whole));
  }
  function numInput(v, lang) {
    if (!v) return v === 0 ? "0" : "";
    var s = String(v);
    return decComma(lang) ? s.replace(".", ",") : s;
  }
  // dd/mm/yyyy (both languages print the day first on an invoice).
  function fmtDay(key) {
    if (!validDay(key)) return "";
    return key.slice(8, 10) + "/" + key.slice(5, 7) + "/" + key.slice(0, 4);
  }

  // A text cell that Excel / LibreOffice would read as a formula gets
  // a leading apostrophe (CSV injection), then RFC 4180 quoting.
  function csvCell(v) {
    var s = String(v === null || v === undefined ? "" : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[";\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function csvMoney(c, lang) {
    var s = (Math.abs(c) / 100).toFixed(2);
    if (decComma(lang)) s = s.replace(".", ",");
    return (c < 0 ? "-" : "") + s;
  }
  function csvJoin(rows) {
    return "\ufeff" + rows.map(function (r) { return r.map(csvCell).join(";"); }).join("\r\n") + "\r\n";
  }
  // Documents (not drafts) with a date in [from, to], oldest first.
  // `head` = column titles in the user's language (13), statusName(st)
  // and kindName(kind) give the words.
  function docsCsv(data, from, to, head, kindName, statusName, lang, day) {
    var rows = [head];
    docsRows(data, from, to, kindName, statusName, day).forEach(function (r) {
      rows.push(r.map(function (v, i) {
        if (i === 3 || i === 4) return fmtDay(v);
        return i >= DOCS_MONEY[0] && i <= DOCS_MONEY[1] ? csvMoney(v, lang) : v;
      }));
    });
    return csvJoin(rows);
  }
  // The rows behind docsCsv, raw: dates as YYYY-MM-DD, amounts in
  // cents (signed like the CSV) in columns DOCS_MONEY[0]..[1]. The
  // app's "Open in Spreadsheet" (Bible BR-S1) uses them as numbers.
  var DOCS_MONEY = [8, 14];
  function docsRows(data, from, to, kindName, statusName, day) {
    return live(data.docs).filter(function (d) {
      return d.st !== "draft" && d.date >= from && d.date <= to;
    }).sort(function (x, y) { return cmpStr(x.date, y.date) || cmpStr(x.num, y.num) || cmpStr(x.id, y.id); })
      .map(function (d) {
        var tt = totals(d), sg = sign(d);
        return [d.num, kindName(d.kind), statusName(status(data, d, day)), d.date, d.due,
                partyName(data, d), d.c.afm, d.cur, sg * tt.net, sg * tt.vat,
                sg * tt.total, sg * tt.wht, sg * tt.pay, paidOf(data, d.id), balance(data, d), d.mark];
      });
  }
  function paysCsv(data, from, to, head, howName, lang) {
    var rows = [head];
    live(data.pays).filter(function (p) { return p.date >= from && p.date <= to; })
      .sort(function (x, y) { return cmpStr(x.date, y.date) || cmpStr(x.id, y.id); })
      .forEach(function (p) {
        var d = anyId(data.docs, p.doc);
        if (!d || d.del) return;
        rows.push([fmtDay(p.date), d.num, partyName(data, d), csvMoney(p.amt, lang), d.cur, howName(p.how), p.note]);
      });
    return csvJoin(rows);
  }

  var API = {
    VERSION: VERSION, STORAGE_KEY: STORAGE_KEY, DATA_VER: DATA_VER, KINDS: KINDS, STATES: STATES,
    HOWS: HOWS, REPS: REPS, CURRENCIES: CURRENCIES, LIM: LIM, ID_RE: ID_RE,
    DEFAULT_SERIES: DEFAULT_SERIES, DEFAULT_PROF: DEFAULT_PROF, LOGO_RE: LOGO_RE,
    isInt: isInt, isNum: isNum, cleanText: cleanText, cleanBlock: cleanBlock, round: round,
    dayKey: dayKey, today: today, keyDate: keyDate, validDay: validDay, addDays: addDays,
    addMonths: addMonths, dayDiff: dayDiff, newId: newId, hashId: hashId, curOk: curOk,
    normParty: normParty, normSeller: normSeller, normLine: normLine, normLines: normLines,
    normSeries: normSeries, normClient: normClient, normDoc: normDoc, normPay: normPay,
    normTpl: normTpl, normProf: normProf, normBill: normBill, normBpay: normBpay,
    mergeInvoices: mergeInvoices, normalize: normalize, empty: empty, parse: parse,
    toBackup: toBackup, fromBackup: fromBackup,
    live: live, byId: byId, anyId: anyId, doc: doc, client: client, clientOf: clientOf,
    partyName: partyName, partyOfClient: partyOfClient,
    seriesList: seriesList, series: series, seriesFor: seriesFor, defaultSeries: defaultSeries,
    seriesSample: seriesSample, fmtNum: fmtNum, nextSeq: nextSeq, numbered: numbered,
    clashes: clashes, clashKeeper: clashKeeper,
    lineNet: lineNet, totals: totals, paysOf: paysOf, paidOf: paidOf, creditsOf: creditsOf,
    owes: owes, balance: balance, status: status, lateDays: lateDays, sign: sign, counts: counts,
    byCrm: byCrm, clientOpen: clientOpen, dueList: dueList, dueOn: dueOn, dueRows: dueRows, reminder: reminder, stockOut: stockOut, statement: statement,
    bySrc: bySrc, billTotal: billTotal, billPays: billPays, billPaid: billPaid, billBalance: billBalance,
    billStatus: billStatus, bill: bill, billsOpen: billsOpen, billsByCrm: billsByCrm, billSuppliers: billSuppliers,
    EU: EU, euCountry: euCountry, vatPrefix: vatPrefix, reverseCharge: reverseCharge,
    ibanOf: ibanOf, ibanOk: ibanOk, epcPayload: epcPayload, payLinkOk: payLinkOk, payLinkFor: payLinkFor,
    normBiz: normBiz, profiles: profiles, profileOf: profileOf, sellerOf: sellerOf, seriesForProfile: seriesForProfile,
    currencies: currencies, dashboard: dashboard,
    recurringDue: recurringDue, nextRun: nextRun, draftFrom: draftFrom, stepRep: stepRep,
    normPrefill: normPrefill, matchClient: matchClient, fold: fold,
    parseMoney: parseMoney, parseNum: parseNum, fmtMoney: fmtMoney, fmtNumber: fmtNumber,
    moneyInput: moneyInput, numInput: numInput, fmtDay: fmtDay,
    csvCell: csvCell, docsCsv: docsCsv, docsRows: docsRows, DOCS_MONEY: DOCS_MONEY, paysCsv: paysCsv
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root && root.document) root.OrosInvoicesCore = API;
})(typeof window !== "undefined" ? window : globalThis);
