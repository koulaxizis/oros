"use strict";
// NOTIF-OS (Chris 2026-11-28): under orOS on the computer (the launcher
// at localhost:47800) a notification nobody looks at goes to the tray,
// which shows it as the system's own; private apps go without text; the
// browser's own Notification stays the fallback; the tray's background
// orOS for reminders says bye when a window wants the profile.
// Real shell in Chromium at 127.0.0.1:47800; the launcher is faked.
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const http = require("http");
const ROOT = path.join(__dirname, "..");

function chromium() {
  for (const mod of ["playwright", "/opt/node22/lib/node_modules/playwright"]) {
    try {
      const pw = require(mod);
      const exe = pw.chromium.executablePath();
      if (exe && fs.existsSync(exe)) return pw;
    } catch (e) {}
  }
  return null;
}
const PW = chromium();

const MIME = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".txt": "text/plain",
  ".webmanifest": "application/manifest+json", ".woff2": "font/woff2" };
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
    srv.on("error", () => res(null));
    srv.listen(47800, "127.0.0.1", () => res(srv));
  });
}

async function ready(page) {
  await page.waitForFunction(() => window.orosNotifs && window.orosNotifs.getSlice && window.orosNotifs.getSlice(), null, { timeout: 30000 });
}

test("NOTIF-OS: notices go to the tray when nobody looks, private apps without text", { skip: !PW && "no Chromium" }, async () => {
  const srv = await serve();
  if (!srv) return test.skip("port 47800 in use");
  const br = await PW.chromium.launch({ args: ["--no-sandbox"] });
  try {
    const ctx = await br.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 800 }, locale: "en-US" });
    const page = await ctx.newPage();
    const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
    const posts = [];
    let deskOk = true;
    await page.route(/\/__oros\/notify/, (r) => {
      const q = r.request();
      if (q.method() === "GET") return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: deskOk }) });
      const b = JSON.parse(q.postData());
      if (b.app !== "discover") posts.push({ body: b, hdr: q.headers() });   // the shell's own weekly suggestion may come too
      return r.fulfill({ status: deskOk ? 204 : 503, body: "" });
    });
    await page.addInitScript(() => {
      window.__webN = [];
      function N(title, o) { window.__webN.push({ title: title, body: o && o.body }); }
      N.permission = "granted";
      window.Notification = N;
      window.__look = false;
      document.hasFocus = function () { return window.__look; };
    });
    await page.goto("http://127.0.0.1:47800/?standalone");
    await ready(page);
    await page.waitForFunction(() => window.orosNotifs.desk().ok === true, null, { timeout: 10000 });
    const fire = (it) => page.evaluate((it) => window.orosNotifs.fireToast(Object.assign({ id: "n" + Math.random() }, it), false), it);
    const settle = () => page.waitForTimeout(300);

    // 1) nobody looks: to the tray, with the app and the tag
    await fire({ ns: "calendar", title: "Dentist", body: "Tomorrow 10:00", dedupKey: "cal:1" });
    await settle();
    assert.equal(posts.length, 1);
    assert.deepEqual(posts[0].body, { title: "Dentist", body: "Tomorrow 10:00", app: "calendar", tag: "cal:1" });
    assert.equal(posts[0].hdr["x-oros-notify"], "1");
    assert.equal((await page.evaluate(() => window.__webN.length)), 0, "no second, browser notification");

    // 2) a private app: its name and "New notification", never its text
    await fire({ ns: "diary", title: "Secret entry", body: "Very private words", dedupKey: "diary:1" });
    await settle();
    assert.equal(posts.length, 2);
    assert.ok(!/Secret|private words/.test(JSON.stringify(posts[1].body)), JSON.stringify(posts[1].body));
    assert.equal(posts[1].body.app, "diary");
    assert.ok(posts[1].body.body.length > 0);

    // ... unless the owner allows it
    await page.evaluate(() => window.orosNotifs.setSetting("osShowPrivate", true));
    await fire({ ns: "diary", title: "Secret entry", body: "Very private words", dedupKey: "diary:2" });
    await settle();
    assert.equal(posts[2].body.title, "Secret entry");
    await page.evaluate(() => window.orosNotifs.setSetting("osShowPrivate", false));

    // 3) looking at the window: the in-tab toast only
    await page.evaluate(() => { window.__look = true; });
    await fire({ ns: "todo", title: "Call Anna", body: "", dedupKey: "todo:1" });
    await settle();
    assert.equal(posts.length, 3, JSON.stringify(posts.map((p) => p.body)));
    await page.evaluate(() => { window.__look = false; });

    // 4) catch-up and transient notices stay in orOS; the switch turns it off
    await page.evaluate(() => window.orosNotifs.fireToast({ id: "c1", ns: "calendar", title: "Old", body: "", dedupKey: "old" }, true));
    await fire({ ns: "system", type: "transient", title: "Saved", body: "" });
    await page.evaluate(() => window.orosNotifs.setSetting("osNotify", false));
    await fire({ ns: "calendar", title: "Off", body: "", dedupKey: "cal:off" });
    await settle();
    assert.equal(posts.length, 3, JSON.stringify(posts.slice(3).map((p) => p.body)));
    assert.equal((await page.evaluate(() => window.__webN.length)), 0);
    await page.evaluate(() => window.orosNotifs.setSetting("osNotify", true));

    // 5) the tray went away (503): the browser's own notification, private text hidden there too
    deskOk = false;
    await fire({ ns: "mood", title: "Feeling low", body: "details", dedupKey: "mood:1" });
    await settle();
    assert.equal(posts.length, 4);
    const web = await page.evaluate(() => window.__webN);
    assert.equal(web.length, 1);
    assert.ok(!/Feeling low|details/.test(JSON.stringify(web)), JSON.stringify(web));
    // ... and after that the browser's own directly
    await fire({ ns: "calendar", title: "Lunch", body: "13:00", dedupKey: "cal:2" });
    await settle();
    assert.equal(posts.length, 4);
    assert.equal((await page.evaluate(() => window.__webN.length)), 2);
    assert.deepEqual(errs, []);
  } finally {
    await br.close();
    srv.close();
  }
});

test("NOTIF-OS wave 2: the background orOS for reminders says bye when a window wants the profile", { skip: !PW && "no Chromium" }, async () => {
  const srv = await serve();
  if (!srv) return test.skip("port 47800 in use");
  const br = await PW.chromium.launch({ args: ["--no-sandbox"] });
  try {
    const ctx = await br.newContext({ serviceWorkers: "block", locale: "en-US",
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.0.0 Safari/537.36" });
    const page = await ctx.newPage();
    const NONCE = "Q".repeat(24);
    let yieldNow = false, bye = 0;
    const posts = [];
    await page.route(/\/__oros\/notify/, (r) => {
      if (r.request().method() === "GET") return r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
      posts.push(JSON.parse(r.request().postData()));
      return r.fulfill({ status: 204, body: "" });
    });
    await page.route(/\/__oros\/gate-host/, (r) => {
      const u = r.request().url();
      if (u.indexOf("bye=1") > 0) bye++;
      const mine = u.indexOf("n=" + NONCE) > 0;
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ can: true, on: false, bg: true, notify: true, host: false, kind: mine ? "bg" : undefined, notifyHost: mine && !yieldNow, yield: mine && yieldNow }) });
    });
    await page.goto("http://127.0.0.1:47800/?standalone&gate-host=" + NONCE);
    await ready(page);
    await page.waitForFunction(() => window.orosNotifs.desk().ok === true, null, { timeout: 10000 });
    // No screen: every notice goes to the tray, even "visible".
    await page.evaluate(() => window.orosNotifs.fireToast({ id: "a1", ns: "time", title: "Alarm", body: "07:00", dedupKey: "alarm:1" }, false));
    await page.waitForTimeout(300);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].title, "Alarm");
    await page.waitForTimeout(2500);
    assert.equal(bye, 0, "no bye while it runs");
    yieldNow = true;
    await page.waitForTimeout(9500);
    assert.equal(bye, 1, "bye once after the yield");
    // The Settings state: the switch can be shown and is on.
    const st = await page.evaluate(() => window.orosNotifs.bgState());
    assert.deepEqual(st, { can: true, on: true });
  } finally {
    await br.close();
    srv.close();
  }
});
