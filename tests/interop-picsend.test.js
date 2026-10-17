// App interop: Photo Lab and Atelier hand a picture to the shell's
// "Send to…" sheet (orosSend, kind "files": Mail attaches it, Layout
// places it) — saved in /internal/Pictures first, with the "Send to
// someone" album inside the same sheet when orosShare is there; the
// labels in EN and EL and a help line in both languages.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const src = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

const SENDERS = {
  photolab: { code: "photolab/io.js", menu: "photolab/panels.js", strings: "photolab/strings.js" },
  atelier: { code: "atelier/io.js", menu: "atelier/io.js", strings: "atelier/core.js" }
};

test("both apps open the Send to sheet with kind files and a disk path", () => {
  for (const [app, f] of Object.entries(SENDERS)) {
    const s = src(f.code);
    assert.match(s, /orosSend/, app + " reaches the shell's sheet");
    assert.match(s, /kind: "files", data: \{ items: \[it\] \}/, app + " sends kind files");
    assert.match(s, /opts\.share = \{ kind: "album", data: \{ t: "" \}, photos: \[it\] \}/, app + " adds the album item");
    assert.match(s, /\.open\(opts\)/, app + " opens the sheet");
    assert.match(s, /"\/internal\/Pictures"/, app + " saves in Pictures");
    assert.match(s, /render(ForExport)?\([^)]*"png"|"image\/png"/, app + " sends a PNG");
    assert.match(s, /4096/, app + " caps the long side");
    assert.match(src(f.menu), /sendTo/, app + " lists the action");
  }
});

test("Photo Lab's saveToPictures resolves with the saved path", () => {
  const s = src("photolab/io.js");
  const fn = s.slice(s.indexOf("function saveToPictures"), s.indexOf("// ---------- Wallpaper"));
  assert.match(fn, /return p; \}\);/, "resolves with the path");
  assert.match(fn, /msg\.savedPictures/, "keeps its toast");
  assert.match(fn, /return null; \}\);/, "a failure resolves with null");
  assert.match(s, /saveToPictures\(blob, fileName\("png"\)\)\.then\(function \(p\)/, "Send to uses the path");
  assert.match(src("photolab/panels.js"), /has\(\) && PL\.io\.canSend\(\)/, "only with a picture and the sheet");
});

test("Atelier hides Send to without the sheet or the disk, and makes unique names", () => {
  const s = src("atelier/io.js");
  assert.match(s, /parentApi\("orosSend"\) && parentApi\("orosFS"\)/);
  assert.match(s, /hide: !canSend\(\)/);
  assert.match(s, /fs\.mkdir\(PICTURES\)/);
  assert.match(s, /" \(" \+ n \+ "\)"/);
  assert.match(s, /t\("send\.fail"\)/);
  assert.doesNotMatch(s.slice(s.indexOf("function sendTo"), s.indexOf("// ---------- Editor bar")), /innerHTML/);
});

test("the new labels exist in EN and EL, and the help mentions them", () => {
  const pl = src("photolab/strings.js");
  assert.ok(pl.includes('"menu.sendTo": "Send to…"'), "Photo Lab EN");
  assert.ok(pl.includes('"menu.sendTo": "Αποστολή σε…"'), "Photo Lab EL");
  const at = src("atelier/core.js");
  assert.ok(at.includes('"more.sendTo": "Send to…"'), "Atelier EN");
  assert.ok(at.includes('"more.sendTo": "Αποστολή σε…"'), "Atelier EL");
  assert.equal((at.match(/"send\.fail":/g) || []).length, 2, "Atelier failure toast EN + EL");
  for (const app of Object.keys(SENDERS)) {
    assert.ok(src(app + "/help.en.txt").includes("`Send to…`"), app + " help EN");
    assert.ok(src(app + "/help.el.txt").includes("`Αποστολή σε…`"), app + " help EL");
  }
});
