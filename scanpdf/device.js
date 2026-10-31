// ============================================================
// orOS Scanner & PDF — device.js: a scanner on this computer, through
// orOS Bridge (koulaxizis/oros-bridge 0.9.0+, DESIGN decision 16).
// ------------------------------------------------------------
// The bridge listens on ws://127.0.0.1:47621 only; WIA (Windows) or
// SANE (Linux) reaches the scanner. Pairing is the bridge's own: it
// shows a 6-digit code, the page sends it back once and keeps a token
// in this browser. Studio keeps the same token under the same key
// (studio/bridge.js), so a browser paired once is paired for both.
// Nothing is synced and nothing leaves this computer.
//
// Pure parts (Node tests): cleanScanners, choose, parseStrip,
// pageBuilder, errKey. Browser part: ScanPdfDevice.client().
// UMD: window.ScanPdfDevice, or module.exports in Node.
// ============================================================
(function (root) {
  "use strict";

  var PORT = 47621, KEY = "oros-studio-bridge";
  var SOURCES = ["flatbed", "adf", "adf-duplex"], MODES = ["color", "gray", "lineart"];
  var MAX_DPI = 600;                       // a page stays a size a browser can hold
  var MAX_SIDE = 7200;                     // A4 at 600 dpi is 4961 × 7016
  var ERR_CODES = ["busy", "nopaper", "jammed", "cover", "denied", "gone", "unsupported", "nosane"];

  function str(v, n) { return typeof v === "string" ? v.slice(0, n) : ""; }

  // What the bridge listed, made safe: known words only, sane numbers.
  function cleanScanners(list) {
    if (!Array.isArray(list)) return [];
    var out = [];
    list.slice(0, 64).forEach(function (s) {
      if (!s || typeof s.id !== "string" || !s.id || s.id.length > 1024) return;
      var sources = SOURCES.filter(function (k) { return Array.isArray(s.sources) && s.sources.indexOf(k) >= 0; });
      var modes = MODES.filter(function (k) { return Array.isArray(s.modes) && s.modes.indexOf(k) >= 0; });
      var dpi = (Array.isArray(s.dpi) ? s.dpi : []).filter(function (d) {
        return typeof d === "number" && d % 1 === 0 && d >= 50 && d <= MAX_DPI;
      });
      dpi = dpi.filter(function (d, i) { return dpi.indexOf(d) === i; }).sort(function (a, b) { return a - b; });
      if (!dpi.length) dpi = [300];
      out.push({
        id: s.id,
        name: str(s.name, 120) || str(s.model, 120) || s.id.slice(0, 120),
        sources: sources.length ? sources : ["flatbed"],
        modes: modes.length ? modes : ["color"],
        dpi: dpi
      });
    });
    return out;
  }

  // The settings for a scanner: what was used last when it offers it,
  // otherwise the glass, colour and the resolution nearest 300 dpi.
  function choose(sc, last) {
    last = last || {};
    function nearest(want) {
      return sc.dpi.reduce(function (b, d) { return Math.abs(d - want) < Math.abs(b - want) ? d : b; }, sc.dpi[0]);
    }
    return {
      source: sc.sources.indexOf(last.source) >= 0 ? last.source : sc.sources[0],
      mode: sc.modes.indexOf(last.mode) >= 0 ? last.mode : (sc.modes.indexOf("color") >= 0 ? "color" : sc.modes[0]),
      dpi: sc.dpi.indexOf(last.dpi) >= 0 ? last.dpi : nearest(300)
    };
  }

  // "ORS1" | u32 page | u32 width | u32 y | u16 rows | u8 channels | u8 0 | rows × width × channels bytes
  function parseStrip(buf) {
    if (!buf || buf.byteLength < 20) return null;
    var u8 = new Uint8Array(buf);
    if (u8[0] !== 79 || u8[1] !== 82 || u8[2] !== 83 || u8[3] !== 49) return null;
    var dv = new DataView(buf);
    var s = { page: dv.getUint32(4, true), w: dv.getUint32(8, true), y: dv.getUint32(12, true),
              rows: dv.getUint16(16, true), ch: u8[18] };
    if ((s.ch !== 1 && s.ch !== 3) || !s.w || s.w > 20000 || u8.length !== 20 + s.rows * s.w * s.ch) return null;
    s.data = u8.subarray(20);
    return s;
  }

  // One page from its strips; done() gives RGBA (for an ImageData), or
  // null when strips were missing or out of order.
  function pageBuilder() {
    var parts = [], w = 0, ch = 0, h = 0, bad = false, page = -1;
    return {
      add: function (s) {
        if (!parts.length) { w = s.w; ch = s.ch; page = s.page; }
        if (s.page !== page || s.w !== w || s.ch !== ch || s.y !== h || h + s.rows > MAX_SIDE * 2) { bad = true; return; }
        parts.push(s.data.slice());
        h += s.rows;
      },
      rows: function () { return h; },
      done: function (info) {
        if (bad || !h || !info || info.width !== w || info.height !== h || info.channels !== ch) return null;
        var rgba = new Uint8ClampedArray(w * h * 4), o = 0;
        parts.forEach(function (p) {
          if (ch === 3) {
            for (var i = 0; i < p.length; i += 3) { rgba[o] = p[i]; rgba[o + 1] = p[i + 1]; rgba[o + 2] = p[i + 2]; rgba[o + 3] = 255; o += 4; }
          } else {
            for (var j = 0; j < p.length; j++) { rgba[o] = rgba[o + 1] = rgba[o + 2] = p[j]; rgba[o + 3] = 255; o += 4; }
          }
        });
        return { width: w, height: h, data: rgba };
      }
    };
  }

  // The look a page starts with, from how it was scanned
  function lookFor(mode) { return mode === "lineart" ? "bw" : mode === "gray" ? "gray" : "color"; }

  // A bridge error code → the string key the app shows
  function errKey(code) { return "dv.e." + (ERR_CODES.indexOf(code) >= 0 ? code : "other"); }

  // ---------- the bridge (browser only) ----------
  function client(WS, storage) {
    var ws = null, next = 1, waits = {}, listeners = [], hello = null, authed = false;
    function token() { try { return storage.getItem(KEY) || ""; } catch (e) { return ""; } }
    function keep(t) { try { if (t) storage.setItem(KEY, t); else storage.removeItem(KEY); } catch (e) {} }
    function fail(m) { var e = new Error(m); e.code = m; return e; }
    function emit(m) { listeners.forEach(function (f) { try { f(m); } catch (e) {} }); }
    function drop() {
      ws = null; authed = false; hello = null;
      Object.keys(waits).forEach(function (k) { waits[k].rej(fail("closed")); });
      waits = {};
      emit({ event: "closed" });
    }
    function cmd(o, ms) {
      if (!ws || ws.readyState !== 1) return Promise.reject(fail("closed"));
      var id = next++;
      return new Promise(function (res, rej) {
        waits[id] = { res: res, rej: rej };
        ws.send(JSON.stringify(Object.assign({ id: id }, o)));
        if (ms) setTimeout(function () { if (waits[id]) { delete waits[id]; rej(fail("timeout")); } }, ms);
      });
    }
    function onMessage(m) {
      if (typeof m.data !== "string") {
        var s = parseStrip(m.data);
        if (s) emit({ event: "strip", strip: s });
        return;
      }
      var j;
      try { j = JSON.parse(m.data); } catch (e) { return; }
      if (!j || typeof j !== "object") return;
      if (j.event === "hello") { hello = j; return; }
      if (j.event) { emit(j); return; }
      var w = waits[j.id];
      if (!w) return;
      delete waits[j.id];
      if (j.ok) w.res(j); else w.rej(fail(String(j.error || "error")));
    }
    // → "ok" (paired), "pair" (a code is needed), "old" (a bridge without scanners);
    // rejects when no bridge answers
    function connect(ms) {
      if (ws && ws.readyState === 1 && authed) return Promise.resolve("ok");
      return new Promise(function (res, rej) {
        var s, done = false;
        try { s = new WS("ws://127.0.0.1:" + PORT + "/"); } catch (e) { rej(fail("nobridge")); return; }
        s.binaryType = "arraybuffer";
        var timer = setTimeout(function () { if (!done) { done = true; try { s.close(); } catch (e) {} rej(fail("nobridge")); } }, ms || 3000);
        s.onopen = function () { ws = s; };
        s.onmessage = function (m) {
          onMessage(m);
          if (!done && hello) { done = true; clearTimeout(timer); res(); }
        };
        s.onerror = function () { if (!done) { done = true; clearTimeout(timer); rej(fail("nobridge")); } };
        s.onclose = function () { if (ws === s) drop(); if (!done) { done = true; clearTimeout(timer); rej(fail("nobridge")); } };
      }).then(function () {
        if (!hello || hello.scanner !== true) return "old";
        var t = token();
        if (!t) return "pair";
        return cmd({ op: "auth", token: t }, 5000).then(function () { authed = true; return "ok"; },
          function () { keep(""); return "pair"; });
      });
    }
    return {
      connect: connect,
      pair: function () { return cmd({ op: "pair" }, 5000); },
      sendCode: function (code) {
        return cmd({ op: "pair", code: String(code).replace(/\D/g, "") }, 5000).then(function (j) { keep(j.token); authed = true; });
      },
      scanners: function (full) {
        return cmd({ op: "scanners", full: !!full }, 60000).then(function (j) {
          var missing = Array.isArray(j.missing) ? j.missing.map(function (x) { return x && x.code; }) : [];
          return { list: cleanScanners(j.scanners), nosane: missing.indexOf("nosane") >= 0 };
        });
      },
      start: function (o) { return cmd({ op: "scanStart", scanner: o.scanner, source: o.source, mode: o.mode, dpi: o.dpi }, 15000); },
      cancel: function () { return cmd({ op: "scanCancel" }, 5000).then(null, function () {}); },
      on: function (f) { listeners.push(f); return function () { listeners = listeners.filter(function (x) { return x !== f; }); }; },
      close: function () { if (ws) try { ws.close(); } catch (e) {} },
      connected: function () { return !!(ws && ws.readyState === 1 && authed); }
    };
  }

  var api = {
    PORT: PORT, KEY: KEY, SOURCES: SOURCES, MODES: MODES, MAX_DPI: MAX_DPI, MAX_SIDE: MAX_SIDE,
    cleanScanners: cleanScanners, choose: choose, parseStrip: parseStrip, pageBuilder: pageBuilder,
    lookFor: lookFor, errKey: errKey, client: client
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ScanPdfDevice = api;
})(typeof window !== "undefined" ? window : this);
