// Music: Play on a playlist, album or other list starts at its first
// song in order (MU-ORDER1). Before, a shuffle left on from an earlier
// Shuffle made Play start anywhere, and the place of the song restored
// from the last session could be applied to the next song loaded.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const C = require(path.join(__dirname, "..", "music/core.js")).OrosMusicCore;
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const items = (n) => Array.from({ length: n }, (_, i) => ({ k: "k" + i, t: "Song " + i, p: "/internal/Music/" + i + ".mp3" }));

test("queue: a list started with shuffle off begins at its first song, in order", () => {
  const was = C.qStart(null, items(5), -1, { shf: 1 }, () => 0.7);
  assert.equal(was.shf, 1);
  const q = C.qStart(was, items(8), 0, { shf: 0 }, () => 0.7);
  assert.equal(q.shf, 0);
  assert.equal(q.cur.k, "k0");
  assert.deepEqual(q.ord, [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(q.at, 0);
});

test("Play turns shuffle off; Shuffle turns it on; a tapped row keeps it", () => {
  const src = read("music/music.js");
  assert.match(src, /var shf = shuffle \? 1 : \(idx >= 0 \? H\.getState\(\)\.shf : 0\);/);
  assert.match(src, /H\.playList\(items, idx >= 0 \? map : \(shf \? -1 : 0\), \{ shf: shf, src: src \}\);/);
  assert.doesNotMatch(src, /var shf = shuffle \? 1 : H\.getState\(\)\.shf;/);
});

test("host: a waiting seek belongs to its own song and load", () => {
  const src = read("music/host.js");
  // A new source (or a cleared deck) drops the seek of the song before.
  assert.match(src, /function setSrc\(el, u\) \{\n    dropSeek\(el\);/);
  assert.match(src, /function clearDeck\(el\) \{\n    dropSeek\(el\);/);
  // The seek checks it is still the newest load on the playing deck.
  assert.match(src, /if \(my !== loadSeq \|\| a !== audio\) return;/);
  assert.match(src, /a\._seek = seek;/);
});

test("host: the last session's song does not come back over a song started meanwhile", () => {
  const src = read("music/host.js");
  assert.match(src, /var go = function \(\) \{[\s\S]{0,200}if \(loadSeq > 0\) return;/);
});

test("help: Play plays in order from the first song (EN, EL, DE)", () => {
  assert.match(read("music/help.en.txt"), /in order, from its first song \(it turns shuffle off\)/);
  assert.match(read("music/help.el.txt"), /με τη σειρά, από το πρώτο τραγούδι \(και κλείνει την τυχαία σειρά\)/);
  assert.match(read("i18n/de/help/music.txt"), /der Reihe nach ab dem ersten Song \(und schaltet Zufall aus\)/);
});

test("the big Play pauses only while this list plays; paused or restored, it starts the list again", () => {
  const src = read("music/music.js");
  assert.match(src, /if \(isPlayingFrom\(src\) && H\.getState\(\)\.playing\) \{ H\.toggle\(\); return; \}\n      go\(false\);/);
  assert.doesNotMatch(src, /if \(playing\) \{ H\.toggle\(\); return; \}/);
});
