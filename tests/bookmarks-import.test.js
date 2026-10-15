// Bookmarks wave 5: import from read-later apps and browser backups
// (bookmarks/import.js): Instapaper CSV, wallabag JSON, Linkwarden
// backup, linkding JSON, Firefox .json backup, Chromium "Bookmarks";
// the older formats still go through core.parseImport. The plan:
// stable ids, folders matched by name, links already here skipped,
// only http(s), no page content.
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const I = require("../bookmarks/import.js");

const EMPTY = { items: {}, folders: { unsorted: { id: "unsorted", name: "unsorted", pos: 0, modified: 0 } } };

const INSTAPAPER = [
  "URL,Title,Selection,Folder,Timestamp,Tags",
  "https://a.example/one,One,\"A quote, with comma\",Unread,1700000000,\"[\"\"news\"\",\"\"long\"\"]\"",
  "https://b.example/two,Two,,Archive,1700100000,",
  "https://c.example/three,Three,,Starred,1700200000,",
  "https://d.example/four,Four,,Recipes,1700300000,",
  "ftp://e.example/five,Five,,Unread,1700400000,"
].join("\n");

test("instapaper: folders, star, selection, tags, timestamp", () => {
  const r = I.parse(INSTAPAPER, "instapaper-export.csv");
  assert.equal(r.kind, "instapaper");
  assert.equal(r.entries.length, 5);
  const [a, b, c, d] = r.entries;
  assert.deepEqual(a.path, ["Instapaper"]);
  assert.deepEqual(a.tags, ["news", "long"]);
  assert.equal(a.note, "A quote, with comma");
  assert.equal(a.added, 1700000000000);
  assert.deepEqual(b.path, ["Instapaper", "Archive"]);
  assert.equal(c.fav, true);
  assert.deepEqual(c.path, ["Instapaper"]);
  assert.deepEqual(d.path, ["Instapaper", "Recipes"]);
  const p = I.plan(EMPTY, r);
  assert.equal(p.items.length, 4);
  assert.equal(p.bad, 1);                     // ftp is not a web address
  assert.equal(p.folders.length, 3);          // Instapaper, Archive, Recipes
  assert.equal(p.from, 1700000000000);
  assert.equal(p.to, 1700300000000);
});

test("instapaper: localized folder names", () => {
  const r = I.parse(INSTAPAPER, "x.csv", { archive: "Αρχείο" });
  assert.deepEqual(r.entries[1].path, ["Instapaper", "Αρχείο"]);
});

const WALLABAG = JSON.stringify([
  { id: 1, title: "Read me", url: "https://w.example/a", is_archived: 0, is_starred: 1, tags: ["x", { label: "y" }],
    created_at: "2023-05-01T10:00:00+02:00", content: "<p>FULL ARTICLE <script>alert(1)</script></p>", reading_time: 3 },
  { id: 2, title: "Old", url: "https://w.example/b", is_archived: 1, is_starred: 0, tags: [], created_at: "2022-01-01T00:00:00Z", content: "x" },
  { id: 3, title: "JS", url: "javascript:alert(1)", is_archived: 0, is_starred: 0 }
]);

test("wallabag: metadata only, archive folder, star", () => {
  const r = I.parse(WALLABAG, "wallabag.json");
  assert.equal(r.kind, "wallabag");
  assert.equal(r.entries.length, 3);
  assert.equal(r.entries[0].fav, true);
  assert.deepEqual(r.entries[0].tags, ["x", "y"]);
  assert.deepEqual(r.entries[0].path, ["wallabag"]);
  assert.deepEqual(r.entries[1].path, ["wallabag", "Archive"]);
  assert.equal(r.entries[0].added, Date.parse("2023-05-01T08:00:00Z"));
  assert.ok(!JSON.stringify(r).includes("FULL ARTICLE"));
  const p = I.plan(EMPTY, r);
  assert.equal(p.items.length, 2);
  assert.equal(p.bad, 1);
  assert.ok(!JSON.stringify(p).includes("FULL ARTICLE"));
});

test("linkwarden: collections → folders, nested by parentId, tags", () => {
  const j = { collections: [
    { id: 1, name: "Work", links: [{ name: "Doc", url: "https://l.example/doc", description: "d", tags: [{ name: "t1" }], createdAt: "2024-02-02T00:00:00.000Z" }] },
    { id: 2, name: "Sub", parentId: 1, links: [{ name: "Inner", url: "https://l.example/in", tags: [] }] },
    { id: 3, name: "Bad", links: [null, { url: 5 }] }
  ] };
  const r = I.parse(JSON.stringify(j), "backup.json");
  assert.equal(r.kind, "linkwarden");
  assert.equal(r.entries.length, 2);
  assert.deepEqual(r.entries[0].path, ["Work"]);
  assert.deepEqual(r.entries[0].tags, ["t1"]);
  assert.equal(r.entries[0].note, "d");
  assert.deepEqual(r.entries[1].path, ["Work", "Sub"]);
  const p = I.plan(EMPTY, r);
  assert.equal(p.folders.length, 2);
  assert.equal(p.folders[1].parent, p.folders[0].id);
  assert.equal(p.items[1].folderId, p.folders[1].id);
});

test("linkding JSON: results → Unsorted with tags and dates", () => {
  const j = { count: 1, results: [{ id: 9, url: "https://k.example/", title: "", website_title: "Site", description: "about",
    tag_names: ["a", "b"], date_added: "2021-03-04T05:06:07Z", unread: true, shared: false }] };
  const r = I.parse(JSON.stringify(j), "linkding.json");
  assert.equal(r.kind, "linkding");
  assert.equal(r.entries[0].title, "Site");
  assert.deepEqual(r.entries[0].path, []);
  const p = I.plan(EMPTY, r);
  assert.equal(p.items[0].folderId, "unsorted");
  assert.deepEqual(p.items[0].tags, ["a", "b"]);
});

const FIREFOX = { guid: "root________", title: "", type: "text/x-moz-place-container", root: "placesRoot", children: [
  { guid: "menu________", title: "menu", type: "text/x-moz-place-container", root: "bookmarksMenuFolder", children: [
    { title: "Mozilla", type: "text/x-moz-place", uri: "https://www.mozilla.org/", dateAdded: 1600000000000000, tags: "moz,web" },
    { type: "text/x-moz-place-separator" },
    { title: "Recent", type: "text/x-moz-place", uri: "place:sort=8&maxResults=10" },
    { title: "Dev", type: "text/x-moz-place-container", children: [
      { title: "Deep", type: "text/x-moz-place-container", children: [
        { title: "MDN", type: "text/x-moz-place", uri: "https://developer.mozilla.org/", dateAdded: 1610000000000000,
          annos: [{ name: "bookmarkProperties/description", value: "docs" }] }
      ] }
    ] }
  ] },
  { guid: "toolbar_____", title: "toolbar", type: "text/x-moz-place-container", root: "toolbarFolder", children: [
    { title: "Wiki", type: "text/x-moz-place", uri: "https://wikipedia.org/" },
    { title: "file", type: "text/x-moz-place", uri: "file:///etc/passwd" }
  ] },
  { guid: "tags________", title: "tags", type: "text/x-moz-place-container", root: "tagsFolder", children: [
    { title: "moz", type: "text/x-moz-place-container", children: [{ type: "text/x-moz-place", uri: "https://tagged.example/" }] }
  ] },
  { guid: "unfiled_____", title: "unfiled", type: "text/x-moz-place-container", root: "unfiledBookmarksFolder", children: [
    { title: "U", type: "text/x-moz-place", uri: "http://u.example/x" }
  ] }
] };

test("firefox backup: roots, nesting, place: and separators skipped, µs dates", () => {
  const r = I.parse(JSON.stringify(FIREFOX), "bookmarks-2024-01-01.json");
  assert.equal(r.kind, "firefox");
  const by = {};
  r.entries.forEach((e) => { by[e.title] = e; });
  assert.deepEqual(Object.keys(by).sort(), ["MDN", "Mozilla", "U", "Wiki", "file"]);
  assert.deepEqual(by.Mozilla.path, []);
  assert.deepEqual(by.Mozilla.tags, ["moz", "web"]);
  assert.equal(by.Mozilla.added, 1600000000000);
  assert.deepEqual(by.MDN.path, ["Dev", "Deep"]);
  assert.equal(by.MDN.note, "docs");
  assert.deepEqual(by.Wiki.path, ["Bookmarks Toolbar"]);
  assert.deepEqual(by.U.path, ["Other Bookmarks"]);
  const p = I.plan(EMPTY, r);
  assert.equal(p.items.length, 4);
  assert.equal(p.bad, 1);
});

test("chromium Bookmarks file: bar / other / synced, 1601 µs dates", () => {
  const j = { checksum: "x", version: 1, roots: {
    bookmark_bar: { type: "folder", name: "Bookmarks bar", children: [
      { type: "url", name: "G", url: "https://g.example/", date_added: "13300000000000000" },
      { type: "folder", name: "News", children: [{ type: "url", name: "N", url: "https://n.example/" }] }
    ] },
    other: { type: "folder", name: "Other bookmarks", children: [{ type: "url", name: "O", url: "https://o.example/" },
      { type: "url", name: "C", url: "chrome://settings" }] },
    synced: { type: "folder", name: "Mobile bookmarks", children: [{ type: "url", name: "M", url: "https://m.example/" }] }
  } };
  const r = I.parse(JSON.stringify(j), "Bookmarks");
  assert.equal(r.kind, "chromium");
  const by = {};
  r.entries.forEach((e) => { by[e.title] = e; });
  assert.deepEqual(by.G.path, ["Bookmarks bar"]);
  assert.deepEqual(by.N.path, ["Bookmarks bar", "News"]);
  assert.deepEqual(by.O.path, []);
  assert.deepEqual(by.M.path, ["Mobile bookmarks"]);
  assert.equal(by.G.added, Math.floor(13300000000000000 / 1000 - 11644473600000));
  assert.equal(I.plan(EMPTY, r).bad, 1);
});

test("plan: links already here skipped, folders matched by name, stable ids", () => {
  const data = {
    items: { a1: { id: "a1", url: "https://a.example/one", folderId: "unsorted" } },
    folders: { unsorted: EMPTY.folders.unsorted, f1: { id: "f1", name: "instapaper", pos: 1, modified: 1 } }
  };
  const r = I.parse(INSTAPAPER, "x.csv");
  const p = I.plan(data, r);
  assert.equal(p.here, 1);
  assert.equal(p.items.length, 3);
  // "Instapaper" matched the existing folder (any case): only Archive and Recipes are new
  assert.deepEqual(p.folders.map((f) => f.name).sort(), ["Archive", "Recipes"]);
  assert.ok(p.folders.every((f) => f.parent === "f1"));
  const p2 = I.plan(data, r);
  assert.deepEqual(p2.items.map((x) => x.id), p.items.map((x) => x.id));
  assert.ok(p.items.every((x) => /^imp-[a-z0-9]+$/.test(x.id)));
  // after applying, a second plan adds nothing
  const after = { items: Object.assign({}, data.items), folders: Object.assign({}, data.folders) };
  p.folders.forEach((f) => { after.folders[f.id] = { id: f.id, name: f.name, parent: f.parent, pos: 9, modified: 2 }; });
  p.items.forEach((x) => { after.items[x.id] = x; });
  const p3 = I.plan(after, r);
  assert.equal(p3.items.length, 0);
  assert.equal(p3.folders.length, 0);
  assert.equal(p3.here, 4);
});

test("plan: dupes inside the file and tracking variants count once", () => {
  const csv = "URL,Title,Selection,Folder,Timestamp\nhttps://x.example/p?utm_source=a,A,,Unread,1\nhttp://www.x.example/p/,B,,Unread,2\n";
  const p = I.plan(EMPTY, I.parse(csv, "i.csv"));
  assert.equal(p.items.length, 1);
  assert.equal(p.here, 1);
});

test("plan: no folder made for a branch whose links are all here", () => {
  const data = { items: { z: { id: "z", url: "https://d.example/four" } }, folders: EMPTY.folders };
  const p = I.plan(data, I.parse(INSTAPAPER, "x.csv"));
  assert.ok(!p.folders.some((f) => f.name === "Recipes"));
});

test("older formats still go through core: Netscape, Pocket CSV", () => {
  const html = "<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<DL><p><DT><H3>F</H3><DL><p><DT><A HREF=\"https://n.example/\" ADD_DATE=\"1600000000\">N</A></DL><p></DL>";
  const r = I.parse(html, "bookmarks.html");
  assert.equal(r.kind, "netscape");
  assert.deepEqual(r.entries[0].path, ["F"]);
  const pocket = "title,url,time_added,tags,status\nT,https://p.example/,1600000000,a|b,unread\n";
  assert.equal(I.parse(pocket, "part_000000.csv").kind, "pocket");
});

test("unknown or broken JSON gives nothing", () => {
  assert.deepEqual(I.parse("{\"hello\":1}", "x.json"), { kind: "", entries: [] });
  assert.equal(I.parse("[1,2,3]", "x.json").entries.length, 0);
  assert.equal(I.parse("{broken", "x.json").entries.length, 0);
});
