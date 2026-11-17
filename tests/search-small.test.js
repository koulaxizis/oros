// Universal search for Household, Label Maker and Ringtone Composer
// (gap review proposal 11, 2026-11-17; Transfer's provider is AS-SUM8). Plain node, no DOM:
// providers read through ctx.readJSON over an in-memory storage, in
// the real stored shape of each app; Household asks a fake engine.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const S = require(path.join(ROOT, "search.js"));
const P = (id) => require(path.join(ROOT, id, "search.js"));
const IDS = ["household", "labels", "ringtones"];   // Transfer: AS-SUM8 (#1095)

function store(obj) {
  const m = new Map(Object.entries(obj).map(([k, v]) => [k, JSON.stringify(v)]));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m };
}
async function find(id, storage, q, lang) {
  const g = await S.run([P(id)], q, { readJSON: S.makeReader(storage), lang: lang || "en", timeoutMs: 2000 });
  return g.length ? g[0].hits : [];
}
const ids = (hits) => hits.map((h) => h.id).sort();

test("apps.json declares the four providers and each file exists", () => {
  const apps = JSON.parse(fs.readFileSync(path.join(ROOT, "apps.json"), "utf8")).apps;
  IDS.forEach((id) => {
    const a = apps.find((x) => x.id === id);
    assert.equal(a.search, "search.js", id);
    assert.ok(fs.existsSync(path.join(ROOT, id, "search.js")), id);
    assert.equal(P(id).id, id);
  });
});

test("the providers are read-only and never draw HTML", () => {
  IDS.forEach((id) => {
    const src = fs.readFileSync(path.join(ROOT, id, "search.js"), "utf8");
    assert.ok(!/setItem|removeItem|registerSlice|innerHTML|fetch\(/.test(src), id);
  });
});

// ---------- Label Maker ----------
test("labels: one hit per saved label, tombstones and junk left out, { label } target", async () => {
  const st = store({ "oros-labels-data": { ver: 1, labels: [
    { id: "lspice001", m: 2000, text: "PAPRIKA", tape: "red", width: 12, cut: "square", margin: 1 },
    { id: "lspice002", m: 1000, text: "CUMIN", tape: "red", width: 12, cut: "square", margin: 1 },
    { id: "lgone0001", m: 500, text: "PAPRIKA OLD" },
    { id: "BAD", m: 1, text: "PAPRIKA BAD" },
    { id: "lempty001", m: 1, text: "   " }
  ], tombs: { lgone0001: 600 } } });
  const hits = await find("labels", st, "paprika");
  assert.deepEqual(ids(hits), ["lspice001"]);
  assert.equal(hits[0].title, "PAPRIKA");
  assert.equal(hits[0].when, 2000);
  assert.deepEqual(hits[0].target, { label: "lspice001" });
  assert.deepEqual(await find("labels", store({}), "x"), []);
});

test("labels app takes { label } and opens the saved label", () => {
  const src = fs.readFileSync(path.join(ROOT, "labels", "labels.js"), "utf8");
  assert.match(src, /typeof target\.label === "string"[\s\S]{0,200}C\.findLabel\(data, target\.label\)[\s\S]{0,120}openLabel\(l\)/);
});

// ---------- Ringtone Composer ----------
test("ringtones: melodies by name, untitled ones under the placeholder (en/el), { melody } target", async () => {
  const st = store({ "oros-ringtones-data": { ver: 1, melodies: [
    { id: "rbirthday1", m: 3000, name: "Birthday for Maria", bpm: 120, voice: "beep", notes: "4c5,4c5,2d5" },
    { id: "rnoname001", m: 2000, name: "", bpm: 120, voice: "beep", notes: "4e5" },
    { id: "rgone00001", m: 100, name: "Birthday old", notes: "4c5" },
    { id: "rnonotes01", m: 100, name: "Birthday silent", notes: "" }
  ], tombs: { rgone00001: 200 } } });
  const b = await find("ringtones", st, "birthday");
  assert.deepEqual(ids(b), ["rbirthday1"]);
  assert.deepEqual(b[0].target, { melody: "rbirthday1" });
  assert.equal(b[0].when, 3000);
  assert.deepEqual(ids(await find("ringtones", st, "untitled")), ["rnoname001"]);
  assert.deepEqual(ids(await find("ringtones", st, "χωρίς όνομα", "el")), ["rnoname001"]);
});

test("ringtones app takes { melody } and opens the saved melody", () => {
  const src = fs.readFileSync(path.join(ROOT, "ringtones", "ringtones.js"), "utf8");
  assert.match(src, /typeof tg\.melody === "string"[\s\S]{0,200}C\.findMelody\(data, tg\.melody\)[\s\S]{0,120}openMelody\(x\)/);
});

// ---------- Household ----------
const BOX = "AbCdEfGhIjKlMnOpQrStUv";   // 22 characters, as core.js BOX_RE
const BOX2 = "ZyXwVuTsRqPoNmLkJiHgFe";
test("household: names, members and shared titles from the engine; never invites or links", async () => {
  globalThis.orosHousehold = {
    ready: () => Promise.resolve(),
    list: () => [
      { box: BOX, name: "Our flat", members: [{ name: "Maria" }, { name: "Nikos" }],
        docs: [{ title: "Shopping", kind: "todo" }],
        invites: [{ link: "https://useoros.online/share/#secretcode", ih: "x" }] },
      { box: "bad", name: "Broken" }
    ]
  };
  try {
    const h = await find("household", store({}), "nikos");
    assert.deepEqual(ids(h), [BOX]);
    assert.equal(h[0].title, "Our flat");
    assert.equal(h[0].text, "Maria · Nikos · Shopping");
    assert.deepEqual(h[0].target, { box: BOX });
    assert.deepEqual(ids(await find("household", store({}), "shopping")), [BOX]);
    assert.deepEqual(await find("household", store({}), "secretcode"), []);
    assert.deepEqual(await find("household", store({}), "broken"), []);
  } finally { delete globalThis.orosHousehold; }
});

test("household: without the engine, names from the membership slice only (never keys)", async () => {
  const st = store({ "oros-household-data": { hh: {
    [BOX]: { name: "Our flat", mid: "m1", keys: { 1: "SECRETKEY" }, epoch: 1 },
    [BOX2]: { name: "", keys: {} }
  } } });
  const h = await find("household", st, "flat");
  assert.deepEqual(ids(h), [BOX]);
  assert.equal(h[0].text, "");
  assert.deepEqual(await find("household", st, "secretkey"), []);
});

test("household app already takes { box }", () => {
  const src = fs.readFileSync(path.join(ROOT, "household", "app.js"), "utf8");
  assert.match(src, /typeof target\.box === "string"/);
});

// ---------- Pixel → Wallpaper (proposal 11, first half) ----------
// Pixel's own "Use as wallpaper" (orosWallpaper.setImage) and its
// "Send to…", which hands a PNG under /internal/Pictures to the sheet:
// BR-SEND-12's Wallpaper receiver takes it.
test("pixel: Use as wallpaper and Send to… a PNG that the Wallpaper receiver takes", () => {
  const src = fs.readFileSync(path.join(ROOT, "pixel", "pixel.js"), "utf8");
  assert.match(src, /\$\("wall-btn"\)\.hidden = !wallApi\(\)/);
  assert.match(src, /var opts = \{ kind: "files", data: \{ items: \[it\] \} \}/);
  assert.match(src, /var PICTURES = "\/internal\/Pictures"/);
  const core = require(path.join(ROOT, "send", "core.js"));
  const png = { items: [{ path: "/internal/Pictures/face.png", name: "face.png" }] };
  assert.ok(core.appsFor("files", png, ["mail", "transfer", "wallpaper", "photolab"], "pixel").includes("wallpaper"));
  assert.ok(core.target("wallpaper", "files", png));
});
