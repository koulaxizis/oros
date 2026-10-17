// Greek coverage guard: orOS ships in English and Greek, and some users
// read no English at all, so every string an app shows must exist in
// both languages.
//   - every { en: {…}, el: {…} } string table (shell, apps) has every
//     English key in Greek too (a missing key falls back to English)
//   - the same holds for keys added later with X.en["k"] = … / X.el["k"] = …
//   - a Greek value is never a plain copy of an English sentence
//   - every help.en.txt has a help.el.txt (see help.test.js for parity)
// Languages beyond English and Greek (i18n.js, i18n/<code>/ packs):
//   - a pack is data only (orosPack("<code>", "<app>", {JSON strings}))
//   - it names a real app and only that app's English keys
//   - every value keeps the English {placeholders} and HTML tags
//   - manifest.json lists the language's files (offline download)
//   - no NEW file writes Greek text in code outside the en/el tables
//     (.github/i18n/inline-baseline.json holds today's files)
// The scanner (.github/i18n/scan.js) is a small tokenizer (strings,
// template literals, comments), no dependencies. Word lists and preset
// data are skipped.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const S = require("../.github/i18n/scan.js");
const { ROOT, jsFiles, tables, sentence } = S;

const ALL = S.ALL_FILES();

test("scanner finds the string tables", () => {
  const n = ALL.reduce((a, f) => a + f.tables.length, 0);
  assert.ok(n > 150, "expected many en/el tables, found " + n);
  const shell = ALL.find((f) => f.rel === "translations.js");
  assert.ok(shell && shell.tables.some((t) => t.en.size > 200), "translations.js table");
});

test("every English key has a Greek string", () => {
  const missing = [];
  for (const f of ALL) for (const t of f.tables) {
    const miss = [...t.en.keys()].filter((k) => !t.el.has(k));
    if (miss.length) missing.push(t.at + " → " + miss.join(", "));
  }
  assert.deepEqual(missing, [], "Greek strings missing:\n" + missing.join("\n"));
});

test("no Greek string is a copy of an English sentence", () => {
  const copies = [];
  for (const f of ALL) for (const t of f.tables) {
    for (const [k, v] of t.el) {
      if (v !== null && v === t.en.get(k) && sentence(v)) copies.push(t.at + " " + k + ": " + JSON.stringify(v).slice(0, 80));
    }
  }
  assert.deepEqual(copies, [], "Greek strings still in English:\n" + copies.join("\n"));
});

test("every app page and help topic has a Greek page", () => {
  const missing = [];
  const pages = [];
  for (const d of fs.readdirSync(ROOT)) {
    const p = path.join(ROOT, d, "help.en.txt");
    if (fs.existsSync(p)) pages.push(path.join(d, "help"));
  }
  for (const f of fs.readdirSync(path.join(ROOT, "help/topics"))) {
    if (f.endsWith(".en.txt")) pages.push(path.join("help/topics", f.slice(0, -7)));
  }
  for (const p of pages) {
    const el = path.join(ROOT, p + ".el.txt");
    if (!fs.existsSync(el)) { missing.push(p + ".el.txt"); continue; }
    const s = fs.readFileSync(el, "utf8");
    const gr = (s.match(/[\u0370-\u03ff]/g) || []).length, la = (s.match(/[A-Za-z]/g) || []).length;
    if (gr < la) missing.push(p + ".el.txt is mostly Latin text");
  }
  assert.deepEqual(missing, []);
});

// ---- Pack languages ----

const LANGS = S.langs();
const PACK_LANGS = LANGS.filter((l) => l.code !== "en" && l.code !== "el");

test("i18n.js lists English and Greek first, every code once", () => {
  assert.deepEqual(LANGS.slice(0, 2).map((l) => l.code), ["en", "el"]);
  const codes = LANGS.map((l) => l.code);
  assert.equal(new Set(codes).size, codes.length);
  for (const d of fs.readdirSync(path.join(ROOT, "i18n"))) {
    if (fs.statSync(path.join(ROOT, "i18n", d)).isDirectory()) {
      assert.ok(codes.includes(d), "i18n/" + d + "/ is not in the LANGS list of i18n.js");
    }
  }
});

test("every pack is plain data for a real app, with fitting values", () => {
  const bad = [];
  for (const l of PACK_LANGS) {
    for (const f of S.packFiles(l.code)) {
      const rel = "i18n/" + l.code + "/" + f;
      if (f === "manifest.json" || f === "STATUS.md") continue;
      if (/^help\/(topics\/)?[a-z0-9-]+\.txt$/.test(f)) continue;
      if (!/^[a-z0-9][a-z0-9-]*\.js$/.test(f)) { bad.push(rel + ": not a pack (<app>.js) or help page (help/<app>.txt)"); continue; }
      const p = S.readPack(rel);
      if (p.error) { bad.push(p.error); continue; }
      bad.push(...S.checkPack(p, S.appKeys(p.app, ALL)));
    }
  }
  assert.deepEqual(bad, [], "Language pack problems:\n" + bad.join("\n"));
});

test("every translated help page belongs to an English one", () => {
  const known = new Set(S.helpPages().map((h) => h.pack));
  const bad = [];
  for (const l of PACK_LANGS) {
    for (const f of S.packFiles(l.code)) {
      if (f.startsWith("help/") && !known.has(f)) bad.push("i18n/" + l.code + "/" + f + ": no English page for it");
    }
  }
  assert.deepEqual(bad, []);
});

test("each language's manifest.json lists its files", () => {
  for (const l of PACK_LANGS) {
    const p = path.join(ROOT, "i18n", l.code, "manifest.json");
    assert.ok(fs.existsSync(p), "i18n/" + l.code + "/manifest.json missing: run node .github/i18n/coverage.js");
    assert.deepEqual(JSON.parse(fs.readFileSync(p, "utf8")), S.manifest(l.code),
      "i18n/" + l.code + "/manifest.json is out of date: run node .github/i18n/coverage.js");
  }
});

test("i18n/apps.json lists the apps a translator can work on", () => {
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(ROOT, "i18n/apps.json"), "utf8")), S.packIndex(ALL),
    "i18n/apps.json is out of date: run node .github/i18n/coverage.js");
});

test("pages that load i18n.js name a real app, before their own scripts", () => {
  const bad = [];
  for (const p of S.packApps()) {
    const s = fs.readFileSync(path.join(ROOT, p.page), "utf8");
    for (const a of p.apps) if (!S.appKeys(a, ALL).size) bad.push(p.page + ': data-app="' + a + '" has no strings');
    const i = s.indexOf("i18n.js");
    const first = /<script src="(?!(?:\.\.\/)?i18n\.js)[^"]+"/.exec(s);
    if (first && first.index < i) bad.push(p.page + ": i18n.js must come before " + first[0]);
  }
  assert.deepEqual(bad, []);
});

test("no new file writes Greek text in code outside the en/el tables", () => {
  const base = JSON.parse(fs.readFileSync(path.join(ROOT, ".github/i18n/inline-baseline.json"), "utf8"));
  const bad = [], grew = [];
  for (const f of ALL) {
    const n = S.inlineGreek(f.rel, f.tables);
    if (!n) continue;
    if (base[f.rel] === undefined) bad.push(f.rel + ": " + n);
    else if (n > base[f.rel]) grew.push(f.rel + ": " + base[f.rel] + " → " + n);
  }
  // Existing files may still grow during the first waves; listed so the
  // owner can move the text into the file's en/el table.
  if (grew.length) console.log("# inline Greek grew (move it into the en/el table):\n# " + grew.join("\n# "));
  assert.deepEqual(bad, [], "Greek text written in code, outside the en/el tables (a pack language cannot translate it). " +
    "Put it in the file's { en, el } table and use t(key); Greek data (name days, parsers) may say // i18n-inline-ok: <reason>\n" + bad.join("\n"));
});


test("one key means one text within a pack app", () => {
  // A pack has one value per key for the whole app: two files of the same
  // app may not use one key for different English texts.
  const bad = [];
  for (const { app, files } of S.packIndex(ALL).apps) {
    const seen = new Map();
    for (const f of ALL.filter((x) => files.includes(x.rel))) {
      for (const t of f.tables) for (const [k, v] of t.en) {
        const was = seen.get(k);
        if (was && was.v !== null && v !== null && was.v !== v && was.rel !== f.rel) bad.push(app + ": " + k + " is \"" + was.v + "\" in " + was.rel + " but \"" + v + "\" in " + f.rel);
        else if (!was) seen.set(k, { v, rel: f.rel });
      }
    }
  }
  assert.deepEqual(bad, [], "Rename one of the keys:\n" + bad.join("\n"));
});

test("a shown language has the shell, Settings and Help translated", () => {
  // status "partial" or "full" puts a language in the pickers; before
  // that it stays "hidden" (?lang=<code> only).
  const bad = [];
  const topics = S.helpPages().filter((h) => h.pack.startsWith("help/topics/")).map((h) => h.pack);
  for (const l of PACK_LANGS.filter((x) => x.status !== "hidden")) {
    const files = new Set(S.packFiles(l.code));
    for (const app of ["shell", "settings", "help"]) {
      const p = files.has(app + ".js") ? S.readPack("i18n/" + l.code + "/" + app + ".js") : { table: {} };
      const en = S.appKeys(app, ALL);
      const missing = [...en.keys()].filter((k) => typeof p.table[k] !== "string" || !p.table[k].trim());
      if (missing.length) bad.push(l.code + "/" + app + ": " + missing.length + " strings missing, e.g. " + missing.slice(0, 3).join(", "));
    }
    for (const t of topics) if (!files.has(t)) bad.push(l.code + ": " + t + " missing");
  }
  assert.deepEqual(bad, [], "Translate these before the language is shown (or keep status \"hidden\"):\n" + bad.join("\n"));
});

test("translated help pages keep the English links and shortcuts", () => {
  const marks = (s) => [...new Set((s.match(/\]\((?:app|topic|help|tour|https?):[^)]+\)|\[\[[^\]]+\]\]/g) || []).map((m) => m.replace(/^\]/, "")))].sort().join(" ");
  const bad = [];
  for (const l of PACK_LANGS) {
    const files = new Set(S.packFiles(l.code));
    for (const h of S.helpPages()) {
      if (!files.has(h.pack)) continue;
      const en = fs.readFileSync(path.join(ROOT, h.en), "utf8");
      const tr = fs.readFileSync(path.join(ROOT, "i18n", l.code, h.pack), "utf8");
      if (marks(en) !== marks(tr)) bad.push("i18n/" + l.code + "/" + h.pack + ": links/shortcuts differ from " + h.en);
    }
  }
  assert.deepEqual(bad, []);
});
