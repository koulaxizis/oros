// My style for the Assistant (wave AC4, Assistant side): read_in_app
// carries the summary of the user's own designs for the design's kind,
// and reads it on its own (designs "style", one kind or every kind)
// with Atelier's read permission; the words in EN, EL and DE.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const C = require(path.join(ROOT, "assistant/core.js"));
const CMD = require(path.join(ROOT, "atelier/commands.js"));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

test("read_in_app takes designs style for Atelier only", () => {
  const cats = { atelier: CMD, writer: require(path.join(ROOT, "writer/commands.js")) };
  assert.deepEqual(C.normReadApp({ app: "atelier", designs: "style", name: "square" }, cats), { ok: true, app: "atelier", designs: "style", name: "square" });
  assert.deepEqual(C.normReadApp({ app: "atelier", designs: "style" }, cats), { ok: true, app: "atelier", designs: "style", name: "" });
  assert.match(C.normReadApp({ app: "writer", designs: "style" }, cats).err, /designs must be open or named\./);
  assert.match(C.normReadApp({ app: "atelier", designs: "folder" }, cats).err, /\(or style\)/);
  const tool = C.readAppTool(["atelier"]);
  assert.deepEqual(tool.params.properties.designs.enum, ["open", "named", "style"]);
  assert.match(tool.params.properties.designs.description, /square, 4:5, 9:16, 16:9, A portrait, bookmark, banner/);
});

test("the kinds the tool names are the kinds Atelier works out", () => {
  const ST = require(path.join(ROOT, "atelier/style.js"));
  const desc = C.readAppTool(["atelier"]).params.properties.designs.description;
  ST.KINDS.forEach((k) => assert.ok(desc.includes(k), k));
});

test("wiring: the outline gets the stored profile, and the style is read with Atelier's permission", () => {
  const as = read("assistant/assistant.js");
  assert.match(as, /brand: "oros-atelier-brand", style: "oros-atelier-style" \}/);
  assert.match(as, /mod\.outline\(doc, EDIT_SRC\[n\.app\]\.style \? readStore\(EDIT_SRC\[n\.app\]\.style\) : null\)/);
  assert.match(as, /if \(n\.designs === "style"\) return readStyle\(n, cats, apps\);/);
  assert.match(as, /app\.perm === "always" \? Promise\.resolve\(true\) : askRead\(title, app\.name, text\)/);
  assert.equal((as.match(/"ed\.myStyle":/g) || []).length, 2, "EN + EL");
  assert.ok(read("i18n/de/assistant.js").includes('"ed.myStyle":'), "DE");
  // the summary for the design's kind, as the outline gives it
  const prof = { v: 1, kinds: { square: { sum: { fonts: { title: ["Inter"] } } } } };
  assert.deepEqual(CMD.styleOf(prof, CMD.styleKind(1080, 1080)), { fonts: { title: ["Inter"] } });
  assert.equal(CMD.styleOf(prof, CMD.styleKind(1080, 1920)), null);
});
