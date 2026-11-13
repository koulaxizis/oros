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
              REQ_PF_NEW: REQ_PF_NEW, REQ_PF_OROS: REQ_PF_OROS, REQ_PF_ALL: REQ_PF_ALL, reqPfMark: reqPfMark, pfReply: pfReply,
              parsePfRequests: parsePfRequests, pfIds: pfIds, pfIdsOf: pfIdsOf, pfKind: pfKind, pfImportPlan: pfImportPlan, pfReplyOf: pfReplyOf,
              pfOutcome: pfOutcome, pfCloseList: pfCloseList, pfActText: pfActText };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.OrosCrmRs = API;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
