// Link previews for shared songs (relay/preview.js, GET /p/<code>,
// BR-SHARE-PREVIEW): escaping, the cover host check, locked / other
// kinds / bad codes get no preview and nothing echoed, size caps, the
// inflate cap, methods, headers, and the relay's song normalizer kept
// equal to share/kinds.js.
// Run: node --test tests/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("zlib");
const path = require("path");
const K = require(path.join(__dirname, "..", "share/kinds.js"));
let P, handle;
test.before(async () => {
  P = await import("../relay/preview.js");
  ({ handle } = await import("../relay/core.js"));
});
const BASE = "https://oros-mail-relay.koulaxizis.workers.dev";
const code = (env) => "1." + zlib.deflateRawSync(Buffer.from(JSON.stringify(env))).toString("base64url");
const song = (d) => code({ v: 1, k: "track", d: Object.assign({ t: "Song", a: "Band", s: "ia" }, d) });
async function get(p, method, ip) {
  P.resetPreviewLimits();
  return handle(new Request(BASE + p, { method: method || "GET", headers: { "CF-Connecting-IP": ip || "1.2.3.4" } }), {}, null, Date.now());
}

test("a song: Open Graph page with escaped fields, cover, forward to the share page", async () => {
  const c = song({ t: "<script>alert(1)</script> \"x\" 'y' ‮evil", a: "A & B", al: "Live", li: "by-sa 4.0", art: "https://archive.org/services/img/x" });
  const r = await get("/p/" + c);
  assert.equal(r.status, 200);
  const h = await r.text();
  assert.ok(h.indexOf("<script") < 0, "no script tag");
  assert.match(h, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &quot;x&quot; &#39;y&#39; evil · A &amp; B/);
  assert.ok(h.indexOf("‮") < 0, "bidi stripped");
  assert.match(h, /<meta property="og:image" content="https:\/\/archive\.org\/services\/img\/x">/);
  assert.match(h, /<meta property="og:description" content="Live · CC BY-SA 4\.0 · orOS">/);
  const go = "https://useoros.online/share/#" + c;
  assert.ok(h.indexOf('content="0;url=' + go + '"') > 0);
  assert.ok(h.indexOf('<a href="' + go + '">') > 0);
  assert.equal(r.headers.get("content-type"), "text/html; charset=utf-8");
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.equal(r.headers.get("referrer-policy"), "no-referrer");
  assert.equal(r.headers.get("x-robots-tag"), "noindex");
  assert.equal(r.headers.get("content-security-policy"), "default-src 'none'; img-src https:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  assert.equal(r.headers.get("cache-control"), "public, max-age=86400");
  const hd = await get("/p/" + c, "HEAD");
  assert.equal(hd.status, 200);
  assert.equal(await hd.text(), "");
});

test("fields are capped", async () => {
  const h = await (await get("/p/" + song({ t: "t".repeat(200), a: "a".repeat(200), al: "l".repeat(200) }))).text();
  assert.ok(h.indexOf("t".repeat(120)) < 0 && h.indexOf("t".repeat(119) + "…") > 0);
  assert.ok(h.indexOf("a".repeat(120)) < 0);
});

test("a cover on another host, with a port or a login falls back to the orOS picture", async () => {
  for (const art of ["https://evil.example/x.png", "https://archive.org.evil.example/x.png", "https://archive.org:8443/x.png",
    "https://u:p@archive.org/x.png", "http://archive.org/x.png", "https://archive.org/" + "x".repeat(600)]) {
    assert.equal(P.coverOk(art), "", art);
    const h = await (await get("/p/" + song({ art }))).text();
    assert.match(h, /og:image" content="https:\/\/useoros\.online\/icons\/og-image\.png"/, art);
  }
  assert.equal(P.coverOk("https://usercontent.jamendo.com/?type=album&id=1"), "https://usercontent.jamendo.com/?type=album&id=1");
});

async function noPreview(p, method) {
  const r = await get(p, method);
  assert.equal(r.status, 302, p.slice(0, 40));
  assert.equal(r.headers.get("location"), "https://useoros.online/share/");
  assert.equal(await r.text(), "");
}
test("locked, other kinds, bad charset, oversized, query, bombs: no preview, nothing echoed", async () => {
  await noPreview("/p/p1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  await noPreview("/p/r1.abc.def.1");
  await noPreview("/p/0." + Buffer.from(JSON.stringify({ v: 1, k: "track", d: { t: "x" } })).toString("base64url"));
  await noPreview("/p/" + code({ v: 1, k: "note", d: { t: "secret", x: "hello" } }));
  await noPreview("/p/" + code({ v: 1, k: "track", d: { a: "no title" } }));
  await noPreview("/p/1.abc%3Cscript%3E");
  await noPreview("/p/1.abc/def");
  await noPreview("/p/1." + "A".repeat(5000));
  await noPreview("/p/" + song({}) + "?x=1");
  await noPreview("/p/1.AAAA");                       // not deflate
  const bomb = "1." + zlib.deflateRawSync(Buffer.from(JSON.stringify({ v: 1, k: "track", d: { t: "x", cr: " ".repeat(200000) } }))).toString("base64url");
  assert.ok(bomb.length < 4000, "bomb fits the path: " + bomb.length);
  await noPreview("/p/" + bomb);
  assert.equal(await P.songOf(bomb), null);
});

test("POST and other methods: 405; rate limit per IP", async () => {
  for (const m of ["POST", "PUT", "DELETE"]) {
    const r = await get("/p/" + song({}), m);
    assert.equal(r.status, 405, m);
    assert.equal(r.headers.get("allow"), "GET, HEAD");
  }
  P.resetPreviewLimits();
  const c = song({});
  let last = null;
  for (let i = 0; i <= P.PV_LIMITS.perMin; i++) {
    last = await handle(new Request(BASE + "/p/" + c, { headers: { "CF-Connecting-IP": "9.9.9.9" } }), {}, null, 1000);
  }
  assert.equal(last.status, 429);
});

test("the relay's song normalizer equals share/kinds.js", () => {
  const cases = [
    { t: "Song", a: "Band", al: "Al", y: "1999", d: 183.4, s: "ia", k: "ia:abc123def", u: "https://archive.org/download/x/a.mp3",
      pg: "https://archive.org/details/x", art: "https://archive.org/services/img/x", li: "by-nc-sa 4.0", vi: "jamendo", cr: "c" },
    { t: "Mine", a: "Me", s: "sv", u: "https://my.server/stream?t=tok", k: "sv:abcdef12" },
    { t: "R", s: "ln", u: "https://radio.example/live.mp3", k: "ln:abcdef12", art: "https://archive.org/x" },
    { t: "R", s: "ln", u: "https://radio.example/live.mp3?token=1" },
    { t: "x".repeat(300) + "\u0000", a: "y z", s: "ia", y: "99", d: -1, li: "gpl", vi: "<b>", k: "jm:abcdef12", cr: "c".repeat(900),
      u: "https://user:pw@archive.org/a.mp3", art: "https://evil.example/a.png" },
    { t: "  " }, { a: "x" }, { t: "ok", s: "zz", d: 400000 }
  ];
  for (const c of cases) assert.deepEqual(P.normTrack(c), K.norm("track", c), JSON.stringify(c).slice(0, 60));
});

test("send window: the preview link only for an unlocked plain song link, the person's choice", () => {
  const s = require("fs").readFileSync(path.join(__dirname, "..", "share/send.js"), "utf8");
  assert.match(s, /var canPv = \(env\.k === "track" \|\| env\.k === "tracks"\) && !bin, pvOn = true;/);
  assert.match(s, /pvOn && canPv && !lockOn && !expOn && \/\^1\\\.\/\.test\(code\) && code\.length <= PV_MAX/);
  assert.match(s, /PV_BASE = \(\(R && R\.RELAY\) \|\| "https:\/\/oros-mail-relay\.koulaxizis\.workers\.dev"\) \+ "\/p\/"/);
  ["pv", "pvNote"].forEach((k) => {
    assert.equal((s.match(new RegExp("\\b" + k + ": \"", "g")) || []).length, 2, k);
    assert.ok(require("fs").readFileSync(path.join(__dirname, "..", "i18n/de/share.js"), "utf8").indexOf('"' + k + '":') >= 0, k + " DE");
  });
});

test("albums and playlists: preview page, other kinds still none; normTracks equals kinds.js", async () => {
  const c = code({ v: 1, k: "tracks", d: { t: "Live <99>", ty: "al", a: "Band", i: [
    { t: "A", s: "ia", u: "https://archive.org/a.mp3", art: "https://archive.org/services/img/a" }, { t: "B", s: "sv", u: "https://my/x" }] } });
  const h = await (await get("/p/" + c)).text();
  assert.match(h, /og:title" content="🎵 Live &lt;99&gt;"/);
  assert.match(h, /og:description" content="Album · 2 songs · orOS"/);
  assert.ok(h.indexOf("Band") < 0 && h.indexOf(">A<") < 0 && h.indexOf("\"A\"") < 0, "no artist, no song titles");
  // only the list's own cover: a song's cover never stands in for it
  assert.match(h, /og:image" content="https:\/\/useoros\.online\/icons\/og-image\.png"/);
  const bad = code({ v: 1, k: "tracks", d: { t: "<script>x</script>\u202e\u2066Mix", ty: "pl", art: "https://evil.example/c.png", i: [{ t: "A" }, "junk", { a: "no title" }] } });
  const hb = await (await get("/p/" + bad)).text();
  assert.ok(hb.indexOf("<script") < 0 && hb.indexOf("\u202e") < 0 && hb.indexOf("\u2066") < 0);
  assert.match(hb, /og:title" content="🎵 &lt;script&gt;x&lt;\/script&gt; Mix"/);
  assert.match(hb, /og:description" content="Playlist · 1 song · orOS"/, "counted after the normalizer");
  assert.match(hb, /og:image" content="https:\/\/useoros\.online\/icons\/og-image\.png"/, "foreign cover host");
  const good = code({ v: 1, k: "tracks", d: { t: "Mix", ty: "pl", art: "https://archive.org/services/img/m", i: [{ t: "A" }] } });
  assert.match(await (await get("/p/" + good)).text(), /og:image" content="https:\/\/archive\.org\/services\/img\/m"/);
  const many = code({ v: 1, k: "tracks", d: { t: "Big", i: Array.from({ length: 201 }, () => ({ t: "s" })) } });
  assert.ok(many.length < 4000, "201 songs fit the path: " + many.length);
  await noPreview("/p/" + many);
  const ok200 = code({ v: 1, k: "tracks", d: { t: "Big", i: Array.from({ length: 200 }, () => ({ t: "s" })) } });
  assert.match(await (await get("/p/" + ok200)).text(), /200 songs/);
  const cases = [
    { t: "P", ty: "pl", i: [{ t: "x", s: "ia", u: "https://archive.org/a.mp3", cr: "c", k: "ia:abcdef12" }, { t: "y", s: "sv", u: "https://my/x" }, "junk", null] },
    { t: "A".repeat(300), ty: "zz", a: "b", art: "https://evil.example/a.png", cr: "c", i: [] },
    { i: Array.from({ length: 250 }, (_, n) => ({ t: "s" + n })) }
  ];
  for (const x of cases) assert.deepEqual(P.normTracks(x), K.norm("tracks", x));
});
