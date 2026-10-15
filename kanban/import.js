// ============================================================
// orOS Kanban — import.js ("Import from other apps", file sources)
// Reads a board or task list exported from another project tool and
// turns it into the Trello-export shape kanban.js already imports
//   { id, name, lists: [{ id, name, closed }],
//     cards: [{ id, name, desc, due, idList, idLabels, closed, info }],
//     labels: [{ id, name, color }],
//     checklists: [{ idCard, checkItems: [{ id, name, state }] }] }
// so every source lands through trelloAdapter and the same idempotent
// merge (importInto): a card already here is never moved or
// overwritten, a deleted one doesn't come back. `info` (extra fields
// such as Assignee or Priority) is the one key Trello has not.
// Pure: no DOM, no storage.
//
// Sources (detected from CSV headers or the JSON shape):
//   asana    project CSV (Task ID, Name, Section/Column, Completed At,
//            Parent task, Tags, Notes, Projects…) and the JSON export
//            ({ data: [{ gid, name, notes, completed, due_on,
//            memberships[].section, tags, subtasks }] }). Sections →
//            columns, completed → the "Done" column, subtasks (and
//            rows whose Parent task is in the file) → checklist items.
//   jira     issue CSV (Summary, Issue key, Issue id, Status, Labels
//            repeated…): Status → column (To Do … In Progress … Done
//            when known, else first appearance), "KEY-12 Summary".
//   clickup  CSV (Task ID, Task Name, Task Content, Status, Tags,
//            Checklists, Parent ID…): Status → column; subtasks and
//            checklist items → checklist.
//   wekan    board JSON (lists, cards with listId, labels, checklists,
//            checklistItems); archived lists and cards are skipped.
//   planka   board JSON as the Planka API answers it ({ item,
//            included: { lists, cards, labels, cardLabels, tasks } },
//            also taskLists in Planka 2) or the same keys flat.
// Ids are stable ("<src>-" + hash of the source's own ids), so the
// same file read again matches the same board, columns and cards;
// kanban.js prefixes them with "imp-t-" like any Trello board.
//
// parseText(text, fileName, names) → { source, exports: [board],
//   skipped, checks, from, to } | null
//   names = { done, none, untitled } (column names from the app's
//   language). from / to: earliest / latest due date ("" if none).
// UMD: window.OrosKanbanImport in the browser, module.exports in Node.
// ============================================================
(function (root) {
  "use strict";

  var NODE = typeof module !== "undefined" && module.exports && typeof require === "function";
  function kit() { return NODE ? require("../importkit.js") : root.OrosImportKit; }

  // Same caps as tools.js parseExport (an orOS board export).
  var MAX = { text: 500, notes: 20000, label: 40, info: 200, name: 120, cols: 60, cards: 5000, labels: 200, sub: 200, infoN: 12 };
  var MAX_TEXT = 40 * 1024 * 1024;     // characters read from one file

  function line(v, n) { return kit().clean(v, n); }
  function block(v, n) { return kit().cleanText(v, n); }
  function low(v) { return line(v, 200).toLowerCase(); }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function obj(v) { return v && typeof v === "object" && !Array.isArray(v) ? v : null; }
  function str(v) { return typeof v === "string" ? v : (typeof v === "number" && isFinite(v) ? String(v) : ""); }

  // "Project – March.csv" → "Project – March"
  function stem(fileName) {
    var s = String(fileName || "").replace(/^.*[\\\/]/, "").replace(/\.(csv|json|txt)$/i, "");
    return line(s.replace(/[_]+/g, " "), MAX.name);
  }
  // a due date "YYYY-MM-DD" or ""
  function day(v) {
    if (v && typeof v === "object" && v.$date != null) v = v.$date;   // WeKan (Mongo) dates
    if (typeof v === "number") return kit().ymd(v);
    var s = line(v, 80);
    if (!s) return "";
    var m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
    if (m) return kit().ymd(m[1]);
    // Jira: 12/Mar/24 10:00 AM
    m = /^(\d{1,2})\/([A-Za-z]{3,9})\/(\d{2}|\d{4})\b/.exec(s);
    if (m) s = m[1] + " " + m[2] + " " + (m[3].length === 2 ? "20" + m[3] : m[3]);
    else s = s.replace(/^(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}),?\s.*$/, "$1")
              .replace(/(\d)(st|nd|rd|th)\b/, "$1");
    return kit().ymd(s);
  }
  // "[a, b]" / "a, b" / "a;b" → ["a", "b"]
  function list(v) {
    var s = line(v, 4000).replace(/^\[|\]$/g, "");
    if (!s) return [];
    return s.split(/\s*[,;]\s*/).map(function (x) { return line(x.replace(/^["']|["']$/g, ""), MAX.label); })
      .filter(function (x) { return !!x; });
  }
  // the most frequent non-empty value, or ""
  function common(values) {
    var n = {}, best = "", bestN = 0;
    values.forEach(function (v) {
      v = line(v, MAX.name);
      if (!v) return;
      n[v] = (n[v] || 0) + 1;
      if (n[v] > bestN) { best = v; bestN = n[v]; }
    });
    return best;
  }

  // Workflow order of well-known status names; unknown ones sit
  // between "in review" and "done", in the order they first appear.
  function statusRank(name) {
    var s = low(name);
    if (/^(backlog|icebox|ideas?)$/.test(s)) return 0;
    if (/^(to ?do|todo|open|new|selected for development|ready|planned|not started|reopened)$/.test(s)) return 1;
    if (/^(in progress|doing|in development|active|started|working on it)$/.test(s)) return 3;
    if (/^(blocked|on hold|waiting)$/.test(s)) return 3.5;
    if (/^(in review|review|code review|testing|in testing|qa|in qa|ready for review|ready for qa)$/.test(s)) return 4;
    if (/^(done|closed|resolved|complete|completed|finished|shipped|released|cancell?ed|won'?t do|won't fix)$/.test(s)) return 9;
    return 5;
  }

  // Label colour names → the Trello names trelloAdapter knows.
  function colorName(c) {
    var s = low(c);
    var keys = ["blue", "cyan", "sky", "green", "lime", "yellow", "orange", "red", "purple", "pink", "black", "gray"];
    for (var i = 0; i < keys.length; i++) if (s.indexOf(keys[i]) !== -1) return keys[i];
    if (/navy|indigo|slate|turquoise|lagoon|ocean|midnight|sea/.test(s)) return "blue";
    if (/gold|sun|egg|light-mud|peach/.test(s)) return "yellow";
    if (/crimson|berry|rust|tank|coral/.test(s)) return "red";
    if (/plum|magenta|violet|lilac|lavender|bright-moss/.test(s)) return "purple";
    if (/grey|silver|brown|desert|wet|muddy/.test(s)) return "gray";
    if (/pumpkin|apricot|orange/.test(s)) return "orange";
    if (/moss|forest|darkgreen|antique/.test(s)) return "green";
    return "";
  }

  // ---------- the Trello-shaped board under construction ----------
  function Board(src, key, name) {
    this.src = src;
    this.key = src + "|" + key;
    this.id = src + "-" + kit().hash(this.key);
    this.name = line(name, MAX.name) || "Board";
    this.cols = [];  this.colBy = {};
    this.labels = []; this.labelBy = {};
    this.cards = []; this.cardBy = {};
    this.checks = {};
    this.skipped = 0;
    this.nChecks = 0;
  }
  Board.prototype.hid = function (kind, k) { return this.src + "-" + kit().hash(this.key + "|" + kind + "|" + k); };
  // a column by name (rank: optional sort key), "" when over the cap
  Board.prototype.col = function (name, rank) {
    name = line(name, MAX.name) || "—";
    var k = name.toLowerCase();
    if (this.colBy[k]) return this.colBy[k].id;
    if (this.cols.length >= MAX.cols) return "";
    var c = { id: this.hid("col", k), name: name, closed: false, rank: rank || 0, at: this.cols.length };
    this.colBy[k] = c;
    this.cols.push(c);
    return c.id;
  };
  Board.prototype.dropEmpty = function (name) {
    var c = this.colBy[line(name, MAX.name).toLowerCase()];
    if (c) c.drop = true;
  };
  Board.prototype.label = function (name, color) {
    name = line(name, MAX.label);
    if (!name) return "";
    var k = name.toLowerCase();
    if (this.labelBy[k]) return this.labelBy[k];
    if (this.labels.length >= MAX.labels) return "";
    var id = this.hid("lb", k);
    this.labels.push({ id: id, name: name, color: colorName(color) });
    this.labelBy[k] = id;
    return id;
  };
  // o: { key, name, desc, due, col (id), labels: [names] | [ids if o.lids], info: [[label, value]] }
  Board.prototype.card = function (o) {
    var name = line(o.name, MAX.text);
    if (!name || !o.col) { this.skipped++; return null; }
    if (this.cards.length >= MAX.cards) { this.skipped++; return null; }
    var key = str(o.key) || name;
    if (this.cardBy[key]) { this.skipped++; return null; }        // the same task twice
    var self = this, ids = [];
    arr(o.labels).forEach(function (l) {
      var id = o.lids ? l : self.label(l);
      if (id && ids.indexOf(id) === -1) ids.push(id);
    });
    var info = [];
    arr(o.info).forEach(function (f) {
      var l = line(f[0], MAX.info), v = line(f[1], MAX.info);
      if (l && v && info.length < MAX.infoN) info.push({ label: l, value: v });
    });
    var c = { id: this.hid("card", key), name: name, desc: block(o.desc, MAX.notes),
              due: day(o.due) || null, idList: o.col, idLabels: ids, closed: false, info: info };
    this.cards.push(c);
    this.cardBy[key] = c;
    return c;
  };
  Board.prototype.check = function (card, name, done, k) {
    name = line(name, MAX.text);
    if (!card || !name) return;
    var l = this.checks[card.id] = this.checks[card.id] || [];
    if (l.length >= MAX.sub) return;
    l.push({ id: card.id + "-" + kit().hash((k == null ? l.length : k) + "|" + name), name: name,
             state: done ? "complete" : "incomplete" });
    this.nChecks++;
  };
  Board.prototype.done = function (sortCols) {
    var self = this;
    var cols = this.cols.slice();
    if (sortCols) cols.sort(function (a, b) { return a.rank - b.rank || a.at - b.at; });
    var used = {};
    this.cards.forEach(function (c) { used[c.idList] = true; });
    return {
      id: this.id, name: this.name,
      lists: cols.filter(function (c) { return used[c.id] || !c.drop; })
        .map(function (c) { return { id: c.id, name: c.name, closed: false }; }),
      cards: this.cards,
      labels: this.labels,
      checklists: Object.keys(this.checks).map(function (id) { return { idCard: id, checkItems: self.checks[id] }; })
    };
  };

  function result(source, boards) {
    boards = boards.filter(function (b) { return b && b.cards.length + b.cols.length > 0; });
    if (!boards.length) return null;
    var from = "", to = "", skipped = 0, checks = 0;
    var ex = boards.map(function (b) {
      skipped += b.skipped;
      checks += b.nChecks;
      var e = b.done(b.sortCols);
      e.cards.forEach(function (c) {
        if (!c.due) return;
        if (!from || c.due < from) from = c.due;
        if (!to || c.due > to) to = c.due;
      });
      return e;
    });
    return { source: source, exports: ex, skipped: skipped, checks: checks, from: from, to: to };
  }

  // ---------- Asana ----------
  function asanaCsv(rec, fileName, names) {
    var G = kit().get;
    var rows = rec.rows;
    var proj = common(rows.filter(function (r) { return !line(G(r, ["Parent task", "Parent Task"]), 10); })
      .map(function (r) { return G(r, ["Projects", "Project"]); }));
    var title = proj || stem(fileName) || "Asana";
    var b = new Board("as", low(title), title);
    var byId = {}, byName = {}, subs = [];
    var doneName = names.done || "Done";
    rows.forEach(function (r) {
      var name = G(r, ["Name", "Task Name", "Task"]);
      if (!line(name, 10)) { b.skipped++; return; }
      if (line(G(r, ["Parent task", "Parent Task", "Parent"]), 10)) { subs.push(r); return; }
      b.col(G(r, ["Section/Column", "Section", "Column"]) || names.none || "—");
    });
    b.col(doneName);           // the Done column comes after the sections
    rows.forEach(function (r) {
      var name = G(r, ["Name", "Task Name", "Task"]);
      if (!line(name, 10) || subs.indexOf(r) !== -1) return;
      var completed = !!line(G(r, ["Completed At", "Completed"]), 40);
      var tid = line(G(r, ["Task ID", "ID"]), 60);
      var info = [];
      [["Assignee", ["Assignee"]], ["Start Date", ["Start Date", "Start On"]], ["Blocked By", ["Blocked By (Dependencies)", "Blocked By"]],
       ["Completed At", ["Completed At"]]].forEach(function (f) {
        var v = G(r, f[1]);
        if (/date|at$/i.test(f[0])) v = day(v) || v;
        info.push([f[0], v]);
      });
      var c = b.card({
        key: tid || name, name: name, desc: G(r, ["Notes", "Description"]),
        due: G(r, ["Due Date", "Due On", "Due"]),
        col: completed ? b.col(doneName) : b.col(G(r, ["Section/Column", "Section", "Column"]) || names.none || "—"),
        labels: list(G(r, ["Tags", "Tag"])), info: info
      });
      if (!c) return;
      if (tid) byId[tid] = c;
      if (!byName[low(name)]) byName[low(name)] = c;
    });
    subs.forEach(function (r) {
      var p = line(G(r, ["Parent task", "Parent Task", "Parent"]), 500);
      var parent = byId[p] || byName[p.toLowerCase()];
      var name = G(r, ["Name", "Task Name", "Task"]);
      var completed = !!line(G(r, ["Completed At", "Completed"]), 40);
      if (parent) b.check(parent, name, completed, line(G(r, ["Task ID"]), 60) || name);
      else {                    // a subtask whose parent is not in the file → a card of its own
        b.card({ key: line(G(r, ["Task ID"]), 60) || name, name: name, desc: G(r, ["Notes"]), due: G(r, ["Due Date"]),
                 col: completed ? b.col(doneName) : b.col(G(r, ["Section/Column"]) || names.none || "—"),
                 labels: list(G(r, ["Tags"])) });
      }
    });
    b.dropEmpty(doneName);       // an empty Done column is left out
    return result("asana", [b]);
  }

  function asanaJson(data, fileName, names) {
    var tasks = arr(Array.isArray(data) ? data : data.data).filter(obj);
    var projects = [];
    tasks.forEach(function (t) {
      arr(t.memberships).concat(arr(t.projects).map(function (p) { return { project: p }; })).forEach(function (m) {
        var p = obj(m) && obj(m.project);
        if (p && (p.name || p.gid)) projects.push(str(p.gid) + " /// " + str(p.name));
      });
    });
    var top = common(projects).split(" /// ");
    var title = line(top[1], MAX.name) || stem(fileName) || "Asana";
    var b = new Board("as", top[0] ? "gid:" + top[0] : low(title), title);
    var doneName = names.done || "Done";
    var byGid = {}, kids = [];
    function section(t) {
      var s = "";
      arr(t.memberships).forEach(function (m) {
        var sec = obj(m) && obj(m.section);
        var p = obj(m) && obj(m.project);
        if (!s && sec && (!top[0] || !p || str(p.gid) === top[0])) s = str(sec.name);
      });
      return line(s, MAX.name) || names.none || "—";
    }
    tasks.forEach(function (t) { if (!(obj(t.parent) && str(t.parent.gid))) b.col(section(t)); });
    b.col(doneName);
    tasks.forEach(function (t) {
      if (obj(t.parent) && str(t.parent.gid)) { kids.push(t); return; }
      var info = [];
      if (obj(t.assignee)) info.push(["Assignee", t.assignee.name]);
      info.push(["Start Date", day(t.start_on)]);
      if (t.completed) info.push(["Completed At", day(t.completed_at)]);
      var c = b.card({
        key: str(t.gid) || str(t.name), name: t.name, desc: t.notes,
        due: t.due_on || t.due_at, col: t.completed ? b.col(doneName) : b.col(section(t)),
        labels: arr(t.tags).map(function (g) { return obj(g) ? g.name : g; }), info: info
      });
      if (!c) return;
      if (str(t.gid)) byGid[str(t.gid)] = c;
      arr(t.subtasks).forEach(function (s, i) {
        if (obj(s)) b.check(c, s.name, !!s.completed, str(s.gid) || i);
        else if (typeof s === "string") b.check(c, s, false, i);
      });
    });
    kids.forEach(function (t) {
      var parent = byGid[str(t.parent.gid)];
      if (parent) {
        var dup = (b.checks[parent.id] || []).some(function (x) { return x.name === line(t.name, MAX.text); });
        if (!dup) b.check(parent, t.name, !!t.completed, str(t.gid));
      } else {
        b.card({ key: str(t.gid) || str(t.name), name: t.name, desc: t.notes, due: t.due_on || t.due_at,
                 col: t.completed ? b.col(doneName) : b.col(section(t)),
                 labels: arr(t.tags).map(function (g) { return obj(g) ? g.name : g; }) });
      }
    });
    b.dropEmpty(doneName);
    return result("asana", [b]);
  }

  // ---------- Jira ----------
  function jiraCsv(t, fileName) {
    var K = kit(), head = t.head;
    function idx(names) { return K.col(head, names); }
    function all(name) {        // every column with this header (Labels, Sprint repeat)
      var out = [], n = K.norm(name);
      head.forEach(function (h, i) { if (K.norm(h) === n) out.push(i); });
      return out;
    }
    var iSum = idx(["Summary"]), iKey = idx(["Issue key", "Key"]), iId = idx(["Issue id", "Issue ID"]);
    var iStatus = idx(["Status"]), iDesc = idx(["Description"]), iDue = idx(["Due Date", "Due date", "Due"]);
    var iPName = idx(["Project name"]), iPKey = idx(["Project key"]);
    var iLabels = all("Labels"), iSprint = all("Sprint");
    var extra = [["Issue Type", ["Issue Type", "Issuetype"]], ["Priority", ["Priority"]], ["Assignee", ["Assignee"]],
                 ["Reporter", ["Reporter"]], ["Parent", ["Parent summary", "Parent Summary", "Parent"]],
                 ["Resolution", ["Resolution"]]].map(function (f) { return [f[0], idx(f[1])]; });
    function v(r, i) { return i === -1 || r[i] == null ? "" : r[i]; }
    var pk = common(t.rows.map(function (r) { return v(r, iPKey); }));
    var pn = common(t.rows.map(function (r) { return v(r, iPName); }));
    var keys = {};
    t.rows.forEach(function (r) { var k = line(v(r, iPKey), 40); if (k) keys[k] = 1; });
    var single = Object.keys(keys).length <= 1;
    var title = (single && pn) || stem(fileName) || "Jira";
    var b = new Board("jira", single && pk ? "key:" + pk.toLowerCase() : low(title), title);
    b.sortCols = true;
    t.rows.forEach(function (r) {
      var sum = line(v(r, iSum), MAX.text), key = line(v(r, iKey), 40);
      if (!sum && !key) { b.skipped++; return; }
      var status = line(v(r, iStatus), MAX.name) || "—";
      var labels = [];
      iLabels.forEach(function (i) { list(v(r, i)).forEach(function (l) { labels.push(l); }); });
      var sprints = iSprint.map(function (i) { return line(v(r, i), 80); }).filter(Boolean);
      var info = extra.map(function (f) { return [f[0], v(r, f[1])]; });
      info.push(["Sprint", sprints.join(", ")]);
      b.card({ key: line(v(r, iId), 40) || key || sum, name: (key ? key + " " : "") + sum, desc: v(r, iDesc),
               due: v(r, iDue), col: b.col(status, statusRank(status)), labels: labels, info: info });
    });
    return result("jira", [b]);
  }

  // ---------- ClickUp ----------
  // Checklists cell: JSON ({ "Checklist": [{ name, resolved }] } or a
  // list), else one item per line / ";".
  function clickupChecks(v) {
    var s = block(v, 20000), out = [];
    if (!s) return out;
    var j = kit().json(s);
    function walk(x, depth) {
      if (depth > 4 || out.length >= MAX.sub) return;
      if (Array.isArray(x)) { x.forEach(function (y) { walk(y, depth + 1); }); return; }
      if (typeof x === "string") { if (line(x, 10)) out.push({ name: x, done: false }); return; }
      var o = obj(x);
      if (!o) return;
      var nm = o.name || o.title || o.text;
      if (typeof nm === "string" && !Array.isArray(o.items)) {
        out.push({ name: nm, done: o.resolved === true || o.checked === true || o.completed === true || o.done === true });
        return;
      }
      if (Array.isArray(o.items)) { walk(o.items, depth + 1); return; }
      Object.keys(o).forEach(function (k) { walk(o[k], depth + 1); });
    }
    if (j !== null && typeof j === "object") walk(j, 0);
    else s.replace(/^\[|\]$/g, "").split(/\n|;/).forEach(function (x) {
      var m = /^\s*(?:[-*•]\s*)?(?:\[( |x|X)\]\s*)?(.+?)\s*$/.exec(x);
      if (m && line(m[2], 10)) out.push({ name: m[2], done: !!m[1] && m[1] !== " " });
    });
    return out;
  }
  function clickupCsv(rec, fileName) {
    var G = kit().get, rows = rec.rows;
    function lists(k) { var n = {}; rows.forEach(function (r) { var v = line(G(r, k), MAX.name); if (v) n[v] = 1; }); return Object.keys(n); }
    var ls = lists(["List Name", "List"]), fs = lists(["Folder Name", "Folder"]), ss = lists(["Space Name", "Space"]);
    var title = ls.length === 1 ? ls[0] : fs.length === 1 ? fs[0] : ss.length === 1 ? ss[0] : (stem(fileName) || "ClickUp");
    var keyBy = ls.length === 1 ? "list:" : fs.length === 1 ? "folder:" : ss.length === 1 ? "space:" : "file:";
    var b = new Board("cu", keyBy + low(title), title);
    b.sortCols = true;
    var byId = {}, kids = [];
    rows.forEach(function (r) {
      var name = G(r, ["Task Name", "Name"]);
      if (!line(name, 10)) { b.skipped++; return; }
      var tid = line(G(r, ["Task ID", "ID"]), 60);
      var parent = line(G(r, ["Parent ID", "Parent Task ID", "Parent"]), 60);
      if (parent) { kids.push(r); return; }
      var status = line(G(r, ["Status"]), MAX.name) || "—";
      var info = [["Assignees", list(G(r, ["Assignees", "Assignee"])).join(", ")],
                  ["Priority", G(r, ["Priority"])],
                  ["Start Date", day(G(r, ["Start Date"])) || day(G(r, ["Start Date Text"]))]];
      if (ls.length > 1) info.push(["List", G(r, ["List Name", "List"])]);
      var c = b.card({ key: tid || name, name: name, desc: G(r, ["Task Content", "Content", "Description"]),
                       due: day(G(r, ["Due Date"])) || day(G(r, ["Due Date Text"])),
                       col: b.col(status, statusRank(status)), labels: list(G(r, ["Tags", "Tag"])), info: info });
      if (!c) return;
      if (tid) byId[tid] = c;
      clickupChecks(G(r, ["Checklists", "Checklist"])).forEach(function (it, i) { b.check(c, it.name, it.done, i + "|" + it.name); });
    });
    kids.forEach(function (r) {
      var parent = byId[line(G(r, ["Parent ID", "Parent Task ID", "Parent"]), 60)];
      var name = G(r, ["Task Name", "Name"]), status = line(G(r, ["Status"]), MAX.name) || "—";
      if (parent) b.check(parent, name, statusRank(status) === 9, line(G(r, ["Task ID"]), 60) || name);
      else b.card({ key: line(G(r, ["Task ID"]), 60) || name, name: name, desc: G(r, ["Task Content"]),
                    due: day(G(r, ["Due Date"])), col: b.col(status, statusRank(status)), labels: list(G(r, ["Tags"])) });
    });
    return result("clickup", [b]);
  }

  // ---------- WeKan ----------
  function wekanJson(data, fileName) {
    var title = line(data.title || data.name, MAX.name) || stem(fileName) || "WeKan";
    var b = new Board("wk", str(data._id) ? "id:" + str(data._id) : low(title), title);
    var lblBy = {};
    arr(data.labels).forEach(function (l) {
      if (!obj(l) || !str(l._id)) return;
      var nm = line(l.name, MAX.label) || line(l.color, MAX.label);
      if (nm) lblBy[str(l._id)] = b.label(nm, l.color);
    });
    var colBy = {};
    arr(data.lists).filter(obj).slice().sort(function (x, y) { return (+x.sort || 0) - (+y.sort || 0); }).forEach(function (l) {
      if (l.archived) { b.skipped++; return; }
      var id = b.col(l.title);
      if (id && str(l._id)) colBy[str(l._id)] = id;
    });
    var cardBy = {};
    arr(data.cards).filter(obj).slice().sort(function (x, y) { return (+x.sort || 0) - (+y.sort || 0); }).forEach(function (c) {
      var col = colBy[str(c.listId)];
      if (c.archived || !col) { b.skipped++; return; }
      var nc = b.card({ key: str(c._id) || str(c.title), name: c.title, desc: c.description, due: c.dueAt || c.endAt,
                        col: col, lids: true, labels: arr(c.labelIds).map(function (x) { return lblBy[str(x)]; }),
                        info: [["Start Date", day(c.startAt)]] });
      if (nc && str(c._id)) cardBy[str(c._id)] = nc;
    });
    var clSort = {};
    arr(data.checklists).filter(obj).forEach(function (cl) { clSort[str(cl._id)] = +cl.sort || 0; });
    arr(data.checklistItems).filter(obj).slice().sort(function (x, y) {
      return (clSort[str(x.checklistId)] || 0) - (clSort[str(y.checklistId)] || 0) || (+x.sort || 0) - (+y.sort || 0);
    }).forEach(function (it) {
      b.check(cardBy[str(it.cardId)], it.title, !!it.isFinished, str(it._id) || it.title);
    });
    return result("wekan", [b]);
  }

  // ---------- Planka ----------
  function plankaJson(data, fileName) {
    var inc = obj(data.included) || data;
    var bd = obj(data.item) || obj(data.board) || {};
    var title = line(bd.name, MAX.name) || stem(fileName) || "Planka";
    var b = new Board("pk", str(bd.id) ? "id:" + str(bd.id) : low(title), title);
    function pos(x, y) { return (+x.position || 0) - (+y.position || 0); }
    var lblBy = {};
    arr(inc.labels).filter(obj).forEach(function (l) {
      var nm = line(l.name, MAX.label) || line(l.color, MAX.label);
      if (nm && str(l.id)) lblBy[str(l.id)] = b.label(nm, l.color);
    });
    var colBy = {};
    arr(inc.lists).filter(obj).slice().sort(pos).forEach(function (l) {
      if (/^(archive|trash)$/.test(str(l.type))) { b.skipped++; return; }
      var id = b.col(l.name || (l.type === "closed" ? "Closed" : ""));
      if (id && str(l.id)) colBy[str(l.id)] = id;
    });
    var cl = {};
    arr(inc.cardLabels).filter(obj).forEach(function (x) { (cl[str(x.cardId)] = cl[str(x.cardId)] || []).push(lblBy[str(x.labelId)]); });
    var cardBy = {};
    arr(inc.cards).filter(obj).slice().sort(pos).forEach(function (c) {
      var col = colBy[str(c.listId)];
      if (!col) { b.skipped++; return; }
      var nc = b.card({ key: str(c.id) || str(c.name), name: c.name, desc: c.description, due: c.dueDate,
                        col: col, lids: true, labels: cl[str(c.id)] || [] });
      if (nc && str(c.id)) cardBy[str(c.id)] = nc;
    });
    var tlCard = {};
    arr(inc.taskLists).filter(obj).forEach(function (t) { tlCard[str(t.id)] = str(t.cardId); });
    arr(inc.tasks).filter(obj).slice().sort(pos).forEach(function (t) {
      var cid = str(t.cardId) || tlCard[str(t.taskListId)];
      b.check(cardBy[cid], t.name, !!t.isCompleted, str(t.id) || t.name);
    });
    return result("planka", [b]);
  }

  // ---------- detection ----------
  function isWekan(d) {
    var l = arr(d.lists), c = arr(d.cards);
    return (l.length || c.length) && (/^wekan/i.test(str(d._format)) ||
      (l.length && obj(l[0]) && str(l[0]._id) !== "") || (c.length && obj(c[0]) && str(c[0].listId) !== "" && str(c[0]._id) !== ""));
  }
  function isPlanka(d) {
    var inc = obj(d.included);
    if (inc && Array.isArray(inc.lists) && Array.isArray(inc.cards)) return true;
    return !!(obj(d.board) && Array.isArray(d.lists) && Array.isArray(d.cards) &&
              (!d.cards.length || (obj(d.cards[0]) && "listId" in d.cards[0])));
  }
  function isAsana(d) {
    var tasks = Array.isArray(d) ? d : obj(d) && Array.isArray(d.data) ? d.data : null;
    if (!tasks || !tasks.length) return false;
    var t = obj(tasks[0]);
    return !!t && "name" in t && ("gid" in t || "memberships" in t || ("completed" in t && "notes" in t));
  }

  function parseJson(data, fileName, names) {
    if (Array.isArray(data)) return isAsana(data) ? asanaJson(data, fileName, names) : null;
    if (!obj(data)) return null;
    if (isPlanka(data)) return plankaJson(data, fileName);
    if (isWekan(data)) return wekanJson(data, fileName);
    if (isAsana(data)) return asanaJson(data, fileName, names);
    return null;
  }

  var CSV_SIGS = [
    { id: "jira", need: [["Issue key"], ["Summary"]] },
    { id: "clickup", need: [["Task ID"], ["Task Name"]] },
    { id: "asana", need: [["Name"], ["Section/Column", "Section"]] },
    { id: "asana", need: [["Name"], ["Completed At"], ["Projects", "Parent task"]] }
  ];
  function parseCsv(text, fileName, names) {
    var K = kit();
    var t = K.csv(text, { maxRows: MAX.cards * 4 });
    var id = K.detect(t.head, CSV_SIGS);
    if (!id || !t.rows.length) return null;
    if (id === "jira") return jiraCsv(t, fileName);
    var rec = K.records(text, { maxRows: MAX.cards * 4, delim: t.delim });
    return id === "clickup" ? clickupCsv(rec, fileName) : asanaCsv(rec, fileName, names);
  }

  function parseText(text, fileName, names) {
    names = names || {};
    text = String(text == null ? "" : text);
    if (text.length > MAX_TEXT) return null;
    var s = text.replace(/^﻿/, "").trim();
    if (!s) return null;
    if (s[0] === "{" || s[0] === "[") {
      var j = kit().json(s);
      if (j !== null) return parseJson(j, fileName, names);
    }
    return parseCsv(s, fileName, names);
  }

  var API = { parseText: parseText, parseJson: parseJson, statusRank: statusRank, MAX: MAX };
  if (NODE) module.exports = API;
  else root.OrosKanbanImport = API;
})(typeof self !== "undefined" ? self : this);
