// ============================================================
// orOS CRM — rs.js (Revenue Splitter on the partner card, W6, v1.2.0)
// Pure functions, no DOM, no storage, no clock. The shop's Revenue
// Splitter (noxpress, 1.11+) answers two read-only routes under its
// WooCommerce REST API, called through Connected services
// (links/core.js allowlist, relay/ext.js the same):
//   GET /rs/balances   per beneficiary, all time: sales share, other
//                      income, payments, remaining (integer cents)
//   GET /rs/report?date_start&date_end
//                      products sold in the period with their splits
//                      and current stock (cents)
// Names never go into a URL: the card asks for every beneficiary and
// picks its own here. Nothing read is stored; only the link (crm/core.js
// rsl: the beneficiary's exact name) is CRM data.
//
// API (window.OrosCrmRs, module.exports under Node):
//   REQ_BAL, reqReport(today) → the two requests (this calendar year)
//   parseBal(json) → { cur, since, ben: [{ name, sales, income,
//     payments, remaining }] } | null when it is not Revenue Splitter's
//   parseRep(json) → { cur, from, to, products: [{ id, title, qty, free,
//     net, stock, status, splits: [{ name, pct, amount }] }] } | null
//   card(bal, rep, names) → { cur, owed, sales, income, payments,
//     found: [name], missing: [name], titles: [{ id, title, qty, free,
//     share, pct, stock, status }], share } the partner's part
//   suggest(bal, cust, taken) → [{ name, why }] the shop's beneficiaries,
//     the ones whose name matches the partner (why "name" | "person")
//     first; taken = names linked to other partners (left out)
//
// Contracts (RS-CTR, Revenue Splitter 1.14+, 1.1.0): the Author Portal
// shows each beneficiary their contracts (the list: crm/core.js
// portalPlan, sent by CRM) and lets them ask for a talk about a
// renewal. CRM pulls the requests while it is open (GET
// /rs/contract-requests?state=new), then marks each one "oros" once it
// is in CRM, and "closed" once its follow-up is done or deleted.
//   reqPushCtr(body), REQ_CTR, REQ_RQ_NEW, REQ_RQ_OROS, reqMark(id, state)
//   parseSaved(json) → { saved, skipped: [{ id, why }] } | null
//   parseRequests(json) → [{ id, ctr, ben, title, at, note, state }] | null
//   rqIds(shopId, reqId) → { fup, act }: the same ids on every device
//   importPlan(data, shopId, firstShopId, reqs) → [{ req, cust, ctr,
//     ids, have }] (have = already in CRM) + left: [req] (no partner)
//   closeList(data, shopId, reqs) → [request id] whose follow-up is done
//     or was deleted
//
// Creator requests (RS-PF, Revenue Splitter 1.18.0, 1.2.0): the Author
// Portal's page ("bio") and author-copy ("copies") requests, pulled with
// the renewal requests, marked "oros", then "done" / "declined" with a
// reply the creator reads in the portal.
//   REQ_PF_NEW, REQ_PF_OROS, REQ_PF_ALL, reqPfMark(id, state, reply)
//   parsePfRequests(json) → [{ id, type, ben, at, state, note, bio?, was?,
//     links?, photo?, pid?, title?, qty?, reply? }] | null
//   pfIds(shopId, req) → { fup, act, done, decl, type }; pfIdsOf(fupId)
//     the same from the follow-up's id; pfKind(rowId)
//   pfImportPlan(data, shopId, firstShopId, reqs) → { plan, left }
//   pfOutcome(data, shopId, req, defReply) → { state, reply, at } | null
//   pfCloseList(data, shopId, reqs, defReply(req)) → [{ id, state, reply }]
//   pfActText(req, words) → the note's text (≤ 2000)
// ============================================================
(function (root) {
  "use strict";

  var CC = typeof module !== "undefined" && module.exports ? require("./core.js") : root.OrosCrmCore;
  var CUR_RE = /^[A-Z]{3}$/, DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  var MAX_BEN = 2000, MAX_PRODUCTS = 5000, MAX_SPLITS = 50;

  var REQ_BAL = { m: "GET", path: "/rs/balances" };
  function reqReport(today) {
    var to = DAY_RE.test(today || "") ? today : "";
    if (!to) return null;
    return { m: "GET", path: "/rs/report?date_start=" + to.slice(0, 4) + "-01-01&date_end=" + to };
  }

  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function cents(v) { return isInt(v) && Math.abs(v) <= 1e13 ? v : 0; }
  function text(v, max) { return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max) : ""; }
  function fold(s) { return CC.fold(String(s || "")).replace(/\s+/g, " ").trim(); }
  function cmp(a, b) { return a < b ? -1 : (a > b ? 1 : 0); }

  function parseBal(j) {
    if (!j || typeof j !== "object" || !Array.isArray(j.beneficiaries)) return null;
    var ben = [];
    j.beneficiaries.slice(0, MAX_BEN).forEach(function (b) {
      var name = b && text(b.name, 120);
      if (!name) return;
      ben.push({ name: name, sales: cents(b.sales), income: cents(b.income), payments: cents(b.payments), remaining: cents(b.remaining) });
    });
    return { cur: CUR_RE.test(j.currency) ? j.currency : "", since: DAY_RE.test(j.sales_since || "") ? j.sales_since : "", ben: ben };
  }

  function parseRep(j) {
    if (!j || typeof j !== "object" || !Array.isArray(j.products)) return null;
    var per = j.period && typeof j.period === "object" ? j.period : {};
    var products = [];
    j.products.slice(0, MAX_PRODUCTS).forEach(function (p) {
      if (!p || !isInt(p.product_id) || p.product_id <= 0) return;
      var splits = [];
      (Array.isArray(p.splits) ? p.splits : []).slice(0, MAX_SPLITS).forEach(function (s) {
        var name = s && text(s.name, 120);
        if (!name) return;
        var pct = typeof s.percent === "number" && isFinite(s.percent) && s.percent >= 0 && s.percent <= 100 ? s.percent : 0;
        splits.push({ name: name, pct: pct, amount: cents(s.amount) });
      });
      products.push({
        id: p.product_id, title: text(p.title, 200) || "#" + p.product_id,
        qty: isInt(p.qty) ? p.qty : 0, free: isInt(p.qty_free) ? p.qty_free : 0, net: cents(p.net),
        stock: isInt(p.stock) ? p.stock : null, status: text(p.stock_status, 20), splits: splits
      });
    });
    return { cur: CUR_RE.test(j.currency) ? j.currency : "", from: DAY_RE.test(per.start || "") ? per.start : "",
             to: DAY_RE.test(per.end || "") ? per.end : "", products: products };
  }

  function card(bal, rep, names) {
    var want = {};
    (names || []).forEach(function (n) { want[n] = 1; });
    var out = { cur: (bal && bal.cur) || (rep && rep.cur) || "", owed: 0, sales: 0, income: 0, payments: 0,
                found: [], missing: [], titles: [], share: 0 };
    var seen = {};
    (bal ? bal.ben : []).forEach(function (b) {
      if (!want[b.name] || seen[b.name]) return;
      seen[b.name] = 1;
      out.found.push(b.name);
      out.owed += b.remaining;
      out.sales += b.sales;
      out.income += b.income;
      out.payments += b.payments;
    });
    (names || []).forEach(function (n) { if (bal && !seen[n]) out.missing.push(n); });
    (rep ? rep.products : []).forEach(function (p) {
      var share = 0, pct = 0, mine = false;
      p.splits.forEach(function (s) {
        if (!want[s.name]) return;
        mine = true;
        share += s.amount;
        pct += s.pct;
      });
      if (!mine) return;
      out.share += share;
      out.titles.push({ id: p.id, title: p.title, qty: p.qty, free: p.free, share: share, pct: Math.round(pct * 100) / 100,
                        stock: p.stock, status: p.status });
    });
    out.titles.sort(function (a, b) { return b.share - a.share || b.qty - a.qty || cmp(fold(a.title), fold(b.title)) || a.id - b.id; });
    return out;
  }

  function suggest(bal, cust, taken) {
    var off = {};
    (taken || []).forEach(function (n) { off[n] = 1; });
    var mine = {}, ppl = {};
    if (cust) {
      [cust.name, cust.alias].forEach(function (n) { var f = fold(n); if (f) mine[f] = 1; });
      (cust.people || []).forEach(function (p) { var f = fold(p && p.n); if (f) ppl[f] = 1; });
    }
    var RANK = { name: 0, person: 1, "": 2 };
    return (bal ? bal.ben : []).filter(function (b) { return !off[b.name]; }).map(function (b) {
      var f = fold(b.name);
      return { name: b.name, why: mine[f] ? "name" : (ppl[f] ? "person" : "") };
    }).sort(function (a, b) { return RANK[a.why] - RANK[b.why] || cmp(fold(a.name), fold(b.name)) || cmp(a.name, b.name); });
  }

  // ---------- Contracts (RS-CTR) ----------
  var RQ_ID = /^[A-Za-z0-9_-]{1,64}$/, MAX_RQ = 500;
  var REQ_CTR = { m: "GET", path: "/rs/contracts" };
  var REQ_RQ_NEW = { m: "GET", path: "/rs/contract-requests?state=new" };
  var REQ_RQ_OROS = { m: "GET", path: "/rs/contract-requests?state=oros" };
  function reqPushCtr(body) { return { m: "POST", path: "/rs/contracts", body: body }; }
  function reqMark(id, state) { return { m: "POST", path: "/rs/contract-requests/" + id, body: { state: state } }; }
  var WHY = ["bad_id", "duplicate_id", "unknown_beneficiary", "bad_title", "bad_fmt", "bad_date", "bad_state", "bad_renewed", "bad_item"];
  function parseSaved(j) {
    if (!j || typeof j !== "object" || !isInt(j.saved) || j.saved < 0) return null;
    var skipped = [];
    (Array.isArray(j.skipped) ? j.skipped : []).slice(0, 2000).forEach(function (x) {
      if (!x || typeof x !== "object") return;
      skipped.push({ id: text(x.id, 64), why: WHY.indexOf(x.why) >= 0 ? x.why : "bad_item" });
    });
    return { saved: j.saved, skipped: skipped };
  }
  function parseRequests(j) {
    if (!j || typeof j !== "object" || !Array.isArray(j.requests)) return null;
    var out = [];
    j.requests.slice(0, MAX_RQ).forEach(function (r) {
      if (!r || typeof r !== "object") return;
      var id = typeof r.id === "number" && isInt(r.id) && r.id > 0 ? String(r.id) : (typeof r.id === "string" ? r.id : "");
      if (!RQ_ID.test(id)) return;
      var at = Date.parse(typeof r.at === "string" ? r.at : "");
      out.push({ id: id, ctr: typeof r.contract_id === "string" ? text(r.contract_id, 64) : "", ben: text(r.ben, 120),
                 title: text(r.title, 200), at: isFinite(at) && at > 0 ? at : 0,
                 note: typeof r.note === "string" ? r.note.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, " ").trim().slice(0, 500) : "",
                 state: ["new", "oros", "closed"].indexOf(r.state) >= 0 ? r.state : "new" });
    });
    return out;
  }
  // FNV-1a, two seeds → base36: the same request gets the same follow-up
  // and activity ids on every device, so two devices pulling at once
  // keep one copy, and one pulled again is seen as done
  function h32(str, seed) {
    var h = seed >>> 0;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }
  function rqIds(shopId, reqId) {
    var s = String(shopId) + "|rsrq|" + String(reqId);
    var a = h32(s, 2166136261).toString(36), b = h32(s, 3735928559).toString(36);
    return { fup: "rqf" + a + b, act: "rqa" + a + b };
  }
  function importPlan(data, shopId, firstShopId, reqs) {
    var plan = [], left = [], tombs = (data && data.tombs) || {};
    (reqs || []).forEach(function (q) {
      var k = q.ctr ? CC.byId(data.ctr || [], q.ctr) : null, cust = null;
      if (k && !tombs[k.id]) cust = CC.byId(data.cust, k.cust);
      else k = null;
      if (!cust && q.ben) {
        (data.rsl || []).some(function (r) {
          if (!r.n || r.n.indexOf(q.ben) < 0 || (r.a || firstShopId || "") !== shopId) return false;
          cust = CC.byId(data.cust, r.id);
          return !!cust;
        });
      }
      if (!cust || tombs[cust.id]) { left.push(q); return; }
      var ids = rqIds(shopId, q.id);
      var have = !!(CC.byId(data.fups || [], ids.fup) || tombs[ids.fup] || CC.byId(data.acts || [], ids.act) || tombs[ids.act]);
      plan.push({ req: q, cust: cust, ctr: k, ids: ids, have: have });
    });
    return { plan: plan, left: left };
  }
  function closeList(data, shopId, reqs) {
    var out = [], tombs = (data && data.tombs) || {};
    (reqs || []).forEach(function (q) {
      if (q.state !== "oros") return;
      var ids = rqIds(shopId, q.id), f = CC.byId(data.fups || [], ids.fup);
      if ((f && f.done) || (!f && tombs[ids.fup])) out.push(q.id);
    });
    return out;
  }

  // ---------- Creator requests (RS-PF, Revenue Splitter 1.18.0) ----------
  // The Author Portal's page ("bio") and author-copy ("copies") requests.
  // Pulled like the renewal requests; each becomes a follow-up and a note
  // on the partner's card, then "oros". The answer the creator sees is a
  // CRM note with an id hashed from the request (one for done, one for
  // declined), so every device and every older version keeps it; the
  // next pull sends it ("done" / "declined" with the reply).
  var REQ_PF_NEW = { m: "GET", path: "/rs/profile-requests?state=new" };
  var REQ_PF_OROS = { m: "GET", path: "/rs/profile-requests?state=oros" };
  var REQ_PF_ALL = { m: "GET", path: "/rs/profile-requests?state=all" };
  var PF_TYPES = ["bio", "copies"], PF_STATES = ["new", "oros", "done", "declined"];
  var PF_BIO = 5000, PF_REPLY = 500, PF_LINKS = 6;
  function reqPfMark(id, state, reply) {
    var body = { state: state }, r = state !== "oros" ? pfReply(reply) : "";
    if (r) body.reply = r;
    return { m: "POST", path: "/rs/profile-requests/" + id, body: body };
  }
  // RS-PF W2: the creator's new photo (binary; links/host.js answers
  // { status, type, blob } with the type from its first bytes)
  function reqPfPhoto(id) {
    var s = String(id);
    return /^[A-Za-z0-9_-]{1,64}$/.test(s) ? { m: "GET", path: "/rs/profile-requests/" + s + "/photo" } : null;
  }
  function longText(v, max) {
    return typeof v === "string" ? v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, " ").trim().slice(0, max) : "";
  }
  // what orOS sends as a reply: one line ≤ 500, no controls, no <> (the
  // relay owner's rule, rsText)
  function pfReply(v) { return text(typeof v === "string" ? v.replace(/[<>]/g, "") : "", PF_REPLY).trim(); }
  function okUrl(u) { return typeof u === "string" && /^https?:\/\/[^\s<>"]{1,500}$/i.test(u.trim()); }
  function parsePfRequests(j) {
    if (!j || typeof j !== "object" || !Array.isArray(j.requests)) return null;
    var out = [];
    j.requests.slice(0, MAX_RQ).forEach(function (r) {
      if (!r || typeof r !== "object" || PF_TYPES.indexOf(r.type) < 0) return;
      var id = typeof r.id === "number" && isInt(r.id) && r.id > 0 ? String(r.id) : (typeof r.id === "string" ? r.id : "");
      if (!RQ_ID.test(id)) return;
      var at = Date.parse(typeof r.at === "string" ? r.at : "");
      var q = { id: id, type: r.type, ben: text(r.ben, 120), at: isFinite(at) && at > 0 ? at : 0,
                state: PF_STATES.indexOf(r.state) >= 0 ? r.state : "new", note: longText(r.note, 1000) };
      if (r.type === "bio") {
        q.bio = longText(r.bio, PF_BIO);
        q.was = longText(r.was, PF_BIO);
        q.links = (Array.isArray(r.links) ? r.links : []).filter(okUrl).slice(0, PF_LINKS).map(function (u) { return u.trim(); });
        q.photo = r.has_photo === true;
      } else {
        q.pid = isInt(r.product_id) && r.product_id > 0 ? r.product_id : 0;
        q.title = text(r.title, 200);
        q.qty = isInt(r.qty) && r.qty > 0 && r.qty <= 10000 ? r.qty : 0;
      }
      if (q.state === "done" || q.state === "declined") q.reply = longText(r.reply, PF_REPLY);
      out.push(q);
    });
    return out;
  }
  // the same ids on every device: follow-up, note, answer done / declined.
  // The follow-up's id also tells the request's kind (pff page, pfg
  // copies), so its answer dialog knows the default reply.
  function pfTail(shopId, reqId) {
    var s = String(shopId) + "|rspf|" + String(reqId);
    return h32(s, 2166136261).toString(36) + h32(s, 3735928559).toString(36);
  }
  function idsOf(tail, type) {
    return { fup: (type === "copies" ? "pfg" : "pff") + tail, act: "pfa" + tail, done: "pfd" + tail, decl: "pfx" + tail,
             type: type === "copies" ? "copies" : "bio" };
  }
  function pfIds(shopId, req) { return idsOf(pfTail(shopId, req && req.id), req && req.type); }
  // the ids from the follow-up's id (its kind is in it)
  function pfIdsOf(fupId) {
    var m = /^pf([fg])([a-z0-9]{2,})$/.exec(typeof fupId === "string" ? fupId : "");
    return m ? idsOf(m[2], m[1] === "g" ? "copies" : "bio") : null;
  }
  // a row of a creator request? → "fup" | "act" | "done" | "decl" | ""
  function pfKind(id) {
    var m = /^pf([fgadx])[a-z0-9]{2,}$/.exec(typeof id === "string" ? id : "");
    return m ? { f: "fup", g: "fup", a: "act", d: "done", x: "decl" }[m[1]] : "";
  }
  function pfImportPlan(data, shopId, firstShopId, reqs) {
    var plan = [], left = [], tombs = (data && data.tombs) || {};
    (reqs || []).forEach(function (q) {
      var cust = null;
      if (q.ben) {
        (data.rsl || []).some(function (r) {
          if (!r.n || r.n.indexOf(q.ben) < 0 || (r.a || firstShopId || "") !== shopId) return false;
          cust = CC.byId(data.cust, r.id);
          return !!cust;
        });
      }
      if (!cust || tombs[cust.id]) { left.push(q); return; }
      var ids = pfIds(shopId, q);
      var have = !!(CC.byId(data.fups || [], ids.fup) || tombs[ids.fup] || CC.byId(data.acts || [], ids.act) || tombs[ids.act]);
      plan.push({ req: q, cust: cust, ids: ids, have: have });
    });
    return { plan: plan, left: left };
  }
  // The reply kept in an answer note: the text after its first line
  // (the first line says "Answer in the Author Portal …" in the
  // language of the device that wrote it).
  function pfReplyOf(act) {
    var tx = act && typeof act.text === "string" ? act.text : "", i = tx.indexOf("\n");
    return i < 0 ? "" : pfReply(tx.slice(i + 1));
  }
  // The answer of a request in CRM: { state, reply, at } | null. A note
  // "done" / "declined" wins (the newer when there are both); else a
  // done follow-up = "done" with the default reply, a deleted one =
  // "declined" without a reply.
  function pfOutcome(data, shopId, req, defReply) {
    var ids = pfIds(shopId, req), tombs = (data && data.tombs) || {};
    var d = CC.byId(data.acts || [], ids.done), x = CC.byId(data.acts || [], ids.decl);
    if (d && tombs[d.id] >= d.m) d = null;
    if (x && tombs[x.id] >= x.m) x = null;
    if (d || x) {
      var a = !x || (d && d.m >= x.m) ? d : x;
      return { state: a === d ? "done" : "declined", reply: pfReplyOf(a), at: a.m };
    }
    var f = CC.byId(data.fups || [], ids.fup);
    if (f && f.done) return { state: "done", reply: pfReply(defReply || ""), at: f.m };
    if (!f && tombs[ids.fup]) return { state: "declined", reply: "", at: tombs[ids.fup] };
    return null;
  }
  // [{ id, state, reply }] for the requests orOS took whose answer is in CRM
  // defReply(req) → the default reply of a request's kind
  function pfCloseList(data, shopId, reqs, defReply) {
    var out = [];
    (reqs || []).forEach(function (q) {
      if (q.state !== "oros") return;
      var o = pfOutcome(data, shopId, q, typeof defReply === "function" ? defReply(q) : "");
      if (o) out.push({ id: q.id, state: o.state, reply: o.reply });
    });
    return out;
  }
  // The text of a request's note on the partner's card (≤ 2000): the ask,
  // then the new page text (cut with "…" when it does not fit), links,
  // the creator's note. words: { bio, copies, photo, links, note } with
  // {t} / {n} / {q} placeholders, in the device's language.
  function pfActText(q, words) {
    var w = words || {}, head, tail = [];
    if (q.type === "copies") head = String(w.copies || "").replace("{q}", String(q.qty || 0)).replace("{t}", q.title || ("#" + (q.pid || 0)));
    else head = String(w.bio || "");
    if (q.type === "bio") {
      if (q.links && q.links.length) tail.push(String(w.links || "") + "\n" + q.links.join("\n"));
      if (q.photo) tail.push(String(w.photo || ""));
    }
    if (q.note) tail.push(String(w.note || "") + " " + q.note);
    var end = tail.length ? "\n\n" + tail.join("\n\n") : "";
    if (q.type !== "bio" || !q.bio) return (head + end).slice(0, 2000);
    var room = 2000 - head.length - end.length - 4;
    var bio = q.bio.length > room ? q.bio.slice(0, Math.max(0, room - 1)).replace(/\s+\S*$/, "") + "…" : q.bio;
    return (head + "\n\n" + bio + end).slice(0, 2000);
  }

  var API = { REQ_BAL: REQ_BAL, reqReport: reqReport, parseBal: parseBal, parseRep: parseRep, card: card, suggest: suggest,
              REQ_CTR: REQ_CTR, REQ_RQ_NEW: REQ_RQ_NEW, REQ_RQ_OROS: REQ_RQ_OROS, reqPushCtr: reqPushCtr, reqMark: reqMark,
              parseSaved: parseSaved, parseRequests: parseRequests, rqIds: rqIds, importPlan: importPlan, closeList: closeList,
              REQ_PF_NEW: REQ_PF_NEW, REQ_PF_OROS: REQ_PF_OROS, REQ_PF_ALL: REQ_PF_ALL, reqPfMark: reqPfMark, reqPfPhoto: reqPfPhoto, pfReply: pfReply,
              parsePfRequests: parsePfRequests, pfIds: pfIds, pfIdsOf: pfIdsOf, pfKind: pfKind, pfImportPlan: pfImportPlan, pfReplyOf: pfReplyOf,
              pfOutcome: pfOutcome, pfCloseList: pfCloseList, pfActText: pfActText };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.OrosCrmRs = API;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));

// ============================================================
// orOS CRM — rs.js, part 2: the production stage for the Author Portal (RS-PROD, v1.0.0)
// Pure functions, no DOM, no storage, no clock (today comes in).
// Revenue Splitter 1.18.0 shows each creator the production stage of
// their current work: seven public phases. The source is a Kanban board
// (CRM Settings › Author Portal: the board's name); its columns map to
// the phases by name (Chris 2026-11-13: exactly the table, so a work may
// go back a phase; a column the table does not name keeps the phase of
// the nearest named column before it; every part of the board counts,
// so columns that repeat a name get the same phase). The whole list goes
// each time (POST /rs/production, links/core.js allowlist):
//   { v: 1, sent, works: [{ id, ben, title, phase, since, release, note }] }
//   id      the card's id; "<card>-1", "<card>-2"… when it has several creators
//   ben     the creator's name in the shop's Revenue Splitter (CRM rsl, n[0])
//   since   the day the card last changed column (Kanban fm.p), else sent
//   release the release day of the Publishing title with the same name, or ""
//   note    only the text after a line «Για τον δημιουργό:» / "For the
//           creator:" in the card's notes, up to the next empty line;
//           never the rest of the notes, subtasks, labels or comments
// Which cards: only those chosen in CRM (Chris 2026-11-13; none at
// first), in a column with a phase; phase 7 only while the release day
// (or since, without one) is at most 30 days ago.
// Creators of a card: the CRM partners linked to the card (ix "kb"), else
// the authors of the Publishing title with the same name that have a CRM
// partner; each with a Revenue Splitter name for that shop.
//
// API (window.OrosCrmProd; under Node require("crm/rs.js").prod):
//   DEFAULT_MAP { folded column name: phase }, fold(s)
//   boardByName(kanban, name) → board | null (not archived, not a template)
//   columnPhases(board, map) → [{ id, name, phase (0 = none yet), own (1-7 | 0 | -1 not named) }]
//   noteOf(notes) → the text for the creator ("" when none)
//   plan({ kanban, crm, publish, board, map, chosen: [card id], shopId, firstShopId, today, dayOf })
//     → { body: { v, sent, works }, left: [{ card, t, why noben|badid|notitle|old|max }], board }
//   req(body) → the request; parseSaved(json) → { saved, skipped: [{ id, why }] } | null
// ============================================================
(function (root) {
  "use strict";

  var MAX_WORKS = 500, DONE_DAYS = 30, NOTE_MAX = 1000, TITLE_MAX = 200;
  var RS_ID = /^[A-Za-z0-9_-]{1,64}$/, YMD = /^\d{4}-\d{2}-\d{2}$/;

  function fold(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/ς/g, "σ").replace(/\s+/g, " ").trim();   // i18n-inline-ok: Greek final sigma folds to σ
  }
  // Chris's table (2026-11-13), by column name
  var TABLE = [
    [1, ["Αναμονή", "Επικοινωνία", "Συμβόλαιο/Φόρμα", "Ενημέρωση επαφής"]],   // i18n-inline-ok: the board's own column names
    [2, ["Επιμέλεια"]],                                                       // i18n-inline-ok: column name
    [3, ["Εικονογράφηση", "Teaser εξωφύλλου", "Αποκάλυψη εξωφύλλου"]],        // i18n-inline-ok: column names
    [4, ["Σελιδοποίηση", "Θέση Υπό έκδοση"]],                                 // i18n-inline-ok: column names
    [5, ["Δειγματισμός", "Διορθώσεις"]],                                      // i18n-inline-ok: column names
    [6, ["Παραγωγή", "Εθνική βιβλιοθήκη"]],                                   // i18n-inline-ok: column names
    [7, ["Κυκλοφορία/eShop"]]                                                 // i18n-inline-ok: column name
  ];
  var DEFAULT_MAP = {};
  TABLE.forEach(function (r) { r[1].forEach(function (n) { DEFAULT_MAP[fold(n)] = r[0]; }); });

  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function clean(v, max) {
    return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f<>]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max).trim() : "";
  }
  function byId(list, id) {
    for (var i = 0; i < (list || []).length; i++) if (list[i] && list[i].id === id) return list[i];
    return null;
  }
  function dayNum(ymd) {
    var m = YMD.exec(ymd || "") ? ymd.split("-") : null;
    return m ? Date.UTC(+m[0], +m[1] - 1, +m[2]) / 86400000 : NaN;
  }

  function boardByName(kanban, name) {
    var want = fold(name);
    if (!want || !isObj(kanban) || !Array.isArray(kanban.boards)) return null;
    for (var i = 0; i < kanban.boards.length; i++) {
      var b = kanban.boards[i];
      if (isObj(b) && !b.archived && !/^tpl-/.test(b.id || "") && fold(b.name) === want) return b;
    }
    return null;
  }

  // the phase of each column: its own from the map (the person's map
  // over the default), else the last phase before it
  function columnPhases(board, map) {
    var cur = 0, out = [];
    (board && Array.isArray(board.columns) ? board.columns : []).forEach(function (col) {
      if (!isObj(col)) return;
      var k = fold(col.name), own = -1;
      if (isObj(map) && Object.prototype.hasOwnProperty.call(map, k)) own = map[k];
      else if (Object.prototype.hasOwnProperty.call(DEFAULT_MAP, k)) own = DEFAULT_MAP[k];
      if (!(own >= 0 && own <= 7 && Math.floor(own) === own)) own = -1;
      if (own >= 1) cur = own;
      out.push({ id: col.id, name: String(col.name || ""), phase: cur, own: own });
    });
    return out;
  }

  var NOTE_HEAD = /^\s*(για τον δημιουργο|για τη δημιουργο|για την δημιουργο|for the creator|fur den autor|für den autor)\s*:\s*(.*)$/;   // i18n-inline-ok: markers in the card's own text
  function noteOf(notes) {
    if (typeof notes !== "string" || !notes) return "";
    var lines = notes.replace(/\r\n?/g, "\n").split("\n"), out = null;
    for (var i = 0; i < lines.length; i++) {
      if (out === null) {
        var m = NOTE_HEAD.exec(fold(lines[i]));
        if (!m) continue;
        var raw = lines[i], c = raw.indexOf(":");
        out = [raw.slice(c + 1).trim()];
        continue;
      }
      if (!lines[i].trim()) break;
      out.push(lines[i].trim());
    }
    if (!out) return "";
    var tx = out.filter(Boolean).join("\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f<>]+/g, " ").replace(/[ \t]{2,}/g, " ").replace(/ +\n/g, "\n").trim();
    return tx.length > NOTE_MAX ? tx.slice(0, NOTE_MAX - 1).replace(/\s+\S*$/, "") + "…" : tx;
  }

  function sinceOf(card, dayOf) {
    var fm = card.fm;
    if (isObj(fm) && typeof fm.m === "number" && fm.m === (card.mtime || 0) && typeof fm.p === "number" && fm.p > 0) {
      var d = dayOf(fm.p);
      if (YMD.test(d)) return d;
    }
    return "";
  }

  // the Publishing title with this name (the one with a release day first)
  function titleOf(publish, name) {
    var f = fold(name), hit = null;
    (isObj(publish) && Array.isArray(publish.titles) ? publish.titles : []).forEach(function (t) {
      if (!isObj(t) || fold(t.t) !== f) return;
      if (!hit || (!hit.rel && t.rel) || (!!hit.rel === !!t.rel && String(t.id) < String(hit.id))) hit = t;
    });
    return hit;
  }

  // the Revenue Splitter names of the card's creators, sorted
  function creators(crm, publish, board, card, shopId, firstShopId) {
    var custs = {}, tombs = (crm && crm.tombs) || {};
    (crm && Array.isArray(crm.ix) ? crm.ix : []).forEach(function (row) {
      (row && Array.isArray(row.it) ? row.it : []).forEach(function (it) {
        if (!it || it.k !== "kb" || typeof it.r !== "string") return;
        var p = it.r.split("/");
        if (p[0] === board.id && p[2] === card.id) custs[row.id] = 1;
      });
    });
    if (!Object.keys(custs).length) {
      var t = titleOf(publish, card.text);
      (t && Array.isArray(t.ppl) ? t.ppl : []).forEach(function (p) {
        if (p && p.r === "a" && typeof p.crm === "string" && p.crm) custs[p.crm] = 1;
      });
    }
    var names = {};
    Object.keys(custs).forEach(function (id) {
      if (tombs[id] || !byId(crm && crm.cust, id)) return;
      var r = byId(crm.rsl, id);
      if (!r || !Array.isArray(r.n) || !r.n.length || (r.a || firstShopId || "") !== shopId) return;
      var n = clean(r.n[0], 200);
      if (n) names[n] = 1;
    });
    return Object.keys(names).sort();
  }

  function localDay(ms) {
    var d = new Date(ms);
    if (!isFinite(d.getTime())) return "";
    var mm = d.getMonth() + 1, dd = d.getDate();
    return d.getFullYear() + "-" + (mm < 10 ? "0" : "") + mm + "-" + (dd < 10 ? "0" : "") + dd;
  }

  function plan(o) {
    o = o || {};
    var today = YMD.test(o.today || "") ? o.today : "", dayOf = typeof o.dayOf === "function" ? o.dayOf : localDay;
    var out = { body: { v: 1, sent: today, works: [] }, left: [], board: null };
    var board = boardByName(o.kanban, o.board);
    if (!board || !today) return out;
    out.board = board;
    var phases = columnPhases(board, o.map), tdy = dayNum(today), works = [], pick = {};
    (Array.isArray(o.chosen) ? o.chosen : []).forEach(function (id) { if (typeof id === "string") pick[id] = 1; });
    (board.columns || []).forEach(function (col, ci) {
      var ph = phases[ci] ? phases[ci].phase : 0;
      if (!isObj(col) || !ph) return;
      (Array.isArray(col.cards) ? col.cards : []).forEach(function (card) {
        if (!isObj(card) || !pick[card.id]) return;     // only the cards chosen in CRM
        var title = clean(card.text, TITLE_MAX);
        var since = sinceOf(card, dayOf) || today;
        var t = titleOf(o.publish, card.text), release = t && YMD.test(t.rel || "") ? t.rel : "";
        if (ph === 7) {
          var ref = dayNum(release || since);
          if (!(tdy - ref <= DONE_DAYS)) { out.left.push({ card: card.id, t: title, why: "old" }); return; }   // released over 30 days ago
        }
        if (!title) { out.left.push({ card: card.id, t: "", why: "notitle" }); return; }
        if (typeof card.id !== "string" || !RS_ID.test(card.id) || card.id.length > 60) { out.left.push({ card: card.id, t: title, why: "badid" }); return; }
        var names = creators(o.crm, o.publish, board, card, o.shopId, o.firstShopId);
        if (!names.length) { out.left.push({ card: card.id, t: title, why: "noben" }); return; }
        var note = noteOf(card.notes);
        names.forEach(function (n, i) {
          works.push({ id: names.length > 1 ? card.id + "-" + (i + 1) : card.id, ben: n, title: title, phase: ph,
                       since: since, release: release, note: note });
        });
      });
    });
    works.sort(function (a, b) { return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0); });
    if (works.length > MAX_WORKS) {
      works.slice(MAX_WORKS).forEach(function (w) { out.left.push({ card: w.id, t: w.title, why: "max" }); });
      works = works.slice(0, MAX_WORKS);
    }
    out.body.works = works;
    return out;
  }

  // the shop's answer { saved, skipped: [{ id, why }] } | null
  var WHY = ["bad_id", "unknown_ben", "bad_title", "bad_phase", "bad_since", "bad_release", "duplicate_id", "not_an_object"];
  function parseSaved(j) {
    if (!isObj(j) || typeof j.saved !== "number" || Math.floor(j.saved) !== j.saved || j.saved < 0) return null;
    var skipped = [];
    (Array.isArray(j.skipped) ? j.skipped : []).slice(0, 500).forEach(function (x) {
      if (!isObj(x)) return;
      skipped.push({ id: clean(typeof x.id === "string" ? x.id : "", 64), why: WHY.indexOf(x.why) >= 0 ? x.why : "not_an_object" });
    });
    return { saved: j.saved, skipped: skipped };
  }
  function req(body) { return { m: "POST", path: "/rs/production", body: body }; }

  var API = { DEFAULT_MAP: DEFAULT_MAP, parseSaved: parseSaved, req: req, WHY: WHY, fold: fold, boardByName: boardByName, columnPhases: columnPhases,
              noteOf: noteOf, plan: plan, MAX_WORKS: MAX_WORKS, DONE_DAYS: DONE_DAYS };
  // lives in rs.js (one precached file): under Node it is require("crm/rs.js").prod
  if (typeof module !== "undefined" && module.exports) module.exports.prod = API;
  if (root) root.OrosCrmProd = API;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
