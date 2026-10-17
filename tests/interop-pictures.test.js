// App interop: pictures between apps. Pixel Avatar sets the orOS
// wallpaper (a screen-shaped picture, the face crisp in the middle)
// and sends the face through "Send to…" from /internal/Pictures;
// Layout takes { placeImage: { path, name } } and places the picture
// in a new image frame (only /internal/ pictures, by extension).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const src = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const between = (s, a, b) => s.slice(s.indexOf(a), s.indexOf(b, s.indexOf(a)));

test("Pixel: wallpaper and Send to… chips sit in Export, hidden until the shell has the API", () => {
  const html = src("pixel/index.html");
  for (const [id, key] of [["wall-btn", "btn.wall"], ["send-btn", "btn.send"]]) {
    assert.match(html, new RegExp('id="' + id + '" class="chip" data-i18n="' + key + '" hidden'), id);
  }
  const exp = between(html, 'id="exp-lbl"', "</div>\n      </div>");
  assert.ok(exp.includes("netizen-btn") && exp.includes("wall-btn") && exp.includes("send-btn"), "next to netizen-btn");
  const js = src("pixel/pixel.js");
  assert.match(js, /\$\("wall-btn"\)\.hidden = !wallApi\(\);/);
  assert.match(js, /\$\("wall-btn"\)\.addEventListener\("click", setWallpaper\)/);
  assert.match(js, /\$\("send-btn"\)\.hidden = !sendApi\(\);/);
  assert.match(js, /\$\("send-btn"\)\.addEventListener\("click", sendTo\)/);
  assert.match(js, /typeof w\.setImage === "function"/);
});

test("Pixel: the wallpaper is screen-shaped, ≤ 3840 px, crisp, with a #rrggbb background", () => {
  const js = between(src("pixel/pixel.js"), "function wallBlob", "function setWallpaper");
  assert.match(js, /devicePixelRatio/);
  assert.match(js, /3840 \/ Math\.max\(W, H\)/);
  assert.match(js, /imageSmoothingEnabled = false/);
  assert.match(js, /0\.6 \/ n/);
  assert.match(js, /toHex\(cols\[0\]\) \|\| "#000000"/);
  assert.match(src("pixel/pixel.js"), /api\.setImage\(r\.blob, \{ bg: r\.bg \}\)/);
});

test("Pixel: Send to… saves a free name in /internal/Pictures, then opens the send sheet", () => {
  const js = between(src("pixel/pixel.js"), 'var PICTURES = "/internal/Pictures"', "function copySeed");
  assert.match(js, /fs\.mkdir\(PICTURES\)/);
  assert.match(js, /" \(" \+ n \+ "\)"/);
  assert.match(js, /exportPx\(f\.n, 512\)/);
  assert.match(js, /kind: "files", data: \{ items: \[it\] \}/);
  assert.match(js, /if \(shareApi\(\)\) opts\.share = \{ kind: "album", data: \{ t: "" \}, photos: \[/);
  assert.doesNotMatch(js, /innerHTML/);
});

test("Pixel and Layout: the new labels exist in EN and EL", () => {
  const px = src("pixel/pixel.js");
  const pxEn = between(px, "en: {", "el: {"), pxEl = between(px, "el: {", "function t(");
  for (const k of ["btn.wall", "btn.send", "toast.wall", "toast.wallFail", "toast.sendFail"]) {
    assert.ok(pxEn.includes('"' + k + '"'), "pixel EN " + k);
    assert.ok(pxEl.includes('"' + k + '"'), "pixel EL " + k);
  }
  assert.ok(pxEn.includes('"Use as wallpaper"') && pxEl.includes('"Ταπετσαρία"'));
  assert.ok(pxEn.includes('"Send to…"') && pxEl.includes('"Αποστολή σε…"'));
  const ly = src("layout/layout.js");
  assert.ok(ly.includes('"img.sent": "Picture placed on the page"'));
  assert.ok(ly.includes('"img.sent": "Η εικόνα μπήκε στη σελίδα"'));
});

test("Layout: placeImage is guarded (/internal/, picture extension, no dialog) and placed through LY.io", () => {
  const ly = src("layout/layout.js");
  const h = between(ly, "if (tg && tg.placeImage)", "var id = tg && typeof tg.doc");
  assert.match(h, /dialog\[open\]/);
  assert.match(h, /path\.indexOf\("\/internal\/"\) !== 0/);
  assert.match(h, /PLACE_EXT\.test\(path\)/);
  assert.match(h, /fs\.read\(path\)/);
  assert.match(h, /LY\.io\.placeFromBlob\(blob, nm\)/);
  const m = /var PLACE_EXT = (\/.+\/i);/.exec(ly);
  assert.ok(m, "PLACE_EXT");
  const re = eval(m[1]);
  for (const ok of ["a.png", "b.JPG", "c.jpeg", "d.webp", "e.gif"]) assert.ok(re.test("/internal/Pictures/" + ok), ok);
  for (const no of ["a.svg", "b.png.txt", "c.oroslayout", "d"]) assert.ok(!re.test("/internal/Pictures/" + no), no);
  assert.match(ly, /\{ placeImage: \{ path, name\? \} \}/, "documented above openSearchTarget");

  const io = src("layout/io.js");
  const p = between(io, "function placeFromBlob", "// ---------- Text");
  assert.match(p, /A\.importFile\(file\)/);
  assert.match(p, /LY\.newDocSetup\(\)/);
  assert.match(p, /LY\.createDoc\(s\)/);
  assert.match(p, /ED\.marginBox\(doc, P0\.side\)/);
  assert.match(p, /LY\.op\(function \(doc, now\)/);
  assert.match(p, /ED\.addItem\(doc, \{ t: "img"/);
  assert.match(p, /ED\.select\(\[made\.id\]\)/);
  assert.match(io, /placeFromBlob: placeFromBlob/);
  assert.match(src("layout/panels.js"), /LY\.newDocSetup = newDocSetup;/);
});

test("help mentions the new features in both languages", () => {
  assert.ok(src("pixel/help.en.txt").includes("`Use as wallpaper`") && src("pixel/help.en.txt").includes("`Send to…`"));
  assert.ok(src("pixel/help.el.txt").includes("`Ταπετσαρία`") && src("pixel/help.el.txt").includes("`Αποστολή σε…`"));
  assert.ok(src("layout/help.en.txt").includes("`Send to…`"));
  assert.ok(src("layout/help.el.txt").includes("`Αποστολή σε…`"));
});
