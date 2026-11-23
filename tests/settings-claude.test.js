// CLAUDE-1: the Claude card in Settings › Connected services. Claude in
// a window everywhere; Claude desktop from Anthropic's download page on
// a computer, or installed by the orOS USB / Portable System extension
// (data-oros-sys-claude on the shell's page, event "oros-claude").
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const C = require(path.join(ROOT, "settings/core.js"));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

const WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const LNX = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
const AND = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36";
const IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const CROS = "Mozilla/5.0 (X11; CrOS x86_64 15917.71.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

test("claude: a computer gets Anthropic's download page for its system", () => {
  assert.deepEqual(C.claudeDesk(null, null, WIN, false), { kind: "link", os: "windows" });
  assert.deepEqual(C.claudeDesk(null, null, MAC, false), { kind: "link", os: "mac" });
  assert.deepEqual(C.claudeDesk(null, null, LNX, false), { kind: "link", os: "linux" });
  assert.deepEqual(C.claudeDesk(null, null, CROS, false), { kind: "link", os: "other" });
  assert.deepEqual(C.claudeDesk(null, null, "", false), { kind: "link", os: "other" });
});

test("claude: phones (and the orOS Android app) get only claude.ai", () => {
  assert.deepEqual(C.claudeDesk(null, null, AND, false), { kind: "phone" });
  assert.deepEqual(C.claudeDesk(null, null, IOS, false), { kind: "phone" });
  assert.deepEqual(C.claudeDesk(null, null, LNX, true), { kind: "phone" });
});

test("claude: the System extension's state wins, read strictly", () => {
  assert.deepEqual(C.claudeDesk("ready", "fail", LNX, false), { kind: "sys", state: "ready", why: "" });
  assert.deepEqual(C.claudeDesk("busy", "net", LNX, false), { kind: "sys", state: "busy", why: "" });
  assert.deepEqual(C.claudeDesk("none", null, WIN, false), { kind: "sys", state: "none", why: "" });
  assert.deepEqual(C.claudeDesk("none", "fail", WIN, false), { kind: "sys", state: "none", why: "fail" });
  assert.deepEqual(C.claudeDesk("cannot", "persist", LNX, false), { kind: "sys", state: "cannot", why: "persist" });
  assert.deepEqual(C.claudeDesk("cannot", "owner", LNX, false), { kind: "sys", state: "cannot", why: "owner" });
  // an unknown reason never reaches a string key
  assert.deepEqual(C.claudeDesk("cannot", "<img>", LNX, false), { kind: "sys", state: "cannot", why: "os" });
  assert.deepEqual(C.claudeDesk("none", "x", LNX, false), { kind: "sys", state: "none", why: "" });
  // an unknown state is ignored: the download page, as without the extension
  assert.deepEqual(C.claudeDesk("installed", null, LNX, false), { kind: "link", os: "linux" });
});

test("claude: only Anthropic's own addresses, https", () => {
  assert.equal(C.CLAUDE_WEB, "https://claude.ai/new");
  assert.equal(C.CLAUDE_DL, "https://claude.com/download");
});

test("claude: every string in English and Greek, and in the German pack", () => {
  const keys = Object.keys(C.STRINGS.en).filter((k) => k.indexOf("cl.") === 0);
  assert.ok(keys.length >= 20);
  ["windows", "mac", "linux", "other"].forEach((o) => assert.ok(keys.includes("cl.get." + o), o));
  ["persist", "owner", "os", "net", "fail"].forEach((w) => assert.ok(keys.includes("cl.why." + w), w));
  const de = read("i18n/de/settings.js");
  keys.forEach((k) => {
    assert.ok(C.STRINGS.el[k], "el " + k);
    assert.ok(de.indexOf('"' + k + '":') !== -1, "de " + k);
  });
  assert.ok(C.STRINGS.en["w.claude"] && C.STRINGS.el["w.claude"]);
});

test("claude: the card asks the System extension only through its event", () => {
  const js = read("settings/settings.js");
  assert.match(js, /claudeInto\(c\);\n      if \(G\) gateInto\(c, G\);/);   // STRUCT-2: one card
  assert.match(js, /new d\.defaultView\.CustomEvent\("oros-claude", \{ detail: what \}\)/);
  assert.match(js, /attributeFilter: \["data-oros-sys-claude", "data-oros-sys-claude-why"\]/);
  // the extension's values never become HTML
  const fn = js.slice(js.indexOf("function claudeInto"), js.indexOf("function secPhoneHealth"));
  assert.doesNotMatch(fn, /innerHTML/);
  assert.match(fn, /window\.open\(C\.CLAUDE_WEB, "_blank", "noopener"\)/);
});

test("claude: help in English, Greek and German", () => {
  assert.match(read("settings/help.en.txt"), /### Claude and Claude desktop/);
  assert.match(read("settings/help.el.txt"), /### Ο Claude και το Claude desktop/);
  assert.match(read("i18n/de/help/settings.txt"), /### Claude und Claude Desktop/);
});
