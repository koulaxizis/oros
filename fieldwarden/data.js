// ============================================================
// orOS Fieldwarden — tables (data only, v1.1.0)
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
//                  pushed }  (charge, burn and shout have their own rules)
// FARMS     [{ id, pool: [invader ids per season 1-4], boss, wx, np, nh, ns }]
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
    captain: { hp: 6, mv: 2, fly: 0, animal: 0, act: "club", boss: 1 },
    // farm 2 and 3 (W2, 5.81.00)
    fox:     { hp: 1, mv: 4, fly: 0, animal: 1, act: "raid" },
    thief:   { hp: 2, mv: 3, fly: 0, animal: 0, act: "steal" },
    torch:   { hp: 2, mv: 2, fly: 0, animal: 0, act: "burn" },
    loud:    { hp: 2, mv: 2, fly: 0, animal: 0, act: "shout" }
  };

  var ACTS = {
    bite:   { unit: 1, field: 0, barn: 0, push: 0 },
    eat:    { unit: 1, field: 1, barn: 0, push: 0 },
    dig:    { unit: 1, field: 2, barn: 0, push: 0 },
    tram:   { unit: 1, field: 1, barn: 0, push: 0 },
    club:   { unit: 2, field: 1, barn: 1, push: 1 },
    charge: { unit: 2, field: 1, barn: 1, push: 0 },
    raid:   { unit: 1, field: 1, barn: 1, push: 0 },
    steal:  { unit: 1, field: 3, barn: 0, push: 0 },
    burn:   { unit: 1, field: 0, barn: 0, push: 0 },
    shout:  { unit: 0, field: 0, barn: 0, push: 0 }
  };

  // A farm: the invaders per season (1-4; the last season also brings
  // the boss), the weather (wx: a draw 0-19 is calm below wx[0], wind
  // below wx[1], rain below wx[2], else drought) and the tiles of a
  // layout (base + a draw of 0 or 1 each: ponds np, hedges nh,
  // haystacks ns). Farm 1 keeps its W1 numbers, so a code plays the
  // same first farm as before.
  var FARMS = [
    { id: "low", pool: [["wolf", "crow"], ["wolf", "crow", "boar"], ["wolf", "crow", "boar", "mole"], ["wolf", "crow", "boar", "mole"]],
      boss: "captain", wx: [9, 14, 20], np: 1, nh: 2, ns: 1 },
    { id: "orchard", pool: [["wolf", "crow", "fox"], ["wolf", "crow", "fox", "thief"], ["boar", "crow", "fox", "thief", "mole"], ["boar", "crow", "fox", "thief", "torch"]],
      boss: "captain", wx: [7, 12, 15], np: 1, nh: 3, ns: 2 },
    { id: "river", pool: [["wolf", "crow", "mole", "torch"], ["boar", "crow", "thief", "torch", "loud"], ["wolf", "boar", "crow", "thief", "torch", "loud"], ["wolf", "boar", "fox", "mole", "thief", "torch", "loud"]],
      boss: "captain", wx: [7, 13, 18], np: 2, nh: 2, ns: 1 }
  ];

  // PUZZLES: 30 one-turn puzzles (see engine newPuzzle), 1-10 with one
  // farmhand on the farm, 11-20 with two, 21-30 with three. Made with a
  // search over every order of the folk and every move and tool use: each
  // quota is the best result, doing nothing and the solver bot fall
  // short, and few lines reach it. Never reorder: solved numbers sync.
  var PUZZLES = [
    {"f":["shepherd","ferryman","scarecrow"],"t":"ddddddhfbfpddfdffdsdffdddffdfdddddhh","g":"000000030200020130001300021020000000","x":"000000200000000000000000000000000022","u":[["shepherd",28],["fox",31],["torch",0],["thief",9]],"w":"e","fire":[],"q":26},   // 1
    {"f":["beekeeper","shepherd","ferryman"],"t":"dhdddsdfhbddddfffdpdfffddffddddddspd","g":"000000030000001320003330013000000000","x":"020000002000000000000000000000000000","u":[["beekeeper",29],["fox",19],["crow",17],["thief",30]],"w":"d","fire":[],"q":26},   // 2
    {"f":["ferryman","smith","beekeeper"],"t":"dddshddbdffdhfffdddddffhdffffddsddpp","g":"000000000310033200000220032330000000","x":"000020000000200000000002000000000000","u":[["ferryman",22],["boar",2],["thief",19]],"w":"w","fire":[27],"q":28},   // 3
    {"f":["smith","ferryman","shepherd"],"t":"dpdddddffdfsdbffdddffhfdddfffdddsddh","g":"000000012030003300032010001210000000","x":"000000000000000000000200000000000002","u":[["smith",15],["boar",29],["torch",18],["torch",9]],"w":"n","fire":[],"q":25},   // 4
    {"f":["ferryman","smith","scarecrow"],"t":"dddddddfpdfddfffhshfdffddbdffddddhdp","g":"000000030010021200020120000230000000","x":"000000000000000020200000000000000200","u":[["ferryman",15],["mole",1],["mole",23]],"w":"s","fire":[13],"q":23},   // 5
    {"f":["beekeeper","smith","ferryman"],"t":"dsdddddfbffhddffddsffddhddffdpdddddd","g":"000000020330001100032000002300000000","x":"000000000002000000000002000000000000","u":[["beekeeper",22],["crow",30],["mole",16],["torch",31]],"w":"w","fire":[],"q":24},   // 6
    {"f":["ferryman","beekeeper","scarecrow"],"t":"sddddddfffdhdfdfdddfbpdhddfffdddhddd","g":"000000013300020200030000002310000000","x":"000000000002000000000002000000002000","u":[["ferryman",12],["boar",17],["torch",25]],"w":"c","fire":[],"q":23},   // 7
    {"f":["shepherd","beekeeper","smith"],"t":"ddhddhddsdfdddbffddsfffddffffpddpddd","g":"000000000030000120002220023120000000","x":"002002000000000000000000000000000000","u":[["shepherd",21],["mole",28],["crow",33]],"w":"c","fire":[22],"q":25},   // 8
    {"f":["beekeeper","smith","shepherd"],"t":"dddddddsfffddffhpddffbsddfdffdddddhd","g":"000000003210012000023000020320000000","x":"000000000000000200000000000000000020","u":[["beekeeper",11],["fox",18],["thief",6]],"w":"r","fire":[],"q":29},   // 9
    {"f":["beekeeper","shepherd","ferryman"],"t":"dsdddddffffhdfdffphfdbfhpddffddddddd","g":"000000022120030230020010000210000000","x":"000000000002000000200002000000000000","u":[["beekeeper",32],["loud",9],["loud",10],["boar",30]],"w":"s","fire":[],"q":31},   // 10
    {"f":["beekeeper","ferryman","smith"],"t":"dsddpddbffddddfffdddddfddfffddhdhhdd","g":"000000002200002130000030031300000000","x":"000000000000000000000000000000202200","u":[["beekeeper",15],["ferryman",35],["torch",11],["mole",3]],"w":"d","fire":[8],"q":24},   // 11
    {"f":["beekeeper","ferryman","shepherd"],"t":"pdhddddfdfddddbffdddfdfddfffdhddsddd","g":"000000020300000220002020023100000000","x":"002000000000000000000000000002000000","u":[["beekeeper",26],["ferryman",16],["thief",31],["loud",6]],"w":"s","fire":[27],"q":27},   // 12
    {"f":["smith","hedger","ferryman"],"t":"sddddddffdfsdfbffdhfffddpfdfddhddddd","g":"000000033010010210033100030200000000","x":"000000000000000000200000000000200000","u":[["smith",2],["hedger",13],["boar",35],["loud",7]],"w":"r","fire":[],"q":29},   // 13
    {"f":["smith","shepherd","scarecrow"],"t":"hdddhddffdfdddpfdddfffdddfbffdddddds","g":"000000011020000200012300020220000000","x":"200020000000000000000000000000000000","u":[["smith",27],["shepherd",28],["boar",5],["torch",9],["fox",12],["fox",29]],"w":"s","fire":[],"q":26},   // 14
    {"f":["scarecrow","ferryman","beekeeper"],"t":"hdddhddfffdddfhdfdsdbffddfddfpdddddd","g":"000000022300030020000120020030000000","x":"200020000000002000000000000000000000","u":[["scarecrow",1],["ferryman",5],["torch",35],["crow",25],["wolf",33],["thief",13]],"w":"c","fire":[22],"q":23},   // 15
    {"f":["smith","beekeeper","shepherd"],"t":"hddddsdfbfdddffdfddfdpdddffdfhdddddd","g":"000000030300013020030000033010000000","x":"200000000000000000000000000002000000","u":[["smith",16],["beekeeper",33],["mole",3],["boar",19],["loud",27],["crow",12]],"w":"e","fire":[],"q":25},   // 16
    {"f":["beekeeper","smith","ferryman"],"t":"dpddhddffffddfbffddffdfddfpdddsddddh","g":"000000032230020120013010020000000000","x":"000020000000000000000000000000000002","u":[["beekeeper",20],["smith",19],["boar",22],["wolf",32],["wolf",12],["torch",17]],"w":"r","fire":[],"q":30},   // 17
    {"f":["shepherd","beekeeper","hedger"],"t":"shddddhpbffdddhffddfffdddffdfdpddddd","g":"000000000320000130023100033030000000","x":"020000200000002000000000000000000000","u":[["shepherd",23],["beekeeper",5],["crow",20],["loud",19],["thief",11]],"w":"r","fire":[28],"q":29},   // 18
    {"f":["ferryman","beekeeper","smith"],"t":"ddddsdddfdfdddffbhdfffhdddffdddhddpd","g":"000000001020003100032300002300000000","x":"000000000000000002000020000000020000","u":[["ferryman",6],["beekeeper",18],["fox",30],["loud",3],["fox",9]],"w":"w","fire":[],"q":27},   // 19
    {"f":["beekeeper","ferryman","smith"],"t":"hddddddffffddffdbdpfffddhdfdfsdddddd","g":"000000022220013000032300001030000000","x":"200000000000000000000000200000000000","u":[["beekeeper",20],["ferryman",15],["wolf",30],["captain",23],["thief",35]],"w":"c","fire":[],"q":32},   // 20
    {"f":["shepherd","smith","ferryman"],"t":"dddhddsdffdddfbffddhfffddfddddddppdd","g":"000000001200030320003230030000000000","x":"000200000000000000020000000000000000","u":[["shepherd",24],["smith",12],["ferryman",34],["thief",4],["loud",22]],"w":"e","fire":[8],"q":24},   // 21
    {"f":["scarecrow","smith","hedger"],"t":"phddhddffddddffbfddfdfddddfffddsdddd","g":"000000023000023010030200002220000000","x":"020020000000000000000000000000000000","u":[["scarecrow",19],["smith",10],["hedger",33],["wolf",25],["thief",32],["boar",6],["wolf",24],["fox",5]],"w":"w","fire":[13],"q":27},   // 22
    {"f":["ferryman","scarecrow","smith"],"t":"dddddddddfbddfffdphfffdsdffdfhdhdddd","g":"000000000200023200022200021010000000","x":"000000000000000000200000000002020000","u":[["ferryman",4],["scarecrow",3],["smith",25],["thief",16],["wolf",19],["boar",20],["fox",1]],"w":"d","fire":[13],"q":26},   // 23
    {"f":["hedger","beekeeper","smith"],"t":"dddddddfsffddfffbddfffdpdfdhfhdhdddd","g":"000000030210022200023300010020000000","x":"000000000000000000000000000202020000","u":[["hedger",25],["beekeeper",18],["smith",6],["boar",19],["mole",12]],"w":"r","fire":[28],"q":32},   // 24
    {"f":["beekeeper","hedger","smith"],"t":"ddsddddbfdfdddffdhdffffddffhfddhddps","g":"000000002030001200023230011030000000","x":"000000000000000002000000000200020000","u":[["beekeeper",19],["hedger",13],["smith",5],["crow",33],["thief",6],["crow",22],["crow",11],["loud",1]],"w":"c","fire":[],"q":31},   // 25
    {"f":["smith","shepherd","hedger"],"t":"dddddddfdfbddfffdhdffdfpsffhfddddddd","g":"000000030200031100033030022020000000","x":"000000000000000002000000000200000000","u":[["smith",18],["shepherd",25],["hedger",15],["boar",5],["thief",34],["wolf",33]],"w":"w","fire":[15],"q":29},   // 26
    {"f":["smith","hedger","beekeeper"],"t":"ddddddpfffdddfffpsdbffdddffhfdhddddd","g":"000000022300012300003300022030000000","x":"000000000000000000000000000200200000","u":[["smith",2],["hedger",14],["beekeeper",1],["wolf",8],["mole",5],["crow",24],["boar",0],["torch",4]],"w":"e","fire":[],"q":33},   // 27
    {"f":["ferryman","beekeeper","scarecrow"],"t":"ddddhdpfhffddbdfdddffsfdhfdfdddddddp","g":"000000030230000300022020030100000000","x":"000020002000000000000000200000000000","u":[["ferryman",30],["beekeeper",25],["scarecrow",2],["crow",0],["torch",26],["torch",3],["loud",5],["crow",27]],"w":"e","fire":[],"q":26},   // 28
    {"f":["beekeeper","ferryman","shepherd"],"t":"ddddddshfbddpffdfddfdddpdffffhdddddd","g":"000000003000023030010000031120000000","x":"000000020000000000000000000002000000","u":[["beekeeper",8],["ferryman",35],["shepherd",19],["boar",3],["mole",16],["wolf",33],["thief",2],["boar",15]],"w":"w","fire":[],"q":26},   // 29
    {"f":["beekeeper","hedger","ferryman"],"t":"sdddddddbfpddfdffddffdfhdfffdhhddddd","g":"000000000200020310022010033100000000","x":"000000000000000000000002000002200000","u":[["beekeeper",13],["hedger",35],["ferryman",27],["thief",24],["wolf",31],["boar",16],["boar",32]],"w":"e","fire":[20],"q":26}   // 30
  ];

  var api = { FOLK: FOLK, FOLK_IDS: FOLK_IDS, TOOLS: TOOLS, UPS: UPS, INVADERS: INVADERS, ACTS: ACTS, FARMS: FARMS, PUZZLES: PUZZLES };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.FieldwardenData = api;
})(typeof window !== "undefined" ? window : this);
