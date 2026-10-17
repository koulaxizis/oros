// ============================================================
// orOS Quote — .orosquote file (quote/package.js,
// window.OrosQuotePackage). The descriptor of Quote for the record
// apps' kit (../recordpkg.js, docs/oros-bundle.md "Record apps"):
// the quotes (with their lines and instalments), the clients and the
// templates in one orOS bundle; opening one ADDS what this device
// lacks, with its ids. Pure (no DOM, no storage), so the app and
// `node --test` run the same code. Uses core.js (window.OrosQuoteCore;
// require("./core.js") under Node) for the totals of the preview.
//   DESC                     the kit descriptor (no merge: the kit's
//                            plain insert; quote.js then runs the
//                            result through its own migrate + save)
//   DESC.norm(data)          a file's data → { ver, quotes, clients,
//                            templates } with known fields only, typed
//                            and capped. A quote is one record (whole
//                            quote last-writer-wins, as in sync): its
//                            lines and instalments travel inside it
//   DESC.strip(state)        the slice → { ver, quotes, clients,
//                            templates }: no tombstones (deleted), no
//                            payment presets (payMethods: settings with
//                            fixed ids, the bank details stay on the
//                            device), no device-local activeQuoteId,
//                            and no q.share (the "Accept by link" token
//                            and hash: whoever had them could forge an
//                            answer)
//   DESC.tombIds(state)      the ids in state.deleted
//   DESC.previews(state, l)  quotes.md (every quote and template as text)
//   asCopy(getLocal, makeId) "Open as copy": quotes and templates under
//                            FRESH ids (they work like templates), each
//                            copied quote a draft with the next free
//                            number; clients are added by id as usual
//   kindOf(id, state)        "quote" | "client" | "template" | ""
// ============================================================
(function (root) {
  "use strict";

  var QC = root && root.OrosQuoteCore;
  if (!QC && typeof require === "function") { try { QC = require("./core.js"); } catch (e) { QC = null; } }

  var LIM = { quotes: 5000, clients: 5000, templates: 500, items: 500, inst: 120,
              text: 20000, line: 2000, short: 200 };
  var STATUSES = ["draft", "sent", "accepted", "rejected", "expired"];
  var YMD = /^\d{4}-\d{2}-\d{2}$/;

  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function num(v, lo, hi) {
    var n = typeof v === "number" && isFinite(v) ? v : 0;
    if (typeof lo === "number" && n < lo) n = lo;
    if (typeof hi === "number" && n > hi) n = hi;
    return n;
  }
  function str(v, max) { return typeof v === "string" ? v.slice(0, max) : ""; }
  function line(v, max) { return str(v, max).replace(/[\u0000-\u001f\u007f]/g, " "); }
  // multi-line text: control characters other than tab / newline go
  function text(v, max) { return str(v, max).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " "); }
  function okId(v) { return typeof v === "string" && v !== "__proto__" && /^[A-Za-z0-9_.:-]{1,80}$/.test(v); }
  function ymd(v) { return typeof v === "string" && YMD.test(v) ? v : ""; }
  function cur(v) { return typeof v === "string" && /^[A-Z]{3}$/.test(v) ? v : "EUR"; }

  function normItem(it, i) {
    if (!isObj(it)) return null;
    return { id: okId(it.id) ? it.id : "it" + i, code: line(it.code, LIM.short), desc: text(it.desc, LIM.line),
             qty: num(it.qty, -1e9, 1e9), price: num(it.price, -1e12, 1e12),
             disc: num(it.disc, 0, 100), vat: num(it.vat, 0, 100) };
  }
  function normIns(x, i) {
    if (!isObj(x)) return null;
    return { id: okId(x.id) ? x.id : "in" + i, date: ymd(x.date), amount: num(x.amount, -1e12, 1e12) };
  }
  // A quote or (with name) a template: the fields migrate() knows.
  function normOffer(q, isTpl) {
    if (!isObj(q) || !okId(q.id)) return null;
    var o = {
      id: q.id, num: line(q.num, LIM.short),
      clientId: okId(q.clientId) ? q.clientId : null,
      status: STATUSES.indexOf(q.status) >= 0 ? q.status : "draft",
      date: ymd(q.date), dueDate: ymd(q.dueDate), currency: cur(q.currency),
      items: [], gDisc: num(q.gDisc, 0, 100),
      payment: text(q.payment, LIM.text), notes: text(q.notes, LIM.text),
      instalments: [], mtime: num(q.mtime, 0), pos: num(q.pos, 0)
    };
    (Array.isArray(q.items) ? q.items : []).slice(0, LIM.items).forEach(function (it, i) {
      var c = normItem(it, i);
      if (c) o.items.push(c);
    });
    (Array.isArray(q.instalments) ? q.instalments : []).slice(0, LIM.inst).forEach(function (x, i) {
      var c = normIns(x, i);
      if (c) o.instalments.push(c);
    });
    if (isTpl) o.name = line(q.name, LIM.short);
    else if (isObj(q.acc)) {                       // a recorded acceptance (name, time, hash, message)
      var a = { n: line(q.acc.n, LIM.short), at: num(q.acc.at, 0), h: /^[0-9a-f]{64}$/.test(q.acc.h) ? q.acc.h : "" };
      if (typeof q.acc.m === "string" && q.acc.m) a.m = text(q.acc.m, LIM.line);
      o.acc = a;
    }
    return o;
  }
  function normClient(c) {
    if (!isObj(c) || !okId(c.id)) return null;
    return { id: c.id, name: line(c.name, LIM.short), email: line(c.email, LIM.short), phone: line(c.phone, LIM.short),
             address: text(c.address, LIM.line), taxId: line(c.taxId, LIM.short),
             mtime: num(c.mtime, 0), pos: num(c.pos, 0) };
  }
  function list(src, max, fn) {
    var out = [], seen = Object.create(null);
    (Array.isArray(src) ? src : []).slice(0, max).forEach(function (x) {
      var c = fn(x);
      if (c && !seen[c.id]) { seen[c.id] = 1; out.push(c); }
    });
    return out;
  }
  function norm(data) {
    if (!isObj(data)) return null;
    var out = {
      ver: 1,
      quotes: list(data.quotes, LIM.quotes, function (q) { return normOffer(q, false); }),
      clients: list(data.clients, LIM.clients, normClient),
      templates: list(data.templates, LIM.templates, function (q) { return normOffer(q, true); })
    };
    if (isObj(data.deleted)) out.deleted = data.deleted;          // strip and tombIds see it, then it goes
    return out;
  }
  function strip(state) {
    var s = isObj(state) ? state : {};
    var out = JSON.parse(JSON.stringify({ ver: 1, quotes: Array.isArray(s.quotes) ? s.quotes : [],
                                          clients: Array.isArray(s.clients) ? s.clients : [],
                                          templates: Array.isArray(s.templates) ? s.templates : [] }));
    out.quotes.forEach(function (q) { if (isObj(q)) delete q.share; });
    out.templates.forEach(function (q) { if (isObj(q)) delete q.share; });
    return out;
  }
  function tombIds(state) {
    return isObj(state) && isObj(state.deleted) ? Object.keys(state.deleted) : [];
  }

  // ---------- preview: quotes.md ----------
  function md(v) { return String(v == null ? "" : v).replace(/[\r\n]+/g, " ").replace(/\|/g, "\\|").trim(); }
  function money(n, c) { return (Math.round(n * 100) / 100).toFixed(2) + " " + c; }
  function totals(q) {
    var sub = 0, g = q.gDisc || 0;
    (q.items || []).forEach(function (it) { sub += (it.qty || 0) * (it.price || 0) * (1 - (it.disc || 0) / 100); });
    sub = Math.round(sub * 100) / 100;
    var total = QC && typeof QC.total === "function" ? QC.total(q) : sub;
    return { sub: sub, total: total };
  }
  // The preview's words ("md." keys: one pack "quote" with quote.js
  // and accept.js). English and Greek inline; any other language from
  // the "quote" pack when ../i18n.js is loaded (never in node).
  var L = {
    en: { "md.quotes": "Quotes", "md.templates": "Templates", "md.client": "Client", "md.date": "Date", "md.due": "Due", "md.status": "Status",
          "md.code": "Code", "md.desc": "Description", "md.qty": "Qty", "md.price": "Unit price", "md.disc": "Disc %", "md.vat": "VAT %",
          "md.sub": "Subtotal", "md.gdisc": "Discount", "md.total": "Total (with VAT)", "md.payment": "Payment terms", "md.notes": "Notes",
          "md.inst": "Instalments", "md.accepted": "Accepted by", "md.none": "No quotes.",
          "md.st.draft": "Draft", "md.st.sent": "Sent", "md.st.accepted": "Accepted", "md.st.rejected": "Rejected", "md.st.expired": "Expired" },
    el: { "md.quotes": "Προσφορές", "md.templates": "Πρότυπα", "md.client": "Πελάτης", "md.date": "Ημερομηνία", "md.due": "Λήξη", "md.status": "Κατάσταση",
          "md.code": "Κωδικός", "md.desc": "Περιγραφή", "md.qty": "Ποσ.", "md.price": "Τιμή μονάδας", "md.disc": "Έκπτ. %", "md.vat": "ΦΠΑ %",
          "md.sub": "Υποσύνολο", "md.gdisc": "Έκπτωση", "md.total": "Σύνολο (με ΦΠΑ)", "md.payment": "Όροι πληρωμής", "md.notes": "Σημειώσεις",
          "md.inst": "Δόσεις", "md.accepted": "Αποδοχή από", "md.none": "Καμία προσφορά.",
          "md.st.draft": "Πρόχειρη", "md.st.sent": "Απεστάλη", "md.st.accepted": "Αποδεκτή", "md.st.rejected": "Απορρίφθηκε", "md.st.expired": "Έληξε" }
  };
  // { quotes, …, st: { draft, … } } for the language.
  function words(lang) {
    var I = typeof window !== "undefined" && window.orosI18n;
    var tb = L[lang] || (I && typeof lang === "string" ? I.table(L, "quote", lang) : L.en);
    var w = { st: {} };
    Object.keys(L.en).forEach(function (k) {
      var v = tb[k] !== undefined ? tb[k] : L.en[k];
      if (k.indexOf("md.st.") === 0) w.st[k.slice(6)] = v; else w[k.slice(3)] = v;
    });
    return w;
  }
  function offerMd(out, q, w, clients, isTpl) {
    var c = q.currency || "EUR", head = isTpl ? (q.name || "—") : [q.num, clients[q.clientId]].filter(Boolean).join(" — ") || "—";
    out.push("## " + md(head), "");
    if (!isTpl) {
      var cl = q.clientId && clients[q.clientId] ? clients[q.clientId] : "";
      if (cl) out.push("- " + w.client + ": " + md(cl));
      if (q.date) out.push("- " + w.date + ": " + q.date);
      if (q.dueDate) out.push("- " + w.due + ": " + q.dueDate);
      out.push("- " + w.status + ": " + (w.st[q.status] || q.status));
      if (q.acc && q.acc.n) out.push("- " + w.accepted + ": " + md(q.acc.n));
      out.push("");
    }
    if ((q.items || []).length) {
      out.push("| " + [w.code, w.desc, w.qty, w.price, w.disc, w.vat].join(" | ") + " |", "|---|---|--:|--:|--:|--:|");
      q.items.forEach(function (it) {
        out.push("| " + [md(it.code), md(it.desc), it.qty, money(it.price, c), it.disc, it.vat].join(" | ") + " |");
      });
      out.push("");
    }
    var tt = totals(q);
    out.push("- " + w.sub + ": " + money(tt.sub, c));
    if (q.gDisc) out.push("- " + w.gdisc + ": " + q.gDisc + "%");
    out.push("- **" + w.total + ": " + money(tt.total, c) + "**", "");
    if ((q.instalments || []).length) {
      out.push(w.inst + ":", "");
      q.instalments.forEach(function (x) { out.push("- " + (x.date || "—") + ": " + money(x.amount || 0, c)); });
      out.push("");
    }
    if (q.payment) out.push("**" + w.payment + "**", "", String(q.payment).trim(), "");
    if (q.notes) out.push("**" + w.notes + "**", "", String(q.notes).trim(), "");
  }
  function previews(state, lang) {
    var w = words(lang), s = isObj(state) ? state : {}, clients = {};
    (s.clients || []).forEach(function (c) { if (isObj(c)) clients[c.id] = c.name || ""; });
    var out = ["# " + w.quotes, ""];
    if (!(s.quotes || []).length) out.push(w.none, "");
    (s.quotes || []).forEach(function (q) { if (isObj(q)) offerMd(out, q, w, clients, false); });
    if ((s.templates || []).length) {
      out.push("# " + w.templates, "");
      s.templates.forEach(function (q) { if (isObj(q)) offerMd(out, q, w, clients, true); });
    }
    return { "quotes.md": out.join("\n") };
  }

  // What an id names in a state (Undo removes each the right way).
  function kindOf(id, state) {
    var s = isObj(state) ? state : {}, k = "";
    [["quotes", "quote"], ["clients", "client"], ["templates", "template"]].forEach(function (p) {
      (Array.isArray(s[p[0]]) ? s[p[0]] : []).forEach(function (x) { if (!k && x && x.id === id) k = p[1]; });
    });
    return k;
  }

  var DESC = {
    app: "quote", title: "Quote", slice: "quote", ext: ".orosquote", mime: "application/x-oros-quote",
    colls: {
      quotes: { shape: "array", id: "id", stamp: "mtime" },
      clients: { shape: "array", id: "id", stamp: "mtime" },
      templates: { shape: "array", id: "id", stamp: "mtime" }
    },
    norm: norm, strip: strip, tombIds: tombIds, previews: previews
  };

  // ---------- "Open as copy" ----------
  function randomId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  // The next free OFF-YYYY-NNN of this year after the numbers in nums.
  function nextNum(nums, year) {
    var re = /^OFF-(\d{4})-(\d+)$/, max = 0;
    nums.forEach(function (n) {
      var m = re.exec(n || "");
      if (m && parseInt(m[1], 10) === year) max = Math.max(max, parseInt(m[2], 10));
    });
    return "OFF-" + year + "-" + ("000" + (max + 1)).slice(-3);
  }
  function asCopy(getLocal, makeId) {
    var mk = typeof makeId === "function" ? makeId : randomId;
    var d = {};
    Object.keys(DESC).forEach(function (k) { d[k] = DESC[k]; });
    d.norm = function (data) {
      var out = norm(data);
      if (!out) return out;
      var now = Date.now(), year = new Date(now).getFullYear(), used = {}, nums = [];
      var local = typeof getLocal === "function" ? getLocal() : null;
      ["quotes", "clients", "templates"].forEach(function (k) {
        (isObj(local) && Array.isArray(local[k]) ? local[k] : []).forEach(function (x) {
          if (x && x.id) used[x.id] = 1;
          if (k === "quotes" && x) nums.push(x.num);
        });
      });
      if (isObj(local) && isObj(local.deleted)) Object.keys(local.deleted).forEach(function (id) { used[id] = 1; });
      out.clients.forEach(function (c) { used[c.id] = 1; });
      function fresh() {
        var id = "", tries = 0;
        do { id = String(mk()); tries++; } while ((used[id] || !okId(id)) && tries < 20);
        if (used[id] || !okId(id)) return "";
        used[id] = 1;
        return id;
      }
      function copy(q, isQuote) {
        var id = fresh();
        if (!id) return null;
        var x = JSON.parse(JSON.stringify(q));
        x.id = id; x.mtime = now;
        x.items.forEach(function (it) { it.id = fresh() || it.id; });
        x.instalments.forEach(function (ins) { ins.id = fresh() || ins.id; });
        if (isQuote) {
          x.num = nextNum(nums, year);
          nums.push(x.num);
          x.status = "draft";
          delete x.acc;
        }
        return x;
      }
      var res = { ver: out.ver, quotes: [], clients: out.clients, templates: [] };
      out.quotes.forEach(function (q) { var x = copy(q, true); if (x) res.quotes.push(x); });
      out.templates.forEach(function (q) { var x = copy(q, false); if (x) res.templates.push(x); });
      if (out.deleted) res.deleted = out.deleted;   // drops only the file's own deleted clients
      return res;
    };
    return d;
  }

  var api = { DESC: DESC, asCopy: asCopy, kindOf: kindOf, nextNum: nextNum, LIM: LIM };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrosQuotePackage = api;
})(typeof window !== "undefined" ? window : this);
