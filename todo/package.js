// ============================================================
// orOS To-Do — .orostasks file (todo/package.js,
// window.OrosTodoPackage). The descriptor of To-Do for the record
// apps' kit (../recordpkg.js, docs/oros-bundle.md "Record apps"):
// every list, task, subtask and label in one orOS bundle; opening
// one ADDS what this device lacks, with its ids. Pure (no DOM, no
// storage), so the app and `node --test` run the same code.
//   DESC                     the kit descriptor (no merge: the kit's
//                            plain insert; todo.js then runs the result
//                            through its own migrate + save + sync)
//   DESC.norm(data)          a file's data → { labels, lists } with
//                            known fields only, typed and capped
//   DESC.strip(state)        the slice → { ver, labels, lists }: no
//                            tombstones (deleted), no view settings
//                            (activeList, hideCompleted, sm), no saved
//                            filters
//   DESC.tombIds(state)      the ids in state.deleted
//   DESC.previews(state, l)  tasks.md (readable) and tasks.csv
//   kindOf(id, state)        "list" | "item" | "label" | "sub" | ""
// ============================================================
(function (root) {
  "use strict";

  var LIM = { lists: 500, items: 5000, labels: 300, subs: 100, info: 50,
              name: 200, text: 2000, notes: 20000, field: 500 };

  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function num(v) { return typeof v === "number" && isFinite(v) ? v : 0; }
  function str(v, max) { return typeof v === "string" ? v.slice(0, max) : ""; }
  function line(v, max) { return str(v, max).replace(/[\u0000-\u001f\u007f]/g, " "); }
  function okId(v) { return typeof v === "string" && /^[A-Za-z0-9_.:-]{1,80}$/.test(v); }
  function stamps(o, keys) {
    if (!isObj(o)) return undefined;
    var out = {}, any = false;
    keys.forEach(function (k) { if (typeof o[k] === "number" && isFinite(o[k])) { out[k] = o[k]; any = true; } });
    return any ? out : undefined;
  }
  function rec(r) {
    if (!isObj(r)) return null;
    var every = Math.max(1, Math.min(999, Math.floor(num(r.every)) || 1));
    var unit = r.unit === "week" || r.unit === "month" ? r.unit : "day";
    var out = { every: every, unit: unit };
    if (typeof r.weekday === "number" && r.weekday >= 0 && r.weekday <= 6) out.weekday = Math.floor(r.weekday);
    if (r.after === true) out.after = true;
    return out;
  }
  var YMD = /^\d{4}-\d{2}-\d{2}$/;
  var ISO = /^\d{4}-\d{2}-\d{2}(T[0-9:.]+Z?)?$/;

  function normItem(it) {
    if (!isObj(it) || !okId(it.id)) return null;
    var o = {
      id: it.id, text: line(it.text, LIM.text), done: it.done === true,
      due: typeof it.due === "string" && YMD.test(it.due) ? it.due : null,
      notes: str(it.notes, LIM.notes),
      labels: (Array.isArray(it.labels) ? it.labels : []).filter(okId).slice(0, LIM.labels),
      info: (Array.isArray(it.info) ? it.info : []).filter(isObj).slice(0, LIM.info).map(function (f, i) {
        return { id: okId(f.id) ? f.id : "f" + i,
                 label: line(f.label, LIM.field), value: str(f.value, LIM.field) };
      }),
      recurrence: rec(it.recurrence),
      mtime: num(it.mtime), om: num(it.om), pos: num(it.pos)
    };
    var fm = stamps(it.fm, ["text", "done", "due", "notes", "labels", "info", "recurrence"]);
    if (fm) o.fm = fm;
    if (it.prio === 1 || it.prio === 2 || it.prio === 3) o.prio = it.prio;
    if (Array.isArray(it.subs)) {
      var seen = {};
      var subs = it.subs.filter(function (s) {
        if (!isObj(s) || !okId(s.id) || seen[s.id]) return false;
        seen[s.id] = 1;
        return true;
      }).slice(0, LIM.subs).map(function (s) {
        return { id: s.id, text: line(s.text, 300), done: !!s.done, mtime: num(s.mtime) };
      });
      if (subs.length) o.subs = subs;
    }
    var xf = stamps(it.xf, ["prio", "subs", "so", "list"]);
    if (xf) o.xf = xf;
    return o;
  }
  function normList(l) {
    if (!isObj(l) || !okId(l.id)) return null;
    var o = { id: l.id, name: line(l.name, LIM.name), mtime: num(l.mtime), om: num(l.om), pos: num(l.pos),
              recurrence: rec(l.recurrence), items: [] };
    if (typeof l.lastReset === "string" && ISO.test(l.lastReset)) o.lastReset = l.lastReset;
    if (typeof l.nextReset === "string" && ISO.test(l.nextReset)) o.nextReset = l.nextReset;
    var fm = stamps(l.fm, ["name", "cycle"]);
    if (fm) o.fm = fm;
    (Array.isArray(l.items) ? l.items : []).slice(0, LIM.items).forEach(function (it) {
      var c = normItem(it);
      if (c) o.items.push(c);
    });
    return o;
  }
  function normLabel(lb) {
    if (!isObj(lb) || !okId(lb.id)) return null;
    var color = typeof lb.color === "string" && /^#[0-9a-fA-F]{6}$/.test(lb.color) ? lb.color : "#ecc75f";
    return { id: lb.id, name: line(lb.name, 60), color: color, mtime: num(lb.mtime), om: num(lb.om), pos: num(lb.pos) };
  }
  function norm(data) {
    if (!isObj(data)) return null;
    var out = { ver: 3, labels: [], lists: [] };
    if (isObj(data.deleted)) out.deleted = data.deleted;        // strip and tombIds see it, then it goes
    (Array.isArray(data.labels) ? data.labels : []).slice(0, LIM.labels).forEach(function (lb) {
      var c = normLabel(lb);
      if (c) out.labels.push(c);
    });
    (Array.isArray(data.lists) ? data.lists : []).slice(0, LIM.lists).forEach(function (l) {
      var c = normList(l);
      if (c) out.lists.push(c);
    });
    return out;
  }
  function strip(state) {
    var s = isObj(state) ? state : {};
    return JSON.parse(JSON.stringify({ ver: 3, labels: Array.isArray(s.labels) ? s.labels : [],
                                       lists: Array.isArray(s.lists) ? s.lists : [] }));
  }
  function tombIds(state) {
    return isObj(state) && isObj(state.deleted) ? Object.keys(state.deleted) : [];
  }

  function csvCell(v) {
    var s = v == null ? "" : String(v);
    return /[",\r\n]/.test(s) || /^[=+\-@\t]/.test(s) ? '"' + (/^[=+\-@\t]/.test(s) ? "'" : "") + s.replace(/"/g, '""') + '"' : s;
  }
  // The heading of tasks.md. The kit passes "el" or "en"; a pack
  // language (orosI18n, ../i18n.js, browser only) reads the "todo" pack.
  var STR = {
    en: { "pkg.tasks": "Tasks" },
    el: { "pkg.tasks": "Εργασίες" }
  };
  function previews(state, lang) {
    var code = lang === "el" ? "el" : "en", I = root && root.orosI18n, labels = {};
    if (code === "en" && I) { code = I.lang(); if (code !== "el" && code !== "en") I.table(STR, "todo", code); }
    (state.labels || []).forEach(function (lb) { labels[lb.id] = lb.name; });
    var md = ["# " + (STR[code] || STR.en)["pkg.tasks"], ""];
    var csv = [["list", "task", "done", "due", "priority", "labels", "notes"].join(",")];
    (state.lists || []).forEach(function (l) {
      md.push("## " + (l.name || "—"), "");
      (l.items || []).forEach(function (it) {
        var extra = [];
        if (it.due) extra.push(it.due);
        if (it.prio) extra.push("P" + it.prio);
        md.push("- [" + (it.done ? "x" : " ") + "] " + (it.text || "") + (extra.length ? " (" + extra.join(", ") + ")" : ""));
        (it.subs || []).forEach(function (s) { md.push("  - [" + (s.done ? "x" : " ") + "] " + (s.text || "")); });
        csv.push([l.name, it.text, it.done ? "yes" : "no", it.due || "", it.prio ? "P" + it.prio : "",
                  (it.labels || []).map(function (id) { return labels[id] || ""; }).filter(Boolean).join("; "),
                  it.notes || ""].map(csvCell).join(","));
      });
      md.push("");
    });
    return { "tasks.md": md.join("\n"), "tasks.csv": csv.join("\r\n") + "\r\n" };
  }

  // What an id names in a state (Undo removes each the right way).
  function kindOf(id, state) {
    var s = isObj(state) ? state : {}, k = "";
    (s.labels || []).forEach(function (lb) { if (lb.id === id) k = "label"; });
    (s.lists || []).forEach(function (l) {
      if (l.id === id) k = "list";
      (l.items || []).forEach(function (it) {
        if (it.id === id) k = "item";
        (it.subs || []).forEach(function (sb) { if (sb.id === id) k = k || "sub"; });
      });
    });
    return k;
  }

  var DESC = {
    app: "todo", title: "To-Do", slice: "todo", ext: ".orostasks", mime: "application/x-oros-tasks",
    colls: {
      labels: { shape: "array", id: "id", stamp: "mtime" },
      lists: { shape: "array", id: "id", stamp: "mtime", clampIn: ["fm"] },
      "lists.items": { shape: "array", id: "id", stamp: "mtime", clampIn: ["fm", "xf"] },
      "lists.items.subs": { shape: "array", id: "id", stamp: "mtime" }
    },
    norm: norm, strip: strip, tombIds: tombIds, previews: previews
  };

  var api = { DESC: DESC, kindOf: kindOf, LIM: LIM };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrosTodoPackage = api;
})(this);
