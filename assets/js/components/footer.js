// ============================================
// orOS — Global Footer Component
// Edit this file → all apps update instantly
// ============================================

(function() {
  var mount = document.getElementById('oros-footer');
  if (!mount) return;

  mount.innerHTML =
    '<footer class="footer">' +
      '<div class="footer-inner">' +
        '<div class="footer-text" data-i18n="footer_text">Open Source · No Tracking · No Ads · Privacy First</div>' +
        '<div class="footer-credits"></div>' +
      '</div>' +
    '</footer>' +
    '<button id="back-to-top" class="back-to-top" data-i18n-aria="back_to_top" aria-label="Back to top">↑</button>';
})();