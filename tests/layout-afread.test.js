// Layout: reading an Affinity file (.af) for a rebuild (LY-AF).
// The fixture is synthetic: a small file with the same container
// (header, file tables, stored and zstd files, two copies of the
// document) built here; no real document is in the repo.
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const zlib = require("node:zlib");
const AF = require("../layout/afread.js");
const fzstd = require("../vendor/fzstd/fzstd.umd.js");

function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; }
function u64(n) { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; }
function str(tag, s) { const v = Buffer.from(s, "utf8"); return Buffer.concat([Buffer.from("+" + tag.split("").reverse().join(""), "latin1"), u32(v.length), v]); }
function doc(parts) { return Buffer.concat([Buffer.from([0x00, 0xff, 0x4b, 0x53, 0x02, 0x00])].concat(parts)); }
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 7)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(30, 3)]);

// files: [{ id, name, body (Buffer, stored) | z (Buffer, zstd) }] per table, oldest table first
function build(tables) {
  const out = [Buffer.from([0x00, 0xff, 0x4b, 0x41]), u32(12), Buffer.from("nsrP#Inf", "latin1"), u64(0)];
  let len = 24, prev = 0, head = 0;
  const push = (b) => { out.push(b); len += b.length; };
  tables.forEach((files) => {
    const ents = files.map((f) => {
      const off = len;
      let size, cs;
      if (f.z) {
        const c = zlib.zstdCompressSync(f.z);
        push(Buffer.concat([Buffer.from("#Fil", "latin1"), c, Buffer.from([0xff, 0xff, 0xff, 0xff])]));
        size = f.z.length; cs = c.length;
      } else {
        const blk = Buffer.concat([Buffer.from([0x00, 0xff, 0x4b, 0x53, 0x02, 0x00]), Buffer.from("kclB", "latin1"), Buffer.from([1, 0]), u32(32), Buffer.from("-ataD", "latin1"), u32(f.body.length), f.body]);
        push(Buffer.concat([Buffer.from("#Fil", "latin1"), blk, Buffer.from([0xff, 0xff, 0xff, 0xff])]));
        size = cs = blk.length;
      }
      const nm = Buffer.from(f.name, "latin1");
      return Buffer.concat([u32(f.id), Buffer.from([0]), u64(off), u64(size), u64(cs), u32(0x1234), u32(0), Buffer.from([0]), u32(0), Buffer.from([nm.length, 0]), nm]);
    });
    const p = len, body = Buffer.concat([Buffer.alloc(16)].concat(ents));
    const t = Buffer.concat([Buffer.from("#FT4", "latin1"), u64(prev), u32(1), u32(0), u64(p + 28 + body.length), body]);
    push(t);
    prev = p; head = p;
  });
  const all = Buffer.concat(out);
  all.writeBigUInt64LE(BigInt(head), 16);
  return new Uint8Array(all);
}

const OLD = doc([str("Utf8", "An old draft\u2029"), str("Famy", "Old Face")]);
const NEW = doc([
  str("Name", "someone@example.org"),
  str("Utf8", "First para\u00adgraph of the story\u2029Second one\u2029"),
  str("Famy", "Synthetic Serif"), str("Post", "SyntheticSerif-Bold"), str("Famy", "Synthetic Serif"),
  str("Name", "Body copy"), str("Foll", "Body copy"),
  str("Name", "Heading"), str("Next", "Body copy"),
  str("Name", "Pull quote"), str("Base", "Body copy"),
  str("Filn", "C:\\Work\\Pictures\\linked photo.jpg"), str("IRFN", "linked photo.jpg")
]);

test("reads the newest document, its pictures and names, never a data tile", () => {
  const af = build([
    [{ id: 1, name: "", z: OLD }, { id: 2, name: "c/1", body: PNG }, { id: 3, name: "d/1c1", z: Buffer.alloc(65536) }],
    [{ id: 1, name: "", z: NEW }, { id: 4, name: "c/2", body: JPG }]
  ]);
  const r = AF.read(af, { zstd: fzstd });
  assert.deepStrictEqual(r.problems, []);
  assert.strictEqual(r.files, 4);
  assert.ok(r.text.join("").indexOf("Second one") !== -1);
  assert.ok(r.text.join("").indexOf("old draft") === -1, "the older copy of the document is history");
  assert.deepStrictEqual(r.fonts, ["Synthetic Serif"]);
  assert.deepStrictEqual(r.styles, ["Body copy", "Heading", "Pull quote"]);
  assert.deepStrictEqual(r.pictures.map((p) => [p.type, p.bytes.length]).sort(), [["image/jpeg", JPG.length], ["image/png", PNG.length]]);
  assert.deepStrictEqual(Buffer.from(r.pictures.find((p) => p.type === "image/png").bytes), PNG);
});

test("not an Affinity file, no zstd, a broken document", () => {
  assert.strictEqual(AF.read(new Uint8Array(Buffer.from("%PDF-1.7 not an af file at all")), { zstd: fzstd }), null);
  const af = build([[{ id: 1, name: "", z: NEW }, { id: 2, name: "c/1", body: PNG }]]);
  const noZ = AF.read(af, {});
  assert.deepStrictEqual(noZ.problems, ["zstd"]);
  assert.strictEqual(noZ.pictures.length, 1, "stored pictures need no zstd");
  // the document's frame damaged: its pictures still come
  const bad = Buffer.from(af);
  const at = bad.indexOf(Buffer.from([0x28, 0xb5, 0x2f, 0xfd]));
  bad.fill(0x55, at + 12, at + 40);
  const r = AF.read(new Uint8Array(bad), { zstd: fzstd });
  assert.deepStrictEqual(r.problems, ["doc"]);
  assert.strictEqual(r.pictures.length, 1);
});

test("a table that points outside the file or loops is not followed", () => {
  const af = Buffer.from(build([[{ id: 1, name: "", z: NEW }]]));
  const head = Number(af.readBigUInt64LE(16));
  af.writeBigUInt64LE(BigInt(head), head + 4); // prev = itself
  const r = AF.read(new Uint8Array(af), { zstd: fzstd });
  assert.deepStrictEqual(r.problems, []);
  af.writeBigUInt64LE(BigInt(af.length + 100), 16);
  const r2 = AF.read(new Uint8Array(af), { zstd: fzstd });
  assert.deepStrictEqual(r2.problems, ["doc"]);
  assert.strictEqual(r2.files, 0);
});

test("strings: tags are read backwards and bad UTF-8 is skipped", () => {
  const d = doc([str("Utf8", "ok"), Buffer.from("+8ftU", "latin1"), u32(2), Buffer.from([0xc3, 0x28]), str("Famy", "F")]);
  assert.deepStrictEqual(AF.strings(new Uint8Array(d)).map((x) => x.tag + ":" + x.s), ["Utf8:ok", "Famy:F"]);
});
