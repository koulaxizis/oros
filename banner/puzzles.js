// ============================================================
// orOS Banner — puzzles (data only, 5.68.00)
// Twenty "win this turn" positions: Blue to play, break the red Keep
// before the turn ends (engine.js puzzleBattle reads one).
//   { map: terrain W × H (row 0 = the red home row), keep: the red Keep,
//     hand: Blue's cards, en: Blue's energy,
//     u: [[card, side (0 Blue, 1 Red), x, y]] (full Health, ready) }
// The positions were found by a search over random boards (one key
// card or keyword per puzzle, the Keep set to the most damage Blue can
// do), then picked for variety and ordered from the shortest way
// through to the longest. tests/banner.test.js solves every one.
// Order and contents never change (solved puzzles sync by number).
// ============================================================
(function (root) {
  "use strict";
  var LIST = [
    // 1: spark
    { map: "..................d......m.........", keep: 3, hand: ["spark"], en: 2,
      u: [["militia", 1, 4, 1], ["militia", 1, 2, 2], ["shield", 1, 1, 1], ["lancer", 0, 1, 2], ["golem", 0, 4, 4]] },
    // 2: rally
    { map: "....r.............w.........w......", keep: 3, hand: ["rally", "militia"], en: 2,
      u: [["wolf", 1, 3, 2], ["spear", 1, 1, 0], ["scout", 0, 2, 3]] },
    // 3: wood
    { map: "..........m.r.......w..............", keep: 3, hand: ["wood"], en: 1,
      u: [["wolf", 1, 3, 0], ["shield", 1, 1, 1], ["climber", 0, 0, 1], ["lancer", 0, 2, 3]] },
    // 4: rally
    { map: ".............................d.....", keep: 3, hand: ["rally", "raider"], en: 4,
      u: [["sentinel", 1, 0, 1], ["militia", 1, 0, 2], ["sentinel", 1, 2, 1], ["eagle", 0, 1, 3]] },
    // 5: tower
    { map: "........s.....r.............s.....r", keep: 5, hand: ["tower", "scout"], en: 2,
      u: [["spear", 1, 0, 0], ["dragon", 0, 2, 3]] },
    // 6: road
    { map: "w..........m...............d.......", keep: 3, hand: ["road", "militia"], en: 1,
      u: [["wolf", 1, 0, 2], ["knight", 1, 1, 1], ["spear", 1, 4, 1], ["mage", 0, 4, 2]] },
    // 7: reach
    { map: "..........s.......................t", keep: 5, hand: [], en: 1,
      u: [["knight", 1, 0, 2], ["giant", 1, 0, 1], ["mage", 0, 2, 1], ["eagle", 0, 2, 3]] },
    // 8: haste
    { map: "..................t................", keep: 4, hand: ["haste", "wood"], en: 1,
      u: [["wolf", 1, 4, 2], ["giant", 1, 3, 0], ["spear", 1, 3, 1], ["xbow", 0, 0, 1]] },
    // 9: bridge
    { map: ".......~.~~..~..........m..........", keep: 3, hand: ["bridge", "haste"], en: 2,
      u: [["sentinel", 1, 3, 0], ["wolf", 1, 3, 1], ["sentinel", 0, 4, 5], ["lancer", 0, 4, 3]] },
    // 10: quake
    { map: "....r...r.............d...........~", keep: 5, hand: ["quake"], en: 2,
      u: [["knight", 1, 4, 1], ["druid", 0, 2, 2], ["lancer", 0, 3, 2]] },
    // 11: wood
    { map: "........d...rw.....................", keep: 4, hand: ["wood", "haste"], en: 2,
      u: [["giant", 1, 1, 2], ["wolf", 1, 0, 0], ["raider", 0, 1, 4], ["xbow", 0, 2, 3]] },
    // 12: bridge
    { map: "r......~......~.........~~....m....", keep: 6, hand: ["bridge"], en: 1,
      u: [["spear", 1, 4, 0], ["sentinel", 1, 3, 0], ["lancer", 0, 1, 2], ["lancer", 0, 4, 1]] },
    // 13: mire
    { map: "...mm.m.~.wd..s....................", keep: 3, hand: ["road"], en: 1,
      u: [["giant", 1, 1, 2], ["troll", 1, 4, 2], ["archer", 0, 2, 2], ["scout", 0, 2, 4]] },
    // 14: climb
    { map: ".......~.~.~......r...m.~...~..r...", keep: 6, hand: ["road"], en: 1,
      u: [["troll", 1, 3, 1], ["dragon", 0, 4, 1], ["eagle", 0, 1, 4]] },
    // 15: tower
    { map: "..........d..............~.........", keep: 6, hand: ["tower", "haste"], en: 3,
      u: [["spear", 1, 4, 0], ["eagle", 0, 2, 2]] },
    // 16: road
    { map: ".......rt..........................", keep: 4, hand: ["road", "haste"], en: 2,
      u: [["golem", 1, 4, 2], ["wolf", 1, 3, 0], ["golem", 1, 3, 1], ["xbow", 0, 0, 2]] },
    // 17: haste
    { map: "......m.....r.....................d", keep: 6, hand: ["haste", "road"], en: 2,
      u: [["militia", 1, 4, 2], ["knight", 1, 1, 2], ["archer", 1, 4, 0], ["lancer", 0, 3, 3]] },
    // 18: mire
    { map: "...........s....m.........m....m...", keep: 6, hand: ["haste"], en: 1,
      u: [["troll", 1, 0, 2], ["sentinel", 1, 1, 1], ["eagle", 0, 3, 3], ["dragon", 0, 3, 4]] },
    // 19: climb
    { map: "r.......................r..r~..~.~.", keep: 6, hand: [], en: 1,
      u: [["archer", 1, 4, 1], ["sentinel", 1, 2, 2], ["eagle", 0, 3, 3], ["lancer", 0, 1, 2], ["sentinel", 0, 3, 1]] },
    // 20: reach
    { map: "............w........d.............", keep: 4, hand: ["road"], en: 1,
      u: [["troll", 1, 4, 0], ["knight", 1, 0, 0], ["xbow", 0, 3, 3], ["golem", 0, 2, 3], ["eagle", 0, 2, 4]] }
  ];
  var api = { LIST: LIST };
  root.BannerPuzzles = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : this);
