// SKIN-WP: every skin suggests one of the existing wallpapers, and a
// wallpaper the user picked stays theirs (shell.js maybeFollowSkin).
// Run: node --test tests/
//
// shell.js is a browser IIFE, so the registries and the two pure
// helpers are cut out of the source by name (brace matching) and run
// with stubbed state. A renamed function fails here loudly.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = fs.readFileSync(path.join(__dirname, "..", "shell.js"), "utf8");

function cutBlock(head) {
  const i = SRC.indexOf(head);
  if (i < 0) throw new Error("missing " + head);
  const open = head.endsWith("[") ? "[" : "{", close = open === "[" ? "]" : "}";
  let depth = 0, j = SRC.indexOf(open, i);
  for (; j < SRC.length; j++) {
    if (SRC[j] === open) depth++;
    else if (SRC[j] === close && --depth === 0) break;
  }
  return SRC.slice(i, j + 1) + (open === "[" ? ";" : "");
}

function load(opts) {
  const o = opts || {};
  const ctx = {
    state: { skin: o.skin || "oros", wallpaper: o.wallpaper || "sand" },
    store: {},
    applied: 0,
    pic: !!o.pic
  };
  ctx.localStorage = { setItem: function (k, v) { ctx.store[k] = v; } };
  ctx.applyWallpaper = function () { ctx.applied++; };
  ctx.wpPic = function () { return ctx.pic ? { bg: "#000" } : null; };
  vm.createContext(ctx);
  vm.runInContext([
    cutBlock("  var SKINS = ["),
    SRC.match(/  var DEFAULT_WALLPAPER = "[a-z]+";/)[0],
    cutBlock("  var WALLPAPERS = ["),
    cutBlock("  function findWallpaper("),
    cutBlock("  function skinWallpaper("),
    cutBlock("  function maybeFollowSkin("),
    "this.SKINS = SKINS; this.WALLPAPERS = WALLPAPERS; this.DEF = DEFAULT_WALLPAPER;",
    "this.skinWallpaper = skinWallpaper; this.maybeFollowSkin = maybeFollowSkin;"
  ].join("\n"), ctx);
  return ctx;
}

// What the person does: pick a skin (setSkinUser order: skin first).
function pickSkin(ctx, id) {
  const was = ctx.state.skin;
  ctx.state.skin = id;
  return ctx.maybeFollowSkin(was, id);
}

test("every skin suggests one existing wallpaper, never Mine or None", () => {
  const c = load();
  const ids = c.WALLPAPERS.map((w) => w.id);
  assert.equal(c.SKINS.length, 16);
  for (const k of c.SKINS) {
    assert.ok(ids.includes(k.wp), k.id + " → " + k.wp);
    assert.notEqual(k.wp, "custom");
    assert.notEqual(k.wp, "clear");
    assert.equal(c.skinWallpaper(k.id), k.wp);
  }
  assert.equal(c.skinWallpaper("oros"), c.DEF, "default skin + default wallpaper agree");
  assert.equal(c.skinWallpaper("nope"), null);
});

test("from the default wallpaper the skin's suggestion is applied", () => {
  const c = load();
  assert.equal(pickSkin(c, "ubuntu"), true);
  assert.equal(c.state.wallpaper, "plum");
  assert.equal(c.store["oros-wallpaper"], "plum");
  assert.equal(c.applied, 1);
});

test("a followed suggestion keeps following (the old rule stopped after one step)", () => {
  const c = load();
  pickSkin(c, "ubuntu");
  pickSkin(c, "mint");
  assert.equal(c.state.wallpaper, "forest");
  pickSkin(c, "gentoo");
  assert.equal(c.state.wallpaper, "obsidian");
  pickSkin(c, "oros");
  assert.equal(c.state.wallpaper, "sand");
});

test("a wallpaper the user picked stays theirs", () => {
  for (const wp of ["nebula", "custom", "clear", "terrazzo"]) {
    const c = load({ skin: "ubuntu", wallpaper: wp });
    assert.equal(pickSkin(c, "mint"), false, wp);
    assert.equal(c.state.wallpaper, wp);
    assert.equal(c.applied, 0);
    assert.equal(c.store["oros-wallpaper"], undefined);
  }
});

test("a device picture is never replaced", () => {
  const c = load({ pic: true });
  assert.equal(pickSkin(c, "ubuntu"), false);
  assert.equal(c.state.wallpaper, "sand");
});

test("two skins with the same suggestion change nothing", () => {
  const c = load({ skin: "debian", wallpaper: "ember" });
  assert.equal(pickSkin(c, "popos"), false);
  assert.equal(c.state.wallpaper, "ember");
  assert.equal(c.applied, 0);
});
