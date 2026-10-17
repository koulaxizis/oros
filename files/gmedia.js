// orOS Files — one-time import from Google Drive and Google Photos
// (files/gmedia.js; Photo Lab loads it too, for one picture, and
// Writer, Spreadsheet and Slides, for one document).
//
// The sign-in, the token and its revoke are /google-import.js's
// (window.OrosGoogleImport); this file asks Google's own pickers what
// the person chose and downloads exactly that, while the token lives.
// Nothing else of the account is seen:
//   Google Photos — Photos Picker API, scope photospicker.mediaitems.
//     readonly. A picking session is made (POST sessions), the person
//     picks in Google Photos in a window opened from a click
//     (pickerUri + "/autoclose"), orOS polls the session until
//     mediaItemsSet (Google's pollingConfig, with our own limit),
//     lists the picked items, downloads baseUrl + "=d" (photo) or
//     "=dv" (video) with the token, then ends the session (DELETE).
//   Google Drive — scope drive.file: only the files picked in the
//     Google Picker (Google's script, apis.google.com/js/api.js,
//     loaded on the click, never before; it needs a browser API key,
//     OrosGoogleImport.apiKey()). Each picked file:
//     its metadata, then alt=media; Google Docs, Sheets, Slides and
//     Drawings are exported (docx, xlsx, pptx, png; pdf otherwise).
// Caps: number of files, size of one file, total size.
//
// Pure (tests/google-import.test.js):
//   safeName(name, fallback) · photoItem(it) · exportFor(mime)
//   driveName(meta) · duration("5s") → ms · plan(found, existing)
//   folderFor(kind, rootNames, lang)
//   docMimes(kind) · docMessage(err, lang)
// Browser: readPhotos(api, hooks, caps) · readDrive(api, token, hooks,
//   caps) → { items: [{ key, name, blob, size, mime }], skipped:
//   [{ name, why }] } · loadPicker() · showPicker(token, opts)
//   docReady() · pickDoc(kind, lang, hooks) → File | null: one Google
//   Doc / Sheet / Slides (or Office / OpenDocument) file straight into
//   Writer, Spreadsheet or Slides ("document" / "spreadsheet" /
//   "presentation")
// ============================================================
(function (root) {
  "use strict";

  var PHOTOS = "https://photospicker.googleapis.com/v1/";
  var DRIVE = "https://www.googleapis.com/drive/v3/files/";
  var GAPI = "https://apis.google.com/js/api.js";
  var CAPS = { count: 100, file: 100 * 1024 * 1024, total: 500 * 1024 * 1024 };
  var POLL_MAX = 20 * 60 * 1000;           // our own limit on the picking
  var FOLDERS = {
    drive: { en: "Imported from Google Drive", el: "Εισαγωγή από το Google Drive" },
    photos: { en: "Imported from Google Photos", el: "Εισαγωγή από το Google Photos" }
  };
  // Google's own formats → what orOS's apps open
  var EXPORTS = {
    "application/vnd.google-apps.document": { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ext: ".docx" },
    "application/vnd.google-apps.spreadsheet": { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext: ".xlsx" },
    "application/vnd.google-apps.presentation": { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", ext: ".pptx" },
    "application/vnd.google-apps.drawing": { mime: "image/png", ext: ".png" }
  };
  var EXT = {
    "image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif", "image/webp": ".webp", "image/heic": ".heic",
    "image/heif": ".heif", "image/avif": ".avif", "video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm",
    "video/3gpp": ".3gp", "application/pdf": ".pdf"
  };

  function str(v, n) { return (typeof v === "string" ? v : "").slice(0, n); }
  function err(code, detail) { var e = new Error(code); e.code = code; e.detail = detail || ""; return e; }
  function okId(s) { return typeof s === "string" && /^[A-Za-z0-9_.-]{1,300}$/.test(s); }

  // A name the disk takes: no path signs, no control characters, not
  // empty, not "." / "..", at most 180 characters (the extension kept).
  function safeName(name, fallback) {
    var n = str(name, 1000).replace(/[\u0000-\u001f\u007f]/g, "").replace(/[\/\\:*?"<>|]/g, "_").replace(/\s+/g, " ").trim();
    if (n.length > 180) {
      var dot = n.lastIndexOf("."), ext = dot > 0 && n.length - dot <= 10 ? n.slice(dot) : "";
      n = n.slice(0, 180 - ext.length) + ext;
    }
    if (!n || /^\.+$/.test(n) || n === ".trash") n = fallback || "file";
    return n;
  }
  function withExt(name, ext) {
    return ext && name.toLowerCase().slice(-ext.length) !== ext ? name + ext : name;
  }

  // "5s" / "1.5s" / "1800s" (Google's Duration) → ms; NaN when not one
  function duration(s) {
    var m = /^(\d{1,7}(?:\.\d{1,9})?)s$/.exec(String(s || ""));
    return m ? Math.round(parseFloat(m[1]) * 1000) : NaN;
  }

  // ---- Google Photos ----
  // One picked item → { key, id, name, mime, video, url } or null
  function photoItem(it) {
    if (!it || typeof it !== "object" || !okId(it.id)) return null;
    var f = it.mediaFile;
    if (!f || typeof f.baseUrl !== "string" || !/^https:\/\/[a-z0-9.-]+\.(googleusercontent|google)\.com\//.test(f.baseUrl)) return null;
    var video = it.type === "VIDEO" || /^video\//.test(str(f.mimeType, 100));
    var mime = str(f.mimeType, 100).toLowerCase();
    var base = (video ? "video-" : "photo-") + it.id.slice(0, 12);
    var name = safeName(f.filename, withExt(base, EXT[mime] || (video ? ".mp4" : ".jpg")));
    if (!/\.[A-Za-z0-9]{2,5}$/.test(name) && EXT[mime]) name += EXT[mime];
    var vm = f.mediaFileMetadata && f.mediaFileMetadata.videoMetadata;
    return {
      key: "gp:" + it.id, id: it.id, name: name, mime: mime, video: video,
      // a video Google is still processing cannot be downloaded yet
      ready: !(video && vm && vm.processingStatus && vm.processingStatus !== "READY"),
      url: f.baseUrl + (video ? "=dv" : "=d"),
      time: str(it.createTime, 40)
    };
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // hooks: { open(uri) → Promise (the UI opens Google's picker window
  // from a click and resolves; rejects to stop), stopped() → true when
  // the person gave up, progress(phase, n, total), sleep(ms) }
  function readPhotos(api, hooks, caps) {
    hooks = hooks || {};
    caps = caps || CAPS;
    var wait = hooks.sleep || sleep;
    var sid = "", out = { items: [], skipped: [] };
    var cfg = caps.count ? { pickingConfig: { maxItemCount: String(caps.count) } } : {};
    function end() {
      if (!sid) return Promise.resolve();
      var u = PHOTOS + "sessions/" + encodeURIComponent(sid);
      sid = "";
      return api.send(u, "DELETE").catch(function () {});
    }
    return api.send(PHOTOS + "sessions", "POST", cfg).then(function (s) {
      if (!s || !okId(s.id) || typeof s.pickerUri !== "string" || !/^https:\/\/[a-z0-9.-]+\.google\.com\//.test(s.pickerUri)) throw err("http", "session");
      sid = s.id;
      var uri = s.pickerUri.replace(/\/+$/, "") + "/autoclose";
      return Promise.resolve(hooks.open ? hooks.open(uri) : null).then(function () { return poll(s); });
    }).then(function () {
      var list = [];
      if (hooks.progress) hooks.progress("list", 0, 0);
      return api.pages(function (cur) {
        return PHOTOS + "mediaItems?sessionId=" + encodeURIComponent(sid) + "&pageSize=100" + (cur ? "&pageToken=" + encodeURIComponent(cur) : "");
      }, function (d) {
        (d && Array.isArray(d.mediaItems) ? d.mediaItems : []).forEach(function (it) { list.push(it); });
        return list.length >= caps.count * 2 ? "" : api.nextToken(d);
      }, 20).then(function () { return list; });
    }).then(function (list) {
      return download(api, list.map(function (it) {
        var p = photoItem(it);
        if (!p) out.skipped.push({ name: str(it && it.mediaFile && it.mediaFile.filename, 120) || "?", why: "bad" });
        else if (!p.ready) { out.skipped.push({ name: p.name, why: "notready" }); p = null; }
        return p;
      }).filter(Boolean), caps, hooks, out);
    }).then(function () {
      return end().then(function () { return out; });
    }, function (e) {
      return end().then(function () { throw e; });
    });

    function poll(s) {
      var start = Date.now();
      function limit(pc) {
        var t = duration(pc && pc.timeoutIn);
        return Math.min(POLL_MAX, isFinite(t) && t > 0 ? t : POLL_MAX);
      }
      function every(pc) {
        var t = duration(pc && pc.pollInterval);
        return Math.max(1000, Math.min(30000, isFinite(t) ? t : 5000));
      }
      var until = start + limit(s.pollingConfig), step = every(s.pollingConfig);
      function once() {
        if (hooks.stopped && hooks.stopped()) return Promise.reject(err("cancelled"));
        return api.getJson(PHOTOS + "sessions/" + encodeURIComponent(sid)).then(function (d) {
          if (d && d.mediaItemsSet === true) return true;
          if (d && d.pollingConfig) { step = every(d.pollingConfig); until = Math.min(until, Date.now() + limit(d.pollingConfig)); }
          if (Date.now() + step > until) throw err("timeout");
          if (hooks.progress) hooks.progress("wait", 0, 0);
          return wait(step).then(once);
        });
      }
      return once();
    }
  }

  // Every item in turn, within the caps; one item that fails is
  // skipped (and said), the rest go on.
  function download(api, list, caps, hooks, out) {
    var total = 0, n = 0, seen = {};
    return list.reduce(function (p, it) {
      return p.then(function () {
        if (hooks.stopped && hooks.stopped()) throw err("cancelled");
        if (seen[it.key]) return;
        seen[it.key] = true;
        if (out.items.length >= caps.count) { out.skipped.push({ name: it.name, why: "count" }); return; }
        if (it.size && it.size > caps.file) { out.skipped.push({ name: it.name, why: "big" }); return; }
        if (it.size && total + it.size > caps.total) { out.skipped.push({ name: it.name, why: "total" }); return; }
        if (hooks.progress) hooks.progress("get", ++n, list.length);
        return api.getBlob(it.url, Math.min(caps.file, caps.total - total)).then(function (b) {
          total += b.size;
          out.items.push({ key: it.key, name: it.name, blob: b, size: b.size, mime: it.mime || b.type || "", time: it.time || "" });
        }, function (e) {
          var c = e && e.code;
          if (c === "auth") throw e;
          out.skipped.push({ name: it.name, why: c === "big" ? (total && caps.total - total < caps.file ? "total" : "big") : "fail" });
        });
      });
    }, Promise.resolve());
  }

  // ---- Google Drive ----
  function exportFor(mime) { return EXPORTS[mime] || null; }
  // Folders, shortcuts, Forms, Sites, My Maps: nothing to download
  function driveKind(mime) {
    if (EXPORTS[mime]) return "export";
    if (/^application\/vnd\.google-apps\./.test(mime)) return "none";
    return "file";
  }
  function driveName(meta) {
    var x = exportFor(meta.mimeType);
    var name = safeName(meta.name, "drive-" + String(meta.id).slice(0, 12));
    return x ? withExt(name, x.ext) : name;
  }
  function driveItem(meta) {
    if (!meta || !okId(meta.id)) return null;
    var mime = str(meta.mimeType, 200);
    var kind = driveKind(mime), x = exportFor(mime);
    var size = Number(meta.size);
    return {
      key: "gd:" + meta.id, id: meta.id, name: driveName({ id: meta.id, name: meta.name, mimeType: mime }), kind: kind,
      mime: x ? x.mime : mime, size: isFinite(size) && size > 0 ? size : 0,
      url: x ? DRIVE + encodeURIComponent(meta.id) + "/export?mimeType=" + encodeURIComponent(x.mime)
             : DRIVE + encodeURIComponent(meta.id) + "?alt=media&supportsAllDrives=true",
      time: str(meta.modifiedTime, 40)
    };
  }
  // hooks: { pick(token) → Promise [{ id, name, mimeType }] (the Google
  // Picker; [] when cancelled), stopped(), progress(phase, n, total) }
  function readDrive(api, token, hooks, caps) {
    hooks = hooks || {};
    caps = caps || CAPS;
    var out = { items: [], skipped: [], picked: 0 };
    return Promise.resolve(hooks.pick(token)).then(function (docs) {
      docs = (Array.isArray(docs) ? docs : []).filter(function (d) { return d && okId(d.id); });
      out.picked = docs.length;
      var metas = [];
      if (hooks.progress) hooks.progress("list", 0, docs.length);
      return docs.slice(0, caps.count * 2).reduce(function (p, d) {
        return p.then(function () {
          return api.getJson(DRIVE + encodeURIComponent(d.id) + "?fields=id,name,mimeType,size,modifiedTime&supportsAllDrives=true")
            .then(function (m) { metas.push(m); });
        });
      }, Promise.resolve()).then(function () { return metas; });
    }).then(function (metas) {
      var list = [];
      metas.forEach(function (m) {
        var it = driveItem(m);
        if (!it) out.skipped.push({ name: str(m && m.name, 120) || "?", why: "bad" });
        else if (it.kind === "none") out.skipped.push({ name: it.name, why: "unsupported" });
        else list.push(it);
      });
      return download(api, list, caps, hooks, out);
    }).then(function () { return out; });
  }

  // The Google Picker (browser): Google's script, loaded once, on demand.
  var pickerP = null;
  function loadPicker() {
    if (pickerP) return pickerP;
    pickerP = new Promise(function (resolve, reject) {
      function ready() {
        try {
          root.gapi.load("picker", { callback: function () { resolve(); }, onerror: function () { reject(err("network", "picker")); },
            timeout: 20000, ontimeout: function () { reject(err("network", "picker")); } });
        } catch (e) { reject(err("network", "picker")); }
      }
      if (root.gapi && root.gapi.load) { ready(); return; }
      var s = document.createElement("script");
      s.src = GAPI;
      s.async = true;
      s.onload = ready;
      s.onerror = function () { reject(err("network", "picker")); };
      document.head.appendChild(s);
    });
    pickerP.catch(function () { pickerP = null; });
    return pickerP;
  }
  // opts: { key, appId, lang, max, mimes } → Promise [docs] ([] =
  // cancelled); mimes limits what the picker shows
  function showPicker(token, opts) {
    opts = opts || {};
    return loadPicker().then(function () {
      return new Promise(function (resolve) {
        var G = root.google && root.google.picker;
        if (!G) { resolve([]); return; }
        var view = new G.DocsView(G.ViewId.DOCS).setIncludeFolders(true).setSelectFolderEnabled(false);
        if (Array.isArray(opts.mimes) && opts.mimes.length) view.setMimeTypes(opts.mimes.join(","));
        var b = new G.PickerBuilder()
          .addView(view)
          .enableFeature(G.Feature.MULTISELECT_ENABLED)
          .setOAuthToken(token)
          .setDeveloperKey(opts.key)
          .setAppId(opts.appId)
          .setOrigin(location.protocol + "//" + location.host)
          .setLocale(opts.lang === "el" ? "el" : "en")
          .setCallback(function (d) {
            var a = d && d[G.Response.ACTION];
            if (a === G.Action.PICKED) resolve((d[G.Response.DOCUMENTS] || []).map(function (x) {
              return { id: x[G.Document.ID], name: x[G.Document.NAME], mimeType: x[G.Document.MIME_TYPE] };
            }));
            else if (a === G.Action.CANCEL) resolve([]);
          });
        if (opts.max && typeof b.setMaxItems === "function") b.setMaxItems(opts.max);
        var w = Math.min(1051, Math.max(566, (root.innerWidth || 800) - 16));
        var h = Math.min(650, Math.max(350, (root.innerHeight || 600) - 16));
        b.setSize(w, h);
        b.build().setVisible(true);
      });
    });
  }

  // ---- where it goes, and what is there already ----
  // An existing folder in either language is used; else the person's.
  function folderFor(kind, rootNames, lang) {
    var f = FOLDERS[kind];
    var names = Array.isArray(rootNames) ? rootNames : [];
    if (names.indexOf(f.en) !== -1) return f.en;
    if (names.indexOf(f.el) !== -1) return f.el;
    return f[lang === "el" ? "el" : "en"];
  }
  function uniqueName(name, taken) {
    if (taken.indexOf(name) === -1) return name;
    var dot = name.lastIndexOf(".");
    var base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : "";
    var i = 1;
    while (taken.indexOf(base + " (" + i + ")" + ext) !== -1) i++;
    return base + " (" + i + ")" + ext;
  }
  // Is `have` (a name in the folder) this name, or it made unique?
  function sameName(have, name) {
    if (have === name) return true;
    var dot = name.lastIndexOf(".");
    var base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : "";
    if (have.slice(0, base.length + 2) !== base + " (" || have.slice(have.length - ext.length) !== ext) return false;
    return /^\d{1,4}\)$/.test(have.slice(base.length + 2, have.length - ext.length));
  }
  // found: [{ key, name, size }], existing: [{ name, size, dir }] in the
  // target folder. Files keeps no metadata of its own, so "already
  // there" is the same name (or that name made unique) and the same size.
  // → { add: [{ item, name }], dup: [item] }
  function plan(found, existing) {
    var have = (Array.isArray(existing) ? existing : []).filter(function (e) { return e && typeof e.name === "string"; });
    var taken = have.map(function (e) { return e.name; });
    var add = [], dup = [], keys = {};
    (Array.isArray(found) ? found : []).forEach(function (it) {
      if (keys[it.key]) return;
      keys[it.key] = true;
      var there = have.some(function (e) { return !e.dir && e.size === it.size && sameName(e.name, it.name); });
      if (there) { dup.push(it); return; }
      var name = uniqueName(it.name, taken);
      taken.push(name);
      add.push({ item: it, name: name });
    });
    return { add: add, dup: dup };
  }

  // ---- one document for an app's own import (Writer, Spreadsheet,
  // Slides): Google's own format plus the files that app opens ----
  var DOC_CAPS = { count: 1, file: 50 * 1024 * 1024, total: 50 * 1024 * 1024 };
  var DOC_MIMES = {
    document: ["application/vnd.google-apps.document",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.oasis.opendocument.text", "application/rtf", "text/rtf",
      "text/plain", "text/markdown", "text/html"],
    spreadsheet: ["application/vnd.google-apps.spreadsheet",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel", "application/vnd.oasis.opendocument.spreadsheet"],
    presentation: ["application/vnd.google-apps.presentation",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/vnd.oasis.opendocument.presentation", "text/markdown"]
  };
  function docMimes(kind) { return DOC_MIMES[kind] ? DOC_MIMES[kind].slice() : null; }
  var DOC_TEXT = {
    en: { picker: "Google Drive's file picker did not load. Check the connection and try again.",
      fail: "This file could not be brought in from Google Drive." },
    el: { picker: "Η επιλογή αρχείων του Google Drive δεν φόρτωσε. Έλεγξε τη σύνδεση και δοκίμασε ξανά.",
      fail: "Αυτό το αρχείο δεν ήρθε από το Google Drive." }
  };
  // The person-facing text for a pickDoc failure ("" = they cancelled)
  function docMessage(e, lang) {
    var tx = DOC_TEXT[lang === "el" ? "el" : "en"], c = e && e.code;
    if (c === "cancelled") return "";
    if (c === "network" && e.detail === "picker") return tx.picker;
    if (c === "fail") return tx.fail;
    var GI = root && root.OrosGoogleImport;
    return GI ? GI.message(e, lang) : tx.fail;
  }
  function docReady() {
    var GI = root && root.OrosGoogleImport;
    return !!(GI && typeof GI.driveReady === "function" && GI.driveReady());
  }
  // Sign in (call it inside the click), pick ONE file of that kind in
  // the Google Picker, download it while the token lives, revoke.
  // hooks: { picking() (the picker is about to show) }
  // → Promise File, or null when nothing was picked
  function pickDoc(kind, lang, hooks) {
    var GI = root && root.OrosGoogleImport, mimes = docMimes(kind);
    hooks = hooks || {};
    if (!GI || !mimes) return Promise.reject(err("other", "drive"));
    return GI.run({
      scope: GI.SCOPES.drive,
      read: function (token, api) {
        return readDrive(api, token, {
          pick: function (tk) {
            if (hooks.picking) hooks.picking();
            return showPicker(tk, { key: GI.apiKey(), appId: GI.appId(), lang: lang, max: 1, mimes: mimes });
          }
        }, DOC_CAPS);
      }
    }).then(function (res) {
      var d = res && res.data, it = d && d.items[0];
      if (!it) { if (d && d.picked) throw err("fail"); return null; }
      try { return new File([it.blob], it.name, { type: it.mime || it.blob.type || "" }); }
      catch (e) { var b = it.blob; try { b.name = it.name; } catch (x) {} return b; }
    });
  }

  var api = {
    CAPS: CAPS, docMimes: docMimes, docMessage: docMessage, docReady: docReady, pickDoc: pickDoc, FOLDERS: FOLDERS, safeName: safeName, duration: duration, photoItem: photoItem,
    exportFor: exportFor, driveName: driveName, driveItem: driveItem, plan: plan, folderFor: folderFor, sameName: sameName,
    readPhotos: readPhotos, readDrive: readDrive, loadPicker: loadPicker, showPicker: showPicker
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.OrosGoogleMedia = api;
})(typeof window !== "undefined" ? window : null);
