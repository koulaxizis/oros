// ============================================================
// orOS Core — Shell logic
// Sections:
//   1. State, skin registry, wallpaper registry, icon constants
//   2. Preferences (skin, language, theme, wallpaper, auto-backup)
//   3. Language apply
//   4. Theme apply
//   5. Skin apply · 5b. Wallpaper · 5c. Auto-backup scheduler ·
//       5d. Backup folder (File System Access API)
//   6. Clock (24h) — hosts ALL throttled engine ticks (weather,
//       alarms, calendar/mood/cycle/todo/quote scans, notifs sweep)
//   7. PWA: install flow + version toast
//   8. Apps loading & menu rendering
//   9. Sync UI & shell slice registration · 9f. Files disk slice ·
//       9g. Notifications settings (module-driven)
//   9b. Taskbar sync dot · 9c. Shortcuts + Info modal + factory
//       reset · 9d. Weather widget · 9e. Alarm engine ·
//       9e2. Calendar reminders + shell-side app scans ·
//       deep-link bridges (Contacts/Cycle/Mood/Time/Todo/Quote/
//       Weather/Maps/Kanban/Calendar)
//  10. App opening / return (fullscreen takeover)
//  11. Menu open/close
//  12. Wiring & boot
// Update lifecycle is owned by the inline broker in index.html —
// auto-update (skipWaiting + controllerchange reload); the shell
// shows the version toast as sole confirmation.
// ============================================================
(function () {
  "use strict";

  // Factory reset stage 2 — hoisted factoryResetPending() runs before
  // anything can open IndexedDB. True = boot halted, clean reload follows.
  if (factoryResetPending()) return;

  var APP_VERSION = "0.53.02";   // bump on every deploy (shows welcome toast)
  var VERSION_KEY = "oros-last-version";

  // ---------- 1. State & registries ----------
  var state = {
    lang:            null,   // "en" | "el"
    theme:           null,   // "dark" | "light"
    skin:            null,   // palette id (see SKINS)
    wallpaper:       null,   // wallpaper id (see WALLPAPERS)
    wpart:           null,   // "Mine" wallpaper recipe (Wallpaper Generator) or null
    apps:            [],
    running:         null,
    deferredPrompt:  null,   // PWA install event
    // sync UI state
    syncUserEmail:   null,
    syncMsg:         null,   // { kind: "ok"|"err"|"dim", text: "…" }
    syncAutoErr:     null,   // SY-L2: why the last background sync failed (cleared by a success)

    // auto-backup mode: "off" | "daily" | "weekly" | "monthly"
    autoexport:      "off"
  };

  var SKINS = [
    { id: "adwaita",    color: "#3584e4" },
    { id: "lumo",       color: "#6d4aff" },
    { id: "oros",       color: "#d4af37" },
    { id: "ubuntu",     color: "#e95420" },
    { id: "fedora",     color: "#51a2da" },
    { id: "mint",       color: "#87cf3e" },
    { id: "arch",       color: "#1793d1" },
    { id: "debian",     color: "#d70a53" },
    { id: "elementary", color: "#8c5ec7" },
    { id: "tux",        color: "#c9c9c9" },
    // v0.12.0 — second Linux family (6 new: 16 total, grid 2×8)
    { id: "manjaro",    color: "#35bf5c" },
    { id: "opensuse",   color: "#73ba25" },
    { id: "nixos",      color: "#5277c3" },
    { id: "gentoo",     color: "#7d5ba6" },
    { id: "popos",      color: "#ff7043" },
    { id: "zorin",      color: "#15a6a0" }
  ];

  var DEFAULT_WALLPAPER = "sand";

  // Wallpapers live in JS (single source of truth): the SAME gradient
  // string feeds the desktop background AND the picker thumbnails —
  // WYSIWYG guaranteed, no CSS-specificity battles.
  var WALLPAPERS = [
    { id: "custom",   pair: null,          css: "" },  // "Mine": drawn from state.wpart (5b)
    { id: "dusk",     pair: null,          css: "linear-gradient(160deg, #1b2735 0%, #10151f 45%, #0b0f17 100%)" },
    { id: "midnight", pair: "arch",        css: "linear-gradient(165deg, #0d1117 0%, #06080c 60%, #000000 100%)" },
    { id: "plum",     pair: "ubuntu",      css: "radial-gradient(ellipse at 30% 20%, #4a2545 0%, #2c1626 55%, #190d17 100%)" },
    { id: "forest",   pair: "mint",        css: "linear-gradient(150deg, #16281c 0%, #0e1a12 55%, #070f09 100%)" },
    { id: "ember",    pair: "debian",      css: "linear-gradient(160deg, #2b1810 0%, #1d0f0a 50%, #120806 100%)" },
    { id: "nordic",   pair: "fedora",      css: "linear-gradient(170deg, #2c3e50 0%, #1d2a38 55%, #131b24 100%)" },
    { id: "aurora",   pair: "elementary",  css: "linear-gradient(155deg, #10302b 0%, #0b2320 45%, #071512 100%)" },
    { id: "sand",     pair: "oros",        css: "linear-gradient(160deg, #33291d 0%, #241c13 55%, #161009 100%)" },
    { id: "mono",     pair: "tux",         css: "linear-gradient(170deg, #262626 0%, #1a1a1a 55%, #0e0e0e 100%)" },
    // v0.12.0 — five composite wallpapers (layered gradients)
    { id: "nebula",   pair: "lumo",        css: "radial-gradient(ellipse at 25% 15%, #3d2b63 0%, #241b3d 40%, #14102a 70%, #0a0817 100%)" },
    { id: "borealis", pair: "manjaro",     css: "radial-gradient(ellipse at 70% 0%, rgba(63,175,127,0.30) 0%, rgba(63,175,127,0) 45%), radial-gradient(ellipse at 40% 8%, rgba(94,231,160,0.14) 0%, rgba(94,231,160,0) 35%), linear-gradient(170deg, #0e1a17 0%, #0a1210 55%, #050908 100%)" },
    { id: "hex",      pair: "arch",        css: "repeating-linear-gradient(0deg, rgba(255,255,255,0.025) 0 1px, transparent 1px 22px), repeating-linear-gradient(60deg, rgba(255,255,255,0.02) 0 1px, transparent 1px 26px), linear-gradient(165deg, #17181d 0%, #101116 60%, #0a0b0f 100%)" },
    { id: "obsidian", pair: "tux",         css: "linear-gradient(200deg, #1a1025 0%, #0e0a14 55%, #070609 100%)" },
    { id: "terrazzo", pair: "zorin",       css: "radial-gradient(circle at 15% 22%, #d4af37 0 2.5px, transparent 3px), radial-gradient(circle at 62% 30%, #6d4aff 0 2px, transparent 2.5px), radial-gradient(circle at 38% 68%, #e06c75 0 2.5px, transparent 3px), radial-gradient(circle at 78% 76%, #15a6a0 0 2px, transparent 2.5px), radial-gradient(circle at 28% 48%, #87cf3e 0 1.5px, transparent 2px), radial-gradient(circle at 85% 18%, #51a2da 0 1.5px, transparent 2px), radial-gradient(circle at 8% 82%, #ff7043 0 2px, transparent 2.5px), linear-gradient(160deg, #211f1b 0%, #161411 60%, #0e0d0b 100%)" },
    { id: "clear",    pair: null,          css: "" }   // "None": theme background
  ];

  // ---------- Auto-backup configuration (folder export — localStorage snapshots removed) ----------
  var AUTOEXPORT_PREF  = "oros-autoexport";        // mode: off/daily/weekly/monthly (travels in shell slice)
  var AUTOEXPORT_LAST  = "oros-autoexport-last";  // epoch ms of last check/export (device-local)
  var DAY_MS           = 24 * 60 * 60 * 1000;
  var AUTOEXPORT_PERIODS = {
    daily:   DAY_MS,
    weekly:  7 * DAY_MS,
    monthly: 30 * DAY_MS
  };
    // v0.12.1 — Folder backups (File System Access API, Chromium desktop)
  var FS_FOLDER_NAME_KEY = "oros-fs-folder-name"; // display name only
  var FS_LAPSED_KEY = "oros-fs-lapsed";            // permission lapsed flag

  function findWallpaper(id) {
    for (var i = 0; i < WALLPAPERS.length; i++) {
      if (WALLPAPERS[i].id === id) return WALLPAPERS[i];
    }
    return null;
  }

  var MOON_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  var SUN_SVG  = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="M4.93 4.93l1.41 1.41"/><path d="M17.66 17.66l1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="M4.93 19.07l1.41-1.41"/><path d="M17.66 6.34l1.41-1.41"/></svg>';
  var GRID_SVG = '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>';
  var DOWNLOAD_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>';
  var UPLOAD_ICON_SVG   = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/></svg>';
  var CLOUD_ICON_SVG    = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>';
  var EYE_SVG     = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  var EYE_OFF_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/></svg>';

  // App icons (SVG — ForkAwesome rejected, handcrafted forever)
  var ICONS = {
    help: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"/><path d="M9.3 9.2a2.8 2.8 0 0 1 5.4 1c0 1.9-2.7 2.5-2.7 4.1"/><path d="M12 17.6h.01"/></svg>',
    check: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    columns: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="5" height="18" rx="1"/><rect x="10" y="3" width="5" height="12" rx="1"/><rect x="16" y="3" width="5" height="13" rx="1"/></svg>',
    mindmap: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="9.5" width="8" height="5" rx="2"/><circle cx="3.5" cy="5" r="1.8"/><circle cx="20.5" cy="5" r="1.8"/><circle cx="3.5" cy="19" r="1.8"/><circle cx="20.5" cy="19" r="1.8"/><path d="M5 6.2l3.2 3.8M19 6.2l-3.2 3.8M5 17.8l3.2-3.8M19 17.8l-3.2-3.8"/></svg>',
    notes: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>',
    weather: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="7" r="3"/><path d="M7 1v1M7 12v1M1 7h1M12 7h1M3.5 3.5l.7.7M10.8 10.8l.7.7M3.5 10.5l.7-.7M10.8 4.2l.7-.7"/><path d="M12.5 21a4.5 4.5 0 0 1 0-9 5.5 5.5 0 0 1 10.6 1.6 3.5 3.5 0 0 1-.6 6.9z"/></svg>',
    mood: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8.5 14.5c.9 1.2 2.1 1.8 3.5 1.8s2.6-.6 3.5-1.8"/><path d="M9 9.5h.01M15 9.5h.01" stroke-width="2.4"/></svg>',
    clock: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg>',
    calendar: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    quote: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M10.7 13.2c-1.1 0-2 .9-2 2s.8 2 1.8 2c0 1.6-.8 2.4-.8 2.4"/><path d="M16.2 13.2c-1.1 0-2 .9-2 2s.8 2 1.8 2c0 1.6-.8 2.4-.8 2.4"/></svg>',
    timesheet: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9.5 2.5h5"/></svg>',
    prompter: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z"/><line x1="16" y1="8" x2="2" y2="22"/><line x1="17.5" y1="15" x2="9" y2="15"/><line x1="21" y1="2" x2="21" y2="6"/><line x1="19" y1="4" x2="23" y2="4"/></svg>',
    characters: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    water: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.8C9 7 6 10.4 6 14.2a6 6 0 0 0 12 0C18 10.4 15 7 12 2.8z"/></svg>',
    names: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7.5V5a1 1 0 0 1 1-1h7.5L21 13.5 13.5 21 4 11.5V7.5z"/><circle cx="8" cy="8" r="1.5"/><path d="M11 13l2 2M13 11l2 2"/></svg>',
    fitness: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 7v10M3 9v6M18 7v10M21 9v6M6 12h12"/></svg>',
    pixel: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><rect x="7" y="8" width="3" height="3" fill="currentColor" stroke="none"/><rect x="14" y="8" width="3" height="3" fill="currentColor" stroke="none"/><path d="M8 15h8"/></svg>',
    shelf: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V5h3v16"/><path d="M10 21V8h3v13"/><path d="M15.5 8.5l2.9-.8 3 12.6-2.9.7z"/></svg>',
    storage: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5"/><path d="M12 13v8"/></svg>',
    meals: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11h18v2a7 7 0 0 1-7 7h-4a7 7 0 0 1-7-7z"/><path d="M1.5 11h21"/><path d="M8 7c0-1.2 1-1.4 1-2.6M12 7c0-1.2 1-1.4 1-2.6M16 7c0-1.2 1-1.4 1-2.6"/></svg>',
    habits: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><line x1="8" y1="2" x2="8" y2="5"/><line x1="16" y1="2" x2="16" y2="5"/><polyline points="8.5 13 11 15.5 15.5 10.5"/></svg>',
    health: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21.2l8.8-8.8a5.5 5.5 0 0 0 0-7.8z"/><path d="M3.5 12h4l2-3 3 6 2-3h6"/></svg>',
    zen: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="6.5" stroke-dasharray="2 2.6"/><circle cx="12" cy="12" r="10"/></svg>',
    budget: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-2"/><path d="M16 8h5v8h-5a4 4 0 0 1 0-8z"/><circle cx="16.5" cy="12" r="0.6" fill="currentColor"/></svg>',
    qr: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v1M14 20h1M18 18h3v3M17 21h0"/></svg>',
    files: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 3v18"/></svg>',
    pubdomain: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M14.8 9.2a4 4 0 1 0 0 5.6"/><line x1="5" y1="5" x2="19" y2="19"/></svg>',
    cycle: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>',
    plants: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 14h12l-1.6 7H7.6z"/><path d="M12 14V9"/><path d="M12 9c0-3 2-5.5 6-5.5 0 3.5-2 5.5-6 5.5z"/><path d="M12 11c0-2.5-1.8-4-5-4 0 3 1.8 4 5 4z"/></svg>',
    familytree: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="5" rx="1"/><rect x="2" y="17" width="6" height="5" rx="1"/><rect x="16" y="17" width="6" height="5" rx="1"/><path d="M12 7v5M5 17v-5h14v5"/></svg>',
    contacts: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 12c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm0 2c-3.33 0-10 1.67-10 5v2h20v-2c0-3.33-6.67-5-10-5z"/></svg>',
    bookmarks: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v14l-10-6-10 6V6a2 2 0 0 1 2-2z"/><path d="M8 4v16M16 4v16"/></svg>',
    maps: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    feeds: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/></svg>',
    spreadsheet: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>',
    writer: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    layout: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 9v12"/><path d="M12.5 13h5M12.5 17h5"/></svg>',
    wallpaper: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="3.5" width="19" height="17" rx="2.5"/><path d="M2.5 15c3-3 5.5-3 8.5 0s5.5 3 10.5-1"/><path d="M2.5 10.5c3-2.5 5.5-2.5 8.5 0s5.5 2.5 10.5-1"/></svg>',
    atelier: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21a9 9 0 0 1 0-18c4.97 0 9 3.58 9 8 0 2.5-2 4-4.5 4H14a1.5 1.5 0 0 0-1 2.6A1.5 1.5 0 0 1 12 21z"/><circle cx="7.5" cy="10.5" r="1"/><circle cx="11.5" cy="7.5" r="1"/><circle cx="16.5" cy="9.5" r="1"/></svg>',
    netizen: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5" width="19" height="14" rx="2.5"/><rect x="5.5" y="8.5" width="5" height="6" rx="1"/><path d="M13.5 9.5h5M13.5 13h3.5M5.5 16.5h13"/></svg>',
    garage: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 17H3.5a1 1 0 0 1-1-1v-3.2a2 2 0 0 1 .6-1.4L5 9.5l1.6-3.6A2 2 0 0 1 8.4 4.7h7.2a2 2 0 0 1 1.8 1.2L19 9.5l1.9 1.9a2 2 0 0 1 .6 1.4V16a1 1 0 0 1-1 1H19"/><path d="M5 9.5h14"/><circle cx="7.5" cy="17" r="2"/><circle cx="16.5" cy="17" r="2"/><path d="M9.5 17h5"/></svg>',
    dice: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.4" fill="currentColor" stroke="none"/><circle cx="15.5" cy="8.5" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="8.5" cy="15.5" r="1.4" fill="currentColor" stroke="none"/><circle cx="15.5" cy="15.5" r="1.4" fill="currentColor" stroke="none"/></svg>',
    petcare: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="4.5" cy="9.5" r="1.8"/><circle cx="8.5" cy="5" r="1.8"/><circle cx="13.5" cy="5" r="1.8"/><path d="M11 10.5c-2.8 0-5 3.3-5 5.6 0 1.6 1.2 2.4 2.7 2.4.9 0 1.5-.5 2.3-.5"/><path d="M18 12v8M14 16h8"/></svg>',
    wheel: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8.5"/><path d="M12 4.5v17M3.5 13h17M6 7l12 12M18 7L6 19"/><path d="M10 1.5h4L12 4.5z" fill="currentColor"/></svg>',
    oracle: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path d="M12 2v1.5M5 4.5l1 1M19 4.5l-1 1"/></svg>',
    slides: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="12" rx="1"/><path d="M8 11v-2M12 11V7M16 11v-3M12 15v3M8 21l4-3 4 3"/></svg>',
    baby: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2h4M9.5 5h5M10 5v2.5L8 10v10a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V10l-2-2.5V5"/><path d="M8 14h3M8 17h3"/></svg>',
    chores: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4.5"/><path d="M12 2v5.5M12 16.5V22M2 12h5.5M16.5 12H22"/></svg>',
    travel: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="7" width="17" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M8 7v13M16 7v13"/></svg>',
    passwords: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="10.5" width="18" height="11" rx="2"/><path d="M7.5 10.5V7a4.5 4.5 0 0 1 9 0v3.5"/><circle cx="8" cy="16" r="1" fill="currentColor"/><circle cx="12" cy="16" r="1" fill="currentColor"/><circle cx="16" cy="16" r="1" fill="currentColor"/></svg>',
    device: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M12 10.5v5"/><circle cx="12" cy="7.5" r="0.6" fill="currentColor"/><path d="M10.5 18.5h3"/></svg>',
    settings: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    memory: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="4" width="8.5" height="16" rx="2"/><rect x="13" y="4" width="8.5" height="16" rx="2"/><circle cx="6.75" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="17.25" cy="12" r="1.6" fill="currentColor" stroke="none"/></svg>',
    connect4: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="3.5" width="19" height="17" rx="3"/><circle cx="7.5" cy="15.5" r="1.8" fill="currentColor" stroke="none"/><circle cx="12" cy="15.5" r="1.8" fill="currentColor" stroke="none"/><circle cx="16.5" cy="15.5" r="1.8"/><circle cx="12" cy="10.5" r="1.8" fill="currentColor" stroke="none"/><circle cx="16.5" cy="10.5" r="1.8"/></svg>',
    dots: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5h14M5 5v14M19 5v7M5 19h7"/><rect x="5" y="5" width="7" height="7" fill="currentColor" stroke="none" opacity=".35"/><circle cx="5" cy="5" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="5" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="5" r="1.6" fill="currentColor" stroke="none"/><circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="5" cy="19" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="19" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="19" r="1.6" fill="currentColor" stroke="none"/></svg>',
    tictactoe: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/><path d="M4.5 4.5l3 3M7.5 4.5l-3 3"/><circle cx="18" cy="18" r="1.8"/></svg>',
    petworld: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 2.5 2.5 10h2.5L2 15h10L9 10h2.5z"/><path d="M7 15v4"/><path d="M14 21v-3.5a3.5 3.5 0 0 1 7 0V21z"/><path d="M15.5 14.5 15 13M19.5 14.5l.5-1.5"/><path d="M2 21h20"/></svg>',
    simon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"/><path d="M12 2.5v6M12 15.5v6M2.5 12h6M15.5 12h6"/><path d="M5.3 5.3a9.5 9.5 0 0 1 6.7-2.8v6a3.5 3.5 0 0 0-3.5 3.5h-6a9.5 9.5 0 0 1 2.8-6.7z" fill="currentColor" stroke="none"/></svg>',
    slider: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2.5"/><rect x="6" y="6" width="5" height="5" rx="1" fill="currentColor" stroke="none"/><rect x="13" y="6" width="5" height="5" rx="1" fill="currentColor" stroke="none"/><rect x="6" y="13" width="5" height="5" rx="1" fill="currentColor" stroke="none"/><path d="M14 15.5h3.5M16 13.5l2 2-2 2"/></svg>',
    lightsout: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2.5"/><circle cx="8" cy="8" r="2" fill="currentColor" stroke="none"/><circle cx="16" cy="8" r="2" stroke-width="1.5"/><circle cx="8" cy="16" r="2" stroke-width="1.5"/><circle cx="16" cy="16" r="2" fill="currentColor" stroke="none"/></svg>',
    whack: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="19" rx="9" ry="3"/><path d="M7 19v-5a5 5 0 0 1 10 0v5"/><circle cx="10" cy="13" r=".8" fill="currentColor" stroke="none"/><circle cx="14" cy="13" r=".8" fill="currentColor" stroke="none"/><path d="M15 3l4 4M17 5l-4.5 4.5"/></svg>',
    snake: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19h9a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7"/><circle cx="18" cy="7" r="2"/><path d="M20 7h2"/></svg>',
    g2048: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2" fill="currentColor"/></svg>',
    wordle: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="6" height="6" rx="1" fill="currentColor"/><rect x="9" y="4" width="6" height="6" rx="1"/><rect x="16" y="4" width="6" height="6" rx="1" fill="currentColor"/><rect x="2" y="14" width="6" height="6" rx="1"/><rect x="9" y="14" width="6" height="6" rx="1"/><rect x="16" y="14" width="6" height="6" rx="1"/></svg>',
    xeri: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="11" height="16" rx="2"/><path d="M16.5 5.5l2.6.7a2 2 0 0 1 1.4 2.5l-3 11a2 2 0 0 1-2.5 1.4l-1.5-.4"/><path d="M6 8.5h5M6.5 12h4M6 15.5h5"/></svg>',
    crossword: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/><path d="M15 3h6v6h-6zM3 15h6v6H3z" fill="currentColor"/></svg>',
    jigsaw: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h4a2 2 0 1 1 4 0h4v4a2 2 0 1 1 0 4v4h-4a2 2 0 1 0-4 0H4v-4a2 2 0 1 0 0-4z"/></svg>',
    solitaire: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="3" width="12" height="17" rx="2"/><path d="M5 6.5 4 7a2 2 0 0 0-.9 2.6l4.2 9.7a2 2 0 0 0 2.6 1L12 20"/><path d="M14 8.5c-1.2 1.4-2.5 2.4-2.5 3.6a1.3 1.3 0 0 0 2.5.5 1.3 1.3 0 0 0 2.5-.5c0-1.2-1.3-2.2-2.5-3.6zM14 13v2"/></svg>',
    wordsearch: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 8l8 8" stroke-width="4" opacity="0.5"/><path d="M8 16h.01M16 8h.01M12 8h.01M8 12h.01M16 12h.01M12 16h.01"/></svg>',
    scores: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M12 3v18M4 8h16"/><path d="M6.5 12.5h3M14.5 12.5h3M6.5 16.5h3M14.5 16.5h3"/></svg>',
    spot: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="9" height="14" rx="1.5"/><rect x="13" y="5" width="9" height="14" rx="1.5"/><circle cx="6.5" cy="10" r="1.5" fill="currentColor"/><circle cx="17.5" cy="12" r="2.5"/></svg>',
    hexagon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3.9 12 6.2v4.6l-4 2.3-4-2.3V6.2z"/><path d="M16 3.9l4 2.3v4.6l-4 2.3-4-2.3V6.2z"/><path d="M12 10.8l4 2.3v4.6L12 20l-4-2.3v-4.6z"/></svg>',
    chess: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="6" r="2.6"/><path d="M10 9.5h4l1.6 8.5H8.4z"/><path d="M6.5 21h11"/></svg>',
    sudoku: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/></svg>',
    tetris: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="6" height="6" rx="1"/><rect x="9" y="4" width="6" height="6" rx="1"/><rect x="15" y="4" width="6" height="6" rx="1"/><rect x="9" y="10" width="6" height="6" rx="1"/><path d="M3 20h18"/></svg>',
    minesweeper: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="6"/><path d="M12 3v4M12 19v2M4 13H2M22 13h-2M6.3 7.3 5 6M17.7 7.3 19 6"/><circle cx="10" cy="11" r="1" fill="currentColor"/></svg>',
    mahjong: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="11" height="14" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-5"/><circle cx="8.5" cy="14" r="2.5"/></svg>',
    gomoku: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="16" r="1.9" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.9" fill="currentColor" stroke="none"/><circle cx="16" cy="8" r="1.9" fill="currentColor" stroke="none"/></svg>',
    bubble: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="12" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="9" cy="11.5" r="3" fill="currentColor"/><path d="M12 21l3-6"/><circle cx="12" cy="21" r="1"/></svg>',
    checkers: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="8" rx="8" ry="3"/><path d="M4 8v3.5c0 1.7 3.6 3 8 3s8-1.3 8-3V8"/><path d="M4 11.5V15c0 1.7 3.6 3 8 3s8-1.3 8-3v-3.5"/></svg>',
    mastermind: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="8" r="2.5"/><circle cx="12" cy="8" r="2.5" fill="currentColor"/><circle cx="19" cy="8" r="2.5"/><circle cx="8" cy="17" r="1.5" fill="currentColor"/><circle cx="16" cy="17" r="1.5"/></svg>',
    battleship: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 14h20l-3 5H5z"/><path d="M6 14v-3h9l2 3"/><path d="M10 11V6h3v5"/><path d="M3 22c2 0 2-1 4.5-1s2.5 1 4.5 1 2-1 4.5-1 2.5 1 4.5 1"/></svg>',
    rps: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.12 8.12 12 12"/><path d="M20 4 8.12 15.88"/><path d="M14.8 14.8 20 20"/></svg>',
    hangman: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h10M6 21V3h10v3"/><circle cx="16" cy="9" r="2.5"/><path d="M16 11.5V16M13.5 13.5h5M14 20l2-4 2 4"/></svg>',
    flow: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2.5"/><path d="M8 8v8h8"/><circle cx="8" cy="8" r="2" fill="currentColor" stroke="none"/><circle cx="16" cy="16" r="2" fill="currentColor" stroke="none"/></svg>',
    nonogram: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="13" height="13" rx="1"/><path d="M3 10h2M3 14h2M3 18h2M10 3v2M14 3v2M18 3v2"/><rect x="10" y="10" width="4" height="4" fill="currentColor" stroke="none"/><rect x="14" y="15" width="5" height="4" fill="currentColor" stroke="none"/></svg>',
    breakout: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="8" height="4" rx="1"/><rect x="13" y="3" width="8" height="4" rx="1"/><rect x="8" y="9" width="8" height="4" rx="1"/><circle cx="15" cy="16" r="1.6"/><path d="M6 21h8"/></svg>',
    reversi: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor"/></svg>',
    mancala: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="4"/><circle cx="9" cy="10" r="1.2" fill="currentColor"/><circle cx="15" cy="10" r="1.2" fill="currentColor"/><circle cx="9" cy="14" r="1.2" fill="currentColor"/><circle cx="15" cy="14" r="1.2" fill="currentColor"/></svg>',
    pong: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5v8M20 11v8"/><path d="M12 3v2M12 9v2M12 15v2M12 20v1"/><circle cx="16.5" cy="7" r="1.6"/></svg>',
    backgammon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="18" rx="2"/><path d="M5 3l2 7 2-7M15 3l2 7 2-7M5 21l2-7 2 7M15 21l2-7 2 7"/></svg>',
    calculator: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><line x1="8" y1="3" x2="16" y2="3"/><line x1="8" y1="8" x2="8" y2="8"/><line x1="12" y1="8" x2="12" y2="8"/><line x1="16" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="8" y2="12"/><line x1="12" y1="12" x2="12" y2="12"/><line x1="16" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="10" y2="16"/><line x1="12" y1="16" x2="14" y2="16"/><line x1="16" y1="16" x2="16" y2="16"/></svg>',
    minimalism: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/></svg>',
    split: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="7" r="4"/><circle cx="17" cy="17" r="4"/><path d="M14 4h4a2 2 0 0 1 2 2v3"/><path d="M18 7l2 2 2-2"/><path d="M10 20H6a2 2 0 0 1-2-2v-3"/><path d="M6 17l-2-2-2 2"/></svg>',
    radio: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="11" r="2"/><path d="M7.5 13.5a6.5 6.5 0 0 1 0-5"/><path d="M16.5 8.5a6.5 6.5 0 0 1 0 5"/><path d="M5 16a10 10 0 0 1 0-10"/><path d="M19 6a10 10 0 0 1 0 10"/><line x1="12" y1="13" x2="12" y2="21"/></svg>',
    podcasts: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="11" r="2"/><path d="M12 13v8"/><path d="M8.5 15.5a5 5 0 1 1 7 0"/><path d="M5.6 18.4a9 9 0 1 1 12.8 0"/></svg>',
    mixer: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="3" x2="6" y2="21"/><line x1="12" y1="3" x2="12" y2="21"/><line x1="18" y1="3" x2="18" y2="21"/><rect x="4" y="13" width="4" height="3" rx="1"/><rect x="10" y="6" width="4" height="3" rx="1"/><rect x="16" y="10" width="4" height="3" rx="1"/></svg>',
    television: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="13" rx="2"/><polyline points="17 2 12 7 7 2"/></svg>',
    mail: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="22 6 12 13 2 6"/></svg>'
  };

  function isValidSkin(id) {
    for (var i = 0; i < SKINS.length; i++) {
      if (SKINS[i].id === id) return true;
    }
    return false;
  }

  // Any user-initiated settings change → the sync engine wants to know.
  // (Called ONLY from user action handlers — never from shellSliceSet,
  // which is fed by pulls. That would loop: pull → set → dirty → push.)
  function noteLocalChange() {
    // SH-D1: stamp whichever setting just changed, at the moment it
    // changed (the merge is last-writer-wins per setting).
    try { shellStampsRefresh(); } catch (e) {}
    if (window.orosSync && typeof window.orosSync.markDirty === "function") {
      window.orosSync.markDirty();
    }
  }

  // ---------- 2. Preferences ----------
  function initPrefs() {
    var params = new URLSearchParams(window.location.search);

    var urlLang    = params.get("lang");
    var storedLang = localStorage.getItem("oros-lang");
    state.lang     = (urlLang === "el" || urlLang === "en") ? urlLang
                   : (storedLang === "el" || storedLang === "en") ? storedLang
                   : "en";
    // Χ2: persist — wxFetch trayfail copy and wxBriefTick (plus iframe
    // apps) read localStorage["oros-lang"] directly; a URL-param lang
    // left them stale until the first toggle/pull ever ran.
    localStorage.setItem("oros-lang", state.lang);

    var urlSkin    = params.get("skin");
    var storedSkin = localStorage.getItem("oros-skin");
    state.skin     = isValidSkin(urlSkin) ? urlSkin
                   : isValidSkin(storedSkin) ? storedSkin
                   : "oros";
    localStorage.setItem("oros-skin", state.skin);

    var storedWp = localStorage.getItem("oros-wallpaper");
    state.wallpaper = findWallpaper(storedWp) ? storedWp : DEFAULT_WALLPAPER;
    localStorage.setItem("oros-wallpaper", state.wallpaper);
    state.wpart = wpArtRead();

    state.theme = localStorage.getItem("oros-theme") === "light" ? "light" : "dark";

    var ae = localStorage.getItem(AUTOEXPORT_PREF);
    state.autoexport = (ae === "daily" || ae === "weekly" || ae === "monthly") ? ae : "off";
  }

  // ---------- 3. Language ----------
  function applyLang() {
    window.orosLang = state.lang;
    document.documentElement.setAttribute("lang", state.lang);

    // TP-guard: applyLang() is called EARLY in boot (before "load" event).
    // If translations.js hasn't finished loading yet, skip t()-calls entirely
    // — the menu will repaint correctly on first user interaction instead.
    if (typeof window.t !== "function") {
      console.warn("[orOS] applyLang: window.t not ready yet — deferring i18n paint");
      return;
    }

    var nodes = document.querySelectorAll("[data-i18n]");
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].textContent = window.t(nodes[i].getAttribute("data-i18n"));
    }
    var titled = document.querySelectorAll("[data-i18n-title]");
    for (var j = 0; j < titled.length; j++) {
      titled[j].setAttribute("title", window.t(titled[j].getAttribute("data-i18n-title")));
    }

    document.getElementById("btn-menu-label").textContent =
      state.running ? window.t("running.back") : window.t("bar.menu");

    // v0.18.1 — version badge REMOVED from the taskbar: the version
    // lives in the Info modal (Ctrl+Alt+Shift+I / menu row) and the
    // update toast. One less element on the bar; APP_VERSION stays
    // the single release key.

    var langBtn = document.getElementById("btn-lang");
    langBtn.textContent = state.lang === "en" ? "EL" : "EN";
    langBtn.setAttribute("title", window.t("lang.tooltip"));

    // E1/E2 — localized titles for the split clock buttons. Painted
    // here (not data-i18n) so stale HTML bundles can't linger with
    // dead attributes.
    var tBtn = document.getElementById("bar-time");
    var dBtn = document.getElementById("bar-date");
    if (tBtn) tBtn.title = window.t("app.time");   // paintBarDate adds the date at fit level 6
    if (dBtn) dBtn.title = window.t("app.calendar");

    renderClock();
    renderMenu();
  }

  // Language toggle reaches OPEN apps: iframes read orosLang once at
  // boot, so the honest way to localize an already-running app is a
  // clean re-open. Data lives in storage/slices — zero loss risk.
  function refreshRunningApp() {
    if (state.running) {
      document.getElementById("app-frame").src = state.running.url;
    }
  }

  // ---------- 4. Theme ----------
  function applyTheme() {
    document.documentElement.setAttribute("data-theme", state.theme);
  }

  // ---------- 5. Skin ----------
  function applySkin() {
    if (!isValidSkin(state.skin)) state.skin = "oros";
    document.documentElement.setAttribute("data-skin", state.skin);
    // Public palette contract for same-origin iframe apps: readers of
    // window.parent.orosAppTheme.accent get the live accent without
    // their own skin map.
    for (var i = 0; i < SKINS.length; i++) {
      if (SKINS[i].id === state.skin) {
        window.orosAppTheme = { accent: SKINS[i].color };
        break;
      }
    }
    // the "orOS" palette of the "Mine" wallpaper follows the skin
    if (state.wallpaper === "custom" && document.getElementById("oros-desktop")) applyWallpaper();
  }

  // ---------- 5b. Wallpaper ----------
  function applyWallpaper() {
    var w = findWallpaper(state.wallpaper);
    if (!w) { state.wallpaper = DEFAULT_WALLPAPER; w = findWallpaper(DEFAULT_WALLPAPER); }
    var desktop = document.getElementById("oros-desktop");

    // Inline style: wins over any #oros-desktop background rule
    // (specificity-proof — the v0.4.0 class-based approach lost to
    // the existing ID rule).
    if (w.id === "custom") wpCustomApply(desktop);
    else { wpCustomStop(); desktop.style.background = w.css; }

    // Keep the class for potential future hooks, cleaned of stale ids
    var classes = desktop.className.split(/\s+/);
    for (var i = 0; i < classes.length; i++) {
      if (classes[i].indexOf("wp-") === 0) desktop.classList.remove(classes[i]);
    }
    desktop.classList.add("wp-" + state.wallpaper);
  }

  // ---------- 5b'. "Mine" — the Wallpaper Generator wallpaper ----------
  // The recipe (a few bytes) syncs in the shell slice (field wpart);
  // every device draws it at ITS screen size with the shared
  // renderer (wallpaper/art.js) and keeps the picture in its own
  // IndexedDB ("oros-wallpaper"), never in localStorage (R30) and
  // never on the Files disk (that one syncs file by file). Redrawn
  // only when the picture changes: another recipe, another screen
  // size, or another skin colour for the "orOS" palette.
  var WP_ART_KEY = "oros-wallpaper-art";
  var WP_MAX_SIDE = 3840;
  var wpShown = null;        // { key, w, h, url } of the picture on the desktop
  var wpGen = 0;             // newer request = older drawing is dropped

  function wpArt() { return window.OrosWallArt || null; }

  function wpArtRead() {
    var A = wpArt();
    if (!A) return null;
    try { return A.normRecipe(JSON.parse(localStorage.getItem(WP_ART_KEY))); }
    catch (e) { return null; }
  }

  function wpArtWrite(r) {
    try {
      if (r) localStorage.setItem(WP_ART_KEY, JSON.stringify(r));
      else localStorage.removeItem(WP_ART_KEY);
    } catch (e) {}
  }

  function wpAccent() {
    for (var i = 0; i < SKINS.length; i++) {
      if (SKINS[i].id === state.skin) return SKINS[i].color;
    }
    return "#d4af37";
  }

  // This screen in device pixels, long side capped (cover scaling
  // hides the rest).
  function wpScreen() {
    var dpr = window.devicePixelRatio || 1;
    var w = Math.max(1, Math.round(window.innerWidth * dpr));
    var h = Math.max(1, Math.round(window.innerHeight * dpr));
    var k = Math.min(1, WP_MAX_SIDE / Math.max(w, h));
    return { w: Math.max(64, Math.round(w * k)), h: Math.max(64, Math.round(h * k)) };
  }

  function wpDb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open("oros-wallpaper", 1);
      req.onupgradeneeded = function () { req.result.createObjectStore("img"); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror   = function () { reject(req.error); };
    });
  }
  function wpCacheGet() {
    return wpDb().then(function (db) {
      return new Promise(function (resolve) {
        var req = db.transaction("img").objectStore("img").get("desktop");
        req.onsuccess = function () { db.close(); resolve(req.result || null); };
        req.onerror   = function () { db.close(); resolve(null); };
      });
    }).catch(function () { return null; });
  }
  function wpCachePut(rec) {
    return wpDb().then(function (db) {
      var tx = db.transaction("img", "readwrite");
      tx.objectStore("img").put(rec, "desktop");
      tx.oncomplete = tx.onerror = function () { db.close(); };
    }).catch(function () {});
  }

  function wpBg(css, url) {
    return url ? 'url("' + url + '") center / cover no-repeat, ' + css : css;
  }

  function wpShow(desktop, rec, bgCss) {
    var url = URL.createObjectURL(rec.blob);
    if (wpShown && wpShown.url) URL.revokeObjectURL(wpShown.url);
    wpShown = { key: rec.key, w: rec.w, h: rec.h, url: url };
    desktop.style.background = wpBg(bgCss, url);
    var th = document.querySelector(".wp-thumb.wp-custom");   // menu open: refresh in place
    if (th && !th.classList.contains("wp-make")) th.style.background = wpBg(bgCss, url);
  }

  // Close enough = same picture at a size within 12% (cover scaling).
  function wpFits(rec, key, scr) {
    return !!rec && rec.key === key &&
      Math.abs(rec.w - scr.w) <= scr.w * 0.12 && Math.abs(rec.h - scr.h) <= scr.h * 0.12;
  }

  function wpCustomStop() {
    wpGen++;
    if (wpShown && wpShown.url) URL.revokeObjectURL(wpShown.url);
    wpShown = null;
  }

  function wpCustomApply(desktop) {
    var A = wpArt(), r = state.wpart;
    if (!A || !r) {                       // nothing drawn yet: the default look
      wpCustomStop();
      desktop.style.background = findWallpaper(DEFAULT_WALLPAPER).css;
      return;
    }
    var acc = wpAccent();
    var key = A.key(r, acc), scr = wpScreen();
    var bgCss = A.colors(r, acc).bg;
    if (wpFits(wpShown, key, scr)) {      // already on screen
      desktop.style.background = wpBg(bgCss, wpShown.url);
      return;
    }
    var gen = ++wpGen;
    // Until the picture is ready: the old one if it is the same
    // recipe, else the recipe's background colour.
    desktop.style.background = (wpShown && wpShown.key === key) ? wpBg(bgCss, wpShown.url) : bgCss;
    wpCacheGet().then(function (rec) {
      if (gen !== wpGen) return null;
      if (wpFits(rec, key, scr) && rec.blob) { wpShow(desktop, rec, bgCss); return null; }
      var cv = document.createElement("canvas");
      cv.width = scr.w; cv.height = scr.h;
      var ctx = cv.getContext("2d");
      if (!ctx) return null;
      return A.render(ctx, scr.w, scr.h, r, {
        accent: acc,
        cancelled: function () { return gen !== wpGen; }
      }).then(function (done) {
        if (!done) return;
        return new Promise(function (resolve) {
          cv.toBlob(function (blob) {
            cv.width = cv.height = 0;
            if (!blob || gen !== wpGen) { resolve(); return; }
            var fresh = { key: key, w: scr.w, h: scr.h, blob: blob };
            wpShow(desktop, fresh, bgCss);
            wpCachePut(fresh).then(resolve);
          }, "image/png");
        });
      });
    }).catch(function (e) {
      console.warn("[orOS] custom wallpaper:", e);
    });
  }

  // Public API for the Wallpaper Generator app (same origin iframe).
  window.orosWallpaper = {
    // recipe → the "Mine" wallpaper, selected. User action: syncs.
    setCustom: function (recipe) {
      var A = wpArt();
      var r = A ? A.normRecipe(recipe) : null;
      if (!r) return false;
      state.wpart = r;
      wpArtWrite(r);
      state.wallpaper = "custom";
      localStorage.setItem("oros-wallpaper", state.wallpaper);
      applyWallpaper();
      noteLocalChange();          // user action → sync engine
      return true;
    },
    get: function () {
      return { active: state.wallpaper === "custom", recipe: state.wpart };
    }
  };

  // Another screen size (rotation, window resize): redraw if needed.
  (function () {
    var t = null;
    window.addEventListener("resize", function () {
      if (state.wallpaper !== "custom") return;
      clearTimeout(t);
      t = setTimeout(applyWallpaper, 700);
    });
  })();

  // Suggest, don't impose: when the user picks a skin with a classic
  // wallpaper pair AND is still on the default wallpaper, the
  // wallpaper follows the skin. Never overrides a deliberate choice.
  function maybeFollowSkin(newSkinId) {
    if (state.wallpaper !== DEFAULT_WALLPAPER) return false;
    for (var i = 0; i < WALLPAPERS.length; i++) {
      if (WALLPAPERS[i].pair === newSkinId) {
        state.wallpaper = WALLPAPERS[i].id;
        localStorage.setItem("oros-wallpaper", state.wallpaper);
        applyWallpaper();
        return true;
      }
    }
    return false;
  }

  // ---------- 5c. Auto-backup scheduler (folder export) ----------
  // Schedule check happens at boot and whenever the tab becomes
  // visible (NO background timers). "Off" = zero footprint: no
  // key writes, nothing. localStorage snapshots are RETIRED — the
  // ONLY destination is the user-chosen backup folder (5d). No
  // folder chosen → the check stamps AUTOEXPORT_LAST and stays
  // silent: honest silence, never a false "saved".

  // Export body captured NOW — the same shape writeBackupFile
  // serializes into the real file.
  // The folder backup carries the Files disk too (FILES-V: the disk
  // is no longer part of what exportData() returns).
  function exportBodyFull() {
    return fdAttachDisk(exportBodyNow());
  }

  function exportBodyNow() {
    var payload = JSON.parse(window.orosSync.exportData());
    return {
      shell:  payload.shell || null,
      apps:   payload.apps || {},
      at:     new Date().toISOString(),
      source: "auto-export"
    };
  }

  // Period check + folder export. "force" = run regardless of the
  // last check (used when the user switches the mode on, so
  // enabling Daily instantly produces the first file).
  // Returns TRUE when an export was DISPATCHED, FALSE on every
  // no-op path (schedule guard, missing engine). The write itself
  // is async best-effort: the "saved" confirmation fires ONLY when
  // the file actually landed (inside writeBackupFile).
  function maybeAutoExport(force) {
    if (state.autoexport === "off") return false;
    if (!window.orosSync || typeof window.orosSync.exportData !== "function") return false;

    var period = AUTOEXPORT_PERIODS[state.autoexport];
    if (!period) return false;

    var last = parseInt(localStorage.getItem(AUTOEXPORT_LAST) || "0", 10) || 0;
    if (!force && (Date.now() - last) < period) return false;

    // Check happened now — record it even if no file follows
    // (no folder chosen must not re-check on every tab-visible).
    localStorage.setItem(AUTOEXPORT_LAST, String(Date.now()));

    // Body capture is best-effort: an engine hiccup must not turn
    // the boot/visibility path into an uncaught async error. Null
    // body → writeBackupFile's own guard skips the write silently.
    var job = null;
    try { job = exportBodyFull(); } catch (e) { job = null; }
    if (job) job.then(function (body) { if (body) writeBackupFile(body, false); })
                .catch(function () {});
    return true;
  }
  
    // ---------- 5d. Backup folder (File System Access API) ----------
  // Progressive enhancement: on Chromium desktop every auto-export
  // ALSO lands as a real JSON file in a user-chosen folder, built
  // LIVE via exportBodyNow() (localStorage snapshots are retired).
  // Where the API is absent (Firefox/Safari/all mobile browsers)
  // nothing changes: the folder UI row is never rendered.
  //
  // Permission lifecycle (v0.12.2): the browser can revoke the
  // folder permission. Detection happens naturally — every write
  // queries the permission first. On a revoked-but-chosen folder we
  // arm the FS_LAPSED_KEY flag: the sync section shows ⚠ + a
  // "Reconnect" button. Re-granting REQUIRES a click (user
  // activation) — reconnectFolder is the only legal place to ask.

  function fsSupported() {
    return typeof window.showDirectoryPicker === "function";
  }

  function openFsDb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open("oros-fs", 1);
      req.onupgradeneeded = function () {
        req.result.createObjectStore("handles");
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror   = function () { reject(req.error); };
    });
  }

  function idbFsGet(db, key) {
    return new Promise(function (resolve, reject) {
      var req = db.transaction("handles").objectStore("handles").get(key);
      req.onsuccess = function () { resolve(req.result || null); };
      req.onerror   = function () { reject(req.error); };
    });
  }

  function saveFolderHandle(handle) {
    return openFsDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction("handles", "readwrite");
        tx.objectStore("handles").put(handle, "backup-folder");
        tx.oncomplete = function () { resolve(); };
        tx.onerror    = function () { reject(tx.error); };
      });
    });
  }

  function loadFolderHandle() {
    return openFsDb()
      .then(function (db) { return idbFsGet(db, "backup-folder"); })
      .catch(function () { return null; });
  }

  function clearFolderHandle() {
    return openFsDb().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction("handles", "readwrite");
        tx.objectStore("handles").delete("backup-folder");
        tx.oncomplete = function () { resolve(); };
        tx.onerror    = function () { resolve(); };
      });
    }).catch(function () {});
  }

  // Writes an export body as a real file. Auto path (manual=false,
  // fed by maybeAutoExport): the body captured at dispatch time.
  // Manual path (manual=true, from Choose/Reconnect buttons): the
  // same body captured NOW, so the user instantly sees proof it
  // works. No localStorage snapshot dependency anywhere.
  function writeBackupFile(body, manual) {
    if (!fsSupported() || !body) return;
    loadFolderHandle().then(function (handle) {
      if (!handle) return;
      return handle.queryPermission({ mode: "readwrite" }).then(function (perm) {
        if (perm !== "granted") {
          // Folder chosen, permission REVOKED by the browser. Not
          // silent anymore: arm the flag → sync section shows ⚠ +
          // Reconnect. requestPermission needs a click — we never
          // nag from a timer; detection + visibility is all we do.
          localStorage.setItem(FS_LAPSED_KEY, "1");
          return;
        }
        // Healthy path: permission granted — make sure no stale
        // ⚠ lingers (e.g. browser re-granted on its own, or this is
        // the first write after a successful Reconnect).
        localStorage.removeItem(FS_LAPSED_KEY);

        // Real file → meta belongs in it
        var filePayload = {
          shell: body.shell,
          apps:  body.apps,
          meta:  { ver: 1, exportedAt: body.at, source: body.source || "auto-export" }
        };
        var name = "orOS-backup-" + String(body.at).slice(0, 10) + ".json";
        return handle.getFileHandle(name, { create: true })
          .then(function (fh) { return fh.createWritable(); })
          .then(function (stream) {
            // SH-B5: write() is async. Close only after it settled, so
            // a failed write rejects THIS chain instead of escaping as
            // an unhandled rejection next to a "saved" message.
            return stream.write(JSON.stringify(filePayload, null, 2))
              .then(function () { return stream.close(); });
          })
          .then(function () {
            setSyncMsg("ok", "sync.ok.fsfolder.saved");
          });
      });
    }).catch(function () {
      // Best-effort — the sync engine data stays intact. SH-B5: forget
      // the schedule stamp, so the next boot / tab-visible check tries
      // again instead of waiting out a whole day/week/month.
      try { localStorage.removeItem(AUTOEXPORT_LAST); } catch (e) {}
    });
}

  function chooseBackupFolder() {
    // MUST run inside the click handler (user activation required)
    window.showDirectoryPicker({ id: "oros-backups", mode: "readwrite" })
      .then(function (handle) {
        localStorage.setItem(FS_FOLDER_NAME_KEY, handle.name);
        return saveFolderHandle(handle);
      })
      .then(function () {
        // Fresh grant — never inherit a stale ⚠ from a previous
        // permission lifetime.
        localStorage.removeItem(FS_LAPSED_KEY);

        // Folder writes are LIVE exports — without a mode there is
        // no scheduler to write them. Tell the user instead of
        // failing silently.
        if (state.autoexport === "off") {
          setSyncMsgRaw("dim", window.t("sync.fsfolder.enablefirst"));
          renderMenu();
          return;
        }
        // Instant proof: capture the current database and write it
        // to the freshly chosen folder right now.
        return exportBodyFull().then(function (body) { return writeBackupFile(body, true); });
      })
      .catch(function () { /* user cancelled the picker — no drama */ });
  }

  function stopFolderBackups() {
    localStorage.removeItem(FS_FOLDER_NAME_KEY);
    localStorage.removeItem(FS_LAPSED_KEY);   // ⚠ only ever refers to a chosen folder
    clearFolderHandle().then(function () { renderMenu(); });
  }

  // Permission lapsed (browser revoked it). One click re-grants:
  // requestPermission is legal exactly here — inside a click handler,
  // i.e. user activation. On success: flag down + instant manual
  // write as proof of recovery. On decline: flag stays up (the ⚠
  // keeps reminding on the next visit), nothing breaks, nothing
  // is lost.
  function reconnectFolder() {
    loadFolderHandle().then(function (handle) {
      if (!handle) {
        // Handle vanished (shouldn't happen, but be safe): reset UI
        // to the Choose state and drop the orphaned flag.
        localStorage.removeItem(FS_FOLDER_NAME_KEY);
        localStorage.removeItem(FS_LAPSED_KEY);
        renderMenu();
        return;
      }
      return handle.requestPermission({ mode: "readwrite" })
        .then(function (perm) {
          if (perm === "granted") {
            localStorage.removeItem(FS_LAPSED_KEY);
            return exportBodyFull().then(function (body) { return writeBackupFile(body, true); });   // instant proof of recovery
          }
          // Declined: keep the flag — ⚠ stays. No nagging beyond this.
        });
    }).catch(function () { /* request failed — flag stays, retry next click */ });
  }
  
    // ---------- 6. Clock (24h) ----------
  // Taskbar fit (2026-10-09): every chip (sync dot, weather, bell,
  // radio, …) shares one row with the clock. On a phone the date used
  // to be pushed off the right edge. fitBar() picks the FIRST level
  // that fits, measured on the real bar:
  //   0 full date · 1 no year · 2 tighter paddings/gaps ·
  //   3 no weekday · 4 numeric dd/mm · 5 menu label hidden (icon
  //   stays) · 6 date hidden (the time button's tooltip carries it).
  // Re-run by a ResizeObserver on the bar (a chip appears, the text
  // changes width, rotation), never per tick.
  var barFit = 0;
  var BAR_FIT_MAX = 6;

  function barDateStr(now, lvl) {
    var loc = state.lang === "el" ? "el-GR" : "en-GB";
    if (lvl >= 4) {
      return String(now.getDate()).padStart(2, "0") + "/" +
             String(now.getMonth() + 1).padStart(2, "0");
    }
    var opts = { day: "2-digit", month: "short" };
    if (lvl < 3) opts.weekday = "short";
    if (lvl < 1) opts.year = "numeric";
    return now.toLocaleDateString(loc, opts).replace(/,/g, "");
  }

  function paintBarDate(now) {
    var dBtn = document.getElementById("bar-date");
    var tBtn = document.getElementById("bar-time");
    if (!dBtn || !tBtn) return;
    var txt = barDateStr(now, barFit);
    if (dBtn.textContent !== txt) dBtn.textContent = txt;
    var tt = window.t("app.time") +
      (barFit >= BAR_FIT_MAX ? " · " + barDateStr(now, 0) : "");
    if (tBtn.title !== tt) tBtn.title = tt;
  }

  function applyBarFit(lvl) {
    barFit = lvl;
    var bar = document.getElementById("oros-bar");
    bar.classList.toggle("bar-tight", lvl >= 2);
    bar.classList.toggle("bar-nolabel", lvl >= 5);
    bar.classList.toggle("bar-nodate", lvl >= 6);
    paintBarDate(new Date());
  }

  function fitBar() {
    var bar = document.getElementById("oros-bar");
    var left = bar && bar.querySelector(".bar-left");
    var right = bar && bar.querySelector(".bar-right");
    if (!left || !right) return;
    for (var lvl = 0; ; lvl++) {
      applyBarFit(lvl);
      var cs = getComputedStyle(bar);
      var avail = bar.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      var need = left.getBoundingClientRect().width + right.getBoundingClientRect().width + 4;
      if (need <= avail || lvl >= BAR_FIT_MAX) return;
    }
  }

  var barFitQueued = false;
  function queueFitBar() {
    if (barFitQueued) return;
    barFitQueued = true;
    // next frame: never resize inside the observer callback
    // (that is the "ResizeObserver loop" warning)
    requestAnimationFrame(function () { barFitQueued = false; fitBar(); });
  }

  function initBarFit() {
    var bar = document.getElementById("oros-bar");
    if (!bar) return;
    if (typeof ResizeObserver === "function") {
      var ro = new ResizeObserver(queueFitBar);
      ro.observe(bar);
      var l = bar.querySelector(".bar-left"), r = bar.querySelector(".bar-right");
      if (l) ro.observe(l);
      if (r) ro.observe(r);
    } else {
      window.addEventListener("resize", queueFitBar);
    }
    fitBar();
  }

  function renderClock() {
    var now = new Date();
    var hh = String(now.getHours()).padStart(2, "0");
    var mm = String(now.getMinutes()).padStart(2, "0");
    // E1/E2 — split bar: time button (→ Time app) + date button
    // (→ Calendar app). Stale-bundle safety: if #bar-time/#bar-date
    // are absent (cached index.html), paint the legacy #bar-clock.
    var tBtn = document.getElementById("bar-time");
    var dBtn = document.getElementById("bar-date");
    if (tBtn && dBtn) {
      if (tBtn.textContent !== hh + ":" + mm) tBtn.textContent = hh + ":" + mm;
      paintBarDate(now);
      // no ResizeObserver (old browser): refit on the tick instead
      if (typeof ResizeObserver !== "function" && now.getSeconds() === 0) fitBar();
    } else {
      var legacy = document.getElementById("bar-clock");
      if (legacy) legacy.textContent =
        hh + ":" + mm + "  ·  " + barDateStr(now, 1);
    }
    // SH-Q2: every engine runs in its own guard. One that throws
    // (a full store, a malformed record) used to end the WHOLE tick,
    // every second: the engines after it — alarms included — never
    // ran again until reload.
    tickSafe("autoSyncDot", autoSyncDot);     // v0.18.0: piggybacks the clock tick
    tickSafe("wxRenderChip", wxRenderChip);   // v0.18.0: weather chip, cheap paint only
    tickSafe("wxFetchTick", wxFetchTickThrottled); // #6: fetch retry (60s throttle) — a failed
                                // boot fetch no longer sits in "waiting"
                                // until an online/visibility event
    if (enginesMayRun()) {        // SH-B1: see enginesMayRun below
      tickSafe("alarmTick", alarmTick);                  // E1: shell-owned alarm engine tick
      tickSafe("calRemTick", calRemTickThrottled);       // Wave 3: calendar reminders (30s throttle)
      tickSafe("moodCheckInTick", moodCheckInTickThrottled); // Wave 1B: Mood check-in reminder (60s throttle)
      tickSafe("cycleCheckTick", cycleCheckTickThrottled);   // Wave 4: Cycle prediction reminder (60s throttle)
      tickSafe("notifTick", notifTickThrottled);         // Wave 1A: notification sweep (60s throttle)
      tickSafe("syncPendingTick", syncPendingTickThrottled); // SY-D3: "changes waiting for a merge" notice (60s throttle)
      tickSafe("wxBriefTick", wxBriefTickThrottled);     // Weather unification: daily morning briefing (60s throttle)
      tickSafe("quoteCheckTick", quoteCheckTickThrottled); // Wave 13: Quote due-date reminders (60s throttle)
      tickSafe("garageCheckTick", garageCheckTickThrottled); // Garage: renewals + service reminder (60s throttle)
      tickSafe("minimalismCheckTick", minimalismCheckTickThrottled); // Wave 2: Minimalism daily ritual (60s throttle)
      tickSafe("petcareCheckTick", petcareCheckTickThrottled); // Pet Health Book: daily reminder (60s throttle)
      tickSafe("healthCheckTick", healthCheckTickThrottled); // Health: reminder times per measurement (60s throttle)
      tickSafe("waterCheckTick", waterCheckTickThrottled); // Water: behind-the-pace reminder (60s throttle)
      tickSafe("plantsCheckTick", plantsCheckTickThrottled); // Plant Care: daily watering reminder (60s throttle)
      tickSafe("namedayCheckTick", namedayCheckTickThrottled); // Calendar: contacts' name days, morning notice (60s throttle)
    }
    tickSafe("radioTrayTick", radioTrayTick); // Wave 2 Radio: tray chip paint (cheap, 1/s)
  }

  // SH-Q2: one engine's failure is logged once (not 1/s) and never
  // stops the others.
  var tickErrSeen = {};
  function tickSafe(name, fn) {
    try { fn(); }
    catch (e) {
      if (tickErrSeen[name]) return;
      tickErrSeen[name] = true;
      try { console.error("[orOS] clock engine \"" + name + "\" failed:", e); } catch (e2) {}
    }
  }

  // SH-B1: every engine above ends in orosNotifs.emit(), but
  // notifications.js loads AFTER shell.js and the first renderClock()
  // runs during shell boot. That first sweep therefore ran with no
  // module: a calendar reminder due at boot took the legacy overlay
  // (no inbox, no quiet hours, no per-app toggle), and every other
  // engine burned its 60s throttle on a silent return. The engines
  // now start on the first tick where the module reports ready.
  // Stale bundle / module that never becomes ready: they start after
  // a short grace, exactly as before (legacy fallbacks intact).
  var shellBootAt = Date.now();
  var ENGINE_GRACE_MS = 8000;
  function enginesMayRun() {
    var N = window.orosNotifs;
    if (N && typeof N.getState === "function") {
      try { if (N.getState().ready) return true; } catch (e) {}
    }
    return (Date.now() - shellBootAt) > ENGINE_GRACE_MS;
  }

  function quoteCheckTickThrottled() {
    var now = Date.now();
    if (now - (quoteCheckLastTick || 0) < 60000) return;
    quoteCheckLastTick = now;
    quoteCheckTick();
  }
  var quoteCheckLastTick = 0;

  // Wave 2 — Minimalism daily ritual reminder (pattern: Mood
  // check-in). Shell-side scan of "oros-minimalism-data": fires
  // once per day at/after the user's preferred hour (prefs.
  // remindHour, design default 10) while NO entry exists for
  // today on EITHER level. A skip counts as deliberate
  // engagement — it silences the nudge too (no guilt spam).
  // Days with no entries are transparent by design; the ritual
  // whisper is ONE notification, never a penalty. Suppressible
  // via the "minimalism" per-app toggle + quiet hours (unified
  // notification system). deepLink "minimalism:today:<ymd>"
  // routes through the notifications.js bridge → the shell's
  // __orosOpenMinimalism opens the app on that exact date.
  var MINIMALISM_DATA_KEY = "oros-minimalism-data";

  function minT(en, el) {
    return state.lang === "el" ? el : en;
  }

  function minimalismHasToday() {
    var today = sysYmd();
    var raw;
    try { raw = JSON.parse(localStorage.getItem(MINIMALISM_DATA_KEY)); }
    catch (e) { return false; }
    if (!raw || !Array.isArray(raw.days)) return false;
    for (var i = 0; i < raw.days.length; i++) {
      var e = raw.days[i];
      if (e && e.date === today &&
          (e.status === "done" || e.status === "skip")) return true;
    }
    return false;
  }

  // Prefs live in the app's slice; read defensively — a fresh
  // install has no data yet, the design default (10:00) stands.
  function minimalismPrefHour() {
    try {
      var raw = JSON.parse(localStorage.getItem(MINIMALISM_DATA_KEY));
      if (raw && raw.prefs && typeof raw.prefs.remindHour === "number" &&
          raw.prefs.remindHour >= 0 && raw.prefs.remindHour <= 23) {
        return raw.prefs.remindHour;
      }
    } catch (e) {}
    return 10;
  }

  // SH-B7 (owner decision 2026-10-05): same rule as Mood — the ritual
  // whisper starts only after the first day record (done or skip).
  function minimalismHasAnyDay() {
    try {
      var raw = JSON.parse(localStorage.getItem(MINIMALISM_DATA_KEY));
      return !!(raw && Array.isArray(raw.days) && raw.days.length > 0);
    } catch (e) { return false; }
  }

  function minimalismCheckTick() {
    if (!minimalismHasAnyDay()) return;   // SH-B7: app never used — silent
    if (minimalismHasToday()) return;   // engaged today — silent
    if (new Date().getHours() < minimalismPrefHour()) return;
    var N = window.orosNotifs;
    if (!(N && typeof N.emit === "function")) return;   // stale bundle — silent
    var today = sysYmd();
    N.emit({
      ns: "minimalism",
      key: "ritual-" + today,
      type: "reminder",
      title: minT("Minimalism", "Μινιμαλισμός"),
      body: minT("A small proposal for your day awaits.",
                 "Μια μικρή πρόταση για τη μέρα σου σε περιμένει."),
      deepLink: "minimalism:today:" + today
    });
  }

  var minimalismLastTick = 0;
  function minimalismCheckTickThrottled() {
    var now = Date.now();
    if (now - minimalismLastTick < 60000) return;
    minimalismLastTick = now;
    minimalismCheckTick();
  }

  // Health — reminder times per measurement. Reads "oros-health-data"
  // directly (works with the app CLOSED) and asks health/core.js
  // (loaded by index.html, the SAME file the app runs) which times are
  // due: from the time on for 4 hours, unless that reading was already
  // taken from one hour before. One notification per kind, day and
  // time; the key is the same on every device (inbox dedup). Hidden
  // kinds never remind. Honest limit (alarms): orOS closed = nothing
  // fires; a time missed by more than 4 hours is dropped, not caught up.
  var HEALTH_DATA_KEY = "oros-health-data";
  var HEALTH_NAMES = {
    bp: ["Blood pressure", "Πίεση"], wt: ["Weight", "Βάρος"], gl: ["Blood sugar", "Σάκχαρο"],
    sl: ["Sleep", "Ύπνος"], hr: ["Resting heart rate", "Σφυγμοί ηρεμίας"],
    tp: ["Temperature", "Θερμοκρασία"], o2: ["Oxygen (SpO₂)", "Οξυγόνο (SpO₂)"]
  };
  function healthCheckTick() {
    var Core = window.OrosHealthCore;
    if (!Core) return;                                  // stale bundle — silent
    var raw;
    try { raw = JSON.parse(localStorage.getItem(HEALTH_DATA_KEY)); } catch (e) { return; }
    if (!raw || !Array.isArray(raw.ty) || !raw.ty.length) return;
    var N = window.orosNotifs;
    if (!(N && typeof N.emit === "function")) return;
    var d = Core.merge(raw, raw);
    var due = Core.dueReminders(d, Date.now());
    if (!due.length) return;
    var el = state.lang === "el";
    var title = window.t("app.health");
    if (title === "app.health") title = "Health";       // missing-key fallback
    due.forEach(function (r) {
      var ty = Core.typeRow(d, r.t);
      var name = HEALTH_NAMES[r.t] ? HEALTH_NAMES[r.t][el ? 1 : 0] : (ty ? ty.n : "");
      var hm = (r.min < 600 ? "0" : "") + Math.floor(r.min / 60) + ":" + (r.min % 60 < 10 ? "0" : "") + (r.min % 60);
      N.emit({
        ns: "health",
        key: r.key,
        type: "reminder",
        title: title,
        body: (el ? "Ώρα για μέτρηση: " : "Time to measure: ") + name + " (" + hm + ")",
        deepLink: "health:" + r.t
      });
    });
  }

  var healthLastTick = 0;
  function healthCheckTickThrottled() {
    var now = Date.now();
    if (now - healthLastTick < 60000) return;
    healthLastTick = now;
    healthCheckTick();
  }

  // Name days — morning notice when a CONTACT celebrates today.
  // Reads "oros-contacts-data" directly (works with Calendar and
  // Contacts CLOSED) and asks calendar/namedays.js (loaded by
  // index.html, the SAME file the Calendar runs) who celebrates.
  // From 09:00, one notice per day; the key is the same on every
  // device (inbox dedup). Silent when the Calendar "Name days" chip
  // is off on this device (oros-cal-feedvis) or no contact matches.
  // Honest limit (alarms): orOS closed = nothing fires; the next boot
  // the same day catches up.
  var ND_HOUR = 9;
  function namedayCheckTick() {
    var ND = window.OrosNamedays;
    if (!ND) return;                                    // stale bundle — silent
    if (new Date().getHours() < ND_HOUR) return;
    try {
      var vis = JSON.parse(localStorage.getItem("oros-cal-feedvis") || "{}");
      if (vis && vis["lbl-feed-nameday"] === false) return;
    } catch (e) {}
    var raw;
    try { raw = JSON.parse(localStorage.getItem("oros-contacts-data")); } catch (e) { return; }
    if (!raw || !Array.isArray(raw.contacts) || !raw.contacts.length) return;
    var N = window.orosNotifs;
    if (!(N && typeof N.emit === "function")) return;
    var today = sysYmd();
    var who = [];
    raw.contacts.forEach(function (c) {
      if (!c || typeof c !== "object" || typeof c.id !== "string") return;
      var first = (typeof c.given === "string" && c.given.trim()) ? c.given
                : (typeof c.nickname === "string" ? c.nickname : "");
      if (!first || !ND.celebrates(first, today)) return;
      var full = [c.given, c.middle, c.family].filter(function (x) {
        return typeof x === "string" && x.trim();
      }).join(" ");
      who.push((full || first).slice(0, 60));
    });
    if (!who.length) return;
    var el = state.lang === "el";
    var shown = who.slice(0, 3).join(", ");
    if (who.length > 3) shown += el ? " και " + (who.length - 3) + " ακόμα" : " and " + (who.length - 3) + " more";
    N.emit({
      ns: "calendar",
      key: "nameday-" + today,
      type: "reminder",
      title: el ? "Ονομαστικές εορτές" : "Name days",
      body: (el ? "Σήμερα γιορτάζει: " : "Name day today: ") + shown,
      deepLink: "calendar:nameday:" + today
    });
  }

  var namedayLastTick = 0;
  function namedayCheckTickThrottled() {
    var now = Date.now();
    if (now - namedayLastTick < 60000) return;
    namedayLastTick = now;
    namedayCheckTick();
  }

  // Garage — renewals (KTEO, insurance, road tax…), service plans and
  // tyres. Reads "oros-garage-data" directly (works with the app
  // CLOSED) and asks garage/core.js (loaded by index.html, the SAME
  // file the app runs) what needs attention. Each alert is announced
  // once per step (30 → 7 → 1 day → expired; service soon → due):
  // device-local "oros-garage-notified" = { alertKey: lowest step
  // announced }. One grouped notification at most per tick, from the
  // reminder hour on (oros-garage-prefs, default 09:00, -1 = off).
  // SH-B7: no vehicles → silent. Honest limit (alarms): orOS closed =
  // nothing fires; the next boot catches up.
  var GARAGE_DATA_KEY = "oros-garage-data";
  var GARAGE_NOTIFIED_KEY = "oros-garage-notified";
  function garageCheckTick() {
    var Core = window.OrosGarageCore;
    if (!Core) return;                                  // stale bundle — silent
    var raw, prefs, notified;
    try {
      raw = JSON.parse(localStorage.getItem(GARAGE_DATA_KEY));
      prefs = Core.readPrefs(JSON.parse(localStorage.getItem("oros-garage-prefs")));
      notified = JSON.parse(localStorage.getItem(GARAGE_NOTIFIED_KEY)) || {};
    } catch (e) { return; }
    if (!raw || !Array.isArray(raw.vehicles) || !raw.vehicles.length) return;
    if (prefs.remind < 0 || new Date().getHours() < prefs.remind) return;
    var N = window.orosNotifs;
    if (!(N && typeof N.emit === "function")) return;
    if (!notified || typeof notified !== "object") notified = {};
    var today = sysYmd();
    var data = Core.merge(raw, raw);
    var all = Core.alerts(data, today, prefs);
    var fresh = Core.toNotify(all, notified);
    // keep the map small: only keys of alerts that still exist
    var next = {};
    all.forEach(function (a) { if (Object.prototype.hasOwnProperty.call(notified, a.key)) next[a.key] = notified[a.key]; });
    fresh.forEach(function (a) { next[a.key] = a.step; });
    try { localStorage.setItem(GARAGE_NOTIFIED_KEY, JSON.stringify(next)); } catch (e) {}
    if (!fresh.length) return;
    var lang = state.lang === "el" ? "el" : "en";
    var lines = fresh.slice(0, 3).map(function (a) { return Core.alertLine(a, data, lang); });
    if (fresh.length > 3) lines.push(lang === "el" ? "και " + (fresh.length - 3) + " ακόμα" : "and " + (fresh.length - 3) + " more");
    var title = window.t("app.garage");
    if (title === "app.garage") title = "Garage";      // missing-key fallback
    N.emit({
      ns: "garage",
      key: "alerts-" + today + "-" + garageHash(fresh.map(function (a) { return a.key + ":" + a.step; }).join("|")),
      type: "reminder",
      title: title,
      body: lines.join(" · "),
      deepLink: "garage:upcoming"
    });
  }

  // Short stable hash (djb2) so the dedup key names exactly this set.
  function garageHash(str) {
    var h = 5381;
    for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  var garageLastTick = 0;
  function garageCheckTickThrottled() {
    var now = Date.now();
    if (now - garageLastTick < 60000) return;
    garageLastTick = now;
    garageCheckTick();
  }

  // Pet Health Book — daily reminder. Reads "oros-petcare-data"
  // directly (works with the app CLOSED) and asks petcare/core.js
  // (loaded by index.html, the SAME file the app runs) what to
  // announce: each due date once ahead (device-local "days before",
  // default 7; food 5; routine care and the end of a medicine course
  // on the day), once when due, again weekly while overdue. The
  // device-local map oros-petcare-fired remembers what was said, so
  // nothing repeats daily. One grouped notification per batch, from
  // the device-local hour on (oros-petcare-prefs, default 09:00,
  // -1 = off). SH-B7: no pets → silent.
  // Honest limit (alarms): orOS closed = nothing fires; it comes at
  // the next open.
  var PETCARE_DATA_KEY = "oros-petcare-data";
  var PETCARE_FIRED_KEY = "oros-petcare-fired";
  function petcareCheckTick() {
    var Core = window.OrosPetcareCore;
    if (!Core) return;                                  // stale bundle — silent
    var raw, prefs, fired;
    try {
      raw = JSON.parse(localStorage.getItem(PETCARE_DATA_KEY));
      prefs = Core.readPrefs(JSON.parse(localStorage.getItem("oros-petcare-prefs")));
      fired = JSON.parse(localStorage.getItem(PETCARE_FIRED_KEY) || "{}");
    } catch (e) { return; }
    if (!raw || !Array.isArray(raw.pets) || !raw.pets.length) return;
    if (prefs.remind < 0 || new Date().getHours() < prefs.remind) return;
    var N = window.orosNotifs;
    if (!(N && typeof N.emit === "function" && typeof N.getState === "function")) return;
    try { if (!N.getState().ready) return; } catch (e) { return; }
    var today = sysYmd();
    var res = Core.reminders(Core.merge(raw, raw), today, prefs.lead, fired);
    var same = JSON.stringify(res.fired) === JSON.stringify(fired);
    if (!same) { try { localStorage.setItem(PETCARE_FIRED_KEY, JSON.stringify(res.fired)); } catch (e) {} }
    if (!res.items.length) return;
    var el = state.lang === "el";
    var CARE = el
      ? { bath: "μπάνιο", nails: "νύχια", brush: "βούρτσισμα", teeth: "δόντια", ears: "αυτιά", litter: "άμμος", cage: "κλουβί", tank: "ενυδρείο" }
      : { bath: "bath", nails: "nail trim", brush: "brushing", teeth: "teeth", ears: "ears", litter: "litter", cage: "cage", tank: "tank" };
    function what(it) {
      if (it.kind === "vacc") return it.label;
      if (it.kind === "deworm") return el ? "αποπαρασίτωση" : "deworming";
      if (it.kind === "visit") return el ? "επανεξέταση" : "recheck";
      if (it.kind === "med") return (el ? "τέλος: " : "last day: ") + it.label;
      if (it.kind === "care") return CARE[it.sub] || it.sub;
      return el ? "τελειώνει η τροφή" : "food runs out";
    }
    function when(d) {
      if (d === 0) return el ? "σήμερα" : "today";
      if (d === 1) return el ? "αύριο" : "tomorrow";
      if (d > 1) return el ? "σε " + d + " μέρες" : "in " + d + " days";
      return el ? (-d) + (d === -1 ? " μέρα πίσω" : " μέρες πίσω") : (-d) + (d === -1 ? " day late" : " days late");
    }
    var parts = res.items.slice(0, 4).map(function (it) {
      return it.pet.name + ": " + what(it) + " " + when(it.diff);
    });
    if (res.items.length > 4) parts.push(el ? "και " + (res.items.length - 4) + " ακόμα" : "and " + (res.items.length - 4) + " more");
    var title = window.t("app.petcare");
    if (title === "app.petcare") title = "Pet Health Book";   // missing-key fallback
    // Key = today + what this batch says: a second batch the same day
    // (a new due date) still shows; two devices saying the same thing
    // dedupe through the synced inbox.
    var sig = res.items.map(function (it) { return it.key + "@" + it.due; }).join("|"), h = 0;
    for (var i = 0; i < sig.length; i++) h = (h * 31 + sig.charCodeAt(i)) | 0;
    N.emit({
      ns: "petcare",
      key: "due-" + today + "-" + (h >>> 0).toString(36),
      type: "reminder",
      title: title,
      body: parts.join(" · "),
      deepLink: "petcare:today"
    });
  }

  var petcareLastTick = 0;
  function petcareCheckTickThrottled() {
    var now = Date.now();
    if (now - petcareLastTick < 60000) return;
    petcareLastTick = now;
    petcareCheckTick();
  }

  // Plant Care — daily watering reminder. Reads "oros-plants-data"
  // directly (works with the app CLOSED) and asks plants/core.js
  // (loaded by index.html, the SAME file the app runs) what is due
  // today or late: one grouped notification per day, from the
  // device-local reminder hour on (oros-plants-prefs, default 09:00,
  // -1 = off). Weather: a rain hint for outdoor plants from the
  // Weather app's cache, no network. SH-B7: no plants → silent.
  // Honest limit (alarms): orOS closed = nothing fires; the inbox
  // catch-up runs at the next boot.
  var PLANTS_DATA_KEY = "oros-plants-data";
  function plantsCheckTick() {
    var Core = window.OrosPlantsCore;
    if (!Core) return;                                  // stale bundle — silent
    var raw, prefs;
    try {
      raw = JSON.parse(localStorage.getItem(PLANTS_DATA_KEY));
      prefs = Core.readPrefs(JSON.parse(localStorage.getItem("oros-plants-prefs")));
    } catch (e) { return; }
    if (!raw || !Array.isArray(raw.plants) || !raw.plants.length) return;
    if (prefs.remind < 0 || new Date().getHours() < prefs.remind) return;
    var N = window.orosNotifs;
    if (!(N && typeof N.emit === "function")) return;
    var today = sysYmd();
    var sum = Core.summary(Core.merge(raw, raw), today, prefs.hemi);
    if (!sum.n) return;
    var el = state.lang === "el";
    var names = sum.names.slice(0, 3).join(", ");
    if (sum.names.length > 3) names += el ? " και " + (sum.names.length - 3) + " ακόμα"
                                          : " and " + (sum.names.length - 3) + " more";
    var body = (el ? (sum.names.length === 1 ? "Θέλει φροντίδα: " : "Θέλουν φροντίδα: ")
                   : (sum.names.length === 1 ? "Needs care: " : "Need care: ")) + names;
    if (sum.outWater) {
      var wx = null;
      try {
        wx = Core.weather(JSON.parse(localStorage.getItem("oros-weatherapp-data")),
                          JSON.parse(localStorage.getItem("oros-weatherapp-cache")),
                          wxRead(), today, Date.now());
      } catch (e) {}
      if (wx && wx.rain) body += el ? ". Βροχή σήμερα: τα εξωτερικά ίσως δεν θέλουν πότισμα."
                                    : ". Rain today: outdoor plants may not need water.";
    }
    var title = window.t("app.plants");
    if (title === "app.plants") title = "Plant Care";    // missing-key fallback
    N.emit({
      ns: "plants",
      key: "due-" + today,
      type: "reminder",
      title: title,
      body: body,
      deepLink: "plants:today"
    });
  }

  var plantsLastTick = 0;
  function plantsCheckTickThrottled() {
    var now = Date.now();
    if (now - plantsLastTick < 60000) return;
    plantsLastTick = now;
    plantsCheckTick();
  }

  // Water — "behind the pace" reminder (off by default; the app's
  // switch turns it on). The RULE lives in water/core.js, loaded by
  // index.html before this file and shared with the app and its
  // tests; the shell owns timing + emission over oros-water-data
  // (same origin), so it works with the app closed. Dedupe key =
  // day + interval slot (core.reminderDue). A stale index.html
  // without core.js → silent.
  var waterLastTick = 0;
  function waterCheckTickThrottled() {
    var now = Date.now();
    if (now - waterLastTick < 60000) return;
    waterLastTick = now;
    waterCheckTick();
  }
  function waterCheckTick() {
    var W = window.orosWaterCore, N = window.orosNotifs;
    if (!W || typeof W.reminderDue !== "function") return;
    if (!(N && typeof N.emit === "function")) return;
    var data = null;
    try { data = W.parse(localStorage.getItem(W.STORAGE_KEY)); } catch (e) { return; }
    if (!data) return;                     // unreadable: the app keeps the rescue copy
    var due = W.reminderDue(data, new Date());
    if (!due) return;
    var txt = W.reminderText(due, data.prefs, state.lang === "el" ? "el" : "en");
    N.emit({
      ns: "water",
      key: due.key,
      type: "reminder",
      title: txt.title,
      body: txt.body,
      deepLink: "system:open:water"
    });
  }


  // ---------- 7. PWA ----------
  function setupInstallFlow() {
    window.addEventListener("beforeinstallprompt", function (e) {
      e.preventDefault();
      state.deferredPrompt = e;
      renderMenu();
    });

    window.addEventListener("appinstalled", function () {
      state.deferredPrompt = null;
      renderMenu();
    });
  }

  // Silent-update visual confirmation: if the running version differs
  // from the last one the user SAW (SW activated while the app was
  // closed — no chance for the update toast), greet them briefly.
  function checkVersionToast() {
    var last = localStorage.getItem(VERSION_KEY);

    if (last === null) {
      localStorage.setItem(VERSION_KEY, APP_VERSION);
      tourFirstRun();   // new user: the top-bar tour, once
      return;
    }
    if (last === APP_VERSION) return;

    localStorage.setItem(VERSION_KEY, APP_VERSION);

    // Wave 6 — update notice rides the unified system: inbox + badge
    // + toast + (permission granted) OS notification. The old
    // #version-toast DOM stays ONLY as the stale-bundle fallback —
    // hence scToast's stacking hack for it is kept too.
    // IN-3: module present but init still pending (retry loop)?
    // Fall through to the legacy toast — the notice is never lost.
    if (window.orosNotifs &&
        typeof window.orosNotifs.emit === "function" &&
        typeof window.orosNotifs.getState === "function" &&
        window.orosNotifs.getState().ready) {
      window.orosNotifs.emit({
        ns: "system",
        key: "ver-" + APP_VERSION,
        type: "update",
        title: window.t("update.done"),
        body: "v" + APP_VERSION,
        deepLink: "help:whatsnew"   // Help → "What's new" (no-op without Help)
      });
      return;
    }

    var vt = document.createElement("div");
    vt.id = "version-toast";
    vt.setAttribute("role", "status");
    vt.innerHTML =
      "<span>" + window.t("update.done") + "</span>" +
      "<strong>v" + APP_VERSION + "</strong>";
    document.body.appendChild(vt);

    requestAnimationFrame(function () { vt.classList.add("show"); });

    var gone = false;
    function dismiss() {
      if (gone) return;
      gone = true;
      vt.classList.remove("show");
      setTimeout(function () { vt.remove(); }, 450);
    }
    vt.addEventListener("click", dismiss);
    setTimeout(dismiss, 4000);
  }

  // Install row (menu). Update flow: NONE — the inline broker in
  // index.html owns the whole SW lifecycle (skipWaiting +
  // controllerchange auto-reload). This row is install-only.
  function renderInstallRow(host) {
    if (!state.deferredPrompt) return;

    var section = document.createElement("div");
    section.className = "install-section";

    var row = document.createElement("button");
    row.className = "menu-item install-row";
    row.innerHTML = DOWNLOAD_ICON_SVG + "<span>" + window.t("install.trigger") + "</span>";
    row.addEventListener("click", function () {
      if (!state.deferredPrompt) return;
      state.deferredPrompt.prompt();
      state.deferredPrompt.userChoice.then(function (choice) {
        if (choice.outcome === "accepted") {
          state.deferredPrompt = null;
          renderMenu();
        }
      });
    });
    section.appendChild(row);
    host.appendChild(section);
  }

  // ---------- 8. Apps loading & menu ----------
  function loadApps() {
    fetch("apps.json")
      .then(function (r) { return r.json(); })
      .then(function (data) {
        state.apps = (data && Array.isArray(data.apps)) ? data.apps : [];
        renderMenu();
        helpBtnRefresh();
        openFromLaunchParam();
        deliverShare();
      })
      .catch(function () {
        state.apps = [];
        renderMenu();
        helpBtnRefresh();
      });
  }

  // Launch shortcuts (manifest "shortcuts", long-press on the app
  // icon): "/?open=<id>" opens that app once the list is loaded. The
  // id must match a registered internal app, so a crafted link can only
  // open what the menu already offers. The parameter is stripped right
  // away (other parameters stay), so a reload or the update broker's
  // reload lands on the desktop instead of reopening the app.
  function openFromLaunchParam() {
    var params, id, i;
    try { params = new URLSearchParams(window.location.search); } catch (e) { return; }
    id = params.get("open");
    if (!id) return;
    params.delete("open");
    try {
      var qs = params.toString();
      window.history.replaceState(null, "", window.location.pathname + (qs ? "?" + qs : "") + window.location.hash);
    } catch (e) {}
    for (i = 0; i < state.apps.length; i++) {
      if (state.apps[i].id === id && state.apps[i].type !== "external") {
        openAppById(id);
        return;
      }
    }
  }

  // Collapsible menu categories — SESSION state only (A74): every
  // boot starts with ALL categories collapsed; opening an app keeps
  // the menu exactly as it was left (this map lives in memory, not in
  // storage). Keys are the LOWERCASE category (SH-B11). Never synced,
  // never dirty. The old persisted map (oros-menu-cat-collapsed) is
  // dropped once at boot so it cannot linger on the device.
  var menuCatOpen = {};
  try { localStorage.removeItem("oros-menu-cat-collapsed"); } catch (e) {}

  // Quick app search (A74): the query also lives in memory only, so a
  // background re-render (sync, install prompt) never wipes it.
  var menuQuery = "";
  // Case- and accent-insensitive ("ημερολογιο" finds "Ημερολόγιο").
  function menuFold(s) {
    s = String(s || "").toLowerCase();
    try { s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (e) {}
    return s.replace(/ς/g, "σ");
  }

  // ---------- Universal search (search.js core + per-app providers) ----------
  // The A74 field also searches the apps' own data. search.js finds
  // and ranks; this part draws. Providers (<app>/search.js, declared
  // in apps.json as "search") load on the first search, never at
  // boot. Results, expanded groups and the query live in memory only;
  // the per-app on/off switches are DEVICE-LOCAL (oros-search-prefs,
  // never synced): { off: { id: true }, on: { id: true } }. An app
  // whose apps.json entry says "searchOff": true starts switched off.
  var SEARCH_PREFS_KEY = "oros-search-prefs";
  var SEARCH_SHOWN = 3;            // hits per app before "All (n)"
  var searchRes = { q: null, groups: null, pending: false, at: 0 };
  var searchExpanded = {};
  var searchTimer = null, searchToken = 0;
  var searchReader = null;
  var searchToggleOpen = false;    // the menu's "Search in" box

  function searchPrefs() {
    var p = null;
    try { p = JSON.parse(localStorage.getItem(SEARCH_PREFS_KEY)); } catch (e) {}
    if (!p || typeof p !== "object") p = {};
    if (!p.off || typeof p.off !== "object") p.off = {};
    if (!p.on || typeof p.on !== "object") p.on = {};
    return p;
  }
  function searchApps() {
    return state.apps.filter(function (a) {
      return a && a.type === "internal" && typeof a.search === "string";
    });
  }
  function searchEnabled(id) {
    var p = searchPrefs();
    if (p.off[id]) return false;
    if (p.on[id]) return true;
    for (var i = 0; i < state.apps.length; i++) {
      if (state.apps[i].id === id) return state.apps[i].searchOff !== true;
    }
    return false;
  }
  function setSearchEnabled(id, on) {
    var p = searchPrefs();
    delete p.off[id]; delete p.on[id];
    (on ? p.on : p.off)[id] = true;
    try { localStorage.setItem(SEARCH_PREFS_KEY, JSON.stringify(p)); } catch (e) {}
    searchRes = { q: null, groups: null, pending: false };
  }
  function searchProvider(id) {
    var list = window.orosSearchProviders || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === id) return list[i];
    return null;
  }

  // Generic deep link (universal search; any app may use it). The
  // target is a small JSON value. App running → live push into its
  // window.__orosOpenAt(target); otherwise staged in sessionStorage
  // ("oros-open-at", device-local, never synced) and the app takes it
  // at boot with window.parent.__orosTakeTarget("<id>"). An app that
  // does not take it simply opens — nothing breaks.
  window.__orosOpenAt = function (appId, target) {
    appId = String(appId || "");
    var app = null;
    for (var i = 0; i < state.apps.length; i++) {
      if (state.apps[i].id === appId) { app = state.apps[i]; break; }
    }
    if (!app || app.type !== "internal") return;
    var t = null;
    try { t = JSON.parse(JSON.stringify(target === undefined ? null : target)); } catch (e) { t = null; }
    if (state.running && state.running.id === appId) {
      closeMenu();
      var f = document.getElementById("app-frame");
      try {
        if (f && f.contentWindow && typeof f.contentWindow.__orosOpenAt === "function") {
          f.contentWindow.__orosOpenAt(t);
        }
      } catch (e) {}
      return;
    }
    try { sessionStorage.setItem("oros-open-at", JSON.stringify({ app: appId, target: t })); } catch (e) {}
    openApp(app);
  };
  window.__orosTakeTarget = function (appId) {
    try {
      var raw = sessionStorage.getItem("oros-open-at");
      if (!raw) return null;
      var p = JSON.parse(raw);
      if (!p || p.app !== appId) return null;
      sessionStorage.removeItem("oros-open-at");
      return p.target === undefined ? null : p.target;
    } catch (e) { return null; }
  };

  // "Send to orOS" (bookmarklet, Android Share → orOS, a future
  // browser add-on): /?share-url=…&share-title=…&share-text=…
  // stages a NEW bookmark. The params leave the address bar at boot
  // (a reload must not add it twice); Bookmarks then opens its add
  // dialog prefilled and nothing is saved until the user presses
  // Save. Only http(s) links pass. Android's share sheet often puts
  // the link inside share-text, so the first http(s) URL there counts.
  var SHARE_KEYS = ["share-url", "share-title", "share-text"];
  function shareFromHref(href) {
    var u;
    try { u = new URL(href, window.location.href); } catch (e) { return null; }
    var p = u.searchParams, hit = false;
    SHARE_KEYS.forEach(function (k) { if (p.has(k)) hit = true; });
    if (!hit) return null;
    var link = String(p.get("share-url") || "").trim();
    var title = String(p.get("share-title") || "").trim();
    var text = String(p.get("share-text") || "").trim();
    var inText = text.match(/https?:\/\/[^\s<>"']+/i);
    if (!/^https?:\/\//i.test(link) && inText) link = inText[0];
    if (!title && text) title = text.replace(link, "").replace(/\s+/g, " ").trim();
    try {
      var ok = new URL(link);
      if (ok.protocol !== "http:" && ok.protocol !== "https:") return { bad: true };
      link = ok.href;
    } catch (e) { return { bad: true }; }
    if (link.length > 2048) return { bad: true };
    return { url: link, title: title.slice(0, 256) };
  }
  var pendingShare = null;
  (function () {
    var s = shareFromHref(window.location.href);
    if (!s) return;
    try {
      var u = new URL(window.location.href);
      SHARE_KEYS.forEach(function (k) { u.searchParams.delete(k); });
      window.history.replaceState(window.history.state, "", u.pathname + u.search + u.hash);
    } catch (e) {}
    if (s.bad) return;
    pendingShare = s;
  })();
  function deliverShare() {
    if (!pendingShare || !state.apps.length) return;
    var s = pendingShare;
    pendingShare = null;
    window.__orosOpenAt("bookmarks", { add: { url: s.url, title: s.title } });
  }

  function openSearchHit(id, hit) {
    closeMenu();
    var p = searchProvider(id);
    if (p && typeof p.open === "function") {
      try { p.open(hit.target, window); return; } catch (e) {}
    }
    window.__orosOpenAt(id, hit.target);
  }

  // Ctrl+Alt+Shift+F: the menu opens with the cursor in the field,
  // from the desktop or from inside an app.
  function openMenuSearch() {
    var menu = document.getElementById("app-menu");
    if (!menu.classList.contains("open")) menu.classList.add("open");
    var inp = menu.querySelector(".menu-search input");
    if (!inp) { renderMenu(); inp = menu.querySelector(".menu-search input"); }
    if (inp) {
      menu.scrollTop = 0;
      inp.focus();
      try { inp.select(); } catch (e) {}
    }
  }

  // Text with the matching letters wrapped in <mark> (text nodes
  // only — never innerHTML: titles come from user data and sync).
  function appendMarked(el, str, words) {
    var rs = window.orosSearch.ranges(str, words), at = 0;
    rs.forEach(function (r) {
      if (r[0] > at) el.appendChild(document.createTextNode(str.slice(at, r[0])));
      var m = document.createElement("mark");
      m.textContent = str.slice(r[0], r[1]);
      el.appendChild(m);
      at = r[1];
    });
    if (at < str.length) el.appendChild(document.createTextNode(str.slice(at)));
  }

  function searchWhen(ms) {
    if (!ms || ms < 946684800000) return "";   // no date, or a placeholder stamp
    var d = new Date(ms);
    if (isNaN(d.getTime())) return "";
    var o = { day: "numeric", month: "short" };
    if (d.getFullYear() !== new Date().getFullYear()) o.year = "numeric";
    try { return d.toLocaleDateString(state.lang === "el" ? "el-GR" : "en-GB", o); }
    catch (e) { return d.toISOString().slice(0, 10); }
  }

  function renderMenu() {
    var menu = document.getElementById("app-menu");
    // SH-B3 (form rebuild discipline): this function rebuilds the whole
    // menu, and it is called by background events too (sync messages,
    // account e-mail, install prompt): keep the scroll position.
    var keepTop  = menu.scrollTop;
    menu.innerHTML = "";

    var heading = document.createElement("div");
    heading.className = "menu-heading";
    heading.style.cssText =
      "display:flex;align-items:center;gap:5px;";
    var hTxt = document.createElement("span");
    hTxt.style.cssText = "flex:1;min-width:0;";
    hTxt.textContent = window.t("menu.title");
    heading.appendChild(hTxt);

    // #1 — Expand/Collapse (all): two tiny icon buttons next to the
    // menu title. Expand = open every current category; Collapse =
    // clear the open map. Session-only (menuCatOpen, A74), same as the
    // per-category toggles — never stored, never synced, never dirty.
    function mkCatBtn(svg, titleEn, titleEl, fn) {
      var b = document.createElement("button");
      b.type = "button";
      b.innerHTML = svg;
      b.title = (state.lang === "el") ? titleEl : titleEn;
      b.setAttribute("aria-label", b.title);
      b.style.cssText =
        "flex-shrink:0;width:22px;height:22px;padding:0;display:inline-flex;" +
        "align-items:center;justify-content:center;border:1px solid var(--border);" +
        "border-radius:6px;background:transparent;color:var(--text-dim);cursor:pointer;";
      b.addEventListener("click", fn);
      return b;
    }

    heading.appendChild(mkCatBtn(
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="7 13 12 18 17 13"/><polyline points="7 6 12 11 17 6"/></svg>',
      "Expand all", "Άνοιγμα όλων",
      function () {
        state.apps.forEach(function (app) {
          menuCatOpen[String(app.category || "other").toLowerCase()] = true;
        });
        renderMenu();
      }));

    heading.appendChild(mkCatBtn(
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="7 11 12 6 17 11"/><polyline points="7 18 12 13 17 18"/></svg>',
      "Collapse all", "Κλείσιμο όλων",
      function () {
        menuCatOpen = {};
        renderMenu();
      }));

    // A74 — quick search, top of the menu. Filters the app list in
    // place (only #menu-apps is rebuilt per keystroke, so the field
    // keeps focus). Enter opens the first match, Escape clears.
    var oldSearch = menu.querySelector(".menu-search input");
    var keepSearch = oldSearch ? {
      focus: document.activeElement === oldSearch,
      start: oldSearch.selectionStart,
      end:   oldSearch.selectionEnd
    } : null;
    var searchRow = document.createElement("div");
    searchRow.className = "menu-search";
    var search = document.createElement("input");
    search.type = "search";
    search.value = menuQuery;
    search.placeholder = window.t("menu.search");
    search.setAttribute("aria-label", search.placeholder);
    search.autocomplete = "off";
    search.spellcheck = false;
    searchRow.appendChild(search);
    menu.appendChild(searchRow);

    menu.appendChild(heading);

    var appsHost = document.createElement("div");
    appsHost.id = "menu-apps";
    menu.appendChild(appsHost);
    var firstMatch = null;

    // Universal search: hits from the apps' data, under the app list.
    var resultsHost = document.createElement("div");
    resultsHost.id = "menu-results";
    resultsHost.className = "menu-results";
    menu.appendChild(resultsHost);

    search.addEventListener("input", function () {
      menuQuery = search.value;
      renderAppList();
      scheduleDataSearch();
    });
    search.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        if (firstMatch) {
          e.preventDefault();
          openApp(firstMatch);
        } else {
          var hit = resultsHost.querySelector(".menu-hit");
          if (hit) { e.preventDefault(); hit.click(); }
        }
      } else if (e.key === "ArrowDown") {
        var first = menuNavItems()[0];
        if (first) { e.preventDefault(); first.focus(); }
      } else if (e.key === "Escape" && search.value) {
        e.stopPropagation();          // clear first; next Escape closes the menu
        search.value = menuQuery = "";
        renderAppList();
        scheduleDataSearch();
      }
    });

    // Arrow keys walk the matching apps, then the data hits; Up from
    // the first one goes back to the field.
    function menuNavItems() {
      if (!menuQuery.trim()) return [];
      return Array.prototype.slice.call(
        menu.querySelectorAll("#menu-apps .menu-item, #menu-results button"));
    }
    function onNavKey(e) {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      var items = menuNavItems();
      var i = items.indexOf(document.activeElement);
      if (i === -1) return;
      e.preventDefault();
      if (e.key === "ArrowDown") { if (i + 1 < items.length) items[i + 1].focus(); }
      else if (i > 0) items[i - 1].focus();
      else search.focus();
    }
    appsHost.addEventListener("keydown", onNavKey);
    resultsHost.addEventListener("keydown", onNavKey);

    function scheduleDataSearch() {
      clearTimeout(searchTimer);
      var q = menuQuery.trim();
      var S = window.orosSearch;
      if (!S || S.parseQuery(q).join("").length < S.MIN_CHARS || !searchApps().length) {
        searchToken++;
        searchRes = { q: null, groups: null, pending: false };
        renderResults();
        return;
      }
      // Same query, fresh answer (a background re-render): redraw it.
      // Same query but older: keep it on screen and refresh it quietly
      // (the data may have changed in an app meanwhile).
      if (searchRes.q === q && searchRes.groups) {
        renderResults();
        if (Date.now() - searchRes.at < 2000) return;
      } else {
        searchRes = { q: q, groups: null, pending: true, at: 0 };
        searchExpanded = {};
        renderResults();
      }
      var token = ++searchToken;
      searchTimer = setTimeout(function () {
        if (!searchReader) searchReader = S.makeReader(localStorage);
        S.load(searchApps(), APP_VERSION).then(function () {
          return S.run(window.orosSearchProviders, q, {
            lang: state.lang, readJSON: searchReader,
            enabled: function (id) {
              for (var i = 0; i < state.apps.length; i++) {
                if (state.apps[i].id === id) {
                  return typeof state.apps[i].search === "string" && searchEnabled(id);
                }
              }
              return false;
            }
          });
        }).then(function (groups) {
          if (token !== searchToken) return;          // a newer query won
          searchRes = { q: q, groups: groups, pending: false, at: Date.now() };
          renderResults();
        }, function () {
          if (token !== searchToken) return;
          searchRes = { q: q, groups: [], pending: false, at: Date.now() };
          renderResults();
        });
      }, 150);
    }

    function renderResults() {
      var host = document.getElementById("menu-results");
      if (!host) return;                 // the menu was rebuilt meanwhile
      host.innerHTML = "";
      var q = menuQuery.trim();
      if (!q || searchRes.q !== q) return;
      var head = document.createElement("div");
      head.className = "menu-heading";
      head.textContent = window.t("search.data");
      host.appendChild(head);
      if (!searchRes.groups) {
        var wait = document.createElement("div");
        wait.className = "menu-empty menu-search-none";
        wait.textContent = window.t("search.busy");
        host.appendChild(wait);
        return;
      }
      var groups = (searchRes.groups || []).slice();
      if (!groups.length) {
        var none = document.createElement("div");
        none.className = "menu-empty menu-search-none";
        none.textContent = window.t("search.none");
        host.appendChild(none);
        return;
      }
      var words = window.orosSearch.parseQuery(q);
      var byId = {};
      state.apps.forEach(function (a) { byId[a.id] = a; });
      function label(id) {
        var k = "app." + id, v = window.t(k);
        return (v === k) ? ((byId[id] && byId[id].name) || id) : v;
      }
      groups.sort(function (a, b) {
        return b.best - a.best || label(a.id).localeCompare(label(b.id));
      });
      groups.forEach(function (g) {
        var app = byId[g.id];
        var wrap = document.createElement("div");
        wrap.className = "menu-category menu-hit-group";
        var h = document.createElement("h4");
        h.className = "menu-hit-app";
        if (app && ICONS[app.icon]) {
          var ico = document.createElement("span");
          ico.className = "app-ico";
          ico.innerHTML = ICONS[app.icon];        // static shell icon, not data
          h.appendChild(ico);
        }
        var ht = document.createElement("span");
        ht.textContent = label(g.id);
        h.appendChild(ht);
        var cnt = document.createElement("span");
        cnt.className = "menu-cat-count";
        cnt.textContent = g.total;
        h.appendChild(cnt);
        wrap.appendChild(h);

        var shown = searchExpanded[g.id] ? g.hits : g.hits.slice(0, SEARCH_SHOWN);
        shown.forEach(function (hit) {
          var b = document.createElement("button");
          b.type = "button";
          b.className = "menu-item menu-hit";
          var top = document.createElement("span");
          top.className = "menu-hit-top";
          var tt = document.createElement("span");
          tt.className = "menu-hit-title";
          appendMarked(tt, hit.title, words);
          top.appendChild(tt);
          var when = searchWhen(hit.when);
          if (when) {
            var w = document.createElement("span");
            w.className = "menu-hit-when";
            w.textContent = when;
            top.appendChild(w);
          }
          b.appendChild(top);
          if (hit.snippet) {
            var sn = document.createElement("span");
            sn.className = "menu-hit-snip";
            appendMarked(sn, hit.snippet, words);
            b.appendChild(sn);
          }
          b.addEventListener("click", function () { openSearchHit(g.id, hit); });
          wrap.appendChild(b);
        });
        if (!searchExpanded[g.id] && g.hits.length > SEARCH_SHOWN) {
          var more = document.createElement("button");
          more.type = "button";
          more.className = "menu-hit-more";
          more.textContent = window.t("search.all").replace("{n}", g.total);
          more.addEventListener("click", function () {
            searchExpanded[g.id] = true;
            renderResults();
            var again = document.querySelectorAll("#menu-results .menu-hit-group");
            for (var i = 0; i < again.length; i++) {
              if (again[i].getAttribute("data-app") === g.id) {
                var hs = again[i].querySelectorAll(".menu-hit");
                if (hs[SEARCH_SHOWN]) hs[SEARCH_SHOWN].focus();
              }
            }
          });
          wrap.appendChild(more);
        } else if (searchExpanded[g.id] && g.total > g.hits.length) {
          var cap = document.createElement("div");
          cap.className = "menu-hit-cap";
          cap.textContent = window.t("search.cap").replace("{n}", g.hits.length);
          wrap.appendChild(cap);
        }
        wrap.setAttribute("data-app", g.id);
        host.appendChild(wrap);
      });
    }

    renderAppList();
    scheduleDataSearch();
    if (keepSearch && keepSearch.focus) {
      search.focus();
      try { search.setSelectionRange(keepSearch.start, keepSearch.end); } catch (e) {}
    }

    function renderAppList() {
    appsHost.innerHTML = "";
    firstMatch = null;

    if (state.apps.length === 0) {
      var empty = document.createElement("div");
      empty.className = "menu-empty";
      empty.innerHTML =
        '<span class="glyph">' + GRID_SVG + '</span>' +
        '<span>' + window.t("menu.empty") + '</span>' +
        '<div class="hint">' + window.t("menu.empty.hint") + '</div>';
      appsHost.appendChild(empty);
    } else {
      // SH-B11 (A52): ONE group per category whatever its spelling in
      // apps.json ("lifestyle" and "Lifestyle" used to be two groups,
      // and every lowercase name sorted after every capitalized one),
      // and the groups in the alphabetical order of the label the
      // user actually READS — in Greek the menu followed the English
      // names.
      var cats = {}, catRaw = {}, catAll = {};
      state.apps.forEach(function (app) {
        var raw = String(app.category || "other");
        var c = raw.toLowerCase();
        if (!catRaw[c]) catRaw[c] = raw;
        catAll[c] = (catAll[c] || 0) + 1;
        (cats[c] = cats[c] || []).push(app);
      });
      function appLabelOf(app) {
        var nameKey = "app." + app.id;
        var tName = window.t(nameKey);
        return (tName === nameKey) ? app.name : tName;   // #4: translated name, fallback to apps.json
      }
      function catTextOf(c) {
        var key = "category." + c;
        var label = window.t(key);
        // Unknown category → t() returns the key itself → fall back
        // to the prettified raw name (future-proof for new apps).
        return (label === key)
          ? catRaw[c].charAt(0).toUpperCase() + catRaw[c].slice(1)
          : label;
      }
      var catLocale = (state.lang === "el") ? "el" : "en";

      // A74: while searching, keep only the matching apps (by the shown
      // name, the apps.json name, the id or the category label) and
      // show their categories open; the count becomes the match count.
      var q = menuFold(menuQuery.trim());
      if (q) {
        Object.keys(cats).forEach(function (c) {
          var cl = catTextOf(c);
          cats[c] = cats[c].filter(function (app) {
            return [appLabelOf(app), app.name, app.id, cl].some(function (f) {
              return menuFold(f).indexOf(q) !== -1;
            });
          });
          if (!cats[c].length) delete cats[c];
        });
        if (!Object.keys(cats).length) {
          var none = document.createElement("div");
          none.className = "menu-empty menu-search-none";
          none.textContent = window.t("menu.search.none");
          appsHost.appendChild(none);
        }
      }

      Object.keys(cats).sort(function (a, b) {
        var r = 0;
        try { r = catTextOf(a).localeCompare(catTextOf(b), catLocale, { sensitivity: "base" }); }
        catch (e) { r = 0; }
        return r || (a < b ? -1 : a > b ? 1 : 0);
      }).forEach(function (cat) {
        var collapsed = !q && !menuCatOpen[cat];
        var wrap = document.createElement("div");
        wrap.className = "menu-category";

        // Collapsible header: chevron rotates, app rows hide/show.
        var h = document.createElement("h4");
        h.style.cssText =
          "display:flex;align-items:center;gap:5px;cursor:pointer;user-select:none;";
        var catText = catTextOf(cat);
        var chev = document.createElement("span");
        chev.style.cssText =
          "display:inline-flex;transition:transform .15s;" +
          (collapsed ? "transform:rotate(-90deg);" : "");
        chev.innerHTML =
          '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
        h.appendChild(chev);
        var hTxt = document.createElement("span");
        hTxt.textContent = catText;
        h.appendChild(hTxt);
        // A74: how many apps the category holds (matches while searching).
        var cnt = document.createElement("span");
        cnt.className = "menu-cat-count";
        cnt.textContent = q ? cats[cat].length : catAll[cat];
        h.appendChild(cnt);
        h.addEventListener("click", function () {
          if (q) return;                // search results are always shown open
          menuCatOpen[cat] = collapsed;
          renderAppList();
        });
        wrap.appendChild(h);

        var catList = document.createElement("div");
        if (collapsed) catList.style.display = "none";

        cats[cat].forEach(function (app) {
          var btn = document.createElement("button");
          btn.className = "menu-item";
          if (!firstMatch && q) firstMatch = app;
          var label = appLabelOf(app);
          if (ICONS[app.icon]) {
            btn.innerHTML =
              '<span class="app-ico">' + ICONS[app.icon] + '</span>' +
              '<span>' + escapeHtml(label) + '</span>';
          } else {
            btn.textContent = label;
          }
          btn.addEventListener("click", function () { openApp(app); });
          // Favourites (launcher.js): the star at the end of the row.
          catList.appendChild(window.orosLauncher ? window.orosLauncher.menuRow(btn, app) : btn);
        });
        wrap.appendChild(catList);
        appsHost.appendChild(wrap);
      });
    }
    }   // renderAppList

    // System settings live in the Settings app (settings/, System).
    // The Dock section stays here only for a launcher.js without the
    // prefs API the Settings app needs.
    if (window.orosLauncher && typeof window.orosLauncher.setPref !== "function") {
      window.orosLauncher.renderSettings(menu);
    }
    renderInstallRow(menu);
    if (window.orosLauncher) window.orosLauncher.refresh();   // desktop shortcuts follow apps + language

    // Settings row: every system setting lives in the Settings app.
    var setRow = document.createElement("div");
    setRow.className = "install-section";
    var setBtn = document.createElement("button");
    setBtn.className = "menu-item install-row";
    setBtn.innerHTML = '<span class="app-ico">' + ICONS.settings + '</span>' +
                       '<span>' + escapeHtml(window.t("menu.settings")) + '</span>';
    setBtn.addEventListener("click", function () {
      closeMenu();
      openAppById("settings");
    });
    setRow.appendChild(setBtn);
    menu.appendChild(setRow);

    // Device Info row (Chris 2026-10-09): where people look when
    // something is wrong — space, sync state, missing browser features.
    var devRow = document.createElement("div");
    devRow.className = "install-section";
    var devBtn = document.createElement("button");
    devBtn.className = "menu-item install-row";
    devBtn.textContent = window.t("menu.deviceInfo");
    devBtn.addEventListener("click", function () {
      closeMenu();
      openAppById("device");
    });
    devRow.appendChild(devBtn);
    menu.appendChild(devRow);

    // v0.18.0 — Info row (mirrors Ctrl+Alt+Shift+I)
    var infoRow = document.createElement("div");
    infoRow.className = "install-section";
    var infoBtn = document.createElement("button");
    infoBtn.className = "menu-item install-row";
    infoBtn.textContent = window.t("sc.desc.info");
    infoBtn.addEventListener("click", function () {
      closeMenu();
      showInfoModal();
    });
    infoRow.appendChild(infoBtn);
    menu.appendChild(infoRow);

    menu.scrollTop = keepTop;
    settingsNotify();            // the Settings app repaints too
  }

  // User changes of appearance (menu + Settings app). Each one is a
  // user action → stamped and sent to the sync engine; picking the
  // value already in place does nothing (R27).
  function setSkinUser(id) {
    if (!isValidSkin(id) || state.skin === id) return;
    state.skin = id;
    localStorage.setItem("oros-skin", state.skin);
    applySkin();
    maybeFollowSkin(id);       // suggests paired wallpaper (from default only)
    noteLocalChange();
    renderMenu();
  }

  function setThemeUser(theme) {
    if ((theme !== "dark" && theme !== "light") || state.theme === theme) return;
    state.theme = theme;
    localStorage.setItem("oros-theme", state.theme);
    applyTheme();
    noteLocalChange();
    renderMenu();
  }

  function setWallpaperUser(id) {
    if (!findWallpaper(id) || state.wallpaper === id) return;
    state.wallpaper = id;
    localStorage.setItem("oros-wallpaper", state.wallpaper);
    applyWallpaper();
    noteLocalChange();
    renderMenu();
  }

  function skinTitle(id) {
    // Fixed display names where the id isn't the prettiest label
    var display = {
      popos:    { en: "Pop!_OS",       el: "Pop!_OS" },
      opensuse: { en: "openSUSE",      el: "openSUSE" },
      nixos:    { en: "NixOS",         el: "NixOS" },
      manjaro:  { en: "Manjaro",       el: "Manjaro" },
      gentoo:   { en: "Gentoo",        el: "Gentoo" },
      zorin:    { en: "Zorin",         el: "Zorin" }
    };
    var d = display[id];
    if (d) return state.lang === "el" ? d.el : d.en;
    return id.charAt(0).toUpperCase() + id.slice(1);
  }

  function wallpaperTitle(id) {
    var names = {
      dusk:     { en: "Adwaita Dusk",  el: "Λυκόφως Adwaita" },
      midnight: { en: "Midnight",      el: "Μεσάνυχτα" },
      plum:     { en: "Aubergine",     el: "Μελανότσιρο" },
      forest:   { en: "Forest Night",  el: "Νύχτα Δάσους" },
      ember:    { en: "Ember",         el: "Στάχτη" },
      nordic:   { en: "Nordic Frost",  el: "Σκανδιναβικός Πάγος" },
      aurora:   { en: "Aurora",        el: "Αυγή" },
      sand:     { en: "Desert Sand",   el: "Άμμος Ερήμου" },
      mono:     { en: "Monochrome",    el: "Μονόχρωμο" },
      nebula:   { en: "Nebula",        el: "Νεφέλωμα" },
      borealis: { en: "Nordic Aurora", el: "Βόρειο Σέλας" },
      hex:      { en: "Hex Grid",      el: "Εξαγωνικό Πλέγμα" },
      obsidian: { en: "Obsidian Veil", el: "Πέπλο Οψιδιανού" },
      terrazzo: { en: "Retro Terrazzo", el: "Ρετρό Terrazzo" },
      custom:   { en: "Mine",          el: "Δική μου" },
      clear:    { en: "None",          el: "Καμία" }
    };
    var n = names[id];
    if (!n) return id;
    return state.lang === "el" ? n.el : n.en;
  }
  
    // ---------- 9. Sync UI & shell slice ----------

  // The shell's own syncable data — theme/language/skin/wallpaper,
  // the auto-sync interval AND the auto-backup mode all travel.
  // Getter reads CURRENT state; setter is fed by pulls (no markDirty
  // inside user-settable paths!).
  //
  // SH-D1 — SHELL SLICE v2 (merge-capable). The slice used to be
  // mergeless, and the engine's rule for a mergeless slice is "local
  // with unpushed work wins". The shell slice is never empty, so a
  // brand-new device (no baseline) beat the cloud with its DEFAULTS
  // and the next pull wiped theme, skin, weather location and every
  // alarm on the other devices. Now:
  //   · every setting carries its own stamp (sm) → last writer wins
  //     PER SETTING; stamp 0 = "still the default", 1 = "customized
  //     before stamps existed", otherwise the ms of the change. A
  //     remote WITHOUT stamps (older bundle / old backup file) counts
  //     as 1 for every setting it carries.
  //   · alarms are entities: union by id, newer mtime wins, explicit
  //     deletions leave a tombstone (alarmTombs). A "once" alarm whose
  //     time has passed is dead by definition — no tombstone needed.
  //   · shellMerge is symmetric and deterministic; shellSliceGet
  //     always returns the canonical form (fixed key order, alarms
  //     sorted by id), so a converged state produces no phantom push.
  var SHELL_STAMPS_KEY = "oros-shell-stamps";   // { <field>: { t: ms, v: json } } — travels as `sm`
  var ALARM_TOMBS_KEY  = "oros-alarm-tombs";    // { <alarmId>: { t: ms, x: ms|0 } } — travels as `alarmTombs`
  var SHELL_FIELDS = ["lang", "theme", "skin", "wallpaper", "syncInterval", "autoexport", "weather", "wpart"];
  var TOMB_GRACE_MS = 24 * 60 * 60 * 1000;      // a once-alarm tombstone outlives its alarm by a day (clock skew)

  function shellDefault(name) {
    switch (name) {
      case "lang":         return "en";
      case "theme":        return "dark";
      case "skin":         return "oros";
      case "wallpaper":    return DEFAULT_WALLPAPER;
      case "syncInterval": return 3;
      case "autoexport":   return "off";
      case "wpart":        return null;
      default:             return { on: false, auto: false, lat: null, lon: null, label: "" };   // weather
    }
  }

  // Canonical form of ONE setting, or undefined when the value is not
  // something shellSliceSet would accept (same validations).
  function shellCanon(name, v) {
    switch (name) {
      case "lang":         return (v === "en" || v === "el") ? v : undefined;
      case "theme":        return (v === "dark" || v === "light") ? v : undefined;
      case "skin":         return isValidSkin(v) ? v : undefined;
      case "wallpaper":    return (typeof v === "string" && findWallpaper(v)) ? v : undefined;
      case "syncInterval": return (typeof v === "number" && isFinite(v) && v >= 0 && v <= 60) ? v : undefined;
      case "autoexport":   return (v === "off" || v === "daily" || v === "weekly" || v === "monthly") ? v : undefined;
      case "wpart":
        if (v === null) return null;
        var wa = wpArt() ? wpArt().normRecipe(v) : null;
        return wa ? wa : undefined;
      default:
        if (!v || typeof v !== "object") return undefined;
        return {
          on:    !!v.on,
          auto:  !!v.auto,
          lat:   (typeof v.lat === "number" && isFinite(v.lat)) ? v.lat : null,
          lon:   (typeof v.lon === "number" && isFinite(v.lon)) ? v.lon : null,
          label: (typeof v.label === "string") ? v.label : ""
        };
    }
  }

  // The settings as they are RIGHT NOW on this device (canonical).
  function shellNow() {
    var syncInterval = 3;
    if (window.orosSync && typeof window.orosSync.getIntervalMinutes === "function") {
      syncInterval = window.orosSync.getIntervalMinutes();
    }
    var raw = {
      lang: state.lang, theme: state.theme, skin: state.skin,
      wallpaper: state.wallpaper, syncInterval: syncInterval,
      autoexport: state.autoexport, weather: wxRead(),
      wpart: state.wpart
    };
    var out = {};
    for (var i = 0; i < SHELL_FIELDS.length; i++) {
      var n = SHELL_FIELDS[i];
      var c = shellCanon(n, raw[n]);
      out[n] = (c === undefined) ? shellDefault(n) : c;
    }
    return out;
  }

  function shellStampsRead() {
    try {
      var s = JSON.parse(localStorage.getItem(SHELL_STAMPS_KEY));
      return (s && typeof s === "object") ? s : null;
    } catch (e) { return null; }
  }

  // One-time, on the first run of v2: a copy of the shell slice that
  // the OLD (mergeless) engine parked in the mailbox carries no stamps
  // and no tombstones. Merging it now could bring back alarms deleted
  // since. The old engine would have dropped it at this very
  // registration ("older than this device's last push") — do the same.
  function shellDropParkedLegacy() {
    try {
      var c = JSON.parse(localStorage.getItem("oros-remote-carry"));
      if (c && typeof c === "object" && c.shell !== undefined) {
        delete c.shell;
        if (Object.keys(c).length > 0) localStorage.setItem("oros-remote-carry", JSON.stringify(c));
        else localStorage.removeItem("oros-remote-carry");
      }
    } catch (e) {}
  }

  // Keeps the stamps in step with the settings and returns { field: t }.
  // A setting whose value differs from the one last stamped gets "now"
  // (monotonic). Called from every user action (noteLocalChange) and
  // from the getter (catches a change made by any other path).
  // Idempotent: a second call with nothing changed writes nothing.
  function shellStampsRefresh() {
    var cur = shellNow();
    var st = shellStampsRead();
    var first = !st;
    if (first) { st = {}; shellDropParkedLegacy(); }
    var now = Date.now(), changed = false, out = {};
    for (var i = 0; i < SHELL_FIELDS.length; i++) {
      var n = SHELL_FIELDS[i];
      var v = JSON.stringify(cur[n]);
      var e = st[n];
      if (!e || typeof e.t !== "number" || !isFinite(e.t) || typeof e.v !== "string") {
        // No stamp yet (first run of v2, or a setting added later):
        // 0 = default value, nothing to defend; 1 = customized.
        e = { t: (v === JSON.stringify(shellDefault(n))) ? 0 : 1, v: v };
        changed = true;
      } else if (e.v !== v) {
        e = { t: Math.max(now, e.t + 1), v: v };
        changed = true;
      }
      st[n] = e;
      out[n] = e.t;
    }
    if (changed) {
      try { localStorage.setItem(SHELL_STAMPS_KEY, JSON.stringify(st)); } catch (e2) {}
    }
    return out;
  }

  // ----- alarms as entities -----
  function alarmCanon(a) {
    if (!a || typeof a !== "object") return null;
    if (typeof a.id !== "string" || !a.id) return null;
    if (typeof a.at !== "number" || !isFinite(a.at)) return null;
    return {
      id:     a.id,
      at:     Math.round(a.at),
      label:  (typeof a.label === "string") ? a.label.slice(0, 60) : "",
      repeat: (a.repeat === "daily") ? "daily" : "once",
      state:  "pending",
      mtime:  (typeof a.mtime === "number" && isFinite(a.mtime) && a.mtime > 0) ? Math.round(a.mtime) : 1
    };
  }

  // Deterministic total order between two versions of one alarm.
  function alarmBetter(a, b) {
    if (a.mtime !== b.mtime) return (a.mtime > b.mtime) ? a : b;
    return (JSON.stringify(a) >= JSON.stringify(b)) ? a : b;
  }

  function alarmTombsClean(raw) {
    var out = {};
    if (raw && typeof raw === "object") {
      Object.keys(raw).forEach(function (id) {
        var e = raw[id];
        if (e && typeof e === "object" && typeof e.t === "number" && isFinite(e.t)) {
          out[id] = { t: e.t, x: (typeof e.x === "number" && isFinite(e.x) && e.x > 0) ? e.x : 0 };
        }
      });
    }
    return out;
  }

  function alarmTombsRead() {
    try { return alarmTombsClean(JSON.parse(localStorage.getItem(ALARM_TOMBS_KEY))); }
    catch (e) { return {}; }
  }

  // Canonical tombstones: sorted ids; the tombstone of a ONCE alarm
  // (x = its time) is dropped a day after that time — by then the
  // alarm is dead on every device anyway. Daily ones (x = 0) stay.
  function alarmTombsLive(tombs, now) {
    var out = {};
    Object.keys(tombs).sort().forEach(function (id) {
      var e = tombs[id];
      if (e.x > 0 && e.x + TOMB_GRACE_MS <= now) return;
      out[id] = { t: e.t, x: e.x };
    });
    return out;
  }

  function alarmTombsWrite(tombs) {
    try {
      if (Object.keys(tombs).length > 0) localStorage.setItem(ALARM_TOMBS_KEY, JSON.stringify(tombs));
      else localStorage.removeItem(ALARM_TOMBS_KEY);
    } catch (e) {}
  }

  // The alarms that are ALIVE: valid, not deleted (tombstone at or
  // after their mtime), and not a once-alarm whose time has passed.
  // One entry per id (best version), sorted by id.
  function alarmsCanonical(list, tombs, now) {
    var byId = {};
    for (var i = 0; i < list.length; i++) {
      var c = alarmCanon(list[i]);
      if (!c) continue;
      if (c.repeat === "once" && c.at <= now) continue;
      if (tombs[c.id] && c.mtime <= tombs[c.id].t) continue;
      byId[c.id] = byId[c.id] ? alarmBetter(byId[c.id], c) : c;
    }
    return Object.keys(byId).sort().map(function (id) { return byId[id]; });
  }

  // Next firing of a daily alarm that is due: whole days forward.
  // `last` = the most recent occurrence at or before `now` — used as
  // the entity's mtime, so two devices that advance the same alarm
  // write byte-identical data (no ping-pong between them).
  function alarmNextDaily(at, now) {
    var d = new Date(at), last = at;
    do { last = d.getTime(); d.setDate(d.getDate() + 1); } while (d.getTime() <= now);
    return { at: d.getTime(), last: last };
  }

  // One side of a merge, normalized. A side without `sm` is a legacy
  // payload: every VALID setting it carries counts as stamp 1.
  // An invalid / missing setting is the default at stamp 0.
  function shellSide(x, now) {
    x = (x && typeof x === "object") ? x : {};
    var legacy = !(x.sm && typeof x.sm === "object");
    var f = {};
    for (var i = 0; i < SHELL_FIELDS.length; i++) {
      var n = SHELL_FIELDS[i];
      var v = shellCanon(n, x[n]);
      if (v === undefined) { f[n] = { v: shellDefault(n), t: 0 }; continue; }
      var t = legacy ? 1
            : (typeof x.sm[n] === "number" && isFinite(x.sm[n]) && x.sm[n] >= 0) ? x.sm[n] : 0;
      f[n] = { v: v, t: t };
    }
    return {
      f: f,
      alarms: Array.isArray(x.alarms) ? x.alarms : [],
      // Expired tombstones are dropped per side, BEFORE the union: an
      // entry that is already dead must not lend its stamp to a live
      // one (that would make the result depend on the merge order).
      tombs: alarmTombsLive(alarmTombsClean(x.alarmTombs), now)
    };
  }

  // Canonical slice object — ONE builder for the getter and the merge.
  function shellBuild(vals, stamps, alarms, tombs) {
    var sm = {};
    for (var i = 0; i < SHELL_FIELDS.length; i++) sm[SHELL_FIELDS[i]] = stamps[SHELL_FIELDS[i]];
    return {
      lang:         vals.lang,
      theme:        vals.theme,
      skin:         vals.skin,
      wallpaper:    vals.wallpaper,
      syncInterval: vals.syncInterval,
      autoexport:   vals.autoexport,
      alarms:       alarms,       // user data — travels in every backup funnel
      weather:      vals.weather,
      wpart:        vals.wpart,   // "Mine" wallpaper recipe (Wallpaper Generator)
      ver:          2,
      sm:           sm,
      alarmTombs:   tombs
    };
  }

  function shellSliceGet() {
    var now = Date.now();
    var stamps = shellStampsRefresh();
    var tombs = alarmTombsLive(alarmTombsRead(), now);
    return shellBuild(shellNow(), stamps, alarmsCanonical(alarmsRead(), tombs, now), tombs);
  }

  // mergeFn(local, remote) — symmetric: shellMerge(a, b) and
  // shellMerge(b, a) are byte-identical.
  function shellMerge(a, b) {
    var now = Date.now();
    var A = shellSide(a, now), B = shellSide(b, now);
    var vals = {}, stamps = {};
    for (var i = 0; i < SHELL_FIELDS.length; i++) {
      var n = SHELL_FIELDS[i];
      var p = A.f[n], q = B.f[n], w;
      if (p.t !== q.t) w = (p.t > q.t) ? p : q;
      else w = (JSON.stringify(p.v) >= JSON.stringify(q.v)) ? p : q;
      vals[n] = w.v;
      stamps[n] = w.t;
    }
    var tombs = {};
    [A.tombs, B.tombs].forEach(function (src) {
      Object.keys(src).forEach(function (id) {
        var e = src[id], cur = tombs[id];
        // Newest deletion stamp; "never expires" (x = 0) is sticky,
        // otherwise the later expiry.
        if (!cur) tombs[id] = { t: e.t, x: e.x };
        else tombs[id] = {
          t: Math.max(cur.t, e.t),
          x: (cur.x === 0 || e.x === 0) ? 0 : Math.max(cur.x, e.x)
        };
      });
    });
    tombs = alarmTombsLive(tombs, now);
    return shellBuild(vals, stamps, alarmsCanonical(A.alarms.concat(B.alarms), tombs, now), tombs);
  }

  function shellSliceSet(data) {
    if (!data) return;
    if (data.lang  === "en" || data.lang  === "el") state.lang  = data.lang;
    if (data.theme === "dark" || data.theme === "light") state.theme = data.theme;
    if (isValidSkin(data.skin)) state.skin = data.skin;
    if (findWallpaper(data.wallpaper)) {
      state.wallpaper = data.wallpaper;
      localStorage.setItem("oros-wallpaper", state.wallpaper);
    }
    if (data.wpart !== undefined && shellCanon("wpart", data.wpart) !== undefined) {
      state.wpart = shellCanon("wpart", data.wpart);
      wpArtWrite(state.wpart);
    }
    if (typeof data.syncInterval === "number" &&
        data.syncInterval >= 0 && data.syncInterval <= 60 &&
        window.orosSync && typeof window.orosSync.setIntervalMinutes === "function") {
      // Pull-fed value: applies + reschedules only. setIntervalMinutes
      // never marks dirty → no sync loop possible.
      window.orosSync.setIntervalMinutes(data.syncInterval);
    }
    if (data.autoexport === "off" || data.autoexport === "daily" ||
        data.autoexport === "weekly" || data.autoexport === "monthly") {
      // Pulled value: record + apply. NEVER marks dirty (same contract
      // as syncInterval — pull → set → push would loop).
      state.autoexport = data.autoexport;
      localStorage.setItem(AUTOEXPORT_PREF, state.autoexport);
    }

    // Pull-fed weather settings: apply + paint, NEVER markDirty
    // (same contract as syncInterval — pull → set → push loops).
    if (data.weather && typeof data.weather === "object") {
      var ww = data.weather;
      var prevW = wxRead();   // coords BEFORE the pull overwrites them
      var newLat = (typeof ww.lat === "number" && isFinite(ww.lat)) ? ww.lat : null;
      var newLon = (typeof ww.lon === "number" && isFinite(ww.lon)) ? ww.lon : null;
      // A pull that MOVES the location invalidates the cache (the
      // old city's temp painted under the new label) AND must bypass
      // the 30-min throttle — WX_LAST_KEY was stamped for the OLD
      // city. Unchanged location → throttled, exactly as before.
      var moved = (newLat !== null && newLon !== null &&
                   (prevW.lat !== newLat || prevW.lon !== newLon));
      if (moved) {
        localStorage.removeItem(WX_CACHE_KEY);
        localStorage.removeItem(WX_LAST_KEY);
      }
      wxSave({
        on:    !!ww.on,
        auto:  !!ww.auto,
        lat:   newLat,
        lon:   newLon,
        label: (typeof ww.label === "string") ? ww.label : ""
      });
      wxFetch(moved);         // moved → force; unchanged → throttled
      wxRenderChip();
      wxPushToApp();         // #S3-fix: a RUNNING Weather app adopts the
                             // pulled prefs live — tray and app must never
                             // show different locations.
    }

    // SH-D1 — pull-fed alarms. `data` is normally the MERGED slice
    // (local ∪ remote, deletions honored), so writing it is not a
    // wholesale replace any more. Anti-loop contract unchanged:
    // pull-fed path, NO markDirty.
    var nowSet = Date.now();
    var side = shellSide(data, nowSet);
    if (Array.isArray(data.alarms)) {
      var tombsNew = alarmTombsLive(side.tombs, nowSet);
      var keep = alarmsCanonical(side.alarms, tombsNew, nowSet);
      var keepIds = {};
      for (var ai = 0; ai < keep.length; ai++) {
        // A daily alarm that is already due (this device slept past
        // it): advance by whole days, with the deterministic mtime.
        if (keep[ai].repeat === "daily" && keep[ai].at <= nowSet) {
          var nx = alarmNextDaily(keep[ai].at, nowSet);
          keep[ai].at = nx.at;
          keep[ai].mtime = Math.max(keep[ai].mtime, nx.last);
        }
        keepIds[keep[ai].id] = true;
      }
      // A LOCAL once-alarm that is due but has not rung yet (the tick
      // runs once a second) is not in the merged list — it must still
      // ring here, unless it was deleted on another device.
      var mine = alarmsRead();
      for (var li = 0; li < mine.length; li++) {
        var lc = alarmCanon(mine[li]);
        if (lc && lc.repeat === "once" && lc.at <= nowSet && !keepIds[lc.id] &&
            !(tombsNew[lc.id] && lc.mtime <= tombsNew[lc.id].t)) {
          keep.push(lc);
          keepIds[lc.id] = true;
        }
      }
      alarmsWrite(keep);
      alarmTombsWrite(tombsNew);
    }

    localStorage.setItem("oros-lang",  state.lang);
    localStorage.setItem("oros-theme", state.theme);
    localStorage.setItem("oros-skin",  state.skin);

    // SH-D1: adopt the stamps that came with the applied values — the
    // value now on this device IS the stamped one, so the next getter
    // must not read it as a fresh local change.
    try {
      var curNow = shellNow();
      var stNew = shellStampsRead() || {};
      for (var si = 0; si < SHELL_FIELDS.length; si++) {
        var sn = SHELL_FIELDS[si];
        if (shellCanon(sn, data[sn]) === undefined) continue;   // nothing valid came in for it
        stNew[sn] = { t: side.f[sn].t, v: JSON.stringify(curNow[sn]) };
      }
      localStorage.setItem(SHELL_STAMPS_KEY, JSON.stringify(stNew));
    } catch (eSt) {}

    applySkin();
    applyWallpaper();
    applyTheme();
    applyLang();     // re-renders menu too
    // Deliberately NO noteLocalChange() here — pulled data must not
    // re-mark dirty, or pull → set → push → pull → … infinite loop.
  }

  function registerShellSlice() {
    if (window.orosSync) {
      // SH-D1: stamps first (first-run migration + parked-legacy
      // cleanup must precede the registration's mailbox flush), then
      // register WITH the merge function. No storage key: the slice
      // is assembled from several keys and the shell is always live.
      try { shellStampsRefresh(); } catch (e) {}
      window.orosSync.registerSlice("shell", shellSliceGet, shellSliceSet, null, shellMerge);
    }
  }

  // ---------- 9f. Files disk — backups + legacy cleanup (FILES-V) ----------
  // The Files disk no longer travels as one snapshot inside the sync
  // blob (slice "files-disk", staged in localStorage): it syncs PER
  // FILE through Vault Drive — fs.js reports every disk mutation to
  // vault.js, nothing here is involved. What stays in the shell:
  //   · manual / folder BACKUPS still contain the whole disk
  //     (fdAttachDisk on export, fdImportDisk on import — a MERGE:
  //     importing a backup never deletes a file);
  //   · a one-time cleanup of what the old model left in
  //     localStorage (fdMigrateLegacy).
  // The backup keeps the old shape (apps["files-disk"] =
  // { kind:"oros-files-disk", ver:1, ts, disk }) so files exported
  // by either version import into either version.

  var FD_CACHE_KEY   = "oros-files-disk-cache";    // legacy — removed by fdMigrateLegacy
  var FD_PENDING_KEY = "oros-files-disk-pending";  // legacy
  var FD_META_KEY    = "oros-files-disk-meta";     // legacy (files.js)

  // Resolves the same object with the disk attached. A disk that
  // cannot be read (EIO) leaves the backup without it — the rest of
  // the export still happens.
  function fdAttachDisk(obj) {
    if (!obj || !window.orosFS || typeof window.orosFS.exportDisk !== "function") {
      return Promise.resolve(obj);
    }
    return window.orosFS.exportDisk().then(function (disk) {
      if (!obj.apps) obj.apps = {};
      obj.apps["files-disk"] = { kind: "oros-files-disk", ver: 1, ts: Date.now(), disk: disk };
      return obj;
    }).catch(function (e) {
      console.warn("[orOS] backup without the Files disk:", e && (e.code || e.message));
      return obj;
    });
  }

  // The manual export, as text: every slice + the disk.
  function fdExportJson() {
    var obj = JSON.parse(window.orosSync.exportData());
    return fdAttachDisk(obj).then(function (full) {
      return JSON.stringify(full, null, 2);
    });
  }

  // The disk part of an imported backup → merged into the disk.
  // Resolves the number of entries applied (0 when the backup has no
  // disk). fs.js tells the vault about every file it writes.
  function fdImportDisk(text) {
    var snap = null;
    try {
      var obj = JSON.parse(text);
      snap = obj && obj.apps && obj.apps["files-disk"];
    } catch (e) { return Promise.resolve(0); }
    if (!snap || snap.kind !== "oros-files-disk" || !snap.disk ||
        !window.orosFS || typeof window.orosFS.importDisk !== "function") {
      return Promise.resolve(0);
    }
    return window.orosFS.importDisk(snap.disk).then(function (r) {
      return (r && r.applied) || 0;
    });
  }

  // One-time, at boot. The old model could hold a remote disk that
  // had ARRIVED but was never applied (Files closed at the time): the
  // pending flag + the cache. That copy is merged into the disk
  // first — it may contain files this device has not got yet — and
  // only then are the legacy keys removed (they held the whole disk
  // in base64 inside the 5 MB every app shares).
  function fdMigrateLegacy() {
    var raw = null, pending = false;
    try {
      raw = localStorage.getItem(FD_CACHE_KEY);
      pending = localStorage.getItem(FD_PENDING_KEY) === "1";
    } catch (e) { return; }
    function clean() {
      try {
        localStorage.removeItem(FD_CACHE_KEY);
        localStorage.removeItem(FD_PENDING_KEY);
        localStorage.removeItem(FD_META_KEY);
      } catch (e) {}
    }
    if (raw === null) { clean(); return; }
    if (!pending) { clean(); return; }
    var snap = null;
    try { snap = JSON.parse(raw); } catch (e2) {}
    if (!snap || !snap.disk || !window.orosFS || typeof window.orosFS.importDisk !== "function") {
      clean();
      return;
    }
    window.orosFS.importDisk(snap.disk).then(function (r) {
      var failed = (r && Array.isArray(r.failed)) ? r.failed.length : 0;
      if (failed === 0) clean();      // else: keep it, try again at the next boot
    }).catch(function () { /* disk unavailable — keep it for the next boot */ });
  }

  // SY-Q2 — the retired rolling snapshots (shell <= 0.38, key
  // "oros-auto-snapshots": up to 5 full, unencrypted copies of every
  // app's data) were never removed from devices that had them. On a
  // long-used device they fill most of the shared ~5 MB localStorage,
  // so every app save and the sync mailbox fail ("Browser storage is
  // full"). Zero-loss move, once per boot while the key exists: the
  // value goes to IndexedDB "oros-legacy" (store "kv", same key), and
  // the localStorage copy is removed only after that write committed.
  // Nothing reads it back; it waits there in case it is ever needed.
  var LEGACY_LS_KEYS = ["oros-auto-snapshots"];

  function legacyLsMove() {
    var moving = [];
    LEGACY_LS_KEYS.forEach(function (k) {
      var v = null;
      try { v = localStorage.getItem(k); } catch (e) {}
      if (v !== null) moving.push({ k: k, v: v });
    });
    if (!moving.length || !window.indexedDB) return Promise.resolve(0);
    return new Promise(function (resolve) {
      var req;
      try { req = indexedDB.open("oros-legacy", 1); } catch (e) { resolve(0); return; }
      req.onupgradeneeded = function () { req.result.createObjectStore("kv"); };
      req.onerror = function () { resolve(0); };
      req.onsuccess = function () {
        var db = req.result, tx;
        try {
          tx = db.transaction("kv", "readwrite");
          moving.forEach(function (m) { tx.objectStore("kv").put(m.v, m.k); });
        } catch (e) { db.close(); resolve(0); return; }
        tx.oncomplete = function () {
          db.close();
          moving.forEach(function (m) { try { localStorage.removeItem(m.k); } catch (e) {} });
          resolve(moving.length);
        };
        tx.onerror = tx.onabort = function () { db.close(); resolve(0); };
      };
    }).then(function (n) {
      // Space came back: let the engine retry what the full store refused.
      if (n > 0 && window.orosSync && typeof window.orosSync.kickAutoEngine === "function") {
        window.orosSync.kickAutoEngine();
      }
      return n;
    });
  }

  // ---------- 9h. Radio proxy slice (sync when iframe closed) ----------
  var RADIO_CACHE_KEY = "oros-radio-data";

  function radioProxySliceGet() {
    try {
      var raw = localStorage.getItem(RADIO_CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function radioProxySliceSet(data) {
    if (!data) return;
    try {
      localStorage.setItem(RADIO_CACHE_KEY, JSON.stringify(data));
    } catch (e) {}
  }

  function registerRadioProxySlice() {
    if (window.orosSync) {
      window.orosSync.registerSlice(
        "radio", radioProxySliceGet, radioProxySliceSet, RADIO_CACHE_KEY);
    }
  }

  // ---------- 9i2. Television proxy slice (sync when iframe closed) ----------
  // Mirror of the radio pattern: favorites + recents for the TV app
  // live in "oros-television-data"; the shell-hosted slice keeps them
  // travelling while the app's iframe is closed (about:blank).
  var TELEVISION_CACHE_KEY = "oros-television-data";

  function televisionProxySliceGet() {
    try {
      var raw = localStorage.getItem(TELEVISION_CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function televisionProxySliceSet(data) {
    if (!data) return;
    try {
      localStorage.setItem(TELEVISION_CACHE_KEY, JSON.stringify(data));
    } catch (e) {}
  }

  function registerTelevisionProxySlice() {
    if (window.orosSync) {
      window.orosSync.registerSlice(
        "television", televisionProxySliceGet, televisionProxySliceSet,
        TELEVISION_CACHE_KEY);
    }
  }

  // ---------- 9i3. Mail proxy slice (sync when iframe closed) ----------
  // Same pattern as radio/television. The synced blob travels via
  // "oros-mail-data": accounts (servers, no passwords), the relay
  // address and the senders with pictures allowed. Messages and
  // passwords stay on the device, in the app's IndexedDB "oros-mail"
  // (sealed with a non-extractable key); the live registration in
  // mail.js brings the merge.
  var MAIL_CACHE_KEY = "oros-mail-data";

  function mailProxySliceGet() {
    try {
      var raw = localStorage.getItem(MAIL_CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function mailProxySliceSet(data) {
    if (!data) return;
    try {
      localStorage.setItem(MAIL_CACHE_KEY, JSON.stringify(data));
    } catch (e) {}
  }

  function registerMailProxySlice() {
    if (window.orosSync) {
      window.orosSync.registerSlice(
        "mail", mailProxySliceGet, mailProxySliceSet,
        MAIL_CACHE_KEY);
    }
  }

  // ---------- 5e. Unified file dialogs (Wave 2 — dialogs.js) ----------
  // Single funnel for shell-owned file I/O. The shell IS the host of
  // window.orosDialog, but the lookup stays defensive: a stale bundle
  // without the module falls back to the legacy anchor-download /
  // hidden input (same code that used to live inline). The 5d
  // backup-folder system deliberately does NOT ride this — it owns a
  // persistent folder handle with its own permission lifecycle
  // (choose/reconnect/lapsed), incompatible with a save-as picker
  // per write. Cancel = silent exit (ok:false / null), success toast
  // only on ok:true — the standing dialog convention.

  function dialogHost() {
    return (window.orosDialog &&
            typeof window.orosDialog.saveFile === "function")
      ? window.orosDialog : null;
  }

  function shellSaveJson(filename, json) {
    var host = dialogHost();
    if (host) {
      host.saveFile({
        text:     json,
        filename: filename,
        mime:     "application/json"
      }).then(function (res) {
        if (res && res.ok) setSyncMsg("ok", "sync.ok.export");
        // cancel (ok:false) → silent exit
      });
      return;
    }
    // Legacy anchor download (stale bundle)
    try {
      var blob = new Blob([json], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
      setSyncMsg("ok", "sync.ok.export");
    } catch (e) {
      handleSyncError(e);
    }
  }

  function shellPickJson() {
    var host = dialogHost();
    if (host) {
      return host.openFile("application/json,.json");   // Promise<File|null>
    }
    // Legacy hidden input (stale bundle)
    return new Promise(function (resolve) {
      var inp = document.createElement("input");
      inp.type = "file";
      inp.accept = "application/json,.json";
      inp.style.display = "none";
      inp.addEventListener("change", function () {
        var f = inp.files && inp.files[0];
        try { inp.remove(); } catch (e) {}
        resolve(f || null);
      });
      inp.addEventListener("cancel", function () {
        try { inp.remove(); } catch (e) {}
        resolve(null);
      });
      document.body.appendChild(inp);
      inp.click();
    });
  }

  // v0.18.1 — taskbar toast: sync/shortcut messages must be VISIBLE,
  // not buried in the menu. Inline styles only (palette vars —
  // follows every skin, zero new CSS). One toast at a time: a new
  // message replaces the old (pull+push bursts don't stack).
  function scToast(kind, text, onClick) {
    var old = document.getElementById("sc-toast");
    if (old) old.remove();
    var tt = document.createElement("div");
    tt.id = "sc-toast";
    tt.setAttribute("role", "status");
    tt.textContent = text;
    var borderColor = kind === "err" ? "var(--danger)"
                    : kind === "ok" ? "var(--accent)"
                    : "var(--border)";
    // v0.18.2 — Linux convention: OS toasts dock TOP-RIGHT, just below
    // the clock (bar = 40px + safe-area, so +8px breathing room). If the
    // version toast happens to be alive (boot burst), stack below it.
    var extraTop = document.getElementById("version-toast") ? 44 : 0;
    tt.style.cssText =
      "position:fixed;top:calc(48px + env(safe-area-inset-top,0px) + " + extraTop + "px);right:12px;" +
      "transform:translateX(12px);" +
      "background:var(--panel-bg);color:var(--text);border:1px solid " + borderColor + ";" +
      "border-radius:10px;padding:8px 16px;font-size:12.5px;font-weight:600;" +
      "box-shadow:0 8px 24px var(--shadow);opacity:0;transition:opacity .25s,transform .25s;" +
      "z-index:1400;pointer-events:none;max-width:calc(100vw - 24px);text-align:left;";
    document.body.appendChild(tt);
    if (onClick) {
      tt.style.pointerEvents = "auto";
      tt.style.cursor = "pointer";
      tt.addEventListener("click", onClick);
    }
    requestAnimationFrame(function () {
      tt.style.opacity = "1";
      tt.style.transform = "translateX(0)";
    });
    setTimeout(function () {
      tt.style.opacity = "0";
      tt.style.transform = "translateX(12px)";
      setTimeout(function () { tt.remove(); }, 300);
    }, kind === "err" ? 4500 : 2600);
  }

  // Wave 6 — every shell-produced message flows through the unified
  // notification system when the module is present:
  //   dim → TRANSIENT toast (no inbox — busy/ephemeral feedback is
  //         the answer to the user's own click, never history),
  //   ok/err → real emit (inbox + badge + toast), deduplicated to
  //         once per day per (kind + semantic id) — a flaky network
  //         on a 3-min autosync must be one inbox line, not twenty.
  // Module absent (stale bundle) → scToast stands alone (calRemNotify
  // fallback doctrine). state.syncMsg keeps painting the menu section
  // regardless — local UI, not part of the notification flow.
  function sysYmd() {
    var d = new Date();
    var p2 = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate());
  }

  function notifySys(kind, text, ident) {
    var N = window.orosNotifs;
    if (N && typeof N.emit === "function" &&
        typeof N.transient === "function") {
      if (kind === "dim") {
        N.transient({ ns: "system", title: text, body: "" });
      } else {
        var shown = N.emit({
          ns: "system",
          key: "msg-" + kind + "-" + ident + "-" + sysYmd(),
          type: "sys",
          title: "orOS",
          body: text
        });
        // SH-B9: the inbox keeps ONE line per message per day (the
        // key above), so emit() answers null for a repeat — and the
        // second export / pull / "nothing new" of the day used to get
        // no feedback at all. A repeat is still an answer the user is
        // waiting for: show it as a transient toast (no inbox entry,
        // no badge). Only when the silence came from the dedupe — if
        // notifications or the System toggle are off, silence is the
        // user's own choice and stays.
        if (shown === null &&
            typeof N.getSetting === "function" && N.getSetting("enabled", true) &&
            typeof N.getAppToggle === "function" && N.getAppToggle("system")) {
          N.transient({ ns: "system", title: "orOS", body: text });
        }
      }
      return;                    // module handled the toast
    }
    scToast(kind, text);         // stale-bundle fallback
  }

  function setSyncMsg(kind, textKey) {
    state.syncMsg = { kind: kind, text: window.t(textKey) };
    if (kind === "err") setSyncDot("err", 6000);   // parity with setSyncMsgRaw
    notifySys(kind, state.syncMsg.text,
      String(textKey).replace(/[^a-zA-Z0-9]+/g, "-"));
    renderMenu();
  }
  function setSyncMsgRaw(kind, raw) {
    state.syncMsg = { kind: kind, text: raw };
    if (kind === "err") setSyncDot("err", 6000);   // v0.9: red transient
    notifySys(kind, raw, "raw");   // raw messages: one line/day per kind
    renderMenu();
  }
  
  // v0.21.2 — three-way pull outcome: empty cloud → honest
  // "nothing to pull yet"; identical states → calm "nothing new";
  // real changes → the usual count. ONE truth for the menu pull
  // button, the unlock flow and the shortcut.
  function reportPullResult(result) {
    if (result && result.empty) {
      setSyncMsg("ok", "sync.ok.cloud.empty");
      return 0;
    }
    var n = (result && typeof result.applied === "number") ? result.applied : 0;
    if (n === 0) {
      setSyncMsg("ok", "sync.ok.none");
      return 0;
    }
    // "label: n" — reads right for 1 and for many, in both languages.
    setSyncMsgRaw("ok", window.t("sync.ok.pull") + " — " +
      window.t("sync.slices.applied") + ": " + n);
    return n;
  }

  // v0.9 Cloud Lock part 3/5 — Change passphrase dialog.
  // <dialog> element → Esc + native modal semantics for free.
  // Inline styles only (palette vars) — follows every skin, zero
  // new CSS, same doctrine as scToast / wxcity.
  function showChangePassDialog() {
    var stale = document.getElementById("chpw-dialog");
    if (stale) stale.remove();

    var dlg = document.createElement("dialog");
    dlg.id = "chpw-dialog";
    dlg.style.cssText =
      "border:1px solid var(--border);border-radius:12px;" +
      "background:var(--panel-bg);color:var(--text);padding:20px;" +
      "width:min(360px,calc(100vw - 32px));";

    var form = document.createElement("form");
    form.noValidate = true;

    // Field factory: label + password input + eye toggle
    function mkField(labelKey) {
      var wrap = document.createElement("div");
      wrap.style.marginBottom = "12px";
      var head = document.createElement("div");
      head.style.cssText =
        "font-size:12px;font-weight:600;color:var(--text-dim);margin-bottom:4px;";
      head.textContent = window.t(labelKey);
      wrap.appendChild(head);
      var row = document.createElement("div");
      row.style.cssText = "display:flex;gap:6px;";
      var input = document.createElement("input");
      input.type = "password";
      input.autocomplete = "off";
      input.style.cssText =
        "flex:1;min-width:0;padding:7px 10px;border:1px solid var(--border);" +
        "border-radius:8px;background:var(--panel-bg);color:var(--text);" +
        "font-size:13px;outline:none;";
      var eye = document.createElement("button");
      eye.type = "button";
      eye.style.cssText =
        "border:1px solid var(--border);border-radius:8px;background:transparent;" +
        "color:var(--text-dim);cursor:pointer;width:34px;display:flex;" +
        "align-items:center;justify-content:center;";
      eye.innerHTML = EYE_SVG;
      eye.setAttribute("aria-label", window.t("sync.pass.show"));
      eye.addEventListener("click", function () {
        var show = input.type === "password";
        input.type = show ? "text" : "password";
        eye.innerHTML = show ? EYE_OFF_SVG : EYE_SVG;
        input.focus();
      });
      row.appendChild(input);
      row.appendChild(eye);
      wrap.appendChild(row);
      return { wrap: wrap, input: input };
    }

    var title = document.createElement("h3");
    title.style.cssText = "margin:0 0 6px;font-size:14px;";
    title.textContent = window.t("sync.changepw");
    form.appendChild(title);

    var hint = document.createElement("div");
    hint.style.cssText =
      "font-size:11.5px;line-height:1.5;color:var(--text-dim);margin-bottom:14px;";
    hint.textContent = window.t("sync.changepw.hint");
    form.appendChild(hint);

    var oldF = mkField("sync.changepw.old");
    var newF = mkField("sync.changepw.new");
    var cfF  = mkField("sync.changepw.confirm");
    form.appendChild(oldF.wrap);
    form.appendChild(newF.wrap);
    form.appendChild(cfF.wrap);

    var rememberRow = document.createElement("label");
    rememberRow.style.cssText =
      "display:flex;align-items:center;gap:8px;font-size:12px;" +
      "color:var(--text-dim);margin-bottom:10px;cursor:pointer;";
    var rememberCb = document.createElement("input");
    rememberCb.type = "checkbox";
    rememberCb.checked = window.orosSync.hasDeviceVault();
    rememberRow.appendChild(rememberCb);
    var rememberTxt = document.createElement("span");
    rememberTxt.textContent = window.t("sync.pass.remember");
    rememberRow.appendChild(rememberTxt);
    form.appendChild(rememberRow);

    var errBox = document.createElement("div");
    errBox.style.cssText =
      "font-size:12px;color:var(--danger);min-height:18px;margin:2px 0 8px;";
    form.appendChild(errBox);

    var btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;gap:8px;justify-content:flex-end;";

    var cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.style.cssText =
      "border:1px solid var(--border);border-radius:8px;background:transparent;" +
      "color:var(--text-dim);padding:7px 14px;font-size:12.5px;font-weight:600;" +
      "cursor:pointer;";
    cancelBtn.textContent = window.t("wx.cancel");
    cancelBtn.addEventListener("click", function () { dlg.close(); });
    btnRow.appendChild(cancelBtn);

    var okBtn = document.createElement("button");
    okBtn.type = "submit";
    okBtn.style.cssText =
      "border:1px solid var(--accent);border-radius:8px;background:var(--accent);" +
      "color:#fff;padding:7px 14px;font-size:12.5px;font-weight:600;cursor:pointer;";
    okBtn.textContent = window.t("sync.changepw.ok");
    btnRow.appendChild(okBtn);

    form.appendChild(btnRow);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      errBox.textContent = "";
      var oldPw = oldF.input.value;
      var newPw = newF.input.value;
      var cf    = cfF.input.value;
      if (!oldPw || !newPw || !cf) { errBox.textContent = window.t("sync.err.nopass"); return; }
      if (newPw !== cf) { errBox.textContent = window.t("sync.changepw.mismatch"); return; }
      if (newPw === oldPw) { errBox.textContent = window.t("sync.changepw.same"); return; }
      if (newPw.length < MIN_PASS_LEN) { errBox.textContent = window.t("sync.err.shortpass"); return; }   // A70
      okBtn.disabled = true;
      okBtn.textContent = window.t("sync.working");
      window.orosSync.changePassphrase(oldPw, newPw, rememberCb.checked)
        .then(function () {
          dlg.close();
          setSyncMsg("ok", "sync.ok.changepw");
          // Converge immediately: pull with the new passphrase, then
          // push if this device had unsynced edits (see Patch A3).
          if (typeof window.orosSync.kickAutoEngine === "function") {
            window.orosSync.kickAutoEngine();
          }
          renderMenu();
        })
        .catch(function (err) {
          okBtn.disabled = false;
          okBtn.textContent = window.t("sync.changepw.ok");
          if (err && err.message === "wrong-passphrase") {
            errBox.textContent = window.t("sync.err.wrongold");
          } else {
            dlg.close();
            handleSyncError(err);
          }
        });
    });

    dlg.appendChild(form);
    dlg.addEventListener("click", function (e) {
      if (e.target === dlg) dlg.close();
    });
    document.body.appendChild(dlg);
    dlg.showModal();
    setTimeout(function () { oldF.input.focus(); }, 50);
  }

  // Unlock with a passphrase (menu form + Settings app). One flow:
  // set, pull, then seal into the device vault only after the pull.
  function syncUnlock(pw, remember) {
    if (!pw) { setSyncMsg("err", "sync.err.nopass"); return; }
    // A70: an EMPTY cloud means this passphrase is being SET, not
    // checked — it must be at least MIN_PASS_LEN long (an existing
    // shorter one still unlocks). The device vault seals it only
    // after the pull (A71b: a mistyped passphrase is no longer
    // remembered); a pull that fails for any other reason
    // (offline) still seals it, as before.
    window.orosSync.setPassphrase(pw, false);
    setSyncMsgRaw("dim", window.t("sync.working"));
    setSyncDot("syncing");
    // Visible auto-pull on unlock: apply cloud state immediately,
    // then push if this device had unsynced changes.
    window.orosSync.pull()
      .then(function (result) {
        if (result && result.empty && pw.length < MIN_PASS_LEN) {
          window.orosSync.forgetPassphrase();
          setSyncMsg("err", "sync.err.shortpass");
          return;
        }
        if (remember) window.orosSync.setPassphrase(pw, true);
        reportPullResult(result);
        if (window.orosSync.isDirty()) {
          return window.orosSync.push()
            .then(function () { setSyncMsg("ok", "sync.ok.push"); });
        }
      })
      .catch(function (err) {
        if (remember && !isPassphraseError(err)) window.orosSync.setPassphrase(pw, true);
        handleSyncError(err);
      });
  }

  // Manual push with the "working" line (menu + Settings app).
  function syncPushNow() {
    if (!scRequireConnected()) return;
    setSyncMsgRaw("dim", window.t("sync.working"));
    setSyncDot("syncing");
    window.orosSync.push()
      .then(function () { setSyncMsg("ok", "sync.ok.push"); setSyncDot("synced", 4000); })
      .catch(handleSyncError);
  }

  // User picked an auto-sync interval: it travels in the shell slice.
  function setSyncIntervalUser(m) {
    if (!window.orosSync || typeof window.orosSync.setIntervalMinutes !== "function") return;
    if ([0, 1, 3, 5, 15].indexOf(m) === -1 || m === getSafeInterval()) return;
    window.orosSync.setIntervalMinutes(m);
    noteLocalChange();
    renderMenu();
  }

  // Forget the passphrase on this device (and its vault, if any).
  function syncForgetHere() {
    if (!window.orosSync) return;
    if (window.orosSync.hasDeviceVault()) {
      window.orosSync.clearDevice().then(function () { renderMenu(); });
    } else {
      window.orosSync.forgetPassphrase();
      renderMenu();
    }
  }

  function syncDisconnectUser() {
    if (!window.orosSync) return;
    window.orosSync.disconnect();
    state.syncUserEmail = null;
    renderMenu();
  }

  // User picked an automatic folder-backup cadence (shell slice).
  function setAutoexportUser(v) {
    if (v !== "off" && v !== "daily" && v !== "weekly" && v !== "monthly") return;
    if (v === state.autoexport) return;
    state.autoexport = v;
    localStorage.setItem(AUTOEXPORT_PREF, state.autoexport);
    noteLocalChange();          // travels in the shell slice
    // Off = zero footprint going forward — no checks, no files.
    // Switched on (or changed cadence): export NOW so the user
    // sees instant feedback that the folder net is active.
    if (state.autoexport !== "off") maybeAutoExport(true);
    renderMenu();
  }

  // Import a backup file: every slice + the Files disk (FILES-V).
  function importBackupFile() {
    shellPickJson().then(function (file) {
      if (!file) return;   // user cancelled — silent exit
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var text = String(reader.result);
          var n = window.orosSync.importData(text);
          // FILES-V: the backup's disk is merged into the disk here
          // (the engine no longer knows a "files-disk" slice).
          fdImportDisk(text).then(function (files) {
            setSyncMsgRaw("ok", window.t("sync.ok.import") + " — " +
              window.t("sync.slices.applied") + ": " + (n + (files > 0 ? 1 : 0)));
          }).catch(function () {
            setSyncMsgRaw("ok", window.t("sync.ok.import") + " — " +
              window.t("sync.slices.applied") + ": " + n);
          });
        } catch (e) {
          handleSyncError(e); }
      };
      reader.readAsText(file);
    });
  }

    // v0.9 Part 4 — "passphrase changed on another device" dialog.
  // Entered from ANY passphrase-class sync failure (auto reconcile,
  // manual pull/push, unlock flow). Retry-friendly: a second wrong
  // entry stays IN the dialog; success closes it and converges.
  function showPassChangedDialog() {
    var stale = document.getElementById("pwfix-dialog");
    if (stale) return;                          // already open
    closeMenu();

    var dlg = document.createElement("dialog");
    dlg.id = "pwfix-dialog";
    dlg.style.cssText =
      "border:1px solid var(--border);border-radius:12px;" +
      "background:var(--panel-bg);color:var(--text);padding:20px;" +
      "width:min(360px,calc(100vw - 32px));";

    var form = document.createElement("form");
    form.noValidate = true;

    var title = document.createElement("h3");
    title.style.cssText = "margin:0 0 6px;font-size:14px;";
    title.textContent = window.t("sync.pwfix.title");
    form.appendChild(title);

    var hint = document.createElement("div");
    hint.style.cssText =
      "font-size:11.5px;line-height:1.5;color:var(--text-dim);margin-bottom:14px;";
    hint.textContent = window.orosSync.hasDeviceVault()
      ? window.t("sync.pwfix.hint.vault")
      : window.t("sync.pwfix.hint");
    form.appendChild(hint);

    var row = document.createElement("div");
    row.style.cssText = "display:flex;gap:6px;margin-bottom:10px;";
    var input = document.createElement("input");
    input.type = "password";
    input.autocomplete = "off";
    input.style.cssText =
      "flex:1;min-width:0;padding:7px 10px;border:1px solid var(--border);" +
      "border-radius:8px;background:var(--panel-bg);color:var(--text);" +
      "font-size:13px;outline:none;";
    var eye = document.createElement("button");
    eye.type = "button";
    eye.style.cssText =
      "border:1px solid var(--border);border-radius:8px;background:transparent;" +
      "color:var(--text-dim);cursor:pointer;width:34px;display:flex;" +
      "align-items:center;justify-content:center;";
    eye.innerHTML = EYE_SVG;
    eye.setAttribute("aria-label", window.t("sync.pass.show"));
    eye.addEventListener("click", function () {
      var show = input.type === "password";
      input.type = show ? "text" : "password";
      eye.innerHTML = show ? EYE_OFF_SVG : EYE_SVG;
      input.focus();
    });
    row.appendChild(input);
    row.appendChild(eye);
    form.appendChild(row);

    var rememberRow = document.createElement("label");
    rememberRow.style.cssText =
      "display:flex;align-items:center;gap:8px;font-size:12px;" +
      "color:var(--text-dim);margin-bottom:10px;cursor:pointer;";
    var rememberCb = document.createElement("input");
    rememberCb.type = "checkbox";
    rememberCb.checked = window.orosSync.hasDeviceVault();  // re-seal by default if trusted before
    rememberRow.appendChild(rememberCb);
    var rt = document.createElement("span");
    rt.textContent = window.t("sync.pass.remember");
    rememberRow.appendChild(rt);
    form.appendChild(rememberRow);

    var errBox = document.createElement("div");
    errBox.style.cssText = "font-size:12px;color:var(--danger);min-height:18px;margin:2px 0 8px;";
    form.appendChild(errBox);

    var btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;gap:8px;justify-content:flex-end;";
    var cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.style.cssText =
      "border:1px solid var(--border);border-radius:8px;background:transparent;" +
      "color:var(--text-dim);padding:7px 14px;font-size:12.5px;font-weight:600;cursor:pointer;";
    cancelBtn.textContent = window.t("wx.cancel");
    cancelBtn.addEventListener("click", function () { dlg.close(); });
    btnRow.appendChild(cancelBtn);

    var okBtn = document.createElement("button");
    okBtn.type = "submit";
    okBtn.style.cssText =
      "border:1px solid var(--accent);border-radius:8px;background:var(--accent);" +
      "color:#fff;padding:7px 14px;font-size:12.5px;font-weight:600;cursor:pointer;";
    okBtn.textContent = window.t("sync.pass.apply");
    btnRow.appendChild(okBtn);
    form.appendChild(btnRow);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      errBox.textContent = "";
      var pw = input.value;
      if (!pw) { errBox.textContent = window.t("sync.err.nopass"); return; }
      okBtn.disabled = true;
      okBtn.textContent = window.t("sync.working");
      window.orosSync.setPassphrase(pw, rememberCb.checked);
      window.orosSync.pull()
        .then(function (result) {
          dlg.close();
          reportPullResult(result);
          setSyncDot("synced", 4000);
          // If the accepted passphrase surfaced local unsynced work,
          // push it now — guarded by the same Trap-3 protection.
          if (window.orosSync.isDirty()) {
            window.orosSync.push()
              .then(function () { setSyncMsg("ok", "sync.ok.push"); })
              .catch(handleSyncError);
          }
          renderMenu();
        })
        .catch(function (err) {
          okBtn.disabled = false;
          okBtn.textContent = window.t("sync.pass.apply");
          if (isPassphraseError(err)) {
            errBox.textContent = window.t("sync.pwfix.err");
          } else {
            dlg.close();
            handleSyncError(err);
          }
        });
    });

    dlg.appendChild(form);
    dlg.addEventListener("click", function (e) {
      if (e.target === dlg) dlg.close();
    });
    document.body.appendChild(dlg);
    dlg.showModal();
    setTimeout(function () { input.focus(); }, 50);
  }
  
    // v0.9 Part 4 — passphrase-class errors (OperationError from a
  // failed decrypt, wrong-passphrase from the push guard) open the
  // dedicated "changed on another device?" dialog instead of the
  // misleading generic toast. This is exactly the UX that would
  // have saved us the entire factory-reset debugging saga.
  // A70: minimum length of a passphrase that is being SET (a new
  // cloud, a passphrase change). Unlocking with an existing shorter
  // one keeps working.
  var MIN_PASS_LEN = 10;

  function isPassphraseError(err) {
    return (err && err.name === "OperationError") ||
           (err && err.message === "wrong-passphrase");
  }

  function handleSyncError(err) {
    if (isPassphraseError(err) &&
        window.orosSync && window.orosSync.isConnected()) {
      showPassChangedDialog();
      return;
    }
    // Χ6: engine missing (stale bundle / load-order edge) — surface the
    // real message, never a nested TypeError that buries it.
    if (!window.orosSync || typeof window.orosSync.errorKey !== "function") {
      setSyncMsgRaw("err", (err && err.message) ? err.message : String(err));
      return;
    }
    var key = window.orosSync.errorKey(err);
    if (key === "sync.err.generic") { setSyncMsgRaw("err", syncErrText(err)); return; }
    setSyncMsg("err", key);
  }

  // SY-L2: the message for a failed sync, with the technical reason
  // when the engine only knows "generic" ("Sync failed — check your
  // connection (upload failed: 429)"). Plain text, shown with
  // textContent only.
  function syncErrText(err) {
    var S = window.orosSync;
    var key = (S && typeof S.errorKey === "function") ? S.errorKey(err) : "sync.err.generic";
    var text = window.t(key);
    if (key === "sync.err.generic") {
      var why = String((err && (err.message || err.name)) || "").replace(/[\u0000-\u001f]/g, " ").slice(0, 120);
      if (why) text += " (" + why + ")";
    }
    return text;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function getSafeInterval() {
    if (window.orosSync && typeof window.orosSync.getIntervalMinutes === "function") {
      return window.orosSync.getIntervalMinutes();
    }
    return 3;
  }
  
    // ---------- 9b. Taskbar sync dot (v0.18.0) ----------
  // SINGLE OS-wide sync indicator. The menu copy was removed; the
  // dot auto-derives its state every clock tick (cheap) and holds
  // transient states (synced/err) briefly after manual operations.
  var syncDotHold = 0;

  function setSyncDot(status, holdMs) {
    var dot = document.getElementById("sync-dot");
    if (!dot) return;
    syncDotHold = holdMs ? (Date.now() + holdMs) : 0;
    dot.setAttribute("data-state", status);
    var key = "syncdot." + status;
    // TP-guard: σε load-order race το window.t μπορεί να λείπει ακόμα —
    // το tooltip πέφτει στο raw status αντί να σκοτώνει το tick chain.
    var title = (typeof window.t === "function") ? window.t(key) : key;
    dot.parentNode.setAttribute("title", title !== key ? title : status);
    if (typeof window.t === "function") {
      dot.parentNode.setAttribute("aria-label", window.t("sync.dot.aria"));
    }
  }

  function autoSyncDot() {
    var dot = document.getElementById("sync-dot");
    if (!dot) return;
    if (syncDotHold && Date.now() < syncDotHold) return;
    syncDotHold = 0;
    var s = "off";
    if (window.orosSync && window.orosSync.isConnected()) {
      s = window.orosSync.hasPassphrase()
        ? (window.orosSync.isDirty() ? "dirty" : "idle")
        : "locked";
    }
    if (dot.getAttribute("data-state") !== s) {
      dot.setAttribute("data-state", s);
      var key = "syncdot." + s;
      // TP-guard: ίδιο race με το setSyncDot — το tooltip πέφτει στο
      // raw state, ο tick δεν πεθαίνει ποτέ εδώ.
      var title = (typeof window.t === "function") ? window.t(key) : key;
      dot.parentNode.setAttribute("title", title !== key ? title : s);
    }
  }
  
    // ---------- 9c. Global shortcuts + Info modal (v0.18.0) ----------
  // Contract Β: ALL handlers live in the shell. iframe apps forward
  // via the canonical capture-phase template (parity with
  // todo/kanban/writer/notes). SC_DEFS is the single
  // source of truth — the Info modal table is generated from it, so
  // a shortcut can never go missing from the docs.

  function scRequireConnected() {
    if (window.orosSync && window.orosSync.isConnected()) return true;
    setSyncMsg("err", "sc.err.notconnected");
    return false;
  }

  function scForcePush() {
    if (!scRequireConnected()) return;
    setSyncDot("syncing");
    window.orosSync.push()
      .then(function () { setSyncMsg("ok", "sync.ok.push"); setSyncDot("synced", 4000); })
      .catch(handleSyncError);
  }

  function scForcePull() {
    if (!scRequireConnected()) return;
    setSyncDot("syncing");
    window.orosSync.pull()
      .then(function (result) {
        reportPullResult(result);
        setSyncDot("synced", 4000);
      })
      .catch(handleSyncError);
  }

  function scBackupNow() {
    // SH-B4: no File System Access API (Firefox, Safari, mobile) →
    // "backup now" is the manual DB export. Never a silent no-op, and
    // never an error about a setting this browser does not show.
    if (!fsSupported()) { scExportDb(); return; }
    // Folder-export trigger: honest error when auto-backup is OFF.
    if (state.autoexport === "off") {
      setSyncMsgRaw("err", window.t("sync.err.autobackup.off"));
      return;
    }
    // SH-B10: the mode is on but no folder was ever chosen — the
    // export below would stamp its schedule and write nothing, in
    // silence. Say what is missing.
    var hasFolder = false;
    try { hasFolder = !!localStorage.getItem(FS_FOLDER_NAME_KEY); } catch (e) {}
    if (!hasFolder) {
      setSyncMsg("err", "sync.fsfolder.choosefirst");
      return;
    }
    // Dispatch a LIVE folder export NOW. The "saved" confirmation
    // fires inside writeBackupFile — only when the file really
    // landed in the user-chosen folder.
    maybeAutoExport(true);
  }

  function scExportDb() {
    // Same content as the menu export button.
    var exportJob;
    try { exportJob = fdExportJson(); } catch (e) { handleSyncError(e); return; }
    exportJob.then(function (json) {
      shellSaveJson(
        "orOS-backup-" + new Date().toISOString().slice(0, 10) + ".json",
        json);
    }).catch(handleSyncError);
  }

  function scCheckUpdates() {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.getRegistration()
      .then(function (r) { return r ? r.update() : null; })
      .catch(function () {});
    setSyncMsgRaw("dim", window.t("update.checking"));
  }

  function scToggleLang() {
    state.lang = state.lang === "en" ? "el" : "en";
    localStorage.setItem("oros-lang", state.lang);
    noteLocalChange();
    applyLang();
    refreshRunningApp();          // opened apps follow the language too
  }

  function scReconnect() {
    if (!window.orosSync) return;
    if (!window.orosSync.isConnected()) {
      window.orosSync.connect();
    } else {
      // Connected but folder permission may have lapsed — same one-click
      // re-grant path the menu uses (requestPermission is click-legal
      // only inside a user gesture — a shortcut counts).
      reconnectFolder();
    }
  }
  
    // ---------- Support / donations (Info modal only — no footer) ----------
  // Plain <a> links, NEVER platform widgets: embeds mean third-party
  // scripts/requests — violates the no-tracking doctrine. Opened in
  // a new tab with rel=noopener (same contract as the repo link).
  // i18n: inline EN/EL literals via supT() — same doctrine as
  // calRemT/cycleT; no translations.js dependency.
  var SUPPORT_OPTS = [
    {
      name: "Ko-fi",
      url:  "https://ko-fi.com/koulaxizis",
      en:   "Buy me a coffee!",
      el:   "Κέρασέ με έναν καφέ!"
    }
  ];

  function supT(en, el) {
    return state.lang === "el" ? el : en;
  }

  function wireSupportSection(ov) {
    var box = ov.querySelector(".sc-box");
    if (!box) return;
    var resetWrap = box.querySelector("#sc-reset-wrap");

    var sec = document.createElement("div");
    sec.id = "sc-support";

    var head = document.createElement("div");
    head.className = "sc-sec";
    head.textContent = supT("Support", "Στήριξη");
    sec.appendChild(head);

    var intro = document.createElement("div");
    intro.style.cssText =
      "font-size:11.5px;line-height:1.5;color:var(--text-dim);margin:2px 0 8px;";
    intro.textContent = supT(
      "orOS is free, open source, and self-hostable. If it helps you, consider supporting it.",
      "Το orOS είναι δωρεάν, ανοιχτού κώδικα και self-hostable. Αν σε βοηθάει, σκέψου να το στηρίξεις."
    );
    sec.appendChild(intro);

    var cards = document.createElement("div");
    cards.style.cssText =
      "display:flex;flex-direction:column;gap:6px;margin-bottom:8px;";
    SUPPORT_OPTS.forEach(function (opt) {
      var a = document.createElement("a");
      a.href = opt.url;
      a.target = "_blank";
      a.rel = "noopener";
      a.style.cssText =
        "display:flex;align-items:baseline;justify-content:space-between;" +
        "gap:10px;padding:8px 10px;border:1px solid var(--border);" +
        "border-radius:8px;color:var(--text);text-decoration:none;" +
        "font-size:12.5px;font-weight:600;flex-wrap:wrap;";
      var nm = document.createElement("span");
      nm.textContent = opt.name;
      var ds = document.createElement("span");
      ds.style.cssText =
        "font-size:11px;color:var(--text-dim);font-weight:400;";
      ds.textContent = supT(opt.en, opt.el);
      a.appendChild(nm);
      a.appendChild(ds);
      cards.appendChild(a);
    });
    sec.appendChild(cards);

    if (resetWrap) box.insertBefore(sec, resetWrap);
    else box.appendChild(sec);
  }

  // ---------- Credits & licences (Info modal) ----------
  // Every third-party piece orOS ships or calls, with its licence and
  // a link: libraries, fonts, data sets, online services, hosting.
  // Same register as CREDITS.md at the repo root and the "Credits
  // register" in OROS_BIBLE.md: a new dependency or service updates
  // all three. Built with createElement/textContent only; every URL
  // below is a fixed constant (never data from a service or a user).
  // i18n: inline EN/EL via supT(), same doctrine as the Support box.
  var CREDIT_GROUPS = [
    {
      en: "Libraries (bundled, run on your device)",
      el: "Βιβλιοθήκες (μέσα στο orOS, τρέχουν στη συσκευή σου)",
      items: [
        { name: "Leaflet 1.9.4", url: "https://leafletjs.com/",
          by: "Volodymyr Agafonkin & contributors", lic: "BSD-2-Clause",
          en: "Maps", el: "Χάρτες" },
        { name: "jsPDF 2.5.2", url: "https://github.com/parallax/jsPDF",
          by: "James Hall, yWorks & contributors", lic: "MIT",
          en: "PDF export (Mood, Cycle, Quote, Writer, Netizen ID, Spreadsheet, Budget)",
          el: "Εξαγωγή PDF (Mood, Cycle, Quote, Writer, Netizen ID, Spreadsheet, Budget)" },
        { name: "SheetJS Community Edition 0.20.3", url: "https://sheetjs.com/",
          by: "SheetJS LLC", lic: "Apache-2.0",
          en: "Excel / ODS files (Spreadsheet, Budget)",
          el: "Αρχεία Excel / ODS (Spreadsheet, Budget)" },
        { name: "hls.js 1.7.3", url: "https://github.com/video-dev/hls.js",
          by: "Dailymotion & contributors", lic: "Apache-2.0",
          en: "Live streams (Television)", el: "Ζωντανές ροές (Τηλεόραση)" }
      ]
    },
    {
      en: "Fonts and icons", el: "Γραμματοσειρές και εικονίδια",
      items: [
        { name: "Nunito", url: "https://github.com/googlefonts/nunito",
          by: "The Nunito Project Authors (Vernon Adams, Jacques Le Bailly)", lic: "SIL OFL 1.1",
          en: "The orOS interface", el: "Το περιβάλλον του orOS" },
        { name: "Noto Sans", url: "https://notofonts.github.io/",
          by: "The Noto Project Authors", lic: "SIL OFL 1.1",
          en: "Greek text in exported PDFs", el: "Ελληνικά στα PDF που εξάγεις" },
        { name: "Noto Sans, Noto Serif, Noto Sans Mono", url: "https://notofonts.github.io/",
          by: "The Noto Project Authors", lic: "SIL OFL 1.1",
          en: "The fonts of Layout documents (screen and PDF)", el: "Οι γραμματοσειρές των εγγράφων της Σελιδοποίησης (οθόνη και PDF)" },
        { name: "Feather Icons", url: "https://feathericons.com/",
          by: "Cole Bemis", lic: "MIT",
          en: "Some interface icons (search, refresh, map pin, cloud, heart)",
          el: "Μερικά εικονίδια του περιβάλλοντος (αναζήτηση, ανανέωση, πινέζα, σύννεφο, καρδιά)" },
        { name: "Tabler Icons 3.49.0", url: "https://tabler.io/icons",
          by: "Paweł Kuna", lic: "MIT",
          en: "Offline icon library (Atelier)", el: "Βιβλιοθήκη εικονιδίων χωρίς σύνδεση (Ατελιέ)" }
      ]
    },
    {
      en: "Word lists and data", el: "Λίστες λέξεων και δεδομένα",
      items: [
        { name: "EFF Diceware word lists", url: "https://www.eff.org/dice",
          by: "Electronic Frontier Foundation", lic: "CC BY 3.0 US",
          en: "Passphrases (Passwords)", el: "Φράσεις-κλειδιά (Κωδικοί)" },
        { name: "SecLists — 10k most common passwords", url: "https://github.com/danielmiessler/SecLists",
          by: "Daniel Miessler & contributors", lic: "MIT",
          en: "Weak-password check (Passwords)", el: "Έλεγχος αδύναμων κωδικών (Κωδικοί)" },
        { name: "SCOWL (via wordlist-english)", url: "http://wordlist.aspell.net/",
          by: "Kevin Atkinson", lic: { en: "SCOWL licence (permissive)", el: "Άδεια SCOWL (ελεύθερη)" },
          en: "English words (Wordle, Hangman)", el: "Αγγλικές λέξεις (Wordle, Κρεμάλα)" },
        { name: "Hunspell el_GR", url: "https://github.com/wooorm/dictionaries",
          by: "Steve Stavropoulos & contributors (elspell)", lic: "MPL 1.1",
          en: "Greek words (Λεξούλα, Hangman)", el: "Ελληνικές λέξεις (Λεξούλα, Κρεμάλα)" },
        { name: "FrequencyWords", url: "https://github.com/hermitdave/FrequencyWords",
          by: "Hermit Dave (from OpenSubtitles)", lic: "CC BY-SA 4.0",
          en: "Picking everyday words (Λεξούλα, Hangman)", el: "Επιλογή καθημερινών λέξεων (Λεξούλα, Κρεμάλα)" }
      ]
    },
    {
      en: "Online services (only when you use them)",
      el: "Υπηρεσίες στο διαδίκτυο (μόνο όταν τις χρησιμοποιείς)",
      items: [
        { name: "Open-Meteo", url: "https://open-meteo.com/",
          by: "Open-Meteo.com", lic: "CC BY 4.0 (data)",
          en: "Weather, places, air quality", el: "Καιρός, τοποθεσίες, ποιότητα αέρα" },
        { name: "OpenStreetMap", url: "https://www.openstreetmap.org/copyright",
          by: "OpenStreetMap contributors", lic: "ODbL (data)",
          en: "Map data and standard tiles (Maps)", el: "Δεδομένα και πλακίδια χάρτη (Χάρτες)" },
        { name: "OpenStreetMap France / HOT", url: "https://www.hotosm.org/",
          by: "OSM France, Humanitarian OpenStreetMap Team", lic: "ODbL (data)",
          en: "Humanitarian map layer (Maps)", el: "Ανθρωπιστικό στρώμα χάρτη (Χάρτες)" },
        { name: "Esri World Imagery", url: "https://www.esri.com/",
          by: "Esri, Maxar, Earthstar Geographics", lic: { en: "Esri terms of use", el: "Όροι χρήσης της Esri" },
          en: "Satellite layer (Maps)", el: "Δορυφορικό στρώμα (Χάρτες)" },
        { name: "Photon", url: "https://photon.komoot.io/",
          by: "komoot", lic: "Apache-2.0 (software), ODbL (data)",
          en: "Place search (Maps)", el: "Αναζήτηση τοποθεσιών (Χάρτες)" },
        { name: "OSRM", url: "https://project-osrm.org/",
          by: "Project OSRM contributors", lic: "BSD-2-Clause (software)",
          en: "Car routes, demo server (Maps)", el: "Διαδρομές με αυτοκίνητο, δοκιμαστικός server (Χάρτες)" },
        { name: "FOSSGIS routing", url: "https://routing.openstreetmap.de/",
          by: "FOSSGIS e.V.", lic: "ODbL (data)",
          en: "Bike and walking routes (Maps)", el: "Διαδρομές με ποδήλατο και με τα πόδια (Χάρτες)" },
        { name: "Radio Browser", url: "https://www.radio-browser.info/",
          by: "Alex Segler & the community", lic: { en: "Free community API", el: "Δωρεάν κοινοτικό API" },
          en: "Station directory (Radio)", el: "Κατάλογος σταθμών (Ραδιόφωνο)" },
        { name: "iptv-org", url: "https://github.com/iptv-org/iptv",
          by: "iptv-org contributors", lic: "Unlicense (public domain)",
          en: "Channel directory (Television)", el: "Κατάλογος καναλιών (Τηλεόραση)" },
        { name: "Wikidata", url: "https://www.wikidata.org/",
          by: "Wikidata editors, Wikimedia Foundation", lic: "CC0 (data)",
          en: "Authors and works (Public Domain)", el: "Δημιουργοί και έργα (Κοινό κτήμα)" },
        { name: "Openverse", url: "https://openverse.org/",
          by: "WordPress.org, the creators of every work", lic: { en: "Per item (CC / public domain)", el: "Ανά έργο (CC / κοινό κτήμα)" },
          en: "Photos, illustrations, sounds (Atelier)", el: "Φωτογραφίες, εικονογραφήσεις, ήχοι (Ατελιέ)" },
        { name: "Wikimedia Commons", url: "https://commons.wikimedia.org/",
          by: "Commons contributors, Wikimedia Foundation", lic: { en: "Per item (free licences)", el: "Ανά έργο (ελεύθερες άδειες)" },
          en: "Photos, drawings, sounds, video (Atelier)", el: "Φωτογραφίες, σχέδια, ήχοι, βίντεο (Ατελιέ)" },
        { name: "Iconify", url: "https://iconify.design/",
          by: "Vjacheslav Trushkin & the authors of each icon set", lic: { en: "Per icon set (MIT, Apache, CC BY, OFL…)", el: "Ανά σετ εικονιδίων (MIT, Apache, CC BY, OFL…)" },
          en: "Icons and clipart (Atelier)", el: "Εικονίδια και clipart (Ατελιέ)" },
        { name: "Fontsource", url: "https://fontsource.org/",
          by: "Fontsource & each font's designers", lic: { en: "Per font (OFL, Apache)", el: "Ανά γραμματοσειρά (OFL, Apache)" },
          en: "Font catalogue and files (Atelier)", el: "Κατάλογος και αρχεία γραμματοσειρών (Ατελιέ)" },
        { name: "Pixabay", url: "https://pixabay.com/",
          by: "Pixabay creators", lic: { en: "Pixabay Content License, your own key", el: "Pixabay Content License, με δικό σου κλειδί" },
          en: "Optional photos and video (Atelier)", el: "Προαιρετικές φωτογραφίες και βίντεο (Ατελιέ)" },
        { name: "Pexels", url: "https://www.pexels.com/",
          by: "Pexels creators", lic: { en: "Pexels License, your own key", el: "Pexels License, με δικό σου κλειδί" },
          en: "Optional photos and video (Atelier)", el: "Προαιρετικές φωτογραφίες και βίντεο (Ατελιέ)" },
        { name: "Cloudflare Workers", url: "https://workers.cloudflare.com/",
          by: "Cloudflare, Inc.", lic: { en: "Runs the orOS mail relay (code in relay/)", el: "Τρέχει το relay αλληλογραφίας του orOS (κώδικας στο relay/)" },
          en: "Mail: IMAP over HTTPS, nothing stored", el: "Αλληλογραφία: IMAP μέσω HTTPS, δεν αποθηκεύεται τίποτα" },
        { name: "Dropbox", url: "https://www.dropbox.com/",
          by: "Dropbox, Inc.", lic: { en: "Your own account", el: "Ο δικός σου λογαριασμός" },
          en: "Optional encrypted sync", el: "Προαιρετικός κρυπτογραφημένος συγχρονισμός" },
        { name: "GitHub Pages", url: "https://pages.github.com/",
          by: "GitHub, Inc.", lic: { en: "Hosting", el: "Φιλοξενία" },
          en: "Serves useoros.online", el: "Φιλοξενεί το useoros.online" }
      ]
    }
  ];

  function creditsThanksText() {
    return supT(
      "Thank you to everyone who builds and shares these, often without knowing orOS exists. Radio and TV streams belong to their broadcasters. Full details: CREDITS.md in the source code.",
      "Ευχαριστούμε όσους φτιάχνουν και μοιράζονται όλα αυτά, συχνά χωρίς να ξέρουν ότι υπάρχει το orOS. Οι ροές ραδιοφώνου και τηλεόρασης ανήκουν στους σταθμούς τους. Όλες οι λεπτομέρειες: CREDITS.md στον πηγαίο κώδικα."
    );
  }

  function creditLink(href, text) {
    var a = document.createElement("a");
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = text;
    return a;
  }

  function wireCreditsSection(ov) {
    var box = ov.querySelector(".sc-box");
    if (!box) return;
    var resetWrap = box.querySelector("#sc-reset-wrap");

    var det = document.createElement("details");
    det.id = "sc-credits";
    var sum = document.createElement("summary");
    sum.className = "sc-sec";
    sum.style.cssText = "cursor:pointer;";
    sum.textContent = supT("Credits & licences", "Ευχαριστίες & άδειες");
    det.appendChild(sum);

    var intro = document.createElement("div");
    intro.style.cssText =
      "font-size:11.5px;line-height:1.5;color:var(--text-dim);margin:2px 0 6px;";
    intro.textContent = creditsThanksText();
    det.appendChild(intro);

    CREDIT_GROUPS.forEach(function (g) {
      var gh = document.createElement("div");
      gh.style.cssText =
        "font-size:12px;font-weight:700;color:var(--text);margin:10px 0 2px;";
      gh.textContent = supT(g.en, g.el);
      det.appendChild(gh);
      g.items.forEach(function (it) {
        var row = document.createElement("div");
        row.style.cssText =
          "font-size:11.5px;line-height:1.5;color:var(--text-dim);" +
          "padding:3px 0;overflow-wrap:anywhere;";
        var nm = creditLink(it.url, it.name);
        nm.style.cssText = "color:var(--accent);font-weight:600;text-decoration:none;";
        row.appendChild(nm);
        row.appendChild(document.createTextNode(
          " · " + it.by + " · " +
          (typeof it.lic === "string" ? it.lic : supT(it.lic.en, it.lic.el)) +
          " — " + supT(it.en, it.el)));
        det.appendChild(row);
      });
    });

    if (resetWrap) box.insertBefore(det, resetWrap);
    else box.appendChild(det);
  }

  // Our own line in the footer (text nodes + fixed links, no innerHTML).
  function wireOwnCredits(ov) {
    var cred = ov.querySelector("#sc-cred");
    if (!cred) return;
    var el = state.lang === "el";
    cred.appendChild(document.createTextNode(
      el ? "Σχεδιάστηκε με <3 από τον " : "Designed with <3 by "));
    cred.appendChild(creditLink("https://koulaxizis.gr", "Christos Koulaxizis"));
    cred.appendChild(document.createTextNode(el ? ". Με τη βοήθεια του " : ". Assisted by "));
    cred.appendChild(creditLink("https://lumo.proton.me/", "Lumo"));
    cred.appendChild(document.createTextNode(el ? ". Έλεγχος από το " : ". Audited by "));
    cred.appendChild(creditLink("https://claude.ai/", "Claude"));
    cred.appendChild(document.createTextNode("."));
  }

  // Info modal — the FULL table is generated from SC_DEFS, never
  // handwritten twice. Flat, minimal, no chrome: title, version,
  // tagline, the capabilities row, shortcut rows, repo link, credits
  // (third-party register + our own line, both built in the DOM).
  var scInfoClose = null;   // #4: live modal's close fn (null = closed)

  function showInfoModal() {
    if (scInfoClose) { scInfoClose(); return; }   // open → close (clean toggle)

    var mac = /Mac|iPhone|iPad/i.test(navigator.platform || "");
    var comboPrefix = mac ? "⌃⌥⇧" : "Ctrl+Alt+Shift+";

    var rows = "";
    SC_DEFS.forEach(function (def) {
      rows += '<div class="sc-row"><span class="sc-key">' + comboPrefix +
              def.key.toUpperCase() + '</span><span>' +
              escapeHtml(window.t(def.label)) + '</span></div>';
    });

    var ov = document.createElement("div");
    ov.id = "sc-info-overlay";
    ov.setAttribute("role", "dialog");
    ov.innerHTML =
      '<div class="sc-box">' +
        '<div class="sc-head"><span class="sc-title">orOS</span>' +
          '<span class="sc-ver">v' + APP_VERSION + '</span></div>' +
        '<div class="sc-tagline">' + escapeHtml(window.t("sc.info.tagline")) + '</div>' +
        '<div class="sc-cap">' + escapeHtml(window.t("sc.info.cap")) + '</div>' +
        '<div class="sc-sec">' + escapeHtml(window.t("sc.info.services")) + '</div>' +
        '<div class="sc-row sc-service"><span>' + escapeHtml(window.t("sc.info.extsvc")) + '</span></div>' +
        '<div class="sc-row sc-service"><span>' + escapeHtml(window.t("sc.info.extsvc.radio")) + '</span></div>' +
        '<div class="sc-row sc-service"><span>' + escapeHtml(window.t("sc.info.extsvc.feeds")) + '</span></div>' +
        '<div class="sc-row sc-service"><span>' + escapeHtml(window.t("sc.info.extsvc.podcasts")) + '</span></div>' +
        '<div class="sc-row sc-service"><span>' + escapeHtml(window.t("maps.providers")) + '</span></div>' +
        '<div class="sc-row sc-service"><span>' + escapeHtml(window.t("sc.info.extsvc.television")) + '</span></div>' +
        '<div class="sc-row sc-service"><span>' + escapeHtml(window.t("sc.info.extsvc.pubdomain")) + '</span></div>' +
        '<div class="sc-sec">' + escapeHtml(window.t("sc.info.shortcuts")) + '</div>' +
        rows +
        '<div class="sc-reset-wrap" id="sc-reset-wrap"></div>' +
        '<div class="sc-foot"><span>' + escapeHtml(window.t("sc.info.repo")) + ': <a href="https://github.com/koulaxizis/oros" ' +
          'target="_blank" rel="noopener">koulaxizis/oros</a></span>' +
          '<div class="sc-cred" id="sc-cred"></div></div>' +
      '</div>';

    // #4: single close path — backdrop, Escape AND the toggle case
    // all funnel through close(), which removes BOTH the modal and
    // its document-level listener. No leaked Escape handlers anymore.
    function close() {
      ov.remove();
      document.removeEventListener("keydown", onKey);
      scInfoClose = null;
    }
    function onKey(e) {
      if (e.key === "Escape") close();
    }
    ov.addEventListener("click", function (e) {
      if (e.target === ov) close();
    });
    document.addEventListener("keydown", onKey);
    scInfoClose = close;    // registered so the toggle path can call it too

    wireSupportSection(ov);   // Support section (donation links)
    wireCreditsSection(ov);   // Credits & licences (collapsible)
    wireOwnCredits(ov);       // footer: our own credits line
    wireResetButton(ov);    // α: factory reset row

    document.body.appendChild(ov);
  }

  // ---------- Factory reset (goal α) — BRAND NEW OS ----------
  // Radical wipe, in order: engine suspended → in-flight waits out →
  // CLOUD (blob + backups deleted, Dropbox authorization REVOKED) →
  // folder-mirror snapshot files → local prefix sweep → IDB stage-2
  // (see factoryResetPending) → reload as first run. Double confirm
  // inline, inline styles, zero CSS additions.

  var osResetting = false;

  // Factory reset moved to Settings → System (two taps there, same
  // wipe: scFactoryReset). The Info modal keeps a way to it.
  function wireResetButton(ov) {
    var wrap = ov.querySelector("#sc-reset-wrap");
    if (!wrap) return;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.style.cssText =
      "display:block;width:100%;margin-top:12px;padding:7px 12px;" +
      "border:1px solid var(--border);border-radius:8px;background:transparent;" +
      "color:var(--text-dim);font-size:12px;font-weight:600;cursor:pointer;";
    btn.textContent = window.t("sc.reset.moved");
    btn.addEventListener("click", function () {
      if (scInfoClose) scInfoClose();
      window.orosSettings.open("system");
    });
    wrap.appendChild(btn);
  }

  // Folder-mirror wipe: every orOS-backup-*.json (and any legacy
  // orOS-snapshot-*.json from older versions) in the chosen backup
  // folder. BEST-EFFORT — a lapsed permission simply skips it
  // (transient activation expires once the async legs start).
  function wipeFolderMirror() {
    if (!fsSupported()) return Promise.resolve(false);
    return loadFolderHandle().then(function (handle) {
      if (!handle || typeof handle.values !== "function") return false;
      return handle.queryPermission({ mode: "readwrite" }).then(function (perm) {
        if (perm !== "granted") return false;
        var it = handle.values();
        function drain(found) {
          return it.next().then(function (r) {
            if (r.done) return found;
            var e = r.value;
            if (e && e.name &&
                (e.name.indexOf("orOS-snapshot-") === 0 ||
                 e.name.indexOf("orOS-backup-") === 0)) {
              found.push(e.name);
            }
            return drain(found);
          });
        }
        return drain([]).then(function (names) {
          return names.reduce(function (chain, n) {
            return chain.then(function () { return handle.removeEntry(n); });
          }, Promise.resolve()).then(function () { return names.length; });
        });
      });
    }).catch(function () { return false; });
  }
  
    // OrosFS disk wipe — Wave 1: the internal virtual disk (OPFS /
  // IndexedDB fallback backend) must die with the OS it belongs to.
  // The localStorage sweep catches "oros-ofs-dirty" via the oros-
  // prefix; this covers the storage the sweep cannot see. Best-
  // effort, like every leg of the reset — never blocks it.
  function wipeOrosFS() {
    if (!window.orosFS || typeof window.orosFS.wipe !== "function") {
      return Promise.resolve(false);
    }
    return window.orosFS.wipe().then(function () { return true; })
      .catch(function () { return false; });
  }

  // Maps tile cache (Cache Storage "oros-map-tiles" — MUST match
  // sw.js TILE_CACHE). It lives outside CACHE_VERSION and outside
  // localStorage, so neither the SW activate purge nor the sweep
  // below ever touched it: the areas the user had browsed survived a
  // factory reset. Best-effort, 3s cap — never blocks the reset.
  function wipeMapTiles() {
    try {
      if (!("caches" in window)) return Promise.resolve(false);
      return Promise.race([
        caches.delete("oros-map-tiles"),
        new Promise(function (res) { setTimeout(function () { res(false); }, 3000); })
      ]).catch(function () { return false; });
    } catch (e) { return Promise.resolve(false); }
  }

  function scFactoryReset(btn) {
    btn.disabled = true;
    btn.textContent = window.t("sc.reset.working");

    // Cloud wipe (15s cap — a hanging network can never freeze the
    // reset; wipeEverything suspends the engine synchronously at call).
    var cloud = (window.orosSync && typeof window.orosSync.wipeEverything === "function")
      ? Promise.race([
          window.orosSync.wipeEverything(),
          new Promise(function (res) { setTimeout(function () { res(null); }, 15000); })
        ]).catch(function () { return null; })
      : Promise.resolve(null);

    // Folder wipe FIRST — it needs the oros-fs handle, which the
    // upcoming local sweep would orphan. OrosFS wipe rides along —
    // independent storage, best-effort like the rest.
    Promise.all([wipeFolderMirror(), wipeOrosFS(), wipeMapTiles(), cloud]).then(function () {
      function sweep(storage) {
        var doomed = [];
        for (var i = 0; i < storage.length; i++) {
          var k = storage.key(i);
          if (k && k.indexOf("oros-") === 0) doomed.push(k);
        }
        for (var j = 0; j < doomed.length; j++) storage.removeItem(doomed[j]);
      }
      try { sweep(sessionStorage); } catch (e) {}   // PKCE verifier
      sweep(localStorage);

      osResetting = true;   // the beforeunload guard stays silent

      // Stage-2 marker — set AFTER the sweep on purpose (survives it).
      // Consumed by factoryResetPending() on the next boot, where no
      // IDB connection is open yet, so deleteDatabase() lands cleanly.
      localStorage.setItem("oros-reset-db", "1");
      location.reload();
    });
  }

  // STAGE 2 — called from the very top of this IIFE (function
  // declarations hoist, so the early call is legal). By this point
  // in a post-reset boot: VAULT_KEY is gone (swept) → sync.js's vault
  // chain short-circuits WITHOUT opening IndexedDB → both databases
  // delete without blocking. Removes the marker first (no loop), then
  // reloads clean. Returns true = this boot is halted on purpose.
  function factoryResetPending() {
    if (localStorage.getItem("oros-reset-db") !== "1") return false;
    localStorage.removeItem("oros-reset-db");
    var reloaded = false;
    function bail() {
      if (reloaded) return;
      reloaded = true;
      location.reload();
    }
    ["oros-vault", "oros-fs", "oros-ofs", "oros-wallpaper", "oros-mail", "oros-feeds", "oros-jigsaw", "oros-legacy"].forEach(function (name) {
      try {
        var req = indexedDB.deleteDatabase(name);
        req.onsuccess = function () { setTimeout(bail, 50); };
        req.onerror   = function () { setTimeout(bail, 50); };
        req.onblocked = function () { setTimeout(bail, 50); };
      } catch (e) { setTimeout(bail, 50); }
    });
    setTimeout(bail, 1200);   // hard cap — blocked DBs can't hang the reset
    return true;
  }

  // THE table. Order = documentation order. Adding a shortcut =
  // adding one entry here (handler + i18n key) — nothing else.
  var SC_DEFS = [
    { key: "p", label: "sc.desc.push",      fn: scForcePush },
    { key: "o", label: "sc.desc.pull",      fn: scForcePull },
    { key: "s", label: "sc.desc.snapshot",  fn: scBackupNow },
    { key: "x", label: "sc.desc.export",    fn: scExportDb },
    { key: "i", label: "sc.desc.info",      fn: showInfoModal },
    { key: "u", label: "sc.desc.updates",   fn: scCheckUpdates },
    { key: "l", label: "sc.desc.lang",      fn: scToggleLang },
    { key: "r", label: "sc.desc.reconnect", fn: scReconnect },
    { key: "c", label: "sc.desc.calculator", fn: function() { openAppById("calculator"); } },
    { key: "f", label: "sc.desc.search",    fn: openMenuSearch },
    { key: "h", label: "sc.desc.help",       fn: function() { openHelp(); } }
  ];

  // Public contract consumed by iframe apps (same-origin, so this
  // is reachable — Contract Β). Returns true when the combo matched,
  // so apps know whether to keep the event for themselves.
  function handleShortcutEvent(e) {
    // v0.18.1b — Ctrl+Alt+Shift: no native conflicts anywhere.
    // Match on e.code (PHYSICAL key) — e.key lies under the Greek
    // layout (physical P arrives as "π"), e.code is "KeyP" always.
    if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return false;
    // Χ5: focused editable target → the shortcut yields (AltGr
    // keyboards emit Ctrl+Alt natively; a typed character must never
    // trigger an OS action). Covers shell AND forwarded iframe
    // events — same-origin e.target is the real focused element.
    var tgt = e.target;
    if (tgt) {
      var tn = (tgt.tagName || "").toLowerCase();
      if (tn === "input" || tn === "textarea" || tn === "select" ||
          tgt.isContentEditable) return false;
    }
    var code = e.code || "";
    if (code.indexOf("Key") !== 0) return false;   // letters only
    var letter = code.charAt(code.length - 1).toUpperCase();
    for (var i = 0; i < SC_DEFS.length; i++) {
      if (SC_DEFS[i].key.toUpperCase() === letter) {
        if (e.preventDefault) e.preventDefault();
        SC_DEFS[i].fn();
        return true;
      }
    }
    return false;
  }
  window.orosShortcuts = { handle: handleShortcutEvent };
  
    // ---------- 9d. Weather widget (v0.18.0) ----------
  // Provider: Open-Meteo (no API key, no cookies). Settings travel
  // in the shell slice; fetches are throttled (30 min) and fire from
  // user gestures / online / visibility — never idle timers.
  // OFFLINE: slashed-cloud icon, NO temperature — never a fake value.

  // 2026-10-09: the tray is ON by default and is configured from the
  // Weather app (no menu section any more). Visibility is a device-
  // local switch (taskbar room differs per device, same doctrine as
  // the pet toggle): "oros-wx-tray" = "off" hides the chip, absent =
  // shown. The location stays in the synced pref; with no pinned
  // location the tray follows the Weather app's first city.
  var WX_PREF_KEY  = "oros-weather";     // {on, auto, lat, lon, label} (slice)
  var WX_TRAY_KEY  = "oros-wx-tray";     // "off" | absent (device-local, never synced)
  var WX_CACHE_KEY = "oros-wx-cache";    // {at, temp, code}  (device-local)
  var WX_LAST_KEY  = "oros-wx-last";     // epoch ms of last fetch attempt
  var WX_MIN_MS    = 30 * 60 * 1000;     // min gap between auto fetches
  var WX_RETRY_MS  = 2 * 60 * 1000;      // FAILED-fetch cooldown (no 30-min lockout)
  var WX_STALE_MS  = 3 * 60 * 60 * 1000; // cache older than 3h → dim state
  var WX_NEAR_DEG  = 0.15;             // ~15km nearest-city tolerance (adoptAppCache + briefing)

  var WX_SUN   = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>';
  var WX_MOON  = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  var WX_PART  = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="7" r="3"/><path d="M7 1v1M7 12v1M1 7h1M11 7h1"/><path d="M12 19a4 4 0 0 1 0-8 5 5 0 0 1 9.6 1.5A3.5 3.5 0 0 1 20 19z"/></svg>';
  var WX_CLOUD = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>';
  var WX_FOG   = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 13h16M6 16.5h12M8 19h8"/></svg>';
  var WX_RAIN  = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" opacity="0.55"/><path d="M8 19l-1 2M12 19l-1 2M16 19l-1 2"/></svg>';
  var WX_SNOW  = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" opacity="0.45"/><path d="M8 20h.01M12 20h.01M16 20h.01"/></svg>';
  var WX_STORM = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 9h-1.26A8 8 0 1 0 9 19h9a5 5 0 0 0 0-10z" opacity="0.55"/><polyline points="13 11 9 15 13 15 11 19 17 12 13.5 12 15 9"/></svg>';
  var WX_OFF   = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h-1.26A8 8 0 0 0 9 20h9a5 5 0 0 0 0-10z" opacity="0.6"/><line x1="3" y1="3" x2="21" y2="21"/></svg>';

  function wxRead() {
    var w = { on: false, auto: false, lat: null, lon: null, label: "" };
    try {
      var raw = JSON.parse(localStorage.getItem(WX_PREF_KEY));
      if (raw && typeof raw === "object") {
        w.on    = !!raw.on;
        w.auto  = !!raw.auto;
        w.lat   = (typeof raw.lat === "number" && isFinite(raw.lat)) ? raw.lat : null;
        w.lon   = (typeof raw.lon === "number" && isFinite(raw.lon)) ? raw.lon : null;
        w.label = (typeof raw.label === "string") ? raw.label : "";
      }
    } catch (e) {}
    return w;
  }

  function wxSave(w) {
    localStorage.setItem(WX_PREF_KEY, JSON.stringify(w));
  }

  function wxTrayOn() {
    try { return localStorage.getItem(WX_TRAY_KEY) !== "off"; }
    catch (e) { return true; }
  }

  // The tray's location: the pinned pref when it has coordinates,
  // else the Weather app's first city (by pos). null = nothing yet.
  function wxLoc() {
    var w = wxRead();
    if (w.lat !== null && w.lon !== null) {
      return { lat: w.lat, lon: w.lon, label: w.label, pinned: true };
    }
    try {
      var data = JSON.parse(localStorage.getItem("oros-weatherapp-data"));
      if (!data || !Array.isArray(data.cities)) return null;
      var first = null;
      data.cities.forEach(function (c) {
        if (!c || typeof c.lat !== "number" || typeof c.lon !== "number" ||
            !isFinite(c.lat) || !isFinite(c.lon)) return;
        if (!first || (Number(c.pos) || 0) < (Number(first.pos) || 0)) first = c;
      });
      if (!first) return null;
      return { lat: first.lat, lon: first.lon,
               label: (typeof first.label === "string") ? first.label : "",
               pinned: false };
    } catch (e) { return null; }
  }

  // A tray cache written for another place (the first city changed,
  // a pin moved) must never paint under the current label.
  function wxCacheFor(loc) {
    var c = wxCached();
    if (!c || !loc) return c;
    if (typeof c.lat === "number" && typeof c.lon === "number" &&
        (Math.abs(c.lat - loc.lat) >= WX_NEAR_DEG ||
         Math.abs(c.lon - loc.lon) >= WX_NEAR_DEG)) return null;
    return c;
  }

  function wxCached() {
    try {
      var c = JSON.parse(localStorage.getItem(WX_CACHE_KEY));
      if (c && typeof c === "object") return c;
    } catch (e) {}
    return null;
  }

  function wxNightNow() {
    var h = new Date().getHours();
    return h < 6 || h >= 21;
  }

  // WMO codes: 0 clear · 1-2 partly · 3 overcast · 45/48 fog ·
  // 51-67 rain · 71-77 snow · 80-82 showers · 85/86 snow showers · 95+ storm
  function wxIconFor(code) {
    var c = Number(code) || 0;
    if (c === 0) return wxNightNow() ? WX_MOON : WX_SUN;
    if (c === 1 || c === 2) return wxNightNow() ? WX_MOON : WX_PART;
    if (c === 3) return WX_CLOUD;
    if (c === 45 || c === 48) return WX_FOG;
    if (c >= 51 && c <= 67) return WX_RAIN;
    if (c >= 71 && c <= 77) return WX_SNOW;
    if (c >= 80 && c <= 82) return WX_RAIN;
    if (c === 85 || c === 86) return WX_SNOW;
    if (c >= 95) return WX_STORM;
    return WX_CLOUD;
  }

  // Cheap render — runs on every clock tick (1/s). Fetches are NOT
  // here; this only paints the chip from cache/state.
  function wxRenderChip() {
    var bar = document.querySelector(".bar-right");
    if (!bar) return;
    var chip = document.getElementById("wx-chip");

    if (!wxTrayOn()) { if (chip) chip.remove(); return; }
    var loc = wxLoc();

    if (!chip) {
      chip = document.createElement("button");
      chip.id = "wx-chip";
      chip.type = "button";
      chip.style.minHeight = "44px";   // SH-R6: Part VIII doctrine (touch targets)
      chip.addEventListener("click", function (e) {
        e.stopPropagation();
        // Inside Weather → back to desktop. Inside ANY OTHER app →
        // jump straight to Weather (no desktop hop). Desktop → open.
        if (state.running && state.running.id === "weather") {
          returnToDesktop(); return;
        }
        var wxApp = null;
        for (var i = 0; i < state.apps.length; i++) {
          if (state.apps[i].id === "weather") { wxApp = state.apps[i]; break; }
        }
        if (wxApp) openApp(wxApp);
        else document.getElementById("app-menu").classList.add("open");
      });
      bar.insertBefore(chip, document.getElementById("btn-lang"));
    }

    var titleBase = (loc && loc.label) || window.t("wx.title");

    // Tick-safe paint: renderClock calls this EVERY second, but the
    // DOM is touched only when state/html/title actually changed
    // (same doctrine as autoSyncDot — no per-second repaint churn).
    function paintChip(st, html, title) {
      if (chip.getAttribute("data-state") === st &&
          chip.innerHTML === html && chip.title === title) return;
      chip.setAttribute("data-state", st);
      chip.innerHTML = html;
      chip.title = title;
      chip.setAttribute("aria-label", title);   // SH-R11: chip content is icon +
                                                // text, screen readers need the
                                                // state spoken (offline/stale/on)
    }

    // OFFLINE first: slashed cloud, NO temperature — always
    if (!navigator.onLine) {
      paintChip("off", WX_OFF, titleBase + " · " + window.t("wx.offline"));
      return;
    }

    var c = wxCacheFor(loc);
    var stale = !c || !c.at || (Date.now() - c.at) > WX_STALE_MS;

    if (stale || !loc) {
      paintChip("off", WX_OFF, titleBase + " · " + window.t("wx.waiting"));
      return;
    }

    paintChip("on",
      wxIconFor(c.code) +
        '<span class="wx-temp">' + Math.round(c.temp) + "°</span>",
      titleBase + " · " + new Date(c.at).toLocaleTimeString(
        state.lang === "el" ? "el-GR" : "en-GB",
        { hour: "2-digit", minute: "2-digit" }));
  }
  // #6 — fetch retry tick: the BOOT fetch (wxFetch(false) at the
  // bottom of the file) can fail silently — slow network, Open-Meteo
  // hiccup — and nothing retried until an online/visibility event,
  // leaving the chip in the "waiting" paint until the user clicked
  // it or opened the Weather app. Piggyback the clock tick at a 60s
  // throttle: wxFetch keeps its own gates (30-min happy path, 2-min
  // post-failure retry window, offline/coords guards), so this tick
  // costs one localStorage read per minute and nothing else. It also
  // adopts the app's fresh cache (wxAdoptAppCache) without needing
  // the app to be opened.
  var wxFetchLastTick = 0;
  function wxFetchTickThrottled() {
    var now = Date.now();
    if (now - wxFetchLastTick < 60000) return;
    wxFetchLastTick = now;
    wxFetch(false);
  }

  // One truth, two consumers: if the Weather app holds NEWER data
  // for this location than we do, adopt it — the tray and the app
  // must never show different numbers for the same place.
  function wxAdoptAppCache(w) {
    try {
      var data  = JSON.parse(localStorage.getItem("oros-weatherapp-data"));
      var cache = JSON.parse(localStorage.getItem("oros-weatherapp-cache"));
      if (!data || !Array.isArray(data.cities) || !cache) return false;
      // C1: "same place" for WEATHER means same CITY, not same survey
      // point. GPS vs geocoded city-center routinely sit >2.2km apart
      // (old 0.02° tolerance silently failed → tray fetched its own
      // diverging numbers). Nearest city within ~15km wins, unconditionally:
      // the app is the single source of truth when a match exists —
      // never "newer fetch wins", that oscillates between two sources.
      // Uses module-level WX_NEAR_DEG (hoisted above) — one truth.
      var best = null, bestDist = Infinity;
      for (var i = 0; i < data.cities.length; i++) {
        var c = data.cities[i];
        if (typeof c.lat !== "number" || typeof c.lon !== "number") continue;
        var d = Math.abs(c.lat - w.lat) + Math.abs(c.lon - w.lon);
        if (d < bestDist) { bestDist = d; best = c; }
      }
      if (!best || bestDist >= WX_NEAR_DEG) return false;
      var p = cache[best.id];
      if (!p || !p.at || !p.current) return false;
      // Freshness guard: the app is the source of truth only when its
      // data is NEWER than what the tray already holds. Unconditional
      // adoption let a stale app cache overwrite a fresh tray fetch
      // on every 60s tick — the chip stayed "waiting" forever.
      var cur = wxCacheFor(w);
      if (cur && cur.at && p.at <= cur.at) return false;
      localStorage.setItem(WX_CACHE_KEY, JSON.stringify({
        at:   p.at,
        temp: p.current.temp,
        code: p.current.code,
        lat:  w.lat,
        lon:  w.lon
      }));
      return true;
    } catch (e) { return false; }
  }

  var wxBusy = false;   // in-flight guard — never stack parallel fetches

  function wxFetch(force) {
    if (!wxTrayOn() || !navigator.onLine) return;
    var w = wxLoc();
    if (!w) return;
    // The cache belongs to another place → drop it and the throttle
    // that was bought for that place.
    if (wxCached() && !wxCacheFor(w)) {
      try {
        localStorage.removeItem(WX_CACHE_KEY);
        localStorage.removeItem(WX_LAST_KEY);
      } catch (e) {}
      force = true;
    }

    // Adopt the app's fresher data first — then decide if OUR OWN
    // network fetch is still needed (app data older than 30 min).
    if (wxAdoptAppCache(w)) {
      wxRenderChip();
      var adopted = wxCached();
      if (adopted && (Date.now() - adopted.at) < WX_MIN_MS) return;
    }

    if (wxBusy) return;   // a fetch is already in flight — never stack
    if (!force) {
      var last = parseInt(localStorage.getItem(WX_LAST_KEY) || "0", 10) || 0;
      if (Date.now() - last < WX_MIN_MS) {
        // Stale-cache bypass: an armed throttle with a stale cache is
        // the exact "successful fetch, waiting chip" contradiction —
        // bypass only when the cache is older than the throttle period
        // itself, never during the normal fresh-data cycle.
        var sc = wxCacheFor(w);
        if (sc && sc.at && (Date.now() - sc.at) < WX_MIN_MS) return;
      }
    }
    wxBusy = true;
    // The 30-min throttle is bought ONLY by a SUCCESSFUL fetch now
    // (see success branch below). The old stamp-before-fetch died
    // with the page — tab close or the SW controllerchange auto-
    // reload mid-flight left the stamp armed and the cache empty,
    // locking the chip in "waiting" for up to 30 minutes.
    // C1: same endpoint as the Weather app (timezone=auto + hourly/daily
    // fields we don't use here but ensure the SAME calculation path).
    // The tray only cares about current temp/code, but matching the
    // app's URL guarantees the SAME model interpolation → identical numbers.
    var url = "https://api.open-meteo.com/v1/forecast?latitude=" + w.lat +
              "&longitude=" + w.lon +
              "&current_weather=true" +
              "&hourly=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation_probability,weathercode,uv_index" +
              "&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset" +
              "&timezone=auto&forecast_days=7";
    // Boot-race hardening: a request that HANGS (cold PWA start racing
    // a new SW activation — the >30s cache-cleanup log line) never
    // reaches .catch, keeps WX_LAST_KEY stamped and locks the chip in
    // "waiting" for the full 30-min throttle. A 10s abort converts
    // the hang into a normal failure → the existing 2-min retry
    // window (rewind in .catch) takes over. AbortController absent
    // (ancient browser) → old behavior, zero breakage.
    var wxCtl = (typeof AbortController === "function") ? new AbortController() : null;
    var wxKill = wxCtl ? setTimeout(function () { wxCtl.abort(); }, 10000) : null;
    fetch(url, wxCtl ? { signal: wxCtl.signal } : undefined)
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (wxKill) clearTimeout(wxKill);
        wxBusy = false;
        if (d && d.current_weather &&
            typeof d.current_weather.temperature === "number") {
          localStorage.setItem(WX_CACHE_KEY, JSON.stringify({
            at:   Date.now(),
            temp: d.current_weather.temperature,
            code: d.current_weather.weathercode,
            lat:  w.lat,
            lon:  w.lon
          }));
          // Success is the only path that buys the 30-min throttle.
          localStorage.setItem(WX_LAST_KEY, String(Date.now()));
          wxRenderChip();
        } else {
          // Open-Meteo replied but with no usable payload (rate
          // limit / error body): same 2-min cooldown as a network
          // failure — never the silent 30-min lockout.
          localStorage.setItem(WX_LAST_KEY,
            String(Date.now() - WX_MIN_MS + WX_RETRY_MS));
        }
      })
      .catch(function () {
        wxBusy = false;
        /* offline/blocked — chip keeps last state. BUT a FAILED fetch
           must not buy the full 30-min throttle: rewind the stamp to a
           short retry window so the next visibility/online event
           retries instead of sitting in "waiting" for half an hour. */
        try {
          localStorage.setItem(WX_LAST_KEY,
            String(Date.now() - WX_MIN_MS + WX_RETRY_MS));
        } catch (e2) {}
        // Weather unification: a persistent tray failure belongs in
        // the INBOX (invisible outage ≠ silence). Dedup by key =
        // one line per day, never per-attempt spam. The chip itself
        // keeps painting the off/waiting state — no toast here.
        if (navigator.onLine &&
            window.orosNotifs && typeof window.orosNotifs.emit === "function") {
          var wxfEl = (localStorage.getItem("oros-lang") === "el");
          window.orosNotifs.emit({
            ns: "weather",
            key: "trayfail-" + sysYmd(),
            type: "sys",
            title: wxfEl ? "Καιρός" : "Weather",
            body: wxfEl
              ? "Αποτυχία λήψης καιρού — έλεγξε τη σύνδεση"
              : "Weather fetch failed — check connection"
          });
        }
      });
  }
  
  // Menu/pull weather changes → straight into the RUNNING app.
  // The app owns its data + merge stamps; we only knock.
  //
  // v0.18.3 — Guard: typeof not null (see __orosWeatherUpdate fix).
  // Prevents undefined coordinates from slipping into the app and
  // creating duplicate "My location" cities on every menu pull/
  // language toggle that triggers a wxPush.
  function wxPushToApp() {
    var w = wxRead();
    if (!w.on ||
        typeof w.lat !== "number" || typeof w.lon !== "number" ||
        isNaN(w.lat) || isNaN(w.lon)) return;
    var f = document.getElementById("app-frame");
    try {
      if (f && f.contentWindow &&
          typeof f.contentWindow.__orosWeatherUpdate === "function") {
        f.contentWindow.__orosWeatherUpdate(w);
      }
    } catch (e) { /* app not running/loaded — tray keeps it */ }
  }

  // Morning briefing: one daily advisory between 08:00–11:59 local,
  // built from the app cache of the city nearest the tray location
  // (same 0.15° nearest-city rule as wxAdoptAppCache — one truth).
  // Hint priority mirrors weather.js pickHint: storm > fog > rain >
  // UV > heat > cold > swing. A pleasant day stays SILENT — the
  // briefing speaks only when it matters. Dedup by key, rides the
  // existing clock tick (60s throttle), zero new timers.
  var wxBriefLastTick = 0;
  function wxBriefTickThrottled() {
    var now = Date.now();
    if (now - wxBriefLastTick < 60000) return;
    wxBriefLastTick = now;
    wxBriefTick();
  }

  function wxBriefTick() {
    if (!wxTrayOn()) return;
    var w = wxLoc();
    if (!w) return;
    var h = new Date().getHours();
    if (h < 8 || h >= 12) return;   // outside the morning window
    if (!(window.orosNotifs && typeof window.orosNotifs.emit === "function")) return;

    var data = null, cache = null;
    try {
      data  = JSON.parse(localStorage.getItem("oros-weatherapp-data"));
      cache = JSON.parse(localStorage.getItem("oros-weatherapp-cache"));
    } catch (e) { return; }
    if (!data || !Array.isArray(data.cities) || !cache) return;

    var best = null, bestDist = Infinity;
    for (var i = 0; i < data.cities.length; i++) {
      var c = data.cities[i];
      if (typeof c.lat !== "number" || typeof c.lon !== "number") continue;
      var d = Math.abs(c.lat - w.lat) + Math.abs(c.lon - w.lon);
      if (d < bestDist) { bestDist = d; best = c; }
    }
    if (!best || bestDist >= WX_NEAR_DEG) return;
    var p = cache[best.id];
    if (!p || !p.current || !Array.isArray(p.daily) || !p.daily.length) return;

    var code = Number(p.current.code) || 0;
    var maxPop = 0, dmax = null, dmin = null;
    p.daily.forEach(function (dd) {
      if (dd.pop > maxPop) maxPop = dd.pop;
      if (dd.max !== null && (dmax === null || dd.max > dmax)) dmax = dd.max;
      if (dd.min !== null && (dmin === null || dd.min < dmin)) dmin = dd.min;
    });
    var en, el;
    if (code >= 95) {
      en = "Storms around — take cover"; el = "Καταιγίδες — απόφυγε την έκθεση";
    } else if (code === 45 || code === 48) {
      en = "Fog patches — slow down"; el = "Ομίχλη — προσοχή στην οδήγηση";
    } else if (maxPop >= 60 || (code >= 51 && code <= 67) || (code >= 80 && code <= 82)) {
      en = "Umbrella day"; el = "Μέρα για ομπρέλα";
    } else if (p.current.uv !== null && p.current.uv >= 6) {
      en = "High UV — wear sunscreen"; el = "Υψηλή UV — αντηλιακό";
    } else if (dmax !== null && dmax >= 33) {
      en = "Hot one — stay hydrated"; el = "Ζέστη — πίνε νερό";
    } else if (dmin !== null && dmin <= 0) {
      en = "Freezing temperatures"; el = "Παγωμένες θερμοκρασίες";
    } else if (dmax !== null && dmin !== null && (dmax - dmin) > 12) {
      en = "Layer up — big day-night swing"; el = "Πάρε ζακέτα — μεγάλη διακύμανση";
    } else {
      return;   // pleasant day — no briefing noise
    }
    var wbEl = (localStorage.getItem("oros-lang") === "el");

    window.orosNotifs.emit({
      ns: "weather",
      key: "brief-" + sysYmd(),
      type: "reminder",
      title: best.label || (wbEl ? "Καιρός" : "Weather"),
      body: wbEl ? el : en,
      deepLink: "weather:open"
    });
  }

  // Weather app → tray bridge (2026-10-09: the menu section is gone;
  // the app owns the tray settings). Same-origin parent API,
  // typeof-guarded on the app side so a stale shell is harmless.
  //   isOn()      device-local visibility (default true)
  //   setOn(b)    show/hide the chip on THIS device (never synced)
  //   location()  {lat, lon, label, pinned} or null
  //   pin(g)      pin a city {lat, lon, label}: synced shell pref;
  //               pin(null) unpins (back to the app's first city)
  window.orosWeatherTray = {
    isOn: wxTrayOn,
    setOn: function (on) {
      try {
        if (on) localStorage.removeItem(WX_TRAY_KEY);
        else localStorage.setItem(WX_TRAY_KEY, "off");
      } catch (e) {}
      if (on) wxFetch(true);
      wxRenderChip();
    },
    location: wxLoc,
    pin: function (g) {
      if (g === null) {           // unpin → follow the app's first city
        var was = wxRead();
        if (was.lat === null && was.lon === null && !was.on) return true;
        wxSave({ on: false, auto: false, lat: null, lon: null, label: "" });
        noteLocalChange();
        wxFetch(true);
        wxRenderChip();
        return true;
      }
      if (!g || typeof g.lat !== "number" || typeof g.lon !== "number" ||
          !isFinite(g.lat) || !isFinite(g.lon)) return false;
      var prev = wxRead();
      var label = (typeof g.label === "string") ? g.label.slice(0, 80) : "";
      if (prev.lat === g.lat && prev.lon === g.lon &&
          prev.label === label && prev.on) return true;   // no-op: no phantom push
      if (prev.lat !== g.lat || prev.lon !== g.lon) {
        try {                     // an untagged legacy cache is for the old place
          localStorage.removeItem(WX_CACHE_KEY);
          localStorage.removeItem(WX_LAST_KEY);
        } catch (e) {}
      }
      wxSave({ on: true, auto: false, lat: g.lat, lon: g.lon, label: label });
      noteLocalChange();          // travels in the shell slice
      wxFetch(true);              // wxFetch drops a cache of another place
      wxRenderChip();
      return true;
    }
  };


  function initSyncIntegration() {
    registerShellSlice();
    fdMigrateLegacy();          // FILES-V: one-time cleanup of the blob model
    legacyLsMove();             // SY-Q2: retired snapshots out of localStorage
    registerRadioProxySlice();
    registerTelevisionProxySlice();
    registerMailProxySlice();

    // OAuth return → flip the menu to connected state once tokens land
    if (window.orosSync && window.orosSync.redirectHandled) {
      window.orosSync.redirectHandled.then(function (handled) {
        if (handled) renderMenu();
      });
    }

    // Vault auto-unlock settled → re-render (dot turns "on" without user
    // ever typing the passphrase; silent pull already handled by engine)
    if (window.orosSync && window.orosSync.vaultUnlocked) {
      window.orosSync.vaultUnlocked.then(function () {
        renderMenu();
      });
    }

    // Subtle auto-sync feedback: the status dot pulses while the engine
    // pushes in the background. No messages, no interruptions.
    if (window.orosSync && typeof window.orosSync.onAutoSync === "function") {
      window.orosSync.onAutoSync(function (kind, reason, err) {
        if (kind === "start") setSyncDot("syncing");
        else if (kind === "fail") {
          setSyncDot("err", 6000);   // v0.9: a failed background sync no longer flashes green
          // SY-L2: say WHY, quietly (no toast, no inbox): in the dot's
          // tooltip and as a line in Settings > Sync (bridge snapshot
          // sync.msg), until the next sync that succeeds.
          state.syncAutoErr = syncErrText(err);
          var dotEl = document.getElementById("sync-dot");
          if (dotEl) dotEl.parentNode.setAttribute("title", window.t("syncdot.err") + " — " + state.syncAutoErr);
          renderMenu();
        } else {
          setSyncDot("synced", 4000);   // transient green, then auto
          if (state.syncAutoErr) { state.syncAutoErr = null; renderMenu(); }
        }
      });
    }

    // Account email for the status row (async, cached by sync.js)
    if (window.orosSync && window.orosSync.isConnected()) {
      window.orosSync.getUserInfo()
        .then(function (acc) {
          if (acc && acc.email) {
            state.syncUserEmail = acc.email;
            renderMenu();
          }
        })
        .catch(function () { /* offline on boot — status stays generic */ });
    }

    // Auto-backup: check on tab-visible (no background timers — the
    // shell's stance on idle battery cost). Boot check happens at the
    // bottom of this file, after everything is initialized.
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") {
        maybeAutoExport(false);
      }
    });
  }

  // ---------- 9e. Alarm engine (E1 — Time app) ----------
  // Alarms are SHELL-owned: the Time app registers them, but the
  // tick lives here — surviving the app's iframe close (about:
  // blank) as long as orOS is open. Persisted in localStorage, so
  // reloads don't kill pending alarms either. Standing honest
  // limit: browser/tab fully closed = nothing rings (orOS is a
  // browser OS, not a daemon). Timer/Pomodoro endings from the
  // app ride the SAME engine — one firing path, one sound.

  var ALARMS_KEY = "oros-alarms";
  var alarmRing = { ctx: null, timer: null };

  function alarmsRead() {
    try {
      var a = JSON.parse(localStorage.getItem(ALARMS_KEY));
      return Array.isArray(a) ? a : [];
    } catch (e) { return []; }
  }

  function alarmsWrite(list) {
    try { localStorage.setItem(ALARMS_KEY, JSON.stringify(list)); } catch (e) {}
  }

  // Specs arrive from an iframe (untrusted shape) — sanitize hard.
  // Past timestamps: "once" = fired junk (dropped). "daily" = the
  // series fired on the source device but the advance hasn't
  // travelled yet (or this device slept past due) — catch-up by
  // WHOLE days, mirroring alarmTick. Never a silent data-loss drop.
  function alarmSanitize(spec) {
    if (!spec || typeof spec !== "object") return null;
    var at = (typeof spec.at === "number" && isFinite(spec.at)) ? Math.round(spec.at) : null;
    if (at === null) return null;
    var rep = spec.repeat === "daily" ? "daily" : "once";
    if (at <= Date.now()) {
      if (rep !== "daily") return null;
      var d = new Date(at);
      do { d.setDate(d.getDate() + 1); } while (d.getTime() <= Date.now());
      at = d.getTime();
    }
    return {
      id:     (typeof spec.id === "string" && spec.id) ? spec.id : (Date.now().toString(36) + Math.random().toString(36).slice(2, 7)),
      at:     at,
      label:  (typeof spec.label === "string" && spec.label) ? spec.label.slice(0, 60) : "",
      repeat: rep,
      state:  "pending"
    };
  }

  // Three short pips — WebAudio, zero assets. Gesture-lock aware:
  // a suspended context can't resume without a click — the visual
  // overlay is the primary channel anyway.
  function alarmPip() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!alarmRing.ctx) alarmRing.ctx = new AC();
      var ctx = alarmRing.ctx;
      if (ctx.state === "suspended") {
        ctx.resume().catch(function () {});
      }
      // resumed is async — schedule pips anyway; they'll fire when ready
      var t0 = ctx.currentTime;
      for (var i = 0; i < 3; i++) {
        var o = ctx.createOscillator();
        var g = ctx.createGain();
        o.type = "sine";
        o.frequency.value = 880;
        var ts = t0 + i * 0.24;
        g.gain.setValueAtTime(0.0001, ts);
        g.gain.exponentialRampToValueAtTime(0.16, ts + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ts + 0.18);
        o.connect(g);
        g.connect(ctx.destination);
        o.start(ts);
        o.stop(ts + 0.2);
      }
    } catch (e) { /* no audio — visual toast stands alone */ }
  }

  function alarmStopRing() {
    if (alarmRing.timer) { clearInterval(alarmRing.timer); alarmRing.timer = null; }
    var ov = document.getElementById("alarm-toast");
    if (ov) ov.remove();
  }

  // A REAL alarm must not auto-vanish in 2.6s like scToast: own
  // overlay, Dismiss button, 30s hard cap (ringing forever with
  // nobody home helps nobody). Inline styles, palette vars only.
  function alarmNotify(a) {
    // Wave 6 — the alarm ALSO lands in the unified inbox (badge +
    // history): an ignored or snoozed alarm must never evaporate.
    // Suppression (emit → null: toggles/quiet/dedup) does NOT
    // suppress the overlay — the persistent overlay is the alarm's
    // primary channel and stands on its own.
    if (window.orosNotifs && typeof window.orosNotifs.emit === "function") {
      window.orosNotifs.emit({
        ns: "time",
        key: "alarm-" + a.id + "-" + sysYmd(),
        type: "alarm",
        title: window.t("alarm.title"),
        body: (a.label || window.t("alarm.title")),
        deepLink: "time:alarms"
      });
    }
    alarmStopRing();
    var el = document.createElement("div");
    el.id = "alarm-toast";
    el.setAttribute("role", "alert");
    el.style.cssText =
      "position:fixed;top:calc(48px + env(safe-area-inset-top,0px));right:12px;" +
      "z-index:1450;display:flex;align-items:center;gap:12px;max-width:calc(100vw - 24px);" +
      "background:var(--panel-bg);color:var(--text);border:1px solid var(--accent);" +
      "border-radius:10px;box-shadow:0 8px 24px var(--shadow);padding:10px 14px;";
    var body = document.createElement("div");
    body.style.cssText = "flex:1;min-width:0;";
    var title = document.createElement("div");
    title.style.cssText = "font-size:11px;font-weight:800;text-transform:uppercase;" +
      "letter-spacing:1px;color:var(--accent);";
    var titleText = window.t("alarm.title");
    title.textContent = titleText;
    var label = document.createElement("div");
    label.style.cssText = "font-size:13.5px;font-weight:700;margin-top:2px;" +
      "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
    label.textContent = a.label || titleText;
    var timeStr = document.createElement("div");
    timeStr.style.cssText = "font-size:12px;color:var(--text-dim);margin-top:1px;" +
      "font-variant-numeric:tabular-nums;";
    timeStr.textContent = new Date().toLocaleTimeString(
      window.orosLang === "el" ? "el-GR" : "en-GB",
      { hour: "2-digit", minute: "2-digit" });
    body.appendChild(title);
    body.appendChild(label);
    body.appendChild(timeStr);
    // Snooze (one-shot +9 min). Re-adds via the public contract —
    // alarmSanitize is the same gate the Time app passes through.
    // Daily alarms: the repeat copy has ALREADY advanced to tomorrow
    // (alarmTick mutates before notifying), so this snooze shot is
    // additive and never disturbs the recurrence.
    var SNOOZE_MIN = 9;
    var snoozeBtn = document.createElement("button");
    snoozeBtn.type = "button";
    snoozeBtn.textContent = window.t("alarm.snooze")
      .replace("{n}", String(SNOOZE_MIN));
    snoozeBtn.style.cssText =
      "flex-shrink:0;border:1px solid var(--border);background:transparent;" +
      "color:var(--text-dim);font:inherit;font-weight:700;font-size:12.5px;" +
      "border-radius:7px;padding:7px 12px;cursor:pointer;";
    snoozeBtn.addEventListener("click", function () {
      window.orosAlarms.add({
        at:    Date.now() + SNOOZE_MIN * 60000,
        label: a.label || titleText,
        repeat: "once"
      });
      alarmStopRing();
    });
    var btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = window.t("alarm.dismiss");
    btn.style.cssText =
      "flex-shrink:0;border:1px solid var(--accent);background:var(--accent-soft, rgba(109,74,255,0.1));" +
      "color:var(--accent);font:inherit;font-weight:700;font-size:12.5px;" +
      "border-radius:7px;padding:7px 12px;cursor:pointer;";
    btn.addEventListener("click", alarmStopRing);
    el.appendChild(body);
    el.appendChild(snoozeBtn);
    el.appendChild(btn);
    document.body.appendChild(el);
    alarmPip();
    alarmRing.timer = setInterval(alarmPip, 1500);
    setTimeout(function () {
      if (document.getElementById("alarm-toast")) alarmStopRing();
    }, 30000);
  }

  // SH-Q3: occurrences that already rang in this session. The write
  // below that retires / advances a fired alarm can fail (full
  // store); the same occurrence then stayed "due" and rang again
  // every second.
  var alarmRang = {};
  function alarmTick() {
    var list = alarmsRead();
    var dueIdx = -1, due = null;
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (a && a.state === "pending" && typeof a.at === "number" && a.at <= Date.now() &&
          !alarmRang[a.id + "|" + a.at]) {
        due = a; dueIdx = i; break;   // first due wins — no flood
      }
    }
    if (!due) return;
    alarmRang[due.id + "|" + due.at] = true;
    // Advance/retire BEFORE notifying: mutating first makes a
    // second tick double-fire impossible.
    if (due.repeat === "daily") {
      // Catch-up: advance by WHOLE days — a device asleep for days
      // jumps straight to the next future firing, not a notification
      // storm for every missed day.
      // SH-D1: mtime = the occurrence that just fired — every device
      // that fires this alarm writes the same bytes.
      var nx = alarmNextDaily(due.at, Date.now());
      list[dueIdx].at = nx.at;
      list[dueIdx].mtime = Math.max(
        (typeof due.mtime === "number" && isFinite(due.mtime)) ? due.mtime : 1, nx.last);
    } else {
      // A fired once-alarm needs no tombstone: its time has passed,
      // so it is dead on every device by definition.
      list.splice(dueIdx, 1);
    }
    alarmsWrite(list);
    // #9: a fired alarm MUTATED data (daily advance / once retire) —
    // same dirty contract as orosAlarms.add/remove. Without this, the
    // firing never reaches the cloud and other devices ring again.
    if (window.orosSync && typeof window.orosSync.markDirty === "function") {
      window.orosSync.markDirty();
    }
    alarmNotify(due);
  }

  // Public contract consumed by the Time app (same-origin iframe,
  // same pattern as __orosWeatherUpdate / orosSync).
  window.orosAlarms = {
    add: function (spec) {
      var a = alarmSanitize(spec);
      if (!a) return null;
      a.mtime = Date.now();          // SH-D1: entity stamp (merge = newer wins)
      var list = alarmsRead();
      list.push(a);
      alarmsWrite(list);
      // E1 Patch 3: alarms travel in the shell slice — a new alarm
      // must reach the cloud without waiting for an unrelated edit.
      if (window.orosSync && typeof window.orosSync.markDirty === "function") {
        window.orosSync.markDirty();
      }
      return a.id;
    },
    remove: function (id) {
      var list = alarmsRead(), out = [], gone = null;
      for (var i = 0; i < list.length; i++) {
        if (list[i].id !== id) out.push(list[i]);
        else gone = alarmCanon(list[i]);
      }
      alarmsWrite(out);
      // SH-D1: a deletion must travel as a fact, or the union with a
      // device that still holds the alarm brings it back.
      if (gone) {
        var tombs = alarmTombsRead();
        tombs[id] = { t: Math.max(Date.now(), gone.mtime), x: (gone.repeat === "once") ? gone.at : 0 };
        alarmTombsWrite(alarmTombsLive(tombs, Date.now()));
      }
      // E1 Patch 3: alarm deletion is data loss if it never travels —
      // same dirty contract as add.
      if (window.orosSync && typeof window.orosSync.markDirty === "function") {
        window.orosSync.markDirty();
      }
    },
    list: function () { return alarmsRead(); }
  };

  // ---------- 9e2. Calendar reminder engine (Wave 3) ----------
  // Reads "oros-calendar-data" directly from localStorage — same
  // origin, so it works even when the Calendar app is CLOSED.
  // Fires a persistent top-right overlay (own element, NOT scToast
  // — reminders must not vanish in 2.6s) + optional web
  // Notification (only if the permission was already granted).
  //
  // Fired-log: device-local "oros-cal-reminders-fired" (trimmed,
  // never synced). The Calendar app checks the SAME key → an open
  // app and the shell can never double-fire one reminder.
  //
  // Standing honest limit (same as alarms): browser/tab fully
  // closed = nothing fires. orOS is a browser OS, not a daemon.
  //
  // Catch-up contract: a reminder fires if due AND the occurrence
  // has NOT started yet. An already-started event never notifies —
  // stale reminders stay silent instead of spamming on wake.

  var CALREM_DATA_KEY  = "oros-calendar-data";
  var CALREM_FIRED_KEY = "oros-cal-reminders-fired";
  var CALREM_FIRED_MAX = 500;
  // Longest preset = 7200 min (5 days); +3-day tail so a reminder
  // that came due while the tab slept still catches up on open.
  var CALREM_STOP_MS   = (7200 + 3 * 1440) * 60000;

  function calRemT(en, el) {
    return state.lang === "el" ? el : en;
  }

  function calRemFiredRead() {
    try {
      var arr = JSON.parse(localStorage.getItem(CALREM_FIRED_KEY));
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }
  function calRemFiredAdd(key) {
    try {
      var arr = calRemFiredRead();
      arr.push(key);
      localStorage.setItem(CALREM_FIRED_KEY,
        JSON.stringify(arr.slice(-CALREM_FIRED_MAX)));
    } catch (e) {}
  }

  function calRemPad(n) { return (n < 10 ? "0" : "") + n; }
  function calRemYmd(y, m, d) {
    return y + "-" + calRemPad(m + 1) + "-" + calRemPad(d);
  }
  function calRemDim(y, m) { return new Date(y, m + 1, 0).getDate(); }

  // Start timestamp of one OCCURRENCE — ev.start rides along with
  // every occurrence; all-day = local midnight.
  function calRemOccTs(ev, y, m, d) {
    var ts = new Date(y, m, d, 0, 0, 0).getTime();
    if (ev.start && /^\d{2}:\d{2}$/.test(ev.start)) {
      ts += (+ev.start.slice(0, 2)) * 3600000 + (+ev.start.slice(3)) * 60000;
    }
    return ts;
  }

  // Occurrence generator — MUST mirror calendar.js exactly:
  //   D/W step days (interval 2 = bi-weekly),
  //   M/Y clamp to month length with the ORIGINAL day sticky
  //     (Jan 31 → Feb 28 → Mar 31, Google-style),
  //   exdates skipped, "until" stops the walk.
  // cb(ts, ymd) — return false to stop iterating.
  function calRemEachOccurrence(ev, cb) {
    var p = ev.date.split("-");
    var y = +p[0], m = +p[1] - 1;
    var origDay = +p[2];
    var d = origDay;
    var r = ev.recur;
    var interval = (r.interval === 2) ? 2 : 1;
    var until = (typeof r.until === "string" &&
                /^\d{4}-\d{2}-\d{2}$/.test(r.until)) ? r.until : null;
    var exSet = {};
    if (Array.isArray(r.exdates)) {
      for (var x = 0; x < r.exdates.length && x < 100; x++) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(r.exdates[x])) exSet[r.exdates[x]] = true;
      }
    }

    // Mirror of calendar.js MAX_STEPS (per freq). The old uniform
    // 500 was NOT a mirror: a daily series anchored more than ~500
    // DAYS ago ends this walk before it ever reaches NOW — the
    // shell engine silently never fires for old daily reminders.
    var maxSteps = (r.freq === "D") ? 40000
                 : (r.freq === "W") ? 5200 : 600;
    for (var step = 0; step < maxSteps; step++) {
      var occYmd = calRemYmd(y, m, d);
      if (until && occYmd > until) return;
      if (!exSet[occYmd]) {
        var ts = calRemOccTs(ev, y, m, d);
        if (cb(ts, occYmd) === false) return;
      }
      if (r.freq === "D") {
        d += interval;
      } else if (r.freq === "W") {
        d += 7 * interval;
      } else if (r.freq === "M") {
        m += interval;
        while (m > 11) { m -= 12; y++; }
        d = Math.min(origDay, calRemDim(y, m));   // sticky clamp
      } else if (r.freq === "Y") {
        y += interval;
        d = Math.min(origDay, calRemDim(y, m));   // Feb 29 → Feb 28
      } else {
        return;
      }
      // normalize day overflow from D/W stepping (max +14 days)
      var dim = calRemDim(y, m);
      if (d > dim) { d -= dim; m++; if (m > 11) { m = 0; y++; } }
    }
  }

  function calRemTick() {
    var raw;
    try { raw = JSON.parse(localStorage.getItem(CALREM_DATA_KEY)); }
    catch (e) { return; }
    if (!raw || !Array.isArray(raw.events)) return;

    var now = Date.now();
    var due = null;          // earliest due wins — no flood
    var firedArr = null;     // lazy: read the log once, only if needed

    function check(ev, remindMin, ts, occYmd) {
      if (ts < now) return;                      // already started — skip
      var remTs = ts - remindMin * 60000;
      if (remTs > now) return;                   // not due yet
      var remKey = "rem:" + ev.id + ":" + occYmd;
      if (firedArr === null) firedArr = calRemFiredRead();
      for (var f = 0; f < firedArr.length; f++) {
        if (firedArr[f] === remKey) return;
      }
      if (!due || remTs < due.remTs) {
        due = { ev: ev, remTs: remTs, startTs: ts, remKey: remKey };
      }
    }

    for (var i = 0; i < raw.events.length; i++) {
      var ev = raw.events[i];
      if (!ev || typeof ev !== "object" ||
          typeof ev.remindMin !== "number" || !isFinite(ev.remindMin) ||
          ev.remindMin <= 0) continue;
      var remindMin = ev.remindMin;

      if (ev.recur && typeof ev.recur === "object" &&
          /^[DWMY]$/.test(ev.recur.freq || "")) {
        calRemEachOccurrence(ev, function (ts, occYmd) {
          if (ts > now + CALREM_STOP_MS) return false;   // past horizon — stop
          check(ev, remindMin, ts, occYmd);
        });
      } else {
        var p = String(ev.date || "").split("-");
        if (p.length === 3) {
          check(ev, remindMin, calRemOccTs(ev, +p[0], +p[1] - 1, +p[2]), ev.date);
        }
      }
    }

    if (due) {
      calRemFiredAdd(due.remKey);   // mutate BEFORE notify — no double-fire
      // Wave 1B: the reminder flows through the unified notification
      // system — inbox history + badge + styled toast + per-app
      // toggle + quiet hours. calRemNotify (bespoke overlay + web
      // Notification + pips) survives ONLY as the stale-bundle
      // fallback: a cached index.html without notifications.js must
      // never lose a reminder. NOTE: when the module exists but
      // returns null (user disabled calendar notifs / quiet hours /
      // dedup) we do NOT fall back — suppression is the point.
      if (window.orosNotifs && typeof window.orosNotifs.emit === "function") {
        window.orosNotifs.emit({
          ns: "calendar",
          key: due.remKey,
          type: "reminder",
          title: due.ev.title || calRemT("Reminder", "Υπενθύμιση"),
          body: calRemWhen(due.startTs),
          deepLink: "calendar:" + due.ev.id + ":" + due.remKey.split(":")[2]
        });
      } else {
        calRemNotify(due);   // module absent — legacy path stands alone
      }
    }
  }
  
    // Wave 1B — when-string for emitted calendar reminders (shared
  // shape with the legacy overlay's body copy).
  function calRemWhen(ts) {
    var loc = state.lang === "el" ? "el-GR" : "en-GB";
    var when = new Date(ts);
    return when.toLocaleDateString(loc, { day: "2-digit", month: "short" }) +
      " · " + when.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" });
  }


  var calRemRing = { timer: null };

  function calRemStopRing() {
    if (calRemRing.timer) { clearInterval(calRemRing.timer); calRemRing.timer = null; }
    var ov = document.getElementById("calrem-toast");
    if (ov) ov.remove();
  }

  // Persistent overlay: Dismiss button + 30s hard cap (same
  // doctrine as alarmNotify). Inline styles, palette vars only.
  function calRemNotify(due) {
    calRemStopRing();   // one at a time — new replaces old
    var loc = state.lang === "el" ? "el-GR" : "en-GB";
    var titleTxt = calRemT("Reminder", "Υπενθύμιση");
    var when = new Date(due.startTs);
    var whenStr = when.toLocaleDateString(loc, { day: "2-digit", month: "short" }) +
      " · " + when.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" });

    var el = document.createElement("div");
    el.id = "calrem-toast";
    el.setAttribute("role", "alert");
    el.style.cssText =
      "position:fixed;top:calc(48px + env(safe-area-inset-top,0px));right:12px;" +
      "z-index:1450;display:flex;align-items:center;gap:12px;max-width:calc(100vw - 24px);" +
      "background:var(--panel-bg);color:var(--text);border:1px solid var(--accent);" +
      "border-radius:10px;box-shadow:0 8px 24px var(--shadow);padding:10px 14px;";
    var body = document.createElement("div");
    body.style.cssText = "flex:1;min-width:0;";
    var title = document.createElement("div");
    title.style.cssText = "font-size:11px;font-weight:800;text-transform:uppercase;" +
      "letter-spacing:1px;color:var(--accent);";
    title.textContent = titleTxt;
    var label = document.createElement("div");
    label.style.cssText = "font-size:13.5px;font-weight:700;margin-top:2px;" +
      "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
    label.textContent = due.ev.title || titleTxt;
    var timeStr = document.createElement("div");
    timeStr.style.cssText = "font-size:12px;color:var(--text-dim);margin-top:1px;" +
      "font-variant-numeric:tabular-nums;";
    timeStr.textContent = whenStr;
    body.appendChild(title);
    body.appendChild(label);
    body.appendChild(timeStr);
    var btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = window.t("alarm.dismiss");
    btn.style.cssText =
      "flex-shrink:0;border:1px solid var(--accent);background:var(--accent-soft, rgba(109,74,255,0.1));" +
      "color:var(--accent);font:inherit;font-weight:700;font-size:12.5px;" +
      "border-radius:7px;padding:7px 12px;cursor:pointer;";
    btn.addEventListener("click", calRemStopRing);
    el.appendChild(body);
    el.appendChild(btn);
    document.body.appendChild(el);

    // Web Notification — ONLY if permission was already granted
    // (asked from the Calendar app's Save button = legal gesture).
    if ("Notification" in window && Notification.permission === "granted") {
      try {
        var n = new Notification("orOS — " + titleTxt, {
          body: due.ev.title || "",
          tag: due.remKey
        });
        n.onclick = function () { window.focus(); calRemStopRing(); };
      } catch (e) { /* visual overlay stands alone */ }
    }

    alarmPip();                              // same pip path as alarms
    calRemRing.timer = setInterval(alarmPip, 1500);
    setTimeout(function () {
      var ov = document.getElementById("calrem-toast");
      if (ov) calRemStopRing();
    }, 30000);                               // hard cap
  }

    // Throttle: renderClock ticks every 1s — the reminder scan runs
  // at most every 30s (JSON.parse of the whole calendar is not a
  // per-second job). No new setInterval, no background timers.
  var calRemLastTick = 0;
  function calRemTickThrottled() {
    var now = Date.now();
    if (now - calRemLastTick < 30000) return;
    calRemLastTick = now;
    calRemTick();
  }

  // Mood daily check-in reminder: same contract as Calendar — fires
  // once per day when no entry exists for today. Reads oros-mood-data
  // directly (same-origin), emits via window.orosNotifs.emit() with
  // deepLink "mood:checkin" (lands on capture tab). Device-local
  // dedupe key "checkin-YYYY-MM-DD" prevents double-firing.
  function moodCheckInDayKey(d) {
    // Accepts the entry's Date — guards against invalid/missing ts
    // (falls back to "today", same as the Calendar engine's stance
    // on corrupt data: never crash on a bad entry).
    if (!(d instanceof Date) || isNaN(d.getTime())) d = new Date();
    var yy = d.getFullYear();
    var mm = String(d.getMonth() + 1).padStart(2, "0");
    var dd = String(d.getDate()).padStart(2, "0");
    return yy + "-" + mm + "-" + dd;
  }

  function moodCheckInHasToday() {
    try {
      var raw = JSON.parse(localStorage.getItem("oros-mood-data"));
      if (!raw || !Array.isArray(raw.entries)) return false;
      var dk = moodCheckInDayKey();
      for (var i = 0; i < raw.entries.length; i++) {
        var e = raw.entries[i];
        if (!e || !e.ts) continue;
        var edk = moodCheckInDayKey(new Date(e.ts));
        if (edk === dk) return true;
      }
      return false;
    } catch (e) { return false; }
  }

  // SH-B7 (owner decision 2026-10-05): a reminder only makes sense
  // once the app has data. No Mood entry ever → no daily nagging.
  function moodHasAnyEntry() {
    try {
      var raw = JSON.parse(localStorage.getItem("oros-mood-data"));
      return !!(raw && Array.isArray(raw.entries) && raw.entries.length > 0);
    } catch (e) { return false; }
  }

  function moodCheckInTick() {
    if (!moodHasAnyEntry()) return;      // SH-B7: app never used — silent
    if (moodCheckInHasToday()) return;   // entry exists — silent
    var dedupeKey = "checkin-" + moodCheckInDayKey();
    // Emit through unified notification system: inbox history +
    // badge + styled toast + per-app toggle + quiet hours.
    if (window.orosNotifs && typeof window.orosNotifs.emit === "function") {
      window.orosNotifs.emit({
        ns: "mood",
        key: dedupeKey,
        type: "checkin",
        title: calRemT("Mood check-in", "Καταγραφή διάθεσης"),
        body: calRemT("How are you feeling today? Log your entry.",
                     "Πώς νιώθεις σήμερα; Κατέγραψε την είσοδό σου."),
        deepLink: "mood:checkin"
      });
    }
  }

  var moodCheckInLastTick = 0;
  function moodCheckInTickThrottled() {
    var now = Date.now();
    if (now - moodCheckInLastTick < 60000) return; // 1-minute throttle
    moodCheckInLastTick = now;
    moodCheckInTick();
  }

  // Wave 5 — closed-app fallback. When the Cycle iframe is NOT
  // running, the shell reads "oros-cycle-data" directly (same
  // origin — moodCheckInTick pattern) and re-applies the
  // nextPrediction math shell-side: byte-level mirror of cycle.js
  // (avg cycle = mean gap between consecutive starts, avg period =
  // mean inclusive length over ENDED periods, default 5, threshold
  // ≤2 days, Math.ceil against local midnight). The i18n strings
  // are DUPLICATED here on purpose — cycle.js STRINGS are
  // unreachable with the app closed; keys/bodies must stay
  // IDENTICAL so the app-open and app-closed paths produce the
  // same dedup key. If a string changes in cycle.js, change it
  // here too (maintenance note — changelog knows).
  var CYCLE_DATA_KEY = "oros-cycle-data";

  function cycleT(en, el) {
    return state.lang === "el" ? el : en;
  }

  function cycleSnapMidnight(ts) {
    if (typeof ts !== "number" || !isFinite(ts)) return null;
    var d = new Date(ts);
    if (isNaN(d.getTime())) return null;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }

  function cycleDayKey(ts) {
    var d = new Date(ts);
    var p2 = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate());
  }

  function cycleShellCheck() {
    var raw;
    try { raw = JSON.parse(localStorage.getItem(CYCLE_DATA_KEY)); }
    catch (e) { return null; }
    if (!raw || !Array.isArray(raw.periods)) return null;
    if (raw.prefs && raw.prefs.remind === false) return null;

    // valid starts, snapped to local midnight (storage arrives
    // migrated, but the app snaps defensively — we mirror that)
    var starts = [];
    raw.periods.forEach(function (p) {
      if (!p) return;
      var s = cycleSnapMidnight(p.start);
      if (s !== null) starts.push(s);
    });
    starts.sort(function (a, b) { return a - b; });   // oldest first
    if (starts.length < 2) return null;               // avgCycleLen honesty

    var gaps = [];
    for (var i = 1; i < starts.length; i++) {
      gaps.push(Math.round((starts[i] - starts[i - 1]) / DAY_MS));
    }
    var sum = 0;
    gaps.forEach(function (g) { sum += g; });
    var avg = Math.round(sum / gaps.length);

    // avg period length: ENDED periods only, inclusive days,
    // cycle.js default 5 when history has no ended period yet
    var lenSum = 0, lenN = 0;
    raw.periods.forEach(function (p) {
      if (p && typeof p.end === "number" && isFinite(p.end) &&
          typeof p.start === "number" && p.end >= p.start) {
        lenSum += Math.round((p.end - p.start) / DAY_MS) + 1;
        lenN++;
      }
    });
    var len = lenN ? Math.round(lenSum / lenN) : 5;

    var last = starts[starts.length - 1];
    var predStart = last + avg * DAY_MS;
    var ymd = cycleDayKey(predStart);

    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    var daysLeft = Math.ceil((predStart - today) / DAY_MS);
    if (daysLeft > 2) return null;

    if (daysLeft >= 0) {
      return {
        key: "pred-" + ymd + "-soon",
        title: cycleT("Cycle", "Κύκλος"),
        body: cycleT(
          "Period expected in ~{n} days",
          "Η περίοδος αναμένεται σε ~{n} ημέρες"
        ).replace("{n}", String(Math.max(1, daysLeft))),
        deepLink: "cycle:pred:" + ymd
      };
    }
    return {
      key: "pred-" + ymd + "-late",
      title: cycleT("Cycle", "Κύκλος"),
      body: cycleT(
        "Period appears overdue — expected ~{n} days ago",
        "Η περίοδος φαίνεται να αργεί — αναμενόταν πριν ~{n} ημέρες"
      ).replace("{n}", String(-daysLeft)),
      deepLink: "cycle:pred:" + ymd
    };
  }
  
    // Wave 7 — Todo due reminders (#TD4). Shell-side scan of
  // "oros-todo-data" (same doctrine as cycleShellCheck: app stays
  // untouched, works with the app closed, dedup key carries the
  // day + count so a GROWING backlog re-fires — new information,
  // not spam). Criterion mirrors overdueCount(): !done && due <=
  // today (ISO string compare). Suppression = the "todo" toggle
  // in Settings → Notifications; no in-app pref by design.
  var TODO_DATA_KEY = "oros-todo-data";

  function todoCheckTick() {
    var raw;
    try { raw = JSON.parse(localStorage.getItem(TODO_DATA_KEY)); }
    catch (e) { return; }
    if (!raw || !Array.isArray(raw.lists)) return;

    var today = sysYmd();
    var due = 0, earliest = null, earliestList = null;
    raw.lists.forEach(function (l) {
      if (!l || !Array.isArray(l.items)) return;
      l.items.forEach(function (it) {
        if (!it || it.done || typeof it.due !== "string") return;
        if (it.due <= today) {
          due++;
          if (earliest === null || it.due < earliest) {
            earliest = it.due;
            earliestList = l.id;
          }
        }
      });
    });
    if (due === 0) return;

    var N = window.orosNotifs;
    if (!(N && typeof N.emit === "function")) return;   // stale bundle — silent

    var title = window.t("app.todo");
    if (title === "app.todo") title = "To-Do";          // missing-key fallback
    var el = state.lang === "el";
    N.emit({
      ns: "todo",
      key: "due-" + today + "-" + due,
      type: "due",
      title: title,
      body: el
        ? (due + (due === 1 ? " εργασία λήγει ή έχει λήξει"
                            : " εργασίες λήγουν ή έχουν λήξει"))
        : (due + (due === 1 ? " task is due or overdue"
                            : " tasks are due or overdue")),
      deepLink: earliestList ? "todo:" + earliestList : ""
    });
  }

  // Wave 13 — Quote due-date reminders. Shell-side scan of
  // "oros-quote-data" for sent/accepted quotes with due dates
  // within ≤2 days or overdue. Drafts/expired/rejected excluded.
  // Dedup key "due-<ymd>-<count>" prevents spam while growing
  // backlogs re-trigger (new information each time).
  var QUOTE_DATA_KEY = "oros-quote-data";

  function quoteCheckTick() {
    var raw;
    try { raw = JSON.parse(localStorage.getItem(QUOTE_DATA_KEY)); }
    catch (e) { return; }
    if (!raw || !Array.isArray(raw.quotes)) return;

    var today = sysYmd();
    var due = 0, earliestId = null, earliestDue = null;
    raw.quotes.forEach(function (q) {
      if (!q || !q.id || typeof q.dueDate !== "string") return;
      // Filter: only sent/accepted quotes trigger reminders
      if (q.status !== "sent" && q.status !== "accepted") return;
      
      // Horizon: today + 2 days (≤2 days or overdue)
      var hd = new Date();
      hd.setDate(hd.getDate() + 2);
      var p2 = function (n) { return (n < 10 ? "0" : "") + n; };
      var horizon = hd.getFullYear() + "-" + p2(hd.getMonth() + 1) + "-" + p2(hd.getDate());
      
      if (q.dueDate <= horizon) {
        due++;
        if (earliestDue === null || q.dueDate < earliestDue) {
          earliestId = q.id;
          earliestDue = q.dueDate;
        }
      }
    });
    if (due === 0) return;

    var N = window.orosNotifs;
    if (!(N && typeof N.emit === "function")) return;   // stale bundle — silent

    var title = window.t("app.quote");
    if (title === "app.quote") title = "Quote";         // missing-key fallback
    var el = state.lang === "el";
    N.emit({
      ns: "quote",
      key: "due-" + today + "-" + due,
      type: "due",
      title: title,
      body: el
        ? (due + (due === 1 ? " προσφορά λήγει ή έχει λήξει"
                            : " προσφορές λήγουν ή έχουν λήξει"))
        : (due + (due === 1 ? " quote is due or overdue"
                            : " quotes are due or overdue")),
      deepLink: earliestId ? "quote:" + earliestId : ""
    });
  }

  // Wave 4 — Cycle prediction reminder. The running Cycle iframe
  // owns the DECISION (prefs + prediction math + i18n strings — all
  // live in cycle.js); the shell owns timing + emission. Relay into
  // the iframe via contentWindow (same pattern as __orosOpenCycle).
  // Wave 5: app CLOSED → cycleShellCheck() decides shell-side over
  // localStorage — same key space, so dedup holds across both paths.
  var cycleCheckLastTick = 0;
  function cycleCheckTickThrottled() {
    var now = Date.now();
    if (now - cycleCheckLastTick < 60000) return;  // 1-minute throttle
    cycleCheckLastTick = now;
    cycleCheckTick();
  }

  function cycleCheckTick() {
    todoCheckTick();                  // Wave 7 — rides the same 60s throttle
    var payload = null;
    if (state.running && state.running.id === "cycle") {
      // App open: the iframe owns the decision (prefs + math +
      // i18n — all in cycle.js). Mid-load iframe → next tick.
      var f = document.getElementById("app-frame");
      try {
        if (f && f.contentWindow &&
            typeof f.contentWindow.__orosCycleCheck === "function") {
          payload = f.contentWindow.__orosCycleCheck();
        }
      } catch (e) { return; }   // iframe mid-load — next tick retries
    } else {
      // Wave 5 — app closed: shell-side fallback over localStorage.
      payload = cycleShellCheck();
    }
    if (!payload || typeof payload !== "object") return;
    if (!payload.key || !payload.title || !payload.body) return;
    if (!(window.orosNotifs && typeof window.orosNotifs.emit === "function")) return;
    window.orosNotifs.emit({
      ns:      "cycle",
      key:     payload.key,
      type:    "pred",
      title:   payload.title,
      body:    payload.body,
      deepLink: payload.deepLink || ""
    });
  }

  // Wave 1A — notification scheduler piggyback: renderClock ticks
  // 1/s; the notifs sweep runs at most every 60s (the module self-
  // throttles). Cheap noop when notifications.js hasn't loaded.
  // SY-D3 companion: a closed app whose local changes are waiting
  // for a merge (sync.js getDeferred) gets ONE notice that opens the
  // app — opening it is what resolves the conflict. The inbox dedupe
  // keeps it to one line per app until the item expires; while the
  // conflict is still pending after that, it is said again.
  window.__orosOpenApp = function (id) {
    openAppById(String(id));
  };
  var syncPendingLastTick = 0;
  function syncPendingTickThrottled() {
    var now = Date.now();
    if (now - syncPendingLastTick < 60000) return;
    syncPendingLastTick = now;
    var S = window.orosSync, N = window.orosNotifs;
    if (!S || typeof S.getDeferred !== "function" || !N || typeof N.emit !== "function") return;
    var names;
    try { names = S.getDeferred(); } catch (e) { return; }
    for (var i = 0; i < names.length; i++) {
      var id = names[i];
      var nameKey = "app." + id;
      var label = window.t(nameKey);
      if (label === nameKey) label = id;
      N.emit({
        ns: "system",
        key: "sync-pending-" + id,
        type: "sys",
        title: window.t("sync.pending.title").replace("{app}", label),
        body: window.t("sync.pending.body"),
        deepLink: "system:open:" + id
      });
    }
  }

  var notifLastTick = 0;
  function notifTickThrottled() {
    var now = Date.now();
    if (now - notifLastTick < 60000) return;
    notifLastTick = now;
    try {
      if (window.orosNotifs && typeof window.orosNotifs.tick === "function") {
        window.orosNotifs.tick();
      }
    } catch (e) {}
  }

  // ---------- 9i. Radio tray chip (Wave 2 Radio) ----------
  // The audio host lives on THIS window (window.__orosRadioHost),
  // created by radio.js on first app open — playback survives the
  // app's iframe close (about:blank), same doctrine as orosAlarms.
  // The shell owns ONLY the tray chip: single click opens the Radio
  // app directly (standing rule), and the chip paints the now-
  // playing station. No host / no station → no chip (zero DOM).
  // Paint is tick-safe: renderClock ticks 1/s but the DOM is touched
  // only when state actually changed (same doctrine as wxRenderChip).
  // Dropdown icon set (same SVG family as ICONS above)
  var RX_STOP  = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
  var RX_PLAY  = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 4 20 12 6 20 6 4"/></svg>';
  var RX_PAUSE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
  var RX_HEART = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z"/></svg>';

  var RX_POP_ID = "rx-tray-pop";
  var rxPopWired = false;

  function rxTrayT(en, el) {
    return state.lang === "el" ? el : en;
  }

  function rxTrayPop() { return document.getElementById(RX_POP_ID); }

  function rxTrayClosePop() {
    var p = rxTrayPop();
    if (p) p.remove();
  }

  // Outside-click + Escape wiring — lazily, on first dropdown open
  // (zero cost while the tray is never touched).
  function rxTrayWireDoc() {
    if (rxPopWired) return;
    rxPopWired = true;
    document.addEventListener("click", function (e) {
      var pop = rxTrayPop();
      if (!pop || pop.contains(e.target)) return;
      var chip = document.getElementById("rx-tray-chip");
      if (chip && chip.contains(e.target)) return;
      rxTrayClosePop();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") rxTrayClosePop();
    });
  }

  // Audio-element commands — the host's audio lives on THIS window
  // (survives iframe close), so the tray controls speak to it
  // directly. Works with the Radio app closed, standing doctrine.
  // Live stream: stop ≈ pause (the src stays armed), play resumes.
  function rxTrayStop() {
    var host = window.__orosRadioHost;
    if (host && host.audio) {
      try { host.audio.pause(); } catch (e) {}
    }
  }

  function rxTrayPlay() {
    var host = window.__orosRadioHost;
    if (!host || !host.audio) return;
    var a = host.audio;
    // Defensive re-arm: if the src was ever stripped, take it from
    // the current station state (when exposed) before playing.
    if (!a.src) {
      var st = null;
      try { st = host.api.getState(); } catch (e) {}
      var url = st && st.current && st.current.url;
      if (url) { a.src = url; a.load(); }
    }
    var pr = a.play();
    if (pr && typeof pr.catch === "function") pr.catch(function () {});
  }

  function rxTrayFav() {
    var host = window.__orosRadioHost;
    // Preferred: a favorite hook on the host api. Fallback: open
    // the app — favorites live in its data slice, the shell NEVER
    // writes that slice blind.
    if (host && host.api && typeof host.api.favoriteToggle === "function") {
      try { host.api.favoriteToggle(); return; } catch (e) {}
    }
    openAppById("radio");
  }

  // Live repain of the Play/Pause icon while the dropdown is open
  // (state changes from Media keys etc. must reflect immediately).
  function rxTrayPaintLive() {
    if (!rxTrayPop()) return;
    var pp = document.getElementById("rx-pop-pp");
    if (!pp) return;
    var host = window.__orosRadioHost;
    var paused = true;
    try {
      var st = host.api.getState();
      paused = !(st && st.playing && !st.paused);
    } catch (e) {}
    pp.innerHTML = paused ? RX_PLAY : RX_PAUSE;
    pp.title = rxTrayT(paused ? "Play" : "Pause",
                       paused ? "Αναπαραγωγή" : "Παύση");
    pp.setAttribute("aria-label", pp.title);
  }

  function rxTrayTogglePop() {
    if (rxTrayPop()) { rxTrayClosePop(); return; }

    var host = window.__orosRadioHost;
    if (!host || !host.audio || !host.api ||
        typeof host.api.getState !== "function") return;
    rxTrayWireDoc();

    var pop = document.createElement("div");
    pop.id = RX_POP_ID;
    pop.setAttribute("role", "menu");
    // Top-right, just under the taskbar — same docking convention
    // as scToast/alarm overlays. Inline styles, palette vars only.
    pop.style.cssText =
      "position:fixed;top:calc(48px + env(safe-area-inset-top,0px));right:12px;" +
      "z-index:1460;background:var(--panel-bg);color:var(--text);" +
      "border:1px solid var(--border);border-radius:12px;" +
      "box-shadow:0 8px 24px var(--shadow);padding:10px;" +
      "display:flex;flex-direction:column;gap:10px;" +
      "max-width:calc(100vw - 24px);";

    // One quiet station-name line — the context for what the
    // buttons control. Remove this block for a pure-icon dropdown.
    var st = null;
    try { st = host.api.getState(); } catch (e) {}
    var name = (st && st.current && st.current.name) ? st.current.name : "";
    if (name) {
      var lbl = document.createElement("div");
      lbl.style.cssText =
        "font-size:12px;font-weight:600;color:var(--text-dim);" +
        "max-width:220px;overflow:hidden;text-overflow:ellipsis;" +
        "white-space:nowrap;";
      lbl.textContent = name;
      pop.appendChild(lbl);
    }

    // Icon-button row: Stop · Play/Pause · Fav · App
    var row = document.createElement("div");
    row.style.cssText = "display:flex;gap:6px;";

    function mkIcoBtn(svg, tip, fn, idAttr) {
      var b = document.createElement("button");
      b.type = "button";
      if (idAttr) b.id = idAttr;
      b.innerHTML = svg;
      b.title = tip;
      b.setAttribute("aria-label", tip);
      b.style.cssText =
        "width:40px;height:40px;display:inline-flex;align-items:center;" +
        "justify-content:center;border:1px solid var(--border);" +
        "border-radius:9px;background:transparent;color:var(--text);" +
        "cursor:pointer;";   // 40px+ = SH-R6 touch doctrine
      b.addEventListener("click", fn);
      return b;
    }

    row.appendChild(mkIcoBtn(RX_STOP, rxTrayT("Stop", "Διακοπή"), function () {
      rxTrayStop();
      rxTrayPaintLive();
    }));

    row.appendChild(mkIcoBtn(
      RX_PLAY, rxTrayT("Play / Pause", "Αναπαραγωγή / Παύση"),
      function () {
        var h = window.__orosRadioHost;
        if (h && h.audio) {
          if (h.audio.paused) rxTrayPlay(); else rxTrayStop();
        }
        rxTrayPaintLive();
      }, "rx-pop-pp"));

    row.appendChild(mkIcoBtn(RX_HEART, rxTrayT("Favorite", "Αγαπημένο"),
      rxTrayFav));

    row.appendChild(mkIcoBtn(ICONS.radio,
      rxTrayT("Open Radio", "Άνοιγμα Ραδιοφώνου"), function () {
        rxTrayClosePop();
        if (state.running && state.running.id === "radio") returnToDesktop();
        else openAppById("radio");
      }));

    pop.appendChild(row);

    // Volume — speaks straight to the host's audio element (0..1)
    var volRow = document.createElement("div");
    volRow.style.cssText = "display:flex;align-items:center;gap:8px;";
    var vol = document.createElement("input");
    vol.type = "range";
    vol.min = "0"; vol.max = "1"; vol.step = "0.05";
    var startVol = 1;
    try {
      if (typeof host.audio.volume === "number") startVol = host.audio.volume;
    } catch (e) {}
    vol.value = String(startVol);
    vol.setAttribute("aria-label", rxTrayT("Volume", "Ένταση"));
    vol.style.cssText =
      "width:150px;accent-color:var(--accent);cursor:pointer;margin:0;";
    var pct = document.createElement("span");
    pct.style.cssText =
      "font-size:11px;color:var(--text-dim);min-width:34px;text-align:right;" +
      "font-variant-numeric:tabular-nums;";
    pct.textContent = Math.round(startVol * 100) + "%";
    vol.addEventListener("input", function () {
      var h = window.__orosRadioHost;
      if (h && h.audio) {
        try { h.audio.volume = parseFloat(vol.value); } catch (e) {}
      }
      pct.textContent = Math.round(parseFloat(vol.value) * 100) + "%";
    });
    volRow.appendChild(vol);
    volRow.appendChild(pct);
    pop.appendChild(volRow);

    document.body.appendChild(pop);
    rxTrayPaintLive();
  }

  function radioTrayTick() {
    var bar = document.querySelector(".bar-right");
    if (!bar) return;

    var host = window.__orosRadioHost;
    var chip = document.getElementById("rx-tray-chip");

    if (!host || !host.api || typeof host.api.getState !== "function") {
      if (chip) chip.remove();
      rxTrayClosePop();
      return;
    }

    var st = null;
    try { st = host.api.getState(); } catch (e) { st = null; }

    // No station ever played (or stale host shape) → no chip
    if (!st || !st.current || !st.current.name) {
      if (chip) chip.remove();
      rxTrayClosePop();
      return;
    }

    if (!chip) {
      chip = document.createElement("button");
      chip.id = "rx-tray-chip";
      chip.type = "button";
      chip.style.minHeight = "44px";   // SH-R6: Part VIII doctrine (touch targets)
      chip.addEventListener("click", function (e) {
        e.stopPropagation();
        rxTrayTogglePop();   // click = dropdown (direct open lives in the App button)
      });
      bar.insertBefore(chip, document.getElementById("btn-lang"));
    }

    var playing = !!(st.playing && !st.paused);
    var name = st.current.name;
    var errored = !!(st.flags && st.flags.error);

    // Radio icon ONLY — no station name on the bar. State rides on
    // data-state (CSS color/opacity hook) + the tooltip carries
    // the full now-playing info (set via .title property — safe).
    var dstate = errored ? "err" : (playing ? "on" : "off");
    var title =
      (playing ? "▶ " : "⏸ ") + name +
      (errored ? " · " + (state.lang === "el" ? "Σφάλμα ροής" : "Stream error") : "");

    if (chip.getAttribute("data-state") !== dstate || chip.title !== title) {
      chip.setAttribute("data-state", dstate);
      chip.innerHTML = ICONS.radio;
      chip.title = title;
      chip.setAttribute("aria-label", title);   // SH-R11: state spoken
    }

    // Dropdown open → the Play/Pause icon follows live state
    if (rxTrayPop()) rxTrayPaintLive();
  }

  // Radio deep-link bridge (pattern: Quote/Minimalism). Payload =
  // stationuuid. App ανοιχτό → live push __orosRadioOpen στο iframe·
  // κλειστό → staging στο sessionStorage (device-local, swept από το
  // factory reset, δεν ταξιδεύει στο sync ποτέ) + άνοιγμα app.
  window.__orosOpenRadio = function (stationUuid) {
    if (typeof stationUuid !== "string" || !stationUuid) return;
    if (state.running && state.running.id === "radio") {
      var f = document.getElementById("app-frame");
      try {
        if (f && f.contentWindow &&
            typeof f.contentWindow.__orosRadioOpen === "function") {
          f.contentWindow.__orosRadioOpen(stationUuid);
          return;
        }
      } catch (e) {}
    }
    try { sessionStorage.setItem("oros-radio-open", stationUuid); } catch (e) {}
    openAppById("radio");
  };

  // Consumed by radio.js at boot — one-shot take (ίδιο μάθημα με
  // todo/minimalism: αν το receiver λείπει από το app, το pending
  // uuid απλά αγνοείται — τίποτα δεν σπάει).
  window.__orosRadioTakePending = function () {
    try {
      var id = sessionStorage.getItem("oros-radio-open");
      if (id) sessionStorage.removeItem("oros-radio-open");
      return id || null;
    } catch (e) { return null; }
  };

  // ---------- 9j. Settings app bridge (window.orosSettings) ----------
  // The Settings app (settings/, System) is a plain iframe app: it
  // never writes storage and registers no slice. Every value comes
  // from get(), every change goes through set() / act(), which call
  // the SAME functions the menu calls. So stamps, dirty marks and
  // merges are exactly the menu's: nothing to migrate, and a device
  // on an older bundle syncs with this one as before. Notifications
  // and the screen pet keep their own public modules (orosNotifs,
  // orosPet); the app talks to them directly.
  // onChange(fn): fn() runs (batched) after anything that repaints
  // the menu (user change, pull, unlock, sync message) and after
  // each background sync round. Returns an unsubscribe function.
  var settingsListeners = [];
  var settingsNotifyQueued = false;

  function settingsNotify() {
    if (settingsNotifyQueued || !settingsListeners.length) return;
    settingsNotifyQueued = true;
    setTimeout(function () {
      settingsNotifyQueued = false;
      settingsListeners.slice().forEach(function (fn) {
        try { fn(); } catch (e) {
          // A closed app frame that never unsubscribed: drop it.
          var i = settingsListeners.indexOf(fn);
          if (i !== -1) settingsListeners.splice(i, 1);
        }
      });
    }, 0);
  }

  // The Dock (launcher.js) keeps its own device-local prefs; the
  // Settings app shows them only when launcher.js offers prefs() and
  // setPref() (otherwise the menu keeps the launcher's own section).
  function settingsLauncher() {
    var L = window.orosLauncher;
    return (L && typeof L.prefs === "function" && typeof L.setPref === "function") ? L : null;
  }
  function settingsDock() {
    var L = settingsLauncher();
    if (!L) return null;
    try {
      var p = L.prefs() || {};
      return { on: !!p.on, size: p.size, magnify: !!p.magnify, autohide: !!p.autohide,
               over: !!p.over, fine: !!p.fine, pinned: Number(p.pinned) || 0 };
    } catch (e) { return null; }
  }

  function settingsSnapshot() {
    var S = window.orosSync || null;
    var connected = !!(S && S.isConnected());
    var unlocked = !!(connected && S.hasPassphrase());
    var art = wpArt();
    var hasArt = !!(state.wpart && art);
    var folder = null, lapsed = false;
    try {
      folder = localStorage.getItem(FS_FOLDER_NAME_KEY);
      lapsed = !!localStorage.getItem(FS_LAPSED_KEY);
    } catch (e) {}
    var mac = /Mac|iPhone|iPad/i.test(navigator.platform || "");
    return {
      version: APP_VERSION,
      lang: state.lang,
      theme: state.theme,
      skin: state.skin,
      skins: SKINS.map(function (k) {
        return { id: k.id, color: k.color, name: skinTitle(k.id) };
      }),
      wallpaper: state.wallpaper,
      wallpapers: WALLPAPERS.map(function (w) {
        var css = w.css;
        if (w.id === "custom") {
          if (!hasArt) css = null;   // nothing made yet → "make one"
          else {
            var bgc = art.colors(state.wpart, wpAccent()).bg;
            css = (wpShown && wpShown.url) ? wpBg(bgc, wpShown.url) : bgc;
          }
        }
        return { id: w.id, css: css, name: wallpaperTitle(w.id) };
      }),
      pet: {
        available: !!(window.orosPet && typeof window.orosPet.toggle === "function"),
        on: !!(window.orosPet && typeof window.orosPet.isEnabled === "function" &&
               window.orosPet.isEnabled())
      },
      sync: {
        available: !!S,
        connected: connected,
        unlocked: unlocked,
        email: connected ? (state.syncUserEmail || null) : null,
        dirty: !!(unlocked && S.isDirty()),
        hasVault: !!(connected && S.hasDeviceVault()),
        interval: getSafeInterval(),
        intervals: [0, 1, 3, 5, 15],
        minPass: MIN_PASS_LEN,
        msg: state.syncMsg ? { kind: state.syncMsg.kind, text: state.syncMsg.text }
           : (state.syncAutoErr ? { kind: "err", text: state.syncAutoErr } : null)
      },
      backup: {
        folderSupported: fsSupported(),
        autoexport: state.autoexport,
        folder: folder || null,
        lapsed: !!(folder && lapsed)
      },
      search: searchApps().map(function (a) {
        var k = "app." + a.id, v = window.t(k);
        return { id: a.id, name: (v === k) ? a.name : v, on: searchEnabled(a.id) };
      }),
      install: !!state.deferredPrompt,
      dock: settingsDock(),
      apps: state.apps.filter(function (a) { return a && a.type === "internal"; })
        .map(function (a) { return a.id; }),
      shortcuts: SC_DEFS.map(function (d) {
        return { combo: (mac ? "⌃⌥⇧" : "Ctrl+Alt+Shift+") + d.key.toUpperCase(),
                 label: window.t(d.label) };
      })
    };
  }

  function settingsSet(name, value) {
    switch (name) {
      case "lang":
        if ((value === "en" || value === "el") && value !== state.lang) scToggleLang();
        return;
      case "theme":      setThemeUser(value); return;
      case "skin":       setSkinUser(value); return;
      case "wallpaper":
        if (value === "custom" && !(state.wpart && wpArt())) { openAppById("wallpaper"); return; }
        setWallpaperUser(value);
        return;
      case "pet":
        if (window.orosPet && typeof window.orosPet.toggle === "function" &&
            !!value !== !!window.orosPet.isEnabled()) {
          window.orosPet.toggle();
          renderMenu();
        }
        return;
      case "syncInterval": setSyncIntervalUser(Number(value)); return;
      case "autoexport":   setAutoexportUser(value); return;
    }
    if (/^dock:(on|size|magnify|autohide|over)$/.test(name)) {
      var L = settingsLauncher();
      if (L) { L.setPref(name.slice(5), value); settingsNotify(); }
      return;
    }
    if (/^search:/.test(name)) {
      var id = name.slice(7);
      var known = searchApps().some(function (a) { return a.id === id; });
      if (known && searchEnabled(id) !== !!value) {
        setSearchEnabled(id, !!value);
        renderMenu();
      }
    }
  }

  function settingsAct(name, arg) {
    var S = window.orosSync;
    switch (name) {
      case "sync.connect":    if (S && !S.isConnected()) S.connect(); return;
      case "sync.unlock":
        if (S && S.isConnected() && !S.hasPassphrase() && arg && typeof arg.pw === "string") {
          syncUnlock(arg.pw, !!arg.remember);
        }
        return;
      case "sync.pull":       scForcePull(); return;
      case "sync.push":       syncPushNow(); return;
      case "sync.forget":     syncForgetHere(); return;
      case "sync.changePass": if (S && S.isConnected() && S.hasPassphrase()) showChangePassDialog(); return;
      case "sync.disconnect": syncDisconnectUser(); return;
      // Folder picker and permission prompts need a user gesture: the
      // app calls these straight from its click handler (the gesture
      // of a same-origin frame counts for the shell window too).
      case "backup.chooseFolder":    if (fsSupported()) chooseBackupFolder(); return;
      case "backup.stopFolder":      stopFolderBackups(); return;
      case "backup.reconnectFolder": reconnectFolder(); return;
      case "backup.now":      scBackupNow(); return;
      case "backup.export":   scExportDb(); return;
      case "backup.import":   importBackupFile(); return;
      case "install":
        if (!state.deferredPrompt) return;
        state.deferredPrompt.prompt();
        state.deferredPrompt.userChoice.then(function (choice) {
          if (choice.outcome === "accepted") { state.deferredPrompt = null; renderMenu(); }
        });
        return;
      case "updates":         scCheckUpdates(); return;
      case "info":            showInfoModal(); return;
      case "openApp":         if (typeof arg === "string") openAppById(arg); return;
      // The app arms and confirms first (two taps, like the Info modal);
      // this is the same wipe, with no button of its own to update.
      case "reset":           scFactoryReset({ disabled: false, textContent: "" }); return;
    }
  }

  window.orosSettings = {
    v: 1,
    get: settingsSnapshot,
    set: settingsSet,
    act: settingsAct,
    onChange: function (fn) {
      if (typeof fn !== "function") return function () {};
      settingsListeners.push(fn);
      return function () {
        var i = settingsListeners.indexOf(fn);
        if (i !== -1) settingsListeners.splice(i, 1);
      };
    },
    // Open the Settings app at a section ("sync", "backup", …).
    open: function (section) {
      window.__orosOpenAt("settings", { section: String(section || "") });
    }
  };

  if (window.orosSync && typeof window.orosSync.onAutoSync === "function") {
    window.orosSync.onAutoSync(function (kind) { if (kind !== "start") settingsNotify(); });
  }

  // ---------- 10. App opening (fullscreen takeover) ----------

  function openApp(app) {
    closeMenu();
    if (tourEnd) tourEnd();   // a notification or shortcut opened an app mid-tour
    if (app.type === "external") {
      window.open(app.url, "_blank", "noopener");
      return;
    }
    state.running = app;
    document.body.classList.add("app-running");   // narrow bar: "?" takes the language button's place
    document.getElementById("app-frame").src = app.url;
    document.getElementById("oros-running").classList.add("active");
    document.getElementById("oros-desktop").style.display = "none";
    var mb = document.getElementById("btn-menu");
    mb.classList.add("running");
    document.getElementById("btn-menu-label").textContent = window.t("running.back");
    mb.setAttribute("data-i18n-title", "running.home");
    mb.setAttribute("title", window.t("running.home"));   // paint NOW — don't wait for applyLang()
    var nk = "app." + app.id, tv = window.t(nk);
    document.title = ((tv === nk) ? app.name : tv) + " · orOS";   // #4: title follows the running app (translated)
  }

  function returnToDesktop() {
    state.running = null;
    document.body.classList.remove("app-running");
    document.getElementById("app-frame").src = "about:blank";
    document.getElementById("oros-running").classList.remove("active");
    document.getElementById("oros-desktop").style.display = "";
    var mb = document.getElementById("btn-menu");
    mb.classList.remove("running");
    document.getElementById("btn-menu-label").textContent = window.t("bar.menu");
    mb.setAttribute("data-i18n-title", "bar.menu");
    mb.setAttribute("title", window.t("bar.menu"));   // paint NOW — don't wait for applyLang()
    document.title = "orOS";                 // v0.18.2: back to the bare OS title
    tourMaybe();   // a first-run tour put off by a launch-param app
  }

  // ---------- 11. Menu open/close ----------
  function toggleMenu() {
    if (state.running) { returnToDesktop(); return; }
    document.getElementById("app-menu").classList.toggle("open");
  }
  function closeMenu() {
    document.getElementById("app-menu").classList.remove("open");
  }

  // ---------- 12. Wiring & boot ----------
  document.getElementById("btn-menu").addEventListener("click", function (e) {
    e.stopPropagation();
    toggleMenu();
  });

  // Clicks inside the menu never reach the outside-close handler.
  // (Re-renders detach the clicked node mid-event, which made
  // menu.contains(target) false — the "clicked outside" bug.)
  document.getElementById("app-menu").addEventListener("click", function (e) {
    e.stopPropagation();
  });

  document.addEventListener("click", function (e) {
    var menu = document.getElementById("app-menu");
    if (menu.classList.contains("open") && !menu.contains(e.target)) closeMenu();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      if (document.getElementById("sc-info-overlay")) return;     // #5: modal owns Escape
      // SH-B2: a native <dialog> and the radio tray popover close
      // themselves on Escape. The same keypress must not ALSO close
      // the running app behind them.
      if (document.querySelector("dialog[open]")) return;
      if (document.getElementById(RX_POP_ID)) return;
      if (document.getElementById("app-menu").classList.contains("open")) closeMenu();
      else if (state.running) returnToDesktop();
    }
  });

  document.getElementById("btn-lang").addEventListener("click", function () {
    state.lang = state.lang === "en" ? "el" : "en";
    localStorage.setItem("oros-lang", state.lang);
    noteLocalChange();            // user action → sync engine
    applyLang();
    refreshRunningApp();          // v0.18.1b: open apps follow the toggle
  });

  // Unsynced-changes guard: warn on close when dirty AND online
  // (offline data is safe in localStorage — nothing to warn about).
  window.addEventListener("beforeunload", function (e) {
    if (osResetting) return;   // factory reset owns this unload
    // SH-B8: sync.js arms the dirty flag on EVERY change, connected or
    // not, and only a successful push clears it. Without Dropbox (or
    // while locked) the flag is permanent — and this guard asked
    // "Leave site?" on every single close. Warn only when a push
    // could actually follow: connected + unlocked + online.
    var sy = window.orosSync;
    if (sy && sy.isDirty() && navigator.onLine &&
        typeof sy.isConnected === "function" && sy.isConnected() &&
        typeof sy.hasPassphrase === "function" && sy.hasPassphrase()) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
  
    // v0.18.1 — sync dot click = sync NOW (pull, then push if dirty).
  // Not connected → error toast. Connected but locked → opens the
  // menu at the passphrase section (no new i18n keys needed).
  function syncNowFromDot() {
    if (!window.orosSync) return;
    if (!window.orosSync.isConnected() || !window.orosSync.hasPassphrase()) {
      // Off or locked: connecting and the passphrase live in
      // Settings → Sync — open it there.
      window.orosSettings.open("sync");
      return;
    }
    setSyncMsgRaw("dim", window.t("sync.working"));
    setSyncDot("syncing");
    window.orosSync.pull()
      .then(function (result) {
        var pulled = result && !result.empty ? result.applied : 0;
        if (window.orosSync.isDirty()) {
          return window.orosSync.push()
            .then(function () {
              setSyncMsgRaw("ok", (pulled
                  ? window.t("sync.ok.pull") + " (" + pulled + ") · "
                  : "") + window.t("sync.ok.push"));
              setSyncDot("synced", 4000);
            });
        }
        // Nothing to push up: report only what came down (if anything)
        if (pulled) {
          setSyncMsgRaw("ok", window.t("sync.ok.pull") + " (" + pulled + ")");
        } else {
          setSyncMsg("ok", result && result.empty ? "sync.ok.cloud.empty" : "sync.ok.none");
        }
        setSyncDot("synced", 4000);
      })
      .catch(handleSyncError);
  }

  // v0.18.0 — taskbar sync dot injection (R9: HTML ships empty)
  (function () {
    var bar = document.querySelector(".bar-right");
    if (!bar) return;
    var btn = document.createElement("button");
    btn.id = "sync-dot-btn";
    btn.type = "button";
    btn.innerHTML = '<span id="sync-dot" data-state="off"></span>';
    btn.setAttribute("aria-label", window.t("sync.dot.aria"));
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      syncNowFromDot();
    });
    bar.insertBefore(btn, document.getElementById("btn-lang"));
  })();
  
    // E1/E2 — taskbar time/date buttons → Time / Calendar apps.
  // Direct single-click open; when the entry is missing from a
  // stale apps.json, fall back to the menu instead of dying silently.
  function openAppById(id) {
    if (state.running && state.running.id === id) return;   // already there
    for (var i = 0; i < state.apps.length; i++) {
      if (state.apps[i].id === id) { openApp(state.apps[i]); return; }
    }
    document.getElementById("app-menu").classList.add("open");
  }

  // Help app: the taskbar "?" (and Ctrl+Alt+Shift+H) opens the guide
  // at the page of the running app (#a/<id>), else at its start. The
  // button shows only when apps.json lists "help". Apps reach the
  // same calls through window.parent.orosHelp (open a help route,
  // open an app from a guide link).
  function helpApp() {
    for (var i = 0; i < state.apps.length; i++) {
      if (state.apps[i].id === "help") return state.apps[i];
    }
    return null;
  }

  function openHelp(route) {
    var app = helpApp();
    if (!app) return;
    if (route === undefined) {
      route = (state.running && state.running.id !== "help") ? "a/" + state.running.id : "";
    }
    route = String(route || "");
    if (!/^([at]\/[a-z0-9-]+(\/[a-z0-9\u03b1-\u03c9-]+)?)?$/.test(route)) route = "";
    if (state.running && state.running.id === "help") {
      if (!route) return;
      // Absolute URL: a relative "#…" would resolve against the SHELL
      // page and load the shell inside the frame.
      try {
        var loc = document.getElementById("app-frame").contentWindow.location;
        loc.replace(String(loc.href).split("#")[0] + "#" + route);
      } catch (e) {}
      return;
    }
    openApp({ id: app.id, name: app.name, category: app.category, icon: app.icon,
              type: app.type, url: app.url + (route ? "#" + route : "") });
  }

  function helpBtnRefresh() {
    var btn = document.getElementById("help-btn");
    if (btn) btn.hidden = !helpApp();
  }

  (function () {
    var bar = document.querySelector(".bar-right");
    if (!bar) return;
    var btn = document.createElement("button");
    btn.id = "help-btn";
    btn.type = "button";
    btn.hidden = true;
    btn.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M9.3 9.2a2.8 2.8 0 0 1 5.4 1c0 1.9-2.7 2.5-2.7 4.1"/><path d="M12 17.6h.01"/></svg>';
    btn.setAttribute("data-i18n-title", "bar.help");   // title = accessible name, repainted by applyLang()
    btn.setAttribute("title", window.t("bar.help"));
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      openHelp();
    });
    bar.insertBefore(btn, document.getElementById("btn-lang"));
  })();

  window.orosHelp = {
    open: function (route) { openHelp(route === undefined ? "" : route); },
    openApp: function (id) { if (id !== "help") openAppById(String(id)); },
    tour: function () { startTour(); }
  };

  // ---------- Help phase 3: first-run tour of the top bar ----------
  // Shown once, automatically, to NEW users only (checkVersionToast
  // saw no stored version → tourFirstRun). Replayable from Help
  // ("tour:start" link) via orosHelp.tour(). It waits for the splash
  // and for the desktop: an app opened by a launch param or share
  // keeps the flag until the user is back on the desktop.
  // "oros-tour-done" (set once the tour has run) keeps it from ever
  // starting on its own again; test harnesses preset it too.
  var TOUR_KEY = "oros-tour-pending";
  var TOUR_DONE = "oros-tour-done";
  var tourBox = null;
  var tourEnd = null;

  function tourFirstRun() {
    try {
      if (localStorage.getItem(TOUR_DONE) === "1") return;
      localStorage.setItem(TOUR_KEY, "1");
    } catch (e) { return; }
    tourMaybe();
  }

  function tourMaybe() {
    var pending;
    try { pending = localStorage.getItem(TOUR_KEY) === "1"; } catch (e) { pending = false; }
    if (!pending || tourBox) return;
    var tries = 0;
    (function wait() {
      // Splash still up, apps.json not in yet, or an app on screen.
      if (document.getElementById("oro-splash") || !state.apps.length || state.running) {
        if (state.running || ++tries > 60) return;   // returnToDesktop retries
        setTimeout(wait, 250);
        return;
      }
      startTour();
    })();
  }

  function tourVisible(node) {
    if (!node || node.hidden) return false;
    var r = node.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(node).visibility !== "hidden";
  }

  function tourSteps() {
    var steps = [{ key: "welcome" }, { key: "menu", target: "btn-menu" }];
    if (tourVisible(document.getElementById("sync-dot-btn"))) steps.push({ key: "sync", target: "sync-dot-btn" });
    if (tourVisible(document.getElementById("oros-taskbar-bell"))) steps.push({ key: "bell", target: "oros-taskbar-bell" });
    if (tourVisible(document.getElementById("btn-lang"))) steps.push({ key: "lang", target: "btn-lang" });
    if (helpApp()) {
      // Phones hide "?" on the desktop (the bar is full at 360px).
      steps.push(tourVisible(document.getElementById("help-btn"))
        ? { key: "help", target: "help-btn" }
        : { key: "help", body: "tour.help.bodyMenu" });
    }
    steps.push({ key: "done", last: true });
    return steps;
  }

  function startTour() {
    if (tourBox) return;
    try { localStorage.removeItem(TOUR_KEY); localStorage.setItem(TOUR_DONE, "1"); } catch (e) {}
    if (state.running) returnToDesktop();
    closeMenu();
    var steps = tourSteps();
    var idx = 0;
    var prevFocus = document.activeElement;
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    var box = document.createElement("div");
    box.id = "oros-tour";
    if (reduce) box.className = "no-motion";
    var ring = document.createElement("div");
    ring.className = "tour-ring";
    var card = document.createElement("div");
    card.className = "tour-card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-label", window.t("tour.dialog"));
    card.setAttribute("aria-describedby", "tour-body");
    var count = document.createElement("p");
    count.className = "tour-count";
    var title = document.createElement("h2");
    title.id = "tour-title";
    title.tabIndex = -1;
    var body = document.createElement("p");
    body.id = "tour-body";
    var row = document.createElement("div");
    row.className = "tour-actions";
    function button(cls, fn) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = cls;
      b.addEventListener("click", function (e) { e.stopPropagation(); fn(); });
      row.appendChild(b);
      return b;
    }
    var skipBtn = button("tour-skip", function () { end(); });
    var backBtn = button("tour-back", function () { show(idx - 1); });
    var helpBtn = button("tour-help", function () { end(); openHelp(""); });
    var nextBtn = button("tour-next", function () { if (idx < steps.length - 1) show(idx + 1); else end(); });
    card.appendChild(count);
    card.appendChild(title);
    card.appendChild(body);
    card.appendChild(row);
    box.appendChild(ring);
    box.appendChild(card);
    // Clicks on the dimmed page do nothing (no accidental app opens).
    box.addEventListener("click", function (e) { e.stopPropagation(); });
    document.body.appendChild(box);
    tourBox = box;
    tourEnd = end;

    function place() {
      var st = steps[idx];
      var node = st.target ? document.getElementById(st.target) : null;
      var vw = document.documentElement.clientWidth;
      var vh = window.innerHeight;
      var cw = card.offsetWidth;
      if (node && tourVisible(node)) {
        var r = node.getBoundingClientRect();
        ring.hidden = false;
        ring.style.left = (r.left - 4) + "px";
        var top = Math.max(2, r.top - 4);   // keep the frame on screen under the bar's top edge
        ring.style.top = top + "px";
        ring.style.width = (r.width + 8) + "px";
        ring.style.height = (r.bottom + 4 - top) + "px";
        var left = Math.max(16, Math.min(r.left + r.width / 2 - cw / 2, vw - cw - 16));
        card.style.left = left + "px";
        card.style.top = Math.min(r.bottom + 14, vh - card.offsetHeight - 16) + "px";
        box.classList.remove("plain");
      } else {
        ring.hidden = true;
        box.classList.add("plain");   // no spotlight: dim the whole page
        card.style.left = Math.max(16, (vw - cw) / 2) + "px";
        card.style.top = Math.max(16, (vh - card.offsetHeight) / 2) + "px";
      }
    }

    function show(i) {
      idx = Math.max(0, Math.min(i, steps.length - 1));
      var st = steps[idx];
      count.textContent = window.t("tour.step").replace("{n}", idx + 1).replace("{total}", steps.length);
      title.textContent = window.t("tour." + st.key + ".title");
      body.textContent = window.t(st.body || "tour." + st.key + ".body");
      skipBtn.textContent = window.t("tour.skip");
      backBtn.textContent = window.t("tour.back");
      helpBtn.textContent = window.t("tour.openHelp");
      nextBtn.textContent = window.t(st.last ? "tour.finish" : "tour.next");
      skipBtn.hidden = !!st.last;
      backBtn.hidden = idx === 0;
      helpBtn.hidden = !(st.last && helpApp());
      place();
      nextBtn.focus();
    }

    function onKey(e) {
      if (!tourBox) return;
      if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); end(); return; }
      if (e.key === "ArrowRight" && !e.altKey) { e.preventDefault(); e.stopImmediatePropagation(); if (idx < steps.length - 1) show(idx + 1); return; }
      if (e.key === "ArrowLeft" && !e.altKey) { e.preventDefault(); e.stopImmediatePropagation(); if (idx > 0) show(idx - 1); return; }
      if (e.key === "Tab") {
        // Keep focus inside the card (aria-modal).
        var f = Array.prototype.filter.call(row.querySelectorAll("button"), function (b) { return !b.hidden; });
        if (!f.length) return;
        var at = f.indexOf(document.activeElement);
        e.preventDefault();
        f[(at + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
        return;
      }
      // Everything else (shortcuts, typing into the page) waits.
      e.stopImmediatePropagation();
    }

    function end() {
      if (!tourBox) return;
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", place);
      if (box.parentNode) box.parentNode.removeChild(box);
      tourBox = null;
      tourEnd = null;
      try { if (prevFocus && prevFocus.focus && document.contains(prevFocus)) prevFocus.focus(); } catch (e) {}
    }

    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", place);
    show(0);
  }

  (function () {
    var tBtn = document.getElementById("bar-time");
    var dBtn = document.getElementById("bar-date");
    if (tBtn) tBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      openAppById("time");
    });
    if (dBtn) dBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      openAppById("calendar");
    });
  })();

  // Wave 2.1 — Contacts deep-link bridge. Calendar feed rows
  // (contact birthdays/anniversaries) call this from their iframe.
  // Contacts ALREADY running → live push into the iframe (same
  // pattern as wxPushToApp). Otherwise: stage the id in sessionStorage
  // (device-local, swept by the factory reset, never synced) and
  // open the app — it consumes the pending id at boot.
  window.__orosOpenContact = function (contactId) {
    if (typeof contactId !== "string" || !contactId) return;
    if (state.running && state.running.id === "contacts") {
      var f = document.getElementById("app-frame");
      try {
        if (f && f.contentWindow &&
            typeof f.contentWindow.__orosContactsOpen === "function") {
          f.contentWindow.__orosContactsOpen(contactId);
          return;
        }
      } catch (e) {}
    }
    try { sessionStorage.setItem("oros-contacts-open", contactId); } catch (e) {}
    openAppById("contacts");
  };

  // Consumed by contacts.js at boot — one-shot take.
  window.__orosContactsTakePending = function () {
    try {
      var id = sessionStorage.getItem("oros-contacts-open");
      if (id) sessionStorage.removeItem("oros-contacts-open");
      return id || null;
    } catch (e) { return null; }
  };

  // Wave 4 — Cycle deep-link bridge (πρωτότυπο: Contacts). Calendar
  // read-only feed rows καλούν αυτό από το iframe. App ανοιχτό → live
  // push· κλειστό → stage σε sessionStorage (device-local, swept από
  // το factory reset, δεν ταξιδεύει ποτέ στο sync) + άνοιγμα app.
  window.__orosOpenCycle = function (entryId) {
    if (typeof entryId !== "string" || !entryId) return;
    if (state.running && state.running.id === "cycle") {
      var f = document.getElementById("app-frame");
      try {
        if (f && f.contentWindow &&
            typeof f.contentWindow.__orosCycleOpen === "function") {
          f.contentWindow.__orosCycleOpen(entryId);
          return;
        }
      } catch (e) {}
    }
    try { sessionStorage.setItem("oros-cycle-open", entryId); } catch (e) {}
    openAppById("cycle");
  };

  // Consumed by cycle.js at boot — one-shot take (ίδιο μάθημα
  // με το contacts: αν το take λείπει από το app, το pending id
  // απλά αγνοείται — τίποτα δεν σπάει).
  window.__orosCycleTakePending = function () {
    try {
      var id = sessionStorage.getItem("oros-cycle-open");
      if (id) sessionStorage.removeItem("oros-cycle-open");
      return id || null;
    } catch (e) { return null; }
  };

  // Wave 4 — Mood deep-link bridge (ίδιο ακριβώς σχήμα).
  window.__orosOpenMood = function (entryId) {
    if (typeof entryId !== "string" || !entryId) return;
    if (state.running && state.running.id === "mood") {
      var f = document.getElementById("app-frame");
      try {
        if (f && f.contentWindow &&
            typeof f.contentWindow.__orosMoodOpen === "function") {
          f.contentWindow.__orosMoodOpen(entryId);
          return;
        }
      } catch (e) {}
    }
    try { sessionStorage.setItem("oros-mood-open", entryId); } catch (e) {}
    openAppById("mood");
  };

  window.__orosMoodTakePending = function () {
    try {
      var id = sessionStorage.getItem("oros-mood-open");
      if (id) sessionStorage.removeItem("oros-mood-open");
      return id || null;
    } catch (e) { return null; }
  };

  // Wave 6/#T3 — Time deep-link bridge (πρωτότυπο: Cycle/Mood).
  // Payload = pane name ("alarms") — the app receiver maps it to
  // its own tab. App ανοιχτό → live push στο iframe· κλειστό →
  // stage στο sessionStorage (device-local, swept από το factory
  // reset, δεν ταξιδεύει στο sync ποτέ) + άνοιγμα app.
  window.__orosOpenTime = function (pane) {
    if (typeof pane !== "string" || !pane) return;
    if (state.running && state.running.id === "time") {
      var f = document.getElementById("app-frame");
      try {
        if (f && f.contentWindow &&
            typeof f.contentWindow.__orosTimeOpen === "function") {
          f.contentWindow.__orosTimeOpen(pane);
          return;
        }
      } catch (e) {}
    }
    try { sessionStorage.setItem("oros-time-open", pane); } catch (e) {}
    openAppById("time");
  };

  // Consumed by time.js at boot — one-shot take (ίδιο μάθημα με
  // cycle/mood: αν το receiver λείπει από το app, το pending pane
  // απλά αγνοείται — τίποτα δεν σπάει).
  window.__orosTimeTakePending = function () {
    try {
      var pane = sessionStorage.getItem("oros-time-open");
      if (pane) sessionStorage.removeItem("oros-time-open");
      return pane || null;
    } catch (e) { return null; }
  };
  
  
  // Wave 7/#TD4 — To-Do deep-link bridge (same pattern as
  // Cycle/Mood/Time). Payload = list id. App ανοιχτό → live push
  // στο iframe· κλειστό → staging στο sessionStorage + άνοιγμα app
  // (ο receiver στο EOF του todo.js το καταναλώνει one-shot —
  // ίδιο μάθημα με το time.js, δεν χρειάζεται TakePending εκτος
  // shell).
  window.__orosOpenTodo = function (listId) {
    if (typeof listId !== "string" || !listId) return;
    if (state.running && state.running.id === "todo") {
      var f = document.getElementById("app-frame");
      try {
        if (f && f.contentWindow &&
            typeof f.contentWindow.__orosTodoOpen === "function") {
          f.contentWindow.__orosTodoOpen(listId);
          return;
        }
      } catch (e) {}
    }
    try { sessionStorage.setItem("oros-todo-open", listId); } catch (e) {}
    openAppById("todo");
  };

  // Workouts deep-link bridge (Calendar feed → one workout). Payload =
  // workout id. App open → live push __orosFitnessOpen into the
  // iframe; closed → stage "oros-fitness-open" in sessionStorage (read
  // one-shot by fitness.js at boot) + open the app. Same pattern as
  // To-Do; a stale bundle without the receiver ignores the id.
  window.__orosOpenFitness = function (workoutId) {
    if (typeof workoutId !== "string" || !/^[a-z0-9-]{1,40}$/.test(workoutId)) return;
    if (state.running && state.running.id === "fitness") {
      var f = document.getElementById("app-frame");
      try {
        if (f && f.contentWindow &&
            typeof f.contentWindow.__orosFitnessOpen === "function") {
          f.contentWindow.__orosFitnessOpen(workoutId);
          return;
        }
      } catch (e) {}
    }
    try { sessionStorage.setItem("oros-fitness-open", workoutId); } catch (e) {}
    openAppById("fitness");
  };

  // Habits deep-link bridge (Wave 8/#TH2 — closes Σ2-N1). Payload =
  // period offset in DAYS (number or numeric string; 0 = current
  // period, negative = back). App open → live push __orosHabitsOpen
  // into the iframe; closed → stage "oros-habits-period" in
  // sessionStorage (the EXACT key the habits.js boot receiver
  // reads — device-local, swept by the factory reset, never
  // synced) + open app. Non-numeric input → 0 (current period),
  // never a guess.
  window.__orosOpenHabits = function (periodOffsetDays) {
    var n = parseInt(periodOffsetDays, 10);
    if (isNaN(n)) n = 0;
    if (state.running && state.running.id === "habits") {
      var f = document.getElementById("app-frame");
      try {
        if (f && f.contentWindow &&
            typeof f.contentWindow.__orosHabitsOpen === "function") {
          f.contentWindow.__orosHabitsOpen(n);
          return;
        }
      } catch (e) {}
    }
    try { sessionStorage.setItem("oros-habits-period", String(n)); } catch (e) {}
    openAppById("habits");
  };

  // Wave 13 — Quote deep-link bridge (pattern: Todo/Time).
  // Payload = quote id. App ανοιχτό → live push στο iframe· κλειστό
  // → staging στο sessionStorage + άνοιγμα app (receiver στο EOF
  // του quote.js καταναλώνει one-shot).
  window.__orosOpenQuote = function (quoteId) {
    if (typeof quoteId !== "string" || !quoteId) return;
    if (state.running && state.running.id === "quote") {
      var f = document.getElementById("app-frame");
      try {
        if (f && f.contentWindow &&
            typeof f.contentWindow.__orosQuoteOpen === "function") {
          f.contentWindow.__orosQuoteOpen(quoteId);
          return;
        }
      } catch (e) {}
    }
    try { sessionStorage.setItem("oros-quote-open", quoteId); } catch (e) {}
    openAppById("quote");
  };

  // Minimalism deep-link bridge (Wave 2 — pattern: Quote/Todo).
  // Payload = ymd ("YYYY-MM-DD"). App ανοιχτό → live push στο
  // iframe· κλειστό → staging στο sessionStorage (device-local,
  // swept από το factory reset, δεν ταξιδεύει στο sync ποτέ) +
  // άνοιγμα app. Receiver στο minimalism.js καταναλώνει one-shot.
  // Health deep-link bridge (pattern: Minimalism). Payload = a kind id
  // (reminder → a new reading of that kind). Open app → live push;
  // closed → sessionStorage staging (device-local, one-shot, consumed
  // by health.js at boot) + open.
  window.__orosOpenHealth = function (kind) {
    if (typeof kind !== "string" || !/^[a-z0-9-]{1,40}$/.test(kind)) return;
    if (state.running && state.running.id === "health") {
      var f = document.getElementById("app-frame");
      try {
        if (f && f.contentWindow &&
            typeof f.contentWindow.__orosHealthOpen === "function") {
          f.contentWindow.__orosHealthOpen(kind);
          return;
        }
      } catch (e) {}
    }
    try { sessionStorage.setItem("oros-health-open", kind); } catch (e) {}
    openAppById("health");
  };

  window.__orosOpenMinimalism = function (ymd) {
    if (typeof ymd !== "string" || !ymd) return;
    if (state.running && state.running.id === "minimalism") {
      var f = document.getElementById("app-frame");
      try {
        if (f && f.contentWindow &&
            typeof f.contentWindow.__orosMinimalismOpen === "function") {
          f.contentWindow.__orosMinimalismOpen(ymd);
          return;
        }
      } catch (e) {}
    }
    try { sessionStorage.setItem("oros-minimalism-open", ymd); } catch (e) {}
    openAppById("minimalism");
  };

  // Consumed by minimalism.js at boot — one-shot take (ίδιο μάθημα
  // με todo/quote: αν το receiver λείπει από το app, το pending
  // ymd απλά αγνοείται — τίποτα δεν σπάει).
  // Plant Care deep-link bridge (pattern: Minimalism). Payload =
  // "today" (reminder) or a plant id (Calendar feed row). Open app →
  // live push; closed → sessionStorage staging (device-local, one-
  // shot, consumed by plants.js at boot) + open.
  window.__orosOpenPlants = function (target) {
    if (typeof target !== "string" || !/^[a-z0-9]{1,40}$/.test(target)) return;
    if (state.running && state.running.id === "plants") {
      var f = document.getElementById("app-frame");
      try {
        if (f && f.contentWindow &&
            typeof f.contentWindow.__orosPlantsOpen === "function") {
          f.contentWindow.__orosPlantsOpen(target);
          return;
        }
      } catch (e) {}
    }
    try { sessionStorage.setItem("oros-plants-open", target); } catch (e) {}
    openAppById("plants");
  };

  // Podcasts "add this feed" bridge (Reader, Bookmarks). Payload =
  // an http(s) feed or page address. Open app → live push; closed →
  // one-shot pending address taken by podcasts.js at boot + open.
  var podcastsPendingAdd = null;
  window.__orosOpenPodcastsAdd = function (url) {
    if (typeof url !== "string" || url.length > 2000 || !/^https?:\/\//i.test(url)) return;
    if (state.running && state.running.id === "podcasts") {
      var f = document.getElementById("app-frame");
      try {
        if (f && f.contentWindow &&
            typeof f.contentWindow.__orosPodcastsAdd === "function") {
          f.contentWindow.__orosPodcastsAdd(url);
          return;
        }
      } catch (e) {}
    }
    podcastsPendingAdd = url;
    openAppById("podcasts");
  };
  window.__orosPodcastsTakePending = function () {
    var u = podcastsPendingAdd;
    podcastsPendingAdd = null;
    return u;
  };

  // Garage deep-link bridge (pattern: Plant Care). Payload =
  // "upcoming" (reminder) or a renewal / plan / tyre / vehicle id
  // (Calendar feed row). Open app → live push; closed →
  // sessionStorage staging (device-local, one-shot, consumed by
  // garage.js at boot) + open.
  window.__orosOpenGarage = function (target) {
    if (typeof target !== "string" || !/^[a-z0-9]{1,40}$/.test(target)) return;
    if (state.running && state.running.id === "garage") {
      var f = document.getElementById("app-frame");
      try {
        if (f && f.contentWindow &&
            typeof f.contentWindow.__orosGarageOpen === "function") {
          f.contentWindow.__orosGarageOpen(target);
          return;
        }
      } catch (e) {}
    }
    try { sessionStorage.setItem("oros-garage-open", target); } catch (e) {}
    openAppById("garage");
  };

  // Pet Health Book deep-link bridge (pattern: Minimalism). Payload =
  // "today" (reminder) or a pet id (Calendar feed row). Open app →
  // live push; closed → sessionStorage staging (device-local, one-
  // shot, consumed by petcare.js at boot) + open.
  window.__orosOpenPetcare = function (target) {
    if (typeof target !== "string" || !/^[a-z0-9]{1,40}$/.test(target)) return;
    if (state.running && state.running.id === "petcare") {
      var f = document.getElementById("app-frame");
      try {
        if (f && f.contentWindow &&
            typeof f.contentWindow.__orosPetcareOpen === "function") {
          f.contentWindow.__orosPetcareOpen(target);
          return;
        }
      } catch (e) {}
    }
    try { sessionStorage.setItem("oros-petcare-open", target); } catch (e) {}
    openAppById("petcare");
  };

  window.__orosMinimalismTakePending = function () {
    try {
      var pending = sessionStorage.getItem("oros-minimalism-open");
      if (pending) sessionStorage.removeItem("oros-minimalism-open");
      return pending || null;
    } catch (e) { return null; }
  };

  // Weather unification — deep-link bridge (pattern: Time). The app
  // has no panes to target: weather notifications are informational
  // (fetch failures / daily briefing), a plain open is all the
  // deepLink "weather:open" ever asks for.
  window.__orosOpenWeather = function () {
    if (state.running && state.running.id === "weather") return;
    openAppById("weather");
  };

  // Maps deep-link bridge (pattern: Contacts/Cycle/Mood). Payload:
  // lat/lon numbers + optional label. App ανοιχτό → live push στο
  // iframe· κλειστό → stage στο sessionStorage (device-local, swept
  // από το factory reset, δεν ταξιδεύει στο sync ποτέ) + άνοιγμα
  // app. Wave 6 consumers: Calendar «Πλοήγηση» από event,
  // Bookmarks/Contacts place pins. maps.js προσφέρει __orosMapsOpen
  // (receiver) και καταναλώνει το pending στο boot.
  window.__orosOpenMaps = function (lat, lon, label) {
    if (typeof lat !== "number" || typeof lon !== "number" ||
        isNaN(lat) || isNaN(lon)) return;
    if (state.running && state.running.id === "maps") {
      var f = document.getElementById("app-frame");
      try {
        if (f && f.contentWindow &&
            typeof f.contentWindow.__orosMapsOpen === "function") {
          f.contentWindow.__orosMapsOpen({
            lat: lat, lon: lon, label: (typeof label === "string") ? label : ""
          });
          return;
        }
      } catch (e) {}
    }
    try {
      sessionStorage.setItem("oros-maps-open", JSON.stringify({
        lat: lat, lon: lon, label: (typeof label === "string") ? label : ""
      }));
    } catch (e) {}
    openAppById("maps");
  };

  // Consumed by maps.js at boot — one-shot take (ίδιο μάθημα με
  // contacts/cycle/mood: αν το take λείπει από το app, το pending
  // payload απλά αγνοείται — τίποτα δεν σπάει).
  window.__orosMapsTakePending = function () {
    try {
      var raw = sessionStorage.getItem("oros-maps-open");
      if (raw) sessionStorage.removeItem("oros-maps-open");
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  };

  // Wave 6 — Maps geocode deep-link bridge (pattern: Contacts/
  // Cycle/Mood). Payload: free-text query + optional label. Το
  // shell ΔΕΝ γεωκωδικοποιεί — το Maps (geocodeAndShow, Photon)
  // είναι ο μόνος κάτοχος της λογικής. App ανοιχτό → live push στο
  // iframe· κλειστό → stage στο ΙΔΙΟ "oros-maps-open" key (το
  // maps.js consumePending → openAtLocation χειρίζεται και
  // {lat,lon,label} και {q,label} — PATCH-38) + άνοιγμα app.
  window.__orosOpenMapsQuery = function (query, label) {
    if (typeof query !== "string" || !query.trim()) return;
    var payload = {
      q: query.trim(),
      label: (typeof label === "string") ? label : ""
    };
    if (state.running && state.running.id === "maps") {
      var f = document.getElementById("app-frame");
      try {
        if (f && f.contentWindow &&
            typeof f.contentWindow.__orosMapsOpen === "function") {
          f.contentWindow.__orosMapsOpen(payload);
          return;
        }
      } catch (e) {}
    }
    try {
      sessionStorage.setItem("oros-maps-open", JSON.stringify(payload));
    } catch (e) {}
    openAppById("maps");
  };

  // Kanban deep-link bridge (Calendar feed rows → συγκεκριμένη κάρτα).
  // Πρωτότυπο: Contacts/Cycle/Mood — με μία διαφορά: τρία ids
  // (board, column, card) που ταξιδεύουν ως JSON payload, γιατί το
  // board της κάρτας δεν είναι απαραίτητα το ενεργό board στη
  // συσκευή-προορισμό (το activeBoardId είναι device-local).
  window.__orosOpenKanbanCard = function (boardId, colId, cardId) {
    if (typeof boardId !== "string" || !boardId ||
        typeof colId   !== "string" || !colId ||
        typeof cardId  !== "string" || !cardId) return;
    if (state.running && state.running.id === "kanban") {
      var f = document.getElementById("app-frame");
      try {
        if (f && f.contentWindow &&
            typeof f.contentWindow.__orosKanbanOpen === "function") {
          f.contentWindow.__orosKanbanOpen(
            { board: boardId, col: colId, card: cardId });
          return;
        }
      } catch (e) {}
    }
    try {
      sessionStorage.setItem("oros-kanban-open", JSON.stringify(
        { board: boardId, col: colId, card: cardId }));
    } catch (e) {}
    openAppById("kanban");
  };

  // Consumed by kanban.js at boot — one-shot take (ίδιο μάθημα με
  // το contacts/cycle/mood: αν το app δεν προσφέρει το take, το
  // pending payload απλά αγνοείται — τίποτα δεν σπάει).
  window.__orosKanbanTakePending = function () {
    try {
      var raw = sessionStorage.getItem("oros-kanban-open");
      if (raw) sessionStorage.removeItem("oros-kanban-open");
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  };

  // Wave 8 — Maps → Calendar "Send to Calendar" bridge.
  // Payload shape: { date, title?, location?, start?, note? }
  // date = "YYYY-MM-DD", start = "HH:MM" (24h), note = route info.
  // Live push when Calendar running; otherwise stage to sessionStorage
  // key "oros-cal-new" for boot-time consumption (identical pattern to
  // __orosOpenMapsQuery — no guessing, no assumptions).
  window.__orosOpenCalendarNew = function (p) {
    if (!p || typeof p !== "object" || typeof p.date !== "string") return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date)) return;   // strict date guard
    if (state.running && state.running.id === "calendar") {
      var f = document.getElementById("app-frame");
      try {
        if (f && f.contentWindow &&
            typeof f.contentWindow.__orosCalendarNew === "function") {
          f.contentWindow.__orosCalendarNew(p);
          return;
        }
      } catch (e) {}
    }
    // Calendar closed — stage the payload for boot-time consumption.
    // Same-session overwrite is fine (only one "send to calendar" at a
    // time per device); the receiver reads this key once at boot and
    // clears it (see calendar.js CW-6c / CW-8).
    try {
      sessionStorage.setItem("oros-cal-new", JSON.stringify(p));
    } catch (e) {}
    openAppById("calendar");
  };

  // BR-B1 — "Send to Budget". Any app (Garage, Split, …) calls
  // window.parent.__orosOpenBudgetNew({k, a, d?, n?, c?, src?}) from an
  // explicit button; Budget opens its New entry form prefilled and the
  // user confirms with Save (a prefill, never data). Strict validation
  // here (false = rejected, nothing opens); only a fresh plain copy of
  // the known fields crosses over. Budget running → live push;
  // otherwise stage in sessionStorage "oros-budget-new" (device-local,
  // one-shot, read and removed by budget.js at boot) and open it.
  window.__orosOpenBudgetNew = function (p) {
    if (!p || typeof p !== "object") return false;
    if (p.k !== "o" && p.k !== "i") return false;
    if (typeof p.a !== "number" || Math.floor(p.a) !== p.a ||
        p.a <= 0 || p.a > 100000000000) return false;
    var q = { k: p.k, a: p.a };
    if (p.d !== undefined && p.d !== null && p.d !== "") {
      var dm = typeof p.d === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(p.d) : null;
      if (!dm) return false;
      var dd = new Date(Date.UTC(+dm[1], +dm[2] - 1, +dm[3]));
      if (dd.getUTCFullYear() !== +dm[1] || dd.getUTCMonth() !== +dm[2] - 1 ||
          dd.getUTCDate() !== +dm[3]) return false;
      q.d = p.d;
    }
    if (typeof p.n === "string") q.n = p.n.slice(0, 500);
    if (typeof p.c === "string" && /^[a-z0-9-]{1,64}$/.test(p.c)) q.c = p.c;
    if (typeof p.src === "string" && /^[a-z0-9]{1,20}$/.test(p.src)) q.src = p.src;
    var has = false;
    for (var i = 0; i < state.apps.length; i++) if (state.apps[i].id === "budget") has = true;
    if (!has) return false;
    if (state.running && state.running.id === "budget") {
      var f = document.getElementById("app-frame");
      try {
        if (f && f.contentWindow &&
            typeof f.contentWindow.__orosBudgetNew === "function") {
          f.contentWindow.__orosBudgetNew(q);
          return true;
        }
      } catch (e) {}
    }
    try {
      sessionStorage.setItem("oros-budget-new", JSON.stringify(q));
    } catch (e) {}
    openAppById("budget");
    return true;
  };

  // BR-Q1 — "Create quote" (Timesheet → Quote). An app calls
  // window.parent.__orosOpenQuoteNew({items:[{d, q, p}], cur?, client?,
  // notes?}) from an explicit button; Quote opens a NEW unsaved draft
  // with those lines and the user saves it (a prefill, never data, as
  // BR-W8-6). Strict validation here (false = rejected, nothing opens):
  // 1-50 lines, d text <= 200, q quantity 0 < q <= 100000, p unit price
  // 0 <= p <= 10000000 (2 decimals each); cur EUR|USD; client <= 80 and
  // notes <= 500 chars. Only a fresh plain copy crosses over. Quote
  // running → live push to __orosQuoteNew; otherwise sessionStorage
  // "oros-quote-new" (device-local, one-shot, read and removed by
  // quote.js at boot) and open it.
  window.__orosOpenQuoteNew = function (p) {
    if (!p || typeof p !== "object" || !Array.isArray(p.items)) return false;
    if (!p.items.length || p.items.length > 50) return false;
    var r2 = function (n) { return Math.round(n * 100) / 100; };
    var txt = function (v, max) {
      return typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").slice(0, max) : "";
    };
    var items = [];
    for (var i = 0; i < p.items.length; i++) {
      var it = p.items[i];
      if (!it || typeof it !== "object") return false;
      if (typeof it.q !== "number" || !isFinite(it.q) || it.q <= 0 || it.q > 100000) return false;
      if (typeof it.p !== "number" || !isFinite(it.p) || it.p < 0 || it.p > 10000000) return false;
      items.push({ d: txt(it.d, 200), q: r2(it.q), p: r2(it.p) });
    }
    var q = { items: items };
    if (p.cur === "EUR" || p.cur === "USD") q.cur = p.cur;
    else if (p.cur !== undefined) return false;
    if (typeof p.client === "string") q.client = txt(p.client, 80).trim();
    if (typeof p.notes === "string") q.notes = txt(p.notes, 500);
    var has = false;
    for (var k = 0; k < state.apps.length; k++) if (state.apps[k].id === "quote") has = true;
    if (!has) return false;
    if (state.running && state.running.id === "quote") {
      var f = document.getElementById("app-frame");
      try {
        if (f && f.contentWindow &&
            typeof f.contentWindow.__orosQuoteNew === "function") {
          f.contentWindow.__orosQuoteNew(q);
          return true;
        }
      } catch (e) {}
    }
    try {
      sessionStorage.setItem("oros-quote-new", JSON.stringify(q));
    } catch (e) {}
    openAppById("quote");
    return true;
  };

  // Wave 1B — Calendar deep-link bridge (πρωτότυπο: Cycle/Mood,
  // με μία διαφορά: το payload φτάνει ως deepLink STRING της μορφής
  // "calendar:<evId>:<YYYY-MM-DD>" — το ίδιο σχήμα που μπαίνει στο
  // emit() από ΚΑΙ τα δύο engines (shell + in-app). Flexible
  // signature: δέχεται το full string ή ξεχωριστά (evId, ymd), ώστε
  // να μην εξαρτόμαστε από το πώς το DL_BRIDGES του notifications.js
  // θα το αποσυνθέσει. App ανοιχτό → live push στο iframe· κλειστό
  // → stage στο "oros-cal-pending" (ίδιο key που διαβάζει το
  // calendar.js στο boot του Patch C4 — same-origin sessionStorage)
  // + άνοιγμα app.
  window.__orosOpenCalendar = function (a, b) {
    var evId = null, ymd = null;
    if (typeof a === "string" && a.indexOf("calendar:") === 0) {
      var parts = a.split(":");
      if (parts.length === 3) { evId = parts[1]; ymd = parts[2]; }
    } else if (typeof a === "string" && typeof b === "string") {
      evId = a; ymd = b;
    }
    if (!evId || !ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return;

    if (state.running && state.running.id === "calendar") {
      var f = document.getElementById("app-frame");
      try {
        if (f && f.contentWindow &&
            typeof f.contentWindow.__calDeepLink === "function") {
          f.contentWindow.__calDeepLink({ id: evId, date: ymd });
          return;
        }
      } catch (e) {}
    }
    try {
      sessionStorage.setItem("oros-cal-pending",
        JSON.stringify({ id: evId, date: ymd }));
    } catch (e) {}
    openAppById("calendar");
  };

    // Television deep-link bridge (pattern: Radio/Contacts/Cycle). Payload:
  // channel UUID (string) or stream selection object. App ανοιχτό → live push
  // στο iframe· κλειστό → staging στο sessionStorage (device-local, swept
  // από το factory reset, δεν ταξιδεύει στο sync ποτέ) + άνοιγμα app.
  window.__orosOpenTelevision = function (channelIdOrPayload) {
    if (!channelIdOrPayload) return;
    var payload = channelIdOrPayload;
    
    // Backward compat: string ID gets wrapped
    if (typeof channelIdOrPayload === "string") {
      payload = { channelId: channelIdOrPayload };
    }
    
    if (state.running && state.running.id === "television") {
      var f = document.getElementById("app-frame");
      try {
        if (f && f.contentWindow &&
            typeof f.contentWindow.__orosTelevisionOpen === "function") {
          f.contentWindow.__orosTelevisionOpen(payload);
          return;
        }
      } catch (e) {}
    }
    try { sessionStorage.setItem("oros-television-open", JSON.stringify(payload)); } catch (e) {}
    openAppById("television");
  };

  // Consumed by television.js at boot — one-shot take.
  window.__orosTelevisionTakePending = function () {
    try {
      var raw = sessionStorage.getItem("oros-television-open");
      if (raw) sessionStorage.removeItem("oros-television-open");
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  };

  // v0.18.0 — global shortcuts at the shell level
  document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && e.altKey && e.shiftKey) window.orosShortcuts.handle(e);
  });

  // Boot
  initPrefs();
  // Favourites (launcher.js, a shell component like pet.js): desktop
  // shortcuts and their sync slice. A bundle without it draws nothing.
  if (window.orosLauncher) {
    window.orosLauncher.attach({
      apps: function () { return state.apps; },
      open: openApp,
      running: function () { return state.running; },
      icons: ICONS,
      lang: function () { return state.lang; },
      label: function (app) {
        var k = "app." + app.id, v = window.t(k);
        return (v === k) ? app.name : v;
      },
      desktop: document.getElementById("oros-desktop")
    });
  }
  applySkin();
  applyWallpaper();
  applyTheme();
  applyLang();
  loadApps();
  setupInstallFlow();
  initSyncIntegration();
  setInterval(renderClock, 1000);
  initBarFit();   // taskbar fit levels (needs the bar painted once)
  renderClock();
  // IN-3: defer past shell boot — notifications.js loads AFTER
  // shell.js, so a synchronous call here always saw the module
  // missing and the Wave 6 unified path was dead code. "load" is the
  // safe signal: every classic script (incl. notifications.js) has
  // executed by then. The ready-guard inside checkVersionToast
  // covers the stale-bundle case; the legacy toast is the fallback.
  if (document.readyState === "complete") checkVersionToast();
  else window.addEventListener("load", function () { checkVersionToast(); });

  // D1: Android evicts non-persistent Cache Storage under disk
  // pressure — desktop doesn't. This is why offline "broke by itself"
  // there. Asking for persistence makes the PWA's offline net
  // durable. Silent best-effort; a denial changes nothing.
  if (navigator.storage && typeof navigator.storage.persist === "function") {
    navigator.storage.persist().catch(function () {});
  }

  // Auto-backup boot check — LAST, so exports capture the fully
  // initialized state (apps loaded, sync slices hydrated).
  setTimeout(function () { maybeAutoExport(false); }, 2000);
  
  // SH-B1: no boot timers for the reminder engines. The four that
  // lived here never ran anything: renderClock() above had already
  // armed each engine's throttle. The clock tick now starts the
  // engines the moment notifications.js is ready (enginesMayRun).

    // v0.18.0 — weather: paint at boot, refetch on reconnect/visible
  wxRenderChip();
  wxFetch(false);
  window.addEventListener("online", function () { wxFetch(true); });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") wxFetch(false);
  });

  // D1: self-healing SW — after connectivity returns or the app
  // surfaces, quietly ask for an update check. Catches the Android
  // case of a worker that failed/redundated during install: the
  // next online moment re-attempts activation instead of waiting
  // for the user to hard-refresh. Zero cost when already current.
  function swSelfHeal() {
    if (!("serviceWorker" in navigator)) return;
    if (!navigator.onLine) return;
    navigator.serviceWorker.getRegistration()
      .then(function (r) { return r ? r.update() : null; })
      .catch(function () {});
  }
  window.addEventListener("online", function () { setTimeout(swSelfHeal, 3000); });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") setTimeout(swSelfHeal, 2000);
  });
})();