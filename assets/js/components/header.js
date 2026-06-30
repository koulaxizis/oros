// ============================================
// orOS — Global Header Component
// Logo | Version | Language | Zen | Settings | Theme
// ============================================

(function() {
  var mount = document.getElementById('oros-header');
  if (!mount) return;

  mount.innerHTML =
    '<header class="header">' +
      '<div class="header-content">' +
        '<a href="./index.html" class="logo">' +
          '<img src="favicon.svg" alt="" class="logo-icon" width="24" height="24">' +
          '<span class="logo-text"><b>or</b><i>OS</i></span>' +
          '<span class="version-badge">v0.1</span>' +
        '</a>' +
        '<div class="header-controls">' +
          '<select id="language-select" class="lang-select" aria-label="Language"></select>' +
          '<button id="btn-zen" class="btn-control btn-icon" aria-label="Zen Mode" title="Zen Mode (F9)">🧘</button>' +
          '<button id="btn-settings" class="btn-control btn-icon" aria-label="Settings" title="Settings">⚙️</button>' +
          '<button id="theme-toggle" class="btn-control btn-icon" aria-label="Toggle theme"></button>' +
        '</div>' +
      '</div>' +
    '</header>';
})();