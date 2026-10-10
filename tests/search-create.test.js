// Universal search, phase 2 — the "create" group: Mind Map, Prompter,
// Characters, Layout, Slides, Atelier, Score Keeper, Help. Plain node,
// no DOM: providers read through ctx.readJSON over an in-memory
// storage (Help reads its pages through a stubbed fetch).
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const S = require(path.join(__dirname, "..", "search.js"));
const P = (id) => require(path.join(__dirname, "..", id, "search.js"));
const IDS = ["mindmap", "prompter", "characters", "layout", "slides", "atelier", "scores", "help"];

function store(obj) {
  const m = new Map(Object.entries(obj).map(([k, v]) => [k, JSON.stringify(v)]));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m };
}
function ctxFor(storage, q, lang) {
  return { q, words: S.parseQuery(q), fold: S.fold, lang: lang || "en", limit: 50,
           readJSON: S.makeReader(storage) };
}
const ids = (hits) => hits.map((h) => h.id).sort();

test("mindmap: one hit per node, map name as text, tombstones skipped", () => {
  const st = store({ "oros-mindmap-data": { ver: 1,
    maps: [{ id: "m1", m: 10, sides: "both" }, { id: "m2", m: 10, sides: "both" }],
    nodes: [
      { id: "m1-r", m: 10, map: "m1", parent: "", ord: "", text: "Trip to Crete" },
      { id: "n1", m: 20, map: "m1", parent: "m1-r", ord: "0.V", text: "Ferry\nbook by May", note: "Blue Star", url: "https://example.com/f" },
      { id: "n2", m: 15, map: "m1", parent: "m1-r", ord: "0.k", text: "Gone ferry idea" },
      { id: "n3", m: 15, map: "m1", parent: "m1-r", ord: "0.z", text: "" },
      { id: "m2-r", m: 10, map: "m2", parent: "", ord: "", text: "Old ferry map" },
      { id: "x1", m: 10, map: "mx", parent: "", ord: "", text: "ferry orphan" }
    ],
    tombs: { n2: 15, m2: 11 } } });
  const hits = P("mindmap").search(ctxFor(st, "ferry"));
  assert.deepEqual(ids(hits), ["m1-r", "n1"]);
  const n1 = hits.find((h) => h.id === "n1");
  assert.equal(n1.title, "Ferry");
  assert.ok(n1.text.includes("book by May") && n1.text.includes("Blue Star") && n1.text.includes("Trip to Crete"));
  assert.deepEqual(n1.target, { map: "m1", node: "n1" });
  assert.equal(n1.when, 20);
  assert.deepEqual(hits.find((h) => h.id === "m1-r").target, { map: "m1", node: "m1-r" });
  assert.deepEqual(P("mindmap").search(ctxFor(store({}), "x")), []);
});

test("prompter: custom prompts only, current language first, deleted skipped", () => {
  const st = store({ "oros-prompter-data": { ver: 1, sm: 9, favorites: {}, completed: {},
    customs: [
      { id: "cabc1", cat: "micro", en: "A lighthouse keeper's last night", el: "Η τελευταία νύχτα του φαροφύλακα",
        var_en: "In 100 words", var_el: "Σε 100 λέξεις", tags: [], mtime: 50, pos: 0 },
      { id: "cabc2", cat: "haiku", en: "", el: "Χάικου για τη βροχή", tags: [], mtime: 40, pos: 1 },
      { id: "cdead", cat: "micro", en: "Deleted prompt", el: "", tags: [], mtime: 10, pos: 2 }
    ],
    deleted: { cdead: 20, "fav:p001": 5 } } });
  const en = P("prompter").search(ctxFor(st, "x"));
  assert.deepEqual(ids(en), ["cabc1", "cabc2"]);
  const a = en.find((h) => h.id === "cabc1");
  assert.equal(a.title, "A lighthouse keeper's last night");
  assert.ok(a.text.includes("φαροφύλακα") && a.text.includes("In 100 words"));
  assert.deepEqual(a.target, { prompt: "cabc1" });
  assert.equal(a.when, 50);
  assert.equal(en.find((h) => h.id === "cabc2").title, "Χάικου για τη βροχή");   // EN empty → EL
  const el = P("prompter").search(ctxFor(st, "x", "el"));
  assert.equal(el.find((h) => h.id === "cabc1").title, "Η τελευταία νύχτα του φαροφύλακα");
});

test("characters: characters and relationships, tombstones and dangling rels skipped", () => {
  const st = store({ "oros-characters-data": { ver: 1, om: 3,
    characters: {
      "c-1": { id: "c-1", name: "Eleni", role: "Captain", bio: "Grew up in Syros.",
               traits: [{ name: "Brave", str: 4 }], goals: [{ done: false, text: "Find the map" }], mtime: 30 },
      "c-2": { id: "c-2", name: "", role: "Smuggler", bio: "", traits: [], goals: [], mtime: 20 },
      "c-3": { id: "c-3", name: "Ghost", role: "", bio: "", traits: [], goals: [], mtime: 5 }
    },
    rels: {
      "c-1|c-2": { id: "c-1|c-2", a: "c-1", b: "c-2", type: "rival", text: "old debt", desc: "Owes her a ship", mtime: 40 },
      "c-1|c-9": { id: "c-1|c-9", a: "c-1", b: "c-9", type: "friend", text: "", desc: "", mtime: 40 }
    },
    deleted: { "c-3": 9 }, pos: [], posR: [] } });
  const hits = P("characters").search(ctxFor(st, "x"));
  assert.deepEqual(ids(hits), ["c-1", "c-1|c-2", "c-2"]);
  const c1 = hits.find((h) => h.id === "c-1");
  assert.equal(c1.title, "Eleni");
  assert.ok(c1.text.includes("Captain") && c1.text.includes("Syros") && c1.text.includes("Brave") && c1.text.includes("Find the map"));
  assert.deepEqual(c1.target, { char: "c-1" });
  assert.equal(hits.find((h) => h.id === "c-2").title, "Unnamed");
  const r = hits.find((h) => h.id === "c-1|c-2");
  assert.equal(r.title, "Eleni ↔ Unnamed");
  assert.ok(r.text.includes("old debt") && r.text.includes("Rival") && r.text.includes("Owes her a ship"));
  assert.deepEqual(r.target, { rel: "c-1|c-2" });
  const el = P("characters").search(ctxFor(st, "x", "el"));
  assert.ok(el.find((h) => h.id === "c-1|c-2").text.includes("Αντίζηλος/η"));
});

function dkDoc(id, name, extra) {
  return Object.assign({ id, m: 10, name, setup: {}, pages: [{ id: "pg-1", m: 10, pos: 0, ms: "" }],
    masters: [], items: [], stories: [], pstyles: [], cstyles: [], swatches: [], guides: [], rec: [], tombs: {} }, extra || {});
}

test("layout: one hit per document, stories as text, deleted docs skipped", () => {
  const st = store({ "oros-layout-data": { ver: 1,
    docs: [
      dkDoc("doc-a", "Parish newsletter", {
        stories: [
          { id: "st-1", m: 30, h: [], paras: [{ ps: "ps-h1", runs: [{ t: "Summer " }, { t: "fair", b: 1 }] },
                                             { ps: "ps-body", runs: [{ t: "Bring a cake." }, { f: "pn" }] }] },
          { id: "st-2", m: 5, h: [], paras: [{ ps: "ps-base", runs: [{ t: "dead story text" }] }] }
        ],
        tombs: { "st-2": 6 } }),
      dkDoc("doc-b", "", {}),
      dkDoc("doc-c", "Deleted poster", {})
    ],
    dt: { "doc-c": 99 } } });
  const hits = P("layout").search(ctxFor(st, "x"));
  assert.deepEqual(ids(hits), ["doc-a", "doc-b"]);
  const a = hits.find((h) => h.id === "doc-a");
  assert.equal(a.title, "Parish newsletter");
  assert.ok(a.text.includes("Summer fair") && a.text.includes("Bring a cake."));
  assert.ok(!a.text.includes("dead story"));
  assert.deepEqual(a.target, { doc: "doc-a" });
  assert.equal(a.when, 30);
  assert.equal(hits.find((h) => h.id === "doc-b").title, "Untitled");
  assert.equal(P("layout").search(ctxFor(st, "x", "el")).find((h) => h.id === "doc-b").title, "Χωρίς τίτλο");
});

test("atelier: text boxes in page order, deleted items and designs skipped", () => {
  const st = store({ "oros-atelier-data": { ver: 1,
    docs: [
      dkDoc("doc-p", "Birthday invite", {
        pages: [{ id: "pg-2", m: 10, pos: 1, ms: "" }, { id: "pg-1", m: 10, pos: 0, ms: "" }],
        items: [
          { id: "it-3", m: 12, t: "rect", pg: "pg-2", x: 0, y: 0, w: 100, h: 40, ax: { k: "text", tx: "RSVP to Maria" } },
          { id: "it-1", m: 12, t: "rect", pg: "pg-1", x: 0, y: 50, w: 100, h: 40, ax: { k: "text", tx: "Saturday 5pm" } },
          { id: "it-0", m: 12, t: "rect", pg: "pg-1", x: 0, y: 0, w: 100, h: 40, ax: { k: "text", tx: "Nikos turns 7!" } },
          { id: "it-2", m: 12, t: "rect", pg: "pg-1", x: 0, y: 0, w: 100, h: 40, ax: { k: "shape", shp: "star" } },
          { id: "it-9", m: 12, t: "rect", pg: "pg-1", x: 0, y: 0, w: 100, h: 40, ax: { k: "text", tx: "removed words" } }
        ],
        tombs: { "it-9": 13 } }),
      dkDoc("doc-q", "Old logo", { m: 5 })
    ],
    dt: { "doc-q": 10 } } });
  const hits = P("atelier").search(ctxFor(st, "x"));
  assert.deepEqual(ids(hits), ["doc-p"]);
  assert.equal(hits[0].title, "Birthday invite");
  assert.equal(hits[0].text, "Nikos turns 7! Saturday 5pm RSVP to Maria");
  assert.deepEqual(hits[0].target, { doc: "doc-p" });
  assert.equal(hits[0].when, 13);
});

test("slides: one hit per slide, title placeholder, notes, ghosts and tombstones skipped", () => {
  const st = store({ "oros-slides-data": { ver: 1,
    decks: {
      "dk-one": { id: "dk-one", m: 10, t: "Quarterly review", as: "16:9", th: "light", ft: {}, c: 10, tm: 40 },
      "dk-empty": { id: "dk-empty", m: 12, t: "", as: "16:9", th: "light", ft: {}, c: 12, tm: 0 }
    },
    slides: {
      "sl-b": { id: "sl-b", m: 10, d: "dk-one", p: "b", ly: "title", tr: "none", hid: false, n: "Mention the hires", nb: 0, nm: 20, tm: 30 },
      "sl-a": { id: "sl-a", m: 10, d: "dk-one", p: "a", ly: "blank", tr: "none", hid: false, n: "", nb: 0, nm: 0, tm: 15 },
      "sl-x": { id: "sl-x", m: 10, d: "dk-one", p: "c", ly: "blank", tr: "none", hid: false, n: "", nb: 0, nm: 0, tm: 0 }
    },
    items: {
      "it-t": { id: "it-t", m: 30, s: "sl-b", k: "text", ph: "title", z: 1, paras: [{ l: 0, ls: "", r: [{ t: "Revenue " }, { t: "up", b: true }] }] },
      "it-b": { id: "it-b", m: 30, s: "sl-b", k: "text", ph: "body", z: 2, paras: [{ l: 0, ls: "b", r: [{ t: "Exports grew" }] }] },
      "it-i": { id: "it-i", m: 30, s: "sl-b", k: "image", z: 3, img: { a: "0".repeat(64) + ".png", alt: "Bar chart" } },
      "it-d": { id: "it-d", m: 8, s: "sl-b", k: "text", z: 4, paras: [{ l: 0, ls: "", r: [{ t: "deleted box" }] }] },
      "it-f": { id: "it-f", m: 15, s: "sl-a", k: "text", z: 1, paras: [{ l: 0, ls: "", r: [{ t: "Welcome" }] }, { l: 0, ls: "", r: [{ t: "everyone" }] }] }
    },
    ghosts: { decks: { "dk-old": { id: "dk-old", m: 1, t: "Ghost deck", tm: 0 } },
              slides: { "sl-g": { id: "sl-g", m: 1, d: "dk-one", p: "z", n: "ghost notes", nm: 0, tm: 0 } } },
    tombs: { "it-d": 9, "sl-x": 10, "dk-old": 2 } } });
  const hits = P("slides").search(ctxFor(st, "x"));
  assert.deepEqual(ids(hits), ["dk-empty", "sl-a", "sl-b"]);
  const b = hits.find((h) => h.id === "sl-b");
  assert.equal(b.title, "Revenue up");
  assert.ok(b.text.includes("Exports grew") && b.text.includes("Bar chart") && b.text.includes("Mention the hires"));
  assert.ok(!b.text.includes("deleted box") && !b.text.includes("Quarterly review"));
  assert.deepEqual(b.target, { deck: "dk-one", slide: "sl-b" });
  assert.equal(b.when, 30);
  const a = hits.find((h) => h.id === "sl-a");
  assert.equal(a.title, "Welcome");
  assert.ok(a.text.includes("everyone") && a.text.includes("Quarterly review"));   // first slide carries the deck title
  const e = hits.find((h) => h.id === "dk-empty");
  assert.equal(e.title, "Untitled presentation");
  assert.deepEqual(e.target, { deck: "dk-empty" });
  const el = P("slides").search(ctxFor(store({ "oros-slides-data": { decks: { "dk-z": { id: "dk-z", m: 1, t: "Z", tm: 0 } },
    slides: { "sl-z": { id: "sl-z", m: 1, d: "dk-z", p: "a", n: "", nm: 0, tm: 0 } }, items: {}, tombs: {} } }), "x", "el"));
  assert.equal(el[0].title, "Διαφάνεια 1");
});

test("scores: one hit per match, players as text, deleted matches skipped", () => {
  const st = store({ "oros-scores-data": { ver: 1,
    matches: [
      { id: "mt0001", m: 50, c: 40, name: "Tavli Sunday", tpl: "tavli", seats: ["Giorgos", "Anna"], target: 5, low: 0, quick: [1, 2, 3], done: 60 },
      { id: "mt0002", m: 30, c: 30, name: "Prefa", tpl: "prefa", seats: ["A", "B", "C"], target: 0, low: 0, quick: [], done: 0 },
      { id: "mt0003", m: 10, c: 10, name: "Deleted match", tpl: "", seats: ["X", "Y"], target: 0, low: 0, quick: [], done: 0 }
    ],
    rounds: [{ id: "rd0001", m: 50, g: "mt0001", c: 41, s: [1, 0] }],
    tpls: [], players: [{ id: "pl0001", m: 1, name: "Giorgos", col: 0 }],
    tombs: { mt0003: 10 } } });
  const hits = P("scores").search(ctxFor(st, "x"));
  assert.deepEqual(ids(hits), ["mt0001", "mt0002"]);
  const a = hits.find((h) => h.id === "mt0001");
  assert.equal(a.title, "Tavli Sunday");
  assert.equal(a.text, "Giorgos · Anna");
  assert.equal(a.when, 60);
  assert.deepEqual(a.target, { match: "mt0001" });
  assert.equal(hits.find((h) => h.id === "mt0002").when, 30);
});

test("help: guide pages in the current language, best section, opens through orosHelp", async () => {
  const H = P("help");
  const files = {
    "topics.json": JSON.stringify({ version: 1, topics: [{ id: "sync" }, { id: "faq" }] }),
    "topics/sync.en.txt": "# Sync\n\nKeep devices in step.\n\n## Vault Drive\n\nConnect a **Vault** folder.\n\n## Conflicts\n\n- Newest edit wins\n- Nothing is lost",
    "topics/sync.el.txt": "# Συγχρονισμός\n\nΟι συσκευές σου μαζί.\n\n## Συγκρούσεις\n\nΚερδίζει η νεότερη αλλαγή.",
    "topics/faq.en.txt": "# Questions\n\n## Is it free?\n\nYes. Press [[Ctrl+Alt+Shift+F]] to search.",
    "../notes/help.en.txt": "# Notes\n\n## Notebooks\n\nGroup pages in notebooks."
  };
  const old = globalThis.fetch;
  globalThis.fetch = (url) => {
    const k = String(url).split("?")[0];
    return Promise.resolve(k in files ? { ok: true, status: 200, text: () => Promise.resolve(files[k]) }
                                      : { ok: false, status: 404, text: () => Promise.resolve("") });
  };
  try {
    const en = await H.search(ctxFor(store({}), "conflicts"));
    const sync = en.find((h) => h.id === "t/sync");
    assert.equal(sync.title, "Sync");
    assert.ok(sync.text.includes("Newest edit wins") && sync.text.includes("Connect a Vault folder."));
    assert.deepEqual(sync.target, { route: "t/sync/conflicts" });
    const faq = en.find((h) => h.id === "t/faq");
    assert.ok(faq.text.includes("Ctrl+Alt+Shift+F"));
    assert.deepEqual(faq.target, { route: "t/faq" });
    const notes = en.find((h) => h.id === "a/notes");
    assert.equal(notes.title, "Notes");
    assert.deepEqual(H.search(ctxFor(store({}), "notebooks")).find((h) => h.id === "a/notes").target,
                     { route: "a/notes/notebooks" });   // cached: answers at once
    const el = await H.search(ctxFor(store({}), "συγκρουσεις", "el"));
    assert.equal(el.find((h) => h.id === "t/sync").title, "Συγχρονισμός");
    assert.deepEqual(el.find((h) => h.id === "t/sync").target, { route: "t/sync/συγκρουσεισ" });
    assert.equal(el.find((h) => h.id === "t/faq").title, "Questions");   // no Greek page → English
  } finally {
    globalThis.fetch = old;
  }
  let opened = null;
  H.open({ route: "t/sync/conflicts" }, { orosHelp: { open: (r) => { opened = r; } } });
  assert.equal(opened, "t/sync/conflicts");
  H.open({ route: "javascript:alert(1)" }, { orosHelp: { open: (r) => { opened = r; } } });
  assert.equal(opened, "");
});

test("help: parsePage gives the same section ids as help.js", () => {
  const p = P("help").parsePage("# Title\n\nIntro\n\n## Same\n\ntext\n\n## Same\n\n### Ώρα & Ημέρα\n\n> tip line");
  assert.equal(p.title, "Title");
  assert.deepEqual(p.secs.map((s) => s.id), ["", "same", "same-2", "ωρα-ημερα"]);
  assert.equal(p.secs[3].text, "tip line");
});

test("create group: every provider file is read-only and loads in node", () => {
  IDS.forEach((id) => {
    const src = fs.readFileSync(path.join(__dirname, "..", id, "search.js"), "utf8");
    assert.ok(!/setItem|removeItem|registerSlice|innerHTML/.test(src), id);
    const prov = P(id);
    assert.equal(prov.id, id);
    assert.equal(typeof prov.search, "function");
  });
});
