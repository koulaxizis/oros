// Television (television/core.js): M3U playlists (#EXTINF attributes,
// groups, guide addresses, unsafe lines), XMLTV guides (times and
// zones, entities / CDATA, languages, the day window, open-ended
// programmes), channel matching (tvg-id, @feed, names), now/next,
// the timeline layout and the synced list of addresses (old data
// unchanged, merge symmetric / idempotent / tombstones).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const zlib = require("zlib");

const C = require(path.join(__dirname, "..", "television/core.js"));

const M3U = [
  '﻿#EXTM3U x-tvg-url="https://epg.example.gr/guide.xml.gz,https://b.example.gr/g.xml" url-tvg="javascript:alert(1)"',
  '#EXTINF:-1 tvg-id="ERT1.gr@SD" tvg-name="ERT 1" tvg-logo="https://logo.example.gr/ert1.png" group-title="Ειδήσεις, Γενικά",ΕΡΤ1 HD',
  '#EXTVLCOPT:http-referrer=https://x.example',
  'https://live.example.gr/ert1/index.m3u8',
  '#EXTINF:-1 tvg-logo="http://insecure.example/logo.png" group-title="Movies",<img src=x onerror=alert(1)>',
  'https://live.example.gr/movie.m3u8?token=1',
  '#EXTINF:0,Radio-like',
  '#EXTGRP:Music',
  'http://plain.example.gr/stream.ts',
  '#EXTINF:-1,Bad scheme',
  'javascript:alert(1)',
  '#EXTINF:-1,Duplicate',
  'https://live.example.gr/ert1/index.m3u8',
  'https://bare.example.gr/path/Channel%20Five.m3u8',
  ''
].join("\r\n");

test("m3u: attributes, groups, guide addresses, unsafe lines", () => {
  const r = C.parseM3U(M3U);
  assert.deepEqual(r.epgUrls, ["https://epg.example.gr/guide.xml.gz", "https://b.example.gr/g.xml"]);
  assert.equal(r.channels.length, 4);
  const [a, b, c, d] = r.channels;
  assert.equal(a.name, "ΕΡΤ1 HD");
  assert.equal(a.tvgId, "ERT1.gr@SD");
  assert.equal(a.tvgName, "ERT 1");
  assert.equal(a.group, "Ειδήσεις, Γενικά");          // comma inside quotes is not the name split
  assert.equal(a.logo, "https://logo.example.gr/ert1.png");
  assert.match(a.id, /^m3u:[0-9a-f]{16}$/);
  assert.equal(b.logo, "");                              // http logo refused
  assert.equal(b.name, "<img src=x onerror=alert(1)>"); // kept as text; the app escapes it
  assert.equal(c.group, "Music");                         // #EXTGRP
  assert.equal(c.url, "http://plain.example.gr/stream.ts");
  assert.equal(d.name, "Channel Five.m3u8");              // bare URL: name from the path
  assert.equal(d.group, "");
  assert.equal(r.skipped, 1);                             // javascript: line
  assert.deepEqual(r.groups, ["Ειδήσεις, Γενικά", "Movies", "Music"]);
  // stable ids: same URL, same id on every device
  assert.equal(C.parseM3U(M3U).channels[0].id, a.id);
});

test("m3u: empty / junk input and the channel cap", () => {
  assert.deepEqual(C.parseM3U("").channels, []);
  assert.deepEqual(C.parseM3U(null).channels, []);
  assert.equal(C.parseM3U("<html>nope</html>").channels.length, 0);
  const many = ["#EXTM3U"];
  for (let i = 0; i < C.MAX_CHANNELS + 5; i++) many.push("https://s.example/" + i + ".m3u8");
  const r = C.parseM3U(many.join("\n"));
  assert.equal(r.channels.length, C.MAX_CHANNELS);
  assert.equal(r.truncated, true);
});

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE tv SYSTEM "xmltv.dtd">
<tv generator-info-name="test">
  <channel id="ERT1.gr@SD">
    <display-name lang="el">ΕΡΤ1</display-name>
    <display-name lang="en">ERT 1</display-name>
    <icon src="https://logo.example.gr/ert1.png"/>
  </channel>
  <channel id="Other.gr"><display-name>Άλλο κανάλι</display-name><icon src="javascript:alert(1)"/></channel>
  <programme start="20261014060000 +0300" stop="20261014090000 +0300" channel="ERT1.gr@SD">
    <title lang="en">Morning</title><title lang="el">Πρωινό</title>
    <desc lang="el">Ειδήσεις &amp; καιρός &#931; &#x3a3; &unknown;</desc>
    <category lang="el">Ειδήσεις</category>
  </programme>
  <programme start="20261014090000 +0300" stop="20261014100000 +0300" channel="ERT1.gr@SD">
    <title><![CDATA[Tom & <Jerry>]]></title>
    <sub-title>Ep. 2</sub-title>
  </programme>
  <programme start="20261014070000Z" channel="Other.gr"><title>Open 1</title></programme>
  <programme start="20261014080000Z" channel="Other.gr"><title>Open 2</title></programme>
  <programme start="20261020000000 +0000" stop="20261020010000 +0000" channel="Other.gr"><title>Far future</title></programme>
  <programme start="bad" stop="20261020010000" channel="Other.gr"><title>Bad time</title></programme>
</tv>`;

test("xmltv: times with zones, no zone is UTC", () => {
  assert.equal(C.xmltvTime("20261014060000 +0300"), Date.UTC(2026, 9, 14, 3, 0, 0));
  assert.equal(C.xmltvTime("20261014060000 -02:30"), Date.UTC(2026, 9, 14, 8, 30, 0));
  assert.equal(C.xmltvTime("20261014060000"), Date.UTC(2026, 9, 14, 6, 0, 0));
  assert.equal(C.xmltvTime("202610140600"), Date.UTC(2026, 9, 14, 6, 0, 0));
  assert.ok(Number.isNaN(C.xmltvTime("tomorrow")));
});

test("xmltv: channels, programmes, languages, entities, CDATA, window, open ends", () => {
  const from = Date.UTC(2026, 9, 14, 0, 0), to = Date.UTC(2026, 9, 15, 6, 0);
  const g = C.parseXMLTV(XML, { from, to, lang: "el" });
  assert.deepEqual(g.channels["ERT1.gr@SD"], { names: ["ΕΡΤ1", "ERT 1"], icon: "https://logo.example.gr/ert1.png" });
  assert.equal(g.channels["Other.gr"].icon, "");          // javascript: icon refused
  const e = g.progs["ERT1.gr@SD"];
  assert.equal(e.length, 2);
  assert.equal(e[0].t, "Πρωινό");                         // preferred language
  assert.equal(e[0].d, "Ειδήσεις & καιρός Σ Σ &unknown;");
  assert.equal(e[0].c, "Ειδήσεις");
  assert.equal(e[1].t, "Tom & <Jerry>");                  // CDATA kept as text
  assert.equal(e[1].st, "Ep. 2");
  const o = g.progs["Other.gr"];
  assert.deepEqual(o.map((p) => p.t), ["Open 1", "Open 2"]); // far future + bad time dropped
  assert.equal(o[0].e, Date.UTC(2026, 9, 14, 8, 0));      // open end closed at the next start
  assert.equal(o[1].e - o[1].s, 30 * 60000);              // last open one: 30 min
  assert.equal(o[0].open, undefined);
  assert.equal(g.count, 4);
  // English preference picks the English title
  assert.equal(C.parseXMLTV(XML, { lang: "en" }).progs["ERT1.gr@SD"][0].t, "Morning");
  // not XMLTV at all
  assert.deepEqual(C.parseXMLTV("<html><title>x</title></html>").progs, {});
});

test("xmltv: gzip files are unpacked", async () => {
  const gz = new Uint8Array(zlib.gzipSync(Buffer.from(XML)));
  const out = await C.gunzipIfNeeded(gz);
  assert.equal(new TextDecoder().decode(out), XML);
  const plain = new TextEncoder().encode("#EXTM3U");
  assert.equal(await C.gunzipIfNeeded(plain), plain);
});

test("matching: tvg-id, @feed suffix, case, display names", () => {
  const g = C.parseXMLTV(XML, {});
  const idx = C.buildIndex([g]);
  assert.ok(C.lookup(idx, { tvgId: "ert1.gr" }));              // case + no feed
  assert.ok(C.lookup(idx, { id: "ERT1.gr" }));                 // iptv-org catalog id
  assert.ok(C.lookup(idx, { id: "m3u:1", name: "ERT 1 HD" })); // name fallback (HD token)
  assert.ok(C.lookup(idx, { id: "m3u:2", name: "άλλο κανάλι" })); // accents + case
  assert.equal(C.lookup(idx, { id: "m3u:3", name: "Nothing" }), null);
  assert.equal(C.lookup(null, { id: "x" }), null);
  // two sources for one channel merge, sorted, repeated starts once
  const idx2 = C.buildIndex([g, g]);
  assert.equal(idx2.byKey["ert1.gr"].length, 2);
});

test("now/next: inside, between, before, after, empty", () => {
  const H = 3600000, t0 = Date.UTC(2026, 9, 14, 10);
  const progs = [{ s: t0, e: t0 + H, t: "A" }, { s: t0 + H, e: t0 + 2 * H, t: "B" }, { s: t0 + 3 * H, e: t0 + 4 * H, t: "C" }];
  let r = C.nowNext(progs, t0 + H / 4);
  assert.equal(r.now.t, "A"); assert.equal(r.next.t, "B"); assert.equal(r.pct, 25);
  r = C.nowNext(progs, t0 + H);                    // boundary: B has started
  assert.equal(r.now.t, "B"); assert.equal(r.next.t, "C"); assert.equal(r.pct, 0);
  r = C.nowNext(progs, t0 + 2.5 * H);              // gap
  assert.equal(r.now, null); assert.equal(r.next.t, "C");
  r = C.nowNext(progs, t0 - H);
  assert.equal(r.now, null); assert.equal(r.next.t, "A");
  r = C.nowNext(progs, t0 + 5 * H);
  assert.equal(r.now, null); assert.equal(r.next, null);
  assert.deepEqual(C.nowNext([], t0), { now: null, next: null, pct: 0 });
  assert.deepEqual(C.nowNext(null, t0), { now: null, next: null, pct: 0 });
});

test("day range, labels and the timeline layout", () => {
  const ts = new Date(2026, 9, 14, 15, 30).getTime();
  const d = C.dayRange(ts);
  assert.equal(d.start, new Date(2026, 9, 14).getTime());
  assert.equal(d.end, new Date(2026, 9, 15).getTime());
  assert.equal(C.ymd(ts), "2026-10-14");
  assert.equal(C.hhmm(ts), "15:30");
  const H = 3600000;
  const progs = [{ s: d.start - H, e: d.start + H }, { s: d.start + H, e: d.start + 90 * 60000 }, { s: d.end, e: d.end + H }];
  const row = C.layoutRow(progs, d.start, d.end, 4);
  assert.deepEqual(row.map((x) => [x.left, x.width]), [[0, 240], [240, 120]]); // clipped at midnight; next day out
  const w = C.windowGuide({ channels: { a: { names: ["A"] }, b: { names: ["B"] } },
    progs: { a: progs, b: [{ s: d.end + H, e: d.end + 2 * H }] } }, d.start, d.end);
  assert.equal(w.progs.a.length, 2);
  assert.deepEqual(Object.keys(w.channels), ["a"]);
});

test("sync: old data stays byte-identical; sources canonical", () => {
  const old = { ver: 1, favorites: [{ id: "ERT1.gr", name: "ΕΡΤ1", url: "https://x/1.m3u8", mtime: 5 }], deleted: { "A.gr": 3 } };
  const before = JSON.stringify(old);
  C.normSources(old);
  assert.equal(JSON.stringify(old), before);
  const url = "https://lists.example.gr/tv.m3u";
  const id = C.sourceId("m3u", url);
  assert.match(id, /^m[0-9a-f]{16}$/);
  assert.match(C.sourceId("xmltv", url), /^x[0-9a-f]{16}$/);
  const o = { ver: 1, favorites: [], deleted: {}, srcDel: { zz: 1, [C.sourceId("xmltv", "https://g/")]: 9 },
    sources: [{ id, kind: "m3u", url, name: "Λίστα", mtime: 2 }, { id: "mbad", kind: "m3u", url, mtime: 1 },
              { id: C.sourceId("m3u", "javascript:x"), kind: "m3u", url: "javascript:alert(1)", mtime: 1 },
              { id, kind: "m3u", url, name: "older", mtime: 1 }] };
  C.normSources(o);
  assert.deepEqual(Object.keys(o), ["ver", "favorites", "deleted", "sources", "srcDel"]);
  assert.deepEqual(o.sources, [{ id, kind: "m3u", url, name: "Λίστα", mtime: 2 }]);
  assert.deepEqual(Object.keys(o.srcDel), [C.sourceId("xmltv", "https://g/")]);
});

function rnd(seed) { return () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }; }
function randSide(r) {
  const urls = ["https://a.example/1.m3u", "https://b.example/2.m3u", "https://c.example/g.xml", "https://d.example/4.m3u"];
  const s = { sources: [], srcDel: {} };
  urls.forEach((u, i) => {
    const kind = i === 2 ? "xmltv" : "m3u", id = C.sourceId(kind, u), x = r();
    if (x < 0.4) s.sources.push({ id, kind, url: u, name: "n" + Math.floor(r() * 3), mtime: 1 + Math.floor(r() * 4) });
    else if (x < 0.7) s.srcDel[id] = 1 + Math.floor(r() * 4);
  });
  return C.normSources(s);
}

test("sync: merge is symmetric, idempotent, associative; tombs win ties, newer edits resurrect", () => {
  const r = rnd(43);
  for (let i = 0; i < 3000; i++) {
    const a = randSide(r), b = randSide(r), c = randSide(r);
    const ab = C.mergeSources(a, b);
    assert.deepEqual(ab, C.mergeSources(b, a));
    assert.deepEqual(C.mergeSources(ab, ab), ab);
    assert.deepEqual(C.mergeSources(C.mergeSources(a, b), c), C.mergeSources(a, C.mergeSources(b, c)));
  }
  const url = "https://a.example/1.m3u", id = C.sourceId("m3u", url);
  const live = { sources: [{ id, kind: "m3u", url, name: "", mtime: 5 }] };
  assert.deepEqual(C.mergeSources(live, { srcDel: { [id]: 5 } }).sources, undefined);  // tie: delete wins
  assert.equal(C.mergeSources(live, { srcDel: { [id]: 4 } }).sources.length, 1);        // newer add resurrects
  assert.deepEqual(C.mergeSources({}, {}), {});
  // no loss: two devices each add a different list
  const u2 = "https://b.example/2.m3u";
  const m = C.mergeSources(live, { sources: [{ id: C.sourceId("m3u", u2), kind: "m3u", url: u2, name: "", mtime: 1 }] });
  assert.equal(m.sources.length, 2);
  assert.equal(C.liveSources({ sources: m.sources, srcDel: { [id]: 9 } }).length, 1);
});

test("helpers: hash, urls, names", () => {
  assert.equal(C.hash("abc"), C.hash("abc"));
  assert.notEqual(C.hash("abc"), C.hash("abd"));
  assert.equal(C.httpUrl(" https://x.example/a "), "https://x.example/a");
  assert.equal(C.httpUrl("ftp://x"), "");
  assert.equal(C.httpUrl('https://x/"onload='), "");
  assert.equal(C.safeLogo("http://x/a.png"), "");
  assert.equal(C.nameFromUrl("https://www.lists.example.gr/tv/ελληνικά.m3u"), "lists.example.gr · ελληνικά.m3u");
  assert.equal(C.nameKey("ΕΡΤ1 HD (1080p) [Geo-blocked]"), "ερτ1");
  assert.equal(C.decodeText("a<b>c</b>&lt;"), "ac<");
});
