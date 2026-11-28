// modelfetch.js: our own model mirrors, one file or a file cut into
// parts (<url>.partNN), every part and the whole file SHA-256 checked.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const path = require("path");

const F = require(path.join(__dirname, "..", "modelfetch.js"));

const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const WHOLE = Buffer.from(Array.from({ length: 10000 }, (_, i) => (i * 7) & 255));
const PARTS = [WHOLE.subarray(0, 4000), WHOLE.subarray(4000, 8000), WHOLE.subarray(8000)];
const URL = "https://koulaxizis.github.io/oros-models-vision/m/onnx/model.onnx";
const FILE = { url: URL, size: WHOLE.length, sha: sha(WHOLE), parts: PARTS.map((p) => ({ size: p.length, sha: sha(p) })) };

function server(map, log) {
  return (url) => {
    if (log) log.push(url);
    const b = map[url];
    if (!b) return Promise.resolve({ ok: false, status: 404 });
    return Promise.resolve(new Response(b));
  };
}
const partsMap = () => Object.fromEntries(PARTS.map((p, i) => [F.partUrl(URL, i), p]));

test("partUrl numbers parts like tools/mirror.py", () => {
  assert.equal(F.partUrl("a/b.onnx", 0), "a/b.onnx.part00");
  assert.equal(F.partUrl("a/b.onnx", 12), "a/b.onnx.part12");
  assert.equal(F.bytes(FILE), 10000);
  assert.equal(F.bytes({ url: "x", size: 5 }), 5);
});

test("a split file is fetched part by part, joined and checked", async () => {
  const log = [], seen = [];
  const blob = await F.get(FILE, { fetch: server(partsMap(), log), onBytes: (n) => seen.push(n) });
  assert.deepEqual(Buffer.from(await blob.arrayBuffer()), WHOLE);
  assert.deepEqual(log, [0, 1, 2].map((i) => F.partUrl(URL, i)));
  assert.equal(seen.reduce((a, b) => a + b, 0), 10000);
});

test("a changed part stops the download with hash, the next part is never fetched", async () => {
  const m = partsMap(), log = [];
  m[F.partUrl(URL, 1)] = Buffer.from(PARTS[1]).fill(1, 0, 1);
  await assert.rejects(F.get(FILE, { fetch: server(m, log) }), (e) => e.code === "hash");
  assert.equal(log.length, 2);
});

test("parts that do not join to the whole file's hash are refused", async () => {
  const bad = Object.assign({}, FILE, { sha: sha(Buffer.from("other")) });
  await assert.rejects(F.get(bad, { fetch: server(partsMap()) }), (e) => e.code === "hash");
});

test("a missing part is a download error; cancel stops", async () => {
  const m = partsMap();
  delete m[F.partUrl(URL, 2)];
  await assert.rejects(F.get(FILE, { fetch: server(m) }), (e) => e.code === "download");
  let n = 0;
  await assert.rejects(F.get(FILE, { fetch: server(partsMap()), cancelled: () => ++n > 1 }), (e) => e.code === "cancelled");
  await assert.rejects(F.get(FILE, { fetch: () => Promise.reject(new TypeError("offline")) }), (e) => e.code === "download");
});

test("one file: size and SHA-256 checked; a file without sha is taken as it is", async () => {
  const one = { url: URL, size: WHOLE.length, sha: sha(WHOLE) };
  const ok = await F.get(one, { fetch: server({ [URL]: WHOLE }) });
  assert.equal(ok.size, WHOLE.length);
  await assert.rejects(F.get(one, { fetch: server({ [URL]: WHOLE.subarray(1) }) }), (e) => e.code === "hash");
  const raw = await F.get({ url: URL }, { fetch: server({ [URL]: Buffer.from("js") }) });
  assert.equal(await raw.text(), "js");
});
