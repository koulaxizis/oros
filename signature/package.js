// ============================================================
// orOS Email Signature — .orossignature file (signature/package.js,
// window.OrosSignaturePackage). The descriptor of Email Signature
// for the record apps' kit (../recordpkg.js, docs/oros-bundle.md
// "Record apps"): every signature (details, look, social links,
// button, banner, QR switch, legal text) in one orOS bundle, with
// its pictures (logo, photo, banner) from the orOS disk in media/;
// opening one ADDS what this device lacks, with its ids. Pure (no
// DOM, no storage), so the app and `node --test` run the same code.
// Needs core.js (window.SignatureCore; require("./core.js") under
// Node).
//   DESC                     the kit descriptor; merge = core.js merge
//                            (pure: per signature the newer m wins,
//                            this device's tombstones kept), which only
//                            ever sees the records the kit let through,
//                            so a clash keeps the local signature
//   DESC.norm(data)          a file's data → { ver, sigs, tombs } with
//                            core.js's own normSig (invalid ones
//                            dropped, links / colours / asset ids
//                            checked), at most MAX_SIGS signatures
//   DESC.strip(state)        the slice → { ver, sigs }: no tombstones.
//                            Device prefs (the open signature, the mail
//                            app picked, preview switches) live in
//                            oros-signature-prefs, never here; the app
//                            keeps no keys or provider credentials
//   DESC.tombIds(state)      the ids in state.tombs
//   DESC.previews(state, l)  signatures.md (the text version of each)
//                            and signatures.html (each signature built
//                            by core.js for web mail: escaped, pictures
//                            only from their https address)
//   assetIds(state, ids?)    the orOS disk pictures (<sha256>.png|jpg,
//                            also the media/ keys) the signatures name,
//                            only those of the ids given when given
//   dropAssets(state, ids, bad)  the signatures of ids lose the
//                            pictures whose asset id is in bad (their
//                            bytes failed the checks); a picture with
//                            a web address keeps that
// ============================================================
(function (root) {
  "use strict";

  var C = typeof module === "object" && module.exports ? require("./core.js") : root.SignatureCore;
  var LIM = { sigs: C.MAX_SIGS };
  var PICS = ["logo", "photo", "ban"];

  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  function norm(data) {
    if (!isObj(data)) return null;
    var out = { ver: C.DATA_VER, sigs: [], tombs: {} }, seen = {};
    (Array.isArray(data.sigs) ? data.sigs : []).forEach(function (x) {
      if (out.sigs.length >= LIM.sigs) return;
      var s = C.normSig(x);
      if (!s || seen[s.id]) return;
      seen[s.id] = 1;
      out.sigs.push(s);
    });
    // strip and tombIds see them, then they go
    if (isObj(data.tombs)) Object.keys(data.tombs).forEach(function (k) {
      if (C.ID_RE.test(k)) out.tombs[k] = 1;
    });
    return out;
  }
  function strip(state) {
    var s = isObj(state) ? state : {};
    return clone({ ver: C.DATA_VER, sigs: Array.isArray(s.sigs) ? s.sigs : [] });
  }
  function tombIds(state) {
    return isObj(state) && isObj(state.tombs) ? Object.keys(state.tombs) : [];
  }

  function assetIds(state, ids) {
    var want = null, out = [];
    if (Array.isArray(ids)) { want = {}; ids.forEach(function (id) { want[id] = 1; }); }
    (isObj(state) && Array.isArray(state.sigs) ? state.sigs : []).forEach(function (s) {
      if (!isObj(s) || !isObj(s.im) || (want && !want[s.id])) return;
      PICS.forEach(function (k) {
        var a = isObj(s.im[k]) ? s.im[k].a : "";
        if (typeof a === "string" && C.ASSET_RE.test(a) && out.indexOf(a) < 0) out.push(a);
      });
    });
    return out;
  }
  function dropAssets(state, ids, bad) {
    var want = {}, gone = {};
    (ids || []).forEach(function (id) { want[id] = 1; });
    (bad || []).forEach(function (a) { gone[a] = 1; });
    (isObj(state) && Array.isArray(state.sigs) ? state.sigs : []).forEach(function (s) {
      if (!isObj(s) || !isObj(s.im) || !want[s.id]) return;
      PICS.forEach(function (k) {
        var im = s.im[k];
        if (!isObj(im) || !gone[im.a]) return;
        delete im.a;
        if (!im.u) delete s.im[k];
      });
    });
    return state;
  }

  // The kit passes "el" or "en"; a pack language (orosI18n, ../i18n.js,
  // browser only) reads the "signature" pack.
  var TEXT = {
    en: { title: "Email signatures", tpl: "Layout", lang: "Language", picsWeb: "Pictures appear only when they have an address on a website.",
          untitled: "Signature" },
    el: { title: "Υπογραφές email", tpl: "Διάταξη", lang: "Γλώσσα", picsWeb: "Οι εικόνες φαίνονται μόνο όταν έχουν διεύθυνση σε ιστότοπο.",
          untitled: "Υπογραφή" }
  };
  function previews(state, lang) {
    var code = lang === "el" ? "el" : "en", I = root && root.orosI18n;
    if (code === "en" && I) { code = I.lang(); if (code !== "el" && code !== "en") I.table(TEXT, "signature", code); }
    var T = TEXT[code] || TEXT.en, sigs = isObj(state) && Array.isArray(state.sigs) ? state.sigs : [];
    var md = ["# " + T.title, ""], html = [];
    sigs.forEach(function (x) {
      var s = C.normSig(x);
      if (!s) return;
      var name = C.label(s, T.untitled);
      md.push("## " + name, "", T.tpl + ": " + s.tpl + " · " + T.lang + ": " + s.lang, "");
      C.toText(s, {}).split("\n").forEach(function (l) { md.push(l ? l + "  " : ""); });
      md.push("");
      html.push('<h2 style="font:bold 15px Arial,sans-serif;color:#555555;margin:24px 0 8px;">' + C.esc(name) + "</h2>\n" +
                C.build(s, { target: "web" }).html);
    });
    if (!html.length) return {};
    return {
      "signatures.md": md.join("\n"),
      "signatures.html": '<!DOCTYPE html>\n<html lang="' + code + '">\n<head>\n<meta charset="utf-8">\n<title>' +
        C.esc(T.title) + '</title>\n</head>\n<body style="margin:0;padding:16px;background:#ffffff;">\n<p style="font:12px Arial,sans-serif;color:#888888;">' +
        C.esc(T.picsWeb) + "</p>\n" + html.join("\n<hr style=\"border:0;border-top:1px solid #dddddd;margin:24px 0;\">\n") + "\n</body>\n</html>\n"
    };
  }

  var DESC = {
    app: "signature", title: "Email Signature", slice: "signature", ext: ".orossignature",
    mime: "application/x-oros-signature",
    colls: { sigs: { shape: "array", id: "id", stamp: "m" } },
    norm: norm, strip: strip, tombIds: tombIds, previews: previews,
    merge: function (a, b) { return C.merge(a, b); }
  };

  var api = { DESC: DESC, LIM: LIM, assetIds: assetIds, dropAssets: dropAssets };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrosSignaturePackage = api;
})(this);
