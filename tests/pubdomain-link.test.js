// Publishing → Public Domain Calculator (merge audit item 13): the
// button in Publishing and the calculator's { author, title, died } receiver.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

test("Publishing opens the Public Domain Calculator with the title's author", () => {
  const pub = read("publish/app.js"), pd = read("pubdomain/pubdomain.js");
  assert.match(pub, /openAt\("pubdomain", \{ author: C\.authors\(x\)\[0\] \|\| "", title: x\.t \|\| "" \}\)/);
  assert.equal(pub.split('"pd.btn":').length, 3, "EN + EL");
  assert.ok(read("i18n/de/publish.js").includes('"pd.btn":'), "DE");
  assert.match(pd, /window\.__orosOpenAt = openTarget;/);
  assert.match(pd, /__orosTakeTarget\("pubdomain"\)/);
  assert.match(pd, /intOrNull\(tg\.died\)/);
  for (const f of ["publish/help.en.txt", "publish/help.el.txt", "i18n/de/help/publish.txt"]) assert.ok(read(f).includes("(app:pubdomain)"), f);
  for (const f of ["pubdomain/help.en.txt", "pubdomain/help.el.txt", "i18n/de/help/pubdomain.txt"]) assert.ok(read(f).includes("(app:publish)"), f);
});
