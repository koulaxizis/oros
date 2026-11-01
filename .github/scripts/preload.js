// BOOT-P1: <link rel="preload"> for every shell script, ahead of the
// CSP <meta> in the root index.html.
//
// Chromium's preload scanner stops looking ahead at a CSP <meta>: the
// shell's ~90 <script src> after it were then fetched one by one, one
// round trip each (first open on Slow 4G: 27.7 s; with this block 8.4 s,
// Bible Part VIII §G, .github/qa/boot.js). Links placed before the meta
// are found at once and fetched in parallel. They only fetch the same
// same-origin files the page runs anyway; running them is still up to
// the <script> elements, which the CSP covers.
//
// The block is generated from the page's own <script src> list (not
// the late bundle, BOOT-L1), in order, with the same ?v= (so each file is fetched once). Run after
// adding, removing or moving a shell script; stamp-assets.js runs it on
// main after the ?v= stamp. tests/preload.test.js fails a stale block.
// Usage: node .github/scripts/preload.js [--check]
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const START = "<!-- BOOT-P1 preload: generated from the scripts below (Bible Part VIII §G), do not edit -->";
const END = "<!-- /BOOT-P1 -->";
const BLOCK_RE = /[ \t]*<!-- BOOT-P1 preload:[^\n]*\n(?:[ \t]*<link rel="preload"[^\n]*\n)*[ \t]*<!-- \/BOOT-P1 -->\r?\n/;

// BOOT-L1: scripts inside <template data-oros-late> are inert markup;
// shell.js loads them after the desktop is drawn. Preloading them
// would put them back in the start-up path, so they are left out.
const LATE_RE = /<template data-oros-late>[\s\S]*?<\/template>/g;

// The same-origin classic scripts a page runs while it loads, in document order.
function scriptsOf(html) {
  const out = [];
  for (const m of html.replace(BLOCK_RE, "").replace(LATE_RE, "").matchAll(/<script\b([^>]*)\bsrc="([^"]+)"([^>]*)>/g)) {
    const attrs = m[1] + m[3];
    const src = m[2];
    if (/^(https?:)?\/\//.test(src) || /\btype="module"/.test(attrs)) continue;
    out.push(src);
  }
  return out;
}

function blockFor(html) {
  const lines = scriptsOf(html).map((s) => '  <link rel="preload" as="script" href="' + s + '">');
  return "  " + START + "\n" + lines.join("\n") + (lines.length ? "\n" : "") + "  " + END + "\n";
}

// The page with its block refreshed: in place, or right before the CSP meta.
function apply(html) {
  const block = blockFor(html);
  if (BLOCK_RE.test(html)) return html.replace(BLOCK_RE, () => block);
  const csp = /[ \t]*<meta http-equiv="Content-Security-Policy"/.exec(html);
  if (!csp) return html;   // no CSP meta, no stopped scanner (csp.js adds the meta first)
  return html.slice(0, csp.index) + block + html.slice(csp.index);
}

// Problems of a page (empty when the block is current and before the CSP meta).
function check(html) {
  const out = [];
  const m = BLOCK_RE.exec(html);
  if (!m) return ["no BOOT-P1 preload block: run node .github/scripts/preload.js"];
  if (m[0] !== blockFor(html)) out.push("BOOT-P1 preload block out of date (a shell script added, moved or restamped?): run node .github/scripts/preload.js");
  const csp = html.indexOf('<meta http-equiv="Content-Security-Policy"');
  if (csp >= 0 && m.index > csp) out.push("BOOT-P1 preload block must come before the CSP meta");
  return out;
}

function run(checkOnly, root) {
  const f = path.join(root || ROOT, "index.html");
  const html = fs.readFileSync(f, "utf8");
  if (checkOnly) return { problems: check(html), written: 0 };
  const next = apply(html);
  if (next !== html) fs.writeFileSync(f, next);
  return { problems: [], written: next !== html ? 1 : 0, scripts: scriptsOf(next).length };
}

if (require.main === module) {
  const checkOnly = process.argv.includes("--check");
  const r = run(checkOnly);
  if (checkOnly) {
    for (const p of r.problems) console.error("index.html: " + p);
    process.exit(r.problems.length ? 1 : 0);
  }
  console.log("Preload block: " + r.scripts + " script(s), " + (r.written ? "written" : "already current") + ".");
}

module.exports = { scriptsOf, blockFor, apply, check, run };
