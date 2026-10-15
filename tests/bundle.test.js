// The open orOS file format (bundle.js, docs/oros-bundle.md): writing,
// reading back without loss, unzipped folders, and the checks that keep
// a hostile file from hurting the device.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const B = require(path.join(ROOT, "bundle.js"));
const Z = require(path.join(ROOT, "atelier", "zip.js"));

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82, 1, 2, 3, 4]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 5, 6, 7, 8, 9]);

async function sample(extra) {
  const pngKey = (await B.sha256(PNG)) + ".png";
  const opts = Object.assign({
    mime: "application/x-oros-design", app: "atelier", schema: "atelier/1",
    content: { kind: "oros-atelier-package", ver: 1, doc: { id: "d1", t: "Αφίσα <1> & \"2\"", img: pngKey } },
    meta: { title: "Αφίσα <1> & \"2\"", creator: "Chris", language: "el", subjects: ["work", "Ελλάδα"], created: Date.UTC(2026, 9, 1), modified: Date.UTC(2026, 9, 15), id: "d1" },
    media: { [pngKey]: PNG },
    thumbnail: PNG,
    preview: [{ name: "page-1.png", data: PNG }, { name: "outline.md", data: "# Αφίσα\n" }],
    settings: { zoom: 2 }
  }, extra || {});
  return { opts, pngKey, bytes: await B.write(opts) };
}

// Rebuild a zip from {name: bytes} in the given order (to make bad files).
function rezip(files) {
  return Z.write(Object.keys(files).map((n) => ({ name: n, data: files[n] })));
}
async function unzipAll(bytes) {
  const z = Z.open(bytes), o = {};
  for (const n of z.names) o[n] = await z.bytes(n);
  return o;
}

test("write → read gives the same project back", async () => {
  const { opts, pngKey, bytes } = await sample();
  assert.equal(B.sniff(bytes.subarray(0, 128)), "application/x-oros-design");
  const r = await B.read(bytes, { mime: "application/x-oros-design" });
  assert.deepEqual(r.content, opts.content);
  assert.equal(r.app, "atelier");
  assert.equal(r.schema, "atelier/1");
  assert.equal(r.version, "1.0");
  assert.equal(r.meta.title, opts.meta.title);
  assert.equal(r.meta.creator, "Chris");
  assert.deepEqual(r.meta.subjects, ["work", "Ελλάδα"]);
  assert.equal(r.meta.created, "2026-10-01T00:00:00Z");
  assert.equal(r.meta.modified, "2026-10-15T00:00:00Z");
  assert.deepEqual(Array.from(r.media[pngKey].bytes), Array.from(PNG));
  assert.equal(r.media[pngKey].type, "image/png");
  assert.deepEqual(r.settings, { zoom: 2 });
  assert.ok(r.thumbnail);
  assert.deepEqual(r.changed, []);
  assert.deepEqual(r.missing, []);
});

test("layout of the file: mimetype first and stored, manifest lists every file with its hash", async () => {
  const { bytes } = await sample();
  const z = Z.open(bytes);
  assert.equal(z.names[0], "mimetype");
  assert.equal(new TextDecoder().decode(await z.bytes("mimetype")), "application/x-oros-design");
  ["META-INF/manifest.xml", "meta.xml", "content.json", "settings.json", "preview/thumbnail.png", "preview/page-1.png", "preview/outline.md", "README.txt"]
    .forEach((n) => assert.ok(z.has(n), n));
  const mf = new TextDecoder().decode(await z.bytes("META-INF/manifest.xml"));
  const parsed = B._parseManifest(mf);
  for (const n of z.names) {
    if (n === "mimetype" || n === "META-INF/manifest.xml") continue;
    assert.ok(parsed.files[n], "listed: " + n);
    assert.equal(parsed.files[n].sha256, await B.sha256(await z.bytes(n)), n);
  }
  // readable by hand: pretty JSON, plain XML
  assert.match(new TextDecoder().decode(await z.bytes("content.json")), /\n "kind"/);
  assert.match(new TextDecoder().decode(await z.bytes("meta.xml")), /<dc:title>Αφίσα &lt;1&gt; &amp; &quot;2&quot;<\/dc:title>/);
});

test("the same input gives the same bytes", async () => {
  const a = (await sample()).bytes, b = (await sample()).bytes;
  assert.deepEqual(Buffer.from(a), Buffer.from(b));
});

test("an unzipped folder opens like the zip, from any parent folder", async () => {
  const { opts, bytes } = await sample();
  const files = await unzipAll(bytes);
  const list = Object.keys(files).map((n) => ({ path: "Downloads/Αφίσα/" + n, bytes: files[n] }));
  list.push({ path: "Downloads/other.txt", bytes: new Uint8Array([1]) });
  list.push({ path: "Downloads/Αφίσα/.DS_Store", bytes: new Uint8Array([1]) });
  const r = await B.readFolder(list);
  assert.deepEqual(r.content, opts.content);
  assert.deepEqual(r.changed, []);
});

test("a picture replaced in the folder gets its real hash, and the project follows it", async () => {
  const { pngKey, bytes } = await sample();
  const files = await unzipAll(bytes);
  files["media/" + pngKey] = new Uint8Array([...PNG, 9, 9]);
  const r = await B.readFolder(Object.keys(files).map((n) => ({ path: n, bytes: files[n] })));
  const newKey = (await B.sha256(files["media/" + pngKey])) + ".png";
  assert.equal(r.rekeyed[pngKey], newKey);
  assert.equal(r.content.doc.img, newKey);
  assert.ok(r.media[newKey]);
  assert.ok(r.changed.includes("media/" + pngKey));
});

test("content edited by hand opens, and is reported as changed", async () => {
  const { bytes } = await sample();
  const files = await unzipAll(bytes);
  const c = JSON.parse(new TextDecoder().decode(files["content.json"]));
  c.doc.t = "Νέος τίτλος";
  files["content.json"] = new TextEncoder().encode(JSON.stringify(c));
  const r = await B.readFolder(Object.keys(files).map((n) => ({ path: n, bytes: files[n] })));
  assert.equal(r.content.doc.t, "Νέος τίτλος");
  assert.deepEqual(r.changed, ["content.json"]);
});

test("refused: not a bundle, wrong type, newer major version", async () => {
  const { bytes } = await sample();
  await assert.rejects(B.read(new TextEncoder().encode("{\"a\":1}")), { code: "notzip" });
  await assert.rejects(B.read(rezip({ "word/document.xml": "<x/>" })), { code: "notbundle" });
  await assert.rejects(B.read(bytes, { mime: "application/x-oros-doc" }), { code: "wrongtype" });
  const files = await unzipAll(bytes);
  // mimetype not first → not a bundle (tools could not tell its type)
  const moved = Object.assign({}, files); delete moved.mimetype; moved.mimetype = files.mimetype;
  await assert.rejects(B.read(rezip(moved)), { code: "notbundle" });
  const mf = new TextDecoder().decode(files["META-INF/manifest.xml"]).replace(' version="1.0" app', ' version="2.0" app');
  await assert.rejects(B.read(rezip(Object.assign({}, files, { "META-INF/manifest.xml": mf }))), { code: "newer" });
  // a minor version above ours still opens
  const mf2 = new TextDecoder().decode(files["META-INF/manifest.xml"]).replace(' version="1.0" app', ' version="1.7" app');
  assert.ok(await B.read(rezip(Object.assign({}, files, { "META-INF/manifest.xml": mf2 }))));
});

test("refused: bad paths, DOCTYPE and entities, encrypted entries", async () => {
  const { bytes } = await sample();
  const files = await unzipAll(bytes);
  for (const p of ["../evil.txt", "/etc/passwd", "media/..\\x", "a//b", "media/./x", "C:/x", "media/\u0001x", "ελληνικά.txt"]) {
    await assert.rejects(B.read(rezip(Object.assign({}, files, { [p]: "x" }))), { code: "path" }, p);
  }
  for (const evil of ['<?xml version="1.0"?><!DOCTYPE m [<!ENTITY a "aaaa">]><manifest version="1.0"/>',
    '<manifest version="1.0"><![CDATA[x]]></manifest>', '<manifest version="1.0"><?php x ?></manifest>']) {
    await assert.rejects(B.read(rezip(Object.assign({}, files, { "META-INF/manifest.xml": evil }))), { code: "xml" });
  }
  const meta = '<!DOCTYPE x SYSTEM "file:///etc/passwd"><meta/>';
  await assert.rejects(B.read(rezip(Object.assign({}, files, { "meta.xml": meta }))), { code: "xml" });
  // set the "encrypted" flag on the first central directory entry
  const z = rezip(files);
  const e = Buffer.from(z);
  const cd = e.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), e.length);
  const first = e.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  assert.ok(cd > 0);
  e[first + 8] |= 1;
  await assert.rejects(B.read(new Uint8Array(e)), { code: "encrypted" });
});

test("refused: zip bombs (declared size, real size, ratio, totals)", async () => {
  const { bytes } = await sample();
  const files = await unzipAll(bytes);
  // 50 MB of zeros deflates to ~50 KB: the ratio cap stops it before inflating
  const big = new Uint8Array(50 * 1024 * 1024);
  const z = await B._zip(Object.keys(files).map((n) => ({ name: n, data: files[n] })).concat([{ name: "media/zeros.bin", data: big, deflate: true }]));
  await assert.rejects(B.read(z, { limits: { ratio: 100 } }), { code: "ratio" });
  await assert.rejects(B.read(z, { limits: { total: 1024 * 1024, ratio: 4000 } }), { code: "toobig" });
  await assert.rejects(B.read(z, { limits: { entry: 1024 * 1024, ratio: 4000 } }), { code: "toobig" });
  // a header that lies about the size: inflating stops at what it declared
  const buf = Buffer.from(z);
  let cd = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  while (cd >= 0) {
    const nlen = buf.readUInt16LE(cd + 28), xl = buf.readUInt16LE(cd + 30), cl = buf.readUInt16LE(cd + 32);
    if (buf.toString("utf8", cd + 46, cd + 46 + nlen) === "media/zeros.bin") buf.writeUInt32LE(1000, cd + 24);
    cd = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), cd + 46 + nlen + xl + cl);
  }
  await assert.rejects(B.read(new Uint8Array(buf), { limits: { ratio: 4000 } }), { code: "toobig" });
  // too many entries
  const many = {}; many.mimetype = files.mimetype; many["content.json"] = files["content.json"];
  for (let i = 0; i < 40; i++) many["media/f" + i] = "x";
  await assert.rejects(B.read(rezip(many), { limits: { entries: 20 } }), { code: "toomany" });
});

test("media types come from the bytes, not the name", async () => {
  const k = (await B.sha256(JPG)) + ".png";
  const { bytes } = await sample({ media: { [k]: JPG }, content: { a: 1 } });
  const r = await B.read(bytes);
  assert.equal(r.media[k].type, "image/jpeg");
  assert.equal(B.typeOf(new TextEncoder().encode("<svg onload=alert(1)>")), "");
});

test("write refuses bad media keys and types", async () => {
  await assert.rejects(B.write({ mime: "application/x-oros-doc", app: "writer", content: {}, media: { "../x": PNG } }), { code: "key" });
  await assert.rejects(B.write({ mime: "application/zip", app: "writer", content: {} }), { code: "mime" });
});

test("extension table matches fileopen.js and the manifest", () => {
  const F = require(path.join(ROOT, "fileopen.js"));
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.webmanifest"), "utf8"));
  Object.keys(B.TYPES).forEach((ext) => {
    const t = B.TYPES[ext];
    const h = m.file_handlers.find((x) => x.action === "/?file-open=" + t.app);
    assert.ok(h && h.accept[t.mime] && h.accept[t.mime].includes(ext), ext);
    assert.ok(F.shareTarget().params.files[0].accept.includes(ext), ext + " in share_target");
    assert.equal(B.typeOfExt("My file" + ext.toUpperCase()).app, t.app);
  });
});
