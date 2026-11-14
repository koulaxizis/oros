// Studio wave P2 (Publish as podcast): the site into the person's own
// GitHub repository (studio/ghpages.js) against a fake GitHub that keeps
// git objects, and republishing that keeps the episodes the published
// feed has and this device does not (studio/podcast.js keepItems).
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const G = require("../studio/ghpages.js");
const P = require("../studio/podcast.js");
const PC = require("../podcasts/core.js").OrosPodcastsCore;
const FEEDS = require("../feeds/core.js");

const TOKEN = "github_pat_" + "A".repeat(40);
const sha1 = (b) => crypto.createHash("sha1").update(b).digest("hex");
const enc = (s) => new TextEncoder().encode(s);

// a small GitHub: one repository, git blobs/trees/commits, one branch, Pages
function fakeGitHub(opts) {
  opts = opts || {};
  const st = { blobs: {}, trees: {}, commits: {}, ref: null, pages: opts.pages || null, calls: [], seen: [], blobPosts: 0, moveOnce: !!opts.moveOnce };
  const tree = (files) => { const id = sha1(JSON.stringify(files)); st.trees[id] = files; return id; };
  const commit = (treeId, parents) => { const id = sha1(treeId + parents.join() + Math.random()); st.commits[id] = { tree: treeId, parents }; return id; };
  const files = () => (st.ref ? st.trees[st.commits[st.ref].tree] : {});
  const json = (status, body) => ({ status, text: () => Promise.resolve(body === undefined ? "" : JSON.stringify(body)) });
  const base = "https://api.github.com/repos/me/show";
  function fetch(url, init) {
    st.calls.push(init.method + " " + url.replace("https://api.github.com", ""));
    st.seen.push({ url, init });
    if (opts.auth === false) return Promise.resolve(json(401, { message: "Bad credentials" }));
    if (init.headers.Authorization !== "Bearer " + TOKEN) return Promise.resolve(json(401, { message: "Bad credentials" }));
    const body = init.body ? JSON.parse(init.body) : null;
    const p = url.slice(base.length);
    if (!url.startsWith(base)) return Promise.resolve(json(404, {}));
    if (p === "" && init.method === "GET") return Promise.resolve(json(200, { default_branch: "main", permissions: { push: true } }));
    if (p === "/git/ref/heads/main") return Promise.resolve(st.ref ? json(200, { object: { sha: st.ref } }) : json(409, { message: "Git Repository is empty." }));
    if (p === "/contents/.nojekyll" && init.method === "PUT") {
      if (st.ref) return Promise.resolve(json(422, {}));
      const b = Buffer.from(body.content, "base64"), id = sha1(Buffer.concat([Buffer.from("blob " + b.length + "\0"), b]));
      st.blobs[id] = b;
      st.ref = commit(tree({ ".nojekyll": id }), []);
      return Promise.resolve(json(201, {}));
    }
    if (p.startsWith("/contents/") && init.method === "GET") {
      const id = files()[decodeURIComponent(p.slice(10))];
      return Promise.resolve(id ? json(200, { encoding: "base64", content: st.blobs[id].toString("base64") }) : json(404, {}));
    }
    let m;
    if ((m = /^\/git\/commits\/([0-9a-f]+)$/.exec(p)) && init.method === "GET") return Promise.resolve(json(200, { tree: { sha: st.commits[m[1]].tree } }));
    if ((m = /^\/git\/trees\/([0-9a-f]+)\?recursive=1$/.exec(p))) {
      const t = st.trees[m[1]];
      return Promise.resolve(json(200, { tree: Object.keys(t).map((k) => ({ path: k, type: "blob", sha: t[k] })) }));
    }
    if (p === "/git/blobs" && init.method === "POST") {
      if (opts.forbid) return Promise.resolve(json(403, { message: "Resource not accessible by personal access token" }));
      st.blobPosts++;
      const b = Buffer.from(body.content, "base64"), id = sha1(Buffer.concat([Buffer.from("blob " + b.length + "\0"), b]));
      st.blobs[id] = b;
      return Promise.resolve(json(201, { sha: id }));
    }
    if (p === "/git/trees" && init.method === "POST") {
      const t = Object.assign({}, st.trees[body.base_tree]);
      body.tree.forEach((e) => { assert.equal(e.mode, "100644"); t[e.path] = e.sha; });
      return Promise.resolve(json(201, { sha: tree(t) }));
    }
    if (p === "/git/commits" && init.method === "POST") return Promise.resolve(json(201, { sha: commit(body.tree, body.parents) }));
    if (p === "/git/refs/heads/main" && init.method === "PATCH") {
      assert.equal(body.force, false, "never forced");
      if (st.moveOnce) {
        // another device published meanwhile: its file lands first
        st.moveOnce = false;
        const t = Object.assign({}, files()), b = Buffer.from("other"), id = sha1(Buffer.concat([Buffer.from("blob 5\0"), b]));
        st.blobs[id] = b; t["episodes/other.mp3"] = id;
        st.ref = commit(tree(t), [st.ref]);
      }
      if (st.commits[body.sha].parents[0] !== st.ref) return Promise.resolve(json(422, { message: "Update is not a fast forward" }));
      st.ref = body.sha;
      return Promise.resolve(json(200, {}));
    }
    if (p === "/pages" && init.method === "GET") return Promise.resolve(st.pages ? json(200, st.pages) : json(404, {}));
    if (p === "/pages" && init.method === "POST") {
      if (opts.pagesForbid) return Promise.resolve(json(403, {}));
      st.pages = { html_url: "https://me.github.io/show/" };
      return Promise.resolve(json(201, st.pages));
    }
    return Promise.resolve(json(404, {}));
  }
  return { st, fetch, files, text: (path) => (files()[path] ? st.blobs[files()[path]].toString() : null) };
}
const deps = (gh) => ({ fetch: gh.fetch, token: TOKEN, sha1: (b) => sha1(b), bytes: (d) => d });
const REPO = { owner: "me", repo: "show" };

test("P2: repository names, Pages addresses, tokens", () => {
  assert.deepEqual(G.parseRepo("me/show"), REPO);
  assert.deepEqual(G.parseRepo(" https://github.com/me/show.git/ "), REPO);
  for (const bad of ["", "me", "me/show/x", "me/../x", "../x", "-me/x x", "me/.", "https://evil.example/me/show"]) assert.equal(G.parseRepo(bad), null, bad);
  assert.equal(G.pagesUrl(REPO), "https://me.github.io/show/");
  assert.equal(G.pagesUrl(G.parseRepo("Me/me.github.io")), "https://me.github.io/");
  assert.equal(G.tokenOk(TOKEN), true);
  assert.equal(G.tokenOk("ghp_" + "a".repeat(36)), true);
  assert.equal(G.tokenOk("hello"), false);
  assert.equal(G.tokenOk("github_pat_short"), false);
  assert.equal(G.hex(new Uint8Array([0, 15, 255])), "000fff");
  assert.equal(G.b64(enc("Γεια")), Buffer.from("Γεια").toString("base64"));
  // the git blob id, as git hash-object makes it
  const h = G.blobHeader(5), b = enc("hello"), whole = new Uint8Array(h.length + b.length);
  whole.set(h); whole.set(b, h.length);
  assert.equal(sha1(whole), "b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0");
});

test("P2: an empty repository gets the site in one commit, Pages turned on, the token only in the header", async () => {
  const gh = fakeGitHub();
  const files = [{ path: "feed.xml", data: enc("<rss/>") }, { path: "index.html", data: enc("<p>hi</p>") }, { path: "episodes/001-a.mp3", data: new Uint8Array([1, 2, 3]) }];
  const steps = [];
  const res = await G.publish(deps(gh), REPO, files, { onStep: (k) => steps.push(k) });
  assert.equal(res.changed, 3, "three files; .nojekyll came with the first commit");
  assert.equal(res.branch, "main");
  assert.equal(res.pages, "https://me.github.io/show/");
  assert.equal(res.pagesManual, false);
  assert.equal(gh.text("feed.xml"), "<rss/>");
  assert.ok(gh.files()[".nojekyll"]);
  assert.deepEqual([...new Set(steps)], ["repo", "file", "commit", "pages"]);
  for (const c of gh.st.seen) {
    assert.ok(!c.url.includes(TOKEN), "never in an address");
    assert.ok(!(c.init.body || "").includes(TOKEN), "never in a body");
    assert.equal(c.init.headers.Authorization, "Bearer " + TOKEN);
    assert.equal(c.init.cache, "no-store");
  }
});

test("P2: publishing again sends only what changed and never deletes", async () => {
  const gh = fakeGitHub();
  const a = [{ path: "feed.xml", data: enc("v1") }, { path: "episodes/001-a.mp3", data: new Uint8Array(1000).fill(7) }];
  await G.publish(deps(gh), REPO, a);
  const posts = gh.st.blobPosts;
  const same = await G.publish(deps(gh), REPO, a);
  assert.equal(same.changed, 0, "nothing new, no commit");
  assert.equal(gh.st.blobPosts, posts, "no blob sent again");
  const b = [{ path: "feed.xml", data: enc("v2") }, { path: "episodes/002-b.mp3", data: new Uint8Array(10).fill(1) }];
  const res = await G.publish(deps(gh), REPO, b);
  assert.equal(res.changed, 2);
  assert.equal(gh.text("feed.xml"), "v2");
  assert.ok(gh.files()["episodes/001-a.mp3"], "an episode this publish did not carry stays online");
});

test("P2: a branch moved meanwhile is read again once, never forced, and keeps the other device's file", async () => {
  const gh = fakeGitHub({ moveOnce: true });
  const res = await G.publish(deps(gh), REPO, [{ path: "feed.xml", data: enc("first") }]);
  assert.equal(res.changed, 1);
  // the first publish raced: it was retried on top of the moved branch
  assert.equal(gh.text("feed.xml"), "first");
  assert.equal(gh.text("episodes/other.mp3"), "other");
});

test("P2: refusals come back as codes the person can act on", async () => {
  await assert.rejects(G.publish(deps(fakeGitHub({ auth: false })), REPO, [{ path: "a.txt", data: enc("x") }]), (e) => e.code === "gh-auth" && !String(e.message).includes(TOKEN));
  await assert.rejects(G.publish(deps(fakeGitHub({ forbid: true })), REPO, [{ path: "a.txt", data: enc("x") }]), (e) => e.code === "gh-perm");
  await assert.rejects(G.publish(deps(fakeGitHub()), { owner: "me", repo: "nope" }, [{ path: "a.txt", data: enc("x") }]), (e) => e.code === "gh-repo");
  await assert.rejects(G.publish(deps(fakeGitHub()), REPO, [{ path: "../a.txt", data: enc("x") }]), (e) => e.code === "gh-name");
  await assert.rejects(G.publish(deps(fakeGitHub()), REPO, [{ path: "big.mp3", data: { size: G.MAX_FILE + 1 } }]), (e) => e.code === "gh-big");
  const offline = { fetch: () => Promise.reject(new TypeError("Failed to fetch")), token: TOKEN, sha1, bytes: (d) => d };
  await assert.rejects(G.publish(offline, REPO, [{ path: "a.txt", data: enc("x") }]), (e) => e.code === "gh-net");
  const res = await G.publish(deps(fakeGitHub({ pagesForbid: true })), REPO, [{ path: "a.txt", data: enc("x") }]);
  assert.equal(res.pagesManual, true, "Pages refused: the person turns it on by hand");
  assert.equal(res.pages, "");
});

test("P2: republishing keeps the episodes the published feed has and this device does not", async () => {
  const show = P.normShow({ id: "hshow0001", m: 1, title: "Δοκιμή", author: "Chris", desc: "Περιγραφή", lang: "el", url: "https://me.github.io/show/", cover: "/internal/Studio/Podcasts/hshow0001/cover.jpg" });
  show.guid = P.feedGuid(P.feedUrl(show));
  const ep = (pid, n, date) => {
    const e = { n, type: "full", title: "Επεισόδιο " + n, date, guid: P.epGuid(show.id, pid), slug: P.epSlug({ n, type: "full" }, "Επεισόδιο " + n), bytes: 1000 + n, dur: 600, kbps: 96, ch: 1 };
    e.file = P.epPath(show.id, e.slug);
    return { id: pid, m: 1, name: "x", sh: show.id, ep: e, mk: [] };
  };
  const now = Date.UTC(2026, 10, 14, 9, 0, 0);
  // device A published episodes 1 and 2
  const datA = { shows: [show], projects: [ep("pproject1", 1, Date.UTC(2026, 10, 1)), ep("pproject2", 2, Date.UTC(2026, 10, 8))] };
  const online = P.feedXml(show, P.episodes(datA, show.id), { now });
  // device B only has episode 2 (changed) and a new episode 3
  const p2 = ep("pproject2", 2, Date.UTC(2026, 10, 8)); p2.ep.title = "Επεισόδιο 2, διορθωμένο";
  const datB = { shows: [show], projects: [p2, ep("pproject3", 3, Date.UTC(2026, 10, 14))] };
  const epsB = P.episodes(datB, show.id);
  const keep = P.keepItems(online, P.guidsOf(epsB));
  assert.equal(keep.length, 1, "only episode 1 is carried over");
  const xml = P.feedXml(show, epsB, { now, keep });
  const f = PC.parseFeed(PC.fromFeedsXml(FEEDS.parseXml(xml)), P.feedUrl(show));
  assert.deepEqual(f.eps.map((e) => e.title).sort(), ["Επεισόδιο 1", "Επεισόδιο 2, διορθωμένο", "Επεισόδιο 3"]);
  assert.equal(new Set(f.eps.map((e) => e.guid || e.id)).size, 3, "no episode twice");
  // publishing again from B with the new feed keeps it (idempotent)
  assert.equal(P.keepItems(xml, P.guidsOf(epsB)).length, 1);
  // what is not a plain item is left out
  const odd = '<rss><channel><item><title><![CDATA[x]]></title><enclosure url="https://a/b.mp3" length="1" type="audio/mpeg"/><guid>g1</guid></item>' +
    '<item><title>no audio</title><guid>g2</guid></item><item><title>http</title><enclosure url="http://a/b.mp3" length="1" type="audio/mpeg"/><guid>g3</guid></item>' +
    '<item><title>ok</title><enclosure url="https://a/c.mp3" length="1" type="audio/mpeg"/><guid isPermaLink="false">g4</guid></item>' +
    '<item><title>twice</title><enclosure url="https://a/c.mp3" length="1" type="audio/mpeg"/><guid>g4</guid></item></channel></rss>';
  assert.deepEqual(P.keepItems(odd, []).map((x) => /<guid[^>]*>([^<]+)</.exec(x)[1]), ["g4"]);
  assert.deepEqual(P.keepItems("not xml", []), []);
  assert.deepEqual(P.keepItems(null, []), []);
});

test("P2: the published feed is read through the API; none yet is empty", async () => {
  const gh = fakeGitHub();
  assert.equal(await G.readFile(deps(gh), REPO, "feed.xml"), "");
  await G.publish(deps(gh), REPO, [{ path: "feed.xml", data: enc("<rss>Γεια</rss>") }]);
  assert.equal(await G.readFile(deps(gh), REPO, "feed.xml"), "<rss>Γεια</rss>");
  await assert.rejects(G.readFile(deps(fakeGitHub({ auth: false })), REPO, "feed.xml"), (e) => e.code === "gh-auth");
});
