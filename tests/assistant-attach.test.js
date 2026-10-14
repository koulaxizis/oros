// Assistant phase 4 wave 3: photos and PDFs in a message (core.js
// section 3b). The conversation keeps only { id, name, type, size };
// the file goes out only with its in-memory data, only to a provider
// that reads that kind, within the per-request budget.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const C = require(path.join(__dirname, "..", "assistant/core.js"));

const IMG = { id: "aimg0001", name: "receipt.jpg", type: "image/jpeg", size: 3 };
const PDF = { id: "apdf0001", name: "contract.pdf", type: "application/pdf", size: 3 };
const withData = (a, data) => Object.assign({}, a, { data: data || "QUJD" });
const user = (text, att) => ({ r: "user", text, att });
const conf = { key: "k", model: "m" };

test("attach: provider capabilities", () => {
  assert.deepEqual(C.attCaps("anthropic"), { img: true, pdf: true });
  assert.deepEqual(C.attCaps("openai"), { img: true, pdf: true });
  assert.deepEqual(C.attCaps("gemini"), { img: true, pdf: true });
  assert.deepEqual(C.attCaps("openrouter"), { img: true, pdf: true });
  assert.deepEqual(C.attCaps("mistral"), { img: true, pdf: false });
  assert.deepEqual(C.attCaps("local"), { img: false, pdf: false });          // phase 5: photos only when the model can see
  assert.deepEqual(C.attCaps("local", { vis: 1 }), { img: true, pdf: false });
  assert.deepEqual(C.attCaps("browser"), { img: false, pdf: false });
  assert.deepEqual(C.attCaps("nope"), { img: false, pdf: false });
});

test("attach: checkAtt codes", () => {
  assert.equal(C.checkAtt("anthropic", [], { type: "image/png", size: 10 }), "");
  assert.equal(C.checkAtt("anthropic", [], { type: "application/pdf", size: 10 }), "");
  // phase 5 wave 2: what a provider can't read goes as text read on the device
  assert.equal(C.checkAtt("browser", [], { type: "image/png", size: 10 }), "");
  assert.equal(C.checkAtt("mistral", [], { type: "application/pdf", size: 10 }), "");
  assert.equal(C.checkAtt("nope", [], { type: "image/png", size: 10 }), "none");
  assert.equal(C.checkAtt("anthropic", [], { type: "text/html", size: 10 }), "type");
  assert.equal(C.checkAtt("anthropic", [], { type: "image/svg+xml", size: 10 }), "type");
  assert.equal(C.checkAtt("anthropic", [], { type: "image/png", size: 0 }), "size");
  assert.equal(C.checkAtt("anthropic", [], { type: "image/png", size: C.ATT_IMG + 1 }), "size");
  assert.equal(C.checkAtt("anthropic", [], { type: "application/pdf", size: C.ATT_PDF }), "");
  assert.equal(C.checkAtt("anthropic", [], { type: "application/pdf", size: C.ATT_PDF + 1 }), "size");
  assert.equal(C.checkAtt("anthropic", [1, 2, 3], { type: "image/png", size: 10 }), "count");
});

test("attach: normAtt keeps only the metadata, cleans the name", () => {
  assert.deepEqual(C.normAtt(withData(IMG)), IMG);
  assert.equal(C.normAtt({ id: "x", name: "a", type: "image/png", size: 1 }), null);
  assert.equal(C.normAtt({ id: "aimg0001", name: "a", type: "text/plain", size: 1 }), null);
  const n = C.normAtt({ id: "aimg0001", name: "a\u0000b\nc", type: "image/png", size: -4 });
  assert.equal(n.name, "a b c");
  assert.equal(n.size, 0);
  assert.equal(C.normAtt({ id: "aimg0001", name: "", type: "image/png", size: 1 }).name, "file");
});

test("attach: Claude gets image + document blocks before the text", () => {
  const r = C.buildRequest("anthropic", conf, [user("what is this?", [withData(IMG), withData(PDF, "UERG")])], {});
  assert.deepEqual(r.body.messages[0].content, [
    { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "QUJD" } },
    { type: "document", source: { type: "base64", media_type: "application/pdf", data: "UERG" }, title: "contract.pdf" },
    { type: "text", text: "what is this?" }
  ]);
});

test("attach: a file alone, without words, still goes out", () => {
  const r = C.buildRequest("anthropic", conf, [user("", [withData(IMG)])], {});
  assert.deepEqual(r.body.messages[0].content, [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "QUJD" } }]);
});

test("attach: OpenAI-style providers get image_url / file parts", () => {
  const m = [user("read", [withData(IMG), withData(PDF)])];
  const oa = C.buildRequest("openai", conf, m, {}).body.messages[0].content;
  assert.deepEqual(oa, [
    { type: "text", text: "read" },
    { type: "image_url", image_url: { url: "data:image/jpeg;base64,QUJD" } },
    { type: "file", file: { filename: "contract.pdf", file_data: "data:application/pdf;base64,QUJD" } }
  ]);
  const orr = C.buildRequest("openrouter", conf, m, {}).body.messages[0].content;
  assert.deepEqual(orr, oa);
  // Mistral: the image as a plain data URL string, no PDF (a note instead)
  const mi = C.buildRequest("mistral", conf, m, {}).body.messages[0].content;
  assert.equal(mi[0].type, "text");
  assert.match(mi[0].text, /^\[The user attached “contract\.pdf”, but this AI service can't read PDF files here\.\]\nread$/);
  assert.deepEqual(mi[1], { type: "image_url", image_url: "data:image/jpeg;base64,QUJD" });
  assert.equal(mi.length, 2);
});

test("attach: Gemini gets inlineData parts", () => {
  const g = C.buildRequest("gemini", conf, [user("read", [withData(IMG)])], {}).body.contents[0];
  assert.deepEqual(g, { role: "user", parts: [{ inlineData: { mimeType: "image/jpeg", data: "QUJD" } }, { text: "read" }] });
});

test("attach: browser model and a file without data get a note, never the file", () => {
  const b = C.browserPrompts([user("hi", [withData(IMG)])], "");
  assert.match(b.prompt, /can't read images here\.\]\nhi$/);
  const h = C.prepHistory([user("again", [IMG])], "anthropic");
  assert.deepEqual(h, [{ r: "user", text: "[The user attached “receipt.jpg” here earlier; the file is no longer available, so it was not sent again.]\nagain" }]);
  const r = C.buildRequest("anthropic", conf, [user("again", [IMG])], {});
  assert.equal(typeof r.body.messages[0].content, "string");
});

test("attach: data that is not base64, or a bad type, is never sent", () => {
  const h = C.prepHistory([user("x", [Object.assign({}, IMG, { data: "<script>" }),
    { id: "abad0001", name: "a.svg", type: "image/svg+xml", size: 1, data: "QUJD" }])], "anthropic");
  assert.equal(h.length, 1);
  assert.equal(h[0].att, undefined);
  assert.match(h[0].text, /no longer available/);
});

test("attach: the request budget keeps the newest files", () => {
  const big = "A".repeat(Math.ceil(C.ATT_SEND * 4 / 3 * 0.6));   // ~60% of the budget each
  const old = { id: "aold0001", name: "old.jpg", type: "image/jpeg", size: 1, data: big };
  const neu = { id: "anew0001", name: "new.jpg", type: "image/jpeg", size: 1, data: big };
  const h = C.prepHistory([user("first", [old]), { r: "asst", prov: "anthropic", text: "ok" }, user("second", [neu])], "anthropic");
  assert.equal(h[0].att, undefined);
  assert.match(h[0].text, /left out to keep the request small/);
  assert.equal(h[2].att.length, 1);
  assert.equal(h[2].att[0].name, "new.jpg");
});

test("attach: a stored conversation carries no file data", () => {
  const c = { id: "cabcdefgh", m: 1, title: "t", msgs: [user("x", [IMG])], refs: {}, refN: 0 };
  const f = C.chatFile(c);
  assert.ok(f.includes("receipt.jpg"));
  assert.ok(!f.includes("\"data\""));
});

test("attach: system prompt mentions files only when the provider reads them", () => {
  const base = { lang: "en", now: Date.UTC(2026, 9, 14), apps: ["Notes (notes)"], entries: ["expense"] };
  assert.ok(!/attach photos/.test(C.systemPrompt(base)));
  assert.match(C.systemPrompt(Object.assign({ files: "pdf" }, base)), /attach photos and PDF files/);
  assert.match(C.systemPrompt(Object.assign({ files: "img" }, base)), /attach photos to a message/);
});
