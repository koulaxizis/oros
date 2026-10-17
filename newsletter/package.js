// ============================================================
// orOS Newsletter — .orosnewsletter file (newsletter/package.js,
// window.OrosNewsletterPackage). The descriptor of Newsletter for the
// record apps' kit (../recordpkg.js, docs/oros-bundle.md "Record
// apps"): every list, subscriber, issue, segment, template, RSS feed
// and sending account in one orOS bundle, the issues' pictures in
// media/; opening one ADDS what this device lacks, with its ids. Pure
// (no DOM, no storage), so the app and `node --test` run the same
// code. Needs core.js (window.OrosNewsletterCore; require("./core.js")
// under Node).
//   DESC                     the kit descriptor (no merge: the kit's
//                            plain insert; newsletter.js then saves the
//                            result through its own merge-on-write)
//   DESC.norm(data)          a file's data → the slice's shape through
//                            core.js normalize (every record checked,
//                            typed and capped; subscribers and issues of
//                            unknown lists dropped); a pending subscriber
//                            counts as already asked to confirm, so
//                            opening a file never e-mails anyone
//   DESC.strip(state)        the slice → { ver, chans, lists, subs,
//                            issues, segs, tpls, rss, imgs? }: no
//                            tombstones, no secrets and nothing device-
//                            only: a list's salt (its unsubscribe and
//                            confirm codes come from it) and web form
//                            (relay key, secret, private key), an SMTP
//                            user name (with some providers it is the
//                            API key), the sending progress (sent, lock,
//                            failures), the suppression list (supp: the
//                            fingerprints of deleted addresses, like
//                            tombstones), the email-platform links
//                            (plinks) and which device runs an RSS feed;
//                            an issue that is not a draft or sent is a
//                            draft again, an RSS feed is off
//   DESC.tombIds(state)      the ids of the deleted records
//   DESC.previews(state, l)  subscribers-<list>.csv (core.js subsCsv, the
//                            app's own "Export CSV", formula guard) and
//                            issues.md (readable)
//   imgs                     pictures: { "<disk path>": "<sha256>.jpg|png" },
//                            the media key of each picture an issue or
//                            template names (/internal/Newsletter/)
//   imgPaths(state)          the picture paths the live issues and
//                            templates name
//   normImgs(v)              a file's imgs map, checked
//   kindOf(id, state)        "chans" | "lists" | "subs" | "issues" |
//                            "segs" | "tpls" | "rss" | ""
// ============================================================
(function (root) {
  "use strict";

  var C = typeof module === "object" && module.exports ? require("./core.js") : root.OrosNewsletterCore;

  var COLLS = ["chans", "lists", "subs", "issues", "segs", "tpls", "rss"];
  var IMG_PATH = /^\/internal\/Newsletter\/[A-Za-z0-9._-]{1,80}\.(jpg|png)$/;
  var IMG_KEY = /^[0-9a-f]{64}\.(jpg|png)$/;
  var IMG_MAX = 2000;

  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function live(arr) { return (Array.isArray(arr) ? arr : []).filter(function (x) { return isObj(x) && !x.del; }); }

  function normImgs(v) {
    var out = {}, n = 0;
    if (!isObj(v)) return out;
    Object.keys(v).sort().forEach(function (p) {
      if (n >= IMG_MAX || !IMG_PATH.test(p) || typeof v[p] !== "string" || !IMG_KEY.test(v[p])) return;
      // the key's type follows the path's
      if (p.slice(-3) !== v[p].slice(-3)) return;
      out[p] = v[p];
      n++;
    });
    return out;
  }

  function norm(data) {
    if (!isObj(data)) return null;
    var out = C.normalize(data);
    // opening a file never sends a confirmation request by itself
    out.subs.forEach(function (s) {
      if (!s.del && C.status(s) === "pend" && s.inv < s.at) s.inv = s.at;
    });
    var imgs = normImgs(data.imgs);
    if (Object.keys(imgs).length) out.imgs = imgs;
    return out;
  }

  function strip(state) {
    var s = isObj(state) ? clone(state) : {};
    var out = { ver: 1 };
    COLLS.forEach(function (k) { out[k] = live(s[k]); });
    out.chans.forEach(function (ch) { ch.user = ""; });
    out.lists.forEach(function (l) { delete l.salt; delete l.form; });
    out.issues.forEach(function (x) {
      if (x.st !== "draft" && x.st !== "sent") { x.st = "draft"; x.when = 0; x.start = 0; x.n = 0; }
      x.lock = null;
      if (x.st === "draft") { x.fail = {}; x.err = ""; }
    });
    out.rss.forEach(function (r) { r.dev = ""; r.on = 0; });
    var imgs = normImgs(s.imgs);
    if (Object.keys(imgs).length) out.imgs = imgs;
    return out;
  }

  function tombIds(state) {
    var out = [];
    if (!isObj(state)) return out;
    COLLS.forEach(function (k) {
      (Array.isArray(state[k]) ? state[k] : []).forEach(function (x) { if (isObj(x) && x.del && typeof x.id === "string") out.push(x.id); });
    });
    return out;
  }

  // The pictures an issue or template names (its other-language version too).
  function imgPaths(state) {
    var seen = {}, out = [];
    function blocks(arr) {
      (Array.isArray(arr) ? arr : []).forEach(function (b) {
        if (b && b.k === "img" && typeof b.f === "string" && IMG_PATH.test(b.f) && !seen[b.f]) { seen[b.f] = 1; out.push(b.f); }
      });
    }
    if (!isObj(state)) return out;
    live(state.issues).concat(live(state.tpls)).forEach(function (x) {
      blocks(x.blocks);
      if (isObj(x.l2)) blocks(x.l2.blocks);
    });
    return out;
  }

  function kindOf(id, state) {
    var k = "";
    if (!isObj(state)) return k;
    COLLS.forEach(function (c) {
      if (!k && (Array.isArray(state[c]) ? state[c] : []).some(function (x) { return isObj(x) && x.id === id && !x.del; })) k = c;
    });
    return k;
  }

  // ---------- previews ----------
  // Flat keys, so a pack language (orosI18n, ../i18n.js, browser only)
  // reads the "newsletter" pack. The kit passes "el" or "en".
  var HEADS = ["email", "name", "lang", "tags", "status", "src", "basis", "at", "conf", "left"];
  var WORDS = {
    en: { "pkg.h.email": "E-mail", "pkg.h.name": "Name", "pkg.h.lang": "Language", "pkg.h.tags": "Tags",
          "pkg.h.status": "Status", "pkg.h.src": "Source", "pkg.h.basis": "Basis", "pkg.h.at": "Subscribed",
          "pkg.h.conf": "Confirmed", "pkg.h.left": "Left",
          "pkg.st.on": "active", "pkg.st.pend": "pending", "pkg.st.off": "unsubscribed", "pkg.st.bounce": "bounced",
          "pkg.st.spam": "complaint",
          "pkg.basis.consent": "consent", "pkg.basis.customer": "customer", "pkg.basis.optin": "double opt-in",
          "pkg.title": "Newsletter", "pkg.issues": "Issues", "pkg.draft": "Draft", "pkg.sent": "Sent", "pkg.none": "No issues." },
    el: { "pkg.h.email": "Email", "pkg.h.name": "Όνομα", "pkg.h.lang": "Γλώσσα", "pkg.h.tags": "Ετικέτες",
          "pkg.h.status": "Κατάσταση", "pkg.h.src": "Προέλευση", "pkg.h.basis": "Βάση", "pkg.h.at": "Εγγραφή",
          "pkg.h.conf": "Επιβεβαίωση", "pkg.h.left": "Αποχώρηση",
          "pkg.st.on": "ενεργός", "pkg.st.pend": "σε αναμονή", "pkg.st.off": "αποχώρησε", "pkg.st.bounce": "επιστροφή",
          "pkg.st.spam": "παράπονο",
          "pkg.basis.consent": "συγκατάθεση", "pkg.basis.customer": "πελάτης", "pkg.basis.optin": "διπλή επιβεβαίωση",
          "pkg.title": "Ενημερωτικό δελτίο", "pkg.issues": "Τεύχη", "pkg.draft": "Πρόχειρο", "pkg.sent": "Στάλθηκε", "pkg.none": "Κανένα τεύχος." }
  };
  function words(lang) {
    var code = lang === "el" ? "el" : "en", I = typeof window !== "undefined" && window.orosI18n;
    if (code === "en" && I) { code = I.lang(); if (!WORDS[code]) I.table(WORDS, "newsletter", code); }
    return WORDS[code] || WORDS.en;
  }
  function day(ms) { return ms ? new Date(ms).toISOString().slice(0, 10) : ""; }
  // One line of Markdown: nothing that turns into HTML or a heading.
  function mdText(s) { return String(s || "").replace(/[<>]/g, function (c) { return c === "<" ? "&lt;" : "&gt;"; }); }
  function blocksMd(blocks) {
    var out = [];
    (blocks || []).forEach(function (b) {
      if (b.k === "h") out.push("#### " + mdText(b.t));
      else if (b.k === "p") out.push(mdText(b.t));
      else if (b.k === "btn") out.push(b.href ? "[" + mdText(b.t) + "](" + b.href.replace(/[()\s]/g, encodeURIComponent) + ")" : mdText(b.t));
      else if (b.k === "hr") out.push("---");
      else if (b.k === "cols") { out.push(mdText(b.a)); out.push(mdText(b.b)); }
      else if (b.k === "img" && b.alt) out.push("*" + mdText(b.alt) + "*");
    });
    return out.filter(function (x) { return x !== ""; }).join("\n\n");
  }
  function previews(state, lang) {
    var w = words(lang), out = {}, used = {};
    var W = { heads: HEADS.map(function (k) { return w["pkg.h." + k]; }),
              st: function (k) { return w["pkg.st." + k] || k; },
              basis: function (k) { return w["pkg.basis." + k] || k; } };
    var d = C.normalize(state);
    var lists = C.live(d.lists).slice().sort(function (a, b) { return C.fold(a.name) < C.fold(b.name) ? -1 : 1; });
    lists.forEach(function (l) {
      if (!C.subsOf(d, l.id).length) return;
      var base = "subscribers-" + C.slug(l.name || "list"), name = base, i = 2;
      while (used[name]) name = base + "-" + (i++);
      used[name] = 1;
      out[name + ".csv"] = C.subsCsv(d, l.id, W.heads, W.st, W.basis);
    });
    var md = ["# " + w["pkg.title"] + " · " + w["pkg.issues"], ""], any = false;
    lists.forEach(function (l) {
      var xs = C.live(d.issues).filter(function (x) { return x.list === l.id; })
        .sort(function (a, b) { return (b.done || b.m) - (a.done || a.m); });
      if (!xs.length) return;
      any = true;
      md.push("## " + mdText(l.name || "—"), "");
      xs.forEach(function (x) {
        md.push("### " + mdText(x.subj || "—"), "");
        md.push("*" + (x.st === "sent" ? w["pkg.sent"] + " " + day(x.done) : w["pkg.draft"]) + "*", "");
        if (x.pre) md.push("> " + mdText(x.pre), "");
        var body = x.fmt === "md" ? mdText(x.md) : blocksMd(x.blocks);
        if (body) md.push(body, "");
      });
    });
    if (!any) md.push(w["pkg.none"], "");
    out["issues.md"] = md.join("\n");
    return out;
  }

  var DESC = {
    app: "newsletter", title: "Newsletter", slice: "newsletter", ext: ".orosnewsletter",
    mime: "application/x-oros-newsletter",
    colls: {
      chans: { shape: "array", id: "id", stamp: "m" },
      lists: { shape: "array", id: "id", stamp: "m" },
      subs: { shape: "array", id: "id", stamp: "m" },
      issues: { shape: "array", id: "id", stamp: "m" },
      segs: { shape: "array", id: "id", stamp: "m" },
      tpls: { shape: "array", id: "id", stamp: "m" },
      rss: { shape: "array", id: "id", stamp: "m" }
    },
    norm: norm, strip: strip, tombIds: tombIds, previews: previews
  };

  var api = { DESC: DESC, COLLS: COLLS, kindOf: kindOf, imgPaths: imgPaths, normImgs: normImgs,
              IMG_PATH: IMG_PATH, IMG_KEY: IMG_KEY };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrosNewsletterPackage = api;
})(this);
