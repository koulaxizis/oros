// ============================================================
// orOS Wayfarers — tables (data only, v1.0.0)
// Loaded before wayfarers/engine.js (window.WayfarersData) and by Node
// (module.exports). Original names, numbers and rules (plan:
// /mnt/project-files/games/strategy/wayfarers-plan.md).
//
// Never change the meaning of an id once released: a saved journey
// stores classes, skills, upgrades, gear, foes and events by id.
//
// CLASSES  id → { row f front | b back, hp, pw Power, gd Guard,
//                 sp Speed, fo most Focus, sk: [skill ids] }
// SKILLS   id → { c class, cost Focus, tg target kind, f damage
//                 factor, and what else it does (see engine.js) }
//   tg: foe (one foe), foes (every foe), ally (a standing hero),
//       other (a standing hero, not the user), fallen (a fallen hero),
//       self, party (every standing hero)
// UPS      id → { c class (absent = any class), and the change }
//   stat ups (hp, pw, gd, sp, fo) can be taken again and again;
//   skill ups once.
// GEAR     id → { s w weapon | c charm, t tier 1-3, price, and stats }
// ITEMS    id → { price, most } (p potion, t tonic, f feather)
// FOES     id → { hp, pw, gd, sp, cyc: [move ids], wet: 1 always Wet,
//                 ph: guardian phases [{ at: share of Health, cyc,
//                 sum: [foe ids], pw: +Power }] }
// MOVES    id → { k kind, tg target rule, f factor, and statuses }
//   k: hit (one hero), all (every hero), heal (the most hurt foe),
//      (hit and all may also Burn, Chill, or pierce = go through Guard)
//      shell (itself Guards), rally (every foe +Power 2 turns)
//   tg: low (lowest Health), front (front row first), back (back row
//       first)
// REGIONS  [{ id, groups: { t1, t2, h, g: [[foe ids]] } }]
// EVENTS   [{ id, o: [choice: { k effect, n amount, cost gold }] }]
// ============================================================
(function (root) {
  "use strict";

  var CLASSES = {
    knight: { row: "f", hp: 32, pw: 5, gd: 3, sp: 3, fo: 5, sk: ["bash", "cover", "taunt"] },
    ranger: { row: "b", hp: 24, pw: 6, gd: 1, sp: 6, fo: 5, sk: ["mark", "pierce", "volley"] },
    mage:   { row: "b", hp: 20, pw: 7, gd: 0, sp: 4, fo: 6, sk: ["fire", "frost", "storm"] },
    cleric: { row: "b", hp: 24, pw: 4, gd: 2, sp: 4, fo: 6, sk: ["heal", "cleanse", "raise"] },
    rogue:  { row: "f", hp: 24, pw: 5, gd: 1, sp: 7, fo: 5, sk: ["twin", "hide"] },
    bard:   { row: "b", hp: 22, pw: 4, gd: 1, sp: 5, fo: 6, sk: ["anthem", "tempo", "gift"] }
  };
  var CLASS_IDS = ["knight", "ranger", "mage", "cleric", "rogue", "bard"];

  var SKILLS = {
    // Knight: Bash stuns (a stunned foe loses its turn and its shown move)
    bash:    { c: "knight", cost: 2, tg: "foe", f: 1.0, stun: 1 },
    // Cover: hits on that hero land on the Knight until the Knight's next turn
    cover:   { c: "knight", cost: 1, tg: "other" },
    // Taunt: every foe that hits one hero turns on the Knight
    taunt:   { c: "knight", cost: 2, tg: "self" },
    // Ranger: Mark = 1.5 × damage from the party (the Rogue: 2 ×)
    mark:    { c: "ranger", cost: 1, tg: "foe", f: 0.6, mark: 2 },
    pierce:  { c: "ranger", cost: 2, tg: "foe", f: 1.5, pierce: 1 },
    volley:  { c: "ranger", cost: 3, tg: "foes", f: 0.7 },
    // Mage: Burn hurts at the start of each turn; Chill = 3 less Speed;
    // Storm hits twice as hard on a Wet or Chilled foe
    fire:    { c: "mage", cost: 2, tg: "foe", f: 0.9, burn: 3 },
    frost:   { c: "mage", cost: 2, tg: "foe", f: 0.9, chill: 2 },
    storm:   { c: "mage", cost: 3, tg: "foe", f: 1.3, storm: 2 },
    // Cleric
    heal:    { c: "cleric", cost: 2, tg: "ally", heal: 1 },
    cleanse: { c: "cleric", cost: 1, tg: "ally", cleanse: 1 },
    raise:   { c: "cleric", cost: 3, tg: "fallen", raise: 1 },
    // Rogue: two quick strikes; Hide = no foe can hit the Rogue until
    // its next turn, and its next strike hits 1.5 × as hard
    twin:    { c: "rogue", cost: 2, tg: "foe", f: 0.7, hits: 2 },
    hide:    { c: "rogue", cost: 1, tg: "self" },
    // Bard: songs for the whole party, 2 turns each
    anthem:  { c: "bard", cost: 2, tg: "party", pwUp: 2 },
    tempo:   { c: "bard", cost: 2, tg: "party", spUp: 3 },
    gift:    { c: "bard", cost: 1, tg: "other", gift: 3 }
  };

  // Level ups: one of two choices per hero on every level.
  var STAT_UPS = ["hp", "pw", "gd", "sp", "fo"];
  var UPS = {
    hp: { hp: 6 }, pw: { pw: 1 }, gd: { gd: 1 }, sp: { sp: 1 }, fo: { fo: 1 },
    bashUp:    { c: "knight", sk: "bash" },     // Bash hits 1.5 ×
    coverUp:   { c: "knight", sk: "cover" },    // Cover also gives the Knight Guard
    tauntUp:   { c: "knight", sk: "taunt" },    // Taunt also heals the Knight 8
    markUp:    { c: "ranger", sk: "mark" },     // Mark lasts 3 turns
    pierceUp:  { c: "ranger", sk: "pierce" },   // Pierce hits 2 ×
    volleyUp:  { c: "ranger", sk: "volley" },   // Volley hits 1 ×
    fireUp:    { c: "mage", sk: "fire" },       // Burn lasts 4 turns
    frostUp:   { c: "mage", sk: "frost" },      // Chill lasts 3 turns
    stormUp:   { c: "mage", sk: "storm" },      // Storm 2.5 × on Wet or Chilled
    healUp:    { c: "cleric", sk: "heal" },     // Heal +6
    cleanseUp: { c: "cleric", sk: "cleanse" },  // Cleanse heals 10
    raiseUp:   { c: "cleric", sk: "raise" },    // Raise to 60 %
    twinUp:    { c: "rogue", sk: "twin" },      // Twin strikes 3 times
    hideUp:    { c: "rogue", sk: "hide" },      // Hide also gives 2 Focus
    backUp:    { c: "rogue", sk: "back" },      // 2.5 × on Marked or Stunned
    anthemUp:  { c: "bard", sk: "anthem" },     // Anthem +3 Power
    tempoUp:   { c: "bard", sk: "tempo" },      // Tempo also gives everyone 1 Focus
    giftUp:    { c: "bard", sk: "gift" }        // Gift gives 5 Focus
  };

  var GEAR = {
    // weapons
    iron:   { s: "w", t: 1, price: 14, pw: 1 },
    ash:    { s: "w", t: 1, price: 16, pw: 1, hp: 3 },
    steel:  { s: "w", t: 2, price: 26, pw: 2 },
    swift:  { s: "w", t: 2, price: 28, pw: 1, sp: 1 },
    heavy:  { s: "w", t: 2, price: 30, pw: 3, sp: -1 },
    star:   { s: "w", t: 3, price: 44, pw: 3 },
    // charms
    oak:     { s: "c", t: 1, price: 12, hp: 6 },
    plume:   { s: "c", t: 1, price: 12, sp: 1 },
    shell:   { s: "c", t: 1, price: 14, gd: 1 },
    lamp:    { s: "c", t: 2, price: 22, sf: 1 },
    heart:   { s: "c", t: 2, price: 26, hp: 12 },
    owl:     { s: "c", t: 2, price: 26, sp: 2 },
    stone:   { s: "c", t: 3, price: 40, gd: 2 },
    sun:     { s: "c", t: 3, price: 40, sf: 2 },
    // tier 4 (5.70.00): spoils of the Ash Hills and the Frost Gate, never sold
    ember:   { s: "w", t: 4, price: 60, pw: 4, sp: 1 },
    rime:    { s: "w", t: 4, price: 60, pw: 5 },
    crown:   { s: "c", t: 4, price: 56, hp: 14, gd: 1 },
    lantern: { s: "c", t: 4, price: 56, sf: 2, sp: 1 }
  };

  var ITEMS = {
    p: { price: 10, most: 5 },   // potion: heals 40 % of most Health
    t: { price: 12, most: 5 },   // tonic: +3 Focus (in a fight)
    f: { price: 30, most: 3 }    // feather: a fallen hero stands with half Health
  };

  var MOVES = {
    hit:    { k: "hit", tg: "low", f: 1.0 },
    bite:   { k: "hit", tg: "low", f: 1.0 },
    shot:   { k: "hit", tg: "back", f: 1.0 },
    charge: { k: "hit", tg: "front", f: 1.8 },
    briar:  { k: "hit", tg: "low", f: 0.8, burn: 3 },
    sweep:  { k: "all", f: 0.6 },
    mend:   { k: "heal", n: 8 },
    shell:  { k: "shell" },
    howl:   { k: "rally", n: 1 },
    rally:  { k: "rally", n: 2 },
    // 5.70.00: the Ash Hills and the Frost Gate
    scorch: { k: "hit", tg: "low", f: 0.8, burn: 2 },
    slam:   { k: "hit", tg: "front", f: 1.5 },
    quake:  { k: "all", f: 0.7 },
    blaze:  { k: "all", f: 0.5, burn: 2 },
    rimed:  { k: "hit", tg: "low", f: 0.9, chill: 2 },
    breath: { k: "all", f: 0.6, chill: 1, pierce: 1 },
    bolt:   { k: "hit", tg: "back", f: 1.2, pierce: 1 }
  };

  var FOES = {
    sprout:  { hp: 12, pw: 3, gd: 0, sp: 3, cyc: ["hit"] },
    wolf:    { hp: 16, pw: 4, gd: 0, sp: 7, cyc: ["bite", "bite", "howl"] },
    boar:    { hp: 26, pw: 5, gd: 1, sp: 2, cyc: ["hit", "charge"] },
    sprite:  { hp: 14, pw: 3, gd: 0, sp: 5, wet: 1, cyc: ["mend", "hit"] },
    archer:  { hp: 15, pw: 5, gd: 0, sp: 5, cyc: ["shot"] },
    moss:    { hp: 30, pw: 4, gd: 3, sp: 1, wet: 1, cyc: ["shell", "hit"] },
    witch:   { hp: 18, pw: 4, gd: 0, sp: 4, cyc: ["briar", "mend"] },
    captain: { hp: 36, pw: 6, gd: 2, sp: 4, cyc: ["hit", "rally", "sweep"] },
    king:    { hp: 115, pw: 6, gd: 2, sp: 3, cyc: ["hit", "sweep"], boss: 1,
               ph: [{ at: 0.66, cyc: ["briar", "sweep", "hit"], sum: ["sprout", "sprout"] },
                    { at: 0.33, cyc: ["charge", "sweep"], pw: 2 }] },
    // the Ash Hills (5.70.00)
    imp:     { hp: 18, pw: 5, gd: 0, sp: 6, cyc: ["scorch", "hit"] },
    lizard:  { hp: 24, pw: 6, gd: 1, sp: 5, cyc: ["bite", "shell", "bite"] },
    bat:     { hp: 14, pw: 5, gd: 0, sp: 8, cyc: ["shot"] },
    golem:   { hp: 44, pw: 7, gd: 4, sp: 1, cyc: ["shell", "slam"] },
    shaman:  { hp: 22, pw: 5, gd: 0, sp: 4, cyc: ["mend", "rally", "hit"] },
    brute:   { hp: 38, pw: 8, gd: 1, sp: 2, cyc: ["hit", "quake"] },
    salamander: { hp: 28, pw: 6, gd: 1, sp: 5, cyc: ["scorch", "scorch", "sweep"] },
    raider:  { hp: 28, pw: 7, gd: 1, sp: 5, cyc: ["hit", "hit", "rally"] },
    colossus: { hp: 180, pw: 8, gd: 3, sp: 2, cyc: ["slam", "quake"], boss: 1,
               ph: [{ at: 0.66, cyc: ["blaze", "slam", "hit"], sum: ["imp", "imp"] },
                    { at: 0.33, cyc: ["slam", "blaze"], pw: 2 }] },
    // the Frost Gate (5.70.00)
    wisp:    { hp: 20, pw: 6, gd: 0, sp: 7, cyc: ["rimed"] },
    icewolf: { hp: 28, pw: 8, gd: 1, sp: 8, cyc: ["bite", "bite", "howl"] },
    sentinel: { hp: 52, pw: 8, gd: 5, sp: 2, cyc: ["shell", "slam"] },
    caller:  { hp: 28, pw: 8, gd: 0, sp: 5, wet: 1, cyc: ["bolt", "mend"] },
    yeti:    { hp: 54, pw: 10, gd: 2, sp: 3, cyc: ["hit", "hit", "charge"] },
    drake:   { hp: 40, pw: 8, gd: 2, sp: 6, cyc: ["rimed", "breath"] },
    spirit:  { hp: 24, pw: 6, gd: 0, sp: 5, wet: 1, cyc: ["mend", "rimed"] },
    reaver:  { hp: 38, pw: 9, gd: 2, sp: 4, cyc: ["hit", "rally", "sweep"] },
    keeper:  { hp: 500, pw: 14, gd: 4, sp: 4, cyc: ["hit", "breath"], boss: 1,
               ph: [{ at: 0.66, cyc: ["rimed", "breath", "hit"], sum: ["wisp", "wisp"] },
                    { at: 0.33, cyc: ["charge", "breath"], pw: 2 }] }
  };

  var REGIONS = [
    { id: "green",
      groups: {
        t1: [["sprout", "sprout"], ["wolf"], ["sprout", "sprite"], ["wolf", "sprout"], ["archer", "sprout"]],
        t2: [["wolf", "wolf"], ["boar", "sprite"], ["archer", "archer", "sprout"], ["moss", "witch"],
             ["boar", "wolf"], ["sprite", "sprite", "wolf"]],
        h:  [["captain", "archer"], ["boar", "boar", "witch"], ["moss", "moss", "sprite", "witch"]],
        g:  [["king"]]
      } },
    { id: "ash",
      groups: {
        t1: [["imp", "imp"], ["lizard", "bat"], ["imp", "shaman"], ["bat", "bat", "imp"], ["raider"]],
        t2: [["golem", "imp"], ["brute", "shaman"], ["salamander", "bat"], ["raider", "raider"],
             ["lizard", "lizard", "shaman"], ["salamander", "imp", "imp"]],
        h:  [["golem", "golem", "shaman"], ["brute", "raider", "bat"], ["salamander", "salamander", "shaman", "imp"]],
        g:  [["colossus"]]
      } },
    { id: "frost",
      groups: {
        t1: [["wisp", "wisp"], ["icewolf"], ["spirit", "wisp"], ["caller", "wisp"], ["reaver"]],
        t2: [["icewolf", "icewolf"], ["sentinel", "caller"], ["drake", "wisp"], ["yeti", "spirit"],
             ["reaver", "caller"], ["spirit", "spirit", "icewolf"]],
        h:  [["yeti", "yeti", "spirit"], ["drake", "drake", "caller"], ["sentinel", "reaver", "caller", "wisp"]],
        g:  [["keeper"]]
      } }
  ];

  // Events: a short scene with two or three choices. Effects:
  //   heal n % of most Health (every standing hero), hurt n (every
  //   standing hero, never below 1), gold n, xp n, item id (+1), mhp 6
  //   (most Health of every hero, for good: an "hp" upgrade), gear of
  //   tier n, fight (a fight
  //   of the region's middle kind, then gold n), none
  // cost: gold spent (the choice is shut without it).
  // r: only in that region (1-3); without r, in any region.
  var EVENTS = [
    { id: "shrine", o: [{ k: "heal", n: 30 }, { k: "mhp", n: 6, cost: 15 }] },
    { id: "tinker", o: [{ k: "xp", n: 25 }, { k: "gold", n: 20 }] },
    { id: "berry",  o: [{ k: "heal", n: 20 }, { k: "item", id: "p" }] },
    { id: "cart",   o: [{ k: "fight", n: 30 }, { k: "item", id: "t", cost: 12 }, { k: "none" }] },
    { id: "stump",  o: [{ k: "gear", n: 1, hurt: 5 }, { k: "none" }] },
    { id: "hermit", o: [{ k: "xp", n: 15 }, { k: "item", id: "f", cost: 20 }] },
    { id: "well",   o: [{ k: "heal", n: 35, cost: 5 }, { k: "gold", n: 8 }] },
    { id: "spar",   o: [{ k: "xp", n: 35, hurt: 6 }, { k: "heal", n: 15 }] },
    { id: "fox",    o: [{ k: "item", id: "f" }, { k: "gold", n: 12 }] },
    { id: "bridge", o: [{ k: "gold", n: 25, hurt: 4 }, { k: "none" }] },
    // 5.70.00: anywhere
    { id: "peddler", o: [{ k: "item", id: "t", cost: 8 }, { k: "item", id: "p", cost: 6 }, { k: "none" }] },
    { id: "statue",  o: [{ k: "xp", n: 20 }, { k: "gold", n: 15, hurt: 3 }] },
    { id: "pilgrims", o: [{ k: "xp", n: 30, cost: 10 }, { k: "none" }] },
    { id: "lost",    o: [{ k: "xp", n: 25, hurt: 4 }, { k: "gold", n: 10 }] },
    { id: "campfire", o: [{ k: "heal", n: 25 }, { k: "item", id: "p" }] },
    { id: "oldmap",  o: [{ k: "gold", n: 30, hurt: 5 }, { k: "none" }] },
    // the Ash Hills
    { id: "forge",   r: 2, o: [{ k: "gear", n: 3, cost: 25 }, { k: "gold", n: 12 }] },
    { id: "spring",  r: 2, o: [{ k: "heal", n: 50 }, { k: "mhp", n: 6, cost: 20 }] },
    { id: "ashfall", r: 2, o: [{ k: "none", hurt: 5 }, { k: "none", cost: 10 }] },
    { id: "mine",    r: 2, o: [{ k: "gold", n: 35, hurt: 6 }, { k: "xp", n: 20 }] },
    { id: "glass",   r: 2, o: [{ k: "gear", n: 2 }, { k: "gold", n: 18 }] },
    { id: "raiders", r: 2, o: [{ k: "fight", n: 45 }, { k: "none" }] },
    { id: "nest",    r: 2, o: [{ k: "item", id: "f", hurt: 6 }, { k: "none" }] },
    // the Frost Gate
    { id: "lake",    r: 3, o: [{ k: "gold", n: 40, hurt: 7 }, { k: "none" }] },
    { id: "hut",     r: 3, o: [{ k: "heal", n: 60, cost: 10 }, { k: "heal", n: 25 }] },
    { id: "cave",    r: 3, o: [{ k: "gear", n: 3, hurt: 8 }, { k: "none" }] },
    { id: "aurora",  r: 3, o: [{ k: "xp", n: 45 }, { k: "heal", n: 30 }] },
    { id: "sledge",  r: 3, o: [{ k: "fight", n: 55 }, { k: "item", id: "t" }] },
    { id: "lamp",    r: 3, o: [{ k: "mhp", n: 6, cost: 20 }, { k: "item", id: "f", cost: 25 }] },
    { id: "tracks",  r: 3, o: [{ k: "fight", n: 40 }, { k: "none", hurt: 4 }] }
  ];

  var api = { CLASSES: CLASSES, CLASS_IDS: CLASS_IDS, SKILLS: SKILLS, STAT_UPS: STAT_UPS, UPS: UPS,
    GEAR: GEAR, ITEMS: ITEMS, MOVES: MOVES, FOES: FOES, REGIONS: REGIONS, EVENTS: EVENTS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WayfarersData = api;
})(typeof window !== "undefined" ? window : this);
