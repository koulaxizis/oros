// ============================================================
// orOS Household — what the others changed (pure, no DOM; BR-HH)
// The shell engine (household/engine.js) hands every document a pull
// changed to summarize(); the shell keeps the result device-local in
// RECENT_KEY (plain JSON, never synced: each device sees what reached
// it). From it come:
//   - the bell: one line per household for a burst of changes, sent
//     when nothing new came for QUIET_MS or an hour after the burst
//     began ("Shopping: Nikos +3 ~1, −1 · Calendar: Anna ~2");
//   - the Today row "Today at home" (household/today.js).
// Counts only: + added, ~ changed, − removed items. A removal carries
// no member (the document keeps only when an item went), so removals
// show without a name. The person's own changes from another device
// are left out (same member id).
//   summarize(prev, next, me) → { by: { mid: { a, c } }, d } or null
//   add(st, box, hh, doc, title, sum, nameOf, t) → st (nameOf(mid))
//   due(st, now)   → [{ box, hh, from, body }] bursts to ring now
//                    (each marked rung in st)
//   today(st, dayStart) → [{ box, hh, text }] changes since dayStart
//   load(raw) / prune(st, now)
// Exposes window.OrosHouseRecent and, under Node, module.exports.
// ============================================================
(function (root) {
  "use strict";

  var RECENT_KEY = "oros-household-recent";
  var KEEP_MS = 36 * 3600000;
  var EV_MAX = 300;               // events kept per household
  var QUIET_MS = 10 * 60000;
  var BURST_MS = 60 * 60000;
  var MAX_LINE = 400;
  var BOX_RE = /^[A-Za-z0-9_-]{22}$/;

  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function newest(fs) {
    var mx = 0;
    Object.keys(fs || {}).forEach(function (f) { if (fs[f] && fs[f][1] > mx) mx = fs[f][1]; });
    return mx;
  }
  function alive(doc, id) {
    var fs = doc && doc.it && doc.it[id];
    if (!fs) return false;
    var dt = doc.dt && doc.dt[id];
    return dt === undefined || newest(fs) > dt;
  }
  // Which field changed last, and by whom.
  function lastBy(prevFs, fs) {
    var best = null;
    Object.keys(fs || {}).forEach(function (f) {
      var c = fs[f], p = prevFs && prevFs[f];
      if (p && p[1] === c[1] && p[2] === c[2] && JSON.stringify(p[0]) === JSON.stringify(c[0])) return;
      if (!best || c[1] > best[1]) best = c;
    });
    return best ? String(best[2] || "") : null;
  }

  function summarize(prev, next, me) {
    if (!isObj(prev) || !isObj(next) || !isObj(next.it)) return null;
    var by = {}, d = 0, any = false;
    function bump(mid, k) {
      if (!mid || mid === me) return;
      (by[mid] = by[mid] || { a: 0, c: 0 })[k]++;
      any = true;
    }
    Object.keys(next.it).forEach(function (id) {
      if (/^me:/.test(id) || !alive(next, id)) return;          // "who am I" is nobody's news
      var was = alive(prev, id), who = lastBy(was ? prev.it[id] : null, next.it[id]);
      if (who === null) return;
      bump(who, was ? "c" : "a");
    });
    Object.keys((prev && prev.it) || {}).forEach(function (id) {
      if (/^me:/.test(id) || !alive(prev, id) || alive(next, id)) return;
      d++;
      any = true;
    });
    return any ? { by: by, d: d } : null;
  }

  function load(raw) {
    var st = { v: 1, b: {} };
    if (!isObj(raw) || !isObj(raw.b)) return st;
    Object.keys(raw.b).forEach(function (box) {
      var x = raw.b[box];
      if (!BOX_RE.test(box) || !isObj(x) || !Array.isArray(x.ev)) return;
      st.b[box] = {
        hh: typeof x.hh === "string" ? x.hh.slice(0, 80) : "",
        ev: x.ev.filter(function (e) {
          return Array.isArray(e) && e.length === 8 && typeof e[0] === "number" && typeof e[2] === "string" && typeof e[4] === "string";
        }).slice(-EV_MAX),
        from: typeof x.from === "number" ? x.from : 0,
        last: typeof x.last === "number" ? x.last : 0
      };
    });
    return st;
  }
  function prune(st, now) {
    Object.keys(st.b).forEach(function (box) {
      var x = st.b[box];
      x.ev = x.ev.filter(function (e) { return e[0] >= now - KEEP_MS; }).slice(-EV_MAX);
      if (!x.ev.length && !x.from) delete st.b[box];
    });
    return st;
  }

  // event: [t, mid, name, doc, title, added, changed, removed]
  function add(st, box, hh, doc, title, sum, nameOf, t) {
    if (!sum || !BOX_RE.test(box)) return st;
    var x = st.b[box] = st.b[box] || { hh: "", ev: [], from: 0, last: 0 };
    if (hh) x.hh = String(hh).slice(0, 80);
    title = String(title || "").slice(0, 80);
    Object.keys(sum.by).sort().forEach(function (mid) {
      var n = sum.by[mid], name = String((nameOf && nameOf(mid)) || "").slice(0, 60);
      if (n.a || n.c) x.ev.push([t, mid, name || "?", doc, title, n.a, n.c, 0]);
    });
    if (sum.d) x.ev.push([t, "", "", doc, title, 0, 0, sum.d]);
    if (!x.from) x.from = t;
    x.last = t;
    return prune(st, t);
  }

  // "Shopping: Nikos +3 ~1, −1 · Calendar: Anna ~2" (per document, then
  // per person; removals, which carry no name, last)
  function counts(x) {
    var n = [];
    if (x.a) n.push("+" + x.a);
    if (x.c) n.push("~" + x.c);
    if (x.d) n.push("\u2212" + x.d);
    return n.join(" ");
  }
  function lineOf(evs) {
    var docs = [], per = {};
    evs.forEach(function (e) {
      var k = e[3];
      if (!per[k]) { per[k] = { title: e[4], order: [], who: {} }; docs.push(k); }
      var p = per[k], w = e[1] ? e[2] : "";
      if (e[4]) p.title = e[4];
      if (!p.who[w]) { p.who[w] = { a: 0, c: 0, d: 0 }; p.order.push(w); }
      p.who[w].a += e[5]; p.who[w].c += e[6]; p.who[w].d += e[7];
    });
    var s = docs.map(function (k) {
      var p = per[k];
      p.order.sort(function (a, b) { return (a === "" ? 1 : 0) - (b === "" ? 1 : 0); });
      var who = p.order.map(function (w) { return (w ? w + " " : "") + counts(p.who[w]); }).join(", ");
      return (p.title ? p.title + ": " : "") + who;
    }).join(" · ");
    return s.length > MAX_LINE ? s.slice(0, MAX_LINE - 1) + "…" : s;
  }

  function due(st, now) {
    var out = [];
    Object.keys(st.b).sort().forEach(function (box) {
      var x = st.b[box];
      if (!x.from || (now - x.last < QUIET_MS && now - x.from < BURST_MS)) return;
      var evs = x.ev.filter(function (e) { return e[0] >= x.from; });
      if (evs.length) out.push({ box: box, hh: x.hh, from: x.from, body: lineOf(evs) });
      x.from = 0;
    });
    return out;
  }

  function today(st, dayStart) {
    var out = [];
    Object.keys(st.b).sort().forEach(function (box) {
      var x = st.b[box];
      var evs = x.ev.filter(function (e) { return e[0] >= dayStart; });
      if (evs.length) out.push({ box: box, hh: x.hh, text: lineOf(evs) });
    });
    return out;
  }

  var api = { RECENT_KEY: RECENT_KEY, QUIET_MS: QUIET_MS, BURST_MS: BURST_MS, KEEP_MS: KEEP_MS, EV_MAX: EV_MAX,
              summarize: summarize, load: load, prune: prune, add: add, due: due, today: today, lineOf: lineOf };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root && root.document) root.OrosHouseRecent = api;
})(typeof window !== "undefined" ? window : globalThis);
