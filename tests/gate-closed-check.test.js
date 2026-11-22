"use strict";
// GATE-PL11 (Chris 2026-11-22, dogfooding the podcast «Πλανόδιο», item
// 11): the relay checks edit_in_app against the catalogs sealed in the
// closed copy (assistant.js gateEditPack). It must never be stricter than
// the apps themselves: every command list an app's commands.js takes
// passes the relay's check too. Random lists per app and command, the
// app's own check() as the referee.
// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const ROOT = path.join(__dirname, "..");
let G;
test.before(async () => { G = await import(path.join(ROOT, "relay/gate.js")); });

const APPS = { atelier: "atelier/commands.js", layout: "layout/commands.js", mindmap: "mindmap/commands.js", montage: "montage/commands.js",
  photolab: "photolab/commands.js", slides: "slides/commands.js", spreadsheet: "spreadsheet/commands.js", studio: "studio/commands.js",
  whiteboard: "whiteboard/commands.js", writer: "writer/commands.js" };
// assistant.js packSpec, the same keys
const KEYS = ["t", "v", "lo", "hi", "req", "max", "min", "def", "of", "f"];
function packSpec(sp, d) {
  if (!sp || typeof sp !== "object" || d > 4) return null;
  const o = {};
  KEYS.forEach((k) => {
    if (sp[k] === undefined) return;
    if (k === "of") { const x = packSpec(sp.of, d + 1); if (x) o.of = x; }
    else if (k === "f") { const f = {}; Object.keys(sp.f || {}).forEach((n) => { const y = packSpec(sp.f[n], d + 1); if (y) f[n] = y; }); o.f = f; }
    else if (k === "v") { if (Array.isArray(sp.v)) o.v = sp.v.filter((z) => typeof z === "string" || typeof z === "number").slice(0, 200); }
    else if (sp[k] === null || ["number", "boolean", "string"].indexOf(typeof sp[k]) >= 0) o[k] = sp[k];
  });
  return typeof o.t === "string" ? o : null;
}
function packOf(mod) {
  const ops = {};
  Object.keys(mod.CATALOG).forEach((op) => { const a = {}; Object.keys(mod.CATALOG[op].args || {}).forEach((k) => { const x = packSpec(mod.CATALOG[op].args[k], 0); if (x) a[k] = x; }); ops[op] = a; });
  return { max: mod.MAX_STEPS, ops, docs: ["Doc A", "Doc B"], open: "Doc A" };
}
let seed = 12345;
function rnd() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }
function pick(l) { return l[Math.floor(rnd() * l.length)]; }
function valueFor(sp, d) {
  const r = rnd();
  if (r < 0.12) return pick([null, "", 0, -5, 1e9, "x", true, [], {}, "#ABCDEF", "#zzzzzz", "sans", "fs_noto_serif"]);
  switch (sp.t) {
    case "str": return pick(["hello", "Πλανόδιο", "a,b", "1-3", "", "/internal/Studio/Podcasts/a.orosstudio", "/internal/Montage/Projects/a.orosmontage"]);
    case "color": return pick(["#112233", "#ff0000", "", "red"]);
    case "font": return pick(["sans", "serif", "fs_inter", "Comic Sans"]);
    case "num": case "int": { const lo = typeof sp.lo === "number" ? sp.lo : 0, hi = typeof sp.hi === "number" ? sp.hi : 100; return lo + (hi - lo) * rnd() * (rnd() < 0.1 ? 2 : 1); }
    case "enum": return Array.isArray(sp.v) && sp.v.length ? pick(sp.v) : "x";
    case "bool": return pick([true, false, 0, 1]);
    case "list": { const n = Math.floor(rnd() * 3); const out = []; for (let i = 0; i < n; i++) out.push(valueFor(sp.of || { t: "str" }, (d || 0) + 1)); return out; }
    case "obj": { const o = {}; Object.keys(sp.f || {}).forEach((k) => { o[k] = valueFor(sp.f[k], (d || 0) + 1); }); return o; }
  }
  return "x";
}

test("GATE-PL11: the relay's check is never stricter than an app's own (random command lists)", () => {
  let agree = 0, laxer = 0;
  for (const app of Object.keys(APPS)) {
    const mod = require(path.join(ROOT, APPS[app])), pack = { [app]: packOf(mod) };
    for (const op of Object.keys(mod.CATALOG)) {
      const args = mod.CATALOG[op].args || {};
      for (let i = 0; i < 60; i++) {
        const st = { op };
        Object.keys(args).forEach((k) => { if (args[k].req || rnd() < 0.5) st[k] = valueFor(args[k], 0); });
        if (rnd() < 0.05) st.bogus = 1;
        const steps = op === "create" ? [st] : [st];
        const dev = mod.check(steps);
        const rel = G.editCheck(pack, { app, designs: op === "create" ? "new" : "named", name: "Doc A", steps }, { hasFile: () => true });
        if (dev.ok) {
          assert.deepEqual(rel.errs, [], app + " " + JSON.stringify(st) + " is taken by the app, refused by the relay");
          agree++;
        } else if (rel.errs.length) agree++; else laxer++;
      }
    }
  }
  assert.ok(agree > 1000, "enough lists compared (" + agree + ", relay laxer on " + laxer + ")");
});

test("GATE-PL11: editCheck finds the document, the file and the obvious mistakes", () => {
  const SC = require(path.join(ROOT, "studio/commands.js")), pack = { studio: packOf(SC) };
  pack.studio.docs = ["Πλανόδιο 1", "Πλανόδιο 2", "Demo"];
  const ok = (a, c) => G.editCheck(pack, Object.assign({ app: "studio" }, a), c || {});
  assert.deepEqual(ok({ designs: "named", name: "ΠΛΑΝΟΔΙΟ 2", steps: [{ op: "project", bpm: 96 }] }).docs, ["Πλανόδιο 2"], "case and accents do not matter");
  assert.match(ok({ designs: "named", name: "Πλανόδιο", steps: [{ op: "project", bpm: 96 }] }).errs[0], /several documents match/);
  assert.match(ok({ designs: "named", name: "Ballads", steps: [{ op: "project", bpm: 96 }] }).errs[0], /no document is called "Ballads"; documents: "Πλανόδιο 1"/);
  assert.deepEqual(ok({ designs: "named", name: "Ep 3", steps: [{ op: "project", bpm: 96 }] }, { newDocs: ["Ep 3"] }).errs, [], "a waiting import's project");
  assert.match(ok({ steps: [] }).errs[0], /steps is empty/);
  assert.match(ok({ steps: new Array(SC.MAX_STEPS + 1).fill({ op: "project", bpm: 90 }) }).errs[0], /at most/);
  assert.match(ok({ steps: [{ op: "project", tempo: 90 }] }).errs[0], /tempo is not a field of project/);
  assert.match(ok({ steps: [{ op: "remove" }, { op: "create", from: "/internal/a.orosstudio" }] }).errs.join(" "), /create must be the first command/);
  const imp = { designs: "new", steps: [{ op: "create", from: "/internal/Studio/Podcasts/Ep3.orosstudio" }] };
  assert.match(ok(imp, { hasFile: () => false }).errs[0], /neither in the copy of Claude's folders nor waiting in a files_write/);
  assert.deepEqual(ok(imp, { hasFile: () => true }).errs, []);
  assert.deepEqual(ok(imp, { hasFile: () => true }).docs, ["Ep3"]);
  const unknown = ok(imp, { hasFile: () => null });
  assert.deepEqual(unknown.errs, []);
  assert.match(unknown.notes[0], /looked for when the commands run/);
  assert.match(G.editCheck(pack, { app: "layout", steps: [{ op: "x" }] }, {}).errs[0], /layout has no documents Claude may change[\s\S]*apps: studio/);
  const dry = JSON.parse(G.closedDryText(ok({ designs: "named", name: "Demo", steps: [{ op: "project", bpm: 96 }] }), { app: "studio" }, "2026-11-22T10:00:00.000Z"));
  assert.equal(dry.dry_run, true);
  assert.equal(dry.checked_with_oros_closed, true);
  assert.deepEqual(dry.documents, ["Demo"]);
  assert.match(dry.note, /Nothing was changed/);
});
