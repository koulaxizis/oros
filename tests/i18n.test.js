// Greek coverage guard: orOS ships in English and Greek, and some users
// read no English at all, so every string an app shows must exist in
// both languages.
//   - every { en: {…}, el: {…} } string table (shell, apps) has every
//     English key in Greek too (a missing key falls back to English)
//   - the same holds for keys added later with X.en["k"] = … / X.el["k"] = …
//   - a Greek value is never a plain copy of an English sentence
//   - every help.en.txt has a help.el.txt (see help.test.js for parity)
// The scanner is a small tokenizer (strings, template literals,
// comments), no dependencies. Word lists and preset data are skipped.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

// Data files whose tables are not UI strings (word lists, OSM presets).
const SKIP = /(^|\/)(words[\w-]*\.js|presets-data\.js|wordlist[\w-]*\.js)$|\/(vendor|lib|tests|android|extension|relay|node_modules)\//;

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
    out.push({ at: rel + ":" + line(s, open), en: entries(s, open, enEnd), el: entries(s, elOpen, elEnd) });
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

const ALL = jsFiles().map((rel) => ({ rel, tables: tables(rel) }));

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
