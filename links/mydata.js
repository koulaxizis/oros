// ============================================================
// orOS Connected services — mydata.js (pure, v1.0.0)
// An Invoices document → the SendInvoices request of timologisi.online
// (Novus Conceptus, a certified Greek e-invoicing provider that sends
// it to myDATA, AADE), and its answers back. No DOM, no storage, no
// network: Invoices builds with it, tests/mydata.test.js checks it.
//
// What orOS sends (wave 2):
//   inv  → 1.1 / 2.1 (Greek business), 1.2 / 2.2 (EU), 1.3 / 2.3 (other)
//   rcpt → 11.1 / 11.2 (retail: goods / services)
//   cred → 11.4 (correcting a retail receipt), 5.1 (correcting a document
//          that has a ΜΑΡΚ), else 5.2
//   Goods or services ("g" | "s") is the person's choice per document.
//   Only EUR. VAT 24/13/6/17/9/4/0 %; 0 % needs an exemption reason.
//   Withholding (doc.wht %) goes as a document-level tax with the
//   category the person picks among those of that rate.
// Money: orOS keeps VAT per rate on the discounted base (core.totals).
// myDATA wants it per line, and every sum must match to the cent, so
// each rate's base and VAT are shared out over its lines (largest
// remainder): the lines add up exactly to the totals printed by orOS.
// ============================================================
(function (root) {
  "use strict";

  // i18n-inline-ok: Greek myDATA (tax authority) data: official category names with an English gloss, Greek unit words, request fields
  var VAT_CAT = { "24": 1, "13": 2, "6": 3, "17": 4, "9": 5, "4": 6, "0": 7 };
  // vatExemptionCategory (L.5144/2024; the old article in brackets)
  var EXEMPT = [
    [1, "Άρθρα 2 & 3 (χωρίς ΦΠΑ)", "Articles 2 & 3 (outside VAT)"],
    [2, "Άρθρο 5 (μεταβίβαση επιχείρησης)", "Article 5 (transfer of a business)"],
    [3, "Άρθρο 17 (13) — τόπος παροχής εκτός Ελλάδας", "Article 17 (13) — place of supply outside Greece"],
    [4, "Άρθρο 18 (14) — τόπος παροχής υπηρεσιών εκτός Ελλάδας", "Article 18 (14) — services supplied outside Greece"],
    [5, "Άρθρο 21 (16)", "Article 21 (16)"],
    [6, "Άρθρο 24 (19)", "Article 24 (19)"],
    [7, "Άρθρο 27 (22) — ιατρικές, εκπαιδευτικές κ.ά.", "Article 27 (22) — medical, educational etc."],
    [8, "Άρθρο 29 (24) — εξαγωγές", "Article 29 (24) — exports"],
    [9, "Άρθρο 30 (25)", "Article 30 (25)"],
    [10, "Άρθρο 31 (26)", "Article 31 (26)"],
    [11, "Άρθρο 32 (27)", "Article 32 (27)"],
    [14, "Άρθρο 33 (28) — ενδοκοινοτικές παραδόσεις", "Article 33 (28) — intra-EU supplies"],
    [15, "Άρθρο 44 (39) — μικρές επιχειρήσεις", "Article 44 (39) — small businesses"],
    [16, "Άρθρο 45 (39α)", "Article 45 (39a)"],
    [17, "Άρθρο 47 (40)", "Article 47 (40)"],
    [24, "Άρθρο 8 (6)", "Article 8 (6)"],
    [27, "Λοιπές εξαιρέσεις ΦΠΑ", "Other VAT exemptions"]
  ];
  // withheldPercentCategory → rate %
  var WHT = [
    [1, 15, "Τόκοι 15%", "Interest 15%"], [2, 20, "Δικαιώματα 20%", "Royalties 20%"],
    [3, 20, "Αμοιβές διοίκησης/συμβουλών 20%", "Management / consulting fees 20%"],
    [4, 3, "Τεχνικά έργα 3%", "Technical works 3%"], [5, 1, "Υγρά καύσιμα, καπνός 1%", "Fuel, tobacco 1%"],
    [6, 4, "Λοιπά αγαθά 4%", "Other goods 4%"], [7, 8, "Παροχή υπηρεσιών 8%", "Services 8%"],
    [8, 4, "Αρχιτέκτονες/μηχανικοί, μελέτες 4%", "Architects / engineers, studies 4%"],
    [9, 10, "Αρχιτέκτονες/μηχανικοί, λοιπά 10%", "Architects / engineers, other 10%"],
    [10, 15, "Αμοιβές δικηγόρων 15%", "Lawyers' fees 15%"]
  ];
  // paymentMethods[].type
  var PAY = [
    [1, "Επαγ. λογαριασμός πληρωμών ημεδαπής", "Business bank account (Greece)"],
    [2, "Επαγ. λογαριασμός πληρωμών αλλοδαπής", "Business bank account (abroad)"],
    [3, "Μετρητά", "Cash"], [4, "Επιταγή", "Cheque"], [5, "Επί πιστώσει", "On credit"],
    [6, "Web banking", "Web banking"], [7, "POS / e-POS", "Card (POS / e-POS)"], [8, "IRIS", "IRIS"]
  ];
  var LABEL = {
    "1.1": ["Τιμολόγιο Πώλησης", "Sales Invoice"],
    "1.2": ["Τιμολόγιο Πώλησης / Ενδοκοινοτικές Παραδόσεις", "Sales Invoice / Intra-EU Supplies"],
    "1.3": ["Τιμολόγιο Πώλησης / Παραδόσεις Τρίτων Χωρών", "Sales Invoice / Third-Country Supplies"],
    "2.1": ["Τιμολόγιο Παροχής Υπηρεσιών", "Service Invoice"],
    "2.2": ["Τιμολόγιο Παροχής / Ενδοκοινοτική Παροχή Υπηρεσιών", "Service Invoice / Intra-EU Services"],
    "2.3": ["Τιμολόγιο Παροχής / Παροχή Υπηρεσιών σε Τρίτες Χώρες", "Service Invoice / Third-Country Services"],
    "5.1": ["Πιστωτικό Τιμολόγιο", "Credit Invoice"],
    "5.2": ["Πιστωτικό Τιμολόγιο", "Credit Invoice"],
    "11.1": ["Απόδειξη Λιανικής Πώλησης", "Retail Sales Receipt"],
    "11.2": ["Απόδειξη Παροχής Υπηρεσιών", "Service Receipt"],
    "11.4": ["Πιστωτικό Στοιχείο Λιανικής", "Retail Credit Note"]
  };
  var RETAIL = ["11.1", "11.2", "11.4"];

  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function eur(c) { return Math.round(c) / 100; }
  function txt(s, max) {
    return String(s == null ? "" : s).replace(/[\u0000-\u0009\u000b-\u001f\u007f\u2028\u2029]/g, " ")
      .replace(/[ \t]+/g, " ").trim().slice(0, max || 300);
  }
  function oneLine(s, max) { return txt(String(s == null ? "" : s).replace(/\n+/g, ", "), max); }
  function clean9(afm) { return String(afm || "").toUpperCase().replace(/[\s.-]+/g, "").replace(/^(EL|GR)(?=\d{9}$)/, ""); }

  // "Ερμού 12, 10563 Αθήνα", "Ερμού 12\n105 63 Αθήνα", "Ερμού 12, Αθήνα 10563"
  // → { street, number, pc, city } | null
  function parseAddr(text) {
    var parts = String(text || "").split(/\n|,/).map(function (x) { return x.trim(); }).filter(Boolean);
    if (parts.length < 2) return null;
    var first = parts[0], rest = parts.slice(1);
    var sm = /^(.*?[^\d\s].*?)\s+(\d+[A-Za-zΑ-Ωα-ω]?(?:\s*[-–]\s*\d+[A-Za-zΑ-Ωα-ω]?)?)$/.exec(first);
    var street = sm ? sm[1].trim() : first, number = sm ? sm[2].replace(/\s+/g, "") : "";
    var pc = "", city = "";
    for (var i = rest.length - 1; i >= 0 && !pc; i--) {
      var a = /^(\d{3}\s?\d{2}|\d{4,6}|[A-Z0-9]{2,4}\s?[A-Z0-9]{2,4})\s+(.+)$/.exec(rest[i]);
      var b = /^(.+?)\s+(\d{3}\s?\d{2}|\d{4,6})$/.exec(rest[i]);
      if (a && /\d/.test(a[1])) { pc = a[1].replace(/\s+/g, ""); city = a[2]; }
      else if (b) { pc = b[2].replace(/\s+/g, ""); city = b[1]; }
    }
    if (!pc || !city || !street) return null;
    return { street: txt(street, 150), number: txt(number || "0", 20), pc: txt(pc, 20), city: txt(city, 100) };
  }

  // The type from the document and the counterpart's country.
  // cc: "GR" | EU code | other ISO code ("" = retail / unknown)
  function autoType(kind, cc, nature, refType, refMark, EU) {
    var s = nature === "s";
    if (kind === "rcpt") return s ? "11.2" : "11.1";
    if (kind === "cred") {
      if (RETAIL.indexOf(refType) >= 0) return "11.4";
      return refMark ? "5.1" : "5.2";
    }
    if (kind !== "inv") return "";
    if (!cc || cc === "GR") return s ? "2.1" : "1.1";
    if (EU && EU[cc]) return s ? "2.2" : "1.2";
    return s ? "2.3" : "1.3";
  }
  // income classification for a type (credit notes: the original's market)
  function classOf(type, cc, nature, EU) {
    var cat = nature === "s" ? "category1_3" : "category1_1";
    var ty;
    if (type === "11.1" || type === "11.2" || type === "11.4") ty = "E3_561_003";
    else if (type === "1.2" || type === "2.2") ty = "E3_561_005";
    else if (type === "1.3" || type === "2.3") ty = "E3_561_006";
    else if (type === "5.1" || type === "5.2") ty = !cc || cc === "GR" ? "E3_561_001" : (EU && EU[cc] ? "E3_561_005" : "E3_561_006");
    else ty = "E3_561_001";
    return { classificationType: ty, classificationCategory: cat };
  }

  // Share `total` over `weights` (≥ 0) in whole cents, exactly.
  function share(total, weights) {
    var sum = 0;
    weights.forEach(function (w) { sum += w; });
    if (!weights.length) return [];
    if (sum <= 0) {
      var even = weights.map(function () { return 0; });
      even[0] = total;
      return even;
    }
    var raw = weights.map(function (w) { return total * w / sum; });
    var out = raw.map(Math.floor), left = total;
    out.forEach(function (v) { left -= v; });
    var order = raw.map(function (v, i) { return [v - Math.floor(v), i]; })
      .sort(function (a, b) { return b[0] - a[0] || a[1] - b[1]; });
    for (var k = 0; k < order.length && left > 0; k++, left--) out[order[k][1]]++;
    return out;
  }

  function unitCode(u) {
    var f = String(u || "").toLowerCase().replace(/[.\s]/g, "");
    if (/^(pcs?|piece|τεμ|τεμάχια|τμχ|τεμαχιο|τεμάχιο|τεμ\.?)$/.test(f)) return 1;
    if (/^(kg|κιλ[άα]?|κιλο|κιλό)$/.test(f)) return 2;
    if (/^(l|lt|λτ|λίτρα|λιτρα|λίτρο|λιτρο)$/.test(f)) return 3;
    if (/^(m|μ|μέτρα|μετρα|μέτρο|μετρο)$/.test(f)) return 4;
    if (/^(m2|m²|τμ|μ2)$/.test(f)) return 5;
    if (/^(m3|m³|κμ|μ3)$/.test(f)) return 6;
    return 0;
  }

  // o = { doc, totals (core.totals(doc)), seller (party), client (party),
  //       vat (the account's ΑΦΜ), series, aa, today ("YYYY-MM-DD"),
  //       type, nature "g"|"s", cc (counterpart country ISO), pay (1–8),
  //       exCat (vatExemptionCategory, when 0 % lines), whtCat,
  //       ref: { mark, label } (5.1), lang "el"|"en" }
  // → { ok, body, errs: [code] }   (codes: see Invoices' md.err.*)
  function build(o) {
    var errs = [];
    var d = o.doc || {}, T = o.totals || {}, s = o.seller || {}, c = o.client || {};
    var type = o.type, retail = RETAIL.indexOf(type) >= 0;
    var el = o.lang !== "en";
    if (!LABEL[type]) errs.push("type");
    if (d.cur !== "EUR") errs.push("cur");
    if (d.date !== o.today) errs.push("date");
    if (!/^[0-9]{9}$/.test(String(o.vat || ""))) errs.push("vat");
    if (clean9(s.afm) !== o.vat) errs.push("afm");
    var sa = parseAddr(s.addr);
    if (!sa) errs.push("saddr");
    if (!txt(s.name)) errs.push("sname");
    if (!txt(s.job)) errs.push("sjob");
    if (!txt(s.doy)) errs.push("sdoy");
    if (!isInt(o.pay) || o.pay < 1 || o.pay > 8) errs.push("pay");
    if (!/^[A-Za-z0-9._-]{1,50}$/.test(String(o.series || "")) || !/^[0-9]{1,15}$/.test(String(o.aa || ""))) errs.push("num");
    var lines = (d.lines || []).filter(function (l) { return l && (l.q !== 0 || l.p !== 0); });
    if (!lines.length) errs.push("lines");
    lines.forEach(function (l) {
      if (!Object.prototype.hasOwnProperty.call(VAT_CAT, String(l.vat))) errs.push("rate");
      if (Math.round(l.q * l.p * (100 - l.disc) / 100) < 0 || l.q < 0) errs.push("neg");
    });
    var zero = lines.some(function (l) { return l.vat === 0; });
    if (zero && !EXEMPT.some(function (e) { return e[0] === o.exCat; })) errs.push("exempt");
    var whtRow = null;
    if (T.wht > 0) {
      whtRow = WHT.filter(function (w) { return w[0] === o.whtCat && w[1] === d.wht; })[0] || null;
      if (!whtRow) errs.push("wht");
    }
    var cp = null, cc = String(o.cc || "").toUpperCase();
    if (!retail) {
      var afm = cc === "GR" ? clean9(c.afm) : String(c.afm || "").toUpperCase().replace(/[\s.-]+/g, "").replace(new RegExp("^" + cc), "");
      if (!/^[A-Z]{2}$/.test(cc)) errs.push("cc");
      else if (cc === "GR" ? !/^[0-9]{9}$/.test(afm) : !/^[0-9A-Z]{2,20}$/.test(afm)) errs.push("cafm");
      else if (cc === "GR" && afm === o.vat) errs.push("self");
      var ca = parseAddr(c.addr);
      if (cc && cc !== "GR" && (!ca || !txt(c.name))) errs.push("caddr");
      cp = { vatNumber: afm, country: cc, branch: 0 };
      if (cc !== "GR") cp.name = txt(c.name, 200);
      if (ca) cp.address = { street: ca.street, number: ca.number, postalCode: ca.pc, city: ca.city };
    }
    if (type === "5.1" && !(o.ref && /^[0-9]{1,20}$/.test(String(o.ref.mark || "")))) errs.push("ref");
    errs = errs.filter(function (e, i) { return errs.indexOf(e) === i; });
    if (errs.length) return { ok: false, body: null, errs: errs };

    // lines: share each rate's base and VAT (core.totals) over its lines
    var cls = classOf(type, cc, o.nature, o.EU);
    var rows = lines.map(function (l, i) {
      var gross = Math.round(l.q * l.p);
      return { l: l, i: i, raw: Math.round(l.q * l.p * (100 - l.disc) / 100), gross: gross, net: 0, vat: 0 };
    });
    (T.rates || []).forEach(function (r) {
      var mine = rows.filter(function (x) { return x.l.vat === r.rate; });
      var nets = share(r.base, mine.map(function (x) { return x.raw; }));
      mine.forEach(function (x, k) { x.net = nets[k]; });
      var vats = share(r.vat, mine.map(function (x) { return x.net; }));
      mine.forEach(function (x, k) { x.vat = vats[k]; });
    });
    var details = rows.map(function (x, k) {
      var l = x.l, u = unitCode(l.unit);
      var row = {
        lineNumber: k + 1,
        lineDescription: oneLine(l.d, 300) || "-",
        quantity: l.q,
        lineUnitPrice: eur(l.p),
        totalNetPriceBeforeDiscount: eur(x.gross),
        totalDiscountValue: eur(Math.max(0, x.gross - x.net)),
        netValue: eur(x.net),
        vatCategory: VAT_CAT[String(l.vat)],
        vatCategoryPercent: l.vat,
        vatAmount: eur(x.vat),
        incomeClassification: [{ classificationType: cls.classificationType, classificationCategory: cls.classificationCategory, amount: eur(x.net) }]
      };
      if (l.code) row.lineCode = txt(l.code, 50);
      if (u) row.measurementUnit = u;
      if (l.unit) row.measurementUnitLabel = txt(l.unit, 20);
      if (l.vat === 0) {
        row.vatExemptionCategory = o.exCat;
        row.vatExemptionCategoryLabel = EXEMPT.filter(function (e) { return e[0] === o.exCat; })[0][el ? 1 : 2];
      }
      return row;
    });
    var net = 0, vat = 0;
    rows.forEach(function (x) { net += x.net; vat += x.vat; });
    var wht = T.wht || 0, gross = net + vat - wht;
    var inv = {
      issuer: { vatNumber: o.vat, country: "GR", branch: 0 }
    };
    if (cp) inv.counterpart = cp;
    var head = { series: o.series, aa: String(o.aa), issueDate: o.today, invoiceType: type, currency: "EUR" };
    if (type === "5.1") {
      head.correlatedInvoices = [Number(o.ref.mark)];
      head.correlatedInvoicesLabel = oneLine(o.ref.label, 200) || String(o.ref.mark);
    }
    inv.invoiceHeader = head;
    inv.paymentMethods = [{ type: o.pay, amount: eur(gross) }];
    inv.invoiceDetails = details;
    if (whtRow) {
      inv.taxesTotals = [{ taxType: 1, taxCategory: whtRow[0], underlyingValue: eur(net), taxAmount: eur(wht),
                           taxTypeLabel: el ? "Παρακράτηση φόρου " + whtRow[1] + "%" : "Withholding tax " + whtRow[1] + "%" }];
    }
    inv.invoiceSummary = {
      totalNetValue: eur(net), totalVatAmount: eur(vat), totalWithheldAmount: eur(wht),
      totalFeesAmount: 0, totalStampDutyAmount: 0, totalOtherTaxesAmount: 0, totalDeductionsAmount: 0,
      totalGrossValue: eur(gross),
      incomeClassification: [{ classificationType: cls.classificationType, classificationCategory: cls.classificationCategory, amount: eur(net) }]
    };
    var pIssuer = {
      name: txt(s.trade && s.trade !== s.name ? s.name + " (" + s.trade + ")" : s.name, 200), profession: txt(s.job, 200), taxoffice: txt(s.doy, 100),
      addressStreet: sa.street, addressNumber: sa.number, addressPostalCode: sa.pc, addressCity: sa.city,
      addressCountry: el ? "Ελλάδα" : "Greece"
    };
    if (s.phone) pIssuer.phone = txt(s.phone, 40);
    if (s.email) pIssuer.email = txt(s.email, 120);
    if (s.web) pIssuer.webSite = txt(s.web, 120);
    var iban = String(s.iban || "").split("\n")[0];
    if (iban) pIssuer.emtyLine2 = txt(iban, 150);
    var add = {
      documentLabel: LABEL[type][el ? 0 : 1],
      paymentMethodInvoiceLabel: PAY.filter(function (p) { return p[0] === o.pay; })[0][el ? 1 : 2],
      documentLanguageCode: el ? "EL" : "EN",
      documentSizeCode: 0
    };
    var notes = [d.exempt, d.notes, d.terms].map(function (x) { return txt(x, 1000); }).filter(Boolean).join("\n");
    if (notes) add.documentComments = notes.slice(0, 2000);
    var extra = { issuer: pIssuer };
    if (c && (c.name || c.afm)) {
      var pc = {};
      if (c.name) pc.name = txt(c.name, 200);
      if (c.afm) pc.vat = txt(c.afm, 30);
      if (c.job) pc.profession = txt(c.job, 200);
      if (c.doy) pc.taxoffice = txt(c.doy, 100);
      var ca2 = parseAddr(c.addr);
      if (ca2) { pc.addressStreet = ca2.street; pc.addressNumber = ca2.number; pc.addressPostalCode = ca2.pc; pc.addressCity = ca2.city; }
      if (c.country) pc.addressCountry = txt(c.country, 60);
      if (c.phone) pc.phone = txt(c.phone, 40);
      if (c.email) pc.email = txt(c.email, 120);
      extra.counterpart = pc;
    }
    extra.additionalDetails = add;
    inv.providerAdditionalInvoiceDetails = extra;
    return { ok: true, body: { invoice: [inv] }, errs: [], net: net, vat: vat, gross: gross };
  }

  // The SendInvoices answer → { st, mark, uid, auth, url, errs: [{code, message}] }
  //   st: "ok" | "offline" | "dup" (already issued: mark/auth from AADE's
  //   message) | "rejected" | "tech" | "bad" (a provider-level refusal)
  function parseSend(status, data) {
    var out = { st: "bad", mark: "", uid: "", auth: "", url: "", errs: [] };
    if (status === 401) { out.st = "auth"; return out; }
    if (data && Array.isArray(data.errors) && !data.response) {
      out.errs = data.errors.slice(0, 10).map(function (m) { return { code: "", message: txt(m, 300) }; });
      return out;
    }
    var r = data && Array.isArray(data.response) ? data.response[0] : null;
    if (!r || typeof r !== "object") return out;
    var errs = [];
    (Array.isArray(r.errors) ? r.errors : []).forEach(function (g) {
      (g && Array.isArray(g.error) ? g.error : []).forEach(function (e) {
        if (e) errs.push({ code: txt(e.code, 10), message: txt(e.message, 300) });
      });
    });
    out.errs = errs.slice(0, 10);
    var mark = r.invoiceMark != null ? String(r.invoiceMark) : "";
    if (!/^[0-9]{1,20}$/.test(mark)) mark = "";
    out.uid = /^[A-F0-9]{40}$/.test(String(r.invoiceUid || "")) ? r.invoiceUid : "";
    out.auth = /^[A-F0-9]{16,64}$/i.test(String(r.authenticationCode || "")) ? String(r.authenticationCode) : "";
    var url = String(r.invoiceUrl || "");
    out.url = /^https:\/\/provider(-dev)?\.timologisi\.online\/[A-Za-z0-9\/._-]{1,200}$/.test(url) ? url : "";
    if (r.statusCode === "Success" && mark && mark !== "0") { out.st = "ok"; out.mark = mark; return out; }
    if (r.statusCode === "Offline") { out.st = "offline"; return out; }
    var dup = errs.filter(function (e) { return e.code === "228"; })[0];
    if (dup) {
      var m = /MARK\s*:\s*([0-9]{1,20})/i.exec(dup.message), a = /AUTHENTICATION_CODE\s*:\s*([A-F0-9]{16,64})/i.exec(dup.message);
      out.st = "dup";
      out.mark = m ? m[1] : "";
      out.auth = a ? a[1] : "";
      return out;
    }
    out.st = r.statusCode === "TechnicalError" ? "tech" : "rejected";
    return out;
  }

  // RequestTransmittedDocs → the document that is this one (same type,
  // series, number and gross), or null. Several rows (an Offline one and
  // its later MARK): the one with a MARK wins.
  function findSent(data, want) {
    var list = data && Array.isArray(data.providerTransmittedDocs) ? data.providerTransmittedDocs : [];
    var best = null;
    list.forEach(function (x) {
      if (!x || !x.invoiceHeader || !x.invoiceSummary) return;
      var h = x.invoiceHeader;
      if (String(h.invoiceType) !== want.type || String(h.series) !== want.series || String(h.aa) !== String(want.aa)) return;
      if (Math.round(Number(x.invoiceSummary.totalGrossValue) * 100) !== want.gross) return;
      var mark = x.mark != null ? String(x.mark) : "";
      var row = {
        mark: /^[0-9]{1,20}$/.test(mark) && mark !== "0" ? mark : "",
        uid: /^[A-F0-9]{40}$/.test(String(x.uid || "")) ? x.uid : "",
        auth: /^[A-F0-9]{16,64}$/i.test(String(x.authenticationCode || "")) ? String(x.authenticationCode) : "",
        url: /^https:\/\/provider(-dev)?\.timologisi\.online\/[A-Za-z0-9\/._-]{1,200}$/.test(String(x.pdfUrl || "")) ? x.pdfUrl : ""
      };
      if (!best || (!best.mark && row.mark)) best = row;
    });
    return best;
  }

  // Series + number as myDATA takes them: "INV-2026" + "42"
  function seriesOf(prefix, year, withYear) {
    var p = String(prefix || "").normalize ? String(prefix || "").normalize("NFD").replace(/[̀-ͯ]/g, "") : String(prefix || "");
    var map = { "Α": "A", "Β": "B", "Ε": "E", "Ζ": "Z", "Η": "H", "Ι": "I", "Κ": "K", "Μ": "M", "Ν": "N", "Ο": "O", "Ρ": "P", "Τ": "T", "Υ": "Y", "Χ": "X" };
    p = p.toUpperCase().split("").map(function (ch) { return map[ch] || ch; }).join("")
      .replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
    var parts = [p, withYear ? String(year) : ""].filter(Boolean);
    return (parts.join("-") || "0").slice(0, 50);
  }

  var api = {
    VAT_CAT: VAT_CAT, EXEMPT: EXEMPT, WHT: WHT, PAY: PAY, LABEL: LABEL, RETAIL: RETAIL,
    parseAddr: parseAddr, autoType: autoType, classOf: classOf, share: share, unitCode: unitCode,
    build: build, parseSend: parseSend, findSent: findSent, seriesOf: seriesOf, clean9: clean9
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosMyData = api;
})(typeof window !== "undefined" ? window : this);
