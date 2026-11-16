// Studio wave A2: studio/flac.js, the FLAC encoder for book recordings.
// Lossless means bit-exact: every file is decoded again here by a small
// independent FLAC reader (CRC-8, CRC-16 and the STREAMINFO MD5 checked
// with node's crypto), and by ffmpeg where it is installed.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const F = require(path.join(__dirname, "..", "studio/flac.js"));

function crc8(b, a, e) { let c = 0; for (let i = a; i < e; i++) { c ^= b[i]; for (let k = 0; k < 8; k++) c = c & 0x80 ? ((c << 1) ^ 7) & 255 : (c << 1) & 255; } return c; }
function crc16(b, a, e) { let c = 0; for (let i = a; i < e; i++) { c ^= b[i] << 8; for (let k = 0; k < 8; k++) c = c & 0x8000 ? ((c << 1) ^ 0x8005) & 0xffff : (c << 1) & 0xffff; } return c; }
function Reader(b, o) { this.b = b; this.p = o * 8; }
Reader.prototype.bit = function () { const v = (this.b[this.p >> 3] >> (7 - (this.p & 7))) & 1; this.p++; return v; };
Reader.prototype.u = function (n) { let v = 0; for (let i = 0; i < n; i++) v = v * 2 + this.bit(); return v; };
Reader.prototype.s = function (n) { const v = this.u(n); return v >= 2 ** (n - 1) ? v - 2 ** n : v; };
Reader.prototype.unary = function () { let q = 0; while (!this.bit()) q++; return q; };
// → { rate, ch, bps, total, md5, vendor, comments, pcm: [Int32Array…] }
const seenLpc = new Set();
function decode(b) {
  assert.equal(Buffer.from(b.subarray(0, 4)).toString(), "fLaC");
  let o = 4, last = false, info = null, comments = [], vendor = "";
  while (!last) {
    last = !!(b[o] & 0x80); const type = b[o] & 0x7f, len = (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]; o += 4;
    if (type === 0) {
      const r = new Reader(b, o);
      info = { minB: r.u(16), maxB: r.u(16), minF: r.u(24), maxF: r.u(24), rate: r.u(20), ch: r.u(3) + 1, bps: r.u(5) + 1, total: r.u(36) };
      info.md5 = Buffer.from(b.subarray(o + 18, o + 34)).toString("hex");
    } else if (type === 4) {
      const dv = new DataView(b.buffer, b.byteOffset + o, len); let q = 0;
      const vl = dv.getUint32(q, true); q += 4; vendor = Buffer.from(b.subarray(o + q, o + q + vl)).toString(); q += vl;
      const nc = dv.getUint32(q, true); q += 4;
      for (let i = 0; i < nc; i++) { const l = dv.getUint32(q, true); q += 4; comments.push(Buffer.from(b.subarray(o + q, o + q + l)).toString()); q += l; }
    }
    o += len;
  }
  const pcm = []; for (let c = 0; c < info.ch; c++) pcm.push(new Int32Array(info.total));
  let at = 0, fnum = 0;
  while (o < b.length) {
    const r = new Reader(b, o);
    assert.equal(r.u(15), 0x7ffc, "sync"); assert.equal(r.u(1), 0, "fixed blocksize");
    const bsCode = r.u(4), srCode = r.u(4), chCode = r.u(4), ssCode = r.u(3); r.u(1);
    assert.equal(srCode, 0);
    let first = r.u(8), num = first, extra = 0;
    if (first >= 0x80) { let m = 0x40; extra = 1; while (first & (m >> 1)) { m >>= 1; extra++; } num = first & (m - 1); for (let i = 0; i < extra; i++) num = num * 64 + (r.u(8) & 63); }
    assert.equal(num, fnum, "frame number");
    const n = bsCode === 7 ? r.u(16) + 1 : bsCode === 6 ? r.u(8) + 1 : 4096;
    const bps = ssCode === 4 ? 16 : ssCode === 6 ? 24 : info.bps;
    assert.equal(r.u(8), crc8(b, o, r.p / 8 - 1), "header CRC-8");
    const nch = chCode < 8 ? chCode + 1 : 2, subs = [];
    for (let c = 0; c < nch; c++) {
      const side = (chCode === 8 && c === 1) || (chCode === 9 && c === 0) || (chCode === 10 && c === 1);
      const sb = bps + (side ? 1 : 0), x = new Int32Array(n);
      assert.equal(r.bit(), 0); const type = r.u(6); assert.equal(r.bit(), 0, "no wasted bits");
      if (type === 0) { x.fill(r.s(sb)); }
      else if (type === 1) { for (let i = 0; i < n; i++) x[i] = r.s(sb); }
      else if ((type >= 8 && type <= 12) || type >= 32) {
        const lpc = type >= 32, ord = lpc ? (type & 31) + 1 : type - 8;
        for (let i = 0; i < ord; i++) x[i] = r.s(sb);
        let q = null, shift = 0;
        if (lpc) { const prec = r.u(4) + 1; assert.ok(prec < 16); shift = r.s(5); assert.ok(shift >= 0); q = []; for (let j = 0; j < ord; j++) q.push(r.s(prec)); seenLpc.add(ord); }
        const meth = r.u(2), pbits = meth === 1 ? 5 : 4, po = r.u(4), parts = 1 << po; let i = ord;
        for (let p = 0; p < parts; p++) {
          const k = r.u(pbits), cnt = (n >> po) - (p === 0 ? ord : 0);
          assert.ok(k < (1 << pbits) - 1, "no escape");
          for (let j = 0; j < cnt; j++, i++) {
            const u = r.unary() * 2 ** k + (k ? r.u(k) : 0), e = u % 2 ? -(u + 1) / 2 : u / 2;
            const pr = lpc ? Math.floor(q.reduce((sm, c, j) => sm + c * x[i - 1 - j], 0) / 2 ** shift) : ord === 0 ? 0 : ord === 1 ? x[i - 1] : ord === 2 ? 2 * x[i - 1] - x[i - 2] : ord === 3 ? 3 * x[i - 1] - 3 * x[i - 2] + x[i - 3] : 4 * x[i - 1] - 6 * x[i - 2] + 4 * x[i - 3] - x[i - 4];
            x[i] = pr + e;
          }
        }
      } else assert.fail("subframe type " + type);
      subs.push(x);
    }
    if (r.p % 8) r.u(8 - (r.p % 8));
    const end = r.p / 8;
    assert.equal((b[end] << 8) | b[end + 1], crc16(b, o, end), "frame CRC-16");
    let L = subs[0], R = subs[1];
    if (chCode === 8) R = L.map((v, i) => v - subs[1][i]);
    else if (chCode === 9) { R = subs[1]; L = R.map((v, i) => v + subs[0][i]); }
    else if (chCode === 10) {
      L = new Int32Array(n); R = new Int32Array(n);
      for (let i = 0; i < n; i++) { const s = subs[1][i], m = subs[0][i] * 2 + (s & 1); L[i] = (m + s) >> 1; R[i] = (m - s) >> 1; }
    }
    pcm[0].set(L, at); if (info.ch > 1) pcm[1].set(R, at);
    at += n; fnum++; o = end + 2;
  }
  assert.equal(at, info.total);
  return Object.assign(info, { vendor, comments, pcm });
}
function md5Of(pcm, bps) {
  const n = pcm[0].length, by = bps / 8, buf = Buffer.alloc(n * pcm.length * by); let q = 0;
  for (let i = 0; i < n; i++) for (const c of pcm) { const v = c[i]; for (let k = 0; k < by; k++) buf[q++] = (v >> (8 * k)) & 255; }
  return crypto.createHash("md5").update(buf).digest("hex");
}
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
function signal(kind, n, rate) {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    x[i] = kind === "voice" ? 0.25 * Math.sin(2 * Math.PI * 180 * t) * (0.5 + 0.5 * Math.sin(2 * Math.PI * 3 * t)) + 0.002 * rnd()
      : kind === "noise" ? 1.9 * rnd() : kind === "square" ? (Math.sin(2 * Math.PI * 100 * t) >= 0 ? 1.2 : -1.2) : kind === "silence" ? 0 : 0.5 * Math.sin(i);
  }
  return x;
}
function roundTrip(chans, rate, bps, opts) {
  const bytes = F.encode(chans, rate, bps, opts), d = decode(bytes);
  assert.equal(d.rate, rate); assert.equal(d.ch, chans.length); assert.equal(d.bps, bps); assert.equal(d.total, chans[0].length);
  chans.forEach((c, k) => assert.deepEqual(d.pcm[k], F.quantise(c, c.length, bps), "channel " + k + " is bit-exact"));
  assert.equal(d.md5, md5Of(d.pcm, bps), "STREAMINFO MD5");
  return { bytes, d };
}

test("mono 24-bit speech-like audio: bit-exact, smaller than the WAV", () => {
  const x = signal("voice", 48000 * 3 + 123, 48000), { bytes, d } = roundTrip([x], 48000, 24, { title: "Κεφάλαιο 1", artist: "Αφηγητής" });
  assert.ok(bytes.length < x.length * 3 * 0.8, "compresses: " + bytes.length);
  assert.equal(d.vendor, "orOS Studio");
  assert.deepEqual(d.comments, ["TITLE=Κεφάλαιο 1", "ARTIST=Αφηγητής"]);
  assert.equal(d.minB, 4096); assert.ok(d.minF > 0 && d.maxF >= d.minF);
  assert.ok(seenLpc.size > 0, "LPC subframes are used for speech");
});

test("stereo: every decorrelation mode decodes bit-exact (16 and 24 bit)", () => {
  const n = 4096 * 3 + 7, a = signal("voice", n, 44100), b = signal("noise", n, 44100), seen = new Set();
  const pairs = [[a, a], [a, a.map((v) => v * 0.5)], [a, b], [b, a], [a.map((v, i) => v + 0.001 * b[i]), a], [a.map((v, i) => v + 0.02 * b[i]), a.map((v, i) => v - 0.02 * b[i])]];
  for (const bps of [16, 24]) for (const [l, r] of pairs) {
    const { bytes } = roundTrip([l, r], 44100, bps);
    for (let o = 0; o < bytes.length - 3; o++) if (bytes[o] === 0xff && bytes[o + 1] === 0xf8) seen.add(bytes[o + 2] === 0x70 ? bytes[o + 3] >> 4 : -1);
  }
  for (const mode of [1, 8, 9, 10]) assert.ok(seen.has(mode), "channel mode " + mode + " is used");
});

test("edge cases: silence, clipping, full-scale noise, one sample, odd rates", () => {
  roundTrip([signal("silence", 10000, 48000)], 48000, 24);
  roundTrip([signal("square", 9000, 48000)], 48000, 24);
  roundTrip([signal("noise", 5000, 48000), signal("noise", 5000, 48000)], 48000, 16);
  roundTrip([new Float32Array([0.5])], 22050, 24);
  roundTrip([signal("tone", 4096, 96000)], 96000, 24);
  roundTrip([signal("tone", 4097, 8000)], 8000, 16);
  const q = F.quantise(new Float32Array([1, -1, 2, -2, NaN, 0.5]), 6, 24);
  assert.deepEqual(Array.from(q), [8388607, -8388608, 8388607, -8388608, 0, 4194304]);
  assert.throws(() => new F.Encoder([], 48000, 24));
  assert.throws(() => new F.Encoder([new Float32Array(4)], 0, 24));
});

test("a slice at a time gives the very same file", () => {
  const x = signal("voice", 48000 * 2, 48000), e = new F.Encoder([x], 48000, 24);
  let steps = 0; while (!e.step(3)) { steps++; assert.ok(e.progress() < 1); }
  assert.ok(steps > 3);
  assert.deepEqual(e.bytes(), F.encode([x], 48000, 24));
});

test("ffmpeg decodes it bit-exact (skips without ffmpeg)", (t) => {
  let has = true;
  try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); } catch (e) { has = false; }
  if (!has) { t.skip("no ffmpeg"); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flac-"));
  for (const [chans, bps] of [[[signal("voice", 48000 * 2 + 5, 48000)], 24], [[signal("voice", 30000, 44100), signal("noise", 30000, 44100)], 16]]) {
    const file = path.join(dir, "t.flac");
    fs.writeFileSync(file, F.encode(chans, 48000, bps));
    const raw = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-f", "s32le", "-acodec", "pcm_s32le", "-"], { maxBuffer: 1 << 28 });
    const got = new Int32Array(raw.buffer, raw.byteOffset, raw.length / 4), q = chans.map((c) => F.quantise(c, c.length, bps));
    assert.equal(got.length, q[0].length * q.length);
    for (let i = 0; i < q[0].length; i++) for (let c = 0; c < q.length; c++) {
      if (got[i * q.length + c] !== q[c][i] * 2 ** (32 - bps)) assert.fail("sample " + i + " channel " + c);
    }
  }
});
