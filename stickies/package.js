// ============================================================
// orOS Sticky Notes — .orosstickies file (stickies/package.js,
// window.OrosStickiesPackage). The descriptor of Sticky Notes for the
// record apps' kit (../recordpkg.js, docs/oros-bundle.md "Record
// apps"): every note on the desktop in one orOS bundle; opening one
// ADDS the notes this device lacks, with their ids. Pure (no DOM, no
// storage), so the app and `node --test` run the same code.
//   DESC                     the kit descriptor (no merge: the kit's
//                            plain insert; the shell's host.js then runs
//                            the result through StickiesCore.merge and
//                            its own commit, so sync carries it)
//   DESC.norm(data)          a file's data → { ver, notes } with
//                            StickiesCore.normNote's checks, live notes
//                            only, at most MAX_NOTES
//   DESC.strip(state)        the slice → { ver, notes }: no tombstones
//                            (tombs), no faded notes (the Faded bin is
//                            a 7-day wastebasket of this device); each
//                            note carries m = its newest field stamp,
//                            for "Update with newer versions" (merge
//                            drops it again)
//   DESC.tombIds(state)      the ids in state.tombs
//   DESC.previews(state)     notes.txt, the app's "Export as text"
// Where a note sits on the desktop (oros-stickies-pos) is device-local
// and never in the file; neither are the settings.
// ============================================================
(function (root) {
  "use strict";

  var C = typeof module === "object" && module.exports ? require("./core.js") : root.StickiesCore;

  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }

  // One note as the file carries it: canonical + m (newest stamp).
  function withM(raw) {
    var n = C.normNote(raw);
    if (!n || n.faded) return null;
    var out = JSON.parse(JSON.stringify(n));
    out.m = C.mtime(n);
    return out;
  }
  function notesOf(list) {
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (raw) {
      if (out.length >= C.MAX_NOTES) return;
      var n = withM(raw);
      if (n) out.push(n);
    });
    return out;
  }
  function norm(data) {
    if (!isObj(data)) return null;
    var out = { ver: C.VER, notes: notesOf(data.notes) };
    if (isObj(data.tombs)) out.tombs = data.tombs;      // strip and tombIds see it, then it goes
    return out;
  }
  function strip(state) {
    var s = isObj(state) ? state : {};
    return { ver: C.VER, notes: notesOf(s.notes) };
  }
  function tombIds(state) {
    return isObj(state) && isObj(state.tombs) ? Object.keys(state.tombs) : [];
  }
  // The note list with an m on each (the kit's update compare); the
  // shell's slice as it is, tombs and faded notes kept.
  function stamped(state) {
    var s = isObj(state) ? JSON.parse(JSON.stringify(state)) : C.empty();
    (Array.isArray(s.notes) ? s.notes : []).forEach(function (n) {
      if (isObj(n) && isObj(n.fm)) n.m = C.mtime(n);
    });
    return s;
  }

  function previews(state) {
    if (!C.live(state).length) return {};
    return { "notes.txt": C.toText(state) };
  }

  var DESC = {
    app: "stickies", title: "Sticky Notes", slice: "stickies", ext: ".orosstickies", mime: "application/x-oros-stickies",
    colls: {
      notes: { shape: "array", id: "id", stamp: "m", clampIn: ["fm"] }
    },
    norm: norm, strip: strip, tombIds: tombIds, previews: previews
  };

  var api = { DESC: DESC, stamped: stamped };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrosStickiesPackage = api;
})(this);
