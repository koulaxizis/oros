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
//     (save a board as one, new board from one, built-ins EN/EL).
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

  // ---------- normalise + re-id (export import, templates, built-ins) ----------
  // src: a board-shaped object from anywhere (our export, a template).
  // opts: { uid, now, name, keepDue, keepAtt, untick, id, archived }
  // fileMap (out): old file name → new file name, for attachments.
  function rebuild(src, opts, fileMap) {
    var uid = opts.uid, now = opts.now;
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
          arr(c.att).map(function (x) { return x.name; }).join("; ")
        ].map(csvCell).join(","));
      });
    });
    return "﻿" + rows.join("\r\n") + "\r\n";
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
  var BUILTIN = {
    personal: {
      en: { name: "Personal", desc: "Ideas, to do, this week and done, with a few life labels.",
            cols: ["Ideas", "To do", "This week", "Done"], labels: [["Home", C.cyan], ["Health", C.green], ["Errands", C.yellow], ["Fun", C.pink], ["Overdue", C.red, "overdue"]],
            cards: [[1, "Plan the week", [0], ["Check the calendar", "Pick three priorities"]]] },
      el: { name: "Προσωπικά", desc: "Ιδέες, εκκρεμότητες, αυτή την εβδομάδα και ολοκληρωμένα, με λίγες ετικέτες για την καθημερινότητα.",
            cols: ["Ιδέες", "Να γίνουν", "Αυτή την εβδομάδα", "Ολοκληρωμένα"], labels: [["Σπίτι", C.cyan], ["Υγεία", C.green], ["Θελήματα", C.yellow], ["Διασκέδαση", C.pink], ["Καθυστέρηση", C.red, "overdue"]],
            cards: [[1, "Πρόγραμμα της εβδομάδας", [0], ["Έλεγχος ημερολογίου", "Τρεις προτεραιότητες"]]] },
      rules: { 3: { done: true } }, wip: { 2: 5 }
    },
    sprint: {
      en: { name: "Software sprint", desc: "Backlog to done with WIP limits, bug/feature labels and automations.",
            cols: ["Backlog", "To do", "In progress", "Review", "Done"], labels: [["Bug", C.red], ["Feature", C.cyan], ["Chore", C.gray], ["Urgent", C.orange], ["Overdue", C.red, "overdue"]],
            cards: [[0, "Write the sprint goal", [2], []], [1, "Set up the release checklist", [2], ["Changelog", "Version number", "Tag the release"]]] },
      el: { name: "Σπριντ λογισμικού", desc: "Από το backlog ως το τέλος, με όρια WIP, ετικέτες σφάλμα/λειτουργία και αυτοματισμούς.",
            cols: ["Backlog", "Να γίνουν", "Σε εξέλιξη", "Έλεγχος", "Ολοκληρωμένα"], labels: [["Σφάλμα", C.red], ["Λειτουργία", C.cyan], ["Συντήρηση", C.gray], ["Επείγον", C.orange], ["Καθυστέρηση", C.red, "overdue"]],
            cards: [[0, "Στόχος του σπριντ", [2], []], [1, "Λίστα ελέγχου έκδοσης", [2], ["Σημειώσεις αλλαγών", "Αριθμός έκδοσης", "Ετικέτα έκδοσης"]]] },
      rules: { 2: { top: true }, 4: { done: true } }, wip: { 2: 3, 3: 2 }
    },
    content: {
      en: { name: "Content calendar", desc: "Ideas to published, with a label per channel. Use the Timeline view for dates.",
            cols: ["Ideas", "Writing", "Editing", "Scheduled", "Published"], labels: [["Blog", C.violet], ["Video", C.red], ["Social", C.cyan], ["Newsletter", C.yellow], ["Overdue", C.red, "overdue"]],
            cards: [[0, "Topic list for next month", [0], []]] },
      el: { name: "Ημερολόγιο περιεχομένου", desc: "Από την ιδέα ως τη δημοσίευση, με μια ετικέτα ανά κανάλι. Δες τις ημερομηνίες στο Χρονολόγιο.",
            cols: ["Ιδέες", "Γράψιμο", "Επιμέλεια", "Προγραμματισμένα", "Δημοσιευμένα"], labels: [["Ιστολόγιο", C.violet], ["Βίντεο", C.red], ["Κοινωνικά δίκτυα", C.cyan], ["Ενημερωτικό", C.yellow], ["Καθυστέρηση", C.red, "overdue"]],
            cards: [[0, "Θέματα για τον επόμενο μήνα", [0], []]] },
      rules: { 4: { today: true, done: true } }, wip: { 1: 3 }
    }
  };
  function builtinList(lang) {
    var L = lang === "el" ? "el" : "en";
    return Object.keys(BUILTIN).map(function (k) { return { key: k, name: BUILTIN[k][L].name, desc: BUILTIN[k][L].desc }; });
  }
  // A built-in as a board-shaped object (then boardFromTemplate).
  function builtinBoard(key, lang) {
    var B = BUILTIN[key];
    if (!B) return null;
    var L = B[lang === "el" ? "el" : "en"];
    var labels = L.labels.map(function (l, i) { var o = { id: "l" + i, name: l[0], color: l[1] }; if (l[2]) o.auto = l[2]; return o; });
    var columns = L.cols.map(function (n, i) {
      var c = { name: n, cards: [] };
      if (B.wip[i]) c.wip = B.wip[i];
      if (B.rules[i]) c.auto = B.rules[i];
      return c;
    });
    L.cards.forEach(function (k) {
      columns[k[0]].cards.push({ text: k[1], labels: k[2].map(function (i) { return "l" + i; }),
                                 subtasks: k[3].map(function (s) { return { text: s, completed: false }; }) });
    });
    return { name: L.name, labels: labels, columns: columns };
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
    laneKey: laneKey, lanes: lanes, setLane: setLane, sortRows: sortRows, timelineRange: timelineRange,
    rebuild: rebuild, counter: counter, exportBoard: exportBoard, isExport: isExport, parseExport: parseExport,
    boardCsv: boardCsv, csvCell: csvCell, templateFromBoard: templateFromBoard, boardFromTemplate: boardFromTemplate,
    builtinList: builtinList, builtinBoard: builtinBoard, usedFiles: usedFiles
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root && root.document) root.OrosKanbanTools = api;
})(typeof window !== "undefined" ? window : globalThis);
