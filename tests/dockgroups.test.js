// Dock groups (DOCK-GRP, launcher.js 1.10.0, video ideas 2026-11-23 #15):
// drop an app on an app in the Dock and both go into a named group,
// synced like the Dock order. Pure model + wiring.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const M = require(path.join(ROOT, "launcher.js"));
const L = fs.readFileSync(path.join(ROOT, "launcher.js"), "utf8");

const base = () => ({ ver: 1, items: ["a", "b", "c", "e"].map((id, i) => ({ id, desk: null, dock: i + 1, mtime: 1 })) });
const shown = (d) => M.dockEntries(d).map((e) => e.app || e.group + ":" + e.ids.join("+"));
const plain = (x) => JSON.parse(JSON.stringify(x));

test("old data stays byte for byte; no groups key until there is a group", () => {
  const d = M.normalize(base());
  assert.equal("groups" in d, false);
  assert.equal(d.items.some((it) => "grp" in it), false);
  assert.deepEqual(plain(M.normalize(JSON.parse(JSON.stringify(d)))), plain(d));
});

test("drop an app on an app: a named group at the target's place", () => {
  const d = M.groupAdd(base(), "c", { app: "a" }, "g1", "Games", 10);
  assert.deepEqual(shown(d), ["g1:a+c", "b", "e"]);
  assert.deepEqual(plain(d.groups), [{ id: "g1", name: "Games", dock: 1, mtime: 10 }]);
  assert.equal(d.items.find((x) => x.id === "a").grp, "g1");
  assert.deepEqual(Object.keys(d.items.find((x) => x.id === "a")), ["id", "desk", "dock", "grp", "mtime"], "fixed field order");
});

test("drop on a group joins it; an app moved from a group of two dissolves that one", () => {
  let d = M.groupAdd(base(), "c", { app: "a" }, "g1", "Games", 10);
  d = M.groupAdd(d, "e", { app: "b" }, "g2", "Work", 11);
  assert.deepEqual(shown(d), ["g1:a+c", "g2:b+e"]);
  d = M.groupAdd(d, "e", { group: "g1" }, "gx", "", 12);
  assert.deepEqual(shown(d), ["g1:a+c+e", "b"]);
  assert.equal(d.groups.find((g) => g.id === "g2").dock, null, "a tombstone");
  assert.equal(d.items.find((x) => x.id === "b").grp, undefined);
  // dropping on a member of a live group joins that group, no new one
  d = M.groupAdd(d, "b", { app: "c" }, "g9", "New", 13);
  assert.deepEqual(shown(d), ["g1:a+b+c+e"]);
  assert.equal(d.groups.some((g) => g.id === "g9"), false);
});

test("an app on itself, an unknown target or a bad id changes nothing", () => {
  const d = M.normalize(base());
  assert.deepEqual(plain(M.groupAdd(d, "a", { app: "a" }, "g1", "", 5)), plain(d));
  assert.deepEqual(plain(M.groupAdd(d, "a", { app: "zz" }, "g1", "", 5)), plain(d));
  assert.deepEqual(plain(M.groupAdd(d, "a", { app: "b" }, "BAD", "", 5)), plain(d));
  assert.deepEqual(plain(M.groupAdd(d, "a", { group: "gnone" }, "g1", "", 5)), plain(d));
});

test("move a group as one entry; take one out (lands after the group); rename; ungroup", () => {
  let d = M.groupAdd(base(), "c", { app: "a" }, "g1", "Games", 10);
  d = M.dockMoveTo(d, { group: "g1" }, 2, null, 11);
  assert.deepEqual(shown(d), ["b", "e", "g1:a+c"]);
  d = M.dockMoveTo(d, { app: "e" }, 0, null, 12);
  assert.deepEqual(shown(d), ["e", "b", "g1:a+c"]);
  d = M.groupAdd(d, "b", { group: "g1" }, "", "", 13);
  d = M.groupLeave(d, "a", null, 14);
  assert.deepEqual(shown(d), ["e", "g1:b+c", "a"]);
  d = M.groupRename(d, "g1", "  Play\u0000  time  ", 15);
  assert.equal(d.groups[0].name, "Play time");
  assert.equal(M.groupRename(d, "g1", "   ", 16).groups[0].name, "Play time", "an empty name keeps the old one");
  assert.equal(M.groupName("x".repeat(80)).length, 40);
  d = M.groupUngroup(d, "g1", null, 17);
  assert.deepEqual(shown(d), ["e", "b", "c", "a"]);
  assert.equal(d.groups[0].dock, null);
});

test("the last but one out: the last member takes the group's place", () => {
  let d = M.groupAdd(base(), "c", { app: "b" }, "g1", "", 10);
  assert.deepEqual(shown(d), ["a", "g1:b+c", "e"]);
  d = M.groupLeave(d, "c", null, 11);
  assert.deepEqual(shown(d), ["a", "b", "c", "e"]);
});

test("sync: groups merge by id (newer wins); an old device's copy loses nothing new", () => {
  let mine = M.groupAdd(base(), "c", { app: "a" }, "g1", "Games", 10);
  const theirs = M.groupRename(mine, "g1", "Fun", 20);
  assert.equal(M.merge(mine, theirs).groups[0].name, "Fun");
  assert.equal(M.merge(theirs, mine).groups[0].name, "Fun");
  // an older device rewrote the slice without grp / groups (same mtimes)
  const old = { ver: 1, items: mine.items.map((i) => ({ id: i.id, desk: i.desk, dock: i.dock, mtime: i.mtime })) };
  assert.deepEqual(shown(M.merge(mine, old)), ["g1:a+c", "b", "e"]);
  // unpinning a member from the Dock drops its grp
  const un = M.pin(mine, "c", "dock", false, 30);
  assert.equal(un.items.find((x) => x.id === "c").grp, undefined);
});

test("okIds: an alias shows once and never joins the count", () => {
  const d = M.groupAdd(base(), "c", { app: "a" }, "g1", "", 10);
  assert.deepEqual(M.dockEntries(d, ["a", "b", "e"]).map((e) => e.app || e.group), ["a", "b", "e"], "one member left: shown plain");
});

test("wiring: drop on the middle, the menu item, the panel, badges, strings", () => {
  assert.match(L, /var VER = "1\.10\.0";/);
  assert.match(L, /at > lo \+ len \* 0\.28 && at < lo \+ len \* 0\.72/);
  assert.match(L, /item\("grpWith", function \(\) \{ openGroupPick\(id, anchor\); \}\)/);
  assert.match(L, /m\.setAttribute\("role", "dialog"\)/);
  assert.match(L, /badgeOn\(gs\[g\], gs\[g\]\.getAttribute\("data-ids"\)/);
  assert.match(L, /mini\.innerHTML = iconOf\(app\);/);
  assert.match(L, /lab\.textContent = labelOf\(app\)/, "names only as text");
  const T = fs.readFileSync(path.join(ROOT, "translations.js"), "utf8");
  const de = fs.readFileSync(path.join(ROOT, "i18n/de/shell.js"), "utf8");
  for (const k of ["grpNew", "grpWith", "grpName", "grpOut", "grpUngroup", "grpAria"]) {
    assert.equal((T.match(new RegExp('"ln\\.' + k + '":', "g")) || []).length, 2, "EN + EL " + k);
    assert.ok(de.includes('"ln.' + k + '"'), "de " + k);
  }
});
