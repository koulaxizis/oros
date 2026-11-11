// New users, extra idea 3: templates in the friendly empty screens
// (TPL-1, emptykit.js 1.2.0 `starters`). Real data is written only when
// a template is tapped, through the app's own save and Undo.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const K = require(path.join(ROOT, "emptykit.js"));

function cut(src, name) {
  const i = src.indexOf("  function " + name + "(");
  if (i < 0) throw new Error("missing function " + name);
  let depth = 0, j = src.indexOf("{", i);
  for (; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) break;
  }
  return src.slice(i, j + 1);
}

test("kit: starters are buttons through textContent, at most four, the app's run on tap only", () => {
  const src = read("emptykit.js");
  const st = cut(src, "starters");
  assert.match(st, /b\.textContent = String\(x\.label\);/);
  assert.match(st, /\.slice\(0, 4\)/);
  assert.match(st, /b\.addEventListener\("click", function \(e\) \{ e\.stopPropagation\(\); x\.run\(\); \}\);/);
  assert.doesNotMatch(st, /innerHTML|localStorage/);
  assert.match(src, /if \(Array\.isArray\(opts\.starters\)\) starters\(el, opts\.starters\);/);
  assert.match(src, /ek-\(art\|act\|acts\|tpl\|ex\)/, "the row is the kit's own, never a title or text");
  for (const l of ["en", "el", "de"]) assert.ok(K.STR[l].tpl.length > 5, l);
  const css = read("emptykit.css");
  assert.match(css, /\.ek \.ek-chip \{\n  min-height: 40px;/);
  assert.match(css, /\.ek\.ek-ex-on > \.ek-tpl \{ display: none; \}/);
});

test("To-Do: two starter lists, written on tap, taken back by Undo", () => {
  const js = read("todo/todo.js"), de = read("i18n/de/todo.js");
  assert.match(js, /var STARTERS = \["pack", "move"\];/);
  const f = cut(js, "starterList");
  assert.match(f, /var list = freshList\(t\("st\." \+ key\)\);/);
  assert.match(f, /undoFn = function \(\) \{ importUndo\(back\); \};/);
  assert.match(f, /lists: \[list\.id\]/);
  assert.match(js, /starters: STARTERS\.map\(function \(k\) \{ return \{ label: t\("st\." \+ k\), run: function \(\) \{ starterList\(k\); \} \}; \}\)/);
  for (const k of ["st.pack", "st.pack.items", "st.move", "st.move.items", "st.done"]) {
    assert.equal((js.match(new RegExp('"' + k.replace(/\./g, "\\.") + '":', "g")) || []).length, 2, k + " EN + EL");
    assert.ok(de.includes('"' + k + '":'), k + " DE");
  }
  const tables = [...js.matchAll(/"st\.(pack|move)\.items":\s*"([^"]+)"/g)];
  for (const m of tables) assert.equal(m[2].split("\\n").length, 8, m[1] + " has 8 tasks");
});

test("Kanban: Trip and Moving house join the built-in boards; three are starters", () => {
  const T = require(path.join(ROOT, "kanban/tools.js"));
  for (const lang of ["en", "el"]) {
    const keys = T.builtinList(lang).map((x) => x.key);
    assert.ok(keys.includes("trip") && keys.includes("move"));
    for (const k of ["trip", "move"]) {
      const b = T.builtinBoard(k, lang);
      assert.ok(b.name && b.columns.every((c) => c.name) && b.labels.every((l) => l.name), k + " " + lang + " words");
      assert.ok(b.columns.some((c) => c.cards.length), k);
    }
  }
  const de = read("i18n/de/kanban.js");
  for (const k of ["tplb.trip.name", "tplb.trip.col.3", "tplb.move.name", "tplb.move.card.2.sub.1"]) assert.ok(de.includes('"' + k + '":'), k);
  const js = read("kanban/kanban.js");
  assert.match(js, /\["trip", "move", "personal"\]\.indexOf\(x\.key\) !== -1/);
  assert.match(js, /run: function \(\) \{ boardFrom\(T\.builtinBoard\(x\.key, LANG\), x\.name\); \}/);
  assert.match(cut(js, "boardFrom"), /pushUndo\("tpl\.created"\);/, "the board's own Undo");
});
