// ============================================================
// orOS Fieldwarden — tables (data only, v1.0.0)
// Loaded before fieldwarden/engine.js (window.FieldwardenData) and by
// Node (module.exports). Original names, numbers and rules (plan:
// /mnt/project-files/games/strategy/fieldwarden-plan.md, Bible Part IX
// "Fieldwarden").
//
// Never change the meaning of an id once released: a saved year stores
// folk, upgrades, invaders and tiles by id.
//
// FOLK      id → { hp, mv Move, tool, ups: [2 upgrade ids] }
// TOOLS     id → { tg target kind, rng reach, first, dmg, push, pull }
//   tg: line (a piece in a straight line up to rng tiles; first = only
//       the first piece, else any piece over anything),
//       adj (a piece next to the user),
//       plant (next to the user: empty dirt grows a hedge, a piece is
//       shoved)
// UPS       id → { c folk, and the change (see engine.js toolOf) }
// INVADERS  id → { hp, mv Move, fly, animal, act: what it does }
// ACTS      id → { unit: damage to a piece, field: stages a field loses,
//                  barn: damage to the barn, push: tiles the piece is
//                  pushed }  (charge has its own rule)
// FARMS     [{ id, pool: [invader ids per season 1-4], boss }]
// ============================================================
(function (root) {
  "use strict";

  var FOLK = {
    shepherd:   { hp: 3, mv: 3, tool: "crook",  ups: ["crook2", "crookFar"] },
    smith:      { hp: 4, mv: 2, tool: "hammer", ups: ["hammer3", "hammerPush"] },
    hedger:     { hp: 3, mv: 3, tool: "hedge",  ups: ["shove2", "shoveHit"] },
    beekeeper:  { hp: 3, mv: 3, tool: "swarm",  ups: ["swarmStun", "swarmFar"] },
    ferryman:   { hp: 3, mv: 3, tool: "pole",   ups: ["poleHit", "poleFar"] },
    scarecrow:  { hp: 3, mv: 4, tool: "turnip", ups: ["turnip2", "turnipArc"] }
  };
  var FOLK_IDS = Object.keys(FOLK);

  var TOOLS = {
    crook:  { tg: "line", rng: 3, first: 1, pull: 1 },
    hammer: { tg: "adj", dmg: 2, push: 1 },
    hedge:  { tg: "plant", push: 1 },
    swarm:  { tg: "line", rng: 3, first: 0, push: 2 },
    pole:   { tg: "adj", push: 1, two: 1 },
    turnip: { tg: "line", rng: 4, first: 1, dmg: 1, push: 1 }
  };

  var UPS = {
    crook2:     { c: "shepherd",  pull: 2 },
    crookFar:   { c: "shepherd",  rng: 5 },
    hammer3:    { c: "smith",     dmg: 3 },
    hammerPush: { c: "smith",     push: 2 },
    shove2:     { c: "hedger",    push: 2 },
    shoveHit:   { c: "hedger",    dmg: 1 },
    swarmStun:  { c: "beekeeper", stun: 1 },
    swarmFar:   { c: "beekeeper", rng: 5 },
    poleHit:    { c: "ferryman",  dmg: 1 },
    poleFar:    { c: "ferryman",  reach: 2 },
    turnip2:    { c: "scarecrow", dmg: 2 },
    turnipArc:  { c: "scarecrow", first: 0 }
  };

  var INVADERS = {
    wolf:    { hp: 2, mv: 3, fly: 0, animal: 1, act: "bite" },
    boar:    { hp: 3, mv: 2, fly: 0, animal: 1, act: "charge" },
    crow:    { hp: 1, mv: 4, fly: 1, animal: 1, act: "eat" },
    mole:    { hp: 2, mv: 2, fly: 0, animal: 1, act: "dig" },
    captain: { hp: 6, mv: 2, fly: 0, animal: 0, act: "club", boss: 1 }
  };

  var ACTS = {
    bite:   { unit: 1, field: 0, barn: 0, push: 0 },
    eat:    { unit: 1, field: 1, barn: 0, push: 0 },
    dig:    { unit: 1, field: 2, barn: 0, push: 0 },
    tram:   { unit: 1, field: 1, barn: 0, push: 0 },
    club:   { unit: 2, field: 1, barn: 1, push: 1 },
    charge: { unit: 2, field: 1, barn: 1, push: 0 }
  };

  // Farm 1 in W1; farms 2 and 3 (and drought, fire and the raiders)
  // follow in W2.
  var FARMS = [
    { id: "low", pool: [["wolf", "crow"], ["wolf", "crow", "boar"], ["wolf", "crow", "boar", "mole"], ["wolf", "crow", "boar", "mole"]], boss: "captain" }
  ];

  var api = { FOLK: FOLK, FOLK_IDS: FOLK_IDS, TOOLS: TOOLS, UPS: UPS, INVADERS: INVADERS, ACTS: ACTS, FARMS: FARMS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.FieldwardenData = api;
})(typeof window !== "undefined" ? window : this);
