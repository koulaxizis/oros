// DOCK-CLEAR (Chris 2026-11-22): the local-folders bar and the toast
// stack keep clear of a pinned Dock (launcher.js --tb-h / --ld-s*).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

test("the local-folders bar sits above a bottom Dock and centres between side Docks", () => {
  const rule = read("style.css").match(/#oros-local-bar \{[^}]*\}/)[0];
  assert.match(rule, /bottom: calc\(12px \+ var\(--tb-h, 0px\) \+ env\(safe-area-inset-bottom, 0px\)\)/);
  assert.match(rule, /left: calc\(50% \+ \(var\(--ld-sl, 0px\) - var\(--ld-sr, 0px\)\) \/ 2\)/);
});

test("every toast position keeps clear of the Dock at its edge", () => {
  const src = read("notifications.js");
  const fn = src.slice(src.indexOf("var T_TOP"), src.indexOf("return map[position]"));
  const map = new Function(fn + "return map; }\nreturn getPositionStyles;")()();
  for (const k of Object.keys(map)) {
    const s = map[k];
    if (s.bottom && s.bottom !== "auto") assert.match(s.bottom, /var\(--tb-h,0px\)/, k);
    if (s.top && s.top !== "auto" && s.top !== "50%") assert.match(s.top, /var\(--ld-st,0px\)/, k);
    if (s.left && s.left !== "auto" && s.left !== "50%") assert.match(s.left, /var\(--ld-sl,0px\)/, k);
    if (s.right && s.right !== "auto") assert.match(s.right, /var\(--ld-sr,0px\)/, k);
  }
  assert.strictEqual(Object.keys(map).length, 8);
});
