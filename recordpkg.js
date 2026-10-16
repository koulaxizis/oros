// ============================================================
// orOS — recordpkg.js: record apps as open orOS files (OBF-4e)
// ------------------------------------------------------------
// The shared kit of the record apps (To-Do, Habits, Budget …): each
// saves its records as one bundle (bundle.js) with its own extension
// (.orostasks, .oroshabits …) and opens such a file again by ADDING
// the records it lacks, with their ids. Spec: docs/oros-bundle.md
// ("Record apps"). Pure at load (no DOM, no storage), so the apps and
// `node --test` run the same code; only ui() touches the page.
//
//   pack(desc, state, opts)        → the options of OrosBundle.write /
//                                    writeBlob: content.json is
//                                    { kind: "oros-<app>-package", ver: 1,
//                                    data: desc.strip(state) }
//   open(desc, local, content, o)  → { next, report { added, skipped,
//                                    updated }, addedIds, updatedIds }
//   ui(desc, hooks)                → the browser's Save / Open / folder /
//                                    "Open with" flow with its dialog
//   kindOf(app), clampStamp(v, now), STRINGS, str(lang, key, vars)
//
// Opening is an ADD-ONLY merge, never orosSync.importData:
//   - the kind must be the app's; desc.norm cleans the incoming data,
//     desc.strip drops its tombstones and device-only fields, and an
//     id desc.tombIds(incoming) still names is dropped too;
//   - every stamp is clamped to at most now + 5 minutes;
//   - a record whose id is on this device (live OR tombstoned) is kept
//     as it is; with { update: true } a live local record takes the
//     file's copy when the file's stamp is newer;
//   - next = desc.merge(local, filtered) (the app's own sync merge),
//     else a plain insert per collection. Nothing is ever deleted.
//
// The descriptor:
//   { app: "todo", title: "To-Do", slice: "todo", ext: ".orostasks",
//     mime: "application/x-oros-tasks",
//     colls: { "<path>": { shape: "array"|"map", id: "id", stamp: "m",
//                          clampIn?: ["fm", …] } },
//     norm?(data) → data|null, merge?(local, remote) → state,
//     strip?(state) → state, tombIds?(state) → Set|Array|{id: …},
//     previews?(state, lang) → { "<name>": text|Uint8Array|Blob } }
// A path is dot-separated: "items", "doc.items", or a collection
// inside the records of another one ("lists.items": the items of
// every record of the "lists" collection; "lists" must be declared).
// A "map" collection keys its records by id (the value may be any
// JSON); an "array" one holds objects with a string (or number) id.
// UMD: window.OrosRecordPkg in the browser, module.exports in Node.
// ============================================================
(function (root) {
  "use strict";

  var VER = 1;
  var FUTURE = 5 * 60 * 1000;          // stamps clamped to now + 5 min
  var MAX_RECORDS = 200000;            // per file, over all collections
  var ID_MAX = 200;

  var hasOwn = Object.prototype.hasOwnProperty;
  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
  function bad(code) { var e = new Error(code); e.code = code; return e; }
  function kindOf(app) { return "oros-" + app + "-package"; }
  function clampStamp(v, now) {
    var lim = (typeof now === "number" ? now : Date.now()) + FUTURE;
    return typeof v === "number" && v > lim ? lim : v;
  }

  // ---------- collections ----------
  // The declared paths as a tree: each node { path, rel [segments
  // relative to its parent record], shape, id, stamp, clampIn, kids }.
  function tree(desc) {
    var colls = (desc && desc.colls) || {}, nodes = {}, top = [];
    Object.keys(colls).sort(function (a, b) { return a.split(".").length - b.split(".").length || (a < b ? -1 : 1); })
      .forEach(function (p) {
        var c = colls[p] || {}, segs = p.split("."), parent = null, rel = segs;
        for (var i = segs.length - 1; i > 0; i--) {
          var pre = segs.slice(0, i).join(".");
          if (nodes[pre]) { parent = nodes[pre]; rel = segs.slice(i); break; }
        }
        var n = { path: p, rel: rel, shape: c.shape === "map" ? "map" : "array", id: c.id || "id",
                  stamp: c.stamp || "", clampIn: Array.isArray(c.clampIn) ? c.clampIn : [], kids: [] };
        nodes[p] = n;
        (parent ? parent.kids : top).push(n);
      });
    return top;
  }
  function getAt(o, rel) {
    for (var i = 0; i < rel.length; i++) {
      if (!isObj(o) || !hasOwn.call(o, rel[i])) return undefined;
      o = o[rel[i]];
    }
    return o;
  }
  function setAt(o, rel, v) {
    for (var i = 0; i < rel.length - 1; i++) {
      if (!isObj(o[rel[i]])) o[rel[i]] = {};
      o = o[rel[i]];
    }
    o[rel[rel.length - 1]] = v;
  }
  function goodId(v) {
    if (typeof v === "number") return isFinite(v);
    return typeof v === "string" && v.length > 0 && v.length <= ID_MAX && v !== "__proto__";
  }
  // The records of one container: [{ id (string), rec }]
  function entries(node, c) {
    var out = [];
    if (node.shape === "map") {
      if (!isObj(c)) return out;
      Object.keys(c).forEach(function (k) { if (goodId(k)) out.push({ id: k, rec: c[k] }); });
    } else {
      if (!Array.isArray(c)) return out;
      c.forEach(function (r) { if (isObj(r) && goodId(r[node.id])) out.push({ id: String(r[node.id]), rec: r }); });
    }
    return out;
  }
  function stampOf(node, rec) {
    var v = node.stamp && isObj(rec) ? rec[node.stamp] : 0;
    return typeof v === "number" && isFinite(v) ? v : 0;
  }
  // id → record, per collection path, over the whole state
  function index(nodes, state) {
    var out = {};
    function walk(list, owner) {
      list.forEach(function (n) {
        var idx = out[n.path] || (out[n.path] = Object.create(null));
        entries(n, getAt(owner, n.rel)).forEach(function (e) {
          if (!(e.id in idx)) idx[e.id] = e.rec;
          if (n.kids.length && isObj(e.rec)) walk(n.kids, e.rec);
        });
      });
    }
    if (isObj(state)) walk(nodes, state);
    return out;
  }
  function idSet(v) {
    var out = Object.create(null);
    if (!v) return out;
    if (typeof v.forEach === "function" && !Array.isArray(v) && typeof v.has === "function") v.forEach(function (x) { out[String(x)] = 1; });
    else if (Array.isArray(v)) v.forEach(function (x) { out[String(x)] = 1; });
    else if (isObj(v)) Object.keys(v).forEach(function (k) { out[k] = 1; });
    return out;
  }
  function clampRec(node, rec, now) {
    if (!isObj(rec)) return;
    if (node.stamp && typeof rec[node.stamp] === "number") rec[node.stamp] = clampStamp(rec[node.stamp], now);
    node.clampIn.forEach(function (k) {
      var o = rec[k];
      if (!isObj(o)) return;
      Object.keys(o).forEach(function (f) { if (typeof o[f] === "number") o[f] = clampStamp(o[f], now); });
    });
  }
  function countAll(node, rec) {
    var n = 1;
    if (isObj(rec)) node.kids.forEach(function (k) {
      entries(k, getAt(rec, k.rel)).forEach(function (e) { n += countAll(k, e.rec); });
    });
    return n;
  }

  // ---------- pack ----------
  // opts: { title, lang, created, modified, files [{ key, bytes|blob,
  //   type }], thumbnail (PNG bytes), settings, now }
  function pack(desc, state, opts) {
    opts = opts || {};
    var now = typeof opts.now === "number" ? opts.now : Date.now();
    var data = typeof desc.strip === "function" ? desc.strip(clone(state)) : clone(state);
    var created = Infinity, modified = 0;
    (function walk(list, owner) {
      list.forEach(function (n) {
        entries(n, getAt(owner, n.rel)).forEach(function (e) {
          var s = stampOf(n, e.rec);
          if (s > 0 && s < created) created = s;
          if (s > modified) modified = s;
          if (n.kids.length && isObj(e.rec)) walk(n.kids, e.rec);
        });
      });
    })(tree(desc), isObj(data) ? data : {});
    var media = {};
    (Array.isArray(opts.files) ? opts.files : []).forEach(function (f) {
      if (f && typeof f.key === "string" && (f.bytes || f.blob)) media[f.key] = f.bytes || f.blob;
    });
    var preview = [], thumb = opts.thumbnail || null;
    var pv = typeof desc.previews === "function" ? desc.previews(data, opts.lang) || {} : {};
    Object.keys(pv).forEach(function (name) {
      if (pv[name] == null || pv[name] === "") return;
      if (name === "thumbnail.png") { thumb = thumb || pv[name]; return; }
      preview.push({ name: name, data: pv[name] });
    });
    var out = {
      mime: desc.mime, app: desc.app, schema: desc.app + "/" + VER,
      content: { kind: kindOf(desc.app), ver: VER, data: data },
      meta: {
        title: opts.title || desc.title || desc.app,
        created: opts.created || (isFinite(created) ? created : undefined),
        modified: opts.modified || modified || now,
        language: opts.lang || undefined
      },
      generator: "orOS " + (desc.title || desc.app),
      media: media, preview: preview, date: new Date(now)
    };
    if (thumb) out.thumbnail = thumb;
    if (opts.settings) out.settings = opts.settings;
    return out;
  }

  // ---------- open ----------
  // content: content.json (or the whole OrosBundle.read result).
  // o: { update, now }
  function open(desc, local, content, o) {
    o = o || {};
    var now = typeof o.now === "number" ? o.now : Date.now();
    if (isObj(content) && isObj(content.content) && typeof content.mime === "string") content = content.content;
    if (!isObj(content) || content.kind !== kindOf(desc.app)) throw bad("notpackage");
    if (typeof content.ver === "number" && content.ver > VER) throw bad("newer");
    var inc = content.data;
    if (!isObj(inc) && !Array.isArray(inc)) throw bad("notpackage");
    inc = clone(inc);
    if (typeof desc.norm === "function") inc = desc.norm(inc);
    if (!isObj(inc)) throw bad("notpackage");
    if (typeof desc.strip === "function") inc = desc.strip(inc);
    if (!isObj(inc)) throw bad("notpackage");
    var deadIn = idSet(typeof desc.tombIds === "function" ? desc.tombIds(inc) : null);
    var nodes = tree(desc);
    var have = isObj(local) ? local : null;
    var idx = index(nodes, have);
    var tombs = idSet(have && typeof desc.tombIds === "function" ? desc.tombIds(have) : null);
    var report = { added: 0, skipped: 0, updated: 0 };
    var addedIds = [], updatedIds = [], budget = MAX_RECORDS;
    // what open decided for each kept record, by path + id (ids are
    // unique per collection path over the whole file)
    var role = Object.create(null), seen = Object.create(null);
    function mark(node, id, r) { role[node.path + "\u0001" + id] = r; }
    function roleOf(node, id) { return role[node.path + "\u0001" + id]; }

    // Filter one container of the incoming tree, in place.
    function filter(node, owner) {
      var c = getAt(owner, node.rel);
      if (c === undefined) return;
      var keep = node.shape === "map" ? {} : [];
      var lidx = idx[node.path] || Object.create(null);
      var once = seen[node.path] || (seen[node.path] = Object.create(null));
      entries(node, c).forEach(function (e) {
        var id = e.id, rec = e.rec;
        if (once[id] || budget <= 0) return;                // duplicates, too many
        once[id] = 1;
        if (deadIn[id]) return;                             // a tombstone in the file
        budget--;
        clampRec(node, rec, now);
        var mine = id in lidx ? lidx[id] : undefined;
        var r;
        if (tombs[id]) { report.skipped += countAll(node, rec); return; }
        if (mine === undefined) {
          r = "add"; report.added++; addedIds.push(id);
        } else if (o.update && stampOf(node, rec) > stampOf(node, mine)) {
          r = "upd"; report.updated++; updatedIds.push(id);
        } else {
          report.skipped++;
          if (!node.kids.length || !isObj(rec) || !isObj(mine)) return;
          // kept as it is here, but it may carry records to add:
          // the local copy, with the file's children to filter below
          var carry = clone(mine);
          node.kids.forEach(function (k) { setAt(carry, k.rel, clone(getAt(rec, k.rel))); });
          rec = carry;
          r = "carry";
        }
        if (isObj(rec)) node.kids.forEach(function (k) { filter(k, rec); });
        if (r === "carry") {
          var any = node.kids.some(function (k) { var x = getAt(rec, k.rel); return entries(k, x).length > 0; });
          if (!any) return;
          // the children this file does not add stay as they are here
          node.kids.forEach(function (k) { if (getAt(rec, k.rel) === undefined) setAt(rec, k.rel, k.shape === "map" ? {} : []); });
        }
        mark(node, id, r);
        if (node.shape === "map") keep[id] = rec; else keep.push(rec);
      });
      setAt(owner, node.rel, keep);
    }
    nodes.forEach(function (n) { filter(n, inc); });

    var next;
    if (typeof desc.merge === "function") {
      // the remote the app's merge sees: this device's own root fields
      // (so settings and tombstones stay as they are) + the filtered
      // collections
      // (nothing here yet: the filtered file is the state)
      var remote = have ? clone(have) : clone(inc);
      nodes.forEach(function (n) {
        var v = getAt(inc, n.rel);
        if (v !== undefined) setAt(remote, n.rel, v);
      });
      next = have ? desc.merge(clone(have), remote) : remote;
    } else {
      next = have ? clone(have) : {};
      if (!have) Object.keys(inc).forEach(function (k) {
        if (!nodes.some(function (n) { return n.rel[0] === k; })) next[k] = clone(inc[k]);
      });
      nodes.forEach(function (n) { insert(n, next, inc); });
    }
    function insert(node, dst, src) {
      var sc = getAt(src, node.rel);
      if (sc === undefined) return;
      var dc = getAt(dst, node.rel);
      if (node.shape === "map" ? !isObj(dc) : !Array.isArray(dc)) { dc = node.shape === "map" ? {} : []; setAt(dst, node.rel, dc); }
      var at = Object.create(null);
      entries(node, dc).forEach(function (e) { if (!(e.id in at)) at[e.id] = node.shape === "map" ? e.id : dc.indexOf(e.rec); });
      entries(node, sc).forEach(function (e) {
        var r = roleOf(node, e.id), pos = e.id in at ? at[e.id] : undefined;
        if (pos === undefined) {
          if (r !== "add" && r !== "upd" && r !== "carry") return;
          var fresh = clone(e.rec);
          if (node.shape === "map") dc[e.id] = fresh; else dc.push(fresh);
          return;
        }
        var cur = dc[pos];
        if (r === "upd") {
          var nu = clone(e.rec);
          // the children: what is here, plus what the file adds below
          node.kids.forEach(function (k) { if (isObj(cur) && isObj(nu)) setAt(nu, k.rel, getAt(cur, k.rel)); });
          dc[pos] = nu;
          cur = nu;
        }
        if ((r === "upd" || r === "carry") && isObj(cur)) node.kids.forEach(function (k) { insert(k, cur, e.rec); });
      });
    }
    return { next: next, report: report, addedIds: addedIds, updatedIds: updatedIds };
  }

  // ---------- strings ----------
  var STRINGS = {
    en: {
      save: "Save as orOS file…",
      open: "Open orOS file…",
      folder: "Open unzipped folder…",
      saved: "Saved “{name}”. The file is not encrypted: keep it somewhere safe.",
      notEncrypted: "This file is not encrypted.",
      title: "Open “{name}”",
      added: "{n} new: will be added",
      skipped: "{n} already here: kept as they are",
      updated: "{n} newer in the file: will be updated",
      update: "Update with newer versions",
      updateHint: "Records already here take the file's copy when it is newer. Nothing is deleted.",
      add: "Add",
      cancel: "Cancel",
      nothing: "Nothing to add: everything in this file is already here or was deleted here.",
      done: "{n} added from “{name}”",
      doneUpd: "{n} added, {u} updated from “{name}”",
      undone: "Undone",
      newer: "This file was made by a newer orOS. Update orOS to open it.",
      wrong: "This is not a {app} file.",
      bad: "This file could not be read.",
      big: "This file is too big."
    },
    el: {
      save: "Αποθήκευση ως αρχείο orOS…",
      open: "Άνοιγμα αρχείου orOS…",
      folder: "Άνοιγμα αποσυμπιεσμένου φακέλου…",
      saved: "Αποθηκεύτηκε το «{name}». Το αρχείο δεν είναι κρυπτογραφημένο: φύλαξέ το σε ασφαλές μέρος.",
      notEncrypted: "Το αρχείο δεν είναι κρυπτογραφημένο.",
      title: "Άνοιγμα του «{name}»",
      added: "{n} νέα: θα προστεθούν",
      skipped: "{n} υπάρχουν ήδη: μένουν όπως είναι",
      updated: "{n} νεότερα στο αρχείο: θα ενημερωθούν",
      update: "Ενημέρωση με νεότερες εκδοχές",
      updateHint: "Όσα υπάρχουν ήδη παίρνουν το αντίγραφο του αρχείου όταν είναι νεότερο. Δεν διαγράφεται τίποτα.",
      add: "Προσθήκη",
      cancel: "Άκυρο",
      nothing: "Τίποτα για προσθήκη: όσα έχει το αρχείο υπάρχουν ήδη εδώ ή διαγράφηκαν εδώ.",
      done: "Προστέθηκαν {n} από το «{name}»",
      doneUpd: "Προστέθηκαν {n}, ενημερώθηκαν {u} από το «{name}»",
      undone: "Αναιρέθηκε",
      newer: "Το αρχείο φτιάχτηκε από νεότερο orOS. Ενημέρωσε το orOS για να το ανοίξεις.",
      wrong: "Αυτό δεν είναι αρχείο της εφαρμογής {app}.",
      bad: "Το αρχείο δεν διαβάστηκε.",
      big: "Το αρχείο είναι πολύ μεγάλο."
    }
  };
  function str(lang, key, vars) {
    var s = (STRINGS[lang === "el" ? "el" : "en"] || STRINGS.en)[key] || STRINGS.en[key] || key;
    if (vars) Object.keys(vars).forEach(function (k) { s = s.split("{" + k + "}").join(String(vars[k])); });
    return s;
  }
  function fileTitle(s, fallback) {
    return String(s || "").replace(/[\u0000-\u001f\u007f\/\\:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || fallback || "orOS";
  }

  // ---------- ui (browser only) ----------
  // hooks: {
  //   get() → the app's state (its sync slice, as the getter gives it)
  //   set(next, info) → store next through the app's own save + sync
  //                     path and re-render; info { addedIds, updatedIds }
  //   deleteIds(ids) → Undo: remove these records the app's own way
  //   toast(text, undoFn?) → the app's message (with Undo when given)
  //   lang?() → "en" | "el" (else the shell's "oros-lang")
  //   title?(state) → the file name / meta title (else desc.title)
  //   files?(state) → Promise<[{ key, bytes|blob, type }]>  media to save
  //   media?(read, result) → Promise<next|undefined>  store the file's
  //                     media (read.media) before set; may return a new next
  //   notBundle?(file) → the app's own import for a file that is not
  //                     a bundle (first bytes not "PK")
  //   thumbnail?(state) → Promise<PNG bytes|null>
  // }
  // → { save(), open(), openFile(file), openFolder(), openTarget({ token }),
  //     text(key, vars) }
  function ui(desc, hooks) {
    hooks = hooks || {};
    var w = typeof window !== "undefined" ? window : null;
    var B = function () { return (w && w.OrosBundle) || null; };
    var MAX = 512 * 1024 * 1024;
    function lang() {
      try { if (typeof hooks.lang === "function") return hooks.lang() === "el" ? "el" : "en"; } catch (e) {}
      try { return w.localStorage.getItem("oros-lang") === "el" ? "el" : "en"; } catch (e) { return "en"; }
    }
    function T(k, v) { return str(lang(), k, v); }
    function toast(text, undo) { try { if (typeof hooks.toast === "function") hooks.toast(text, undo || null); } catch (e) {} }
    function host() {
      try { return w.orosDialog || (w.parent && w.parent.orosDialog) || null; } catch (e) { return w.orosDialog || null; }
    }
    function types() { var a = {}; a[desc.mime] = [desc.ext]; return [{ description: "orOS " + (desc.title || desc.app), accept: a }]; }
    function pickLocal(accept) {
      return new Promise(function (resolve) {
        var inp = w.document.createElement("input");
        inp.type = "file"; inp.accept = accept; inp.style.display = "none";
        inp.addEventListener("change", function () { var f = inp.files && inp.files[0] ? inp.files[0] : null; inp.remove(); resolve(f); });
        inp.addEventListener("cancel", function () { inp.remove(); resolve(null); });
        w.document.body.appendChild(inp);
        inp.click();
      });
    }
    function fail(e) {
      try { console.error("[orOS] " + desc.app + " file:", e); } catch (x) {}
      var c = e && e.code;
      toast(c === "newer" ? T("newer") : (c === "wrongtype" || c === "notpackage") ? T("wrong", { app: desc.title || desc.app }) : T("bad"));
      return false;
    }

    function save() {
      var b = B();
      if (!b) return Promise.resolve(false);
      var state = hooks.get(), title = "";
      try { title = typeof hooks.title === "function" ? hooks.title(state) : ""; } catch (e) { title = ""; }
      title = fileTitle(title || desc.title, desc.app);
      var name = title + desc.ext;
      return Promise.all([
        typeof hooks.files === "function" ? Promise.resolve(hooks.files(state)) : [],
        typeof hooks.thumbnail === "function" ? Promise.resolve(hooks.thumbnail(state)).then(null, function () { return null; }) : null
      ]).then(function (r) {
        return b.writeBlob(pack(desc, state, { title: title, lang: lang(), files: r[0] || [], thumbnail: r[1] || null }));
      }).then(function (blob) {
        var d = host();
        if (d && typeof d.saveFile === "function") {
          return Promise.resolve(d.saveFile({ blob: blob, filename: name, mime: desc.mime, types: types() })).then(function (r) {
            if (r && r.ok) toast(T("saved", { name: (r && r.name) || name }));
            return !!(r && r.ok);
          });
        }
        var url = URL.createObjectURL(blob), a = w.document.createElement("a");
        a.href = url; a.download = name;
        w.document.body.appendChild(a); a.click();
        setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
        toast(T("saved", { name: name }));
        return true;
      }).then(null, fail);
    }

    // a read bundle → the confirm dialog → set + Undo toast
    function apply(read, name) {
      var local = hooks.get(), both;
      try {
        both = { add: open(desc, local, read.content, {}), upd: open(desc, local, read.content, { update: true }) };
      } catch (e) { return Promise.resolve(fail(e)); }
      if (!both.add.report.added && !both.upd.report.updated) { toast(T("nothing")); return Promise.resolve(false); }
      return confirm(both, name).then(function (choice) {
        if (!choice) return false;
        // read again against the state as it is now (sync may have run)
        var res = open(desc, hooks.get(), read.content, { update: choice === "upd" });
        var go = typeof hooks.media === "function" ? Promise.resolve(hooks.media(read, res)) : Promise.resolve();
        return go.then(function (n2) {
          hooks.set(n2 || res.next, { addedIds: res.addedIds, updatedIds: res.updatedIds });
          var ids = res.addedIds.slice();
          var msg = res.report.updated ? T("doneUpd", { n: res.report.added, u: res.report.updated, name: name })
                                       : T("done", { n: res.report.added, name: name });
          toast(msg, ids.length && typeof hooks.deleteIds === "function" ? function () { hooks.deleteIds(ids); } : null);
          return true;
        });
      }).then(null, fail);
    }
    function confirm(both, name) {
      var doc = w.document;
      return new Promise(function (resolve) {
        var stale = doc.getElementById("recordpkg-dialog");
        if (stale) stale.remove();
        var dlg = doc.createElement("dialog"), done = false;
        dlg.id = "recordpkg-dialog";
        dlg.style.cssText = "border:1px solid var(--border,#444);border-radius:12px;background:var(--panel-bg,var(--bg,#1b1a18));" +
          "color:var(--text,#eee);padding:18px;width:min(360px,calc(100vw - 32px));";
        function el(tag, css, text) { var e = doc.createElement(tag); if (css) e.style.cssText = css; if (text != null) e.textContent = text; return e; }
        dlg.appendChild(el("div", "font-weight:600;font-size:15px;margin-bottom:10px;overflow-wrap:anywhere;", T("title", { name: String(name || "").slice(0, 120) })));
        var lines = el("div", "font-size:13px;line-height:1.6;margin-bottom:12px;");
        dlg.appendChild(lines);
        var lab = el("label", "display:flex;gap:8px;align-items:flex-start;font-size:13px;margin:0 0 4px;cursor:pointer;" +
          "text-transform:none;letter-spacing:normal;font-weight:normal;color:var(--text,#eee);");
        var cb = doc.createElement("input");
        cb.type = "checkbox"; cb.id = "recordpkg-update";
        lab.appendChild(cb);
        lab.appendChild(el("span", "", T("update")));
        dlg.appendChild(lab);
        var hint = el("div", "font-size:12px;color:var(--text-dim,#999);margin:0 0 14px 24px;", T("updateHint"));
        dlg.appendChild(hint);
        var row = el("div", "display:flex;gap:8px;justify-content:flex-end;");
        var no = el("button", "border:1px solid var(--border,#444);border-radius:7px;background:transparent;color:var(--text-dim,#999);padding:7px 14px;min-height:36px;cursor:pointer;", T("cancel"));
        var yes = el("button", "border:1px solid var(--accent,#6d4aff);border-radius:7px;background:var(--accent,#6d4aff);color:#fff;padding:7px 14px;min-height:36px;font-weight:600;cursor:pointer;", T("add"));
        no.type = "button"; yes.type = "button"; yes.id = "recordpkg-add";
        row.appendChild(no); row.appendChild(yes);
        dlg.appendChild(row);
        function paint() {
          var r = (cb.checked ? both.upd : both.add).report;
          lines.textContent = "";
          lines.appendChild(el("div", "", T("added", { n: r.added })));
          if (r.updated) lines.appendChild(el("div", "", T("updated", { n: r.updated })));
          if (r.skipped) lines.appendChild(el("div", "color:var(--text-dim,#999);", T("skipped", { n: r.skipped })));
          yes.disabled = !r.added && !r.updated;
        }
        cb.addEventListener("change", paint);
        // the box only when the file has newer copies of records here
        lab.hidden = hint.hidden = !both.upd.report.updated;
        if (lab.hidden) lines.style.marginBottom = "16px";
        paint();
        function end(v) { if (done) return; done = true; try { dlg.close(); } catch (e) {} dlg.remove(); resolve(v); }
        no.addEventListener("click", function () { end(null); });
        yes.addEventListener("click", function () { end(cb.checked ? "upd" : "add"); });
        dlg.addEventListener("cancel", function () { end(null); });
        dlg.addEventListener("click", function (e) { if (e.target === dlg) end(null); });
        doc.body.appendChild(dlg);
        if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
        setTimeout(function () { try { no.focus(); } catch (e) {} }, 30);
      });
    }

    function openFile(f) {
      var b = B();
      if (!b || !f) return Promise.resolve(false);
      if (f.size > MAX) { toast(T("big")); return Promise.resolve(false); }
      return f.slice(0, 128).arrayBuffer().then(function (ab) {
        var kind = b.sniff(new Uint8Array(ab));
        if (kind === null) {                     // not a ZIP: the app's own import, if it has one
          if (typeof hooks.notBundle === "function") return hooks.notBundle(f);
          toast(T("wrong", { app: desc.title || desc.app }));
          return false;
        }
        return f.arrayBuffer().then(function (all) { return b.read(new Uint8Array(all), { mime: desc.mime }); })
          .then(function (r) { return apply(r, f.name || desc.title); });
      }).then(null, fail);
    }
    function openPick() {
      var d = host(), accept = desc.ext + "," + desc.mime;
      var p = d && typeof d.openFile === "function" ? d.openFile(accept) : pickLocal(accept);
      return Promise.resolve(p).then(function (f) { return f ? openFile(f) : false; });
    }
    function openFolder() {
      var b = B();
      if (!b) return Promise.resolve(false);
      return b.pickFolder().then(function (files) {
        if (!files || !files.length) return false;
        var name = "";
        try { name = String(files[0].webkitRelativePath || "").split("/")[0]; } catch (e) { name = ""; }
        return b.readFolder(files, { mime: desc.mime }).then(function (r) { return apply(r, name || desc.title); });
      }).then(null, fail);
    }
    // "Open with" (fileopen.js): target { openFile: { token } }
    function openTarget(o) {
      var f = null;
      try {
        var p = w.parent;
        if (o && typeof o.token === "string" && p && p !== w && typeof p.__orosTakeFile === "function") f = p.__orosTakeFile(o.token);
      } catch (e) { f = null; }
      return f ? openFile(f) : Promise.resolve(false);
    }
    return { save: save, open: openPick, openFile: openFile, openFolder: openFolder, openTarget: openTarget,
             text: function (k, v) { return T(k, v); } };
  }

  var api = {
    VER: VER, FUTURE: FUTURE, MAX_RECORDS: MAX_RECORDS, STRINGS: STRINGS,
    kindOf: kindOf, clampStamp: clampStamp, pack: pack, open: open, ui: ui, str: str, fileTitle: fileTitle
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosRecordPkg = api;
})(typeof window !== "undefined" ? window : this);
