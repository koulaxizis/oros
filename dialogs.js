// ============================================================
// orOS Core — dialogs.js
// Cross-browser file dialogs — single point of truth.
//
// Doctrine: Feature detection, NEVER browser sniffing. Where the
// File System Access API exists (Chromium desktop) we use the
// native save/open pickers; everywhere else (Firefox, Safari,
// all mobile browsers) the same contract is honored via the
// classic <a download> / <input type="file"> fallbacks. Functionally
// equivalent for orOS: every caller gets its file saved or read.
//
// Public contract (consumed by the shell AND every same-origin
// iframe app via window.parent.orosDialog):
//   orosDialog.saveFile(opts)  -> Promise<{ ok, mode }>
//       opts: { blob | text, filename, mime, types? }
//       ok=true ONLY when the bytes actually landed (native write
//       completed / download dispatched). Cancel -> ok=false.
//   orosDialog.openFile(accept)   -> Promise<File|null>
//   orosDialog.openFiles(accept)  -> Promise<File[]|null>
//   orosDialog.mode()  -> "native" | "download" (diagnostics + info modal)
//
// NOTE for native save: "ok" on the fallback path means the
// download was DISPATCHED (browser download flow) — the browser
// itself owns that UI. Same honesty level as the shell's existing
// backup export button.
// ============================================================
(function () {
  "use strict";

  function nativeSaveSupported() {
    return typeof window.showSaveFilePicker === "function";
  }
  function nativeOpenSupported() {
    return typeof window.showOpenFilePicker === "function";
  }

  // DLG-3: apps call saveFile from their iframe, so their Blob comes
  // from ANOTHER realm and `instanceof Blob` (this window's Blob) is
  // false for it. The old check then wrote an EMPTY text file. Any
  // Blob-shaped object is a real Blob here (same-origin frames);
  // createObjectURL and the writable accept it across realms.
  function isBlob(b) {
    return !!b && typeof b === "object" && typeof b.size === "number" &&
           typeof b.type === "string" && typeof b.slice === "function";
  }
  function toBlob(opts) {
    if (opts && (opts.blob instanceof Blob || isBlob(opts.blob))) return opts.blob;
    var mime = (opts && typeof opts.mime === "string") ? opts.mime : "text/plain";
    return new Blob([String((opts && opts.text !== undefined) ? opts.text : "")],
                    { type: mime });
  }

  // Classic download fallback. Anchor click, then a LATE revoke.
  // DLG-1: the URL used to be revoked after 1 second. A download does
  // not always START within a second: Safari asks "Do you want to
  // download…?", Firefox can show its open/save prompt, a phone can
  // simply be slow with a large file — and a download that starts
  // after the revoke has nothing left to read. 40s costs nothing but
  // a little memory held a little longer. The anchor itself is only
  // needed for the click.
  var REVOKE_AFTER_MS = 40000;
  function downloadFallback(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, REVOKE_AFTER_MS);
    return { ok: true, mode: "download" };
  }

  // Hidden <input type="file"> fallback — one-shot, listener-clean.
  // Fires "change" on pick, "cancel" on dismissal (modern browsers);
  // done-guard keeps both from double-resolving.
  function inputPick(accept, multiple) {
    return new Promise(function (resolve) {
      var inp = document.createElement("input");
      inp.type = "file";
      if (accept) inp.accept = accept;
      if (multiple) inp.multiple = true;
      inp.style.display = "none";

      var done = false;
      function finish(val) {
        if (done) return;
        done = true;
        try { inp.value = ""; } catch (e) {}
        if (inp.parentNode) inp.remove();
        resolve(val);
      }

      inp.addEventListener("change", function () {
        var fs = inp.files;
        if (!fs || !fs.length) { finish(null); return; }
        if (multiple) {
          var out = [];
          for (var i = 0; i < fs.length; i++) out.push(fs[i]);
          finish(out);
        } else {
          finish(fs[0]);
        }
      });
      inp.addEventListener("cancel", function () { finish(null); });

      document.body.appendChild(inp);
      inp.click();
    });
  }

  // ---------- saveFile ----------
  function saveFile(opts) {
    opts = opts || {};
    var blob = toBlob(opts);
    var name = (typeof opts.filename === "string" && opts.filename)
      ? opts.filename
      : "orOS-export.txt";

    return new Promise(function (resolve) {
      if (!nativeSaveSupported()) {
        resolve(downloadFallback(blob, name));
        return;
      }
      var pickerOpts = { suggestedName: name };
      if (opts.types) pickerOpts.types = opts.types;

      window.showSaveFilePicker(pickerOpts)
        .then(function (handle) {
          return handle.createWritable().then(function (stream) {
            return stream.write(blob).then(function () {
              return stream.close();
            }, function (werr) {
              // DLG-2: a failed write (disk full, permission lost)
              // left the writable open: its temporary swap file was
              // never discarded and the target could stay locked.
              // Abort it, then let the failure reach the catch below
              // (which still delivers the file as a download).
              var bail = null;
              try { if (typeof stream.abort === "function") bail = stream.abort(); } catch (e) {}
              return Promise.resolve(bail).catch(function () {}).then(function () { throw werr; });
            });
          });
        })
        .then(function () {
          resolve({ ok: true, mode: "native" });
        })
        .catch(function (err) {
          if (err && err.name === "AbortError") {
            resolve({ ok: false, mode: "native" });   // user cancelled — not an error
            return;
          }
          // Unexpected native failure (SecurityError etc.) — the file
          // must still reach the user: fall back to download.
          resolve(downloadFallback(blob, name));
        });
    });
  }

  // ---------- openFile / openFiles ----------
  function openFile(accept) {
    return new Promise(function (resolve) {
      if (!nativeOpenSupported()) {
        resolve(inputPick(accept, false));
        return;
      }
      window.showOpenFilePicker({ multiple: false })
        .then(function (handles) {
          if (!handles || !handles.length) { resolve(null); return; }
          return handles[0].getFile().then(resolve);
        })
        .catch(function (err) {
          if (err && err.name === "AbortError") {
            resolve(null);   // cancelled
            return;
          }
          resolve(inputPick(accept, false));   // native hiccup — fallback
        });
    });
  }

  function openFiles(accept) {
    return new Promise(function (resolve) {
      if (!nativeOpenSupported()) {
        resolve(inputPick(accept, true));
        return;
      }
      window.showOpenFilePicker({ multiple: true })
        .then(function (handles) {
          if (!handles || !handles.length) { resolve(null); return; }
          var chain = Promise.resolve([]);
          handles.forEach(function (h) {
            chain = chain.then(function (arr) {
              return h.getFile().then(function (f) {
                arr.push(f);
                return arr;
              });
            });
          });
          return chain.then(resolve);
        })
        .catch(function (err) {
          if (err && err.name === "AbortError") {
            resolve(null);
            return;
          }
          resolve(inputPick(accept, true));
        });
    });
  }

  // ---------- diagnostics ----------
  function mode() {
    return (nativeSaveSupported() && nativeOpenSupported())
      ? "native"
      : "download";
  }

  window.orosDialog = {
    saveFile:  saveFile,
    openFile:  openFile,
    openFiles: openFiles,
    mode:      mode
  };

  console.log("[orOS] dialogs.js ready — " + mode());
})();