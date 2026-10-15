// ============================================================
// orOS Maps — import-ui.js ("Import from another app", v1.0.0)
// The Import buttons of My tracks and Saved places (and "Open with"
// orOS) come here: picker → read → import.js (pure) → a preview →
// Import → the writes → a toast with Undo.
//   - GPX, KML and GeoJSON files go back to their old path (the
//     caller's plain handler); an orOS bundle (.orosmap) goes to
//     package-ui.js; everything else is read by import.js.
//   - Preview: the source, what goes where (My tracks and its folder,
//     Saved places and a group per list), how many are there already,
//     the dates, what is skipped (no coordinates) and the limits.
//   - Google Timeline is personal: the preview says it stays on this
//     device unless Maps data is synced, and nothing is imported until
//     the user picks the days (From / To); then one track per day and,
//     if wanted, the visited places.
//   - Import: tracks.js addImported (GPX files, then one index write),
//     maps.js importPlaces (one write), fav.js importPins (one write).
//     Ids are stable (import.js), so a second import adds only what
//     is missing; what the user has is never changed. Undo: tombstones
//     and restored pins, newer than the import (sync-safe).
// Safety: text from files reaches the page through textContent only.
// ============================================================
(function () {
  "use strict";
  var IMP = window.OrosMapsImport;
  var K = window.OrosImportKit;
  var H = window.__orosMapsHost;
  if (!IMP || !K || !H) return;
  var LANG = H.lang === "el" ? "el" : "en";
  var MAX_DAYS = 366;

  var STR = {
    en: {
      "title": "Import from another app",
      "src.kmz": "KMZ (Organic Maps, OsmAnd, Google My Maps, Google Earth)",
      "src.gsaved": "Google Maps saved places",
      "src.glist": "Google Maps lists",
      "src.timeline": "Google Timeline",
      "src.tcx": "Garmin TCX",
      "src.fit": "Garmin FIT",
      "tracks": "Tracks: {n}",
      "tracks.where": "They go to My tracks.",
      "tracks.folder": "They go to My tracks, folder {f}.",
      "tracks.dates": "From {a} to {b}",
      "there.t": "Already in My tracks: {n} (left as they are).",
      "places": "Places: {n}",
      "places.where": "They go to Saved places, a group per list: {g}.",
      "there.p": "Already saved: {n} (left as they are).",
      "skipped": "Skipped, without coordinates: {n}. Google keeps only a link for many saved places; open them in Google Maps if you need them.",
      "full.t": "My tracks holds at most {n} tracks: only the first {k} fit.",
      "full.p": "Only the first {k} places fit in your groups.",
      "tl.head": "Google Timeline",
      "tl.private": "Your location history is personal. It stays on this device, unless you sync Maps data with your other devices.",
      "tl.range": "Data from {a} to {b} ({n} days). Pick the days to import:",
      "tl.from": "From", "tl.to": "To",
      "tl.tracks": "A track for each day (My tracks, folder {f})",
      "tl.places": "Visited places as saved places (group {g})",
      "tl.pick": "Nothing is imported until you pick the days.",
      "tl.sum": "Days with a track: {d} · places: {v}",
      "tl.max": "Pick at most {n} days at a time.",
      "tl.folder": "Timeline", "tl.name": "Timeline {d}", "tl.group": "Timeline places",
      "tl.home": "Home", "tl.work": "Work", "tl.place": "Visited place",
      "tl.visits1": "1 visit", "tl.visits": "{n} visits",
      "go": "Import", "busy": "Importing…", "cancel": "Cancel",
      "done": "Imported. Tracks: {t}, places: {p}",
      "nothing": "Nothing new to import",
      "undo": "Undo", "undone": "Import undone",
      "err.read": "This file couldn't be read.",
      "err.big": "This file is too large to import (100 MB at most).",
      "err.unknown": "Maps can't read this file. It takes GPX, KML, KMZ, GeoJSON, TCX, FIT and Google Takeout or Timeline exports.",
      "err.save": "Could not save the tracks."
    },
    el: {
      "title": "Εισαγωγή από άλλη εφαρμογή",
      "src.kmz": "KMZ (Organic Maps, OsmAnd, Google My Maps, Google Earth)",
      "src.gsaved": "Αποθηκευμένα μέρη των Χαρτών Google",
      "src.glist": "Λίστες των Χαρτών Google",
      "src.timeline": "Χρονολόγιο Google",
      "src.tcx": "Garmin TCX",
      "src.fit": "Garmin FIT",
      "tracks": "Διαδρομές: {n}",
      "tracks.where": "Μπαίνουν στις Διαδρομές μου.",
      "tracks.folder": "Μπαίνουν στις Διαδρομές μου, στον φάκελο {f}.",
      "tracks.dates": "Από {a} έως {b}",
      "there.t": "Ήδη στις Διαδρομές μου: {n} (μένουν όπως είναι).",
      "places": "Τοποθεσίες: {n}",
      "places.where": "Μπαίνουν στις Αποθηκευμένες τοποθεσίες, σε μια ομάδα ανά λίστα: {g}.",
      "there.p": "Ήδη αποθηκευμένες: {n} (μένουν όπως είναι).",
      "skipped": "Παραλείπονται, χωρίς συντεταγμένες: {n}. Η Google κρατά μόνο έναν σύνδεσμο για πολλά αποθηκευμένα μέρη· άνοιξέ τα στους Χάρτες Google αν τα χρειάζεσαι.",
      "full.t": "Οι Διαδρομές μου χωρούν έως {n} διαδρομές: μπαίνουν μόνο οι πρώτες {k}.",
      "full.p": "Στις ομάδες σου χωρούν μόνο οι πρώτες {k} τοποθεσίες.",
      "tl.head": "Χρονολόγιο Google",
      "tl.private": "Το ιστορικό τοποθεσιών σου είναι προσωπικό. Μένει σε αυτή τη συσκευή, εκτός αν συγχρονίζεις τα δεδομένα των Χαρτών με τις άλλες συσκευές σου.",
      "tl.range": "Δεδομένα από {a} έως {b} ({n} ημέρες). Διάλεξε τις ημέρες για εισαγωγή:",
      "tl.from": "Από", "tl.to": "Έως",
      "tl.tracks": "Μια διαδρομή για κάθε ημέρα (Διαδρομές μου, φάκελος {f})",
      "tl.places": "Τα μέρη που επισκέφθηκες ως αποθηκευμένες τοποθεσίες (ομάδα {g})",
      "tl.pick": "Δεν εισάγεται τίποτα πριν διαλέξεις τις ημέρες.",
      "tl.sum": "Ημέρες με διαδρομή: {d} · μέρη: {v}",
      "tl.max": "Διάλεξε έως {n} ημέρες κάθε φορά.",
      "tl.folder": "Χρονολόγιο", "tl.name": "Χρονολόγιο {d}", "tl.group": "Μέρη από το Χρονολόγιο",
      "tl.home": "Σπίτι", "tl.work": "Δουλειά", "tl.place": "Μέρος που επισκέφθηκες",
      "tl.visits1": "1 επίσκεψη", "tl.visits": "{n} επισκέψεις",
      "go": "Εισαγωγή", "busy": "Γίνεται εισαγωγή…", "cancel": "Άκυρο",
      "done": "Έγινε η εισαγωγή. Διαδρομές: {t}, τοποθεσίες: {p}",
      "nothing": "Δεν υπάρχει κάτι νέο για εισαγωγή",
      "undo": "Αναίρεση", "undone": "Η εισαγωγή αναιρέθηκε",
      "err.read": "Δεν ήταν δυνατό να διαβαστεί το αρχείο.",
      "err.big": "Το αρχείο είναι πολύ μεγάλο για εισαγωγή (έως 100 MB).",
      "err.unknown": "Οι Χάρτες δεν μπορούν να διαβάσουν αυτό το αρχείο. Δέχονται GPX, KML, KMZ, GeoJSON, TCX, FIT και εξαγωγές του Google Takeout ή του Χρονολογίου.",
      "err.save": "Οι διαδρομές δεν αποθηκεύτηκαν."
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
  function fmt(n) {
    try { return Number(n).toLocaleString(LANG === "el" ? "el-GR" : "en-GB"); } catch (e) { return String(n); }
  }
  function fmtDay(ymd) {
    var m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(ymd || "");
    if (!m) return ymd || "";
    try {
      return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString(LANG === "el" ? "el-GR" : "en-GB",
        { day: "numeric", month: "short", year: "numeric" });
    } catch (e) { return ymd; }
  }
  function daysBetween(a, b) {
    var x = /^(\d{4})-(\d\d)-(\d\d)$/.exec(a), y = /^(\d{4})-(\d\d)-(\d\d)$/.exec(b);
    if (!x || !y) return 0;
    return Math.round((Date.UTC(+y[1], +y[2] - 1, +y[3]) - Date.UTC(+x[1], +x[2] - 1, +x[3])) / 86400000) + 1;
  }
  function tracksApi() { return window.__orosMapsTracks || null; }
  function favApi() { return window.__orosMapsFav || null; }

  // ---------- picker ----------
  function pick(after) {
    var host = null;
    try { host = window.parent && window.parent !== window ? window.parent.orosDialog : null; } catch (e) { host = null; }
    if (host && typeof host.openFiles === "function") {
      host.openFiles(IMP.ACCEPT).then(function (files) { if (files && files.length) after(files); }, function () {});
      return;
    }
    var inp = document.createElement("input");               // standalone page
    inp.type = "file";
    inp.accept = IMP.ACCEPT;
    inp.multiple = true;
    inp.hidden = true;
    inp.addEventListener("change", function () {
      var files = Array.prototype.slice.call(inp.files || []);
      inp.remove();
      if (files.length) after(files);
    });
    inp.addEventListener("cancel", function () { inp.remove(); });
    document.body.appendChild(inp);
    inp.click();
  }

  // ---------- read: plain files to `plainFn`, the rest to the preview ----------
  // Returns a Promise (for "Open with" and the tests).
  function files(list, plainFn) {
    list = Array.prototype.slice.call(list || []).filter(Boolean).slice(0, 200);
    var plain = [], results = [], bundles = [], err = "";
    return list.reduce(function (p, f) {
      return p.then(function () {
        return K.readFile(f, IMP.MAX_FILE).then(function (r) {
          // an orOS bundle (.orosmap): package-ui.js opens it
          var PK = window.__orosMapsPackage;
          if (PK && PK.isBundle(r.name, r.bytes)) { bundles.push(r.bytes); return; }
          var kind = IMP.kind(r.name, r.bytes);
          if (kind !== "new") { plain.push(f); return; }
          return IMP.parse(r).then(function (res) {
            if (res) results.push(res); else err = err || "err.unknown";
          });
        }, function (e) { err = e && e.message === "toobig" ? "err.big" : "err.read"; });
      });
    }, Promise.resolve()).then(function () {
      var chain = plain.length && typeof plainFn === "function" ? Promise.resolve(plainFn(plain)) : Promise.resolve();
      bundles.forEach(function (b) { chain = chain.then(function () { return window.__orosMapsPackage.openBytes(b); }); });
      return chain.then(function () {
        var res = IMP.merge(results);
        if (!res) { if (err) toast(t(err)); return null; }
        preview(res);
        return res;
      });
    });
  }

  // ---------- what Maps has now ----------
  function have() {
    var out = { tracks: {}, places: {} };
    var TR = tracksApi();
    if (TR && TR.data) { var d = TR.data(); Object.keys(d.tracks).forEach(function (id) { out.tracks[id] = 1; }); }
    (H.places() || []).forEach(function (p) { out.places[p.id] = 1; });
    return out;
  }
  function trackRoom() {
    var TR = tracksApi();
    return TR && TR.data ? IMP.MAX_TRACKS - Object.keys(TR.data().tracks).length : 0;
  }
  function placeRoom() { var F = favApi(); return F && F.pinRoom ? F.pinRoom() : 5000; }

  // ---------- preview ----------
  function preview(res) {
    var dlg = el("dialog", "osm-dlg imp-dlg");
    dlg.setAttribute("aria-labelledby", "imp-h");
    var h = el("h3", "", t("title"));
    h.id = "imp-h";
    dlg.appendChild(h);
    var onlyTl = res.sources.length === 1 && res.sources[0] === "timeline";
    if (!onlyTl) dlg.appendChild(el("p", "imp-src", res.sources.map(function (s) { return t("src." + s); }).join(" · ")));
    function close() { if (dlg.open) dlg.close(); dlg.remove(); }
    dlg.addEventListener("cancel", function (ev) { ev.preventDefault(); if (!busy) close(); });

    var hv = have(), base = IMP.plan(res.tracks, res.places, hv), busy = false;
    // the list names, in order of first appearance
    var lists = [];
    res.places.forEach(function (p) { if (p.list && lists.indexOf(p.list) < 0) lists.push(p.list); });

    if (res.tracks.length) {
      var sec = el("div", "imp-sec");
      sec.appendChild(el("div", "imp-h4", t("tracks", { n: fmt(res.tracks.length) })));
      var folders = [];
      res.tracks.forEach(function (x) { if (x.folder && folders.indexOf(x.folder) < 0) folders.push(x.folder); });
      sec.appendChild(el("p", "osm-small", folders.length ? t("tracks.folder", { f: folders.slice(0, 3).join(", ") }) : t("tracks.where")));
      var rg = IMP.trackRange(res.tracks);
      if (rg) sec.appendChild(el("p", "osm-small", t("tracks.dates", { a: fmtDay(rg.first), b: fmtDay(rg.last) })));
      if (base.tracksThere) sec.appendChild(el("p", "osm-small", t("there.t", { n: fmt(base.tracksThere) })));
      dlg.appendChild(sec);
    }
    if (res.places.length) {
      var sp = el("div", "imp-sec");
      sp.appendChild(el("div", "imp-h4", t("places", { n: fmt(res.places.length) })));
      sp.appendChild(el("p", "osm-small", t("places.where", { g: lists.slice(0, 5).join(", ") + (lists.length > 5 ? "…" : "") })));
      if (base.placesThere) sp.appendChild(el("p", "osm-small", t("there.p", { n: fmt(base.placesThere) })));
      dlg.appendChild(sp);
    }
    if (res.skipped) dlg.appendChild(el("p", "osm-small imp-skip", t("skipped", { n: fmt(res.skipped) })));

    // Timeline: a range first, nothing by default
    var tl = res.timeline, tlr = tl ? IMP.timelineRange(tl) : null, from = null, to = null, cbT = null, cbP = null, tlSum = null;
    if (tl && tlr) {
      var st = el("div", "imp-sec imp-tl");
      st.appendChild(el("div", "imp-h4", t("tl.head")));
      st.appendChild(el("p", "osm-warn imp-private", t("tl.private")));
      st.appendChild(el("p", "osm-small", t("tl.range", { a: fmtDay(tlr.first), b: fmtDay(tlr.last), n: fmt(tlr.days) })));
      var row = el("div", "imp-dates");
      function dateIn(label) {
        var lab = el("label", "osm-lab", label);
        var inp = el("input", "osm-in");
        inp.type = "date";
        inp.min = tlr.first;
        inp.max = tlr.last;
        lab.appendChild(inp);
        row.appendChild(lab);
        inp.addEventListener("change", sync);
        inp.addEventListener("input", sync);
        return inp;
      }
      from = dateIn(t("tl.from"));
      to = dateIn(t("tl.to"));
      st.appendChild(row);
      function check(label) {
        var lab = el("label", "trn-check imp-check"), cb = el("input");
        cb.type = "checkbox";
        cb.checked = true;
        cb.addEventListener("change", sync);
        lab.appendChild(cb);
        lab.appendChild(el("span", "", label));
        st.appendChild(lab);
        return cb;
      }
      cbT = check(t("tl.tracks", { f: t("tl.folder") }));
      cbP = check(t("tl.places", { g: t("tl.group") }));
      tlSum = el("p", "osm-small imp-tlsum", t("tl.pick"));
      tlSum.setAttribute("aria-live", "polite");
      st.appendChild(tlSum);
      dlg.appendChild(st);
    }
    var note = el("p", "osm-small imp-note");
    note.hidden = true;
    dlg.appendChild(note);

    var actions = el("div", "osm-actions");
    var go = button(t("go"), "osm-btn primary imp-go", run);
    actions.appendChild(go);
    actions.appendChild(button(t("cancel"), "osm-btn", function () { if (!busy) close(); }));
    dlg.appendChild(actions);

    // The whole import as it would run now: { tracks, places }
    var cur = null;
    function build() {
      var tracks = base.tracks.slice(), places = base.places.slice();
      if (tl && from && to) {
        var a = from.value, b = to.value;
        if (a && b && a > b) { var x = a; a = b; b = x; }
        var n = a && b ? daysBetween(a, b) : 0;
        if (!n) tlSum.textContent = t("tl.pick");
        else if (n > MAX_DAYS) tlSum.textContent = t("tl.max", { n: MAX_DAYS });
        else {
          var p = IMP.timelinePlan(tl, a, b, { tracks: cbT.checked, places: cbP.checked, dayPts: IMP.DAY_PTS });
          var tTracks = p.tracks.map(function (d) { return { key: d.key, name: t("tl.name", { d: d.ymd }), folder: t("tl.folder"), segs: d.segs }; });
          var tPlaces = p.places.map(function (v) {
            var nm = v.name || (v.type === "HOME" ? t("tl.home") : v.type === "WORK" ? t("tl.work") : t("tl.place"));
            var visits = v.count === 1 ? t("tl.visits1") : t("tl.visits", { n: fmt(v.count) });
            return { lat: v.lat, lon: v.lon, name: nm, sub: (v.sub ? v.sub + " · " : "") + visits, list: t("tl.group") };
          });
          var tp = IMP.plan(tTracks, tPlaces, hv);
          tracks = tracks.concat(tp.tracks);
          places = places.concat(tp.places);
          tlSum.textContent = t("tl.sum", { d: fmt(tp.tracks.length), v: fmt(tp.places.length) });
        }
      }
      // one entry per place id (a list and the Timeline may share one)
      var seen = {};
      places = places.filter(function (p) { if (seen[p.id]) return false; seen[p.id] = 1; return true; });
      var msgs = [], tr = trackRoom(), pr = placeRoom();
      if (tracks.length > tr) { msgs.push(t("full.t", { n: fmt(IMP.MAX_TRACKS), k: fmt(Math.max(0, tr)) })); tracks = tracks.slice(0, Math.max(0, tr)); }
      if (places.length > pr) { msgs.push(t("full.p", { k: fmt(Math.max(0, pr)) })); places = places.slice(0, Math.max(0, pr)); }
      note.textContent = msgs.join(" ");
      note.hidden = !msgs.length;
      return { tracks: tracks, places: places };
    }
    function sync() {
      cur = build();
      go.disabled = busy || !(cur.tracks.length || cur.places.length);
    }

    function run() {
      if (busy) return;
      cur = build();
      if (!cur.tracks.length && !cur.places.length) { close(); toast(t("nothing")); return; }
      busy = true;
      go.disabled = true;
      go.textContent = t("busy");
      var TR = tracksApi(), F = favApi(), plan = cur;
      var tp = TR && plan.tracks.length
        ? TR.addImported(plan.tracks.map(function (x) {
            return { id: x.id, name: x.name, folder: x.folder, tr: { name: x.name, segs: x.segs, wpts: [] } };
          })).catch(function () { toast(t("err.save")); return []; })
        : Promise.resolve([]);
      tp.then(function (tIds) {
        var pIds = plan.places.length ? H.importPlaces(plan.places) : [];
        var byList = {}, added = {};
        pIds.forEach(function (id) { added[id] = 1; });
        plan.places.forEach(function (p) {
          if (!added[p.id] || !p.list) return;
          (byList[p.list] = byList[p.list] || []).push(p.id);
        });
        var pins = F && F.importPins && Object.keys(byList).length ? F.importPins(byList) : null;
        busy = false;
        close();
        if (!tIds.length && !pIds.length) { toast(t("nothing")); return; }
        var used = false;
        H.localToast(t("done", { t: fmt(tIds.length), p: fmt(pIds.length) }), t("undo"), function () {
          if (used) return;
          used = true;
          if (TR && tIds.length) TR.removeImported(tIds);
          if (pIds.length) H.unimportPlaces(pIds);
          if (F && pins) F.undoPins(pins);
          toast(t("undone"));
        });
      });
    }

    sync();
    document.body.appendChild(dlg);
    dlg.showModal();
    return dlg;
  }

  window.__orosMapsImport = { pick: pick, files: files, preview: preview };
})();
