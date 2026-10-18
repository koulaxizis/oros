// ============================================================
// orOS Maps — offline.js (offline map packs, maps wave 51, v1.0.0)
//
// Organic Maps / OsmAnd style: download the area you see so the map
// and search work with no connection.
//
//   - Data: Protomaps daily builds of OpenStreetMap (vector tiles in
//     one PMTiles file, build.protomaps.com, ODbL). A pack is cut out
//     of the newest build with HTTP range requests, the same way the
//     official `pmtiles extract` tool does: only the directories and
//     tiles of the box are fetched, once. No key, no account. The
//     OpenStreetMap Foundation's standard tile images are never
//     bulk-downloaded (their usage policy forbids it). Advanced: another PMTiles
//     address (vector, Protomaps layout) can be set instead.
//   - Storage: the origin private file system (OPFS), folder
//     "maps-packs/<id>/": meta.json, plan.bin (tile index,
//     offline-core.js packToBin), c<N> (one file per download range),
//     search.json (names for the offline search). Device-local: packs
//     are large and never synced. The factory reset removes the folder.
//   - Size before download (per detail level), progress, pause /
//     resume (also after a reload: finished ranges are files of the
//     right size), cancel, update, delete, storage estimate.
//   - Drawing: our own small canvas renderer for the vector tiles, as
//     a Leaflet GridLayer ("Offline map" in the layer switcher). Over
//     the pack's top zoom the tiles are drawn larger, still sharp.
//     When the device goes offline over a pack, the map switches to it.
//   - Search: when Photon can't be reached, maps.js asks
//     H.offlineSearch (names of places, streets, points of interest
//     and addresses from the pack).
//
// Safety: names from the data and pack names go on the page with
// textContent only (and as canvas text). Only http(s) sources.
// ============================================================
(function () {
  "use strict";
  var OC = window.OrosMapsOffline;
  var H = window.__orosMapsHost;
  if (!OC || !H || !H.map || !window.L) return;
  var map = H.map;
  var LANG = window.orosI18n ? window.orosI18n.lang() : (H.lang === "el" ? "el" : "en");
  var PREF_KEY = "oros-maps-packs";            // device-local: { src }
  var DIR = "maps-packs";
  var BUILDS = "https://build-metadata.protomaps.dev/builds.json";
  var BUILD_URL = "https://build.protomaps.com/{d}.pmtiles";
  var LEVELS = [10, 12, 14, 15];
  var WORKERS = 3;

  var STR = {
    en: {
      "off.title": "Offline maps", "off.btn": "Offline maps",
      "off.intro": "Download an area so the map and search work with no connection, as in Organic Maps and OsmAnd.",
      "off.nosupport": "This browser can't store offline maps (it has no private file storage). Try a recent Chrome, Edge, Firefox or Safari 26.",
      "off.packs": "Your packs", "off.none": "No offline maps yet.",
      "off.new": "Download an area", "off.area.hint": "The dashed box on the map is what will be saved. Move or zoom the map to change it.",
      "off.name": "Name", "off.name.ph": "e.g. Athens", "off.area.default": "My area",
      "off.check": "Check size", "off.checking": "Reading the map index… {p}",
      "off.detail": "Detail",
      "off.lvl.10": "Overview: towns, main roads", "off.lvl.12": "Roads and villages", "off.lvl.14": "Streets, shops and places", "off.lvl.15": "Full detail with buildings",
      "off.tiles": "{n} map tiles", "off.download": "Download {s}", "off.toobig": "This area is too big. Zoom in on the map and check again.",
      "off.nofree": "Not enough free space on this device for {s}.",
      "off.moved": "The map moved: check the size again.",
      "off.offline": "You're offline. Downloading needs a connection.",
      "off.src.err": "Couldn't reach the map data. Try again later.",
      "off.src.bad": "This map source can't be used: it must be a PMTiles file of vector tiles (gzip or uncompressed).",
      "off.src.range": "The map source doesn't allow partial downloads.",
      "off.src.changed": "The map data was replaced on the server. Delete this pack and download it again.",
      "off.st.dl": "Downloading {p}%", "off.st.paused": "Paused at {p}%", "off.st.plan": "Preparing…", "off.st.index": "Preparing search {p}%",
      "off.st.ready": "Ready", "off.st.err": "Stopped: {e}",
      "off.meta": "{size} · detail up to zoom {z} · {date}", "off.data": "Map data of {d}",
      "off.pause": "Pause", "off.resume": "Resume", "off.cancel": "Cancel", "off.show": "Show", "off.update": "Update", "off.del": "Delete",
      "off.del.q": "Delete the offline map “{n}”?", "off.cancel.q": "Cancel the download of “{n}” and delete what was downloaded?",
      "off.del.ok": "Delete", "off.keep": "Keep", "off.deleted": "Offline map deleted",
      "off.done": "Offline map ready: {n}", "off.updated": "Offline map updated: {n}", "off.started": "Downloading {n}…",
      "off.resumed": "Continuing the download of {n}", "off.paused.net": "Download paused: no connection. It continues when you're back online.",
      "off.full": "Download stopped: the device storage is full.",
      "off.storage": "Packs use {u}. Free on this device: about {f}.", "off.storage.u": "Packs use {u}.",
      "off.persist.no": "The browser may remove offline maps if the device runs out of space.",
      "off.layer": "Offline map (downloaded)", "off.auto": "You're offline: showing your downloaded map",
      "off.back": "Back online: showing the online map again",
      "off.src": "Map source (advanced)", "off.src.hint": "Leave empty for the newest Protomaps build of OpenStreetMap. Or the address of your own PMTiles file (vector tiles, Protomaps layout).",
      "off.src.save": "Save source", "off.src.saved": "Map source saved", "off.src.badurl": "Enter an http(s) address, or leave it empty.",
      "off.credit": "Map data © OpenStreetMap contributors (ODbL), vector tiles by Protomaps.",
      "off.settings.sum": "{n} packs · {u}", "off.settings.none": "No offline maps",
      "off.close": "Close", "off.updating": "Update of {n}",
      "off.k.places:country": "Country", "off.k.places:region": "Region", "off.k.places:locality": "Town or village",
      "off.k.places:neighbourhood": "Neighbourhood", "off.k.places:macrohood": "District", "off.k.roads:street": "Street",
      "off.k.roads:path": "Path", "off.k.address": "Address", "off.k.water": "Water", "off.k.park": "Park", "off.k.station": "Station",
      "off.k.food": "Food and drink", "off.k.shop": "Shop", "off.k.health": "Health", "off.k.school": "School", "off.k.stay": "Hotel",
      "off.k.culture": "Culture", "off.k.worship": "Place of worship", "off.k.nature": "Nature", "off.k.transport": "Transport",
      "off.k.place": "Place", "off.k.offline": "offline"
    },
    el: {
      "off.title": "Χάρτες εκτός σύνδεσης", "off.btn": "Χάρτες εκτός σύνδεσης",
      "off.intro": "Κατέβασε μια περιοχή για να δουλεύουν ο χάρτης και η αναζήτηση χωρίς σύνδεση, όπως στα Organic Maps και OsmAnd.",
      "off.nosupport": "Αυτός ο περιηγητής δεν μπορεί να αποθηκεύσει χάρτες εκτός σύνδεσης (δεν έχει ιδιωτικό χώρο αρχείων). Δοκίμασε πρόσφατο Chrome, Edge, Firefox ή Safari 26.",
      "off.packs": "Τα πακέτα σου", "off.none": "Δεν υπάρχουν ακόμα χάρτες εκτός σύνδεσης.",
      "off.new": "Λήψη περιοχής", "off.area.hint": "Το διακεκομμένο πλαίσιο στον χάρτη είναι ό,τι θα αποθηκευτεί. Μετακίνησε ή μεγέθυνε τον χάρτη για να το αλλάξεις.",
      "off.name": "Όνομα", "off.name.ph": "π.χ. Αθήνα", "off.area.default": "Η περιοχή μου",
      "off.check": "Έλεγχος μεγέθους", "off.checking": "Διαβάζω το ευρετήριο του χάρτη… {p}",
      "off.detail": "Λεπτομέρεια",
      "off.lvl.10": "Επισκόπηση: πόλεις, κεντρικοί δρόμοι", "off.lvl.12": "Δρόμοι και χωριά", "off.lvl.14": "Οδοί, καταστήματα και μέρη", "off.lvl.15": "Πλήρης λεπτομέρεια με κτίρια",
      "off.tiles": "{n} πλακίδια χάρτη", "off.download": "Λήψη {s}", "off.toobig": "Η περιοχή είναι πολύ μεγάλη. Μεγέθυνε τον χάρτη και έλεγξε ξανά.",
      "off.nofree": "Δεν υπάρχει αρκετός ελεύθερος χώρος στη συσκευή για {s}.",
      "off.moved": "Ο χάρτης μετακινήθηκε: έλεγξε ξανά το μέγεθος.",
      "off.offline": "Είσαι εκτός σύνδεσης. Η λήψη χρειάζεται σύνδεση.",
      "off.src.err": "Δεν ήταν δυνατή η σύνδεση με τα δεδομένα του χάρτη. Δοκίμασε αργότερα.",
      "off.src.bad": "Αυτή η πηγή χάρτη δεν μπορεί να χρησιμοποιηθεί: πρέπει να είναι αρχείο PMTiles με διανυσματικά πλακίδια (gzip ή χωρίς συμπίεση).",
      "off.src.range": "Η πηγή του χάρτη δεν επιτρέπει λήψη σε κομμάτια.",
      "off.src.changed": "Τα δεδομένα του χάρτη αντικαταστάθηκαν στον διακομιστή. Διάγραψε αυτό το πακέτο και κατέβασέ το ξανά.",
      "off.st.dl": "Λήψη {p}%", "off.st.paused": "Σε παύση στο {p}%", "off.st.plan": "Προετοιμασία…", "off.st.index": "Προετοιμασία αναζήτησης {p}%",
      "off.st.ready": "Έτοιμο", "off.st.err": "Σταμάτησε: {e}",
      "off.meta": "{size} · λεπτομέρεια έως ζουμ {z} · {date}", "off.data": "Δεδομένα χάρτη της {d}",
      "off.pause": "Παύση", "off.resume": "Συνέχεια", "off.cancel": "Ακύρωση", "off.show": "Εμφάνιση", "off.update": "Ενημέρωση", "off.del": "Διαγραφή",
      "off.del.q": "Να διαγραφεί ο χάρτης εκτός σύνδεσης «{n}»;", "off.cancel.q": "Να ακυρωθεί η λήψη του «{n}» και να διαγραφεί ό,τι κατέβηκε;",
      "off.del.ok": "Διαγραφή", "off.keep": "Διατήρηση", "off.deleted": "Ο χάρτης εκτός σύνδεσης διαγράφηκε",
      "off.done": "Ο χάρτης εκτός σύνδεσης είναι έτοιμος: {n}", "off.updated": "Ο χάρτης εκτός σύνδεσης ενημερώθηκε: {n}", "off.started": "Λήψη του {n}…",
      "off.resumed": "Συνεχίζεται η λήψη του {n}", "off.paused.net": "Η λήψη σταμάτησε: δεν υπάρχει σύνδεση. Θα συνεχίσει όταν ξανασυνδεθείς.",
      "off.full": "Η λήψη σταμάτησε: ο χώρος της συσκευής γέμισε.",
      "off.storage": "Τα πακέτα πιάνουν {u}. Ελεύθερα στη συσκευή: περίπου {f}.", "off.storage.u": "Τα πακέτα πιάνουν {u}.",
      "off.persist.no": "Ο περιηγητής μπορεί να σβήσει τους χάρτες εκτός σύνδεσης αν γεμίσει ο χώρος της συσκευής.",
      "off.layer": "Χάρτης εκτός σύνδεσης (λήψη)", "off.auto": "Είσαι εκτός σύνδεσης: εμφανίζεται ο χάρτης που κατέβασες",
      "off.back": "Ξανά σε σύνδεση: εμφανίζεται πάλι ο online χάρτης",
      "off.src": "Πηγή χάρτη (για προχωρημένους)", "off.src.hint": "Άφησέ το κενό για την πιο πρόσφατη έκδοση Protomaps του OpenStreetMap. Ή γράψε τη διεύθυνση δικού σου αρχείου PMTiles (διανυσματικά πλακίδια, διάταξη Protomaps).",
      "off.src.save": "Αποθήκευση πηγής", "off.src.saved": "Η πηγή χάρτη αποθηκεύτηκε", "off.src.badurl": "Γράψε διεύθυνση http(s) ή άφησέ το κενό.",
      "off.credit": "Δεδομένα χάρτη © συντελεστές OpenStreetMap (ODbL), διανυσματικά πλακίδια από Protomaps.",
      "off.settings.sum": "{n} πακέτα · {u}", "off.settings.none": "Κανένας χάρτης εκτός σύνδεσης",
      "off.close": "Κλείσιμο", "off.updating": "Ενημέρωση του {n}",
      "off.k.places:country": "Χώρα", "off.k.places:region": "Περιφέρεια", "off.k.places:locality": "Πόλη ή χωριό",
      "off.k.places:neighbourhood": "Γειτονιά", "off.k.places:macrohood": "Συνοικία", "off.k.roads:street": "Οδός",
      "off.k.roads:path": "Μονοπάτι", "off.k.address": "Διεύθυνση", "off.k.water": "Νερό", "off.k.park": "Πάρκο", "off.k.station": "Σταθμός",
      "off.k.food": "Φαγητό και ποτό", "off.k.shop": "Κατάστημα", "off.k.health": "Υγεία", "off.k.school": "Σχολείο", "off.k.stay": "Ξενοδοχείο",
      "off.k.culture": "Πολιτισμός", "off.k.worship": "Χώρος λατρείας", "off.k.nature": "Φύση", "off.k.transport": "Συγκοινωνία",
      "off.k.place": "Μέρος", "off.k.offline": "εκτός σύνδεσης"
    }
  };
  if (window.orosI18n) window.orosI18n.table(STR, "maps", LANG);
  function loc() { return window.orosI18n ? window.orosI18n.locale(LANG) : (loc()); }
  function t(k, vars) {
    k = "off." + k;
    var s = (STR[LANG] && STR[LANG][k]) || STR.en[k] || k;
    if (vars) Object.keys(vars).forEach(function (v) { s = s.split("{" + v + "}").join(String(vars[v])); });
    return s;
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function button(label, cls, fn) {
    var b = el("button", cls, label);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }
  function toast(s) { (H.toast || H.localToast)(s); }
  function size(n) { return OC.fmtBytes(n, LANG); }
  function online() { return navigator.onLine !== false; }
  function fmtDate(ms) {
    try { return new Date(ms).toLocaleDateString(loc(), { day: "numeric", month: "short", year: "numeric" }); }
    catch (e) { return new Date(ms).toDateString(); }
  }
  function fmtBuild(d) {
    if (!/^\d{8}$/.test(d)) return "";
    return fmtDate(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), 12));
  }
  function readPrefs() {
    try { var p = JSON.parse(localStorage.getItem(PREF_KEY) || "null"); return p && typeof p === "object" ? p : {}; }
    catch (e) { return {}; }
  }
  function writePrefs(p) { try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch (e) {} }

  // ---------- OPFS ----------
  function supported() {
    return !!(navigator.storage && typeof navigator.storage.getDirectory === "function" &&
              typeof FileSystemFileHandle !== "undefined" && FileSystemFileHandle.prototype &&
              typeof FileSystemFileHandle.prototype.createWritable === "function");
  }
  var rootP = null;
  function rootDir() {
    if (!rootP) rootP = navigator.storage.getDirectory().then(function (r) { return r.getDirectoryHandle(DIR, { create: true }); });
    return rootP;
  }
  function writeFile(dir, name, data) {
    return dir.getFileHandle(name, { create: true }).then(function (fh) {
      return fh.createWritable().then(function (w) {
        return w.write(data).then(function () { return w.close(); }, function (e) { try { w.abort(); } catch (e2) {} throw e; });
      });
    });
  }
  function readFile(dir, name) {
    return dir.getFileHandle(name).then(function (fh) { return fh.getFile(); });
  }
  function isQuota(e) { return e && (e.name === "QuotaExceededError" || /quota/i.test(e.message || "")); }

  // ---------- network ----------
  function fetchRange(url, off, len, signal) {
    return fetch(url, { headers: { Range: "bytes=" + off + "-" + (off + len - 1) }, signal: signal, cache: "no-store" })
      .then(function (r) {
        if (r.status === 206) return r.arrayBuffer();
        if (r.status === 200 && off === 0) return r.arrayBuffer().then(function (b) { return b.slice(0, len); });
        if (r.status === 200) { var e = new Error("range"); e.code = "range"; throw e; }
        var e2 = new Error("http " + r.status); e2.code = r.status === 404 || r.status === 410 ? "gone" : "net"; throw e2;
      })
      .then(function (b) {
        if (b.byteLength !== len) { var e = new Error("short"); e.code = "net"; throw e; }
        return new Uint8Array(b);
      });
  }
  function gunzip(u8) {
    if (typeof DecompressionStream !== "function") return Promise.reject(new Error("gzip"));
    var s = new Blob([u8]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Response(s).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }
  function inflate(u8, comp) { return comp === 2 ? gunzip(u8) : Promise.resolve(u8); }

  // The newest Protomaps build (or the user's own source).
  var srcCache = null;
  function sourceUrl() {
    var own = readPrefs().src;
    if (own && OC.okUrl(own)) return Promise.resolve({ url: own, build: "" });
    if (srcCache) return Promise.resolve(srcCache);
    return fetch(BUILDS, { cache: "no-store" }).then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (j) { var d = OC.latestBuild(j); if (!d) throw 0; return d; })
      .catch(function () {
        // the list is down: try the last days' file names
        var day = Date.now(), i = 0;
        function next() {
          if (i >= 10) throw new Error("src");
          var d = new Date(day - 86400000 * i++).toISOString().slice(0, 10).replace(/-/g, "");
          return fetchRange(BUILD_URL.replace("{d}", d), 0, 127).then(function () { return d; }, next);
        }
        return next();
      })
      .then(function (d) { srcCache = { url: BUILD_URL.replace("{d}", d), build: d }; return srcCache; });
  }
  function openRemote(url) {
    return fetchRange(url, 0, 16384).catch(function (e) {
      if (e && e.code === "net") return fetchRange(url, 0, 127);   // a file smaller than 16 KB
      throw e;
    }).then(function (head) {
      var h;
      try { h = OC.parseHeader(head); } catch (e) { var b = new Error("bad"); b.code = "bad"; throw b; }
      if (OC.headerProblem(h)) { var b2 = new Error("bad"); b2.code = "bad"; throw b2; }
      var rootP2 = h.rootOff + h.rootLen <= head.length
        ? Promise.resolve(head.subarray(h.rootOff, h.rootOff + h.rootLen))
        : fetchRange(url, h.rootOff, h.rootLen);
      return rootP2.then(function (raw) { return inflate(raw, h.internalComp); })
        .then(function (u8) { return { url: url, h: h, root: OC.parseDir(u8) }; });
    });
  }
  function errText(e) {
    var c = e && e.code;
    if (c === "bad") return t("src.bad");
    if (c === "range") return t("src.range");
    if (c === "changed" || c === "gone") return t("src.changed");
    if (c === "full" || isQuota(e)) return t("full");
    return t("src.err");
  }

  // ---------- packs in memory ----------
  var packs = [];               // { meta, dir, plan, files: {}, index }
  function byId(id) { for (var i = 0; i < packs.length; i++) if (packs[i].meta.id === id) return packs[i]; return null; }
  function readyPacks() {
    return packs.filter(function (p) { return p.meta.state === "ready" && p.plan; })
      .sort(function (a, b) { return b.meta.maxz - a.meta.maxz; });
  }
  function saveMeta(p) { return writeFile(p.dir, "meta.json", JSON.stringify(p.meta)); }
  function loadPacks() {
    if (!supported()) return Promise.resolve([]);
    return rootDir().then(function (root) {
      var out = [], it = root.entries();
      function step() {
        return it.next().then(function (r) {
          if (r.done) return out;
          var name = r.value[0], h = r.value[1];
          if (h.kind !== "directory") return step();
          return readFile(h, "meta.json").then(function (f) { return f.text(); })
            .then(function (s) {
              var m = OC.normMeta(JSON.parse(s));
              if (m && m.id === name) out.push({ meta: m, dir: h, plan: null, files: {}, index: null });
            }, function () { /* not a pack */ })
            .then(step);
        });
      }
      return step();
    }).then(function (list) {
      return Promise.all(list.map(function (p) {
        return readFile(p.dir, "plan.bin").then(function (f) { return f.arrayBuffer(); })
          .then(function (b) { p.plan = OC.binToPack(b); }, function () { p.plan = null; })
          .then(function () { return p; });
      }));
    }).then(function (list) {
      list.sort(function (a, b) { return a.meta.created - b.meta.created; });
      packs = list;
      return packs;
    }).catch(function () { packs = []; return packs; });
  }

  // ---------- downloading ----------
  var job = null;               // { id, abort, done, total, inflight: {} }
  var progress = {};            // id → { done, total, phase, p }
  function pct(id) {
    var g = progress[id];
    if (!g || !g.total) return 0;
    return Math.min(100, Math.floor(g.done / g.total * 100));
  }
  function chunkDone(p) {
    var done = {};
    var it = p.dir.entries();
    function step() {
      return it.next().then(function (r) {
        if (r.done) return done;
        var name = r.value[0];
        if (!/^c\d+$/.test(name)) return step();
        var k = +name.slice(1);
        return r.value[1].getFile().then(function (f) {
          if (k < p.plan.cl.length && f.size === p.plan.cl[k]) done[k] = 1;
        }, function () {}).then(step);
      });
    }
    return step();
  }
  // Plan a pack that has none yet (an update): same box and detail, newest source.
  function planFor(p, signal) {
    return sourceUrl().then(function (s) {
      return openRemote(s.url).then(function (src) {
        var ids = OC.tileIds(p.meta.bbox, Math.min(p.meta.maxz, src.h.maxZoom));
        if (!ids) { var e = new Error("big"); e.code = "big"; throw e; }
        return OC.resolve(src.h, src.root, ids, { readDir: dirReader(src, signal) }).then(function (res) {
          var pk = OC.makePack(res, Math.min(p.meta.maxz, src.h.maxZoom));
          p.plan = pk;
          p.meta.src = s.url; p.meta.build = s.build; p.meta.sig = OC.headerSig(src.h); p.meta.tc = src.h.tileComp;
          p.meta.bytes = pk.bytes; p.meta.tiles = pk.ids.length; p.meta.chunks = pk.cs.length;
          return writeFile(p.dir, "plan.bin", OC.packToBin(pk)).then(function () { return saveMeta(p); });
        });
      });
    });
  }
  function dirReader(src, signal) {
    var cache = {};
    return function (off, len) {
      if (cache[off]) return Promise.resolve(cache[off]);
      return fetchRange(src.url, off, len, signal).then(function (raw) { return inflate(raw, src.h.internalComp); })
        .then(function (u8) { cache[off] = u8; return u8; });
    };
  }
  function startJob(p, quiet) {
    if (job) { if (job.id !== p.meta.id) return false; return true; }
    if (!online()) { toast(t("offline")); return false; }
    var ac = typeof AbortController === "function" ? new AbortController() : null;
    var my = job = { id: p.meta.id, abort: ac, paused: false };
    p.err = "";
    p.meta.paused = false;
    progress[p.meta.id] = { done: 0, total: p.meta.bytes || 1, phase: "dl" };
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().then(function (ok) { persisted = !!ok; }); } catch (e) {}
    if (!quiet) toast(t("started", { n: p.meta.name }));
    renderList();
    var sig = ac ? ac.signal : undefined;
    var first = p.plan ? Promise.resolve() : (progress[p.meta.id].phase = "plan", renderList(), planFor(p, sig));
    first.then(function () {
      progress[p.meta.id] = { done: 0, total: p.meta.bytes || 1, phase: "dl" };
      return saveMeta(p);
    }).then(function () {
      // the source must still be the file the plan was made from
      return fetchRange(p.meta.src, 0, 127, sig).then(function (head) {
        var h = OC.parseHeader(head);
        if (p.meta.sig && OC.headerSig(h) !== p.meta.sig) { var e = new Error("changed"); e.code = "changed"; throw e; }
      });
    }).then(function () { return chunkDone(p); })
      .then(function (done) {
        var plan = p.plan, todo = [], g = progress[p.meta.id];
        for (var k = 0; k < plan.cs.length; k++) { if (done[k]) g.done += plan.cl[k]; else todo.push(k); }
        renderProgress(p);
        var next = 0, failed = null;
        function worker() {
          if (failed || my.paused || next >= todo.length) return Promise.resolve();
          var k = todo[next++], tries = 0;
          function attempt() {
            return fetchRange(p.meta.src, plan.cs[k], plan.cl[k], sig).catch(function (e) {
              if (my.paused || (e && (e.name === "AbortError" || e.code === "range" || e.code === "gone"))) throw e;
              if (++tries >= 3 || !online()) throw e;
              return new Promise(function (res) { setTimeout(res, 1500 * tries); }).then(attempt);
            });
          }
          return attempt().then(function (u8) {
            return writeFile(p.dir, "c" + k, u8).then(function () {
              g.done += plan.cl[k];
              renderProgress(p);
            });
          }).then(worker, function (e) { failed = failed || e; });
        }
        var ws = [];
        for (var w = 0; w < WORKERS; w++) ws.push(worker());
        return Promise.all(ws).then(function () {
          if (failed) throw failed;
          if (my.paused) { var e = new Error("paused"); e.code = "paused"; throw e; }
        });
      })
      .then(function () {
        p.meta.state = "index";
        progress[p.meta.id] = { done: 0, total: 1, phase: "index" };
        renderList();
        return saveMeta(p).then(function () { return buildSearch(p, my); });
      })
      .then(function () {
        p.meta.state = "ready";
        return saveMeta(p);
      })
      .then(function () {
        job = null;
        delete progress[p.meta.id];
        var old = p.meta.replaces ? byId(p.meta.replaces) : null;
        if (old) {
          var oldName = old.meta.name;
          p.meta.replaces = "";
          saveMeta(p);
          removePack(old, true);
          toast(t("updated", { n: oldName }));
        } else toast(t("done", { n: p.meta.name }));
        afterChange();
        nextQueued();
      })
      .catch(function (e) {
        if (job === my) job = null;
        var paused = my.paused || (e && (e.code === "paused" || e.name === "AbortError"));
        if (my.deleted) return;
        if (paused) { p.meta.paused = true; saveMeta(p).catch(function () {}); renderList(); return; }
        if (!online() || (e && e.code === "net" && !navigator.onLine)) {
          p.netPaused = true;
          toast(t("paused.net"));
          renderList();
          return;
        }
        p.err = errText(e);
        if (isQuota(e)) toast(t("full"));
        p.meta.paused = true;
        saveMeta(p).catch(function () {});
        renderList();
      });
    return true;
  }
  function pauseJob() {
    if (!job) return;
    job.paused = true;
    if (job.abort) try { job.abort.abort(); } catch (e) {}
  }
  function nextQueued() {
    if (job || !online()) return;
    for (var i = 0; i < packs.length; i++) {
      var p = packs[i];
      if ((p.meta.state === "dl" || p.meta.state === "index") && !p.meta.paused && !p.err) { startJob(p, true); return; }
    }
  }
  function removePack(p, quiet) {
    if (job && job.id === p.meta.id) { job.deleted = true; pauseJob(); job = null; }
    packs = packs.filter(function (x) { return x !== p; });
    delete progress[p.meta.id];
    return rootDir().then(function (root) { return root.removeEntry(p.meta.id, { recursive: true }); })
      .catch(function () {})
      .then(function () { if (!quiet) toast(t("deleted")); afterChange(); });
  }

  // ---------- search index ----------
  function readTile(p, i) {
    var plan = p.plan, k = plan.tc[i];
    var f = p.files[k];
    var fp = f ? Promise.resolve(f) : readFile(p.dir, "c" + k).then(function (file) {
      var keys = Object.keys(p.files);
      if (keys.length > 48) delete p.files[keys[0]];
      p.files[k] = file;
      return file;
    });
    return fp.then(function (file) { return file.slice(plan.to[i], plan.to[i] + plan.tl[i]).arrayBuffer(); })
      .then(function (b) { return inflate(new Uint8Array(b), p.meta.tc); })
      .then(function (u8) { return OC.decodeMvt(u8); });
  }
  // Names from the top zoom's tiles, and place names from every zoom.
  function buildSearch(p, my) {
    var plan = p.plan, top = plan.maxz, list = [], all = [];
    for (var i = 0; i < plan.ids.length; i++) list.push(i);
    var g = progress[p.meta.id], n = 0;
    function slice() {
      if (my.paused || my.deleted) { var e = new Error("paused"); e.code = "paused"; return Promise.reject(e); }
      var t0 = Date.now(), batch = [];
      while (n < list.length && batch.length < 24) batch.push(list[n++]);
      if (!batch.length) return Promise.resolve();
      return Promise.all(batch.map(function (i) {
        var zxy = OC.tileXY(plan.ids[i]);
        return readTile(p, i).then(function (layers) {
          if (zxy[0] < top) layers = layers.places ? { places: layers.places } : {};
          OC.indexTile(layers, zxy[0], zxy[1], zxy[2]).forEach(function (e) { all.push(e); });
        }, function () { /* a damaged tile: no names from it */ });
      })).then(function () {
        g.done = n; g.total = list.length; renderProgress(p);
        return new Promise(function (res) { setTimeout(res, Math.max(0, 16 - (Date.now() - t0))); });
      }).then(slice);
    }
    return slice().then(function () {
      var idx = OC.buildIndex(all);
      p.index = idx;
      p.meta.words = idx.length;
      return writeFile(p.dir, "search.json", JSON.stringify(idx));
    });
  }
  function loadIndex(p) {
    if (p.index) return Promise.resolve(p.index);
    return readFile(p.dir, "search.json").then(function (f) { return f.text(); })
      .then(function (s) { p.index = OC.normIndex(JSON.parse(s)); return p.index; }, function () { p.index = []; return p.index; });
  }
  var KIND_GROUP = {
    food: /^(cafe|restaurant|fast_food|bar|pub|bakery|ice_cream|biergarten|food_court|confectionery|deli)$/,
    shop: /^(supermarket|convenience|shop|marketplace|mall|department_store|clothes|books|butcher|greengrocer|kiosk|hardware|electronics|florist|optician|hairdresser|beauty|mobile_phone|chemist)$/,
    health: /^(pharmacy|hospital|clinic|doctors|dentist|veterinary)$/,
    school: /^(school|university|college|kindergarten|library)$/,
    stay: /^(hotel|hostel|guest_house|motel|camp_site|apartment|chalet)$/,
    culture: /^(museum|theatre|cinema|arts_centre|gallery|attraction|artwork|monument|memorial|archaeological_site|castle|ruins|viewpoint|zoo|aquarium|theme_park)$/,
    worship: /^(place_of_worship|church|chapel|monastery|mosque|synagogue|temple|cathedral)$/,
    nature: /^(peak|beach|forest|wood|nature_reserve|national_park|cave_entrance|spring|waterfall|volcano|cliff|bay|cape|island|islet)$/,
    transport: /^(bus_stop|station|train_station|tram_stop|ferry_terminal|subway|aerodrome|airport|parking|fuel|charging_station|bicycle_rental|taxi|bus_station|halt|platform)$/,
    park: /^(park|garden|playground|dog_park|golf_course|pitch|sports_centre|stadium|recreation_ground)$/
  };
  function kindLabel(k) {
    if (STR.en["off.k." + k]) return t("k." + k);
    var parts = String(k).split(":"), layer = parts[0], kind = parts[1] || "";
    if (kind === "address") return t("k.address");
    if (layer === "water") return t("k.water");
    if (layer === "roads") return t("k.roads:street");
    if (layer === "places") return t("k.places:locality");
    for (var g in KIND_GROUP) if (KIND_GROUP[g].test(kind)) return t("k." + g);
    if (layer === "transit") return t("k.transport");
    if (layer === "landuse" || layer === "natural") return t("k.nature");
    return t("k.place");
  }
  H.offlineSearch = function (q, center, limit) {
    var rp = readyPacks();
    if (!rp.length) return Promise.resolve(null);
    return Promise.all(rp.map(loadIndex)).then(function () {
      var hits = [];
      rp.forEach(function (p) {
        OC.search(p.index, q, center, limit || 8).forEach(function (e) { hits.push({ e: e, p: p }); });
      });
      var qf = OC.latin(OC.fold(q));
      function starts(e) { return OC.latin(OC.fold(e[0])).indexOf(qf) === 0 ? 0 : 1; }
      hits.sort(function (a, b) {
        var sa = starts(a.e), sb = starts(b.e);
        if (sa !== sb) return sa - sb;
        if (!center) return 0;
        var da = Math.pow(a.e[3] - center[0], 2) + Math.pow(a.e[4] - center[1], 2);
        var db = Math.pow(b.e[3] - center[0], 2) + Math.pow(b.e[4] - center[1], 2);
        return da - db;
      });
      var seen = {};
      return hits.filter(function (h) {
        var key = h.e[0] + "|" + h.e[3].toFixed(3) + "|" + h.e[4].toFixed(3);
        if (seen[key]) return false;
        seen[key] = 1; return true;
      }).slice(0, limit || 8).map(function (h) {
        return { name: h.e[0], sub: kindLabel(h.e[2]) + " · " + h.p.meta.name + " (" + t("k.offline") + ")",
                 lat: h.e[3], lon: h.e[4], kind: "place", offline: true };
      });
    });
  };

  // ---------- drawing ----------
  var C = {
    water: "#aad3df", earth: "#f2efe9", nodata: "#e6e2da", hatch: "#d8d3c9",
    park: "#c8facc", forest: "#add19e", grass: "#cdebb0", farm: "#eef0d5", sand: "#f5e9c6", ice: "#ddecec",
    urban: "#e8e6e2", industrial: "#ebdbe8", commercial: "#f2dad9", hospital: "#fbe4e4", school: "#f7efc6",
    cemetery: "#aacbaf", military: "#f3d5d5", pedestrian: "#e3e2ea", airport: "#e4e2dc", scrub: "#c8d7ab",
    building: "#d9d0c9", buildingLine: "#c4b6ab",
    hwy: "#e892a2", hwyCase: "#c24e6b", major: "#fcd6a4", majorCase: "#c49a5e", minor: "#ffffff", minorCase: "#bdb9b1",
    path: "#e0715f", rail: "#8f8f8f", border: "#9e8fb0", text: "#333333", text2: "#5d5d5d", halo: "#ffffff", poi: "#7a6a5a"
  };
  var FILL = [
    [/^(residential|urban_area|urban)$/, "urban"], [/^(industrial|railway|quarry|landfill|brownfield|construction)$/, "industrial"],
    [/^(commercial|retail)$/, "commercial"], [/^(farmland|farmyard|orchard|vineyard|allotments|plant_nursery|greenhouse_horticulture)$/, "farm"],
    [/^(grass|grassland|meadow|village_green|recreation_ground|heath)$/, "grass"], [/^(scrub|wetland|marsh|bog)$/, "scrub"],
    [/^(forest|wood)$/, "forest"], [/^(park|garden|playground|golf_course|national_park|nature_reserve|protected_area|dog_park|pitch|stadium|sports_centre)$/, "park"],
    [/^(beach|sand|barren|bare_rock|scree)$/, "sand"], [/^(glacier)$/, "ice"], [/^(hospital|clinic)$/, "hospital"],
    [/^(school|university|college|kindergarten)$/, "school"], [/^(cemetery|grave_yard)$/, "cemetery"], [/^(military|naval_base)$/, "military"],
    [/^(pedestrian|platform)$/, "pedestrian"], [/^(aerodrome|airfield|runway|taxiway|apron)$/, "airport"]
  ];
  function fillOf(kind) {
    for (var i = 0; i < FILL.length; i++) if (FILL[i][0].test(kind)) return { c: C[FILL[i][1]], r: i };
    return null;
  }
  function W(base, z) { return Math.max(0.5, Math.min(48, base * Math.pow(1.55, z - 15))); }

  function drawTile(ctx, layers, o) {
    // o: { size, k (px per tile unit), ox, oy, z (shown zoom) }
    var z = o.z, k = o.k, ox = o.ox, oy = o.oy, S = o.size;
    function tx(v) { return v * k - ox; }
    function ty(v) { return v * k - oy; }
    function path(parts, close) {
      ctx.beginPath();
      parts.forEach(function (pt) {
        if (pt.length < 4) return;
        ctx.moveTo(tx(pt[0]), ty(pt[1]));
        for (var i = 2; i + 1 < pt.length; i += 2) ctx.lineTo(tx(pt[i]), ty(pt[i + 1]));
        if (close) ctx.closePath();
      });
    }
    function feats(name) { return (layers[name] && layers[name].features) || []; }
    function visible(f) { var mz = f.props.min_zoom; return !(typeof mz === "number" && mz > z + 0.5); }

    ctx.fillStyle = C.water;
    ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = C.earth;
    feats("earth").forEach(function (f) { if (f.type === 3) { path(f.geom, true); ctx.fill("evenodd"); } });

    // landcover then landuse, light fills first
    var areas = [];
    ["landcover", "landuse", "natural"].forEach(function (ln) {
      feats(ln).forEach(function (f) {
        if (f.type !== 3) return;
        var st = fillOf(OC.kindOf(f.props));
        if (st) areas.push({ f: f, st: st });
      });
    });
    areas.sort(function (a, b) { return a.st.r - b.st.r; });
    areas.forEach(function (a) { ctx.fillStyle = a.st.c; path(a.f.geom, true); ctx.fill("evenodd"); });

    // water
    feats("water").forEach(function (f) {
      if (f.type === 3) { ctx.fillStyle = C.water; path(f.geom, true); ctx.fill("evenodd"); }
      else if (f.type === 2) {
        var kd = OC.kindOf(f.props);
        ctx.strokeStyle = C.water; ctx.lineCap = "round"; ctx.lineJoin = "round";
        ctx.lineWidth = W(kd === "river" ? 5 : kd === "canal" ? 4 : 2, z);
        path(f.geom, false); ctx.stroke();
      }
    });

    // buildings
    if (z >= 14) {
      ctx.fillStyle = C.building; ctx.strokeStyle = C.buildingLine; ctx.lineWidth = 0.6;
      feats("buildings").forEach(function (f) {
        if (f.type !== 3) return;
        path(f.geom, true); ctx.fill("evenodd");
        if (z >= 16) ctx.stroke();
      });
    }

    // roads: casings, then fills, small to big
    var roads = [];
    feats("roads").forEach(function (f) {
      if (f.type !== 2 || !visible(f)) return;
      var kd = OC.kindOf(f.props), det = OC.detailOf(f.props);
      var r;
      if (kd === "highway") r = { w: 9, fill: C.hwy, cas: C.hwyCase, o: 4 };
      else if (kd === "major_road") r = { w: 7.5, fill: C.major, cas: C.majorCase, o: 3 };
      else if (kd === "path") { if (z < 14) return; r = { w: 1.4, fill: C.path, dash: true, o: 1 }; }
      else if (kd === "minor_road" || kd === "other" || kd === "") {
        if (z < 12) return;
        var svc = det === "service" || kd === "other";
        if (svc && z < 14) return;
        r = { w: svc ? 2.6 : 5, fill: C.minor, cas: C.minorCase, o: 2 };
      } else return;
      r.f = f;
      roads.push(r);
    });
    roads.sort(function (a, b) { return a.o - b.o; });
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    roads.forEach(function (r) {
      if (!r.cas || z < 11) return;
      ctx.setLineDash([]);
      ctx.strokeStyle = r.cas; ctx.lineWidth = W(r.w, z) + 1.6;
      path(r.f.geom, false); ctx.stroke();
    });
    roads.forEach(function (r) {
      ctx.strokeStyle = z < 11 && r.cas ? r.cas : r.fill;
      ctx.lineWidth = W(r.w, z);
      ctx.setLineDash(r.dash ? [4, 3] : []);
      path(r.f.geom, false); ctx.stroke();
    });
    ctx.setLineDash([]);

    // railways
    ctx.strokeStyle = C.rail; ctx.lineWidth = Math.max(1, W(2, z));
    feats("transit").forEach(function (f) {
      if (f.type !== 2) return;
      var kd = OC.kindOf(f.props);
      if (kd && kd !== "rail" && kd !== "railway") return;
      path(f.geom, false); ctx.stroke();
    });

    // borders
    feats("boundaries").forEach(function (f) {
      if (f.type !== 2) return;
      var kd = OC.kindOf(f.props), lvl = f.props.kind_detail || f.props.admin_level;
      var country = kd === "country" || lvl === 2 || lvl === "2";
      if (!country && kd !== "region" && lvl !== 4 && lvl !== "4") return;
      ctx.strokeStyle = C.border; ctx.lineWidth = country ? 1.6 : 1;
      ctx.setLineDash(country ? [7, 3] : [3, 3]);
      path(f.geom, false); ctx.stroke();
    });
    ctx.setLineDash([]);

    // labels: places, road names, points of interest
    var boxes = [];
    function free(x0, y0, x1, y1) {
      if (x0 < 2 || y0 < 2 || x1 > S - 2 || y1 > S - 2) return false;      // never cut by the tile edge
      for (var i = 0; i < boxes.length; i++) {
        var b = boxes[i];
        if (x0 < b[2] && b[0] < x1 && y0 < b[3] && b[1] < y1) return false;
      }
      boxes.push([x0, y0, x1, y1]);
      return true;
    }
    function nameOf(pr) {
      var n = (LANG !== "en" && (pr["name:" + LANG] || (LANG === "el" && pr.name_el))) || pr.name || "";
      return typeof n === "string" ? n.slice(0, 60) : "";
    }
    function label(text, x, y, font, color) {
      ctx.font = font;
      var w = ctx.measureText(text).width, h = parseInt(font.replace(/^\D*/, ""), 10) || 12;
      if (!free(x - w / 2 - 2, y - h / 2 - 2, x + w / 2 + 2, y + h / 2 + 2)) return false;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.lineWidth = 3; ctx.strokeStyle = C.halo; ctx.strokeText(text, x, y);
      ctx.fillStyle = color; ctx.fillText(text, x, y);
      return true;
    }
    var places = feats("places").filter(function (f) { return f.type === 1 && visible(f) && nameOf(f.props); });
    places.sort(function (a, b) { return (b.props.population_rank || 0) - (a.props.population_rank || 0); });
    places.forEach(function (f) {
      var kd = OC.kindOf(f.props), det = OC.detailOf(f.props), font, col = C.text;
      if (kd === "country") font = "bold 13px system-ui, sans-serif";
      else if (kd === "region") { if (z > 9) return; font = "12px system-ui, sans-serif"; col = C.text2; }
      else if (kd === "locality") font = det === "city" || (f.props.population_rank || 0) >= 10 ? "bold 14px system-ui, sans-serif" : (z >= 11 ? "bold 12px system-ui, sans-serif" : "12px system-ui, sans-serif");
      else if (kd === "neighbourhood" || kd === "macrohood") { if (z < 13) return; font = "italic 11px system-ui, sans-serif"; col = C.text2; }
      else return;
      var g = f.geom[0];
      label(nameOf(f.props), tx(g[0]), ty(g[1]), font, col);
    });
    // road names along the longest piece in the tile
    if (z >= 14) {
      ctx.font = "11px system-ui, sans-serif";
      feats("roads").forEach(function (f) {
        if (f.type !== 2) return;
        var kd = OC.kindOf(f.props);
        if (z < 15 && kd !== "major_road" && kd !== "highway") return;
        var name = nameOf(f.props);
        if (!name) return;
        var best = null, bl = 0;
        f.geom.forEach(function (pt) {
          for (var i = 0; i + 3 < pt.length; i += 2) {
            var x0 = tx(pt[i]), y0 = ty(pt[i + 1]), x1 = tx(pt[i + 2]), y1 = ty(pt[i + 3]);
            var l = Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0));
            if (l > bl) { bl = l; best = [x0, y0, x1, y1]; }
          }
        });
        if (!best) return;
        var w = ctx.measureText(name).width;
        if (bl < w + 16) return;
        var cx = (best[0] + best[2]) / 2, cy = (best[1] + best[3]) / 2;
        var a = Math.atan2(best[3] - best[1], best[2] - best[0]);
        if (a > Math.PI / 2) a -= Math.PI; else if (a < -Math.PI / 2) a += Math.PI;
        var r = Math.max(Math.abs(Math.cos(a)) * w, 12) / 2, rv = Math.max(Math.abs(Math.sin(a)) * w, 12) / 2;
        if (!free(cx - r, cy - rv, cx + r, cy + rv)) return;
        ctx.save();
        ctx.translate(cx, cy); ctx.rotate(a);
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.lineWidth = 3; ctx.strokeStyle = C.halo; ctx.strokeText(name, 0, 0);
        ctx.fillStyle = C.text2; ctx.fillText(name, 0, 0);
        ctx.restore();
      });
    }
    if (z >= 16) {
      feats("pois").forEach(function (f) {
        if (f.type !== 1) return;
        var name = nameOf(f.props);
        if (!name) return;
        var g = f.geom[0], x = tx(g[0]), y = ty(g[1]);
        if (!label(name, x, y + 11, "11px system-ui, sans-serif", C.poi)) return;
        ctx.fillStyle = C.poi; ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
      });
    }
  }
  function drawNoData(ctx, S) {
    ctx.fillStyle = C.nodata; ctx.fillRect(0, 0, S, S);
    ctx.strokeStyle = C.hatch; ctx.lineWidth = 1;
    ctx.beginPath();
    for (var i = -S; i < S; i += 16) { ctx.moveTo(i, S); ctx.lineTo(i + S, 0); }
    ctx.stroke();
  }

  var decoded = new Map();      // "<pack>/<tile>" → Promise<layers>, most recent last
  function tileLayers(p, i) {
    var key = p.meta.id + "/" + p.plan.ids[i];
    var hit = decoded.get(key);
    if (hit) { decoded.delete(key); decoded.set(key, hit); return hit; }
    var pr = readTile(p, i).catch(function () { decoded.delete(key); return null; });
    decoded.set(key, pr);
    if (decoded.size > 96) decoded.delete(decoded.keys().next().value);
    return pr;
  }
  function findSource(z, x, y) {
    var rp = readyPacks();
    var n = Math.pow(2, z);
    var tb = [x / n * 360 - 180, OC.yToLat(y + 1, z), (x + 1) / n * 360 - 180, OC.yToLat(y, z)];
    for (var j = 0; j < rp.length; j++) {
      var p = rp[j];
      if (!OC.bboxIntersects(p.meta.bbox, tb)) continue;
      var sz = Math.min(z, p.plan.maxz), d = z - sz;
      var sx = Math.floor(x / Math.pow(2, d)), sy = Math.floor(y / Math.pow(2, d));
      var i = OC.lookup(p.plan, OC.tileId(sz, sx, sy));
      if (i >= 0) return { p: p, i: i, d: d, sx: sx, sy: sy };
    }
    return null;
  }
  var OfflineLayer = L.GridLayer.extend({
    createTile: function (coords, done) {
      var S = this.getTileSize().x, dpr = Math.min(2, window.devicePixelRatio || 1);
      var cv = document.createElement("canvas");
      cv.width = S * dpr; cv.height = S * dpr;
      var ctx = cv.getContext("2d");
      ctx.scale(dpr, dpr);
      var src = findSource(coords.z, coords.x, coords.y);
      if (!src) { drawNoData(ctx, S); setTimeout(function () { done(null, cv); }, 0); return cv; }
      tileLayers(src.p, src.i).then(function (layers) {
        if (!layers) { drawNoData(ctx, S); return; }
        var f = Math.pow(2, src.d), ext = 4096;
        for (var ln in layers) { ext = layers[ln].extent || 4096; break; }
        var k = S * f / ext;
        drawTile(ctx, layers, { size: S, k: k, z: coords.z,
          ox: (coords.x - src.sx * f) * S, oy: (coords.y - src.sy * f) * S });
      }).catch(function () { drawNoData(ctx, S); })
        .then(function () { done(null, cv); });
      return cv;
    }
  });
  var layer = new OfflineLayer({
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, <a href="https://protomaps.com">Protomaps</a>'
  });
  function redrawLayer() { decoded.clear(); if (map.hasLayer(layer)) layer.redraw(); }

  // ---------- auto switch when offline ----------
  var autoPrev = "";
  function coversView() {
    var c = map.getCenter();
    return readyPacks().some(function (p) {
      var b = p.meta.bbox;
      return c.lng >= b[0] && c.lng <= b[2] && c.lat >= b[1] && c.lat <= b[3];
    });
  }
  function goOffline() {
    if (!H.setBase || !H.currentBase) return;
    var cur = H.currentBase();
    if (cur === "offline" || !coversView()) return;
    autoPrev = cur;
    H.setBase("offline");
    toast(t("auto"));
  }
  window.addEventListener("offline", function () { setTimeout(goOffline, 50); });
  window.addEventListener("online", function () {
    if (autoPrev && H.currentBase && H.currentBase() === "offline") {
      H.setBase(autoPrev);
      toast(t("back"));
    }
    autoPrev = "";
    packs.forEach(function (p) { p.netPaused = false; });
    setTimeout(nextQueued, 1500);
  });

  // ---------- the sheet ----------
  var sheet = null, isOpen = false, listBox = null, storeBox = null, newBox = null, rows = {};
  var areaRect = null, packRects = L.layerGroup();
  var draft = null;             // { bbox, src, res, sizes, maxAllowed, pick, busy }
  var persisted = null;
  function setH() {
    var h = 0;
    document.querySelectorAll(".osm-sheet").forEach(function (s) { if (!s.hidden) h = Math.max(h, s.offsetHeight); });
    document.body.style.setProperty("--osm-h", h + "px");
  }
  window.addEventListener("oros-maps-mode", function (e) { if (isOpen && e.detail !== "offline") closeSheet(); });
  function openSheet() {
    if (!isOpen) { try { window.dispatchEvent(new CustomEvent("oros-maps-mode", { detail: "offline" })); } catch (e) {} }
    isOpen = true;
    var ms = document.getElementById("mapsettings");
    if (ms) ms.hidden = true;
    sheet.hidden = false;
    document.body.classList.add("osm-mode");
    renderSheet();
    packRects.addTo(map);
    paintRects();
    setTimeout(function () { setH(); paintArea(); }, 30);
  }
  function closeSheet() {
    isOpen = false;
    sheet.hidden = true;
    sheet.textContent = "";
    document.body.classList.remove("osm-mode");
    if (areaRect) { map.removeLayer(areaRect); areaRect = null; }
    map.removeLayer(packRects);
    draft = null;
    setH();
  }
  // The part of the map the sheet doesn't cover.
  function visibleBbox() {
    var mc = map.getContainer().getBoundingClientRect(), sr = sheet.hidden ? null : sheet.getBoundingClientRect();
    var x0 = 0, y0 = 0, x1 = mc.width, y1 = mc.height;
    if (sr && sr.width && sr.height) {
      if (sr.left > mc.left + 40) x1 = Math.max(60, sr.left - mc.left);
      else y1 = Math.max(60, sr.top - mc.top);
    }
    var sw = map.containerPointToLatLng([x0 + 12, y1 - 12]), ne = map.containerPointToLatLng([x1 - 12, y0 + 64]);
    return OC.normBbox([sw.lng, sw.lat, ne.lng, ne.lat]);
  }
  function paintArea() {
    if (!isOpen || !supported()) return;
    var b = visibleBbox();
    if (!b) return;
    var ll = [[b[1], b[0]], [b[3], b[2]]];
    if (areaRect) areaRect.setBounds(ll);
    else areaRect = L.rectangle(ll, { color: "#6d4aff", weight: 2, dashArray: "6 5", fill: false, interactive: false }).addTo(map);
  }
  function paintRects() {
    packRects.clearLayers();
    packs.forEach(function (p) {
      var b = p.meta.bbox;
      L.rectangle([[b[1], b[0]], [b[3], b[2]]], { color: "#87cf3e", weight: 1.5, fillOpacity: 0.06, interactive: false }).addTo(packRects);
    });
  }
  map.on("moveend", function () {
    if (!isOpen) return;
    paintArea();
    if (draft && draft.res && !draft.busy) {
      var b = visibleBbox();
      if (b && b.join() !== draft.bbox.join()) { draft = null; renderNew(t("moved")); }
    }
  });
  function header() {
    var h = el("header", "");
    h.appendChild(el("h3", "", t("title")));
    var c = button("", "osm-iconbtn osm-close", closeSheet);
    c.setAttribute("aria-label", t("close")); c.title = t("close");
    c.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    h.appendChild(c);
    return h;
  }
  function renderSheet() {
    sheet.textContent = "";
    rows = {};
    sheet.appendChild(header());
    var body = el("div", "osm-body off-body");
    if (!supported()) {
      body.appendChild(el("p", "osm-hint", t("nosupport")));
      sheet.appendChild(body);
      return;
    }
    body.appendChild(el("p", "osm-hint", t("intro")));
    body.appendChild(el("h4", "off-h", t("packs")));
    listBox = el("div", "off-list");
    body.appendChild(listBox);
    storeBox = el("p", "osm-small off-store", "");
    body.appendChild(storeBox);
    body.appendChild(el("h4", "off-h", t("new")));
    newBox = el("div", "off-new");
    body.appendChild(newBox);
    var adv = el("details", "off-adv");
    adv.appendChild(el("summary", "", t("src")));
    adv.appendChild(el("p", "osm-small", t("src.hint")));
    var srcIn = el("input", "osm-in off-src");
    srcIn.type = "url"; srcIn.value = readPrefs().src || ""; srcIn.placeholder = "https://…/area.pmtiles";
    srcIn.setAttribute("aria-label", t("src"));
    adv.appendChild(srcIn);
    adv.appendChild(button(t("src.save"), "osm-mini off-srcsave", function () {
      var v = srcIn.value.trim();
      if (v && !OC.okUrl(v)) { toast(t("src.badurl")); return; }
      var p = readPrefs(); if (v) p.src = v; else delete p.src;
      writePrefs(p); srcCache = null; draft = null; renderNew(); toast(t("src.saved"));
    }));
    body.appendChild(adv);
    body.appendChild(el("p", "osm-small off-credit", t("credit")));
    sheet.appendChild(body);
    renderList();
    renderNew();
  }
  function renderList() {
    paintSettings();
    if (!isOpen || !listBox) return;
    listBox.textContent = "";
    rows = {};
    if (!packs.length) listBox.appendChild(el("p", "osm-small", t("none")));
    packs.forEach(function (p) {
      var m = p.meta, row = el("div", "off-pack");
      row.setAttribute("data-id", m.id);
      var top = el("div", "off-top");
      top.appendChild(el("b", "off-name", m.replaces && byId(m.replaces) ? t("updating", { n: m.name }) : m.name));
      var st = el("span", "off-state", "");
      top.appendChild(st);
      row.appendChild(top);
      row.appendChild(el("div", "osm-row-s", t("meta", { size: size(m.bytes), z: m.maxz, date: fmtDate(m.created) }) +
        (m.build ? " · " + t("data", { d: fmtBuild(m.build) }) : "")));
      var bar = el("div", "off-bar"), fill = el("span", "");
      bar.appendChild(fill);
      row.appendChild(bar);
      var acts = el("div", "osm-actions off-acts");
      var active = job && job.id === m.id;
      if (m.state === "ready") {
        acts.appendChild(button(t("show"), "osm-mini", function () {
          map.fitBounds([[m.bbox[1], m.bbox[0]], [m.bbox[3], m.bbox[2]]]);
          if (H.setBase) H.setBase("offline");
        }));
        acts.appendChild(button(t("update"), "osm-mini off-upd", function () { updatePack(p); }));
        acts.appendChild(button(t("del"), "osm-mini danger off-del", function () {
          confirmDlg(t("del.q", { n: m.name }), t("del.ok"), function () { removePack(p); });
        }));
      } else {
        if (active) acts.appendChild(button(t("pause"), "osm-mini off-pause", function () { pauseJob(); }));
        else acts.appendChild(button(t("resume"), "osm-mini off-resume", function () { p.err = ""; startJob(p); }));
        acts.appendChild(button(t("cancel"), "osm-mini danger off-cancel", function () {
          confirmDlg(t("cancel.q", { n: m.name }), t("del.ok"), function () { removePack(p); });
        }));
      }
      row.appendChild(acts);
      listBox.appendChild(row);
      rows[m.id] = { st: st, bar: bar, fill: fill };
      renderProgress(p);
    });
    paintStorage();
    if (isOpen) { paintRects(); setH(); }
  }
  function renderProgress(p) {
    var r = rows[p.meta.id];
    if (!r) return;
    var m = p.meta, g = progress[m.id], active = job && job.id === m.id, txt;
    if (m.state === "ready") txt = t("st.ready");
    else if (p.err) txt = t("st.err", { e: p.err });
    else if (active && g && g.phase === "plan") txt = t("st.plan");
    else if (active && g && g.phase === "index") txt = t("st.index", { p: pct(m.id) });
    else if (active) txt = t("st.dl", { p: pct(m.id) });
    else txt = t("st.paused", { p: g ? pct(m.id) : (m.state === "index" ? 100 : 0) });
    r.st.textContent = txt;
    r.st.className = "off-state" + (p.err ? " err" : m.state === "ready" ? " ok" : "");
    r.bar.hidden = m.state === "ready";
    r.fill.style.width = (g ? pct(m.id) : 0) + "%";
  }
  function paintStorage() {
    if (!storeBox) return;
    var used = packs.reduce(function (a, p) { return a + (p.meta.bytes || 0); }, 0);
    storeBox.textContent = t("storage.u", { u: size(used) });
    if (!navigator.storage || !navigator.storage.estimate) return;
    navigator.storage.estimate().then(function (e) {
      if (!storeBox) return;
      var free = Math.max(0, (e.quota || 0) - (e.usage || 0));
      storeBox.textContent = (e.quota ? t("storage", { u: size(used), f: size(free) }) : t("storage.u", { u: size(used) })) +
        (persisted === false && packs.length ? " " + t("persist.no") : "");
    }).catch(function () {});
  }
  function renderNew(note) {
    if (!newBox) return;
    newBox.textContent = "";
    newBox.appendChild(el("p", "osm-small", t("area.hint")));
    var lab = el("label", "osm-lab", t("name"));
    var nameIn = el("input", "osm-in off-name-in");
    nameIn.type = "text"; nameIn.maxLength = 80; nameIn.placeholder = t("name.ph");
    nameIn.value = (draft ? draft.name : draft0.name) || "";
    nameIn.addEventListener("input", function () { if (draft) draft.name = nameIn.value; else draft0.name = nameIn.value; });
    lab.appendChild(nameIn);
    newBox.appendChild(lab);
    if (!draft || !draft.res) {
      if (note) newBox.appendChild(el("p", "osm-warn", note));
      var chk = button(draft && draft.busy ? t("checking", { p: draft.prog || "" }) : t("check"), "osm-btn primary off-check", checkSize);
      chk.disabled = !!(draft && draft.busy);
      newBox.appendChild(chk);
      if (!nameIn.value) suggestName(nameIn);
      setH();
      return;
    }
    newBox.appendChild(el("div", "osm-lab", t("detail")));
    var opts = el("div", "off-levels");
    LEVELS.forEach(function (z) {
      if (z > draft.maxAllowed) return;
      var id = "off-lvl-" + z;
      var row = el("label", "off-level");
      var r = el("input", "");
      r.type = "radio"; r.name = "off-lvl"; r.id = id; r.value = String(z);
      r.checked = draft.pick === z;
      r.addEventListener("change", function () { draft.pick = z; renderNew(); });
      row.appendChild(r);
      var tx2 = el("span", "off-level-t");
      tx2.appendChild(el("b", "", t("lvl." + z)));
      tx2.appendChild(el("small", "", size(draft.sizes.bytes[z]) + " · " + t("tiles", { n: draft.sizes.tiles[z].toLocaleString(loc()) })));
      row.appendChild(tx2);
      opts.appendChild(row);
    });
    newBox.appendChild(opts);
    if (note) newBox.appendChild(el("p", "osm-warn", note));
    var go = button(t("download", { s: size(draft.sizes.bytes[draft.pick]) }), "osm-btn primary off-go", download);
    newBox.appendChild(go);
    setH();
  }
  var draft0 = { name: "" };
  function suggestName(input) {
    if (!online() || !H.reverseName) return;
    var c = map.getCenter(), place = { lat: c.lat, lon: c.lng, name: "" };
    H.reverseName(place, function () {
      if (!input.value && place.name && document.body.contains(input)) { input.value = place.name.slice(0, 80); draft0.name = input.value; }
    });
  }
  function checkSize() {
    if (!online()) { toast(t("offline")); return; }
    var b = visibleBbox();
    if (!b) return;
    var name = (draft && draft.name) || draft0.name || "";
    var my = draft = { bbox: b, name: name, busy: true, prog: "" };
    renderNew();
    var maxAllowed = -1;
    sourceUrl().then(function (s) {
      return openRemote(s.url).then(function (src) {
        var top = Math.min(OC.MAX_ZOOM, src.h.maxZoom);
        for (var z = top; z >= 0; z--) if (OC.countTiles(b, z) <= OC.MAX_TILES) { maxAllowed = z; break; }
        if (maxAllowed < LEVELS[0] && maxAllowed < top) { var e = new Error("big"); e.code = "big"; throw e; }
        var ids = OC.tileIds(b, maxAllowed);
        return OC.resolve(src.h, src.root, ids, {
          readDir: dirReader(src),
          progress: function (d, n) {
            if (draft !== my) return;
            my.prog = d + " / " + n;
            var btn = newBox && newBox.querySelector(".off-check");
            if (btn) btn.textContent = t("checking", { p: my.prog });
          }
        }).then(function (res) { return { s: s, src: src, res: res }; });
      });
    }).then(function (r) {
      if (draft !== my) return;
      my.busy = false;
      my.s = r.s; my.src = r.src; my.res = r.res;
      my.maxAllowed = Math.max(maxAllowed, LEVELS[0]);
      var top = Math.min(maxAllowed, r.src.h.maxZoom);
      my.sizes = OC.sizesByZoom(r.res, top);
      // levels above the source's top zoom: the same tiles
      LEVELS.forEach(function (z) {
        if (z > top) { my.sizes.bytes[z] = my.sizes.bytes[top]; my.sizes.tiles[z] = my.sizes.tiles[top]; }
      });
      my.maxAllowed = Math.min(my.maxAllowed, Math.max(top, LEVELS[0]));
      var ok = LEVELS.filter(function (z) { return z <= my.maxAllowed; });
      my.pick = ok.indexOf(14) >= 0 ? 14 : ok[ok.length - 1];
      renderNew();
    }).catch(function (e) {
      if (draft !== my) return;
      draft = null;
      renderNew(e && e.code === "big" ? t("toobig") : errText(e));
    });
  }
  function download() {
    if (!draft || !draft.res) return;
    var d = draft, z = d.pick, top = Math.min(z, d.src.h.maxZoom);
    var pk = OC.makePack(d.res, top);
    var est = navigator.storage && navigator.storage.estimate ? navigator.storage.estimate() : Promise.resolve({});
    est.then(function (e) {
      if (e && e.quota && (e.quota - (e.usage || 0)) < pk.bytes * 1.05) { renderNew(t("nofree", { s: size(pk.bytes) })); return; }
      return createPack({ name: (d.name || "").trim() || t("area.default"), bbox: d.bbox, maxz: top, s: d.s, src: d.src, plan: pk })
        .then(function (p) {
          draft = null; draft0.name = "";
          renderNew();
          startJob(p);
        });
    }).catch(function (e) { renderNew(errText(e)); });
  }
  function newId() { return "p" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36); }
  function createPack(o) {
    var id = newId();
    return rootDir().then(function (root) { return root.getDirectoryHandle(id, { create: true }); }).then(function (dir) {
      var meta = OC.normMeta({ id: id, name: o.name, bbox: o.bbox, maxz: o.maxz, src: o.s ? o.s.url : "", build: o.s ? o.s.build : "",
        created: Date.now(), bytes: o.plan ? o.plan.bytes : 0, tiles: o.plan ? o.plan.ids.length : 0, chunks: o.plan ? o.plan.cs.length : 0,
        tc: o.src ? o.src.h.tileComp : 2, state: "dl", sig: o.src ? OC.headerSig(o.src.h) : "", replaces: o.replaces || "" });
      var p = { meta: meta, dir: dir, plan: o.plan || null, files: {}, index: null };
      var w = o.plan ? writeFile(dir, "plan.bin", OC.packToBin(o.plan)) : Promise.resolve();
      return w.then(function () { return writeFile(dir, "meta.json", JSON.stringify(meta)); }).then(function () {
        packs.push(p);
        renderList();
        return p;
      });
    });
  }
  function updatePack(old) {
    if (!online()) { toast(t("offline")); return; }
    if (packs.some(function (p) { return p.meta.replaces === old.meta.id; })) return;
    createPack({ name: old.meta.name, bbox: old.meta.bbox, maxz: old.meta.maxz, replaces: old.meta.id })
      .then(function (p) { startJob(p); })
      .catch(function (e) { toast(errText(e)); });
  }
  function confirmDlg(q, okLabel, fn) {
    var dlg = el("dialog", "osm-dlg off-dlg");
    dlg.appendChild(el("p", "", q));
    var row = el("div", "osm-actions");
    row.appendChild(button(t("keep"), "osm-btn", function () { dlg.close(); }));
    row.appendChild(button(okLabel, "osm-btn primary off-yes", function () { dlg.close(); fn(); }));
    dlg.appendChild(row);
    dlg.addEventListener("close", function () { dlg.remove(); });
    document.body.appendChild(dlg);
    if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
  }
  function afterChange() {
    redrawLayer();
    renderList();
    if (!readyPacks().length && H.currentBase && H.currentBase() === "offline" && H.setBase) H.setBase(autoPrev || "standard");
  }

  // ---------- settings drawer ----------
  var setBox = null, setSum = null;
  function paintSettings() {
    if (!setSum) return;
    var used = packs.reduce(function (a, p) { return a + (p.meta.bytes || 0); }, 0);
    setSum.textContent = packs.length ? t("settings.sum", { n: packs.length, u: size(used) }) : t("settings.none");
  }

  // ---------- boot ----------
  function boot() {
    sheet = el("aside", "osm-sheet off-sheet");
    sheet.id = "offline-panel";
    sheet.setAttribute("aria-label", t("title"));
    sheet.hidden = true;
    document.body.appendChild(sheet);
    try { new ResizeObserver(function () { setH(); paintArea(); }).observe(sheet); } catch (e) {}
    var sbody = document.getElementById("mapsettings-body");
    if (sbody) {
      setBox = el("div", "off-settings");
      setBox.appendChild(el("h4", "", t("title")));
      setSum = el("p", "", "—");
      setBox.appendChild(setSum);
      setBox.appendChild(button(t("btn"), "ms-btn off-open", openSheet));
      sbody.insertBefore(setBox, sbody.firstChild);
    }
    if (H.addBaseLayer) H.addBaseLayer("offline", layer, t("layer"));
    loadPacks().then(function () {
      renderList();
      if (readyPacks().length) {
        if (H.prefLayer && H.prefLayer() === "offline" && H.setBase) H.setBase("offline");
        else if (!online()) goOffline();
      }
      var resume = packs.filter(function (p) { return p.meta.state !== "ready" && !p.meta.paused; })[0];
      if (resume && online()) {
        startJob(resume, true);
        toast(t("resumed", { n: resume.meta.name }));
      }
    });
  }

  // test hook (harness)
  window.__orosMapsOffline = {
    open: openSheet, close: closeSheet, packs: function () { return packs; }, job: function () { return job; },
    reload: function () { return loadPacks().then(function () { afterChange(); return packs; }); },
    check: checkSize, download: download, pause: pauseJob, draft: function () { return draft; },
    search: function (q) { return H.offlineSearch(q, null, 8); }, layer: layer
  };
  boot();
})();
