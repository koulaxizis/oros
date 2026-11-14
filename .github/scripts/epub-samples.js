#!/usr/bin/env node
// The EPUB export's synthetic books for the official EPUBCheck (CI job
// .github/workflows/epubcheck.yml, LY-EPUB wave L7 E2).
//   node .github/scripts/epub-samples.js write <dir>
//     writes good-*.epub (every one must pass EPUBCheck with no error)
//     and bad-*.epub (each must fail it), plus <name>.oros.json with
//     the on-device check (layout/epubcheck.js) of each;
//   node .github/scripts/epub-samples.js compare <dir>
//     reads <name>.epubcheck.json (EPUBCheck --json) next to each and
//     fails when EPUBCheck finds an error in a good book, or when it
//     finds errors in a book that the on-device check called clean.
// Made-up text only (tests/layout-ebooks.js): the books of the corpus
// never go into the repository.
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..", "..");
const B = require(path.join(ROOT, "tests/layout-ebooks.js"));
const C = require(path.join(ROOT, "layout/epubcheck.js"));
const Z = require(path.join(ROOT, "atelier/zip.js"));
const T = require(path.join(ROOT, "designkit/text.js"));
const M = require(path.join(ROOT, "designkit/model.js"));

async function rezip(bytes, edit) {
  const z = Z.open(bytes), files = [];
  for (const n of z.names) files.push({ name: n, data: await z.bytes(n) });
  edit(files);
  return Z.write(files);
}
function swap(files, name, fn) {
  const f = files.find((x) => x.name === name);
  f.data = fn(new TextDecoder().decode(f.data));
}

async function samples() {
  const out = {};
  out["good-novel"] = (await B.epub(B.novel())).bytes;
  out["good-plain"] = (await B.epub(B.novel(), { prof: { nf: 1, npl: 1 } })).bytes;
  const bare = B.novel();
  bare.items.find((i) => i.id === "it-pic").ext = {};
  out["good-no-publishing"] = (await B.epub(bare, { data: null, cover: null })).bytes;
  // a font of the user's (obfuscated)
  T.registerFamily("uf_0123456789abcdef", { name: "Own Face", urls: { r: ["x"] }, fallback: "serif" });
  const buf = fs.readFileSync(path.join(ROOT, "vendor/noto", T.fontFile("serif-r")));
  T.register("uf_0123456789abcdef-r", buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const own = B.novel();
  Object.assign(own.pstyles.find((p) => p.id === "ps-pcap"), { i: 0, ext: { fam: "uf_0123456789abcdef" } });
  out["good-own-font"] = (await B.epub(M.normDoc(own))).bytes;
  const base = out["good-novel"];
  out["bad-mimetype"] = await rezip(base, (f) => f.push(f.shift()));
  out["bad-missing-file"] = await rezip(base, (f) => f.splice(f.findIndex((x) => x.name === "EPUB/images/it-pic.png"), 1));
  out["bad-xml"] = await rezip(base, (f) => swap(f, "EPUB/text/c003.xhtml", (s) => s.replace("</h3>", "</h2>")));
  out["bad-fragment"] = await rezip(base, (f) => swap(f, "EPUB/nav.xhtml", (s) => s.replace("c003.xhtml#h2", "c003.xhtml#nope")));
  out["bad-modified"] = await rezip(base, (f) => swap(f, "EPUB/package.opf", (s) => s.replace(/<meta property="dcterms:modified">[^<]+<\/meta>/, "")));
  out["bad-remote"] = await rezip(base, (f) => swap(f, "EPUB/text/c001.xhtml", (s) => s.replace("</body>", '<img src="https://example.com/a.png" alt="x"/></body>')));
  return out;
}

async function write(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const all = await samples();
  for (const [name, bytes] of Object.entries(all)) {
    fs.writeFileSync(path.join(dir, name + ".epub"), bytes);
    const r = await C.check(bytes, Z);
    fs.writeFileSync(path.join(dir, name + ".oros.json"), JSON.stringify(r, null, 1));
    console.log(name + ": " + bytes.length + " bytes, on-device check " + r.errors.length + " errors, " + r.warnings.length + " warnings");
  }
}

function compare(dir) {
  let bad = 0;
  const names = fs.readdirSync(dir).filter((n) => /\.epub$/.test(n)).map((n) => n.replace(/\.epub$/, "")).sort();
  for (const name of names) {
    const ours = JSON.parse(fs.readFileSync(path.join(dir, name + ".oros.json"), "utf8"));
    const ec = JSON.parse(fs.readFileSync(path.join(dir, name + ".epubcheck.json"), "utf8"));
    const errs = (ec.messages || []).filter((m) => m.severity === "ERROR" || m.severity === "FATAL");
    const line = name + ": EPUBCheck " + errs.length + " errors (" + [...new Set(errs.map((m) => m.ID))].join(", ") + "), on-device " + ours.errors.length + " (" + [...new Set(ours.errors.map((e) => e.c))].join(", ") + ")";
    if (/^good-/.test(name) && (errs.length || ours.errors.length)) { bad++; console.log("::error::" + line); errs.forEach((m) => console.log("  " + m.ID + " " + m.message + " " + JSON.stringify(m.locations || []))); }
    else if (/^bad-/.test(name) && !errs.length) { bad++; console.log("::error::" + line + " (a broken sample that EPUBCheck accepts: the sample is wrong)"); }
    else if (errs.length && !ours.errors.length) { bad++; console.log("::error::" + line + " (the on-device check missed it)"); }
    else console.log(line);
  }
  if (bad) process.exit(1);
}

const [mode, dir] = process.argv.slice(2);
if (mode === "write" && dir) write(dir).catch((e) => { console.error(e); process.exit(1); });
else if (mode === "compare" && dir) compare(dir);
else { console.error("usage: epub-samples.js write|compare <dir>"); process.exit(2); }
