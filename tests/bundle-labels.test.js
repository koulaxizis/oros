// The .oroslabels file (Label Maker): pack a sheet of labels with
// bundle.js, read it back as NEW labels through the app's own rules,
// and the app wiring (save, open, unzipped folder, "Open with").
// Run: node --test tests/*.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const B = require(path.join(ROOT, "bundle.js"));
const C = require(path.join(ROOT, "labels/core.js"));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

test("labels: a sheet round-trips as new labels, with a CSV preview", async () => {
  const a = { id: "labcdef123", m: 1700000000000, text: "ΚΟΥΖΙΝΑ", tape: "blue", width: 9, cut: "round", margin: 2 };
  const b = { text: "jam, \"plum\"", tape: "yellow", width: 12, cut: "straight", margin: 0 };   // the tape, not saved
  const opts = C.labelsBundle([a, b], { copies: 4, lang: "el", date: new Date(2026, 0, 2), now: 1700000001000 });
  assert.equal(opts.meta.title, "ΚΟΥΖΙΝΑ");
  assert.equal(opts.meta.created, 1700000000000);
  assert.equal(opts.content.labels[1].text, "JAM, 'PLUM'");
  opts.thumbnail = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const bytes = await B.write(opts);
  assert.equal(B.sniff(bytes.subarray(0, 128)), C.LABELS_MIME);
  const r = await B.read(bytes, { mime: C.LABELS_MIME });
  assert.equal(r.content.kind, "oros-labels-package");
  assert.equal(r.content.copies, 4);
  assert.deepEqual(r.content.labels[0], a);
  assert.ok(r.thumbnail);
  const got = C.labelsFromBundle(r.content, Math.random, 1800000000000);
  assert.equal(got.copies, 4);
  assert.equal(got.labels.length, 2);
  got.labels.forEach((l) => { assert.ok(C.ID_RE.test(l.id) && l.id !== a.id); assert.equal(l.m, 1800000000000); });
  assert.deepEqual(Object.assign({}, got.labels[0], { id: a.id, m: a.m }), a);
  // CSV: header + one row per label, quoted where needed
  const csv = opts.preview[0].data;
  assert.equal(opts.preview[0].name, "labels.csv");
  assert.equal(csv, "﻿text,tape,width,ends,margin\r\nΚΟΥΖΙΝΑ,blue,9,round,2\r\n\"JAM, 'PLUM'\",yellow,12,straight,0\r\n");
  // nothing to save
  assert.equal(C.labelsBundle([{ text: "   " }], {}), null);
  assert.equal(C.sheetFileName("Κουζίνα / ράφι"), "ΚΟΥΖΙΝΑ-ΡΑΦΙ.oroslabels");
});

test("labels: a hostile file goes through the label rules", () => {
  assert.equal(C.labelsFromBundle(null), null);
  assert.equal(C.labelsFromBundle({ kind: "x", labels: [] }), null);
  assert.equal(C.labelsFromBundle({ kind: "oros-labels-package", labels: "no" }), null);
  const got = C.labelsFromBundle({ kind: "oros-labels-package", copies: 9999, labels: [
    { id: "../x", text: "<b>hi</b>" + "x".repeat(80), tape: "<x>", width: 99, cut: 1, margin: "a" },
    null, { text: "" }, { text: "ok" }, { text: "two" }
  ] }, Math.random, 5, 2);
  assert.equal(got.copies, C.MAX_COPIES);
  assert.equal(got.labels.length, 2);                      // room for 2
  const l = got.labels[0];
  assert.ok(C.ID_RE.test(l.id));
  assert.ok(!/[<>]/.test(l.text) && C.length(l.text) <= C.MAX_LEN);
  assert.equal(l.tape, C.DEFAULT.tape);
  assert.equal(l.width, C.DEFAULT.width);
  assert.equal(got.labels[1].text, "OK");
  assert.equal(C.labelsFromBundle({ kind: "oros-labels-package", labels: [{ text: "a" }] }, null, 1, 0).labels.length, 0);
});

test("labels wiring: bundle.js before the app, save / open / folder / Open with", () => {
  const h = read("labels/index.html"), j = read("labels/labels.js");
  assert.ok(h.indexOf("core.js") < h.indexOf("../bundle.js") && h.indexOf("../bundle.js") < h.indexOf("labels.js?"));
  ["oros-btn", "file-open", "file-folder", "file-input", ".oroslabels"].forEach((k) => assert.ok(h.includes(k), k));
  ["saveOros", "importFolder", "OrosBundle", "C.LABELS_MIME", '"newer"', "__orosTakeFile(", "openFile"].forEach((k) => assert.ok(j.includes(k), k));
  for (const f of ["labels/help.en.txt", "labels/help.el.txt"]) assert.ok(read(f).includes(".oroslabels"), f);
});
