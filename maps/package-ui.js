// ============================================================
// orOS Maps — package-ui.js (.orosmap files, v1.0.0)
// "orOS file" (Saved places bar and My tracks): a dialog that saves
// the favourite groups and tracks the user ticks as one .orosmap
// (../bundle.js + package.js), and opens an unzipped one ("Unzipped
// orOS folder…"). A picked .orosmap (Import buttons, "Open with"
// orOS) reaches openBytes through import-ui.js.
// Opening adds, never replaces: every track comes in as a NEW track
// (fresh id, its colour, folder and hidden flag), every group as a
// NEW group (fresh id, its colour; a name the user has already gets
// " (2)"), and the places that are not saved yet (a place's id is
// its coordinates, so one the user has stays exactly as it is). One
// toast with Undo takes it all out again (sync-safe tombstones, as
// "Import from another app").
// Safety: names from files reach the page through textContent only;
// package.js cuts the content to the app's limits and runs each
// track through the strict GPX reader.
// ============================================================
(function () {
  "use strict";
  var PKG = window.OrosMapsPackage;
  var H = window.__orosMapsHost;
  if (!PKG || !H || !H.map) return;
  var LANG = H.lang === "el" ? "el" : "en";
  var MIME = "application/x-oros-map";

  var STR = {
    en: {
      "btn": "orOS file",
      "title": "orOS file (.orosmap)",
      "intro": "Save the lists and tracks you pick as one file, to keep or to share. Open it with Import.",
      "name": "Name", "def": "My places and tracks",
      "places": "Saved places", "tracks": "My tracks", "all": "All",
      "none": "No group", "count1": "1 place", "count": "{n} places",
      "notracks": "No tracks yet.", "noplaces": "No saved places yet.",
      "save": "Save", "busy": "Saving…", "cancel": "Cancel",
      "empty": "Tick at least one list or track.",
      "missing": "Not on this device yet, so left out: {n}",
      "folder": "Unzipped orOS folder…",
      "done": "Opened. Tracks: {t}, places: {p}",
      "nothing": "Nothing new in this file: you have all of it already.",
      "undo": "Undo", "undone": "Taken out again",
      "bad": "This orOS file could not be opened.",
      "newer": "This file was made by a newer orOS. Update orOS to open it.",
      "fail": "The orOS file could not be made.",
      "nodlg": "Saving files is not available here.",
      "nosave": "Could not save the tracks."
    },
    el: {
      "btn": "Αρχείο orOS",
      "title": "Αρχείο orOS (.orosmap)",
      "intro": "Σώσε τις λίστες και τις διαδρομές που διαλέγεις σε ένα αρχείο, για να το κρατήσεις ή να το μοιραστείς. Το ανοίγεις με την Εισαγωγή.",
      "name": "Όνομα", "def": "Οι τοποθεσίες και οι διαδρομές μου",
      "places": "Αποθηκευμένες τοποθεσίες", "tracks": "Οι διαδρομές μου", "all": "Όλες",
      "none": "Χωρίς ομάδα", "count1": "1 τοποθεσία", "count": "{n} τοποθεσίες",
      "notracks": "Δεν υπάρχουν διαδρομές ακόμα.", "noplaces": "Δεν υπάρχουν αποθηκευμένες τοποθεσίες ακόμα.",
      "save": "Αποθήκευση", "busy": "Γίνεται αποθήκευση…", "cancel": "Άκυρο",
      "empty": "Διάλεξε τουλάχιστον μία λίστα ή διαδρομή.",
      "missing": "Δεν είναι ακόμα σε αυτή τη συσκευή, οπότε παραλείπονται: {n}",
      "folder": "Αποσυμπιεσμένος φάκελος orOS…",
      "done": "Άνοιξε. Διαδρομές: {t}, τοποθεσίες: {p}",
      "nothing": "Τίποτα νέο σε αυτό το αρχείο: τα έχεις ήδη όλα.",
      "undo": "Αναίρεση", "undone": "Αφαιρέθηκαν ξανά",
      "bad": "Δεν ήταν δυνατό να ανοίξει αυτό το αρχείο orOS.",
      "newer": "Το αρχείο φτιάχτηκε από νεότερο orOS. Ενημέρωσε το orOS για να το ανοίξεις.",
      "fail": "Δεν ήταν δυνατό να φτιαχτεί το αρχείο orOS.",
      "nodlg": "Η αποθήκευση αρχείων δεν είναι διαθέσιμη εδώ.",
      "nosave": "Οι διαδρομές δεν αποθηκεύτηκαν."
    }
  };
  function t(k, vars) {
    var s = STR[LANG][k] !== undefined ? STR[LANG][k] : STR.en[k];
    if (s === undefined) s = k;
    if (vars) Object.keys(vars).forEach(function (v) { s = s.split("{" + v + "}").join(String(vars[v])); });
    return s;
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function button(label, cls, fn) {
    var b = el("button", cls, label);
    b.type = "button";
    if (fn) b.addEventListener("click", fn);
    return b;
  }
  function toast(s) { (H.toast || H.localToast)(s); }
  function tracksApi() { return window.__orosMapsTracks || null; }
  function favApi() { return window.__orosMapsFav || null; }
  function ready() { return !!window.OrosBundle; }
  function dialogHost() {
    try { return window.orosDialog || (window.parent && window.parent.orosDialog) || null; }
    catch (e) { return window.orosDialog || null; }
  }
  function fileName(title) {
    return (String(title || "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").trim().slice(0, 80) || "map") + ".orosmap";
  }

  // ---------- open ----------
  // The first bytes say whether a file is a bundle (PK + "mimetype").
  // Another ZIP (a Takeout export) goes the old way, unless it is named
  // .orosmap: then the bundle reader says what is wrong with it.
  function isBundle(name, bytes) {
    if (!ready() || !bytes) return false;
    return !!OrosBundle.sniff(bytes.subarray(0, 128)) || /\.orosmap$/i.test(String(name || ""));
  }
  function fail(e) {
    console.error("[orOS] maps bundle open failed:", e);
    toast(e && e.code === "newer" ? t("newer") : t("bad"));
  }
  function openBytes(bytes) {
    if (!ready()) return Promise.resolve(false);
    return OrosBundle.read(bytes, { mime: MIME }).then(apply).then(null, function (e) { fail(e); return false; });
  }
  function openFolder() {
    if (!ready()) return Promise.resolve(false);
    return OrosBundle.pickFolder().then(function (files) {
      if (!files) return false;
      return OrosBundle.readFolder(files, { mime: MIME }).then(apply);
    }).then(null, function (e) { fail(e); return false; });
  }
  // A read bundle → new tracks, new groups, the places not saved yet.
  function apply(r) {
    var FCm = window.OrosMapsFav, TR = tracksApi(), F = favApi();
    var pl = PKG.parse(r && r.content, { colors: FCm ? FCm.COLORS : [], T: window.OrosMapsTracks });
    if (!pl.tracks.length && !pl.places.length) { toast(t("bad")); return false; }
    var tp = TR && pl.tracks.length
      ? TR.addImported(pl.tracks.map(function (x) {
          return { id: TR.newId(), name: x.name, folder: x.folder, color: x.color, hidden: x.hidden, tr: x.tr };
        })).catch(function () { toast(t("nosave")); return []; })
      : Promise.resolve([]);
    return tp.then(function (tIds) {
      var pIds = pl.places.length && typeof H.importPlaces === "function" ? H.importPlaces(pl.places) : [];
      var added = {};
      pIds.forEach(function (id) { added[id] = 1; });
      var byGroup = pl.groups.map(function (g) { return { name: g.name, color: g.color, pids: [] }; });
      pl.places.forEach(function (p) {
        var id = H.placeId(p.lat, p.lon);
        if (added[id] && p.group >= 0) byGroup[p.group].pids.push(id);
      });
      var pins = F && F.importGroups ? F.importGroups(byGroup) : null;
      if (pins) H.refreshPlaces();
      if (!tIds.length && !pIds.length) { toast(t("nothing")); return true; }
      if (TR && tIds.length === 1 && !pIds.length) { TR.setMode(true); TR.open(tIds[0]); }
      var used = false;
      H.localToast(t("done", { t: tIds.length, p: pIds.length }), t("undo"), function () {
        if (used) return;
        used = true;
        if (TR && tIds.length) TR.removeImported(tIds);
        if (pIds.length) H.unimportPlaces(pIds);
        if (F && pins) { F.undoPins(pins); H.refreshPlaces(); }
        toast(t("undone"));
      });
      return true;
    });
  }

  // ---------- save ----------
  function check(label, on, cls) {
    var lab = el("label", "trn-check imp-check" + (cls ? " " + cls : "")), cb = el("input");
    cb.type = "checkbox";
    cb.checked = on;
    lab.appendChild(cb);
    lab.appendChild(el("span", "", label));
    return { lab: lab, cb: cb };
  }
  // A section: an "All" box over a list of boxes; returns the boxes.
  function section(dlg, head, rows, emptyText) {
    var sec = el("div", "imp-sec pkg-sec");
    sec.appendChild(el("div", "imp-h4", head));
    if (!rows.length) { sec.appendChild(el("p", "osm-small", emptyText)); dlg.appendChild(sec); return []; }
    var all = check(t("all"), true, "pkg-all");
    sec.appendChild(all.lab);
    var box = el("div", "pkg-list"), boxes = [];
    rows.forEach(function (r) {
      var c = check(r.label, true);
      c.cb.value = r.value;
      box.appendChild(c.lab);
      boxes.push(c.cb);
      c.cb.addEventListener("change", function () {
        var n = boxes.filter(function (b) { return b.checked; }).length;
        all.cb.checked = n === boxes.length;
        all.cb.indeterminate = n > 0 && n < boxes.length;
      });
    });
    all.cb.addEventListener("change", function () {
      all.cb.indeterminate = false;
      boxes.forEach(function (b) { b.checked = all.cb.checked; });
    });
    sec.appendChild(box);
    dlg.appendChild(sec);
    return boxes;
  }

  function dialog() {
    var F = favApi(), TR = tracksApi();
    var dlg = el("dialog", "osm-dlg imp-dlg pkg-dlg");
    dlg.setAttribute("aria-labelledby", "pkg-h");
    var h = el("h3", "", t("title"));
    h.id = "pkg-h";
    dlg.appendChild(h);
    dlg.appendChild(el("p", "osm-small", t("intro")));
    var lab = el("label", "osm-lab", t("name"));
    var name = el("input", "osm-in");
    name.maxLength = PKG.LIM.title;
    name.value = t("def");
    lab.appendChild(name);
    dlg.appendChild(lab);

    var places = H.places() || [];
    var fd = F && F.data ? F.data() : { groups: {}, pins: {} };
    var secs = F && F.sections ? F.sections(places) : [{ g: "", places: places }];
    secs = secs.filter(function (s) { return s.places.length; });
    var gBoxes = section(dlg, t("places"), secs.map(function (s) {
      var n = s.places.length;
      return { value: s.g, label: (s.g ? fd.groups[s.g].name : t("none")) + " · " + (n === 1 ? t("count1") : t("count", { n: n })) };
    }), t("noplaces"));
    var entries = [];
    if (TR && TR.data) {
      var d = TR.data();
      entries = Object.keys(d.tracks).map(function (k) { return d.tracks[k]; })
        .sort(function (a, b) { return (b.start || b.m) - (a.start || a.m) || (a.id < b.id ? -1 : 1); });
    }
    var tBoxes = section(dlg, t("tracks"), entries.map(function (e) {
      return { value: e.id, label: TR.nameOf(e) + (e.folder ? " · " + e.folder : "") };
    }), t("notracks"));

    var note = el("p", "osm-small imp-note");
    note.hidden = true;
    note.setAttribute("aria-live", "polite");
    dlg.appendChild(note);
    var actions = el("div", "osm-actions");
    var go = button(t("save"), "osm-btn primary pkg-save", run);
    actions.appendChild(go);
    actions.appendChild(button(t("cancel"), "osm-btn", function () { if (!busy) close(); }));
    dlg.appendChild(actions);
    var more = el("div", "osm-actions pkg-more");
    more.appendChild(button(t("folder"), "osm-btn pkg-folder", function () {
      if (busy) return;
      close();
      openFolder();
    }));
    dlg.appendChild(more);

    var busy = false;
    function close() { if (dlg.open) dlg.close(); dlg.remove(); }
    dlg.addEventListener("cancel", function (ev) { ev.preventDefault(); if (!busy) close(); });

    function run() {
      if (busy) return;
      var gs = {}, ids = [];
      gBoxes.forEach(function (b) { if (b.checked) gs[b.value] = 1; });
      tBoxes.forEach(function (b) { if (b.checked) ids.push(b.value); });
      var pins = {};
      var pick = [];
      secs.forEach(function (s) {
        if (!gs[s.g]) return;
        s.places.forEach(function (p) { pick.push(p); if (s.g) pins[p.id] = s.g; });
      });
      if (!pick.length && !ids.length) { note.textContent = t("empty"); note.hidden = false; return; }
      var host = dialogHost();
      if (!host || typeof host.saveFile !== "function") { toast(t("nodlg")); return; }
      busy = true;
      go.disabled = true;
      go.textContent = t("busy");
      var d = TR && TR.data ? TR.data() : { tracks: {} }, missing = 0, tracks = [];
      ids.reduce(function (p, id) {
        return p.then(function () {
          var e = d.tracks[id];
          if (!e) return;
          return TR.read(id).then(function (tr) { tracks.push({ entry: e, tr: tr }); }, function () { missing++; });
        });
      }, Promise.resolve()).then(function () {
        if (!pick.length && !tracks.length) throw new Error("empty");
        var title = name.value.trim() || t("def");
        var built = PKG.build({ title: title, places: pick, groups: fd.groups, pins: pins, tracks: tracks }, window.OrosMapsTracks);
        return OrosBundle.write({
          mime: MIME, app: "maps", schema: "maps/1", content: built.content,
          meta: { title: built.title || title, created: built.created || undefined, modified: built.modified || undefined,
                  language: LANG, generator: "orOS Maps" },
          media: {}, preview: built.preview, date: new Date()
        }).then(function (bytes) {
          busy = false;
          close();
          if (missing) toast(t("missing", { n: missing }));
          return host.saveFile({ blob: new Blob([bytes], { type: MIME }), filename: fileName(title), mime: MIME,
            types: [{ description: "orOS Maps", accept: { "application/x-oros-map": [".orosmap"] } }] });
        });
      }).then(null, function (e) {
        console.error("[orOS] maps bundle failed:", e);
        busy = false;
        go.disabled = false;
        go.textContent = t("save");
        if (e && e.message === "empty") { note.textContent = t("missing", { n: missing }); note.hidden = false; }
        else toast(t("fail"));
      });
    }

    document.body.appendChild(dlg);
    dlg.showModal();
    return dlg;
  }

  window.__orosMapsPackage = {
    label: function () { return t("btn"); },
    dialog: function () { return ready() ? dialog() : null; },
    isBundle: isBundle, openBytes: openBytes, openFolder: openFolder, apply: apply
  };

  // The Saved places bar (fav.js built it before this file loaded).
  var bar = document.querySelector("#places .fav-bar");
  if (bar && ready()) bar.appendChild(button(t("btn"), "osm-btn fav-oros", function () { dialog(); }));
})();
