// Clipboard history (cliphist.js, CLIP-1): the model (limits, expiry,
// secrets, skipped apps and fields) and the wiring in the shell, the
// page, Quick settings, Settings, the desktop menu and the strings.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const C = require(path.join(ROOT, "cliphist.js"));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

const HOUR = 3600000, DAY = 86400000;
const on = (keep) => ({ v: 1, keep: keep || "day", items: [] });

test("parse: no record or a bad one is off; items are cleaned and sorted", () => {
  assert.equal(C.parse(null), null);
  assert.equal(C.parse("{"), null);
  assert.equal(C.parse({ v: 2, items: [] }), null);
  const st = C.parse(JSON.stringify({ v: 1, keep: "year", items: [
    { t: "a", at: 1, app: "notes" }, { t: "b\r\nc", at: 5 }, { t: "   ", at: 3 }, { t: 7, at: 4 }, { t: "dup", at: 5 }
  ] }));
  assert.equal(st.keep, "day");
  assert.deepEqual(st.items, [{ t: "b\nc", at: 5, app: "" }, { t: "a", at: 1, app: "notes" }]);
});

test("add: newest first, same text moves up, times stay unique", () => {
  let st = on();
  st = C.add(st, "one", "notes", 1000);
  st = C.add(st, "two", "writer", 1000);
  assert.deepEqual(st.items.map((i) => i.t), ["two", "one"]);
  assert.equal(st.items[0].at, 1001);
  st = C.add(st, "one", "todo", 2000);
  assert.deepEqual(st.items.map((i) => i.t), ["one", "two"]);
  assert.equal(st.items[0].app, "todo");
  assert.equal(C.add(st, "  \n ", "notes", 3000), st, "blank text is not kept");
  assert.equal(C.add(null, "x", "notes", 1), null, "off keeps nothing");
});

test("add: secrets are never kept", () => {
  const st = on();
  assert.equal(C.add(st, "otpauth://totp/A:b?secret=JBSWY3DPEHPK3PXP", "notes", 1), st);
  assert.equal(C.add(st, "  otpauth-migration://offline?data=x", "notes", 1), st);
  assert.equal(C.add(st, "-----BEGIN OPENSSH PRIVATE KEY-----\nabc", "pad", 1), st);
  assert.ok(C.add(st, "-----BEGIN PUBLIC KEY-----", "pad", 1).items.length === 1);
});

test("limits: 30 copies, 10 000 characters each, 60 000 together", () => {
  let st = on();
  for (let i = 0; i < 40; i++) st = C.add(st, "copy " + i, "notes", 1000 + i);
  assert.equal(st.items.length, C.MAX_ITEMS);
  assert.equal(st.items[0].t, "copy 39");
  st = C.add(on(), "x".repeat(25000), "notes", 1);
  assert.equal(st.items[0].t.length, C.MAX_ITEM);
  st = on();
  for (let i = 0; i < 8; i++) st = C.add(st, String(i).repeat(C.MAX_ITEM), "notes", 10 + i);
  assert.equal(st.items.length, 6);
  assert.equal(st.items[0].t[0], "7");
  assert.ok(st.items.reduce((n, i) => n + i.t.length, 0) <= C.MAX_TOTAL);
});

test("prune: each copy is kept for the chosen time only", () => {
  const now = 100 * DAY;
  const st = { v: 1, keep: "hour", items: [
    { t: "new", at: now - 10 * 60000, app: "" }, { t: "old", at: now - 2 * HOUR, app: "" }
  ] };
  assert.deepEqual(C.prune(st, now).items.map((i) => i.t), ["new"]);
  assert.equal(C.prune({ v: 1, keep: "day", items: st.items }, now).items.length, 2);
  assert.equal(C.prune({ v: 1, keep: "week", items: [{ t: "w", at: now - 8 * DAY, app: "" }] }, now).items.length, 0);
});

test("remove forgets one copy", () => {
  let st = C.add(C.add(on(), "a", "", 1), "b", "", 2);
  st = C.remove(st, 1);
  assert.deepEqual(st.items.map((i) => i.t), ["b"]);
});

test("Passwords and Settings are never read; app folders from paths", () => {
  assert.equal(C.appOk("passwords"), false);
  assert.equal(C.appOk("settings"), false);
  assert.equal(C.appOk("notes"), true);
  assert.equal(C.appOfPath("/notes/index.html"), "notes");
  assert.equal(C.appOfPath("/oros/passwords/"), "passwords");
  assert.equal(C.appOfPath("/"), "");
});

test("password, one-time code and marked fields are secret", () => {
  const field = (tag, attrs, inside) => ({
    nodeType: 1, tagName: tag,
    getAttribute: (k) => (attrs[k] === undefined ? null : attrs[k]),
    closest: (sel) => (sel === "[data-oros-noclip]" && inside ? {} : null)
  });
  assert.equal(C.fieldSecret(field("INPUT", { type: "password" })), true);
  assert.equal(C.fieldSecret(field("INPUT", { type: "text", autocomplete: "one-time-code" })), true);
  assert.equal(C.fieldSecret(field("INPUT", { autocomplete: "username current-password" })), true);
  assert.equal(C.fieldSecret(field("TEXTAREA", {}, true)), true);
  assert.equal(C.fieldSecret(field("INPUT", { type: "text" })), false);
  assert.equal(C.fieldSecret(field("TEXTAREA", {})), false);
  assert.equal(C.fieldSecret(null), false);
});

test("ago and preview", () => {
  assert.deepEqual(C.ago(0, 30000), { k: "clip.now", n: 0 });
  assert.deepEqual(C.ago(0, 5 * 60000), { k: "clip.min", n: 5 });
  assert.deepEqual(C.ago(0, 3 * HOUR), { k: "clip.hours", n: 3 });
  assert.deepEqual(C.ago(0, 2 * DAY), { k: "clip.days", n: 2 });
  assert.deepEqual(C.ago(0, 61000), { k: "clip.min1", n: 1 });
  assert.deepEqual(C.ago(0, HOUR), { k: "clip.hours1", n: 1 });
  assert.deepEqual(C.ago(0, DAY + 5), { k: "clip.days1", n: 1 });
  assert.equal(C.preview("  a\n\n b  ", 10), "a b");
  assert.equal(C.preview("abcdefghij", 5), "abcd…");
});

test("W2 pins: never expire, first in the list, kept by Clear all, at most 10", () => {
  const now = 50 * DAY;
  let st = { v: 1, keep: "hour", items: [
    { t: "fresh", at: now - 60000, app: "notes" },
    { t: "old plain", at: now - 5 * DAY + 1, app: "notes" },
    { t: "old pinned", at: now - 5 * DAY, app: "notes" }
  ] };
  st = C.pin(st, now - 5 * DAY, true);
  const p = C.prune(st, now);
  assert.deepEqual(p.items.map((i) => i.t), ["fresh", "old pinned"]);
  assert.deepEqual(C.shown(p, "").map((i) => i.t), ["old pinned", "fresh"]);
  assert.deepEqual(C.clearKeep(p).items.map((i) => i.t), ["old pinned"]);
  const again = C.add(p, "old pinned", "todo", now);
  assert.equal(again.items[0].t, "old pinned");
  assert.equal(again.items[0].p, 1, "copied again stays pinned");
  assert.equal(C.pin(again, again.items[0].at, false).items[0].p, undefined);
  let many = { v: 1, keep: "week", items: [] };
  for (let i = 0; i < 14; i++) many = C.add(many, "p" + i, "", 1000 + i);
  many = { v: 1, keep: "week", items: many.items.map((i) => Object.assign({}, i, { p: 1 })) };
  const pr = C.prune(many, 2000);
  assert.equal(pr.items.filter((i) => i.p === 1).length, C.MAX_PINS);
  assert.equal(pr.items.length, 14, "pins past the limit stay as plain copies");
  assert.equal(C.parse(JSON.stringify(pr)).items.filter((i) => i.p === 1).length, C.MAX_PINS);
});

test("W2 search: every word, case, accents and final sigma ignored", () => {
  let st = C.add(C.add({ v: 1, keep: "day", items: [] }, "Ψάρι στη σχάρα", "", 1), "Große Straße", "", 2);
  assert.deepEqual(C.shown(st, "ψαρι").map((i) => i.t), ["Ψάρι στη σχάρα"]);
  assert.deepEqual(C.shown(st, "ΣΧΑΡΑ ψάρι").map((i) => i.t), ["Ψάρι στη σχάρα"]);
  assert.deepEqual(C.shown(st, "strasse").map((i) => i.t), ["Große Straße"]);
  assert.equal(C.shown(st, "  ").length, 2);
  assert.equal(C.shown(st, "zzz").length, 0);
  assert.equal(C.shown(null, "x").length, 0);
});

test("W2 command bar: clipboard words open the history only while it is on", () => {
  const K = require(path.join(ROOT, "commands/core.js"));
  const apps = [{ id: "settings", names: ["Settings"] }];
  for (const w of ["πρόχειρο", "Ιστορικό προχείρου", "clipboard history", "open clipboard", "Zwischenablage"]) {
    const c = K.parse(w, { today: "2026-11-15", apps, clipOn: true });
    assert.deepEqual(c && c.data, { name: "clip", value: true }, w);
    assert.equal(K.parse(w, { today: "2026-11-15", apps }), null, w + " while off");
    assert.deepEqual(K.call(c, "el"), { fn: "setting", args: ["clip", true] });
  }
  assert.match(read("shell.js"), /if \(name === "clip"\) \{ if \(window\.orosClip\) window\.orosClip\.open\(\);/);
});

test("wiring: page, shell, Quick settings, Settings, desktop menu", () => {
  const html = read("index.html"), shell = read("shell.js");
  assert.ok(html.indexOf('src="cliphist.js') > html.indexOf('src="widgets.js'));
  assert.ok(html.indexOf('src="cliphist.js') < html.indexOf('src="shell.js'));
  assert.match(shell, /\{ id: "clip", key: "v", label: "sc\.desc\.cliphist"/);
  assert.match(shell, /window\.orosClip\.attach\(/);
  assert.match(shell, /if \(window\.orosClip\) window\.orosClip\.wire\(f\);/);
  assert.match(shell, /clip: window\.orosClip \? window\.orosClip\.snapshot\(\) : null/);
  assert.match(shell, /case "clip":/);
  assert.match(shell, /case "clipKeep":/);
  assert.match(shell, /case "clip\.clear":/);
  assert.match(read("qsettings.js"), /root\.orosClip\.open\(\)/);
  assert.match(read("quickmenu.js"), /root\.orosClip\.note\(c\.text/);
  assert.match(read("settings/settings.js"), /set\("clip", v\)/);
  assert.match(read("cliphist.js"), /__orosDeskItems/);
});

test("strings in English, Greek and German", () => {
  const keys = ["sc.desc.cliphist", "qs.clip", "qs.clip.n", "clip.title", "clip.close", "clip.settings", "clip.clear",
    "clip.turnon", "clip.off", "clip.strict", "clip.empty", "clip.hint", "clip.copyit", "clip.forget", "clip.copied",
    "clip.nocopy", "clip.full", "clip.desk", "clip.now", "clip.min", "clip.hours", "clip.days", "clip.min1", "clip.hours1", "clip.days1", "clip.search", "clip.nomatch", "clip.hintPaste", "clip.thisapp", "clip.clearRest",
    "clip.pinned", "clip.paste", "clip.pin", "clip.unpin", "clip.pinmax", "clip.nopaste"];
  const tr = read("translations.js"), de = read("i18n/de/shell.js");
  for (const k of keys) {
    const n = tr.split('"' + k + '":').length - 1;
    assert.equal(n, 2, k + " in EN and EL");
    assert.ok(de.includes('"' + k + '":'), k + " in DE");
  }
  const st = read("settings/core.js"), sde = read("i18n/de/settings.js");
  for (const k of ["ch.title", "ch.on", "ch.hint", "ch.strict", "ch.keep", "ch.keep.hour", "ch.keep.day", "ch.keep.week",
    "ch.count", "ch.open", "ch.clear"]) {
    assert.equal(st.split('"' + k + '":').length - 1, 2, k + " in Settings EN and EL");
    assert.ok(sde.includes('"' + k + '":'), k + " in Settings DE");
  }
});

test("help: Privacy, Shortcuts and Settings pages in every language", () => {
  for (const f of ["help/topics/privacy.en.txt", "help/topics/privacy.el.txt", "i18n/de/help/topics/privacy.txt",
    "help/topics/shortcuts.en.txt", "help/topics/shortcuts.el.txt", "i18n/de/help/topics/shortcuts.txt",
    "settings/help.en.txt", "settings/help.el.txt", "i18n/de/help/settings.txt"]) {
    assert.match(read(f), /Ctrl\+Alt\+Shift\+V/, f);
  }
});
