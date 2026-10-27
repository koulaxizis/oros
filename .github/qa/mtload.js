// orOS multitasking under load: is it fit to be on by default on a
// desktop? CI / local tool only, never shipped.
//
// In the real shell (served like smoke.js, offline, 1280 px, EN), with
// the switch on and, for comparison, off:
//   open      apps are opened one after the other through the shell
//             (window.__orosOpenApp); time until the front frame has
//             loaded and painted, under CDP CPU throttling (--cpu, 4 =
//             a weak laptop next to the CI machine)
//   memory    whole-browser PSS (every Chromium process, Linux /proc)
//             after each open, minus the shell alone; JS heap of the
//             page's renderer (CDP Performance.getMetrics, same process
//             as the app frames)
//   idle      CPU time used by all Chromium processes during --idle
//             seconds with every app left open (hidden apps should cost
//             close to nothing), not throttled: this is real CPU work
//   back      time to bring each earlier app to the front again: no
//             reload with the switch on, a fresh load with it off
//   live      the app frames alive at the end (slots, LRU)
// navigator.deviceMemory is set with --mem (GB) so the shell's slot
// count is that of the device being imitated.
//
// --attach http://127.0.0.1:PORT measures a browser that is already
// running orOS with --remote-debugging-port (orOS Portable's launcher,
// service worker on), instead of the local server and a fresh Chromium.
//
// Usage: node .github/qa/mtload.js [--apps a,b,...] [--cpu 4] [--mem 4]
//                                   [--idle 30] [--off] [--out file.json]
//                                   [--attach http://127.0.0.1:9333]
"use strict";

const fs = require("fs");
const QA = require("./smoke.js");

const MB = 1048576;
const DEFAULT_APPS = "notes,todo,writer,spreadsheet,files,budget";

function opts(argv) {
  const o = { apps: DEFAULT_APPS.split(","), cpu: 4, mem: 8, idle: 30, off: false, out: null, attach: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--apps") o.apps = (argv[++i] || "").split(",").filter(Boolean);
    else if (k === "--cpu") o.cpu = +argv[++i] || 1;
    else if (k === "--mem") o.mem = +argv[++i] || 0;
    else if (k === "--idle") o.idle = +argv[++i] || 0;
    else if (k === "--off") o.off = true;
    else if (k === "--out") o.out = argv[++i];
    else if (k === "--attach") o.attach = argv[++i];
  }
  return o;
}

function pssOf(pids) {
  let total = 0;
  for (const pid of pids) {
    try {
      const m = /^Pss:\s+(\d+) kB/m.exec(fs.readFileSync("/proc/" + pid + "/smaps_rollup", "utf8"));
      if (m) total += +m[1] * 1024;
    } catch (e) {}
  }
  return total;
}
// utime + stime of every process, in seconds (USER_HZ = 100 on Linux).
function cpuOf(pids) {
  let t = 0;
  for (const pid of pids) {
    try {
      const s = fs.readFileSync("/proc/" + pid + "/stat", "utf8");
      const f = s.slice(s.lastIndexOf(")") + 2).split(" ");
      t += (+f[11] + +f[12]) / 100;
    } catch (e) {}
  }
  return t;
}

// True once the front frame shows `url` fully loaded and painted twice.
function frontReady(url) {
  const f = document.getElementById("app-frame");
  if (!f || f.style.display === "none") return false;
  let w, d;
  try { w = f.contentWindow; d = f.contentDocument; } catch (e) { return false; }
  if (!w || !d || d.readyState !== "complete") return false;
  if (w.location.pathname.indexOf("/" + url.replace(/^\/|index\.html$/g, "")) < 0) return false;
  if (!w.__qaPainted) {
    w.__qaPainted = 1;
    w.requestAnimationFrame(() => w.requestAnimationFrame(() => { w.__qaPainted = 2; }));
    return false;
  }
  return w.__qaPainted === 2;
}

async function main() {
  const o = opts(process.argv.slice(2));
  if (!o.off) process.env.OROS_MULTITASK = "1";
  const { chromium } = QA.loadPlaywright();
  const srv = o.attach ? null : await QA.serve();
  const byId = {};
  for (const x of QA.listApps()) byId[x.id] = x;
  const browser = o.attach ? await chromium.connectOverCDP(o.attach) : await chromium.launch(QA.launchOptions());
  const bcdp = await browser.newBrowserCDPSession();
  const pids = async () => (await bcdp.send("SystemInfo.getProcessInfo")).processInfo.map((x) => x.id);
  const ctx = o.attach ? browser.contexts()[0] : await QA.newContext(browser, 1280, "en");
  if (o.mem) {
    await ctx.addInitScript((m) => {
      try { Object.defineProperty(Navigator.prototype, "deviceMemory", { configurable: true, get: () => m }); } catch (e) {}
    }, o.mem);
  }
  const page = o.attach ? ctx.pages().find((p) => /:47800\//.test(p.url())) || ctx.pages()[0] : await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e).slice(0, 160)));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Performance.enable");
  const metric = async (name) => ((await cdp.send("Performance.getMetrics")).metrics.find((m) => m.name === name) || {}).value || 0;
  const settle = async () => { await cdp.send("HeapProfiler.collectGarbage"); await page.waitForTimeout(1500); };

  if (o.attach) {
    // The launcher's own window: set the switch, start again from the desktop.
    await page.evaluate((on) => { localStorage.setItem("oros-multitask", on ? "1" : "0"); localStorage.setItem("oros-tour-done", "1"); }, !o.off);
    await page.reload({ waitUntil: "load" });
  } else {
    await page.goto("http://127.0.0.1:" + srv.address().port + "/index.html", { waitUntil: "load" });
  }
  await page.waitForFunction(() => window.__orosOpenApp, null, { timeout: 30000 });
  await page.waitForTimeout(3000);
  await settle();
  const pss0 = pssOf(await pids());
  const heap0 = await metric("JSHeapUsedSize");
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: o.cpu });

  const res = { mode: o.off ? "off" : "on", where: o.attach ? "attached" : "local", cpu: o.cpu, deviceMemory: await page.evaluate(() => navigator.deviceMemory),
    apps: o.apps, shellMB: +(pss0 / MB).toFixed(1), open: [], back: [], errors };

  async function bringFront(id) {
    const t = Date.now();
    await page.evaluate((i) => window.__orosOpenApp(i), id);
    await page.waitForFunction(frontReady, byId[id].url, { timeout: 60000, polling: 50 });
    return Date.now() - t;
  }

  for (const id of o.apps) {
    if (!byId[id]) throw new Error("unknown app " + id);
    const ms = await bringFront(id);
    await page.waitForTimeout(1500);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    await settle();
    const pss = pssOf(await pids());
    const heap = await metric("JSHeapUsedSize");
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: o.cpu });
    res.open.push({ id, ms, pssMB: +((pss - pss0) / MB).toFixed(1), heapMB: +((heap - heap0) / MB).toFixed(1) });
    console.log("open " + id + " " + ms + " ms, +" + ((pss - pss0) / MB).toFixed(0) + " MB");
  }
  res.live = await page.evaluate(() => [...document.querySelectorAll("#oros-running iframe")]
    .map((f) => (f.id === "app-frame" ? "*" : "") + (f.getAttribute("data-oros-app") || (f.contentWindow && f.contentWindow.location.pathname) || "?")));

  // Idle: everything open, nobody touches it. Real CPU, not throttled.
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  if (o.idle) {
    const p = await pids();
    const c0 = cpuOf(p), task0 = await metric("TaskDuration"), script0 = await metric("ScriptDuration");
    await page.waitForTimeout(o.idle * 1000);
    const c1 = cpuOf(p), task1 = await metric("TaskDuration"), script1 = await metric("ScriptDuration");
    res.idle = { seconds: o.idle, cpuPct: +((c1 - c0) / o.idle * 100).toFixed(2),
      rendererTaskMs: Math.round((task1 - task0) * 1000), scriptMs: Math.round((script1 - script0) * 1000) };
    console.log("idle " + JSON.stringify(res.idle));
  }
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: o.cpu });

  // Back to each earlier app (most recent first, like the switcher).
  for (const id of o.apps.slice(0, -1).reverse()) {
    const alive = await page.evaluate((i) => {
      const f = [...document.querySelectorAll("#oros-running iframe")].find((x) => x.getAttribute("data-oros-app") === i);
      if (f) try { f.contentWindow.__qaKeep = 1; } catch (e) {}
      return !!f;
    }, id);
    const ms = await bringFront(id);
    const kept = await page.evaluate(() => { try { return !!document.getElementById("app-frame").contentWindow.__qaKeep; } catch (e) { return false; } });
    res.back.push({ id, ms, reloaded: !kept, wasAlive: alive });
    console.log("back " + id + " " + ms + " ms" + (kept ? "" : " (reload)"));
  }
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await settle();
  res.endMB = +((pssOf(await pids()) - pss0) / MB).toFixed(1);

  console.log(JSON.stringify(res));
  if (o.out) fs.writeFileSync(o.out, JSON.stringify(res, null, 2));
  if (o.attach) await bcdp.detach(); else await browser.close();
  if (srv) srv.close();
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(2); });
