// KB-KEY, KB-LINK, KB-LABEL, bulk sync (Chris 2026-11-23, Babyland and
// the routines' proposals 2, 3, 4, 10): a card keeps the caller's key,
// add_cards with a key brings that card up to date instead of adding it
// twice (move: true also moves it), cards carry links, and labels are
// made through the Gate. Undo puts everything back.
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
global.window = global.window || {};
const G = require("../gate/gate.js");
const M = require("../kanban/model.js");

const T0 = 1760000000000, NOW = T0 + 1000;
function data() {
  return M.canonState({
    ver: 5, om: 1, boardDeleted: {},
    boards: [{ id: "b1", name: "orOS", mtime: T0, om: T0, deleted: {}, labels: [{ id: "l1", name: "κρίσιμο", color: "#e5484d", mtime: T0 }],
      columns: [{ id: "c1", name: "Νέο", mtime: T0, om: T0, cards: [] }, { id: "c2", name: "Έγινε", mtime: T0, om: T0, cards: [] }] }]
  }, T0);
}
let n = 0;
const nid = () => "id" + (++n);
const cardsOf = (d) => d.boards[0].columns.reduce((a, c) => a.concat(c.cards.map((k) => Object.assign({ col: c.name }, k))), []);

test("a key is kept, and the same key again updates the card instead of adding it", () => {
  const r = G.kanbanWrite(M, "add_cards", data(), { board: "orOS", cards: [{ column: "Νέο", text: "Audit #1: κάτι", key: "audit-1", links: ["https://github.com/koulaxizis/oros/pull/1", { url: "/Projects/report.md", title: "Αναφορά" }] }] }, NOW, nid);
  assert.equal(r.ok, true, r.err);
  let c = cardsOf(r.data);
  assert.equal(c.length, 1);
  assert.equal(c[0].key, "audit-1");
  assert.deepEqual(c[0].links, [{ u: "https://github.com/koulaxizis/oros/pull/1" }, { u: "/Projects/report.md", t: "Αναφορά" }]);
  // the same sync again: nothing to save
  const same = G.kanbanWrite(M, "add_cards", r.data, { board: "orOS", cards: [{ column: "Νέο", text: "Audit #1: κάτι", key: "audit-1", links: ["https://github.com/koulaxizis/oros/pull/1", { url: "/Projects/report.md", title: "Αναφορά" }] }] }, NOW + 1, nid);
  assert.equal(same.ok, true, same.err);
  assert.equal(same.noop, true);
  assert.deepEqual(same.ids, [c[0].id]);
  // new text and move: true: one card, in Έγινε, stamped
  const up = G.kanbanWrite(M, "add_cards", r.data, { board: "orOS", cards: [{ column: "Έγινε", text: "Audit #1: διορθώθηκε", key: "audit-1", move: true }] }, NOW + 2, nid);
  assert.equal(up.ok, true, up.err);
  c = cardsOf(up.data);
  assert.equal(c.length, 1);
  assert.equal(c[0].col, "Έγινε");
  assert.equal(c[0].text, "Audit #1: διορθώθηκε");
  assert.deepEqual(up.updated, [c[0].id]);
  assert.match(up.text, /up to date/);
  // without move it stays where it is
  const stay = G.kanbanWrite(M, "add_cards", r.data, { board: "orOS", cards: [{ column: "Έγινε", text: "Audit #1: άλλο", key: "audit-1" }] }, NOW + 2, nid);
  assert.equal(cardsOf(stay.data)[0].col, "Νέο");
  // undo puts text and place back, the card stays
  const u = G.kanbanUndo(M, up.data, up.undo, NOW + 3);
  assert.equal(u.ok, true);
  c = cardsOf(u.data);
  assert.equal(c.length, 1);
  assert.equal(c[0].col, "Νέο");
  assert.equal(c[0].text, "Audit #1: κάτι");
});

test("the same key twice in one call makes one card", () => {
  const r = G.kanbanWrite(M, "add_cards", data(), { board: "orOS", cards: [{ column: "Νέο", text: "a", key: "k" }, { column: "Έγινε", text: "b", key: "k", move: true }] }, NOW, nid);
  assert.equal(r.ok, true, r.err);
  const c = cardsOf(r.data);
  assert.equal(c.length, 1);
  assert.deepEqual([c[0].col, c[0].text], ["Έγινε", "b"]);
  assert.match(r.text, /Added 1 card\./);
  const u = G.kanbanUndo(M, r.data, r.undo, NOW + 1);
  assert.equal(cardsOf(u.data).length, 0);
});

test("bad keys and links change nothing", () => {
  const bad = [{ key: "x".repeat(121) }, { key: 5 }, { links: ["javascript:alert(1)"] }, { links: ["data:text/html,<b>x</b>"] }, { links: ["http://example.org/"] }, { links: [{ url: "JavaScript:alert(1)" }] }, { links: ["//evil.example/x"] }, { links: ["/a/../b"] }, { links: Array.from({ length: 11 }, (v, i) => "https://x.org/" + i) }, { move: "yes" }];
  bad.forEach((extra, i) => {
    const r = G.kanbanWrite(M, "add_cards", data(), { board: "orOS", cards: [Object.assign({ column: "Νέο", text: "t" }, extra)] }, NOW, nid);
    assert.equal(r.ok, false, "case " + i);
  });
});

test("move_cards and change_card take the key; change_card sets links", () => {
  const r = G.kanbanWrite(M, "add_cards", data(), { board: "orOS", cards: [{ column: "Νέο", text: "t", key: "f-7" }] }, NOW, nid);
  const mv = G.kanbanWrite(M, "move_cards", r.data, { board: "orOS", moves: [{ card: "f-7", column: "Έγινε" }] }, NOW + 1, nid);
  assert.equal(mv.ok, true, mv.err);
  assert.equal(cardsOf(mv.data)[0].col, "Έγινε");
  const ch = G.kanbanWrite(M, "change_card", mv.data, { board: "orOS", card: "f-7", links: ["https://example.org/x"] }, NOW + 2, nid);
  assert.equal(ch.ok, true, ch.err);
  assert.deepEqual(cardsOf(ch.data)[0].links, [{ u: "https://example.org/x" }]);
  assert.equal(cardsOf(ch.data)[0].key, "f-7");
  const u = G.kanbanUndo(M, ch.data, ch.undo, NOW + 3);
  assert.equal(cardsOf(u.data)[0].links, undefined);
});

test("labels: create_labels on add_cards, add_labels on add_columns, labels on add_board; Undo removes unused ones", () => {
  const r = G.kanbanWrite(M, "add_cards", data(), { board: "orOS", create_labels: true, cards: [{ column: "Νέο", text: "t", labels: ["κρίσιμο", "Ασφάλεια"] }] }, NOW, nid);
  assert.equal(r.ok, true, r.err);
  const labs = r.data.boards[0].labels;
  assert.deepEqual(labs.map((l) => l.name).sort(), ["Ασφάλεια", "κρίσιμο"].sort());
  assert.equal(cardsOf(r.data)[0].labels.length, 2);
  assert.match(r.text, /Made 1 label/);
  // without create_labels a missing label is refused
  const no = G.kanbanWrite(M, "add_cards", data(), { board: "orOS", cards: [{ column: "Νέο", text: "t", labels: ["Ασφάλεια"] }] }, NOW, nid);
  assert.equal(no.ok, false);
  assert.match(no.err, /create_labels/);
  const u = G.kanbanUndo(M, r.data, r.undo, NOW + 1);
  assert.deepEqual(u.data.boards[0].labels.map((l) => l.name), ["κρίσιμο"]);

  const al = G.kanbanWrite(M, "add_columns", data(), { board: "orOS", add_labels: [{ name: "μέτριο", color: "yellow" }, { name: "ΚΡΙΣΙΜΟ" }] }, NOW, nid);
  assert.equal(al.ok, true, al.err);
  assert.deepEqual(al.data.boards[0].labels.map((l) => l.name).sort(), ["κρίσιμο", "μέτριο"].sort());
  assert.equal(G.kanbanWrite(M, "add_columns", data(), { board: "orOS", add_labels: [{ name: "x", color: "blue" }] }, NOW, nid).ok, false);
  assert.equal(G.kanbanUndo(M, al.data, al.undo, NOW + 1).data.boards[0].labels.length, 1);

  const nb = G.kanbanWrite(M, "add_board", data(), { name: "Γλαρόλυκοι", columns: [{ name: "Νέο" }], labels: [{ name: "Βιβλίο", color: "teal" }] }, NOW, nid);
  assert.equal(nb.ok, true, nb.err);
  assert.deepEqual(nb.data.boards.find((b) => b.name === "Γλαρόλυκοι").labels.map((l) => l.name), ["Βιβλίο"]);
});

test("only https addresses and disk paths ever reach a link button (model cleanLinks)", () => {
  const got = M.cleanLinks([{ u: "javascript:alert(1)" }, { u: "data:text/html,x" }, { u: "http://example.org/" }, { u: "vbscript:x" }, { u: " https://ok.example/a " }, { u: "/Έγγραφα/α.md" }, { u: "/a/../b" }, { u: "//evil.example/x" }]);
  assert.deepEqual(got.map((l) => l.u), ["https://ok.example/a", "/Έγγραφα/α.md"]);
  // a stored card with bad links (another device, by hand) loses them in canonState
  const d = data();
  d.boards[0].columns[0].cards.push({ id: "x1", text: "t", links: [{ u: "javascript:alert(1)" }, { u: "https://ok.example/" }], mtime: T0 });
  assert.deepEqual(M.canonState(d, T0).boards[0].columns[0].cards[0].links, [{ u: "https://ok.example/" }]);
  // the Kanban page renders and opens only through cleanLinks / https
  const src = require("fs").readFileSync(require("path").join(__dirname, "..", "kanban", "kanban.js"), "utf8");
  assert.match(src, /M\.cleanLinks\(card\.links\)\.forEach/);
  assert.match(src, /var lks = M\.cleanLinks\(card\.links\);/);
  assert.match(src, /if \(\/\^https:\\\/\\\/\/i\.test\(u\)\) \{ try \{ window\.open\(u, "_blank", "noopener,noreferrer"\)/);
});
