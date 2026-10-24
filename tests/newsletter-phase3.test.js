// Newsletter phase 3A: RSS to e-mail (feed records, their schedule,
// the digest issue, the engine's feed runs) and past issues imported
// from other services (newsletter/archive.js).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const C = require("../newsletter/core.js");
const A = require("../newsletter/archive.js");
const R = require("../newsletter/render.js");
const { sandbox } = require("./newsletter-sandbox.js");

const ROOT = path.join(__dirname, "..");
const LIST = { id: "list-1", m: 1, name: "Friends", chan: "chan-1", from: "me@example.com", reply: "", lang: "en",
  addr: "1 Main St, Athens", why: "You signed up on my site.", theme: "classic", color: "#2f6fde", salt: "abcdefgh12",
  clnIdle: 0 }; // subscribers here signed up in 1970: no "Stay?" e-mails (see newsletter-clean.test.js)
const CHAN = { id: "chan-1", m: 1, name: "My mail", kind: "mail", acct: "acct01", rate: 1, cap: 300 };
function sub(email, extra) {
  return Object.assign({ id: C.subId("list-1", email), m: 5, list: "list-1", email, name: "", tags: [], src: "manual",
    basis: "consent", at: 10, conf: 10, off: 0 }, extra || {});
}
function feed(extra) {
  return Object.assign({ id: "rss-1", m: 1, list: "list-1", url: "https://blog.example.com/feed.xml", name: "Blog",
    every: "week", wd: 1, hour: 9, mode: "draft", max: 10, seg: "", last: 0, ran: 0, dev: "devaaa1", on: 1 }, extra || {});
}
function model(o) {
  return C.normalize(Object.assign({ chans: [CHAN], lists: [LIST], subs: [], issues: [] }, o || {}));
}
const DAY = 86400000;
function items(n, from) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ key: "k" + i, title: "Post " + i, link: "https://blog.example.com/p/" + i, date: (from || 1e12) + i * DAY,
               snip: "About post " + i + ".", img: i === 0 ? "https://blog.example.com/a.jpg" : "", html: "" });
  }
  return out;
}

// ---------------------------------------------------------------
// Core: feed records and the schedule
// ---------------------------------------------------------------

test("rss: records are normalised, need an http(s) address and a live list", () => {
  const r = C.normRss(feed({ url: "javascript:alert(1)" }));
  assert.equal(r, null);
  const ok = C.normRss(feed({ every: "hourly", wd: 9, hour: 30, max: 99, mode: "boom", on: 0, dev: "BAD DEV" }));
  assert.equal(ok.every, "week");
  assert.equal(ok.wd, 1);
  assert.equal(ok.hour, 9);
  assert.equal(ok.max, 10);
  assert.equal(ok.mode, "draft");
  assert.equal(ok.on, 0);
  assert.equal(ok.dev, "");
  const d = model({ rss: [feed(), feed({ id: "rss-2", list: "gone-list" })] });
  assert.deepEqual(d.rss.map((x) => x.id), ["rss-1"]);
  assert.deepEqual(C.normalize({}).rss, []);
});

test("rss: merges per record; a delete wins a tie", () => {
  const base = model({ rss: [feed({ m: 5 })] });
  const a = JSON.parse(JSON.stringify(base)), b = JSON.parse(JSON.stringify(base));
  a.rss[0] = Object.assign({}, a.rss[0], { m: 6, name: "Renamed" });
  b.rss.push(C.normRss(feed({ id: "rss-2", m: 6 })));
  const ab = C.mergeNewsletter(a, b), ba = C.mergeNewsletter(b, a);
  assert.equal(JSON.stringify(ab), JSON.stringify(ba));
  assert.equal(C.live(ab.rss).find((x) => x.id === "rss-1").name, "Renamed");
  assert.equal(C.live(ab.rss).length, 2);
  const c = JSON.parse(JSON.stringify(ab));
  c.rss[0] = { id: c.rss[0].id, m: c.rss[0].m, del: 1 };
  assert.equal(C.live(C.mergeNewsletter(ab, c).rss).length, 1);
});

test("rss: next run every day, week (weekday) and month (the 1st), local time", () => {
  const at = new Date(2026, 9, 12, 10, 30).getTime();          // Monday 12 Oct 2026, 10:30
  const day = new Date(C.rssNext({ every: "day", hour: 9 }, at));
  assert.deepEqual([day.getDate(), day.getHours()], [13, 9]);
  const later = new Date(C.rssNext({ every: "day", hour: 18 }, at));
  assert.deepEqual([later.getDate(), later.getHours()], [12, 18]);
  const wk = new Date(C.rssNext({ every: "week", wd: 5, hour: 8 }, at));
  assert.deepEqual([wk.getDay(), wk.getDate(), wk.getHours()], [5, 16, 8]);
  const mon = new Date(C.rssNext({ every: "week", wd: 1, hour: 9 }, at));   // today's slot passed: next Monday
  assert.equal(mon.getDate(), 19);
  const mo = new Date(C.rssNext({ every: "month", hour: 7 }, at));
  assert.deepEqual([mo.getMonth(), mo.getDate(), mo.getHours()], [10, 1, 7]);
});

test("rss: due only when on, on its own device, and its slot came", () => {
  const ran = new Date(2026, 9, 12, 10, 0).getTime();
  const d = model({ rss: [feed({ every: "day", hour: 9, ran }), feed({ id: "rss-2", every: "day", hour: 9, ran, dev: "devzzz9" }),
                          feed({ id: "rss-3", every: "day", hour: 9, ran, on: 0 })] });
  assert.deepEqual(C.rssDue(d, ran + 3600000, "devaaa1"), []);
  const next = new Date(2026, 9, 13, 9, 0).getTime();
  assert.deepEqual(C.rssDue(d, next, "devaaa1").map((r) => r.id), ["rss-1"]);
  assert.deepEqual(C.rssDue(d, next, "devzzz9").map((r) => r.id), ["rss-2"]);
});

test("rss: picks new articles with a safe link, newest first, at most max", () => {
  const xs = items(5).concat([{ title: "Bad", link: "javascript:alert(1)", date: 2e12 }, { title: "", link: "https://x.gr/", date: 2e12 }]);
  const all = C.rssPick({ last: 0, max: 3 }, xs);
  assert.deepEqual(all.map((x) => x.title), ["Post 4", "Post 3", "Post 2"]);
  const newer = C.rssPick({ last: 1e12 + 2 * DAY, max: 10 }, xs);
  assert.deepEqual(newer.map((x) => x.title), ["Post 4", "Post 3"]);
});

test("rss: the digest is safe Markdown with a heading, picture and button per article", () => {
  const xs = [
    { title: "# Not a heading <b>x</b>", link: "https://b.gr/a?x=(1)", date: 2, snip: "## [[Click](javascript:alert(1))] text",
      img: "https://b.gr/i.jpg" },
    { title: "Second", link: "https://b.gr/b", date: 1, snip: "Plain.", img: "http://b.gr/insecure.jpg" }
  ];
  const md = C.digestMd(xs, "el");
  assert.match(md, /^## # Not a heading/);
  assert.match(md, /!\[\]\(https:\/\/b\.gr\/i\.jpg\)/);
  assert.doesNotMatch(md, /insecure/);                            // http pictures are left out
  assert.match(md, /\[\[Διαβάστε περισσότερα\]\(https:\/\/b\.gr\/a\?x=\(1%29\)\]/);
  // rendered: no script link, no raw HTML, and the button is the article's
  const blocks = R.mdToBlocks(md);
  assert.ok(blocks.every((b) => !(b.href || b.url) || /^https:/.test(b.href || b.url)));
  assert.equal(blocks.filter((b) => b.k === "btn").length, 2);
  const x = C.digestIssue(feed({ name: "Blog" }), LIST, xs, "iss-rss1");
  assert.equal(x.subj, "Blog: # Not a heading <b>x</b>");
  assert.equal(x.pre, "Second");
  assert.equal(x.fmt, "md");
  assert.equal(x.st, "draft");
});

// ---------------------------------------------------------------
// Engine: feed runs
// ---------------------------------------------------------------

test("engine: a due feed becomes a draft once, then only new articles count", async () => {
  const d = model({ subs: [sub("a@x.gr")], rss: [feed({ every: "day", hour: 0, ran: Date.now() - 2 * DAY })] });
  const S = await sandbox(d);
  let calls = 0;
  const res = await S.E.runFeeds(async (url) => { calls++; assert.equal(url, "https://blog.example.com/feed.xml"); return items(3); });
  assert.equal(calls, 1);
  assert.equal(res.length, 1);
  assert.equal(res[0].sending, false);
  let out = S.read();
  const x = out.issues.find((y) => y.id === res[0].issue.id);
  assert.equal(x.st, "draft");
  assert.match(x.subj, /^Blog: Post 2$/);
  const r = out.rss.find((y) => y.id === "rss-1");
  assert.equal(r.last, 1e12 + 2 * DAY);
  assert.ok(r.ran > Date.now() - 60000);
  // not due again until its next slot
  assert.equal((await S.E.runFeeds(async () => items(3))).length, 0);
  // "Make one now" with nothing new still uses the newest articles
  const again = S.E.issueFromFeed("rss-1", items(3), false);
  assert.equal(again, null);
  const now = S.E.issueFromFeed("rss-1", items(3), true);
  assert.equal(now.issue.st, "draft");
  out = S.read();
  assert.equal(C.live(out.issues).length, 2);
});

test("engine: mode send starts sending when the check passes, else leaves a draft", async () => {
  const d = model({ subs: [sub("a@x.gr")],
                    rss: [feed({ mode: "send", every: "day", hour: 0, ran: Date.now() - 2 * DAY }),
                          feed({ id: "rss-2", mode: "send", every: "day", hour: 0, ran: Date.now() - 2 * DAY, seg: "seg-gone" })] });
  const S = await sandbox(d);
  const res = await S.E.runFeeds(async () => items(2));
  const byFeed = Object.fromEntries(res.map((o) => [o.rss.id, o]));
  assert.equal(byFeed["rss-1"].sending, true);
  assert.equal(byFeed["rss-2"].sending, false);                   // a deleted segment: never everyone
  const out = S.read();
  const sending = out.issues.find((y) => y.id === byFeed["rss-1"].issue.id);
  assert.equal(sending.st, "sending");
  assert.equal(sending.lock.dev, "devaaa1");
  assert.equal(out.issues.find((y) => y.id === byFeed["rss-2"].issue.id).st, "draft");
  await S.run(20);
  assert.deepEqual(S.sent.map((m) => m.to), ["a@x.gr"]);
});

test("engine: another device's feed and a failing fetch make nothing", async () => {
  const ran0 = Date.now() - 2 * DAY;
  const d = model({ rss: [feed({ dev: "devzzz9", every: "day", hour: 0, ran: ran0 }),
                          feed({ id: "rss-2", every: "day", hour: 0, ran: ran0 })] });
  const S = await sandbox(d);
  const seen = [];
  const res = await S.E.runFeeds(async (url) => { seen.push(url); throw { code: "nofeed" }; });
  assert.equal(seen.length, 1);
  assert.equal(res.length, 0);
  const out = S.read();
  assert.equal(C.live(out.issues).length, 0);
  assert.ok(out.rss.find((y) => y.id === "rss-2").ran > Date.now() - 60000, "marked as run: no retry storm");
  assert.equal(out.rss.find((y) => y.id === "rss-1").ran, ran0, "another device's feed is left alone");
});

test("engine: offline, a feed keeps its slot and runs on the next round", async () => {
  const ran0 = Date.now() - 2 * DAY;
  const S = await sandbox(model({ rss: [feed({ every: "day", hour: 0, ran: ran0 })] }));
  assert.equal((await S.E.runFeeds(async () => { throw { code: "offline" }; })).length, 0);
  assert.equal(S.read().rss[0].ran, ran0);
  const res = await S.E.runFeeds(async () => items(1));
  assert.equal(res.length, 1);
});

// ---------------------------------------------------------------
// Past issues (archive.js)
// ---------------------------------------------------------------

test("archive: HTML campaigns become Markdown; scripts, bad links and pixels are dropped", () => {
  const html = `<!doctype html><html><head><title>Spring news</title><style>p{color:red}</style>
    <script>alert(1)</script></head><body><h1>Spring news</h1><p>Hello <b>all</b> &amp; <i>friends</i>.</p>
    <p><a href="javascript:alert(1)">bad</a> <a href="https://site.gr/x">good</a></p>
    <img src="https://site.gr/pic.jpg" alt="Pic"><img src="https://track.example/o.gif" width="1" height="1">
    <img src="data:image/png;base64,AAAA"><ul><li>One</li><li>Two</li></ul><hr><!-- note --></body></html>`;
  const [it] = A.parseFile("spring.html", html);
  assert.equal(it.subj, "Spring news");
  assert.match(it.md, /Hello \*\*all\*\* & \*friends\*\./);
  assert.match(it.md, /\[good\]\(https:\/\/site\.gr\/x\)/);
  assert.match(it.md, /!\[Pic\]\(https:\/\/site\.gr\/pic\.jpg\)/);
  assert.match(it.md, /- One/);
  assert.doesNotMatch(it.md, /javascript|alert|track\.example|data:|color:red|note/);
  assert.match(it.md, /bad/);                                     // the text stays, the link goes
});

test("archive: Markdown with front matter, CSV and JSON exports", () => {
  const md = "---\ntitle: \"Issue #3\"\npublish_date: 2025-03-01T10:00:00Z\n---\n\nHi there\nsecond line\n\n<p>And <b>html</b></p>\n";
  const [a] = A.parseFile("issue-3.md", md);
  assert.equal(a.subj, "Issue #3");
  assert.equal(a.date, Date.parse("2025-03-01T10:00:00Z"));
  assert.match(a.md, /Hi there\nsecond line/);
  assert.match(a.md, /And \*\*html\*\*/);
  const csv = "Subject,Publish Date,Body\n\"One, two\",2025-01-02,<p>First</p>\nNo body,2025-01-03,\n";
  const rows = A.parseFile("emails.csv", csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].subj, "One, two");
  assert.match(rows[0].md, /First/);
  const js = JSON.stringify([{ subject: "J", body: "Text", date: "2024-05-05" }, "junk", { subject: "x" }]);
  const j = A.parseFile("emails.json", js);
  assert.equal(j.length, 1);
  assert.equal(j[0].subj, "J");
  assert.equal(A.supported("export/__MACOSX/._a.md"), false);
  assert.equal(A.supported("export/a.md"), true);
  assert.equal(A.supported("run.exe"), false);
});

test("archive: issues are past (imported, sent elsewhere) or drafts; the same file twice adds nothing", () => {
  const its = A.parseFile("a.md", "---\nsubject: Old\ndate: 2024-01-01\n---\nBody");
  const twice = its.concat(its);
  const xs = A.toIssues(twice, "list-1", "archive", 5);
  assert.equal(xs.length, 1);
  assert.equal(xs[0].st, "sent");
  assert.equal(xs[0].imp, 1);
  assert.equal(xs[0].n, 0);
  assert.equal(xs[0].done, Date.parse("2024-01-01"));
  const dr = A.toIssues(its, "list-1", "draft", 5);
  assert.equal(dr[0].st, "draft");
  assert.equal(dr[0].imp, 0);
  assert.equal(dr[0].id, xs[0].id);                                // same id: never both
  // imp only means something on a sent issue
  assert.equal(C.normIssue(Object.assign({}, xs[0], { st: "draft" })).imp, 0);
  const d = model({ issues: xs });
  assert.equal(d.issues[0].imp, 1);
});

test("app: loads the feed reader, zip reader and archive.js; no eval", () => {
  const html = fs.readFileSync(path.join(ROOT, "newsletter/index.html"), "utf8");
  for (const f of ["../feeds/core.js", "../feeds/fetch.js", "../atelier/zip.js", "archive.js"]) {
    assert.ok(html.includes(`src="${f}?v=`), f);
  }
  assert.ok(html.indexOf("archive.js") < html.indexOf("newsletter.js"));
  const src = fs.readFileSync(path.join(ROOT, "newsletter/archive.js"), "utf8");
  assert.doesNotMatch(src, /\beval\(|new Function|innerHTML/);
});
