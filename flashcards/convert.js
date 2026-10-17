/* ============================================================
   convert.js — orOS Flashcards' side of the orOS Converter
   (OrosConvert.flashcards). An Anki package (.apkg / .colpkg, old
   and new format) -> an .oroscards file (package.js), read by the
   same code as Flashcards' own Import (anki.js + sqlite.js, zip.js,
   fzstd; nothing from a CDN): the same note ids (from the Anki
   guid, so opening the file twice adds nothing), the same media,
   the same answers (history), the same deck tree. Deck ids come
   from the deck path, so converting the same package twice gives
   the same decks.
   Pictures and sounds are stored as they are, named by their hash;
   Flashcards redraws every picture when it opens the file.
   Loading this file boots nothing: no DOM, no storage, no sync.
   UMD: window.OrosConvert.flashcards, module.exports in Node.
   ============================================================ */
(function (root) {
"use strict";

var FROM = [".apkg", ".colpkg"];
var MAX_BYTES = 300 * 1024 * 1024;

var STR = {
  en: { "cv.bad": "Could not read this Anki package", "cv.unsupported": "Not an Anki package (.apkg or .colpkg)",
        "cv.toobig": "The file is too big (over {n} MB)", "cv.empty": "This package has no cards",
        "cv.many": "Only the first {n} notes were read", "cv.media": "{m} pictures or sounds could not be read" },
  el: { "cv.bad": "Αδύνατη η ανάγνωση του πακέτου Anki",
        "cv.unsupported": "Δεν είναι πακέτο Anki (.apkg ή .colpkg)",
        "cv.toobig": "Το αρχείο είναι πολύ μεγάλο (πάνω από {n} MB)",
        "cv.empty": "Αυτό το πακέτο δεν έχει κάρτες",
        "cv.many": "Διαβάστηκαν μόνο οι πρώτες {n} σημειώσεις",
        "cv.media": "{m} εικόνες ή ήχοι δεν διαβάστηκαν" }
};

/* the helper scripts / libraries: global in the page (loaded from
   deps by the Converter), require() in Node */
function lib(name, path) {
  if (root && root[name]) return root[name];
  if (typeof require === "function") {
    try { return require(path); } catch (e) {}
  }
  return null;
}
function libs() {
  return {
    Z: lib("AtelierZip", "../atelier/zip.js"),
    zstd: lib("fzstd", "../vendor/fzstd/fzstd.umd.js"),
    S: lib("FlashcardsSqlite", "./sqlite.js"),
    A: lib("FlashcardsAnki", "./anki.js"),
    C: lib("FlashcardsCore", "./core.js"),
    P: lib("FlashcardsPackage", "./package.js"),
    B: lib("OrosBundle", "../bundle.js")
  };
}

function fail(code, msg) { var e = new Error(msg || code); e.code = code; return e; }
function extOf(name) { var m = /\.[^.\/\\]+$/.exec(String(name || "")); return m ? m[0].toLowerCase() : ""; }
function baseOf(name) {
  var s = String(name || "").replace(/^.*[\/\\]/, "").replace(/\.[^.]+$/, "").trim();
  return s || "Flashcards";
}
function bytesOf(file) {
  if (file && typeof file.arrayBuffer === "function") return file.arrayBuffer();
  return Promise.reject(fail("bad"));
}
/* a stable deck id from its path (two FNV-1a hashes, base 36) */
function fnv(s, h) {
  for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
function deckIdFor(path) {
  var s = path.join("\u001f");
  return "d" + fnv(s, 2166136261).toString(36) + fnv(s, 3166136261).toString(36);
}

function convert(file, opts) {
  opts = opts || {};
  var lang = opts.lang === "el" ? "el" : "en", S = STR[lang];
  var prog = typeof opts.onProgress === "function" ? opts.onProgress : function () {};
  function step(x) { try { prog(x); } catch (e) {} }
  return Promise.resolve().then(function () {
    var ext = extOf(file && file.name);
    if (!file || FROM.indexOf(ext) < 0) throw fail("unsupported", S["cv.unsupported"]);
    if (typeof file.size === "number" && file.size > MAX_BYTES)
      throw fail("toobig", S["cv.toobig"].replace("{n}", MAX_BYTES / 1048576));
    var L = libs();
    if (!L.Z || !L.zstd || !L.S || !L.A || !L.C || !L.P || !L.B) throw fail("bad", "missing deps");
    var A = L.A, C = L.C, P = L.P, B = L.B, base = baseOf(file.name), warnings = [];
    step(0.05);
    return bytesOf(file).then(function (buf) {
      step(0.15);
      return A.readPackage(new Uint8Array(buf), { zip: L.Z, sqlite: L.S, zstd: L.zstd }).then(null, function (e) {
        throw fail("bad", S["cv.bad"] + (e && e.message ? " (" + e.message + ")" : ""));
      });
    }).then(function (model) {
      if (model.notes.length >= A.MAX_NOTES) warnings.push(S["cv.many"].replace("{n}", A.MAX_NOTES));
      var items = A.convert(model);
      if (!items.length) throw fail("bad", S["cv.empty"]);
      step(0.3);
      // Pictures and sounds, one at a time, named by their hash.
      var files = A.mediaUsed(items), map = {}, media = {}, failed = 0, i = 0;
      function nextMedia() {
        if (i >= files.length) return Promise.resolve();
        var name = files[i++];
        step(0.3 + 0.5 * i / files.length);
        return Promise.resolve(model.readMedia(name)).then(function (data) {
          var mext = C.mediaExt("", name);
          if (!data || !mext) { failed++; return; }
          return B.sha256(data).then(function (h) {
            var key = h + "." + mext;
            map[name] = key;
            media[key] = data;
          });
        }).then(null, function () { failed++; }).then(nextMedia);
      }
      return nextMedia().then(function () {
        if (failed) warnings.push(S["cv.media"].replace("{m}", failed));
        var now = Date.now(), decks = {}, slice = C.empty();
        function deckId(path) {
          if (!path.length || (path.length === 1 && path[0] === "Default")) path = [base];
          var par = "";
          path.slice(0, 12).forEach(function (part, k) {
            var name = String(part).replace(/\s+/g, " ").trim().slice(0, C.LIMITS.name) || "…";
            var id = deckIdFor(path.slice(0, k + 1));
            if (!decks[id] && Object.keys(decks).length < C.LIMITS.decks) {
              decks[id] = 1;
              slice = C.addDeck(slice, name, now, { id: id, par: par || undefined });
            }
            if (decks[id]) par = id;
          });
          return par || C.DEFAULT_DECK;
        }
        var p = A.plan(model, items, { now: now, deckId: deckId, existing: {}, media: map, history: true });
        var notes = p.notes.map(C.normNote).filter(Boolean);
        var content = { kind: P.KIND, ver: P.VER, at: now, decks: C.normalize(slice).decks, notes: notes,
                        reviews: C.mergeReviews(p.rows, []) };
        // Only the media the notes still use.
        var used = C.mediaInUse(C.foldNotes({}, notes)), keep = {};
        Object.keys(media).forEach(function (k) { if (used[k]) keep[k] = media[k]; });
        step(0.85);
        return B.write({
          mime: P.MIME, app: "flashcards", schema: "flashcards/1", content: content,
          meta: { title: base, language: lang },
          media: keep,
          preview: [{ name: "cards.csv", data: P.csv(C, content, slice), type: "text/csv" }]
        });
      });
    }).then(function (bytes) {
      step(1);
      return { blob: new Blob([bytes], { type: P.MIME }), name: base + P.EXT, warnings: warnings };
    });
  });
}

var API = {
  app: "flashcards", to: ".oroscards", mime: "application/x-oros-cards",
  from: FROM.slice(),
  deps: ["atelier/zip.js", "vendor/fzstd/fzstd.umd.js", "flashcards/sqlite.js", "flashcards/anki.js",
         "flashcards/core.js", "flashcards/package.js", "bundle.js"],
  maxBytes: MAX_BYTES,
  convert: convert,
  _deckIdFor: deckIdFor         /* for the Node tests */
};
if (root) {
  root.OrosConvert = root.OrosConvert || {};
  root.OrosConvert.flashcards = API;
}
if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : (typeof self !== "undefined" ? self : this));
