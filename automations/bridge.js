// ============================================================
// orOS Automations — folders on this computer, through orOS Bridge
// (item 25, BR-EV-BRIDGE; koulaxizis/oros-bridge 0.11.0+, its DESIGN
// decision 19).
// ------------------------------------------------------------
// Runs in the SHELL window. automations/host.js loads it when the
// person turned "Folders on this computer" on (device-local
// "oros-bridge-watch" { on }) or opens that panel in Automations.
// It keeps one WebSocket to the bridge on ws://127.0.0.1:47621 with
// the pairing token Studio and Scan PDF already share
// ("oros-studio-bridge"), and turns every new file the bridge reports
// into Automations events: bridge.file, plus bridge.pdf or
// bridge.photo. The event key is the bridge's file key, so the synced
// inbox runs a rule once per file (AUTO-3).
//   - Only the person at the computer adds a folder (the bridge's
//     window or the system's folder chooser the bridge opens there);
//     orOS can ask for the chooser, list the folders and take one off.
//   - A file is read or printed only on the person's tap (AUTO-2), and
//     only a file the bridge reported (the bridge checks it again).
//   - The keys already handled stay in "oros-bridge-seen" (device-
//     local, last 300), so a reconnect never runs a file twice; at the
//     very first connection the files the bridge lists are taken as
//     seen, never run.
// Nothing here is synced; file names go in the notice as text only.
// Pure parts (Node tests): cleanFile, eventsFor, fresh, remember,
// retryMs, parseBlock. UMD: window.OrosBridgeWatch / module.exports.
// ============================================================
(function (root) {
  "use strict";

  var PORT = 47621, TOKEN_KEY = "oros-studio-bridge";
  var PREF_KEY = "oros-bridge-watch", SEEN_KEY = "oros-bridge-seen", SEEN_MAX = 300;
  var CHUNK = 4 * 1024 * 1024, MAX_FILE = 100 * 1024 * 1024;
  var KEY_RE = /^[0-9a-f]{16}$/;
  var KINDS = ["pdf", "image", "other"];
  var MIME = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
               webp: "image/webp", heic: "image/heic", heif: "image/heif", bmp: "image/bmp", tif: "image/tiff",
               tiff: "image/tiff", avif: "image/avif" };

  // What the bridge said about a file, made safe (or null).
  function cleanFile(f) {
    if (!f || typeof f !== "object" || typeof f.key !== "string" || !KEY_RE.test(f.key)) return null;
    var name = typeof f.name === "string" ? f.name.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 255) : "";
    if (!name || /[\/\\]/.test(name)) return null;
    var size = typeof f.size === "number" && isFinite(f.size) && f.size >= 0 ? Math.floor(f.size) : 0;
    var folder = typeof f.folder === "string" ? f.folder.slice(0, 1024) : "";
    return { key: f.key, name: name, kind: KINDS.indexOf(f.kind) >= 0 ? f.kind : "other", size: size, folder: folder };
  }
  // The events one file gives.
  function eventsFor(file) {
    var out = ["bridge.file"];
    if (file.kind === "pdf") out.push("bridge.pdf");
    else if (file.kind === "image") out.push("bridge.photo");
    return out;
  }
  // The files not handled yet, in the bridge's order.
  function fresh(seen, files) {
    var have = {};
    (seen || []).forEach(function (k) { have[k] = true; });
    var out = [];
    (files || []).forEach(function (f) {
      var c = cleanFile(f);
      if (c && !have[c.key]) { have[c.key] = true; out.push(c); }
    });
    return out;
  }
  function remember(seen, keys) {
    var list = (seen || []).filter(function (k) { return keys.indexOf(k) < 0; }).concat(keys);
    return list.slice(Math.max(0, list.length - SEEN_MAX));
  }
  // How long to wait before the n-th try again (15 s, 30 s, … 5 min).
  function retryMs(n) { return Math.min(300000, 15000 * Math.pow(2, Math.max(0, Math.min(n, 5)))); }
  // "ORF1" | u32 offset | u32 length | bytes → { offset, data } or null
  function parseBlock(buf) {
    if (!buf || buf.byteLength < 12) return null;
    var u8 = new Uint8Array(buf);
    if (u8[0] !== 79 || u8[1] !== 82 || u8[2] !== 70 || u8[3] !== 49) return null;
    var dv = new DataView(buf), n = dv.getUint32(8, true);
    if (u8.length !== 12 + n) return null;
    return { offset: dv.getUint32(4, true), data: u8.subarray(12) };
  }
  function mimeOf(name, kind) {
    var m = /\.([a-z0-9]+)$/i.exec(name || "");
    var t = m ? MIME[m[1].toLowerCase()] : "";
    return t || (kind === "pdf" ? "application/pdf" : "application/octet-stream");
  }

  var api = {
    PORT: PORT, TOKEN_KEY: TOKEN_KEY, PREF_KEY: PREF_KEY, SEEN_KEY: SEEN_KEY, SEEN_MAX: SEEN_MAX, MAX_FILE: MAX_FILE,
    cleanFile: cleanFile, eventsFor: eventsFor, fresh: fresh, remember: remember, retryMs: retryMs,
    parseBlock: parseBlock, mimeOf: mimeOf
  };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; return; }
  root.OrosBridgeWatch = api;
  if (root.orosBridgeWatch) return;                // loaded twice

  // ---------- the shell side ----------
  var ls = root.localStorage;
  function get(k, d) { try { var v = JSON.parse(ls.getItem(k)); return v === null ? d : v; } catch (e) { return d; } }
  function put(k, v) { try { ls.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function token() { try { return ls.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; } }
  function keepToken(t) { try { if (t) ls.setItem(TOKEN_KEY, t); else ls.removeItem(TOKEN_KEY); } catch (e) {} }
  function isOn() { var p = get(PREF_KEY, null); return !!(p && p.on); }
  function err(code) { var e = new Error(code); e.code = code; return e; }

  var ws = null, hello = null, authed = false, next = 1, waits = {}, lastBlock = null;
  var status = "off", tries = 0, timer = null, listeners = [];
  function setStatus(s) {
    if (s === status) return;
    status = s;
    listeners.forEach(function (f) { try { f(s); } catch (e) {} });
  }
  function drop() {
    ws = null; hello = null; authed = false; lastBlock = null;
    Object.keys(waits).forEach(function (k) { waits[k].rej(err("closed")); });
    waits = {};
  }
  function cmd(o, ms) {
    if (!ws || ws.readyState !== 1) return Promise.reject(err("closed"));
    var id = next++;
    return new Promise(function (res, rej) {
      waits[id] = { res: res, rej: rej };
      ws.send(JSON.stringify(Object.assign({ id: id }, o)));
      setTimeout(function () { if (waits[id]) { delete waits[id]; rej(err("timeout")); } }, ms || 10000);
    });
  }
  function signal(file) {
    var A = root.orosAutomations;
    if (!A || typeof A.signal !== "function") return;
    eventsFor(file).forEach(function (ev) {
      A.signal("event", ev, "bridge:" + file.key, file.name, { bridge: file.key, name: file.name, kind: file.kind, size: file.size });
    });
  }
  function handle(files, baseline) {
    var seen = get(SEEN_KEY, null);
    var list = fresh(Array.isArray(seen) ? seen : [], files);
    if (!list.length) { if (!Array.isArray(seen)) put(SEEN_KEY, []); return; }
    put(SEEN_KEY, remember(Array.isArray(seen) ? seen : [], list.map(function (f) { return f.key; })));
    if (baseline) return;                          // the first time: what is there already is not news
    list.forEach(signal);
  }
  function onMessage(m) {
    if (typeof m.data !== "string") { lastBlock = m.data; return; }
    var j;
    try { j = JSON.parse(m.data); } catch (e) { return; }
    if (!j || typeof j !== "object") return;
    if (j.event === "hello") { hello = j; return; }
    if (j.event === "fileNew") { if (authed && isOn()) handle([j.file], false); return; }
    if (j.event) return;
    var w = waits[j.id];
    if (!w) return;
    delete waits[j.id];
    if (j.ok) w.res(j); else w.rej(err(String(j.code || j.error || "error")));
  }
  // → "ok" | "pair" | "old"; rejects "nobridge"
  function connect() {
    if (ws && ws.readyState === 1 && authed) return Promise.resolve("ok");
    return new Promise(function (res, rej) {
      var s, done = false;
      try { s = new root.WebSocket("ws://127.0.0.1:" + PORT + "/"); } catch (e) { rej(err("nobridge")); return; }
      s.binaryType = "arraybuffer";
      var t = setTimeout(function () { if (!done) { done = true; try { s.close(); } catch (e) {} rej(err("nobridge")); } }, 3000);
      s.onopen = function () { ws = s; };
      s.onmessage = function (m) {
        onMessage(m);
        if (!done && hello) { done = true; clearTimeout(t); res(); }
      };
      s.onerror = function () { if (!done) { done = true; clearTimeout(t); rej(err("nobridge")); } };
      s.onclose = function () {
        if (ws === s) { drop(); setStatus(isOn() ? "nobridge" : "off"); later(); }
        if (!done) { done = true; clearTimeout(t); rej(err("nobridge")); }
      };
    }).then(function () {
      if (!hello || hello.watch !== true) return "old";
      var tk = token();
      if (!tk) return "pair";
      return cmd({ op: "auth", token: tk }, 5000).then(function () { authed = true; return "ok"; },
        function () { keepToken(""); return "pair"; });
    });
  }
  function catchUp() {
    var first = !Array.isArray(get(SEEN_KEY, null));
    return cmd({ op: "watched" }, 10000).then(function (j) {
      handle(Array.isArray(j.files) ? j.files : [], first);
      return j;
    });
  }
  function later() {
    if (timer || !isOn()) return;
    timer = setTimeout(function () { timer = null; run(); }, retryMs(tries++));
  }
  function run() {
    if (!isOn()) { setStatus("off"); return Promise.resolve("off"); }
    return connect().then(function (st) {
      setStatus(st);
      if (st !== "ok") return st;
      tries = 0;
      return catchUp().then(function () { return "ok"; }, function () { return "ok"; });
    }, function () { setStatus("nobridge"); later(); return "nobridge"; });
  }
  function folders(j) {
    return (Array.isArray(j && j.folders) ? j.folders : []).filter(function (f) { return f && typeof f.path === "string"; })
      .map(function (f) { return { path: f.path.slice(0, 1024), ok: f.ok !== false }; });
  }
  // A reported file as a File, read in blocks (at most MAX_FILE).
  function readFile(ref) {
    var key = ref && ref.bridge;
    if (typeof key !== "string" || !KEY_RE.test(key)) return Promise.reject(err("notfound"));
    var parts = [], off = 0;
    function step() {
      lastBlock = null;
      return cmd({ op: "fileRead", key: key, offset: off, length: CHUNK }, 30000).then(function (j) {
        var b = parseBlock(lastBlock);
        if (!b || b.offset !== off) throw err("unreadable");
        if (j.size > MAX_FILE) throw err("toolarge");
        parts.push(b.data.slice());
        off += b.data.length;
        if (off >= j.size || !b.data.length) return;
        return step();
      });
    }
    return run().then(function (st) {
      if (st !== "ok") throw err(st);
      return step();
    }).then(function () {
      var name = typeof ref.name === "string" && ref.name ? ref.name : "file";
      return new root.File(parts, name, { type: mimeOf(name, ref.kind), lastModified: Date.now() });
    });
  }

  root.orosBridgeWatch = {
    on: isOn,
    setOn: function (on) {
      put(PREF_KEY, { on: !!on });
      if (!on) { if (timer) { clearTimeout(timer); timer = null; } if (ws) try { ws.close(); } catch (e) {} setStatus("off"); return Promise.resolve("off"); }
      tries = 0;
      return run();
    },
    status: function () { return status; },
    onStatus: function (f) { listeners.push(f); return function () { listeners = listeners.filter(function (x) { return x !== f; }); }; },
    connect: run,
    pair: function () { return connect().then(function () { return cmd({ op: "pair" }, 5000); }); },
    sendCode: function (code) {
      return cmd({ op: "pair", code: String(code || "").replace(/\D/g, "").slice(0, 6) }, 5000).then(function (j) {
        keepToken(j.token); authed = true; setStatus("ok"); return catchUp();
      });
    },
    folders: function () { return cmd({ op: "watched" }, 10000).then(folders); },
    // The system's folder chooser, on the computer the bridge runs on.
    pick: function (lang) {
      return cmd({ op: "watchPick", lang: lang === "el" ? "el" : "en" }, 30 * 60000).then(function (j) {
        return { folder: typeof j.folder === "string" ? j.folder : "", cancelled: !!j.cancelled, folders: folders(j) };
      });
    },
    remove: function (path) { return cmd({ op: "watchRemove", folder: String(path || "") }, 10000).then(folders); },
    readFile: readFile,
    print: function (ref) {
      var key = ref && ref.bridge;
      if (typeof key !== "string" || !KEY_RE.test(key)) return Promise.reject(err("notfound"));
      return run().then(function (st) {
        if (st !== "ok") throw err(st);
        return cmd({ op: "print", key: key }, 60000);
      });
    }
  };
  if (isOn()) run();
})(typeof window !== "undefined" ? window : this);
