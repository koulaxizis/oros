// SY-AD (5.94.00): data the Assistant or orOS Gate writes for an app
// never opened on this device still syncs: the key → slice rule holds
// for every app Claude may change, and both writers call adoptKey.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const G = require("../gate/gate.js");
const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

test("every app Claude may change registers slice <id> with key oros-<id>-data (montage: oros-montage)", () => {
  const ids = [...new Set(G.ACT.concat(G.DOCS, Object.keys(G.WRITES)))];
  ids.forEach((id) => {
    const src = fs.readdirSync(path.join(__dirname, "..", id)).filter((f) => f.endsWith(".js")).map((f) => read(id + "/" + f)).join("\n");
    const key = id === "montage" ? "oros-montage" : "oros-" + id + "-data";
    assert.ok(src.indexOf('"' + key + '"') >= 0 || src.indexOf("'" + key + "'") >= 0, id + ": its key " + key);
    assert.ok(new RegExp("registerSlice\\(\\s*['\"]" + id + "['\"]").test(src) || /registerSlice\(\s*APP_ID/.test(src) && src.indexOf('APP_ID = "' + id + '"') >= 0, id + ": slice name");
  });
});

test("sync.js adopts the key; the Assistant's writeStore and the gate's writeJSON call it", () => {
  const s = read("sync.js");
  assert.match(s, /adoptKey:\s+adoptKey/);
  assert.match(s, /ADOPT_NAMES = \{ "oros-montage": "montage" \}/);
  assert.match(read("assistant/assistant.js"), /function writeStore[\s\S]{0,300}adoptStore\(key\)/);
  assert.match(read("gate/gate.js"), /function writeJSON[\s\S]{0,500}adoptKey\(k\)/);
});
