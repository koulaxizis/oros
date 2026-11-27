"use strict";
// KB-QRES (Chris 2026-11-27, Noxpress gap 11) in the real shell: the
// device acknowledges queued changes with each one's outcome sealed with
// the gate key (cqr), so the box can tell change_history what became of
// them: a board made, and a second board of the same name refused.
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
  const open = (s) => { const [iv, ct] = s.split(".").map((x) => Buffer.from(x, "base64url")); const d = crypto.createDecipheriv("aes-256-gcm", K, iv); d.setAuthTag(ct.subarray(ct.length - 16)); return JSON.parse(Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]).toString()); };
  const ID = "GaTeBoX0123456789_-abc", TOK = "T".repeat(43), Q1 = "N".repeat(16), Q2 = "D".repeat(16);
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
      if (sessionStorage.getItem("seeded")) return;
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("oros-gate", JSON.stringify({ on: true, id: ID, tok: TOK, r: "https://relay.test", lv: { kanban: "write" }, at: 1, lvd: 1 }));
      localStorage.setItem("oros-gate-seat", JSON.stringify({ id: ID, ss: "S".repeat(43), r: "https://relay.test", m: 1, k: KS }));
    }, [ID, TOK, KS]);
    await page.goto("http://127.0.0.1:" + srv.address().port + "/?standalone");
    for (let i = 0; i < 40 && !sock; i++) await page.waitForTimeout(250);
    await page.waitForTimeout(2500);
    const t = Date.now() - 60000;
    const a = { name: "Noxpress", columns: [{ name: "Νέο" }, { name: "Έγινε" }] };
    sock.send(JSON.stringify({ cq: [{ id: Q1, t, c: seal({ n: "kanban_add_board", a, t }) }, { id: Q2, t: t + 1, c: seal({ n: "kanban_add_board", a, t: t + 1 }) }] }));
    for (let i = 0; i < 40 && !got.length; i++) await page.waitForTimeout(500);
    const rep = got[0] || {};
    const outs = {};
    Object.keys(rep.cqr || {}).forEach((id) => { outs[id] = open(rep.cqr[id]); });
    return { rep, outs, errs, Q1, Q2 };
  } finally { await br.close(); srv.close(); }
}

const opt = { skip: PW ? false : "Playwright / Chromium not installed", timeout: 120000 };
test("KB-QRES: queued changes are acknowledged with their sealed outcomes", opt, async () => {
  const r = await run();
  assert.deepEqual(r.errs, []);
  assert.deepEqual(r.rep.cqa, [r.Q1, r.Q2], JSON.stringify(r.rep));
  assert.equal(r.outs[r.Q1].how, "applied", JSON.stringify(r.outs));
  assert.equal(r.outs[r.Q2].how, "refused", JSON.stringify(r.outs));
  assert.match(r.outs[r.Q2].c, /Noxpress/);
  if (process.env.QRES_SHOW) console.log(JSON.stringify(r.outs));
});
