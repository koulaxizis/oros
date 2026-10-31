// ============================================================
// orOS Studio — orOS Bridge client (koulaxizis/oros-bridge)
//   The bridge is a small program on the person's computer that hosts
//   their own VST3 and CLAP plugins; Studio talks to it over
//   ws://127.0.0.1:47621 (protocol: oros-bridge DESIGN.md). Pairing:
//   the bridge shows a 6-digit code, the page sends it back once and
//   keeps the token in this browser (localStorage, never synced).
//   - connect(): opens and authenticates → "ok" | "pair" | throws
//   - pair() / sendCode(code), list(), scan(), open(id, sr, block),
//     render(h, chans, frames, events), state(h), setState(h, b64),
//     editor(h), close(h)
//   - renderAll(h, input, events, len, latency, block): a whole buffer through the plugin,
//     several blocks in flight, the plugin's delay cut and its tail kept.
//   - the sound card (bridge 0.3.0): devices(), audioOpen(o), play(chans, out)
//     (the sound sent ahead), start(), stop(), take(frames, n), audioClose();
//     events "levels" {peaks, running, pos} and "audioError".
// Loaded before studio.js (window.StudioBridge).
// ============================================================
(function (root) {
  "use strict";

  var PORT = 47621, URL_WS = "ws://127.0.0.1:" + PORT + "/", KEY = "oros-studio-bridge";
  var ID_RE = /^(vst3|clap):[\x21-\x7e]{1,200}$/;
  var ws = null, next = 1, waits = {}, renders = {}, listeners = [], authed = false, lastTake = null;

  function token() { try { return root.localStorage.getItem(KEY) || ""; } catch (e) { return ""; } }
  function keepToken(t) { try { if (t) root.localStorage.setItem(KEY, t); else root.localStorage.removeItem(KEY); } catch (e) {} }
  function on(fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; }
  function emit(ev) { listeners.forEach(function (f) { try { f(ev); } catch (e) {} }); }

  function fail(msg) { var e = new Error(msg); e.bridge = true; return e; }
  function drop(why) {
    authed = false;
    ws = null;
    Object.keys(waits).forEach(function (k) { waits[k].rej(fail(why)); });
    Object.keys(renders).forEach(function (k) { renders[k].rej(fail(why)); });
    waits = {}; renders = {};
    emit({ event: "closed" });
  }
  function onMessage(m) {
    if (typeof m.data !== "string") {
      var tag = String.fromCharCode.apply(null, new Uint8Array(m.data, 0, Math.min(4, m.data.byteLength)));
      if (tag === "ORT1") { lastTake = m.data; return; }   // a take block; its answer follows
      var dv = new DataView(m.data), key = dv.getUint32(4, true) + ":" + dv.getUint32(8, true), r = renders[key];
      if (!r) return;
      delete renders[key];
      var frames = dv.getUint32(12, true), outs = dv.getUint8(16), chans = [];
      for (var c = 0; c < outs; c++) chans.push(new Float32Array(m.data.slice(20 + c * frames * 4, 20 + (c + 1) * frames * 4)));
      r.res(chans);
      return;
    }
    var j;
    try { j = JSON.parse(m.data); } catch (e) { return; }
    if (j.event === "renderError") {
      var rk = j.h + ":" + j.seq, rr = renders[rk];
      if (rr) { delete renders[rk]; rr.rej(fail(j.error || "render")); }
      return;
    }
    if (j.event) { emit(j); return; }
    var w = waits[j.id];
    if (!w) return;
    delete waits[j.id];
    if (j.ok) w.res(j); else w.rej(fail(j.error || "error"));
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
  // → "ok" (paired before), "pair" (a code is needed); rejects when no bridge answers
  function connect() {
    if (ws && ws.readyState === 1 && authed) return Promise.resolve("ok");
    return new Promise(function (res, rej) {
      var s;
      try { s = new WebSocket(URL_WS); } catch (e) { rej(fail("nobridge")); return; }
      s.binaryType = "arraybuffer";
      var opened = false;
      s.onopen = function () { opened = true; ws = s; res(); };
      s.onerror = function () { if (!opened) rej(fail("nobridge")); };
      s.onclose = function () { if (ws === s) drop("closed"); else if (!opened) rej(fail("nobridge")); };
      s.onmessage = onMessage;
    }).then(function () {
      var t = token();
      if (!t) return "pair";
      return cmd({ op: "auth", token: t }, 5000).then(function () { authed = true; return "ok"; },
        function () { keepToken(""); return "pair"; });
    });
  }
  function pair() { return cmd({ op: "pair" }, 5000); }
  function sendCode(code) {
    return cmd({ op: "pair", code: String(code).replace(/\D/g, "") }, 5000).then(function (j) {
      keepToken(j.token);
      authed = true;
      return true;
    });
  }
  function cleanList(j) {
    return (j.plugins || []).filter(function (p) { return p && ID_RE.test(p.id) && typeof p.name === "string"; }).map(function (p) {
      return { id: p.id, name: String(p.name).slice(0, 80), vendor: String(p.vendor || "").slice(0, 80),
               format: p.format === "clap" ? "clap" : "vst3", instrument: p.instrument === true };
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });
  }
  function list() { return cmd({ op: "list" }, 10000).then(cleanList); }
  function scan() { return cmd({ op: "scan" }).then(cleanList); }
  function open(id, sr, block) { return cmd({ op: "open", plugin: id, sr: sr, block: block }, 60000); }
  function close(h) { return cmd({ op: "close", h: h }, 10000).then(null, function () {}); }
  function editor(h) { return cmd({ op: "editor", h: h }, 30000); }
  function state(h) { return cmd({ op: "getState", h: h }, 30000).then(function (j) { return j.data || ""; }); }
  function setState(h, b64) { return cmd({ op: "setState", h: h, data: b64 }, 30000); }
  function info(h) { return cmd({ op: "info", h: h }, 10000); }
  function reset(h) { return cmd({ op: "reset", h: h }, 10000); }

  var seq = 1;
  // chans: Float32Array per channel (may be []), events: [[frame, status, d1, d2]]
  function render(h, chans, frames, events) {
    if (!ws || ws.readyState !== 1) return Promise.reject(fail("closed"));
    events = events || [];
    var s = seq++, nch = chans.length, buf = new ArrayBuffer(20 + events.length * 8 + nch * frames * 4), dv = new DataView(buf), u8 = new Uint8Array(buf);
    u8.set([79, 82, 66, 49], 0);   // "ORB1"
    dv.setUint32(4, h, true); dv.setUint32(8, s, true); dv.setUint32(12, frames, true);
    dv.setUint16(16, nch, true); dv.setUint16(18, events.length, true);
    events.forEach(function (e, i) { var at = 20 + i * 8; dv.setUint32(at, e[0], true); u8[at + 4] = e[1]; u8[at + 5] = e[2] & 127; u8[at + 6] = e[3] & 127; });
    var a = 20 + events.length * 8;
    for (var c = 0; c < nch; c++) new Float32Array(buf, a + c * frames * 4, frames).set(chans[c].subarray(0, frames));
    return new Promise(function (res, rej) {
      renders[h + ":" + s] = { res: res, rej: rej };
      ws.send(buf);
    });
  }
  // A whole render. input: Float32Array per channel (or [] for an
  // instrument), events: [[frame, status, d1, d2]] over the whole length,
  // len: frames to give back (the input plus its tail), latency: the
  // plugin's delay, cut from the front. → Float32Array per output channel.
  function renderAll(h, input, events, len, latency, block, onStep) {
    var total = len + latency, blocks = Math.ceil(total / block), outs = null, done = 0, sent = 0, ev = (events || []).slice().sort(function (x, y) { return x[0] - y[0]; }), ei = 0;
    return new Promise(function (res, rej) {
      var failed = false;
      function sendOne() {
        var b = sent++, start = b * block, n = Math.min(block, total - start);
        var chans = input.map(function (ch) {
          var x = new Float32Array(n);
          if (start < ch.length) x.set(ch.subarray(start, Math.min(ch.length, start + n)));
          return x;
        });
        var bev = [];
        while (ei < ev.length && ev[ei][0] < start + n) { var e = ev[ei++]; bev.push([Math.max(0, e[0] - start), e[1], e[2], e[3]]); }
        render(h, chans, n, bev).then(function (out) {
          if (failed) return;
          if (!outs) outs = out.map(function () { return new Float32Array(len); });
          out.forEach(function (o, c) {
            if (!outs[c]) return;
            // frame start+i of the output is frame start+i-latency of the result
            for (var i = 0; i < o.length; i++) { var k = start + i - latency; if (k >= 0 && k < len) outs[c][k] = o[i]; }
          });
          done++;
          if (onStep) onStep(done / blocks);
          if (done === blocks) res(outs || []);
          else if (sent < blocks) sendOne();
        }, function (e) { failed = true; rej(e); });
      }
      for (var k = 0; k < Math.min(8, blocks); k++) sendOne();   // a few in flight, in order
    });
  }

  // ---------- the sound card ----------
  var BLOCK_FRAMES = 65536;
  function cleanDevs(a) {
    return (Array.isArray(a) ? a : []).filter(function (d) { return d && typeof d.name === "string" && d.name.length <= 300; }).map(function (d) {
      return { name: d.name, channels: Math.max(1, Math.min(64, d.channels | 0)), def: d["default"] === true };
    });
  }
  function devices() {
    return cmd({ op: "audioDevices" }, 30000).then(function (j) {
      return (j.backends || []).filter(function (b) { return b && /^[a-z0-9]{1,20}$/.test(b.id); }).map(function (b) {
        return { id: b.id, label: String(b.label || b.id).slice(0, 60), exclusive: b.exclusive === true, ok: b.ok === true,
                 inputs: cleanDevs(b.inputs), outputs: cleanDevs(b.outputs) };
      });
    });
  }
  // o: {backend, input, output, exclusive, record: [channels from 0]} → {sr, period, inputs, outputs, latency}
  function audioOpen(o) { return cmd(Object.assign({ op: "audioOpen", period: 256 }, o), 30000); }
  function audioClose() { return cmd({ op: "audioClose" }, 10000).then(null, function () {}); }
  // the sound to play from the start, sent ahead: [L, R] (or [] for none)
  function play(chans, out) {
    var frames = chans.length ? chans[0].length : 0;
    return cmd({ op: "audioPlay", frames: frames, channels: chans.length, out: out || 0 }, 30000).then(function () {
      for (var at = 0; at < frames; at += BLOCK_FRAMES) {
        var n = Math.min(BLOCK_FRAMES, frames - at), buf = new ArrayBuffer(16 + chans.length * n * 4), dv = new DataView(buf);
        new Uint8Array(buf).set([79, 82, 80, 49], 0);   // "ORP1"
        dv.setUint32(4, at, true); dv.setUint32(8, n, true); dv.setUint16(12, chans.length, true);
        for (var c = 0; c < chans.length; c++) new Float32Array(buf, 16 + c * n * 4, n).set(chans[c].subarray(at, at + n));
        ws.send(buf);
      }
    });
  }
  function start() { return cmd({ op: "audioStart" }, 10000); }
  function stop() { return cmd({ op: "audioStop" }, 20000); }
  // the whole take: n channels of `frames` → Float32Array per channel
  function take(frames, n, onStep) {
    var out = [];
    for (var c = 0; c < n; c++) out.push(new Float32Array(frames));
    function from(at) {
      if (at >= frames) return Promise.resolve(out);
      lastTake = null;
      return cmd({ op: "takeRead", offset: at, frames: Math.min(BLOCK_FRAMES, frames - at) }, 30000).then(function (j) {
        var b = lastTake, got = j.frames | 0;
        if (!b || got <= 0) throw fail("take");
        var dv = new DataView(b), nch = dv.getUint16(12, true), k = dv.getUint32(8, true);
        if (k !== got || nch !== n || b.byteLength !== 16 + nch * k * 4) throw fail("take");
        for (var c2 = 0; c2 < n; c2++) out[c2].set(new Float32Array(b.slice(16 + c2 * k * 4, 16 + (c2 + 1) * k * 4)), at);
        if (onStep) onStep(Math.min(1, (at + got) / frames));
        return from(at + got);
      });
    }
    return from(0);
  }

  root.StudioBridge = {
    PORT: PORT, ID_RE: ID_RE, connect: connect, pair: pair, sendCode: sendCode, list: list, scan: scan,
    open: open, close: close, editor: editor, state: state, setState: setState, info: info, reset: reset,
    render: render, renderAll: renderAll, on: on,
    devices: devices, audioOpen: audioOpen, audioClose: audioClose, play: play, start: start, stop: stop, take: take, connected: function () { return !!ws && ws.readyState === 1 && authed; },
    forget: function () { keepToken(""); if (ws) ws.close(); }
  };
})(typeof window !== "undefined" ? window : this);
