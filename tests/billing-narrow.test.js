// Billing Quotes tab on narrow screens (BILL-NARROW, 7.39.01): the
// currency select lists "EUR · Euro …" names, and without min-width 0
// it kept its widest option's width and ran 36px past a 360px phone.
// Checked with Playwright at 320, 360 and 1280 px (no element of .qv
// past the viewport).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const css = fs.readFileSync(path.join(__dirname, "..", "quote/view.css"), "utf8");

test("meta-row selects may shrink to the row on a phone", () => {
  const m = css.match(/\.qv \.meta-row select \{ ([^}]*)\}/);
  assert.ok(m, "rule .qv .meta-row select { min-width … }");
  assert.match(m[1], /min-width: 0;/);
  assert.match(m[1], /max-width: 100%;/);
});
