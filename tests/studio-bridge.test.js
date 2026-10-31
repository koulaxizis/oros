// Studio and orOS Bridge (Studio v1.11.0): the client in
// studio/bridge.js against a stand-in bridge (the protocol of
// koulaxizis/oros-bridge DESIGN.md), track.br in core.js, and the
// wiring in studio.js, index.html, sw.js and the CSP.
// Run: node --test tests/*.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const C = require(path.join(ROOT, "studio", "core.js"));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

// A stand-in bridge: answers the JSON ops and renders a block as
// "input × 0.5, delayed by LAT frames" (an effect) or a click on every
// note-on (an instrument).
function fakeBridge(opts) {
  const o = Object.assign({ code: "123456", token: "ab".repeat(32), latency: 0, refuse: false }, opts);
  const seen = [];
  const delay = {};
  class WS {
    constructor(url) {
      this.url = url; this.readyState = 0; this.binaryType = "blob";
      seen.push({ url });
      setTimeout(() => {
        if (o.refuse) { this.onerror && this.onerror({}); this.onclose && this.onclose({}); return; }
        this.readyState = 1; this.onopen && this.onopen({});
        this.reply({ event: "hello", app: "oros-bridge", editors: true });
      }, 0);
    }
    reply(j) { setTimeout(() => this.onmessage && this.onmessage({ data: typeof j === "string" || j instanceof ArrayBuffer ? j : JSON.stringify(j) }), 0); }
    close() { this.readyState = 3; setTimeout(() => this.onclose && this.onclose({}), 0); }
    send(d) {
      if (typeof d !== "string") return this.block(d);
      const m = JSON.parse(d);
      seen.push(m);
      const ok = (x) => this.reply(Object.assign({ id: m.id, ok: true }, x || {}));
      const no = (e) => this.reply({ id: m.id, ok: false, error: e });
      if (m.op === "auth") return m.token === o.token ? ok() : no("unpaired");
      if (m.op === "pair") return m.code === undefined ? ok() : m.code === o.code ? ok({ token: o.token }) : no("badcode");
      if (m.op === "list" || m.op === "scan") return ok({ plugins: [
        { id: "vst3:ABCDEF0123456789ABCDEF0123456789", name: "Zeta Verb", vendor: "Someone", format: "vst3", instrument: false },
        { id: "clap:com.example.synth", name: "Alpha Synth", vendor: "", format: "clap", instrument: true },
        { id: "bad id", name: "Broken" }, { id: "clap:x", name: 3 }] });
      if (m.op === "open") return ok({ h: 7, inputs: 2, outputs: 2, latency: o.latency, tail: 0, editor: true, instrument: false });
      if (m.op === "getState") return ok({ data: "AAEC" });
      return ok();
    }
    block(buf) {
      const dv = new DataView(buf), h = dv.getUint32(4, true), seq = dv.getUint32(8, true), n = dv.getUint32(12, true);
      const ch = dv.getUint16(16, true), nev = dv.getUint16(18, true), a = 20 + nev * 8;
      const evs = [];
      for (let i = 0; i < nev; i++) evs.push([dv.getUint32(20 + i * 8, true), dv.getUint8(24 + i * 8), dv.getUint8(25 + i * 8), dv.getUint8(26 + i * 8)]);
      seen.push({ block: seq, frames: n, ch, evs });
      const out = new ArrayBuffer(20 + 2 * n * 4), od = new DataView(out);
      new Uint8Array(out).set([79, 82, 66, 49]);
      od.setUint32(4, h, true); od.setUint32(8, seq, true); od.setUint32(12, n, true); od.setUint16(16, 2, true);
      for (let c = 0; c < 2; c++) {
        const inp = ch ? new Float32Array(buf, a + Math.min(c, ch - 1) * n * 4, n) : null, res = new Float32Array(out, 20 + c * n * 4, n);
        const line = delay[c] || (delay[c] = []);
        for (let i = 0; i < n; i++) {
          line.push(inp ? inp[i] * 0.5 : 0);
          res[i] = line.length > o.latency ? line.shift() : 0;
        }
        evs.forEach((e) => { if (e[1] === 0x90) res[e[0]] = e[3] / 127; });
      }
      this.reply(out);
    }
  }
  return { WS, seen, o };
}
function load(bridge) {
  global.WebSocket = bridge.WS;
  const p = require.resolve(path.join(ROOT, "studio", "bridge.js"));
  delete require.cache[p];
  const mod = require(p);
  const store = {};
  mod.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  return { B: mod.StudioBridge, store };
}

test("bridge.js: no bridge → nobridge; first time a code pairs, the token is kept; then auth alone", async () => {
  let f = fakeBridge({ refuse: true }), { B, store } = load(f);
  await assert.rejects(B.connect(), /nobridge/);

  f = fakeBridge(); ({ B, store } = load(f));
  const seenHello = [];
  B.on((ev) => seenHello.push(ev.event));
  assert.equal(await B.connect(), "pair");
  assert.equal(f.seen[0].url, "ws://127.0.0.1:47621/");
  await B.pair();
  await assert.rejects(B.sendCode("654 321"), /badcode/);
  assert.equal(await B.sendCode("123-456"), true);
  assert.equal(f.seen.filter((m) => m.op === "pair").pop().code, "123456", "only the digits are sent");
  assert.equal(store["oros-studio-bridge"], f.o.token);
  assert.ok(B.connected());
  assert.ok(seenHello.includes("hello"));

  // a new page: the kept token is enough
  const g = fakeBridge(), again = load(g);
  Object.assign(again.store, store);
  assert.equal(await again.B.connect(), "ok");
  assert.deepEqual(g.seen.filter((m) => m.op).map((m) => m.op), ["auth"]);
  // a token the bridge forgot: pairing again, the old token dropped
  const h = fakeBridge({ token: "cd".repeat(32) }), third = load(h);
  Object.assign(third.store, store);
  assert.equal(await third.B.connect(), "pair");
  assert.equal(third.store["oros-studio-bridge"], undefined);
});

test("bridge.js: the plugin list is cleaned and sorted", async () => {
  const f = fakeBridge(), { B, store } = load(f);
  store["oros-studio-bridge"] = f.o.token;
  await B.connect();
  const list = await B.list();
  assert.deepEqual(list.map((p) => [p.name, p.format, p.instrument]), [["Alpha Synth", "clap", true], ["Zeta Verb", "vst3", false]]);
  assert.ok(list.every((p) => B.ID_RE.test(p.id)));
});

test("bridge.js: renderAll cuts the plugin's delay, keeps the length, sends notes in their block", async () => {
  const f = fakeBridge({ latency: 5 }), { B, store } = load(f);
  store["oros-studio-bridge"] = f.o.token;
  await B.connect();
  const j = await B.open("vst3:ABCDEF0123456789ABCDEF0123456789", 48000, 64);
  const len = 300, x = new Float32Array(200);
  for (let i = 0; i < x.length; i++) x[i] = (i % 7) / 10;
  const steps = [];
  const out = await B.renderAll(j.h, [x], [], len, j.latency, 64, (s) => steps.push(s));
  assert.equal(out.length, 2);
  assert.equal(out[0].length, len);
  for (let i = 0; i < len; i++) assert.ok(Math.abs(out[1][i] - (i < 200 ? x[i] * 0.5 : 0)) < 1e-6, "frame " + i);
  assert.equal(steps[steps.length - 1], 1);
  const blocks = f.seen.filter((m) => m.frames !== undefined);
  assert.equal(blocks.length, Math.ceil((len + 5) / 64));
  assert.equal(blocks[blocks.length - 1].frames, (len + 5) % 64);

  // an instrument: no audio in, the events land in their own block at the right frame
  f.o.latency = 0;
  const ev = [[10, 0x90, 60, 127], [100, 0x80, 60, 0], [130, 0x90, 62, 64]];
  const o2 = await B.renderAll(j.h, [], ev, 192, 0, 64);
  assert.equal(o2[0][10], 1);
  assert.ok(Math.abs(o2[0][130] - 64 / 127) < 1e-6);
  const ib = f.seen.filter((m) => m.frames !== undefined).slice(-3);
  assert.deepEqual(ib.map((b) => b.ch), [0, 0, 0]);
  assert.deepEqual(ib[1].evs, [[36, 0x80, 60, 0]]);
  assert.deepEqual(ib[2].evs, [[2, 0x90, 62, 64]]);
});

test("bridge.js: a closed bridge fails what waits", async () => {
  const f = fakeBridge(), { B, store } = load(f);
  store["oros-studio-bridge"] = f.o.token;
  await B.connect();
  const evs = [];
  B.on((e) => evs.push(e.event));
  B.forget();
  await new Promise((r) => setTimeout(r, 5));
  assert.ok(evs.includes("closed"));
  assert.equal(B.connected(), false);
  assert.equal(store["oros-studio-bridge"], undefined);
  await assert.rejects(B.list(), /closed/);
});

test("core: track.br is checked (plugin id, state path, source track)", () => {
  const base = { id: "tabcdef12", m: 1, p: "pabcdef12", name: "Piano · Zeta" };
  const ok = C.normTrack(Object.assign({}, base, { br: { id: "vst3:ABCDEF0123456789ABCDEF0123456789", name: "Zeta Verb", st: "/internal/Studio/bridge/tabcdef12.txt", from: "t12345678" } }));
  assert.deepEqual(ok.br, { id: "vst3:ABCDEF0123456789ABCDEF0123456789", name: "Zeta Verb", st: "/internal/Studio/bridge/tabcdef12.txt", from: "t12345678" });
  assert.equal(C.normTrack(Object.assign({}, base, { br: { id: "vst2:x", from: "t12345678" } })).br, undefined);
  assert.equal(C.normTrack(Object.assign({}, base, { br: { id: "clap:x", from: "p12345678" } })).br, undefined);
  assert.equal(C.normTrack(Object.assign({}, base, { br: { id: "clap:x", from: "t12345678", st: "/internal/Studio/../Music/a" } })).br.st, "");
  assert.equal(C.normTrack(Object.assign({}, base, { br: { id: "clap:x", from: "t12345678", st: "/internal/Notes/a" } })).br.st, "");
  assert.equal(C.normTrack(base).br, undefined);
});

test("wiring: the track dialog, the bridge dialog, the lazy script, the service worker, the CSP", () => {
  const html = read("studio/index.html"), js = read("studio/studio.js"), sw = read("sw.js"), csp = read(".github/scripts/csp.js");
  ["track-br", "br-dlg", "br-off", "br-pair", "br-on", "br-code", "br-plugin", "br-scan", "br-window", "br-freeze", "br-status", "br-close"].forEach((id) => {
    assert.ok(html.includes('id="' + id + '"'), id);
  });
  assert.ok(!html.includes('src="bridge.js'), "bridge.js is not loaded up front");
  assert.match(js, /s\.src = "bridge\.js\?v=" \+ VER;/, "loaded when the dialog opens");
  assert.ok(html.includes('href="https://useoros.online/download/#bridge"'));
  const dl = read("download/index.html");
  assert.equal(dl.split("releases/latest/download/oros-bridge-windows-x64.exe").length - 1, 2, "EN and EL download buttons");
  assert.equal(dl.split("releases/latest/download/oros-bridge-linux-x64.tar.gz").length - 1, 2, "EN and EL Linux download buttons (Bridge 0.3.0)");
  assert.ok(sw.includes('"studio/bridge.js"'));
  assert.ok(csp.includes("ws://127.0.0.1:*"));
  assert.ok(html.includes("ws://127.0.0.1:*"), "the CSP was written");
  // the freeze: dry render or notes as MIDI, 24-bit WAV, one undo step, the original muted
  assert.match(js, /BRG\.renderAll\(o\.h, input, o\.instrument \? brEvents\(src, end\) : \[\]/);
  assert.match(js, /C\.wavBytes\(chans, BR_RATE, 24\)/);
  assert.match(js, /undoStack\.push\(before\); redoStack = \[\];\n        changed\(\);/);
  assert.match(js, /put\("tracks", Object\.assign\(\{\}, src, \{ mute: true \}\)\)/);
  assert.match(js, /if \(nxOf\(src\)\) \{ brStatus\(t\("br\.nx"\)\); return; \}/);
  // every string in EN, EL and DE
  const de = read("i18n/de/studio.js");
  (js.match(/"br\.[a-zA-Z]+"/g) || []).forEach((k) => {
    assert.equal(js.split(k + ":").length - 1, 2, k + " in EN and EL");
    assert.ok(de.includes(k + ":"), k + " in DE");
  });
});
