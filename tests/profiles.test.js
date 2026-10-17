// First-run profiles (profiles.js): the profile lists stay valid and
// picking never hides anything by default; the launcher's menuPreset
// (mtime 1) always loses to a real choice made on any device.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const P = require(path.join(__dirname, "..", "profiles.js"));
const L = require(path.join(__dirname, "..", "launcher.js"));
const apps = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "apps.json"), "utf8"));
const IDS = (Array.isArray(apps) ? apps : apps.apps).filter((a) => a.type === "internal").map((a) => a.id);

test("every profile id is a real app, no duplicates, sensible size", () => {
  const known = new Set(IDS);
  for (const id of P.BASE) assert.ok(known.has(id), "BASE: " + id);
  assert.deepEqual([...P.ORDER].sort(), Object.keys(P.PROFILES).sort());
  for (const k of P.ORDER) {
    const list = P.PROFILES[k];
    assert.equal(new Set(list).size, list.length, k + " has duplicates");
    for (const id of list) assert.ok(known.has(id), k + ": " + id);
    const shown = P.pick([k], IDS).length;
    assert.ok(shown >= 20 && shown <= IDS.length - 20, k + " shows " + shown);
  }
});

test("pick: no profile = everything, in app order; profiles unite", () => {
  assert.deepEqual(P.pick([], IDS), IDS);
  assert.deepEqual(P.pick(null, IDS), IDS);
  assert.deepEqual(P.pick(["nope"], IDS), IDS);
  const home = P.pick(["home"], IDS), work = P.pick(["work"], IDS);
  const both = P.pick(["home", "work"], IDS);
  assert.deepEqual(both, IDS.filter((id) => home.includes(id) || work.includes(id)));
  for (const id of P.BASE) assert.ok(home.includes(id));
  assert.ok(!home.includes("chess"));
  assert.deepEqual(P.pick(["home"], ["zz-not-there", "notes"]), ["notes"]);
});

test("hiddenOf: the complement, in app order", () => {
  assert.deepEqual(P.hiddenOf(IDS, IDS), []);
  assert.deepEqual(P.hiddenOf(["b"], ["a", "b", "c"]), ["a", "c"]);
  assert.deepEqual(P.hiddenOf(null, ["a"]), ["a"]);
});

test("menuPreset: hides only apps without an item, with mtime 1", () => {
  // notes: hidden then shown again on purpose (a real item, mtime 500).
  let d = L.menuSetHidden(L.menuSetHidden(null, ["notes"], true, 400), ["notes"], false, 500);
  d = L.menuPreset(d, ["notes", "chess", "Bad Id"]);
  assert.deepEqual(d.apps, [
    { id: "chess", hidden: true, mtime: 1 },
    { id: "notes", hidden: false, mtime: 500 },
  ]);
  // Same input twice: no change.
  assert.equal(JSON.stringify(L.menuPreset(d, ["chess"])), JSON.stringify(d));
  assert.deepEqual(L.menuPreset(null, []), { ver: 1, apps: [] });
});

test("menuPreset loses every merge to a real choice elsewhere", () => {
  const here = L.menuPreset(null, ["chess", "budget"]);
  // Another device hid chess once and showed it again: it stays shown.
  const there = L.menuSetHidden(L.menuSetHidden(null, ["chess"], true, 90), ["chess"], false, 100);
  for (const m of [L.menuMerge(here, there), L.menuMerge(there, here)]) {
    assert.equal(m.apps.find((a) => a.id === "chess").hidden, false);
    assert.equal(m.apps.find((a) => a.id === "budget").hidden, true);
  }
  // A later real choice here wins over the preset too.
  const later = L.menuSetHidden(here, ["budget"], false, 200);
  assert.equal(later.apps.find((a) => a.id === "budget").hidden, false);
  // Merge is stable: merging again changes nothing (no endless uploads).
  const m = L.menuMerge(here, there);
  assert.equal(JSON.stringify(L.menuMerge(m, here)), JSON.stringify(m));
  assert.equal(JSON.stringify(L.menuMerge(m, there)), JSON.stringify(m));
});
