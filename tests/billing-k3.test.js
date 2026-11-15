// Billing (app merge 7, wave K3): one settings page for both tabs and
// the business details on the quotes' PDF (read from Billing's main
// profile each time, never copied into the quote slice). Static wiring
// checks; the flow was played with Playwright (Settings › Quotes ›
// Payment terms texts, Export PDF with the sender block).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const host = read("invoices/invoices.js");
const view = read("quote/view.js");

test("Settings stays reachable from the Quotes tab and has a Quotes part", () => {
  assert.doesNotMatch(host, /\$\("set-btn"\)\.hidden = qt;/);
  assert.match(host, /openQuotes\(\{ tab: "quotes", settings: "pay" \}\)/);
  assert.match(host, /openQuotes\(\{ tab: "quotes", settings: "tpl" \}\)/);
  assert.match(view, /if \(tg && tg\.settings === "pay"\) \{ openPayPresetsDialog\(\); return true; \}/);
  assert.match(view, /if \(tg && tg\.settings === "tpl"\) \{ openTemplateLibrary\(\); return true; \}/);
});

test("the quote PDF prints Billing's business details, read each time", () => {
  assert.match(host, /profile: profileForQuotes,/);
  assert.match(host, /function profileForQuotes\(\) \{\n\s+var p = data && data\.prof \? data\.prof : \{\};/);
  assert.match(view, /me = typeof opts\.profile === "function" \? opts\.profile\(\) : null;/);
  assert.match(view, /if \(meEnd && y < meEnd \+ 4\) y = meEnd \+ 4;/);
  // nothing of the profile is written into the quote slice
  assert.doesNotMatch(view, /state\.prof\b/);
});

test("strings in EN, EL and DE", () => {
  for (const k of ["set.quotes", "set.quotesHint", "set.qPay", "set.qTpl"]) {
    assert.equal((host.match(new RegExp('"' + k.replace(".", "\\.") + '":', "g")) || []).length, 2, k);
    assert.match(read("i18n/de/invoices.js"), new RegExp('"' + k.replace(".", "\\.") + '":'), k);
  }
  assert.equal((view.match(/"pdf\.taxid":/g) || []).length, 2);
  assert.match(read("i18n/de/quote.js"), /"pdf\.taxid":/);
});
