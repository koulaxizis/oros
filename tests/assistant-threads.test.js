// Assistant conversation history as threads (AS-THREADS, Chris 2026-11-28):
// assistant/threads.js (search, pinned, waiting cards, groups, resume)
// and core.normChat keeping the pin across devices.
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const ROOT = path.join(__dirname, "..");
const TH = require(path.join(ROOT, "assistant/threads.js"));
const C = require(path.join(ROOT, "assistant/core.js"));

const DAY = 86400000;
const NOW = new Date(2026, 10, 28, 12, 0, 0).getTime();
function chat(id, m, title, texts, extra) {
  const msgs = (texts || []).map((t, i) => ({ r: i % 2 ? "asst" : "user", text: t }));
  return Object.assign({ id, m, title, msgs, refs: {}, refN: 0 }, extra || {});
}
function cardMsg(st, k) { return { r: "tool", results: [{ name: "x", content: "{}", ui: { k: k || "entry", st } }] }; }

test("fold folds case, accents and final sigma", () => {
  assert.strictEqual(TH.fold("Ρουτίνες  ΚΑΦΈΣ"), "ρουτινεσ καφεσ");
  assert.strictEqual(TH.fold("Café"), "cafe");
  assert.strictEqual(TH.fold(null), "");
});

test("waits counts only cards nobody pressed", () => {
  const c = chat("cabcdef1", NOW, "t", ["hi"]);
  c.msgs.push(cardMsg(""), cardMsg("done"), cardMsg("", "search"), cardMsg("", "change"), cardMsg("declined"));
  assert.strictEqual(TH.waits(c), 2);
  assert.strictEqual(TH.waits(null), 0);
  assert.strictEqual(TH.waits({ msgs: "x" }), 0);
});

test("order puts pinned first, then newest", () => {
  const a = chat("caaaaaa1", NOW - 3 * DAY, "a"), b = chat("cbbbbbb1", NOW, "b"), p = chat("cpppppp1", NOW - 9 * DAY, "p", [], { pin: 1 });
  assert.deepStrictEqual(TH.order([a, b, p]).map((c) => c.id), ["cpppppp1", "cbbbbbb1", "caaaaaa1"]);
});

test("find matches every word in title or messages, accent-blind, title hits first", () => {
  const list = [
    chat("c0000001", NOW, "Λογαριασμός ρεύματος", ["πόσο πλήρωσα;"]),
    chat("c0000002", NOW - DAY, "Άλλο θέμα", ["Ο λογαριασμός του ρεύματος ήρθε 84 ευρώ τον Νοέμβριο"]),
    chat("c0000003", NOW - 2 * DAY, "Ρεύμα", ["μόνο ρεύμα"])
  ];
  const hits = TH.find(list, "λογαριασμοσ ρευματοσ");
  assert.deepStrictEqual(hits.map((h) => h.id), ["c0000001", "c0000002"]);
  assert.strictEqual(hits[0].title, 1);
  assert.ok(/λογαριασμός/.test(hits[1].snip), hits[1].snip);
  assert.deepStrictEqual(TH.find(list, "   "), []);
  assert.deepStrictEqual(TH.find(list, "ανύπαρκτο"), []);
});

test("find skips tool results (data, not the conversation)", () => {
  const c = chat("c0000009", NOW, "t", ["hello"]);
  c.msgs.push({ r: "tool", results: [{ content: "secretword" }] });
  assert.deepStrictEqual(TH.find([c], "secretword"), []);
});

test("resume is the newest conversation with messages", () => {
  const list = [chat("c1000001", NOW, "empty"), chat("c1000002", NOW - DAY, "old", ["x"]), chat("c1000003", NOW - 2 * DAY, "older", ["y"])];
  assert.strictEqual(TH.resume(list).id, "c1000002");
  assert.strictEqual(TH.resume([]), null);
});

test("groups: pinned, waiting, today, yesterday, this week, older", () => {
  const w = chat("c2000002", NOW - 20 * DAY, "w", ["x"]);
  w.msgs.push(cardMsg(""));
  const list = [
    chat("c2000001", NOW - 30 * DAY, "p", ["x"], { pin: 1 }), w,
    chat("c2000003", NOW - 60000, "t"), chat("c2000004", NOW - DAY, "y"),
    chat("c2000005", NOW - 4 * DAY, "k"), chat("c2000006", NOW - 40 * DAY, "o")
  ];
  const g = TH.groups(list, NOW);
  assert.deepStrictEqual(g.map((x) => x.key), ["pin", "wait", "today", "yday", "week", "older"]);
  assert.deepStrictEqual(g.map((x) => x.chats.length), [1, 1, 1, 1, 1, 1]);
  assert.deepStrictEqual(TH.groups([], NOW), []);
});

test("normChat keeps pin: 1 and nothing else new; the chat file carries it", () => {
  const c = chat("c3000001", NOW, "t", ["x"], { pin: 1, junk: 5 });
  const n = C.normChat(c);
  assert.strictEqual(n.pin, 1);
  assert.strictEqual(n.junk, undefined);
  assert.strictEqual(C.parseChatFile(C.chatFile(c)).pin, 1);
  assert.strictEqual(C.normChat(chat("c3000002", NOW, "t", [], { pin: true })).pin, undefined);
});

test("a newer pin wins the merge, an unpin too", () => {
  const a = chat("c4000001", NOW, "t", ["x"]);
  const b = Object.assign({}, a, { m: NOW + 1, pin: 1 });
  assert.strictEqual(C.mergeChat(a, b).chat.pin, 1);
  assert.strictEqual(C.mergeChat(a, b).copy, null);
  const c = Object.assign({}, a, { m: NOW + 2 });
  assert.strictEqual(C.mergeChat(b, c).chat.pin, undefined);
});

test("strings: every th.* key in EN, EL and DE; page loads threads.js before assistant.js", () => {
  const src = fs.readFileSync(path.join(ROOT, "assistant/assistant.js"), "utf8");
  const de = fs.readFileSync(path.join(ROOT, "i18n/de/assistant.js"), "utf8");
  const keys = Array.from(new Set(src.match(/"th\.[a-zA-Z.]+"(?=:)/g)));
  assert.ok(keys.length >= 16, "keys " + keys.length);
  keys.forEach((k) => {
    assert.strictEqual(src.split(k + ":").length - 1, 2, "EN+EL " + k);
    assert.ok(de.indexOf(k + ":") >= 0, "DE " + k);
  });
  const html = fs.readFileSync(path.join(ROOT, "assistant/index.html"), "utf8");
  assert.ok(html.indexOf("threads.js") > 0 && html.indexOf("threads.js") < html.indexOf("assistant.js?"));
});

test("a routine's conversation stands under Routines (AS-RT), unless pinned", () => {
  const NOW2 = Date.now();
  const g = TH.groups([
    { id: "crabcdef1", m: NOW2, title: "Shop check", msgs: [{ r: "user", text: "x" }], rt: "rabcdef1" },
    { id: "crabcdef2", m: NOW2, title: "Pinned routine", msgs: [], rt: "rabcdef2", pin: 1 },
    { id: "cplain001", m: NOW2, title: "Plain", msgs: [] }
  ], NOW2);
  assert.deepStrictEqual(g.map((x) => x.key + ":" + x.chats.map((c) => c.id).join(",")), ["pin:crabcdef2", "rt:crabcdef1", "today:cplain001"]);
  assert.strictEqual(C.normChat({ id: "crabcdef1", m: 1, msgs: [], rt: "rabcdef1" }).rt, "rabcdef1");
  assert.strictEqual(C.normChat({ id: "crabcdef1", m: 1, msgs: [], rt: "../x" }).rt, undefined);
});
