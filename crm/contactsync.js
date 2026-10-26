// ============================================================
// orOS CRM ↔ Contacts — two-way sync of linked records (CT-CRM)
// (crm/contactsync.js, window.OrosCrmContactSync, v1.0.0)
// ============================================================
// Pure logic, no DOM, no storage, no clock: callers pass "now", the
// CRM core (C = OrosCrmCore) and the Contacts merge (MG =
// OrosContactsMerge, for the contacts' field stamps). The shell runs
// run() on the stored copies of both apps and writes back what
// changed (each app's own rules: CRM's norm and stamps, Contacts'
// restamp); the CRM app calls stampEdits() on every write and shows
// diffs() with keep().
//
// Pairs. A customer of kind "person" whose first linked person (a
// people row with a contact id) is still in Contacts IS that contact:
//   name     ↔ given + middle + family
//   phone    ↔ first phone        email ↔ first e-mail
//   web      ↔ first website      job   ↔ job title
//   addr     ↔ first address (street, zip city, region)
//   country  ↔ the first address's country
// Nothing else is touched (tax number, notes, tags, birthdays, the
// other phones / e-mails stay as they are). A company's linked people
// are its staff: when the company is renamed in CRM, a linked contact
// whose company field still holds an earlier name follows it.
//
// The rule, per field (CRM keeps its side in the cs row, crm/core.js
// 1.8: [value, stamp], merged field by field):
//   - same value on both sides → nothing.
//   - both stamps known → the newer change wins (a tie: Contacts).
//   - CRM's stamp unknown (a pair that existed before this sync):
//     a contact changed since the pair started wins; an empty side is
//     filled from the other; two different values are a difference
//     (stamp -1) that only the user settles (keep()).
// Copies write a value only when it really changes the other side,
// and a value one side can't hold exactly is never written (no loop,
// no endless uploads): after one pass both sides are equal.
// ============================================================
(function (root) {
  "use strict";

  var FIELDS = ["name", "phone", "email", "web", "job", "addr", "country"];
  var SRC = { name: ["given", "middle", "family"], phone: ["phones"], email: ["emails"],
              web: ["websites"], job: ["jobTitle"], addr: ["addresses"], country: ["addresses"] };
  var LIST = { phone: "phones", email: "emails", web: "websites" };
  var LIST_TYPE = { phones: "mobile", emails: "other", websites: "other" };
  var PART_MAX = 60;           // Contacts: given / middle / family
  var LIMIT = { phones: 40, emails: 120, websites: 300, jobTitle: 80, street: 120, city: 60, zip: 20, region: 60, country: 60, org: 80 };

  function J(v) { return JSON.stringify(v === undefined ? null : v); }
  function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
  function str(v) { return typeof v === "string" ? v : ""; }
  function byId(list, id) {
    if (!Array.isArray(list)) return null;
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === id) return list[i];
    return null;
  }

  // ---------- The contact's side, in CRM's form ----------
  function addrLine(a) {
    if (!a) return "";
    var zc = [str(a.zip).trim(), str(a.city).trim()].filter(Boolean).join(" ");
    return [str(a.street).trim(), zc, str(a.region).trim()].filter(Boolean).join(", ");
  }
  function firstV(list) { return Array.isArray(list) && list[0] && typeof list[0].v === "string" ? list[0].v : ""; }
  function contactVals(C, ct) {
    var a0 = Array.isArray(ct.addresses) ? ct.addresses[0] : null;
    var M = C.CS_FIELDS;
    return {
      name: C.cleanText([str(ct.given), str(ct.middle), str(ct.family)].map(function (s) { return s.trim(); }).filter(Boolean).join(" "), M.name),
      phone: C.cleanText(firstV(ct.phones), M.phone),
      email: C.cleanText(firstV(ct.emails), M.email),
      web: C.cleanText(firstV(ct.websites), M.web),
      job: C.cleanText(str(ct.jobTitle), M.job),
      addr: C.cleanText(addrLine(a0), M.addr),
      country: C.cleanText(a0 ? str(a0.country) : "", M.country)
    };
  }
  function contactStamp(MG, ct, k) {
    var s = 0;
    SRC[k].forEach(function (f) {
      var v = MG && typeof MG.fieldStamp === "function" ? MG.fieldStamp(ct, f) : (ct.mtime || 0);
      if (typeof v === "number" && isFinite(v) && v > s) s = v;
    });
    return s;
  }

  // ---------- Writing one field into a contact (a copy) ----------
  function splitName(v, ct) {
    var fam = str(ct.family).trim(), mid = str(ct.middle).trim(), rest, family;
    if (fam && v.length > fam.length && v.slice(-(fam.length + 1)) === " " + fam) {
      family = fam; rest = v.slice(0, -(fam.length + 1));
    } else {
      var i = v.lastIndexOf(" ");
      if (i < 0) { family = ""; rest = v; } else { family = v.slice(i + 1); rest = v.slice(0, i); }
    }
    var given = rest, middle = "";
    if (mid && rest.length > mid.length && rest.slice(-(mid.length + 1)) === " " + mid) {
      middle = mid; given = rest.slice(0, -(mid.length + 1));
    }
    return { given: given, middle: middle, family: family };
  }
  function sameV(k, a, b) {
    return k === "emails" ? a.toLowerCase() === b.toLowerCase() : a === b;
  }
  // false when the contact can't hold v exactly (it is then left alone)
  function setField(C, ct, k, v) {
    if (k === "name") {
      if (!v) return false;
      var p = splitName(v, ct);
      if (p.given.length > PART_MAX || p.middle.length > PART_MAX || p.family.length > PART_MAX) return false;
      ct.given = p.given; ct.middle = p.middle; ct.family = p.family;
    } else if (LIST[k]) {
      var key = LIST[k], list = Array.isArray(ct[key]) ? ct[key] : [];
      if (!v) {
        if (!list.length) return true;
        list.splice(0, 1);                // the next one becomes the first
        ct[key] = list;
        return true;                       // (and flows back to CRM next pass)
      }
      if (v.length > LIMIT[key]) return false;
      var at = -1;
      list.forEach(function (r, i) { if (at < 0 && r && sameV(key, str(r.v), v)) at = i; });
      if (at > 0) list.unshift(list.splice(at, 1)[0]);
      else if (at < 0) {
        if (list.length) list[0] = { v: v, type: list[0].type || LIST_TYPE[key] };
        else list.push({ v: v, type: LIST_TYPE[key] });
      }
      ct[key] = list;
    } else if (k === "job") {
      if (v.length > LIMIT.jobTitle) return false;
      ct.jobTitle = v;
    } else if (k === "addr" || k === "country") {
      var addrs = Array.isArray(ct.addresses) ? ct.addresses : [];
      var a = addrs[0] ? Object.assign({}, addrs[0]) : { street: "", city: "", zip: "", region: "", country: "", type: "other" };
      if (k === "country") {
        if (v.length > LIMIT.country) return false;
        a.country = v;
      } else {
        // keep zip / city / region when the line still ends with them
        var tail = addrLine({ zip: a.zip, city: a.city, region: a.region });
        if (v && tail && v.length > tail.length + 2 && v.slice(-(tail.length + 2)) === ", " + tail) {
          a.street = v.slice(0, -(tail.length + 2));
        } else {
          a.street = v; a.city = ""; a.zip = ""; a.region = "";
        }
        if (a.street.length > LIMIT.street) return false;
      }
      if (!str(a.street) && !str(a.city) && !str(a.zip) && !str(a.region) && !str(a.country)) {
        if (addrs.length) addrs.splice(0, 1);
      } else if (addrs.length) addrs[0] = a;
      else addrs.push(a);
      ct.addresses = addrs;
    } else return false;
    var back = contactVals(C, ct)[k];
    return back === v || (!v && !!LIST[k]);
  }

  // ---------- The rule ----------
  // crmVal / rs: CRM's value and stamp (rs null = unknown);
  // pending: an earlier pass left a difference to the user.
  function decide(crmVal, rs, cv, cs, t, pending) {
    if (crmVal === cv) return "same";
    if (rs !== null) return rs > cs ? "crm" : "contact";
    if (cs > t) return "contact";
    if (pending) return "diff";
    if (crmVal === "") return "contact";
    if (cv === "") return "crm";
    return "diff";
  }
  function crmSide(row, cust, k) {
    var rec = row && row.f ? row.f[k] : null;
    var rv = cust[k] || "";
    if (!rec) return { val: rv, rs: null, pending: false, rec: null };
    return { val: rec[0], rs: rec[1] >= 0 ? rec[1] : null, pending: rec[1] === -1, rec: rec };
  }
  function pairOf(cust, ctMap) {
    if (!cust || cust.kind !== "person" || !Array.isArray(cust.people)) return null;
    for (var i = 0; i < cust.people.length; i++) {
      if (cust.people[i].c) return ctMap[cust.people[i].c] || null;
    }
    return null;
  }
  // The contacts that are alive (a tombstone or a del flag: gone)
  function contactMap(ctd) {
    var map = {}, dead = {};
    if (ctd && Array.isArray(ctd.deleted)) ctd.deleted.forEach(function (x) { if (x && typeof x.id === "string") dead[x.id] = 1; });
    if (ctd && Array.isArray(ctd.contacts)) ctd.contacts.forEach(function (c) {
      if (c && typeof c.id === "string" && c.id && !dead[c.id] && !c.del) map[c.id] = c;
    });
    return map;
  }

  // ---------- One pass over both apps ----------
  // → { crm: new CRM data | null, contacts: new Contacts data | null,
  //     cust: customers changed, ct: contacts changed }
  function run(C, MG, crmRaw, ctRaw, now) {
    var out = { crm: null, contacts: null, cust: 0, ct: 0 };
    if (!C || !crmRaw || !ctRaw || !Array.isArray(ctRaw.contacts)) return out;
    var data = C.norm(crmRaw);
    var ctd = clone(ctRaw);
    var ctMap = contactMap(ctd);
    var rows = {};
    (data.cs || []).forEach(function (r) { rows[r.id] = r; });
    var crmDirty = false, prevCt = {};
    function touch(ct) { if (!prevCt[ct.id]) prevCt[ct.id] = clone(ct); }

    data.cust.forEach(function (cust, ci) {
      var orig = rows[cust.id] || null;
      var row = orig ? clone(orig) : { id: cust.id, m: 0 };
      var ct = pairOf(cust, ctMap);
      var next = null, src = 0;
      if (ct) {
        if (row.c !== ct.id) { row.c = ct.id; row.t = now; delete row.f; }
        var vals = contactVals(C, ct);
        FIELDS.forEach(function (k) {
          var cv = vals[k], cs = contactStamp(MG, ct, k), side = crmSide(row, cust, k);
          var d = decide(side.val, side.rs, cv, cs, row.t, side.pending), target = side.val;
          row.f = row.f || {};
          if (d === "same") {
            if (!side.rec || side.pending) row.f[k] = [cv, Math.max(cs, 0)];
          } else if (d === "contact") {
            if (k === "name" && !cv) return;           // a customer always keeps a name
            target = cv;
            row.f[k] = [cv, Math.max(cs, 0)];
            if (cs > src) src = cs;
          } else if (d === "crm") {
            var tmp = clone(ct);
            if (setField(C, tmp, k, side.val)) {
              touch(ct);
              Object.keys(tmp).forEach(function (f) { ct[f] = tmp[f]; });
              if (!side.rec) row.f[k] = [side.val, now];   // a filled blank: agreed from now on
            }
          } else if (!side.rec) row.f[k] = [side.val, -1];  // a difference: the user decides
          if (!Object.keys(row.f).length) delete row.f;
          if (target !== (cust[k] || "")) {
            next = next || clone(cust);
            if (target) next[k] = target; else delete next[k];
          }
        });
      } else if (cust.kind !== "person" && (cust.people || []).some(function (p) { return p.c; })) {
        if (!row.n) row.n = cust.name;
        else if (row.n !== cust.name) {
          var old = [row.n].concat(row.o || []).filter(function (s, i, a) { return s !== cust.name && a.indexOf(s) === i; });
          row.n = cust.name;
          if (old.length) row.o = old.sort().slice(0, C.LIMITS.csOld); else delete row.o;
        }
        if (row.o) cust.people.forEach(function (p) {
          var pc = p.c ? ctMap[p.c] : null;
          if (!pc) return;
          var org = C.cleanText(pc.org, 120);
          if (org && org !== cust.name && row.o.indexOf(org) >= 0 && cust.name.length <= LIMIT.org) {
            touch(pc);
            pc.org = cust.name;
          }
        });
      } else return;
      if (next) {
        next.m = Math.max(cust.m + 1, src);
        if (data.tombs[next.id] && data.tombs[next.id] >= next.m) next.m = data.tombs[next.id] + 1;
        var nc = C.normCust(next);
        if (nc) { data.cust[ci] = nc; crmDirty = true; out.cust++; }
      }
      if (J(row) !== J(orig)) {
        row.m = Math.max(now, orig ? orig.m + 1 : 0);
        rows[row.id] = row;
        crmDirty = true;
      }
    });
    if (crmDirty) {
      data.cs = Object.keys(rows).map(function (id) { return rows[id]; });
      out.crm = C.norm(data);
    }
    var ids = Object.keys(prevCt);
    ids.forEach(function (id) {
      var cur = ctMap[id];
      if (J(prevCt[id]) === J(cur)) return;
      if (MG && typeof MG.restamp === "function") MG.restamp(prevCt[id], cur, now);
      else cur.mtime = Math.max(now, (prevCt[id].mtime || 0) + 1);
      out.ct++;
    });
    if (out.ct) out.contacts = ctd;
    return out;
  }

  // ---------- CRM's own edits (crm.js commit, Assistant edits) ----------
  // A mapped field of a synced customer that changed between `prev`
  // and `next` takes the customer's new stamp in its cs row. Mutates
  // and returns next (CRM data, normalized).
  function stampEdits(C, prev, next) {
    if (!next || !Array.isArray(next.cs) || !next.cs.length) return next;
    var before = {};
    (prev && Array.isArray(prev.cust) ? prev.cust : []).forEach(function (c) { before[c.id] = c; });
    next.cs.forEach(function (row, i) {
      if (!row.c) return;
      var c = byId(next.cust, row.id), p = before[row.id];
      if (!c || !p) return;
      var nr = null;
      FIELDS.forEach(function (k) {
        var v = c[k] || "";
        if ((p[k] || "") === v) return;
        var rec = row.f && row.f[k];
        if (rec && rec[0] === v && rec[1] >= 0) return;   // the sync wrote it
        nr = nr || clone(row);
        nr.f = nr.f || {};
        nr.f[k] = [v, c.m];
      });
      if (nr) { nr.m = Math.max(row.m + 1, c.m); next.cs[i] = nr; }
    });
    return next;
  }

  // ---------- Differences left to the user (CRM card) ----------
  function diffs(C, MG, data, ctRaw, custId) {
    var cust = byId(data && data.cust, custId);
    var ct = cust ? pairOf(cust, contactMap(ctRaw)) : null;
    if (!ct) return [];
    var row = byId(data.cs, custId);
    if (row && row.c !== ct.id) row = null;
    var t = row ? row.t : Infinity, vals = contactVals(C, ct), out = [];
    FIELDS.forEach(function (k) {
      var side = crmSide(row, cust, k), cs = contactStamp(MG, ct, k);
      if (decide(side.val, side.rs, vals[k], cs, t, side.pending) === "diff") out.push({ k: k, crm: side.val, ct: vals[k] });
    });
    return out;
  }
  // The user keeps one side ("crm" | "ct") of a difference → the CRM
  // data to save (normalized) or null. Keeping CRM's value gives it a
  // stamp newer than the contact's, so the next pass writes the contact.
  function keep(C, MG, data, ctRaw, custId, k, which, now) {
    if (FIELDS.indexOf(k) < 0) return null;
    var d = C.norm(data);
    var cust = byId(d.cust, custId);
    var ct = cust ? pairOf(cust, contactMap(ctRaw)) : null;
    if (!ct) return null;
    var row = clone(byId(d.cs, custId)) || { id: custId, m: 0 };
    if (row.c !== ct.id) { row.c = ct.id; row.t = now; delete row.f; }
    var cv = contactVals(C, ct)[k], cs = contactStamp(MG, ct, k);
    var val = which === "ct" ? cv : crmSide(row, cust, k).val;
    if (k === "name" && !val) return null;
    row.f = row.f || {};
    row.f[k] = [val, which === "ct" ? Math.max(cs, 0) : Math.max(now, cs + 1)];
    row.m = Math.max(now, row.m + 1);
    d.cs = (d.cs || []).filter(function (r) { return r.id !== custId; }).concat([row]);
    if ((cust[k] || "") !== val) {
      var nc = clone(cust);
      if (val) nc[k] = val; else delete nc[k];
      nc.m = Math.max(now, cust.m + 1);
      d.cust[d.cust.indexOf(cust)] = C.normCust(nc) || cust;
    }
    return C.norm(d);
  }

  var api = {
    FIELDS: FIELDS, contactVals: contactVals, contactStamp: contactStamp, splitName: splitName,
    setField: setField, decide: decide, run: run, stampEdits: stampEdits, diffs: diffs, keep: keep
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrosCrmContactSync = api;
})(typeof self !== "undefined" ? self : this);
