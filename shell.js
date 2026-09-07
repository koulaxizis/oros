// ============================================================
// orOS Core v0 — Shell logic (final)
// Sections:
//   1. State & skin registry
//   2. Preferences (skin, language, theme)
//   3. Language apply
//   4. Theme apply
//   5. Skin apply
//   6. Clock (24h)
//   7. Apps loading & menu rendering (+ skin picker)
//   8. App opening / return (fullscreen takeover)
//   9. Menu open/close
//   10. Wiring & boot
// ============================================================
(function () {
  "use strict";

  // ---------- 1. State & skin registry ----------
  var state = {
    lang:    null,   // "en" | "el"
    theme:   null,   // "dark" | "light"
    skin:    null,   // "adwaita" | "lumo" | "oros"
    apps:    [],
    running: null
  };

  // Skin registry — adding a new skin = one entry here + one palette in style.css.
  var SKINS = [
    { id: "adwaita", color: "#3584e4" },
    { id: "lumo",    color: "#6d4aff" },
    { id: "oros",    color: "#d4af37" }
  ];

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
    document.getElementById("btn-lang").textContent = window.t("lang.switch");
    renderClock();
    renderMenu();
  }

  // ---------- 4. Theme ----------
  function applyTheme() {
    document.documentElement.setAttribute("data-theme", state.theme);
    var btn = document.getElementById("btn-theme");
    var key = state.theme === "dark" ? "theme.toLight" : "theme.toDark";
    btn.setAttribute("title", window.t(key));
    btn.setAttribute("data-i18n-title", key);
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
    document.getElementById("bar-clock").textContent =
      hh + ":" + mm + "  ·  " +
      now.toLocaleDateString(state.lang === "el" ? "el-GR" : "en-GB",
                             { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
  }

  // ---------- 7. Apps loading & menu ----------
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
        '<span class="glyph">□</span>' +
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

    // Skin picker always at the bottom of the menu
    renderSkinSwatches(menu);
  }

  function renderSkinSwatches(host) {
    var section = document.createElement("div");
    section.className = "skin-section";

    var heading = document.createElement("div");
    heading.className = "menu-heading";
    heading.textContent = window.t("skin.title");
    section.appendChild(heading);

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

    section.appendChild(swatches);
    host.appendChild(section);
  }

  function skinTitle(id) {
    return id.charAt(0).toUpperCase() + id.slice(1);
  }

  // ---------- 8. App opening (fullscreen takeover) ----------
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

  // ---------- 9. Menu open/close ----------
  function toggleMenu() {
    if (state.running) { returnToDesktop(); return; }
    document.getElementById("app-menu").classList.toggle("open");
  }
  function closeMenu() {
    document.getElementById("app-menu").classList.remove("open");
  }

  // ---------- 10. Wiring & boot ----------
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

  document.getElementById("btn-theme").addEventListener("click", function () {
    state.theme = state.theme === "dark" ? "light" : "dark";
    localStorage.setItem("oros-theme", state.theme);
    applyTheme();
  });

  // Boot
  initPrefs();
  applySkin();
  applyTheme();
  applyLang();
  loadApps();
  setInterval(renderClock, 1000);
  renderClock();
})();