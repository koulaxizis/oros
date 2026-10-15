// Assistant: "Import conversations" (assistant/import.js) — the data
// export of ChatGPT (conversations.json with a mapping tree: the
// branch from current_node up, user / assistant text only) and of
// Claude (chat_messages), zipped or not, become the Assistant's own
// chat records with stable ids ("cimp…", core.js CHAT_ID), so the
// same export imported twice adds nothing. Also: caps, odd input,
// plan counts / date range / "already here", and that the text is
// drawn through the safe Markdown subset (no HTML ever).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const I = require(path.join(ROOT, "assistant/import.js"));
const Z = require(path.join(ROOT, "atelier/zip.js"));
const C = require(path.join(ROOT, "assistant/core.js"));
const enc = (s) => new TextEncoder().encode(s);

// ChatGPT: a tree with an edited prompt (two branches), a system
// message, a tool call and its output, a hidden message, a picture.
function gptExport() {
  const msg = (id, role, parts, t, extra) => ({ id, message: Object.assign({ id, author: { role }, create_time: t,
    content: { content_type: "text", parts } }, extra || {}), parent: null, children: [] });
  const m = {
    root: { id: "root", message: null, parent: null, children: ["sys"] },
    sys: msg("sys", "system", [""], 1700000000, { metadata: { is_visually_hidden_from_conversation: true } }),
    u1: msg("u1", "user", ["Γεια σου <script>alert(1)</script>"], 1700000010),
    u1b: msg("u1b", "user", ["first try (edited away)"], 1700000005),
    a1b: msg("a1b", "assistant", ["old answer"], 1700000006),
    a1: msg("a1", "assistant", ["Γεια! **Τι** κάνεις;"], 1700000020),
    tc: msg("tc", "assistant", ["search('x')"], 1700000030, { recipient: "browser", content: { content_type: "code", text: "search('x')" } }),
    tr: msg("tr", "tool", ["result"], 1700000031),
    u2: msg("u2", "user", [{ content_type: "image_asset_pointer", asset_pointer: "file-service://x" }, "τι δείχνει;"], 1700000040,
      { content: { content_type: "multimodal_text", parts: [{ content_type: "image_asset_pointer", asset_pointer: "file-service://x" }, "τι δείχνει;"] } }),
    a2: msg("a2", "assistant", ["Μια γάτα."], 1700000050),
    a2b: msg("a2b", "assistant", ["και ένα σκύλο."], 1700000051)
  };
  const link = (p, c) => { m[c].parent = p; m[p].children.push(c); };
  link("root", "sys"); m.root.children = ["sys"];
  link("sys", "u1b"); link("u1b", "a1b");
  link("sys", "u1"); link("u1", "a1"); link("a1", "tc"); link("tc", "tr"); link("tr", "u2"); link("u2", "a2"); link("a2", "a2b");
  return [
    { id: "conv-1", title: "Χαιρετισμός", create_time: 1700000000.5, update_time: 1700000051.2, mapping: m, current_node: "a2b" },
    { id: "conv-2", title: "", create_time: 1600000000, update_time: 1600000100, current_node: "x",
      mapping: { x: { id: "x", message: { author: { role: "user" }, content: { content_type: "text", parts: ["μόνο ερώτηση"] }, create_time: 1600000000 }, parent: null, children: [] } } },
    { id: "conv-3", title: "άδειο", create_time: 1600000000, mapping: { r: { id: "r", message: null, parent: null, children: [] } }, current_node: "r" }
  ];
}
function claudeExport() {
  return [
    { uuid: "11111111-aaaa", name: "Συνταγή", created_at: "2025-03-01T10:00:00.000Z", updated_at: "2025-03-02T09:30:00.000Z",
      chat_messages: [
        { sender: "human", text: "ignored when content is there", content: [{ type: "text", text: "Πώς φτιάχνω φακές;" }],
          created_at: "2025-03-01T10:00:00Z", attachments: [{ file_name: "συνταγή.txt", extracted_content: "…" }], files: [] },
        { sender: "assistant", content: [{ type: "thinking", thinking: "hmm" }, { type: "text", text: "Με **υπομονή**." },
          { type: "tool_use", name: "x", input: {} }], created_at: "2025-03-01T10:00:05Z" },
        { sender: "assistant", content: [{ type: "text", text: "Και λίγο ξύδι." }], created_at: "2025-03-01T10:00:06Z" },
        { sender: "human", text: "ευχαριστώ", content: [], created_at: "2025-03-02T09:30:00Z", files: [{ file_name: "photo.jpg" }] }
      ] },
    { uuid: "22222222-bbbb", name: "", created_at: "2024-01-05T08:00:00Z", updated_at: "2024-01-05T08:00:00Z",
      chat_messages: [{ sender: "human", text: "Hello there, a fairly long first message that becomes the title", created_at: "2024-01-05T08:00:00Z" }] },
    { uuid: "33333333-cccc", name: "empty", created_at: "2024-01-05T08:00:00Z", chat_messages: [] }
  ];
}

test("import: ChatGPT export — the branch on screen, user / assistant text only", async () => {
  const zip = Z.write([{ name: "chat.html", data: "<html></html>" }, { name: "conversations.json", data: JSON.stringify(gptExport()) },
    { name: "user.json", data: "{}" }]);
  const res = await I.readBytes(zip, "export.zip");
  assert.equal(res.source, "chatgpt");
  assert.equal(res.convs.length, 2);
  assert.equal(res.skipped, 1);                         // the empty one
  const c = res.convs[0];
  assert.equal(c.title, "Χαιρετισμός");
  assert.equal(c.from, 1700000000500);
  assert.equal(c.to, 1700000051200);
  assert.deepEqual(c.msgs.map((m) => [m.r, m.text]), [
    ["user", "Γεια σου <script>alert(1)</script>"],
    ["asst", "Γεια! **Τι** κάνεις;"],
    ["user", "[image]\nτι δείχνει;"],
    ["asst", "Μια γάτα.\n\nκαι ένα σκύλο."]
  ]);
  assert.match(c.id, /^cimpg[a-z0-9]+$/);
  assert.equal(C.chatPath(c.id) !== null, true, "a valid chat id");
  // a conversation with no title gets its first words
  assert.equal(res.convs[1].title, "μόνο ερώτηση");
});

test("import: Claude export — content blocks, files, joined turns", async () => {
  const res = await I.readBytes(enc(JSON.stringify(claudeExport())), "conversations.json");
  assert.equal(res.source, "claude");
  assert.equal(res.convs.length, 2);
  const c = res.convs[0];
  assert.equal(c.title, "Συνταγή");
  assert.equal(c.from, Date.parse("2025-03-01T10:00:00Z"));
  assert.equal(c.to, Date.parse("2025-03-02T09:30:00Z"));
  assert.deepEqual(c.msgs.map((m) => [m.r, m.text]), [
    ["user", "Πώς φτιάχνω φακές;\n[file: συνταγή.txt]"],
    ["asst", "Με **υπομονή**.\n\nΚαι λίγο ξύδι."],
    ["user", "ευχαριστώ\n[file: photo.jpg]"]
  ]);
  assert.match(c.id, /^cimpc[a-z0-9]+$/);
  assert.equal(res.convs[1].title, "Hello there, a fairly long first message that becomes the ti");
});

test("import: stable ids, plan counts, date range, already here, room", async () => {
  const a = await I.readBytes(enc(JSON.stringify(claudeExport())), "c.json");
  const b = await I.readBytes(enc(JSON.stringify(claudeExport())), "c.json");
  assert.deepEqual(a.convs.map((c) => c.id), b.convs.map((c) => c.id));
  assert.notEqual(I.chatIdOf("claude", "x"), I.chatIdOf("chatgpt", "x"));
  const ids = new Set();
  for (let i = 0; i < 3000; i++) ids.add(I.chatIdOf("chatgpt", "conv-" + i));
  assert.equal(ids.size, 3000);
  const have = {};
  have[a.convs[1].id] = true;
  const p = I.plan(a, have, 10);
  assert.equal(p.stats.convs, 2);
  assert.equal(p.stats.msgs, 4);
  assert.equal(p.stats.have, 1);
  assert.equal(p.stats.fresh, 1);
  assert.equal(p.stats.from, Date.parse("2024-01-05T08:00:00Z"));
  assert.equal(p.stats.to, Date.parse("2025-03-02T09:30:00Z"));
  assert.equal(p.list[0].title, "Συνταγή");             // newest first
  assert.equal(p.list[1].have, true);
  assert.equal(p.room, 10);
});

test("import: the chat record fits the Assistant (normChat, chat file, history, Markdown)", async () => {
  const res = await I.readBytes(enc(JSON.stringify(gptExport())), "conversations.json");
  const ch = I.toChat(res.convs[0], 1700000051200);
  assert.deepEqual(C.normChat(ch), ch);
  assert.deepEqual(C.parseChatFile(C.chatFile(ch)), ch);
  assert.equal(I.sourceOf(ch), "chatgpt");
  assert.equal(I.sourceOf({ msgs: [{ r: "user", text: "x" }] }), "");
  assert.equal(ch.msgs[0].at, 1700000051200);
  // continuing it: plain text history for any provider
  const req = C.buildRequest("openai", { key: "k", model: "gpt" }, ch.msgs.concat([{ r: "user", text: "και τώρα;" }]), {});
  const roles = req.body.messages.filter((m) => m.role !== "system").map((m) => m.role);
  assert.deepEqual(roles, ["user", "assistant", "user", "assistant", "user"]);
  const ar = C.buildRequest("anthropic", { key: "k", model: "claude" }, ch.msgs.concat([{ r: "user", text: "και τώρα;" }]), {});
  assert.equal(ar.body.messages[0].content, "Γεια σου <script>alert(1)</script>");
  // drawn as tokens: the markup is text, nothing else
  const blocks = C.parseMd(ch.msgs[0].text);
  assert.equal(JSON.stringify(blocks).includes("<script>"), true);
  blocks.forEach((b) => assert.ok(["p", "h", "quote", "code", "ul", "ol"].includes(b.t)));
  (blocks[0].inl || []).forEach((t) => assert.ok(["text", "b", "i", "code", "link"].includes(t.t)));
});

test("import: caps — conversations, messages, characters", () => {
  const many = [];
  for (let i = 0; i < I.MAX_CONVS + 5; i++) {
    many.push({ uuid: "u" + i, name: "c" + i, created_at: "2024-01-01T00:00:00Z",
      chat_messages: [{ sender: "human", text: "x" + i }] });
  }
  const r = I.parseJson(many);
  assert.equal(r.convs.length, I.MAX_CONVS);
  assert.equal(r.skipped, 5);
  const long = [{ uuid: "L", name: "long", created_at: "2024-01-01T00:00:00Z", chat_messages:
    Array.from({ length: I.MAX_MSGS + 10 }, (_, k) => ({ sender: k % 2 ? "assistant" : "human", text: k === 1 ? "y".repeat(I.MAX_TEXT + 50) : "m" + k })) }];
  const lr = I.parseJson(long);
  assert.equal(lr.convs[0].msgs.length, I.MAX_MSGS);
  assert.ok(lr.convs[0].cut >= 1);
  const big = I.parseJson([{ uuid: "B", name: "b", chat_messages: [{ sender: "human", text: "z".repeat(I.MAX_TEXT + 5) }] }]);
  assert.ok(big.convs[0].msgs[0].text.length <= I.MAX_TEXT + 10);
});

test("import: odd input", async () => {
  assert.deepEqual(await I.readBytes(new Uint8Array(0), "x"), { error: "empty" });
  assert.deepEqual(await I.readBytes(enc("not json"), "x.json"), { error: "bad" });
  assert.deepEqual(await I.readBytes(enc('{"a":1}'), "x.json"), { error: "bad" });
  assert.deepEqual(await I.readBytes(enc("[]"), "x.json"), { error: "empty" });
  assert.deepEqual(await I.readBytes(enc('[{"foo":1}]'), "x.json"), { error: "bad" });
  assert.deepEqual(await I.readBytes(Z.write([{ name: "other.json", data: "[]" }]), "x.zip"), { error: "bad" });
  // a cycle in the tree and a missing current node do not hang
  const cyc = [{ id: "c", title: "t", mapping: {
    a: { message: { author: { role: "user" }, content: { content_type: "text", parts: ["α"] } }, parent: "b", children: ["b"] },
    b: { message: { author: { role: "assistant" }, content: { content_type: "text", parts: ["β"] } }, parent: "a", children: ["a"] } },
    current_node: "a" }];
  const r = I.parseJson(cyc);
  assert.equal(r.convs[0].msgs.length, 2);
  const nocur = [{ id: "n", title: "t", mapping: {
    a: { message: { author: { role: "user" }, content: { content_type: "text", parts: ["α"] }, create_time: 1 }, parent: null, children: ["b"] },
    b: { message: { author: { role: "assistant" }, content: { content_type: "text", parts: ["β"] }, create_time: 2 }, parent: "a", children: [] } } }];
  assert.deepEqual(I.parseJson(nocur).convs[0].msgs.map((m) => m.text), ["α", "β"]);
  // {conversations:[…]} wrapper
  assert.equal(I.parseJson({ conversations: claudeExport() }).source, "claude");
});
