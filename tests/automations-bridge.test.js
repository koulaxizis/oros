// Automations + orOS Bridge (item 25, BR-EV-BRIDGE): folder events,
// the file and print steps, the bridge client's pure parts and the
// receivers in Scan PDF, Files and Invoices.
// Run: node --test tests/automations-bridge.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const C = require("../automations/core.js");
const B = require("../automations/bridge.js");
const A = require("../assistant/core.js");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const KEY = "0123456789abcdef";
const evRule = (ev, acts, word) => C.cleanRule({ id: "r1", name: "R", on: true,
  when: { t: "event", ev: ev, word: word }, do: acts });

test("the three bridge events are Automations events", () => {
  ["bridge.pdf", "bridge.photo", "bridge.file"].forEach((ev) => {
    assert.ok(C.EVENTS.includes(ev));
    assert.equal(C.EVENT_APP[ev], "automations");
    assert.ok(C.bridgeEvent(ev));
    ["en", "el"].forEach((l) => assert.ok(C.STRINGS[l]["ev." + ev], l + " ev." + ev));
  });
  assert.ok(!C.bridgeEvent("todo.done"));
  assert.ok(!C.bridgeEvent("bridge.nope"));
});

test("file and print steps stay only on a bridge event rule", () => {
  const r = evRule("bridge.pdf", [{ a: "notify", text: "{text}" }, { a: "file", to: "scanpdf" }, { a: "print" }]);
  assert.deepEqual(r.do.map((x) => x.a), ["notify", "file", "print"]);
  assert.equal(r.do[1].to, "scanpdf");
  const t = evRule("todo.done", [{ a: "notify", text: "x" }, { a: "file", to: "files" }, { a: "print" }]);
  assert.deepEqual(t.do.map((x) => x.a), ["notify"]);
  const day = C.cleanRule({ id: "r2", name: "D", on: true, when: { t: "day", at: "09:00", wd: [] },
    do: [{ a: "notify", text: "x" }, { a: "print" }] });
  assert.deepEqual(day.do.map((x) => x.a), ["notify"]);
  assert.equal(C.cleanAction({ a: "file", to: "passwords" }), null);
  assert.equal(C.cleanAction({ a: "file", to: "notes" }), null);
  assert.deepEqual(C.FILE_TO.slice().sort(), ["files", "invoices", "scanpdf"]);
});

test("the steps call the shell, need their app and are tap steps (AUTO-2)", () => {
  const f = C.cleanAction({ a: "file", to: "invoices" }), p = C.cleanAction({ a: "print" });
  assert.deepEqual(C.call(f, Date.now(), "en"), { fn: "bridgeFile", app: "invoices", arg: { to: "invoices" } });
  assert.equal(C.call(p, Date.now(), "en").fn, "bridgePrint");
  assert.equal(C.needs(f), "invoices");
  assert.equal(C.needs(p), "");
  const r = evRule("bridge.file", [{ a: "file", to: "files" }, { a: "print" }]);
  assert.equal(C.pending(r).length, 2);
  assert.ok(!C.runnable(r, ["automations"]));
  assert.ok(C.runnable(r, ["automations", "files"]));
  const n = C.notice(r, Date.now(), "en", (id) => id);
  assert.match(n.body, /files/);
});

test("a bridge signal runs a rule once per file and the word looks at the name", () => {
  const r = evRule("bridge.pdf", [{ a: "notify", text: "{text}" }], "invoice");
  const sig = { kind: "event", name: "bridge.pdf", key: "bridge:" + KEY, text: "Invoice 2026-11.pdf" };
  const id = C.matches(r, sig, Date.now());
  assert.ok(id && id.indexOf("r1@s") === 0);
  assert.equal(C.matches(r, Object.assign({}, sig), Date.now()), id);
  assert.equal(C.matches(r, Object.assign({}, sig, { text: "photo.pdf" }), Date.now()), null);
  assert.equal(C.matches(r, Object.assign({}, sig, { name: "bridge.photo" }), Date.now()), null);
});

test("the ready-made rules scan-in and photo-in", () => {
  ["en", "el"].forEach((l) => {
    const s = C.cleanRule(Object.assign({ id: "s" }, C.fromTemplate("scan-in", l)));
    assert.equal(s.when.ev, "bridge.pdf");
    assert.deepEqual(s.do.map((x) => x.a + (x.to ? ":" + x.to : "")), ["notify", "file:scanpdf"]);
    const p = C.cleanRule(Object.assign({ id: "p" }, C.fromTemplate("photo-in", l)));
    assert.equal(p.when.ev, "bridge.photo");
    assert.equal(p.do[1].to, "files");
  });
});

test("cleanFile keeps only a safe report from the bridge", () => {
  assert.deepEqual(B.cleanFile({ key: KEY, name: "scan.pdf", kind: "pdf", size: 10.7, folder: "C:\\Scans", extra: 1 }),
    { key: KEY, name: "scan.pdf", kind: "pdf", size: 10, folder: "C:\\Scans" });
  assert.equal(B.cleanFile({ key: "XYZ", name: "a" }), null);
  assert.equal(B.cleanFile({ key: KEY, name: "../a.pdf" }), null);
  assert.equal(B.cleanFile({ key: KEY, name: "a\\b" }), null);
  assert.equal(B.cleanFile({ key: KEY, name: "" }), null);
  assert.equal(B.cleanFile({ key: KEY, name: "x", kind: "exe" }).kind, "other");
  assert.equal(B.cleanFile({ key: KEY, name: "a\u0007b" }).name, "ab");
  assert.equal(B.cleanFile(null), null);
});

test("eventsFor: every file is bridge.file, plus pdf or photo", () => {
  assert.deepEqual(B.eventsFor({ kind: "pdf" }), ["bridge.file", "bridge.pdf"]);
  assert.deepEqual(B.eventsFor({ kind: "image" }), ["bridge.file", "bridge.photo"]);
  assert.deepEqual(B.eventsFor({ kind: "other" }), ["bridge.file"]);
  B.eventsFor({ kind: "pdf" }).forEach((e) => assert.ok(C.EVENTS.includes(e)));
});

test("fresh and remember: a file is handled once, the list stays short", () => {
  const k2 = "fedcba9876543210";
  const files = [{ key: KEY, name: "a.pdf" }, { key: k2, name: "b.jpg", kind: "image" }, { key: KEY, name: "a.pdf" }, { key: "bad" }];
  assert.deepEqual(B.fresh([], files).map((f) => f.key), [KEY, k2]);
  assert.deepEqual(B.fresh([KEY], files).map((f) => f.key), [k2]);
  let seen = [];
  for (let i = 0; i < B.SEEN_MAX + 20; i++) seen = B.remember(seen, [i.toString(16).padStart(16, "0")]);
  assert.equal(seen.length, B.SEEN_MAX);
  assert.equal(seen[seen.length - 1], (B.SEEN_MAX + 19).toString(16).padStart(16, "0"));
  assert.deepEqual(B.remember([KEY, k2], [KEY]), [k2, KEY]);
});

test("retryMs doubles from 15 s up to 5 min", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 9].map(B.retryMs), [15000, 30000, 60000, 120000, 240000, 300000, 300000]);
});

test("parseBlock reads the bridge's ORF1 block and refuses the rest", () => {
  const data = Buffer.from("hello");
  const buf = new ArrayBuffer(12 + data.length), dv = new DataView(buf);
  new Uint8Array(buf).set(Buffer.from("ORF1"), 0);
  dv.setUint32(4, 4096, true); dv.setUint32(8, data.length, true);
  new Uint8Array(buf).set(data, 12);
  const b = B.parseBlock(buf);
  assert.equal(b.offset, 4096);
  assert.equal(Buffer.from(b.data).toString(), "hello");
  assert.equal(B.parseBlock(buf.slice(0, 15)), null);
  const bad = buf.slice(0); new Uint8Array(bad)[0] = 0;
  assert.equal(B.parseBlock(bad), null);
  assert.equal(B.parseBlock(new ArrayBuffer(4)), null);
});

test("mimeOf names common types", () => {
  assert.equal(B.mimeOf("Scan.PDF", "pdf"), "application/pdf");
  assert.equal(B.mimeOf("a.jpeg", "image"), "image/jpeg");
  assert.equal(B.mimeOf("noext", "pdf"), "application/pdf");
  assert.equal(B.mimeOf("a.zip", "other"), "application/octet-stream");
});

test("the client uses the bridge's port and Studio's pairing token", () => {
  assert.equal(B.PORT, 47621);
  assert.equal(B.TOKEN_KEY, "oros-studio-bridge");
  assert.match(read("studio/bridge.js"), /oros-studio-bridge/);
});

test("the Assistant's propose_rule knows the bridge events and steps", () => {
  const all = () => true;
  const r = A.normRule({ name: "Scans", when: { type: "event", event: "bridge.pdf", word: "scan" },
    steps: [{ do: "notify", text: "{text}" }, { do: "file", to: "invoices" }, { do: "print" }] }, all);
  assert.ok(r.ok, r.err);
  assert.deepEqual(r.rule.do.map((x) => x.a), ["notify", "file", "print"]);
  assert.equal(r.rule.do[1].to, "invoices");
  const bad = A.normRule({ when: { type: "event", event: "todo.done" }, steps: [{ do: "print" }] }, all);
  assert.ok(!bad.ok);
  assert.match(bad.err, /bridge/);
  assert.ok(!A.normRule({ when: { type: "event", event: "bridge.file" }, steps: [{ do: "file", to: "passwords" }] }, all).ok);
  const none = A.normRule({ when: { type: "event", event: "bridge.pdf" }, steps: [{ do: "file", to: "scanpdf" }] }, (a) => a !== "scanpdf");
  assert.match(none.err, /scanpdf/);
  const ev = A.TOOL_RULE.params.properties.when.properties.event.enum;
  ["bridge.pdf", "bridge.photo", "bridge.file"].forEach((e) => assert.ok(ev.includes(e)));
});

test("receivers: Scan PDF, Files and Invoices take a handed file", () => {
  const host = read("automations/host.js");
  assert.match(host, /openFile:\s*\{\s*token/);
  assert.match(host, /importFile:\s*\{\s*token/);
  assert.match(host, /importPdf:\s*\{\s*token/);
  assert.match(read("files/files.js"), /importFile/);
  assert.match(read("files/files.js"), /__orosTakeFile/);
  assert.match(read("invoices/invoices.js"), /importPdf/);
  assert.match(read("invoices/invoices.js"), /__orosTakeFile/);
  // a page never names a folder: only the chooser on the computer adds one
  const bw = read("automations/bridge.js");
  assert.doesNotMatch(bw, /op:\s*"watchAdd"/);
  assert.match(bw, /op:\s*"watchPick"/);
});

test("Files' confirm dialog and the new strings are in EN, EL and DE", () => {
  const files = read("files/files.js");
  ["dlg.inTitle", "dlg.inMsg", "dlg.inOk"].forEach((k) => assert.ok(files.split('"' + k + '"').length - 1 >= 3, k));
  const de = read("i18n/de/files.js");
  ["dlg.inTitle", "dlg.inMsg", "dlg.inOk"].forEach((k) => assert.ok(de.includes('"' + k + '"'), k));
  const deA = read("i18n/de/automations.js");
  ["ev.bridge.pdf", "act.file", "act.print", "tpl.scan-in", "file.gone", "btn.pc", "pc.add", "a.file"].forEach((k) =>
    assert.ok(deA.includes('"' + k + '"'), k));
  ["en", "el"].forEach((l) => assert.match(read("automations/help." + l + ".txt"), /orOS Bridge/));
  assert.match(read("i18n/de/help/automations.txt"), /orOS Bridge/);
});
