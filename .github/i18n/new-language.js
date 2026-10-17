// Start a new orOS language.
//   node .github/i18n/new-language.js <code> "<name>" <locale>
//   e.g. node .github/i18n/new-language.js fr "Français" fr-FR
// Adds the language to the LANGS list of i18n.js as "hidden" (it is
// tried with ?lang=<code> until the shell, Settings and Help are
// translated), creates i18n/<code>/ with empty packs for the shell,
// Settings and Help, and writes STATUS.md + manifest.json. CI only.

"use strict";

const fs = require("fs");
const path = require("path");
const S = require("./scan.js");

function main(argv) {
  const [code, name, locale] = argv;
  if (!/^[a-z]{2,3}(-[A-Z]{2})?$/.test(code || "") || !name || !/^[a-z]{2,3}(-[A-Z]{2})?$/.test(locale || "")) {
    console.error('usage: node .github/i18n/new-language.js <code> "<name>" <locale>   (e.g. fr "Français" fr-FR)');
    return 1;
  }
  if (S.langs().some((l) => l.code === code)) { console.error(code + " is already in i18n.js"); return 1; }
  if (/["\\<>]/.test(name)) { console.error("the name may not contain quotes, backslashes or < >"); return 1; }

  const file = path.join(S.ROOT, "i18n.js");
  const s = fs.readFileSync(file, "utf8");
  const end = s.indexOf("\n  ];\n  // ---- end of languages ----");
  if (end < 0) { console.error("i18n.js: end of the LANGS list not found"); return 1; }
  const entry = ',\n    { code: "' + code + '", name: "' + name + '", locale: "' + locale + '", dir: "ltr", status: "hidden" }';
  fs.writeFileSync(file, s.slice(0, end) + entry + s.slice(end));

  const dir = path.join(S.ROOT, "i18n", code);
  fs.mkdirSync(path.join(dir, "help", "topics"), { recursive: true });
  for (const app of ["shell", "settings", "help"]) {
    const f = path.join(dir, app + ".js");
    if (!fs.existsSync(f)) fs.writeFileSync(f, 'orosPack("' + code + '", "' + app + '", {\n});\n');
  }
  require("child_process").execFileSync(process.execPath, [path.join(__dirname, "coverage.js")], { stdio: "inherit" });
  console.log("Next: translate i18n/" + code + "/shell.js (see docs/translate/README.md).");
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
