// A tiny zip writer for the tests (stored and deflated entries, no
// ZIP64): builds a .vsdx from the folder tests/fixtures/vsdx.
"use strict";
const zlib = require("node:zlib");
const fs = require("node:fs");
const path = require("node:path");

function zip(files) {
  const locals = [], central = [];
  let off = 0;
  files.forEach(({ name, data, deflate }) => {
    const raw = Buffer.from(data), body = deflate ? zlib.deflateRawSync(raw) : raw, nm = Buffer.from(name, "utf8"), crc = zlib.crc32(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(deflate ? 8 : 0, 8);
    lh.writeUInt32LE(crc >>> 0, 14); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nm.length, 26);
    locals.push(lh, nm, body);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(deflate ? 8 : 0, 10);
    ch.writeUInt32LE(crc >>> 0, 16); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nm.length, 28);
    ch.writeUInt32LE(off, 42);
    central.push(ch, nm);
    off += 30 + nm.length + body.length;
  });
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat(locals.concat([cd, end]));
}
// every file under dir, the pages deflated, the rest stored
function folder(dir) {
  const out = [];
  (function walk(d) {
    fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push({ name: path.relative(dir, p).split(path.sep).join("/"), data: fs.readFileSync(p), deflate: /pages\//.test(p) });
    });
  })(dir);
  return out.sort((a, b) => (a.name < b.name ? -1 : 1));
}
module.exports = { zip, folder };
