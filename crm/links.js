// ============================================================
// orOS CRM — links.js (partners across apps, BR-CRM-LINK, v1.0.0)
// Pure functions, no DOM, no storage, no clock: the caller reads the
// other apps' data (already normalized by their own cores) and passes
// it in. CRM never writes another app's data: a link lives on the CRM
// record (its pt row, crm/core.js 1.5).
//
// API (window.OrosCrmLinks, module.exports under Node):
//   KIND_ROLE                 the role a record of each kind suggests
//   candidates(src, cores) → [cand]
//     src   = { stock?, ts?, inv?, pub? } normalized data of Stock,
//             Timesheet, Invoices and Publishing (null = not there)
//     cores = { stock? } (OrosStockCore, for the consignment shops)
//     cand  = { key, k, name, sub?, afm?, email?, phone?, n? }
//       sup  a Stock supplier          wh   a Stock consignment shop
//       tsc  a Timesheet client        inv  an Invoices client that has
//                                           no CRM customer yet
//       pub  a person on Publishing titles without a CRM link (n = titles)
//   pubTitles(pub, custId, ln) → [{ id, t, r }] titles where the person
//     carries that crm id or a pub: link of the customer names them
//   linked(data, cust, cands, pub) → [{ key, k, name, sub?, gone, auto? }]
//   suggest(data, cands, C) → { pairs: [{ cand, cust, why }], loose: [cand] }
//     why = "afm" | "email" | "name"; a candidate that is linked already
//     is left out; one that matches no customer (or two by name) is
//     loose
//   forCust(data, cust, cands, C) → [{ cand, why, owner }] the best
//     candidates for one customer first, then the rest by name
//   newCust(cand, id, nowMs) → { cust, pt } CRM rows for a loose candidate
// ============================================================
(function (root) {
  "use strict";

  // the same key crm/core.js stores (core.js loads first)
  var CC = typeof module !== "undefined" && module.exports ? require("./core.js") : root.OrosCrmCore;
  function pubKey(name) { return CC.pubKey(name); }

  var KIND_ROLE = { sup: "sup", wh: "shop", tsc: "cust", inv: "cust", pub: "auth" };
  var ORDER = { sup: 0, wh: 1, tsc: 2, inv: 3, pub: 4 };
  var ID_OK = /^[A-Za-z0-9_-]{1,60}$/;

  function fold(s) { return CC.fold(s).replace(/\s+/g, " ").trim(); }

  function afmOf(s) { return String(s || "").replace(/\s+/g, "").replace(/^(EL|GR)/i, "").toUpperCase(); }
  function mailOf(s) { return String(s || "").trim().toLowerCase(); }
  function str(v, max) { return typeof v === "string" ? v.trim().slice(0, max) : ""; }
  function alive(list) { return (Array.isArray(list) ? list : []).filter(function (x) { return x && !x.del && typeof x.id === "string" && ID_OK.test(x.id); }); }
  function cmp(a, b) { return a < b ? -1 : (a > b ? 1 : 0); }

  function candidates(src, cores) {
    var s = src || {}, out = [];
    function add(c) {
      if (!c.name) return;
      var o = { key: c.k + ":" + c.id, k: c.k, name: c.name };
      ["sub", "afm", "email", "phone"].forEach(function (f) { if (c[f]) o[f] = c[f]; });
      out.push(o);
    }
    if (s.stock) {
      alive(s.stock.sups).forEach(function (x) {
        add({ k: "sup", id: x.id, name: str(x.name, 120), sub: str(x.person, 80), afm: str(x.vatno, 20), email: str(x.email, 120), phone: str(x.tel, 40) });
      });
      var SC = cores && cores.stock;
      if (SC && typeof SC.consList === "function") {
        SC.consList(s.stock).forEach(function (r) {
          if (!r.cons || r.cons.on === 0 || !ID_OK.test(r.wh.id)) return;
          add({ k: "wh", id: r.wh.id, name: str(r.cons.who, 120) || str(r.wh.name, 120), sub: r.cons.who ? str(r.wh.name, 80) : "" });
        });
      }
    }
    if (s.ts) alive(s.ts.clients).forEach(function (x) { add({ k: "tsc", id: x.id, name: str(x.name, 120) }); });
    if (s.inv) alive(s.inv.clients).forEach(function (x) {
      if (x.crm) return;                         // Invoices links it itself
      add({ k: "inv", id: x.id, name: str(x.name, 120), afm: str(x.afm, 20), email: str(x.email, 120), phone: str(x.phone, 40) });
    });
    if (s.pub) {
      var people = {};
      (Array.isArray(s.pub.titles) ? s.pub.titles : []).forEach(function (t) {
        (t.ppl || []).forEach(function (p) {
          if (!p || p.crm) return;
          var key = pubKey(p.n);
          if (!key) return;
          var e = people[key] || (people[key] = { name: str(p.n, 120), n: 0 });
          e.n++;
        });
      });
      Object.keys(people).forEach(function (key) {
        out.push({ key: key, k: "pub", name: people[key].name, n: people[key].n });
      });
    }
    return out.sort(function (a, b) { return ORDER[a.k] - ORDER[b.k] || cmp(fold(a.name), fold(b.name)) || cmp(a.key, b.key); });
  }

  function pubTitles(pub, custId, ln) {
    var keys = (ln || []).filter(function (k) { return k.slice(0, 4) === "pub:"; });
    var out = [];
    if (!pub || !Array.isArray(pub.titles)) return out;
    pub.titles.forEach(function (t) {
      var roles = [];
      (t.ppl || []).forEach(function (p) {
        if (!p) return;
        if ((custId && p.crm === custId) || (!p.crm && keys.indexOf(pubKey(p.n)) >= 0)) {
          if (roles.indexOf(p.r) < 0) roles.push(p.r);
        }
      });
      if (roles.length) out.push({ id: t.id, t: t.t, r: roles });
    });
    return out.sort(function (a, b) { return cmp(fold(a.t), fold(b.t)) || cmp(a.id, b.id); });
  }

  function linked(data, cust, cands, pub) {
    var by = {};
    (cands || []).forEach(function (c) { by[c.key] = c; });
    var out = CC.lnOf(data, cust).map(function (key) {
      var k = key.slice(0, key.indexOf(":")), c = by[key];
      if (k === "pub" && !c) {
        // a linked person is no candidate any more only when no title
        // names them: then the link is gone
        var n = pubTitles(pub, "", [key]).length;
        return { key: key, k: k, name: key.slice(4), gone: !n, n: n };
      }
      return c ? { key: key, k: k, name: c.name, sub: c.sub, gone: false, n: c.n } : { key: key, k: k, name: "", gone: true };
    });
    // Publishing people that carry this customer's id (set in Publishing)
    var auto = pubTitles(pub, cust.id, []);
    if (auto.length) out.push({ key: "", k: "pub", name: cust.name, gone: false, auto: true, n: auto.length });
    return out.sort(function (a, b) { return ORDER[a.k] - ORDER[b.k] || cmp(fold(a.name), fold(b.name)); });
  }

  function owners(data) {
    var m = {};
    var alive = {};
    data.cust.forEach(function (c) { alive[c.id] = c; });
    (data.pt || []).slice().sort(function (a, b) { return cmp(a.id, b.id); }).forEach(function (p) {
      if (alive[p.id]) (p.ln || []).forEach(function (k) { if (!m[k]) m[k] = alive[p.id]; });
    });
    return m;
  }
  function matchWhy(cust, cand) {
    if (cand.afm && cust.afm && afmOf(cand.afm) === afmOf(cust.afm)) return "afm";
    if (cand.email) {
      var e = mailOf(cand.email);
      if (e && (mailOf(cust.email) === e || (cust.people || []).some(function (p) { return mailOf(p.email) === e; }))) return "email";
    }
    var n = fold(cand.name);
    if (n && (fold(cust.name) === n || (cust.alias && fold(cust.alias) === n))) return "name";
    return "";
  }
  var RANK = { afm: 0, email: 1, name: 2 };

  function suggest(data, cands) {
    var own = owners(data), pairs = [], loose = [];
    (cands || []).forEach(function (cand) {
      if (own[cand.key]) return;
      var best = null, why = "", tie = false;
      data.cust.forEach(function (c) {
        var w = matchWhy(c, cand);
        if (!w) return;
        if (!best || RANK[w] < RANK[why]) { best = c; why = w; tie = false; }
        else if (RANK[w] === RANK[why]) tie = true;
      });
      if (best && !tie) pairs.push({ cand: cand, cust: best, why: why });
      else loose.push(cand);
    });
    return { pairs: pairs, loose: loose };
  }

  function forCust(data, cust, cands) {
    var own = owners(data), mine = CC.lnOf(data, cust);
    return (cands || []).filter(function (c) { return mine.indexOf(c.key) < 0; }).map(function (c) {
      return { cand: c, why: matchWhy(cust, c), owner: own[c.key] || null };
    }).sort(function (a, b) {
      var x = a.why ? RANK[a.why] : 9, y = b.why ? RANK[b.why] : 9;
      return x - y || ORDER[a.cand.k] - ORDER[b.cand.k] || cmp(fold(a.cand.name), fold(b.cand.name));
    });
  }

  function newCust(cand, id, nowMs) {
    var role = KIND_ROLE[cand.k] || "cust";
    var o = { id: id, m: nowMs, ct: nowMs, name: cand.name, kind: cand.k === "pub" ? "person" : "co", st: "active" };
    var pt = { id: id, m: nowMs, ln: [cand.key] };
    if (role !== "cust") pt.roles = [role];
    if (cand.afm) o.afm = cand.afm;
    if (cand.email) o.email = cand.email;
    if (cand.phone) o.phone = cand.phone;
    return { cust: o, pt: pt };
  }

  var API = {
    KIND_ROLE: KIND_ROLE, candidates: candidates, pubTitles: pubTitles, linked: linked,
    suggest: suggest, forCust: forCust, newCust: newCust, pubKey: pubKey
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.OrosCrmLinks = API;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
