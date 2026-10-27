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
  assert.equal(C.checkAtt("anthropic", [], { type: "application/x-msdownload", size: 10 }), "type");
  // documents (wave DOC1) are read as text on the device, up to ATT_DOC
  assert.equal(C.checkAtt("anthropic", [], { type: "text/html", size: 10 }), "");
  assert.equal(C.checkAtt("anthropic", [], { type: "application/msword", size: C.ATT_DOC }), "");
  assert.equal(C.checkAtt("anthropic", [], { type: "application/msword", size: C.ATT_DOC + 1 }), "size");
  assert.equal(C.checkAtt("anthropic", [], { type: "image/svg+xml", size: 10 }), "type");
  assert.equal(C.checkAtt("anthropic", [], { type: "image/png", size: 0 }), "size");
  assert.equal(C.checkAtt("anthropic", [], { type: "image/png", size: C.ATT_IMG + 1 }), "size");
  assert.equal(C.checkAtt("anthropic", [], { type: "application/pdf", size: C.ATT_PDF }), "");
  assert.equal(C.checkAtt("anthropic", [], { type: "application/pdf", size: C.ATT_PDF + 1 }), "size");
  assert.equal(C.checkAtt("anthropic", [1, 2, 3], { type: "image/png", size: 10 }), "");
  assert.equal(C.checkAtt("anthropic", new Array(29), { type: "image/png", size: 10 }), "");
  assert.equal(C.checkAtt("anthropic", new Array(30), { type: "image/png", size: 10 }), "count");
});

test("attach: 30 files of up to 30 MB a message", () => {
  assert.equal(C.ATT_MAX, 30);
  assert.equal(C.ATT_FILE, 30 * 1024 * 1024);
  assert.equal(C.ATT_PDF, C.ATT_FILE);
  assert.equal(C.ATT_DOC, C.ATT_FILE);
  // Claude takes 5 MB a photo: photos are shrunk on the device to under it
  assert.equal(C.ATT_IMG, 5 * 1024 * 1024);
  // per request, under each provider's own limit (base64 is 4/3 bigger)
  assert.ok(C.attRoom("anthropic").bytes * 4 / 3 < 32 * 1024 * 1024 * 0.95);
  assert.equal(C.attRoom("anthropic").pages, 100);
  assert.equal(C.attRoom("anthropic").n, 100);
  assert.ok(C.attRoom("openai").bytes * 4 / 3 < 50 * 1024 * 1024);
  assert.ok(C.attRoom("gemini").bytes * 4 / 3 < 20 * 1024 * 1024);
  assert.equal(C.attRoom("mistral").bytes, C.ATT_SEND);
  assert.equal(C.attRoom("mistral").pages, 0);
});

test("attach: a file past the request's room goes as the text read on the device", () => {
  const MB = 1024 * 1024, b64 = (mb) => "A".repeat(Math.ceil(mb * MB * 4 / 3));
  const p1 = { id: "apdf0011", name: "a.pdf", type: "application/pdf", size: 15 * MB, data: b64(15) };
  const p2 = { id: "apdf0012", name: "b.pdf", type: "application/pdf", size: 15 * MB, data: b64(15), text: "Contract text" };
  const p3 = { id: "apdf0013", name: "c.pdf", type: "application/pdf", size: 15 * MB, data: b64(15) };
  let h = C.prepHistory([user("read", [p1, p2])], "anthropic");
  assert.equal(h[0].att.length, 1);
  assert.equal(h[0].att[0].name, "a.pdf");
  assert.match(h[0].text, /^\[Text that orOS read on the device from the PDF “b\.pdf”[^]*Contract text[^]*\nread$/);
  // without text read yet, the old note
  h = C.prepHistory([user("read", [p1, p3])], "anthropic");
  assert.match(h[0].text, /“c\.pdf” earlier; it was left out to keep the request small/);
  // OpenAI has more room: both go
  h = C.prepHistory([user("read", [p1, p2])], "openai");
  assert.equal(h[0].att.length, 2);
  // Claude's page limit: 100 pages a request, counted by the Assistant
  const s1 = { id: "apdf0021", name: "s1.pdf", type: "application/pdf", size: 3, data: "QUJD", pages: 80 };
  const s2 = { id: "apdf0022", name: "s2.pdf", type: "application/pdf", size: 3, data: "QUJD", pages: 30, text: "Second" };
  const s3 = { id: "apdf0023", name: "s3.pdf", type: "application/pdf", size: 3, data: "QUJD", pages: 20 };
  h = C.prepHistory([user("read", [s1, s2, s3])], "anthropic");
  assert.deepEqual(h[0].att.map((a) => a.name), ["s1.pdf", "s3.pdf"]);
  assert.match(h[0].text, /Second/);
  // Gemini counts no pages
  assert.equal(C.prepHistory([user("read", [s1, s2, s3])], "gemini")[0].att.length, 3);
  // Claude: at most 100 files a request, newest first
  const many = [];
  for (let i = 0; i < 4; i++) {
    const att = [];
    for (let j = 0; j < 30; j++) att.push({ id: "aimg" + i + "x" + String(j).padStart(3, "0"), name: i + "-" + j + ".jpg", type: "image/jpeg", size: 3, data: "QUJD" });
    many.push(user("m" + i, att));
  }
  h = C.prepHistory(many, "anthropic");
  const sent = h.reduce((n, m) => n + (m.att ? m.att.length : 0), 0);
  assert.equal(sent, 100);
  assert.equal(h[h.length - 1].att.length, 30);
  assert.equal(h[0].att.length, 10);
});

test("attach: normAtt keeps only the metadata, cleans the name", () => {
  assert.deepEqual(C.normAtt(withData(IMG)), IMG);
  assert.equal(C.normAtt({ id: "x", name: "a", type: "image/png", size: 1 }), null);
  assert.equal(C.normAtt({ id: "aimg0001", name: "a", type: "application/zip", size: 1 }), null);
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
  assert.deepEqual(h, [{ r: "user", text: "[The user attached “receipt.jpg” here earlier and you read it then, but the file is no longer available, so it was not sent again: " +
    "you cannot read, check or quote it now. What you wrote about it earlier stands. If the user asks for something that needs the file again, " +
    "say at the start of your reply that it is no longer available and ask them to attach it again.]\nagain" }]);
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
  const big = "A".repeat(Math.ceil(C.attRoom("anthropic").bytes * 4 / 3 * 0.6));   // ~60% of the budget each
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
  assert.match(C.systemPrompt(Object.assign({ files: "pdf" }, base)), /attach photos, PDF files and documents/);
  assert.match(C.systemPrompt(Object.assign({ files: "img" }, base)), /attach photos and documents to a message/);
});
