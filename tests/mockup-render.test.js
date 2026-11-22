"use strict";
// GATE-PL10 (Chris 2026-11-22, dogfooding the podcast Planodio, item 10):
// mockup_render. One of the owner's mockups is the template, a picture
// from the orOS disk goes into a slot, Mockups draws it and saves a new
// picture under a free name (never over a file); the template is not
// changed and no mockup is added. Pure parts in Node, the real app in the
// shell in Chromium (WebGL through SwiftShader).
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const http = require("http");
const ROOT = path.join(__dirname, "..");
const MC = require(path.join(ROOT, "mockups/core.js"));
const AC = require(path.join(ROOT, "assistant/core.js"));
let R;
test.before(async () => { R = await import(path.join(ROOT, "relay/gate.js")); });

test("GATE-PL10: requests, templates, slots and names are checked", () => {
  const q = MC.renderReq({ template: "Βυθός", image: "/internal/Mockups/Claude/front.png" });
  assert.deepEqual(q.out, ["/internal/Mockups/Claude"]);
  assert.equal(MC.renderReq({ template: "x", image: "/internal/../a.png" }), null);
  assert.equal(MC.renderReq({ template: "x", image: "/etc/a.png" }), null);
  assert.equal(MC.renderReq({ template: "x", image: "/internal/a.txt" }), null, "a picture only");
  assert.equal(MC.renderReq({ template: "x", image: "/internal/a.png", out: "/internal/.trash" }), null);
  assert.equal(MC.renderReq({ template: "x", image: "local:Pics/a.jpg", out: "local:Out/Mockups" }).out[0], "local:Out/Mockups");
  const list = [{ id: "k1", nm: "Βυθός", kind: "book", m: 1 }, { id: "k2", nm: "Βυθός 2", kind: "book", m: 2 }, { id: "k3", nm: "Κύκλοι", kind: "book", m: 3, del: 1 }];
  assert.equal(MC.pickTemplate(list, "ΒΥΘΟΣ").p.id, "k1", "the same name first, case and accents aside");
  assert.equal(MC.pickTemplate(list, "Βυθ").err, "several");
  assert.equal(MC.pickTemplate(list, "Κύκλοι").err, "none", "a deleted mockup is no template");
  assert.equal(MC.renderSlot({ kind: "book", art: { mode: "parts" } }, ""), "front");
  assert.equal(MC.renderSlot({ kind: "book", art: { mode: "wrap" } }, ""), "wrap");
  assert.equal(MC.renderSlot({ kind: "book", art: {} }, "disc"), "", "a book has no disc");
  assert.equal(MC.renderName({ image: "/internal/a/Εξώφυλλο.png" }, "Βυθός", "png"), "Βυθός - Εξώφυλλο.png");
  assert.equal(MC.renderName({ image: "/internal/a/x.png", name: "a/b:c" }, "T", "jpg"), "a b c.jpg");
  // the Assistant's check and report
  assert.equal(AC.normMockup({ template: "Βυθός", image: "/internal/a.png" }).out, "/internal/Mockups/Claude");
  assert.match(AC.normMockup({ template: "Βυθός", image: "C:/a.png" }).err, /image/);
  assert.match(AC.normMockup({ template: "", image: "/internal/a.png" }).err, /template/);
  assert.match(AC.mockupText({ failed: 1, why: "noTemplate", names: ["Βυθός"] }), /no mockup has that name[\s\S]*Nothing was saved/);
  const t = AC.gateTools(AC.toolsFor({ mockup: true })).find((x) => x.name === "mockup_render");
  assert.ok(t, "offered through the gate");
  assert.doesNotMatch(t.description, /card|presses/);
  assert.match(t.description, /Mockups\/Claude/);
  // the relay with orOS closed
  const idx = { f: ["/internal/Mockups/Claude"], files: [{ p: "/internal/Mockups/Claude/front.png" }] };
  assert.equal(R.minVer("mockup_render", {}), 85500, "GQ-VER: waits for an orOS that knows mockup_render (8.55.00)");
  assert.deepEqual(R.mockupCheck({ tpl: ["Βυθός"] }, { template: "βυθος", image: "/internal/Mockups/Claude/front.png" }, idx, [], { files: "write" }), []);
  assert.match(R.mockupCheck({ tpl: ["Βυθός"] }, { template: "Κύκλοι", image: "/internal/Mockups/Claude/front.png" }, idx, [], { files: "write" })[0], /no mockup is called "Κύκλοι"; mockups: "Βυθός"/);
  assert.match(R.mockupCheck(null, { template: "x", image: "/internal/Mockups/Claude/new.png" }, idx, [], { files: "write" })[0], /neither in the copy/);
  assert.deepEqual(R.mockupCheck(null, { template: "x", image: "/internal/Mockups/Claude/new.png" }, idx, ["/internal/Mockups/Claude/new.png"], { files: "write" }), [], "a waiting files_write counts");
  assert.match(R.mockupCheck(null, { template: "x", image: "local:P/a.png" }, idx, [], { files: "read" }).join(" "), /Files at «may change»/);
  assert.match(R.mockupCheck(null, { template: "x", image: "local:P/a.png", out: "/internal/Else" }, idx, [], { files: "write" }).join(" "), /outside Claude's folders/);
  assert.deepEqual(R.mockupCheck(null, { template: "x", image: "local:P/a.png", out: "local:Out" }, null, [], {}), [], "a local folder is checked on the device");
});

function chromium() {
  for (const mod of ["playwright", "/opt/node22/lib/node_modules/playwright"]) {
    try { const pw = require(mod); const exe = pw.chromium.executablePath(); if (exe && fs.existsSync(exe)) return pw; } catch (e) {}
  }
  return null;
}
const PW = chromium();
const MIME = { ".html": "text/html", ".js": "application/javascript", ".mjs": "application/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml",
  ".txt": "text/plain", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2", ".png": "image/png", ".jpg": "image/jpeg", ".glb": "model/gltf-binary", ".hdr": "application/octet-stream" };
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

test("GATE-PL10: Mockups makes the picture in the real shell, never over a file", { skip: !PW && "no Chromium", timeout: 120000 }, async () => {
  const id = MC.newId(), tpl = MC.blank(id, 1);
  tpl.nm = "Βυθός";
  const data = MC.put(MC.empty(), tpl, 2).data;
  const srv = await serve();
  const br = await PW.chromium.launch({ args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
  try {
    const ctx = await br.newContext({ serviceWorkers: "block", locale: "en-US", viewport: { width: 1200, height: 800 } });
    const page = await ctx.newPage();
    await page.route(/relay\.test/, (r) => r.abort());
    await page.addInitScript((d) => {
      if (sessionStorage.getItem("seeded")) return;
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("oros-mockups-data", d);
    }, JSON.stringify(data));
    await page.goto("http://127.0.0.1:" + srv.address().port + "/?standalone");
    await page.waitForFunction(() => window.orosFS && typeof window.__orosOpenAt === "function", null, { timeout: 20000 });
    const r = await page.evaluate(async () => {
      const cv = document.createElement("canvas"); cv.width = 300; cv.height = 450;
      const x = cv.getContext("2d"); x.fillStyle = "#1a4f8a"; x.fillRect(0, 0, 300, 450); x.fillStyle = "#fff"; x.fillRect(40, 60, 220, 80);
      const png = await new Promise((ok) => cv.toBlob(ok, "image/png"));
      await window.orosFS.mkdir("/internal/Mockups/Claude");
      await window.orosFS.write("/internal/Mockups/Claude/front.png", png);
      const before = localStorage.getItem("oros-mockups-data");
      const st = window.orosAssistAtt || (window.orosAssistAtt = {});
      const ask = (key, extra) => new Promise((ok) => {
        const t0 = Date.now();
        window.__orosOpenAt("mockups", { render: Object.assign({ key, template: "βυθός", image: "/internal/Mockups/Claude/front.png" }, extra || {}) });
        (function wait() { if (st.rb && st.rb[key]) ok(st.rb[key]); else if (Date.now() - t0 > 60000) ok({ timeout: 1 }); else setTimeout(wait, 250); })();
      });
      const out = {};
      out.a = await ask("k-one");
      out.b = await ask("k-two");
      out.none = await ask("k-three", { template: "Κύκλοι" });
      out.slot = await ask("k-four", { slot: "disc" });
      const ls = await window.orosFS.ls("/internal/Mockups/Claude");
      out.files = ls.map((e) => e.name).sort();
      const blob = await window.orosFS.read(out.a.path || "/none");
      out.sig = blob ? Array.from(new Uint8Array(await blob.slice(0, 4).arrayBuffer())) : null;
      out.same = localStorage.getItem("oros-mockups-data") === before;
      return out;
    });
    if (r.a.why === "nogl") { test.skip && console.log("# no WebGL in this Chromium: drawing not checked"); return; }
    assert.equal(r.a.ok, 1, JSON.stringify(r.a));
    assert.equal(r.a.path, "/internal/Mockups/Claude/Βυθός - front.png");
    assert.equal(r.a.slot, "front");
    assert.ok(r.a.w > 100 && r.a.h > 100 && r.a.bytes > 1000, JSON.stringify(r.a));
    assert.deepEqual(r.sig, [0x89, 0x50, 0x4e, 0x47], "a PNG");
    assert.equal(r.b.path, "/internal/Mockups/Claude/Βυθός - front (1).png", "a taken name gets a new one, never over a file");
    assert.equal(r.none.why, "noTemplate");
    assert.deepEqual(r.none.names, ["Βυθός"]);
    assert.equal(r.slot.why, "badSlot");
    assert.deepEqual(r.files, ["front.png", "Βυθός - front (1).png", "Βυθός - front.png"].sort());
    assert.equal(r.same, true, "the template and the mockup list are unchanged");
  } finally { await br.close(); srv.close(); }
});
