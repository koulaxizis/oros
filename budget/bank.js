// ============================================================
// orOS Budget — bank statement core (budget/bank.js)
// Pure logic, no DOM, no storage: loaded by budget/index.html as
// window.OrosBudgetBank and by tests/budget-bank.test.js in Node.
//   1. Text: decode (UTF-8 / UTF-16 / windows-1253 sniff), fold
//   2. Numbers and dates of any bank (1.234,56 · 1,234.56 ·
//      dd/mm/yyyy · mm/dd/yyyy · yyyy-mm-dd · 14 Oct 2026)
//   3. CSV: separator, header row, column guess, rows
//   4. OFX / QFX, QIF, CAMT.053 (also .052 / .054)
//   5. Rules: match (longest "contains" wins), apply, re-run
//   6. Plan: ids, duplicates (same id, FITID, or same account +
//      date + amount + similar text), deleted earlier, skipped
// Nothing here runs imported code: files are read as text only.
// ============================================================
(function (root) {
  "use strict";

  var MAX_ROWS = 5000;
  var MAX_CENTS = 100000000000;
  var NOTE_LEN = 140;

  // ---------- 1. Text ----------
  function decoderOk(enc) {
    try { new TextDecoder(enc); return true; } catch (e) { return false; }
  }
  // Greek single-byte text (windows-1253 / iso-8859-7) has long runs
  // of high bytes (every letter is one); Western text has the odd
  // accented letter between ASCII ones.
  function sniffLegacy(b) {
    var high = 0, paired = 0, greekRange = 0;
    for (var i = 0; i < b.length; i++) {
      if (b[i] < 0x80) continue;
      high++;
      if (b[i] >= 0xB6 && b[i] <= 0xFE) greekRange++;
      if ((i > 0 && b[i - 1] >= 0x80) || (i + 1 < b.length && b[i + 1] >= 0x80)) paired++;
    }
    if (!high) return "windows-1252";
    return paired / high >= 0.5 && greekRange / high >= 0.8 ? "windows-1253" : "windows-1252";
  }
  // bytes (Uint8Array) → { text, enc }. enc "auto" sniffs: BOM, then
  // strict UTF-8, then an XML/OFX charset declaration, then Greek vs
  // Western single-byte.
  function decode(bytes, enc) {
    var b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    var use = enc && enc !== "auto" ? enc : "";
    if (!use) {
      if (b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) use = "utf-8";
      else if (b[0] === 0xFF && b[1] === 0xFE) use = "utf-16le";
      else if (b[0] === 0xFE && b[1] === 0xFF) use = "utf-16be";
    }
    if (!use) {
      try { return { text: new TextDecoder("utf-8", { fatal: true }).decode(b), enc: "utf-8" }; } catch (e) {}
      var head = "";
      for (var i = 0; i < Math.min(b.length, 400); i++) head += String.fromCharCode(b[i]);
      var m = /encoding=["']([\w.:-]+)["']/i.exec(head) || /CHARSET:\s*([\w-]+)/i.exec(head);
      if (m) {
        var c = m[1].toLowerCase();
        if (/^\d{4}$/.test(c)) c = "windows-" + c;
        if (c === "iso-8859-7" || c === "windows-1253" || c === "windows-1252" || c === "iso-8859-1") use = c;
      }
      if (!use) use = sniffLegacy(b);
    }
    if (!decoderOk(use)) use = "utf-8";
    var text = new TextDecoder(use).decode(b);
    return { text: text.charAt(0) === "﻿" ? text.slice(1) : text, enc: use };
  }

  // Case-, accent- and final-sigma-free form for matching.
  function fold(s) {
    return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
      .replace(/ς/g, "σ").replace(/\s+/g, " ").trim();
  }
  function clean(s, max) {
    return String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max || NOTE_LEN);
  }

  // ---------- 2. Numbers and dates ----------
  // Which decimal mark a column of amounts uses: "," or "." (or
  // `fallback` when nothing tells, e.g. only whole numbers).
  function detectDec(values, fallback) {
    var com = 0, dot = 0;
    values.forEach(function (v) {
      var s = String(v || "").replace(/[^0-9.,]/g, "");
      if (/\d,\d{1,2}$/.test(s) || /\.\d{3},/.test(s)) com++;
      else if (/\d\.\d{1,2}$/.test(s) || /,\d{3}\./.test(s)) dot++;
    });
    if (com > dot) return ",";
    if (dot > com) return ".";
    return fallback === "," ? "," : ".";
  }
  // "−1.234,56 €", "(12.50)", "12,50-", "12.50 DR" → signed cents;
  // "" / not a number → null. Rounds to the cent.
  function parseMoney(v, dec) {
    var s = String(v == null ? "" : v).trim();
    if (!s) return null;
    var neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    if (/\s*(dr|db|debit)\.?$/i.test(s)) { neg = true; s = s.replace(/\s*(dr|db|debit)\.?$/i, ""); }
    else s = s.replace(/\s*(cr|credit)\.?$/i, "");
    s = s.replace(/[A-Za-z€$£¥₺  \s'’]/g, "");
    if (/^[-−–]/.test(s)) { neg = !neg; s = s.slice(1); }
    else if (/[-−–]$/.test(s)) { neg = !neg; s = s.slice(0, -1); }
    else if (/^\+/.test(s)) s = s.slice(1);
    if (!/^[0-9.,]+$/.test(s) || !/[0-9]/.test(s)) return null;
    if (dec === ",") s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
    if (!/^\d*\.?\d*$/.test(s)) return null;
    var parts = s.split("."), whole = parts[0] || "0", frac = (parts[1] || "") + "000";
    var cents = Number(whole) * 100 + Number(frac.slice(0, 2)) + (Number(frac.charAt(2)) >= 5 ? 1 : 0);
    if (!isFinite(cents) || cents > MAX_CENTS) return null;
    return neg && cents ? -cents : cents;
  }

  var MON = {};
  ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].forEach(function (m, i) { MON[m] = i + 1; });
  ["ιαν", "φεβ", "μαρ", "απρ", "μαι", "ιουν", "ιουλ", "αυγ", "σεπ", "οκτ", "νοε", "δεκ"].forEach(function (m, i) { MON[m] = i + 1; });
  MON.sept = 9;
  function monthWord(w) {
    var f = fold(w).replace(/\.$/, "");
    if (MON[f]) return MON[f];
    if (MON[f.slice(0, 4)]) return MON[f.slice(0, 4)];
    return MON[f.slice(0, 3)] || 0;
  }
  function ymd(y, m, d) {
    if (y < 100) y += 2000;
    if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return null;
    var dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    if (d > dim) return null;
    return y + "-" + (m < 10 ? "0" : "") + m + "-" + (d < 10 ? "0" : "") + d;
  }
  // A date in any common shape → "YYYY-MM-DD" | null. order: "dmy"
  // (Greece, most of Europe), "mdy" (USA) or "ymd"; only used when
  // the shape itself does not tell.
  function parseDate(v, order) {
    var s = String(v == null ? "" : v).trim().replace(/'/g, "/");
    var m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:$|[T\s])/.exec(s);
    if (m) return ymd(+m[1], +m[2], +m[3]);
    m = /^(\d{4})(\d{2})(\d{2})(?:$|[\d.\[T\s])/.exec(s);
    if (m && +m[1] >= 1900) return ymd(+m[1], +m[2], +m[3]);
    m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?:$|[T\s,])/.exec(s);
    if (m) {
      var a = +m[1], b = +m[2], y = +m[3];
      return order === "mdy" ? ymd(y, a, b) : ymd(y, b, a);
    }
    m = /^(\d{1,2})[-/. ]+([^\d\s/.,-]{3,})\.?[-/. ]+(\d{4}|\d{2})(?:$|[T\s,])/.exec(s);
    if (m && monthWord(m[2])) return ymd(+m[3], monthWord(m[2]), +m[1]);
    m = /^([^\d\s/.,-]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})(?:$|[T\s,])/.exec(s);
    if (m && monthWord(m[1])) return ymd(+m[3], monthWord(m[1]), +m[2]);
    return null;
  }
  // "dmy" | "mdy" | "ymd" from sample values: a first number over 12
  // means day-first, a second over 12 month-first; else `fallback`.
  function detectDateOrder(values, fallback) {
    var dmy = 0, mdy = 0, iso = 0;
    values.forEach(function (v) {
      var s = String(v || "").trim().replace(/'/g, "/");
      if (/^\d{4}[-/.]?\d{1,2}/.test(s) && !/^\d{1,2}[-/.]/.test(s)) { iso++; return; }
      var m = /^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/.exec(s);
      if (!m) return;
      if (+m[1] > 12) dmy++;
      else if (+m[2] > 12) mdy++;
    });
    if (dmy > mdy) return "dmy";
    if (mdy > dmy) return "mdy";
    if (iso && !dmy && !mdy) return "ymd";
    return fallback === "mdy" ? "mdy" : "dmy";
  }

  // ---------- 3. CSV ----------
  function parseCsv(text, sep) {
    var rows = [], row = [], cell = "", q = false, i = 0, n = text.length;
    for (; i < n; i++) {
      var ch = text.charAt(i);
      if (q) {
        if (ch === '"') {
          if (text.charAt(i + 1) === '"') { cell += '"'; i++; } else q = false;
        } else cell += ch;
      } else if (ch === '"' && cell.trim() === "") { q = true; cell = ""; }
      else if (ch === sep) { row.push(cell); cell = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text.charAt(i + 1) === "\n") i++;
        row.push(cell); rows.push(row); row = []; cell = "";
        if (rows.length > MAX_ROWS + 60) break;
      } else cell += ch;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return rows.map(function (r) { return r.map(function (c) { return c.trim(); }); })
      .filter(function (r) { return r.some(function (c) { return c !== ""; }); });
  }
  function modal(nums) {
    var cnt = {}, best = 0, bestN = 0;
    nums.forEach(function (x) { cnt[x] = (cnt[x] || 0) + 1; });
    Object.keys(cnt).forEach(function (k) {
      if (cnt[k] > bestN || (cnt[k] === bestN && +k > best)) { best = +k; bestN = cnt[k]; }
    });
    return { v: best, n: bestN };
  }
  var SEPS = [";", ",", "\t", "|"];
  function guessSep(text) {
    var sample = text.split(/\r?\n/).filter(function (l) { return l.trim(); }).slice(0, 40).join("\n");
    var best = ",", score = -1;
    SEPS.forEach(function (sep) {
      var rows = parseCsv(sample, sep);
      if (!rows.length) return;
      var md = modal(rows.map(function (r) { return r.length; }));
      if (md.v < 2) return;
      var sc = md.n / rows.length * 100 + Math.min(md.v, 12);
      if (sc > score) { score = sc; best = sep; }
    });
    return best;
  }
  function isDateCell(v) { return !!parseDate(v, "dmy") || !!parseDate(v, "mdy"); }
  function isMoneyCell(v) {
    var s = String(v || "");
    return /\d/.test(s) && !/[^\d\s.,'’()+\-−–€$£¥]/.test(s.replace(/\b(eur|usd|gbp|chf|cr|dr)\b/gi, "")) &&
      parseMoney(s, ",") !== null && !isDateCell(s) && s.replace(/\D/g, "").length < 16;
  }
  // The header row: the first row as wide as most rows, unless that
  // row already looks like data (has a date and an amount).
  function findHeader(rows) {
    var md = modal(rows.slice(0, 200).map(function (r) { return r.length; }));
    var width = md.v, first = 0;
    for (var i = 0; i < rows.length; i++) { if (rows[i].length >= width && width > 1) { first = i; break; } }
    var r = rows[first] || [];
    var looksData = r.some(isDateCell) && r.some(function (c) { return isMoneyCell(c) && !isDateCell(c); });
    return looksData ? { header: -1, start: first, width: width } : { header: first, start: first + 1, width: width };
  }
  var KW = {
    date: ["date", "ημερομηνια", "ημ/νια", "ημ. συναλλαγης", "ημερ", "booking", "posted", "datum", "fecha", "data", "valuta", "buchungstag", "transaction date"],
    desc: ["description", "περιγραφη", "αιτιολογια", "payee", "details", "narrative", "merchant", "name", "δικαιουχος", "συναλλαγη", "λεπτομερειες", "beneficiary", "counterparty", "verwendungszweck", "libelle", "concepto", "text", "transaction"],
    memo: ["memo", "σχολια", "παρατηρησεις", "notes", "πληροφοριες"],
    amount: ["amount", "ποσο", "betrag", "importe", "montant", "value", "ποσο συναλλαγης"],
    debit: ["debit", "χρεωση", "χρεωσεις", "withdrawal", "withdrawals", "paid out", "money out", "out", "αναληψη", "soll", "outflow"],
    credit: ["credit", "πιστωση", "πιστωσεις", "deposit", "deposits", "paid in", "money in", "in", "καταθεση", "haben", "inflow"],
    sign: ["χ/π", "d/c", "dr/cr", "cr/dr", "debit/credit", "χρεωση/πιστωση", "προσημο", "sign", "πρoσημο", "type", "ειδος"],
    skip: ["balance", "υπολοιπο", "saldo", "solde", "running balance", "λογιστικο υπολοιπο"]
  };
  function kwHit(h, list) {
    var f = fold(h);
    if (!f) return 0;
    for (var i = 0; i < list.length; i++) {
      var k = list[i];
      if (f === k) return 3;
      if (k.length > 3 && f.indexOf(k) >= 0) return 2;
    }
    return 0;
  }
  var SIGN_RE = /^(d|c|dr|cr|db|debit|credit|χ|π|χρ|πι|χρεωση|πιστωση|-|\+)$/;
  function isSignWord(v) { return SIGN_RE.test(fold(v).replace(/\.$/, "")); }
  function signOf(v) {
    var f = fold(v).replace(/\.$/, "");
    if (/^(d|dr|db|debit|χ|χρ|χρεωση|-)$/.test(f)) return -1;
    if (/^(c|cr|credit|π|πι|πιστωση|\+)$/.test(f)) return 1;
    return 0;
  }
  // Guess the mapping from the header and some data rows.
  // → { cd, cp, cm, ca, cdb, ccr, cs, df, dec } (column indexes, -1 = none)
  function guessMap(rows, hd, lang) {
    var head = hd.header >= 0 ? rows[hd.header] : [];
    var data = rows.slice(hd.start, hd.start + 60);
    var W = hd.width, stats = [];
    for (var c = 0; c < W; c++) {
      var vals = data.map(function (r) { return r[c] || ""; }).filter(function (v) { return v !== ""; });
      var n = vals.length || 1;
      stats.push({
        date: vals.filter(isDateCell).length / n,
        money: vals.filter(isMoneyCell).length / n,
        sign: vals.length && vals.every(isSignWord) ? 1 : 0,
        len: vals.reduce(function (s, v) { return s + v.length; }, 0) / n,
        filled: vals.length
      });
    }
    var used = {};
    function pick(kind, test) {
      var best = -1, bs = 0;
      for (var c = 0; c < W; c++) {
        if (used[c] || kwHit(head[c], KW.skip)) continue;
        var s = kwHit(head[c], KW[kind]);
        if (s && test(stats[c]) && s > bs) { best = c; bs = s; }
      }
      if (best >= 0) used[best] = 1;
      return best;
    }
    var m = { cd: -1, cp: -1, cm: -1, ca: -1, cdb: -1, ccr: -1, cs: -1 };
    m.cd = pick("date", function (s) { return s.date >= 0.6; });
    if (m.cd < 0) for (var i = 0; i < W; i++) if (stats[i].date >= 0.8) { m.cd = i; used[i] = 1; break; }
    m.cdb = pick("debit", function (s) { return s.money >= 0.5 || !s.filled; });
    m.ccr = pick("credit", function (s) { return s.money >= 0.5 || !s.filled; });
    if (m.cdb < 0 || m.ccr < 0) {
      if (m.cdb >= 0) delete used[m.cdb];
      if (m.ccr >= 0) delete used[m.ccr];
      m.cdb = m.ccr = -1;
      m.ca = pick("amount", function (s) { return s.money >= 0.6; });
      if (m.ca < 0) {
        for (var j = W - 1; j >= 0; j--) {
          if (!used[j] && stats[j].money >= 0.8 && !kwHit(head[j], KW.skip)) { m.ca = j; used[j] = 1; break; }
        }
      }
      m.cs = pick("sign", function (s) { return s.sign === 1; });
      if (m.cs < 0) for (var k = 0; k < W; k++) if (!used[k] && stats[k].sign && stats[k].filled) { m.cs = k; used[k] = 1; break; }
    }
    m.cp = pick("desc", function (s) { return s.money < 0.9; });
    if (m.cp < 0) {
      var bl = 0;
      for (var x = 0; x < W; x++) if (!used[x] && stats[x].money < 0.5 && stats[x].date < 0.5 && stats[x].len > bl) { bl = stats[x].len; m.cp = x; }
      if (m.cp >= 0) used[m.cp] = 1;
    }
    m.cm = pick("memo", function (s) { return s.money < 0.9; });
    var dates = data.map(function (r) { return m.cd >= 0 ? r[m.cd] : ""; });
    m.df = detectDateOrder(dates, lang === "en-us" ? "mdy" : "dmy");
    var money = [];
    data.forEach(function (r) { [m.ca, m.cdb, m.ccr].forEach(function (c) { if (c >= 0 && r[c]) money.push(r[c]); }); });
    m.dec = detectDec(money, lang === "el" ? "," : ".");
    return m;
  }
  // Rows of a CSV table → items { line, d, amt (signed cents), text, err? }.
  function csvItems(rows, start, m) {
    var out = [];
    for (var i = start; i < rows.length && out.length < MAX_ROWS; i++) {
      var r = rows[i], get = function (c) { return c >= 0 && c < r.length ? r[c] : ""; };
      var d = parseDate(get(m.cd), m.df), amt = null;
      if (m.ca >= 0) {
        amt = parseMoney(get(m.ca), m.dec);
        if (amt !== null && m.cs >= 0) {
          var sg = signOf(get(m.cs));
          if (sg) amt = sg * Math.abs(amt);
        }
      } else {
        var db = parseMoney(get(m.cdb), m.dec), cr = parseMoney(get(m.ccr), m.dec);
        if (db !== null || cr !== null) amt = Math.abs(cr || 0) - Math.abs(db || 0);
      }
      if (amt !== null && m.inv) amt = -amt;
      var text = clean([get(m.cp), m.cm >= 0 && m.cm !== m.cp ? get(m.cm) : ""].filter(Boolean).join(" · "));
      var it = { line: i + 1, d: d, amt: amt, text: text, fit: "" };
      if (!d) it.err = "date";
      else if (amt === null) it.err = "amount";
      out.push(it);
    }
    return out;
  }
  function headerSig(row) { return fold((row || []).join("|")).slice(0, 400); }

  // ---------- 4. OFX / QFX, QIF, CAMT ----------
  function xmlDecode(s) {
    return String(s).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, function (m, e) {
      var l = e.toLowerCase();
      if (l === "amp") return "&";
      if (l === "lt") return "<";
      if (l === "gt") return ">";
      if (l === "quot") return '"';
      if (l === "apos") return "'";
      var cp = l.charAt(1) === "x" ? parseInt(l.slice(2), 16) : parseInt(l.slice(1), 10);
      return cp > 31 && cp < 0x110000 ? String.fromCodePoint(cp) : " ";
    });
  }
  // OFX 1.x is SGML (no closing tags), 2.x is XML: a value runs to
  // the next "<" or line end in both.
  function ofxTag(block, tag) {
    var m = new RegExp("<" + tag + ">\\s*([^<\\r\\n]*)", "i").exec(block);
    return m ? clean(xmlDecode(m[1]), 200) : "";
  }
  function parseOfx(text) {
    var out = { items: [], cur: ofxTag(text, "CURDEF").toUpperCase(), acct: ofxTag(text, "ACCTID") };
    var parts = text.split(/<STMTTRN>/i).slice(1);
    parts.forEach(function (p, i) {
      if (out.items.length >= MAX_ROWS) return;
      var blk = p.split(/<\/STMTTRN>|<\/BANKTRANLIST>/i)[0];
      var raw = ofxTag(blk, "TRNAMT");
      var dec = /,\d{1,2}$/.test(raw) && raw.indexOf(".") < 0 ? "," : ".";
      var amt = parseMoney(raw, dec);
      var dt = ofxTag(blk, "DTPOSTED") || ofxTag(blk, "DTUSER");
      var d = /^\d{8}/.test(dt) ? ymd(+dt.slice(0, 4), +dt.slice(4, 6), +dt.slice(6, 8)) : null;
      var name = ofxTag(blk, "NAME"), memo = ofxTag(blk, "MEMO");
      var txt = name && memo && fold(memo).indexOf(fold(name)) < 0 && fold(name).indexOf(fold(memo)) < 0
        ? name + " · " + memo : (name.length >= memo.length ? name : memo);
      var it = { line: i + 1, d: d, amt: amt, text: clean(txt), fit: ofxTag(blk, "FITID").slice(0, 80) };
      if (!d) it.err = "date";
      else if (amt === null) it.err = "amount";
      out.items.push(it);
    });
    return out;
  }
  // QIF: records end with "^"; D date, T/U amount, P payee, M memo.
  function qifRecords(text) {
    var recs = [], cur = {};
    text.split(/\r?\n/).forEach(function (line) {
      if (!line) return;
      var c = line.charAt(0), v = line.slice(1).trim();
      if (c === "!") return;
      if (c === "^") { if (cur.D || cur.T) recs.push(cur); cur = {}; return; }
      if ((c === "D" || c === "T" || c === "U" || c === "P" || c === "M") && cur[c] === undefined) cur[c] = v;
    });
    if (cur.D || cur.T) recs.push(cur);
    return recs.slice(0, MAX_ROWS);
  }
  function qifDates(text) { return qifRecords(text).map(function (r) { return r.D || ""; }); }
  function parseQif(text, order) {
    var recs = qifRecords(text);
    var dec = detectDec(recs.map(function (r) { return r.T || r.U || ""; }), ".");
    return { items: recs.map(function (r, i) {
      var d = parseDate(r.D || "", order || "mdy");
      var amt = parseMoney(r.T || r.U || "", dec);
      var p = r.P || "", m = r.M || "";
      var txt = p && m && fold(m).indexOf(fold(p)) < 0 ? p + " · " + m : (p || m);
      var it = { line: i + 1, d: d, amt: amt, text: clean(txt), fit: "" };
      if (!d) it.err = "date";
      else if (amt === null) it.err = "amount";
      return it;
    }), cur: "", acct: "" };
  }
  function xBlock(s, tag) {
    var m = new RegExp("<(?:[\\w.-]+:)?" + tag + "(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?" + tag + ">").exec(s);
    return m ? m[1] : "";
  }
  function xText(s, tag) { return clean(xmlDecode(xBlock(s, tag).replace(/<[^>]*>/g, " ")), 200); }
  function xAll(s, tag) {
    var re = new RegExp("<(?:[\\w.-]+:)?" + tag + "(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?" + tag + ">", "g"), out = [], m;
    while ((m = re.exec(s)) && out.length < MAX_ROWS + 1) out.push(m[1]);
    return out;
  }
  // ISO 20022 bank-to-customer statement (camt.053; .052 / .054 have
  // the same entries). One entry (Ntry) = one Budget entry.
  function parseCamt(text) {
    var stmt = xBlock(text, "Stmt") || xBlock(text, "Rpt") || xBlock(text, "Ntfctn") || text;
    var acct = xText(xBlock(stmt, "Acct"), "IBAN") || xText(xBlock(stmt, "Acct"), "Id");
    var out = { items: [], cur: "", acct: acct };
    var ccy = /<(?:[\w.-]+:)?Ccy>([A-Z]{3})</.exec(xBlock(stmt, "Acct"));
    out.cur = ccy ? ccy[1] : "";
    xAll(stmt, "Ntry").forEach(function (e, i) {
      if (out.items.length >= MAX_ROWS) return;
      var am = /<(?:[\w.-]+:)?Amt(?:\s+Ccy="([A-Z]{3})")?[^>]*>([^<]*)</.exec(e);
      var amt = am ? parseMoney(am[2], ".") : null;
      var ind = xText(e, "CdtDbtInd");
      if (amt !== null && ind === "DBIT") amt = -Math.abs(amt);
      var dt = xText(xBlock(e, "BookgDt"), "Dt") || xText(xBlock(e, "BookgDt"), "DtTm") ||
               xText(xBlock(e, "ValDt"), "Dt") || xText(xBlock(e, "ValDt"), "DtTm");
      var d = parseDate(dt.slice(0, 10), "ymd");
      var parties = xBlock(e, "RltdPties");
      var who = xText(xBlock(parties, ind === "DBIT" ? "Cdtr" : "Dbtr"), "Nm");
      var ustrd = xAll(e, "Ustrd").map(function (u) { return clean(xmlDecode(u), 140); }).join(" ");
      var info = xText(e, "AddtlNtryInf") || xText(e, "AddtlTxInf");
      var txt = [who, ustrd].filter(Boolean).join(" · ") || info;
      var ref = xText(e, "AcctSvcrRef") || xText(e, "NtryRef");
      if (!ref) { var e2e = xText(e, "EndToEndId"); if (e2e && e2e !== "NOTPROVIDED") ref = e2e; }
      var sts = xText(e, "Sts");
      var it = { line: i + 1, d: d, amt: amt, text: clean(txt), fit: ref.slice(0, 80), cur: am && am[1] ? am[1] : "" };
      if (!d) it.err = "date";
      else if (amt === null) it.err = "amount";
      else if (sts && !/BOOK/.test(sts)) it.err = "pending";
      out.items.push(it);
    });
    return out;
  }
  function detectFormat(text, name) {
    var head = text.slice(0, 4000);
    if (/<(?:[\w.-]+:)?BkToCstmr(Stmt|AcctRpt|DbtCdtNtfctn)\b/.test(head) || /camt\.05[234]/.test(head)) return "camt";
    if (/OFXHEADER|<OFX>/i.test(head)) return "ofx";
    if (/^\s*!(Type|Account|Option)/im.test(head) || /\.qif$/i.test(name || "")) return "qif";
    return "csv";
  }

  // ---------- 5. Rules ----------
  // rule = { id, m, k ("o"|"i"), c (category), q (contains), lo, hi
  // (amount range in cents, 0 = open), py (rename to), nt (note) }.
  // The matching rule with the longest "contains" text wins (amount-
  // only rules last), then the newest.
  function ruleMatches(r, k, a, text) {
    if (!r || r.k !== k || (!r.q && !r.lo && !r.hi)) return false;
    if (r.lo && a < r.lo) return false;
    if (r.hi && a > r.hi) return false;
    return !r.q || fold(text).indexOf(fold(r.q)) >= 0;
  }
  function matchRule(rules, k, a, text) {
    var best = null;
    (rules || []).forEach(function (r) {
      if (!ruleMatches(r, k, a, text)) return;
      if (!best) { best = r; return; }
      var lr = fold(r.q).length, lb = fold(best.q).length;
      if (lr > lb || (lr === lb && (r.m > best.m || (r.m === best.m && r.id > best.id)))) best = r;
    });
    return best;
  }
  function noteFor(text, r) {
    var base = r && r.py ? r.py : text;
    return clean(base + (r && r.nt ? " · " + r.nt : ""), NOTE_LEN);
  }
  // Uncategorised entries a rule now covers → [{ id, c, n }]. The
  // note is rewritten only on an imported entry whose note is still
  // what the import wrote (its own text, maybe renamed by a rule).
  function rerun(txs, rules) {
    var out = [];
    (txs || []).forEach(function (x) {
      if (x.c) return;
      var text = x.ot || x.n || "";
      var r = matchRule(rules, x.k, x.a, text);
      if (!r) return;
      var ch = { id: x.id, c: r.c, n: x.n };
      if (x.ot && (x.n === x.ot || x.n === "")) ch.n = noteFor(x.ot, r);
      out.push(ch);
    });
    return out;
  }
  // A short "contains" text for a rule made from a correction: the
  // first word of letters (3+), with the next one when it is a word too.
  var NOISE = {};
  ["pos", "eft", "eftpos", "card", "visa", "mastercard", "maestro", "debit", "credit", "purchase", "payment",
   "transfer", "online", "contactless", "αγορα", "αγορεσ", "πληρωμη", "καρτα", "καρτασ", "μεταφορα", "χρεωση",
   "πιστωση", "αναληψη", "καταθεση", "εμβασμα", "συναλλαγη", "ηλεκτρονικη"].forEach(function (w) { NOISE[w] = 1; });
  function wordOk(w) { return w.length >= 3 && /^[\p{L}][\p{L}&.'-]*$/u.test(w) && !NOISE[fold(w)]; }
  function suggestQ(text) {
    var words = clean(text).split(/[\s·*#/:,;]+/);
    for (var i = 0; i < words.length; i++) {
      var w = words[i].replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
      if (wordOk(w)) {
        var nx = (words[i + 1] || "").replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
        var two = wordOk(nx) ? w + " " + nx : w;
        return clean(text).indexOf(two) >= 0 ? two : w;
      }
    }
    return clean(text).slice(0, 20);
  }

  // ---------- 6. Plan ----------
  function fnv(s, seed) {
    var h = seed >>> 0;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h;
  }
  // Same file, same Budget account → same ids on every device, so a
  // statement imported twice (here or elsewhere) never doubles.
  function bankId(key) {
    var a = fnv(key, 2166136261).toString(36), b = fnv(key, 3335557771).toString(36);
    return "b" + ("000000" + a).slice(-7) + ("000000" + b).slice(-7);
  }
  function words(s) { return fold(s).split(/[^\p{L}\p{N}]+/u).filter(function (w) { return w.length >= 2; }); }
  function similar(a, b) {
    var fa = fold(a), fb = fold(b);
    if (!fa || !fb) return true;
    if (fa === fb) return true;
    if ((fa.length >= 4 && fb.indexOf(fa) >= 0) || (fb.length >= 4 && fa.indexOf(fb) >= 0)) return true;
    var wa = words(a), wb = words(b), set = {}, inter = 0, uni = {};
    wa.forEach(function (w) { set[w] = 1; uni[w] = 1; });
    wb.forEach(function (w) { if (set[w] === 1) { inter++; set[w] = 2; } uni[w] = 1; });
    var nu = Object.keys(uni).length;
    return nu > 0 && inter / nu >= 0.5;
  }
  // items + ctx { tx, tombs, ac, cur, fileCur, rules } → rows:
  // { id, d, a, k, text, fit, st "new"|"dup"|"same"|"gone"|"skip",
  //   why, on, c, n, rule }
  // "same": that very entry is here already (same id), cannot be
  // ticked; "dup": looks like one that is here (FITID, or same
  // account, date, amount and similar text), unticked; "gone":
  // imported and deleted here earlier, unticked.
  function plan(items, ctx) {
    var tx = ctx.tx || [], tombs = ctx.tombs || {}, ac = ctx.ac || "";
    var byId = {}, byFit = {}, byKey = {};
    tx.forEach(function (x) {
      byId[x.id] = x;
      if (x.fit && (x.ac || "") === ac) byFit[x.fit] = x;
      var key = (x.ac || "") + "|" + x.d + "|" + x.k + "|" + x.a;
      (byKey[key] = byKey[key] || []).push(x);
    });
    var seen = {}, used = {};
    return (items || []).map(function (it) {
      var row = { line: it.line, d: it.d || "", a: 0, k: "o", text: it.text || "", fit: it.fit || "",
                  st: "new", why: "", on: true, c: "", n: "", rule: "", id: "" };
      if (it.err) { row.st = "skip"; row.why = it.err; row.on = false; return row; }
      if (!it.amt) { row.st = "skip"; row.why = "zero"; row.on = false; return row; }
      var fc = it.cur || ctx.fileCur || "";
      if (fc && ctx.cur && fc !== ctx.cur) { row.st = "skip"; row.why = "cur"; row.on = false; return row; }
      row.k = it.amt < 0 ? "o" : "i";
      row.a = Math.abs(it.amt);
      if (row.a > MAX_CENTS) { row.st = "skip"; row.why = "amount"; row.on = false; return row; }
      var key = it.fit ? "f|" + ac + "|" + it.fit
                       : "t|" + ac + "|" + it.d + "|" + it.amt + "|" + fold(it.text);
      seen[key] = (seen[key] || 0) + 1;
      row.id = bankId(key + "|" + seen[key]);
      var r = matchRule(ctx.rules, row.k, row.a, row.text);
      row.c = r ? r.c : "";
      row.rule = r ? r.id : "";
      row.n = noteFor(row.text, r);
      if (byId[row.id]) { row.st = "same"; row.on = false; used[row.id] = 1; return row; }
      if (("tx:" + row.id) in tombs) { row.st = "gone"; row.on = false; return row; }
      var twin = it.fit && byFit[it.fit] && !used[byFit[it.fit].id] ? byFit[it.fit] : null;
      if (!twin) {
        (byKey[ac + "|" + it.d + "|" + row.k + "|" + row.a] || []).some(function (x) {
          if (used[x.id] || !similar(x.ot || x.n, row.text)) return false;
          twin = x;
          return true;
        });
      }
      if (twin) { used[twin.id] = 1; row.st = "dup"; row.on = false; row.why = twin.id; }
      return row;
    });
  }
  // Ticked rows → Budget entries (m is stamped by the app).
  function entries(rows, ac) {
    return rows.filter(function (r) { return r.on && r.id && r.st !== "same" && r.st !== "skip"; }).map(function (r) {
      var x = { id: r.id, d: r.d, a: r.a, k: r.k, c: r.c || "", n: r.n || "", src: "bank" };
      if (ac) x.ac = ac;
      if (r.text) x.ot = r.text;
      if (r.fit) x.fit = r.fit;
      return x;
    });
  }
  function counts(rows) {
    var c = { "new": 0, dup: 0, same: 0, gone: 0, skip: 0, on: 0 };
    rows.forEach(function (r) { c[r.st]++; if (r.on) c.on++; });
    return c;
  }

  var api = {
    MAX_ROWS: MAX_ROWS, decode: decode, sniffLegacy: sniffLegacy, fold: fold, clean: clean,
    detectDec: detectDec, parseMoney: parseMoney, parseDate: parseDate, detectDateOrder: detectDateOrder,
    parseCsv: parseCsv, guessSep: guessSep, findHeader: findHeader, guessMap: guessMap, csvItems: csvItems,
    headerSig: headerSig, parseOfx: parseOfx, parseQif: parseQif, qifDates: qifDates, parseCamt: parseCamt,
    detectFormat: detectFormat, ruleMatches: ruleMatches, matchRule: matchRule, noteFor: noteFor, rerun: rerun,
    suggestQ: suggestQ, bankId: bankId, similar: similar, plan: plan, entries: entries, counts: counts
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosBudgetBank = api;
})(typeof window !== "undefined" ? window : this);
