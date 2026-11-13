// AS-EPUB (Layout LY-EPUB E4): export_epub in the Assistant and through
// orOS Gate. The model names a Layout document (or its Publishing title);
// Layout makes and checks the EPUB on the device and only numbers and
// check codes come back, never the book's text.
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
global.window = global.window || {};
const C = require("../assistant/core.js");
const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

test("export_epub is offered with Layout, and through the gate", () => {
  assert.ok(!C.toolsFor({}).some((t) => t.name === "export_epub"));
  const tool = C.toolsFor({ epub: true }).find((t) => t.name === "export_epub");
  assert.ok(tool, "offered when Layout is installed");
  assert.deepEqual(Object.keys(tool.params.properties).sort(), ["document", "edition", "layout", "mark_ready", "title"]);
  assert.deepEqual(tool.params.properties.layout.enum, ["reflowable", "fixed", "pictures"]);
  assert.ok(C.GATE_TOOLS.indexOf("export_epub") >= 0 && C.GATE_OPEN.indexOf("export_epub") >= 0);
  const g = C.gateTools(C.toolsFor({ epub: true })).find((t) => t.name === "export_epub");
  assert.ok(g && !C.GATE_BAD.test(g.description), "no card or press through the gate");
  assert.match(read("assistant/core.js"), /if \(opts\.epub\) lines\.push\("When the user wants an e-book \(EPUB\)[^"]*call export_epub/);
});

test("normEpub: a document or a title, a known layout", () => {
  assert.equal(C.normEpub({}).ok, false);
  assert.equal(C.normEpub({ document: "  " }).ok, false);
  assert.equal(C.normEpub({ document: "Book", layout: "comic" }).ok, false);
  assert.deepEqual(C.normEpub({ document: "  Το   βιβλίο ", layout: "fixed", mark_ready: true, edition: "EPUB" }),
    { ok: true, doc: "Το βιβλίο", title: "", edition: "EPUB", layout: "fixed", ready: 1 });
  const t = C.normEpub({ title: "Νύχτα", mark_ready: "yes" });
  assert.equal(t.ok, true);
  assert.equal(t.title, "Νύχτα");
  assert.equal(t.ready, 0, "only true marks it ready");
  assert.equal(t.layout, "");
  assert.equal(C.normEpub({ document: "x".repeat(500) }).doc.length, 120);
});

test("epubReport: numbers and codes only", () => {
  assert.equal(C.epubReport(null), null);
  assert.deepEqual(C.epubReport({ failed: 1, why: "noDoc" }), { failed: true, why: "noDoc" });
  const r = C.epubReport({
    ok: 1, doc: "Book", edition: "EPUB", layout: "reflowable", path: "/internal/Layout/EPUB/Book.epub", bytes: 123456.7,
    chapters: 12, pages: 210, headings: 14, images: 3, noAlt: [4, "x", -1, 9], overset: 2, shapes: 0, rotated: 0,
    fontsMissing: 1, fontsObfuscated: 0, errors: ["frag", "Bad Code <b>", "x".repeat(40)], warnings: ["no-a11y"],
    isbn: "9789609999999", lang: "el", cover: "small", publishing: 1, ready: "yes", text: "the whole book"
  });
  assert.equal(r.document, "Book");
  assert.equal(r.path, "/internal/Layout/EPUB/Book.epub");
  assert.equal(r.bytes, 123456);
  assert.equal(r.chapters, 12);
  assert.deepEqual(r.picturesWithoutDescription, [4, 9]);
  assert.deepEqual(r.errors, ["frag"], "only check codes");
  assert.deepEqual(r.warnings, ["no-a11y"]);
  assert.equal(r.paragraphsLeftOut, 2);
  assert.equal(r.fontsMissing, 1);
  assert.equal(r.shapesLeftOut, undefined);
  assert.equal(r.cover, "small");
  assert.equal(r.linkedToPublishing, true);
  assert.equal(r.markedReady, "yes");
  assert.ok(!JSON.stringify(r).includes("whole book"), "nothing else rides along");
  const f = C.epubReport({ layout: "fixed", pages: 24, path: "/internal/Other/x.epub", isbn: "12<3", lang: "<script>", cover: "big", ready: "maybe" });
  assert.equal(f.layout, "fixed");
  assert.equal(f.chapters, undefined, "a fixed layout counts pages");
  assert.equal(f.path, "");
  assert.equal(f.isbn, "");
  assert.equal(f.language, "");
  assert.equal(f.cover, "none");
  assert.equal(f.markedReady, undefined);
});

test("the card's strings exist in English, Greek and German", () => {
  const keys = ["ep.head", "ep.byTitle", "ep.lay.reflowable", "ep.lay.fixed", "ep.lay.pictures", "ep.edition", "ep.ready", "ep.hint", "ep.go",
    "ep.working", "ep.failed", "ep.noDoc", "ep.noEdition", "ep.busy", "ep.repSum", "ep.repErr", "ep.repOk", "ep.repAlt", "ep.repPath", "ep.repReady"];
  const as = read("assistant/assistant.js"), de = read("i18n/de/assistant.js");
  keys.forEach((k) => {
    const n = as.split("\"" + k + "\":").length - 1;
    assert.equal(n, 2, k + " in EN and EL");
    assert.ok(de.indexOf("\"" + k + "\":") >= 0, k + " in DE");
  });
});

test("Layout takes { epubOut } and reports only numbers", () => {
  const ly = read("layout/layout.js");
  assert.match(ly, /tg\.epubOut && typeof tg\.epubOut === "object"/);
  const fn = ly.slice(ly.indexOf("function epubSummary"), ly.indexOf("var epubBusy"));
  assert.ok(fn.length > 100);
  assert.ok(!/paraText|\.runs|\.t\b\s*\+/.test(fn), "no text of the book in the summary");
  assert.match(read("layout/panels.js"), /epubMarkReady: markInPublishing/);
  assert.ok(read("gate/gate.js").indexOf("\"export_epub\"") >= 0);
});
