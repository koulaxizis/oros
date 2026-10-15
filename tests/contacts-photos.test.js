"use strict";
// CT-PS: contact photos stay small (128 px), so a big address book
// doesn't fill localStorage and stop sync.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const src = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

test("Contacts shrinks big photos once per start", () => {
  const s = src("contacts/contacts.js");
  assert.match(s, /var PHOTO_SMALL = 16000;/);
  assert.match(s, /function shrinkPhotos\(\)/);
  assert.match(s, /setTimeout\(shrinkPhotos, 1500\)/);
  // kept only when clearly smaller and unchanged meanwhile, saved once
  assert.match(s, /c\.photo === it\.photo && out && out\.length < it\.photo\.length \* 0\.75/);
  assert.match(s, /if \(done\) \{ saveState\(\); renderList\(\); \}/);
});

test("Google import fetches and keeps 128 px photos", () => {
  const s = src("contacts/accounts.js");
  assert.match(s, /"=s128"/);
  assert.doesNotMatch(s, /=s256/);
  assert.match(s, /Math\.min\(128, Math\.max\(bmp\.width, bmp\.height\)\)/);
});
