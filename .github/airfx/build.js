#!/usr/bin/env node
// Builds studio/airfx/ from an Airwindows checkout: one translated file per
// plugin in PLUGINS (studio/airfx/fx/aw_<name>.js), fx/index.json in the
// format of NULL JSFX's (so Studio's effect list reads both) and the
// licence. Every plugin listed here passes the null test against the
// original (.github/airfx/null-test.js); run it after a change.
//
//   node .github/airfx/build.js <airwindows checkout>
//
// The commit of the checkout is written to studio/airfx/release.txt.
"use strict";
const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const { translate } = require("./cpp2js.js");

// Name, words for the search (the effect list matches name + tags)
const PLUGINS = [
  ["Galactic", "reverb space big wide ambient pad"],
  ["Verbity2", "reverb room hall space"],
  ["Chamber", "reverb chamber room space"],
  ["PocketVerbs", "reverb room plate gated space"],
  ["TapeDelay2", "delay echo tape"],
  ["PurestDrive", "saturation drive warm subtle"],
  ["Density2", "saturation density drive punch"],
  ["Tube2", "tube saturation warm valve"],
  ["Drive", "drive overdrive distortion"],
  ["Mojo", "saturation loudness warm"],
  ["Spiral2", "saturation smooth clip"],
  ["BassDrive", "bass drive distortion amp"],
  ["Tape", "tape saturation warm"],
  ["ToTape6", "tape saturation flutter warm"],
  ["IronOxide5", "tape saturation flutter vintage"],
  ["Pressure4", "compressor dynamics"],
  ["ButterComp2", "compressor smooth glue dynamics"],
  ["Logical4", "compressor bus glue dynamics"],
  ["BlockParty", "limiter loud mastering"],
  ["ADClip7", "clipper limiter loud mastering"],
  ["ClipOnly2", "clipper safety mastering"],
  ["Gatelope", "gate noise envelope filter"],
  ["Baxandall2", "eq tone bass treble"],
  ["Capacitor2", "filter lowpass highpass tone"],
  ["DeEss", "de-esser sibilance vocal"],
  ["Air", "eq air treble brightness"],
  ["Focus", "saturation mid presence focus"],
  ["Channel9", "console channel strip analog"],
  ["Console7Channel", "console channel analog summing"],
  ["Console7Buss", "console bus analog summing master"],
  ["Mackity", "console preamp drive"],
  ["Wider", "stereo width wide"]
];

function main() {
  const src = process.argv[2];
  if (!src) { console.error("usage: build.js <airwindows checkout>"); process.exit(2); }
  const base = path.join(path.resolve(src), "plugins", "LinuxVST", "src");
  const dest = path.join(__dirname, "..", "..", "studio", "airfx");
  fs.mkdirSync(path.join(dest, "fx"), { recursive: true });
  const effects = [];
  const keep = {};
  PLUGINS.forEach(([name, tags]) => {
    const tr = translate(path.join(base, name), name, { tags });
    const file = path.join(dest, "fx", tr.id + ".js");
    fs.writeFileSync(file, tr.js);
    keep[tr.id + ".js"] = true;
    effects.push({ id: tr.id, name: tr.name, category: "Airwindows", tags: "airwindows " + tags, ins: 2, outs: 2, sliders: tr.params.length, bytes: Buffer.byteLength(tr.js) });
  });
  fs.readdirSync(path.join(dest, "fx")).forEach((f) => {
    if (/\.js$/.test(f) && !keep[f]) fs.unlinkSync(path.join(dest, "fx", f));
  });
  effects.sort((a, b) => a.name.localeCompare(b.name));
  fs.writeFileSync(path.join(dest, "fx", "index.json"), JSON.stringify({ version: "1.0", effects }, null, 1) + "\n");
  fs.copyFileSync(path.join(path.resolve(src), "LICENSE"), path.join(dest, "LICENSE.md"));
  let rev = "";
  try { rev = cp.execFileSync("git", ["-C", path.resolve(src), "rev-parse", "HEAD"]).toString().trim(); } catch (e) {}
  fs.writeFileSync(path.join(dest, "release.txt"), "airwindows/airwindows " + rev + "\n");
  console.log("studio/airfx: " + effects.length + " effects, " + effects.reduce((n, e) => n + e.bytes, 0) + " bytes");
}
main();
