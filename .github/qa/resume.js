// orOS quality gate: every game carries on where it was left (GR-2).
// CI / local tool only, never shipped.
//
// For each game in gamekit/resume.js (the 37 Games apps but the Game
// Center), in a fresh offline browser context, standalone:
//   1. a fresh open is NOT reported in progress (nothing would be
//      reopened that has nothing to resume);
//   2. a little play (the game's own moves below, or a generic set of
//      keys and taps) makes the stored session report a game in
//      progress;
//   3. after a reload (the tab closed and opened again, pagehide
//      included) the game in progress is still there.
// Jigsaw keeps its game in IndexedDB, which resume.js cannot read: it
// is only opened (no errors). Page errors fail the game.
//
// Usage: node .github/qa/resume.js [--only id,id] [--out file.json]
"use strict";

const fs = require("fs");
const path = require("path");
const QA = require("./smoke.js");
const R = require(path.join(QA.ROOT, "gamekit", "resume.js"));

const WAIT = 1500;

// The default play: arrow keys, Space, a few digits and letters, then
// taps on the board's buttons until the game counts as under way.
const GENERIC = { keys: ["Space", "ArrowRight", "ArrowUp", "ArrowLeft", "ArrowDown", "Digit5", "Digit4", "KeyE"],
  taps: "main button:not([disabled]), #board button, .cell, .tile, canvas" };

// Games the default play does not move.
const PLAY = {
  // the first arrow starts the snake; the reload pauses and keeps it
  snake: async (p) => { await p.keyboard.press("ArrowUp"); await p.waitForTimeout(300); },
  wordle: async (p) => { await p.keyboard.type("crane", { delay: 60 }); await p.keyboard.press("Enter"); await p.waitForTimeout(800); },
  hangman: async (p, inProg) => {
    for (const k of "ETAOINSR") { await tap(p, '#kb .key[data-k="' + k + '"]'); if (await inProg()) return; }
  },
  simon: async (p) => { await tap(p, "#hub"); await p.waitForTimeout(800); },
  // a card from the stock is a move
  solitaire: async (p) => { await tap(p, '[aria-label^="Stock"]'); await p.waitForTimeout(500); },
  // e2-e4 (0x88 squares), or after the computer's move as black e7-e5
  chess: async (p, inProg) => {
    for (const [a, b] of [["20", "52"], ["100", "68"]]) {
      await tap(p, '[data-sq="' + a + '"]'); await tap(p, '[data-sq="' + b + '"]');
      await p.waitForTimeout(600);
      if (await inProg()) return;
    }
  },
  // a man on the fifth row (squares 40–47) one step forward
  checkers: async (p, inProg) => {
    for (let a = 40; a < 48; a++) {
      for (const d of [7, 9]) {
        await tap(p, '[data-i="' + a + '"]'); await tap(p, '[data-i="' + (a - d) + '"]');
        if (await inProg()) return;
      }
    }
  },
  reversi: async (p, inProg) => { await tapAll(p, ".sq", inProg, false); },
  battleship: async (p, inProg) => {
    await tap(p, "#random-btn"); await tap(p, "#start-btn"); await p.waitForTimeout(600);
    await tapAll(p, "[data-q]", inProg, true);
  },
  // Realm: close the first-game "How to play", end the turn, let the
  // computer sides play theirs
  realm: async (p, inProg) => {
    await p.keyboard.press("Escape"); await p.waitForTimeout(300);
    await tap(p, "#end-btn");
    for (let i = 0; i < 20 && !(await inProg()); i++) await p.waitForTimeout(300);
  },
  // Banner: close the first-run tour, then end the first turn
  banner: async (p, inProg) => {
    await p.waitForTimeout(700);
    await p.keyboard.press("Escape"); await p.waitForTimeout(300);
    await tap(p, "#end-btn");
    for (let i = 0; i < 20 && !(await inProg()); i++) await p.waitForTimeout(300);
  },
  // Crypt: close the first-run "How to play", then wait a few turns
  crypt: async (p, inProg) => {
    await p.waitForTimeout(700);
    await p.keyboard.press("Escape"); await p.waitForTimeout(300);
    for (let i = 0; i < 4 && !(await inProg()); i++) await tap(p, "#wait-btn");
  },
  // Wayfarers: close the first-run tour, then go to the first stop
  wayfarers: async (p, inProg) => {
    await p.waitForTimeout(700);
    await p.keyboard.press("Escape"); await p.waitForTimeout(300);
    await p.focus("#view").catch(() => {});
    await p.keyboard.press("Enter"); await p.waitForTimeout(400);
    for (let i = 0; i < 20 && !(await inProg()); i++) await p.waitForTimeout(300);
  },
  // a word search counts as under way after 15 s of play
  wordsearch: async (p) => { await p.waitForTimeout(16000); }
};

async function tap(p, sel) {
  const el = await p.$(sel);
  if (el) await el.click({ timeout: 1500, force: true }).catch(() => {});
  await p.waitForTimeout(250);
}
async function tapAll(p, sel, inProg, reverse) {
  let els = await p.$$(sel);
  if (reverse) els = els.reverse();
  for (const el of els) {
    await el.click({ timeout: 800, force: true }).catch(() => {});
    await p.waitForTimeout(120);
    await p.keyboard.press("Escape").catch(() => {});
    if (await inProg()) return;
  }
}

async function checkGame(browser, base, id) {
  const ctx = await QA.newContext(browser, 1000, "en");
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(String(e && e.message || e).slice(0, 200)));
  const inProg = async () => {
    const s = await p.evaluate((k) => localStorage.getItem(k), "oros-" + id + "-session");
    return R.inProgress(id, (k) => (k === "oros-" + id + "-session" ? JSON.parse(s || "null") : null));
  };
  const out = { id, fresh: null, played: null, reopened: null, errors };
  await p.goto(base + "/" + id + "/?standalone");
  await p.waitForTimeout(WAIT);
  out.fresh = await inProg();
  if (id !== "jigsaw") {
    if (PLAY[id]) await PLAY[id](p, inProg);
    else {
      for (const k of GENERIC.keys) { await p.keyboard.press(k).catch(() => {}); await p.waitForTimeout(250); }
      await p.waitForTimeout(3000);
      if (!(await inProg())) {
        const els = await p.$$(GENERIC.taps);
        for (let i = 0; i < Math.min(els.length, 8) && !(await inProg()); i++) {
          await els[Math.floor(i * els.length / 8)].click({ timeout: 800, force: true }).catch(() => {});
          await p.waitForTimeout(500);
          await p.keyboard.press("Escape").catch(() => {});
        }
      }
    }
    await p.waitForTimeout(500);
    out.played = await inProg();
    await p.reload();
    await p.waitForTimeout(WAIT);
    out.reopened = await inProg();
  }
  await ctx.close();
  out.ok = !errors.length && (id === "jigsaw" ? out.fresh === null :
    out.fresh === false && out.reopened === true);
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  let only = null, outFile = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--only") only = String(argv[++i] || "").split(",").filter(Boolean);
    else if (argv[i] === "--out") outFile = argv[++i];
  }
  const ids = R.GAMES.filter((id) => !only || only.includes(id));
  const pw = QA.loadPlaywright();
  const browser = await pw.chromium.launch(QA.launchOptions());
  const srv = await QA.serve();
  const base = "http://127.0.0.1:" + srv.address().port;
  const results = [];
  for (const id of ids) {
    let r = await checkGame(browser, base, id);
    if (!r.ok) r = await checkGame(browser, base, id);   // one fresh retry; only a repeat counts
    results.push(r);
    process.stdout.write(id + (r.ok ? " ok" : " FAILED " + JSON.stringify(r)) + "\n");
  }
  await browser.close();
  srv.close();
  const bad = results.filter((r) => !r.ok);
  const md = "### Games resume (GR-2)\n\n" + results.length + " games checked. Failed: " + bad.length + "." +
    (bad.length ? "\n\n```\n" + bad.map((r) => JSON.stringify(r)).join("\n") + "\n```" : "") + "\n";
  console.log("\n" + md);
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  if (bad.length) process.exitCode = 1;
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(2); });
