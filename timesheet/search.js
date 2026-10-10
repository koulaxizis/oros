// ============================================================
// orOS Timesheet — universal search provider (v1.0.0)
// Loaded by the shell on the first menu search (apps.json
// "search"). Read-only: reads oros-timesheet-data, never writes.
// Hits: one per project (name; client as text), one per client
// (name; its projects as text) and one per time entry that has a
// description (the description; project and client as text, the
// date shown is the day it started). Entries without a description
// are found through their project. Tombstones ({ id, m, del: 1 })
// and archived projects are skipped.
// Opens through the generic deep link: target { entry } |
// { project } | { client } (receiver in timesheet.js).
// ============================================================
(function (root) {
  "use strict";
  var KEY = "oros-timesheet-data";

  function str(v) { return typeof v === "string" ? v.trim() : ""; }
  function live(a) {
    return (Array.isArray(a) ? a : []).filter(function (x) {
      return x && typeof x === "object" && typeof x.id === "string" && !x.del;
    });
  }

  var PROVIDER = {
    id: "timesheet",
    keys: [KEY],
    search: function (ctx) {
      var d = ctx.readJSON(KEY), out = [];
      if (!d || typeof d !== "object") return out;
      var el = ctx.lang === "el";
      var clients = {}, projects = {};
      live(d.clients).forEach(function (c) { clients[c.id] = c; });
      live(d.projects).forEach(function (p) { projects[p.id] = p; });
      var projNames = {};
      Object.keys(projects).forEach(function (id) {
        var p = projects[id];
        if (p.arch) return;
        var c = clients[p.client];
        if (c) (projNames[c.id] = projNames[c.id] || []).push(str(p.name));
        out.push({
          id: "p:" + p.id,
          title: str(p.name) || (el ? "Έργο χωρίς όνομα" : "Unnamed project"),
          text: c ? str(c.name) : "",
          when: typeof p.m === "number" ? p.m : 0,
          target: { project: p.id }
        });
      });
      Object.keys(clients).forEach(function (id) {
        var c = clients[id];
        out.push({
          id: "c:" + c.id,
          title: str(c.name) || (el ? "Πελάτης χωρίς όνομα" : "Unnamed client"),
          text: (projNames[c.id] || []).filter(Boolean).join(" · "),
          when: typeof c.m === "number" ? c.m : 0,
          target: { client: c.id }
        });
      });
      live(d.entries).forEach(function (x) {
        var desc = str(x.desc);
        if (!desc || typeof x.s !== "number") return;
        var p = projects[x.p], c = p ? clients[p.client] : null;
        out.push({
          id: "e:" + x.id,
          title: desc,
          text: [p ? str(p.name) : "", c ? str(c.name) : ""].filter(Boolean).join(" · "),
          when: x.s,
          target: { entry: x.id }
        });
      });
      return out;
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PROVIDER;
  if (root && root.document) {
    var list = root.orosSearchProviders = root.orosSearchProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === PROVIDER.id) return;
    list.push(PROVIDER);
  }
})(typeof window !== "undefined" ? window : globalThis);
