"use strict";
// 7.48.00 (Chris 2026-11-17 «Η ερώτηση δεν εμφανίστηκε ποτέ»): a deletion
// Claude asks for through the Gate is asked on a screen. A device with
// nobody at its screen (hidden here; the background host and the lock
// behave the same through away()) does not refuse it: a live call is
// answered __held (the box queues it for a screen) and a queued one is
// reported held (cqh), then asked when orOS comes on screen.
// Real shell in Chromium; the relay socket is faked.
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const http = require("http");
const ROOT = path.join(__dirname, "..");

function chromium() {
  for (const mod of ["playwright", "/opt/node22/lib/node_modules/playwright"]) {
    try { const pw = require(mod); const exe = pw.chromium.executablePath(); if (exe && fs.existsSync(exe)) return pw; } catch (e) {}
  }
  return null;
}
const PW = chromium();
const MIME = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml",
  ".txt": "text/plain", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2" };
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
const b64u = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function run(mode, hidden) {
  const K = crypto.randomBytes(32), KS = b64u(K);
  const seal = (obj) => { const iv = crypto.randomBytes(12); const c = crypto.createCipheriv("aes-256-gcm", K, iv); const ct = Buffer.concat([c.update(JSON.stringify(obj)), c.final(), c.getAuthTag()]); return b64u(iv) + "." + b64u(ct); };
  const ID = "GaTeBoX0123456789_-abc", TOK = "T".repeat(43), QID = "Q".repeat(16);
  const refs = {}, contacts = [];
  for (let i = 1; i <= 7; i++) {
    contacts.push({ id: "c" + i, given: "P" + i, family: "X", mtime: 1, phones: [], emails: [] });
    refs["r" + (116150 + i)] = { app: "contacts", target: "c" + i, title: "P" + i + " X", id: "c" + i };
  }
  const srv = await serve();
  const br = await PW.chromium.launch({ args: ["--no-sandbox"] });
  try {
    const ctx = await br.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 800 }, locale: "en-US" });
    const page = await ctx.newPage();
    const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
    const got = []; let sock = null;
    await page.routeWebSocket(/relay\.test\/gate\/ws/, (ws) => {
      sock = ws;
      ws.onMessage((m) => { if (m === "ping") return; try { const o = JSON.parse(m); if (o.r || o.cqa) got.push(o); } catch (e) {} });
      setTimeout(() => ws.send(JSON.stringify({ hi: Date.now() })), 50);
    });
    await page.route(/relay\.test/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true,"data":{"ok":true}}' }));
    await page.addInitScript(([ID, TOK, KS, contacts, refs, hidden]) => {
      if (hidden) {
        window.__vis = "hidden";
        Object.defineProperty(Document.prototype, "visibilityState", { configurable: true, get() { return window.__vis; } });
        Object.defineProperty(Document.prototype, "hidden", { configurable: true, get() { return window.__vis === "hidden"; } });
      }
      if (sessionStorage.getItem("seeded")) return;
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("oros-gate", JSON.stringify({ on: true, id: ID, tok: TOK, r: "https://relay.test", lv: { contacts: "write" }, at: 1, lvd: 1 }));
      localStorage.setItem("oros-gate-seat", JSON.stringify({ id: ID, ss: "S".repeat(43), r: "https://relay.test", m: 1, k: KS }));
      localStorage.setItem("oros-contacts-data", JSON.stringify({ ver: 1, contacts, deleted: [] }));
      localStorage.setItem("oros-gate-refs", JSON.stringify({ n: 116160, refs }));
    }, [ID, TOK, KS, contacts, refs, hidden]);
    await page.goto("http://127.0.0.1:" + srv.address().port + "/?standalone");
    for (let i = 0; i < 40 && !sock; i++) await page.waitForTimeout(250);
    await page.waitForTimeout(2500);
    const a = { refs: Object.keys(refs), action: "delete" };
    if (mode === "live") sock.send(JSON.stringify({ q: QID, n: "change_item", a, dl: Date.now() + 25000 }));
    else sock.send(JSON.stringify({ cq: [{ id: QID, t: Date.now() - 60000, c: seal({ n: "change_item", a, t: Date.now() - 60000 }) }] }));
    const dialog = () => page.evaluate(() => { const d = document.querySelector("[role=dialog] #gate-ask-title"); return d ? d.closest("[role=dialog]").innerText : null; });
    let shown = null;
    for (let i = 0; i < 24 && !shown && !got.length; i++) { await page.waitForTimeout(500); shown = await dialog(); }
    const first = { shown, got: got.slice() };
    if (hidden) {                                   // the owner comes to the screen
      await page.evaluate(() => { window.__vis = "visible"; document.dispatchEvent(new Event("visibilitychange")); });
      if (mode === "live") { await page.waitForTimeout(500); sock.send(JSON.stringify({ cq: [{ id: "H".repeat(16), t: Date.now(), c: seal({ n: "change_item", a, t: Date.now() }) }] })); }
      for (let i = 0; i < 24 && !shown; i++) { await page.waitForTimeout(500); shown = await dialog(); }
    }
    if (shown) await page.evaluate(() => { const b = [...document.querySelectorAll("[role=dialog] button")]; b[b.length - 1].click(); });
    await page.waitForTimeout(3000);
    const left = await page.evaluate(() => JSON.parse(localStorage.getItem("oros-contacts-data")).contacts.length);
    return { first, shown, got, left, errs };
  } finally { await br.close(); srv.close(); }
}

const opt = { skip: PW ? false : "Playwright / Chromium not installed", timeout: 120000 };
test("on screen, a live deletion of 7 is asked once and runs on Delete", opt, async () => {
  const r = await run("live", false);
  assert.deepEqual(r.errs, []);
  assert.match(r.first.shown || "", /Delete/);
  assert.equal(r.left, 0);
  assert.equal(r.got.find((o) => o.r).ok, true);
});
test("nobody at the screen: a live deletion is answered __held, not refused (7.48.00)", opt, async () => {
  const r = await run("live", true);
  assert.deepEqual(r.errs, []);
  assert.equal(r.first.shown, null, "never asked off screen");
  const ans = r.first.got.find((o) => o.r);
  assert.ok(ans && ans.ok === false && ans.c === "__held", "handed back to the box: " + JSON.stringify(ans));
  assert.match(r.shown || "", /Delete/, "asked once orOS is on screen (the box resends it)");
  assert.equal(r.left, 0);
});
test("nobody at the screen: a queued deletion is held (cqh), then asked on screen (7.48.00)", opt, async () => {
  const r = await run("queued", true);
  assert.deepEqual(r.errs, []);
  assert.equal(r.first.shown, null);
  const rep = r.first.got.find((o) => o.cqa);
  assert.ok(rep && rep.cqh && rep.cqh[0] === "Q".repeat(16) && rep.cqa.indexOf("Q".repeat(16)) < 0, "held, not acknowledged: " + JSON.stringify(rep));
  assert.match(r.shown || "", /P1 X/, "asked with the titles when orOS comes on screen");
  assert.equal(r.left, 0);
});
