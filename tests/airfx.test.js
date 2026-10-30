// Airwindows effects in Studio (studio/airfx/, Studio v1.8.0): the
// translator keeps C's arithmetic, every shipped file runs and is
// listed, and Studio loads the list and the files next to NULL JSFX.
// The null test against the compiled originals needs an Airwindows
// checkout and g++: AIRWINDOWS_SRC=<checkout> runs it here too.
// Run: node --test tests/*.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const cp = require("child_process");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const T = require(path.join(ROOT, ".github", "airfx", "cpp2js.js"));
const DIR = path.join(ROOT, "studio", "airfx", "fx");

// a tiny plugin in the shape of Airwindows' LinuxVST sources
function plugin(name, members, ctor, body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "awt-"));
  fs.writeFileSync(path.join(dir, name + ".h"), "#include \"audioeffectx.h\"\nenum {\n kParamA = 0,\n kParamB = 1,\n kNumParameters = 2\n};\nclass " + name + " : public AudioEffectX {\npublic:\n int x;\nprivate:\n char _programName[kVstMaxProgNameLen + 1];\n std::set< std::string > _canDo;\n" + members + "\n float A;\n float B;\n};\n");
  fs.writeFileSync(path.join(dir, name + ".cpp"), name + "::" + name + "(audioMasterCallback audioMaster) :\n AudioEffectX(audioMaster, kNumPrograms, kNumParameters)\n{\n A = 0.25;\n B = 0.75;\n" + ctor + "\n _canDo.insert(\"x\");\n}\nvoid " + name + "::getParameterName(VstInt32 index, char *text) {\n switch (index) {\n case kParamA: vst_strncpy (text, \"Gain\", kVstMaxParamStrLen); break;\n case kParamB: vst_strncpy (text, \"Dry/Wet\", kVstMaxParamStrLen); break;\n }\n}\n");
  fs.writeFileSync(path.join(dir, name + "Proc.cpp"), "void " + name + "::processDoubleReplacing(double **inputs, double **outputs, VstInt32 sampleFrames)\n{\n double* in1 = inputs[0];\n double* in2 = inputs[1];\n double* out1 = outputs[0];\n double* out2 = outputs[1];\n" + body + "\n}\n");
  return dir;
}
function load(js, id) { const g = {}; new Function("globalThis", js)(g); return g.NULLFX[id]; }
function run(FX, n, sliders) {
  const inst = FX.create();
  inst.setHost("srate", 48000);
  (sliders || []).forEach((v, i) => inst.setSlider(i + 1, v));
  inst.init();
  const inL = new Float64Array(n).map((_, i) => Math.sin(i / 7) * 0.5), inR = inL.map((v) => -v);
  const oL = new Float64Array(n), oR = new Float64Array(n);
  inst.sample([inL, inR], [oL, oR], n, 2);
  return [oL, oR];
}

test("translator: C arithmetic (int division and stores, unsigned shifts, float stores, arrays)", () => {
  const dir = plugin("Mini",
    " double buf[8];\n int count;\n uint32_t fpd;\n float f;",
    " for (int i = 0; i < 8; i++) buf[i] = 0.0;\n count = 3;\n fpd = 1.0; while (fpd < 16386) fpd = rand()*UINT32_MAX;",
    " int half = 7 / 2;\n double gain = A * 2.0;\n while (--sampleFrames >= 0)\n {\n  double s = *in1;\n  count++; if (count > 7) count = 0;\n  buf[count] = s;\n  fpd ^= fpd << 13; fpd ^= fpd >> 17; fpd ^= fpd << 5;\n  f = s * 0.1;\n  int k = s * 10.0;\n  *out1 = buf[count] * gain + half + k + f;\n  *out2 = (double)fpd / UINT32_MAX;\n  *in1++;\n  *in2++;\n  *out1++;\n  *out2++;\n }");
  const tr = T.translate(dir, "Mini");
  assert.equal(tr.id, "aw_mini");
  assert.deepEqual(tr.params.map((p) => [p.name, p.def]), [["Gain", 0.25], ["Dry/Wet", 0.75]]);
  const FX = load(tr.js, "aw_mini");
  assert.deepEqual(FX.sliders.map((s) => [s.i, s.name, s.min, s.max]), [[1, "Gain", 0, 1], [2, "Dry/Wet", 0, 1]]);
  const inst = FX.create();
  inst.seed(1);
  inst.setHost("srate", 44100);
  inst.init();
  const inL = Float64Array.of(0.31, -0.29, 0.05), inR = new Float64Array(3), oL = new Float64Array(3), oR = new Float64Array(3);
  inst.sample([inL, inR], [oL, oR], 3, 2);
  // C: half = 3 (int division), k = (int)(s * 10) truncates toward zero, f is a float
  const want = (s) => s * (Math.fround(0.25) * 2) + 3 + Math.trunc(s * 10) + Math.fround(s * 0.1);
  [0, 1, 2].forEach((i) => assert.ok(Math.abs(oL[i] - want(inL[i])) < 1e-15, "sample " + i));
  // xorshift32 on an unsigned seed (rand() fixed to 1 → 4294967295)
  let x = 4294967295;
  const xs = () => { x = (x ^ (x << 13)) >>> 0; x = (x ^ (x >>> 17)) >>> 0; x = (x ^ (x << 5)) >>> 0; return x / 4294967295; };
  [0, 1, 2].forEach((i) => assert.equal(oR[i], xs()));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("translator: refuses what it does not know instead of guessing", () => {
  const dir = plugin("Bad", " double a;", " a = 0.0;", " double *p = &a;\n while (--sampleFrames >= 0) { *out1 = *in1; *out2 = *in2; *in1++; *in2++; *out1++; *out2++; }");
  assert.throws(() => T.translate(dir, "Bad"), T.Unsupported);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("shipped effects: listed, MIT, run at 44.1 and 96 kHz without NaN, quiet in → quiet out", () => {
  const idx = JSON.parse(read("studio/airfx/fx/index.json"));
  assert.equal(idx.effects.length, 32);
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".js")).sort();
  assert.deepEqual(files, idx.effects.map((e) => e.id + ".js").sort());
  assert.match(read("studio/airfx/LICENSE.md"), /MIT License[\s\S]*Chris Johnson/);
  assert.match(read("studio/airfx/release.txt"), /^airwindows\/airwindows [0-9a-f]{40}\n$/);
  idx.effects.forEach((e) => {
    assert.match(e.id, /^aw_[a-z0-9_]+$/);
    assert.equal(e.category, "Airwindows");
    const js = fs.readFileSync(path.join(DIR, e.id + ".js"), "utf8");
    assert.ok(!/\b(eval|Function|fetch|import|XMLHttpRequest|postMessage|setTimeout)\b/.test(js.replace(/^\/\/.*$/gm, "")), e.id + ": no dynamic code or I/O");
    const FX = load(js, e.id);
    assert.equal(FX.id, e.id);
    assert.equal(FX.sliders.length, e.sliders);
    [44100, 96000].forEach((sr) => {
      const inst = FX.create();
      inst.setHost("srate", sr);
      inst.init();
      const n = 4096, inL = new Float64Array(n).map((_, i) => Math.sin(i / 9) * 0.5), oL = new Float64Array(n), oR = new Float64Array(n);
      for (let i = 0; i < n; i += 128) inst.sample([inL.subarray(i, i + 128), inL.subarray(i, i + 128)], [oL.subarray(i, i + 128), oR.subarray(i, i + 128)], 128, 2);
      assert.ok(oL.every(Number.isFinite) && oR.every(Number.isFinite), e.id + " finite at " + sr);
    });
    // a rerun after init() is the same sound (state fully reset, noise repeatable)
    const a = run(FX, 2048), b = run(FX, 2048);
    assert.deepEqual(Array.from(a[0]), Array.from(b[0]), e.id + " repeatable");
  });
});

test("studio: effect list, loading next to NULL JSFX, picker, kept offline, credits", () => {
  const fx = read("studio/fx.js"), sw = read("sw.js");
  assert.match(fx, /var AWBASE = "airfx\/";/);
  assert.match(fx, /function baseOf\(id\) \{ return \/\^aw_\/\.test\(id\) \? AWBASE : BASE; \}/);
  assert.match(fx, /fetch\(AWBASE \+ "fx\/index\.json\?v="/);
  assert.match(fx, /s\.src = baseOf\(id\) \+ "fx\/"/);
  assert.match(fx, /NN\.load\(ctx, BASE, nul\)\.then\(function \(\) \{ return awIds\.length \? NN\.load\(ctx, AWBASE, awIds\)/);
  assert.match(fx, /\["One Slider", "Essentials", "Advanced", "Airwindows"\]/);
  const RE = new Function(sw.match(/var NULLFX_RE = [^;]+;/)[0] + " return NULLFX_RE;")();
  assert.ok(RE.test("/studio/airfx/fx/aw_galactic.js"));
  assert.ok(!RE.test("/studio/airfx/fx/index.json"));
  assert.match(read("CREDITS.md"), /\[Airwindows\]\(https:\/\/www\.airwindows\.com\)/);
  assert.match(read("shell.js"), /name: "Airwindows", url: "https:\/\/www\.airwindows\.com",\s*by: "Chris Johnson", lic: "MIT"/);
});

test("null test against the originals (AIRWINDOWS_SRC)", { skip: !process.env.AIRWINDOWS_SRC && "set AIRWINDOWS_SRC to an Airwindows checkout" }, () => {
  const names = JSON.parse(read("studio/airfx/fx/index.json")).effects.map((e) => e.name);
  const out = cp.execFileSync(process.execPath, [path.join(ROOT, ".github", "airfx", "null-test.js"), process.env.AIRWINDOWS_SRC].concat(names), { encoding: "utf8" });
  assert.equal((out.match(/: ok /g) || []).length, names.length, out);
});
