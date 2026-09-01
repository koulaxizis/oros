// ============================================
// orOS — Global SEO Manager
// Dynamic meta tag updates based on language
// Static tags in HTML for crawler compatibility
// Fixed: Removed habits.html, added characters/prompter properly
// Updated: Re-integrated habits.html with proper metadata
// ============================================

(function() {
  'use strict';

  // Page-specific metadata
  var PAGE_META = {
    'index.html': {
      title: 'orOS — The Artist\'s Operating System',
      description: 'Privacy-first creative toolkit. Writer, Case Converter, Kanban, Notes, Habits, and more. Works offline. No tracking. No ads.',
      type: 'website',
      keywords: ['text editor', 'case converter', 'kanban board', 'wiki notes', 'habit tracker', 'privacy', 'offline', 'writer', 'open source', 'Greek']
    },
    'writer.html': {
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
    },
    'kanban.html': {
      title: 'orOS Kanban — Privacy-First Kanban Board',
      description: 'Drag & drop kanban board with multiple boards, columns, labels, due dates, search, and filters. Works offline. No tracking.',
      type: 'article',
      keywords: ['kanban', 'kanban board', 'task manager', 'project management', 'drag and drop', 'labels', 'due dates', 'offline', 'privacy']
    },
    'notes.html': {
      title: 'orOS Notes — Privacy-First Wiki Notes',
      description: 'Wiki-style notes with [[wikilinks]], Markdown rendering, folder hierarchy, and search. Works offline. No tracking.',
      type: 'article',
      keywords: ['notes', 'wiki notes', 'wikilinks', 'markdown', 'knowledge base', 'note taking', 'offline', 'privacy', 'open source']
    },
    'prompter.html': {
      title: 'orOS Prompter — Writing Prompts & Inspiration',
      description: '100 writing prompts across 10 techniques. Micro-fiction, haiku, poetry, songs, theatrical, novels. Works offline. No tracking.',
      type: 'article',
      keywords: ['writing prompts', 'creative writing', 'micro-fiction', 'haiku', 'poetry', 'song lyrics', 'aphorism', 'theatrical', 'monologue', 'inspiration', 'offline', 'privacy', 'open source']
    },
    'characters.html': {
      title: 'orOS Characters — Character Design & Relationship Mapping',
      description: 'Design characters with personality traits, backstories, motivations, and relationship matrices. Works offline. No tracking.',
      type: 'article',
      keywords: ['character design', 'character creator', 'relationship mapping', 'storytelling tools', 'fiction writing', 'character sheet', 'offline', 'privacy', 'open source']
    },
    'habits.html': {
      title: 'orOS Habit Tracker — Build Better Habits',
      description: 'Track habits with streaks, statistics, and reminders. Build better routines. Works offline. No tracking. No ads.',
      type: 'article',
      keywords: ['habit tracker', 'habit building', 'streaks', 'productivity', 'routine builder', 'offline', 'privacy', 'open source']
    }
  };

  // Language to locale mapping — ONLY en and el
  var LOCALE_MAP = {
    en: 'en_US',
    el: 'el_GR'
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

    var description = meta.description;
    if (t.site_tagline && page === 'index.html') {
      description = t.site_tagline + '. ' + (t.tools_intro || '');
    }

    var descMeta = document.querySelector('meta[name="description"]');
    if (descMeta) descMeta.setAttribute('content', description);

    var ogDesc = document.querySelector('meta[property="og:description"]');
    if (ogDesc) ogDesc.setAttribute('content', description);

    var ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) ogTitle.setAttribute('content', meta.title);

    var twDesc = document.querySelector('meta[name="twitter:description"]');
    if (twDesc) twDesc.setAttribute('content', description);

    var twTitle = document.querySelector('meta[name="twitter:title"]');
    if (twTitle) twTitle.setAttribute('content', meta.title);

    var ogLocale = document.querySelector('meta[property="og:locale"]');
    if (ogLocale) ogLocale.setAttribute('content', LOCALE_MAP[lang] || 'en_US');

    document.documentElement.setAttribute('lang', lang);

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
        ? 'Privacy-first creative toolkit. Writer, Case Converter, Kanban, Notes, Habits, and more.'
        : (page === 'writer.html' ? 'Rich text editor with autosave and writing tools.'
           : page === 'converter.html' ? 'Text transformation tool with 10 case modes.'
           : page === 'kanban.html' ? 'Drag & drop kanban board with multiple boards, labels, and due dates.'
           : page === 'notes.html' ? 'Wiki-style notes with wikilinks, Markdown, and folder hierarchy.'
           : page === 'prompter.html' ? 'Writing prompts and inspiration across 10 techniques.'
           : page === 'characters.html' ? 'Character design tool with relationship mapping and templates.'
           : page === 'habits.html' ? 'Habit tracker with streaks, statistics, and reminders.'
           : 'Privacy-first creative toolkit.'),
      "inLanguage": ["en", "el"],
      "operatingSystem": "Web",
      "applicationCategory": "ProductivityApplication",
      "offers": {
        "@type": "Offer",
        "price": "0",
        "priceCurrency": "EUR"
      },
      "license": "https://github.com/koulaxizis/oros-beta/blob/main/LICENSE",
      "softwareVersion": OROS_CONFIG.version,
      "keywords": "text editor, case converter, kanban, wiki notes, character design, habit tracker, privacy, offline, writer, productivity, open source, Greek"
    };

    if (page === 'index.html') {
      structuredData.featureList = [
        'Rich text editor with autosave',
        'Case converter with 10 modes',
        'Kanban boards with drag & drop',
        'Wiki notes with wikilinks',
        'Character design with relationship mapping',
        'Habit tracker with streaks and statistics',
        'Offline-first architecture',
        'Zero tracking, zero cookies'
      ];
    }

    script.textContent = JSON.stringify(structuredData);
    document.head.appendChild(script);
  }

  function injectBreadcrumbs() {
    var page = getCurrentPage();
    if (page === 'index.html') return;

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
          "name": page === 'writer.html' ? 'Writer' 
            : page === 'converter.html' ? 'Case Converter'
            : page === 'kanban.html' ? 'Kanban'
            : page === 'notes.html' ? 'Notes'
            : page === 'prompter.html' ? 'Prompter'
            : page === 'characters.html' ? 'Characters'
            : page === 'habits.html' ? 'Habit Tracker'
            : 'Tool',
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

    window.addEventListener('oros-language-changed', updateMeta);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();