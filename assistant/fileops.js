// ============================================================
// orOS Assistant — fileops.js ("Assistant everywhere" wave 6, AS-FILES)
// change_item on files and folders of the orOS disk (refs from Files'
// search): rename (update with title), move (move with folder; a
// folder that is not there yet is made), a new folder inside a folder
// (update with new_folder) and delete = move to Files' Trash, exactly
// as Files' own Delete does (files-core.js: the record
// /internal/.trash/<id>.json first, then the item to
// /internal/.trash/<id>/<name>), so it can be restored from Files'
// Trash for 30 days and Vault Drive carries it to every device as a
// plain disk change, like a change made in Files.
// Never: anything in the Trash, orOS Drive's folder (it has its own
// rules, VD-OD), a dot name, the folders where apps keep their own
// data (APP_ROOTS), or a top-level folder apps write into (KEEP_TOP).
// Nothing is ever overwritten: a name that is taken is refused, and
// right before each step the item is checked again (still there, the
// same size and time as on the card) and the place it goes to is
// checked to be free. A step that fails stops the rest; what was done
// is reported and can be undone. Undo moves things back only while
// they are still where the Assistant put them, unchanged, and their
// old place is free; a new folder is removed only while empty.
// Pure planning (plan) + steps that take the disk as an argument
// (check, run, undo), so the tests run them on a fake disk.
// ============================================================
(function (root) {
  "use strict";
  var NODE = typeof module !== "undefined" && module.exports && typeof require === "function";
  var ROOT = "/internal", TRASH = ROOT + "/.trash";
  var MAX = 50;
  // Top-level folders that apps keep their own data in, by a fixed
  // path (their files are found by path, so moving them breaks the app).
  var APP_ROOTS = ["Drive", "Assets", "Assistant", "Atelier", "Books", "Budget", "CRM", "Diary", "Flashcards", "Garage", "Health",
    "Invoices", "Kanban", "Layout", "Mail", "Maps", "Newsletter", "Notes", "Passwords", "Photo Lab", "Publishing", "Radio", "Rescue",
    "Stock", "Storage", "Studio", "Whiteboard", "Wiki"];
  // Top-level folders apps save into: what is inside may change, the
  // folder itself stays.
  var KEEP_TOP = ["Pictures", "Music", "Videos", "Documents", "Converted"];
  var BAD = /[\\/:*?"<>|\u0000-\u001f]/;

  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function bad(msg) { return { ok: false, err: msg }; }
  function baseName(p) { return String(p).slice(String(p).lastIndexOf("/") + 1); }
  function parentOf(p) { var i = String(p).lastIndexOf("/"); return i > 0 ? p.slice(0, i) : "/"; }
  function segs(p) { return String(p).slice(ROOT.length + 1).split("/"); }
  function fold(s) { return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\u03c2/g, "\u03c3").trim(); }
  function show(p) { return String(p).replace(/^\/internal\/?/, "") || "/"; }

  // A path the Assistant may change → "" | why not.
  function blocked(p, what) {
    if (typeof p !== "string" || p.indexOf(ROOT + "/") !== 0 || p.length > 4096) return what + " is not on the orOS disk.";
    var s = segs(p);
    for (var i = 0; i < s.length; i++) {
      if (!s[i] || s[i] === "." || s[i] === "..") return what + " is not a valid path.";
      if (s[i].charAt(0) === ".") return p === TRASH || s[0] === ".trash" ? "Files' Trash is changed in Files." : "Hidden files and folders are changed in Files.";
    }
    var top = fold(s[0]);
    if (top === "drive") return "orOS Drive's folders are changed in Files › orOS Drive (they follow their own rules).";
    if (APP_ROOTS.some(function (n) { return fold(n) === top; })) return "\"" + s[0] + "\" is where an app keeps its own data; change it in that app.";
    return "";
  }
  function validName(n) {
    if (typeof n !== "string") return "The name must be text.";
    n = n.trim();
    if (!n) return "The name must not be empty.";
    if (n.length > 255) return "The name is " + n.length + " characters; the most is 255.";
    if (BAD.test(n)) return "A name can't have any of \\ / : * ? \" < > |.";
    if (n === "." || n === ".." || n.charAt(0) === ".") return "A name can't start with a dot.";
    return "";
  }
  // "Pictures/2024", "/internal/Pictures/2024", "Pictures › 2024" → path
  function folderPath(f) {
    var s = String(f || "").trim().replace(/\s*›\s*/g, "/").replace(/\\/g, "/").replace(/\/+$/, "");
    if (!s) return "";
    if (s.indexOf(ROOT + "/") === 0 || s === ROOT) return s;
    return ROOT + "/" + s.replace(/^\/+/, "");
  }
  function extOf(n) { var i = n.lastIndexOf("."); return i > 0 ? n.slice(i) : ""; }

  // ch = edits.js normArgs() result (action, set). items = [{ path, dir, st }]
  // where st = what stat() said (null = gone). taken(dir) → names in dir
  // ([] when the folder is not there). → { ok, steps, rows: [{ title, rows }] } | { ok:false, err }
  function plan(items, ch, taken, now, rnd) {
    if (!Array.isArray(items) || !items.length) return bad("No file or folder given.");
    if (items.length > MAX) return bad("At most " + MAX + " files and folders at a time.");
    var a = ch.action, s = ch.set || {}, steps = [], cards = [], dest = {};
    var keys = Object.keys(s);
    if (a === "update" && keys.length === 1 && keys[0] === "new_folder") a = "mkdir";
    else if (a === "update" && !(keys.length === 1 && keys[0] === "title")) return bad("For a file or folder, update takes title (a new name) or new_folder (a folder to make inside it).");
    else if (a === "move" && !(keys.length === 1 && keys[0] === "folder")) return bad("move takes folder: the folder it goes to, e.g. Pictures/2024.");
    else if (a !== "update" && a !== "move" && a !== "delete") return bad("Files and folders can be renamed (update with title), moved (move with folder), deleted (to Files' Trash) or get a new folder (update with new_folder).");
    if (a === "delete" && keys.length) return bad("delete takes only the ref(s).");
    if ((a === "update" || a === "mkdir") && items.length > 1) return bad("Rename or add a folder one at a time.");
    var to = a === "move" ? folderPath(s.folder) : "";
    if (a === "move") {
      var why = blocked(to, "That folder");
      if (why && to !== ROOT) return bad(why);
    }
    for (var i = 0; i < items.length; i++) {
      var it = items[i], p = it && it.path, e;
      if (!it || !it.st) return bad("\"" + show(p) + "\" is no longer on the disk.");
      if ((e = blocked(p, "\"" + show(p) + "\""))) return bad(e);
      var dir = !!it.st.dir, name = baseName(p), top = segs(p).length === 1;
      if (top && KEEP_TOP.some(function (n) { return fold(n) === fold(name); }) && a !== "mkdir") return bad("\"" + name + "\" is a folder apps save into; it stays where it is (what is inside can move).");
      if (a === "mkdir") {
        if (!dir) return bad("A new folder goes inside a folder; that is a file.");
        if ((e = validName(s.new_folder))) return bad(e);
        var nn = s.new_folder.trim(), np = p + "/" + nn;
        if (taken(p).indexOf(nn) >= 0) return bad("\"" + show(p) + "\" already has \"" + nn + "\".");
        steps.push({ k: "mkdir", to: np });
        cards.push({ title: nn, rows: [{ f: "folder", b: "", a: show(p) }] });
        continue;
      }
      if (a === "update") {
        if ((e = validName(s.title))) return bad(e);
        var nm = s.title.trim();
        if (!dir && extOf(name) && !extOf(nm)) nm += extOf(name);
        if (nm === name) return bad("Nothing would change: it already has that name.");
        var rp = parentOf(p) + "/" + nm;
        if (taken(parentOf(p)).indexOf(nm) >= 0) return bad("\"" + show(parentOf(p)) + "\" already has \"" + nm + "\"; pick another name.");
        steps.push({ k: "mv", from: p, to: rp, dir: dir, st: it.st });
        cards.push({ title: name, rows: [{ f: "title", b: name, a: nm }] });
        continue;
      }
      if (a === "move") {
        if (to === p || to.indexOf(p + "/") === 0) return bad("A folder can't go inside itself.");
        if (parentOf(p) === to) return bad("\"" + name + "\" is already in \"" + show(to) + "\".");
        var mp = to + "/" + name;
        if (taken(to).indexOf(name) >= 0 || dest[mp]) return bad("\"" + show(to) + "\" already has \"" + name + "\"; rename one first.");
        dest[mp] = 1;
        steps.push({ k: "mv", from: p, to: mp, dir: dir, st: it.st });
        cards.push({ title: name, rows: [{ f: "folder", b: show(parentOf(p)), a: show(to) }] });
        continue;
      }
      // delete: to Files' Trash, as files-core.js lays it out
      var t = Math.max(0, Math.floor(now)).toString(36);
      while (t.length < 9) t = "0" + t;
      var r = (String(rnd ? rnd(i) : Math.random().toString(36).slice(2, 10)).toLowerCase().replace(/[^0-9a-z]/g, "") + "000000").slice(0, 8);
      var id = t + "-" + r;
      steps.push({ k: "trash", from: p, dir: dir, st: it.st, id: id, meta: TRASH + "/" + id + ".json", to: TRASH + "/" + id + "/" + name,
                   rec: { v: 1, path: p, name: name, dir: dir, at: Math.floor(now) } });
      cards.push({ title: name, rows: [{ f: "folder", b: show(parentOf(p)), a: null }] });
    }
    return { ok: true, act: a, steps: steps, cards: cards, del: a === "delete" };
  }

  function same(st, was) {
    if (!st || !was) return false;
    if (!!st.dir !== !!was.dir) return false;
    return st.dir || (st.size === was.size && (st.mtime || 0) === (was.mtime || 0));
  }
  function statOf(fs, p) { return Promise.resolve().then(function () { return fs.stat(p); }).then(function (s) { return s || null; }, function () { return null; }); }
  function lsOf(fs, p) { return Promise.resolve().then(function () { return fs.ls(p); }).then(function (l) { return Array.isArray(l) ? l : []; }, function () { return []; }); }

  // Carry the steps out, one after the other. → Promise<{ done: [undo step], fail: "" | why }>
  function run(fs, steps) {
    var done = [], fail = "";
    return steps.reduce(function (pr, x) {
      return pr.then(function () {
        if (fail) return;
        var chk = x.k === "mkdir" ? statOf(fs, x.to).then(function (d) { return d ? "\"" + show(x.to) + "\" is already there." : ""; })
          : Promise.all([statOf(fs, x.from), statOf(fs, x.to)]).then(function (r) {
              if (!same(r[0], x.st)) return "\"" + show(x.from) + "\" changed or moved since the card; it was left as it is.";
              if (r[1]) return "\"" + show(x.to) + "\" is taken now; nothing was overwritten.";
              return "";
            });
        return chk.then(function (why) {
          if (why) { fail = why; return; }
          if (x.k === "mkdir") return Promise.resolve(fs.mkdir(x.to)).then(function () { done.push({ k: "rmdir", path: x.to }); });
          if (x.k === "mv") {
            return Promise.resolve(fs.mv(x.from, x.to)).then(function () { return statOf(fs, x.to); })
              .then(function (st) { done.push({ k: "mv", from: x.to, to: x.from, dir: x.dir, st: st }); });
          }
          // trash: the record first; when the move fails it is taken back (files.js moveToTrash)
          return Promise.resolve(fs.writeText(x.meta, JSON.stringify(x.rec))).then(function () {
            return Promise.resolve(fs.mv(x.from, x.to)).catch(function (e) {
              return Promise.resolve(fs.rm(x.meta)).catch(function () {}).then(function () { throw e; });
            });
          }).then(function () { return statOf(fs, x.to); })
            .then(function (st) { done.push({ k: "untrash", from: x.to, to: x.from, meta: x.meta, dir: x.dir, st: st }); });
        }).catch(function () { fail = fail || "The disk refused \"" + show(x.from || x.to) + "\"; it was left as it is."; });
      });
    }, Promise.resolve()).then(function () { return { done: done, fail: fail }; });
  }

  // Undo steps (run's done list), newest first, all checked before any
  // runs. → Promise<{ ok, err? }>
  function undo(fs, done) {
    if (!Array.isArray(done) || !done.length) return Promise.resolve(bad("Nothing to undo."));
    var list = done.slice().reverse();
    return Promise.all(list.map(function (u) {
      if (u.k === "rmdir") return lsOf(fs, u.path).then(function (l) { return statOf(fs, u.path).then(function (s) { return s && s.dir && !l.length ? "" : "\"" + show(u.path) + "\" is not empty any more (or gone); it stays."; }); });
      return Promise.all([statOf(fs, u.from), statOf(fs, u.to)]).then(function (r) {
        if (!same(r[0], u.st)) return "\"" + show(u.from) + "\" changed or moved since; nothing was undone.";
        if (r[1]) return "\"" + show(u.to) + "\" is taken now; nothing was undone.";
        return "";
      });
    })).then(function (why) {
      var w = why.filter(Boolean);
      if (w.length) return bad(w[0]);
      return list.reduce(function (pr, u) {
        return pr.then(function () {
          if (u.k === "rmdir") return fs.rm(u.path);
          return Promise.resolve(fs.mv(u.from, u.to)).then(function () {
            if (u.k === "untrash") return Promise.resolve(fs.rm(u.meta)).catch(function () {}).then(function () { return fs.rm(parentOf(u.from)).catch(function () {}); });
          });
        });
      }, Promise.resolve()).then(function () { return { ok: true }; }, function () { return bad("The disk refused part of the undo."); });
    });
  }

  // The items of refs, stat'ed, and the names in every folder a plan
  // may need → Promise<{ items, taken(dir) }>
  function load(fs, paths, ch) {
    var dirs = {};
    return Promise.all(paths.map(function (p) { return statOf(fs, p).then(function (st) { dirs[parentOf(p)] = 1; if (st && st.dir) dirs[p] = 1; return { path: p, st: st }; }); }))
      .then(function (items) {
        if (ch && ch.action === "move") dirs[folderPath(ch.set.folder)] = 1;
        var names = {};
        return Promise.all(Object.keys(dirs).map(function (d) { return lsOf(fs, d).then(function (l) { names[d] = l.map(function (e) { return e && e.name; }).filter(Boolean); }); }))
          .then(function () { return { items: items, taken: function (d) { return names[d] || []; } }; });
      });
  }

  var api = { MAX: MAX, APP_ROOTS: APP_ROOTS, KEEP_TOP: KEEP_TOP, blocked: blocked, validName: validName, folderPath: folderPath,
              plan: plan, run: run, undo: undo, load: load };
  if (NODE) module.exports = api;
  else root.OrosAssistFiles = api;
})(typeof window !== "undefined" ? window : this);
