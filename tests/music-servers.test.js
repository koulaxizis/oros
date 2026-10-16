// The user's own music servers (music/servers.js): addresses, the
// Subsonic token, the parsers for Subsonic, Jellyfin, Funkwhale,
// WebDAV and Dropbox answers (shapes copied from their APIs),
// playlist files (M3U, PLS, XSPF), music feeds, and how server songs
// travel in the sync slice "music" (core.js) without any login.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const C = require(path.join(__dirname, "..", "music/core.js")).OrosMusicCore;
const S = require(path.join(__dirname, "..", "music/servers.js"));
const X = require(path.join(__dirname, "..", "feeds/core.js"));

test("md5 matches the known values (Subsonic token)", () => {
  assert.equal(S.md5(""), "d41d8cd98f00b204e9800998ecf8427e");
  assert.equal(S.md5("The quick brown fox jumps over the lazy dog"), "9e107d9d372bb6826bd81d3542a419d6");
  // The example of the Subsonic API documentation.
  assert.equal(S.md5("sesame" + "c19b2d"), "26719a1196d2a940705a59634eb18eab");
  assert.equal(S.ssToken("sesame", "c19b2d").t, "26719a1196d2a940705a59634eb18eab");
  assert.equal(S.md5("ελληνικά"), "ab92487c3b6c67efc8214a37496edf0f");
  assert.equal(S.md5("a".repeat(64)), "014842d480b571495a4a0363793f7367");
  assert.equal(S.md5("a".repeat(56)), "3b0c8ac703f828b04c6c197006d17218");
});

test("server addresses are normalised and checked", () => {
  assert.equal(S.normBase("subsonic", "music.example.com/"), "https://music.example.com");
  assert.equal(S.normBase("subsonic", "https://Music.Example.com:4533/navidrome/rest/ping.view"), "https://music.example.com:4533/navidrome");
  assert.equal(S.normBase("jellyfin", "https://jf.example.com/web/index.html#!/home.html"), "https://jf.example.com");
  assert.equal(S.normBase("funkwhale", "https://open.audio/library/albums"), "https://open.audio");
  assert.equal(S.normBase("webdav", "https://cloud.example.com/remote.php/dav/files/chris/"), "https://cloud.example.com/remote.php/dav/files/chris");
  assert.equal(S.normBase("subsonic", "https://user:pass@example.com"), "");
  assert.equal(S.normBase("subsonic", "   "), "");
  assert.equal(S.allowedBase("https://a.example", "https:"), true);
  assert.equal(S.allowedBase("http://192.168.1.10:4533", "https:"), false);
  assert.equal(S.allowedBase("http://localhost:4533", "https:"), true);
  assert.equal(S.allowedBase("http://127.0.0.1:8096/jf", "https:"), true);
  assert.equal(S.allowedBase("http://192.168.1.10:4533", "http:"), true);
  assert.equal(S.allowedBase("ftp://x", "http:"), false);
  // The same server and user give the same id on every device.
  const a = S.serverId("subsonic", "https://music.example.com", "Chris");
  assert.equal(a, S.serverId("subsonic", "https://MUSIC.example.com", "chris"));
  assert.notEqual(a, S.serverId("jellyfin", "https://music.example.com", "chris"));
  assert.match(a, /^[0-9a-z]{6,14}$/);
  assert.equal(S.normDir(""), "/");
  assert.equal(S.normDir("Music//Rock/"), "/Music/Rock");
  assert.equal(S.normServer({ id: a, ty: "nope", b: "https://x" }), null);
  assert.deepEqual(S.normServer({ id: a, ty: "subsonic", b: "music.example.com", us: "chris", n: "", add: 5, pw: "secret" }),
    { id: a, ty: "subsonic", n: "Subsonic / Navidrome", b: "https://music.example.com", us: "chris", add: 5 });
});

test("Subsonic: request addresses carry a token, never the password", () => {
  const srv = { id: "abc123def", b: "https://music.example.com", us: "chris" };
  const u = S.ssUrl(srv, { t: "26719a1196d2a940705a59634eb18eab", s: "c19b2d" }, "getAlbumList2", { type: "newest", size: 40, offset: 0 });
  assert.equal(u, "https://music.example.com/rest/getAlbumList2?u=chris&v=1.16.1&c=orOS&f=json&t=26719a1196d2a940705a59634eb18eab&s=c19b2d&type=newest&size=40&offset=0");
  assert.ok(!/p=/.test(u));
  assert.match(S.ssUrl(srv, { p: "enc:736573616d65" }, "ping"), /&p=enc%3A736573616d65$/);
  assert.throws(() => S.ssCheck({ "subsonic-response": { status: "failed", error: { code: 40, message: "Wrong username or password" } } }), (e) => e.code === "auth");
  assert.throws(() => S.ssCheck({ "subsonic-response": { status: "failed", error: { code: 41 } } }), (e) => e.code === "token");
  assert.throws(() => S.ssCheck({ nope: 1 }), (e) => e.code === "format");
});

test("Subsonic: albums, an album, artists, search, playlists", () => {
  const sh = "abc123def";
  const list = S.ssParseAlbums({ "subsonic-response": { status: "ok", version: "1.16.1", albumList2: { album: [
    { id: "al-1", name: "Kind of Blue", artist: "Miles Davis", artistId: "ar-1", coverArt: "al-1", songCount: 5, year: 1959 },
    { id: "al-2", name: "Μάγισσα", artist: "Ελευθερία", artistId: "ar-2", songCount: 1 }
  ] } } });
  assert.equal(list.list.length, 2);
  assert.deepEqual(list.list[0], { id: "al-1", n: "Kind of Blue", a: "Miles Davis", ri: "ar-1", ca: "al-1", y: 1959, c: 5 });
  assert.equal(list.more, false);
  const al = S.ssParseAlbum({ "subsonic-response": { status: "ok", album: { id: "al-1", name: "Kind of Blue", artist: "Miles Davis", song: [
    { id: "tr-1", parent: "al-1", title: "So What", album: "Kind of Blue", artist: "Miles Davis", track: 1, duration: 562, albumId: "al-1", artistId: "ar-1", coverArt: "al-1", isDir: false },
    { id: "dir-1", title: "Extras", isDir: true }
  ] } } }, sh);
  assert.equal(al.tracks.length, 1);
  const r = al.tracks[0];
  assert.equal(r.k, "sv:" + C.hash(sh + "|tr-1"));
  assert.deepEqual([r.s, r.sh, r.ii, r.t, r.a, r.al, r.d, r.ai, r.ri, r.ca, r.n], ["sv", sh, "tr-1", "So What", "Miles Davis", "Kind of Blue", 562, "al-1", "ar-1", "al-1", 1]);
  assert.ok(!("u" in r) && !("art" in r));
  const ar = S.ssParseArtists({ "subsonic-response": { status: "ok", artists: { index: [{ name: "M", artist: [{ id: "ar-1", name: "Miles Davis", albumCount: 3 }] }, { name: "Ε", artist: { id: "ar-2", name: "Ελευθερία" } }] } } });
  assert.deepEqual(ar.list.map((a) => a.n), ["Miles Davis", "Ελευθερία"]);
  const one = S.ssParseArtist({ "subsonic-response": { status: "ok", artist: { id: "ar-1", name: "Miles Davis", album: [{ id: "al-1", name: "Kind of Blue" }] } } });
  assert.equal(one.artist.n, "Miles Davis");
  assert.equal(one.albums[0].id, "al-1");
  const s = S.ssParseSearch({ "subsonic-response": { status: "ok", searchResult3: { song: [{ id: "tr-1", title: "So What", artist: "Miles Davis" }], album: [{ id: "al-1", name: "Kind of Blue" }] } } }, sh);
  assert.equal(s.songs.length, 1);
  assert.equal(s.albums.length, 1);
  assert.deepEqual(s.artists, []);
  const pls = S.ssParsePlaylists({ "subsonic-response": { status: "ok", playlists: { playlist: [{ id: "15", name: "Evening", songCount: 12 }] } } });
  assert.deepEqual(pls.list, [{ id: "15", n: "Evening", c: 12, ca: "" }]);
  const pl = S.ssParsePlaylist({ "subsonic-response": { status: "ok", playlist: { id: "15", name: "Evening", entry: [{ id: "tr-9", title: "Blue in Green", artist: "Miles Davis", duration: 337 }] } } }, sh);
  assert.equal(pl.pl.n, "Evening");
  assert.equal(pl.tracks[0].d, 337);
  const rnd = S.ssParseSongs({ "subsonic-response": { status: "ok", randomSongs: { song: [{ id: "tr-2", title: "Freddie Freeloader" }] } } }, sh);
  assert.equal(rnd.list[0].ii, "tr-2");
});

test("Jellyfin: sign-in header, songs, albums, artists", () => {
  assert.equal(S.jfAuthHeader("dev1", ""), 'MediaBrowser Client="orOS", Device="Browser", DeviceId="dev1", Version="1.0"');
  assert.match(S.jfAuthHeader("dev1", "tok9"), /, Token="tok9"$/);
  const sh = "jf0000aa";
  const song = S.jfSong(sh, { Id: "a1b2c3", Name: "Σαν Σήμερα", Type: "Audio", MediaType: "Audio", Album: "Μπαλάντες", AlbumId: "alb9",
    AlbumPrimaryImageTag: "tag1", Artists: ["Ελευθερία Αρβανιτάκη"], ArtistItems: [{ Id: "art7", Name: "Ελευθερία Αρβανιτάκη" }], RunTimeTicks: 2150000000, IndexNumber: 3 });
  assert.deepEqual([song.ii, song.t, song.a, song.al, song.d, song.ai, song.ri, song.ca, song.n],
    ["a1b2c3", "Σαν Σήμερα", "Ελευθερία Αρβανιτάκη", "Μπαλάντες", 215, "alb9", "art7", "alb9", 3]);
  assert.equal(S.jfSong(sh, { Id: "v1", Name: "A film", Type: "Movie" }), null);
  assert.deepEqual(S.jfAlbum({ Id: "alb9", Name: "Μπαλάντες", AlbumArtist: "Ελευθερία", AlbumArtists: [{ Id: "art7", Name: "Ελευθερία" }], ProductionYear: 1998, ChildCount: 12, ImageTags: { Primary: "t" } }),
    { id: "alb9", n: "Μπαλάντες", a: "Ελευθερία", ri: "art7", ca: "alb9", y: 1998, c: 12 });
  assert.deepEqual(S.jfArtist({ Id: "art7", Name: "Ελευθερία", ImageTags: {} }), { id: "art7", n: "Ελευθερία", ca: "", c: 0 });
  const src = S.drivers.jellyfin.cover({ b: "https://jf.example.com" }, {}, "alb9");
  assert.equal(src, "https://jf.example.com/Items/alb9/Images/Primary?fillWidth=300&fillHeight=300&quality=90");
});

test("Funkwhale: tracks with old and new artist fields, albums, artists", () => {
  const sh = "fw0000aa";
  const tr = S.fwSong(sh, { id: 51, title: "Sunrise", position: 2, listen_url: "/api/v1/listen/2f3e4d5c-aaaa-bbbb-cccc-1234567890ab/",
    artist: { id: 7, name: "Old Artist" }, album: { id: 12, title: "Mornings", cover: { urls: { medium_square_crop: "https://open.audio/media/c.jpg" } } },
    uploads: [{ duration: 201 }] });
  assert.deepEqual([tr.ii, tr.t, tr.a, tr.al, tr.d, tr.ai, tr.ri, tr.ca, tr.n],
    ["2f3e4d5c-aaaa-bbbb-cccc-1234567890ab", "Sunrise", "Old Artist", "Mornings", 201, "12", "7", "https://open.audio/media/c.jpg", 2]);
  const tr2 = S.fwSong(sh, { id: 52, title: "Duet", listen_url: "/api/v1/listen/11111111-2222-3333-4444-555555555555/",
    artist_credit: [{ credit: "Anna", joinphrase: " & ", artist: { id: 3, name: "Anna" } }, { credit: "Bob", joinphrase: "", artist: { id: 4, name: "Bob" } }], album: {} });
  assert.equal(tr2.a, "Anna & Bob");
  assert.equal(tr2.ri, "3");
  assert.equal(S.fwSong(sh, { id: 53, title: "No audio" }), null);
  assert.deepEqual(S.fwAlbum({ id: 12, title: "Mornings", artist: { id: 7, name: "Old Artist" }, release_date: "2021-04-01", tracks_count: 9, cover: { urls: { original: "/media/o.jpg" } } }),
    { id: "12", n: "Mornings", a: "Old Artist", ri: "7", ca: "/media/o.jpg", y: 2021, c: 9 });
  assert.equal(S.drivers.funkwhale.cover({ b: "https://open.audio" }, {}, "/media/o.jpg"), "https://open.audio/media/o.jpg");
  assert.equal(S.fwArtist({ id: 7, name: "Old Artist", albums: [{}, {}] }).c, 2);
});

test("WebDAV: a Nextcloud PROPFIND answer becomes folders, songs and playlist files", () => {
  const base = "https://cloud.example.com/remote.php/dav/files/chris";
  const xml = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">
 <d:response><d:href>/remote.php/dav/files/chris/Music/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
 <d:response><d:href>/remote.php/dav/files/chris/Music/Rock%20%26%20Roll/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  <d:propstat><d:prop><d:getcontentlength/></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat></d:response>
 <d:response><d:href>/remote.php/dav/files/chris/Music/01%20-%20%CE%95%CE%BB%CE%B5%CF%85%CE%B8%CE%B5%CF%81%CE%AF%CE%B1%20-%20%CE%A3%CE%B1%CE%BD%20%CE%A3%CE%AE%CE%BC%CE%B5%CF%81%CE%B1.mp3</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontentlength>4200000</d:getcontentlength><d:getcontenttype>audio/mpeg</d:getcontenttype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
 <d:response><d:href>/remote.php/dav/files/chris/Music/cover.jpg</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontenttype>image/jpeg</d:getcontenttype></d:prop></d:propstat></d:response>
 <d:response><d:href>/remote.php/dav/files/chris/Music/party.m3u</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontenttype>audio/x-mpegurl</d:getcontenttype></d:prop></d:propstat></d:response>
</d:multistatus>`;
  const p = S.davParse(xml, base, "/Music");
  assert.deepEqual(p.dirs, [{ p: "/Music/Rock & Roll", n: "Rock & Roll" }]);
  assert.equal(p.files.length, 3);
  const f = S.davFolder("dav00001", p);
  assert.equal(f.songs.length, 1);
  assert.deepEqual([f.songs[0].ii, f.songs[0].t, f.songs[0].a, f.songs[0].n], ["/Music/01 - Ελευθερία - Σαν Σήμερα.mp3", "Σαν Σήμερα", "Ελευθερία", 1]);
  assert.deepEqual(f.lists.map((x) => x.n), ["party.m3u"]);
  // Other prefixes and absolute hrefs.
  const p2 = S.davParse('<D:multistatus xmlns:D="DAV:"><D:response><D:href>https://nas.example.com/dav/a.flac</D:href><D:propstat><D:prop><D:resourcetype/></D:prop></D:propstat></D:response></D:multistatus>', "https://nas.example.com/dav", "/");
  assert.deepEqual(p2.files.map((x) => x.p), ["/a.flac"]);
  assert.equal(S.encPath("/Music/Rock & Roll/a b.mp3"), "/Music/Rock%20%26%20Roll/a%20b.mp3");
});

test("Dropbox: a list_folder answer", () => {
  const f = S.dbxParse("dbx00001", [
    { ".tag": "folder", name: "Live", path_lower: "/music/live", path_display: "/Music/Live", id: "id:a" },
    { ".tag": "file", name: "Song.flac", path_lower: "/music/song.flac", path_display: "/Music/Song.flac", id: "id:b", size: 30000000 },
    { ".tag": "file", name: "notes.txt", path_display: "/Music/notes.txt", id: "id:c" },
    { ".tag": "file", name: "Mix.xspf", path_display: "/Music/Mix.xspf", id: "id:d" }
  ]);
  assert.deepEqual(f.dirs, [{ p: "/Music/Live", n: "Live" }]);
  assert.deepEqual(f.songs.map((x) => x.ii), ["/Music/Song.flac"]);
  assert.deepEqual(f.lists.map((x) => x.p), ["/Music/Mix.xspf"]);
});

test("playlist files: M3U, PLS and XSPF", () => {
  const m3u = "\ufeff#EXTM3U\n#PLAYLIST:Road trip\n#EXTINF:215,Ελευθερία - Σαν Σήμερα\nMusic/01 Σαν Σήμερα.mp3\n#EXTINF:-1,Radio\nhttps://radio.example.com/live.mp3\n\nC:\\Music\\b.mp3\nfile:///home/me/c%20d.ogg\n";
  const a = S.parsePlaylist(m3u, "trip.m3u", "");
  assert.equal(a.title, "Road trip");
  assert.equal(a.entries.length, 4);
  assert.deepEqual(a.entries[0], { t: "Σαν Σήμερα", a: "Ελευθερία", al: "", d: 215, art: "", path: "Music/01 Σαν Σήμερα.mp3" });
  assert.equal(a.entries[1].u, "https://radio.example.com/live.mp3");
  assert.equal(a.entries[2].path, "C:/Music/b.mp3");
  assert.equal(a.entries[3].path, "/home/me/c d.ogg");
  // Relative entries of a playlist read from an address.
  const b = S.parsePlaylist("#EXTM3U\nsongs/one.mp3\n", "x.m3u8", "https://music.example.com/lists/x.m3u8");
  assert.equal(b.entries[0].u, "https://music.example.com/lists/songs/one.mp3");
  const pls = S.parsePlaylist("[playlist]\nNumberOfEntries=2\nFile2=https://b.example/2.mp3\nTitle2=Two\nFile1=https://a.example/1.mp3\nTitle1=One\nLength1=60\nVersion=2\n", "a.pls", "");
  assert.deepEqual(pls.entries.map((e) => [e.u, e.t, e.d]), [["https://a.example/1.mp3", "One", 60], ["https://b.example/2.mp3", "Two", 0]]);
  const xspf = `<?xml version="1.0" encoding="UTF-8"?><playlist version="1" xmlns="http://xspf.org/ns/0/"><title>Mix &amp; more</title><trackList>
    <track><location>https://a.example/1.ogg</location><title>One</title><creator>Anna</creator><album>First</album><duration>61000</duration><image>https://a.example/c.jpg</image></track>
    <track><location>file:///music/2.mp3</location><title>Two</title></track></trackList></playlist>`;
  const x = S.parsePlaylist(xspf, "m.xspf", "");
  assert.equal(x.title, "Mix & more");
  assert.deepEqual([x.entries[0].u, x.entries[0].t, x.entries[0].a, x.entries[0].al, x.entries[0].d, x.entries[0].art], ["https://a.example/1.ogg", "One", "Anna", "First", 61, "https://a.example/c.jpg"]);
  assert.equal(x.entries[1].path, "/music/2.mp3");
  // Links become "ln" refs; http and other schemes are left out.
  const r = S.linkRef(x.entries[0]);
  assert.deepEqual([r.s, r.u, r.t, r.a, r.al, r.d, r.art], ["ln", "https://a.example/1.ogg", "One", "Anna", "First", 61, "https://a.example/c.jpg"]);
  assert.equal(r.k, "ln:" + C.hash("https://a.example/1.ogg"));
  assert.equal(S.linkRef({ u: "http://a.example/1.ogg" }), null);
  assert.equal(S.linkRef({ u: "https://a.example/path/My%20Song.mp3" }).t, "My Song");
});

test("music feeds: audio enclosures become songs", () => {
  const rss = `<?xml version="1.0"?><rss version="2.0" xmlns:podcast="https://podcastindex.org/namespace/1.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel>
    <title>Night Band</title><link>https://wavlake.com/night-band</link><podcast:medium>music</podcast:medium>
    <image><url>https://cdn.example.com/band.jpg</url></image>
    <item><title>First Light</title><guid>t1</guid><link>https://wavlake.com/track/t1</link><enclosure url="https://cdn.example.com/t1.mp3" type="audio/mpeg" length="123"/></item>
    <item><title>Video clip</title><guid>t2</guid><enclosure url="https://cdn.example.com/t2.mp4" type="video/mp4"/></item>
    <item><title>Old http</title><guid>t3</guid><enclosure url="http://cdn.example.com/t3.mp3" type="audio/mpeg"/></item>
  </channel></rss>`;
  const fd = X.parseFeed(rss, "https://wavlake.com/feed/night-band", 0);
  const songs = S.feedSongs(fd);
  assert.equal(songs.length, 1);
  assert.deepEqual([songs[0].s, songs[0].t, songs[0].a, songs[0].al, songs[0].u, songs[0].pg, songs[0].art],
    ["ln", "First Light", "Night Band", undefined, "https://cdn.example.com/t1.mp3", "https://wavlake.com/track/t1", "https://cdn.example.com/band.jpg"]);
});

test("server songs and links in the sync slice: no address, no login", () => {
  const sh = "abc123def";
  const song = S.ssSong(sh, { id: "tr-1", title: "So What", artist: "Miles Davis", album: "Kind of Blue", duration: 562, albumId: "al-1", artistId: "ar-1", coverArt: "al-1" });
  const shown = Object.assign({}, song, { art: "https://music.example.com/rest/getCoverArt?u=chris&t=secret&s=salt&id=al-1", u: "https://x/stream?t=secret" });
  let d = C.setLike(C.emptyData(), shown, true, 1000);
  const like = d.likes[0];
  assert.deepEqual(Object.keys(like).sort(), ["a", "ai", "al", "ca", "d", "ii", "k", "m", "on", "ri", "s", "sh", "t"]);
  assert.ok(!/secret/.test(JSON.stringify(d)));
  // The queue item has no cover address either.
  const it = C.itemOf(shown);
  assert.ok(!("art" in it) && !("u" in it));
  assert.equal(C.isServer(it), true);
  assert.equal(C.isRemote(it), false);
  // A key that does not belong to the server, or a bad server id, is a plain ref.
  assert.equal(C.normRef(Object.assign({}, song, { k: "ia:abcdef12" })).s, undefined);
  assert.equal(C.normRef(Object.assign({}, song, { sh: "BAD ID" })).s, undefined);
  // Links keep their https address and travel like catalogue songs.
  const ln = S.linkRef({ u: "https://a.example/1.ogg", t: "One", a: "Anna" });
  const r = C.addPl(d, "Mix", [song, ln], 2000);
  d = C.mergeMusic(r.data, C.emptyData());
  const pl = C.findPl(d, r.id);
  assert.equal(pl.it.length, 2);
  assert.equal(pl.it[0].sh, sh);
  assert.equal(pl.it[1].u, "https://a.example/1.ogg");
  assert.equal(C.isRemote(pl.it[1]), true);
  assert.equal(C.canon(d).pls[0].it[0].ii, "tr-1");
});
