// Notes voice notes (NOTES-VOICE, notes/voice-core.js + the md.js
// voice block): file names, the strict page line, where a new line
// goes, removing a line, unused files (never young ones), the
// recorder's format and the preview block (escaped, top level only).
// Run: node --test tests/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const V = require(path.join(__dirname, "..", "notes/voice-core.js"));
const M = require(path.join(__dirname, "..", "notes/md.js"));

const NAME = "2026-11-12-181005-a7k2.webm";
const MIC = "🎙";

test("file names: pattern, folder, time", () => {
  const n = V.fileName(new Date(2026, 10, 12, 18, 10, 5), "A7-k2!", "webm");
  assert.equal(n, NAME);
  assert.ok(V.isName(n));
  assert.equal(V.pathOf(n), "/internal/Notes/Voice/" + NAME);
  assert.equal(V.timeOf(n), new Date(2026, 10, 12, 18, 10, 5).getTime());
  assert.equal(V.fileName(new Date(2026, 0, 2, 3, 4, 5), "", "exe"), "2026-01-02-030405-0000.webm");
  assert.equal(V.mimeOf("2026-01-02-030405-abcd.m4a"), "audio/mp4");
  for (const bad of ["../x.webm", "/internal/a.webm", "2026-13-01-000000-abcd.webm", "2026-11-12-251005-a7k2.webm",
    "2026-11-12-181005-a7k2.webm.js", "2026-11-12-181005-A7K2.webm", "2026-11-12-181005-a7k2.mp3", "", null]) {
    assert.equal(V.isName(bad), false, String(bad));
    assert.equal(V.pathOf(bad), null);
  }
});

test("freeName never returns a taken name", () => {
  const d = new Date(2026, 10, 12, 18, 10, 5);
  const seq = ["a7k2", "a7k2", "b000"];
  let i = 0;
  const n = V.freeName(d, () => seq[i++], "webm", [NAME]);
  assert.equal(n, "2026-11-12-181005-b000.webm");
  assert.equal(V.freeName(d, () => "a7k2", "webm", [NAME]), null);
});

test("durations", () => {
  assert.equal(V.fmtDur(0), "0:00");
  assert.equal(V.fmtDur(42000), "0:42");
  assert.equal(V.fmtDur(3723000), "1:02:03");
  assert.equal(V.parseDur("1:02:03"), 3723000);
  assert.equal(V.parseDur("0:42"), 42000);
});

test("the page line is matched strictly", () => {
  const line = V.lineFor(NAME, 42000);
  assert.equal(line, MIC + " voice:" + NAME + " (0:42)");
  assert.deepEqual(V.voiceLine(line), { name: NAME, ms: 42000 });
  assert.deepEqual(V.voiceLine(MIC + "️ voice:" + NAME), { name: NAME, ms: 0 });
  assert.deepEqual(V.voiceLine(line + "  "), { name: NAME, ms: 42000 });
  for (const bad of [
    "  " + line,                                   // indented: list text, not a recording
    "> " + line,
    "voice:" + NAME,
    MIC + " voice:../" + NAME,
    MIC + " voice:/internal/Passwords/x.webm",
    MIC + " voice:https://evil.example/x.webm",
    MIC + " voice:" + NAME + " (0:42) and more",
    MIC + " voice:" + NAME + "\" onerror=\"x",
    MIC + " voice:2026-11-12-181005-a7k2.html"
  ]) assert.equal(V.voiceLine(bad), null, bad);
});

test("listIn: order, once per name, never inside code", () => {
  const b = "2026-11-12-181006-bbbb.ogg";
  const text = ["Intro", V.lineFor(NAME, 1000), "```", V.lineFor(b, 1000), "```", V.lineFor(b, 2000), V.lineFor(NAME, 1000)].join("\n");
  assert.deepEqual(V.listIn(text).map((x) => x.name), [NAME, b]);
  assert.equal(V.listIn(text)[1].ms, 2000);
  assert.deepEqual(V.listIn("~~~\n" + V.lineFor(b, 1) + "\n~~~"), []);
  assert.deepEqual(V.listIn(""), []);
});

test("insertLine: after the caret's line, an empty line is used", () => {
  const L = "X";
  assert.deepEqual(V.insertLine("", -1, L), { text: "X", caret: 1 });
  assert.deepEqual(V.insertLine("abc", -1, L), { text: "abc\nX", caret: 5 });
  assert.deepEqual(V.insertLine("abc\ndef", 1, L), { text: "abc\nX\ndef", caret: 5 });
  assert.deepEqual(V.insertLine("abc\n\ndef", 4, L), { text: "abc\nX\ndef", caret: 5 });
  assert.deepEqual(V.insertLine("abc\n", 4, L), { text: "abc\nX", caret: 5 });
  assert.deepEqual(V.insertLine("abc", 99, L), { text: "abc\nX", caret: 5 });
});

test("removeFrom and replaceIn touch only that name, outside code", () => {
  const b = "2026-11-12-181006-bbbb.ogg";
  const text = ["A", V.lineFor(NAME, 1000), "B", "```", V.lineFor(NAME, 1000), "```", V.lineFor(b, 0)].join("\n");
  assert.equal(V.removeFrom(text, NAME), ["A", "B", "```", V.lineFor(NAME, 1000), "```", V.lineFor(b, 0)].join("\n"));
  const n2 = "2026-11-13-090000-cccc.ogg";
  assert.equal(V.replaceIn(text, NAME, n2, 500), ["A", V.lineFor(n2, 500), "B", "```", V.lineFor(NAME, 1000), "```", V.lineFor(b, 0)].join("\n"));
});

test("unused: only named-by-no-page files older than a day", () => {
  const now = new Date(2026, 10, 13, 12, 0, 0).getTime();
  const files = [
    { name: NAME },                                  // named by a page
    { name: "2026-11-10-100000-old1.webm" },         // unused, old
    { name: "2026-11-13-080000-new1.webm" },         // unused, but young: its page may be on its way
    { name: "notes.txt" },                           // not ours
    { name: "2026-11-01-100000-conf.webm" }          // named only by a conflict copy's text
  ];
  const texts = ["x\n" + V.lineFor(NAME, 1), "copy\n" + V.lineFor("2026-11-01-100000-conf.webm", 1)];
  assert.deepEqual(V.unused(texts, files, now).map((f) => f.name), ["2026-11-10-100000-old1.webm"]);
  assert.deepEqual(V.unused([], [], now), []);
});

test("pickMime and extForMime", () => {
  assert.deepEqual(V.pickMime((m) => m === "audio/webm;codecs=opus"), { mime: "audio/webm;codecs=opus", ext: "webm" });
  assert.deepEqual(V.pickMime((m) => m === "audio/mp4"), { mime: "audio/mp4", ext: "m4a" });
  assert.equal(V.pickMime(() => false), null);
  assert.equal(V.pickMime(null), null);
  assert.equal(V.pickMime(() => { throw new Error("x"); }), null);
  assert.equal(V.extForMime("audio/mp4;codecs=mp4a.40.2"), "m4a");
  assert.equal(V.extForMime("audio/ogg; codecs=opus"), "ogg");
  assert.equal(V.extForMime("audio/webm;codecs=opus"), "webm");
  assert.equal(V.extForMime(""), "webm");
  assert.equal(V.sizeAt(3600000), 14400000);
});

test("md.js: a voice line is an empty, escaped block at the top level only", () => {
  const ctx = { voice: V.voiceLine };
  const line = V.lineFor(NAME, 42000);
  const html = M.render("Hello\n" + line + "\nWorld", ctx);
  assert.equal(html, '<p>Hello</p>\n<div class="md-voice" data-voice="' + NAME + '" data-ms="42000"></div>\n<p>World</p>\n');
  // without the hook it stays text, as before
  assert.ok(!/md-voice/.test(M.render(line)));
  // inside a quote, a list item or code it stays text
  assert.ok(!/md-voice/.test(M.render("> " + line, ctx)));
  assert.ok(!/md-voice/.test(M.render("- item\n  " + line, ctx)));
  assert.ok(!/md-voice/.test(M.render("```\n" + line + "\n```", ctx)));
  // a lazy line after a list item is the block, as listIn reads it
  assert.ok(/<\/ul>\n<div class="md-voice"/.test(M.render("- item\n" + line, ctx)));
  // a hook that returns odd values cannot inject markup
  const evil = M.render("x", { voice: () => ({ name: '"><script>', ms: "1e3\"" }) });
  assert.ok(!/<script>/.test(evil));
  assert.ok(/data-voice="&quot;&gt;&lt;script&gt;"/.test(evil));
});
