// ============================================================
// orOS Budget — exports of personal-finance apps (budget/import.js)
// Pure logic, no DOM, no storage: window.OrosBudgetImport in the
// browser (after importkit.js and bank.js), module.exports in Node.
// The dialog is in budget/bankui.js; the write in budget.js.
//   1. Detect the app from the header row of a CSV or a sheet:
//      YNAB (new and YNAB 4), Wallet by BudgetBakers, Spendee,
//      Money Lover, Monefy, Money Manager (Realbyte, .xls / .xlsx)
//      and Firefly III
//   2. Map every row to one item: date, signed amount in its own
//      currency (+ the app's own conversion, when it has one),
//      category, account, payee / note, transfer or opening balance
//   3. Plan: the app's accounts → Budget accounts (or a note),
//      categories by name (missing ones made under Budget's rules),
//      currencies converted, then bank.js plan() for ids, rules and
//      duplicates, exactly as for a bank statement
// Nothing from a file is run or inserted as HTML.
// ============================================================
(function (root) {
  "use strict";
  var NODE = typeof module !== "undefined" && module.exports && typeof require === "function";
  var K = NODE ? require("../importkit.js") : root.OrosImportKit;
  var B = NODE ? require("./bank.js") : root.OrosBudgetBank;

  var MAX_ROWS = 20000;
  var NOTE_LEN = 140;
  var NAME_LEN = 30;
  var MAX_SRC_ACC = 40;      // account names shown for mapping

  var APPS = {
    ynab: "YNAB", wallet: "Wallet by BudgetBakers", spendee: "Spendee", moneylover: "Money Lover",
    monefy: "Monefy", moneymgr: "Money Manager", firefly: "Firefly III"
  };
  // Order matters: the more specific headers first.
  var SIGS = [
    { id: "ynab", need: [["Account"], ["Payee"], ["Outflow"], ["Inflow"]] },
    { id: "firefly", need: [["source_name"], ["destination_name"], ["amount"], ["type"], ["date"]] },
    { id: "wallet", need: [["account"], ["category"], ["currency"], ["amount"], ["type"], ["ref_currency_amount", "payment_type"]] },
    { id: "spendee", need: [["Wallet"], ["Category name"], ["Amount"], ["Currency"], ["Date"]] },
    { id: "monefy", need: [["account"], ["category"], ["amount"], ["converted amount"], ["date"]] },
    { id: "moneylover", need: [["Id"], ["Date"], ["Category"], ["Amount"], ["Wallet"]] },
    { id: "moneymgr", need: [["Period", "Date"], ["Accounts", "Account"], ["Category"], ["Subcategory"], ["Income/Expense", "Inc./Exp.", "Amount"]] }
  ];

  function fold(s) { return B.fold(s); }
  function clean(v, n) { return K.clean(v instanceof Date ? "" : v, n || NOTE_LEN); }

  // ---------- 1. Tables + detection ----------
  // CSV text → { head, rows } (cells as strings); the delimiter is
  // sniffed (Money Lover and Wallet often use ";").
  function csvTable(text) {
    var t = K.csv(text, { maxRows: MAX_ROWS + 10 });
    return { head: t.head, rows: t.rows };
  }
  // Rows of a sheet (arrays of strings / numbers / Dates) → table,
  // the header being the first of the first 10 rows that an app's
  // signature fits.
  function sheetTable(aoa) {
    var rows = (aoa || []).slice(0, MAX_ROWS + 20);
    for (var i = 0; i < Math.min(rows.length, 10); i++) {
      var head = (rows[i] || []).map(function (h) { return K.clean(h, 200); });
      if (K.detect(head, SIGS)) return { head: head, rows: rows.slice(i + 1) };
    }
    return { head: (rows[0] || []).map(function (h) { return K.clean(h, 200); }), rows: rows.slice(1) };
  }
  function detect(head) { return K.detect(head || [], SIGS); }

  // ---------- 2. Rows → items ----------
  var SYM = { "€": "EUR", "$": "USD", "£": "GBP", "¥": "JPY", "₺": "TRY", "zł": "PLN", "kr": "SEK", "fr": "CHF" };
  function curOf(v) {
    var s = K.clean(v, 12);
    if (/^[A-Za-z]{3}$/.test(s)) return s.toUpperCase();
    return SYM[s.toLowerCase()] || SYM[s] || "";
  }
  // A cell of a date column → "YYYY-MM-DD" | null. Dates of a sheet
  // come as Date objects or Excel day numbers.
  function cellDate(v, order) {
    if (v instanceof Date) {
      if (isNaN(v.getTime())) return null;
      return B.parseDate(v.getFullYear() + "-" + (v.getMonth() + 1) + "-" + v.getDate(), "ymd");
    }
    if (typeof v === "number") {
      if (v > 20000 && v < 80000) {
        var d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
        return B.parseDate(d.getUTCFullYear() + "-" + (d.getUTCMonth() + 1) + "-" + d.getUTCDate(), "ymd");
      }
      return null;
    }
    return B.parseDate(K.clean(v, 60), order);
  }
  // A cell of an amount column → signed cents | null.
  function cellMoney(v, dec) {
    if (typeof v === "number") return isFinite(v) && Math.abs(v) < 1e9 ? Math.round(v * 100) : null;
    return B.parseMoney(K.clean(v, 60), dec);
  }
  function isTrue(v) { return /^(true|yes|1|ναι)$/i.test(K.clean(v, 10)); }
  function joinText(a, b) {
    a = clean(a); b = clean(b);
    if (a && b && fold(a) !== fold(b) && fold(b).indexOf(fold(a)) < 0) return a + " · " + b;
    return a.length >= b.length ? a : b;
  }
  function tags(v) {
    return String(v == null ? "" : v).split(/[;,|]/).map(function (s) { return K.clean(s, 30); })
      .filter(Boolean).slice(0, 6).map(function (s) { return "#" + s.replace(/\s+/g, "_"); }).join(" ");
  }

  // Each source: { order (date fallback), map(get, i) → raw }. raw =
  // { d, amt (raw cell), dec?, sign (+1 | -1 | 0 = the amount's own),
  //   cur, alt (raw), altCur, cat, acc, payee, memo, tags, kind
  //   ("" | "xfer" | "open"), fit }
  var SRC = {
    ynab: function (g) {
      var out = cellMoneyPair(g(["Outflow"]), g(["Inflow"]));
      var cat = g(["Sub Category"]) || g(["Category"]);
      var grp = g(["Category Group"]) || g(["Master Category"]);
      // YNAB 4 writes "Master: Sub" in Category.
      if (grp && String(cat).indexOf(grp + ": ") === 0) cat = String(cat).slice(String(grp).length + 2);
      var both = g(["Category Group/Category"]);
      if (!cat && both) { var p = String(both).split(/:\s*/); cat = p.length > 1 ? p.slice(1).join(": ") : both; grp = grp || (p.length > 1 ? p[0] : ""); }
      var payee = g(["Payee"]);
      var kind = /^transfer\s*:/i.test(K.clean(payee, 80)) ? "xfer" : /^starting balance$/i.test(K.clean(payee, 40)) ? "open" : "";
      // Money into "Ready to Assign" / "To be Budgeted" has no category.
      if (/^inflow$/i.test(K.clean(grp, 30)) || /^(inflow:\s*)?(ready to assign|to be budgeted|income for this month|income for next month)$/i.test(K.clean(cat, 60))) cat = "";
      return { d: g(["Date"]), pair: out, cur: "", cat: cat, acc: g(["Account"]), payee: payee, memo: g(["Memo"]), kind: kind };
    },
    wallet: function (g) {
      var type = fold(g(["type"]));
      var cat = g(["category"]);
      return { d: g(["date"]), amt: g(["amount"]), sign: /^expense/.test(type) ? -1 : /^income/.test(type) ? 1 : 0,
               cur: curOf(g(["currency"])), alt: g(["ref_currency_amount"]), altCur: "?",
               cat: cat, acc: g(["account"]), payee: g(["payee"]), memo: g(["note"]), tags: tags(g(["labels"])),
               kind: isTrue(g(["transfer"])) || /^transfer$/i.test(K.clean(cat, 30)) ? "xfer" : "" };
    },
    spendee: function (g) {
      var type = fold(g(["Type"]));
      var cat = g(["Category name", "Category"]);
      return { d: g(["Date"]), amt: g(["Amount"]), sign: /^expense/.test(type) ? -1 : /^income/.test(type) ? 1 : 0,
               cur: curOf(g(["Currency"])), cat: cat, acc: g(["Wallet"]), payee: "", memo: g(["Note"]), tags: tags(g(["Labels"])),
               kind: /^transfer/.test(type) || /^transfer$/i.test(K.clean(cat, 30)) ? "xfer" : "" };
    },
    moneylover: function (g) {
      var cat = g(["Category"]);
      return { d: g(["Date"]), amt: g(["Amount"]), sign: 0, cur: curOf(g(["Currency"])), cat: cat, acc: g(["Wallet", "Account"]),
               payee: g(["With", "Payee"]), memo: g(["Note"]),
               kind: /^(incoming |outgoing )?transfer$/i.test(K.clean(cat, 40)) ? "xfer" : "" };
    },
    monefy: function (g, row, head) {
      var cat = g(["category"]);
      var c2 = nthCol(head, "currency", 2);
      return { d: g(["date"]), amt: g(["amount"]), sign: 0, cur: curOf(g(["currency"])),
               alt: g(["converted amount"]), altCur: c2 >= 0 ? curOf(row[c2]) : "",
               cat: cat, acc: g(["account"]), payee: "", memo: g(["description", "note"]),
               kind: /^(to|from) ['‘’"]/i.test(K.clean(cat, 60)) || /^transfer$/i.test(K.clean(cat, 30)) ? "xfer" : "" };
    },
    moneymgr: function (g, row, head) {
      var type = fold(g(["Income/Expense", "Inc./Exp.", "Type"]));
      var sub = g(["Subcategory"]);
      var mc = mainCurCol(head);
      var memo = joinText(sub, g(["Description"]));
      return { d: g(["Period", "Date"]), amt: g(["Amount"]) !== "" ? g(["Amount"]) : (mc >= 0 ? row[mc] : ""),
               sign: /^inc|transfer-?in/.test(type) ? 1 : /^exp|transfer-?out/.test(type) ? -1 : 0,
               cur: curOf(g(["Currency"])), alt: mc >= 0 ? row[mc] : "", altCur: mc >= 0 ? head[mc].toUpperCase() : "",
               cat: g(["Category"]), acc: g(["Accounts", "Account"]), payee: g(["Note"]), memo: memo,
               kind: /transfer|μεταφορ/.test(type) ? "xfer" : "" };
    },
    firefly: function (g) {
      var type = fold(g(["type"]));
      var dep = /^deposit/.test(type);
      var kind = /^transfer/.test(type) ? "xfer" : /^(opening|reconciliation|liability)/.test(type) ? "open" : "";
      var jid = K.clean(g(["journal_id", "transaction_journal_id"]), 40);
      return { d: g(["date"]), amt: g(["amount"]), sign: dep ? 1 : /^withdrawal/.test(type) ? -1 : 0,
               cur: curOf(g(["currency_code"])), alt: g(["foreign_amount"]), altCur: curOf(g(["foreign_currency_code"])),
               cat: g(["category"]), acc: dep ? g(["destination_name"]) : g(["source_name"]),
               payee: dep ? g(["source_name"]) : g(["destination_name"]), memo: g(["description"]),
               tags: tags(g(["tags"])), kind: kind, fit: jid ? "ff:" + jid : "" };
    }
  };
  // YNAB: two columns, money out and money in.
  function cellMoneyPair(o, i) { return { o: o, i: i }; }
  function nthCol(head, name, n) {
    var k = 0, nn = K.norm(name);
    for (var i = 0; i < head.length; i++) if (K.norm(head[i]) === nn && ++k === n) return i;
    return -1;
  }
  // Money Manager adds a column named after the app's main currency
  // ("EUR", "USD"…): the amount converted into it.
  function mainCurCol(head) {
    for (var i = 0; i < head.length; i++) if (/^[A-Z]{3}$/.test(String(head[i]))) return i;
    return -1;
  }

  // table → { src, name, items: [{ line, d, amt (signed cents, own
  // currency), cur, alt, altCur, text, cat, acc, tags, kind, fit, err }] }
  function parse(table, opts) {
    opts = opts || {};
    var head = table.head || [], src = opts.src || detect(head);
    if (!src || !SRC[src]) return null;
    var idx = {};
    function g(row) {
      return function (names) {
        var key = names.join("\u0001");
        if (!(key in idx)) idx[key] = K.col(head, names);
        var v = idx[key] >= 0 ? row[idx[key]] : "";
        return v == null ? "" : v;
      };
    }
    var raws = [];
    (table.rows || []).slice(0, MAX_ROWS).forEach(function (row, i) {
      if (!row || !row.some(function (c) { return c !== "" && c != null; })) return;
      var r = SRC[src](g(row), row, head);
      r.line = i + 2;
      raws.push(r);
    });
    // Date order and decimal mark from the whole column.
    var dateStr = raws.map(function (r) { return typeof r.d === "string" ? r.d : ""; });
    var order = B.detectDateOrder(dateStr, opts.order || (src === "ynab" ? "mdy" : "dmy"));
    var mon = [];
    raws.forEach(function (r) {
      [r.amt, r.alt, r.pair && r.pair.o, r.pair && r.pair.i].forEach(function (v) { if (typeof v === "string" && v) mon.push(v); });
    });
    var dec = B.detectDec(mon, opts.dec || ".");
    // Wallet: the reference currency is the one whose rows have the
    // same amount in both columns.
    var walletRef = "";
    if (src === "wallet") {
      var votes = {};
      raws.forEach(function (r) {
        var a = cellMoney(r.amt, dec), b = cellMoney(r.alt, dec);
        if (r.cur && a !== null && b !== null && a && Math.abs(a) === Math.abs(b)) votes[r.cur] = (votes[r.cur] || 0) + 1;
      });
      Object.keys(votes).forEach(function (c) { if (!walletRef || votes[c] > votes[walletRef]) walletRef = c; });
    }
    var seen = {};
    var items = raws.map(function (r) {
      var d = cellDate(r.d, order), amt = null;
      if (r.pair) {
        var o = cellMoney(r.pair.o, dec), n = cellMoney(r.pair.i, dec);
        if (o !== null || n !== null) amt = Math.abs(n || 0) - Math.abs(o || 0);
      } else {
        amt = cellMoney(r.amt, dec);
        if (amt !== null && r.sign) amt = r.sign * Math.abs(amt);
      }
      var altCur = r.altCur === "?" ? walletRef : r.altCur || "";
      var alt = r.alt !== undefined && r.alt !== "" && altCur ? cellMoney(r.alt, dec) : null;
      var text = joinText(r.payee, r.memo);
      var acc = clean(r.acc, NAME_LEN);
      var cat = clean(r.cat, NAME_LEN);
      var it = { line: r.line, d: d, amt: amt, cur: r.cur || "", alt: alt !== null && amt !== null ? (amt < 0 ? -Math.abs(alt) : Math.abs(alt)) : null,
                 altCur: alt !== null ? altCur : "", text: text, cat: cat, acc: acc, tags: r.tags || "", kind: r.kind || "", fit: "" };
      // A stable reference for the row: the app's own id when it has a
      // lasting one, else what the row says (+ how often it repeats).
      var key = r.fit || src + ":" + K.hash([fold(acc), d, amt, it.cur, fold(text), fold(cat)].join("|"));
      seen[key] = (seen[key] || 0) + 1;
      it.fit = (key + (seen[key] > 1 ? "-" + seen[key] : "")).slice(0, 80);
      if (!d) it.err = "date";
      else if (amt === null) it.err = "amount";
      return it;
    });
    return { src: src, name: APPS[src], items: items, more: (table.rows || []).length > MAX_ROWS };
  }

  // ---------- 3. Plan ----------
  // The app's accounts: [{ name, n (rows), cur (when all one) }].
  function accounts(parsed) {
    var by = {}, out = [];
    parsed.items.forEach(function (it) {
      if (!it.acc) return;
      var k = fold(it.acc);
      if (!by[k]) { by[k] = { name: it.acc, n: 0, curs: {} }; out.push(by[k]); }
      by[k].n++;
      if (it.cur) by[k].curs[it.cur] = 1;
    });
    return out.slice(0, MAX_SRC_ACC).map(function (a) {
      var cs = Object.keys(a.curs);
      return { name: a.name, n: a.n, cur: cs.length === 1 ? cs[0] : "" };
    });
  }
  function accId(name) { return "imp-a" + K.hash("acc|" + fold(name)); }
  function catId(k, name) { return "imp-c" + K.hash(k + "|" + fold(name)); }
  // Where each app account goes by default: a Budget account of the
  // same name; else a new one when Budget has accounts; else none
  // (the name goes into the note).
  function defaultAccMap(parsed, ctx) {
    var map = {};
    accounts(parsed).forEach(function (a) {
      var hit = "";
      (ctx.accs || []).some(function (x) { if (x.id === accId(a.name) || fold(x.n) === fold(a.name)) { hit = x.id; return true; } return false; });
      map[fold(a.name)] = hit || ((ctx.accs || []).length ? "new" : "");
    });
    return map;
  }
  // A Budget category of this kind with this name (its own name, or
  // a ready category's name in either language), or one an earlier
  // import made.
  function findCat(cats, k, name) {
    var f = fold(name), id = catId(k, name), hit = "";
    (cats || []).some(function (c) {
      if (c.k !== k) return false;
      if (c.id === id || fold(c.name) === f || (c.alt || []).some(function (a) { return fold(a) === f; })) { hit = c.id; return true; }
      return false;
    });
    return hit;
  }

  // parsed + ctx { tx, tombs, rules, cur (main), cats [{ id, k, name,
  // alt? }], accs [{ id, n, cur? }], fx(cents, from, to) → cents |
  // null, maxCats, maxAcc } + opts { acc: { folded name → account id
  // | "new" | "" }, mkCats (bool) } →
  // { rows (bank.js plan rows + ac, acName, cat, newCat, oc, oa),
  //   newCats [{ id, k, name, col }], newAccs [{ id, n, cur }], info }
  function plan(parsed, ctx, opts) {
    opts = opts || {};
    var main = ctx.cur || "EUR";
    var accMap = opts.acc || defaultAccMap(parsed, ctx);
    var cats = ctx.cats || [], maxCats = ctx.maxCats || 60, maxAcc = ctx.maxAcc || 20;
    var newCats = {}, newCatList = [], newAccs = {}, newAccList = [];
    var info = { xfer: 0, open: 0, rate: {}, conv: {}, nocat: 0, matched: 0, full: 0 };
    var srcAccs = {};
    accounts(parsed).forEach(function (a) { srcAccs[fold(a.name)] = a; });
    var accIds = {};
    (ctx.accs || []).forEach(function (a) { accIds[a.id] = a; });

    function accFor(name) {
      if (!name) return { ac: "", note: "" };
      var f = fold(name), m = accMap[f];
      if (m && m !== "new" && accIds[m]) return { ac: m, note: "" };
      if (m === "new") {
        var id = accId(name);
        if (accIds[id]) return { ac: id, note: "" };
        if (newAccs[id]) return { ac: id, note: "" };
        if ((ctx.accs || []).length + newAccList.length < maxAcc) {
          var sa = srcAccs[f];
          newAccs[id] = { id: id, n: clean(name, NAME_LEN), cur: sa && sa.cur && sa.cur !== main ? sa.cur : "" };
          newAccList.push(newAccs[id]);
          return { ac: id, note: "" };
        }
      }
      return { ac: "", note: name };
    }
    function catFor(k, name) {
      if (!name) return { c: "", fresh: false };
      var hit = findCat(cats, k, name);
      if (hit) { info.matched++; return { c: hit, fresh: false }; }
      var id = catId(k, name);
      if (newCats[id]) return { c: id, fresh: true };
      if (opts.mkCats === false) { info.nocat++; return { c: "", fresh: false }; }
      if (cats.length + newCatList.length >= maxCats) { info.full++; return { c: "", fresh: false }; }
      newCats[id] = { id: id, k: k, name: clean(name, NAME_LEN), col: newCatList.length % 8 };
      newCatList.push(newCats[id]);
      return { c: id, fresh: true };
    }

    var groups = {}, extra = {}, rows = [];
    parsed.items.forEach(function (it, i) {
      var base = { line: it.line, d: it.d || "", a: 0, k: it.amt < 0 ? "o" : "i", text: it.text, fit: it.fit,
                   st: "skip", why: "", on: false, c: "", n: "", rule: "", id: "", cat: it.cat, acName: it.acc, i: i };
      if (!it.err && it.kind) {
        base.why = it.kind;
        info[it.kind]++;
        base.a = Math.abs(it.amt || 0);
        rows.push(base);
        return;
      }
      // Main-currency amount: as is, the app's own conversion, or
      // today's rate.
      var amt = it.amt, oc = "", oa = 0;
      if (!it.err && it.amt && it.cur && it.cur !== main) {
        oc = it.cur; oa = Math.abs(it.amt);
        if (it.alt !== null && it.altCur === main) amt = it.alt;
        else {
          var c = ctx.fx ? ctx.fx(Math.abs(it.amt), it.cur, main) : null;
          if (c === null || c === undefined) {
            info.rate[it.cur] = (info.rate[it.cur] || 0) + 1;
            base.why = "rate"; base.cur = it.cur; base.a = oa;
            rows.push(base);
            return;
          }
          amt = it.amt < 0 ? -c : c;
        }
        info.conv[it.cur] = (info.conv[it.cur] || 0) + 1;
      }
      var acc = accFor(it.acc);
      var g = groups[acc.ac] = groups[acc.ac] || [];
      g.push({ line: i, d: it.d, amt: amt, text: it.text, fit: it.fit, err: it.err });
      extra[i] = { acc: acc, oc: oc, oa: oa, it: it };
    });
    // bank.js does ids, duplicates, "deleted here earlier" and rules,
    // one Budget account at a time (as for a statement).
    Object.keys(groups).forEach(function (ac) {
      B.plan(groups[ac], { tx: ctx.tx, tombs: ctx.tombs, ac: ac, cur: "", fileCur: "", rules: ctx.rules }).forEach(function (r) {
        var x = extra[r.line], it = x.it;
        r.i = r.line;
        r.line = it.line;
        r.ac = ac;
        r.acName = it.acc;
        r.cat = it.cat;
        if (r.st !== "skip") {
          var cf = catFor(r.k, it.cat);
          if (cf.c) { r.c = cf.c; r.rule = ""; r.newCat = cf.fresh; }
          else if (!r.c) r.rule = "";
          r.n = clean([it.text, it.tags, x.acc.note ? "[" + x.acc.note + "]" : ""].filter(Boolean).join(" · "), NOTE_LEN);
          if (x.oc) { r.oc = x.oc; r.oa = x.oa; }
        }
        rows.push(r);
      });
    });
    rows.sort(function (a, b) { return a.i - b.i; });
    var lo = "", hi = "";
    rows.forEach(function (r) { if (r.d && r.st !== "skip") { if (!lo || r.d < lo) lo = r.d; if (!hi || r.d > hi) hi = r.d; } });
    info.from = lo; info.to = hi;
    return { rows: rows, newCats: newCatList, newAccs: newAccList, info: info };
  }

  // The ticked rows → what Budget writes: entries (bank.js entries()
  // shape, src "imp", + oc/oa) and only the new categories and
  // accounts those entries use. m is stamped by the app.
  function entries(res) {
    var tx = [], usedC = {}, usedA = {};
    res.rows.forEach(function (r) {
      if (!r.on || !r.id || r.st === "same" || r.st === "skip") return;
      var x = B.entries([r], r.ac)[0];
      x.src = "imp";
      if (r.oc && r.oa) { x.oc = r.oc; x.oa = r.oa; }
      if (x.c) usedC[x.c] = 1;
      if (x.ac) usedA[x.ac] = 1;
      tx.push(x);
    });
    return {
      tx: tx,
      cats: res.newCats.filter(function (c) { return usedC[c.id]; }),
      accs: res.newAccs.filter(function (a) { return usedA[a.id]; })
    };
  }

  var api = {
    MAX_ROWS: MAX_ROWS, APPS: APPS, SIGS: SIGS, csvTable: csvTable, sheetTable: sheetTable, detect: detect,
    parse: parse, accounts: accounts, defaultAccMap: defaultAccMap, findCat: findCat, plan: plan, entries: entries,
    accId: accId, catId: catId, cellDate: cellDate
  };
  if (NODE) module.exports = api;
  else root.OrosBudgetImport = api;
})(typeof window !== "undefined" ? window : this);
