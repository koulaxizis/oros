// ============================================================
// orOS Certificates — .oroscert package (certificates/package.js,
// window.CertPackage). One set of certificates (an event: the design
// and what it is for, with its list of people) = one orOS bundle
// (../bundle.js, docs/oros-bundle.md). Pure (no DOM, no storage), so
// the app and `node --test` run the same code:
//   build(data, evId, lang)  the event in the app's own model →
//                       { content, assets[], preview[], title, modified }
//     content = { kind: "oros-certificates-package", ver: 1,
//                 ev  { the event, exactly as core.js keeps it },
//                 ppl [{ its people, list order, numbers kept }] }
//     assets  = the designkit ids (<sha256>.<jpg|png>) of the logo,
//               the seal and the signature pictures: media/<id>
//     preview = people.csv, the register (core.js registerCsv, with
//               its guard against spreadsheet formulas)
//     The signing keys of the check QR codes (data.keys) are NEVER
//     put in a file: they are private keys and stay in orOS sync.
//   parse(content, o)   content.json → { ev, ppl, assets }: a NEW event
//                       and new people with fresh ids, through the
//                       app's own normalisers (core.js normEvent /
//                       normPerson); everything else dropped.
//                       Throws Error("notpackage") for anything else.
// ============================================================
(function (root) {
  "use strict";

  var C = root.CertCore || (typeof require === "function" ? require("./core.js") : null);
  var KIND = "oros-certificates-package", VER = 1;

  function copy(o) { return JSON.parse(JSON.stringify(o)); }

  // The pictures an event uses, once each, in a stable order.
  function assetIds(ev) {
    var out = [], seen = {};
    function add(im) {
      if (im && typeof im.a === "string" && C.ASSET_RE.test(im.a) && !seen[im.a]) { seen[im.a] = 1; out.push(im.a); }
    }
    if (!ev) return out;
    add(ev.logo);
    add(ev.seal);
    (Array.isArray(ev.sigs) ? ev.sigs : []).forEach(add);
    return out;
  }

  // People in list order (the order numbers are given in).
  function inOrder(list) {
    return list.slice().sort(function (a, b) { return (a.o || 0) - (b.o || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); });
  }

  function build(data, evId, lang) {
    var ev = data && C.eventById(data, evId);
    if (!ev) throw new Error("noevent");
    var ppl = inOrder(C.eventPeople(data, evId));
    var modified = ev.m;
    ppl.forEach(function (p) { if (p.m > modified) modified = p.m; });
    // only the event and its people: never data.keys, data.tombs or
    // another event
    var content = { kind: KIND, ver: VER, ev: copy(ev), ppl: ppl.map(copy) };
    var csv = C.registerCsv(data, evId, lang === "el" ? "el" : "en");
    return {
      content: content, assets: assetIds(ev), title: ev.t || "", modified: modified || 0,
      preview: [{ name: "people.csv", data: csv, type: "text/csv" }]
    };
  }

  // o: { now (ms), rand () → [0, 1) for the new ids }
  function parse(content, o) {
    o = o || {};
    var c = content;
    if (!c || typeof c !== "object" || c.kind !== KIND || !c.ev || typeof c.ev !== "object") throw new Error("notpackage");
    var now = typeof o.now === "number" && o.now > 0 ? Math.floor(o.now) : Date.now();
    var used = {};
    function fresh(prefix) {
      var id;
      do { id = C.newId(prefix, o.rand); } while (used[id]);
      used[id] = 1;
      return id;
    }
    var src = copy(c.ev);
    src.id = fresh("e");
    src.m = now;
    var ev = C.normEvent(src);
    if (!ev) throw new Error("notpackage");
    var ppl = [];
    (Array.isArray(c.ppl) ? c.ppl : []).forEach(function (p) {
      if (!p || typeof p !== "object" || ppl.length >= C.LIM.perEvent) return;
      var x = copy(p);
      x.id = fresh("p");
      x.m = now;
      x.e = ev.id;
      var n = C.normPerson(x);
      if (n) ppl.push(n);
    });
    return { ev: ev, ppl: ppl, assets: assetIds(ev) };
  }

  var api = { KIND: KIND, VER: VER, build: build, parse: parse, assetIds: assetIds };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CertPackage = api;
})(typeof window !== "undefined" ? window : this);
