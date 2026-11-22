"use strict";
// GQ-KEEP (2026-11-22): a waiting change this orOS does not know (an
// older copy, as the cached one a phone runs before it updates) is
// neither acknowledged nor held: it stays in the box for a newer orOS.
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
  const ID = "GaTeBoX0123456789_-abc", TOK = "T".repeat(43), QU = "U".repeat(16), QB = "B".repeat(16);
  const srv = await serve();
  const br = await PW.chromium.launch({ args: ["--no-sandbox"] });
  try {
    const ctx = await br.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 800 }, locale: "en-US" });
    const page = await ctx.newPage();
    const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
    const got = []; let sock = null;
    await page.routeWebSocket(/relay\.test\/gate\/ws/, (ws) => {
      sock = ws;
      ws.onMessage((m) => { try { const o = JSON.parse(m); if (o.cqa) got.push(o); } catch (e) {} });
      setTimeout(() => ws.send(JSON.stringify({ hi: Date.now() })), 50);
    });
    await page.route(/relay\.test/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true,"data":{"ok":true}}' }));
    await page.addInitScript(([ID, TOK, KS]) => {
      window.__vis = "hidden";
      Object.defineProperty(Document.prototype, "visibilityState", { configurable: true, get() { return window.__vis; } });
      Object.defineProperty(Document.prototype, "hidden", { configurable: true, get() { return window.__vis === "hidden"; } });
      if (sessionStorage.getItem("seeded")) return;
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("oros-gate", JSON.stringify({ on: true, id: ID, tok: TOK, r: "https://relay.test", lv: { layout: "write" }, at: 1, lvd: 1 }));
      localStorage.setItem("oros-gate-seat", JSON.stringify({ id: ID, ss: "S".repeat(43), r: "https://relay.test", m: 1, k: KS }));
    }, [ID, TOK, KS]);
    await page.goto("http://127.0.0.1:" + srv.address().port + "/?standalone");
    for (let i = 0; i < 40 && !sock; i++) await page.waitForTimeout(250);
    await page.waitForTimeout(2500);
    const t = Date.now() - 60000;
    sock.send(JSON.stringify({ cq: [{ id: QU, t, c: seal({ n: "a_tool_from_the_future", a: {}, t }) }, { id: QB, t, c: seal({ n: "export_pdf", a: { document: "Nothing here" }, t }) }] }));
    for (let i = 0; i < 30 && !got.length; i++) await page.waitForTimeout(500);
    const ran = await page.evaluate(() => localStorage.getItem("oros-gate-ran") || "");
    return { got, ran, errs };
  } finally { await br.close(); srv.close(); }
}

const opt = { skip: PW ? false : "Playwright / Chromium not installed", timeout: 120000 };
test("GQ-KEEP: a waiting change this orOS does not know stays queued for a newer one", opt, async () => {
  const r = await run();
  assert.deepEqual(r.errs, []);
  const rep = r.got[0];
  assert.ok(rep, "the device reported the queue");
  assert.ok(rep.cqa.indexOf("U".repeat(16)) < 0, "not acknowledged: " + JSON.stringify(rep));
  assert.ok(!(rep.cqh || []).includes("U".repeat(16)), "not held either (it is not for this orOS)");
  assert.ok((rep.cqh || []).includes("B".repeat(16)), "a known one hidden is held as before: " + JSON.stringify(rep));
  assert.ok(r.ran.indexOf("U".repeat(16)) < 0, "not remembered as run");
});
