// The Pocket (pocket.js, POCKET-1): model, wiring, strings, help.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const P = require("../pocket.js");
const C = require("../send/core.js");

function keep(st, k, data, app, now) {
  const d = C.norm(k, data);
  assert.ok(d, "normalized " + k);
  return P.add(st, k, d, app, now);
}
const EMPTY = () => P.parse(null, C.norm);

test("an empty or broken record is an empty pocket", () => {
  assert.deepEqual(P.parse(null, C.norm), { v: 1, items: [] });
  assert.deepEqual(P.parse("{oops", C.norm), { v: 1, items: [] });
  assert.deepEqual(P.parse({ v: 2, items: [{}] }, C.norm), { v: 1, items: [] });
});

test("keep: every send kind, newest first, the app folder kept", () => {
  let st = EMPTY();
  st = keep(st, "text", { text: "Hello" }, "notes", 1000).st;
  st = keep(st, "link", { url: "https://example.org/a", title: "A" }, "bookmarks", 2000).st;
  st = keep(st, "items", { title: "Shop", items: ["milk", "eggs"] }, "todo", 3000).st;
  st = keep(st, "table", { rows: [["a", "b"], [1, 2]] }, "spreadsheet", 4000).st;
  st = keep(st, "files", { items: [{ path: "/internal/Documents/a.pdf" }] }, "files", 5000).st;
  assert.deepEqual(st.items.map((it) => it.k), ["files", "table", "items", "link", "text"]);
  assert.equal(st.items[4].app, "notes");
  assert.equal(st.items[0].d.items[0].name, "a.pdf");
  // a round trip through storage keeps them all
  assert.deepEqual(P.parse(JSON.stringify(st), C.norm), st);
});

test("the same item again moves to the top; times stay unique", () => {
  let st = EMPTY();
  st = keep(st, "text", { text: "one" }, "notes", 1000).st;
  st = keep(st, "text", { text: "two" }, "notes", 1000).st;
  assert.deepEqual(st.items.map((it) => it.at), [1001, 1000]);
  st = keep(st, "text", { text: "one" }, "writer", 1500).st;
  assert.equal(st.items.length, 2);
  assert.equal(st.items[0].d.text, "one");
  assert.equal(st.items[0].app, "writer");
});

test("limits: 20 items, 20 000 characters each, 100 000 together; the oldest go", () => {
  let st = EMPTY();
  for (let i = 0; i < 25; i++) st = keep(st, "text", { text: "item " + i }, "notes", 1000 + i).st;
  assert.equal(st.items.length, P.MAX_ITEMS);
  assert.equal(st.items[0].d.text, "item 24");
  assert.equal(st.items[19].d.text, "item 5");
  const r = keep(EMPTY(), "text", { text: "x".repeat(P.MAX_ITEM + 10) }, "notes", 1);
  assert.equal(r.err, "big");
  let big = EMPTY();
  for (let i = 0; i < 8; i++) big = keep(big, "text", { text: String(i).repeat(19000) }, "notes", 10 + i).st;
  assert.ok(big.items.reduce((n, it) => n + P.sizeOf(it.d), 0) <= P.MAX_TOTAL);
  assert.equal(big.items[0].d.text[0], "7", "the newest stays");
});

test("never Passwords or Settings, never a secret", () => {
  assert.equal(keep(EMPTY(), "text", { text: "hunter2" }, "passwords", 1).err, "app");
  assert.equal(keep(EMPTY(), "text", { text: "code" }, "settings", 1).err, "app");
  assert.equal(keep(EMPTY(), "text", { text: "otpauth://totp/x?secret=ABC" }, "notes", 1).err, "secret");
  assert.equal(keep(EMPTY(), "text", { text: "-----BEGIN OPENSSH PRIVATE KEY-----\nabc" }, "notes", 1).err, "secret");
  assert.equal(P.add(EMPTY(), "script", { x: 1 }, "notes", 1).err, "kind");
});

test("parse drops what send/core.js would not take", () => {
  const raw = { v: 1, items: [
    { at: 1, k: "link", d: { url: "javascript:alert(1)" }, app: "notes" },
    { at: 2, k: "files", d: { items: [{ path: "/internal/../etc/passwd" }] }, app: "files" },
    { at: 3, k: "nope", d: {}, app: "notes" },
    { at: 4, k: "text", d: { text: "ok" }, app: "<b>x</b>" }
  ] };
  const st = P.parse(raw, C.norm);
  assert.equal(st.items.length, 1);
  assert.equal(st.items[0].d.text, "ok");
  assert.equal(st.items[0].app, "", "a bad app id is dropped");
});

test("remove, find, plain", () => {
  let st = EMPTY();
  st = keep(st, "items", { items: ["a", { text: "b", note: "n" }] }, "todo", 5).st;
  st = keep(st, "text", { text: "t" }, "notes", 6).st;
  assert.equal(P.plain("items", P.find(st, 5).d), "a\nb (n)");
  st = P.remove(st, 6);
  assert.equal(st.items.length, 1);
  assert.equal(P.find(st, 6), null);
});

test("wiring: shell stand-in, Dock, Send sheet, selection menu, Settings", () => {
  const shell = read("shell.js");
  assert.match(shell, /var POCKET_KEY = "oros-pocket";/);
  assert.match(shell, /sc\.src = "pocket\.js\?v=" \+ APP_VERSION;/, "loaded on first use, never at boot");
  assert.doesNotMatch(read("index.html"), /pocket\.js/, "not a start-up script");
  assert.match(shell, /dockExtra: function \(\) \{ return window\.orosPocket \? window\.orosPocket\.dockButton\(\) : null; \}/);
  assert.match(shell, /pocket: pk \|\| !window\.orosPocket\.canKeep\(src\) \? null :/);
  assert.match(shell, /\{ id: "pocket", code: "Comma", label: "sc\.desc\.pocket"/);
  assert.match(shell, /if \(strictLevelNow\(\)\) pocketWipe\(\);/, "Sensitive work empties it");
  assert.match(shell, /case "pocket\.open":/);
  assert.match(shell, /case "pocket\.clear":/);
  assert.match(shell, /var POCKET_SKIP = \{ passwords: 1, settings: 1 \};/);
  const L = read("launcher.js");
  assert.match(L, /host\.dockExtra \? host\.dockExtra\(\) : null/);
  assert.match(L, /refreshDock: function \(\) \{ paintDock\(\); \}/);
  assert.match(L, /!b\.hasAttribute\("data-app"\)\) return;/, "the Pocket button is never dragged");
  assert.match(read("send/sheet.js"), /typeof env\.pocket === "function"/);
  assert.match(read("quickmenu.js"), /root\.orosPocket\.keep\("text", \{ text: c\.text \}/);
  assert.match(read("settings/settings.js"), /act\("pocket\.clear"\)/);
  assert.match(read("settings/core.js"), /\["pocket", "system", "pk\.title", null, null, "pocket"\]/);
  assert.match(read("pocket.js"), /ic\.innerHTML = IC\[it\.k\] \|\| IC\.text;/);
  assert.doesNotMatch(read("pocket.js"), /innerHTML = (?!IC|icon)/, "data only through textContent");
});

test("strings in English, Greek and German", () => {
  const keys = ["qm.sel.pocket", "sc.desc.pocket", "pk.title", "pk.close", "pk.hint", "pk.empty", "pk.strict", "pk.send",
    "pk.copy", "pk.copied", "pk.nocopy", "pk.remove", "pk.clear", "pk.missing", "pk.kept", "pk.big", "pk.secret",
    "pk.failed", "pk.nofit", "pk.chip", "pk.chip1", "pk.desk"];
  const tr = read("translations.js"), de = read("i18n/de/shell.js");
  for (const k of keys) {
    assert.equal(tr.split('"' + k + '":').length - 1, 2, k + " in EN and EL");
    assert.ok(de.includes('"' + k + '":'), k + " in DE");
  }
  const st = read("settings/core.js"), sde = read("i18n/de/settings.js");
  for (const k of ["pk.title", "pk.hint", "pk.count", "pk.none", "pk.open", "pk.clear", "pk.strict"]) {
    assert.equal(st.split('"' + k + '":').length - 1, 2, k + " in Settings EN and EL");
    assert.ok(sde.includes('"' + k + '":'), k + " in Settings DE");
  }
  assert.match(read("send/sheet.js"), /pocket: "Keep in pocket"/);
  assert.match(read("send/sheet.js"), /pocket: "Στην τσέπη"/);
});

test("help: Send to someone, Shortcuts and Settings in every language", () => {
  for (const f of ["help/topics/share.en.txt", "help/topics/share.el.txt", "i18n/de/help/topics/share.txt"]) {
    assert.match(read(f), /^### (The Pocket|Η Τσέπη|Die Ablage)$/m, f);
  }
  for (const f of ["help/topics/shortcuts.en.txt", "help/topics/shortcuts.el.txt", "i18n/de/help/topics/shortcuts.txt"]) {
    assert.match(read(f), /\[\[Ctrl\+Alt\+Shift\+,\]\]/, f);
  }
  for (const f of ["settings/help.en.txt", "settings/help.el.txt", "i18n/de/help/settings.txt"]) {
    assert.match(read(f), /^### (Pocket|Τσέπη|Ablage)$/m, f);
  }
});
