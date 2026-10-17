// ============================================================
// orOS Invoices — .orosinvoices file (invoices/package.js,
// window.OrosInvoicesPackage). The descriptor of Invoices for the
// record apps' kit (../recordpkg.js, docs/oros-bundle.md "Record
// apps"): every document, payment, client, series, template and
// business profile in one orOS bundle, with the official PDFs of
// /internal/Invoices/ in media/; opening one ADDS what this device
// lacks, with its ids. Pure (no DOM, no storage), so the app and
// `node --test` run the same code. Needs core.js
// (window.OrosInvoicesCore; require("./core.js") under Node).
//   DESC                     the kit descriptor; merge = core.js
//                            mergeInvoices (pure: per id, newer m
//                            wins), which only sees the records the
//                            kit let through
//   DESC.norm(data)          a file's data → core.js normalize (its
//                            own record checks), capped counts; a
//                            document's file only under
//                            /internal/Invoices/; no secret-looking
//                            extras; media = { "<disk path>":
//                            "<sha256>.<ext>" } checked
//   DESC.strip(state)        the slice → { ver, prof, series, clients,
//                            docs, pays, tpls, profs?, media? }: no
//                            tombstones, no field whose name looks like
//                            a key, token or password (provider keys
//                            never live in the slice; this is the
//                            second lock). The result is marked as a
//                            file's data (see tombIds).
//   DESC.tombIds(state)      the deleted ids; on THIS device's state
//                            (never the file's) also every document
//                            that is no longer a draft (issued,
//                            cancelled, recorded): the kit then keeps
//                            it as it is, even with "Update with
//                            newer versions" (numbering is never
//                            touched by a file)
//   DESC.previews(state, l)  documents.csv and payments.csv (core.js
//                            docsCsv / paysCsv, the app's own "Export
//                            CSV", over all dates; formula guard)
//   forLocal(getLocal)       DESC whose norm also drops, against this
//                            device's data: a numbered document whose
//                            series + year + number is already taken
//                            here by another document, a recorded
//                            invoice already recorded here (same
//                            number + ΑΦΜ), and payments of documents
//                            that are neither here nor in the file
//   mediaKey(path, state)    the media key of a document's file
//   safePath(p) / KEY_RE     the disk paths and media keys allowed
//   kindOf(id, state)        "doc" | "pay" | "client" | "series" |
//                            "tpl" | "prof" | ""
// ============================================================
(function (root) {
  "use strict";

  var C = typeof module === "object" && module.exports ? require("./core.js") : root.OrosInvoicesCore;
  var LIM = { series: 500, clients: 20000, docs: 50000, pays: 100000, tpls: 2000, profs: 100, media: 50000 };
  var COLLS = ["series", "clients", "docs", "pays", "tpls", "profs"];
  var DIR = "/internal/Invoices/";
  var PATH_RE = /^\/internal\/Invoices\/[^\/\\\u0000-\u001f\u007f:*?"<>|]{1,120}\.(pdf|png|jpe?g)$/i;
  var KEY_RE = /^[0-9a-f]{64}\.(pdf|png|jpg)$/;
  // Field names that look like credentials: never packed, never taken
  var SECRET_RE = /key|token|secret|passw|pwd|auth|cred|cookie|session|bearer/i;
  var FILE_MARK = "__orosFile";

  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function cap(v, n) { return Array.isArray(v) ? v.slice(0, n) : []; }
  function safePath(p) { return typeof p === "string" && PATH_RE.test(p) && p.indexOf("..") < 0; }
  function scrub(rec) {
    if (!isObj(rec)) return rec;
    Object.keys(rec).forEach(function (k) { if (SECRET_RE.test(k)) delete rec[k]; });
    return rec;
  }
  function mark(o) {
    try { Object.defineProperty(o, FILE_MARK, { value: true, enumerable: false }); } catch (e) {}
    return o;
  }
  function cleanMedia(m, docs) {
    var out = {}, n = 0, used = {};
    (docs || []).forEach(function (d) { if (d && !d.del && d.file) used[d.file] = 1; });
    if (!isObj(m)) return out;
    Object.keys(m).forEach(function (p) {
      if (n >= LIM.media || !used[p] || !safePath(p) || typeof m[p] !== "string" || !KEY_RE.test(m[p])) return;
      out[p] = m[p];
      n++;
    });
    return out;
  }

  function norm(data) {
    if (!isObj(data)) return null;
    var raw = {};
    COLLS.forEach(function (k) { raw[k] = cap(data[k], LIM[k]); });
    raw.prof = isObj(data.prof) ? data.prof : {};
    var out = C.normalize(raw);
    COLLS.forEach(function (k) { (out[k] || []).forEach(scrub); });
    scrub(out.prof);
    out.docs.forEach(function (d) { if (!d.del && d.file && !safePath(d.file)) d.file = ""; });
    var media = cleanMedia(data.media, out.docs);
    if (Object.keys(media).length) out.media = media;
    return out;
  }
  function strip(state) {
    var s = isObj(state) ? state : {};
    var out = { ver: C.DATA_VER, prof: scrub(clone(isObj(s.prof) ? s.prof : {})) };
    COLLS.forEach(function (k) {
      var list = (Array.isArray(s[k]) ? s[k] : []).filter(function (x) { return isObj(x) && !x.del; }).map(function (x) { return scrub(clone(x)); });
      if (k !== "profs" || list.length) out[k] = list;
    });
    var media = cleanMedia(s.media, out.docs);
    if (Object.keys(media).length) out.media = media;
    return mark(out);
  }
  function tombIds(state) {
    var out = [];
    if (!isObj(state)) return out;
    COLLS.forEach(function (k) {
      (Array.isArray(state[k]) ? state[k] : []).forEach(function (x) { if (isObj(x) && x.del) out.push(x.id); });
    });
    // this device's issued / cancelled / recorded documents: a file
    // never changes them (the kit counts them as already here)
    if (!state[FILE_MARK]) (Array.isArray(state.docs) ? state.docs : []).forEach(function (d) {
      if (isObj(d) && !d.del && d.st !== "draft") out.push(d.id);
    });
    return out;
  }

  // ---------- against this device ----------
  function numKey(data, d) {
    var s = C.series(data, d.ser);
    return s ? d.ser + "|" + (s.year ? String(d.date).slice(0, 4) : "*") + "|" + d.seq : "";
  }
  function extKey(d) {
    var n = String(d.num || "").trim().toUpperCase();
    return n ? n + "|" + String(d.c && d.c.afm || "").trim().toUpperCase() : "";
  }
  function forLocal(getLocal) {
    var D = {};
    Object.keys(DESC).forEach(function (k) { D[k] = DESC[k]; });
    D.norm = function (data) {
      var out = norm(data);
      if (!out) return out;
      var local = null;
      try { local = getLocal(); } catch (e) { local = null; }
      if (!isObj(local)) return out;
      local = C.normalize(local);
      var taken = {}, ext = {}, here = {}, dead = {};
      local.docs.forEach(function (d) {
        if (d.del) { dead[d.id] = 1; return; }
        here[d.id] = d.st;
        if (d.st === "draft") return;
        if (d.kind === "ext") { var e = extKey(d); if (e) ext[e] = d.id; return; }
        if (d.seq > 0) { var k = numKey(local, d); if (k) taken[k] = d.id; }
      });
      out.docs = out.docs.filter(function (d) {
        // a draft has no number; a document already issued here is kept
        // by the kit as it is; a draft here that the file has issued
        // takes the file's number only when no other document has it
        if (d.del || d.st === "draft" || (here[d.id] && here[d.id] !== "draft")) return true;
        if (d.kind === "ext") { var e = extKey(d); return !(e && ext[e] && ext[e] !== d.id); }
        if (!(d.seq > 0)) return true;
        var k = numKey(local, d);
        return !(k && taken[k] && taken[k] !== d.id);
      });
      var inFile = {};
      out.docs.forEach(function (d) { if (!d.del && !dead[d.id]) inFile[d.id] = 1; });
      out.pays = out.pays.filter(function (p) { return p.del || here[p.doc] || inFile[p.doc]; });
      if (out.media) {
        out.media = cleanMedia(out.media, out.docs);
        if (!Object.keys(out.media).length) delete out.media;
      }
      return out;
    };
    return D;
  }

  // ---------- previews ----------
  // One flat { en, el } table (orosI18n packs: pack "invoices"); the
  // CSV column titles are DOC_COLS / PAY_COLS in order.
  var WORDS = {
    en: {
      "csv.num": "Number", "csv.kind": "Kind", "csv.status": "Status", "csv.date": "Date", "csv.due": "Due",
      "csv.client": "Client", "csv.afm": "Tax number", "csv.cur": "Currency", "csv.net": "Net", "csv.vat": "VAT",
      "csv.total": "Total", "csv.wht": "Withholding", "csv.pay": "Amount payable", "csv.paid": "Paid",
      "csv.bal": "Balance", "csv.mark": "ΜΑΡΚ", "csv.amt": "Amount", "csv.how": "Method", "csv.note": "Note",
      "kind.inv": "Invoice", "kind.rcpt": "Receipt", "kind.pro": "Proforma", "kind.cred": "Credit note", "kind.ext": "Recorded invoice",
      "st.draft": "Draft", "st.void": "Cancelled", "st.pro": "Proforma", "st.credit": "Credit note", "st.paid": "Paid",
      "st.partial": "Partly paid", "st.overdue": "Overdue", "st.unpaid": "Unpaid",
      "how.bank": "Bank transfer", "how.cash": "Cash", "how.card": "Card", "how.iris": "IRIS", "how.paypal": "PayPal", "how.other": "Other"
    },
    el: {
      "csv.num": "Αριθμός", "csv.kind": "Είδος", "csv.status": "Κατάσταση", "csv.date": "Ημερομηνία", "csv.due": "Λήξη",
      "csv.client": "Πελάτης", "csv.afm": "ΑΦΜ", "csv.cur": "Νόμισμα", "csv.net": "Καθαρή αξία", "csv.vat": "ΦΠΑ",
      "csv.total": "Σύνολο", "csv.wht": "Παρακράτηση", "csv.pay": "Πληρωτέο", "csv.paid": "Πληρώθηκαν",
      "csv.bal": "Υπόλοιπο", "csv.mark": "ΜΑΡΚ", "csv.amt": "Ποσό", "csv.how": "Τρόπος", "csv.note": "Σημείωση",
      "kind.inv": "Τιμολόγιο", "kind.rcpt": "Απόδειξη", "kind.pro": "Προτιμολόγιο", "kind.cred": "Πιστωτικό", "kind.ext": "Καταχωρισμένο τιμολόγιο",
      "st.draft": "Πρόχειρο", "st.void": "Ακυρωμένο", "st.pro": "Προτιμολόγιο", "st.credit": "Πιστωτικό", "st.paid": "Εξοφλημένο",
      "st.partial": "Μερικώς εξοφλημένο", "st.overdue": "Ληξιπρόθεσμο", "st.unpaid": "Ανεξόφλητο",
      "how.bank": "Τραπεζική μεταφορά", "how.cash": "Μετρητά", "how.card": "Κάρτα", "how.iris": "IRIS", "how.paypal": "PayPal", "how.other": "Άλλο"
    }
  };
  var DOC_COLS = ["num", "kind", "status", "date", "due", "client", "afm", "cur", "net", "vat", "total", "wht", "pay", "paid", "bal", "mark"];
  var PAY_COLS = ["date", "num", "client", "amt", "cur", "how", "note"];
  function words(lang) {
    var I = typeof window !== "undefined" && window.orosI18n;
    if (I && lang && !WORDS[lang]) I.table(WORDS, "invoices", lang);
    return WORDS[lang] || WORDS.en;
  }
  function previews(state, lang) {
    var w = words(lang);
    function col(k) { return w["csv." + k]; }
    function word(pre) { return function (k) { return w[pre + k] || k; }; }
    var data = C.normalize(state);
    var from = "0000-01-01", to = "9999-12-31";
    return {
      "documents.csv": C.docsCsv(data, from, to, DOC_COLS.map(col), word("kind."), word("st."), lang, C.today()),
      "payments.csv": C.paysCsv(data, from, to, PAY_COLS.map(col), word("how."), lang)
    };
  }

  function mediaKey(p, state) {
    return isObj(state) && isObj(state.media) && typeof state.media[p] === "string" && KEY_RE.test(state.media[p]) ? state.media[p] : "";
  }
  // What an id names in a state (Undo removes each its own way).
  function kindOf(id, state) {
    var s = isObj(state) ? state : {}, k = "";
    [["docs", "doc"], ["pays", "pay"], ["clients", "client"], ["series", "series"], ["tpls", "tpl"], ["profs", "prof"]]
      .forEach(function (c) {
        (Array.isArray(s[c[0]]) ? s[c[0]] : []).forEach(function (x) { if (!k && x && x.id === id) k = c[1]; });
      });
    return k;
  }

  var DESC = {
    app: "invoices", title: "Invoices", slice: "invoices", ext: ".orosinvoices", mime: "application/x-oros-invoices",
    colls: {
      series: { shape: "array", id: "id", stamp: "m" },
      clients: { shape: "array", id: "id", stamp: "m" },
      docs: { shape: "array", id: "id", stamp: "m" },
      pays: { shape: "array", id: "id", stamp: "m" },
      tpls: { shape: "array", id: "id", stamp: "m" },
      profs: { shape: "array", id: "id", stamp: "m" }
    },
    norm: norm, strip: strip, tombIds: tombIds, previews: previews, merge: C.mergeInvoices
  };

  var api = { DESC: DESC, forLocal: forLocal, kindOf: kindOf, mediaKey: mediaKey, safePath: safePath,
              KEY_RE: KEY_RE, DIR: DIR, LIM: LIM, WORDS: WORDS };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrosInvoicesPackage = api;
})(this);
