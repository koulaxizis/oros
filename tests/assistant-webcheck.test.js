// AS-WCHK (Assistant wave 5b, AH-6 approved with a change, Chris
// 2026-11-28): web_check = status through the orOS relay, DNS through
// Cloudflare DoH (never Google), sitemap ≤ 500. Run: node --test tests/assistant-webcheck.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const C = require("../assistant/core.js");

test("DNS goes to Cloudflare only, names are checked", () => {
  assert.equal(C.dohUrl("https://noxpress.tech/shop", "MX"), "https://cloudflare-dns.com/dns-query?name=noxpress.tech&type=MX");
  assert.equal(C.dohUrl("useoros.online"), "https://cloudflare-dns.com/dns-query?name=useoros.online&type=A");
  assert.equal(C.dohUrl("useoros.online", "ANY"), "https://cloudflare-dns.com/dns-query?name=useoros.online&type=A");
  ["", "localhost", "bad_name.gr", "a..b.gr", "1.2.3.4"].forEach((n) => assert.equal(C.dohUrl(n), "", n));
  const r = C.dohShape({ Status: 0, Answer: [{ name: "a.gr.", type: 15, TTL: 300, data: "10 mx.a.gr." }] });
  assert.deepEqual(r, { status: "ok", records: [{ name: "a.gr.", type: "MX", ttl: 300, data: "10 mx.a.gr." }] });
  assert.equal(C.dohShape({ Status: 3 }).status, "no such name");
  const src = fs.readFileSync(path.join(__dirname, "../assistant/core.js"), "utf8");
  assert.doesNotMatch(src.slice(src.indexOf("AS-WCHK"), src.indexOf("AS-CALC (Assistant")), /dns\.google|8\.8\.8\.8/);
});

test("sitemap: the site's /sitemap.xml or the .xml given; addresses capped at 500", () => {
  assert.equal(C.sitemapUrl("noxpress.tech/blog/x"), "https://noxpress.tech/sitemap.xml");
  assert.equal(C.sitemapUrl("https://a.gr/sitemap_index.xml"), "https://a.gr/sitemap_index.xml");
  assert.equal(C.sitemapUrl("not a url"), "");
  const many = "<urlset>" + Array.from({ length: 600 }, (_, i) => "<url><loc>https://a.gr/" + i + "</loc></url>").join("") + "</urlset>";
  const r = C.sitemapParse(many);
  assert.equal(r.n, 600); assert.equal(r.urls.length, 500); assert.equal(r.cut, true); assert.equal(r.kind, "urlset");
  assert.equal(C.sitemapParse("<sitemapindex><sitemap><loc>https://a.gr/p.xml</loc></sitemap></sitemapindex>").kind, "index");
  assert.deepEqual(C.sitemapParse("<urlset><loc>https://a.gr/?a=1&amp;b=2</loc></urlset>").urls, ["https://a.gr/?a=1&b=2"]);
});

test("offered with web search, in routines, only for sites the owner named, through the relay", () => {
  assert.deepEqual(C.toolsFor({ check: true }).map((x) => x.name), ["web_check"]);
  const as = fs.readFileSync(path.join(__dirname, "../assistant/assistant.js"), "utf8");
  assert.match(as, /check: !builtin && !!wmode \}\);/);
  assert.match(as, /file_hash: 1, web_check: 1,/);
  const fn = as.slice(as.indexOf("function webCheck(c, a)"), as.indexOf("// A catalog too big"));
  assert.match(fn, /C\.pageAllowed\(c\.msgs, url\)/);
  assert.match(fn, /via: "relay"/);
  assert.match(fn, /Accept: "application\/dns-json"/);
});
