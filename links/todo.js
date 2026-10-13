// ============================================================
// orOS Connected services — To-Do platforms (links/todo.js, v1.0.0)
// Pure: the requests that read a Todoist account (projects and open
// tasks, integrations wave 6A) or the GitHub issues assigned to the
// token's owner (wave 6G), what the answers mean, and the plan
// that brings them into To-Do. No DOM, no storage, no network:
// todo/platforms.js makes the calls through the shell (orosLinks.call)
// and todo/todo.js applies the plan.
//   KINDS[p]: what is read, in order
//   req(p, kind, at) → one GET (at = Todoist's page cursor, "" first)
//   read(p, kind, data, at) → { items, next } (next "" = the last page)
//   plan(st, got, ctx) → what changes in To-Do (st = To-Do's state)
//   count(plan) → { add, upd }
// The platform is only read; To-Do stays the source of truth:
//   - a project with open tasks → a list; a task → a task (due date,
//     description as notes, labels by name, priority as an extra-info
//     field); subtasks follow their parent, flat
//   - ids from L.extId: the same task imported on two devices lands on
//     the same row (R16), and a second import finds it again
//   - a list or task deleted here is not brought back unless asked;
//     a new task whose text is already open in its list is skipped
//   - an update touches only Todoist's fields (text, notes, due date,
//     priority) and only adds labels; ticks, other labels, extra info
//     and repeats set here are never touched
//   - repeating tasks come in with their next date only
//   - GitHub: one list per repository ("owner/name"), an open issue
//     assigned to you → "#12 Title" with its text and link as notes, its
//     labels, its milestone's date as due; pull requests left out
// Everything from the platform is plain text from here on (textContent).
// ============================================================
(function (root) {
  "use strict";

  var L = typeof module !== "undefined" && module.exports ? require("./core.js") : root.OrosLinksCore;

  var PLATFORMS = ["todoist", "github"];
  var KINDS = { todoist: ["projects", "tasks"], github: ["tasks"] };   // GitHub: lists come from the issues' repositories
  var GH_PAGE = 100, REPO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
  var MAX = { projects: 1000, tasks: 5000 };
  var PAGE = 200;
  var TEXT_LEN = 500, NOTE_LEN = 5000, NAME_LEN = 60, LABEL_LEN = 40;
  var PRIO_ID = "tdprio";
  var YMD = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
  // what a page cursor may be (base64-like); anything else ends the reading
  var CUR_RE = /^[A-Za-z0-9._=+\/-]{1,600}$/;

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function xid(v) {
    if (typeof v === "number" && isFinite(v) && v > 0 && Math.floor(v) === v) return String(v);
    return typeof v === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(v) ? v : "";
  }
  function line(v, max) { return L.cleanText(typeof v === "string" ? v : "", max); }
  function block(v, max) {
    if (typeof v !== "string") return "";
    v = v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f\u2028\u2029]/g, " ");
    v = v.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    return v.length > max ? v.slice(0, max).trim() : v;
  }
  function key(s) { return String(s || "").toLowerCase().replace(/\s+/g, " ").trim(); }
  function num(v) { return typeof v === "number" && isFinite(v) ? v : 0; }

  function req(p, kind, at) {
    if (p === "github") return { m: "GET", path: "/issues?filter=assigned&state=open&per_page=" + GH_PAGE + "&page=" + (/^[1-9][0-9]{0,8}$/.test(at || "") ? at : "1") };
    var path = kind === "projects" ? "/projects" : "/tasks";
    return { m: "GET", path: path + "?limit=" + PAGE + (at ? "&cursor=" + encodeURIComponent(at) : "") };
  }

  function readProject(x) {
    if (!x || typeof x !== "object" || x.is_deleted === true || x.is_archived === true) return null;
    var id = xid(x.id);
    if (!id) return null;
    return { xid: id, name: line(x.name, NAME_LEN), inbox: x.inbox_project === true || x.is_inbox_project === true, order: num(x.child_order) };
  }
  function readTask(x) {
    if (!x || typeof x !== "object" || x.is_deleted === true || x.checked === true || x.is_completed === true) return null;
    var id = xid(x.id), pid = xid(x.project_id);
    var text = line(x.content, TEXT_LEN);
    if (!id || !pid || !text) return null;
    var due = "", rec = false;
    if (x.due && typeof x.due === "object") {
      var d = typeof x.due.date === "string" ? x.due.date.slice(0, 10) : "";
      if (YMD.test(d)) due = d;
      rec = x.due.is_recurring === true;
    }
    var labels = [], seen = {};
    (Array.isArray(x.labels) ? x.labels : []).forEach(function (n) {
      var s = line(n, LABEL_LEN), k = key(s);
      if (s && !seen[k] && labels.length < 20) { seen[k] = 1; labels.push(s); }
    });
    var prio = num(x.priority);
    return {
      xid: id, pid: pid, text: text, notes: block(x.description, NOTE_LEN), labels: labels,
      due: due, rec: rec, prio: prio >= 2 && prio <= 4 ? prio : 1,
      order: num(x.child_order), parent: xid(x.parent_id)
    };
  }
  function readIssue(x) {
    if (!x || typeof x !== "object" || x.pull_request || x.state !== "open" || typeof x.id !== "number") return null;
    var repo = x.repository && typeof x.repository.full_name === "string" ? x.repository.full_name : "";
    if (!REPO.test(repo) || /(^|\/)\.\.?($|\/)/.test(repo)) return null;
    var title = line(x.title, TEXT_LEN - 12), n = num(x.number);
    if (!title) return null;
    var labels = [], seen = {};
    (Array.isArray(x.labels) ? x.labels : []).forEach(function (lb) {
      var s = line(lb && typeof lb === "object" ? lb.name : lb, LABEL_LEN), k = key(s);
      if (s && !seen[k] && labels.length < 20) { seen[k] = 1; labels.push(s); }
    });
    var due = x.milestone && typeof x.milestone.due_on === "string" ? x.milestone.due_on.slice(0, 10) : "";
    var url = typeof x.html_url === "string" && /^https:\/\/github\.com\/[^\s]{1,300}$/.test(x.html_url) ? x.html_url : "";
    var body = block(x.body, NOTE_LEN - 320);
    return {
      xid: String(x.id), pid: repo, text: "#" + n + " " + title, notes: (body + (url ? (body ? "\n\n" : "") + url : "")),
      labels: labels, due: YMD.test(due) ? due : "", rec: false, prio: 1, order: n, parent: ""
    };
  }
  // A page: { results, next_cursor } (an array alone is one last page).
  // GitHub: an array of issues; the next page while a page is full.
  function read(p, kind, data, at) {
    if (p === "github") {
      var arr = Array.isArray(data) ? data : [], its = [];
      arr.forEach(function (x) { var r = readIssue(x); if (r) its.push(r); });
      var pg = /^[1-9][0-9]{0,8}$/.test(at || "") ? +at : 1;
      return { items: its, next: arr.length >= GH_PAGE && pg < 50 ? String(pg + 1) : "" };
    }
    var list = Array.isArray(data) ? data : (data && Array.isArray(data.results) ? data.results : []);
    var items = [];
    list.forEach(function (x) {
      var r = kind === "projects" ? readProject(x) : readTask(x);
      if (r) items.push(r);
    });
    var next = data && !Array.isArray(data) && typeof data.next_cursor === "string" && CUR_RE.test(data.next_cursor) ? data.next_cursor : "";
    if (next === at) next = "";                    // a cursor that doesn't move would never end
    return { items: items, next: next };
  }

  // Each project's tasks with every subtask right after its parent.
  function ordered(tasks) {
    var byId = {}, kids = {}, roots = [];
    tasks.forEach(function (t) { byId[t.xid] = t; });
    tasks.forEach(function (t) {
      if (t.parent && byId[t.parent] && byId[t.parent].pid === t.pid && t.parent !== t.xid) (kids[t.parent] = kids[t.parent] || []).push(t);
      else roots.push(t);
    });
    function cmp(a, b) { return a.order - b.order || (a.xid < b.xid ? -1 : a.xid > b.xid ? 1 : 0); }
    var out = [], seen = {};
    function walk(t, depth) {
      if (seen[t.xid] || depth > 8) return;
      seen[t.xid] = 1;
      out.push(t);
      (kids[t.xid] || []).sort(cmp).forEach(function (k) { walk(k, depth + 1); });
    }
    roots.sort(cmp).forEach(function (t) { walk(t, 0); });
    tasks.forEach(function (t) { if (!seen[t.xid]) out.push(t); });   // a loop of parents: still once each
    return out;
  }
  function sameList(a, b) { return JSON.stringify(a || []) === JSON.stringify(b || []); }
  function prioInfo(t, label) { return t.prio > 1 ? { id: PRIO_ID, label: label, value: "P" + (5 - t.prio) } : null; }

  // st: To-Do's state { lists, labels, deleted }
  // got: { projects, tasks } from read
  // ctx: { p, acct, upd, revive, prio (the extra-info label for priority) }
  function plan(st, got, ctx) {
    var p = ctx.p, acct = ctx.acct, prioLabel = line(ctx.prio, 40) || "Priority";
    var lists = (st && Array.isArray(st.lists)) ? st.lists : [];
    var labels = (st && Array.isArray(st.labels)) ? st.labels : [];
    var deleted = (st && st.deleted && typeof st.deleted === "object") ? st.deleted : {};
    var out = {
      lists: { add: [], upd: [] }, labels: { add: [] }, items: { add: [], upd: [] },
      same: 0, here: 0, gone: 0, rec: 0, sub: 0
    };
    var listById = {}, itemById = {};
    lists.forEach(function (l) {
      if (!l || typeof l.id !== "string") return;
      listById[l.id] = l;
      (Array.isArray(l.items) ? l.items : []).forEach(function (it) { if (it && typeof it.id === "string") itemById[it.id] = { list: l, it: it }; });
    });
    // labels by name (any label of the same name is used)
    var labelByKey = {};
    labels.forEach(function (lb) { if (lb && typeof lb.id === "string" && typeof lb.name === "string" && !has(labelByKey, key(lb.name))) labelByKey[key(lb.name)] = lb.id; });
    function labelId(name) {
      var k = key(name);
      if (has(labelByKey, k)) return labelByKey[k];
      var id = L.extId(p, acct, "label", k);
      if (has(deleted, id) && !ctx.revive) return "";
      labelByKey[k] = id;
      out.labels.add.push({ id: id, name: name });
      return id;
    }

    var projects = (got && got.projects) || [], tasks = (got && got.tasks) || [];
    if (p === "github" && !(got && got.projects)) {    // one list per repository, in name order
      var seenRepo = {};
      projects = [];
      tasks.forEach(function (t) { if (!seenRepo[t.pid]) { seenRepo[t.pid] = 1; projects.push({ xid: t.pid, name: line(t.pid, NAME_LEN), inbox: false, order: 0 }); } });
      projects.sort(function (a, b) { return a.xid.toLowerCase() < b.xid.toLowerCase() ? -1 : a.xid.toLowerCase() > b.xid.toLowerCase() ? 1 : 0; });
    }
    var byProject = {};
    tasks.forEach(function (t) { (byProject[t.pid] = byProject[t.pid] || []).push(t); });
    var pOrder = projects.slice().sort(function (a, b) { return (b.inbox ? 1 : 0) - (a.inbox ? 1 : 0) || a.order - b.order; });

    pOrder.forEach(function (pr) {
      var ts = byProject[pr.xid];
      if (!ts || !ts.length) return;               // only projects with open tasks
      var lid = L.extId(p, acct, "list", pr.xid);
      var list = listById[lid];
      // a new list's open texts, for duplicates among its own tasks
      var openText = {};
      if (!list) {
        if (has(deleted, lid) && !ctx.revive) { out.gone += ts.length; return; }
        out.lists.add.push({ id: lid, name: pr.name || (p === "github" ? "GitHub" : "Todoist") });
      } else {
        (list.items || []).forEach(function (it) { if (it && !it.done) openText[key(it.text)] = 1; });
        if (ctx.upd && pr.name && list.name !== pr.name) out.lists.upd.push({ id: lid, name: pr.name });
      }
      ordered(ts).forEach(function (t) {
        var id = L.extId(p, acct, "task", t.xid);
        var pi = prioInfo(t, prioLabel);
        var cur = itemById[id];
        if (cur) {
          if (!ctx.upd) { out.same++; return; }
          var it = cur.it, f = {};
          if (it.text !== t.text) f.text = t.text;
          if ((it.notes || "") !== t.notes) f.notes = t.notes;
          if ((it.due || null) !== (t.due || null)) f.due = t.due || null;
          var have = Array.isArray(it.labels) ? it.labels.slice() : [];
          t.labels.forEach(function (n) { var lid2 = labelId(n); if (lid2 && have.indexOf(lid2) < 0) have.push(lid2); });
          if (!sameList(have, it.labels)) f.labels = have;
          var info = (Array.isArray(it.info) ? it.info : []).filter(function (x) { return !(x && x.id === PRIO_ID); });
          var old = (Array.isArray(it.info) ? it.info : []).filter(function (x) { return x && x.id === PRIO_ID; })[0];
          if (pi) info.push(old && old.label ? { id: PRIO_ID, label: old.label, value: pi.value } : pi);
          if (!sameList(info, it.info)) f.info = info;
          if (Object.keys(f).length) { out.items.upd.push({ id: id, list: cur.list.id, f: f }); if (t.rec) out.rec++; }
          else out.same++;
          return;
        }
        if (has(deleted, id) && !ctx.revive) { out.gone++; return; }
        var k = key(t.text);
        if (openText[k]) { out.here++; return; }
        openText[k] = 1;
        var ids = [];
        t.labels.forEach(function (n) { var lid3 = labelId(n); if (lid3 && ids.indexOf(lid3) < 0) ids.push(lid3); });
        out.items.add.push({ list: lid, id: id, text: t.text, notes: t.notes, due: t.due || null, labels: ids, info: pi ? [pi] : [] });
        if (t.rec) out.rec++;
        if (t.parent && ts.some(function (o) { return o.xid === t.parent; })) out.sub++;
      });
    });
    // labels only some skipped task wanted stay out
    var used = {};
    out.items.add.forEach(function (a) { a.labels.forEach(function (id) { used[id] = 1; }); });
    out.items.upd.forEach(function (u) { (u.f.labels || []).forEach(function (id) { used[id] = 1; }); });
    out.labels.add = out.labels.add.filter(function (lb) { return used[lb.id]; });
    return out;
  }
  function count(pl) {
    return { add: pl.lists.add.length + pl.items.add.length, upd: pl.lists.upd.length + pl.items.upd.length };
  }

  var api = { PLATFORMS: PLATFORMS, KINDS: KINDS, MAX: MAX, PAGE: PAGE, PRIO_ID: PRIO_ID, req: req, read: read, plan: plan, count: count };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosLinksTodo = api;
})(typeof window !== "undefined" ? window : this);
