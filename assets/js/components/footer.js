// ============================================
// orOS — Global Footer Component
// Edit this file → all apps update instantly
// ============================================

(function() {
  const mount = document.getElementById('oros-footer');
  if (!mount) return;

  mount.innerHTML = `
    <footer class="footer">
      <div class="footer-inner">
        <div class="footer-text" data-i18n="footer_text">Open Source · No Tracking · No Ads · Privacy First</div>
        <div class="footer-credits" data-i18n="footer_credits">© 2026 Christos Koulaxizis. Built with ♥ for artists.</div>
      </div>
    </footer>
    <button id="back-to-top" class="back-to-top" data-i18n="back_to_top" aria-label="Back to top">↑</button>`;
})();