// ============================================================
// orOS Studio — commands.js: what the Assistant may change in a song
// project (AS-EDIT, wave ST1, v1.0.0)
// The fixed catalog of the Assistant's edit_in_app for Studio, in the
// step format of the automations (recipes/core.js specs; field names
// as in the other catalogs where they mean the same). The same file
// runs in two places:
//   - in the Assistant, to check a command list, find the projects it
//     is for (targets), count what it would change on a copy (preview)
//     and describe a project to the AI (outline, with the user's
//     consent);
//   - in Studio (assist.js), which applies it and saves the result as
//     new edits of the project, so it syncs like any other change.
// A project is its tracks and clips (core.js data: flat lists of
// projects, tracks, sources and clips). Every changed entity goes
// through StudioCore's normalisers and gets a newer stamp, as Studio's
// own put() and remove() do. Tracks are picked with
//   tracks  track numbers from the top (1 = the first), names or ids,
//           comma separated ("" = every track)
//   what    "" | audio | midi (an instrument track or a MIDI clip)
// and clips also with
//   ids     clip ids from read_in_app (comma separated)
//   has     words in the clip's name (the audio file's or the MIDI
//           clip's)
// Times are seconds from the start of the song; bars count from 1.
// Unset fields (null, "") leave things as they are, so the same list
// twice changes nothing more (addtrack and split make new ones each
// time, semis moves the notes again, and a track number or bar means
// the song as it is when the command runs). Effects, automation and
// the notes' own places stay in the app.
// Pure: no DOM. Needs recipes/core.js and studio/core.js (StudioCore).
// Exposes window.StudioCommands (browser) or module.exports.
// ============================================================
(function (root) {
  "use strict";

  var node = typeof module !== "undefined" && module.exports;
  var R = node ? require("../recipes/core.js") : root.orosRecipes;
  var S = node ? require("./core.js") : root.StudioCore;
  if (!R || !S) return;

  var INSTS = ["piano", "epiano", "organ", "strings", "lead", "bass", "drums"];   // midi.js ORDER
  function oneOf(list) { return { t: "enum", v: list, def: list[0] }; }
  var ONOFF = oneOf(["", "on", "off"]);
  function n(lo, hi) { return { t: "num", lo: lo, hi: hi, def: null }; }
  function i(lo, hi) { return { t: "int", lo: lo, hi: hi, def: null }; }
  var TSEL = { tracks: { t: "str", max: 400 }, what: oneOf(["", "audio", "midi"]) };
  var CSEL = { ids: { t: "str", max: 2000 }, tracks: TSEL.tracks, what: TSEL.what, has: { t: "str", max: 200 } };
  function sel(base, args) {
    var o = {};
    Object.keys(base).forEach(function (k) { o[k] = base[k]; });
    Object.keys(args || {}).forEach(function (k) { o[k] = args[k]; });
    return o;
  }

  // kind: "doc" (every command edits a project)
  var CATALOG = {
    clip: { kind: "doc", args: sel(CSEL, { gain: n(S.GAIN_MIN, S.GAIN_MAX), fi: n(0, 60), fo: n(0, 60), time: n(0, S.MAX_SEC), bar: i(1, 2000), secs: n(S.MIN_LEN, S.MAX_SEC) }) },
    split: { kind: "doc", args: sel(CSEL, { time: n(0, S.MAX_SEC), bar: i(1, 2000) }) },
    notes: { kind: "doc", args: sel(CSEL, { semis: i(-24, 24), vel: i(1, 127) }) },
    remove: { kind: "doc", args: sel(CSEL, {}) },
    track: { kind: "doc", args: sel(TSEL, { vol: n(S.VOL_MIN, S.VOL_MAX), pan: i(-100, 100), mute: ONOFF, solo: ONOFF, c: { t: "color" },
      title: { t: "str", max: S.MAX_NAME }, after: { t: "str", max: 60 } }) },
    addtrack: { kind: "doc", args: { what: { t: "enum", v: ["audio", "midi"], def: "audio" }, title: { t: "str", max: S.MAX_NAME }, inst: oneOf([""].concat(INSTS)), c: { t: "color" } } },
    deltrack: { kind: "doc", args: sel(TSEL, {}) },
    project: { kind: "doc", args: { bpm: n(S.MIN_BPM, S.MAX_BPM), sig: i(2, 7), vol: n(S.VOL_MIN, S.VOL_MAX), loop: ONOFF, bars: { t: "str", max: 20 } } },
    rename: { kind: "doc", args: { title: { t: "str", max: S.MAX_NAME, req: 1 } } }
  };
  var ORDER = Object.keys(CATALOG);
  var MAX_STEPS = 40;

  // What each command does, for the model (English, short). Every op
  // and field is named here (a test checks it).
  var GUIDE = "Studio commands (documents are song projects of up to " + S.MAX_TRACKS + " tracks; tracks are picked with tracks (track numbers from the top, names or ids, comma separated; \"\" every track) and what (\"\" all, audio, or midi = instrument tracks and MIDI clips); " +
    "clips also with ids (clip ids from read_in_app, comma separated) and has (words in the clip's name); times are seconds from the start, bars count from 1; null or \"\" leaves a field as it is):\n" + [
    "clip: for the picked clips gain (" + S.GAIN_MIN + " to " + S.GAIN_MAX + " dB), fi / fo (fade in / out seconds), time or bar (where the clip starts), secs (its length; audio cannot run past its file)",
    "split: cut the picked clips that run through `time` (or the start of `bar`) in two there",
    "notes: for the picked MIDI clips semis (move every note up or down, -24 to 24 semitones; not on drum tracks) and vel (every note's velocity 1-127)",
    "remove: delete the picked clips (needs ids, tracks, what or has)",
    "track: for the picked tracks vol (" + S.VOL_MIN + " to " + S.VOL_MAX + " dB, " + S.VOL_MIN + " = silent), pan (-100 left to 100 right), mute on|off, solo on|off, c (colour, the nearest of Studio's eight), title (new name), after (a track number, name or id, or start: the track moves below it)",
    "addtrack: a new track at the bottom, what audio|midi (an instrument track), title, inst " + INSTS.join("|") + " (the instrument of a midi track), c",
    "deltrack: delete the picked tracks and their clips (needs tracks or what)",
    "project: bpm (" + S.MIN_BPM + "-" + S.MAX_BPM + ", MIDI clips keep their bars and beats, audio stays in time), sig (beats in a bar, 2-7), vol (the master, dB), loop on|off, bars (the loop, e.g. \"5-8\" = bars 5 to 8)",
    "rename: the project's name becomes `title`"
  ].join("\n");

  // ---------- 1. Checking ----------
  var IDS_RX = /^[\s,a-z0-9]*$/, BARS_RX = /^\s*(\d{1,4})\s*(?:-\s*(\d{1,4}))?\s*$/;
  function given(v) { return v !== null && v !== undefined && v !== ""; }
  function picks(st) { return given(st.ids) || given(st.tracks) || given(st.what) || given(st.has); }
  function wrap(op) { var c = {}; c[op] = CATALOG[op]; return c; }
  // One command → { step } or { err } (English, for the model).
  function checkStep(raw) {
    if (!raw || typeof raw !== "object" || typeof raw.op !== "string") return { err: "a command needs op" };
    var def = Object.prototype.hasOwnProperty.call(CATALOG, raw.op) ? CATALOG[raw.op] : null;
    if (!def) return { err: "unknown command " + JSON.stringify(String(raw.op).slice(0, 40)) + " (use " + ORDER.join(", ") + ")" };
    var bad = [];
    Object.keys(raw).forEach(function (k) {
      if (k === "op" || raw[k] === null || raw[k] === undefined) return;
      var spec = def.args[k];
      if (!spec) { bad.push(k + " is not a field of " + raw.op); return; }
      var v = R.arg(spec, raw[k]);
      if (v === undefined || (spec.t === "enum" && spec.v.indexOf(raw[k]) < 0) ||
          (spec.t === "color" && raw[k] !== "" && !v) ||
          ((spec.t === "num" || spec.t === "int") && (raw[k] < spec.lo || raw[k] > spec.hi))) {
        bad.push(k + " " + JSON.stringify(raw[k]).slice(0, 60) + " is not allowed");
      }
    });
    Object.keys(def.args).forEach(function (k) { if (def.args[k].req && !given(raw[k])) bad.push(k + " is missing"); });
    if (typeof raw.ids === "string" && !IDS_RX.test(raw.ids)) bad.push("ids must be clip ids from read_in_app, comma separated");
    if (typeof raw.bars === "string" && raw.bars !== "" && !BARS_RX.test(raw.bars)) bad.push("bars must be like \"5-8\"");
    var st = bad.length ? null : R.normStep(raw, wrap(raw.op));
    if (!st) return { err: raw.op + ": " + (bad.join("; ") || "not valid") };
    if (st.op === "remove" && !picks(st)) return { err: "remove: pick the clips with ids, tracks, what or has" };
    if (st.op === "deltrack" && !given(st.tracks) && !given(st.what)) return { err: "deltrack: pick the tracks with tracks or what" };
    if (st.op === "split" && !given(st.time) && !given(st.bar)) return { err: "split: give time or bar" };
    if (st.op === "clip" && given(st.time) && given(st.bar)) return { err: "clip: give time or bar, not both" };
    if (st.op === "notes" && !given(st.semis) && !given(st.vel)) return { err: "notes: give semis or vel" };
    if (st.op === "addtrack" && st.inst && st.what !== "midi") return { err: "addtrack: inst is for a midi track" };
    if (st.op === "project" && !given(st.bpm) && !given(st.sig) && !given(st.vol) && !st.loop && !given(st.bars)) return { err: "project: give bpm, sig, vol, loop or bars" };
    return { step: st };
  }
  // A command list → { ok, steps } | { ok: false, err }
  function check(list) {
    if (!Array.isArray(list) || !list.length) return { ok: false, err: "steps is empty" };
    if (list.length > MAX_STEPS) return { ok: false, err: "at most " + MAX_STEPS + " commands" };
    var steps = [], errs = [];
    list.forEach(function (raw, k) {
      var r = checkStep(raw);
      if (r.err) errs.push("command " + (k + 1) + " " + r.err);
      else steps.push(r.step);
    });
    if (errs.length) return { ok: false, err: errs.slice(0, 6).join(". ") };
    return { ok: true, steps: steps };
  }

  // ---------- 2. A project copy and picking ----------
  function norm(s) { return String(s || "").toLowerCase().replace(/[\s ]+/g, " ").trim(); }
  function note(env, k) { if (env && env.notes && env.notes.indexOf(k) < 0) env.notes.push(k); }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  // A project as the commands see it: { pid, data } where data holds
  // that project's entities (and the tombstones, for the stamps).
  function work(dat, pid) {
    var d = S.emptyData();
    d.tombs = clone(dat.tombs || {});
    var p = S.find(dat, "projects", pid);
    if (p) d.projects.push(clone(p));
    ["tracks", "sources", "clips"].forEach(function (key) { d[key] = clone(S.ofProject(dat, key, pid)); });
    return { pid: pid, data: d };
  }
  function proj(w) { return S.find(w.data, "projects", w.pid); }
  // Studio's put() and remove(): a newer stamp than the entity and its tombstone.
  function nextM(w, id, old, now) { return Math.max(now, (w.data.tombs[id] || 0) + 1, old ? old.m + 1 : 0); }
  function put(w, key, x, now) {
    var old = S.find(w.data, key, x.id);
    var y = Object.assign({}, x, { m: nextM(w, x.id, old, now) });
    var part = S.emptyData(); part[key] = [y];
    w.data = S.mergeStudio(w.data, part);
  }
  function del(w, key, id, now) {
    var x = S.find(w.data, key, id);
    if (!x) return;
    var part = S.emptyData();
    part.tombs[id] = Math.max(now, x.m);
    w.data = S.mergeStudio(w.data, part);
  }
  function tracksOf(w) { return S.tracksOf(w.data, w.pid); }
  // A track by number (1 = top), name or id
  function trackBy(w, q) {
    var trs = tracksOf(w), s = norm(q);
    if (!s) return null;
    if (/^\d+$/.test(s)) return trs[+s - 1] || null;
    var hit = null;
    trs.forEach(function (tr) { if (!hit && (tr.id === s || norm(tr.name) === s)) hit = tr; });
    return hit;
  }
  function isMidiTrack(w, tr) { return !!tr.inst || S.clipsOfTrack(w.data, tr.id).some(S.isMidi); }
  function pickTracks(w, st, env) {
    var trs = tracksOf(w), want = null;
    if (given(st.tracks)) {
      want = {};
      String(st.tracks).split(",").forEach(function (q) {
        var tr = trackBy(w, q);
        if (tr) want[tr.id] = 1; else if (norm(q)) note(env, "noTrack");
      });
    }
    return trs.filter(function (tr) {
      if (want && !want[tr.id]) return false;
      if (st.what === "midi" && !isMidiTrack(w, tr)) return false;
      if (st.what === "audio" && isMidiTrack(w, tr)) return false;
      return true;
    });
  }
  function clipName(w, c) {
    if (S.isMidi(c)) { var tr = S.find(w.data, "tracks", c.t); return c.name || (tr ? tr.name : ""); }
    var src = S.find(w.data, "sources", c.s);
    return src ? src.name : "";
  }
  // The picked clips, track by track in time order.
  function pickClips(w, st, env) {
    var ids = given(st.ids) ? String(st.ids).split(/[\s,]+/).filter(Boolean) : null, words = given(st.has) ? norm(st.has) : "";
    var out = [];
    pickTracks(w, { tracks: st.tracks, what: "" }, env).forEach(function (tr) {
      S.clipsOfTrack(w.data, tr.id).forEach(function (c) {
        if (ids && ids.indexOf(c.id) < 0) return;
        if (st.what === "midi" && !S.isMidi(c)) return;
        if (st.what === "audio" && S.isMidi(c)) return;
        if (words && norm(clipName(w, c)).indexOf(words) < 0) return;
        out.push(c);
      });
    });
    return out;
  }
  function barAt(p, bar) { return (bar - 1) * S.barSec(p.bpm, p.sig); }
  function nearestColor(c) {
    function rgb(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
    var a = rgb(c), best = S.COLORS[0], bd = Infinity;
    S.COLORS.forEach(function (x) {
      var b = rgb(x), d = (a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]) + (a[2] - b[2]) * (a[2] - b[2]);
      if (d < bd) { bd = d; best = x; }
    });
    return best;
  }
  // Each entity of the project without its stamp, by id.
  function bodies(w) {
    var o = {};
    S.LISTS.forEach(function (key) {
      w.data[key].forEach(function (x) { if (x.p === w.pid || x.id === w.pid) o[x.id] = JSON.stringify(x, function (k, v) { return k === "m" ? undefined : v; }); });
    });
    return o;
  }
  function diff(a, b) {
    var k, c = 0, all = {};
    for (k in a) all[k] = 1;
    for (k in b) all[k] = 1;
    for (k in all) if (a[k] !== b[k]) c++;
    return c;
  }

  // ---------- 3. Applying ----------
  // One command on a project copy (work()) → how many tracks, clips and
  // project settings changed. env: { notes: [], now: ms, newId: (kind)
  // → a fresh id, trackName: (n, inst) → a new track's name in the
  // user's language }.
  function apply(w, st, env) {
    env = env || {};
    var now = env.now || Date.now(), p = proj(w);
    if (!p) return 0;
    var before = bodies(w);
    function done() { return diff(before, bodies(w)); }
    function fresh(kind) { return env.newId ? env.newId(kind) : S.newId(kind, Math.random); }
    switch (st.op) {
      case "rename":
        put(w, "projects", Object.assign({}, p, { name: st.title }), now);
        return done();
      case "project": {
        var pp = Object.assign({}, p, { loop: Object.assign({}, p.loop) });
        if (given(st.bpm)) pp.bpm = st.bpm;
        if (given(st.sig)) pp.sig = st.sig;
        if (given(st.vol)) pp.vol = st.vol;
        if (given(st.bars)) {
          var m = BARS_RX.exec(st.bars), a = +m[1], b = m[2] ? +m[2] : a;
          if (b < a) { var tmp = a; a = b; b = tmp; }
          pp.loop.a = barAt(pp, Math.max(1, a)); pp.loop.b = barAt(pp, b + 1);
          if (!st.loop) pp.loop.on = true;
        }
        if (st.loop) pp.loop.on = st.loop === "on";
        if (pp.loop.on && !(pp.loop.b - pp.loop.a >= S.MIN_LEN)) { note(env, "noLoop"); pp.loop.on = false; }
        var np = S.normProject(Object.assign({}, pp, { m: p.m }));
        if (!np || JSON.stringify(np) === JSON.stringify(p)) return 0;
        put(w, "projects", np, now);
        // a new tempo moves the MIDI clips with it (same bars and beats), as Studio does
        if (np.bpm !== p.bpm) {
          var r = p.bpm / np.bpm;
          w.data.clips.filter(function (c) { return c.p === w.pid && S.isMidi(c); }).forEach(function (c) { put(w, "clips", S.retimeClip(c, r), now); });
        }
        return done();
      }
      case "addtrack": {
        var trs = tracksOf(w);
        if (trs.length >= S.MAX_TRACKS) { note(env, "maxTracks"); return 0; }
        var midi = st.what === "midi";
        var tr = S.normTrack({
          id: fresh("t"), m: 0, p: w.pid, name: st.title || "",
          color: st.c ? nearestColor(st.c) : S.nextColor(trs),
          ord: trs.length ? trs[trs.length - 1].ord + 1 : 0,
          inst: midi ? (st.inst || "piano") : undefined
        });
        if (!tr.name) tr.name = env.trackName ? env.trackName(trs.length + 1, tr.inst || "") : midi ? tr.inst : "Track " + (trs.length + 1);
        put(w, "tracks", tr, now);
        return done();
      }
    }
    if (st.op === "track" || st.op === "deltrack") {
      var tl = pickTracks(w, st, env);
      if (!tl.length) { note(env, "noTracks"); return 0; }
      if (st.op === "deltrack") {
        tl.forEach(function (x) {
          S.clipsOfTrack(w.data, x.id).forEach(function (c) { del(w, "clips", c.id, now); });
          del(w, "tracks", x.id, now);
        });
        return done();
      }
      tl.forEach(function (x) {
        var t2 = Object.assign({}, x);
        if (given(st.vol)) t2.vol = st.vol;
        if (given(st.pan)) t2.pan = st.pan;
        if (st.mute) t2.mute = st.mute === "on";
        if (st.solo) t2.solo = st.solo === "on";
        if (st.c) t2.color = nearestColor(st.c);
        if (given(st.title)) t2.name = st.title;
        var nt = S.normTrack(t2);
        if (nt && JSON.stringify(nt) !== JSON.stringify(x)) put(w, "tracks", nt, now);
      });
      if (given(st.after)) {
        // the picked tracks go below `after` (or to the top), in their order
        var all = tracksOf(w), moving = tl.map(function (x) { return x.id; });
        var anchor = norm(st.after) === "start" ? null : trackBy(w, st.after);
        if (norm(st.after) !== "start" && !anchor) note(env, "noTrack");
        else if (!(anchor && moving.indexOf(anchor.id) >= 0)) {
          var rest = all.filter(function (x) { return moving.indexOf(x.id) < 0; }), at = 0;
          if (anchor) rest.forEach(function (x, k) { if (x.id === anchor.id) at = k + 1; });
          var seq = rest.slice(0, at).concat(all.filter(function (x) { return moving.indexOf(x.id) >= 0; }), rest.slice(at));
          seq.forEach(function (x, k) {
            var cur = S.find(w.data, "tracks", x.id);
            if (cur.ord !== k) put(w, "tracks", Object.assign({}, cur, { ord: k }), now);
          });
        }
      }
      return done();
    }
    var list = pickClips(w, st, env);
    if (!list.length) { note(env, "noClips"); return 0; }
    switch (st.op) {
      case "remove":
        list.forEach(function (c) { del(w, "clips", c.id, now); });
        return done();
      case "split": {
        var at = given(st.time) ? st.time : barAt(p, st.bar), cut = 0;
        list.forEach(function (c) {
          if (w.data.clips.length >= S.MAX_CLIPS) { note(env, "maxClips"); return; }
          var parts = S.splitClip(c, at, fresh("c"));
          if (!parts) return;
          put(w, "clips", parts[0], now); put(w, "clips", parts[1], now);
          cut++;
        });
        if (!cut) note(env, "noClips");
        return done();
      }
      case "notes":
        list.forEach(function (c) {
          if (!S.isMidi(c)) return;
          var tr = S.find(w.data, "tracks", c.t), shift = given(st.semis) ? st.semis : 0;
          if (shift && tr && tr.inst === "drums") { note(env, "drums"); shift = 0; }
          var out = false;
          var nn = c.n.map(function (q) {
            var pitch = q[0] + shift;
            if (pitch < 0 || pitch > 127) { out = true; pitch = Math.max(0, Math.min(127, pitch)); }
            return [pitch, q[1], q[2], given(st.vel) ? st.vel : q[3]];
          });
          if (out) note(env, "range");
          var nc = S.normClip(Object.assign({}, c, { n: nn }));
          if (nc && JSON.stringify(nc) !== JSON.stringify(c)) put(w, "clips", nc, now);
        });
        return done();
      case "clip":
        list.forEach(function (c) {
          var x = Object.assign({}, c), src = c.s ? S.find(w.data, "sources", c.s) : null, dur = src ? src.dur : 0;
          if (given(st.time)) x = S.moveClip(x, st.time);
          if (given(st.bar)) x = S.moveClip(x, barAt(p, st.bar));
          if (given(st.secs)) {
            x = S.trimEnd(x, x.at + st.secs, S.isMidi(c) ? 0 : dur);
            if (Math.abs(x.len - st.secs) > 1e-6) note(env, "short");
          }
          if (given(st.gain)) x.gain = st.gain;
          if (given(st.fi)) x.fi = Math.min(st.fi, x.len);
          if (given(st.fo)) x.fo = Math.min(st.fo, x.len);
          var nc = S.normClip(x);
          if (nc && JSON.stringify(nc) !== JSON.stringify(c)) put(w, "clips", nc, now);
        });
        return done();
    }
    return 0;
  }

  // Undo: bring a project back to an earlier copy of itself (Studio's
  // own restore(): what is not in the copy is deleted, the rest is
  // written with newer stamps). snap: { project, tracks, sources, clips }.
  function snapshot(dat, pid) {
    return {
      project: S.find(dat, "projects", pid),
      tracks: S.ofProject(dat, "tracks", pid),
      sources: S.ofProject(dat, "sources", pid),
      clips: S.ofProject(dat, "clips", pid)
    };
  }
  function restore(dat, pid, snap, now) {
    var w = { pid: pid, data: dat }, part = S.emptyData();
    function stamp(key, x) { return Object.assign({}, x, { m: nextM(w, x.id, S.find(dat, key, x.id), now) }); }
    ["tracks", "sources", "clips"].forEach(function (key) {
      var keep = {};
      snap[key].forEach(function (x) { keep[x.id] = true; });
      S.ofProject(dat, key, pid).forEach(function (x) { if (!keep[x.id]) part.tombs[x.id] = Math.max(now, x.m); });
      snap[key].forEach(function (x) {
        var cur = S.find(dat, key, x.id);
        if (cur && JSON.stringify(Object.assign({}, x, { m: cur.m })) === JSON.stringify(cur)) return;
        part[key].push(stamp(key, x));
      });
    });
    if (snap.project) {
      var cp = S.find(dat, "projects", pid);
      if (!(cp && JSON.stringify(Object.assign({}, snap.project, { m: cp.m })) === JSON.stringify(cp))) part.projects.push(stamp("projects", snap.project));
    }
    return S.mergeStudio(dat, part);
  }

  // ---------- 4. For the Assistant ----------
  // The stored slice as a list of documents (its projects, newest
  // first): { docs: [{ id, name, m }], data } (each doc's `store` is
  // the whole slice and `pid` its project).
  function view(dat) {
    if (!dat || typeof dat !== "object" || !Array.isArray(dat.projects)) return { docs: [], data: null };
    var d = S.mergeStudio(dat, dat);
    return { docs: S.newestFirst(d.projects).map(function (p) {
      var o = { id: p.id, name: p.name, m: p.m };
      Object.defineProperty(o, "store", { value: d });   // not copied
      return o;
    }), data: d };
  }
  // Which projects a request is for. data: view(), open: the open
  // project's id (prefs.cur). designs: open | named | all.
  function targets(data, folders, open, designs, name) {
    var docs = data && Array.isArray(data.docs) ? data.docs : [];
    if (designs === "new") return { ok: false, err: "a new song project is made in Studio itself; use open, named or all" };
    if (designs === "folder") return { ok: false, err: "Studio has no folders; use open, named or all" };
    if (!docs.length) return { ok: false, err: "the user has no projects in Studio yet" };
    var list = [];
    if (designs === "all") list = docs.slice();
    else if (designs === "named") {
      var q = norm(name);
      if (!q) return { ok: false, err: "give the project's name" };
      list = docs.filter(function (d) { return norm(d.name) === q; });
      if (!list.length) list = docs.filter(function (d) { return norm(d.name).indexOf(q) >= 0; });
      if (!list.length) return { ok: false, err: "no project is called " + JSON.stringify(String(name).slice(0, 80)) + "; projects: " + docs.slice(0, 30).map(function (d) { return JSON.stringify(d.name); }).join(", ") };
      if (list.length > 1 && !docs.some(function (d) { return norm(d.name) === q; })) {
        return { ok: false, err: "several projects match " + JSON.stringify(String(name).slice(0, 80)) + ": " + list.slice(0, 20).map(function (d) { return JSON.stringify(d.name); }).join(", ") + "; give the whole name" };
      }
      if (list.length > 1) list = list.filter(function (d) { return norm(d.name) === q; });
    } else {
      var o = null;
      docs.forEach(function (d) { if (d.id === open) o = d; });
      // Studio opens the newest project when none was open
      if (!o && !open) o = docs[0];
      if (!o) return { ok: false, err: "no project is open in Studio; name the project (designs: named)" };
      list = [o];
    }
    return { ok: true, docs: list.map(function (d) { return { id: d.id, name: d.name || "" }; }) };
  }
  // What a list of commands would change, on copies: { n, d, per[{id,
  // name, n}], cut: 0, notes[] }. data: view().
  function preview(data, ids, steps) {
    var out = { n: 0, d: 0, per: [], cut: 0, notes: [] }, recs = {}, seq = 0;
    ((data && data.docs) || []).forEach(function (d) { recs[d.id] = d.store; });
    var env = { notes: out.notes, now: Date.now(), newId: function (kind) { seq++; return kind + "zzpreview" + seq; } };
    ids.forEach(function (id) {
      if (!recs[id]) return;
      var w = work(recs[id], id), k = 0;
      steps.forEach(function (st) { k += apply(w, st, env); });
      if (k) { out.n += k; out.d++; out.per.push({ id: id, name: proj(w).name, n: k }); }
    });
    return out;
  }
  // A project for the model: its settings, tracks and every clip with
  // its id, track, place in seconds and bars, and what can be changed.
  var OUT_CLIPS = 500;
  var NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  function pitchName(p) { return NOTE_NAMES[p % 12] + (Math.floor(p / 12) - 1); }
  function r3(v) { return Math.round(v * 1000) / 1000; }
  function outline(doc) {
    var dat = doc && doc.store, p = dat && S.find(dat, "projects", doc.id);
    if (!p) return null;
    var w = { pid: p.id, data: dat }, trs = tracksOf(w), bar = S.barSec(p.bpm, p.sig), all = [];
    var o = { name: p.name, bpm: p.bpm, sig: p.sig, vol: p.vol, length: r3(S.projectEnd(dat.clips.filter(function (c) { return c.p === p.id; }))), barSecs: r3(bar), tracks: [], clips: [] };
    if (p.loop.on) o.loop = { from: r3(p.loop.a), to: r3(p.loop.b) };
    if (p.fx.length) o.masterEffects = p.fx.map(function (f) { return f.id; });
    trs.forEach(function (tr, k) {
      var e = { n: k + 1, id: tr.id, name: tr.name, kind: isMidiTrack(w, tr) ? "midi" : "audio", vol: tr.vol, pan: tr.pan, c: tr.color };
      if (tr.inst) e.inst = tr.inst;
      if (tr.mute) e.mute = true;
      if (tr.solo) e.solo = true;
      if (tr.fx.length) e.effects = tr.fx.map(function (f) { return f.id; });
      if (tr.auto) e.automation = tr.auto.map(function (l) { return l.k; });
      o.tracks.push(e);
      S.clipsOfTrack(dat, tr.id).forEach(function (c) { all.push([k + 1, c]); });
    });
    all.slice(0, OUT_CLIPS).forEach(function (x) {
      var c = x[1], e = { id: c.id, track: x[0], kind: S.isMidi(c) ? "midi" : "audio", name: clipName(w, c), start: r3(c.at), end: r3(S.clipEnd(c)), bar: r3(c.at / bar + 1) };
      if (c.gain) e.gain = c.gain;
      if (c.fi) e.fi = c.fi;
      if (c.fo) e.fo = c.fo;
      if (S.isMidi(c) && c.n.length) {
        var lo = 127, hi = 0;
        c.n.forEach(function (q) { lo = Math.min(lo, q[0]); hi = Math.max(hi, q[0]); });
        e.notes = c.n.length; e.range = pitchName(lo) + "-" + pitchName(hi);
      }
      o.clips.push(e);
    });
    if (all.length > OUT_CLIPS) o.note = "Only the first " + OUT_CLIPS + " of " + all.length + " clips are listed.";
    return o;
  }

  var api = {
    CATALOG: CATALOG, ORDER: ORDER, GUIDE: GUIDE, MAX_STEPS: MAX_STEPS, INSTS: INSTS,
    check: check, work: work, apply: apply, snapshot: snapshot, restore: restore,
    view: view, targets: targets, preview: preview, outline: outline
  };
  if (node) module.exports = api;
  else root.StudioCommands = api;
})(typeof window !== "undefined" ? window : this);
