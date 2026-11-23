// LY-AUTO (Chris 2026-11-23): the Assistant does in Layout what Claude
// does through orOS Gate: Layout's tools run at once with the setting
// «Layout work without cards», and Layout rounds have their own budget.
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
global.window = global.window || {};
const C = require("../assistant/core.js");
const SRC = fs.readFileSync(path.join(__dirname, "../assistant/assistant.js"), "utf8");
const DE = fs.readFileSync(path.join(__dirname, "../i18n/de/assistant.js"), "utf8");

test("Layout rounds count against their own, larger budget", () => {
  assert.ok(C.LAYOUT_ROUNDS >= 30 && C.LAYOUT_ROUNDS > C.TOOL_ROUNDS);
  assert.equal(C.layoutRound([{ name: "read_in_app", args: { app: "layout" } }, { name: "edit_in_app", args: { app: "layout" } }]), true);
  assert.equal(C.layoutRound([{ name: "export_pdf", args: {} }, { name: "list_fonts", args: {} }, { name: "files_list", args: {} }]), true);
  assert.equal(C.layoutRound([{ name: "edit_in_app", args: { app: "atelier" } }]), false);
  assert.equal(C.layoutRound([{ name: "export_pdf", args: {} }, { name: "search_data", args: {} }]), false);
  assert.equal(C.layoutRound([]), false);
});

test("only Layout's own work runs at once", () => {
  ["export_pdf", "export_epub", "book_cover", "rebuild_in_layout", "learn_house_style", "layout_book", "add_house_rule"].forEach((n) =>
    assert.equal(C.lyAutoCall({ name: n, args: {} }), true, n));
  assert.equal(C.lyAutoCall({ name: "edit_in_app", args: { app: "layout" } }), true);
  assert.equal(C.lyAutoCall({ name: "edit_in_app", args: { app: "writer" } }), false);
  assert.equal(C.lyAutoCall({ name: "read_in_app", args: { app: "layout" } }), false);   // reads never had a card
  assert.equal(C.lyAutoCall({ name: "change_item", args: {} }), false);
  assert.equal(C.lyAutoCall({ name: "files_delete", args: {} }), false);
});

test("the setting is off by default and synced", () => {
  assert.equal(C.emptyData().set.ly || 0, 0);
  assert.equal(C.mergeAssist({ set: { m: 5, prov: "anthropic" } }, null).set.ly, 0);
  assert.equal(C.mergeAssist({ set: { m: 5, prov: "anthropic", ly: 1 } }, { set: { m: 3, ly: 0 } }).set.ly, 1);
  assert.match(SRC, /ly: cur\.ly \? 1 : 0/);
});

test("the system prompt says so only when it is on", () => {
  const base = { lang: "en", now: Date.now(), apps: ["Layout (layout)"], cover: true };
  assert.doesNotMatch(C.systemPrompt(base), /Layout work without cards is on/);
  assert.match(C.systemPrompt(Object.assign({ lyAuto: true }, base)), /Layout work without cards is on/);
});

test("the in-app run uses the gate's own path, never through the gate's checks, and never inside the gate", () => {
  assert.match(SRC, /function lyAutoOn\(call\) \{ return !GATE && !!data\.set\.ly/);
  assert.match(SRC, /function gateEdit\(args, apps, deadline, own\)/);
  assert.match(SRC, /why = own \? "" : g && typeof g\.writeOk/);
  assert.match(SRC, /if \(removes && p\.pv\.n > 5\) return runTool\(c, call, apps\);/);   // many removals: still a card
  assert.match(SRC, /return toolNow\(c, call, apps\)/);
});

test("the setting speaks English, Greek and German", () => {
  ["set.ly", "set.lyHint", "ly.done", "ly.fail"].forEach((k) => {
    assert.equal((SRC.match(new RegExp('"' + k.replace(".", "\\.") + '":', "g")) || []).length, 2, k + " EN + EL");
    assert.ok(DE.indexOf('"' + k + '":') >= 0, k + " DE");
  });
});
