// Notes import (notes/import.js): Obsidian vaults, folders / zips of
// Markdown, Standard Notes backups (incl. "Super" notes), the plan
// with stable ids (a second import updates, never duplicates).
// Run: node --test tests/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const I = require(path.join(__dirname, "..", "notes/import.js"));
const Zip = require(path.join(__dirname, "..", "atelier/zip.js"));
const MD = require(path.join(__dirname, "..", "notes/md.js"));

const enc = (s) => new TextEncoder().encode(s);
const file = (p, s) => ({ path: p, bytes: enc(s) });
const empty = () => ({ notebooks: [{ id: "nb-default", name: "Notes", mtime: 0, pos: 0 }], pages: [], labels: [], tombs: {} });

test("front matter: tags and title out, other keys kept", () => {
  const r = I.frontMatter("---\ntitle: Hello\ntags: [a, b]\nstatus: draft\n---\nBody #c\n");
  assert.deepEqual(r.tags, ["a", "b"]);
  assert.equal(r.title, "Hello");
  assert.equal(r.text, "---\nstatus: draft\n---\nBody #c\n");
  const l = I.frontMatter("---\ntags:\n  - x\n  - \"y z\"\n---\n\nText");
  assert.deepEqual(l.tags, ["x", "y z"]);
  assert.equal(l.text, "Text");
  assert.equal(I.frontMatter("no front matter").text, "no front matter");
});

test("inline tags: not in code, not headings, not numbers, not URLs", () => {
  const t = I.inlineTags("# Heading\nSome #idea and #area/sub, #123 http://x.y/#frag\n`#code`\n```\n#fenced\n```\n(#paren)");
  assert.deepEqual(t, ["idea", "area/sub", "paren"]);
});

test("wiki links: folder paths and headings to orOS form, embeds untouched", () => {
  const titles = { note: 1 };
  assert.equal(I.fixWiki("[[a/b/Note#Part|see]] [[Note.md]] ![[pic.png]] [[Other]]", titles),
    "[[Note|see]] [[Note]] ![[pic.png]] [[Other]]");
});

test("orOS export and Bear title line dropped", () => {
  const md = MD.pageMarkdown("My page", "Hello");
  assert.equal(I.dropTitleLine(md, "My page").trim(), "Hello");
  assert.equal(I.dropTitleLine("# Else\nx", "My page"), "# Else\nx");
});

test("Obsidian vault folder: tree, folder notes, tags, hidden folders skipped", async () => {
  const col = await I.collect([
    file("Vault/.obsidian/app.json", "{}"),
    file("Vault/Projects.md", "Folder note #proj"),
    file("Vault/Projects/Alpha.md", "---\ntags: work\n---\nSee [[Projects/Beta]]"),
    file("Vault/Projects/Beta.md", "Beta"),
    file("Vault/Inbox.md", "Hi"),
    file("Vault/.trash/Old.md", "gone"),
    { path: "Vault/img.png", bytes: new Uint8Array([1, 2]) }
  ], Zip);
  const p = I.parse(col, {});
  assert.equal(p.source, "obsidian");
  assert.equal(p.name, "Vault");
  assert.equal(p.skipped.attachments, 1);
  const by = Object.fromEntries(p.notes.map((n) => [n.title, n]));
  assert.deepEqual(Object.keys(by).sort(), ["Alpha", "Beta", "Inbox", "Projects"]);
  assert.equal(by.Projects.text, "Folder note #proj");
  assert.deepEqual(by.Projects.tags, ["proj"]);
  assert.equal(by.Alpha.parentKey, by.Projects.key);
  assert.equal(by.Alpha.text, "See [[Beta]]");
  assert.deepEqual(by.Alpha.tags, ["work"]);
  assert.equal(by.Inbox.parentKey, null);
});

test("zip of Markdown: generic source, named after the archive", async () => {
  const z = Zip.write([{ name: "Daily/2026-10-01.md", data: "Day" }, { name: "Ideas.txt", data: "Idea" }]);
  const col = await I.collect([{ path: "export.zip", bytes: z }], Zip);
  const p = I.parse(col, {});
  assert.equal(p.source, "markdown");
  assert.equal(p.name, "export");
  assert.deepEqual(p.notes.map((n) => n.title).sort(), ["2026-10-01", "Daily", "Ideas"]);
});

const sn = {
  version: "004",
  items: [
    { uuid: "n1", content_type: "Note", content: { title: "Plain", text: "Hello", references: [], appData: { "org.standardnotes.sn": { pinned: true } } } },
    { uuid: "n2", content_type: "Note", content: { title: "", text: "First line\nmore", references: [] } },
    { uuid: "n3", content_type: "Note", content: { title: "Bin", text: "x", trashed: true, references: [] } },
    { uuid: "n4", content_type: "Note", content: { title: "Old", text: "y", archived: true, references: [] } },
    { uuid: "n5", content_type: "Note", content: { title: "Super", noteType: "super", references: [], text: JSON.stringify({ root: { children: [
      { type: "heading", tag: "h2", children: [{ type: "text", text: "Head" }] },
      { type: "paragraph", children: [{ type: "text", text: "bold", format: 1 }, { type: "text", text: " and " }, { type: "link", url: "https://e.x", children: [{ type: "text", text: "link" }] }] },
      { type: "list", listType: "check", children: [{ type: "listitem", checked: true, children: [{ type: "text", text: "done" }] }, { type: "listitem", children: [{ type: "text", text: "todo" }] }] },
      { type: "code", language: "js", children: [{ type: "code-highlight", text: "a()" }, { type: "linebreak" }, { type: "code-highlight", text: "b()" }] }
    ] } }) } },
    { uuid: "n6", content_type: "Note", content: "004:encrypted..." },
    { uuid: "t1", content_type: "Tag", content: { title: "work", references: [{ uuid: "n1", content_type: "Note" }] } },
    { uuid: "t2", content_type: "Tag", content: { title: "sub", references: [{ uuid: "n1", content_type: "Note" }, { uuid: "t1", content_type: "Tag", reference_type: "TagToParentTag" }] } }
  ]
};

test("Standard Notes backup: notes, tags with parents, pinned, archived, trashed, encrypted, Super", async () => {
  const col = await I.collect([file("Standard Notes Backup and Import File.txt", JSON.stringify(sn))], Zip);
  const p = I.parse(col, { archiveTitle: "Archive" });
  assert.equal(p.source, "standardnotes");
  assert.equal(p.skipped.trashed, 1);
  assert.equal(p.skipped.encrypted, 1);
  const by = Object.fromEntries(p.notes.map((n) => [n.title, n]));
  assert.ok(by.Plain.pinned);
  assert.deepEqual(by.Plain.tags.sort(), ["work", "work/sub"]);
  assert.ok(by["First line"]);
  assert.equal(by.Old.parentKey, by.Archive.key);
  assert.equal(by.Super.text, "## Head\n\n**bold** and [link](https://e.x)\n\n- [x] done\n- [ ] todo\n\n```js\na()\nb()\n```\n");
});

test("plan: notebook, labels, ids stable; second import updates instead of duplicating", async () => {
  const col = await I.collect([file("V/.obsidian/x.json", "{}"), file("V/A.md", "one #t"), file("V/F/B.md", "two #t")], Zip);
  const parsed = I.parse(col, {});
  const st = empty();
  const pl = I.plan(st, parsed, {});
  assert.equal(pl.notebook.name, "Obsidian – V");
  assert.equal(pl.pages.add.length, 3);
  assert.equal(pl.labels.length, 1);
  const b = pl.pages.add.find((x) => x.title === "B");
  assert.equal(pl.pages.add.find((x) => x.id === b.parent).title, "F");
  // apply as the app does
  st.notebooks.push({ id: pl.nb, name: pl.notebook.name, mtime: 1, pos: 1 });
  pl.labels.forEach((l) => st.labels.push({ id: l.id, nb: pl.nb, name: l.name, color: "#000", mtime: 1, pos: 0 }));
  pl.pages.add.forEach((x) => st.pages.push(Object.assign({ nb: pl.nb, mtime: 1 }, x)));
  // same source again, A changed
  const col2 = await I.collect([file("V/.obsidian/x.json", "{}"), file("V/A.md", "one changed #t"), file("V/F/B.md", "two #t"), file("V/C.md", "new")], Zip);
  const again = I.plan(st, I.parse(col2, {}), {});
  assert.equal(again.notebook, null);
  assert.deepEqual(again.pages.add.map((x) => x.title), ["C"]);
  assert.equal(again.pages.upd.length, 0);
  assert.equal(again.labels.length, 0);
  const withUpd = I.plan(st, I.parse(col2, {}), { upd: true });
  assert.deepEqual(withUpd.pages.upd.map((x) => x.text), ["one changed #t"]);
  // a page deleted here does not come back while the notebook lives
  st.pages = st.pages.filter((x) => x.title !== "A");
  st.tombs[pl.pages.add.find((x) => x.title === "A").id] = 5;
  const after = I.plan(st, I.parse(col, {}), {});
  assert.equal(after.gone, 1);
  assert.equal(after.pages.add.length, 0);
});

test("limits: big text cut, hostile zip entries counted not crashed", async () => {
  const big = "x".repeat(I.LIMITS.file + 10);
  const col = await I.collect([file("n/Big.md", big), { path: "bad.zip", bytes: enc("not a zip") }], Zip);
  assert.equal(col.unreadable, 1);
  const p = I.parse(col, {});
  assert.equal(p.notes[0].text.length, I.LIMITS.file);
  assert.equal(p.skipped.cut, 1);
});

test("imported text renders safely (no markup from the source)", async () => {
  const col = await I.collect([file("x/Evil.md", "<script>alert(1)</script> <img src=x onerror=alert(1)> [a](javascript:alert(1))")], Zip);
  const html = MD.render(I.parse(col, {}).notes[0].text, {});
  assert.ok(!/<script|<img|javascript:/i.test(html.replace(/&lt;[^]*?&gt;/g, "")));
  assert.ok(!/href="javascript/i.test(html));
});
