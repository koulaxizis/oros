// ============================================================
// orOS Studio — AAC-LC encoder (v1.0.0, Studio wave A4a)
// Pure code, no DOM, our own (Chris, 2026-11-13: no WebCodecs, no
// library). Writes MPEG-4 AAC Low Complexity (ISO/IEC 14496-3):
//   - long blocks only (a 2048-point MDCT with the sine window, one
//     frame of 1024 samples), mono (SCE) or stereo (CPE, each channel
//     on its own), 8 to 48 kHz;
//   - per scale factor band a step from a simple masking estimate
//     (the band's own energy less a signal-to-noise ratio, never under
//     the threshold of hearing), the ratio found per frame by bisection
//     so the frame fits its share of the bit rate (average bit rate,
//     with a bit reservoir);
//   - noiseless coding with all eleven spectral codebooks: each band
//     takes its cheapest book and neighbouring sections merge while
//     that saves bits; escapes, sign bits and scale factor deltas as
//     the standard says. No TNS, PNS, M/S or short blocks yet.
// Output: raw access units (for MP4/M4B, with asc() as the
// AudioSpecificConfig) or an ADTS stream (.aac). A decoder plays the
// first `delay` (1024) samples as priming: MP4 writers say so in their
// edit list.
// The tables below are those of ISO/IEC 14496-3 (Huffman codebooks,
// scale factor codebook, scale factor bands); tests/studio-aac.test.js
// checks that every codebook is a complete prefix code.
// Use: var enc = new StudioAac.Encoder(chans, rate, kbps);
//      while (!enc.step(32)) …; enc.adts() or enc.units() + enc.asc();
//      or a stream: var s = new StudioAac.Stream(1, 44100, 64);
//      s.push([part]) for each piece, s.end(), then s.units().
//      (chans: Float32Array per channel, -1..1).
// Loaded by studio.js (window.StudioAac) and by the tests.
// ============================================================
(function (root) {
  "use strict";

  // spectral codebooks 1-11: codewords and their lengths in bits
  var HC1 = [
    0x7f8, 0x1f1, 0x7fd, 0x3f5, 0x68, 0x3f0, 0x7f7, 0x1ec, 0x7f5, 0x3f1, 0x72, 0x3f4, 0x74, 0x11, 0x76, 0x1eb, 0x6c,
    0x3f6, 0x7fc, 0x1e1, 0x7f1, 0x1f0, 0x61, 0x1f6, 0x7f2, 0x1ea, 0x7fb, 0x1f2, 0x69, 0x1ed, 0x77, 0x17, 0x6f, 0x1e6,
    0x64, 0x1e5, 0x67, 0x15, 0x62, 0x12, 0x0, 0x14, 0x65, 0x16, 0x6d, 0x1e9, 0x63, 0x1e4, 0x6b, 0x13, 0x71, 0x1e3, 0x70,
    0x1f3, 0x7fe, 0x1e7, 0x7f3, 0x1ef, 0x60, 0x1ee, 0x7f0, 0x1e2, 0x7fa, 0x3f3, 0x6a, 0x1e8, 0x75, 0x10, 0x73, 0x1f4,
    0x6e, 0x3f7, 0x7f6, 0x1e0, 0x7f9, 0x3f2, 0x66, 0x1f5, 0x7ff, 0x1f7, 0x7f4
  ];
  var HB1 = [
    11, 9, 11, 10, 7, 10, 11, 9, 11, 10, 7, 10, 7, 5, 7, 9, 7, 10, 11, 9, 11, 9, 7, 9, 11, 9, 11, 9, 7, 9, 7, 5, 7, 9,
    7, 9, 7, 5, 7, 5, 1, 5, 7, 5, 7, 9, 7, 9, 7, 5, 7, 9, 7, 9, 11, 9, 11, 9, 7, 9, 11, 9, 11, 10, 7, 9, 7, 5, 7, 9, 7,
    10, 11, 9, 11, 10, 7, 9, 11, 9, 11
  ];
  var HC2 = [
    0x1f3, 0x6f, 0x1fd, 0xeb, 0x23, 0xea, 0x1f7, 0xe8, 0x1fa, 0xf2, 0x2d, 0x70, 0x20, 0x6, 0x2b, 0x6e, 0x28, 0xe9,
    0x1f9, 0x66, 0xf8, 0xe7, 0x1b, 0xf1, 0x1f4, 0x6b, 0x1f5, 0xec, 0x2a, 0x6c, 0x2c, 0xa, 0x27, 0x67, 0x1a, 0xf5, 0x24,
    0x8, 0x1f, 0x9, 0x0, 0x7, 0x1d, 0xb, 0x30, 0xef, 0x1c, 0x64, 0x1e, 0xc, 0x29, 0xf3, 0x2f, 0xf0, 0x1fc, 0x71, 0x1f2,
    0xf4, 0x21, 0xe6, 0xf7, 0x68, 0x1f8, 0xee, 0x22, 0x65, 0x31, 0x2, 0x26, 0xed, 0x25, 0x6a, 0x1fb, 0x72, 0x1fe, 0x69,
    0x2e, 0xf6, 0x1ff, 0x6d, 0x1f6
  ];
  var HB2 = [
    9, 7, 9, 8, 6, 8, 9, 8, 9, 8, 6, 7, 6, 5, 6, 7, 6, 8, 9, 7, 8, 8, 6, 8, 9, 7, 9, 8, 6, 7, 6, 5, 6, 7, 6, 8, 6, 5, 6,
    5, 3, 5, 6, 5, 6, 8, 6, 7, 6, 5, 6, 8, 6, 8, 9, 7, 9, 8, 6, 8, 8, 7, 9, 8, 6, 7, 6, 4, 6, 8, 6, 7, 9, 7, 9, 7, 6, 8,
    9, 7, 9
  ];
  var HC3 = [
    0x0, 0x9, 0xef, 0xb, 0x19, 0xf0, 0x1eb, 0x1e6, 0x3f2, 0xa, 0x35, 0x1ef, 0x34, 0x37, 0x1e9, 0x1ed, 0x1e7, 0x3f3,
    0x1ee, 0x3ed, 0x1ffa, 0x1ec, 0x1f2, 0x7f9, 0x7f8, 0x3f8, 0xff8, 0x8, 0x38, 0x3f6, 0x36, 0x75, 0x3f1, 0x3eb, 0x3ec,
    0xff4, 0x18, 0x76, 0x7f4, 0x39, 0x74, 0x3ef, 0x1f3, 0x1f4, 0x7f6, 0x1e8, 0x3ea, 0x1ffc, 0xf2, 0x1f1, 0xffb, 0x3f5,
    0x7f3, 0xffc, 0xee, 0x3f7, 0x7ffe, 0x1f0, 0x7f5, 0x7ffd, 0x1ffb, 0x3ffa, 0xffff, 0xf1, 0x3f0, 0x3ffc, 0x1ea, 0x3ee,
    0x3ffb, 0xff6, 0xffa, 0x7ffc, 0x7f2, 0xff5, 0xfffe, 0x3f4, 0x7f7, 0x7ffb, 0xff7, 0xff9, 0x7ffa
  ];
  var HB3 = [
    1, 4, 8, 4, 5, 8, 9, 9, 10, 4, 6, 9, 6, 6, 9, 9, 9, 10, 9, 10, 13, 9, 9, 11, 11, 10, 12, 4, 6, 10, 6, 7, 10, 10, 10,
    12, 5, 7, 11, 6, 7, 10, 9, 9, 11, 9, 10, 13, 8, 9, 12, 10, 11, 12, 8, 10, 15, 9, 11, 15, 13, 14, 16, 8, 10, 14, 9,
    10, 14, 12, 12, 15, 11, 12, 16, 10, 11, 15, 12, 12, 15
  ];
  var HC4 = [
    0x7, 0x16, 0xf6, 0x18, 0x8, 0xef, 0x1ef, 0xf3, 0x7f8, 0x19, 0x17, 0xed, 0x15, 0x1, 0xe2, 0xf0, 0x70, 0x3f0, 0x1ee,
    0xf1, 0x7fa, 0xee, 0xe4, 0x3f2, 0x7f6, 0x3ef, 0x7fd, 0x5, 0x14, 0xf2, 0x9, 0x4, 0xe5, 0xf4, 0xe8, 0x3f4, 0x6, 0x2,
    0xe7, 0x3, 0x0, 0x6b, 0xe3, 0x69, 0x1f3, 0xeb, 0xe6, 0x3f6, 0x6e, 0x6a, 0x1f4, 0x3ec, 0x1f0, 0x3f9, 0xf5, 0xec,
    0x7fb, 0xea, 0x6f, 0x3f7, 0x7f9, 0x3f3, 0xfff, 0xe9, 0x6d, 0x3f8, 0x6c, 0x68, 0x1f5, 0x3ee, 0x1f2, 0x7f4, 0x7f7,
    0x3f1, 0xffe, 0x3ed, 0x1f1, 0x7f5, 0x7fe, 0x3f5, 0x7fc
  ];
  var HB4 = [
    4, 5, 8, 5, 4, 8, 9, 8, 11, 5, 5, 8, 5, 4, 8, 8, 7, 10, 9, 8, 11, 8, 8, 10, 11, 10, 11, 4, 5, 8, 4, 4, 8, 8, 8, 10,
    4, 4, 8, 4, 4, 7, 8, 7, 9, 8, 8, 10, 7, 7, 9, 10, 9, 10, 8, 8, 11, 8, 7, 10, 11, 10, 12, 8, 7, 10, 7, 7, 9, 10, 9,
    11, 11, 10, 12, 10, 9, 11, 11, 10, 11
  ];
  var HC5 = [
    0x1fff, 0xff7, 0x7f4, 0x7e8, 0x3f1, 0x7ee, 0x7f9, 0xff8, 0x1ffd, 0xffd, 0x7f1, 0x3e8, 0x1e8, 0xf0, 0x1ec, 0x3ee,
    0x7f2, 0xffa, 0xff4, 0x3ef, 0x1f2, 0xe8, 0x70, 0xec, 0x1f0, 0x3ea, 0x7f3, 0x7eb, 0x1eb, 0xea, 0x1a, 0x8, 0x19, 0xee,
    0x1ef, 0x7ed, 0x3f0, 0xf2, 0x73, 0xb, 0x0, 0xa, 0x71, 0xf3, 0x7e9, 0x7ef, 0x1ee, 0xef, 0x18, 0x9, 0x1b, 0xeb, 0x1e9,
    0x7ec, 0x7f6, 0x3eb, 0x1f3, 0xed, 0x72, 0xe9, 0x1f1, 0x3ed, 0x7f7, 0xff6, 0x7f0, 0x3e9, 0x1ed, 0xf1, 0x1ea, 0x3ec,
    0x7f8, 0xff9, 0x1ffc, 0xffc, 0xff5, 0x7ea, 0x3f3, 0x3f2, 0x7f5, 0xffb, 0x1ffe
  ];
  var HB5 = [
    13, 12, 11, 11, 10, 11, 11, 12, 13, 12, 11, 10, 9, 8, 9, 10, 11, 12, 12, 10, 9, 8, 7, 8, 9, 10, 11, 11, 9, 8, 5, 4,
    5, 8, 9, 11, 10, 8, 7, 4, 1, 4, 7, 8, 11, 11, 9, 8, 5, 4, 5, 8, 9, 11, 11, 10, 9, 8, 7, 8, 9, 10, 11, 12, 11, 10, 9,
    8, 9, 10, 11, 12, 13, 12, 12, 11, 10, 10, 11, 12, 13
  ];
  var HC6 = [
    0x7fe, 0x3fd, 0x1f1, 0x1eb, 0x1f4, 0x1ea, 0x1f0, 0x3fc, 0x7fd, 0x3f6, 0x1e5, 0xea, 0x6c, 0x71, 0x68, 0xf0, 0x1e6,
    0x3f7, 0x1f3, 0xef, 0x32, 0x27, 0x28, 0x26, 0x31, 0xeb, 0x1f7, 0x1e8, 0x6f, 0x2e, 0x8, 0x4, 0x6, 0x29, 0x6b, 0x1ee,
    0x1ef, 0x72, 0x2d, 0x2, 0x0, 0x3, 0x2f, 0x73, 0x1fa, 0x1e7, 0x6e, 0x2b, 0x7, 0x1, 0x5, 0x2c, 0x6d, 0x1ec, 0x1f9,
    0xee, 0x30, 0x24, 0x2a, 0x25, 0x33, 0xec, 0x1f2, 0x3f8, 0x1e4, 0xed, 0x6a, 0x70, 0x69, 0x74, 0xf1, 0x3fa, 0x7ff,
    0x3f9, 0x1f6, 0x1ed, 0x1f8, 0x1e9, 0x1f5, 0x3fb, 0x7fc
  ];
  var HB6 = [
    11, 10, 9, 9, 9, 9, 9, 10, 11, 10, 9, 8, 7, 7, 7, 8, 9, 10, 9, 8, 6, 6, 6, 6, 6, 8, 9, 9, 7, 6, 4, 4, 4, 6, 7, 9, 9,
    7, 6, 4, 4, 4, 6, 7, 9, 9, 7, 6, 4, 4, 4, 6, 7, 9, 9, 8, 6, 6, 6, 6, 6, 8, 9, 10, 9, 8, 7, 7, 7, 7, 8, 10, 11, 10,
    9, 9, 9, 9, 9, 10, 11
  ];
  var HC7 = [
    0x0, 0x5, 0x37, 0x74, 0xf2, 0x1eb, 0x3ed, 0x7f7, 0x4, 0xc, 0x35, 0x71, 0xec, 0xee, 0x1ee, 0x1f5, 0x36, 0x34, 0x72,
    0xea, 0xf1, 0x1e9, 0x1f3, 0x3f5, 0x73, 0x70, 0xeb, 0xf0, 0x1f1, 0x1f0, 0x3ec, 0x3fa, 0xf3, 0xed, 0x1e8, 0x1ef,
    0x3ef, 0x3f1, 0x3f9, 0x7fb, 0x1ed, 0xef, 0x1ea, 0x1f2, 0x3f3, 0x3f8, 0x7f9, 0x7fc, 0x3ee, 0x1ec, 0x1f4, 0x3f4,
    0x3f7, 0x7f8, 0xffd, 0xffe, 0x7f6, 0x3f0, 0x3f2, 0x3f6, 0x7fa, 0x7fd, 0xffc, 0xfff
  ];
  var HB7 = [
    1, 3, 6, 7, 8, 9, 10, 11, 3, 4, 6, 7, 8, 8, 9, 9, 6, 6, 7, 8, 8, 9, 9, 10, 7, 7, 8, 8, 9, 9, 10, 10, 8, 8, 9, 9, 10,
    10, 10, 11, 9, 8, 9, 9, 10, 10, 11, 11, 10, 9, 9, 10, 10, 11, 12, 12, 11, 10, 10, 10, 11, 11, 12, 12
  ];
  var HC8 = [
    0xe, 0x5, 0x10, 0x30, 0x6f, 0xf1, 0x1fa, 0x3fe, 0x3, 0x0, 0x4, 0x12, 0x2c, 0x6a, 0x75, 0xf8, 0xf, 0x2, 0x6, 0x14,
    0x2e, 0x69, 0x72, 0xf5, 0x2f, 0x11, 0x13, 0x2a, 0x32, 0x6c, 0xec, 0xfa, 0x71, 0x2b, 0x2d, 0x31, 0x6d, 0x70, 0xf2,
    0x1f9, 0xef, 0x68, 0x33, 0x6b, 0x6e, 0xee, 0xf9, 0x3fc, 0x1f8, 0x74, 0x73, 0xed, 0xf0, 0xf6, 0x1f6, 0x1fd, 0x3fd,
    0xf3, 0xf4, 0xf7, 0x1f7, 0x1fb, 0x1fc, 0x3ff
  ];
  var HB8 = [
    5, 4, 5, 6, 7, 8, 9, 10, 4, 3, 4, 5, 6, 7, 7, 8, 5, 4, 4, 5, 6, 7, 7, 8, 6, 5, 5, 6, 6, 7, 8, 8, 7, 6, 6, 6, 7, 7,
    8, 9, 8, 7, 6, 7, 7, 8, 8, 10, 9, 7, 7, 8, 8, 8, 9, 9, 10, 8, 8, 8, 9, 9, 9, 10
  ];
  var HC9 = [
    0x0, 0x5, 0x37, 0xe7, 0x1de, 0x3ce, 0x3d9, 0x7c8, 0x7cd, 0xfc8, 0xfdd, 0x1fe4, 0x1fec, 0x4, 0xc, 0x35, 0x72, 0xea,
    0xed, 0x1e2, 0x3d1, 0x3d3, 0x3e0, 0x7d8, 0xfcf, 0xfd5, 0x36, 0x34, 0x71, 0xe8, 0xec, 0x1e1, 0x3cf, 0x3dd, 0x3db,
    0x7d0, 0xfc7, 0xfd4, 0xfe4, 0xe6, 0x70, 0xe9, 0x1dd, 0x1e3, 0x3d2, 0x3dc, 0x7cc, 0x7ca, 0x7de, 0xfd8, 0xfea, 0x1fdb,
    0x1df, 0xeb, 0x1dc, 0x1e6, 0x3d5, 0x3de, 0x7cb, 0x7dd, 0x7dc, 0xfcd, 0xfe2, 0xfe7, 0x1fe1, 0x3d0, 0x1e0, 0x1e4,
    0x3d6, 0x7c5, 0x7d1, 0x7db, 0xfd2, 0x7e0, 0xfd9, 0xfeb, 0x1fe3, 0x1fe9, 0x7c4, 0x1e5, 0x3d7, 0x7c6, 0x7cf, 0x7da,
    0xfcb, 0xfda, 0xfe3, 0xfe9, 0x1fe6, 0x1ff3, 0x1ff7, 0x7d3, 0x3d8, 0x3e1, 0x7d4, 0x7d9, 0xfd3, 0xfde, 0x1fdd, 0x1fd9,
    0x1fe2, 0x1fea, 0x1ff1, 0x1ff6, 0x7d2, 0x3d4, 0x3da, 0x7c7, 0x7d7, 0x7e2, 0xfce, 0xfdb, 0x1fd8, 0x1fee, 0x3ff0,
    0x1ff4, 0x3ff2, 0x7e1, 0x3df, 0x7c9, 0x7d6, 0xfca, 0xfd0, 0xfe5, 0xfe6, 0x1feb, 0x1fef, 0x3ff3, 0x3ff4, 0x3ff5,
    0xfe0, 0x7ce, 0x7d5, 0xfc6, 0xfd1, 0xfe1, 0x1fe0, 0x1fe8, 0x1ff0, 0x3ff1, 0x3ff8, 0x3ff6, 0x7ffc, 0xfe8, 0x7df,
    0xfc9, 0xfd7, 0xfdc, 0x1fdc, 0x1fdf, 0x1fed, 0x1ff5, 0x3ff9, 0x3ffb, 0x7ffd, 0x7ffe, 0x1fe7, 0xfcc, 0xfd6, 0xfdf,
    0x1fde, 0x1fda, 0x1fe5, 0x1ff2, 0x3ffa, 0x3ff7, 0x3ffc, 0x3ffd, 0x7fff
  ];
  var HB9 = [
    1, 3, 6, 8, 9, 10, 10, 11, 11, 12, 12, 13, 13, 3, 4, 6, 7, 8, 8, 9, 10, 10, 10, 11, 12, 12, 6, 6, 7, 8, 8, 9, 10,
    10, 10, 11, 12, 12, 12, 8, 7, 8, 9, 9, 10, 10, 11, 11, 11, 12, 12, 13, 9, 8, 9, 9, 10, 10, 11, 11, 11, 12, 12, 12,
    13, 10, 9, 9, 10, 11, 11, 11, 12, 11, 12, 12, 13, 13, 11, 9, 10, 11, 11, 11, 12, 12, 12, 12, 13, 13, 13, 11, 10, 10,
    11, 11, 12, 12, 13, 13, 13, 13, 13, 13, 11, 10, 10, 11, 11, 11, 12, 12, 13, 13, 14, 13, 14, 11, 10, 11, 11, 12, 12,
    12, 12, 13, 13, 14, 14, 14, 12, 11, 11, 12, 12, 12, 13, 13, 13, 14, 14, 14, 15, 12, 11, 12, 12, 12, 13, 13, 13, 13,
    14, 14, 15, 15, 13, 12, 12, 12, 13, 13, 13, 13, 14, 14, 14, 14, 15
  ];
  var HC10 = [
    0x22, 0x8, 0x1d, 0x26, 0x5f, 0xd3, 0x1cf, 0x3d0, 0x3d7, 0x3ed, 0x7f0, 0x7f6, 0xffd, 0x7, 0x0, 0x1, 0x9, 0x20, 0x54,
    0x60, 0xd5, 0xdc, 0x1d4, 0x3cd, 0x3de, 0x7e7, 0x1c, 0x2, 0x6, 0xc, 0x1e, 0x28, 0x5b, 0xcd, 0xd9, 0x1ce, 0x1dc,
    0x3d9, 0x3f1, 0x25, 0xb, 0xa, 0xd, 0x24, 0x57, 0x61, 0xcc, 0xdd, 0x1cc, 0x1de, 0x3d3, 0x3e7, 0x5d, 0x21, 0x1f, 0x23,
    0x27, 0x59, 0x64, 0xd8, 0xdf, 0x1d2, 0x1e2, 0x3dd, 0x3ee, 0xd1, 0x55, 0x29, 0x56, 0x58, 0x62, 0xce, 0xe0, 0xe2,
    0x1da, 0x3d4, 0x3e3, 0x7eb, 0x1c9, 0x5e, 0x5a, 0x5c, 0x63, 0xca, 0xda, 0x1c7, 0x1ca, 0x1e0, 0x3db, 0x3e8, 0x7ec,
    0x1e3, 0xd2, 0xcb, 0xd0, 0xd7, 0xdb, 0x1c6, 0x1d5, 0x1d8, 0x3ca, 0x3da, 0x7ea, 0x7f1, 0x1e1, 0xd4, 0xcf, 0xd6, 0xde,
    0xe1, 0x1d0, 0x1d6, 0x3d1, 0x3d5, 0x3f2, 0x7ee, 0x7fb, 0x3e9, 0x1cd, 0x1c8, 0x1cb, 0x1d1, 0x1d7, 0x1df, 0x3cf,
    0x3e0, 0x3ef, 0x7e6, 0x7f8, 0xffa, 0x3eb, 0x1dd, 0x1d3, 0x1d9, 0x1db, 0x3d2, 0x3cc, 0x3dc, 0x3ea, 0x7ed, 0x7f3,
    0x7f9, 0xff9, 0x7f2, 0x3ce, 0x1e4, 0x3cb, 0x3d8, 0x3d6, 0x3e2, 0x3e5, 0x7e8, 0x7f4, 0x7f5, 0x7f7, 0xffb, 0x7fa,
    0x3ec, 0x3df, 0x3e1, 0x3e4, 0x3e6, 0x3f0, 0x7e9, 0x7ef, 0xff8, 0xffe, 0xffc, 0xfff
  ];
  var HB10 = [
    6, 5, 6, 6, 7, 8, 9, 10, 10, 10, 11, 11, 12, 5, 4, 4, 5, 6, 7, 7, 8, 8, 9, 10, 10, 11, 6, 4, 5, 5, 6, 6, 7, 8, 8, 9,
    9, 10, 10, 6, 5, 5, 5, 6, 7, 7, 8, 8, 9, 9, 10, 10, 7, 6, 6, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 8, 7, 6, 7, 7, 7, 8, 8,
    8, 9, 10, 10, 11, 9, 7, 7, 7, 7, 8, 8, 9, 9, 9, 10, 10, 11, 9, 8, 8, 8, 8, 8, 9, 9, 9, 10, 10, 11, 11, 9, 8, 8, 8,
    8, 8, 9, 9, 10, 10, 10, 11, 11, 10, 9, 9, 9, 9, 9, 9, 10, 10, 10, 11, 11, 12, 10, 9, 9, 9, 9, 10, 10, 10, 10, 11,
    11, 11, 12, 11, 10, 9, 10, 10, 10, 10, 10, 11, 11, 11, 11, 12, 11, 10, 10, 10, 10, 10, 10, 11, 11, 12, 12, 12, 12
  ];
  var HC11 = [
    0x0, 0x6, 0x19, 0x3d, 0x9c, 0xc6, 0x1a7, 0x390, 0x3c2, 0x3df, 0x7e6, 0x7f3, 0xffb, 0x7ec, 0xffa, 0xffe, 0x38e, 0x5,
    0x1, 0x8, 0x14, 0x37, 0x42, 0x92, 0xaf, 0x191, 0x1a5, 0x1b5, 0x39e, 0x3c0, 0x3a2, 0x3cd, 0x7d6, 0xae, 0x17, 0x7,
    0x9, 0x18, 0x39, 0x40, 0x8e, 0xa3, 0xb8, 0x199, 0x1ac, 0x1c1, 0x3b1, 0x396, 0x3be, 0x3ca, 0x9d, 0x3c, 0x15, 0x16,
    0x1a, 0x3b, 0x44, 0x91, 0xa5, 0xbe, 0x196, 0x1ae, 0x1b9, 0x3a1, 0x391, 0x3a5, 0x3d5, 0x94, 0x9a, 0x36, 0x38, 0x3a,
    0x41, 0x8c, 0x9b, 0xb0, 0xc3, 0x19e, 0x1ab, 0x1bc, 0x39f, 0x38f, 0x3a9, 0x3cf, 0x93, 0xbf, 0x3e, 0x3f, 0x43, 0x45,
    0x9e, 0xa7, 0xb9, 0x194, 0x1a2, 0x1ba, 0x1c3, 0x3a6, 0x3a7, 0x3bb, 0x3d4, 0x9f, 0x1a0, 0x8f, 0x8d, 0x90, 0x98, 0xa6,
    0xb6, 0xc4, 0x19f, 0x1af, 0x1bf, 0x399, 0x3bf, 0x3b4, 0x3c9, 0x3e7, 0xa8, 0x1b6, 0xab, 0xa4, 0xaa, 0xb2, 0xc2, 0xc5,
    0x198, 0x1a4, 0x1b8, 0x38c, 0x3a4, 0x3c4, 0x3c6, 0x3dd, 0x3e8, 0xad, 0x3af, 0x192, 0xbd, 0xbc, 0x18e, 0x197, 0x19a,
    0x1a3, 0x1b1, 0x38d, 0x398, 0x3b7, 0x3d3, 0x3d1, 0x3db, 0x7dd, 0xb4, 0x3de, 0x1a9, 0x19b, 0x19c, 0x1a1, 0x1aa,
    0x1ad, 0x1b3, 0x38b, 0x3b2, 0x3b8, 0x3ce, 0x3e1, 0x3e0, 0x7d2, 0x7e5, 0xb7, 0x7e3, 0x1bb, 0x1a8, 0x1a6, 0x1b0,
    0x1b2, 0x1b7, 0x39b, 0x39a, 0x3ba, 0x3b5, 0x3d6, 0x7d7, 0x3e4, 0x7d8, 0x7ea, 0xba, 0x7e8, 0x3a0, 0x1bd, 0x1b4,
    0x38a, 0x1c4, 0x392, 0x3aa, 0x3b0, 0x3bc, 0x3d7, 0x7d4, 0x7dc, 0x7db, 0x7d5, 0x7f0, 0xc1, 0x7fb, 0x3c8, 0x3a3,
    0x395, 0x39d, 0x3ac, 0x3ae, 0x3c5, 0x3d8, 0x3e2, 0x3e6, 0x7e4, 0x7e7, 0x7e0, 0x7e9, 0x7f7, 0x190, 0x7f2, 0x393,
    0x1be, 0x1c0, 0x394, 0x397, 0x3ad, 0x3c3, 0x3c1, 0x3d2, 0x7da, 0x7d9, 0x7df, 0x7eb, 0x7f4, 0x7fa, 0x195, 0x7f8,
    0x3bd, 0x39c, 0x3ab, 0x3a8, 0x3b3, 0x3b9, 0x3d0, 0x3e3, 0x3e5, 0x7e2, 0x7de, 0x7ed, 0x7f1, 0x7f9, 0x7fc, 0x193,
    0xffd, 0x3dc, 0x3b6, 0x3c7, 0x3cc, 0x3cb, 0x3d9, 0x3da, 0x7d3, 0x7e1, 0x7ee, 0x7ef, 0x7f5, 0x7f6, 0xffc, 0xfff,
    0x19d, 0x1c2, 0xb5, 0xa1, 0x96, 0x97, 0x95, 0x99, 0xa0, 0xa2, 0xac, 0xa9, 0xb1, 0xb3, 0xbb, 0xc0, 0x18f, 0x4
  ];
  var HB11 = [
    4, 5, 6, 7, 8, 8, 9, 10, 10, 10, 11, 11, 12, 11, 12, 12, 10, 5, 4, 5, 6, 7, 7, 8, 8, 9, 9, 9, 10, 10, 10, 10, 11, 8,
    6, 5, 5, 6, 7, 7, 8, 8, 8, 9, 9, 9, 10, 10, 10, 10, 8, 7, 6, 6, 6, 7, 7, 8, 8, 8, 9, 9, 9, 10, 10, 10, 10, 8, 8, 7,
    7, 7, 7, 8, 8, 8, 8, 9, 9, 9, 10, 10, 10, 10, 8, 8, 7, 7, 7, 7, 8, 8, 8, 9, 9, 9, 9, 10, 10, 10, 10, 8, 9, 8, 8, 8,
    8, 8, 8, 8, 9, 9, 9, 10, 10, 10, 10, 10, 8, 9, 8, 8, 8, 8, 8, 8, 9, 9, 9, 10, 10, 10, 10, 10, 10, 8, 10, 9, 8, 8, 9,
    9, 9, 9, 9, 10, 10, 10, 10, 10, 10, 11, 8, 10, 9, 9, 9, 9, 9, 9, 9, 10, 10, 10, 10, 10, 10, 11, 11, 8, 11, 9, 9, 9,
    9, 9, 9, 10, 10, 10, 10, 10, 11, 10, 11, 11, 8, 11, 10, 9, 9, 10, 9, 10, 10, 10, 10, 10, 11, 11, 11, 11, 11, 8, 11,
    10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 11, 11, 11, 11, 11, 9, 11, 10, 9, 9, 10, 10, 10, 10, 10, 10, 11, 11, 11, 11,
    11, 11, 9, 11, 10, 10, 10, 10, 10, 10, 10, 10, 10, 11, 11, 11, 11, 11, 11, 9, 12, 10, 10, 10, 10, 10, 10, 10, 11,
    11, 11, 11, 11, 11, 12, 12, 9, 9, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 9, 5
  ];
  // scale factor codebook (index = difference + 60)
  var SFC = [
    0x3ffe8, 0x3ffe6, 0x3ffe7, 0x3ffe5, 0x7fff5, 0x7fff1, 0x7ffed, 0x7fff6, 0x7ffee, 0x7ffef, 0x7fff0, 0x7fffc, 0x7fffd,
    0x7ffff, 0x7fffe, 0x7fff7, 0x7fff8, 0x7fffb, 0x7fff9, 0x3ffe4, 0x7fffa, 0x3ffe3, 0x1ffef, 0x1fff0, 0xfff5, 0x1ffee,
    0xfff2, 0xfff3, 0xfff4, 0xfff1, 0x7ff6, 0x7ff7, 0x3ff9, 0x3ff5, 0x3ff7, 0x3ff3, 0x3ff6, 0x3ff2, 0x1ff7, 0x1ff5,
    0xff9, 0xff7, 0xff6, 0x7f9, 0xff4, 0x7f8, 0x3f9, 0x3f7, 0x3f5, 0x1f8, 0x1f7, 0xfa, 0xf8, 0xf6, 0x79, 0x3a, 0x38,
    0x1a, 0xb, 0x4, 0x0, 0xa, 0xc, 0x1b, 0x39, 0x3b, 0x78, 0x7a, 0xf7, 0xf9, 0x1f6, 0x1f9, 0x3f4, 0x3f6, 0x3f8, 0x7f5,
    0x7f4, 0x7f6, 0x7f7, 0xff5, 0xff8, 0x1ff4, 0x1ff6, 0x1ff8, 0x3ff8, 0x3ff4, 0xfff0, 0x7ff4, 0xfff6, 0x7ff5, 0x3ffe2,
    0x7ffd9, 0x7ffda, 0x7ffdb, 0x7ffdc, 0x7ffdd, 0x7ffde, 0x7ffd8, 0x7ffd2, 0x7ffd3, 0x7ffd4, 0x7ffd5, 0x7ffd6, 0x7fff2,
    0x7ffdf, 0x7ffe7, 0x7ffe8, 0x7ffe9, 0x7ffea, 0x7ffeb, 0x7ffe6, 0x7ffe0, 0x7ffe1, 0x7ffe2, 0x7ffe3, 0x7ffe4, 0x7ffe5,
    0x7ffd7, 0x7ffec, 0x7fff4, 0x7fff3
  ];
  var SFB = [
    18, 18, 18, 18, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 18, 19, 18, 17, 17, 16, 17, 16, 16, 16,
    16, 15, 15, 14, 14, 14, 14, 14, 14, 13, 13, 12, 12, 12, 11, 12, 11, 10, 10, 10, 9, 9, 8, 8, 8, 7, 6, 6, 5, 4, 3, 1,
    4, 4, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 10, 11, 11, 11, 11, 12, 12, 13, 13, 13, 14, 14, 16, 15, 16, 15, 18, 19, 19,
    19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19
  ];
  // scale factor band offsets of a long window (1024 lines)
  var SWB48 = [
    0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 80, 88, 96, 108, 120, 132, 144, 160, 176, 196, 216, 240,
    264, 292, 320, 352, 384, 416, 448, 480, 512, 544, 576, 608, 640, 672, 704, 736, 768, 800, 832, 864, 896, 928, 1024
  ];
  var SWB32 = [
    0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 80, 88, 96, 108, 120, 132, 144, 160, 176, 196, 216, 240,
    264, 292, 320, 352, 384, 416, 448, 480, 512, 544, 576, 608, 640, 672, 704, 736, 768, 800, 832, 864, 896, 928, 960,
    992, 1024
  ];
  var SWB24 = [
    0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 52, 60, 68, 76, 84, 92, 100, 108, 116, 124, 136, 148, 160, 172, 188,
    204, 220, 240, 260, 284, 308, 336, 364, 396, 432, 468, 508, 552, 600, 652, 704, 768, 832, 896, 960, 1024
  ];
  var SWB16 = [
    0, 8, 16, 24, 32, 40, 48, 56, 64, 72, 80, 88, 100, 112, 124, 136, 148, 160, 172, 184, 196, 212, 228, 244, 260, 280,
    300, 320, 344, 368, 396, 424, 456, 492, 532, 572, 616, 664, 716, 772, 832, 896, 960, 1024
  ];
  var SWB8 = [
    0, 12, 24, 36, 48, 60, 72, 84, 96, 108, 120, 132, 144, 156, 172, 188, 204, 220, 236, 252, 268, 288, 308, 328, 348,
    372, 396, 420, 448, 476, 508, 544, 580, 620, 664, 712, 764, 820, 880, 944, 1024
  ];

  var BOOKS = [null,
    { c: HC1, b: HB1, dim: 4, sgn: true, lav: 1 }, { c: HC2, b: HB2, dim: 4, sgn: true, lav: 1 },
    { c: HC3, b: HB3, dim: 4, sgn: false, lav: 2 }, { c: HC4, b: HB4, dim: 4, sgn: false, lav: 2 },
    { c: HC5, b: HB5, dim: 2, sgn: true, lav: 4 }, { c: HC6, b: HB6, dim: 2, sgn: true, lav: 4 },
    { c: HC7, b: HB7, dim: 2, sgn: false, lav: 7 }, { c: HC8, b: HB8, dim: 2, sgn: false, lav: 7 },
    { c: HC9, b: HB9, dim: 2, sgn: false, lav: 12 }, { c: HC10, b: HB10, dim: 2, sgn: false, lav: 12 },
    { c: HC11, b: HB11, dim: 2, sgn: false, lav: 16 }];
  var RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
  function swbOf(rate) {
    return rate >= 44100 ? SWB48 : rate >= 32000 ? SWB32 : rate >= 22050 ? SWB24 : rate >= 11025 ? SWB16 : SWB8;
  }
  var FRAME = 1024, N = 2048, MAX_Q = 8191, MAX_BITS = 6144;
  var SCALE = 32768;                  // the decoder's output is in 16-bit units
  var SF_MIN = 0, SF_MAX = 255;

  // ---------- bits ----------
  function BitWriter(size) { this.buf = new Uint8Array(size || 8192); this.pos = 0; this.acc = 0; this.n = 0; }
  BitWriter.prototype.put = function (value, bits) {
    if (bits > 24) { this.put(Math.floor(value / 16777216) >>> 0, bits - 24); value = value % 16777216; bits = 24; }
    if (this.pos + 4 > this.buf.length) {
      var b = new Uint8Array(this.buf.length * 2); b.set(this.buf.subarray(0, this.pos)); this.buf = b;
    }
    var acc = (this.acc << bits) | value, n = this.n + bits, buf = this.buf;
    while (n >= 8) { n -= 8; buf[this.pos++] = (acc >>> n) & 255; }
    this.acc = acc & ((1 << n) - 1); this.n = n;
  };
  BitWriter.prototype.bits = function () { return this.pos * 8 + this.n; };
  BitWriter.prototype.align = function () { if (this.n) this.put(0, 8 - this.n); };
  BitWriter.prototype.bytes = function () { return this.buf.slice(0, this.pos); };

  // ---------- MDCT (2048 → 1024, a 256-point complex FFT inside) ----------
  function Mdct() {
    var M = FRAME, H = M / 2, i, lg = Math.log2(H);
    this.rev = new Uint16Array(H);
    for (i = 0; i < H; i++) { var r = 0; for (var b = 0; b < lg; b++) if (i & (1 << b)) r |= 1 << (lg - 1 - b); this.rev[i] = r; }
    this.fc = new Float64Array(H / 2); this.fs = new Float64Array(H / 2);
    for (i = 0; i < H / 2; i++) { this.fc[i] = Math.cos(-2 * Math.PI * i / H); this.fs[i] = Math.sin(-2 * Math.PI * i / H); }
    this.wr = new Float64Array(H); this.wi = new Float64Array(H); this.pr = new Float64Array(H); this.pi = new Float64Array(H);
    for (i = 0; i < H; i++) {
      var a = -Math.PI * (4 * i + 1) / (4 * M), p = -Math.PI * i / M;
      this.wr[i] = Math.cos(a); this.wi[i] = Math.sin(a); this.pr[i] = Math.cos(p); this.pi[i] = Math.sin(p);
    }
    this.re = new Float64Array(H); this.im = new Float64Array(H); this.v = new Float64Array(M);
    this.win = new Float64Array(N);
    for (i = 0; i < N; i++) this.win[i] = Math.sin(Math.PI * (i + 0.5) / N);
  }
  // X[k] = sum z[n] w[n] cos(pi/M (n + 1/2 + M/2)(k + 1/2)), times `gain`
  Mdct.prototype.run = function (z, out, gain) {
    var M = FRAME, Q = M / 2, H = M / 2, v = this.v, re = this.re, im = this.im, w = this.win, n, k;
    for (n = 0; n < Q; n++) {
      v[n] = -z[M + Q - 1 - n] * w[M + Q - 1 - n] - z[M + Q + n] * w[M + Q + n];
      v[Q + n] = z[n] * w[n] - z[M - 1 - n] * w[M - 1 - n];
    }
    for (n = 0; n < H; n++) {
      var x = v[2 * n], y = v[M - 1 - 2 * n];
      re[n] = x * this.wr[n] - y * this.wi[n]; im[n] = x * this.wi[n] + y * this.wr[n];
    }
    var rev = this.rev;
    for (n = 0; n < H; n++) { var j = rev[n]; if (j > n) { var t = re[n]; re[n] = re[j]; re[j] = t; t = im[n]; im[n] = im[j]; im[j] = t; } }
    for (var s = 2; s <= H; s <<= 1) {
      var h = s >> 1, st = H / s;
      for (var i0 = 0; i0 < H; i0 += s) for (var q = 0; q < h; q++) {
        var cr = this.fc[q * st], ci = this.fs[q * st], a = i0 + q, b = a + h;
        var tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
    for (k = 0; k < H; k++) {
      var xr = re[k], xi = im[k];
      out[2 * k] = (xr * this.pr[k] - xi * this.pi[k]) * gain;
      out[M - 1 - 2 * k] = -(xr * this.pi[k] + xi * this.pr[k]) * gain;
    }
  };

  // ---------- quantising and counting ----------
  function stepOf(sf) { return Math.pow(2, (sf - 100) / 4); }
  // xa = |x|^0.75, worked out once per frame
  function quantBand(x, xa, q, a, b, sf) {
    var inv = Math.pow(2, -0.1875 * (sf - 100)), mx = 0;
    for (var i = a; i < b; i++) {
      var v = Math.floor(xa[i] * inv + 0.4054);
      if (v > MAX_Q) v = MAX_Q;
      q[i] = x[i] < 0 ? -v : v;
      if (v > mx) mx = v;
    }
    return mx;
  }
  function escBits(v) { var n = 4; while (v >= (1 << (n + 1))) n++; return 2 * n - 3; }   // N ones, a zero, N+4 bits
  // bits of q[a..b) in book cb (Infinity when a value does not fit)
  function bookBits(q, a, b, cb) {
    var B = BOOKS[cb], bits = 0, lav = B.lav, i, j, v, idx;
    if (B.dim === 4) {
      for (i = a; i < b; i += 4) {
        idx = 0;
        for (j = 0; j < 4; j++) {
          v = q[i + j];
          if (v > lav || v < -lav) return Infinity;
          idx = idx * 3 + (B.sgn ? v + 1 : (v < 0 ? -v : v));
          if (!B.sgn && v) bits++;
        }
        bits += B.b[idx];
      }
    } else {
      var md = B.sgn ? 2 * lav + 1 : lav + 1;
      for (i = a; i < b; i += 2) {
        idx = 0;
        for (j = 0; j < 2; j++) {
          v = q[i + j]; var u = v < 0 ? -v : v;
          if (cb === 11) { if (u >= 16) { bits += escBits(u); u = 16; } }
          else if (u > lav) return Infinity;
          idx = idx * md + (B.sgn ? v + lav : u);
          if (!B.sgn && v) bits++;
        }
        bits += B.b[idx];
      }
    }
    return bits;
  }
  function writeBand(w, q, a, b, cb) {
    var B = BOOKS[cb], lav = B.lav, i, j, v, idx, k;
    var md = B.dim === 4 ? 3 : B.sgn ? 2 * lav + 1 : lav + 1;
    for (i = a; i < b; i += B.dim) {
      idx = 0;
      for (j = 0; j < B.dim; j++) {
        v = q[i + j]; var u = v < 0 ? -v : v;
        if (cb === 11 && u >= 16) u = 16;
        idx = idx * md + (B.sgn ? v + lav : u);
      }
      w.put(B.c[idx], B.b[idx]);
      if (!B.sgn) {
        for (j = 0; j < B.dim; j++) if (q[i + j]) w.put(q[i + j] < 0 ? 1 : 0, 1);
        if (cb === 11) for (j = 0; j < 2; j++) {
          v = Math.abs(q[i + j]);
          if (v < 16) continue;
          var n = 4; while (v >= (1 << (n + 1))) n++;
          for (k = 4; k < n; k++) w.put(1, 1);
          w.put(0, 1);
          w.put(v - (1 << n), n);
        }
      }
    }
  }
  // the books a band can use, cheapest first is chosen by the caller
  // the codeword of all zeros in each book
  var ZERO_BITS = [0];
  for (var zb = 1; zb < 12; zb++) ZERO_BITS.push(BOOKS[zb].b[BOOKS[zb].sgn ? (BOOKS[zb].dim === 4 ? 40 : (BOOKS[zb].lav * 2 + 2) * BOOKS[zb].lav) : 0]);
  // bits of the band in every book (Infinity where a value does not fit); a band of zeros in a
  // coded section also sends its scale factor ("no change", 1 bit)
  function bandCosts(q, a, b, mx, out) {
    var cb;
    if (!mx) { out[0] = 0; for (cb = 1; cb < 12; cb++) out[cb] = (b - a) / BOOKS[cb].dim * ZERO_BITS[cb] + 1; return; }
    var first = mx <= 1 ? 1 : mx <= 2 ? 3 : mx <= 4 ? 5 : mx <= 7 ? 7 : mx <= 12 ? 9 : 11;
    for (cb = 0; cb < first; cb++) out[cb] = Infinity;
    for (cb = first; cb < 12; cb++) out[cb] = bookBits(q, a, b, cb);
  }

  // ---------- one channel ----------
  function Channel(nb) {
    this.x = new Float64Array(FRAME); this.xa = new Float64Array(FRAME); this.q = new Int32Array(FRAME);
    this.sf = new Int32Array(nb); this.mx = new Int32Array(nb); this.base = new Float64Array(nb); this.allow = new Float64Array(nb);
    this.root = new Float64Array(nb); this.peak = new Float64Array(nb);
    this.cost = []; for (var i = 0; i < nb; i++) this.cost.push(new Float64Array(12));
    this.pre = []; this.bad = [];
    for (i = 0; i < 12; i++) { this.pre.push(new Float64Array(nb + 1)); this.bad.push(new Int32Array(nb + 1)); }
    this.sect = [];                  // [{ cb, a, b }] in bands
    this.bits = 0;
  }
  // threshold of hearing per line, in the units of the spectrum (a full-scale sine ≈ 96 dB SPL)
  function athLine(f) {
    var k = Math.max(f, 20) / 1000;
    var db = 3.64 * Math.pow(k, -0.8) - 6.5 * Math.exp(-0.6 * (k - 3.3) * (k - 3.3)) + 0.001 * Math.pow(k, 4);
    db = Math.min(db, 96);
    var full = SCALE * N / 2;                // the MDCT peak of a full-scale sine
    return full * full * Math.pow(10, (db - 96) / 10);
  }

  // the allowed noise per band for a signal-to-noise ratio `snr` (dB): the band's own energy
  // less `snr`, spread to its neighbours (a loud band masks about -12 dB per band upwards and
  // -24 dB per band downwards), never under the threshold of hearing
  Channel.prototype.masks = function (enc, snr) {
    var nb = enc.nb, off = enc.off, d = this.allow, k = Math.pow(10, -snr / 10), b, w;
    // and nothing finer than `snr` + 20 dB under the loudest band of the frame, so a quiet noise
    // floor far from the voice does not take the bits the voice needs
    var top = 0;
    for (b = 0; b < nb; b++) { d[b] = this.base[b] > 0 ? this.base[b] * k / (off[b + 1] - off[b]) : 0; if (d[b] > top) top = d[b]; }
    top *= 0.01;
    for (b = 1; b < nb; b++) d[b] = Math.max(d[b], d[b - 1] * 0.063);
    for (b = nb - 2; b >= 0; b--) d[b] = Math.max(d[b], d[b + 1] * 0.004);
    for (b = 0; b < nb; b++) { w = off[b + 1] - off[b]; d[b] = Math.max(d[b], enc.ath[b], top) * w; }
  };
  // quantise the channel for a signal-to-noise ratio `snr` (dB), plan its sections; returns its bits
  Channel.prototype.plan = function (enc, snr) {
    var off = enc.off, nb = enc.nb, x = this.x, q = this.q, sf = this.sf, mx = this.mx, b, i, prev = -1;
    this.masks(enc, snr);
    for (b = 0; b < nb; b++) {
      var a0 = off[b], a1 = off[b + 1];
      if (this.base[b] < 0 || this.base[b] <= this.allow[b]) { mx[b] = 0; for (i = a0; i < a1; i++) q[i] = 0; sf[b] = prev < 0 ? 100 : prev; continue; }
      // the step from noise ≈ 4/27 · step^1.5 · Σ√|x|
      var r = this.root[b], peak = this.peak[b];
      var s = Math.round(100 + 4 * Math.log2(Math.pow(27 * this.allow[b] / (4 * r), 2 / 3)));
      var lo = Math.ceil(100 + 4 * Math.log2(peak / Math.pow(MAX_Q, 4 / 3) + 1e-30));
      if (s < lo) s = lo;
      if (prev >= 0) s = Math.max(prev - 60, Math.min(prev + 60, s));
      s = Math.max(SF_MIN, Math.min(SF_MAX, s));
      mx[b] = quantBand(x, this.xa, q, a0, a1, s);
      sf[b] = s;
      if (mx[b]) prev = s;
      else sf[b] = prev < 0 ? s : prev;
    }
    return this.sections(enc);
  };
  // the cheapest book per band, then neighbours merged while that saves bits
  Channel.prototype.sections = function (enc) {
    var nb = enc.nb, off = enc.off, q = this.q, mx = this.mx, cost = this.cost, P = this.pre, F = this.bad, b, cb, i;
    for (b = 0; b < nb; b++) bandCosts(q, off[b], off[b + 1], mx[b], cost[b]);
    // prefix sums per book: the finite bits and how many bands do not fit
    for (cb = 0; cb < 12; cb++) {
      var row = P[cb], bad = F[cb]; row[0] = 0; bad[0] = 0;
      for (b = 0; b < nb; b++) {
        var c = cost[b][cb];
        if (c === Infinity) { row[b + 1] = row[b]; bad[b + 1] = bad[b] + 1; } else { row[b + 1] = row[b] + c; bad[b + 1] = bad[b]; }
      }
    }
    // bits of bands a..z-1 as one section in book cbx (its 9 header bits included)
    var secCost = function (a, z, cbx) { return F[cbx][z] !== F[cbx][a] ? Infinity : P[cbx][z] - P[cbx][a] + 9; };
    var S = [];
    for (b = 0; b < nb; b++) {
      var best = 0, bc = Infinity;
      for (cb = 0; cb < 12; cb++) if (cost[b][cb] < bc) { bc = cost[b][cb]; best = cb; }
      S.push({ a: b, b: b + 1, cb: best, bits: bc + 9 });
    }
    for (;;) {
      var gain = 0, at = -1, nbk = 0, nbits = 0;
      for (i = 0; i + 1 < S.length; i++) {
        var A = S[i], B = S[i + 1], lo = Math.max(A.cb, B.cb);
        for (cb = lo ? lo : 0; cb < 12; cb++) {
          if (cb === 0 && lo) continue;
          var m = secCost(A.a, B.b, cb), g = A.bits + B.bits - m;
          if (g > gain) { gain = g; at = i; nbk = cb; nbits = m; }
          if (!lo) break;
        }
      }
      if (at < 0) break;
      S.splice(at, 2, { a: S[at].a, b: S[at + 1].b, cb: nbk, bits: nbits });
    }
    this.sect = S;
    var tot = 0;
    for (i = 0; i < S.length; i++) {
      tot += 9 + Math.floor((S[i].b - S[i].a) / 31) * 5;
      if (S[i].cb) for (b = S[i].a; b < S[i].b; b++) if (mx[b]) tot += cost[b][S[i].cb]; else tot += cost[b][S[i].cb] - 1;
    }
    this.bits = tot + this.sfBits() + 8 + 11 + 3;         // global gain, ics_info, pulse/TNS/gain control flags
    return this.bits;
  };
  Channel.prototype.firstSf = function () {
    for (var i = 0; i < this.sect.length; i++) if (this.sect[i].cb) return this.sf[this.sect[i].a];
    return 100;
  };
  Channel.prototype.sfBits = function () {
    var last = this.firstSf(), bits = 0, S = this.sect;
    for (var i = 0; i < S.length; i++) {
      if (!S[i].cb) continue;
      for (var b = S[i].a; b < S[i].b; b++) {
        var s = this.mx[b] ? this.sf[b] : last;
        bits += SFB[s - last + 60];
        last = s;
      }
    }
    return bits;
  };
  // individual_channel_stream (common_window = 0)
  Channel.prototype.write = function (w, enc) {
    var S = this.sect, off = enc.off, gg = this.firstSf(), i, b;
    w.put(gg, 8);
    w.put(0, 1); w.put(0, 2); w.put(0, 1);                // reserved, ONLY_LONG_SEQUENCE, sine window
    w.put(enc.nb, 6); w.put(0, 1);                        // max_sfb, no prediction
    for (i = 0; i < S.length; i++) {
      w.put(S[i].cb, 4);
      var len = S[i].b - S[i].a;
      while (len >= 31) { w.put(31, 5); len -= 31; }
      w.put(len, 5);
    }
    var last = gg;
    for (i = 0; i < S.length; i++) {
      if (!S[i].cb) continue;
      for (b = S[i].a; b < S[i].b; b++) {
        var s = this.mx[b] ? this.sf[b] : last;
        w.put(SFC[s - last + 60], SFB[s - last + 60]);
        last = s;
      }
    }
    w.put(0, 1); w.put(0, 1); w.put(0, 1);                // no pulse, TNS or gain control data
    for (i = 0; i < S.length; i++) {
      if (!S[i].cb) continue;
      for (b = S[i].a; b < S[i].b; b++) writeBand(w, this.q, off[b], off[b + 1], S[i].cb);
    }
  };

  // ---------- the encoder ----------
  function Encoder(chans, rate, kbps, opts) {
    opts = opts || {};
    if (!chans || !chans.length || chans.length > 2) throw new Error("channels");
    rate = Math.round(rate);
    var ri = RATES.indexOf(rate);
    if (ri < 3) throw new Error("rate");
    this.ri = ri; this.rate = rate; this.ch = chans.length; this.chans = chans;
    this.n = chans[0].length; this.base = 0; this.open = false;
    this.kbps = Math.max(8 * this.ch, Math.min(160 * this.ch, Math.round(kbps) || 64 * this.ch));
    // bandwidth from the bit rate per channel
    var per = this.kbps / this.ch;
    var bw = per < 16 ? 5000 : per < 24 ? 8000 : per < 32 ? 11000 : per < 48 ? 14000 : per < 64 ? 16000 : per < 96 ? 18000 : 20000;
    if (opts.bandwidth) bw = opts.bandwidth;
    bw = Math.min(bw, rate / 2);
    var swb = swbOf(rate), line = Math.floor(bw * N / rate), nb = 0;
    while (nb < swb.length - 1 && swb[nb] < line) nb++;
    this.off = swb; this.nb = nb; this.line = line;
    this.ath = new Float64Array(nb);
    for (var b = 0; b < nb; b++) {
      var m = Infinity;
      for (var l = swb[b]; l < swb[b + 1]; l++) m = Math.min(m, athLine((l + 0.5) * rate / N));
      this.ath[b] = m;
    }
    this.budget = this.kbps * 1000 * FRAME / rate;
    this.res = 0; this.maxRes = Math.max(0, MAX_BITS * this.ch - this.budget);
    this.mdct = new Mdct();
    this.chs = []; for (var c = 0; c < this.ch; c++) this.chs.push(new Channel(nb));
    this.z = new Float64Array(N);
    this.total = Math.ceil(this.n / FRAME) + 1;           // the decoder's first frame is priming
    this.frame = 0; this.snr = 12;
    this.out = []; this.result = null;
    this.w = new BitWriter(MAX_BITS * this.ch / 8 + 64);
  }
  Encoder.prototype.delay = FRAME;
  Encoder.prototype.progress = function () { return Math.min(1, this.frame / this.total); };
  Encoder.prototype.step = function (frames) {
    if (this.result) return true;
    for (var f = 0; f < (frames || 32) && this.frame < this.total; f++) this.encodeFrame();
    if (this.frame >= this.total) { this.result = true; return true; }
    return false;
  };
  Encoder.prototype.analyse = function () {
    var a = (this.frame - 1) * FRAME - this.base, z = this.z, n = this.n - this.base, line = this.line;
    for (var c = 0; c < this.ch; c++) {
      var src = this.chans[c], C = this.chs[c];
      for (var i = 0; i < N; i++) { var j = a + i; z[i] = j >= 0 && j < n ? src[j] : 0; }
      this.mdct.run(z, C.x, SCALE * 2);       // the standard forward MDCT carries a factor 2
      for (i = line; i < FRAME; i++) C.x[i] = 0;
      for (var b = 0; b < this.nb; b++) {
        var e = 0, r = 0, pk = 0;
        for (i = this.off[b]; i < this.off[b + 1]; i++) {
          var v = Math.abs(C.x[i]);
          e += v * v; r += Math.sqrt(v); if (v > pk) pk = v;
          C.xa[i] = Math.pow(v, 0.75);
        }
        C.base[b] = e > 1e-6 ? e : -1; C.root[b] = r; C.peak[b] = pk;
      }
    }
  };
  Encoder.prototype.bitsAt = function (snr) {
    var t = this.ch === 1 ? 7 : 8;                        // element id + tag (+ common_window), END
    for (var c = 0; c < this.ch; c++) t += this.chs[c].plan(this, snr);
    return t + 3 + 7;                                     // END and byte alignment at worst
  };
  Encoder.prototype.encodeFrame = function () {
    this.analyse();
    var cap = Math.min(MAX_BITS * this.ch, this.budget + this.res);
    var target = Math.min(cap, this.budget + this.res * 0.3);
    var lo = -30, hi = 60, snr = this.snr, bits = this.bitsAt(snr), it;
    // bisection on the signal-to-noise ratio: the best quality that fits
    if (bits <= target) lo = snr; else hi = snr;
    for (it = 0; it < 8 && hi - lo > 0.5; it++) {
      var mid = it === 0 ? (bits <= target ? Math.min(hi, snr + 3) : Math.max(lo, snr - 3)) : (lo + hi) / 2;
      bits = this.bitsAt(mid);
      if (bits <= target) lo = mid; else hi = mid;
    }
    bits = this.bitsAt(lo);
    var extra = 0;
    while (bits > cap && extra < 64) {                    // very low rates: coarser steps all over
      extra += 4;
      for (var c = 0; c < this.ch; c++) this.chs[c].coarser(this, lo, extra);
      bits = this.frameBits();
    }
    this.snr = lo;
    var w = this.w; w.pos = 0; w.acc = 0; w.n = 0;
    if (this.ch === 1) { w.put(0, 3); w.put(0, 4); this.chs[0].write(w, this); }
    else { w.put(1, 3); w.put(0, 4); w.put(0, 1); this.chs[0].write(w, this); this.chs[1].write(w, this); }
    w.put(7, 3); w.align();
    var au = w.bytes();
    this.res = Math.max(0, Math.min(this.maxRes, this.res + this.budget - au.length * 8));
    this.out.push(au);
    this.frame++;
  };
  Encoder.prototype.frameBits = function () {
    var t = this.ch === 1 ? 7 : 8;
    for (var c = 0; c < this.ch; c++) t += this.chs[c].bits;
    return t + 10;
  };
  Channel.prototype.coarser = function (enc, snr, extra) {
    this.plan(enc, snr);
    var off = enc.off;
    for (var b = 0; b < enc.nb; b++) if (this.mx[b]) {
      this.sf[b] = Math.min(SF_MAX, this.sf[b] + extra);
      this.mx[b] = quantBand(this.x, this.xa, this.q, off[b], off[b + 1], this.sf[b]);
    }
    return this.sections(enc);
  };
  Encoder.prototype.units = function () { return this.out; };
  // A stream: new StudioAac.Stream(channels, rate, kbps), then push([L, R?]) as the audio
  // comes (any lengths; frames are encoded as soon as they are whole) and end() once.
  // Only the last frame's samples are kept between pushes, so a whole book fits.
  function Stream(ch, rate, kbps, opts) {
    var empty = []; for (var c = 0; c < ch; c++) empty.push(new Float32Array(0));
    Encoder.call(this, empty, rate, kbps, opts);
    this.open = true; this.total = Infinity;
  }
  Stream.prototype = Object.create(Encoder.prototype);
  Stream.prototype.constructor = Stream;
  Stream.prototype.push = function (chans) {
    if (!this.open) throw new Error("ended");
    if (!chans || chans.length !== this.ch) throw new Error("channels");
    var keep = Math.max(0, (this.frame - 1) * FRAME), add = chans[0].length;
    for (var c = 0; c < this.ch; c++) {
      var old = this.chans[c], from = keep - this.base, buf = new Float32Array(old.length - from + add);
      buf.set(old.subarray(from)); buf.set(chans[c].subarray(0, add), old.length - from);
      this.chans[c] = buf;
    }
    this.base = keep; this.n += add;
    while ((this.frame + 1) * FRAME <= this.n) this.encodeFrame();
  };
  Stream.prototype.end = function () {
    if (!this.open) return;
    this.open = false; this.total = Math.ceil(this.n / FRAME) + 1;
    while (this.frame < this.total) this.encodeFrame();
    this.result = true;
  };
  // AudioSpecificConfig: AAC LC, the rate index, the channel configuration, GASpecificConfig all zero
  Encoder.prototype.asc = function () {
    return new Uint8Array([(2 << 3) | (this.ri >> 1), ((this.ri & 1) << 7) | (this.ch << 3)]);
  };
  Encoder.prototype.adts = function () {
    var size = 0, i;
    for (i = 0; i < this.out.length; i++) size += this.out[i].length + 7;
    var buf = new Uint8Array(size), p = 0;
    for (i = 0; i < this.out.length; i++) {
      var au = this.out[i], len = au.length + 7;
      buf[p] = 0xFF; buf[p + 1] = 0xF1;                   // sync, MPEG-4, layer 0, no CRC
      buf[p + 2] = (1 << 6) | (this.ri << 2) | (this.ch >> 2);
      buf[p + 3] = ((this.ch & 3) << 6) | (len >> 11);
      buf[p + 4] = (len >> 3) & 255;
      buf[p + 5] = ((len & 7) << 5) | 0x1F;               // buffer fullness 0x7FF: variable rate
      buf[p + 6] = 0xFC;
      buf.set(au, p + 7); p += len;
    }
    return buf;
  };
  function encode(chans, rate, kbps, opts) {
    var e = new Encoder(chans, rate, kbps, opts);
    while (!e.step(64)) {}
    return e;
  }

  var api = { VERSION: "1.0.0", Encoder: Encoder, Stream: Stream, encode: encode, RATES: RATES, FRAME: FRAME,
              _test: { BOOKS: BOOKS, SFC: SFC, SFB: SFB, swbOf: swbOf, Mdct: Mdct, BitWriter: BitWriter } };
  root.StudioAac = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
