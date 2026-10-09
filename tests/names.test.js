// Pure logic of the Name Generator: word lists, Greek to Latin,
// handles / titles / regal pairs (charset, styles, gender agreement,
// one accent per Greek name), batches, and the favourites merge
// (sync slice "names").
// Run: node --test tests/
//
// The app is a browser IIFE with no exports, so the constants and
// sections 2–5 are cut out of the source and evaluated on their own.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const W = require(path.join(__dirname, "..", "names/words.js"));
const src = fs.readFileSync(path.join(__dirname, "..", "names/names.js"), "utf8");
function block(from, to) {
  const i = src.indexOf(from), j = src.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return src.slice(i, j);
}
const N = new Function("window",
  block("  var STORAGE_KEY", "  // ---------- 1.") +
  block("  function cmpStr(", "  // BOOT MARKER") +
  block("  // ---------- 2. Random", "  // ---------- 6. Storage") +
  "\nreturn { MODES, MAX_TEXT, seeded, greeklish, stripAccents, generate, batch, favId, normFav," +
  " mergeNames, addFav, removeFav, findFav, favGroups };")({ NAME_WORDS: W });

const ACCENTED = /[άέήίόύώΐΰ]/g;
const empty = () => ({ ver: 1, favs: [], tombs: {} });

function lists(obj, out, at) {
  Object.keys(obj).forEach((k) => {
    const v = obj[k], p = at + "." + k;
    if (Array.isArray(v)) out.push([p, v]);
    else lists(v, out, p);
  });
  return out;
}

test("words: no empty lists, no repeats inside a list", () => {
  lists(W, [], "W").forEach(([p, list]) => {
    assert.ok(list.length > 0, p);
    if (/\.mid$/.test(p)) return;                 // "" repeats on purpose (no middle)
    const keys = list.map((x) => JSON.stringify(x));
    assert.equal(new Set(keys).size, keys.length, p + " has a repeat");
  });
  [W.title.el.adj, W.title.el.role, W.regal.el.epiAdj].forEach((l) =>
    l.forEach((pair) => assert.ok(Array.isArray(pair) && pair.length === 2 && pair.every((s) => typeof s === "string" && s), String(pair))));
});

test("words: Greek name parts put exactly one accent on every name", () => {
  const r = W.regal.el;
  r.start.concat(r.mid).forEach((s) => assert.equal((s.match(ACCENTED) || []).length, 0, s));
  r.endM.concat(r.endF).forEach((s) => {
    assert.equal((s.match(ACCENTED) || []).length, 1, s);
    assert.ok(!/^[αεηιουω]/.test(N.stripAccents(s)), s + " must start with a consonant");
  });
});

test("greeklish: plain Latin spelling", () => {
  const cases = {
    "φεγγάρι": "fengari", "μπισκότο": "biskoto", "κουλούρι": "koulouri", "ντομάτα": "domata",
    "αύριο": "avrio", "ευχαριστώ": "efcharisto", "ψάρι": "psari", "θάλασσα": "thalassa",
    "μυρμήγκι": "myrmingi", "τζιτζίκι": "tzitziki", "παιδί": "paidi", "ξύλινο": "xylino"
  };
  Object.keys(cases).forEach((g) => assert.equal(N.greeklish(g), cases[g], g));
  W.handle.el.adj.concat(W.handle.el.noun).forEach((w) =>
    assert.match(N.greeklish(w), /^[a-z]+$/, w));
});

test("handles: Latin letters only, styles show up only when on", () => {
  const combos = [];
  [0, 1].forEach((leet) => [0, 1].forEach((sep) => [0, 1].forEach((num) => combos.push({ leet, sep, num }))));
  ["en", "el"].forEach((lang) => combos.forEach((o) => {
    const rng = N.seeded(7 + o.leet * 4 + o.sep * 2 + o.num);
    for (let i = 0; i < 300; i++) {
      const s = N.generate("handle", lang, o, rng);
      const tag = lang + JSON.stringify(o) + " " + s;
      assert.match(s, /^[a-z0-9_-]+$/, tag);
      assert.ok(s.length <= 24, tag);
      assert.equal(/[_-]/.test(s), !!o.sep, tag);
      if (!o.leet && !o.num) assert.match(s, /^[a-z_-]+$/, tag);
      if (o.leet && !o.num) assert.match(s, /[0-9]/, tag);
      if (o.num) assert.match(s, /[0-9]$/, tag);
    }
  }));
});

test("titles: Greek adjective and role agree in gender", () => {
  const adj = W.title.el.adj, role = W.title.el.role;
  const rng = N.seeded(11);
  let withAdj = 0;
  for (let i = 0; i < 400; i++) {
    const s = N.generate("title", "el", {}, rng);
    assert.match(s, /^[Α-ΩΆΈΉΊΌΎΏ]/, s);
    const a = adj.find((p) => p.some((f) => s.startsWith(f + " ")));
    if (!a) {
      assert.ok(role.some((p) => p.some((f) => s.toLowerCase().startsWith(f))), s);
      continue;
    }
    withAdj++;
    const rest = s.slice(s.indexOf(" ") + 1);
    const ok = [0, 1].some((g) => s.startsWith(a[g] + " ") && role.some((p) => rest.startsWith(p[g])));
    assert.ok(ok, "gender mismatch: " + s);
  }
  assert.ok(withAdj > 50);
  const en = N.generate("title", "en", {}, N.seeded(3));
  assert.match(en, /^[A-Z]/);
});

test("regal pairs: one accent, matching article, tidy English", () => {
  const r = W.regal.el, rng = N.seeded(5);
  for (let i = 0; i < 400; i++) {
    const s = N.generate("regal", "el", {}, rng);
    const name = s.split(" ")[0], rest = s.slice(name.length + 1);
    assert.equal((name.match(ACCENTED) || []).length, 1, s);
    if (/^[οη] /.test(rest)) {
      const g = rest[0] === "η" ? 1 : 0;
      assert.ok(r.epiAdj.some((p) => p[g] === rest.slice(2)), s);
      assert.ok((g ? r.endF : r.endM).some((e) => name.endsWith(e)), s);
    } else {
      assert.ok(r.epiOf.indexOf(rest) >= 0, s);
    }
  }
  const rng2 = N.seeded(9);
  for (let i = 0; i < 400; i++) {
    const s = N.generate("regal", "en", {}, rng2);
    assert.match(s, /^[A-Z][a-z]+ (the|of) /, s);
    assert.ok(!/([aeiouy])\1/.test(s.split(" ")[0]), s);
  }
});

test("batch: eight different names, repeatable with a seed", () => {
  N.MODES.forEach((m) => ["en", "el"].forEach((l) => {
    const a = N.batch(m, l, {}, N.seeded(42), 8), b = N.batch(m, l, {}, N.seeded(42), 8);
    assert.equal(a.length, 8);
    assert.equal(new Set(a).size, 8);
    assert.deepEqual(a, b);
    assert.notDeepEqual(a, N.batch(m, l, {}, N.seeded(43), 8));
  }));
});

test("favId: stable, shaped, mode-aware", () => {
  const id = N.favId("handle", "quietcomet");
  assert.match(id, /^n[a-z0-9]{14}$/);
  assert.equal(id, N.favId("handle", "quietcomet"));
  assert.notEqual(id, N.favId("title", "quietcomet"));
  assert.notEqual(id, N.favId("handle", "quietcomet1"));
});

test("favourites: the same name starred on two devices is one", () => {
  const a = N.addFav(empty(), "handle", "moss_pilot", 1000);
  const b = N.addFav(empty(), "handle", "moss_pilot", 2000);
  const m = N.mergeNames(a, b);
  assert.equal(m.favs.length, 1);
  assert.equal(m.favs[0].m, 2000);
  assert.deepEqual(N.addFav(a, "handle", "moss_pilot", 5000), a);   // already kept
});

test("favourites merge: commutative, idempotent, associative", () => {
  const rng = N.seeded(1);
  function rnd() {
    const d = empty();
    const texts = ["a1", "b2", "c3", "d4", "e5"];
    texts.forEach((s) => {
      const k = N.MODES[Math.floor(rng() * 3)];
      const id = N.favId(k, s);
      const r = rng();
      if (r < 0.4) d.favs.push({ id, m: 1 + Math.floor(rng() * 5), k, s });
      else if (r < 0.6) d.tombs[id] = 1 + Math.floor(rng() * 5);
    });
    return d;
  }
  for (let i = 0; i < 200; i++) {
    const a = rnd(), b = rnd(), c = rnd();
    assert.deepEqual(N.mergeNames(a, b), N.mergeNames(b, a));
    const ab = N.mergeNames(a, b);
    assert.deepEqual(N.mergeNames(ab, ab), ab);
    assert.deepEqual(N.mergeNames(N.mergeNames(a, b), c), N.mergeNames(a, N.mergeNames(b, c)));
  }
});

test("favourites: delete travels, wins ties, a newer star brings it back (Undo)", () => {
  let a = N.addFav(empty(), "regal", "Aldric the Unhurried", 1000);
  const b = JSON.parse(JSON.stringify(a));
  const id = a.favs[0].id;
  a = N.removeFav(a, id, 1000);                        // same ms as the star
  assert.equal(a.tombs[id], 1000);
  assert.equal(N.mergeNames(a, b).favs.length, 0);     // delete wins the tie
  const undo = N.addFav(a, "regal", "Aldric the Unhurried", 900);   // clock behind
  assert.equal(undo.favs[0].m, 1001);                  // still beats the tomb
  assert.equal(N.mergeNames(undo, a).favs.length, 1);
  assert.deepEqual(N.removeFav(undo, "nmissingmissing", 5), undo);
});

test("favourites: junk is dropped, text is tidied", () => {
  const good = N.addFav(empty(), "title", "  Keeper   of Old Maps ", 10).favs[0];
  assert.equal(good.s, "Keeper of Old Maps");
  const m = N.mergeNames({
    favs: [good, null, 5, { id: good.id, m: -1, k: "title", s: good.s },
      { id: "nzzzzzzzzzzzzzz", m: 3, k: "title", s: "forged id" },
      { id: N.favId("pet", "Rex"), m: 3, k: "pet", s: "Rex" },
      { id: N.favId("handle", ""), m: 3, k: "handle", s: "" }],
    tombs: { bad: 3, nzzzzzzzzzzzzzz: "x", nyyyyyyyyyyyyyy: 4 }
  }, null);
  assert.deepEqual(m.favs, [good]);
  assert.deepEqual(m.tombs, { nyyyyyyyyyyyyyy: 4 });
  const long = N.addFav(empty(), "title", "x".repeat(200), 1).favs[0];
  assert.equal(long.s.length, N.MAX_TEXT);
  assert.deepEqual(N.mergeNames(N.addFav(empty(), "title", "x".repeat(200), 1), null).favs, [long]);
});

test("favGroups: by mode, newest first", () => {
  let d = empty();
  d = N.addFav(d, "title", "Old Title", 1);
  d = N.addFav(d, "handle", "first", 2);
  d = N.addFav(d, "handle", "second", 3);
  const g = N.favGroups(d);
  assert.deepEqual(g.map((x) => x.k), ["handle", "title", "regal"]);
  assert.deepEqual(g[0].list.map((f) => f.s), ["second", "first"]);
  assert.deepEqual(g[2].list, []);
});
