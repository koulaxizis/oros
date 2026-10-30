// Layout documents as files on the orOS disk (LY-DISK,
// designkit/docstore.js): the first load moves the old store into
// files (rescue copy first, every file read back), saves write only
// what changed, a deletion goes to the Trash, conflict copies and
// changes from another device are merged, a file deleted elsewhere
// takes its document along unless this device changed it since, a
// vanished file is written again, the old slice keeps working for
// older devices, and two devices that edit the same document converge.
// The disk is an in-memory stand-in with orosFS's calls; the browser
// run with the real orosFS is in the PR.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const M = require(path.join(ROOT, "designkit/model.js"));
const DS = require(path.join(ROOT, "designkit/docstore.js"));
const CORE = require(path.join(ROOT, "files/files-core.js"));
const fsText = require("fs");
const read = (f) => fsText.readFileSync(path.join(ROOT, f), "utf8");

// ---------- an in-memory orosFS ----------
function memFs() {
  const files = new Map();   // path → { text, mtime }
  let clock = 1;
  const parent = (p) => p.slice(0, p.lastIndexOf("/")) || "/";
  const enoent = () => Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  return {
    files,
    writes: 0,
    ready() { return Promise.resolve(); },
    mkdir() { return Promise.resolve(); },
    write(p, data) { this.writes++; files.set(p, { text: String(data), mtime: clock++ }); return Promise.resolve(); },
    writeText(p, t) { return this.write(p, t); },
    read(p) {
      const f = files.get(p);
      if (!f) return Promise.reject(enoent());
      return Promise.resolve({ size: f.text.length, text: () => Promise.resolve(f.text) });
    },
    stat(p) {
      const f = files.get(p);
      if (f) return Promise.resolve({ path: p, dir: false, size: f.text.length, mtime: f.mtime });
      for (const k of files.keys()) if (k.startsWith(p + "/")) return Promise.resolve({ path: p, dir: true, size: 0, mtime: null });
      return Promise.reject(enoent());
    },
    ls(dir) {
      const out = new Map();
      for (const k of files.keys()) {
        if (!k.startsWith(dir + "/")) continue;
        const rest = k.slice(dir.length + 1), i = rest.indexOf("/");
        out.set(i < 0 ? rest : rest.slice(0, i), { name: i < 0 ? rest : rest.slice(0, i), dir: i >= 0 });
      }
      return Promise.resolve([...out.values()].sort((a, b) => (a.name < b.name ? -1 : 1)));
    },
    mv(a, b) {
      const f = files.get(a);
      if (!f) return Promise.reject(enoent());
      files.delete(a); files.set(b, { text: f.text, mtime: clock++ });
      return Promise.resolve();
    },
    rm(p) { files.delete(p); return Promise.resolve(); },
    parent,
  };
}
function memLs(init) {
  const m = new Map(Object.entries(init || {}));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}
const KEYS = { legacy: "oros-layout-data", index: "oros-layout-index", open: "oros-layout-open" };
function engine(fs, ls) {
  const store = DS.create({ dir: "/internal/Layout", ext: ".oroslayout", kind: "oros-layout-package", ver: 1, fs, M, core: CORE });
  const eng = DS.open({ store, M, fs, ls, keys: KEYS, rescue: "layout-data", entry: () => ({ tx: "t" }) });
  return { store, eng };
}
let T = 1000000;
function doc(name) { return M.newDoc({ name }, (T += 10)); }
function rename(d, name) { const c = JSON.parse(JSON.stringify(d)); c.name = name; c.m = (T += 10); return M.normDoc(c); }
function docFiles(fs) { return [...fs.files.keys()].filter((k) => k.startsWith("/internal/Layout/")).sort(); }
function trashFiles(fs) { return [...fs.files.keys()].filter((k) => k.startsWith("/internal/.trash/")); }

test("file names carry the id; conflict copies are told apart; the text opens as a package", () => {
  const { store } = engine(memFs(), memLs());
  const d = doc("My book: part 1/2");
  const name = store.nameFor(d);
  assert.equal(name, "My book part 1 2 · " + d.id + ".oroslayout");
  assert.deepEqual(store.parse(name), { id: d.id, conflict: false });
  assert.deepEqual(store.parse("My book part 1 2 · " + d.id + " (conflict 20261030-101010).oroslayout"), { id: d.id, conflict: true });
  assert.equal(store.parse("My book (copy).oroslayout"), null);
  assert.equal(store.parse(name.replace(".oroslayout", ".orosdesign")), null);
  const pkg = JSON.parse(store.text(d));
  assert.equal(pkg.kind, "oros-layout-package");
  assert.equal(pkg.ver, 1);
  assert.equal(store.fromText(store.text(d)).id, d.id);
  assert.equal(store.fromText("{}"), null);
});

test("first load: the old store goes to files (rescue copy first, read back), and stays as the old slice", async () => {
  const a = doc("Alpha"), b = doc("Beta");
  const legacy = JSON.stringify(M.normData({ ver: 1, docs: [a, b], dt: {} }));
  const fs = memFs(), ls = memLs({ "oros-layout-data": legacy });
  const { eng, store } = engine(fs, ls);
  const res = await eng.load();
  assert.equal(res.data.docs.length, 2);
  assert.equal(res.writeFailed, 0);
  assert.deepEqual(docFiles(fs), [store.pathFor(a), store.pathFor(b)].sort());
  const rescue = [...fs.files.keys()].filter((k) => /^\/internal\/Rescue\/layout-data-\d{13}\.json$/.test(k));
  assert.equal(rescue.length, 1);
  assert.equal(fs.files.get(rescue[0]).text, legacy, "the rescue copy is the old text, byte for byte");
  assert.equal(ls.getItem("oros-layout-data"), legacy, "the old store is left as it was");
  const ix = JSON.parse(ls.getItem("oros-layout-index"));
  assert.equal(ix.rescued, true);
  assert.deepEqual(ix.docs.map((e) => e.name).sort(), ["Alpha", "Beta"]);
  assert.ok(ix.docs.every((e) => e.path && e.tx === "t" && e.setup.w > 0));
  // a second start: nothing written again, no second rescue copy
  const before = fs.writes;
  const again = engine(fs, ls).eng;
  const r2 = await again.load();
  assert.equal(r2.data.docs.length, 2);
  assert.equal(fs.writes, before);
});

test("saves write only what changed; a rename moves the file; a deletion goes to the Trash", async () => {
  const fs = memFs(), ls = memLs();
  const { eng, store } = engine(fs, ls);
  let data = (await eng.load()).data;
  const a = doc("Alpha"), b = doc("Beta");
  data = M.normData({ ver: 1, docs: [a, b], dt: {} });
  await eng.save(data, a);
  assert.equal(docFiles(fs).length, 2);
  assert.ok(JSON.parse(ls.getItem("oros-layout-open")).doc.id === a.id, "the open document is journaled");
  const w0 = fs.writes;
  await eng.save(data, a);
  assert.equal(fs.writes, w0, "nothing changed, nothing written");
  // rename: same id, new name, the old file moves
  data = M.normData({ ver: 1, docs: [rename(a, "Alpha 2"), b], dt: {} });
  await eng.save(data, null);
  assert.deepEqual(docFiles(fs), [store.pathFor(b), "/internal/Layout/Alpha 2 · " + a.id + ".oroslayout"].sort());
  assert.equal(ls.getItem("oros-layout-open"), null, "no document open, everything written: the journal goes");
  // delete b
  data.dt[b.id] = (T += 10);
  data = M.normData(data);
  await eng.save(data, null);
  assert.deepEqual(docFiles(fs), ["/internal/Layout/Alpha 2 · " + a.id + ".oroslayout"]);
  const tr = trashFiles(fs);
  assert.equal(tr.filter((k) => k.endsWith(".json")).length, 1, "a Trash record");
  assert.ok(tr.some((k) => k.endsWith("/Beta · " + b.id + ".oroslayout")), "the file in the Trash");
  assert.deepEqual(Object.keys(await store.trashedIds()), [b.id]);
});

test("the journal of the open document is merged at the next load (a window closed mid-write)", async () => {
  const fs = memFs(), ls = memLs();
  let { eng } = engine(fs, ls);
  let data = (await eng.load()).data;
  const a = doc("Alpha");
  data = M.normData({ ver: 1, docs: [a], dt: {} });
  await eng.save(data, a);
  const edited = rename(a, "Alpha edited");
  ls.setItem("oros-layout-open", JSON.stringify({ doc: edited }));   // written, the disk write never ran
  eng = engine(fs, ls).eng;
  const r = await eng.load();
  assert.equal(r.data.docs[0].name, "Alpha edited");
  assert.ok(docFiles(fs)[0].includes("Alpha edited"));
});

test("a conflict copy and a second file of one document are merged, then go to the Trash", async () => {
  const fs = memFs(), ls = memLs();
  const { eng, store } = engine(fs, ls);
  const a = doc("Alpha");
  const here = M.normDoc(Object.assign(JSON.parse(JSON.stringify(a)), { guides: [] }));
  // two versions of the same document: each added a page of its own
  const v1 = JSON.parse(JSON.stringify(a)); v1.pages.push(Object.assign({}, v1.pages[0], { id: "pg-one", pos: 5, m: (T += 10) }));
  const v2 = JSON.parse(JSON.stringify(a)); v2.pages.push(Object.assign({}, v2.pages[0], { id: "pg-two", pos: 6, m: (T += 10) }));
  await fs.write(store.pathFor(a), store.text(M.normDoc(v1)));
  await fs.write("/internal/Layout/Alpha · " + a.id + " (conflict 20261030-101010).oroslayout", store.text(M.normDoc(v2)));
  void here;
  const r = await eng.load();
  const d = r.data.docs[0];
  assert.deepEqual(d.pages.map((p) => p.id).filter((id) => id === "pg-one" || id === "pg-two").sort(), ["pg-one", "pg-two"]);
  assert.deepEqual(docFiles(fs), [store.pathFor(a)]);
  const onDisk = store.fromText(fs.files.get(store.pathFor(a)).text);
  assert.ok(onDisk.pages.some((p) => p.id === "pg-two"), "the merge is written to the document's file");
  assert.ok(trashFiles(fs).some((k) => k.includes("(conflict 20261030-101010)")));
});

test("rescan: another device's change is merged; a deletion made elsewhere takes the document; a vanished file is written again", async () => {
  const fs = memFs(), ls = memLs();
  const { eng, store } = engine(fs, ls);
  let data = (await eng.load()).data;
  const a = doc("Alpha"), b = doc("Beta"), c = doc("Gamma");
  data = M.normData({ ver: 1, docs: [a, b, c], dt: {} });
  await eng.save(data, null);
  // another device: renamed a, trashed b (Files' Trash), c vanished
  await fs.write(store.pathFor(a), store.text(rename(a, "Alpha there")));
  await store.trash(store.pathFor(b));
  await fs.rm(store.pathFor(c));
  const r = await eng.rescan(data);
  const names = r.data.docs.map((d) => d.name).sort();
  assert.deepEqual(names, ["Alpha there", "Gamma"]);
  assert.ok(r.data.dt[b.id] >= M.maxM(b), "the deletion is kept as a tombstone");
  assert.deepEqual(r.changed.sort(), [a.id, b.id].sort());
  await eng.save(r.data, null);
  assert.ok(fs.files.has(store.pathFor(c)), "c written again: never lost");
});

test("a file trashed elsewhere while this device changed the document since: the document stays", async () => {
  const fs = memFs(), ls = memLs();
  const { eng, store } = engine(fs, ls);
  let data = (await eng.load()).data;
  const a = doc("Alpha");
  data = M.normData({ ver: 1, docs: [a], dt: {} });
  await eng.save(data, null);
  await store.trash(store.pathFor(a));
  const mine = rename(a, "Alpha changed here");       // not saved yet
  const r = await eng.rescan(M.normData({ ver: 1, docs: [mine], dt: {} }));
  assert.equal(r.data.docs.length, 1);
  await eng.save(r.data, null);
  assert.equal(docFiles(fs).length, 1);
});

test("the old slice: pulls are merged into the files, it never grows, and it carries deletions", async () => {
  const fs = memFs(), ls = memLs();
  const { eng } = engine(fs, ls);
  let data = (await eng.load()).data;
  const mine = doc("Made here");
  data = M.normData({ ver: 1, docs: [mine], dt: {} });
  await eng.save(data, null);
  assert.deepEqual(eng.sliceGet(data).docs, [], "a new document is not added to the old slice");
  const old = doc("From an older device");
  const r = eng.absorb(data, { ver: 1, docs: [old], dt: {} });
  assert.deepEqual(r.changed, [old.id]);
  data = r.data;
  await eng.save(data, null);
  assert.equal(docFiles(fs).length, 2);
  assert.deepEqual(eng.sliceGet(data).docs.map((d) => d.id), [old.id], "the old slice keeps what it had");
  data.dt[old.id] = (T += 10);
  data = M.normData(data);
  assert.deepEqual(eng.sliceGet(data).docs, [], "a deletion here reaches the older devices");
  assert.ok(eng.sliceGet(data).dt[old.id]);
});

test("two devices editing one document converge (files carried by a stand-in Vault with conflict copies)", async () => {
  const A = memFs(), B = memFs(), lsA = memLs(), lsB = memLs();
  const ea = engine(A, lsA), eb = engine(B, lsB);
  let da = (await ea.eng.load()).data, db = (await eb.eng.load()).data;
  const base = doc("Shared");
  da = M.normData({ ver: 1, docs: [base], dt: {} });
  await ea.eng.save(da, null);
  // Vault: A's file to B
  const p = ea.store.pathFor(base);
  await B.write(p, A.files.get(p).text);
  db = (await eb.eng.rescan(db)).data;
  assert.equal(db.docs.length, 1);
  // both edit apart: A renames, B adds a page
  da = M.normData({ ver: 1, docs: [rename(da.docs[0], "Shared A")], dt: {} });
  const bd = JSON.parse(JSON.stringify(db.docs[0]));
  bd.pages.push(Object.assign({}, bd.pages[0], { id: "pg-b", pos: 9, m: (T += 10) }));
  db = M.normData({ ver: 1, docs: [bd], dt: {} });
  await ea.eng.save(da, null);
  await eb.eng.save(db, null);
  // Vault: A uploads first; B's sync keeps its own and puts A's beside it
  const pa = docFiles(A)[0], pb = docFiles(B)[0];
  await B.write(pb.replace(".oroslayout", " (conflict 20261030-120000).oroslayout").replace(/Shared( A)? · /, "Shared A · "), A.files.get(pa).text);
  db = (await eb.eng.rescan(db)).data;
  await eb.eng.save(db, null);
  // B's merged file reaches A
  for (const k of docFiles(A)) A.files.delete(k);
  for (const k of docFiles(B)) await A.write(k, B.files.get(k).text);
  da = (await ea.eng.rescan(da)).data;
  assert.equal(JSON.stringify(da), JSON.stringify(db), "both devices hold the same document");
  assert.equal(da.docs[0].name, "Shared A");
  assert.ok(da.docs[0].pages.some((pg) => pg.id === "pg-b"));
  assert.equal(docFiles(B).length, 1, "the conflict copy is gone from the folder");
});

test("Layout wiring: disk at boot, saves, pulls, Vault changes, own files open, index readers", () => {
  const ly = read("layout/layout.js"), io = read("layout/io.js"), html = read("layout/index.html");
  assert.match(html, /files-core\.js[^\n]*\n\s*<script src="\.\.\/designkit\/docstore\.js/);
  assert.match(ly, /loadDisk\(\)\.then\(function \(\) \{ return T\.load\(T\.allKeys\(\)\); \}\)/);
  assert.match(ly, /if \(diskReady\) disk\.save\(data, LY\.doc\)\.then\(diskSaved\);/);
  assert.match(ly, /function sliceGet\(\) \{ return disk \? disk\.sliceGet\(data\) : M\.normData\(data\); \}/);
  assert.match(ly, /if \(!diskReady\) \{ diskPulls\.push\(incoming\); return; \}/);
  assert.match(ly, /detail\.downloaded > 0 \|\| detail\.deleted > 0 \|\| detail\.conflicts > 0\)\) diskRescan\(\)/);
  assert.match(io, /if \(!batch && LY\.openStored && LY\.openStored\(f\.name, pkg\)\) return;/);
  assert.match(io, /return Promise\.resolve\(LY\.addDocQuiet\(doc\)\)\.then/);
  const search = require(path.join(ROOT, "layout/search.js"));
  assert.deepEqual(search.keys, ["oros-layout-index", "oros-layout-data"]);
  const hits = search.search({ lang: "en", readJSON: (k) => (k === "oros-layout-index" ? { docs: [{ id: "doc-a", name: "Book", tx: "words", m: 5 }] } : null) });
  assert.deepEqual(hits, [{ id: "doc-a", title: "Book", text: "words", when: 5, target: { doc: "doc-a" } }]);
  const as = read("assistant/assistant.js");
  assert.match(as, /layout: \{ mod: "LayoutCommands", data: "oros-layout-index", legacy: "oros-layout-data", list: "docs", pkg: 1/);
  // Atelier offers no picture as unused while documents live on the disk
  const pn = read("atelier/panels.js");
  assert.match(pn, /function usedFiles\(\) \{\s*if \(DOCS_ON_DISK\) return null;/);
  assert.match(pn, /if \(!fsApi\(\) \|\| DOCS_ON_DISK\) return null;/);
  ["toast.diskSave", "toast.diskRead", "toast.diskOff"].forEach((k) => {
    assert.equal(ly.split('"' + k + '":').length - 1, 2, "EN+EL " + k);
    assert.ok(read("i18n/de/layout.js").includes('"' + k + '"'), "DE " + k);
  });
});
