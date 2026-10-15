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

// ---------- wave 2: Evernote, Google Keep, Simplenote, Joplin ----------

const ENEX = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export4.dtd">
<en-export export-date="20261015T090000Z" application="Evernote" version="10.0">
  <note>
    <title>Trip &amp; plans</title>
    <created>20261001T100000Z</created>
    <tag>travel</tag><tag>2026 plans</tag>
    <content><![CDATA[<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd">
<en-note><h2>Packing</h2><div>Line one</div><div>Line <b>two</b> with <a href="https://ex.am/p">a link</a></div><div><br/></div>
<ul style="--en-todo:true;"><li style="--en-checked:true;"><div>passport</div></li><li style="--en-checked:false;"><div>charger</div></li></ul>
<div><en-todo checked="true"/>old style</div>
<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2|3</td></tr></table>
<en-media type="image/png" hash="abc"/><div><a href="javascript:alert(1)">bad</a><script>alert(1)</script></div></en-note>]]></content>
    <resource><data encoding="base64">iVBORw0KGgo=</data><mime>image/png</mime><resource-attributes><file-name>map.png</file-name></resource-attributes></resource>
  </note>
  <note><title>Second</title><content><![CDATA[<en-note><p>Para one</p><p>Para&nbsp;two &lt;tag&gt;</p></en-note>]]></content></note>
</en-export>`;

test("Evernote .enex: HTML to Markdown, checklists, tables, tags, pictures counted, unsafe links dropped", async () => {
  const col = await I.collect([file("Travel.enex", ENEX)], Zip);
  const p = I.parse(col, {});
  assert.equal(p.source, "evernote");
  assert.equal(p.name, "Travel");
  assert.equal(p.skipped.attachments, 1);
  const [a, b] = p.notes;
  assert.equal(a.title, "Trip & plans");
  assert.deepEqual(a.tags, ["travel", "2026 plans"]);
  assert.equal(a.text,
    "## Packing\n\nLine one\nLine **two** with [a link](https://ex.am/p)\n\n- [x] passport\n- [ ] charger\n\n- [x] old style\n\n" +
    "| A | B |\n| --- | --- |\n| 1 | 2\\|3 |\n\n📎 map.png\nbad\n");
  assert.equal(b.text, "Para one\n\nPara two <tag>\n");
  const html = MD.render(a.text + b.text, {});
  assert.ok(!/javascript:|<script|<tag>/i.test(html));
  const plan = I.plan(empty(), p, {});
  assert.equal(plan.notebook.name, "Evernote – Travel");
});

test("Evernote: several .enex files become one parent page each", async () => {
  const col = await I.collect([file("A.enex", ENEX), file("B.enex", ENEX)], Zip);
  const p = I.parse(col, {});
  const tops = p.notes.filter((n) => n.parentKey === null).map((n) => n.title);
  assert.deepEqual(tops, ["A", "B"]);
  assert.equal(p.notes.length, 6);
  assert.equal(new Set(I.plan(empty(), p, {}).pages.add.map((x) => x.id)).size, 6);
});

test("Google Keep Takeout: text and lists, labels, pinned, archived, trashed, links", async () => {
  const keep = (o) => JSON.stringify(Object.assign({ isTrashed: false, isArchived: false, isPinned: false, userEditedTimestampUsec: 1 }, o));
  const z = Zip.write([
    { name: "Takeout/Keep/Shop.json", data: keep({ title: "Shop", listContent: [{ text: "milk", isChecked: true }, { text: "eggs", isChecked: false }], labels: [{ name: "home" }], isPinned: true }) },
    { name: "Takeout/Keep/Idea.json", data: keep({ title: "", textContent: "Big idea\nmore", annotations: [{ url: "https://e.x/a", title: "Ref" }], attachments: [{ filePath: "x.jpg" }] }) },
    { name: "Takeout/Keep/Old.json", data: keep({ title: "Old", textContent: "o", isArchived: true }) },
    { name: "Takeout/Keep/Bin.json", data: keep({ title: "Bin", textContent: "b", isTrashed: true }) },
    { name: "Takeout/Keep/Labels.txt", data: "home" },
    { name: "Takeout/Keep/Shop.html", data: "<html></html>" }
  ]);
  const p = I.parse(await I.collect([{ path: "takeout-20261015.zip", bytes: z }], Zip), { archiveTitle: "Archive" });
  assert.equal(p.source, "keep");
  assert.equal(p.skipped.trashed, 1);
  assert.equal(p.skipped.attachments, 1);
  const by = Object.fromEntries(p.notes.map((n) => [n.title, n]));
  assert.equal(by.Shop.text, "- [x] milk\n- [ ] eggs\n");
  assert.ok(by.Shop.pinned);
  assert.deepEqual(by.Shop.tags, ["home"]);
  assert.equal(by["Big idea"].text, "Big idea\nmore\n\n[Ref](https://e.x/a)\n");
  assert.equal(by.Old.parentKey, by.Archive.key);
  assert.equal(I.plan(empty(), p, {}).notebook.name, "Google Keep");
});

test("Simplenote export: first line is the title, tags, pinned, trash counted", async () => {
  const z = Zip.write([
    { name: "source/notes.json", data: JSON.stringify({ activeNotes: [
      { id: "s1", content: "# Recipe\n\nFlour\nWater", tags: ["food"], systemTags: ["pinned", "markdown"] },
      { id: "s2", content: "Just one line" }
    ], trashedNotes: [{ id: "t", content: "x" }] }) },
    { name: "Recipe.txt", data: "# Recipe\n\nFlour\nWater" }
  ]);
  const p = I.parse(await I.collect([{ path: "notes.zip", bytes: z }], Zip), {});
  assert.equal(p.source, "simplenote");
  assert.equal(p.skipped.trashed, 1);
  assert.equal(p.notes.length, 2);
  const r = p.notes.find((n) => n.title === "Recipe");
  assert.equal(r.text, "Flour\nWater");
  assert.ok(r.pinned);
  assert.deepEqual(r.tags, ["food"]);
  assert.equal(p.notes.find((n) => n.title === "Just one line").text, "");
});

// a minimal ustar writer, enough for Joplin's .jex
function tar(files) {
  const parts = [];
  for (const f of files) {
    const data = enc(f.data), h = new Uint8Array(512);
    h.set(enc(f.name).slice(0, 100), 0);
    h.set(enc("0000644\0"), 100);
    h.set(enc(data.length.toString(8).padStart(11, "0") + "\0"), 124);
    h[156] = 48;
    h.set(enc("ustar\0"), 257);
    parts.push(h, data, new Uint8Array((512 - (data.length % 512)) % 512));
  }
  parts.push(new Uint8Array(1024));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
const jid = (c) => c.repeat(32);
const jmeta = (o) => Object.entries(o).map(([k, v]) => k + ": " + v).join("\n");

test("Joplin .jex: notebooks nest, tags, to-dos, note links to [[Title]], resources counted", async () => {
  const bytes = tar([
    { name: jid("a") + ".md", data: "Work\n\n" + jmeta({ id: jid("a"), parent_id: "", type_: 2 }) },
    { name: jid("b") + ".md", data: "Projects\n\n" + jmeta({ id: jid("b"), parent_id: jid("a"), type_: 2 }) },
    { name: jid("c") + ".md", data: "Plan\n\nSee [the spec](:/" + jid("d") + ") and ![img](:/" + jid("e") + ")\n\n" + jmeta({ id: jid("c"), parent_id: jid("b"), is_todo: 0, type_: 1 }) },
    { name: jid("d") + ".md", data: "Spec\n\nBody\n\n" + jmeta({ id: jid("d"), parent_id: jid("a"), is_todo: 1, todo_completed: 1700000000000, type_: 1 }) },
    { name: jid("e") + ".md", data: "img.png\n\n" + jmeta({ id: jid("e"), mime: "image/png", type_: 4 }) },
    { name: "resources/" + jid("e") + ".png", data: "PNG" },
    { name: jid("f") + ".md", data: "urgent\n\n" + jmeta({ id: jid("f"), type_: 5 }) },
    { name: jid("9") + ".md", data: "\n\n" + jmeta({ id: jid("9"), note_id: jid("c"), tag_id: jid("f"), type_: 6 }) }
  ]);
  const p = I.parse(await I.collect([{ path: "export.jex", bytes }], Zip), {});
  assert.equal(p.source, "joplin");
  assert.equal(p.skipped.attachments, 1);
  const by = Object.fromEntries(p.notes.map((n) => [n.title, n]));
  assert.equal(by.Projects.parentKey, by.Work.key);
  assert.equal(by.Plan.parentKey, by.Projects.key);
  assert.equal(by.Plan.text, "See [[Spec|the spec]] and ![img](:/" + jid("e") + ")\n");
  assert.deepEqual(by.Plan.tags, ["urgent"]);
  assert.equal(by.Spec.text, "- [x] Spec\n\nBody\n");
  const pl = I.plan(empty(), p, {});
  assert.equal(pl.notebook.name, "Joplin");
  const plan = Object.fromEntries(pl.pages.add.map((x) => [x.title, x]));
  assert.equal(plan.Plan.parent, plan.Projects.id);
  assert.equal(plan.Projects.parent, plan.Work.id);
});

test("tar reader: refuses a truncated archive, ignores folders", () => {
  assert.throws(() => I.tarOpen(new Uint8Array(10)));
  const t = I.tarOpen(tar([{ name: "a.md", data: "x" }]));
  assert.deepEqual(t.names, ["a.md"]);
});

test("HTML tokenizer: deep or broken markup stays text, never markup", () => {
  const md = I.htmlToMd("<div><b>open <i>never closed<div>" + "<span>".repeat(500) + "deep</div><img src=x onerror=alert(1)><iframe src=//x></iframe>&#0;&#x110000;&bogus;");
  assert.ok(md.includes("deep"));
  assert.ok(!/onerror|<iframe|<img/.test(MD.render(md, {}).replace(/&lt;[^]*?&gt;/g, "")));
});
