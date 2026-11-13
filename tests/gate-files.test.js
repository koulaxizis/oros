// GATE-FILES (wave F1, 2026-11-13): Claude's folders on the orOS disk,
// assistant/claudefiles.js, on a fake disk. Only the owner's folders are
// reached, names like keys are never shown, every replace / move /
// delete needs the version that was read, the old content goes to
// Files' Trash, and Undo only takes back what is still as Claude left it.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const F = require("../assistant/claudefiles.js");

const NOW = 1790000000000;
function disk(init) {
  const files = new Map(), dirs = new Set(["/internal"]);
  let t = 1000;
  function mkdirp(p) { const s = p.split("/"); for (let i = 2; i <= s.length; i++) dirs.add(s.slice(0, i).join("/")); }
  Object.keys(init).forEach((p) => { if (init[p] === null) mkdirp(p); else { mkdirp(p.slice(0, p.lastIndexOf("/"))); files.set(p, { text: init[p], mtime: t++ }); } });
  const fs = {
    stat: async (p) => files.has(p) ? { dir: false, size: Buffer.byteLength(files.get(p).text), mtime: files.get(p).mtime } : dirs.has(p) ? { dir: true, size: 0, mtime: null } : Promise.reject(Object.assign(new Error("x"), { code: "ENOENT" })),
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
const verOf = (fs) => async (p) => crypto.createHash("sha256").update(fs.files.get(p).text).digest("hex").slice(0, 16);
async function cur(fs, p) {
  let st = null;
  try { st = await fs.stat(p); } catch (e) { st = null; }
  return { st, v: st && !st.dir ? await verOf(fs)(p) : "" };
}
const INV = "/internal/Drive/ckdesktop/Τιμολόγια";
const FOLDERS = F.cleanFolders([INV, "Drive/ckdesktop/Χειρόγραφα"]);

test("folders: paths cleaned, nested and secret ones dropped, at most 50", () => {
  assert.deepEqual(F.cleanFolders(["Drive/ckdesktop/Τιμολόγια/", "/internal/Drive/ckdesktop/Τιμολόγια/2026", "a › b", "/internal", "", "../x", "/internal/.trash", "Docs\\Ασφάλεια", "/internal/NULL JSFX keys"]),
    ["/internal/Drive/ckdesktop/Τιμολόγια", "/internal/NULL JSFX keys", "/internal/a/b"].sort());
  assert.equal(F.cleanFolders(Array.from({ length: 80 }, (_, i) => "F" + String(i).padStart(2, "0"))).length, 50);
  assert.equal(F.normPath("Drive/../etc"), "");
  assert.equal(F.normPath("/internal/a/.hidden"), "");
});

test("reach: only inside the owner's folders, never names that look like keys", () => {
  assert.equal(F.reach(INV + "/2026/ΤΠΥ-12.pdf", FOLDERS), "");
  assert.match(F.reach("/internal/Documents/x.txt", FOLDERS), /outside the folders/);
  assert.match(F.reach(INV + "/id_rsa", FOLDERS), /key or a secret/);
  assert.match(F.reach(INV + "/backup.kdbx", FOLDERS), /key or a secret/);
  assert.match(F.reach(INV + "/keys/a.txt", FOLDERS), /key or a secret/);
  assert.match(F.reach(INV + "/x.txt", []), /not marked any folder/);
  assert.match(F.reach(INV + "Extra/x.txt", FOLDERS), /outside/);   // a sibling with the same prefix is not inside
});

test("list: folders first, secrets hidden, kinds, pages", () => {
  const rows = [
    { path: INV + "/b.pdf", dir: false, size: 10, mtime: NOW }, { path: INV + "/2026", dir: true },
    { path: INV + "/a.docx", dir: false, size: 5, mtime: NOW, cloud: true }, { path: INV + "/.env", dir: false, size: 1 },
    { path: INV + "/song.wav", dir: false, size: 99 }
  ];
  const o = F.listOut(INV, rows, FOLDERS, 0);
  assert.deepEqual(o.entries.map((e) => [e.name, e.kind]), [["2026", "folder"], ["a.docx", "document"], ["b.pdf", "pdf"], ["song.wav", "media"]]);
  assert.equal(o.entries[1].on_device, false);
  assert.equal(o.total, 4);
  assert.equal(o.next_offset, null);
  const many = Array.from({ length: 250 }, (_, i) => ({ path: INV + "/f" + String(i).padStart(3, "0") + ".txt", dir: false, size: 1 }));
  const p1 = F.listOut(INV, many, FOLDERS, 0);
  assert.equal(p1.entries.length, 200);
  assert.equal(p1.next_offset, 200);
  assert.equal(F.listOut(INV, many, FOLDERS, 200).entries.length, 50);
});

test("read pages: 100,000 characters at most, next_offset", () => {
  const s = "α".repeat(250000);
  const a = F.page(s, 0, 999999);
  assert.equal(a.text.length, 100000);
  assert.equal(a.next_offset, 100000);
  const c = F.page(s, 200000);
  assert.equal(c.text.length, 50000);
  assert.equal(c.next_offset, null);
});

test("write: create never overwrites, replace needs the version read, old one to Trash, Undo restores", async () => {
  const fs = disk({ [INV + "/a.txt"]: "one" });
  const v = verOf(fs);
  // create over an existing file is refused
  assert.match(F.planWrite({ path: INV + "/a.txt", text: "x" }, await cur(fs, INV + "/a.txt"), FOLDERS, NOW).err, /already exists/);
  // create a new one (folders made as needed)
  const p1 = F.planWrite({ path: "Drive/ckdesktop/Τιμολόγια/2026/11/new.md", text: "# hi" }, await cur(fs, INV + "/2026/11/new.md"), FOLDERS, NOW);
  assert.equal(p1.ok, true, p1.err);
  const r1 = await F.run(fs, [p1.step], v);
  assert.equal(r1.fail, "");
  assert.equal(fs.files.get(INV + "/2026/11/new.md").text, "# hi");
  // replace without / with a stale version
  const c = await cur(fs, INV + "/a.txt");
  assert.match(F.planWrite({ path: INV + "/a.txt", text: "two", mode: "replace" }, c, FOLDERS, NOW).err, /needs if_version/);
  assert.match(F.planWrite({ path: INV + "/a.txt", text: "two", mode: "replace", if_version: "0123456789abcdef" }, c, FOLDERS, NOW).err, /changed since/);
  const p2 = F.planWrite({ path: INV + "/a.txt", text: "two", mode: "replace", if_version: c.v }, c, FOLDERS, NOW, () => "aaaa1111");
  assert.equal(p2.ok, true, p2.err);
  const r2 = await F.run(fs, [p2.step], v);
  assert.equal(r2.fail, "");
  assert.equal(fs.files.get(INV + "/a.txt").text, "two");
  const old = [...fs.files.keys()].find((k) => k.startsWith("/internal/.trash/") && k.endsWith("/a.txt"));
  assert.equal(fs.files.get(old).text, "one");
  // the Trash record is Files' own layout
  const meta = JSON.parse(fs.files.get(old.slice(0, old.lastIndexOf("/")) + ".json").text);
  assert.equal(meta.path, INV + "/a.txt");
  // Undo: back to "one", Claude's version kept in the Trash
  const u = await F.undo(fs, r2.done, v, NOW + 1, () => "bbbb2222");
  assert.equal(u.ok, true, u.err);
  assert.equal(fs.files.get(INV + "/a.txt").text, "one");
  assert.ok([...fs.files.entries()].some(([k, f]) => k.startsWith("/internal/.trash/") && f.text === "two"));
});

test("write: a change by the owner between the plan and the run wins", async () => {
  const fs = disk({ [INV + "/a.txt"]: "one" });
  const c = await cur(fs, INV + "/a.txt");
  const p = F.planWrite({ path: INV + "/a.txt", text: "Claude", mode: "replace", if_version: c.v }, c, FOLDERS, NOW);
  await fs.writeText(INV + "/a.txt", "owner");
  const r = await F.run(fs, [p.step], verOf(fs));
  assert.match(r.fail, /changed or moved meanwhile/);
  assert.equal(fs.files.get(INV + "/a.txt").text, "owner");
  assert.equal(r.done.length, 0);
});

test("write: limits, folder roots, names", () => {
  const big = "x".repeat(F.WRITE_BYTES + 1);
  assert.match(F.planWrite({ path: INV + "/b.txt", text: big }, { st: null }, FOLDERS, NOW).err, /at most 1048576/);
  assert.match(F.planWrite({ path: INV, text: "x" }, { st: null }, FOLDERS, NOW).err, /Claude's folders itself/);
  assert.match(F.planWrite({ path: INV + "/b.txt", text: 3 }, { st: null }, FOLDERS, NOW).err, /text must be/);
  assert.match(F.planWrite({ path: "/internal/Notes/x.txt", text: "x" }, { st: null }, FOLDERS, NOW).err, /outside/);
});

test("undo of a new file: only while it is what Claude wrote; it goes to the Trash", async () => {
  const fs = disk({});
  const p = F.planWrite({ path: INV + "/n.txt", text: "Claude" }, { st: null }, FOLDERS, NOW);
  const r = await F.run(fs, [p.step], verOf(fs));
  await fs.writeText(INV + "/n.txt", "owner edit");
  assert.match((await F.undo(fs, r.done, verOf(fs), NOW)).err, /changed since/);
  await fs.writeText(INV + "/n.txt", "Claude");
  const u = await F.undo(fs, r.done, verOf(fs), NOW);
  assert.equal(u.ok, true);
  assert.equal(fs.files.has(INV + "/n.txt"), false);
  assert.ok([...fs.files.values()].some((f) => f.text === "Claude"));
});

test("move: needs the version, never overwrites, stays inside the folders, undo moves back", async () => {
  const fs = disk({ [INV + "/a.txt"]: "one", [INV + "/b.txt"]: "two" });
  const c = await cur(fs, INV + "/a.txt");
  assert.match(F.planMove({ from: INV + "/a.txt", to: INV + "/b.txt", if_version: c.v }, c, await fs.stat(INV + "/b.txt"), FOLDERS).err, /taken/);
  assert.match(F.planMove({ from: INV + "/a.txt", to: "/internal/Documents/a.txt", if_version: c.v }, c, null, FOLDERS).err, /outside/);
  assert.match(F.planMove({ from: INV + "/a.txt", to: INV + "/x/a.txt" }, c, null, FOLDERS).err, /needs if_version/);
  assert.match(F.planMove({ from: INV, to: INV + "2" }, { st: { dir: true } }, null, FOLDERS).err, /outside|Claude's folders/);
  const p = F.planMove({ from: INV + "/a.txt", to: "/internal/Drive/ckdesktop/Χειρόγραφα/a.txt", if_version: c.v }, c, null, FOLDERS);
  assert.equal(p.ok, true, p.err);
  const r = await F.run(fs, [p.step], verOf(fs));
  assert.equal(r.fail, "");
  assert.ok(fs.files.has("/internal/Drive/ckdesktop/Χειρόγραφα/a.txt"));
  const u = await F.undo(fs, r.done, verOf(fs), NOW);
  assert.equal(u.ok, true, u.err);
  assert.ok(fs.files.has(INV + "/a.txt"));
});

test("delete: to Files' Trash, every file with its version; undo restores", async () => {
  const fs = disk({ [INV + "/a.txt"]: "one", [INV + "/old/x.txt"]: "x" });
  const a = await cur(fs, INV + "/a.txt"), d = await cur(fs, INV + "/old");
  assert.match(F.planDelete([{ path: INV + "/a.txt", st: a.st, v: a.v }], FOLDERS, NOW).err, /needs its if_version/);
  assert.match(F.planDelete([{ path: INV, st: { dir: true } }], FOLDERS, NOW).err, /Claude's folders/);
  const p = F.planDelete([{ path: INV + "/a.txt", st: a.st, v: a.v, want: a.v }, { path: INV + "/old", st: d.st, v: "" }], FOLDERS, NOW, (i) => "cccc000" + i);
  assert.equal(p.ok, true, p.err);
  assert.deepEqual(p.names, ["Drive/ckdesktop/Τιμολόγια/a.txt", "Drive/ckdesktop/Τιμολόγια/old"]);
  const r = await F.run(fs, p.steps, verOf(fs));
  assert.equal(r.fail, "");
  assert.equal(fs.files.has(INV + "/a.txt"), false);
  assert.equal(fs.files.has(INV + "/old/x.txt"), false);
  assert.ok([...fs.files.keys()].some((k) => /^\/internal\/\.trash\/[0-9a-z]{9}-cccc0001\/old\/x\.txt$/.test(k)));
  const u = await F.undo(fs, r.done, verOf(fs), NOW);
  assert.equal(u.ok, true, u.err);
  assert.equal(fs.files.get(INV + "/a.txt").text, "one");
  assert.equal(fs.files.get(INV + "/old/x.txt").text, "x");
  assert.equal([...fs.files.keys()].filter((k) => k.startsWith("/internal/.trash/")).length, 0);
});
