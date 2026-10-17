// orOS quality gate with the experimental multitasking switch on (wave
// M2). CI only, like smoke.js; nothing here is shipped.
//
// For every app of the shard, in the real shell with "oros-multitask"
// on: open the app, mark its window, open another app, and check that
//   hidden     the app's frame stays alive behind the new front frame,
//              display:none, document.visibilityState "hidden"
//              (close-on-leave apps of shell.js: their frame is gone)
//   sync       every merge slice the app registered still runs its
//              get / set / merge while hidden (converge.js sweep; only a
//              throw counts here, convergence itself is converge.js's)
//   back       opening the app again shows the same window (the mark is
//              still there: no reload), visible again
//   errors     no uncaught error or console error while the app is hidden
//              or on the way back
// A problem seen once is checked a second time before it fails the run.
//
// Usage: node .github/qa/multitask.js [--shard i/n] [--only id,id] [--out file]
"use strict";

const fs = require("fs");
const path = require("path");
const QA = require("./smoke.js");
const { sweepSlice, CAPTURE } = require("./converge.js");

// The close-on-leave list, read from shell.js so the two never drift.
function closeOnLeave() {
  const src = fs.readFileSync(path.join(QA.ROOT, "shell.js"), "utf8");
  const m = /var MT_CLOSE_ON_LEAVE = \{([^}]*)\}/.exec(src);
  if (!m) throw new Error("MT_CLOSE_ON_LEAVE not found in shell.js");
  return new Set([...m[1].matchAll(/([a-z0-9]+)\s*:/g)].map((x) => x[1]));
}

// Frames of the running area, as the test sees them.
function framesProbe() {
  return [...document.querySelectorAll("#oros-running iframe")].map((f) => {
    let vis = "?", mark = null;
    try { vis = f.contentDocument.visibilityState; mark = f.contentWindow.__qaMark || null; } catch (e) {}
    return { front: f.id === "app-frame", app: f.getAttribute("data-oros-app"), display: f.style.display, vis, mark };
  });
}

async function main() {
  const args = QA.parseArgs(process.argv.slice(2));
  process.env.OROS_MULTITASK = "1";
  const { chromium } = QA.loadPlaywright();
  const leave = closeOnLeave();
  const apps = QA.listApps();
  let mine = apps.filter((a, i) => i % args.shard[1] === args.shard[0] - 1);
  if (args.only) mine = apps.filter((a) => args.only.includes(a.id));

  const srv = await QA.serve();
  const base = "http://127.0.0.1:" + srv.address().port + "/";
  const browser = await chromium.launch(QA.launchOptions());

  async function checkApp(app) {
    const found = [];
    const add = (kind, detail) => found.push({ app: app.id, kind: "mt-" + kind, detail: QA.norm(detail || "") });
    const other = app.id === "calculator" ? "notes" : "calculator";
    const ctx = await QA.newContext(browser, 1280, "en");
    await ctx.addInitScript(CAPTURE);
    const page = await ctx.newPage();
    let errors = null;   // collected only once the app is hidden
    page.on("pageerror", (e) => { if (errors) errors.push("uncaught: " + String(e.message || e).split("\n")[0]); });
    page.on("console", (m) => {
      if (!errors || m.type() !== "error") return;
      const t = m.text();
      if (!QA.NOISE.some((r) => r.test(t))) errors.push("console: " + t.split("\n")[0]);
    });
    page.on("dialog", (d) => d.dismiss().catch(() => {}));
    try {
      await page.goto(base + "index.html", { waitUntil: "load", timeout: 30000 });
      await page.waitForFunction(() => window.__orosOpenApp && window.orosSync && window.orosSettings, null, { timeout: 20000 });
      await page.waitForTimeout(600);
      if (!(await page.evaluate(() => { const s = window.orosSettings.get().multitask; return s && s.on; }))) {
        add("off", "switch did not turn on");
        throw null;
      }
      const shellSlices = await page.evaluate(() => Object.keys(window.__qaSlices));
      await page.evaluate((id) => window.__orosOpenApp(id), app.id);
      await page.waitForTimeout(2200);
      await page.evaluate(() => { document.getElementById("app-frame").contentWindow.__qaMark = "m"; });
      const names = await page.evaluate((skip) => Object.keys(window.__qaSlices)
        .filter((n) => !skip.includes(n) && typeof window.__qaSlices[n].merge === "function"), shellSlices);

      errors = [];
      await page.evaluate((id) => window.__orosOpenApp(id), other);
      await page.waitForTimeout(1500);
      let fr = await page.evaluate(framesProbe);
      const mineNow = fr.filter((f) => f.app === app.id);
      if (leave.has(app.id)) {
        if (mineNow.length) add("hidden", "close-on-leave app still alive");
      } else if (mineNow.length !== 1) {
        add("hidden", "no hidden frame (" + fr.length + " frames)");
      } else {
        const h = mineNow[0];
        if (h.display !== "none" || h.vis !== "hidden") add("hidden", "display " + h.display + ", visibilityState " + h.vis);
        if (h.mark !== "m") add("back", "hidden frame lost its window (reloaded)");
        for (const name of names) {
          const res = await page.evaluate(sweepSlice, { name, fixture: null })
            .catch((e) => [{ kind: "throws", detail: "sweep: " + String(e.message).split("\n")[0] }]);
          for (const r of res) if (r.kind === "throws") add("sync", name + ": " + r.detail);
        }
      }

      await page.evaluate((id) => window.__orosOpenApp(id), app.id);
      await page.waitForTimeout(leave.has(app.id) ? 2200 : 900);
      fr = await page.evaluate(framesProbe);
      const front = fr.find((f) => f.front);
      if (!front) add("back", "no front frame");
      else if (!leave.has(app.id)) {
        if (front.mark !== "m") add("back", "reloaded instead of shown again");
        if (front.display === "none" || front.vis !== "visible") add("back", "display " + front.display + ", visibilityState " + front.vis);
      }
      if (fr.filter((f) => f.front).length !== 1) add("back", fr.filter((f) => f.front).length + " front frames");
      for (const e of new Set(errors)) add("error", e);
    } catch (e) {
      if (e) add("error", "run: " + String(e.message || e).split("\n")[0]);
    }
    await ctx.close().catch(() => {});
    return found;
  }

  const t0 = Date.now();
  const seen = new Map();
  for (const app of mine) {
    const t = Date.now();
    const found = await checkApp(app);
    for (const e of found) seen.set(QA.key(e), e);
    process.stdout.write(app.id + " " + found.length + " (" + ((Date.now() - t) / 1000).toFixed(1) + "s)\n");
  }
  // Confirm: a problem must show up twice in a row.
  let bad = [...seen.keys()];
  if (bad.length) {
    const again = new Set();
    for (const id of new Set(bad.map((k) => seen.get(k).app))) for (const e of await checkApp(apps.find((a) => a.id === id))) again.add(QA.key(e));
    bad = bad.filter((k) => again.has(k));
  }

  const report = { apps: mine.length, seconds: Math.round((Date.now() - t0) / 1000), problems: bad };
  if (args.out) fs.writeFileSync(args.out, JSON.stringify(report, null, 2));
  const lines = ["### orOS multitasking on (shard " + args.shard.join("/") + ")", "",
    report.apps + " apps checked in " + report.seconds + " s. Problems: " + bad.length + ".", ""];
  if (bad.length) lines.push("**Problems** (the app breaks while hidden: fix it, or add it to MT_CLOSE_ON_LEAVE in shell.js):", "", "```", ...bad, "```", "");
  const md = lines.join("\n");
  console.log("\n" + md);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + "\n");
  await browser.close();
  srv.close();
  if (bad.length) process.exitCode = 1;
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(2); });

module.exports = { closeOnLeave };
