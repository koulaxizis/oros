// orOS quality gate: the phone layout of every game (games audit F1 + F2,
// gamekit/layout.css). CI / local tool only.
//
// For each game of apps.json (category Games, the Game Center aside),
// standalone and offline, on a touch screen, in Greek (the longer words):
//   at 740 x 360 (a phone held sideways)
//   1. <main> (the board) is to the right of the controls and gets the
//      whole height: at least 95% of the screen high, 55% wide;
//   at 360 x 780 (a phone upright)
//   2. no toolbar control lies past the edge of the screen;
//   both
//   3. the page does not scroll sideways, and no page errors.
//
// Usage: node .github/qa/gamelayout.js [--only id,id] [--out file.json]
"use strict";

const fs = require("fs");
const path = require("path");
const QA = require("./smoke.js");

const W = 740, H = 360, PW = 360, PH = 780;

async function main() {
  const args = QA.parseArgs(process.argv.slice(2));
  const { chromium } = QA.loadPlaywright();
  let games = QA.listApps().filter((a) => a.category === "Games" && a.id !== "gamecenter");
  if (args.only) games = games.filter((a) => args.only.includes(a.id));
  const srv = await QA.serve();
  const base = "http://127.0.0.1:" + srv.address().port + "/";
  const browser = await chromium.launch(QA.launchOptions());
  const problems = [];
  for (const g of games) for (const [vw, vh] of [[W, H], [PW, PH]]) {
    const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1,
      isMobile: true, hasTouch: true, serviceWorkers: "block" });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (r) => r.abort("internetdisconnected"));
    await ctx.addInitScript(() => {
      try { localStorage.setItem("oros-lang", "el"); localStorage.setItem("oros-multitask", "0"); } catch (e) {}
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e.message || e).split("\n")[0]));
    try {
      await page.goto(base + g.url + "?standalone", { waitUntil: "load", timeout: 30000 });
      await page.waitForTimeout(800);
      const m = await page.evaluate(() => {
        const main = document.querySelector("body > main"), tb = document.getElementById("toolbar");
        const r = main ? main.getBoundingClientRect() : null, t = tb ? tb.getBoundingClientRect() : null;
        const de = document.documentElement;
        const past = tb ? [...tb.querySelectorAll("button, select")].filter((e) => {
          const q = e.getBoundingClientRect();
          return q.width > 0 && (q.right > innerWidth + 1 || q.left < -1);
        }).map((e) => e.id || e.getAttribute("data-i18n") || e.className) : [];
        return { main: r && [r.left, r.width, r.height], tbRight: t && t.right, past,
          sideways: Math.max(de.scrollWidth, document.body.scrollWidth) > de.clientWidth + 1 };
      });
      const at = " (" + vw + "x" + vh + ")";
      if (!m.main) problems.push(g.id + ": no body > main");
      else if (vw === PW) {
        if (m.past.length) problems.push(g.id + ": toolbar controls past the screen edge" + at + ": " + m.past.join(", "));
      } else {
        if (m.main[2] < H * 0.95) problems.push(g.id + ": board area only " + Math.round(m.main[2]) + " px high of " + H);
        if (m.main[1] < W * 0.55) problems.push(g.id + ": board area only " + Math.round(m.main[1]) + " px wide of " + W);
        if (m.tbRight != null && m.tbRight > m.main[0] + 1) problems.push(g.id + ": toolbar is not beside the board");
      }
      if (m.sideways) problems.push(g.id + ": the page scrolls sideways" + at);
    } catch (e) {
      problems.push(g.id + ": load " + String(e.message || e).split("\n")[0]);
    }
    for (const e of errors) problems.push(g.id + ": page error " + e);
    await ctx.close().catch(() => {});
    if (vw === W) process.stdout.write(g.id + " ");
  }
  const md = ["", "### orOS games on a phone (" + W + " x " + H + " sideways, " + PW + " x " + PH + " upright)", "",
    games.length + " games checked. Problems: " + problems.length + ".", ""]
    .concat(problems.length ? ["```"].concat(problems, ["```", ""]) : []).join("\n");
  console.log(md);
  if (args.out) fs.writeFileSync(args.out, JSON.stringify({ games: games.length, problems }, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + "\n");
  await browser.close();
  srv.close();
  if (problems.length) process.exitCode = 1;
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(2); });
