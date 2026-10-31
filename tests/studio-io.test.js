// Studio recording through the sound card with orOS Bridge 0.3.0
// (Studio v1.12.0): the sound card part of studio/bridge.js against a
// stand-in bridge (audioDevices, audioOpen, audioPlay + ORP1 blocks,
// audioStart/Stop, takeRead + ORT1 blocks), and the wiring in studio.js,
// index.html and the EN/EL/DE strings and help.
// Run: node --test tests/*.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

// The stand-in: a card with 4 inputs; what was played comes back on
// input 1/2 LAT frames later, input 3/4 at half the level.
function fakeBridge() {
  const token = "ab".repeat(32), seen = [], LAT = 7;
  let play = null, take = null;
  class WS {
    constructor() {
      this.readyState = 0;
      setTimeout(() => { this.readyState = 1; this.onopen && this.onopen({}); }, 0);
    }
    reply(j) { setTimeout(() => this.onmessage && this.onmessage({ data: j instanceof ArrayBuffer ? j : JSON.stringify(j) }), 0); }
    close() { this.readyState = 3; setTimeout(() => this.onclose && this.onclose({}), 0); }
    send(d) {
      if (typeof d !== "string") {
        const dv = new DataView(d), tag = String.fromCharCode(...new Uint8Array(d, 0, 4));
        const at = dv.getUint32(4, true), n = dv.getUint32(8, true), ch = dv.getUint16(12, true);
        seen.push({ tag, at, n, ch });
        for (let c = 0; c < ch; c++) play[c].set(new Float32Array(d.slice(16 + c * n * 4, 16 + (c + 1) * n * 4)), at);
        return;
      }
      const m = JSON.parse(d);
      seen.push(m);
      const ok = (x) => this.reply(Object.assign({ id: m.id, ok: true }, x || {}));
      if (m.op === "auth") return ok();
      if (m.op === "audioDevices") return ok({ backends: [
        { id: "wasapi", label: "Windows Audio (WASAPI)", exclusive: true, ok: true,
          inputs: [{ name: "Line (EIE)", channels: 4, default: false }, { name: "Mic", channels: 1, default: true }, { name: 7 }],
          outputs: [{ name: "Speakers", channels: 2, default: true }] },
        { id: "jack", label: "JACK", ok: false, error: "JACK is not running" },
        { id: "Bad Id!", label: "x", ok: true }] });
      if (m.op === "audioOpen") { this.rec = m.record; return ok({ sr: 44100, period: 256, inputs: 4, outputs: 2, latency: LAT, record: m.record }); }
      if (m.op === "audioPlay") { play = Array.from({ length: m.channels }, () => new Float32Array(m.frames)); return ok(); }
      if (m.op === "audioStart") return ok();
      if (m.op === "audioStop") {
        const n = (play && play[0] ? play[0].length : 0) + LAT + 10;
        take = this.rec.map((ch) => {
          const x = new Float32Array(n);
          for (let i = LAT; i < n; i++) { const v = play[ch & 1] && i - LAT < play[ch & 1].length ? play[ch & 1][i - LAT] : 0; x[i] = ch < 2 ? v : v * 0.5; }
          return x;
        });
        return ok({ frames: n, lost: 0 });
      }
      if (m.op === "takeRead") {
        const got = Math.max(0, Math.min(m.frames, take[0].length - m.offset)), nch = take.length;
        const b = new ArrayBuffer(16 + nch * got * 4), dv = new DataView(b);
        new Uint8Array(b).set([79, 82, 84, 49]);
        dv.setUint32(4, m.offset, true); dv.setUint32(8, got, true); dv.setUint16(12, nch, true);
        take.forEach((x, c) => new Float32Array(b, 16 + c * got * 4, got).set(x.subarray(m.offset, m.offset + got)));
        this.reply(b);
        return ok({ frames: got });
      }
      return ok();
    }
  }
  return { WS, seen, token, LAT };
}
function load(f) {
  global.WebSocket = f.WS;
  const p = require.resolve(path.join(ROOT, "studio", "bridge.js"));
  delete require.cache[p];
  const mod = require(p);
  const store = { "oros-studio-bridge": f.token };
  mod.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  return mod.StudioBridge;
}

test("bridge.js: the sound cards are cleaned (ids, names, channels)", async () => {
  const f = fakeBridge(), B = load(f);
  await B.connect();
  const list = await B.devices();
  assert.deepEqual(list.map((b) => [b.id, b.ok, b.exclusive]), [["wasapi", true, true], ["jack", false, false]]);
  assert.deepEqual(list[0].inputs, [{ name: "Line (EIE)", channels: 4, def: false }, { name: "Mic", channels: 1, def: true }]);
  assert.deepEqual(list[1].inputs, []);
});

test("bridge.js: the song goes ahead in blocks, the take comes back whole and in step", async () => {
  const f = fakeBridge(), B = load(f);
  await B.connect();
  const j = await B.audioOpen({ backend: "wasapi", input: "Line (EIE)", record: [0, 3] });
  assert.equal(f.seen.find((m) => m.op === "audioOpen").period, 256);
  const N = 150000, L = new Float32Array(N), R = new Float32Array(N);
  for (let i = 0; i < N; i++) { L[i] = Math.fround(((i % 101) - 50) / 100); R[i] = -L[i]; }
  await B.play([L, R], 0);
  const blocks = f.seen.filter((m) => m.tag === "ORP1");
  assert.deepEqual(blocks.map((b) => [b.at, b.n, b.ch]), [[0, 65536, 2], [65536, 65536, 2], [131072, N - 131072, 2]]);
  await B.start();
  const s = await B.stop();
  const steps = [];
  const take = await B.take(s.frames, 2, (x) => steps.push(x));
  assert.equal(take.length, 2);
  assert.equal(take[0].length, s.frames);
  for (let i = 0; i < N; i += 997) {
    assert.equal(take[0][i + j.latency], L[i], "input 1 at " + i);
    assert.equal(take[1][i + j.latency], Math.fround(R[i] * 0.5), "input 4 at " + i);
  }
  assert.equal(f.seen.filter((m) => m.op === "takeRead").length, 3);
  assert.equal(steps[steps.length - 1], 1);
  // nothing to play: an empty play, no blocks
  const before = f.seen.filter((m) => m.tag === "ORP1").length;
  await B.play([], 0);
  const last = f.seen.filter((m) => m.op === "audioPlay").pop();
  assert.deepEqual([last.frames, last.channels], [0, 0]);
  assert.equal(f.seen.filter((m) => m.tag === "ORP1").length, before);
});

test("wiring: settings, recording path, every string in EN/EL/DE and the help", () => {
  const html = read("studio/index.html"), js = read("studio/studio.js"), de = read("i18n/de/studio.js");
  ["io-mode", "io-sec", "io-pair", "io-code", "io-pair-go", "io-on", "io-be", "io-in", "io-ch", "io-out", "io-ex", "io-ex-sec",
    "io-meters", "io-test", "io-refresh", "io-status", "io-off", "io-connect"].forEach((id) => assert.ok(html.includes('id="' + id + '"'), id));
  // the take: rendered at the card's rate, played and recorded by the bridge, placed minus its round trip and the offset
  assert.match(js, /renderMix\(\{ a: from, b: end \}, j\.sr\)/);
  assert.match(js, /ioRec\.lat = \(j\.latency \| 0\) \/ j\.sr \+ prefs\.lat \/ 1000;/);
  assert.match(js, /if \(ioOn\(\) && !keysOpen\(\)\) \{/);
  assert.match(js, /if \(recording && ioRec\) \{ stopIoRec\(\); return; \}/);
  assert.match(js, /renderMix\(r, rate\)\.then\(function \(chans\) \{ done\(chans\); \}, fail\);/, "the export uses the same mix");
  assert.match(js, /C\.wavBytes\(g, r\.sr, 24\)/);
  // prefs.io stays on this device: normalized, never in the synced data
  assert.match(js, /io: normIo\(p\.io\),/);
  const keys = Array.from(new Set(js.match(/"io\.[a-zA-Z]+"/g)));
  assert.ok(keys.length >= 25);
  keys.forEach((k) => {
    assert.equal(js.split(k + ":").length - 1, 2, k + " in EN and EL");
    assert.ok(de.includes(k + ":"), k + " in DE");
  });
  ["studio/help.en.txt", "studio/help.el.txt", "i18n/de/help/studio.txt"].forEach((f) => {
    const h = read(f);
    assert.ok(/orOS Bridge\)/.test(h) && /JACK/.test(h) && /PipeWire/.test(h) && /ASIO/.test(h), f);
  });
});
