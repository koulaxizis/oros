// App interop wave 2 (BR-FO-9): Files opens a file of the orOS disk in
// the app that reads it (fileopen.js insideFor / chooseInside, songs to
// Music), and sends files to Mail (send/core.js kind "files").
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const FO = require(path.join(ROOT, "fileopen.js"));
const C = require(path.join(ROOT, "send/core.js"));
const src = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

test("insideFor: the table's apps, plus Music for songs (inside orOS only)", () => {
  assert.deepEqual(FO.insideFor(".csv"), FO.appsFor(".csv"));
  // Pad reads web and data files as text inside orOS only (BR-FO-2).
  assert.deepEqual(FO.insideFor(".json"), ["pad"]);
  assert.deepEqual(FO.insideFor(".html"), ["pad"]);
  assert.deepEqual(FO.insideFor(".MP3"), ["music"]);
  assert.deepEqual(FO.insideFor(".flac"), ["music"]);
  assert.deepEqual(FO.insideFor(".exe"), []);
  // Songs never reach the system's "Open with" (the manifest).
  const exts = [];
  FO.manifestHandlers().forEach((h) => Object.values(h.accept).forEach((l) => exts.push(...l)));
  FO.INSIDE.forEach((h) => h.exts.forEach((x) => assert.ok(!exts.includes(x), x + " is not in the manifest")));
});

test("chooseInside: saved choice, the only app, or ask", () => {
  assert.deepEqual(FO.chooseInside("a.mp3", null), { app: "music", ext: ".mp3" });
  const shared = FO.shared()[0];
  assert.ok(shared);
  assert.deepEqual(FO.chooseInside("x" + shared, null), { ask: FO.insideFor(shared), ext: shared });
  const app = FO.appsFor(shared)[1];
  const prefs = { ver: 1, map: {} }; prefs.map[shared] = app;
  assert.deepEqual(FO.chooseInside("x" + shared, prefs), { app: app, ext: shared });
  prefs.map[shared] = "ask";
  assert.deepEqual(FO.chooseInside("x" + shared, prefs).ask, FO.insideFor(shared));
  assert.equal(FO.chooseInside("a.exe", null), null);
});

test("files kind: only paths of the orOS disk, ≤ 10, to Mail as attachments", () => {
  const d = C.norm("files", { items: [
    { path: "/internal/Docs/a.pdf" }, { path: "/internal/../x" }, { path: "/etc/passwd" }, { path: "/internal/Docs/a.pdf" },
    { path: "/internal/b\u0001.txt" }, { path: "/internal/c.txt", name: "c/../d.txt" }, "junk"
  ] });
  assert.deepEqual(d.items, [{ path: "/internal/Docs/a.pdf", name: "a.pdf" }, { path: "/internal/c.txt", name: "c..d.txt" }]);
  assert.equal(C.norm("files", { items: [{ path: "/tmp/a" }] }), null);
  const many = C.norm("files", { items: Array.from({ length: 15 }, (_, i) => ({ path: "/internal/f" + i })) });
  assert.equal(many.items.length, 10);
  assert.deepEqual(C.appsFor("files", { items: [{ path: "/internal/a.txt" }] }, C.ORDER, "files"), ["mail"]);
  assert.deepEqual(C.target("mail", "files", { items: [{ path: "/internal/a.txt" }] }),
    { compose: { subject: "a.txt", attach: [{ path: "/internal/a.txt", name: "a.txt" }] } });
  assert.match(src("mail/mail.js"), /handedFiles\(c\.attach\)/);
  assert.equal(C.summary("files", { items: [{ path: "/internal/a.txt" }, { path: "/internal/b.txt" }] }, "en"), "Files · 2 items");
});

test("Files and Music wiring", () => {
  const f = src("files/files.js");
  assert.match(f, /openInside\(file, !!ask, path\)/);
  assert.match(f, /"music", \{ playPath: path \}/);
  assert.match(f, /kind: "files"/);
  assert.match(f, /"pv\.openWith":\s+"Άνοιγμα με…"/);
  const m = src("music/music.js");
  assert.match(m, /typeof tg\.playPath === "string"/);
  assert.match(m, /tg\.playPath\.indexOf\(LIB\.ROOT \+ "\/"\) === 0/);   // only songs under Music play by path
  assert.match(m, /__orosTakeFile\(o\.token\)/);
  assert.match(src("music/library.js"), /paths\.push\(p\)/);
});
