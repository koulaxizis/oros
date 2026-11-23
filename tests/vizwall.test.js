// Light show wallpaper (VIZWALL-1): vizkit.js 1.2.0 wallpaper options,
// the sound hosts' listener sets, the shell wiring, Settings and the
// Wallpaper Generator tab. Run: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const V = require(path.join(ROOT, "vizkit.js"));
const SHELL = read("shell.js");

function cut(src, name) {
  const i = src.indexOf("  function " + name + "(");
  if (i < 0) throw new Error("missing function " + name);
  let depth = 0, j = src.indexOf("{", i);
  for (; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) break;
  }
  return src.slice(i, j + 1);
}

test("vizkit 1.2.0+: Energy saver is a still reason after reduced motion", () => {
  assert.ok(V.v >= "1.2.0");
  assert.equal(V.stillReason({ saver: true }), "saver");
  assert.equal(V.stillReason({ reduced: true, saver: true }), "reduced");
  assert.equal(V.stillReason({ saver: false }), "");
  for (const l of ["en", "el", "de"]) assert.ok(V.STR[l].saver, "saver note in " + l);
});

test("vizkit: the rest picture and how far levels are from it", () => {
  assert.deepEqual(V.REST, { lo: 0.4, mid: 0.32, hi: 0.24 });
  assert.equal(V.restGap(V.REST), 0);
  assert.ok(V.restGap({ lo: 0, mid: 0, hi: 0 }) > 0.9);
});

test("vizkit: wallpaper options in the source (soft light, covered = no frames, rest, redraw)", () => {
  const s = read("vizkit.js");
  assert.match(s, /var soft = opts\.soft > 0 && opts\.soft < 1 \? \+opts\.soft : 1, rest = !!opts\.rest;/);
  assert.match(s, /g\.globalAlpha = soft;/);
  assert.match(s, /if \(covered\(\)\) \{ prevT = 0; return; \}/);
  assert.match(s, /else target = rest \? REST : \{ lo: 0, mid: 0, hi: 0 \};/);
  assert.match(s, /redraw: redraw,/);
  assert.match(s, /check: function \(\) \{ if \(setReason\(\)\) frame\(0, true\); else wake\(\); \}/);
});

test("hosts: the wallpaper listens as 'wall' and never restarts a stream", () => {
  const mu = read("music/host.js");
  assert.match(mu, /if \(on\) viz\.who\[who\] = 1; else delete viz\.who\[who\];\n    viz\.on = Object\.keys\(viz\.who\)\.length > 0;/);
  const pc = read("podcasts/host.js");
  // "wall" never touches the effects wiring (no reload of the episode)
  assert.match(pc, /if \(who === "wall" \|\| who === "widget"\) \{\n      if \(on\) vizPass\[who\] = 1; else delete vizPass\[who\];/);
  assert.match(pc, /if \(!vizOn && !vizWall\) return null;/);
  const rx = read("radio/radio.js");
  assert.match(rx, /if\(who === "wall" \|\| who === "widget"\)\{\n        if\(on\) viz\.pass\[who\] = 1; else delete viz\.pass\[who\];/);
  // only the app's own light upgrades (restarts) a stream
  assert.match(rx, /if\(audio\.crossOrigin\) vizCapture\(\); else if\(viz\.on\) vizUpgrade\(\);/);
  assert.match(rx, /var ok = viz\.on && viz\.ok\[vizOrigin\(u\)\] === true;/);
});

test("shell: canonical wpviz and the base colour", () => {
  const canon = new Function("var WP_VIZ_STYLES = " + JSON.stringify(V.STYLES) + ";\n" + cut(SHELL, "wpvizCanon") + "\nreturn wpvizCanon;")();
  assert.deepEqual(canon({}), { style: "glow" });
  assert.deepEqual(canon({ style: "bars", x: 1 }), { style: "bars" });
  assert.deepEqual(canon({ style: "lava" }), { style: "glow" });
  assert.equal(canon(null), null);
  assert.equal(canon([1]), null);
  const base = new Function(cut(SHELL, "wpVizBase") + "\nreturn wpVizBase;")();
  assert.match(base("#d4af37"), /^#[0-9a-f]{6}$/);
  assert.ok(parseInt(base("#ffffff").slice(1, 3), 16) < 40, "stays dark");
  assert.equal(base("nonsense"), base("#a78bfa"));
});

test("shell: Light show is a wallpaper, travels in the slice, pauses under apps", () => {
  assert.match(SHELL, /\{ id: "viz",\s+css: "" \}/);
  assert.match(SHELL, /var WP_VIZ_STYLES = \["glow", "rings", "bars", "wave"\];/);
  assert.deepEqual(V.STYLES, ["glow", "rings", "bars", "wave"]);
  assert.match(SHELL, /var SHELL_FIELDS = \[[^\]]*"wpviz"[^\]]*\];/);
  assert.match(cut(SHELL, "shellBuild"), /wpviz:\s+vals\.wpviz/);
  assert.match(cut(SHELL, "shellSliceSet"), /wpVizWrite\(state\.wpviz\)/);
  assert.match(cut(SHELL, "applyWallpaper"), /else if \(w\.id === "viz"\) \{ wpCustomStop\(\); wpLandStop\(\); wpVizApply\(desktop\); \}/);
  assert.match(cut(SHELL, "wpVizCovered"), /!!state\.running \|\| document\.hidden/);
  assert.match(cut(SHELL, "wpVizApply"), /soft: 0\.5,\n        rest: true/);
  assert.match(cut(SHELL, "wpVizApply"), /data-oros-saver"\) === "1"/);
  assert.match(cut(SHELL, "wpVizTick"), /var p = covered \? null : wpVizPlaying\(\);/);
  assert.match(cut(SHELL, "wpVizStop"), /C\.src\.h\.viz\(false, "wall"\)/);
  assert.match(cut(SHELL, "returnToDesktop"), /wpVizRefresh\(\)/);
  assert.match(cut(SHELL, "settingsSet"), /case "wpviz:style":/);
  assert.match(SHELL, /setViz: function \(v\) \{/);
  assert.match(read("style.css"), /html\[data-oros-contrast="high"\] #wp-viz,/);
});

test("names and strings: EN, EL, DE", () => {
  assert.match(read("translations.js"), /"wp\.name\.viz":\s+"Light show"/);
  assert.match(read("translations.js"), /"wp\.name\.viz":\s+"Φωτορυθμικό"/);
  assert.match(read("i18n/de/shell.js"), /"wp\.name\.viz": "Lichtshow"/);
  const core = read("settings/core.js"), de = read("i18n/de/settings.js");
  for (const k of ["style", "glow", "rings", "bars", "wave", "hint"]) {
    assert.equal(core.split('"a.wallpaper.viz.' + k + '"').length - 1, 2, "EN + EL " + k);
    assert.ok(de.includes('"a.wallpaper.viz.' + k + '"'), "DE " + k);
  }
  const w = read("wallpaper/wallpaper.js"), wde = read("i18n/de/wallpaper.js");
  for (const k of ["mode.viz", "vst.glow", "viz.hint", "viz.calm", "toast.vizSet", "btn.nextViz"]) {
    assert.equal(w.split('"' + k + '":').length - 1, 2, "EN + EL " + k);
    assert.ok(wde.includes('"' + k + '"'), "DE " + k);
  }
});

test("Wallpaper Generator: Light show tab, kit loaded, set through setViz", () => {
  const html = read("wallpaper/index.html");
  assert.match(html, /id="mode-viz" aria-controls="viz-panel"/);
  assert.match(html, /<div id="viz-panel" role="tabpanel" aria-labelledby="mode-viz" hidden>/);
  assert.match(html, /<script src="\.\.\/vizkit\.js\?v=[^"]+"><\/script>/);
  const w = read("wallpaper/wallpaper.js");
  assert.match(w, /api\.setViz\(\{ style: prefs\.viz\.style \}\)/);
  assert.match(w, /if \(!viz\) vizStop\(\);/);
});

// ---------- Wave 2: the bigger Playing widget (WG-MEDIA-2) ----------
test("widget: big row with cover, progress, prev / next, light; text through textContent", () => {
  const w = read("widgets.js");
  assert.match(w, /var VER = "1\.6\.0";/);
  const media = w.slice(w.indexOf("    media: function (c) {"), w.indexOf("    // PHONE-1"));
  assert.match(media, /var main = list2\.filter\(function \(m\) \{ return m\.playing; \}\)\[0\] \|\| list2\[0\] \|\| null;/);
  assert.match(media, /if \(main\.prev\)/);
  assert.match(media, /if \(main\.next\)/);
  assert.match(media, /if \(main\.live\) big\.appendChild\(el\("div", "wg-mlive", t\("wg\.media\.live"\)\)\);/);
  assert.match(media, /mp\.cur\.textContent = clock\(at\);/);
  assert.doesNotMatch(media, /innerHTML = (?!m\.playing|main\.playing|IC_)/, "only own icons as markup");
  // the cover address is quoted safely
  assert.match(media, /art\.replace\(\/\["\\\\\\n\\r\]\/g, ""\)/);
  // no listening under an app, light off from the card menu (device-local)
  assert.match(w, /if \(box && covered\(\) && !force\) \{ mediaLightRelease\(\); return; \}/);
  assert.match(w, /var LIGHT_KEY = "oros-wg-light";/);
  assert.match(w, /t\(lon \? "wg\.media\.lightOff" : "wg\.media\.lightOn"\)/);
});

test("widget clock: m:ss and h:mm:ss", () => {
  const w = read("widgets.js");
  const clock = new Function(cut(w, "clock") + "\nreturn clock;")();
  assert.equal(clock(0), "0:00");
  assert.equal(clock(65.9), "1:05");
  assert.equal(clock(3725), "1:02:05");
  assert.equal(clock(-3), "0:00");
  assert.equal(clock("x"), "0:00");
});

test("shell: media of Music and Podcasts read from their .api; cover only from safe addresses", () => {
  assert.match(cut(SHELL, "qsMedia"), /var mu = hostApi\(window\.__orosMusicHost\);/);
  assert.match(cut(SHELL, "qsMedia"), /var pc = hostApi\(window\.__orosPodcastsHost\);/);
  assert.match(cut(SHELL, "qsMedia"), /pos: \+ms\.pos \|\| 0, dur: \+ms\.dur \|\| 0,/);
  const hostApi = new Function(cut(SHELL, "hostApi") + "\nreturn hostApi;")();
  const api = { getState() {} };
  assert.equal(hostApi({ api }), api);
  assert.deepEqual(hostApi({ getState() {} }).api, undefined);
  const art = (md) => new Function("navigator", cut(SHELL, "wgMediaArt") + "\nreturn wgMediaArt;")({ mediaSession: { metadata: md } });
  assert.equal(art({ title: "Beat", artwork: [{ src: "blob:http://x/1" }] })("Beat · Test"), "blob:http://x/1");
  assert.equal(art({ title: "Beat", artwork: [{ src: "javascript:alert(1)" }] })("Beat · Test"), "");
  assert.equal(art({ title: "Other", artwork: [{ src: "https://a/b.png" }] })("Beat · Test"), "", "another player's cover");
  assert.match(cut(SHELL, "wgMediaTap"), /p\.h\.viz\(true, "widget"\)/);
});

test("widget strings: EN, EL, DE", () => {
  const tr = read("translations.js"), de = read("i18n/de/shell.js");
  for (const k of ["prev", "next", "live", "lightOn", "lightOff"]) {
    assert.equal(tr.split('"wg.media.' + k + '":').length - 1, 2, "EN + EL " + k);
    assert.ok(de.includes('"wg.media.' + k + '":'), "DE " + k);
  }
});
