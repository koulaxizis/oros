// Assistant: files and folders of the orOS disk ("Assistant everywhere"
// wave 6, AS-FILES, assistant/fileops.js): rename, move, new folder and
// delete to Files' Trash, on a fake disk. Nothing is overwritten, every
// step re-checks the item, app folders / Trash / orOS Drive are refused,
// and Undo only moves back what is still where it was put.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const F = require("../assistant/fileops.js");
const E = require("../assistant/edits.js");
const FC = require("../files/files-core.js");

const NOW = 1790000000000;
function disk(init) {
  const files = new Map(), dirs = new Set(["/internal"]);
  let t = 1000;
  function mkdirp(p) { const s = p.split("/"); for (let i = 2; i <= s.length; i++) dirs.add(s.slice(0, i).join("/")); }
  Object.keys(init).forEach((p) => { if (init[p] === null) mkdirp(p); else { mkdirp(p.slice(0, p.lastIndexOf("/"))); files.set(p, { text: init[p], mtime: t++ }); } });
  const fs = {
    stat: async (p) => files.has(p) ? { dir: false, size: files.get(p).text.length, mtime: files.get(p).mtime } : dirs.has(p) ? { dir: true, size: 0, mtime: null } : Promise.reject(Object.assign(new Error("x"), { code: "ENOENT" })),
    ls: async (p) => {
      if (!dirs.has(p)) throw Object.assign(new Error("x"), { code: "ENOENT" });
      const out = new Map();
      [...files.keys(), ...dirs].forEach((q) => { if (q.startsWith(p + "/")) { const n = q.slice(p.length + 1).split("/")[0]; out.set(n, { name: n, dir: dirs.has(p + "/" + n) }); } });
      return [...out.values()];
    },
    mkdir: async (p) => mkdirp(p),
    writeText: async (p, s) => { mkdirp(p.slice(0, p.lastIndexOf("/"))); files.set(p, { text: s, mtime: t++ }); },
    rm: async (p) => { [...files.keys()].forEach((q) => { if (q === p || q.startsWith(p + "/")) files.delete(q); }); [...dirs].forEach((q) => { if (q === p || q.startsWith(p + "/")) dirs.delete(q); }); },
    mv: async (a, b) => {
      if (b === a || b.startsWith(a + "/")) throw new Error("EINVAL");
      mkdirp(b.slice(0, b.lastIndexOf("/")));
      if (files.has(a)) { files.set(b, { text: files.get(a).text, mtime: t++ }); files.delete(a); return; }
      if (!dirs.has(a)) throw Object.assign(new Error("x"), { code: "ENOENT" });
      [...files.keys()].forEach((q) => { if (q.startsWith(a + "/")) { files.set(b + q.slice(a.length), files.get(q)); files.delete(q); } });
      [...dirs].forEach((q) => { if (q === a || q.startsWith(a + "/")) { dirs.delete(q); dirs.add(b + q.slice(a.length)); } });
    },
    files, dirs
  };
  return fs;
}
function ch(args) { const r = E.normArgs(Object.assign({ ref: "r1" }, args)); assert.equal(r.ok, true, r.err); return r; }
async function planOn(fs, paths, args) {
  const c = ch(args), l = await F.load(fs, paths, c);
  return F.plan(l.items, c, l.taken, NOW, () => "abcdef12");
}

test("rename keeps the extension, refuses a taken name, and undo puts it back", async () => {
  const fs = disk({ "/internal/Docs/report.pdf": "pdf", "/internal/Docs/old.pdf": "x" });
  const p = await planOn(fs, ["/internal/Docs/report.pdf"], { action: "update", title: "Report March" });
  assert.equal(p.ok, true, p.err);
  assert.equal(p.steps[0].to, "/internal/Docs/Report March.pdf");
  assert.deepEqual(p.cards[0].rows, [{ f: "title", b: "report.pdf", a: "Report March.pdf" }]);
  assert.match((await planOn(fs, ["/internal/Docs/report.pdf"], { action: "update", title: "old" })).err, /already has "old.pdf"/);
  const r = await F.run(fs, p.steps);
  assert.equal(r.fail, "");
  assert.ok(fs.files.has("/internal/Docs/Report March.pdf") && !fs.files.has("/internal/Docs/report.pdf"));
  const u = await F.undo(fs, r.done);
  assert.equal(u.ok, true, u.err);
  assert.ok(fs.files.has("/internal/Docs/report.pdf"));
});

test("move many into a folder that is made, nothing overwritten, a changed file stops the rest", async () => {
  const fs = disk({ "/internal/Pictures/a.jpg": "a", "/internal/Pictures/b.jpg": "bb", "/internal/Pictures/2024/c.jpg": "c" });
  const p = await planOn(fs, ["/internal/Pictures/a.jpg", "/internal/Pictures/b.jpg"], { action: "move", folder: "Pictures › Trips" });
  assert.equal(p.ok, true, p.err);
  assert.deepEqual(p.steps.map((s) => s.to), ["/internal/Pictures/Trips/a.jpg", "/internal/Pictures/Trips/b.jpg"]);
  // b.jpg changes between the card and Apply: a.jpg goes, b.jpg stays, the rest stops
  await fs.writeText("/internal/Pictures/b.jpg", "changed");
  const r = await F.run(fs, p.steps);
  assert.match(r.fail, /b\.jpg" changed or moved since/);
  assert.equal(r.done.length, 1);
  assert.ok(fs.files.has("/internal/Pictures/Trips/a.jpg") && fs.files.has("/internal/Pictures/b.jpg"));
  // a taken name at the destination is refused at planning
  await fs.writeText("/internal/Pictures/2024/a.jpg", "other");
  const q = await planOn(fs, ["/internal/Pictures/Trips/a.jpg"], { action: "move", folder: "/internal/Pictures/2024" });
  assert.match(q.err, /already has "a.jpg"/);
  // a folder into itself
  assert.match((await planOn(fs, ["/internal/Pictures/2024"], { action: "move", folder: "Pictures/2024/x" })).err, /inside itself/);
});

test("delete moves to Files' Trash exactly as Files does; undo restores it", async () => {
  const fs = disk({ "/internal/Docs/notes.txt": "hello" });
  const p = await planOn(fs, ["/internal/Docs/notes.txt"], { action: "delete" });
  assert.equal(p.ok, true, p.err);
  assert.equal(p.del, true);
  const r = await F.run(fs, p.steps);
  assert.equal(r.fail, "");
  const id = p.steps[0].id;
  assert.ok(/^[0-9a-z]{9}-[0-9a-z]{8}$/.test(id));
  assert.equal(FC.idTime(id), NOW);
  assert.ok(fs.files.has("/internal/.trash/" + id + "/notes.txt"));
  const meta = FC.normMeta(JSON.parse(fs.files.get("/internal/.trash/" + id + ".json").text), id);
  assert.equal(meta.path, "/internal/Docs/notes.txt");
  assert.equal(FC.trashListing(await fs.ls("/internal/.trash")).ids.length, 1);
  const u = await F.undo(fs, r.done);
  assert.equal(u.ok, true, u.err);
  assert.ok(fs.files.has("/internal/Docs/notes.txt"));
  assert.ok(!fs.files.has("/internal/.trash/" + id + ".json"));
});

test("new folder inside a folder; undo removes it only while empty", async () => {
  const fs = disk({ "/internal/Docs/x.txt": "x" });
  const p = await planOn(fs, ["/internal/Docs"], { action: "update", new_folder: "Taxes 2026" });
  assert.equal(p.ok, true, p.err);
  const r = await F.run(fs, p.steps);
  assert.ok(fs.dirs.has("/internal/Docs/Taxes 2026"));
  await fs.writeText("/internal/Docs/Taxes 2026/a.pdf", "a");
  assert.match((await F.undo(fs, r.done)).err, /not empty/);
  assert.match((await planOn(fs, ["/internal/Docs/x.txt"], { action: "update", new_folder: "y" })).err, /that is a file/);
});

test("refused: Trash, orOS Drive, app data folders, hidden names, top folders apps save into, bad names", async () => {
  const fs = disk({ "/internal/Flashcards/Notes/a-202611.json": "{}", "/internal/Drive/PC/a.txt": "a", "/internal/.trash/x/y": "y",
                    "/internal/Pictures/p.jpg": "p", "/internal/Docs/d.txt": "d", "/internal/.hidden": "h" });
  assert.match((await planOn(fs, ["/internal/Flashcards/Notes/a-202611.json"], { action: "delete" })).err, /an app keeps its own data/);
  assert.match((await planOn(fs, ["/internal/Drive/PC/a.txt"], { action: "delete" })).err, /orOS Drive/);
  assert.match((await planOn(fs, ["/internal/.trash/x/y"], { action: "delete" })).err, /Trash is changed in Files/);
  assert.match((await planOn(fs, ["/internal/.hidden"], { action: "delete" })).err, /Hidden/);
  assert.match((await planOn(fs, ["/internal/Pictures"], { action: "update", title: "Pics" })).err, /apps save into/);
  assert.match((await planOn(fs, ["/internal/Docs/d.txt"], { action: "move", folder: "Wiki/History" })).err, /an app keeps its own data/);
  assert.match((await planOn(fs, ["/internal/Docs/d.txt"], { action: "update", title: "a/b" })).err, /can't have any of/);
  assert.match((await planOn(fs, ["/internal/Docs/gone.txt"], { action: "delete" })).err, /no longer on the disk/);
  assert.equal((await planOn(fs, ["/internal/Pictures/p.jpg"], { action: "move", folder: "Docs" })).ok, true, "inside a top folder is fine");
});
