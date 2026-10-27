// ============================================================
// orOS Invoices — PDF import (invoices/pdfin.js, v1.0.0)
// i18n-inline-ok: Greek labels as invoices print them (parser data, no UI text)
// "New › Import invoice PDFs": the PDFs your provider made (Novus /
// timologisi.online first, others where their text says enough)
// become records here ("ext": issued elsewhere), with the ΜΑΡΚ, the
// client (matched by ΑΦΜ in Invoices and CRM) and the PDF itself as
// the official file. A PDF that another business issued TO you becomes
// a received invoice instead.
//
// Only the TEXT of a PDF is read, with PDF.js (eval off, no XFA, no
// scripts, no forms): nothing in a file is ever run. Every value is
// checked and cleaned (core.js normDoc / normClient / normBill) before
// it is kept, and nothing is saved before "Import".
//
// Pure part (Node tests, window.OrosInvoicesPdfIn):
//   parse(items) → one invoice read from text items [{ x, y, s }]
//     (PDF points, y grows upwards; pages stacked by fromPdf):
//     { ok, prov, kindText, credit, num, date, issuer{name, afm},
//       party{name, job, addr, afm, doy, phone, email}, payText,
//       lines[{ d, q, unit, p, net, vat }], net, vat, total, ded, pay,
//       mark, uid, auth, warn[] }
//     warn codes: "sum" (net + VAT ≠ total), "pay" (total − deductions
//     ≠ payable), "lines" (lines ≠ net)
//   plan(data, list, opts) → what an import of `list` ([{ name, p }])
//     would write, one row per file, nothing changed:
//     [{ name, st, p, doc?, client?, pay?, bill?, newClient }]
//     st: "new" | "bill" (received) | "have" (already here) |
//         "credit" (credit note: by hand) | "other" (neither issuer
//         nor client is you) | "bad" (not readable)
//     opts: { core, mine: [ΑΦΜ…], days, crm: [{ id, name, afm, … }],
//             lang, now }
//   Ids are made from the ΜΑΡΚ (or issuer + number + date), so the same
//   PDF imported on two devices is one record after sync, and a second
//   import finds it.
// Browser part: textItems(bytes) (PDF.js), open(api) (the dialog).
// ============================================================
(function (root) {
  "use strict";

  var MONEY_RE = /^-?(\d{1,3}(\.\d{3})+|\d+),\d{2}$/;      // 1.054,00 · 850,00
  var MONEY_EN = /^-?(\d{1,3}(,\d{3})+|\d+)\.\d{2}$/;      // 1,054.00 · 850.00
  var DATE_RE = /\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})\b/;
  var AFM_RE = /^\d{9}$/;

  function clean(s) { return String(s === null || s === undefined ? "" : s).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim(); }
  // Upper case, accents out: "Επί Πιστώσει" → "ΕΠΙ ΠΙΣΤΩΣΕΙ"
  function fold(s) { return clean(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase(); }
  function isMoney(s) { s = clean(s); return MONEY_RE.test(s) || MONEY_EN.test(s); }
  // "1.054,00" → 105400 (cents); NaN when it is not an amount
  function cents(s) {
    s = clean(s);
    var neg = s.charAt(0) === "-";
    if (neg) s = s.slice(1);
    var v;
    if (MONEY_RE.test(s)) v = s.replace(/\./g, "").replace(",", ".");
    else if (MONEY_EN.test(s)) v = s.replace(/,/g, "");
    else return NaN;
    var c = Math.round(parseFloat(v) * 100);
    return neg ? -c : c;
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function day(s) {
    var m = DATE_RE.exec(clean(s));
    if (!m) return "";
    var d = +m[1], mo = +m[2], y = +m[3];
    var dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return "";
    return y + "-" + pad(mo) + "-" + pad(d);
  }

  // ---------- Reading the text ----------
  function norm(items) {
    var out = [];
    (Array.isArray(items) ? items : []).forEach(function (it) {
      if (!it || typeof it !== "object") return;
      var s = clean(it.s);
      if (!s || !isFinite(it.x) || !isFinite(it.y)) return;
      out.push({ x: +it.x, y: +it.y, s: s.slice(0, 300) });
    });
    return out.slice(0, 5000);
  }
  // Lines of text: items within 2.5 points of height, left to right.
  function rows(items) {
    var list = items.slice().sort(function (a, b) { return b.y - a.y || a.x - b.x; });
    var out = [];
    list.forEach(function (it) {
      var r = out.length ? out[out.length - 1] : null;
      if (r && Math.abs(r.y - it.y) <= 2.5) r.items.push(it);
      else out.push({ y: it.y, items: [it] });
    });
    out.forEach(function (r) {
      r.items.sort(function (a, b) { return a.x - b.x; });
      r.text = r.items.map(function (i) { return i.s; }).join(" ");
    });
    return out;
  }
  // The label item (exact text, accents and a final colon ignored);
  // the rightmost one when there are several (totals sit on the right).
  function label(items, text, opts) {
    var want = fold(text), best = null;
    items.forEach(function (it) {
      if (fold(it.s).replace(/\s*:$/, "") !== want) return;
      if (opts && opts.maxX !== undefined && it.x > opts.maxX) return;
      if (opts && opts.minX !== undefined && it.x < opts.minX) return;
      if (!best || (opts && opts.left ? it.x < best.x : it.x > best.x)) best = it;
    });
    return best;
  }
  // What stands right of a label on its line (up to maxX), colons out.
  function valueOf(items, L, maxX) {
    if (!L) return "";
    return items.filter(function (it) {
      return Math.abs(it.y - L.y) <= 4 && it.x > L.x + 10 && (maxX === undefined || it.x < maxX) && it !== L && it.s !== ":";
    }).sort(function (a, b) { return a.x - b.x; }).map(function (i) { return i.s.replace(/^:\s*/, ""); }).join(" ").trim();
  }
  // The amount of a total: of the items with this label text, the
  // rightmost one that has an amount on its line (a column header with
  // the same word has none).
  function total(items, names) {
    for (var n = 0; n < names.length; n++) {
      var want = fold(names[n]), best = null, val = NaN;
      items.forEach(function (it) {
        if (fold(it.s).replace(/\s*:$/, "") !== want) return;
        var v = amountOf(items, it);
        if (!isNaN(v) && (!best || it.x > best.x)) { best = it; val = v; }
      });
      if (best) return val;
    }
    return NaN;
  }
  // The rightmost amount on a label's line.
  function amountOf(items, L) {
    if (!L) return NaN;
    var best = null;
    items.forEach(function (it) {
      if (Math.abs(it.y - L.y) <= 4 && it.x > L.x && isMoney(it.s) && (!best || it.x > best.x)) best = it;
    });
    return best ? cents(best.s) : NaN;
  }
  function afmIn(s) {
    var m = /(?:^|\D)(\d{9})(?:\D|$)/.exec(clean(s));
    return m ? m[1] : "";
  }

  function parse(raw) {
    var items = norm(raw);
    var out = { ok: false, prov: "", kindText: "", credit: false, num: "", date: "", issuer: { name: "", afm: "" },
                party: { name: "", job: "", addr: "", afm: "", doy: "", phone: "", email: "" }, payText: "",
                lines: [], net: NaN, vat: NaN, total: NaN, ded: 0, pay: NaN, mark: "", uid: "", auth: "", warn: [] };
    if (!items.length) return out;
    var all = rows(items), text = all.map(function (r) { return r.text; }).join("\n");
    if (/timologisi\.online|NOVUS CONCEPTUS/i.test(text)) out.prov = "novus";

    // ΜΑΡΚ: Novus prints "UID ΜΑΡΚ code" on one line at the foot;
    // others print "ΜΑΡΚ: 400…" (any provider).
    var foot = /\b([A-F0-9]{40})\s+(\d{12,20})\s+([A-F0-9]{16,64})\b/.exec(text);
    if (foot) { out.uid = foot[1]; out.mark = foot[2]; out.auth = foot[3]; }
    else {
      var mk = /M\.?A\.?R\.?K\.?|Μ\.?Α\.?Ρ\.?Κ\.?/;
      all.forEach(function (r) {
        if (out.mark) return;
        var f = fold(r.text);
        var i = f.search(mk);
        if (i < 0) return;
        var m = /(\d{12,20})/.exec(f.slice(i));
        if (m) out.mark = m[1];
      });
    }

    // Kind, series, number, date: the header row and the row under it
    var H = label(items, "ΕΙΔΟΣ ΠΑΡΑΣΤΑΤΙΚΟΥ"), split = 320;
    var top = H ? H.y : Infinity;
    if (H) {
      var cols = [["k", H], ["s", label(items, "ΣΕΙΡΑ")], ["n", label(items, "ΑΡΙΘΜΟΣ")], ["d", label(items, "ΗΜ/ΝΙΑ")]]
        .filter(function (c) { return c[1] && Math.abs(c[1].y - H.y) <= 3; });
      var got = { k: [], s: [], n: [], d: [] };
      items.forEach(function (it) {
        if (it.y >= H.y - 4 || it.y < H.y - 35) return;
        var near = null, dist = Infinity;
        cols.forEach(function (c) { var dd = Math.abs(c[1].x - it.x); if (dd < dist) { dist = dd; near = c[0]; } });
        if (near && dist < 90) got[near].push(it);
      });
      var join = function (l) { return l.sort(function (a, b) { return a.x - b.x; }).map(function (i) { return i.s; }).join(" "); };
      out.kindText = clean(join(got.k)).slice(0, 80);
      var ser = clean(join(got.s)), no = clean(join(got.n));
      out.num = clean((ser ? ser + " " : "") + no).slice(0, 40);
      out.date = day(join(got.d));
    }
    if (!out.date) out.date = day(text);
    if (!out.num) {   // other layouts: "Αριθμός: 149", "Α/Α 149"
      var nm = /(?:ΑΡΙΘΜΟΣ|ΑΡ\.|Α\/Α)\s*(?:ΠΑΡΑΣΤΑΤΙΚΟΥ)?\s*[:.]?\s*([A-ZΑ-Ω0-9][A-ZΑ-Ω0-9\/-]{0,20}(?: \d{1,10})?)/.exec(fold(text));
      if (nm) out.num = clean(nm[1]).slice(0, 40);
    }
    out.credit = /ΠΙΣΤΩΤΙΚ/.test(fold(out.kindText || text));

    // The issuer: the lines above the header (or the first lines)
    var head = all.filter(function (r) { return r.y > top + 8; });
    if (!head.length) head = all.slice(0, 6);
    if (head.length) out.issuer.name = clean(head[0].text).slice(0, 120);
    head.forEach(function (r) {
      if (out.issuer.afm) return;
      var m = /(?:Α\.?Φ\.?Μ\.?|VAT)\s*[:.]?\s*(?:EL)?\s*(\d{9})/.exec(fold(r.text));
      if (m) out.issuer.afm = m[1];
    });

    // The client ("ΣΤΟΙΧΕΙΑ ΣΥΜΒΑΛΛΟΜΕΝΟΥ"): labels on the left half
    // (the right half starts at its leftmost label)
    ["ΤΡΟΠΟΣ ΠΛΗΡΩΜΗΣ", "ΣΚΟΠΟΣ ΔΙΑΚΙΝΗΣΗΣ", "ΣΧΕΤΙΚΑ ΠΑΡΑΣΤΑΤΙΚΑ", "ΤΟΠΟΣ ΦΟΡΤΩΣΗΣ", "ΠΡΟΟΡΙΣΜΟΣ"].forEach(function (n) {
      var R = label(items, n, { left: true, minX: 150 });
      if (R && R.x - 2 < split) split = R.x - 2;
    });
    var lv = function (name) { return valueOf(items, label(items, name, { maxX: split, left: true }), split); };
    out.party.name = clean(lv("ΕΠΩΝΥΜΙΑ")).slice(0, 120);
    out.party.job = clean(lv("ΕΠΑΓΓΕΛΜΑ")).slice(0, 120);
    var street = clean(lv("ΔΙΕΥΘΥΝΣΗ")), city = clean(lv("ΠΟΛΗ / Τ.Κ."));
    out.party.addr = [street, city].filter(function (x) { return x && x !== "-"; }).join("\n").slice(0, 300);
    var tel = clean(lv("ΤΗΛ / ΕΜΑΙΛ")).split(/\s+-\s+|^-\s*|\s*-$/).map(clean).filter(Boolean);
    tel.forEach(function (x) {
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)) out.party.email = x.slice(0, 120);
      else if (/^[+\d][\d\s().-]{4,}$/.test(x)) out.party.phone = x.slice(0, 40);
    });
    var ad = clean(lv("ΑΦΜ / ΔΟΥ"));
    out.party.afm = afmIn(ad);
    out.party.doy = clean(ad.replace(/^\s*\d{9}\s*-?\s*/, "")).replace(/^-$/, "").slice(0, 60);
    if (!out.party.afm) {   // other layouts: the first ΑΦΜ that is not the issuer's
      var re = /Α\.?Φ\.?Μ\.?\s*[:.]?\s*(?:EL)?\s*(\d{9})/g, f = fold(text), m;
      while ((m = re.exec(f))) if (m[1] !== out.issuer.afm) { out.party.afm = m[1]; break; }
    }
    out.payText = clean(valueOf(items, label(items, "ΤΡΟΠΟΣ ΠΛΗΡΩΜΗΣ"))).slice(0, 60);

    // Lines: between the column header and the VAT analysis
    var P = label(items, "ΠΕΡΙΓΡΑΦΗ"), B = label(items, "ΑΝΑΛΥΣΗ ΦΠΑ") || label(items, "ΑΞΙΑ ΠΡΟ ΕΚΠΤ.");
    var MM = label(items, "ΜΜ");
    if (P && B) {
      all.forEach(function (r) {
        if (r.y >= P.y - 8 || r.y <= B.y + 4) return;
        var nums = r.items.filter(function (i) { return isMoney(i.s); });
        var texts = r.items.filter(function (i) { return !isMoney(i.s); });
        if (nums.length >= 4) {
          var unit = MM ? texts.filter(function (i) { return Math.abs(i.x - MM.x) < 25; })[0] : null;
          var desc = texts.filter(function (i) { return i !== unit && i.x > 60; }).map(function (i) { return i.s; }).join(" ");
          out.lines.push({ d: clean(desc).slice(0, 500), q: cents(nums[0].s) / 100, unit: unit ? unit.s.slice(0, 12) : "",
                           p: cents(nums[1].s), net: cents(nums[nums.length - 2].s), vat: cents(nums[nums.length - 1].s) / 100 });
        } else if (!nums.length && texts.length && out.lines.length) {   // a description on two lines
          var l = out.lines[out.lines.length - 1];
          l.d = clean(l.d + " " + texts.map(function (i) { return i.s; }).join(" ")).slice(0, 500);
        }
      });
    }

    // Totals (the right-hand block)
    out.net = total(items, ["ΚΑΘΑΡΗ ΑΞΙΑ", "ΣΥΝΟΛΟ ΚΑΘΑΡΗΣ ΑΞΙΑΣ"]);
    out.vat = total(items, ["ΦΠΑ", "ΣΥΝΟΛΟ ΦΠΑ", "ΑΞΙΑ ΦΠΑ"]);
    out.total = total(items, ["ΤΕΛΙΚΗ ΑΞΙΑ", "ΣΥΝΟΛΙΚΗ ΑΞΙΑ", "ΣΥΝΟΛΟ"]);
    var ded = total(items, ["ΚΡΑΤΗΣΕΙΣ", "ΠΑΡΑΚΡΑΤΗΣΗ", "ΠΑΡΑΚΡΑΤΗΣΗ ΦΟΡΟΥ"]);
    out.ded = isNaN(ded) ? 0 : ded;
    out.pay = total(items, ["ΠΛΗΡΩΤΕΟ", "ΠΛΗΡΩΤΕΟ ΠΟΣΟ"]);
    if (isNaN(out.total) && !isNaN(out.net) && !isNaN(out.vat)) out.total = out.net + out.vat;
    if (isNaN(out.net) && !isNaN(out.total) && !isNaN(out.vat)) out.net = out.total - out.vat;
    if (isNaN(out.pay) && !isNaN(out.total)) out.pay = out.total - out.ded;

    if (!isNaN(out.net) && !isNaN(out.vat) && !isNaN(out.total) && Math.abs(out.net + out.vat - out.total) > 1) out.warn.push("sum");
    if (!isNaN(out.total) && !isNaN(out.pay) && Math.abs(out.total - out.ded - out.pay) > 1) out.warn.push("pay");
    if (out.lines.length && !isNaN(out.net)) {
      var s = 0;
      out.lines.forEach(function (l) { s += isNaN(l.net) ? 0 : l.net; });
      if (Math.abs(s - out.net) > out.lines.length) out.warn.push("lines");
    }
    out.ok = !!(out.num && out.date && !isNaN(out.net) && !isNaN(out.vat) && (out.party.name || out.party.afm));
    return out;
  }

  // ---------- Planning an import (pure) ----------
  function payHow(text) {
    var f = fold(text);
    if (/ΜΕΤΡΗΤ|CASH/.test(f)) return "cash";
    if (/ΚΑΡΤ|POS|CARD/.test(f)) return "card";
    return "";   // on credit, bank deposit, unknown: still owed
  }
  function fmt(c, lang) {
    var neg = c < 0, a = Math.abs(c), i = String(Math.floor(a / 100)), d = pad(a % 100);
    var sep = lang === "en" ? "," : ".", dec = lang === "en" ? "." : ",";
    i = i.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
    return (neg ? "-" : "") + i + dec + d;
  }
  function qty(q, lang) {
    var s = String(Math.round(q * 1000) / 1000);
    return lang === "en" ? s : s.replace(".", ",");
  }
  function linesNote(p, lang) {
    return p.lines.map(function (l) {
      return clean(l.d) + ": " + qty(l.q, lang) + (l.unit ? " " + l.unit : "") + " × " + fmt(l.p, lang) +
             (isFinite(l.vat) ? " (" + (lang === "en" ? "VAT " : "ΦΠΑ ") + qty(l.vat, lang) + "%)" : "");
    }).join("\n").slice(0, 1500);
  }

  function plan(data, list, opts) {
    var C = opts.core, lang = opts.lang || "en", now = opts.now || 1;
    var mine = (opts.mine || []).filter(function (a) { return AFM_RE.test(a); });
    var docs = (data.docs || []), live = function (l) { return (l || []).filter(function (x) { return x && !x.del; }); };
    var byId = function (l, id) { return (l || []).filter(function (x) { return x && x.id === id; })[0] || null; };
    var made = {};   // clients made by this same import (two PDFs, one new client)
    return (list || []).map(function (f) {
      var p = f.p, row = { name: f.name, st: "bad", p: p, newClient: false };
      if (!p || !p.ok) return row;
      if (p.credit) { row.st = "credit"; return row; }
      var meIssuer = !mine.length || mine.indexOf(p.issuer.afm) >= 0;
      var meClient = mine.length && mine.indexOf(p.party.afm) >= 0;
      if (!meIssuer && !meClient) { row.st = "other"; return row; }
      var key = p.mark || ((p.issuer.afm || p.issuer.name) + "|" + p.num + "|" + p.date);

      if (!meIssuer) {   // issued TO you: a received invoice
        var bid = C.hashId("b", key), oldB = byId(data.bills, bid);
        if ((oldB && !oldB.del) || live(data.bills).some(function (b) {
          return b.num === p.num && b.date === p.date && b.sup && b.sup.afm === p.issuer.afm;
        })) { row.st = "have"; return row; }
        var cm = (opts.crm || []).filter(function (c) { return c && c.afm && c.afm.replace(/\s+/g, "") === p.issuer.afm; })[0];
        row.bill = C.normBill({ id: bid, m: oldB ? oldB.m + 1 : now, num: p.num, date: p.date,
          due: payHow(p.payText) ? p.date : C.addDays(p.date, opts.days || 30), cur: "EUR",
          sup: { name: p.issuer.name, afm: p.issuer.afm }, crm: cm ? cm.id : "",
          net: p.net, vat: p.vat, note: [p.mark ? "ΜΑΡΚ " + p.mark : "", linesNote(p, lang)].filter(Boolean).join("\n") });
        row.st = row.bill ? "bill" : "bad";
        return row;
      }

      var id = C.hashId("x", key), old = byId(docs, id);
      if ((old && !old.del) || live(docs).some(function (d) {
        return (p.mark && d.mark === p.mark) ||
               (d.kind === "ext" && d.num === p.num && d.date === p.date && (!p.party.afm || !d.c || !d.c.afm || d.c.afm === p.party.afm));
      })) { row.st = "have"; return row; }

      // The client: by ΑΦΜ (then name) here, else the CRM partner, else new
      var party = { name: p.party.name || p.party.afm, afm: p.party.afm, doy: p.party.doy, job: p.party.job,
                    addr: p.party.addr, country: "", email: p.party.email, phone: p.party.phone };
      var cl = C.matchClient(data, { afm: party.afm, name: party.name });
      var ck = party.afm || C.fold(party.name);
      if (!cl && made[ck]) cl = made[ck];
      if (!cl) {
        var crm = (opts.crm || []).filter(function (c) {
          return c && ((party.afm && c.afm && c.afm.replace(/\s+/g, "") === party.afm) || (!party.afm && C.fold(c.name) === C.fold(party.name)));
        })[0];
        var cid = C.hashId("c", ck), oldC = byId(data.clients, cid);
        cl = C.normClient(Object.assign({ id: cid, m: oldC ? oldC.m + 1 : now }, party, crm ? { crm: crm.id } : {}));
        if (cl) { made[ck] = cl; row.client = cl; row.newClient = true; }
      }
      if (!cl) return row;

      var how = payHow(p.payText);
      var wht = p.ded && p.net > 0 ? Math.round(p.ded * 10000 / p.net) / 100 : 0;
      var x = {
        id: id, m: old ? old.m + 1 : now, kind: "ext", st: "issued", num: p.num, date: p.date,
        due: how ? p.date : C.addDays(p.date, opts.days || 30), cur: "EUR",
        cli: cl.id, c: C.partyOfClient(cl), crm: cl.crm || "", wht: wht > 100 ? 0 : wht,
        notes: linesNote(p, lang), mark: p.mark, xnet: p.net, xvat: p.vat
      };
      if (p.uid) x.mdu = p.uid;     // as myDATA's own fields (mydata-ui.js)
      if (p.auth) x.mda = p.auth;
      row.doc = C.normDoc(x);
      if (!row.doc) { row.st = "bad"; return row; }
      // what the PDF says is payable must be what Invoices computes
      var tt = C.totals(row.doc);
      if (!isNaN(p.pay) && Math.abs(tt.pay - p.pay) > 1 && p.warn.indexOf("pay") < 0) p.warn.push("pay");
      if (how) row.pay = C.normPay({ id: C.hashId("p", key), m: now, doc: id, date: p.date, amt: tt.pay, how: how, note: "" });
      row.st = "new";
      return row;
    });
  }

  var API = { parse: parse, plan: plan, rows: rows, cents: cents, day: day, fold: fold, payHow: payHow };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }
  root.OrosInvoicesPdfIn = API;

  // ---------- Browser: PDF.js (text only) ----------
  var LIBSRC = "../vendor/pdfjs/pdf.min.js", WORKER = "../vendor/pdfjs/pdf.worker.min.js", libP = null;
  function pdfjs() {
    if (root.pdfjsLib) return Promise.resolve(root.pdfjsLib);
    if (libP) return libP;
    libP = new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.type = "module"; s.src = LIBSRC;
      s.onload = function () {
        if (root.pdfjsLib) { root.pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER; res(root.pdfjsLib); }
        else { libP = null; rej(new Error("pdfjs")); }
      };
      s.onerror = function () { libP = null; rej(new Error("pdfjs")); };
      document.head.appendChild(s);
    });
    return libP;
  }
  // The text items of the first pages, each page under the previous one.
  function textItems(bytes) {
    return pdfjs().then(function (lib) {
      return lib.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, enableXfa: false,
                               disableAutoFetch: true, disableStream: true, stopAtErrors: false }).promise;
    }).then(function (pdf) {
      var n = Math.min(pdf.numPages, 5), out = [], chain = Promise.resolve();
      for (var i = 1; i <= n; i++) (function (k) {
        chain = chain.then(function () { return pdf.getPage(k); }).then(function (pg) {
          return pg.getTextContent().then(function (tc) {
            (tc.items || []).forEach(function (it) {
              if (it && typeof it.str === "string" && it.transform) out.push({ x: it.transform[4], y: it.transform[5] - (k - 1) * 10000, s: it.str });
            });
          });
        });
      })(i);
      return chain.then(function () { try { pdf.destroy(); } catch (e) {} return out; });
    });
  }
  root.OrosInvoicesPdfIn.textItems = textItems;

  // ---------- Browser: the dialog ----------
  var STR = {
    en: {
      "pi.new": "Import invoice PDFs", "pi.newHint": "From Novus (timologisi.online) or another provider: one or more PDFs become records here.",
      "pi.title": "Import invoice PDFs", "pi.readingN": "Reading {n} PDFs…",
      "pi.hint": "Only the text of each PDF is read. Check what was found; nothing is saved before Import.",
      "pi.go": "Import ({n})", "pi.cancel": "Cancel",
      "pi.st.new": "New", "pi.st.bill": "Received invoice", "pi.st.have": "Already here", "pi.st.credit": "Credit note: record it by hand",
      "pi.st.other": "Neither the issuer nor the client is you (check your ΑΦΜ in Settings)", "pi.st.bad": "Could not be read: record it by hand",
      "pi.newClient": "new client", "pi.due": "due {d}", "pi.paid": "paid ({h})", "pi.payable": "payable {a}",
      "pi.w.sum": "Net + VAT is not the total", "pi.w.pay": "The payable amount does not match", "pi.w.lines": "The lines do not add up to the net",
      "pi.byHand": "Record by hand", "pi.done": "Imported: {n}", "pi.done1": "Imported: 1", "pi.noFiles": "No PDF to import",
      "pi.fail": "The PDFs could not be read here", "pi.noFs": "The PDFs were not kept on the orOS disk (Files is not available)"
    },
    el: {
      "pi.new": "Εισαγωγή PDF τιμολογίων", "pi.newHint": "Από το Novus (timologisi.online) ή άλλον πάροχο: ένα ή πολλά PDF γίνονται καταχωρίσεις εδώ.",
      "pi.title": "Εισαγωγή PDF τιμολογίων", "pi.readingN": "Διαβάζονται {n} PDF…",
      "pi.hint": "Διαβάζεται μόνο το κείμενο κάθε PDF. Έλεγξε τι βρέθηκε· τίποτα δεν αποθηκεύεται πριν την Εισαγωγή.",
      "pi.go": "Εισαγωγή ({n})", "pi.cancel": "Άκυρο",
      "pi.st.new": "Νέο", "pi.st.bill": "Λαμβανόμενο τιμολόγιο", "pi.st.have": "Υπάρχει ήδη", "pi.st.credit": "Πιστωτικό: καταχώρισέ το με το χέρι",
      "pi.st.other": "Ούτε ο εκδότης ούτε ο πελάτης είσαι εσύ (έλεγξε τον ΑΦΜ σου στις Ρυθμίσεις)", "pi.st.bad": "Δεν διαβάστηκε: καταχώρισέ το με το χέρι",
      "pi.newClient": "νέος πελάτης", "pi.due": "λήξη {d}", "pi.paid": "πληρωμένο ({h})", "pi.payable": "πληρωτέο {a}",
      "pi.w.sum": "Καθαρό + ΦΠΑ δεν κάνει το σύνολο", "pi.w.pay": "Το πληρωτέο δεν συμφωνεί", "pi.w.lines": "Οι γραμμές δεν αθροίζουν στο καθαρό",
      "pi.byHand": "Καταχώριση με το χέρι", "pi.done": "Εισήχθησαν: {n}", "pi.done1": "Εισήχθη: 1", "pi.noFiles": "Κανένα PDF για εισαγωγή",
      "pi.fail": "Τα PDF δεν διαβάστηκαν εδώ", "pi.noFs": "Τα PDF δεν κρατήθηκαν στον δίσκο του orOS (τα Αρχεία δεν είναι διαθέσιμα)"
    }
  };
  var api = null, LANG = "en";
  function t(k, p) {
    var s = (STR[LANG] || STR.en)[k];
    if (s === undefined) s = STR.en[k] !== undefined ? STR.en[k] : k;
    Object.keys(p || {}).forEach(function (x) { s = s.split("{" + x + "}").join(String(p[x])); });
    return s;
  }
  function setLang(a) {
    LANG = root.orosI18n ? root.orosI18n.lang() : (a.lang === "el" ? "el" : "en");
    if (root.orosI18n && !STR[LANG]) root.orosI18n.table(STR, "invoices", LANG);
  }
  var MAX_FILES = 50, MAX_BYTES = 10 * 1024 * 1024;

  // files: File[] (from the picker or a drop) → read, plan, show
  function importFiles(a, files) {
    api = a;
    setLang(a);
    var pdfs = Array.prototype.slice.call(files || []).filter(function (f) {
      return f && f.size > 0 && f.size <= MAX_BYTES && (/\.pdf$/i.test(f.name || "") || f.type === "application/pdf");
    }).slice(0, MAX_FILES);
    if (!pdfs.length) { a.toast(t("pi.noFiles")); return; }
    if (pdfs.length > 3) a.toast(t("pi.readingN", { n: pdfs.length }));   // a few are read in a moment
    var list = [], chain = Promise.resolve();
    pdfs.forEach(function (f) {
      chain = chain.then(function () { return f.arrayBuffer(); }).then(function (buf) {
        return textItems(buf).then(function (items) { list.push({ name: f.name || "invoice.pdf", file: f, p: parse(items) }); },
                                   function () { list.push({ name: f.name || "invoice.pdf", file: f, p: null }); });
      });
    });
    chain.then(function () {
      if (list.every(function (x) { return !x.p; })) { a.toast(t("pi.fail")); return; }
      a.loadCrm(function (crm) { preview(list, crm); });
    }).catch(function () { a.toast(t("pi.fail")); });
  }

  function preview(list, crm) {
    var C = api.core, el = api.el, data = api.data(), prof = data.prof || {};
    var mine = [prof.afm].concat((data.profs || []).filter(function (b) { return b && !b.del; }).map(function (b) { return b.afm; }))
      .map(function (s) { return String(s || "").replace(/\D+/g, ""); }).filter(function (s) { return AFM_RE.test(s); });
    var rowsP = plan(data, list, { core: C, mine: mine, days: prof.days || 30, crm: crm, lang: LANG, now: Date.now() });
    var dlg = api.makeDialog("inv-pdfin", t("pi.title"));
    dlg.classList.add("wide");
    dlg.appendChild(el("p", "hint", t("pi.hint")));
    var box = el("div", "pick-list");
    dlg.appendChild(box);
    var chosen = [];
    var go = api.btn(t("pi.go", { n: 0 }), "primary", function () { dlg.close(); commit(rowsP.filter(function (r, i) { return chosen[i]; }), list); });
    function count() {
      var n = chosen.filter(Boolean).length;
      go.textContent = t("pi.go", { n: n });
      go.disabled = !n;
    }
    rowsP.forEach(function (r, i) {
      var p = r.p, can = r.st === "new" || r.st === "bill";
      var lab = el("label", "pick-row check");
      var cb = el("input");
      cb.type = "checkbox";
      cb.disabled = !can;
      cb.checked = chosen[i] = can && !(p && p.warn.length);
      cb.addEventListener("change", function () { chosen[i] = cb.checked; count(); });
      lab.appendChild(cb);
      var tx = el("span", "pick-t");
      var who = p ? (r.st === "bill" ? p.issuer.name : p.party.name || p.party.afm) : "";
      tx.appendChild(el("span", "", p && p.num ? p.num + (who ? " · " + who : "") : r.name));
      var sub = [];
      if (p && p.date) sub.push(C.fmtDay(p.date));
      if (r.doc) {
        sub.push(t("pi.payable", { a: api.money(C.totals(r.doc).pay, "EUR") }));
        sub.push(r.pay ? t("pi.paid", { h: api.howName(r.pay.how) }) : t("pi.due", { d: C.fmtDay(r.doc.due) }));
        sub.push(r.newClient ? t("pi.newClient") + (r.client.crm ? " (CRM)" : "") : "");
      } else if (r.bill) {
        sub.push(t("pi.payable", { a: api.money(r.bill.net + r.bill.vat, "EUR") }));
      }
      sub.push(t("pi.st." + r.st));
      tx.appendChild(el("small", "", sub.filter(Boolean).join(" · ")));
      (p && can ? p.warn : []).forEach(function (w) { tx.appendChild(el("small", "msg-warn", "⚠ " + t("pi.w." + w))); });
      lab.appendChild(tx);
      box.appendChild(lab);
      if (r.st === "bad" || r.st === "credit") {
        var hb = api.btn(t("pi.byHand"), "", function () { dlg.close(); api.byHand(p, list[i].file); });
        box.appendChild(hb);
      }
    });
    var acts = el("div", "dlg-actions");
    acts.appendChild(el("span", "spacer"));
    acts.appendChild(api.btn(t("pi.cancel"), "", function () { dlg.close(); }));
    acts.appendChild(go);
    dlg.appendChild(acts);
    count();
    api.openDialog(dlg, go.disabled ? null : go);
  }

  // The PDFs go to /internal/Invoices/ first (a failed copy only means
  // no attached file), then every record in one save.
  function commit(sel, list) {
    if (!sel.length) return;
    var fs = api.fs(), chain = Promise.resolve(), noFs = !fs;
    sel.forEach(function (r) {   // a received invoice has no file field: only records keep theirs
      var rec = r.doc;
      var f = list.filter(function (x) { return x.p === r.p; })[0];
      if (!fs || !f || !f.file || !rec) return;
      var base = (rec.num || rec.id).replace(/[\\\/:*?\x22<>|\u0000-\u001f.]+/g, "-").replace(/\s+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || rec.id;
      var path = "/internal/Invoices/" + base + "-" + rec.date + ".pdf";
      chain = chain.then(function () { return fs.write(path, f.file); })
        .then(function () { rec.file = path; }, function () { noFs = true; });
    });
    chain.then(function () {
      api.put(sel);
      api.toast((sel.length === 1 ? t("pi.done1") : t("pi.done", { n: sel.length })) + (noFs ? " · " + t("pi.noFs") : ""));
    });
  }

  root.OrosInvoicesPdfIn.importFiles = importFiles;
  root.OrosInvoicesPdfIn.STR = STR;
  root.OrosInvoicesPdfIn.text = function (a, k) { setLang(a); return t(k); };
})(typeof window !== "undefined" ? window : this);
