// ============================================================
// orOS To-Do — import a file from another task app (todo/import.js)
// The file twin of platforms.js (Todoist / GitHub accounts) and
// gtasks.js (Google sign-in): it reads an export file, makes a plan of
// the same shape and hands it to todo.js's importApply, so the one
// write, the toast and its Undo are the same for every import.
//
// Sources (detected from zip entries, JSON shape, CSV headers, text):
//   todoist   Todoist project CSV (template export: TYPE, CONTENT,
//             DESCRIPTION, PRIORITY, INDENT, … DATE …) or the backup
//             ZIP of such CSVs, one per project ("Name [id].csv").
//             project → list · task → task · INDENT 2+ → subtask of
//             the task above · note → added to its task's notes ·
//             section → "Section" extra info · @label in CONTENT →
//             labels · PRIORITY 1–4 → P1–P4 · DATE → due date when it
//             is a date (any other text, e.g. "every monday", goes
//             into the notes).
//   ticktick  TickTick backup CSV (a few "Date:/Version:/Status:"
//             lines before the header row). List Name → list ·
//             Title → task · Content → notes, its "▫ / ▪" checklist
//             lines → subtasks (open / ticked) · Tags → labels ·
//             Due Date (or Start Date) → due · Priority 5/3/1 → P1/2/3
//             · Status 0 open, anything else ticked · parentId →
//             subtask · Column Name → "Section".
//   gtasks    Google Takeout Tasks.json (bare or inside the Takeout
//             ZIP): mapped by gtasks.js's own plan, so the ids are the
//             ones its sign-in import gives — either way finds the other.
//   todotxt   todo.txt / done.txt: "x" → ticked, (A)/(B)/(C) or pri:X
//             → P1/P2/P3, first +project → list (more → labels),
//             @context → labels, due:YYYY-MM-DD → due, other key:value
//             → notes. No +project → a list named after the file.
//   ics       iCalendar VTODO: SUMMARY, DESCRIPTION, DUE, STATUS /
//             COMPLETED → ticked (CANCELLED skipped), PRIORITY 1–4 →
//             P1, 5 → P2, 6–9 → P3, RELATED-TO → subtask, CATEGORIES →
//             labels; list from X-WR-CALNAME or the file name.
//   rtm       Remember The Milk JSON backup: lists, tasks (list_id,
//             name, date_due, date_completed, priority P1–P3, tags,
//             parent_id), notes → notes; trashed tasks skipped.
//
// Merge (plan): ids "imp-" + hash(source | key) from the source's own
// ids (or, without one, list + text + place): importing the same file
// again adds only what is missing; a task deleted here stays deleted;
// a new open task whose text is already open in its list is skipped; a
// list of the same name here is used. Nothing here is overwritten.
//
// Pure: parse({ name, bytes }) → Promise<parsed | null>,
//       parseText(text, name) → parsed | null,
//       plan(state, parsed, ctx) → importApply's plan.
// Browser: OrosTodoImport.init({ lang, data, apply }), .open() — call
// open() inside the click (the file picker opens there).
// UMD: window.OrosTodoImport in the browser, module.exports in Node.
// ============================================================
(function (root) {
  "use strict";

  var NODE = typeof module !== "undefined" && module.exports && typeof require === "function";
  function kit() { return NODE ? require("../importkit.js") : root.OrosImportKit; }
  function gtasks() { try { return NODE ? require("./gtasks.js") : root.OrosTodoGtasks || null; } catch (e) { return null; } }

  var MAX_FILE = 30 * 1024 * 1024;   // the picked file
  var MAX_ENTRY = 30 * 1024 * 1024;  // inflated bytes per zip entry
  var MAX_ZIP_CSV = 300;             // project CSVs read from a zip
  var MAX_TASKS = 10000, MAX_LISTS = 300, MAX_NEW_LABELS = 200, MAX_TAGS = 20;
  var TEXT_LEN = 500, NOTE_LEN = 5000, NAME_LEN = 60, SUB_MAX = 100, SUB_TEXT = 300, TAG_LEN = 24;
  var YMD = /^\d{4}-\d{2}-\d{2}$/;
  var ACCEPT = ".csv,.zip,.json,.txt,.ics,.ical,.ifb,text/csv,application/zip,application/json,text/plain,text/calendar";
  var SOURCES = ["todoist", "ticktick", "gtasks", "todotxt", "ics", "rtm"];

  // ---------- small helpers ----------
  function line(v, n) { return kit().clean(v, n); }
  function block(v, n) {
    var s = kit().cleanText(v == null ? "" : String(v));
    s = s.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim();
    return n && s.length > n ? s.slice(0, n).trim() : s;
  }
  function key(s) { return String(s || "").toLowerCase().replace(/\s+/g, " ").trim(); }
  function baseName(name) {
    var b = String(name || "").split(/[\\\/]/).pop().replace(/\.[a-z0-9]{1,5}$/i, "");
    return line(b, NAME_LEN);
  }
  function ymdOf(v) { var d = kit().ymd(v); return YMD.test(d) ? d : ""; }
  function addTag(arr, name) {
    var s = line(String(name || "").replace(/^[#@+]+/, ""), TAG_LEN);
    if (!s || arr.length >= MAX_TAGS) return;
    for (var i = 0; i < arr.length; i++) if (key(arr[i]) === key(s)) return;
    arr.push(s);
  }
  function joinNotes(a, b) { return a && b ? a + "\n\n" + b : (a || b || ""); }

  // A task as every reader gives it (before the plan):
  //   { key, text, notes, due, done, prio 1..4, tags [], parent: key,
  //     section, rec, subs: [{ text, done }] (checklist lines) }
  function task(o) {
    return {
      key: String(o.key), text: line(o.text, TEXT_LEN), notes: block(o.notes, NOTE_LEN),
      due: YMD.test(o.due || "") ? o.due : "", done: !!o.done, prio: o.prio >= 1 && o.prio <= 3 ? o.prio : 4,
      tags: o.tags || [], parent: o.parent ? String(o.parent) : "", section: line(o.section, NAME_LEN),
      rec: !!o.rec, subs: o.subs || []
    };
  }
  // lists in the order first seen: { key → { key, name, tasks } }
  function Lists() {
    var order = [], by = {}, n = 0;
    return {
      get: function (name) {
        var nm = line(name, NAME_LEN) || "Imported", k = key(nm);
        if (!by[k]) {
          if (order.length >= MAX_LISTS) return null;
          by[k] = { key: k, name: nm, tasks: [] };
          order.push(by[k]);
        }
        return by[k];
      },
      push: function (l, t) { if (!l || n >= MAX_TASKS) return false; l.tasks.push(t); n++; return true; },
      out: function () { return order.filter(function (l) { return l.tasks.length; }); },
      full: function () { return n >= MAX_TASKS; }
    };
  }
  function result(source, L, extra) {
    var r = { source: source, lists: L.out(), capped: L.full(), skipped: 0 };
    if (extra) Object.keys(extra).forEach(function (k) { r[k] = extra[k]; });
    var n = 0;
    r.lists.forEach(function (l) { n += l.tasks.length; });
    return n ? r : null;
  }

  // ---------- Todoist CSV ----------
  var TD_TYPE = ["TYPE"], TD_CONTENT = ["CONTENT"];
  function isTodoistHead(head) { var K = kit(); return K.col(head, TD_TYPE) >= 0 && K.col(head, TD_CONTENT) >= 0; }
  function todoistName(fileName) {
    var b = String(fileName || "").split(/[\\\/]/).pop().replace(/\.csv$/i, "");
    b = b.replace(/\s*\[\d+\]\s*$/, "").replace(/\s*\(\d+\)\s*$/, "");
    return line(b, NAME_LEN) || "Todoist";
  }
  // one project file → tasks into list l (shared counters in st)
  function readTodoist(text, fileName, L, st) {
    var K = kit(), t = K.records(text);
    if (!isTodoistHead(t.head)) return false;
    var l = L.get(todoistName(fileName)), stack = [], section = "", last = null, occ = {};
    t.rows.forEach(function (r) {
      var type = key(K.get(r, TD_TYPE)), content = String(K.get(r, TD_CONTENT) || "");
      if (type === "section") { section = line(content, NAME_LEN); stack = []; last = null; return; }
      if (type === "note") {
        if (last) last.notes = block(joinNotes(last.notes, content), NOTE_LEN);
        return;
      }
      if (type !== "task") return;
      // @labels inside the content (not e-mail addresses)
      var tags = [];
      var text = content.replace(/(^|\s)@([^\s@,]+)/g, function (m, sp, name) { addTag(tags, name); return sp; });
      text = line(text, TEXT_LEN);
      var ind = parseInt(K.get(r, ["INDENT"]), 10);
      if (!(ind >= 1)) ind = 1;
      stack.length = Math.min(stack.length, ind - 1);
      var parent = stack.length ? stack[stack.length - 1] : null;
      var pr = parseInt(K.get(r, ["PRIORITY"]), 10);
      var dateText = line(K.get(r, ["DATE"]), 120), due = ymdOf(dateText), notes = String(K.get(r, ["DESCRIPTION"]) || "");
      var rec = /\b(every|each|daily|weekly|monthly|yearly|κάθε)\b/i.test(dateText);
      if (dateText && !due) notes = joinNotes(notes, "Todoist: " + dateText);
      if (rec) st.rec++;
      var base = l.key + "|" + (parent ? parent.key : "") + "|" + key(text);
      occ[base] = (occ[base] || 0) + 1;
      var tk = task({ key: base + "#" + occ[base], text: text, notes: notes, due: due, prio: pr >= 1 && pr <= 3 ? pr : 4,
                      tags: tags, parent: parent ? parent.key : "", section: section, rec: rec });
      if (!L.push(l, tk)) return;
      stack[ind - 1] = tk;
      stack.length = ind;
      last = tk;
    });
    return true;
  }

  // ---------- TickTick backup CSV ----------
  function tickTickBody(text) {
    // the header row is the first line that names Title and List Name
    var lines = text.split(/\r?\n/), i;
    for (i = 0; i < Math.min(lines.length, 30); i++) {
      if (/"?List Name"?/i.test(lines[i]) && /"?Title"?/i.test(lines[i])) return lines.slice(i).join("\n");
    }
    return "";
  }
  function readTickTick(text) {
    var K = kit(), body = tickTickBody(text);
    if (!body) return null;
    var t = K.records(body), L = Lists(), st = { rec: 0 };
    t.rows.forEach(function (r) {
      var title = K.get(r, ["Title"]);
      var l = L.get(K.get(r, ["List Name"]) || "TickTick");
      var content = String(K.get(r, ["Content"]) || ""), subs = [], rest = [];
      // checklist lines: "▫item" open, "▪item" ticked
      content.replace(/\r\n?/g, "\n").split("\n").forEach(function (ln) {
        var m = /^\s*([▫▪])\s*(.*)$/.exec(ln);
        if (m) { if (line(m[2], SUB_TEXT)) subs.push({ text: line(m[2], SUB_TEXT), done: m[1] === "▪" }); }
        else rest.push(ln);
      });
      var tags = [];
      String(K.get(r, ["Tags"]) || "").split(/[,;]/).forEach(function (s) { addTag(tags, s); });
      var status = String(K.get(r, ["Status"]) || "0").trim();
      var pr = parseInt(K.get(r, ["Priority"]), 10);
      var rec = !!line(K.get(r, ["Repeat"]), 200);
      if (rec) st.rec++;
      var id = line(K.get(r, ["taskId", "Task Id"]), 80);
      L.push(l, task({
        key: id || l.key + "|" + key(title) + "|" + line(K.get(r, ["Created Time"]), 40),
        text: title, notes: rest.join("\n"), subs: subs,
        due: ymdOf(K.get(r, ["Due Date"])) || ymdOf(K.get(r, ["Start Date"])),
        done: status !== "" && status !== "0", prio: pr === 5 ? 1 : pr === 3 ? 2 : pr === 1 ? 3 : 4,
        tags: tags, parent: line(K.get(r, ["parentId", "Parent Id"]), 80), section: K.get(r, ["Column Name"]), rec: rec
      }));
    });
    return result("ticktick", L, { rec: st.rec });
  }

  // ---------- Google Takeout Tasks.json ----------
  function isTakeout(o) {
    return !!o && typeof o === "object" && Array.isArray(o.items) &&
      (o.kind === "tasks#taskLists" || o.items.some(function (x) { return x && Array.isArray(x.items) && (x.kind === "tasks#taskList" || x.title !== undefined); }));
  }
  function readTakeout(o) {
    // the shape gtasks.js reads from the API: { lists, tasks: { id: [] } }
    var got = { lists: [], tasks: {} }, n = 0, lists = [];
    o.items.forEach(function (gl, i) {
      if (!gl || typeof gl !== "object" || got.lists.length >= MAX_LISTS) return;
      var id = typeof gl.id === "string" && gl.id && gl.id.length <= 200 ? gl.id : "title:" + key(gl.title) + "#" + i;
      var arr = [];
      (Array.isArray(gl.items) ? gl.items : []).forEach(function (t) {
        if (!t || typeof t !== "object" || n >= MAX_TASKS) return;
        if (typeof t.id !== "string" || !t.id) return;
        arr.push(t);
        n++;
      });
      got.lists.push({ id: id, title: typeof gl.title === "string" ? gl.title : "" });
      got.tasks[id] = arr;
      lists.push({ key: id, name: line(gl.title, NAME_LEN) || "Google Tasks", tasks: arr });
    });
    return n ? { source: "gtasks", lists: lists, got: got, capped: n >= MAX_TASKS, skipped: 0 } : null;
  }

  // ---------- Remember The Milk JSON ----------
  function isRtm(o) {
    return !!o && typeof o === "object" && Array.isArray(o.tasks) && Array.isArray(o.lists) &&
      o.tasks.some(function (t) { return t && (t.list_id !== undefined || t.series_id !== undefined); });
  }
  function readRtm(o) {
    var L = Lists(), names = {}, notes = {}, st = { rec: 0 }, skipped = 0;
    o.lists.forEach(function (l) { if (l && l.id != null) names[String(l.id)] = l.name; });
    (Array.isArray(o.notes) ? o.notes : []).forEach(function (n) {
      if (!n) return;
      var k = String(n.series_id || n.task_series_id || n.taskseries_id || n.task_id || "");
      if (!k) return;
      var txt = [line(n.title, 200), block(n.content || n.text, 2000)].filter(Boolean).join("\n");
      if (txt) notes[k] = joinNotes(notes[k] || "", txt);
    });
    o.tasks.forEach(function (t) {
      if (!t || typeof t !== "object" || t.id == null) return;
      if (t.date_trashed || t.date_deleted || t.deleted === true) { skipped++; return; }
      var l = L.get(names[String(t.list_id)] || "Remember The Milk");
      var p = String(t.priority == null ? "" : t.priority).replace(/^p/i, "");
      var rec = !!(t.repeat || t.repeat_every || t.recurrence);
      if (rec) st.rec++;
      var tags = [];
      (Array.isArray(t.tags) ? t.tags : typeof t.tags === "string" ? t.tags.split(/[,\s]+/) : []).forEach(function (s) { addTag(tags, s); });
      var nt = notes[String(t.series_id || "")] || notes[String(t.id)] || "";
      if (t.url) nt = joinNotes(nt, line(t.url, 500));
      L.push(l, task({
        key: String(t.id), text: t.name, notes: nt, due: t.date_due ? ymdOf(t.date_due) : "",
        done: !!t.date_completed, prio: p === "1" ? 1 : p === "2" ? 2 : p === "3" ? 3 : 4,
        tags: tags, parent: t.parent_id != null ? String(t.parent_id) : "", rec: rec
      }));
    });
    return result("rtm", L, { rec: st.rec, skipped: skipped });
  }

  // ---------- todo.txt ----------
  var TT_DATE = /^\d{4}-\d{2}-\d{2}$/;
  function readTodoTxt(text, fileName) {
    var L = Lists(), fallback = /^done$/i.test(baseName(fileName)) || !baseName(fileName) ? "todo.txt" : baseName(fileName);
    var occ = {}, st = { rec: 0 };
    text.replace(/\r\n?/g, "\n").split("\n").forEach(function (raw) {
      var s = raw.trim();
      if (!s) return;
      var w = s.split(/\s+/), done = false, prio = 4, i = 0;
      if (w[0] === "x") { done = true; i++; if (TT_DATE.test(w[i] || "")) i++; }
      var m = /^\(([A-Z])\)$/.exec(w[i] || "");
      if (m) { prio = m[1] === "A" ? 1 : m[1] === "B" ? 2 : 3; i++; }
      if (TT_DATE.test(w[i] || "")) i++;               // creation date
      var words = [], tags = [], project = "", extra = [], due = "", rec = false;
      w.slice(i).forEach(function (tok) {
        if (/^\+\S/.test(tok)) { if (!project) project = tok.slice(1).replace(/[_]/g, " "); else addTag(tags, tok.slice(1)); return; }
        if (/^@\S/.test(tok)) { addTag(tags, tok.slice(1)); return; }
        var kv = /^([A-Za-z][\w-]*):([^\s:]+)$/.exec(tok);
        if (kv && kv[2].slice(0, 2) !== "//") {
          var k = kv[1].toLowerCase();
          if (k === "due" && TT_DATE.test(kv[2])) { due = ymdOf(kv[2]); return; }
          if (k === "pri" && /^[A-Z]$/.test(kv[2])) { prio = kv[2] === "A" ? 1 : kv[2] === "B" ? 2 : 3; return; }
          if (k === "rec") rec = true;
          extra.push(tok);
          return;
        }
        words.push(tok);
      });
      var body = line(words.join(" "), TEXT_LEN);
      if (!body) return;
      if (rec) st.rec++;
      var l = L.get(project || fallback);
      var base = l.key + "|" + key(body);
      occ[base] = (occ[base] || 0) + 1;
      L.push(l, task({ key: base + "#" + occ[base], text: body, notes: extra.join("\n"), due: due, done: done, prio: prio, tags: tags, rec: rec }));
    });
    return result("todotxt", L, { rec: st.rec });
  }
  function looksTodoTxt(text) {
    var lines = text.split(/\r?\n/).filter(function (s) { return s.trim(); }).slice(0, 50);
    if (!lines.length) return false;
    var hits = lines.filter(function (s) { return /^(x \d{4}-|\([A-Z]\) )|(^|\s)[+@]\S|(^|\s)due:\d{4}-/.test(s); }).length;
    return hits * 2 >= lines.length;
  }

  // ---------- iCalendar VTODO ----------
  function unfold(text) { return String(text).replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n"); }
  function icsProp(ln) {
    // NAME;PARAM=V;PARAM="V":value — the colon after the params (outside quotes)
    var q = false, i;
    for (i = 0; i < ln.length; i++) {
      var c = ln.charAt(i);
      if (c === '"') q = !q;
      else if (c === ":" && !q) break;
    }
    if (i >= ln.length) return null;
    var head = ln.slice(0, i).split(";"), params = {};
    head.slice(1).forEach(function (p) { var e = p.indexOf("="); if (e > 0) params[p.slice(0, e).toUpperCase()] = p.slice(e + 1).replace(/^"|"$/g, ""); });
    return { name: head[0].toUpperCase(), params: params, value: ln.slice(i + 1) };
  }
  function icsText(v) {
    return String(v || "").replace(/\\([\\;,nN])/g, function (m, c) { return c === "n" || c === "N" ? "\n" : c; });
  }
  // "a,b\\,c" → ["a", "b\\,c"] (an escaped comma stays inside a value)
  function splitList(v) {
    var out = [], cur = "";
    for (var i = 0; i < v.length; i++) {
      var ch = v.charAt(i);
      if (ch === "\\" && i + 1 < v.length) { cur += ch + v.charAt(++i); continue; }
      if (ch === ",") { out.push(cur); cur = ""; continue; }
      cur += ch;
    }
    out.push(cur);
    return out;
  }
  function icsDate(v) {
    var m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/.exec(String(v || "").trim());
    if (!m) return "";
    if (m[7]) return ymdOf(m[1] + "-" + m[2] + "-" + m[3] + "T" + m[4] + ":" + m[5] + ":" + (m[6] || "00") + "Z");
    return ymdOf(m[1] + "-" + m[2] + "-" + m[3]);
  }
  function readIcs(text, fileName) {
    var lines = unfold(text), cal = "", todos = [], cur = null, depth = 0, skipped = 0, st = { rec: 0 };
    lines.forEach(function (ln) {
      var u = ln.trim().toUpperCase();
      if (u === "BEGIN:VTODO") { cur = { props: [] }; depth = 0; return; }
      if (u === "END:VTODO") { if (cur) todos.push(cur); cur = null; return; }
      if (cur) {
        if (/^BEGIN:/.test(u)) { depth++; return; }       // VALARM inside
        if (/^END:/.test(u)) { depth--; return; }
        if (depth === 0 && todos.length < MAX_TASKS) { var p = icsProp(ln); if (p) cur.props.push(p); }
        return;
      }
      if (/^X-WR-CALNAME[:;]/i.test(ln) && !cal) { var c = icsProp(ln); if (c) cal = icsText(c.value); }
    });
    if (!todos.length) return null;
    var L = Lists(), l = L.get(cal || baseName(fileName) || "Calendar"), n = 0;
    todos.forEach(function (b) {
      var o = { tags: [] }, status = "";
      b.props.forEach(function (p) {
        if (p.name === "UID") o.uid = line(p.value, 300);
        else if (p.name === "SUMMARY") o.text = icsText(p.value);
        else if (p.name === "DESCRIPTION") o.notes = icsText(p.value);
        else if (p.name === "DUE") o.due = icsDate(p.value);
        else if (p.name === "DTSTART" && !o.start) o.start = icsDate(p.value);
        else if (p.name === "STATUS") status = p.value.trim().toUpperCase();
        else if (p.name === "COMPLETED") o.done = true;
        else if (p.name === "PRIORITY") o.pri = parseInt(p.value, 10);
        else if (p.name === "RRULE") o.rec = true;
        else if (p.name === "URL") o.url = line(p.value, 500);
        else if (p.name === "RELATED-TO" && (!p.params.RELTYPE || p.params.RELTYPE.toUpperCase() === "PARENT")) o.parent = line(p.value, 300);
        else if (p.name === "CATEGORIES") splitList(p.value).forEach(function (c) { addTag(o.tags, icsText(c)); });
      });
      if (status === "CANCELLED") { skipped++; return; }
      if (status === "COMPLETED") o.done = true;
      if (o.rec) st.rec++;
      var pr = o.pri >= 1 && o.pri <= 4 ? 1 : o.pri === 5 ? 2 : o.pri >= 6 && o.pri <= 9 ? 3 : 4;
      n++;
      L.push(l, task({
        key: o.uid || "n" + n + "|" + key(o.text), text: icsText(o.text), notes: o.url ? joinNotes(o.notes, o.url) : o.notes,
        due: o.due || "", done: o.done, prio: pr, tags: o.tags, parent: o.parent, rec: o.rec
      }));
    });
    return result("ics", L, { rec: st.rec, skipped: skipped });
  }

  // ---------- detection ----------
  // text + file name → parsed | null (CSV, JSON, todo.txt, ics)
  function parseText(text, name) {
    var K = kit(), s = String(text == null ? "" : text).replace(/^﻿/, "");
    var low = String(name || "").toLowerCase();
    if (!s.trim()) return null;
    if (/^\s*BEGIN:VCALENDAR/i.test(s) || /BEGIN:VTODO/i.test(s.slice(0, 200000))) return readIcs(s, name);
    if (/^\s*[\[{]/.test(s)) {
      var o = K.json(s);
      if (isTakeout(o)) return readTakeout(o);
      if (isRtm(o)) return readRtm(o);
      return null;
    }
    var first = s.slice(0, 4000);
    if (/"?List Name"?/i.test(first) && /"?Title"?/i.test(first) && /"?Kind"?/i.test(first)) return readTickTick(s);
    var head = K.csv(s.split(/\r?\n/).slice(0, 1).join("\n")).head;
    if (isTodoistHead(head)) {
      var L = Lists(), st = { rec: 0 };
      readTodoist(s, name, L, st);
      return result("todoist", L, { rec: st.rec });
    }
    if (/\.txt$/.test(low) || looksTodoTxt(s)) return readTodoTxt(s, name);
    return null;
  }
  // input: { name, bytes: Uint8Array } (importkit.readFile) or a string
  function parse(input) {
    var K = kit();
    try {
      if (typeof input === "string") return Promise.resolve(parseText(input, ""));
      var bytes = input && input.bytes, name = String((input && input.name) || "");
      if (!bytes) return Promise.resolve(null);
      if (!K.isZip(bytes)) return Promise.resolve(parseText(K.text(bytes), name));
      var z = K.unzip(bytes);
      var usable = z.names.filter(function (n) { return !/(^|\/)(__macosx\/|\.)/i.test(n); });
      // Google Takeout: Tasks/Tasks.json
      var gt = usable.filter(function (n) { return /(^|\/)tasks\.json$/i.test(n); })[0];
      if (gt) return z.text(gt, MAX_ENTRY).then(function (txt) { return txt ? parseText(txt, gt) : null; });
      var csvs = usable.filter(function (n) { return /\.csv$/i.test(n); }).slice(0, MAX_ZIP_CSV);
      if (csvs.length) {
        // Todoist backup: one project CSV per entry
        var L = Lists(), st = { rec: 0 }, any = false, other = null, chain = Promise.resolve();
        csvs.forEach(function (n) {
          chain = chain.then(function () {
            if (L.full()) return;
            return z.text(n, MAX_ENTRY).then(function (txt) {
              if (!txt) return;
              if (readTodoist(txt.replace(/^﻿/, ""), n, L, st)) any = true;
              else if (!other) other = parseText(txt, n.split("/").pop());
            });
          });
        });
        return chain.then(function () { return any ? result("todoist", L, { rec: st.rec }) : other; });
      }
      // another zip: the first file inside that reads as tasks
      var cands = usable.filter(function (n) { return /\.(json|txt|ics)$/i.test(n); }).slice(0, 20), res = null, ch = Promise.resolve();
      cands.forEach(function (n) {
        ch = ch.then(function () {
          if (res) return;
          return z.text(n, MAX_ENTRY).then(function (txt) { res = txt ? parseText(txt, n.split("/").pop()) : null; });
        });
      });
      return ch.then(function () { return res; }, function () { return null; });
    } catch (e) {
      return Promise.resolve(null);
    }
  }

  // ---------- the plan (importApply's shape) ----------
  function idOf(source, kind, k) { return "imp-" + kit().hash("todo|" + source + "|" + kind + "|" + k); }
  function empty() {
    return {
      lists: { add: [], upd: [] }, labels: { add: [] }, items: { add: [], upd: [] },
      same: 0, here: 0, gone: 0, rec: 0, sub: 0, done: 0, untitled: 0, per: {}, from: "", to: ""
    };
  }
  function range(out) {
    out.items.add.forEach(function (x) {
      if (!x.due) return;
      if (!out.from || x.due < out.from) out.from = x.due;
      if (!out.to || x.due > out.to) out.to = x.due;
    });
    return out;
  }

  // Google Takeout through gtasks.js's mapper (+ what was deleted here stays deleted)
  function planTakeout(st, parsed, ctx) {
    var G = gtasks();
    if (!G) return empty();
    var p = G.plan(st, parsed.got, { done: !!ctx.done, pick: ctx.pick });
    var deleted = st && st.deleted && typeof st.deleted === "object" ? st.deleted : {};
    var out = empty();
    Object.keys(p).forEach(function (k) { out[k] = p[k]; });
    out.gone = 0;
    out.items.add = p.items.add.filter(function (x) {
      if (!Object.prototype.hasOwnProperty.call(deleted, x.id)) return true;
      out.gone++;
      if (x.done) out.done--;
      out.sub -= (x.subs || []).length;
      return false;
    });
    var used = {};
    out.items.add.forEach(function (x) { used[x.list] = 1; });
    out.lists.add = p.lists.add.filter(function (l) { return used[l.id]; });
    return range(out);
  }

  // st: To-Do's state { lists, labels, deleted }
  // parsed: parse()'s result
  // ctx: { done: include ticked tasks, pick: { listKey: true } (absent = all), section: label of the info field }
  function plan(st, parsed, ctx) {
    ctx = ctx || {};
    if (!parsed) return empty();
    if (parsed.source === "gtasks") return planTakeout(st, parsed, ctx);
    var source = parsed.source, out = empty();
    var lists = st && Array.isArray(st.lists) ? st.lists : [];
    var labels = st && Array.isArray(st.labels) ? st.labels : [];
    var deleted = st && st.deleted && typeof st.deleted === "object" ? st.deleted : {};
    function gone(id) { return Object.prototype.hasOwnProperty.call(deleted, id); }
    var listById = {}, listByName = {}, itemIds = {};
    lists.forEach(function (l) {
      if (!l || typeof l.id !== "string") return;
      listById[l.id] = l;
      var k = key(l.name);
      if (k && !listByName[k]) listByName[k] = l;
      (Array.isArray(l.items) ? l.items : []).forEach(function (it) { if (it && typeof it.id === "string") itemIds[it.id] = 1; });
    });
    var labelByKey = {};
    labels.forEach(function (lb) { if (lb && typeof lb.id === "string" && typeof lb.name === "string" && !labelByKey[key(lb.name)]) labelByKey[key(lb.name)] = lb.id; });
    function labelId(name) {
      var k = key(name);
      if (!k) return "";
      if (labelByKey[k] !== undefined) return labelByKey[k];
      var id = "imp-" + kit().hash("todo|label|" + k);
      if (gone(id) || out.labels.add.length >= MAX_NEW_LABELS) { labelByKey[k] = ""; return ""; }
      labelByKey[k] = id;
      out.labels.add.push({ id: id, name: name });
      return id;
    }

    parsed.lists.forEach(function (pl) {
      var per = out.per[pl.key] = { name: pl.name, add: 0, same: 0 };
      // the tasks to bring (ticked ones only with ctx.done), each under its top ancestor
      var byKey = {};
      pl.tasks.forEach(function (t) { if ((ctx.done || !t.done) && !byKey[t.key]) byKey[t.key] = t; });
      function rootOf(t) {
        var seen = {}, c = t;
        while (c.parent && byKey[c.parent] && !seen[c.parent] && c.parent !== c.key) { seen[c.key] = 1; c = byKey[c.parent]; }
        return c;
      }
      var top = [], kids = {};
      pl.tasks.forEach(function (t) {
        if (byKey[t.key] !== t) return;
        var r = rootOf(t);
        if (r === t) top.push(t);
        else (kids[r.key] = kids[r.key] || []).push(t);
      });
      if (ctx.pick && !ctx.pick[pl.key]) {
        top.forEach(function (t) { if (itemIds[idOf(source, "task", t.key)]) per.same++; else per.add++; });
        return;
      }
      var list = listByName[key(pl.name)] || listById[idOf(source, "list", pl.key)] || null;
      var lid = list ? list.id : idOf(source, "list", pl.key);
      var openText = {}, adds = [];
      if (list) (list.items || []).forEach(function (it) { if (it && !it.done) openText[key(it.text)] = 1; });
      top.forEach(function (t) {
        var id = idOf(source, "task", t.key);
        if (itemIds[id]) { out.same++; per.same++; return; }
        if (gone(id)) { out.gone++; return; }
        if (!t.text) { out.untitled++; return; }
        if (!t.done && openText[key(t.text)]) { out.here++; return; }
        if (!t.done) openText[key(t.text)] = 1;
        var notes = t.notes, extra = [], subs = [];
        function room() { return subs.length < SUB_MAX; }
        // checklist lines (TickTick) first, then child tasks
        t.subs.forEach(function (s, i) {
          if (room()) subs.push({ id: idOf(source, "sub", t.key + "|c" + i), text: s.text, done: !!s.done });
          else extra.push("↳ " + s.text);
        });
        (kids[t.key] || []).forEach(function (s) {
          var stext = line(s.text, SUB_TEXT);
          if (!stext) { out.untitled++; return; }
          var ok = room();
          if (ok) subs.push({ id: idOf(source, "sub", s.key), text: stext, done: s.done });
          // what a subtask here cannot hold goes into the task's notes
          if (s.notes || s.due || !ok) extra.push("↳ " + stext + (s.due ? " (" + s.due + ")" : "") + (s.notes ? ": " + s.notes : ""));
        });
        if (extra.length) notes = block(joinNotes(notes, extra.join("\n")), NOTE_LEN);
        var ids = [];
        t.tags.forEach(function (n) { var x = labelId(n); if (x && ids.indexOf(x) < 0) ids.push(x); });
        var info = t.section ? [{ id: idOf(source, "info", t.key), label: ctx.section || "Section", value: t.section }] : [];
        out.sub += subs.length;
        if (t.done) out.done++;
        if (t.rec) out.rec++;
        adds.push({ list: lid, id: id, text: t.text, notes: notes, due: t.due || null, labels: ids, info: info,
                    prio: t.prio, done: t.done, subs: subs });
        per.add++;
      });
      if (!adds.length) return;
      if (!list) out.lists.add.push({ id: lid, name: pl.name });
      out.items.add = out.items.add.concat(adds);
    });
    // labels only skipped tasks wanted stay out
    var used = {};
    out.items.add.forEach(function (a) { a.labels.forEach(function (id) { used[id] = 1; }); });
    out.labels.add = out.labels.add.filter(function (lb) { return used[lb.id]; });
    return range(out);
  }

  // ---------- dialog (browser) ----------
  var S = {
    en: {
      btn: "Import a file…", title: "Import a file",
      intro: "Bring tasks from a file another app exported: Todoist (project CSV or backup ZIP), TickTick (backup CSV), Google Tasks (Takeout), todo.txt, iCalendar to-dos (.ics) or Remember The Milk (JSON backup). Nothing is sent anywhere.",
      reading: "Reading the file…",
      found: "Found: {s} · {n} task(s) in {l} list(s)",
      pick: "Lists to import", row: "{a} new · {s} already here", withDone: "Include completed tasks (ticked)",
      plan: "{l} new list(s), {a} new task(s), {d} of them completed, {s} subtask(s) · {same} already here",
      dates: "Due dates from {a} to {b}.",
      here: "{n} already open here with the same text: skipped.",
      gone: "{n} deleted here earlier: not brought back.",
      untitled: "{n} without a title: skipped.",
      rec: "{n} repeating tasks come in once, with their date only; set Repeat here if you want it.",
      cancelled: "{n} cancelled or deleted in the file: skipped.",
      capped: "The file has more tasks than To-Do reads at once; only the first {n} were read.",
      nothing: "Nothing new: To-Do already has these tasks.",
      "map.todoist": "Each project becomes a list; indented tasks become subtasks, comments go into the notes, @labels become labels and sections go into the task's extra info.",
      "map.ticktick": "Each list becomes a list; checklist items become subtasks, tags become labels and the priority comes along.",
      "map.gtasks": "Each Google list becomes a list; subtasks become subtasks, ticked tasks stay ticked.",
      "map.todotxt": "The first +project of a line becomes its list, @contexts become labels, (A)–(C) the priority and due: the due date.",
      "map.ics": "Each to-do becomes a task in a list named after the calendar; categories become labels.",
      "map.rtm": "Each list becomes a list; tags become labels, notes go into the task's notes and subtasks become subtasks.",
      section: "Section",
      "err.unknown": "This file doesn't look like an export To-Do can read.",
      "err.big": "This file is too big to import.",
      "err.read": "Couldn't read this file.",
      go: "Import", done: "Imported from {s}: {a} new", cancel: "Cancel", close: "Close"
    },
    el: {
      btn: "Εισαγωγή αρχείου…", title: "Εισαγωγή αρχείου",
      intro: "Φέρε εργασίες από ένα αρχείο εξαγωγής άλλης εφαρμογής: Todoist (CSV έργου ή ZIP αντιγράφου ασφαλείας), TickTick (CSV αντιγράφου), Google Tasks (Takeout), todo.txt, εκκρεμότητες iCalendar (.ics) ή Remember The Milk (αντίγραφο JSON). Δεν στέλνεται τίποτα πουθενά.",
      reading: "Ανάγνωση αρχείου…",
      found: "Βρέθηκαν: {s} · {n} εργασία/ες σε {l} λίστα/ες",
      pick: "Λίστες για εισαγωγή", row: "{a} νέες · {s} υπάρχουν ήδη", withDone: "Μαζί με τις ολοκληρωμένες εργασίες (με τικ)",
      plan: "{l} νέα/ες λίστα/ες, {a} νέα/ες εργασία/ες, από αυτές {d} ολοκληρωμένη/ες, {s} υποεργασία/ες · {same} υπάρχουν ήδη",
      dates: "Προθεσμίες από {a} έως {b}.",
      here: "{n} είναι ήδη ανοιχτές εδώ με το ίδιο κείμενο: παραλείπονται.",
      gone: "{n} διαγράφηκαν εδώ παλιότερα: δεν επανέρχονται.",
      untitled: "{n} χωρίς τίτλο: παραλείπονται.",
      rec: "{n} επαναλαμβανόμενες εργασίες έρχονται μία φορά, μόνο με την ημερομηνία τους· βάλε Επανάληψη εδώ αν τη θέλεις.",
      cancelled: "{n} ακυρωμένες ή διαγραμμένες στο αρχείο: παραλείπονται.",
      capped: "Το αρχείο έχει περισσότερες εργασίες απ' όσες διαβάζει το To-Do με τη μία· διαβάστηκαν μόνο οι πρώτες {n}.",
      nothing: "Τίποτα νέο: το To-Do έχει ήδη αυτές τις εργασίες.",
      "map.todoist": "Κάθε έργο γίνεται λίστα· οι εργασίες σε εσοχή γίνονται υποεργασίες, τα σχόλια πάνε στις σημειώσεις, οι @ετικέτες γίνονται ετικέτες και οι ενότητες μπαίνουν στις επιπλέον πληροφορίες της εργασίας.",
      "map.ticktick": "Κάθε λίστα γίνεται λίστα· τα στοιχεία της λίστας ελέγχου γίνονται υποεργασίες, τα tags ετικέτες και η προτεραιότητα έρχεται μαζί.",
      "map.gtasks": "Κάθε λίστα της Google γίνεται λίστα· οι υποεργασίες μένουν υποεργασίες και όσες έχουν τικ το κρατούν.",
      "map.todotxt": "Το πρώτο +project κάθε γραμμής γίνεται η λίστα της, τα @contexts ετικέτες, τα (A)–(C) η προτεραιότητα και το due: η προθεσμία.",
      "map.ics": "Κάθε εκκρεμότητα γίνεται εργασία σε μια λίστα με το όνομα του ημερολογίου· οι κατηγορίες γίνονται ετικέτες.",
      "map.rtm": "Κάθε λίστα γίνεται λίστα· τα tags γίνονται ετικέτες, οι σημειώσεις πάνε στις σημειώσεις της εργασίας και οι υποεργασίες μένουν υποεργασίες.",
      section: "Ενότητα",
      "err.unknown": "Αυτό το αρχείο δεν μοιάζει με εξαγωγή που διαβάζει το To-Do.",
      "err.big": "Το αρχείο είναι πολύ μεγάλο για εισαγωγή.",
      "err.read": "Δεν ήταν δυνατή η ανάγνωση του αρχείου.",
      go: "Εισαγωγή", done: "Εισαγωγή από {s}: {a} νέα", cancel: "Άκυρο", close: "Κλείσιμο"
    }
  };
  // product names (the same in both languages)
  var NAMES = { todoist: "Todoist", ticktick: "TickTick", gtasks: "Google Tasks", todotxt: "todo.txt", ics: "iCalendar", rtm: "Remember The Milk" };
  var A = null;
  function t(k, params) {
    var tab = S[A && A.lang === "el" ? "el" : "en"];
    var s = tab[k] !== undefined ? tab[k] : S.en[k];
    return s.replace(/\{(\w+)\}/g, function (m, n) { return params && params[n] !== undefined ? String(params[n]) : m; });
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function button(text, cls, fn) {
    var b = el("button", cls || "", text);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }
  // the shell's file picker, or a local <input> (To-Do on its own)
  function pickFile() {
    var host = null;
    try { host = root.parent && root.parent !== root ? root.parent.orosDialog : null; } catch (e) { host = null; }
    if (host && typeof host.openFile === "function") return host.openFile(ACCEPT);
    return new Promise(function (resolve) {
      var inp = document.createElement("input");
      inp.type = "file";
      inp.accept = ACCEPT;
      inp.hidden = true;
      inp.addEventListener("change", function () {
        var f = inp.files && inp.files[0];
        inp.remove();
        resolve(f || null);
      });
      inp.addEventListener("cancel", function () { inp.remove(); resolve(null); });
      document.body.appendChild(inp);
      inp.click();
    });
  }

  function open() {
    return pickFile().then(function (file) { return file ? openFile(file) : false; });
  }
  // Also the handle for tests / a file handed over (Promise<boolean>)
  function openFile(file) {
    var stale = document.getElementById("todo-fimp");
    if (stale) stale.remove();
    var dlg = el("dialog");
    dlg.id = "todo-fimp";
    var form = el("form");
    form.method = "dialog";
    dlg.appendChild(form);
    form.appendChild(el("h3", "", t("title")));
    var head = el("p", "hint", t("reading"));
    form.appendChild(head);
    var pickBox = el("div", "gt-pick");
    pickBox.hidden = true;
    form.appendChild(pickBox);
    var msg = el("div", "plat-msg");
    msg.setAttribute("aria-live", "polite");
    form.appendChild(msg);
    var menu = el("menu");
    var parsed = null, pl = null, withDone = null;
    var closeBtn = button(t("cancel"), "", function () { dlg.close(); });
    var go = button(t("go"), "primary", function () {
      if (!pl || !pl.items.add.length) return;
      if (A.apply(pl, t("done", { s: NAMES[parsed.source], a: pl.items.add.length }))) dlg.close();
    });
    go.hidden = true;
    go.setAttribute("data-k", "fimp.go");
    menu.appendChild(closeBtn);
    menu.appendChild(el("span", "spacer"));
    menu.appendChild(go);
    form.appendChild(menu);
    document.body.appendChild(dlg);
    dlg.addEventListener("close", function () { dlg.remove(); });
    dlg.showModal();
    function say(text) { msg.textContent = ""; msg.appendChild(el("p", "", text)); }
    function hint(text) { msg.appendChild(el("p", "hint", text)); }

    function pickNow() {
      var pick = {};
      [].forEach.call(pickBox.querySelectorAll("input[data-l]"), function (cb) { if (cb.checked) pick[cb.getAttribute("data-l")] = true; });
      return pick;
    }
    function compute() {
      pl = plan(A.data(), parsed, { done: withDone.checked, pick: pickNow(), section: t("section") });
      say(t("plan", { l: pl.lists.add.length, a: pl.items.add.length, d: pl.done, s: pl.sub, same: pl.same }));
      if (pl.from) hint(t("dates", { a: pl.from, b: pl.to }));
      if (pl.here) hint(t("here", { n: pl.here }));
      if (pl.gone) hint(t("gone", { n: pl.gone }));
      if (pl.untitled) hint(t("untitled", { n: pl.untitled }));
      if (pl.rec) hint(t("rec", { n: pl.rec }));
      if (parsed.skipped) hint(t("cancelled", { n: parsed.skipped }));
      if (parsed.capped) hint(t("capped", { n: MAX_TASKS }));
      go.disabled = !pl.items.add.length;
    }
    function preview() {
      var total = 0;
      parsed.lists.forEach(function (l) { total += l.tasks.length; });
      head.textContent = t("found", { s: NAMES[parsed.source], n: total, l: parsed.lists.length });
      form.insertBefore(el("p", "hint", t("map." + parsed.source)), pickBox);
      var all = plan(A.data(), parsed, { done: true, section: t("section") });
      if (!all.items.add.length) { say(all.same || all.here || all.gone ? t("nothing") : t("err.unknown")); closeBtn.textContent = t("close"); return; }
      pickBox.appendChild(el("p", "hint", t("pick")));
      parsed.lists.forEach(function (l) {
        var per = all.per[l.key];
        if (!per || !(per.add + per.same)) return;
        var w = el("label", "radio gt-row"), cb = el("input");
        cb.type = "checkbox";
        cb.setAttribute("data-l", l.key);
        cb.checked = per.add > 0;
        cb.disabled = !per.add;
        w.appendChild(cb);
        var tx = el("span", "gt-txt");
        tx.appendChild(el("span", "", per.name));
        tx.appendChild(el("small", "", t("row", { a: per.add, s: per.same })));
        w.appendChild(tx);
        pickBox.appendChild(w);
      });
      var dw = el("label", "radio gt-row");
      withDone = el("input");
      withDone.type = "checkbox";
      withDone.checked = true;
      withDone.setAttribute("data-k", "fimp.done");
      dw.appendChild(withDone);
      dw.appendChild(el("span", "", t("withDone")));
      pickBox.appendChild(dw);
      pickBox.hidden = false;
      pickBox.addEventListener("change", compute);
      go.hidden = false;
      compute();
    }
    return kit().readFile(file, MAX_FILE).then(parse).then(function (res) {
      if (!dlg.open) return false;
      if (!res || !res.lists.length) { head.textContent = t("err.unknown"); closeBtn.textContent = t("close"); return false; }
      parsed = res;
      preview();
      return true;
    }, function (e) {
      if (dlg.open) { head.textContent = t(e && e.message === "toobig" ? "err.big" : "err.read"); closeBtn.textContent = t("close"); }
      return false;
    });
  }

  var api = {
    parse: parse, parseText: parseText, plan: plan, idOf: idOf, ACCEPT: ACCEPT, SOURCES: SOURCES,
    init: function (a) { A = a; },
    open: open, openFile: openFile,
    has: function () { return typeof document !== "undefined" && !!root.OrosImportKit; },
    label: function () { return t("btn"); }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosTodoImport = api;
})(typeof window !== "undefined" ? window : this);
