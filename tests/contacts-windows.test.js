"use strict";
// CT-SW — a second window of Contacts never erases a contact.
// Chris 2026-11-03: a contact saved on the phone and closed before
// sync was gone. Cause: every Contacts window kept its own copy of the
// list in memory and wrote it whole on each save; a window opened
// earlier (orOS next to the single app "orOS Contacts", a second tab,
// a background frame) wrote its older list over the new contact.
// Real app pages in Chromium, two windows of one browser profile.
// Storage events are held back in the older window, the way a frozen
// background tab on a phone does not hear them, so the save path alone
// must keep the other window's work.
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const http = require("http");
const ROOT = path.join(__dirname, "..");

function chromium() {
  for (const mod of ["playwright", "/opt/node22/lib/node_modules/playwright"]) {
    try {
      const pw = require(mod);
      const exe = pw.chromium.executablePath();
      if (exe && fs.existsSync(exe)) return pw;
    } catch (e) {}
  }
  return null;
}
const PW = chromium();

const MIME = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".txt": "text/plain",
  ".webmanifest": "application/manifest+json", ".woff2": "font/woff2" };
function serve() {
  return new Promise((res) => {
    const srv = http.createServer((req, rsp) => {
      let p = decodeURIComponent(req.url.split("?")[0]);
      if (p.endsWith("/")) p += "index.html";
      const f = path.join(ROOT, p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rsp.writeHead(404); return rsp.end(); }
      rsp.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" });
      fs.createReadStream(f).pipe(rsp);
    });
    srv.listen(0, "127.0.0.1", () => res(srv));
  });
}

async function addContact(page, given) {
  await page.click("#ct-add");
  await page.fill("#ct-given", given);
  await page.click("#ct-save");
  await page.waitForTimeout(150);
}
async function stored(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("oros-contacts-data") || "null"));
}
function byName(d, given) {
  return (d && d.contacts || []).find((c) => c.given === given) || null;
}
async function edit(page, id, sel, value) {
  await page.evaluate((id) => window.__orosContactsOpen(id), id);
  await page.click(".ct-view-edit");
  await page.fill(sel, value);
  await page.click("#ct-save");
  await page.waitForTimeout(150);
}

test("CT-SW: two Contacts windows of one browser keep each other's saves", { skip: PW ? false : "Playwright / Chromium not installed", timeout: 120000 }, async () => {
  const srv = await serve();
  const base = "http://127.0.0.1:" + srv.address().port + "/";
  const browser = await PW.chromium.launch({ args: ["--no-sandbox"] });
  try {
    const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 800 } });
    await ctx.addInitScript(() => {
      try { localStorage.setItem("oros-lang", "en"); } catch (e) {}
      // The older window: storage events never reach the app.
      if (/[?&]deaf=1/.test(location.search)) {
        window.addEventListener("storage", (e) => e.stopImmediatePropagation(), true);
      }
    });
    const errors = [];
    const open = async (q) => {
      const p = await ctx.newPage();
      p.on("pageerror", (e) => errors.push(e.message));
      await p.goto(base + "contacts/index.html?standalone" + q);
      await p.waitForSelector("#ct-add");
      await p.waitForTimeout(300);
      return p;
    };
    const A = await open("&deaf=1");
    await addContact(A, "Alpha");
    await addContact(A, "Delta");
    const B = await open("");                 // opened later: sees Alpha and Delta

    // 1. The reported loss: B saves a new contact, then the older
    //    window A saves something of its own.
    await addContact(B, "Beta");
    assert.ok(byName(await stored(A), "Beta"), "Beta is stored");
    await addContact(A, "Gamma");
    let d = await stored(A);
    for (const n of ["Alpha", "Beta", "Gamma", "Delta"]) assert.ok(byName(d, n), n + " is still stored");
    assert.ok(await A.locator("#ct-list").innerText().then((t) => /Beta/.test(t)), "A now lists Beta too");

    // 2. The same contact edited in both windows, one field each: both stay.
    const alpha = byName(d, "Alpha").id;
    await edit(B, alpha, "#ct-family", "Brown");
    await edit(A, alpha, "#ct-org", "Acme");
    d = await stored(A);
    assert.equal(byName(d, "Alpha").family, "Brown", "B's edit kept");
    assert.equal(byName(d, "Alpha").org, "Acme", "A's edit kept");

    // 3. A deletion elsewhere stays a deletion; this window's own
    //    removal stays a removal.
    const delta = byName(d, "Delta").id;
    await B.evaluate((id) => window.__orosContactsOpen(id), delta);
    await B.click(".ct-view-edit");
    await B.click("#ct-delete");
    await B.click("#del-dlg-yes");
    await B.waitForTimeout(150);
    await addContact(A, "Epsilon");
    d = await stored(A);
    assert.equal(byName(d, "Delta"), null, "Delta stays deleted");
    assert.ok(d.deleted.some((t) => t.id === delta), "its tombstone is kept");
    assert.ok(byName(d, "Epsilon") && byName(d, "Beta") && byName(d, "Gamma"));

    // 4. A full browser storage: nothing is said to be saved that is
    //    not stored. The window stays open with the typed text.
    await A.evaluate(() => {
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (k === "oros-contacts-data") { const e = new Error("quota"); e.name = "QuotaExceededError"; throw e; }
        return orig.call(this, k, v);
      };
    });
    await A.click("#ct-add");
    await A.fill("#ct-given", "Zeta");
    await A.click("#ct-save");
    await A.waitForTimeout(150);
    assert.equal(await A.evaluate(() => document.getElementById("ct-dlg").open), true, "the edit window stays open");
    assert.equal(await A.inputValue("#ct-given"), "Zeta", "the typed name is still there");
    assert.equal(byName(await stored(A), "Zeta"), null);
    assert.ok(!/Zeta/.test(await A.locator("#ct-list").innerText()), "the list does not show an unsaved contact");
    assert.match(await A.locator(".app-toast").innerText(), /storage is full/);

    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    srv.close();
  }
});

test("CT-SW: the stored copy is written in one place, stamped against what this window saw", () => {
  const s = fs.readFileSync(path.join(ROOT, "contacts/contacts.js"), "utf8");
  assert.equal((s.match(/localStorage\.setItem\(DATA_KEY, /g) || []).length, 1, "only storeState writes oros-contacts-data");
  assert.match(s, /function saveState\(\) \{\n    stampContacts\(\);\n    adoptStored\(\);/);
  assert.match(s, /JSON\.parse\(seenText !== null \? seenText : localStorage\.getItem\(DATA_KEY\)\)/);
});
