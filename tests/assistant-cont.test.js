// Assistant: answers cut at the output limit (AS-CONT). Each Claude
// model gets its real output ceiling, a lower ceiling named by a 400 is
// read back, a cut answer drops what can't go back (half tool calls,
// unsigned thinking), and the hidden "continue" message keeps the cut
// answer's thinking and reaches every provider.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const A = require("../assistant/core.js");

test("cont: each Claude model gets its own output ceiling", () => {
  assert.equal(A.claudeMax("claude-opus-5-5"), 128000);
  assert.equal(A.claudeMax("claude-fable-5-1"), 128000);
  assert.equal(A.claudeMax("claude-sonnet-5-5"), 128000);
  assert.equal(A.claudeMax("claude-haiku-5-5"), 128000);
  assert.equal(A.claudeMax("claude-opus-4-8"), 128000);
  assert.equal(A.claudeMax("claude-sonnet-4-6"), 128000);
  assert.equal(A.claudeMax("claude-haiku-4-5"), 64000);
  assert.equal(A.claudeMax("claude-haiku-4-5-20251001"), 64000);
  assert.equal(A.claudeMax("claude-sonnet-4-5-20250929"), 64000);
  assert.equal(A.claudeMax("claude-opus-4-5"), 64000);
  assert.equal(A.claudeMax("claude-sonnet-4-20250514"), 64000);
  assert.equal(A.claudeMax("claude-opus-4-1-20250805"), 32000);
  assert.equal(A.claudeMax("claude-opus-4-20250514"), 32000);
  assert.equal(A.claudeMax("claude-3-7-sonnet-20250219"), 64000);
  assert.equal(A.claudeMax("claude-3-5-haiku-20241022"), 8192);
  assert.equal(A.claudeMax("claude-3-haiku-20240307"), 4096);
  assert.equal(A.claudeMax("something-new"), A.MAX_TOKENS);
  const req = A.buildRequest("anthropic", { key: "k", model: "claude-opus-5-5" }, [{ r: "user", text: "hi" }], {});
  assert.equal(req.body.max_tokens, 128000);
  assert.equal(req.body.stream, true);
  const low = A.buildRequest("anthropic", { key: "k", model: "claude-opus-5-5" }, [{ r: "user", text: "hi" }], { maxTokens: 50000 });
  assert.equal(low.body.max_tokens, 50000);
});

test("cont: a 400 naming a lower ceiling is read back", () => {
  const e = A.errorFrom(400, JSON.stringify({ error: { type: "invalid_request_error",
    message: "max_tokens: 128000 > 64000, which is the maximum allowed number of output tokens for claude-x" } }));
  assert.equal(A.maxTokensRefused(e), 64000);
  assert.equal(A.maxTokensRefused(A.errorFrom(400, JSON.stringify({ error: { message: "messages: bad" } }))), 0);
  assert.equal(A.maxTokensRefused(A.errorFrom(429, JSON.stringify({ error: { message: "max_tokens > 1000" } }))), 0);
});

function feed(red, evs) { evs.forEach((e) => red.push(e)); return red.result(); }

test("cont: a Claude answer cut at the limit drops a half tool call and unsigned thinking", () => {
  const r = feed(A.makeReducer("anthropic"), [
    { type: "message_start", message: { usage: { input_tokens: 5, output_tokens: 1 } } },
    { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "plan" } },
    { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig" } },
    { type: "content_block_stop", index: 0 },
    { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Part one" } },
    { type: "content_block_stop", index: 1 },
    { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "t1", name: "search_data", input: {} } },
    { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: "{\"query\": \"ab" } },
    { type: "content_block_stop", index: 2 },
    { type: "message_delta", delta: { stop_reason: "max_tokens" }, usage: { output_tokens: 9 } }
  ]);
  assert.equal(r.cut, true);
  assert.equal(r.tools.length, 0);
  assert.deepEqual(r.raw.blocks.map((b) => b.type), ["thinking", "text"]);

  const t = feed(A.makeReducer("anthropic"), [
    { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "long" } },
    { type: "message_delta", delta: { stop_reason: "max_tokens" } }
  ]);
  assert.equal(t.cut, true);
  assert.equal(t.raw.blocks.length, 0);

  // a complete call before the limit still runs
  const ok = feed(A.makeReducer("anthropic"), [
    { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t1", name: "list_apps", input: {} } },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{}" } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "max_tokens" } }
  ]);
  assert.equal(ok.tools.length, 1);
});

test("cont: an OpenAI-style answer cut at the limit drops a half tool call", () => {
  const r = feed(A.makeReducer("openai"), [
    { choices: [{ delta: { content: "Some text" } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "search_data", arguments: "{\"q" } }] } }] },
    { choices: [{ delta: {}, finish_reason: "length" }] }
  ]);
  assert.equal(r.cut, true);
  assert.equal(r.tools.length, 0);
  assert.equal(r.raw.msg.tool_calls, undefined);
  const g = feed(A.makeReducer("gemini"), [
    { candidates: [{ content: { parts: [{ text: "Half" }] }, finishReason: "MAX_TOKENS" }] }
  ]);
  assert.equal(g.cut, true);
});

test("cont: the hidden continue message keeps the cut answer's thinking and goes to every provider", () => {
  const think = { type: "thinking", thinking: "", signature: "s1" };
  const msgs = [
    { r: "user", text: "Write a long essay" },
    { r: "asst", prov: "anthropic", text: "Part one", cut: 1, raw: { prov: "anthropic", blocks: [think, { type: "text", text: "Part one" }] } },
    { r: "user", cont: 1, text: "anything" }
  ];
  const req = A.buildRequest("anthropic", { key: "k", model: "claude-opus-5-5" }, msgs, {});
  const m = req.body.messages;
  assert.equal(m.length, 3);
  assert.equal(m[1].role, "assistant");
  assert.equal(m[1].content[0].type, "thinking");
  assert.equal(m[2].role, "user");
  assert.equal(m[2].content, A.CONT_TEXT);
  // a new question afterwards: the older answer goes without thinking
  const later = msgs.concat([{ r: "asst", prov: "anthropic", text: " part two", raw: { prov: "anthropic", blocks: [{ type: "text", text: " part two" }] } },
                             { r: "user", text: "Thanks, now shorter" }]);
  const m2 = A.buildRequest("anthropic", { key: "k", model: "claude-opus-5-5" }, later, {}).body.messages;
  assert.ok(m2[1].content.every((b) => b.type !== "thinking"));

  const o = A.buildRequest("openai", { key: "k", model: "gpt-x" }, msgs, {}).body.messages;
  assert.equal(o[o.length - 1].role, "user");
  assert.equal(o[o.length - 1].content, A.CONT_TEXT);
  const g = A.buildRequest("gemini", { key: "k", model: "gemini-x" }, msgs, {}).body.contents;
  assert.equal(g[g.length - 1].role, "user");
  assert.equal(g[g.length - 1].parts[0].text, A.CONT_TEXT);
});

test("cont: the app carries a cut answer on and shows it as one", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "assistant", "assistant.js"), "utf8");
  assert.match(src, /cont: 1, text: C\.CONT_TEXT/);
  assert.match(src, /conts < C\.CONT_ROUNDS/);
  assert.match(src, /C\.maxTokensRefused\(err\)/);
  assert.match(src, /function joinedText/);
  assert.match(src, /outMax\[modelOf\(pid\)\] = lim/);
});
