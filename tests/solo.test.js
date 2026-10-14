// Single apps (solo.js): "orOS Notes", "orOS Calendar" … installed on
// their own. Keeps the table, the committed pages, manifests and icons
// in step, and checks the launch parameters, shortcuts and shares.
// Run: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const S = require(path.join(ROOT, "solo.js"));
const F = require(path.join(ROOT, "fileopen.js"));
const BASE = JSON.parse(read("manifest.webmanifest"));
const APPS = JSON.parse(read("apps.json")).apps;

test("every single app is a registered internal app with a page, a manifest and icons that match the table", () => {
  assert.ok(S.ids().length >= 4);
  S.ids().forEach((id) => {
    const app = APPS.find((a) => a.id === id);
    assert.ok(app && app.type === "internal", id + ": not an internal app");
    assert.equal(read(id + "/solo.html"), S.pageFor(id, BASE), id + ": solo.html is stale (node tools/solo-manifests.js)");
    assert.deepEqual(JSON.parse(read(id + "/manifest.webmanifest")), S.manifestFor(id, F.table(), BASE),
      id + ": manifest is stale (node tools/solo-manifests.js)");
    ["", "-192", "-512", "-maskable-512"].forEach((k) => {
      const f = "icons/solo/" + id + k + (k ? ".png" : ".svg");
      assert.ok(fs.existsSync(path.join(ROOT, f)), f + " missing (node tools/solo-icons.js)");
    });
    assert.ok(S.nameOf(id, "en").startsWith("orOS "));
    assert.ok(S.nameOf(id, "el").startsWith("orOS "));
  });
});

test("each manifest is its own app: id, scope and every action stay inside /<id>/", () => {
  S.ids().forEach((id) => {
    const m = S.manifestFor(id, F.table(), BASE);
    const scope = "/" + id + "/";
    assert.equal(m.scope, scope);
    assert.equal(m.id, scope + "solo.html");
    assert.equal(m.start_url, scope + "solo.html");
    assert.notEqual(m.id, BASE.id);
    const urls = [m.share_target.action].concat(m.shortcuts.map((s) => s.url), (m.file_handlers || []).map((h) => h.action));
    urls.forEach((u) => assert.ok(u.startsWith(scope + "solo.html?"), id + ": " + u));
    assert.equal(m.share_target.method, "POST");
    assert.ok(m.icons.some((i) => i.purpose === "maskable"));
    assert.equal(m.launch_handler, undefined);   // Dropbox sign-in comes back as a navigation
  });
});

test("file types: a single app opens exactly the types its app opens in orOS", () => {
  const notes = S.manifestFor("notes", F.table(), BASE).file_handlers[0];
  assert.deepEqual(notes.accept, { "text/plain": [".txt"], "text/markdown": [".md", ".markdown"] });
  assert.equal(notes.action, "/notes/solo.html?file-open=notes");
  assert.deepEqual(S.manifestFor("calendar", F.table(), BASE).file_handlers[0].accept, { "text/calendar": [".ics"] });
  assert.equal(S.manifestFor("todo", F.table(), BASE).file_handlers, undefined);
  assert.equal(S.manifestFor("bookmarks", F.table(), BASE).file_handlers, undefined);
  assert.deepEqual(S.manifestFor("calendar", F.table(), BASE).share_target.params.files[0].accept, ["text/calendar", ".ics"]);
  assert.equal(S.manifestFor("todo", F.table(), BASE).share_target.params.files, undefined);
});

test("ids come only from the table: paths and parameters cannot name anything else", () => {
  assert.equal(S.idFromPath("/notes/solo.html"), "notes");
  assert.equal(S.idFromPath("/notes/solo.html/"), "");
  assert.equal(S.idFromPath("/maps/solo.html"), "");          // not a single app (yet)
  assert.equal(S.idFromPath("/../notes/solo.html"), "");
  assert.equal(S.idFromPath("/a/notes/solo.html"), "");
  assert.equal(S.idFromSearch("?solo=todo"), "todo");
  assert.equal(S.idFromSearch("?solo=Todo"), "");
  assert.equal(S.idFromSearch("?solo=__proto__"), "");
  assert.equal(S.idFromSearch("?solo=constructor"), "");
  assert.equal(S.idFromSearch("?x=1"), "");
});

test("host → frame: only the launch parameters travel, bounded; 'do' becomes solo-do", () => {
  assert.equal(S.frameSrc("notes", ""), "/?solo=notes");
  const src = S.frameSrc("notes", "?do=new&share-text=hi&evil=1&solo=maps&open=settings&file-open=notes&share-files=abc");
  const q = new URLSearchParams(src.slice(2));
  assert.equal(q.get("solo"), "notes");
  assert.equal(q.get("solo-do"), "new");
  assert.equal(q.get("share-text"), "hi");
  assert.equal(q.get("file-open"), "notes");
  assert.equal(q.get("share-files"), "abc");
  assert.equal(q.get("evil"), null);
  assert.equal(q.get("open"), null);
  assert.equal(q.getAll("solo").length, 1);
  assert.ok(src.startsWith("/?"));
  const long = S.frameSrc("notes", "?share-text=" + "x".repeat(9000));
  assert.equal(new URLSearchParams(long.slice(2)).get("share-text").length, 4000);
  assert.equal(S.frameSrc("nope", "?do=new"), "");
});

test("icon shortcuts: every manifest shortcut maps to an action the app takes", () => {
  S.ids().forEach((id) => {
    S.manifestFor(id, F.table(), BASE).shortcuts.forEach((sc) => {
      const word = new URL(sc.url, "https://x.invalid").searchParams.get("do");
      const hit = S.shortcut(id, word);
      assert.ok(hit && (hit.target || hit.calNew), id + ": " + word);
    });
  });
  assert.deepEqual(S.shortcut("notes", "new").target, { newPage: true });
  assert.deepEqual(S.shortcut("todo", "new").target, { quickAdd: true });
  assert.deepEqual(S.shortcut("bookmarks", "add").target, { quickAdd: true });
  assert.equal(S.shortcut("calendar", "new").calNew, true);
  assert.equal(S.shortcut("notes", "toString"), null);
  assert.equal(S.shortcut("notes", "zzz"), null);
  // the receivers exist in the apps
  assert.match(read("notes/notes.js"), /t\.newPage === true/);
  assert.match(read("todo/todo.js"), /t && t\.quickAdd/);
  assert.match(read("bookmarks/bookmarks.js"), /t && t\.quickAdd/);
  assert.match(read("shell.js"), /window\.__orosOpenCalendarNew = function/);
});

test("shares: link → bookmark, text → page, task or event; nothing unusable gets through", () => {
  const now = new Date(2026, 9, 14, 10, 0);
  const s1 = S.shareFromSearch("?share-title=Read%20me&share-text=Look%20https%3A%2F%2Fexample.com%2Fa");
  assert.deepEqual(s1, { url: "https://example.com/a", title: "Read me", text: "Look https://example.com/a" });
  assert.deepEqual(S.shareTarget("bookmarks", s1, now), { app: "bookmarks", target: { add: { url: "https://example.com/a", title: "Read me" } } });
  assert.deepEqual(S.shareTarget("notes", s1, now), { app: "notes", target: { add: { title: "Read me", text: "Look https://example.com/a" } } });
  const task = S.shareTarget("todo", { url: "", title: "", text: "Buy milk\nand bread" }, now);
  assert.deepEqual(task, { app: "todo", target: { addItems: { items: [{ text: "Buy milk", note: "and bread" }] } } });
  const ev = S.shareTarget("calendar", { url: "", title: "Dentist", text: "" }, now);
  assert.deepEqual(ev, { calNew: { date: "2026-10-14", title: "Dentist", note: "" } });
  // a bookmark needs a web link
  assert.equal(S.shareTarget("bookmarks", { url: "", title: "x", text: "no link" }, now), null);
  assert.equal(S.shareFromSearch("?share-url=javascript%3Aalert(1)"), null);
  assert.equal(S.shareFromSearch("?share-url=javascript%3Aalert(1)&share-title=t").url, "");
  assert.equal(S.shareTarget("bookmarks", S.shareFromSearch("?share-url=javascript%3Aalert(1)&share-title=t"), now), null);
  assert.equal(S.shareFromSearch("?x=1"), null);
  assert.equal(S.shareFromSearch("?share-text=%20%20"), null);
  // control characters are dropped, lengths bounded
  const t = S.shareFromSearch("?share-text=" + encodeURIComponent("a\u0000b\u0007c" + "y".repeat(30000)));
  assert.ok(t.text.startsWith("abc"));
  assert.equal(t.text.length, 20000);
  assert.ok(S.shareTarget("calendar", { url: "", title: "x".repeat(300), text: "" }, now).calNew.title.length <= 80);
});

test("the shell side: solo.js loads before the shell, which has the solo hooks; sw and sync know single apps", () => {
  const idx = read("index.html");
  const i = idx.indexOf('<script src="solo.js'), j = idx.indexOf('<script src="shell.js'), k = idx.indexOf('<script src="fileopen.js');
  assert.ok(i > 0 && i < j && i < k, "solo.js must load before fileopen.js and shell.js");
  assert.match(idx, /solo-mode/);                       // update broker: background reload
  const sh = read("shell.js");
  ["function soloStart", "function soloHome", "function soloMenuButton", "function soloNotifsOnlyOwn", "if (SOLO) soloStart();",
   "if (SOLO && soloHome()) return;", "if (SOLO) { soloMenuButton(); return; }"].forEach((s) => assert.ok(sh.includes(s), s));
  const sw = read("sw.js");
  assert.match(sw, /solo\\\.html\$\/\.exec\(new URL\(request\.url\)\.pathname\)/);
  assert.match(sw, /url\.search\.indexOf\("solo="\) === -1/);
  const sy = read("sync.js");
  assert.match(sy, /SOLO_RETURN_KEY = "oros-solo-return"/);
  assert.match(sy, /ROUND_LOCK = "oros-sync-round"/);
  assert.match(read("fileopen.js"), /function soloApp\(\)/);
});

test("wave 2: shares into the office apps open a form or dialog; shortcuts reach their receivers", () => {
  const now = new Date(2026, 9, 14, 10, 0);
  const s = { url: "", title: "Plan", text: "Plan\nfirst\nsecond" };
  assert.deepEqual(S.shareTarget("contacts", { url: "", title: "", text: "Maria Papadopoulou\nmaria@example.com" }, now),
    { app: "contacts", target: { cardText: { text: "Maria Papadopoulou\nmaria@example.com" } } });
  assert.deepEqual(S.shareTarget("writer", s, now), { app: "writer", target: { newDoc: { title: "Plan", text: "Plan\nfirst\nsecond" } } });
  assert.deepEqual(S.shareTarget("spreadsheet", { url: "", title: "", text: "a\tb\n1\t2\n\nx,y" }, now),
    { app: "spreadsheet", target: { newSheet: { name: "", rows: [["a", "b"], ["1", "2"], ["x", "y"]] } } });
  assert.deepEqual(S.shareTarget("kanban", s, now), { app: "kanban", target: { asNew: { title: "Plan", note: "first\nsecond" } } });
  assert.deepEqual(S.shareTarget("mindmap", s, now), { app: "mindmap", target: { pasteText: { text: "Plan\nfirst\nsecond" } } });
  assert.deepEqual(S.shareTarget("wiki", s, now), { app: "wiki", target: { newArt: { title: "Plan", text: "Plan\nfirst\nsecond" } } });
  assert.deepEqual(S.shareTarget("wiki", { url: "", title: "", text: "Plan\nbody" }, now), { app: "wiki", target: { newArt: { title: "Plan", text: "body" } } });
  assert.deepEqual(S.shareTarget("slides", s, now), { app: "slides", target: { outline: "# Plan\nPlan\nfirst\nsecond", title: "Plan" } });
  ["contacts", "writer", "spreadsheet", "kanban", "mindmap", "wiki", "slides"].forEach((id) => {
    assert.equal(S.shareTarget(id, { url: "", title: "", text: "" }, now), null, id);
  });
  // the receivers exist in the apps
  [["contacts/contacts.js", /target\.newContact === true/], ["contacts/contacts.js", /CCx\.parse\(ctx\.text/],
   ["writer/writer.js", /t\.newBlank === true/], ["spreadsheet/spreadsheet.js", /tg\.newBlank === true/],
   ["kanban/kanban.js", /tg\.quickAdd === true/], ["mindmap/mindmap.js", /t\.newMap === true \|\| t\.pasteText/],
   ["wiki/wiki.js", /target\.newArt/], ["slides/app.js", /tg\.newDeck === true/]].forEach(([f, re]) => assert.match(read(f), re, f));
});
