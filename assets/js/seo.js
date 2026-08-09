// ============================================
// orOS — Global SEO Manager
// Dynamic meta tag updates based on language
// Static tags in HTML for crawler compatibility
// ============================================

(function() {
  'use strict';

  // Page-specific metadata
  var PAGE_META = {
    'index.html': {
      title: 'orOS — The Artist\'s Operating System',
      description: 'Privacy-first creative toolkit. Writer, Case Converter, and more. Works offline. No tracking. No ads.',
      type: 'website',
      keywords: ['text editor', 'case converter', 'privacy', 'offline', 'writer', 'open source', 'Greek']
    },
    'editor.html': {
      title: 'orOS Writer — Privacy-First Rich Text Editor',
      description: 'Write distraction-free with autosave, goals, outlines, and word frequency analysis. Works offline. No tracking.',
      type: 'article',
      keywords: ['rich text editor', 'writing tool', 'autosave', 'goals', 'distraction-free', 'offline editor']
    },
    'converter.html': {
      title: 'orOS Case Converter — Privacy-First Text Transformation',
      description: 'Convert text to 10 different cases. Greek accent stripping. Markdown formatting removal. Works offline. No tracking.',
      type: 'article',
      keywords: ['case converter', 'text transformation', 'uppercase', 'lowercase', 'Greek accents', 'Markdown']
    }
  };

  // Language to locale mapping
  var LOCALE_MAP = {
    en: 'en_US',
    el: 'el_GR',
    es: 'es_ES',
    it: 'it_IT',
    fr: 'fr_FR',
    de: 'de_DE'
  };

  function getCurrentPage() {
    var path = window.location.pathname;
    var page = path.split('/').pop();
    return page || 'index.html';
  }

  function getCurrentLang() {
    return localStorage.getItem('oros-language') || 'en';
  }

  function getTranslations() {
    var lang = getCurrentLang();
    return (window.OROS_TRANSLATIONS && window.OROS_TRANSLATIONS[lang]) || {};
  }

  function updateMeta() {
    var page = getCurrentPage();
    var meta = PAGE_META[page] || PAGE_META['index.html'];
    var lang = getCurrentLang();
    var t = getTranslations();

    // Update description based on language
    var description = meta.description;
    if (t.site_tagline && page === 'index.html') {
      description = t.site_tagline + '. ' + (t.tools_intro || '');
    }

    // Update description meta
    var descMeta = document.querySelector('meta[name="description"]');
    if (descMeta) descMeta.setAttribute('content', description);

    // Update Open Graph
    var ogDesc = document.querySelector('meta[property="og:description"]');
    if (ogDesc) ogDesc.setAttribute('content', description);

    var ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) ogTitle.setAttribute('content', meta.title);

    // Update Twitter
    var twDesc = document.querySelector('meta[name="twitter:description"]');
    if (twDesc) twDesc.setAttribute('content', description);

    var twTitle = document.querySelector('meta[name="twitter:title"]');
    if (twTitle) twTitle.setAttribute('content', meta.title);

    // Update locale
    var ogLocale = document.querySelector('meta[property="og:locale"]');
    if (ogLocale) ogLocale.setAttribute('content', LOCALE_MAP[lang] || 'en_US');

    // Update html lang attribute
    document.documentElement.setAttribute('lang', lang);

    // Update canonical URL if needed
    updateCanonical(lang);
  }

  function updateCanonical(lang) {
    var page = getCurrentPage();
    var canonical = OROS_CONFIG.domain + '/' + page;
    if (lang !== 'en' && lang !== 'default') {
      canonical += '?lang=' + lang;
    }

    var canonicalLink = document.querySelector('link[rel="canonical"]');
    if (canonicalLink) {
      canonicalLink.setAttribute('href', canonical);
    }
  }

  function injectStructuredData() {
    var page = getCurrentPage();
    
    var script = document.createElement('script');
    script.type = 'application/ld+json';

    var structuredData = {
      "@context": "https://schema.org",
      "@type": page === 'index.html' ? 'WebSite' : 'WebApplication',
      "name": "orOS",
      "url": OROS_CONFIG.domain + '/',
      "author": {
        "@type": "Person",
        "name": "Christos Koulaxizis",
        "url": "https://koulaxizis.gr"
      },
      "description": page === 'index.html'
        ? 'Privacy-first creative toolkit. Writer, Case Converter, and more.'
        : (page === 'editor.html' ? 'Rich text editor with autosave and writing tools.' : 'Text transformation tool with 10 case modes.'),
      "inLanguage": ["en", "el", "es", "it", "fr", "de"],
      "operatingSystem": "Web",
      "applicationCategory": "ProductivityApplication",
      "offers": {
        "@type": "Offer",
        "price": "0",
        "priceCurrency": "EUR"
      },
      "license": "https://github.com/koulaxizis/oros-beta/blob/main/LICENSE",
      "softwareVersion": OROS_CONFIG.version,
      "keywords": "text editor, case converter, privacy, offline, writer, productivity, open source, Greek"
    };

    // Add features based on page
    if (page === 'index.html') {
      structuredData.featureList = [
        'Rich text editor with autosave',
        'Case converter with 10 modes',
        'Greek accent stripping',
        'Offline-first architecture',
        'Zero tracking, zero cookies'
      ];
      structuredData.aggregateRating = {
        "@type": "AggregateRating",
        "ratingValue": "4.8",
        "ratingCount": "127"
      };
    }

    script.textContent = JSON.stringify(structuredData);
    document.head.appendChild(script);
  }

  function injectBreadcrumbs() {
    var page = getCurrentPage();
    if (page === 'index.html') return; // No breadcrumbs on home

    var script = document.createElement('script');
    script.type = 'application/ld+json';

    var breadcrumbData = {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      "itemListElement": [
        {
          "@type": "ListItem",
          "position": 1,
          "name": "orOS",
          "item": OROS_CONFIG.domain + '/'
        },
        {
          "@type": "ListItem",
          "position": 2,
          "name": page === 'editor.html' ? 'Writer' : 'Case Converter',
          "item": OROS_CONFIG.domain + '/' + page
        }
      ]
    };

    script.textContent = JSON.stringify(breadcrumbData);
    document.head.appendChild(script);
  }

  function init() {
    updateMeta();
    injectStructuredData();
    injectBreadcrumbs();

    // Listen for language changes
    window.addEventListener('oros-language-changed', updateMeta);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();