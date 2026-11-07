// Music "Share…" (BR-SHARE-TRACK, share kind "track"): what a shared
// song may carry, the hosts its stream and cover may come from, that a
// song from the person's own server or device never carries an address,
// the receiver targets Music accepts, and the "Send with" row of the
// send window.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const K = require(path.join(ROOT, "share/kinds.js"));
const src = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

const IA = {
  t: "Song A", a: "The Band", al: "Live 1999", y: "1999", d: 183.4, s: "ia", k: "ia:abc123def",
  u: "https://archive.org/download/x/a.mp3", pg: "https://archive.org/details/x",
  art: "https://archive.org/services/img/x", li: "by-nc-sa 4.0", cr: "“Song A” by The Band, CC BY-NC-SA 4.0, from Internet Archive"
};

test("track: an open-source song keeps stream, page, cover, licence, credit and key", () => {
  const d = K.norm("track", IA);
  assert.deepEqual(d, {
    t: "Song A", a: "The Band", s: "ia", al: "Live 1999", y: "1999", d: 183, u: IA.u, k: "ia:abc123def",
    pg: IA.pg, art: IA.art, li: "by-nc-sa 4.0", cr: IA.cr
  });
  assert.equal(K.summary({ k: "track", d }, "en"), "Song «Song A» · The Band");
  assert.equal(K.shareLine({ k: "track", d }, "en"), "🎵 Song A · The Band");
});

test("track: stream, cover and page only on the source's own hosts, https, no login", () => {
  const bad = ["http://archive.org/a.mp3", "https://evil.example/a.mp3", "https://archive.org.evil.example/a.mp3",
    "https://user:pw@archive.org/a.mp3", "javascript:alert(1)", "data:audio/mp3,xx", "https://evilarchive.org/a.mp3"];
  for (const u of bad) {
    const d = K.norm("track", Object.assign({}, IA, { u, art: u, pg: u }));
    assert.equal(d.u, undefined, u);
    assert.equal(d.art, undefined, u);
    assert.equal(d.pg, undefined, u);
  }
  for (const u of ["https://prod-1.storage.jamendo.com/?trackid=1&format=mp31", "https://cdn.freesound.org/previews/1/1.mp3",
    "https://upload.wikimedia.org/a.ogg", "https://ccmixter.org/content/a.mp3", "https://ia800.us.archive.org/a.mp3"]) {
    assert.equal(K.norm("track", Object.assign({}, IA, { u })).u, new URL(u).href, u);
  }
});

test("track: a song from a server or the device carries its name only", () => {
  for (const s of ["sv", "own", "p", undefined, "xx"]) {
    const d = K.norm("track", { t: "Mine", a: "Me", al: "Home", s, k: "sv:abcdef12",
      u: "https://my.server/rest/stream.view?id=1&u=me&t=tok&s=salt", pg: "https://archive.org/x", art: "https://archive.org/y", cr: "c" });
    assert.deepEqual(d, { t: "Mine", a: "Me", s: "own", al: "Home" });
    const go = K.target({ k: "track", d }, "en");
    assert.deepEqual(go, { app: "music", target: { findSong: { q: "Me Mine" } } });
  }
  assert.equal(K.file({ k: "track", d: { t: "Mine", a: "", s: "own" } }, "en").name, "Mine.txt");
});

test("track: a public link keeps only a plain https address (no query, no #, no login)", () => {
  assert.equal(K.norm("track", { t: "R", s: "ln", u: "https://radio.example/live.mp3", k: "ln:abcdef12" }).u, "https://radio.example/live.mp3");
  for (const u of ["https://x.example/a.mp3?token=1", "https://x.example/a.mp3#k=1", "https://u:p@x.example/a.mp3", "http://x.example/a.mp3"]) {
    assert.equal(K.norm("track", { t: "R", s: "ln", u }).u, undefined, u);
  }
  const d = K.norm("track", { t: "R", s: "ln", u: "https://radio.example/live.mp3", pg: "https://archive.org/x", art: "https://archive.org/y", li: "cc0", cr: "c" });
  assert.deepEqual(Object.keys(d).sort(), ["a", "s", "t", "u"]);
});

test("track: hostile input is cut or dropped", () => {
  assert.equal(K.norm("track", { a: "x" }), null);
  assert.equal(K.norm("track", { t: "   " }), null);
  const d = K.norm("track", { t: "x".repeat(500) + "\u0000", a: "y z", s: "ia", y: "99", d: -1, li: "gpl", vi: "<b>", k: "jm:abcdef12", cr: "c".repeat(900) });
  assert.equal(d.t.length, 200);
  assert.equal(d.a, "y z");
  assert.equal(d.y, undefined);
  assert.equal(d.d, undefined);
  assert.equal(d.li, undefined);
  assert.equal(d.vi, undefined);
  assert.equal(d.k, undefined, "key of another source");
  assert.equal(d.cr.length, 600);
  assert.equal(K.norm("track", { t: "x", d: 400000 }).d, undefined);
});

test("track: a link round trip, .m3u file and Add to my orOS target for Music", async () => {
  const env = K.pack("track", IA);
  const code = await K.encode(env);
  assert.ok(code.length < 700, "short enough for a chat: " + code.length);
  const back = await K.decode(code);
  assert.deepEqual(back.env, env);
  const f = K.file(env, "en");
  assert.equal(f.name, "Song A.m3u");
  assert.equal(f.text, "#EXTM3U\n#EXTINF:183,The Band - Song A\n" + IA.u + "\n");
  const go = K.target(env, "en");
  assert.equal(go.app, "music");
  assert.deepEqual(go.target.addRef.ref, { k: "ia:abc123def", t: "Song A", a: "The Band", s: "ia", u: IA.u,
    al: "Live 1999", d: 183, pg: IA.pg, art: IA.art, li: "by-nc-sa 4.0" });
  // Music's own normalizer takes the ref as it is (the same key, so a like
  // or playlist entry is the same song).
  const MC = require(path.join(ROOT, "music/core.js")).OrosMusicCore;
  const r = MC.normRef(go.target.addRef.ref);
  assert.equal(r.k, "ia:abc123def");
  assert.equal(r.u, IA.u);
  assert.ok(MC.isRemote(r));
});

test("Music: Share in the song menu and full player, receivers addRef / findSong, local file asks each time", () => {
  const m = src("music/music.js");
  assert.match(m, /items\.push\(\[t\("m\.share"\), function \(\) \{ shareSong\(r\); \}\]\)/);
  assert.match(m, /head\.appendChild\(button\(t\("m\.share"\)/);
  assert.match(m, /if \(tg\.addRef && typeof tg\.addRef === "object"\) \{ addRefTarget\(tg\.addRef\); return; \}/);
  assert.match(m, /if \(tg\.findSong && typeof tg\.findSong === "object"\) \{ findSongTarget\(tg\.findSong\); return; \}/);
  assert.match(m, /\[t\("sh\.name"\)[\s\S]{0,200}\[t\("sh\.file"\)/);
  // A server or device song never hands its address to the share item.
  assert.match(m, /if \(!r\.p && \(isOpen\(r\) \|\| r\.s === "ln"\)\)/);
  ["m.share", "sh.title", "sh.name", "sh.file", "sh.fileSub", "sh.big", "sh.fileNo", "sh.send", "sh.ready", "sh.none"].forEach((k) => {
    assert.equal((m.match(new RegExp('"' + k.replace(".", "\\.") + '":', "g")) || []).length, 2, k + " EN + EL");
    assert.ok(src("i18n/de/music.js").indexOf('"' + k + '":') >= 0, k + " DE");
  });
});

test("Send window: Send with row (all kinds), plain web share pages, public posts warn", () => {
  const s = src("share/send.js");
  ["https://wa.me/?text=", "https://t.me/share/url?url=", "viber://forward?text=", "sms:?&body=",
    "https://www.facebook.com/sharer/sharer.php?u=", "https://x.com/intent/post?text=", "https://bsky.app/intent/compose?text=", "/share?text="]
    .forEach((u) => assert.ok(s.indexOf(u) >= 0, u));
  assert.match(s, /linkBtns = \[bShare, bCopy, bQr, bMail\]\.filter\(Boolean\)\.concat\(imBtns\)/);
  assert.match(s, /text: K\.shareLine\(env, lang\(\)\)/);
  ["imHead", "imPost", "mastoQ", "mastoPh", "mastoBad", "mastoGo", "sms"].forEach((k) => {
    assert.equal((s.match(new RegExp("\\b" + k + ": \"", "g")) || []).length, 2, k + " EN + EL");
    assert.ok(src("i18n/de/share.js").indexOf('"' + k + '":') >= 0, k + " DE");
  });
});

test("Receiving page: covers only from the music sources, audio needs a tap", () => {
  const page = src("share/index.html");
  const csp = /content="([^"]+)"/.exec(page.match(/<meta http-equiv="Content-Security-Policy"[^>]+>/)[0])[1];
  const img = csp.split(";").map((x) => x.trim()).find((x) => x.startsWith("img-src"));
  assert.ok(!/ https: /.test(img + " ") && img.indexOf("https://*.archive.org") > 0);
  assert.match(csp, /media-src https:/);
  assert.match(csp, /script-src 'self';/);
  const v = src("share/view.js");
  assert.match(v, /au\.preload = "none"/);
  assert.match(v, /function renderTrack/);
});

test("tracks: an album / playlist keeps each song by the song rules, Music receivers", async () => {
  const env = K.pack("tracks", { t: "Live 99", ty: "al", a: "Band", art: "https://archive.org/services/img/x", cr: "credit",
    i: [IA, { t: "Mine", a: "Me", s: "sv", u: "https://my.server/stream?t=tok", k: "sv:abcdef12" }, "junk"] });
  assert.equal(env.d.i.length, 2);
  assert.equal(env.d.i[0].cr, undefined, "one credit for the list");
  assert.deepEqual(env.d.i[1], { t: "Mine", a: "Me", s: "own" });
  assert.equal(K.summary(env, "en"), "Album «Live 99» · Band · 2 songs");
  assert.equal(K.file(env, "en").text, "#EXTM3U\n#EXTINF:183,The Band - Song A\n" + IA.u + "\n");
  const go = K.target(env, "en");
  assert.equal(go.app, "music");
  assert.equal(go.target.addList.n, "Live 99");
  assert.deepEqual(go.target.addList.refs.map((r) => r.k), ["ia:abc123def"]);
  const own = K.pack("tracks", { t: "Mix", ty: "pl", i: [{ t: "Mine", a: "Me", s: "sv" }] });
  assert.deepEqual(K.target(own, "en"), { app: "music", target: { findSong: { q: "Mix" } } });
  assert.equal(K.file(own, "en").name, "Mix.txt");
  assert.equal(K.pack("tracks", { t: "x", i: [] }), null);
  assert.equal(K.norm("tracks", { i: Array.from({ length: 300 }, (_, n) => ({ t: "s" + n })) }).i.length, 200);
  const back = await K.decode(await K.encode(env));
  assert.deepEqual(back.env, env);
  const m = src("music/music.js");
  assert.match(m, /if \(tg\.addList && typeof tg\.addList === "object"\) \{ addListTarget\(tg\.addList\); return; \}/);
  assert.match(m, /\[t\("m\.share"\), function \(\) \{ shareList\(p\.n, "pl"/);
  assert.match(m, /\[t\("m\.share"\), function \(\) \{ shareList\(al\.n, "al", al\.a, "", al\.list, ""\); \}\]/);
  ["sh.playAll", "sh.savePl"].forEach((k) => assert.ok(src("i18n/de/music.js").indexOf('"' + k + '":') >= 0, k));
  assert.match(src("share/view.js"), /function renderTracks/);
});
