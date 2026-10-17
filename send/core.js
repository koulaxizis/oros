// ============================================================
// orOS "Send to…" — send/core.js (pure core, v1.0.0)
// One app hands a piece of content to ANOTHER app of the same orOS,
// like a phone's share menu. Four kinds:
//   text   { title?, text }                 a note, a selection, a page
//   link   { url, title?, note? }           one http(s) address
//   items  { title?, items: [{text, note?}] }   a list of lines
//   table  { name?, rows: [[cell…]…], sum? }    rows, row 1 = heading
//   files  { items: [{ path, name? }] }     files on the orOS disk
//                                           (/internal/…, ≤ 10; wave 2)
// RECEIVERS says which app takes which kind and builds the target of
// that app's EXISTING deep link (__orosOpenAt). Every receiver opens a
// prefill the user still has to save (BR-W8-6); nothing here writes
// storage, syncs or builds HTML. Everything is normalized with caps
// here AND again by the receiving app.
//
// Used by the shell (send/sheet.js, loaded on first use). No DOM, no
// storage. Node tests load it as is.
//
// API (window.OrosSendCore / module.exports):
//   KINDS, ORDER
//   norm(kind, data)                  → clean data | null
//   accepts(app, kind, data)          → true when app takes this item
//   appsFor(kind, data, installed, self) → app ids, in ORDER
//   target(app, kind, data, from)     → deep-link target | null
//   summary(kind, data, lang)         → one line for the sheet's head
// ============================================================
(function (root) {
  "use strict";

  var KINDS = ["text", "link", "items", "table", "files"];
  var MAX_FILES = 10;            // Mail's handed-files cap
  var MAX_TEXT = 200000;
  var MAX_TITLE = 200;
  var MAX_ITEMS = 200;
  var MAX_ITEM = 300;
  var MAX_NOTE = 1000;
  var MAX_ROWS = 500;
  var MAX_COLS = 64;
  var MAX_CELL = 2000;
  var MAX_URL = 2000;
  var LABEL_MAX = 40;            // Label Maker's own cap (labels/core.js)
  var ASK_MAX = 20000;           // the Assistant's message box cap
  var MAIL_MAX = 20000;          // Mail's compose body cap
  var NOTES_MAX = 20000;         // Notes' {add} cap
  var WIKI_MAX = 200000;         // Wiki's article cap

  // Control characters other than tab / newline, and U+2028/2029.
  var CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029]/g;
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function str(v, max) {
    if (typeof v !== "string") return "";
    return v.replace(/\r\n?/g, "\n").replace(CTRL, " ").slice(0, max);
  }
  function line(v, max) { return str(v, max * 2).replace(/\s+/g, " ").trim().slice(0, max); }

  // ---------- 1. Normalizers ----------
  function normText(d) {
    var text = str(d.text, MAX_TEXT);
    if (!text.trim()) return null;
    return { title: line(d.title, MAX_TITLE), text: text };
  }
  function normUrl(u) {
    var s = line(u, MAX_URL);
    if (!/^https?:\/\/[^\s\/?#]+/i.test(s)) return "";
    return s;
  }
  function normLink(d) {
    var url = normUrl(d.url);
    if (!url) return null;
    return { url: url, title: line(d.title, MAX_TITLE), note: str(d.note, MAX_NOTE).trim() };
  }
  function normItems(d) {
    if (!Array.isArray(d.items)) return null;
    var out = [];
    for (var i = 0; i < d.items.length && out.length < MAX_ITEMS; i++) {
      var it = d.items[i];
      if (typeof it === "string") it = { text: it };
      if (!it || typeof it !== "object") continue;
      var text = line(it.text, MAX_ITEM);
      if (!text) continue;
      out.push({ text: text, note: str(it.note, MAX_NOTE).trim() });
    }
    if (!out.length) return null;
    return { title: line(d.title, 60), items: out };
  }
  function normCell(c) {
    if (typeof c === "number") return isFinite(c) ? c : "";
    if (typeof c === "string") return str(c, MAX_CELL);
    return "";
  }
  function normTable(d) {
    if (!Array.isArray(d.rows)) return null;
    var rows = [];
    for (var i = 0; i < d.rows.length && rows.length < MAX_ROWS; i++) {
      if (!Array.isArray(d.rows[i])) continue;
      rows.push(d.rows[i].slice(0, MAX_COLS).map(normCell));
    }
    var any = rows.some(function (r) { return r.some(function (c) { return c !== ""; }); });
    if (!any) return null;
    var sum = Array.isArray(d.sum) ? d.sum.filter(function (c) {
      return typeof c === "number" && c === Math.floor(c) && c >= 0 && c < MAX_COLS;
    }) : [];
    return { name: line(d.name, 100), rows: rows, sum: sum };
  }
  // A path on the orOS disk, as Mail's diskPath() takes it.
  function diskPath(p) {
    if (typeof p !== "string" || p.length > 1000 || p.indexOf("/internal/") !== 0) return false;
    return p.split("/").slice(2).every(function (seg) { return seg && seg !== "." && seg !== ".." && !/[\u0000-\u001f]/.test(seg); });
  }
  function normFiles(d) {
    if (!Array.isArray(d.items)) return null;
    var out = [];
    d.items.forEach(function (f) {
      if (!f || typeof f !== "object" || !diskPath(f.path) || out.length >= MAX_FILES) return;
      var name = line(f.name, 200).replace(/[\/\\]/g, "") || f.path.replace(/^.*\//, "").slice(0, 200);
      if (!out.some(function (o) { return o.path === f.path; })) out.push({ path: f.path, name: name });
    });
    return out.length ? { items: out } : null;
  }
  var NORM = { text: normText, link: normLink, items: normItems, table: normTable, files: normFiles };
  function norm(kind, data) {
    if (!own(NORM, kind) || !data || typeof data !== "object") return null;
    try { return NORM[kind](data); } catch (e) { return null; }
  }

  // ---------- 2. Shapes every receiver can use ----------
  function itemsAsText(d) {
    return d.items.map(function (it) { return "- " + it.text + (it.note ? " (" + it.note.replace(/\s+/g, " ") + ")" : ""); }).join("\n");
  }
  function linkAsText(d) {
    return (d.title ? d.title + "\n" : "") + d.url + (d.note ? "\n\n" + d.note : "");
  }
  function tableAsText(d) {
    return d.rows.map(function (r) { return r.join("\t"); }).join("\n");
  }
  // Any kind → { title, text } (text receivers take every kind).
  function asText(kind, d) {
    if (kind === "text") return { title: d.title, text: d.text };
    if (kind === "link") return { title: d.title || d.url, text: linkAsText(d) };
    if (kind === "items") return { title: d.title, text: itemsAsText(d) };
    if (kind === "files") return { title: d.items[0].name, text: d.items.map(function (f) { return f.name; }).join("\n") };
    return { title: d.name, text: tableAsText(d) };
  }
  // text / link → To-Do items: one per non-empty line of a text.
  function asItems(kind, d) {
    if (kind === "items") return d.items;
    if (kind === "link") return [{ text: line(d.title || d.url, MAX_ITEM), note: str(d.url + (d.note ? "\n" + d.note : ""), MAX_NOTE) }];
    if (kind === "text") {
      var out = [];
      d.text.split("\n").forEach(function (l) {
        var s = line(l.replace(/^\s*(?:[-*•]|\d+[.)]|\[[ xX]?\])\s+/, ""), MAX_ITEM);
        if (s && out.length < MAX_ITEMS) out.push({ text: s, note: "" });
      });
      return out.length ? out : null;
    }
    return null;
  }

  // ---------- 3. Receivers ----------
  // app → { kinds, ok?(kind, d), build(kind, d, from) → target }. The
  // targets are the apps' own documented contracts:
  //   notes {add:{title,text}} (BR-SHARE), writer {newDoc:{title,text}}
  //   (Typewriter), todo {addItems} (BR-TD-ADD), mail {compose} (BR-SHARE
  //   Email), assistant {ask} (Assistant deep link), bookmarks {add}
  //   (Send to orOS), wiki {addArticle:{t,x}} (Wiki wave 3), texttools /
  //   textcase {text} (Text Tools deep link), labels {text} (Label Maker
  //   bridge), spreadsheet {newSheet} (BR-S1).
  var RECEIVERS = {
    notes: {
      kinds: ["text", "link", "items"],
      build: function (k, d) { var x = asText(k, d); return { add: { title: x.title, text: x.text.slice(0, NOTES_MAX) } }; }
    },
    writer: {
      kinds: ["text", "link", "items", "table"],
      build: function (k, d) { var x = asText(k, d); return { newDoc: { title: x.title, text: x.text } }; }
    },
    todo: {
      kinds: ["items", "text", "link"],
      ok: function (k, d) { return !!asItems(k, d); },
      build: function (k, d, from) {
        var t = { addItems: { from: line(from, 60), items: asItems(k, d) } };
        if (k === "items" && d.title) t.addItems.newList = d.title;
        return t;
      }
    },
    mail: {
      kinds: ["text", "link", "items", "files"],
      build: function (k, d) {
        var x = asText(k, d);
        if (k === "files") {
          return { compose: { subject: line(x.title, 300), attach: d.items.map(function (f) { return { path: f.path, name: f.name }; }) } };
        }
        return { compose: { subject: line(x.title, 300), body: x.text.slice(0, MAIL_MAX) } };
      }
    },
    assistant: {
      kinds: ["text", "link"],
      build: function (k, d) { var x = asText(k, d); return { ask: x.text.slice(0, ASK_MAX) }; }
    },
    bookmarks: {
      kinds: ["link"],
      build: function (k, d) { return { add: { url: d.url, title: d.title } }; }
    },
    wiki: {
      kinds: ["text", "items"],
      build: function (k, d) { var x = asText(k, d); return { addArticle: { t: x.title, x: x.text.slice(0, WIKI_MAX) } }; }
    },
    spreadsheet: {
      kinds: ["table", "items"],
      build: function (k, d) {
        if (k === "table") {
          var t = { newSheet: { name: d.name, rows: d.rows } };
          if (d.sum.length) t.newSheet.sum = d.sum;
          return t;
        }
        var rows = d.items.map(function (it) { return it.note ? [it.text, it.note] : [it.text]; });
        return { newSheet: { name: d.title, rows: rows } };
      }
    },
    texttools: {
      kinds: ["text", "items", "table"],
      build: function (k, d) { return { text: asText(k, d).text }; }
    },
    textcase: {
      kinds: ["text"],
      build: function (k, d) { return { text: d.text }; }
    },
    labels: {
      kinds: ["text"],
      // A label is one short line.
      ok: function (k, d) { var s = d.text.trim(); return s.indexOf("\n") < 0 && Array.from(s).length <= LABEL_MAX; },
      build: function (k, d) { return { text: d.text.trim() }; }
    }
  };
  // The sheet's order: the everyday places first.
  var ORDER = ["notes", "todo", "writer", "mail", "bookmarks", "spreadsheet", "wiki", "assistant", "texttools", "textcase", "labels"];

  function accepts(app, kind, d) {
    if (!own(RECEIVERS, app)) return false;
    var r = RECEIVERS[app];
    if (r.kinds.indexOf(kind) < 0) return false;
    return !r.ok || !!r.ok(kind, d);
  }
  // installed: array of app ids (internal apps of this orOS); self: the
  // sending app, never offered to itself.
  function appsFor(kind, data, installed, self) {
    var d = norm(kind, data);
    if (!d) return [];
    var have = {};
    (installed || []).forEach(function (id) { have[id] = true; });
    return ORDER.filter(function (id) { return have[id] && id !== self && accepts(id, kind, d); });
  }
  function target(app, kind, data, from) {
    var d = norm(kind, data);
    if (!d || !accepts(app, kind, d)) return null;
    return RECEIVERS[app].build(kind, d, from || "");
  }

  // ---------- 4. Summary line ----------
  var S = {
    en: { text: "Text", link: "Link", items: "List", table: "Table", files: "Files", file: "File", n: "{n} items", rows: "{n} rows", chars: "{n} characters" },
    el: { text: "Κείμενο", link: "Σύνδεσμος", items: "Λίστα", table: "Πίνακας", files: "Αρχεία", file: "Αρχείο", n: "{n} στοιχεία", rows: "{n} γραμμές", chars: "{n} χαρακτήρες" }
  };
  function summary(kind, data, lang) {
    var s = S[lang === "el" ? "el" : "en"];
    var d = norm(kind, data);
    if (!d) return "";
    var head = s[kind], name, more;
    if (kind === "text") { name = d.title || line(d.text, 60); more = s.chars.replace("{n}", d.text.length); }
    else if (kind === "link") { name = d.title || d.url; more = d.title ? d.url : ""; }
    else if (kind === "items") { name = d.title; more = s.n.replace("{n}", d.items.length); }
    else if (kind === "files") {
      if (d.items.length === 1) { head = s.file; name = d.items[0].name; more = ""; }
      else { name = ""; more = s.n.replace("{n}", d.items.length); }
    }
    else { name = d.name; more = s.rows.replace("{n}", d.rows.length); }
    return [head, name, more].filter(function (x) { return !!x; }).join(" · ").slice(0, 240);
  }

  var API = {
    KINDS: KINDS, ORDER: ORDER, RECEIVERS: RECEIVERS,
    norm: norm, accepts: accepts, appsFor: appsFor, target: target, summary: summary
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (root) root.OrosSendCore = API;
})(typeof window !== "undefined" ? window : globalThis);
