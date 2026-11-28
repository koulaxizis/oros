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
  // MU-EMB2: an artist's own page plays its songs and grows like a playlist.
  assert.deepEqual(C.embedUrl("http://www.soundcloud.com/Forss/"), { kind: "sc", vi: "sc", u: "https://soundcloud.com/Forss" });
  assert.equal(C.embedGrows(C.scBare("https://soundcloud.com/forss")), true);
  [
    "https://soundcloud.com/discover", "https://soundcloud.com/forss/likes", "https://soundcloud.com/forss/tracks",
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

// MU-EMB2: Bandcamp albums and SoundCloud pages that MusicBrainz knows.
const A = require(path.join(__dirname, "..", "music/artists.js"));
const MB_RELEASES = {"release-count": 7, "releases": [{"id": "3d0a0276-c561-4c2b-9fe3-d02f676d2181", "title": "Live at the Fireside Bowl - 02.12.2000", "date": "2020-04-09", "relations": [{"type": "purchase for download", "url": {"resource": "https://ghostsandvodka.bandcamp.com/album/live-at-the-fireside-bowl-02122000"}}]}, {"id": "4f126fe6-3687-4c45-8149-33dae49cc9d4", "title": "Precious Blood", "date": "2020-06-20", "relations": [{"type": "discogs", "url": {"resource": "https://www.discogs.com/release/15150950"}}, {"type": "purchase for download", "url": {"resource": "https://ghostsandvodka.bandcamp.com/album/precious-blood-2"}}, {"type": "purchase for mail-order", "url": {"resource": "https://ghostsandvodka.bandcamp.com/album/precious-blood-2"}}]}, {"id": "6dd76526-e067-4d10-9b34-d3b7be7b0734", "title": "Addicts and Drunks", "date": "2003-09-23", "relations": [{"type": "amazon asin", "url": {"resource": "https://www.amazon.com/gp/product/B0000DESII"}}, {"type": "discogs", "url": {"resource": "https://www.discogs.com/release/1841455"}}]}, {"id": "c0140146-0656-4556-9ca5-e1be788d283a", "title": "Precious Blood", "date": "2020-06-20", "relations": [{"type": "discogs", "url": {"resource": "https://www.discogs.com/release/28676998"}}, {"type": "purchase for download", "url": {"resource": "https://ghostsandvodka.bandcamp.com/album/precious-blood-2"}}]}]};
test("parseBc keeps one entry per Bandcamp album page, newest first (same year: by title), with its cover", () => {
  const l = A.parseBc(MB_RELEASES);
  assert.deepEqual(l.map((x) => [x.t, x.y, x.u]), [
    ["Live at the Fireside Bowl - 02.12.2000", 2020, "https://ghostsandvodka.bandcamp.com/album/live-at-the-fireside-bowl-02122000"],
    ["Precious Blood", 2020, "https://ghostsandvodka.bandcamp.com/album/precious-blood-2"]
  ]);
  assert.match(l[0].cv, /^https:\/\/coverartarchive\.org\/release\/[0-9a-f-]{36}\/front-250$/);
  // Other hosts, artist roots and tampered addresses are left out.
  const bad = { releases: [{ id: MB_RELEASES.releases[0].id, title: "X", relations: [
    { url: { resource: "https://ghostsandvodka.bandcamp.com/" } }, { url: { resource: "https://evil.example/album/x" } },
    { url: { resource: "https://x.bandcamp.com/album/b?b=<script>" } }, { url: { resource: "http://x.bandcamp.com/album/a?from=mb" } }] }] };
  assert.deepEqual(A.parseBc(bad).map((x) => x.u), ["https://x.bandcamp.com/album/a"]);
  assert.deepEqual(A.parseBc({}), []);
  assert.match(A.bcUrl("7f7e1171-393c-4c38-b236-8e4440b83b0d", 100), /release\?artist=7f7e1171-393c-4c38-b236-8e4440b83b0d&inc=url-rels&fmt=json&limit=100&offset=100$/);
  assert.equal(A.bcUrl("x"), "");
});

test("parseEmbedLinks / scOf find the Bandcamp page and the SoundCloud profile", () => {
  const j = { relations: [
    { type: "bandcamp", url: { resource: "https://ghostsandvodka.bandcamp.com/" } },
    { type: "soundcloud", url: { resource: "https://soundcloud.com/ghostsandvodka" } },
    { type: "youtube", url: { resource: "https://www.youtube.com/x" } }] };
  assert.deepEqual(A.parseEmbedLinks(j), { bc: true, sc: "https://soundcloud.com/ghostsandvodka" });
  assert.deepEqual(A.parseEmbedLinks({ relations: [{ type: "discogs", url: { resource: "https://www.discogs.com/artist/1" } }] }), { bc: false, sc: "" });
  assert.equal(A.scOf([{ n: "SoundCloud", u: "https://soundcloud.com/discover" }]), "");
  assert.match(A.tagUrl('post-rock"'), /query=tag%3A%22post%20rock%22/);
  assert.equal(A.tagUrl(""), "");
});
