// "Send to someone" links that arrive damaged (BR-SHARE-CUT, 2026-11-16):
// a song link opened on a friend's phone (Firefox for Android) showed
// "This link is damaged or incomplete" while it opened for the sender.
// The receiving page now (1) reads the code out of a hash that a chat
// app percent-encoded, wrapped or followed with punctuation, (2) inflates
// with a plain-JS inflate when the browser's DecompressionStream is
// missing or refuses the bytes, and (3) says "cut" when the link lost
// its end on the way, instead of the general "damaged".
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.join(__dirname, "..");
const K = require(path.join(ROOT, "share/kinds.js"));

function b64u(bytes) {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const SONG = {
  t: "Μια μέρα θα φύγω", a: "Some Artist", s: "jm", al: "An album name here", y: "2021", d: 241,
  u: "https://prod-1.storage.jamendo.com/?trackid=1234567&format=mp31&from=abcdefghijklmn%3D%3D%7Cxyz",
  pg: "https://www.jamendo.com/track/1234567/mia-mera",
  art: "https://usercontent.jamendo.com?type=album&id=123456&width=300&trackid=1234567",
  k: "jm:1234567", li: "by-nc-sa 3.0",
  cr: "\"Μια μέρα θα φύγω\" by Some Artist, licensed under CC BY-NC-SA 3.0 (jamendo.com)"
};
async function songCode() {
  const env = K.pack("track", SONG);
  return { env, code: await K.encode(env) };
}
// Runs fn with the browser's DecompressionStream gone (old browsers,
// or an engine whose stream refuses the bytes).
async function withoutStreams(fn) {
  const D = globalThis.DecompressionStream;
  delete globalThis.DecompressionStream;
  try { return await fn(); } finally { globalThis.DecompressionStream = D; }
}

test("plain-JS inflate matches zlib on stored, fixed and dynamic blocks", () => {
  const inputs = [
    Buffer.alloc(0),
    Buffer.from("a"),
    Buffer.from(JSON.stringify({ v: 1, k: "track", d: SONG })),
    Buffer.from("Καλημέρα κόσμε. ".repeat(4000)),
    require("crypto").randomBytes(70000),                     // incompressible: stored blocks
    Buffer.from(Array.from({ length: 50000 }, (_, i) => (i * 7919) % 251))
  ];
  for (const raw of inputs) {
    for (const opts of [{ level: 0 }, { level: 1 }, { level: 9 }, { strategy: zlib.constants.Z_FIXED }, { strategy: zlib.constants.Z_HUFFMAN_ONLY }]) {
      const z = zlib.deflateRawSync(raw, opts);
      const out = K.inflateJs(new Uint8Array(z), 1 << 20);
      assert.ok(Buffer.from(out).equals(raw), "round trip " + raw.length + " " + JSON.stringify(opts));
    }
  }
});

test("plain-JS inflate: a cut stream says cut, a bomb says big, garbage never throws anything else", () => {
  const raw = Buffer.from(JSON.stringify({ v: 1, k: "track", d: SONG }));
  const z = new Uint8Array(zlib.deflateRawSync(raw, { level: 9 }));
  for (let n = 0; n < z.length; n++) {
    assert.throws(() => K.inflateJs(z.subarray(0, n), 1 << 20), /^Error: cut$/, "prefix " + n);
  }
  const bomb = new Uint8Array(zlib.deflateRawSync(Buffer.alloc(K.MAX_JSON * 2, 97)));
  assert.throws(() => K.inflateJs(bomb, K.MAX_JSON), /^Error: big$/);
  assert.throws(() => K.inflateJs(new Uint8Array([0x07]), 1 << 20), /^Error: bad$/);   // block type 3
  for (let i = 0; i < 300; i++) {
    const junk = require("crypto").randomBytes(1 + (i % 40));
    try { assert.ok(K.inflateJs(new Uint8Array(junk), 1 << 16) instanceof Uint8Array); } catch (e) {
      assert.match(String(e), /^Error: (bad|cut|big)$/);            // never anything else
    }
  }
});

test("a song link cut anywhere on its way says cut, never opens something else", async () => {
  const { code } = await songCode();
  assert.ok(code.length > 300, "a Jamendo song link is long (" + code.length + ")");
  for (let n = 3; n < code.length; n += 7) {
    assert.deepEqual(await K.decode(code.slice(0, n)), { error: "cut" }, "cut at " + n);
  }
  assert.deepEqual(await K.decode(code.slice(0, -1)), { error: "cut" });
});

test("without DecompressionStream the page still opens a link (and still spots a cut one)", async () => {
  const { env, code } = await songCode();
  await withoutStreams(async () => {
    assert.deepEqual(await K.decode(code), { env });
    assert.deepEqual(await K.decode(code.slice(0, 200)), { error: "cut" });
    const bomb = new Uint8Array(zlib.deflateRawSync(Buffer.from(JSON.stringify({ v: 1, k: "note", d: { t: "x", x: "a".repeat(K.MAX_JSON * 2) } }))));
    assert.deepEqual(await K.decode("1." + b64u(bomb)), { error: "big" });
  });
});

test("bytes after the end of the stream (refused by some engines) do not stop a link", async () => {
  const { env, code } = await songCode();
  const z = Buffer.from(code.slice(2).replace(/-/g, "+").replace(/_/g, "/"), "base64");
  const extra = "1." + b64u(Buffer.concat([z, Buffer.from([0, 1, 2, 3])]));
  assert.deepEqual(await K.decode(extra), { env });
});

test("the code is read out of a hash a chat app changed on the way", async () => {
  const { env, code } = await songCode();
  const mid = 120;
  const shapes = [
    "#" + code,
    code,
    "#" + code + ".",
    "#" + code + ")",
    "#" + code + "%20",
    "#" + code + "%0A",
    "#" + code + "»",
    "#" + code + "%E2%80%9D",                                  // a closing quote, encoded
    "#" + code.slice(0, mid) + "%0A" + code.slice(mid),          // a line break where the link wrapped
    "#" + code.slice(0, mid) + "%C2%AD" + code.slice(mid),       // a soft hyphen
    "#" + code.slice(0, mid) + "%E2%80%8B" + code.slice(mid),    // a zero-width space
    "#" + code.slice(0, mid) + " " + code.slice(mid),
    "#" + encodeURIComponent(code),
    "#" + code + "%"                                             // a stray "%"
  ];
  for (const h of shapes) {
    const c = K.codeFromHash(h);
    assert.equal(c, code, JSON.stringify(h.slice(-12)));
    assert.deepEqual(await K.decode(c), { env });
  }
  assert.equal(K.codeFromHash("#c=" + code), "");
  assert.equal(K.codeFromHash("#r1.abc.def"), "");
  assert.equal(K.codeFromHash(""), "");
  assert.equal(K.codeFromHash("#1."), "");
});

test("the share page shows the cut message with how much arrived, in every language", () => {
  const fs = require("fs");
  const v = fs.readFileSync(path.join(ROOT, "share/view.js"), "utf8");
  assert.match(v, /r\.error === "cut"/);
  assert.equal((v.match(/cutLink: "/g) || []).length, 2, "EN + EL");
  assert.equal((v.match(/cutLinkInfo: "[^"]*\{n\}[^"]*\{e\}/g) || []).length, 2);
  const de = fs.readFileSync(path.join(ROOT, "i18n/de/share.js"), "utf8");
  assert.match(de, /"cutLink": "/);
  assert.match(de, /"cutLinkInfo": "[^"]*\{n\}[^"]*\{e\}/);
});
