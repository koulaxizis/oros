// Quality gate Q6: a Content-Security-Policy <meta> in every orOS
// document (shell, app pages, solo pages, callback pages).
//
//   script-src  'self' + the sha256 of each inline <script> of THAT
//               document (DL-1 direct-link snippet, solo hostBoot, the
//               shell's update broker…). No script from another origin,
//               no inline handler, no eval. 'wasm-unsafe-eval' lets the
//               bundled WebAssembly libraries compile (it allows no JS);
//               blob: runs the bundled ONNX runtime that Atelier and
//               Montage keep in IndexedDB (only this origin's code can
//               make a blob URL).
//   connect-src 'self' https: wss: + localhost: integrations talk to
//               each user's OWN server (Invoice Ninja, Odoo, SearXNG,
//               Ollama on localhost, WebDAV), so no host list.
//   object-src 'none', base-uri 'self', form-action 'self'.
// A page that loads files/gmedia.js (the one-time Google Drive / Photos
// import, approved) may also load https://apis.google.com (Picker).
//
// The meta goes right after <meta charset> (a CSP meta only covers what
// follows it). Run by stamp-assets.js after every push to main, so an
// edited inline snippet gets its new hash; tests/csp.test.js fails a PR
// whose page has no CSP or a stale hash.
// Usage: node .github/scripts/csp.js [--check]
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..", "..");
// Folders that are not orOS pages: the browser extension has its own
// CSP in its manifest; the rest are code, data or build trees.
const SKIP = new Set([".git", ".github", "node_modules", "vendor", "extension", "android", "tests", "icons", "fonts"]);
// Pages with a STRICTER policy of their own (the share-link viewer
// decrypts content from strangers): kept as written, only checked.
const OWN = new Set(["share/index.html"]);

function listDocs(root) {
  root = root || ROOT;
  const out = [];
  (function walk(rel) {
    for (const d of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      if (d.name.startsWith(".") || SKIP.has(d.name)) continue;
      const r = rel ? rel + "/" + d.name : d.name;
      if (d.isDirectory()) walk(r);
      else if (d.name.endsWith(".html")) out.push(r);
    }
  })("");
  return out.sort();
}

// Text of every inline classic/module script (not JSON data blocks).
function inlineScripts(html) {
  const out = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/i.test(m[1])) continue;
    const type = (/\btype\s*=\s*["']?([^"'\s>]+)/i.exec(m[1]) || [])[1];
    if (type && !/^(text\/javascript|module|application\/javascript)$/i.test(type)) continue;
    out.push(m[2]);
  }
  return out;
}

const sha = (s) => "'sha256-" + crypto.createHash("sha256").update(s, "utf8").digest("base64") + "'";

function policyFor(html) {
  const hashes = [...new Set(inlineScripts(html).map(sha))];
  const extra = /gmedia\.js/.test(html) ? ["https://apis.google.com"] : [];
  return [
    "default-src 'self'",
    ["script-src 'self' blob: 'wasm-unsafe-eval'"].concat(hashes, extra).join(" "),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' https: data: blob:",
    "media-src 'self' https: data: blob:",
    "font-src 'self' https: data:",
    "connect-src 'self' https: wss: data: blob: http://localhost:* http://127.0.0.1:*",
    "worker-src 'self' blob:",
    "frame-src 'self' https: blob: data:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ].join("; ");
}

const META_RE = /[ \t]*<meta http-equiv="Content-Security-Policy" content="[^"]*">\r?\n?/i;

// The document with its CSP meta in place (added or refreshed).
function withPolicy(html) {
  const meta = '<meta http-equiv="Content-Security-Policy" content="' + policyFor(html.replace(META_RE, "")) + '">';
  if (META_RE.test(html)) return html.replace(META_RE, (m) => m.replace(/<meta[^>]*>/, meta));
  const charset = /([ \t]*)<meta charset=[^>]*>\r?\n/i.exec(html);
  if (charset) {
    const at = charset.index + charset[0].length;
    return html.slice(0, at) + charset[1] + meta + "\n" + html.slice(at);
  }
  const head = /<head[^>]*>\r?\n?/i.exec(html);
  if (!head) return html;                      // not a full page: check() reports it
  const at = head.index + head[0].length;
  return html.slice(0, at) + "  " + meta + "\n" + html.slice(at);
}

// Problems of one document, [] when its CSP is current.
function check(html, own) {
  const m = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/i.exec(html);
  if (!m) return ["no CSP meta"];
  const out = [];
  if (own) {
    if (!/(^|;)\s*script-src [^;]*/.test(m[1]) || /'unsafe-(inline|eval)'/.test((/script-src[^;]*/.exec(m[1]) || [""])[0])) {
      out.push("own CSP must keep a script-src without unsafe-inline / unsafe-eval");
    }
    if (!/object-src 'none'/.test(m[1]) && !/default-src 'none'/.test(m[1])) out.push("own CSP must block objects");
  } else if (m[1] !== policyFor(html.replace(META_RE, ""))) out.push("CSP out of date (an inline script changed?)");
  const first = html.search(/<script\b/i);
  if (first !== -1 && first < m.index) out.push("CSP meta after the first <script>");
  return out;
}

function run(onlyCheck, root) {
  root = root || ROOT;
  const bad = [];
  let written = 0;
  for (const f of listDocs(root)) {
    const p = path.join(root, f);
    const html = fs.readFileSync(p, "utf8");
    if (onlyCheck) {
      for (const e of check(html, OWN.has(f))) bad.push(f + ": " + e);
      continue;
    }
    if (OWN.has(f)) continue;
    const next = withPolicy(html);
    if (next !== html) { fs.writeFileSync(p, next); written++; }
  }
  return { bad, written };
}

if (require.main === module) {
  const onlyCheck = process.argv.includes("--check");
  const r = run(onlyCheck);
  if (onlyCheck) {
    r.bad.forEach((b) => console.error(b));
    if (r.bad.length) { console.error("Fix: node .github/scripts/csp.js"); process.exit(1); }
    console.log("CSP current in every document.");
  } else {
    console.log("CSP written to " + r.written + " document(s).");
  }
}

module.exports = { OWN, listDocs, inlineScripts, policyFor, withPolicy, check, run };
