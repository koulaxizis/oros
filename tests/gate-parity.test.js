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
  return C.toolsFor({ data: 1, summary: 1, entries: 1, openFile: 1, rebuild: 1, house: 1, epub: 1, changes: 1, creates: ["todo"], links: 1,
                      partnerLinks: 1, actions: ["timer"], history: 1, edits: { writer: 1 }, recipes: ["layout"], newsletter: 1,
                      cover: 1, rules: 1, web: 1, lines: ["budget", "invoices", "stock", "publish"], kbCols: 1, files: "write", fonts: 1 });
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
  // BK-AO (Chris 2026-11-18)
  budget_refresh: { why: "Reading the banks now is for Claude's checks from outside, before it reads budget_lines; inside orOS the owner presses Update now in Budget › More › Banks, and Budget updates by itself on its schedule." },
  budget_transfer: { why: "Turning entries into a transfer replaces them with an item of another collection in one undoable step; inside orOS the owner does it from the entry (It's a transfer)." },
  // TRAY-2 (Chris 2026-11-21)
  gate_tools: { why: "GL-5: the relay's own list of its tools as they are now, for a conversation that started before a tool was added; the Assistant always has the current list." },
  oros_update: { why: "GL-7: asks the owner's other open devices to fetch and apply the newest orOS, for Claude working from outside while the owner is away; inside orOS the owner presses Update in Settings or the app updates itself." },
  gate_call: { why: "GL-5: runs another gate tool by name for a conversation whose tool list is older; the Assistant always calls its tools directly." },
  claude_folders_request: { why: "CF-ASK: asking the owner, on any device on screen, to add a folder of the orOS disk to Claude's folders from outside; inside orOS the owner adds it in Settings › Connected services › orOS Gate › Claude's folders." },
  local_folders_request: { why: "Asking the owner, on any device on screen, to open a folder of their computer for Claude from outside; inside orOS the owner opens it in Settings › Connected services › orOS Gate." },
  kanban_add_cards: { twin: ["create_items"] },    // create_items app kanban
  kanban_move_cards: { twin: ["change_item"] },    // change_item action move
  kanban_change_card: { twin: ["change_item"] },
  // INV-EXT (Chris 2026-11-18 card «Νέο εργαλείο στο Gate»)
  invoices_record: { why: "Recording a batch of documents issued at another provider is bookkeeping import Claude does from outside (an export of that provider); inside orOS the owner records one with Invoices › New › Record an invoice issued elsewhere." },
  // GATE-FILES F2: the Assistant runs on the device and reads the live disk (files_read); a download link is for a cloud thread with orOS closed
  // ST-IMP (Chris 2026-11-21): the relay runs them as edit_in_app's create
  studio_import: { twin: ["edit_in_app"] },
  montage_import: { twin: ["edit_in_app"] },
  files_upload: { why: "GL-8: brings a file's bytes from Claude's side (outside orOS, e.g. the owner's computer folder) into the box for the next open orOS; the Assistant runs on the device and has the files themselves." },
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
  const t = C.gateTools(C.toolsFor({ data: 1, summary: 1, entries: 1, rebuild: 1, house: 1, epub: 1, changes: 1, creates: ["todo", "calendar", "notes"],
    links: 1, partnerLinks: 1, actions: ["timer", "open"], history: 1, edits: { writer: { CATALOG: {} } }, recipes: ["layout", "atelier"],
    newsletter: 1, cover: 1, rules: 1 }));
  const own = new Set(R.TOOLS.map((x) => x.name));
  assert.deepEqual(R.cleanDevTools(t).map((x) => x.name), t.map((x) => x.name).filter((n) => !own.has(n)), "none dropped (the relay keeps its own search_data, app_summary, read_item)");
  t.forEach((x) => assert.ok(x.description.length <= 8000, x.name + ": the relay cuts descriptions at 8000"));
  assert.ok(C.GATE_TOOLS.length <= R.DEV_TOOLS_MAX, "DEV_TOOLS_MAX holds every gate tool");
  // GL-9: Files at «may change» added the files_* tools and the list went
  // over the old 120 KB cap, so the relay dropped all of it
  const all = C.gateTools(C.toolsFor({ data: 1, summary: 1, fonts: 1, entries: 1, rebuild: 1, house: 1, epub: 1, changes: 1, creates: ["todo", "calendar", "notes", "crm", "contacts"],
    links: 1, partnerLinks: 1, actions: ["timer", "open"], history: 1, edits: { writer: { CATALOG: {} } }, recipes: ["layout", "atelier"],
    newsletter: 1, cover: 1, rules: 1, files: "write", lines: ["budget", "invoices", "stock", "publish"], kbCols: 1 }));
  ["files_list", "files_write", "edit_in_app", "read_in_app"].forEach((n) => assert.ok(all.some((x) => x.name === n), n + " in the full list"));
  assert.ok(all.length >= 25 && JSON.stringify(all).length > 120000, "the full list is past the old 30 / 120 KB cap");
  const cl = R.cleanDevTools(all);
  assert.deepEqual(cl.map((x) => x.name), all.map((x) => x.name).filter((n) => !own.has(n)), "every gate tool passes the relay");
  assert.ok(JSON.stringify(all).length * 2 < R.DEV_TOOLS_BYTES, "room to grow: the whole list is under half the cap");
  assert.ok(!cl.some((x) => /shortened/.test(x.description)), "nothing is shortened today");
});

// FM-7: the families of Settings › Fonts, read only, on both sides.
test("list_fonts: the Assistant's and the gate's, read only, the same filters", () => {
  const G = require("../gate/gate.js");
  const a = assistantTools().find((t) => t.name === "list_fonts");
  assert.ok(a, "the Assistant has list_fonts");
  assert.ok(C.GATE_TOOLS.indexOf("list_fonts") >= 0 && G.ACT_TOOLS.indexOf("list_fonts") >= 0, "the gate has list_fonts");
  assert.equal(G.ACT_WRITE.indexOf("list_fonts"), -1);
  assert.equal(G.ACT_OPEN.indexOf("list_fonts"), -1, "it opens no app");
  assert.deepEqual(G.ACT_OPEN, C.GATE_OPEN, "the tools that open an app are the same on both sides");
  const g = C.gateTools([a])[0];
  assert.equal(g.annotations.readOnlyHint, true);
  assert.deepEqual(Object.keys(g.inputSchema.properties).sort(), ["collection", "kind", "letters", "query", "source"]);
  assert.deepEqual(g.inputSchema.properties.letters["enum"], ["greek", "polytonic"]);
  // offered through the gate once the owner lets Claude read some app
  const src = require("fs").readFileSync(require("path").join(__dirname, "../assistant/assistant.js"), "utf8");
  assert.match(src, /summary: summaryIds\(ga\.read\)\.length > 0, fonts: ga\.read\.length > 0,/);
  assert.match(src, /if \(call\.name === "list_fonts"\) return listFonts\(call\.args\);/);
});
