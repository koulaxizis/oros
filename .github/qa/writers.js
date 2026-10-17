// orOS multitasking, wave M1: who writes an app's data while the app is
// open but hidden? CI / local tool only, never shipped. No browser.
//
// Today a closed app holds nothing in memory. With multitasking an app
// stays alive (hidden) and keeps its data in memory; if another writer
// changes that data meanwhile, the hidden app can later save its old copy
// over the new one. This scan finds, for every app of apps.json:
//   foreign  localStorage keys of the app ("oros-..." literals in its
//            folder) that a file OUTSIDE the folder writes (setItem /
//            writeJson* / removeItem with the literal or a variable set
//            to it), with the writer files; files of the app's folder
//            that another app or the shell loads count as foreign too
//            when they run in that other window
//   listens  the app has a "storage" event listener (it sees writes made
//            by other documents of orOS, the shell and other frames)
//   host     the writer is a file of the app's own folder that runs in the
//            shell (music/host.js, stickies/host.js, today/host.js...):
//            the host owns the data and the app is a screen over it, so
//            such writes are by design (M2 checks the app follows the
//            host's change events)
//   handoff  one-shot keys a shell bridge stages when the app is NOT
//            running ("-open", "-new", "-pending", "-toggle", "-wake",
//            "-period"), taken by the app at boot. A live app gets the
//            push instead (appLive / appFrameOf), so they hold no data
//            a hidden app could overwrite
// An app with foreign writers it does not listen for is "check": M2 must
// either route that writer to the live app or keep the app closing on
// leave. Static and conservative: writes through helpers that hide the
// key are not seen, so the verdict is a starting list, not a proof.
//
// Usage: node .github/qa/writers.js [--json]
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const SKIP = /(^|\/)(node_modules|vendor|tests|android|extension|relay|\.github|\.git)(\/|$)/;

function readTree() {
  const files = {};
  (function walk(rel) {
    for (const f of fs.readdirSync(path.join(ROOT, rel))) {
      const r = rel ? rel + "/" + f : f;
      if (SKIP.test(r)) continue;
      const st = fs.statSync(path.join(ROOT, r));
      if (st.isDirectory()) walk(r);
      else if (/\.(js|html)$/.test(f)) files[r] = fs.readFileSync(path.join(ROOT, r), "utf8");
    }
  })("");
  return files;
}

const LIT = /["'](oros-[a-z0-9-]+)["']/g;
const HANDOFF = /-(open|new|pending|toggle|wake|period)$/;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Does source `s` write key `k` (literal or a variable holding it)?
function writes(s, k) {
  if (s.indexOf('"' + k + '"') < 0 && s.indexOf("'" + k + "'") < 0) return false;
  const vars = [...s.matchAll(new RegExp("([A-Za-z_$][\\w$]*)\\s*[:=]\\s*[\"']" + esc(k) + "[\"']", "g"))].map((m) => esc(m[1]));
  const arg = "[\"']" + esc(k) + "[\"']" + (vars.length ? "|" + vars.join("|") : "");
  return new RegExp("(setItem|writeJson\\w*|removeItem)\\(\\s*(" + arg + ")\\s*[,)]").test(s);
}

// Script files a page loads (relative src), as repo paths.
function scriptsOf(htmlPath, html) {
  const dir = path.posix.dirname(htmlPath);
  return [...html.matchAll(/<script[^>]+src="([^"?#]+)/g)]
    .map((m) => path.posix.normalize(dir === "." ? m[1] : dir + "/" + m[1]))
    .filter((p) => !/^(\.\.|https?:)/.test(p));
}

function scan(files, apps) {
  const top = (p) => (p.indexOf("/") > 0 ? p.split("/")[0] : "(root)");
  // Where each file RUNS: its own folder, plus every page that loads it.
  const runsIn = {};
  for (const p of Object.keys(files)) runsIn[p] = new Set([top(p)]);
  for (const [p, s] of Object.entries(files)) {
    if (!/index\.html$/.test(p)) continue;
    const where = p === "index.html" ? "(root)" : top(p);
    for (const js of scriptsOf(p, s)) if (runsIn[js]) runsIn[js].add(where);
  }
  // Scripts loaded on demand (loadScript("../x/y.js")) run in the loader.
  for (const [p, s] of Object.entries(files)) {
    for (const m of s.matchAll(/loadScript\(\s*"\.\.\/([^"?]+)"/g)) if (runsIn[m[1]]) runsIn[m[1]].add(top(p));
  }
  const out = [];
  for (const a of apps) {
    const dir = a.url.replace(/^\.?\//, "").split("/")[0];
    const own = Object.keys(files).filter((p) => top(p) === dir);
    const keys = new Set();
    for (const p of own) for (const m of files[p].matchAll(LIT)) if (writes(files[p], m[1])) keys.add(m[1]);
    const foreign = [];
    for (const k of [...keys].sort()) {
      const by = [];
      let host = true;
      for (const [p, s] of Object.entries(files)) {
        if (!writes(s, k)) continue;
        for (const w of runsIn[p]) {
          if (w === dir) continue;
          if (top(p) !== dir || w !== "(root)") host = false;
          by.push(w === "(root)" ? p + " (shell)" : p + (top(p) === w ? "" : " (in " + w + ")"));
        }
      }
      if (by.length) foreign.push({ key: k, by: [...new Set(by)].sort(), host, handoff: HANDOFF.test(k) });
    }
    const listens = own.some((p) => /addEventListener\(\s*["']storage["']/.test(files[p]));
    const risky = foreign.filter((f) => !f.host && !f.handoff);
    out.push({ id: a.id, dir, keys: keys.size, foreign, listens,
      verdict: risky.length && !listens ? "check" : risky.length ? "listens" : foreign.some((f) => f.host) ? "host" : "ok" });
  }
  return out;
}

function report(rows) {
  const L = ["# orOS: who writes an app's data while it is hidden (wave M1)", "",
    "Static scan by `.github/qa/writers.js`. **check** = another window writes the app's own keys and the app has no `storage` listener, so a hidden copy could save stale data over the new one. A starting list for M2, not a proof (writes hidden behind helpers are not seen).", ""];
  const n = (v) => rows.filter((r) => r.verdict === v);
  L.push("- Apps: " + rows.length + "; no foreign writer (handoff keys aside): " + n("ok").length + "; only their own shell host: " + n("host").length +
    "; foreign writer but a storage listener: " + n("listens").length + "; to check: " + n("check").length, "");
  L.push("| App | Verdict | Key | Written by |", "|---|---|---|---|");
  for (const r of n("check").concat(n("listens"), n("host"))) {
    for (const f of r.foreign) if (!f.handoff) L.push("| " + [r.id, r.verdict, "`" + f.key + "`", f.by.join(", ")].join(" | ") + " |");
  }
  return L.join("\n") + "\n";
}

if (require.main === module) {
  const apps = JSON.parse(fs.readFileSync(path.join(ROOT, "apps.json"), "utf8")).apps
    .filter((a) => a.type === "internal" && a.url);
  const rows = scan(readTree(), apps);
  process.stdout.write(process.argv.includes("--json") ? JSON.stringify(rows, null, 2) + "\n" : report(rows));
}

module.exports = { writes, scriptsOf, scan, report };
