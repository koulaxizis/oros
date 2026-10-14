// Assistant phase 4 wave 4: optional web search (Claude's server tool),
// off by default (core.js section 3c).
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const C = require(path.join(__dirname, "..", "assistant/core.js"));

const conf = (model) => ({ key: "k", model: model || "claude-opus-5-5" });
const hi = [{ r: "user", text: "opening hours of the KEP?" }];

test("web: off by default, synced as a setting", () => {
  assert.equal(C.emptyData().set.web, 0);
  const a = C.mergeAssist({ set: { m: 5, chat: 0, prov: "anthropic", web: 1 } }, { set: { m: 3, chat: 1, prov: "openai" } });
  assert.deepEqual(a.set, { m: 5, chat: 0, prov: "anthropic", web: 1, ws: "auto", wsBase: "" });
  assert.equal(C.mergeAssist({ set: { m: 5, prov: "anthropic", web: "yes" } }, null).set.web, 1);
});

test("web: only Claude can search", () => {
  assert.equal(C.webCan("anthropic"), true);
  ["openai", "gemini", "mistral", "openrouter", "local", "browser", "nope"].forEach((p) => assert.equal(C.webCan(p), false, p));
});

test("web: the server tool is added only when asked, with a search cap", () => {
  assert.equal(C.buildRequest("anthropic", conf(), hi, {}).body.tools, undefined);
  const on = C.buildRequest("anthropic", conf(), hi, { web: true }).body.tools;
  assert.deepEqual(on, [{ type: "web_search_20260209", name: "web_search", max_uses: C.WEB_USES }]);
  const withTools = C.buildRequest("anthropic", conf(), hi, { web: true, tools: C.TOOLS }).body.tools;
  assert.equal(withTools.length, C.TOOLS.length + 1);
  assert.equal(withTools[withTools.length - 1].name, "web_search");
  assert.equal(withTools[withTools.length - 1].eager_input_streaming, undefined);
  // never for other providers
  assert.equal(C.buildRequest("openai", conf("gpt"), hi, { web: true }).body.tools, undefined);
  assert.equal(JSON.stringify(C.buildRequest("gemini", conf("g"), hi, { web: true }).body).includes("search"), false);
});

test("web: tool version follows the model", () => {
  ["claude-opus-5-5", "claude-opus-5", "claude-opus-4-8", "claude-opus-4-6", "claude-sonnet-5-5", "claude-sonnet-5", "claude-sonnet-4-6"]
    .forEach((m) => assert.equal(C.webTool(m).type, "web_search_20260209", m));
  ["claude-haiku-5-5", "claude-haiku-4-5", "claude-fable-5-1", "claude-sonnet-4-5", "claude-opus-4-5", ""]
    .forEach((m) => assert.equal(C.webTool(m).type, "web_search_20250305", m));
});

function stream(events) {
  const red = C.makeReducer("anthropic");
  events.forEach((e) => red.push(e));
  return red.result();
}
const EV = [
  { type: "message_start", message: { usage: { input_tokens: 10, output_tokens: 1 } } },
  { type: "content_block_start", index: 0, content_block: { type: "server_tool_use", id: "srv1", name: "web_search", input: {} } },
  { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{\"query\":\"KEP " } },
  { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "Athens hours\"}" } },
  { type: "content_block_stop", index: 0 },
  { type: "content_block_start", index: 1, content_block: { type: "web_search_tool_result", tool_use_id: "srv1", content: [
    { type: "web_search_result", url: "https://kep.gov.gr/a", title: "KEP A", encrypted_content: "x" },
    { type: "web_search_result", url: "javascript:alert(1)", title: "bad" }] } },
  { type: "content_block_stop", index: 1 },
  { type: "content_block_start", index: 2, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 2, delta: { type: "text_delta", text: "Open 8:00-15:00." } },
  { type: "content_block_delta", index: 2, delta: { type: "citations_delta", citation: { type: "web_search_result_location", url: "https://kep.gov.gr/a", title: "KEP A", cited_text: "8-15" } } },
  { type: "content_block_stop", index: 2 },
  { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 40, server_tool_use: { web_search_requests: 1 } } }
];

test("web: the stream keeps the search blocks, parses the query, counts searches", () => {
  const r = stream(EV);
  assert.equal(r.text, "Open 8:00-15:00.");
  assert.deepEqual(r.tools, []);                       // a server tool is not ours to run
  assert.equal(r.raw.blocks.length, 3);
  assert.deepEqual(r.raw.blocks[0].input, { query: "KEP Athens hours" });
  assert.equal(r.raw.blocks[2].citations.length, 1);
  assert.equal(r.usage.ws, 1);
  assert.equal(r.pause, false);
});

test("web: pause_turn is reported", () => {
  const r = stream([EV[0], EV[1], EV[2], EV[3], EV[4], { type: "message_delta", delta: { stop_reason: "pause_turn" } }]);
  assert.equal(r.pause, true);
  assert.equal(r.usage.ws, undefined);
});

test("web: sources are cited pages, http(s) only, deduplicated", () => {
  const r = stream(EV);
  const w = C.webSources(r.raw);
  assert.deepEqual(w.queries, ["KEP Athens hours"]);
  assert.deepEqual(w.sources, [{ url: "https://kep.gov.gr/a", title: "KEP A" }]);
  // no citation: the first pages found, still never a javascript: link
  const blocks = r.raw.blocks.slice(0, 2);
  assert.deepEqual(C.webSources({ prov: "anthropic", blocks }).sources, [{ url: "https://kep.gov.gr/a", title: "KEP A" }]);
  assert.deepEqual(C.webSources({ prov: "openai", msg: {} }), { queries: [], sources: [] });
  assert.deepEqual(C.webSources(null), { queries: [], sources: [] });
});

test("web: an answer that searched goes back natively only while search is on", () => {
  const r = stream(EV);
  const msgs = [hi[0], { r: "asst", prov: "anthropic", text: r.text, raw: r.raw }, { r: "user", text: "and on Saturday?" }];
  const on = C.buildRequest("anthropic", conf(), msgs, { web: true }).body.messages;
  assert.equal(on[1].content.length, 3);
  assert.equal(on[1].content[0].type, "server_tool_use");
  const off = C.buildRequest("anthropic", conf(), msgs, {}).body.messages;
  assert.equal(off[1].content, "Open 8:00-15:00.");
  // a plain answer stays native either way
  const plain = [hi[0], { r: "asst", prov: "anthropic", text: "x", raw: { prov: "anthropic", blocks: [{ type: "text", text: "x" }] } }, hi[0]];
  assert.deepEqual(C.buildRequest("anthropic", conf(), plain, {}).body.messages[1].content, [{ type: "text", text: "x" }]);
});

test("web: the system prompt mentions search only when it is on", () => {
  const base = { lang: "en", now: Date.UTC(2026, 9, 14), apps: [] };
  assert.ok(!/web_search/.test(C.systemPrompt(base)));
  const p = C.systemPrompt(Object.assign({ web: true }, base));
  assert.match(p, /web_search/);
  assert.match(p, /Never put the user's private orOS data/);
});
