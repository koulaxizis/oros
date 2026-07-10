(function() {
  document.addEventListener('DOMContentLoaded', function() {
    var headerEl = document.getElementById('oros-header');
    if (!headerEl) return;

    var version = (window.OROS_CONFIG && window.OROS_CONFIG.version) || '0.6.2';
    var channel = (window.OROS_CONFIG && window.OROS_CONFIG.channel) || 'beta';

    headerEl.innerHTML =
      '<header class="header">' +
        '<div class="header-content">' +
          '<div class="header-left">' +
            '<a href="index.html" class="logo-link">' +
              '<img src="favicon.svg" alt="orOS" class="logo-icon" />' +
              '<span class="logo-text">orOS</span>' +
            '</a>' +
            '<span class="version-badge">' + version + '</span>' +
            (channel === 'beta' ? '<span class="channel-badge beta">BETA</span>' : '') +
			(channel === 'stable' ? '<span class="channel-badge beta">STABLE</span>' : '') +
          '</div>' +
          '<div class="header-right">' +
            '<select id="language-select" class="lang-select" aria-label="Language"></select>' +
            '<button id="btn-zen" class="header-btn" data-i18n-aria="aria_zen" aria-label="Zen Mode" title="Zen Mode (F9)"><i class="fa fa-eye-slash"></i></button>' +
            '<button id="btn-settings" class="header-btn" data-i18n-aria="aria_settings" aria-label="Settings" title="Settings"><i class="fa fa-cog"></i></button>' +
            '<button id="theme-toggle" class="header-btn" data-i18n-aria="aria_theme_toggle" aria-label="Toggle theme" title="Toggle theme"><i class="fa fa-sun-o"></i></button>' +
          '</div>' +
        '</div>' +
      '</header>';
  });
})();