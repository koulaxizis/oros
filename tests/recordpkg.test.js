// The record apps' shared kit (recordpkg.js): pack a state as a
// bundle through the real bundle.js, open it again as an ADD-ONLY
// merge (ids kept, nothing overwritten or deleted by default), the
// "Update with newer versions" mode, tombstones, future stamps,
// wrong kinds and hostile shapes.
// Run: node --test tests/*.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const B = require(path.join(ROOT, "bundle.js"));
const K = require(path.join(ROOT, "recordpkg.js"));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const NOW = 1800000000000;
const clone = (x) => JSON.parse(JSON.stringify(x));

// A To-Do-like app: lists that hold items, labels, tombstones in
// `deleted`, a device-only field `view`.
const DESC = {
  app: "demo", title: "Demo", slice: "demo", ext: ".orosdemo", mime: "application/x-oros-demo",
  colls: {
    labels: { shape: "array", id: "id", stamp: "m" },
    lists: { shape: "array", id: "id", stamp: "m" },
    "lists.items": { shape: "array", id: "id", stamp: "m", clampIn: ["fm"] },
    "notes.byDay": { shape: "map", stamp: "m" }
  },
  norm(d) {
    if (!d || typeof d !== "object") return null;
    d.lists = Array.isArray(d.lists) ? d.lists : [];
    d.lists.forEach((l) => { if (!Array.isArray(l.items)) l.items = []; });
    if (!Array.isArray(d.labels)) d.labels = [];
    return d;
  },
  strip(s) {
    const o = clone(s || {});
    delete o.deleted; delete o.view;
    return o;
  },
  tombIds(s) { return new Set(Object.keys((s && s.deleted) || {})); },
  previews(s, lang) {
    return { "list.md": (lang === "el" ? "# Λίστες\n" : "# Lists\n") + s.lists.map((l) => "- " + l.name).join("\n") };
  }
};

function state() {
  return {
    view: { tab: "x" },
    deleted: { gone1: NOW - 5000 },
    labels: [{ id: "lb1", name: "home", m: NOW - 9000 }],
    lists: [
      { id: "L1", name: "General", m: NOW - 8000, items: [
        { id: "t1", text: "milk", m: NOW - 7000, fm: { text: NOW - 7000 } },
        { id: "t2", text: "bread", m: NOW - 6000 }
      ] },
      { id: "L2", name: "Work", m: NOW - 8000, items: [{ id: "t3", text: "mail", m: NOW - 6000 }] }
    ],
    notes: { byDay: { "2026-10-01": { text: "a", m: NOW - 4000 }, "2026-10-02": 7 } }
  };
}

async function roundTrip(desc, st, opts) {
  const o = K.pack(desc, st, Object.assign({ title: "My things", lang: "en", now: NOW }, opts || {}));
  const bytes = await B.write(o);
  assert.equal(B.sniff(bytes.subarray(0, 128)), desc.mime);
  return B.read(bytes, { mime: desc.mime });
}

test("pack: content.json shape, stripped, meta, generator, previews and media", async () => {
  const st = state();
  const o = K.pack(DESC, st, { title: "My things", lang: "el", now: NOW,
    files: [{ key: "a".repeat(64) + ".png", bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), type: "image/png" }] });
  assert.equal(o.mime, "application/x-oros-demo");
  assert.equal(o.app, "demo");
  assert.equal(o.generator, "orOS Demo");
  assert.equal(o.content.kind, "oros-demo-package");
  assert.equal(o.content.ver, 1);
  assert.equal(o.content.data.deleted, undefined);
  assert.equal(o.content.data.view, undefined);
  assert.deepEqual(st.view, { tab: "x" });                       // the app's state is never touched
  assert.equal(o.meta.title, "My things");
  assert.equal(o.meta.language, "el");
  assert.equal(o.meta.created, NOW - 9000);
  assert.equal(o.meta.modified, NOW - 4000);
  assert.deepEqual(o.preview.map((p) => p.name), ["list.md"]);
  assert.match(o.preview[0].data, /^# Λίστες/);
  const r = await B.read(await B.write(o), { mime: DESC.mime });
  assert.equal(r.meta.generator, "orOS Demo");
  assert.equal(r.meta.title, "My things");
  assert.ok(r.media["a".repeat(64) + ".png"] || Object.keys(r.media).length === 1);
  assert.deepEqual(r.content.data, DESC.strip(st));
});

test("round trip into an empty device adds every record with its id", async () => {
  const r = await roundTrip(DESC, state());
  const res = K.open(DESC, { labels: [], lists: [], deleted: {} }, r.content, { now: NOW });
  assert.deepEqual(res.report, { added: 8, skipped: 0, updated: 0 });
  assert.deepEqual(res.next.lists.map((l) => l.id), ["L1", "L2"]);
  assert.deepEqual(res.next.lists[0].items.map((i) => i.id), ["t1", "t2"]);
  assert.deepEqual(res.next.notes.byDay, state().notes.byDay);
  assert.deepEqual(res.next.deleted, {});
  assert.deepEqual(res.addedIds.slice().sort(), ["2026-10-01", "2026-10-02", "L1", "L2", "lb1", "t1", "t2", "t3"]);
  // the whole bundle result works too, not only content.json; and a
  // device with nothing yet takes the file as it is (without view/deleted)
  const fresh = K.open(DESC, null, r, { now: NOW });
  assert.equal(fresh.report.added, 8);
  assert.deepEqual(fresh.next, DESC.strip(state()));
});

test("reopening the same file adds nothing and changes nothing", async () => {
  const st = state();
  const r = await roundTrip(DESC, st);
  const res = K.open(DESC, st, r.content, { now: NOW });
  assert.deepEqual(res.report, { added: 0, skipped: 8, updated: 0 });
  assert.deepEqual(res.addedIds, []);
  assert.deepEqual(res.next, st);
  const again = K.open(DESC, res.next, r.content, { update: true, now: NOW });
  assert.equal(again.report.added + again.report.updated, 0);
  assert.deepEqual(again.next, st);
});

test("a clash keeps the local record; a new child of a kept parent is added under it", async () => {
  const theirs = state();
  theirs.lists[0].name = "Renamed elsewhere";
  theirs.lists[0].m = NOW - 10;                                  // newer, but no update asked
  theirs.lists[0].items[0].text = "oat milk";
  theirs.lists[0].items[0].m = NOW - 10;
  theirs.lists[0].items.push({ id: "t9", text: "eggs", m: NOW - 10 });
  theirs.lists.push({ id: "L3", name: "Trip", m: NOW - 10, items: [{ id: "t2", text: "dup id", m: NOW }, { id: "t10", text: "map", m: NOW - 10 }] });
  const r = await roundTrip(DESC, theirs);
  const mine = state();
  const res = K.open(DESC, mine, r.content, { now: NOW });
  assert.deepEqual(res.report, { added: 3, skipped: 8, updated: 0 });
  assert.deepEqual(res.addedIds.sort(), ["L3", "t10", "t9"]);
  const L1 = res.next.lists[0];
  assert.equal(L1.name, "General");
  assert.equal(L1.items[0].text, "milk");
  assert.deepEqual(L1.items.map((i) => i.id), ["t1", "t2", "t9"]);
  const L3 = res.next.lists[2];
  assert.equal(L3.id, "L3");
  assert.deepEqual(L3.items.map((i) => i.id), ["t10"]);           // t2 lives in L1 here: not twice
  assert.equal(res.next.lists[0].items[1].text, "bread");
  assert.deepEqual(res.next.view, { tab: "x" });                   // device fields stay
});

test("update mode applies only records whose stamp is newer", async () => {
  const theirs = state();
  theirs.lists[0].name = "Newer name"; theirs.lists[0].m = NOW - 100;
  theirs.lists[0].items[1].text = "older bread"; theirs.lists[0].items[1].m = NOW - 999999;
  theirs.labels[0].name = "same stamp"; // stamp unchanged: not newer
  const r = await roundTrip(DESC, theirs);
  const mine = state();
  const res = K.open(DESC, mine, r.content, { update: true, now: NOW });
  assert.deepEqual(res.report, { added: 0, skipped: 7, updated: 1 });
  assert.deepEqual(res.updatedIds, ["L1"]);
  assert.equal(res.next.lists[0].name, "Newer name");
  assert.deepEqual(res.next.lists[0].items.map((i) => i.text), ["milk", "bread"]);   // children kept
  assert.equal(res.next.labels[0].name, "home");
  // without update the same file changes nothing
  assert.deepEqual(K.open(DESC, mine, r.content, { now: NOW }).next, mine);
});

test("tombstones: the file's are ignored, never delete; a record deleted here stays deleted", async () => {
  const theirs = state();
  theirs.deleted = { t1: NOW, L2: NOW, lb1: NOW };                // the other device deleted these
  theirs.lists[0].items.push({ id: "gone1", text: "deleted here", m: NOW - 1 });
  theirs.lists[0].items.push({ id: "fresh", text: "new", m: NOW - 1 });
  // a file someone wrote by hand: tombstones in content.json itself
  const o = K.pack(DESC, theirs, { now: NOW });
  o.content.data.deleted = { t1: NOW, fresh: NOW + 1 };
  const r = await B.read(await B.write(o), { mime: DESC.mime });
  const mine = state();
  const res = K.open(DESC, mine, r.content, { update: true, now: NOW });
  assert.deepEqual(res.addedIds, ["fresh"]);                      // strip dropped the file's deleted{} first
  assert.ok(res.next.lists[0].items.some((i) => i.id === "t1"));
  assert.ok(res.next.lists.some((l) => l.id === "L2"));
  assert.ok(!res.next.lists[0].items.some((i) => i.id === "gone1"));
  assert.deepEqual(res.next.deleted, mine.deleted);
  // an app whose strip keeps them: tombIds(incoming) still drops them
  const keep = Object.assign({}, DESC, { strip: (s) => clone(s) });
  const r2 = K.open(keep, mine, o.content, { now: NOW });
  assert.ok(!r2.addedIds.includes("fresh"));
  // even a tombstoned id the file holds as newer is never revived in update mode
  const tomb = state();
  tomb.deleted.t1 = NOW - 1;
  tomb.lists[0].items = tomb.lists[0].items.filter((i) => i.id !== "t1");
  const t2 = state(); t2.lists[0].items[0].m = NOW;
  const r3 = K.open(DESC, tomb, K.pack(DESC, t2, { now: NOW }).content, { update: true, now: NOW });
  assert.ok(!r3.next.lists[0].items.some((i) => i.id === "t1"));
});

test("a future stamp is clamped to now + 5 minutes (record and its field stamps)", () => {
  const theirs = state();
  theirs.lists[0].items.push({ id: "tf", text: "future", m: NOW + 1e12, fm: { text: NOW + 1e12, done: 5 } });
  theirs.lists[0].items[0].m = NOW + 1e12;                        // a clash from the future
  const c = K.pack(DESC, theirs, { now: NOW }).content;
  const res = K.open(DESC, state(), c, { update: true, now: NOW });
  const tf = res.next.lists[0].items.find((i) => i.id === "tf");
  assert.equal(tf.m, NOW + K.FUTURE);
  assert.deepEqual(tf.fm, { text: NOW + K.FUTURE, done: 5 });
  const t1 = res.next.lists[0].items.find((i) => i.id === "t1");
  assert.equal(t1.m, NOW + K.FUTURE);                             // newer, so updated, but clamped
  assert.equal(K.clampStamp(NOW + 1, NOW), NOW + 1);
  assert.equal(K.clampStamp("x", NOW), "x");
});

test("the wrong kind, a newer version and junk are refused", async () => {
  const other = Object.assign({}, DESC, { app: "other" });
  const c = K.pack(DESC, state(), { now: NOW }).content;
  assert.throws(() => K.open(other, null, c), { code: "notpackage" });
  assert.throws(() => K.open(DESC, null, null), { code: "notpackage" });
  assert.throws(() => K.open(DESC, null, "x"), { code: "notpackage" });
  assert.throws(() => K.open(DESC, null, { kind: "oros-demo-package", ver: 1, data: 5 }), { code: "notpackage" });
  assert.throws(() => K.open(DESC, null, { kind: "oros-demo-package", ver: 2, data: {} }), { code: "newer" });
  assert.throws(() => K.open(Object.assign({}, DESC, { norm: () => null }), null, c), { code: "notpackage" });
  // a bundle of another type never gets that far: bundle.js refuses it
  const o = K.pack(DESC, state(), { now: NOW });
  o.mime = "application/x-oros-other";
  await assert.rejects(B.read(await B.write(o), { mime: DESC.mime }), { code: "wrongtype" });
});

test("hostile shapes are cut down, never thrown at the app", () => {
  const plain = Object.assign({}, DESC, { norm: undefined });
  const data = {
    labels: "not a list",
    lists: [
      null, 5, "x", [], { name: "no id" }, { id: "", items: [] }, { id: "x".repeat(300), items: [] },
      { id: "__proto__", items: [] },
      { id: "ok", m: "soon", items: { not: "an array" } },
      { id: "ok", m: 1, items: [] },                                    // duplicate: first wins
      { id: 42, name: "number id", items: [null, { id: "i1", m: 1 }, { id: { x: 1 } }] }
    ],
    notes: { byDay: { "__proto__": { m: 1 }, "2026-01-01": { m: 1, deep: { a: [1, 2] } } } }
  };
  const res = K.open(plain, { lists: [], labels: [] }, { kind: "oros-demo-package", ver: 1, data }, { now: NOW });
  assert.deepEqual(res.next.lists.map((l) => l.id), ["ok", 42]);
  assert.equal(res.next.lists[0].m, "soon");                        // the app's normaliser decides values
  assert.deepEqual(res.next.lists[1].items.map((i) => i.id), ["i1"]);
  assert.deepEqual(Object.keys(res.next.notes.byDay), ["2026-01-01"]);
  assert.equal(Object.getPrototypeOf(res.next.notes.byDay), Object.prototype);
  assert.equal(({}).polluted, undefined);
  assert.deepEqual(res.report, { added: 4, skipped: 0, updated: 0 });
  // a huge file stops at MAX_RECORDS
  const many = { lists: [{ id: "big", items: [] }] };
  for (let i = 0; i < K.MAX_RECORDS + 50; i++) many.lists[0].items.push({ id: "i" + i });
  const big = K.open(plain, null, { kind: "oros-demo-package", ver: 1, data: many }, { now: NOW });
  assert.equal(big.report.added, K.MAX_RECORDS);
});

test("an app merge function gets this device's root fields plus the filtered records", () => {
  let seen = null;
  const merged = Object.assign({}, DESC, {
    merge(local, remote) {
      seen = { local: clone(local), remote: clone(remote) };
      const out = clone(local);
      remote.lists.forEach((rl) => {
        const l = out.lists.find((x) => x.id === rl.id);
        if (!l) { out.lists.push(rl); return; }
        rl.items.forEach((it) => { if (!l.items.some((x) => x.id === it.id)) l.items.push(it); });
      });
      return out;
    }
  });
  const theirs = state();
  theirs.lists[0].name = "theirs";
  theirs.lists[0].items.push({ id: "t9", text: "eggs", m: NOW - 1 });
  theirs.view = { tab: "theirs" };
  const mine = state();
  const res = K.open(merged, mine, K.pack(DESC, theirs, { now: NOW }).content, { now: NOW });
  assert.deepEqual(seen.remote.view, { tab: "x" });                  // this device's
  assert.deepEqual(seen.remote.deleted, mine.deleted);
  assert.equal(seen.remote.lists.length, 1);                         // only the carrier of t9
  assert.equal(seen.remote.lists[0].name, "General");                // with the local fields
  assert.deepEqual(seen.remote.lists[0].items.map((i) => i.id), ["t9"]);
  assert.deepEqual(res.next.lists[0].items.map((i) => i.id), ["t1", "t2", "t9"]);
  assert.deepEqual(res.addedIds, ["t9"]);
});

test("strings: every key in both languages; wiring in sw.js, the spec and the Bible", () => {
  assert.deepEqual(Object.keys(K.STRINGS.en).sort(), Object.keys(K.STRINGS.el).sort());
  assert.equal(K.str("el", "done", { n: 2, name: "a" }), "Προστέθηκαν 2 από το «a»");
  assert.equal(K.kindOf("todo"), "oros-todo-package");
  assert.equal(K.fileTitle("a/b:c"), "a b c");
  assert.match(read("sw.js"), /"recordpkg\.js"/);
  assert.match(read("docs/oros-bundle.md"), /## Record apps/);
  assert.match(read("OROS_BIBLE.md"), /OBF-4e · Record apps \(phase 4b\)/);
});
