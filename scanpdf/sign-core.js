// ============================================================
// orOS Scanner & PDF — sign-core.js: signature requests (pure)
// ------------------------------------------------------------
// The person puts places to fill in (fields) on the pages, and the
// PDF goes to someone else as a link with an expiry (BR-SHARE-RELAY,
// share/relay.js: AES-256-GCM pieces on the orOS relay, the key only
// in the link). That person opens scanpdf/sign.html in any browser,
// fills the fields in and signs, keeps the signed PDF, and sends a
// reply link back; orOS makes the same signed PDF from its own copy
// of the original. A simple electronic signature (eIDAS art. 3(10)),
// not an advanced or qualified one.
// i18n-inline-ok: the certificate page is fixed bilingual text (EN + EL) in every PDF, whatever the reader's language.
//
// Request (envelope { v: 1, k: "sign", d } + the PDF as bin):
//   d = { v: 1, n: name of the document, h: SHA-256 hex of the PDF,
//         pages, by: sender's name, be?: sender's email, to: signer's
//         name, te?: signer's email, msg?, lang, lk: 1 with an access
//         code, fields: [field] }
//   field = { id, pg (0-based page), fx, fy (centre, fractions of the
//             page as it shows), w, h (fractions of the page as it
//             shows), k (core FIELDS), req (must be filled) }
// Reply (envelope { v: 1, k: "signed", d }):
//   d = { v: 1, rq: request id, h: SHA-256 of the PDF signed, st:
//         "signed" | "declined", nm: the name the signer typed, why?,
//         vals: { fieldId: value }, op: opened, ca: consented, at:
//         signed or declined (signer's clock, ms), tz, ua, lang }
//   value: sig / init { src: PNG data: URL, w, h }; name / text /
//          date a string; check true.
// The list of requests ("Signature requests") is sync slice
// "scanpdfSign" (STORE_KEY): { v: 1, items: { id: item } }
//   item = { id, a: sent at, q: the request (cleanRequest, without
//            the PDF: the fields to put the answer back on), x:
//            expires, c: link code, d?: revoke secret, p?: original in
//            Files, got?: { at, st, nm, rh, hf?, pf?, why? }, rv?:
//            { at }, gone?: at }
//   merge: union by id; the fixed fields of an id are the same on
//   every device (larger JSON wins a difference); got / rv / gone:
//   the earlier one wins; a closed item drops its revoke secret, a
//   removed one keeps only { id, a, gone } (tombstone); at most
//   MAX_ITEMS, newest first. Deterministic and associative (R26).
// UMD: window.ScanPdfSign, or module.exports in Node.
// ============================================================
(function (root) {
  "use strict";

  var NODE = typeof module !== "undefined" && module.exports;
  var C = NODE ? require("./core.js") : root.ScanPdfCore;

  var VERSION = "1.0.0";
  var STORE_KEY = "oros-scanpdf-sign";
  var SLICE = "scanpdfSign";
  var KINDS = C.FIELDS;
  var MAX_FIELDS = 60;
  var MAX_ITEMS = 300;
  var MAX_SIG_URL = 280000;
  var LANGS = ["en", "el", "de"];
  var ID_RE = /^[A-Za-z0-9_-]{22}$/;
  var HEX_RE = /^[0-9a-f]{64}$/;
  var CODE_RE = /^(r1|q1)\.[A-Za-z0-9_.-]{60,120}$/;
  var SECRET_RE = /^[A-Za-z0-9_-]{43}$/;
  var EMAIL_RE = /^[^\s@<>"',;]{1,64}@[^\s@<>"',;]{1,190}\.[^\s@<>"',;.]{2,}$/;

  // ---------- small checks ----------
  function str(v, max) {
    return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
  }
  function para(v, max) {
    if (typeof v !== "string") return "";
    return v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, "").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
  }
  function email(v) { var e = str(v, 254); return EMAIL_RE.test(e) ? e : ""; }
  function frac(v, lo, hi) {
    v = Number(v);
    if (!isFinite(v)) return null;
    return Math.round(Math.min(hi, Math.max(lo, v)) * 10000) / 10000;
  }
  function stamp(v) { v = Number(v); return Number.isSafeInteger(v) && v > 0 ? v : 0; }
  function lang(v) { return LANGS.indexOf(v) !== -1 ? v : "en"; }

  // ---------- fields ----------
  function cleanField(f, pages) {
    if (!f || typeof f !== "object") return null;
    var pg = Number(f.pg);
    if (!Number.isSafeInteger(pg) || pg < 0 || pg >= (pages || 1)) return null;
    var w = frac(f.w, 0.005, 1), h = frac(f.h, 0.005, 1), fx = frac(f.fx, 0, 1), fy = frac(f.fy, 0, 1);
    if (w === null || h === null || fx === null || fy === null) return null;
    var id = str(f.id, 40);
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) return null;
    return { id: id, pg: pg, fx: fx, fy: fy, w: w, h: h, k: KINDS.indexOf(f.k) !== -1 ? f.k : "sig", req: f.req !== false };
  }
  // The fields of the pages as they go into the PDF. list: [{ ov, g:
  // { W, H, R } }] in output order (the page list and each page's
  // geometry). Each field stays upright on the page as it shows.
  function fieldsOf(list) {
    var out = [], seen = {};
    (list || []).forEach(function (p, pg) {
      var g = p && p.g;
      if (!g) return;
      var d = C.dispSize(g.W, g.H, g.R), S = Math.min(g.W, g.H);
      (p.ov || []).forEach(function (raw) {
        var o = C.cleanOv(raw);
        if (!o || o.t !== "field" || out.length >= MAX_FIELDS) return;
        var v = C.ovDisp(o, g.W, g.H, g.R), side = v.turn % 180 !== 0;
        var bw = (side ? o.h : o.w) * S, bh = (side ? o.w : o.h) * S;
        var id = "f" + (out.length + 1);
        while (seen[id]) id += "x";
        seen[id] = true;
        out.push(cleanField({ id: id, pg: pg, fx: v.fx, fy: v.fy, w: bw / d[0], h: bh / d[1], k: o.k, req: o.req }, list.length));
      });
    });
    return out;
  }

  // ---------- request and reply ----------
  function cleanRequest(d) {
    if (!d || typeof d !== "object" || d.v !== 1) return null;
    var pages = Number(d.pages);
    if (!Number.isSafeInteger(pages) || pages < 1 || pages > C.MAX_PAGES) return null;
    var h = typeof d.h === "string" ? d.h.toLowerCase() : "";
    if (!HEX_RE.test(h)) return null;
    var by = str(d.by, 120), to = str(d.to, 120);
    if (!by || !to) return null;
    var fields = [], ids = {};
    (Array.isArray(d.fields) ? d.fields : []).slice(0, MAX_FIELDS).forEach(function (f) {
      var c = cleanField(f, pages);
      if (c && !ids[c.id]) { ids[c.id] = true; fields.push(c); }
    });
    if (!fields.some(function (f) { return f.k === "sig"; })) return null;
    var r = { v: 1, n: str(d.n, 120) || "Document", h: h, pages: pages, by: by, to: to, lang: lang(d.lang), fields: fields };
    var be = email(d.be), te = email(d.te), msg = para(d.msg, 1000);
    if (be) r.be = be;
    if (te) r.te = te;
    if (msg) r.msg = msg;
    if (d.lk === 1) r.lk = 1;
    return r;
  }
  function cleanSig(v) {
    if (!v || typeof v !== "object" || typeof v.src !== "string") return null;
    if (v.src.indexOf("data:image/png;base64,") !== 0 || v.src.length > MAX_SIG_URL) return null;
    if (!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(v.src)) return null;
    var w = Number(v.w), h = Number(v.h);
    if (!(w >= 1 && w <= 4000 && h >= 1 && h <= 4000)) return null;
    return { src: v.src, w: Math.round(w), h: Math.round(h) };
  }
  function cleanValue(f, v) {
    if (f.k === "sig" || f.k === "init") return cleanSig(v);
    if (f.k === "check") return v === true ? true : null;
    var s = str(v, f.k === "date" ? 40 : 200);
    return s || null;
  }
  // The reply, checked against its request (when given): only values
  // for the request's fields, of the right kind.
  function cleanReply(d, req) {
    if (!d || typeof d !== "object" || d.v !== 1) return null;
    var st = d.st === "declined" ? "declined" : d.st === "signed" ? "signed" : "";
    var h = typeof d.h === "string" ? d.h.toLowerCase() : "";
    if (!st || !HEX_RE.test(h) || typeof d.rq !== "string" || !ID_RE.test(d.rq)) return null;
    if (req && req.h !== h) return null;
    var r = { v: 1, rq: d.rq, h: h, st: st, nm: str(d.nm, 120), at: stamp(d.at), op: stamp(d.op), ca: stamp(d.ca),
              tz: str(d.tz, 64), ua: str(d.ua, 200), lang: lang(d.lang), vals: {} };
    if (!r.at) return null;
    if (st === "declined") {
      var why = para(d.why, 500);
      if (why) r.why = why;
      return r;
    }
    if (!r.nm || !r.ca) return null;
    var vals = d.vals && typeof d.vals === "object" ? d.vals : {};
    if (req) {
      req.fields.forEach(function (f) {
        if (!Object.prototype.hasOwnProperty.call(vals, f.id)) return;
        var c = cleanValue(f, vals[f.id]);
        if (c !== null) r.vals[f.id] = c;
      });
      if (missing(req, r.vals).length) return null;
    }
    return r;
  }
  // Required fields still empty: [field id].
  function missing(req, vals) {
    return req.fields.filter(function (f) {
      return f.req && !(vals && Object.prototype.hasOwnProperty.call(vals, f.id) && cleanValue(f, vals[f.id]) !== null);
    }).map(function (f) { return f.id; });
  }

  // What a filled field draws on its page (core additions). g: the
  // page's { W, H, R } in the PDF; the value stands upright on the
  // page as it shows.
  function valueOvs(f, v, g) {
    var d = C.dispSize(g.W, g.H, g.R), S = Math.min(g.W, g.H);
    var at = C.ovAt(f.fx, f.fy, g.W, g.H, g.R), bw = f.w * d[0], bh = f.h * d[1];
    var base = { id: f.id, cx: at.cx, cy: at.cy, A: C.normRot(g.R) };
    var c = cleanValue(f, v);
    if (c === null) return [];
    if (f.k === "sig" || f.k === "init") {
      var r = c.w / c.h, iw = bw * 0.96, ih = iw / r;
      if (ih > bh * 0.96) { ih = bh * 0.96; iw = ih * r; }
      return [Object.assign(base, { t: "img", src: c.src, w: Math.max(0.01, iw / S), h: Math.max(0.005, ih / S) })];
    }
    if (f.k === "check") {
      var side = Math.min(bw, bh) * 0.8 / S;
      return [Object.assign(base, { t: "shape", k: "check", w: side, h: side, color: "black", sw: Math.max(0.003, side * 0.12), fill: false })];
    }
    return [Object.assign(base, { t: "text", text: c, fs: Math.max(0.005, Math.min(0.5, bh * 0.55 / S)), mw: Math.max(0.01, bw * 0.95 / S), color: "black" })];
  }
  // The additions of the whole reply, page by page: [{ pg, ov }].
  function stampItems(req, reply, geoms) {
    var by = {};
    req.fields.forEach(function (f) {
      if (!Object.prototype.hasOwnProperty.call(reply.vals, f.id) || !geoms[f.pg]) return;
      (by[f.pg] = by[f.pg] || []).push.apply(by[f.pg], valueOvs(f, reply.vals[f.id], geoms[f.pg]));
    });
    return Object.keys(by).map(Number).sort(function (a, b) { return a - b; }).map(function (pg) { return { pg: pg, ov: by[pg] }; });
  }

  // ---------- canonical JSON and hashes ----------
  function canon(v) {
    if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
    if (v && typeof v === "object") {
      return "{" + Object.keys(v).filter(function (k) { return v[k] !== undefined; }).sort().map(function (k) {
        return JSON.stringify(k) + ":" + canon(v[k]);
      }).join(",") + "}";
    }
    return JSON.stringify(v === undefined ? null : v);
  }
  function hex(buf) {
    return Array.prototype.map.call(new Uint8Array(buf), function (b) { return (b < 16 ? "0" : "") + b.toString(16); }).join("");
  }
  function subtle() {
    var c = (typeof crypto !== "undefined" && crypto) || (root && root.crypto);
    if (!c || !c.subtle) throw new Error("crypto");
    return c.subtle;
  }
  function sha256(bytes) {
    var b = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
    return subtle().digest("SHA-256", b).then(hex);
  }
  // The signing record (attached to the signed PDF as
  // signing-record.json): the request without its PDF, the reply
  // without the signature pictures (their hashes instead), and where
  // the link pointed. rh = SHA-256 of canon(reply) with the pictures.
  function record(rid, req, reply, extra) {
    var vals = {}, pics = [];
    Object.keys(reply.vals).sort().forEach(function (k) {
      var v = reply.vals[k];
      if (v && typeof v === "object") { pics.push(k); vals[k] = { w: v.w, h: v.h }; }
      else vals[k] = v;
    });
    return sha256(canon(reply)).then(function (rh) {
      var jobs = pics.map(function (k) { return sha256(reply.vals[k].src).then(function (h) { vals[k].sha256 = h; }); });
      return Promise.all(jobs).then(function () {
        var rec = {
          kind: "orOS signing record", v: 1, type: "simple electronic signature (eIDAS art. 3(10))",
          request: { id: rid, document: req.n, sha256: req.h, pages: req.pages, from: req.by, fromEmail: req.be || "",
                     to: req.to, toEmail: req.te || "", accessCode: !!req.lk, fields: req.fields },
          reply: { status: reply.st, name: reply.nm, opened: iso(reply.op), consented: iso(reply.ca), at: iso(reply.at),
                   timeZone: reply.tz, browser: reply.ua, language: reply.lang, values: vals, reason: reply.why || "",
                   sha256: rh }
        };
        if (extra && extra.sent) rec.request.sent = iso(extra.sent);
        if (extra && extra.got) rec.received = iso(extra.got);
        return { rec: rec, rh: rh, json: canon(rec) };
      });
    });
  }
  function iso(ms) { return ms ? new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z") : ""; }

  // ---------- certificate (English and Greek together) ----------
  var CERT = {
    title: "Signature certificate · Πιστοποιητικό υπογραφής",
    doc: "Document · Έγγραφο", hash: "Original SHA-256 · Πρωτότυπο", pages: "Pages · Σελίδες",
    from: "Sent by · Αποστολέας", to: "Signer · Υπογράφων", typed: "Name typed · Όνομα που έγραψε",
    how: "Identified by · Ταυτοποίηση", link: "the link sent to · ο σύνδεσμος προς", code: "and an access code · και κωδικός πρόσβασης",
    sent: "Sent · Στάλθηκε", opened: "Opened · Άνοιξε", consented: "Agreed to sign electronically · Συμφώνησε σε ηλεκτρονική υπογραφή",
    signed: "Signed · Υπογράφηκε", received: "Received · Παραλήφθηκε", tz: "Time zone · Ζώνη ώρας",
    browser: "Browser · Πρόγραμμα", record: "Record SHA-256 · Εγγραφή", fields: "Fields filled · Πεδία",
    note: "Simple electronic signature under eIDAS (EU 910/2014, art. 3(10) and 25(1)); not an advanced or qualified " +
          "electronic signature. Times are from each person's device (UTC). The full record is attached to this PDF as " +
          "signing-record.json. · Απλή ηλεκτρονική υπογραφή κατά τον eIDAS (ΕΕ 910/2014, άρθρα 3(10) και 25(1)), όχι " +
          "προηγμένη ή εγκεκριμένη. Οι ώρες είναι της συσκευής του καθενός (UTC). Η πλήρης εγγραφή είναι συνημμένη σε " +
          "αυτό το PDF ως signing-record.json."
  };
  function when(ms) { return ms ? iso(ms).replace("T", " ").replace("Z", " UTC") : "—"; }
  function cert(out) {
    var r = out.rec, q = r.request, p = r.reply, rows = [];
    rows.push([CERT.doc, q.document], [CERT.hash, q.sha256], [CERT.pages, String(q.pages)]);
    rows.push([CERT.from, q.from + (q.fromEmail ? " <" + q.fromEmail + ">" : "")]);
    rows.push([CERT.to, q.to + (q.toEmail ? " <" + q.toEmail + ">" : "")], [CERT.typed, p.name]);
    rows.push([CERT.how, CERT.link + " " + (q.toEmail || q.to) + (q.accessCode ? ", " + CERT.code : "")]);
    if (q.sent) rows.push([CERT.sent, when(Date.parse(q.sent))]);
    rows.push([CERT.opened, when(Date.parse(p.opened))], [CERT.consented, when(Date.parse(p.consented))]);
    rows.push([CERT.signed, when(Date.parse(p.at))]);
    if (r.received) rows.push([CERT.received, when(Date.parse(r.received))]);
    rows.push([CERT.fields, String(Object.keys(p.values).length) + " / " + q.fields.length]);
    rows.push([CERT.tz, p.timeZone || "—"], [CERT.browser, p.browser || "—"], [CERT.record, p.sha256]);
    return { title: CERT.title, rows: rows, note: CERT.note };
  }

  // ---------- the list of requests (sync slice) ----------
  function cleanGot(g) {
    if (!g || typeof g !== "object") return null;
    var at = stamp(g.at), st = g.st === "declined" ? "declined" : g.st === "signed" ? "signed" : "";
    if (!at || !st) return null;
    var o = { at: at, st: st, nm: str(g.nm, 120) };
    if (typeof g.rh === "string" && HEX_RE.test(g.rh)) o.rh = g.rh;
    if (typeof g.hf === "string" && HEX_RE.test(g.hf)) o.hf = g.hf;
    if (typeof g.pf === "string" && g.pf.indexOf(C.ROOT + "/") === 0 && g.pf.indexOf("..") === -1) o.pf = g.pf.slice(0, 1000);
    var why = para(g.why, 500);
    if (why) o.why = why;
    return o;
  }
  function cleanItem(id, it) {
    if (!ID_RE.test(id) || !it || typeof it !== "object") return null;
    var a = stamp(it.a);
    if (!a) return null;
    var gone = stamp(it.gone);
    if (gone) return { id: id, a: a, gone: gone };
    var q = cleanRequest(it.q);
    if (!q || typeof it.c !== "string" || !CODE_RE.test(it.c)) return null;
    var o = { id: id, a: a, q: q, x: stamp(it.x), c: it.c };
    if (typeof it.p === "string" && it.p.indexOf(C.ROOT + "/") === 0 && it.p.indexOf("..") === -1) o.p = it.p.slice(0, 1000);
    var got = cleanGot(it.got);
    if (got) o.got = got;
    var rv = it.rv && stamp(it.rv.at);
    if (rv) o.rv = { at: rv };
    if (!got && !rv && typeof it.d === "string" && SECRET_RE.test(it.d)) o.d = it.d;
    return o;
  }
  function readStore(raw) {
    var items = {};
    if (raw && typeof raw === "object" && raw.items && typeof raw.items === "object") {
      Object.keys(raw.items).forEach(function (id) {
        var c = cleanItem(id, raw.items[id]);
        if (c) items[id] = c;
      });
    }
    return cap({ v: 1, items: items });
  }
  function cap(store) {
    var ids = Object.keys(store.items);
    if (ids.length <= MAX_ITEMS) return store;
    ids.sort(function (x, y) { return (store.items[y].a - store.items[x].a) || (x < y ? -1 : x > y ? 1 : 0); });
    var keep = {};
    ids.slice(0, MAX_ITEMS).forEach(function (id) { keep[id] = store.items[id]; });
    return { v: 1, items: keep };
  }
  function earlier(x, y) {
    if (!x) return y;
    if (!y) return x;
    if (x.at !== y.at) return x.at < y.at ? x : y;
    return canon(x) >= canon(y) ? x : y;
  }
  function mergeItem(x, y) {
    if (!x) return y;
    if (!y) return x;
    var gone = x.gone && y.gone ? Math.min(x.gone, y.gone) : (x.gone || y.gone);
    if (gone) return { id: x.id, a: Math.min(x.a, y.a), gone: gone };
    var fx = fixed(x), fy = fixed(y), o = canon(fx) >= canon(fy) ? fx : fy;
    var p = [x.p, y.p].filter(Boolean).sort().pop();
    if (p) o.p = p;
    var got = earlier(x.got, y.got), rv = earlier(x.rv, y.rv);
    if (got) o.got = got;
    if (rv) o.rv = rv;
    if (!got && !rv) {
      var d = x.d || y.d;
      if (x.d && y.d && x.d !== y.d) d = x.d > y.d ? x.d : y.d;
      if (d) o.d = d;
    }
    return cleanItem(o.id, o);
  }
  // The parts of an item that never change after it is sent.
  function fixed(it) {
    var o = Object.assign({}, it);
    delete o.got; delete o.rv; delete o.d; delete o.p;
    return o;
  }
  function merge(a, b) {
    var A = readStore(a), B = readStore(b), items = {};
    Object.keys(A.items).concat(Object.keys(B.items)).forEach(function (id) {
      if (items[id]) return;
      var m = mergeItem(A.items[id], B.items[id]);
      if (m) items[id] = m;
    });
    return canonStore({ v: 1, items: items });
  }
  // The same store with its items in id order (what the slice sends).
  function canonStore(store) {
    var s = cap(store), items = {};
    Object.keys(s.items).sort().forEach(function (id) { items[id] = s.items[id]; });
    return { v: 1, items: items };
  }
  function addItem(store, it) {
    var s = readStore(store), c = cleanItem(it.id, it);
    if (!c) return s;
    s.items[c.id] = mergeItem(s.items[c.id], c);
    return canonStore(s);
  }
  function setGot(store, id, got) {
    var s = readStore(store), it = s.items[id];
    if (!it || it.gone) return s;
    s.items[id] = mergeItem(it, Object.assign({}, it, { got: got }));
    return canonStore(s);
  }
  function setRevoked(store, id, at) {
    var s = readStore(store), it = s.items[id];
    if (!it || it.gone) return s;
    s.items[id] = mergeItem(it, Object.assign({}, it, { rv: { at: at } }));
    return canonStore(s);
  }
  function remove(store, id, at) {
    var s = readStore(store), it = s.items[id];
    if (!it) return s;
    s.items[id] = { id: id, a: it.a, gone: at };
    return canonStore(s);
  }
  // "waiting" | "signed" | "declined" | "revoked" | "expired"
  function status(it, now) {
    if (it.got) return it.got.st;
    if (it.rv) return "revoked";
    if (it.x && it.x <= now) return "expired";
    return "waiting";
  }
  // Live items, newest first, each with its status.
  function list(store, now) {
    var s = readStore(store);
    return Object.keys(s.items).map(function (id) { return s.items[id]; }).filter(function (it) { return !it.gone; })
      .sort(function (x, y) { return (y.a - x.a) || (x.id < y.id ? -1 : 1); })
      .map(function (it) { return Object.assign({}, it, { status: status(it, now || Date.now()) }); });
  }

  // ---------- links ----------
  // Request: <orOS>/scanpdf/sign.html#<code>; reply: <orOS>/scanpdf/#signed=<code>.
  function signLink(origin, code) { return String(origin).replace(/\/+$/, "") + "/scanpdf/sign.html#" + code; }
  function replyLink(origin, code) { return String(origin).replace(/\/+$/, "") + "/scanpdf/#signed=" + code; }
  // A reply code from what was pasted or opened: the link, its
  // "#signed=…" part or the bare code.
  function replyCode(text) {
    var s = String(text || "").trim(), m = /#signed=([^\s#&]+)/.exec(s);
    var code = m ? m[1] : s;
    try { code = decodeURIComponent(code); } catch (e) {}
    return CODE_RE.test(code) ? code : "";
  }
  // The request code from the signing page's fragment.
  function requestCode(hash) {
    var code = String(hash || "").replace(/^#/, "");
    try { code = decodeURIComponent(code); } catch (e) {}
    return CODE_RE.test(code) ? code : "";
  }
  // A short, safe file name for the signed copy.
  function signedName(n) { return (C.cleanName(n) || "Document") + " (signed).pdf"; }
  function sentName(n) { return (C.cleanName(n) || "Document") + " (to sign).pdf"; }

  var api = {
    VERSION: VERSION, STORE_KEY: STORE_KEY, SLICE: SLICE, KINDS: KINDS, MAX_FIELDS: MAX_FIELDS, MAX_ITEMS: MAX_ITEMS,
    cleanField: cleanField, fieldsOf: fieldsOf, cleanRequest: cleanRequest, cleanReply: cleanReply, cleanValue: cleanValue,
    missing: missing, valueOvs: valueOvs, stampItems: stampItems, canon: canon, sha256: sha256, record: record,
    cert: cert, iso: iso, readStore: readStore, merge: merge, canonStore: canonStore, addItem: addItem, setGot: setGot,
    setRevoked: setRevoked, remove: remove, status: status, list: list, signLink: signLink, replyLink: replyLink,
    replyCode: replyCode, requestCode: requestCode, signedName: signedName, sentName: sentName, email: email
  };
  if (NODE) module.exports = api;
  else root.ScanPdfSign = api;
})(typeof window !== "undefined" ? window : this);
