// Whiteboard wave DG5: basic Visio .vsdx import (whiteboard/diagram.js
// readVsdx, through designkit/zipin.js). The sample is built from the
// XML parts in tests/fixtures/vsdx by tests/fixtures/zipwrite.js.
// Run: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const C = require("../whiteboard/core.js");
const D = require("../whiteboard/diagram.js");
const Z = require("./fixtures/zipwrite.js");

const SAMPLE = Z.zip(Z.folder(path.join(__dirname, "fixtures/vsdx")));
const ids = () => { let n = 0; return () => "v" + n++; };
const read = (buf) => D.readVsdx(new Blob([buf]), ids());

test("vsdx: foreground pages become boards; masters by name become symbols; text, size and place in px", async () => {
  const r = await read(SAMPLE);
  assert.deepEqual(r.pages.map((p) => p.name), ["Process"], "the background page is left out");
  const o = r.pages[0].objs, t = (tx) => o.find((x) => x.tx === tx);
  assert.deepEqual(["Start", "Check the order", "OK?", "Web"].map((x) => t(x).sym), ["terminator", "process", "decision", "server"]);
  assert.equal(t("Plain").shp, "rect", "a shape with no master is a rectangle");
  assert.equal(t("Gizmo").shp, "rect"); assert.equal(r.simplified, 1, "an unknown master is counted");
  // sizes come from the master when the shape has none: 1.2 × 0.5 in
  assert.deepEqual([t("Start").w, t("Start").h], [115.2, 48]);
  // y goes down here: Start (PinY 10) above the check (8.5) above OK? (7)
  assert.ok(t("Start").y < t("Check the order").y && t("Check the order").y < t("OK?").y);
  // a group's shapes are placed in the page
  assert.ok(t("Plain").x > t("Web").x && t("Plain").y > t("Web").y);
  // colours: a pale green fill, a dark red solid one, none for no fill
  assert.deepEqual([t("Start").c, t("Start").f], ["green", "soft"]);
  assert.deepEqual([t("OK?").c, t("OK?").f], ["red", "solid"]);
  assert.equal(t("Check the order").f, "none");
  // a swimlane is a frame
  const fr = o.find((x) => x.k === "frame");
  assert.equal(fr.tx, "Billing");
  // every object passes the core's checks
  const d = C.apply(C.putBoard(C.empty(), "b1", "x", 1), C.index(o.map((x) => Object.assign({}, x, { b: "b1" }))), 2);
  assert.equal(d.objs.length, o.length);
});

test("vsdx: dynamic connectors join their shapes through Connects, as elbow lines with heads and dashes", async () => {
  const o = (await read(SAMPLE)).pages[0].objs, m = C.index(o), ar = o.filter((x) => x.k === "arrow");
  assert.equal(ar.length, 2);
  assert.deepEqual([m[ar[0].ao].tx, m[ar[0].bo].tx, ar[0].rt, ar[0].hd], ["Start", "Check the order", "elbow", "end"]);
  assert.deepEqual([m[ar[1].bo].tx, ar[1].tx, ar[1].ds], ["OK?", "next", true]);
});

test("vsdx: not a zip, a zip without Visio pages, and too big are refused", async () => {
  await assert.rejects(read(Buffer.from("not a zip at all, just text")), /zip/);
  await assert.rejects(read(Z.zip([{ name: "word/document.xml", data: "<w/>" }])), /notvsdx/);
  await assert.rejects(D.readVsdx({ size: D.MAX_VSDX + 1, slice() {} }, ids()), /big/);
  const doctype = Z.folder(path.join(__dirname, "fixtures/vsdx")).map((f) => f.name === "visio/pages/page1.xml" ? Object.assign({}, f, { data: '<!DOCTYPE x [<!ENTITY a "b">]><PageContents/>' }) : f);
  await assert.rejects(read(Z.zip(doctype)), /doctype/);
});

test("the app opens .vsdx through the same item, loads the zip reader on use, and says .vsd needs saving as .vsdx", () => {
  const app = fs.readFileSync(path.join(__dirname, "../whiteboard/app.js"), "utf8");
  const de = fs.readFileSync(path.join(__dirname, "../i18n/de/whiteboard.js"), "utf8");
  assert.match(app, /loadScript\("\.\.\/designkit\/zipin\.js"\)/);
  assert.match(app, /D\.readVsdx\(f, newId\)/);
  assert.equal((app.match(/"dio\.vsd":/g) || []).length, 2); assert.ok(de.includes('"dio.vsd":'));
  ["en", "el"].forEach((l) => assert.match(fs.readFileSync(path.join(__dirname, "../whiteboard/help." + l + ".txt"), "utf8"), /\.vsdx/));
});
