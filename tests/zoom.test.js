// ZOOM-1: apps grow out of their icon and shrink back into it or the
// Dock (shell.js). Source checks: the guards, the hooks, the setting.
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const shell = fs.readFileSync(path.join(root, "shell.js"), "utf8");
const css = fs.readFileSync(path.join(root, "style.css"), "utf8");
const settings = fs.readFileSync(path.join(root, "settings/settings.js"), "utf8");
const Core = require(path.join(root, "settings/core.js"));
const de = fs.readFileSync(path.join(root, "i18n/de/settings.js"), "utf8");

function body(name) {
  const i = shell.indexOf("function " + name + "(");
  assert.ok(i >= 0, name);
  let d = 0, j = shell.indexOf("{", i);
  for (let k = j; k < shell.length; k++) {
    if (shell[k] === "{") d++;
    else if (shell[k] === "}" && --d === 0) return shell.slice(i, k + 1);
  }
  throw new Error("unclosed " + name);
}

test("zoom: on by default, off only by its own device key", () => {
  assert.match(body("zoomOn"), /localStorage\.getItem\(ZOOM_KEY\) !== "0"/);
  assert.match(shell, /var ZOOM_KEY = "oros-zoom"/);
  assert.match(body("zoomSetUser"), /removeItem\(ZOOM_KEY\)[\s\S]*setItem\(ZOOM_KEY, "0"\)[\s\S]*settingsNotify\(\)/);
});

test("zoom: never with reduced motion, low battery, SOLO, side by side or a hidden tab", () => {
  const can = body("zoomCan");
  ["SOLO", "!zoomOn()", "zoom.lowBat", "document.hidden", "zoomReduced()", "data-oros-saver\") === \"1\"", "mt.side", "Element.prototype.animate"].forEach((g) => {
    assert.ok(can.includes(g), g);
  });
  assert.match(body("zoomReduced"), /prefers-reduced-motion: reduce/);
  assert.match(body("zoomBattery"), /!b\.charging && b\.level < 0\.2/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ #oros-zoom \{ display: none; \} \}/);
});

test("zoom: drawn after openApp and returnToDesktop have done their work", () => {
  const open = body("openApp");
  assert.match(open, /wpLandRefresh\(\);\n    zoomOpen\(app\);[^\n]*\n  \}$/);
  const back = body("returnToDesktop");
  assert.ok(back.indexOf("zoomRect()") < back.indexOf("mtSideEnd(true)"), "rect read before the app goes");
  assert.match(back, /tipEnd\(\);\n    zoomClose\(prev, zoomFromRect\);[^\n]*\n  \}$/);
});

test("zoom: targets are rectangles (icon, Dock bar, edge), never a side", () => {
  const icon = body("zoomIcon"), close = body("zoomClose");
  assert.match(icon, /\^\[a-z0-9_-\]\+\$/);             // safe selector
  assert.match(icon, /ld-hidden/);
  assert.match(close, /zoomIcon\(app && app\.id\) \|\| zoomVisible\(bar\) \|\| zoomVisible\(document\.getElementById\("ld-edge"\)\)/);
  assert.doesNotMatch(close + body("zoomOpen"), /bottom|left\s*===|position\s*===/);
  assert.match(close, /g\.setAttribute\("aria-hidden", "true"\)/);
  assert.match(css, /#oros-zoom \{[\s\S]*?z-index: 940;[\s\S]*?pointer-events: none;/);
});

test("zoom: Settings › Appearance switch, this device, EN/EL/DE", () => {
  assert.strictEqual(Core.SCOPE.zoom, "computers");   // LOOK-1: shared between computers
  assert.ok(Core.findSettings, "search");
  assert.match(settings, /switchBtn\(!!s\.zoom\.on, "zoom"/);
  assert.match(shell, /zoom: SOLO \? null : \{ on: zoomOn\(\), feel: feelNow\(\)/);   // FEEL-1 adds the feel
  assert.match(shell, /case "zoom":\s+zoomSetUser\(!!value\); return;/);
  const src = fs.readFileSync(path.join(root, "settings/core.js"), "utf8");
  assert.strictEqual((src.match(/"a\.zoom": /g) || []).length, 2);
  assert.strictEqual((src.match(/"a\.zoom\.hint": /g) || []).length, 2);
  assert.match(src, /\["zoom", "appearance", "a\.zoom"\]/);
  assert.match(de, /"a\.zoom": /);
  assert.match(de, /"a\.zoom\.hint": /);
  assert.match(de, /"w\.zoom": /);
});
