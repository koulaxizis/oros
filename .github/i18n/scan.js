// orOS i18n scanner: finds the inline { en: {…}, el: {…} } string
// tables, reads the language packs in i18n/<code>/ and measures how much
// of each app a pack language covers. Shared by tests/i18n.test.js and
// the translator scripts (coverage.js, new-language.js). Plain Node, no
// dependencies, never part of the app.

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");

// Data files whose tables are not UI strings (word lists, OSM presets).
const SKIP = /(^|\/)(words[\w-]*\.js|presets-data\.js|wordlist[\w-]*\.js)$|\/(vendor|lib|tests|android|extension|relay|node_modules|i18n)\//;

function jsFiles() {
  const out = [];
  (function walk(dir) {
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith(".")) continue;
      const p = path.join(dir, f), rel = path.relative(ROOT, p);
      if (fs.statSync(p).isDirectory()) { if (!SKIP.test("/" + rel + "/")) walk(p); continue; }
      if (/\.js$/.test(f) && !SKIP.test("/" + rel)) out.push(rel);
    }
  })(ROOT);
  return out;
}

const T = require("../../i18n-tables.js");
const { skipToken, blockEnd, unquote, entries, line, GREEK, sentence } = T;
const tables = (rel) => T.tablesIn(fs.readFileSync(path.join(ROOT, rel), "utf8"), rel);

// ---- Languages (the LANGS block of i18n.js) ----
function langs() {
  const s = fs.readFileSync(path.join(ROOT, "i18n.js"), "utf8");
  const block = /var LANGS = \[([\s\S]*?)\n  \];/.exec(s);
  if (!block) throw new Error("i18n.js: LANGS block not found");
  const out = [];
  const re = /\{\s*code:\s*"([^"]+)",\s*name:\s*"([^"]+)",\s*locale:\s*"([^"]+)",\s*dir:\s*"(ltr|rtl)",\s*status:\s*"(full|partial|hidden)"\s*\}/g;
  let m;
  while ((m = re.exec(block[1]))) out.push({ code: m[1], name: m[2], locale: m[3], dir: m[4], status: m[5] });
  return out;
}

// ---- Apps and their English tables ----
// A pack is named after the app that loads it (data-app on its i18n.js
// tag): "shell" is translations.js, any other name is an app folder (its
// keys are every English key of the tables in that folder) or a shared
// module at the root, <name>.js, that pages using it list in data-app.
const ALL_FILES = () => jsFiles().map((rel) => ({ rel, tables: tables(rel) }));

const owns = (app, rel) => app === "shell" ? rel === "translations.js" : rel.startsWith(app + "/") || rel === app + ".js";

function appKeys(app, all) {
  const keys = new Map();
  for (const f of all || ALL_FILES()) {
    if (!owns(app, f.rel)) continue;
    for (const t of f.tables) for (const [k, v] of t.en) if (!keys.has(k)) keys.set(k, v);
  }
  return keys;
}

// Apps whose index.html loads i18n.js, with the pack name they ask for.
function packApps() {
  const out = [];
  const pages = [["shell", "index.html"]];
  for (const d of fs.readdirSync(ROOT)) {
    if (fs.existsSync(path.join(ROOT, d, "index.html"))) pages.push([d, path.join(d, "index.html")]);
  }
  for (const [dir, page] of pages) {
    const s = fs.readFileSync(path.join(ROOT, page), "utf8");
    const m = /<script src="(?:\.\.\/)?i18n\.js[^"]*" data-app="([^"]+)"><\/script>/.exec(s);
    if (m) out.push({ dir, page, apps: m[1].split(",").map((a) => a.trim()) });
  }
  return out;
}

// ---- Packs ----
const PACK_RE = /^orosPack\("([a-z]{2,3}(?:-[A-Z]{2})?)", "([a-z0-9][a-z0-9-]{0,40})", (\{[\s\S]*\})\);\s*$/;
const placeholders = (s) => (String(s).match(/\{[A-Za-z0-9_.]+\}/g) || []).sort().join("|");
const tagsOf = (s) => (String(s).match(/<\/?[A-Za-z][^>]*>/g) || []).sort().join("|");

// One pack file → { code, app, table } or { error }.
function readPack(rel, text) {
  const s = text !== undefined ? text : fs.readFileSync(path.join(ROOT, rel), "utf8");
  const m = PACK_RE.exec(s.replace(/^﻿/, ""));
  if (!m) return { error: rel + ': must be exactly orosPack("<code>", "<app>", { … }); and nothing else' };
  let table;
  try { table = JSON.parse(m[3]); } catch (e) { return { error: rel + ": the { … } part is not valid JSON (" + e.message + ")" }; }
  if (!table || typeof table !== "object" || Array.isArray(table)) return { error: rel + ": not an object" };
  for (const [k, v] of Object.entries(table)) {
    if (typeof v !== "string") return { error: rel + ": " + k + " is not a string" };
  }
  const base = path.basename(rel, ".js"), code = rel.split("/")[1];
  if (m[1] !== code || m[2] !== base) return { error: rel + ': must say orosPack("' + code + '", "' + base + '", …)' };
  return { code, app: base, table };
}

// Problems in one pack against the app's English keys.
function checkPack(p, enKeys) {
  const bad = [];
  if (!enKeys.size) { bad.push(p.code + "/" + p.app + ": no app with this name has strings"); return bad; }
  for (const [k, v] of Object.entries(p.table)) {
    if (!enKeys.has(k)) { bad.push(p.code + "/" + p.app + ": unknown key " + k); continue; }
    const en = enKeys.get(k);
    if (en === null) continue;   // computed English value: nothing to compare
    if (!v.trim()) bad.push(p.code + "/" + p.app + ": " + k + " is empty");
    if (placeholders(en) !== placeholders(v)) bad.push(p.code + "/" + p.app + ": " + k + " must keep the placeholders " + (placeholders(en) || "(none)"));
    if (tagsOf(en) !== tagsOf(v)) bad.push(p.code + "/" + p.app + ": " + k + " must keep the same HTML tags as English");
    if (v === en && sentence(v)) bad.push(p.code + "/" + p.app + ": " + k + " is still the English sentence");
  }
  return bad;
}

// Every file of a pack language folder, relative to it.
function packFiles(code) {
  const dir = path.join(ROOT, "i18n", code), out = [];
  if (!fs.existsSync(dir)) return out;
  (function walk(d) {
    for (const f of fs.readdirSync(d).sort()) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else out.push(path.relative(dir, p).split(path.sep).join("/"));
    }
  })(dir);
  return out;
}

// The help pages a translator can write: <app>/help.en.txt → help/<app>.txt,
// help/topics/<id>.en.txt → help/topics/<id>.txt.
function helpPages() {
  const out = [];
  for (const d of fs.readdirSync(ROOT).sort()) {
    if (fs.existsSync(path.join(ROOT, d, "help.en.txt"))) out.push({ pack: "help/" + d + ".txt", en: d + "/help.en.txt" });
  }
  for (const f of fs.readdirSync(path.join(ROOT, "help/topics")).sort()) {
    // What's new is the release log, rewritten every release: it stays
    // English for pack languages (Help shows the English page).
    if (f.endsWith(".en.txt") && f !== "whatsnew.en.txt") out.push({ pack: "help/topics/" + f.slice(0, -7) + ".txt", en: "help/topics/" + f });
  }
  return out;
}

// The apps a translator can work on (i18n/apps.json, read by Settings ›
// Help translate): every pack name a page loads, with the files that hold
// its English and Greek tables.
function packIndex(all) {
  const names = ["shell"];
  for (const p of packApps()) for (const a of p.apps) if (!names.includes(a)) names.push(a);
  const out = [];
  for (const app of names.sort()) {
    const files = (all || ALL_FILES()).filter((f) => f.tables.length &&
      owns(app, f.rel)).map((f) => f.rel).sort();
    if (files.length) out.push({ app, files });
  }
  return { apps: out };
}

// Lines a translator should look at, per language. Not errors for the
// app (orOS shows English for any line that does not fit), so tests only
// print them and STATUS.md lists them: an English text that changed its
// {placeholders} or tags, a key that is gone, a help page whose links
// differ from the English one.
function helpMarks(s) {
  return [...new Set((s.match(/\]\((?:app|topic|help|tour|https?):[^)]+\)|\[\[[^\]]+\]\]/g) || []).map((m) => m.replace(/^\]/, "")))].sort().join(" ");
}
function packIssues(code, all) {
  const out = [];
  for (const f of packFiles(code)) {
    if (!/^[a-z0-9][a-z0-9-]*\.js$/.test(f)) continue;
    const p = readPack("i18n/" + code + "/" + f);
    if (!p.error) out.push(...checkPack(p, appKeys(p.app, all)));
  }
  const files = new Set(packFiles(code));
  for (const h of helpPages()) {
    if (!files.has(h.pack)) continue;
    const en = fs.readFileSync(path.join(ROOT, h.en), "utf8");
    const tr = fs.readFileSync(path.join(ROOT, "i18n", code, h.pack), "utf8");
    if (helpMarks(en) !== helpMarks(tr)) out.push(code + "/" + h.pack + ": links or key caps differ from " + h.en);
  }
  return out;
}

// What the shell downloads for offline use (manifest.json).
function manifest(code) {
  return { code, files: packFiles(code).filter((f) => f !== "manifest.json" && f !== "STATUS.md") };
}

// ---- Inline Greek: text written in code, outside the en/el tables ----
// A pack language cannot translate it (it shows English there), so each
// wave turns it into table keys. A file may opt out with a comment
// "i18n-inline-ok: <reason>" (Greek data: name days, holidays, parsers).
function inlineGreek(rel, tbls) {
  const s = fs.readFileSync(path.join(ROOT, rel), "utf8");
  if (/i18n-inline-ok:/.test(s)) return 0;
  const ranges = (tbls || tables(rel)).filter((t) => t.range).map((t) => t.range);
  let n = 0;
  for (let i = 0; i < s.length;) {
    const k = skipToken(s, i);
    if (k === i) { i++; continue; }
    const c = s[i];
    if ((c === '"' || c === "'" || c === "`") && GREEK.test(s.slice(i, k)) &&
        !ranges.some((r) => i >= r[0] && i < r[1]) &&
        !/\.el\[\s*["'][^"']+["']\s*\]\s*=\s*$/.test(s.slice(Math.max(0, i - 120), i))) n++;
    i = k;
  }
  return n;
}

module.exports = {
  ROOT, SKIP, jsFiles, skipToken, blockEnd, entries, tables, sentence, GREEK, line, unquote,
  langs, owns, appKeys, packApps, packIndex, readPack, checkPack, packIssues, packFiles, helpPages, manifest, inlineGreek,
  placeholders, tags: tagsOf, ALL_FILES
};
