// KB-RECOLOR, GL-VER, KB-ADOPT, GL-REPORT (Chris 2026-11-23, round 3 of
// the Kanban/Gate gaps from Γλαρόλυκοι, NULL JSFX, Noxpress and
// koulaxizis.gr): add_labels recolours a label the board has, every Gate
// answer names the live tool list's version, adopt_by_text gives a key to
// the one keyless card with the same text, and reports go into Claude's
// folders and open from a card's link.
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
global.window = global.window || {};
const GD = require("../gate/gate.js");
const M = require("../kanban/model.js");
let G;
test.before(async () => { G = await import("../relay/gate.js"); });

const T0 = 1760000000000, NOW = T0 + 1000;
function data(cards) {
  return M.canonState({
    ver: 5, om: 1, boardDeleted: {},
    boards: [{ id: "b1", name: "orOS", mtime: T0, om: T0, deleted: {}, labels: [{ id: "l1", name: "κρίσιμο", color: "#e06c75", mtime: T0 }],
      columns: [{ id: "c1", name: "Νέο", mtime: T0, om: T0, cards: cards || [] }, { id: "c2", name: "Έγινε", mtime: T0, om: T0, cards: [] }] }]
  }, T0);
}
let n = 0;
const nid = () => "id" + (++n);
const cardsOf = (d) => d.boards[0].columns.reduce((a, c) => a.concat(c.cards.map((k) => Object.assign({ col: c.name }, k))), []);

test("add_labels with a colour recolours a label the board has; Undo puts the old colour back", () => {
  const r = GD.kanbanWrite(M, "add_columns", data(), { board: "orOS", add_labels: [{ name: "ΚΡΙΣΙΜΟ", color: "purple" }, { name: "μέτριο", color: "yellow" }] }, NOW, nid);
  assert.equal(r.ok, true, r.err);
  const ls = r.data.boards[0].labels;
  assert.equal(ls.find((l) => l.id === "l1").color, "#6d4aff");
  assert.equal(ls.find((l) => l.id === "l1").name, "κρίσιμο");
  assert.equal(ls.length, 2);
  assert.match(r.text, /New colour for "κρίσιμο"/);
  // the same colour again, or no colour: nothing to change
  const same = GD.kanbanWrite(M, "add_columns", r.data, { board: "orOS", add_labels: [{ name: "κρίσιμο", color: "purple" }, { name: "μέτριο" }] }, NOW + 1, nid);
  assert.equal(same.ok, false);
  assert.match(same.err, /in these colours/);
  const u = GD.kanbanUndo(M, r.data, r.undo, NOW + 2);
  assert.equal(u.ok, true);
  assert.deepEqual(u.data.boards[0].labels.map((l) => [l.name, l.color]), [["κρίσιμο", "#e06c75"]]);
  // a label changed again after the change keeps its colour on Undo
  const later = clone(r.data);
  const l1 = later.boards[0].labels.find((l) => l.id === "l1");
  l1.color = "#87cf3e"; l1.mtime = NOW + 5;
  const u2 = GD.kanbanUndo(M, later, r.undo, NOW + 6);
  assert.equal(u2.data.boards[0].labels.find((l) => l.id === "l1").color, "#87cf3e");
  assert.ok(u2.kept >= 1);
});

test("adopt_by_text: the one keyless card with the same text takes the key; two are refused; Undo takes the key off", () => {
  const old = [{ id: "k1", text: "Audit #3: Λείπει το alt", mtime: T0 }, { id: "k2", text: "Άλλο", mtime: T0 }];
  const r = GD.kanbanWrite(M, "add_cards", data(old), { board: "orOS", adopt_by_text: true, cards: [{ column: "Έγινε", text: "audit #3: λειπει το ALT", key: "a-3", move: true }, { column: "Νέο", text: "Νέο εύρημα", key: "a-4" }] }, NOW, nid);
  assert.equal(r.ok, true, r.err);
  const c = cardsOf(r.data);
  assert.equal(c.length, 3);
  const k1 = c.find((x) => x.id === "k1");
  assert.equal(k1.key, "a-3");
  assert.equal(k1.col, "Έγινε");
  assert.deepEqual(r.adopted, ["k1"]);
  assert.deepEqual(r.pos[0], "k1");
  assert.match(r.text, /Gave the key to 1 card made before keys/);
  // without adopt_by_text a copy is added, as before
  const plain = GD.kanbanWrite(M, "add_cards", data(old), { board: "orOS", cards: [{ column: "Νέο", text: "Audit #3: Λείπει το alt", key: "a-3" }] }, NOW, nid);
  assert.equal(cardsOf(plain.data).length, 3);
  // two keyless twins: refused with their ids, nothing changed
  const twin = GD.kanbanWrite(M, "add_cards", data(old.concat([{ id: "k3", text: "audit #3: λείπει το alt", mtime: T0 }])), { board: "orOS", adopt_by_text: true, cards: [{ column: "Νέο", text: "Audit #3: Λείπει το alt", key: "a-3" }] }, NOW, nid);
  assert.equal(twin.ok, false);
  assert.match(twin.err, /2 cards without a key.*k1, k3.*kanban_change_card/);
  // a card that already has another key is never taken over
  const keyed = GD.kanbanWrite(M, "add_cards", data([{ id: "k1", text: "Χ", key: "other", mtime: T0 }]), { board: "orOS", adopt_by_text: true, cards: [{ column: "Νέο", text: "Χ", key: "a-9" }] }, NOW, nid);
  assert.equal(cardsOf(keyed.data).length, 2);
  assert.equal(GD.kanbanWrite(M, "add_cards", data(old), { board: "orOS", adopt_by_text: "yes", cards: [{ column: "Νέο", text: "t" }] }, NOW, nid).ok, false);
  // Undo: the key goes, the card goes back, the new card goes
  const u = GD.kanbanUndo(M, r.data, r.undo, NOW + 1);
  const back = cardsOf(u.data);
  assert.equal(back.length, 2);
  assert.equal(back.find((x) => x.id === "k1").key, undefined);
  assert.equal(back.find((x) => x.id === "k1").col, "Νέο");
});

test("the relay: adopt_by_text and recolouring need the new orOS; schemas carry them", () => {
  assert.equal(G.minVer("kanban_add_cards", { board: "b", cards: [], adopt_by_text: true }), G.KB_PREF_MV);
  assert.equal(G.minVer("kanban_add_cards", { board: "b", cards: [] }), 0);
  assert.equal(G.minVer("kanban_add_columns", { board: "b", add_labels: [{ name: "x", color: "red" }] }), G.KB_PREF_MV);
  assert.equal(G.minVer("kanban_add_columns", { board: "b", add_labels: [{ name: "x" }] }), 0);
  const t = (nm) => G.TOOLS.find((x) => x.name === nm);
  assert.equal(t("kanban_add_cards").inputSchema.properties.adopt_by_text.type, "boolean");
  assert.match(t("kanban_add_columns").inputSchema.properties.add_labels.description, /recolour/);
});

test("every answer names the live tool list's version, and gate_tools' description the loaded one", () => {
  assert.match(G.TOOLS_VER, /^[0-9a-z]{7}$/);
  assert.notEqual(G.toolsVer([{ name: "a" }]), G.toolsVer([{ name: "b" }]));
  assert.match(G.TOOLS.find((x) => x.name === "gate_tools").description, new RegExp("This list: version " + G.TOOLS_VER + "\\.$"));
  const a = G.toolText("done", false);
  assert.equal(a.content[0].text, "done");
  assert.equal(a.content[1].text, G.VER_NOTE);
  assert.match(G.VER_NOTE, new RegExp("orOS Gate tools " + G.TOOLS_VER + " .*gate_tools"));
  assert.match(G.INSTRUCTIONS, /Each answer ends with the live tool list's version/);
});

test("reports go into Claude's folders and a card's disk link opens there", () => {
  assert.match(G.INSTRUCTIONS, /files_upload \(any file\), e\.g\. Claude\/<project>\/report\.md/);
  assert.match(G.INSTRUCTIONS, /\/Claude\/<project>\/report\.md: it opens in orOS Files/);
  const src = require("fs").readFileSync(require("path").join(__dirname, "..", "kanban", "kanban.js"), "utf8");
  assert.match(src, /var p = \/\^\\\/internal\\\/\/\.test\(u\) \? u : "\/internal" \+ u;/);
});

function clone(x) { return JSON.parse(JSON.stringify(x)); }
