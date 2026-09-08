// ============================================================
// orOS Core v0 — Shell logic (final, PWA edition)
// Sections:
//   1. State, skin registry, icon constants
//   2. Preferences (skin, language, theme)
//   3. Language apply
//   4. Theme apply
//   5. Skin apply
//   6. Clock (24h)
//   7. PWA: service worker registration + install flow
//   8. Apps loading & menu rendering (+ appearance + install button)
//   9. App opening / return (fullscreen takeover)
//   10. Menu open/close
//   11. Wiring & boot
// ============================================================
(function () {
  "use strict";

  // ---------- 1. State & registries ----------
  var state = {
    lang:            null,   // "en" | "el"
    theme:           null,   // "dark" | "light"
    skin:            null,   // "adwaita" | "lumo" | "oros"
    apps:            [],
    running:         null,
    deferredPrompt:  null    // PWA install event (null = not available yet)
  };

  // Skin registry — adding a new skin = one entry here + one palette in style.css.
  var SKINS = [
    { id: "adwaita", color: "#3584e4" },
    { id: "lumo",    color: "#6d4aff" },
    { id: "oros",    color: "#d4af37" }
  ];

  // Theme toggle icons — inline SVG (Unicode ☾/☀ render as tofu on some platforms)
  var MOON_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  var SUN_SVG  = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="M4.93 4.93l1.41 1.41"/><path d="M17.66 17.66l1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="M4.93 19.07l1.41-1.41"/><path d="M17.66 6.34l1.41-1.41"/></svg>';

  // Empty-state glyph — inline SVG app grid
  var GRID_SVG = '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>';

  function isValidSkin(id) {
    for (var i = 0; i < SKINS.length; i++) {
      if (SKINS[i].id === id) return true;
    }
    return false;
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
                   : "adwaita";
    localStorage.setItem("oros-skin", state.skin);

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
    // Theme button lives in the app menu (Appearance section),
    // re-created on each renderMenu() — nothing to update here.
  }

  // ---------- 5. Skin ----------
  function applySkin() {
    if (!isValidSkin(state.skin)) state.skin = "adwaita";
    document.documentElement.setAttribute("data-skin", state.skin);
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

  // ---------- 7. PWA: service worker + install flow ----------
  function registerServiceWorker() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(function (err) {
        console.warn("orOS: SW registration failed:", err);
        // Non-fatal: shell still works online, just without offline coverage.
      });
    }
  }

  function setupInstallFlow() {
    // Chrome/Edge/Android fire this when the app is installable.
    // We prevent the automatic mini-infobar and show OUR OWN install
    // button in the menu instead — with an explicit prompt() call.
    window.addEventListener("beforeinstallprompt", function (e) {
      e.preventDefault();                    // no silent default banner
      state.deferredPrompt = e;              // keep the event for later
      renderMenu();                          // menu now shows the Install button
    });

    window.addEventListener("appinstalled", function () {
      state.deferredPrompt = null;            // already installed — hide button
      renderMenu();
    });
  }

  function renderInstallRow(host) {
    // Only rendered when an install prompt is actually available
    // (Chrome/Edge/Android; iOS has no API — user adds via Share menu manually)
    if (!state.deferredPrompt) return;

    var row = document.createElement("button");
    row.className = "menu-item install-row";
    row.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>' +
                   "<span>" + window.t("install.trigger") + "</span>";
    row.addEventListener("click", function () {
      if (!state.deferredPrompt) return;
      state.deferredPrompt.prompt();         // EXPLICIT prompt() — never silent
      state.deferredPrompt.userChoice.then(function (choice) {
        if (choice.outcome === "accepted") {
          state.deferredPrompt = null;
          renderMenu();
        }
        // "dismissed" — keep the button for another day
      });
    });
    host.appendChild(row);
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
        state.apps = [];   // graceful: show empty state, never crash
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
      // Group by category (Linux-style)
      var cats = {};
      state.apps.forEach(function (app) {
        var c = app.category || "other";
        (cats[c] = cats[c] || []).push(app);
      });

      Object.keys(cats).sort().forEach(function (cat) {
        var wrap = document.createElement("div");
        wrap.className = "menu-category";

        var h = document.createElement("h4");
        h.textContent = cat.charAt(0).toUpperCase() + cat.slice(1);
        wrap.appendChild(h);

        cats[cat].forEach(function (app) {
          var btn = document.createElement("button");
          btn.className = "menu-item";
          btn.textContent = app.name;
          btn.addEventListener("click", function () { openApp(app); });
          wrap.appendChild(btn);
        });
        menu.appendChild(wrap);
      });
    }

    renderSkinSwatches(menu);   // Appearance section: skins + theme toggle
    renderInstallRow(menu);     // Install button (only if installable)
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
        renderMenu(); // re-render to move the active ring
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
      renderMenu(); // refresh moon/sun icon + tooltip
    });
    controls.appendChild(themeBtn);

    section.appendChild(controls);
    host.appendChild(section);
  }

  function skinTitle(id) {
    return id.charAt(0).toUpperCase() + id.slice(1);
  }

  // ---------- 9. App opening (fullscreen takeover) ----------
  function openApp(app) {
    closeMenu();
    if (app.type === "external") {
      window.open(app.url, "_blank", "noopener");  // externals open in new tab
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

  // ---------- 10. Menu open/close ----------
  function toggleMenu() {
    if (state.running) { returnToDesktop(); return; }
    document.getElementById("app-menu").classList.toggle("open");
  }
  function closeMenu() {
    document.getElementById("app-menu").classList.remove("open");
  }

  // ---------- 11. Wiring & boot ----------
  document.getElementById("btn-menu").addEventListener("click", function (e) {
    e.stopPropagation();
    toggleMenu();
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
    applyLang();
  });

  // Boot
  initPrefs();
  applySkin();
  applyTheme();
  applyLang();
  loadApps();
  registerServiceWorker();
  setupInstallFlow();
  setInterval(renderClock, 1000);
  renderClock();
})();