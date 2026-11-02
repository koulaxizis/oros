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
