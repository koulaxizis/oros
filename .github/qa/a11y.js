// orOS quality gate, wave Q3: accessibility baseline with axe-core.
// CI only: axe-core is installed by .github/workflows/quality.yml into
// .github/qa/node_modules (pinned in package.json) and never reaches the
// app. It is injected through Playwright, so no app file loads it.
//
// For every app of apps.json (and the shell), with ?standalone, at 360 px
// in EN and EL, offline like smoke.js: run axe-core and fail on a NEW
// violation of impact "critical" or "serious" (WCAG 2.x A/AA rules and
// axe's best practices). One baseline line per app, language and rule:
//   app | a11y | 360 | lang | rule-id
// so a rule that already fails somewhere in an app does not fail again for
// each new element; a rule new to the app does. Like smoke.js a new
// problem is re-checked once, and fixed lines are listed so the baseline
// can shrink.
//
// Usage: node .github/qa/a11y.js [--shard i/n] [--only id,id]
//                                [--update-baseline] [--out file]
"use strict";

const fs = require("fs");
const path = require("path");
const QA = require("./smoke.js");

const BASELINE = path.join(__dirname, "baseline.json");
const IMPACTS = new Set(["critical", "serious"]);
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

function axeSource() {
  const tries = [path.join(__dirname, "node_modules", "axe-core", "axe.min.js")];
  try { tries.push(require.resolve("axe-core/axe.min.js")); } catch (e) {}
  for (const t of tries) if (fs.existsSync(t)) return fs.readFileSync(t, "utf8");
  throw new Error("axe-core not found: npm install --prefix .github/qa");
}

// Keep only what the gate fails on, one entry per rule.
function pickViolations(violations) {
  const out = new Map();
  for (const v of violations || []) {
    if (!IMPACTS.has(v.impact)) continue;
    const prev = out.get(v.id);
    out.set(v.id, { id: v.id, impact: v.impact, nodes: (prev ? prev.nodes : 0) + (v.nodes || []).length,
      help: v.help, target: prev ? prev.target : ((v.nodes || [])[0] || {}).target });
  }
  return [...out.values()];
}

async function main() {
  const args = QA.parseArgs(process.argv.slice(2));
  const { chromium } = QA.loadPlaywright();
  const AXE = axeSource();
  const apps = QA.listApps();
  let mine = apps.filter((a, i) => i % args.shard[1] === args.shard[0] - 1);
  if (args.only) mine = apps.filter((a) => args.only.includes(a.id));
  const doShell = !args.only && args.shard[0] === 1 || (args.only && args.only.includes("shell"));

  const srv = await QA.serve();
  const base = "http://127.0.0.1:" + srv.address().port + "/";
  const browser = await chromium.launch(QA.launchOptions());

  async function audit(url, lang) {
    const ctx = await QA.newContext(browser, 360, lang);
    const page = await ctx.newPage();
    page.on("dialog", (d) => d.dismiss().catch(() => {}));
    try {
      await page.goto(url, { waitUntil: "load", timeout: 30000 });
      await page.waitForTimeout(1200);
      await page.evaluate(AXE);
      const res = await page.evaluate((tags) => window.axe.run(document, {
        runOnly: { type: "tag", values: tags }, resultTypes: ["violations"],
      }).then((r) => r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help,
        nodes: v.nodes.slice(0, 3).map((n) => ({ target: n.target })) }))), TAGS);
      return pickViolations(res);
    } catch (e) {
      return [{ id: "audit-failed", impact: "serious", nodes: 0, help: String(e.message || e).split("\n")[0] }];
    } finally {
      await ctx.close().catch(() => {});
    }
  }

  async function check(id, url) {
    const found = [];
    for (const lang of ["en", "el"]) {
      for (const v of await audit(url, lang)) {
        found.push({ app: id, kind: "a11y", width: 360, lang, detail: v.id, info: v.impact + ", " + v.nodes + " element(s): " + v.help + (v.target ? " e.g. " + v.target[0] : "") });
      }
    }
    return found;
  }
  const checkOne = (id) => id === "shell" ? check("shell", base + "index.html") : check(id, base + apps.find((a) => a.id === id).url + "?standalone");

  const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, "utf8")) : { entries: [] };
  const known = new Set(baseline.entries);
  const ids = new Set(mine.map((a) => a.id).concat(doShell ? ["shell"] : []));
  const isMine = (k) => { const p = k.split(" | "); return ids.has(p[0]) && p[1] === "a11y"; };

  const seen = new Map();
  const t0 = Date.now();
  for (const id of ids) {
    const t = Date.now();
    const found = await checkOne(id);
    for (const e of found) seen.set(QA.key(e), e);
    process.stdout.write(id + " " + found.length + " (" + ((Date.now() - t) / 1000).toFixed(1) + "s)\n");
  }
  let fresh = [...seen.keys()].filter((k) => !known.has(k));
  if (!args.update && fresh.length) {
    const again = new Set();
    for (const id of new Set(fresh.map((k) => seen.get(k).app))) for (const e of await checkOne(id)) again.add(QA.key(e));
    fresh = fresh.filter((k) => again.has(k));
  }
  const fixed = baseline.entries.filter((k) => isMine(k) && !seen.has(k));

  if (args.update) {
    const keep = baseline.entries.filter((k) => !isMine(k));
    baseline.entries = [...new Set(keep.concat([...seen.keys()]))].sort();
    fs.writeFileSync(BASELINE, JSON.stringify(baseline, null, 2) + "\n");
  }

  const report = { pages: ids.size, seconds: Math.round((Date.now() - t0) / 1000), new: fresh.map((k) => k + "  (" + seen.get(k).info + ")"), fixed };
  if (args.out) fs.writeFileSync(args.out, JSON.stringify(report, null, 2));
  const lines = ["### orOS accessibility (axe-core, shard " + args.shard.join("/") + ")", "",
    report.pages + " pages checked at 360 px, EN + EL, in " + report.seconds + " s. New problems: " + fresh.length + ". Fixed baseline entries: " + fixed.length + ".", ""];
  if (fresh.length) lines.push("**New critical / serious violations** (fix them; rule help: https://dequeuniversity.com/rules/axe/):", "", "```", ...report.new, "```", "");
  if (fixed.length) lines.push("**No longer happening** (delete these lines from `.github/qa/baseline.json`):", "", "```", ...fixed, "```", "");
  const md = lines.join("\n");
  console.log("\n" + md);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + "\n");
  await browser.close();
  srv.close();
  if (!args.update && fresh.length) process.exitCode = 1;
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(2); });

module.exports = { pickViolations, IMPACTS };
