// The Assistant's book-layout fixes (Chris 2026-11-27, a whole Layout
// session on «Στην καρδιά του βυθού»): Layout's card reports are kept on
// the device and taken before each turn (AS-RB2), files_read reads local
// folders and shows pictures to a model that sees (AS-SEE), links on
// words in Layout (AS-LINK), a picture's half in its frame, a paragraph a
// replacement empties goes (AS-FR), two documents of one name are never
// both changed (AS-DUP), Greek typesetting words and the justification
// advice (AS-EL), and a conversation saved as Markdown (AS-EXP).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const M = require(path.join(ROOT, "designkit/model.js"));
const CMD = require(path.join(ROOT, "layout/commands.js"));
const SH = require(path.join(ROOT, "recipes/share.js"));
const C = require(path.join(ROOT, "assistant/core.js"));
const J = (x) => JSON.stringify(x);
const clone = (x) => JSON.parse(J(x));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

function book(name, id) {
  const d = M.newDoc({ name: name || "Book", pages: 2, facing: 1 }, 1000);
  if (id) d.id = id;
  const pg = M.pagesInOrder(d);
  d.stories.push({ id: "st-a", m: 1000, paras: [
    { ps: "ps-body", runs: [{ t: "Σελ. 33: Το μπουκάλι, Β. Μ." }] },
    { ps: "ps-body", runs: [{ t: "See " }, { t: "glarolykoi.net", b: 1 }, { t: " and koulaxizis.gr today." }] },
    { ps: "ps-body", runs: [{ t: "Write to me@example.com" }] }
  ] });
  d.items.push({ id: "it-a", m: 1000, t: "text", pg: pg[0].id, x: 40, y: 40, w: 300, h: 400, story: "st-a", seq: 1, z: 1 });
  d.items.push({ id: "it-p", m: 1000, t: "img", pg: pg[1].id, x: 0, y: 0, w: 510, h: 708, a: "a".repeat(64) + ".jpg", iw: 4300, ih: 2953, fit: "fill", z: 2 });
  return M.normDoc(d);
}
function run(d, list, notes) {
  const chk = CMD.check(list);
  assert.ok(chk.ok, chk.err);
  const w = clone(d);
  let n = 0;
  chk.steps.forEach((st) => { n += CMD.apply(w, st, { now: 5000, notes: notes || [], grey: {} }); });
  return { doc: M.normDoc(w), n };
}
const texts = (d) => d.stories[0].paras.map((p) => p.runs.map((r) => r.t).join(""));

// ---------- AS-FR ----------
test("a replacement that empties a paragraph removes it, no empty line stays", () => {
  const r = run(book(), [{ op: "text", find: "Σελ. 33: Το μπουκάλι, Β. Μ.", repl: "" }]);
  assert.equal(r.n, 1);
  assert.deepEqual(texts(r.doc), ["See glarolykoi.net and koulaxizis.gr today.", "Write to me@example.com"]);
  // a word taken out of a longer paragraph keeps the paragraph
  const r2 = run(book(), [{ op: "text", find: "today", repl: "" }]);
  assert.equal(texts(r2.doc).length, 3);
  // the only paragraph of a story stays
  const d = book();
  d.stories[0].paras = [{ ps: "ps-body", runs: [{ t: "x" }] }];
  assert.equal(run(d, [{ op: "text", find: "x", repl: "" }]).doc.stories[0].paras.length, 1);
  assert.match(SH.GUIDE.layout.ops.text, /a paragraph left with nothing in it goes too/);
});

// ---------- AS-LINK ----------
test("link: the words become a link, their look stays, runs split only at the words", () => {
  const notes = [];
  const r = run(book(), [{ op: "link", find: "glarolykoi.net" }, { op: "link", find: "koulaxizis.gr" }, { op: "link", find: "me@example.com" }], notes);
  const p = r.doc.stories[0].paras;
  assert.equal(texts(r.doc).join("|"), texts(book()).join("|"), "the text is unchanged");
  const gl = p[1].runs.find((x) => x.t === "glarolykoi.net");
  assert.equal(gl.ext.href, "https://glarolykoi.net");
  assert.equal(gl.b, 1, "its bold stays");
  const ko = p[1].runs.find((x) => x.t === "koulaxizis.gr");
  assert.equal(ko.ext.href, "https://koulaxizis.gr");
  assert.ok(!p[1].runs.find((x) => x.t === " and ").ext, "the words around get no link");
  assert.equal(p[2].runs.find((x) => x.t === "me@example.com").ext.href, "mailto:me@example.com");
  assert.equal(notes.length, 0);
  // a given address; again changes nothing more
  const r2 = run(r.doc, [{ op: "link", find: "glarolykoi.net", url: "https://glarolykoi.net/shop" }]);
  assert.equal(r2.doc.stories[0].paras[1].runs.find((x) => x.t === "glarolykoi.net").ext.href, "https://glarolykoi.net/shop");
  assert.equal(run(r2.doc, [{ op: "link", find: "glarolykoi.net", url: "https://glarolykoi.net/shop" }]).n, 0);
  // remove takes it off
  const r3 = run(r2.doc, [{ op: "link", find: "glarolykoi.net", remove: true }]);
  assert.ok(!r3.doc.stories[0].paras[1].runs.find((x) => x.t === "glarolykoi.net").ext);
});

test("link: only web and e-mail addresses, never script", () => {
  const notes = [];
  const r = run(book(), [{ op: "link", find: "See", url: "javascript:alert(1)" }], notes);
  assert.equal(r.n, 0);
  assert.deepEqual(notes, ["badUrl"]);
  const r2 = run(book(), [{ op: "link", find: "Write to", url: "" }], []);
  assert.equal(r2.n, 0, "words that are no address stay as they are");
  assert.match(CMD.GUIDE, /\nlink: the words `find`/);
  assert.ok(CMD.ORDER.indexOf("link") > 0);
});

// ---------- picture half ----------
test("picture half: a cover spread shows its left or right half, the file stays whole", () => {
  const r = run(book(), [{ op: "picture", frame: "it-p", half: "left" }]);
  const it = r.doc.items.find((x) => x.id === "it-p");
  assert.equal(it.fit, "custom");
  assert.equal(it.ix, 0);
  assert.ok(it.ih * it.isc >= it.h && it.ih * it.isc <= it.h * 1.01, "the height fills the frame");
  assert.ok(it.iy <= 0 && it.iy > -5, "centred up and down");
  const r2 = run(book(), [{ op: "picture", frame: "it-p", half: "right" }]);
  const it2 = r2.doc.items.find((x) => x.id === "it-p");
  assert.ok(Math.abs(it2.ix + it2.iw * it2.isc - it2.w) < 0.01, "the right edge meets the frame's");
  assert.equal(it2.a, book().items.find((x) => x.id === "it-p").a);
  assert.match(CMD.GUIDE, /half left\|right\|top\|bottom\|centre/);
});

// ---------- AS-DUP ----------
test("two documents of one name are never both changed; the id names one", () => {
  const data = { docs: [book("ebook", "dc-one"), book("ebook", "dc-two"), book("Other", "dc-3")] };
  const tg = CMD.targets(data, null, "", "named", "ebook");
  assert.equal(tg.ok, false);
  assert.match(tg.err, /2 documents are called "ebook" \(ids dc-one, dc-two\)/);
  const one = CMD.targets(data, null, "", "named", "dc-two");
  assert.deepEqual(one.docs.map((d) => d.id), ["dc-two"]);
  assert.deepEqual(CMD.targets(data, null, "", "named", "Other").docs.map((d) => d.id), ["dc-3"]);
});

// ---------- AS-SEE ----------
const PIC = { type: "image/jpeg", data: "QUJD" };
function toolTurn(prov, raw) {
  return [
    { r: "user", text: "look at page 21" },
    { r: "asst", prov, text: "", tools: [{ id: "t1", name: "files_read", args: { path: "x.jpg" } }], raw },
    { r: "tool", results: [{ id: "t1", name: "files_read", content: "{\"kind\":\"image\"}", pics: [PIC] }] }
  ];
}
test("a tool result's picture goes to Claude, ChatGPT and Gemini as a picture", () => {
  const conf = { key: "k", model: "m" };
  const an = C.buildRequest("anthropic", conf, toolTurn("anthropic", { prov: "anthropic", blocks: [{ type: "tool_use", id: "t1", name: "files_read", input: {} }] }), {}).body.messages;
  const tr = an[2].content[0];
  assert.equal(tr.type, "tool_result");
  assert.deepEqual(tr.content[1], { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "QUJD" } });
  const oa = C.buildRequest("openai", conf, toolTurn("openai", { prov: "openai", msg: { role: "assistant", content: null, tool_calls: [{ id: "t1", type: "function", function: { name: "files_read", arguments: "{}" } }] } }), {}).body.messages;
  const last = oa[oa.length - 1];
  assert.equal(oa[oa.length - 2].role, "tool");
  assert.equal(last.role, "user");
  assert.deepEqual(last.content[1], { type: "image_url", image_url: { url: "data:image/jpeg;base64,QUJD" } });
  const ge = C.buildRequest("gemini", conf, toolTurn("gemini", { prov: "gemini", parts: [{ functionCall: { name: "files_read", args: {} } }] }), {}).body.contents;
  const parts = ge[ge.length - 1].parts;
  assert.ok(parts[0].functionResponse);
  assert.deepEqual(parts[1], { inlineData: { mimeType: "image/jpeg", data: "QUJD" } });
});

test("a model that can't see gets no picture, and only the newest 8 go", () => {
  const conf = { key: "k", model: "m", base: "http://127.0.0.1:11434/v1" };
  const oa = C.buildRequest("local", conf, toolTurn("local", { prov: "local", msg: { role: "assistant", content: null, tool_calls: [{ id: "t1", type: "function", function: { name: "files_read", arguments: "{}" } }] } }), {}).body.messages;
  assert.equal(oa[oa.length - 1].role, "tool", "no pictures message for a model that can't see");
  const many = [];
  for (let i = 0; i < 10; i++) many.push(...toolTurn("anthropic", { prov: "anthropic", blocks: [{ type: "tool_use", id: "t1", name: "files_read", input: {} }] }));
  const an = C.buildRequest("anthropic", { key: "k", model: "m" }, many, {}).body.messages;
  const withPic = an.filter((m) => Array.isArray(m.content) && m.content.some((b) => b.type === "tool_result" && Array.isArray(b.content)));
  assert.equal(withPic.length, 8);
  assert.match(an[2].content[0].content, /no longer attached/);
});

test("files_read: local folders, pictures, OCR; the tool says so", () => {
  const as = read("assistant/assistant.js");
  assert.match(as, /if \(typeof a\.path === "string" && \/\^local:\/i\.test\(a\.path\.trim\(\)\)\) return localRead\(a, apps\);/);
  assert.match(as, /return Promise\.all\(\[L\.read\(path, "files_read"\), cfMod\(\)\]\)/);
  assert.match(as, /if \(kind === "image"\) return picResult\(f, name, head, a, ui\);/);
  assert.match(as, /var pid = curProv\(\), see = GATE || C\.attCaps\(pid, provConf\(pid\)\)\.img, ocr = a\.ocr === true \|\| !see;/);
  // the picture stays in the session's memory, never in storage
  assert.match(as, /attMem\[id\] = got\[0\];/);
  assert.match(as, /out\.pic = \[\{ id: id, type: r\.type \}\];/);
  assert.match(as, /if \(m && m\.r === "tool" && Array\.isArray\(m\.results\)/);
  const core = read("assistant/core.js");
  assert.match(core, /ocr: \{ type: "boolean"/);
  assert.match(core, /never say you can't see a picture before trying/);
});

// ---------- AS-RB2 ----------
test("a card's report is kept on the device and taken before each turn", () => {
  const sh = read("shell.js");
  const m = sh.match(/  function assistReports\(\) \{[\s\S]*?\n  \}\n/);
  assert.ok(m, "assistReports is there");
  const store = {};
  const listeners = [];
  const win = { addEventListener: (k, fn) => { if (k === "storage") listeners.push(fn); }, orosAssistAtt: null };
  const ctx = { window: win, Proxy, JSON, Date, Object,
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } } };
  vm.createContext(ctx);
  vm.runInContext(m[0] + "\nvar rb = assistReports();", ctx);
  ctx.rb.k1 = { ok: 1, n: 2 };
  assert.equal(JSON.parse(store["oros-assist-rb"]).k1.rep.n, 2, "written to the device");
  // a new window (a reload, another orOS window) finds it
  vm.runInContext("var rb2 = assistReports();", ctx);
  assert.equal(ctx.rb2.k1.n, 2);
  delete ctx.rb.k1;
  assert.ok(!("k1" in JSON.parse(store["oros-assist-rb"])), "taken: gone from the device");
  // another window's report wakes the open Assistant
  let woke = 0;
  listeners.splice(1);
  win.orosAssistAtt = { onRb: () => { woke++; } };
  store["oros-assist-rb"] = JSON.stringify({ k9: { at: Date.now(), rep: { ok: 1 } } });
  listeners.forEach((fn) => fn({ key: "oros-assist-rb" }));
  assert.equal(woke, 1);
  // old entries go
  store["oros-assist-rb"] = JSON.stringify({ old: { at: Date.now() - 8 * 864e5, rep: { ok: 1 } } });
  vm.runInContext("var rb3 = assistReports();", ctx);
  assert.ok(!("old" in ctx.rb3));
  const as = read("assistant/assistant.js");
  assert.match(as, /function rbWaits\(ui\) \{ return ui\.st === "opened" \|\| ui\.st === ""; \}/);
  assert.equal((as.match(/if \(!rep \|\| !rbWaits\(ui\)\) return false;/g) || []).length, 6);
  assert.match(as, /function runTurnNow\(c, again\) \{\n    \/\/ AS-RB2[^\n]*\n    if \(takeReports\(c\)\) saveChat\(c\);/);
});

// ---------- AS-EL ----------
test("Greek typesetting words and the justification advice", () => {
  const sp = C.systemPrompt({ lang: "el", now: Date.now(), apps: ["Layout (layout)"] });
  assert.match(sp, /hyphenation = ο συλλαβισμός \(never «σπορά λέξεων»\)/);
  assert.match(sp, /style = το στυλ/);
  assert.match(sp, /colophon = ο κολοφώνας/);
  assert.match(sp, /Export as Markdown in the More \(⋯\) menu on its row in the list of conversations/);
  assert.match(SH.GUIDE.layout.ops.style, /justified text, align j, needs hyph on/);
});

// ---------- AS-EXP ----------
test("a conversation as Markdown: words, files, tools and their results", () => {
  const md = C.chatMarkdown({ title: "Βυθός", m: 5, msgs: [
    { r: "user", text: "Διάβασε", att: [{ name: "α κολαζ.docx" }] },
    { r: "asst", prov: "anthropic", model: "claude-haiku-5-5", text: "Εντάξει", tools: [{ name: "files_read", args: { path: "local:x" } }] },
    { r: "tool", results: [{ name: "files_read", content: "Error: ``` x", err: 1 }] },
    { r: "user", cont: 1, text: "continue" },
    { r: "note", text: "cut" }
  ] }, { you: "Εσύ", ai: "Βοηθός", files: "Αρχεία", tools: "Εργαλεία", when: () => "σήμερα", model: (m) => m.model });
  assert.match(md, /^# Βυθός\n\n_σήμερα_\n\n## Εσύ\n\nΔιάβασε\n\n_Αρχεία: α κολαζ\.docx_/);
  assert.match(md, /## Βοηθός · claude-haiku-5-5\n\nΕντάξει/);
  assert.match(md, /> Εργαλεία: `files_read` \{"path":"local:x"\}/);
  assert.match(md, /> `files_read` ✗\n\n````\nError: ``` x\n````/);
  assert.doesNotMatch(md, /continue/);
  const as = read("assistant/assistant.js");
  assert.match(as, /item\(t\("chat\.export"\), "", function \(\) \{ exportChat\(c\); \}\);/);
  ["chat.export", "exp.you", "exp.ai", "exp.tools", "exp.files", "exp.saved", "ed.op.link.layout", "ed.f.half", "ed.note.badUrl"].forEach((k) => {
    assert.equal((as.match(new RegExp("\"" + k.replace(/\./g, "\\.") + "\": ", "g")) || []).length, 2, k + " EN + EL");
    assert.match(read("i18n/de/assistant.js"), new RegExp("\"" + k.replace(/\./g, "\\.") + "\": "), k + " DE");
  });
});

test("AS-IDB: no function is declared twice in the Assistant's scope (the later one wins)", () => {
  ["assistant/assistant.js"].forEach((f) => {
    const names = (read(f).match(/^  function [A-Za-z0-9_$]+/gm) || []).map((s) => s.slice(11));
    const twice = names.filter((n, i) => names.indexOf(n) !== i);
    assert.deepEqual(twice, [], f + " declares twice: " + twice.join(", "));
  });
  assert.match(read("assistant/assistant.js"), /return appDbAll\(p\[0\], p\[1\]\)/);
});
