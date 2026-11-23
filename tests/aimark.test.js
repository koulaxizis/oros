// AI-MARK (EU AI Act art. 50(2)): pictures an AI makes or redraws in
// orOS carry a machine-readable mark (assistant/imgai.js markBytes):
// XMP with the IPTC digital source type in PNG, JPEG and WebP; the
// provider's own C2PA credentials are kept byte for byte. Also the
// wiring: run() marks, Atelier and Photo Lab mark their exports, Files
// shows the label, and the Assistant names every answer as an AI's.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.join(__dirname, "..");
const IA = require("../assistant/imgai.js");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const latin = (b) => Buffer.from(b).toString("latin1");

function crc(buf) {
  let c, t = [];
  for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  let x = 0xffffffff;
  for (const b of buf) x = t[(x ^ b) & 255] ^ (x >>> 8);
  return (x ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
}
function png(extra) {
  const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
  const idat = zlib.deflateSync(Buffer.from([0, 255, 0, 0, 255]));
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), ...(extra || []), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]));
}
// PNG chunks in order, with a CRC check
function pngChunks(b) {
  const B = Buffer.from(b), out = [];
  let p = 8;
  while (p < B.length) {
    const len = B.readUInt32BE(p), type = B.toString("latin1", p + 4, p + 8);
    assert.equal(B.readUInt32BE(p + 8 + len), crc(B.subarray(p + 4, p + 8 + len)), "CRC of " + type);
    out.push({ type, data: B.subarray(p + 8, p + 8 + len) });
    p += 12 + len;
  }
  return out;
}
function jpeg(segs) {
  return new Uint8Array(Buffer.concat([Buffer.from([0xff, 0xd8]), ...(segs || []),
    Buffer.from([0xff, 0xda, 0, 8, 1, 1, 0, 0, 0x3f, 0, 1, 2, 3, 0xff, 0xd9])]));
}
function seg(marker, body) { const l = body.length + 2; return Buffer.concat([Buffer.from([0xff, marker, l >> 8, l & 255]), body]); }
function riff(chunks) {
  const body = Buffer.concat(chunks.map(([id, d]) => {
    const h = Buffer.alloc(8); h.write(id, 0, "latin1"); h.writeUInt32LE(d.length, 4);
    return Buffer.concat([h, d, d.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]);
  }));
  const head = Buffer.alloc(12); head.write("RIFF", 0, "latin1"); head.writeUInt32LE(body.length + 4, 4); head.write("WEBP", 8, "latin1");
  return new Uint8Array(Buffer.concat([head, body]));
}
function webpChunks(b) {
  const B = Buffer.from(b), out = [];
  assert.equal(B.readUInt32LE(4), B.length - 8, "RIFF size");
  let p = 12;
  while (p < B.length) {
    const id = B.toString("latin1", p, p + 4), len = B.readUInt32LE(p + 4);
    out.push({ id, data: B.subarray(p + 8, p + 8 + len) });
    p += 8 + len + (len & 1);
  }
  return out;
}

test("the XMP packet: IPTC source type, tool, who made it, escaped", () => {
  const g = IA.xmpPacket({ src: "gen", tool: "orOS Atelier", by: "OpenAI <gpt-image-1> & co" });
  assert.match(g, /Iptc4xmpExt:DigitalSourceType="http:\/\/cv\.iptc\.org\/newscodes\/digitalsourcetype\/trainedAlgorithmicMedia"/);
  assert.match(g, /xmp:CreatorTool="orOS Atelier"/);
  assert.match(g, /Made with AI \(OpenAI &lt;gpt-image-1&gt; &amp; co\)/);
  assert.ok(g.startsWith("<?xpacket begin=\"﻿\""));
  const e = IA.xmpPacket({ src: "edit" });
  assert.match(e, /digitalsourcetype\/compositeWithTrainedAlgorithmicMedia"/);
  assert.match(e, /Contains parts made with AI</);
});

test("PNG: an iTXt XMP chunk right after IHDR; other chunks kept; an old XMP replaced", () => {
  const src = png([chunk("tEXt", Buffer.from("parameters\0a cat"))]);
  const r = IA.markBytes(src, { src: "gen", by: "AI Horde" });
  assert.equal(r.how, "xmp");
  const cs = pngChunks(r.bytes);
  assert.deepEqual(cs.map((c) => c.type), ["IHDR", "iTXt", "tEXt", "IDAT", "IEND"]);
  assert.equal(cs[1].data.toString("latin1", 0, 18), "XML:com.adobe.xmp\0");
  assert.ok(IA.isAIBytes(r.bytes));
  assert.ok(!IA.isAIBytes(src));
  // marked again: nothing changes
  assert.equal(IA.markBytes(r.bytes, { src: "edit" }).how, "has");
  // an XMP without the source type is replaced, not doubled
  const old = png([chunk("iTXt", Buffer.from("XML:com.adobe.xmp\0\0\0\0\0<x:xmpmeta/>"))]);
  const r2 = IA.markBytes(old, { src: "edit" });
  assert.deepEqual(pngChunks(r2.bytes).map((c) => c.type), ["IHDR", "iTXt", "IDAT", "IEND"]);
  assert.ok(IA.isAIBytes(r2.bytes));
});

test("PNG with the provider's C2PA (caBX) is kept byte for byte", () => {
  const src = png([chunk("caBX", Buffer.from("jumb c2pa manifest"))]);
  const r = IA.markBytes(src, { src: "gen" });
  assert.equal(r.how, "c2pa");
  assert.equal(r.bytes, src);
});

test("JPEG: an APP1 XMP after JFIF / EXIF, image data untouched; C2PA (APP11) kept", () => {
  const app0 = seg(0xe0, Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0", "latin1"));
  const exif = seg(0xe1, Buffer.from("Exif\0\0MM", "latin1"));
  const dqt = seg(0xdb, Buffer.alloc(65, 1));
  const src = jpeg([app0, exif, dqt]);
  const r = IA.markBytes(src, { src: "edit" });
  assert.equal(r.how, "xmp");
  const B = Buffer.from(r.bytes);
  const at = B.indexOf(Buffer.from("http://ns.adobe.com/xap/1.0/\0", "latin1"));
  assert.ok(at > 0);
  assert.equal(B[at - 4], 0xff); assert.equal(B[at - 3], 0xe1);
  assert.ok(at > B.indexOf(Buffer.from("Exif")), "after EXIF");
  assert.ok(at < B.indexOf(Buffer.from([0xff, 0xdb])), "before DQT");
  assert.deepEqual([...B.subarray(B.length - 15)], [...Buffer.from(src).subarray(src.length - 15)]);
  assert.ok(IA.isAIBytes(r.bytes));
  const c2 = jpeg([app0, seg(0xeb, Buffer.from("JP\0\0\0\0\0\x01jumbc2pa", "latin1")), dqt]);
  const rc = IA.markBytes(c2, { src: "gen" });
  assert.equal(rc.how, "c2pa");
  assert.equal(rc.bytes, c2);
});

test("WebP: a simple VP8L gets a VP8X with the XMP flag and an XMP chunk", () => {
  // VP8L header: 0x2f, then width-1 (14 bits), height-1 (14), alpha (1), version (3)
  const w = 300, h = 200, bits = (w - 1) | ((h - 1) << 14) | (1 << 28);
  const vp8l = Buffer.alloc(9); vp8l[0] = 0x2f; vp8l.writeUInt32LE(bits >>> 0, 1);
  const r = IA.markBytes(riff([["VP8L", vp8l]]), { src: "gen" });
  assert.equal(r.how, "xmp");
  const cs = webpChunks(r.bytes);
  assert.deepEqual(cs.map((c) => c.id), ["VP8X", "VP8L", "XMP "]);
  const x = cs[0].data;
  assert.equal(x[0] & 0x04, 0x04, "XMP flag");
  assert.equal(x[0] & 0x10, 0x10, "alpha flag");
  assert.equal(x.readUIntLE(4, 3) + 1, w);
  assert.equal(x.readUIntLE(7, 3) + 1, h);
  assert.ok(IA.isAIBytes(r.bytes));
  // a lossy VP8: size from its frame header
  const vp8 = Buffer.alloc(10); vp8.set([0, 0, 0, 0x9d, 0x01, 0x2a]); vp8.writeUInt16LE(640, 6); vp8.writeUInt16LE(480, 8);
  const r2 = IA.markBytes(riff([["VP8 ", vp8]]), { src: "gen" });
  const x2 = webpChunks(r2.bytes)[0].data;
  assert.equal(x2.readUIntLE(4, 3) + 1, 640);
  assert.equal(x2.readUIntLE(7, 3) + 1, 480);
  // an existing VP8X only gets its flag; C2PA chunk kept as it is
  const vx = Buffer.alloc(10); vx.writeUIntLE(99, 4, 3); vx.writeUIntLE(99, 7, 3);
  const r3 = IA.markBytes(riff([["VP8X", vx], ["VP8L", vp8l]]), { src: "edit" });
  assert.deepEqual(webpChunks(r3.bytes).map((c) => c.id), ["VP8X", "VP8L", "XMP "]);
  const withC2 = riff([["VP8X", vx], ["VP8L", vp8l], ["C2PA", Buffer.from("c2pa")]]);
  assert.equal(IA.markBytes(withC2, { src: "gen" }).how, "c2pa");
});

test("other kinds and broken files are left as they are", () => {
  const gif = new Uint8Array(Buffer.from("GIF89a\x01\0\x01\0\0\0\0;", "latin1"));
  assert.equal(IA.markBytes(gif, { src: "gen" }).how, "");
  const cut = png().subarray(0, 30);
  const r = IA.markBytes(cut, { src: "gen" });
  assert.equal(r.how, "");
  assert.equal(r.bytes, cut);
});

test("run() marks generate / edit / expand pictures, not upscale or test", async () => {
  const pic = png();
  const fetchOk = () => Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob([pic], { type: "image/png" })) });
  const saved = global.fetch;
  global.fetch = fetchOk;
  try {
    const cf = IA.conf({ prov: "stability" });
    const req = IA.buildGenerate(cf, "k", { prompt: "a cat", w: 1, h: 1 });
    assert.equal(req.mark, "gen");
    assert.match(req.by, /Stability AI/);
    const [b] = await IA.run(req);
    const bytes = new Uint8Array(await b.arrayBuffer());
    assert.ok(IA.isAIBytes(bytes));
    assert.match(latin(bytes), /trainedAlgorithmicMedia/);
    const ed = IA.buildEdit(cf, "k", { prompt: "x", image: new Blob([pic]), mask: new Blob([pic]), maskBw: new Blob([pic]) });
    assert.equal(ed.mark, "edit");
    const [b2] = await IA.run(ed);
    assert.match(latin(new Uint8Array(await b2.arrayBuffer())), /compositeWithTrainedAlgorithmicMedia/);
    assert.equal(IA.buildExpand(cf, "k", { original: new Blob([pic]), pad: { left: 10 } }).mark, "edit");
    assert.equal(IA.buildUpscale(IA.conf({ prov: "sdwebui" }), { b64: "x", f: 2 }).mark, undefined);
    assert.equal((IA.buildTest(cf, "k") || {}).mark, undefined);
  } finally { global.fetch = saved; }
});

test("wiring: Atelier and Photo Lab keep the AI flag and mark exports; Files shows it", () => {
  const ax = read("atelier/ax.js");
  assert.match(ax, /k === "photo" && \(a\.ai === "g" \|\| a\.ai === "e"\)\) o\.ai = a\.ai/);
  assert.match(read("atelier/imagine.js"), /ai: "g"/);
  const mg = read("atelier/magicai.js");
  assert.equal((mg.match(/x\.ax\.ai = x\.ax\.ai === "g" \? "g" : "e"/g) || []).length, 2);
  const aio = read("atelier/io.js");
  assert.match(aio, /function aiMark\(doc, pages, blob\)/);
  assert.ok((aio.match(/aiMark\(doc, /g) || []).length >= 4, "every image export marks");
  const core = read("photolab/core.js");
  assert.match(core, /k === "raster" && \(raw\.ai === "g" \|\| raw\.ai === "e"\)\) L\.ai = raw\.ai/);
  const pa = read("photolab/aiedit.js");
  assert.match(pa, /addPixels\(cv, x, y, s\.title \|\| t\("ai\.layerGen"\), t\("ai\.stepGen"\), false, "g"\)/);
  const pio = read("photolab/io.js");
  assert.match(pio, /function aiMark\(blob\)/);
  assert.match(pio, /render\(fmt, q, scale\)\.then\(aiMark\)/);
  const files = read("files/files.js");
  assert.match(files, /"pv\.ai":/);
  assert.match(files, /function looksAI\(/);
});

test("Assistant: who answers is named as an AI, each answer too; free plans warn about training", () => {
  const a = read("assistant/assistant.js");
  assert.match(a, /"who\.ai": "AI answers"/);
  assert.match(a, /"who\.ai": "Απαντά AI"/);
  assert.match(a, /el\("span", "who-ai", t\("who\.ai"\)\)/);
  assert.match(a, /el\("span", "msg-ai", mdl \? t\("msg\.ai", \{ model: mdl \}\) : t\("msg\.aiNoModel"\)\)/);
  assert.match(a, /if \(TRAIN_PROVS\[pid\] \|\| P\.free\) provBox\.appendChild\(el\("p", "dlg-hint train-note", t\("set\.trainFree"/);
  const de = read("i18n/de/assistant.js");
  ["who.ai", "who.aiTip", "msg.ai", "msg.aiNoModel", "set.trainFree"].forEach((k) => assert.ok(de.includes('"' + k + '"'), k));
});

test("Atelier PDF and SVG: the same XMP as document metadata and as SVG <metadata>", () => {
  const aio = read("atelier/io.js");
  const grab = (name) => {
    const i = aio.indexOf("  function " + name + "(");
    assert.ok(i >= 0, name);
    const j = aio.indexOf("\n  }\n", i);
    return aio.slice(i, j + 4);
  };
  const src = "var AI_INFO = { src: \"edit\", tool: \"orOS Atelier\" };\n" + grab("aiIn") + grab("aiMarkPdf") + grab("aiMarkSvg") +
    "\nreturn { aiIn: aiIn, aiMarkPdf: aiMarkPdf, aiMarkSvg: aiMarkSvg };";
  const api = new Function("window", src)({ OrosImageAI: IA });
  const doc = { items: [{ id: "a", pg: "p1", ax: { ai: "g" } }, { id: "b", pg: "p2" }, { id: "c", pg: "p3", ax: { ai: "e" }, hide: true }] };
  assert.equal(api.aiIn(doc, ["p1"]), true);
  assert.equal(api.aiIn(doc, [{ id: "p1" }]), true);
  assert.equal(api.aiIn(doc, ["p2", "p3"]), false, "a hidden AI item does not count");
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10"><rect/></svg>';
  const marked = api.aiMarkSvg(doc, ["p1"], svg);
  assert.match(marked, /^<svg [^>]*><metadata><x:xmpmeta [^]*compositeWithTrainedAlgorithmicMedia[^]*<\/x:xmpmeta><\/metadata><rect\/><\/svg>$/);
  assert.doesNotMatch(marked, /xpacket/);
  assert.equal(api.aiMarkSvg(doc, ["p2"], svg), svg);
  let meta = null;
  const pdf = { addMetadata(x, raw) { meta = [x, raw]; return this; } };
  assert.equal(api.aiMarkPdf(doc, ["p1"], pdf), pdf);
  assert.equal(meta[1], true, "raw XMP, not wrapped by jsPDF");
  assert.match(meta[0], /Iptc4xmpExt:DigitalSourceType="http:\/\/cv\.iptc\.org\/newscodes\/digitalsourcetype\/compositeWithTrainedAlgorithmicMedia"/);
  meta = null; api.aiMarkPdf(doc, ["p2"], pdf);
  assert.equal(meta, null);
  assert.match(aio, /return aiMarkPdf\(doc, ids, pdf\)\.output\("blob"\)/);
  assert.match(aio, /r\.svg = aiMarkSvg\(doc, \[pg\], r\.svg\)/);
});
