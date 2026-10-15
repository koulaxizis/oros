// ============================================================
// orOS To-Do — one-time import from Google Tasks (todo/gtasks.js)
// The sign-in, the token and its revoke are /google-import.js's
// (window.OrosGoogleImport, scope tasks.readonly, GET only); this file
// reads the task lists, makes the plan and shows the dialog. The plan
// has the shape of links/todo.js's (Todoist / GitHub), so todo.js
// applies it with the same one write and Undo (importApply), plus two
// fields Google has: a task's tick (done) and its subtasks.
//   - a task list → a list (one of the same name here is used)
//   - a task → a task: title, notes, due date, ticked when completed
//     there (completed ones only when "Include completed" is on)
//   - a subtask → a subtask of its parent (text and tick); its own
//     notes and due date go into the parent's notes, so nothing is lost
//   - ids "gt" + a hash of Google's id: a second import finds what came
//     in before and adds only what is missing; nothing here is ever
//     overwritten. A new open task whose text is already open in the
//     same list is skipped.
// Pure (tests/google-import.test.js): plan(st, got, ctx), idOf(kind, gid)
// Browser: OrosTodoGtasks.init({ lang, data, apply }), .open() — call
// open() inside the click (the sign-in window opens there).
// ============================================================
(function (root) {
  "use strict";

  var GI = typeof module !== "undefined" && module.exports ? require("../google-import.js") : root.OrosGoogleImport;
  var API = "https://tasks.googleapis.com/tasks/v1/";
  var MAX_LISTS = 100, MAX_TASKS = 5000;
  var TEXT_LEN = 500, NOTE_LEN = 5000, NAME_LEN = 60, SUB_MAX = 100, SUB_TEXT = 300;
  var YMD = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

  function idOf(kind, gid) { return "gt" + GI.hash("gtasks|" + kind + "|" + gid); }
  function line(v, max) {
    return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
  }
  function block(v, max) {
    if (typeof v !== "string") return "";
    v = v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f\u2028\u2029]/g, " ");
    v = v.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    return v.length > max ? v.slice(0, max).trim() : v;
  }
  function key(s) { return String(s || "").toLowerCase().replace(/\s+/g, " ").trim(); }
  function dueOf(t) {
    var d = typeof t.due === "string" ? t.due.slice(0, 10) : "";
    return YMD.test(d) ? d : "";
  }
  function pos(t) { return typeof t.position === "string" ? t.position : ""; }

  // One task list's tasks → top-level tasks, each with its subtasks.
  function shape(raw, withDone) {
    var byId = {}, top = [], kids = {};
    raw.forEach(function (t) {
      if (!t || typeof t !== "object" || typeof t.id !== "string" || !t.id || t.deleted === true) return;
      if (t.status === "completed" && !withDone) return;
      byId[t.id] = t;
    });
    // the top ancestor (Google keeps one level; deeper ones fold up)
    function rootOf(t) {
      var seen = {}, cur = t;
      while (cur.parent && byId[cur.parent] && !seen[cur.parent]) { seen[cur.id] = 1; cur = byId[cur.parent]; }
      return cur;
    }
    Object.keys(byId).forEach(function (id) {
      var t = byId[id], r = rootOf(t);
      if (r === t) top.push(t);
      else (kids[r.id] = kids[r.id] || []).push(t);
    });
    function cmp(a, b) { return pos(a) < pos(b) ? -1 : pos(a) > pos(b) ? 1 : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); }
    top.sort(cmp);
    return top.map(function (t) { return { t: t, subs: (kids[t.id] || []).sort(cmp) }; });
  }

  // st: To-Do's state { lists, deleted }
  // got: { lists: [{ id, title }], tasks: { listId: [Google tasks] } }
  // ctx: { done: include completed, pick: { listId: true } (absent = all) }
  function plan(st, got, ctx) {
    ctx = ctx || {};
    var lists = st && Array.isArray(st.lists) ? st.lists : [];
    var out = {
      lists: { add: [], upd: [] }, labels: { add: [] }, items: { add: [], upd: [] },
      same: 0, here: 0, gone: 0, rec: 0, sub: 0, done: 0, untitled: 0, per: {}
    };
    var listById = {}, listByName = {}, itemIds = {};
    lists.forEach(function (l) {
      if (!l || typeof l.id !== "string") return;
      listById[l.id] = l;
      var k = key(l.name);
      if (k && !listByName[k]) listByName[k] = l;
      (Array.isArray(l.items) ? l.items : []).forEach(function (it) { if (it && typeof it.id === "string") itemIds[it.id] = 1; });
    });
    (got && Array.isArray(got.lists) ? got.lists : []).forEach(function (gl) {
      if (!gl || typeof gl.id !== "string" || !gl.id) return;
      var name = line(gl.title, NAME_LEN) || "Google Tasks";
      var rows = shape((got.tasks && got.tasks[gl.id]) || [], !!ctx.done);
      var per = out.per[gl.id] = { name: name, add: 0, same: 0 };
      if (ctx.pick && !ctx.pick[gl.id]) {
        rows.forEach(function (r) { if (itemIds[idOf("task", r.t.id)]) per.same++; else per.add++; });
        return;
      }
      var lid = idOf("list", gl.id);
      var list = listById[lid] || listByName[key(name)] || null;
      var openText = {}, adds = [];
      if (list) {
        lid = list.id;
        (list.items || []).forEach(function (it) { if (it && !it.done) openText[key(it.text)] = 1; });
      }
      rows.forEach(function (r) {
        var t = r.t, id = idOf("task", t.id);
        if (itemIds[id]) { out.same++; per.same++; return; }
        var text = line(t.title, TEXT_LEN);
        if (!text) { out.untitled++; return; }
        var done = t.status === "completed";
        if (!done && openText[key(text)]) { out.here++; return; }
        if (!done) openText[key(text)] = 1;
        var notes = block(t.notes, NOTE_LEN), extra = [], subs = [];
        r.subs.forEach(function (s) {
          var stext = line(s.title, SUB_TEXT);
          if (!stext) { out.untitled++; return; }
          var sn = block(s.notes, 1000), sd = dueOf(s), room = subs.length < SUB_MAX;
          if (room) subs.push({ id: idOf("sub", s.id), text: stext, done: s.status === "completed" });
          // what a subtask here cannot hold goes into the parent's notes
          if (sn || sd || !room) extra.push("↳ " + stext + (sd ? " (" + sd + ")" : "") + (sn ? ": " + sn : ""));
        });
        if (extra.length) notes = block((notes ? notes + "\n\n" : "") + extra.join("\n"), NOTE_LEN);
        out.sub += subs.length;
        if (done) out.done++;
        adds.push({ list: lid, id: id, text: text, notes: notes, due: dueOf(t) || null, labels: [], info: [], prio: 4,
                    done: done, subs: subs });
        per.add++;
      });
      if (!adds.length) return;
      if (!list) out.lists.add.push({ id: lid, name: name });
      out.items.add = out.items.add.concat(adds);
    });
    return out;
  }

  // ---------- reading (browser) ----------
  function read(api, progress) {
    var got = { lists: [], tasks: {} }, n = 0;
    return api.pages(function (cur) {
      return API + "users/@me/lists?maxResults=100" + (cur ? "&pageToken=" + encodeURIComponent(cur) : "");
    }, function (d) {
      (d && Array.isArray(d.items) ? d.items : []).forEach(function (l) {
        if (l && typeof l.id === "string" && l.id.length <= 200 && got.lists.length < MAX_LISTS) got.lists.push({ id: l.id, title: l.title });
      });
      return api.nextToken(d);
    }, 10).then(function () {
      return got.lists.reduce(function (p, l) {
        return p.then(function () {
          var arr = got.tasks[l.id] = [];
          if (n >= MAX_TASKS) return;
          return api.pages(function (cur) {
            return API + "lists/" + encodeURIComponent(l.id) + "/tasks?maxResults=100&showCompleted=true&showHidden=true" +
              (cur ? "&pageToken=" + encodeURIComponent(cur) : "");
          }, function (d) {
            (d && Array.isArray(d.items) ? d.items : []).forEach(function (t) { if (n < MAX_TASKS) { arr.push(t); n++; } });
            if (progress) progress(n);
            return n < MAX_TASKS ? api.nextToken(d) : "";
          }, 60);
        });
      }, Promise.resolve()).then(function () { return got; });
    });
  }

  // ---------- dialog (browser) ----------
  var S = {
    en: {
      btn: "Import from Google Tasks…", title: "Import from Google Tasks",
      intro: "Sign in to Google once: orOS reads your task lists, you choose which ones come in, and the access is given back right away. Nothing is kept, nothing changes at Google.",
      wait: "Waiting for the Google sign-in window…", reading: "Reading tasks… {n}",
      pick: "Lists to import", row: "{a} new · {s} already here", withDone: "Include completed tasks (ticked)",
      plan: "{l} new list(s), {a} new task(s), {d} of them completed, {s} subtask(s) · {same} already here",
      here: "{n} already open here with the same text: skipped.",
      untitled: "{n} without a title: skipped.",
      none: "No tasks in this Google account.", nothing: "Nothing new: To-Do already has these tasks.",
      own: "To use your own Google app id, set it in Contacts › From an account.",
      go: "Import", done: "Imported from Google Tasks: {a} new", cancel: "Cancel", close: "Close"
    },
    el: {
      btn: "Εισαγωγή από Google Tasks…", title: "Εισαγωγή από Google Tasks",
      intro: "Συνδέεσαι μία φορά στη Google: το orOS διαβάζει τις λίστες εργασιών σου, διαλέγεις ποιες θα έρθουν και η πρόσβαση επιστρέφεται αμέσως. Δεν κρατιέται τίποτα και δεν αλλάζει τίποτα στη Google.",
      wait: "Αναμονή για το παράθυρο σύνδεσης της Google…", reading: "Ανάγνωση εργασιών… {n}",
      pick: "Λίστες για εισαγωγή", row: "{a} νέες · {s} υπάρχουν ήδη", withDone: "Μαζί με τις ολοκληρωμένες εργασίες (με τικ)",
      plan: "{l} νέα/ες λίστα/ες, {a} νέα/ες εργασία/ες, από αυτές {d} ολοκληρωμένη/ες, {s} υποεργασία/ες · {same} υπάρχουν ήδη",
      here: "{n} είναι ήδη ανοιχτές εδώ με το ίδιο κείμενο: παραλείπονται.",
      untitled: "{n} χωρίς τίτλο: παραλείπονται.",
      none: "Δεν υπάρχουν εργασίες σε αυτόν τον λογαριασμό Google.", nothing: "Τίποτα νέο: το To-Do έχει ήδη αυτές τις εργασίες.",
      own: "Για δικό σου αναγνωριστικό εφαρμογής Google, όρισέ το στις Επαφές › Από λογαριασμό.",
      go: "Εισαγωγή", done: "Εισαγωγή από Google Tasks: {a} νέα", cancel: "Άκυρο", close: "Κλείσιμο"
    }
  };
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

  function open() {
    var stale = document.getElementById("todo-gtasks");
    if (stale) stale.remove();
    var dlg = el("dialog");
    dlg.id = "todo-gtasks";
    var form = el("form");
    form.method = "dialog";
    dlg.appendChild(form);
    form.appendChild(el("h3", "", t("title")));
    form.appendChild(el("p", "hint", t("intro")));
    var pickBox = el("div", "gt-pick");
    pickBox.hidden = true;
    form.appendChild(pickBox);
    var msg = el("div", "plat-msg");
    msg.setAttribute("aria-live", "polite");
    form.appendChild(msg);
    form.appendChild(el("p", "hint", t("own")));
    var menu = el("menu");
    var busy = true, got = null, pl = null;
    var closeBtn = button(t("cancel"), "", function () { dlg.close(); });
    var go = button(t("go"), "primary", function () {
      if (!pl || !pl.items.add.length) return;
      if (A.apply(pl, t("done", { a: pl.items.add.length }))) dlg.close();
    });
    go.hidden = true;
    menu.appendChild(closeBtn);
    menu.appendChild(el("span", "spacer"));
    menu.appendChild(go);
    form.appendChild(menu);
    document.body.appendChild(dlg);
    dlg.addEventListener("close", function () { if (busy) GI.cancel(); dlg.remove(); });
    dlg.showModal();
    function say(text) { msg.textContent = ""; msg.appendChild(el("p", "", text)); }
    say(t("wait"));

    var withDone = null;
    function pickNow() {
      var pick = {};
      [].forEach.call(pickBox.querySelectorAll("input[data-l]"), function (cb) { if (cb.checked) pick[cb.getAttribute("data-l")] = true; });
      return pick;
    }
    function compute() {
      pl = plan(A.data(), got, { done: withDone.checked, pick: pickNow() });
      msg.textContent = "";
      msg.appendChild(el("p", "", t("plan", { l: pl.lists.add.length, a: pl.items.add.length, d: pl.done, s: pl.sub, same: pl.same })));
      if (pl.here) msg.appendChild(el("p", "hint", t("here", { n: pl.here })));
      if (pl.untitled) msg.appendChild(el("p", "hint", t("untitled", { n: pl.untitled })));
      go.disabled = !pl.items.add.length;
    }
    function preview() {
      var all = plan(A.data(), got, { done: true });
      if (!all.items.add.length) { say(all.same ? t("nothing") : t("none")); return; }
      pickBox.appendChild(el("p", "hint", t("pick")));
      got.lists.forEach(function (gl) {
        var per = all.per[gl.id];
        if (!per || !(per.add + per.same)) return;
        var w = el("label", "radio gt-row"), cb = el("input");
        cb.type = "checkbox";
        cb.setAttribute("data-l", gl.id);
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
      withDone.setAttribute("data-k", "gt.done");
      dw.appendChild(withDone);
      dw.appendChild(el("span", "", t("withDone")));
      pickBox.appendChild(dw);
      pickBox.hidden = false;
      pickBox.addEventListener("change", compute);
      go.hidden = false;
      closeBtn.textContent = t("cancel");
      compute();
    }
    // The sign-in window opens here, still inside the click.
    GI.run({
      scope: GI.SCOPES.tasks,
      progress: function (n) { say(t("reading", { n: n })); },
      read: function (token, api) { return read(api, function (n) { say(t("reading", { n: n })); }); }
    }).then(function (res) {
      busy = false;
      if (!dlg.open) return;
      got = res.data;
      closeBtn.textContent = t("close");
      preview();
    }, function (e) {
      busy = false;
      if (!dlg.open) return;
      closeBtn.textContent = t("close");
      say(GI.message(e, A && A.lang));
    });
  }

  var api = {
    plan: plan, idOf: idOf, read: read,
    init: function (a) { A = a; },
    open: open,
    has: function () { return !!(GI && typeof document !== "undefined" && GI.ready()); },
    label: function () { return t("btn"); }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosTodoGtasks = api;
})(typeof window !== "undefined" ? window : this);
