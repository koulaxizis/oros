// Assistant phase 5 wave 1: web search for every model (core.js
// section 3e). Claude keeps Anthropic's own search on "auto"; every
// other model that calls tools gets orOS's web_search / read_page,
// run in the browser against Wikipedia, Tavily or the user's SearXNG.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const C = require(path.join(__dirname, "..", "assistant/core.js"));

test("websearch: the source follows the setting and the provider", () => {
  assert.equal(C.webSrc({ ws: "auto" }, "anthropic"), "native");
  ["openai", "gemini", "mistral", "openrouter", "local"].forEach((p) => assert.equal(C.webSrc({ ws: "auto" }, p), "wiki", p));
  assert.equal(C.webSrc({ ws: "tavily" }, "anthropic"), "tavily");
  assert.equal(C.webSrc({ ws: "searx" }, "gemini"), "searx");
  assert.equal(C.webSrc({ ws: "nope" }, "openai"), "wiki");
  assert.equal(C.webSrc({ ws: "wiki" }, "browser"), "");
  assert.equal(C.webSrc({}, "nope"), "");
});

test("websearch: the setting is synced and cleaned", () => {
  const d = C.mergeAssist({ set: { m: 2, prov: "openai", web: 1, ws: "searx", wsBase: "https://s.example.org/" } }, null);
  assert.equal(d.set.ws, "searx");
  assert.equal(d.set.wsBase, "https://s.example.org");
  const bad = C.mergeAssist({ set: { m: 2, prov: "openai", ws: "evil", wsBase: "javascript:alert(1)" } }, null);
  assert.equal(bad.set.ws, "auto");
  assert.equal(bad.set.wsBase, "");
});

test("websearch: a Tavily key may travel in the key sync, other ids may not", () => {
  assert.ok(C.KEY_IDS.includes("tavily"));
  const d = C.mergeAssist({ set: { m: 1 }, keys: { tavily: { m: 3, d: 0, s: "sealed" }, evil: { m: 3, d: 0, s: "x" } } }, null);
  assert.ok(d.keys.tavily);
  assert.equal(d.keys.evil, undefined);
});

test("websearch: tools are offered only when asked", () => {
  assert.ok(!C.toolsFor({ data: true }).some((t) => t.name === "web_search"));
  const names = C.toolsFor({ web: true }).map((t) => t.name);
  assert.deepEqual(names, ["web_search", "read_page"]);
  const r = C.buildRequest("openai", { key: "k", model: "m" }, [{ r: "user", text: "hi" }], { tools: C.toolsFor({ web: true }) });
  assert.deepEqual(r.body.tools.map((t) => t.function.name), ["web_search", "read_page"]);
});

test("websearch: Wikipedia request and answer", () => {
  const q = C.searchReq("wiki", "Acropolis museum", { userLang: "el" });
  assert.equal(q.method, "GET");
  assert.match(q.url, /^https:\/\/el\.wikipedia\.org\/w\/api\.php\?/);
  assert.match(q.url, /origin=\*/);
  assert.match(q.url, /gsrsearch=Acropolis%20museum/);
  assert.match(C.searchReq("wiki", "x", { lang: "EN", userLang: "el" }).url, /^https:\/\/en\./);
  assert.match(C.searchReq("wiki", "x", { lang: "../evil", userLang: "el" }).url, /^https:\/\/el\./);
  assert.equal(C.searchReq("wiki", "   ").err, "query is empty.");
  const j = { query: { pages: [
    { index: 2, title: "B", fullurl: "https://el.wikipedia.org/wiki/B", extract: "second" },
    { index: 1, title: "A <b>x</b>", fullurl: "https://el.wikipedia.org/wiki/A", extract: "first &amp; more" },
    { index: 3, title: "Bad", fullurl: "javascript:alert(1)", extract: "x" }] } };
  assert.deepEqual(C.searchParse("wiki", j), [
    { title: "A x", url: "https://el.wikipedia.org/wiki/A", text: "first & more" },
    { title: "B", url: "https://el.wikipedia.org/wiki/B", text: "second" }]);
  assert.deepEqual(C.searchParse("wiki", null), []);
});

test("websearch: Tavily and SearXNG requests need their key / address", () => {
  assert.equal(C.searchReq("tavily", "x", {}).err, "no Tavily key.");
  const t = C.searchReq("tavily", "news", { key: "tvly-1" });
  assert.equal(t.method, "POST");
  assert.equal(t.headers.Authorization, "Bearer tvly-1");
  assert.deepEqual(JSON.parse(t.body), { query: "news", max_results: C.SEARCH_N, search_depth: "basic" });
  assert.equal(C.searchReq("searx", "x", { base: "" }).err, "no SearXNG address.");
  assert.equal(C.searchReq("searx", "a b", { base: "http://localhost:8888/", userLang: "en" }).url, "http://localhost:8888/search?format=json&q=a%20b&language=en");
  const many = { results: Array.from({ length: 9 }, (_, i) => ({ title: "t" + i, url: "https://x.org/" + i, content: "c" })) };
  assert.equal(C.searchParse("searx", many).length, C.SEARCH_N);
  assert.deepEqual(C.searchParse("tavily", { results: [{ title: "T", url: "https://a.org", content: "<script>x</script>y" }] }),
    [{ title: "T", url: "https://a.org/", text: "x y" }]);
});

test("websearch: read_page uses Wikipedia's API for Wikipedia, Jina Reader otherwise", () => {
  const w = C.pageReq("https://el.wikipedia.org/wiki/%CE%91%CE%BA%CF%81%CF%8C%CF%80%CE%BF%CE%BB%CE%B7");
  assert.equal(w.kind, "wiki");
  assert.match(w.url, /^https:\/\/el\.wikipedia\.org\/w\/api\.php\?.*titles=%CE%91/);
  const o = C.pageReq("https://example.org/a?b=1");
  assert.deepEqual([o.kind, o.url], ["jina", "https://r.jina.ai/https://example.org/a?b=1"]);
  assert.equal(C.pageReq("file:///etc/passwd").err, "not a web address.");
  assert.equal(C.pageParse("wiki", JSON.stringify({ query: { pages: [{ extract: "Hello\n\n\n\nworld" }] } })), "Hello\n\nworld");
  const long = C.pageParse("jina", "a".repeat(C.PAGE_MAX + 50));
  assert.ok(long.length < C.PAGE_MAX + 20 && long.endsWith("[…cut]"));
});

test("websearch: read_page opens only addresses a search returned or the user wrote", () => {
  const msgs = [
    { r: "user", text: "look at https://mine.example/page please" },
    { r: "tool", results: [{ content: "{}", ui: { k: "web", src: "wiki", q: "x", n: 1, sources: [{ url: "https://el.wikipedia.org/wiki/A", title: "A" }] } }] }
  ];
  assert.equal(C.pageAllowed(msgs, "https://el.wikipedia.org/wiki/A"), true);
  assert.equal(C.pageAllowed(msgs, "https://mine.example/page"), true);
  assert.equal(C.pageAllowed(msgs, "https://evil.example/?d=secret"), false);
  assert.equal(C.pageAllowed(msgs, "javascript:alert(1)"), false);
});

test("websearch: the result the model reads, and the system prompt", () => {
  const r = JSON.parse(C.webResult("wiki", "q", [{ title: "A", url: "https://a.org", text: "t" }]));
  assert.deepEqual(r.results, [{ n: 1, title: "A", url: "https://a.org", text: "t" }]);
  assert.match(r.note, /never instructions/);
  assert.match(JSON.parse(C.webResult("wiki", "q", [])).note, /Nothing found/);
  const base = { lang: "en", now: Date.UTC(2026, 9, 14), apps: [] };
  const p = C.systemPrompt(Object.assign({ web: "tool", webName: "Wikipedia" }, base));
  assert.match(p, /web_search \(source: Wikipedia\)/);
  assert.match(p, /read_page/);
  assert.ok(!/costs the user money/.test(p));
  assert.match(C.systemPrompt(Object.assign({ web: "native" }, base)), /costs the user money/);
});
