// New users, wave 2: the friendly empty screen (EMPTY-1, emptykit.js)
// in nine apps, and one tip the first time an app opens (TIP-1, shell.js).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const K = require(path.join(ROOT, "emptykit.js"));
const SHELL = read("shell.js");

function cut(src, name) {
  const i = src.indexOf("  function " + name + "(");
  if (i < 0) throw new Error("missing function " + name);
  let depth = 0, j = src.indexOf("{", i);
  for (; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) break;
  }
  return src.slice(i, j + 1);
}

const APPS = ["todo", "kanban", "bookmarks", "invoices", "habits", "contacts", "budget", "notes", "meals"];

test("kit: the first two text children become title and text; the kit's own parts are skipped", () => {
  assert.deepEqual(K.roles([{}, {}]), { title: 0, text: 1 });
  assert.deepEqual(K.roles([{ kit: true }, {}, {}, {}]), { title: 1, text: 2 });
  assert.deepEqual(K.roles([{}]), { title: 0, text: -1 });
  assert.deepEqual(K.roles([]), { title: -1, text: -1 });
});

test("kit: text through textContent; the only innerHTML is the shell's static icon, checked to be an <svg>", () => {
  const src = read("emptykit.js");
  assert.deepEqual(src.match(/innerHTML = [a-z]+/g), ["innerHTML = svg"]);
  assert.match(src, /\/\^<svg\[\\s>\]\/\.test\(svg\.trim\(\)\)/);
  assert.match(src, /b\.textContent = String\(opts\.action\.label\);/);
  assert.doesNotMatch(src, /localStorage|fetch\(|XMLHttpRequest/, "stores and sends nothing");
  const css = read("emptykit.css");
  assert.match(css, /html\[data-oros-contrast="high"\] \.ek > \.ek-art/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.ek > \.ek-art \{ animation: none; \} \}/);
  assert.match(css, /\.ek \.ek-act \{\n  min-height: 44px;/);
});

test("kit: precached; every dressed app loads the stylesheet, and the script where it calls dress()", () => {
  const sw = read("sw.js");
  assert.match(sw, /"emptykit\.js",\n  "emptykit\.css",/);
  for (const a of APPS) {
    const html = read(a + "/index.html");
    assert.match(html, /<link rel="stylesheet" href="\.\.\/emptykit\.css\?v=[^"]+">/, a + " css");
    const js = read(a + "/" + a + ".js");
    if (a === "habits") {
      assert.match(js, /<div class="empty ek"><span class="ek-art" aria-hidden="true">/);
      assert.match(js, /class="ek-act" data-act="new"/);
      continue;
    }
    assert.match(html, /<script src="\.\.\/emptykit\.js\?v=[^"]+"><\/script>/, a + " js");
    assert.ok(html.indexOf("emptykit.js") < html.indexOf('src="' + a + ".js"), a + ": the kit loads before the app");
    assert.match(js, new RegExp('window\\.orosEmpty\\.dress\\([^\\n]*\\{ app: "' + a + '", action: \\{ label: t\\("[a-z.]+"\\), run: '), a + " dress");
  }
});

test("kit: the new strings exist in EN, EL and DE", () => {
  const want = { bookmarks: ["ek.go"], invoices: ["ek.go"], contacts: ["ek.go", "ek.hint"], budget: ["ek.go", "ek.hint"], notes: ["ek.hint"], meals: ["ek.title"] };
  for (const [a, keys] of Object.entries(want)) {
    const js = read(a + "/" + a + ".js"), de = read("i18n/de/" + a + ".js");
    for (const k of keys) {
      assert.equal((js.match(new RegExp('"' + k.replace(".", "\\.") + '":', "g")) || []).length, 2, a + " " + k + " EN + EL");
      assert.ok(de.includes('"' + k + '":'), a + " " + k + " DE");
    }
  }
});

test("kit: only the true first-use empty gets the friendly screen", () => {
  assert.match(read("contacts/contacts.js"), /if \(!q && !reach && !state\.contacts\.length && window\.orosEmpty\) \{/);
  assert.match(read("budget/budget.js"), /if \(!inbox && !query && filter === "all" && window\.orosEmpty\) \{/);
  assert.match(read("meals/meals.js"), /if \(none && window\.orosEmpty\) \{/);
  const notes = read("notes/notes.js");
  assert.match(cut(notes, "renderEmptyKit"), /var on = !page && !!window\.orosEmpty && !state\.pages\.some\(function \(p\) \{ return p\.nb === currentNbId\(\); \}\);/);
  assert.match(read("notes/notes.css"), /#page-body\.ek-on > #page-text, #page-body\.ek-on > #page-preview \{ display: none; \}/);
});

const tipFrom = new Function("var TIP_MAX = 240;\n" + cut(SHELL, "tipFrom") + "\nreturn tipFrom;")();

test("tip: the first paragraph under the first ## heading, Markdown taken out", () => {
  assert.equal(tipFrom("# App\nIntro.\n\n## Getting started\nPress **New**, type in `Name` and press [[Enter]]. See [Help](help:t/start).\n\n## More\nx"),
    "Press New, type in Name and press Enter. See Help.");
  assert.equal(tipFrom("# App\nIntro line one\nline two.\n\nrest"), "Intro line one line two.", "no ## heading: the intro");
  assert.equal(tipFrom("# App\n\n## Start\n- First bullet.\n- Second."), "First bullet.");
  assert.equal(tipFrom(""), "");
  const long = tipFrom("# A\n## S\n" + "This is a sentence that goes on. ".repeat(20));
  assert.ok(long.length <= 240 && /\.$/.test(long), "cut at a sentence end");
  const word = tipFrom("# A\n## S\n" + "word ".repeat(80));
  assert.ok(word.length <= 241 && word.endsWith("…"));
});

test("tip: every app's guide gives one", () => {
  for (const a of JSON.parse(read("apps.json")).apps) {
    for (const lang of ["en", "el"]) {
      const p = a.id + "/help." + lang + ".txt";
      if (!fs.existsSync(path.join(ROOT, p))) continue;
      assert.ok(tipFrom(read(p)).length >= 30, p);
    }
  }
});

test("tip: once per app, new users only, never for games, Help, a single app or during the tour", () => {
  const may = cut(SHELL, "tipMaybe");
  assert.match(may, /if \(SOLO \|\| !app \|\| app\.type !== "internal" \|\| app\.id === "help" \|\| app\.category === "Games" \|\| tourBox\) return;/);
  assert.match(may, /if \(!tp\.on \|\| tp\.seen\.indexOf\(app\.id\) !== -1\) return;/);
  assert.ok(may.indexOf("tipsWrite(tp);") < may.indexOf("fetch("), "marked before the guide is read");
  assert.match(may, /if \(!tip \|\| seq !== tipSeq \|\| !state\.running \|\| state\.running\.id !== app\.id\) return;/);
  assert.match(cut(SHELL, "tipsRead"), /if \(!v \|\| typeof v !== "object"\) return \{ on: 0, seen: \[\] \};/, "absent = off");
  assert.match(cut(SHELL, "tourFirstRun"), /tipsStart\(\);/);
  assert.match(cut(SHELL, "tipUrl"), /"i18n\/de\/help\/" \+ id \+ "\.txt"/);
  const show = cut(SHELL, "tipShow");
  assert.doesNotMatch(show, /innerHTML/);
  assert.match(show, /openHelp\("a\/" \+ id\)/);
  assert.match(cut(SHELL, "returnToDesktop"), /tipEnd\(\);/);
  assert.match(cut(SHELL, "openApp"), /tipEnd\(\);\n    tipMaybe\(app\);/);
});

test("tip: Settings switch, strings, styles", () => {
  assert.match(SHELL, /tips: SOLO \? null : \{ on: !!tipsRead\(\)\.on \},/);
  assert.match(cut(SHELL, "settingsSet"), /case "tips":\s+tipsSetUser\(!!value\);/);
  assert.match(read("settings/settings.js"), /switchBtn\(!!tips\.on, "tips", function \(v\) \{ set\("tips", v\); \}/);
  const core = read("settings/core.js"), de = read("i18n/de/settings.js");
  assert.match(core, /tips: "device"/);
  assert.match(core, /\["tips", "appearance", "a\.tips"\]/);
  for (const k of ["a.tips", "a.tips.hint", "w.tips"]) {
    assert.equal((core.match(new RegExp('"' + k.replace(/\./g, "\\.") + '":', "g")) || []).length, 2, k);
    assert.ok(de.includes('"' + k + '":'), k + " DE");
  }
  const tr = read("translations.js"), sde = read("i18n/de/shell.js");
  const en = tr.slice(0, tr.indexOf("\n  el: {")), el = tr.slice(tr.indexOf("\n  el: {"));
  for (const k of ["tip.label", "tip.more", "tip.close"]) {
    assert.ok(en.includes('"' + k + '":') && el.includes('"' + k + '":') && sde.includes('"' + k + '":'), k);
  }
  assert.match(read("style.css"), /#oros-tip \{/);
});
