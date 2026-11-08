// ============================================================
// orOS Wayfarers — rules engine (v1.0.0)
// NOT the UI: no DOM, no storage. Loaded by wayfarers/index.html
// (window.WayfarersEngine, after wayfarers/data.js) and by
// tests/wayfarers.test.js (module.exports).
//
// A turn-based party RPG: three heroes of six classes walk a branching
// path map; fights are turn by turn, in Speed order, and every foe
// shows its next move. Original rules, numbers and names (plan:
// /mnt/project-files/games/strategy/wayfarers-plan.md, Bible Part IX
// "Wayfarers").
//
// State (plain JSON, kept as is in the device-local session):
//   { v: 1, seed, diff "g" Gentle | "h" Hardy | "e" Endless (5.74.00: Hardy rules, the road
//     goes on after the Frost Gate), region 1… (Endless: up to MAX_REGION),
//     end (optional: last region, 5.71.00),
//     party: [{ c class, hp, up: [upgrade ids], w weapon | "", ch charm | "", tr trained }] × 3,
//     lvl 1-10, xp, gold, inv: { p, t, f }, bag: [gear ids],
//     map: [{ c column 0-7, r row, k kind, e: [next node indexes] }],
//     at node index, path: [node indexes walked], seen: [event ids],
//     pend: [{ k: "up", h, o: [2 upgrade ids] } | { k: "loot", o: [gear ids] } |
//            { k: "camp" } | { k: "mk", s: [{ g gear or item id, p price, n sold }] } |
//            { k: "ev", id } | { k: "tale", n region just reached (2…) }],
//     fight: null | { kind f|h|g|e, re: event gold, foes: [foe], hs: [{ fo, st }] × 3,
//                     q: [unit refs left this round], cur: unit ref, round, nid, rz: 1 Raise used },
//     rng (uint32), acts, stops, kills, over: -1 playing | 0 fallen | 1 won }
//   foe = { id, k, hp, mh, st, t move count, ph phase, n: { m move, tg hero index | -1 },
//           lv (optional, 5.74.00: the Endless loop, 1… = stronger) }
//   unit refs: "h0"-"h2" heroes, "f<id>" foes.
//   st (statuses, whole numbers): bu Burn turns, bd Burn damage, ch Chill
//   turns, sn Stun turns, mk Mark turns, gu Guarding, hi Hidden, hb Hide
//   bonus, pb/pv Power song turns/value, sb/sv Speed song turns/value,
//   ta Taunting, cv Covering hero index + 1, sh Shell (foes), rv/rp rally
//   turns/Power (foes).
//
// Rules (also in wayfarers/help.en.txt):
//   - Damage = Power × the skill's factor − the target's Guard, at least
//     1; Guarding halves it. No dice and no misses. Marked targets take
//     1.5 × (from the Rogue 2 ×), Storm hits Wet or Chilled foes 2 ×.
//   - Turn order: Speed, highest first; on a tie heroes before foes,
//     then by place. A new round reads the Speeds again.
//   - A hero gets 1 Focus at the start of each of its turns (2 to start
//     a fight); Guard gives 1 more.
//   - Every foe shows its next move and target before it acts.
// ============================================================
(function (root) {
  "use strict";

  var D = root.WayfarersData || (typeof require === "function" ? require("./data.js") : null);
  var CLASSES = D.CLASSES, CLASS_IDS = D.CLASS_IDS, SKILLS = D.SKILLS, UPS = D.UPS, STAT_UPS = D.STAT_UPS;
  var GEAR = D.GEAR, ITEMS = D.ITEMS, MOVES = D.MOVES, FOES = D.FOES, REGIONS = D.REGIONS, EVENTS = D.EVENTS;

  var DIFFS = ["g", "h", "e"];
  var MAX_REGION = 999;               // Endless: the road never ends, the state stops here
  var COLS = 8;                       // 0 start, 1-6 the road, 7 the guardian
  var LEVELS = [0, 10, 25, 45, 70, 100, 135, 175, 220, 270];
  var MAX_LVL = LEVELS.length;
  var START_FO = 2;
  var GENTLE_HP = 1.2;                // Gentle: 20 % more Health
  var BAG_MAX = 8;
  var MAX_FOES = 5;
  var XP = { t1: 10, t2: 14, h: 24, g: 40 };
  var KINDS = ["s", "f", "h", "c", "m", "e", "g"];
  var GEAR_IDS = Object.keys(GEAR);
  var UP_IDS = Object.keys(UPS);
  var EVENT_IDS = EVENTS.map(function (e) { return e.id; });

  // ---------- Random numbers (no Math.random, no clock) ----------
  function hashStr(s) {
    var h = 0x811c9dc5;
    s = String(s);
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }
  // xorshift32 on an object { s }
  function rnd(o) {
    var x = o.s >>> 0 || 0x9e3779b9;
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    o.s = x;
    return x / 4294967296;
  }
  function rint(o, n) { return Math.floor(rnd(o) * n); }
  function pick(o, list) { return list[rint(o, list.length)]; }
  function shuffle(o, list) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = rint(o, i + 1), x = a[i];
      a[i] = a[j]; a[j] = x;
    }
    return a;
  }
  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function clone(st) { return JSON.parse(JSON.stringify(st)); }
  // the state's own generator: { s } on st.rng
  function withRng(st, fn) {
    var o = { s: st.rng };
    var r = fn(o);
    st.rng = o.s >>> 0;
    return r;
  }

  // ---------- The path map ----------
  // Columns 1-6 hold 2 or 3 stops; edges only go to the next column and
  // never cross; every stop can be reached and leads on.
  function makeMap(seed, region) {
    var o = { s: hashStr(seed + ":map:" + region) };
    var sizes = [1];
    for (var c = 1; c < COLS - 1; c++) sizes.push(2 + rint(o, 2));
    sizes.push(1);
    var nodes = [], first = [];
    for (c = 0; c < COLS; c++) {
      first.push(nodes.length);
      for (var r = 0; r < sizes[c]; r++) nodes.push({ c: c, r: r, k: "f", e: [] });
    }
    for (c = 0; c < COLS - 1; c++) {
      var a = sizes[c], b = sizes[c + 1], base = [];
      for (var i = 0; i < a; i++) base.push(a === 1 ? -1 : Math.round(i * (b - 1) / (a - 1)));
      var tg = [];
      for (i = 0; i < a; i++) {
        var set = [];
        if (a === 1) { for (var j = 0; j < b; j++) set.push(j); }
        else {
          set.push(base[i]);
          // a second road up or down, never crossing a neighbour's road
          if (base[i] + 1 < b && (i === a - 1 || base[i + 1] >= base[i] + 1) && rnd(o) < 0.45) set.push(base[i] + 1);
          else if (base[i] - 1 >= 0 && (i === 0 || maxOf(tg[i - 1]) <= base[i] - 1) && rnd(o) < 0.3) set.unshift(base[i] - 1);
        }
        tg.push(set);
      }
      // every stop of the next column gets a road in
      for (j = 0; j < b; j++) {
        var has = false;
        for (i = 0; i < a; i++) if (tg[i].indexOf(j) >= 0) has = true;
        if (has) continue;
        var from = 0;
        for (i = 0; i < a; i++) if (maxOf(tg[i]) < j) from = i;
        tg[from].push(j);
        tg[from].sort(function (x, y) { return x - y; });
      }
      for (i = 0; i < a; i++) nodes[first[c] + i].e = tg[i].map(function (x) { return first[c + 1] + x; });
    }
    // kinds
    nodes[0].k = "s";
    nodes[nodes.length - 1].k = "g";
    var mid = [];
    nodes.forEach(function (n, k) {
      if (n.c === 1) n.k = "f";
      else if (n.c === COLS - 2) n.k = "c";
      else if (n.c >= 2 && n.c <= COLS - 3) {
        var w = [["f", 4], ["e", 3], ["m", n.c >= 3 ? 1.2 : 0.6], ["h", n.c >= 3 ? 1.5 : 0], ["c", n.c === 3 || n.c === 4 ? 1 : 0]];
        var sum = 0, x;
        w.forEach(function (p) { sum += p[1]; });
        x = rnd(o) * sum;
        for (var q = 0; q < w.length; q++) { x -= w[q][1]; if (x < 0) { n.k = w[q][0]; break; } }
        mid.push(k);
      }
    });
    // two markets never share a column; at least one market and one hard fight
    var seenMk = {};
    mid.forEach(function (k) {
      if (nodes[k].k !== "m") return;
      if (seenMk[nodes[k].c]) nodes[k].k = "f";
      seenMk[nodes[k].c] = 1;
    });
    function count(kind) { return mid.filter(function (k) { return nodes[k].k === kind; }).length; }
    if (!count("m")) nodes[pick(o, mid)].k = "m";
    if (!count("h")) {
      var hs = mid.filter(function (k) { return nodes[k].c >= 3 && nodes[k].k !== "m"; });
      if (hs.length) nodes[pick(o, hs)].k = "h";
    }
    return nodes;
  }
  function maxOf(a) { return a && a.length ? a[a.length - 1] : -1; }

  // ---------- Heroes ----------
  function hasUp(h, id) { return h.up.indexOf(id) >= 0; }
  function upCount(h, id) { return h.up.filter(function (x) { return x === id; }).length; }
  // Most Health, Power, Guard, Speed, most Focus and start Focus of party hero i.
  function heroStats(st, i) {
    var h = st.party[i], C = CLASSES[h.c];
    var w = h.w ? GEAR[h.w] : {}, ch = h.ch ? GEAR[h.ch] : {};
    var lv = st.lvl - 1;
    var mh = C.hp + 3 * lv + 6 * upCount(h, "hp") + (w.hp || 0) + (ch.hp || 0);
    if (st.diff === "g") mh = Math.round(mh * GENTLE_HP);
    return {
      mh: mh,
      pw: C.pw + Math.floor(lv / 2) + upCount(h, "pw") + h.tr + (w.pw || 0) + (ch.pw || 0),
      gd: C.gd + upCount(h, "gd") + (w.gd || 0) + (ch.gd || 0),
      sp: C.sp + upCount(h, "sp") + (w.sp || 0) + (ch.sp || 0),
      fo: C.fo + upCount(h, "fo"),
      sf: START_FO + (w.sf || 0) + (ch.sf || 0)
    };
  }
  // Endless loops: +25 % Power and +1 Guard a loop (Health in newFoe).
  function foeStats(f) {
    var F = FOES[f.k], lv = f.lv || 0;
    return { pw: Math.round(F.pw * (1 + 0.25 * lv)) + (f.ph >= 2 && F.ph[1].pw ? F.ph[1].pw : 0) + (f.st.rv > 0 ? f.st.rp : 0), gd: F.gd + lv, sp: F.sp };
  }
  function standing(st, i) { return st.party[i].hp > 0; }
  // Endless: region n walks the land of region ((n − 1) mod 3) + 1, one
  // loop stronger every three regions.
  function regionOf(n) { return REGIONS[(n - 1) % REGIONS.length]; }
  function loopOf(n) { return Math.floor((n - 1) / REGIONS.length); }
  function lastRegion(st) { return st.diff === "e" ? MAX_REGION : (st.end || REGIONS.length); }

  // end (optional, 5.71.00): the last region of a short journey (the
  // Daily trial walks only the Greenway: end 1).
  function newJourney(seed, diff, classes, end) {
    seed = String(seed);
    if (DIFFS.indexOf(diff) < 0) diff = "g";
    var st = {
      v: 1, seed: seed, diff: diff, region: 1,
      party: classes.map(function (c) { return { c: c, hp: 1, up: [], w: "", ch: "", tr: 0 }; }),
      lvl: 1, xp: 0, gold: 20, inv: { p: 2, t: 0, f: 0 }, bag: [],
      map: makeMap(seed, 1), at: 0, path: [0], seen: [], pend: [], fight: null,
      rng: hashStr(seed + ":play") || 1, acts: 0, stops: 0, kills: 0, over: -1
    };
    if (diff === "g") st.inv.f = 1;
    if (diff !== "e" && isInt(end) && end >= 1 && end < REGIONS.length) st.end = end;
    for (var i = 0; i < 3; i++) st.party[i].hp = heroStats(st, i).mh;
    return st;
  }
  // Three classes from a code (the Daily trial's party): front row
  // first, then in class order.
  function dailyParty(seed) {
    var o = { s: hashStr(String(seed) + ":party") || 1 };
    return shuffle(o, CLASS_IDS.slice()).slice(0, 3).sort(function (a, b) {
      return (CLASSES[a].row === "f" ? 0 : 1) - (CLASSES[b].row === "f" ? 0 : 1) || CLASS_IDS.indexOf(a) - CLASS_IDS.indexOf(b);
    });
  }
  function partyOk(classes) {
    if (!Array.isArray(classes) || classes.length !== 3) return false;
    for (var i = 0; i < 3; i++) {
      if (CLASS_IDS.indexOf(classes[i]) < 0 || classes.indexOf(classes[i]) !== i) return false;
    }
    return true;
  }

  // ---------- Fights ----------
  function ref(kind, n) { return kind + n; }
  function foeById(fi, id) {
    for (var k = 0; k < fi.foes.length; k++) if (fi.foes[k].id === id) return fi.foes[k];
    return null;
  }
  function unit(st, r) {
    if (r.charAt(0) === "h") return { h: +r.slice(1) };
    return { f: foeById(st.fight, +r.slice(1)) };
  }
  function alive(st, r) {
    var u = unit(st, r);
    return u.f ? !!u.f && u.f.hp > 0 : standing(st, u.h);
  }
  function stOf(st, r) {
    var u = unit(st, r);
    return u.f ? u.f.st : st.fight.hs[u.h].st;
  }
  function speedOf(st, r) {
    var u = unit(st, r), s = stOf(st, r), v;
    v = u.f ? foeStats(u.f).sp : heroStats(st, u.h).sp;
    if (s.sb > 0) v += s.sv;
    if (s.ch > 0) v -= 3;
    return v;
  }
  // Every living unit, fastest first; heroes before foes on a tie.
  function order(st) {
    var fi = st.fight, list = [];
    for (var i = 0; i < 3; i++) if (standing(st, i)) list.push({ r: ref("h", i), s: speedOf(st, ref("h", i)), k: i });
    fi.foes.forEach(function (f, k) { if (f.hp > 0) list.push({ r: ref("f", f.id), s: speedOf(st, ref("f", f.id)), k: 10 + k }); });
    list.sort(function (a, b) { return (b.s - a.s) || (a.k - b.k); });
    return list.map(function (x) { return x.r; });
  }
  // The turn order shown on screen: who is left this round, then the next round.
  function queueView(st) {
    var fi = st.fight;
    if (!fi) return [];
    var now = [fi.cur].concat(fi.q).filter(function (r) { return r && alive(st, r); });
    return { now: now, next: order(st) };
  }

  // lv: the Endless loop (0 = none): +60 % Health a loop.
  function newFoe(fi, k, lv) {
    var F = FOES[k], hp = lv ? Math.round(F.hp * (1 + 0.6 * lv)) : F.hp;
    var f = { id: fi.nid++, k: k, hp: hp, mh: hp, st: {}, t: 0, ph: 0, n: null };
    if (lv) f.lv = lv;
    return f;
  }
  function cycOf(f) {
    var F = FOES[f.k];
    return f.ph > 0 ? F.ph[f.ph - 1].cyc : F.cyc;
  }
  function wet(f) { return !!FOES[f.k].wet; }
  // Target for a move that hits one hero: the taunting Knight, else by the move's rule.
  function pickTarget(st, rule) {
    var fi = st.fight, best = -1;
    for (var i = 0; i < 3; i++) {
      if (standing(st, i) && fi.hs[i].st.ta) return i;
    }
    var cand = [];
    for (i = 0; i < 3; i++) if (standing(st, i) && !fi.hs[i].st.hi) cand.push(i);
    if (!cand.length) return -1;
    if (rule === "front" || rule === "back") {
      var row = rule === "front" ? "f" : "b";
      var inRow = cand.filter(function (k) { return CLASSES[st.party[k].c].row === row; });
      if (inRow.length) cand = inRow;
    }
    cand.forEach(function (k) {
      if (best < 0 || st.party[k].hp < st.party[best].hp) best = k;
    });
    return best;
  }
  function mostHurtFoe(fi) {
    var best = null;
    fi.foes.forEach(function (f) {
      if (f.hp <= 0 || f.hp * 4 >= f.mh * 3) return;
      if (!best || f.hp / f.mh < best.hp / best.mh) best = f;
    });
    return best;
  }
  // A foe's next move: its cycle; a heal with nobody hurt turns into a hit.
  function chooseIntent(st, f) {
    var cyc = cycOf(f), m = cyc[f.t % cyc.length], M = MOVES[m];
    if (M.k === "heal" && !mostHurtFoe(st.fight)) { m = "hit"; M = MOVES.hit; }
    f.n = { m: m, tg: M.k === "hit" ? pickTarget(st, M.tg) : -1 };
  }
  function retargetAll(st) {
    st.fight.foes.forEach(function (f) {
      if (f.hp > 0 && f.n && MOVES[f.n.m].k === "hit") f.n.tg = pickTarget(st, MOVES[f.n.m].tg);
    });
  }

  function startFight(st, kind, group, re) {
    var fi = { kind: kind, re: re || 0, foes: [], hs: [], q: [], cur: "", round: 0, nid: 1, rz: 0 };
    st.fight = fi;
    group.forEach(function (k) { fi.foes.push(newFoe(fi, k, loopOf(st.region))); });
    for (var i = 0; i < 3; i++) fi.hs.push({ fo: Math.min(heroStats(st, i).sf, heroStats(st, i).fo), st: {} });
    fi.foes.forEach(function (f) { chooseIntent(st, f); });
    var ev = [{ e: "fight", kind: kind }];
    nextTurn(st, ev);
    return ev;
  }
  function groupFor(st, kind, col) {
    var G = regionOf(st.region).groups;
    var list = kind === "g" ? G.g : kind === "h" ? G.h : (kind === "f" && col <= 2) ? G.t1 : G.t2;
    return withRng(st, function (o) { return pick(o, list).slice(); });
  }

  // Damage from unit a to unit b; f = factor; opt: { pierce, storm, hits }.
  function damage(st, a, b, f, opt, ev) {
    var fi = st.fight, ua = unit(st, a), ub = unit(st, b), sa = stOf(st, a);
    opt = opt || {};
    // Cover: a hit on a covered hero lands on the Knight
    if (ub.h !== undefined && !opt.all) {
      for (var k = 0; k < 3; k++) {
        if (k !== ub.h && standing(st, k) && fi.hs[k].st.cv === ub.h + 1) { b = ref("h", k); ub = { h: k }; ev.push({ e: "cover", d: b }); break; }
      }
    }
    opt.to = ub.h !== undefined ? ub.h : -1;   // the hero it landed on (after Cover)
    var sb = stOf(st, b);
    var pw = ua.f ? foeStats(ua.f).pw : heroStats(st, ua.h).pw + (sa.pb > 0 ? sa.pv : 0);
    var gd = ub.f ? foeStats(ub.f).gd : heroStats(st, ub.h).gd;
    var n = Math.round(pw * f), combo = "";
    if (ua.h !== undefined && ub.f) {
      var rogue = st.party[ua.h].c === "rogue";
      if (rogue && (sb.mk > 0 || sb.sn > 0)) { n = Math.round(n * (hasUp(st.party[ua.h], "backUp") ? 2.5 : 2)); combo = "back"; }
      else if (sb.mk > 0) { n = Math.round(n * 1.5); combo = "mark"; }
      if (opt.storm && (wet(ub.f) || sb.ch > 0)) { n = Math.round(n * opt.storm); combo = "storm"; }
      if (sa.hb) { n = Math.round(n * 1.5); sa.hb = 0; }
    }
    if (!opt.pierce) n -= gd;
    if (sb.gu || sb.sh) n = Math.floor(n / 2);
    if (n < 1) n = 1;
    applyHurt(st, b, n, ev, { e: "hit", s: a, d: b, n: n, c: combo });
    return n;
  }
  function applyHurt(st, b, n, ev, e) {
    var ub = unit(st, b);
    if (ub.f) {
      ub.f.hp = Math.max(0, ub.f.hp - n);
      ev.push(e);
      if (ub.f.hp === 0) { st.kills++; ub.f.st = {}; ev.push({ e: "fall", d: b }); }
      else phaseCheck(st, ub.f, ev);
    } else {
      var h = st.party[ub.h];
      h.hp = Math.max(0, h.hp - n);
      ev.push(e);
      if (h.hp === 0) { st.fight.hs[ub.h].st = {}; ev.push({ e: "fall", d: b }); retargetAll(st); }
    }
  }
  function phaseCheck(st, f, ev) {
    var F = FOES[f.k];
    if (!F.ph) return;
    for (var p = F.ph.length; p > f.ph; p--) {
      if (f.hp <= Math.floor(f.mh * F.ph[p - 1].at)) {
        f.ph = p;
        f.t = 0;
        ev.push({ e: "phase", d: ref("f", f.id), p: p });
        var sum = F.ph[p - 1].sum || [];
        sum.forEach(function (k) {
          var livingFoes = st.fight.foes.filter(function (x) { return x.hp > 0; }).length;
          if (livingFoes >= MAX_FOES) return;
          var nf = newFoe(st.fight, k, f.lv || 0);
          st.fight.foes.push(nf);
          chooseIntent(st, nf);
          ev.push({ e: "summon", d: ref("f", nf.id) });
        });
        chooseIntent(st, f);
        return;
      }
    }
  }
  function heal(st, i, n, ev) {
    var mh = heroStats(st, i).mh, h = st.party[i];
    var got = Math.min(n, mh - h.hp);
    h.hp += got;
    ev.push({ e: "heal", d: ref("h", i), n: got });
  }
  function foesLeft(st) { return st.fight.foes.some(function (f) { return f.hp > 0; }); }
  function heroesLeft(st) { return standing(st, 0) || standing(st, 1) || standing(st, 2); }

  // End of a unit's own turn: its timed statuses tick down.
  function endTurn(s) {
    ["mk", "ch", "pb", "sb", "rv"].forEach(function (k) {
      if (s[k] > 0) {
        s[k]--;
        if (!s[k]) { if (k === "pb") s.pv = 0; if (k === "sb") s.sv = 0; if (k === "rv") s.rp = 0; }
      }
    });
  }
  // Runs turns until a hero is to act or the fight is over.
  function nextTurn(st, ev) {
    var fi = st.fight, guard = 0;
    while (guard++ < 500) {
      if (!foesLeft(st)) { winFight(st, ev); return; }
      if (!heroesLeft(st)) { st.over = 0; st.fight.cur = ""; ev.push({ e: "lose" }); return; }
      if (!fi.q.length) {
        fi.round++;
        fi.q = order(st);
        ev.push({ e: "round", n: fi.round });
      }
      var r = fi.q.shift();
      if (!alive(st, r)) continue;
      fi.cur = r;
      var u = unit(st, r), s = stOf(st, r);
      s.gu = 0; s.hi = 0; s.ta = 0; s.cv = 0; s.sh = 0;
      if (s.bu > 0) {
        s.bu--;
        var bd = s.bd || 1;
        if (!s.bu) s.bd = 0;
        applyHurt(st, r, bd, ev, { e: "burn", d: r, n: bd });
        if (!alive(st, r)) continue;
      }
      if (s.sn > 0) {
        s.sn--;
        ev.push({ e: "stun", d: r });
        endTurn(s);
        if (u.f) { u.f.t++; chooseIntent(st, u.f); }
        continue;
      }
      if (u.h !== undefined) {
        var hs = fi.hs[u.h];
        hs.fo = Math.min(heroStats(st, u.h).fo, hs.fo + 1);
        ev.push({ e: "turn", d: r });
        return;
      }
      foeAct(st, u.f, ev);
      endTurn(u.f.st);
      if (u.f.hp > 0) { u.f.t++; chooseIntent(st, u.f); }
    }
  }
  function foeAct(st, f, ev) {
    var fi = st.fight, M = MOVES[f.n.m], r = ref("f", f.id);
    if (M.k === "hit") {
      var tg = f.n.tg;
      var taunt = fi.hs.some(function (x, k) { return x.st.ta && standing(st, k); });
      if (taunt || tg < 0 || !standing(st, tg) || fi.hs[tg].st.hi) tg = pickTarget(st, M.tg);
      if (tg < 0) { ev.push({ e: "wait", s: r }); return; }
      var o1 = { pierce: M.pierce };
      damage(st, r, ref("h", tg), M.f, o1, ev);
      foeStatus(st, f, M, o1.to, ev);
    } else if (M.k === "all") {
      ev.push({ e: "sweep", s: r });
      for (var i = 0; i < 3; i++) {
        if (standing(st, i) && !fi.hs[i].st.hi) {
          var o2 = { all: 1, pierce: M.pierce };
          damage(st, r, ref("h", i), M.f, o2, ev);
          foeStatus(st, f, M, o2.to, ev);
        }
        if (!heroesLeft(st)) return;
      }
    } else if (M.k === "heal") {
      var w = mostHurtFoe(fi);
      if (w) {
        var got = Math.min(M.n, w.mh - w.hp);
        w.hp += got;
        ev.push({ e: "heal", s: r, d: ref("f", w.id), n: got });
      }
    } else if (M.k === "shell") {
      f.st.sh = 1;
      ev.push({ e: "shell", d: r });
    } else if (M.k === "rally") {
      fi.foes.forEach(function (x) {
        if (x.hp <= 0) return;
        x.st.rv = 2; x.st.rp = M.n;
      });
      ev.push({ e: "rally", s: r, n: M.n });
    }
  }

  // Burn and Chill from a foe's move on the hero it hit (hit = hero index or -1).
  function foeStatus(st, f, M, hit, ev) {
    if (hit < 0 || !standing(st, hit)) return;
    var hs = st.fight.hs[hit].st, d = ref("h", hit);
    if (M.burn) { hs.bu = M.burn; hs.bd = Math.max(1, Math.ceil(foeStats(f).pw / 2)); ev.push({ e: "status", d: d, s: "bu" }); }
    if (M.chill) { hs.ch = Math.max(hs.ch || 0, M.chill); ev.push({ e: "status", d: d, s: "ch" }); }
  }
  function winFight(st, ev) {
    var fi = st.fight, kind = fi.kind, col = st.map[st.at].c;
    var tier = kind === "g" ? "g" : kind === "h" ? "h" : (kind === "f" && col <= 2) ? "t1" : "t2";
    var rk = 1 + 0.5 * Math.min(st.region - 1, 8);   // later regions pay more
    var gold = Math.round(withRng(st, function (o) {
      return tier === "g" ? 40 : tier === "h" ? 20 + rint(o, 9) : tier === "t1" ? 8 + rint(o, 5) : 12 + rint(o, 5);
    }) * rk) + fi.re;
    var xp = Math.round(XP[tier] * rk);
    st.gold += gold;
    ev.push({ e: "win", gold: gold, xp: xp });
    if (st.diff === "g") {
      for (var i = 0; i < 3; i++) {
        if (!standing(st, i)) { st.party[i].hp = Math.max(1, Math.round(heroStats(st, i).mh / 4)); ev.push({ e: "stand", d: ref("h", i) }); }
      }
    }
    st.fight = null;
    if (kind === "g" && st.region >= lastRegion(st)) {
      gainXp(st, xp, ev);
      st.pend = [];
      st.over = 1;
      ev.push({ e: "won" });
      return;
    }
    if (kind === "h" || kind === "g") {
      // spoils: hard fights tier 2 (3 and 4 in later regions), guardians tier 3 (then 4)
      var tierG = Math.min(4, (kind === "g" ? 3 : 2) + Math.min(st.region, 3) - 1);
      var o2 = withRng(st, function (o) {
        var pool = shuffle(o, GEAR_IDS.filter(function (g) { return GEAR[g].t === tierG || GEAR[g].t === tierG - 1; }));
        var a = pool[0], b = pool.filter(function (g) { return GEAR[g].s !== GEAR[a].s; })[0] || pool[1];
        return [a, b];
      });
      st.pend.push({ k: "loot", o: o2 });
    }
    gainXp(st, xp, ev);
    if (kind === "g") nextRegion(st, ev);
  }
  // A guardian fell and the road goes on: a new map, and a rest on the way.
  function nextRegion(st, ev) {
    st.region++;
    st.map = makeMap(st.seed, st.region);
    st.at = 0;
    st.path = [0];
    for (var i = 0; i < 3; i++) {
      var mh = heroStats(st, i).mh;
      st.party[i].hp = standing(st, i) ? Math.min(mh, st.party[i].hp + Math.round(mh / 2)) : Math.max(1, Math.round(mh / 4));
    }
    ev.push({ e: "region", n: st.region });
    st.pend.push({ k: "tale", n: st.region });
  }
  function gainXp(st, n, ev) {
    st.xp += n;
    while (st.lvl < MAX_LVL && st.xp >= LEVELS[st.lvl]) {
      st.lvl++;
      ev.push({ e: "lvl", n: st.lvl });
      for (var i = 0; i < 3; i++) {
        // more Health with the level, kept as gained
        st.party[i].hp = st.party[i].hp > 0 ? Math.min(heroStats(st, i).mh, st.party[i].hp + 3) : 0;
        if (st.over < 0) st.pend.push({ k: "up", h: i, o: upChoices(st, i) });
      }
    }
  }
  // Two choices: a skill upgrade not yet taken (when one is left) and a stat.
  function upChoices(st, i) {
    var h = st.party[i];
    return withRng(st, function (o) {
      var skill = shuffle(o, UP_IDS.filter(function (u) { return UPS[u].c === h.c && !hasUp(h, u); }));
      var stat = shuffle(o, STAT_UPS);
      if (skill.length && rnd(o) < 0.75) return [skill[0], stat[0]];
      return [stat[0], stat[1]];
    });
  }

  // ---------- Stops on the map ----------
  function reach(st) {
    if (st.over >= 0 || st.fight || st.pend.length) return [];
    return st.map[st.at].e.slice();
  }
  function arrive(st, n, ev) {
    st.at = n;
    st.path.push(n);
    st.stops++;
    var node = st.map[n];
    ev.push({ e: "stop", k: node.k });
    if (node.k === "f" || node.k === "h" || node.k === "g") {
      startFight(st, node.k, groupFor(st, node.k, node.c)).forEach(function (x) { ev.push(x); });
    } else if (node.k === "c") {
      for (var i = 0; i < 3; i++) {
        if (!standing(st, i)) { st.party[i].hp = 1; ev.push({ e: "stand", d: ref("h", i) }); }
      }
      st.pend.push({ k: "camp" });
    } else if (node.k === "m") {
      st.pend.push({ k: "mk", s: stock(st, node.c) });
    } else if (node.k === "e") {
      var id = withRng(st, function (o) {
        var ri = (st.region - 1) % REGIONS.length + 1;
        var here = EVENTS.filter(function (x) { return !x.r || x.r === ri; }).map(function (x) { return x.id; });
        var left = here.filter(function (x) { return st.seen.indexOf(x) < 0; });
        return pick(o, left.length ? left : here);
      });
      if (st.seen.indexOf(id) < 0) st.seen.push(id);
      st.pend.push({ k: "ev", id: id });
    }
  }
  function stock(st, col) {
    return withRng(st, function (o) {
      var maxT = col >= 4 || st.region > 1 ? 3 : 2;   // tier 4 is never sold
      var g = shuffle(o, GEAR_IDS.filter(function (x) { return GEAR[x].t <= maxT; })).slice(0, 3);
      var s = g.map(function (x) { return { g: x, p: GEAR[x].price, n: 0 }; });
      ["p", "t", "f"].forEach(function (x) { s.push({ g: x, p: ITEMS[x].price, n: 0 }); });
      return s;
    });
  }
  function eventOf(id) {
    for (var i = 0; i < EVENTS.length; i++) if (EVENTS[i].id === id) return EVENTS[i];
    return null;
  }
  function choiceOk(st, o) {
    if (o.cost && st.gold < o.cost) return false;
    if (o.k === "item" && st.inv[o.id] >= ITEMS[o.id].most) return false;
    if (o.k === "gear" && st.bag.length >= BAG_MAX) return false;
    return true;
  }
  function hurtAll(st, n, ev) {
    for (var i = 0; i < 3; i++) {
      if (!standing(st, i)) continue;
      var got = Math.min(n, st.party[i].hp - 1);
      st.party[i].hp -= got;
      ev.push({ e: "hurt", d: ref("h", i), n: got });
    }
  }
  function healAllPct(st, pct, ev) {
    for (var i = 0; i < 3; i++) if (standing(st, i)) heal(st, i, Math.round(heroStats(st, i).mh * pct / 100), ev);
  }

  // ---------- Actions ----------
  // a: map   { t: "go", n }
  //    fight { t: "atk", x foe id } | { t: "sk", s skill, x foe id or hero index }
  //          | { t: "guard" } | { t: "item", i: p|t|f, x hero index }
  //    stops { t: "up", o: 0|1 } | { t: "loot", o: 0|1|-1 } | { t: "rest" } | { t: "train", h }
  //          | { t: "buy", i } | { t: "leave" } | { t: "ev", o } | { t: "on" } (a tale read)
  //    any time out of a fight: { t: "equip", h, b bag index } | { t: "unequip", h, s: w|c }
  //          | { t: "use", i: p|f, h }
  // Returns the events, or null when the action is not allowed (nothing changes).
  function act(st, a) {
    if (!a || typeof a !== "object" || st.over >= 0) return null;
    var ev = [];
    var ok = st.fight ? fightAct(st, a, ev) : (st.pend.length ? pendAct(st, a, ev) : mapAct(st, a, ev));
    if (!ok && !st.fight && (a.t === "equip" || a.t === "unequip" || a.t === "use")) ok = gearAct(st, a, ev);
    if (!ok) return null;
    st.acts++;
    return ev;
  }
  function mapAct(st, a, ev) {
    if (a.t !== "go") return false;
    if (reach(st).indexOf(a.n) < 0) return false;
    arrive(st, a.n, ev);
    return true;
  }
  function pendAct(st, a, ev) {
    var p = st.pend[0];
    if (p.k === "up" && a.t === "up" && (a.o === 0 || a.o === 1)) {
      var u = p.o[a.o], h = st.party[p.h], before = heroStats(st, p.h).mh;
      h.up.push(u);
      if (h.hp > 0) h.hp = Math.min(heroStats(st, p.h).mh, h.hp + Math.max(0, heroStats(st, p.h).mh - before));
      ev.push({ e: "up", d: ref("h", p.h), u: u });
      st.pend.shift();
      return true;
    }
    if (p.k === "loot" && a.t === "loot" && (a.o === 0 || a.o === 1 || a.o === -1)) {
      if (a.o >= 0) {
        if (st.bag.length >= BAG_MAX) return false;
        st.bag.push(p.o[a.o]);
        ev.push({ e: "gear", g: p.o[a.o] });
      }
      st.pend.shift();
      return true;
    }
    if (p.k === "camp" && (a.t === "rest" || a.t === "train")) {
      if (a.t === "rest") healAllPct(st, 50, ev);
      else {
        if (!isInt(a.h) || a.h < 0 || a.h > 2) return false;
        st.party[a.h].tr++;
        ev.push({ e: "train", d: ref("h", a.h) });
      }
      st.pend.shift();
      return true;
    }
    if (p.k === "mk" && a.t === "buy") {
      var s = p.s[a.i];
      if (!s || st.gold < s.p) return false;
      if (GEAR[s.g]) {
        if (s.n || st.bag.length >= BAG_MAX) return false;
        st.bag.push(s.g);
        s.n = 1;
      } else {
        if (st.inv[s.g] >= ITEMS[s.g].most) return false;
        st.inv[s.g]++;
        s.n++;
      }
      st.gold -= s.p;
      ev.push({ e: "buy", g: s.g });
      return true;
    }
    if (p.k === "mk" && a.t === "leave") { st.pend.shift(); return true; }
    if (p.k === "tale" && a.t === "on") { st.pend.shift(); return true; }
    if (p.k === "ev" && a.t === "ev") {
      var E = eventOf(p.id), o = E && E.o[a.o];
      if (!o || !choiceOk(st, o)) return false;
      st.pend.shift();
      if (o.cost) st.gold -= o.cost;
      if (o.hurt) hurtAll(st, o.hurt, ev);
      if (o.k === "heal") healAllPct(st, o.n, ev);
      else if (o.k === "gold") { st.gold += o.n; ev.push({ e: "goldUp", n: o.n }); }
      else if (o.k === "xp") { ev.push({ e: "xp", n: o.n }); gainXp(st, o.n, ev); }
      else if (o.k === "item") { st.inv[o.id]++; ev.push({ e: "item", i: o.id }); }
      else if (o.k === "mhp") {
        for (var i = 0; i < 3; i++) { st.party[i].up.push("hp"); if (standing(st, i)) st.party[i].hp += st.diff === "g" ? Math.round(6 * GENTLE_HP) : 6; }
        ev.push({ e: "mhp" });
      } else if (o.k === "gear") {
        var g = withRng(st, function (r) { return pick(r, GEAR_IDS.filter(function (x) { return GEAR[x].t === o.n; })); });
        st.bag.push(g);
        ev.push({ e: "gear", g: g });
      } else if (o.k === "fight") {
        startFight(st, "e", groupFor(st, "e", st.map[st.at].c), o.n).forEach(function (x) { ev.push(x); });
      }
      return true;
    }
    return false;
  }
  function gearAct(st, a, ev) {
    if (!isInt(a.h) || a.h < 0 || a.h > 2) return false;
    var h = st.party[a.h];
    if (a.t === "use") {
      if ((a.i !== "p" && a.i !== "f") || !(st.inv[a.i] > 0)) return false;
      if (a.i === "p") {
        if (!standing(st, a.h) || h.hp >= heroStats(st, a.h).mh) return false;
        st.inv.p--;
        heal(st, a.h, Math.round(heroStats(st, a.h).mh * 0.4), ev);
      } else {
        if (standing(st, a.h)) return false;
        st.inv.f--;
        h.hp = Math.round(heroStats(st, a.h).mh / 2);
        ev.push({ e: "stand", d: ref("h", a.h) });
      }
      return true;
    }
    if (a.t === "equip") {
      var g = st.bag[a.b];
      if (!isInt(a.b) || !g) return false;
      var slot = GEAR[g].s === "w" ? "w" : "ch";
      st.bag.splice(a.b, 1);
      if (h[slot]) st.bag.push(h[slot]);
      h[slot] = g;
    } else if (a.t === "unequip") {
      var sl = a.s === "w" ? "w" : a.s === "c" ? "ch" : "";
      if (!sl || !h[sl] || st.bag.length >= BAG_MAX) return false;
      st.bag.push(h[sl]);
      h[sl] = "";
    } else return false;
    if (h.hp > 0) h.hp = Math.min(h.hp, heroStats(st, a.h).mh);
    ev.push({ e: "equip", d: ref("h", a.h) });
    return true;
  }

  // What hero i may aim skill s (or "atk") at: foe ids or hero indexes.
  function targets(st, i, s) {
    var fi = st.fight;
    if (!fi) return [];
    var tg = s === "atk" ? "foe" : SKILLS[s].tg;
    var foes = fi.foes.filter(function (f) { return f.hp > 0; }).map(function (f) { return f.id; });
    var out = [];
    if (tg === "foe") return foes;
    if (tg === "foes" || tg === "self" || tg === "party") return [-1];
    for (var k = 0; k < 3; k++) {
      if (tg === "ally" && standing(st, k)) out.push(k);
      if (tg === "other" && k !== i && standing(st, k)) out.push(k);
      if (tg === "fallen" && !standing(st, k) && !fi.rz) out.push(k);
    }
    return out;
  }
  // Can hero i use skill s now (Focus, a target, the class)?
  function usable(st, i, s) {
    var fi = st.fight;
    if (!fi || fi.cur !== ref("h", i)) return false;
    if (s === "atk" || s === "guard") return true;
    var S = SKILLS[s];
    if (!S || S.c !== st.party[i].c || fi.hs[i].fo < S.cost) return false;
    return targets(st, i, s).length > 0;
  }
  function fightAct(st, a, ev) {
    var fi = st.fight;
    if (!fi.cur || fi.cur.charAt(0) !== "h") return false;
    var i = +fi.cur.slice(1), me = fi.cur, hs = fi.hs[i], h = st.party[i];
    if (a.t === "atk") {
      var f = foeById(fi, a.x);
      if (!f || f.hp <= 0) return false;
      ev.push({ e: "act", s: me, k: "atk" });
      damage(st, me, ref("f", f.id), 1.0, {}, ev);
    } else if (a.t === "guard") {
      hs.st.gu = 1;
      hs.fo = Math.min(heroStats(st, i).fo, hs.fo + 1);
      ev.push({ e: "act", s: me, k: "guard" });
    } else if (a.t === "item") {
      if (["p", "t", "f"].indexOf(a.i) < 0 || !(st.inv[a.i] > 0) || !isInt(a.x) || a.x < 0 || a.x > 2) return false;
      if (a.i === "f" ? standing(st, a.x) : !standing(st, a.x)) return false;
      st.inv[a.i]--;
      ev.push({ e: "act", s: me, k: "item", i: a.i });
      if (a.i === "p") heal(st, a.x, Math.round(heroStats(st, a.x).mh * 0.4), ev);
      else if (a.i === "t") { fi.hs[a.x].fo = Math.min(heroStats(st, a.x).fo, fi.hs[a.x].fo + 3); ev.push({ e: "focus", d: ref("h", a.x), n: 3 }); }
      else { st.party[a.x].hp = Math.round(heroStats(st, a.x).mh / 2); fi.hs[a.x].st = {}; ev.push({ e: "stand", d: ref("h", a.x) }); }
    } else if (a.t === "sk") {
      if (!usable(st, i, a.s)) return false;
      var S = SKILLS[a.s], tgs = targets(st, i, a.s);
      if (S.tg !== "foes" && S.tg !== "self" && S.tg !== "party" && tgs.indexOf(a.x) < 0) return false;
      hs.fo -= S.cost;
      ev.push({ e: "act", s: me, k: a.s });
      skill(st, i, a.s, a.x, ev);
    } else return false;
    endTurn(hs.st);
    fi.cur = "";
    nextTurn(st, ev);
    return true;
  }
  function skill(st, i, s, x, ev) {
    var fi = st.fight, h = st.party[i], me = ref("h", i), S = SKILLS[s];
    var up = hasUp(h, s + "Up"), f, fs, k;
    if (S.tg === "foe") {
      f = foeById(fi, x);
      var fr = ref("f", f.id);
      var hits = S.hits ? (s === "twin" && up ? 3 : S.hits) : 1;
      var fac = S.f * (s === "bash" && up ? 1.5 : 1) * (s === "pierce" && up ? 4 / 3 : 1);
      for (k = 0; k < hits && f.hp > 0; k++) {
        damage(st, me, fr, fac, { pierce: S.pierce, storm: S.storm ? (up ? 2.5 : S.storm) : 0 }, ev);
      }
      if (f.hp > 0) {
        fs = f.st;
        if (S.stun) { fs.sn = S.stun; ev.push({ e: "status", d: fr, s: "sn" }); }
        if (S.mark) { fs.mk = S.mark + (up ? 1 : 0); ev.push({ e: "status", d: fr, s: "mk" }); }
        if (S.burn) { fs.bu = S.burn + (up ? 1 : 0); fs.bd = Math.max(1, Math.ceil(heroStats(st, i).pw / 2)); ev.push({ e: "status", d: fr, s: "bu" }); }
        if (S.chill) { fs.ch = S.chill + (up ? 1 : 0); ev.push({ e: "status", d: fr, s: "ch" }); }
      }
    } else if (S.tg === "foes") {
      fi.foes.slice().forEach(function (g) {
        if (g.hp > 0) damage(st, me, ref("f", g.id), S.f * (up ? 1 / 0.7 : 1), {}, ev);
      });
    } else if (s === "cover") {
      fi.hs[i].st.cv = x + 1;
      if (up) fi.hs[i].st.gu = 1;
      ev.push({ e: "status", d: ref("h", x), s: "cv" });
    } else if (s === "taunt") {
      fi.hs[i].st.ta = 1;
      ev.push({ e: "status", d: me, s: "ta" });
      if (up) heal(st, i, 8, ev);
      retargetAll(st);
    } else if (s === "hide") {
      fi.hs[i].st.hi = 1;
      fi.hs[i].st.hb = 1;
      if (up) fi.hs[i].fo = Math.min(heroStats(st, i).fo, fi.hs[i].fo + 2);
      ev.push({ e: "status", d: me, s: "hi" });
      retargetAll(st);
    } else if (s === "heal") {
      heal(st, x, heroStats(st, i).pw * 2 + 4 + (up ? 6 : 0), ev);
    } else if (s === "cleanse") {
      var cs = fi.hs[x].st;
      cs.bu = 0; cs.bd = 0; cs.sn = 0; cs.ch = 0;
      heal(st, x, up ? 10 : 4, ev);
    } else if (s === "raise") {
      fi.rz = 1;
      st.party[x].hp = Math.max(1, Math.round(heroStats(st, x).mh * (up ? 0.6 : 0.3)));
      fi.hs[x].st = {};
      ev.push({ e: "stand", d: ref("h", x) });
    } else if (s === "anthem" || s === "tempo") {
      for (k = 0; k < 3; k++) {
        if (!standing(st, k)) continue;
        var ks = fi.hs[k].st;
        if (s === "anthem") { ks.pb = 2 + (k === i ? 1 : 0); ks.pv = up ? 3 : 2; }
        else {
          ks.sb = 2 + (k === i ? 1 : 0); ks.sv = 3;
          if (up) fi.hs[k].fo = Math.min(heroStats(st, k).fo, fi.hs[k].fo + 1);
        }
      }
      ev.push({ e: "song", s: me, k: s });
    } else if (s === "gift") {
      var n = up ? 5 : 3;
      fi.hs[x].fo = Math.min(heroStats(st, x).fo, fi.hs[x].fo + n);
      ev.push({ e: "focus", d: ref("h", x), n: n });
    }
  }

  // ---------- Checks ----------
  function okSt(s) {
    if (!s || typeof s !== "object" || Array.isArray(s)) return false;
    var keys = Object.keys(s);
    for (var k = 0; k < keys.length; k++) {
      if (["bu", "bd", "ch", "sn", "mk", "gu", "hi", "hb", "pb", "pv", "sb", "sv", "ta", "cv", "sh", "rv", "rp"].indexOf(keys[k]) < 0) return false;
      if (!isInt(s[keys[k]]) || s[keys[k]] < 0 || s[keys[k]] > 99) return false;
    }
    return true;
  }
  function valid(st) {
    if (!st || typeof st !== "object" || st.v !== 1 || typeof st.seed !== "string" || DIFFS.indexOf(st.diff) < 0) return false;
    if (!isInt(st.region) || st.region < 1 || st.region > (st.diff === "e" ? MAX_REGION : REGIONS.length)) return false;
    if (st.end !== undefined && (st.diff === "e" || !isInt(st.end) || st.end < 1 || st.end >= REGIONS.length || st.region > st.end)) return false;
    if (!Array.isArray(st.party) || !partyOk(st.party.map(function (h) { return h && h.c; }))) return false;
    if (!isInt(st.lvl) || st.lvl < 1 || st.lvl > MAX_LVL || !isInt(st.xp) || st.xp < 0 || !isInt(st.gold) || st.gold < 0) return false;
    for (var i = 0; i < 3; i++) {
      var h = st.party[i];
      if (!Array.isArray(h.up) || !h.up.every(function (u) { return UPS[u] && (!UPS[u].c || UPS[u].c === h.c); })) return false;
      if ((h.w && (!GEAR[h.w] || GEAR[h.w].s !== "w")) || (h.ch && (!GEAR[h.ch] || GEAR[h.ch].s !== "c")) || typeof h.w !== "string" || typeof h.ch !== "string") return false;
      if (!isInt(h.tr) || h.tr < 0 || h.tr > 50) return false;
      if (!isInt(h.hp) || h.hp < 0 || h.hp > heroStats(st, i).mh) return false;
    }
    var inv = st.inv;
    if (!inv || ["p", "t", "f"].some(function (k) { return !isInt(inv[k]) || inv[k] < 0 || inv[k] > ITEMS[k].most; })) return false;
    if (!Array.isArray(st.bag) || st.bag.length > BAG_MAX || !st.bag.every(function (g) { return !!GEAR[g]; })) return false;
    if (!Array.isArray(st.map) || st.map.length < 2) return false;
    var n = st.map.length;
    if (!st.map.every(function (m) {
      return m && isInt(m.c) && m.c >= 0 && m.c < COLS && isInt(m.r) && KINDS.indexOf(m.k) >= 0 && Array.isArray(m.e) &&
        m.e.every(function (x) { return isInt(x) && x >= 0 && x < n && st.map[x] && st.map[x].c === m.c + 1; });
    })) return false;
    if (!isInt(st.at) || st.at < 0 || st.at >= n || !Array.isArray(st.path) || st.path[st.path.length - 1] !== st.at) return false;
    if (!Array.isArray(st.seen) || !st.seen.every(function (x) { return EVENT_IDS.indexOf(x) >= 0; })) return false;
    if (!isInt(st.rng) || !isInt(st.acts) || st.acts < 0 || !isInt(st.stops) || !isInt(st.kills) || [-1, 0, 1].indexOf(st.over) < 0) return false;
    if (!Array.isArray(st.pend) || !st.pend.every(function (p) {
      if (!p || typeof p !== "object") return false;
      if (p.k === "up") return isInt(p.h) && p.h >= 0 && p.h < 3 && Array.isArray(p.o) && p.o.length === 2 && p.o.every(function (u) { return UPS[u] && (!UPS[u].c || UPS[u].c === st.party[p.h].c); });
      if (p.k === "loot") return Array.isArray(p.o) && p.o.length === 2 && p.o.every(function (g) { return !!GEAR[g]; });
      if (p.k === "camp") return true;
      if (p.k === "mk") return Array.isArray(p.s) && p.s.every(function (s) { return s && (GEAR[s.g] || ITEMS[s.g]) && isInt(s.p) && s.p > 0 && isInt(s.n) && s.n >= 0; });
      if (p.k === "ev") return !!eventOf(p.id);
      if (p.k === "tale") return isInt(p.n) && p.n >= 2 && p.n === st.region;
      return false;
    })) return false;
    var fi = st.fight;
    if (fi !== null) {
      if (!fi || typeof fi !== "object" || ["f", "h", "g", "e"].indexOf(fi.kind) < 0 || !isInt(fi.re) || !isInt(fi.round) || !isInt(fi.nid) || (fi.rz !== 0 && fi.rz !== 1)) return false;
      if (!Array.isArray(fi.foes) || !fi.foes.every(function (f) {
        return f && FOES[f.k] && isInt(f.id) && f.id < fi.nid && isInt(f.hp) && isInt(f.mh) && f.hp >= 0 && f.hp <= f.mh && okSt(f.st) &&
          isInt(f.t) && f.t >= 0 && isInt(f.ph) && f.ph >= 0 && f.ph <= (FOES[f.k].ph ? FOES[f.k].ph.length : 0) &&
          (f.lv === undefined || (isInt(f.lv) && f.lv >= 1 && f.lv <= loopOf(MAX_REGION))) &&
          (f.n === null || (f.n && MOVES[f.n.m] && isInt(f.n.tg) && f.n.tg >= -1 && f.n.tg < 3));
      })) return false;
      if (!Array.isArray(fi.hs) || fi.hs.length !== 3 || !fi.hs.every(function (x, k) { return x && isInt(x.fo) && x.fo >= 0 && x.fo <= heroStats(st, k).fo && okSt(x.st); })) return false;
      var okRef = function (r) { return typeof r === "string" && (/^h[0-2]$/.test(r) || (/^f\d{1,3}$/.test(r) && !!foeById(fi, +r.slice(1)))); };
      if (!Array.isArray(fi.q) || !fi.q.every(okRef)) return false;
      if (st.over < 0 && !(typeof fi.cur === "string" && /^h[0-2]$/.test(fi.cur) && standing(st, +fi.cur.slice(1)))) return false;
    }
    return true;
  }

  var api = {
    DIFFS: DIFFS, MAX_REGION: MAX_REGION, COLS: COLS, LEVELS: LEVELS, MAX_LVL: MAX_LVL, BAG_MAX: BAG_MAX,
    CLASSES: CLASSES, CLASS_IDS: CLASS_IDS, SKILLS: SKILLS, UPS: UPS, GEAR: GEAR, ITEMS: ITEMS,
    MOVES: MOVES, FOES: FOES, REGIONS: REGIONS, EVENTS: EVENTS,
    hashStr: hashStr, regionOf: regionOf, loopOf: loopOf, makeMap: makeMap, newJourney: newJourney, dailyParty: dailyParty, partyOk: partyOk, heroStats: heroStats, foeStats: foeStats,
    queueView: queueView, reach: reach, targets: targets, usable: usable, eventOf: eventOf, choiceOk: choiceOk,
    speedOf: speedOf, act: act, valid: valid, clone: clone
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WayfarersEngine = api;
})(typeof window !== "undefined" ? window : this);
