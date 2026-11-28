// FOLDER-WAIT, KB-LABSUM, GATE-WHO (Chris 2026-11-23, round 4 of the
// Kanban/Gate gaps from koulaxizis.gr): a folder question that waits shows
// in waiting_changes and change_history and stays as a notice in orOS; a
// label-only kanban_add_columns says which labels; every answer with orOS
// closed names the gate and when (and from which device) an orOS last
// reached it.
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), path = require("path");
let G;
test.before(async () => { G = await import("../relay/gate.js"); });
const T = 1763900000000;

test("a waiting folder question is listed, with what it asks", () => {
  const rows = [{ id: "ZHBqUjkpqqchugl_", n: "claude_folders_request", a: G.pendHead("claude_folders_request", { path: "Claude/Koulaxizis", access: "write" }, T).a, t: T, s: 1 },
                { id: "aaaaaaaaaaaaaaaa", n: "local_folders_request", a: G.pendHead("local_folders_request", { path: "C:\\Work\\x" }, T).a, t: T + 1, s: 2 }];
  const pend = G.pendingOf(rows, []);
  assert.deepEqual(pend.changes.map((c) => c.app), ["files", "files"]);
  assert.equal(pend.changes[0].sum, "asks the owner to open Claude/Koulaxizis for Claude (read and write)");
  assert.match(pend.changes[1].sum, /on the computer for Claude$/);
  // change_history (no app) and an answer about files carry them; Kanban does not
  assert.match(G.pendNote(pend, null), /"tool":"claude_folders_request"/);
  assert.match(G.pendNote(pend, ["files"]), /ZHBqUjkpqqchugl_/);
  assert.equal(G.pendNote(pend, ["kanban"]), "");
  // a row queued before the summary (header without one) still shows
  const old = G.pendingOf([{ id: "h4JHDUiImtbuAmij", n: "claude_folders_request", a: { refs: [] }, t: T, s: 3 }], []);
  assert.match(G.pendNote(old, null), /h4JHDUiImtbuAmij/);
  // with orOS open: change_history gets the questions still waiting
  const w = G.folderWaitNote(pend);
  assert.match(w, /Questions waiting for the owner's answer on an orOS screen/);
  assert.equal(JSON.parse(w.split("\n").pop()).waiting_questions.length, 2);
  assert.equal(G.folderWaitNote(G.pendingOf([{ id: "bbbbbbbbbbbbbbbb", n: "kanban_add_cards", a: {}, t: T }], [])), "");
});

test("a label-only kanban_add_columns says which labels", () => {
  assert.equal(G.pendSum("kanban_add_columns", { board: "Koulaxizis", add_labels: [{ name: "κρίσιμο", color: "red" }, { name: "μέτριο" }] }), "labels on Koulaxizis: κρίσιμο (red); μέτριο");
  assert.equal(G.pendSum("kanban_add_columns", { board: "B", columns: [{ name: "Νέο" }], add_labels: [{ name: "x" }] }), "columns on B: add Νέο, labels x");
});

test("every answer with orOS closed names the gate and the last device", () => {
  const w = G.closedWho("Ab12Cd34", T - 96 * 60000, "Windows", T);
  assert.match(w, /^\[orOS Gate Ab12Cd: an orOS last reached this gate .* old, from Windows\./);
  assert.match(w, /Settings › Connected services › orOS Gate/);
  assert.match(G.closedWho("", 0, "", T), /^\[orOS Gate \?: no orOS has reached this gate yet/);
  assert.doesNotMatch(G.closedWho("x", T - 1000, "a]b\n[c", T), /a\]b|\n/);
  const src = fs.readFileSync(path.join(__dirname, "..", "relay", "gate.js"), "utf8");
  assert.match(src, /ans\.who = closedWho\(gid, m\.seen \|\| 0, box\.dv \|\| ""/);
  // the copy is opened once on the closed path: no second readCopy for dv
  assert.match(src, /if \(box && cp && typeof cp\.dv === "string"\) box\.dv = cp\.dv;/);
  assert.doesNotMatch(src, /const cpw = /);
  const a = G.toolText("{}", false, w);
  assert.deepEqual(a.content.map((x) => x.text), ["{}", w, G.VER_NOTE]);
  assert.equal(G.toolText("x", false).content.length, 2);
  const dev = fs.readFileSync(path.join(__dirname, "..", "gate", "gate.js"), "utf8");
  assert.match(dev, /ans: ans, dv: devName\(\) \}\)\)/);
});

test("the device keeps an unanswered folder question as a notice", () => {
  const dev = fs.readFileSync(path.join(__dirname, "..", "gate", "gate.js"), "utf8");
  assert.match(dev, /askNotice\("disk", CF\.show\(path\), how\)/);
  assert.match(dev, /deepLink: "gate:asks", ttlDays: 30/);
  const T1 = fs.readFileSync(path.join(__dirname, "..", "translations.js"), "utf8");
  assert.equal((T1.match(/"gate\.ask\.noteBody":/g) || []).length, 2);
  assert.match(fs.readFileSync(path.join(__dirname, "..", "i18n", "de", "shell.js"), "utf8"), /"gate\.ask\.noteBody":/);
});
