// Studio wave P1 (Publish as podcast): shows, episodes, markers, the
// feed (read back by the Podcasts app's own parser), the chapters file,
// the show's page, ID3 tags and the site ZIP.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const zlib = require("zlib");
const P = require("../studio/podcast.js");
const C = require("../studio/core.js");
const PC = require("../podcasts/core.js").OrosPodcastsCore;
const FEEDS = require("../feeds/core.js");

const SHOW = {
  id: "hshow0001", m: 5, title: "Ιστορίες της γειτονιάς", author: "Chris & co", desc: "Μια εκπομπή <για> όλους.\n\nΔεύτερη παράγραφος.",
  lang: "el", cat: "Society & Culture", sub: "Documentary", explicit: false, type: "episodic",
  url: "https://chris.github.io/geitonia", email: "me@example.com", fund: "https://ko-fi.com/me",
  cover: "/internal/Studio/Podcasts/hshow0001/cover.jpg"
};
function proj(id, m, x) {
  return Object.assign({ id, m, name: "Take", bpm: 120, sig: 4, vol: 0, loop: { on: false, a: 0, b: 0 }, fx: [] }, x || {});
}
function ready(show, pid, n, date, x) {
  return Object.assign({
    n, type: "full", title: "Επεισόδιο " + n, desc: "Για το " + n + " & τα <άλλα>.", date, guid: P.epGuid(show.id, pid),
    slug: P.epSlug({ n, type: "full" }, "Επεισόδιο " + n), bytes: 1000 + n, dur: 600 + n, kbps: 96, ch: 1
  }, x || {}, { file: "" });
}
const MK = [{ id: "kmark0001", t: 0, n: "Αρχή" }, { id: "kmark0002", t: 120.5, n: "Θέμα" }];
function withFile(show, pid, n, date, x, mk) {
  const m = mk === undefined ? MK : mk;
  const ep = Object.assign(ready(show, pid, n, date, x), { mh: P.markerHash(m) });
  ep.file = P.epPath(show.id, ep.slug);
  return proj(pid, 5, { sh: show.id, ep, mk: m });
}

test("P1: show normalising keeps good fields and drops bad ones", () => {
  const s = P.normShow(SHOW);
  assert.equal(s.url, "https://chris.github.io/geitonia/", "a trailing slash is added");
  assert.equal(s.cat, "Society & Culture");
  assert.equal(s.sub, "Documentary");
  assert.equal(s.lang, "el");
  const bad = P.normShow(Object.assign({}, SHOW, {
    url: "http://insecure.example.com/", email: "nope", fund: "javascript:alert(1)", cat: "Cooking", sub: "Documentary",
    lang: "<x>", type: "weird", cover: "/internal/Other/x.jpg", guid: "not-a-uuid", title: "a\u0000b\nc"
  }));
  assert.equal(bad.url, "", "the site must be https");
  assert.equal(bad.email, "");
  assert.equal(bad.fund, "");
  assert.equal(bad.cat, "");
  assert.equal(bad.sub, "", "no subcategory without its category");
  assert.equal(bad.lang, "en");
  assert.equal(bad.type, "episodic");
  assert.equal(bad.cover, "");
  assert.equal(bad.guid, "");
  assert.equal(bad.title, "a b c");
  assert.equal(P.normShow({ id: "pnotashow", m: 1 }), null);
  assert.equal(P.normShow({ id: "hshow0001" }), null, "a stamp is needed");
  assert.equal(P.siteUrl("https://user:pw@host.example/"), "", "no user name in the address");
  assert.equal(P.siteUrl("https://Host.Example/a?b"), "", "no query");
});

test("P1: episodes and markers are bounded and ordered", () => {
  const mk = [];
  for (let i = 0; i < 70; i++) mk.push({ id: "kmark" + String(1000 + i), t: 70 - i, n: "M" + i });
  mk.push({ id: "kmark1000", t: 5, n: "dup" }, { id: "bad", t: 1 }, { id: "kmark9999", t: "x" });
  const list = P.normMarkers(mk);
  assert.equal(list.length, P.LIM.markers);
  for (let i = 1; i < list.length; i++) assert.ok(list[i - 1].t <= list[i].t);
  assert.ok(!list.some((x) => x.n === "dup"), "the first of two equal ids wins");
  const ep = P.normEp({ n: 3.5, se: 200, type: "x", date: -1, kbps: 100, ch: 3, file: "/internal/Studio/Podcasts/hshow0001/../x.mp3", bytes: 9, dur: 9 });
  assert.deepEqual([ep.n, ep.se, ep.type, ep.date, ep.kbps, ep.ch, ep.file, ep.bytes, ep.dur], [0, 99, "full", 0, 96, 1, "", 0, 0]);
  const ok = P.normEp({ file: "/internal/Studio/Podcasts/hshow0001/001-a.mp3", bytes: 9, dur: 4000 });
  assert.equal(ok.dur, P.LIM.dur);
  assert.equal(P.addMarker([], 12.3456, "kmark0001", "Intro")[0].t, 12.346);
  const two = P.addMarker(P.addMarker([], 30, "kmark0002", "B"), 10, "kmark0001", "A");
  assert.deepEqual(two.map((x) => x.n), ["A", "B"]);
  assert.deepEqual(P.setMarker(two, "kmark0001", { t: 40 }).map((x) => x.n), ["B", "A"]);
  assert.deepEqual(P.removeMarker(two, "kmark0002").map((x) => x.id), ["kmark0001"]);
});

test("P1: chapters from markers", () => {
  const mk = [{ id: "kmark0001", t: 30, n: "Θέμα" }, { id: "kmark0002", t: 30.2, n: "Too close" }, { id: "kmark0003", t: 99.8, n: "At the end" }];
  const ch = P.chapters(mk, 100, "Εισαγωγή");
  assert.deepEqual(ch, [{ start: 0, end: 30, title: "Εισαγωγή" }, { start: 30, end: 100, title: "Θέμα" }]);
  assert.deepEqual(P.chapters([], 100), []);
  assert.deepEqual(P.chapters([{ id: "kmark0001", t: 0.2, n: "A" }], 50), [{ start: 0, end: 50, title: "A" }]);
  const json = JSON.parse(P.chaptersJson(ch));
  assert.equal(json.version, "1.2.0");
  assert.deepEqual(json.chapters[1], { startTime: 30, endTime: 100, title: "Θέμα" });
  const pc = PC.normChapters(json);
  assert.equal(pc.length, 2, "the Podcasts app reads our chapters file");
});

test("P1: UUIDv5 and SHA-1 follow the standards", () => {
  const h = (b) => Buffer.from(b).toString("hex");
  assert.equal(h(P.sha1([])), crypto.createHash("sha1").update("").digest("hex"));
  const long = "Καλημέρα κόσμε 🎙 ".repeat(20);
  assert.equal(h(P.sha1(P.utf8(long))), crypto.createHash("sha1").update(long, "utf8").digest("hex"));
  // the example of the Podcasting 2.0 spec (podcast:guid)
  assert.equal(P.feedGuid("https://mp3s.nashownotes.com/pc20rss.xml"), "917393e3-1b1e-5cef-ace4-edaa54e1f810");
  assert.equal(P.feedGuid("mp3s.nashownotes.com/pc20rss.xml/"), "917393e3-1b1e-5cef-ace4-edaa54e1f810", "scheme and trailing slashes do not count");
  const g = P.epGuid("hshow0001", "pproject1");
  assert.match(g, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(g, P.epGuid("hshow0001", "pproject1"), "the same project always gives the same guid");
  assert.notEqual(g, P.epGuid("hshow0001", "pproject2"));
  assert.notEqual(g, P.epGuid("hshow0002", "pproject1"));
});

test("P1: file names are ASCII and stay free", () => {
  assert.equal(P.slug("Η Ψυχή του Ωκεανού!"), "i-psychi-tou-okeanou");
  assert.equal(P.slug("Café déjà vu"), "cafe-deja-vu");
  assert.equal(P.slug("🎙🎙"), "episode");
  assert.equal(P.epSlug({ n: 7, type: "full" }, "Πρώτη μέρα"), "007-proti-mera");
  assert.equal(P.epSlug({ n: 0, type: "trailer" }, "Καλώς ήρθατε"), "trailer-kalos-irthate");
  assert.equal(P.epSlug({ n: 7, type: "full" }, "Πρώτη μέρα", { "007-proti-mera": 1 }), "007-proti-mera-2");
  assert.equal(P.epPath("hshow0001", "007-a"), "/internal/Studio/Podcasts/hshow0001/007-a.mp3");
  assert.ok(P.normEp({ file: P.epPath("hshow0001", "007-a") }).file, "our own paths pass the check");
  assert.ok(P.normShow(Object.assign({}, SHOW, { cover: P.coverPath("hshow0001", "png") })).cover);
});

test("P1: the feed is valid RSS that the Podcasts app reads back", () => {
  const show = P.normShow(SHOW);
  show.guid = P.feedGuid(P.feedUrl(show));
  const now = Date.UTC(2026, 10, 13, 9, 30, 0);
  const p1 = withFile(show, "pproject1", 1, Date.UTC(2026, 10, 1, 8, 0, 0));
  const p2 = withFile(show, "pproject2", 2, Date.UTC(2026, 10, 8, 8, 0, 0), { se: 1, explicit: true }, []);
  const draft = proj("pproject3", 7, { sh: show.id, ep: { n: 3, title: "Not ready" } });
  const other = proj("pproject4", 8);
  const dat = Object.assign(C.emptyData(), { projects: [p1, p2, draft, other] });
  const eps = P.episodes(dat, show.id);
  assert.deepEqual(eps.map((e) => e.p.id), ["pproject2", "pproject1", "pproject3"], "newest first, drafts last");
  assert.equal(P.nextEpNo(dat, show.id), 4);
  assert.deepEqual(P.problems(show, eps), []);
  assert.deepEqual(P.problems(P.normShow({ id: "hshow0002", m: 1 }), []), ["title", "author", "desc", "url", "cover", "eps"]);
  const xml = P.feedXml(show, eps, { now, untitled: "Επεισόδιο" });
  assert.ok(!xml.includes("Not ready"), "drafts stay out of the feed");
  assert.ok(xml.includes("&lt;για&gt;") && !xml.includes("<για>"), "text is escaped");
  assert.ok(xml.includes("<lastBuildDate>Fri, 13 Nov 2026 09:30:00 +0000</lastBuildDate>"));
  assert.ok(xml.includes('<podcast:locked owner="me@example.com">yes</podcast:locked>'));
  assert.ok(xml.includes("<podcast:guid>" + show.guid + "</podcast:guid>"));
  const doc = FEEDS.parseXml(xml);
  assert.ok(doc, "the Reader's parser reads it");
  const f = PC.parseFeed(PC.fromFeedsXml(doc), P.feedUrl(show));
  assert.equal(f.show.title, show.title);
  assert.equal(f.show.by, show.author);
  assert.equal(f.show.lang, "el");
  assert.equal(f.show.img, "https://chris.github.io/geitonia/cover.jpg");
  assert.deepEqual(f.show.cats, ["Society & Culture", "Documentary"]);
  assert.equal(f.show.funding[0].url, "https://ko-fi.com/me");
  assert.equal(f.eps.length, 2);
  const [e2, e1] = f.eps;
  assert.equal(e2.title, "Επεισόδιο 2");
  assert.equal(e2.audio, "https://chris.github.io/geitonia/episodes/002-epeisodio-2.mp3");
  assert.equal(e2.size, 1002);
  assert.equal(e2.dur, 602);
  assert.equal(e2.season, 1);
  assert.equal(e2.num, 2);
  assert.equal(e2.pub, Date.UTC(2026, 10, 8, 8, 0, 0));
  assert.equal(e2.explicit, true);
  assert.equal(e2.chapters, "", "no markers, no chapters file");
  assert.equal(e1.chapters, "https://chris.github.io/geitonia/chapters/001-epeisodio-1.json");
  assert.equal(e1.id, PC.episodeId(f.show.id, { guid: p1.ep.guid }));
  // no owner e-mail: not locked, no owner block
  const open = P.feedXml(Object.assign({}, show, { email: "" }), eps, {});
  assert.ok(open.includes("<podcast:locked>no</podcast:locked>") && !open.includes("itunes:owner"));
});

test("P1: the show's page has no script and nothing from outside", () => {
  const show = P.normShow(SHOW);
  const p = withFile(show, "pproject1", 1, Date.UTC(2026, 10, 1), { desc: "<script>alert(1)</script>\nline" });
  const html = P.pageHtml(show, P.episodes({ projects: [p] }, show.id), { episode: "Επεισόδιο", feed: "RSS" });
  assert.ok(!/<script/i.test(html), "no script tag");
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes('<meta http-equiv="Content-Security-Policy" content="' + P.PAGE_CSP + '">'));
  assert.ok(!/(src|href)="(https?:)?\/\/(?!ko-fi\.com)/.test(html), "only the support link leaves the site");
  assert.ok(html.includes('<audio controls preload="none" src="episodes/001-epeisodio-1.mp3">'));
  assert.ok(html.includes('<html lang="el">'));
  assert.ok(html.includes("Επεισόδιο 1 · 2026-11-01 · 10:01"));
});

test("P1: ID3 tags for StudioEncode.id3v24", () => {
  const show = P.normShow(SHOW);
  const e = P.episodes({ projects: [withFile(show, "pproject1", 4, Date.UTC(2026, 10, 1))] }, show.id)[0];
  assert.equal(P.stale(e), false);
  assert.equal(P.stale(Object.assign({}, e, { mk: P.setMarker(e.mk, "kmark0002", { n: "Renamed" }) })), true, "renamed markers make the file's chapters old");
  const tags = P.id3Tags(show, e, { dur: 604, intro: "Intro", cover: { mime: "image/jpeg", bytes: new Uint8Array([1, 2]) } });
  assert.equal(tags.title, "Επεισόδιο 4");
  assert.equal(tags.album, show.title);
  assert.equal(tags.artist, show.author);
  assert.equal(tags.track, "4");
  assert.equal(tags.date, "2026-11-01");
  assert.equal(tags.length, 604000);
  assert.equal(tags.url, "https://chris.github.io/geitonia/#004-epeisodio-4");
  assert.equal(e.ep.n, 4);
  assert.deepEqual(tags.chapters, [{ id: "ch0", start: 0, end: 120500, title: "Αρχή" }, { id: "ch1", start: 120500, end: 604000, title: "Θέμα" }]);
  assert.equal(tags.cover.mime, "image/jpeg");
  const plain = P.id3Tags(show, { p: proj("pproject9", 1, { name: "Song" }), ep: P.normEp({}), mk: [] }, { dur: 10 });
  assert.equal(plain.title, "Song");
  assert.ok(!("chapters" in plain) && !("track" in plain) && !("cover" in plain));
});

test("P1: the site ZIP is a valid stored archive, built from parts", () => {
  const files = [
    { name: "feed.xml", data: P.textBytes("<rss>Καλημέρα</rss>\n") },
    { name: "episodes/001-a.mp3", data: crypto.randomBytes(70000) },
    { name: "cover.jpg", data: new Uint8Array(0) }
  ];
  // the CRC runs over pieces as the app reads a file a chunk at a time
  const crcOf = (b) => { let c; for (let i = 0; i < b.length; i += 4096) c = P.crc32(b.subarray(i, i + 4096), c); return c === undefined ? P.crc32(b) : c; };
  assert.equal(P.crc32(P.textBytes("123456789")), 0xcbf43926);
  const entries = files.map((f) => ({ name: f.name, size: f.data.length, crc: crcOf(f.data) }));
  const parts = P.zipParts(entries, new Date(2026, 10, 13, 10, 0, 0));
  const zip = Buffer.concat(parts.map((x) => typeof x === "number" ? Buffer.from(files[x].data) : Buffer.from(x)));
  // read it back by hand: end record → central directory → each entry
  const eocd = zip.length - 22;
  assert.equal(zip.readUInt32LE(eocd), 0x06054b50);
  assert.equal(zip.readUInt16LE(eocd + 10), 3);
  let at = zip.readUInt32LE(eocd + 16);
  for (const f of files) {
    assert.equal(zip.readUInt32LE(at), 0x02014b50);
    const nlen = zip.readUInt16LE(at + 28), off = zip.readUInt32LE(at + 42), size = zip.readUInt32LE(at + 20);
    assert.equal(zip.toString("utf8", at + 46, at + 46 + nlen), f.name);
    assert.equal(zip.readUInt32LE(off), 0x04034b50);
    const lnl = zip.readUInt16LE(off + 26);
    const body = zip.subarray(off + 30 + lnl, off + 30 + lnl + size);
    assert.ok(Buffer.from(f.data).equals(body));
    assert.equal(zlib.crc32 ? zlib.crc32(body) : P.crc32(body), zip.readUInt32LE(off + 14));
    at += 46 + nlen;
  }
  assert.throws(() => P.zipParts([{ name: "../x", size: 1, crc: 0 }]), /zip/);
  assert.throws(() => P.zipParts([{ name: "a", size: 0xfffffff0, crc: 0 }]), /zip-big/);
});

test("P1: shows and episode fields survive the Studio merge (wave A0)", () => {
  const show = Object.assign(P.normShow(SHOW), { guid: P.feedGuid("https://chris.github.io/geitonia/feed.xml") });
  const p = proj("pproject1", 5, { sh: show.id, ep: P.normEp({ n: 1, title: "A" }), mk: P.normMarkers([{ id: "kmark0001", t: 3, n: "x" }]) });
  const a = Object.assign(C.emptyData(), { projects: [p], shows: [show] });
  const b = Object.assign(C.emptyData(), { shows: [Object.assign({}, show, { m: 9, title: "Newer" })] });
  const ab = C.mergeStudio(a, b), ba = C.mergeStudio(b, a);
  assert.deepEqual(ab, ba, "symmetric");
  assert.deepEqual(C.mergeStudio(ab, ab), ab, "idempotent");
  assert.equal(P.shows(ab)[0].title, "Newer");
  assert.deepEqual(P.normEp(ab.projects[0].ep), p.ep);
  assert.deepEqual(P.normMarkers(ab.projects[0].mk), p.mk);
  const gone = C.mergeStudio(ab, Object.assign(C.emptyData(), { tombs: { hshow0001: 10 } }));
  assert.deepEqual(P.shows(gone), [], "a deleted show stays deleted");
  // the biggest episode fields still fit what an older Studio keeps on a row
  const mk = []; for (let i = 0; i < P.LIM.markers; i++) mk.push({ id: "kmark" + String(100000 + i), t: 3599.999 - i, n: "Ω".repeat(P.LIM.mark) });
  const big = proj("pproject2", 5, { sh: show.id, mk: P.normMarkers(mk),
    ep: P.normEp({ n: 9999, se: 99, type: "trailer", title: "Ω".repeat(120), desc: "Ω".repeat(1500), date: 1e12, explicit: true, guid: show.guid,
      slug: "a".repeat(60), file: "/internal/Studio/Podcasts/hshow0001/" + "a".repeat(76) + ".mp3", bytes: 2147483647, dur: 3599.999, kbps: 128, ch: 2, mh: "0123abcd" }) });
  const kept = C.mergeStudio(Object.assign(C.emptyData(), { projects: [big] }), C.emptyData()).projects[0];
  assert.deepEqual(kept.ep, big.ep, "the episode fields ride along whole");
  assert.deepEqual(kept.mk, big.mk);
});
