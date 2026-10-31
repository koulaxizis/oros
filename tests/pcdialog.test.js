// orOS USB wave 4: open and save dialogs over This computer (pcdialog.js).
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const P = require("../pcdialog.js");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

test("acceptTest: empty and wildcard take everything", () => {
  assert.ok(P.acceptTest("")("a.bin"));
  assert.ok(P.acceptTest("*/*")("noext"));
  assert.ok(P.acceptTest(" * ")("x.docx"));
});

test("acceptTest: extensions, families and plain MIME types", () => {
  const t = P.acceptTest(".docx, .ODT,image/*,application/json");
  assert.ok(t("Report.DOCX"));
  assert.ok(t("a.odt"));
  assert.ok(t("photo.jpeg"));
  assert.ok(t("data.json"));
  assert.ok(!t("song.mp3"));
  assert.ok(!t("README"));
  assert.ok(P.acceptTest("audio/*")("x.flac"));
  assert.ok(!P.acceptTest("audio/*")("x.mp4"));
});

test("validName refuses slashes, dot names, padding and empty", () => {
  assert.ok(P.validName("Letter.odt"));
  assert.ok(P.validName("Γράμμα 2.txt"));
  ["", " a", "a ", ".hidden", "a/b", "a\\b", "a\u0000", "x".repeat(256), null].forEach((n) =>
    assert.ok(!P.validName(n), JSON.stringify(n)));
});

test("uniqueName adds (2), (3) before the extension, case-insensitively", () => {
  assert.strictEqual(P.uniqueName("a.txt", []), "a.txt");
  assert.strictEqual(P.uniqueName("a.txt", ["A.TXT"]), "a (2).txt");
  assert.strictEqual(P.uniqueName("a.txt", ["a.txt", "a (2).txt"]), "a (3).txt");
  assert.strictEqual(P.uniqueName("Folder", ["folder"]), "Folder (2)");
});

test("cleanDir accepts only home and disk folders without dot segments", () => {
  assert.strictEqual(P.cleanDir("/home"), "/home");
  assert.strictEqual(P.cleanDir("/home/Documents/Work"), "/home/Documents/Work");
  assert.strictEqual(P.cleanDir("/disks/STICK/a"), "/disks/STICK/a");
  ["/", "/etc", "/home/../etc", "/home/.ssh", "/home//x", "/disks", "/disks/", "home", null, "/homes"].forEach((p) =>
    assert.strictEqual(P.cleanDir(p), null, String(p)));
});

test("startDir: opened file's folder, then the last folder, then Documents", () => {
  const opened = { "letter.odt": { dir: "/disks/STICK/Letters", path: "/disks/STICK/Letters/letter.odt", mtime: 1 } };
  assert.strictEqual(P.startDir("Letter.odt", opened, "/home/Music"), "/disks/STICK/Letters");
  assert.strictEqual(P.startDir("other.odt", opened, "/home/Music"), "/home/Music");
  assert.strictEqual(P.startDir("other.odt", opened, "/etc"), "/home/Documents");
  assert.strictEqual(P.startDir("", null, null), "/home/Documents");
});

test("extOf", () => {
  assert.strictEqual(P.extOf("a.B.PNG"), "png");
  assert.strictEqual(P.extOf("noext"), "");
  assert.strictEqual(P.extOf(""), "");
});

test("wired in: shell loads it after dialogs.js, enables it only with the launcher, sw precaches it", () => {
  const html = read("index.html");
  const a = html.indexOf('src="dialogs.js'), b = html.indexOf('src="pcdialog.js');
  assert.ok(a > 0 && b > a, "pcdialog.js after dialogs.js");
  const shell = read("shell.js");
  const i = shell.indexOf('setAttribute("data-oros-computer-files", "1")');
  const j = shell.indexOf("window.orosPcDialog.enable()");
  assert.ok(i > 0 && j > i && j - i < 300, "enable() right after the launcher answered");
  assert.ok(/"\.\/pcdialog\.js"/.test(read("sw.js")));
});

test("strings: every pcd key in EN, EL and DE", () => {
  const src = read("pcdialog.js");
  const keys = Array.from(new Set(src.match(/"pcd\.[A-Za-z.]+"/g).map((s) => s.slice(1, -1))));
  assert.ok(keys.length >= 25);
  const tr = read("translations.js"), de = read("i18n/de/shell.js");
  keys.forEach((k) => {
    const n = tr.split('"' + k + '":').length - 1;
    assert.strictEqual(n, 2, k + " in EN and EL");
    assert.ok(de.indexOf('"' + k + '":') !== -1, k + " in DE");
  });
});

test("safety: only the launcher API, never a native dialog, data through textContent", () => {
  const src = read("pcdialog.js");
  assert.ok(!/\b(alert|confirm|prompt)\s*\(/.test(src), "no native dialogs (R14)");
  const html = src.replace(/innerHTML\s*=\s*""/g, "").replace(/b\.innerHTML = icon;/, "");
  assert.ok(!/innerHTML\s*=/.test(html), "no innerHTML with data");
  (src.match(/rowBtn\(([A-Z]+|[a-z][^,]*),/g) || []).forEach((c) =>
    assert.ok(/rowBtn\((FOLDER|FILE|DISK|icon),/.test(c), "row icons are constants: " + c));
  const urls = src.match(/fetch\(([^,)]+)/g) || [];
  urls.forEach((u) => assert.ok(/API/.test(u), u));
  assert.ok(/"X-Oros-FS": "1"/.test(src));
  assert.ok(/credentials: "same-origin"/.test(src));
});
