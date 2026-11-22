"use strict";
// CF-ASK (Chris 2026-11-22 «Πρόσθεσε τους φακέλους που χρειάζεσαι, σου
// δίνω έγκριση»): Claude asks for a folder of the orOS disk with
// claude_folders_request; hidden, the question is held for a screen
// (__held); on screen the owner taps «Open for Claude» and the folder
// joins Claude's folders (synced list oros-gate-files). The whole disk,
// secret-looking folders and folders already covered are answered at once.
// Real shell in Chromium; relay faked.
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
    localStorage.setItem("oros-gate", JSON.stringify({ on: true, id: ID, tok: TOK, r: "https://relay.test", lv: { files: "read" }, at: 1, lvd: 1 }));
    localStorage.setItem("oros-gate-seat", JSON.stringify({ id: ID, ss: "S".repeat(43), r: "https://relay.test", m: 1, k: KS }));
    localStorage.setItem("oros-gate-files", JSON.stringify({ ver: 1, m: 1, f: ["/internal/Layout/PDF"] }));
  }, [ID, TOK, KS, vis]);
  await page.goto(origin + "/?standalone");
  for (let i = 0; i < 40 && !sock; i++) await page.waitForTimeout(250);
  await page.waitForTimeout(2500);
  return { page, got, raw, sock: () => sock, errs };
}

const opt = { skip: PW ? false : "Playwright / Chromium not installed", timeout: 180000 };

test("CF-ASK: Claude asks for a folder of the orOS disk; hidden it is held, refused ones are answered at once, on screen the owner adds it", opt, async () => {
  const K = crypto.randomBytes(32), srv = await serve(0);
  const br = await PW.chromium.launch({ args: ["--no-sandbox"] });
  try {
    const o = await open(br, "http://127.0.0.1:" + srv.address().port, K, "hidden");
    const ask = async (q, a) => {
      o.sock().send(JSON.stringify({ q: q.repeat(16), n: "claude_folders_request", a, dl: Date.now() + 25000 }));
      for (let i = 0; i < 40 && !o.got.some((x) => x.r === q.repeat(16)); i++) await o.page.waitForTimeout(250);
      return o.got.find((x) => x.r === q.repeat(16));
    };
    const args = { path: "Studio/Podcasts", access: "write", reason: "The «Πλανόδιο» project file for studio_import" };
    const held = await ask("H", args);
    assert.ok(held && held.ok === false && held.c === "__held", "nobody at the screen: kept for one " + JSON.stringify(held));
    assert.match((await ask("D", { path: "/internal" })).c, /not the whole disk/);
    assert.match((await ask("T", { path: ".trash/x" })).c, /not the whole disk/);
    assert.match((await ask("S", { path: "Studio/Passwords" })).c, /keys or secrets/);
    const inside = await ask("I", { path: "Layout/PDF/Vythos" });
    assert.ok(inside.ok);
    assert.match(inside.c, /^Already one of Claude's folders \(inside Layout\/PDF\)/);
    // on screen: asked, the owner allows
    await o.page.evaluate(() => { window.__vis = "visible"; document.dispatchEvent(new Event("visibilitychange")); });
    o.sock().send(JSON.stringify({ q: "A".repeat(16), n: "claude_folders_request", a: args, dl: Date.now() + 25000 }));
    const yes = o.page.getByRole("button", { name: "Open for Claude" });
    await yes.waitFor({ timeout: 10000 });
    assert.ok(await o.page.getByText("Add a folder to Claude's folders?").first().isVisible());
    assert.ok(await o.page.getByText("Studio/Podcasts").first().isVisible());
    await yes.click();
    for (let i = 0; i < 20 && !o.got.some((x) => x.r === "A".repeat(16)); i++) await o.page.waitForTimeout(250);
    const ans = o.got.find((x) => x.r === "A".repeat(16));
    assert.ok(ans && ans.ok, JSON.stringify(ans));
    assert.match(ans.c, /added it to Claude's folders: \/internal\/Studio\/Podcasts/);
    assert.match(ans.c, /Files at write \(it is not now\)/, "write was asked with Files at read");
    const saved = await o.page.evaluate(() => JSON.parse(localStorage.getItem("oros-gate-files")));
    assert.deepEqual(saved.f, ["/internal/Layout/PDF", "/internal/Studio/Podcasts"]);
    assert.ok(saved.m > 1);
    // the same again: already there, nothing asked
    const again = await ask("B", { path: "/internal/Studio/Podcasts" });
    assert.match(again.c, /^Already one of Claude's folders: \/internal\/Studio\/Podcasts/);
    // the owner says no
    o.sock().send(JSON.stringify({ q: "N".repeat(16), n: "claude_folders_request", a: { path: "Music" }, dl: Date.now() + 25000 }));
    const no = o.page.getByRole("button", { name: "Don't open" });
    await no.waitFor({ timeout: 10000 });
    await no.click();
    for (let i = 0; i < 20 && !o.got.some((x) => x.r === "N".repeat(16)); i++) await o.page.waitForTimeout(250);
    assert.match(o.got.find((x) => x.r === "N".repeat(16)).c, /did not add that folder/);
    assert.deepEqual(await o.page.evaluate(() => JSON.parse(localStorage.getItem("oros-gate-files")).f), ["/internal/Layout/PDF", "/internal/Studio/Podcasts"]);
    assert.deepEqual(o.errs, []);
  } finally { await br.close(); srv.close(); }
});
