// orOS Gate GATE-ACT (2026-11-08): Claude changes the everyday apps
// through the Assistant's own tools, run in a hidden Assistant frame
// (assistant/assistant.js GATE). Checks: the app list the gate offers
// for changes matches what the Assistant can change, the tool texts
// say nothing about cards or presses, and the relay merges the
// device's tools safely.
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
global.window = global.window || {};
const G = require("../gate/gate.js");
const C = require("../assistant/core.js");
const N = require("../assistant/additems.js");
const N2 = require("../assistant/additems2.js");
const N3 = require("../assistant/additems3.js");
const CR = require("../assistant/create.js");
const E = require("../assistant/edits.js");
let R;
test.before(async () => { R = await import("../relay/gate.js"); });

test("ACT = the Assistant's create / change apps, less NEVER, SENSITIVE, Budget, Kanban and Files", () => {
  const all = new Set();
  const add = (id) => all.add(/^crm_/.test(id) ? "crm" : /^travel_/.test(id) ? "travel" : id);
  N.APP_IDS.forEach(add); Object.keys(N2.CORES).forEach(add); Object.keys(N3.CORES).forEach(add);
  CR.APP_IDS.forEach(add); E.APP_IDS.forEach(add);
  const want = [...all].filter((id) => G.NEVER.indexOf(id) < 0 && G.SENSITIVE.indexOf(id) < 0 && ["budget", "kanban", "files"].indexOf(id) < 0).sort();
  assert.deepEqual(G.ACT.slice().sort(), want);
  assert.ok(G.SENSITIVE.indexOf("fitness") >= 0, "Fitness is a personal app (Chris 2026-11-08), read only");
  G.ACT.forEach((id) => assert.equal(G.writable(id), true, id));
  ["passwords", "mail", "diary", "health", "mood", "cycle", "baby", "assistant", "fitness"].forEach((id) => {
    assert.equal(G.canWrite({ [id]: "write" }, 0, id, 1000), false, id);
  });
  assert.equal(G.canWrite({ todo: "write" }, 0, "todo", 1000), true);
  assert.equal(G.canWrite({ todo: "write" }, 2000, "todo", 1000), false, "paused");
  assert.equal(G.canWrite({ todo: "read" }, 0, "todo", 1000), false, "read only");
});

test("gate tools: only the gate's set, no card or press in any text", () => {
  const creates = ["todo", "calendar", "notes", "bookmarks", "contacts", "crm", "crm_activity", "crm_followup", "crm_deal",
                   "timesheet", "meals", "stickies", "habits", "plants", "petcare", "garage", "travel_plan", "travel_pack"];
  const full = C.toolsFor({ data: true, summary: true, entries: true, changes: true, creates, links: true, partnerLinks: true,
                            history: true, actions: ["timer"], web: true, rebuild: true, house: true, recipes: ["layout"], newsletter: true, cover: true, rules: true,
                            edits: { writer: { CATALOG: [] }, slides: { CATALOG: [] } } });
  const g = C.gateTools(full);
  assert.deepEqual(g.map((t) => t.name).sort(), C.GATE_TOOLS.slice().sort());
  assert.deepEqual(C.GATE_TOOLS, G.ACT_TOOLS, "gate.js and core.js name the same tools");
  const bad = [];
  JSON.stringify(g, (k, v) => { if (k === "description" && C.GATE_BAD.test(v)) bad.push(v.slice(0, 80)); return v; });
  assert.deepEqual(bad, []);
  g.forEach((t) => {
    assert.equal(t.inputSchema.type, "object", t.name);
    assert.equal(t.annotations.readOnlyHint, ["search_data", "read_item", "app_summary", "read_in_app", "change_history"].indexOf(t.name) >= 0, t.name);
  });
  assert.match(g.find((t) => t.name === "change_item").description, /paused/);
  assert.match(g.find((t) => t.name === "create_items").description, /paused/);
  G.ACT_WRITE.forEach((n) => assert.ok(G.ACT_TOOLS.indexOf(n) >= 0, n));
});

test("W5: documents and actions through the gate", () => {
  assert.deepEqual(G.DOCS.slice().sort(), Object.keys(C.EDIT_APP).sort(), "DOCS = the apps edit_in_app changes");
  G.DOCS.forEach((id) => { assert.equal(G.writable(id), true, id); assert.equal(G.NEVER.indexOf(id), -1, id); assert.ok(G.toolsOf(id).indexOf("read_in_app") >= 0, id); });
  assert.equal(G.canWrite({ writer: "write" }, 0, "writer", 1000), true);
  const guide = "WRITER COMMANDS: press the card";
  const g = C.gateTools(C.toolsFor({ data: true, history: true, changes: true, actions: ["timer", "alarm", "open", "play", "directions"],
                                     edits: { writer: { CATALOG: { text: { args: { find: { t: "str" } } } }, GUIDE: guide } } }));
  const ed = g.find((t) => t.name === "edit_in_app"), act = g.find((t) => t.name === "do_action");
  assert.ok(ed && act, "both offered");
  assert.equal(ed.description.indexOf(guide), -1, "the long guides come with read_in_app instead");
  assert.match(ed.description, /read_in_app/);
  assert.match(ed.description, /owner's screen/);
  assert.equal(ed.annotations.destructiveHint, true);
  assert.equal(act.annotations.readOnlyHint, false);
  assert.equal(act.annotations.destructiveHint, false);
  assert.match(act.description, /paused/);
  [ed, act].forEach((t) => assert.equal(C.GATE_BAD.test(t.description), false, t.name));
  assert.ok(G.ACT_WRITE.indexOf("edit_in_app") >= 0);
  assert.equal(G.ACT_WRITE.indexOf("do_action"), -1, "an action needs the window, not a change switch per app");
});

test("relay: the device's tools are cleaned and merged", () => {
  const ok = { name: "change_item", description: "x", inputSchema: { type: "object", properties: {} }, annotations: { destructiveHint: true } };
  const clean = R.cleanDevTools([
    ok,
    { name: "budget_add", description: "clash", inputSchema: { type: "object" } },
    { name: "Bad-Name", description: "x", inputSchema: { type: "object" } },
    { name: "no_schema", description: "x" },
    { name: "change_item", description: "twice", inputSchema: { type: "object" } },
    { name: "search_data", description: "richer", inputSchema: { type: "object", properties: { query: { type: "string" } } } },
    "junk"
  ]);
  assert.deepEqual(clean.map((t) => t.name), ["change_item"], "our names are never taken by a device tool");
  assert.deepEqual(clean[0].annotations, { readOnlyHint: false, destructiveHint: true });
  const ann = R.cleanDevTools([
    { name: "plain_write", description: "", inputSchema: { type: "object" } },
    { name: "safe_write", description: "", inputSchema: { type: "object" }, annotations: { destructiveHint: false } },
    { name: "just_read", description: "", inputSchema: { type: "object" }, annotations: { readOnlyHint: true, destructiveHint: true } }
  ]).map((t) => t.annotations);
  assert.deepEqual(ann, [{ readOnlyHint: false, destructiveHint: true }, { readOnlyHint: false, destructiveHint: false },
                         { readOnlyHint: true, destructiveHint: false }], "no annotations = destructive, as MCP's default");
  const big = [{ name: "huge_tool", description: "y".repeat(8000), inputSchema: { type: "object", properties: { a: { type: "string", description: "z".repeat(200000) } } } }];
  assert.deepEqual(R.cleanDevTools(big), [], "an oversized list is dropped");
  assert.equal(R.cleanDevTools(new Array(30).fill(0).map((_, i) => ({ name: "tool_" + "abcdefghijklmnopqrstuvwxyz"[i % 26] + i, description: "", inputSchema: { type: "object" } }))).length, 0,
    "names with digits are refused");
  const merged = R.withDevTools(clean);
  const names = merged.map((t) => t.name);
  assert.equal(names.filter((n) => n === "search_data").length, 1);
  assert.deepEqual(names.slice(0, R.TOOLS.length), R.TOOLS.map((t) => t.name), "ours first, unchanged");
  assert.ok(names.indexOf("change_item") === names.length - 1);
  assert.equal(R.neverIn({ app: "Passwords" }), true);
  assert.equal(R.neverIn({ apps: ["todo", "assistant"] }), true);
  assert.equal(R.neverIn({ apps: ["todo", "fitness"] }), false, "personal apps: the owner's choice on the device (5.90.00)");
  assert.equal(R.neverIn({ app: "todo" }), false);
  const G2 = require("../gate/gate.js");
  assert.deepEqual(R.NEVER_APPS.slice().sort(), G2.NEVER.slice().sort(), "relay and device never-lists match");
  assert.deepEqual(R.withDevTools([]).map((t) => t.name), R.TOOLS.map((t) => t.name));
});

test("closed orOS: the device runs only the changes the relay may queue", () => {
  const relayWrites = R.TOOLS.filter((t) => !(t.annotations && t.annotations.readOnlyHint === true)).map((t) => t.name)
    .filter((n) => n !== "budget_delete");
  assert.deepEqual(G.QUEUED.slice().sort(), relayWrites.concat(["create_items"]).sort());
  assert.ok(G.QUEUED.indexOf("budget_delete") < 0, "deletions wait for an open device");
  const src = require("fs").readFileSync(require("path").join(__dirname, "../gate/gate.js"), "utf8");
  assert.match(src, /QUEUED\.indexOf\(x\.n\) < 0\) return \{ ok: false/, "applyQueue checks the list");
});
