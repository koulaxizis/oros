// orOS quality gate: the on-screen keyboard (osk.js) in a real
// Chromium with a touch screen. CI only, like smoke.js.
//
// The shell at 1280×800 with touch (a Linux touch laptop: the keyboard
// opens by itself):
//   • a tap with a finger in To-Do's "Add a task" opens it, Greek
//     letters with an accent go in at the caret, Enter adds the task;
//   • the field stays above the keyboard; a real key press closes it;
//   • a mouse click opens nothing; the top-bar button opens it;
//   • a textarea gets a new line and Backspace; Writer's page
//     (contentEditable) gets text;
//   • axe-core finds no critical or serious problem with it open;
//   • at 360 px (a phone) there is no keyboard and no button.
//
// Usage: node .github/qa/osk.js [--out file]
"use strict";

const fs = require("fs");
const path = require("path");
const QA = require("./smoke.js");

function axeSource() {
  const tries = [path.join(__dirname, "node_modules", "axe-core", "axe.min.js")];
  try { tries.push(require.resolve("axe-core/axe.min.js")); } catch (e) {}
  for (const t of tries) if (fs.existsSync(t)) return fs.readFileSync(t, "utf8");
  return null;
}

async function main() {
  const out = process.argv.indexOf("--out") > 0 ? process.argv[process.argv.indexOf("--out") + 1] : null;
  const { chromium } = QA.loadPlaywright();
  const srv = await QA.serve();
  const base = "http://127.0.0.1:" + srv.address().port + "/";
  const browser = await chromium.launch(QA.launchOptions());
  const fails = [], notes = [];
  const ok = (cond, what) => { (cond ? notes : fails).push(what); if (!cond) console.log("FAIL " + what); };

  async function shell(width, lang) {
    const ctx = await browser.newContext({
      viewport: { width, height: width <= 400 ? 780 : 800 }, deviceScaleFactor: 1,
      serviceWorkers: "block", hasTouch: true, isMobile: width <= 400,
    });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (r) => r.abort("internetdisconnected"));
    await ctx.addInitScript((lang) => {
      try {
        localStorage.setItem("oros-lang", lang);
        localStorage.setItem("oros-tour-done", "1");
        sessionStorage.setItem("oros-skip-splash", "1");
      } catch (e) {}
    }, lang);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => fails.push("page error: " + String(e.message || e).split("\n")[0]));
    await page.goto(base + "index.html", { waitUntil: "load" });
    await page.waitForTimeout(1500);
    return { ctx, page };
  }
  async function openApp(page, id, sel) {
    await page.evaluate((id) => window.__orosOpenApp(id), id);
    const f = page.frameLocator("#app-frame");
    await f.locator(sel).first().waitFor({ timeout: 15000 });
    return f;
  }
  const oskOpen = (page) => page.evaluate(() => !!(window.orosOsk && window.orosOsk.isOpen()) && !document.getElementById("osk").hidden);
  async function key(page, label) {
    const k = page.locator("#osk .osk-key").filter({ hasText: new RegExp("^" + label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$") }).first();
    await k.tap();
  }
  async function special(page, cls) { await page.locator("#osk .osk-" + cls).first().tap(); }

  try {
    // ---- Linux touch laptop, Greek ----
    let { ctx, page } = await shell(1280, "el");
    ok(await page.locator("#osk-btn").count() === 1, "top-bar button on a touch screen");
    let f = await openApp(page, "todo", "#quick-add");
    await f.locator("#search").click();                       // a mouse click
    await page.waitForTimeout(300);
    ok(!(await oskOpen(page)), "a mouse click opens no keyboard");
    await f.locator("#quick-add").tap();
    await page.waitForTimeout(400);
    ok(await oskOpen(page), "a finger's tap in a text field opens the keyboard");
    ok(await page.locator("#osk").getAttribute("lang") === "el", "it starts in Greek with orOS in Greek");
    ok(await f.locator("#quick-add").getAttribute("inputmode") === "none", "no system keyboard on top (inputmode none)");
    // Γάλα: Shift γ, accent, α, λ, α
    await special(page, "shift"); await key(page, "Γ");
    await special(page, "dead"); await key(page, "α");
    await key(page, "λ"); await key(page, "α");
    ok(await f.locator("#quick-add").inputValue() === "Γάλα", "Greek with an accent at the caret: " + await f.locator("#quick-add").inputValue());
    ok(await f.locator("#quick-add").evaluate((el) => el === document.activeElement), "the field keeps the focus");
    const box = await page.locator("#osk").boundingBox();
    const fr = await page.locator("#app-frame").boundingBox();
    const fld = await f.locator("#quick-add").boundingBox();
    ok(fr.y + fr.height <= box.y + 1, "the app area ends above the keyboard");
    ok(fld.y + fld.height <= box.y, "the field is not covered");
    await special(page, "enter");
    await page.waitForTimeout(500);
    const added = await f.locator("body").innerText();
    ok(/Γάλα/.test(added) && (await f.locator("#quick-add").inputValue()) === "", "Enter adds the task");
    // Caret: type "ab", ←, "x" → "axb"; Backspace → "ab"
    await f.locator("#quick-add").tap(); await page.waitForTimeout(300);
    if (!(await oskOpen(page))) await page.locator("#osk-btn").tap();
    await page.locator("#osk .osk-lang").first().tap();      // EN
    ok(await page.locator("#osk").getAttribute("lang") === "en", "the layout key goes to English");
    await key(page, "a"); await key(page, "b"); await special(page, "left"); await key(page, "x");
    ok(await f.locator("#quick-add").inputValue() === "axb", "← moves the caret: " + await f.locator("#quick-add").inputValue());
    await special(page, "back");
    ok(await f.locator("#quick-add").inputValue() === "ab", "Backspace deletes before the caret");
    await page.locator("#osk .osk-sym").first().tap(); await key(page, "1"); await key(page, "@");
    ok(await f.locator("#quick-add").inputValue() === "a1@b", "numbers and symbols");

    // axe with the keyboard open
    const AXE = axeSource();
    if (AXE) {
      await page.evaluate(AXE);
      const v = await page.evaluate(() => window.axe.run(document.getElementById("osk"), { resultTypes: ["violations"] })
        .then((r) => r.violations.filter((x) => x.impact === "critical" || x.impact === "serious").map((x) => x.id + " " + x.nodes.length)));
      ok(v.length === 0, "axe on the open keyboard: " + (v.join(", ") || "clean"));
      const v2 = await page.evaluate(() => window.axe.run(document.getElementById("oros-bar"), { resultTypes: ["violations"] })
        .then((r) => r.violations.filter((x) => x.impact === "critical" || x.impact === "serious").map((x) => x.id)));
      ok(v2.length === 0, "axe on the top bar with the button: " + (v2.join(", ") || "clean"));
    } else notes.push("axe-core not installed: axe skipped");

    // A real key press closes it (auto)
    await page.keyboard.press("KeyZ");
    await page.waitForTimeout(200);
    ok(!(await oskOpen(page)), "a real key press closes it");
    await f.locator("#quick-add").tap(); await page.waitForTimeout(400);
    ok(!(await oskOpen(page)), "after a real key press a tap does not open it again");
    await page.locator("#osk-btn").tap(); await page.waitForTimeout(200);
    ok(await oskOpen(page), "the top-bar button still opens it");
    await special(page, "hide");
    ok(!(await oskOpen(page)), "the hide key closes it");
    await ctx.close();

    // ---- textarea and contentEditable ----
    ({ ctx, page } = await shell(1280, "en"));
    f = await openApp(page, "writer", "[contenteditable]");
    const ed = f.locator("[contenteditable=true], [contenteditable='']").first();
    await ed.tap(); await page.waitForTimeout(400);
    if (!(await oskOpen(page))) await page.locator("#osk-btn").tap();
    ok(await oskOpen(page), "Writer's page opens the keyboard");
    await key(page, "h"); await key(page, "i");
    ok(/hi/.test(await ed.innerText()), "contentEditable gets text");
    await ctx.close();

    ({ ctx, page } = await shell(1280, "de"));
    await page.evaluate(() => {
      const t = document.createElement("textarea");
      t.id = "osk-test"; t.style.cssText = "position:fixed;top:300px;left:20px;width:300px;height:80px;z-index:5000";
      document.body.appendChild(t);
    });
    await page.locator("#osk-test").tap(); await page.waitForTimeout(400);
    ok(await oskOpen(page), "a shell textarea opens it");
    ok(await page.locator("#osk").getAttribute("lang") === "de", "German layout with orOS in German");
    await key(page, "ü"); await special(page, "enter"); await key(page, "ß");
    ok(await page.locator("#osk-test").inputValue() === "ü\nß", "textarea: German letters and a new line");
    await special(page, "hide");
    // A password field in an open shadow root near the bottom (the orOS
    // USB System panel's Wi-Fi password).
    await page.evaluate(() => {
      const h = document.createElement("div");
      h.id = "osk-shadow";
      h.style.cssText = "position:fixed;right:10px;bottom:10px;width:320px;z-index:5000";
      const r = h.attachShadow({ mode: "open" });
      r.innerHTML = '<div style="background:#222;padding:10px"><input type="password" aria-label="pw"></div>';
      document.body.appendChild(h);
    });
    const pw = page.locator("#osk-shadow input");
    await pw.tap(); await page.waitForTimeout(500);
    ok(await oskOpen(page), "a password field in a shadow root opens it");
    await key(page, "a"); await key(page, "s");
    ok(await pw.inputValue() === "as", "it types into the shadow root field: " + await pw.inputValue());
    const kb = await page.locator("#osk").boundingBox(), pb = await pw.boundingBox();
    ok(pb.y + pb.height <= kb.y, "the panel is lifted above the keyboard");
    await ctx.close();

    // ---- phone: nothing ----
    ({ ctx, page } = await shell(360, "en"));
    ok(await page.locator("#osk-btn").count() === 0, "no button on a phone");
    await ctx.close();
  } catch (e) {
    fails.push("run failed: " + String(e.message || e).split("\n")[0]);
  }

  await browser.close();
  srv.close();
  const report = { pass: notes, fail: fails };
  if (out) fs.writeFileSync(out, JSON.stringify(report, null, 2));
  for (const n of notes) console.log("ok   " + n);
  console.log(fails.length ? "\n" + fails.length + " failed" : "\nall " + notes.length + " checks passed");
  process.exit(fails.length ? 1 : 0);
}

main();
