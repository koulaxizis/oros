// ============================================================
// orOS Star Chart — the rules (v1.0.0), no DOM
// An idle game: a small hilltop observatory. Telescopes gather
// starlight every minute, open or closed; starlight buys telescopes and
// draws constellations by joining the stars of a seeded sky field.
// Each constellation gives a lasting bonus by the kinds of its stars
// and its shape, and lines may never cross, so the sky is a calm
// puzzle on top of the idle core. Everything is a pure function of the
// state and the time, so a week away is worked out on the next open
// with the same code that runs while it is open, and tests can step it
// (tests/starchart.test.js).
//
// Time: real time. The moon is the real moon of the date (a new moon
// gives more, a full moon less); clouds are a seeded line per real
// hour, the same on every device. Away, the first 7 days count in full
// and the rest at half (catchUp); a clock that went back counts nothing.
//
// State (also the synced slice "starchart", oros-starchart-data;
// normalize gives the canonical copy):
//   { v, seed, br, at, life, sl, lv: {..}, cs: [{ s, l, n, k }], acts,
//     sn (seasons begun so far), tr: [trait ids],
//     ax: [{ n, k, p, l, b }] the star atlas (past constellations,
//     newest last, at most AX_MAX), ab0 (atlas bonus of entries that
//     fell off the list), mi (milestones, bits), hc (clear/haze/cloud
//     hours seen, for the records) }
//   br = reset stamp (Start over), at = wall clock of the state (ms),
//   life = starlight gathered over the whole game (only grows),
//   sl = starlight now. A constellation: s = its stars (indices into
//   the season's field), l = its lines [[i, j], i < j], n = the name
//   the person gave ("" = the seeded name k).
// Merge (R5, symmetric): the larger br, then the larger life, then the
// later at, then the larger JSON. The further-ahead sky wins.
// ============================================================
(function (root) {
  "use strict";

  var V = 1;
  var MIN = 60000, HOUR = 3600000;
  var FULL_MS = 7 * 86400000;          // away: full rate for 7 days
  var MAX_MS = 400 * 86400000;         // away: at most this much is worked out
  var GW = 12, GH = 9;                 // the sky grid (points 0..GW-1, 0..GH-1)
  var STARS = 24;                      // stars in a field
  var MIN_C = 3, MAX_C = 8;            // stars in one constellation
  var REACH = 3;                       // longest line, in grid cells
  var SEASON_N = 6;                    // constellations a season needs
  var SEASON_TEL = "dish";             // and this telescope
  var AX_MAX = 120;
  var NAME_MAX = 24;
  var NAMES = 30;                      // seeded names per language (the screen has them)

  // The moon: the real synodic month from a known new moon
  // (2000-01-06 18:14 UTC). Phase 0 = new, 0.5 = full.
  var SYNODIC = 29.530588853 * 86400000;
  var NEW_MOON = Date.UTC(2000, 0, 6, 18, 14, 0);
  var MOON_AMP = 0.2;

  // Clouds: per 3-hour block, seeded. Factor on all the starlight.
  var SKY = ["clear", "haze", "cloud"];
  var SKYF = { clear: 1, haze: 0.75, cloud: 0.4 };
  var SKYP = { clear: 0.55, haze: 0.25, cloud: 0.20 };

  // Star kinds: what one point of brightness gives in a constellation.
  var KINDS = ["blue", "gold", "red", "white"];
  var KINDP = { blue: 0.3, gold: 0.25, red: 0.25, white: 0.2 };
  var BLUE_F = 0.03;                   // telescopes +3% per brightness
  var GOLD_F = 0.02;                   // telescopes 2% cheaper per brightness
  var RED_F = 0.03;                    // lines 3% cheaper per brightness
  var WHITE_F = 0.005;                 // atlas +0.5% per brightness (at the season's end)
  var ATLAS_F = 0.01;                  // every atlas entry +1% to everything
  var GOLD_MIN = 0.4, RED_MIN = 0.25;  // price floors
  var SHAPE = { chain: 1, branch: 1.25, loop: 1.5, both: 1.75 };
  var SAME_F = 1.2;                    // all stars of one kind
  var LINE_C = 10, LINE_G = 1.25;      // line price: 10 × 1.25^lines this season

  // Telescopes: starlight per minute each, first price, price growth.
  var TELS = [
    { id: "spy",   r: 1,    c: 10,      f: 1.22 },
    { id: "refr",  r: 8,    c: 150,     f: 1.24 },
    { id: "refl",  r: 60,   c: 3000,    f: 1.26 },
    { id: "great", r: 450,  c: 80000,   f: 1.28 },
    { id: "dish",  r: 3500, c: 6000000, f: 1.3 }
  ];
  var TEL = {};
  TELS.forEach(function (x) { TEL[x.id] = x; });
  var TEL_MAX = 200;
  // Upgrades: dark sky (+25% all, 4 levels), star compass (reach +1,
  // 2 levels), a polished mirror per telescope kind (×2 once).
  var UPS = [
    { id: "dark", max: 4, cost: function (n) { return 400 * Math.pow(8, n); } },
    { id: "comp", max: 2, cost: function (n) { return [2000, 60000][n]; } }
  ];
  TELS.forEach(function (x) {
    UPS.push({ id: "m" + x.id, max: 1, cost: function () { return x.c * 25; }, need: x.id });
  });
  var UP = {};
  UPS.forEach(function (u) { UP[u.id] = u; });
  var LV_KEYS = TELS.map(function (x) { return x.id; }).concat(UPS.map(function (u) { return u.id; })).sort();
  var START_LV = { spy: 1 };
  // Traits: one chosen from three at every new season, kept for good.
  var TRAITS = ["keen", "steady", "moon", "carto", "grinder", "early"];
  // Milestones (bits of mi).
  var MILES = ["first", "loop", "eight", "four", "million", "season", "ten"];

  // ---------- helpers ----------
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function num(v, lo, hi, d) { return isNum(v) ? Math.max(lo, Math.min(hi, v)) : d; }
  function int(v, lo, hi, d) { return isNum(v) ? Math.max(lo, Math.min(hi, Math.floor(v))) : d; }
  function obj(v) { return v && typeof v === "object" && !Array.isArray(v) ? v : null; }

  // FNV-1a, then one mulberry32 step: a number in [0, 1) from a text.
  function rand01(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    var t = (h + 0x6D2B79F5) | 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function pick(p, keys, r) {
    var acc = 0;
    for (var i = 0; i < keys.length; i++) { acc += p[keys[i]]; if (r < acc) return keys[i]; }
    return keys[keys.length - 1];
  }
  function traitN(s, id) { var n = 0; for (var i = 0; i < s.tr.length; i++) if (s.tr[i] === id) n++; return n; }

  // A name the person typed: no control characters, trimmed, at most
  // NAME_MAX characters. Shown only as text (textContent).
  function cleanName(x) {
    if (typeof x !== "string") return "";
    return x.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
  }

  // ---------- the sky ----------
  function moonPhase(t) {
    var p = ((t - NEW_MOON) / SYNODIC) % 1;
    return p < 0 ? p + 1 : p;
  }
  // The moon's factor at time t (the moon-watcher trait halves the
  // full-moon loss, again for every pick).
  function moonF(s, t) {
    var c = Math.cos(2 * Math.PI * moonPhase(t)) * MOON_AMP;
    if (c < 0) c *= Math.pow(0.5, traitN(s, "moon"));
    return 1 + c;
  }
  function blockOf(t) { return Math.floor(t / (3 * HOUR)); }
  function skyAt(seed, t) {
    return pick(SKYP, SKY, rand01(seed + "|sky|" + blockOf(t)));
  }
  // The next n hours from t: [{ t (start of the hour), sky, moon (phase) }]
  function forecast(s, t, n) {
    var h0 = Math.floor(t / HOUR) * HOUR, out = [];
    for (var k = 0; k < (n || 8); k++) {
      var a = h0 + k * HOUR;
      out.push({ t: a, sky: skyAt(s.seed, a), moon: moonPhase(a + HOUR / 2) });
    }
    return out;
  }

  // The season's field: up to STARS points on the grid, none next to
  // another (not even diagonally), each with a brightness 1-3 and a
  // kind. Seeded shuffles of the grid, the first that fits STARS stars
  // (else the fullest of FIELD_TRIES).
  var FIELD_TRIES = 12;
  var fieldCache = {};
  function place(key) {
    var pts = [];
    for (var y = 0; y < GH; y++) for (var x = 0; x < GW; x++) pts.push([x, y]);
    for (var i = pts.length - 1; i > 0; i--) {
      var j = Math.floor(rand01(key + "|sh|" + i) * (i + 1));
      var tmp = pts[i]; pts[i] = pts[j]; pts[j] = tmp;
    }
    var out = [];
    for (var k = 0; k < pts.length && out.length < STARS; k++) {
      var p = pts[k], ok = true;
      for (var m = 0; m < out.length; m++) {
        var dx = out[m][0] - p[0], dy = out[m][1] - p[1];
        if (dx * dx + dy * dy < 3) { ok = false; break; }
      }
      if (ok) out.push(p);
    }
    return out;
  }
  function field(seed, sn) {
    var key = seed + "|" + sn;
    if (fieldCache[key]) return fieldCache[key];
    var best = null;
    for (var a = 0; a < FIELD_TRIES; a++) {
      var pts = place(key + "|" + a);
      if (!best || pts.length > best.length) best = pts;
      if (best.length >= STARS) break;
    }
    best.sort(function (p, q) { return p[1] - q[1] || p[0] - q[0]; });   // reading order
    var out = best.map(function (p, n) {
      var rb = rand01(key + "|b|" + n);
      return { x: p[0], y: p[1], b: rb < 0.5 ? 1 : rb < 0.83 ? 2 : 3, k: pick(KINDP, KINDS, rand01(key + "|k|" + n)) };
    });
    var keys = Object.keys(fieldCache);
    if (keys.length > 16) delete fieldCache[keys[0]];
    fieldCache[key] = out;
    return out;
  }
  function fieldOf(s) { return field(s.seed, s.sn); }

  // ---------- lines and shapes ----------
  function reach(s) { return REACH + s.lv.comp + traitN(s, "keen"); }
  function cross(ax, ay, bx, by, cx, cy) { return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax); }
  // Do segments p1-p2 and p3-p4 meet anywhere but a shared end?
  function segsMeet(p1, p2, p3, p4) {
    var shared = (p1 === p3 || p1 === p4 || p2 === p3 || p2 === p4);
    var d1 = cross(p3.x, p3.y, p4.x, p4.y, p1.x, p1.y), d2 = cross(p3.x, p3.y, p4.x, p4.y, p2.x, p2.y);
    var d3 = cross(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y), d4 = cross(p1.x, p1.y, p2.x, p2.y, p4.x, p4.y);
    if (shared) {
      // lines from one star overlap only when they point the same way
      if (d1 === 0 && d2 === 0) {
        var o = (p1 === p3 || p1 === p4) ? p1 : p2;
        var a = o === p1 ? p2 : p1, b = (o === p3) ? p4 : p3;
        return (a.x - o.x) * (b.x - o.x) + (a.y - o.y) * (b.y - o.y) > 0;
      }
      return false;
    }
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
    function on(p, q, r) { return Math.min(p.x, q.x) <= r.x && r.x <= Math.max(p.x, q.x) && Math.min(p.y, q.y) <= r.y && r.y <= Math.max(p.y, q.y); }
    if (d1 === 0 && on(p3, p4, p1)) return true;
    if (d2 === 0 && on(p3, p4, p2)) return true;
    if (d3 === 0 && on(p1, p2, p3)) return true;
    if (d4 === 0 && on(p1, p2, p4)) return true;
    return false;
  }
  // Can a line join stars i and j, given the other lines? → "" or why not
  function lineErr(s, i, j, others) {
    var f = fieldOf(s);
    if (i === j || !f[i] || !f[j]) return "bad";
    var a = f[i], b = f[j], dx = b.x - a.x, dy = b.y - a.y, r = reach(s);
    if (dx * dx + dy * dy > r * r) return "far";
    for (var k = 0; k < f.length; k++) {
      if (k === i || k === j) continue;
      var c = f[k];
      if (cross(a.x, a.y, b.x, b.y, c.x, c.y) === 0 &&
          Math.min(a.x, b.x) <= c.x && c.x <= Math.max(a.x, b.x) &&
          Math.min(a.y, b.y) <= c.y && c.y <= Math.max(a.y, b.y)) return "through";
    }
    for (var m = 0; m < others.length; m++) {
      var l = others[m];
      if ((l[0] === i && l[1] === j) || (l[0] === j && l[1] === i)) return "dup";
      if (segsMeet(a, b, f[l[0]], f[l[1]])) return "cross";
    }
    return "";
  }
  function allLines(s, skip) {
    var out = [];
    s.cs.forEach(function (c, n) { if (n !== skip) c.l.forEach(function (l) { out.push(l); }); });
    return out;
  }
  function usedStars(s, skip) {
    var u = {};
    s.cs.forEach(function (c, n) { if (n !== skip) c.s.forEach(function (i) { u[i] = n; }); });
    return u;
  }
  function starsOfLines(l) {
    var seen = {}, out = [];
    l.forEach(function (x) { [x[0], x[1]].forEach(function (i) { if (!seen[i]) { seen[i] = 1; out.push(i); } }); });
    return out.sort(function (a, b) { return a - b; });
  }
  // The shape of lines l: chain, branch (a star with 3+ lines), loop (a
  // closed ring of 4+ stars) or both. null when it is not one piece or
  // has more than one ring.
  function shapeOf(l) {
    var st = starsOfLines(l);
    if (!l.length) return null;
    if (l.length > st.length) return null;
    var adj = {};
    st.forEach(function (i) { adj[i] = []; });
    l.forEach(function (x) { adj[x[0]].push(x[1]); adj[x[1]].push(x[0]); });
    var seen = {}, stack = [st[0]], n = 0;
    while (stack.length) {
      var v = stack.pop();
      if (seen[v]) continue;
      seen[v] = 1; n++;
      adj[v].forEach(function (w) { if (!seen[w]) stack.push(w); });
    }
    if (n !== st.length) return null;
    var branch = st.some(function (i) { return adj[i].length >= 3; });
    var loop = l.length === st.length && st.length >= 4;
    return loop && branch ? "both" : loop ? "loop" : branch ? "branch" : "chain";
  }
  // What a constellation (its lines) gives: { shape, m, blue, gold, red,
  // white (brightness sums × m), kinds (how many kinds), n (stars) }
  function worth(s, l) {
    var f = fieldOf(s), sh = shapeOf(l);
    var st = starsOfLines(l), sum = { blue: 0, gold: 0, red: 0, white: 0 }, kinds = {};
    st.forEach(function (i) { if (f[i]) { sum[f[i].k] += f[i].b; kinds[f[i].k] = 1; } });
    var m = sh ? SHAPE[sh] + 0.25 * traitN(s, "carto") : 0;
    var nk = Object.keys(kinds).length;
    if (nk === 1) m *= SAME_F;
    return { shape: sh, m: m, n: st.length, kinds: nk,
             blue: sum.blue * m, gold: sum.gold * m, red: sum.red * m, white: sum.white * m };
  }
  // Can these lines be named as a new constellation? → "" or why not
  function drawErr(s, l) {
    if (!Array.isArray(l) || !l.length) return "few";
    var st = starsOfLines(l);
    if (st.length < MIN_C) return "few";
    if (st.length > MAX_C) return "many";
    var used = usedStars(s, -1);
    for (var i = 0; i < st.length; i++) if (used[st[i]] !== undefined) return "used";
    var others = allLines(s, -1), mine = [];
    for (var k = 0; k < l.length; k++) {
      var e = lineErr(s, l[k][0], l[k][1], others.concat(mine));
      if (e) return e;
      mine.push(l[k]);
    }
    if (!shapeOf(l)) return "shape";
    return "";
  }

  // ---------- bonuses and prices ----------
  function totals(s) {
    var t = { blue: 0, gold: 0, red: 0, white: 0 };
    s.cs.forEach(function (c) {
      var w = worth(s, c.l);
      t.blue += w.blue; t.gold += w.gold; t.red += w.red; t.white += w.white;
    });
    return t;
  }
  function atlasBonus(s) {
    var b = s.ab0;
    s.ax.forEach(function (a) { b += a.b; });
    return b;
  }
  // Starlight per minute right now, before sky and moon.
  function baseRate(s, tot) {
    tot = tot || totals(s);
    var r = 0;
    TELS.forEach(function (x) { r += s.lv[x.id] * x.r * (s.lv["m" + x.id] ? 2 : 1); });
    return r * (1 + 0.25 * s.lv.dark) * (1 + BLUE_F * tot.blue) * (1 + atlasBonus(s));
  }
  function telCost(s, id, tot) {
    tot = tot || totals(s);
    var x = TEL[id];
    return x.c * Math.pow(x.f, s.lv[id]) * Math.max(GOLD_MIN, 1 - GOLD_F * tot.gold) * Math.pow(0.9, traitN(s, "grinder"));
  }
  function lineCount(s) { var n = 0; s.cs.forEach(function (c) { n += c.l.length; }); return n; }
  // The price of the next k lines (the lines already drawn this season
  // make each one dearer; red stars make them cheaper).
  function linesCost(s, k, tot) {
    tot = tot || totals(s);
    var f = Math.max(RED_MIN, 1 - RED_F * tot.red) * Math.pow(0.85, traitN(s, "steady"));
    var L = lineCount(s), c = 0;
    for (var i = 0; i < k; i++) c += LINE_C * Math.pow(LINE_G, L + i);
    return c * f;
  }
  function upInfo(s, id) {
    var tot = totals(s);
    if (TEL[id]) {
      var c = telCost(s, id, tot), done = s.lv[id] >= TEL_MAX;
      return { id: id, tel: true, lv: s.lv[id], max: TEL_MAX, c: c, done: done, need: true, ok: !done && s.sl >= c };
    }
    var u = UP[id], lvl = s.lv[id], d = lvl >= u.max, cc = d ? 0 : u.cost(lvl), need = !u.need || s.lv[u.need] > 0;
    return { id: id, tel: false, lv: lvl, max: u.max, c: cc, done: d, need: need, ok: !d && need && s.sl >= cc };
  }

  // ---------- time ----------
  // Gather starlight from s.at to t, at the weight w (1 or 0.5).
  // Stepped at every hour and every 3-hour cloud block. → out filled
  function gather(s, t, w, out) {
    var base = baseRate(s);
    while (s.at < t) {
      var next = Math.min(t, (Math.floor(s.at / HOUR) + 1) * HOUR);
      var dt = next - s.at, sky = skyAt(s.seed, s.at), mid = s.at + dt / 2;
      var g = base * (dt / MIN) * SKYF[sky] * moonF(s, mid) * w;
      s.sl += g; s.life += g;
      if (out) { out.sl += g; out.sky[sky] = (out.sky[sky] || 0) + dt; }
      s.hc[SKY.indexOf(sky)] += dt / HOUR;
      s.at = next;
    }
  }
  function emptyOut() { return { sl: 0, sky: {}, dt: 0, slowed: false, moons: 0 }; }
  // Step the sky by ms, in full (no away rule). → what happened
  function advance(s, ms) {
    var out = emptyOut();
    if (!isNum(ms) || ms <= 0) return out;
    gather(s, s.at + ms, 1, out);
    out.dt = ms;
    miles(s);
    return out;
  }
  // Bring the sky to the wall clock now: the first 7 days in full, the
  // rest at half (at most 400 days). A clock that went back moves at to
  // now and counts nothing.
  function catchUp(s, now) {
    var out = emptyOut();
    var dt = now - s.at;
    if (!isNum(dt) || dt <= 0) { if (isNum(now)) s.at = now; return out; }
    var from = s.at;
    if (dt > MAX_MS) { s.at = now - MAX_MS; }
    var fullTo = Math.min(now, from + FULL_MS);
    if (s.at < fullTo) gather(s, fullTo, 1, out);
    if (s.at < now) gather(s, now, 0.5, out);
    out.dt = dt;
    out.slowed = dt > FULL_MS;
    out.moons = Math.floor((now - NEW_MOON) / SYNODIC) - Math.floor((from - NEW_MOON) / SYNODIC);
    miles(s);
    return out;
  }

  // ---------- milestones ----------
  function bit(s, id) { return (s.mi >> MILES.indexOf(id)) & 1; }
  function setBit(s, id) { s.mi |= 1 << MILES.indexOf(id); }
  function miles(s) {
    if (s.life >= 1e6) setBit(s, "million");
    if (s.sn >= 1) setBit(s, "season");
    if (s.sn >= 10) setBit(s, "ten");
    s.cs.forEach(function (c) {
      var w = worth(s, c.l);
      setBit(s, "first");
      if (w.shape === "loop" || w.shape === "both") setBit(s, "loop");
      if (w.n >= MAX_C) setBit(s, "eight");
      if (w.kinds >= 4) setBit(s, "four");
    });
  }

  // ---------- the new season ----------
  function canSeason(s) { return s.cs.length >= SEASON_N && s.lv[SEASON_TEL] >= 1; }
  function offer(s) {
    var out = [], k = 0;
    while (out.length < 3 && k < 50) {
      var t = TRAITS[Math.floor(rand01(s.seed + "|t|" + s.sn + "|" + k) * TRAITS.length)];
      if (out.indexOf(t) < 0) out.push(t);
      k++;
    }
    for (var i = 0; out.length < 3 && i < TRAITS.length; i++) if (out.indexOf(TRAITS[i]) < 0) out.push(TRAITS[i]);
    return out;
  }
  function freshLv(s) {
    var lv = {};
    LV_KEYS.forEach(function (k) { lv[k] = START_LV[k] || 0; });
    if (s) lv.refr = 2 * traitN(s, "early");
    return lv;
  }
  // Every constellation of the season goes into the atlas; each gives
  // +1% for good, and its white stars more.
  function season(s, tr) {
    var f = fieldOf(s);
    s.cs.forEach(function (c) {
      var w = worth(s, c.l), idx = c.s;
      var p = [], l = [];
      idx.forEach(function (i) { p.push(f[i].x, f[i].y); });
      c.l.forEach(function (x) { l.push(idx.indexOf(x[0]), idx.indexOf(x[1])); });
      s.ax.push({ n: c.n, k: c.k, p: p, l: l, b: Math.round((ATLAS_F + WHITE_F * w.white) * 1e6) / 1e6 });
    });
    while (s.ax.length > AX_MAX) s.ab0 += s.ax.shift().b;
    s.sn++;
    s.tr.push(tr);
    s.cs = [];
    s.lv = freshLv(s);
    s.sl = 20 + s.sl * 0.1;
    miles(s);
  }

  // ---------- actions ----------
  // act(s, {t: "buy", u} | {t: "draw", l, n} | {t: "erase", c} |
  //        {t: "rename", c, n} | {t: "season", tr}) → "" or an error code
  function act(s, a) {
    a = obj(a);
    if (!a) return "bad";
    if (a.t === "buy") {
      if (!TEL[a.u] && !UP[a.u]) return "bad";
      var inf = upInfo(s, a.u);
      if (inf.done) return "max";
      if (!inf.need) return "need";
      if (s.sl < inf.c) return "sl";
      s.sl -= inf.c;
      s.lv[a.u]++;
      s.acts++;
      return "";
    }
    if (a.t === "draw") {
      var l = normLines(a.l);
      if (!l) return "bad";
      var e = drawErr(s, l);
      if (e) return e;
      var c = linesCost(s, l.length);
      if (s.sl < c) return "sl";
      s.sl -= c;
      s.cs.push({ s: starsOfLines(l), l: l, n: cleanName(a.n), k: nameIdx(s) });
      s.acts++;
      miles(s);
      return "";
    }
    if (a.t === "erase") {
      if (!isNum(a.c) || !s.cs[a.c]) return "bad";
      s.cs.splice(a.c, 1);
      s.acts++;
      return "";
    }
    if (a.t === "rename") {
      if (!isNum(a.c) || !s.cs[a.c]) return "bad";
      s.cs[a.c].n = cleanName(a.n);
      s.acts++;
      return "";
    }
    if (a.t === "season") {
      if (!canSeason(s)) return "noseason";
      if (offer(s).indexOf(a.tr) < 0) return "bad";
      season(s, a.tr);
      s.acts++;
      return "";
    }
    return "bad";
  }
  // The seeded name of the next constellation (an index into each
  // language's list), different from the season's names when it can be.
  function nameIdx(s) {
    var taken = {};
    s.cs.forEach(function (c) { taken[c.k] = 1; });
    for (var k = 0; k < 40; k++) {
      var i = Math.floor(rand01(s.seed + "|nm|" + s.sn + "|" + s.cs.length + "|" + k) * NAMES);
      if (!taken[i]) return i;
    }
    return Math.floor(rand01(s.seed + "|nm|" + s.sn + "|" + s.cs.length) * NAMES);
  }
  // [[i, j]] with i < j, sorted, no repeats; null when not lines.
  function normLines(x) {
    if (!Array.isArray(x) || x.length > 40) return null;
    var out = [], seen = {};
    for (var k = 0; k < x.length; k++) {
      var l = x[k];
      if (!Array.isArray(l) || l.length !== 2) return null;
      var a = l[0], b = l[1];
      if (!isNum(a) || !isNum(b) || a !== Math.floor(a) || b !== Math.floor(b) || a < 0 || b < 0 || a >= STARS || b >= STARS || a === b) return null;
      var p = a < b ? [a, b] : [b, a], key = p[0] + "-" + p[1];
      if (seen[key]) return null;
      seen[key] = 1;
      out.push(p);
    }
    return out.sort(function (p, q) { return p[0] - q[0] || p[1] - q[1]; });
  }

  // ---------- new game, normalize, merge ----------
  function newGame(seed, now, br) {
    return normalize({
      v: V, seed: String(seed || "stars"), br: isNum(br) ? br : 0, at: isNum(now) ? now : 0,
      life: 0, sl: 25, lv: freshLv(null), cs: [], acts: 0, sn: 0, tr: [], ax: [], ab0: 0, mi: 0, hc: [0, 0, 0]
    });
  }
  // A clean copy with every field checked, keys in one order (R26);
  // null when it is not a star chart. Constellations that break a rule
  // (a crossing, a used star) are dropped, in order.
  function normalize(x) {
    x = obj(x);
    if (!x || x.v !== V || !obj(x.lv)) return null;
    var s = {
      v: V, seed: typeof x.seed === "string" && x.seed ? x.seed.slice(0, 32) : "stars",
      br: num(x.br, 0, 1e15, 0), at: num(x.at, 0, 1e15, 0),
      life: num(x.life, 0, 1e30, 0), sl: num(x.sl, 0, 1e30, 0), lv: {}, cs: [],
      acts: int(x.acts, 0, 1e9, 0), sn: int(x.sn, 0, 1e6, 0), tr: [], ax: [],
      ab0: num(x.ab0, 0, 1e6, 0), mi: int(x.mi, 0, (1 << MILES.length) - 1, 0), hc: [0, 0, 0]
    };
    LV_KEYS.forEach(function (k) {
      var max = TEL[k] ? TEL_MAX : UP[k].max;
      s.lv[k] = int(x.lv[k], START_LV[k] || 0, max, START_LV[k] || 0);
    });
    (Array.isArray(x.tr) ? x.tr : []).forEach(function (t) {
      if (TRAITS.indexOf(t) >= 0 && s.tr.length < 1e4) s.tr.push(t);
    });
    if (Array.isArray(x.hc)) for (var h = 0; h < 3; h++) s.hc[h] = num(x.hc[h], 0, 1e9, 0);
    (Array.isArray(x.cs) ? x.cs : []).forEach(function (c) {
      c = obj(c);
      if (!c || s.cs.length >= STARS) return;
      var l = normLines(c.l);
      if (!l || drawErr(s, l)) return;
      s.cs.push({ s: starsOfLines(l), l: l, n: cleanName(c.n), k: int(c.k, 0, NAMES - 1, 0) });
    });
    (Array.isArray(x.ax) ? x.ax : []).forEach(function (a) {
      a = obj(a);
      if (!a || !Array.isArray(a.p) || !Array.isArray(a.l)) return;
      var np = a.p.length / 2;
      if (np < MIN_C || np > MAX_C || a.p.length % 2 || a.l.length % 2 || a.l.length > 2 * MAX_C) return;
      var okP = a.p.every(function (v, i) { return isNum(v) && v === Math.floor(v) && v >= 0 && v < (i % 2 ? GH : GW); });
      var okL = a.l.every(function (v) { return isNum(v) && v === Math.floor(v) && v >= 0 && v < np; });
      if (!okP || !okL) return;
      s.ax.push({ n: cleanName(a.n), k: int(a.k, 0, NAMES - 1, 0), p: a.p.slice(), l: a.l.slice(), b: num(a.b, 0, 1, 0) });
    });
    while (s.ax.length > AX_MAX) s.ab0 += s.ax.shift().b;
    return s;
  }
  function better(a, b) {   // > 0 when a wins
    if (a.br !== b.br) return a.br - b.br;
    if (a.life !== b.life) return a.life - b.life;
    if (a.at !== b.at) return a.at - b.at;
    var ja = JSON.stringify(a), jb = JSON.stringify(b);
    return ja < jb ? -1 : (ja > jb ? 1 : 0);
  }
  function merge(a, b) {
    var na = normalize(a), nb = normalize(b);
    if (!na) return nb;
    if (!nb) return na;
    return better(na, nb) >= 0 ? na : nb;
  }
  function clone(s) { return JSON.parse(JSON.stringify(s)); }
  // Rates now, for the status line: starlight per minute with this
  // hour's sky and moon.
  function rates(s, t) {
    var tot = totals(s), base = baseRate(s, tot), sky = skyAt(s.seed, t), mf = moonF(s, t);
    return { base: base, now: base * SKYF[sky] * mf, sky: sky, moon: moonPhase(t), mf: mf, tot: tot };
  }

  var api = {
    V: V, MIN: MIN, HOUR: HOUR, FULL_MS: FULL_MS, MAX_MS: MAX_MS, GW: GW, GH: GH, STARS: STARS,
    MIN_C: MIN_C, MAX_C: MAX_C, REACH: REACH, SEASON_N: SEASON_N, AX_MAX: AX_MAX, NAME_MAX: NAME_MAX, NAMES: NAMES,
    SYNODIC: SYNODIC, NEW_MOON: NEW_MOON, SKY: SKY, SKYF: SKYF, KINDS: KINDS, SHAPE: SHAPE, SAME_F: SAME_F,
    BLUE_F: BLUE_F, GOLD_F: GOLD_F, RED_F: RED_F, WHITE_F: WHITE_F, ATLAS_F: ATLAS_F,
    TELS: TELS, TEL: TEL, UPS: UPS, UP: UP, TRAITS: TRAITS, MILES: MILES,
    moonPhase: moonPhase, moonF: moonF, skyAt: skyAt, forecast: forecast, field: field, fieldOf: fieldOf,
    reach: reach, lineErr: lineErr, allLines: allLines, usedStars: usedStars, starsOfLines: starsOfLines,
    shapeOf: shapeOf, worth: worth, drawErr: drawErr, totals: totals, atlasBonus: atlasBonus,
    baseRate: baseRate, telCost: telCost, lineCount: lineCount, linesCost: linesCost, upInfo: upInfo,
    advance: advance, catchUp: catchUp, rates: rates, bit: bit, canSeason: canSeason, offer: offer,
    traitN: traitN, act: act, cleanName: cleanName, normLines: normLines,
    newGame: newGame, normalize: normalize, merge: merge, clone: clone, rand01: rand01
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.StarChartEngine = api;
})(typeof window !== "undefined" ? window : this);
