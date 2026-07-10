(function() {
  document.addEventListener('DOMContentLoaded', function() {
    var footerEl = document.getElementById('oros-footer');
    if (!footerEl) return;

    footerEl.innerHTML =
      '<footer class="footer">' +
        '<div class="footer-content">' +
          '<div class="footer-left">' +
            '<span class="footer-powered"><span data-i18n="footer_powered_by">Powered by</span> <a href="https://glarolykoi.net" target="_blank" rel="noopener" class="footer-link">glarolykoi.net</a></span>' +
          '</div>' +
          '<div class="footer-center">' +
            '<span class="footer-credits">\u00A9 2026 <a href="https://koulaxizis.gr" target="_blank" rel="noopener" class="footer-link">Christos Koulaxizis</a> \u00B7 <span data-i18n="footer_built_with">Built with \u2665 for artists</span></span>' +
          '</div>' +
          '<div class="footer-right">' +
            '<span class="footer-badge" data-i18n="footer_privacy_badge">Open Source \u00B7 No Tracking \u00B7 No Ads \u00B7 Privacy First</span>' +
          '</div>' +
        '</div>' +
      '</footer>';
  });
})();