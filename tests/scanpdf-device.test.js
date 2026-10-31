// orOS Scanner & PDF, a scanner on this computer (scanpdf/device.js):
// what orOS Bridge lists is cleaned, the settings chosen, ORS1 strips
// put together into pages (colour and grey, wrong order refused), the
// error codes mapped, and the client against a stand-in bridge
// (hello, pairing shared with Studio, an old bridge, the scanner list).
// The wiring (strings EN/EL/DE, the page loads device.js, CSP).
// Run: node --test tests/*.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const D = require(path.join(ROOT, "scanpdf/device.js"));

// an ORS1 strip as the bridge sends it
function strip(page, w, y, rows, ch, fill) {
  const b = new ArrayBuffer(20 + rows * w * ch), dv = new DataView(b), u8 = new Uint8Array(b);
  u8.set([79, 82, 83, 49], 0);
  dv.setUint32(4, page, true); dv.setUint32(8, w, true); dv.setUint32(12, y, true);
  dv.setUint16(16, rows, true); u8[18] = ch;
  for (let r = 0; r < rows; r++) for (let x = 0; x < w; x++) for (let c = 0; c < ch; c++) u8[20 + (r * w + x) * ch + c] = fill(x, y + r, c);
  return b;
}

test("device: the scanner list keeps known words and sane numbers only", () => {
  const list = D.cleanScanners([
    { id: "wia:{1}", name: "Office MFP", sources: ["adf", "flatbed", "tray"], modes: ["gray", "sepia", "color"], dpi: [1200, 300, 75, 300, 2.5, "600", 600] },
    { id: "sane:x", name: 7, model: "Model X" },
    { id: "", name: "no id" }, null, { name: "no id either" },
    { id: "sane:<img src=x onerror=alert(1)>", name: "<b>bold</b>", sources: [], modes: [], dpi: [] }
  ]);
  assert.equal(list.length, 3);
  assert.deepEqual(list[0], { id: "wia:{1}", name: "Office MFP", sources: ["flatbed", "adf"], modes: ["color", "gray"], dpi: [75, 300, 600] });
  assert.deepEqual(list[1], { id: "sane:x", name: "Model X", sources: ["flatbed"], modes: ["color"], dpi: [300] });
  assert.equal(list[2].name, "<b>bold</b>", "names are shown as text (textContent), never as markup");
  assert.deepEqual(D.cleanScanners("nope"), []);
  assert.ok(D.cleanScanners(new Array(100).fill({ id: "a:b" })).length <= 64);
});

test("device: settings are the last used when offered, otherwise glass, colour, nearest 300 dpi", () => {
  const sc = { sources: ["flatbed", "adf", "adf-duplex"], modes: ["gray", "color"], dpi: [100, 200, 400, 600] };
  assert.deepEqual(D.choose(sc, {}), { source: "flatbed", mode: "color", dpi: 200 });
  assert.deepEqual(D.choose(sc, { source: "adf-duplex", mode: "gray", dpi: 600 }), { source: "adf-duplex", mode: "gray", dpi: 600 });
  assert.deepEqual(D.choose({ sources: ["adf"], modes: ["lineart"], dpi: [300] }, { source: "flatbed", mode: "color", dpi: 150 }),
    { source: "adf", mode: "lineart", dpi: 300 });
});

test("device: strips become a page, colour and grey, sample for sample", () => {
  const col = (x, y, c) => (x + 2 * y + 50 * c) & 255;
  const b = D.pageBuilder();
  b.add(D.parseStrip(strip(0, 5, 0, 3, 3, col)));
  b.add(D.parseStrip(strip(0, 5, 3, 4, 3, col)));
  assert.equal(b.rows(), 7);
  const img = b.done({ width: 5, height: 7, channels: 3 });
  assert.equal(img.width, 5); assert.equal(img.height, 7);
  for (let y = 0; y < 7; y++) for (let x = 0; x < 5; x++) {
    const i = (y * 5 + x) * 4;
    assert.deepEqual([...img.data.slice(i, i + 4)], [col(x, y, 0), col(x, y, 1), col(x, y, 2), 255]);
  }
  const g = D.pageBuilder(), grey = (x, y) => (x * 9 + y) & 255;
  g.add(D.parseStrip(strip(2, 4, 0, 2, 1, grey)));
  const gi = g.done({ width: 4, height: 2, channels: 1 });
  assert.deepEqual([...gi.data.slice(12, 16)], [grey(3, 0), grey(3, 0), grey(3, 0), 255]);
});

test("device: a strip out of order, a short page or a bad block gives no page", () => {
  const f = () => 7;
  const b = D.pageBuilder();
  b.add(D.parseStrip(strip(0, 4, 0, 2, 1, f)));
  b.add(D.parseStrip(strip(0, 4, 3, 2, 1, f)));   // a gap
  assert.equal(b.done({ width: 4, height: 4, channels: 1 }), null);
  const s = D.pageBuilder();
  s.add(D.parseStrip(strip(0, 4, 0, 2, 1, f)));
  assert.equal(s.done({ width: 4, height: 3, channels: 1 }), null, "the bridge says more rows than came");
  assert.equal(D.parseStrip(new ArrayBuffer(10)), null);
  const wrongTag = strip(0, 2, 0, 1, 1, f); new Uint8Array(wrongTag)[3] = 50;
  assert.equal(D.parseStrip(wrongTag), null);
  const cut = strip(0, 4, 0, 2, 3, f).slice(0, 30);
  assert.equal(D.parseStrip(cut), null);
  const ch2 = strip(0, 2, 0, 1, 1, f); new Uint8Array(ch2)[18] = 2;
  assert.equal(D.parseStrip(ch2), null);
});

test("device: error codes and looks", () => {
  assert.equal(D.errKey("nopaper"), "dv.e.nopaper");
  assert.equal(D.errKey("busy"), "dv.e.busy");
  assert.equal(D.errKey("weird"), "dv.e.other");
  assert.equal(D.errKey(undefined), "dv.e.other");
  assert.equal(D.lookFor("lineart"), "bw");
  assert.equal(D.lookFor("gray"), "gray");
  assert.equal(D.lookFor("color"), "color");
});

// ---- the client against a stand-in bridge ----
function fakeBridge({ scanner = true, tokens = ["good"] } = {}) {
  const sent = [];
  class WS {
    constructor(url) {
      this.url = url; this.readyState = 0; sent.length = 0; WS.last = this;
      setTimeout(() => {
        this.readyState = 1; this.onopen && this.onopen();
        this.reply({ event: "hello", app: "oros-bridge", version: scanner ? "0.9.0" : "0.8.0", scanner: scanner || undefined });
      }, 1);
    }
    reply(o) { this.onmessage && this.onmessage({ data: JSON.stringify(o) }); }
    send(s) {
      const m = JSON.parse(s);
      sent.push(m);
      setTimeout(() => {
        if (m.op === "auth") this.reply({ id: m.id, ok: tokens.includes(m.token), error: "unknown token" });
        else if (m.op === "pair" && !m.code) this.reply({ id: m.id, ok: true, shown: true });
        else if (m.op === "pair") this.reply(m.code === "123456" ? { id: m.id, ok: true, token: "fresh" } : { id: m.id, ok: false, error: "wrong code" });
        else if (m.op === "scanners") this.reply({ id: m.id, ok: true, scanners: [{ id: "test:loop", name: "T", sources: ["flatbed"], modes: ["gray"], dpi: [75] }], missing: [{ code: "nosane" }] });
        else if (m.op === "scanStart") {
          this.reply({ id: m.id, ok: true });
          this.onmessage({ data: strip(0, 2, 0, 1, 1, () => 1) });
          this.reply({ event: "scanPage", page: 0, width: 2, height: 1, channels: 1 });
          this.reply({ event: "scanDone", pages: 1, cancelled: false });
        }
      }, 1);
    }
    close() { this.readyState = 3; this.onclose && this.onclose(); }
  }
  return { WS, sent };
}
function store(init) {
  const m = new Map(Object.entries(init || {}));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}

test("device: the pairing is Studio's (same key), a known token connects, a new one is kept", async () => {
  const studio = read("studio/bridge.js");
  assert.match(studio, new RegExp('KEY = "' + D.KEY + '"'), "Scan PDF and Studio keep the token under one key");
  assert.match(studio, new RegExp("PORT = " + D.PORT));
  const s1 = store({ [D.KEY]: "good" }), b1 = fakeBridge();
  const c1 = D.client(b1.WS, s1);
  assert.equal(await c1.connect(), "ok");
  assert.equal(b1.WS.last.url, "ws://127.0.0.1:47621/");
  assert.ok(c1.connected());

  const s2 = store({ [D.KEY]: "stale" }), b2 = fakeBridge();
  const c2 = D.client(b2.WS, s2);
  assert.equal(await c2.connect(), "pair", "an unknown token asks for a code");
  assert.equal(s2.getItem(D.KEY), null, "and is forgotten");
  await c2.pair();
  await assert.rejects(c2.sendCode("000000"));
  await c2.sendCode("123 456");
  assert.equal(s2.getItem(D.KEY), "fresh");
  assert.equal(b2.sent.filter((m) => m.op === "pair" && m.code).pop().code, "123456");
});

test("device: an old bridge is told apart, no bridge rejects", async () => {
  const b = fakeBridge({ scanner: false });
  assert.equal(await D.client(b.WS, store({ [D.KEY]: "good" })).connect(), "old");
  class Dead { constructor() { setTimeout(() => this.onerror && this.onerror(), 1); } close() {} }
  await assert.rejects(D.client(Dead, store()).connect(100));
  class Silent { constructor() {} close() {} }
  await assert.rejects(D.client(Silent, store()).connect(50), /nobridge/);
});

test("device: the scanner list is cleaned, a scan gives its strip and events", async () => {
  const b = fakeBridge(), c = D.client(b.WS, store({ [D.KEY]: "good" }));
  await c.connect();
  const r = await c.scanners(true);
  assert.deepEqual(r.list, [{ id: "test:loop", name: "T", sources: ["flatbed"], modes: ["gray"], dpi: [75] }]);
  assert.equal(r.nosane, true);
  assert.equal(b.sent.find((m) => m.op === "scanners").full, true);
  const got = [];
  c.on((m) => got.push(m.event));
  await c.start({ scanner: "test:loop", source: "flatbed", mode: "gray", dpi: 75 });
  await new Promise((res) => setTimeout(res, 20));
  assert.deepEqual(got, ["strip", "scanPage", "scanDone"]);
  assert.deepEqual(b.sent.find((m) => m.op === "scanStart"), { id: b.sent.find((m) => m.op === "scanStart").id, op: "scanStart", scanner: "test:loop", source: "flatbed", mode: "gray", dpi: 75 });
});

test("device: wired into the app (script order, CSP, strings EN/EL/DE, hidden until a bridge answers)", () => {
  const html = read("scanpdf/index.html");
  const iDev = html.indexOf('src="device.js'), iApp = html.indexOf('src="scanpdf.js');
  assert.ok(iDev > 0 && iDev < iApp, "device.js loads before scanpdf.js");
  assert.match(html, /connect-src[^;]*ws:\/\/127\.0\.0\.1:\*/);
  assert.match(html, /id="dev-start"[^>]*hidden/);
  assert.match(html, /id="dev-more"[^>]*hidden/);
  const js = read("scanpdf/scanpdf.js"), de = read("i18n/de/scanpdf.js");
  const keys = ["btn.device", "dv.title", "dv.nobridge", "dv.old", "dv.pair", "dv.src.adf-duplex", "dv.m.lineart", "dv.read", "dv.page", "dv.got", "dv.got.one",
    "dv.e.busy", "dv.e.nopaper", "dv.e.jammed", "dv.e.cover", "dv.e.denied", "dv.e.gone", "dv.e.unsupported", "dv.e.nosane", "dv.e.other"];
  for (const k of keys) {
    const n = js.split('"' + k + '":').length - 1;
    assert.equal(n, 2, k + " in en and el");
    assert.ok(de.includes('"' + k + '":'), k + " in de");
  }
  assert.ok(!/innerHTML[^;]*dv\./.test(js), "bridge text is never markup");
});
