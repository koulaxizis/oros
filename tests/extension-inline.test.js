// orOS add-on 2.3, Passwords (PW-AF7): suggestions inside page forms.
// Which fields open the list (inline.js classify), and the guards that
// keep vault data away from the page: no static content script, the
// list page is the add-on's own origin, background.js answers the list
// only to that page with a token, fills only the top frame after the
// visibility check, never on the orOS address. The real flow (list,
// fill, locked, keyboard, look-alike site, faded or covered list, a
// page's own copy of the list page) is checked with Playwright and the
// real add-on (Bible Part IV "Desktop autofill", PW-AF7).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "..", "extension");
const { classify } = require(path.join(DIR, "inline.js"));
const f = (o) => Object.assign({ tag: "INPUT", type: "text", ac: "", words: "", pwAfter: false }, o);

test("classify: logins, cards and addresses by autocomplete first", () => {
  assert.equal(classify(f({ type: "password" })), "login");
  assert.equal(classify(f({ ac: "username" })), "login");
  assert.equal(classify(f({ ac: "one-time-code" })), "login");
  assert.equal(classify(f({ ac: "cc-number" })), "card");
  assert.equal(classify(f({ ac: "shipping postal-code" })), "person");
  assert.equal(classify(f({ type: "password", ac: "new-password" })), "", "sign-up: nothing to offer");
  assert.equal(classify(f({ ac: "new-password", words: "user" })), "");
});

test("classify: by words (EN / EL / DE) and the password after it", () => {
  assert.equal(classify(f({ type: "email", pwAfter: true })), "login");
  assert.equal(classify(f({ words: "onoma χρηστη username" })), "login");
  assert.equal(classify(f({ words: "ονομα χρηστη" })), "login", "Όνομα χρήστη is a user name, not a first name");
  assert.equal(classify(f({ words: "ονομα" })), "person");
  assert.equal(classify(f({ words: "κωδικος επαληθευσης" })), "login");
  assert.equal(classify(f({ words: "card number" })), "card");
  assert.equal(classify(f({ words: "kartennummer" })), "card");
  assert.equal(classify(f({ words: "postleitzahl" })), "person");
  assert.equal(classify(f({ words: "ταχυδρομικος κωδικας" })), "person");
});

test("classify: nothing for other fields", () => {
  assert.equal(classify(f({ words: "search the site" })), "");
  assert.equal(classify(f({ type: "search", words: "username" })), "");
  assert.equal(classify(f({ type: "checkbox", words: "remember me" })), "");
  assert.equal(classify(f({ type: "hidden", ac: "username" })), "");
  assert.equal(classify(f({ tag: "TEXTAREA", words: "comment" })), "");
  assert.equal(classify(f({ readOnly: true, type: "password" })), "");
  assert.equal(classify(f({ disabled: true, ac: "cc-number" })), "");
  assert.equal(classify(f({ words: "comment" })), "");
});

test("manifest: no static content script; only the list page is reachable from pages", () => {
  const m = JSON.parse(fs.readFileSync(path.join(DIR, "manifest.json"), "utf8"));
  assert.equal(m.content_scripts, undefined);
  assert.deepEqual(m.host_permissions, ["https://useoros.online/*"], "all sites stay optional (one click)");
  assert.ok(m.optional_host_permissions.includes("https://*/*"));
  assert.equal(m.web_accessible_resources.length, 1);
  const w = m.web_accessible_resources[0];
  assert.deepEqual(w.matches, ["https://*/*"]);
  w.resources.forEach((r) => assert.ok(fs.existsSync(path.join(DIR, r)), r));
  assert.ok(!w.resources.some((r) => /pm\/|pmvault|pmfill|background|popup|options/.test(r)), "no vault code reachable from pages");
});

test("inline.js: no vault, no storage, closed shadow root, opens only on the person's own action", () => {
  const s = fs.readFileSync(path.join(DIR, "inline.js"), "utf8");
  assert.ok(!/storage\.|OrosVault|PmVault|indexedDB|localStorage/.test(s));
  assert.match(s, /attachShadow\(\{ mode: "closed" \}\)/);
  assert.ok(!/innerHTML|insertAdjacentHTML|postMessage/.test(s), "nothing through the page's message channel");
  assert.match(s, /if \(window !== window\.top\) return;/);
  ["keydown", "focusin", "click", "mousedown"].forEach((ev) => {
    const at = s.indexOf('addEventListener("' + ev + '"');
    assert.ok(at > 0, ev);
    assert.match(s.slice(at, at + 160), /isTrusted/, ev + " ignores synthetic events");
  });
  assert.match(s, /Date\.now\(\) - state\.shownAt < 500/);
  assert.match(s, /elementFromPoint/);
});

test("inline-menu.js: text only, token from its own address, IntersectionObserver v2 guard", () => {
  const s = fs.readFileSync(path.join(DIR, "inline-menu.js"), "utf8");
  assert.ok(!/innerHTML|insertAdjacentHTML|postMessage|storage\./.test(s));
  assert.match(s, /trackVisibility: true/);
  assert.match(s, /\^\[0-9a-f\]\{32\}\$/);
  assert.match(s, /ev\.isTrusted/);
});

test("background.js: list and fill only for the add-on's list page with a token; top frame; never orOS", () => {
  const s = fs.readFileSync(path.join(DIR, "background.js"), "utf8");
  assert.match(s, /function fromInlinePage\(sender\)/);
  assert.match(s, /sender\.url\.indexOf\(inlinePage\(\)\) === 0/);
  assert.match(s, /sender\.frameId === 0 && typeof sender\.url === "string" && \/\^https:\/\.test\(sender\.url\)/);
  assert.match(s, /m\.t === "ii-list"\) job = inlineList/);
  assert.match(s, /\(m\.t === "ii-open" && fromContentTop\(sender\)\)/);
  assert.match(s, /t: "ii-check", token: m\.token \}, \{ frameId: 0 \}/);
  assert.match(s, /target: \{ tabId: tk\.tab, frameIds: \[0\] \}, func: OrosFill\.fillInPage/);
  assert.match(s, /isOrosPage\(sender\.url\)/);
  assert.match(s, /storage\.session\.get\("iiTok"\)/);
  // the list rows carry names only, never values
  const row = s.slice(s.indexOf("function inlineRow"), s.indexOf("async function isOrosPage"));
  assert.ok(!/\.pw\b|totp\(|payload|cvv|num\b/.test(row.replace(/e\.totp \?/g, "")));
});

test("locales: EN and EL have every new string", () => {
  const en = JSON.parse(fs.readFileSync(path.join(DIR, "_locales/en/messages.json"), "utf8"));
  const el = JSON.parse(fs.readFileSync(path.join(DIR, "_locales/el/messages.json"), "utf8"));
  ["popInlineAsk", "popInlineYes", "popInlineOn", "iiLocked", "iiUnlockHint", "optInline", "optInlineHint", "optInlineAllow", "optHow7"].forEach((k) => {
    assert.ok(en[k] && en[k].message, "en " + k);
    assert.ok(el[k] && el[k].message && el[k].message !== en[k].message, "el " + k);
  });
});
