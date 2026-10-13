// ============================================================
// orOS Connected services — CRM platforms (links/crm.js, v1.0.0)
// Pure: the requests that read a HubSpot, Pipedrive or Invoice Ninja
// (clients only, wave 4C) account, what
// their answers mean, and the plan that brings them into CRM
// (integrations wave 4). No DOM, no storage, no network; crm/platforms.js
// makes the calls through the shell (orosLinks.call) and applies the plan.
//   KINDS[p]: what is read, in order (stages first: deals need them)
//   req(p, kind, at) → one GET (at = the page marker, "" for the first)
//   read(p, kind, data) → { items, next } (next "" = the last page)
//   plan(C, crm, got, ctx) → what changes in CRM (C = OrosCrmCore)
// The platform is only read. CRM stays the source of truth: a record
// deleted here is not brought back unless asked; a customer that is
// already here under the same name or e-mail is used, never changed;
// fields only CRM has (status, tags, notes, stars) are never touched.
// Ids come from L.extId: the same record imported on two devices
// lands on the same row (R16).
// Everything from the platform is plain text from here on (textContent).
// ============================================================
(function (root) {
  "use strict";

  var L = typeof module !== "undefined" && module.exports ? require("./core.js") : root.OrosLinksCore;

  var PLATFORMS = ["hubspot", "pdrive", "ininja"];
  var KINDS = {
    hubspot: ["stages", "orgs", "people", "deals"],
    pdrive: ["stages", "orgs", "people", "deals", "acts"],
    ininja: ["orgs"]                    // clients, with their contacts inside
  };
  var MAX = { stages: 1000, orgs: 5000, people: 10000, deals: 5000, acts: 5000 };
  var HS_PAGE = 100, PD_PAGE = 500;
  var HS_PATH = {
    orgs: "/crm/v3/objects/companies?limit=" + HS_PAGE + "&properties=name,domain,phone,address,city,zip,country,industry",
    people: "/crm/v3/objects/contacts?limit=" + HS_PAGE + "&properties=firstname,lastname,email,phone,jobtitle&associations=companies",
    deals: "/crm/v3/objects/deals?limit=" + HS_PAGE + "&properties=dealname,amount,dealstage,pipeline,closedate,deal_currency_code,closed_lost_reason&associations=companies,contacts"
  };
  var PD_PATH = { stages: "/stages", orgs: "/organizations", people: "/persons", deals: "/deals", acts: "/activities" };

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function txt(v, max) { return L.cleanText(typeof v === "number" ? String(v) : v, max || 200); }
  function xid(v) {
    if (v && typeof v === "object" && has(v, "value")) v = v.value;     // older Pipedrive shapes: { value, name }
    if (isNum(v) && v > 0 && Math.floor(v) === v) return String(v);
    return typeof v === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(v) ? v : "";
  }
  // "1200.5" / 1200.5 → 120050 cents; null when it is not money
  function cents(v) {
    var n = typeof v === "string" && /^-?[0-9]{1,12}(\.[0-9]{1,6})?$/.test(v.trim()) ? parseFloat(v) : (isNum(v) ? v : NaN);
    if (!isFinite(n) || n < 0 || n > 999999999) return null;
    return Math.round(n * 100);
  }
  function ymd(v) {
    if (typeof v === "string" && /^[0-9]{4}-[0-9]{2}-[0-9]{2}/.test(v)) return v.slice(0, 10);
    if (isNum(v) && v > 0) return new Date(v).toISOString().slice(0, 10);
    if (typeof v === "string" && /^[0-9]{10,14}$/.test(v)) return new Date(+v).toISOString().slice(0, 10);
    return "";
  }
  function hm(v) { return typeof v === "string" && /^([01][0-9]|2[0-3]):[0-5][0-9]/.test(v) ? v.slice(0, 5) : ""; }
  function prob(v) {
    var n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
    if (!isNum(n) || n < 0) return null;
    return Math.max(0, Math.min(100, Math.round(n)));
  }
  function cur(v) { return typeof v === "string" && /^[A-Za-z]{3}$/.test(v) ? v.toUpperCase() : ""; }
  // Pipedrive emails / phones: [{ value, primary }] (or a plain string)
  function primary(list) {
    if (typeof list === "string") return list;
    if (!Array.isArray(list)) return "";
    var first = "", main = "";
    list.forEach(function (x) {
      var v = x && typeof x === "object" ? x.value : x;
      if (typeof v !== "string" || !v.trim()) return;
      if (!first) first = v;
      if (!main && x && x.primary === true) main = v;
    });
    return main || first;
  }
  function email(v) { v = txt(v, 120).toLowerCase(); return L.okEmail(v) ? v : ""; }
  function assoc(o, kind) {
    var a = o && o.associations && o.associations[kind];
    var r = a && Array.isArray(a.results) ? a.results : [];
    for (var i = 0; i < r.length; i++) { var id = xid(r[i] && r[i].id); if (id) return id; }
    return "";
  }

  // ---------- requests ----------
  function req(p, kind, at) {
    if (p === "ininja") return { m: "GET", path: "/clients?per_page=100&page=" + (at || "1") + "&status=active" };
    if (p === "hubspot") {
      if (kind === "stages") return { m: "GET", path: "/crm/v3/pipelines/deals" };
      return { m: "GET", path: HS_PATH[kind] + (at ? "&after=" + at : "") };
    }
    var q = "?limit=" + PD_PAGE + (at ? "&cursor=" + encodeURIComponent(at) : "");
    if (kind === "acts") q += "&done=false";                // only what is still to do
    return { m: "GET", path: PD_PATH[kind] + q };
  }

  // ---------- answers ----------
  function hsStages(data) {
    var out = [];
    (data && Array.isArray(data.results) ? data.results : []).forEach(function (pl) {
      (pl && Array.isArray(pl.stages) ? pl.stages : []).forEach(function (s) {
        var id = xid(s && s.id);
        if (!id) return;
        var md = s.metadata || {};
        var pr = prob(md.probability !== undefined && md.probability !== null && md.probability !== "" ? Number(md.probability) * 100 : null);
        var closed = String(md.isClosed) === "true" ? (pr !== null && pr >= 100 ? "won" : "lost") : "";
        out.push({ xid: id, prob: pr, closed: closed });
      });
    });
    return out;
  }
  function hsOrg(o) {
    var p = (o && o.properties) || {};
    var name = txt(p.name, 120) || txt(p.domain, 120);
    if (!name) return null;
    var dom = txt(p.domain, 200);
    return {
      xid: xid(o.id), name: name, phone: txt(p.phone, 40), email: "",
      web: dom ? (/^https?:\/\//i.test(dom) ? dom : "https://" + dom) : "",
      addr: [txt(p.address, 120), [txt(p.zip, 20), txt(p.city, 60)].filter(Boolean).join(" ")].filter(Boolean).join(", "),
      country: txt(p.country, 60), job: txt(p.industry, 80)
    };
  }
  function hsPerson(o) {
    var p = (o && o.properties) || {};
    var name = [txt(p.firstname, 60), txt(p.lastname, 60)].filter(Boolean).join(" ") || txt(p.email, 120);
    if (!name) return null;
    return { xid: xid(o.id), name: name, email: email(p.email), phone: txt(p.phone, 40), role: txt(p.jobtitle, 60), org: assoc(o, "companies") };
  }
  function hsDeal(o) {
    var p = (o && o.properties) || {};
    var title = txt(p.dealname, 120);
    if (!title) return null;
    return {
      xid: xid(o.id), title: title, val: cents(p.amount), cur: cur(p.deal_currency_code),
      status: "", stage: xid(p.dealstage), prob: null, close: ymd(p.closedate), cd: ymd(p.closedate),
      why: txt(p.closed_lost_reason, 200), org: assoc(o, "companies"), person: assoc(o, "contacts")
    };
  }
  function pdAddr(a) {
    if (typeof a === "string") return { addr: txt(a, 200), country: "" };
    if (a && typeof a === "object") return { addr: txt(a.value || a.formatted_address, 200), country: txt(a.country, 60) };
    return { addr: "", country: "" };
  }
  // Invoice Ninja: a client with its contacts (the first is the main one)
  function inClient(o) {
    var name = txt(o && o.name, 120);
    var cs = o && Array.isArray(o.contacts) ? o.contacts : [];
    var ppl = [];
    cs.forEach(function (c, i) {
      if (!c || typeof c !== "object") return;
      var n = [txt(c.first_name, 60), txt(c.last_name, 60)].filter(Boolean).join(" ") || txt(c.email, 120);
      if (!n) return;
      ppl.push({ xid: xid(c.id) || String(i), name: n, email: email(c.email), phone: txt(c.phone, 40), role: "", org: xid(o.id) });
    });
    if (!name && ppl.length) name = ppl[0].name;
    if (!name || o.is_deleted === true) return null;
    return {
      xid: xid(o.id), name: name, phone: txt(o.phone, 40), email: "", web: txt(o.website, 300),
      addr: [[txt(o.address1, 120), txt(o.address2, 120)].filter(Boolean).join(" "), [txt(o.postal_code, 20), txt(o.city, 60)].filter(Boolean).join(" ")].filter(Boolean).join(", "),
      country: "", job: "", afm: txt(o.vat_number, 20).replace(/\s+/g, "").replace(/^EL/i, ""), ppl: ppl
    };
  }
  var READ = {
    hubspot: {
      orgs: hsOrg, people: hsPerson, deals: hsDeal
    },
    pdrive: {
      stages: function (s) {
        var id = xid(s && s.id);
        return id ? { xid: id, prob: prob(s.deal_probability), closed: "" } : null;
      },
      orgs: function (o) {
        var name = txt(o && o.name, 120);
        if (!name) return null;
        var a = pdAddr(o.address);
        return { xid: xid(o.id), name: name, phone: "", email: "", web: txt(o.website, 300), addr: a.addr, country: a.country, job: "" };
      },
      people: function (o) {
        var name = txt(o && o.name, 120) || [txt(o && o.first_name, 60), txt(o && o.last_name, 60)].filter(Boolean).join(" ");
        if (!name) return null;
        return { xid: xid(o.id), name: name, email: email(primary(o.emails || o.email)), phone: txt(primary(o.phones || o.phone), 40),
                 role: txt(o.job_title, 60), org: xid(o.org_id) };
      },
      deals: function (o) {
        var title = txt(o && o.title, 120);
        if (!title) return null;
        var st = o.status === "won" || o.status === "lost" ? o.status : "open";
        return {
          xid: xid(o.id), title: title, val: cents(o.value), cur: cur(o.currency), status: st,
          stage: xid(o.stage_id), prob: prob(o.probability), close: ymd(o.expected_close_date),
          cd: ymd(st === "won" ? o.won_time : st === "lost" ? o.lost_time : ""),
          why: st === "lost" ? txt(o.lost_reason, 200) : "", org: xid(o.org_id), person: xid(o.person_id)
        };
      },
      acts: function (o) {
        var text = txt(o && o.subject, 300);
        var d = ymd(o && o.due_date);
        if (!text || !d || o.done === true) return null;
        return { xid: xid(o.id), text: text, d: d, t: hm(o.due_time), deal: xid(o.deal_id), org: xid(o.org_id), person: xid(o.person_id) };
      }
    }
  };
  // → { items, next } ; next "" = no more pages
  function read(p, kind, data) {
    if (p === "hubspot" && kind === "stages") return { items: hsStages(data), next: "" };
    if (p === "ininja") {
      var its = [];
      (data && Array.isArray(data.data) ? data.data : []).forEach(function (o) { var x = inClient(o); if (x && x.xid) its.push(x); });
      var pg = data && data.meta && data.meta.pagination;
      var cur = pg && typeof pg.current_page === "number" ? pg.current_page : 0;
      var tot = pg && typeof pg.total_pages === "number" ? pg.total_pages : 0;
      return { items: its, next: cur > 0 && cur < tot && cur < 1000 ? String(cur + 1) : "" };
    }
    var list = p === "hubspot" ? (data && data.results) : (data && data.data);
    var fn = READ[p] && READ[p][kind];
    var items = [];
    if (Array.isArray(list) && fn) list.forEach(function (o) { var x = fn(o); if (x && x.xid) items.push(x); });
    var next = "";
    if (p === "hubspot") {
      var a = data && data.paging && data.paging.next && data.paging.next.after;
      next = typeof a === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(a) ? a : "";
    } else {
      var c = data && data.additional_data && data.additional_data.next_cursor;
      next = typeof c === "string" && /^[A-Za-z0-9._=+\/-]{1,600}$/.test(c) ? c : "";
    }
    return { items: items, next: next };
  }

  // ---------- the plan ----------
  // An open deal's stage in CRM from its probability (the platforms'
  // own stages have names CRM doesn't know).
  function bucket(pr) {
    if (pr === null || pr <= 15) return "new";
    if (pr <= 35) return "contact";
    if (pr <= 60) return "proposal";
    return "nego";
  }
  var CUST_F = ["name", "kind", "phone", "email", "web", "addr", "country", "job", "people"];
  var DEAL_F = ["cust", "title", "val", "stage", "prob", "close", "cd", "why"];
  var FUP_F = ["cust", "d", "t", "text", "deal"];
  function same(a, b, fields) {
    for (var i = 0; i < fields.length; i++) {
      if (JSON.stringify(a[fields[i]]) !== JSON.stringify(b[fields[i]])) return false;
    }
    return true;
  }
  // prev with the platform's fields replaced (absent there → absent here)
  function overlay(prev, fresh, fields) {
    var o = {};
    Object.keys(prev).forEach(function (k) { o[k] = prev[k]; });
    fields.forEach(function (k) { if (has(fresh, k)) o[k] = fresh[k]; else delete o[k]; });
    return o;
  }
  function fold(s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim(); }

  // crm: CRM's data; got: { stages, orgs, people, deals, acts } (read() items)
  // ctx: { p, acct, src (the platform's name), now, upd, revive }
  //   upd    update rows brought in before when the platform changed them
  //   revive bring back rows deleted here
  // → { cust: { add, upd }, deals: { add, upd }, fups: { add, upd },
  //     same, here, gone, noCust, otherCur, over }  (rows without m)
  function plan(C, crm, got, ctx) {
    var p = ctx.p, acct = ctx.acct, now = ctx.now;
    var id = function (kind, x) { return L.extId(p, acct, kind, x); };
    var out = { cust: { add: [], upd: [] }, deals: { add: [], upd: [] }, fups: { add: [], upd: [] },
                same: 0, here: 0, gone: 0, noCust: 0, otherCur: 0, over: 0 };
    var tombs = crm.tombs || {};
    var rows = {};
    ["cust", "deals", "fups"].forEach(function (k) { rows[k] = {}; crm[k].forEach(function (r) { rows[k][r.id] = r; }); });
    var room = { cust: C.LIMITS.cust - crm.cust.length, deals: C.LIMITS.deals - crm.deals.length, fups: C.LIMITS.fups - crm.fups.length };
    // customers already here that came from elsewhere: by name or e-mail
    var byName = {}, byMail = {}, byAfm = {};
    crm.cust.forEach(function (c) {
      if (c.afm) byAfm[c.afm] = byAfm[c.afm] || c.id;
      byName[fold(c.name)] = byName[fold(c.name)] || c.id;
      if (c.email) byMail[c.email.toLowerCase()] = byMail[c.email.toLowerCase()] || c.id;
    });
    // one row → add / update / same / gone; returns the id it lives at ("" = nowhere)
    function put(k, row, fields, normFn) {
      var n = normFn(Object.assign({ m: 1 }, row));
      if (!n) return "";
      delete n.m;
      var prev = rows[k][row.id];
      if (prev) {
        var cmp = Object.assign({}, prev);
        delete cmp.m;
        if (same(cmp, n, fields)) { out.same++; return row.id; }
        if (!ctx.upd) { out.same++; return row.id; }
        var u = overlay(cmp, n, fields);
        out[k].upd.push({ prev: prev, row: u });
        return row.id;
      }
      if (has(tombs, row.id) && !ctx.revive) { out.gone++; return ""; }
      if (room[k] <= 0) { out.over++; return ""; }
      room[k]--;
      out[k].add.push(n);
      return row.id;
    }

    var orgs = got.orgs || [], people = (got.people || []).slice(), deals = got.deals || [];
    orgs.forEach(function (o) { if (o.ppl) people = people.concat(o.ppl); });
    var custF = CUST_F.concat(p === "ininja" ? ["afm"] : []);
    var stageMap = {};
    (got.stages || []).forEach(function (s) { stageMap[s.xid] = s; });
    function stageOf(d) { return d.stage && has(stageMap, d.stage) ? stageMap[d.stage] : null; }
    var won = {};                       // org / person xid → has a won deal
    deals.forEach(function (d) {
      if (d.status === "won" || (p === "hubspot" && stageOf(d) && stageOf(d).closed === "won")) {
        if (d.org) won["o" + d.org] = 1;
        if (d.person) won["p" + d.person] = 1;
      }
    });
    // people of each company (the company's "People" lines)
    var orgSeen = {};
    orgs.forEach(function (o) { orgSeen[o.xid] = 1; });
    var peopleOf = {};
    people.forEach(function (x) {
      if (!x.org || !orgSeen[x.org]) return;
      (peopleOf[x.org] = peopleOf[x.org] || []).push(x);
    });
    var custOf = {};                    // "o<xid>" / "p<xid>" → CRM customer id
    function custRow(kind, x, ppl) {
      var c = { id: id(kind === "o" ? "org" : "person", x.xid), name: x.name, kind: kind === "o" ? "co" : "person" };
      ["phone", "email", "web", "addr", "country", "job", "afm"].forEach(function (f) { if (x[f]) c[f] = x[f]; });
      if (ppl && ppl.length) c.people = ppl.slice(0, C.LIMITS.people).map(function (q) {
        var line = { c: "", n: q.name };
        if (q.role) line.role = q.role;
        if (q.phone) line.phone = q.phone;
        if (q.email) line.email = q.email;
        return line;
      });
      return c;
    }
    function custOne(kind, x, ppl) {
      var c = custRow(kind, x, ppl);
      var key = kind + x.xid;
      if (!rows.cust[c.id] && !(has(tombs, c.id) && !ctx.revive)) {
        var here = (c.afm && byAfm[c.afm]) || byName[fold(c.name)] || (c.email && byMail[c.email]);
        if (here) { out.here++; custOf[key] = here; return; }
      }
      c.st = won[key] ? "active" : "lead";
      c.src = ctx.src;
      c.ct = now;
      var at = put("cust", c, custF, C.normCust);
      if (at) custOf[key] = at;
    }
    orgs.forEach(function (o) { custOne("o", o, peopleOf[o.xid]); });
    var personOrg = {};
    people.forEach(function (x) {
      if (x.org && orgSeen[x.org]) { personOrg[x.xid] = x.org; return; }
      custOne("p", x, null);
    });
    function custFor(orgX, personX) {
      if (orgX && custOf["o" + orgX]) return custOf["o" + orgX];
      if (personX && personOrg[personX] && custOf["o" + personOrg[personX]]) return custOf["o" + personOrg[personX]];
      if (personX && custOf["p" + personX]) return custOf["p" + personX];
      return "";
    }

    var dealOf = {}, dealCust = {};
    var mine = crm.prefs && crm.prefs.cur || "EUR";
    deals.forEach(function (d) {
      var cid = custFor(d.org, d.person);
      if (!cid) { out.noCust++; return; }
      var s = stageOf(d), status = d.status;
      if (p === "hubspot") status = s && s.closed ? s.closed : "open";
      var row = { id: id("deal", d.xid), cust: cid, title: d.title, val: 0 };
      if (status === "won" || status === "lost") {
        row.stage = status;
        if (d.cd) row.cd = d.cd;
        if (status === "lost" && d.why) row.why = d.why;
      } else {
        var pr = d.prob !== null ? d.prob : (s ? s.prob : null);
        row.stage = bucket(pr);
        if (pr !== null) row.prob = pr;
        if (d.close) row.close = d.close;
      }
      if (d.val !== null && d.val > 0) {
        if (!d.cur || d.cur === mine) row.val = d.val;
        else out.otherCur++;               // another currency: no value here (CRM has one currency)
      }
      var prev = rows.deals[row.id];
      if (!prev && row.val === 0 && d.val > 0 && d.cur && d.cur !== mine) {
        row.note = ctx.src + ": " + (d.val / 100).toFixed(2) + " " + d.cur;
      }
      var at = put("deals", row, DEAL_F, C.normDeal);
      if (at) { dealOf[d.xid] = at; dealCust[at] = cid; }
    });

    (got.acts || []).forEach(function (a) {
      var did = a.deal && dealOf[a.deal] ? dealOf[a.deal] : "";
      var cid = custFor(a.org, a.person) || (did ? dealCust[did] : "");
      if (!cid) { out.noCust++; return; }
      var row = { id: id("act", a.xid), cust: cid, d: a.d, text: a.text };
      if (a.t) row.t = a.t;
      if (did) row.deal = did;
      var prev = rows.fups[row.id];
      if (prev && prev.done) row.done = prev.done;     // done here stays done
      put("fups", row, FUP_F, C.normFup);
    });
    return out;
  }
  function count(pl) {
    return {
      add: pl.cust.add.length + pl.deals.add.length + pl.fups.add.length,
      upd: pl.cust.upd.length + pl.deals.upd.length + pl.fups.upd.length
    };
  }

  var api = {
    PLATFORMS: PLATFORMS, KINDS: KINDS, MAX: MAX,
    req: req, read: read, plan: plan, count: count, bucket: bucket
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosLinksCrm = api;
})(typeof window !== "undefined" ? window : this);
