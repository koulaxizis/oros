// Builds the single apps' icons (solo.js): icons/solo/<id>.svg and the
// PNGs the manifests list (192, 512, maskable 512). The glyph is the
// app's own menu icon (shell.js ICONS, named in apps.json), in orOS gold
// on the orOS dark square, with a small orOS mark at the corner.
// Run after adding a single app:  node tools/solo-icons.js
// (needs Playwright's Chromium; the PNGs are committed, nothing runs at
// page load).
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const SOLO = require(path.join(ROOT, "solo.js"));
const shell = fs.readFileSync(path.join(ROOT, "shell.js"), "utf8");
const apps = JSON.parse(fs.readFileSync(path.join(ROOT, "apps.json"), "utf8")).apps;

function glyph(iconName) {
  const re = new RegExp("\\n    " + iconName + ": '<svg[^>]*>([\\s\\S]*?)</svg>'");
  const m = re.exec(shell);
  if (!m) throw new Error("no shell icon " + iconName);
  return m[1];
}

// scale: share of the square the 24-unit glyph takes.
function svg(id, maskable) {
  const app = apps.find((a) => a.id === id);
  const inner = glyph(app.icon);
  const g = maskable ? 0.46 : 0.56;
  const size = 512 * g, off = (512 - size) / 2 - (maskable ? 10 : 18);
  const k = size / 24;
  const badgeR = maskable ? 44 : 58, bx = maskable ? 330 : 392, by = maskable ? 330 : 392;
  const bs = badgeR / 72;   // the orOS mark is drawn in a 120 box
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="none">\n' +
    (maskable ? '  <rect width="512" height="512" fill="#1b1a18"/>\n'
              : '  <rect width="512" height="512" rx="96" fill="#1b1a18"/>\n') +
    '  <g transform="translate(' + (off + 8).toFixed(1) + ' ' + off.toFixed(1) + ') scale(' + k.toFixed(3) + ')" stroke="#c8a96e" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" fill="none">' +
    inner.replace(/stroke-width="[^"]*"/g, "") + '</g>\n' +
    '  <circle cx="' + bx + '" cy="' + by + '" r="' + badgeR + '" fill="#2a2721" stroke="#1b1a18" stroke-width="10"/>\n' +
    '  <g transform="translate(' + (bx - 60 * bs) + ' ' + (by - 64 * bs) + ') scale(' + bs.toFixed(3) + ')">' +
    '<path d="M60 26 L108 98 L12 98 Z M60 26 L80 60 L91 43 L108 98" stroke="#c8a96e" stroke-width="7" stroke-linecap="round" stroke-linejoin="miter" fill="none"/></g>\n' +
    '</svg>\n';
}

(async () => {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "/opt/node22/lib/node_modules/playwright");
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const id of SOLO.ids()) {
    const plain = svg(id, false), mask = svg(id, true);
    fs.writeFileSync(path.join(ROOT, "icons/solo", id + ".svg"), plain);
    for (const [name, src, px] of [[id + "-192.png", plain, 192], [id + "-512.png", plain, 512], [id + "-maskable-512.png", mask, 512]]) {
      await page.setViewportSize({ width: px, height: px });
      await page.setContent('<html><body style="margin:0;background:transparent">' +
        src.replace("<svg ", '<svg width="' + px + '" height="' + px + '" ') + "</body></html>");
      await page.screenshot({ path: path.join(ROOT, "icons/solo", name), omitBackground: true, clip: { x: 0, y: 0, width: px, height: px } });
    }
    console.log("icons:", id);
  }
  await browser.close();
})();
