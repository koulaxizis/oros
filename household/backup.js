// ============================================================
// orOS Household — backup.js (a copy of every shared document on the
// person's own orOS disk; BR-HH wave 8; pure, no DOM)
// The shared documents live in the household box (relay or folder)
// and in each device's IndexedDB. So that nothing is lost when a box
// is gone (deleted, wiped after 180 days unused, a folder removed) and
// a device lost its copy too, the engine writes one file per household
// and device into the orOS disk, folder DIR. The disk travels to the
// person's cloud through Vault Drive (vault.js), encrypted with their
// passphrase, so their other devices hold it too.
//   - one file per device (no two devices ever write the same file, so
//     the disk never makes conflict copies of it); restore merges every
//     file of a household with core.merge, so the newest of each field
//     wins and nothing is lost;
//   - written after a pass that reached the box, at most every
//     EVERY_MS per household, and only when the documents changed (the
//     same content is never written twice: no endless uploads);
//   - never written while the box is gone (the last good copy stays);
//   - invites (their secrets) are left out of the roster copy.
// File: { kind: KIND, v: 1, box, name, dev, at, docs: { k: doc } }.
//   fileName(box, dev)        → "<box>.<dev>.json"
//   body(box, name, docs)     → what is compared (no time, no device)
//   wrap(body, at, dev)       → the file's text
//   parse(text)               → { box, name, dev, at, docs } or null
//   collect(parsed list)      → { box: { box, name, at, files, docs } }
//   strip(roster doc)         → the roster without invites
// Exposes window.OrosHouseBackup and, under Node, module.exports.
// ============================================================
(function (root) {
  "use strict";

  var Core = (root && root.OrosHouseCore) || (typeof require === "function" ? require("./core.js") : null);

  var DIR = "/internal/Household backup";
  var KIND = "oros-household-backup";
  var EVERY_MS = 10 * 60000;
  var DEV_RE = /^[A-Za-z0-9_-]{6,22}$/;
  var KEY_RE = /^[A-Za-z0-9_-]{1,32}$/;
  var NAME_RE = /^([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{6,22})\.json$/;
  var ROSTER = "r";

  function isObj(x) { return !!x && typeof x === "object" && !Array.isArray(x); }

  function fileName(box, dev) { return box + "." + dev + ".json"; }
  function boxOf(name) { var m = NAME_RE.exec(String(name || "")); return m ? m[1] : ""; }

  function strip(doc) {
    var d = Core.clean(doc, "roster"), out = { v: d.v, kind: d.kind, m: d.m, it: {}, dt: {} };
    Object.keys(d.it).forEach(function (id) { if (id.slice(0, 2) !== "i:") out.it[id] = d.it[id]; });
    Object.keys(d.dt).forEach(function (id) { if (id.slice(0, 2) !== "i:") out.dt[id] = d.dt[id]; });
    return out;
  }

  // docs: { k: doc } as the engine holds them
  function body(box, name, docs) {
    var out = {};
    Object.keys(docs || {}).sort().forEach(function (k) {
      if (!KEY_RE.test(k) || !docs[k]) return;
      out[k] = k === ROSTER ? strip(docs[k]) : Core.clean(docs[k]);
    });
    return { v: 1, box: box, name: Core.line(name, 60), docs: out };
  }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function wrap(b, at, dev) {
    return JSON.stringify({ kind: KIND, v: 1, box: b.box, name: b.name, dev: dev, at: at, docs: b.docs });
  }
  function parse(text) {
    var j;
    try { j = JSON.parse(String(text || "")); } catch (e) { return null; }
    if (!isObj(j) || j.kind !== KIND || !Core.BOX_RE.test(j.box || "") || !isObj(j.docs)) return null;
    var docs = {};
    Object.keys(j.docs).forEach(function (k) {
      if (!KEY_RE.test(k) || !isObj(j.docs[k])) return;
      docs[k] = k === ROSTER ? strip(j.docs[k]) : Core.clean(j.docs[k]);
    });
    return { box: j.box, name: Core.line(j.name, 60), dev: DEV_RE.test(j.dev || "") ? j.dev : "",
             at: typeof j.at === "number" && j.at > 0 ? j.at : 0, docs: docs };
  }
  // The body a parsed file stands for (to compare with a new one).
  function bodyOf(p) { return p ? { v: 1, box: p.box, name: p.name, docs: p.docs } : null; }

  function collect(list) {
    var out = {};
    (list || []).forEach(function (p) {
      if (!p) return;
      var c = out[p.box] = out[p.box] || { box: p.box, name: "", at: 0, files: 0, docs: {} };
      c.files++;
      if (p.at >= c.at) { c.at = p.at; if (p.name) c.name = p.name; }
      Object.keys(p.docs).forEach(function (k) { c.docs[k] = c.docs[k] ? Core.merge(c.docs[k], p.docs[k]) : p.docs[k]; });
    });
    return out;
  }

  var api = { DIR: DIR, KIND: KIND, EVERY_MS: EVERY_MS, DEV_RE: DEV_RE, fileName: fileName, boxOf: boxOf, strip: strip,
              body: body, bodyOf: bodyOf, same: same, wrap: wrap, parse: parse, collect: collect };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root && root.document) root.OrosHouseBackup = api;
})(typeof window !== "undefined" ? window : null);
