// ============================================================
// orOS Studio — audio file encoders (v1.0.0)
// Pure code, no DOM: what Export writes besides WAV.
//   - MP3: an MPEG-1 Layer III encoder written for orOS (CBR 128, 192
//     or 320 kbit/s, 44.1 or 48 kHz, mono or stereo). Long blocks only,
//     no psychoacoustic model and no bit reservoir: each frame carries
//     its own data, the step size is searched per granule so the data
//     fits. Clean at 192 kbit/s and up for a song mix.
//   - Ogg Opus: the Ogg pages (RFC 3533) around Opus packets (RFC 7845).
//     The packets come from the browser's own encoder (WebCodecs
//     AudioEncoder, see encodeOpus); no live recorder API is used.
//   - ID3v2.4 title tag for MP3, Opus comment header for Ogg.
// Loaded by studio.js (window.StudioEncode) and by the tests.
// ============================================================
(function (root) {
  "use strict";

  // ISO/IEC 11172-3 synthesis window D[0..256] x 65536 (the rest follows from
  // D[512-i] = -D[i], except at multiples of 64); analysis window C = D / 32.
  var DWIN = [0,-1,-1,-1,-1,-1,-1,-2,-2,-2,-2,-3,-3,-4,-4,-5,-5,-6,-7,-7,-8,-9,-10,-11,-13,-14,-16,-17,-19,-21,
    -24,-26,-29,-31,-35,-38,-41,-45,-49,-53,-58,-63,-68,-73,-79,-85,-91,-97,-104,-111,-117,-125,-132,-139,-147,
    -154,-161,-169,-176,-183,-190,-196,-202,-208,213,218,222,225,227,228,228,227,224,221,215,208,200,189,177,
    163,146,127,106,83,57,29,-2,-36,-72,-111,-153,-197,-244,-294,-347,-401,-459,-519,-581,-645,-711,-779,-848,
    -919,-991,-1064,-1137,-1210,-1283,-1356,-1428,-1498,-1567,-1634,-1698,-1759,-1817,-1870,-1919,-1962,-2001,
    -2032,-2057,-2075,-2085,-2087,-2080,-2063,2037,2000,1952,1893,1822,1739,1644,1535,1414,1280,1131,970,794,
    605,402,185,-45,-288,-545,-814,-1095,-1388,-1692,-2006,-2330,-2663,-3004,-3351,-3705,-4063,-4425,-4788,
    -5153,-5517,-5879,-6237,-6589,-6935,-7271,-7597,-7910,-8209,-8491,-8755,-8998,-9219,-9416,-9585,-9727,-9838,
    -9916,-9959,-9966,-9935,-9863,-9750,-9592,-9389,-9139,-8840,-8492,-8092,-7640,-7134,6574,5959,5288,4561,
    3776,2935,2037,1082,70,-998,-2122,-3300,-4533,-5818,-7154,-8540,-9975,-11455,-12980,-14548,-16155,-17799,
    -19478,-21189,-22929,-24694,-26482,-28289,-30112,-31947,-33791,-35640,-37489,-39336,-41176,-43006,-44821,
    -46617,-48390,-50137,-51853,-53534,-55178,-56778,-58333,-59838,-61289,-62684,-64019,-65290,-66494,-67629,
    -68692,-69679,-70590,-71420,-72169,-72835,-73415,-73908,-74313,-74630,-74856,-74992,75038];
  // Huffman codes of ISO/IEC 11172-3 Annex B, as [code, length] per (x, y) in
  // row order (count1 tables 32 and 33: per 4-bit value vwxy). Generated from the
  // decoder trees of PDMP3 (public domain, Unlicense) and checked complete.
  var HUFF = {
    1: [1,1,1,3,1,2,0,3],
    2: [1,1,2,3,1,6,3,3,1,3,1,5,3,5,2,5,0,6],
    3: [3,2,2,2,1,6,1,3,1,2,1,5,3,5,2,5,0,6],
    5: [1,1,2,3,6,6,5,7,3,3,1,3,4,6,4,7,7,6,5,6,7,7,1,8,6,7,1,6,1,7,0,8],
    6: [7,3,3,3,5,5,1,7,6,3,2,2,3,4,2,5,5,4,4,4,4,5,1,6,3,6,3,5,2,6,0,7],
    7: [1,1,2,3,10,6,19,8,16,8,10,9,3,3,3,4,7,6,10,7,5,7,3,8,11,6,4,5,13,7,17,8,8,8,4,9,12,7,11,7,18,8,15,9,11,
      9,2,9,7,7,6,7,9,8,14,9,3,9,1,10,6,8,4,8,5,9,3,10,2,10,0,10],
    8: [3,2,4,3,6,6,18,8,12,8,5,9,5,3,1,2,2,4,16,8,9,8,3,8,7,6,3,4,5,6,14,8,7,8,3,9,19,8,17,8,15,8,13,9,10,9,4,
      10,13,8,5,7,8,8,11,9,5,10,1,10,12,9,4,8,4,9,1,9,1,11,0,11],
    9: [7,3,5,3,9,5,14,6,15,8,7,9,6,3,4,3,5,4,5,5,6,6,7,8,7,4,6,4,8,5,8,6,8,7,5,8,15,6,6,5,9,6,10,7,5,7,1,8,11,
      7,7,6,9,7,6,7,4,8,1,9,14,8,4,7,6,8,2,8,6,9,0,9],
    10: [1,1,2,3,10,6,23,8,35,9,30,9,12,9,17,10,3,3,3,4,8,6,12,7,18,8,21,9,12,8,7,8,11,6,9,6,15,7,21,8,32,9,40,
      10,19,9,6,9,14,7,13,7,22,8,34,9,46,10,23,10,18,9,7,10,20,8,19,8,33,9,47,10,27,10,22,10,9,10,3,10,31,9,22,
      9,41,10,26,10,21,11,20,11,5,10,3,11,14,8,13,8,10,9,11,10,16,10,6,10,5,11,1,11,9,9,8,8,7,9,8,10,4,10,4,11,
      2,11,0,11],
    11: [3,2,4,3,10,5,24,7,34,8,33,9,21,8,15,9,5,3,3,3,4,4,10,6,32,8,17,8,11,7,10,8,11,5,7,5,13,6,18,7,30,8,31,
      9,20,8,5,8,25,7,11,6,19,7,59,9,27,8,18,10,12,8,5,9,35,8,33,8,31,8,58,9,30,9,16,10,7,9,5,10,28,8,26,8,32,9,
      19,10,17,10,15,11,8,10,14,11,14,8,12,7,9,7,13,8,14,9,9,10,4,10,1,10,11,8,4,7,6,8,6,9,6,10,3,10,2,10,0,10],
    12: [9,4,6,3,16,5,33,7,41,8,39,9,38,9,26,9,7,3,5,3,6,4,9,5,23,7,16,7,26,8,11,8,17,5,7,4,11,5,14,6,21,7,30,8,
      10,7,7,8,17,6,10,5,15,6,12,6,18,7,28,8,14,8,5,8,32,7,13,6,22,7,19,7,18,8,16,8,9,8,5,9,40,8,17,7,31,8,29,8,
      17,8,13,9,4,8,2,9,27,8,12,7,11,7,15,8,10,8,7,9,4,9,1,10,27,9,12,8,8,8,12,9,6,9,3,9,1,9,0,10],
    13: [1,1,5,4,14,6,21,7,34,8,51,9,46,9,71,10,42,9,52,10,68,11,52,11,67,12,44,12,43,13,19,13,3,3,4,4,12,6,19,
      7,31,8,26,8,44,9,33,9,31,9,24,9,32,10,24,10,31,11,35,12,22,12,14,12,15,6,13,6,23,7,36,8,59,9,49,9,77,10,
      65,10,29,9,40,10,30,10,40,11,27,11,33,12,42,13,16,13,22,7,20,7,37,8,61,9,56,9,79,10,73,10,64,10,43,10,76,
      11,56,11,37,11,26,11,31,12,25,13,14,13,35,8,16,7,60,9,57,9,97,10,75,10,114,11,91,11,54,10,73,11,55,11,41,
      12,48,12,53,13,23,13,24,14,58,9,27,8,50,9,96,10,76,10,70,10,93,11,84,11,77,11,58,11,79,12,29,11,74,13,49,
      13,41,14,17,14,47,9,45,9,78,10,74,10,115,11,94,11,90,11,79,11,69,11,83,12,71,12,50,12,59,13,38,13,36,14,
      15,14,72,10,34,9,56,10,95,11,92,11,85,11,91,12,90,12,86,12,73,12,77,13,65,13,51,13,44,14,43,16,42,16,43,9,
      20,8,30,9,44,10,55,10,78,11,72,11,87,12,78,12,61,12,46,12,54,13,37,13,30,14,20,15,16,15,53,10,25,9,41,10,
      37,10,44,11,59,11,54,11,81,13,66,12,76,13,57,13,54,14,37,14,18,14,39,16,11,15,35,10,33,10,31,10,57,11,42,
      11,82,12,72,12,80,13,47,12,58,13,55,14,21,13,22,14,26,15,38,16,22,17,53,11,25,10,23,10,38,11,70,12,60,12,
      51,12,36,12,55,13,26,13,34,13,23,14,27,15,14,15,9,15,7,16,34,11,32,11,28,11,39,12,49,12,75,13,30,12,52,13,
      48,14,40,14,52,15,28,15,18,15,17,16,9,16,5,16,45,12,21,11,34,12,64,13,56,13,50,13,49,14,45,14,31,14,19,14,
      12,14,15,15,10,16,7,15,6,16,3,16,48,13,23,12,20,12,39,13,36,13,35,13,53,15,21,14,16,14,23,17,13,15,10,15,
      6,15,1,17,4,16,2,16,16,12,15,12,17,13,27,14,25,14,20,14,29,15,11,14,17,15,12,15,16,16,8,16,1,19,1,18,0,19,
      1,16],
    15: [7,3,12,4,18,5,53,7,47,7,76,8,124,9,108,9,89,9,123,10,108,10,119,11,107,11,81,11,122,12,63,13,13,4,5,3,
      16,5,27,6,46,7,36,7,61,8,51,8,42,8,70,9,52,9,83,10,65,10,41,10,59,11,36,11,19,5,17,5,15,5,24,6,41,7,34,7,
      59,8,48,8,40,8,64,9,50,9,78,10,62,10,80,11,56,11,33,11,29,6,28,6,25,6,43,7,39,7,63,8,55,8,93,9,76,9,59,9,
      93,10,72,10,54,10,75,11,50,11,29,11,52,7,22,6,42,7,40,7,67,8,57,8,95,9,79,9,72,9,57,9,89,10,69,10,49,10,
      66,11,46,11,27,11,77,8,37,7,35,7,66,8,58,8,52,8,91,9,74,9,62,9,48,9,79,10,63,10,90,11,62,11,40,11,38,12,
      125,9,32,7,60,8,56,8,50,8,92,9,78,9,65,9,55,9,87,10,71,10,51,10,73,11,51,11,70,12,30,12,109,9,53,8,49,8,
      94,9,88,9,75,9,66,9,122,10,91,10,73,10,56,10,42,10,64,11,44,11,21,11,25,12,90,9,43,8,41,8,77,9,73,9,63,9,
      56,9,92,10,77,10,66,10,47,10,67,11,48,11,53,12,36,12,20,12,71,9,34,8,67,9,60,9,58,9,49,9,88,10,76,10,67,
      10,106,11,71,11,54,11,38,11,39,12,23,12,15,12,109,10,53,9,51,9,47,9,90,10,82,10,58,10,57,10,48,10,72,11,
      57,11,41,11,23,11,27,12,62,13,9,12,86,10,42,9,40,9,37,9,70,10,64,10,52,10,43,10,70,11,55,11,42,11,25,11,
      29,12,18,12,11,12,11,13,118,11,68,10,30,9,55,10,50,10,46,10,74,11,65,11,49,11,39,11,24,11,16,11,22,12,13,
      12,14,13,7,13,91,11,44,10,39,10,38,10,34,10,63,11,52,11,45,11,31,11,52,12,28,12,19,12,14,12,8,12,9,13,3,
      13,123,12,60,11,58,11,53,11,47,11,43,11,32,11,22,11,37,12,24,12,17,12,12,12,15,13,10,13,2,12,1,13,71,12,
      37,11,34,11,30,11,28,11,20,11,17,11,26,12,21,12,16,12,10,12,6,12,8,13,6,13,2,13,0,13],
    16: [1,1,5,4,14,6,44,8,74,9,63,9,110,10,93,10,172,11,149,11,138,11,242,12,225,12,195,12,376,13,17,9,3,3,4,4,
      12,6,20,7,35,8,62,9,53,9,47,9,83,10,75,10,68,10,119,11,201,12,107,11,207,12,9,8,15,6,13,6,23,7,38,8,67,9,
      58,9,103,10,90,10,161,11,72,10,127,11,117,11,110,11,209,12,206,12,16,9,45,8,21,7,39,8,69,9,64,9,114,10,99,
      10,87,10,158,11,140,11,252,12,212,12,199,12,387,13,365,13,26,10,75,9,36,8,68,9,65,9,115,10,101,10,179,11,
      164,11,155,11,264,12,246,12,226,12,395,13,382,13,362,13,9,9,66,9,30,8,59,9,56,9,102,10,185,11,173,11,265,
      12,142,11,253,12,232,12,400,13,388,13,378,13,445,14,16,10,111,10,54,9,52,9,100,10,184,11,178,11,160,11,
      133,11,257,12,244,12,228,12,217,12,385,13,366,13,715,14,10,10,98,10,48,9,91,10,88,10,165,11,157,11,148,11,
      261,12,248,12,407,13,397,13,372,13,380,13,889,15,884,15,8,10,85,10,84,10,81,10,159,11,156,11,143,11,260,
      12,249,12,427,13,401,13,392,13,383,13,727,14,713,14,708,14,7,10,154,11,76,10,73,10,141,11,131,11,256,12,
      245,12,426,13,406,13,394,13,384,13,735,14,359,13,710,14,352,13,11,11,139,11,129,11,67,10,125,11,247,12,
      233,12,229,12,219,12,393,13,743,14,737,14,720,14,885,15,882,15,439,14,4,10,243,12,120,11,118,11,115,11,
      227,12,223,12,396,13,746,14,742,14,736,14,721,14,712,14,706,14,223,13,436,14,6,11,202,12,224,12,222,12,
      218,12,216,12,389,13,386,13,381,13,364,13,888,15,443,14,707,14,440,14,437,14,1728,16,4,11,747,14,211,12,
      210,12,208,12,370,13,379,13,734,14,723,14,714,14,1735,16,883,15,877,15,876,15,3459,17,865,15,2,11,377,13,
      369,13,102,11,187,12,726,14,722,14,358,13,711,14,709,14,866,15,1734,16,871,15,3458,17,870,15,434,14,0,11,
      12,9,10,8,7,8,11,9,10,9,17,10,11,10,9,10,13,11,12,11,10,11,7,11,5,11,3,11,1,11,3,8],
    24: [15,4,13,4,46,6,80,7,146,8,262,9,248,9,434,10,426,10,669,11,653,11,649,11,621,11,517,11,1032,12,88,9,14,
      4,12,4,21,5,38,6,71,7,130,8,122,8,216,9,209,9,198,9,327,10,345,10,319,10,297,10,279,10,42,8,47,6,22,5,41,
      6,74,7,68,7,128,8,120,8,221,9,207,9,194,9,182,9,340,10,315,10,295,10,541,11,18,7,81,7,39,6,75,7,70,7,134,
      8,125,8,116,8,220,9,204,9,190,9,178,9,325,10,311,10,293,10,271,10,16,7,147,8,72,7,69,7,135,8,127,8,118,8,
      112,8,210,9,200,9,188,9,352,10,323,10,306,10,285,10,540,11,14,7,263,9,66,7,129,8,126,8,119,8,114,8,214,9,
      202,9,192,9,180,9,341,10,317,10,301,10,281,10,262,10,12,7,249,9,123,8,121,8,117,8,113,8,215,9,206,9,195,9,
      185,9,347,10,330,10,308,10,291,10,272,10,520,11,10,7,435,10,115,8,111,8,109,8,211,9,203,9,196,9,187,9,353,
      10,332,10,313,10,298,10,283,10,531,11,381,11,17,8,427,10,212,9,208,9,205,9,201,9,193,9,186,9,177,9,169,9,
      320,10,303,10,286,10,268,10,514,11,377,11,16,8,335,10,199,9,197,9,191,9,189,9,181,9,174,9,333,10,321,10,
      305,10,289,10,275,10,521,11,379,11,371,11,11,8,668,11,184,9,183,9,179,9,175,9,344,10,331,10,314,10,304,10,
      290,10,277,10,530,11,383,11,373,11,366,11,10,8,652,11,346,10,171,9,168,9,164,9,318,10,309,10,299,10,287,
      10,276,10,263,10,513,11,375,11,368,11,362,11,6,8,648,11,322,10,316,10,312,10,307,10,302,10,292,10,284,10,
      269,10,261,10,512,11,376,11,370,11,364,11,359,11,4,8,620,11,300,10,296,10,294,10,288,10,282,10,273,10,266,
      10,515,11,380,11,374,11,369,11,365,11,361,11,357,11,2,8,1033,12,280,10,278,10,274,10,267,10,264,10,259,10,
      382,11,378,11,372,11,367,11,363,11,360,11,358,11,356,11,0,8,43,8,20,7,19,7,17,7,15,7,13,7,11,7,9,7,7,7,6,
      7,4,7,7,8,5,8,3,8,1,8,3,4],
    32: [1,1,5,4,4,4,5,5,6,4,5,6,4,5,4,6,7,4,3,5,6,5,0,6,7,5,2,6,3,6,1,6],
    33: [15,4,14,4,13,4,12,4,11,4,10,4,9,4,8,4,7,4,6,4,5,4,4,4,3,4,2,4,1,4,0,4]
  };

  // ---------- Bits ----------
  function BitWriter(bytes) { this.buf = new Uint8Array(bytes); this.pos = 0; }
  BitWriter.prototype.put = function (val, n) {            // n <= 24
    while (n > 0) {
      var bytePos = this.pos >> 3, free = 8 - (this.pos & 7), take = n < free ? n : free;
      var bits = (val >>> (n - take)) & ((1 << take) - 1);
      this.buf[bytePos] |= bits << (free - take);
      this.pos += take; n -= take;
    }
  };

  // ---------- MP3 constants ----------
  var MP3_RATES = { 44100: 0, 48000: 1, 32000: 2 };
  var MP3_KBPS = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  // long scalefactor band edges (ISO Table B.8), per sample rate index
  var SFB_L = [
    [0, 4, 8, 12, 16, 20, 24, 30, 36, 44, 52, 62, 74, 90, 110, 134, 162, 196, 238, 288, 342, 418, 576],
    [0, 4, 8, 12, 16, 20, 24, 30, 36, 42, 50, 60, 72, 88, 106, 128, 156, 190, 230, 276, 330, 384, 576],
    [0, 4, 8, 12, 16, 20, 24, 30, 36, 44, 54, 66, 82, 102, 126, 156, 194, 240, 296, 364, 448, 550, 576]
  ];
  // how to split the big values into three regions, by the number of bands they cover
  var SUBDV = [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 1], [1, 1], [1, 1], [1, 2], [2, 2], [2, 3], [2, 3],
               [3, 4], [3, 4], [3, 4], [4, 5], [4, 5], [4, 6], [5, 6], [5, 6], [5, 7], [6, 7], [6, 7]];
  var LIN16 = [1, 2, 3, 4, 6, 8, 10, 13], LIN24 = [4, 5, 6, 7, 8, 9, 11, 13];
  var SMALL = [[1, 1], [2, 2, 3], [3, 5, 6], [5, 7, 8, 9], [7, 10, 11, 12], [15, 13, 15]];   // [max value, tables…]
  var MAX_IX = 15 + 8191;

  var CWIN = new Float64Array(512), MAT = new Float64Array(32 * 33), MWIN = new Float64Array(36), MCOS = new Float64Array(18 * 36);
  var CS = new Float64Array(8), CA = new Float64Array(8);
  (function () {
    var i, k;
    for (i = 0; i <= 256; i++) CWIN[i] = DWIN[i] / 65536 / 32;
    for (i = 257; i < 512; i++) CWIN[i] = (i % 64 === 0 ? 1 : -1) * CWIN[512 - i];
    for (i = 0; i < 32; i++) for (k = 0; k <= 32; k++) MAT[i * 33 + k] = Math.cos((2 * i + 1) * k * Math.PI / 64);
    for (i = 0; i < 36; i++) MWIN[i] = Math.sin(Math.PI / 36 * (i + 0.5));
    for (k = 0; k < 18; k++) for (i = 0; i < 36; i++) MCOS[k * 36 + i] = Math.cos(Math.PI / 72 * (2 * i + 19) * (2 * k + 1)) / 9;
    var ci = [-0.6, -0.535, -0.33, -0.185, -0.095, -0.041, -0.0142, -0.0037];
    for (i = 0; i < 8; i++) { var sq = Math.sqrt(1 + ci[i] * ci[i]); CS[i] = 1 / sq; CA[i] = ci[i] / sq; }
  })();
  function table(t) {                                     // codes and lengths of big-value table t
    var base = t >= 24 ? 24 : t >= 16 ? 16 : t, h = HUFF[base];
    return { a: h, xlen: Math.round(Math.sqrt(h.length / 2)), lin: t >= 24 ? LIN24[t - 24] : t >= 16 ? LIN16[t - 16] : 0 };
  }
  var TABLES = [];
  for (var ti = 0; ti < 32; ti++) TABLES[ti] = ti === 0 || ti === 4 || ti === 14 ? null : table(ti);

  // ---------- MP3: frame layout ----------
  // Bytes in frame `n` (0-based) at this rate and bitrate: 144 * bitrate / rate,
  // plus one padding byte where the fraction adds up (44.1 kHz).
  function mp3FrameBytes(rate, kbps, n) {
    var num = 144000 * kbps, whole = Math.floor(num / rate), rest = num % rate;
    var pad = Math.floor((n + 1) * rest / rate) - Math.floor(n * rest / rate);
    return whole + pad;
  }
  function mp3Header(rate, kbps, ch, pad) {
    var bi = MP3_KBPS.indexOf(kbps), si = MP3_RATES[rate];
    if (bi <= 0 || si == null) throw new Error("mp3: unsupported rate or bitrate");
    return [0xff, 0xfb, (bi << 4) | (si << 2) | (pad ? 2 : 0), ((ch === 1 ? 3 : 0) << 6) | 4];   // no CRC, original
  }

  // ---------- MP3: quantise and count ----------
  function maxOf(ix, a, b) { var m = 0; for (var i = a; i < b; i++) if (ix[i] > m) m = ix[i]; return m; }
  function pairBits(T, ix, a, b) {
    var h = T.a, xl = T.xlen, lin = T.lin, n = 0;
    for (var i = a; i < b; i += 2) {
      var x = ix[i], y = ix[i + 1], xx = x > 15 ? 15 : x, yy = y > 15 ? 15 : y;
      n += h[(xx * xl + yy) * 2 + 1];
      if (x) n += 1 + (lin && x >= 15 ? lin : 0);
      if (y) n += 1 + (lin && y >= 15 ? lin : 0);
    }
    return n;
  }
  // The cheapest table for ix[a..b): { t, bits }
  function pickTable(ix, a, b) {
    if (b <= a) return { t: 0, bits: 0 };
    var mx = maxOf(ix, a, b), best = { t: 0, bits: 0 }, i;
    if (mx === 0) return best;
    best.bits = Infinity;
    if (mx <= 15) {
      for (var s = 0; s < SMALL.length; s++) {
        if (mx > SMALL[s][0]) continue;                   // the smallest tables that hold mx
        for (i = 1; i < SMALL[s].length; i++) {
          var t = SMALL[s][i], n = pairBits(TABLES[t], ix, a, b);
          if (n < best.bits) best = { t: t, bits: n };
        }
        return best;
      }
    }
    [[16, LIN16], [24, LIN24]].forEach(function (g) {
      for (var k = 0; k < 8; k++) {
        if (15 + (1 << g[1][k]) - 1 >= mx) {
          var n2 = pairBits(TABLES[g[0] + k], ix, a, b);
          if (n2 < best.bits) best = { t: g[0] + k, bits: n2 };
          break;
        }
      }
    });
    return best;
  }
  // Everything the side info and the main data need for one granule of one channel.
  function granuleLayout(ix, sfb) {
    var i;
    for (i = 576; i > 1; i -= 2) if (ix[i - 1] || ix[i - 2]) break;
    var count1 = 0;
    for (; i > 3; i -= 4) {
      if (ix[i - 1] <= 1 && ix[i - 2] <= 1 && ix[i - 3] <= 1 && ix[i - 4] <= 1) count1++;
      else break;
    }
    var bv = i >> 1, bigEnd = bv * 2;
    var nb = 0;
    while (nb < 22 && sfb[nb] < bigEnd) nb++;
    var r0 = SUBDV[nb][0], r1 = SUBDV[nb][1];
    var e1 = Math.min(sfb[r0 + 1], bigEnd), e2 = Math.min(sfb[r0 + r1 + 2], bigEnd);
    var t0 = pickTable(ix, 0, e1), t1 = pickTable(ix, e1, e2), t2 = pickTable(ix, e2, bigEnd);
    var c32 = 0, c33 = 0, end = bigEnd + count1 * 4;
    for (i = bigEnd; i < end; i += 4) {
      var q = ix[i] * 8 + ix[i + 1] * 4 + ix[i + 2] * 2 + ix[i + 3], sgn = ix[i] + ix[i + 1] + ix[i + 2] + ix[i + 3];
      c32 += HUFF[32][q * 2 + 1] + sgn; c33 += 4 + sgn;
    }
    var c1 = c33 < c32 ? 1 : 0;
    return {
      bv: bv, count1: count1, r0: r0, r1: r1, e1: e1, e2: e2, tsel: [t0.t, t1.t, t2.t], c1: c1,
      bits: t0.bits + t1.bits + t2.bits + (c1 ? c33 : c32)
    };
  }
  // Smallest global gain whose data fits in `maxBits`.
  function quantise(xr, sfb, maxBits) {
    var xr34 = new Float64Array(576), ix = new Int32Array(576), i, peak = 0;
    for (i = 0; i < 576; i++) { var a = Math.abs(xr[i]); xr34[i] = Math.sqrt(a * Math.sqrt(a)); if (a > peak) peak = a; }
    function tryGain(g) {
      var step = Math.pow(2, -0.1875 * (g - 210));
      for (var k = 0; k < 576; k++) {
        var q = Math.floor(xr34[k] * step + 0.4054);
        if (q > MAX_IX) return null;
        ix[k] = q;
      }
      var lay = granuleLayout(ix, sfb);
      return lay.bits <= maxBits ? lay : null;
    }
    if (peak < 1e-12) { ix.fill(0); var z = granuleLayout(ix, sfb); z.gain = 210; z.ix = ix; return z; }
    var lo = 0, hi = 255, best = null;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (tryGain(mid)) hi = mid; else lo = mid + 1;
    }
    best = tryGain(lo);
    if (!best) { ix.fill(0); best = granuleLayout(ix, sfb); }   // cannot happen with sane budgets
    best.gain = lo;
    best.ix = ix;
    best.sign = xr;
    return best;
  }
  function writeMain(w, g) {
    var ix = g.ix, xr = g.sign, i, bigEnd = g.bv * 2;
    for (i = 0; i < bigEnd; i += 2) {
      var tn = i < g.e1 ? g.tsel[0] : i < g.e2 ? g.tsel[1] : g.tsel[2];
      if (!tn) continue;
      var T = TABLES[tn], x = ix[i], y = ix[i + 1], xx = x > 15 ? 15 : x, yy = y > 15 ? 15 : y, o = (xx * T.xlen + yy) * 2;
      w.put(T.a[o], T.a[o + 1]);
      if (x) { if (T.lin && x >= 15) w.put(x - 15, T.lin); w.put(xr[i] < 0 ? 1 : 0, 1); }
      if (y) { if (T.lin && y >= 15) w.put(y - 15, T.lin); w.put(xr[i + 1] < 0 ? 1 : 0, 1); }
    }
    var end = bigEnd + g.count1 * 4;
    for (i = bigEnd; i < end; i += 4) {
      var q = ix[i] * 8 + ix[i + 1] * 4 + ix[i + 2] * 2 + ix[i + 3];
      if (g.c1) w.put(15 - q, 4); else w.put(HUFF[32][q * 2], HUFF[32][q * 2 + 1]);
      for (var k = 0; k < 4; k++) if (ix[i + k]) w.put(xr[i + k] < 0 ? 1 : 0, 1);
    }
  }

  // ---------- MP3: analysis ----------
  // Polyphase filter bank (ISO 11172-3 C.1.3) and MDCT with alias reduction,
  // one granule (576 new samples) of one channel at a time.
  function Analysis() {
    this.x = new Float64Array(512);
    this.prev = new Float64Array(32 * 18);
    this.cur = new Float64Array(32 * 18);
    this.y = new Float64Array(64);
    this.zz = new Float64Array(33);
    this.z = new Float64Array(36);
  }
  Analysis.prototype.granule = function (pcm, off, out) {
    var X = this.x, Y = this.y, cur = this.cur, i, j, k, ss, sb;
    for (ss = 0; ss < 18; ss++) {
      X.copyWithin(32, 0, 480);
      for (i = 0; i < 32; i++) { var v = pcm[off + ss * 32 + i]; X[31 - i] = v === v ? v : 0; }
      for (k = 0; k < 64; k++) {
        var s = 0;
        for (j = 0; j < 8; j++) s += CWIN[k + 64 * j] * X[k + 64 * j];
        Y[k] = s;
      }
      // cos((2i+1)(k-16)pi/64) is even around k = 16 and odd around k = 48: fold Y to 33 terms
      var Z = this.zz;
      Z[0] = Y[16]; Z[32] = Y[48];
      for (j = 1; j <= 16; j++) Z[j] = Y[16 + j] + Y[16 - j];
      for (j = 17; j < 32; j++) Z[j] = Y[16 + j] - Y[80 - j];
      for (i = 0; i < 32; i++) {
        var acc = 0, m = i * 33;
        for (k = 0; k <= 32; k++) acc += MAT[m + k] * Z[k];
        cur[i * 18 + ss] = (i & 1) && (ss & 1) ? -acc : acc;
      }
    }
    var z = this.z, prev = this.prev;
    for (sb = 0; sb < 32; sb++) {
      for (i = 0; i < 18; i++) { z[i] = prev[sb * 18 + i] * MWIN[i]; z[i + 18] = cur[sb * 18 + i] * MWIN[i + 18]; }
      for (k = 0; k < 18; k++) {
        var a = 0, c = k * 36;
        for (i = 0; i < 36; i++) a += z[i] * MCOS[c + i];
        out[sb * 18 + k] = a;
      }
    }
    for (sb = 1; sb < 32; sb++) {
      for (i = 0; i < 8; i++) {
        var li = sb * 18 - 1 - i, ui = sb * 18 + i, lo = out[li], up = out[ui];
        out[li] = lo * CS[i] + up * CA[i];
        out[ui] = up * CS[i] - lo * CA[i];
      }
    }
    this.prev = cur; this.cur = prev;
  };

  // ---------- MP3: the encoder ----------
  // channels: Float32Arrays (1 or 2) of samples in -1..1. step(n) encodes up to
  // n more frames and returns true when every frame is written; bytes() is the file.
  function Mp3Encoder(channels, rate, kbps, opts) {
    opts = opts || {};
    if (MP3_RATES[rate] == null || MP3_KBPS.indexOf(kbps) <= 0) throw new Error("mp3: unsupported rate or bitrate");
    this.ch = channels.length > 1 ? 2 : 1;
    this.rate = rate; this.kbps = kbps;
    this.sfb = SFB_L[MP3_RATES[rate]];
    // lines above the cut-off carry little anyone hears and cost many bits
    this.lowpass = kbps >= 256 ? 20000 : kbps >= 160 ? 19000 : kbps >= 112 ? 16500 : 12000;
    this.cut = Math.min(576, Math.ceil(this.lowpass / (rate / 1152)));
    var n = channels[0] ? channels[0].length : 0;
    this.frames = Math.ceil((n + 576) / 1152) + 1;        // the filter delay plays out in the last frame
    this.pcm = [];
    for (var c = 0; c < this.ch; c++) {
      var p = new Float32Array(this.frames * 1152);
      p.set(channels[c].subarray(0, n));
      this.pcm.push(p);
    }
    this.an = [new Analysis(), new Analysis()];
    this.done = 0;
    var tag = id3Tag(opts.title || "", "orOS Studio");
    var audio = 0;
    for (var f = 0; f < this.frames; f++) audio += mp3FrameBytes(rate, kbps, f);
    var info = infoFrame(rate, kbps, this.ch, this.frames, audio, ENC_DELAY, this.frames * 1152 - ENC_DELAY - n, this.lowpass);
    this.out = new Uint8Array(tag.length + info.length + audio);
    this.out.set(tag, 0);
    this.out.set(info, tag.length);
    this.pos = tag.length + info.length;
  }
  Mp3Encoder.prototype.step = function (maxFrames) {
    var end = Math.min(this.frames, this.done + (maxFrames || 1)), xr = new Float64Array(576);
    for (var f = this.done; f < end; f++) this.frame(f, xr);
    this.done = end;
    return this.done >= this.frames;
  };
  Mp3Encoder.prototype.progress = function () { return this.frames ? this.done / this.frames : 1; };
  Mp3Encoder.prototype.bytes = function () { return this.out; };
  Mp3Encoder.prototype.frame = function (f, xr) {
    var ch = this.ch, bytes = mp3FrameBytes(this.rate, this.kbps, f), si = ch === 2 ? 32 : 17;
    var pad = bytes !== Math.floor(144000 * this.kbps / this.rate);
    var left = (bytes - 4 - si) * 8, units = 2 * ch, gr, c, g = [];
    for (gr = 0; gr < 2; gr++) {
      g[gr] = [];
      for (c = 0; c < ch; c++) {
        this.an[c].granule(this.pcm[c], f * 1152 + gr * 576, xr);
        var budget = Math.min(4095, Math.floor(left / units));
        for (var z = Math.max(0, this.cut - 16); z < 576; z++) xr[z] *= z >= this.cut ? 0 : (this.cut - z) / 17;
        var q = quantise(xr, this.sfb, budget);
        q.sign = Float64Array.from(xr);
        g[gr][c] = q;
        left -= q.bits; units--;
      }
    }
    var w = new BitWriter(bytes);
    var hd = mp3Header(this.rate, this.kbps, ch, pad);
    for (var i = 0; i < 4; i++) w.put(hd[i], 8);
    w.put(0, 9);                                    // main_data_begin: no bit reservoir
    w.put(0, ch === 2 ? 3 : 5);                     // private bits
    for (c = 0; c < ch; c++) w.put(0, 4);           // scfsi
    for (gr = 0; gr < 2; gr++) {
      for (c = 0; c < ch; c++) {
        var q2 = g[gr][c];
        w.put(q2.bits, 12);                         // part2_3_length (no scalefactor bits)
        w.put(q2.bv, 9);
        w.put(q2.gain, 8);
        w.put(0, 4);                                // scalefac_compress
        w.put(0, 1);                                // window_switching_flag: long blocks
        for (var r = 0; r < 3; r++) w.put(q2.tsel[r], 5);
        w.put(q2.r0, 4); w.put(q2.r1, 3);
        w.put(0, 1); w.put(0, 1);                   // preflag, scalefac_scale
        w.put(q2.c1, 1);
      }
    }
    for (gr = 0; gr < 2; gr++) for (c = 0; c < ch; c++) writeMain(w, g[gr][c]);
    this.out.set(w.buf, this.pos);
    this.pos += bytes;
  };

  // The first frame is an "Info" frame (Xing CBR tag with the LAME extension
  // that players read for gapless playback): it holds no audio, says how many
  // frames follow, and how many samples to drop at the start (the encoder's
  // delay) and at the end (the padding of the last frame). Decoders add their
  // own 529 samples, so the file plays exactly the input.
  var ENC_DELAY = 576 + 481 - 529;
  function infoFrame(rate, kbps, ch, frames, audioBytes, delay, pad, lowpass) {
    var bytes = Math.floor(144000 * kbps / rate), b = new Uint8Array(bytes), dv = new DataView(b.buffer);
    b.set(mp3Header(rate, kbps, ch, false), 0);
    var o = 4 + (ch === 2 ? 32 : 17);
    b.set([0x49, 0x6e, 0x66, 0x6f], o);                                // "Info": constant bitrate
    dv.setUint32(o + 4, 15);                                           // frames, bytes, TOC, quality
    dv.setUint32(o + 8, frames);
    dv.setUint32(o + 12, audioBytes + bytes);
    for (var i = 0; i < 100; i++) b[o + 16 + i] = Math.floor(i * 256 / 100);
    dv.setUint32(o + 116, 0);
    var e = o + 120;
    b.set([0x4c, 0x41, 0x4d, 0x45, 0x33, 0x2e, 0x31, 0x30, 0x30], e);  // the tag layout LAME 3.100 defined
    b[e + 9] = 0x01;                                                   // tag revision 0, CBR
    b[e + 10] = Math.min(255, Math.round((lowpass || rate / 2) / 100));    // lowpass in 100 Hz
    b[e + 20] = Math.min(255, kbps);
    delay = Math.max(0, Math.min(4095, delay)); pad = Math.max(0, Math.min(4095, pad));
    b[e + 21] = delay >> 4; b[e + 22] = ((delay & 15) << 4) | (pad >> 8); b[e + 23] = pad & 255;
    dv.setUint32(e + 28, audioBytes + bytes);
    dv.setUint16(e + 34, crc16(b, e + 34));
    return b;
  }
  var CRC16 = new Uint16Array(256);
  (function () {
    for (var i = 0; i < 256; i++) {
      var c = i;
      for (var k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xa001 : c >>> 1;
      CRC16[i] = c;
    }
  })();
  function crc16(bytes, n) {
    var c = 0;
    for (var i = 0; i < n; i++) c = (c >>> 8) ^ CRC16[(c ^ bytes[i]) & 255];
    return c;
  }

  // ID3v2.4 tag with the title (TIT2) and the encoder (TSSE), UTF-8.
  function id3Tag(title, tool) {
    var frames = [];
    function frame(id, text) {
      if (!text) return;
      var body = [3].concat(utf8(text));
      var hd = [id.charCodeAt(0), id.charCodeAt(1), id.charCodeAt(2), id.charCodeAt(3)].concat(syncsafe(body.length), [0, 0]);
      frames = frames.concat(hd, body);
    }
    frame("TIT2", String(title).slice(0, 200));
    frame("TSSE", tool);
    if (!frames.length) return new Uint8Array(0);
    return new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0].concat(syncsafe(frames.length), frames));
  }
  function syncsafe(n) { return [(n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127]; }
  function utf8(s) {
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length) { var d = s.charCodeAt(i + 1); if (d >= 0xdc00 && d < 0xe000) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++; } }
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }

  // ---------- Ogg ----------
  var CRC = new Uint32Array(256);
  (function () {
    for (var i = 0; i < 256; i++) {
      var r = i << 24;
      for (var k = 0; k < 8; k++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
      CRC[i] = r >>> 0;
    }
  })();
  function oggCrc(bytes) {
    var c = 0;
    for (var i = 0; i < bytes.length; i++) c = ((c << 8) ^ CRC[((c >>> 24) ^ bytes[i]) & 255]) >>> 0;
    return c >>> 0;
  }
  // One page: { packets: [Uint8Array parts], segs: [lacing values], granule, flags }
  function oggPage(serial, seq, granule, flags, segs, body) {
    var page = new Uint8Array(27 + segs.length + body.length), dv = new DataView(page.buffer);
    page.set([0x4f, 0x67, 0x67, 0x53, 0, flags]);
    if (granule < 0) { dv.setUint32(6, 0xffffffff, true); dv.setUint32(10, 0xffffffff, true); }
    else { dv.setUint32(6, granule % 4294967296, true); dv.setUint32(10, Math.floor(granule / 4294967296), true); }
    dv.setUint32(14, serial >>> 0, true);
    dv.setUint32(18, seq >>> 0, true);
    page[26] = segs.length;
    page.set(segs, 27);
    page.set(body, 27 + segs.length);
    dv.setUint32(22, oggCrc(page), true);
    return page;
  }
  // Collects packets into pages: a page closes when it has PAGE_BYTES of data
  // or 255 lacing values; `flush` closes it now (headers stand on their own pages).
  var PAGE_BYTES = 4096;
  function OggWriter(serial) {
    this.serial = serial >>> 0; this.seq = 0; this.pages = [];
    this.segs = []; this.parts = []; this.size = 0; this.granule = -1; this.bos = true; this.cont = false;
  }
  OggWriter.prototype.packet = function (data, granule, last) {
    var off = 0, n = data.length;
    for (;;) {
      var room = 255 - this.segs.length;
      var need = Math.floor((n - off) / 255) + 1;            // lacing values for the rest of this packet
      if (need <= room) {
        for (var k = 0; k < need - 1; k++) this.segs.push(255);
        this.segs.push((n - off) % 255);
        this.parts.push(data.subarray(off));
        this.size += n - off;
        this.granule = granule;
        break;
      }
      var take = room * 255;                                  // fill the page and go on in the next one
      for (var j = 0; j < room; j++) this.segs.push(255);
      this.parts.push(data.subarray(off, off + take));
      this.size += take;
      off += take;
      this.close(false, true);
    }
    if (last) this.close(true, false);
    else if (this.size >= PAGE_BYTES || this.segs.length >= 255) this.close(false, false);
  };
  OggWriter.prototype.flush = function () { if (this.segs.length) this.close(false, false); };
  OggWriter.prototype.close = function (eos, partial) {
    var body = new Uint8Array(this.size), o = 0;
    this.parts.forEach(function (p) { body.set(p, o); o += p.length; });
    var flags = (this.cont ? 1 : 0) | (this.bos ? 2 : 0) | (eos ? 4 : 0);
    this.pages.push(oggPage(this.serial, this.seq++, partial ? -1 : this.granule, flags, this.segs, body));
    this.bos = false; this.cont = !!partial;
    this.segs = []; this.parts = []; this.size = 0; this.granule = -1;
  };
  OggWriter.prototype.bytes = function () {
    var n = 0, o = 0;
    this.pages.forEach(function (p) { n += p.length; });
    var out = new Uint8Array(n);
    this.pages.forEach(function (p) { out.set(p, o); o += p.length; });
    return out;
  };

  // Opus identification header (RFC 7845 5.1), mapping family 0.
  function opusHead(ch, preSkip, inputRate) {
    var b = new Uint8Array(19), dv = new DataView(b.buffer);
    b.set([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64, 1, ch]);
    dv.setUint16(10, preSkip, true);
    dv.setUint32(12, inputRate, true);
    dv.setInt16(16, 0, true);
    b[18] = 0;
    return b;
  }
  // Opus comment header (RFC 7845 5.2).
  function opusTags(vendor, comments) {
    var parts = [0x4f, 0x70, 0x75, 0x73, 0x54, 0x61, 0x67, 0x73];
    function u32(n) { parts.push(n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255); }
    var v = utf8(vendor);
    u32(v.length); parts = parts.concat(v);
    var list = (comments || []).map(utf8);
    u32(list.length);
    list.forEach(function (c) { u32(c.length); parts = parts.concat(c); });
    return new Uint8Array(parts);
  }
  // A whole Ogg Opus file. packets: [{ data: Uint8Array, samples: 48 kHz samples }],
  // total: the real length in 48 kHz samples (the end is trimmed to it).
  function oggOpus(packets, opts) {
    var w = new OggWriter(opts.serial != null ? opts.serial : 0x6f726f53);
    var head = opts.head || opusHead(opts.ch || 2, opts.preSkip || 0, opts.rate || 48000);
    var pre = new DataView(head.buffer, head.byteOffset, head.byteLength).getUint16(10, true);
    w.packet(head, 0, false); w.flush();
    var tags = [];
    if (opts.title) tags.push("TITLE=" + opts.title);
    tags.push("ENCODER=orOS Studio");
    w.packet(opusTags(opts.vendor || "orOS Studio", tags), 0, false); w.flush();
    var gp = 0, end = pre + (opts.total != null ? opts.total : Infinity);
    packets.forEach(function (p, i) {
      gp += p.samples;
      var last = i === packets.length - 1;
      w.packet(p.data, last ? Math.min(gp, end) : gp, last);
    });
    if (!packets.length) w.packet(new Uint8Array(0), 0, true);
    return w.bytes();
  }

  // ---------- Opus through WebCodecs (browser only) ----------
  function opusSupported() {
    var AE = root && root.AudioEncoder;
    if (!AE || typeof AE.isConfigSupported !== "function" || !root.AudioData) return Promise.resolve(false);
    return AE.isConfigSupported({ codec: "opus", sampleRate: 48000, numberOfChannels: 2, bitrate: 160000 })
      .then(function (r) { return !!(r && r.supported); }, function () { return false; });
  }
  // channels at 48 kHz -> Promise<Uint8Array> (an .opus file). onProgress(0..1).
  function encodeOpus(channels, kbps, opts) {
    opts = opts || {};
    var AE = root.AudioEncoder, AD = root.AudioData, ch = channels.length, n = channels[0].length;
    return new Promise(function (resolve, reject) {
      var packets = [], head = null, failed = false;
      var enc = new AE({
        output: function (chunk, meta) {
          var d = new Uint8Array(chunk.byteLength);
          chunk.copyTo(d);
          packets.push({ data: d, samples: Math.round((chunk.duration || 20000) * 48 / 1000) });
          var desc = meta && meta.decoderConfig && meta.decoderConfig.description;
          if (desc && !head) {
            var bd = desc instanceof ArrayBuffer ? new Uint8Array(desc.slice(0)) : new Uint8Array(desc.buffer.slice(desc.byteOffset, desc.byteOffset + desc.byteLength));
            if (bd.length >= 19 && String.fromCharCode.apply(null, bd.subarray(0, 8)) === "OpusHead") head = bd;
          }
        },
        error: function (e) { failed = true; reject(e); }
      });
      enc.configure({ codec: "opus", sampleRate: 48000, numberOfChannels: ch, bitrate: kbps * 1000, opus: { complexity: 10 } });   // raw packets; Chrome refuses format "ogg"
      var STEP = 48000, pos = 0, pad = 960 * 2;                // a little silence lets the encoder's look-ahead out
      function feed() {
        if (failed) return;
        var stop = Math.min(n + pad, pos + STEP * 5);
        while (pos < n + pad && pos < stop) {
          var len = Math.min(STEP, n + pad - pos), buf = new Float32Array(len * ch);
          for (var c = 0; c < ch; c++) {
            var src = channels[c];
            if (pos < n) buf.set(src.subarray(pos, Math.min(n, pos + len)), c * len);
          }
          var ad = new AD({ format: "f32-planar", sampleRate: 48000, numberOfFrames: len, numberOfChannels: ch, timestamp: Math.round(pos * 1e6 / 48000), data: buf });
          enc.encode(ad); ad.close();
          pos += len;
        }
        if (opts.onProgress) opts.onProgress(Math.min(1, pos / (n + pad)));
        if (pos < n + pad) { setTimeout(feed, 0); return; }
        enc.flush().then(function () {
          enc.close();
          var pre = head ? new DataView(head.buffer, head.byteOffset).getUint16(10, true) : 312;
          var hd = head || opusHead(ch, pre, 48000);
          resolve(oggOpus(packets, { head: hd, total: n, title: opts.title, vendor: "orOS Studio (WebCodecs)" }));
        }, reject);
      }
      feed();
    });
  }

  var api = {
    Mp3Encoder: Mp3Encoder, mp3FrameBytes: mp3FrameBytes, mp3Header: mp3Header, MP3_KBPS: MP3_KBPS,
    id3Tag: id3Tag, utf8: utf8, crc16: crc16, ENC_DELAY: ENC_DELAY, infoFrame: infoFrame,
    oggCrc: oggCrc, OggWriter: OggWriter, opusHead: opusHead, opusTags: opusTags, oggOpus: oggOpus,
    opusSupported: opusSupported, encodeOpus: encodeOpus,
    _test: { HUFF: HUFF, TABLES: TABLES, SFB_L: SFB_L, granuleLayout: granuleLayout, quantise: quantise, Analysis: Analysis, CWIN: CWIN }
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.StudioEncode = api;
})(typeof window !== "undefined" ? window : this);
