// Play on (cast.js, CAST-1): what the picker offers from what the browser
// can do, which addresses may go to a TV, the device-local output choice,
// and the apps that carry the button.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const C = require("../cast.js");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

function memStore(init) {
  const m = new Map(Object.entries(init || {}));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m };
}

test("castable: only http(s) addresses go to another device", () => {
  assert.equal(C.castable("https://ex.org/live.m3u8"), true);
  assert.equal(C.castable("http://radio.ex:8000/stream"), true);
  for (const u of ["blob:https://useoros.online/1", "data:audio/mp3;base64,AA", "javascript:alert(1)",
    "", null, undefined, "https://a b", "ftp://x/y", "https://" + "a".repeat(5000)]) {
    assert.equal(C.castable(u), false, String(u).slice(0, 40));
  }
});

test("model: no output choice in the browser shows the system output only", () => {
  const m = C.model({ canSink: false, outputs: [{ id: "default", label: "" }], remote: "none", rstate: "disconnected", stream: true });
  assert.deepEqual(m.device, [{ kind: "system", on: true }]);
  assert.deepEqual(m.net, []);
  assert.equal(m.netNote, "net.none");
});

test("model: listed outputs, current one pressed, communications left out", () => {
  const m = C.model({
    canSink: true, sink: "bt1", remote: "unavailable", rstate: "disconnected", stream: true,
    outputs: [{ id: "default", label: "Default" }, { id: "communications", label: "Comms" }, { id: "bt1", label: "JBL Flip" }, { id: "hdmi", label: "" }]
  });
  assert.deepEqual(m.device.map((d) => [d.id, d.on]), [["default", false], ["bt1", true], ["hdmi", false]]);
  assert.equal(m.device[2].n, 3);
  assert.equal(m.netNote, "net.none");
});

test("model: unknown current output falls back to the first; Firefox gets Choose a speaker", () => {
  const m = C.model({ canSink: true, canSelect: true, sink: "gone", outputs: [{ id: "default" }, { id: "x" }], remote: "none", stream: true });
  assert.equal(m.device[0].on, true);
  assert.equal(m.device[m.device.length - 1].kind, "select");
  const one = C.model({ canSink: true, canSelect: true, outputs: [{ id: "default" }], remote: "none" });
  assert.deepEqual(one.device.map((d) => d.kind), ["system", "select"]);
});

test("model: remote playback row, state while on a TV, no address", () => {
  assert.deepEqual(C.model({ remote: "available", rstate: "disconnected", stream: true }).net, [{ kind: "remote" }]);
  assert.deepEqual(C.model({ remote: "unknown", rstate: "disconnected", stream: true }).net, [{ kind: "remote" }]);
  assert.deepEqual(C.model({ remote: "unavailable", rstate: "connected", stream: true }).net, [{ kind: "remote-on", state: "connected" }]);
  assert.deepEqual(C.model({ remote: "available", rstate: "connecting", stream: false }).net, [{ kind: "remote-on", state: "connecting" }]);
  const ns = C.model({ remote: "available", rstate: "disconnected", stream: false });
  assert.deepEqual(ns.net, []);
  assert.equal(ns.netNote, "net.nostream");
});

test("prefs: per app, device-local, sanitized", () => {
  const s = memStore();
  assert.deepEqual(C.prefs.read(s, "radio"), { sink: "" });
  C.prefs.write(s, "radio", "abc123");
  C.prefs.write(s, "television", "def");
  assert.deepEqual(C.prefs.read(s, "radio"), { sink: "abc123" });
  C.prefs.write(s, "radio", "default");
  assert.deepEqual(C.prefs.read(s, "radio"), { sink: "" });
  assert.deepEqual(JSON.parse(s.getItem(C.PREF)), { television: { sink: "def" } });
  C.prefs.write(s, "../x", "q");
  C.prefs.write(s, "radio", "z".repeat(300));
  assert.deepEqual(JSON.parse(s.getItem(C.PREF)), { television: { sink: "def" } });
  const bad = memStore({ [C.PREF]: "{not json" });
  assert.deepEqual(C.prefs.read(bad, "radio"), { sink: "" });
  C.prefs.write(bad, "radio", "ok");
  assert.deepEqual(C.prefs.read(bad, "radio"), { sink: "ok" });
  const arr = memStore({ [C.PREF]: JSON.stringify({ radio: { sink: 5 } }) });
  assert.deepEqual(C.prefs.read(arr, "radio"), { sink: "" });
});

test("strings: English, Greek and the German pack carry the same keys and placeholders", () => {
  const en = C.STR.en, el = C.STR.el;
  assert.deepEqual(Object.keys(el).sort(), Object.keys(en).sort());
  let de = null;
  new Function("orosPack", read("i18n/de/cast.js"))((code, app, t) => { assert.equal(code, "de"); assert.equal(app, "cast"); de = t; });
  assert.deepEqual(Object.keys(de).sort(), Object.keys(en).sort());
  const ph = (s) => (s.match(/\{[a-z]+\}/g) || []).join();
  for (const k of Object.keys(en)) { assert.equal(ph(el[k]), ph(en[k]), k); assert.equal(ph(de[k]), ph(en[k]), k); }
});

test("no Google Cast SDK and no HTML from devices", () => {
  const src = read("cast.js");
  assert.doesNotMatch(src, /gstatic|cast_sender|chrome\.cast|__onGCastApiAvailable/);
  assert.doesNotMatch(src, /innerHTML|insertAdjacentHTML|outerHTML/);
});

test("Radio and Television load cast.js with its strings and wire the button", () => {
  for (const [app, btn] of [["radio", "rx-pl-cast"], ["television", "tvp-cast"]]) {
    const html = read(app + "/index.html");
    assert.match(html, new RegExp('data-app="' + app + ',cast"'), app);
    const i = html.indexOf("../cast.js"), j = html.indexOf(app + ".js?");
    assert.ok(i > 0 && i < j, app + ": cast.js before the app script");
    assert.match(html, new RegExp('id="' + btn + '"'), app);
    assert.match(read(app + "/" + app + ".js"), /OrosCast\.attach\(/, app);
  }
  assert.match(read("television/television.js"), /probe: true/);
});

test("Podcasts and Music load cast.js and add the button to the full player", () => {
  for (const app of ["podcasts", "music"]) {
    const html = read(app + "/index.html");
    assert.match(html, /data-app="[a-z,]*\bcast"/, app);
    const i = html.indexOf("../cast.js"), j = html.indexOf(app + ".js?");
    assert.ok(i > 0 && i < j, app + ": cast.js before the app script");
    const js = read(app + "/" + app + ".js");
    assert.match(js, /OrosCast\.attach\(/, app);
    assert.match(js, /id = "fp-cast"/, app);
  }
  // Music sends only https songs (disk files and offline copies are blob:).
  assert.ok(read("music/music.js").includes('/^https:\\/\\//i.test(c.u)'));
});

// ---------- orOS Bridge (DLNA) ----------

test("cleanRenderers: drops bad rows and duplicates, strips control characters, caps lengths", () => {
  const l = C.cleanRenderers([
    { id: "upnp:uuid:1", name: "Living room\u0007 TV", vendor: "LG", model: "OLED", volume: true },
    { id: "upnp:uuid:1", name: "dup" },
    { id: "", name: "no id" },
    { id: "x".repeat(300), name: "long id" },
    null, 7,
    { id: "upnp:uuid:2", name: "", vendor: "Kodi", model: "" },
    { id: "upnp:uuid:3", name: "<b>x</b>".repeat(40) }
  ]);
  assert.deepEqual(l.map((r) => r.id), ["upnp:uuid:1", "upnp:uuid:2", "upnp:uuid:3"]);
  assert.equal(l[0].name, "Living room TV");
  assert.equal(l[0].sub, "LG OLED");
  assert.equal(l[0].volume, true);
  assert.equal(l[1].name, "Kodi");
  assert.equal(l[1].volume, false);
  assert.equal(l[2].name.length, 120);
  assert.deepEqual(C.cleanRenderers("nope"), []);
  assert.equal(C.cleanRenderers(Array.from({ length: 100 }, (_, i) => ({ id: "r" + i }))).length, 64);
});

// A fake bridge behind the WebSocket constructor.
function fakeBridge(opts) {
  const sent = [];
  let last = null;
  function WS(url) {
    assert.equal(url, "ws://127.0.0.1:47621/");
    last = this;
    this.readyState = 0;
    setTimeout(() => {
      if (opts.down) { this.onerror && this.onerror(); return; }
      this.readyState = 1;
      this.onopen && this.onopen();
      this.onmessage({ data: JSON.stringify({ event: "hello", version: opts.version || "0.10.0", cast: opts.cast }) });
    }, 1);
  }
  WS.prototype.send = function (s) {
    const m = JSON.parse(s);
    sent.push(m);
    const reply = (o) => setTimeout(() => this.onmessage({ data: JSON.stringify(Object.assign({ id: m.id }, o)) }), 1);
    if (m.op === "auth") reply(m.token === "tok" ? { ok: true } : { ok: false, error: "unknown token" });
    else if (m.op === "pair" && !m.code) reply({ ok: true });
    else if (m.op === "pair") reply(m.code === "123456" ? { ok: true, token: "tok" } : { ok: false, error: "bad code" });
    else if (m.op === "renderers") reply({ ok: true, renderers: [{ id: "upnp:a", name: "TV", volume: true }, { id: 5 }] });
    else if (m.op === "castStart") reply(m.renderer === "upnp:a" ? { ok: true } : { ok: false, code: "notfound", error: "gone" });
    else reply({ ok: true });
  };
  WS.prototype.close = function () { this.readyState = 3; this.onclose && this.onclose(); };
  return { WS, sent, ws: () => last };
}
function kv(init) {
  const m = new Map(Object.entries(init || {}));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}

test("bridgeClient: no bridge, an old bridge, pairing with the shared Studio token", async () => {
  await assert.rejects(C.bridgeClient(fakeBridge({ down: true }).WS, kv()).connect(200), /nobridge/);
  assert.equal(await C.bridgeClient(fakeBridge({ cast: false }).WS, kv()).connect(200), "old");

  const st = kv();
  const b = fakeBridge({ cast: true });
  const c = C.bridgeClient(b.WS, st);
  assert.equal(await c.connect(200), "pair");
  await c.pair();
  await assert.rejects(c.sendCode("999999"), /bad code/);
  await c.sendCode("12 34 56");
  assert.equal(st.getItem(C.BR_KEY), "tok");
  assert.equal(C.BR_KEY, "oros-studio-bridge");
  assert.equal(b.sent.at(-1).code, "123456");
  assert.equal(await c.connect(200), "ok");

  // A forgotten token asks for pairing again and is cleared.
  const st2 = kv({ "oros-studio-bridge": "old" });
  assert.equal(await C.bridgeClient(fakeBridge({ cast: true }).WS, st2).connect(200), "pair");
  assert.equal(st2.getItem(C.BR_KEY), null);
});

test("bridgeClient: renderers cleaned, start/control carry checked fields, errors keep their code", async () => {
  const b = fakeBridge({ cast: true });
  const c = C.bridgeClient(b.WS, kv({ "oros-studio-bridge": "tok" }));
  assert.equal(await c.connect(200), "ok");
  assert.deepEqual(await c.renderers(true), [{ id: "upnp:a", name: "TV", sub: "", volume: true }]);
  assert.equal(b.sent.at(-1).full, true);
  await c.start("upnp:a", "https://x.org/s", "Station\u0000 one", "video");
  assert.deepEqual(b.sent.at(-1), { id: b.sent.at(-1).id, op: "castStart", renderer: "upnp:a", url: "https://x.org/s", title: "Station one", kind: "video" });
  await c.start("upnp:a", "https://x.org/s", "", "weird");
  assert.equal(b.sent.at(-1).kind, "audio");
  await c.control("upnp:a", "volume", 140.6);
  assert.equal(b.sent.at(-1).volume, 100);
  await c.control("upnp:a", "pause");
  assert.equal("volume" in b.sent.at(-1), false);
  await assert.rejects(c.start("upnp:gone", "https://x.org/s", "", "audio"), (e) => e.code === "notfound");
  // A closed socket fails what waits, and the next call reports closed.
  b.ws().close();
  await assert.rejects(c.status("upnp:a"), /closed/);
});
