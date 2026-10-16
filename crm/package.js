// ============================================================
// orOS CRM — .oroscrm file (crm/package.js, window.OrosCrmPackage).
// The descriptor of CRM for the record apps' kit (../recordpkg.js,
// docs/oros-bundle.md "Record apps"): every customer, deal, history
// entry, follow-up, tag and own pipeline stage in one orOS bundle;
// opening one ADDS what this device lacks, with its ids. Pure (no
// DOM, no storage), so the app and `node --test` run the same code.
// Needs core.js (window.OrosCrmCore; require("./core.js") in Node).
//   DESC                     the kit descriptor; merge = core.js merge
//                            (pure: per id, newer m wins; deals,
//                            history and follow-ups of a customer that
//                            is not alive drop), which only ever sees
//                            the records the kit let through, so a
//                            clash keeps the local record
//   DESC.norm(data)          a file's data → core.js norm (its own
//                            record checks, caps and tombstones), then
//                            only the record lists and tombs
//   DESC.strip(state)        the slice → { ver, cust, deals, acts,
//                            fups, tags, stg }: no tombstones, no
//                            prefs (currency, "Not contacted" after),
//                            no built-in stage settings, and NEVER the
//                            web form (wf: its relay key, secret and
//                            private key). HubSpot / Pipedrive /
//                            Invoice Ninja / Odoo keys live in the
//                            shell's Connected services, not here.
//   DESC.tombIds(state)      the ids in state.tombs
//   DESC.previews(state, l)  customers.csv (core.js csvRows + csvCell,
//                            the app's own "Export customers (CSV)":
//                            ";" separated, BOM, formula guard)
//   kindOf(id, state)        "cust" | "deals" | "acts" | "fups" |
//                            "tags" | "stg" | ""
// ============================================================
(function (root) {
  "use strict";

  var C = typeof module === "object" && module.exports ? require("./core.js") : root.OrosCrmCore;
  var LISTS = ["cust", "deals", "acts", "fups", "tags", "stg"];

  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  // Built-in open stages ("new", "contact" …) are this CRM's pipeline
  // settings, not records: they stay out of the file.
  function ownStages(list) {
    return (Array.isArray(list) ? list : []).filter(function (r) {
      return isObj(r) && C.OPEN_STAGES.indexOf(r.id) < 0;
    });
  }

  function norm(data) {
    if (!isObj(data)) return null;
    var n = C.norm(data), out = { ver: C.DATA_VER };
    LISTS.forEach(function (k) { out[k] = n[k]; });
    out.stg = ownStages(out.stg);
    out.tombs = n.tombs;                   // strip and tombIds see it, then it goes
    return out;
  }
  function strip(state) {
    var s = isObj(state) ? state : {}, out = { ver: C.DATA_VER };
    LISTS.forEach(function (k) { out[k] = Array.isArray(s[k]) ? s[k] : []; });
    out.stg = ownStages(out.stg);
    return JSON.parse(JSON.stringify(out));
  }
  function tombIds(state) {
    return isObj(state) && isObj(state.tombs) ? Object.keys(state.tombs) : [];
  }
  function previews(state, lang) {
    var d = C.empty();
    LISTS.forEach(function (k) { if (Array.isArray(state[k])) d[k] = state[k]; });
    var rows = C.csvRows(d, lang);
    if (rows.length < 2) return {};
    return { "customers.csv": "﻿" + rows.map(function (r) { return r.map(C.csvCell).join(";"); }).join("\r\n") + "\r\n" };
  }

  // Which list an id is in (Undo tombstones each).
  function kindOf(id, state) {
    var s = isObj(state) ? state : {};
    for (var i = 0; i < LISTS.length; i++) {
      if (C.byId(s[LISTS[i]], id)) return LISTS[i];
    }
    return "";
  }

  var colls = {};
  LISTS.forEach(function (k) { colls[k] = { shape: "array", id: "id", stamp: "m" }; });
  var DESC = {
    app: "crm", title: "CRM", slice: "crm", ext: ".oroscrm", mime: "application/x-oros-crm",
    colls: colls,
    norm: norm, merge: function (a, b) { return C.merge(a, b); }, strip: strip, tombIds: tombIds, previews: previews
  };

  var api = { DESC: DESC, kindOf: kindOf };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrosCrmPackage = api;
})(this);
