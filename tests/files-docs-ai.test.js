// DOCS-1 wave 5: what the universal search, and so the Assistant and
// orOS Gate, see of Documents (Chris 2026-11-15, card 3: details and a
// short text snippet; private documents never).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const D = require("../files/docs-due.js");
const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

const slice = (docs, extra) => Object.assign({ v: 1, docs: docs, types: [], tags: [], corr: [], tombs: {} }, extra || {});
const doc = (id, o) => Object.assign({ id: id, m: 10, p: "/internal/Documents/2026/" + id + ".pdf", t: "Doc " + id, tg: [], ln: [] }, o);

test("a hit per document: details, then the first 300 characters of the text", () => {
  const raw = slice([doc("d-a", { t: "Car insurance", ty: "ty-insurance", d: "2026-03-01", co: "co-x", tg: ["tg-car", "tg-gone"],
    amt: 412.5, cur: "EUR", ex: "2027-03-01", kp: "forever", no: "Paid by card", x: { tx: { at: 5, src: "pdf", n: 900 } } })],
  { corr: [{ id: "co-x", m: 1, n: "Allianz" }], tags: [{ id: "tg-car", m: 1, n: { en: "car", el: "αυτοκίνητο" } }, { id: "tg-gone", m: 1, n: "old" }],
    tombs: { "tg-gone": 2 } });
  const long = "Policy   number 123\n" + "x".repeat(600);
  const [h] = D.searchHits(raw, "en", (id) => (id === "d-a" ? long : ""));
  assert.strictEqual(h.id, "doc:d-a");
  assert.strictEqual(h.title, "Car insurance");
  assert.deepStrictEqual(h.target, { doc: "d-a" });
  assert.strictEqual(h.when, Date.UTC(2026, 2, 1));
  const lines = h.text.split("\n");
  assert.deepStrictEqual(lines.slice(0, 6), [
    "Document · Insurance · 2026-03-01",
    "From: Allianz",
    "Tags: car",
    "Amount: 412.5 EUR",
    "Expires: 2027-03-01 · Keep until: for ever",
    "File: /Documents/2026/d-a.pdf"
  ]);
  assert.strictEqual(lines[6], "Note: Paid by card");
  const tx = lines[7].slice("Text: ".length);
  assert.ok(lines[7].startsWith("Text: Policy number 123 x"), "whitespace squashed");
  assert.strictEqual(tx.length, D.SNIPPET, "never more than 300 characters of the text");
  assert.ok(tx.endsWith("…"));
  const el = D.searchHits(raw, "el", () => "")[0].text;
  assert.match(el, /^Έγγραφο · Ασφάλιση · 2026-03-01\nΑπό: Allianz\nΕτικέτες: αυτοκίνητο/);
  assert.match(D.searchHits(raw, "de", () => "")[0].text, /^Dokument · Versicherung/);
});

test("private documents are left out whole; tombstoned ones too", () => {
  const raw = slice([
    doc("d-ok", { t: "Lease" }),
    doc("d-med", { t: "Blood test Maria", ty: "ty-medical" }),
    doc("d-id", { t: "Passport Maria", ty: "ty-id" }),
    doc("d-own", { t: "Secret thing", ty: "ty-own" }),
    doc("d-hl", { t: "Clinic bill", ln: [{ a: "health", r: { appt: "a1" }, t: "" }] }),
    doc("d-cy", { t: "Cycle note", ln: [{ a: "cycle", r: "x", t: "" }] }),
    doc("d-dead", { t: "Gone" })
  ], { types: [{ id: "ty-own", m: 1, n: "Mine", pv: true }], tombs: { "d-dead": 20 } });
  let asked = [];
  const hits = D.searchHits(raw, "en", (id) => { asked.push(id); return "secret text"; });
  assert.deepStrictEqual(hits.map((h) => h.id), ["doc:d-ok"]);
  assert.deepStrictEqual(asked, ["d-ok"], "a private document's text is never even asked for");
  assert.ok(!/Maria|Secret|Clinic|Cycle/.test(JSON.stringify(hits)));
  // a built-in private type an owner made not private shows
  const open = slice([doc("d-id", { t: "Passport", ty: "ty-id" })], { types: [{ id: "ty-id", m: 2, n: "Pass", pv: false }] });
  assert.deepStrictEqual(D.searchHits(open, "en").map((h) => h.text.split("\n")[0]), ["Document · Pass"]);
  assert.deepStrictEqual(D.searchHits(null, "en"), []);
});

function provider(disk, raw, tagsRaw) {
  delete require.cache[require.resolve("../files/search.js")];
  global.OrosDocsDue = D;
  global.orosFS = disk;
  const P = require("../files/search.js");
  const ctx = (q, lang) => ({ q: q, words: q ? q.split(" ") : [], code: lang || "en", lang: lang || "en", readJSON: (k) => (k === D.KEY ? raw : k === "oros-files-tags" ? tagsRaw : null) });
  return { P, ctx };
}
const tick = () => new Promise((r) => setTimeout(r, 20));

test("Files search provider: documents first, texts read in the background, never private ones", async () => {
  const raw = slice([
    doc("d-a", { t: "Lease", x: { tx: { at: 1, src: "pdf", n: 10 } } }),
    doc("d-m", { t: "Lab", ty: "ty-medical", x: { tx: { at: 1, src: "pdf", n: 10 } } })
  ]);
  const reads = [];
  const disk = {
    ls: async (p) => (p === "/internal" ? [{ name: "Documents", dir: true }, { name: ".docs", dir: true }] : p === "/internal/Documents" ? [{ name: "lease.pdf" }] : []),
    readText: async (p) => { reads.push(p); return "Rent 900 EUR a month"; }
  };
  const { P, ctx } = provider(disk, raw);
  assert.deepStrictEqual(P.keys, ["oros-files-docs", "oros-files-tags", "oros-files-captions"]);
  let hits = await P.search(ctx("lease"));
  assert.deepStrictEqual(hits.map((h) => h.id), ["doc:d-a", "/internal/Documents", "/internal/Documents/lease.pdf"]);
  await tick();
  assert.deepStrictEqual(reads, ["/internal/.docs/text/d-a.txt"], "only the document that is not private");
  hits = await P.search(ctx("rent"));
  assert.match(hits[0].text, /\nText: Rent 900 EUR a month$/);
  await tick();
  assert.strictEqual(reads.length, 1, "kept until the text changes");
  // all items, no words: the documents only, at once (Gate's closed copy)
  const all = P.search(ctx(""));
  assert.ok(Array.isArray(all));
  assert.deepStrictEqual(all.map((h) => h.id), ["doc:d-a"]);
  // a new text is read again
  raw.docs[0].x.tx.at = 2;
  P.search(ctx("x"));
  await tick();
  assert.strictEqual(reads.length, 2);
  delete global.OrosDocsDue; delete global.orosFS;
});

test("a slow disk walk does not hold the documents back", async () => {
  const raw = slice([doc("d-a", { t: "Lease" })]);
  const disk = { ls: () => new Promise(() => {}), readText: async () => "" };
  const { P, ctx } = provider(disk, raw);
  const t0 = Date.now();
  const hits = await P.search(ctx("lease"));
  assert.ok(Date.now() - t0 < 1000);
  assert.deepStrictEqual(hits.map((h) => h.id), ["doc:d-a"]);
  delete global.OrosDocsDue; delete global.orosFS;
});

test("parity: the Assistant and orOS Gate say the same about Documents", () => {
  const core = read("assistant/core.js"), gate = read("gate/gate.js");
  const m = /var DOCS_NOTE = "([^"]+)";/.exec(gate);
  assert.ok(m, "Gate's list_apps note");
  assert.ok(core.includes(m[1]), "word for word in the Assistant's search_data");
  assert.match(gate, /if \(a\.id === "files"\) o\.documents = DOCS_NOTE;/);
});

// TAGS-1 wave T3 (Chris 2026-11-17 «Ναι, μόνο τα ονόματα»): tag names on
// disk hits; never for a private document's file.
test("fileTags: names of live tags at each row's path, a document's own tags, nothing for private ones", () => {
  const raw = slice([
    doc("d-a", { t: "Lease", tg: ["tg-home"] }),
    doc("d-m", { t: "Lab", ty: "ty-medical", tg: ["tg-home"] })
  ], { tags: [{ id: "tg-home", m: 1, n: { en: "home", el: "σπίτι" } }, { id: "tg-work", m: 1, n: "work" }, { id: "tg-gone", m: 1, n: "old" }],
    tombs: { "tg-gone": 5 } });
  const tagsRaw = { v: 1, files: [
    { k: "p:/internal/notes.txt", p: "/internal/notes.txt", m: 1, t: { "tg-work": 3, "tg-home": -4, "tg-gone": 2 } },
    { k: "h:" + "a".repeat(64), p: "/internal/Documents/2026/d-m.pdf", m: 1, t: { "tg-work": 3 } },
    { k: "p:/internal/.trash/x/a.txt", p: "/internal/.trash/x/a.txt", m: 1, t: { "tg-work": 3 } },
    { k: "p:/internal/.docs/text/d-a.txt", p: "/internal/.docs/text/d-a.txt", m: 1, t: { "tg-work": 3 } }
  ], smart: [], tombs: {} };
  assert.deepStrictEqual(D.fileTags(tagsRaw, raw, "en"), {
    "/internal/Documents/2026/d-a.pdf": ["home"],
    "/internal/notes.txt": ["work"]
  });
  assert.deepStrictEqual(D.fileTags(tagsRaw, raw, "el")["/internal/Documents/2026/d-a.pdf"], ["σπίτι"]);
  assert.deepStrictEqual(D.fileTags(null, null, "en"), {});
  assert.deepStrictEqual(D.fileTags({ files: "x" }, { tags: "y" }, "en"), {});
  assert.strictEqual(D.tagsWord("de"), "Schlagwörter");
});

test("Files search provider: a tag name finds its files; the Assistant and Gate get the same hits", async () => {
  const raw = slice([doc("d-m", { t: "Lab", ty: "ty-medical", p: "/internal/lab.pdf", tg: ["tg-w"] })],
    { tags: [{ id: "tg-w", m: 1, n: "Work" }] });
  const tagsRaw = { v: 1, files: [
    { k: "p:/internal/plan.txt", p: "/internal/plan.txt", m: 1, t: { "tg-w": 2 } },
    { k: "p:/internal/lab.pdf", p: "/internal/lab.pdf", m: 1, t: { "tg-w": 2 } }
  ], smart: [], tombs: {} };
  const disk = { ls: async (p) => (p === "/internal" ? [{ name: "plan.txt" }, { name: "lab.pdf" }, { name: "other.txt" }] : []), readText: async () => "" };
  const { P, ctx } = provider(disk, raw, tagsRaw);
  const hits = await P.search(ctx("work"));
  const by = Object.fromEntries(hits.map((h) => [h.id, h.text]));
  assert.strictEqual(by["/internal/plan.txt"], "/\nTags: Work");
  assert.strictEqual(by["/internal/lab.pdf"], "/", "a private document's file shows no tags");
  assert.strictEqual(by["/internal/other.txt"], "/");
  assert.ok(!hits.some((h) => h.id === "doc:d-m"));
  const el = await P.search(ctx("work", "el"));
  assert.strictEqual(el.find((h) => h.id === "/internal/plan.txt").text, "/\nΕτικέτες: Work");
  // one provider, one sentence: both search through orosAssistSearch
  assert.match(read("gate/gate.js"), /also show their tag names/);
  delete global.OrosDocsDue; delete global.orosFS;
});
