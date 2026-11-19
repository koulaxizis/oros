// ============================================================
// orOS Files — tags.js (TAGS v1, wave T1): coloured tags on every
// file and folder of the orOS disk.
// ------------------------------------------------------------
// The tags themselves are Documents' list (files-docs `tags`, through
// OrosFilesDocs.tagList / ensureTag / putTag / dropTag), so Files has
// one list: a tag made here shows in Documents and the other way
// round. Which file carries which tag is in tags-core.js (slice
// "files-tags"); a file that is a document keeps its tags on the
// document instead (OrosFilesDocs.setDocTags), never two sets.
//
// Files loads this file with the Documents scripts (files.js
// loadDocs): at boot where tags or documents are stored, otherwise
// the first time the person picks Tags…. Then OrosFilesTags.init(ctx)
// with ctx { fs, vault, docs, toast, onChange, isTrash }.
//
// Everything is drawn with textContent; a tag name is never HTML.
// Exposes window.OrosFilesTags.
// ============================================================
(function () {
  "use strict";

  var CORE = window.OrosTagsCore;
  if (!CORE) return;
  var ROOT = "/internal";
  var COLOURS = 12;

  var LANG = window.orosI18n ? window.orosI18n.lang() : (function () {
    try { return localStorage.getItem("oros-lang") === "el" ? "el" : "en"; } catch (e) { return "en"; }
  })();
  var LOC = window.orosI18n ? window.orosI18n.locale(LANG) : (LANG === "el" ? "el-GR" : "en-GB");

  var STRINGS = {
    en: {
      "tg.tree":       "Tags",
      "tg.menu":       "Tags…",
      "tg.title":      "Tags",
      "tg.titleMany":  "Tags of {n} items",
      "tg.hint":       "Tick the tags this item should have. The same tags are used in Documents.",
      "tg.hintMany":   "A dash means only some of them have that tag; leave it as it is to keep it that way.",
      "tg.none":       "No tags yet. Type a name below to make the first one.",
      "tg.new":        "New tag",
      "tg.add":        "Add",
      "tg.save":       "Save",
      "tg.cancel":     "Cancel",
      "tg.edit":       "Edit tag {name}",
      "tg.editTitle":  "Edit tag",
      "tg.name":       "Name",
      "tg.colour":     "Colour",
      "tg.noColour":   "No colour",
      "tg.delete":     "Delete tag",
      "tg.deleteAsk":  "Delete the tag “{name}”? It comes off every file and document that has it. The files themselves stay as they are.",
      "tg.deleted":    "Tag deleted",
      "tg.saved":      "Tags saved",
      "tg.full":       "An item can have at most 20 tags",
      "tg.saveFail":   "The tags could not be saved",
      "tg.count":      "{n} items",
      "tg.countOne":   "1 item",
      "tg.empty":      "No files have this tag yet. Right-click a file (or select it and use the menu) and pick Tags….",
      "tg.onlyDisk":   "Tags are for files of the orOS disk",
      "tg.c.0": "Red", "tg.c.1": "Orange", "tg.c.2": "Yellow", "tg.c.3": "Lime", "tg.c.4": "Green", "tg.c.5": "Teal",
      "tg.c.6": "Blue", "tg.c.7": "Indigo", "tg.c.8": "Purple", "tg.c.9": "Pink", "tg.c.10": "Brown", "tg.c.11": "Grey",
      "tg.withTags":   "Tags: {list}"
    },
    el: {
      "tg.tree":       "Ετικέτες",
      "tg.menu":       "Ετικέτες…",
      "tg.title":      "Ετικέτες",
      "tg.titleMany":  "Ετικέτες για {n} στοιχεία",
      "tg.hint":       "Τσέκαρε τις ετικέτες που θέλεις να έχει. Οι ίδιες ετικέτες υπάρχουν και στα Έγγραφα.",
      "tg.hintMany":   "Η παύλα σημαίνει ότι την ετικέτα την έχουν μόνο κάποια· άφησέ την έτσι για να μείνει όπως είναι.",
      "tg.none":       "Δεν υπάρχουν ακόμα ετικέτες. Γράψε ένα όνομα από κάτω για να φτιάξεις την πρώτη.",
      "tg.new":        "Νέα ετικέτα",
      "tg.add":        "Προσθήκη",
      "tg.save":       "Αποθήκευση",
      "tg.cancel":     "Ακύρωση",
      "tg.edit":       "Επεξεργασία ετικέτας {name}",
      "tg.editTitle":  "Επεξεργασία ετικέτας",
      "tg.name":       "Όνομα",
      "tg.colour":     "Χρώμα",
      "tg.noColour":   "Χωρίς χρώμα",
      "tg.delete":     "Διαγραφή ετικέτας",
      "tg.deleteAsk":  "Να διαγραφεί η ετικέτα «{name}»; Θα φύγει από κάθε αρχείο και έγγραφο που την έχει. Τα ίδια τα αρχεία μένουν όπως είναι.",
      "tg.deleted":    "Η ετικέτα διαγράφηκε",
      "tg.saved":      "Οι ετικέτες αποθηκεύτηκαν",
      "tg.full":       "Ένα στοιχείο μπορεί να έχει έως 20 ετικέτες",
      "tg.saveFail":   "Δεν ήταν δυνατή η αποθήκευση των ετικετών",
      "tg.count":      "{n} στοιχεία",
      "tg.countOne":   "1 στοιχείο",
      "tg.empty":      "Κανένα αρχείο δεν έχει ακόμα αυτή την ετικέτα. Κάνε δεξί κλικ σε ένα αρχείο (ή επίλεξέ το και άνοιξε το μενού) και διάλεξε Ετικέτες….",
      "tg.onlyDisk":   "Οι ετικέτες είναι για αρχεία του δίσκου του orOS",
      "tg.c.0": "Κόκκινο", "tg.c.1": "Πορτοκαλί", "tg.c.2": "Κίτρινο", "tg.c.3": "Λαχανί", "tg.c.4": "Πράσινο", "tg.c.5": "Γαλαζοπράσινο",
      "tg.c.6": "Μπλε", "tg.c.7": "Λουλακί", "tg.c.8": "Μωβ", "tg.c.9": "Ροζ", "tg.c.10": "Καφέ", "tg.c.11": "Γκρι",
      "tg.withTags":   "Ετικέτες: {list}"
    }
  };
  if (window.orosI18n) window.orosI18n.table(STRINGS, "files", LANG);
  function t(k, vars) {
    var s = (STRINGS[LANG] && STRINGS[LANG][k]) || STRINGS.en[k] || k;
    if (vars) Object.keys(vars).forEach(function (v) { s = s.split("{" + v + "}").join(String(vars[v])); });
    return s;
  }

  var ICON = {
    tag:  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>',
    edit: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>'
  };

  // ---------- state ----------
  var ctx = null;
  var state = CORE.norm(null);
  var ix = null;                 // CORE.index(state), rebuilt after each change
  var docIx = null, docIxOf = null;   // path/hash → document, rebuilt when the docs list changes
  var hereSet = null, hereAt = 0;     // the vault's local paths, kept for 3 s

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function docs() { try { return ctx && ctx.docs ? ctx.docs() : null; } catch (e) { return null; } }
  function vault() {
    try { var v = ctx && ctx.vault ? ctx.vault() : null; return (v && typeof v.manifestEntry === "function") ? v : null; }
    catch (e) { return null; }
  }
  function syncApi() {
    try { return (window.parent && window.parent !== window && window.parent.orosSync) || null; } catch (e) { return null; }
  }
  function toast(s) { if (ctx && ctx.toast) ctx.toast(s); }
  function isTrash(p) { return p === ROOT + "/.trash" || String(p).indexOf(ROOT + "/.trash/") === 0; }
  function baseName(p) { return String(p).slice(String(p).lastIndexOf("/") + 1); }

  // ---------- storage + sync (slice "files-tags") ----------
  function load() {
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(CORE.KEY)); } catch (e) { raw = null; }
    state = CORE.norm(raw);
    ix = null;
  }
  function changed() {
    ix = null;
    if (ctx && ctx.onChange) ctx.onChange();
  }
  // R27: only a real change stores and marks sync dirty; R30: a failed
  // write is said once, never swallowed.
  function commit(next) {
    if (next === state || JSON.stringify(next) === JSON.stringify(state)) return false;
    state = next;
    try { localStorage.setItem(CORE.KEY, JSON.stringify(state)); }
    catch (e) { toast(t("tg.saveFail")); }
    var api = syncApi();
    if (api && typeof api.markDirty === "function") api.markDirty();
    changed();
    return true;
  }
  function registerSync() {
    var api = syncApi();
    if (!api || typeof api.registerSlice !== "function") return;
    api.registerSlice(CORE.SLICE, function () {
      return CORE.norm(state);
    }, function (incoming) {
      // R6: a pull never marks dirty.
      var next = CORE.norm(incoming);
      if (JSON.stringify(next) === JSON.stringify(state)) return;
      state = next;
      try { localStorage.setItem(CORE.KEY, JSON.stringify(state)); } catch (e) {}
      changed();
    }, CORE.KEY, CORE.merge);
  }

  // ---------- reading ----------
  function hashOf(p) {
    var v = vault(), e = null;
    try { e = v ? v.manifestEntry(p) : null; } catch (x) { e = null; }
    return e && typeof e.h === "string" ? e.h : "";
  }
  function here() {
    var v = vault();
    if (!v || typeof v.localPaths !== "function") return null;
    if (!hereSet || Date.now() - hereAt > 3000) {
      hereSet = {};
      try { v.localPaths().forEach(function (p) { hereSet[p] = true; }); } catch (e) {}
      hereAt = Date.now();
    }
    return function (p) { return !!hereSet[p]; };
  }
  function tagMap() {
    var out = {}, d = docs();
    (d && d.tagList ? d.tagList() : []).forEach(function (x) { out[x.id] = x; });
    return out;
  }
  function docIndex() {
    var d = docs(), rows = d && d.docRows ? d.docRows() : [];
    if (docIx && docIxOf === rows) return docIx;
    docIx = { byP: {}, byH: {} };
    rows.forEach(function (r) {
      docIx.byP[r.p] = r;
      if (r.h) docIx.byH[r.h] = docIx.byH[r.h] || r;
    });
    docIxOf = rows;
    return docIx;
  }
  function docFor(p, h) {
    var di = docIndex();
    return di.byP[p] || (h && di.byH[h]) || null;
  }
  // The tag ids on one item: its document's, else its own rows'.
  function idsAt(p, h) {
    if (h == null) h = hashOf(p);
    var d = docFor(p, h);
    if (!ix) ix = CORE.index(state);
    var own = CORE.tagsAt(ix, p, h, here());
    if (!d) return own;
    var all = (d.tg || []).slice();
    own.forEach(function (id) { if (all.indexOf(id) === -1) all.push(id); });
    return all;
  }
  // [{ id, n, c }] for one item, by name; tags no longer in the list
  // are left out.
  function tagsFor(p, h) {
    if (!CORE.okPath(p) || isTrash(p)) return [];
    var map = tagMap();
    return idsAt(p, h).map(function (id) { return map[id]; }).filter(Boolean)
      .sort(function (a, b) { return a.n.localeCompare(b.n, LOC); });
  }
  // The list with how many items carry each tag.
  function list() {
    var d = docs(), tags = d && d.tagList ? d.tagList() : [];
    var n = CORE.counts(state);
    (d && d.docRows ? d.docRows() : []).forEach(function (r) {
      (r.tg || []).forEach(function (id) { n[id] = (n[id] || 0) + 1; });
    });
    return tags.map(function (x) { return { id: x.id, n: x.n, c: x.c, count: n[x.id] || 0 }; })
      .sort(function (a, b) { return a.n.localeCompare(b.n, LOC); });
  }
  // The paths of every item with a tag (documents included), here on
  // this device, Trash left out. A hash row whose file is no longer at
  // its path is found again by its content (another device or app
  // moved it) and its path written back; the disk decides, never the
  // vault's list alone, which can be a moment behind a move made here.
  function pathsWith(id) {
    var fs = ctx && ctx.fs ? ctx.fs() : null;
    var seen = {}, cands = [];
    function push(p) { if (p && !seen[p] && !isTrash(p) && CORE.okPath(p)) { seen[p] = true; cands.push(p); } }
    var rows = CORE.withTag(state, id);
    rows.forEach(function (x) { push(x.p); });
    var d = docs();
    (d && d.docRows ? d.docRows() : []).forEach(function (r) { if ((r.tg || []).indexOf(id) !== -1) push(r.p); });
    function exists(p) {
      if (!fs) return Promise.resolve(true);
      return fs.stat(p).then(function (st) { return !!st; }, function () { return false; });
    }
    return Promise.all(cands.map(exists)).then(function (ok) {
      var there = {}, out = [];
      cands.forEach(function (p, i) { if (ok[i]) { there[p] = true; out.push(p); } });
      var lost = rows.filter(function (x) { return x.h && !there[x.p] && !isTrash(x.p); });
      var v = vault();
      if (!lost.length || !v || typeof v.localPaths !== "function") return out;
      var want = {}, found = [];
      lost.forEach(function (x) { want[x.h] = true; });
      try {
        v.localPaths().forEach(function (p) {
          if (isTrash(p) || there[p]) return;
          var e = v.manifestEntry(p);
          if (e && want[e.h]) found.push({ p: p, h: e.h });
        });
      } catch (e) { return out; }
      return Promise.all(found.map(function (e) { return exists(e.p); })).then(function (ok2) {
        var entries = Object.keys(there).map(function (p) { return { p: p }; });
        found.forEach(function (e, i) { if (ok2[i]) entries.push(e); });
        var r = CORE.relocate(state, entries, Date.now());
        if (r.moved) commit(r.state);
        CORE.withTag(state, id).forEach(function (x) { if (!there[x.p] && !isTrash(x.p) && entries.some(function (e) { return e.p === x.p; })) { there[x.p] = true; out.push(x.p); } });
        return out;
      });
    }).then(function (out) {
      // a hash row on a copy whose original is still here is not listed
      return out.filter(function (p) { return idsAt(p).indexOf(id) !== -1; });
    });
  }

  // ---------- writing ----------
  // ids: the full set this item should have now.
  function apply(p, want) {
    var h = hashOf(p), d = docFor(p, h), D = docs();
    var have = idsAt(p, h);
    if (d && D && D.setDocTags) {
      if (have.join(",") !== want.join(",") || (d.tg || []).slice().sort().join(",") !== want.slice().sort().join(",")) D.setDocTags(d.id, want);
      // its own rows (from before it was a document) go: one set
      if (!ix) ix = CORE.index(state);
      var own = CORE.tagsAt(ix, p, h, here());
      if (own.length) commit(CORE.setTags(state, p, h, [], own, Date.now()));
      return true;
    }
    var add = want.filter(function (id) { return have.indexOf(id) === -1; });
    var rm = have.filter(function (id) { return want.indexOf(id) === -1; });
    if (!add.length && !rm.length) return true;
    var next = CORE.setTags(state, p, h, add, rm, Date.now());
    if (next === state && add.length) return false;
    commit(next);
    return true;
  }
  function carry(from, to) { commit(CORE.carry(state, from, to, Date.now())); }
  function dropPath(p) { commit(CORE.dropPath(state, p, Date.now())); }

  // ---------- dialogs ----------
  function modal(cls) {
    var d = el("dialog", "tag-dlg" + (cls ? " " + cls : ""));
    d.addEventListener("close", function () { d.remove(); });
    document.body.appendChild(d);
    return d;
  }
  function btn(cls, label, fn) {
    var b = el("button", cls, label);
    b.type = "button";
    if (fn) b.addEventListener("click", fn);
    return b;
  }
  function dot(c) {
    var s = el("span", "tag-dot");
    if (c != null) s.dataset.c = String(c);
    s.setAttribute("aria-hidden", "true");
    return s;
  }

  // Tags… for one or more items of the disk.
  function edit(paths) {
    paths = (paths || []).filter(function (p) { return CORE.okPath(p) && !isTrash(p); });
    if (!paths.length) { toast(t("tg.onlyDisk")); return; }
    var D = docs();
    if (!D || !D.tagList) return;
    var per = paths.map(function (p) { return idsAt(p); });
    var marks = {};       // id → true | false | "mixed"
    function initial(id) {
      var n = per.filter(function (ids) { return ids.indexOf(id) !== -1; }).length;
      return n === 0 ? false : n === paths.length ? true : "mixed";
    }
    var d = modal("tag-edit");
    var f = el("form");
    f.setAttribute("autocomplete", "off");
    f.appendChild(el("h3", "", paths.length === 1 ? t("tg.title") + ": " + baseName(paths[0]) : t("tg.titleMany", { n: paths.length })));
    f.appendChild(el("p", "", paths.length === 1 ? t("tg.hint") : t("tg.hint") + " " + t("tg.hintMany")));
    var ul = el("ul", "tag-list");
    f.appendChild(ul);
    function paint() {
      ul.innerHTML = "";
      var all = list();
      if (!all.length) { ul.appendChild(el("li", "tag-empty", t("tg.none"))); return; }
      all.forEach(function (x) {
        if (marks[x.id] == null) marks[x.id] = initial(x.id);
        var li = el("li", "tag-item");
        var lab = el("label", "tag-check");
        var cb = el("input");
        cb.type = "checkbox";
        cb.checked = marks[x.id] === true;
        cb.indeterminate = marks[x.id] === "mixed";
        cb.addEventListener("change", function () { marks[x.id] = cb.checked; });
        lab.appendChild(cb);
        lab.appendChild(dot(x.c));
        lab.appendChild(el("span", "tag-name", x.n));
        li.appendChild(lab);
        var e = btn("tag-edit-btn", "", function () {
          editTag(x.id).then(function () { paint(); });
        });
        e.innerHTML = ICON.edit;
        e.title = t("tg.edit", { name: x.n });
        e.setAttribute("aria-label", e.title);
        li.appendChild(e);
        ul.appendChild(li);
      });
    }
    paint();
    var addRow = el("div", "tag-add");
    var inp = el("input");
    inp.type = "text";
    inp.maxLength = 60;
    inp.placeholder = t("tg.new");
    inp.setAttribute("aria-label", t("tg.new"));
    addRow.appendChild(inp);
    function takeNew() {
      var v = inp.value.replace(/\s+/g, " ").trim();
      if (!v) return;
      var id = D.ensureTag(v);
      inp.value = "";
      if (id) marks[id] = true;
      paint();
      inp.focus();
    }
    addRow.appendChild(btn("", t("tg.add"), takeNew));
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); takeNew(); } });
    f.appendChild(addRow);
    var row = el("menu", "dlg-row");
    row.appendChild(el("span", "spacer"));
    row.appendChild(btn("", t("tg.cancel"), function () { d.close(); }));
    var ok = el("button", "", t("tg.save"));
    ok.type = "submit";
    row.appendChild(ok);
    f.appendChild(row);
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      if (inp.value.trim()) takeNew();
      var live = tagMap(), full = false;
      paths.forEach(function (p, i) {
        var want = per[i].filter(function (id) { return live[id] && marks[id] !== false; });
        Object.keys(marks).forEach(function (id) { if (marks[id] === true && live[id] && want.indexOf(id) === -1) want.push(id); });
        want.sort();
        if (want.length > CORE.MAX_ON) { full = true; want = want.slice(0, CORE.MAX_ON); }
        if (!apply(p, want)) full = true;
      });
      d.close();
      toast(full ? t("tg.full") : t("tg.saved"));
    });
    d.appendChild(f);
    d.showModal();
  }

  // Rename, colour or delete one tag (the list is Documents').
  function editTag(id) {
    return new Promise(function (resolve) {
      var D = docs(), x = tagMap()[id];
      if (!D || !x) { resolve(false); return; }
      var d = modal("tag-one");
      var f = el("form");
      f.setAttribute("autocomplete", "off");
      f.appendChild(el("h3", "", t("tg.editTitle")));
      var lab = el("label", "tag-field");
      lab.appendChild(el("span", "", t("tg.name")));
      var name = el("input");
      name.type = "text";
      name.maxLength = 60;
      name.value = x.n;
      lab.appendChild(name);
      f.appendChild(lab);
      var fs = el("fieldset", "tag-colours");
      fs.appendChild(el("legend", "", t("tg.colour")));
      var pick = x.c == null ? -1 : x.c;
      for (var c = -1; c < COLOURS; c++) {
        (function (c) {
          var l = el("label", "tag-swatch");
          var r = el("input");
          r.type = "radio";
          r.name = "tag-colour";
          r.value = String(c);
          r.checked = c === pick;
          r.addEventListener("change", function () { if (r.checked) pick = c; });
          l.appendChild(r);
          var s = dot(c < 0 ? null : c);
          s.classList.add("big");
          l.appendChild(s);
          var txt = el("span", "tag-swatch-name", c < 0 ? t("tg.noColour") : t("tg.c." + c));
          l.appendChild(txt);
          l.title = txt.textContent;
          fs.appendChild(l);
        })(c);
      }
      f.appendChild(fs);
      var row = el("menu", "dlg-row");
      row.appendChild(btn("danger", t("tg.delete"), function () {
        confirmBox(t("tg.deleteAsk", { name: x.n }), t("tg.delete")).then(function (yes) {
          if (!yes) return;
          D.dropTag(id);
          commit(CORE.stripTag(state, id, Date.now()));
          d.close();
          toast(t("tg.deleted"));
          resolve(true);
        });
      }));
      row.appendChild(el("span", "spacer"));
      row.appendChild(btn("", t("tg.cancel"), function () { d.close(); }));
      var ok = el("button", "", t("tg.save"));
      ok.type = "submit";
      row.appendChild(ok);
      f.appendChild(row);
      f.addEventListener("submit", function (e) {
        e.preventDefault();
        var n = name.value.replace(/\s+/g, " ").trim();
        if (n) D.putTag(id, n, pick < 0 ? null : pick);
        d.close();
        resolve(true);
      });
      d.addEventListener("close", function () { resolve(false); });
      d.appendChild(f);
      d.showModal();
      name.focus();
    });
  }
  function confirmBox(text, okLabel) {
    return new Promise(function (resolve) {
      var d = modal("tag-confirm");
      d.appendChild(el("p", "", text));
      var row = el("menu", "dlg-row");
      row.appendChild(el("span", "spacer"));
      row.appendChild(btn("", t("tg.cancel"), function () { d.close(); resolve(false); }));
      row.appendChild(btn("danger", okLabel, function () { d.close(); resolve(true); }));
      d.appendChild(row);
      d.addEventListener("cancel", function () { resolve(false); });
      d.showModal();
    });
  }

  // ---------- drawing helpers for Files and Photos ----------
  // Up to three dots and "+n"; the names in the title for the pointer
  // and in aria-label for screen readers.
  function dots(tags) {
    var s = el("span", "tag-dots");
    tags.slice(0, 3).forEach(function (x) { s.appendChild(dot(x.c)); });
    if (tags.length > 3) s.appendChild(el("span", "tag-more", "+" + (tags.length - 3)));
    var names = tags.map(function (x) { return x.n; }).join(", ");
    s.title = t("tg.withTags", { list: names });
    s.setAttribute("role", "img");
    s.setAttribute("aria-label", s.title);
    return s;
  }

  function init(c) {
    ctx = c || {};
    load();
    registerSync();
    window.addEventListener("storage", function (e) {
      if (e.key === CORE.KEY) { load(); changed(); }
    });
  }

  window.OrosFilesTags = {
    init: init,
    t: t,
    icon: ICON.tag,
    list: list,
    tagsFor: tagsFor,
    pathsWith: pathsWith,
    edit: edit,
    editTag: editTag,
    dots: dots,
    dot: dot,
    carry: carry,
    dropPath: dropPath,
    hasAny: function () { return CORE.hasAny(state) || list().length > 0; },
    state: function () { return state; }
  };
})();
