// Assistant → Layout rebuild (AS-RB, AS-DEV): files for an app only
// (they stay on the device and never go to the provider), the
// rebuild_in_layout tool and its report, do_action open with a Layout
// page, and the Layout automation step that changes a style by name.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const C = require("../assistant/core.js");
const RC = require("../recipes/core.js");
const SH = require("../recipes/share.js");
const M = require("../designkit/model.js");
const S = require("../layout/recipesteps.js");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const MB = 1024 * 1024;
const FILES = [
  { id: "a9", name: "notes.txt", type: "text/plain", size: 10, kept: true },
  { id: "a8", name: "Issue 4 print.pdf", type: "application/pdf", size: 60 * MB, kept: true },
  { id: "a7", name: "cover.jpg", type: "image/jpeg", size: 9 * MB, kept: true },
  { id: "a6", name: "issue.af", type: "", size: 25 * MB, kept: true },
  { id: "a5", name: "old.png", type: "image/png", size: 10, kept: false },
  { id: "a4", name: "Contract.pdf", type: "application/pdf", size: 10, kept: false }
];

test("files for an app only: any type, kept apart, never sent to the provider", () => {
  const a = C.normAtt({ id: "aabcdef1", name: "issue.af", type: "", size: 25 * MB, dev: 1 });
  assert.deepEqual(a, { id: "aabcdef1", name: "issue.af", type: "", size: 25 * MB, dev: 1 });
  assert.equal(C.normAtt({ id: "aabcdef1", name: "issue.af", type: "", size: 10 }), null, "an unknown type still needs dev");
  assert.equal(C.normAtt({ id: "aabcdef1", name: "x.pdf", type: "application/pdf", size: 10, dev: true }).dev, undefined, "dev is exactly 1");
  // the message says the file is there and how to use it, with no data
  const m = { r: "user", text: "Rebuild it", att: [{ id: "aabcdef1", name: "Issue.pdf", type: "application/pdf", size: 60 * MB, dev: 1, data: "QUJD" }] };
  const out = C.prepHistory([m], "anthropic", false, {})[0];
  assert.equal(out.att, undefined);
  assert.match(out.text, /^\[The user attached “Issue\.pdf” \(60 MB\) for an orOS app: it stays on their device and is not sent to you/);
  assert.match(out.text, /rebuild_in_layout/);
  assert.deepEqual(C.attBudget([m], "anthropic", {}), {}, "never counted in a request");
});

test("files for an app only: 200 files, 1 GB each, 2 GB kept (500 MB on a phone)", () => {
  assert.equal(C.checkDev([], 0, { size: 900 * MB }, false), "");
  assert.equal(C.checkDev([], 0, { size: C.DEV_FILE + 1 }, false), "size");
  assert.equal(C.checkDev([], 0, { size: 0 }, false), "size");
  assert.equal(C.checkDev(new Array(200), 0, { size: 1 }, false), "count");
  assert.equal(C.checkDev([], 1800 * MB, { size: 300 * MB }, false), "total");
  assert.equal(C.checkDev([], 300 * MB, { size: 250 * MB }, true), "total");
  assert.equal(C.checkDev([], 200 * MB, { size: 250 * MB }, true), "");
  assert.deepEqual([C.DEV_MAX, C.DEV_FILE, C.DEV_TOTAL, C.DEV_PHONE], [200, 1024 * MB, 2048 * MB, 500 * MB]);
});

test("rebuild_in_layout: offered with Layout; the prompt says when and never to retype", () => {
  const names = (o) => C.toolsFor(o).map((t) => t.name);
  assert.ok(names({ rebuild: true }).includes("rebuild_in_layout"));
  assert.ok(!names({}).includes("rebuild_in_layout"));
  const tool = C.toolsFor({ rebuild: true }).find((t) => t.name === "rebuild_in_layout");
  assert.equal(tool.params.required, undefined, "pdf, or sla for a Scribus file");
  assert.equal(tool.params.properties.sla.type, "string");
  assert.equal(tool.params.properties.sources.type, "array");
  assert.equal(tool.params.properties.thread.type, "boolean");
  const sp = C.systemPrompt({ lang: "en", now: Date.now(), apps: ["Layout (layout)"], files: "pdf", rebuild: true });
  assert.match(sp, /call rebuild_in_layout; a Scribus file .* Never retype a printed document/);
  assert.match(sp, /say honestly what came out the same and what did not/);
  assert.match(sp, /do_action open with app layout and page/);
  assert.doesNotMatch(C.systemPrompt({ lang: "en", now: Date.now(), apps: [], files: "pdf" }), /rebuild_in_layout/);
});

test("rebuild_in_layout: the PDF by name, every attached picture and text by default", () => {
  const r = C.normRebuild({ pdf: "issue 4" }, FILES);
  assert.equal(r.ok, true);
  assert.deepEqual(r.pdf, { id: "a8", name: "Issue 4 print.pdf" });
  assert.deepEqual(r.src, [{ id: "a9", name: "notes.txt" }, { id: "a7", name: "cover.jpg" }, { id: "a6", name: "issue.af" }], "kept pictures, texts and the .af (LY-AF), not a file that is gone");
  assert.equal(r.folder, "");
  assert.equal(r.thread, false, "frames per page unless asked (LY-THR)");
  assert.equal(C.normRebuild({ pdf: "issue 4", thread: true }, FILES).thread, true);
  assert.equal(C.normRebuild({ pdf: "issue 4", thread: "yes" }, FILES).thread, false);
  const named = C.normRebuild({ pdf: "Issue 4 print.pdf", sources: ["cover.jpg"], folder: "/internal/Pictures/Issue 4/" }, FILES);
  assert.deepEqual(named.src, [{ id: "a7", name: "cover.jpg" }]);
  assert.equal(named.folder, "/internal/Pictures/Issue 4");
  assert.deepEqual(C.normRebuild({ pdf: "/internal/Layout/print.pdf" }, []).pdf, { path: "/internal/Layout/print.pdf", name: "print.pdf" });
});

test("rebuild_in_layout: refusals the model can act on", () => {
  assert.match(C.normRebuild({ pdf: "Contract.pdf" }, FILES).err, /no longer available.*attach it again/);
  assert.match(C.normRebuild({ pdf: "cover.jpg" }, FILES).err, /is not a PDF/);
  assert.match(C.normRebuild({ pdf: "x.pdf" }, FILES).err, /no attached file is called “x\.pdf”\. Attached: notes\.txt/);
  assert.match(C.normRebuild({}, []).err, /pdf is empty.*attached no file/);
  assert.match(C.normRebuild({ pdf: "issue 4", sources: ["old.png", "notes.txt", "Contract.pdf"] }, FILES).err, /not attached pictures, texts or \.af files.*old\.png, Contract\.pdf/);
  assert.deepEqual(C.normRebuild({ pdf: "issue 4", sources: ["issue.af"] }, FILES).src, [{ id: "a6", name: "issue.af" }]);
  assert.match(C.normRebuild({ pdf: "issue 4", folder: "/etc" }, FILES).err, /folder must be a folder on the orOS disk/);
  assert.match(C.normRebuild({ pdf: "issue 4", folder: "/internal/../x" }, FILES).err, /folder must be/);
  assert.match(C.normRebuild({ pdf: "/internal/a.txt" }, []).err, /pdf must be a PDF/);
});

test("rebuild_in_layout: a Scribus file, with its print PDF and pictures or alone", () => {
  const F2 = FILES.concat([{ id: "b1", name: "Book.sla", type: "", size: 900000, kept: true }, { id: "b2", name: "Book.sla.gz", type: "", size: 90000, kept: false }]);
  const r = C.normRebuild({ sla: "Book.sla", pdf: "Issue 4 print.pdf" }, F2);
  assert.equal(r.ok, true);
  assert.deepEqual(r.sla, { id: "b1", name: "Book.sla" });
  assert.deepEqual(r.pdf, { id: "a8", name: "Issue 4 print.pdf" });
  assert.deepEqual(r.src, [{ id: "a9", name: "notes.txt" }, { id: "a7", name: "cover.jpg" }]);
  const alone = C.normRebuild({ sla: "/internal/Books/Book.sla" }, []);
  assert.deepEqual([alone.ok, alone.pdf, alone.sla], [true, null, { path: "/internal/Books/Book.sla", name: "Book.sla" }]);
  assert.match(C.normRebuild({ sla: "cover.jpg" }, F2).err, /is not a Scribus \(\.sla\) file/);
  assert.match(C.normRebuild({ sla: "Book.sla.gz" }, F2).err, /no longer available/);
  assert.match(C.normRebuild({ sla: "Book.sla", pdf: "cover.jpg" }, F2).err, /is not a PDF/);
  // its report: counts only
  assert.deepEqual(C.rebuildReport({ sla: 1, pages: 90, items: 110, skipped: 2, placed: 5, missing: 1, fit: { lines: 300, matched: 300, checked: 280, inPlace: 279 }, text: "secret" }),
    { kind: "sla", pages: 90, objects: 110, picturesPlaced: 5, picturesMissing: 1, simplified: 2, lines: 280, inPlace: 279, percent: 99.6, pdfMatched: true });
  assert.deepEqual(C.rebuildReport({ sla: 1, pages: 1, items: 1, placed: 0, missing: 0, fit: null }), { kind: "sla", pages: 1, objects: 1, picturesPlaced: 0, picturesMissing: 0, simplified: 0 });
  const sp = C.systemPrompt({ lang: "en", now: Date.now(), apps: ["Layout (layout)"], files: "pdf", rebuild: true });
  assert.match(sp, /a Scribus file \(\.sla\) opens in Layout through rebuild_in_layout with sla/);
  assert.match(sp, /an Affinity file \(\.af\) goes in sources next to its print PDF/);
});

test("rebuild report: only numbers and font names reach the model", () => {
  const rep = C.rebuildReport({
    pages: 102, total: 102, pictures: 17, originals: 8, styles: 90, numberStart: 3,
    check: { lines: 2088, inPlace: 2070, moved: 18, extra: 0, overset: 1 },
    fonts: [{ font: "FreeSerif", track: -61 }, { font: "NotoSerif", track: 0 }, { font: 5 }],
    framesOff: [{ page: 8, id: "it-x", want: 22, got: 21, moved: 3 }, { page: 17, want: 2, got: 2, moved: 1 }],
    styleNames: ["secret"]
  });
  assert.deepEqual(rep, {
    pages: 102, lines: 2088, inPlace: 2070, pictures: 17, originals: 8, styles: 90, percent: 99.1, firstPageNumber: 3,
    fontsReplaced: ["FreeSerif"], pagesToCheck: [{ page: 8, lines: 3 }, { page: 17, lines: 1 }], pdfPages: 102
  });
  assert.equal(C.rebuildReport(null), null);
  // the Affinity file's part: counts only, never its style or font names
  assert.deepEqual(C.rebuildReport({ check: {}, af: { pictures: 14, styles: ["Body", "secret"], fonts: ["F"], problems: [] } }).affinity, { read: true, pictures: 14, styles: 2 });
  assert.deepEqual(C.rebuildReport({ check: {}, af: { failed: 1 } }).affinity, { read: false });
  assert.equal(C.rebuildReport({ check: {} }).percent, 100);
  assert.deepEqual(C.rebuildReport({ check: {}, threads: { stories: 16, frames: 28 } }).threaded, { articles: 16, frames: 28 });
  assert.equal(C.rebuildReport({ check: {} }).threaded, undefined);
});

test("do_action open: a page of the open Layout document", () => {
  const has = () => true;
  const a = C.normAction({ kind: "open", app: "layout", page: 17 }, { has });
  assert.equal(a.ok, true);
  assert.deepEqual(a.call, { fn: "openAt", args: ["layout", { page: 17 }] });
  assert.deepEqual(a.view.fields, [["page", "17"]]);
  assert.match(C.normAction({ kind: "open", app: "notes", page: 2 }, { has }).err, /only with app layout/);
  assert.match(C.normAction({ kind: "open", app: "layout", page: 1.5 }, { has }).err, /whole number/);
  assert.deepEqual(C.normAction({ kind: "open", app: "layout" }, { has }).call, { fn: "openAt", args: ["layout", null] });
});

test("Layout automation: change a style by name; fields left at 0 or \"\" stay", () => {
  const d = M.normDoc(M.newDoc({ name: "Book", pages: 2 }, 1000));
  d.pstyles.push({ id: "ps-rb1", m: 1000, name: "Body text", base: "ps-base", font: "serif", size: 10, lead: 15, align: "j", track: -40 });
  const st = RC.normStep({ op: "style", name: "body TEXT", size: 10.5, lead: 14 }, S.CATALOG);
  assert.deepEqual(st, { op: "style", name: "body TEXT", size: 10.5, lead: 14, font: "", align: "", track: 0,
    bold: "", ital: "", caps: "", sb: -1, sa: -1, fi: -1, brk: "", hyph: "" });
  assert.equal(S.apply(d, st, 2000), 1);
  const ps = d.pstyles.find((p) => p.id === "ps-rb1");
  assert.deepEqual([ps.size, ps.lead, ps.align, ps.font, ps.track], [10.5, 14, "j", "serif", -40]);
  assert.ok(ps.m >= 2000, "stamped, so it syncs");
  assert.equal(S.apply(d, st, 3000), 0, "the same step twice changes nothing more");
  assert.equal(S.apply(d, RC.normStep({ op: "style", name: "Nope", size: 9 }, S.CATALOG), 3000), 0, "a document without the style is skipped");
  assert.equal(RC.normStep({ op: "style", size: 9 }, S.CATALOG), null, "name is required");
  // the Assistant's copy of the catalog and its words
  assert.deepEqual(SH.CATALOGS.layout.style, S.CATALOG.style);
  const w = SH.words("layout", RC.normStep({ op: "style", name: "Body text", size: 10.5, align: "j" }, S.CATALOG));
  assert.equal(w.name, "Change a style");
  assert.equal(w.detail, "Body text: 10.5 pt, justified");
});

test("the wiring: Layout takes the rebuild and a page, the report goes back to the Assistant", () => {
  const ly = read("layout/layout.js");
  assert.match(ly, /if \(tg && tg\.rebuild && typeof tg\.rebuild === "object"\)/);
  assert.match(ly, /st\.rb\[key\] = rep;/);
  assert.match(ly, /if \(tg && typeof tg\.page === "number"\)/);
  assert.match(read("layout/io.js"), /window\.parent\.__orosOpenAt\("assistant", \{ chat: chat \}\)/);
  assert.match(read("fileopen.js"), /hand: function \(file\) \{\n\s+return file && typeof file\.size === "number" \? hold\(ownFile\(file\)\) : "";/);
  const as = read("assistant/assistant.js");
  assert.match(as, /p\.__orosOpenAt\("layout", \{ rebuild: \{ pdf: pdf, src: src, folder: ui\.folder \|\| "", thread: ui\.thread === 1 \? 1 : 0, key: ui\.key, chat: c\.id \} \}\)/);
  assert.match(ly, /LY\.io\.rebuild\(pdf, files\.concat\(r\[2\]\), \{ chat: chat, thread: rq\.thread === 1 \}\)/);
  assert.match(as, /r\.content = "Layout rebuilt the PDF on the device as a new document, now open in Layout\. Report: " \+ JSON\.stringify\(ui\.rep\);/);
  assert.match(as, /if \(sla\) p\.__orosOpenAt\("layout", \{ rebuild: \{ sla: sla, pdf: pdf, src: src, folder: ui\.folder \|\| "", key: ui\.key, chat: c\.id \} \}\);/);
  assert.match(ly, /return LY\.io\.openSla\(sla, files\.concat\(r\[2\]\)\.filter\(LY\.io\.isPicture\), pdf \|\| null\)\.then\(function \(rep\) \{ back\(rep \|\| \{ failed: 1 \}\); \}\);/);
  // every new string in English, Greek and German
  const de = read("i18n/de/assistant.js");
  ["att.dev", "att.devHint", "att.devOnly", "att.devTip", "att.dev.size", "att.dev.count", "att.dev.total", "rb.head", "rb.src", "rb.noSrc",
   "rb.folder", "rb.hint", "rb.go", "rb.working", "rb.failed", "rb.lines", "rb.pics", "rb.styles", "rb.check", "rb.next", "do.f.page",
   "rb.slaHead", "rb.slaPdf", "rb.slaSrc", "rb.slaHint", "rb.slaGo", "rb.slaWorking", "rb.slaFailed", "rb.slaPages", "rb.slaPics", "rb.slaLines"].forEach((k) => {
    assert.equal(as.split('"' + k + '":').length - 1, 2, k + " in EN and EL");
    assert.ok(de.includes('"' + k + '":'), k + " in DE");
  });
});
