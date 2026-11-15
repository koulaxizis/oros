// Writes the MODELS table of translate/engine.js from the model copy's
// index (koulaxizis/oros-models translate/index.json), so the sizes and
// SHA-256 sums orOS checks are always the copy's own.
//   node translate/make-models.js <oros-models checkout>
// Run it after adding or updating a direction there (its README says how).
"use strict";
const fs = require("fs");
const path = require("path");

const PARTS = ["model", "lex", "vocab", "srcvocab", "trgvocab"];
const SAFE = /^[a-z0-9._]+$/;

function table(index) {
  const pairs = index && index.pairs;
  if (!pairs || typeof pairs !== "object") throw new Error("index: no pairs");
  const lines = ["  var MODELS = {"];
  const keys = Object.keys(pairs).sort();
  keys.forEach((pair, i) => {
    const e = pairs[pair];
    if (!/^[a-z]{2,3}(_[a-z]+)?-[a-z]{2,3}(_[a-z]+)?$/.test(pair)) throw new Error("pair " + pair);
    if (!/^[A-Za-z0-9_-]+$/.test(e.folder || "")) throw new Error(pair + ": folder");
    const names = Object.keys(e.files || {}).filter((k) => PARTS.indexOf(k) >= 0)
      .sort((a, b) => PARTS.indexOf(a) - PARTS.indexOf(b));
    if (names.length !== Object.keys(e.files || {}).length) throw new Error(pair + ": unknown part");
    lines.push("    \"" + pair + "\": { v: \"" + e.folder + "\", files: {");
    names.forEach((k, j) => {
      const f = e.files[k];
      if (!SAFE.test(f.n) || !/^[0-9a-f]{64}$/.test(f.sha) || !(f.size > 0) || !(f.gz > 0)) throw new Error(pair + " " + k);
      lines.push("      " + k + ": { n: \"" + f.n + "\", size: " + f.size + ", gz: " + f.gz + ", sha: \"" + f.sha + "\" }" +
        (j < names.length - 1 ? "," : " } }" + (i < keys.length - 1 ? "," : "")));
    });
  });
  lines.push("  };");
  return lines.join("\n");
}

function write(enginePath, index) {
  const src = fs.readFileSync(enginePath, "utf8");
  const a = src.indexOf("  // MODELS-BEGIN\n"), b = src.indexOf("  // MODELS-END\n");
  if (a < 0 || b < a) throw new Error("engine.js: no MODELS-BEGIN / MODELS-END");
  const out = src.slice(0, a) + "  // MODELS-BEGIN\n" + table(index) + "\n" + src.slice(b);
  if (out !== src) fs.writeFileSync(enginePath, out);
  return out !== src;
}

if (require.main === module) {
  const dir = process.argv[2];
  if (!dir) { console.error("usage: node translate/make-models.js <oros-models checkout>"); process.exit(2); }
  const index = JSON.parse(fs.readFileSync(path.join(dir, "translate", "index.json"), "utf8"));
  const changed = write(path.join(__dirname, "engine.js"), index);
  console.log(changed ? "translate/engine.js: MODELS written" : "translate/engine.js: MODELS already current");
}

module.exports = { table, write };
