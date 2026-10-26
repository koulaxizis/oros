// Publishing wave P12: planned social posts. What is kept, which are
// due, the networks' own "new post" pages, the Mastodon server in
// Settings, and the posts in the Calendar.
// Run: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const C = require("../publish/core.js");
const F = require("../publish/feed.js");

function withPosts(list) {
  let d = C.put(C.empty(), "titles", { id: "t1", t: "Night Sea" }, 1);
  list.forEach((p, i) => { d = C.put(d, "posts", p, 2 + i); });
  return C.normalize(JSON.parse(C.serialize(d)));
}

test("posts are kept clean: day, time, text or picture, known networks once, disk pictures only", () => {
  const d = withPosts([
    { id: "p1", d: "2026-03-15", at: "10:00", tx: "Out today!", nets: ["x", "bluesky", "x", "myspace"], ti: "t1" },
    { id: "p2", d: "2026-03-16", at: "25:00", tx: "", img: "/internal/Publishing/Posts/p2.jpg" },
    { id: "p3", d: "2026-03-17", tx: "  ", img: "https://evil.example/x.jpg" },
    { id: "p4", d: "nope", tx: "x" },
    { id: "p5", d: "2026-03-18", tx: "x", img: "/internal/../etc" }
  ]);
  assert.deepEqual(d.posts.map((p) => p.id).sort(), ["p1", "p2", "p5"]);
  const p1 = d.posts.find((p) => p.id === "p1");
  assert.deepEqual([p1.at, p1.nets, p1.ti, p1.done], ["10:00", ["bluesky", "x"], "t1", ""]);
  const p2 = d.posts.find((p) => p.id === "p2");
  assert.deepEqual([p2.at, p2.img], ["", "/internal/Publishing/Posts/p2.jpg"]);
  assert.equal(d.posts.find((p) => p.id === "p5").img, "");
  assert.ok(C.LISTS.indexOf("posts") >= 0);
});

test("postsDue: earlier days, today once its time has come, never the posted ones", () => {
  const d = withPosts([
    { id: "a", d: "2026-03-14", at: "18:00", tx: "yesterday" },
    { id: "b", d: "2026-03-15", at: "09:00", tx: "this morning" },
    { id: "c", d: "2026-03-15", at: "20:00", tx: "tonight" },
    { id: "e", d: "2026-03-15", tx: "any time today" },
    { id: "f", d: "2026-03-13", tx: "posted", done: "2026-03-13" },
    { id: "g", d: "2026-03-16", tx: "tomorrow" }
  ]);
  assert.deepEqual(C.postsDue(d, "2026-03-15 12:00").map((p) => p.id), ["a", "e", "b"]);
  assert.deepEqual(C.postsDue(d, "2026-03-15 20:00").map((p) => p.id), ["a", "e", "b", "c"]);
  assert.deepEqual(C.postsDue(null, "2026-03-15 12:00"), []);
});

test("postUrl: the text goes in the network's own page; Mastodon needs the server; length in code points", () => {
  const tx = "Night Sea & you #books";
  assert.equal(C.postUrl("bluesky", tx), "https://bsky.app/intent/compose?text=Night%20Sea%20%26%20you%20%23books");
  assert.match(C.postUrl("x", tx), /^https:\/\/x\.com\/intent\/post\?text=/);
  assert.match(C.postUrl("threads", tx), /^https:\/\/www\.threads\.net\/intent\/post\?text=/);
  assert.match(C.postUrl("linkedin", tx), /^https:\/\/www\.linkedin\.com\/feed\/\?shareActive=true&text=/);
  assert.equal(C.postUrl("mastodon", tx, ""), "");
  assert.equal(C.postUrl("mastodon", tx, "evil.example/x?"), "");
  assert.match(C.postUrl("mastodon", tx, "mastodon.social"), /^https:\/\/mastodon\.social\/share\?text=/);
  assert.equal(C.postUrl("facebook", tx), "");
  assert.equal(C.postUrl("instagram", tx), "");
  assert.ok(C.POST_HOME.facebook && C.POST_HOME.instagram);
  assert.equal(C.postLen("Ωραία 👋"), 7);
  assert.equal(C.POST_MAX.bluesky, 300);
});

test("Settings keep a Mastodon server written as an address", () => {
  let d = C.empty();
  d.set = Object.assign({}, d.set, { mast: "HTTPS://Mastodon.Social/@me", m: 5 });
  assert.equal(C.normalize(d).set.mast, "mastodon.social");
  d.set = Object.assign({}, d.set, { mast: "not a server", m: 6 });
  assert.equal(C.normalize(d).set.mast, undefined);
});

test("Calendar: posts not yet posted, labelled with the time and first words, opening the post", () => {
  const long = "A very long post that goes on and on about the new book and its wonderful cover";
  const days = F.byDay(withPosts([
    { id: "p1", d: "2026-03-15", at: "10:00", tx: "Out   today!", ti: "t1" },
    { id: "p2", d: "2026-03-16", tx: long },
    { id: "p3", d: "2026-03-16", tx: "done", done: "2026-03-16" }
  ]));
  assert.deepEqual(days["2026-03-15"], [{ title: "t1", k: "post", n: "10:00", t: "Out today!", post: "p1" }]);
  assert.equal(F.label(days["2026-03-15"][0], "en"), "Post 10:00 · Out today!");
  assert.equal(F.label(days["2026-03-15"][0], "el"), "Ανάρτηση 10:00 · Out today!");
  assert.equal(days["2026-03-16"].length, 1);
  assert.equal(F.label(days["2026-03-16"][0], "en"), "Post · " + days["2026-03-16"][0].t);
  assert.ok(days["2026-03-16"][0].t.length <= 50);
  const cal = fs.readFileSync(path.join(__dirname, "..", "calendar/calendar.js"), "utf8");
  assert.match(cal, /r\.post \? \{ post: r\.post \}/);
});

test("Publishing has the Posts tab, and a title can start a post", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "publish/index.html"), "utf8");
  assert.match(html, /data-tab="posts"/);
  assert.match(html, /id="view-posts"/);
  const js = fs.readFileSync(path.join(__dirname, "..", "publish/app.js"), "utf8");
  assert.match(js, /"📣 " \+ t\("post\.link"\)/);
  assert.match(js, /target\.post/);
});
