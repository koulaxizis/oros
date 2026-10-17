// ============================================================
// orOS Score Keeper — .orosscores file (scores/package.js,
// window.OrosScoresPackage). The descriptor of Score Keeper for the
// record apps' kit (../recordpkg.js, docs/oros-bundle.md "Record
// apps"): every match, round, saved template and remembered player
// in one orOS bundle; opening one ADDS what this device lacks, with
// its ids. Pure (no DOM, no storage), so the app and `node --test`
// run the same code.
//   DESC                     the kit descriptor (no merge: the kit's
//                            plain insert; scores.js then runs the
//                            result through mergeScores + commit, so
//                            sync carries it)
//   DESC.norm(data)          a file's data → { ver, matches, rounds,
//                            tpls, players } with the app's own shape
//                            checks (scores.js normMatch … normPlayer,
//                            the same rules; a test keeps them equal)
//   DESC.strip(state)        the slice → the same without tombs
//   DESC.tombIds(state)      the ids in state.tombs
//   DESC.previews(state, l)  history.csv (the app's "Export CSV" of
//                            finished matches, byte for byte) and
//                            rounds.csv (every round of every match)
//   kindOf(id, state)        "match" | "round" | "tpl" | "player" | ""
// ============================================================
(function (root) {
  "use strict";

  // The limits and patterns of scores.js (section 2)
  var MIN_SEATS = 2, MAX_SEATS = 8, NAME_LEN = 40, SEAT_LEN = 24, MAX_SCORE = 1000000, MAX_QUICK = 4;
  var MAX_MATCHES = 1000, MAX_ROUNDS = 500, MAX_TPLS = 40, MAX_PLAYERS = 200, NCOLORS = 8;
  var ID_RE = /^[a-z0-9]{6,40}$/;
  var TPL_RE = /^[a-z0-9]{0,40}$/;
  var READY_IDS = ["tavli", "prefa", "xeri", "biriba", "poker", "free"];
  var LISTS = ["matches", "rounds", "tpls", "players"];

  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function normText(s, max) {
    return typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "";
  }
  function normScore(v) { return isInt(v) && Math.abs(v) <= MAX_SCORE ? v : 0; }
  function normQuick(list) {
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (v) {
      if (isInt(v) && v !== 0 && Math.abs(v) <= 1000 && out.indexOf(v) < 0 && out.length < MAX_QUICK) out.push(v);
    });
    return out;
  }
  function normTarget(v) { return isInt(v) && v > 0 && v <= MAX_SCORE ? v : 0; }
  function base(x) {
    return isObj(x) && typeof x.id === "string" && ID_RE.test(x.id) && isInt(x.m) && x.m >= 0;
  }

  function normMatch(x) {
    if (!base(x)) return null;
    var name = normText(x.name, NAME_LEN);
    if (!name || !Array.isArray(x.seats)) return null;
    var seats = x.seats.slice(0, MAX_SEATS).map(function (s) { return normText(s, SEAT_LEN); });
    if (seats.length < MIN_SEATS || seats.some(function (s) { return !s; })) return null;
    return {
      id: x.id, m: x.m, c: isInt(x.c) && x.c >= 0 ? x.c : x.m, name: name,
      tpl: typeof x.tpl === "string" && TPL_RE.test(x.tpl) ? x.tpl : "",
      seats: seats, target: normTarget(x.target), low: x.low === 1 ? 1 : 0,
      quick: normQuick(x.quick), done: isInt(x.done) && x.done > 0 ? x.done : 0
    };
  }
  function normRound(x) {
    if (!base(x) || typeof x.g !== "string" || !ID_RE.test(x.g) || !Array.isArray(x.s) ||
        x.s.length < 1 || x.s.length > MAX_SEATS) return null;
    return { id: x.id, m: x.m, g: x.g, c: isInt(x.c) && x.c >= 0 ? x.c : x.m, s: x.s.map(normScore) };
  }
  function normTpl(x) {
    if (!base(x)) return null;
    var name = normText(x.name, NAME_LEN);
    if (!name) return null;
    var seats = isInt(x.seats) ? Math.max(MIN_SEATS, Math.min(MAX_SEATS, x.seats)) : MIN_SEATS;
    return {
      id: x.id, m: x.m, name: name, target: normTarget(x.target), low: x.low === 1 ? 1 : 0,
      quick: normQuick(x.quick), seats: seats,
      base: typeof x.base === "string" && READY_IDS.indexOf(x.base) >= 0 ? x.base : ""
    };
  }
  function normPlayer(x) {
    if (!base(x)) return null;
    var name = normText(x.name, SEAT_LEN);
    if (!name) return null;
    return { id: x.id, m: x.m, name: name, col: isInt(x.col) && x.col >= 0 && x.col < NCOLORS ? x.col : 0 };
  }
  var NORM = { matches: normMatch, rounds: normRound, tpls: normTpl, players: normPlayer };

  // A file's data → the slice shape, capped like the app (matches,
  // rounds per match, templates, players). Tombs pass through so
  // strip and tombIds see them; the kit then drops them.
  function norm(data) {
    if (!isObj(data)) return null;
    var out = { ver: 1, matches: [], rounds: [], tpls: [], players: [] };
    if (isObj(data.tombs)) {
      out.tombs = {};
      Object.keys(data.tombs).forEach(function (id) { if (ID_RE.test(id)) out.tombs[id] = 1; });
    }
    var cap = { matches: MAX_MATCHES, rounds: MAX_MATCHES * MAX_ROUNDS, tpls: MAX_TPLS, players: MAX_PLAYERS };
    var perMatch = {};
    LISTS.forEach(function (key) {
      var list = Array.isArray(data[key]) ? data[key] : [];
      for (var i = 0; i < list.length && out[key].length < cap[key]; i++) {
        var x = NORM[key](list[i]);
        if (!x) continue;
        if (key === "rounds") {
          perMatch[x.g] = (perMatch[x.g] || 0) + 1;
          if (perMatch[x.g] > MAX_ROUNDS) continue;
        }
        out[key].push(x);
      }
    });
    return out;
  }
  function strip(state) {
    var s = isObj(state) ? state : {}, out = { ver: 1 };
    LISTS.forEach(function (k) { out[k] = Array.isArray(s[k]) ? s[k] : []; });
    return JSON.parse(JSON.stringify(out));
  }
  function tombIds(state) {
    return isObj(state) && isObj(state.tombs) ? Object.keys(state.tombs) : [];
  }

  // ---------- previews ----------
  // The CSV of scores.js (section 4): every text cell quoted; text
  // starting with = + - @ tab or CR gets a leading apostrophe (no
  // formula injection); numbers raw; a BOM so Excel reads UTF-8.
  var CSV = {
    en: { date: "Date", game: "Game", player: "Player", total: "Total", winner: "Winner", round: "Round",
          points: "Points", yes: "yes", no: "no", finished: "Finished" },
    el: { date: "Ημερομηνία", game: "Παιχνίδι", player: "Παίκτης", total: "Σύνολο", winner: "Νικητής", round: "Γύρος",
          points: "Πόντοι", yes: "ναι", no: "όχι", finished: "Τελείωσε" }
  };
  if (typeof window !== "undefined" && window.orosI18n) window.orosI18n.table(CSV, "scores");
  function csvCell(v) {
    if (typeof v === "number") return String(v);
    var s = String(v == null ? "" : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }
  function csvLines(rows) {
    return "﻿" + rows.map(function (r) { return r.map(csvCell).join(","); }).join("\r\n") + "\r\n";
  }
  function fmtDate(ms) {
    var d = new Date(ms);
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return p(d.getDate()) + "/" + p(d.getMonth() + 1) + "/" + d.getFullYear();
  }
  function roundsOf(d, gid) {
    return d.rounds.filter(function (r) { return r.g === gid; })
      .sort(function (x, y) { return x.c - y.c || cmpStr(x.id, y.id); });
  }
  function standing(match, rounds) {
    var tot = match.seats.map(function () { return 0; });
    rounds.forEach(function (r) {
      for (var i = 0; i < tot.length; i++) tot[i] += (i < r.s.length ? r.s[i] : 0);
    });
    var bestVal = match.low ? Math.min.apply(null, tot) : Math.max.apply(null, tot);
    var best = [];
    tot.forEach(function (v, i) { if (v === bestVal) best.push(i); });
    return { totals: tot, best: rounds.length ? best : [] };
  }
  function previews(state, lang) {
    var L = CSV[lang] || CSV.en;
    var d = { matches: Array.isArray(state.matches) ? state.matches : [],
              rounds: Array.isArray(state.rounds) ? state.rounds : [] };
    // history.csv = scores.js historyCsv (finished matches, one row per player)
    var hist = [[L.date, L.game, L.player, L.total, L.winner]];
    d.matches.filter(function (mt) { return mt.done; })
      .sort(function (x, y) { return x.done - y.done || cmpStr(x.id, y.id); })
      .forEach(function (mt) {
        var st = standing(mt, roundsOf(d, mt.id));
        mt.seats.forEach(function (s, i) {
          hist.push([fmtDate(mt.done), mt.name, s, st.totals[i], st.best.indexOf(i) >= 0 ? L.yes : L.no]);
        });
      });
    // rounds.csv: every match (open ones too), one row per round and player
    var all = [[L.date, L.game, L.finished, L.round, L.player, L.points]];
    d.matches.slice().sort(function (x, y) { return x.c - y.c || cmpStr(x.id, y.id); }).forEach(function (mt) {
      roundsOf(d, mt.id).forEach(function (r, ri) {
        mt.seats.forEach(function (s, i) {
          all.push([fmtDate(mt.c), mt.name, mt.done ? L.yes : L.no, ri + 1, s, i < r.s.length ? r.s[i] : 0]);
        });
      });
    });
    return { "history.csv": csvLines(hist), "rounds.csv": csvLines(all) };
  }

  // What an id names in a state (Undo tombstones each).
  function kindOf(id, state) {
    var s = isObj(state) ? state : {}, k = "";
    [["matches", "match"], ["rounds", "round"], ["tpls", "tpl"], ["players", "player"]].forEach(function (p) {
      (Array.isArray(s[p[0]]) ? s[p[0]] : []).forEach(function (x) { if (x && x.id === id) k = k || p[1]; });
    });
    return k;
  }

  var DESC = {
    app: "scores", title: "Score Keeper", slice: "scores", ext: ".orosscores", mime: "application/x-oros-scores",
    colls: {
      matches: { shape: "array", id: "id", stamp: "m" },
      rounds: { shape: "array", id: "id", stamp: "m" },
      tpls: { shape: "array", id: "id", stamp: "m" },
      players: { shape: "array", id: "id", stamp: "m" }
    },
    norm: norm, strip: strip, tombIds: tombIds, previews: previews
  };

  var api = { DESC: DESC, kindOf: kindOf, csvCell: csvCell, normMatch: normMatch, normRound: normRound,
              normTpl: normTpl, normPlayer: normPlayer };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrosScoresPackage = api;
})(this);
