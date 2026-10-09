// Reader: the pure core (feeds/core.js: XML reader, feed parsers,
// discovery, OPML, synced data model + read state, refresh timing)
// and the relay's "web" operation (relay/web.js through
// relay/core.js) against a fake fetch.
// Run: node --test tests/
//
// The HTML sanitizer (feeds/sanitize.js) needs a DOM and is checked
// in a real browser (see the PR notes), not here.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../feeds/core.js");

const NOW = Date.UTC(2026, 9, 9, 8, 0, 0);
const DAY = 86400000;

// ---------- helpers ----------
test("normUrl: one spelling per feed, http(s) only", () => {
  assert.equal(C.normUrl("Example.COM/feed"), "https://example.com/feed");
  assert.equal(C.normUrl("feed://example.com/rss.xml#top"), "https://example.com/rss.xml");
  assert.equal(C.normUrl("feed:https://example.com/a"), "https://example.com/a");
  assert.equal(C.normUrl("javascript:alert(1)"), "");
  assert.equal(C.normUrl("https://user:pw@example.com/"), "");
  assert.equal(C.normUrl("http://localhost/feed"), "");
  assert.equal(C.normUrl("ftp://example.com/x"), "");
  assert.equal(C.feedId("http://example.com/feed"), C.feedId("https://example.com/feed"));
  assert.match(C.feedId("example.com/feed"), /^f[a-z0-9]{11}$/);
});

test("entities, text and titles", () => {
  assert.equal(C.decodeEntities("A &amp; B &#8211; &#x3b1; &hellip; &bogus;"), "A & B – α … &bogus;");
  assert.equal(C.textOf("<p>Γεια <b>σου</b></p><script>x()</script><p>κόσμε</p>"), "Γεια σου κόσμε");
  assert.equal(C.titleText("Tom &amp; Jerry"), "Tom & Jerry");
  assert.equal(C.titleText("a < b and <span>c</span>"), "a < b and c");
  assert.equal(C.titleText("<b>Bold</b> &lt;3"), "Bold <3");
});

test("dates: RFC 822 with offsets and zones, ISO 8601, junk", () => {
  assert.equal(C.parseDate("Fri, 09 Oct 2026 10:00:00 +0300"), Date.UTC(2026, 9, 9, 7, 0, 0));
  assert.equal(C.parseDate("Fri, 9 Oct 2026 10:00:00 EEST"), Date.UTC(2026, 9, 9, 7, 0, 0));
  assert.equal(C.parseDate("09 Oct 26 07:00 GMT"), Date.UTC(2026, 9, 9, 7, 0, 0));
  assert.equal(C.parseDate("2026-10-09T10:00:00+03:00"), Date.UTC(2026, 9, 9, 7, 0, 0));
  assert.equal(C.parseDate("2026-10-09T07:00:00.250Z"), Date.UTC(2026, 9, 9, 7, 0, 0, 250));
  assert.equal(C.parseDate("2026-10-09 07:00:00"), Date.UTC(2026, 9, 9, 7, 0, 0));
  assert.equal(C.parseDate("2026-10-09"), Date.UTC(2026, 9, 9));
  assert.equal(C.parseDate("yesterday"), 0);
});

test("bytes → text: header charset, XML prolog, BOM, Greek code pages", () => {
  const iso = Buffer.from([0x3c, 0x61, 0x3e, 0xc3, 0xe5, 0xe9, 0xe1, 0x3c, 0x2f, 0x61, 0x3e]);   // <a>Γεια</a>
  assert.equal(C.decodeBytes(new Uint8Array(iso), "text/xml; charset=ISO-8859-7"), "<a>Γεια</a>");
  const prolog = Buffer.concat([Buffer.from('<?xml version="1.0" encoding="windows-1253"?>'), iso]);
  assert.match(C.decodeBytes(new Uint8Array(prolog), "application/xml"), /Γεια/);
  const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("<a>ώρα</a>")]);
  assert.equal(C.decodeBytes(new Uint8Array(bom), ""), "<a>ώρα</a>");
});

// ---------- feeds ----------
const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/xsl" href="/style.xsl"?>
<!DOCTYPE rss [<!ENTITY x "y">]>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/"
     xmlns:media="http://search.yahoo.com/mrss/" xmlns:sy="http://purl.org/rss/1.0/modules/syndication/">
<channel>
  <title>Το ιστολόγιο &amp; φίλοι</title>
  <link>https://blog.example.gr/</link>
  <description><![CDATA[<p>Νέα</p>]]></description>
  <sy:updatePeriod>hourly</sy:updatePeriod><sy:updateFrequency>2</sy:updateFrequency>
  <image><url>/logo.png</url></image>
  <item>
    <title>Πρώτο &lt;άρθρο&gt;</title>
    <link>/2026/10/first</link>
    <guid isPermaLink="false">post-1</guid>
    <pubDate>Fri, 09 Oct 2026 10:00:00 +0300</pubDate>
    <dc:creator>Μαρία</dc:creator>
    <description>Short</description>
    <content:encoded><![CDATA[<p>Κείμενο <img src="/img/a.jpg"> τέλος</p>]]></content:encoded>
  </item>
  <item>
    <title>Podcast</title>
    <guid>https://blog.example.gr/ep2</guid>
    <pubDate>Thu, 08 Oct 2026 10:00:00 GMT</pubDate>
    <enclosure url="https://cdn.example.gr/ep2.mp3" type="audio/mpeg" length="1234"/>
    <media:thumbnail url="https://cdn.example.gr/ep2.jpg"/>
  </item>
  <item><title>Χωρίς ημερομηνία</title><link>https://blog.example.gr/x</link></item>
  <item><title>Duplicate</title><guid>post-1</guid></item>
  <item><title>Future</title><link>https://blog.example.gr/f</link><pubDate>Mon, 09 Oct 2028 10:00:00 GMT</pubDate></item>
</channel></rss>`;

test("RSS 2.0: channel, items, CDATA, relative links, enclosure, media, duplicates, future dates", () => {
  const f = C.parseFeed(RSS, "https://blog.example.gr/feed/", NOW);
  assert.equal(f.kind, "rss");
  assert.equal(f.title, "Το ιστολόγιο & φίλοι");
  assert.equal(f.site, "https://blog.example.gr/");
  assert.equal(f.icon, "https://blog.example.gr/logo.png");
  assert.equal(f.ttl, 30);
  assert.equal(f.items.length, 4);
  const [a, b, c, d] = f.items;
  assert.equal(a.key, "post-1");
  assert.equal(a.title, "Πρώτο <άρθρο>");
  assert.equal(a.link, "https://blog.example.gr/2026/10/first");
  assert.equal(a.date, Date.UTC(2026, 9, 9, 7, 0, 0));
  assert.equal(a.author, "Μαρία");
  assert.match(a.html, /<img src="\/img\/a.jpg">/);
  assert.equal(a.img, "https://blog.example.gr/img/a.jpg");
  assert.equal(a.snip, "Κείμενο τέλος");
  assert.equal(b.link, "https://blog.example.gr/ep2");
  assert.deepEqual(b.enc, { url: "https://cdn.example.gr/ep2.mp3", type: "audio/mpeg", len: 1234 });
  assert.equal(b.img, "https://cdn.example.gr/ep2.jpg");
  assert.equal(c.date, 0);
  assert.equal(d.date, NOW);
});

test("RSS 1.0 (RDF) and broken XML (unclosed tags, stray &)", () => {
  const rdf = `<?xml version="1.0"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
    <channel rdf:about="x"><title>RDF site</title><link>https://rdf.example.com/</link></channel>
    <item rdf:about="https://rdf.example.com/1"><title>One</title><link>https://rdf.example.com/1</link><dc:date>2026-10-01T00:00:00Z</dc:date></item>
    <item rdf:about="https://rdf.example.com/2"><title>Two</title><link>https://rdf.example.com/2</link></item>
  </rdf:RDF>`;
  const f = C.parseFeed(rdf, "https://rdf.example.com/rss");
  assert.equal(f.kind, "rdf");
  assert.equal(f.title, "RDF site");
  assert.deepEqual(f.items.map((i) => i.title), ["One", "Two"]);
  assert.equal(f.items[0].date, Date.UTC(2026, 9, 1));
  const broken = `<rss><channel><title>Fish & Chips</title><item><title>A <b>bold</b> move<link>https://x.example.com/a</link></item>
    <item><title>Second</title><description>no close`;
  const g = C.parseFeed(broken, "https://x.example.com/rss");
  assert.equal(g.title, "Fish & Chips");
  assert.equal(g.items.length, 2);
  assert.equal(g.items[1].title, "Second");
});

test("Atom: xhtml/html/text content, links, xml:base, YouTube media group, author", () => {
  const atom = `<?xml version="1.0" encoding="utf-8"?>
  <feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/" xml:base="https://atom.example.org/blog/">
    <title type="html">Atom &amp;lt;Blog&amp;gt;</title>
    <link rel="self" href="https://atom.example.org/feed.atom"/>
    <link rel="alternate" type="text/html" href="https://atom.example.org/"/>
    <author><name>Νίκος</name></author>
    <entry>
      <id>tag:atom.example.org,2026:1</id>
      <title type="text">First &amp; best</title>
      <link rel="alternate" href="posts/1"/>
      <link rel="enclosure" type="audio/ogg" href="https://atom.example.org/1.ogg" length="99"/>
      <published>2026-10-08T12:00:00+02:00</published>
      <content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>Hello <a href="x">there</a> &amp; you</p></div></content>
    </entry>
    <entry>
      <id>yt:video:abc</id>
      <title>Video</title>
      <link rel="alternate" href="https://www.youtube.com/watch?v=abc"/>
      <updated>2026-10-07T00:00:00Z</updated>
      <media:group><media:title>Video</media:title><media:description>Line 1
Line 2</media:description><media:thumbnail url="https://i.ytimg.com/vi/abc/hq.jpg" width="480"/></media:group>
    </entry>
    <entry><id>3</id><title>Text</title><summary>a &lt; b</summary></entry>
  </feed>`;
  const f = C.parseFeed(atom, "https://atom.example.org/feed.atom");
  assert.equal(f.kind, "atom");
  assert.equal(f.title, "Atom <Blog>");
  assert.equal(f.site, "https://atom.example.org/");
  const [a, b, c] = f.items;
  assert.equal(a.key, "tag:atom.example.org,2026:1");
  assert.equal(a.title, "First & best");
  assert.equal(a.link, "https://atom.example.org/blog/posts/1");
  assert.equal(a.author, "Νίκος");
  assert.equal(a.date, Date.UTC(2026, 9, 8, 10, 0, 0));
  assert.equal(a.html, '<p>Hello <a href="x">there</a> &amp; you</p>');
  assert.equal(a.enc.type, "audio/ogg");
  assert.equal(b.img, "https://i.ytimg.com/vi/abc/hq.jpg");
  assert.equal(b.html, "Line 1<br>Line 2");
  assert.equal(c.html, "a &lt; b");
  assert.equal(c.snip, "a < b");
});

test("JSON Feed 1.1", () => {
  const j = JSON.stringify({
    version: "https://jsonfeed.org/version/1.1", title: "JSON blog", home_page_url: "https://j.example.net/",
    authors: [{ name: "Ελένη" }],
    items: [
      { id: 1, url: "https://j.example.net/1", title: "One", content_html: "<p>Hi</p>", date_published: "2026-10-01T10:00:00Z",
        attachments: [{ url: "https://j.example.net/1.mp3", mime_type: "audio/mpeg", size_in_bytes: 5 }] },
      { id: "2", content_text: "Untitled post\nline", image: "/i.png" },
      null
    ]
  });
  const f = C.parseFeed(j, "https://j.example.net/feed.json");
  assert.equal(f.kind, "json");
  assert.equal(f.items.length, 2);
  assert.equal(f.items[0].key, "1");
  assert.equal(f.items[0].author, "Ελένη");
  assert.equal(f.items[0].enc.url, "https://j.example.net/1.mp3");
  assert.equal(f.items[1].title, "Untitled post line");
  assert.equal(f.items[1].img, "https://j.example.net/i.png");
  assert.equal(C.parseFeed('{"version":"x"}', "https://j.example.net/"), null);
});

test("not a feed: HTML pages and junk", () => {
  assert.equal(C.parseFeed("<!DOCTYPE html><html><head><title>x</title></head><body></body></html>", "https://e.com/"), null);
  assert.equal(C.parseFeed("hello", "https://e.com/"), null);
  assert.equal(C.looksLikeFeed(RSS), true);
  assert.equal(C.looksLikeFeed("<html><body>rss</body></html>"), false);
});

// ---------- discovery ----------
test("discovery: <link rel=alternate>, base href, comment feeds last, feed-like <a>", () => {
  const page = `<html><head><base href="https://news.example.gr/el/">
    <link rel="alternate" type="application/rss+xml" title="Σχόλια" href="comments/feed/">
    <link rel="alternate" type="application/rss+xml" title="Ειδήσεις" href="feed/">
    <link rel="alternate" type="application/atom+xml" href="https://news.example.gr/atom.xml">
    <link rel="alternate" hreflang="en" href="https://news.example.gr/en/">
    <link rel="stylesheet" href="/s.css">
    <!-- <link rel="alternate" type="application/rss+xml" href="/hidden.xml"> -->
    <script>var s = '<link rel="alternate" type="application/rss+xml" href="/js.xml">';</script>
    </head><body><a href="/category/sport/feed">Αθλητικά RSS</a><a href="/about">About</a></body></html>`;
  const c = C.discover(page, "https://news.example.gr/el/index.html");
  assert.deepEqual(c.map((x) => x.url), [
    "https://news.example.gr/el/feed/", "https://news.example.gr/atom.xml",
    "https://news.example.gr/el/comments/feed/", "https://news.example.gr/category/sport/feed"]);
  assert.equal(c[0].title, "Ειδήσεις");
  assert.equal(c[3].title, "Αθλητικά RSS");
});

test("discovery: platform rules and guessed paths", () => {
  const u = (s) => C.platformFeeds(s).map((x) => x.url);
  assert.deepEqual(u("https://www.youtube.com/channel/UCabcdefghijklmnop"), ["https://www.youtube.com/feeds/videos.xml?channel_id=UCabcdefghijklmnop"]);
  assert.deepEqual(u("https://www.youtube.com/playlist?list=PLabcdefghijk"), ["https://www.youtube.com/feeds/videos.xml?playlist_id=PLabcdefghijk"]);
  assert.deepEqual(u("https://old.reddit.com/r/greece/"), ["https://www.reddit.com/r/greece/.rss"]);
  assert.deepEqual(u("https://github.com/koulaxizis/oros").slice(0, 1), ["https://github.com/koulaxizis/oros/releases.atom"]);
  assert.deepEqual(u("https://medium.com/@someone"), ["https://medium.com/feed/@someone"]);
  assert.deepEqual(u("https://mastodon.social/@Gargron"), ["https://mastodon.social/@Gargron.rss"]);
  assert.deepEqual(u("https://x.substack.com/p/post"), ["https://x.substack.com/feed"]);
  assert.deepEqual(u("https://bsky.app/profile/a.bsky.social"), ["https://bsky.app/profile/a.bsky.social/rss"]);
  assert.deepEqual(u("https://example.com/some/page"), []);
  const g = C.guessFeeds("https://site.example.com/blog/post.html");
  assert.equal(g[0], "https://site.example.com/blog/feed");
  assert.ok(g.indexOf("https://site.example.com/rss.xml") >= 0);
});

// ---------- OPML ----------
test("OPML: InoReader-style export in, folders kept, round trip", () => {
  const opml = `<?xml version="1.0" encoding="UTF-8"?><opml version="1.0"><head><title>Subscriptions</title></head><body>
    <outline text="Τεχνολογία" title="Τεχνολογία">
      <outline type="rss" text="Blog A" title="Blog A" xmlUrl="https://a.example.com/feed" htmlUrl="https://a.example.com/"/>
      <outline type="rss" text="Blog B" xmlUrl="https://b.example.com/rss"/>
    </outline>
    <outline type="rss" text="Loose" xmlUrl="https://c.example.com/atom.xml"/>
    <outline type="rss" text="Dup" xmlUrl="https://a.example.com/feed"/>
    <outline type="rss" text="Bad" xmlUrl="javascript:alert(1)"/>
  </body></opml>`;
  const list = C.parseOpml(opml);
  assert.deepEqual(list.map((x) => [x.url, x.title, x.folder]), [
    ["https://a.example.com/feed", "Blog A", "Τεχνολογία"],
    ["https://b.example.com/rss", "Blog B", "Τεχνολογία"],
    ["https://c.example.com/atom.xml", "Loose", ""]]);
  assert.equal(C.parseOpml("<html></html>"), null);
  const d = C.emptyData();
  d.folders.push({ id: "dfolder01", name: "Τεχνολογία & <Code>", ord: 0, m: 1 });
  list.forEach((x) => d.feeds.push({ id: C.feedId(x.url), url: x.url, title: x.title, site: x.site, folder: x.folder ? "dfolder01" : "", img: -1, m: 1 }));
  const back = C.parseOpml(C.buildOpml(d, "orOS", NOW));
  assert.deepEqual(back.map((x) => [x.url, x.folder]), [
    ["https://a.example.com/feed", "Τεχνολογία & <Code>"], ["https://b.example.com/rss", "Τεχνολογία & <Code>"],
    ["https://c.example.com/atom.xml", ""]]);
});

// ---------- data model ----------
function feed(url, m, extra) {
  return Object.assign({ id: C.feedId(url), url: C.normUrl(url), title: url, site: "", folder: "", img: -1, m }, extra || {});
}
const FA = feed("a.example.com/feed", 5), FB = feed("b.example.com/feed", 7);

test("merge: symmetric, canonical, idempotent, LWW per feed, tombstones win ties, newer edit resurrects", () => {
  const x = C.emptyData(), y = C.emptyData();
  x.feeds = [FB, FA];
  y.feeds = [Object.assign({}, FA, { title: "Renamed", m: 9 })];
  x.folders = [{ id: "dabc1234", name: "News", ord: 1, m: 2 }];
  y.set = { refresh: { v: 60, m: 4 }, img: { v: 0, m: 2 }, bogus: { v: 1, m: 9 } };
  x.set = { refresh: { v: 15, m: 3 } };
  const ab = C.merge(x, y), ba = C.merge(y, x);
  assert.equal(JSON.stringify(ab), JSON.stringify(ba));
  assert.equal(JSON.stringify(C.merge(ab, ab)), JSON.stringify(ab));
  assert.deepEqual(ab.feeds.map((f) => f.id), [FA.id, FB.id].sort());
  assert.equal(C.feedById(ab, FA.id).title, "Renamed");
  assert.deepEqual(ab.set, { img: { v: 0, m: 2 }, refresh: { v: 60, m: 4 } });
  const del = C.emptyData();
  del.tombs["f:" + FB.id] = 7;
  assert.equal(C.feedById(C.merge(ab, del), FB.id), null);
  const again = C.emptyData();
  again.feeds = [Object.assign({}, FB, { m: 8 })];
  assert.ok(C.feedById(C.merge(C.merge(ab, del), again), FB.id));
});

test("merge: strict normalizers drop invalid rows and never trust ids", () => {
  const bad = { feeds: [
    { id: "fzzzzzzzzzz", url: "https://a.example.com/feed", title: "x", m: 1 },   // id does not match url
    { id: C.feedId("javascript:x"), url: "javascript:x", m: 1 },
    Object.assign({}, FA, { title: "<img src=x onerror=alert(1)>", m: "2" }),
    Object.assign({}, FB, { folder: "../x", img: 7, site: "javascript:alert(1)" })
  ], items: [{ id: "iabcdefg", feed: FB.id, title: "t", link: "javascript:1", star: 1, m: 1 },
             { id: "ibcdefgh", feed: FB.id, title: "t", star: 0, later: 0, m: 1 }],
     set: { relay: { v: "http://evil.example.com", m: 3 } }, tombs: { "x:1": 3, "f:short": 2 } };
  const out = C.merge(bad, null);
  assert.deepEqual(out.feeds.map((f) => f.id), [FB.id]);
  assert.equal(out.feeds[0].folder, "");
  assert.equal(out.feeds[0].img, -1);
  assert.equal(out.feeds[0].site, "");
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].link, "");
  assert.deepEqual(out.set, {});
  assert.deepEqual(out.tombs, {});
});

test("read state: explicit marks, mark all, cut keeps the map small, symmetric merge, age line", () => {
  const d = C.emptyData();
  d.feeds = [FA, FB];
  const it = (n, date, fid) => ({ id: C.itemId(fid || FA.id, "k" + n), feed: fid || FA.id, date });
  const items = [1, 2, 3, 4].map((n) => it(n, NOW - n * DAY));
  assert.equal(C.isRead(d, items[0]), false);
  assert.equal(C.markItems(d, [items[0], items[2]], 1, NOW), 2);
  assert.equal(C.markItems(d, [items[0]], 1, NOW), 0);              // no change, no stamp
  assert.equal(C.isRead(d, items[0]), true);
  assert.equal(C.isRead(d, items[1]), false);
  // other device marks item 1 unread later; this one marks item 3 later still
  const o = JSON.parse(JSON.stringify(d));
  C.markItems(o, [items[0]], 0, NOW + 10);
  C.markItems(d, [items[2]], 0, NOW + 20);
  const m1 = C.merge(d, o), m2 = C.merge(o, d);
  assert.equal(JSON.stringify(m1), JSON.stringify(m2));
  assert.equal(C.isRead(m1, items[0]), false);
  assert.equal(C.isRead(m1, items[2]), false);
  // mark everything up to NOW read: marks under the cut disappear in the merge
  C.markAllBefore(m1, [FA.id], NOW, NOW + 30);
  const c = C.merge(m1, m1);
  assert.ok(items.every((x) => C.isRead(c, x)));
  assert.deepEqual(Object.keys(c.read.ids), []);
  // a newer explicit unread survives the cut
  C.markItems(c, [items[1]], 0, NOW + 40);
  const c2 = C.merge(c, c);
  assert.equal(C.isRead(c2, items[1]), false);
  assert.equal(C.isRead(c2, items[0]), true);
  // an item newer than the cut stays unread
  assert.equal(C.isRead(c2, it(9, NOW + DAY)), false);
  // the age line: nothing older than KEEP_DAYS is unread, its marks go
  const old = it(7, NOW - 70 * DAY);
  C.markItems(c2, [it(8, NOW - 70 * DAY, FB.id)], 1, NOW + 50);
  C.compact(c2, [], NOW + 60);
  const c3 = C.merge(c2, c2);
  assert.equal(C.isRead(c3, old), true);
  assert.ok(Object.keys(c3.read.ids).every((id) => c3.read.ids[id][2] >= c3.read.old));
  // marks of a removed feed go with it
  const gone = JSON.parse(JSON.stringify(c3));
  C.markItems(gone, [it(1, NOW, FB.id)], 1, NOW + 70);
  gone.feeds = gone.feeds.filter((f) => f.id !== FB.id);
  gone.tombs["f:" + FB.id] = NOW + 80;
  const g = C.merge(gone, gone);
  assert.ok(Object.keys(g.read.ids).every((id) => g.read.ids[id][3] !== FB.id));
});

test("read state: compact folds a long run of read marks into the cut", () => {
  const d = C.emptyData();
  d.feeds = [FA];
  const heads = [];
  for (let i = 0; i < 30; i++) heads.push({ id: C.itemId(FA.id, "n" + i), feed: FA.id, date: NOW - (i + 1) * 3600000 });
  C.markItems(d, heads.slice(5), 1, NOW);           // the 25 oldest read
  assert.equal(Object.keys(d.read.ids).length, 25);
  C.compact(d, heads, NOW + 1);
  const c = C.merge(d, d);
  assert.equal(Object.keys(c.read.ids).length, 0);
  assert.ok(heads.slice(5).every((h) => C.isRead(c, h)));
  assert.ok(heads.slice(0, 5).every((h) => !C.isRead(c, h)));
});

test("settings and refresh timing", () => {
  const d = C.emptyData();
  assert.equal(C.setting(d, "refresh"), 30);
  assert.equal(C.putSetting(d, "refresh", 45, NOW), false);
  assert.equal(C.putSetting(d, "refresh", 60, NOW), true);
  assert.equal(C.putSetting(d, "refresh", 60, NOW + 1), false);
  assert.equal(C.setting(d, "refresh"), 60);
  assert.equal(C.putSetting(d, "relay", "https://oros-mail-relay.x.workers.dev", NOW), true);
  assert.equal(C.normRelayUrl("javascript:alert(1)"), null);
  assert.equal(C.nextDelay(30, {}), 30 * 60000);
  assert.equal(C.nextDelay(30, { ttl: 120 }), 120 * 60000);
  assert.equal(C.nextDelay(15, { fails: 1 }), 30 * 60000);
  assert.equal(C.nextDelay(30, { fails: 3 }), 120 * 60000);
  assert.equal(C.nextDelay(30, { fails: 20 }), 24 * 3600000);
});

// ---------- phase 2: tags, rules, search, duplicates, statistics ----------
test("merge: tags, rules and tagged articles; dead tags fall away; full text per feed", () => {
  const x = C.emptyData(), y = C.emptyData();
  x.feeds = [Object.assign({}, FA, { full: 1, m: 6 })];
  y.feeds = [FA];
  x.tags = [{ id: "tnews0001", name: " Ειδήσεις  ", m: 3 }, { id: "told00001", name: "Old", m: 1 }];
  y.tombs["t:told00001"] = 2;
  x.rules = [{ id: "rquake001", q: "σεισμ", in: "all", scope: "f:" + FA.id, act: "tag", tag: "tnews0001", list: 1, m: 4 },
             { id: "rbadtag01", q: "x", act: "tag", tag: "told00001", m: 4 },
             { id: "rnoquery1", q: "  ", act: "read", m: 4 }];
  y.items = [{ id: "iabc12345", feed: FA.id, title: "T", link: "https://a.example.com/1", date: 5, sum: "s",
               star: 0, later: 0, tags: ["told00001", "tnews0001", "tnews0001", "bad"], m: 9 },
             { id: "ionlyold1", feed: FA.id, title: "U", date: 5, tags: ["told00001"], m: 9 }];
  const ab = C.merge(x, y), ba = C.merge(y, x);
  assert.equal(JSON.stringify(ab), JSON.stringify(ba));
  assert.equal(JSON.stringify(C.merge(ab, ab)), JSON.stringify(ab));
  assert.equal(C.feedById(ab, FA.id).full, 1);
  assert.deepEqual(ab.tags, [{ id: "tnews0001", name: "Ειδήσεις", m: 3 }]);
  assert.deepEqual(ab.items.map((i) => [i.id, i.tags]), [["iabc12345", ["tnews0001"]]]);   // the old-only one is gone
  assert.deepEqual(ab.rules.map((r) => [r.id, r.act, r.in, r.list, r.name]),
    [["rbadtag01", "none", "title", 0, "x"], ["rquake001", "tag", "all", 1, "σεισμ"]]);
  // phase-1 data (no tags, no rules, no full) still merges
  const old = C.merge({ feeds: [FB], items: [], set: {}, read: {}, tombs: {} }, null);
  assert.deepEqual(old.tags, []);
  assert.equal(C.feedById(old, FB.id).full, 0);
});

test("search: folded Greek, phrases, exclusions", () => {
  assert.equal(C.fold("ΕΛΛΆΔΑ, Σεισμός"), "ελλαδα, σεισμοσ");
  const q = C.parseQuery('σεισμ "Νέα Σμύρνη" -ποδόσφαιρο');
  assert.deepEqual(q, { all: ["σεισμ", "νεα σμυρνη"], not: ["ποδοσφαιρο"] });
  assert.equal(C.matchQuery(q, C.fold("Σεισμός 4,1 Ρίχτερ στη Νέα Σμύρνη")), true);
  assert.equal(C.matchQuery(q, C.fold("Σεισμός στη Νέα Σμύρνη, αναβολή στο ποδόσφαιρο")), false);
  assert.equal(C.matchQuery(q, C.fold("Σεισμός στη Σμύρνη")), false);
  assert.equal(C.matchQuery(C.parseQuery("-ποδόσφαιρο"), "οτιδηποτε"), false);   // exclusions alone match nothing
  assert.equal(C.emptyQuery(C.parseQuery('  "" - ')), true);
});

test("rules: scope, title vs text, actions, stamps that agree across devices", () => {
  const d = C.emptyData();
  d.feeds = [Object.assign({}, FA, { folder: "dnews0001" }), FB];
  d.folders = [{ id: "dnews0001", name: "News", ord: 0, m: 1 }];
  d.tags = [{ id: "tnews0001", name: "News", m: 1 }];
  d.rules = [
    { id: "rmute0001", q: "ποδόσφαιρο", in: "title", act: "read", m: 1 },
    { id: "rquake001", q: "σεισμ", in: "all", scope: "d:dnews0001", act: "tag", tag: "tnews0001", m: 1 },
    { id: "rstar0001", q: "orOS", act: "star", scope: "f:" + FB.id, m: 1 },
    { id: "rwatch001", q: "orOS", act: "none", list: 1, m: 1 }
  ];
  Object.assign(d, C.merge(d, null));
  const h1 = { id: "ih1aaaaaa", feed: FA.id, title: "Αποτελέσματα", snip: "", date: NOW - 1000 };
  assert.deepEqual(C.ruleActions(d, h1, "ισχυρός σεισμός"), { read: false, star: false, later: false, tags: ["tnews0001"] });
  assert.deepEqual(C.ruleActions(d, Object.assign({}, h1, { feed: FB.id }), "ισχυρός σεισμός").tags, []);   // other folder
  assert.equal(C.ruleActions(d, { feed: FB.id, title: "Ποδόσφαιρο: ο τελικός" }, "").read, true);
  assert.equal(C.ruleActions(d, { feed: FB.id, title: "νέα έκδοση orOS" }, "").star, true);
  assert.equal(C.ruleActions(d, { feed: FA.id, title: "νέα έκδοση orOS" }, "").star, false);
  assert.equal(C.ruleMatches(d, d.rules[3], { feed: FA.id, title: "Νέα έκδοση ΟΡΟΣ orOS" }, ""), true);
  // older than the rule (by more than a day): untouched, on every device
  const late = C.merge(d, null);
  late.rules.forEach((r) => { r.m = NOW; });
  assert.equal(C.ruleActions(late, { feed: FB.id, title: "Ποδόσφαιρο", date: NOW - 2 * DAY }, "").read, false);
  assert.equal(C.ruleActions(late, { feed: FB.id, title: "Ποδόσφαιρο", date: NOW - 3600000 }, "").read, true);
  // two devices apply the same rules: identical records, so the merge has nothing to choose
  const a = C.merge(d, null), b = C.merge(d, null);
  const h2 = { id: "ih2bbbbbb", feed: FB.id, title: "Ποδόσφαιρο", link: "https://b.example.com/2", date: NOW - 5000, author: "" };
  assert.equal(C.applyRuleRead(a, h2), true);
  assert.equal(C.applyRuleRead(a, h2), false);
  C.applyRuleRead(b, h2);
  assert.equal(C.applyRuleSave(a, h1, { star: false, later: false, tags: ["tnews0001", "tgone0001"] }, "σεισμός"), true);
  C.applyRuleSave(b, h1, { star: false, later: false, tags: ["tnews0001"] }, "σεισμός");
  assert.equal(JSON.stringify(C.merge(a, null)), JSON.stringify(C.merge(b, null)));
  assert.equal(C.isRead(a, h2), true);
  assert.deepEqual(C.savedById(a, h1.id).tags, ["tnews0001"]);
  // the user marks it unread later: the user wins
  C.markItems(a, [h2], 0, NOW);
  assert.equal(C.isRead(C.merge(a, b), h2), false);
  // the user removed a rule-saved article: the rule does not bring it back
  const c = C.merge(a, null);
  c.items = [];
  c.tombs["i:" + h1.id] = NOW;
  assert.equal(C.applyRuleSave(c, h1, { star: true, later: false, tags: [] }, ""), false);
  assert.equal(C.savedById(C.merge(c, a), h1.id), null);
});

test("duplicates: one key per article address", () => {
  const k = C.dupKey("https://www.example.gr/news/1/?utm_source=rss&utm_medium=feed&id=7#top");
  assert.equal(k, "example.gr/news/1?id=7");
  assert.equal(C.dupKey("http://example.gr/news/1?id=7&fbclid=abc"), k);
  assert.notEqual(C.dupKey("https://example.gr/news/2"), k);
  assert.equal(C.dupKey("javascript:alert(1)"), "");
  assert.equal(C.dupKey(""), "");
});

test("statistics: articles a week, latest, quiet and broken feeds", () => {
  const hs = [];
  for (let i = 0; i < 10; i++) hs.push({ feed: FA.id, date: NOW - i * 2 * DAY });
  hs.push({ feed: FB.id, date: NOW - 200 * DAY });
  const sa = C.feedStats(hs, FA.id, NOW), sb = C.feedStats(hs, FB.id, NOW);
  assert.deepEqual(sa, { n: 10, week: 2.5, last: NOW });
  assert.equal(C.feedHealth(sa, {}, NOW), "");
  assert.equal(C.feedHealth(sb, {}, NOW), "quiet");
  assert.equal(C.feedHealth(sa, { fails: 3, since: NOW - 8 * DAY }, NOW), "broken");
  assert.equal(C.feedHealth(sa, { fails: 3, since: NOW - 2 * DAY }, NOW), "");
  assert.equal(C.feedHealth(C.feedStats([], FA.id, NOW), {}, NOW), "");
  assert.equal(C.setting(C.emptyData(), "view"), "list");
  assert.equal(C.setting(C.emptyData(), "dedup"), 1);
});

// ---------- relay: web ----------
function fakeFetch(routes, log) {
  return async (url, opts) => {
    log.push({ url, headers: opts.headers, redirect: opts.redirect });
    const r = routes[url];
    if (!r) throw new TypeError("network");
    if (r.redirect) return new Response(null, { status: 302, headers: { Location: r.redirect } });
    return new Response(r.body === undefined ? null : r.body, { status: r.status || 200, headers: r.headers || {} });
  };
}

test("relay web: fetches public pages, follows checked redirects, 304, limits", async () => {
  const core = await import("../relay/core.js");
  const log = [];
  const routes = {
    "https://blog.example.gr/feed": { body: RSS, headers: { "Content-Type": "application/rss+xml", ETag: "\"v1\"" } },
    "https://old.example.gr/rss": { redirect: "/new/rss" },
    "https://old.example.gr/new/rss": { body: "<rss/>", headers: { "Content-Type": "text/xml" } },
    "https://evil.example.gr/r": { redirect: "http://169.254.169.254/latest" },
    "https://same.example.gr/feed": { status: 304 },
    "https://img.example.gr/a.png": { body: "PNG", headers: { "Content-Type": "image/png" } },
    "https://loop.example.gr/a": { redirect: "https://loop.example.gr/a" }
  };
  const post = (body, origin) => core.handle(new Request("https://relay.test/v1", { method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin || "https://useoros.online" }, body: JSON.stringify(body) }),
    {}, null, NOW, fakeFetch(routes, log));
  const r = await (await post({ op: "web", reqs: [
    { url: "https://blog.example.gr/feed" },
    { url: "https://old.example.gr/rss" },
    { url: "https://evil.example.gr/r" },
    { url: "https://same.example.gr/feed", etag: "\"v1\"", lm: "Fri, 09 Oct 2026 07:00:00 GMT" },
    { url: "https://img.example.gr/a.png" },
    { url: "http://localhost:8080/" },
    { url: "https://10.0.0.1/" },
    { url: "https://loop.example.gr/a" },
    { url: "https://down.example.gr/" },
    { url: "https://ports.example.gr:22/" }
  ] })).json();
  assert.equal(r.ok, true);
  const res = r.data.res;
  assert.equal(res[0].status, 200);
  assert.equal(res[0].etag, "\"v1\"");
  assert.equal(Buffer.from(res[0].body, "base64").toString("utf8"), RSS);
  assert.equal(res[1].url, "https://old.example.gr/new/rss");
  assert.equal(res[2].err, "host");
  assert.equal(res[3].status, 304);
  assert.equal(res[3].body, undefined);
  assert.equal(res[4].err, "type");
  assert.equal(res[5].err, "host");
  assert.equal(res[6].err, "host");
  assert.equal(res[7].err, "redirect");
  assert.equal(res[8].err, "network");
  assert.equal(res[9].err, "port");
  const cond = log.find((l) => l.url === "https://same.example.gr/feed");
  assert.equal(cond.headers["If-None-Match"], "\"v1\"");
  assert.equal(cond.headers["If-Modified-Since"], "Fri, 09 Oct 2026 07:00:00 GMT");
  assert.ok(log.every((l) => l.redirect === "manual"));
  assert.ok(log.every((l) => !l.url.includes("169.254")));
  // validation and origin
  assert.equal((await (await post({ op: "web", reqs: [] })).json()).error.code, "bad-request");
  assert.equal((await (await post({ op: "web", reqs: new Array(11).fill({ url: "https://a.example.com/" }) })).json()).error.code, "bad-request");
  assert.equal((await (await post({ op: "web", reqs: [{ url: "https://a.example.com/", etag: "x\r\nCookie: a" }] })).json()).error.code, "bad-request");
  assert.equal((await (await post({ op: "web", reqs: [{ url: "https://blog.example.gr/feed" }] }, "https://evil.example.com")).json()).error.code, "origin");
  // An unexpected throw still answers with JSON and CORS, not a bare 500
  const boom = await core.handle(new Request("https://relay.test/v1", { method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://useoros.online" },
    body: JSON.stringify({ op: "web", reqs: [{ url: "https://blog.example.gr/feed" }] }) }),
    {}, null, NOW, async () => ({ status: 200, headers: { get() { throw new Error("bad headers"); } } }));
  assert.equal(boom.status, 200);
  assert.equal(boom.headers.get("Access-Control-Allow-Origin"), "https://useoros.online");
  const bj = await boom.json();
  assert.equal(bj.ok, false);
  assert.equal(bj.error.code, "proto");
});

test("relay web: per-response and per-call size limits", async () => {
  const { runWeb, WEB_LIMITS } = await import("../relay/web.js");
  const big = new Uint8Array(WEB_LIMITS.bytes + 10);
  const mid = new Uint8Array(4 * 1024 * 1024);
  const log = [];
  const routes = {
    "https://big.example.com/": { body: big },
    "https://m1.example.com/": { body: mid }, "https://m2.example.com/": { body: mid },
    "https://m3.example.com/": { body: mid }, "https://m4.example.com/": { body: mid }
  };
  const r = await runWeb({ reqs: [{ url: "https://big.example.com/" }] }, fakeFetch(routes, log));
  assert.equal(r.res[0].err, "too-big");
  const s = await runWeb({ reqs: ["m1", "m2", "m3", "m4"].map((h) => ({ url: "https://" + h + ".example.com/" })) }, fakeFetch(routes, log));
  assert.equal(s.res.filter((x) => x.status === 200).length, 3);
  assert.equal(s.res.filter((x) => x.err === "budget").length, 1);
});
