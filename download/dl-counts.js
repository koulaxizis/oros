// APPS-DL: shows the download counts of our Android apps, read from the counter
// (https://apps.koulaxizis.workers.dev/stats.json, tools/apps-counter/). The same
// file is used on useoros.online, nulljsfx.tech, noxpress.tech and koulaxizis.gr.
// It only reads public numbers: nothing about the visitor is sent or stored.
//
//   data-dl="pkg,prefix."     sum of these packages (a trailing "." matches a prefix);
//     data-dl-ch="manager,…"  only these channels (default: every channel).
//     The number goes into the element's [data-n] child, and the element is
//     shown (its hidden attribute removed) once the number is above 0.
//   data-dl-tiles="downloads" every GitHub APK link inside gets a small count.
//   data-dl-table="pkg,prefix." a table per app and channel is put inside
//     (shown once it has a number); app names come from the links on the page
//     (data-dl-name on a link) and from data-dl-names='{"pkg":"Name"}'.
// Words follow the closest lang attribute (en, el, de).
(function () {
  "use strict";
  var URL = "https://apps.koulaxizis.workers.dev/stats.json";
  var ORDER = ["manager", "github", "fdroid", "droidify", "obtainium", "other", "estimate"];
  var WORDS = {
    en: { manager: "Koulaxizis Apps", github: "Direct APK", fdroid: "F-Droid", droidify: "Droid-ify", obtainium: "Obtainium",
      other: "Other", estimate: "Before 19/11 (estimate)", play_appilix: "Old app on Google Play", app: "App", total: "Total", byHand: "counted by hand", since: "Counted since 19 November 2026 and updated every hour; earlier downloads are an estimate." },
    el: { manager: "Εφαρμογές Koulaxizis", github: "Απευθείας APK", fdroid: "F-Droid", droidify: "Droid-ify", obtainium: "Obtainium",
      other: "Άλλο", estimate: "Πριν τις 19/11 (εκτίμηση)", play_appilix: "Παλιά εφαρμογή στο Google Play", app: "Εφαρμογή", total: "Σύνολο", byHand: "καταμέτρηση με το χέρι", since: "Μετράμε από τις 19 Νοεμβρίου 2026 και ενημερώνεται κάθε ώρα· οι παλαιότερες λήψεις είναι εκτίμηση." },
    de: { manager: "Koulaxizis Apps", github: "Direkte APK", fdroid: "F-Droid", droidify: "Droid-ify", obtainium: "Obtainium",
      other: "Andere", estimate: "Vor 19.11. (geschätzt)", play_appilix: "Alte App bei Google Play", app: "App", total: "Gesamt", byHand: "von Hand gezählt", since: "Gezählt seit 19. November 2026, stündlich aktualisiert; frühere Downloads sind geschätzt." },
  };

  function lang(el) {
    var l = (el.closest("[lang]") || document.documentElement).getAttribute("lang") || "en";
    l = l.slice(0, 2).toLowerCase();
    return WORDS[l] ? l : "en";
  }
  function fmt(n, l) {
    try { return new Intl.NumberFormat(l).format(n); } catch (e) { return String(n); }
  }
  function num(v) {
    if (typeof v === "number") return v;
    if (v && typeof v.n === "number") return v.n;
    return 0;
  }
  function matches(list, pkg) {
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (p === pkg || (p.slice(-1) === "." && pkg.indexOf(p) === 0)) return true;
    }
    return false;
  }
  function split(s) {
    return String(s || "").split(",").map(function (x) { return x.trim(); }).filter(Boolean);
  }
  function sum(apps, pkgs, chs) {
    var n = 0;
    Object.keys(apps).forEach(function (pkg) {
      if (!matches(pkgs, pkg)) return;
      var row = apps[pkg];
      Object.keys(row).forEach(function (ch) { if (!chs.length || chs.indexOf(ch) >= 0) n += num(row[ch]); });
    });
    return n;
  }
  // GitHub download link → "owner/repo/asset name" (stats.json `files` keys).
  function fileKey(href) {
    var m = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/releases\/(?:download\/[^/]+|latest\/download)\/([^/?#]+\.apk)$/.exec(href || "");
    return m ? m[1] + "/" + decodeURIComponent(m[2]) : null;
  }
  function names(scope, files) {
    var out = {};
    scope.querySelectorAll("a[href]").forEach(function (a) {
      var pkg = files[fileKey(a.href)];
      var span = a.querySelector("span");
      var t = (a.getAttribute("data-dl-name") || (span ? span.firstChild && span.firstChild.textContent : a.textContent) || "").trim();
      if (pkg && t && !out[pkg]) out[pkg] = t;
    });
    return out;
  }

  function render(s) {
    var apps = (s && s.apps) || {};
    var files = (s && s.files) || {};
    document.querySelectorAll("[data-dl]").forEach(function (el) {
      var n = sum(apps, split(el.getAttribute("data-dl")), split(el.getAttribute("data-dl-ch")));
      var slot = el.querySelector("[data-n]") || el;
      if (n > 0) { slot.textContent = fmt(n, lang(el)); el.hidden = false; }
    });
    document.querySelectorAll("[data-dl-tiles]").forEach(function (box) {
      var word = box.getAttribute("data-dl-tiles");
      var l = lang(box);
      box.querySelectorAll("a[href]").forEach(function (a) {
        var pkg = files[fileKey(a.href)];
        if (!pkg || !apps[pkg] || a.querySelector(".dl-tile")) return;
        var n = sum(apps, [pkg], []);
        if (!(n > 0)) return;
        var tag = document.createElement("small");
        tag.className = "dl-tile";
        tag.textContent = fmt(n, l) + (word ? " " + word : "");
        (a.querySelector("span") || a).appendChild(tag);
      });
    });
    document.querySelectorAll("[data-dl-table]").forEach(function (box) {
      if (box.querySelector("table")) return;
      var pkgs = split(box.getAttribute("data-dl-table"));
      var l = lang(box), w = WORDS[l];
      var rows = Object.keys(apps).filter(function (p) { return matches(pkgs, p) && sum(apps, [p], []) > 0; });
      if (!rows.length) return;
      var chs = [];
      rows.forEach(function (p) { Object.keys(apps[p]).forEach(function (c) { if (chs.indexOf(c) < 0) chs.push(c); }); });
      chs.sort(function (a, b) {
        var i = ORDER.indexOf(a), j = ORDER.indexOf(b);
        return (i < 0 ? 99 : i) - (j < 0 ? 99 : j) || (a < b ? -1 : 1);
      });
      var nm = names(box.closest("[lang]") || document, files);
      try { var extra = JSON.parse(box.getAttribute("data-dl-names") || "{}"); Object.keys(extra).forEach(function (k) { nm[k] = nm[k] || String(extra[k]); }); } catch (e) { /* names stay */ }
      rows.sort(function (a, b) { return sum(apps, [b], []) - sum(apps, [a], []); });
      var table = document.createElement("table");
      table.className = "dl-table";
      var head = table.createTHead().insertRow();
      [w.app].concat(chs.map(function (c) { return w[c] || c; }), [w.total]).forEach(function (t) {
        var th = document.createElement("th"); th.scope = "col"; th.textContent = t; head.appendChild(th);
      });
      var body = table.createTBody();
      rows.forEach(function (p) {
        var tr = body.insertRow();
        var th = document.createElement("th"); th.scope = "row"; th.textContent = nm[p] || p; tr.appendChild(th);
        chs.forEach(function (c) {
          var td = tr.insertCell(), v = apps[p][c];
          td.textContent = v === undefined ? "–" : fmt(num(v), l);
          if (v && v.at && c !== "estimate") td.title = w.byHand + ", " + v.at;
        });
        var tot = tr.insertCell(); tot.textContent = fmt(sum(apps, [p], []), l);
      });
      var wrap = document.createElement("div"); wrap.className = "tw"; wrap.appendChild(table);
      var note = document.createElement("p"); note.className = "dim"; note.textContent = w.since;
      box.appendChild(wrap); box.appendChild(note);
      box.hidden = false;
    });
  }

  if (!window.fetch) return;
  fetch(URL, { credentials: "omit", cache: "default" })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (s) { if (s && s.v === 1) render(s); })
    .catch(function () { /* no numbers: the page stays as it is */ });
})();
