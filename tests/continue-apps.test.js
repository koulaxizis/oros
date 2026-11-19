// CONT-1 W3/W4: the apps that tell the shell which item is open
// (continue.js). Each one notes with its own app id, with the same target
// its search provider (or receiver) opens, never before the first tap or
// key (a restored item must not hide the other device's), and only
// through the guarded parent lookup.
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

// app id → [file, the target keys the note sends]
const APPS = {
  writer:      ["writer/writer.js",           ["doc"]],
  notes:       ["notes/notes.js",             ["page", "nb"]],
  spreadsheet: ["spreadsheet/spreadsheet.js", ["sheet"]],
  slides:      ["slides/app.js",              ["deck"]],
  whiteboard:  ["whiteboard/app.js",          ["board"]],
  wiki:        ["wiki/wiki.js",               ["a"]],
  kanban:      ["kanban/kanban.js",           ["board"]],
  mindmap:     ["mindmap/mindmap.js",         ["map"]],
  layout:      ["layout/layout.js",           ["doc"]],
  pad:         ["pad/app.js",                 ["openPath"]],
  forms:       ["forms/app.js",               ["form"]],
  flashcards:  ["flashcards/app.js",          ["deck"]],
  files:       ["files/files.js",             ["path", "dir"]],
  // W4
  library:     ["library/app.js",             ["book"]],
  studio:      ["studio/studio.js",           ["project"]],
  montage:     ["montage/montage.js",         ["project"]],
  atelier:     ["atelier/core.js",            ["doc"]],
  photolab:    ["photolab/app.js",            ["id"]],
  mockups:     ["mockups/mockups.js",         ["id"]],
  travel:      ["travel/travel.js",           ["trip", "tab", "item"]],
  todo:        ["todo/todo.js",               ["list"]],
  base:        ["base/app.js",                ["base"]]
};
// Noted only when the person opens the item (a dialog or a play button,
// never restored at the start), so no first-tap guard.
const ON_OPEN = {
  podcasts:    ["podcasts/podcasts.js",       ["show", "ep", "play"], "function contNote(m)", "contNote(m);"],
  meals:       ["meals/meals.js",             ["recipe"],             "function contNote(r)", "contNote(r);"]
};

const NEVER = require("../continue.js").NEVER;

for (const [id, [file, keys]] of Object.entries(APPS)) {
  test(`CONT-1 ${id}: notes its item after the first tap, with its own id`, () => {
    const src = read(file);
    let at = src.indexOf("function contNote()");
    if (at < 0) at = src.indexOf(".contNote = function ()");
    assert.ok(at > 0, "contNote defined");
    const body = src.slice(at, at + 900);
    assert.match(body, /if \(!contLive\) return;/, "nothing before the first tap or key");
    assert.match(body, /window\.parent !== window \? window\.parent\.orosContinue : null/, "guarded parent lookup");
    assert.ok(body.includes(`.note(${src.includes(`.note('${id}'`) ? `'${id}'` : `"${id}"`}`), "own app id");
    const tm = body.match(/target: \{([^}]*)\}/);
    assert.ok(tm, "a target object");
    const sent = tm[1].split(",").map((s) => s.split(":")[0].trim()).filter(Boolean);
    assert.deepStrictEqual(sent, keys, "target keys");
    assert.match(body, /title: /, "a title");
    assert.ok(!/text:|content:|\.text\b|\.x\b/.test(tm[1]), "never content in the target");
    // the once-listener turns it on
    assert.match(src, /contLive = true;\s*(LIB\.|PL\.)?contNote\(\);/);
    assert.match(src, /addEventListener\("pointerdown", once, true\)|addEventListener\('pointerdown', once, true\)/);
    // called from the place that opens an item (more than the definition + the once call)
    const calls = (src.match(/contNote\(\);/g) || []).length +
      (id === "library" ? (read("library/reader.js").match(/LIB\.contNote\(\);/g) || []).length : 0);
    assert.ok(calls >= 2, "called where an item opens");
    assert.ok(!NEVER.includes(id), "not a never-recorded app");
  });
}

for (const [id, [file, keys, def, call]] of Object.entries(ON_OPEN)) {
  test(`CONT-1 ${id}: notes the item the person opens, with its own id`, () => {
    const src = read(file);
    const at = src.indexOf(def);
    assert.ok(at > 0, "contNote defined");
    const body = src.slice(at, at + 600);
    assert.match(body, /window\.parent !== window \? window\.parent\.orosContinue : null/);
    assert.ok(body.includes(`.note("${id}"`), "own app id");
    const tm = body.match(/target: \{([^}]*)\}/);
    assert.deepStrictEqual(tm[1].split(",").map((x) => x.split(":")[0].trim()), keys);
    assert.ok(src.includes(call), "called where the item opens");
    assert.ok(!NEVER.includes(id));
  });
}

test("CONT-1 Kanban: a target with the board alone opens that board", () => {
  const src = read("kanban/kanban.js");
  assert.match(src, /typeof tg\.board === "string" && !tg\.col && !tg\.card && boardById\(tg\.board\)\) switchBoard\(tg\.board\)/);
});

test("CONT-1 Pad: only files of the orOS disk are noted", () => {
  const src = read("pad/app.js");
  const at = src.indexOf("function contNote()");
  assert.match(src.slice(at, at + 700), /loc\.kind === "disk"[^\n]*\/\^\\\/internal\\\/\.\//);
});

test("CONT-1 Files: never the top folder or the trash", () => {
  const src = read("files/files.js");
  const at = src.indexOf("function contNote()");
  const body = src.slice(at, at + 700);
  assert.match(body, /cwd\.indexOf\(ROOT \+ "\/"\) !== 0/);
  assert.match(body, /CORE\.isTrashPath\(cwd\)/);
});
