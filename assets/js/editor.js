<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>orOS Writer</title>
  <meta name="description" content="Privacy-first, offline writer for the modern creator.">
  <link rel="manifest" href="manifest.json">
  <link rel="stylesheet" href="assets/css/style.css">
  <link rel="icon" href="favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="favicon.svg">
  <meta name="theme-color" content="#1b1a18" data-dark="#1b1a18" data-light="#f6f5f1">
</head>
<body>

  <!-- HEADER injected by header.js -->
  <header class="header" id="site-header"></header>

  <!-- MAIN -->
  <main class="app-main">
    <!-- FIND & REPLACE BAR -->
    <div class="find-replace-bar" id="find-replace-bar" style="display:none;">
      <input type="text" class="find-input" id="find-find" placeholder="Find...">
      <input type="text" class="find-input" id="find-replace" placeholder="Replace...">
      <div class="fr-buttons">
        <button class="fr-btn" id="btn-find-prev">↑</button>
        <button class="fr-btn" id="btn-find-next">↓</button>
        <button class="fr-btn" id="btn-replace">Replace</button>
        <button class="fr-btn" id="btn-replace-all">All</button>
      </div>
      <span class="fr-results" id="fr_results">0 matches</span>
      <button class="close-fr-btn" id="btn-close-fr">×</button>
    </div>

    <!-- TOOLBAR -->
    <div class="toolbar">
      <button class="btn-control" id="btn-open">📂 <span data-i18n="open">Open</span></button>
      <button class="btn-control" id="btn-clear">🗑 <span data-i18n="clear">Clear</span></button>
      <div class="quick-format-toolbar" id="quick-format-toolbar">
        <button class="fmt-btn" data-cmd="bold" title="Bold (Ctrl+B)">B</button>
        <button class="fmt-btn" data-cmd="italic" title="Italic (Ctrl+I)">I</button>
        <button class="fmt-btn" data-cmd="underline" data-i18n-tooltip="underline_title" title="Underline">U</button>
        <button class="fmt-btn" data-cmd="strikeThrough" title="Strikethrough">S</button>
        <button class="fmt-btn" data-cmd="insertUnorderedList" title="Bullet List">•</button>
        <button class="fmt-btn" data-cmd="insertOrderedList" title="Numbered List">1.</button>
      </div>
      <span class="save-status" id="save_status" style="font-size:0.75rem;color:var(--text-secondary);margin-left:auto;"></span>
      <div class="export-wrap">
        <button class="btn-control" id="btn-export">⬇ <span data-i18n="export">Export</span></button>
        <div class="export-dropdown" id="export-dropdown">
          <button data-format="md" data-i18n="export_md">MD</button>
          <button data-format="txt" data-i18n="export_txt">TXT</button>
          <button data-format="rtf" data-i18n="export_rtf">RTF</button>
          <button data-format="doc" data-i18n="export_doc">DOC</button>
          <button data-format="pdf" data-i18n="export_pdf">PDF</button>
        </div>
      </div>
    </div>

    <!-- EDITOR WRAPPER — contains scrollable editor + stats overlay -->
    <div class="editor-wrapper" id="rich-wrapper">
      <div class="rich-editor" id="rich-editor" contenteditable="true" spellcheck="true"></div>
      <div class="stats-overlay" id="stats-overlay">
        <span id="word_count">0</span> words
        <span class="stat-sep">|</span>
        <span id="char_count">0</span> chars
        <span class="stat-sep">|</span>
        <span id="read_time">1m</span>
      </div>
    </div>
  </main>

  <!-- FOOTER injected by footer.js -->
  <footer class="footer" id="site-footer"></footer>

  <!-- Back to Top -->
  <button class="back-to-top" id="back-to-top" aria-label="Back to top">↑</button>

  <script src="assets/js/components/header.js"></script>
  <script src="assets/js/main.js"></script>
  <script src="assets/js/editor.js"></script>
  <script src="assets/js/components/footer.js"></script>
</body>
</html>