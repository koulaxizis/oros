// Help app: the page parser and search (pure logic of help/help.js),
// and the guide's coverage rules that keep it current:
//   - every app in apps.json has help.en.txt + help.el.txt (apps still
//     waiting for a page are listed in PENDING, which may only shrink)
//   - every topic of help/topics.json exists in both languages
//   - EN and EL pages have the same headings outline
//   - every link resolves (apps, pages, sections); no raw HTML
//   - every shell shortcut (SC_DEFS) is in the Shortcuts topic
//   - once Help is precached, every page is precached too
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const exists = (p) => fs.existsSync(path.join(ROOT, p));

const src = read("help/help.js");
function block(from, to) {
  const i = src.indexOf(from), j = src.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return src.slice(i, j);
}
const H = new Function(
  block("  var TOPICS_URL", "  // ---------- 1.") +
  block("  // ---------- 2. Page parser", "  // ---------- 4. Loading") +
  "\nreturn { fold, slugify, parseTarget, parseInline, inlineText, parsePage, indexPage, search, snippet, MAX_HITS };")();

// Apps that have no guide page yet. Remove an id when its page lands;
// the test fails if a listed app already has both pages.
const PENDING = [
  "calculator", "quote", "storage", "minimalism", "prompter", "characters",
  "mood", "habits", "cycle", "dice", "radio", "television",
  "memory", "connect4", "dots", "tictactoe", "simon", "netizen", "slider",
  "lightsout", "petworld", "wallpaper", "whack", "mixer", "snake", "wheel",
  "g2048", "zen", "wordle", "names", "passwords"
];

const apps = JSON.parse(read("apps.json")).apps.filter((a) => a.type !== "external");
const appIds = new Set(apps.map((a) => a.id));
const topics = JSON.parse(read("help/topics.json")).topics.map((t) => t.id);
const LANGS = ["en", "el"];

// Every page file in the repo: topics + <app>/help.<lang>.txt.
function pageFiles() {
  const out = [];
  topics.forEach((id) => LANGS.forEach((l) => out.push({ kind: "t", id, lang: l, file: `help/topics/${id}.${l}.txt` })));
  fs.readdirSync(ROOT, { withFileTypes: true }).forEach((d) => {
    if (!d.isDirectory() || d.name.startsWith(".")) return;
    LANGS.forEach((l) => {
      const f = `${d.name}/help.${l}.txt`;
      if (exists(f)) out.push({ kind: "a", id: d.name, lang: l, file: f });
    });
  });
  return out.filter((p) => exists(p.file));
}

const parsed = new Map();   // file → page
function page(file) {
  if (!parsed.has(file)) parsed.set(file, H.parsePage(read(file)));
  return parsed.get(file);
}

// ---------- parser + search ----------

test("parser: title, headings, lists, notes, continuation, unique ids", () => {
  const p = H.parsePage([
    "# Notes", "Intro line one", "and two.", "",
    "## Getting started", "- one", "- two", "  continued", "1. first", "2. second", "",
    "> a tip", "> more", ">! careful", "",
    "## Getting started", "### Συγχρονισμός και αντίγραφα"
  ].join("\r\n"));
  assert.equal(p.title, "Notes");
  assert.deepEqual(p.blocks.map((b) => b.t), ["p", "h2", "ul", "ol", "tip", "warn", "h2", "h3"]);
  assert.equal(p.blocks[0].text, "Intro line one and two.");
  assert.deepEqual(p.blocks[2].items, ["one", "two continued"]);
  assert.deepEqual(p.blocks[3].items, ["first", "second"]);
  assert.equal(p.blocks[4].text, "a tip more");
  assert.equal(p.blocks[1].id, "getting-started");
  assert.equal(p.blocks[6].id, "getting-started-2");
  assert.equal(p.blocks[7].id, "συγχρονισμοσ-και-αντιγραφα");
});

test("parser: inline markup; HTML stays text", () => {
  const tk = H.parseInline("Press [[Ctrl+Alt+Shift+H]] or **bold** `Save` [Sync](help:t/sync#passphrase) <script>x</script>");
  const kinds = tk.map((x) => x.t);
  assert.deepEqual(kinds, ["text", "kbd", "text", "b", "text", "code", "text", "link", "text"]);
  assert.deepEqual(tk[1].keys, ["Ctrl", "Alt", "Shift", "H"]);
  assert.deepEqual(tk[7].target, { kind: "help", route: "t/sync/passphrase" });
  assert.equal(tk[8].v, " <script>x</script>");
  assert.equal(H.inlineText("a **b** [[Ctrl+S]] [c](app:notes)"), "a b Ctrl+S c");
});

test("link targets: only apps, help pages and https", () => {
  assert.deepEqual(H.parseTarget("app:notes"), { kind: "app", id: "notes" });
  assert.deepEqual(H.parseTarget("help:a/notes"), { kind: "help", route: "a/notes" });
  assert.deepEqual(H.parseTarget("https://example.org/x?y=1"), { kind: "url", href: "https://example.org/x?y=1" });
  ["javascript:alert(1)", "http://example.org", "data:text/html,x", "help:x/notes", "app:../x",
   "help:a/Notes", "//evil.example", "https://a b", "vbscript:x", "app:"].forEach((h) => {
    assert.equal(H.parseTarget(h), null, h);
  });
  // a link with an unknown target is plain text
  assert.deepEqual(H.parseInline("[x](javascript:alert(1))").map((x) => x.t), ["text", "text"]);
});

test("search: accent- and case-insensitive, every term must match, title ranks first", () => {
  const a = H.indexPage("t/sync", H.parsePage("# Συγχρονισμός\nΤο orOS συγχρονίζει.\n## Κωδικός\nΗ φράση πρόσβασης."));
  const b = H.indexPage("a/notes", H.parsePage("# Σημειώσεις\n## Συγχρονισμός\nΟι σημειώσεις συγχρονίζονται."));
  const c = H.indexPage("a/todo", H.parsePage("# To-Do\nTasks."));
  let hits = H.search([a, b, c], "ΣΥΓΧΡΟΝΙΣΜΟΣ");
  assert.deepEqual(hits.map((h) => h.route), ["t/sync", "a/notes"]);
  assert.equal(hits[1].sec.id, "συγχρονισμοσ");
  hits = H.search([a, b, c], "φραση συγχρονισμος");
  assert.deepEqual(hits.map((h) => h.route), ["t/sync"]);
  hits = H.search([a, b, c], "Φράση");
  assert.equal(hits[0].sec.id, "κωδικοσ");
  assert.deepEqual(H.search([a, b, c], "  "), []);
  assert.equal(H.fold("Ταΐζω ΆΝΘΡΩΠΟΣ"), "ταιζω ανθρωποσ");
  assert.ok(H.snippet("x".repeat(300) + " target " + "y".repeat(300), "target").includes("target"));
});

// ---------- coverage ----------

test("every topic exists in English and Greek", () => {
  assert.ok(topics.includes("start") && topics.includes("shortcuts"));
  assert.equal(new Set(topics).size, topics.length, "duplicate topic id");
  topics.forEach((id) => LANGS.forEach((l) => {
    assert.ok(exists(`help/topics/${id}.${l}.txt`), `help/topics/${id}.${l}.txt missing`);
  }));
});

test("every app in apps.json has a guide page in both languages (PENDING may only shrink)", () => {
  // Enforced once Help itself is registered: before that, app
  // releases that land first must not fail on a rule not yet in force
  // (the Help release adds them to PENDING).
  const missing = [];
  if (appIds.has("help")) apps.forEach((a) => {
    if (PENDING.includes(a.id)) return;
    LANGS.forEach((l) => { if (!exists(`${a.id}/help.${l}.txt`)) missing.push(`${a.id}/help.${l}.txt`); });
  });
  assert.deepEqual(missing, [], "add the missing guide pages (format: OROS_BIBLE.md, Help page format)");
  PENDING.forEach((id) => {
    const done = LANGS.every((l) => exists(`${id}/help.${l}.txt`));
    assert.ok(!done, `${id} has both pages now: remove it from PENDING in tests/help.test.js`);
  });
});

test("pages: a title, no raw HTML, same outline in EN and EL", () => {
  const files = pageFiles();
  assert.ok(files.length >= 2 * topics.length);
  files.forEach((p) => {
    const txt = read(p.file);
    assert.ok(/^# \S/.test(txt.replace(/^﻿/, "")), `${p.file}: first line must be "# Title"`);
    assert.ok(!/<\/?[a-z][a-z0-9-]*(\s[^>]*)?>/i.test(txt), `${p.file}: raw HTML`);
    assert.ok(!txt.includes("\r"), `${p.file}: use LF line endings`);
    assert.ok(page(p.file).blocks.length > 0, `${p.file}: empty page`);
  });
  const byPage = {};
  files.forEach((p) => { (byPage[p.kind + "/" + p.id] = byPage[p.kind + "/" + p.id] || {})[p.lang] = p.file; });
  Object.keys(byPage).forEach((k) => {
    const f = byPage[k];
    assert.ok(f.en && f.el, `${k}: needs both help.en.txt and help.el.txt`);
    const outline = (file) => page(file).blocks.filter((b) => b.t === "h2" || b.t === "h3").map((b) => b.t).join(",");
    assert.equal(outline(f.el), outline(f.en), `${k}: EN and EL headings differ (count or ##/### order)`);
  });
});

test("pages: every link resolves", () => {
  const files = pageFiles();
  const sectionIds = (file) => new Set(page(file).blocks.filter((b) => b.id).map((b) => b.id));
  files.forEach((p) => {
    const txt = read(p.file);
    const re = /\[([^\]]+)\]\(([^)\s]+)\)/g;
    let m;
    while ((m = re.exec(txt))) {
      if (m[0].startsWith("[[")) continue;
      const tg = H.parseTarget(m[2]);
      assert.ok(tg, `${p.file}: unsupported link target ${m[2]}`);
      if (tg.kind === "app") {
        assert.ok(exists(`${tg.id}/index.html`), `${p.file}: no app folder for ${m[2]}`);
      } else if (tg.kind === "help") {
        const [k, id, sec] = tg.route.split("/");
        const file = k === "t" ? `help/topics/${id}.${p.lang}.txt` : `${id}/help.${p.lang}.txt`;
        if (k === "t") assert.ok(topics.includes(id), `${p.file}: unknown topic ${m[2]}`);
        else assert.ok(exists(`${id}/index.html`), `${p.file}: unknown app ${m[2]}`);
        if (exists(file) && sec) {
          assert.ok(sectionIds(file).has(sec), `${p.file}: no section "${sec}" in ${file}`);
        }
      }
    }
  });
});

test("the Shortcuts topic lists every shell shortcut", () => {
  const shell = read("shell.js");
  const defs = shell.slice(shell.indexOf("var SC_DEFS = ["), shell.indexOf("];", shell.indexOf("var SC_DEFS = [")));
  const keys = [...defs.matchAll(/key:\s*"([a-z])"/g)].map((m) => m[1].toUpperCase());
  assert.ok(keys.length >= 9 && keys.includes("H"));
  LANGS.forEach((l) => {
    const txt = read(`help/topics/shortcuts.${l}.txt`);
    keys.forEach((k) => {
      assert.ok(txt.includes(`[[Ctrl+Alt+Shift+${k}]]`), `shortcuts.${l}.txt: Ctrl+Alt+Shift+${k} missing`);
    });
  });
});

test("offline: once Help is precached, every page is precached", () => {
  const sw = read("sw.js");
  const list = (sw.match(/PRECACHE_URLS\s*=\s*\[([\s\S]*?)\]/) || [])[1] || "";
  if (!list.includes('"help/"')) return;   // Help not released yet
  const want = ["help/topics.json"].concat(pageFiles().filter((p) => p.kind === "t" || appIds.has(p.id))
    .map((p) => p.file));
  want.forEach((u) => assert.ok(list.includes(`"${u}"`), `sw.js PRECACHE_URLS: add "${u}"`));
});
