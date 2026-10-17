// orOS translation coverage, per pack language (every language of
// i18n.js except English and Greek, which live inline and are always
// complete).
//   node .github/i18n/coverage.js            report + rewrite each
//                                            i18n/<code>/STATUS.md and
//                                            manifest.json, and
//                                            i18n/apps.json
//   node .github/i18n/coverage.js --baseline lower inline-baseline.json
//                                            to the current counts
// STATUS.md is for translators (what is left, per app). manifest.json is
// the list of files the shell downloads for offline use; tests fail when
// it is out of date. CI only, never part of the app.

"use strict";

const fs = require("fs");
const path = require("path");
const S = require("./scan.js");

const BASELINE = path.join(__dirname, "inline-baseline.json");

function inlineCounts(all) {
  const out = {};
  for (const f of all) { const n = S.inlineGreek(f.rel, f.tables); if (n) out[f.rel] = n; }
  return out;
}

// Per app: English keys, translated keys (fitting values only).
function report(code, all) {
  const apps = new Set(["shell"]);
  for (const p of S.packApps()) p.apps.forEach((a) => apps.add(a));
  for (const d of fs.readdirSync(S.ROOT)) {
    if (fs.existsSync(path.join(S.ROOT, d, "index.html")) && S.appKeys(d, all).size) apps.add(d);
  }
  const packs = {};
  for (const f of S.packFiles(code)) {
    if (!/^[^/]+\.js$/.test(f)) continue;
    const p = S.readPack("i18n/" + code + "/" + f);
    if (p.error) continue;
    packs[p.app] = p.table;
    apps.add(p.app);
  }
  const loading = new Set();
  for (const p of S.packApps()) p.apps.forEach((a) => loading.add(a));
  const rows = [];
  for (const app of [...apps].sort()) {
    const en = S.appKeys(app, all), tbl = packs[app] || {};
    let done = 0;
    for (const [k, v] of en) {
      const t = tbl[k];
      if (typeof t === "string" && t.trim() && (v === null || (S.placeholders(v) === S.placeholders(t) && S.tags(v) === S.tags(t)))) done++;
    }
    rows.push({ app, keys: en.size, done, loads: loading.has(app) });
  }
  const help = S.helpPages();
  const files = new Set(S.packFiles(code));
  const helpDone = help.filter((h) => files.has(h.pack)).length;
  return { rows, help: { total: help.length, done: helpDone, missing: help.filter((h) => !files.has(h.pack)).map((h) => h.pack) },
    issues: S.packIssues(code, all) };
}

function pct(a, b) { return b ? Math.floor((a / b) * 100) + "%" : "100%"; }

function statusMd(lang, r) {
  const keys = r.rows.reduce((a, x) => a + x.keys, 0), done = r.rows.reduce((a, x) => a + x.done, 0);
  const lines = [
    "# " + lang.name + " (" + lang.code + "): translation status",
    "",
    "Written by `node .github/i18n/coverage.js`; do not edit by hand.",
    "",
    "- Strings: " + done + " of " + keys + " (" + pct(done, keys) + ")",
    "- Help pages: " + r.help.done + " of " + r.help.total + " (" + pct(r.help.done, r.help.total) + ")",
    "- Shown in the language list: " + (lang.status === "hidden" ? "not yet (try it with ?lang=" + lang.code + ")" : "yes"),
    "",
    "Apps marked \"English for now\" do not load language packs yet: their",
    "text is still written in the code. They switch over wave by wave",
    "(see the plan in docs/translate/README.md).",
    "",
    "| App | Translated | Strings |",
    "|---|---|---|"
  ];
  for (const x of r.rows) {
    lines.push("| " + x.app + " | " + (x.loads ? pct(x.done, x.keys) : "English for now") + " | " + x.done + " / " + x.keys + " |");
  }
  if (r.issues && r.issues.length) {
    lines.push("", "## Lines to fix", "", "These show English until fixed (usually the English text changed).", "");
    for (const m of r.issues) lines.push("- " + m);
  }
  if (r.help.missing.length) {
    lines.push("", "## Help pages not translated yet", "");
    for (const m of r.help.missing) lines.push("- " + m);
  }
  return lines.join("\n") + "\n";
}

function main() {
  const all = S.ALL_FILES();
  const inline = inlineCounts(all);
  const inlineTotal = Object.values(inline).reduce((a, n) => a + n, 0);
  if (process.argv.includes("--baseline")) {
    const old = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, "utf8")) : null;
    const next = {};
    for (const [f, n] of Object.entries(inline).sort()) {
      if (!old) next[f] = n;
      else if (old[f] !== undefined) next[f] = Math.min(old[f], n);
    }
    fs.writeFileSync(BASELINE, JSON.stringify(next, null, 1) + "\n");
    console.log("inline-baseline.json: " + Object.keys(next).length + " files, " + Object.values(next).reduce((a, n) => a + n, 0) + " texts");
    return;
  }
  fs.writeFileSync(path.join(S.ROOT, "i18n", "apps.json"), JSON.stringify(S.packIndex(all), null, 1) + "\n");
  for (const lang of S.langs()) {
    if (lang.code === "en" || lang.code === "el") continue;
    const dir = path.join(S.ROOT, "i18n", lang.code);
    fs.mkdirSync(dir, { recursive: true });
    const r = report(lang.code, all);
    fs.writeFileSync(path.join(dir, "STATUS.md"), statusMd(lang, r));
    fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(S.manifest(lang.code), null, 1) + "\n");
    const keys = r.rows.reduce((a, x) => a + x.keys, 0), done = r.rows.reduce((a, x) => a + x.done, 0);
    console.log(lang.code + ": strings " + done + "/" + keys + " (" + pct(done, keys) + "), help " + r.help.done + "/" + r.help.total);
  }
  console.log("inline texts left in the code: " + inlineTotal + " in " + Object.keys(inline).length + " files");
}

if (require.main === module) main();
module.exports = { report, inlineCounts, statusMd };
