// ============================================================
// orOS Library — disk, files and book details (v1.0.0)
//   - finds every .epub / .pdf / .fb2 / .cbz / .cbr on the orOS disk (window.parent.orosFS)
//     and knows which file is which book on THIS device:
//     oros-library-paths { ver, map: { path: { s: size, t: mtime, id } } }
//     (device-local, never synced: two devices may keep one book in
//     different folders, and the synced record must not ping-pong)
//   - the book id is "b" + the first 16 hex of the file's SHA-256
//   - adds files from the device into /internal/Books (≤ 50 MB);
//     a file already in the library is never copied twice
//   - reads a book's details: EPUB package (title, author, language,
//     year, cover) or PDF info (title, author, pages, first page);
//     FB2, CBZ and CBR are built into an EPUB in memory first (openEpub)
//   - covers: small JPEG data URLs in IndexedDB "oros-library-cache"
//     (this device only; rebuilt whenever missing)
//   - PDF.js (vendor/pdfjs, Apache-2.0) is loaded only when needed,
//     with eval off; the file's scripts and forms never run.
// ============================================================
(function () {
  "use strict";

  var LIB = window.LIB, C = LIB.C;
  var PATHS_KEY = "oros-library-paths";
  var BOOKS_DIR = "/internal/Books";
  var ROOT = "/internal";
  var MAX_SCAN = 6000, MAX_DEPTH = 10;
  var COVER_W = 240;

  function fs() {
    try {
      var p = window.parent && window.parent !== window ? window.parent.orosFS : null;
      return p && typeof p.ls === "function" && typeof p.readBlob === "function" ? p : null;
    } catch (e) { return null; }
  }

  // ---------- Path map (device-local) ----------
  var paths = { ver: 1, map: {} };
  function loadPaths() {
    try {
      var p = JSON.parse(localStorage.getItem(PATHS_KEY) || "null");
      if (p && p.map && typeof p.map === "object") paths = { ver: 1, map: p.map };
    } catch (e) {}
  }
  function savePaths() {
    try { localStorage.setItem(PATHS_KEY, JSON.stringify(paths)); } catch (e) {}
  }
  loadPaths();
  function idAt(path) { var r = paths.map[path]; return r && r.id ? r.id : null; }
  function pathsOf(id) {
    return Object.keys(paths.map).filter(function (p) { return paths.map[p].id === id; }).sort();
  }

  // ---------- Hash ----------
  function sha256(buf) {
    return crypto.subtle.digest("SHA-256", buf).then(function (d) {
      var a = new Uint8Array(d), s = "";
      for (var i = 0; i < a.length; i++) s += (a[i] < 16 ? "0" : "") + a[i].toString(16);
      return s;
    });
  }

  // ---------- Scan ----------
  // Lists every .epub / .pdf under /internal (breadth first, bounded).
  function listBooks() {
    var api = fs();
    if (!api) return Promise.resolve(null);
    var found = [], queue = [{ p: ROOT, d: 0 }], seen = 0;
    function next() {
      if (!queue.length || seen > MAX_SCAN) return Promise.resolve(found);
      var cur = queue.shift();
      return api.ls(cur.p).then(function (list) {
        (list || []).forEach(function (en) {
          if (!en || typeof en.name !== "string" || seen > MAX_SCAN) return;
          seen++;
          var p = cur.p + "/" + en.name;
          if (en.dir) { if (cur.d < MAX_DEPTH && en.name.charAt(0) !== ".") queue.push({ p: p, d: cur.d + 1 }); }
          else if (C.formatOf(en.name)) found.push(p);
        });
      }, function () { /* unreadable folder: skip */ }).then(next);
    }
    return Promise.resolve(typeof api.ready === "function" ? api.ready() : null).then(next);
  }

  // Scan: map new or changed files to books, add unknown books (unless
  // removed on purpose: a tombstone stays until the file is added again
  // by hand). onBook(rec) for each new record. → { files, added }.
  function scan(onProgress) {
    var api = fs();
    if (!api) return Promise.resolve(null);
    return listBooks().then(function (list) {
      if (!list) return null;
      var present = {};
      list.forEach(function (p) { present[p] = 1; });
      var changed = false;
      Object.keys(paths.map).forEach(function (p) { if (!present[p]) { delete paths.map[p]; changed = true; } });
      var added = 0, i = 0;
      function step() {
        if (i >= list.length) { if (changed) savePaths(); return { files: list.length, added: added }; }
        var p = list[i++];
        if (onProgress) onProgress(i, list.length);
        return api.stat(p).then(function (st) {
          var rec = paths.map[p];
          if (rec && rec.s === st.size && rec.t === st.mtime && rec.id) return null;
          if (!(st.size > 0) || st.size > C.maxBytesOf(p)) return null;
          return api.readBlob(p).then(function (blob) {
            return blob.arrayBuffer();
          }).then(function (buf) {
            return sha256(buf).then(function (hex) {
              var id = C.bookIdOf(hex);
              paths.map[p] = { s: st.size, t: st.mtime, id: id };
              changed = true;
              if (LIB.book(id) || LIB.data.tombs[id]) return null;
              return describe(buf, p).then(function (info) {
                LIB.putBook(record(id, hex, p, st.size, info), true);
                if (info.cover) putCover(id, info.cover);
                added++;
              });
            });
          });
        }).catch(function () { /* one bad file never stops the scan */ }).then(step);
      }
      return step();
    });
  }

  function record(id, hex, path, size, info) {
    var r = { id: id, h: hex, fmt: info.fmt, title: info.title || C.titleFromName(path), path: path, size: size, added: Date.now() };
    if (info.kind) r.kind = info.kind;
    if (info.by) r.by = info.by;
    if (info.lang) r.lang = info.lang;
    if (info.year) r.year = info.year;
    if (info.pages) r.pages = info.pages;
    return r;
  }

  // Path of a book on this device: the mapped path that still exists,
  // else the synced hint (a Vault-synced disk keeps the same path) once
  // its content is confirmed by hash. → Promise of path or null.
  function pathOf(book) {
    var api = fs();
    if (!api) return Promise.resolve(null);
    var cands = pathsOf(book.id);
    if (book.path && cands.indexOf(book.path) < 0) cands.push(book.path);
    var i = 0;
    function next() {
      if (i >= cands.length) return null;
      var p = cands[i++];
      return api.stat(p).then(function (st) {
        var rec = paths.map[p];
        if (rec && rec.id === book.id && rec.s === st.size && rec.t === st.mtime) return p;
        return api.readBlob(p).then(function (b) { return b.arrayBuffer(); }).then(sha256).then(function (hex) {
          var id = C.bookIdOf(hex);
          paths.map[p] = { s: st.size, t: st.mtime, id: id };
          savePaths();
          return id === book.id ? p : next();
        });
      }, function () { return next(); });
    }
    return Promise.resolve(next()).catch(function () { return null; });
  }

  function readBytes(path) {
    var api = fs();
    if (!api) return Promise.reject(new Error("nofs"));
    return api.readBlob(path).then(function (b) { return b.arrayBuffer(); }).then(function (buf) { return new Uint8Array(buf); });
  }

  // ---------- Adding files ----------
  function safeName(name) {
    var n = String(name || "book").split(/[\\/]/).pop().replace(/[\u0000-\u001f<>:"|?*]/g, "_").trim();
    if (!n || n === "." || n === "..") n = "book";
    return n.slice(0, 120);
  }
  function freePath(api, dir, name) {
    var dot = name.lastIndexOf("."), base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : "";
    var n = 1;
    function tryOne() {
      var p = dir + "/" + (n === 1 ? name : base + " (" + n + ")" + ext);
      return api.stat(p).then(function () { n++; return n > 200 ? null : tryOne(); }, function () { return p; });
    }
    return tryOne();
  }
  // A File / Blob (with .name) from the device → its book.
  // → Promise of { id, path, isNew } or rejects Error("type"|"big"|"nofs"|"read").
  function addFile(file) {
    var api = fs();
    if (!api) return Promise.reject(new Error("nofs"));
    var fmt = C.formatOf(file && file.name);
    if (!fmt) return Promise.reject(new Error("type"));
    if (!(file.size > 0)) return Promise.reject(new Error("read"));
    if (file.size > C.maxBytesOf(file.name)) return Promise.reject(new Error("big"));
    var buf;
    return file.arrayBuffer().then(function (b) { buf = b; return sha256(b); }).then(function (hex) {
      var id = C.bookIdOf(hex);
      var existing = LIB.book(id);
      return (existing ? pathOf(existing) : Promise.resolve(null)).then(function (have) {
        if (have) {
          if (LIB.data.tombs[id] && !LIB.book(id)) LIB.putBook(existing);
          return { id: id, path: have, isNew: false };
        }
        // same content already somewhere on the disk (removed from the
        // library, or not scanned yet)?
        var known = pathsOf(id);
        var write = known.length ? Promise.resolve(known[0]) :
          api.mkdir(BOOKS_DIR).catch(function () {}).then(function () { return freePath(api, BOOKS_DIR, safeName(file.name)); })
            .then(function (p) {
              if (!p) throw new Error("read");
              var blob = new Blob([buf], { type: MIME_OF[C.kindOf(file.name)] || "application/octet-stream" });
              return (api.writeBlob || api.write)(p, blob).then(function () { return p; });
            });
        return write.then(function (p) {
          return api.stat(p).then(function (st) {
            paths.map[p] = { s: st.size, t: st.mtime, id: id };
            savePaths();
            return describe(buf, p).then(function (info) {
              var rec = existing ? Object.assign({}, existing) : record(id, hex, p, st.size, info);
              if (!existing && info.cover) putCover(id, info.cover);
              LIB.putBook(rec);       // fresh m: brings a removed book back (R17)
              return { id: id, path: p, isNew: !existing };
            });
          });
        });
      });
    });
  }

  // ---------- Book details ----------
  var MIME_OF = { epub: "application/epub+zip", pdf: "application/pdf", fb2: "application/x-fictionbook+xml",
                  cbz: "application/vnd.comicbook+zip", cbr: "application/vnd.comicbook-rar" };
  function describe(buf, path) {
    var fmt = C.formatOf(path), kind = C.kindOf(path);
    var p = fmt === "pdf" ? describePdf(buf) : describeEpub(buf, kind, path);
    var withKind = function (info) { info.fmt = fmt; if (kind === "fb2" || C.isComic(kind)) info.kind = kind; return info; };
    return p.then(withKind, function () { return withKind({ title: C.titleFromName(path) }); });
  }
  function openZip(buf) {
    return window.AtelierZip.open(buf instanceof Uint8Array ? buf : new Uint8Array(buf));
  }
  // → { zip, opfPath, pkg } (pkg = core.parseOpf). kind "fb2" / "cbz":
  // the book is first built in memory (core section 12) and read the
  // same way, from a ZIP-like object.
  function openEpub(bytes, kind, name) {
    var zp;
    if (kind === "fb2") zp = fb2Zip(bytes);
    else if (kind === "cbz") zp = cbzZip(bytes, name);
    else if (kind === "cbr") zp = cbrZip(bytes, name);
    else zp = new Promise(function (res) { res(openZip(bytes)); });
    return zp.then(readPackage);
  }
  // A ZIP-like object over files in memory: { name: string |
  // Uint8Array | { size, read() → Promise<Uint8Array> } }.
  function memZip(files) {
    var enc = new TextEncoder(), dec = new TextDecoder("utf-8");
    var names = Object.keys(files);
    function get(n) {
      var v = files[n];
      if (typeof v === "string") return Promise.resolve(enc.encode(v));
      if (v instanceof Uint8Array) return Promise.resolve(v);
      return v.read();
    }
    return {
      names: names,
      has: function (n) { return Object.prototype.hasOwnProperty.call(files, n); },
      size: function (n) {
        var v = files[n];
        return v === undefined ? 0 : typeof v === "string" ? v.length : v instanceof Uint8Array ? v.length : v.size;
      },
      bytes: function (n, max) {
        if (!this.has(n)) return Promise.reject(new Error("missing"));
        return get(n).then(function (b) { if (max && b.length > max) throw new Error("big"); return b; });
      },
      text: function (n, max) {
        if (!this.has(n)) return Promise.reject(new Error("missing"));
        var v = files[n];
        if (typeof v === "string") return Promise.resolve(max && v.length > max ? v.slice(0, max) : v);
        return get(n).then(function (b) { return dec.decode(b); });
      }
    };
  }
  function b64bytes(s) {
    try {
      var bin = atob(s), out = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    } catch (e) { return null; }
  }
  // FB2 (or .fb2.zip): decode in its own encoding (many are
  // windows-1251 / -1253), build the book.
  function fb2Zip(bytes) {
    var u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var src = u8[0] === 0x50 && u8[1] === 0x4b ? new Promise(function (res) { res(openZip(u8)); }).then(function (z) {
      var n = z.names.filter(function (x) { return /\.fb2$/i.test(x); })[0];
      if (!n) throw new Error("fb2");
      return z.bytes(n, 60 * 1024 * 1024);
    }) : Promise.resolve(u8);
    return src.then(function (b) {
      var head = "";
      for (var i = 0; i < Math.min(300, b.length); i++) head += String.fromCharCode(b[i]);
      var enc = C.fb2Encoding(head), text;
      try { text = new TextDecoder(enc).decode(b); } catch (e) { text = new TextDecoder("utf-8").decode(b); }
      var book = C.fb2Book(text);
      if (!book) throw new Error("fb2");
      var images = [];
      book.images.forEach(function (im) {
        var data = b64bytes(im.b64);
        if (data) images.push({ file: im.file, type: im.type, cover: !!im.cover, data: data });
      });
      return memZip(C.packBook(book.meta, book.chapters, images, book.css));
    });
  }
  // CBZ: the pictures stay in the ZIP and are read when shown.
  function cbzZip(bytes, name) {
    return new Promise(function (res) { res(openZip(bytes)); }).then(function (z) {
      var ci = z.names.filter(function (x) { return /(^|\/)comicinfo\.xml$/i.test(x); })[0];
      return (ci ? z.text(ci, 1024 * 1024).then(C.comicInfo, function () { return {}; }) : Promise.resolve({})).then(function (info) {
        var book = C.cbzBook(z.names, info, C.titleFromName(name || ""));
        if (!book) throw new Error("cbz");
        var images = book.images.map(function (im) {
          return { file: im.file, type: im.type, cover: im.cover,
                   data: { size: z.size(im.src), read: function () { return z.bytes(im.src, 60 * 1024 * 1024); } } };
        });
        return memZip(C.packBook(book.meta, book.chapters, images, book.css));
      });
    });
  }
  // CBR (a RAR of pictures): libarchive.js (vendor/libarchive, MIT;
  // libarchive itself BSD-2-Clause, its own RAR 4 / RAR 5 reader) is
  // loaded only for a .cbr, and works in a module worker. The pictures
  // are read out once and kept in memory while the book is open;
  // nothing in the archive is ever run. A password-protected archive
  // is refused like a DRM book.
  var LA_DIR = "../vendor/libarchive/";
  var laP = null;
  function libarchive() {
    if (laP) return laP;
    var base = new URL(LA_DIR, location.href).href;
    laP = import(base + "libarchive.js").then(function (m) {
      if (!m || !m.Archive) throw new Error("cbr");
      m.Archive.init({ workerUrl: base + "worker-bundle.js" });
      return m.Archive;
    });
    laP.catch(function () { laP = null; });
    return laP;
  }
  function cbrZip(bytes, name) {
    var u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (!(u8[0] === 0x52 && u8[1] === 0x61 && u8[2] === 0x72 && u8[3] === 0x21)) {
      // some ".cbr" files are really ZIPs: read them as a CBZ
      if (u8[0] === 0x50 && u8[1] === 0x4b) return cbzZip(u8, name);
      return Promise.reject(new Error("cbr"));
    }
    return libarchive().then(function (Archive) {
      var file = new File([u8], "comic.cbr", { type: "application/vnd.comicbook-rar" });
      return Archive.open(file).then(function (arc) {
        return arc.hasEncryptedData().then(function (locked) {
          if (locked) { arc.close(); throw new Error("drm"); }
          return arc.extractFiles();
        }).then(function (tree) {
          var files = {}, count = 0;
          (function walk(o, pre, depth) {
            if (!o || typeof o !== "object" || depth > 20) return;
            Object.keys(o).forEach(function (k) {
              var v = o[k];
              if (count > 20000) return;
              if (v instanceof Blob) { files[pre + k] = v; count++; }
              else walk(v, pre + k + "/", depth + 1);
            });
          })(tree, "", 0);
          try { arc.close(); } catch (e) {}
          var names = Object.keys(files);
          var ci = names.filter(function (x) { return /(^|\/)comicinfo\.xml$/i.test(x); })[0];
          var info = ci && files[ci].size < 1024 * 1024 ? files[ci].text().then(C.comicInfo, function () { return {}; }) : Promise.resolve({});
          return info.then(function (meta) {
            var book = C.cbzBook(names, meta, C.titleFromName(name || ""));
            if (!book) throw new Error("cbr");
            var images = book.images.map(function (im) {
              var f = files[im.src];
              return { file: im.file, type: im.type, cover: im.cover,
                       data: { size: f.size, read: function () { return f.arrayBuffer().then(function (b) { return new Uint8Array(b); }); } } };
            });
            return memZip(C.packBook(book.meta, book.chapters, images, book.css));
          });
        });
      });
    });
  }
  function readPackage(zip) {
    var getText = function (name) { return zip.has(name) ? zip.text(name, 8 * 1024 * 1024) : Promise.reject(new Error("missing " + name)); };
    return getText("META-INF/container.xml").then(function (xml) {
      var opf = C.parseContainer(xml);
      if (!opf) throw new Error("epub");
      return getText(opf).then(function (opfXml) {
        return { zip: zip, opfPath: opf, pkg: C.parseOpf(opfXml, opf) };
      });
    });
  }
  function describeEpub(buf, kind, path) {
    return openEpub(buf, kind, path).then(function (e) {
      var m = e.pkg.meta;
      var info = { title: m.title, by: m.by, lang: m.lang, year: m.year, publisher: m.publisher, desc: m.desc };
      var bytes = 0;
      e.pkg.spine.forEach(function (s) { bytes += e.zip.size(s.path) || 0; });
      if (C.isComic(kind)) info.pages = e.pkg.spine.length;       // a picture is a page
      else if (bytes) info.pages = C.estPagesBytes(bytes);
      var cp = e.pkg.coverPath;
      if (!cp || !e.zip.has(cp)) return info;
      return e.zip.bytes(cp, 20 * 1024 * 1024).then(function (bytes) {
        var type = (e.pkg.items[e.pkg.byPath[cp]] || {}).type || "image/jpeg";
        return thumb(new Blob([bytes], { type: type })).then(function (d) { info.cover = d; return info; }, function () { return info; });
      });
    });
  }
  function thumb(blob) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob), img = new Image();
      img.onload = function () {
        try {
          var w = img.naturalWidth, h = img.naturalHeight;
          if (!(w > 0 && h > 0)) throw new Error("img");
          var sc = Math.min(1, COVER_W / w), cw = Math.max(1, Math.round(w * sc)), ch = Math.max(1, Math.round(h * sc));
          var cv = document.createElement("canvas");
          cv.width = cw; cv.height = ch;
          var x = cv.getContext("2d");
          x.fillStyle = "#fff"; x.fillRect(0, 0, cw, ch);
          x.drawImage(img, 0, 0, cw, ch);
          resolve(cv.toDataURL("image/jpeg", 0.8));
        } catch (e) { reject(e); }
        URL.revokeObjectURL(url);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("img")); };
      img.src = url;
    });
  }

  // ---------- PDF.js ----------
  var LIBSRC = "../vendor/pdfjs/pdf.min.js", WORKER = "../vendor/pdfjs/pdf.worker.min.js";
  var pdfjsP = null;
  function pdfjs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (pdfjsP) return pdfjsP;
    pdfjsP = new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.type = "module"; s.src = LIBSRC;
      s.onload = function () {
        if (window.pdfjsLib) { window.pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER; res(window.pdfjsLib); }
        else rej(new Error("pdfjs"));
      };
      s.onerror = function () { pdfjsP = null; rej(new Error("pdfjs")); };
      document.head.appendChild(s);
    });
    return pdfjsP;
  }
  function openPdf(bytes) {
    return pdfjs().then(function (lib) {
      // PDF.js may take over (detach) the buffer: hand it a copy
      var data = bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes.slice(0));
      return lib.getDocument({ data: data, isEvalSupported: false, enableXfa: false, disableAutoFetch: true,
                               disableStream: true, stopAtErrors: false }).promise;
    });
  }
  function describePdf(buf) {
    return openPdf(buf).then(function (pdf) {
      var info = { pages: pdf.numPages };
      return pdf.getMetadata().catch(function () { return null; }).then(function (md) {
        var i = md && md.info || {};
        var title = C.cleanText(typeof i.Title === "string" ? i.Title : "", C.TITLE_LEN);
        if (title && !/^(untitled|microsoft word - |document\d*$)/i.test(title)) info.title = title.replace(/^microsoft word - /i, "");
        var by = C.cleanText(typeof i.Author === "string" ? i.Author : "", C.BY_LEN);
        if (by) info.by = by;
        var y = /(\d{4})/.exec(String(i.CreationDate || ""));
        if (y) info.year = +y[1];
        return pdf.getPage(1);
      }).then(function (page) {
        var vp1 = page.getViewport({ scale: 1 });
        var sc = COVER_W / Math.max(1, vp1.width), vp = page.getViewport({ scale: sc });
        var cv = document.createElement("canvas");
        cv.width = Math.max(1, Math.round(vp.width)); cv.height = Math.max(1, Math.round(vp.height));
        return page.render({ canvasContext: cv.getContext("2d"), viewport: vp, background: "#ffffff" }).promise.then(function () {
          info.cover = cv.toDataURL("image/jpeg", 0.75);
          return info;
        });
      }).catch(function () { return info; }).then(function (r) { try { pdf.destroy(); } catch (e) {} return r; });
    });
  }

  // ---------- Covers (IndexedDB, this device) ----------
  var dbP = null;
  function db() {
    if (dbP) return dbP;
    dbP = new Promise(function (res, rej) {
      try {
        var r = indexedDB.open("oros-library-cache", 1);
        r.onupgradeneeded = function () { r.result.createObjectStore("covers"); };
        r.onsuccess = function () { res(r.result); };
        r.onerror = function () { rej(r.error); };
      } catch (e) { rej(e); }
    });
    dbP.catch(function () { dbP = null; });
    return dbP;
  }
  var coverMem = {};
  function putCover(id, dataUrl) {
    coverMem[id] = dataUrl;
    return db().then(function (d) {
      return new Promise(function (res) {
        var tx = d.transaction("covers", "readwrite");
        tx.objectStore("covers").put(dataUrl, id);
        tx.oncomplete = function () { res(); };
        tx.onerror = function () { res(); };
      });
    }).catch(function () {}).then(function () { if (LIB.home) LIB.home.coverReady(id); });
  }
  function getCover(id) {
    if (Object.prototype.hasOwnProperty.call(coverMem, id)) return Promise.resolve(coverMem[id]);
    return db().then(function (d) {
      return new Promise(function (res) {
        var r = d.transaction("covers").objectStore("covers").get(id);
        r.onsuccess = function () { coverMem[id] = typeof r.result === "string" ? r.result : null; res(coverMem[id]); };
        r.onerror = function () { res(null); };
      });
    }).catch(function () { return null; });
  }
  // A cover for a book whose file is here but whose cover is missing
  // (another device added it): made once, quietly.
  var making = {};
  function ensureCover(book) {
    if (making[book.id]) return;
    making[book.id] = 1;
    getCover(book.id).then(function (c) {
      if (c) return null;
      return pathOf(book).then(function (p) {
        if (!p) return null;
        return readBytes(p).then(function (bytes) { return describe(bytes, p); }).then(function (info) {
          if (info.cover) putCover(book.id, info.cover);
        });
      });
    }).catch(function () {});
  }

  // ---------- Saving a file to the disk (exports) ----------
  function saveText(dir, name, text) {
    var api = fs();
    if (!api) return Promise.reject(new Error("nofs"));
    return api.mkdir(dir).catch(function () {}).then(function () { return freePath(api, dir, safeName(name)); }).then(function (p) {
      if (!p) throw new Error("write");
      return (api.writeBlob || api.write)(p, new Blob([text], { type: "text/markdown" })).then(function () { return p; });
    });
  }

  LIB.store = {
    BOOKS_DIR: BOOKS_DIR, fs: fs, scan: scan, listBooks: listBooks, pathOf: pathOf, pathsOf: pathsOf, idAt: idAt,
    readBytes: readBytes, addFile: addFile, openEpub: openEpub, openPdf: openPdf, pdfjs: pdfjs,
    describe: describe, getCover: getCover, ensureCover: ensureCover, sha256: sha256, saveText: saveText
  };
})();
