// MU-EMB: Bandcamp / SoundCloud links that play in the service's own
// player inside Music (core.js embedUrl, bcParse, scParse, embedSrc and
// the "em" ref in synced data). The page heads below are copied from
// real pages (2026-11-27), trimmed to their meta tags.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const C = require(path.join(__dirname, "..", "music/core.js")).OrosMusicCore;

const BC_ALBUM = `<!DOCTYPE html><html><head>
<meta property="og:title" content="Precious Blood, by Ghosts and Vodka">
<meta property="og:type" content="album">
<meta name="bc-page-properties" content="{&quot;item_type&quot;:&quot;a&quot;,&quot;item_id&quot;:2914435326,&quot;tralbum_page_version&quot;:0}">
<meta property="og:image" content="https://f4.bcbits.com/img/a1130178532_5.jpg">
<meta property="og:url"   content="https://ghostsandvodka.bandcamp.com/album/precious-blood-2">
<meta property="og:video:type" content="text/html">
</head><body></body></html>`;
const BC_TRACK = `<head>
<meta property="og:title" content="Andrea Loves Horses, by Ghosts and Vodka">
<meta name="bc-page-properties" content="{&quot;item_type&quot;:&quot;t&quot;,&quot;item_id&quot;:1331673160,&quot;tralbum_page_version&quot;:0}">
<meta property="og:image" content="https://f4.bcbits.com/img/a1130178532_5.jpg">
</head>`;
const SC_OEMBED = { version: 1.0, type: "rich", provider_name: "SoundCloud", provider_url: "https://soundcloud.com", height: 400, width: "100%",
  title: "Flickermood by Forss", thumbnail_url: "https://i1.sndcdn.com/artworks-000067273316-smsiqx-t500x500.jpg", author_name: "Forss", author_url: "https://soundcloud.com/forss" };
const ALBUM = "https://ghostsandvodka.bandcamp.com/album/precious-blood-2";
const TRACK = "https://ghostsandvodka.bandcamp.com/track/andrea-loves-horses";
const SC = "https://soundcloud.com/forss/flickermood";

test("embedUrl takes only Bandcamp albums/songs and SoundCloud songs/playlists", () => {
  assert.deepEqual(C.embedUrl(ALBUM + "?from=search#x"), { kind: "bc", vi: "album", u: ALBUM });
  assert.deepEqual(C.embedUrl("http://GhostsAndVodka.bandcamp.com/track/Andrea-Loves-Horses/"), { kind: "bc", vi: "track", u: TRACK });
  assert.deepEqual(C.embedUrl("https://m.soundcloud.com/forss/flickermood/"), { kind: "sc", vi: "sc", u: SC });
  assert.equal(C.embedUrl("https://soundcloud.com/forss/sets/soulhack").u, "https://soundcloud.com/forss/sets/soulhack");
  [
    "https://soundcloud.com/forss", "https://soundcloud.com/forss/likes", "https://soundcloud.com/forss/tracks",
    "https://soundcloud.com/discover/sets/x", "https://on.soundcloud.com/abc", "https://soundcloud.com.evil.com/a/b",
    "https://evil.com/x.bandcamp.com/album/y", "https://bandcamp.com/album/x", "https://daily.bandcamp.com/album/x",
    "https://x.bandcamp.com/music", "https://x.bandcamp.com/album/a/b", "javascript:alert(1)", "ftp://x.bandcamp.com/album/y", "", null, 5
  ].forEach((u) => assert.equal(C.embedUrl(u), null, String(u)));
});

test("bcParse reads the page's own id, title, artist and cover", () => {
  const r = C.bcParse(BC_ALBUM, ALBUM);
  assert.deepEqual(r, { k: "em:" + C.hash(ALBUM), t: "Precious Blood", a: "Ghosts and Vodka", al: "Precious Blood", s: "em", u: ALBUM, vi: "album", ai: "2914435326", art: "https://f4.bcbits.com/img/a1130178532_5.jpg" });
  const s = C.bcParse(BC_TRACK, TRACK);
  assert.equal(s.vi, "track"); assert.equal(s.ai, "1331673160"); assert.equal(s.t, "Andrea Loves Horses"); assert.equal(s.al, undefined);
  // A song page under an album address (or the other way) is refused.
  assert.equal(C.bcParse(BC_TRACK, "https://ghostsandvodka.bandcamp.com/album/andrea-loves-horses"), null);
  assert.equal(C.bcParse("<html>nothing</html>", ALBUM), null);
  assert.equal(C.bcParse(BC_ALBUM, SC), null);
  // A cover on another host is dropped.
  assert.equal(C.bcParse(BC_ALBUM.replace("f4.bcbits.com", "evil.example"), ALBUM).art, undefined);
});

test("scParse takes title, artist and cover from SoundCloud's oEmbed", () => {
  assert.deepEqual(C.scParse(SC_OEMBED, SC), { k: "em:" + C.hash(SC), t: "Flickermood", a: "Forss", s: "em", u: SC, vi: "sc", art: SC_OEMBED.thumbnail_url });
  assert.equal(C.scParse(Object.assign({}, SC_OEMBED, { provider_name: "Other" }), SC), null);
  assert.equal(C.scParse(SC_OEMBED, ALBUM), null);
  const b = C.scBare("https://soundcloud.com/forss/sets/soulhack");
  assert.equal(b.t, "soulhack"); assert.equal(b.a, "forss"); assert.equal(b.vi, "sc");
  assert.equal(C.scBare(ALBUM), null);
});

test("embedSrc makes only the services' own player addresses", () => {
  const a = C.bcParse(BC_ALBUM, ALBUM), s = C.scParse(SC_OEMBED, SC);
  assert.equal(C.embedSrc(a, { dark: true, color: "8A8A8A" }), "https://bandcamp.com/EmbeddedPlayer/album=2914435326/size=large/bgcol=333333/linkcol=8a8a8a/tracklist=true/artwork=small/transparent=true/");
  assert.match(C.embedSrc(s, { color: "zz" }), /^https:\/\/w\.soundcloud\.com\/player\/\?url=https%3A%2F%2Fsoundcloud\.com%2Fforss%2Fflickermood&auto_play=true&/);
  assert.equal(C.embedSrc(Object.assign({}, a, { ai: "1/../x" })), "");
  assert.equal(C.embedHeight(a), 400); assert.equal(C.embedHeight(s), 166);
  // A phone starts small: no track list, a song's height.
  assert.match(C.embedSrc(a, { small: true }), /\/tracklist=false\//);
  assert.equal(C.embedHeight(a, true), 120);
  assert.equal(C.embedGrows(a), true); assert.equal(C.embedGrows(s), false);
  assert.equal(C.embedGrows(C.scBare("https://soundcloud.com/forss/sets/soulhack")), true);
});

test("an em ref survives sync merges and never counts as a stream", () => {
  const a = C.bcParse(BC_ALBUM, ALBUM), s = C.scParse(SC_OEMBED, SC);
  assert.equal(C.isEmbed(a), true); assert.equal(C.isEmbed(s), true);
  assert.equal(C.isRemote(a), false); assert.equal(C.isRemote(s), false);
  let d = C.setLike(C.emptyData(), a, true, 1000);
  d = C.addPl(d, "Mix", [s, a], 2000).data;
  const m = C.mergeMusic(d, {});
  assert.deepEqual(m.likes[0].ai, "2914435326");
  assert.deepEqual(m.pls[0].it.map((x) => x.s + "|" + x.vi), ["em|sc", "em|album"]);
  // Tampered entries lose the player fields (they stay as names only).
  const bad = C.normRef(Object.assign({}, a, { u: "https://evil.example/album/x" }));
  assert.equal(bad.s, undefined); assert.equal(C.isEmbed(bad), false);
  assert.equal(C.normRef(Object.assign({}, a, { vi: "track" })).s, undefined);
  assert.equal(C.normRef(Object.assign({}, a, { ai: "x" })).s, undefined);
  assert.equal(C.normRef(Object.assign({}, s, { k: "ia:" + C.hash(SC) })).s, undefined);
});
