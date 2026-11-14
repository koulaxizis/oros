// ============================================================
// orOS Assistant — claudefiles.js: Claude's folders on the orOS disk
// (GATE-FILES wave F1, 2026-11-13, Chris's cards: «Στο Dropbox σου»,
// «7 μέρες», orOS Drive mirror, all 8 folders and more, «Προχώρα»)
// ------------------------------------------------------------
// The files tools (files_list, files_read, files_write, files_move,
// files_delete) work only inside the folders the owner marks in
// Settings › Connected services › orOS Gate › Claude's folders, for
// the Assistant and for Claude through orOS Gate alike (GATE-PAR).
//   · reach(path, folders)   "" or why a path is out of reach
//   · secret(path)           names that look like keys are never shown
//   · plan*(…)               what a call would do, checked
//   · run(fs, steps, verOf)  carried out, every step re-checked first
//   · undo(fs, done, verOf)  taken back while nothing changed since
// Nothing is ever overwritten blindly: a replace, move or delete needs
// the version the caller read (if_version, the first 16 hex of the
// content's SHA-256), and the old content goes to Files' Trash
// (files-core.js layout, restorable for 30 days) so Undo can bring it
// back on any device. A delete is a move to Files' Trash, asked on the
// device every time (never skipped through the gate).
// Pure: the disk (stat, ls, mv, mkdir, rm, write, writeText) and the
// version of a file come in as arguments, so Node tests run it on a
// fake disk. window.OrosClaudeFiles (browser) or module.exports (node).
// ============================================================
(function (root) {
  "use strict";
  var ROOT = "/internal", TRASH = ROOT + "/.trash";
  var FOLDERS_MAX = 50, LIST_MAX = 200, DEPTH_MAX = 3, READ_MAX = 100000, WRITE_BYTES = 1048576, PATHS_MAX = 50;
  var BAD = /[\\/:*?"<>|\u0000-\u001f]/;
  // Names that look like keys or secrets: never listed, read or written,
  // whatever folder they are in (the list only grows).
  var SECRET_FILE = /(^\.env)|(^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$)|(\.(kdbx|kdb|pem|key|p12|pfx|jks|keystore|asc|gpg|ovpn|ppk)$)/i;
  var SECRET_DIR = ["keys", "secrets", ".ssh", ".gnupg", "ασφαλεια", "κλειδια", "κωδικοι", "passwords"];   // i18n-inline-ok: folder names matched, never shown
  var TEXT = { txt: 1, md: 1, markdown: 1, csv: 1, tsv: 1, json: 1, xml: 1, html: 1, htm: 1, yaml: 1, yml: 1, ini: 1, log: 1,
               srt: 1, vtt: 1, lrc: 1, tex: 1, svg: 1, js: 1, css: 1, ics: 1, vcf: 1, eml: 1 };
  var DOC = { docx: 1, docm: 1, dotx: 1, doc: 1, odt: 1, ott: 1, rtf: 1, pptx: 1, odp: 1, xlsx: 1, xlsm: 1, xls: 1, ods: 1, epub: 1 };
  var IMAGE = { jpg: 1, jpeg: 1, png: 1, webp: 1, gif: 1, bmp: 1, tif: 1, tiff: 1, heic: 1, avif: 1 };
  var MEDIA = { wav: 1, mp3: 1, flac: 1, ogg: 1, oga: 1, opus: 1, m4a: 1, aac: 1, aif: 1, aiff: 1, mp4: 1, mov: 1, mkv: 1, webm: 1, avi: 1, m4v: 1 };

  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function bad(msg) { return { ok: false, err: msg }; }
  function baseName(p) { return String(p).slice(String(p).lastIndexOf("/") + 1); }
  function parentOf(p) { var i = String(p).lastIndexOf("/"); return i > 0 ? p.slice(0, i) : "/"; }
  function fold(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/ς/g, "σ").trim(); }
  function show(p) { return String(p).replace(/^\/internal\/?/, "") || "/"; }
  function extOf(n) { var i = String(n).lastIndexOf("."); return i > 0 ? String(n).slice(i + 1).toLowerCase() : ""; }
  function under(p, dir) { return p === dir || p.indexOf(dir + "/") === 0; }

  // "Τιμολόγια", "Drive/ckdesktop/Τιμολόγια", "/internal/…", "a › b",
  // "a\b" → "/internal/…" | "" (not a valid path on the disk)
  function normPath(f) {
    var s = String(f == null ? "" : f).normalize("NFC").trim().replace(/\s*›\s*/g, "/").replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
    if (!s) return "";
    if (s !== ROOT && s.indexOf(ROOT + "/") !== 0) s = ROOT + "/" + s.replace(/^\/+/, "");
    if (s.length > 1024) return "";
    var segs = s.slice(ROOT.length + 1).split("/");
    if (s === ROOT) return ROOT;
    for (var i = 0; i < segs.length; i++) {
      if (!segs[i] || segs[i] === "." || segs[i] === ".." || segs[i].charAt(0) === ".") return "";
      if (/[\u0000-\u001f]/.test(segs[i])) return "";
    }
    return s;
  }
  // The owner's folder list: valid, not the disk itself, not inside the
  // Trash, sorted, no folder inside another one on the list, ≤ 50.
  function cleanFolders(list) {
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (f) {
      var p = normPath(f);
      if (!p || p === ROOT || out.indexOf(p) >= 0 || secret(p)) return;
      out.push(p);
    });
    out.sort();
    out = out.filter(function (p) { return !out.some(function (q) { return q !== p && under(p, q); }); });
    return out.slice(0, FOLDERS_MAX);
  }
  function secret(p) {
    var segs = String(p).replace(/^\/internal\/?/, "").split("/");
    for (var i = 0; i < segs.length; i++) if (SECRET_DIR.indexOf(fold(segs[i])) >= 0) return true;
    return SECRET_FILE.test(baseName(p));
  }
  // "" = the path is inside one of the owner's folders and may be used.
  function reach(p, folders) {
    if (!p) return "That is not a valid path on the orOS disk.";
    if (!folders.length) return "The owner has not marked any folder for Claude yet (orOS › Settings › Connected services › orOS Gate › Claude's folders).";
    if (secret(p)) return "\"" + show(p) + "\" looks like a key or a secret; it is never shown.";
    if (!folders.some(function (f) { return under(p, f); })) return "\"" + show(p) + "\" is outside the folders the owner lets Claude use: " + folders.map(show).join(", ") + ".";
    return "";
  }
  function kindOf(name) {
    var e = extOf(name);
    if (e === "pdf") return "pdf";
    if (DOC[e]) return "document";
    if (TEXT[e]) return "text";
    if (IMAGE[e]) return "image";
    if (MEDIA[e]) return "media";
    return e ? "other" : "text";
  }
  function validName(n) {
    if (typeof n !== "string") return "The name must be text.";
    n = n.trim();
    if (!n) return "The name must not be empty.";
    if (n.length > 255) return "The name is " + n.length + " characters; the most is 255.";
    if (BAD.test(n)) return "A name can't have any of \\ / : * ? \" < > |.";
    if (n.charAt(0) === ".") return "A name can't start with a dot.";
    return "";
  }
  function ver(hex) { return typeof hex === "string" && /^[0-9a-f]{16,64}$/i.test(hex) ? hex.slice(0, 16).toLowerCase() : ""; }
  function iso(ms) { return typeof ms === "number" && ms > 0 ? new Date(ms).toISOString() : undefined; }

  // A page of text: offset and length in characters.
  function page(text, offset, length) {
    var s = String(text || ""), o = Math.max(0, Math.floor(Number(offset) || 0)), n = Math.floor(Number(length) || READ_MAX);
    n = Math.max(1, Math.min(READ_MAX, n));
    var part = s.slice(o, o + n), next = o + part.length;
    return { text: part, offset: o, total: s.length, next_offset: next < s.length ? next : null };
  }

  // files_list. rows: [{ path, dir, size, mtime, cloud }] (the folder's
  // tree as the caller walked it). → the answer object
  function listOut(path, rows, folders, offset) {
    var o = Math.max(0, Math.floor(Number(offset) || 0));
    var vis = rows.filter(function (r) { return !secret(r.path); }).sort(function (a, b) {
      return a.dir !== b.dir ? (a.dir ? -1 : 1) : a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
    });
    var part = vis.slice(o, o + LIST_MAX);
    return {
      path: show(path), folders: folders.map(show),
      entries: part.map(function (r) {
        var e = { name: r.path.slice(path.length + 1), kind: r.dir ? "folder" : kindOf(r.path) };
        if (!r.dir) { e.size = r.size || 0; var m = iso(r.mtime); if (m) e.modified = m; }
        if (r.cloud) e.on_device = false;
        return e;
      }),
      total: vis.length, offset: o, next_offset: o + part.length < vis.length ? o + part.length : null
    };
  }

  // a = { path, text, mode: "create" | "replace", if_version }; cur =
  // { st (stat or null), v (its version) }. → { ok, step } | bad
  function planWrite(a, cur, folders, now, rnd) {
    a = isObj(a) ? a : {};
    var p = normPath(a.path), why = reach(p, folders);
    if (why) return bad(why);
    if (typeof a.text !== "string") return bad("text must be the file's whole new content (text only; at most 1 MB).");
    var bytes = utf8Len(a.text);
    if (bytes > WRITE_BYTES) return bad("The text is " + bytes + " bytes; files_write takes at most " + WRITE_BYTES + " (1 MB).");
    var e = validName(baseName(p));
    if (e) return bad(e);
    var mode = a.mode === "replace" ? "replace" : a.mode === "create" || a.mode == null || a.mode === "" ? "create" : "";
    if (!mode) return bad("mode must be create or replace.");
    if (folders.indexOf(p) >= 0) return bad("\"" + show(p) + "\" is one of Claude's folders itself, not a file.");
    var st = cur && cur.st;
    if (mode === "create") {
      if (st) return bad("\"" + show(p) + "\" already exists" + (st.dir ? " (a folder)" : " (version " + (cur.v || "?") + ")") + ". Use mode replace with its if_version, or another name.");
      return { ok: true, step: { k: "make", path: p, text: a.text } };
    }
    if (!st) return bad("\"" + show(p) + "\" is not there to replace. Use mode create.");
    if (st.dir) return bad("\"" + show(p) + "\" is a folder.");
    var want = ver(a.if_version);
    if (!want) return bad("mode replace needs if_version: the version files_read or files_list gave for \"" + show(p) + "\".");
    if (want !== cur.v) return bad("\"" + show(p) + "\" changed since that version (now " + cur.v + "). Read it again; nothing was written.");
    return { ok: true, step: { k: "replace", path: p, text: a.text, was: { size: st.size, mtime: st.mtime || 0 }, v: cur.v, trash: trashOf(p, false, now, rnd, 0) } };
  }
  // a = { from, to, if_version }; cur = { st, v } of from; dest = stat of to or null
  function planMove(a, cur, dest, folders) {
    a = isObj(a) ? a : {};
    var f = normPath(a.from), t = normPath(a.to), why = reach(f, folders) || reach(t, folders);
    if (why) return bad(why);
    if (folders.indexOf(f) >= 0) return bad("\"" + show(f) + "\" is one of Claude's folders; the owner moves it.");
    var e = validName(baseName(t));
    if (e) return bad(e);
    var st = cur && cur.st;
    if (!st) return bad("\"" + show(f) + "\" is not there.");
    if (f === t) return bad("from and to are the same.");
    if (under(t, f)) return bad("A folder can't go inside itself.");
    if (dest) return bad("\"" + show(t) + "\" is taken; nothing is ever overwritten. Pick another name.");
    if (!st.dir) {
      var want = ver(a.if_version);
      if (!want) return bad("files_move needs if_version: the version files_read or files_list gave for \"" + show(f) + "\".");
      if (want !== cur.v) return bad("\"" + show(f) + "\" changed since that version (now " + cur.v + "). Nothing was moved.");
    }
    return { ok: true, step: { k: "mv", from: f, to: t, dir: !!st.dir, was: { size: st.size, mtime: st.mtime || 0 }, v: cur.v || "" } };
  }
  // items = [{ path, st, v, want }] → { ok, steps, names } | bad
  function planDelete(items, folders, now, rnd) {
    if (!Array.isArray(items) || !items.length) return bad("paths: at least one file or folder.");
    if (items.length > PATHS_MAX) return bad("At most " + PATHS_MAX + " at a time.");
    var steps = [], names = [], seen = {};
    for (var i = 0; i < items.length; i++) {
      var it = items[i], p = it.path, why = reach(p, folders);
      if (why) return bad(why);
      if (folders.indexOf(p) >= 0) return bad("\"" + show(p) + "\" is one of Claude's folders; the owner removes it.");
      if (seen[p]) continue;
      seen[p] = 1;
      if (!it.st) return bad("\"" + show(p) + "\" is not there.");
      if (!it.st.dir) {
        var want = ver(it.want);
        if (!want) return bad("Each file needs its if_version (from files_read or files_list): \"" + show(p) + "\" has none.");
        if (want !== it.v) return bad("\"" + show(p) + "\" changed since that version (now " + it.v + "). Nothing was deleted.");
      }
      var tr = trashOf(p, !!it.st.dir, now, rnd, i);
      steps.push({ k: "trash", from: p, dir: !!it.st.dir, was: { size: it.st.size, mtime: it.st.mtime || 0 }, v: it.v || "", trash: tr });
      names.push(show(p));
    }
    return { ok: true, steps: steps, names: names };
  }
  // Files' Trash (files-core.js): /internal/.trash/<id>.json + <id>/<name>
  function trashOf(p, dir, now, rnd, i) {
    var t = Math.max(0, Math.floor(now || 0)).toString(36);
    while (t.length < 9) t = "0" + t;
    var r = (String(rnd ? rnd(i) : Math.random().toString(36).slice(2, 10)).toLowerCase().replace(/[^0-9a-z]/g, "") + "000000").slice(0, 8);
    var id = t + "-" + r;
    return { id: id, meta: TRASH + "/" + id + ".json", to: TRASH + "/" + id + "/" + baseName(p),
             rec: { v: 1, path: p, name: baseName(p), dir: !!dir, at: Math.floor(now || 0) } };
  }
  function utf8Len(s) {
    var n = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) n += 1; else if (c < 0x800) n += 2;
      else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; } else n += 3;
    }
    return n;
  }

  function statOf(fs, p) { return Promise.resolve().then(function () { return fs.stat(p); }).then(function (s) { return s || null; }, function () { return null; }); }
  function same(st, was) { return !!st && !st.dir && st.size === was.size && (st.mtime || 0) === (was.mtime || 0); }
  function toTrash(fs, from, tr) {
    return Promise.resolve(fs.writeText(tr.meta, JSON.stringify(tr.rec))).then(function () {
      return Promise.resolve(fs.mv(from, tr.to)).catch(function (e) {
        return Promise.resolve(fs.rm(tr.meta)).catch(function () {}).then(function () { throw e; });
      });
    });
  }
  function fromTrash(fs, meta, from, to) {
    return Promise.resolve(fs.mv(from, to)).then(function () {
      return Promise.resolve(fs.rm(meta)).catch(function () {}).then(function () { return Promise.resolve(fs.rm(parentOf(from))).catch(function () {}); });
    });
  }
  // Carry the steps out, one after the other; each is re-checked right
  // before it runs (still the version planned, the target still free).
  // verOf(path) → Promise<version>. → Promise<{ done: [undo record], fail }>
  function run(fs, steps, verOf) {
    var done = [], fail = "";
    return steps.reduce(function (pr, x) {
      return pr.then(function () {
        if (fail) return;
        var chk;
        if (x.k === "make") chk = statOf(fs, x.path).then(function (s) { return s ? "\"" + show(x.path) + "\" appeared meanwhile; nothing was overwritten." : ""; });
        else if (x.k === "mv") chk = Promise.all([statOf(fs, x.from), statOf(fs, x.to)]).then(function (r) {
          if (!r[0] || (!x.dir && !same(r[0], x.was))) return "\"" + show(x.from) + "\" changed or moved meanwhile; it was left as it is.";
          return r[1] ? "\"" + show(x.to) + "\" is taken now; nothing was overwritten." : "";
        });
        else chk = statOf(fs, x.k === "trash" ? x.from : x.path).then(function (s) {
          var p = x.k === "trash" ? x.from : x.path;
          if (!s || (!x.dir && !same(s, x.was))) return "\"" + show(p) + "\" changed or moved meanwhile; it was left as it is.";
          return x.dir ? "" : verOf(p).then(function (v) { return v === x.v ? "" : "\"" + show(p) + "\" changed meanwhile; it was left as it is."; });
        });
        return chk.then(function (why) {
          if (why) { fail = why; return; }
          if (x.k === "make") {
            return Promise.resolve(fs.writeText(x.path, x.text)).then(function () { return Promise.all([statOf(fs, x.path), verOf(x.path)]); })
              .then(function (r) { done.push({ k: "unmake", path: x.path, st: r[0], v: r[1] }); });
          }
          if (x.k === "replace") {
            return toTrash(fs, x.path, x.trash).then(function () {
              return Promise.resolve(fs.writeText(x.path, x.text)).catch(function (e) {
                // could not write the new content: the old one comes back
                return fromTrash(fs, x.trash.meta, x.trash.to, x.path).then(function () { throw e; });
              });
            }).then(function () { return Promise.all([statOf(fs, x.path), verOf(x.path)]); })
              .then(function (r) { done.push({ k: "unreplace", path: x.path, st: r[0], v: r[1], meta: x.trash.meta, old: x.trash.to }); });
          }
          if (x.k === "mv") {
            return Promise.resolve(fs.mv(x.from, x.to)).then(function () { return statOf(fs, x.to); })
              .then(function (st) { done.push({ k: "mv", from: x.to, to: x.from, dir: x.dir, st: st }); });
          }
          return toTrash(fs, x.from, x.trash).then(function () { return statOf(fs, x.trash.to); })
            .then(function (st) { done.push({ k: "untrash", from: x.trash.to, to: x.from, meta: x.trash.meta, dir: x.dir, st: st }); });
        }).catch(function () { fail = fail || "The disk refused \"" + show(x.path || x.from) + "\"; it was left as it is."; });
      });
    }, Promise.resolve()).then(function () { return { done: done, fail: fail }; });
  }

  // Undo the done list (newest first), all checked before any runs:
  // a file Claude made or replaced only while it is still exactly what
  // Claude wrote; a move or delete only while the old place is free.
  function undo(fs, done, verOf, now, rnd) {
    if (!Array.isArray(done) || !done.length) return Promise.resolve(bad("Nothing to undo."));
    var list = done.slice().reverse();
    return Promise.all(list.map(function (u) {
      if (u.k === "unmake" || u.k === "unreplace") {
        return Promise.all([statOf(fs, u.path), u.k === "unreplace" ? statOf(fs, u.old) : Promise.resolve(true)]).then(function (r) {
          if (!r[0] || r[0].dir) return "\"" + show(u.path) + "\" is gone; nothing was undone.";
          if (!r[1]) return "The old version of \"" + show(u.path) + "\" is no longer in Files' Trash; nothing was undone.";
          return verOf(u.path).then(function (v) { return v === u.v ? "" : "\"" + show(u.path) + "\" changed since; nothing was undone."; });
        });
      }
      return Promise.all([statOf(fs, u.from), statOf(fs, u.to)]).then(function (r) {
        if (!r[0] || (!u.dir && !(r[0].size === (u.st && u.st.size)))) return "\"" + show(u.from) + "\" changed or moved since; nothing was undone.";
        return r[1] ? "\"" + show(u.to) + "\" is taken now; nothing was undone." : "";
      });
    })).then(function (why) {
      var w = why.filter(Boolean);
      if (w.length) return bad(w[0]);
      return list.reduce(function (pr, u, i) {
        return pr.then(function () {
          // what Claude wrote goes to Files' Trash too (never removed outright)
          if (u.k === "unmake") return toTrash(fs, u.path, trashOf(u.path, false, now, rnd, i));
          if (u.k === "unreplace") return toTrash(fs, u.path, trashOf(u.path, false, now, rnd, i)).then(function () { return fromTrash(fs, u.meta, u.old, u.path); });
          if (u.k === "untrash") return fromTrash(fs, u.meta, u.from, u.to);
          return fs.mv(u.from, u.to);
        });
      }, Promise.resolve()).then(function () { return { ok: true, n: list.length }; }, function () { return bad("The disk refused part of the undo."); });
    });
  }

  var api = { ROOT: ROOT, TRASH: TRASH, FOLDERS_MAX: FOLDERS_MAX, LIST_MAX: LIST_MAX, DEPTH_MAX: DEPTH_MAX, READ_MAX: READ_MAX, WRITE_BYTES: WRITE_BYTES, PATHS_MAX: PATHS_MAX,
              normPath: normPath, cleanFolders: cleanFolders, secret: secret, reach: reach, kindOf: kindOf, validName: validName, ver: ver, show: show,
              under: under, page: page, listOut: listOut, planWrite: planWrite, planMove: planMove, planDelete: planDelete, run: run, undo: undo };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosClaudeFiles = api;
})(typeof window !== "undefined" ? window : this);
