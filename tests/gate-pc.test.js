// GATE-PC (2026-11-28): a folder of the owner's computer ("C:/Users/…") is
// not a folder of the orOS disk; orOS Drive mirrors it to
// /internal/Drive/<computer>/<folder>. claudefiles.js finds the mirror.
// Run: node --test tests/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const CF = require("../assistant/claudefiles.js");

test("computer paths are told apart from disk paths", () => {
  for (const p of ["C:/Users/koulaxizis/Documents", "C:\\Users\\koulaxizis\\Downloads", "c:", "/internal/D:/x"]) assert.equal(CF.pcPath(CF.normPath(p)), true, p);
  for (const p of ["Drive/ckDesktop/Documents", "Studio/Podcasts", "Claude/C: notes", "/internal/CC:/x"]) assert.equal(CF.pcPath(CF.normPath(p)), false, p);
  assert.deepEqual(CF.pcTails(CF.normPath("C:\\Users\\me\\Documents\\Τιμολόγια")), ["Users/me/Documents/Τιμολόγια", "me/Documents/Τιμολόγια", "Documents/Τιμολόγια", "Τιμολόγια"]);
});

test("the mirror is the longest tail on one computer", async () => {
  const disk = new Set(["/internal/Drive/ckDesktop/Documents/Τιμολόγια", "/internal/Drive/ckMobile/Τιμολόγια", "/internal/Drive/ckDesktop/Downloads"]);
  const has = async (p) => disk.has(p);
  let f = await CF.pcFind(CF.normPath("C:/Users/koulaxizis/Documents/Τιμολόγια"), ["ckMobile", "ckDesktop"], has);
  assert.equal(f.to, "/internal/Drive/ckDesktop/Documents/Τιμολόγια", "Documents/Τιμολόγια wins over a bare Τιμολόγια");
  f = await CF.pcFind(CF.normPath("C:/Users/koulaxizis/Downloads"), ["ckMobile", "ckDesktop"], has);
  assert.equal(f.to, "/internal/Drive/ckDesktop/Downloads");
  f = await CF.pcFind(CF.normPath("C:/Users/koulaxizis/Videos"), ["ckMobile", "ckDesktop"], has);
  assert.deepEqual(f, { to: "", many: [] }, "not synced yet: no mirror");
  disk.add("/internal/Drive/laptop/Downloads");
  f = await CF.pcFind(CF.normPath("C:/Users/koulaxizis/Downloads"), ["ckDesktop", "laptop"], has);
  assert.equal(f.to, "", "two computers: none is picked");
  assert.equal(f.many.length, 2);
  f = await CF.pcFind(CF.normPath("C:/x"), ["a"], async () => { throw new Error("disk"); });
  assert.equal(f.to, "", "a disk error finds nothing");
});
