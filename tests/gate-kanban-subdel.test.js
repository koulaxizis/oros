"use strict";
// KB-SUBDEL (Chris 2026-11-20): removing a Kanban card's subtasks through
// the Gate is a deletion. On screen the owner is asked once, with the
// subtasks' texts, and Delete removes them; with nobody at the screen a
// live call is answered __held (the box keeps it for a screen).
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


const T0 = 1760000000000;
const KD = { ver: 5, om: T0, boardDeleted: {}, boards: [{ id: "b1", name: "Βιβλία", mtime: T0, om: T0, deleted: {}, labels: [], columns: [
  { id: "c1", name: "Αναμονή", mtime: T0, om: T0, cards: [{ id: "k1", text: "Άνθρωποι", notes: "", due: null, labels: [], info: [], mtime: T0,
    subtasks: [{ id: "s1", text: "Διόρθωση", completed: false, m: T0 }, { id: "s2", text: "Εξώφυλλο", completed: false, m: T0 }, { id: "s3", text: "Μένει", completed: false, m: T0 }] }] }] }] };
async function run(hidden) {
  const ID = "GaTeBoX0123456789_-abc", TOK = "T".repeat(43);
  const srv = await serve();
  const br = await PW.chromium.launch({ args: ["--no-sandbox"] });
  try {
    const ctx = await br.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 800 }, locale: "en-US" });
    const page = await ctx.newPage();
    const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
    const got = []; let sock = null;
    await page.routeWebSocket(/relay\.test\/gate\/ws/, (ws) => {
      sock = ws;
      ws.onMessage((m) => { if (m === "ping" || m === "v0" || m === "v1") return; try { const o = JSON.parse(m); if (o.r) got.push(o); } catch (e) {} });
      setTimeout(() => ws.send(JSON.stringify({ hi: Date.now() })), 50);
    });
    await page.route(/relay\.test/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true,"data":{"ok":true}}' }));
    await page.addInitScript(([ID, TOK, KD, hidden]) => {
      if (hidden) {
        Object.defineProperty(Document.prototype, "visibilityState", { configurable: true, get() { return "hidden"; } });
        Object.defineProperty(Document.prototype, "hidden", { configurable: true, get() { return true; } });
      }
      if (sessionStorage.getItem("seeded")) return;
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("oros-gate", JSON.stringify({ on: true, id: ID, tok: TOK, r: "https://relay.test", lv: { kanban: "write" }, at: 1, lvd: 1 }));
      localStorage.setItem("oros-kanban-data", JSON.stringify(KD));
    }, [ID, TOK, KD, hidden]);
    await page.goto("http://127.0.0.1:" + srv.address().port + "/?standalone");
    for (let i = 0; i < 40 && !sock; i++) await page.waitForTimeout(250);
    await page.waitForTimeout(2500);
    sock.send(JSON.stringify({ q: "K".repeat(16), n: "kanban_change_card", a: { board: "Βιβλία", card: "k1", remove_subtasks: ["s1", "Εξώφυλλο"] }, dl: Date.now() + 25000 }));
    const dialog = () => page.evaluate(() => { const d = document.querySelector("[role=dialog] #gate-ask-title"); return d ? d.closest("[role=dialog]").innerText : null; });
    let shown = null;
    for (let i = 0; i < 24 && !shown && !got.length; i++) { await page.waitForTimeout(500); shown = await dialog(); }
    if (shown) await page.evaluate(() => { const b = [...document.querySelectorAll("[role=dialog] button")]; b[b.length - 1].click(); });
    for (let i = 0; i < 20 && !got.length; i++) await page.waitForTimeout(250);
    const left = await page.evaluate(() => JSON.parse(localStorage.getItem("oros-kanban-data")).boards[0].columns[0].cards[0].subtasks.map((s) => s.text));
    return { shown, got, left, errs };
  } finally { await br.close(); srv.close(); }
}
const opt = { skip: PW ? false : "Playwright / Chromium not installed", timeout: 120000 };
test("on screen: removing 2 subtasks asks once with their texts, Delete removes only them", opt, async () => {
  const r = await run(false);
  assert.deepEqual(r.errs, []);
  assert.match(r.shown || "", /Διόρθωση[\s\S]*Εξώφυλλο/);
  assert.doesNotMatch(r.shown || "", /Μένει/);
  assert.equal(r.got[0] && r.got[0].ok, true, JSON.stringify(r.got));
  assert.deepEqual(r.left, ["Μένει"]);
});
test("nobody at the screen: the removal is answered __held and nothing is removed", opt, async () => {
  const r = await run(true);
  assert.deepEqual(r.errs, []);
  assert.equal(r.shown, null);
  assert.ok(r.got[0] && r.got[0].ok === false && r.got[0].c === "__held", JSON.stringify(r.got));
  assert.deepEqual(r.left, ["Διόρθωση", "Εξώφυλλο", "Μένει"]);
});
