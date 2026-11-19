"use strict";
// GATE-SCREEN + GATE-AWAKE (Chris 2026-11-19 «Τα εγκρίνω και τα 3»):
// with orOS hidden, Layout's work through the Gate is answered __screen
// (the box keeps it for a screen) and a queued one is held (cqh); once
// orOS is on screen the held one runs. While the gate is on the tab
// holds the Web Lock "oros-gate-awake" and its ping ticks in a worker.
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


async function run() {
  const K = crypto.randomBytes(32), KS = b64u(K);
  const seal = (obj) => { const iv = crypto.randomBytes(12); const c = crypto.createCipheriv("aes-256-gcm", K, iv); const ct = Buffer.concat([c.update(JSON.stringify(obj)), c.final(), c.getAuthTag()]); return b64u(iv) + "." + b64u(ct); };
  const ID = "GaTeBoX0123456789_-abc", TOK = "T".repeat(43), QID = "Q".repeat(16);
  const srv = await serve();
  const br = await PW.chromium.launch({ args: ["--no-sandbox"] });
  try {
    const ctx = await br.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 800 }, locale: "en-US" });
    const page = await ctx.newPage();
    const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
    const got = []; let sock = null;
    await page.routeWebSocket(/relay\.test\/gate\/ws/, (ws) => {
      sock = ws;
      ws.onMessage((m) => { if (m === "ping" || m === "v0" || m === "v1") return; try { const o = JSON.parse(m); if (o.r || o.cqa) got.push(o); } catch (e) {} });
      setTimeout(() => ws.send(JSON.stringify({ hi: Date.now() })), 50);
    });
    await page.route(/relay\.test/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true,"data":{"ok":true}}' }));
    await page.addInitScript(([ID, TOK, KS]) => {
      window.__vis = "hidden";
      Object.defineProperty(Document.prototype, "visibilityState", { configurable: true, get() { return window.__vis; } });
      Object.defineProperty(Document.prototype, "hidden", { configurable: true, get() { return window.__vis === "hidden"; } });
      window.__workers = 0;
      const W = window.Worker;
      window.Worker = function (u, o) { window.__workers++; return new W(u, o); };
      if (sessionStorage.getItem("seeded")) return;
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("oros-gate", JSON.stringify({ on: true, id: ID, tok: TOK, r: "https://relay.test", lv: { layout: "write" }, at: 1, lvd: 1 }));
      localStorage.setItem("oros-gate-seat", JSON.stringify({ id: ID, ss: "S".repeat(43), r: "https://relay.test", m: 1, k: KS }));
    }, [ID, TOK, KS]);
    await page.goto("http://127.0.0.1:" + srv.address().port + "/?standalone");
    for (let i = 0; i < 40 && !sock; i++) await page.waitForTimeout(250);
    await page.waitForTimeout(2500);
    const lock = await page.evaluate(() => navigator.locks.query().then((q) => q.held.map((l) => l.name)));
    const workers = await page.evaluate(() => window.__workers);
    const a = { document: "Nothing here" };
    sock.send(JSON.stringify({ q: "L".repeat(16), n: "rebuild_in_layout", a, dl: Date.now() + 25000 }));
    sock.send(JSON.stringify({ q: "D".repeat(16), n: "edit_in_app", a: { app: "layout", dry_run: true, designs: "all", commands: [] }, dl: Date.now() + 25000 }));
    sock.send(JSON.stringify({ cq: [{ id: QID, t: Date.now() - 60000, c: seal({ n: "export_pdf", a, t: Date.now() - 60000 }) }] }));
    for (let i = 0; i < 30 && got.length < 3; i++) await page.waitForTimeout(500);
    const first = got.slice();
    await page.evaluate(() => { window.__vis = "visible"; document.dispatchEvent(new Event("visibilitychange")); });
    for (let i = 0; i < 30 && !got.some((o) => o.cqa && o.cqa.indexOf(QID) >= 0); i++) await page.waitForTimeout(500);
    const off = await page.evaluate(() => window.orosGate && typeof window.orosGate.disable === "function" ? window.orosGate.disable().then(() => navigator.locks.query(), () => navigator.locks.query()).then((q) => q.held.map((l) => l.name)) : null);
    return { lock, workers, first, got, off, errs };
  } finally { await br.close(); srv.close(); }
}

const opt = { skip: PW ? false : "Playwright / Chromium not installed", timeout: 120000 };
test("hidden: Layout's work is kept for a screen, a dry run still reads; on screen the kept one runs; the tab stays awake", opt, async () => {
  const r = await run();
  assert.deepEqual(r.errs, []);
  assert.ok(r.lock.indexOf("oros-gate-awake") >= 0, "the Web Lock is held: " + JSON.stringify(r.lock));
  assert.ok(r.workers >= 1, "the ping ticks in a worker");
  const live = r.first.find((o) => o.r === "L".repeat(16));
  assert.ok(live && live.ok === false && live.c === "__screen", "handed back to the box: " + JSON.stringify(live));
  const dry = r.first.find((o) => o.r === "D".repeat(16));
  assert.ok(dry && dry.c !== "__screen", "a dry run is answered here: " + JSON.stringify(dry));
  const rep = r.first.find((o) => o.cqa);
  assert.ok(rep && rep.cqh && rep.cqh[0] === "Q".repeat(16) && rep.cqa.indexOf("Q".repeat(16)) < 0, "held, not acknowledged: " + JSON.stringify(rep));
  assert.ok(r.got.some((o) => o.cqa && o.cqa.indexOf("Q".repeat(16)) >= 0), "decided once orOS is on screen");
  if (r.off) assert.ok(r.off.indexOf("oros-gate-awake") < 0, "the lock goes with the gate: " + JSON.stringify(r.off));
});
