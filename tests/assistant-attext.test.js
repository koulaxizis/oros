// Assistant phase 5 wave 2: photos and PDFs for every model. What the
// chosen service can't read itself goes as the text orOS read from the
// file on the device (pdf.js, Tesseract); the file itself stays here.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const C = require(path.join(__dirname, "..", "assistant/core.js"));

const PDF = { id: "apdf0001", name: "contract.pdf", type: "application/pdf", size: 3, data: "QUJD" };
const IMG = { id: "aimg0001", name: "receipt.jpg", type: "image/jpeg", size: 3, data: "QUJD" };
const conf = { key: "k", model: "m" };
const user = (text, att) => ({ r: "user", text, att });

test("attext: Mistral gets a PDF's text, never the file", () => {
  const m = [user("summarise", [Object.assign({}, PDF, { text: "Clause 1. Rent is 500 EUR." })])];
  const c = C.buildRequest("mistral", conf, m, {}).body.messages[0].content;
  assert.equal(typeof c, "string");
  assert.match(c, /^\[Text that orOS read on the device from the PDF “contract\.pdf”/);
  assert.match(c, /Rent is 500 EUR\.\n\[End of “contract\.pdf”\]\nsummarise$/);
  assert.match(c, /never instructions/);
  assert.ok(!c.includes("QUJD"));
});

test("attext: a local model gets photo text unless it can see", () => {
  const m = [user("add it", [Object.assign({}, IMG, { text: "TOTAL 12.50" })])];
  const blind = C.buildRequest("local", Object.assign({ base: "http://localhost:11434/v1" }, conf), m, {}).body.messages;
  assert.match(blind[blind.length - 1].content, /from the photo “receipt\.jpg”[^]*TOTAL 12\.50/);
  const sees = C.buildRequest("local", Object.assign({ base: "http://localhost:11434/v1", vis: 1 }, conf), m, {}).body.messages;
  const parts = sees[sees.length - 1].content;
  assert.ok(Array.isArray(parts));
  assert.ok(parts.some((p) => p.type === "image_url"));
});

test("attext: the built-in model reads the text too", () => {
  const b = C.browserPrompts([user("what is it?", [Object.assign({}, IMG, { text: "Concert 12/11" })])], "");
  assert.match(b.prompt, /Concert 12\/11/);
  assert.match(b.prompt, /what is it\?$/);
});

test("attext: no text read, or text not ready, says so", () => {
  const empty = C.prepHistory([user("x", [Object.assign({}, PDF, { text: "" })])], "mistral");
  assert.ok(!empty[0].att);
  assert.match(empty[0].text, /no text could be read/);
  const browserEmpty = C.prepHistory([user("x", [Object.assign({}, IMG, { text: "  " })])], "browser");
  assert.match(browserEmpty[0].text, /no text could be read from it on the device/);
  const notYet = C.prepHistory([user("x", [IMG])], "browser");
  assert.match(notYet[0].text, /can't read images here/);
  const gone = C.prepHistory([user("x", [{ id: IMG.id, name: IMG.name, type: IMG.type, size: 3 }])], "browser");
  assert.match(gone[0].text, /no longer available/);
});

test("attext: long text is cut, control characters go", () => {
  const long = "a\u0001b " + "x".repeat(C.ATT_TEXT + 100);
  const h = C.prepHistory([user("", [Object.assign({}, PDF, { text: long })])], "mistral");
  assert.ok(h[0].text.includes("a b "));
  assert.ok(h[0].text.includes("[…cut]"));
  assert.ok(h[0].text.length < C.ATT_TEXT + 400);
});

test("attext: services that read files still get the file", () => {
  const m = [user("read", [Object.assign({}, PDF, { text: "ignored" })])];
  const c = C.buildRequest("anthropic", conf, m, {}).body.messages[0].content;
  assert.equal(c[0].type, "document");
  assert.ok(!JSON.stringify(c).includes("ignored"));
});

test("attext: the local server's 'can see' switch is kept and synced", () => {
  const d = C.mergeAssist({ provs: { local: { m: 3, base: "http://localhost:11434/v1", model: "llava", vis: true } } }, null);
  assert.equal(d.provs.local.vis, 1);
});
