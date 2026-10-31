// Builds the orOS logo PNGs from icon.svg: icons/icon-192/512.png (any),
// icons/icon-maskable-192/512.png (full-bleed square, logo scaled to 0.617
// so it stays well inside the 80% safe circle) and the browser add-on's
// extension/icons/icon-16/32/48/128.png.
// Run after changing icon.svg:  node tools/brand-icons.js
// (needs Playwright's Chromium; the PNGs are committed, nothing runs at
// page load).
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "icon.svg"), "utf8");

// The maskable form: the logo's own square becomes a full-bleed
// background and the mark shrinks around the centre (the same geometry
// as the maskable icons before 2026-10-31).
function maskable() {
  const bg = /<rect [^>]*fill="(#[0-9a-fA-F]{6})"/.exec(SRC)[1];
  const mark = /<path[\s\S]*?\/>/.exec(SRC)[0];
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="none">\n' +
    '  <rect width="512" height="512" fill="' + bg + '"/>\n' +
    '  <g transform="translate(98 98) scale(0.617)">' + mark + '</g>\n</svg>\n';
}

function bold(width) {
  return SRC.replace(/stroke-width="20"/, 'stroke-width="' + width + '"');
}

const JOBS = [
  ["icons/icon-192.png", SRC, 192],
  ["icons/icon-512.png", SRC, 512],
  ["icons/icon-maskable-192.png", maskable(), 192],
  ["icons/icon-maskable-512.png", maskable(), 512],
  ["extension/icons/icon-16.png", bold(40), 16],
  ["extension/icons/icon-32.png", bold(30), 32],
  ["extension/icons/icon-48.png", SRC, 48],
  ["extension/icons/icon-128.png", SRC, 128],
];

(async () => {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "/opt/node22/lib/node_modules/playwright");
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const [name, src, px] of JOBS) {
    await page.setViewportSize({ width: px, height: px });
    await page.setContent('<html><body style="margin:0;background:transparent">' +
      src.replace("<svg ", '<svg width="' + px + '" height="' + px + '" ') + "</body></html>");
    await page.screenshot({ path: path.join(ROOT, name), omitBackground: true, clip: { x: 0, y: 0, width: px, height: px } });
    console.log("icon:", name);
  }
  await browser.close();
})();
