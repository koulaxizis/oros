// Default apps (DEF-APPS D1): Settings › Default apps, the synced
// shell field "fopen" and Files opening a type in its chosen app.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const SHELL = read("shell.js");
const FO = require("../fileopen.js");
const C = require("../settings/core.js");

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

const fopenCanon = new Function(cut(SHELL, "fopenCanon") + "\nreturn fopenCanon;")();

test("fileopen: groups() = the shared types, one row per set of apps", () => {
  const g = FO.groups();
  const exts = [].concat(...g.map((x) => x.exts)).sort();
  assert.deepEqual(exts, FO.shared().slice().sort());
  g.forEach((row) => {
    assert.ok(row.apps.length > 1);
    row.exts.forEach((x) => assert.deepEqual(FO.appsFor(x), row.apps, x));
  });
  const md = g.find((x) => x.exts.indexOf(".md") !== -1);
  assert.deepEqual(md.exts, [".md", ".markdown"]);
});

test("shell: fopen is canonical by shape only (R26)", () => {
  assert.deepEqual(fopenCanon({ ".txt": "pad", ".csv": "ask", ".md": "notes" }), { ".csv": "ask", ".md": "notes", ".txt": "pad" });
  // the same string on every device, whatever its app list
  assert.equal(JSON.stringify(fopenCanon({ ".zzz": "newapp", ".txt": "pad" })), '{".txt":"pad",".zzz":"newapp"}');
  assert.deepEqual(fopenCanon({ txt: "pad", ".TXT": "pad", ".a": 3, ".b": "<x>", ".c": "Ask" }), {});
  [null, undefined, "x", 3, []].forEach((v) => assert.equal(fopenCanon(v), undefined, String(v)));
  const big = {};
  for (let i = 0; i < 400; i++) big[".x" + i] = "pad";
  assert.equal(Object.keys(fopenCanon(big)).length, 300);
  const once = fopenCanon({ ".txt": "pad", ".csv": "spreadsheet" });
  assert.deepEqual(fopenCanon(once), once);
});

test("shell: fopen is a synced field, read from fileopen's key, pulled without a push", () => {
  assert.match(SHELL, /var SHELL_FIELDS = \[[^\]]*"fopen"[^\]]*\];/);
  assert.match(cut(SHELL, "shellDefault"), /case "fopen":\s+return \{\};/);
  assert.match(cut(SHELL, "shellCanon"), /case "fopen":\s+return fopenCanon\(v\);/);
  assert.match(cut(SHELL, "shellNow"), /fopen: fopenRead\(\)/);
  assert.match(cut(SHELL, "shellBuild"), /fopen:\s+vals\.fopen/);
  assert.match(SHELL, /var FOPEN_KEY = "oros-file-open";/);
  assert.equal(FO.PREF_KEY, "oros-file-open");
  const set = cut(SHELL, "shellSliceSet");
  const at = set.indexOf("fopenCanon(data.fopen)");
  assert.ok(at > 0);
  assert.doesNotMatch(set.slice(at, at + 200), /noteLocalChange|markDirty/);
  // a choice made on this device is a local change
  assert.match(cut(SHELL, "registerShellSlice"), /window\.orosFileOpen\.onChange\(noteLocalChange\)/);
});

test("fileopen: a saved choice tells the shell, Reset all clears every type", () => {
  const src = read("fileopen.js");
  assert.match(cut(src, "savePrefs"), /changeFns\.forEach/);
  assert.match(src, /resetAll: function \(\) \{ savePrefs\(normPrefs\(null\)\); \}/);
  assert.match(src, /setChoices: function \(exts, value\)/);
});

test("settings: Default apps first, scope All devices, Reset all", () => {
  const ss = read("settings/settings.js");
  const sec = cut(ss, "secFiles");
  assert.ok(sec.indexOf('card(t("f.choose"), "fopen")') < sec.indexOf('card(t("f.apps"))'));
  assert.ok(sec.indexOf('card(t("f.apps"))') < sec.lastIndexOf('card(t("f.status"), "files")'));
  assert.match(sec, /F\.setChoices\(g\.exts, v\)/);
  assert.match(sec, /button\(t\("f\.reset"\), "f\.reset"/);
  assert.equal(C.scopeOf("fopen"), "all");
  ["en", "el"].forEach((l) => {
    assert.ok(C.STRINGS[l]["f.reset"], l);
    assert.ok(C.STRINGS[l]["w.default-apps"], l);
  });
  assert.equal(C.STRINGS.en["s.files"], "Default apps");
  assert.equal(C.STRINGS.el["s.files"], "Προεπιλεγμένες εφαρμογές");
  assert.ok(C.FIND.some((f) => f[0] === "default-apps" && f[1] === "files" && f[2] === "f.choose"));
});

test("files: a type with a chosen app opens there, not in the preview", () => {
  const src = read("files/files.js");
  const fn = new Function("deps",
    "var fileOpenApi = deps.api, appsForFile = deps.apps, isTextExt = deps.isText, isImageExt = deps.isImage, CORE = { extOf: function (n) { return n.split('.').pop(); } };\n" +
    cut(src, "chosenApp") + "\n" + cut(src, "opensInApp") + "\nreturn opensInApp;");
  const prefs = { ".txt": "pad", ".md": "ask" };
  const deps = {
    api: () => ({ choice: (x) => prefs[x] || "" }),
    apps: (n) => (/\.(txt|md)$/.test(n) ? ["writer", "pad"] : /\.docx$/.test(n) ? ["writer"] : []),
    isText: (n) => /\.(txt|md)$/.test(n),
    isImage: () => false
  };
  const opens = fn(deps);
  assert.equal(opens("a.txt"), true);        // Pad chosen
  assert.equal(opens("a.md"), false);        // "ask": preview as before
  assert.equal(opens("a.docx"), true);       // as before
  assert.equal(opens("a.zip"), false);
  // an older shell without choice(): the preview as before
  assert.equal(fn(Object.assign({}, deps, { api: () => ({}) }))("a.txt"), false);
});
