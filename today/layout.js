// ============================================================
// orOS Today — widget layout (wave 48)
// ------------------------------------------------------------
// Pure logic, no DOM, no storage: the Today app (today/today.js)
// draws what this decides; node tests require it
// (tests/today-layout.test.js).
//   - the widget catalogue: the four sections Today always had (top
//     lines, Overdue, Today, Coming up) plus Clock, Weather, Water,
//     Habits, Upcoming events and To-dos
//   - the layout { v: 1, items: [{ id, size }] }: which widgets, in
//     which order, small or wide. It lives on THIS device only
//     (localStorage "oros-today-layout", R10): a phone and a laptop
//     want different screens, so it is never in the synced slice.
//     The default is exactly the layout Today had before.
//   - distribute(groups, ids): which rows each widget shows. A row
//     goes to one widget only: Weather and Water take their app's top
//     line, Habits the habit rows, Upcoming events Calendar's events,
//     To-dos the To-Do tasks — when those widgets are on the screen;
//     otherwise the rows stay in the sections, as before.
// Exposed as window.OrosTodayLayout (module.exports in node).
// ============================================================
(function (root) {
  "use strict";

  var VER = 1;
  // kind: "list" (rows; full width on narrow screens whatever its
  // size) or "tile" (a compact card; two small tiles share a row
  // even on a phone).
  var WIDGETS = {
    top:     { kind: "list", sizes: ["wide"], def: "wide" },
    overdue: { kind: "list", sizes: ["small", "wide"], def: "small" },
    today:   { kind: "list", sizes: ["small", "wide"], def: "small" },
    soon:    { kind: "list", sizes: ["small", "wide"], def: "small" },
    clock:   { kind: "tile", sizes: ["small", "wide"], def: "small" },
    weather: { kind: "tile", sizes: ["small", "wide"], def: "small", app: "weather" },
    water:   { kind: "tile", sizes: ["small", "wide"], def: "small", app: "water" },
    habits:  { kind: "list", sizes: ["small", "wide"], def: "small", app: "habits" },
    events:  { kind: "list", sizes: ["small", "wide"], def: "wide", app: "calendar" },
    todos:   { kind: "list", sizes: ["small", "wide"], def: "small", app: "todo" }
  };
  var ORDER = ["top", "overdue", "today", "soon", "clock", "weather", "water", "habits", "events", "todos"];
  var DEFAULT = [
    { id: "top", size: "wide" },
    { id: "overdue", size: "small" },
    { id: "today", size: "small" },
    { id: "soon", size: "small" }
  ];

  function has(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function copy(items) { return items.map(function (x) { return { id: x.id, size: x.size }; }); }
  function defaults() { return { v: VER, items: copy(DEFAULT) }; }

  // Anything stored (or nothing) → a valid layout. Unknown widgets
  // (a newer version's) and doubles are dropped, a size a widget does
  // not have becomes its default. Not an object / no items → the
  // default; an empty list is kept (the user removed everything).
  function norm(raw) {
    if (!isObj(raw) || !Array.isArray(raw.items)) return defaults();
    var seen = {}, items = [];
    raw.items.forEach(function (x) {
      var id = isObj(x) ? x.id : x;
      if (typeof id !== "string" || !has(WIDGETS, id) || seen[id]) return;
      seen[id] = 1;
      var w = WIDGETS[id];
      var size = isObj(x) && w.sizes.indexOf(x.size) >= 0 ? x.size : w.def;
      items.push({ id: id, size: size });
    });
    return { v: VER, items: items };
  }
  function parse(text) {
    try { return norm(JSON.parse(text)); } catch (e) { return defaults(); }
  }
  function isDefault(l) { return JSON.stringify(norm(l).items) === JSON.stringify(DEFAULT); }
  function ids(l) { return norm(l).items.map(function (x) { return x.id; }); }
  function hidden(l) {
    var on = {};
    norm(l).items.forEach(function (x) { on[x.id] = 1; });
    return ORDER.filter(function (id) { return !on[id]; });
  }

  // ---------- Editing (each returns a new layout) ----------
  function move(l, from, to) {
    var n = norm(l), items = n.items;
    if (from < 0 || from >= items.length) return n;
    to = Math.max(0, Math.min(items.length - 1, to));
    if (to === from) return n;
    var x = items.splice(from, 1)[0];
    items.splice(to, 0, x);
    return n;
  }
  function moveId(l, id, delta) {
    var n = norm(l), i = ids(n).indexOf(id);
    return i < 0 ? n : move(n, i, i + delta);
  }
  // The order of ids as dragged on the screen; ids it misses keep
  // their place at the end (nothing is lost to a bad drop).
  function reorder(l, order) {
    var n = norm(l), by = {}, out = [];
    n.items.forEach(function (x) { by[x.id] = x; });
    (Array.isArray(order) ? order : []).forEach(function (id) {
      if (has(by, id)) { out.push(by[id]); delete by[id]; }
    });
    n.items.forEach(function (x) { if (has(by, x.id)) out.push(x); });
    return { v: VER, items: out };
  }
  function add(l, id, at) {
    var n = norm(l);
    if (!has(WIDGETS, id) || ids(n).indexOf(id) >= 0) return n;
    var x = { id: id, size: WIDGETS[id].def };
    if (typeof at === "number" && at >= 0 && at < n.items.length) n.items.splice(at, 0, x);
    else n.items.push(x);
    return n;
  }
  function remove(l, id) {
    var n = norm(l);
    n.items = n.items.filter(function (x) { return x.id !== id; });
    return n;
  }
  function setSize(l, id, size) {
    var n = norm(l);
    n.items.forEach(function (x) {
      if (x.id === id && WIDGETS[id].sizes.indexOf(size) >= 0) x.size = size;
    });
    return n;
  }
  function nextSize(id, size) {
    var s = has(WIDGETS, id) ? WIDGETS[id].sizes : [];
    if (s.length < 2) return size;
    return s[(s.indexOf(size) + 1) % s.length];
  }

  // ---------- Rows → widgets ----------
  // g = the summary's groups (today/agg.js trim(): info, overdue,
  // overdueMore, today, todayMore, soon [{ day, rows, more }]).
  // on = the widget ids on the screen. → { <id>: [part] } with
  // part = { late?: true, today?: true, day?: "YYYY-MM-DD", rows, more }
  // (parts without rows are left out).
  function claims(on) {
    var c = {};
    on.forEach(function (id) { if (has(WIDGETS, id) && WIDGETS[id].app) c[id] = WIDGETS[id].app; });
    return c;
  }
  function whose(r, c) {
    if (!r) return "";
    if (r.kind === "info") {
      if (c.weather && r.app === "weather") return "weather";
      if (c.water && r.app === "water") return "water";
      return "";
    }
    if (c.habits && r.app === "habits") return "habits";
    if (c.events && r.app === "calendar" && r.kind === "event") return "events";
    if (c.todos && r.app === "todo") return "todos";
    return "";
  }
  function moreFor(more, app) {
    var out = {};
    if (isObj(more) && has(more, app)) out[app] = more[app];
    return out;
  }
  function moreWithout(more, apps) {
    var out = {};
    Object.keys(isObj(more) ? more : {}).forEach(function (a) { if (!apps[a]) out[a] = more[a]; });
    return out;
  }
  function distribute(g, on) {
    g = g || {};
    on = Array.isArray(on) ? on : [];
    var c = claims(on), taken = {};
    Object.keys(c).forEach(function (w) {
      if (w === "events") return;                 // Calendar's top lines and tasks stay
      taken[c[w]] = 1;
    });
    var out = {};
    ORDER.forEach(function (id) { out[id] = []; });
    function push(id, part) { if (part.rows.length) out[id].push(part); }
    function split(rows, later) {
      var keep = [], mine = {};
      (rows || []).forEach(function (r) {
        var w = whose(r, c);
        if (later && w === "habits") w = "";     // habits of later days are not due: they stay in Coming up
        if (w) (mine[w] = mine[w] || []).push(r);
        else keep.push(r);
      });
      return { keep: keep, mine: mine };
    }
    var top = split(g.info);
    push("top", { rows: top.keep, more: {} });
    if (top.mine.weather) push("weather", { rows: top.mine.weather, more: {} });
    if (top.mine.water) push("water", { rows: top.mine.water, more: {} });

    var od = split(g.overdue), td = split(g.today);
    push("overdue", { late: true, rows: od.keep, more: moreWithout(g.overdueMore, taken) });
    push("today", { today: true, rows: td.keep, more: moreWithout(g.todayMore, taken) });
    ["habits", "todos", "events"].forEach(function (w) {
      if (!c[w]) return;
      if (od.mine[w]) push(w, { late: true, rows: od.mine[w], more: moreFor(g.overdueMore, c[w]) });
      if (td.mine[w]) push(w, { today: true, rows: td.mine[w], more: moreFor(g.todayMore, c[w]) });
    });
    (g.soon || []).forEach(function (d) {
      var s = split(d.rows, true);
      var more = moreWithout(d.more, taken);
      if (taken.habits && isObj(d.more) && has(d.more, "habits")) more.habits = d.more.habits;
      push("soon", { day: d.day, rows: s.keep, more: more });
      ["todos", "events"].forEach(function (w) {
        if (c[w] && s.mine[w]) push(w, { day: d.day, rows: s.mine[w], more: moreFor(d.more, c[w]) });
      });
    });
    return out;
  }

  var api = {
    VER: VER, WIDGETS: WIDGETS, ORDER: ORDER, DEFAULT: DEFAULT,
    defaults: defaults, norm: norm, parse: parse, isDefault: isDefault, ids: ids, hidden: hidden,
    move: move, moveId: moveId, reorder: reorder, add: add, remove: remove, setSize: setSize, nextSize: nextSize,
    distribute: distribute
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root && root.document) root.OrosTodayLayout = api;
})(typeof window !== "undefined" ? window : this);
