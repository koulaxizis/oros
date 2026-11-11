// New users, extra idea 4: orOS on your phone too (PHONE-1). A desktop
// card with this orOS's address as a QR code and one line on sync, and
// a First steps line that puts it on the desktop.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const W = require(path.join(ROOT, "widgets.js"));
const QR = require(path.join(ROOT, "qr/qr-encode.js"));
const SHELL = read("shell.js");

function cut(src, name) {
  const i = src.indexOf("  function " + name + "(");
  if (i < 0) throw new Error("missing function " + name);
  let depth = 0, j = src.indexOf("{", i);
  for (; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) break;
  }
  return src.slice(i, j + 1);
}

test("phone: the address is this orOS on a real https site, else the public one", () => {
  const L = (protocol, hostname, pathname, port) => ({ protocol, hostname, pathname: pathname || "/", port: port || "" });
  assert.equal(W.phoneUrlOf(L("https:", "useoros.online", "/index.html")), "https://useoros.online/");
  assert.equal(W.phoneUrlOf(L("https:", "me.example.org", "/oros/index.html", "8443")), "https://me.example.org:8443/oros/");
  for (const l of [null, L("http:", "useoros.online"), L("http:", "localhost", "/", "8080"), L("https:", "localhost"), L("https:", "127.0.0.1"),
    L("https:", "192.168.1.20"), L("https:", "10.0.0.2"), L("https:", "172.20.0.1"), L("https:", "box.local"), L("file:", "", "/x/index.html")]) {
    assert.equal(W.phoneUrlOf(l), "https://useoros.online/", JSON.stringify(l));
  }
});

test("phone: the QR holds only the address and the card draws it as one path", () => {
  const q = QR.encode("https://useoros.online/", { ecl: "M" });
  assert.ok(q.size >= 21 && q.size <= 33);
  const src = read("widgets.js");
  assert.match(src, /var SVGNS = "http:\/\/www\.w3\.org\/2000\/svg";/);
  assert.match(src, /p\.setAttribute\("d", qrPath\(mods\)\);/);
  const paint = src.slice(src.indexOf("    phone: function (c) {"), src.indexOf("    sync: function (c) {"));
  assert.doesNotMatch(paint, /innerHTML/);
  assert.match(paint, /host\.settings\("sync"\)/);
  assert.match(cut(SHELL, "wgQr"), /Q\.encode\(url, \{ ecl: "M" \}\)\.modules/);
  assert.match(cut(SHELL, "wgQr"), /s\.src = "qr\/qr-encode\.js\?v=" \+ APP_VERSION;/, "the QR app's own encoder, loaded on demand");
  assert.match(read("sw.js"), /"qr\/qr-encode\.js",/, "precached");
  assert.match(SHELL, /phoneUrl: function \(\) \{ return window\.orosWidgets\.model\.phoneUrlOf\(location\); \},/);
});

test("phone: a kind of its own, not in the default; First steps offers it on a computer only", () => {
  assert.equal(W.KINDS[W.KINDS.length - 1], "phone");
  assert.ok(!W.DEFAULT.includes("phone"));
  assert.deepEqual(W.STEPS, ["note", "task", "wall", "icons", "import", "sync", "phone", "assistant", "install"]);
  assert.equal(W.startRows({ phone: "no" }, null).some((r) => r.id === "phone"), false);
  assert.equal(W.startRows({ phone: false }, null).some((r) => r.id === "phone" && !r.done), true);
  assert.equal(W.startRows({ phone: true }, null).some((r) => r.id === "phone" && r.done), true);
  assert.match(cut(SHELL, "startFacts"), /phone: wgIsPhone\(\) \? "no" : !!\(window\.orosWidgets && window\.orosWidgets\.wants && window\.orosWidgets\.wants\("phone"\)\)/);
  assert.match(cut(SHELL, "startGo"), /case "phone":\s+if \(window\.orosWidgets && window\.orosWidgets\.set\) window\.orosWidgets\.set\("phone", true\); return;/);
});

test("phone: strings EN, EL, DE", () => {
  const tr = read("translations.js"), de = read("i18n/de/shell.js");
  const en = tr.slice(0, tr.indexOf("\n  el: {")), el = tr.slice(tr.indexOf("\n  el: {"));
  for (const k of ["wg.start.phone", "wg.phone", "wg.phone.scan", "wg.phone.sync", "wg.phone.qr"]) {
    assert.ok(en.includes('"' + k + '":') && el.includes('"' + k + '":') && de.includes('"' + k + '":'), k);
  }
});
