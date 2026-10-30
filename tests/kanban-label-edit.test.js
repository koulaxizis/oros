// Kanban: edit an existing label (name + colour) from the card's label
// list and the label filter. Static checks on the markup, strings and
// the commit path; behaviour checked in Chromium (see Bible changelog).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

test("label dialog markup: name, swatches, delete, save", () => {
  const html = read("kanban/index.html");
  ["dlg-lbl", "lbl-form", "lbl-name", "lbl-swatches", "lbl-delete"].forEach((id) =>
    assert.ok(html.includes('id="' + id + '"'), id));
  assert.match(html, /id="lbl-name"[^>]*maxlength="24"/);
});

test("strings in EN, EL and DE", () => {
  const js = read("kanban/kanban.js"), de = read("i18n/de/kanban.js");
  ["lbl.edit", "lbl.color"].forEach((k) => {
    assert.equal(js.split('"' + k + '":').length - 1, 2, k + " EN + EL");
    assert.ok(de.includes('"' + k + '":'), k + " DE");
  });
});

test("pencil in both lists; commit stamps the label only when it changed", () => {
  const js = read("kanban/kanban.js");
  assert.equal(js.split("labelEditBtn(label.id)").length - 1, 2);
  const close = js.slice(js.indexOf('$("dlg-lbl").addEventListener("close"'));
  const body = close.slice(0, close.indexOf("});"));
  assert.ok(body.includes("if (!changed) return;"));
  assert.ok(body.includes("touch(label);"));
  assert.ok(!/stamp\(/.test(body), "cards are not re-stamped: they hold the label id");
});

test("help pages mention editing labels", () => {
  assert.ok(read("kanban/help.en.txt").includes("`Edit label`"));
  assert.ok(read("kanban/help.el.txt").includes("`Επεξεργασία ετικέτας`"));
  assert.ok(read("i18n/de/help/kanban.txt").includes("`Label bearbeiten`"));
});
