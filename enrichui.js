// ============================================================
// orOS — enrichui.js: the review dialog of "Update from online
// sources" (shared by Contacts, CRM and Newsletter)
// ------------------------------------------------------------
// OrosEnrichUI.open({
//   lang: "en" | "el",
//   items: [{ id, name, rec }],        // rec as enrich.js lookup() wants
//   kinds: ["photo", "link", …],       // what this app can store
//   apply: function (picks) → number   // picks: [{ id, list: [suggestion] }]
// })
// Loads ../enrich.js and the Reader's network layer on first use, so
// apps pay nothing until the button is pressed. Every suggestion is a
// row with a tick box ("check" ones start unticked); nothing is written
// until Apply, and the app's apply() makes one write with Undo.
// Page text is shown with textContent only; pictures are redrawn as a
// 128×128 JPEG data URL before they reach the app.
// ============================================================
(function (root) {
  "use strict";

  var BASE = (function () {
    var s = document.currentScript && document.currentScript.src;
    return s ? s.replace(/[^/]*$/, "") : "../";
  })();
  var DEPS = ["feeds/core.js", "feeds/fetch.js", "enrich.js"];
  var AVATAR = 128;
  var PARALLEL = 3;

  var S = {
    en: {
      title: "Update from online sources",
      text: "orOS looks only where these records already point: the profile people set for their own e-mail on Gravatar (only a coded fingerprint of the address is sent), the website or link page (Linktree and similar) saved in the record, read once like a visitor would, and the public GitHub, Bluesky or Mastodon profiles these point to. Facebook, Instagram, LinkedIn, X and TikTok are never read. Nothing changes until you tick what to keep.",
      count: "Records to check: {n}",
      go: "Search", stop: "Stop", apply: "Apply selected", close: "Close",
      busy: "Checking {i} of {n}…", none: "Nothing new was found.",
      found: "Suggestions for {n} records. Ticked ones are sure or likely; check the rest before ticking.",
      offline: "You are offline.",
      all: "Tick all", nothing: "Untick all",
      "k.photo": "Photo", "k.link": "Link", "k.phone": "Phone", "k.email": "E-mail address", "k.birthday": "Birthday",
      "k.job": "Job title", "k.org": "Company", "k.address": "Address", "k.name": "Name",
      "c.sure": "sure", "c.likely": "likely", "c.check": "check it",
      via: "from {s}"
    },
    el: {
      title: "Ενημέρωση από online πηγές",
      text: "Το orOS ψάχνει μόνο εκεί που ήδη δείχνουν αυτές οι εγγραφές: στο προφίλ που έχει βάλει ο ίδιος ο άνθρωπος για το email του στο Gravatar (στέλνεται μόνο ένα κωδικοποιημένο αποτύπωμα της διεύθυνσης) στην ιστοσελίδα ή στο link page (Linktree κ.ά.) που είναι αποθηκευμένα στην εγγραφή, με μία ανάγνωση όπως θα την έκανε ένας επισκέπτης, και στα δημόσια προφίλ GitHub, Bluesky ή Mastodon στα οποία αυτά οδηγούν. Facebook, Instagram, LinkedIn, X και TikTok δεν διαβάζονται ποτέ. Τίποτα δεν αλλάζει μέχρι να τσεκάρεις τι κρατάς.",
      count: "Εγγραφές για έλεγχο: {n}",
      go: "Αναζήτηση", stop: "Διακοπή", apply: "Εφαρμογή επιλεγμένων", close: "Κλείσιμο",
      busy: "Έλεγχος {i} από {n}…", none: "Δεν βρέθηκε κάτι νέο.",
      found: "Προτάσεις για {n} εγγραφές. Τα τσεκαρισμένα είναι σίγουρα ή πιθανά· τα υπόλοιπα έλεγξέ τα πριν τα τσεκάρεις.",
      offline: "Είσαι εκτός σύνδεσης.",
      all: "Επιλογή όλων", nothing: "Καμία επιλογή",
      "k.photo": "Φωτογραφία", "k.link": "Σύνδεσμος", "k.phone": "Τηλέφωνο", "k.email": "Διεύθυνση email", "k.birthday": "Γενέθλια",
      "k.job": "Θέση εργασίας", "k.org": "Εταιρεία", "k.address": "Διεύθυνση", "k.name": "Ονοματεπώνυμο",
      "c.sure": "σίγουρο", "c.likely": "πιθανό", "c.check": "έλεγξέ το",
      via: "από {s}"
    }
  };

  var CSS = [
    ".oe-dlg{max-width:min(560px,calc(100vw - 24px));width:100%;background:var(--panel-bg,#1d2026);color:var(--text,#e6e6e6);border:1px solid var(--border,#2c3038);border-radius:12px;padding:16px;box-sizing:border-box}",
    ".oe-dlg::backdrop{background:rgba(0,0,0,.55)}",
    ".oe-dlg h3{margin:0 0 8px;font-size:1.1em}",
    ".oe-dlg p{margin:6px 0;font-size:.9em;line-height:1.4}",
    ".oe-dim{opacity:.75}",
    ".oe-list{max-height:52vh;overflow-y:auto;margin:8px 0;display:flex;flex-direction:column;gap:10px}",
    ".oe-rec{border:1px solid var(--border,#2c3038);border-radius:8px;padding:8px}",
    ".oe-rec>b{display:block;margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    ".oe-row{display:flex;align-items:center;gap:8px;min-height:40px;cursor:pointer}",
    ".oe-row input{flex:none;width:20px;height:20px}",
    ".oe-row img{width:40px;height:40px;border-radius:50%;object-fit:cover;flex:none}",
    ".oe-txt{display:flex;flex-direction:column;min-width:0;flex:1}",
    ".oe-txt span,.oe-txt small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    ".oe-txt small{opacity:.75}",
    ".oe-c{font-size:.75em;padding:1px 6px;border-radius:8px;flex:none;border:1px solid var(--border,#2c3038)}",
    ".oe-c.sure{background:var(--accent-soft,rgba(212,175,55,.16))}",
    ".oe-c.check{border-color:#c05252}",
    ".oe-btns{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;margin-top:8px}",
    ".oe-btns button{min-height:40px;padding:0 14px;border-radius:8px;border:1px solid var(--border,#2c3038);background:transparent;color:inherit;font:inherit;cursor:pointer}",
    ".oe-btns button.prim{background:var(--accent,#d4af37);color:#14120d;border-color:transparent}",
    ".oe-btns .oe-left{margin-right:auto}"
  ].join("\n");

  var loading = null;
  function load(src) {
    return new Promise(function (ok, fail) {
      var s = document.createElement("script");
      s.src = BASE + src;
      s.onload = ok;
      s.onerror = function () { fail(new Error("load " + src)); };
      document.head.appendChild(s);
    });
  }
  function ready() {
    if (root.OrosEnrich && root.orosFeedsFetch) return Promise.resolve();
    if (!loading) {
      loading = DEPS.reduce(function (p, d) {
        return p.then(function () {
          if (d === "feeds/core.js" && root.orosFeedsCore) return;
          if (d === "feeds/fetch.js" && root.orosFeedsFetch) return;
          if (d === "enrich.js" && root.OrosEnrich) return;
          return load(d);
        });
      }, Promise.resolve());
      loading.catch(function () { loading = null; });
    }
    return loading;
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function fmt(s, v) { return String(s).replace(/\{(\w+)\}/g, function (m, k) { return v[k] != null ? String(v[k]) : m; }); }

  // Picture → 128×128 centre-cropped JPEG (the size Contacts keeps).
  function toAvatar(blob) {
    if (!blob || typeof createImageBitmap !== "function") return Promise.resolve(null);
    return createImageBitmap(blob).then(function (bmp) {
      var side = Math.min(bmp.width, bmp.height);
      if (side < 32) return null;
      var cv = document.createElement("canvas");
      cv.width = AVATAR; cv.height = AVATAR;
      var ctx = cv.getContext("2d");
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, AVATAR, AVATAR);
      var uri = cv.toDataURL("image/jpeg", 0.8);
      return uri.length <= 50000 ? uri : null;
    }, function () { return null; });
  }

  function valueText(s, L) {
    if (s.k === "birthday") return s.v.day.split("-").reverse().join("/") + (s.v.year ? "/" + s.v.year : "");
    if (s.k === "link") return (s.label ? s.label + " · " : "") + s.v.replace(/^https?:\/\//, "");
    return String(s.v);
  }

  function open(opts) {
    var L = S[opts.lang === "el" ? "el" : "en"];
    var kinds = opts.kinds || ["photo", "link", "phone", "email", "birthday", "job", "org", "address", "name"];
    var items = (opts.items || []).filter(function (x) { return x && x.id && x.rec; });
    if (!document.getElementById("oe-css")) {
      var st = el("style");
      st.id = "oe-css";
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    var dlg = el("dialog", "oe-dlg");
    dlg.setAttribute("aria-label", L.title);
    dlg.appendChild(el("h3", "", L.title));
    dlg.appendChild(el("p", "oe-dim", L.text));
    var stat = el("p", "");
    stat.setAttribute("aria-live", "polite");
    stat.textContent = fmt(L.count, { n: items.length });
    dlg.appendChild(stat);
    var list = el("div", "oe-list");
    dlg.appendChild(list);
    var btns = el("div", "oe-btns");
    var bAll = el("button", "oe-left", L.all), bGo = el("button", "prim", L.go),
        bApply = el("button", "prim", L.apply), bClose = el("button", "", L.close);
    [bAll, bGo, bApply, bClose].forEach(function (b) { b.type = "button"; btns.appendChild(b); });
    bAll.hidden = true; bApply.hidden = true;
    dlg.appendChild(btns);
    document.body.appendChild(dlg);

    var busy = false, results = [], boxes = [];
    function render(r) {
      var box = el("div", "oe-rec");
      box.appendChild(el("b", "", r.name));
      r.list.forEach(function (s) {
        var row = el("label", "oe-row");
        var cb = el("input");
        cb.type = "checkbox";
        cb.checked = s.on;
        cb.addEventListener("change", function () { s.on = cb.checked; });
        boxes.push({ cb: cb, s: s });
        row.appendChild(cb);
        if (s.k === "photo") {
          var im = el("img");
          im.alt = "";
          im.src = s.v;
          row.appendChild(im);
        }
        var tx = el("span", "oe-txt");
        tx.appendChild(el("span", "", L["k." + s.k] + (s.k === "photo" ? "" : ": " + valueText(s, L))));
        tx.appendChild(el("small", "", fmt(L.via, { s: s.src.join(", ") })));
        row.appendChild(tx);
        row.appendChild(el("span", "oe-c " + s.conf, L["c." + s.conf]));
        box.appendChild(row);
      });
      list.appendChild(box);
      bAll.hidden = false;
      bApply.hidden = false;
    }
    function one(item) {
      return root.OrosEnrich.lookup(item.rec).then(function (sugg) {
        sugg = sugg.filter(function (s) { return kinds.indexOf(s.k) >= 0; });
        var photo = sugg.filter(function (s) { return s.k === "photo"; })[0];
        var p = photo ? root.OrosEnrich.getImage(photo.v).then(toAvatar, function () { return null; }) : Promise.resolve(null);
        return p.then(function (uri) {
          if (photo) {
            if (uri) photo.v = uri;
            else sugg = sugg.filter(function (s) { return s !== photo; });
          }
          if (!sugg.length) return;
          sugg.forEach(function (s) { s.on = s.conf !== "check"; });
          var r = { id: item.id, name: item.name, list: sugg };
          results.push(r);
          if (busy) render(r);
        });
      }, function () {});
    }
    function run() {
      if (busy) { busy = false; return; }
      if (root.navigator && root.navigator.onLine === false) { stat.textContent = L.offline; return; }
      busy = true;
      results = []; boxes = [];
      list.textContent = "";
      bGo.textContent = L.stop;
      bApply.hidden = true; bAll.hidden = true;
      var k = 0, done = 0;
      function show() { stat.textContent = fmt(L.busy, { i: done, n: items.length }); }
      show();
      function worker() {
        if (!busy || k >= items.length) return Promise.resolve();
        var it = items[k++];
        return one(it).then(function () { done++; if (busy) show(); return worker(); });
      }
      ready().then(function () {
        var ws = [];
        for (var i = 0; i < PARALLEL; i++) ws.push(worker());
        return Promise.all(ws);
      }).then(function () {
        var stopped = !busy;
        busy = false;
        bGo.textContent = L.go;
        if (stopped && !results.length) { stat.textContent = fmt(L.count, { n: items.length }); return; }
        stat.textContent = results.length ? fmt(L.found, { n: results.length }) : L.none;
        bAll.textContent = boxes.every(function (b) { return b.cb.checked; }) ? L.nothing : L.all;
      }, function () {
        busy = false;
        bGo.textContent = L.go;
        stat.textContent = L.none;
      });
    }
    bGo.addEventListener("click", run);
    bAll.addEventListener("click", function () {
      var on = boxes.some(function (b) { return !b.cb.checked; });
      boxes.forEach(function (b) { b.cb.checked = on; b.s.on = on; });
      bAll.textContent = on ? L.nothing : L.all;
    });
    bApply.addEventListener("click", function () {
      var picks = results.map(function (r) {
        return { id: r.id, list: r.list.filter(function (s) { return s.on; }) };
      }).filter(function (p) { return p.list.length; });
      busy = false;
      dlg.close();
      if (picks.length) opts.apply(picks);
    });
    bClose.addEventListener("click", function () { dlg.close(); });
    dlg.addEventListener("close", function () { busy = false; setTimeout(function () { dlg.remove(); }, 0); });
    dlg.showModal();
    if (items.length === 1) run();
  }

  root.OrosEnrichUI = { open: open, ready: ready, toAvatar: toAvatar };
})(window);
