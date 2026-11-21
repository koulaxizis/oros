"use strict";
// GX-1 (Chris 2026-11-21 «δώσε στο gate τη δυνατότητα να μπορεί να κάνει
// εξαγωγή σε τοπικό φάκελο ή/και orOS Files»): orosGate.exportTo writes an
// app's export into a folder of Claude's on the orOS disk (Files at «may
// change»), never over a file, and refuses outside Claude's folders, with
// Files at read, while paused and with the gate off. Real shell in Chromium.
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
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

test("orosGate.exportTo: Claude's folders only, Files at write, never overwrites", { skip: !PW && "no Chromium" }, async () => {
  const srv = await serve();
  const br = await PW.chromium.launch({ args: ["--no-sandbox"] });
  try {
    const ctx = await br.newContext({ serviceWorkers: "block", locale: "en-US" });
    const page = await ctx.newPage();
    await page.route(/relay\.test/, (r) => r.abort());
    await page.addInitScript(() => {
      if (sessionStorage.getItem("seeded")) return;
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("oros-gate", JSON.stringify({ on: true, id: "GaTeBoX0123456789_-abc", tok: "T".repeat(43), r: "https://relay.test", lv: { files: "write" }, at: 1, lvd: 1 }));
      localStorage.setItem("oros-gate-files", JSON.stringify({ ver: 1, m: 1, f: ["/internal/Drive/Out"] }));
    });
    await page.goto("http://127.0.0.1:" + srv.address().port + "/?standalone");
    await page.waitForFunction(() => window.orosGate && typeof window.orosGate.exportTo === "function" && window.orosFS, null, { timeout: 20000 });
    const r = await page.evaluate(async () => {
      const G = window.orosGate, blob = () => new Blob(["%PDF-1.7 x"], { type: "application/pdf" });
      const go = (o, n) => G.exportTo(o, n || "Βυθός - PDF-X-4.pdf", blob(), "export_pdf").then((p) => p, (e) => "!" + (e && e.why));
      const out = {};
      out.a = await go("/internal/Drive/Out/Proofs");
      out.b = await go("/internal/Drive/Out/Proofs");
      out.text = await window.orosFS.readText("/internal/Drive/Out/Proofs/Βυθός - PDF-X-4.pdf");
      out.outside = await go("/internal/Drive/Else");
      out.bad = await go("/internal/Drive/Out", "a/b.pdf");
      const g = JSON.parse(localStorage.getItem("oros-gate"));
      out.all = await G.exportAll(["/internal/Drive/Out/Many", "/internal/Drive/Else"], [{ name: "p1.png", blob: blob() }, { name: "p2.png", blob: blob() }], "export");
      g.lv.files = "read"; localStorage.setItem("oros-gate", JSON.stringify(g));
      out.read = await go("/internal/Drive/Out");
      g.lv.files = "write"; g.hold = Date.now() + 3600000; localStorage.setItem("oros-gate", JSON.stringify(g));
      out.paused = await go("/internal/Drive/Out");
      g.hold = 0; g.on = false; localStorage.setItem("oros-gate", JSON.stringify(g));
      out.off = await go("/internal/Drive/Out");
      out.local = await G.exportTo("local:Nowhere", "a.pdf", blob(), "t").then((p) => p, (e) => "!" + (e && e.why));
      return out;
    });
    assert.equal(r.a, "/internal/Drive/Out/Proofs/Βυθός - PDF-X-4.pdf");
    assert.equal(r.b, "/internal/Drive/Out/Proofs/Βυθός - PDF-X-4-2.pdf", "a taken name gets -2");
    assert.equal(r.text, "%PDF-1.7 x");
    assert.equal(r.outside, "!outside");
    assert.deepEqual(r.all, { saved: ["/internal/Drive/Out/Many/p1.png", "/internal/Drive/Out/Many/p2.png"], outFail: [{ to: "/internal/Drive/Else", why: "outside" }] });
    assert.equal(r.bad, "!badName");
    assert.equal(r.read, "!notAllowed");
    assert.equal(r.paused, "!paused");
    assert.equal(r.off, "!gateOff");
    assert.ok(/^!/.test(r.local), "no local folder open: refused (" + r.local + ")");
  } finally { await br.close(); srv.close(); }
});
