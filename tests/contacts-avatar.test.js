"use strict";
// CT-NP: Contacts keeps no photos; a contact shows its initials or an
// 8-bit avatar drawn from a stored seed ("px:<seed>").
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const src = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

test("the sanitizer keeps an avatar seed and drops photos", () => {
  const s = src("contacts/contacts.js");
  assert.match(s, /var PX_RE = \/\^px:\[a-z0-9\]\{1,12\}\$\/;/);
  assert.match(s, /avatar: +\(typeof c\.avatar === "string" && PX_RE\.test\(c\.avatar\)\) \? c\.avatar : null/);
  assert.doesNotMatch(s, /\bphoto: +\(typeof c\.photo/);
  // a load that found photos saves once, so sync drops them everywhere
  assert.match(s, /if \(hadPhotos\) saveState\(\);/);
  // vCard: no PHOTO out, avatar round-trips
  assert.match(s, /L\.push\("X-OROS-AVATAR:" \+ c\.avatar\)/);
  assert.doesNotMatch(s, /L\.push\("PHOTO:/);
  assert.match(s, /case "PHOTO": break;/);
});

test("no photo source is left", () => {
  assert.doesNotMatch(src("contacts/index.html"), /ct-pf|pf-dlg|ct-avatar-upload/);
  assert.doesNotMatch(src("contacts/contacts.js"), /gravatar|libravatar|toDataURL\("image\/jpeg", 0\.75\)/i);
  assert.doesNotMatch(src("contacts/accounts.js"), /photoUrl|withPhotos|"photos,/);
  assert.doesNotMatch(src("phone.js"), /row\.photo = /);
  // Find photos is gone from the credits (a profiles-only credit may stay)
  assert.doesNotMatch(src("shell.js"), /Contacts › Find photos/);
  assert.doesNotMatch(src("CREDITS.md"), /Contacts › Find photos/);
});

test("merge stamps follow the avatar field (Contacts and Assistant agree)", () => {
  assert.match(src("contacts/merge.js"), /"labelIds", "starred", "note", "avatar"\];/);
  assert.match(src("assistant/edits.js"), /"labelIds", "starred", "note", "avatar"\];/);
});
