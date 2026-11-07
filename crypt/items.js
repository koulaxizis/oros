// ============================================================
// orOS Crypt — item and monster tables (data only, v1.0.0)
// Loaded before crypt/engine.js (window.CryptData) and by Node
// (module.exports). Original names, shapes and numbers.
//
// Shapes are cells [x, y] of a polyomino in the backpack grid.
// Ports are [cell index, side] (0 up, 1 right, 2 down, 3 left) in the
// unrotated shape: two ports that face each other across touching
// cells of two items make a link (see engine.js packStats).
//
// Item fields: id, t type (b blade, w ward, r rune, c charm,
//   p potion, s scroll), sh shape, tier 1-3, and its effect:
//   atk, def, hp (max Health), fo (max Focus), light, trap (sees
//   traps), gold (% more gold), regen (1 Health every n turns),
//   frg (1 Focus every n turns instead of 10), cur (always cursed),
//   use: a rune's or a potion's or a scroll's action, cost (Focus).
// Never change the meaning of an id once released: a saved run
// stores items by id.
// ============================================================
(function (root) {
  "use strict";

  var SHAPES = {
    o1: [[0, 0]],
    i2: [[0, 0], [1, 0]],
    i3: [[0, 0], [1, 0], [2, 0]],
    l3: [[0, 0], [0, 1], [1, 1]],
    i4: [[0, 0], [1, 0], [2, 0], [3, 0]],
    l4: [[0, 0], [0, 1], [0, 2], [1, 2]],
    t4: [[0, 0], [1, 0], [2, 0], [1, 1]],
    o4: [[0, 0], [1, 0], [0, 1], [1, 1]],
    s4: [[1, 0], [2, 0], [0, 1], [1, 1]],
    p5: [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2]],
    u5: [[0, 0], [2, 0], [0, 1], [1, 1], [2, 1]],
    x5: [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]]
  };

  var ITEMS = [
    // Blades
    { id: "dagger",  t: "b", sh: "i2", tier: 1, atk: 1, ports: [[0, 3], [1, 1]] },
    { id: "sword",   t: "b", sh: "i3", tier: 1, atk: 2, ports: [[0, 3], [2, 1], [1, 0]] },
    { id: "hatchet", t: "b", sh: "l3", tier: 1, atk: 2, ports: [[0, 0], [2, 1], [1, 2]] },
    { id: "spear",   t: "b", sh: "i4", tier: 2, atk: 3, ports: [[0, 3], [3, 1], [1, 2], [2, 0]] },
    { id: "mace",    t: "b", sh: "o4", tier: 2, atk: 3, ports: [[0, 0], [1, 1], [3, 2]] },
    { id: "sabre",   t: "b", sh: "l4", tier: 2, atk: 4, ports: [[0, 0], [3, 1], [1, 3]] },
    { id: "pick",    t: "b", sh: "s4", tier: 3, atk: 4, ports: [[0, 0], [1, 1], [2, 3], [3, 2]] },
    { id: "great",   t: "b", sh: "t4", tier: 3, atk: 5, ports: [[0, 3], [2, 1], [3, 2]] },
    { id: "cleaver", t: "b", sh: "p5", tier: 3, atk: 6, def: -1, ports: [[1, 1], [4, 2], [0, 0]] },
    { id: "glass",   t: "b", sh: "o1", tier: 3, atk: 3, def: -2, cur: true, ports: [[0, 1]] },
    // Wards
    { id: "buckler", t: "w", sh: "o1", tier: 1, def: 1, ports: [[0, 1], [0, 3]] },
    { id: "cap",     t: "w", sh: "i2", tier: 1, hp: 4, ports: [[0, 0], [1, 2]] },
    { id: "greaves", t: "w", sh: "i3", tier: 1, def: 1, hp: 4, ports: [[0, 3], [2, 1]] },
    { id: "amulet",  t: "w", sh: "l3", tier: 2, def: 2, ports: [[0, 3], [2, 1], [2, 2]] },
    { id: "tower",   t: "w", sh: "o4", tier: 2, def: 3, ports: [[0, 3], [2, 3], [1, 1], [3, 1]] },
    { id: "mail",    t: "w", sh: "t4", tier: 2, def: 2, hp: 6, ports: [[0, 0], [2, 0], [3, 2]] },
    { id: "plate",   t: "w", sh: "u5", tier: 3, def: 4, hp: 6, ports: [[0, 3], [1, 1], [4, 2]] },
    { id: "thorns",  t: "w", sh: "x5", tier: 3, def: 3, hp: 10, cur: true, ports: [[0, 0], [1, 3], [3, 1], [4, 2]] },
    // Runes (active, cost Focus)
    { id: "bolt",    t: "r", sh: "i2", tier: 1, use: "bolt",  cost: 2, ports: [[0, 3], [1, 1]] },
    { id: "push",    t: "r", sh: "l3", tier: 1, use: "push",  cost: 1, ports: [[0, 0], [2, 1]] },
    { id: "shield",  t: "r", sh: "i2", tier: 1, use: "ward",  cost: 2, ports: [[0, 2], [1, 0]] },
    { id: "blink",   t: "r", sh: "o1", tier: 2, use: "blink", cost: 2, ports: [[0, 0], [0, 2]] },
    { id: "mend",    t: "r", sh: "i3", tier: 2, use: "mend",  cost: 3, ports: [[1, 0], [1, 2]] },
    { id: "storm",   t: "r", sh: "i4", tier: 3, use: "storm", cost: 3, ports: [[0, 3], [3, 1], [1, 0], [2, 2]] },
    // Charms (passive)
    { id: "lantern", t: "c", sh: "i2", tier: 1, light: 2, ports: [[0, 0], [1, 1]] },
    { id: "owl",     t: "c", sh: "o1", tier: 1, trap: 1, ports: [[0, 1], [0, 2]] },
    { id: "purse",   t: "c", sh: "l3", tier: 1, gold: 25, ports: [[0, 3], [2, 2]] },
    { id: "stone",   t: "c", sh: "o1", tier: 2, fo: 2, ports: [[0, 0], [0, 1], [0, 2], [0, 3]] },
    { id: "heart",   t: "c", sh: "o4", tier: 2, hp: 8, ports: [[0, 0], [3, 2]] },
    { id: "moss",    t: "c", sh: "i3", tier: 2, regen: 6, ports: [[0, 0], [2, 2]] },
    { id: "ring",    t: "c", sh: "o1", tier: 3, gold: 50, def: -1, cur: true, ports: [[0, 1]] },
    { id: "crown",   t: "c", sh: "t4", tier: 3, fo: 3, frg: 5, ports: [[0, 3], [2, 1], [3, 2]] },
    // Potions (used up)
    { id: "vial",    t: "p", sh: "o1", tier: 1, use: "heal", n: 8, ports: [] },
    { id: "flask",   t: "p", sh: "o1", tier: 2, use: "heal", n: 16, ports: [] },
    { id: "focus",   t: "p", sh: "o1", tier: 1, use: "focus", ports: [] },
    { id: "elixir",  t: "p", sh: "o1", tier: 3, use: "elixir", ports: [] },
    // Scrolls (used up)
    { id: "cleanse", t: "s", sh: "o1", tier: 1, use: "cleanse", ports: [] },
    { id: "chart",   t: "s", sh: "o1", tier: 1, use: "chart", ports: [] },
    { id: "escape",  t: "s", sh: "o1", tier: 2, use: "escape", ports: [] },
    { id: "fire",    t: "s", sh: "o1", tier: 2, use: "fire", ports: [] }
  ];

  // Monsters: hp, atk, def, from floor f, weight w of being picked.
  // Habits (engine.js monTurn):
  //   rat     plain
  //   swarm   splits off a rat when hit (twice at most)
  //   bat     takes two steps a turn
  //   bones   plain, sturdier
  //   archer  shoots along a row or column, keeps its distance
  //   ghoul   rings its bell when it wakes: wakes everyone near
  //   slime   acts every other turn
  //   mimic   looks like a chest until you are next to it
  //   spider  leaps next to you along a straight line
  //   wisp    its hit also drains 1 Focus
  //   guard   only moves while you are not in its row or column
  //   knight  plain, armoured
  //   brute   acts every other turn, hits very hard
  //   warden  floor 10: calls bones every 6 turns, holds the key
  var MONS = {
    rat:    { hp: 3,  atk: 2, def: 0, f: 1, w: 4 },
    swarm:  { hp: 6,  atk: 1, def: 0, f: 1, w: 2 },
    bat:    { hp: 3,  atk: 1, def: 0, f: 1, w: 2 },
    bones:  { hp: 7,  atk: 3, def: 0, f: 2, w: 4 },
    archer: { hp: 5,  atk: 3, def: 0, f: 2, w: 2 },
    slime:  { hp: 12, atk: 2, def: 0, f: 2, w: 2 },
    ghoul:  { hp: 8,  atk: 3, def: 0, f: 3, w: 2 },
    mimic:  { hp: 10, atk: 4, def: 1, f: 3, w: 0 },
    spider: { hp: 6,  atk: 3, def: 0, f: 4, w: 3 },
    wisp:   { hp: 5,  atk: 2, def: 0, f: 4, w: 2 },
    guard:  { hp: 14, atk: 4, def: 2, f: 5, w: 2 },
    knight: { hp: 12, atk: 4, def: 2, f: 6, w: 3 },
    brute:  { hp: 18, atk: 7, def: 1, f: 7, w: 2 },
    warden: { hp: 45, atk: 6, def: 2, f: 10, w: 0 }
  };
  var MON_KINDS = ["rat", "swarm", "bat", "bones", "archer", "slime", "ghoul", "mimic", "spider",
    "wisp", "guard", "knight", "brute", "warden"];

  var api = { SHAPES: SHAPES, ITEMS: ITEMS, MONS: MONS, MON_KINDS: MON_KINDS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CryptData = api;
})(typeof window !== "undefined" ? window : this);
