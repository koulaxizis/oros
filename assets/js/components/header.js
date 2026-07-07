// ============================================
// orOS — Global Header Component
// Logo | Version | Language | Zen | Settings | Theme
// Used on ALL pages (index + editor)
// ============================================

(function() {
  var mount = document.getElementById('oros-header');
  if (!mount) return;

  var isBeta = window.location.hostname.indexOf('koulaxizis.github.io') !== -1 &&
               window.location.pathname.indexOf('oros-beta') !== -1;

  var logoHref = './index.html';

  mount.innerHTML =
    '<header class="header">' +
      '<div class="header-content">' +
        '<a href="' + logoHref + '" class="logo">' +
          '<img src="favicon.svg" alt="" class="logo-icon" width="24" height="24">' +
          '<span class="logo-text"><b>or</b><i>OS</i></span>' +
          '<span class="version-badge">' + (isBeta ? 'v0.5-BETA' : 'v0.5') + '</span>' +
        '</a>' +
        '<div class="header-controls">' +
          '<select id="language-select" class="lang-select" data-i18n-aria="aria_language" aria-label="Language"></select>' +
          '<button id="btn-zen" class="btn-control btn-icon" data-i18n-aria="aria_zen" data-i18n-tooltip="tooltip_zen" aria-label="Zen Mode" title="Zen Mode (F9)">🧘</button>' +
          '<button id="btn-settings" class="btn-control btn-icon" data-i18n-aria="aria_settings" data-i18n-tooltip="tooltip_settings" aria-label="Settings" title="Settings">⚙️</button>' +
          '<button id="theme-toggle" class="btn-control btn-icon" data-i18n-aria="aria_theme_toggle" aria-label="Toggle theme"></button>' +
        '</div>' +
      '</div>' +
    '</header>';

  // Apply saved theme immediately to <html> (main.js handles full system after DOMContentLoaded)
  var savedTheme = localStorage.getItem('oros-theme');
  if (savedTheme) {
    document.documentElement.setAttribute('data-theme', savedTheme);
  } else {
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  }
})();