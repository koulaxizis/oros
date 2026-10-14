// Invoices wave 46: "Pay online" with the user's own payment link
// (invoices/core.js payLinkOk / payLinkFor) and its wiring.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const C = require("../invoices/core.js");

test("payLinkOk: https only, no credentials, spaces or markup", () => {
  assert.equal(C.payLinkOk(" https://buy.stripe.com/test_abc123 "), "https://buy.stripe.com/test_abc123");
  assert.equal(C.payLinkOk("https://pay.example.gr/x?y=1#z"), "https://pay.example.gr/x?y=1#z");
  assert.equal(C.payLinkOk("http://buy.stripe.com/abc"), "");
  assert.equal(C.payLinkOk("javascript:alert(1)"), "");
  assert.equal(C.payLinkOk("https://user:pw@evil.test/"), "");
  assert.equal(C.payLinkOk("https://buy.stripe.com/a b"), "");
  assert.equal(C.payLinkOk("https://buy.stripe.com/\"><x"), "");
  assert.equal(C.payLinkOk("https://localhost/x"), "");
  assert.equal(C.payLinkOk("https://" + "a".repeat(500) + ".com"), "");
  assert.equal(C.payLinkOk(42), "");
});

test("payLinkFor: Stripe links get the invoice number and the client's email", () => {
  const d = { num: "Α-2026/12", c: { email: "client@shop.test" } };
  assert.equal(C.payLinkFor("https://buy.stripe.com/test_abc", d),
    "https://buy.stripe.com/test_abc?client_reference_id=2026-12&prefilled_email=client%40shop.test");
  assert.equal(C.payLinkFor("https://buy.stripe.com/abc?locale=el#x", { num: "INV-7", c: {} }),
    "https://buy.stripe.com/abc?locale=el&client_reference_id=INV-7#x");
  assert.equal(C.payLinkFor("https://buy.stripe.com/abc?client_reference_id=keep", { num: "INV-7", c: { email: "bad" } }),
    "https://buy.stripe.com/abc?client_reference_id=keep");
  // other providers: exactly as typed
  assert.equal(C.payLinkFor("https://pay.example.gr/x", d), "https://pay.example.gr/x");
  assert.equal(C.payLinkFor("", d), "");
  assert.equal(C.payLinkFor("http://buy.stripe.com/abc", d), "");
});

test("the link rides on the profile as an extra field (older versions keep it)", () => {
  const p = C.normProf({ name: "Shop", paylink: "https://buy.stripe.com/abc", m: 5 });
  assert.equal(p.paylink, "https://buy.stripe.com/abc");
  const b = C.normBiz({ id: "biz-two-x", name: "Two", paylink: "https://buy.stripe.com/two", m: 3 });
  assert.equal(b.paylink, "https://buy.stripe.com/two");
});

test("wiring: settings field, PDF block and email line", () => {
  const js = fs.readFileSync(path.join(__dirname, "../invoices/invoices.js"), "utf8");
  assert.ok(js.indexOf('f.paylink = input("url"') > 0);
  assert.ok(js.indexOf("payLinkText(d, tt)") > 0);
  assert.ok(js.indexOf('doc.textWithLink(ln, px') > 0);
  assert.ok(js.indexOf('t("mail.payOnline")') > 0);
});
