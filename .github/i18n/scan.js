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

// Index just past the literal / comment that starts at i, or i itself.
function skipToken(s, i) {
  const c = s[i];
  if (c === '"' || c === "'" || c === "`") {
    for (let j = i + 1; j < s.length; j++) {
      if (s[j] === "\\") { j++; continue; }
      if (s[j] === c) return j + 1;
    }
    return s.length;
  }
  if (c === "/" && s[i + 1] === "/") { const j = s.indexOf("\n", i); return j < 0 ? s.length : j; }
  if (c === "/" && s[i + 1] === "*") { const j = s.indexOf("*/", i + 2); return j < 0 ? s.length : j + 2; }
  return i;
}

// The balanced { … } block starting at the brace at index i: [i, end).
function blockEnd(s, i) {
  let depth = 0;
  for (let j = i; j < s.length;) {
    const k = skipToken(s, j);
    if (k !== j) { j = k; continue; }
    if (s[j] === "{") depth++;
    else if (s[j] === "}") { depth--; if (depth === 0) return j + 1; }
    j++;
  }
  return -1;
}

const unquote = (lit) => {
  try { return lit[0] === "`" ? lit.slice(1, -1) : JSON.parse(lit[0] === "'" ? '"' + lit.slice(1, -1).replace(/\\'/g, "'").replace(/"/g, '\\"') + '"' : lit); }
  catch (e) { return null; }
};

// Top-level entries of an object literal body: key → string value | null.
function entries(s, from, to) {
  const out = new Map();
  let depth = 0, expectKey = true;
  for (let j = from + 1; j < to - 1;) {
    if (depth === 0 && expectKey) {
      const m = /^\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([A-Za-z_$][\w$]*))\s*:\s*/.exec(s.slice(j, j + 300));
      if (m) {
        const key = m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3];
        j += m[0].length;
        let val = null;
        const q = s[j];
        if (q === '"' || q === "'" || q === "`") {
          const e = skipToken(s, j);
          const after = /^\s*([,}]|$)/.exec(s.slice(e, e + 50));
          if (after && !(q === "`" && s.slice(j, e).includes("${"))) val = unquote(s.slice(j, e));
        }
        out.set(key, val);
        expectKey = false;
        continue;
      }
    }
    const k = skipToken(s, j);
    if (k !== j) { j = k; continue; }
    const c = s[j];
    if (c === "{" || c === "[" || c === "(") depth++;
    else if (c === "}" || c === "]" || c === ")") depth--;
    else if (c === "," && depth === 0) expectKey = true;
    j++;
  }
  return out;
}

const line = (s, i) => s.slice(0, i).split("\n").length;
const GREEK = /[\u0370-\u03ff\u1f00-\u1fff]/;
// An English sentence: three or more lowercase words, no Greek letter.
const sentence = (v) => typeof v === "string" && !GREEK.test(v) &&
  (v.replace(/\{[^}]*\}|https?:\/\/\S+/g, " ").match(/(^|\s)[a-z]{2,}(?=[\s,.;:!?…]|$)/g) || []).length >= 3;

function tables(rel) {
  const s = fs.readFileSync(path.join(ROOT, rel), "utf8");
  const out = [];
  const re = /(^|[\s{,(])(?:en|"en"|'en')\s*:\s*\{/g;
  let m;
  while ((m = re.exec(s))) {
    const open = m.index + m[0].length - 1;
    // An "en" inside a string or comment is not a table: re-check by scanning from the line start.
    const enEnd = blockEnd(s, open);
    if (enEnd < 0) continue;
    const next = /^\s*,\s*(?:\/\/[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*(?:el|"el"|'el')\s*:\s*\{/.exec(s.slice(enEnd, enEnd + 400));
    if (!next) continue;
    const elOpen = enEnd + next[0].length - 1;
    const elEnd = blockEnd(s, elOpen);
    if (elEnd < 0) continue;
    out.push({ at: rel + ":" + line(s, open), en: entries(s, open, enEnd), el: entries(s, elOpen, elEnd), range: [open, elEnd] });
    re.lastIndex = elEnd;
  }
  // Keys added after the table: NAME.en["k"] = … / NAME.el["k"] = …
  const added = {};
  const re2 = /\b([A-Za-z_$][\w$]*)\.(en|el)\[\s*(["'])([^"']+)\3\s*\]\s*=(?!=)/g;
  while ((m = re2.exec(s))) {
    const o = (added[m[1]] = added[m[1]] || { en: new Map(), el: new Map(), at: rel + ":" + line(s, m.index) });
    o[m[2]].set(m[4], null);
  }
  for (const o of Object.values(added)) out.push(o);
  return out;
}


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
// tag): "shell" is translations.js, any other name is an app folder, and
// its keys are every English key of the tables in that folder.
const ALL_FILES = () => jsFiles().map((rel) => ({ rel, tables: tables(rel) }));

function appKeys(app, all) {
  const keys = new Map();
  for (const f of all || ALL_FILES()) {
    const own = app === "shell" ? f.rel === "translations.js" : f.rel.startsWith(app + "/");
    if (!own) continue;
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
    if (f.endsWith(".en.txt")) out.push({ pack: "help/topics/" + f.slice(0, -7) + ".txt", en: "help/topics/" + f });
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
  langs, appKeys, packApps, readPack, checkPack, packFiles, helpPages, manifest, inlineGreek,
  placeholders, tags: tagsOf, ALL_FILES
};
