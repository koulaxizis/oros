// Icon packs (ICONPACK-1): iconpacks.css and its shell / Settings wiring.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const CSS = read("iconpacks.css");
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

const PACKS = JSON.parse(SHELL.match(/var ICON_PACKS = (\[[^\]]+\]);/)[1]);

function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a, b) {
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

test("six packs, Classic first and the default", () => {
  assert.deepEqual(PACKS, ["classic", "colourful", "glass", "thin", "paper", "round"]);
  assert.match(cut(SHELL, "shellDefault"), /case "icons":\s+return "classic";/);
  const canon = new Function("var ICON_PACKS = " + JSON.stringify(PACKS) + ";\n" + cut(SHELL, "iconsCanon") + "\nreturn iconsCanon;")();
  assert.equal(canon("paper"), "paper");
  assert.equal(canon("neon"), undefined);
  assert.equal(canon(null), undefined);
});

test("every pack but Classic styles the tiles (desktop and Dock) and keeps off in high contrast", () => {
  for (const p of PACKS.slice(1)) {
    assert.ok(CSS.includes('html[data-oros-icons="' + p + '"]:not([data-oros-contrast="high"]), .ip-prev[data-pack="' + p + '"]) .ld-tile {'), p + " tile rule");
  }
  assert.doesNotMatch(CSS, /data-oros-icons="classic"/, "Classic has no rules");
  for (const m of CSS.matchAll(/html\[data-oros-icons="[a-z]+"\](?!:not\(\[data-oros-contrast="high"\]\))/g)) {
    assert.fail("pack rule without the high-contrast guard at " + m.index);
  }
  // menu, search and task switcher: a chip where the pack has a fill
  for (const p of ["colourful", "paper", "round"]) {
    assert.ok(CSS.includes('.ip-prev[data-pack="' + p + '"]) .app-ico[data-cat] {'), p + " menu chip");
  }
});

test("every menu category has a colour, and its glyph reads on it", () => {
  const cats = new Set(JSON.parse(read("apps.json")).apps.map((a) => String(a.category || "other").toLowerCase().replace(/[^a-z]/g, "")));
  const rules = {};
  for (const m of CSS.matchAll(/\[data-cat="([a-z]+)"\]\s*\{\s*--ic-cat:\s*(#[0-9a-f]{6});\s*--ic-ink:\s*(#[0-9a-f]{6});\s*\}/g)) rules[m[1]] = [m[2], m[3]];
  for (const c of cats) {
    assert.ok(rules[c], "colour for " + c);
    const [fill, ink] = rules[c];
    assert.ok(["#ffffff", "#141414"].includes(ink), c + " glyph is white or #141414");
    assert.ok(contrast(fill, ink) >= 4.5, c + " " + contrast(fill, ink).toFixed(2));
    const other = ink === "#ffffff" ? "#141414" : "#ffffff";
    assert.ok(contrast(fill, ink) >= contrast(fill, other), c + ": the better of the two");
  }
  assert.ok(contrast("#f4efe3", "#2b2418") >= 4.5, "paper ink");
});

test("shell: the synced field icons, applied, set from Settings, pulled without a push", () => {
  assert.match(SHELL, /var SHELL_FIELDS = \[[^\]]*"icons"[^\]]*\];/);
  assert.match(cut(SHELL, "shellCanon"), /case "icons":\s+return iconsCanon\(v\);/);
  assert.match(cut(SHELL, "shellBuild"), /icons:\s+vals\.icons/);
  const set = cut(SHELL, "shellSliceSet");
  assert.match(set, /if \(iconsCanon\(data\.icons\)\) \{/);
  assert.doesNotMatch(set.slice(set.indexOf("iconsCanon(data.icons)"), set.indexOf("iconsCanon(data.icons)") + 200), /noteLocalChange|markDirty/);
  assert.match(set, /applyIcons\(\);/);
  assert.match(cut(SHELL, "setIconsUser"), /noteLocalChange\(\);/);
  assert.match(cut(SHELL, "applyIcons"), /setAttribute\("data-oros-icons", state\.icons\)/);
  assert.match(cut(SHELL, "settingsSet"), /case "icons":\s+setIconsUser\(value\);/);
  assert.match(read("device/core.js"), /keyOwner/);
});

test("surfaces carry their category; the stylesheet loads in the shell and Settings", () => {
  assert.match(cut(read("launcher.js"), "tileFor"), /setAttribute\("data-cat", /);
  assert.match(SHELL, /'<span class="app-ico" data-cat="' \+ iconCat\(app\) \+ '">'/);
  assert.match(SHELL, /ico\.setAttribute\("data-cat", iconCat\(app\)\);/);
  assert.match(read("index.html"), /<link rel="stylesheet" href="style\.css\?v=[^"]+">\s*<link rel="stylesheet" href="iconpacks\.css\?v=[^"]+">/);
  assert.match(read("settings/index.html"), /<link rel="stylesheet" href="\.\.\/iconpacks\.css\?v=[^"]+">/);
  assert.match(read("sw.js"), /"\.\/iconpacks\.css"/);
});

test("Settings card, search and strings in EN, EL and DE", () => {
  const ss = read("settings/settings.js");
  assert.match(ss, /if \(s\.icons\) secIcons\(host, s\.icons\);/);
  assert.match(cut(ss, "secIcons"), /set\("icons", id\)/);
  const core = read("settings/core.js"), de = read("i18n/de/settings.js");
  for (const k of ["a.icons", "a.icons.hint"].concat(PACKS.map((p) => "a.icons." + p))) {
    assert.equal((core.match(new RegExp('"' + k.replace(/\./g, "\\.") + '":', "g")) || []).length, 2, k + " EN + EL");
    assert.ok(de.includes('"' + k + '":'), k + " DE");
  }
  assert.match(core, /\["icons", "appearance", "a\.icons"\]/);
  assert.match(read("settings/search.js"), /\["appearance", "icons", "icons"\]/);
  assert.match(read("help/topics/appearance.en.txt"), /### Icon packs/);
  assert.match(read("help/topics/appearance.el.txt"), /### Πακέτα εικονιδίων/);
  assert.match(read("i18n/de/help/topics/appearance.txt"), /### Symbolpakete/);
});
