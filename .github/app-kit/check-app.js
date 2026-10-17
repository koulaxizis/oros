#!/usr/bin/env node
// orOS App Kit: check one app against the orOS app contract
// (docs/app-kit/contract.md) with the same guards CI runs.
//   node .github/app-kit/check-app.js <id> [--no-tests] [--no-browser]
// 1. static checks of the app folder and its registration;
// 2. the release guards (stamp-assets.js in check mode, G2-G5);
// 3. the repo tests that cover every app (help, direct link, Greek
//    coverage, search) and the app's own tests/<id>*.test.js;
// 4. the quality gate in a real browser (.github/qa/smoke.js) for
//    this app only, when Playwright is installed.
// Plain Node 22, nothing to install. Exit code 1 = something to fix.
// The static part is also a module: require(...).checkApp(root, id).
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const DL_RE = /<script>(if \(window\.top === window\.self[^<]*)<\/script>/;
const GOOGLE_RE = /\b(?:[\w-]+\.)*(?:google|googleapis|gstatic|googletagmanager|google-analytics|doubleclick|firebaseio|firebaseapp)\.com\b|\bfirebase\b/i;
// Files that already name a Google host with Chris's approval: one-time
// imports with the user's own sign-in, the Assistant's Gemini option
// with the user's own key, and Mail's list of look-alike domains.
// A new app gets no entry here: orOS has no Google dependencies.
const GOOGLE_APPROVED = new Set([
  "assistant/core.js", "calendar/gcal.js", "contacts/accounts.js", "feeds/youtube.js",
  "files/files.js", "files/gmedia.js", "mail/trust.js", "shelf/gbooks.js", "todo/gtasks.js"
]);
const DANGER = [
  [/\beval\s*\(/, "eval() runs text as code"],
  [/\bnew\s+Function\s*\(/, "new Function() runs text as code"],
  [/\bdocument\.write(?:ln)?\s*\(/, "document.write()"],
  [/\bimportScripts\s*\(\s*["'`](?:https?:)?\/\//, "importScripts() from another site"],
  [/\bimport\s*\(\s*["'`](?:https?:)?\/\//, "import() from another site"],
  [/\b(?:webkit)?SpeechRecognition\b/, "speech recognition sends audio to Google (not allowed)"],
  [/\.src\s*=\s*["'`](?:https?:)?\/\/[^"'`]*\.js\b/, "a script loaded from another site"]
];

function read(root, f) { return fs.readFileSync(path.join(root, f), "utf8"); }
function exists(root, f) { return fs.existsSync(path.join(root, f)); }

function walk(root, dir) {
  const out = [];
  (function go(rel) {
    for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const r = rel + "/" + e.name;
      if (e.isDirectory()) go(r); else out.push(r);
    }
  })(dir);
  return out;
}

// The argument list of every call to name(…), split at top-level commas.
function callArgs(src, name) {
  const out = [];
  const re = new RegExp("\\b" + name + "\\s*\\(", "g");
  let m;
  while ((m = re.exec(src))) {
    let depth = 1, i = re.lastIndex, args = 1, quote = "", any = false;
    for (; i < src.length && depth > 0; i++) {
      const c = src[i];
      if (quote) { if (c === "\\") i++; else if (c === quote) quote = ""; continue; }
      if (c === "/" && src[i + 1] === "/") { const j = src.indexOf("\n", i); i = j < 0 ? src.length : j; continue; }
      if (c === "/" && src[i + 1] === "*") { const j = src.indexOf("*/", i + 2); i = j < 0 ? src.length : j + 1; continue; }
      if (c === '"' || c === "'" || c === "`") { quote = c; any = true; continue; }
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") depth--;
      else if (c === "," && depth === 1) args++;
      else if (!/\s/.test(c)) any = true;
    }
    out.push(any ? args : 0);
  }
  return out;
}

function headings(s) { return s.split(/\r?\n/).filter((l) => /^#{1,3} /.test(l)).map((l) => l.match(/^#+/)[0].length); }

// Returns [{ ok, level: "error"|"warn", rule, msg }].
function checkApp(root, id) {
  const res = [];
  const pass = (rule, msg) => res.push({ ok: true, level: "info", rule, msg });
  const err = (rule, msg) => res.push({ ok: false, level: "error", rule, msg });
  const warn = (rule, msg) => res.push({ ok: false, level: "warn", rule, msg });

  if (!/^[a-z][a-z0-9-]{1,30}$/.test(id) || !exists(root, id + "/index.html")) {
    err("folder", id + "/index.html not found");
    return res;
  }
  const files = walk(root, id);                                   // "id/…"
  const html = read(root, id + "/index.html");
  const scripts = [...html.matchAll(/<script[^>]*\bsrc="([^"#?]+)(?:\?[^"]*)?"/g)].map((m) => m[1]);
  const styles = [...html.matchAll(/<link[^>]*\bhref="([^"#?]+\.css)(?:\?[^"]*)?"/g)].map((m) => m[1]);
  const own = (p) => !/^(?:https?:)?\/\//.test(p) && !p.startsWith("../") && !p.startsWith("/");
  const ownJs = scripts.filter(own).map((p) => id + "/" + p).filter((f) => exists(root, f));
  const js = files.filter((f) => f.endsWith(".js"));
  const codeOf = (f) => { try { return read(root, f); } catch (e) { return ""; } };

  // 1. Registration (Checklist B 2-5)
  let apps = [];
  try { apps = JSON.parse(read(root, "apps.json")).apps || []; } catch (e) { err("apps.json", "apps.json is missing or not valid JSON"); }
  const entry = apps.find((a) => a.id === id);
  const cats = new Set(apps.filter((a) => a !== entry).map((a) => a.category));
  if (!entry) err("apps.json", "no entry with \"id\": \"" + id + "\" in apps.json");
  else {
    if (entry.type !== "internal") err("apps.json", "\"type\" must be \"internal\"");
    if (entry.url !== id + "/") err("apps.json", "\"url\" must be \"" + id + "/\"");
    if (!entry.category) err("apps.json", "\"category\" is empty");
    else if (!cats.has(entry.category)) warn("apps.json", "category \"" + entry.category + "\" is new (Chris decides new categories); existing: " + [...cats].sort().join(", "));
    if (!entry.name) err("apps.json", "\"name\" is empty");
    if (entry.type === "internal" && entry.url === id + "/" && entry.category) pass("apps.json", "registered in " + entry.category);
  }
  const shell = exists(root, "shell.js") ? read(root, "shell.js") : "";
  const icons = (shell.match(/var ICONS = \{([\s\S]*?)\n {2}\};/) || [])[1] || "";
  const iconKey = entry && entry.icon || id;
  if (new RegExp("^\\s*[\"']?" + iconKey.replace(/[-]/g, "\\-") + "[\"']?\\s*:", "m").test(icons)) pass("icon", "ICONS." + iconKey + " in shell.js");
  else err("icon", "no ICONS entry \"" + iconKey + "\" in shell.js");
  const tr = exists(root, "translations.js") ? read(root, "translations.js") : "";
  const names = [...tr.matchAll(new RegExp("\"app\\." + id + "\"\\s*:\\s*\"([^\"]*)\"", "g"))].map((m) => m[1]);
  if (names.length < 2) err("name", "\"app." + id + "\" must be in translations.js twice (en and el), found " + names.length);
  else {
    if (!/[\u0370-\u03ff]/.test(names[1])) warn("name", "the Greek name \"" + names[1] + "\" has no Greek letters (fine only for a brand name)");
    pass("name", names[0] + " / " + names[1]);
  }

  // 2. Offline (G2): the page, its own scripts and styles, help, search
  const sw = exists(root, "sw.js") ? read(root, "sw.js") : "";
  const pc = (sw.match(/PRECACHE_URLS\s*=\s*\[([\s\S]*?)\]/) || [])[1] || "";
  const need = new Set([id + "/index.html"]);
  scripts.concat(styles).filter(own).forEach((p) => need.add(id + "/" + p));
  ["help.en.txt", "help.el.txt"].forEach((f) => { if (exists(root, id + "/" + f)) need.add(id + "/" + f); });
  if (entry && entry.search) need.add(id + "/" + entry.search);
  const notCached = [...need].filter((f) => pc.indexOf('"' + f + '"') < 0);
  if (notCached.length) err("precache", "missing from PRECACHE_URLS in sw.js: " + notCached.join(", "));
  else pass("precache", need.size + " file(s) in PRECACHE_URLS");
  const loose = files.filter((f) => !need.has(f) && !/\.(?:md|test\.js)$/.test(f) && pc.indexOf('"' + f + '"') < 0);
  if (loose.length) warn("precache", "not precached (fine only if loaded on demand online): " + loose.join(", "));

  // 3. Direct link (DL-1)
  const dl = DL_RE.exec(html);
  if (!dl) err("DL-1", "the direct-link snippet is missing from index.html");
  else if (!dl[1].includes('"../?open=' + id + '"')) err("DL-1", "the direct-link snippet names another app");
  else if (html.indexOf("<script") !== dl.index || dl.index > html.indexOf("</head>")) err("DL-1", "the direct-link snippet must be the first script, inside <head>");
  else pass("DL-1", "direct-link snippet first in <head>");

  // 4. Palette (G3)
  const own3 = ownJs.map(codeOf).join("\n");
  if (own3.includes("inheritPalette") && own3.includes("watchPalette")) pass("G3", "inheritPalette + watchPalette");
  else err("G3", "the app's scripts need inheritPalette() and watchPalette()");

  // 5. Help (R38)
  const hen = id + "/help.en.txt", hel = id + "/help.el.txt";
  if (!exists(root, hen) || !exists(root, hel)) err("R38", "help.en.txt and help.el.txt are both needed");
  else {
    const e = read(root, hen), g = read(root, hel);
    const gr = (g.match(/[Ͱ-Ͽ]/g) || []).length, la = (g.match(/[A-Za-z]/g) || []).length;
    if (gr < la) err("R38", "help.el.txt is mostly Latin text");
    else if (headings(e).join() !== headings(g).join()) err("R38", "help.en.txt and help.el.txt need the same headings outline");
    else if (/<[a-z!/]/i.test(e + g)) err("R38", "the help pages cannot contain HTML");
    else pass("R38", "help pages in English and Greek");
  }

  // 6. Sync: registerSlice with five arguments
  const regs = js.map((f) => [f, callArgs(codeOf(f), "registerSlice")]).filter((x) => x[1].length);
  const bad = regs.filter((x) => x[1].some((n) => n > 0 && n < 5));
  if (bad.length) err("sync", "registerSlice needs 5 arguments (name, get, set, storageKey, mergeFn) in " + bad.map((x) => x[0]).join(", "));
  else if (regs.length) pass("sync", "registerSlice with a merge function");
  else pass("sync", "no synced data (no registerSlice)");

  // 7. Search provider
  if (entry && entry.search) {
    const s = codeOf(id + "/" + entry.search);
    if (!s) err("search", id + "/" + entry.search + " is declared in apps.json but missing");
    else if (!/orosSearchProviders/.test(s) || !/module\.exports/.test(s)) err("search", entry.search + " must push to orosSearchProviders and export for Node");
    else if (/\b(?:setItem|removeItem|innerHTML)\b/.test(s)) err("search", entry.search + " must be read-only and text-only (no setItem, removeItem, innerHTML)");
    else pass("search", "search provider " + entry.search);
  }

  // 8. Safety and privacy: no code from text or from other sites, no Google
  const textFiles = files.filter((f) => /\.(?:js|html|css|json|webmanifest)$/.test(f) && !/\.test\.js$/.test(f));
  for (const f of textFiles) {
    const s = codeOf(f);
    for (const [re, why] of DANGER) if (re.test(s)) err("safety", f + ": " + why);
    if (GOOGLE_RE.test(s) && !GOOGLE_APPROVED.has(f)) err("privacy", f + ": names a Google service (orOS has no Google dependencies)");
  }
  scripts.concat(styles).filter((p) => /^(?:https?:)?\/\//.test(p)).forEach((p) => err("safety", "index.html loads " + p + " from another site; vendor it under vendor/"));
  files.filter((f) => f.endsWith(".css")).forEach((f) => {
    if (/@import\s+(?:url\()?["']?(?:https?:)?\/\//.test(codeOf(f)) || /url\(\s*["']?(?:https?:)?\/\//.test(codeOf(f))) err("safety", f + ": loads a file from another site");
  });
  const inner = js.filter((f) => /\.innerHTML\s*[+]?=/.test(codeOf(f)));
  if (inner.length) warn("safety", "innerHTML in " + inner.join(", ") + ": fine for fixed markup (icons), never for user or imported text");
  if (!res.some((r) => (r.rule === "safety" || r.rule === "privacy") && r.level === "error")) pass("safety", "no eval, no remote code, no Google");

  return res;
}

function runNode(args, env) {
  return spawnSync(process.execPath, args, { cwd: ROOT, encoding: "utf8", env: Object.assign({}, process.env, env || {}) });
}

function main() {
  const argv = process.argv.slice(2);
  const id = argv.find((a) => !a.startsWith("--"));
  if (!id) { console.error("usage: node .github/app-kit/check-app.js <id> [--no-tests] [--no-browser]"); process.exit(2); }
  let failed = 0;
  const line = (ok, rule, msg) => console.log((ok === true ? "✓" : ok === "warn" ? "!" : "✗") + " " + rule.padEnd(10) + " " + msg);

  console.log("orOS App Kit check: " + id + "\n");
  for (const r of checkApp(ROOT, id)) {
    line(r.ok || (r.level === "warn" ? "warn" : false), r.rule, r.msg);
    if (r.level === "error") failed++;
  }

  const g = runNode([path.join(".github", "scripts", "stamp-assets.js")], { OROS_CHECK: "1", OROS_VERSION: "" });
  if (g.status === 0) line(true, "guards", "release guards G2-G5 pass");
  else { failed++; line(false, "guards", "release guards fail:\n" + (g.stderr || g.stdout).trim().split("\n").map((l) => "    " + l).join("\n")); }

  if (!argv.includes("--no-tests")) {
    const tests = ["help", "direct-link", "i18n", "release-guards", "deeplink-receivers"]
      .map((n) => "tests/" + n + ".test.js").filter((f) => exists(ROOT, f));
    fs.readdirSync(path.join(ROOT, "tests")).forEach((f) => {
      if ((f.startsWith(id + ".") || f.startsWith(id + "-")) && f.endsWith(".test.js")) tests.push("tests/" + f);
      if (/^search[\w-]*\.test\.js$/.test(f)) tests.push("tests/" + f);
    });
    const t = runNode(["--test", "--test-reporter=dot"].concat([...new Set(tests)]));
    if (t.status === 0) line(true, "tests", tests.length + " test file(s) pass");
    else {
      failed++;
      const out = (t.stdout + t.stderr).split("\n").filter((l) => /not ok|Error|assert|expected|actual|✖|missing/i.test(l)).slice(0, 40);
      line(false, "tests", "failing tests (full run: node --test " + tests.join(" ") + "):\n" + out.map((l) => "    " + l.trim()).join("\n"));
    }
  }

  if (!argv.includes("--no-browser")) {
    const smoke = path.join(".github", "qa", "smoke.js");
    const hasPw = exists(ROOT, ".github/qa/node_modules/playwright") || !!process.env.QA_CHROMIUM;
    if (!exists(ROOT, smoke)) line("warn", "browser", "quality gate not in this checkout yet, browser check skipped");
    else if (!hasPw) line("warn", "browser", "skipped: install Playwright with  npm install --prefix .github/qa  (or set QA_CHROMIUM)");
    else {
      const b = runNode([smoke, "--only", id]);
      if (b.status === 0) line(true, "browser", "quality gate: 360/1280 px, EN/EL, no new problems");
      else { failed++; line(false, "browser", "quality gate found problems:\n" + (b.stdout + b.stderr).trim().split("\n").slice(-30).map((l) => "    " + l).join("\n")); }
    }
  }

  console.log("\n" + (failed ? "✗ " + failed + " problem(s) to fix" : "✓ " + id + " follows the orOS app contract"));
  process.exit(failed ? 1 : 0);
}

module.exports = { checkApp, callArgs };
if (require.main === module) main();
