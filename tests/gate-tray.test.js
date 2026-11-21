"use strict";
// TRAY-1 + TRAY-2 (Chris 2026-11-21 «να δουλεύεις με το orOS κλειστό στο
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
const L = require(path.join(ROOT, "localroots.js"));

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

test("TRAY-2: Claude asks for a computer folder; hidden it is held, on screen the owner allows it and it is shared sealed; a removal from another device closes it", opt, async () => {
  const K = crypto.randomBytes(32), srv = await serve(0);
  const br = await PW.chromium.launch({ args: ["--no-sandbox"] });
  try {
    const o = await open(br, "http://127.0.0.1:" + srv.address().port, K, "hidden");
    const args = { path: "C:\\Users\\Chris\\Books\\Vythos", access: "read", days: 20, reason: "Pictures for the book" };
    o.sock().send(JSON.stringify({ q: "H".repeat(16), n: "local_folders_request", a: args, dl: Date.now() + 25000 }));
    for (let i = 0; i < 20 && !o.got.some((x) => x.r === "H".repeat(16)); i++) await o.page.waitForTimeout(250);
    const held = o.got.find((x) => x.r === "H".repeat(16));
    assert.ok(held && held.ok === false && held.c === "__held", "nobody at the screen: kept for one " + JSON.stringify(held));
    // a risky folder is refused at once
    o.sock().send(JSON.stringify({ q: "R".repeat(16), n: "local_folders_request", a: { path: "C:\\Users\\Chris" }, dl: Date.now() + 25000 }));
    for (let i = 0; i < 20 && !o.got.some((x) => x.r === "R".repeat(16)); i++) await o.page.waitForTimeout(250);
    assert.match(o.got.find((x) => x.r === "R".repeat(16)).c, /cannot be opened for Claude/);
    // on screen: asked, the owner allows
    await o.page.evaluate(() => { window.__vis = "visible"; document.dispatchEvent(new Event("visibilitychange")); });
    o.sock().send(JSON.stringify({ q: "A".repeat(16), n: "local_folders_request", a: args, dl: Date.now() + 25000 }));
    const yes = o.page.getByRole("button", { name: "Open for Claude" });
    await yes.waitFor({ timeout: 10000 });
    assert.ok(await o.page.getByText("C:\\Users\\Chris\\Books\\Vythos").first().isVisible());
    await yes.click();
    for (let i = 0; i < 20 && !o.got.some((x) => x.r === "A".repeat(16)); i++) await o.page.waitForTimeout(250);
    const ans = o.got.find((x) => x.r === "A".repeat(16));
    assert.ok(ans && ans.ok, JSON.stringify(ans));
    assert.match(ans.c, /local:Vythos/);
    for (let i = 0; i < 20 && !o.got.some((x) => x.lf); i++) await o.page.waitForTimeout(250);
    const lf = o.got.filter((x) => x.lf).pop();
    assert.ok(lf, "the list went to the box, sealed");
    assert.ok(lf.lf.indexOf("Vythos") < 0, "the relay cannot read it");
    const d = unsealWith(K, lf.lf);
    assert.equal(d.v, 1);
    assert.equal(d.l.length, 1);
    assert.deepEqual([d.l[0].pc, d.l[0].mode, d.l[0].by, d.l[0].name], ["/disks/C/Users/Chris/Books/Vythos", "r", "claude", "Vythos"]);
    // the same again: already open, nothing asked
    o.sock().send(JSON.stringify({ q: "B".repeat(16), n: "local_folders_request", a: { path: "C:\\Users\\Chris\\Books\\Vythos", days: 5 }, dl: Date.now() + 25000 }));
    for (let i = 0; i < 20 && !o.got.some((x) => x.r === "B".repeat(16)); i++) await o.page.waitForTimeout(250);
    assert.match(o.got.find((x) => x.r === "B".repeat(16)).c, /^Already open/);
    // another device closed it
    o.sock().send(JSON.stringify({ lf: sealWith(K, { v: 1, l: [{ id: d.l[0].id, m: d.l[0].m + 5, gone: 1 }] }) }));
    for (let i = 0; i < 20; i++) { const n = await o.page.evaluate(() => window.orosLocal.names().length); if (!n) break; await o.page.waitForTimeout(250); }
    assert.equal(await o.page.evaluate(() => window.orosLocal.names().length), 0);
    assert.deepEqual(await o.page.evaluate(() => JSON.parse(localStorage.getItem("oros-local-pc")).map((e) => !!e.gone)), [true]);
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

test("TRAY-2 pure: the shared list merges by newest change, keeps removals, refuses risky folders", () => {
  const now = 1790000000000, D = 86400000;
  const a = { id: "lrabc123", pc: "/disks/C/Users/Chris/Books/Vythos", label: "C:/Users/Chris/Books/Vythos", name: "Vythos", mode: "r", exp: now + 30 * D, m: now };
  assert.deepEqual(L.pcMerge([a], [], now).map((e) => e.id), ["lrabc123"]);
  const later = Object.assign({}, a, { exp: now + 60 * D, m: now + 10 });
  assert.equal(L.pcMerge([a], [later], now)[0].exp, now + 60 * D, "the newest change wins");
  assert.equal(L.pcMerge([later], [a], now)[0].exp, now + 60 * D, "either order");
  const gone = { id: "lrabc123", m: now + 10, gone: 1 };
  assert.deepEqual(L.pcMerge([later], [gone], now)[0], gone, "a tie: the removal");
  assert.deepEqual(L.pcMerge([gone], [], now + 91 * D), [], "old removals are forgotten");
  assert.equal(L.pcMerge([Object.assign({}, a, { pc: "/disks/C/Users/Chris" })], [], now).length, 0, "the home folder is never kept");
  assert.equal(L.pcMerge([Object.assign({}, a, { pc: "/disks/C/x/../y" })], [], now).length, 0);
  assert.equal(L.pcMerge([Object.assign({}, a, { id: "evil" })], [], now).length, 0);
  for (const p of ["/disks/C", "/disks/D", "/disks/C/Users", "/disks/C/Users/Chris", "/home/chris", "/disks/C/Users/Chris/AppData/Roaming/x", "/disks/C/Windows/System32", "/home/chris/.ssh", "/disks/C/Program Files/x"]) assert.equal(L.pcRisky(p), true, p);
  for (const p of ["/disks/C/Users/Chris/Documents/Εκδόσεις", "/disks/D/Books", "/home/chris/Books"]) assert.equal(L.pcRisky(p), false, p);
});
