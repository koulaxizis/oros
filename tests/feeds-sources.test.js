// Reader wave 36: other sources.
//   - Mail folders as feeds: feeds/core.js mail addresses, the Mail
//     bridge's pure part (mail/feed.js) and feeds/sources.js mailParsed
//   - FreshRSS (Google Reader API) and Miniflux import: parsers, the
//     changes to the synced data, and the client against a fake fetch
//   - the "Summarise" question
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../feeds/core.js");
global.orosFeedsCore = C;
const S = require("../feeds/sources.js");
const M = require("../mail/mime.js");
const MF = require("../mail/feed.js");

const NOW = Date.UTC(2026, 9, 14, 8, 0, 0);
const ACCT = "acct01xyz";

function b64(s) { return Buffer.from(s, "utf8").toString("base64"); }

// ---------- Mail folders as feeds ----------
test("mail address: one spelling, round trip, own id", () => {
  const u = C.mailUrl(ACCT, "INBOX.News/Δελτία &AQ-");
  assert.match(u, /^oros-mail:acct01xyz\//);
  assert.deepEqual(C.parseMailUrl(u), { acct: ACCT, folder: "INBOX.News/Δελτία &AQ-" });
  assert.match(C.feedId(u), /^f[a-z0-9]{11}$/);
  assert.notEqual(C.feedId(u), C.feedId(C.mailUrl(ACCT, "INBOX")));
  assert.equal(C.mailUrl("BAD ID", "x"), "");
  assert.equal(C.mailUrl(ACCT, ""), "");
  assert.equal(C.parseMailUrl("oros-mail:" + ACCT + "/a%2"), null);          // broken escape
  assert.equal(C.parseMailUrl("oros-mail:" + ACCT + "/a b"), null);          // not the one spelling
  assert.equal(C.parseMailUrl("https://example.com/feed"), null);
  assert.equal(C.normUrl(u), "");                                            // never fetched as a web address
  assert.ok(C.isMailFeed({ url: u }));
  assert.ok(!C.isMailFeed({ url: "https://example.com/feed" }));
});

test("a Mail feed syncs like any other feed; OPML leaves it out", () => {
  const u = C.mailUrl(ACCT, "Newsletters");
  const mail = { id: C.feedId(u), url: u, title: "Newsletters", site: "https://evil.example/", folder: "", img: -1, m: 5 };
  const web = { id: C.feedId("https://example.com/feed"), url: "https://example.com/feed", title: "Ex", site: "", folder: "", img: -1, m: 5 };
  const a = C.merge({ feeds: [mail] }, null), b = C.merge({ feeds: [web] }, null);
  const ab = C.merge(a, b), ba = C.merge(b, a);
  assert.deepEqual(ab, ba);
  assert.deepEqual(C.merge(ab, ab), ab);
  assert.equal(ab.feeds.length, 2);
  const m = C.feedById(ab, mail.id);
  assert.equal(m.url, u);
  assert.equal(m.site, "");                                  // no site for a Mail folder
  // a wrong id for the address is dropped
  assert.equal(C.merge({ feeds: [Object.assign({}, mail, { id: web.id })] }, null).feeds.length, 0);
  const opml = C.buildOpml(ab, "x", NOW);
  assert.ok(opml.indexOf("example.com/feed") > 0);
  assert.ok(opml.indexOf("oros-mail") < 0);
  // read marks of its articles survive the merge
  const d = C.merge(ab, null);
  C.markItems(d, [{ id: C.itemId(mail.id, "mid:<a@b>"), feed: mail.id, date: NOW }], 1, NOW);
  const d2 = C.merge(d, a);
  assert.ok(C.isRead(d2, { id: C.itemId(mail.id, "mid:<a@b>"), feed: mail.id, date: NOW }));
});

test("mail/feed.js: folder rows (live accounts, no Sent/Drafts/Trash/Spam, decoded labels)", () => {
  const d = { accounts: [{ id: ACCT, m: 1, name: "Work", email: "me@example.gr" }, { id: "gone01abc", m: 1, email: "x@y.z" }],
              tombs: { gone01abc: 2 } };
  const lists = {
    [ACCT]: [
      { name: "INBOX", delim: ".", flags: [] },
      { name: "INBOX.Sent", delim: ".", flags: [] },
      { name: "Drafts", delim: "/", flags: ["\\Drafts"] },
      { name: "Spam", delim: "/", flags: [] },
      { name: "INBOX.&A5UDvQO3A7wDtQPBA8kDxAO5A7oDrA-", delim: ".", flags: [] },
      { name: "[Gmail]", delim: "/", flags: ["\\Noselect"] }
    ],
    gone01abc: [{ name: "INBOX", flags: [] }]
  };
  const rows = MF._pure.folderRows(d, lists, M);
  assert.deepEqual(rows.map((r) => r.folder), ["INBOX", "INBOX.&A5UDvQO3A7wDtQPBA8kDxAO5A7oDrA-"]);
  assert.equal(rows[0].role, "inbox");
  assert.equal(rows[1].label, "Ενημερωτικά");
  assert.equal(rows[1].acctName, "Work");
});

test("mail/feed.js: messages from the cache, bodies decoded, deleted ones left out", () => {
  const raw = "From: News <news@example.gr>\r\nSubject: Hi\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>Γεια <img src=\"https://t.example/p.gif\"></p>";
  const rec = { acct: ACCT, folder: "News", uidv: 7, at: 1, msgs: [
    { uid: 3, subj: "Third", from: { name: "News", addr: "news@example.gr" }, date: NOW, flags: ["\\Seen"], mid: "<3@x>" },
    { uid: 2, subj: "Second", from: { name: "", addr: "a@b.c" }, date: NOW - 1000, flags: [] },
    { uid: 1, subj: "Gone", date: NOW - 2000, flags: ["\\Deleted"] }
  ] };
  const res = MF._pure.toMessages(rec, { [ACCT + "|News|7|3"]: b64(raw) }, M, 50);
  assert.deepEqual(res.msgs.map((m) => m.uid), [3, 2]);
  assert.equal(res.msgs[0].cached, true);
  assert.match(res.msgs[0].html, /Γεια/);
  assert.equal(res.msgs[0].seen, true);
  assert.equal(res.msgs[1].cached, false);
  assert.equal(res.msgs[1].html, "");
  assert.equal(MF._pure.decodeBody(123, M), null);
});

test("mailParsed: one article per message, plain text made safe, no body yet flagged", () => {
  const res = { acct: ACCT, folder: "News", uidv: 7, msgs: [
    { uid: 3, mid: "<3@x>", subj: "Weekly  #3", from: { name: "News", addr: "n@x" }, date: NOW, cached: true, html: "<p>Hello</p>", text: "" },
    { uid: 2, mid: "", subj: "", from: { name: "", addr: "a@b.c" }, date: NOW - 5, cached: true, html: "", text: "a <b> & https://ex.gr/x.\nline 2" },
    { uid: 1, mid: "<3@x>", subj: "dup", cached: true, html: "x" },
    { uid: 0.5, subj: "bad" },
    { uid: 4, mid: "<4@x>", subj: "Later", from: { addr: "n@x" }, date: NOW, cached: false }
  ] };
  const p = S.mailParsed(res, { noSubject: "(no subject)" });
  assert.equal(p.kind, "mail");
  assert.deepEqual(p.items.map((i) => i.key), ["mid:<3@x>", "uid:7:2", "uid:7:0.5", "mid:<4@x>"]);
  const [a, b, , d] = p.items;
  assert.equal(a.title, "Weekly #3");
  assert.equal(a.link, "");
  assert.equal(a.author, "News");
  assert.deepEqual(a.mt, { acct: ACCT, folder: "News", uid: 3 });
  assert.equal(b.title, "(no subject)");
  assert.equal(b.author, "a@b.c");
  assert.ok(b.html.indexOf("<b>") < 0 && b.html.indexOf("&lt;b&gt;") > 0);
  assert.ok(b.html.indexOf('<a href="https://ex.gr/x">https://ex.gr/x</a>.') > 0);
  assert.ok(b.html.indexOf("<br>line 2") > 0);
  assert.equal(d.nobody, true);
  assert.equal(d.html, "");
  assert.equal(S.mailParsed(null).items.length, 0);
  assert.equal(S.mailFeedTitle({ label: "News", acctName: "Work" }, true), "News · Work");
  assert.equal(S.mailFeedTitle({ label: "News", acctName: "Work" }, false), "News");
});

// ---------- FreshRSS / Miniflux parsers ----------
test("server addresses and the FreshRSS API root", () => {
  assert.equal(S.normServer("rss.example.com/"), "https://rss.example.com");
  assert.equal(S.normServer("https://u:p@x.com"), "");
  assert.equal(S.normServer("javascript:alert(1)"), "");
  assert.deepEqual(S.greaderBases("https://rss.example.com/freshrss"),
    ["https://rss.example.com/freshrss/api/greader.php", "https://rss.example.com/freshrss/p/api/greader.php"]);
  assert.deepEqual(S.greaderBases("https://x.gr/p/api/greader.php/reader/api/0"), ["https://x.gr/p/api/greader.php"]);
  assert.deepEqual(S.greaderBases("https://x.gr/i/"), ["https://x.gr/api/greader.php", "https://x.gr/p/api/greader.php"]);
  assert.equal(S.parseClientLogin("SID=a\nLSID=b\nAuth=user/abc123\n"), "user/abc123");
  assert.equal(S.parseClientLogin("Error=BadAuthentication"), "");
});

const GR_SUBS = { subscriptions: [
  { id: "feed/2", title: "Καθημερινή", categories: [{ id: "user/-/label/Ειδήσεις", label: "Ειδήσεις" }], url: "https://www.kathimerini.gr/feed/", htmlUrl: "https://www.kathimerini.gr/" },
  { id: "feed/https://blog.example.com/rss", title: "Blog", categories: [{ id: "user/-/label/Tech" }] },
  { id: "feed/3", title: "Bad", url: "javascript:x" },
  { id: "feed/4", title: "Dup", url: "https://www.kathimerini.gr/feed/" }
] };
test("greaderSubs: feed address from url or id, folder from the label", () => {
  const s = S.greaderSubs(GR_SUBS);
  assert.deepEqual(s.map((x) => [x.url, x.folder]), [
    ["https://www.kathimerini.gr/feed/", "Ειδήσεις"],
    ["https://blog.example.com/rss", "Tech"]
  ]);
  assert.equal(s[0].site, "https://www.kathimerini.gr/");
});

test("greaderItems: address, date, feed, text", () => {
  const items = S.greaderItems({ items: [
    { id: "tag:google.com,2005:reader/item/1", title: "A &amp; B", published: 1760000000, author: "X",
      canonical: [{ href: "https://www.kathimerini.gr/a?utm_source=x" }], summary: { content: "<p>Body <b>here</b></p>" },
      origin: { streamId: "feed/2", title: "Καθημερινή", htmlUrl: "https://www.kathimerini.gr/" } },
    { id: "2", title: "B", crawlTimeMsec: "1760000000123", alternate: [{ href: "javascript:x" }, { href: "https://blog.example.com/b" }],
      origin: { streamId: "feed/https://blog.example.com/rss" } }
  ] }, { "feed/2": "https://www.kathimerini.gr/feed/" });
  assert.equal(items[0].feedUrl, "https://www.kathimerini.gr/feed/");
  assert.equal(items[0].title, "A & B");
  assert.equal(items[0].date, 1760000000000);
  assert.equal(items[0].sum, "Body here");
  assert.equal(items[1].feedUrl, "https://blog.example.com/rss");
  assert.equal(items[1].link, "https://blog.example.com/b");
  assert.equal(items[1].date, 1760000000123);
});

test("Miniflux feeds and entries; starred-articles files", () => {
  const feeds = S.minifluxFeeds([
    { id: 1, feed_url: "https://a.example/feed", site_url: "https://a.example/", title: "A", category: { title: "All" } },
    { id: 2, feed_url: "https://b.example/rss", title: "B", category: { title: "Tech" } },
    { id: 3, feed_url: "ftp://x" }
  ]);
  assert.deepEqual(feeds.map((f) => [f.id, f.folder]), [["1", ""], ["2", "Tech"]]);
  const items = S.minifluxItems({ total: 2, entries: [
    { id: 9, feed_id: 2, title: "T", url: "https://b.example/t", published_at: "2026-10-01T10:00:00Z", status: "unread", starred: true, content: "<p>x</p>" },
    { id: 10, feed_id: 1, feed: { feed_url: "https://a.example/feed" }, title: "U", url: "https://a.example/u", status: "read" }
  ] }, { "2": "https://b.example/rss" });
  assert.equal(items[0].feedUrl, "https://b.example/rss");
  assert.equal(items[0].unread, true);
  assert.equal(items[0].starred, true);
  assert.equal(items[0].date, Date.UTC(2026, 9, 1, 10));
  assert.equal(items[1].feedUrl, "https://a.example/feed");
  assert.equal(S.parseStarredFile("not json"), null);
  assert.equal(S.parseStarredFile("{\"a\":1}"), null);
  assert.equal(S.parseStarredFile(JSON.stringify({ items: [{ id: "1", title: "x", alternate: [{ href: "https://s.example/1" }],
    origin: { streamId: "feed/7", htmlUrl: "https://s.example/" } }] }))[0].site, "https://s.example/");
  assert.equal(S.parseStarredFile(JSON.stringify([{ id: 1, feed_id: 2, url: "https://b.example/t" }])).length, 1);
});

// ---------- changes to the synced data ----------
test("newFeeds: only feeds not there yet, one per id", () => {
  const d = C.emptyData();
  d.feeds.push({ id: C.feedId("https://a.example/feed"), url: "https://a.example/feed", title: "A", site: "", folder: "", img: -1, m: 1 });
  const add = S.newFeeds(d, [{ url: "https://a.example/feed" }, { url: "http://b.example/rss", title: "B", folder: "T" },
                              { url: "https://b.example/rss" }, { url: "bad url" }]);
  assert.deepEqual(add.map((x) => [x.url, x.folder]), [["http://b.example/rss", "T"]]);
});

test("starredRecords: matches the device's article, keeps tombs and stars behind", () => {
  const fid = C.feedId("https://a.example/feed");
  const d = C.merge({ feeds: [{ id: fid, url: "https://a.example/feed", title: "A", m: 1 }] }, null);
  const headId = C.itemId(fid, "guid-1");
  const heads = [{ id: headId, feed: fid, link: "https://www.a.example/p/1/?utm_source=rss", date: NOW }];
  const lone = C.itemId(fid, "https://a.example/p/2");
  d.tombs["i:" + lone] = NOW + 50;                                     // un-starred later on another device
  const recs = S.starredRecords(d, [
    { feedUrl: "https://a.example/feed", link: "https://a.example/p/1", title: "One", date: NOW - 10 },
    { feedUrl: "https://a.example/feed", link: "https://a.example/p/2", title: "Two" },
    { feedUrl: "", site: "https://gone.example/", link: "https://gone.example/x", title: "Gone feed" },
    { feedUrl: "", link: "https://nowhere.example/x" }
  ], heads, NOW);
  assert.equal(recs.length, 3);
  assert.equal(recs[0].id, headId);                                    // the same article, not a copy
  assert.equal(recs[0].star, 1);
  assert.equal(recs[1].id, lone);
  assert.equal(recs[1].m, NOW + 51);                                   // newer than the tomb: an explicit import
  assert.equal(recs[2].feed, C.feedId("https://gone.example/"));
  recs.forEach((r) => d.items.push(r));
  const m = C.merge(d, null);
  assert.equal(m.items.length, 3);
  assert.deepEqual(C.merge(m, C.merge({ feeds: d.feeds }, null)), C.merge(C.merge({ feeds: d.feeds }, null), m));
  // already starred: nothing to do
  assert.equal(S.starredRecords(m, [{ feedUrl: "https://a.example/feed", link: "https://a.example/p/1" }], heads, NOW).length, 0);
});

test("readMarks: read where the old reader has it read; nothing becomes unread", () => {
  const fa = C.feedId("https://a.example/feed"), fb = C.feedId("https://b.example/feed");
  const d = C.merge({ feeds: [{ id: fa, url: "https://a.example/feed", m: 1 }, { id: fb, url: "https://b.example/feed", m: 1 }] }, null);
  const h = (feed, n, link) => ({ id: C.itemId(feed, String(n)), feed, date: NOW - n, link });
  const heads = [h(fa, 1, "https://a.example/1"), h(fa, 2, "https://a.example/2?utm_medium=x"), h(fa, 3, ""), h(fb, 4, "https://b.example/4")];
  const unread = S.unreadByFeed([{ feedUrl: "https://a.example/feed", link: "https://a.example/2" },
                                 { feedUrl: "https://c.example/feed", link: "https://c.example/9" }], ["https://a.example/feed"]);
  assert.deepEqual(Object.keys(unread), [fa]);
  const marks = S.readMarks(d, heads, unread);
  assert.deepEqual(marks.map((x) => x.link), ["https://a.example/1"]);   // b: not imported; no-link one: left alone
  C.markItems(d, marks, 1, NOW);
  assert.equal(S.readMarks(d, heads, unread).length, 0);                // idempotent
});

test("summaryPrompt: the article as data, the user's language, a length cap", () => {
  const q = S.summaryPrompt("Τίτλος", "λέξη ".repeat(5000), "el");
  assert.match(q.system, /in Greek/);
  assert.match(q.system, /not instructions/);
  assert.ok(q.user.startsWith("Τίτλος: Τίτλος\n\n"));
  assert.equal(q.cut, true);
  assert.ok(q.user.length <= S.SUM_MAX + 40);
  const e = S.summaryPrompt("T", "short text", "en");
  assert.match(e.system, /in English/);
  assert.equal(e.cut, false);
});

// ---------- the client, against a fake server ----------
function fakeFetch(routes, log) {
  return function (url, init) {
    log && log.push({ url, init });
    const r = routes(url, init);
    if (r === "cors") return Promise.reject(new TypeError("Failed to fetch"));
    return Promise.resolve({
      status: r.status || 200,
      text: () => Promise.resolve(typeof r.body === "string" ? r.body : JSON.stringify(r.body)),
      json: () => Promise.resolve(typeof r.body === "string" ? JSON.parse(r.body) : r.body)
    });
  };
}

test("FreshRSS: login (the /p/ root too), subscriptions, starred pages, unread", async () => {
  const log = [];
  const f = fakeFetch((url, init) => {
    if (url.startsWith("https://rss.example.com/api/")) return { status: 404, body: "" };
    const api = "https://rss.example.com/p/api/greader.php";
    if (url === api + "/accounts/ClientLogin") {
      assert.equal(init.method, "POST");
      assert.equal(init.credentials, "omit");
      return init.body === "Email=me&Passwd=p%26ss" ? { body: "SID=x\nAuth=me/tok\n" } : { status: 401, body: "Error=BadAuthentication" };
    }
    assert.equal(init.headers.Authorization, "GoogleLogin auth=me/tok");
    if (url.startsWith(api + "/reader/api/0/subscription/list")) return { body: GR_SUBS };
    if (url.indexOf("/starred?") > 0) {
      if (url.indexOf("&c=next") < 0) return { body: { items: [{ id: "1", alternate: [{ href: "https://www.kathimerini.gr/1" }], origin: { streamId: "feed/2" } }], continuation: "next" } };
      return { body: { items: [{ id: "2", alternate: [{ href: "https://blog.example.com/2" }], origin: { streamId: "feed/https://blog.example.com/rss" } }] } };
    }
    if (url.indexOf("/reading-list?") > 0) {
      assert.ok(url.indexOf("&xt=user/-/state/com.google/read") > 0);
      return { body: { items: [{ id: "3", alternate: [{ href: "https://www.kathimerini.gr/3" }], origin: { streamId: "feed/2" } }] } };
    }
    throw new Error("unexpected " + url);
  }, log);
  const r = await S.fromFreshRss({ server: "rss.example.com", user: "me", pass: "p&ss", starred: true, read: true }, f);
  assert.equal(r.feeds.length, 2);
  assert.deepEqual(r.starred.map((x) => x.feedUrl), ["https://www.kathimerini.gr/feed/", "https://blog.example.com/rss"]);
  assert.deepEqual(r.unread.map((x) => x.link), ["https://www.kathimerini.gr/3"]);
  assert.equal(r.unreadComplete, true);
  assert.ok(log.every((x) => x.init.referrerPolicy === "no-referrer" && x.init.mode === "cors"));
  await assert.rejects(S.fromFreshRss({ server: "rss.example.com", user: "me", pass: "bad" }, f), (e) => e.code === "auth");
});

test("FreshRSS / Miniflux: CORS refusal, bad input, too many unread", async () => {
  const cors = fakeFetch(() => "cors");
  await assert.rejects(S.fromFreshRss({ server: "x.example", user: "a", pass: "b" }, cors), (e) => e.code === "cors");
  await assert.rejects(S.fromMiniflux({ server: "x.example", token: "t" }, cors), (e) => e.code === "cors");
  await assert.rejects(S.fromMiniflux({ server: "", token: "t" }, cors), (e) => e.code === "bad");
  const pages = fakeFetch((url) => {
    if (url.endsWith("/v1/feeds")) return { body: [{ id: 1, feed_url: "https://a.example/feed" }] };
    const off = +/offset=(\d+)/.exec(url)[1];
    return { body: { total: 5000, entries: Array.from({ length: 500 }, (_, i) => ({ id: off + i, feed_id: 1, url: "https://a.example/" + (off + i), status: "unread" })) } };
  });
  const r = await S.fromMiniflux({ server: "https://mf.example/v1/", token: "t", read: true, maxPages: 2 }, pages);
  assert.equal(r.unread.length, 1000);
  assert.equal(r.unreadComplete, false);
  assert.equal(r.unread[0].feedUrl, "https://a.example/feed");
});

test("Miniflux: token header, starred and unread lists", async () => {
  const f = fakeFetch((url, init) => {
    assert.equal(init.headers["X-Auth-Token"], "tok");
    if (url === "https://mf.example/v1/feeds") return { body: [{ id: 1, feed_url: "https://a.example/feed", title: "A", category: { title: "News" } }] };
    if (url.indexOf("starred=true") > 0) return { body: { total: 1, entries: [{ id: 5, feed_id: 1, url: "https://a.example/5", starred: true }] } };
    if (url.indexOf("status=unread") > 0) return { body: { total: 0, entries: [] } };
    return { status: 500, body: "" };
  });
  const r = await S.fromMiniflux({ server: "mf.example", token: " tok ", starred: true, read: true }, f);
  assert.equal(r.feeds[0].folder, "News");
  assert.equal(r.starred[0].feedUrl, "https://a.example/feed");
  assert.deepEqual(r.unread, []);
  assert.equal(r.unreadComplete, true);
  const bad = fakeFetch(() => ({ status: 401, body: "" }));
  await assert.rejects(S.fromMiniflux({ server: "mf.example", token: "x" }, bad), (e) => e.code === "auth");
});
