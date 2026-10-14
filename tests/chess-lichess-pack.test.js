// Chess: the Lichess puzzle pack generator (chess/tools/lichess-pack.js)
// on a small fixture in the Lichess CSV layout, and the shipped
// chess/puzzles-lichess.js (placeholder or generated) loading with
// train.js parsePack.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const G = require("../chess/tools/lichess-pack.js");
const T = require("../chess/train.js");
const ROOT = path.join(__dirname, "..");
const FIX = path.join(__dirname, "fixtures", "lichess-puzzles.csv");
const SRC = fs.readFileSync(path.join(ROOT, "chess/chess.js"), "utf8");
const E = (() => {
  const i = SRC.indexOf("  function makeEngine(");
  return new Function(SRC.slice(i, SRC.indexOf("\n  }\n", i) + 4) + "\nreturn makeEngine();")();
})();
function packsOf(text) {
  const win = {};
  new Function("window", "self", text)(win, win);
  return win.OrosChessPacks || [];
}
function fixtureLines() { return fs.readFileSync(FIX, "utf8").split("\n").filter(Boolean); }
function select(lines, opts) {
  const s = G.makeSelector(opts);
  lines.forEach((l) => s.add(l));
  return s.result();
}

test("lichess pack: filters on deviation, popularity, plays and the loader's checks", () => {
  const ok = "Ab123,6k1/5ppp/8/8/8/8/5PPP/3R2K1 b - - 0 1,g8f8 d1d8,900,75,90,1500,mate mateIn1 backRankMate,https://lichess.org/x,";
  assert.ok(G.candidate(ok));
  assert.equal(G.candidate(ok.replace(",75,", ",90,")), null, "RatingDeviation must be < 90");
  assert.equal(G.candidate(ok.replace(",90,1500,", ",84,1500,")), null, "Popularity >= 85");
  assert.equal(G.candidate(ok.replace(",1500,", ",999,")), null, "NbPlays >= 1000");
  assert.equal(G.candidate(ok.replace(",900,", ",350,")), null, "below the first band");
  assert.equal(G.candidate(ok.replace("g8f8 d1d8", "g8f8 d1d8 f8e7")), null, "the line must end with your move");
  assert.equal(G.candidate("PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags"), null);
  assert.equal(G.candidate(ok.replace("Ab123", "bad id!")), null, "train.js parseLine rules apply");
  assert.equal(G.bandOf(400), 0);
  assert.equal(G.bandOf(1199), 1);
  assert.equal(G.bandOf(3100), 5);
  assert.equal(G.hash("00sHx"), G.hash("00sHx"));
  assert.notEqual(G.hash("00sHx"), G.hash("00sHy"));
});

test("lichess pack: deterministic, whatever the input order", () => {
  const lines = fixtureLines();
  const a = select(lines).map((c) => c.id);
  const shuffled = lines.slice(1).reverse();
  shuffled.splice(10, 0, lines[0]);
  assert.deepEqual(select(shuffled).map((c) => c.id), a);
  assert.ok(a.length > 30, "most of the fixture passes: " + a.length);
  assert.equal(new Set(a).size, a.length, "ids unique");
  assert.ok(!a.includes("Fx001") && !a.includes("Fx004") && !a.includes("Fx007"), "filtered rows left out");
});

test("lichess pack: every band filled, each theme kept in each band where it exists", () => {
  const lines = fixtureLines();
  // a tight quota: 3 per band, 1 per theme
  const out = select(lines, { perBand: 3, perTheme: 1 });
  const byBand = G.BANDS.map((_, i) => out.filter((c) => c.b === i));
  byBand.forEach((l, i) => assert.ok(l.length > 0 && l.length <= 3, "band " + i + ": " + l.length));
  // with room for everything, every (band, theme) pair of the input appears
  const all = select(lines, { perBand: 100, perTheme: 2 });
  const want = {}, got = {};
  lines.map(G.candidate).filter(Boolean).forEach((c) => c.th.forEach((t) => { if (G.THEMES.includes(t)) want[c.b + ":" + t] = true; }));
  all.forEach((c) => c.th.forEach((t) => { got[c.b + ":" + t] = true; }));
  Object.keys(want).forEach((k) => assert.ok(got[k], "band:theme " + k));
  // sorted by rating
  for (let i = 1; i < all.length; i++) assert.ok(all[i - 1].r <= all[i].r);
  // a theme the trainer names gets a puzzle first: rare themes survive a full band
  const rare = lines.map(G.candidate).filter((c) => c && c.b === 1 && c.th.includes("fork"));
  if (rare.length) assert.ok(select(lines, { perBand: 2, perTheme: 1 }).some((c) => c.b === 1 && c.th.includes("fork")));
});

test("lichess pack: THEMES are the trainer's named themes (chess.js th.*)", () => {
  const en = SRC.slice(SRC.indexOf('"th.mate"'), SRC.indexOf('"cc.note"'));
  const keys = [...en.matchAll(/"th\.([A-Za-z0-9]+)"/g)].map((m) => m[1])
    .filter((k) => !/^(short|long|veryLong|oneMove)$/.test(k));
  assert.deepEqual(keys.slice().sort(), G.THEMES.slice().sort());
});

test("lichess pack: the generated file loads with parsePack, five columns, Lichess ids", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oros-lichess-"));
  const out = path.join(dir, "puzzles-lichess.js");
  const r1 = await G.run(FIX, out);
  assert.ok(r1.changed);
  const text = fs.readFileSync(out, "utf8");
  assert.match(text, /Lichess puzzle database \(CC0 1\.0\): https:\/\/database\.lichess\.org\/#puzzles/);
  assert.match(text, /^\/\/ Generated \d{4}-\d{2}-\d{2}: /m);
  const packs = packsOf(text);
  assert.equal(packs.length, 1);
  assert.equal(packs[0].id, "lichess-1");
  assert.equal(packs[0].name, "Lichess");
  const rows = packs[0].csv.split("\n");
  rows.forEach((l) => assert.equal(l.split(",").length, 5, l));
  const list = T.parsePack(packs[0].csv);
  assert.equal(list.length, r1.list.length);
  list.forEach((p) => {
    assert.match(p.id, /^Fx\d{3}$/, "the Lichess id is kept");
    assert.ok(T.checkPuzzle(E, p), "legal: " + p.id);
  });
  // a second run on the same input leaves the file alone (only the date would differ)
  const r2 = await G.run(FIX, out);
  assert.equal(r2.changed, false);
  assert.equal(G.body(text.replace(/Generated \d{4}-\d{2}-\d{2}/, "Generated 1999-01-01")), G.body(text));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("lichess pack: the shipped chess/puzzles-lichess.js loads (placeholder or generated)", () => {
  const text = fs.readFileSync(path.join(ROOT, "chess/puzzles-lichess.js"), "utf8");
  assert.match(text, /Lichess puzzle database \(CC0/);
  const packs = packsOf(text);
  assert.ok(packs.length <= 1);
  if (!packs.length) return;                     // the placeholder pushes nothing
  assert.equal(packs[0].id, "lichess-1");
  const list = T.parsePack(packs[0].csv);
  assert.ok(list.length >= 1000, "a generated pack is large: " + list.length);
  // ids never clash with the orOS pack
  const or = {};
  packsOf(fs.readFileSync(path.join(ROOT, "chess/puzzles-pack.js"), "utf8")).forEach((pk) => T.parsePack(pk.csv).forEach((p) => { or[p.id] = 1; }));
  list.forEach((p) => assert.ok(!or[p.id], "id clash: " + p.id));
  list.slice(0, 300).forEach((p) => assert.ok(T.checkPuzzle(E, p), "legal: " + p.id));
});

test("chess: the trainer loads both packs and merges them by id", () => {
  const i = SRC.indexOf("  var TR_PACK_FILES");
  const j = SRC.indexOf("\n  }\n", SRC.indexOf("  function trPacks(", i)) + 4;
  const make = new Function("TR", "TRAIN", "E", "window", "trLoad", SRC.slice(i, j) + "\nreturn trPacks;");
  const or = fs.readFileSync(path.join(ROOT, "chess/puzzles-pack.js"), "utf8");
  const sample = G.packFile(select(fixtureLines()), "2026-01-01");
  const run = (files) => {
    const win = {}, TR = { packs: null, byId: {} }, asked = [];
    const trLoad = (f, cb) => { asked.push(f); if (files[f] !== undefined) new Function("window", files[f])(win); cb(files[f] !== undefined); };
    let ok;
    make(TR, T, E, win, trLoad)((v) => { ok = v; });
    return { ok, TR, asked };
  };
  // placeholder: only the orOS pack
  const a = run({ "puzzles-lichess.js": fs.readFileSync(path.join(ROOT, "chess/puzzles-lichess.js"), "utf8"), "puzzles-pack.js": or });
  assert.deepEqual(a.asked.slice().sort(), ["puzzles-lichess.js", "puzzles-pack.js"]);
  assert.ok(a.ok);
  assert.ok(a.TR.src.oros >= 100);
  // a generated pack, missing file, and a pack loaded twice (no duplicate ids)
  const b = run({ "puzzles-lichess.js": sample + sample, "puzzles-pack.js": or });
  assert.equal(b.TR.src.lichess, select(fixtureLines()).length);
  assert.equal(b.TR.src.oros, a.TR.src.oros);
  assert.equal(new Set(b.TR.packs.map((p) => p.id)).size, b.TR.packs.length);
  const c = run({ "puzzles-pack.js": or });
  assert.ok(c.ok && c.TR.src.lichess === 0, "a missing Lichess file is not an error");
});
