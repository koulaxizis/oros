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

// GATE-PL9 (Chris 2026-11-22, «Πλανόδιο» item 9): Studio, Montage and
// Mockups bring their own folder into Claude's folders with no setup; the
// folders are made on the disk, never stored in the owner's list (a device
// that has not pulled the list yet must not write over it), and Remove
// takes one off for good (nd, synced) until the owner adds it again.
test("Claude's folders: the app folders come by themselves and can be taken off", { skip: !PW && "no Chromium" }, async () => {
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
    await page.waitForFunction(() => window.orosGate && typeof window.orosGate.appFolders === "function" && window.orosFS && typeof window.orosAssistApps === "function", null, { timeout: 20000 });
    const r = await page.evaluate(async () => {
      const G = window.orosGate, out = {};
      const ids = window.orosAssistApps().map((a) => a.id);
      out.installed = ["studio", "montage", "mockups"].filter((id) => ids.indexOf(id) >= 0);
      out.app = G.appFolders();
      out.list = G.folders();
      out.stored = JSON.parse(localStorage.getItem("oros-gate-files")).f;
      // the folders are made on the disk (gate start, after 12 s; here at once through an export)
      out.saved = await G.exportTo(out.app[0], "a.png", new Blob(["x"]), "mockup_render").then((p) => p, (e) => "!" + (e && e.why));
      // Remove takes it off, and it stays off
      await G.setFolders(G.folders().filter((f) => f !== out.app[0]));
      out.afterRm = G.folders();
      out.nd = JSON.parse(localStorage.getItem("oros-gate-files")).nd;
      out.storedRm = JSON.parse(localStorage.getItem("oros-gate-files")).f;
      out.outside = await G.exportTo(out.app[0], "b.png", new Blob(["x"]), "t").then((p) => p, (e) => "!" + (e && e.why));
      // adding it again brings it back
      await G.setFolders(G.folders().concat([out.app[0]]));
      out.back = G.folders();
      out.ndBack = JSON.parse(localStorage.getItem("oros-gate-files")).nd;
      // a folder above an app folder covers it: not marked off
      await G.setFolders(G.folders().concat(["/internal/Studio"]));
      out.parent = G.folders();
      out.ndParent = JSON.parse(localStorage.getItem("oros-gate-files")).nd;
      return out;
    });
    const want = { studio: "/internal/Studio/Podcasts", montage: "/internal/Montage/Projects", mockups: "/internal/Mockups/Claude" };
    assert.deepEqual(r.app, r.installed.map((id) => want[id]));
    assert.ok(r.app.length >= 1, "at least one of Studio, Montage, Mockups is installed by default (" + r.installed + ")");
    assert.deepEqual(r.list, ["/internal/Drive/Out"].concat(r.app).sort());
    assert.deepEqual(r.stored, ["/internal/Drive/Out"], "the app folders are never stored in the owner's list");
    assert.equal(r.saved, r.app[0] + "/a.png");
    assert.ok(r.afterRm.indexOf(r.app[0]) < 0);
    assert.deepEqual(r.nd, [r.app[0]]);
    assert.deepEqual(r.storedRm, ["/internal/Drive/Out"]);
    assert.equal(r.outside, "!outside", "taken off: Claude may not write there");
    assert.ok(r.back.indexOf(r.app[0]) >= 0);
    assert.equal(r.ndBack, undefined);
    assert.ok(r.parent.indexOf("/internal/Studio") >= 0);
    assert.equal(r.ndParent, undefined, "an app folder under a listed folder is not taken off");
  } finally { await br.close(); srv.close(); }
});
