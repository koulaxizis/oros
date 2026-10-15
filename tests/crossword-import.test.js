// Crossword "Import a crossword" (crossword/import.js): Across Lite
// .puz (binary header, clue order, ISO-8859-1 text, rebus GRBS/RTBL,
// circles GEXT, scrambled refused) and .ipuz (numbers / blocks / null,
// { cell, style } squares, clue shapes, HTML in clues), the usual
// numbering, the canonical payload, the library join and apply / undo
// with newer-stamped tombstones, and the app's merge carrying it.
// Fixtures are built here from the documented shapes.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const I = require("../crossword/import.js");

const J = JSON.stringify;
const rnd = (n) => Math.floor(Math.random() * n);

// A 5×5 mini with four blocks:
//   H E A R T
//   E . R . O
//   A R E N A
//   R . A . S
//   T E A R S
// Usual numbering: 1 = H (across + down), 2 = col 2 (down), 3 = col 4
// (down), 4 = row 2 (across), 5 = row 4 (across).
const MINI = { w: 5, h: 5, rows: ["HEART", "E.R.O", "ARENA", "R.A.S", "TEARS"] };
const MINI_SLOTS = ["1A", "1D", "2D", "3D", "4A", "5A"];

// ---------- .puz writer (documented layout) ----------
function puzBytes(o) {
  const w = o.w, h = o.h, sol = o.rows.join("");
  const fill = sol.replace(/[^.]/g, "-");
  const strs = [o.title || "", o.author || "", o.copyright || ""].concat(o.clues).concat([o.notes || ""]);
  const parts = [];
  const head = Buffer.alloc(0x34);
  head.write("ACROSS&DOWN\0", 0x02, "latin1");
  head.write(o.version || "1.3\0", 0x18, "latin1");
  head[0x2C] = w; head[0x2D] = h;
  head.writeUInt16LE(o.clues.length, 0x2E);
  head.writeUInt16LE(1, 0x30);
  head.writeUInt16LE(o.scrambled ? 4 : 0, 0x32);
  parts.push(head, Buffer.from(sol, "latin1"), Buffer.from(fill, "latin1"));
  strs.forEach((s) => parts.push(Buffer.from(s, o.utf8 ? "utf8" : "latin1"), Buffer.from([0])));
  const section = (name, data) => {
    const hd = Buffer.alloc(8);
    hd.write(name, 0, "latin1");
    hd.writeUInt16LE(data.length, 4);
    parts.push(hd, data, Buffer.from([0]));
  };
  if (o.grbs) { section("GRBS", Buffer.from(o.grbs)); section("RTBL", Buffer.from(o.rtbl, "latin1")); }
  if (o.gext) section("GEXT", Buffer.from(o.gext));
  return new Uint8Array(Buffer.concat(parts));
}
// clues in .puz order: by number, across before down
function puzClues() {
  return MINI_SLOTS.map((k) => {
    return ({ "1A": "Organ that pumps", "1D": "Listen", "2D": "Region", "3D": "Rock group", "4A": "Stadium", "5A": "Crying drops" })[k];
  });
}

test("crossword import: numbering and slots", () => {
  const g = MINI.rows.join("");
  const sl = I.slotsOf(g, 5, 5);
  assert.equal(J(sl.map((x) => x.n + (x.d ? "D" : "A"))), J(MINI_SLOTS));
  assert.equal(J(sl.map((x) => x.len)), J([5, 5, 5, 5, 5, 5]));
});

test("crossword import: Across Lite .puz", () => {
  const bytes = puzBytes({ w: 5, h: 5, rows: MINI.rows, clues: puzClues(), title: "Mini Café", author: "A. Setter",
    copyright: "© 2026", notes: "Have fun" });
  assert.ok(I.isPuz(bytes));
  const r = I.parse({ name: "mini.puz", bytes });
  assert.equal(r.source, "puz");
  const z = r.z;
  assert.equal(z.w, 5);
  assert.equal(z.g, MINI.rows.join(""));
  assert.equal(z.lg, "en");
  assert.equal(J(z.ca), J(["Organ that pumps", "Stadium", "Crying drops"]));
  assert.equal(J(z.cd), J(["Listen", "Region", "Rock group"]));
  assert.equal(z.ti, "Mini Café");                 // ISO-8859-1 é
  assert.equal(z.cp, "© 2026");
  assert.equal(z.au, "A. Setter");
  assert.equal(z.nt, "Have fun");
  assert.equal(J(I.normPuzzle(z)), J(z));          // canonical
  // a byte of garbage before the header is tolerated
  const pre = new Uint8Array(bytes.length + 3);
  pre.set([1, 2, 3]); pre.set(bytes, 3);
  assert.equal(J(I.parse({ bytes: pre }).z), J(z));
  // version 2.0: UTF-8 strings
  const u = I.parse({ bytes: puzBytes({ w: 5, h: 5, rows: MINI.rows, clues: puzClues(), title: "Σταυρόλεξο", version: "2.0\0", utf8: true }) });
  assert.equal(u.z.ti, "Σταυρόλεξο");
  // scrambled → refused
  assert.equal(I.parse({ bytes: puzBytes({ w: 5, h: 5, rows: MINI.rows, clues: puzClues(), scrambled: true }) }).error, "scrambled");
  // wrong clue count
  assert.equal(I.parse({ bytes: puzBytes({ w: 5, h: 5, rows: MINI.rows, clues: puzClues().slice(1) }) }).error, "clues");
  // no solution (all unknown)
  assert.equal(I.parse({ bytes: puzBytes({ w: 5, h: 5, rows: MINI.rows.map((x) => x.replace(/[A-Z]/g, "-")), clues: puzClues() }) }).error, "nosol");
  // not a crossword file at all
  assert.equal(I.parse({ bytes: new Uint8Array(Buffer.from("hello")) }).error, "unknown");
});

test("crossword import: .puz rebus and circles", () => {
  const n = 25, grbs = new Array(n).fill(0), gext = new Array(n).fill(0);
  grbs[0] = 2;                                     // H → RTBL key 1 = "HE"
  gext[12] = 0x80; gext[6] = 0x80;                 // 6 is a block: dropped
  const r = I.parse({ bytes: puzBytes({ w: 5, h: 5, rows: MINI.rows, clues: puzClues(), grbs, rtbl: " 1:HE; 0:XX;", gext }) });
  assert.equal(J(r.z.rb), J([[0, "HE"]]));
  assert.equal(r.z.g[0], "H");
  assert.equal(J(r.z.ci), J([12]));
  assert.equal(r.info.rebus, 1);
});

test("crossword import: .ipuz", () => {
  const P = MINI.rows.map((row, r) => row.split("").map((ch, c) => (ch === "." ? "#" : 0)));
  // numbers on the starting squares, a circle as { cell, style }
  P[0][0] = 1; P[0][2] = 2; P[0][4] = 3; P[2][0] = 4; P[4][0] = 5;
  P[2][2] = { cell: 0, style: { shapebg: "circle" } };
  const S = MINI.rows.map((row) => row.split("").map((ch) => (ch === "." ? "#" : ch)));
  S[4][4] = { value: "s" };                        // lower case in an object
  const doc = {
    version: "http://ipuz.org/v2", kind: ["http://ipuz.org/crossword#1"],
    dimensions: { width: 5, height: 5 }, puzzle: P, solution: S,
    title: "<b>Mini</b> &amp; more", author: "Setter", copyright: "&copy; 2026", notes: "Line one<br>line two",
    clues: {
      "Across": [[1, "Organ that <i>pumps</i>"], { number: 4, clue: "Stadium" }, [5, "Crying&nbsp;drops"]],
      "Down:Down": [[1, "Listen"], [2, "Region &amp; zone"], { number: "3", clue: "Rock &#8220;group&#8221;" }]
    }
  };
  const r = I.parse({ name: "mini.ipuz", bytes: new Uint8Array(Buffer.from(J(doc))) });
  assert.equal(r.source, "ipuz");
  const z = r.z;
  assert.equal(z.g, MINI.rows.join(""));
  assert.equal(z.ti, "Mini & more");
  assert.equal(z.cp, "© 2026");
  assert.equal(z.nt, "Line one\nline two");
  assert.equal(J(z.ca), J(["Organ that pumps", "Stadium", "Crying drops"]));
  assert.equal(J(z.cd), J(["Listen", "Region & zone", "Rock “group”"]));
  assert.equal(J(z.ci), J([12]));
  // JSONP wrapper, missing clue → "", omitted squares (null) are blocks
  const d2 = JSON.parse(J(doc));
  d2.clues.Across = d2.clues.Across.slice(0, 2);
  d2.puzzle[1][1] = null; d2.solution[1][1] = null;
  const r2 = I.parse({ bytes: new Uint8Array(Buffer.from("ipuz(" + J(d2) + ")")) });
  assert.equal(r2.z.ca[2], "");
  // a rebus square in ipuz
  const d3 = JSON.parse(J(doc));
  d3.solution[0][0] = "HE";
  assert.equal(J(I.parse({ bytes: new Uint8Array(Buffer.from(J(d3))) }).z.rb), J([[0, "HE"]]));
  // HTML never survives into text
  const d4 = JSON.parse(J(doc));
  d4.clues.Across[0] = [1, "<img src=x onerror=alert(1)>Heart<script>x</script>"];
  assert.equal(I.parse({ bytes: new Uint8Array(Buffer.from(J(d4))) }).z.ca[0], "Heartx");
  // Greek ipuz: accents dropped, final sigma as Σ, lg el
  const d5 = JSON.parse(J(doc));
  d5.solution = [["Ά", "Ν", "Θ", "Ο", "Σ"], ["#", "#", "#", "#", "#"], ["#", "#", "#", "#", "#"], ["#", "#", "#", "#", "#"], ["#", "#", "#", "#", "#"]];
  d5.puzzle = [[1, 0, 0, 0, 0], ["#", "#", "#", "#", "#"], ["#", "#", "#", "#", "#"], ["#", "#", "#", "#", "#"], ["#", "#", "#", "#", "#"]];
  d5.clues = { Across: [[1, "Λουλούδι"]], Down: [] };
  const g5 = I.parse({ bytes: new Uint8Array(Buffer.from(J(d5))) }).z;
  assert.equal(g5.g.slice(0, 5), "ΑΝΘΟΣ");
  assert.equal(g5.lg, "el");
  // not a crossword / no solution / bad size
  assert.equal(I.parse({ bytes: new Uint8Array(Buffer.from(J(Object.assign({}, doc, { kind: ["http://ipuz.org/sudoku#1"] })))) }).error, "kind");
  assert.equal(I.parse({ bytes: new Uint8Array(Buffer.from(J(Object.assign({}, doc, { solution: undefined })))) }).error, "nosol");
  assert.equal(I.parse({ bytes: new Uint8Array(Buffer.from(J(Object.assign({}, doc, { dimensions: { width: 99, height: 5 } })))) }).error, "size");
});

test("crossword import: normPuzzle rejects bad payloads", () => {
  const z = I.parse({ bytes: puzBytes({ w: 5, h: 5, rows: MINI.rows, clues: puzClues() }) }).z;
  const bad = (patch) => assert.equal(I.normPuzzle(Object.assign({}, z, patch)), null, J(patch));
  bad({ w: 4 });
  bad({ g: z.g.slice(1) + "A" });                  // shape no longer matches the clue counts? (loner)
  bad({ ca: z.ca.slice(1) });
  bad({ lg: "el" });
  bad({ ci: [6] });                                // a block
  bad({ ci: [12, 12] });
  bad({ rb: [[0, "XE"]] });                         // first letter differs
  bad({ rb: [[0, "H"]] });                          // not a rebus
  bad({ g: z.g.replace("H", " ") });
  assert.equal(I.normPuzzle(null), null);
});

test("crossword import: library apply / undo / re-import / solved", () => {
  const z = I.parse({ bytes: puzBytes({ w: 5, h: 5, rows: MINI.rows, clues: puzClues(), title: "Mini" }) }).z;
  const a = I.apply(null, z, 1000);
  assert.ok(a.added);
  assert.ok(/^imp-[a-z0-9]+$/.test(a.id));
  assert.equal(I.list(a.lib).length, 1);
  assert.equal(I.list(a.lib)[0].z.ti, "Mini");
  // the same file again: nothing new
  const a2 = I.apply(a.lib, z, 1100);
  assert.ok(!a2.added);
  assert.equal(J(a2.lib), J(a.lib));
  // undo: a tombstone without the payload; a device that still has it cannot bring it back
  const u = I.undo(a.lib, a.undo, 1200);
  assert.equal(I.list(u).length, 0);
  assert.equal(I.list(I.mergeLib(u, a.lib)).length, 0);
  assert.equal(I.list(I.undo(a.lib, a.undo, 10)).length, 0);   // clock skew
  // re-import brings it back
  const b = I.apply(I.mergeLib(u, a.lib), z, 1300);
  assert.ok(b.added);
  assert.equal(I.list(b.lib).length, 1);
  // solved: best time without reveals
  let lib = I.solved(b.lib, b.id, 300, false, 1400);
  lib = I.solved(lib, b.id, 200, true, 1500);
  assert.equal(lib[b.id].t, 300);
  assert.equal(lib[b.id].s, 1500);
  // the cap
  let big = null;
  for (let i = 0; i < I.MAX_LIB; i++) big = I.apply(big, Object.assign({}, z, { ti: "P" + i }), 2000 + i).lib;
  assert.equal(I.list(big).length, I.MAX_LIB);
  const over = I.apply(big, Object.assign({}, z, { ti: "one more" }), 9000);
  assert.ok(over.full && !over.added);
  // input never mutated
  const s0 = J(a.lib);
  I.apply(a.lib, Object.assign({}, z, { ti: "x" }), 5);
  I.undo(a.lib, a.undo, 6);
  assert.equal(J(a.lib), s0);
});

test("crossword import: the library merge is a join", () => {
  const base = I.parse({ bytes: puzBytes({ w: 5, h: 5, rows: MINI.rows, clues: puzClues() }) }).z;
  const zs = [0, 1, 2].map((i) => Object.assign({}, base, { ti: "T" + i }));
  const st = () => {
    const m = {};
    for (let i = 0; i < rnd(4); i++) {
      const z = zs[rnd(3)], e = { b: 1 + rnd(4) * 10, x: rnd(3) * 10, s: rnd(3) * 7, t: rnd(3) * 100 };
      if (rnd(3)) e.z = z;
      m[I.idOf(z)] = e;
    }
    return m;
  };
  for (let i = 0; i < 2000; i++) {
    const a = st(), b = st(), c = st(), sa = J(a);
    assert.equal(J(I.mergeLib(a, b)), J(I.mergeLib(b, a)));
    const m = I.mergeLib(a, b);
    assert.equal(J(I.mergeLib(m, m)), J(m));
    assert.equal(J(I.mergeLib(I.mergeLib(a, b), c)), J(I.mergeLib(a, I.mergeLib(b, c))));
    assert.equal(J(a), sa);
  }
  // a payload whose hash does not match its id is dropped
  const id = I.idOf(zs[0]);
  assert.equal(I.mergeLib({ [id]: { b: 5, x: 0, s: 0, t: 0, z: zs[1] } }, null)[id].z, undefined);
  assert.equal(I.mergeLib({ "bad id": { b: 5, z: zs[0] } }, null), null);
});

test("crossword: the app's merge carries the library", () => {
  const SRC = fs.readFileSync(path.join(__dirname, "..", "crossword/crossword.js"), "utf8");
  const cut = (name) => { const i = SRC.indexOf("  function " + name + "("); return SRC.slice(i, SRC.indexOf("\n  }\n", i) + 4); };
  const head = SRC.slice(SRC.indexOf("  var DATA_VER"), SRC.indexOf("  // ---------- 1."));
  const src = head + ["cmpStr", "normDayRes", "dayKeyOk", "betterDay", "statKeyOk", "joinStat", "normRow", "joinRows",
    "mergeCW", "libJoin"].map(cut).join("\n") + "\nreturn mergeCW;";
  const M = new Function("window", src)({ OrosCrosswordImport: I });
  assert.equal(J(M(null, null)), J({ ver: 1, br: 0, days: {}, rows: {} }));
  const z = I.parse({ bytes: puzBytes({ w: 5, h: 5, rows: MINI.rows, clues: puzClues() }) }).z;
  const lib = I.apply(null, z, 5).lib;
  const m = M({ lib }, { br: 77 });
  assert.equal(J(m.lib), J(lib));                  // a reset of the records keeps the puzzles
  assert.equal(J(M(m, m)), J(m));
  const M0 = new Function("window", src)({});
  assert.equal(J(M0({ lib }, null).lib), J(lib));  // module missing: carried, not dropped
});
