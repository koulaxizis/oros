// orOS Studio: sliders an effect moves itself reach the page (STUDIO-RA PR 3).
// An Assisted effect's Learn writes its result to its own sliders on the
// audio side; the chain processor reports them ("sliders"), fx.js saves them.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

test("chain processor: Assisted EQ's Learn result is reported once, page and automation values are not", () => {
  let Proc = null;
  const posted = [];
  globalThis.sampleRate = 48000;
  globalThis.currentTime = 0;
  globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage: (m) => posted.push(m) }; } };
  globalThis.registerProcessor = (name, cls) => { Proc = cls; };
  require(path.join(ROOT, "studio/nullfx/runtime/eel-rt.js"));
  require(path.join(ROOT, "studio/nullfx/runtime/null-fx.js"));
  require(path.join(ROOT, "studio/nullfx/fx/assisted_eq.js"));
  delete require.cache[require.resolve(path.join(ROOT, "studio/fxchain.worklet.js"))];
  require(path.join(ROOT, "studio/fxchain.worklet.js"));
  const p = new Proc({ processorOptions: { chain: [{ uid: "fasst0001", id: "assisted_eq", sliders: {} }] } });
  let seed = 1;
  const noise = () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647 - 0.5) * 0.5; };
  const run = (n, params) => {
    for (let b = 0; b < n; b++) {
      const l = new Float32Array(128), r = new Float32Array(128);
      for (let i = 0; i < 128; i++) { l[i] = noise(); r[i] = l[i]; }
      p.process([[l, r]], [[new Float32Array(128), new Float32Array(128)]], params || {});
    }
  };
  const reports = () => posted.filter((m) => m.type === "sliders");
  run(40);
  assert.equal(reports().length, 0, "nothing moved: nothing reported");
  // the page's own slider (Learn on) is not echoed back
  p.onMessage({ type: "slider", uid: "fasst0001", i: 1, v: 1 });
  run(40);
  assert.equal(reports().length, 0, "the page's value is not reported back");
  run(Math.ceil(48000 / 128));                       // a second of material
  p.onMessage({ type: "slider", uid: "fasst0001", i: 1, v: 0 });
  run(40);
  const r = reports();
  assert.equal(r.length, 1, "one report after Learn");
  assert.equal(r[0].uid, "fasst0001");
  assert.equal(r[0].v[9], 1, "Learned is set");
  assert.ok(typeof r[0].v[12] === "number" && r[0].v[12] >= 200 && r[0].v[12] <= 500, "the learned mud frequency");
  assert.equal(r[0].v[1], undefined, "Learn itself (set off by the page) is not reported");
  Object.keys(r[0].v).forEach((k) => assert.equal(p.slots[0].fx.inst.getSlider(+k), r[0].v[k]));
  run(80);
  assert.equal(reports().length, 1, "reported once");
  // automation moves a slider: not reported as the effect's own move
  p.onMessage({ type: "auto", map: [{ k: 0, uid: "fasst0001", i: 8, inc: 0.1, min: -12, max: 12 }] });
  run(40, { a0: new Float32Array([-3]) });
  assert.equal(p.slots[0].fx.inst.getSlider(8), -3);
  assert.equal(reports().length, 1, "automation is not reported");
  delete globalThis.registerProcessor; delete globalThis.AudioWorkletProcessor; delete globalThis.sampleRate; delete globalThis.currentTime;
});

test("page: Assisted in both pickers, the strings in EN/EL/DE, the report saved as one undo step", () => {
  const fx = read("studio/fx.js"), rm = read("studio/remote.js"), js = read("studio/studio.js"), de = read("i18n/de/studio.js");
  assert.ok(fx.includes('["One Slider", "Essentials", "Advanced", "Assisted"]'), "Studio's categories");
  assert.ok(fx.includes("cats(instrumentOf(chainOf(openKey))).forEach"), "Studio's picker");
  assert.ok(rm.includes("FXA.cats(FXA.instrumentOf(RF.items)).forEach"), "the remote's picker");
  ["fx.catAssist", "fx.catMidi"].forEach((k) => {
    assert.equal((js.match(new RegExp('"' + k.replace(".", "\\.") + '":', "g")) || []).length, 2, k + " EN and EL");
    assert.ok(de.includes('"' + k + '":'), k + " DE");
  });
  assert.match(fx, /m\.type === "sliders"\) \{ if \(ch\.onsliders\) ch\.onsliders\(m\); \}/);
  assert.match(fx, /if \(!offline\) ch\.onsliders = function \(m\) \{ fromAudio\(key, m\.uid, m\.v, ch\); \};/);
  assert.match(fx, /host\.burst\("fxa" \+ u, \{ live: true \}\)/);
});

test("remote pads: the host checks every note, lets go of held notes, and the strings exist", () => {
  const rm = read("studio/remote.js"), js = read("studio/studio.js"), de = read("i18n/de/studio.js"), html = read("studio/index.html");
  // the host: only a track with a NULL instrument, whole numbers 0..127, a release only for a held note
  assert.match(rm, /case "nt": \{\n\s+if \(!tr \|\| !tr\.ins \|\| !host\.note \|\| !Number\.isInteger\(c\.n\) \|\| c\.n < 0 \|\| c\.n > 127 \|\| !Number\.isInteger\(c\.v\) \|\| c\.v < 0 \|\| c\.v > 127\) return;/);
  assert.match(rm, /else if \(H\.held\[hk\]\) delete H\.held\[hk\];\n\s+else return;/);
  ["function hostStop(quiet) {\n      releaseNotes();", "onGone: function () { releaseNotes();", "if (s !== \"direct\" && s !== \"relay\") releaseNotes();"].forEach((x) => assert.ok(rm.includes(x), x));
  // the feature is announced, so an older PC shows no pads
  assert.match(rm, /fxr: 1, nt: host\.note \? 1 : 0,/);
  assert.match(rm, /if \(!master && R\.st\.nt && tr\.ins\) \{/);
  // the PC plays it on the track's NULL instrument and a MIDI take on that track keeps it
  assert.match(js, /if \(!tr \|\| !proj \|\| tr\.p !== proj\.id \|\| !nxOf\(tr\)\) return;\n\s+nxNote\(tr, v \? 0x99 : 0x89, n, v\);\n\s+if \(midiRec && midiRec\.tid === id\) recEvent\(v \? "on" : "off", n, v\);/);
  ["rup-dlg", "rup-title", "rup-mode", "rup-close", "rup-oct", "rup-dn", "rup-octv", "rup-up", "rup-pads"].forEach((id) => assert.ok(html.includes('id="' + id + '"'), id));
  const keys = ["rp.pads", "rp.keys", "rp.open", "rp.title", "rp.hint"];
  for (let n = 36; n <= 51; n++) keys.push("rp.d" + n);
  keys.forEach((k) => {
    assert.equal((js.match(new RegExp('"' + k.replace(/\./g, "\\.") + '":', "g")) || []).length, 2, k + " EN/EL");
    assert.ok(de.includes('"' + k + '":'), k + " DE");
  });
});

test("chain processor: a MIDI effect's notes reach the instrument after it (Chords → Keys), bypassed it passes them on", () => {
  let Proc = null;
  const posted = [];
  globalThis.sampleRate = 48000;
  globalThis.currentTime = 0;
  globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage: (m) => posted.push(m) }; } };
  globalThis.registerProcessor = (name, cls) => { Proc = cls; };
  require(path.join(ROOT, "studio/nullfx/runtime/eel-rt.js"));
  require(path.join(ROOT, "studio/nullfx/runtime/null-fx.js"));
  require(path.join(ROOT, "studio/nullfx/fx/chords.js"));
  require(path.join(ROOT, "studio/nullfx/fx/keys.js"));
  delete require.cache[require.resolve(path.join(ROOT, "studio/fxchain.worklet.js"))];
  require(path.join(ROOT, "studio/fxchain.worklet.js"));
  const run = (p, n) => {
    for (let b = 0; b < n; b++) { globalThis.currentTime = b * 128 / 48000; p.process([[]], [[new Float32Array(128), new Float32Array(128)]], {}); }
  };
  const notesOn = (list) => list.filter((e) => (e[1] & 0xf0) === 0x90 && e[3] > 0).map((e) => e[2]).sort((a, b) => a - b);
  const heard = (bypass) => {
    const p = new Proc({ processorOptions: { chain: [{ uid: "fchd0001", id: "chords", sliders: {}, bypass: false }, { uid: "fkey0001", id: "keys", sliders: {} }] } });
    p.slots[0].bypass = bypass;
    const seen = [];
    const keys = p.slots[1].fx, proc = keys.process.bind(keys);
    keys.process = function (ins, outs, n, nin, midi) { if (midi) seen.push(...midi); return proc(ins, outs, n, nin, midi); };
    p.onMessage({ type: "midi", ev: [[0, 0x90, 60, 100]] });
    run(p, 20);
    return notesOn(seen);
  };
  const withChords = heard(false), plain = heard(true);
  assert.deepEqual(plain, [60], "bypassed: the played note only");
  assert.ok(withChords.length >= 3 && withChords.indexOf(60) >= 0, "Chords turns one note into a chord for Keys: " + withChords);
  delete globalThis.registerProcessor; delete globalThis.AudioWorkletProcessor; delete globalThis.sampleRate; delete globalThis.currentTime;
});

test("MIDI effects: synced files, above the instrument, only offered with one, and moved only among themselves", () => {
  const fx = read("studio/fx.js"), rm = read("studio/remote.js"), sync = read(".github/scripts/sync-nullfx.js");
  const idx = JSON.parse(read("studio/nullfx/fx/index.json"));
  idx.midi.forEach((e) => assert.ok(fs.existsSync(path.join(ROOT, "studio/nullfx/fx", e.id + ".js")), e.id));
  assert.match(sync, /index\.effects\.concat\(index\.instruments \|\| \[\], index\.midi \|\| \[\]\)/);
  assert.match(fx, /catalog = \(j\.effects \|\| \[\]\)\.concat\(j\.midi \|\| \[\]\)/);
  assert.match(fx, /return midiFx\.concat\(\[old && old\.id === id \? old : /);
  assert.match(fx, /var one = midiOf\(items\)\.concat\(\[x\]\)/);
  assert.match(fx, /return \["One Slider", "Essentials", "Advanced", "Assisted"\]\.concat\(withInst \? \["MIDI"\] : \[\]\);/);
  assert.match(rm, /FXA\.cats\(FXA\.instrumentOf\(RF\.items\)\)/);
  assert.match(rm, /!host\.fx\.movable\(RF\.items, k, -1\)/);
  // the ordering rules, run on their own
  const src = fx.slice(fx.indexOf("    function isMidiFx(id)"), fx.indexOf("    function fxMeta(id)"));
  const cat = { arp: "MIDI", chd: "MIDI", keys: "inst", eq: "Essentials" };
  const C = { MAX_FX: 8, newId: () => "fnew0001" };
  const mk = new Function("C", "info", "isInstrument", src + "; return { instrumentOf, withInstrument, movable, midiOf };");
  const R = mk(C, (id) => cat[id] && cat[id] !== "inst" ? { category: cat[id] } : null, (id) => cat[id] === "inst");
  const it = (id) => ({ u: "f" + id, id });
  const chain = [it("arp"), it("chd"), it("keys"), it("eq")];
  assert.equal(R.instrumentOf(chain).id, "keys");
  assert.equal(R.instrumentOf([it("eq"), it("keys")]), null);
  assert.deepEqual(R.withInstrument([it("eq"), it("arp")], "keys").map((x) => x.id), ["arp", "keys", "eq"]);
  assert.deepEqual(R.withInstrument(chain, null).map((x) => x.id), ["arp", "chd", "eq"]);
  assert.equal(R.movable(chain, 0, 1), true);
  assert.equal(R.movable(chain, 1, 1), false, "a MIDI effect does not go below the instrument");
  assert.equal(R.movable(chain, 2, -1), false, "the instrument stays put");
  assert.equal(R.movable(chain, 3, -1), false, "an audio effect does not go above the instrument");
});
