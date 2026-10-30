// Atelier designs as files on the orOS disk (AT-DISK, wave 2 of the
// documents-on-disk plan; designkit/docstore.js as Layout's LY-DISK):
// Atelier's own package kind and extension, its item extras (ax) kept
// through a file, the old store moved into files once, an import batch
// that counts what is stored, own files that open instead of copying,
// a folder import that leaves Files › Atelier alone, search and the
// Assistant reading the index, and a "not used" check that reads the
// documents on the disk (Layout's, Atelier's, rescue copies, Trash)
// before any picture is offered for deletion. The engine itself is
// tested in tests/layout-disk.test.js; the browser run (real orosFS,
// migration, a delete that offers its pictures, a Layout picture never
// offered) is in the PR.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fsText = require("fs");

const ROOT = path.join(__dirname, "..");
const M = require(path.join(ROOT, "designkit/model.js"));
const DS = require(path.join(ROOT, "designkit/docstore.js"));
const CORE = require(path.join(ROOT, "files/files-core.js"));
const read = (f) => fsText.readFileSync(path.join(ROOT, f), "utf8");
const core = read("atelier/core.js"), io = read("atelier/io.js"), pn = read("atelier/panels.js");

function memFs() {
  const files = new Map();
  let clock = 1;
  const enoent = () => Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  return {
    files, writes: 0,
    ready() { return Promise.resolve(); },
    mkdir() { return Promise.resolve(); },
    write(p, d) { this.writes++; files.set(p, { text: String(d), mtime: clock++ }); return Promise.resolve(); },
    writeText(p, t) { return this.write(p, t); },
    read(p) { const f = files.get(p); return f ? Promise.resolve({ size: f.text.length, text: () => Promise.resolve(f.text) }) : Promise.reject(enoent()); },
    stat(p) { const f = files.get(p); return f ? Promise.resolve({ size: f.text.length, mtime: f.mtime }) : Promise.reject(enoent()); },
    ls(dir) {
      const out = new Map();
      for (const k of files.keys()) {
        if (!k.startsWith(dir + "/")) continue;
        const rest = k.slice(dir.length + 1), i = rest.indexOf("/");
        out.set(i < 0 ? rest : rest.slice(0, i), { name: i < 0 ? rest : rest.slice(0, i), dir: i >= 0 });
      }
      return Promise.resolve([...out.values()]);
    },
    mv(a, b) { const f = files.get(a); if (!f) return Promise.reject(enoent()); files.delete(a); files.set(b, { text: f.text, mtime: clock++ }); return Promise.resolve(); },
    rm(p) { files.delete(p); return Promise.resolve(); },
  };
}
function memLs(init) {
  const m = new Map(Object.entries(init || {}));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}
const KEYS = { legacy: "oros-atelier-data", index: "oros-atelier-index", open: "oros-atelier-open" };
function engine(fs, ls) {
  const store = DS.create({ dir: "/internal/Atelier", ext: ".orosdesign", kind: "oros-atelier-package", ver: 1, fs, M, core: CORE });
  return { store, eng: DS.open({ store, M, fs, ls, keys: KEYS, rescue: "atelier-data", entry: () => ({ tx: "t" }) }) };
}
let T = 2000000;
const PIC = "a".repeat(64) + ".png";
// a design with a picture (a file in the shared /internal/Assets)
function design(name) {
  const d = M.newDoc({ name, w: 1080, h: 1080, unit: "px" }, (T += 10));
  d.items.push({ id: "it-pic" + T, m: (T += 1), t: "img", pg: d.pages[0].id, x: 0, y: 100, w: 400, h: 400, a: PIC, iw: 400, ih: 400, fit: "fill" });
  return M.normDoc(d);
}

test("an Atelier design keeps its items and picture ids through its file; Greek names; the file is an Atelier package", () => {
  const { store } = engine(memFs(), memLs());
  const d = design("Αφίσα: Γλαρόλυκοι/2026");
  const name = store.nameFor(d);
  assert.equal(name, "Αφίσα Γλαρόλυκοι 2026 · " + d.id + ".orosdesign");
  assert.deepEqual(store.parse(name), { id: d.id, conflict: false });
  const pkg = JSON.parse(store.text(d));
  assert.equal(pkg.kind, "oros-atelier-package");
  assert.equal(pkg.ver, 1);
  const back = store.fromText(store.text(d));
  assert.deepEqual(back, d, "items and the picture's file id survive");
  assert.equal(back.items.length, 1);
  assert.ok(store.text(d).includes(PIC));
});

test("first load moves the old Atelier store into Files › Atelier (rescue copy first) and keeps the old slice", async () => {
  const a = design("Post"), b = design("Αφίσα");
  const legacy = JSON.stringify(M.normData({ ver: 1, docs: [a, b], dt: {} }));
  const fs = memFs(), ls = memLs({ "oros-atelier-data": legacy });
  const { eng, store } = engine(fs, ls);
  const r = await eng.load();
  assert.equal(r.data.docs.length, 2);
  assert.equal(r.writeFailed, 0);
  assert.deepEqual([...fs.files.keys()].filter((k) => k.startsWith("/internal/Atelier/")).sort(), [store.pathFor(a), store.pathFor(b)].sort());
  const rescue = [...fs.files.keys()].filter((k) => /^\/internal\/Rescue\/atelier-data-\d{13}\.json$/.test(k));
  assert.equal(rescue.length, 1);
  assert.equal(fs.files.get(rescue[0]).text, legacy);
  assert.equal(ls.getItem("oros-atelier-data"), legacy);
  const ix = JSON.parse(ls.getItem("oros-atelier-index"));
  assert.deepEqual(ix.docs.map((e) => e.name).sort(), ["Post", "Αφίσα"]);
  assert.ok(ix.docs.every((e) => e.path && e.pages === 1 && e.setup.w === 1080));
});

test("core wiring: disk at boot, saves, pulls, Vault changes, a batch keeps only what is stored", () => {
  assert.match(core, /INDEX_KEY = "oros-atelier-index", OPEN_KEY = "oros-atelier-open", DISK_DIR = "\/internal\/Atelier"/);
  assert.match(core, /orosDocStore\.create\(\{ dir: DISK_DIR, ext: "\.orosdesign", kind: "oros-atelier-package", ver: 1/);
  assert.match(core, /keys: \{ legacy: STORAGE_KEY, index: INDEX_KEY, open: OPEN_KEY \}/);
  assert.match(core, /loadDisk\(\)\.then\(function \(\) \{ return T\.load\(T\.allKeys\(\)\); \}\)/);
  assert.match(core, /if \(diskReady\) disk\.save\(data, AT\.doc\)\.then\(diskSaved\);/);
  assert.match(core, /function sliceGet\(\) \{ return disk \? disk\.sliceGet\(data\) : M\.normData\(data\); \}/);
  assert.match(core, /if \(!diskReady\) \{ diskPulls\.push\(incoming\); return; \}/);
  assert.match(core, /detail\.downloaded > 0 \|\| detail\.deleted > 0 \|\| detail\.conflicts > 0\)\) diskRescan\(\)/);
  // the import batch: written and read back on the disk, else saved in localStorage
  assert.match(core, /return disk\.persist\(data, true\)\.then\(function \(\) \{\s*var lost = ids\.filter\(function \(id\) \{ return !disk\.pathOf\(id\); \}\);/);
  assert.match(core, /if \(saveNow\(\)\) return Promise\.resolve\(ids\);\s*drop\(ids\);/);
  assert.match(io, /return AT\.keepStored\(added\)\.then\(function \(kept\) \{\s*if \(kept\.length\) ok\+\+;\s*else \{ bad\+\+; full = true; \}/);
  // an own file opens its design; the folder import leaves Files › Atelier alone
  assert.match(io, /if \(!batching && AT\.openStored && AT\.openStored\(f\.name, pkg\)\) return;/);
  assert.match(io, /q !== ROOT \+ "\/Trash" && q !== AT\.DISK_DIR/);
  assert.match(io, /path \+ "\/" \+ e\.name !== AT\.DISK_DIR/);
  const html = read("atelier/index.html");
  assert.ok(html.indexOf("../files/files-core.js") > 0 && html.indexOf("../designkit/docstore.js") > html.indexOf("../files/files-core.js"));
  assert.ok(html.indexOf("../designkit/docstore.js") < html.indexOf('src="core.js'));
  ["toast.diskSave", "toast.diskRead", "toast.diskOff"].forEach((k) => {
    assert.equal(core.split('"' + k + '":').length - 1, 2, "EN+EL " + k);
    assert.ok(read("i18n/de/atelier.js").includes('"' + k + '"'), "DE " + k);
  });
});

test("the 'not used' check reads the documents on the disk; a design being deleted does not count", () => {
  assert.doesNotMatch(pn, /DOCS_ON_DISK/);
  assert.match(pn, /var DOC_DIRS = \["\/internal\/Layout", "\/internal\/Atelier", "\/internal\/Rescue"\];/);
  assert.match(pn, /DOC_DIRS\.concat\(\[trashDir\(\)\]\)/);
  // a file that cannot be read or is too big: cannot tell, nothing deletable
  assert.match(pn, /if \(b && typeof b\.size === "number" && b\.size > DOC_MAX\) return false;/);
  assert.match(pn, /\}, function \(e\) \{ return !!\(e && e\.code === "ENOENT"\); \}\);/);
  assert.match(pn, /then\(function \(ok\) \{ return ok \? used : null; \}, function \(\) \{ return null; \}\)/);
  // the designs being deleted: not from memory, their files, or a rescue copy
  assert.match(pn, /if \(id && skip\.indexOf\(id\) >= 0 && \/\\\.orosdesign\$\/i\.test\(path\)\) return true;/);
  assert.match(pn, /o\.docs = o\.docs\.filter\(function \(d\) \{ return !\(d && skip\.indexOf\(d\.id\) >= 0\); \}\);/);
  assert.match(pn, /AT\.dropFiles = function \(ids, docIds\)/);
  assert.match(core, /AT\.dropFiles\(files, ids\)/);
  // the in-name id pattern matches docstore's file names
  const re = new RegExp(pn.match(/var DOC_ID = \/(.+)\/;/)[1]);
  const { store } = engine(memFs(), memLs());
  const d = design("Αφίσα");
  assert.equal(re.exec("/internal/Atelier/" + store.nameFor(d))[1], d.id);
  assert.equal(re.exec("/internal/.trash/x/Αφίσα · " + d.id + " (conflict 20261030-101010).orosdesign")[1], d.id);
});

test("search and the Assistant read the index (the old store on a device that has not moved yet)", () => {
  const search = require(path.join(ROOT, "atelier/search.js"));
  assert.deepEqual(search.keys, ["oros-atelier-index", "oros-atelier-data"]);
  const hits = search.search({ lang: "el", readJSON: (k) => (k === "oros-atelier-index" ? { docs: [{ id: "doc-a", name: "", tx: "Καλημέρα", m: 7 }] } : null) });
  assert.deepEqual(hits, [{ id: "doc-a", title: "Σχέδιο χωρίς τίτλο", text: "Καλημέρα", when: 7, target: { doc: "doc-a" } }]);
  const as = read("assistant/assistant.js");
  assert.match(as, /atelier: \{ mod: "AtelierCommands", data: "oros-atelier-index", legacy: "oros-atelier-data", list: "docs", pkg: 1, max: 64 \* 1024 \* 1024, folders: "oros-atelier-folders"/);
  // a disk app with folders and a brand kit keeps them
  assert.match(as, /return \{ data: \{ docs: list \}, full: \{ docs: full \}, missing: missing, folders: fold, open: open, brand: kit \};/);
});
