// ============================================================
// orOS — open and save on this computer (pcdialog.js, orOS USB)
// ------------------------------------------------------------
// On the orOS USB stick, and on a computer where orOS is installed
// from it, the orOS launcher serves the computer's own files under
// /__oros/fs/ (oros-portable launcher/computerfs.go; Files' "This
// computer", files/computer-core.js). There, every app's Open and
// Save go through orOS's own window over the computer's folders
// instead of the browser's download / file input: one place to
// choose, the same look as orOS, and a file opened from the computer
// is saved back where it came from.
//
// It changes window.orosDialog in place (dialogs.js contract, R33):
//   saveFile(opts)  -> { ok, mode: "computer", path } | { ok: false }
//   openFile(accept) / openFiles(accept) -> File | File[] | null
// Elsewhere (useoros.online, Portable, installers) it does nothing:
// shell.js computerFiles() calls orosPcDialog.enable() only when the
// launcher answers.
//
// Save in place (wave 4 of the "This computer" plan): a file opened
// here is remembered by name (this page only, never stored). Saving
// a file of the same name starts in its folder; replacing that very
// file sends its modification time, so a copy changed elsewhere in
// the meantime is never overwritten: the person gets "Save as a copy"
// instead. Any other replace asks first.
//
// Device-local: oros-pcdialog-dir (the last folder). Strings pcd.*
// in translations.js (EN, EL), i18n/de/shell.js (DE).
// ============================================================
(function (root) {
  "use strict";

  var API = "/__oros/fs/";
  var DIR_KEY = "oros-pcdialog-dir";
  var MAX_OPEN = 512 * 1048576;

  // ---------- pure helpers (tests/pcdialog.test.js) ----------

  var EXT_KIND = {
    image: ["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "svg", "ico", "tif", "tiff", "heic"],
    audio: ["mp3", "m4a", "m4b", "aac", "ogg", "oga", "opus", "flac", "wav", "wave", "weba"],
    video: ["mp4", "m4v", "webm", "mov", "mkv", "ogv"],
    text: ["txt", "md", "markdown", "csv", "tsv", "json", "xml", "html", "htm", "css", "js", "ics", "vcf", "srt", "vtt", "log"]
  };
  function extOf(name) {
    var m = /\.([a-z0-9]{1,24})$/i.exec(String(name || ""));
    return m ? m[1].toLowerCase() : "";
  }
  // accept as <input accept>: ".docx,.odt,image/*,application/json".
  // Empty, "*" or "*/*" takes everything. A MIME type that is not a
  // family (application/json) is matched by its usual extension.
  var MIME_EXT = {
    "application/json": "json", "application/pdf": "pdf", "text/csv": "csv", "text/plain": "txt",
    "text/html": "html", "text/markdown": "md", "application/zip": "zip", "text/calendar": "ics",
    "text/vcard": "vcf", "text/x-vcard": "vcf", "image/svg+xml": "svg"
  };
  function acceptTest(accept) {
    var parts = String(accept || "").split(",").map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
    if (!parts.length || parts.indexOf("*") !== -1 || parts.indexOf("*/*") !== -1) return function () { return true; };
    var exts = {}, kinds = {};
    parts.forEach(function (p) {
      if (p.charAt(0) === ".") exts[p.slice(1)] = true;
      else if (/^[a-z]+\/\*$/.test(p)) kinds[p.slice(0, p.indexOf("/"))] = true;
      else if (MIME_EXT[p]) exts[MIME_EXT[p]] = true;
    });
    return function (name) {
      var x = extOf(name);
      if (!x) return false;
      if (exts[x]) return true;
      for (var k in kinds) if (EXT_KIND[k] && EXT_KIND[k].indexOf(x) !== -1) return true;
      return false;
    };
  }
  // A name a person may give: no slashes, not hidden, not empty.
  function validName(name) {
    if (typeof name !== "string") return false;
    var n = name.trim();
    return !!n && n === name && n.charAt(0) !== "." && !/[\/\\\u0000]/.test(n) && n.length <= 255;
  }
  // "a.txt" taken → "a (2).txt".
  function uniqueName(name, taken) {
    var set = {};
    (taken || []).forEach(function (n) { set[String(n).toLowerCase()] = true; });
    if (!set[name.toLowerCase()]) return name;
    var dot = name.lastIndexOf(".");
    var stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : "";
    for (var i = 2; i < 10000; i++) {
      var n = stem + " (" + i + ")" + ext;
      if (!set[n.toLowerCase()]) return n;
    }
    return stem + " (" + Date.now() + ")" + ext;
  }
  // A clean API folder: "/home…" or "/disks/<name>…", no dot segments.
  function cleanDir(p) {
    if (typeof p !== "string" || !/^\/(home|disks\/[^\/]+)(\/|$)/.test(p)) return null;
    var segs = p.split("/").slice(1);
    for (var i = 0; i < segs.length; i++) {
      if (!segs[i] || segs[i] === "." || segs[i] === ".." || segs[i].charAt(0) === ".") return null;
    }
    return p;
  }
  function parentOf(p) { var i = p.lastIndexOf("/"); return i > 0 ? p.slice(0, i) : p; }
  function baseName(p) { return p.slice(p.lastIndexOf("/") + 1); }
  // Where a save starts: the folder of a file of that name opened here,
  // else the last folder, else Documents.
  function startDir(name, opened, last) {
    var o = name && opened ? opened[String(name).toLowerCase()] : null;
    return (o && cleanDir(o.dir)) || cleanDir(last) || "/home/Documents";
  }

  var helpers = {
    acceptTest: acceptTest, validName: validName, uniqueName: uniqueName,
    cleanDir: cleanDir, startDir: startDir, extOf: extOf
  };
  if (typeof module === "object" && module.exports) { module.exports = helpers; return; }
  if (!root || !root.document) return;

  // ---------- the window ----------
  var w = root, doc = w.document;
  var enabled = false;
  var orig = null;          // dialogs.js's own functions
  var opened = {};          // lower-case name → { dir, path, mtime } (this page only)

  // Home folders keep their English names on disk; the dialog shows them translated.
  var FOLDER_KEYS = {
    Documents: "pcd.f.Documents", Downloads: "pcd.f.Downloads", Pictures: "pcd.f.Pictures",
    Music: "pcd.f.Music", Videos: "pcd.f.Videos", Desktop: "pcd.f.Desktop"
  };
  function T(k, vars) {
    var s = typeof w.t === "function" ? w.t(k) : k;
    if (vars) Object.keys(vars).forEach(function (v) { s = s.split("{" + v + "}").join(String(vars[v])); });
    return s;
  }
  function call(method, name, query, body, type) {
    var headers = { "X-Oros-FS": "1" };
    if (type) headers["Content-Type"] = type;
    var init = { method: method, headers: headers, credentials: "same-origin", cache: "no-store" };
    if (body !== undefined) init.body = body;
    return fetch(API + name + (query ? "?" + query : ""), init).then(function (r) {
      return r.json().then(function (j) { return j; }, function () { return null; }).then(function (j) {
        if (!r.ok) { var e = new Error((j && j.message) || ("HTTP " + r.status)); e.code = (j && j.error) || "io"; e.status = r.status; throw e; }
        return j;
      });
    });
  }
  function q(p) { return "path=" + encodeURIComponent(p); }
  function readLast() { try { return w.localStorage.getItem(DIR_KEY) || ""; } catch (e) { return ""; } }
  function saveLast(d) { try { w.localStorage.setItem(DIR_KEY, d); } catch (e) {} }

  var CSS =
    "#oros-pcd{border:1px solid var(--border);border-radius:12px;background:var(--panel-bg);color:var(--text);" +
    "padding:16px;width:min(560px,calc(100vw - 32px));max-height:calc(100vh - 32px);box-sizing:border-box;display:flex;flex-direction:column;gap:10px}" +
    "#oros-pcd:not([open]){display:none}" +
    "#oros-pcd::backdrop{background:rgba(0,0,0,.55)}" +
    "#oros-pcd h3{margin:0;font-size:16px}" +
    "#oros-pcd .pcd-crumbs{display:flex;flex-wrap:wrap;gap:2px;align-items:center;font-size:13px;color:var(--text-dim)}" +
    "#oros-pcd .pcd-crumbs button{background:none;border:0;color:inherit;font:inherit;padding:4px 6px;border-radius:6px;cursor:pointer}" +
    "#oros-pcd .pcd-crumbs button:last-child{color:var(--text);font-weight:600}" +
    "#oros-pcd .pcd-list{list-style:none;margin:0;padding:0;border:1px solid var(--border);border-radius:8px;overflow-y:auto;min-height:160px;max-height:50vh;flex:1}" +
    "#oros-pcd .pcd-row{display:flex;align-items:center;gap:10px;width:100%;min-height:40px;padding:6px 12px;background:none;border:0;" +
    "border-bottom:1px solid rgba(255,255,255,.04);color:inherit;font:inherit;text-align:left;cursor:pointer;box-sizing:border-box}" +
    "#oros-pcd .pcd-row:hover,#oros-pcd .pcd-row:focus-visible{background:var(--accent-soft)}" +
    "#oros-pcd .pcd-row[aria-selected=true]{background:var(--accent);color:var(--accent-text,#fff)}" +
    "#oros-pcd .pcd-row .pcd-n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
    "#oros-pcd .pcd-row .pcd-s{font-size:12px;opacity:.7}" +
    "#oros-pcd .pcd-row.dim{opacity:.45;cursor:default}" +
    "#oros-pcd .pcd-msg{padding:16px;color:var(--text-dim);font-size:13px}" +
    "#oros-pcd .pcd-name{display:flex;gap:8px;align-items:center}" +
    "#oros-pcd .pcd-name input{flex:1;min-width:0;padding:8px 10px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:inherit;font:inherit}" +
    "#oros-pcd .pcd-hint{min-height:1em;margin:0;font-size:12px;color:var(--danger,#d93025)}" +
    "#oros-pcd .pcd-btns{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}" +
    "#oros-pcd .pcd-btns .pcd-sp{flex:1}" +
    "#oros-pcd .pcd-btns button{min-height:40px;padding:0 14px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--text);font:inherit;cursor:pointer}" +
    "#oros-pcd .pcd-btns button.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-text,#fff)}" +
    "#oros-pcd .pcd-btns button:disabled{opacity:.5;cursor:default}";
  function ensureCss() {
    if (doc.getElementById("oros-pcd-css")) return;
    var s = doc.createElement("style");
    s.id = "oros-pcd-css";
    s.textContent = CSS;
    doc.head.appendChild(s);
  }
  function el(tag, cls, text) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function button(label, cls, fn) {
    var b = el("button", cls || "", label);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }
  var FOLDER = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
  var FILE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
  var HOME_FOLDERS = ["Documents", "Downloads", "Pictures", "Music", "Videos", "Desktop"];
  function folderLabel(name, dir) {
    return dir === "/home" && FOLDER_KEYS[name] ? T(FOLDER_KEYS[name]) : name;
  }
  function fmtSize(n) {
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
    if (n < 1073741824) return (n / 1048576).toFixed(1) + " MB";
    return (n / 1073741824).toFixed(1) + " GB";
  }

  // The one window. kind "save" | "open" | "openMany".
  // resolve(null) on cancel; save → { dir, name }, open → [paths].
  function browse(kind, opts) {
    ensureCss();
    var stale = doc.getElementById("oros-pcd");
    if (stale) { try { stale.close(); } catch (e) {} stale.remove(); }
    return new Promise(function (resolve) {
      var done = false;
      function finish(v) { if (done) return; done = true; try { d.close(); } catch (e) {} resolve(v); }
      var d = el("dialog");
      d.id = "oros-pcd";
      d.appendChild(el("h3", "", T(kind === "save" ? "pcd.saveTitle" : "pcd.openTitle")));
      var crumbs = el("nav", "pcd-crumbs");
      d.appendChild(crumbs);
      var list = el("ul", "pcd-list");
      list.setAttribute("role", "listbox");
      d.appendChild(list);
      var input = null, hint = null;
      if (kind === "save") {
        var row = el("div", "pcd-name");
        var lab = el("label", "", T("pcd.name"));
        input = el("input");
        input.type = "text";
        input.spellcheck = false;
        input.value = opts.name || "";
        input.setAttribute("aria-label", T("pcd.name"));
        lab.htmlFor = input.id = "oros-pcd-name";
        row.appendChild(lab);
        row.appendChild(input);
        d.appendChild(row);
      }
      hint = el("p", "pcd-hint");
      hint.setAttribute("aria-live", "polite");
      d.appendChild(hint);
      var btns = el("div", "pcd-btns");
      var newDir = button(T("pcd.newFolder"), "", function () { makeFolder(); });
      btns.appendChild(newDir);
      btns.appendChild(el("span", "pcd-sp"));
      btns.appendChild(button(T("pcd.cancel"), "", function () { finish(null); }));
      var ok = button(T(kind === "save" ? "pcd.save" : "pcd.open"), "primary", function () { submit(); });
      btns.appendChild(ok);
      d.appendChild(btns);
      d.addEventListener("cancel", function (e) { e.preventDefault(); finish(null); });
      d.addEventListener("close", function () { if (!done) { done = true; resolve(null); } d.remove(); });

      var accepts = acceptTest(opts.accept);
      var dir = null, picked = {}, entries = [], token = 0, roots = null, first = true;

      function paintCrumbs() {
        crumbs.innerHTML = "";
        var parts = [{ name: T("pcd.pc"), path: null }];
        if (dir) {
          var segs = dir.split("/").slice(1), p = "";
          for (var i = 0; i < segs.length; i++) {
            p += "/" + segs[i];
            if (segs[0] === "disks" && i === 0) continue;
            parts.push({ name: i === 0 && segs[0] === "home" ? T("pcd.home") : folderLabel(segs[i], parentOf(p)), path: p });
          }
        }
        parts.forEach(function (c, i) {
          if (i) crumbs.appendChild(el("span", "", "/"));
          crumbs.appendChild(button(c.name, "", function () { go(c.path); }));
        });
      }
      function rowBtn(icon, name, sub, onClick, sel, dim) {
        var li = el("li");
        var b = el("button", "pcd-row" + (dim ? " dim" : ""));
        b.type = "button";
        b.setAttribute("role", "option");
        b.setAttribute("aria-selected", sel ? "true" : "false");
        b.innerHTML = icon;
        b.appendChild(el("span", "pcd-n", name));
        if (sub) b.appendChild(el("span", "pcd-s", sub));
        if (!dim) b.addEventListener("click", onClick);
        li.appendChild(b);
        return li;
      }
      function paintState() {
        var n = Object.keys(picked).length;
        newDir.disabled = !dir;
        if (kind === "save") ok.disabled = !dir || !input.value;
        else ok.disabled = n === 0;
      }
      function go(p) {
        dir = p;
        picked = {};
        hint.textContent = "";
        paintCrumbs();
        paintState();
        list.innerHTML = "";
        var my = ++token;
        if (!p) {
          (roots ? Promise.resolve(roots) : call("GET", "roots")).then(function (r) {
            roots = r;
            if (my !== token) return;
            list.appendChild(rowBtn(FOLDER, T("pcd.home"), "", function () { go("/home"); }));
            (r && r.disks || []).forEach(function (dk) {
              if (kind === "save" && dk.readonly) {
                list.appendChild(rowBtn(FOLDER, dk.name, T("pcd.readonly"), null, false, true));
                return;
              }
              list.appendChild(rowBtn(FOLDER, dk.name, dk.readonly ? T("pcd.readonly") : "", function () { go(dk.path); }));
            });
          }, fail);
          return;
        }
        saveLast(p);
        call("GET", "list", q(p)).then(function (l) {
          if (my !== token) return;
          entries = (l || []).slice().sort(function (a, b) {
            if (!!a.dir !== !!b.dir) return a.dir ? -1 : 1;
            return String(a.name).localeCompare(String(b.name), undefined, { numeric: true });
          });
          var shown = 0;
          entries.forEach(function (e) {
            if (e.dir) {
              shown++;
              list.appendChild(rowBtn(FOLDER, folderLabel(e.name, p), "", function () { go(e.path); }));
              return;
            }
            var fits = accepts(e.name);
            if (kind === "save") {
              // Files show dimmed: a click takes the name.
              list.appendChild(rowBtn(FILE, e.name, fmtSize(e.size || 0), function () {
                input.value = e.name;
                paintState();
                input.focus();
              }));
              shown++;
              return;
            }
            if (!fits) return;
            shown++;
            var li = rowBtn(FILE, e.name, fmtSize(e.size || 0), function () {
              if (kind === "open") { picked = {}; picked[e.path] = e; submit(); return; }
              if (picked[e.path]) delete picked[e.path]; else picked[e.path] = e;
              li.firstChild.setAttribute("aria-selected", picked[e.path] ? "true" : "false");
              paintState();
            });
            list.appendChild(li);
          });
          if (!shown) list.appendChild(el("li", "pcd-msg", T("pcd.empty")));
          first = false;
        }, function (e) {
          // The last folder is gone (a stick taken out): start at the top.
          if (first && my === token && e && e.status === 404) { first = false; go(null); return; }
          fail(e);
        });
      }
      function fail(e) {
        hint.textContent = T("pcd.failed", { m: (e && e.message) || "" });
      }
      function makeFolder() {
        if (!dir) return;
        var taken = entries.map(function (e) { return e.name; });
        var name = uniqueName(T("pcd.newFolderName"), taken);
        call("POST", "op", "", JSON.stringify({ op: "mkdir", path: dir + "/" + name }), "application/json")
          .then(function () { go(dir + "/" + name); }, fail);
      }
      function submit() {
        if (kind === "save") {
          var name = input.value;
          if (!dir) return;
          if (!validName(name)) { hint.textContent = T("pcd.badName"); input.focus(); return; }
          finish({ dir: dir, name: name, exists: entries.some(function (e) { return !e.dir && e.name.toLowerCase() === name.toLowerCase(); }) });
          return;
        }
        var paths = Object.keys(picked);
        if (paths.length) finish(paths.map(function (p) { return picked[p]; }));
      }
      if (input) {
        input.addEventListener("input", function () { hint.textContent = ""; paintState(); });
        input.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); submit(); } });
      }
      doc.body.appendChild(d);
      d.showModal();
      go(cleanDir(opts.dir) || null);
      if (input) {
        input.focus();
        var dot = input.value.lastIndexOf(".");
        try { input.setSelectionRange(0, dot > 0 ? dot : input.value.length); } catch (e) {}
      }
    });
  }

  // A small yes / no on top of the browser (centered, R32).
  function ask(text, yes, no) {
    ensureCss();
    return new Promise(function (resolve) {
      var d = el("dialog");
      d.id = "oros-pcd";
      d.className = "pcd-ask";
      d.appendChild(el("p", "", text));
      var btns = el("div", "pcd-btns");
      btns.appendChild(el("span", "pcd-sp"));
      btns.appendChild(button(no, "", function () { d.close(); resolve(false); }));
      btns.appendChild(button(yes, "primary", function () { d.close(); resolve(true); }));
      d.appendChild(btns);
      d.addEventListener("cancel", function () { resolve(false); });
      d.addEventListener("close", function () { d.remove(); });
      doc.body.appendChild(d);
      d.showModal();
    });
  }

  function isBlob(b) {
    return !!b && typeof b === "object" && typeof b.size === "number" && typeof b.type === "string" && typeof b.slice === "function";
  }
  function put(path, blob, replace, ifmtime) {
    var s = q(path) + (replace ? "&replace=1" : "") + (ifmtime ? "&ifmtime=" + Math.floor(ifmtime) : "");
    return call("PUT", "raw", s, blob, "application/octet-stream");
  }
  function note(text) {
    try { if (w.orosNotifs && typeof w.orosNotifs.transient === "function") w.orosNotifs.transient({ ns: "files", title: text }); } catch (e) {}
  }

  function saveFile(opts) {
    opts = opts || {};
    var blob = isBlob(opts.blob) ? opts.blob
      : new Blob([String(opts.text !== undefined ? opts.text : "")], { type: typeof opts.mime === "string" ? opts.mime : "text/plain" });
    var name = typeof opts.filename === "string" && opts.filename ? baseName(opts.filename) : "orOS-export.txt";
    var dir0 = startDir(name, opened, readLast());
    function attempt(dir, fname, exists) {
      var path = dir + "/" + fname;
      var o = opened[fname.toLowerCase()];
      var same = o && o.path === path;
      var go = exists && !same
        ? ask(T("pcd.replace", { name: fname }), T("pcd.replaceYes"), T("pcd.cancel"))
        : Promise.resolve(true);
      return go.then(function (yes) {
        if (!yes) return { ok: false, mode: "computer" };
        return put(path, blob, exists, same ? o.mtime : 0).then(function () {
          // The new copy is ours now: the next save replaces it again.
          return call("GET", "stat", q(path)).then(function (st) {
            opened[fname.toLowerCase()] = { dir: dir, path: path, mtime: st && st.mtime || 0 };
          }, function () {}).then(function () {
            note(T("pcd.saved", { name: fname }));
            return { ok: true, mode: "computer", path: path };
          });
        }, function (e) {
          if (e && e.code === "changed") {
            // Changed elsewhere since it was opened: never overwrite.
            return ask(T("pcd.changed", { name: fname }), T("pcd.saveCopy"), T("pcd.cancel")).then(function (copy) {
              if (!copy) return { ok: false, mode: "computer" };
              return call("GET", "list", q(dir)).then(function (l) {
                var n = uniqueName(fname, (l || []).map(function (x) { return x.name; }));
                return attempt(dir, n, false);
              });
            });
          }
          if (e && e.code === "exists") return attempt(dir, fname, true);
          return ask(T("pcd.failed", { m: (e && e.message) || "" }), T("pcd.retry"), T("pcd.cancel")).then(function (again) {
            return again ? pick() : { ok: false, mode: "computer" };
          });
        });
      });
    }
    function pick() {
      return browse("save", { name: name, dir: dir0, accept: "" }).then(function (r) {
        if (!r) return { ok: false, mode: "computer" };
        name = r.name;
        dir0 = r.dir;
        return attempt(r.dir, r.name, r.exists);
      });
    }
    return pick();
  }

  function readFile(e) {
    if ((e.size || 0) > MAX_OPEN) return Promise.reject(new Error(T("pcd.tooBig")));
    return fetch(API + "raw?" + q(e.path), { credentials: "same-origin", cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      var m = Number(r.headers.get("X-Oros-MTime")) || e.mtime || Date.now();
      return r.blob().then(function (b) {
        var name = baseName(e.path);
        opened[name.toLowerCase()] = { dir: parentOf(e.path), path: e.path, mtime: m };
        return new File([b], name, { type: b.type || "", lastModified: m });
      });
    });
  }
  function openFile(accept) {
    return browse("open", { accept: accept, dir: readLast() || "/home/Documents" }).then(function (list) {
      if (!list || !list.length) return null;
      return readFile(list[0]).then(null, function (e) { note(T("pcd.failed", { m: e.message })); return null; });
    });
  }
  function openFiles(accept) {
    return browse("openMany", { accept: accept, dir: readLast() || "/home/Documents" }).then(function (list) {
      if (!list || !list.length) return null;
      var out = [], chain = Promise.resolve();
      list.forEach(function (e) {
        chain = chain.then(function () { return readFile(e).then(function (f) { out.push(f); }, function () {}); });
      });
      return chain.then(function () { return out.length ? out : null; });
    });
  }

  w.orosPcDialog = {
    // shell.js computerFiles(): the launcher answered.
    enable: function () {
      if (enabled || !w.orosDialog) return;
      enabled = true;
      var D = w.orosDialog;
      orig = { saveFile: D.saveFile, openFile: D.openFile, openFiles: D.openFiles, mode: D.mode };
      D.saveFile = saveFile;
      D.openFile = openFile;
      D.openFiles = openFiles;
      D.mode = function () { return "computer"; };
    },
    enabled: function () { return enabled; },
    // The file a name was opened from, for a caller that wants to say so.
    origin: function (name) {
      var o = opened[String(name || "").toLowerCase()];
      return o ? o.path : null;
    }
  };
})(typeof window !== "undefined" ? window : null);
