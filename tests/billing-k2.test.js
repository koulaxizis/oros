// Billing (app merge 7, wave K2): an accepted quote becomes an invoice
// on the same screen, and the two client lists share one picker while
// staying apart (each side only fills in its own New client dialog).
// Static wiring checks; the flow itself was played at 360 px with
// Playwright (Quotes tab → Make invoice → Billing's editor).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const host = read("invoices/invoices.js");
const view = read("quote/view.js");

test("the host mounts the Quotes tab with both hooks", () => {
  assert.match(host, /QuoteView\.mount\(host, \{ otherClients: clientsForQuotes, newInvoice: quoteToInvoice,/);
  assert.match(host, /function quoteToInvoice\(payload\) \{\n\s+if \(document\.querySelector\("dialog\[open\]"\)\) return;\n\s+openTarget\(\{ "new": payload \}\);/);
});

test("Make invoice uses the host's hook first, the shell only outside Billing", () => {
  assert.match(view, /function newInvoiceHook\(\) \{ return typeof opts\.newInvoice === "function" \? opts\.newInvoice : null; \}/);
  assert.match(view, /if \(hook\) \{ writeShelterNow\(\); hook\(payload\); return; \}/);
  assert.match(view, /cur\.status === "accepted" && \(newInvoiceHook\(\) \|\| invoicesOpener\(\)\)/);
});

test("shared picker: other side's clients only fill in New client, never save", () => {
  // Quotes tab: Billing's clients the quote list lacks (tax number or name)
  assert.match(view, /openClientDialog\(null, o\);/);
  assert.match(view, /\$\("client-delete"\)\.hidden = !clientId;/);
  assert.match(view, /return !\(tx && tax\[tx\]\) && !names\[foldName\(o\.name\)\];/);
  // Billing's editor: "q:<id>" options open clientDialog filled in, the select goes back
  assert.match(host, /if \(cSel\.value\.indexOf\("q:"\) === 0\) \{/);
  assert.match(host, /cSel\.value = d\.cli \|\| "";\n\s+if \(qr\) clientDialog\(null, newClientChosen, qr\.c\);/);
  assert.match(host, /if \(haveClient\(name, party\.afm\)\) return;/);
  // Billing ids can never start with "q:"
  assert.match(read("invoices/core.js"), /var ID_RE  = \/\^\[a-z0-9\]\[a-z0-9-\]\{2,39\}\$\/;/);
});

test("strings in EN, EL and DE", () => {
  assert.equal((view.match(/"client\.fromBilling":/g) || []).length, 2);
  assert.equal((host.match(/"ed\.fromQuotes":/g) || []).length, 2);
  assert.match(read("i18n/de/quote.js"), /"client\.fromBilling":/);
  assert.match(read("i18n/de/invoices.js"), /"ed\.fromQuotes":/);
});

test("the quote ↔ invoice link is worked out from the doc's src, never stored twice", () => {
  assert.match(host, /return d\.src === "quote:" \+ qid && d\.st !== "void";/);
  assert.match(host, /invoicesFor: invoicesOfQuote, openInvoice: function \(id\) \{ openTarget\(\{ invoice: id \}\); \}/);
  assert.match(host, /if \(fq\) acts\.appendChild\(btn\(t\("vw\.fromQuote", \{ n: fq\.num \}\)/);
  assert.equal((host.match(/"vw\.fromQuote":/g) || []).length, 2);
  assert.match(read("i18n/de/invoices.js"), /"vw\.fromQuote":/);
  assert.equal((view.match(/"invoiced\.label":/g) || []).length, 2);
  assert.match(view, /syncInvoiceBtn\(\);      \/\/ K2: an invoice made meanwhile shows its link/);
});
