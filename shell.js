// ============================================================
// orOS Core v0.4 — Shell logic (skins + wallpapers edition)
// Sections:
//   1. State, skin registry, wallpaper registry, icon constants
//   2. Preferences (skin, language, theme, wallpaper)
//   3. Language apply
//   4. Theme apply
//   5. Skin apply
//   5b. Wallpaper apply
//   6. Clock (24h)
//   7. PWA: broker-aware registration + install flow + version toast
//   8. Apps loading & menu rendering (+ appearance + install/SYNC)
//   9. Sync UI & shell slice registration
//   10. App opening / return (fullscreen takeover)
//   11. Menu open/close
//   12. Wiring & boot
// Update lifecycle is owned by the inline broker in index.html —
// the shell only mirrors "update ready" into its menu button.
// ============================================================
(function () {
  "use strict";

  var APP_VERSION = "0.5.3";   // bump on every deploy (shows welcome toast)
  var VERSION_KEY = "oros-last-version";

  // ---------- 1. State & registries ----------
  var state = {
    lang:            null,   // "en" | "el"
    theme:           null,   // "dark" | "light"
    skin:            null,   // palette id (see SKINS)
    wallpaper:       null,   // wallpaper id (see WALLPAPERS)
    apps:            [],
    running:         null,
    deferredPrompt:  null,   // PWA install event

    // sync UI state
    syncUserEmail:   null,
    syncMsg:         null,   // { kind: "ok"|"err"|"dim", text: "…" }

    swUpdateReady:   false   // a new service worker version is waiting
  };

  var SKINS = [
    { id: "adwaita",    color: "#3584e4" },
    { id: "lumo",       color: "#6d4aff" },
    { id: "oros",       color: "#d4af37" },
    { id: "ubuntu",     color: "#e95420" },
    { id: "fedora",     color: "#51a2da" },
    { id: "mint",       color: "#87cf3e" },
    { id: "arch",       color: "#1793d1" },
    { id: "debian",     color: "#d70a53" },
    { id: "elementary", color: "#8c5ec7" },
    { id: "tux",        color: "#c9c9c9" }
  ];

  var DEFAULT_WALLPAPER = "sand";

  // Wallpapers live in JS (single source of truth): the SAME gradient
  // string feeds the desktop background AND the picker thumbnails —
  // WYSIWYG guaranteed, no CSS-specificity battles.
  var WALLPAPERS = [
    { id: "dusk",     pair: null,          css: "linear-gradient(160deg, #1b2735 0%, #10151f 45%, #0b0f17 100%)" },
    { id: "midnight", pair: "arch",        css: "linear-gradient(165deg, #0d1117 0%, #06080c 60%, #000000 100%)" },
    { id: "plum",     pair: "ubuntu",      css: "radial-gradient(ellipse at 30% 20%, #4a2545 0%, #2c1626 55%, #190d17 100%)" },
    { id: "forest",   pair: "mint",        css: "linear-gradient(150deg, #16281c 0%, #0e1a12 55%, #070f09 100%)" },
    { id: "ember",    pair: "debian",      css: "linear-gradient(160deg, #2b1810 0%, #1d0f0a 50%, #120806 100%)" },
    { id: "nordic",   pair: "fedora",      css: "linear-gradient(170deg, #2c3e50 0%, #1d2a38 55%, #131b24 100%)" },
    { id: "aurora",   pair: "elementary",  css: "linear-gradient(155deg, #10302b 0%, #0b2320 45%, #071512 100%)" },
    { id: "sand",     pair: "oros",        css: "linear-gradient(160deg, #33291d 0%, #241c13 55%, #161009 100%)" },
    { id: "mono",     pair: "tux",         css: "linear-gradient(170deg, #262626 0%, #1a1a1a 55%, #0e0e0e 100%)" },
    { id: "clear",    pair: null,          css: "" }   // "None": theme background
  ];

  function findWallpaper(id) {
    for (var i = 0; i < WALLPAPERS.length; i++) {
      if (WALLPAPERS[i].id === id) return WALLPAPERS[i];
    }
    return null;
  }

  var MOON_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  var SUN_SVG  = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="M4.93 4.93l1.41 1.41"/><path d="M17.66 17.66l1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="M4.93 19.07l1.41-1.41"/><path d="M17.66 6.34l1.41-1.41"/></svg>';
  var GRID_SVG = '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>';
  var DOWNLOAD_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>';
  var UPLOAD_ICON_SVG   = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/></svg>';
  var CLOUD_ICON_SVG    = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>';
  var EYE_SVG     = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  var EYE_OFF_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/></svg>';
  var PHOTO_ICON_SVG   = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>';
    // App icons (SVG — ForkAwesome rejected, handcrafted forever)
  var ICONS = {
    check: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
  };

  var swReg = null;   // service worker registration (fallback control)

  function isValidSkin(id) {
    for (var i = 0; i < SKINS.length; i++) {
      if (SKINS[i].id === id) return true;
    }
    return false;
  }

  // Any user-initiated settings change → the sync engine wants to know.
  // (Called ONLY from user action handlers — never from shellSliceSet,
  // which is fed by pulls. That would loop: pull → set → dirty → push.)
  function noteLocalChange() {
    if (window.orosSync && typeof window.orosSync.markDirty === "function") {
      window.orosSync.markDirty();
    }
  }

  // ---------- 2. Preferences ----------
  function initPrefs() {
    var params = new URLSearchParams(window.location.search);

    var urlLang    = params.get("lang");
    var storedLang = localStorage.getItem("oros-lang");
    state.lang     = (urlLang === "el" || urlLang === "en") ? urlLang
                   : (storedLang === "el" || storedLang === "en") ? storedLang
                   : "en";

        var urlSkin    = params.get("skin");
    var storedSkin = localStorage.getItem("oros-skin");
    state.skin     = isValidSkin(urlSkin) ? urlSkin
                   : isValidSkin(storedSkin) ? storedSkin
                   : "oros";                      // was "adwaita"
    localStorage.setItem("oros-skin", state.skin);

    var storedWp = localStorage.getItem("oros-wallpaper");
    state.wallpaper = findWallpaper(storedWp) ? storedWp : DEFAULT_WALLPAPER;
    localStorage.setItem("oros-wallpaper", state.wallpaper);

    state.theme = localStorage.getItem("oros-theme") === "light" ? "light" : "dark";
  }

  // ---------- 3. Language ----------
  function applyLang() {
    window.orosLang = state.lang;
    document.documentElement.setAttribute("lang", state.lang);

    var nodes = document.querySelectorAll("[data-i18n]");
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].textContent = window.t(nodes[i].getAttribute("data-i18n"));
    }
    var titled = document.querySelectorAll("[data-i18n-title]");
    for (var j = 0; j < titled.length; j++) {
      titled[j].setAttribute("title", window.t(titled[j].getAttribute("data-i18n-title")));
    }

    document.getElementById("btn-menu-label").textContent =
      state.running ? window.t("running.back") : window.t("bar.menu");

    var langBtn = document.getElementById("btn-lang");
    langBtn.textContent = state.lang === "en" ? "EL" : "EN";
    langBtn.setAttribute("title", window.t("lang.tooltip"));

    renderClock();
    renderMenu();
  }

  // ---------- 4. Theme ----------
  function applyTheme() {
    document.documentElement.setAttribute("data-theme", state.theme);
  }

  // ---------- 5. Skin ----------
    function applySkin() {
    if (!isValidSkin(state.skin)) state.skin = "oros";   // was "adwaita"
    document.documentElement.setAttribute("data-skin", state.skin);
  }

  // ---------- 5b. Wallpaper ----------
    function applyWallpaper() {
    var w = findWallpaper(state.wallpaper);
    if (!w) { state.wallpaper = DEFAULT_WALLPAPER; w = findWallpaper(DEFAULT_WALLPAPER); }
    var desktop = document.getElementById("oros-desktop");

    // Inline style: wins over any #oros-desktop background rule
    // (specificity-proof — the v0.4.0 class-based approach lost to
    // the existing ID rule).
    desktop.style.background = w.css;

    // Keep the class for potential future hooks, cleaned of stale ids
    var classes = desktop.className.split(/\s+/);
    for (var i = 0; i < classes.length; i++) {
      if (classes[i].indexOf("wp-") === 0) desktop.classList.remove(classes[i]);
    }
    desktop.classList.add("wp-" + state.wallpaper);
  }

  // Suggest, don't impose: when the user picks a skin with a classic
  // wallpaper pair AND is still on the default wallpaper, the
  // wallpaper follows the skin. Never overrides a deliberate choice.
  function maybeFollowSkin(newSkinId) {
    if (state.wallpaper !== DEFAULT_WALLPAPER) return false;
    for (var i = 0; i < WALLPAPERS.length; i++) {
      if (WALLPAPERS[i].pair === newSkinId) {
        state.wallpaper = WALLPAPERS[i].id;
        localStorage.setItem("oros-wallpaper", state.wallpaper);
        applyWallpaper();
        return true;
      }
    }
    return false;
  }

  // ---------- 6. Clock (24h) ----------
  function renderClock() {
    var now = new Date();
    var hh = String(now.getHours()).padStart(2, "0");
    var mm = String(now.getMinutes()).padStart(2, "0");
    var dateStr = now.toLocaleDateString(state.lang === "el" ? "el-GR" : "en-GB",
                          { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
    document.getElementById("bar-clock").textContent =
      hh + ":" + mm + "  ·  " + dateStr.replace(/,/g, "");
  }

  // ---------- 7. PWA ----------
  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;

    // The update lifecycle is owned by the inline broker in index.html
    // (always network-fresh). The shell only mirrors its state into
    // the menu button.
    window.addEventListener("oros-update-ready", function () {
      state.swUpdateReady = true;
      renderMenu();
    });

    // Broker fired before shell.js finished loading?
    if (window.__orosUpdateReady) {
      state.swUpdateReady = true;
      renderMenu();
    }
  }

  function setupInstallFlow() {
    window.addEventListener("beforeinstallprompt", function (e) {
      e.preventDefault();
      state.deferredPrompt = e;
      renderMenu();
    });

    window.addEventListener("appinstalled", function () {
      state.deferredPrompt = null;
      renderMenu();
    });
  }

  // Silent-update visual confirmation: if the running version differs
  // from the last one the user SAW (SW activated while the app was
  // closed — no chance for the update toast), greet them briefly.
  function checkVersionToast() {
    var last = localStorage.getItem(VERSION_KEY);

    if (last === null) {
      localStorage.setItem(VERSION_KEY, APP_VERSION);
      return;
    }
    if (last === APP_VERSION) return;

    localStorage.setItem(VERSION_KEY, APP_VERSION);

    var t = document.createElement("div");
    t.id = "version-toast";
    t.setAttribute("role", "status");
    t.innerHTML =
      "<span>" + window.t("update.done") + "</span>" +
      "<strong>v" + APP_VERSION + "</strong>";
    document.body.appendChild(t);

    requestAnimationFrame(function () { t.classList.add("show"); });

    var gone = false;
    function dismiss() {
      if (gone) return;
      gone = true;
      t.classList.remove("show");
      setTimeout(function () { t.remove(); }, 450);
    }
    t.addEventListener("click", dismiss);
    setTimeout(dismiss, 4000);
  }

  function renderInstallRow(host) {
    // Update takes priority over install: when a new version waits,
    // this becomes the most important button in the menu.
    if (state.swUpdateReady) {
      var usection = document.createElement("div");
      usection.className = "install-section";

      var ubtn = document.createElement("button");
      ubtn.className = "menu-item install-row update";
      ubtn.innerHTML = DOWNLOAD_ICON_SVG + "<span>" + window.t("update.action") + "</span>";
      ubtn.addEventListener("click", function () {
        if (window.orosActivateUpdate) {
          window.orosActivateUpdate();   // inline broker (index.html)
        } else if (swReg && swReg.waiting) {
          swReg.waiting.postMessage("SKIP_WAITING");
        }
      });
      usection.appendChild(ubtn);
      host.appendChild(usection);
      return;
    }

    if (!state.deferredPrompt) return;

    var section = document.createElement("div");
    section.className = "install-section";

    var row = document.createElement("button");
    row.className = "menu-item install-row";
    row.innerHTML = DOWNLOAD_ICON_SVG + "<span>" + window.t("install.trigger") + "</span>";
    row.addEventListener("click", function () {
      if (!state.deferredPrompt) return;
      state.deferredPrompt.prompt();
      state.deferredPrompt.userChoice.then(function (choice) {
        if (choice.outcome === "accepted") {
          state.deferredPrompt = null;
          renderMenu();
        }
      });
    });
    section.appendChild(row);
    host.appendChild(section);
  }

  // ---------- 8. Apps loading & menu ----------
  function loadApps() {
    fetch("apps.json")
      .then(function (r) { return r.json(); })
      .then(function (data) {
        state.apps = (data && Array.isArray(data.apps)) ? data.apps : [];
        renderMenu();
      })
      .catch(function () {
        state.apps = [];
        renderMenu();
      });
  }

  function renderMenu() {
    var menu = document.getElementById("app-menu");
    menu.innerHTML = "";

    var heading = document.createElement("div");
    heading.className = "menu-heading";
    heading.textContent = window.t("menu.title");
    menu.appendChild(heading);

    if (state.apps.length === 0) {
      var empty = document.createElement("div");
      empty.className = "menu-empty";
      empty.innerHTML =
        '<span class="glyph">' + GRID_SVG + '</span>' +
        '<span>' + window.t("menu.empty") + '</span>' +
        '<div class="hint">' + window.t("menu.empty.hint") + '</div>';
      menu.appendChild(empty);
    } else {
      var cats = {};
      state.apps.forEach(function (app) {
        var c = app.category || "other";
        (cats[c] = cats[c] || []).push(app);
      });

      Object.keys(cats).sort().forEach(function (cat) {
        var wrap = document.createElement("div");
        wrap.className = "menu-category";

        var h = document.createElement("h4");
        var label = window.t("category." + cat.toLowerCase());
        // Unknown category → t() returns the key itself → fall back
        // to the prettified raw name (future-proof for new apps).
        h.textContent = (label === "category." + cat.toLowerCase())
          ? cat.charAt(0).toUpperCase() + cat.slice(1)
          : label;
        wrap.appendChild(h);

        cats[cat].forEach(function (app) {
          var btn = document.createElement("button");
          btn.className = "menu-item";
          if (ICONS[app.icon]) {
            btn.innerHTML =
              '<span class="app-ico">' + ICONS[app.icon] + '</span>' +
              '<span>' + escapeHtml(app.name) + '</span>';
          } else {
            btn.textContent = app.name;
          }
          btn.addEventListener("click", function () { openApp(app); });
          wrap.appendChild(btn);
        });
        menu.appendChild(wrap);
      });
    }

    renderSkinSwatches(menu);
    renderWallpaperSection(menu);
    renderInstallRow(menu);
    renderSyncSection(menu);
  }

  function renderSkinSwatches(host) {
    var section = document.createElement("div");
    section.className = "skin-section";

    var heading = document.createElement("div");
    heading.className = "menu-heading";
    heading.textContent = window.t("skin.title");
    section.appendChild(heading);

    var controls = document.createElement("div");
    controls.className = "skin-controls";

    var swatches = document.createElement("div");
    swatches.className = "skin-swatches";

    SKINS.forEach(function (s) {
      var sw = document.createElement("button");
      sw.className = "skin-swatch" + (state.skin === s.id ? " active" : "");
      sw.style.background = s.color;
      sw.setAttribute("title", skinTitle(s.id));
      sw.setAttribute("aria-label", skinTitle(s.id));
      sw.addEventListener("click", function () {
        if (state.skin === s.id) return;
        state.skin = s.id;
        localStorage.setItem("oros-skin", state.skin);
        applySkin();
        maybeFollowSkin(s.id);     // suggests paired wallpaper (from default only)
        noteLocalChange();          // user action → sync engine
        renderMenu();
      });
      swatches.appendChild(sw);
    });

    controls.appendChild(swatches);

    var divider = document.createElement("div");
    divider.className = "skin-divider";
    controls.appendChild(divider);

    var themeBtn = document.createElement("button");
    themeBtn.className = "theme-toggle";
    themeBtn.innerHTML = state.theme === "dark" ? MOON_SVG : SUN_SVG;
    themeBtn.setAttribute("title",
      window.t(state.theme === "dark" ? "theme.toLight" : "theme.toDark"));
    themeBtn.setAttribute("aria-label", themeBtn.getAttribute("title"));
    themeBtn.addEventListener("click", function () {
      state.theme = state.theme === "dark" ? "light" : "dark";
      localStorage.setItem("oros-theme", state.theme);
      applyTheme();
      noteLocalChange();            // user action → sync engine
      renderMenu();
    });
    controls.appendChild(themeBtn);

    section.appendChild(controls);
    host.appendChild(section);
  }

  // Wallpaper picker: grid of gradient thumbnails. Each thumb carries
  // its actual CSS class, so what you see is literally what you get.
  function renderWallpaperSection(host) {
    var section = document.createElement("div");
    section.className = "wallpaper-section";

    var heading = document.createElement("div");
    heading.className = "menu-heading";
    heading.textContent = window.t("wallpaper.title");
    section.appendChild(heading);

    var grid = document.createElement("div");
    grid.className = "wallpaper-grid";

    WALLPAPERS.forEach(function (w) {
      var thumb = document.createElement("button");
      thumb.className = "wp-thumb wp-" + w.id +
                        (state.wallpaper === w.id ? " active" : "");
      thumb.setAttribute("title", wallpaperTitle(w.id));
      thumb.setAttribute("aria-label", wallpaperTitle(w.id));
	  thumb.style.background = w.css;   // WYSIWYG — same source as desktop
      thumb.addEventListener("click", function () {
        if (state.wallpaper === w.id) return;
        state.wallpaper = w.id;
        localStorage.setItem("oros-wallpaper", state.wallpaper);
        applyWallpaper();
        noteLocalChange();          // user action → sync engine
        renderMenu();
      });
      grid.appendChild(thumb);
    });

    section.appendChild(grid);
    host.appendChild(section);
  }

  function skinTitle(id) {
    return id.charAt(0).toUpperCase() + id.slice(1);
  }

  function wallpaperTitle(id) {
    var names = {
      dusk:     { en: "Adwaita Dusk",  el: "Λυκόφως Adwaita" },
      midnight: { en: "Midnight",      el: "Μεσάνυχτα" },
      plum:     { en: "Aubergine",     el: "Μελανότσιρο" },
      forest:   { en: "Forest Night",  el: "Νύχτα Δάσους" },
      ember:    { en: "Ember",         el: "Στάχτη" },
      nordic:   { en: "Nordic Frost",  el: "Σκανδιναβικός Πάγος" },
      aurora:   { en: "Aurora",        el: "Αυγόρα" },
      sand:     { en: "Desert Sand",   el: "Άμμος Ερήμου" },
      mono:     { en: "Monochrome",    el: "Μονόχρωμο" },
      clear:    { en: "None",          el: "Καμία" }
    };
    var n = names[id];
    if (!n) return id;
    return state.lang === "el" ? n.el : n.en;
  }

    // ---------- 9. Sync UI & shell slice ----------

  // The shell's own syncable data — theme/language/skin/wallpaper
  // and the auto-sync interval all travel to the cloud.
  // Getter reads CURRENT state; setter is fed by pulls (no markDirty
  // inside user-settable paths!).
  function shellSliceGet() {
    var syncInterval = 3;
    if (window.orosSync && typeof window.orosSync.getIntervalMinutes === "function") {
      syncInterval = window.orosSync.getIntervalMinutes();
    }
    return {
      lang:         state.lang,
      theme:        state.theme,
      skin:         state.skin,
      wallpaper:    state.wallpaper,
      syncInterval: syncInterval
    };
  }

  function shellSliceSet(data) {
    if (!data) return;
    if (data.lang  === "en" || data.lang  === "el") state.lang  = data.lang;
    if (data.theme === "dark" || data.theme === "light") state.theme = data.theme;
    if (isValidSkin(data.skin)) state.skin = data.skin;
    if (findWallpaper(data.wallpaper)) {
      state.wallpaper = data.wallpaper;
      localStorage.setItem("oros-wallpaper", state.wallpaper);
    }
    if (typeof data.syncInterval === "number" &&
        data.syncInterval >= 0 && data.syncInterval <= 60 &&
        window.orosSync && typeof window.orosSync.setIntervalMinutes === "function") {
      // Pull-fed value: applies + reschedules only. setIntervalMinutes
      // never marks dirty → no sync loop possible.
      window.orosSync.setIntervalMinutes(data.syncInterval);
    }

    localStorage.setItem("oros-lang",  state.lang);
    localStorage.setItem("oros-theme", state.theme);
    localStorage.setItem("oros-skin",  state.skin);

    applySkin();
    applyWallpaper();
    applyTheme();
    applyLang();     // re-renders menu too
    // Deliberately NO noteLocalChange() here — pulled data must not
    // re-mark dirty, or pull → set → push → pull → … infinite loop.
  }

  function registerShellSlice() {
    if (window.orosSync) {
      window.orosSync.registerSlice("shell", shellSliceGet, shellSliceSet);
    }
  }

  function setSyncMsg(kind, textKey) {
    state.syncMsg = { kind: kind, text: window.t(textKey) };
    renderMenu();
  }
  function setSyncMsgRaw(kind, raw) {
    state.syncMsg = { kind: kind, text: raw };
    renderMenu();
  }

  function renderSyncSection(host) {
    var section = document.createElement("div");
    section.className = "sync-section";

    var heading = document.createElement("div");
    heading.className = "menu-heading";
    heading.textContent = window.t("sync.title");
    section.appendChild(heading);

    var connected = window.orosSync && window.orosSync.isConnected();
    var status = document.createElement("div");
    status.className = "sync-status";
    status.innerHTML =
      '<span class="sync-status-dot' + (connected ? " on" : "") + '"></span>' +
      '<span>' +
      (connected
        ? window.t("sync.connected") +
          (state.syncUserEmail ? ' · <span class="email">' + escapeHtml(state.syncUserEmail) + '</span>' : "")
        : window.t("sync.disconnected")) +
      '</span>';
    section.appendChild(status);

    if (!connected) {
      var connectRow = document.createElement("div");
      connectRow.className = "sync-actions";
      var connectBtn = document.createElement("button");
      connectBtn.className = "menu-item";
      connectBtn.innerHTML = CLOUD_ICON_SVG + "<span>" + window.t("sync.connect") + "</span>";
      connectBtn.addEventListener("click", function () {
        window.orosSync.connect();
      });
      connectRow.appendChild(connectBtn);
      section.appendChild(connectRow);
    } else if (!window.orosSync.hasPassphrase()) {
      // --- Connected, locked: passphrase input + eye + remember checkbox ---
      var passWrap = document.createElement("div");
      passWrap.className = "sync-pass";

      var label = document.createElement("label");
      label.textContent = window.t("sync.pass.label");
      passWrap.appendChild(label);

      var inputRow = document.createElement("div");
      inputRow.className = "input-row";

      var input = document.createElement("input");
      input.type = "password";
      input.setAttribute("placeholder", window.t("sync.pass.placeholder"));
      input.autocomplete = "off";
      inputRow.appendChild(input);

      var eyeBtn = document.createElement("button");
      eyeBtn.type = "button";
      eyeBtn.className = "pass-eye";
      eyeBtn.innerHTML = EYE_SVG;
      eyeBtn.setAttribute("title", window.t("sync.pass.show"));
      eyeBtn.setAttribute("aria-label", window.t("sync.pass.show"));
      eyeBtn.addEventListener("click", function () {
        var show = input.type === "password";
        input.type = show ? "text" : "password";
        eyeBtn.innerHTML = show ? EYE_OFF_SVG : EYE_SVG;
        input.focus();
      });
      inputRow.appendChild(eyeBtn);

      passWrap.appendChild(inputRow);

      var hint = document.createElement("div");
      hint.className = "hint";
      hint.textContent = window.t("sync.pass.first.hint");
      passWrap.appendChild(hint);

      var rememberRow = document.createElement("label");
      rememberRow.className = "remember-row";
      var rememberCb = document.createElement("input");
      rememberCb.type = "checkbox";
      rememberCb.id = "sync-remember";
      // Pre-check if this device already trusts the vault (re-unlock case)
      rememberCb.checked = window.orosSync.hasDeviceVault();
      rememberRow.appendChild(rememberCb);
      var rememberTxt = document.createElement("span");
      rememberTxt.textContent = window.t("sync.pass.remember");
      rememberRow.appendChild(rememberTxt);
      passWrap.appendChild(rememberRow);

      var row = document.createElement("div");
      row.className = "row";
      var unlockBtn = document.createElement("button");
      unlockBtn.className = "menu-item";
      unlockBtn.textContent = window.t("sync.pass.apply");
      unlockBtn.addEventListener("click", function () {
        var pw = input.value;
        if (!pw) { setSyncMsg("err", "sync.err.nopass"); return; }
        window.orosSync.setPassphrase(pw, rememberCb.checked);
        setSyncMsgRaw("dim", window.t("sync.working"));
        // Visible auto-pull on unlock: apply cloud state immediately,
        // then push if this device had unsynced changes.
        window.orosSync.pull()
          .then(function (result) {
            if (result.empty) {
              setSyncMsg("ok", "sync.ok.empty");
            } else {
              setSyncMsgRaw("ok", window.t("sync.ok.pull") + " — " +
                result.applied + " " + window.t("sync.slices.applied"));
            }
            if (window.orosSync.isDirty()) {
              return window.orosSync.push()
                .then(function () { setSyncMsg("ok", "sync.ok.push"); });
            }
          })
          .catch(handleSyncError);
      });
      row.appendChild(unlockBtn);
      passWrap.appendChild(row);
      section.appendChild(passWrap);
    } else {
      // --- Connected + unlocked: actions ---
      var actions = document.createElement("div");
      actions.className = "sync-actions";

      var pullBtn = document.createElement("button");
      pullBtn.className = "menu-item";
      pullBtn.innerHTML = DOWNLOAD_ICON_SVG + "<span>" + window.t("sync.pull") + "</span>";
      pullBtn.addEventListener("click", function () {
        window.orosSync.pull()
          .then(function (result) {
            if (result.empty) setSyncMsg("ok", "sync.ok.empty");
            else setSyncMsgRaw("ok",
              window.t("sync.ok.pull") + " — " + result.applied + " " + window.t("sync.slices.applied"));
          })
          .catch(handleSyncError);
      });
      actions.appendChild(pullBtn);

      var pushBtn = document.createElement("button");
      pushBtn.className = "menu-item";
      pushBtn.innerHTML = UPLOAD_ICON_SVG + "<span>" + window.t("sync.push") + "</span>";
      pushBtn.addEventListener("click", function () {
        setSyncMsgRaw("dim", window.t("sync.working"));
        window.orosSync.push()
          .then(function () { setSyncMsg("ok", "sync.ok.push"); })
          .catch(handleSyncError);
      });
      actions.appendChild(pushBtn);

      section.appendChild(actions);

      // Auto-sync interval selector (device-local setting, but the
      // chosen value is carried in the shell slice)
      var intervalRow = document.createElement("div");
      intervalRow.className = "sync-interval";
      var iLabel = document.createElement("label");
      iLabel.textContent = window.t("sync.interval.label");
      intervalRow.appendChild(iLabel);
      var sel = document.createElement("select");
      [0, 1, 3, 5, 15].forEach(function (m) {
        var opt = document.createElement("option");
        opt.value = String(m);
        opt.textContent = m === 0
          ? window.t("sync.interval.off")
          : m + " " + window.t("sync.interval.minutes");
        if (m === getSafeInterval()) opt.selected = true;
        sel.appendChild(opt);
      });
      sel.addEventListener("change", function () {
        window.orosSync.setIntervalMinutes(parseInt(sel.value, 10));
        noteLocalChange();   // interval is part of the shell slice now
      });
      intervalRow.appendChild(sel);
      section.appendChild(intervalRow);

      // Utilities row: forget (device-aware) + disconnect
      var utils = document.createElement("div");
      utils.className = "sync-actions";

      var hasVault = window.orosSync.hasDeviceVault();
      var forgetBtn = document.createElement("button");
      forgetBtn.className = "menu-item";
      forgetBtn.textContent = hasVault
        ? window.t("sync.pass.device")
        : window.t("sync.pass.forget");
      forgetBtn.addEventListener("click", function () {
        if (hasVault) {
          window.orosSync.clearDevice().then(function () {
            renderMenu();
          });
        } else {
          window.orosSync.forgetPassphrase();
          renderMenu();
        }
      });
      utils.appendChild(forgetBtn);

      var discBtn = document.createElement("button");
      discBtn.className = "menu-item";
      discBtn.textContent = window.t("sync.disconnect");
      discBtn.addEventListener("click", function () {
        window.orosSync.disconnect();
        state.syncUserEmail = null;
        renderMenu();
      });
      utils.appendChild(discBtn);

      section.appendChild(utils);
    }

    // Local backup: unencrypted export/import — works offline,
    // independent of the Dropbox connection state
    var backupRow = document.createElement("div");
    backupRow.className = "sync-actions";

    var exportBtn = document.createElement("button");
    exportBtn.className = "menu-item";
    exportBtn.innerHTML = DOWNLOAD_ICON_SVG + "<span>" + window.t("sync.export") + "</span>";
    exportBtn.addEventListener("click", function () {
      try {
        var json = window.orosSync.exportData();
        var blob = new Blob([json], { type: "application/json" });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = "orOS-backup-" + new Date().toISOString().slice(0, 10) + ".json";
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
        setSyncMsg("ok", "sync.ok.export");
      } catch (e) {
        handleSyncError(e);
      }
    });
    backupRow.appendChild(exportBtn);

    var importBtn = document.createElement("button");
    importBtn.className = "menu-item";
    importBtn.innerHTML = UPLOAD_ICON_SVG + "<span>" + window.t("sync.import") + "</span>";

    var fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "application/json,.json";
    fileInput.style.display = "none";
    fileInput.addEventListener("change", function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var n = window.orosSync.importData(String(reader.result));
          setSyncMsgRaw("ok", window.t("sync.ok.import") + " — " +
            n + " " + window.t("sync.slices.applied"));
        } catch (e) {
          handleSyncError(e);
        }
        fileInput.value = "";
      };
      reader.readAsText(file);
    });
    section.appendChild(fileInput);

    importBtn.addEventListener("click", function () { fileInput.click(); });
    backupRow.appendChild(importBtn);
    section.appendChild(backupRow);

    var backupHint = document.createElement("div");
    backupHint.className = "sync-hint";
    backupHint.textContent = window.t("sync.backup.hint");
    section.appendChild(backupHint);

    if (state.syncMsg) {
      var msg = document.createElement("div");
      msg.className = "sync-msg " + state.syncMsg.kind;
      msg.textContent = state.syncMsg.text;
      section.appendChild(msg);
    }

    host.appendChild(section);
  }

  function handleSyncError(err) {
    var key = window.orosSync.errorKey(err);
    setSyncMsg("err", key);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function getSafeInterval() {
    if (window.orosSync && typeof window.orosSync.getIntervalMinutes === "function") {
      return window.orosSync.getIntervalMinutes();
    }
    return 3;
  }

  function initSyncIntegration() {
    registerShellSlice();

    // OAuth return → flip the menu to connected state once tokens land
    if (window.orosSync && window.orosSync.redirectHandled) {
      window.orosSync.redirectHandled.then(function (handled) {
        if (handled) renderMenu();
      });
    }

    // Vault auto-unlock settled → re-render (dot turns "on" without user
    // ever typing the passphrase; silent pull already handled by engine)
    if (window.orosSync && window.orosSync.vaultUnlocked) {
      window.orosSync.vaultUnlocked.then(function () {
        renderMenu();
      });
    }

    // Subtle auto-sync feedback: the status dot pulses while the engine
    // pushes in the background. No messages, no interruptions.
    if (window.orosSync && typeof window.orosSync.onAutoSync === "function") {
      window.orosSync.onAutoSync(function (kind) {
        var dot = document.querySelector(".sync-status-dot");
        if (!dot) return;
        if (kind === "start") {
          dot.classList.add("pulse");
        } else {
          setTimeout(function () { dot.classList.remove("pulse"); }, 600);
        }
      });
    }

    // Account email for the status row (async, cached by sync.js)
    if (window.orosSync && window.orosSync.isConnected()) {
      window.orosSync.getUserInfo()
        .then(function (acc) {
          if (acc && acc.email) {
            state.syncUserEmail = acc.email;
            renderMenu();
          }
        })
        .catch(function () { /* offline on boot — status stays generic */ });
    }
  }

  // ---------- 10. App opening (fullscreen takeover) ----------
  function openApp(app) {
    closeMenu();
    if (app.type === "external") {
      window.open(app.url, "_blank", "noopener");
      return;
    }
    state.running = app;
    document.getElementById("app-frame").src = app.url;
    document.getElementById("oros-running").classList.add("active");
    document.getElementById("oros-desktop").style.display = "none";
    var mb = document.getElementById("btn-menu");
    mb.classList.add("running");
    document.getElementById("btn-menu-label").textContent = window.t("running.back");
    mb.setAttribute("data-i18n-title", "running.home");
  }

  function returnToDesktop() {
    state.running = null;
    document.getElementById("app-frame").src = "about:blank";
    document.getElementById("oros-running").classList.remove("active");
    document.getElementById("oros-desktop").style.display = "";
    var mb = document.getElementById("btn-menu");
    mb.classList.remove("running");
    document.getElementById("btn-menu-label").textContent = window.t("bar.menu");
    mb.setAttribute("data-i18n-title", "bar.menu");
  }

  // ---------- 11. Menu open/close ----------
  function toggleMenu() {
    if (state.running) { returnToDesktop(); return; }
    document.getElementById("app-menu").classList.toggle("open");
  }
  function closeMenu() {
    document.getElementById("app-menu").classList.remove("open");
  }

  // ---------- 12. Wiring & boot ----------
  document.getElementById("btn-menu").addEventListener("click", function (e) {
    e.stopPropagation();
    toggleMenu();
  });

  // Clicks inside the menu never reach the outside-close handler.
  // (Re-renders detach the clicked node mid-event, which made
  // menu.contains(target) false — the "clicked outside" bug.)
  document.getElementById("app-menu").addEventListener("click", function (e) {
    e.stopPropagation();
  });

  document.addEventListener("click", function (e) {
    var menu = document.getElementById("app-menu");
    if (menu.classList.contains("open") && !menu.contains(e.target)) closeMenu();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      if (document.getElementById("app-menu").classList.contains("open")) closeMenu();
      else if (state.running) returnToDesktop();
    }
  });

  document.getElementById("btn-lang").addEventListener("click", function () {
    state.lang = state.lang === "en" ? "el" : "en";
    localStorage.setItem("oros-lang", state.lang);
    noteLocalChange();            // user action → sync engine
    applyLang();
  });

  // Boot
  initPrefs();
  applySkin();
  applyWallpaper();
  applyTheme();
  applyLang();
  loadApps();
  registerServiceWorker();
  setupInstallFlow();
  initSyncIntegration();
  setInterval(renderClock, 1000);
  renderClock();
  checkVersionToast();
})();