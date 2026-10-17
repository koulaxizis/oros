// Language packs beyond English and Greek: the runtime (i18n.js) and the
// checks the CI applies to a translator's pack (.github/i18n/scan.js).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const S = require("../.github/i18n/scan.js");

const SRC = fs.readFileSync(path.join(__dirname, "..", "i18n.js"), "utf8");

// i18n.js in a small fake page: storage, URL, and what document.write wrote.
function load(opts) {
  const o = opts || {};
  const written = [];
  const store = { "oros-lang": o.stored || null };
  const win = {
    localStorage: { getItem: (k) => (k in store ? store[k] : null) },
    location: { search: o.search || "" },
    document: {
      readyState: "loading",
      currentScript: { src: "https://useoros.online/notes/../i18n.js?v=9.9.9", getAttribute: (k) => (k === "data-app" ? o.app || null : null) },
      write: (h) => written.push(h)
    }
  };
  win.window = win; win.parent = win; win.top = win;
  vm.runInNewContext(SRC, win);
  return { I: win.orosI18n, pack: win.orosPack, written, win };
}

test("English and Greek load nothing extra", () => {
  assert.deepEqual(load({ stored: "el", app: "notes" }).written, []);
  assert.deepEqual(load({ app: "notes" }).written, []);
});

test("a pack language writes the app's pack before the app's scripts", () => {
  const r = load({ stored: "de", app: "notes" });
  assert.equal(r.I.lang(), "de");
  assert.equal(r.written.length, 1);
  assert.match(r.written[0], /^<script src="https:\/\/useoros\.online\/notes\/\.\.\/i18n\/de\/notes\.js\?v=9\.9\.9"><\/script>$/);
});

test("an unknown stored language reads English", () => {
  const r = load({ stored: "xx", app: "notes" });
  assert.equal(r.I.lang(), "en");
  assert.deepEqual(r.written, []);
});

test("?lang= picks a hidden language on the top window", () => {
  assert.equal(load({ search: "?lang=de" }).I.lang(), "de");
  assert.equal(load({ search: "?lang=fr" }).I.lang(), "en");
});

test("table(): English overlaid with fitting values only", () => {
  const r = load({ stored: "de" });
  r.pack("de", "notes", {
    a: "Hallo", b: "{n} Seiten", c: "<b>fett</b>", d: "kaputt {x}", e: "<img src=x onerror=alert(1)>", f: 7, g: "  "
  });
  const T = { en: { a: "Hello", b: "{n} pages", c: "<b>bold</b>", d: "broken {n}", e: "plain", f: "seven", g: "blank", h: "missing" }, el: {} };
  const de = r.I.table(T, "notes");
  assert.equal(de, T.de);
  assert.equal(de.a, "Hallo");
  assert.equal(de.b, "{n} Seiten");
  assert.equal(de.c, "<b>fett</b>");
  assert.equal(de.d, "broken {n}", "different placeholders → English");
  assert.equal(de.e, "plain", "added markup → English");
  assert.equal(de.f, "seven", "not a string → English");
  assert.equal(de.g, "blank", "blank → English");
  assert.equal(de.h, "missing", "missing → English");
  assert.equal(r.I.coverage(T, "notes", "de"), 3 / 8);
});

test("table() leaves English and Greek tables as they are", () => {
  const r = load({ stored: "el" });
  const T = { en: { a: "Hello" }, el: { a: "Γεια" } };
  assert.equal(r.I.table(T, "notes"), T.el);
  assert.equal(T.de, undefined);
});

test("a pack cannot name English or Greek, or a bad app id", () => {
  const r = load({ stored: "de" });
  r.pack("el", "notes", { a: "x" });
  r.pack("de", "../x", { a: "x" });
  const T = { en: { a: "Hello" }, el: { a: "Γεια" } };
  assert.equal(r.I.table(T, "notes", "el").a, "Γεια");
  assert.equal(r.I.table(T, "../x", "de").a, "Hello");
});

test("locale, choices and plural forms", () => {
  const r = load({ stored: "de" });
  assert.equal(r.I.locale(), "de-DE");
  assert.equal(r.I.locale("el"), "el-GR");
  assert.equal(r.I.base(), "en");
  assert.equal(r.I.base("el"), "el");
  // Shown languages are always offered (partial ones marked); hidden
  // ones only while active.
  assert.ok(r.I.choices().some((l) => l.code === "de" && l.partial));
  const en = load({ stored: "en" }).I;
  for (const l of en.LANGS) {
    assert.equal(en.choices().some((c) => c.code === l.code), l.status !== "hidden", l.code);
  }
  const tbl = { "n.one": "1 page", "n.some": "{n} pages" };
  assert.equal(r.I.plural(tbl, "n", 1), "1 page");
  assert.equal(r.I.plural(tbl, "n", 5), "{n} pages");
  assert.equal(r.I.plural({ "n.one": "a", "n.other": "b" }, "n", 3), "b");
});

test("help pages of a pack language live in its folder", () => {
  const r = load({ stored: "de" });
  assert.equal(r.I.helpPath("t", "sync"), "i18n/de/help/topics/sync.txt");
  assert.equal(r.I.helpPath("a", "notes"), "i18n/de/help/notes.txt");
  assert.equal(r.I.helpPath("a", "notes", "el"), null);
});

test("CI pack check: only data, real keys, same placeholders and tags", () => {
  const ok = S.readPack("i18n/de/notes.js", 'orosPack("de", "notes", {\n "a": "Hallo {n}"\n});\n');
  assert.equal(ok.error, undefined);
  assert.deepEqual(S.checkPack(ok, new Map([["a", "Hello {n}"]])), []);
  for (const bad of [
    'orosPack("de", "notes", { "a": "x" }); alert(1);',
    'orosPack("de", "notes", { a: "x" });',
    'orosPack("de", "notes", { "a": ["x"] });',
    'orosPack("fr", "notes", { "a": "x" });',
    'window.x = 1;'
  ]) assert.ok(S.readPack("i18n/de/notes.js", bad).error, bad);
  const p = { code: "de", app: "notes", table: { a: "Hallo", b: "<b>x</b>", c: "Hello there my friend", z: "?" } };
  const en = new Map([["a", "Hello {n}"], ["b", "x"], ["c", "Hello there my friend"]]);
  const found = S.checkPack(p, en).join("\n");
  assert.match(found, /a must keep the placeholders \{n\}/);
  assert.match(found, /b must keep the same HTML tags/);
  assert.match(found, /c is still the English sentence/);
  assert.match(found, /unknown key z/);
});

test("a translator's own lines (this device) go over the pack, through the same checks", () => {
  const SRC2 = SRC;
  const store = {
    "oros-lang": "de",
    "oros-i18n-local": JSON.stringify({ de: { notes: { a: "Lokal", b: "ohne Zahl", c: 5 } } })
  };
  const win = {
    localStorage: { getItem: (k) => (k in store ? store[k] : null) },
    location: { search: "" },
    document: { readyState: "complete", currentScript: null, write: () => {} }
  };
  win.window = win; win.parent = win; win.top = win;
  vm.runInNewContext(SRC2, win);
  win.orosPack("de", "notes", { a: "Datei", d: "Datei d" });
  const T = { en: { a: "A", b: "{n} pages", c: "C", d: "D" }, el: {} };
  const de = win.orosI18n.table(T, "notes");
  assert.equal(de.a, "Lokal");
  assert.equal(de.b, "{n} pages", "a local line that breaks the rules shows English");
  assert.equal(de.c, "C");
  assert.equal(de.d, "Datei d");
});
