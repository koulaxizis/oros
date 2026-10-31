// Files: "This computer" on orOS USB (files/computer-core.js). Pure
// helpers (paths under /computer, crumbs, names, disk rows, error keys)
// and the client against a fake launcher /__oros/fs/ (headers, cookie
// credentials, path mapping, errors). Plus guards: the place is never
// part of the orOS disk (sync, Vault and orosFS never see /computer).
// Run: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const C = require("../files/computer-core.js");

const ROOT = path.join(__dirname, "..");

test("paths: /computer ↔ API paths, nothing else gets through", () => {
  assert.equal(C.toApi("/computer"), "/");
  assert.equal(C.toApi("/computer/home"), "/home");
  assert.equal(C.toApi("/computer/home/Documents/a b.txt"), "/home/Documents/a b.txt");
  assert.equal(C.toApi("/computer/disks/STICK/x"), "/disks/STICK/x");
  assert.equal(C.toApi("/internal/a"), null);
  assert.equal(C.toApi("/computerx"), null);
  assert.equal(C.toApi("/computer/home/../.."), null);
  assert.equal(C.toApi("/computer/home/./a"), null);
  assert.equal(C.toApi("/computer/home//a"), null);
  assert.equal(C.toApi("/computer/home/"), null);
  assert.equal(C.toApi("/computer/home/a\u0000b"), null);
  assert.equal(C.fromApi("/home/a"), "/computer/home/a");
  assert.equal(C.fromApi("/"), "/computer");
  assert.equal(C.fromApi("home"), null);
  assert.equal(C.fromApi(null), null);
});

test("places: home and each disk; /computer/disks alone is not one", () => {
  assert.equal(C.placeOf("/computer/home/Music/x.mp3"), "/computer/home");
  assert.equal(C.placeOf("/computer/disks/USB 1/a"), "/computer/disks/USB 1");
  assert.equal(C.placeOf("/computer/disks"), null);
  assert.equal(C.placeOf("/computer"), null);
  assert.equal(C.placeOf("/internal"), null);
  assert.equal(C.parentOf("/computer/home/a"), "/computer/home");
  assert.equal(C.baseName("/computer/home/a.txt"), "a.txt");
});

test("crumbs: home folders translated through the label, disks by name", () => {
  const label = (n) => ({ Documents: "Έγγραφα" })[n] || n;
  assert.deepEqual(C.crumbs("/computer", label, "PC", "Home"), [{ name: "PC", path: "/computer" }]);
  assert.deepEqual(C.crumbs("/computer/home/Documents/Taxes", label, "PC", "Home"), [
    { name: "PC", path: "/computer" },
    { name: "Home", path: "/computer/home" },
    { name: "Έγγραφα", path: "/computer/home/Documents" },
    { name: "Taxes", path: "/computer/home/Documents/Taxes" }
  ]);
  assert.deepEqual(C.crumbs("/computer/disks/STICK/Documents", label, "PC", "Home"), [
    { name: "PC", path: "/computer" },
    { name: "STICK", path: "/computer/disks/STICK" },
    { name: "Documents", path: "/computer/disks/STICK/Documents" }
  ]);
  assert.equal(C.folderKey("Pictures"), "c.f.Pictures");
  assert.equal(C.folderKey("pictures"), null);
});

test("every home folder has its name in English and Greek", () => {
  const src = fs.readFileSync(path.join(ROOT, "files/computer.js"), "utf8");
  for (const n of C.HOME_FOLDERS) {
    const hits = src.split('"c.f.' + n + '":').length - 1;
    assert.equal(hits, 2, n);
  }
});

test("names: unique copies, valid names", () => {
  assert.equal(C.uniqueName("a.txt", ["b.txt"]), "a.txt");
  assert.equal(C.uniqueName("a.txt", ["A.TXT"]), "a (2).txt");
  assert.equal(C.uniqueName("a.txt", ["a.txt", "a (2).txt"]), "a (3).txt");
  assert.equal(C.uniqueName("Folder", ["Folder"]), "Folder (2)");
  assert.equal(C.uniqueName(".bashrc", [".bashrc"]), ".bashrc (2)");
  assert.equal(C.validName("Report 2026.pdf"), true);
  assert.equal(C.validName(".hidden"), false);
  assert.equal(C.validName("a/b"), false);
  assert.equal(C.validName("a\\b"), false);
  assert.equal(C.validName(" padded"), false);
  assert.equal(C.validName(""), false);
  assert.equal(C.validName("x".repeat(256)), false);
});

test("sort: folders first, then by name with numbers in order", () => {
  const out = C.sortEntries([
    { name: "file10.txt" }, { name: "b", dir: true }, { name: "file2.txt" }, { name: "A", dir: true }
  ], "en");
  assert.deepEqual(out.map((e) => e.name), ["A", "b", "file2.txt", "file10.txt"]);
});

test("errors: every launcher code has its own words, others fall back", () => {
  for (const c of ["exists", "readonly", "full", "denied", "notfound", "changed", "busy", "inside", "verify", "notempty", "offline", "off", "norecycle"]) {
    assert.equal(C.errKey(c), "c.e." + c);
  }
  assert.equal(C.errKey("weird"), "c.e.io");
  assert.equal(C.errKey(undefined), "c.e.io");
  const src = fs.readFileSync(path.join(ROOT, "files/computer.js"), "utf8");
  for (const c of ["exists", "readonly", "full", "denied", "notfound", "changed", "busy", "inside", "verify", "notempty", "offline", "off", "norecycle", "io"]) {
    assert.equal(src.split('"c.e.' + c + '":').length - 1, 2, c);
  }
});

test("disk rows: mounted disks get their place and free space; read-only kept", () => {
  const rows = C.diskRows([
    { path: "/dev/sdb1", label: "STICK", usb: true, size: 8e9, fstype: "vfat", mount: "/media/oros/STICK" },
    { path: "/dev/nvme0n1p3", label: "", model: "Samsung", size: 5e11, fstype: "ntfs", mount: "", readonly: true },
    { path: "/dev/sdc1", size: 2e9, fstype: "exfat" }
  ], [{ path: "/disks/STICK", free: 4e9, readonly: false }]);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], { dev: "/dev/sdb1", name: "STICK", model: "", usb: true, size: 8e9, fstype: "vfat",
                              path: "/computer/disks/STICK", free: 4e9, readonly: false });
  assert.equal(rows[1].name, "Samsung");
  assert.equal(rows[1].path, null);
  assert.equal(rows[1].readonly, true);
  assert.equal(rows[2].name, "sdc1");
  assert.equal(rows[2].usb, false);
});

// ---------- client against a fake launcher ----------

function fakeFetch(handler) {
  const calls = [];
  const fn = (url, init) => {
    calls.push({ url, init: init || {} });
    const r = handler(url, init || {});
    const headers = new Map(Object.entries(r.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    return Promise.resolve({
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      headers: { get: (k) => headers.get(k.toLowerCase()) || null },
      json: () => (r.json === undefined ? Promise.reject(new Error("no json")) : Promise.resolve(r.json)),
      blob: () => Promise.resolve(new Blob([r.body || ""]))
    });
  };
  fn.calls = calls;
  return fn;
}
const JSONH = { "Content-Type": "application/json" };

test("client: header, credentials, no cache, API paths in, /computer paths out", async () => {
  const f = fakeFetch((url) => {
    if (url.startsWith("/__oros/fs/list?")) {
      return { status: 200, headers: JSONH, json: [{ name: "a.txt", path: "/home/Documents/a.txt", size: 3, mtime: 9 }] };
    }
    return { status: 404, headers: JSONH, json: { error: "notfound" } };
  });
  const c = C.client(f);
  const l = await c.list("/computer/home/Documents");
  assert.deepEqual(l, [{ name: "a.txt", path: "/computer/home/Documents/a.txt", dir: false, size: 3, mtime: 9 }]);
  const call = f.calls[0];
  assert.equal(call.url, "/__oros/fs/list?path=%2Fhome%2FDocuments");
  assert.equal(call.init.headers["X-Oros-FS"], "1");
  assert.equal(call.init.credentials, "same-origin");
  assert.equal(call.init.cache, "no-store");
});

test("client: a path outside /computer is refused before any request", async () => {
  const f = fakeFetch(() => ({ status: 200, headers: JSONH, json: [] }));
  const c = C.client(f);
  await assert.rejects(c.list("/internal/Documents"), (e) => e.code === "badpath");
  await assert.rejects(c.op({ op: "trash", path: "/computer/home/../x" }), (e) => e.code === "badpath");
  await assert.rejects(c.write("/internal/a.txt", new Blob(["x"])), (e) => e.code === "badpath");
  assert.equal(f.calls.length, 0);
  assert.equal(c.rawUrl("/internal/a"), "");
});

test("client: launcher errors carry their code; a dead launcher is offline", async () => {
  const c = C.client(fakeFetch(() => ({ status: 409, headers: JSONH, json: { error: "exists", message: "there" } })));
  await assert.rejects(c.op({ op: "mkdir", path: "/computer/home/x" }), (e) => e.code === "exists" && e.status === 409);
  const dead = C.client(() => Promise.reject(new TypeError("Failed to fetch")));
  await assert.rejects(dead.roots(), (e) => e.code === "offline");
  assert.equal(await C.probe(dead), false);
  const plain = C.client(fakeFetch(() => ({ status: 500, headers: { "Content-Type": "text/plain" } })));
  await assert.rejects(plain.roots(), (e) => e.code === "io" && e.status === 500);
});

test("client: op maps path, to and root; dev and id go as they are", async () => {
  const f = fakeFetch(() => ({ status: 200, headers: JSONH, json: { ok: true } }));
  const c = C.client(f);
  await c.op({ op: "move", path: "/computer/home/a", to: "/computer/disks/S/a" });
  await c.op({ op: "restore", root: "/computer/disks/S", id: "a.2" });
  await c.op({ op: "mount", dev: "/dev/sdb1" });
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { op: "move", path: "/home/a", to: "/disks/S/a" });
  assert.deepEqual(JSON.parse(f.calls[1].init.body), { op: "restore", root: "/disks/S", id: "a.2" });
  assert.deepEqual(JSON.parse(f.calls[2].init.body), { op: "mount", dev: "/dev/sdb1" });
  assert.equal(f.calls[0].init.method, "POST");
  assert.equal(f.calls[0].init.headers["Content-Type"], "application/json");
});

test("client: write sends replace and ifmtime; read returns the mtime", async () => {
  const f = fakeFetch((url, init) => (init.method === "PUT"
    ? { status: 200, headers: JSONH, json: { ok: true } }
    : { status: 200, headers: { "X-Oros-MTime": "1234" }, body: "hello" }));
  const c = C.client(f);
  await c.write("/computer/home/a.txt", new Blob(["x"]), { replace: true, ifmtime: 99.7 });
  assert.equal(f.calls[0].url, "/__oros/fs/raw?path=%2Fhome%2Fa.txt&replace=1&ifmtime=99");
  assert.equal(f.calls[0].init.method, "PUT");
  const got = await c.read("/computer/home/a.txt");
  assert.equal(got.mtime, 1234);
  assert.equal(await got.blob.text(), "hello");
  assert.equal(c.rawUrl("/computer/disks/S T/p.jpg"), "/__oros/fs/raw?path=%2Fdisks%2FS%20T%2Fp.jpg");
});

test("client: trash rows come back as /computer paths", async () => {
  const c = C.client(fakeFetch(() => ({ status: 200, headers: JSONH, json: [
    { root: "/home", id: "a.txt", name: "a.txt", from: "/home/Documents/a.txt", at: "2026-10-31T08:00:00", size: 1 },
    { root: "/disks/S", id: "b", name: "b", from: "", dir: true }
  ] })));
  const t = await c.trash();
  assert.equal(t[0].root, "/computer/home");
  assert.equal(t[0].from, "/computer/home/Documents/a.txt");
  assert.equal(t[1].from, "");
  assert.equal(t[1].dir, true);
});

test("probe: needs a home answer", async () => {
  assert.equal(await C.probe(C.client(fakeFetch(() => ({ status: 200, headers: JSONH, json: { home: { path: "/home" }, disks: [] } })))), true);
  assert.equal(await C.probe(C.client(fakeFetch(() => ({ status: 200, headers: JSONH, json: {} })))), false);
  assert.equal(await C.probe(C.client(fakeFetch(() => ({ status: 404, headers: { "Content-Type": "text/html" } })))), false);
});

// ---------- guards ----------

test("never synced: sync, Vault and orosFS do not know /computer", () => {
  for (const f of ["sync.js", "vault.js", "fs.js"]) {
    const src = fs.readFileSync(path.join(ROOT, f), "utf8");
    assert.equal(/\/computer\b|__oros\/fs/.test(src), false, f);
  }
});

test("the service worker never answers the computer files API", () => {
  const src = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  const i = src.indexOf('self.addEventListener("fetch"');
  const skip = src.indexOf('if (url.pathname.indexOf("/__oros/") === 0) return;', i);
  const firstRespond = src.indexOf("event.respondWith(", src.indexOf("if (url.origin !== self.location.origin) return;", i));
  assert.ok(i > 0 && skip > i && skip < firstRespond);
  // POST and PUT never reach a cache either (the worker returns for them).
  assert.match(src.slice(i, skip), /if \(request\.method !== "GET"\) return;/);
});

test("Files loads the core before computer.js, and both before files.js", () => {
  const html = fs.readFileSync(path.join(ROOT, "files/index.html"), "utf8");
  const a = html.indexOf('src="computer-core.js'), b = html.indexOf('src="computer.js'), c = html.indexOf('src="files.js');
  assert.ok(a > 0 && a < b && b < c);
});

test("the shell probes only on the launcher's own address and checks the event path", () => {
  const src = fs.readFileSync(path.join(ROOT, "shell.js"), "utf8");
  const i = src.indexOf("function computerFiles()");
  assert.ok(i > 0);
  const part = src.slice(i, i + 4000);
  assert.match(part, /host !== "localhost" && host !== "127\.0\.0\.1"/);
  assert.match(part, /data-oros-computer-files/);
  assert.match(part, /"oros-files-open"/);
  assert.match(part, /\(home\|disks\)/);
});

// ---------- orOS Portable and the desktop apps (consent, Windows) ----------

test("consent: GET and POST go to the launcher with the header; Windows is told by roots", async () => {
  const f = fakeFetch((url, init) => ({ status: 200, headers: JSONH,
    json: init.method === "POST" ? { state: JSON.parse(init.body).on ? "on" : "off", fixed: false } : { state: "ask", fixed: false } }));
  const c = C.client(f);
  assert.deepEqual(await c.consent(), { state: "ask", fixed: false });
  assert.deepEqual(await c.setConsent(true), { state: "on", fixed: false });
  assert.equal(f.calls[0].url, "/__oros/fs/consent");
  assert.equal(f.calls[1].init.method, "POST");
  assert.equal(f.calls[1].init.headers["X-Oros-FS"], "1");
  assert.equal(f.calls[1].init.body, JSON.stringify({ on: true }));
  assert.equal(C.isWindows({ os: "windows" }), true);
  assert.equal(C.isWindows({ os: "linux" }), false);
  assert.equal(C.isWindows(null), false);
});

test("Windows drives pair with their roots by letter", () => {
  const rows = C.diskRows([
    { path: "C:", label: "Windows (C:)", size: 5e11, fstype: "ntfs", mount: "/disks/C", internal: true },
    { path: "E:", label: "STICK (E:)", usb: true, size: 8e9, fstype: "exfat", mount: "/disks/E" }
  ], [{ path: "/disks/C", free: 1e11 }, { path: "/disks/E", free: 4e9 }]);
  assert.equal(rows[0].path, "/computer/disks/C");
  assert.equal(rows[0].name, "Windows (C:)");
  assert.equal(rows[1].path, "/computer/disks/E");
  assert.equal(rows[1].usb, true);
});

test("Windows: Recycle Bin wording in EN and EL (DE in i18n), eject hidden, op recyclebin", () => {
  const src = fs.readFileSync(path.join(ROOT, "files/computer.js"), "utf8");
  const de = fs.readFileSync(path.join(ROOT, "i18n/de/files.js"), "utf8");
  for (const k of ["c.recycle", "c.recycleOpen", "c.deleteW", "c.deletedW", "c.deleteMsgW"]) {
    assert.equal(src.split('"' + k + '":').length - 1, 2, k);
    assert.ok(de.includes('"' + k + '":'), "de " + k);
  }
  for (const k of ["c.e.off", "c.e.norecycle"]) assert.ok(de.includes('"' + k + '":'), "de " + k);
  assert.match(src, /d\.path && !win/);
  assert.match(src, /op: "recyclebin"/);
});

test("shell: asks once per computer, falls back for an older launcher, Settings switch", () => {
  const shell = fs.readFileSync(path.join(ROOT, "shell.js"), "utf8");
  const tr = fs.readFileSync(path.join(ROOT, "translations.js"), "utf8");
  const de = fs.readFileSync(path.join(ROOT, "i18n/de/shell.js"), "utf8");
  assert.match(shell, /get\("consent"\)/);
  assert.match(shell, /else if \(st === "ask"\) askConsent\(\)/);
  assert.match(shell, /\}, function \(\) \{ start\(\); \}\);/);   // no consent call: an older orOS USB launcher
  assert.match(shell, /case "pcfiles":/);
  assert.match(shell, /orosPcDialog\.disable/);
  for (const k of ["pc.ask.title", "pc.ask.body", "pc.ask.yes", "pc.ask.no"]) {
    assert.equal(tr.split('"' + k + '":').length - 1, 2, k);
    assert.ok(de.includes('"' + k + '":'), "de " + k);
  }
  const pcd = fs.readFileSync(path.join(ROOT, "pcdialog.js"), "utf8");
  assert.match(pcd, /disable: function/);
});

// ---------- ZIP in This computer (2026-10-31) ----------
test("This computer offers Compress to ZIP and Extract here through Files' own ZIP code", () => {
  const files = fs.readFileSync(path.join(__dirname, "..", "files", "files.js"), "utf8");
  const pc = fs.readFileSync(path.join(__dirname, "..", "files", "computer.js"), "utf8");
  // Files hands its ZIP functions to the computer place, which passes its own io.
  assert.match(files, /zipCreate: zipCreate,\s*zipExtract: zipExtract/);
  assert.match(files, /function zipCreate\(paths, io\)/);
  assert.match(files, /function zipExtract\(path, io\)/);
  assert.ok(!/FS\(\)\.(read|write|mkdir|stat)\(/.test(files.slice(files.indexOf("function zipCollect"), files.indexOf("function renderZipPreview"))),
    "the ZIP code reads and writes only through io");
  assert.match(pc, /ctx\.zipCreate\(\[r\.path\], ZIP_IO\)/);
  assert.match(pc, /ctx\.zipExtract\(r\.path, ZIP_IO\)/);
  for (const k of ["c.zip", "c.extract"]) {
    assert.equal((pc.match(new RegExp('"' + k.replace(".", "\\.") + '":', "g")) || []).length, 2, k + " in EN and EL");
  }
});
