#!/usr/bin/env node
// ============================================================
// orOS Chess — tools/lichess-pack.js: cut chess/puzzles-lichess.js
// from the Lichess puzzle database (CC0,
// https://database.lichess.org/#puzzles). Not shipped to the browser;
// run by .github/workflows/chess-puzzles.yml (GitHub's runners can
// reach database.lichess.org, the build container cannot).
//
//   node chess/tools/lichess-pack.js <lichess_db_puzzle.csv> [out.js]
//
// Node 22 built-ins only. The CSV is streamed line by line:
//   PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,
//   Themes,GameUrl,OpeningTags
// Selection (deterministic: the same input gives the same pack):
//   - only well-measured, liked puzzles: RatingDeviation < 90,
//     Popularity >= 85, NbPlays >= 1000, and the row must load with
//     train.js parseLine (the trainer's own checks);
//   - six rating bands (BANDS), PER_BAND puzzles each;
//   - inside a band, every theme the trainer names (THEMES, the "th.*"
//     strings of chess.js) first gets up to PER_THEME puzzles, then the
//     band is filled to PER_BAND;
//   - "first" always means the smallest FNV-1a hash of the PuzzleId
//     (ties by id), so no randomness and no order dependence.
// Memory stays small: each bucket keeps only its best few candidates.
// The output keeps only the five columns the loader reads
// (id,FEN,moves,rating,themes) and the Lichess ids, so a puzzle keeps
// its identity (and its history entry) across re-generations.
// ============================================================
"use strict";

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const T = require("../train.js");

const SOURCE = "https://database.lichess.org/#puzzles";
const BANDS = [[400, 800], [800, 1200], [1200, 1600], [1600, 2000], [2000, 2400], [2400, Infinity]];
const PER_BAND = 500;
const PER_THEME = 8;
// The themes the trainer's Theme list names (chess.js STRINGS "th.*"),
// minus the length labels (short/long/veryLong/oneMove), which every
// puzzle has one of anyway. tests/chess-lichess-pack.test.js keeps this
// list in step with chess.js.
const THEMES = [
  "mate", "mateIn1", "mateIn2", "mateIn3", "mateIn4", "mateIn5",
  "fork", "hangingPiece", "promotion", "endgame", "middlegame", "opening", "backRankMate",
  "advantage", "crushing", "pin", "skewer", "discoveredAttack", "sacrifice", "deflection",
  "attraction", "kingsideAttack", "queensideAttack", "defensiveMove", "quietMove", "trappedPiece",
  "doubleCheck", "smotheredMate", "zugzwang", "rookEndgame", "pawnEndgame", "equality"
];
const MIN = { rd: 90, pop: 85, plays: 1000 };

// FNV-1a, 32 bits.
function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
function before(a, b) { return a.h - b.h || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); }
function bandOf(r) {
  for (let i = 0; i < BANDS.length; i++) if (r >= BANDS[i][0] && r < BANDS[i][1]) return i;
  return -1;
}

// One CSV row → a candidate { id, fen, moves, r, th, h, b } or null.
function candidate(line) {
  const f = String(line || "").split(",");
  if (f.length < 8 || f[0] === "PuzzleId") return null;
  const rd = +f[4], pop = +f[5], plays = +f[6];
  if (!(rd < MIN.rd) || !(pop >= MIN.pop) || !(plays >= MIN.plays)) return null;
  const p = T.parseLine(f.slice(0, 8).join(","));
  if (!p || p.moves.length % 2) return null;
  const b = bandOf(p.r);
  if (b < 0) return null;
  return { id: p.id, fen: p.fen, moves: p.moves.join(" "), r: p.r, th: p.th, h: hash(p.id), b: b };
}

// A bounded list that keeps the `cap` smallest by `before`.
function keep(list, x, cap) {
  if (list.length >= cap && before(x, list[list.length - 1]) >= 0) return;
  let i = list.length;
  while (i > 0 && before(x, list[i - 1]) < 0) i--;
  list.splice(i, 0, x);
  if (list.length > cap) list.pop();
}

function makeSelector(opts) {
  opts = opts || {};
  const perBand = opts.perBand || PER_BAND, perTheme = opts.perTheme || PER_THEME;
  // per band: { all: [...], th: { theme: [...] } }; "all" keeps enough
  // to fill the band whatever the theme picks took.
  const bands = BANDS.map(() => ({ all: [], th: {} }));
  return {
    add(line) {
      const c = candidate(line);
      if (!c) return false;
      const B = bands[c.b];
      keep(B.all, c, perBand + THEMES.length * perTheme);
      c.th.forEach((t) => {
        if (THEMES.indexOf(t) < 0) return;
        keep(B.th[t] || (B.th[t] = []), c, perTheme);
      });
      return true;
    },
    // → the chosen puzzles, by rating then id.
    result() {
      const out = [];
      bands.forEach((B) => {
        const got = {}, chosen = [];
        const take = (c) => { if (!got[c.id] && chosen.length < perBand) { got[c.id] = true; chosen.push(c); } };
        // round robin over the themes, so a full band still has each one
        for (let k = 0; k < perTheme; k++) THEMES.forEach((t) => { const l = B.th[t]; if (l && l[k]) take(l[k]); });
        B.all.forEach(take);
        chosen.forEach((c) => out.push(c));
      });
      return out.sort((a, b) => a.r - b.r || (a.id < b.id ? -1 : 1));
    }
  };
}

function csvOf(list) {
  return list.map((c) => [c.id, c.fen, c.moves, c.r, c.th.join(" ")].join(",")).join("\n");
}
function packFile(list, date) {
  return [
    "// orOS Chess — puzzle pack (generated by chess/tools/lichess-pack.js, do not edit by hand)",
    "// Cut from the Lichess puzzle database (CC0 1.0): " + SOURCE,
    "// Generated " + date + ": " + list.length + " puzzles, RatingDeviation < " + MIN.rd + ", Popularity >= " + MIN.pop +
      ", NbPlays >= " + MIN.plays + ", balanced over rating bands and themes.",
    "// One line per puzzle: id,FEN,moves,rating,themes (Lichess ids; the FEN is",
    "// before the opponent's move, the first move is the opponent's).",
    "(window.OrosChessPacks = window.OrosChessPacks || []).push({",
    "  id: \"lichess-1\",",
    "  name: \"Lichess\",",
    "  csv: " + JSON.stringify(csvOf(list)),
    "});",
    ""
  ].join("\n");
}
// The file without its date line, to see whether anything changed.
function body(text) { return String(text || "").split("\n").filter((l) => !/^\/\/ Generated /.test(l)).join("\n"); }

async function run(input, output) {
  const sel = makeSelector();
  const rl = readline.createInterface({ input: fs.createReadStream(input), crlfDelay: Infinity });
  let rows = 0, ok = 0;
  for await (const line of rl) { rows++; if (sel.add(line)) ok++; }
  const list = sel.result();
  if (!list.length) throw new Error("no puzzle selected from " + rows + " rows");
  const text = packFile(list, new Date().toISOString().slice(0, 10));
  let old = "";
  try { old = fs.readFileSync(output, "utf8"); } catch (e) {}
  const changed = body(old) !== body(text);
  if (changed) fs.writeFileSync(output, text);
  const per = BANDS.map((b, i) => b[0] + "+: " + list.filter((c) => c.b === i).length).join(", ");
  console.log(rows + " rows, " + ok + " candidates, " + list.length + " chosen (" + per + "); " + (changed ? "written " : "unchanged ") + output);
  return { rows, ok, list, changed };
}

if (require.main === module) {
  const input = process.argv[2];
  const output = process.argv[3] || path.join(__dirname, "..", "puzzles-lichess.js");
  if (!input) { console.error("usage: node chess/tools/lichess-pack.js <lichess_db_puzzle.csv> [out.js]"); process.exit(2); }
  run(input, output).catch((e) => { console.error(e.message || e); process.exit(1); });
}

module.exports = { hash, bandOf, candidate, makeSelector, csvOf, packFile, body, run, THEMES, BANDS, MIN, SOURCE };
