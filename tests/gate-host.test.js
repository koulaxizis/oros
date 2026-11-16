"use strict";
// GATE-HOST (PEND-1 wave 2, Chris 2026-11-16): with the owner's opt-in,
// a background orOS (headless, started by orOS Portable's tray) or an
// orOS USB window behind its screen lock applies the changes Claude
// queued while orOS was closed. The launcher confirms the page's nonce
// at /__oros/gate-host and says which kind it is; a window told "bg"
// and a page with no nonce keep waiting for the owner to unlock.
// Real shell in Chromium; the relay socket and the launcher are faked.
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

function chromiumLaunch() { return PW.chromium.launch({ args: ["--no-sandbox"] }); }
const b64u = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const WIN_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function run(MODE) {
  const K = crypto.randomBytes(32), KS = b64u(K);
  function seal(obj) { const iv = crypto.randomBytes(12); const c = crypto.createCipheriv("aes-256-gcm", K, iv); const ct = Buffer.concat([c.update(JSON.stringify(obj)), c.final(), c.getAuthTag()]); return b64u(iv) + "." + b64u(ct); }
  const ID = "GaTeBoX0123456789_-abc", TOK = "T".repeat(43), QA = "A".repeat(16), QB = "B".repeat(16), QC = "C".repeat(16);
  const KIND = MODE === "lock" ? "lock" : "bg", WIN = MODE === "lock" || MODE === "wrong";
  const srv = await serve();
  const base = "http://127.0.0.1:" + srv.address().port + "/";
  const br = await chromiumLaunch();
  try {
    // 1) a lock record made by the real lock.js
    let lockRec;
    { const c0 = await br.newContext(); const p0 = await c0.newPage();
      await p0.goto(base + "?standalone"); await p0.waitForFunction(() => window.orosLock && window.orosLock.enable);
      await p0.evaluate(() => window.orosLock.enable("pin", "482916"));
      lockRec = await p0.evaluate(() => localStorage.getItem("oros-lock")); await c0.close(); }
    const ctx = await br.newContext({ serviceWorkers: "block", userAgent: WIN ? WIN_UA : undefined, viewport: { width: 1280, height: 800 }, locale: "en-US" });
    const page = await ctx.newPage();
    const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
    const now = Date.now(), asked = now - 3 * 3600000;
    let acks = null;
    await page.routeWebSocket(/relay\.test\/gate\/ws/, (ws) => {
      ws.onMessage((m) => { try { const o = JSON.parse(m); if (o.cqa) acks = o.cqa; } catch (e) {} });
      setTimeout(() => ws.send(JSON.stringify({ hi: Date.now() })), 50);
      setTimeout(() => ws.send(JSON.stringify({ cq: [
        { id: QA, t: asked, c: seal({ n: "create_items", a: { app: "contacts", items: [{ name: "Nikos Dimitriou", phones: ["6900000000"] }] }, t: asked }) },
        { id: QB, t: asked + 1000, c: seal({ n: "change_item", a: { ref: "p-" + QA + ".0", action: "update", note_add: "met at the fair" }, t: asked + 1000 }) },
        { id: QC, t: asked + 2000, c: seal({ n: "change_item", a: { ref: "r1", action: "update", job_title: "Editor" }, t: asked + 2000 }) }
      ] })), 2500);
    });
    await page.route(/relay\.test/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true,"data":{"ok":true}}' }));
    const NONCE = "N".repeat(24);
    await page.route(/\/__oros\/gate-host/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ can: true, on: true, running: true, host: r.request().url().indexOf("n=" + NONCE) > 0, kind: KIND }) }));
    await page.addInitScript(([ID, TOK, KS, now, lockRec]) => {
      if (sessionStorage.getItem("seeded")) return;
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("oros-gate", JSON.stringify({ on: true, id: ID, tok: TOK, r: "https://relay.test", lv: { contacts: "write" }, at: 1, lvd: 1 }));
      localStorage.setItem("oros-gate-seat", JSON.stringify({ id: ID, ss: "S".repeat(43), r: "https://relay.test", m: 1, k: KS }));
      // Anna was changed by the owner AFTER Claude asked (mtime = now)
      localStorage.setItem("oros-contacts-data", JSON.stringify({ ver: 1, contacts: [{ id: "c-anna", given: "Anna", family: "Pappa", mtime: now, phones: [], emails: [] }], deleted: [] }));
      localStorage.setItem("oros-gate-refs", JSON.stringify({ n: 1, refs: { r1: { app: "contacts", target: "c-anna", title: "Anna Pappa", id: "c-anna" } } }));
      localStorage.setItem("oros-lock", lockRec);
    }, [ID, TOK, KS, now, lockRec]);
    await page.goto(MODE !== "plain" ? base + "?standalone&gate-host=" + NONCE : base + "?standalone");
    const locked = (await page.evaluate(() => new Promise((ok) => setTimeout(() => ok(window.orosLock && window.orosLock.isLocked()), 1500))));
    for (let i = 0; i < (MODE === "plain" || MODE === "wrong" ? 16 : 60) && !acks; i++) await page.waitForTimeout(500);
    const out = await page.evaluate(() => ({
      contacts: JSON.parse(localStorage.getItem("oros-contacts-data")).contacts,
      chg: JSON.parse(localStorage.getItem("oros-gate-changes") || "[]"),
      log: JSON.parse(localStorage.getItem("oros-gate-log") || "[]").slice(-3)
    }));
    return { locked, acks, contacts: out.contacts, active: await page.evaluate(() => !!(window.orosGate && window.orosGate.host && window.orosGate.host.active())), errs };
  } finally { await br.close(); srv.close(); }
}

const opt = { skip: PW ? false : "Playwright / Chromium not installed", timeout: 120000 };
for (const [mode, applies] of [["host", true], ["lock", true], ["wrong", false], ["plain", false]]) {
  test("GATE-HOST " + mode + ": queued changes " + (applies ? "apply behind the lock" : "wait for the owner"), opt, async () => {
    const r = await run(mode);
    assert.equal(r.locked, true, "the screen lock is on");
    assert.deepEqual(r.errs, []);
    assert.equal(r.active, applies);
    if (applies) {
      assert.deepEqual(r.acks, ["A".repeat(16), "B".repeat(16), "C".repeat(16)]);
      const nikos = r.contacts.find((c) => c.given === "Nikos");
      assert.ok(nikos && nikos.note === "met at the fair", "the add and the change on its p- ref");
      assert.notEqual(r.contacts.find((c) => c.id === "c-anna").job_title, "Editor", "Anna changed after Claude asked stays");
    } else {
      assert.equal(r.acks, null);
      assert.ok(!r.contacts.some((c) => c.given === "Nikos"));
    }
  });
}
