// Newsletter — Substack and Buttondown exports (newsletter/import2.js):
// detection, the subscriber filters (active / not disabled; regular,
// premium, gifted), past issues (published only, HTML read by the
// archive reader), stable ids, and the plan an import would apply
// (the app's own dedupe / suppression / "never bring back" rules).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const C = require(path.join(__dirname, "..", "newsletter/core.js"));
const I = require(path.join(__dirname, "..", "newsletter/import2.js"));
const Z = require(path.join(__dirname, "..", "atelier/zip.js"));

const enc = (s) => new TextEncoder().encode(s);
const zip = (files) => Z.write(Object.keys(files).map((name) => ({ name, data: enc(files[name]) })));

const SS_LIST = [
  "email,active_subscription,expiry,plan,email_disabled,created_at",
  "ann@example.com,true,,free,false,2024-01-02T10:00:00.000Z",
  "bob@example.com,true,2026-12-01,yearly,false,2024-02-02T10:00:00.000Z",
  "gone@example.com,true,,free,true,2024-03-02T10:00:00.000Z",
  "lapsed@example.com,false,2023-01-01,monthly,false,2022-01-01T10:00:00.000Z",
  "not-an-address,true,,free,false,2024-03-02T10:00:00.000Z"
].join("\n");
const SS_POSTS = [
  "post_id,post_date,is_published,email_sent_at,inbox_sent_at,type,audience,title,subtitle,podcast_url",
  "101.hello-world,2024-05-01T08:00:00.000Z,true,2024-05-01T09:00:00.000Z,,newsletter,everyone,Hello world,The first one,",
  "102.draft-thing,2024-06-01T08:00:00.000Z,false,,,newsletter,everyone,A draft,,",
  "103.no-body,2024-07-01T08:00:00.000Z,true,,,newsletter,only_paid,Missing body,,",
  "104.second,2024-08-01T08:00:00.000Z,true,,,newsletter,only_paid,Second,Sub two,"
].join("\n");
const HTML_101 = '<div class="body"><h2>Hi</h2><p>Text with <a href="https://ex.com/a">a link</a>' +
  '<script>alert(1)</script><img src="https://ex.com/p.png" alt="pic" onerror="x()"></p>' +
  '<p><a href="javascript:alert(1)">bad</a></p></div>';
const HTML_104 = "<p>Second <strong>post</strong></p>";

function list() {
  const d = C.empty();
  d.lists.push(C.normList({ id: "list-main", m: 1, name: "Main", salt: "abcdefgh" }));
  return C.normalize(d);
}

test("Substack ZIP: active readers and published posts, sanitised like the archive import", async () => {
  const res = await I.read("substack.zip", zip({
    "email_list.mypub.csv": SS_LIST, "posts.csv": SS_POSTS,
    "posts/101.hello-world.html": HTML_101, "posts/104.second.html": HTML_104,
    "posts/101.hello-world.opens.csv": "email,timestamp\nann@example.com,1"
  }));
  assert.equal(res.source, "substack");
  assert.deepEqual(res.people.map((p) => p.email), ["ann@example.com", "bob@example.com"]);
  assert.deepEqual(res.people[1].tags, ["yearly"]);
  assert.equal(res.pSkip, 2);                  // disabled + lapsed paid
  assert.equal(res.pBad, 1);
  assert.equal(res.items.length, 2);
  assert.equal(res.iSkip, 1);                  // the draft
  assert.equal(res.iNoBody, 1);                // no HTML file
  const hello = res.items[0];
  assert.equal(hello.subj, "Hello world");
  assert.equal(hello.pre, "The first one");
  assert.equal(hello.date, Date.parse("2024-05-01T09:00:00.000Z"));  // e-mail sent, not post date
  assert.match(hello.md, /## Hi/);
  assert.match(hello.md, /\[a link\]\(https:\/\/ex\.com\/a\)/);
  assert.match(hello.md, /!\[pic\]\(https:\/\/ex\.com\/p\.png\)/);
  assert.doesNotMatch(hello.md, /alert|script|onerror|javascript/);
  assert.equal(res.items[1].md, "Second **post**");
});

test("Substack: free readers count when the export marks only paid plans active", async () => {
  const csv = "email,active_subscription,expiry,plan,email_disabled,created_at\n" +
    "a@example.com,false,,,false,2024\nb@example.com,false,,free,false,2024\nc@example.com,true,2027-01-01,yearly,false,2024\n" +
    "d@example.com,false,2020-01-01,monthly,false,2020\n";
  const res = await I.read("email_list.x.csv", csv);
  assert.deepEqual(res.people.map((p) => p.email), ["a@example.com", "b@example.com", "c@example.com"]);
  assert.equal(res.pSkip, 1);
});

test("Buttondown subscribers CSV: only regular, premium and gifted", async () => {
  const csv = "email,creation_date,notes,metadata,tags,subscriber_type\n" +
    "r@example.com,2024-01-01,hi,{},\"['news', 'friends']\",regular\n" +
    "p@example.com,2024-01-01,,{},vip,premium\n" +
    "g@example.com,2024-01-01,,{},,gifted\n" +
    "u@example.com,2024-01-01,,{},,unactivated\n" +
    "x@example.com,2024-01-01,,{},,unsubscribed\n" +
    "s@example.com,2024-01-01,,{},,spammy\n";
  const res = await I.read("subscribers.csv", enc(csv));
  assert.equal(res.source, "buttondown");
  assert.deepEqual(res.people.map((p) => p.email), ["r@example.com", "p@example.com", "g@example.com"]);
  assert.deepEqual(res.people[0].tags, ["news", "friends"]);
  assert.deepEqual(res.people[1].tags, ["vip", "premium"]);
  assert.equal(res.pSkip, 3);
});

test("Buttondown e-mails: CSV skips drafts; ZIP of Markdown with front matter", async () => {
  const csv = "id,subject,body,publish_date,status,email_type\n" +
    "e1,Issue one,\"# Hello\n\nSome **text**\",2024-02-01T10:00:00Z,sent,public\n" +
    "e2,Draft,draft text,,draft,public\n" +
    "e3,Imported,<p>Old <em>one</em></p>,2020-01-01,imported,public\n";
  const r1 = await I.read("emails.csv", csv);
  assert.equal(r1.items.length, 2);
  assert.equal(r1.iSkip, 1);
  assert.equal(r1.items[1].md, "Old *one*");

  const r2 = await I.read("buttondown.zip", zip({
    "emails/2024-03-01-spring.md": "---\nsubject: \"Spring\"\npublish_date: 2024-03-01T08:00:00Z\nstatus: sent\n---\n\nHello **spring**\n",
    "emails/2024-04-01-wip.md": "---\nsubject: WIP\nstatus: draft\n---\n\nnot yet\n",
    "subscribers.csv": "email,subscriber_type,tags\nz@example.com,regular,\n"
  }));
  assert.equal(r2.source, "buttondown");
  assert.equal(r2.items.length, 1);
  assert.equal(r2.items[0].subj, "Spring");
  assert.equal(r2.items[0].date, Date.parse("2024-03-01T08:00:00Z"));
  assert.equal(r2.iSkip, 1);
  assert.equal(r2.people.length, 1);
});

test("files the app already reads are not claimed (null → the old path)", async () => {
  assert.equal(await I.read("people.csv", "Email Address,First Name\nq@example.com,Q\n"), null);   // Mailchimp
  assert.equal(await I.read("post.md", "---\nsubject: x\n---\nbody"), null);
  assert.equal(await I.read("other.zip", zip({ "a/b.html": "<p>x</p>" })), null);
});

test("plan: stable ids, the app's import rules, second import adds nothing", async () => {
  let d = list();
  // someone who unsubscribed earlier and someone deleted for good
  const off = C.normSub({ id: C.subId("list-main", "bob@example.com"), m: 5, list: "list-main", email: "bob@example.com",
    at: 1, conf: 1, off: 2, offSt: "off" });
  d.subs.push(off);
  d.supp.push(C.suppHash("ann@example.com"));
  const res = await I.read("s.zip", zip({
    "email_list.p.csv": SS_LIST + "\ncara@example.com,true,,free,false,2024", "posts.csv": SS_POSTS,
    "posts/101.hello-world.html": HTML_101, "posts/104.second.html": HTML_104
  }));
  const p = I.plan(d, "list-main", res, { basis: "consent", mode: "archive", now: 1000 });
  assert.deepEqual(p.subs.add.map((s) => s.email), ["cara@example.com"]);
  assert.equal(p.subs.left, 1);
  assert.equal(p.subs.supp, 1);
  assert.equal(p.subs.add[0].conf, 1000);
  assert.equal(p.issues.length, 2);
  assert.equal(p.issues[0].id, "i" + C.hash53("imp|substack|101.hello-world"));
  assert.equal(p.issues[0].st, "sent");
  assert.equal(p.issues[0].imp, 1);
  assert.equal(p.issues[0].pre, "The first one");
  // apply, then the same file again
  p.subs.add.forEach((s) => d.subs.push(s));
  p.issues.forEach((x) => d.issues.push(x));
  d = C.normalize(d);
  const again = I.plan(d, "list-main", res, { basis: "consent", mode: "archive", now: 2000 });
  assert.equal(again.subs.add.length, 0);
  assert.equal(again.issues.length, 0);
  assert.equal(again.have, 2);
  // drafts mode, only issues
  const dr = I.plan(list(), "list-main", res, { mode: "draft", subs: false, now: 3000 });
  assert.equal(dr.subs.add.length, 0);
  assert.equal(dr.issues[0].st, "draft");
  // Undo = newer tombstones: the issues are gone, a re-import brings them back
  const undone = C.normalize(Object.assign({}, d, {
    issues: d.issues.map((x) => ({ id: x.id, m: 5000, del: 1 })),
    subs: d.subs.map((s) => s.email === "cara@example.com" ? { id: s.id, m: 5000, del: 1 } : s)
  }));
  assert.equal(C.live(undone.issues).length, 0);
  const re = I.plan(undone, "list-main", res, { now: 6000 });
  assert.equal(re.issues.length, 2);
  assert.equal(re.subs.add.length, 1);
});

test("Buttondown ids match the archive import's, so nothing is added twice", async () => {
  const A = require(path.join(__dirname, "..", "newsletter/archive.js"));
  const md = "---\nsubject: Spring\npublish_date: 2024-03-01T08:00:00Z\n---\n\nHello\n";
  const old = A.toIssues(A.parseFile("emails/spring.md", md), "list-main", "archive", 1);
  const res = await I.read("b.zip", zip({ "emails/spring.md": md }));
  assert.equal(I.issueId(res.items[0]), old[0].id);
});

test("limits: issue room and oversized files", async () => {
  const d = list();
  for (let i = 0; i < C.LIM.archive - 1; i++) d.issues.push(C.normIssue({ id: "ix" + String(i).padStart(4, "0"), m: 1, list: "list-main", subj: "x" }));
  const res = await I.read("s.zip", zip({ "posts.csv": SS_POSTS, "posts/101.hello-world.html": HTML_101, "posts/104.second.html": HTML_104 }));
  const p = I.plan(d, "list-main", res, { now: 1 });
  assert.equal(p.issues.length, 1);
  assert.equal(p.full, true);
  await assert.rejects(I.read("big.csv", { length: I.MAX_FILE + 1 }), /toobig/);
});
