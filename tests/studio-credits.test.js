// Studio sound info (Studio v1.7.0): a source's licence card (core.js
// source.lic), the credits of a project, the card in .orosstudio
// packages, and the wiring of the dialog and the export's credits.
// Run: node --test tests/*.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const C = require(path.join(ROOT, "studio", "core.js"));
const P = require(path.join(ROOT, "studio", "package.js"));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

const S = (id, m, x) => Object.assign({ id, m, p: "pproject1", name: id + ".wav", path: "/internal/Studio/audio/a-" + id + ".wav", dur: 10, ch: 2 }, x || {});
const K = (id, s, at) => ({ id, m: 1, p: "pproject1", t: "ttrack01", s, at, off: 0, len: 2 });

test("lic: normalised, bounded, only known licences and http(s) links", () => {
  assert.deepEqual(C.normLic({ k: "by", by: "  Ann \n Lee ", title: "Kick", url: " https://example.org/k " }),
    { k: "by", by: "Ann Lee", title: "Kick", url: "https://example.org/k" });
  assert.equal(C.normLic({ k: "nc", by: "x" }), null, "unknown licence");
  assert.equal(C.normLic(null), null);
  assert.deepEqual(C.normLic({ k: "cc0", url: "javascript:alert(1)" }), { k: "cc0" }, "script links dropped");
  assert.deepEqual(C.normLic({ k: "own", url: "https://a.b/\"><img>" }), { k: "own" });
  assert.equal(C.normLic({ k: "pd", by: "x".repeat(500) }).by.length, 80);
  assert.deepEqual(C.LICENCES, ["cc0", "by", "by-sa", "pd", "own", "other"]);
});

test("lic: written only when set, so older sources keep their bytes", () => {
  const plain = S("ssource1", 5);
  assert.equal(JSON.stringify(C.normSource(plain)), JSON.stringify(C.normSource(Object.assign({}, plain, { lic: { k: "bogus" } }))));
  assert.ok(!("lic" in C.normSource(plain)));
  assert.deepEqual(C.normSource(S("ssource1", 5, { lic: { k: "cc0" } })).lic, { k: "cc0" });
});

test("lic: merge is symmetric and a tie keeps the card (an older copy lacks it)", () => {
  const a = Object.assign(C.emptyData(), { sources: [S("ssource1", 7, { lic: { k: "by", by: "Ann" } })] });
  const b = Object.assign(C.emptyData(), { sources: [S("ssource1", 7)] });
  const ab = C.mergeStudio(a, b), ba = C.mergeStudio(b, a);
  assert.equal(JSON.stringify(ab), JSON.stringify(ba));
  assert.deepEqual(ab.sources[0].lic, { k: "by", by: "Ann" });
  assert.equal(JSON.stringify(C.mergeStudio(ab, ab)), JSON.stringify(ab), "idempotent (R26)");
  // a newer change wins as always, also one that takes the card away
  const c = Object.assign(C.emptyData(), { sources: [S("ssource1", 9)] });
  assert.ok(!("lic" in C.mergeStudio(ab, c).sources[0]));
});

test("credits: sounds with a card in the order they first play, once each", () => {
  const d = C.mergeStudio(C.emptyData(), Object.assign(C.emptyData(), {
    sources: [S("sbbbbbb1", 1, { lic: { k: "cc0", title: "Pad" } }), S("saaaaaa1", 1, { lic: { k: "by", by: "Ann", url: "https://x.org/1" } }),
              S("scccccc1", 1), S("sddddddd", 1, { lic: { k: "other", by: "Lab" } }), S("seeeeee1", 1, { p: "pother01", lic: { k: "by" } })],
    clips: [K("cclip001", "sbbbbbb1", 4), K("cclip002", "saaaaaa1", 0), K("cclip003", "saaaaaa1", 8), K("cclip004", "scccccc1", 1),
            { id: "cmidi001", m: 1, p: "pproject1", t: "ttrack01", at: 0, off: 0, len: 2, n: [[60, 0, 1, 100]] }]
  }));
  const list = C.credits(d, "pproject1");
  assert.deepEqual(list.map((x) => x.id), ["saaaaaa1", "sbbbbbb1"], "unused, uncarded and other projects' sounds left out");
  assert.deepEqual(list.map((x) => x.credit), [true, false]);
  assert.equal(list[0].lic.url, "https://x.org/1");
  d.clips.push(C.normClip(K("cclip005", "sddddddd", 9)));
  assert.equal(C.credits(d, "pproject1").pop().credit, true, "other terms are credited too");
});

test("package: the card travels in .orosstudio and back through the normaliser", () => {
  const d = C.mergeStudio(C.emptyData(), Object.assign(C.emptyData(), {
    projects: [{ id: "pproject1", m: 1, name: "Song", bpm: 120, sig: 4 }],
    tracks: [{ id: "ttrack01", m: 1, p: "pproject1", name: "A", color: C.COLORS[0] }],
    sources: [S("saaaaaa1", 1, { lic: { k: "by-sa", by: "Ann", title: "Loop", url: "https://x.org/l" } }), S("sbbbbbb1", 1)],
    clips: [K("cclip001", "saaaaaa1", 0), K("cclip002", "sbbbbbb1", 2)]
  }));
  const c = P.build(d, "pproject1", { src: { saaaaaa1: "a".repeat(64) + ".wav", sbbbbbb1: "b".repeat(64) + ".wav" } }, {}).content;
  const src = c.sources.find((s) => s.id === "saaaaaa1");
  assert.deepEqual(src.lic, { k: "by-sa", by: "Ann", title: "Loop", url: "https://x.org/l" });
  assert.ok(!("lic" in c.sources.find((s) => s.id === "sbbbbbb1")));
  c.sources[0].lic = { k: "by", url: "data:text/html,x", by: "<b>Ann</b>" };
  let n = 0;
  const r = P.parse(JSON.parse(JSON.stringify(c)), { newId: (k) => k + "new" + String(++n).padStart(6, "0"), now: 5 });
  const back = r.sources.find((s) => s.lic);
  assert.deepEqual(back.lic, { k: "by", by: "<b>Ann</b>" }, "the link is dropped; the name is text, shown with textContent");
});

test("wiring: dialog, export credits, strings in EN and EL, no HTML sinks", () => {
  const html = read("studio/index.html"), js = read("studio/studio.js");
  ["lic-btn", "lic-dlg", "lic-form", "lic-name", "lic-by", "lic-k", "lic-url", "lic-err", "lic-cancel",
   "export-cr-sec", "export-cr", "export-cr-hint", "export-cr-copy", "export-cr-save"].forEach((id) => {
    assert.ok(html.includes('id="' + id + '"'), id);
  });
  const keys = ["lic.btn", "lic.title", "lic.hint", "lic.f.title", "lic.f.by", "lic.f.k", "lic.f.url", "lic.none", "lic.badUrl", "lic.saved",
    "cr.sec", "cr.hint", "cr.hintAll", "cr.copy", "cr.save", "cr.copied", "cr.head", "cr.line", "cr.by", "cr.lic"]
    .concat(C.LICENCES.map((k) => "lic." + k));
  const en = js.slice(js.indexOf("    en: {"), js.indexOf("    el: {")), el = js.slice(js.indexOf("    el: {"));
  keys.forEach((k) => { assert.ok(en.includes('"' + k + '"'), "en " + k); assert.ok(el.includes('"' + k + '"'), "el " + k); });
  const fn = js.slice(js.indexOf("function openLic"), js.indexOf("function exportBusy"));
  assert.ok(!/innerHTML\s*=\s*[^"]/.test(fn.replace(/innerHTML = ""/g, "")), "card text never goes in as HTML");
  assert.match(fn, /edit\(function \(\) \{ put\("sources"/, "saved through put() with Undo (R27)");
  assert.match(js, /renderCredits\(\);\s*showDlg\("export-dlg"\)/);
});
