// Notes .orosnotes (notes/package.js + bundle.js): one notebook packs
// into content.json and a Markdown preview, reads back as a NEW
// notebook with fresh ids, and hostile content.json is cut down.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const B = require(path.join(ROOT, "bundle.js"));
const P = require(path.join(ROOT, "notes", "package.js"));

const COLORS = ["#e06c75", "#ecc75f", "#87cf3e", "#4fc4cf", "#6d4aff", "#e09ecf", "#f28c5a", "#9aa4b0"];

function sampleState() {
  return {
    notebooks: [{ id: "nb1", name: "Δουλειά", mtime: 100, pos: 0 }, { id: "nb2", name: "Other", mtime: 5, pos: 1 }],
    labels: [{ id: "l1", nb: "nb1", name: "urgent", color: "#e06c75", mtime: 50, pos: 1 },
             { id: "l2", nb: "nb2", name: "elsewhere", color: "#ecc75f", mtime: 50, pos: 2 }],
    pages: [
      { id: "p2", nb: "nb1", parent: "p1", title: "Child", text: "- [ ] task\n[[Root page]]", mtime: 300, pos: 0, labels: [], pinned: false },
      { id: "p1", nb: "nb1", parent: null, title: "Root page", text: "# Hi\n\n**bold**", mtime: 200, pos: 1, labels: ["l1"], pinned: false },
      { id: "p3", nb: "nb1", parent: null, title: "Σημείωση", text: "κείμενο", mtime: 150, pos: 2, labels: [], pinned: true, h: ["x"], ct: 1, st: 1 },
      { id: "px", nb: "nb2", parent: null, title: "Not this one", text: "", mtime: 1, pos: 0, labels: ["l2"], pinned: false }
    ],
    tombs: { gone: 1 }
  };
}

let n = 0;
const uid = (pre) => pre + "-new-" + (++n);

test("build: only this notebook, tree order, Markdown preview with ASCII names", () => {
  const b = P.build(sampleState(), "nb1");
  const c = b.content;
  assert.equal(c.kind, "oros-notes-package");
  assert.equal(c.ver, 1);
  assert.deepEqual(c.notebook, { id: "nb1", name: "Δουλειά", mtime: 100, pos: 0 });
  assert.deepEqual(c.labels.map((l) => l.id), ["l1"]);
  // pinned first, then pos; children right after their parent
  assert.deepEqual(c.pages.map((p) => p.id), ["p3", "p1", "p2"]);
  assert.deepEqual(Object.keys(c.pages[0]).sort(), ["id", "labels", "mtime", "parent", "pinned", "pos", "text", "title"]);
  assert.equal(b.title, "Δουλειά");
  assert.equal(b.modified, 300);
  assert.equal(b.created, 150);
  const names = b.preview.map((p) => p.name);
  assert.deepEqual(names, ["index.md", "pages/001-simeiosi.md", "pages/002-root-page.md", "pages/003-child.md"]);
  names.forEach((nm) => assert.ok(B.safePath("preview/" + nm), nm));
  assert.equal(b.preview[3].data, "# Child\n\n- [ ] task\n[[Root page]]\n");
  assert.match(b.preview[0].data, /^# Δουλειά\n\n- \[Σημείωση\]\(pages\/001-simeiosi\.md\)\n- \[Root page\]\(pages\/002-root-page\.md\)\n  - \[Child\]\(pages\/003-child\.md\)/);
  assert.throws(() => P.build(sampleState(), "nope"), /nonotebook/);
});

test("round trip through a real bundle: a new notebook, fresh ids, nothing else lost", async () => {
  const b = P.build(sampleState(), "nb1");
  const bytes = await B.write({ mime: "application/x-oros-notes", app: "notes", schema: "notes/1", content: b.content,
    meta: { title: b.title, language: "el", generator: "orOS Notes" }, preview: b.preview, media: {} });
  assert.equal(B.sniff(bytes.subarray(0, 128)), "application/x-oros-notes");
  const r = await B.read(bytes, { mime: "application/x-oros-notes" });
  assert.equal(r.meta.title, "Δουλειά");
  const pl = P.parse(r.content, { uid, colors: COLORS });
  assert.notEqual(pl.nb, "nb1");
  assert.equal(pl.notebook.id, pl.nb);
  assert.equal(pl.notebook.name, "Δουλειά");
  assert.equal(pl.labels.length, 1);
  assert.notEqual(pl.labels[0].id, "l1");
  assert.equal(pl.labels[0].color, "#e06c75");
  const byTitle = Object.fromEntries(pl.pages.add.map((p) => [p.title, p]));
  ["Root page", "Child", "Σημείωση"].forEach((t) => assert.ok(byTitle[t], t));
  pl.pages.add.forEach((p) => assert.ok(!["p1", "p2", "p3"].includes(p.id)));
  assert.equal(byTitle.Child.parent, byTitle["Root page"].id);
  assert.equal(byTitle["Root page"].parent, null);
  assert.deepEqual(byTitle["Root page"].labels, [pl.labels[0].id]);
  assert.equal(byTitle.Child.text, "- [ ] task\n[[Root page]]");
  assert.equal(byTitle["Σημείωση"].pinned, true);
  assert.deepEqual(pl.pages.upd, []);
  // opening the same file twice never reuses an id
  const again = P.parse(r.content, { uid, colors: COLORS });
  assert.notEqual(again.nb, pl.nb);
});

test("unzipped folder reads the same", async () => {
  const b = P.build(sampleState(), "nb1");
  const bytes = await B.write({ mime: "application/x-oros-notes", app: "notes", content: b.content, preview: b.preview });
  const z = require(path.join(ROOT, "atelier", "zip.js")).open(bytes);
  const list = [];
  for (const nm of z.names) list.push({ path: "Downloads/Δουλειά/" + nm, bytes: await z.bytes(nm) });
  assert.ok(z.names.includes("preview/pages/003-child.md"));
  assert.ok(!z.names.some((nm) => nm.startsWith("media/")));
  const r = await B.readFolder(list, { mime: "application/x-oros-notes" });
  assert.equal(P.parse(r.content, { uid }).pages.add.length, 3);
});

test("parse: hostile or broken content is cut down, not trusted", () => {
  assert.throws(() => P.parse(null), /notpackage/);
  assert.throws(() => P.parse({ kind: "oros-sheet-package", pages: [] }), /notpackage/);
  assert.throws(() => P.parse({ kind: "oros-notes-package" }), /notpackage/);
  const pl = P.parse({
    kind: "oros-notes-package", ver: 1, notebook: { name: "  " },
    labels: [{ id: "a", name: "ok", color: "red" }, { id: "b", name: "" }, { id: "a", name: "twin" }, { id: 7 }],
    pages: [
      { id: "x", parent: "x", title: 5, text: "a\r\nb", labels: ["a", "a", "b", "zz", 3], pinned: "yes", pos: "nan" },
      { id: "x", title: "twin" },
      { id: "y", parent: "missing", title: "  t\n  two ", text: { evil: 1 }, __proto__: { polluted: 1 } },
      "junk", null
    ]
  }, { uid, colors: COLORS, name: "Notes", untitled: "Untitled" });
  assert.equal(pl.notebook.name, "Notes");
  assert.equal(pl.labels.length, 1);
  assert.equal(pl.labels[0].color, null);           // unknown colour → the app picks one
  assert.equal(pl.pages.add.length, 2);
  const [x, y] = pl.pages.add;
  assert.equal(x.parent, null);                     // self-parent dropped
  assert.equal(x.title, "Untitled");
  assert.equal(x.text, "a\nb");
  assert.deepEqual(x.labels, [pl.labels[0].id]);
  assert.equal(x.pinned, true);
  assert.equal(x.pos, 0);
  assert.equal(y.parent, null);
  assert.equal(y.title, "t two");
  assert.equal(y.text, "");
});

test("parse: page cap", () => {
  const pages = [];
  for (let i = 0; i < P.LIMITS.pages + 3; i++) pages.push({ id: "p" + i, title: "t" + i, text: "" });
  const pl = P.parse({ kind: "oros-notes-package", ver: 1, pages }, { uid });
  assert.equal(pl.pages.add.length, P.LIMITS.pages);
  assert.equal(pl.capped, 3);
});

test("slug: ASCII, Greek transliterated", () => {
  assert.equal(P.slug("Ψώνια για Σάββατο!"), "psonia-gia-savvato");
  assert.equal(P.slug("日本"), "");
  assert.equal(P.slug("a".repeat(100)).length, 60);
});
