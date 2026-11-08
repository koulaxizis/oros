// Wayfarers: the rules engine (wayfarers/engine.js, a module), the
// tables (wayfarers/data.js) and the records merge (cut out of the app
// IIFE by name, like tests/crypt.test.js).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const E = require("../wayfarers/engine.js");
const D = require("../wayfarers/data.js");

const SRC = fs.readFileSync(path.join(__dirname, "..", "wayfarers/wayfarers.js"), "utf8");
const R = (() => {
  const parts = ["var E = this; var DATA_VER = 1; var DIFFS = E.DIFFS; var CLASS_IDS = " + JSON.stringify(E.CLASS_IDS) + "; var REGIONS_N = " + E.REGIONS.length + "; var BIG = 1e9; var MAX_DAY = 100000; var MAX_ACTS = 99999; var LAST_N = 10; var MAX_REGION = E.MAX_REGION;"];
  ["cmpStr", "isInt", "capOf", "normRow", "joinRows", "normDay", "dayKeyOk", "dayBetter", "normLast", "mergeWayfarers"].forEach((name) => {
    const i = SRC.indexOf("  function " + name + "(");
    if (i < 0) throw new Error("missing function " + name);
    const one = SRC.indexOf("\n", i);
    const line = SRC.slice(i, one);
    parts.push(/\}\s*$/.test(line) ? line : SRC.slice(i, SRC.indexOf("\n  }\n", i) + 4));
  });
  return new Function(parts.join("\n") + "\nreturn { mergeWayfarers };").call(E);
})();

// Party codes (5.73.00), taken from the UI file the same way.
const PC = (() => {
  const parts = ["var E = this; var CLASS_IDS = E.CLASS_IDS; var REGIONS_N = E.REGIONS.length; var MAX_REGION = E.MAX_REGION; var GEAR_IDS = Object.keys(E.GEAR);"];
  ["classUps", "b36", "checkOf", "partyCode", "readPartyCode"].forEach((name) => {
    const i = SRC.indexOf("  function " + name + "(");
    if (i < 0) throw new Error("missing function " + name);
    const line = SRC.slice(i, SRC.indexOf("\n", i));
    parts.push(/\}\s*$/.test(line) ? line : SRC.slice(i, SRC.indexOf("\n  }\n", i) + 4));
  });
  return new Function(parts.join("\n") + "\nreturn { partyCode, readPartyCode };").call(E);
})();

const J = JSON.stringify;
const PARTIES = [];
for (let a = 0; a < 6; a++) for (let b = a + 1; b < 6; b++) for (let c = b + 1; c < 6; c++) PARTIES.push([E.CLASS_IDS[a], E.CLASS_IDS[b], E.CLASS_IDS[c]]);

// A fight set up by hand: the party at full Health, these foes.
function fight(classes, foes, diff = "h") {
  const st = E.newJourney("t", diff, classes);
  const n = st.map.findIndex((m) => m.c === 1);
  st.map[n].k = "f";
  const ev = E.act(st, { t: "go", n });
  assert.ok(ev && st.fight);
  // swap in the wanted foes, in a fresh round
  st.fight.foes = foes.map((k, i) => ({ id: i + 1, k, hp: D.FOES[k].hp, mh: D.FOES[k].hp, st: {}, t: 0, ph: 0, n: { m: D.FOES[k].cyc[0], tg: 0 } }));
  st.fight.nid = foes.length + 1;
  return st;
}
// Make hero i the one to act now.
function turnOf(st, i) {
  st.fight.cur = "h" + i;
  st.fight.q = [];
}
function foe(st, id) { return st.fight.foes.find((f) => f.id === id); }

// ---------- bots ----------
function low(st) {
  let best = null;
  st.fight.foes.forEach((f) => { if (f.hp > 0 && (!best || f.hp < best.hp)) best = f; });
  return best;
}
function outOfFight(st) {
  for (let i = 0; i < 3; i++) {
    for (let b = 0; b < st.bag.length; b++) {
      const g = st.bag[b], slot = E.GEAR[g].s === "w" ? "w" : "ch";
      const tier = (x) => (x ? E.GEAR[x].t : 0);
      if (tier(g) > tier(st.party[i][slot])) { E.act(st, { t: "equip", h: i, b }); b = -1; }
    }
  }
  for (let i = 0; i < 3; i++) {
    if (st.party[i].hp === 0 && st.inv.f > 0) E.act(st, { t: "use", i: "f", h: i });
    while (st.party[i].hp > 0 && st.party[i].hp < E.heroStats(st, i).mh * 0.45 && st.inv.p > 0) if (!E.act(st, { t: "use", i: "p", h: i })) break;
  }
}
function pend(st) {
  const p = st.pend[0];
  if (p.k === "up") return E.act(st, { t: "up", o: 0 });
  if (p.k === "loot") return E.act(st, { t: "loot", o: 0 }) || E.act(st, { t: "loot", o: -1 });
  if (p.k === "camp") {
    const hurt = [0, 1, 2].some((i) => st.party[i].hp < E.heroStats(st, i).mh * 0.7);
    return E.act(st, hurt ? { t: "rest" } : { t: "train", h: 0 });
  }
  if (p.k === "mk") {
    for (let i = 0; i < p.s.length; i++) {
      const s = p.s[i];
      if (E.GEAR[s.g] && st.gold >= s.p + 10 && E.act(st, { t: "buy", i })) return true;
      if (s.g === "p" && st.inv.p < 3 && E.act(st, { t: "buy", i })) return true;
    }
    return E.act(st, { t: "leave" });
  }
  if (p.k === "tale") return E.act(st, { t: "on" });
  const ev = E.eventOf(p.id);
  for (let o = 0; o < ev.o.length; o++) if (E.choiceOk(st, ev.o[o]) && E.act(st, { t: "ev", o })) return true;
  return null;
}
// simple: attacks the weakest foe, drinks a potion when low; smart: plays the combos
function fightMove(st, smart) {
  const fi = st.fight, i = +fi.cur.slice(1), h = st.party[i], mh = E.heroStats(st, i).mh, f = low(st);
  const tryA = (a) => E.act(st, a);
  if (!smart) {
    if (h.hp < mh * 0.3 && st.inv.p > 0 && tryA({ t: "item", i: "p", x: i })) return;
    tryA({ t: "atk", x: f.id });
    return;
  }
  const alive = fi.foes.filter((x) => x.hp > 0);
  const big = alive.reduce((a, b) => (b.hp > a.hp ? b : a));
  const up = [0, 1, 2].filter((k) => st.party[k].hp > 0);
  const hurt = up.sort((a, b) => st.party[a].hp / E.heroStats(st, a).mh - st.party[b].hp / E.heroStats(st, b).mh)[0];
  const hurtR = st.party[hurt].hp / E.heroStats(st, hurt).mh;
  const fallen = [0, 1, 2].find((k) => st.party[k].hp === 0);
  const use = (s, x) => E.usable(st, i, s) && tryA({ t: "sk", s, x });
  if (h.c === "cleric") {
    if (fallen !== undefined && use("raise", fallen)) return;
    if (hurtR < 0.55 && use("heal", hurt)) return;
  }
  if (fallen !== undefined && st.inv.f > 0 && tryA({ t: "item", i: "f", x: fallen })) return;
  if (hurtR < 0.25 && st.inv.p > 0 && tryA({ t: "item", i: "p", x: hurt })) return;
  if (h.c === "knight") {
    const heavy = alive.find((x) => x.n && (E.MOVES[x.n.m].f || 0) >= 1.5);
    if (heavy && use("bash", heavy.id)) return;
  }
  if (h.c === "ranger") {
    if (alive.length >= 3 && use("volley")) return;
    if (!(big.st.mk > 0) && big.hp > 15 && use("mark", big.id)) return;
    if (use("pierce", (big.st.mk ? big : f).id)) return;
  }
  if (h.c === "mage") {
    const wet = alive.find((x) => E.FOES[x.k].wet || x.st.ch > 0);
    if (wet && use("storm", wet.id)) return;
    if (!(big.st.ch > 0) && big.hp > 20 && use("frost", big.id)) return;
    if (!(big.st.bu > 0) && use("fire", big.id)) return;
  }
  if (h.c === "rogue") {
    const mk = alive.find((x) => x.st.mk > 0 || x.st.sn > 0);
    if (use("twin", (mk || f).id)) return;
  }
  if (h.c === "bard") {
    if (fi.round % 3 === 1 && use("anthem")) return;
  }
  const mk = alive.find((x) => x.st.mk > 0);
  tryA({ t: "atk", x: (mk || f).id });
}
function journey(seed, diff, classes, smart, end) {
  const st = E.newJourney(seed, diff, classes, end);
  let guard = 0;
  while (st.over < 0 && guard++ < 20000) {
    assert.ok(E.valid(st), "valid state " + seed + " at " + st.acts);
    const before = st.acts;
    if (st.fight) fightMove(st, smart);
    else if (st.pend.length) pend(st);
    else {
      outOfFight(st);
      const r = E.reach(st);
      let n = r[0];
      if (smart) {
        const hurt = [0, 1, 2].some((i) => st.party[i].hp < E.heroStats(st, i).mh * 0.5);
        const pref = hurt ? ["c", "m", "e", "f", "h", "g"] : ["h", "f", "e", "m", "c", "g"];
        for (const k of pref.slice().reverse()) { const x = r.find((q) => st.map[q].k === k); if (x !== undefined) n = x; }
      }
      E.act(st, { t: "go", n });
    }
    assert.ok(st.acts > before, "every bot move is a legal action (" + seed + ")");
  }
  return st;
}

// ---------- tables ----------
test("wayfarers: tables are whole (classes, skills, upgrades, gear, foes, regions, events)", () => {
  assert.equal(E.CLASS_IDS.length, 6);
  E.CLASS_IDS.forEach((c) => {
    const C = D.CLASSES[c];
    assert.ok(["f", "b"].includes(C.row) && C.hp > 0 && C.pw > 0 && C.sp > 0 && C.fo >= 3, c);
    C.sk.forEach((s) => assert.equal(D.SKILLS[s].c, c, s));
    assert.ok(Object.keys(D.UPS).filter((u) => D.UPS[u].c === c).length >= 3, "skill upgrades for " + c);
  });
  Object.keys(D.SKILLS).forEach((s) => assert.ok(D.CLASSES[D.SKILLS[s].c].sk.includes(s), s + " belongs to its class"));
  Object.keys(D.UPS).forEach((u) => { const U = D.UPS[u]; if (U.sk && U.sk !== "back") assert.ok(D.SKILLS[U.sk], u); });
  Object.keys(D.FOES).forEach((k) => {
    const F = D.FOES[k];
    (F.ph || []).concat([{ cyc: F.cyc }]).forEach((p) => p.cyc.forEach((m) => assert.ok(D.MOVES[m], k + " " + m)));
    (F.ph || []).forEach((p) => (p.sum || []).forEach((x) => assert.ok(D.FOES[x])));
  });
  E.REGIONS.forEach((r) => ["t1", "t2", "h", "g"].forEach((k) => r.groups[k].forEach((g) => {
    assert.ok(g.length >= 1 && g.length <= 5);
    g.forEach((x) => assert.ok(D.FOES[x], x));
  })));
  D.EVENTS.forEach((e) => {
    assert.ok(e.o.length >= 2 && e.o.length <= 3, e.id);
    e.o.forEach((o) => assert.ok(["heal", "hurt", "gold", "xp", "item", "mhp", "gear", "fight", "none"].includes(o.k), e.id));
  });
  // the UI has a name and text for everything
  const strings = SRC.slice(SRC.indexOf("var STRINGS"), SRC.indexOf("if (window.orosI18n) window.orosI18n.table"));
  const keys = [].concat(
    E.CLASS_IDS.map((c) => "cls." + c), E.CLASS_IDS.map((c) => "cls." + c + ".note"),
    Object.keys(D.SKILLS).map((s) => "sk." + s), Object.keys(D.SKILLS).map((s) => "sk." + s + ".d"),
    Object.keys(D.UPS).map((u) => "up." + u), Object.keys(D.GEAR).map((g) => "gear." + g),
    Object.keys(D.FOES).map((k) => "foe." + k), Object.keys(D.FOES).map((k) => "hab." + k), Object.keys(D.MOVES).map((m) => "mv." + m),
    D.EVENTS.map((e) => "evt." + e.id), D.EVENTS.map((e) => "evt.title." + e.id),
    [].concat(...D.EVENTS.map((e) => e.o.map((o, k) => "evt." + e.id + "." + k))));
  const parts = strings.split(/\n    el: \{/);
  keys.forEach((k) => {
    assert.ok(parts[0].includes('"' + k + '"'), "EN " + k);
    assert.ok(parts[1].includes('"' + k + '"'), "EL " + k);
  });
});

// ---------- the map ----------
test("wayfarers: the path map is the same from the same code, never crosses and always leads to the guardian", () => {
  for (let s = 0; s < 200; s++) {
    const m = E.makeMap("map" + s, 1);
    assert.equal(J(m), J(E.makeMap("map" + s, 1)));
    assert.equal(m[0].k, "s");
    assert.equal(m[m.length - 1].k, "g");
    const into = m.map(() => 0);
    m.forEach((n, i) => {
      if (i < m.length - 1) assert.ok(n.e.length >= 1, "a road out of every stop");
      n.e.forEach((j) => { into[j]++; assert.equal(m[j].c, n.c + 1); });
      if (n.c === 1) assert.equal(n.k, "f");
      if (n.c === E.COLS - 2) assert.equal(n.k, "c", "a camp before the guardian");
    });
    into.forEach((k, i) => { if (i) assert.ok(k >= 1, "every stop can be reached"); });
    // no two roads between the same columns cross
    for (let a = 0; a < m.length; a++) for (let b = 0; b < m.length; b++) {
      if (a === b || m[a].c !== m[b].c || m[a].r >= m[b].r) continue;
      m[a].e.forEach((x) => m[b].e.forEach((y) => assert.ok(m[x].r <= m[y].r, "roads cross in map" + s)));
    }
    assert.ok(m.some((n) => n.k === "m"), "a market");
    const mk = {};
    m.forEach((n) => { if (n.k === "m") { assert.ok(!mk[n.c], "two markets in a column"); mk[n.c] = 1; } });
  }
});

// ---------- fights ----------
test("wayfarers: damage is Power × factor − Guard, at least 1; Guard halves; turn order is by Speed, heroes first on a tie", () => {
  const st = fight(["knight", "ranger", "mage"], ["moss", "sprout"]);
  turnOf(st, 2);   // the Mage: Power 7
  const m = foe(st, 1), hp = m.hp;
  E.act(st, { t: "atk", x: 1 });
  assert.equal(hp - m.hp, 7 - D.FOES.moss.gd);
  // order: Ranger 6, Mage 4, Knight 3 = Thornling 3 (hero first), Mossback 1
  st.fight.q = [];
  st.fight.foes.forEach((f) => { f.st = {}; });
  const order = E.queueView(st).next;
  assert.deepEqual(order, ["h1", "h2", "h0", "f2", "f1"]);
  // a hit on a guarding hero is halved
  const st2 = fight(["knight", "ranger", "mage"], ["sprout"]);
  foe(st2, 1).n = { m: "hit", tg: 2 };
  turnOf(st2, 2);
  st2.fight.q = ["f1"];
  const mhp = st2.party[2].hp;
  E.act(st2, { t: "guard" });
  assert.equal(mhp - st2.party[2].hp, Math.floor(3 / 2), "the Thornling's 3 is halved");
});

test("wayfarers: foes show their move, then do it; a Stun cancels it; Taunt and Cover move the hit to the Knight", () => {
  // the boar hits, then charges the front row
  let st = fight(["knight", "ranger", "mage"], ["boar"]);
  const b = foe(st, 1);
  b.n = { m: "charge", tg: 0 };
  turnOf(st, 0);
  E.act(st, { t: "sk", s: "bash", x: 1 });
  assert.equal(b.st.sn, 1, "stunned");
  // the next turns run: the boar loses its turn and its charge
  const hp0 = st.party.map((h) => h.hp);
  let guard = 0;
  while (st.fight && st.fight.cur !== "h0" && guard++ < 10) E.act(st, { t: "guard" });
  assert.ok(st.party[0].hp >= hp0[0] - 1, "no charge landed on the Knight");
  // Taunt: a hit aimed at the Mage lands on the Knight
  st = fight(["knight", "ranger", "mage"], ["sprout"]);
  foe(st, 1).n = { m: "hit", tg: 2 };
  turnOf(st, 0);
  st.fight.hs[0].fo = 5;
  E.act(st, { t: "sk", s: "taunt" });
  assert.equal(foe(st, 1).n.tg, 0, "the shown target turns to the Knight");
  // Cover: the Knight takes hits meant for the Ranger
  st = fight(["knight", "ranger", "mage"], ["archer"]);
  turnOf(st, 0);
  st.fight.hs[0].fo = 5;
  E.act(st, { t: "sk", s: "cover", x: 1 });
  const kn = st.party[0].hp, rg = st.party[1].hp;
  guard = 0;
  while (st.fight && st.fight.cur !== "h0" && guard++ < 10) {
    const c = +st.fight.cur.slice(1);
    E.act(st, c === 1 ? { t: "guard" } : { t: "guard" });
  }
  assert.equal(st.party[1].hp, rg, "the Ranger is not hit");
  assert.ok(st.party[0].hp < kn, "the Knight is");
});

test("wayfarers: combos — Mark, the Rogue on a Marked or Stunned foe, Storm on Wet or Chilled", () => {
  const st = fight(["ranger", "mage", "rogue"], ["captain", "sprite", "boar"]);
  const cap = foe(st, 1), spr = foe(st, 2), boar = foe(st, 3);
  // Rogue (Power 5) on a plain foe: 5 − 2 = 3; marked: round(5 × 2) − 2 = 8
  turnOf(st, 2);
  let hp = cap.hp;
  E.act(st, { t: "atk", x: 1 });
  assert.equal(hp - cap.hp, 3);
  cap.st.mk = 2;
  turnOf(st, 2);
  hp = cap.hp;
  let ev = E.act(st, { t: "atk", x: 1 });
  assert.equal(hp - cap.hp, 8);
  assert.ok(ev.some((e) => e.e === "hit" && e.c === "back"));
  // the Ranger on a marked foe: round(6 × 1.5) − 2 = 7
  cap.st.mk = 2;
  turnOf(st, 0);
  hp = cap.hp;
  ev = E.act(st, { t: "atk", x: 1 });
  assert.equal(hp - cap.hp, 7);
  assert.ok(ev.some((e) => e.e === "hit" && e.c === "mark"));
  // Storm (Power 7 × 1.3 = 9) on the always-Wet sprite: × 2 = 18
  turnOf(st, 1);
  st.fight.hs[1].fo = 6;
  hp = spr.hp;
  E.act(st, { t: "sk", s: "storm", x: 2 });
  assert.equal(hp - spr.hp, Math.min(hp, 18));
  // Storm on a dry boar: 9 − 1 = 8; on a chilled boar: 18 − 1 = 17
  turnOf(st, 1);
  st.fight.hs[1].fo = 6;
  hp = boar.hp;
  E.act(st, { t: "sk", s: "storm", x: 3 });
  assert.equal(hp - boar.hp, 8);
  boar.hp = boar.mh; boar.st.ch = 2;
  turnOf(st, 1);
  st.fight.hs[1].fo = 6;
  E.act(st, { t: "sk", s: "storm", x: 3 });
  assert.equal(boar.mh - boar.hp, 17);
});

test("wayfarers: Focus — 2 to start, +1 each turn, skills cost it, Guard gives one more", () => {
  const st = fight(["knight", "ranger", "mage"], ["moss", "moss"]);
  turnOf(st, 1);
  st.fight.hs[1].fo = 1;
  assert.equal(E.usable(st, 1, "pierce"), false, "2 Focus needed");
  assert.equal(E.act(st, { t: "sk", s: "pierce", x: 1 }), null, "refused, nothing changes");
  assert.equal(E.usable(st, 1, "mark"), true);
  E.act(st, { t: "sk", s: "mark", x: 1 });
  // 1 − 1 for Mark; the foes act, and the Ranger (fastest) starts the next round with +1
  assert.equal(st.fight.cur, "h1");
  assert.equal(st.fight.hs[1].fo, 1);
  const fresh = E.newJourney("f", "h", ["knight", "ranger", "mage"]);
  const n = fresh.map.findIndex((m) => m.c === 1);
  E.act(fresh, { t: "go", n });
  const cur = +fresh.fight.cur.slice(1);
  assert.equal(fresh.fight.hs[cur].fo, 3, "2 to start + 1 for the turn");
  E.act(fresh, { t: "guard" });
  assert.equal(fresh.fight.hs[cur].fo, 4);
});

test("wayfarers: the Cleric heals, cleanses and raises once a fight; items take the turn", () => {
  const st = fight(["knight", "cleric", "bard"], ["moss", "moss"]);
  st.party[0].hp = 0;
  turnOf(st, 1);
  st.fight.hs[1].fo = 6;
  E.act(st, { t: "sk", s: "raise", x: 0 });
  assert.equal(st.party[0].hp, Math.round(E.heroStats(st, 0).mh * 0.3));
  assert.deepEqual(E.targets(st, 1, "raise"), [], "once a fight");
  st.party[2].hp = 5;
  st.fight.hs[2].st = { bu: 2, bd: 3 };
  turnOf(st, 1);
  st.fight.hs[1].fo = 6;
  st.fight.q = ["f1", "f2"];
  E.act(st, { t: "sk", s: "cleanse", x: 2 });
  assert.equal(st.fight.hs[2].st.bu, 0);
  assert.equal(st.party[2].hp, 9);
  turnOf(st, 1);
  st.fight.hs[1].fo = 6;
  E.act(st, { t: "sk", s: "heal", x: 2 });
  assert.equal(st.party[2].hp, 9 + E.heroStats(st, 1).pw * 2 + 4);
  const p = st.inv.p;
  turnOf(st, 2);
  E.act(st, { t: "item", i: "p", x: 2 });
  assert.equal(st.inv.p, p - 1);
  turnOf(st, 2);
  assert.equal(E.act(st, { t: "item", i: "f", x: 2 }), null, "a feather is for a fallen hero");
});

test("wayfarers: Burn ticks at the start of a turn; the guardian calls thornlings at two thirds and rages at one third", () => {
  const st = fight(["knight", "ranger", "mage"], ["king"]);
  const k = foe(st, 1);
  turnOf(st, 2);
  st.fight.hs[2].fo = 6;
  E.act(st, { t: "sk", s: "fire", x: 1 });
  assert.equal(k.st.bu, 3);
  k.hp = Math.floor(k.mh * 0.66) + 1;
  turnOf(st, 1);
  const ev = E.act(st, { t: "atk", x: 1 });
  assert.equal(k.ph >= 1, true);
  assert.ok(ev.some((e) => e.e === "summon"), "thornlings join");
  assert.equal(st.fight.foes.filter((f) => f.k === "sprout").length, 2);
  k.hp = Math.floor(k.mh * 0.33) + 1;
  turnOf(st, 1);
  E.act(st, { t: "atk", x: 1 });
  assert.equal(k.ph, 2);
  assert.equal(E.foeStats(k).pw, D.FOES.king.pw + 2);
});

test("wayfarers: winning a fight pays gold and XP, levels up with two choices per hero, and Gentle stands the fallen up", () => {
  const st = fight(["knight", "ranger", "mage"], ["sprout"], "g");
  st.xp = 9;
  st.party[0].hp = 0;
  foe(st, 1).hp = 1;
  turnOf(st, 1);
  const gold = st.gold;
  const ev = E.act(st, { t: "atk", x: 1 });
  assert.ok(ev.some((e) => e.e === "win"));
  assert.equal(st.fight, null);
  assert.ok(st.gold > gold);
  assert.equal(st.lvl, 2);
  assert.ok(st.party[0].hp > 0, "Gentle: the Knight stands up");
  assert.equal(st.pend.filter((p) => p.k === "up").length, 3);
  st.pend.forEach((p) => { assert.equal(p.o.length, 2); assert.notEqual(p.o[0], p.o[1]); });
  assert.deepEqual(E.reach(st), [], "no walking on before the choices");
  const h = st.pend[0].h, u = st.pend[0].o[1];
  E.act(st, { t: "up", o: 1 });
  assert.ok(st.party[h].up.includes(u));
  // Hardy: the fallen stay down until a camp
  const st2 = fight(["knight", "ranger", "mage"], ["sprout"], "h");
  st2.party[0].hp = 0;
  foe(st2, 1).hp = 1;
  turnOf(st2, 1);
  E.act(st2, { t: "atk", x: 1 });
  assert.equal(st2.party[0].hp, 0);
});

test("wayfarers: camps, markets, events and gear", () => {
  const st = E.newJourney("stops", "h", ["knight", "cleric", "bard"]);
  st.party[0].hp = 0;
  st.party[1].hp = 3;
  // a camp: the fallen stand, then rest or train
  st.map[st.map[0].e[0]].k = "c";
  E.act(st, { t: "go", n: st.map[0].e[0] });
  assert.equal(st.party[0].hp, 1);
  assert.equal(st.pend[0].k, "camp");
  E.act(st, { t: "rest" });
  assert.equal(st.party[1].hp, 3 + Math.round(E.heroStats(st, 1).mh / 2));
  // a market: gear once, items up to the most, never without gold
  st.pend.push({ k: "mk", s: [{ g: "iron", p: 14, n: 0 }, { g: "p", p: 10, n: 0 }] });
  st.gold = 30;
  assert.ok(E.act(st, { t: "buy", i: 0 }));
  assert.equal(E.act(st, { t: "buy", i: 0 }), null, "sold");
  assert.deepEqual(st.bag, ["iron"]);
  st.inv.p = 5;
  assert.equal(E.act(st, { t: "buy", i: 1 }), null, "you carry the most");
  st.inv.p = 0; st.gold = 5;
  assert.equal(E.act(st, { t: "buy", i: 1 }), null, "not enough gold");
  E.act(st, { t: "leave" });
  // gear on and off
  const pw = E.heroStats(st, 0).pw;
  E.act(st, { t: "equip", h: 0, b: 0 });
  assert.equal(E.heroStats(st, 0).pw, pw + 1);
  assert.deepEqual(st.bag, []);
  E.act(st, { t: "unequip", h: 0, s: "w" });
  assert.deepEqual(st.bag, ["iron"]);
  // an event: a choice that costs gold is shut without it
  st.pend.push({ k: "ev", id: "shrine" });
  st.gold = 10;
  assert.equal(E.act(st, { t: "ev", o: 1 }), null);
  st.gold = 15;
  const mh = E.heroStats(st, 2).mh;
  E.act(st, { t: "ev", o: 1 });
  assert.equal(st.gold, 0);
  assert.equal(E.heroStats(st, 2).mh, mh + 6);
  // an event fight pays its gold on the win
  st.pend.push({ k: "ev", id: "cart" });
  E.act(st, { t: "ev", o: 0 });
  assert.ok(st.fight && st.fight.kind === "e" && st.fight.re === 30);
});

test("wayfarers: three regions — a guardian down leads to the next map with a rest and a tale; the last one ends the journey", () => {
  assert.deepEqual(E.REGIONS.map((r) => r.id), ["green", "ash", "frost"]);
  const st = fight(["knight", "ranger", "mage"], ["king"]);
  st.fight.kind = "g";
  st.party[1].hp = 0;
  st.party[0].hp = 5;
  foe(st, 1).hp = 1;
  turnOf(st, 2);
  const ev = E.act(st, { t: "atk", x: 1 });
  assert.ok(ev.some((e) => e.e === "region" && e.n === 2));
  assert.equal(st.region, 2);
  assert.equal(J(st.map), J(E.makeMap("t", 2)), "the map of region 2 comes from the code");
  assert.equal(st.at, 0);
  assert.deepEqual(st.path, [0]);
  assert.equal(st.party[1].hp, Math.max(1, Math.round(E.heroStats(st, 1).mh / 4)), "the fallen stand at a quarter");
  assert.ok(st.party[0].hp > 5, "the standing rest on the way");
  assert.deepEqual(st.pend.map((p) => p.k).filter((k) => k !== "up"), ["loot", "tale"]);
  assert.ok(st.pend.find((p) => p.k === "loot").o.every((g) => E.GEAR[g].t >= 2), "the Briar King leaves tier 2 or 3");
  assert.ok(E.valid(st));
  while (st.pend[0].k !== "tale") E.act(st, st.pend[0].k === "up" ? { t: "up", o: 0 } : { t: "loot", o: -1 });
  assert.equal(E.act(st, { t: "rest" }), null);
  assert.ok(E.act(st, { t: "on" }));
  assert.ok(E.reach(st).length > 0, "walk on in the Ash Hills");
  const bad = E.clone(st); bad.pend = [{ k: "tale", n: 3 }];
  assert.equal(E.valid(bad), false, "a tale is only of the region reached");
  // the last guardian ends it, with no tale
  const end = fight(["knight", "ranger", "mage"], ["keeper"]);
  end.region = 3;
  end.fight.kind = "g";
  foe(end, 1).hp = 1;
  turnOf(end, 2);
  const xp = end.xp;
  const ev2 = E.act(end, { t: "atk", x: 1 });
  assert.equal(end.over, 1);
  assert.ok(ev2.some((e) => e.e === "won"));
  assert.equal(ev2.find((e) => e.e === "win").xp, 80, "later regions pay double at the Frost Gate");
  assert.equal(end.xp, xp + 80);
  assert.equal(end.pend.length, 0);
});

test("wayfarers: the Ash Hills and the Frost Gate — Burn on every hero, Chill on a hero, hits through Guard; events of the region", () => {
  // Rime Chills the hero it hits: 3 less Speed
  const a = fight(["knight", "ranger", "mage"], ["wisp"]);
  const sp = E.speedOf(a, "h1");
  foe(a, 1).n = { m: "rimed", tg: 1 };
  turnOf(a, 0);
  a.fight.q = ["f1"];
  E.act(a, { t: "guard" });
  assert.ok(a.fight.hs[1].st.ch > 0);
  assert.equal(E.speedOf(a, "h1"), sp - 3);
  // Bolt goes through Guard: Power × 1.2 on a guarding Mage, halved only
  const b = fight(["knight", "ranger", "mage"], ["caller"]);
  foe(b, 1).n = { m: "bolt", tg: 2 };
  b.party[2].w = "";
  turnOf(b, 2);
  b.fight.q = ["f1"];
  const hp = b.party[2].hp;
  E.act(b, { t: "guard" });
  assert.equal(hp - b.party[2].hp, Math.floor(Math.round(D.FOES.caller.pw * 1.2) / 2));
  // Blaze: every hero Burns
  const c = fight(["knight", "ranger", "mage"], ["colossus"]);
  foe(c, 1).n = { m: "blaze", tg: -1 };
  turnOf(c, 0);
  c.fight.q = ["f1"];
  E.act(c, { t: "guard" });
  assert.ok([0, 1, 2].every((i) => c.fight.hs[i].st.bu > 0));
  // events: only those of the region (or of any region)
  for (let k = 0; k < 30; k++) {
    const st = E.newJourney("ev" + k, "g", ["knight", "ranger", "mage"]);
    st.region = 2;
    const n = st.map[0].e[0];
    st.map[n].k = "e";
    E.act(st, { t: "go", n });
    const r = E.eventOf(st.pend[0].id).r;
    assert.ok(r === undefined || r === 2, st.pend[0].id);
  }
  assert.ok(D.EVENTS.length >= 30);
});

test("wayfarers: valid() refuses broken saves", () => {
  const st = E.newJourney("v", "g", ["knight", "mage", "cleric"]);
  assert.ok(E.valid(st));
  const bad = [
    (s) => { s.v = 2; }, (s) => { s.diff = "x"; }, (s) => { s.party[1].c = "knight"; }, (s) => { s.party[0].hp = 9999; },
    (s) => { s.party[0].up.push("stormUp"); }, (s) => { s.party[0].w = "oak"; }, (s) => { s.bag = ["nope"]; },
    (s) => { s.inv.p = 99; }, (s) => { s.map[0].e = [0]; }, (s) => { s.at = 99; }, (s) => { s.pend = [{ k: "zz" }]; },
    (s) => { s.fight = { kind: "f" }; }, (s) => { s.over = 3; }, (s) => { s.seen = ["nope"]; }
  ];
  bad.forEach((f, k) => { const c = E.clone(st); f(c); assert.equal(E.valid(c), false, "broken save " + k); });
  const n = st.map[0].e[0];
  st.map[n].k = "f";
  E.act(st, { t: "go", n });
  assert.ok(E.valid(st));
  const c = E.clone(st);
  c.fight.foes[0].hp = c.fight.foes[0].mh + 1;
  assert.equal(E.valid(c), false);
});

test("wayfarers: a journey is the same from the same code and moves; illegal actions change nothing", () => {
  const a = journey("same", "g", ["knight", "ranger", "cleric"], true);
  const b = journey("same", "g", ["knight", "ranger", "cleric"], true);
  assert.equal(J(a), J(b));
  const st = E.newJourney("x", "h", ["knight", "ranger", "cleric"]);
  const before = J(st);
  [{ t: "go", n: 99 }, { t: "atk", x: 1 }, { t: "rest" }, { t: "buy", i: 0 }, { t: "up", o: 0 }, null, { t: "zz" }].forEach((x) => {
    assert.equal(E.act(st, x), null);
  });
  assert.equal(J(st), before);
});

test("wayfarers: 300 bot journeys keep a valid state; the balance targets hold", () => {
  let simple = 0, smart = 0, n = 0;
  const wins = {}, play = {};
  for (let k = 0; k < 150; k++) {
    const p = PARTIES[k % PARTIES.length];
    const a = journey("bal" + k, "g", p, false);
    if (a.over === 1 || a.region > 1) simple++;
    const b = journey("bal" + k, "h", p, true);
    if (b.over === 1) { smart++; p.forEach((c) => { wins[c] = (wins[c] || 0) + 1; }); }
    p.forEach((c) => { play[c] = (play[c] || 0) + 1; });
    n++;
  }
  assert.ok(simple / n > 0.7, "a simple bot clears the Greenway on Gentle most of the time: " + simple + "/" + n);
  console.log("wayfarers balance: simple Gentle past the Greenway " + simple + "/" + n + ", combo bot whole journey on Hardy " + smart + "/" + n);
  assert.ok(smart / n > 0.4 && smart / n < 0.97, "a combo bot walks the whole road on Hardy often, not always: " + smart + "/" + n);
  E.CLASS_IDS.forEach((c) => assert.ok(wins[c] > 0, c + " is in a winning party"));
});

test("wayfarers: the records merge is a join (symmetric, idempotent, reset wins)", () => {
  const m = R.mergeWayfarers;
  const A = { ver: 1, br: 5, rows: { aaaaaa1: { b: 5, s: { g: [3, 2, 1] }, c: { knight: 2 } }, old111: { b: 1, s: { h: [9, 9, 1] } } } };
  const B = { ver: 1, br: 0, rows: { aaaaaa1: { b: 5, s: { g: [4, 1, 0], h: [1, 0, 0] }, c: { knight: 1, mage: 1 } }, bbbbbb2: { b: 5, s: { h: [2, 1, 1] }, c: { rogue: 1 } } } };
  assert.equal(J(m(A, B)), J(m(B, A)));
  assert.equal(J(m(m(A, B), B)), J(m(A, B)));
  const AB = m(A, B);
  assert.deepEqual(AB.rows.aaaaaa1.s.g, [4, 2, 1]);
  assert.deepEqual(AB.rows.aaaaaa1.c, { knight: 2, mage: 1 });
  assert.equal(AB.rows.old111, undefined, "older than the reset");
  const broken = { ver: 1, br: 0, rows: { "x": { b: 0, s: { g: [1, 1, 1] } }, cccccc3: { b: 0, s: { g: [1, 2, 0] } }, dddddd4: { b: 0, s: { g: [1, 0, 9] } }, eeeeee5: { b: 0, s: { q: [1, 0, 0] } } } };
  assert.deepEqual(m(broken, broken).rows, {}, "bad rows drop");
});

test("wayfarers: Daily trial days and Last journeys merge as a join (better result wins, newest 10, reset drops)", () => {
  const m = R.mergeWayfarers;
  const P = ["knight", "mage", "cleric"];
  const A = { ver: 1, br: 0, rows: {}, days: { 10: { b: 0, w: 0, c: 5, t: 90 }, 11: { b: 0, w: 1, c: 7, t: 200 } },
    last: [{ a: 1000, d: "h", p: P, r: 2, w: 0, s: "abc" }, { a: 900, d: "d", p: P, r: 1, w: 1, s: "wf20260110" }] };
  const B = { ver: 1, br: 0, rows: {}, days: { 10: { b: 0, w: 1, c: 7, t: 300 }, 11: { b: 0, w: 1, c: 7, t: 150 }, 12: { b: 0, w: 0, c: 3, t: 40 } },
    last: [{ a: 1000, d: "h", p: P, r: 2, w: 0, s: "abc" }, { a: 1100, d: "g", p: P, r: 3, w: 1, s: "zzz" }] };
  assert.equal(J(m(A, B)), J(m(B, A)));
  assert.equal(J(m(m(A, B), B)), J(m(A, B)));
  const AB = m(A, B);
  assert.deepEqual(AB.days[10], { b: 0, w: 1, c: 7, t: 300 }, "through beats a fall");
  assert.deepEqual(AB.days[11], { b: 0, w: 1, c: 7, t: 150 }, "fewer moves win");
  assert.deepEqual(AB.last.map((v) => v.a), [1100, 1000, 900], "newest first, the same journey once");
  const many = { ver: 1, br: 0, rows: {}, last: [] };
  for (let k = 1; k <= 14; k++) many.last.push({ a: k, d: "g", p: P, r: 1, w: 0, s: "s" + k });
  assert.equal(m(many, many).last.length, 10);
  assert.equal(m(many, many).last[0].a, 14);
  const reset = m(AB, { ver: 1, br: 950, rows: {} });
  assert.deepEqual(Object.keys(reset.days), [], "days of an older epoch drop");
  assert.deepEqual(reset.last.map((v) => v.a), [1100, 1000]);
  const bad = { ver: 1, br: 0, rows: {}, days: { x: { b: 0, w: 1, c: 7, t: 9 }, 5: { b: 0, w: 2, c: 7, t: 9 }, 6: { b: 0, w: 1, c: 8, t: 9 } },
    last: [{ a: 5, d: "q", p: P, r: 1, w: 0, s: "a" }, { a: 5, d: "g", p: ["mage", "mage", "bard"], r: 1, w: 0, s: "a" }, { a: 5, d: "g", p: P, r: 4, w: 0, s: "a" }] };
  assert.deepEqual([m(bad, bad).days, m(bad, bad).last], [{}, []], "bad entries drop");
  assert.equal(J(m({ ver: 1, br: 0, rows: {} }, { ver: 1, br: 0, rows: {} })), J({ ver: 1, br: 0, rows: {}, days: {}, last: [], lore: [] }), "older data has no days");
});

test("wayfarers: the Daily trial — a party of the day from the code, the Greenway only, then the journey ends", () => {
  const p1 = E.dailyParty("wf20261108");
  assert.deepEqual(E.dailyParty("wf20261108"), p1, "the same party from the same code");
  assert.ok(E.partyOk(p1));
  const front = (c) => E.CLASSES[c].row === "f";
  for (let k = 1; k < 3; k++) assert.ok(!(front(p1[k]) && !front(p1[k - 1])), "front row first");
  const seen = {};
  for (let d = 0; d < 60; d++) seen[E.dailyParty("wf" + d).join()] = 1;
  assert.ok(Object.keys(seen).length >= 10, "the party changes with the day");
  const st = E.newJourney("wf20261108", "h", p1, 1);
  assert.equal(st.end, 1);
  assert.ok(E.valid(st));
  assert.equal(E.newJourney("x", "h", p1, 3).end, undefined, "end only below the last region");
  // the guardian of the Greenway down: the journey is won, no second region
  let through = 0;
  for (let d = 0; d < 20; d++) {
    const seed = "wf" + d, g = journey(seed, "h", E.dailyParty(seed), true, 1);
    assert.equal(g.region, 1);
    if (g.over === 1) { through++; assert.equal(g.map[g.at].k, "g"); }
  }
  assert.ok(through >= 12, "a combo bot passes most daily trials: " + through + "/20");
  const bad = JSON.parse(JSON.stringify(st));
  bad.region = 2;
  assert.ok(!E.valid(bad), "a trial never walks past its last region");
  bad.region = 1; bad.end = 3;
  assert.ok(!E.valid(bad));
});

test("wayfarers: Endless — the lands come round again with stronger foes until the party falls", () => {
  const P = ["knight", "mage", "cleric"];
  const st = E.newJourney("loop", "e", P, 1);
  assert.equal(st.end, undefined, "Endless has no end");
  assert.ok(E.valid(st));
  assert.equal(E.regionOf(4).id, "green");
  assert.equal(E.loopOf(4), 1);
  assert.equal(E.regionOf(9).id, "frost");
  assert.equal(E.loopOf(9), 2);
  // region 4: the Greenway's foes, one loop stronger
  st.region = 4;
  st.map = E.makeMap("loop", 4);
  for (let i = 0; i < 3; i++) st.party[i].hp = E.heroStats(st, i).mh;
  assert.ok(E.valid(st), "Endless takes regions past 3");
  const n = st.map[0].e[0];
  st.map[n].k = "f";
  E.act(st, { t: "go", n });
  assert.ok(st.fight);
  st.fight.foes.forEach((f) => {
    assert.ok(E.REGIONS[0].groups.t1.some((g) => g.includes(f.k)), "a Greenway foe");
    assert.equal(f.lv, 1);
    assert.equal(f.mh, Math.round(E.FOES[f.k].hp * 1.6));
    assert.equal(E.foeStats(f).gd, E.FOES[f.k].gd + 1);
  });
  assert.ok(E.valid(st));
  const h = E.newJourney("loop", "h", P);
  h.region = 4;
  assert.ok(!E.valid(h), "Hardy stops at region 3");
  const bad = E.newJourney("loop", "e", P);
  bad.end = 1;
  assert.ok(!E.valid(bad), "Endless never has an end");
  let far = 0;
  for (let k = 0; k < 12; k++) {
    const g = journey("endless" + k, "e", PARTIES[(k * 7) % PARTIES.length], true);
    assert.equal(g.over, 0, "an Endless journey ends only with a fall");
    assert.ok(E.valid(g));
    if (g.region > 3) far++;
  }
  assert.ok(far >= 2, "a combo bot gets past the Frost Gate now and then: " + far + "/12");
});

test("wayfarers: Endless records, the lore book and Endless last journeys merge as a join", () => {
  const m = R.mergeWayfarers;
  const P = ["knight", "mage", "cleric"];
  const A = { ver: 1, br: 0, rows: { aaaaaa1: { b: 0, s: { e: [3, 0, 7] } } }, lore: ["wolf", "king"], last: [{ a: 5, d: "e", p: P, r: 12, w: 0, s: "abc" }] };
  const B = { ver: 1, br: 0, rows: { aaaaaa1: { b: 0, s: { e: [4, 0, 5], g: [1, 1, 3] } } }, lore: ["sprout", "wolf", "nope"] };
  assert.equal(J(m(A, B)), J(m(B, A)));
  assert.equal(J(m(m(A, B), B)), J(m(A, B)));
  const AB = m(A, B);
  assert.deepEqual(AB.rows.aaaaaa1.s.e, [4, 0, 7]);
  assert.deepEqual(AB.lore, ["king", "sprout", "wolf"], "a sorted union; unknown foes drop");
  assert.equal(AB.last[0].r, 12);
  assert.deepEqual(m({ ver: 1, br: 99, rows: {} }, AB).lore, AB.lore, "Reset records leaves the lore book");
  const bad = { ver: 1, br: 0, rows: { cccccc3: { b: 0, s: { e: [1, 1, 2] } }, dddddd4: { b: 0, s: { h: [1, 0, 5] } } },
    last: [{ a: 5, d: "h", p: P, r: 4, w: 0, s: "a" }] };
  assert.deepEqual([m(bad, bad).rows, m(bad, bad).last], [{}, []], "no Endless win, Hardy at most 3 regions");
});

test("wayfarers: party codes — a whole party round trips, a wrong letter is refused", () => {
  const P = ["knight", "ranger", "bard"];
  const st = E.newJourney("frnd42", "h", P);
  st.lvl = 8; st.region = 3; st.over = 0;
  st.party[0].w = "sword"; st.party[0].ch = "";
  st.party[0].up = ["hp", "bashUp", "tauntUp"];
  st.party[2].up = ["pw"];
  const g = { g: st, opts: { diff: "h", seed: "frnd42", party: P } };
  Object.keys(E.GEAR).forEach((k) => { if (E.GEAR[k].s === "c" && !st.party[1].ch) st.party[1].ch = k; });
  if (!E.GEAR.sword) st.party[0].w = Object.keys(E.GEAR).find((k) => E.GEAR[k].s === "w");
  const code = PC.partyCode(g);
  assert.match(code, /^w1h[0-5]{3}/);
  const pc = PC.readPartyCode(code.toUpperCase().replace(/(.{5})/g, "$1-"));
  assert.ok(pc, "case and dashes do not matter");
  assert.deepEqual([pc.d, pc.p, pc.lvl, pc.r, pc.w, pc.s], ["h", P, 8, 3, 0, "frnd42"]);
  assert.equal(pc.h[0].w, st.party[0].w);
  assert.deepEqual(pc.h[0].up, ["bashUp", "tauntUp"], "skill upgrades only, in table order");
  assert.equal(pc.h[1].ch, st.party[1].ch);
  assert.deepEqual(pc.h[2].up, []);
  for (let k = 0; k < code.length; k++) {
    const c = code.charAt(k), other = c === "a" ? "b" : "a";
    const x = PC.readPartyCode(code.slice(0, k) + other + code.slice(k + 1));
    assert.ok(x === null || J(x) !== J(pc), "a changed letter never reads as the same party (" + k + ")");
  }
  assert.equal(PC.readPartyCode("frnd42"), null, "a journey code is not a party code");
  st.diff = "e"; g.opts.diff = "e"; st.region = 14;
  assert.equal(PC.readPartyCode(PC.partyCode(g)).r, 14, "Endless regions past 3");
});
