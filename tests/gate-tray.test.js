"use strict";
// TRAY-1 (+ LOCAL-GONE: TRAY-2 removed 2026-11-27) (Chris 2026-11-21 «να δουλεύεις με το orOS κλειστό στο
// tray … και πρόσβαση στους φακέλους ακόμη και με έγκριση από κινητό»):
// an orOS desktop window (the launcher's origin, localhost:47800) runs
// Layout's work while hidden and tells the box "b1"; Claude asks for a
// folder of the computer with local_folders_request, the owner answers on
// a screen (hidden: __held), and the allowed folder goes to the gate's
// other devices sealed with the gate's key (lf); a closed folder from
// another device closes it here. Real shell in Chromium; relay faked.
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
function serve(port) {
  return new Promise((res, rej) => {
    const srv = http.createServer((req, rsp) => {
      let p = decodeURIComponent(req.url.split("?")[0]);
      if (p.indexOf("/__oros/") === 0) { rsp.writeHead(404); return rsp.end(); }
      if (p.endsWith("/")) p += "index.html";
      const f = path.join(ROOT, p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rsp.writeHead(404); return rsp.end(); }
      rsp.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" });
      fs.createReadStream(f).pipe(rsp);
    });
    srv.on("error", rej);
    srv.listen(port || 0, "127.0.0.1", () => res(srv));
  });
}
const b64u = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

async function open(br, origin, K, vis) {
  const KS = b64u(K), ID = "GaTeBoX0123456789_-abc", TOK = "T".repeat(43);
  const ctx = await br.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 800 }, locale: "en-US" });
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  const got = [], raw = []; let sock = null;
  await page.routeWebSocket(/relay\.test\/gate\/ws/, (ws) => {
    sock = ws;
    ws.onMessage((m) => { raw.push(m); if (m === "ping" || m === "v0" || m === "v1" || m === "b1") return; try { const o = JSON.parse(m); if (o.r || o.cqa || o.lf) got.push(o); } catch (e) {} });
    setTimeout(() => ws.send(JSON.stringify({ hi: Date.now() })), 50);
  });
  await page.route(/relay\.test/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true,"data":{"ok":true}}' }));
  await page.addInitScript(([ID, TOK, KS, vis]) => {
    window.__vis = vis;
    Object.defineProperty(Document.prototype, "visibilityState", { configurable: true, get() { return window.__vis; } });
    Object.defineProperty(Document.prototype, "hidden", { configurable: true, get() { return window.__vis === "hidden"; } });
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem("oros-gate", JSON.stringify({ on: true, id: ID, tok: TOK, r: "https://relay.test", lv: { layout: "write" }, at: 1, lvd: 1 }));
    localStorage.setItem("oros-gate-seat", JSON.stringify({ id: ID, ss: "S".repeat(43), r: "https://relay.test", m: 1, k: KS }));
  }, [ID, TOK, KS, vis]);
  await page.goto(origin + "/?standalone");
  for (let i = 0; i < 40 && !sock; i++) await page.waitForTimeout(250);
  await page.waitForTimeout(2500);
  return { page, got, raw, sock: () => sock, errs };
}
function unsealWith(K, s) {
  const [iv, ct] = s.split(".").map(unb64u);
  const d = crypto.createDecipheriv("aes-256-gcm", K, iv);
  d.setAuthTag(ct.subarray(ct.length - 16));
  return JSON.parse(Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]).toString("utf8"));
}
function sealWith(K, obj) { const iv = crypto.randomBytes(12); const c = crypto.createCipheriv("aes-256-gcm", K, iv); const ct = Buffer.concat([c.update(JSON.stringify(obj)), c.final(), c.getAuthTag()]); return b64u(iv) + "." + b64u(ct); }

const opt = { skip: PW ? false : "Playwright / Chromium not installed", timeout: 180000 };

test("LOCAL-GONE: local_folders_request answers at once that computer folders by path are gone; nothing is asked or shared", opt, async () => {
  const K = crypto.randomBytes(32), srv = await serve(0);
  const br = await PW.chromium.launch({ args: ["--no-sandbox"] });
  try {
    const o = await open(br, "http://127.0.0.1:" + srv.address().port, K, "hidden");
    const args = { path: "C:\\Users\\Chris\\Books\\Vythos", access: "read", days: 20, reason: "Pictures for the book" };
    o.sock().send(JSON.stringify({ q: "H".repeat(16), n: "local_folders_request", a: args, dl: Date.now() + 25000 }));
    for (let i = 0; i < 20 && !o.got.some((x) => x.r === "H".repeat(16)); i++) await o.page.waitForTimeout(250);
    const hidden = o.got.find((x) => x.r === "H".repeat(16));
    assert.ok(hidden && hidden.ok === false, JSON.stringify(hidden));
    assert.match(hidden.c, /no longer offered/);
    assert.match(hidden.c, /\/internal\/Drive\//);
    assert.match(hidden.c, /claude_folders_request/);
    await o.page.evaluate(() => { window.__vis = "visible"; document.dispatchEvent(new Event("visibilitychange")); });
    o.sock().send(JSON.stringify({ q: "A".repeat(16), n: "local_folders_request", a: args, dl: Date.now() + 25000 }));
    for (let i = 0; i < 20 && !o.got.some((x) => x.r === "A".repeat(16)); i++) await o.page.waitForTimeout(250);
    assert.match(o.got.find((x) => x.r === "A".repeat(16)).c, /no longer offered/);
    assert.equal(await o.page.getByRole("button", { name: "Open for Claude" }).count(), 0, "no question on screen");
    // a list from an older device is ignored; nothing is sent back
    o.sock().send(JSON.stringify({ lf: sealWith(K, { v: 1, l: [] }) }));
    await o.page.waitForTimeout(800);
    assert.equal(o.got.filter((x) => x.lf).length, 0);
    assert.equal(await o.page.evaluate(() => typeof window.orosLocal), "undefined", "localroots.js is not loaded");
    assert.equal(await o.page.locator("#oros-local-bar").count(), 0, "no bar about local folders");
    assert.deepEqual(o.errs, []);
  } finally { await br.close(); srv.close(); }
});

test("TRAY-1/3: an orOS desktop window runs Layout's work and proposals while hidden and says b1; do_action is not kept", opt, async (t) => {
  const K = crypto.randomBytes(32);
  let srv;
  try { srv = await serve(47800); } catch (e) { t.skip("port 47800 is in use"); return; }
  const br = await PW.chromium.launch({ args: ["--no-sandbox"] });
  try {
    const o = await open(br, "http://localhost:47800", K, "hidden");
    assert.ok(o.raw.indexOf("b1") >= 0, "the box hears it can run unseen work: " + JSON.stringify(o.raw.slice(0, 6)));
    o.sock().send(JSON.stringify({ q: "L".repeat(16), n: "rebuild_in_layout", a: { document: "Nothing here" }, dl: Date.now() + 25000 }));
    o.sock().send(JSON.stringify({ q: "P".repeat(16), n: "propose_entry", a: { kind: "todo", title: "x" }, dl: Date.now() + 25000 }));
    for (let i = 0; i < 60 && !(o.got.some((x) => x.r === "L".repeat(16)) && o.got.some((x) => x.r === "P".repeat(16))); i++) await o.page.waitForTimeout(500);
    const l = o.got.find((x) => x.r === "L".repeat(16)), p = o.got.find((x) => x.r === "P".repeat(16));
    assert.ok(l && l.c !== "__screen", "Layout's work ran here: " + JSON.stringify(l));
    assert.ok(p && p.c !== "__screen", "TRAY-3: a proposal opens in the minimised window: " + JSON.stringify(p));
    assert.deepEqual(o.errs, []);
  } finally { await br.close(); srv.close(); }
});
