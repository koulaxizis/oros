(function() {
  var headerEl = document.getElementById('oros-header');
  if (!headerEl) return;

  var version = (window.OROS_CONFIG && window.OROS_CONFIG.version) || '0.8';
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
          (channel === 'stable' ? '<span class="channel-badge stable">STABLE</span>' : '') +
        '</div>' +
        '<div class="header-right">' +
          '<select id="language-select" class="lang-select" aria-label="Language"></select>' +
          '<button id="btn-quick-sync" class="header-btn" aria-label="Quick Sync" title="Quick Sync" style="display:none;"><i class="fa fa-cloud-upload"></i></button>' +
          '<button id="btn-zen" class="header-btn" data-i18n-aria="aria_zen" aria-label="Zen Mode" title="Zen Mode (F9)"><i class="fa fa-eye-slash"></i></button>' +
          '<button id="theme-toggle" class="header-btn" data-i18n-aria="aria_theme" aria-label="Toggle Theme" title="Toggle Theme"><i class="fa fa-sun-o"></i></button>' +
          '<button id="btn-settings" class="header-btn" data-i18n-aria="aria_settings" aria-label="Settings" title="Settings"><i class="fa fa-cog"></i></button>' +
          '<button id="btn-help" class="header-btn" data-i18n-aria="aria_help" aria-label="Help" title="Help"><i class="fa fa-question-circle"></i></button>' +
        '</div>' +
      '</div>' +
    '</header>';

  // ===== QUICK SYNC BUTTON =====
  var syncBtn = document.getElementById('btn-quick-sync');
  if (syncBtn) {
    // Hide until an app registers a sync instance
    document.addEventListener('oros-sync-ready', function() {
      syncBtn.style.display = '';
    });

    syncBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      var api = window.orosSync && window.orosSync.get();
      if (!api) {
        syncBtn.style.display = 'none';
        return;
      }
      syncBtn.classList.add('syncing');
      api.syncNow();
      setTimeout(function() { syncBtn.classList.remove('syncing'); }, 1500);
    });
  }
})();