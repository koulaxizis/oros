// Music: recovery of a song that stops with an error (music/core.js
// helpers used by music/host.js). A Jamendo address that went stale is
// asked for again; a stream gets two more tries, then it is skipped;
// offline it waits for the network.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const C = require(path.join(__dirname, "..", "music/core.js")).OrosMusicCore;

test("Jamendo track id: from the audio address, else the page; radios have none", () => {
  assert.equal(C.jmTrackId({ s: "jm", u: "https://prod-1.storage.jamendo.com/?trackid=1886257&format=mp32&from=abc%3D%3D" }), "1886257");
  assert.equal(C.jmTrackId({ s: "jm", u: "https://prod-1.storage.jamendo.com/x", pg: "https://www.jamendo.com/track/42/background-flow" }), "42");
  assert.equal(C.jmTrackId({ s: "jm", u: "https://streaming.jamendo.com/JamPop", pg: "https://www.jamendo.com/radios" }), "");
  assert.equal(C.jmTrackId({ s: "ia", u: "https://archive.org/x?trackid=5" }), "");
  assert.equal(C.jmTrackId(null), "");
  assert.equal(C.jmTrackId({ s: "jm", u: "https://x/?trackid=12a" }), "");
});

test("Jamendo fresh address: only https, only the asked track, only a success answer", () => {
  const ok = (r) => ({ headers: { status: "success", code: 0 }, results: r });
  assert.equal(C.jmFreshAudio(ok([{ id: "7", audio: "https://prod-1.storage.jamendo.com/?trackid=7&from=new" }]), "7"), "https://prod-1.storage.jamendo.com/?trackid=7&from=new");
  assert.equal(C.jmFreshAudio(ok([{ id: 7, audio: "https://a/?trackid=7" }]), "7"), "https://a/?trackid=7");
  assert.equal(C.jmFreshAudio(ok([{ id: "8", audio: "https://a/8" }]), "7"), "");
  assert.equal(C.jmFreshAudio(ok([{ id: "7", audio: "http://a/7" }]), "7"), "");
  assert.equal(C.jmFreshAudio(ok([{ id: "7", audio: "javascript:alert(1)" }]), "7"), "");
  assert.equal(C.jmFreshAudio({ headers: { status: "failed", code: 5 }, results: [] }, "7"), "");
  assert.equal(C.jmFreshAudio(null, "7"), "");
});

test("fail step: streams retry twice, offline waits, files skip", () => {
  const st = { s: "jm", u: "https://prod-1.storage.jamendo.com/?trackid=1" };
  assert.equal(C.failStep(st, 0, true), "retry");
  assert.equal(C.failStep(st, 1, true), "retry");
  assert.equal(C.failStep(st, 2, true), "skip");
  assert.equal(C.failStep(st, 0, false), "wait");
  assert.equal(C.failStep(st, 5, false), "wait");
  assert.equal(C.failStep({ p: "/internal/Music/a.mp3", t: "a" }, 0, true), "skip");
  assert.equal(C.failStep({ s: "sv", sv: "x" }, 0, true), "skip");
  assert.equal(C.failStep(null, 0, true), "skip");
});

test("host: an early-loaded next song that fails is never moved on to", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "music/host.js"), "utf8");
  // The preloaded deck's own error marks it bad (its events do not
  // reach the "playing deck" handlers).
  assert.match(src, /addEventListener\("error", function \(\) \{ if \(nx && nx\.el === el && el !== audio\) badNext\(\); \}\)/);
  assert.match(src, /if \(n\.el\.error\) \{ badNext\(\); return false; \}/);
  // Every refused play() goes through the same recovery.
  assert.doesNotMatch(src, /catch\(function \(err\) \{ flags\.error = /);
  assert.match(src, /Promise\.resolve\(p\)\.catch\(function \(err\) \{ playFailed\(err\); \}\)/);
});
