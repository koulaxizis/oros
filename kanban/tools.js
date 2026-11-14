// ============================================================
// orOS Kanban — board tools (v1.0.0)
// Pure: no DOM, no storage. window.OrosKanbanTools in the app,
// module.exports under Node (tests/kanban-*.test.js). Needs
// kanban/model.js (OrosKanbanModel) for the field stamps.
//   · automations: arrival rules of a column (col.auto) and the
//     overdue rule (the label whose auto is "overdue");
//   · swimlanes (by label or by the card's lane), table sorting,
//     timeline range;
//   · board export (JSON, CSV), import of that JSON, templates
//     (save a board as one, new board from one, built-ins EN/EL);
//   · the .orosboard bundle's content.json and board.md preview.
// Imported data is only ever read as data: every string is checked
// and capped, ids are made fresh, nothing is executed.
// ============================================================
(function (root) {
  "use strict";

  var M = root && root.OrosKanbanModel;
  if (!M && typeof require === "function") M = require("./model.js");

  var YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
  var HEX = /^#[0-9a-fA-F]{6}$/;
  var FILE_RE = /^[a-z0-9][a-z0-9-]{0,79}\.[a-z0-9]{1,8}$/;
  var ATT_DIR = "/internal/Kanban/Attachments/";
  var MAX = { text: 500, notes: 20000, label: 40, lane: 60, info: 200, name: 120, cols: 60, cards: 5000, sub: 200, att: 20 };

  function str(v, n) { return typeof v === "string" ? v.slice(0, n || 500) : ""; }
  function arr(a) { return Array.isArray(a) ? a : []; }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymdOf(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function parseYmd(s) {
    var m = typeof s === "string" && YMD.exec(s);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  function addDays(ymd, n) {
    var d = parseYmd(ymd);
    if (!d) return null;
    d.setDate(d.getDate() + n);
    return ymdOf(d);
  }
  // Local midnight at the end of the due day: from then on it is late.
  function dueEndMs(ymd) {
    var d = parseYmd(ymd);
    if (!d) return Infinity;
    d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  function daysBetween(a, b) {
    var x = parseYmd(a), y = parseYmd(b);
    if (!x || !y) return 0;
    return Math.round((Date.UTC(y.getFullYear(), y.getMonth(), y.getDate()) -
                       Date.UTC(x.getFullYear(), x.getMonth(), x.getDate())) / 86400000);
  }
  function attPath(file) { return FILE_RE.test(file || "") ? ATT_DIR + file : null; }

  function findCard(board, cardId) {
    var cols = arr(board && board.columns);
    for (var i = 0; i < cols.length; i++) {
      var cs = arr(cols[i].cards);
      for (var j = 0; j < cs.length; j++) if (cs[j].id === cardId) return { col: cols[i], card: cs[j], idx: j, colIdx: i };
    }
    return null;
  }
  function labelIds(board) {
    var m = {};
    arr(board && board.labels).forEach(function (l) { m[l.id] = l; });
    return m;
  }

  // ---------- automations ----------
  // A card arrived in a column (moved from another one). Applies the
  // column's rules; returns the list of what changed ([] = nothing).
  function applyArrival(board, colId, cardId, today, now) {
    var f = findCard(board, cardId);
    if (!f || f.col.id !== colId) return [];
    var auto = f.col.auto && typeof f.col.auto === "object" ? f.col.auto : null;
    if (!auto) return [];
    var card = f.card, done = [];
    if (auto.done && arr(card.subtasks).some(function (s) { return s && !s.completed; })) {
      var at = M.stampCard(card, ["s"], now);
      card.subtasks.forEach(function (s) { if (s && !s.completed) { s.completed = true; s.m = at; } });
      done.push("done");
    }
    if (auto.today && today && card.due !== today) {
      card.due = today;
      M.stampCard(card, ["d"], now);
      done.push("today");
    }
    if (auto.label && labelIds(board)[auto.label] && arr(card.labels).indexOf(auto.label) === -1) {
      card.labels = arr(card.labels).concat([auto.label]);
      M.stampCard(card, ["l"], now);
      done.push("label");
    }
    if (auto.top && f.idx > 0) {
      f.col.cards.splice(f.idx, 1);
      f.col.cards.unshift(card);
      f.col.om = Math.max(now, (f.col.om || 0) + 1);
      f.col.cards.forEach(function (c, i) { c.pos = i; });
      done.push("top");
    }
    return done;
  }
  function hasRules(col) {
    var a = col && col.auto;
    return !!(a && (a.done || a.today || a.top || a.label));
  }
  function overdueLabel(board) {
    var ls = arr(board && board.labels);
    for (var i = 0; i < ls.length; i++) if (ls[i] && ls[i].auto === "overdue") return ls[i];
    return null;
  }
  // "When a due date passes → add the Overdue label". Cards in the
  // board's last column (Done) are left alone. A card whose labels were
  // changed after its due date passed (the user took the label off) is
  // not labelled again. Returns how many cards changed.
  function applyOverdue(board, now) {
    var lb = overdueLabel(board);
    if (!lb || !board || board.archived || M.isTpl(board)) return 0;
    var cols = arr(board.columns), n = 0;
    cols.forEach(function (col, ci) {
      if (ci === cols.length - 1 && cols.length > 1) return;
      arr(col.cards).forEach(function (card) {
        if (!card || typeof card.due !== "string" || !YMD.test(card.due)) return;
        var end = dueEndMs(card.due);
        if (now < end) return;
        if (arr(card.labels).indexOf(lb.id) !== -1) return;
        // labels changed after the date passed AND after the rule was switched on
        // (label stamp): the user took the label off — not added again
        var lf = M.fmValid(card) ? (card.fm.l || 0) : 0;
        if (lf >= end && lf > (lb.mtime || 0)) return;
        card.labels = arr(card.labels).concat([lb.id]);
        M.stampCard(card, ["l"], now);
        n++;
      });
    });
    return n;
  }

  // ---------- swimlanes ----------
  // mode "label": a card sits in the lane of its first label (board
  // label order); mode "lane": its lane text. "" = the "none" lane.
  function laneKey(board, card, mode) {
    if (mode === "lane") return typeof card.lane === "string" ? card.lane.trim() : "";
    if (mode === "label") {
      var ls = arr(board.labels), have = arr(card.labels);
      for (var i = 0; i < ls.length; i++) if (have.indexOf(ls[i].id) !== -1) return ls[i].id;
    }
    return "";
  }
  function lanes(board, mode) {
    var out = [];
    if (mode === "label") {
      arr(board.labels).forEach(function (l) { out.push({ key: l.id, name: l.name, color: l.color || null }); });
    } else if (mode === "lane") {
      var seen = {};
      arr(board.columns).forEach(function (col) {
        arr(col.cards).forEach(function (c) {
          var k = laneKey(board, c, mode);
          if (k && !seen[k.toLowerCase()]) { seen[k.toLowerCase()] = true; out.push({ key: k, name: k, color: null }); }
        });
      });
      out.sort(function (a, b) { return a.name.localeCompare(b.name); });
    }
    out.push({ key: "", name: null, color: null });
    return out;
  }
  // Moving a card into another lane. Returns the groups to stamp.
  function setLane(board, card, mode, fromKey, toKey) {
    if (fromKey === toKey) return [];
    if (mode === "lane") {
      if (toKey) card.lane = toKey; else delete card.lane;
      return ["k"];
    }
    if (mode === "label") {
      var ls = arr(card.labels).filter(function (id) { return id !== fromKey; });
      if (toKey && labelIds(board)[toKey] && ls.indexOf(toKey) === -1) ls.unshift(toKey);
      card.labels = ls;
      return ["l"];
    }
    return [];
  }

  // ---------- table ----------
  // rows: [{ card, col, colIdx, idx }]; key: text|status|due|labels|sub|lane
  function sortRows(rows, key, dir, board) {
    var d = dir === "desc" ? -1 : 1;
    var lab = labelIds(board);
    var val = function (r) {
      var c = r.card;
      if (key === "text") return (c.text || "").toLocaleLowerCase();
      if (key === "due") return c.due || "";
      if (key === "lane") return (c.lane || "").toLocaleLowerCase();
      if (key === "labels") return arr(c.labels).map(function (id) { return lab[id] ? lab[id].name.toLocaleLowerCase() : ""; }).filter(Boolean).sort().join(",");
      if (key === "sub") {
        var s = arr(c.subtasks);
        return s.length ? s.filter(function (x) { return x && x.completed; }).length / s.length : -1;
      }
      return r.colIdx * 100000 + r.idx;           // status: board order
    };
    return rows.slice().sort(function (a, b) {
      var va = val(a), vb = val(b);
      // empty values always last, whatever the direction
      var ea = va === "" || va === -1, eb = vb === "" || vb === -1;
      if (ea !== eb) return ea ? 1 : -1;
      if (va < vb) return -d;
      if (va > vb) return d;
      return (a.colIdx - b.colIdx) || (a.idx - b.idx);
    });
  }

  // ---------- timeline ----------
  // Range of days to draw: a few days around today and every due date.
  function timelineRange(dues, today, before, after) {
    var from = addDays(today, -(before || 3)), to = addDays(today, after || 21);
    dues.forEach(function (d) {
      if (!YMD.test(d || "")) return;
      if (d < from) from = addDays(d, -1);
      if (d > to) to = addDays(d, 2);
    });
    // cap: at most ~1 year either side of today
    var minFrom = addDays(today, -366), maxTo = addDays(today, 366);
    if (from < minFrom) from = minFrom;
    if (to > maxTo) to = maxTo;
    return { from: from, to: to, days: daysBetween(from, to) + 1 };
  }

  // ---------- Gantt (wave G1): spans, workdays, progress ----------
  function isWeekend(ymd) {
    var d = parseYmd(ymd);
    return !!d && (d.getDay() === 0 || d.getDay() === 6);
  }
  // The same day when it is a workday, else the next one in direction dir.
  function nextWorkday(ymd, dir) {
    var d = ymd, n = 0;
    while (d && isWeekend(d) && n++ < 3) d = addDays(d, dir < 0 ? -1 : 1);
    return d;
  }
  // Days a span covers, both ends included (workdays only when wd).
  function spanDays(from, to, wd) {
    var n = daysBetween(from, to);
    if (n < 0) { var x = from; from = to; to = x; n = -n; }
    if (!wd) return n + 1;
    var c = 0;
    for (var i = 0; i <= n && i < 4000; i++) if (!isWeekend(addDays(from, i))) c++;
    return c;
  }
  // A card's bar: from..to (YYYY-MM-DD), or null without any date. A
  // milestone sits on its due date (else its start); a start after the
  // due date is shown the other way round, never lost.
  function planSpan(card) {
    if (!card) return null;
    var s = YMD.test(card.start || "") ? card.start : null;
    var d = YMD.test(card.due || "") ? card.due : null;
    if (!s && !d) return null;
    var ms = card.ms === 1 || card.ms === true;
    if (ms) { var at = d || s; return { from: at, to: at, ms: true }; }
    s = s || d; d = d || s;
    return s <= d ? { from: s, to: d, ms: false } : { from: d, to: s, ms: false };
  }
  // Move a span by delta days. With workdays the start lands on a
  // workday (in the direction of the move) and the span keeps its
  // number of workdays, so a week-long job stays a working week.
  function shiftSpan(from, to, delta, wd) {
    if (!wd) return { from: addDays(from, delta), to: addDays(to, delta) };
    var len = Math.max(1, spanDays(from, to, true));
    var f = nextWorkday(addDays(from, delta), delta < 0 ? -1 : 1);
    var e = f, k = 1, guard = 0;
    while (k < len && guard++ < 4000) { e = addDays(e, 1); if (!isWeekend(e)) k++; }
    return { from: f, to: e };
  }
  // Share of done subtasks (0..1), null without subtasks.
  function progressOf(card) {
    var subs = arr(card && card.subtasks).filter(function (x) { return x && typeof x === "object"; });
    if (!subs.length) return null;
    return subs.filter(function (x) { return x.completed; }).length / subs.length;
  }
  // The board's "Only workdays" switch rides on its columns (gw: 1): the
  // board header keeps no unknown keys in older merges, a column does.
  function boardWorkdays(board) {
    return arr(board && board.columns).some(function (c) { return c && c.gw === 1; });
  }

  // ---------- Gantt (wave G2): finish-to-start dependencies ----------
  // card.deps = ids of the cards it waits for (same board). Ids of cards
  // that no longer exist are ignored, never an error.
  function cardIndex(board) {
    var m = {};
    arr(board && board.columns).forEach(function (col, ci) {
      arr(col && col.cards).forEach(function (c) { if (c && typeof c.id === "string") m[c.id] = { card: c, col: col, colIdx: ci }; });
    });
    return m;
  }
  function predsOf(card, idx) {
    return arr(card && card.deps).filter(function (id) { return typeof id === "string" && idx[id] && id !== card.id; });
  }
  // Would "card waits for pred" close a loop? True when pred already
  // waits (directly or through others) for card.
  function wouldCycle(board, cardId, predId) {
    if (cardId === predId) return true;
    var idx = cardIndex(board), seen = {}, stack = [predId], n = 0;
    while (stack.length && n++ < 20000) {
      var id = stack.pop();
      if (id === cardId) return true;
      if (seen[id] || !idx[id]) continue;
      seen[id] = true;
      predsOf(idx[id].card, idx).forEach(function (p) { stack.push(p); });
    }
    return false;
  }
  // The first day a successor may start after pred ends.
  function dayAfter(to, wd) {
    var d = addDays(to, 1);
    return wd ? nextWorkday(d, 1) : d;
  }
  // Dependencies that are not kept: the successor starts on or before
  // the day its predecessor ends. → [{ from: predId, to: succId }]
  function brokenDeps(board, wd) {
    var idx = cardIndex(board), out = [];
    Object.keys(idx).forEach(function (id) {
      var c = idx[id].card, sp = planSpan(c);
      if (!sp) return;
      predsOf(c, idx).forEach(function (p) {
        var ps = planSpan(idx[p].card);
        if (ps && sp.from < dayAfter(ps.to, wd)) out.push({ from: p, to: id });
      });
    });
    return out;
  }
  // Every card after the given one (transitively), pushed later just
  // enough to keep each dependency; never pulled earlier. Each keeps its
  // length (in workdays with wd). → [{ id, from, to }] in a safe order.
  function shiftAfter(board, cardId, wd) {
    var idx = cardIndex(board);
    var succ = {};
    Object.keys(idx).forEach(function (id) {
      predsOf(idx[id].card, idx).forEach(function (p) { (succ[p] = succ[p] || []).push(id); });
    });
    // the cards reached from cardId
    var reach = {}, stack = (succ[cardId] || []).slice(), n = 0;
    while (stack.length && n++ < 20000) {
      var id = stack.pop();
      if (reach[id]) continue;
      reach[id] = true;
      (succ[id] || []).forEach(function (x) { stack.push(x); });
    }
    // topological order over the reached cards (Kahn; a loop is cut)
    var spans = {};
    Object.keys(idx).forEach(function (id) { var sp = planSpan(idx[id].card); if (sp) spans[id] = { from: sp.from, to: sp.to }; });
    var order = [], indeg = {};
    Object.keys(reach).forEach(function (id) {
      indeg[id] = predsOf(idx[id].card, idx).filter(function (p) { return reach[p]; }).length;
    });
    var q = Object.keys(indeg).filter(function (id) { return !indeg[id]; }).sort();
    while (q.length) {
      var x = q.shift();
      order.push(x);
      (succ[x] || []).forEach(function (y) { if (reach[y] && --indeg[y] === 0) q.push(y); });
    }
    var out = [];
    order.forEach(function (id) {
      var sp = spans[id];
      if (!sp) return;
      var need = null;
      predsOf(idx[id].card, idx).forEach(function (p) {
        if (!spans[p]) return;
        var d = dayAfter(spans[p].to, wd);
        if (!need || d > need) need = d;
      });
      if (!need || sp.from >= need) return;
      var moved = shiftSpan(sp.from, sp.to, daysBetween(sp.from, need), wd);
      if (moved.from < need) moved = shiftSpan(moved.from, moved.to, daysBetween(moved.from, need), wd);
      spans[id] = moved;
      out.push({ id: id, from: moved.from, to: moved.to });
    });
    return out;
  }
  // Critical path: the cards with no slack before the end of the plan
  // (the latest due date among the dated cards). Slack = days a card
  // could end later without moving the end, through its successors.
  // → { ids: { id: true }, end }
  function criticalPath(board, wd) {
    var idx = cardIndex(board), spans = {}, succ = {};
    Object.keys(idx).forEach(function (id) { var sp = planSpan(idx[id].card); if (sp) spans[id] = sp; });
    var ids = Object.keys(spans);
    if (!ids.length) return { ids: {}, end: null };
    var end = ids.reduce(function (m, id) { return spans[id].to > m ? spans[id].to : m; }, spans[ids[0]].to);
    ids.forEach(function (id) {
      predsOf(idx[id].card, idx).forEach(function (p) { if (spans[p]) (succ[p] = succ[p] || []).push(id); });
    });
    // latest finish, memoised; a loop counts as no constraint
    var lf = {}, busy = {};
    function latest(id) {
      if (lf[id] !== undefined) return lf[id];
      if (busy[id]) return end;
      busy[id] = true;
      var v = end;
      (succ[id] || []).forEach(function (s) {
        // the successor's latest start, minus one day
        var ls = addDays(latest(s), -(daysBetween(spans[s].from, spans[s].to)));
        var cand = addDays(ls, -1);
        if (wd) cand = nextWorkday(cand, -1);
        if (cand < v) v = cand;
      });
      busy[id] = false;
      lf[id] = v;
      return v;
    }
    var crit = {};
    ids.forEach(function (id) { if (latest(id) <= spans[id].to) crit[id] = true; });
    return { ids: crit, end: end };
  }

  // ---------- normalise + re-id (export import, templates, built-ins) ----------
  // src: a board-shaped object from anywhere (our export, a template).
  // opts: { uid, now, name, keepDue, keepAtt, untick, id, archived }
  // fileMap (out): old file name → new file name, for attachments.
  function rebuild(src, opts, fileMap) {
    var uid = opts.uid, now = opts.now;
    var cardMap = {}, withDeps = [];
    var lblMap = {}, labels = [];
    arr(src && src.labels).slice(0, 200).forEach(function (l) {
      if (!l || typeof l !== "object") return;
      var name = str(l.name, MAX.label).trim();
      if (!name) return;
      var nl = { id: uid(), name: name, color: HEX.test(l.color || "") ? l.color : "#ecc75f", mtime: now, pos: labels.length };
      if (l.auto === "overdue") nl.auto = "overdue";
      if (typeof l.id === "string") lblMap[l.id] = nl.id;
      labels.push(nl);
    });
    var columns = [];
    var cardCount = 0;
    arr(src && src.columns).slice(0, MAX.cols).forEach(function (col) {
      if (!col || typeof col !== "object") return;
      var nc = { id: uid(), name: str(col.name, MAX.name).trim() || "—", mtime: now, om: now, pos: columns.length, cards: [] };
      var wip = Math.floor(+col.wip);
      if (wip > 0 && wip < 1000) nc.wip = wip;
      if (col.gw === 1) nc.gw = 1;
      var au = col.auto && typeof col.auto === "object" ? col.auto : null;
      if (au) {
        var na = {};
        if (au.done) na.done = true;
        if (au.today) na.today = true;
        if (au.top) na.top = true;
        if (typeof au.label === "string" && lblMap[au.label]) na.label = lblMap[au.label];
        if (Object.keys(na).length) nc.auto = na;
      }
      arr(col.cards).forEach(function (c) {
        if (!c || typeof c !== "object" || cardCount >= MAX.cards) return;
        var text = str(c.text, MAX.text);
        if (!text.trim()) return;
        cardCount++;
        var card = {
          id: uid(), text: text, notes: str(c.notes, MAX.notes),
          due: opts.keepDue && YMD.test(c.due || "") ? c.due : null,
          labels: arr(c.labels).map(function (id) { return lblMap[id]; }).filter(function (id, i, a) { return id && a.indexOf(id) === i; }),
          subtasks: arr(c.subtasks).slice(0, MAX.sub).filter(function (s) { return s && typeof s.text === "string" && s.text.trim(); })
            .map(function (s) { return { id: uid(), text: str(s.text, MAX.text), completed: opts.untick ? false : !!s.completed }; }),
          info: arr(c.info).slice(0, 50).filter(function (f) { return f && (str(f.label).trim() || str(f.value).trim()); })
            .map(function (f) { return { id: uid(), label: str(f.label, MAX.info), value: str(f.value, MAX.info) }; }),
          mtime: now, pos: nc.cards.length
        };
        var lane = str(c.lane, MAX.lane).trim();
        if (lane) card.lane = lane;
        // Gantt (G1): start with the due date, milestone; deps are re-mapped below
        if (opts.keepDue && YMD.test(c.start || "")) card.start = c.start;
        if (c.ms === 1 || c.ms === true) card.ms = 1;
        if (typeof c.id === "string") cardMap[c.id] = card.id;
        if (Array.isArray(c.deps) && c.deps.length) withDeps.push({ card: card, deps: c.deps });
        var attMap = {};
        if (opts.keepAtt) {
          var att = [];
          arr(c.att).slice(0, MAX.att).forEach(function (x) {
            if (!x || !FILE_RE.test(x.file || "")) return;
            var nf = fileMap ? (fileMap[x.file] = fileMap[x.file] || (uid() + "." + x.file.split(".").pop())) : x.file;
            var na2 = { id: uid(), name: str(x.name, MAX.name) || nf, file: nf,
                        kind: x.kind === "img" || x.kind === "pdf" ? x.kind : "file",
                        size: Math.max(0, Math.floor(+x.size) || 0) };
            attMap[x.id] = na2.id;
            att.push(na2);
          });
          if (att.length) card.att = att;
        }
        if (typeof c.cover === "string") {
          if (HEX.test(c.cover)) card.cover = c.cover;
          else if (c.cover.indexOf("a:") === 0 && attMap[c.cover.slice(2)]) card.cover = "a:" + attMap[c.cover.slice(2)];
        }
        card.fm = M.freshFm(now);
        nc.cards.push(card);
      });
      columns.push(nc);
    });
    withDeps.forEach(function (w) {
      var d = M.cleanDeps(w.deps.map(function (id) { return cardMap[id]; }), w.card.id);
      if (d.length) w.card.deps = d;
    });
    var board = {
      id: opts.id || uid(),
      name: str(opts.name != null ? opts.name : src && src.name, MAX.name).trim() || "Board",
      mtime: now, om: now, deleted: {}, labels: labels, columns: columns
    };
    if (opts.archived) board.archived = true;
    if (src && HEX.test(src.color || "")) board.color = src.color;
    return board;
  }

  function counter() { var n = 0; return function () { return "x" + (n++); }; }

  // ---------- export / import ----------
  var EXPORT_APP = "oros-kanban";
  function exportBoard(board, files, now) {
    var b = JSON.parse(JSON.stringify(board));
    delete b.deleted;
    var out = { app: EXPORT_APP, kind: "board", ver: 1, exported: new Date(now || Date.now()).toISOString(), board: b };
    if (files && Object.keys(files).length) out.files = files;
    return out;
  }
  function isExport(json) {
    return !!(json && typeof json === "object" && json.app === EXPORT_APP && json.board && typeof json.board === "object" && Array.isArray(json.board.columns));
  }
  // → { board, files: [{ file, data(base64) }] } with fresh ids, or null.
  function parseExport(json, uid, now) {
    if (!isExport(json)) return null;
    var fileMap = {};
    var board = rebuild(json.board, { uid: uid, now: now, keepDue: true, keepAtt: true }, fileMap);
    var files = [];
    var src = json.files && typeof json.files === "object" ? json.files : {};
    Object.keys(fileMap).forEach(function (old) {
      var d = src[old];
      if (typeof d === "string" && d.length < 22 * 1024 * 1024 && /^[A-Za-z0-9+/=\s]*$/.test(d)) files.push({ file: fileMap[old], data: d });
    });
    return { board: board, files: files };
  }
  function csvCell(v) {
    var s = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;               // never a formula in a spreadsheet
    return /[",\n\r;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  // heads: localised header names [board, column, card, notes, due, labels, subtasks, lane, info, attachments]
  function boardCsv(board, heads) {
    var lab = labelIds(board);
    var rows = [heads.map(csvCell).join(",")];
    arr(board.columns).forEach(function (col) {
      arr(col.cards).forEach(function (c) {
        var subs = arr(c.subtasks);
        rows.push([
          board.name, col.name, c.text, c.notes || "", c.due || "",
          arr(c.labels).map(function (id) { return lab[id] ? lab[id].name : ""; }).filter(Boolean).join("; "),
          subs.length ? subs.filter(function (s) { return s && s.completed; }).length + "/" + subs.length : "",
          c.lane || "",
          arr(c.info).map(function (f) { return [str(f.label), str(f.value)].filter(Boolean).join(": "); }).filter(Boolean).join("; "),
          arr(c.att).map(function (x) { return x.name; }).join("; "),
          YMD.test(c.start || "") ? c.start : "",
          c.ms ? "1" : ""
        ].map(csvCell).join(","));
      });
    });
    return "﻿" + rows.join("\r\n") + "\r\n";
  }

  // ---------- .orosboard bundle (bundle.js, docs/oros-bundle.md) ----------
  // content.json = { kind: "oros-kanban-package", ver: 1, board }: the
  // board as the JSON export holds it (no tombstones), every card
  // attachment's file renamed to its media key (<sha256>.<ext>), so
  // media/<key> holds the bytes. keys: disk file name → media key; an
  // attachment whose file could not be read keeps its name (no bytes).
  var PKG_KIND = "oros-kanban-package", PKG_VER = 1;
  function packBoard(board, keys) {
    var b = JSON.parse(JSON.stringify(board || {}));
    delete b.deleted;
    keys = keys || {};
    arr(b.columns).forEach(function (col) {
      arr(col && col.cards).forEach(function (c) {
        arr(c && c.att).forEach(function (x) {
          if (x && Object.prototype.hasOwnProperty.call(keys, x.file)) x.file = keys[x.file];
        });
      });
    });
    return { kind: PKG_KIND, ver: PKG_VER, board: b };
  }
  function isPackage(c) {
    return !!(c && typeof c === "object" && c.kind === PKG_KIND && c.board && typeof c.board === "object" && Array.isArray(c.board.columns));
  }
  // content.json + the bundle's media ({ key: { bytes } }) → { board,
  // files: [{ file, bytes }] } with fresh ids (rebuild, as an import of
  // the JSON export), or null.
  function parsePackage(content, media, uid, now) {
    if (!isPackage(content)) return null;
    var fileMap = {};
    var board = rebuild(content.board, { uid: uid, now: now, keepDue: true, keepAtt: true }, fileMap);
    var files = [];
    media = media && typeof media === "object" ? media : {};
    Object.keys(fileMap).forEach(function (old) {
      var m = Object.prototype.hasOwnProperty.call(media, old) ? media[old] : null;
      if (m && m.bytes && typeof m.bytes.length === "number") files.push({ file: fileMap[old], bytes: m.bytes });
    });
    return { board: board, files: files };
  }
  // The board as Markdown (preview/board.md): a heading per column, a
  // list item per card with its due date, labels, lane, subtasks,
  // notes and attachment names. words: { due, labels, lane, att }.
  function mdLine(v) { return String(v == null ? "" : v).replace(/[\r\n]+/g, " ").trim(); }
  function boardMd(board, words) {
    words = words || {};
    var lab = labelIds(board), out = ["# " + (mdLine(board && board.name) || "Board"), ""];
    arr(board && board.columns).forEach(function (col) {
      out.push("## " + (mdLine(col.name) || "—"), "");
      arr(col.cards).forEach(function (c, i, all) {
        out.push("- **" + mdLine(c.text) + "**");
        var bits = [];
        if (c.due) bits.push((words.due || "Due") + ": " + c.due);
        var ls = arr(c.labels).map(function (id) { return lab[id] ? mdLine(lab[id].name) : ""; }).filter(Boolean);
        if (ls.length) bits.push((words.labels || "Labels") + ": " + ls.join(", "));
        if (c.lane) bits.push((words.lane || "Lane") + ": " + mdLine(c.lane));
        if (bits.length) out.push("  " + bits.join(" · "));
        arr(c.subtasks).forEach(function (s) { if (s) out.push("  - [" + (s.completed ? "x" : " ") + "] " + mdLine(s.text)); });
        arr(c.info).forEach(function (f) {
          var l = [mdLine(f && f.label), mdLine(f && f.value)].filter(Boolean).join(": ");
          if (l) out.push("  - " + l);
        });
        var att = arr(c.att).map(function (x) { return x ? mdLine(x.name) : ""; }).filter(Boolean);
        if (att.length) out.push("  - " + (words.att || "Attachments") + ": " + att.join(", "));
        String(c.notes || "").replace(/\r\n?/g, "\n").split("\n").forEach(function (l) { if (l.trim()) out.push("  > " + l); });
        if (i === all.length - 1) out.push("");
      });
    });
    return out.join("\n");
  }

  // ---------- templates ----------
  function templateFromBoard(board, uid, now, name) {
    return rebuild(board, { uid: uid, now: now, name: name, id: "tpl-" + uid(), archived: true, untick: true, keepAtt: false, keepDue: false });
  }
  function boardFromTemplate(tpl, uid, now, name) {
    return rebuild(tpl, { uid: uid, now: now, name: name, untick: true, keepAtt: false, keepDue: false });
  }

  var C = { red: "#e06c75", yellow: "#ecc75f", green: "#87cf3e", cyan: "#4fc4cf",
            violet: "#6d4aff", pink: "#e09ecf", orange: "#f28c5a", gray: "#9aa4b0" };
  // Built-in templates: the shape here, the words in TPL (one key per
  // text, so a language pack can translate them; pack "kanban").
  var TPL = {
    en: {
      "tplb.personal.name": "Personal",
      "tplb.personal.desc": "Ideas, to do, this week and done, with a few life labels.",
      "tplb.personal.col.0": "Ideas",
      "tplb.personal.col.1": "To do",
      "tplb.personal.col.2": "This week",
      "tplb.personal.col.3": "Done",
      "tplb.personal.label.0": "Home",
      "tplb.personal.label.1": "Health",
      "tplb.personal.label.2": "Errands",
      "tplb.personal.label.3": "Fun",
      "tplb.personal.label.4": "Overdue",
      "tplb.personal.card.0": "Plan the week",
      "tplb.personal.card.0.sub.0": "Check the calendar",
      "tplb.personal.card.0.sub.1": "Pick three priorities",
      "tplb.sprint.name": "Software sprint",
      "tplb.sprint.desc": "Backlog to done with WIP limits, bug/feature labels and automations.",
      "tplb.sprint.col.0": "Backlog",
      "tplb.sprint.col.1": "To do",
      "tplb.sprint.col.2": "In progress",
      "tplb.sprint.col.3": "Review",
      "tplb.sprint.col.4": "Done",
      "tplb.sprint.label.0": "Bug",
      "tplb.sprint.label.1": "Feature",
      "tplb.sprint.label.2": "Chore",
      "tplb.sprint.label.3": "Urgent",
      "tplb.sprint.label.4": "Overdue",
      "tplb.sprint.card.0": "Write the sprint goal",
      "tplb.sprint.card.1": "Set up the release checklist",
      "tplb.sprint.card.1.sub.0": "Changelog",
      "tplb.sprint.card.1.sub.1": "Version number",
      "tplb.sprint.card.1.sub.2": "Tag the release",
      "tplb.content.name": "Content calendar",
      "tplb.content.desc": "Ideas to published, with a label per channel. Use the Timeline view for dates.",
      "tplb.content.col.0": "Ideas",
      "tplb.content.col.1": "Writing",
      "tplb.content.col.2": "Editing",
      "tplb.content.col.3": "Scheduled",
      "tplb.content.col.4": "Published",
      "tplb.content.label.0": "Blog",
      "tplb.content.label.1": "Video",
      "tplb.content.label.2": "Social",
      "tplb.content.label.3": "Newsletter",
      "tplb.content.label.4": "Overdue",
      "tplb.content.card.0": "Topic list for next month",
      "tplb.trip.name": "Trip",
      "tplb.trip.desc": "Book, pack and go, with a list for the documents and the money.",
      "tplb.trip.col.0": "Ideas",
      "tplb.trip.col.1": "To book",
      "tplb.trip.col.2": "To pack",
      "tplb.trip.col.3": "Ready",
      "tplb.trip.label.0": "Documents",
      "tplb.trip.label.1": "Bookings",
      "tplb.trip.label.2": "Money",
      "tplb.trip.label.3": "Overdue",
      "tplb.trip.card.0": "Book the tickets",
      "tplb.trip.card.0.sub.0": "Compare the prices",
      "tplb.trip.card.0.sub.1": "Check the dates",
      "tplb.trip.card.1": "Pack the bags",
      "tplb.trip.card.1.sub.0": "Clothes",
      "tplb.trip.card.1.sub.1": "Chargers",
      "tplb.trip.card.1.sub.2": "Passport or ID card",
      "tplb.trip.card.2": "Where and when?",
      "tplb.move.name": "Moving house",
      "tplb.move.desc": "Before, during and after the move: papers, packing and the bills.",
      "tplb.move.col.0": "Before the move",
      "tplb.move.col.1": "Moving week",
      "tplb.move.col.2": "After the move",
      "tplb.move.col.3": "Done",
      "tplb.move.label.0": "Papers",
      "tplb.move.label.1": "Packing",
      "tplb.move.label.2": "Bills",
      "tplb.move.label.3": "Overdue",
      "tplb.move.card.0": "Tell everyone the new address",
      "tplb.move.card.0.sub.0": "Bank",
      "tplb.move.card.0.sub.1": "Work",
      "tplb.move.card.0.sub.2": "Post office",
      "tplb.move.card.1": "Move the bills",
      "tplb.move.card.1.sub.0": "Electricity",
      "tplb.move.card.1.sub.1": "Water",
      "tplb.move.card.1.sub.2": "Internet",
      "tplb.move.card.2": "Pack room by room",
      "tplb.move.card.2.sub.0": "Kitchen",
      "tplb.move.card.2.sub.1": "Bedroom"
    },
    el: {
      "tplb.personal.name": "Προσωπικά",
      "tplb.personal.desc": "Ιδέες, εκκρεμότητες, αυτή την εβδομάδα και ολοκληρωμένα, με λίγες ετικέτες για την καθημερινότητα.",
      "tplb.personal.col.0": "Ιδέες",
      "tplb.personal.col.1": "Να γίνουν",
      "tplb.personal.col.2": "Αυτή την εβδομάδα",
      "tplb.personal.col.3": "Ολοκληρωμένα",
      "tplb.personal.label.0": "Σπίτι",
      "tplb.personal.label.1": "Υγεία",
      "tplb.personal.label.2": "Θελήματα",
      "tplb.personal.label.3": "Διασκέδαση",
      "tplb.personal.label.4": "Καθυστέρηση",
      "tplb.personal.card.0": "Πρόγραμμα της εβδομάδας",
      "tplb.personal.card.0.sub.0": "Έλεγχος ημερολογίου",
      "tplb.personal.card.0.sub.1": "Τρεις προτεραιότητες",
      "tplb.sprint.name": "Σπριντ λογισμικού",
      "tplb.sprint.desc": "Από το backlog ως το τέλος, με όρια WIP, ετικέτες σφάλμα/λειτουργία και αυτοματισμούς.",
      "tplb.sprint.col.0": "Backlog",
      "tplb.sprint.col.1": "Να γίνουν",
      "tplb.sprint.col.2": "Σε εξέλιξη",
      "tplb.sprint.col.3": "Έλεγχος",
      "tplb.sprint.col.4": "Ολοκληρωμένα",
      "tplb.sprint.label.0": "Σφάλμα",
      "tplb.sprint.label.1": "Λειτουργία",
      "tplb.sprint.label.2": "Συντήρηση",
      "tplb.sprint.label.3": "Επείγον",
      "tplb.sprint.label.4": "Καθυστέρηση",
      "tplb.sprint.card.0": "Στόχος του σπριντ",
      "tplb.sprint.card.1": "Λίστα ελέγχου έκδοσης",
      "tplb.sprint.card.1.sub.0": "Σημειώσεις αλλαγών",
      "tplb.sprint.card.1.sub.1": "Αριθμός έκδοσης",
      "tplb.sprint.card.1.sub.2": "Ετικέτα έκδοσης",
      "tplb.content.name": "Ημερολόγιο περιεχομένου",
      "tplb.content.desc": "Από την ιδέα ως τη δημοσίευση, με μια ετικέτα ανά κανάλι. Δες τις ημερομηνίες στο Χρονολόγιο.",
      "tplb.content.col.0": "Ιδέες",
      "tplb.content.col.1": "Γράψιμο",
      "tplb.content.col.2": "Επιμέλεια",
      "tplb.content.col.3": "Προγραμματισμένα",
      "tplb.content.col.4": "Δημοσιευμένα",
      "tplb.content.label.0": "Ιστολόγιο",
      "tplb.content.label.1": "Βίντεο",
      "tplb.content.label.2": "Κοινωνικά δίκτυα",
      "tplb.content.label.3": "Ενημερωτικό",
      "tplb.content.label.4": "Καθυστέρηση",
      "tplb.content.card.0": "Θέματα για τον επόμενο μήνα",
      "tplb.trip.name": "Ταξίδι",
      "tplb.trip.desc": "Κράτηση, βαλίτσες και φύγαμε, με μια λίστα για τα χαρτιά και τα χρήματα.",
      "tplb.trip.col.0": "Ιδέες",
      "tplb.trip.col.1": "Για κράτηση",
      "tplb.trip.col.2": "Για τη βαλίτσα",
      "tplb.trip.col.3": "Έτοιμα",
      "tplb.trip.label.0": "Χαρτιά",
      "tplb.trip.label.1": "Κρατήσεις",
      "tplb.trip.label.2": "Χρήματα",
      "tplb.trip.label.3": "Καθυστέρηση",
      "tplb.trip.card.0": "Κράτηση εισιτηρίων",
      "tplb.trip.card.0.sub.0": "Σύγκριση τιμών",
      "tplb.trip.card.0.sub.1": "Έλεγχος ημερομηνιών",
      "tplb.trip.card.1": "Βαλίτσες",
      "tplb.trip.card.1.sub.0": "Ρούχα",
      "tplb.trip.card.1.sub.1": "Φορτιστές",
      "tplb.trip.card.1.sub.2": "Διαβατήριο ή ταυτότητα",
      "tplb.trip.card.2": "Πού και πότε;",
      "tplb.move.name": "Μετακόμιση",
      "tplb.move.desc": "Πριν, κατά και μετά τη μετακόμιση: χαρτιά, πακετάρισμα και λογαριασμοί.",
      "tplb.move.col.0": "Πριν τη μετακόμιση",
      "tplb.move.col.1": "Εβδομάδα μετακόμισης",
      "tplb.move.col.2": "Μετά τη μετακόμιση",
      "tplb.move.col.3": "Έγιναν",
      "tplb.move.label.0": "Χαρτιά",
      "tplb.move.label.1": "Πακετάρισμα",
      "tplb.move.label.2": "Λογαριασμοί",
      "tplb.move.label.3": "Καθυστέρηση",
      "tplb.move.card.0": "Ενημέρωση για τη νέα διεύθυνση",
      "tplb.move.card.0.sub.0": "Τράπεζα",
      "tplb.move.card.0.sub.1": "Δουλειά",
      "tplb.move.card.0.sub.2": "Ταχυδρομείο",
      "tplb.move.card.1": "Μεταφορά λογαριασμών",
      "tplb.move.card.1.sub.0": "Ρεύμα",
      "tplb.move.card.1.sub.1": "Νερό",
      "tplb.move.card.1.sub.2": "Ίντερνετ",
      "tplb.move.card.2": "Πακετάρισμα δωμάτιο προς δωμάτιο",
      "tplb.move.card.2.sub.0": "Κουζίνα",
      "tplb.move.card.2.sub.1": "Υπνοδωμάτιο"
    }
  };
  var BUILTIN = {
    personal: {
      cols: 4, labels: [[C.cyan], [C.green], [C.yellow], [C.pink], [C.red, "overdue"]],
      cards: [[1, [0], 2]],   // [column, labels, subtasks]
      rules: { 3: { done: true } }, wip: { 2: 5 }
    },
    sprint: {
      cols: 5, labels: [[C.red], [C.cyan], [C.gray], [C.orange], [C.red, "overdue"]],
      cards: [[0, [2], 0], [1, [2], 3]],   // [column, labels, subtasks]
      rules: { 2: { top: true }, 4: { done: true } }, wip: { 2: 3, 3: 2 }
    },
    content: {
      cols: 5, labels: [[C.violet], [C.red], [C.cyan], [C.yellow], [C.red, "overdue"]],
      cards: [[0, [0], 0]],   // [column, labels, subtasks]
      rules: { 4: { today: true, done: true } }, wip: { 1: 3 }
    },
    trip: {
      cols: 4, labels: [[C.cyan], [C.violet], [C.green], [C.red, "overdue"]],
      cards: [[1, [1], 2], [2, [0], 3], [0, [], 0]],   // [column, labels, subtasks]
      rules: { 3: { done: true } }, wip: {}
    },
    move: {
      cols: 4, labels: [[C.cyan], [C.orange], [C.yellow], [C.red, "overdue"]],
      cards: [[0, [0], 3], [0, [2], 3], [1, [1], 2]],   // [column, labels, subtasks]
      rules: { 3: { done: true } }, wip: {}
    }
  };
  // The template words in a language: TPL[lang], built from the pack the
  // first time (orosI18n, in the app only), else English.
  function tplWords(lang) {
    var L = typeof lang === "string" && lang ? lang : "en";
    if (!TPL[L] && root && root.orosI18n) root.orosI18n.table(TPL, "kanban", L);
    return TPL[L] || TPL.en;
  }
  function builtinList(lang) {
    var W = tplWords(lang);
    return Object.keys(BUILTIN).map(function (k) { return { key: k, name: W["tplb." + k + ".name"], desc: W["tplb." + k + ".desc"] }; });
  }
  // A built-in as a board-shaped object (then boardFromTemplate).
  function builtinBoard(key, lang) {
    var B = BUILTIN[key];
    if (!B) return null;
    var W = tplWords(lang), pre = "tplb." + key + ".";
    var labels = B.labels.map(function (l, i) { var o = { id: "l" + i, name: W[pre + "label." + i], color: l[0] }; if (l[1]) o.auto = l[1]; return o; });
    var columns = [];
    for (var i = 0; i < B.cols; i++) {
      var c = { name: W[pre + "col." + i], cards: [] };
      if (B.wip[i]) c.wip = B.wip[i];
      if (B.rules[i]) c.auto = B.rules[i];
      columns.push(c);
    }
    B.cards.forEach(function (k, n) {
      var subs = [];
      for (var j = 0; j < k[2]; j++) subs.push({ text: W[pre + "card." + n + ".sub." + j], completed: false });
      columns[k[0]].cards.push({ text: W[pre + "card." + n], labels: k[1].map(function (x) { return "l" + x; }), subtasks: subs });
    });
    return { name: W[pre + "name"], labels: labels, columns: columns };
  }

  // Assistant entry card (BR-W8-6, prefill only): the shell's
  // { asNew: { board?, column?, title, note? (or description?), due?,
  // from? } } → the values the quick-add field is filled with, or null
  // without a title. One-line strings lose control characters and runs of
  // space; the note keeps its line breaks. due must be a real date.
  // Unknown fields are ignored; nothing here writes anything.
  function oneLine(v, n) {
    return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n) : "";
  }
  function asNew(x) {
    if (!x || typeof x !== "object") return null;
    var title = oneLine(x.title, MAX.text);
    if (!title) return null;
    var nt = typeof x.note === "string" ? x.note : x.description;
    var notes = typeof nt === "string"
      ? nt.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").trim().slice(0, MAX.notes) : "";
    var d = parseYmd(x.due);
    return {
      board: oneLine(x.board, MAX.name),
      column: oneLine(x.column, MAX.name),
      title: title,
      notes: notes,
      due: d && ymdOf(d) === x.due ? x.due : ""
    };
  }

  // "Send to an app" (BR-SEND, prefill only): the shell's { addCards: {
  // title?, cards: [{ title, notes? }] } } → { title, cards } with
  // clean one-line titles (≤ ADD_MAX cards), or null when no card has a
  // title. Nothing is written until the user presses Add.
  var ADD_MAX = 100;
  function asCards(x) {
    if (!x || typeof x !== "object" || !Array.isArray(x.cards)) return null;
    var cards = [];
    x.cards.forEach(function (c) {
      if (cards.length >= ADD_MAX || !c || typeof c !== "object") return;
      var title = oneLine(c.title, MAX.text);
      if (!title) return;
      var notes = typeof c.notes === "string"
        ? c.notes.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").trim().slice(0, MAX.notes) : "";
      cards.push({ title: title, notes: notes });
    });
    return cards.length ? { title: oneLine(x.title, MAX.name), cards: cards } : null;
  }

  // Every attachment file name any card of the state still points at.
  function usedFiles(state) {
    var used = {};
    arr(state && state.boards).forEach(function (b) {
      arr(b.columns).forEach(function (col) {
        arr(col.cards).forEach(function (c) { arr(c.att).forEach(function (x) { if (x && x.file) used[x.file] = true; }); });
      });
    });
    return used;
  }

  var api = {
    ATT_DIR: ATT_DIR, FILE_RE: FILE_RE, ymdOf: ymdOf, addDays: addDays, dueEndMs: dueEndMs, daysBetween: daysBetween,
    attPath: attPath, findCard: findCard,
    applyArrival: applyArrival, hasRules: hasRules, overdueLabel: overdueLabel, applyOverdue: applyOverdue,
    laneKey: laneKey, lanes: lanes,
    isWeekend: isWeekend, nextWorkday: nextWorkday, spanDays: spanDays, planSpan: planSpan, shiftSpan: shiftSpan,
    progressOf: progressOf, boardWorkdays: boardWorkdays,
    wouldCycle: wouldCycle, brokenDeps: brokenDeps, shiftAfter: shiftAfter, criticalPath: criticalPath, dayAfter: dayAfter, setLane: setLane, sortRows: sortRows, timelineRange: timelineRange,
    rebuild: rebuild, counter: counter, exportBoard: exportBoard, isExport: isExport, parseExport: parseExport,
    boardCsv: boardCsv, csvCell: csvCell, packBoard: packBoard, isPackage: isPackage, parsePackage: parsePackage, boardMd: boardMd,
    PKG_KIND: PKG_KIND, templateFromBoard: templateFromBoard, boardFromTemplate: boardFromTemplate,
    builtinList: builtinList, builtinBoard: builtinBoard, usedFiles: usedFiles, asNew: asNew,
    asCards: asCards, ADD_MAX: ADD_MAX
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root && root.document) root.OrosKanbanTools = api;
})(typeof window !== "undefined" ? window : globalThis);
