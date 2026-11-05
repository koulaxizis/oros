/*! ============================================================
 *  orOS Start page — startpage/startpage.js (SP-1)
 *  The home page of the web: orOS Portable / USB open it in the
 *  Internet window, anyone else can make it their browser's home page
 *  (useoros.online/startpage/). Clock and greeting, a search field
 *  (DuckDuckGo, a web address, or "oros <words>" for orOS's own
 *  search), the favourites of Bookmarks with a link to the app, a Tor
 *  button where the computer has Tor Browser, and a link to orOS.
 *
 *  Reads only, never writes storage:
 *    oros-lang, oros-theme              shell keys (language, theme)
 *    oros-me                            ME v1 (your name, Part IV)
 *    oros-bookmarks-data                Bookmarks' items with fav true
 *    oros-lock                          screen lock set up: no name, no
 *                                       favourites (they stay behind it)
 *  Tor: the orOS System extension (Portable, USB) sets
 *  data-oros-sys-tor="1" on <html> and opens Tor Browser on the
 *  document event "oros-sys-tor"; without it the button stays hidden.
 *  Every title and address goes into the page through textContent /
 *  href of http(s) only.
 *  ============================================================ */
(function () {
  "use strict";

  var STR = {
    en: {
      title: "Start", morning: "Good morning", afternoon: "Good afternoon", evening: "Good evening",
      q: "Search the web", qPh: "Search with DuckDuckGo or type an address",
      qHint: "Start with “oros ” to search inside orOS",
      favs: "Favourites", all: "All bookmarks", none: "Star a bookmark in Bookmarks and it shows here.",
      locked: "With the screen lock on, your favourites stay inside orOS.",
      tor: "New Tor window", torHint: "opens Tor Browser", oros: "Open orOS"
    },
    el: {
      title: "Αρχική", morning: "Καλημέρα", afternoon: "Καλό απόγευμα", evening: "Καλησπέρα",
      q: "Αναζήτηση στο διαδίκτυο", qPh: "Αναζήτηση στο DuckDuckGo ή γράψε διεύθυνση",
      qHint: "Ξεκίνα με «oros » για αναζήτηση μέσα στο orOS",
      favs: "Αγαπημένες", all: "Όλοι οι σελιδοδείκτες", none: "Βάλε αστέρι σε έναν σελιδοδείκτη στους Σελιδοδείκτες και θα εμφανιστεί εδώ.",
      locked: "Με το κλείδωμα οθόνης ενεργό, οι αγαπημένες σου μένουν μέσα στο orOS.",
      tor: "Νέο παράθυρο Tor", torHint: "ανοίγει τον Tor Browser", oros: "Άνοιγμα orOS"
    },
    de: {
      title: "Start", morning: "Guten Morgen", afternoon: "Guten Tag", evening: "Guten Abend",
      q: "Im Web suchen", qPh: "Mit DuckDuckGo suchen oder Adresse eingeben",
      qHint: "Mit „oros “ beginnen, um in orOS zu suchen",
      favs: "Favoriten", all: "Alle Lesezeichen", none: "Markiere ein Lesezeichen in Lesezeichen mit einem Stern, dann erscheint es hier.",
      locked: "Mit aktiver Bildschirmsperre bleiben deine Favoriten in orOS.",
      tor: "Neues Tor-Fenster", torHint: "öffnet den Tor Browser", oros: "orOS öffnen"
    }
  };
  var LOCALE = { en: "en-GB", el: "el-GR", de: "de-DE" };
  var MAX_FAVS = 24;
  var NAME_MAX = 40;

  function read(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function readJson(k) { try { return JSON.parse(read(k) || "null"); } catch (e) { return null; } }
  function $(id) { return document.getElementById(id); }

  var lang = (function () {
    var l = read("oros-lang") || (navigator.language || "en").slice(0, 2);
    return STR[l] ? l : "en";
  })();
  function t(k) { return STR[lang][k] || STR.en[k]; }

  // The name from Settings › Appearance › Your name (ME v1), or "".
  function myName() {
    var d = readJson("oros-me");
    var f = d && d.f && d.f.name;
    var v = f && typeof f.v === "string" ? f.v.replace(/[\u0000-\u001f\u007f]/g, "").trim() : "";
    return v.slice(0, NAME_MAX);
  }

  // Hours 5-11 morning, 12-17 afternoon, otherwise evening.
  function greeting(h) { return h >= 5 && h < 12 ? "morning" : (h >= 12 && h < 18 ? "afternoon" : "evening"); }

  // What the search field does with what was typed.
  //   { kind: "oros", q } · { kind: "url", url } · { kind: "web", url } · null
  function target(raw) {
    var s = String(raw || "").trim();
    if (!s) return null;
    var m = /^oros\s+(.+)$/i.exec(s);
    if (m) return { kind: "oros", url: "../?search=" + encodeURIComponent(m[1].trim()) };
    if (!/\s/.test(s)) {
      var u = /^https?:\/\//i.test(s) ? s
        : (/^(localhost(:\d+)?|[\w-]+(\.[\w-]+)+)(:\d+)?([\/?#].*)?$/i.test(s) && /[a-z]/i.test(s.replace(/\..*$/, "")) ? "https://" + s : "");
      if (u) {
        try {
          var p = new URL(u);
          if (p.protocol === "http:" || p.protocol === "https:") return { kind: "url", url: p.href };
        } catch (e) { /* not an address: search it */ }
      }
    }
    return { kind: "web", url: "https://duckduckgo.com/?q=" + encodeURIComponent(s) };
  }

  // Bookmarks' favourites, newest change first (the app's own order),
  // http(s) addresses only.
  function favourites(data) {
    var items = data && data.items && typeof data.items === "object" ? data.items : {};
    var dead = data && data.deleted && typeof data.deleted === "object" ? data.deleted : {};
    return Object.keys(items).map(function (id) { return items[id]; })
      .filter(function (it) {
        if (!it || it.fav !== true || typeof it.url !== "string" || dead[it.id]) return false;
        try { var p = new URL(it.url); return p.protocol === "http:" || p.protocol === "https:"; }
        catch (e) { return false; }
      })
      .sort(function (a, b) { return ((b.modified || 0) - (a.modified || 0)) || (a.id < b.id ? -1 : 1); })
      .slice(0, MAX_FAVS);
  }

  function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ""); } catch (e) { return ""; } }
  // The same tile colour as Bookmarks (faviconStyle).
  function tileColour(host) {
    var h = 0;
    for (var i = 0; i < host.length; i++) h = (h * 31 + host.charCodeAt(i)) >>> 0;
    return "hsl(" + (h % 360) + ", 42%, 34%)";
  }

  var api = { target: target, favourites: favourites, greeting: greeting, STR: STR };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; return; }

  var SVG_SEARCH = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>';
  var SVG_TOR = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/></svg>';

  var locked = !!read("oros-lock");

  function paintClock() {
    var now = new Date();
    $("clock").textContent = now.toLocaleTimeString(LOCALE[lang], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    var day = now.toLocaleDateString(LOCALE[lang], { weekday: "long", day: "numeric", month: "long" });
    var name = locked ? "" : myName();
    $("greet").textContent = day + " · " + t(greeting(now.getHours())) + (name ? ", " + name : "");
  }

  function paintFavs() {
    var grid = $("fav-grid"), empty = $("favs-empty");
    grid.textContent = "";
    if (locked) { empty.textContent = t("locked"); empty.hidden = false; return; }
    var list = favourites(readJson("oros-bookmarks-data"));
    empty.textContent = t("none");
    empty.hidden = list.length > 0;
    list.forEach(function (it) {
      var host = hostOf(it.url);
      var li = document.createElement("li");
      var a = document.createElement("a");
      a.href = it.url;
      a.rel = "noreferrer";
      a.title = it.url;
      var ic = document.createElement("span");
      ic.className = "fav-ico";
      ic.setAttribute("aria-hidden", "true");
      ic.style.background = tileColour(host);
      ic.textContent = (host[0] || "?").toUpperCase();
      var nm = document.createElement("span");
      nm.className = "fav-name";
      nm.textContent = String(it.title || host).slice(0, 120);
      a.appendChild(ic);
      a.appendChild(nm);
      li.appendChild(a);
      grid.appendChild(li);
    });
  }

  function paintTor() {
    var b = $("tor-btn");
    b.hidden = document.documentElement.getAttribute("data-oros-sys-tor") !== "1";
  }

  function theme() {
    document.documentElement.setAttribute("data-theme", read("oros-theme") === "light" ? "light" : "dark");
  }

  function boot() {
    document.documentElement.lang = lang;
    document.title = t("title") + " · orOS";
    theme();
    $("q-label").textContent = t("q");
    $("q").placeholder = t("qPh");
    $("q").setAttribute("aria-describedby", "q-hint");
    $("q-ico").innerHTML = SVG_SEARCH;                       // static icon
    $("q-hint").textContent = t("qHint");
    $("favs-h").textContent = t("favs");
    $("all-link").textContent = t("all") + " →";
    $("oros-link").textContent = t("oros");
    var tb = $("tor-btn");
    tb.innerHTML = SVG_TOR;                                  // static icon
    var tl = document.createElement("span");
    tl.textContent = t("tor");
    var th = document.createElement("span");
    th.className = "act-hint";
    th.textContent = t("torHint");
    tb.appendChild(tl);
    tb.appendChild(th);
    tb.addEventListener("click", function () { document.dispatchEvent(new CustomEvent("oros-sys-tor")); });

    $("find").addEventListener("submit", function (e) {
      e.preventDefault();
      var go = target($("q").value);
      if (go) location.href = go.url;
    });

    paintClock();
    paintFavs();
    paintTor();
    setInterval(paintClock, 15000);
    new MutationObserver(paintTor).observe(document.documentElement, { attributes: true, attributeFilter: ["data-oros-sys-tor"] });
    // Bookmarks, the name or the theme changed in orOS (another tab).
    window.addEventListener("storage", function (e) {
      if (e.key === "oros-lock") locked = !!read("oros-lock");
      if (e.key === "oros-theme") theme();
      if (e.key === "oros-bookmarks-data" || e.key === "oros-lock") paintFavs();
      if (e.key === "oros-me" || e.key === "oros-lock") paintClock();
    });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState !== "visible") return;
      locked = !!read("oros-lock");
      paintClock();
      paintFavs();
    });
    if (!matchMedia("(pointer: coarse)").matches) $("q").focus();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
