// Studio wave P4 (Publish as podcast): the site into a folder on the
// person's own WebDAV server (Nextcloud), against a fake server, direct
// and through the relay's /dav pass-through.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const D = require("../studio/davpub.js");

const ROOT = "/remote.php/dav/files/me/Podcast";
const ORIGIN = "https://cloud.example.com";
const sha1 = (b) => crypto.createHash("sha1").update(b).digest("hex");
const bytes = (d) => (d instanceof Uint8Array ? d : new Uint8Array(d));
const enc = (s) => new TextEncoder().encode(s);

function fakeDav(opts) {
  opts = opts || {};
  const S = { files: {}, dirs: new Set([""]), calls: [], auths: new Set(), n: 0, putEtag: opts.putEtag !== false };
  const tagOf = (p) => '"' + S.files[p].tag + '"';
  function res(status, body, headers) {
    const h = new Map(Object.entries(headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    return { status, headers: { get: (k) => (h.has(k.toLowerCase()) ? h.get(k.toLowerCase()) : null) }, text: () => Promise.resolve(body || "") };
  }
  async function serve(method, url, init) {
    S.calls.push(method + " " + url.replace(ORIGIN + ROOT, ""));
    S.auths.add(init.headers.Authorization);
    if (init.headers.Authorization !== "Basic " + Buffer.from("me:app-pass-1").toString("base64")) return res(401);
    if (!url.startsWith(ORIGIN + ROOT)) return res(404);
    let rel = decodeURIComponent(url.slice((ORIGIN + ROOT).length)).replace(/^\//, "").replace(/\/$/, "");
    if (method === "PROPFIND") {
      if (!S.dirs.has(rel)) return res(404);
      const kids = Object.keys(S.files).filter((p) => p.slice(0, p.lastIndexOf("/") < 0 ? 0 : p.lastIndexOf("/")) === rel && (rel ? p.startsWith(rel + "/") : !p.includes("/")));
      const sub = [...S.dirs].filter((d) => d && d !== rel && (rel ? d.startsWith(rel + "/") : !d.includes("/")) && d.split("/").length === (rel ? rel.split("/").length + 1 : 1));
      const href = (p) => ROOT + "/" + p.split("/").map(encodeURIComponent).join("/");
      let x = '<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">';
      x += "<d:response><d:href>" + ROOT + (rel ? "/" + rel : "") + "/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>";
      sub.forEach((d) => { x += "<d:response><d:href>" + href(d) + "/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype><d:getetag>&quot;dir&quot;</d:getetag></d:prop></d:propstat></d:response>"; });
      kids.forEach((p) => { x += "<d:response><d:href>" + href(p) + "</d:href><d:propstat><d:prop><d:resourcetype/><d:getetag>&quot;" + S.files[p].tag + "&quot;</d:getetag></d:prop></d:propstat></d:response>"; });
      return res(207, x + "</d:multistatus>", { "Content-Type": "application/xml" });
    }
    if (method === "MKCOL") { if (S.dirs.has(rel)) return res(405); S.dirs.add(rel); return res(201); }
    if (method === "GET") return S.files[rel] ? res(200, Buffer.from(S.files[rel].body).toString(), { ETag: tagOf(rel) }) : res(404);
    if (method === "PUT") {
      const parent = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
      if (!S.dirs.has(parent)) return res(409);
      const im = init.headers["If-Match"], inm = init.headers["If-None-Match"];
      if (im && (!S.files[rel] || '"' + S.files[rel].tag + '"' !== im)) return res(412);
      if (inm === "*" && S.files[rel]) return res(412);
      const body = init.body instanceof Uint8Array ? init.body : new Uint8Array(await init.body.arrayBuffer());
      S.files[rel] = { body, tag: "t" + (++S.n) };
      return res(S.files[rel] ? 201 : 204, "", S.putEtag ? { ETag: tagOf(rel) } : {});
    }
    if (method === "DELETE") throw new Error("nothing is ever deleted");
    return res(405);
  }
  S.fetch = (url, init) => {
    if (opts.relay) {
      assert.equal(url, D.RELAY);
      return serve(init.method, init.headers["X-Oros-Target"], init);
    }
    if (opts.cors) return Promise.reject(new TypeError("Failed to fetch"));
    return serve(init.method, url, init);
  };
  return S;
}

const deps = (S, extra) => Object.assign({ fetch: S.fetch, conf: { url: ORIGIN + ROOT + "/", user: "me" }, pass: "app-pass-1", sha1, bytes }, extra || {});
const site = (feed) => [
  { path: "episodes/001-a.mp3", data: new Uint8Array([1, 2, 3, 4]) },
  { path: "chapters/001-a.json", data: enc("{}") },
  { path: "index.html", data: enc("<p>x</p>") },
  { path: "feed.xml", data: enc(feed || "<rss>1</rss>") }
];

test("P4: addresses, the public link and a multistatus", () => {
  assert.equal(D.normFolder("https://cloud.example.com/remote.php/dav/files/me/Pod cast/"), "https://cloud.example.com/remote.php/dav/files/me/Pod%20cast");
  assert.equal(D.normFolder("http://cloud.example.com/x"), "", "https only");
  assert.equal(D.normFolder("https://me:pw@cloud.example.com/x"), "");
  assert.equal(D.normFolder("https://cloud.example.com/x?y=1"), "");
  assert.equal(D.normFolder("not a url"), "");
  assert.deepEqual(D.parseShare("https://cloud.example.com/s/AbCdEf123"), { token: "AbCdEf123", base: "https://cloud.example.com/public.php/dav/files/AbCdEf123/" });
  assert.deepEqual(D.parseShare("https://cloud.example.com/nc/index.php/s/AbCdEf123/"), { token: "AbCdEf123", base: "https://cloud.example.com/nc/public.php/dav/files/AbCdEf123/" });
  assert.equal(D.parseShare("https://cloud.example.com/public.php/dav/files/AbCdEf123/").base, "https://cloud.example.com/public.php/dav/files/AbCdEf123/");
  assert.equal(D.parseShare("http://cloud.example.com/s/AbCdEf123"), null);
  assert.equal(D.parseShare("https://cloud.example.com/s/<x>"), null);
  assert.equal(D.parseShare("https://cloud.example.com/apps/files/"), null);
  const l = D.listing('<d:multistatus xmlns:d="DAV:"><d:response><d:href>/a/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>' +
    '<D:response><D:href>/a/feed%20x.xml</D:href><D:propstat><D:prop><D:resourcetype/><D:getetag>W/"abc"</D:getetag></D:prop></D:propstat></D:response></d:multistatus>');
  assert.deepEqual(l, [{ name: "a", dir: true, etag: "" }, { name: "feed x.xml", dir: false, etag: "abc" }]);
});

test("P4: first publish makes the folders, sends every file once, the feed last and only if none was there", async () => {
  const S = fakeDav();
  const steps = [];
  const r = await D.publish(deps(S), site(), { feedEtag: "", onStep: (k) => steps.push(k) });
  assert.equal(r.changed, 4);
  assert.deepEqual(Object.keys(S.files).sort(), ["chapters/001-a.json", "episodes/001-a.mp3", "feed.xml", "index.html"]);
  const puts = S.calls.filter((c) => c.startsWith("PUT"));
  assert.equal(puts[puts.length - 1], "PUT /feed.xml", "the feed goes last");
  assert.ok(S.calls.includes("MKCOL /episodes/") && S.calls.includes("MKCOL /chapters/"));
  assert.equal(steps[0], "folder");
  assert.ok([...S.auths].every((a) => a === "Basic " + Buffer.from("me:app-pass-1").toString("base64")));
  assert.ok(!S.calls.some((c) => c.includes("app-pass-1")), "the password is never in an address");
  assert.ok(Object.values(r.sent).every((x) => /^[0-9a-f]{40}$/.test(x.h) && x.e), "what was sent, with the server's ETag");

  // again with nothing changed: nothing is sent
  const before = S.calls.length;
  const r2 = await D.publish(deps(S), site(), { sent: r.sent, feedEtag: S.files["feed.xml"].tag });
  assert.equal(r2.changed, 0);
  assert.ok(!S.calls.slice(before).some((c) => c.startsWith("PUT") || c.startsWith("MKCOL")));

  // a new feed: only it goes, on the version read
  const r3 = await D.publish(deps(S), site("<rss>2</rss>"), { sent: r2.sent, feedEtag: S.files["feed.xml"].tag });
  assert.equal(r3.changed, 1);
  assert.equal(Buffer.from(S.files["feed.xml"].body).toString(), "<rss>2</rss>");

  // a file someone changed on the server is sent again
  S.files["index.html"] = { body: enc("other"), tag: "zz" };
  const r4 = await D.publish(deps(S), site("<rss>2</rss>"), { sent: r3.sent, feedEtag: S.files["feed.xml"].tag });
  assert.equal(r4.changed, 1);
  assert.equal(Buffer.from(S.files["index.html"].body).toString(), "<p>x</p>");
});

test("P4: a feed another device wrote meanwhile is never overwritten", async () => {
  const S = fakeDav();
  await D.publish(deps(S), site(), { feedEtag: "" });
  const read = await D.readFeed(deps(S));
  assert.equal(read.text, "<rss>1</rss>");
  assert.equal(read.etag, S.files["feed.xml"].tag);
  S.files["feed.xml"] = { body: enc("<rss>other device</rss>"), tag: "other" };
  await assert.rejects(D.publish(deps(S), site("<rss>mine</rss>"), { feedEtag: read.etag }), { code: "dav-moved" });
  assert.equal(Buffer.from(S.files["feed.xml"].body).toString(), "<rss>other device</rss>");
  // a feed that appeared after this device read none
  const S2 = fakeDav();
  S2.files["feed.xml"] = { body: enc("<rss>early</rss>"), tag: "e1" };
  await assert.rejects(D.publish(deps(S2), site(), { feedEtag: "" }), { code: "dav-moved" });
  assert.equal(Buffer.from(S2.files["feed.xml"].body).toString(), "<rss>early</rss>");
  assert.deepEqual(await D.readFeed(deps(fakeDav())), { text: "", etag: "" }, "no feed yet");
});

test("P4: through the relay, ETags read back when the server gives none, refusals named", async () => {
  const S = fakeDav({ relay: true, putEtag: false });
  const r = await D.publish(deps(S, { conf: { url: ORIGIN + ROOT, user: "me", relay: true } }), site(), { feedEtag: "" });
  assert.equal(r.changed, 4);
  assert.ok(Object.values(r.sent).every((x) => x.e), "ETags from a PROPFIND after the PUTs");
  await assert.rejects(D.publish(deps(fakeDav(), { pass: "wrong" }), site(), {}), { code: "dav-auth" });
  await assert.rejects(D.publish(deps(fakeDav({ cors: true })), site(), {}), { code: "dav-cors" });
  await assert.rejects(D.publish(deps(fakeDav(), { conf: { url: ORIGIN + "/remote.php/dav/files/me/Gone", user: "me" } }), site(), {}), { code: "dav-folder" });
  await assert.rejects(D.publish(deps(fakeDav(), { conf: { url: "ftp://x", user: "me" } }), site(), {}), { code: "dav-url" });
  await assert.rejects(D.publish(deps(fakeDav()), [{ path: "../x", data: enc("a") }], {}), { code: "dav-name" });
  const big = { path: "episodes/big.mp3", data: { size: D.RELAY_MAX + 1 } };
  await assert.rejects(D.publish(deps(fakeDav({ relay: true }), { conf: { url: ORIGIN + ROOT, user: "me", relay: true } }), [big], {}), { code: "dav-big" });
  const refused = (code) => ({ fetch: () => Promise.resolve({ status: 400, headers: { get: (k) => (k === "X-Oros-Error" ? code : null) }, text: () => Promise.resolve(code) }),
    conf: { url: ORIGIN + ROOT, user: "me", relay: true }, pass: "p", sha1, bytes });
  await assert.rejects(D.publish(refused("too-big"), site(), {}), { code: "dav-big" });
  await assert.rejects(D.publish(refused("bad-target"), site(), {}), { code: "dav-target" });
  await assert.rejects(D.publish(refused("rate"), site(), {}), { code: "dav-net" });
  const err = await D.publish(deps(fakeDav(), { pass: "secret-pass-xyz" }), site(), {}).catch((e) => e);
  assert.ok(!String(err.message + err.stack).includes("secret-pass-xyz"), "an error never carries the password");
});
