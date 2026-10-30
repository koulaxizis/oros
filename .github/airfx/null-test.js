#!/usr/bin/env node
// Null test for the Airwindows translations: compiles the original plugin
// (LinuxVST sources + stub/audioeffectx.h) with g++, runs it and the JS
// file on the same signal, block by block, and reports the largest
// difference. Both sides compute in double; libm and V8 may differ in the
// last bit of sin/pow, so a translation passes under 1e-9.
//
//   node .github/airfx/null-test.js <airwindows checkout> Name [Name …]
//
// Exits 1 when a plugin is over the limit or fails to build.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");
const { translate } = require("./cpp2js.js");

const LIMIT = 1e-9;
// Plugins whose LFO phase or envelope adds up sin()/pow() results sample
// after sample: libm and V8 differ in the last bit now and then, and the
// sum drifts, staying below -140 dB (this bound).
const DRIFT = { IronOxide5: 1e-7, Logical4: 1e-7 };
const SR = [44100, 96000];
const FRAMES = 44100 * 2, BLOCK = 128;

// the same test signal on both sides: sines, a step, quiet passages and LCG noise
function signal(n, ch) {
  const out = new Float64Array(n);
  let s = 12345 + ch;
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    const noise = (s / 4294967296 - 0.5) * 0.2;
    const t = i / 44100;
    const env = i % 22050 < 11025 ? 1 : 0.05;
    out[i] = env * (0.5 * Math.sin(2 * Math.PI * (110 + 50 * ch) * t) + 0.3 * Math.sin(2 * Math.PI * 1760 * t) + noise) + (i > n / 2 && i < n / 2 + 400 ? 0.8 : 0);
  }
  return out;
}

function main() {
  const [src, ...names] = process.argv.slice(2);
  if (!src || !names.length) { console.error("usage: null-test.js <airwindows checkout> Name …"); process.exit(2); }
  const base = path.join(path.resolve(src), "plugins", "LinuxVST", "src");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "airfx-"));
  const inL = signal(FRAMES, 0), inR = signal(FRAMES, 1);
  fs.writeFileSync(path.join(tmp, "in.bin"), Buffer.concat([Buffer.from(inL.buffer), Buffer.from(inR.buffer)]));
  let bad = 0;
  names.forEach((name) => {
    const dir = path.join(base, name);
    let tr;
    try { tr = translate(dir, name); } catch (e) { console.log(name + ": not translated (" + e.message + ")"); bad++; return; }
    const exe = path.join(tmp, name);
    const main = path.join(tmp, name + "-main.cpp");
    fs.writeFileSync(main, [
      "#include <stdlib.h>", "#include <stdio.h>", "#include <math.h>",
      "#define rand() 1",
      '#include "' + path.join(dir, name + ".cpp") + '"',
      '#include "' + path.join(dir, name + "Proc.cpp") + '"',
      "int main(int argc, char **argv) {",
      "  double sr = atof(argv[1]); int frames = atoi(argv[2]);",
      "  " + name + " *p = new " + name + "(0); p->sr = sr;",
      "  for (int i = 3; i < argc; i++) p->setParameter(i - 3, (float)atof(argv[i]));",
      "  double *in = (double *)malloc(sizeof(double) * frames * 2), *out = (double *)malloc(sizeof(double) * frames * 2);",
      "  FILE *f = fopen(\"" + path.join(tmp, "in.bin") + "\", \"rb\"); if (fread(in, sizeof(double), frames * 2, f) != (size_t)frames * 2) return 3; fclose(f);",
      "  for (int i = 0; i < frames; i += " + BLOCK + ") {",
      "    int n = frames - i < " + BLOCK + " ? frames - i : " + BLOCK + ";",
      "    double *ins[2] = { in + i, in + frames + i }, *outs[2] = { out + i, out + frames + i };",
      "    p->processDoubleReplacing(ins, outs, n);",
      "  }",
      "  fwrite(out, sizeof(double), frames * 2, stdout); return 0; }"
    ].join("\n"));
    try {
      cp.execFileSync("g++", ["-O1", "-mlong-double-64", "-ffp-contract=off", "-fno-fast-math", "-w", "-I", path.join(__dirname, "stub"), "-I", dir, "-o", exe, main], { stdio: "pipe" });
    } catch (e) { console.log(name + ": native build failed\n" + String(e.stderr).slice(0, 2000)); bad++; return; }
    const sandbox = {};
    new Function("globalThis", tr.js)(sandbox);   // a file this repository generated, run only in this test
    const FX = sandbox.NULLFX[tr.id];
    let worst = 0;
    const settings = [tr.params.map((p) => p.def), tr.params.map((p, i) => [0.2, 0.9, 0.65, 0.35, 0.8, 0.1][i % 6])];
    SR.forEach((sr) => settings.forEach((vals) => {
      const ref = cp.execFileSync(exe, [String(sr), String(FRAMES)].concat(vals.map(String)), { maxBuffer: FRAMES * 32 });
      const want = new Float64Array(ref.buffer, ref.byteOffset, FRAMES * 2);
      const inst = FX.create();
      inst.seed(1);                                 // the harness's rand() is 1
      inst.setHost("srate", sr);
      vals.forEach((v, i) => inst.setSlider(i + 1, v));
      inst.init();
      const oL = new Float64Array(FRAMES), oR = new Float64Array(FRAMES);
      for (let i = 0; i < FRAMES; i += BLOCK) {
        const n = Math.min(BLOCK, FRAMES - i);
        inst.sample([inL.subarray(i, i + n), inR.subarray(i, i + n)], [oL.subarray(i, i + n), oR.subarray(i, i + n)], n, 2);
      }
      for (let i = 0; i < FRAMES; i++) {
        const d = Math.max(Math.abs(oL[i] - want[i]), Math.abs(oR[i] - want[FRAMES + i]));
        if (!(d <= worst)) worst = d === d ? d : Infinity;
      }
    }));
    const ok = worst < (DRIFT[name] || LIMIT);
    if (!ok) bad++;
    console.log(name + ": " + (ok ? "ok" : "DIFFERS") + " (max difference " + worst.toExponential(2) + ")");
  });
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(bad ? 1 : 0);
}
main();
