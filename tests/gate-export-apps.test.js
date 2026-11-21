"use strict";
// GX-3 (Chris 2026-11-21 «εφάρμοσε το για όλα τα apps που έχουν exports»):
// every app with an Export has an edit_in_app `export` step that saves its
// files into `out` (a local write folder or a folder of Claude's), changes
// nothing, and its card counts the files. recipes/core.js runs the steps.
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const R = require("../recipes/core.js");
const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

const APPS = {
  slides: ["pdf", "pptx", "png"], writer: ["pdf", "docx", "md", "html", "txt"], spreadsheet: ["xlsx", "ods", "csv"],
  whiteboard: ["png", "svg", "pdf", "drawio"], mindmap: ["png", "svg", "md", "opml", "json", "oros"], studio: ["wav", "mp3", "opus"],
  montage: ["video", "sound", "gif"]
};
function mod(app) {
  // the browser modules read their cores from root; load them as Node modules
  return require("../" + app + "/commands.js");
}

test("each app's export step: its formats, out required, changes nothing", () => {
  Object.keys(APPS).forEach((app) => {
    const K = mod(app), ex = K.CATALOG.export;
    assert.ok(ex, app + " has export");
    assert.equal(ex.kind, "out", app);
    assert.deepEqual(ex.args.fmt.v, APPS[app], app + " formats");
    assert.equal(ex.args.out.req, 1, app + ": out is required");
    assert.match(K.GUIDE, /export: .*`out`.*local:<root>\/<folder>.*never over a file/, app + " guide");
    assert.equal(K.check([{ op: "export", fmt: APPS[app][0] }]).ok, false, app + ": no out, refused");
    const ok = K.check([{ op: "export", fmt: APPS[app][0], out: "Drive/Out" }]);
    assert.equal(ok.ok, true, app);
  });
});

test("the assists run the steps and carry saved / outFail; the apps' hosts make the files", () => {
  Object.keys(APPS).forEach((app) => {
    const as = read(app + "/assist.js");
    assert.match(as, /runOuts\(ids, (chk\.)?steps/, app);
    assert.match(as, /orosRecipes\.outRep\(rep, ex\)/, app);
  });
  assert.match(read("slides/io.js"), /if \(sink\) \{ sink\.push\(\{ name: name, blob: blob \}\)/);
  assert.match(read("writer/writer.js"), /window\.WriterExport = \{/);
  assert.match(read("spreadsheet/spreadsheet.js"), /if \(window\.__orosExportSink\) return window\.__orosExportSink;/);
  ["whiteboard/app.js", "mindmap/mindmap.js", "studio/studio.js", "montage/montage.js"].forEach((f) => assert.match(read(f), /exportAs: function \(/, f));
});

test("recipes runOuts: each document and step, null skips, no gate refuses, outRep", async () => {
  const st = [{ op: "export", fmt: "pdf", out: "Drive/A" }, { op: "rename", title: "x" }];
  // no shell: every step fails with gateOff, make is not called
  let called = 0;
  const r0 = await R.runOuts(["a", "b"], st, () => { called++; return []; });
  assert.equal(called, 0);
  assert.deepEqual(r0.outFail, [{ to: "Drive/A", why: "gateOff" }, { to: "Drive/A", why: "gateOff" }]);
  assert.deepEqual(R.outRep({ ok: 1 }, { saved: ["/internal/Drive/A/x.pdf"], outFail: [] }), { ok: 1, saved: ["/internal/Drive/A/x.pdf"] });
  assert.deepEqual(R.outRep({ failed: 1 }, { saved: ["x"], outFail: [] }), { failed: 1 });
  assert.equal(R.outFiles(st, 3), 3);
  assert.equal(R.outFiles([{ op: "rename" }], 3), 0);
});
