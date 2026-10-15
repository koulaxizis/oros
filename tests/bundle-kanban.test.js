// Kanban .orosboard bundle (kanban/tools.js packBoard / parsePackage /
// boardMd, written and read by bundle.js): one board with its card
// attachments in media/, opened again as a NEW board with fresh ids.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const B = require(path.join(__dirname, "..", "bundle.js"));
const M = require(path.join(__dirname, "..", "kanban/model.js"));
const T = require(path.join(__dirname, "..", "kanban/tools.js"));

const NOW = new Date(2026, 9, 15, 10, 0, 0).getTime();
const MIME = "application/x-oros-board";
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]);
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 9, 9]);

function board() {
  return {
    id: "b1", name: "Σπίτι / home", mtime: NOW - 5, om: NOW - 5, color: "#4fc4cf", deleted: { gone: NOW },
    labels: [{ id: "L1", name: "Bug", color: "#e06c75", mtime: 1, pos: 0 },
             { id: "OD", name: "Overdue", color: "#e06c75", auto: "overdue", mtime: 1, pos: 1 }],
    columns: [
      { id: "c1", name: "To do", mtime: 1, om: 1, pos: 0, wip: 4, auto: { top: true, label: "L1" }, cards: [
        { id: "k1", text: "Fix the tap", notes: "Kitchen\nsecond line", due: "2026-10-20", labels: ["L1"], lane: "Team A",
          subtasks: [{ id: "s1", text: "Buy washer", completed: true }, { id: "s2", text: "Call", completed: false }],
          info: [{ id: "i1", label: "Owner", value: "Ann" }],
          att: [{ id: "a1", name: "photo.jpg", file: "abc123.jpg", kind: "img", size: JPG.length },
                { id: "a2", name: "manual.pdf", file: "def456.pdf", kind: "pdf", size: PDF.length },
                { id: "a3", name: "lost.txt", file: "lost99.txt", kind: "file", size: 3 }],
          cover: "a:a1", mtime: 1, pos: 0, fm: M.freshFm(1) }
      ] },
      { id: "c2", name: "Done", mtime: 1, om: 1, pos: 1, cards: [] }
    ]
  };
}
// what kanban.js exportOros does, without the disk
async function pack(b) {
  const disk = { "abc123.jpg": JPG, "def456.pdf": PDF };
  const keys = {}, media = {};
  for (const f of Object.keys(disk)) {
    const k = (await B.sha256(disk[f])) + "." + f.split(".").pop();
    keys[f] = k; media[k] = disk[f];
  }
  return B.write({
    mime: MIME, app: "kanban", schema: "kanban/1", content: T.packBoard(b, keys),
    meta: { title: b.name, modified: b.mtime, id: b.id, language: "el", generator: "orOS Kanban" },
    media, preview: [{ name: "board.md", data: T.boardMd(b, {}), type: "text/markdown" }], date: new Date(NOW)
  });
}

test("packBoard: media keys for attachment files, no tombstones, the source untouched", async () => {
  const b = board();
  const c = T.packBoard(b, { "abc123.jpg": "f".repeat(64) + ".jpg" });
  assert.equal(c.kind, "oros-kanban-package");
  assert.equal(c.ver, 1);
  assert.equal(c.board.deleted, undefined);
  const att = c.board.columns[0].cards[0].att;
  assert.equal(att[0].file, "f".repeat(64) + ".jpg");
  assert.equal(att[1].file, "def456.pdf", "a file with no key keeps its name");
  assert.equal(b.columns[0].cards[0].att[0].file, "abc123.jpg");
  assert.ok(b.deleted.gone);
  assert.ok(T.isPackage(c));
  assert.ok(!T.isPackage({ kind: "oros-kanban-package", board: { columns: "x" } }));
  assert.ok(!T.isPackage({ app: "oros-kanban", board: { columns: [] } }));
});

test("save → open: a new board with fresh ids, every field, attachments with their bytes", async () => {
  const bytes = await pack(board());
  assert.equal(B.sniff(bytes.subarray(0, 128)), MIME);
  const r = await B.read(bytes, { mime: MIME });
  assert.equal(r.app, "kanban");
  assert.equal(r.meta.title, "Σπίτι / home");
  assert.equal(Object.keys(r.media).length, 2);
  const got = T.parsePackage(r.content, r.media, T.counter(), NOW);
  const nb = got.board, nk = nb.columns[0].cards[0];
  assert.notEqual(nb.id, "b1");
  assert.equal(nb.name, "Σπίτι / home");
  assert.equal(nb.color, "#4fc4cf");
  assert.equal(nb.columns[0].wip, 4);
  const L1 = nb.labels.find((l) => l.name === "Bug").id;
  assert.deepEqual(nb.columns[0].auto, { top: true, label: L1 });
  assert.equal(nb.labels.find((l) => l.name === "Overdue").auto, "overdue");
  assert.equal(nk.text, "Fix the tap");
  assert.equal(nk.notes, "Kitchen\nsecond line");
  assert.equal(nk.due, "2026-10-20");
  assert.equal(nk.lane, "Team A");
  assert.deepEqual(nk.labels, [L1]);
  assert.deepEqual(nk.subtasks.map((s) => [s.text, s.completed]), [["Buy washer", true], ["Call", false]]);
  assert.deepEqual(nk.info.map((f) => [f.label, f.value]), [["Owner", "Ann"]]);
  assert.equal(nk.att.length, 3);
  assert.equal(nk.cover, "a:" + nk.att[0].id);
  assert.ok(nk.att.every((x) => T.FILE_RE.test(x.file) && !/^[0-9a-f]{64}\./.test(x.file)), "fresh disk names");
  assert.equal(got.files.length, 2, "the attachment that had no bytes stays without a file");
  const byFile = Object.fromEntries(got.files.map((f) => [f.file, f.bytes]));
  assert.deepEqual(Array.from(byFile[nk.att[0].file]), Array.from(JPG));
  assert.deepEqual(Array.from(byFile[nk.att[1].file]), Array.from(PDF));
  assert.ok(M.fmValid(nk));
  // twice → two different boards
  const again = T.parsePackage(r.content, r.media, T.counter(), NOW);
  assert.equal(again.board.columns[0].cards[0].text, "Fix the tap");
  assert.equal(T.parsePackage({ kind: "other" }, r.media, T.counter(), NOW), null);
});

test("unzipped folder with an attachment swapped by hand: the card follows the new bytes", async () => {
  const bytes = await pack(board());
  const r0 = await B.read(bytes, { mime: MIME });
  const list = [
    { path: "Board/mimetype", bytes: new TextEncoder().encode(MIME) },
    { path: "Board/content.json", bytes: new TextEncoder().encode(JSON.stringify(r0.content)) }
  ];
  const NEW = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 42, 42, 42]);
  for (const k of Object.keys(r0.media)) list.push({ path: "Board/media/" + k, bytes: /\.jpg$/.test(k) ? NEW : r0.media[k].bytes });
  const r = await B.readFolder(list, { mime: MIME });
  assert.equal(Object.keys(r.rekeyed).length, 1);
  const got = T.parsePackage(r.content, r.media, T.counter(), NOW);
  const nk = got.board.columns[0].cards[0];
  const byFile = Object.fromEntries(got.files.map((f) => [f.file, f.bytes]));
  assert.deepEqual(Array.from(byFile[nk.att[0].file]), Array.from(NEW));
  assert.equal(nk.cover, "a:" + nk.att[0].id);
});

test("hostile content is cleaned like any import", async () => {
  const c = T.packBoard(board(), {});
  const k = c.board.columns[0].cards[0];
  k.text = "<img src=x onerror=alert(1)>".repeat(100);
  k.att.push({ id: "z", name: "x", file: "../../etc/passwd", kind: "file", size: 1 });
  k.due = "tomorrow";
  c.board.columns[0].wip = 99999;
  const got = T.parsePackage(c, { "../../etc/passwd": { bytes: new Uint8Array(1) } }, T.counter(), NOW);
  const nk = got.board.columns[0].cards[0];
  assert.equal(nk.text.length, 500, "capped, kept as text");
  assert.equal(nk.due, null);
  assert.equal(got.board.columns[0].wip, undefined);
  assert.ok(nk.att.every((x) => T.FILE_RE.test(x.file)));
  assert.equal(got.files.length, 0);
});

test("board.md: columns as headings, cards with their details", () => {
  const md = T.boardMd(board(), { due: "Προθεσμία", labels: "Ετικέτες" });
  assert.match(md, /^# Σπίτι \/ home\n/);
  assert.match(md, /\n## To do\n/);
  assert.match(md, /\n- \*\*Fix the tap\*\*\n {2}Προθεσμία: 2026-10-20 · Ετικέτες: Bug · Lane: Team A\n/);
  assert.match(md, /\n {2}- \[x\] Buy washer\n {2}- \[ \] Call\n/);
  assert.match(md, /\n {2}- Owner: Ann\n/);
  assert.match(md, /\n {2}- Attachments: photo.jpg, manual.pdf, lost.txt\n/);
  assert.match(md, /\n {2}> Kitchen\n {2}> second line\n/);
  assert.match(md, /\n## Done\n/);
});
