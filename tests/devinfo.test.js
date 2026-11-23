// About this device (DEVINFO-1, video ideas 2026-11-23 #12): version,
// orOS form, browser, system, screen and storage, and Copy details.
// Nothing personal goes in the text.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const C = require(path.join(ROOT, "settings/core.js"));
const CHROME_WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

test("browser and system from the user agent", () => {
  assert.deepEqual(C.uaBrief(CHROME_WIN), { browser: "Chrome 131", os: "Windows 10/11" });
  assert.deepEqual(C.uaBrief("Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0"), { browser: "Firefox 133", os: "Linux" });
  assert.deepEqual(C.uaBrief("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36 EdgA/131.0"), { browser: "Edge 131", os: "Android 14" });
  assert.deepEqual(C.uaBrief(""), { browser: "", os: "" });
});

test("the orOS form", () => {
  assert.equal(C.formOf("usb", false), "usb");
  assert.equal(C.formOf("portable", true), "portable");
  assert.equal(C.formOf("", true), "app");
  assert.equal(C.formOf("evil", false), "browser");
});

test("Copy details: the lines, in the reader's language, nothing personal", () => {
  const info = { version: "8.74.00", form: "portable", ua: CHROME_WIN, sw: 1920, sh: 1080, dpr: 1.25, used: 123456789, quota: 52e9 };
  assert.equal(C.aboutText("en", info), [
    "orOS version: v8.74.00", "orOS form: orOS Portable or installed (desktop)", "Browser: Chrome 131",
    "System: Windows 10/11", "Screen: 1920 × 1080 @1.25x", "Storage: 123 MB used of about 52 GB"].join("\n"));
  const el = C.aboutText("el", Object.assign({}, info, { dpr: 1, quota: 0 }));
  assert.match(el, /^Έκδοση orOS: v8\.74\.00\nΜορφή orOS: /);
  assert.doesNotMatch(el, /@|Αποθηκευτικός/, "no ratio at 1x, no storage line without an answer");
  assert.match(C.aboutText("el", Object.assign({}, info, { quota: 10.9e9 })), /από περίπου 10,9 GB$/);
  const keys = C.aboutRows("en", info).map((r) => r[0]);
  assert.deepEqual(keys, ["x.version", "ab.form", "ab.browser", "ab.os", "ab.screen", "ab.storage"]);
});

test("Settings: the card under the version, strings in EN, EL and DE", () => {
  const S = read("settings/settings.js");
  assert.match(S, /host\.appendChild\(c1\);\n    secAbout\(host, s\);/);
  assert.match(S, /navigator\.clipboard\.writeText\(txt\)/);
  assert.deepEqual(C.findItem("about-device"), ["about-device", "system", "ab.title"]);
  const de = read("i18n/de/settings.js");
  for (const k of ["ab.title", "ab.hint", "ab.form", "ab.form.usb", "ab.form.portable", "ab.form.app", "ab.form.browser", "ab.browser",
    "ab.os", "ab.screen", "ab.storage", "ab.storage.v", "ab.copy", "ab.copied", "w.about-device"]) {
    for (const L of ["en", "el"]) assert.notEqual(C.t(L, k), k, L + " " + k);
    assert.ok(de.includes('"' + k + '"'), "de " + k);
  }
});
