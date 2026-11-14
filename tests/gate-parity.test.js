// GATE-PAR (2026-11-08, Chris: "what Claude can do through the Gate,
// the Assistant can do too, and the other way round; their abilities
// grow together"). Every tool on either side is either on the other
// side under the same name, or has its twin there, or a written reason
// why it cannot be. A tool added on one side only fails here until the
// other side has it (or this table says why not). OROS_BIBLE.md GATE-PAR.
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
global.window = global.window || {};
const C = require("../assistant/core.js");
let R;
test.before(async () => { R = await import("../relay/gate.js"); });

// Every Assistant tool (all options on).
function assistantTools() {
  return C.toolsFor({ data: 1, summary: 1, entries: 1, openFile: 1, rebuild: 1, house: 1, changes: 1, creates: ["todo"], links: 1,
                      partnerLinks: 1, actions: ["timer"], history: 1, edits: { writer: 1 }, recipes: ["layout"], newsletter: 1,
                      cover: 1, rules: 1, web: 1, lines: ["budget", "invoices", "stock", "publish"], kbCols: 1, files: "write" });
}

// A tool on one side only: { twin: [tools on the other side that do the
// same] } or { why: "the reason it cannot be there" }.
const GATE_ONLY = {
  budget_add: { twin: ["create_items"] },          // create_items app budget
  budget_change: { twin: ["change_item"] },
  budget_delete: { twin: ["change_item"] },        // change_item action delete
  budget_areas: { why: "Areas are Budget's own settings (words, invoice series, shares of shared costs) that Claude keeps in order from outside; inside orOS the owner sets them in Budget › Areas." },
  budget_categories: { why: "Categories with their areas are Budget's own settings that Claude keeps in order from outside (like budget_areas); inside orOS the owner sets them in Budget › Categories." },
  budget_balances: { why: "Matching several accounts to the bank's real balances on a day is a daily check Claude runs from outside; inside orOS the owner does it per account with Update balance or Match." },
  budget_transfer: { why: "Turning entries into a transfer replaces them with an item of another collection in one undoable step; inside orOS the owner does it from the entry (It's a transfer)." },
  kanban_add_cards: { twin: ["create_items"] },    // create_items app kanban
  kanban_move_cards: { twin: ["change_item"] },    // change_item action move
  kanban_change_card: { twin: ["change_item"] },
  // GATE-FILES F2: the Assistant runs on the device and reads the live disk (files_read); a download link is for a cloud thread with orOS closed
  files_link: { why: "A one-time download link from the owner's sealed copy is for Claude working from outside with orOS closed; the Assistant runs on the device and reads the live file with files_read." }
};
const ASSISTANT_ONLY = {
  web_search: { why: "Claude has its own web search; the gate reads and changes orOS, not the web." },
  read_page: { why: "Claude reads pages with its own tools." },
  open_file: { why: "It opens a file attached to the Assistant's conversation; a gate call has no attachments (a file on the orOS disk opens with do_action open)." }
};

test("every gate tool is the Assistant's too, or has its twin there", () => {
  const as = new Set(assistantTools().map((t) => t.name));
  const gate = new Set(R.TOOLS.map((t) => t.name).concat(C.GATE_TOOLS));
  for (const n of gate) {
    if (as.has(n)) { assert.equal(GATE_ONLY[n], undefined, n + " is on both sides: drop it from GATE_ONLY"); continue; }
    const e = GATE_ONLY[n];
    assert.ok(e, "gate tool " + n + " has no Assistant twin: give the Assistant the same, or list it in GATE_ONLY with its twin or why");
    if (e.twin) e.twin.forEach((x) => assert.ok(as.has(x), n + ": twin " + x + " is not an Assistant tool"));
    else assert.ok(typeof e.why === "string" && e.why.length > 20, n + ": say why");
  }
  Object.keys(GATE_ONLY).forEach((n) => assert.ok(gate.has(n), "GATE_ONLY names " + n + ", which the gate does not have"));
});

test("every Assistant tool is the gate's too, or says why not", () => {
  const gate = new Set(R.TOOLS.map((t) => t.name).concat(C.GATE_TOOLS));
  const as = assistantTools().map((t) => t.name);
  for (const n of as) {
    if (gate.has(n)) { assert.equal(ASSISTANT_ONLY[n], undefined, n + " is on both sides: drop it from ASSISTANT_ONLY"); continue; }
    const e = ASSISTANT_ONLY[n];
    assert.ok(e, "Assistant tool " + n + " is not offered through the gate: add it to the gate (C.GATE_TOOLS), or list it in ASSISTANT_ONLY with why");
    assert.ok(typeof e.why === "string" && e.why.length > 20, n + ": say why");
  }
  Object.keys(ASSISTANT_ONLY).forEach((n) => assert.ok(as.indexOf(n) >= 0, "ASSISTANT_ONLY names " + n + ", which the Assistant does not have"));
});

test("a tool both sides have takes the same arguments", () => {
  const rel = {};
  R.TOOLS.forEach((t) => { rel[t.name] = t; });
  assistantTools().forEach((t) => {
    const r = rel[t.name];
    if (!r || t.name === "list_apps" || t.name === "search_data" || t.name === "app_summary" || t.name === "read_item") return;   // the relay's own readers of the device's search
    const a = t.params || {}, b = r.inputSchema || {};
    assert.deepEqual(Object.keys(a.properties || {}).sort(), Object.keys(b.properties || {}).sort(), t.name + ": the same argument names");
    assert.deepEqual((a.required || []).slice().sort(), (b.required || []).slice().sort(), t.name + ": the same required arguments");
    Object.keys(a.properties || {}).forEach((k) => {
      assert.equal(a.properties[k].type, b.properties[k].type, t.name + "." + k + ": the same type");
      assert.deepEqual(a.properties[k]["enum"], b.properties[k]["enum"], t.name + "." + k + ": the same values");
    });
  });
});

test("the Assistant's list tools run the gate's own cores", () => {
  const src = require("fs").readFileSync(require("path").join(__dirname, "../assistant/assistant.js"), "utf8");
  ["budgetLines", "invoiceList", "stockItems", "publishTitles", "kanbanWrite", "kanbanUndo"].forEach((f) => {
    assert.match(src, new RegExp("G\\." + f + "\\("), f);
  });
  assert.deepEqual(Object.keys(C.TOOL_LINE).map((k) => C.TOOL_LINE[k].name).sort(),
                   ["budget_lines", "invoice_list", "publish_titles", "stock_items"]);
});

test("the relay takes the device's whole tool list", () => {
  const t = C.gateTools(C.toolsFor({ data: 1, summary: 1, entries: 1, rebuild: 1, house: 1, changes: 1, creates: ["todo", "calendar", "notes"],
    links: 1, partnerLinks: 1, actions: ["timer", "open"], history: 1, edits: { writer: { CATALOG: {} } }, recipes: ["layout", "atelier"],
    newsletter: 1, cover: 1, rules: 1 }));
  const own = new Set(R.TOOLS.map((x) => x.name));
  assert.deepEqual(R.cleanDevTools(t).map((x) => x.name), t.map((x) => x.name).filter((n) => !own.has(n)), "none dropped (the relay keeps its own search_data, app_summary, read_item)");
  t.forEach((x) => assert.ok(x.description.length <= 8000, x.name + ": the relay cuts descriptions at 8000"));
  assert.ok(C.GATE_TOOLS.length <= R.DEV_TOOLS_MAX, "DEV_TOOLS_MAX holds every gate tool");
});
