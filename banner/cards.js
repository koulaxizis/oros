// ============================================================
// orOS Banner — card table and starter decks (data only)
// Every name, number and rule here is our own (an original game).
//   CARDS[k] = { t: "u" unit | "s" spell | "t" tile, c: cost,
//                hp, atk, mv, kw: "" | reach | guard | charge | climb | heal }
//   DECKS[id] = [[card, count], …], 20 cards each
// Used by banner/engine.js (BannerEngine) and tests/banner.test.js.
// ============================================================
(function (root) {
  "use strict";

  function u(c, hp, atk, mv, kw) { return { t: "u", c: c, hp: hp, atk: atk, mv: mv, kw: kw || "" }; }
  function s(c) { return { t: "s", c: c }; }
  function tl(c) { return { t: "t", c: c }; }

  var CARDS = {
    // units: cost, Health, Attack, Move, keyword
    militia:  u(1, 2, 1, 1),
    scout:    u(1, 2, 2, 2),
    archer:   u(2, 2, 1, 1, "reach"),
    spear:    u(2, 3, 2, 1),
    shield:   u(2, 4, 1, 1, "guard"),
    wolf:     u(2, 3, 2, 2),
    healer:   u(2, 3, 1, 1, "heal"),
    climber:  u(2, 3, 1, 1, "climb"),
    knight:   u(3, 4, 2, 2),
    xbow:     u(3, 3, 2, 1, "reach"),
    raider:   u(3, 3, 2, 1, "charge"),
    sentinel: u(3, 6, 1, 1, "guard"),
    druid:    u(3, 4, 2, 1, "heal"),
    eagle:    u(3, 3, 2, 3, "climb"),
    giant:    u(4, 6, 3, 1),
    lancer:   u(4, 5, 3, 2, "charge"),
    mage:     u(4, 3, 3, 1, "reach"),
    troll:    u(5, 7, 3, 1, "guard"),
    golem:    u(5, 9, 2, 1),
    dragon:   u(6, 7, 4, 2, "climb"),
    // spells
    spark: s(2),     // 2 damage to an enemy unit
    rally: s(2),     // +1 Attack to your units this turn
    recall: s(1),    // one of your units back to your hand
    mend: s(1),      // heal one of your units by 3
    haste: s(1),     // one of your units may move and attack again
    quake: s(2),     // a tile back to plain ground
    storm: s(4),     // 1 damage to every enemy unit
    fortify: s(2),   // your Keep +3 Health (at most 15)
    // tiles
    wood: tl(1),     // cover: 1 less damage to the unit in it
    rock: tl(1),     // blocks (Climb passes)
    bridge: tl(1),   // on water: makes it passable
    tower: tl(2),    // +1 Attack for the unit on it
    mire: tl(1),     // a unit that enters stops, and cannot move next turn
    spring: tl(1),   // heals 1 at the end of your turn
    road: tl(1),     // +1 Move for a unit that starts on it
    pond: tl(1)      // water (Climb passes)
  };

  var DECKS = {
    iron:  [["militia", 2], ["spear", 3], ["shield", 3], ["sentinel", 2], ["knight", 2], ["xbow", 2], ["golem", 1],
            ["tower", 2], ["rock", 1], ["fortify", 1], ["mend", 1]],
    thorn: [["militia", 2], ["archer", 3], ["healer", 2], ["druid", 2], ["wolf", 2], ["troll", 2], ["giant", 1], ["climber", 1],
            ["wood", 2], ["spring", 1], ["road", 1], ["rally", 1]],
    tide:  [["scout", 3], ["wolf", 2], ["eagle", 2], ["lancer", 2], ["knight", 2], ["climber", 1], ["archer", 1],
            ["pond", 1], ["bridge", 1], ["spear", 3], ["haste", 1], ["recall", 1]],
    ember: [["militia", 2], ["raider", 3], ["mage", 2], ["spear", 2], ["giant", 1], ["dragon", 1], ["archer", 1],
            ["spark", 2], ["storm", 1], ["rally", 2], ["quake", 1], ["haste", 1], ["mire", 1]]
  };
  var DECK_IDS = ["iron", "thorn", "tide", "ember"];

  var api = { CARDS: CARDS, DECKS: DECKS, DECK_IDS: DECK_IDS };
  root.BannerCards = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : this);
