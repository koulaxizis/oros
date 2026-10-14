// Radio: a station's stream is never loaded over plain http (mixed
// content makes the installed app show the browser's address bar).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const vm = require("vm");

const SRC = fs.readFileSync(path.join(__dirname, "..", "radio/radio.js"), "utf8");
function grab(name) {
  const at = SRC.indexOf("function " + name + "(");
  assert.ok(at >= 0, name + " exists");
  let depth = 0, i = SRC.indexOf("{", at);
  for (; i < SRC.length; i++) {
    if (SRC[i] === "{") depth++;
    else if (SRC[i] === "}" && --depth === 0) break;
  }
  return SRC.slice(at, i + 1);
}
const ctx = {};
vm.runInNewContext(grab("secureStreamUrl") + grab("normalizeStation") + "this.S=secureStreamUrl;this.N=normalizeStation;", ctx);

test("https addresses win, http ones are upgraded", () => {
  assert.equal(ctx.S("https://a.example/live"), "https://a.example/live");
  assert.equal(ctx.S("http://a.example:8000/live"), "https://a.example:8000/live");
  assert.equal(ctx.S("HTTP://a.example/x"), "https://a.example/x");
  assert.equal(ctx.S("http://a.example/r", "https://b.example/u"), "https://b.example/u", "the https candidate wins");
  assert.equal(ctx.S("", "http://b.example/u"), "https://b.example/u");
  assert.equal(ctx.S("javascript:alert(1)"), "");
  assert.equal(ctx.S("ftp://x/y", null, undefined), "");
});

test("normalized stations never carry an http stream and say when they were upgraded", () => {
  const a = ctx.N({ stationuuid: "1", url_resolved: "http://s.example/a", url: "http://s.example/a.pls" });
  assert.equal(a.url_resolved, "https://s.example/a");
  assert.equal(a.insecure, true);
  const b = ctx.N({ stationuuid: "2", url_resolved: "http://s.example/a", url: "https://s.example/a" });
  assert.equal(b.url_resolved, "https://s.example/a");
  assert.equal(b.insecure, false);
  const c = ctx.N({ stationuuid: "3", url_resolved: "https://s.example/a" });
  assert.equal(c.insecure, false);
});

test("play() hands the audio element the secure address only", () => {
  const play = SRC.slice(SRC.indexOf("play: function(station){"), SRC.indexOf("toggle: function(){"));
  assert.match(play, /var url = secureStreamUrl\(station\.url_resolved\)/);
  assert.match(play, /audio\.src = url;/);
  assert.doesNotMatch(play, /audio\.src = station\.url_resolved/);
});

test("the insecure message exists in both languages", () => {
  assert.equal((SRC.match(/"err\.insecure":/g) || []).length, 2);
});
