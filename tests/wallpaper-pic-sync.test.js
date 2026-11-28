// WPPIC-1: your own picture as wallpaper syncs (Chris 2026-11-28,
// proposal 7 of the sync check): the file goes to the orOS disk
// (Vault Drive, up to 20 MB), the choice travels in the shell slice as
// `wppic`, and another device shows it once the file has arrived.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const SHELL = fs.readFileSync(path.join(__dirname, "..", "shell.js"), "utf8");

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
const line = (re) => { const m = SHELL.match(re); if (!m) throw new Error("missing " + re); return m[0]; };

function device() {
  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const env = { fetched: 0, cleared: [] };
  const src = [
    line(/var WP_PIC_KEY = [^;]+;/),
    line(/var WP_PIC_WAIT_KEY = [^;]+;/),
    line(/var WP_PIC_PATH_RE = [^;]+;/),
    "function wpPic() { try { var p = JSON.parse(localStorage.getItem(WP_PIC_KEY)); return (p && typeof p.at === 'number' && /^#[0-9a-f]{6}$/i.test(p.bg)) ? p : null; } catch (e) { return null; } }",
    "function wpPicClear(pulled) { ENV.cleared.push(!!pulled); localStorage.removeItem(WP_PIC_KEY); localStorage.removeItem(WP_PIC_WAIT_KEY); }",
    "function wppicFetch() { ENV.fetched++; }",
    ...["wppicCanon", "wppicWait", "wppicNow", "wppicPulled", "wpPicOn"].map((n) => cut(SHELL, n)),
    "return { wppicCanon, wppicNow, wppicPulled, wpPicOn };",
  ].join("\n");
  const api = new Function("localStorage", "ENV", src)(localStorage, env);
  api.ls = localStorage;
  api.env = env;
  return api;
}

const P = "/internal/Pictures/My wallpaper/wallpaper-1795872896940.png";

test("WPPIC-1: only our own picture file, a real colour and time pass", () => {
  const d = device();
  assert.deepEqual(d.wppicCanon({ at: 1795872896940, bg: "#112233", path: P, x: 1 }), { at: 1795872896940, bg: "#112233", path: P });
  assert.equal(d.wppicCanon(null), null);
  for (const bad of [
    { at: 1795872896940, bg: "#112233", path: "/internal/Documents/secret.png" },
    { at: 1795872896940, bg: "#112233", path: "/internal/Pictures/My wallpaper/../x.png" },
    { at: 1795872896940, bg: "#112233", path: "/internal/Pictures/My wallpaper/wallpaper-1.svg" },
    { at: 1.5, bg: "#112233", path: P }, { at: 1795872896940, bg: "red", path: P }, "x", [], undefined,
  ]) assert.equal(d.wppicCanon(bad), undefined, JSON.stringify(bad));
});

test("WPPIC-1: a pulled picture waits for its file; the choice is what the slice reports meanwhile", () => {
  const d = device();
  const v = { at: 1795872896940, bg: "#112233", path: P };
  d.wppicPulled(v);
  assert.equal(d.env.fetched, 1);
  assert.deepEqual(d.wppicNow(), v, "the slice carries the choice before the file is here (no flip back)");
  assert.ok(d.wpPicOn(), "a picture on its way counts as on");
  // the same picture again: nothing to fetch
  d.ls.setItem("oros-wallpaper-pic", JSON.stringify(v));
  d.ls.removeItem("oros-wallpaper-pic-wait");
  d.wppicPulled(v);
  assert.equal(d.env.fetched, 1);
  assert.equal(d.ls.getItem("oros-wallpaper-pic-wait"), null);
  // removed elsewhere: removed here, the file is not deleted from here
  d.wppicPulled(null);
  assert.deepEqual(d.env.cleared, [true]);
  assert.equal(d.wppicNow(), null);
});

test("WPPIC-1: a picture kept on this device only never syncs and is never removed by a pull", () => {
  const d = device();
  d.ls.setItem("oros-wallpaper-pic", JSON.stringify({ at: 5, bg: "#000000" }));     // before WPPIC-1 / disk full
  assert.equal(d.wppicNow(), null);
  d.wppicPulled(null);
  assert.deepEqual(d.env.cleared, [], "a local-only picture is not the synced one");
});

test("WPPIC-1: From a folder (this device only) keeps the synced choice beside it", () => {
  const d = device();
  const v = { at: 1795872896940, bg: "#112233", path: P };
  d.ls.setItem("oros-wallpaper-pic", JSON.stringify({ at: 9, bg: "#000000", local: 1, keep: v }));
  assert.deepEqual(d.wppicNow(), v, "the folder's picture does not replace the choice of the other devices");
  const w = { at: 1795872899999, bg: "#445566", path: "/internal/Pictures/My wallpaper/wallpaper-1795872899999.jpg" };
  d.wppicPulled(w);
  assert.equal(d.env.fetched, 0, "the folder's picture stays on screen");
  assert.deepEqual(JSON.parse(d.ls.getItem("oros-wallpaper-pic")).keep, w);
  d.wppicPulled(null);
  assert.equal(JSON.parse(d.ls.getItem("oros-wallpaper-pic")).keep, undefined);
});

test("WPPIC-1: wiring: shell field, disk copy, Vault Drive hook, a hand pick ends it, folder stays local", () => {
  assert.match(SHELL, /var SHELL_FIELDS = \[[^\]]*"wppic"\]/);
  assert.match(SHELL, /var WP_PIC_DIR = "\/internal\/Pictures\/My wallpaper";/);
  assert.match(SHELL, /case "wppic":\s+return wppicCanon\(v\);/);
  assert.match(SHELL, /wppic: wppicNow\(\)/);
  assert.match(SHELL, /if \(data\.wppic !== undefined && wppicCanon\(data\.wppic\) !== undefined\) wppicPulled\(wppicCanon\(data\.wppic\)\);/);
  assert.match(SHELL, /window\.orosFS\.write\(path, own\)/);
  assert.match(SHELL, /orosVault\.onStatus\(function \(k\) \{ if \(k === "done" \|\| k === "fetched"\) wppicFetch\(\); \}\)/);
  assert.match(SHELL, /if \(wpPicOn\(\)\) \{\s+\/\/ the picture gives way to the pick/);
  assert.match(SHELL, /max: WP_PIC_MAX \}, true\)/, "From a folder stays on this device");
  assert.match(SHELL, /WP_PIC_MAX = 20 \* 1024 \* 1024/);
});
