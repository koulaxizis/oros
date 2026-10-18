// ============================================================
// orOS Split — import.js (pure logic: "Import from another app")
// i18n-inline-ok: the Greek words below are column, category and type names of imported files (parser data, no UI text)
// Reads a group exported from another shared-expenses app, as DATA
// only (nothing is run, nothing becomes HTML):
//   - Splitwise  a group › Export as spreadsheet (CSV): Date,
//                Description, Category, Cost, Currency, then one
//                column per member holding that member's NET for
//                the row (positive = paid more than owed); payments
//                have Category "Payment"; the last row(s) "Total
//                balance" (one per currency) are the balances
//   - Tricount   Export (Excel .xlsx or CSV): Title, Amount,
//                Currency, Date, Paid by, "Impacted to <name>" (or
//                "Paid for <name>", or bare member-name) share
//                columns, Category, Transaction type (expense,
//                money transfer, income), optional converted amount
//   - Settle Up  Export (CSV / .xlsx): Who paid, Amount, Currency,
//                For whom (names; weights inline "Ann (2)" or in a
//                Split amounts / Weights column), Purpose, Category,
//                Date, Exchange rate / Converted amount, Type
//                (transfer = a payment)
// A .xlsx is opened with the vendored SheetJS, handed in by the
// caller (loaded lazily only when an .xlsx is picked); any other
// ZIP is searched for a .csv.
//   parseRows(aoa, name)   → { source, name (suggested group name),
//                              cur, members [names], items [{ k "e"|
//                              "p", key, t, d, c, cur, rate, a (cents
//                              in cur), by { name: cents }, owe {
//                              name: cents } }], want { name: cents }
//                              (the source's own balances in cur),
//                              wantFrom "totals"|"rows", skipped {
//                              reason: n }, found } or { error }
//   parseText(text, name)  → the same from a CSV
//   readBytes(bytes, name, getXlsx) → Promise of the same; getXlsx()
//                              → Promise<XLSX> (only called for .xlsx)
//   plan(res, data, opts)  → the records an import would ADD to the
//                              Split data (split.js state): group
//                              (new or the existing imported one),
//                              people, expenses ("ex" mode, exact
//                              cents; another currency → fx with the
//                              file's rate), payments; counts; the
//                              balance check { ok, diffs }
// Stable ids (Split ids are [a-z0-9] only, so no "imp-"): the group
// is "imp" + hash(source + member names), an expense or payment
// "<group>.imp" + hash(source, date, title, amounts, nth duplicate),
// a person "<group>.imp" + hash(name): importing the same file again
// adds only what is missing; something you deleted from an imported
// group stays deleted. Caps: file size, rows, people, title length.
// Needs OrosImportKit (../importkit.js); a ZIP needs AtelierZip.
// UMD: window.OrosSplitImport in the browser, module.exports in Node.
// ============================================================
(function (root) {
  "use strict";

  var K = (typeof module !== "undefined" && module.exports && typeof require === "function")
    ? require("../importkit.js") : root.OrosImportKit;

  var MAX_FILE = 15 * 1024 * 1024;
  var MAX_TEXT = 15 * 1024 * 1024;
  var MAX_ROWS = 20000;
  var MAX_PEOPLE = 30;              // split.js MAX_PEOPLE
  var MAX_EXP = 3000;               // split.js MAX_EXP (expenses + payments)
  var MAX_CENTS = 100000000000;     // split.js MAX_CENTS
  var NAME_LEN = 40, PERSON_LEN = 30, TITLE_LEN = 60;
  var CURRENCIES = ["EUR", "USD", "GBP", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK",
                    "HUF", "RON", "BGN", "TRY", "CAD", "AUD", "JPY"];   // split.js
  var SRC_NAME = { splitwise: "Splitwise", tricount: "Tricount", settleup: "Settle Up" };

  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function lc(s) { return String(s).toLowerCase(); }

  // ---------- 1. Cells ----------
  function str(v) {
    if (v === null || v === undefined) return "";
    if (v instanceof Date) return isNaN(v.getTime()) ? "" : v.toISOString();
    return String(v);
  }
  function blank(row) { return !row || row.every(function (v) { return K.clean(str(v)) === ""; }); }
  // money cell → cents (NaN when not a number)
  function cents(v) {
    var n = typeof v === "number" ? v : K.num(str(v));
    if (!isFinite(n) || Math.abs(n) > MAX_CENTS / 100) return NaN;
    return Math.round(n * 100);
  }
  function rateOf(v) {
    var n = typeof v === "number" ? v : K.num(str(v));
    return isFinite(n) && n > 0 && n < 1000000 ? Number(n.toPrecision(6)) : 0;
  }
  function curOf(v) {
    var s = K.clean(str(v), 10).toUpperCase();
    var map = { "€": "EUR", "$": "USD", "£": "GBP", "¥": "JPY", "KČ": "CZK", "ZŁ": "PLN", "LEI": "RON", "ЛВ": "BGN", "FT": "HUF" };
    if (map[s]) return map[s];
    return /^[A-Z]{3}$/.test(s) ? s : "";
  }
  // D/M/Y or M/D/Y, from the values themselves
  function dateHint(vals) {
    var dmy = false, mdy = false;
    vals.forEach(function (v) {
      var m = /^\s*(\d{1,2})[\/.\-](\d{1,2})[\/.\-]\d{2,4}/.exec(typeof v === "string" ? v : "");
      if (!m) return;
      if (+m[1] > 12) dmy = true;
      if (+m[2] > 12) mdy = true;
    });
    return dmy && !mdy ? "dmy" : (mdy && !dmy ? "mdy" : "");
  }
  function dayOf(v, hint) {
    if (v instanceof Date) {
      if (isNaN(v.getTime())) return "";
      // SheetJS dates: local midnight (± a few seconds of rounding)
      var d = new Date(v.getTime() + 30000);
      return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    }
    if (typeof v === "number" && v > 20000 && v < 80000) {      // Excel serial day
      var u = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000);
      return u.getUTCFullYear() + "-" + pad(u.getUTCMonth() + 1) + "-" + pad(u.getUTCDate());
    }
    var s = K.clean(str(v), 80);
    var iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);       // the date as written, no time-zone shift
    var r = iso ? K.ymd(iso[0]) : K.ymd(s.replace(/\s+(GMT|UTC)?[+-]\d{2}:?\d{2}$/i, ""), hint);
    return r && +r.slice(0, 4) >= 1900 ? r : "";
  }

  // ---------- 2. Categories → Split's fixed ids ----------
  var CATS = [
    ["groc", /🛒|grocer|supermarket|household|σούπερ|σουπερ|τρόφιμα|παντοπ/],
    ["bills", /💡|🔌|📱|electric|heat|water|utilit|\btv\b|phone|internet|bill|clean|trash|insurance|λογαρ|ρεύμα|νερό|τηλέφ/],
    ["stay", /🏨|🏠|🏡|⛺|hotel|accommodation|lodging|rent|mortgage|airbnb|hostel|\bstay|camping|διαμον|ξενοδ|ενοίκ|κατάλυ/],
    ["trans", /🚕|🚗|🚌|🚆|✈|⛽|🚢|transport|taxi|uber|\bcar\b|gas|fuel|parking|\bbus|train|plane|flight|bicycle|ferry|toll|μεταφ|ταξί|βενζ|καύσιμ|εισιτ.*(πλοί|τρέν)/],
    ["food", /🍔|🍕|🍽|🍺|🍷|☕|dining|restaurant|food|drink|\bbars?\b|cafe|coffee|liquor|meal|lunch|dinner|breakfast|\beat|φαγ|εστιατ|καφ|ποτ/],
    ["fun", /🎉|🎬|🎟|🎫|🎮|entertain|movie|cinema|game|music|sport|concert|ticket|\bfun|party|leisure|activit|ψυχαγ|σινεμ|διασκ/]
  ];
  function catOf(v) {
    var s = lc(K.clean(str(v), 80));
    if (!s) return "other";
    for (var i = 0; i < CATS.length; i++) if (CATS[i][1].test(s)) return CATS[i][0];
    return "other";
  }

  // ---------- 3. People ----------
  // A members registry: case-insensitive, first spelling kept.
  function Members() { this.list = []; this.by = {}; }
  Members.prototype.add = function (n) {
    var name = K.clean(str(n), PERSON_LEN);
    if (!name) return "";
    var k = lc(name);
    if (!this.by[k]) { this.by[k] = name; this.list.push(name); }
    return this.by[k];
  };
  Members.prototype.find = function (n) { return this.by[lc(K.clean(str(n), PERSON_LEN))] || ""; };

  // "Ann; Bob (2); Cy: 1,5" → [{ n, w }] (w null when not given).
  // Commas separate only when the cell has no ; | or newline and the
  // whole cell is not one known member.
  function nameList(v, known) {
    var s = K.cleanText(str(v), 2000);
    if (!s) return [];
    var parts;
    if (/[;|\n]/.test(s)) parts = s.split(/[;|\n]+/);
    else if (/,/.test(s) && !(known && known.find(s))) parts = s.split(/,(?!\d)/);
    else parts = [s];
    var out = [];
    parts.forEach(function (p) {
      p = K.clean(p, 80);
      if (!p) return;
      var m = /^(.*?)\s*(?:\(\s*([\d.,]+)\s*x?\s*\)|:\s*([\d.,]+)|\s[x×]\s*([\d.,]+))$/i.exec(p);
      if (m && m[1]) out.push({ n: m[1], w: K.num(m[2] || m[3] || m[4]) });
      else out.push({ n: p, w: null });
    });
    return out;
  }
  function numList(v) {
    var s = K.clean(str(v), 2000);
    if (!s) return [];
    return s.split(/[;|]+/).map(function (x) { return K.num(x); });
  }

  // ---------- 4. Shares ----------
  // Exactly like split.js allot(): `total` cents in proportion to the
  // positive integer weights of `w`, odd cents to the largest
  // remainders, ties by key order. (A copy: Split checks fx amounts
  // with its own, so they must agree.)
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
  function dropZero(m) {
    var o = {};
    Object.keys(m).sort(cmpStr).forEach(function (k) { if (m[k] > 0) o[k] = m[k]; });
    return o;
  }
  function sum(m) { var s = 0; Object.keys(m).forEach(function (k) { s += m[k]; }); return s; }
  // { name: weight (any positive number) } → integer weights
  function intWeights(m) {
    var o = {};
    Object.keys(m).forEach(function (k) { if (m[k] > 0) o[k] = Math.max(1, Math.round(m[k] * 10000)); });
    return o;
  }

  // ---------- 5. Result builder ----------
  function Result(source, name) {
    this.source = source;
    this.name = name;
    this.items = [];
    this.skipped = {};
    this.found = 0;
    this.mem = new Members();
    this.raw = {};          // cur → { name: float } balances from the source's numbers
    this.totals = null;     // Splitwise: cur → { name: cents }
    this.seen = {};
  }
  Result.prototype.skip = function (why) { this.skipped[why] = (this.skipped[why] || 0) + 1; };
  // v in the row's currency; with a rate it is already converted
  // into the main currency (whatever that turns out to be)
  Result.prototype.rawAdd = function (cur, name, v, rate) {
    var b = rate ? "~" : (cur || "");
    var r = this.raw[b] || (this.raw[b] = {});
    r[name] = (r[name] || 0) + v;
  };
  // one expense / payment; by and owe: { name: cents } in `cur`
  Result.prototype.push = function (it) {
    var base = [this.source, it.k, it.d, lc(it.t), it.cur, it.a,
                Object.keys(it.by).sort(cmpStr).map(function (k) { return lc(k) + ":" + it.by[k]; }).join(","),
                Object.keys(it.owe).sort(cmpStr).map(function (k) { return lc(k) + ":" + it.owe[k]; }).join(",")].join("|");
    var nth = this.seen[base] = (this.seen[base] || 0) + 1;
    it.key = base + "|" + nth;
    this.items.push(it);
  };
  Result.prototype.done = function () {
    if (!this.items.length) return { error: this.found ? "none" : "empty", source: this.source, skipped: this.skipped };
    var used = {};
    this.items.forEach(function (it) {
      Object.keys(it.by).concat(Object.keys(it.owe)).forEach(function (n) { used[lc(n)] = 1; });
    });
    var members = this.mem.list.filter(function (n) { return used[lc(n)]; });
    if (members.length > MAX_PEOPLE) return { error: "people", source: this.source };
    // the group's currency: the most used supported one
    var count = {};
    this.items.forEach(function (it) { if (it.cur) count[it.cur] = (count[it.cur] || 0) + 1; });
    var cur = "", best = -1;
    Object.keys(count).sort(cmpStr).forEach(function (c) {
      if (CURRENCIES.indexOf(c) >= 0 && count[c] > best) { cur = c; best = count[c]; }
    });
    if (!cur && Object.keys(count).length) return { error: "cur", source: this.source, cur: Object.keys(count)[0] };
    cur = cur || "EUR";
    var self = this, items = [];
    this.items.forEach(function (it) {
      if (!it.cur) it.cur = cur;
      if (it.cur !== cur && !it.rate) { self.skip("cur"); return; }
      if (it.cur === cur) it.rate = 0;
      items.push(it);
    });
    if (!items.length) return { error: "none", source: this.source, skipped: this.skipped };
    var want = {}, wantFrom = "rows";
    if (this.totals && this.totals[cur]) { want = this.totals[cur]; wantFrom = "totals"; }
    else {
      var raw = {};
      [this.raw[cur] || {}, this.raw[""] || {}, this.raw["~"] || {}].forEach(function (m) {
        Object.keys(m).forEach(function (n) { raw[n] = (raw[n] || 0) + m[n]; });
      });
      Object.keys(raw).forEach(function (n) { want[n] = Math.round(raw[n] * 100); });
    }
    return { source: this.source, name: this.name, cur: cur, members: members, items: items,
             want: want, wantFrom: wantFrom, skipped: this.skipped, found: this.found };
  };

  // ---------- 6. Splitwise ----------
  function parseSplitwise(head, rows, res) {
    var c = function (names) { return K.col(head, names); };
    var iD = c(["date"]), iT = c(["description"]), iC = c(["category"]), iA = c(["cost"]), iU = c(["currency"]);
    var fixed = [iD, iT, iC, iA, iU];
    var cols = [];
    head.forEach(function (h, i) {
      if (fixed.indexOf(i) < 0 && K.clean(h)) cols.push({ i: i, n: res.mem.add(h) });
    });
    if (!cols.length) return { error: "bad" };
    var hint = dateHint(rows.map(function (r) { return r[iD]; }));
    rows.forEach(function (r) {
      if (blank(r)) return;
      var title = K.clean(str(r[iT]), TITLE_LEN), cur = curOf(r[iU]);
      var nets = {}, okNets = true;
      cols.forEach(function (cc) {
        var v = K.clean(str(r[cc.i])) === "" ? 0 : cents(r[cc.i]);
        if (!isFinite(v)) okNets = false; else if (v) nets[cc.n] = (nets[cc.n] || 0) + v;
      });
      if (/^total balance$/i.test(title) || (/total/i.test(title) && !K.clean(str(r[iD])))) {
        if (okNets) {
          res.totals = res.totals || {};
          var tm = res.totals[cur || ""] = {};
          cols.forEach(function (cc) { tm[cc.n] = nets[cc.n] || 0; });
        }
        return;
      }
      res.found++;
      var d = dayOf(r[iD], hint), a = cents(r[iA]);
      if (!d || !isFinite(a) || !okNets) { res.skip("bad"); return; }
      if (a <= 0) { res.skip("zero"); return; }
      Object.keys(nets).forEach(function (n) { res.rawAdd(cur, n, nets[n] / 100); });
      var pos = [], neg = [];
      cols.forEach(function (cc) {
        var v = nets[cc.n] || 0;
        if (v > 0) pos.push(cc.n); else if (v < 0) neg.push(cc.n);
      });
      if (/^payment$/i.test(K.clean(str(r[iC])))) {
        // a payment: who paid (positive) → who received (negative)
        if (pos.length !== 1 || !neg.length) { res.skip("bad"); return; }
        neg.forEach(function (n) {
          var by = {}, owe = {};
          by[pos[0]] = -nets[n];
          owe[n] = -nets[n];
          res.push({ k: "p", t: title, d: d, c: "other", cur: cur, rate: 0, a: -nets[n], by: by, owe: owe });
        });
        return;
      }
      // an expense: non-payers owe -net; what is left of the cost is
      // the payers' own share (equal between them), and each payer
      // paid share + net (only the balances are known, and those stay
      // exact)
      var owe = {}, others = 0;
      neg.forEach(function (n) { owe[n] = -nets[n]; others += -nets[n]; });
      var rest = a - others;
      var payers = pos;
      if (!pos.length) { res.skip("even"); return; }        // nobody owes anybody: no effect
      if (rest < 0) { res.skip("bad"); return; }
      var one = {};
      payers.forEach(function (n) { one[n] = 1; });
      var own = rest > 0 ? allot(one, rest, 0) : {};
      var by = {};
      payers.forEach(function (n) {
        if (own[n]) owe[n] = own[n];
        var p = (own[n] || 0) + (nets[n] || 0);
        if (p > 0) by[n] = p;
      });
      if (sum(by) !== a) {
        // the nets do not add up to the cost (rounding in the file):
        // trust the nets — what the payers paid is the cost
        if (pos.length !== 1 || sum(owe) !== a) { res.skip("bad"); return; }
        by = {};
        by[pos[0]] = a;
      }
      res.push({ k: "e", t: title, d: d, c: catOf(r[iC]), cur: cur, rate: 0, a: a, by: by, owe: dropZero(owe) });
    });
    return null;
  }

  // ---------- 7. Tricount ----------
  var TR_TITLE = ["title", "description", "what", "name", "libellé", "libelle", "titel", "concept", "τίτλος", "περιγραφή"];
  var TR_AMOUNT = ["amount", "montant", "betrag", "importe", "importo", "bedrag", "ποσό"];
  var TR_CONV = ["amount in default currency", "converted amount", "amount in main currency", "montant dans la devise principale", "amount (converted)"];
  var TR_CUR = ["currency", "devise", "währung", "moneda", "valuta", "νόμισμα"];
  var TR_DATE = ["date", "transaction date", "date of transaction", "created", "datum", "fecha", "data", "ημερομηνία"];
  var TR_PAID = ["paid by", "payer", "payé par", "paye par", "bezahlt von", "pagado por", "pagato da", "betaald door", "πληρώθηκε από", "πλήρωσε"];
  var TR_TYPE = ["transaction type", "type", "type de transaction", "τύπος"];
  var TR_CAT = ["category", "catégorie", "categorie", "kategorie", "categoría", "κατηγορία"];
  var TR_RATE = ["exchange rate", "rate", "taux de change", "ισοτιμία"];
  var SHARE_RE = /^(?:impacted to|impacted|paid for|for|share of|share|part of|part de|concerné|concerne|für|para|per|για)\s*:?\s*(.+?)(?:\s*\(?(?:amount|share|montant)\)?)?$/i;

  function parseTricount(head, rows, res) {
    var c = function (names) { return K.col(head, names); };
    var iT = c(TR_TITLE), iA = c(TR_AMOUNT), iV = c(TR_CONV), iU = c(TR_CUR), iD = c(TR_DATE), iP = c(TR_PAID),
        iY = c(TR_TYPE), iC = c(TR_CAT), iR = c(TR_RATE);
    if (iA < 0 || iP < 0) return { error: "bad" };
    var fixed = [iT, iA, iV, iU, iD, iP, iY, iC, iR];
    // payers first, so bare member-name columns can be recognised
    rows.forEach(function (r) {
      if (blank(r)) return;
      var p = K.clean(str(r[iP]), 200);
      if (p) nameList(p, null).forEach(function (x) { if (!/,/.test(x.n)) res.mem.add(x.n); });
    });
    var shares = [];
    head.forEach(function (h, i) {
      if (fixed.indexOf(i) >= 0 || !K.clean(h)) return;
      var m = SHARE_RE.exec(K.clean(h));
      if (m && K.clean(m[1])) shares.push({ i: i, n: res.mem.add(m[1]) });
    });
    if (!shares.length) {
      head.forEach(function (h, i) {
        if (fixed.indexOf(i) < 0 && res.mem.find(h)) shares.push({ i: i, n: res.mem.find(h) });
      });
    }
    if (!shares.length) return { error: "bad" };
    var hint = dateHint(rows.map(function (r) { return r[iD]; }));
    rows.forEach(function (r) {
      if (blank(r)) return;
      res.found++;
      var title = K.clean(str(r[iT]), TITLE_LEN), cur = curOf(r[iU]);
      var a = cents(r[iA]), d = dayOf(r[iD], hint);
      if (!isFinite(a) || !d) { res.skip("bad"); return; }
      if (!a) { res.skip("zero"); return; }
      a = Math.abs(a);
      var type = lc(K.clean(str(r[iY])));
      var payers = nameList(r[iP], res.mem).map(function (x) { return res.mem.find(x.n) || res.mem.add(x.n); }).filter(Boolean);
      if (!payers.length) { res.skip("bad"); return; }
      var w = {}, bool = true, any = false;
      shares.forEach(function (s) {
        var raw = K.clean(str(r[s.i]));
        if (!raw) return;
        if (/^(x|yes|true|oui|ja|ναι|✓|✔)$/i.test(raw)) { w[s.n] = (w[s.n] || 0) + 1; any = true; return; }
        var v = typeof r[s.i] === "number" ? r[s.i] : K.num(raw);
        if (!isFinite(v) || !v) return;
        if (Math.abs(v) !== 1) bool = false;
        w[s.n] = (w[s.n] || 0) + Math.abs(v);
        any = true;
      });
      if (!any) { res.skip("bad"); return; }
      var exact = !bool && Math.abs(Math.round(sum(w) * 100) - a) <= shares.length;
      var owe = dropZero(allot(intWeights(w), a, 0));
      var conv = iV >= 0 ? cents(r[iV]) : NaN, rate = 0;
      if (isFinite(conv) && conv && Math.abs(conv) !== a) rate = Number((Math.abs(conv) / a).toPrecision(6));
      else if (iR >= 0) rate = rateOf(r[iR]);
      var one = {};
      payers.forEach(function (n) { one[n] = 1; });
      var by = allot(one, a, 0);
      var isPay = /transfer|reimburs|rembours|virement|payment|settle|balance|überweis|μεταφορ|εξόφλ|πληρωμ/.test(type);
      var isIncome = !isPay && /income|revenu|recette|einnahme|έσοδ/.test(type);
      // the source's own balance numbers (exact shares when given)
      var f = rate || 1, W = sum(w);
      Object.keys(by).forEach(function (n) { res.rawAdd(cur, n, (isIncome ? -1 : 1) * by[n] / 100 * f, rate); });
      Object.keys(w).forEach(function (n) {
        var s = exact ? w[n] : a / 100 * w[n] / W;
        res.rawAdd(cur, n, (isIncome ? 1 : -1) * s * f, rate);
      });
      if (isPay) {
        var to = Object.keys(owe);
        if (payers.length !== 1 || to.length !== 1 || to[0] === payers[0]) { res.skip("bad"); return; }
        res.push({ k: "p", t: title, d: d, c: "other", cur: cur, rate: rate, a: a, by: by, owe: owe });
        return;
      }
      // income: money the payer received for the others — the same
      // balances as the others paying their parts for the payer
      if (isIncome) res.push({ k: "e", t: title, d: d, c: catOf(r[iC]), cur: cur, rate: rate, a: a, by: owe, owe: by, inc: 1 });
      else res.push({ k: "e", t: title, d: d, c: catOf(r[iC]), cur: cur, rate: rate, a: a, by: by, owe: owe });
    });
    return null;
  }

  // ---------- 8. Settle Up ----------
  var SU_WHO = ["who paid", "paid by", "payer", "qui a payé", "wer hat bezahlt", "ποιος πλήρωσε"];
  var SU_FOR = ["for whom", "pour qui", "für wen", "για ποιον"];
  var SU_SPLIT = ["split amounts", "split", "weights", "for whom weights", "amounts", "shares"];
  var SU_PURPOSE = ["purpose", "description", "title", "what", "σκοπός", "περιγραφή"];
  var SU_DATE = ["date & time", "date and time", "date", "datetime", "time", "ημερομηνία"];
  var SU_CONV = ["converted amount", "amount in group currency"];

  function parseSettleUp(head, rows, res) {
    var c = function (names) { return K.col(head, names); };
    var iW = c(SU_WHO), iA = c(TR_AMOUNT), iU = c(TR_CUR), iF = c(SU_FOR), iS = c(SU_SPLIT), iT = c(SU_PURPOSE),
        iD = c(SU_DATE), iC = c(TR_CAT), iR = c(TR_RATE), iV = c(SU_CONV), iY = c(["type"]);
    if (iW < 0 || iF < 0 || iA < 0) return { error: "bad" };
    rows.forEach(function (r) {
      if (blank(r)) return;
      nameList(r[iW], null).concat(nameList(r[iF], null)).forEach(function (x) { if (!/,/.test(x.n)) res.mem.add(x.n); });
    });
    var hint = dateHint(rows.map(function (r) { return r[iD]; }));
    rows.forEach(function (r) {
      if (blank(r)) return;
      res.found++;
      var title = K.clean(str(r[iT]), TITLE_LEN), cur = curOf(r[iU]), d = dayOf(r[iD], hint);
      var who = nameList(r[iW], res.mem), fw = nameList(r[iF], res.mem);
      if (!d || !who.length || !fw.length) { res.skip("bad"); return; }
      // amount: one total, or one per payer ("10;20")
      var aCell = str(r[iA]), aList = /[;|]/.test(aCell) ? numList(aCell) : null;
      var by = {}, a;
      if (aList && aList.length === who.length && aList.every(isFinite)) {
        a = 0;
        who.forEach(function (x, j) {
          var n = res.mem.find(x.n), v = Math.round(Math.abs(aList[j]) * 100);
          if (n && v) { by[n] = (by[n] || 0) + v; a += v; }
        });
      } else {
        a = Math.abs(cents(r[iA]));
        if (!isFinite(a)) { res.skip("bad"); return; }
        var pw = {};
        who.forEach(function (x) { var n = res.mem.find(x.n); if (n) pw[n] = (pw[n] || 0) + (x.w > 0 ? x.w : 1); });
        by = dropZero(allot(intWeights(pw), a, 0));
      }
      if (!a) { res.skip("zero"); return; }
      if (!Object.keys(by).length) { res.skip("bad"); return; }
      // for whom: weights inline, or a list in the split column
      var sl = iS >= 0 ? numList(r[iS]) : [];
      var w = {}, given = false;
      fw.forEach(function (x, j) {
        var n = res.mem.find(x.n);
        if (!n) return;
        var v = sl.length === fw.length && isFinite(sl[j]) ? Math.abs(sl[j]) : (x.w > 0 ? x.w : (x.w === 0 ? 0 : 1));
        if (sl.length === fw.length || x.w !== null) given = true;
        if (v > 0) w[n] = (w[n] || 0) + v;
      });
      if (!Object.keys(w).length) { res.skip("bad"); return; }
      var exact = given && Math.abs(Math.round(sum(w) * 100) - a) <= fw.length && sum(w) > fw.length;
      var owe = dropZero(allot(intWeights(w), a, 0));
      var conv = iV >= 0 ? cents(r[iV]) : NaN, rate = 0;
      if (isFinite(conv) && conv && Math.abs(conv) !== a) rate = Number((Math.abs(conv) / a).toPrecision(6));
      else if (iR >= 0) rate = rateOf(r[iR]);
      var f = rate || 1, W = sum(w);
      Object.keys(by).forEach(function (n) { res.rawAdd(cur, n, by[n] / 100 * f, rate); });
      Object.keys(w).forEach(function (n) { res.rawAdd(cur, n, -(exact ? w[n] : a / 100 * w[n] / W) * f, rate); });
      var type = lc(K.clean(str(r[iY])));
      if (/transfer|payment|settle|μεταφορ|πληρωμ/.test(type)) {
        var to = Object.keys(owe), from = Object.keys(by);
        if (from.length !== 1 || to.length !== 1 || from[0] === to[0]) { res.skip("bad"); return; }
        res.push({ k: "p", t: title, d: d, c: "other", cur: cur, rate: rate, a: a, by: by, owe: owe });
        return;
      }
      res.push({ k: "e", t: title, d: d, c: catOf(r[iC]), cur: cur, rate: rate, a: a, by: by, owe: owe });
    });
    return null;
  }

  // ---------- 9. Entry points ----------
  var SIGS = [
    { id: "splitwise", need: [["date"], ["description"], ["cost"], ["currency"]] },
    { id: "settleup", need: [SU_WHO, SU_FOR, TR_AMOUNT] },
    { id: "tricount", need: [TR_PAID, TR_AMOUNT] }
  ];
  // "trip-to-paris_2026-05-01_export.csv" → "Trip to paris"
  function groupName(file, source) {
    var s = String(file || "").replace(/^.*[\\\/]/, "").replace(/\.[a-z0-9]{2,5}$/i, "");
    s = s.replace(/\d{4}-\d{2}-\d{2}([_ T-]?\d{2}[-.:h]?\d{2}([-.:]?\d{2})?)?/g, " ")
         .replace(/[_\-]+/g, " ")
         .replace(/\b(export|exported|splitwise|tricount|settle ?up|transactions?|expenses?)\b/gi, " ");
    s = K.clean(s, NAME_LEN);
    if (!s) return SRC_NAME[source] || "";
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function parseRows(aoa, name) {
    if (!Array.isArray(aoa) || !aoa.length) return { error: "empty" };
    var at = -1, src = "", head = null;
    for (var i = 0; i < aoa.length && i < 15; i++) {
      var h = (aoa[i] || []).map(function (v) { return K.clean(str(v), 200); });
      var id = K.detect(h, SIGS);
      if (id) { at = i; src = id; head = h; break; }
    }
    if (at < 0) return { error: "bad" };
    var rows = aoa.slice(at + 1, at + 1 + MAX_ROWS);
    var res = new Result(src, groupName(name, src));
    var err = src === "splitwise" ? parseSplitwise(head, rows, res)
      : src === "settleup" ? parseSettleUp(head, rows, res) : parseTricount(head, rows, res);
    return err || res.done();
  }
  function parseText(text, name) {
    text = String(text === null || text === undefined ? "" : text);
    if (text.length > MAX_TEXT) return { error: "big" };
    if (!K.clean(text)) return { error: "empty" };
    var t = K.csv(text, { maxRows: MAX_ROWS + 20 });
    return parseRows([t.head].concat(t.rows), name);
  }
  // The sheet that reads best (the one with the most items).
  function fromWorkbook(X, wb, name) {
    var best = null;
    (wb.SheetNames || []).slice(0, 20).forEach(function (sn) {
      var aoa = X.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: "", blankrows: false });
      var r = parseRows(aoa.slice(0, MAX_ROWS + 20), name);
      if (!best || (!r.error && (best.error || r.items.length > best.items.length))) best = r;
    });
    return best || { error: "bad" };
  }
  function readBytes(bytes, name, getXlsx) {
    if (!bytes || bytes.length > MAX_FILE) return Promise.resolve({ error: "big" });
    if (!K.isZip(bytes)) {
      if (bytes[0] === 0xd0 && bytes[1] === 0xcf) {         // old .xls
        if (!getXlsx) return Promise.resolve({ error: "bad" });
        return getXlsx().then(function (X) { return fromWorkbook(X, X.read(bytes, { type: "array", cellDates: true }), name); },
                              function () { return { error: "lib" }; });
      }
      var txt;
      try { txt = K.text(bytes); } catch (e) { return Promise.resolve({ error: "bad" }); }
      return Promise.resolve(parseText(txt, name));
    }
    var z;
    try { z = K.unzip(bytes); } catch (e) { return Promise.resolve({ error: "bad" }); }
    var isXlsx = z.names.some(function (n) { return /^xl\/workbook\.xml$/i.test(n); });
    if (isXlsx) {
      if (!getXlsx) return Promise.resolve({ error: "bad" });
      return getXlsx().then(function (X) {
        var wb;
        try { wb = X.read(bytes, { type: "array", cellDates: true }); } catch (e) { return { error: "bad" }; }
        return fromWorkbook(X, wb, name);
      }, function () { return { error: "lib" }; });
    }
    var csvs = z.names.filter(function (n) { return /\.csv$/i.test(n) && !/(^|\/)(__MACOSX|\.)/.test(n); }).slice(0, 10);
    if (!csvs.length) return Promise.resolve({ error: "bad" });
    return Promise.all(csvs.map(function (n) {
      return Promise.resolve(z.read(n)).then(function (b) { return parseText(K.text(b), n); }, function () { return { error: "bad" }; });
    })).then(function (list) {
      var ok = list.filter(function (r) { return !r.error; });
      if (!ok.length) return list[0];
      ok.sort(function (p, q) { return q.items.length - p.items.length; });
      if (ok[0].name === SRC_NAME[ok[0].source]) ok[0].name = groupName(name, ok[0].source);
      return ok[0];
    });
  }

  // ---------- 10. Plan ----------
  function hid(s) { return "imp" + K.hash(s) + K.hash("~" + s); }
  function groupIdFor(res) {
    return hid(res.source + "|" + res.members.map(lc).sort(cmpStr).join("|"));
  }
  function live(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  // data: Split data (groups, people, exp, pay, tombs).
  // opts: { now, target ("" = the file's own imported group, made new
  //         when missing; "new" = always a new group; a group id),
  //         gname, col, names { original name (lower case): new name } }
  function plan(res, data, opts) {
    opts = opts || {};
    data = data || {};
    var groups = data.groups || [], people = data.people || [], exps = data.exp || [], pays = data.pay || [];
    var tombs = data.tombs || {};
    var now = opts.now || Date.now();
    var derived = groupIdFor(res);
    var gid = derived, g = null;
    if (opts.target && opts.target !== "new" && live(groups, opts.target)) gid = opts.target;
    else if (opts.target === "new" && live(groups, derived)) gid = hid(derived + "|" + now);
    g = live(groups, gid);
    var isNew = !g;
    var gcur = g ? g.cur : res.cur;
    var out = { gid: gid, isNew: isNew, group: null, people: [], exp: [], pay: [], members: [],
                add: { e: 0, p: 0 }, have: 0, gone: 0, skipped: {}, from: "", to: "", cur: gcur, check: null };
    Object.keys(res.skipped || {}).forEach(function (k) { out.skipped[k] = res.skipped[k]; });
    var skip = function (why) { out.skipped[why] = (out.skipped[why] || 0) + 1; };
    if (isNew) {
      var tb = tombs["grp:" + gid] || 0;
      out.group = { id: gid, m: Math.max(now, tb + 1), n: K.clean(opts.gname || res.name || SRC_NAME[res.source], NAME_LEN) || SRC_NAME[res.source],
                    col: isInt(opts.col) ? opts.col : 0, cur: CURRENCIES.indexOf(gcur) >= 0 ? gcur : "EUR", arch: 0 };
    }
    // people: renamed / merged in the preview; the target group's
    // people by name; new ones get an id from their (new) name
    var mine = people.filter(function (p) { return p.id.indexOf(gid + ".") === 0; });
    var byName = {};
    mine.forEach(function (p) { if (!byName[lc(p.n)]) byName[lc(p.n)] = p.id; });
    var pid = {}, newCount = 0, usedId = {};
    mine.forEach(function (p) { usedId[p.id] = 1; });
    var names = opts.names || {};
    res.members.forEach(function (orig) {
      var shown = K.clean(names[lc(orig)] !== undefined ? names[lc(orig)] : orig, PERSON_LEN) || orig;
      var k = lc(shown);
      if (!byName[k]) {
        var id = gid + "." + hid("p|" + k), n = 0;
        while (usedId[id] && n < 50) { n++; id = gid + "." + hid("p|" + k + "|" + n); }
        usedId[id] = 1;
        byName[k] = id;
        out.people.push({ id: id, m: now, n: shown });
        newCount++;
      }
      pid[lc(orig)] = byName[k];
      out.members.push({ orig: orig, n: shown, id: byName[k], isNew: !live(mine, byName[k]) });
    });
    if (mine.length + newCount > MAX_PEOPLE) return { error: "people" };
    var mapMap = function (m) {
      var o = {};
      Object.keys(m).forEach(function (n) { var id = pid[lc(n)]; if (id && m[n] > 0) o[id] = (o[id] || 0) + m[n]; });
      return dropZero(o);
    };
    var count = exps.concat(pays).filter(function (x) { return x.id.indexOf(gid + ".") === 0; }).length;
    var got = {};                 // person id → cents (every file row, new or already here)
    var addBal = function (m, sign) { Object.keys(m).forEach(function (k) { got[k] = (got[k] || 0) + sign * m[k]; }); };
    res.items.forEach(function (it) {
      var id = gid + "." + hid(it.key);
      var rate = it.cur !== gcur ? it.rate : 0;
      if (it.cur !== gcur && !rate) { skip("cur"); return; }
      var A = rate ? Math.round(it.a * rate) : it.a;
      if (A <= 0 || A > MAX_CENTS) { skip("zero"); return; }
      var byO = mapMap(it.by), oweO = mapMap(it.owe);
      if (!Object.keys(byO).length || !Object.keys(oweO).length) { skip("bad"); return; }
      var rec;
      if (it.k === "p") {
        var f = Object.keys(byO)[0], to = Object.keys(oweO)[0];
        if (f === to) { skip("self"); return; }
        rec = { id: id, m: now, f: f, to: to, a: A, d: it.d };
        got[f] = (got[f] || 0) + A;
        got[to] = (got[to] || 0) - A;
      } else {
        var by = rate ? dropZero(allot(byO, A, 0)) : byO;
        var w = rate ? dropZero(allot(oweO, A, 0)) : oweO;
        rec = { id: id, m: now, t: K.clean(it.t, TITLE_LEN), a: A, d: it.d, c: it.c, by: by, mode: "ex", w: w, n: "" };
        if (rate) {
          rec.fx = { c: it.cur, a: it.a, r: rate, s: "man" };
          if (Object.keys(byO).length > 1) rec.fx.by = byO;
          rec.fx.w = oweO;
        }
        addBal(by, 1);
        addBal(w, -1);
      }
      if (live(it.k === "p" ? pays : exps, id)) { out.have++; return; }
      if (!isNew && tombs[(it.k === "p" ? "pay:" : "exp:") + id]) { out.gone++; return; }
      if (count >= MAX_EXP) { skip("cap"); return; }
      count++;
      (it.k === "p" ? out.pay : out.exp).push(rec);
      out.add[it.k]++;
      if (!out.from || it.d < out.from) out.from = it.d;
      if (!out.to || it.d > out.to) out.to = it.d;
    });
    // the balance check: what Split will show for these rows against
    // the source's own balances (Splitwise's "Total balance" row, else
    // the file's amounts before rounding), per person, in cents
    var want = {};
    Object.keys(res.want || {}).forEach(function (n) {
      var id = pid[lc(n)];
      if (id) want[id] = (want[id] || 0) + res.want[n];
    });
    var diffs = [];
    var ids = {};
    Object.keys(want).concat(Object.keys(got)).forEach(function (k) { ids[k] = 1; });
    Object.keys(ids).sort(cmpStr).forEach(function (k) {
      var a = want[k] || 0, b = got[k] || 0;
      if (Math.abs(a - b) > 1) {
        var m = out.members.filter(function (x) { return x.id === k; })[0];
        diffs.push({ id: k, n: m ? m.n : k, want: a, got: b });
      }
    });
    out.check = { ok: !diffs.length, diffs: diffs, from: res.wantFrom, cur: gcur, curOk: gcur === res.cur };
    return out;
  }

  var API = { MAX_FILE: MAX_FILE, SOURCES: SRC_NAME, parseRows: parseRows, parseText: parseText, readBytes: readBytes,
              plan: plan, groupIdFor: groupIdFor, catOf: catOf, groupName: groupName, allot: allot };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.OrosSplitImport = API;
})(typeof self !== "undefined" ? self : this);
