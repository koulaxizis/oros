// Assistant (assistant/core.js): the synced slice merge, permissions,
// the request each provider gets, the streamed answers, errors, model
// lists, search results and the safe Markdown subset. Plus static
// checks on assistant.js (no HTML from data) and the shell bridges.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const A = require("../assistant/core.js");

// ---------- slice merge ----------
function rnd(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
function randomData(r) {
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const d = { set: { m: Math.floor(r() * 5), chat: r() < 0.5 ? 1 : 0, prov: pick(["", "anthropic", "gemini", "bogus"]) },
              provs: {}, perm: {}, ks: { m: Math.floor(r() * 5), on: r() < 0.5 ? 1 : 0 }, keys: {} };
  ["anthropic", "openai", "local", "nope"].forEach((p) => {
    if (r() < 0.6) d.provs[p] = { m: Math.floor(r() * 5), model: pick(["a", "b", ""]), base: pick(["", "http://localhost:11434/v1/", "javascript:alert(1)"]) };
    if (r() < 0.5) d.keys[p] = { m: Math.floor(r() * 5), d: r() < 0.3 ? 1 : 0, s: pick(["", "x", "y"]) };
  });
  ["notes", "todo", "BAD ID", "calendar"].forEach((a) => {
    if (r() < 0.6) d.perm[a] = { m: Math.floor(r() * 5), v: pick(["ask", "always", "never", "maybe"]) };
  });
  return d;
}

test("merge: symmetric, idempotent, associative and canonical (fuzz)", () => {
  const r = rnd(7);
  for (let i = 0; i < 3000; i++) {
    const a = randomData(r), b = randomData(r), c = randomData(r);
    const ab = A.mergeAssist(a, b), ba = A.mergeAssist(b, a);
    assert.equal(JSON.stringify(ab), JSON.stringify(ba));
    assert.equal(JSON.stringify(A.mergeAssist(ab, ab)), JSON.stringify(ab));
    assert.equal(JSON.stringify(A.mergeAssist(ab, null)), JSON.stringify(ab));
    assert.equal(JSON.stringify(A.mergeAssist(A.mergeAssist(a, b), c)),
                 JSON.stringify(A.mergeAssist(a, A.mergeAssist(b, c))));
  }
});

test("merge: newer entry wins per key; junk is dropped", () => {
  const a = { set: { m: 5, prov: "anthropic", chat: 0 }, perm: { notes: { m: 3, v: "always" } },
              provs: { local: { m: 2, base: "http://localhost:1234/v1/", model: "x" } } };
  const b = { set: { m: 4, prov: "openai", chat: 1 }, perm: { notes: { m: 9, v: "never" }, "Bad Id": { m: 9, v: "ask" } },
              provs: { evil: { m: 9, model: "y" } } };
  const m = A.mergeAssist(a, b);
  assert.equal(m.set.prov, "anthropic");
  assert.equal(m.perm.notes.v, "never");
  assert.equal(m.perm["Bad Id"], undefined);
  assert.equal(m.provs.evil, undefined);
  assert.equal(m.provs.local.base, "http://localhost:1234/v1");
  assert.equal(A.mergeAssist({ provs: { local: { m: 1, base: "javascript:alert(1)" } } }, null).provs.local.base, "");
});

test("merge: a removed key (d = 1) carries no sealed text", () => {
  const m = A.mergeAssist({ keys: { openai: { m: 3, d: 1, s: "sealed" } } }, { keys: { openai: { m: 2, s: "old" } } });
  assert.deepEqual(m.keys.openai, { m: 3, d: 1, s: "" });
});

test("permissions: mail/passwords never offered, sensitive apps start at never", () => {
  const d = A.emptyData();
  assert.equal(A.permFor(d, { id: "mail" }), "off");
  assert.equal(A.permFor(d, { id: "passwords" }), "off");
  assert.equal(A.permFor(d, { id: "notes" }), "ask");
  assert.equal(A.permFor(d, { id: "health", sensitive: true }), "never");
  d.perm.health = { m: 1, v: "always" };
  assert.equal(A.permFor(d, { id: "health", sensitive: true }), "always");
});

// ---------- requests ----------
const TOOLS = A.TOOLS;
const histTool = [
  { r: "user", text: "When is the dentist?" },
  { r: "asst", prov: "anthropic", text: "", tools: [{ id: "tu1", name: "search_data", args: { query: "dentist" } }],
    raw: { prov: "anthropic", blocks: [{ type: "thinking", thinking: "", signature: "sig" },
                                        { type: "tool_use", id: "tu1", name: "search_data", input: { query: "dentist" } }] } },
  { r: "tool", results: [{ id: "tu1", name: "search_data", content: "{\"results\":[]}", ui: { k: "search" } }] },
  { r: "asst", prov: "anthropic", text: "Nothing found.", raw: { prov: "anthropic", blocks: [{ type: "text", text: "Nothing found." }] } },
  { r: "note", kind: "err", text: "ignored" },
  { r: "user", text: "Thanks" }
];

test("Anthropic request: browser headers, raw blocks echoed, tool results, fallbacks only where supported", () => {
  const req = A.buildRequest("anthropic", { key: "sk-x", model: "claude-opus-5-5" }, histTool, { system: "S", tools: TOOLS });
  assert.equal(req.url, "https://api.anthropic.com/v1/messages");
  assert.equal(req.headers["x-api-key"], "sk-x");
  assert.equal(req.headers["anthropic-version"], "2023-06-01");
  assert.equal(req.headers["anthropic-dangerous-direct-browser-access"], "true");
  assert.equal(req.headers["anthropic-beta"], "server-side-fallback-2026-07-01");
  assert.equal(req.body.fallbacks, "default");
  assert.equal(req.body.stream, true);
  assert.equal(req.body.system, "S");
  assert.equal(req.body.tools[0].input_schema.required[0], "query");
  const msgs = req.body.messages;
  assert.deepEqual(msgs.map((m) => m.role), ["user", "assistant", "user", "assistant", "user"]);
  assert.equal(msgs[1].content[0].signature, "sig");               // thinking block kept as is
  assert.equal(msgs[2].content[0].type, "tool_result");
  assert.equal(msgs[2].content[0].tool_use_id, "tu1");
  const old = A.buildRequest("anthropic", { key: "k", model: "claude-haiku-4-5" }, histTool, {});
  assert.equal(old.body.fallbacks, undefined);
  assert.equal(old.headers["anthropic-beta"], undefined);
  assert.equal(old.body.tools, undefined);
});

test("history: another provider's answers go back as text, without tools", () => {
  const h = A.prepHistory(histTool, "openai");
  assert.deepEqual(h.map((x) => x.r), ["user", "asst", "user"]);
  assert.equal(h[1].text, "Nothing found.");
  const req = A.buildRequest("openai", { key: "k", model: "m" }, histTool, { system: "S" });
  assert.deepEqual(req.body.messages.map((m) => m.role), ["system", "user", "assistant", "user"]);
});

test("history: a tool call cut short gets an explicit 'no result'", () => {
  const h = A.prepHistory(histTool.slice(0, 2), "anthropic");
  assert.equal(h[2].r, "tool");
  assert.equal(h[2].results[0].id, "tu1");
  assert.equal(h[2].results[0].err, 1);
});

test("OpenAI-style requests: bearer key, tools, tool messages, usage only where supported", () => {
  const hist = [
    { r: "user", text: "q" },
    { r: "asst", prov: "openai", text: "", tools: [{ id: "call_1", name: "search_data", args: { query: "x" } }],
      raw: { prov: "openai", msg: { role: "assistant", content: "", tool_calls: [{ id: "call_1", type: "function", function: { name: "search_data", arguments: "{\"query\":\"x\"}" } }] } } },
    { r: "tool", results: [{ id: "call_1", name: "search_data", content: "R" }] }
  ];
  const req = A.buildRequest("openai", { key: "sk", model: "gpt-x" }, hist, { system: "S", tools: TOOLS });
  assert.equal(req.url, "https://api.openai.com/v1/chat/completions");
  assert.equal(req.headers.authorization, "Bearer sk");
  assert.deepEqual(req.body.stream_options, { include_usage: true });
  assert.equal(req.body.tools[0].type, "function");
  assert.equal(req.body.tools[0].function.parameters.type, "object");
  const m = req.body.messages;
  assert.equal(m[2].tool_calls[0].id, "call_1");
  assert.deepEqual(m[3], { role: "tool", tool_call_id: "call_1", content: "R" });
  const mis = A.buildRequest("mistral", { key: "k", model: "x" }, hist, {});
  assert.equal(mis.url, "https://api.mistral.ai/v1/chat/completions");
  assert.equal(mis.body.stream_options, undefined);
  const loc = A.buildRequest("local", { base: "http://localhost:1234/v1/", model: "llama" }, hist, {});
  assert.equal(loc.url, "http://localhost:1234/v1/chat/completions");
  assert.equal(loc.headers.authorization, undefined);
  const def = A.buildRequest("local", { model: "llama" }, hist, {});
  assert.equal(def.url, "http://localhost:11434/v1/chat/completions");
  assert.equal(A.buildRequest("openrouter", { key: "k", model: "a/b" }, hist, {}).url, "https://openrouter.ai/api/v1/chat/completions");
});

test("Gemini request: key header, SSE url, function responses, no empty OBJECT schema", () => {
  const hist = [
    { r: "user", text: "q" },
    { r: "asst", prov: "gemini", text: "", tools: [{ id: "g0", name: "list_apps", args: {} }],
      raw: { prov: "gemini", parts: [{ functionCall: { name: "list_apps", args: {} }, thoughtSignature: "TS" }] } },
    { r: "tool", results: [{ id: "g0", name: "list_apps", content: "{}" }] },
    { r: "user", text: "more" }
  ];
  const req = A.buildRequest("gemini", { key: "gk", model: "models/gemini-x" }, hist, { system: "S", tools: TOOLS });
  assert.equal(req.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-x:streamGenerateContent?alt=sse");
  assert.equal(req.headers["x-goog-api-key"], "gk");
  assert.equal(req.body.systemInstruction.parts[0].text, "S");
  const c = req.body.contents;
  assert.deepEqual(c.map((x) => x.role), ["user", "model", "user"]);
  assert.equal(c[1].parts[0].thoughtSignature, "TS");
  assert.equal(c[2].parts[0].functionResponse.name, "list_apps");
  assert.equal(c[2].parts[1].text, "more");                         // merged into one user turn
  const decl = req.body.tools[0].functionDeclarations;
  assert.ok(decl[0].parameters);
  assert.equal(decl[1].parameters, undefined);
});

// ---------- streaming ----------
function feedAll(pid, events, chunk) {
  const red = A.makeReducer(pid);
  const sse = A.makeSSE((d) => red.push(d === "[DONE]" ? d : JSON.parse(d)));
  const text = events.map((e) => (typeof e === "string" ? e : "event: x\ndata: " + JSON.stringify(e) + "\n\n")).join("");
  for (let i = 0; i < text.length; i += chunk) sse.feed(text.slice(i, i + chunk));
  sse.end();
  return red.result();
}

test("SSE + Anthropic reducer: text, thinking signature, tool input in pieces, usage (any chunking)", () => {
  const ev = [
    { type: "message_start", message: { usage: { input_tokens: 10, cache_read_input_tokens: 5, output_tokens: 1 } } },
    { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "SIG" } },
    { type: "content_block_stop", index: 0 },
    { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Γεια " } },
    { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "σου" } },
    { type: "content_block_stop", index: 1 },
    { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "tu", name: "search_data", input: {} } },
    { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: "{\"query\":\"οδον" } },
    { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: "τίατρος\"}" } },
    { type: "content_block_stop", index: 2 },
    { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 42 } },
    { type: "message_stop" }
  ];
  for (const chunk of [1, 7, 1000]) {
    const r = feedAll("anthropic", [": ping\n\n"].concat(ev), chunk);
    assert.equal(r.text, "Γεια σου");
    assert.deepEqual(r.tools, [{ id: "tu", name: "search_data", args: { query: "οδοντίατρος" }, bad: false }]);
    assert.equal(r.raw.blocks[0].signature, "SIG");
    assert.equal(r.raw.blocks.length, 3);
    assert.deepEqual(r.usage, { i: 15, o: 42 });
    assert.equal(r.stop, "tool_use");
  }
});

test("Anthropic reducer: refusal, broken tool JSON, error event", () => {
  const r = feedAll("anthropic", [
    { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t", name: "search_data", input: {} } },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{\"query\":" } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "refusal" } }
  ], 5);
  assert.equal(r.refused, true);
  assert.equal(r.tools[0].bad, true);
  assert.throws(() => feedAll("anthropic", [{ type: "error", error: { type: "overloaded_error", message: "x" } }], 50),
    (e) => e instanceof A.ProviderError && e.code === "busy");
});

test("OpenAI reducer: content, tool calls split across chunks, usage, [DONE]", () => {
  const r = feedAll("openai", [
    { choices: [{ delta: { role: "assistant", content: "Hi" } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_9", function: { name: "search_", arguments: "{\"qu" } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "data", arguments: "ery\":\"a\"}" } }] } }] },
    { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
    { choices: [], usage: { prompt_tokens: 3, completion_tokens: 4 } },
    "data: [DONE]\n\n"
  ], 3);
  assert.equal(r.text, "Hi");
  assert.deepEqual(r.tools, [{ id: "call_9", name: "search_data", args: { query: "a" }, bad: false }]);
  assert.equal(r.raw.msg.tool_calls[0].function.arguments, "{\"query\":\"a\"}");
  assert.deepEqual(r.usage, { i: 3, o: 4 });
});

test("Gemini reducer: text, thoughts hidden, function call with id, safety", () => {
  const r = feedAll("gemini", [
    { candidates: [{ content: { role: "model", parts: [{ text: "thinking…", thought: true }, { text: "Hello" }] } }] },
    { candidates: [{ content: { role: "model", parts: [{ functionCall: { id: "fc1", name: "search_data", args: { query: "x" } } }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 2, thoughtsTokenCount: 3 } }
  ], 11);
  assert.equal(r.text, "Hello");
  assert.equal(r.tools[0].nid, "fc1");
  assert.equal(r.raw.parts.length, 3);
  assert.deepEqual(r.usage, { i: 7, o: 5 });
  assert.equal(feedAll("gemini", [{ candidates: [{ finishReason: "SAFETY" }] }], 9).refused, true);
});

// ---------- errors + models ----------
test("errors: status → code, provider message kept", () => {
  assert.equal(A.errorFrom(401, "{\"error\":{\"message\":\"invalid x-api-key\"}}").code, "key");
  assert.equal(A.errorFrom(401, "{\"error\":{\"message\":\"invalid x-api-key\"}}").msg, "invalid x-api-key");
  assert.equal(A.errorFrom(429, "").code, "rate");
  assert.equal(A.errorFrom(404, "").code, "model");
  assert.equal(A.errorFrom(400, "[{\"error\":{\"message\":\"model not found\"}}]").code, "model");
  assert.equal(A.errorFrom(400, "{\"error\":{\"message\":\"bad thing\"}}").code, "bad");
  assert.equal(A.errorFrom(529, "").code, "busy");
  assert.equal(A.errorFrom(500, "<html>oops</html>").code, "server");
});

test("model lists: chat models only, per provider format", () => {
  assert.deepEqual(A.parseModels("anthropic", { data: [{ id: "claude-opus-5-5", display_name: "Claude Opus 5.5" }] }),
    [{ id: "claude-opus-5-5", name: "Claude Opus 5.5" }]);
  assert.deepEqual(A.parseModels("openai", { data: [{ id: "gpt-x" }, { id: "text-embedding-3" }, { id: "whisper-1" }] }).map((m) => m.id), ["gpt-x"]);
  assert.deepEqual(A.parseModels("gemini", { models: [
    { name: "models/gemini-a", displayName: "Gemini A", supportedGenerationMethods: ["generateContent"] },
    { name: "models/embedding-b", supportedGenerationMethods: ["embedContent"] }] }), [{ id: "gemini-a", name: "Gemini A" }]);
  assert.equal(A.modelsRequest("local", { base: "http://127.0.0.1:8080/v1" }).url, "http://127.0.0.1:8080/v1/models");
  assert.equal(A.modelsRequest("anthropic", { key: "k" }).headers["anthropic-dangerous-direct-browser-access"], "true");
});

// ---------- search results ----------
test("search: hits packed in rank order with short text; result says what was held back", () => {
  const groups = [
    { id: "notes", hits: [{ title: "Dentist", text: "a ".repeat(400), when: new Date(2026, 9, 12).getTime(), target: { id: "n1" }, score: 5 }] },
    { id: "todo", hits: [{ title: "Call dentist", text: "", when: 0, target: { t: 1 }, score: 9 }] }
  ];
  const items = A.packHits(groups, (id) => id.toUpperCase());
  assert.deepEqual(items.map((i) => i.title), ["Call dentist", "Dentist"]);
  assert.ok(items[1].text.length <= 401);
  assert.equal(items[1].date, "2026-10-12");
  items[0].ref = "r1";
  const out = JSON.parse(A.searchResult("dentist", [items[0]], { declined: 1, blocked: ["Health"] }));
  assert.deepEqual(out.results, [{ ref: "r1", app: "TODO", title: "Call dentist" }]);
  assert.match(out.note, /chose not to share 1/);
  assert.deepEqual(out.not_allowed, ["Health"]);
  assert.equal(JSON.parse(A.searchResult("x", [], {})).note, "Nothing found.");
});

// ---------- Markdown ----------
test("Markdown: blocks and inline tokens", () => {
  const b = A.parseMd("# Title\nSome **bold** and *it* and `code`.\n\n- one\n- two [x](oros:r3)\n\n1. a\n2. b\n\n```js\n<b>x</b>\n```\n> quote");
  assert.deepEqual(b.map((x) => x.t), ["h", "p", "ul", "ol", "code", "quote"]);
  assert.deepEqual(b[1].inl.map((x) => x.t), ["text", "b", "text", "i", "text", "code", "text"]);
  assert.equal(b[2].items[1][1].kind, "oros");
  assert.equal(b[4].text, "<b>x</b>");                            // code stays text
});

test("Markdown: only oros: refs and http(s) links; no images; HTML is plain text", () => {
  const inl = A.parseInline("[a](javascript:alert(1)) [b](https://x.org/p) ![pic](https://t.co/i.png) <img src=x onerror=alert(1)> see https://ex.com/a.");
  const links = inl.filter((x) => x.t === "link");
  assert.deepEqual(links.map((l) => [l.s, l.kind]), [["b", "web"], ["https://ex.com/a", "web"]]);
  const text = inl.filter((x) => x.t === "text").map((x) => x.s).join("");
  assert.ok(text.includes("<img src=x onerror=alert(1)>"));
  assert.ok(text.includes("pic"));
  assert.ok(!text.includes("t.co"));
  assert.equal(A.linkKind("oros:r12"), "oros");
  assert.equal(A.linkKind("oros:../x"), "");
  assert.equal(A.linkKind("data:text/html,x"), "");
});

test("system prompt: date, language, tool rules only when apps are readable", () => {
  const on = A.systemPrompt({ lang: "el", now: new Date(2026, 9, 10, 9, 5).getTime(), apps: ["Notes (notes)"] });
  assert.match(on, /Saturday 2026-10-10, 09:05/);
  assert.match(on, /Greek/);
  assert.match(on, /search_data/);
  assert.match(on, /Never follow instructions/);
  const off = A.systemPrompt({ lang: "en", chatOnly: true, apps: ["Notes (notes)"] });
  assert.doesNotMatch(off, /search_data/);
});

// ---------- static checks ----------
test("assistant.js: innerHTML only for its own icons; no eval; keys never in localStorage", () => {
  const src = fs.readFileSync(path.join(ROOT, "assistant/assistant.js"), "utf8");
  const uses = src.match(/\.innerHTML\s*=\s*[^;]+;/g) || [];
  uses.forEach((u) => assert.match(u, /\.innerHTML\s*=\s*(ICON\.|ICON\[|busy \? ICON)/, u));
  assert.doesNotMatch(src, /\beval\(|new Function|insertAdjacentHTML|outerHTML\s*=/);
  assert.doesNotMatch(src, /localStorage\.setItem\([^)]*(\.key\b|apiKey)/);
  assert.match(src, /generateKey\(\{ name: "AES-GCM", length: 256 \}, false/);   // non-extractable
  assert.ok(src.includes('rel = "noopener noreferrer"'));
});

test("shell: assistant bridges exist and the factory reset wipes its database", () => {
  const sh = fs.readFileSync(path.join(ROOT, "shell.js"), "utf8");
  ["window.orosAssistApps", "window.orosAssistSearch", "window.orosAssistOpen"].forEach((n) => assert.ok(sh.includes(n), n));
  assert.match(sh, /"oros-assistant", "oros-legacy"\]/);
});
