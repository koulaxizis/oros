// ============================================================
// orOS Assistant — links between a CRM partner and other apps
// (AS-LINK, wave A5)
// ------------------------------------------------------------
// link_items: a CRM customer linked to (or unlinked from) a Stock
// supplier, a Stock consignment shop, a Timesheet client, an Invoices
// client or a person on Publishing titles: the links CRM's own
// "Linked in other apps" makes (crm/core.js pt rows, linkMove; the
// candidates of crm/links.js). CRM writes only its own data; the other
// apps are read, never changed. One card, a tick per link, nothing
// written before Link; Undo puts the pt rows back while nobody changed
// them since. Pure: no DOM, no storage. assistant.js loads it with
// CRM's core and links the first time.
// window.OrosAssistLinks / module.exports.
// i18n-inline-ok: none (no UI text here)
// ============================================================
(function (root) {
  "use strict";
  var MAX = 50;
  // what each kind of record is, for the model and the card
  var KIND_WHAT = { sup: "Stock supplier", wh: "Stock consignment shop", tsc: "Timesheet client", inv: "Invoices client", pub: "person on Publishing titles" };

  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function bad(msg) { return { ok: false, err: msg }; }
  function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function byId(list, id) {
    for (var i = 0; i < (list || []).length; i++) if (list[i] && list[i].id === id) return list[i];
    return null;
  }
  function clean(s) { return typeof s === "string" ? s.replace(/^oros:/, "").trim() : ""; }

  // The record a search_data ref points at → the link key it makes.
  function keyOfRef(r) {
    if (!r || !isObj(r.target) && typeof r.target !== "string") return "";
    var t = r.target;
    if (r.app === "stock" && isObj(t) && typeof t.sup === "string") return "sup:" + t.sup;
    if (r.app === "timesheet" && isObj(t) && typeof t.client === "string") return "tsc:" + t.client;
    if (r.app === "invoices" && isObj(t) && isObj(t.client) && typeof t.client.id === "string") return "inv:" + t.client.id;
    return "";
  }

  // args.links (the model's) → [{ custId, key, name, k, unlink }] | { err }
  //   refOf(ref) → { app, target, title } | null (this conversation's refs)
  //   cands = crm/links.js candidates() of this device's data
  //   C = OrosCrmCore, crm = its normalized data
  function resolve(list, refOf, cands, C, crm) {
    if (!Array.isArray(list) || !list.length) return { err: "links is empty." };
    if (list.length > MAX) return { err: "At most " + MAX + " links at a time." };
    var out = [], seen = {};
    for (var i = 0; i < list.length; i++) {
      var x = isObj(list[i]) ? list[i] : {}, w = "links[" + i + "]: ";
      var rc = refOf(clean(x.customer));
      if (!rc || rc.app !== "crm" || !isObj(rc.target) || typeof rc.target.cust !== "string") return { err: w + "customer must be a CRM customer's ref from search_data or create_items." };
      if (!byId(crm.cust, rc.target.cust)) return { err: w + "that customer is no longer in CRM." };
      var given = ["item", "shop", "person"].filter(function (k) { return clean(x[k]); });
      if (given.length !== 1) return { err: w + "give exactly one of item (a ref), shop or person (a name)." };
      var cand = null;
      if (given[0] === "item") {
        var ri = refOf(clean(x.item)), key = keyOfRef(ri);
        if (!key) return { err: w + "item must be the ref of a Stock supplier, a Timesheet client or an Invoices client (search_data in that app)." };
        cands.forEach(function (c) { if (!cand && c.key === key) cand = c; });
        if (!cand) {
          if (key.slice(0, 4) === "inv:") return { err: w + "that Invoices client is linked to CRM in Invoices itself (or is gone)." };
          return { err: w + "that record is no longer there." };
        }
      } else {
        var kind = given[0] === "shop" ? "wh" : "pub", f = C.fold(clean(x[given[0]])).replace(/\s+/g, " ");
        var hits = cands.filter(function (c) { return c.k === kind && (C.fold(c.name).replace(/\s+/g, " ") === f || (c.sub && C.fold(c.sub).replace(/\s+/g, " ") === f)); });
        if (!hits.length) {
          var all = cands.filter(function (c) { return c.k === kind; }).map(function (c) { return c.name; });
          return { err: w + "no " + KIND_WHAT[kind] + " is named \"" + clean(x[given[0]]) + "\". " + (all.length ? "There are: " + all.slice(0, 30).join(", ") + "." : "There are none on this device.") };
        }
        if (hits.length > 1) return { err: w + "several " + KIND_WHAT[kind] + "s have that name; ask the user which one." };
        cand = hits[0];
      }
      var custId = rc.target.cust, unlink = x.unlink === true;
      if (seen[cand.key]) return { err: "links[" + seen[cand.key] + "] and " + w.slice(0, -2) + " are about the same record; give each once." };
      seen[cand.key] = String(i);
      if (unlink && C.lnOf(crm, byId(crm.cust, custId)).indexOf(cand.key) < 0) return { err: w + "that customer is not linked to " + cand.name + "." };
      out.push({ custId: custId, cust: byId(crm.cust, custId).name, key: cand.key, k: cand.k, name: cand.name, unlink: unlink });
    }
    return { links: out };
  }

  // → { ok, rows: [{ title, k, name, cust, from?, same, unlink }] }
  function plan(C, crm, links) {
    return { ok: true, rows: links.map(function (l) {
      var owner = C.linkOwner(crm, l.key);
      var row = { cust: l.cust, k: l.k, name: l.name, unlink: l.unlink, same: !l.unlink && !!owner && owner.id === l.custId };
      if (!l.unlink && owner && owner.id !== l.custId) row.from = owner.name;
      return row;
    }) };
  }
  // The pt rows, stamped as CRM's savePt: after the row, after a
  // customer's tombstone. skip[i] = the user unticked link i.
  function apply(C, crm, links, now, skip) {
    var d = clone(crm), done = [], touched = {};
    if (!Array.isArray(d.pt)) d.pt = [];
    links.forEach(function (l, i) {
      if (skip && skip[i]) return;
      var rows = C.linkMove(d, l.unlink ? "" : l.custId, l.key);
      if (!rows.length) return;
      rows.forEach(function (r) {
        var prev = byId(d.pt, r.id), next = clone(r);
        if (!(r.id in touched)) touched[r.id] = prev ? clone(prev) : null;
        var orig = touched[r.id];       // one stamp per row for the whole card
        next.m = Math.max(Math.floor(now), (orig && orig.m ? orig.m : 0) + 1);
        var tomb = d.tombs && d.tombs[next.id];
        if (tomb && tomb >= next.m) next.m = tomb + 1;
        if (prev) d.pt[d.pt.indexOf(prev)] = next; else d.pt.push(next);
      });
      done.push(i);
    });
    d = C.norm(d);
    var undo = { t: "link", rows: Object.keys(touched).map(function (id) { return { id: id, prev: touched[id], next: clone(byId(d.pt, id)) }; }) };
    return { ok: true, data: d, done: done, undo: undo };
  }
  // Each row back as it was (an emptied row stays, so the undo syncs),
  // with a newer stamp; nothing when one changed since.
  function undo(C, crm, u, now) {
    var d = clone(crm);
    if (!Array.isArray(d.pt)) d.pt = [];
    for (var i = 0; i < u.rows.length; i++) {
      if (!same(byId(d.pt, u.rows[i].id), u.rows[i].next)) return bad("A link was changed since; nothing was undone.");
    }
    u.rows.forEach(function (r) {
      var cur = byId(d.pt, r.id), back = r.prev ? clone(r.prev) : { id: r.id };
      back.m = Math.max(Math.floor(now), (cur && cur.m ? cur.m : 0) + 1);
      if (cur) d.pt[d.pt.indexOf(cur)] = back; else d.pt.push(back);
    });
    return { ok: true, data: C.norm(d) };
  }

  var api = { MAX: MAX, KIND_WHAT: KIND_WHAT, keyOfRef: keyOfRef, resolve: resolve, plan: plan, apply: apply, undo: undo };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root && root.document) root.OrosAssistLinks = api;
})(typeof window !== "undefined" ? window : this);
