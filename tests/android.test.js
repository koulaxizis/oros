// Android app project (android/, BR-PHONE): the generated manifest and
// resources follow manifest.webmanifest, and the phone bridge pieces
// the page relies on are declared.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const { build } = require(path.join(ROOT, "android", "tools", "gen.js"));
const web = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.webmanifest"), "utf8"));
const out = build(web);
const xml = out["AndroidManifest.xml"];

test("android: manifest carries the web app's file handlers, share target and shortcuts", () => {
  const handlers = (web.file_handlers || []).length;
  assert.equal((xml.match(/FileHandlingActivity/g) || []).length >= handlers, true);
  if (web.share_target) assert.match(xml, /SHARE_TARGET/);
  const shortcuts = (web.shortcuts || []).length;
  assert.equal((out["res/xml/shortcuts.xml"].match(/<shortcut /g) || []).length, Math.min(shortcuts, 4));
  assert.match(out["res/values/web_manifest.xml"], /<resources>/);
});

test("android: phone bridge pieces are declared", () => {
  for (const s of ["android.permission.READ_CONTACTS", "android.permission.WRITE_CONTACTS",
    "android.permission.READ_CALENDAR", "android.permission.WRITE_CALENDAR",
    "androidx.browser.customtabs.PostMessageService", ".PermissionActivity", "${permissionScheme}",
    ".AuthenticatorService", ".ContactsSyncService", ".CalendarSyncService"]) {
    assert.ok(xml.includes(s), s);
  }
  const app = path.join(ROOT, "android", "app", "src", "main");
  for (const f of ["res/xml/authenticator.xml", "res/xml/sync_contacts.xml", "res/xml/sync_calendar.xml", "res/xml/contacts.xml"]) {
    assert.ok(fs.existsSync(path.join(app, f)), f);
  }
});

test("android: the page asks for permission with the scheme the release build declares", () => {
  const phone = fs.readFileSync(path.join(ROOT, "phone.js"), "utf8");
  const gradle = fs.readFileSync(path.join(ROOT, "android", "app", "build.gradle"), "utf8");
  const scheme = /release \{\s*resValue[\s\S]*?permissionScheme: '([^']+)'/.exec(gradle)[1];
  const id = /applicationId '([^']+)'/.exec(gradle)[1];
  assert.ok(phone.includes("scheme=" + scheme + ";package=" + id + ";end"), scheme);
});
