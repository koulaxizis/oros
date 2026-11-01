// ============================================================
// orOS Core — Shell logic
// Sections:
//   1. State, skin registry, wallpaper registry, icon constants
//   2. Preferences (skin, language, theme, wallpaper, auto-backup)
//   3. Language apply
//   4. Theme apply
//   5. Skin apply · 5b. Wallpaper · 5e. Accessibility ·
//       5c. Auto-backup scheduler ·
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

  var APP_VERSION = "5.03.00";   // bump on every deploy (shows welcome toast)
  var VERSION_KEY = "oros-last-version";

  // ---------- 1. State & registries ----------
  var state = {
    lang:            null,   // "en" | "el" | a pack language (i18n.js)
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
    syncBackups:     null,   // A43: { loading, list: [{ name, at, size }], err } once Settings asked
    vaultClean:      null,   // VD-GC: { busy: "check"|"clean"|"", usage, result, code, err } once Settings asked
    syncRestoring:   null,   // A43: name of the backup being restored
    syncOldPassFor:  null,   // A43: backup that needs its old passphrase
    syncAutoErr:     null,   // SY-L2: why the last background sync failed (cleared by a success)

    // auto-backup mode: "off" | "daily" | "weekly" | "monthly"
    autoexport:      "off"
  };

  // wp = the wallpaper suggested with the skin (SKIN-WP): picking the
  // skin moves to it only while the wallpaper is still the default or
  // the previous skin's suggestion (maybeFollowSkin, 5b).
  var SKINS = [
    { id: "adwaita",    color: "#3584e4", wp: "dusk" },
    { id: "lumo",       color: "#6d4aff", wp: "nebula" },
    { id: "oros",       color: "#d4af37", wp: "sand" },
    { id: "ubuntu",     color: "#e95420", wp: "plum" },
    { id: "fedora",     color: "#51a2da", wp: "nordic" },
    { id: "mint",       color: "#87cf3e", wp: "forest" },
    { id: "arch",       color: "#1793d1", wp: "midnight" },
    { id: "debian",     color: "#d70a53", wp: "ember" },
    { id: "elementary", color: "#8c5ec7", wp: "aurora" },
    { id: "tux",        color: "#c9c9c9", wp: "mono" },
    // v0.12.0 — second Linux family (6 new: 16 total, grid 2×8)
    { id: "manjaro",    color: "#35bf5c", wp: "borealis" },
    { id: "opensuse",   color: "#73ba25", wp: "forest" },
    { id: "nixos",      color: "#5277c3", wp: "hex" },
    { id: "gentoo",     color: "#7d5ba6", wp: "obsidian" },
    { id: "popos",      color: "#ff7043", wp: "ember" },
    { id: "zorin",      color: "#15a6a0", wp: "terrazzo" }
  ];

  var DEFAULT_WALLPAPER = "sand";

  // Wallpapers live in JS (single source of truth): the SAME gradient
  // string feeds the desktop background AND the picker thumbnails —
  // WYSIWYG guaranteed, no CSS-specificity battles.
  var WALLPAPERS = [
    { id: "custom",   css: "" },  // "Mine": drawn from state.wpart (5b)
    { id: "dusk",     css: "linear-gradient(160deg, #1b2735 0%, #10151f 45%, #0b0f17 100%)" },
    { id: "midnight", css: "linear-gradient(165deg, #0d1117 0%, #06080c 60%, #000000 100%)" },
    { id: "plum",     css: "radial-gradient(ellipse at 30% 20%, #4a2545 0%, #2c1626 55%, #190d17 100%)" },
    { id: "forest",   css: "linear-gradient(150deg, #16281c 0%, #0e1a12 55%, #070f09 100%)" },
    { id: "ember",    css: "linear-gradient(160deg, #2b1810 0%, #1d0f0a 50%, #120806 100%)" },
    { id: "nordic",   css: "linear-gradient(170deg, #2c3e50 0%, #1d2a38 55%, #131b24 100%)" },
    { id: "aurora",   css: "linear-gradient(155deg, #10302b 0%, #0b2320 45%, #071512 100%)" },
    { id: "sand",     css: "linear-gradient(160deg, #33291d 0%, #241c13 55%, #161009 100%)" },
    { id: "mono",     css: "linear-gradient(170deg, #262626 0%, #1a1a1a 55%, #0e0e0e 100%)" },
    // v0.12.0 — five composite wallpapers (layered gradients)
    { id: "nebula",   css: "radial-gradient(ellipse at 25% 15%, #3d2b63 0%, #241b3d 40%, #14102a 70%, #0a0817 100%)" },
    { id: "borealis", css: "radial-gradient(ellipse at 70% 0%, rgba(63,175,127,0.30) 0%, rgba(63,175,127,0) 45%), radial-gradient(ellipse at 40% 8%, rgba(94,231,160,0.14) 0%, rgba(94,231,160,0) 35%), linear-gradient(170deg, #0e1a17 0%, #0a1210 55%, #050908 100%)" },
    { id: "hex",      css: "repeating-linear-gradient(0deg, rgba(255,255,255,0.025) 0 1px, transparent 1px 22px), repeating-linear-gradient(60deg, rgba(255,255,255,0.02) 0 1px, transparent 1px 26px), linear-gradient(165deg, #17181d 0%, #101116 60%, #0a0b0f 100%)" },
    { id: "obsidian", css: "linear-gradient(200deg, #1a1025 0%, #0e0a14 55%, #070609 100%)" },
    { id: "terrazzo", css: "radial-gradient(circle at 15% 22%, #d4af37 0 2.5px, transparent 3px), radial-gradient(circle at 62% 30%, #6d4aff 0 2px, transparent 2.5px), radial-gradient(circle at 38% 68%, #e06c75 0 2.5px, transparent 3px), radial-gradient(circle at 78% 76%, #15a6a0 0 2px, transparent 2.5px), radial-gradient(circle at 28% 48%, #87cf3e 0 1.5px, transparent 2px), radial-gradient(circle at 85% 18%, #51a2da 0 1.5px, transparent 2px), radial-gradient(circle at 8% 82%, #ff7043 0 2px, transparent 2.5px), linear-gradient(160deg, #211f1b 0%, #161411 60%, #0e0d0b 100%)" },
    { id: "clear",    css: "" }   // "None": theme background
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
  var BK_ENC_KEY = "oros-backup-enc";              // "1" = backup files are encrypted (BK-E, device-local)

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
    whiteboard: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="3.5" width="19" height="14" rx="1.5"/><path d="M9 21l3-3.5 3 3.5"/><rect x="5.5" y="6.5" width="5" height="5" rx=".5"/><path d="M13 9h5M13 12.5h3.5"/></svg>',
    notes: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>',
    weather: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="7" r="3"/><path d="M7 1v1M7 12v1M1 7h1M12 7h1M3.5 3.5l.7.7M10.8 10.8l.7.7M3.5 10.5l.7-.7M10.8 4.2l.7-.7"/><path d="M12.5 21a4.5 4.5 0 0 1 0-9 5.5 5.5 0 0 1 10.6 1.6 3.5 3.5 0 0 1-.6 6.9z"/></svg>',
    mood: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8.5 14.5c.9 1.2 2.1 1.8 3.5 1.8s2.6-.6 3.5-1.8"/><path d="M9 9.5h.01M15 9.5h.01" stroke-width="2.4"/></svg>',
    diary: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/><path d="M9 8.5h6"/></svg>',
    clock: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg>',
    sky: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z"/><path d="M17 3v3M15.5 4.5h3M20.5 8.5v2M19.5 9.5h2"/></svg>',
    calendar: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    quote: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M10.7 13.2c-1.1 0-2 .9-2 2s.8 2 1.8 2c0 1.6-.8 2.4-.8 2.4"/><path d="M16.2 13.2c-1.1 0-2 .9-2 2s.8 2 1.8 2c0 1.6-.8 2.4-.8 2.4"/></svg>',
    timesheet: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9.5 2.5h5"/></svg>',
    invoices: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 2h14v20l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M9 7h6"/><path d="M9 11h6"/><path d="M13 15h2"/></svg>',
    newsletter: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v16H4z"/><path d="M4 7l8 6 8-6"/><path d="M8 16h4"/></svg>',
    signature: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17c2.5-6 4.5-9 6-9 2 0-1.5 8 .5 8 1.5 0 2.5-4 4-4 1.2 0 .8 3 2.3 3 1 0 2-1 3.2-2"/><path d="M3 21h18"/></svg>',
    certificates: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="9" r="6"/><path d="M8.5 14L7 22l5-3 5 3-1.5-8"/></svg>',
    publish: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H2z"/><path d="M22 4h-7a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h8z"/><path d="M16 4v6l2-1.5 2 1.5V4"/></svg>',
    wiki: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M7 9l1.6 6L10.5 10 12 15l1.5-5 1.9 5L17 9"/></svg>',
    crm: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><circle cx="12" cy="13" r="2"/><path d="M8.5 18a3.5 3.5 0 0 1 7 0"/></svg>',
    prompter: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z"/><line x1="16" y1="8" x2="2" y2="22"/><line x1="17.5" y1="15" x2="9" y2="15"/><line x1="21" y1="2" x2="21" y2="6"/><line x1="19" y1="4" x2="23" y2="4"/></svg>',
    typewriter: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="9" rx="2"/><path d="M7 11V6h10v5"/><path d="M7 15h.01M10 15h.01M13 15h.01M16 15h.01M9 18h6"/></svg>',
    labels: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><path d="M7.5 7.5h.01"/></svg>',
    characters: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    water: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.8C9 7 6 10.4 6 14.2a6 6 0 0 0 12 0C18 10.4 15 7 12 2.8z"/></svg>',
    names: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7.5V5a1 1 0 0 1 1-1h7.5L21 13.5 13.5 21 4 11.5V7.5z"/><circle cx="8" cy="8" r="1.5"/><path d="M11 13l2 2M13 11l2 2"/></svg>',
    fitness: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 7v10M3 9v6M18 7v10M21 9v6M6 12h12"/></svg>',
    pixel: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><rect x="7" y="8" width="3" height="3" fill="currentColor" stroke="none"/><rect x="14" y="8" width="3" height="3" fill="currentColor" stroke="none"/><path d="M8 15h8"/></svg>',
    shelf: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V5h3v16"/><path d="M10 21V8h3v13"/><path d="M15.5 8.5l2.9-.8 3 12.6-2.9.7z"/></svg>',
    library: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h6a4 4 0 014 4v13a3 3 0 00-3-3H2z"/><path d="M22 4h-6a4 4 0 00-4 4v13a3 3 0 013-3h7z"/></svg>',
    storage: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5"/><path d="M12 13v8"/></svg>',
    meals: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11h18v2a7 7 0 0 1-7 7h-4a7 7 0 0 1-7-7z"/><path d="M1.5 11h21"/><path d="M8 7c0-1.2 1-1.4 1-2.6M12 7c0-1.2 1-1.4 1-2.6M16 7c0-1.2 1-1.4 1-2.6"/></svg>',
    habits: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><line x1="8" y1="2" x2="8" y2="5"/><line x1="16" y1="2" x2="16" y2="5"/><polyline points="8.5 13 11 15.5 15.5 10.5"/></svg>',
    health: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21.2l8.8-8.8a5.5 5.5 0 0 0 0-7.8z"/><path d="M3.5 12h4l2-3 3 6 2-3h6"/></svg>',
    zen: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="6.5" stroke-dasharray="2 2.6"/><circle cx="12" cy="12" r="10"/></svg>',
    budget: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-2"/><path d="M16 8h5v8h-5a4 4 0 0 1 0-8z"/><circle cx="16.5" cy="12" r="0.6" fill="currentColor"/></svg>',
    qr: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v1M14 20h1M18 18h3v3M17 21h0"/></svg>',
    converter: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M8 13h8l-2.5-2.5"/><path d="M16 17H8l2.5 2.5"/></svg>',
    flashcards: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="3" width="14" height="14" rx="2"/><path d="M17 17v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h2"/><path d="M12 8h4M12 12h4"/></svg>',
    typing: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="13" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M18 14h.01M9 16h6"/><path d="M9.5 13.2h1.5M13 13.2h1.5"/></svg>',
    scanpdf: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
    files: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 3v18"/></svg>',
    pubdomain: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M14.8 9.2a4 4 0 1 0 0 5.6"/><line x1="5" y1="5" x2="19" y2="19"/></svg>',
    cycle: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>',
    plants: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 14h12l-1.6 7H7.6z"/><path d="M12 14V9"/><path d="M12 9c0-3 2-5.5 6-5.5 0 3.5-2 5.5-6 5.5z"/><path d="M12 11c0-2.5-1.8-4-5-4 0 3 1.8 4 5 4z"/></svg>',
    familytree: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="5" rx="1"/><rect x="2" y="17" width="6" height="5" rx="1"/><rect x="16" y="17" width="6" height="5" rx="1"/><path d="M12 7v5M5 17v-5h14v5"/></svg>',
    together: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 19.5s-6-3.7-7.6-7.4C.2 9.3 1.9 6.5 4.7 6.5c1.8 0 2.9 1 4.3 2.6 1.4-1.6 2.5-2.6 4.3-2.6"/><path d="M15 20.5s-6-3.7-7.6-7.4C6.2 10.3 7.9 7.5 10.7 7.5c1.8 0 2.9 1 4.3 2.6 1.4-1.6 2.5-2.6 4.3-2.6 2.8 0 4.5 2.8 3.3 5.6-1.6 3.7-7.6 7.4-7.6 7.4z"/></svg>',
    contacts: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 12c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm0 2c-3.33 0-10 1.67-10 5v2h20v-2c0-3.33-6.67-5-10-5z"/></svg>',
    bookmarks: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v14l-10-6-10 6V6a2 2 0 0 1 2-2z"/><path d="M8 4v16M16 4v16"/></svg>',
    maps: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    feeds: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/></svg>',
    museum: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M4 18h16M12 3l9 5H3z"/><path d="M6 10v8M10 10v8M14 10v8M18 10v8"/></svg>',
    spreadsheet: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>',
    writer: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    layout: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 9v12"/><path d="M12.5 13h5M12.5 17h5"/></svg>',
    wallpaper: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="3.5" width="19" height="17" rx="2.5"/><path d="M2.5 15c3-3 5.5-3 8.5 0s5.5 3 10.5-1"/><path d="M2.5 10.5c3-2.5 5.5-2.5 8.5 0s5.5 2.5 10.5-1"/></svg>',
    trees: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22v-8"/><path d="M12 14l-3.5-3.5M12 16l4-4"/><path d="M12 14c-5 0-8-3-8-6.5a4.5 4.5 0 0 1 4.5-4.5c1.4 0 2.6.6 3.5 1.6A4.5 4.5 0 0 1 20 7.5C20 11 17 14 12 14z"/></svg>',
    aura: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 18c3-1 4-5 7-7s6-1 9-5"/><path d="M4 13c2 0 3-2 5-3" opacity=".55"/><circle cx="18" cy="17" r="1.2"/><circle cx="14" cy="20" r=".8"/><circle cx="20.5" cy="12.5" r=".8"/></svg>',
    photolab: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="14" height="14" rx="2"/><path d="M3 15l4-4 4 4 2-2 4 4"/><path d="M14 3l7 7"/><path d="M19 3l2 2-6 6-3 1 1-3z"/></svg>',
    capture: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8V5a2 2 0 0 1 2-2h3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M21 16v3a2 2 0 0 1-2 2h-3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><circle cx="12" cy="12" r="3.5"/></svg>',
    atelier: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21a9 9 0 0 1 0-18c4.97 0 9 3.58 9 8 0 2.5-2 4-4.5 4H14a1.5 1.5 0 0 0-1 2.6A1.5 1.5 0 0 1 12 21z"/><circle cx="7.5" cy="10.5" r="1"/><circle cx="11.5" cy="7.5" r="1"/><circle cx="16.5" cy="9.5" r="1"/></svg>',
    mockups: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3l11-1v17L6 21z"/><path d="M6 3L3 5v17l3-1"/><path d="M17 2l2 2v17l-2-2"/><path d="M9 8h5M9 11h4"/></svg>',
    netizen: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5" width="19" height="14" rx="2.5"/><rect x="5.5" y="8.5" width="5" height="6" rx="1"/><path d="M13.5 9.5h5M13.5 13h3.5M5.5 16.5h13"/></svg>',
    stock: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M4 21V9l8-5 8 5v12"/><rect x="8" y="13" width="4" height="4"/><rect x="12" y="13" width="4" height="4"/><rect x="10" y="9" width="4" height="4"/></svg>',
    garage: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 17H3.5a1 1 0 0 1-1-1v-3.2a2 2 0 0 1 .6-1.4L5 9.5l1.6-3.6A2 2 0 0 1 8.4 4.7h7.2a2 2 0 0 1 1.8 1.2L19 9.5l1.9 1.9a2 2 0 0 1 .6 1.4V16a1 1 0 0 1-1 1H19"/><path d="M5 9.5h14"/><circle cx="7.5" cy="17" r="2"/><circle cx="16.5" cy="17" r="2"/><path d="M9.5 17h5"/></svg>',
    dice: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.4" fill="currentColor" stroke="none"/><circle cx="15.5" cy="8.5" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="8.5" cy="15.5" r="1.4" fill="currentColor" stroke="none"/><circle cx="15.5" cy="15.5" r="1.4" fill="currentColor" stroke="none"/></svg>',
    petcare: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="4.5" cy="9.5" r="1.8"/><circle cx="8.5" cy="5" r="1.8"/><circle cx="13.5" cy="5" r="1.8"/><path d="M11 10.5c-2.8 0-5 3.3-5 5.6 0 1.6 1.2 2.4 2.7 2.4.9 0 1.5-.5 2.3-.5"/><path d="M18 12v8M14 16h8"/></svg>',
    wheel: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8.5"/><path d="M12 4.5v17M3.5 13h17M6 7l12 12M18 7L6 19"/><path d="M10 1.5h4L12 4.5z" fill="currentColor"/></svg>',
    oracle: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path d="M12 2v1.5M5 4.5l1 1M19 4.5l-1 1"/></svg>',
    slides: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="12" rx="1"/><path d="M8 11v-2M12 11V7M16 11v-3M12 15v3M8 21l4-3 4 3"/></svg>',
    baby: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2h4M9.5 5h5M10 5v2.5L8 10v10a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V10l-2-2.5V5"/><path d="M8 14h3M8 17h3"/></svg>',
    household: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><circle cx="9.5" cy="14" r="1.6"/><circle cx="14.5" cy="14" r="1.6"/><path d="M7.5 20c0-2 1-3 2-3s2 1 2.5 1.5c.5-.5 1.5-1.5 2.5-1.5s2 1 2 3"/></svg>',
    chores: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4.5"/><path d="M12 2v5.5M12 16.5V22M2 12h5.5M16.5 12H22"/></svg>',
    travel: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="7" width="17" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M8 7v13M16 7v13"/></svg>',
    passwords: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="10.5" width="18" height="11" rx="2"/><path d="M7.5 10.5V7a4.5 4.5 0 0 1 9 0v3.5"/><circle cx="8" cy="16" r="1" fill="currentColor"/><circle cx="12" cy="16" r="1" fill="currentColor"/><circle cx="16" cy="16" r="1" fill="currentColor"/></svg>',
    device: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M12 10.5v5"/><circle cx="12" cy="7.5" r="0.6" fill="currentColor"/><path d="M10.5 18.5h3"/></svg>',
    assistant: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12z"/><path d="M13 7.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z"/></svg>',
    today: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/><path d="M8.5 15l2.3 2.3 4.7-4.6"/></svg>',
    lock: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/></svg>',
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
    gamecenter: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>',
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
    texttools: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6V4h11v2"/><path d="M8.5 4v14"/><path d="M6 18h5"/><path d="M15 11h6"/><path d="M15 15h6"/><path d="M15 19h4"/></svg>',
    units: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="13" width="20" height="8" rx="1.5"/><path d="M6 13v3M10 13v4M14 13v3M18 13v4"/><path d="M4 6h16"/><path d="M7 3L4 6l3 3"/><path d="M17 3l3 3-3 3"/></svg>',
    stickies: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10l6-6V5a2 2 0 0 0-2-2z"/><path d="M15 21v-4a2 2 0 0 1 2-2h4"/><path d="M7 8h8"/><path d="M7 12h5"/></svg>',
    pad: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M10 13l-2 2 2 2M14 13l2 2-2 2"/></svg>',
    textcase: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18L7.5 6 12 18"/><path d="M4.7 14h5.6"/><circle cx="17.5" cy="15" r="3"/><path d="M20.5 12v6"/></svg>',
    minimalism: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/></svg>',
    split: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="7" r="4"/><circle cx="17" cy="17" r="4"/><path d="M14 4h4a2 2 0 0 1 2 2v3"/><path d="M18 7l2 2 2-2"/><path d="M10 20H6a2 2 0 0 1-2-2v-3"/><path d="M6 17l-2-2-2 2"/></svg>',
    radio: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="11" r="2"/><path d="M7.5 13.5a6.5 6.5 0 0 1 0-5"/><path d="M16.5 8.5a6.5 6.5 0 0 1 0 5"/><path d="M5 16a10 10 0 0 1 0-10"/><path d="M19 6a10 10 0 0 1 0 10"/><line x1="12" y1="13" x2="12" y2="21"/></svg>',
    podcasts: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="11" r="2"/><path d="M12 13v8"/><path d="M8.5 15.5a5 5 0 1 1 7 0"/><path d="M5.6 18.4a9 9 0 1 1 12.8 0"/></svg>',
    music: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
    mixer: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="3" x2="6" y2="21"/><line x1="12" y1="3" x2="12" y2="21"/><line x1="18" y1="3" x2="18" y2="21"/><rect x="4" y="13" width="4" height="3" rx="1"/><rect x="10" y="6" width="4" height="3" rx="1"/><rect x="16" y="10" width="4" height="3" rx="1"/></svg>',
    ringtones: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 15V8l4-1v6"/><circle cx="10" cy="15" r="1.5"/><circle cx="14" cy="13" r="1.5"/></svg>',
    studio: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21V14"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M1 14h6"/><path d="M9 8h6"/><path d="M17 16h6"/></svg>',
    lyricsync: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h11"/><path d="M3 10h11"/><path d="M3 15h6"/><path d="M17 18V4l4 2"/><circle cx="14.5" cy="18" r="2.5"/></svg>',
    television: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="13" rx="2"/><polyline points="17 2 12 7 7 2"/></svg>',
    montage: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M7 4v16M17 4v16M2 9h5M2 15h5M17 9h5M17 15h5"/><path d="M10.5 9.5l4 2.5-4 2.5z"/></svg>',
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

  // A language orOS knows: English, Greek, or a pack language listed
  // in i18n.js. langBase(): "el" or "en", for the modules that still
  // pick between two inline strings (a pack language reads English).
  function langKnown(v) {
    return v === "en" || v === "el" || !!(window.orosI18n && window.orosI18n.known(v));
  }
  function langBase() { return state.lang === "el" ? "el" : "en"; }
  // Dates and numbers in the shell's language (i18n.js locale).
  function shLoc() { return window.orosI18n ? window.orosI18n.locale(state.lang) : (state.lang === "el" ? "el-GR" : "en-GB"); }
  // A shell string with its {placeholders} filled: tr("rem.med", { name: n, time: hm }).
  function tr(key, vars) {
    var s = window.t(key);
    if (vars) Object.keys(vars).forEach(function (k) { s = s.split("{" + k + "}").join(String(vars[k])); });
    return s;
  }
  // key + ".one" for 1, else key + ".other" (the shell's two forms).
  function trn(key, n, vars) {
    var v = { n: n };
    if (vars) Object.keys(vars).forEach(function (k) { v[k] = vars[k]; });
    return tr(key + (n === 1 ? ".one" : ".other"), v);
  }

  // ---------- 2. Preferences ----------
  function initPrefs() {
    var params = new URLSearchParams(window.location.search);

    var urlLang    = params.get("lang");
    var storedLang = localStorage.getItem("oros-lang");
    state.lang     = langKnown(urlLang) ? urlLang
                   : langKnown(storedLang) ? storedLang
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
    if (window.orosI18n) document.documentElement.setAttribute("dir", window.orosI18n.dir(state.lang));

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
    langBtn.textContent = langNext().toUpperCase();
    langBtn.setAttribute("title", window.t("lang.tooltip"));

    // E1/E2 — localized titles for the split clock buttons. Painted
    // here (not data-i18n) so stale HTML bundles can't linger with
    // dead attributes.
    var tBtn = document.getElementById("bar-time");
    var dBtn = document.getElementById("bar-date");
    if (tBtn) tBtn.title = window.t("app.time");   // paintBarDate adds the date at fit level 6
    if (dBtn) dBtn.title = window.t("app.calendar");
    if (window.orosOsk) window.orosOsk.refresh();   // on-screen keyboard labels
    if (window.orosQS) window.orosQS.refresh();     // Quick settings labels
    if (window.orosWidgets) window.orosWidgets.refresh();   // desktop widgets
    // The sync button and the app frame are labelled once at injection /
    // open time; a language toggle (or a boot before the language is
    // known) must relabel them too, or screen readers hear English.
    var sBtn = document.getElementById("sync-dot-btn");
    if (sBtn) sBtn.setAttribute("aria-label", window.t("sync.dot.aria"));
    frameTitle();

    renderClock();
    renderMenu();
  }

  // Accessible name of the app frame: the running app's name in the
  // active language (the HTML ships an English placeholder).
  function frameTitle() {
    var f = document.getElementById("app-frame");
    if (!f) return;
    var app = state.running, k = app ? "app." + app.id : "", n = app ? window.t(k) : "";
    f.setAttribute("title", app ? (n !== k ? n : app.name) : window.t("frame.title"));
    if (SOLO) soloPaint();
  }

  // Language toggle reaches OPEN apps: iframes read orosLang once at
  // boot, so the honest way to localize an already-running app is a
  // clean re-open. Data lives in storage/slices — zero loss risk.
  function refreshRunningApp() {
    mtDropAll();                  // hidden apps would stay in the old language
    if (state.running) {
      frameGo(document.getElementById("app-frame"), state.running.url);
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
    if (w.id === "custom" || wpPic()) wpCustomApply(desktop);
    else { wpCustomStop(); desktop.style.background = w.css; }

    // Keep the class for potential future hooks, cleaned of stale ids
    var classes = desktop.className.split(/\s+/);
    for (var i = 0; i < classes.length; i++) {
      if (classes[i].indexOf("wp-") === 0) desktop.classList.remove(classes[i]);
    }
    desktop.classList.add("wp-" + state.wallpaper);
    wpLiveSync();
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

  // A finished picture (Aura Painter, setImage): THIS device only,
  // never synced, and it never changes state.wallpaper (the synced
  // choice), so other devices keep theirs. The picture sits in the
  // same IndexedDB under "picture"; WP_PIC_KEY ({ at, bg }) says it
  // is on, and then it is the desktop here, shown as "Mine" in
  // Settings. Picking another wallpaper here, or making a recipe in
  // the Generator (setCustom), takes it away.
  var WP_PIC_KEY = "oros-wallpaper-pic";
  var WP_PIC_MAX = 20 * 1024 * 1024;

  function wpPic() {
    try {
      var p = JSON.parse(localStorage.getItem(WP_PIC_KEY));
      return (p && typeof p.at === "number" && /^#[0-9a-f]{6}$/i.test(p.bg)) ? p : null;
    } catch (e) { return null; }
  }
  function wpPicClear() {
    try { localStorage.removeItem(WP_PIC_KEY); } catch (e) {}
    wpCacheDel("picture");
  }

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
  function wpCacheGet(slot) {
    return wpDb().then(function (db) {
      return new Promise(function (resolve) {
        var req = db.transaction("img").objectStore("img").get(slot || "desktop");
        req.onsuccess = function () { db.close(); resolve(req.result || null); };
        req.onerror   = function () { db.close(); resolve(null); };
      });
    }).catch(function () { return null; });
  }
  function wpCachePut(rec, slot) {
    return wpDb().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction("img", "readwrite");
        tx.objectStore("img").put(rec, slot || "desktop");
        tx.oncomplete = function () { db.close(); resolve(true); };
        tx.onerror = tx.onabort = function () { db.close(); resolve(false); };
      });
    }).catch(function () { return false; });
  }
  function wpCacheDel(slot) {
    return wpDb().then(function (db) {
      var tx = db.transaction("img", "readwrite");
      tx.objectStore("img").delete(slot);
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

  // The device picture: shown as it is (cover scaling), never redrawn.
  function wpPicApply(desktop, pic) {
    var key = "pic:" + pic.at;
    if (wpShown && wpShown.key === key) {
      desktop.style.background = wpBg(pic.bg, wpShown.url);
      return;
    }
    var gen = ++wpGen;
    desktop.style.background = pic.bg;
    wpCacheGet("picture").then(function (rec) {
      if (gen !== wpGen) return;
      if (rec && rec.key === key && rec.blob) { wpShow(desktop, rec, pic.bg); return; }
      try { localStorage.removeItem(WP_PIC_KEY); } catch (e) {}   // picture gone: back to the choice
      applyWallpaper();
    });
  }

  // What "Mine" shows now: the recipe's picture, or with "A new
  // picture every day" today's picture of it (art.js forDay: the date
  // joins the seed, so every device shows the same one). wpDay = the
  // day drawn, for the daily check.
  var wpDay = "";
  function wpYmd(d) {
    function p2(n) { return (n < 10 ? "0" : "") + n; }
    return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate());
  }
  function wpRecipeNow() {
    var A = wpArt(), r = state.wpart;
    if (!A || !r) return null;
    if (typeof A.forDay !== "function") return r;          // stale art.js
    if (!r.daily) return A.picture(r);
    wpDay = wpYmd(new Date());
    return A.forDay(r, wpDay);
  }
  // Clock engine (1/s, checks once a minute): a new day redraws.
  var wpDailyLast = 0;
  function wpDailyTick() {
    var now = Date.now();
    if (now - wpDailyLast < 60000) return;
    wpDailyLast = now;
    if (state.wallpaper !== "custom" || wpPic() || !state.wpart || !state.wpart.daily) return;
    if (wpYmd(new Date()) !== wpDay) applyWallpaper();
  }

  // "Live wallpaper": soft lights moving over "Mine" (art.js live) on a
  // canvas behind the desktop's content. Paused while an app is open
  // or the tab is hidden; never with reduced motion.
  var wpLive = null, wpLiveKey = "";
  function wpLiveSync() {
    var A = wpArt(), desk = document.getElementById("oros-desktop");
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var on = !!(A && typeof A.live === "function" && desk && state.wallpaper === "custom" &&
                !wpPic() && state.wpart && state.wpart.live && !reduce);
    var r = on ? wpRecipeNow() : null;
    var key = on ? A.key(r, wpAccent()) : "";
    if (key === wpLiveKey && on === !!wpLive) return;
    if (wpLive) { wpLive.stop(); wpLive = null; }
    wpLiveKey = key;
    var cv = document.getElementById("wp-live");
    if (!on) { if (cv) cv.parentNode.removeChild(cv); return; }
    if (!cv) {
      cv = document.createElement("canvas");
      cv.id = "wp-live";
      cv.setAttribute("aria-hidden", "true");
      desk.insertBefore(cv, desk.firstChild);
    }
    wpLive = A.live(cv, r, {
      accent: wpAccent(),
      paused: function () { return !!state.running || document.hidden; }
    });
  }

  try {                                    // motion setting changed: follow it
    var wpMq = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)");
    if (wpMq && wpMq.addEventListener) wpMq.addEventListener("change", wpLiveSync);
  } catch (e) {}

  function wpCustomApply(desktop) {
    var pic = wpPic();
    if (pic) { wpPicApply(desktop, pic); return; }
    var A = wpArt(), r = wpRecipeNow();
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
    // A recipe without daily / live keeps the ones already set.
    setCustom: function (recipe) {
      var A = wpArt();
      var src = recipe;
      if (recipe && typeof recipe === "object" && state.wpart) {
        src = JSON.parse(JSON.stringify(recipe));
        if (!("daily" in src) && state.wpart.daily) src.daily = 1;
        if (!("live" in src) && state.wpart.live) src.live = 1;
      }
      var r = A ? A.normRecipe(src) : null;
      if (!r) return false;
      if (wpPic()) wpPicClear();  // a recipe made here replaces the device picture
      state.wpart = r;
      wpArtWrite(r);
      state.wallpaper = "custom";
      localStorage.setItem("oros-wallpaper", state.wallpaper);
      applyWallpaper();
      noteLocalChange();          // user action → sync engine
      return true;
    },
    // { daily, live } for the "Mine" recipe (Wallpaper Generator).
    // User action: syncs with the recipe. false when there is none.
    setOptions: function (opts) {
      var A = wpArt();
      if (!A || !state.wpart || !opts || typeof opts !== "object") return false;
      var src = JSON.parse(JSON.stringify(state.wpart));
      if (typeof opts.daily === "boolean") { if (opts.daily) src.daily = 1; else delete src.daily; }
      if (typeof opts.live === "boolean") { if (opts.live) src.live = 1; else delete src.live; }
      var r = A.normRecipe(src);
      if (!r) return false;
      state.wpart = r;
      wpArtWrite(r);
      applyWallpaper();
      noteLocalChange();
      return true;
    },
    // A finished picture (Blob, image/*) → the wallpaper of THIS
    // device ("Mine" in Settings). opts.bg = colour around the
    // picture. Resolves true once it is stored and shown. Nothing
    // syncs: not the picture, not the choice.
    setImage: function (blob, opts) {
      var bg = opts && typeof opts.bg === "string" ? opts.bg.toLowerCase() : "#000000";
      // duck-typed: a Blob made in the app's frame is another realm's Blob
      if (!blob || typeof blob.size !== "number" || typeof blob.slice !== "function" ||
          typeof blob.type !== "string" || !/^image\//.test(blob.type) ||
          !blob.size || blob.size > WP_PIC_MAX || !/^#[0-9a-f]{6}$/.test(bg)) return Promise.resolve(false);
      var at = Date.now();
      return wpCachePut({ key: "pic:" + at, w: 0, h: 0, blob: blob }, "picture").then(function (ok) {
        if (!ok) return false;
        try { localStorage.setItem(WP_PIC_KEY, JSON.stringify({ at: at, bg: bg })); }
        catch (e) { return false; }
        applyWallpaper();
        return true;
      });
    },
    // recipe = the picture part (no daily / live); daily, live = the options
    get: function () {
      var pic = wpPic(), A = wpArt(), r = state.wpart;
      return { active: !!pic || state.wallpaper === "custom",
               recipe: r && A && A.picture ? A.picture(r) : r,
               picture: pic ? pic.at : null,
               daily: !!(r && r.daily), live: !!(r && r.live) };
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

  // Suggest, don't impose (SKIN-WP): every skin names one wallpaper
  // (SKINS[].wp). Picking a skin moves to its wallpaper only while the
  // wallpaper is still the default or the previous skin's suggestion,
  // i.e. one the user never picked away from. Any other wallpaper,
  // "Mine", "None" and a device picture stay as they are.
  function skinWallpaper(skinId) {
    for (var i = 0; i < SKINS.length; i++) {
      if (SKINS[i].id === skinId) return findWallpaper(SKINS[i].wp) ? SKINS[i].wp : null;
    }
    return null;
  }

  function maybeFollowSkin(oldSkinId, newSkinId) {
    if (wpPic()) return false;
    var cur = state.wallpaper;
    if (cur !== DEFAULT_WALLPAPER && cur !== skinWallpaper(oldSkinId)) return false;
    var next = skinWallpaper(newSkinId);
    if (!next || next === cur) return false;
    state.wallpaper = next;
    localStorage.setItem("oros-wallpaper", state.wallpaper);
    applyWallpaper();
    return true;
  }

  // ---------- 5e. Accessibility (Settings › Accessibility) ----------
  // Device-local (localStorage "oros-a11y", never synced): the right
  // text size depends on the screen, and "automatic" contrast follows
  // each device's own system setting. Three options:
  //   size     100 | 115 | 130 | 150 (%): CSS zoom on every app frame
  //            and on the menu's content. A zoomed frame lays its app
  //            out like browser zoom (a narrower viewport, the same
  //            pointer maths), so no app has to know. Capped so an app
  //            keeps at least 320 CSS px across (WCAG 1.4.10 reflow).
  //            The top bar and the desktop keep their size (the Dock
  //            has its own Size).
  //   contrast "auto" | "on" | "off": the high-contrast palette on the
  //            shell root (style.css, data-oros-contrast). Apps copy it
  //            with inheritPalette, which watchPalette re-runs when
  //            data-skin is set again. "auto" = on while the system asks
  //            for more contrast or forces its colours (Windows
  //            high contrast).
  //   focus    true: a strong ring on every keyboard focus, also where
  //            an app hides its own.
  // A11Y_CSS goes into the shell and into every same-origin app
  // document (on load and on every change) and only acts through the
  // data-oros-* attributes of that document's root, so nothing looks
  // different until an option is on (forced colours excepted).
  var A11Y_KEY = "oros-a11y";
  var A11Y_SIZES = [100, 115, 130, 150];
  var A11Y_MIN_W = 320;
  var A11Y_CSS =
    "html[data-oros-focus] :focus-visible, html[data-oros-contrast] :focus-visible {" +
    " outline: 3px solid var(--accent, Highlight) !important; outline-offset: 2px !important; }\n" +
    "html[data-oros-contrast] a[href] { text-decoration: underline !important; }\n" +
    "html[data-oros-contrast] ::placeholder { color: var(--text-dim, GrayText) !important; opacity: 1 !important; }\n" +
    "@media (forced-colors: active) {\n" +
    " :focus-visible { outline: 3px solid Highlight !important; outline-offset: 2px !important; }\n" +
    " [aria-checked=\"true\"], [aria-pressed=\"true\"], [aria-selected=\"true\"]," +
    " [aria-current]:not([aria-current=\"false\"]) { outline: 2px solid Highlight; outline-offset: -2px; }\n" +
    "}\n";
  var a11y = a11yLoad();
  var a11yWasHigh = null;

  function a11yLoad() {
    var v = null;
    try { v = JSON.parse(localStorage.getItem(A11Y_KEY) || "null"); } catch (e) {}
    v = (v && typeof v === "object") ? v : {};
    return {
      size: A11Y_SIZES.indexOf(v.size) !== -1 ? v.size : 100,
      contrast: (v.contrast === "on" || v.contrast === "off") ? v.contrast : "auto",
      focus: v.focus === true
    };
  }
  function a11yMq(q) {
    try { return !!(window.matchMedia && window.matchMedia(q).matches); } catch (e) { return false; }
  }
  function a11yHigh() {
    if (a11y.contrast === "on") return true;
    if (a11y.contrast === "off") return false;
    return a11yMq("(prefers-contrast: more)") || a11yMq("(forced-colors: active)");
  }
  // The zoom in use: the chosen size, but never so large that an app
  // is left with less than 320 CSS px across.
  function a11yZoom() {
    var z = a11y.size / 100, w = window.innerWidth || 0;
    if (w > 0) z = Math.min(z, Math.max(1, w / A11Y_MIN_W));
    return Math.round(z * 1000) / 1000;
  }
  function a11yAttr(el, name, value) {
    if (value) el.setAttribute(name, value);
    else el.removeAttribute(name);
  }
  function a11yMark(doc) {
    var r = doc.documentElement;
    if (!doc.getElementById("oros-a11y-css")) {
      var s = doc.createElement("style");
      s.id = "oros-a11y-css";
      s.textContent = A11Y_CSS;
      (doc.head || r).appendChild(s);
    }
    a11yAttr(r, "data-oros-contrast", a11yHigh() ? "high" : null);
    a11yAttr(r, "data-oros-focus", a11y.focus ? "on" : null);
  }
  // One app frame. Chromium and WebKit scale a zoomed frame's page
  // themselves; an engine that only grows the box (its page keeps the
  // box's full width) gets the zoom on the page's own root instead.
  function a11yFrame(f) {
    var w, d;
    try { w = f.contentWindow; d = f.contentDocument; } catch (e) { return; }   // not same-origin
    if (!w || !d || !d.documentElement) return;
    a11yMark(d);
    var r = d.documentElement, z = a11yZoom();
    if (r.hasAttribute("data-oros-zoom")) { r.style.removeProperty("zoom"); r.removeAttribute("data-oros-zoom"); }
    if (z === 1) return;
    var bw = f.getBoundingClientRect().width, iw = w.innerWidth;
    if (bw > 0 && iw > 0 && Math.abs(bw / iw - 1) < 0.05) {
      r.style.zoom = String(z);
      r.setAttribute("data-oros-zoom", "1");
    }
  }
  function a11yWireFrame(frame) {
    frame.addEventListener("load", function () { a11yFrame(frame); });
  }
  function a11yApply() {
    var root = document.documentElement, z = a11yZoom(), hi = a11yHigh();
    a11yMark(document);
    if (z !== 1) root.style.setProperty("--oros-zoom", String(z));
    else root.style.removeProperty("--oros-zoom");
    a11yAttr(root, "data-oros-zoom", z !== 1 ? "on" : null);
    appFrames().forEach(a11yFrame);
    // Open apps copy the palette again (their watchPalette observes
    // data-skin; setting the same value still notifies).
    if (a11yWasHigh !== null && hi !== a11yWasHigh) root.setAttribute("data-skin", state.skin);
    a11yWasHigh = hi;
  }
  function a11ySetUser(name, value) {
    if (name === "textSize") {
      var n = Number(value);
      if (A11Y_SIZES.indexOf(n) === -1 || n === a11y.size) return;
      a11y.size = n;
    } else if (name === "contrast") {
      if (["auto", "on", "off"].indexOf(value) === -1 || value === a11y.contrast) return;
      a11y.contrast = value;
    } else if (name === "focusRing") {
      if (!!value === a11y.focus) return;
      a11y.focus = !!value;
    } else return;
    try { localStorage.setItem(A11Y_KEY, JSON.stringify(a11y)); }
    catch (e) { scToast("err", window.t("a11y.savefail")); }
    a11yApply();
    settingsNotify();
  }
  function a11ySnapshot() {
    return {
      size: a11y.size, sizes: A11Y_SIZES.slice(), contrast: a11y.contrast, focus: a11y.focus,
      high: a11yHigh(), forced: a11yMq("(forced-colors: active)"),
      capped: a11yZoom() < a11y.size / 100
    };
  }
  // The system's own contrast switch and a resize (the 320 px cap)
  // apply at once.
  function a11yWatch() {
    ["(prefers-contrast: more)", "(forced-colors: active)"].forEach(function (q) {
      var mq = window.matchMedia ? window.matchMedia(q) : null;
      if (!mq) return;
      var on = function () { a11yApply(); settingsNotify(); };
      if (typeof mq.addEventListener === "function") mq.addEventListener("change", on);
      else if (typeof mq.addListener === "function") mq.addListener(on);
    });
    var queued = false;
    window.addEventListener("resize", function () {
      if (queued || a11y.size === 100) return;
      queued = true;
      requestAnimationFrame(function () { queued = false; a11yApply(); });
    });
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
        // BK-E: sealed first. Encryption on without this device's key
        // writes nothing (never a plain file the person turned off).
        return bkSealIfOn(JSON.stringify(filePayload, null, 2)).then(function (text) {
          return handle.getFileHandle(name, { create: true })
            .then(function (fh) { return fh.createWritable(); })
            .then(function (stream) {
              // SH-B5: write() is async. Close only after it settled, so
              // a failed write rejects THIS chain instead of escaping as
              // an unhandled rejection next to a "saved" message.
              return stream.write(text)
                .then(function () { return stream.close(); });
            });
        }).then(function () {
          setSyncMsg("ok", bkEncOn() ? "sync.ok.fsfolder.savedEnc" : "sync.ok.fsfolder.saved");
        });
      });
    }).catch(function (e) {
      if (e && e.message === "backup-nokey") { setSyncMsg("err", "sync.err.backupkey"); return; }
      // Best-effort — the sync engine data stays intact. SH-B5: forget
      // the schedule stamp, so the next boot / tab-visible check tries
      // again instead of waiting out a whole day/week/month.
      try { localStorage.removeItem(AUTOEXPORT_LAST); } catch (e2) {}
    });
}

  // ---------- 5d'. Encrypted backup files (BK-E) ----------
  // Settings › Backups › "Encrypt backup files", off by default. The
  // passphrase (at least MIN_PASS_LEN characters) is asked once; only
  // the key derived from it (orosSync.backupKey, PBKDF2 600 000) is
  // kept, non-extractable, in IndexedDB oros-fs "backup-key" next to
  // the folder handle. The export, Back up now and the scheduled
  // folder backups all seal with it; Import asks for the passphrase of
  // a sealed file and still reads plain files. Device-local: the
  // switch (oros-backup-enc) and the key never travel. Turning it off
  // forgets the key. The factory reset removes both (oros-* sweep,
  // oros-fs database).
  var bkKey;   // undefined = not read yet, null = none, else { key, s, it }

  function bkEncOn() {
    try { return localStorage.getItem(BK_ENC_KEY) === "1"; } catch (e) { return false; }
  }
  function bkKeyLoad() {
    if (bkKey !== undefined) return Promise.resolve(bkKey);
    return openFsDb()
      .then(function (db) { return idbFsGet(db, "backup-key"); })
      .catch(function () { return null; })
      .then(function (k) {
        bkKey = (k && k.key && typeof k.s === "string" && typeof k.it === "number") ? k : null;
        return bkKey;
      });
  }
  function bkKeyStore(k) {
    return openFsDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction("handles", "readwrite");
        if (k) tx.objectStore("handles").put(k, "backup-key");
        else tx.objectStore("handles").delete("backup-key");
        tx.oncomplete = function () { resolve(); };
        tx.onerror    = function () { reject(tx.error); };
      });
    }).then(function () { bkKey = k || null; });
  }
  // Text of a backup file → the text to write (sealed when on).
  function bkSealIfOn(text) {
    if (!bkEncOn()) return Promise.resolve(text);
    return bkKeyLoad().then(function (k) {
      if (!k) throw new Error("backup-nokey");
      return window.orosSync.sealBackup(text, k);
    });
  }
  // Switch on (or a new passphrase): the dialog sets the key first,
  // the switch follows only when the key is stored.
  function bkEncTurnOn() {
    showBackupPassDialog("set", function (pw) {
      return window.orosSync.backupKey(pw).then(bkKeyStore).then(function () {
        try { localStorage.setItem(BK_ENC_KEY, "1"); } catch (e) {}
        setSyncMsg("ok", "sync.ok.backupenc");
        renderMenu();
        settingsNotify();
      });
    });
  }
  function bkEncTurnOff() {
    try { localStorage.removeItem(BK_ENC_KEY); } catch (e) {}
    bkKeyStore(null).catch(function () { bkKey = null; }).then(function () {
      renderMenu();
      settingsNotify();
    });
  }

  // One dialog for both: "set" = new passphrase twice (switch on or
  // change it), "open" = the passphrase of a sealed file being
  // imported. run(pw) → Promise; its rejection "backup-pass" keeps the
  // dialog open with "wrong passphrase", any other closes it and goes
  // to handleSyncError. Cancel = nothing happens.
  function showBackupPassDialog(mode, run) {
    var stale = document.getElementById("bkpw-dialog");
    if (stale) stale.remove();
    var dlg = document.createElement("dialog");
    dlg.id = "bkpw-dialog";
    dlg.style.cssText =
      "border:1px solid var(--border);border-radius:12px;" +
      "background:var(--panel-bg);color:var(--text);padding:20px;" +
      "width:min(360px,calc(100vw - 32px));";
    var form = document.createElement("form");
    form.noValidate = true;
    function mkField(labelKey) {
      var wrap = document.createElement("label");
      wrap.style.cssText = "display:block;margin-bottom:12px;";
      var head = document.createElement("div");
      head.style.cssText = "font-size:12px;font-weight:600;color:var(--text-dim);margin-bottom:4px;";
      head.textContent = window.t(labelKey);
      wrap.appendChild(head);
      var row = document.createElement("div");
      row.style.cssText = "display:flex;gap:6px;";
      var input = document.createElement("input");
      input.type = "password";
      input.autocomplete = "off";
      input.spellcheck = false;
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
      form.appendChild(wrap);
      return input;
    }
    var title = document.createElement("h3");
    title.style.cssText = "margin:0 0 6px;font-size:14px;";
    title.textContent = window.t(mode === "set" ? "sync.bkenc.title" : "sync.bkopen.title");
    form.appendChild(title);
    var hint = document.createElement("div");
    hint.style.cssText = "font-size:11.5px;line-height:1.5;color:var(--text-dim);margin-bottom:14px;";
    hint.textContent = window.t(mode === "set" ? "sync.bkenc.hint" : "sync.bkopen.hint");
    form.appendChild(hint);
    var pw1 = mkField(mode === "set" ? "sync.bkenc.new" : "sync.bkopen.pass");
    var pw2 = mode === "set" ? mkField("sync.bkenc.confirm") : null;
    var errBox = document.createElement("div");
    errBox.setAttribute("role", "alert");
    errBox.style.cssText = "font-size:12px;color:var(--danger);min-height:18px;margin:2px 0 8px;";
    form.appendChild(errBox);
    var btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;";
    var cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.style.cssText =
      "border:1px solid var(--border);border-radius:8px;background:transparent;" +
      "color:var(--text-dim);padding:7px 14px;font-size:12.5px;font-weight:600;cursor:pointer;";
    cancelBtn.textContent = window.t("wx.cancel");
    cancelBtn.addEventListener("click", function () { dlg.close(); });
    btnRow.appendChild(cancelBtn);
    var okLabel = mode === "set" ? "sync.bkenc.ok" : "sync.bkopen.ok";
    var okBtn = document.createElement("button");
    okBtn.type = "submit";
    okBtn.style.cssText =
      "border:1px solid var(--accent);border-radius:8px;background:var(--accent);" +
      "color:#fff;padding:7px 14px;font-size:12.5px;font-weight:600;cursor:pointer;";
    okBtn.textContent = window.t(okLabel);
    btnRow.appendChild(okBtn);
    form.appendChild(btnRow);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (okBtn.disabled) return;
      errBox.textContent = "";
      var pw = pw1.value;
      if (!pw) { errBox.textContent = window.t("sync.err.nopass"); return; }
      if (pw2) {
        if (pw.length < MIN_PASS_LEN) { errBox.textContent = window.t("sync.err.shortpass"); return; }
        if (pw !== pw2.value) { errBox.textContent = window.t("sync.changepw.mismatch"); return; }
      }
      okBtn.disabled = true;
      okBtn.textContent = window.t("sync.bkenc.working");
      Promise.resolve().then(function () { return run(pw); }).then(function () {
        pw1.value = ""; if (pw2) pw2.value = "";
        dlg.close();
      }, function (err) {
        okBtn.disabled = false;
        okBtn.textContent = window.t(okLabel);
        if (err && err.message === "backup-pass") {
          errBox.textContent = window.t("sync.err.backuppass");
          pw1.select();
        } else {
          dlg.close();
          handleSyncError(err);
        }
      });
    });
    dlg.appendChild(form);
    dlg.addEventListener("close", function () { dlg.remove(); });
    document.body.appendChild(dlg);
    dlg.showModal();
    setTimeout(function () { pw1.focus(); }, 50);
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
  //   stays) · 6 date hidden (the time button's tooltip carries it) ·
  //   7 language button hidden, only when Quick settings (qsettings.js)
  //   is in the bar: its panel has the same language button.
  // Re-run by a ResizeObserver on the bar (a chip appears, the text
  // changes width, rotation), never per tick.
  var barFit = 0;
  var BAR_FIT_MAX = 7;

  function barDateStr(now, lvl) {
    var loc = window.orosI18n ? window.orosI18n.locale(state.lang) : (state.lang === "el" ? "el-GR" : "en-GB");
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
      (barFit >= 6 ? " · " + barDateStr(now, 0) : "");
    if (tBtn.title !== tt) tBtn.title = tt;
  }

  function applyBarFit(lvl) {
    barFit = lvl;
    var bar = document.getElementById("oros-bar");
    bar.classList.toggle("bar-tight", lvl >= 2);
    bar.classList.toggle("bar-nolabel", lvl >= 5);
    bar.classList.toggle("bar-nodate", lvl >= 6);
    bar.classList.toggle("bar-nolang", lvl >= 7);
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
      if (need <= avail || lvl >= (document.getElementById("qs-btn") ? BAR_FIT_MAX : 6)) return;
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
      tickSafe("davBgTick", davBgTickThrottled);         // CalDAV W6: background pass for closed apps (15 min)
      tickSafe("notifTick", notifTickThrottled);         // Wave 1A: notification sweep (60s throttle)
      tickSafe("syncPendingTick", syncPendingTickThrottled); // SY-D3: "changes waiting for a merge" notice (60s throttle)
      tickSafe("wxBriefTick", wxBriefTickThrottled);     // Weather unification: daily morning briefing (60s throttle)
      tickSafe("wxWarnTick", wxWarnTickThrottled);       // Weather wave 38: official warnings notice (60s throttle, off by default)
      tickSafe("quoteCheckTick", quoteCheckTickThrottled); // Wave 13: Quote due-date reminders (60s throttle)
      tickSafe("invoicesCheckTick", invoicesCheckTickThrottled); // Invoices wave 2: due / overdue reminder (60s throttle)
      tickSafe("stockCheckTick", stockCheckTickThrottled); // Stock: low-stock notice (60s throttle)
      tickSafe("mealsCheckTick", mealsCheckTickThrottled); // Meal Planner: pantry best-before reminder (60s throttle)
      tickSafe("budgetCheckTick", budgetCheckTickThrottled); // Budget: subscription charge reminders (60s throttle)
      tickSafe("crmCheckTick", crmCheckTickThrottled);     // CRM: follow-up reminders (60s throttle)
      tickSafe("contactCrmSync", contactCrmSyncThrottled); // CT-CRM: linked contacts ↔ CRM customers (60s throttle)
      tickSafe("keepCheckTick", keepCheckTickThrottled);   // Contacts: keep in touch, "reach out" (60s throttle)
      tickSafe("garageCheckTick", garageCheckTickThrottled); // Garage: renewals + service reminder (60s throttle)
      tickSafe("storageCheckTick", storageCheckTickThrottled); // Storage: warranty ends + return-by dates (60s throttle)
      tickSafe("minimalismCheckTick", minimalismCheckTickThrottled); // Wave 2: Minimalism daily ritual (60s throttle)
      tickSafe("petcareCheckTick", petcareCheckTickThrottled); // Pet Health Book: daily reminder (60s throttle)
      tickSafe("healthCheckTick", healthCheckTickThrottled); // Health: reminder times per measurement (60s throttle)
      tickSafe("waterCheckTick", waterCheckTickThrottled); // Water: behind-the-pace reminder (60s throttle)
      tickSafe("habitsCheckTick", habitsCheckTickThrottled); // Habits: per-habit reminder time (60s throttle)
      tickSafe("flashcardsCheckTick", flashcardsCheckTickThrottled); // Flashcards: daily study reminder (60s throttle)
      tickSafe("typingCheckTick", typingCheckTickThrottled); // Typing Tutor: daily practice reminder (60s throttle)
      tickSafe("plantsCheckTick", plantsCheckTickThrottled); // Plant Care: daily watering reminder (60s throttle)
      tickSafe("travelCheckTick", travelCheckTickThrottled); // Travel: evening before + before departures (60s throttle)
      tickSafe("namedayCheckTick", namedayCheckTickThrottled); // Calendar: contacts' name days, morning notice (60s throttle)
      tickSafe("babyCheckTick", babyCheckTickThrottled); // Baby: feed gap + daily medicine reminders (60s throttle)
      tickSafe("choresCheckTick", choresCheckTickThrottled); // Chore Wheel: daily "your chores" reminder (60s throttle)
      tickSafe("togetherCheckTick", togetherCheckTickThrottled); // Together: anniversaries, milestones, moments (60s throttle)
      tickSafe("timesheetCheckTick", timesheetCheckTickThrottled); // Timesheet: forgotten timer (60s throttle)
      tickSafe("parkCheckTick", parkCheckTickThrottled);   // Maps: parking reminder (60s throttle)
      tickSafe("shelfCheckTick", shelfCheckTickThrottled); // Media Shelf: daily reading reminder (60s throttle)
      tickSafe("todayTick", todayTickThrottled);           // Today: the daily summary notice (60s throttle)
      tickSafe("diaryCheckTick", diaryCheckTickThrottled); // One-Sentence Diary: evening reminder (60s throttle)
      tickSafe("stickiesTick", stickiesTick);              // Sticky Notes: ring + fade on the desktop (cheap, 1/s)
    }
    tickSafe("radioTrayTick", radioTrayTick); // Wave 2 Radio: tray chip paint (cheap, 1/s)
    tickSafe("mixerTrayTick", mixerTrayTick); // Sound Mixer: playing-with-app-closed chip (cheap, 1/s)
    tickSafe("wpDailyTick", wpDailyTick);     // Wallpaper "a new picture every day" (checks once a minute)
    tickSafe("timesheetTrayTick", timesheetTrayTick); // Timesheet Wave 3: running timer chip (cheap, 1/s)
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
    // BOOT-L1: the engines read the app cores of the late bundle. Run
    // them only once it is in, so none burns its throttle on a silent
    // return (fail-safe: LATE_GRACE_MS after boot they run anyway).
    if (!late.done && (Date.now() - shellBootAt) <= LATE_GRACE_MS) return false;
    var N = window.orosNotifs;
    if (N && typeof N.getState === "function") {
      try { if (N.getState().ready) return true; } catch (e) {}
    }
    return (Date.now() - shellBootAt) > ENGINE_GRACE_MS;
  }

  // Today (today/host.js): the daily summary notice. The module owns
  // the rule (start hour, after the unlock and the first sync merge,
  // once a day); the shell only gives it the clock. A stale
  // index.html without the module → silent.
  var todayLastTick = 0;
  function todayTickThrottled() {
    var now = Date.now();
    if (now - todayLastTick < 60000) return;
    todayLastTick = now;
    var T = window.orosToday;
    if (T && typeof T.tick === "function") T.tick();
  }
  // Sticky Notes (stickies/host.js): the module owns the rule (ring,
  // fade, the Faded bin) and draws the notes; the shell only gives it
  // the clock. A stale index.html without the module → silent.
  function stickiesTick() {
    var S = window.orosStickies;
    if (S && typeof S.tick === "function") S.tick();
  }
  function scNewSticky() {
    var S = window.orosStickies;
    if (S && typeof S.newNote === "function" && S.registered()) S.newNote();
    else openAppById("stickies");          // stale bundle: the app (or the menu)
  }

  // The manual unlock pulls directly (no auto-sync event): tell the
  // summary that this device's data has caught up (or failed to).
  function todaySyncSettled(ok) {
    if (ok) ctcrmAfterSync();             // CT-CRM: linked contacts ↔ CRM after the pull
    var T = window.orosToday;
    try { if (T && typeof T.syncSettled === "function") T.syncSettled(ok); } catch (e) {}
  }
  // A morning reminder whose content the summary already gave today
  // stays quiet (Today settings: "quiet the morning reminders").
  function todayAbsorbs(ns) {
    var T = window.orosToday;
    try { return !!(T && typeof T.absorbs === "function" && T.absorbs(ns)); }
    catch (e) { return false; }
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

  // The rule lives in minimalism/core.js (OrosMinimalismCore, loaded
  // by index.html), shared with the Today summary.
  function minimalismRaw() {
    try { return JSON.parse(localStorage.getItem(MINIMALISM_DATA_KEY)); } catch (e) { return null; }
  }

  function minimalismCheckTick() {
    var MC = window.OrosMinimalismCore;
    if (!MC) return;                                    // stale bundle — silent
    var raw = minimalismRaw(), today = sysYmd();
    if (!MC.hasAny(raw)) return;          // SH-B7: app never used — silent
    if (MC.engagedOn(raw, today)) return; // engaged today — silent
    if (new Date().getHours() < MC.remindHour(raw)) return;
    if (todayAbsorbs("minimalism")) return;             // said in today's summary
    var N = window.orosNotifs;
    if (!(N && typeof N.emit === "function")) return;   // stale bundle — silent
    N.emit({
      ns: "minimalism",
      key: "ritual-" + today,
      type: "reminder",
      title: window.t("app.minimalism"),
      body: window.t("n.min.body"),
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
  // Names of the built-in kinds: translations.js "rem.hn.<kind>".
  var HEALTH_NAMES = { bp: 1, wt: 1, gl: 1, sl: 1, hr: 1, tp: 1, o2: 1 };
  function healthCheckTick() {
    var Core = window.OrosHealthCore;
    if (!Core) return;                                  // stale bundle — silent
    var raw;
    try { raw = JSON.parse(localStorage.getItem(HEALTH_DATA_KEY)); } catch (e) { return; }
    if (!raw || !["ty", "md", "ap", "vx"].some(function (c) { return Array.isArray(raw[c]) && raw[c].length; })) return;
    var N = window.orosNotifs;
    if (!(N && typeof N.emit === "function")) return;
    var d = Core.merge(raw, raw), now = Date.now();
    var due = Core.dueReminders(d, now);
    // Record (Health wave 3): a doctor's appointment from its reminder
    // lead until it starts, and a vaccination's next dose a week before
    // and on the day. Same keys as the phone's alarms (alarmsBetween).
    var appts = typeof Core.dueAppts === "function" ? Core.dueAppts(d, now) : [];
    var vaxes = typeof Core.dueVax === "function" ? Core.dueVax(d, now) : [];
    if (appts.length || vaxes.length) {
      var titleR = window.t("app.health");
      if (titleR === "app.health") titleR = "Health";
      var dm = function (ms) { var x = new Date(ms); return x.getDate() + "/" + (x.getMonth() + 1); };
      var hmR = function (ms) { var x = new Date(ms); return (x.getHours() < 10 ? "0" : "") + x.getHours() + ":" + (x.getMinutes() < 10 ? "0" : "") + x.getMinutes(); };
      appts.forEach(function (r) {
        var a = r.ap, who = a.dr && a.sp ? a.dr + " · " + a.sp : (a.dr || a.sp);
        N.emit({ ns: "health", key: r.key, type: "reminder", title: titleR,
                 body: tr("rem.appt", { who: who, when: dm(a.at) + " " + hmR(a.at) }),
                 deepLink: "health:appts" });
      });
      vaxes.forEach(function (r) {
        var p = r.vx.nx.split("-");
        var when = (+p[2]) + "/" + (+p[1]);
        N.emit({ ns: "health", key: r.key, type: "reminder", title: titleR,
                 body: tr(r.st === "w" ? "rem.vax.week" : "rem.vax.due", { name: r.vx.n, when: when }),
                 deepLink: "health:vax" });
      });
    }
    // Medicines (Health wave 2): each dose from its time for 4 hours
    // unless marked or snoozed (a snooze rings again with its own key),
    // and once per count / refill when one runs low. Deep link
    // "health:meds" → the Medicines tab, Today.
    var doses = typeof Core.dueDoses === "function" ? Core.dueDoses(d, now) : [];
    var lows = typeof Core.lowStock === "function" ? Core.lowStock(d, now) : [];
    if (!due.length && !doses.length && !lows.length) return;
    var title = window.t("app.health");
    if (title === "app.health") title = "Health";       // missing-key fallback
    doses.forEach(function (r) {
      var hm = (r.tm < 600 ? "0" : "") + Math.floor(r.tm / 60) + ":" + (r.tm % 60 < 10 ? "0" : "") + (r.tm % 60);
      var name = r.med.n + (r.med.s ? " " + r.med.s : "");
      N.emit({ ns: "health", key: r.key, type: "reminder", title: title,
               body: tr("rem.med", { name: name, time: hm }),
               deepLink: "health:meds" });
    });
    lows.forEach(function (r) {
      var name = r.med.n + (r.med.s ? " " + r.med.s : "");
      var body = r.left <= 0 ? tr("rem.low.none", { name: name })
        : r.days === null ? tr("rem.low.soon", { name: name })
        : r.days < 2 ? tr("rem.low.day", { name: name })
        : tr("rem.low.days", { name: name, n: r.days });
      N.emit({ ns: "health", key: r.key, type: "reminder", title: title, body: body, deepLink: "health:meds" });
    });
    due.forEach(function (r) {
      var ty = Core.typeRow(d, r.t);
      var name = HEALTH_NAMES[r.t] ? window.t("rem.hn." + r.t) : (ty ? ty.n : "");
      var hm = (r.min < 600 ? "0" : "") + Math.floor(r.min / 60) + ":" + (r.min % 60 < 10 ? "0" : "") + (r.min % 60);
      N.emit({
        ns: "health",
        key: r.key,
        type: "reminder",
        title: title,
        body: tr("rem.measure", { name: name, time: hm }),
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
    if (todayAbsorbs("calendar")) return;               // said in today's summary
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
    var who = (typeof ND.contactsCelebrating === "function" ? ND.contactsCelebrating(raw.contacts, today) : [])
      .map(function (x) { return x.name; });
    if (!who.length) return;
    var shown = who.slice(0, 3).join(", ");
    if (who.length > 3) shown += " " + tr("n.andmore", { n: who.length - 3 });
    N.emit({
      ns: "calendar",
      key: "nameday-" + today,
      type: "reminder",
      title: window.t("n.nd.title"),
      body: tr("n.nd.body", { names: shown }),
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

  // Stock — low-stock notice. Reads "oros-stock-data" directly (works
  // with the app CLOSED) and asks stock/core.js (loaded by index.html,
  // the SAME file the app runs) which products are at or below their
  // minimum; the quantity is the sum of the movements there too. A
  // product is announced once when it ENTERS that list and again only
  // after it left it (device-local "oros-stock-notified" = { id: 1 }).
  // One grouped notification at most per tick. Switch: oros-stock-prefs
  // .notify (default on); while off the map still follows the list, so
  // switching on does not replay old news. SH-B7: no products → silent.
  var STOCK_DATA_KEY = "oros-stock-data";
  var STOCK_NOTIFIED_KEY = "oros-stock-notified";
  function stockCheckTick() {
    var Core = window.OrosStockCore;
    if (!Core) return;                                  // stale bundle — silent
    var raw, prefs, notified;
    try {
      raw = JSON.parse(localStorage.getItem(STOCK_DATA_KEY));
      prefs = Core.readPrefs(JSON.parse(localStorage.getItem("oros-stock-prefs")));
      notified = JSON.parse(localStorage.getItem(STOCK_NOTIFIED_KEY)) || {};
    } catch (e) { return; }
    if (!raw || !Array.isArray(raw.items) || !raw.items.length) return;
    var data = Core.merge(raw, raw);
    var low = Core.lowList(data);
    var st = Core.toNotify(low.map(function (r) { return r.item.id; }), notified);
    if (JSON.stringify(st.next) !== JSON.stringify(notified)) {
      try { localStorage.setItem(STOCK_NOTIFIED_KEY, JSON.stringify(st.next)); } catch (e) {}
    }
    if (!prefs.notify || !st.fresh.length) return;
    var N = window.orosNotifs;
    if (!(N && typeof N.emit === "function")) return;
    var names = {};
    low.forEach(function (r) { names[r.item.id] = r.item.name; });
    var shown = st.fresh.slice(0, 3).map(function (id) { return names[id]; }).join(", ");
    if (st.fresh.length > 3) shown += " " + tr("n.andmore", { n: st.fresh.length - 3 });
    var title = window.t("app.stock");
    if (title === "app.stock") title = "Stock";        // missing-key fallback
    N.emit({
      ns: "stock",
      key: "low-" + sysYmd() + "-" + garageHash(st.fresh.join("|")),
      type: "reminder",
      title: title,
      body: tr("n.stock.body", { names: shown }),
      deepLink: st.fresh.length === 1 ? "stock:" + st.fresh[0] : "stock:reorder"
    });
  }

  // Meal Planner — pantry best-before reminder. Reads "oros-meals-data"
  // directly (works with the app CLOSED) and asks meals/pantry.js
  // (loaded by index.html, the SAME file the app runs) which pantry
  // items reach their best-before day today or tomorrow. Off unless
  // the user picked an hour (device-local oros-meals-prefs.nt, -1 =
  // off); from that hour on, one notice per day per set of items (the
  // key carries the day and the items), so an item added later in the
  // day still gets its own notice. Nothing due → silent (SH-B7).
  var MEALS_DATA_KEY = "oros-meals-data";
  function mealsCheckTick() {
    var Core = window.OrosMealsPantry;
    if (!Core) return;                                  // stale bundle — silent
    var raw, hour;
    try {
      hour = Core.notifyHour(JSON.parse(localStorage.getItem("oros-meals-prefs")));
      if (hour < 0 || new Date().getHours() < hour) return;
      raw = JSON.parse(localStorage.getItem(MEALS_DATA_KEY));
    } catch (e) { return; }
    var today = sysYmd();
    var due = Core.expiryNotice(raw, today);
    if (!due.length) return;
    var N = window.orosNotifs;
    if (!(N && typeof N.emit === "function")) return;
    function names(list) {
      var s = list.slice(0, 3).map(function (x) { return x.n; }).join(", ");
      if (list.length > 3) s += " " + tr("n.andmore", { n: list.length - 3 });
      return s;
    }
    var td = due.filter(function (x) { return x.d === 0; }), tm = due.filter(function (x) { return x.d === 1; });
    var parts = [];
    if (td.length) parts.push(tr("n.meals.today", { names: names(td) }));
    if (tm.length) parts.push(tr("n.meals.tomorrow", { names: names(tm) }));
    var title = window.t("app.meals");
    if (title === "app.meals") title = "Meal Planner";  // missing-key fallback
    N.emit({
      ns: "meals",
      key: "bb-" + today + "-" + garageHash(due.map(function (x) { return x.id + ":" + x.d; }).join("|")),
      type: "reminder",
      title: title,
      body: parts.join(" · "),
      deepLink: "meals:pantry"
    });
  }
  var mealsLastTick = 0;
  function mealsCheckTickThrottled() {
    var now = Date.now();
    if (now - mealsLastTick < 60000) return;
    mealsLastTick = now;
    mealsCheckTick();
  }

  // Budget — subscription reminders: "Netflix: 12,99 € tomorrow".
  // Reads "oros-budget-data" directly (works with the app CLOSED) and
  // asks budget/plan.js (loaded by index.html, the SAME file the app
  // runs) which recurring expenses with a reminder ("nd" days before,
  // synced) charge within their lead. From the device-local hour on
  // (oros-budget-prefs.nh, default 9, -1 = off on this device); one
  // notice per charge (the key names the entry and the charge date).
  // No reminders set → silent (SH-B7).
  var BUDGET_DATA_KEY = "oros-budget-data";
  function budgetCheckTick() {
    var Core = window.OrosBudgetPlan;
    if (!Core) return;                                  // stale bundle — silent
    var raw, prefs;
    try {
      prefs = JSON.parse(localStorage.getItem("oros-budget-prefs")) || {};
      var hour = typeof prefs.nh === "number" && prefs.nh >= -1 && prefs.nh <= 23 ? Math.floor(prefs.nh) : 9;
      if (hour < 0 || new Date().getHours() < hour) return;
      raw = JSON.parse(localStorage.getItem(BUDGET_DATA_KEY));
    } catch (e) { return; }
    if (!raw || !Array.isArray(raw.rec) || !raw.rec.length) return;
    var today = sysYmd();
    var due = Core.subsDue(raw, today);
    if (!due.length) return;
    var N = window.orosNotifs;
    if (!(N && typeof N.emit === "function")) return;
    var cur = raw.set && typeof raw.set.cur === "string" && /^[A-Z]{3}$/.test(raw.set.cur) ? raw.set.cur : "EUR";
    var fmt;
    try { fmt = new Intl.NumberFormat(window.orosI18n ? window.orosI18n.locale(state.lang) : (state.lang === "el" ? "el-GR" : "en-GB"), { style: "currency", currency: cur }); }
    catch (e) { fmt = { format: function (v) { return v.toFixed(2) + " " + cur; } }; }
    var names = {};
    (Array.isArray(raw.cats) ? raw.cats : []).forEach(function (c) { if (c && typeof c.name === "string" && c.name) names[c.id] = c.name; });
    var title = window.t("app.budget");
    if (title === "app.budget") title = "Budget";       // missing-key fallback
    due.forEach(function (d) {
      var name = String(d.n || names[d.c] || window.t("n.budget.recurring")).slice(0, 80);
      var when = d.days === 0 ? window.t("n.today") : d.days === 1 ? window.t("n.tomorrow")
               : tr("n.budget.on", { date: d.next.slice(8, 10) + "/" + d.next.slice(5, 7) });
      N.emit({
        ns: "budget",
        key: d.key,
        type: "reminder",
        title: title,
        body: name + ": " + fmt.format(d.a / 100) + " " + when,
        deepLink: "budget:sub:" + d.id
      });
    });
  }
  var budgetLastTick = 0;
  function budgetCheckTickThrottled() {
    var now = Date.now();
    if (now - budgetLastTick < 60000) return;
    budgetLastTick = now;
    budgetCheckTick();
  }

  var stockLastTick = 0;
  function stockCheckTickThrottled() {
    var now = Date.now();
    if (now - stockLastTick < 60000) return;
    stockLastTick = now;
    stockCheckTick();
  }

  // CRM — follow-up reminders. Reads "oros-crm-data" directly (works
  // with the app CLOSED, and is the only reminder engine while it is
  // open) and asks crm/core.js (loaded by index.html, the SAME file
  // the app runs) which open follow-ups are due: earlier days, today
  // without a time, today once the time has come. One notice per
  // follow-up (key = id + day + time: moved to another day or time,
  // it rings again); device-local "oros-crm-notified" keeps only what
  // is still due. Nothing is marked before the inbox is ready.
  // SH-B7: no follow-ups → silent.
  var CRM_DATA_KEY = "oros-crm-data";
  var CRM_NOTIFIED_KEY = "oros-crm-notified";
  function crmCheckTick() {
    var Core = window.OrosCrmCore;
    if (!Core) return;                                  // stale bundle — silent
    var N = window.orosNotifs;
    if (!(N && typeof N.emit === "function" && typeof N.getState === "function")) return;
    try { if (!N.getState().ready) return; } catch (e) { return; }
    var raw, seen;
    try {
      raw = JSON.parse(localStorage.getItem(CRM_DATA_KEY));
      seen = JSON.parse(localStorage.getItem(CRM_NOTIFIED_KEY)) || {};
    } catch (e) { return; }
    if (!raw || !Array.isArray(raw.fups) || !raw.fups.length) return;
    var data = Core.norm(raw);
    var now = new Date(), today = sysYmd();
    var hm = (now.getHours() < 10 ? "0" : "") + now.getHours() + ":" + (now.getMinutes() < 10 ? "0" : "") + now.getMinutes();
    var r = Core.reminders(data, today, hm, seen);
    r.fresh.slice(0, 10).forEach(function (x) {         // a long-closed orOS: at most 10 per tick
      var txt = Core.reminderText(data, x.fup, today, langBase());
      N.emit({ ns: "crm", key: "fup-" + x.key, type: "reminder",
               title: txt.title, body: txt.body, deepLink: "crm:" + x.fup.id });
    });
    r.fresh.slice(10).forEach(function (x) { delete r.next[x.key]; });   // next tick
    if (JSON.stringify(r.next) !== JSON.stringify(seen)) {
      try { localStorage.setItem(CRM_NOTIFIED_KEY, JSON.stringify(r.next)); } catch (e) {}
    }
  }

  var crmLastTick = 0;
  function crmCheckTickThrottled() {
    var now = Date.now();
    if (now - crmLastTick < 60000) return;
    crmLastTick = now;
    crmCheckTick();
  }

  // CT-CRM — linked contacts ↔ CRM customers, both ways. Reads both
  // stored copies (the apps may be closed) and asks
  // crm/contactsync.js (the SAME file the CRM app runs) what each side
  // takes: per field the newer change, a difference that existed
  // before the link waits for the user in CRM. Each side is written
  // by its own rules (CRM's norm, Contacts' field stamps); an app
  // that is open re-reads its copy at once, so its next save or push
  // can't put the old one back. Runs after each sync (with a cloud,
  // not before this session's first one has ended, at most 2 minutes
  // after the boot: an early write would hold back a pull of the
  // closed app), on the tick, and 1.5 s after either app writes (a
  // storage event from its frame); nothing to do when neither copy
  // changed since the last pass. A pass that
  // finds both sides equal writes nothing: no loop, no upload.
  var CT_DATA_KEY = "oros-contacts-data";
  var ctcrmSeen = { crm: null, ct: null }, ctcrmTimer = null, ctcrmLastTick = 0, ctcrmSynced = false;
  function ctcrmMayRun() {
    if (ctcrmSynced || Date.now() - shellBootAt > 120000) return true;
    try { return !(window.orosSync && window.orosSync.isConnected()); } catch (e) { return true; }
  }
  function ctcrmAfterSync() {
    ctcrmSynced = true;
    try { contactCrmSync(); } catch (e) {}
  }
  function ctcrmReload(appId) {
    if (appLive(appId)) {
      var f = appFrameOf(appId);           // a background push: the app stays where it is
      try { if (f && f.contentWindow && typeof f.contentWindow.__orosDataReload === "function") f.contentWindow.__orosDataReload(); } catch (e) {}
    }
  }
  function contactCrmSync() {
    var S = window.OrosCrmContactSync, Core = window.OrosCrmCore, MG = window.OrosContactsMerge;
    if (!S || !Core || !MG || !ctcrmMayRun()) return;   // stale bundle — silent
    var rc, rt;
    try { rc = localStorage.getItem(CRM_DATA_KEY); rt = localStorage.getItem(CT_DATA_KEY); } catch (e) { return; }
    if (!rc || !rt || (rc === ctcrmSeen.crm && rt === ctcrmSeen.ct)) return;
    ctcrmSeen = { crm: rc, ct: rt };
    var crm, ctd;
    try { crm = JSON.parse(rc); ctd = JSON.parse(rt); } catch (e) { return; }
    if (!crm || !Array.isArray(crm.cust) || !crm.cust.length || !ctd || !Array.isArray(ctd.contacts)) return;
    var r = S.run(Core, MG, crm, ctd, Date.now()), wrote = false;
    if (r.crm) {
      try { localStorage.setItem(CRM_DATA_KEY, JSON.stringify(r.crm)); wrote = true; ctcrmReload("crm"); } catch (e) {}
    }
    if (r.contacts) {
      try { localStorage.setItem(CT_DATA_KEY, JSON.stringify(r.contacts)); wrote = true; ctcrmReload("contacts"); } catch (e) {}
    }
    if (!wrote) return;
    try { ctcrmSeen = { crm: localStorage.getItem(CRM_DATA_KEY), ct: localStorage.getItem(CT_DATA_KEY) }; } catch (e) {}
    if (window.orosSync && typeof window.orosSync.markDirty === "function") window.orosSync.markDirty();
  }
  function contactCrmSyncThrottled() {
    var now = Date.now();
    if (now - ctcrmLastTick < 60000) return;
    ctcrmLastTick = now;
    contactCrmSync();
  }
  if (window.orosSync && typeof window.orosSync.onAutoSync === "function") {
    window.orosSync.onAutoSync(function (kind) { if (kind === "done") ctcrmAfterSync(); });
  }
  window.addEventListener("storage", function (e) {
    if (e.key !== CRM_DATA_KEY && e.key !== CT_DATA_KEY) return;
    clearTimeout(ctcrmTimer);
    ctcrmTimer = setTimeout(function () { try { if (enginesMayRun()) contactCrmSync(); } catch (err) {} }, 1500);
  });

  // Contacts — keep in touch. Reads "oros-contacts-data" directly
  // (works with the app CLOSED) and asks contacts/keep.js (loaded by
  // index.html, the SAME file the app runs) who is due. Off by
  // default; switch and hour are device-local ("oros-contacts-keep",
  // set in Contacts › Reach out). From that hour, one notice per day
  // when someone is due; the key is the same on every device (inbox
  // dedup). One person → their card; several → the Reach out list.
  // Honest limit: orOS closed = nothing fires; the next boot the same
  // day catches up.
  function keepCheckTick() {
    var K = window.OrosContactsKeep;
    if (!K) return;                                     // stale bundle — silent
    var pr;
    try { pr = JSON.parse(localStorage.getItem(K.PREFS_KEY) || "null"); } catch (e) { return; }
    if (!K.prefs(pr).on) return;
    var N = window.orosNotifs;
    if (!(N && typeof N.emit === "function")) return;
    var raw;
    try { raw = JSON.parse(localStorage.getItem("oros-contacts-data")); } catch (e) { return; }
    if (!raw || !Array.isArray(raw.contacts) || !raw.contacts.length) return;
    var r = K.reminder(raw, pr, Date.now());
    if (!r) return;
    var txt = K.reminderText(r, langBase());
    N.emit({
      ns: "contacts",
      key: r.key,
      type: "reminder",
      title: txt.title,
      body: txt.body,
      deepLink: "contacts:" + (r.count === 1 ? r.ids[0] : "@reachout")
    });
  }

  var keepLastTick = 0;
  function keepCheckTickThrottled() {
    var now = Date.now();
    if (now - keepLastTick < 60000) return;
    keepLastTick = now;
    keepCheckTick();
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
    if (window.OrosGarageHouse) raw = window.OrosGarageHouse.withShared(raw && Array.isArray(raw.vehicles) ? raw : null);   // shared vehicles (BR-HH wave 7e)
    if (!raw || !Array.isArray(raw.vehicles) || !raw.vehicles.length) return;
    if (prefs.remind < 0 || new Date().getHours() < prefs.remind) return;
    if (todayAbsorbs("garage")) return;                 // said in today's summary
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
    if (fresh.length > 3) lines.push(tr("n.andmore", { n: fresh.length - 3 }));
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

  // Storage — warranty ends (30 days, 7 days, on the day) and lent
  // items due back. Reads "oros-storage-data" directly (works with the
  // app CLOSED) through storage/core.js (loaded by index.html, the SAME
  // file the app runs). OFF by default: the reminder hour lives in the
  // device-local "oros-storage-prefs" (remind 0–23, −1 = off). Each
  // alert is announced once per step: device-local
  // "oros-storage-notified" = { alertKey: lowest step announced },
  // pruned to alerts that still exist. One grouped notification at
  // most per tick. Honest limit (alarms): orOS closed = nothing fires;
  // the next boot catches up (a warranty end up to 7 days back).
  var STORAGE_DATA_KEY = "oros-storage-data";
  var STORAGE_NOTIFIED_KEY = "oros-storage-notified";
  function storageCheckTick() {
    var Core = window.OrosStorageCore;
    if (!Core) return;                                  // stale bundle — silent
    var raw, prefs, notified;
    try {
      prefs = Core.readPrefs(JSON.parse(localStorage.getItem("oros-storage-prefs")));
      if (prefs.remind < 0 || new Date().getHours() < prefs.remind) return;
      raw = JSON.parse(localStorage.getItem(STORAGE_DATA_KEY));
      notified = JSON.parse(localStorage.getItem(STORAGE_NOTIFIED_KEY)) || {};
    } catch (e) { return; }
    if (!raw || !Array.isArray(raw.ents) || !raw.ents.length) return;
    var N = window.orosNotifs;
    if (!(N && typeof N.emit === "function")) return;
    if (!notified || typeof notified !== "object") notified = {};
    var today = sysYmd();
    var data = Core.mergeData(raw, raw);
    var all = Core.alerts(data.ents, today);
    var fresh = Core.toNotify(all, notified);
    var next = {};
    all.forEach(function (a) { if (Object.prototype.hasOwnProperty.call(notified, a.key)) next[a.key] = notified[a.key]; });
    fresh.forEach(function (a) { next[a.key] = a.step; });
    try { localStorage.setItem(STORAGE_NOTIFIED_KEY, JSON.stringify(next)); } catch (e) {}
    if (!fresh.length) return;
    var lang = state.lang === "el" ? "el" : "en";
    var lines = fresh.slice(0, 3).map(function (a) { return Core.alertLine(a, data.ents, lang); });
    if (fresh.length > 3) lines.push(tr("n.andmore", { n: fresh.length - 3 }));
    var title = window.t("app.storage");
    if (title === "app.storage") title = "Storage";    // missing-key fallback
    var allLent = fresh.every(function (a) { return a.kind === "l"; });
    N.emit({
      ns: "storage",
      key: "alerts-" + today + "-" + garageHash(fresh.map(function (a) { return a.key + ":" + a.step; }).join("|")),
      type: "reminder",
      title: title,
      body: lines.join(" · "),
      deepLink: "storage:" + (fresh.length > 1 && allLent ? "lent" : fresh[0].id)
    });
  }

  var storageLastTick = 0;
  function storageCheckTickThrottled() {
    var now = Date.now();
    if (now - storageLastTick < 60000) return;
    storageLastTick = now;
    storageCheckTick();
  }

  // Travel — the evening before departure ("Rome tomorrow · 6 items
  // to pack", from 18:00) and shortly before a timed departure
  // (flight 3 h, train / bus / ferry 1 h). Reads "oros-travel-data"
  // directly (works with the app CLOSED) through travel/core.js
  // (loaded by index.html; the Calendar feed reads it the same way).
  // Each notice once per device: "oros-travel-fired" = { key: ms },
  // pruned after 3 days; the inbox dedup key covers a twin from
  // another device. Off when the app's Reminders setting is off
  // (oros-travel-prefs.rem = 0, device-local). Honest limit (alarms):
  // orOS closed = nothing fires, a departure window that passed is
  // not caught up.
  var TRAVEL_FIRED_KEY = "oros-travel-fired";
  function travelCheckTick() {
    var Core = window.OrosTravelCore;
    if (!Core) return;                                  // stale bundle — silent
    var raw, prefs, fired;
    try {
      raw = localStorage.getItem("oros-travel-data");
      if (!raw) return;
      raw = JSON.parse(raw);
      prefs = JSON.parse(localStorage.getItem("oros-travel-prefs") || "null");
      fired = JSON.parse(localStorage.getItem(TRAVEL_FIRED_KEY) || "null");
    } catch (e) { return; }
    if (prefs && prefs.rem === 0) return;
    var N = window.orosNotifs;
    if (!(N && typeof N.emit === "function")) return;
    var now = Date.now();
    var lang = state.lang === "el" ? "el" : "en";
    var due = Core.due(Core.trips(raw), now, lang);
    var next = Core.pruneFired(fired, now);
    var fresh = due.filter(function (d) { return !Object.prototype.hasOwnProperty.call(next, d.key); });
    if (!fresh.length) {
      if (fired && Object.keys(fired).length !== Object.keys(next).length) {
        try { localStorage.setItem(TRAVEL_FIRED_KEY, JSON.stringify(next)); } catch (e) {}
      }
      return;
    }
    fresh.forEach(function (d) { next[d.key] = now; });
    try { localStorage.setItem(TRAVEL_FIRED_KEY, JSON.stringify(next)); } catch (e) {}
    fresh.slice(0, 3).forEach(function (d) {
      N.emit({
        ns: "travel",
        key: d.key,
        type: "reminder",
        title: d.title,
        body: d.body,
        deepLink: "travel:" + d.trip
      });
    });
  }

  var travelLastTick = 0;
  function travelCheckTickThrottled() {
    var now = Date.now();
    if (now - travelLastTick < 60000) return;
    travelLastTick = now;
    travelCheckTick();
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
    // Shared books (BR-HH wave 7c): a pet in a household is read from
    // there, so it reminds once.
    if (window.OrosPetcareHouse) raw = window.OrosPetcareHouse.withShared(raw && Array.isArray(raw.pets) ? raw : null);
    if (!raw || !Array.isArray(raw.pets) || !raw.pets.length) return;
    var N = window.orosNotifs;
    if (!(N && typeof N.emit === "function" && typeof N.getState === "function")) return;
    try { if (!N.getState().ready) return; } catch (e) { return; }
    if (prefs.doses && typeof Core.dosesDue === "function") petcareDoseCheck(Core, raw, N);
    if (prefs.remind < 0 || new Date().getHours() < prefs.remind) return;
    if (todayAbsorbs("petcare")) return;                // said in today's summary (doses still ring)
    var today = sysYmd();
    var res = Core.reminders(Core.merge(raw, raw), today, prefs.lead, fired);
    var same = JSON.stringify(res.fired) === JSON.stringify(fired);
    if (!same) { try { localStorage.setItem(PETCARE_FIRED_KEY, JSON.stringify(res.fired)); } catch (e) {} }
    if (!res.items.length) return;
    var CARE = { bath: 1, nails: 1, brush: 1, teeth: 1, ears: 1, litter: 1, cage: 1, tank: 1 };   // n.pet.care.<sub>
    function what(it) {
      if (it.kind === "vacc") return it.label;
      if (it.kind === "deworm") return window.t("n.pet.deworm");
      if (it.kind === "visit") return window.t("n.pet.visit");
      if (it.kind === "med") return tr("n.pet.med", { name: it.label });
      if (it.kind === "care") return CARE[it.sub] ? window.t("n.pet.care." + it.sub) : it.sub;
      return window.t("n.pet.food");
    }
    function when(d) {
      if (d === 0) return window.t("n.today");
      if (d === 1) return window.t("n.tomorrow");
      if (d > 1) return tr("n.indays", { n: d });
      return trn("n.late", -d);
    }
    var parts = res.items.slice(0, 4).map(function (it) {
      return it.pet.name + ": " + what(it) + " " + when(it.diff);
    });
    if (res.items.length > 4) parts.push(tr("n.andmore", { n: res.items.length - 4 }));
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

  // Per-dose medicine reminders (phase 2): a course with dose times
  // gets one notification at each time, in the 90 minutes after it
  // (a dose missed while orOS was closed is skipped, not announced
  // late). Device-local oros-petcare-doses keeps today's announced
  // doses; the key is the same on every device, so the synced inbox
  // shows each dose once. Own switch in the app (prefs.doses),
  // independent of the daily reminder hour.
  var PETCARE_DOSES_KEY = "oros-petcare-doses";
  function petcareDoseCheck(Core, raw, N) {
    var fired;
    try { fired = JSON.parse(localStorage.getItem(PETCARE_DOSES_KEY) || "{}"); } catch (e) { fired = {}; }
    var now = new Date();
    var res = Core.dosesDue(Core.merge(raw, raw), sysYmd(), now.getHours() * 60 + now.getMinutes(), fired);
    if (JSON.stringify(res.fired) !== JSON.stringify(fired)) {
      try { localStorage.setItem(PETCARE_DOSES_KEY, JSON.stringify(res.fired)); } catch (e) {}
    }
    if (!res.items.length) return;
    var title = window.t("app.petcare");
    if (title === "app.petcare") title = "Pet Health Book";
    var byTime = {};
    res.items.forEach(function (it) { (byTime[it.tm] || (byTime[it.tm] = [])).push(it); });
    Object.keys(byTime).sort().forEach(function (tm) {
      var list = byTime[tm];
      var body = list.slice(0, 4).map(function (it) {
        return it.pet.name + ": " + it.rec.n + (it.rec.ds ? " (" + it.rec.ds + ")" : "");
      });
      if (list.length > 4) body.push(tr("n.andmore", { n: list.length - 4 }));
      var sig = list.map(function (it) { return it.key; }).join("|"), h = 0;
      for (var i = 0; i < sig.length; i++) h = (h * 31 + sig.charCodeAt(i)) | 0;
      N.emit({
        ns: "petcare",
        key: "dose-" + list[0].key.slice(-16) + "-" + (h >>> 0).toString(36),
        type: "reminder",
        title: title + " · " + tr("n.pet.dose", { time: tm }),
        body: body.join(" · "),
        deepLink: "petcare:" + (list.length === 1 ? list[0].pet.id : "today")
      });
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
  // Plants shared with a household (BR-HH) come from the device-local
  // mirror plants/house.js keeps: only the ones that remind this person.
  var PLANTS_DATA_KEY = "oros-plants-data";
  function plantsCheckTick() {
    var Core = window.OrosPlantsCore, HHp = window.OrosPlantsHouse;
    if (!Core) return;                                  // stale bundle — silent
    var raw, prefs, sets = [];
    try {
      raw = JSON.parse(localStorage.getItem(PLANTS_DATA_KEY));
      prefs = Core.readPrefs(JSON.parse(localStorage.getItem("oros-plants-prefs")));
      if (HHp) HHp.readMirror(JSON.parse(localStorage.getItem(HHp.MIRROR_KEY))).forEach(function (g) { if (g.own.plants.length) sets.push(g.own); });
    } catch (e) { return; }
    if (raw && Array.isArray(raw.plants) && raw.plants.length) sets.unshift(Core.merge(raw, raw));
    if (!sets.length) return;
    if (prefs.remind < 0 || new Date().getHours() < prefs.remind) return;
    if (todayAbsorbs("plants")) return;                 // said in today's summary
    var N = window.orosNotifs;
    if (!(N && typeof N.emit === "function")) return;
    var today = sysYmd();
    var sum = { n: 0, names: [], outWater: false };
    sets.forEach(function (d) {
      var s = Core.summary(d, today, prefs.hemi);
      sum.n += s.n;
      sum.names = sum.names.concat(s.names);
      sum.outWater = sum.outWater || s.outWater;
    });
    if (!sum.n) return;
    var names = sum.names.slice(0, 3).join(", ");
    if (sum.names.length > 3) names += " " + tr("n.andmore", { n: sum.names.length - 3 });
    var body = tr(sum.names.length === 1 ? "n.plants.one" : "n.plants.other", { names: names });
    if (sum.outWater) {
      var wx = null;
      try {
        wx = Core.weather(JSON.parse(localStorage.getItem("oros-weatherapp-data")),
                          JSON.parse(localStorage.getItem("oros-weatherapp-cache")),
                          wxRead(), today, Date.now());
      } catch (e) {}
      if (wx && wx.rain) body += window.t("n.plants.rain");
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

  // Chore Wheel — daily "your chores today" reminder. Reads
  // "oros-chores-data" directly (works with the app CLOSED) and asks
  // chores/core.js (loaded by index.html, the SAME file the app runs)
  // who has what today. Only for the member picked as "me" on THIS
  // device (oros-chores-prefs, device-local), from the reminder hour
  // on (default 09:00, -1 = off): one notice per day. No "me", no
  // chores of mine → silent (SH-B7).
  // Wheels shared with a household (BR-HH) come from the device-local
  // mirror chores/house.js keeps, each with this person's own "me".
  var CHORES_DATA_KEY = "oros-chores-data";
  function choresCheckTick() {
    var Core = window.OrosChoresCore, HHc = window.OrosChoresHouse;
    if (!Core) return;                                  // stale bundle — silent
    var raw, prefs, wheels = [];
    try {
      raw = JSON.parse(localStorage.getItem(CHORES_DATA_KEY));
      prefs = Core.readPrefs(JSON.parse(localStorage.getItem("oros-chores-prefs")));
      if (HHc) wheels = HHc.readMirror(JSON.parse(localStorage.getItem(HHc.MIRROR_KEY)));
    } catch (e) { return; }
    if (prefs.me && raw && Array.isArray(raw.tasks) && raw.tasks.length) wheels.unshift({ data: Core.mergeChores(raw, raw), me: prefs.me });
    wheels = wheels.filter(function (w) { return w.me; });
    if (!wheels.length) return;
    if (prefs.rh < 0 || new Date().getHours() < prefs.rh) return;
    if (todayAbsorbs("chores")) return;                 // said in today's summary
    var N = window.orosNotifs;
    if (!(N && typeof N.emit === "function")) return;
    var sum = { names: [], late: 0 }, dn = Core.localDn(new Date());
    wheels.forEach(function (w) {
      var s = Core.summary(w.data, dn, w.me);
      sum.names = sum.names.concat(s.names);
      sum.late += s.late;
    });
    if (!sum.names.length && !sum.late) return;
    var names = sum.names.slice(0, 3).join(", ");
    if (sum.names.length > 3) names += " " + tr("n.andmore", { n: sum.names.length - 3 });
    var body = sum.names.length ? tr("n.chores.today", { names: names }) : "";
    if (sum.late) {
      var lt = trn("n.chores.late", sum.late);
      body = body ? body + " · " + lt : lt;
    }
    var title = window.t("app.chores");
    if (title === "app.chores") title = "Chore Wheel";  // missing-key fallback
    N.emit({
      ns: "chores",
      key: "today-" + sysYmd(),
      type: "reminder",
      title: title,
      body: body,
      deepLink: "chores:today"
    });
  }

  var choresLastTick = 0;
  function choresCheckTickThrottled() {
    var now = Date.now();
    if (now - choresLastTick < 60000) return;
    choresLastTick = now;
    choresCheckTick();
  }

  // Together — one morning notice on a day with an anniversary, a
  // milestone, a moment or special day marked every year, or a
  // meeting. Reads "oros-together-data" directly (works with the app
  // CLOSED) and asks together/core.js (loaded by index.html, the SAME
  // file the app runs) for the rows of today, filtered by the synced
  // prefs.notify; from prefs.hour on (default 09:00). Discreet
  // relationships show initials. Key "day-<ymd>": one per day, the
  // inbox dedup keeps a second device quiet.
  function togetherCheckTick() {
    var Core = window.TogetherCore;
    if (!Core) return;
    var raw;
    try { raw = JSON.parse(localStorage.getItem(Core.STORAGE_KEY)); } catch (e) { return; }
    if (window.TogetherHouse) raw = window.TogetherHouse.withShared(raw);   // shared relationships (BR-HH wave 7d)
    if (!raw || !Array.isArray(raw.rels) || !raw.rels.length) return;
    var data = Core.normalize(raw);
    if (new Date().getHours() < data.prefs.hour) return;
    var N = window.orosNotifs;
    if (!(N && typeof N.emit === "function")) return;
    var idx = {};
    try { idx = Core.contactIndex(JSON.parse(localStorage.getItem("oros-contacts-data"))); } catch (e) {}
    var lang = window.orosLang || "en";
    var rows = Core.dayRows(data, idx, sysYmd(), lang, { notify: true });
    if (!rows.length) return;
    var title = window.t("app.together");
    if (title === "app.together") title = "Together";   // missing-key fallback
    N.emit({
      ns: "together",
      key: "day-" + sysYmd(),
      type: "reminder",
      title: title,
      body: rows.slice(0, 3).map(function (r) { return r.title; }).join(" · ") + (rows.length > 3 ? " …" : ""),
      deepLink: "together:" + rows[0].rel
    });
  }
  var togetherLastTick = 0;
  function togetherCheckTickThrottled() {
    var now = Date.now();
    if (now - togetherLastTick < 60000) return;
    togetherLastTick = now;
    togetherCheckTick();
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
    var txt = W.reminderText(due, data.prefs, state.lang);
    N.emit({
      ns: "water",
      key: due.key,
      type: "reminder",
      title: txt.title,
      body: txt.body,
      deepLink: "system:open:water"
    });
  }

  // Habits — per-habit reminder time (Habits wave 4). Reads
  // "oros-habits-data" directly (works with the app CLOSED) and asks
  // habits/core.js (loaded by index.html, the SAME file the app, the
  // Calendar feed and Today run) which habits are due: from the time
  // on for 4 hours, on a day the habit still needs (not done, not
  // skipped; fixed weekdays only on their days; "X per week / month"
  // only while the period is not met). One notification per habit and
  // day; the key ("r-<id>-<ymd>") is the same on every device (inbox
  // dedup) and in phone.js reminderRows (the Android app rings it with
  // orOS closed). Honest limit: orOS closed without the Android app =
  // nothing fires; more than 4 hours late = dropped, not caught up.
  var habitsLastTick = 0;
  function habitsCheckTickThrottled() {
    var now = Date.now();
    if (now - habitsLastTick < 60000) return;
    habitsLastTick = now;
    habitsCheckTick();
  }
  function habitsCheckTick() {
    var HCore = window.OrosHabitsCore, N = window.orosNotifs;
    if (!HCore || typeof HCore.dueReminders !== "function") return;   // stale bundle — silent
    if (!(N && typeof N.emit === "function")) return;
    var raw;
    try { raw = JSON.parse(localStorage.getItem("oros-habits-data")); } catch (e) { return; }
    if (!raw || !Array.isArray(raw.habits) || !Array.isArray(raw.comps)) return;
    var due = HCore.dueReminders(raw, Date.now());
    if (!due.length) return;
    var title = window.t("app.habits");
    if (title === "app.habits") title = "Habits";       // missing-key fallback
    due.forEach(function (r) {
      N.emit({
        ns: "habits",
        key: r.key,
        type: "reminder",
        title: title,
        body: tr("rem.habit", { name: String(r.name).slice(0, 120) }),
        deepLink: "habits:0"
      });
    });
  }

  // Flashcards — daily study reminder (Flashcards wave 4, OFF by
  // default: the app's Settings turn it on, per device). The cards and
  // their schedule live on the orOS disk, so the app writes a small
  // summary to the device-local key oros-flashcards-due after each
  // rebuild; flashcards/due.js (loaded by index.html, the SAME file
  // Today runs) reads it with oros-flashcards-rem and says when to
  // remind: from the chosen time on, once a day, while cards wait.
  // Key "study-<ymd>" = one notification a day.
  var flashcardsLastTick = 0;
  function flashcardsCheckTickThrottled() {
    var now = Date.now();
    if (now - flashcardsLastTick < 60000) return;
    flashcardsLastTick = now;
    flashcardsCheckTick();
  }
  function flashcardsCheckTick() {
    var D = window.FlashcardsDue, N = window.orosNotifs;
    if (!D || typeof D.reminderDue !== "function") return;   // stale bundle: silent
    if (!(N && typeof N.emit === "function")) return;
    var rem, sum;
    try { rem = localStorage.getItem(D.REM_KEY); sum = localStorage.getItem(D.KEY); } catch (e) { return; }
    if (!rem) return;                                        // never switched on
    var due = D.reminderDue(D.read(sum), rem, Date.now());
    if (!due) return;
    var txt = D.reminderText(due.n, state.lang);
    N.emit({ ns: "flashcards", key: due.key, type: "reminder", title: txt.title, body: txt.body, deepLink: "system:open:flashcards" });
  }

  // Typing Tutor — daily practice reminder (Typing Tutor wave 2, OFF by
  // default: the app's Settings turn it on, per device, device-local
  // oros-typing-rem {on, at}). typing/due.js (loaded by index.html, the
  // SAME file Today and Habits run) reads the synced oros-typing-data
  // and says when: from the chosen time on, once a day (key
  // "practice-<ymd>"), while today's minutes are under the daily goal.
  var typingLastTick = 0;
  function typingCheckTickThrottled() {
    var now = Date.now();
    if (now - typingLastTick < 60000) return;
    typingLastTick = now;
    typingCheckTick();
  }
  function typingCheckTick() {
    var D = window.TypingDue, N = window.orosNotifs;
    if (!D || typeof D.reminderDue !== "function") return;   // stale bundle: silent
    if (!(N && typeof N.emit === "function")) return;
    var rem, raw;
    try { rem = localStorage.getItem(D.REM_KEY); raw = localStorage.getItem(D.KEY); } catch (e) { return; }
    if (!rem) return;                                        // never switched on
    var due = D.reminderDue(D.read(raw), rem, Date.now());
    if (!due) return;
    var txt = D.reminderText(due.n, due.g, state.lang);
    N.emit({ ns: "typing", key: due.key, type: "reminder", title: txt.title, body: txt.body, deepLink: "system:open:typing" });
  }

  // Timesheet (Wave 3) — the shell reads "oros-timesheet-data" with
  // timesheet/core.js (loaded by index.html, the SAME file the app
  // runs) and never writes it. Two things come from that read:
  //   · a top-bar chip while a timer runs (elapsed H:MM; click opens
  //     Timesheet), painted by the 1/s clock tick;
  //   · one "forgot to stop it?" notification per running entry once
  //     it passes core.FORGOT_MS (same threshold as the app banner).
  // The text is re-read at most every 5 s, or at once when the app
  // frame writes it (storage event), and parsed only when it changed.
  // Starting/stopping from the keyboard (Ctrl+Alt+Shift+T) goes
  // through the app (live push or a one-shot flag + open), so the
  // data has one writer and the sync rules stay the app's.
  var tsRaw = null, tsRun = null, tsReadAt = 0;
  window.addEventListener("storage", function (e) {
    var C = window.orosTimesheetCore;
    if (C && e.key === C.STORAGE_KEY) tsReadAt = 0;
  });
  function timesheetRunning() {
    var C = window.orosTimesheetCore;
    if (!C || typeof C.parse !== "function") return null;
    var now = Date.now();
    if (now - tsReadAt < 5000) return tsRun;
    tsReadAt = now;
    var raw = null;
    try { raw = localStorage.getItem(C.STORAGE_KEY); } catch (e) { return tsRun; }
    if (raw === tsRaw) return tsRun;
    tsRaw = raw;
    tsRun = null;
    var d = raw ? C.parse(raw) : null;          // unreadable → no chip (the app keeps the rescue copy)
    var x = d ? C.running(d)[0] : null;
    if (x) {
      var p = C.project(d, x.p);
      tsRun = { id: x.id, s: x.s, name: p ? p.name : "" };
    }
    return tsRun;
  }

  function timesheetTrayTick() {
    var bar = document.querySelector(".bar-right");
    if (!bar) return;
    var run = timesheetRunning();
    var chip = document.getElementById("ts-tray-chip");
    if (!run) { if (chip) chip.remove(); tsTrayClosePop(); timesheetIdleTick(null); return; }
    if (!chip) {
      chip = document.createElement("button");
      chip.id = "ts-tray-chip";
      chip.type = "button";
      chip.innerHTML = ICONS.timesheet + '<span class="ts-time"></span>';
      chip.addEventListener("click", function (e) {
        e.stopPropagation();
        tsTrayTogglePop();            // Wave 46: a small timer menu (Stop, Open)
      });
      bar.insertBefore(chip, document.getElementById("btn-lang"));
    }
    var C = window.orosTimesheetCore;
    timesheetIdleTick(run);
    chip.classList.toggle("ts-away", tsIdlePending(run).length > 0);
    var txt = C.fmtDur(Date.now() - run.s);
    var span = chip.lastChild;
    if (span.textContent !== txt) span.textContent = txt;
    var since = new Date(run.s);
    var hm = String(since.getHours()).padStart(2, "0") + ":" + String(since.getMinutes()).padStart(2, "0");
    var title = window.t("ts.tray.title")
      .replace("{p}", run.name || window.t("ts.tray.noproj"))
      .replace("{t}", hm).replace("{d}", txt);
    if (chip.title !== title) {
      chip.title = title;                       // .title / aria-label: plain text, never HTML
      chip.setAttribute("aria-label", title);
    }
  }

  var tsLastTick = 0;
  function timesheetCheckTickThrottled() {
    var now = Date.now();
    if (now - tsLastTick < 60000) return;
    tsLastTick = now;
    timesheetCheckTick();
  }
  function timesheetCheckTick() {
    var C = window.orosTimesheetCore, N = window.orosNotifs;
    if (!C || !(N && typeof N.emit === "function")) return;
    var run = timesheetRunning();
    if (!run || Date.now() - run.s < C.FORGOT_MS) return;
    // The app shows its own banner while it is the open app.
    if (state.running && state.running.id === "timesheet" && !document.hidden) return;
    var title = window.t("app.timesheet");
    if (title === "app.timesheet") title = "Timesheet";
    N.emit({
      ns: "timesheet",
      key: "forgot-" + run.id,
      type: "reminder",
      title: title,
      body: window.t("ts.forgot.body").replace("{d}", C.fmtDur(Date.now() - run.s)),
      deepLink: "system:open:timesheet"
    });
  }

  // Maps — the parking reminder (maps/tools.js "I parked here").
  // Device-local record { lat, lon, at, until, note } in
  // oros-maps-parking: the car is where this device is. One notice
  // per parking (key "park-<at>"); it comes with Maps closed too.
  var parkLastTick = 0;
  function parkCheckTickThrottled() {
    var now = Date.now();
    if (now - parkLastTick < 60000) return;
    parkLastTick = now;
    parkCheckTick();
  }
  function parkCheckTick() {
    var N = window.orosNotifs;
    if (!(N && typeof N.emit === "function")) return;
    var p = null;
    try { p = JSON.parse(localStorage.getItem("oros-maps-parking") || "null"); } catch (e) { p = null; }
    if (!p || typeof p !== "object") return;
    var at = +p.at, until = +p.until;
    if (!(at > 0) || !(until > at) || Date.now() < until) return;
    var title = window.t("maps.park.title");
    if (title === "maps.park.title") title = "Parking";
    var note = typeof p.note === "string" ? p.note.slice(0, 120) : "";
    var body = window.t("maps.park.body");
    if (body === "maps.park.body") body = "Time to go back to the car.";
    N.emit({
      ns: "maps",
      key: "park-" + Math.round(at),
      type: "reminder",
      title: title,
      body: note ? body + " " + note : body,
      deepLink: "maps:park"
    });
  }

  // ---- Timesheet Wave 46: the timer menu + time away ----
  // The chip opens a small menu: what runs, Stop, Open Timesheet, and,
  // when time away was noticed, Keep / Take it out / Take out and stop.
  // Every change to the data goes through the app (a live push when
  // Timesheet is the open app, else a one-shot sessionStorage flag +
  // open), so the synced slice keeps one writer. Time away is noticed
  // here because the shell is always running: the Idle Detection API
  // (Chromium, only after the user allowed it in Timesheet's Settings)
  // and, on any browser, a gap in this 1 s tick (the device slept or
  // the browser paused orOS). Periods go to the device-local
  // C.IDLE_KEY; prefs come from C.IDLE_PREFS_KEY (both never synced).
  var TS_POP_ID = "ts-tray-pop";
  var tsIdle = { det: null, ctl: null, starting: false, from: 0, last: 0, perm: "", permAt: 0, prefs: null, prefsAt: 0 };
  function tsIdlePrefs() {
    var C = window.orosTimesheetCore, now = Date.now();
    if (!C || typeof C.idlePrefs !== "function") return { on: 0, min: 10 };
    if (!tsIdle.prefs || now - tsIdle.prefsAt > 5000) {
      var raw = null;
      try { raw = localStorage.getItem(C.IDLE_PREFS_KEY); } catch (e) {}
      tsIdle.prefs = C.idlePrefs(raw);
      tsIdle.prefsAt = now;
    }
    return tsIdle.prefs;
  }
  function tsIdleList() {
    var C = window.orosTimesheetCore, raw = null;
    try { raw = localStorage.getItem(C.IDLE_KEY); } catch (e) {}
    return C.idleRead(raw);
  }
  function tsIdleSave(list) {
    var C = window.orosTimesheetCore;
    try {
      if (list.length) localStorage.setItem(C.IDLE_KEY, JSON.stringify(list));
      else localStorage.removeItem(C.IDLE_KEY);
    } catch (e) {}
  }
  // periods of the entry that runs now (the app checks the rest)
  function tsIdlePending(run) {
    var C = window.orosTimesheetCore;
    if (!run || !C || typeof C.idleRead !== "function") return [];
    return tsIdleList().filter(function (r) { return r.id === run.id && r.from >= run.s; });
  }
  function tsIdleNoted(run, from, to) {
    var C = window.orosTimesheetCore, p = tsIdlePrefs();
    var rec = C.idleRecord(run, from, to, p.min * 60000);
    if (!rec) return;
    tsIdleSave(C.idlePut(tsIdleList(), rec));
    if (appLive("timesheet")) {
      var f = appFrameOf("timesheet");
      try {
        if (f && f.contentWindow && typeof f.contentWindow.__orosTimesheetIdle === "function") {
          f.contentWindow.__orosTimesheetIdle();
          return;
        }
      } catch (e) {}
    }
    if (!tsTrayPop()) tsTrayTogglePop();
  }
  function tsIdleStopDetector() {
    if (tsIdle.ctl) { try { tsIdle.ctl.abort(); } catch (e) {} }
    tsIdle.det = null; tsIdle.ctl = null; tsIdle.from = 0;
  }
  function tsIdleStartDetector() {
    if (tsIdle.det || tsIdle.starting || typeof window.IdleDetector !== "function") return;
    var now = Date.now();
    if (tsIdle.perm !== "granted") {
      // ask the browser what the user allowed, at most once a minute
      if (now - tsIdle.permAt < 60000 || !navigator.permissions || typeof navigator.permissions.query !== "function") return;
      tsIdle.permAt = now;
      navigator.permissions.query({ name: "idle-detection" }).then(function (s) { tsIdle.perm = s && s.state; }, function () {});
      return;
    }
    tsIdle.starting = true;
    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    var det;
    try { det = new window.IdleDetector(); } catch (e) { tsIdle.starting = false; tsIdle.perm = ""; return; }
    det.addEventListener("change", function () {
      if (det.userState === "idle") {
        if (!tsIdle.from) tsIdle.from = Date.now() - 60000;   // idle since the threshold
      } else if (tsIdle.from) {
        var from = tsIdle.from;
        tsIdle.from = 0;
        tsReadAt = 0;
        var run = timesheetRunning();
        if (run) tsIdleNoted(run, from, Date.now());
      }
    });
    det.start({ threshold: 60000, signal: ctl ? ctl.signal : undefined }).then(function () {
      tsIdle.starting = false;
      tsIdle.det = det; tsIdle.ctl = ctl;
    }, function () {
      tsIdle.starting = false;
      tsIdle.perm = "";
    });
  }
  function timesheetIdleTick(run) {
    var C = window.orosTimesheetCore;
    if (!C || typeof C.idleRecord !== "function") return;
    var p = tsIdlePrefs(), now = Date.now();
    if (!run || !p.on) {
      tsIdle.last = 0;
      if (tsIdle.det || tsIdle.ctl) tsIdleStopDetector();
      return;
    }
    // a gap in the 1 s clock: the device slept or the browser paused us
    if (tsIdle.last && now - tsIdle.last >= Math.max(p.min * 60000, 120000)) tsIdleNoted(run, tsIdle.last, now);
    tsIdle.last = now;
    tsIdleStartDetector();
  }
  // Commands for the app: a live push, else a one-shot flag + open.
  function tsAppDo(liveFn, args, flagKey, flagVal) {
    if (appLive("timesheet")) {
      var f = appFrameOf("timesheet");
      try {
        if (f && f.contentWindow && typeof f.contentWindow[liveFn] === "function") {
          f.contentWindow[liveFn].apply(null, args);
          tsReadAt = 0;
          return;
        }
      } catch (e) {}
    }
    if (!flagKey) return;
    try { sessionStorage.setItem(flagKey, flagVal); } catch (e) {}
    openAppById("timesheet");
  }
  function tsTrayPop() { return document.getElementById(TS_POP_ID); }
  function tsTrayClosePop() { var p = tsTrayPop(); if (p) p.remove(); }
  var tsPopWired = false;
  function tsTrayTogglePop() {
    if (tsTrayPop()) { tsTrayClosePop(); return; }
    var run = timesheetRunning(), C = window.orosTimesheetCore;
    if (!run || !C) { openAppById("timesheet"); return; }
    if (!tsPopWired) {
      tsPopWired = true;
      document.addEventListener("click", function (e) {
        var pop = tsTrayPop();
        if (!pop || pop.contains(e.target)) return;
        var chip = document.getElementById("ts-tray-chip");
        if (chip && chip.contains(e.target)) return;
        tsTrayClosePop();
      });
      document.addEventListener("keydown", function (e) { if (e.key === "Escape") tsTrayClosePop(); });
    }
    var pop = document.createElement("div");
    pop.id = TS_POP_ID;
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", window.t("ts.pop.label"));
    var head = document.createElement("div");
    head.className = "ts-pop-head";
    var since = new Date(run.s);
    head.textContent = (run.name || window.t("ts.tray.noproj")) + " · " + C.fmtDur(Date.now() - run.s) +
      " (" + tr("ts.pop.since", { time: String(since.getHours()).padStart(2, "0") + ":" + String(since.getMinutes()).padStart(2, "0") }) + ")";
    pop.appendChild(head);
    function mk(label, cls, fn) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "ts-pop-btn" + (cls ? " " + cls : "");
      b.textContent = label;
      b.addEventListener("click", function () { tsTrayClosePop(); fn(); });
      return b;
    }
    var away = tsIdlePending(run)[0] || null;
    if (away) {
      var p = document.createElement("p");
      p.className = "ts-pop-away";
      p.textContent = tr("ts.pop.away", { from: C.hhmm(away.from), to: C.hhmm(away.to), dur: C.fmtDur(away.to - away.from) });
      pop.appendChild(p);
      var ar = document.createElement("div");
      ar.className = "ts-pop-row";
      ar.appendChild(mk(window.t("ts.pop.keep"), "", function () {
        tsIdleSave(window.orosTimesheetCore.idleDrop(tsIdleList(), away));
        if (state.running && state.running.id === "timesheet") tsAppDo("__orosTimesheetIdle", [], "", "");
      }));
      ar.appendChild(mk(window.t("ts.pop.out"), "", function () {
        tsAppDo("__orosTimesheetIdle", ["discard", away], "oros-timesheet-idle-act", JSON.stringify({ mode: "discard", id: away.id, from: away.from, to: away.to }));
      }));
      ar.appendChild(mk(window.t("ts.pop.outstop"), "", function () {
        tsAppDo("__orosTimesheetIdle", ["stop", away], "oros-timesheet-idle-act", JSON.stringify({ mode: "stop", id: away.id, from: away.from, to: away.to }));
      }));
      pop.appendChild(ar);
    }
    var row = document.createElement("div");
    row.className = "ts-pop-row";
    row.appendChild(mk(window.t("ts.pop.stop"), "primary", function () {
      tsAppDo("__orosTimesheetStop", [run.id], "oros-timesheet-toggle", "stop:" + run.id);
    }));
    row.appendChild(mk(window.t("ts.pop.open"), "", function () {
      if (!(state.running && state.running.id === "timesheet")) openAppById("timesheet");
    }));
    pop.appendChild(row);
    document.body.appendChild(pop);
    var first = pop.querySelector("button");
    if (first) { try { first.focus({ preventScroll: true }); } catch (e) {} }
  }

  // Ctrl+Alt+Shift+T: start or stop the Timesheet timer.
  function scTimesheetToggle() {
    var has = false;
    for (var k = 0; k < state.apps.length; k++) if (state.apps[k].id === "timesheet") has = true;
    if (!has) return;
    if (appLive("timesheet")) {
      var f = appFrameOf("timesheet");
      try {
        if (f && f.contentWindow && typeof f.contentWindow.__orosTimesheetToggle === "function") {
          f.contentWindow.__orosTimesheetToggle();
          tsReadAt = 0;
          return;
        }
      } catch (e) {}
    }
    try { sessionStorage.setItem("oros-timesheet-toggle", "1"); } catch (e) {}
    openAppById("timesheet");
  }

  // Baby — feed-gap and daily-medicine reminders (off by default;
  // the app's Settings turn them on, per device: oros-baby-rem is
  // device-local). The RULE lives in baby/core.js, loaded by
  // index.html before this file and shared with the app and its
  // tests; the shell owns timing + emission over oros-baby-data, so
  // it works with the app closed. Dedupe keys: one per feed gap
  // (child + last feed id), one per medicine day. A stale
  // index.html without core.js → silent.
  var babyLastTick = 0;
  function babyCheckTickThrottled() {
    var now = Date.now();
    if (now - babyLastTick < 60000) return;
    babyLastTick = now;
    babyCheckTick();
  }
  function babyCheckTick() {
    var B = window.orosBabyCore, N = window.orosNotifs;
    if (!B || typeof B.reminderDue !== "function") return;
    if (!(N && typeof N.emit === "function")) return;
    var rem = null, data = null;
    try { rem = B.readRem(JSON.parse(localStorage.getItem(B.REM_KEY) || "null")); } catch (e) { return; }
    if (!B.remOn(rem)) return;
    try { data = B.parse(localStorage.getItem(B.STORAGE_KEY)); } catch (e) { return; }
    if (!data) return;                     // unreadable: the app keeps the rescue copy
    // Shared Babies (BR-HH wave 7b): the household copies' mirror, one
    // data with every child, so a shared child reminds once.
    var BH = window.orosBabyHouse;
    if (BH && typeof BH.union === "function") {
      var sets = [];
      try { sets = BH.readMirror(JSON.parse(localStorage.getItem(BH.MIRROR_KEY) || "null")); } catch (e) {}
      if (sets.length) data = BH.union(data, sets);
    }
    var now = Date.now(), lang = state.lang === "el" ? "el" : "en";
    B.reminderDue(data, rem, now).forEach(function (due) {
      var txt = B.reminderText(due, rem, lang, now);
      N.emit({
        ns: "baby",
        key: due.key,
        type: "reminder",
        title: txt.title,
        body: txt.body,
        deepLink: "system:open:baby"
      });
    });
  }

  // Media Shelf — daily reading reminder (off by default; the app's
  // More menu turns it on, per device: oros-shelf-rem is device-local).
  // The RULE lives in shelf/feed.js (window.OrosShelfFeed), loaded by
  // index.html before this file and shared with the Calendar and the
  // tests; the shell owns timing + emission over oros-shelf-data, so it
  // works with the app closed. Dedupe key: one per day ("read-<ymd>").
  // A stale index.html without feed.js → silent.
  var shelfLastTick = 0;
  function shelfCheckTickThrottled() {
    var now = Date.now();
    if (now - shelfLastTick < 60000) return;
    shelfLastTick = now;
    shelfCheckTick();
  }
  function shelfCheckTick() {
    var F = window.OrosShelfFeed, N = window.orosNotifs;
    if (!F || typeof F.reminderDue !== "function") return;
    if (!(N && typeof N.emit === "function")) return;
    var rem = null, data = null;
    try { rem = F.readRem(JSON.parse(localStorage.getItem(F.REM_KEY) || "null")); } catch (e) { return; }
    if (!rem.on) return;
    try { data = JSON.parse(localStorage.getItem("oros-shelf-data") || "null"); } catch (e) { return; }
    var due = F.reminderDue(data, rem, new Date());
    if (!due) return;
    var txt = F.reminderText(due, state.lang);
    N.emit({
      ns: "shelf",
      key: due.key,
      type: "reminder",
      title: txt.title,
      body: txt.body,
      deepLink: "shelf:item:" + due.item
    });
  }

  // One-Sentence Diary — evening reminder (off by default; Diary
  // settings turn it on, per device: oros-diary-prefs is device-local).
  // The RULE lives in diary/core.js (window.DiaryCore), loaded by
  // index.html before this file and shared with the tests; the shell
  // owns timing + emission over oros-diary-data, so it works with the
  // app closed. Only on days with no line yet. Dedupe key: one per day
  // ("write-<ymd>"). A stale index.html without the core → silent.
  var diaryLastTick = 0;
  function diaryCheckTickThrottled() {
    var now = Date.now();
    if (now - diaryLastTick < 60000) return;
    diaryLastTick = now;
    diaryCheckTick();
  }
  function diaryCheckTick() {
    var D = window.DiaryCore, N = window.orosNotifs;
    if (!D || typeof D.reminderDue !== "function") return;
    if (!(N && typeof N.emit === "function")) return;
    var prefs = null, data = null;
    try { prefs = D.readPrefs(JSON.parse(localStorage.getItem(D.PREFS_KEY) || "null")); } catch (e) { return; }
    if (!prefs.rem.on) return;
    try { data = D.mergeDiary(JSON.parse(localStorage.getItem("oros-diary-data") || "null"), null); } catch (e) { return; }
    var now = new Date(), due = D.reminderDue(data, prefs, now);
    if (!due) return;
    var txt = D.reminderText(state.lang, D.streak(data, due.day));
    N.emit({
      ns: "diary",
      key: due.key,
      type: "reminder",
      title: txt.title,
      body: txt.body,
      deepLink: "diary:day:" + due.day
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

  // Download page (Chris 2026-10-15): every way to get orOS (Portable,
  // bootable USB, single apps, APKs). A plain menu row, always there,
  // never a popup (free-forever rule: no nag messages). Not in a
  // single app's window.
  function renderGetRow(host) {
    if (SOLO) return;
    var section = document.createElement("div");
    section.className = "install-section";
    var row = document.createElement("button");
    row.className = "menu-item install-row";
    row.innerHTML = DOWNLOAD_ICON_SVG + "<span>" + escapeHtml(window.t("menu.getOros")) + "</span>";
    row.addEventListener("click", function () {
      closeMenu();
      var page = "download/" + (window.orosLang === "el" ? "?lang=el" : "");
      // In the orOS Android app: the default browser, a normal tab (its
      // APK downloads never finish in the app's in-app tab, and a new
      // window from the app closed it; Chris 2026-10-15). Older apps
      // without BrowserActivity open the page in the app instead.
      var S = window.orosSolo;
      var pkg = S && S.apkPkgOf ? S.apkPkgOf(window, "oros") : "";
      if (!pkg && window.orosPhone && window.orosPhone.available && window.orosPhone.available()) pkg = "online.useoros.twa";
      if (pkg && S && S.browserHref && /Android/i.test(navigator.userAgent || "")) { location.href = S.browserHref("https://useoros.online/" + page, pkg); return; }
      window.open(page, "_blank", "noopener");
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
        splashDone();
        helpBtnRefresh();
        openFromLaunchParam();
        searchFromLaunchParam();
        deliverShare();
        if (SOLO) soloStart();
        // Files from the system's "Open with" (fileopen.js) wait for the app list.
        if (window.orosFileOpen) window.orosFileOpen.ready();
        if (window.orosPhone && window.orosPhone.ready) window.orosPhone.ready();
        // "#quick-ask" from outside orOS (quickmenu.js, AS-OUT).
        if (window.orosQuick && window.orosQuick.ready && !SOLO) window.orosQuick.ready();
        pwSaveReady();     // Passwords PW-AF3: a login handed over before the list was in
        quickReady();
      })
      .catch(function () {
        state.apps = [];
        renderMenu();
        splashDone();
        helpBtnRefresh();
      });
  }

  // BOOT-S1: the desktop is drawn; the boot splash (index.html) may go
  // once the page's scripts have all run. Two frames so the menu and
  // the clock are painted before the splash fades. BOOT-L1: then the
  // late bundle starts loading.
  function splashDone() {
    var go = function () {
      try { if (window.__orosSplashDone) window.__orosSplashDone(); } catch (e) {}
      setTimeout(lateStart, 0);
    };
    if (typeof requestAnimationFrame !== "function") return go();
    requestAnimationFrame(function () { requestAnimationFrame(go); });
  }

  // BOOT-L1: the late bundle. The app files the shell needs only in the
  // background (the clock engines' cores, the household, Newsletter,
  // Podcasts, Music, Links and Sticky Notes hosts, mail notices, the
  // Today summary) sit in index.html inside <template data-oros-late>:
  // inert markup, so they are no longer fetched and run before the
  // desktop is drawn (first visit on a slow phone 9.5 -> ~5 s). Once
  // the desktop is up they are added in document order (async=false:
  // fetched in parallel, run in order). Until then:
  //   - the clock engines wait (enginesMayRun), so no reminder is lost;
  //   - an app that is opened waits (openApp), so its bridges to the
  //     shell (window.parent.orosHousehold, orosLinks, ...) are there;
  //   - phone.js and webpush.js hand nothing to Android or the push
  //     relay, so a reminder list is never sent without its cores.
  // window.orosLate: { done, when(fn) }; "oros:late-ready" on window.
  // No template (an older cached index.html with plain tags) = done at
  // once. A file that fails or hangs never holds the rest: each one
  // settles on load or error, and LATE_MAX_MS marks the bundle done.
  var LATE_MAX_MS = 20000, LATE_GRACE_MS = 30000, LATE_SPLASH_MS = 12000;
  var late = { done: false, started: false, waiters: [] };
  window.orosLate = {
    get done() { return late.done; },
    when: function (fn) { lateWhen(fn); }
  };
  function lateWhen(fn) {
    if (late.done) { try { fn(); } catch (e) {} return; }
    late.waiters.push(fn);
  }
  function lateFinish() {
    if (late.done) return;
    late.done = true;
    var list = late.waiters; late.waiters = [];
    list.forEach(function (fn) { try { fn(); } catch (e) {} });
    try { window.dispatchEvent(new Event("oros:late-ready")); } catch (e) {}
  }
  function lateSources() {
    var out = [];
    Array.prototype.forEach.call(document.querySelectorAll("template[data-oros-late]"), function (tpl) {
      var root = tpl.content || tpl;
      Array.prototype.forEach.call(root.querySelectorAll("script[src]"), function (s) {
        var src = s.getAttribute("src");
        if (src && !/^(https?:)?\/\//i.test(src)) out.push(src);     // same origin only
      });
    });
    return out;
  }
  function lateStart() {
    if (late.started) return;
    if (document.readyState === "loading") {           // the last template is not parsed yet
      document.addEventListener("DOMContentLoaded", lateStart);
      return;
    }
    // Not while the splash fades (a busy main thread makes it stutter
    // and keeps it up longer); at most LATE_SPLASH_MS for it.
    if (document.getElementById("oro-splash") && Date.now() - shellBootAt < LATE_SPLASH_MS) {
      setTimeout(lateStart, 50);
      return;
    }
    late.started = true;
    var list = lateSources(), left = list.length;
    if (!left) return lateFinish();
    setTimeout(lateFinish, LATE_MAX_MS);
    var settle = function () { if (--left === 0) lateFinish(); };
    list.forEach(function (src) {
      var s = document.createElement("script");
      s.src = src;
      s.async = false;
      s.onload = s.onerror = settle;
      document.body.appendChild(s);
    });
  }
  // Once the bundle is in: the cards and badges that read it repaint.
  lateWhen(function () {
    if (SOLO) { try { soloBadgeTick(); } catch (e) {} }
    try { if (window.orosWidgets && window.orosWidgets.refresh) window.orosWidgets.refresh(); } catch (e) {}
  });

  // Launch shortcuts (manifest "shortcuts", long-press on the app
  // icon): "/?open=<id>" opens that app once the list is loaded. The
  // id must match a registered internal app, so a crafted link can only
  // open what the menu already offers. The parameter is stripped right
  // away (other parameters stay), so a reload or the update broker's
  // reload lands on the desktop instead of reopening the app.
  // Direct app links (useoros.online/notes/…): every app page that
  // finds itself outside the shell (top window) replaces itself with
  // "/?open=<id>&app-at=<its own ?query#hash>" (DL-1, the inline
  // snippet at the top of each <app>/index.html). app-at is handed
  // back to the app frame unchanged so links like /maps/?q=… or
  // /netizen/#c=… still land where they pointed. It may only be a
  // query and/or fragment of the app's own page (starts with "?" or
  // "#", no control characters, bounded), so it can never point the
  // frame at another path or scheme.
  function launchAppSuffix(v) {
    v = String(v || "");
    if (!v || v.length > 8000) return "";
    if (v.charAt(0) !== "?" && v.charAt(0) !== "#") return "";
    if (/[\u0000-\u001f\u007f]/.test(v)) return "";
    return v;
  }
  function openFromLaunchParam() {
    var params, id, i, at;
    try { params = new URLSearchParams(window.location.search); } catch (e) { return; }
    id = params.get("open");
    at = launchAppSuffix(params.get("app-at"));
    params.delete("app-at");
    if (!id) return;
    params.delete("open");
    try {
      var qs = params.toString();
      window.history.replaceState(null, "", window.location.pathname + (qs ? "?" + qs : "") + window.location.hash);
    } catch (e) {}
    for (i = 0; i < state.apps.length; i++) {
      if (state.apps[i].id === id && state.apps[i].type !== "external") {
        if (at) openApp(state.apps[i], at);
        else openAppById(id);
        return;
      }
    }
  }

  // "oros <words>" in the browser's address bar (Send to orOS add-on,
  // extension/): "/?search=<words>" opens the menu with the words in
  // its search field, as if typed. Stripped at once like ?open=.
  function searchFromLaunchParam() {
    var params, q;
    try { params = new URLSearchParams(window.location.search); } catch (e) { return; }
    if (!params.has("search")) return;
    q = String(params.get("search") || "").replace(/\s+/g, " ").trim().slice(0, 200);
    params.delete("search");
    try {
      var qs = params.toString();
      window.history.replaceState(null, "", window.location.pathname + (qs ? "?" + qs : "") + window.location.hash);
    } catch (e) {}
    if (!q || state.running) return;
    openMenuSearch();
    var inp = document.querySelector("#app-menu .menu-search input");
    if (!inp) return;
    inp.value = q;
    inp.dispatchEvent(new Event("input"));
  }

  // Collapsible menu categories — SESSION state only (A74): every
  // boot starts with ALL categories collapsed, and so does every app
  // launch (Chris 2026-10-12, menuReset below; this map lives in
  // memory, not in storage). Keys are the LOWERCASE category (SH-B11). Never synced,
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
  // Back to the boot state (all categories collapsed, empty search)
  // whenever an app opens, so the next menu open starts clean.
  function menuReset() {
    if (!menuQuery && !Object.keys(menuCatOpen).length) return;
    menuCatOpen = {};
    menuQuery = "";
    clearTimeout(searchTimer);
    searchToken++;                       // drop a data search in flight
    searchRes = { q: null, groups: null, pending: false, at: 0 };
    renderMenu();
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
    if (appLive(appId)) {
      closeMenu();
      menuReset();
      appShow(appId);   // multitasking: a hidden app comes to the front first
      var f = appFrameOf(appId);
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

  // Passwords PW-AF3: a login to save, from the orOS browser add-on
  // (window message, below) or the orOS Android app (phone.js). Kept
  // in memory only, never in a URL or storage, for 10 minutes at most;
  // Passwords takes it with __orosTakePwSave() when it starts, or at
  // once through its __orosPwPoke() when it already runs. Passwords
  // opens it in the editor; nothing is saved without Save there.
  var pwSaves = [];
  window.__orosPwSave = function (item) {
    if (!item || typeof item !== "object" || typeof item.pw !== "string" || !item.pw || item.pw.length > 4096) return false;
    var it = {
      url: typeof item.url === "string" ? item.url.slice(0, 2048) : "",
      app: typeof item.app === "string" ? item.app.slice(0, 255) : "",
      user: typeof item.user === "string" ? item.user.slice(0, 512) : "",
      pw: item.pw,
      title: typeof item.title === "string" ? item.title.slice(0, 200) : ""
    };
    var now = Date.now();
    pwSaves = pwSaves.filter(function (x) { return now - x.at < 600000; });
    if (pwSaves.length >= 10) pwSaves.shift();
    pwSaves.push({ at: now, it: it });
    if (!state.apps.length) { pwSaveWait = true; return true; }   // the app list is not in yet: loadApps calls pwSaveReady
    if (!pwSaveOpen()) { pwSaves.pop(); return false; }
    return true;
  };
  var pwSaveWait = false;
  function pwSaveReady() {
    if (!pwSaveWait) return;
    pwSaveWait = false;
    if (pwSaves.length && !pwSaveOpen()) pwSaves = [];
  }
  function pwSaveOpen() {
    var app = null;
    for (var i = 0; i < state.apps.length; i++) if (state.apps[i].id === "passwords") { app = state.apps[i]; break; }
    if (!app) return false;
    if (appLive("passwords")) {
      closeMenu();
      menuReset();
      appShow("passwords");
      var f = appFrameOf("passwords");
      try {
        if (f && f.contentWindow && typeof f.contentWindow.__orosPwPoke === "function") f.contentWindow.__orosPwPoke();
      } catch (e) {}
    } else {
      openApp(app);
    }
    return true;
  }
  window.__orosTakePwSave = function () {
    var now = Date.now(), out = pwSaves.filter(function (x) { return now - x.at < 600000; }).map(function (x) { return x.it; });
    pwSaves = [];
    return out;
  };
  // The add-on (extension/background.js) posts from its isolated world
  // into this window; only this window itself counts, and the answer
  // tells it the login arrived.
  window.addEventListener("message", function (ev) {
    if (ev.source !== window || ev.origin !== location.origin) return;
    var d = ev.data;
    if (!d || typeof d !== "object" || d.type !== "oros-pw-save" || typeof d.n !== "string") return;
    var ok = window.__orosPwSave(d.item);
    try { window.postMessage({ type: "oros-pw-saved", n: d.n, ok: !!ok }, location.origin); } catch (e) {}
  });

  // This computer (orOS USB, Files' computer.js). The orOS launcher on
  // the stick (or the disk orOS is installed on) serves the computer's
  // own folders and disks under /__oros/fs/ (oros-portable
  // launcher/computerfs.go). When it answers, the page tells the System
  // extension (data-oros-computer-files="1"), which then asks for disks
  // to open in Files with the DOM event "oros-files-open" (detail
  // "/disks/<name>" or "/home/…") instead of a file:// window. A USB
  // stick plugged in brings a notification with "Open"; nothing opens
  // by itself. Only on the launcher's own address (localhost).
  (function computerFiles() {
    var host = location.hostname;
    if (typeof fetch !== "function" || (host !== "localhost" && host !== "127.0.0.1")) return;
    function get(what) {
      return fetch("/__oros/fs/" + what, { credentials: "same-origin", headers: { "X-Oros-FS": "1" } })
        .then(function (r) {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.json();
        });
    }
    function openInFiles(path) {
      if (typeof window.__orosOpenAt === "function") window.__orosOpenAt("files", { computer: path });
    }
    document.addEventListener("oros-files-open", function (e) {
      var p = e && e.detail;
      if (typeof p !== "string" || !/^\/(home|disks)(\/|$)/.test(p) || p.indexOf("..") !== -1) return;
      openInFiles(p);
    });
    var known = null;           // device paths of the USB volumes seen so far
    function notifyStick(v) {
      var N = window.orosNotifs;
      if (!N || typeof N.transient !== "function") return;
      var name = v.label || v.model || String(v.path || "").replace("/dev/", "");
      N.transient({
        ns: "system",
        title: window.t("pc.stick").replace("{name}", name),
        body: window.t("pc.stickBody"),
        action: {
          label: window.t("pc.open"),
          fn: function () {
            fetch("/__oros/fs/op", {
              method: "POST",
              credentials: "same-origin",
              headers: { "X-Oros-FS": "1", "Content-Type": "application/json" },
              body: JSON.stringify({ op: "mount", dev: v.path })
            }).then(function (r) { return r.ok ? r.json() : null; }).then(function (r) {
              openInFiles(r && typeof r.path === "string" ? r.path : "/");
            }, function () { openInFiles("/"); });
          }
        }
      });
    }
    function poll() {
      if (document.visibilityState === "hidden") { setTimeout(poll, 5000); return; }
      get("disks").then(function (vols) {
        var now = {};
        (vols || []).forEach(function (v) { if (v && v.usb && v.path) now[v.path] = v; });
        if (known) {
          Object.keys(now).forEach(function (k) { if (!known[k]) notifyStick(now[k]); });
        }
        known = now;
      }, function () {}).then(function () { setTimeout(poll, 5000); });
    }
    var polling = false;
    function start() {
      return get("roots").then(function (r) {
        if (!r || !r.home) return;
        document.documentElement.setAttribute("data-oros-computer-files", "1");
        // Wave 4: open and save dialogs work in this computer's folders.
        if (window.orosPcDialog) window.orosPcDialog.enable();
        if (!polling) { polling = true; poll(); }
      }, function () {});
    }
    function stop() {
      document.documentElement.removeAttribute("data-oros-computer-files");
      if (window.orosPcDialog && window.orosPcDialog.disable) window.orosPcDialog.disable();
    }
    // orOS Portable and the desktop apps ask before showing this
    // computer's files (launcher fsconsent.go): GET consent says on, off
    // or ask (once per computer), fixed = orOS USB, always on. A launcher
    // without consent (404 without "state") is an older orOS USB one.
    function setConsent(on) {
      return fetch("/__oros/fs/consent", {
        method: "POST",
        credentials: "same-origin",
        headers: { "X-Oros-FS": "1", "Content-Type": "application/json" },
        body: JSON.stringify({ on: !!on })
      }).then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      }).then(function (c) {
        state.pcFiles = { state: c && c.state === "on" ? "on" : "off", fixed: !!(c && c.fixed) };
        if (state.pcFiles.state === "on") start(); else stop();
        settingsNotify();
      });
    }
    function askConsent() {
      if (document.getElementById("pcfiles-dialog")) return;
      var dlg = document.createElement("dialog");
      dlg.id = "pcfiles-dialog";
      dlg.style.cssText =
        "border:1px solid var(--border);border-radius:12px;" +
        "background:var(--panel-bg);color:var(--text);padding:20px;" +
        "width:min(380px,calc(100vw - 32px));";
      var h = document.createElement("h3");
      h.style.cssText = "margin:0 0 6px;font-size:14px;";
      h.textContent = window.t("pc.ask.title");
      dlg.appendChild(h);
      var p = document.createElement("p");
      p.style.cssText = "font-size:12.5px;line-height:1.5;color:var(--text-dim);margin:0 0 14px;";
      p.textContent = window.t("pc.ask.body");
      dlg.appendChild(p);
      var row = document.createElement("div");
      row.style.cssText = "display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;";
      function button(label, primary, on) {
        var b = document.createElement("button");
        b.type = "button";
        b.style.cssText = primary
          ? "border:1px solid var(--accent);border-radius:8px;background:var(--accent);color:#fff;padding:7px 14px;font-size:12.5px;font-weight:600;cursor:pointer;"
          : "border:1px solid var(--border);border-radius:8px;background:transparent;color:var(--text-dim);padding:7px 14px;font-size:12.5px;font-weight:600;cursor:pointer;";
        b.textContent = label;
        b.addEventListener("click", function () {
          dlg.close();
          setConsent(on).catch(function () {});
        });
        row.appendChild(b);
        return b;
      }
      button(window.t("pc.ask.no"), false, false);
      var yes = button(window.t("pc.ask.yes"), true, true);
      dlg.appendChild(row);
      // Esc or a closed window: no answer, so orOS asks again next time.
      dlg.addEventListener("close", function () { dlg.remove(); });
      document.body.appendChild(dlg);
      dlg.showModal();
      yes.focus();
    }
    window.__orosPcFilesSet = function (on) { return setConsent(on).catch(function () {}); };
    get("consent").then(function (c) {
      var st = c && (c.state === "on" || c.state === "off" || c.state === "ask") ? c.state : "on";
      state.pcFiles = { state: st, fixed: !!(c && c.fixed) };
      settingsNotify();
      if (st === "on") start();
      else if (st === "ask") askConsent();
    }, function () { start(); });
  })();

  // Users on one computer or stick (Bible Part II "Users on one device";
  // oros-portable launcher users.go). The orOS Portable / orOS USB
  // launcher gives each user a browser profile of their own and shows a
  // sign-in window before orOS; this page only asks it who is signed in
  // (GET /__oros/users/state) and signs out. Settings › Users manages the
  // users through window.orosUsers.call. Only on the launcher's own
  // address; elsewhere (useoros.online, the Android apps) state stays
  // null and Settings explains browser profiles instead.
  var usersLeaving = false;
  (function users() {
    var host = location.hostname;
    if (typeof fetch !== "function" || (host !== "localhost" && host !== "127.0.0.1") || location.port !== "47800") return;
    var NAMES = /^(state|sizes|signout|add|remove|password|rename|owner|guest|vault)$/;
    function call(name, body) {
      if (!NAMES.test(String(name))) return Promise.resolve({ error: "bad" });
      var opt = body === undefined
        ? { credentials: "same-origin" }
        : { method: "POST", credentials: "same-origin",
            headers: { "Content-Type": "application/json", "X-Oros-Users": "1" }, body: JSON.stringify(body) };
      return fetch("/__oros/users/" + name, opt).then(function (r) {
        return r.json().catch(function () { return { error: "bad" }; });
      }).then(function (j) { return j && typeof j === "object" ? j : { error: "bad" }; },
        function () { return { error: "network" }; });
    }
    function refresh() {
      return call("state").then(function (s) {
        // An older launcher answers 404 (no users): state stays null.
        state.users = s && typeof s.enabled === "boolean" ? s : null;
        settingsNotify();
        return state.users;
      });
    }
    // What this device has not synced yet goes up first (connected,
    // unlocked, online; at most 15 s), as before a device reset.
    function lastPush() {
      var S = window.orosSync;
      if (!S || !navigator.onLine || !S.isConnected() || !S.hasPassphrase() || !S.isDirty()) return Promise.resolve();
      return Promise.race([
        S.push().catch(function () { return null; }),
        new Promise(function (res) { setTimeout(res, 15000); })
      ]);
    }
    function closeHint() {
      if (document.getElementById("users-close-dialog")) return;
      var dlg = document.createElement("dialog");
      dlg.id = "users-close-dialog";
      dlg.style.cssText =
        "border:1px solid var(--border);border-radius:12px;background:var(--panel-bg);color:var(--text);" +
        "padding:20px;width:min(360px,calc(100vw - 32px));";
      var p = document.createElement("p");
      p.style.cssText = "font-size:13px;line-height:1.5;margin:0;";
      p.textContent = window.t("users.closeNow");
      dlg.appendChild(p);
      dlg.addEventListener("cancel", function (e) { e.preventDefault(); });
      document.body.appendChild(dlg);
      dlg.showModal();
    }
    var leaving = null;
    function signOut() {
      if (leaving) return leaving;
      if (!state.users || !state.users.enabled || !state.users.me) return Promise.resolve(false);
      scToast("dim", window.t("users.signingOut"));
      leaving = lastPush().then(function () { return call("signout", {}); }).then(function (r) {
        if (!r || !r.ok) {
          leaving = null;
          scToast("err", window.t("users.signOutFail"));
          return false;
        }
        usersLeaving = true;   // the beforeunload guard stays silent
        // orOS Portable's and orOS USB's System extension closes every
        // window of this user's browser; elsewhere the window tries to
        // close itself and otherwise asks to be closed.
        if (document.documentElement.hasAttribute("data-oros-signout")) {
          document.dispatchEvent(new CustomEvent("oros-signout"));
        } else {
          try { window.close(); } catch (e) {}
        }
        setTimeout(closeHint, 2500);
        return true;
      });
      return leaving;
    }
    window.orosUsers = {
      v: 1,
      state: function () { return state.users || null; },
      refresh: refresh,
      call: function (name, body) {
        return call(name, body).then(function (r) { return refresh().then(function () { return r; }); });
      },
      signOut: signOut
    };
    refresh().then(function (s) {
      // The tray's "Switch user" opens orOS with #oros-signout.
      if (location.hash === "#oros-signout") {
        try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
        if (s && s.enabled) signOut();
      }
    });
  })();

  // "Send to orOS" (bookmarklet, Android Share → orOS, a future
  // browser add-on): /?share-url=…&share-title=…&share-text=…
  // stages a NEW bookmark. The params leave the address bar at boot
  // (a reload must not add it twice); Bookmarks then opens its add
  // dialog prefilled and nothing is saved until the user presses
  // Save. Only http(s) links pass. Android's share sheet often puts
  // the link inside share-text, so the first http(s) URL there counts.
  // share-pick=1 (the system's share sheet, sw.js; AS-OUT): the
  // "Send to…" sheet opens instead, so the user picks the app
  // (Bookmarks, the Assistant, Notes…); text without a link comes too.
  var SHARE_KEYS = ["share-url", "share-title", "share-text", "share-pick"];
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
    var pick = p.get("share-pick") === "1";
    if (pick && !/^https?:\/\//i.test(link)) {
      var body = (text || title).slice(0, 20000);
      return body ? { pick: true, kind: "text", data: { title: text ? title.slice(0, 200) : "", text: body } } : { bad: true };
    }
    if (!title && text) title = text.replace(link, "").replace(/\s+/g, " ").trim();
    try {
      var ok = new URL(link);
      if (ok.protocol !== "http:" && ok.protocol !== "https:") return { bad: true };
      link = ok.href;
    } catch (e) { return { bad: true }; }
    if (link.length > 2048) return { bad: true };
    if (pick) return { pick: true, kind: "link", data: { url: link, title: title.slice(0, 256) } };
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
  // "Send to someone" (share/): share/kinds.js + share/send.js load on
  // first use, never at boot. Apps call window.parent.orosShare.open(
  // { kind, data, text? }). The receiving page's "Add to my orOS"
  // leaves the item in sessionStorage "oros-share-in" (this tab only)
  // and opens /?share-in=1; the flag leaves the address bar at boot
  // and the item goes to its app once the app list is in.
  var shareLoad = null;
  function shareModule() {
    if (window.__orosShareImpl) return Promise.resolve(window.__orosShareImpl);
    if (!shareLoad) {
      window.__orosShareV = APP_VERSION;
      var load = function (src) {
        return new Promise(function (resolve, reject) {
          var s = document.createElement("script");
          s.src = src + "?v=" + APP_VERSION;
          s.onload = resolve;
          s.onerror = reject;
          document.head.appendChild(s);
        });
      };
      shareLoad = load("share/kinds.js").then(function () { return load("share/relay.js"); })
        .then(function () { return load("share/album.js"); })
        .then(function () { return load("share/send.js"); })
        .then(function () {
          if (!window.__orosShareImpl) throw new Error("share module missing");
          return window.__orosShareImpl;
        });
      shareLoad.catch(function () { shareLoad = null; });
    }
    return shareLoad;
  }
  function shareLoadFail() {
    notifySys("dim", window.t("share.loadfail"));
  }
  window.orosShare = {
    open: function (opts) {
      shareModule().then(function (m) { m.open(opts); }, shareLoadFail);
    },
    // "My shared links" (links with an expiry, share/out.js): Settings › Privacy.
    links: function () {
      shareModule().then(function (m) { m.links(); }, shareLoadFail);
    }
  };
  // The list of links with an expiry travels as sync slice "shareOut"
  // (share/out.js, loaded at boot for its merge) so a link can be taken
  // back from any device.
  function registerShareOutSlice() {
    var O = window.OrosShareOut;
    if (!O || !window.orosSync || typeof window.orosSync.registerSlice !== "function") return;
    window.orosSync.registerSlice("shareOut", function () {
      var o = O.read();
      return Object.keys(o.items).length ? o : null;
    }, function (data) {
      if (!data) return;
      try { localStorage.setItem(O.KEY, JSON.stringify(O.norm(data))); } catch (e) {}
    }, O.KEY, O.merge);
  }
  // "Send to…" (send/, BR-SEND): one app hands an item to another app
  // of this orOS. send/core.js + send/sheet.js load on first use, never
  // at boot. Apps call window.parent.orosSend.open({ kind, data }) with
  // kind text | link | items | table (+ share: the item for "Send to
  // someone", which stays window.orosShare); the sheet lists the
  // installed apps that take it and calls __orosOpenAt with that app's
  // own prefill target. Nothing is stored or synced.
  var sendLoad = null;
  function sendModule() {
    if (window.__orosSendImpl) return Promise.resolve(window.__orosSendImpl);
    if (!sendLoad) {
      var load = function (src) {
        return new Promise(function (resolve, reject) {
          var s = document.createElement("script");
          s.src = src + "?v=" + APP_VERSION;
          s.onload = resolve;
          s.onerror = reject;
          document.head.appendChild(s);
        });
      };
      sendLoad = load("send/core.js").then(function () { return load("send/sheet.js"); })
        .then(function () {
          if (!window.__orosSendImpl) throw new Error("send module missing");
          return window.__orosSendImpl;
        });
      sendLoad.catch(function () { sendLoad = null; });
    }
    return sendLoad;
  }
  window.orosSend = {
    open: function (opts) {
      var self = state.running ? state.running.id : "";
      var apps = window.orosAssistInstalled();
      var from = "";
      apps.forEach(function (a) { if (a.id === self) from = a.name; });
      sendModule().then(function (m) {
        m.open(opts, {
          apps: apps, self: self, from: from, openAt: window.__orosOpenAt,
          share: function (item) { window.orosShare.open(item); },
          icon: function (id) {
            for (var i = 0; i < state.apps.length; i++) {
              var a = state.apps[i];
              if (a.id === id && ICONS[a.icon]) {
                var sp = document.createElement("span");
                sp.innerHTML = ICONS[a.icon];          // static shell icon, not data
                return sp.firstChild;
              }
            }
            return null;
          }
        });
      }, function () {
        notifySys("dim", window.t("share.loadfail"));
      });
    }
  };
  var pendingShareIn = false;
  (function () {
    try {
      var u = new URL(window.location.href);
      if (!u.searchParams.has("share-in")) return;
      u.searchParams.delete("share-in");
      window.history.replaceState(window.history.state, "", u.pathname + u.search + u.hash);
      pendingShareIn = true;
    } catch (e) {}
  })();
  function deliverShareIn() {
    if (!pendingShareIn || !state.apps.length) return;
    pendingShareIn = false;
    shareModule().then(function (m) {
      m.deliver({
        hasApp: function (id) {
          for (var i = 0; i < state.apps.length; i++) {
            if (state.apps[i].id === id && state.apps[i].type === "internal") return true;
          }
          return false;
        }
      });
    }, function () {});
  }

  function deliverShare() {
    deliverShareIn();
    if (!pendingShare || !state.apps.length) return;
    var s = pendingShare;
    pendingShare = null;
    if (s.pick) { window.orosSend.open({ kind: s.kind, data: s.data }); return; }
    window.__orosOpenAt("bookmarks", { add: { url: s.url, title: s.title } });
  }

  function openSearchHit(id, hit) {
    closeMenu();
    menuReset();
    var p = searchProvider(id);
    if (p && typeof p.open === "function") {
      try { p.open(hit.target, window); return; } catch (e) {}
    }
    window.__orosOpenAt(id, hit.target);
  }

  // AI Assistant (assistant/): the same data search, run for the apps
  // the assistant's own permissions allow (it asks the user before any
  // result leaves the device). Read-only like every provider; the
  // menu's per-app switches are the menu's, not the assistant's.
  window.orosAssistApps = function () {
    return searchApps().map(function (a) {
      var k = "app." + a.id, v = window.t(k);
      return { id: a.id, name: v === k ? (a.name || a.id) : v, sensitive: a.searchOff === true };
    });
  };
  // Today summary (today/host.js): the installed apps with their shown
  // names and apps.json "today" files, the version for ?v=, the
  // language and each app's static shell icon (shell markup, not data).
  window.orosTodayEnv = {
    apps: function () {
      return state.apps.filter(function (a) { return a && a.type === "internal"; }).map(function (a) {
        var k = "app." + a.id, v = window.t(k);
        return { id: a.id, name: v === k ? (a.name || a.id) : v, type: a.type, url: a.url,
                 today: Array.isArray(a.today) ? a.today.slice() : a.today, searchOff: a.searchOff === true };
      });
    },
    version: APP_VERSION,
    lang: function () { return langBase(); },
    icon: function (id) {
      for (var i = 0; i < state.apps.length; i++) {
        if (state.apps[i].id === id) return ICONS[state.apps[i].icon] || "";
      }
      return "";
    }
  };
  // Sticky Notes (stickies/host.js): language, whether the app is
  // installed (the module is inert until then), the running app, the
  // way back to the desktop and a plain app open.
  window.orosStickiesEnv = {
    lang: function () { return langBase(); },
    registered: function () {
      for (var i = 0; i < state.apps.length; i++) if (state.apps[i] && state.apps[i].id === "stickies") return true;
      return false;
    },
    running: function () { return !!state.running; },
    home: function () { if (state.running) returnToDesktop(); },
    open: function (id) { openAppById(id); }
  };
  window.orosAssistSearch = function (q, ids, opts) {
    var S = window.orosSearch;
    if (!S) return Promise.resolve([]);
    var allow = {};
    (Array.isArray(ids) ? ids : []).forEach(function (id) { allow[String(id)] = true; });
    var apps = searchApps().filter(function (a) { return allow[a.id]; });
    if (!apps.length) return Promise.resolve([]);
    if (!searchReader) searchReader = S.makeReader(localStorage);
    // { all: true } (AS-LBL): every item of the allowed apps, unscored,
    // for the Assistant's label filter ("events without a label").
    if (opts && opts.all) {
      return S.load(apps, APP_VERSION).then(function () {
        var ctx = { q: "", words: [], fold: S.fold, lang: langBase(), code: state.lang, limit: 1000, readJSON: searchReader };
        var out = [];
        (window.orosSearchProviders || []).forEach(function (pv) {
          if (!pv || typeof pv.search !== "function" || !allow[pv.id]) return;
          var list;
          try { list = pv.search(ctx); } catch (e) { list = null; }
          if (!Array.isArray(list)) return;
          var hits = list.map(S.cleanHit).filter(Boolean).slice(0, 1000);
          if (hits.length) out.push({ id: pv.id, total: hits.length, hits: hits });
        });
        return JSON.parse(JSON.stringify(out));
      });
    }
    return S.load(apps, APP_VERSION).then(function () {
      return S.run(window.orosSearchProviders, String(q || ""), {
        lang: langBase(), code: state.lang, readJSON: searchReader,
        enabled: function (id) { return !!allow[id]; }
      });
    }).then(function (groups) {
      return JSON.parse(JSON.stringify(groups || []));
    });
  };
  // The Assistant's attached files (AS-ATT-MEM): base64, text read on
  // the device and PDF page counts, kept here in memory while orOS is
  // open, so an app opened from the Assistant (it takes the Assistant's
  // frame) does not lose them. Never stored, synced or exported; gone
  // when the tab closes. assistant.js owns what goes in. blob: files
  // for an app only (AS-DEV), as Files; rb: Layout's rebuild reports
  // for the Assistant's cards (AS-RB, written by layout.js).
  window.orosAssistAtt = { mem: {}, text: {}, pages: {}, blob: {}, rb: {} };
  window.orosAssistOpen = function (appId, target) {
    openSearchHit(String(appId || ""), { target: target === undefined ? null : target });
  };
  // Installed apps (id + shown name): the assistant offers an entry
  // card only for an app that is there (Part VI, AS-E).
  window.orosAssistInstalled = function () {
    return state.apps.filter(function (a) { return a && a.type !== "external"; }).map(function (a) {
      var k = "app." + a.id, v = window.t(k);
      return { id: a.id, name: v === k ? (a.name || a.id) : v };
    });
  };
  function hasApp(id) {
    for (var i = 0; i < state.apps.length; i++) if (state.apps[i].id === id) return true;
    return false;
  }
  // Ctrl+Alt+Shift+A and the menu search's "Ask the Assistant" row.
  function openAssistant(q) {
    if (!hasApp("assistant")) return;
    if (typeof q === "string" && q.trim()) {
      closeMenu();
      window.__orosOpenAt("assistant", { ask: q.trim().slice(0, 2000) });
    } else openAppById("assistant");
  }

  // ---------- Command bar (commands/, strategy §10, BR-CMD) ----------
  // One line of words → one action in an app, on the device, no AI
  // (commands/core.js). Two ways in: the first row of the menu search
  // (Enter runs it) and a small bar over any app (commands/bar.js):
  // Ctrl+K, and Ctrl+Alt+Shift+K everywhere (SC_DEFS). Notes and Wiki
  // keep their own Ctrl+K (their search). Both files load on first use,
  // with the engines they borrow (Calendar quick add, Calculator, Unit
  // Converter, "Send to an app"); a missing engine only drops its kind.
  // The last commands run are a device-local list (CMD_HIST_KEY, never
  // synced) that the bar shows while its field is empty.
  var CMD_OWN_CTRLK = { notes: true, wiki: true };
  var CMD_HIST_KEY = "oros-cmd-history", CMD_HIST_MAX = 12;
  var cmdLoad = null;
  function cmdModule() {
    if (window.OrosCommands && window.orosCmdBar && window.OrosCalQuick && window.CalcCore && window.UnitsCore &&
        window.OrosSendCore && window.PwCore) return Promise.resolve(window.OrosCommands);
    if (!cmdLoad) {
      var load = function (src) {
        return new Promise(function (resolve, reject) {
          var sc = document.createElement("script");
          sc.src = src + "?v=" + APP_VERSION;
          sc.onload = resolve;
          sc.onerror = reject;
          document.head.appendChild(sc);
        });
      };
      var opt = function (src) { return load(src).catch(function () {}); };
      cmdLoad = Promise.all([
        cmdPack(),
        window.OrosCalQuick ? null : load("calendar/quickadd.js"),
        window.OrosCommands ? null : load("commands/core.js"),
        window.orosCmdBar ? null : load("commands/bar.js"),
        window.CalcCore ? null : opt("calculator/core.js"),
        window.UnitsCore ? null : opt("units/core.js"),
        window.OrosSendCore ? null : opt("send/core.js"),
        window.PwCore ? null : opt("passwords/pwcore.js")
      ]).then(function () {
        if (!window.OrosCommands || !window.orosCmdBar) throw new Error("commands missing");
        return window.OrosCommands;
      });
      cmdLoad.catch(function () { cmdLoad = null; });
    }
    return cmdLoad;
  }
  // The command bar's own pack (i18n/<code>/commands.js) for a pack
  // language; nothing for English and Greek. A missing pack = English.
  function cmdPack() {
    var I = window.orosI18n;
    return I ? new Promise(function (r) { I.ensure(state.lang, "commands", r); }) : null;
  }
  function cmdAppName(id) {
    var k = "app." + id, v = window.t(k);
    if (v !== k) return v;
    for (var i = 0; i < state.apps.length; i++) if (state.apps[i].id === id) return state.apps[i].name || id;
    return id;
  }
  function cmdToday() {
    var d = new Date(), m = d.getMonth() + 1, dd = d.getDate();
    return d.getFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (dd < 10 ? "0" : "") + dd;
  }
  // The installed apps with the names a user may type (EN, EL, apps.json).
  function cmdApps() {
    return state.apps.filter(function (a) { return a && a.type === "internal"; }).map(function (a) {
      var names = [a.name, cmdAppName(a.id)];
      var TR = window.OROS_TRANSLATIONS || {}, en = TR.en, el = TR.el;
      if (en && en["app." + a.id]) names.push(en["app." + a.id]);
      if (el && el["app." + a.id]) names.push(el["app." + a.id]);
      return { id: a.id, names: names };
    });
  }
  // null until commands/ is loaded (the menu row then waits for it).
  function cmdParse(q) {
    var C = window.OrosCommands;
    if (!C) return null;
    var U = window.UnitsCore, rates = null;
    if (U) { try { rates = U.storedRates(JSON.parse(localStorage.getItem(U.RATES_KEY))); } catch (e) { rates = null; } }
    return C.parse(q, { today: cmdToday(), apps: cmdApps(), cal: window.OrosCalQuick, lang: langBase(),
                        calc: window.CalcCore, units: U, rates: rates, send: window.OrosSendCore,
                        lockOn: !!(window.orosLock && window.orosLock.isOn()), pw: window.PwCore });
  }
  function cmdHistory() {
    try {
      var l = JSON.parse(localStorage.getItem(CMD_HIST_KEY));
      return Array.isArray(l) ? l.filter(function (x) { return typeof x === "string" && x && x.length <= 300; }).slice(0, CMD_HIST_MAX) : [];
    } catch (e) { return []; }
  }
  function cmdRemember(q) {
    q = String(q || "").replace(/\s+/g, " ").trim();
    if (!q || q.length > 300) return;
    var l = cmdHistory().filter(function (x) { return x !== q; });
    l.unshift(q);
    try { localStorage.setItem(CMD_HIST_KEY, JSON.stringify(l.slice(0, CMD_HIST_MAX))); } catch (e) {}
  }
  function cmdForget() { try { localStorage.removeItem(CMD_HIST_KEY); } catch (e) {} }
  function cmdRun(cmd, q) {
    var C = window.OrosCommands;
    var c = C ? C.call(cmd, state.lang) : null;
    if (!c) return;
    if (typeof q === "string") cmdRemember(q);
    closeMenu();
    if (c.fn === "openAppById") { openAppById(c.args[0]); return; }
    if (c.fn === "copy") {
      // K6: a password is never repeated in the note.
      var txt = String(c.args[0]), secret = c.args[1] === true;
      var done = function () { notifySys("dim", secret ? tr("cmd.copiedSecret") : tr("cmd.copied", { text: txt })); };
      var fail = function () { notifySys("dim", secret ? tr("cmd.copyFailed") : txt); };
      try { navigator.clipboard.writeText(txt).then(done, fail); }
      catch (e) { fail(); }
      return;
    }
    if (c.fn === "setting") { cmdSetting(c.args[0], c.args[1], C.describe(cmd, state.lang).verb); return; }
    var f = window[c.fn];
    if (typeof f === "function") f.apply(window, c.args);
  }
  // K5: a setting by words, through the same setters as Settings. The
  // note comes first: with notifications off it would not show.
  function cmdSetting(name, value, text) {
    var N = window.orosNotifs;
    if (name === "theme") { setThemeUser(value); notifySys("dim", text); return; }
    if (name === "lock") { if (window.orosLock && window.orosLock.isOn()) window.orosLock.lock(); return; }
    if (!N || typeof N.setSetting !== "function") return;
    if (name === "notifs") {
      if (!value) notifySys("dim", text);
      N.setSetting("enabled", !!value);
      if (value) notifySys("dim", text);
      return;
    }
    if (name === "quiet") {
      var qh = N.getSetting("quietHours", {}) || {};
      var next = {};
      Object.keys(qh).forEach(function (k) { next[k] = qh[k]; });
      next.enabled = !!value;
      N.setSetting("quietHours", next);
      notifySys("dim", text);
    }
  }
  function cmdMatchApps(q) {
    var fq = menuFold(q.trim());
    if (!fq) return [];
    var hits = [];
    cmdApps().forEach(function (a) {
      var best = -1;
      a.names.forEach(function (n) {
        var at = menuFold(String(n || "")).indexOf(fq);
        if (at >= 0 && (best < 0 || at < best)) best = at;
      });
      if (best >= 0) hits.push({ id: a.id, name: cmdAppName(a.id), at: best });
    });
    hits.sort(function (x, y) { return x.at - y.at || x.name.localeCompare(y.name); });
    return hits;
  }
  // "In your data" rows of the bar (Quick window): the universal
  // search over the apps switched on for search on this device (the
  // menu's "Search in" switches and Settings, searchEnabled), at most
  // 6 hits, opened like a menu hit.
  function cmdData(q) {
    var S = window.orosSearch;
    if (!S || S.parseQuery(q).join("").length < S.MIN_CHARS) return Promise.resolve([]);
    var apps = searchApps().filter(function (a) { return searchEnabled(a.id); });
    if (!apps.length) return Promise.resolve([]);
    var allow = {};
    apps.forEach(function (a) { allow[a.id] = true; });
    if (!searchReader) searchReader = S.makeReader(localStorage);
    return S.load(apps, APP_VERSION).then(function () {
      return S.run(window.orosSearchProviders, q, {
        lang: langBase(), code: state.lang, readJSON: searchReader,
        enabled: function (id) { return !!allow[id] && searchEnabled(id); }
      });
    }).then(function (groups) {
      return S.top(groups, 6, 3).map(function (x) {
        return { app: cmdAppName(x.id), title: x.hit.title, snippet: x.hit.snippet || "",
                 open: function () { openSearchHit(x.id, x.hit); } };
      });
    });
  }
  // "Add task" (Quick window): one task, written by To-Do itself at
  // once ({ now: true }: the Enter is the confirmation), with Undo.
  function cmdAddTask(q) {
    var text = String(q || "").replace(/\s+/g, " ").trim().slice(0, 300);
    if (!text) return;
    cmdRemember(text);
    window.__orosOpenAt("todo", { addItems: { now: true, from: window.t("cmd.quick"), items: [{ text: text }] } });
  }
  // "Today" rows of the empty Quick window: the Today summary
  // (today/host.js, its own apps and switches), late tasks first, then
  // today's rows; a row opens like a row of the Today app.
  function cmdTodayRows() {
    var T = window.orosToday;
    if (!T || typeof T.build !== "function") return Promise.resolve(null);
    return T.build().then(function (s) {
      var g = s && s.groups || {}, out = [];
      function add(r, late) {
        out.push({ title: r.title, time: r.time, text: r.text, late: late, app: cmdAppName(r.app),
                   open: function () { T.open(r.app, r.target); } });
      }
      (g.overdue || []).forEach(function (r) { add(r, true); });
      (g.today || []).forEach(function (r) { add(r, false); });
      return { rows: out, all: function () { openAppById("today"); } };
    });
  }
  function openCmdBar(text, opts) {
    if (SOLO) return;
    opts = opts || {};
    cmdModule().then(function () {
      closeMenu();
      window.orosCmdBar.open({
        lang: function () { return langBase(); },
        parse: cmdParse,
        describe: function (cmd) { return window.OrosCommands.describe(cmd, state.lang); },
        appName: cmdAppName,
        apps: cmdMatchApps,
        run: cmdRun,
        openApp: openAppById,
        history: cmdHistory,
        forget: cmdForget,
        ask: hasApp("assistant") ? function (q) { openAssistant(q); } : null,
        addTask: hasApp("todo") ? cmdAddTask : null,
        data: cmdData,
        today: opts.today && hasApp("today") ? cmdTodayRows : null,
        full: !!opts.full,
        closed: opts.closed || null
      }, text);
    }, function () {
      notifySys("dim", window.t("cmd.loadfail"));
    });
  }
  // The Android widget's command button (phone.js, ?phone-quick=cmd).
  window.__orosOpenCmdBar = function () { openCmdBar(); };

  // Quick window (QW, 4.x): "#quick[=text]" opens the bar at once (the
  // manifest shortcut, the phone's shortcut, tile and widget);
  // "#quick-win[=text]" is the desktop tray's own small window
  // (oros-portable): the bar fills the window, and dismissing it
  // (Escape, nothing run) closes the window. A row that ran leaves its
  // app open there. The fragment never reaches a server and leaves the
  // address bar at once. Behind the screen lock it waits for the unlock.
  var quickWant = null, quickAppsIn = false, quickWin = false;
  function quickTakeHash() {
    var h = "";
    try { h = String(window.location.hash || ""); } catch (e) { return null; }
    var m = /^#quick(-win)?(?:=([\s\S]*))?$/.exec(h);
    if (!m) return null;
    try { window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search); } catch (e) {}
    var t = "";
    try { t = decodeURIComponent((m[2] || "").replace(/\+/g, " ")); } catch (e) { t = ""; }
    t = t.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
    return { win: !!m[1], text: t };
  }
  function quickLaunch(w) {
    if (SOLO) return;
    var L = window.orosLock;
    if (L && L.isLocked && L.isLocked()) {
      var off = L.onChange(function () { if (!L.isLocked()) { off(); quickLaunch(w); } });
      return;
    }
    if (w.win) quickWin = true;
    if (window.orosCmdBar && window.orosCmdBar.isOpen()) return;
    openCmdBar(w.text, {
      full: quickWin && !state.running,
      today: true,
      closed: function (acted) {
        if (!quickWin || acted || state.running) return;
        try { window.close(); } catch (e) {}
      }
    });
  }
  // QW-C: the tray's small window sits in the middle of the screen at
  // its own size. The desktop launcher asks for that size and place,
  // but a browser that runs already (orOS open) ignores the request,
  // and on Linux the launcher does not know the screen, so the page
  // places its own window. Only a top window of its own (--app) can
  // move; in a tab the calls do nothing.
  function quickPlace() {
    if (window.top !== window) return;
    var W = 640, H = 460, s = window.screen;
    try {
      if (window.outerWidth !== W || window.outerHeight !== H) window.resizeTo(W, H);
      window.moveTo((s.availLeft || 0) + Math.max(0, Math.round((s.availWidth - W) / 2)),
        (s.availTop || 0) + Math.max(0, Math.round((s.availHeight - H) / 2)));
    } catch (e) {}
  }
  quickWant = quickTakeHash();
  if (quickWant && quickWant.win) quickPlace();
  window.addEventListener("hashchange", function () {
    var w = quickTakeHash();
    if (!w) return;
    if (quickAppsIn) quickLaunch(w); else quickWant = w;
  });
  function quickReady() {
    quickAppsIn = true;
    var w = quickWant;
    quickWant = null;
    if (w) quickLaunch(w);
  }
  // Ctrl+K (Cmd+K on a Mac), from the desktop or from inside an app.
  function cmdIsCtrlK(e) {
    return (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === "KeyK";
  }
  document.addEventListener("keydown", function (e) {
    if (!cmdIsCtrlK(e) || e.defaultPrevented) return;
    if (window.orosCmdBar && window.orosCmdBar.isOpen()) return;
    e.preventDefault();
    openCmdBar();
  });
  // Every app frame gets the listener (one today, more with M2).
  function cmdWireFrame(frame) {
    frame.addEventListener("load", function () {
      var w;
      try { w = frame.contentWindow; if (!w || !w.document) return; } catch (e) { return; }   // not same-origin
      w.addEventListener("keydown", function (e) {
        if (!cmdIsCtrlK(e)) return;
        if (state.running && CMD_OWN_CTRLK[state.running.id]) return;   // the app's own Ctrl+K
        e.preventDefault();
        e.stopImmediatePropagation();
        openCmdBar();
      }, true);
    });
  }
  appFrames().forEach(cmdWireFrame);

  // Phone, SMS, mail and map links inside an app frame (EXT-1). A
  // frame that follows a tel: link itself shows Chrome's error page in
  // the Android app instead of the dialer chooser, and the app is lost
  // until it is reopened. The shell hands such links to the top window,
  // where the browser passes them to the phone's apps.
  var EXT_SCHEME = /^(tel|sms|smsto|mailto|geo):/i;
  var extHandoffAt = 0;
  function extWireFrame(frame) {
    frame.addEventListener("load", function () {
      var w;
      try { w = frame.contentWindow; if (!w || !w.document) return; } catch (e) { return; }   // not same-origin
      w.addEventListener("click", function (e) {
        if (e.defaultPrevented || e.button !== 0) return;
        var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
        if (!a) return;
        var href = a.getAttribute("href") || "";
        if (!EXT_SCHEME.test(href)) return;
        e.preventDefault();
        extHandoffAt = Date.now();   // the unsaved-changes guard stays silent
        window.location.href = href;
      });
    });
  }
  appFrames().forEach(extWireFrame);
  appFrames().forEach(a11yWireFrame);

  // Ctrl+Alt+Shift+F: the menu opens with the cursor in the field,
  // from the desktop or from inside an app.
  function openMenuSearch() {
    var menu = document.getElementById("app-menu");
    closeNotifPanel();
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
    try { return d.toLocaleDateString(shLoc(), o); }
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
    function mkCatBtn(svg, title, fn) {
      var b = document.createElement("button");
      b.type = "button";
      b.innerHTML = svg;
      b.title = title;
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
      window.t("menu.expandall"),
      function () {
        state.apps.forEach(function (app) {
          menuCatOpen[String(app.category || "other").toLowerCase()] = true;
        });
        renderMenu();
      }));

    heading.appendChild(mkCatBtn(
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="7 11 12 6 17 11"/><polyline points="7 18 12 13 17 18"/></svg>',
      window.t("menu.collapseall"),
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

    // Command bar: when the line is a command, its row comes first
    // and Enter runs it (commands/core.js, loaded on the first query).
    var cmdHost = document.createElement("div");
    cmdHost.id = "menu-cmd";
    menu.insertBefore(cmdHost, heading);
    var menuCmd = null;
    function renderCmdRow() {
      cmdHost.textContent = "";
      menuCmd = null;
      var q = menuQuery.trim();
      if (!q || SOLO) return;
      if (!window.OrosCommands) {
        cmdModule().then(function () { if (cmdHost.isConnected && menuQuery.trim() === q) renderCmdRow(); }, function () {});
        return;
      }
      var cmd = cmdParse(q);
      if (!cmd || cmd.kind === "convert") return;     // conversions: the Unit Converter's own search row
      menuCmd = cmd;
      var d = window.OrosCommands.describe(cmd, state.lang);
      var b = document.createElement("button");
      b.type = "button";
      b.className = "menu-cmd";
      var v = document.createElement("span");
      v.className = "menu-cmd-verb";
      v.textContent = d.verb + (cmd.kind === "open" ? " " + cmdAppName(cmd.app) : "");
      b.appendChild(v);
      if (d.detail) {
        var dt = document.createElement("span");
        dt.className = "menu-cmd-detail";
        dt.textContent = d.detail;
        b.appendChild(dt);
      }
      if (cmd.kind !== "open") {
        var ap = document.createElement("span");
        ap.className = "menu-cmd-app";
        ap.textContent = d.hint || "→ " + cmdAppName(cmd.app);
        b.appendChild(ap);
      }
      b.addEventListener("click", function () { cmdRun(cmd, q); });
      b.addEventListener("keydown", function (e) {
        if (e.key === "ArrowDown") { var n = menuNavItems(); if (n[1]) { e.preventDefault(); n[1].focus(); } }
        else if (e.key === "ArrowUp") { e.preventDefault(); search.focus(); }
      });
      cmdHost.appendChild(b);
    }

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
      renderCmdRow();
      renderAppList();
      scheduleDataSearch();
    });
    search.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        if (menuCmd) {
          e.preventDefault();
          cmdRun(menuCmd, menuQuery);
        } else if (firstMatch) {
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
        renderCmdRow();
        renderAppList();
        scheduleDataSearch();
      }
    });

    // Arrow keys walk the matching apps, then the data hits; Up from
    // the first one goes back to the field.
    function menuNavItems() {
      if (!menuQuery.trim()) return [];
      return Array.prototype.slice.call(
        menu.querySelectorAll("#menu-cmd button, #menu-apps .menu-item, #menu-results button"));
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
            lang: langBase(), code: state.lang, readJSON: searchReader,
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

    // Last row under the data results: hand the query to the AI
    // Assistant (it only fills the assistant's message box; nothing is
    // sent until the user presses Send there).
    function appendAsk(host, q) {
      if (!hasApp("assistant")) return;
      var b = document.createElement("button");
      b.type = "button";
      b.className = "menu-hit-more menu-ask";
      b.textContent = window.t("search.ask").replace("{q}", q.length > 60 ? q.slice(0, 59) + "…" : q);
      b.addEventListener("click", function () { openAssistant(q); });
      host.appendChild(b);
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
        appendAsk(host, q);
        return;
      }
      var groups = (searchRes.groups || []).slice();
      if (!groups.length) {
        var none = document.createElement("div");
        none.className = "menu-empty menu-search-none";
        none.textContent = window.t("search.none");
        host.appendChild(none);
        appendAsk(host, q);
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
      appendAsk(host, q);
    }

    renderCmdRow();
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
      // Menu apps (launcher.js 1.3.0): hidden apps leave the list but
      // a search still finds them (and search hits, deep links, the
      // desktop and the Dock still open them).
      var q = menuFold(menuQuery.trim());
      var L = window.orosLauncher;
      var hideOk = !!(L && typeof L.menuHidden === "function");
      var hiddenCount = 0;
      var cats = {}, catRaw = {}, catAll = {};
      state.apps.forEach(function (app) {
        if (hideOk && L.menuHidden(app.id)) {
          hiddenCount++;
          if (!q) return;
        }
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
      var catLocale = shLoc();

      // A74: while searching, keep only the matching apps (by the shown
      // name, the apps.json name, the id or the category label) and
      // show their categories open; the count becomes the match count.
      if (!q && hiddenCount === state.apps.length) {
        var allHid = document.createElement("div");
        allHid.className = "menu-empty menu-search-none";
        allHid.textContent = window.t("menu.hidden.all");
        appsHost.appendChild(allHid);
      }
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
          btn.className = "menu-item" + (mtActive() && appLive(app.id) ? " mt-open" : "");
          btn.setAttribute("data-app", app.id);
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

      // Hidden apps: one quiet row under the list, into Settings › Menu.
      if (!q && hiddenCount) {
        var hidBtn = document.createElement("button");
        hidBtn.type = "button";
        hidBtn.className = "menu-hidden-row";
        hidBtn.textContent = (hiddenCount === 1 ? window.t("menu.hidden.one")
          : window.t("menu.hidden.some").replace("{n}", hiddenCount)) +
          " · " + window.t("menu.hidden.choose");
        hidBtn.addEventListener("click", function () {
          closeMenu();
          if (window.orosSettings) window.orosSettings.open("menu");
        });
        appsHost.appendChild(hidBtn);
      }
    }
    }   // renderAppList

    // System settings live in the Settings app (settings/, System).
    // The Dock section stays here only for a launcher.js without the
    // prefs API the Settings app needs.
    if (window.orosLauncher && typeof window.orosLauncher.setPref !== "function") {
      window.orosLauncher.renderSettings(menu);
    }
    renderInstallRow(menu);
    renderGetRow(menu);
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

    // Screen lock on: lock now (lock.js), right under Settings.
    if (window.orosLock && window.orosLock.isOn()) {
      var lockRow = document.createElement("div");
      lockRow.className = "install-section";
      var lockBtn = document.createElement("button");
      lockBtn.className = "menu-item install-row";
      lockBtn.innerHTML = '<span class="app-ico">' + ICONS.lock + '</span>' +
                          '<span>' + escapeHtml(window.t("menu.lock")) + '</span>';
      lockBtn.addEventListener("click", function () {
        closeMenu();
        window.orosLock.lock();
      });
      lockRow.appendChild(lockBtn);
      menu.appendChild(lockRow);
    }

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
    var was = state.skin;
    state.skin = id;
    localStorage.setItem("oros-skin", state.skin);
    applySkin();
    maybeFollowSkin(was, id);  // the skin's wallpaper, unless the user picked their own
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
    if (!findWallpaper(id)) return;
    if (wpPic()) {                     // the device picture gives way to the pick
      if (id === "custom") return;     // "Mine" = the picture: already on
      wpPicClear();
      if (state.wallpaper === id) { applyWallpaper(); renderMenu(); return; }
    }
    if (state.wallpaper === id) return;
    state.wallpaper = id;
    localStorage.setItem("oros-wallpaper", state.wallpaper);
    applyWallpaper();
    noteLocalChange();
    renderMenu();
  }

  function skinTitle(id) {
    // Fixed display names where the id isn't the prettiest label
    var display = {
      popos:    "Pop!_OS",
      opensuse: "openSUSE",
      nixos:    "NixOS",
      manjaro:  "Manjaro",
      gentoo:   "Gentoo",
      zorin:    "Zorin"
    };
    var d = display[id];
    if (d) return d;
    return id.charAt(0).toUpperCase() + id.slice(1);
  }

  // Names: translations.js "wp.name.<id>"; any other id shows as it is.
  var WALLPAPER_NAMED = { dusk: 1, midnight: 1, plum: 1, forest: 1, ember: 1, nordic: 1, aurora: 1, sand: 1, mono: 1, nebula: 1, borealis: 1, hex: 1, obsidian: 1, terrazzo: 1, custom: 1, clear: 1 };
  function wallpaperTitle(id) {
    return WALLPAPER_NAMED[id] ? window.t("wp.name." + id) : id;
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
      case "lang":         return langKnown(v) ? v : undefined;
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
  // Time wave 5: "tmr-" ids are the Time app's kitchen timers. They
  // ring on this device only, so they never enter the slice (getter,
  // merge) and a pull keeps the local ones (shellSliceSet).
  function alarmIsTimer(id) { return typeof id === "string" && id.indexOf("tmr-") === 0; }
  function alarmsCanonical(list, tombs, now) {
    var byId = {};
    for (var i = 0; i < list.length; i++) {
      var c = alarmCanon(list[i]);
      if (!c) continue;
      if (alarmIsTimer(c.id)) continue;
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
    if (langKnown(data.lang)) state.lang = data.lang;
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
      // Time wave 5: this device's kitchen timers are not in the slice.
      for (var ti = 0; ti < mine.length; ti++) {
        if (mine[ti] && alarmIsTimer(mine[ti].id) && !keepIds[mine[ti].id]) {
          keep.push(mine[ti]);
          keepIds[mine[ti].id] = true;
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
    // A pack language that came from another device loads its shell
    // pack first (i18n.js); English and Greek repaint at once.
    if (window.orosI18n && state.lang !== "en" && state.lang !== "el") window.orosI18n.ensure(state.lang, "shell", function () {
      window.orosI18n.table(window.OROS_TRANSLATIONS, "shell", state.lang);
      applyLang();
      langKeepOffline();
    });
    else applyLang();     // re-renders menu too
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

  // The relay moved to another Cloudflare account (2.9x). A relay
  // address saved by hand that is the old default goes back to "" (=
  // orOS's own relay); the newer stamp carries it to the other devices.
  var OLD_RELAY_RE = /^https:\/\/oros-mail-relay\.koulaxizis-25b\.workers\.dev\/*$/i;
  function migrateMailRelay() {
    var d = mailProxySliceGet();
    var r = d && d.relay;
    if (!r || typeof r.url !== "string" || !OLD_RELAY_RE.test(r.url.trim())) return false;
    d.relay = { url: "", m: Math.max(Date.now(), (Number(r.m) || 0) + 1) };
    mailProxySliceSet(d);
    if (window.orosSync && typeof window.orosSync.markDirty === "function") window.orosSync.markDirty();
    return true;
  }

  function registerMailProxySlice() {
    migrateMailRelay();
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
        todaySyncSettled(true);   // Today: the summary may be built now
        if (window.orosSync.isDirty()) {
          return window.orosSync.push()
            .then(function () { setSyncMsg("ok", "sync.ok.push"); });
        }
      })
      .catch(function (err) {
        if (remember && !isPassphraseError(err)) window.orosSync.setPassphrase(pw, true);
        if (!isPassphraseError(err)) todaySyncSettled(false);
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

  // WebDAV W2: test the server, then sync through it. The password
  // goes straight to sync.js; the shell keeps nothing of it.
  function syncConnectDav(form) {
    var S = window.orosSync;
    if (!S || typeof S.connectWebdav !== "function" || S.isConnected()) return;
    setSyncMsgRaw("dim", window.t("sync.dav.testing"));
    S.connectWebdav({ url: form.url, user: form.user, pass: form.pass, dir: form.dir, relay: !!form.relay })
      .then(function (acc) {
        state.syncUserEmail = (acc && acc.email) || null;
        setSyncMsg("ok", "sync.dav.ok");
      })
      .catch(handleSyncError);
  }

  // WebDAV W3: Nextcloud Login Flow v2. The window opens on the click
  // (a popup opened later is blocked) and gets the server's page once
  // the server has answered.
  function syncConnectNextcloud(form) {
    var S = window.orosSync;
    if (!S || typeof S.connectNextcloud !== "function" || S.isConnected() !== !!form.move) return;
    var w = null;
    try { w = window.open("about:blank", "_blank"); } catch (e) { w = null; }
    try { if (w) w.opener = null; } catch (e) {}
    state.ncWaiting = true;
    renderMenu();
    S.connectNextcloud({ url: form.url, dir: form.dir, relay: !!form.relay, move: !!form.move }, function (url) {
      setSyncMsgRaw("dim", window.t("sync.nc.waiting"));
      if (w && !w.closed) w.location.href = url;
      else window.open(url, "_blank", "noopener");
    }).then(function (acc) {
      state.ncWaiting = false;
      state.syncUserEmail = (acc && acc.email) || null;
      setSyncMsg("ok", form.move ? "sync.move.ok" : "sync.dav.ok");
    }, function (err) {
      state.ncWaiting = false;
      try { if (w && !w.closed && w.location.href === "about:blank") w.close(); } catch (e) {}
      handleSyncError(err);
    });
  }

  // WebDAV W4: move this device's cloud to the other provider. The
  // sync file and every Vault file are copied as they are (encrypted);
  // the old cloud is left as it was.
  function syncMoveDav(form) {
    var S = window.orosSync;
    if (!S || typeof S.moveToWebdav !== "function" || !S.isConnected()) return;
    setSyncMsgRaw("dim", window.t("sync.dav.testing"));
    S.moveToWebdav({ url: form.url, user: form.user, pass: form.pass, dir: form.dir, relay: !!form.relay })
      .then(function (acc) {
        state.syncUserEmail = (acc && acc.email) || null;
        setSyncMsg("ok", "sync.move.ok");
      })
      .catch(handleSyncError);
  }
  function syncMoveDropbox() {
    var S = window.orosSync;
    if (!S || typeof S.moveToDropbox !== "function" || !S.isConnected()) return;
    S.moveToDropbox().catch(handleSyncError);
  }

  // SEC-2 / A71a: Disconnect first cancels this device's access at
  // Dropbox (or deletes the Nextcloud app password), then forgets it
  // here, and says which of the two happened.
  var syncDisconnecting = false;
  function syncDisconnectUser() {
    var S = window.orosSync;
    if (!S || syncDisconnecting) return;
    if (typeof S.disconnectRevoke !== "function") {
      S.disconnect();
      state.syncUserEmail = null;
      state.syncBackups = null;
      state.vaultClean = null;
      renderMenu();
      return;
    }
    syncDisconnecting = true;
    setSyncMsgRaw("dim", window.t("sync.disc.working"));
    S.disconnectRevoke(5000).then(function (r) {
      syncDisconnecting = false;
      state.syncUserEmail = null;
      state.syncBackups = null;
      state.vaultClean = null;
      state.syncAutoErr = null;
      setSyncMsg("ok", syncDisconnectKey(r));
    });
  }
  // VD-GC: Settings › Sync › Unused files in the cloud. Look first
  // (usage: changes nothing), then clean up only on the person's tap.
  var CLEAN_CODES = /^clean-(no-manifest|mismatch|moved|unsupported)$/;
  function vaultCleanFail(err) {
    var S = window.orosSync, msg = (err && err.message) || "";
    var prev = state.vaultClean || {};
    state.vaultClean = { busy: "", usage: null, result: prev.result || null,
      code: CLEAN_CODES.test(msg) ? msg : "",
      err: CLEAN_CODES.test(msg) ? null : window.t(S ? S.errorKey(err) : "sync.err.generic") };
  }
  function vaultCleanCheck() {
    var V = window.orosVault;
    if (!V || typeof V.usage !== "function" || (state.vaultClean && state.vaultClean.busy)) return;
    state.vaultClean = { busy: "check", usage: null, result: (state.vaultClean && state.vaultClean.result) || null };
    settingsNotify();
    V.usage().then(function (u) {
      state.vaultClean = { busy: "", usage: JSON.parse(JSON.stringify(u)), result: state.vaultClean.result };
    }, vaultCleanFail).then(settingsNotify);
  }
  function vaultCleanRun() {
    var V = window.orosVault;
    var c = state.vaultClean;
    if (!V || typeof V.cleanUp !== "function" || !c || c.busy || !c.usage || !(c.usage.free > 0)) return;
    state.vaultClean = { busy: "clean", usage: c.usage, result: null };
    settingsNotify();
    V.cleanUp().then(function (r) {
      state.vaultClean = { busy: "", usage: null, result: {
        removed: +r.removed || 0, bytes: +r.bytes || 0, stopped: !!r.stopped,
        healed: +r.healed || 0, lost: Array.prototype.slice.call(r.lost || []).map(String) } };
      vaultCleanCheck();                                // fresh numbers
    }, function (err) { vaultCleanFail(err); settingsNotify(); });
  }
  // A43: the cloud backups for Settings › Sync, and Restore.
  function syncBackupsLoad() {
    var S = window.orosSync;
    if (!S || typeof S.listBackups !== "function" || !S.isConnected()) return;
    state.syncBackups = { loading: true, list: (state.syncBackups && state.syncBackups.list) || [] };
    settingsNotify();
    S.listBackups().then(function (list) {
      state.syncBackups = { loading: false, list: Array.prototype.map.call(list || [], function (e) {
        return { name: String(e.name), at: String(e.at || ""), size: +e.size || 0 };
      }) };
    }, function (err) {
      state.syncBackups = { loading: false, list: [], err: window.t(S.errorKey(err)) };
    }).then(settingsNotify);
  }
  function syncRestore(arg) {
    var S = window.orosSync;
    if (!S || typeof S.restoreBackup !== "function" || state.syncRestoring) return;
    state.syncRestoring = arg.name;
    state.syncOldPassFor = null;
    setSyncMsgRaw("dim", window.t("sync.restore.working"));
    S.restoreBackup(arg.name, arg.old || undefined).then(function (r) {
      state.syncRestoring = null;
      state.syncAutoErr = null;
      setSyncMsg(r.failed && r.failed.length ? "err" : "ok",
        r.failed && r.failed.length ? "sync.err.applyfull" : "sync.restore.done");
      syncBackupsLoad();
    }, function (err) {
      state.syncRestoring = null;
      var key = S.errorKey(err);
      if (key === "sync.err.restore-oldpass" || key === "sync.err.restore-oldpass-wrong") {
        state.syncOldPassFor = arg.name;
      }
      setSyncMsg("err", key);
    });
  }
  // Local rescue copies (sync.js asks for one before every rollback):
  // /internal/Rescue on this device's orOS disk, importable from
  // Settings › Backups like any backup file.
  function syncRescueSink(text) {
    var F = window.orosFS;
    if (!F || typeof F.writeText !== "function") return Promise.resolve(false);
    var dir = "/internal/Rescue";
    var file = dir + "/orOS-rescue-" + new Date().toISOString().replace(/[:.]/g, "-") + ".json";
    return Promise.resolve(typeof F.mkdir === "function" ? F.mkdir(dir) : null)
      .catch(function () {})
      .then(function () { return F.writeText(file, text); })
      .then(function () { return true; }, function () { return false; });
  }
  // A restore made on another device reached this one.
  function syncRestoredNotice(info) {
    if (!info || info.here) return;
    setSyncMsg("ok", info.rescued ? "sync.restore.followed" : "sync.restore.followed.nocopy");
  }

  function syncDisconnectKey(r) {
    if (r.revoked) return "sync.disc.revoked";
    if (r.offline) return r.provider === "webdav" ? "sync.disc.offline.dav" : "sync.disc.offline";
    if (r.provider === "webdav") return "sync.disc.local.dav";
    return "sync.disc.norevoke";
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
        var text = String(reader.result);
        // BK-E: a sealed file asks for its passphrase first; a plain
        // file (every file before BK-E) goes straight in.
        if (typeof window.orosSync.backupSealed === "function" && window.orosSync.backupSealed(text)) {
          showBackupPassDialog("open", function (pw) {
            return window.orosSync.openBackup(text, pw).then(applyBackupText);
          });
          return;
        }
        applyBackupText(text);
      };
      reader.readAsText(file);
    });
  }
  function applyBackupText(text) {
    try {
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
      handleSyncError(e);
    }
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

  // A72: an automatic sync that fails for a reason only the person
  // can fix (storage full, sign-in expired, a newer orOS needed) puts
  // ONE line a day in the bell, with a link to the place to fix it.
  // Network trouble stays a red dot only: it heals by itself.
  var SYNC_NOTICE_FOR = {
    "sync.err.storage":   "settings/backup",
    "sync.err.auth":      "settings/sync",
    "sync.err.dav-auth":  "settings/sync",
    "sync.err.version":   ""
  };
  function syncNoticeDaily(ident, text, link) {
    var N = window.orosNotifs;
    if (!N || typeof N.emit !== "function") return;
    try {
      N.emit({
        ns: "system",
        key: "sync-" + ident + "-" + sysYmd(),
        type: "sys",
        title: window.t("sync.notice.title"),
        body: text,
        deepLink: link ? "system:open:" + link : ""
      });
    } catch (e) {}
  }
  function syncAutoFailNotice(err) {
    var S = window.orosSync;
    if (!S || typeof S.errorKey !== "function") return;
    var key = S.errorKey(err);
    if (!SYNC_NOTICE_FOR.hasOwnProperty(key)) return;
    syncNoticeDaily(key.replace(/^sync\.err\./, ""), window.t(key), SYNC_NOTICE_FOR[key]);
  }
  // A37 / A69c: a pull or import could not write some apps' data (the
  // store is full). Said once a day, the same line as storage-full.
  function syncApplyFailNotice(names) {
    if (!names || !names.length) return;
    syncNoticeDaily("storage", window.t("sync.err.applyfull"), SYNC_NOTICE_FOR["sync.err.storage"]);
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
    exportJob.then(bkSealIfOn).then(function (json) {
      shellSaveJson(
        "orOS-backup-" + new Date().toISOString().slice(0, 10) + ".json",
        json);
    }).catch(function (e) {
      if (e && e.message === "backup-nokey") { setSyncMsg("err", "sync.err.backupkey"); return; }
      handleSyncError(e);
    });
  }

  function scCheckUpdates() {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.getRegistration()
      .then(function (r) { return r ? r.update() : null; })
      .catch(function () {});
    setSyncMsgRaw("dim", window.t("update.checking"));
  }

  function scToggleLang() { setLangUser(langNext()); }

  // The language button: the next of the languages on offer (English
  // and Greek, plus every shown pack language and the active one).
  // The bar button toggles English and the last other language picked
  // on this device (Greek until another is picked); Settings lists all.
  var LANG_ALT_LS = "oros-lang-alt";
  function langNext() {
    if (state.lang !== "en") return "en";
    var alt = null;
    try { alt = localStorage.getItem(LANG_ALT_LS); } catch (e) {}
    var shown = window.orosI18n ? window.orosI18n.choices().map(function (l) { return l.code; }) : ["en", "el"];
    return alt && alt !== "en" && shown.indexOf(alt) !== -1 ? alt : "el";
  }

  // A language picked on this device (button, shortcut, Settings).
  // A pack language loads its shell pack first; open apps reload and
  // load their own (i18n.js). The chosen language's files are then
  // kept for offline use (langKeepOffline).
  function setLangUser(code) {
    if (!langKnown(code) || code === state.lang) return;
    var alt = code !== "en" ? code : state.lang;
    state.lang = code;
    localStorage.setItem("oros-lang", state.lang);
    if (alt !== "en") try { localStorage.setItem(LANG_ALT_LS, alt); } catch (e) {}
    noteLocalChange();            // user action → sync engine
    langApplyPack();
  }
  function langApplyPack() {
    var I = window.orosI18n;
    function go() {
      if (I && window.OROS_TRANSLATIONS) I.table(window.OROS_TRANSLATIONS, "shell", state.lang);
      if (I && window.OrosCommands) cmdPack();     // the command bar, if it is loaded
      applyLang();
      refreshRunningApp();        // opened apps follow the language too
      langKeepOffline();
    }
    if (I) I.ensure(state.lang, "shell", go); else go();
  }

  // A pack language's files (i18n/<code>/manifest.json, written by
  // the coverage script, see the translator guide) are fetched once per release while
  // online; the service worker keeps them in its language cache,
  // which outlives releases, so the language works offline.
  function langKeepOffline() {
    var I = window.orosI18n, code = state.lang;
    if (!I || code === "en" || code === "el" || !navigator.onLine) return;
    // Only through the service worker (it keeps the copies); the first
    // visit, before the worker controls the page, tries on the next start.
    if (!navigator.serviceWorker || !navigator.serviceWorker.controller) return;
    var mark = code + "@" + APP_VERSION;
    try { if (localStorage.getItem("oros-i18n-kept") === mark) return; } catch (e) { return; }
    fetch(I.root + "i18n/" + code + "/manifest.json", { cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (m) {
        var files = (m && Array.isArray(m.files) ? m.files : []).filter(function (f) {
          return typeof f === "string" && /^[a-z0-9][a-z0-9/._-]{0,120}$/.test(f) && f.indexOf("..") === -1;
        });
        return Promise.all(files.map(function (f) {
          var u = I.root + "i18n/" + code + "/" + f + (/\.js$/.test(f) ? "?v=" + APP_VERSION : "");
          return fetch(u).catch(function () {});
        }));
      })
      .then(function () { try { localStorage.setItem("oros-i18n-kept", mark); } catch (e) {} })
      .catch(function () {});
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
  // i18n: words in translations.js (sup.*), German in the shell pack.
  var SUPPORT_OPTS = [
    {
      name: "Ko-fi",
      url:  "https://ko-fi.com/koulaxizis",
      k:    "sup.kofi"
    }
  ];
  // Extra plain links shown under the Ko-fi card (same rules: fixed
  // URLs, new tab, rel=noopener, no fetch/embed/widget).
  var SUPPORT_LINKS = [
    {
      url: "https://ko-fi.com/koulaxizis/tiers",
      k:   "sup.tiers"
    },
    {
      url: "https://nulljsfx.tech/supporters/",
      k:   "sup.supporters"
    }
  ];

  function wireSupportSection(ov) {
    var box = ov.querySelector(".sc-box");
    if (!box) return;
    var resetWrap = box.querySelector("#sc-reset-wrap");

    var sec = document.createElement("div");
    sec.id = "sc-support";

    var head = document.createElement("div");
    head.className = "sc-sec";
    head.textContent = window.t("sup.title");
    sec.appendChild(head);

    var intro = document.createElement("div");
    intro.style.cssText =
      "font-size:11.5px;line-height:1.5;color:var(--text-dim);margin:2px 0 8px;";
    intro.textContent = window.t("sup.intro");
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
      ds.textContent = window.t(opt.k);
      a.appendChild(nm);
      a.appendChild(ds);
      cards.appendChild(a);
    });
    sec.appendChild(cards);

    var links = document.createElement("div");
    links.id = "sc-support-links";
    links.style.cssText =
      "display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12px;margin:0 0 8px;";
    SUPPORT_LINKS.forEach(function (l) {
      var a = document.createElement("a");
      a.href = l.url;
      a.target = "_blank";
      a.rel = "noopener";
      a.style.cssText = "color:var(--accent);";
      a.textContent = window.t(l.k);
      links.appendChild(a);
    });
    sec.appendChild(links);

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
  // i18n: each text is a key in translations.js (cr.*); the item's
  // `k` is what it is used for, `lic.k` a licence that needs words.
  var CREDIT_GROUPS = [
    {
      k: "cr.g.libs",
      items: [
        { name: "Leaflet 1.9.4", url: "https://leafletjs.com/",
          by: "Volodymyr Agafonkin & contributors", lic: "BSD-2-Clause",
          k: "cr.leaflet" },
        { name: "Health Connect client 1.1.0 + Kotlin", url: "https://developer.android.com/jetpack/androidx/releases/health-connect",
          by: "The Android Open Source Project; JetBrains & Kotlin contributors", lic: "Apache-2.0",
          k: "cr.health-connect" },
        { name: "jsPDF 4.2.1", url: "https://github.com/parallax/jsPDF",
          by: "James Hall, yWorks & contributors", lic: "MIT",
          k: "cr.jspdf" },
        { name: "SheetJS Community Edition 0.20.3", url: "https://sheetjs.com/",
          by: "SheetJS LLC", lic: "Apache-2.0",
          k: "cr.sheetjs-community" },
        { name: "hls.js 1.7.3", url: "https://github.com/video-dev/hls.js",
          by: "Dailymotion & contributors", lic: "Apache-2.0",
          k: "cr.hls-js" },
        { name: "PDF.js 5.4.394", url: "https://mozilla.github.io/pdf.js/",
          by: "Mozilla Foundation & contributors", lic: "Apache-2.0",
          k: "cr.pdf-js" },
        { name: "pdf-lib 1.17.1", url: "https://pdf-lib.js.org/",
          by: "Andrew Dillon & contributors", lic: "MIT",
          k: "cr.pdf-lib" },
        { name: "@pdf-lib/fontkit 1.1.1", url: "https://github.com/Hopding/fontkit",
          by: "Devon Govett, Andrew Dillon & contributors", lic: "MIT",
          k: "cr.pdf-lib-2" },
        { name: "CodeMirror 6", url: "https://codemirror.net/",
          by: "Marijn Haverbeke & contributors", lic: "MIT",
          k: "cr.codemirror" },
        { name: "three.js r180", url: "https://threejs.org/",
          by: "three.js authors", lic: "MIT",
          k: "cr.three-js" },
        { name: "Mediabunny 1.60.0", url: "https://mediabunny.dev/",
          by: "Vanilagy & contributors", lic: "MPL-2.0",
          k: "cr.mediabunny" },
        { name: "ONNX Runtime Web 1.22.0", url: "https://onnxruntime.ai/",
          by: "Microsoft Corporation", lic: "MIT",
          k: "cr.onnx-runtime" },
        { name: "U²-Net (u2netp model)", url: "https://github.com/xuebinqin/U-2-Net",
          by: "Xuebin Qin & contributors", lic: "Apache-2.0",
          k: "cr.u2-net" },
        { name: "MI-GAN (512 Places2 model)", url: "https://github.com/Picsart-AI-Research/MI-GAN",
          by: "Picsart AI Research", lic: "MIT",
          k: "cr.mi-gan" },
        { name: "Tesseract.js 7.0.0 + tesseract.js-core 6.1.2", url: "https://github.com/naptha/tesseract.js",
          by: "Project Naptha, Google (Tesseract OCR) & contributors", lic: "Apache-2.0",
          k: "cr.tesseract-js" },
        { name: "WebLLM 0.2.86", url: "https://github.com/mlc-ai/web-llm",
          by: "MLC AI & contributors", lic: "Apache-2.0",
          k: "cr.webllm" },
        { name: "jsQR 1.4.0", url: "https://github.com/cozmo/jsQR",
          by: "Cosmo Wolfe", lic: "Apache-2.0",
          k: "cr.jsqr" },
        { name: "fzstd 0.1.1", url: "https://github.com/101arrowz/fzstd",
          by: "Arjun Barrett", lic: "MIT",
          k: "cr.fzstd" },
        { name: "OpenPGP.js 6.3.1", url: "https://openpgpjs.org/",
          by: "OpenPGP.js contributors, Proton AG", lic: "LGPL-3.0-or-later",
          k: "cr.openpgp-js" },
        { name: "hash-wasm 4.12.0 (Argon2)", url: "https://github.com/Daninet/hash-wasm",
          by: "Dani Biró", lic: "MIT",
          k: "cr.hash-wasm" },
        { name: "libarchive.js 2.0.2 (libarchive 3.7.2)", url: "https://github.com/nika-begiashvili/libarchivejs",
          by: "Nika Begiashvili; libarchive, zlib, bzip2, liblzma, Comlink, Emscripten and OpenSSL authors", lic: { k: "cr.lic.libarchive-js" },
          k: "cr.libarchive-js" },
        { name: "LibRaw 0.22.1 (libraw-wasm 1.6.0)", url: "https://www.libraw.org/",
          by: "LibRaw LLC; wrapper by Yanis Bouane; Little-CMS, libjpeg (IJG), Emscripten", lic: { k: "cr.lic.libraw-libraw" },
          k: "cr.libraw-libraw" },
        { name: "RNNoise 0.1.1", url: "https://github.com/xiph/rnnoise",
          by: "Jean-Marc Valin, Xiph.Org Foundation, Mozilla, Amazon", lic: "BSD-3-Clause",
          k: "cr.rnnoise" },
        { name: "Whisper tiny (ONNX export by Xenova)", url: "https://huggingface.co/Xenova/whisper-tiny",
          by: "OpenAI; ONNX export by Joshua Lochner", lic: "MIT; Apache-2.0 (export)",
          k: "cr.whisper-tiny" },
        { name: "NULL JSFX", url: "https://nulljsfx.tech",
          by: "Christos Koulaxizis", lic: "MIT",
          k: "cr.null-jsfx" },
        { name: "VS Chamber Orchestra: Community Edition", url: "https://github.com/sgossner/VSCO-2-CE",
          by: "Versilian Studios", lic: "CC0 1.0",
          k: "cr.vsco" },
        { name: "Salamander Grand Piano V3", url: "https://archive.org/details/SalamanderGrandPianoV3",
          by: "Alexander Holm", lic: "CC BY 3.0",
          k: "cr.salamander" }
      ]
    },
    {
      k: "cr.g.fonts",
      items: [
        { name: "Nunito", url: "https://github.com/googlefonts/nunito",
          by: "The Nunito Project Authors (Vernon Adams, Jacques Le Bailly)", lic: "SIL OFL 1.1",
          k: "cr.nunito" },
        { name: "Noto Sans", url: "https://notofonts.github.io/",
          by: "The Noto Project Authors", lic: "SIL OFL 1.1",
          k: "cr.noto-sans" },
        { name: "Noto Sans, Noto Serif, Noto Sans Mono", url: "https://notofonts.github.io/",
          by: "The Noto Project Authors", lic: "SIL OFL 1.1",
          k: "cr.noto-sans-2" },
        { name: "Feather Icons", url: "https://feathericons.com/",
          by: "Cole Bemis", lic: "MIT",
          k: "cr.feather-icons" },
        { name: "Tabler Icons 3.49.0", url: "https://tabler.io/icons",
          by: "Paweł Kuna", lic: "MIT",
          k: "cr.tabler-icons" },
        { name: "Simple Icons 16.35.0", url: "https://simpleicons.org/",
          by: "Simple Icons collaborators", lic: "CC0 1.0",
          k: "cr.simple-icons" }
      ]
    },
    {
      k: "cr.g.data",
      items: [
        { name: "FSRS-6 (ts-fsrs 5.4.2)", url: "https://github.com/open-spaced-repetition/ts-fsrs",
          by: "Open Spaced Repetition", lic: "MIT",
          k: "cr.fsrs-ts" },
        { name: "EFF Diceware word lists", url: "https://www.eff.org/dice",
          by: "Electronic Frontier Foundation", lic: "CC BY 3.0 US",
          k: "cr.eff-diceware" },
        { name: "SecLists — 10k most common passwords", url: "https://github.com/danielmiessler/SecLists",
          by: "Daniel Miessler & contributors", lic: "MIT",
          k: "cr.seclists-most" },
        { name: "SCOWL (via wordlist-english)", url: "http://wordlist.aspell.net/",
          by: "Kevin Atkinson", lic: { k: "cr.lic.scowl-via" },
          k: "cr.scowl-via" },
        { name: "Hunspell el_GR", url: "https://github.com/wooorm/dictionaries",
          by: "Steve Stavropoulos & contributors (elspell)", lic: "MPL 1.1",
          k: "cr.hunspell-el" },
        { name: "FrequencyWords", url: "https://github.com/hermitdave/FrequencyWords",
          by: "Hermit Dave (from OpenSubtitles)", lic: "CC BY-SA 4.0",
          k: "cr.frequencywords" },
        { name: "Yale Bright Star Catalogue, 5th ed.", url: "http://tdc-www.harvard.edu/catalogs/bsc5.html",
          by: "D. Hoffleit, W. H. Warren Jr. (Yale University Observatory)", lic: "Public domain",
          k: "cr.yale-bright" },
        { name: "d3-celestial (constellation figures)", url: "https://github.com/ofrohn/d3-celestial",
          by: "Olaf Frohn", lic: "BSD-3-Clause",
          k: "cr.d3-celestial" },
        { name: "id-tagging-schema (iD presets)", url: "https://github.com/openstreetmap/id-tagging-schema",
          by: "OpenStreetMap iD contributors", lic: "ISC",
          k: "cr.id-tagging" },
        { name: "Hunspell dictionaries en_US (SCOWL) and el_GR", url: "https://github.com/LibreOffice/dictionaries",
          by: "Kevin Atkinson & SCOWL contributors; Steve Stavropoulos & elspell contributors", lic: { k: "cr.lic.hunspell-dictionaries" },
          k: "cr.hunspell-dictionaries" },
        { name: "USDA FoodData Central", url: "https://fdc.nal.usda.gov/",
          by: "U.S. Department of Agriculture", lic: { k: "cr.lic.usda-fooddata" },
          k: "cr.usda-fooddata" },
        { name: "Lichess chess-openings", url: "https://github.com/lichess-org/chess-openings",
          by: "Lichess contributors", lic: "CC0 1.0",
          k: "cr.lichess-chess" },
        { name: "Lichess puzzle database", url: "https://database.lichess.org/#puzzles",
          by: "Lichess contributors", lic: "CC0 1.0",
          k: "cr.lichess-puzzle" },
        { name: "PDMP3 (MP3 tables)", url: "https://github.com/technosaurus/PDMP3",
          by: "Krister Lagerström & contributors", lic: { k: "cr.lic.usda-fooddata" },
          k: "cr.pdmp3-mp3" }
      ]
    },
    {
      k: "cr.g.online",
      items: [
        { name: "Open-Meteo", url: "https://open-meteo.com/",
          by: "Open-Meteo.com", lic: "CC BY 4.0 (data)",
          k: "cr.open-meteo" },
        { name: "MeteoAlarm", url: "https://meteoalarm.org/",
          by: "EUMETNET and the national weather services", lic: { k: "cr.lic.meteoalarm" },
          k: "cr.meteoalarm" },
        { name: "NASA GIBS / IMERG", url: "https://nasa-gibs.github.io/gibs-api-docs/",
          by: "NASA ESDIS, GPM IMERG", lic: { k: "cr.lic.nasa-gibs" },
          k: "cr.nasa-gibs" },
        { name: "OpenStreetMap", url: "https://www.openstreetmap.org/copyright",
          by: "OpenStreetMap contributors", lic: "ODbL (data)",
          k: "cr.openstreetmap" },
        { name: "OpenStreetMap France / HOT", url: "https://www.hotosm.org/",
          by: "OSM France, Humanitarian OpenStreetMap Team", lic: "ODbL (data)",
          k: "cr.openstreetmap-france" },
        { name: "Esri World Imagery", url: "https://www.esri.com/",
          by: "Esri, Maxar, Earthstar Geographics", lic: { k: "cr.lic.esri-world" },
          k: "cr.esri-world" },
        { name: "OpenTopoMap", url: "https://opentopomap.org/",
          by: "OpenTopoMap; data by OpenStreetMap contributors, SRTM", lic: "CC-BY-SA (style), ODbL (data)",
          k: "cr.opentopomap" },
        { name: "Terrain Tiles (AWS)", url: "https://registry.opendata.aws/terrain-tiles/",
          by: "Mapzen and others (SRTM, GMTED2010, ETOPO1, USGS NED, EU-DEM)", lic: { k: "cr.lic.terrain-tiles" },
          k: "cr.terrain-tiles" },
        { name: "Wikipedia", url: "https://www.wikipedia.org/",
          by: "Wikimedia Foundation, Wikipedia contributors", lic: "CC BY-SA 4.0 (text)",
          k: "cr.wikipedia" },
        { name: "Tavily", url: "https://tavily.com/",
          by: "Tavily", lic: { k: "cr.lic.tavily" },
          k: "cr.tavily" },
        { name: "SearXNG", url: "https://searxng.org/",
          by: "SearXNG contributors", lic: { k: "cr.lic.searxng" },
          k: "cr.tavily" },
        { name: "Jina Reader", url: "https://jina.ai/reader/",
          by: "Jina AI", lic: { k: "cr.lic.jina-reader" },
          k: "cr.jina-reader" },
        { name: "Panoramax", url: "https://panoramax.fr/",
          by: "Panoramax (IGN, OpenStreetMap France and contributors)", lic: { k: "cr.lic.panoramax" },
          k: "cr.panoramax" },
        { name: "Photon", url: "https://photon.komoot.io/",
          by: "komoot", lic: "Apache-2.0 (software), ODbL (data)",
          k: "cr.photon" },
        { name: "OSRM", url: "https://project-osrm.org/",
          by: "Project OSRM contributors", lic: "BSD-2-Clause (software)",
          k: "cr.osrm" },
        { name: "FOSSGIS routing", url: "https://routing.openstreetmap.de/",
          by: "FOSSGIS e.V.", lic: "ODbL (data)",
          k: "cr.fossgis-routing" },
        { name: "Transitous", url: "https://transitous.org/sources/",
          by: "The Transitous community (MOTIS); timetables by each operator", lic: { k: "cr.lic.transitous" },
          k: "cr.transitous" },
        { name: "OASA Telematics", url: "https://telematics.oasa.gr/",
          by: "OASA (Athens Urban Transport Organisation)", lic: { k: "cr.lic.oasa-telematics" },
          k: "cr.oasa-telematics" },
        { name: "OpenStreetMap API", url: "https://operations.osmfoundation.org/policies/api/",
          by: "OpenStreetMap Foundation; data by OpenStreetMap contributors", lic: "ODbL (data)",
          k: "cr.openstreetmap-api" },
        { name: "Overpass API", url: "https://overpass-api.de/",
          by: "Roland Olbricht & the Overpass community; data by OpenStreetMap contributors", lic: "ODbL (data)",
          k: "cr.overpass-api" },
        { name: "Radio Browser", url: "https://www.radio-browser.info/",
          by: "Alex Segler & the community", lic: { k: "cr.lic.radio-browser" },
          k: "cr.radio-browser" },
        { name: "Internet Archive", url: "https://archive.org/details/audio",
          by: "Internet Archive; each recording by its artist", lic: { k: "cr.lic.internet-archive" },
          k: "cr.internet-archive" },
        { name: "ccMixter", url: "https://ccmixter.org/",
          by: "ArtisTech Media; each upload by its artist", lic: { k: "cr.lic.ccmixter" },
          k: "cr.ccmixter" },
        { name: "Jamendo", url: "https://www.jamendo.com/",
          by: "Jamendo S.A.; each track by its artist", lic: { k: "cr.lic.jamendo" },
          k: "cr.jamendo" },
        { name: "OpenSubsonic API", url: "https://opensubsonic.netlify.app/",
          by: "Subsonic API by Sindre Mehus; OpenSubsonic by its contributors", lic: { k: "cr.lic.opensubsonic-api" },
          k: "cr.opensubsonic-api" },
        { name: "Jellyfin", url: "https://jellyfin.org/",
          by: "The Jellyfin project", lic: { k: "cr.lic.jellyfin" },
          k: "cr.jellyfin" },
        { name: "Funkwhale", url: "https://www.funkwhale.audio/",
          by: "The Funkwhale collective", lic: { k: "cr.lic.funkwhale" },
          k: "cr.funkwhale" },
        { name: "LRCLIB", url: "https://lrclib.net/",
          by: "The LRCLIB project and its contributors", lic: { k: "cr.lic.lrclib" },
          k: "cr.lrclib" },
        { name: "iptv-org", url: "https://github.com/iptv-org/iptv",
          by: "iptv-org contributors", lic: "Unlicense (public domain)",
          k: "cr.iptv-org" },
        { name: "Wikidata", url: "https://www.wikidata.org/",
          by: "Wikidata editors, Wikimedia Foundation", lic: "CC0 (data)",
          k: "cr.wikidata" },
        { name: "Frankfurter", url: "https://frankfurter.dev/",
          by: "Hakan Ensari; rates: European Central Bank", lic: { k: "cr.lic.frankfurter" },
          k: "cr.frankfurter" },
        { name: "Open Food Facts", url: "https://world.openfoodfacts.org/",
          by: "Open Food Facts contributors", lic: "ODbL (data)",
          k: "cr.open-food" },
        { name: "wger", url: "https://wger.de/",
          by: "wger project & contributors", lic: "CC BY-SA (images)",
          k: "cr.wger" },
        { name: "Pl@ntNet API", url: "https://my.plantnet.org/",
          by: "Pl@ntNet consortium (Cirad, INRAE, Inria, IRD)", lic: { k: "cr.lic.plntnet-api" },
          k: "cr.plntnet-api" },
        { name: "TMDB", url: "https://www.themoviedb.org/",
          by: "The Movie Database", lic: { k: "cr.lic.tmdb" },
          k: "cr.tmdb" },
        { name: "Project Gutenberg", url: "https://www.gutenberg.org/",
          by: "Project Gutenberg Literary Archive Foundation & volunteers", lic: { k: "cr.lic.project-gutenberg" },
          k: "cr.project-gutenberg" },
        { name: "Standard Ebooks", url: "https://standardebooks.org/",
          by: "Standard Ebooks volunteers", lic: { k: "cr.lic.standard-ebooks" },
          k: "cr.project-gutenberg" },
        { name: "Protomaps", url: "https://protomaps.com/",
          by: "Protomaps LLC; data by OpenStreetMap contributors", lic: "ODbL (data)",
          k: "cr.protomaps" },
        { name: "Hugging Face", url: "https://huggingface.co/",
          by: "Hugging Face, Inc.", lic: { k: "cr.lic.hugging-face" },
          k: "cr.hugging-face" },
        { name: "gpodder.net / Nextcloud GPodder Sync", url: "https://gpodder.net/",
          by: "gpodder.net; Nextcloud GPodder Sync contributors", lic: { k: "cr.lic.gpodder-net" },
          k: "cr.gpodder-net" },
        { name: "Wiktionary", url: "https://en.wiktionary.org/",
          by: "Wiktionary editors, Wikimedia Foundation", lic: "CC BY-SA 4.0 (text)",
          k: "cr.wiktionary" },
        { name: "Openverse", url: "https://openverse.org/",
          by: "WordPress.org, the creators of every work", lic: { k: "cr.lic.openverse" },
          k: "cr.openverse" },
        { name: "Wikimedia Commons", url: "https://commons.wikimedia.org/",
          by: "Commons contributors, Wikimedia Foundation", lic: { k: "cr.lic.wikimedia-commons" },
          k: "cr.wikimedia-commons" },
        { name: "Iconify", url: "https://iconify.design/",
          by: "Vjacheslav Trushkin & the authors of each icon set", lic: { k: "cr.lic.iconify" },
          k: "cr.iconify" },
        { name: "Fontsource", url: "https://fontsource.org/",
          by: "Fontsource & each font's designers", lic: { k: "cr.lic.fontsource" },
          k: "cr.fontsource" },
        { name: "Pixabay", url: "https://pixabay.com/",
          by: "Pixabay creators", lic: { k: "cr.lic.pixabay" },
          k: "cr.pixabay" },
        { name: "Pexels", url: "https://www.pexels.com/",
          by: "Pexels creators", lic: { k: "cr.lic.pexels" },
          k: "cr.pixabay" },
        { name: "Open Library", url: "https://openlibrary.org/",
          by: "Internet Archive", lic: "CC0 (data)",
          k: "cr.open-library" },
        { name: "MusicBrainz", url: "https://musicbrainz.org/",
          by: "MetaBrainz Foundation", lic: "CC0 (core data)",
          k: "cr.musicbrainz" },
        { name: "Cover Art Archive", url: "https://coverartarchive.org/",
          by: "MetaBrainz Foundation and Internet Archive", lic: { k: "cr.lic.cover-art" },
          k: "cr.cover-art" },
        { name: "Anthropic, OpenAI, Google Gemini, Mistral, OpenRouter, Ollama, LM Studio", url: "https://www.anthropic.com/",
          by: "Each provider", lic: { k: "cr.lic.anthropic-openai" },
          k: "cr.anthropic-openai" },
        { name: "Groq", url: "https://groq.com/",
          by: "Groq, Inc.", lic: { k: "cr.lic.groq" },
          k: "cr.anthropic-openai" },
        { name: "Cerebras", url: "https://www.cerebras.ai/",
          by: "Cerebras Systems", lic: { k: "cr.lic.groq" },
          k: "cr.anthropic-openai" },
        { name: "GitHub Models", url: "https://github.com/marketplace/models",
          by: "GitHub, Inc.", lic: { k: "cr.lic.groq" },
          k: "cr.anthropic-openai" },
        { name: "Cohere", url: "https://cohere.com/",
          by: "Cohere Inc.", lic: { k: "cr.lic.groq" },
          k: "cr.anthropic-openai" },
        { name: "Hugging Face Inference Providers", url: "https://huggingface.co/",
          by: "Hugging Face, Inc.", lic: { k: "cr.lic.groq" },
          k: "cr.anthropic-openai" },
        { name: "SambaNova Cloud", url: "https://sambanova.ai/",
          by: "SambaNova Systems", lic: { k: "cr.lic.groq" },
          k: "cr.anthropic-openai" },
        { name: "Pollinations", url: "https://pollinations.ai/",
          by: "Pollinations.AI", lic: { k: "cr.lic.groq" },
          k: "cr.anthropic-openai" },
        { name: "Pollinations, Hugging Face, OpenAI, Stability AI, Stable Diffusion WebUI / Forge", url: "https://pollinations.ai/",
          by: "Each provider or project", lic: { k: "cr.lic.pollinations-hugging" },
          k: "cr.pollinations-hugging" },
        { name: "Cloudflare Workers", url: "https://workers.cloudflare.com/",
          by: "Cloudflare, Inc.", lic: { k: "cr.lic.cloudflare-workers" },
          k: "cr.cloudflare-workers" },
        { name: "Web Push: Google FCM, Mozilla Push, Microsoft WNS", url: "https://www.rfc-editor.org/rfc/rfc8030",
          by: "Google LLC; Mozilla Foundation; Microsoft Corporation (your browser's)", lic: { k: "cr.lic.web-push" },
          k: "cr.web-push" },
        { name: "WooCommerce REST API", url: "https://woocommerce.github.io/woocommerce-rest-api-docs/",
          by: "Automattic; your own shop", lic: { k: "cr.lic.woocommerce-rest" },
          k: "cr.woocommerce-rest" },
        { name: "Shopify Storefront API", url: "https://shopify.dev/docs/api/storefront",
          by: "Shopify Inc.; your own shop", lic: { k: "cr.lic.woocommerce-rest" },
          k: "cr.shopify-storefront" },
        { name: "MailerLite, Mailchimp, Brevo", url: "https://www.mailerlite.com/",
          by: "Each provider; your own account", lic: { k: "cr.lic.anthropic-openai" },
          k: "cr.mailerlite-mailchimp" },
        { name: "HubSpot, Pipedrive", url: "https://developers.hubspot.com/",
          by: "Each provider; your own account", lic: { k: "cr.lic.anthropic-openai" },
          k: "cr.hubspot-pipedrive" },
        { name: "Stripe API", url: "https://docs.stripe.com/api",
          by: "Stripe, Inc.; your own account", lic: { k: "cr.lic.stripe-api" },
          k: "cr.stripe-api" },
        { name: "Enable Banking API", url: "https://enablebanking.com/docs/api/reference/",
          by: "Enable Banking Oy; your own application", lic: { k: "cr.lic.enablebanking" },
          k: "cr.enablebanking" },
        { name: "PayPal Transaction Search API", url: "https://developer.paypal.com/docs/api/transaction-search/v1/",
          by: "PayPal, Inc.; your own app", lic: { k: "cr.lic.paypal-api" },
          k: "cr.paypal-api" },
        { name: "Invoice Ninja API", url: "https://api-docs.invoicing.co/",
          by: "Invoice Ninja LLC; your own account or install", lic: { k: "cr.lic.invoice-ninja" },
          k: "cr.invoice-ninja" },
        { name: "Odoo API", url: "https://www.odoo.com/documentation/19.0/developer/reference/external_api.html",
          by: "Odoo S.A.; your own database", lic: { k: "cr.lic.odoo-api" },
          k: "cr.odoo-api" },
        { name: "Todoist API", url: "https://developer.todoist.com/api/v1/",
          by: "Doist Inc.; your own account", lic: { k: "cr.lic.todoist-api" },
          k: "cr.todoist-api" },
        { name: "Trello API", url: "https://developer.atlassian.com/cloud/trello/rest/",
          by: "Atlassian; your own account", lic: { k: "cr.lic.trello-api" },
          k: "cr.trello-api" },
        { name: "GitHub REST API", url: "https://docs.github.com/en/rest/issues/issues",
          by: "GitHub, Inc.; your own account", lic: { k: "cr.lic.github-rest" },
          k: "cr.github-rest" },
        { name: "Raindrop.io API", url: "https://developer.raindrop.io/",
          by: "Raindrop.io; your own account", lic: { k: "cr.lic.invoice-ninja" },
          k: "cr.raindrop-io" },
        { name: "Lichess API", url: "https://lichess.org/api",
          by: "Lichess.org (open source, AGPL-3.0); your own account", lic: { k: "cr.lic.lichess-api" },
          k: "cr.lichess-api" },
        { name: "Chess.com Published-Data API", url: "https://support.chess.com/en/articles/9650547-published-data-api",
          by: "Chess.com, LLC; your own public profile", lic: { k: "cr.lic.chess-com" },
          k: "cr.chess-com" },
        { name: "Notion API", url: "https://developers.notion.com/reference/intro",
          by: "Notion Labs, Inc.; your own workspace", lic: { k: "cr.lic.notion-api" },
          k: "cr.notion-api" },
        { name: "Google People API · Microsoft Graph", url: "https://developers.google.com/people",
          by: "Google LLC; Microsoft Corporation; your own account", lic: { k: "cr.lic.google-people" },
          k: "cr.google-people" },
        { name: "Google Calendar · Tasks · YouTube Data · Books APIs", url: "https://developers.google.com/calendar",
          by: "Google LLC; your own account", lic: { k: "cr.lic.google-people" },
          k: "cr.google-calendar" },
        { name: "Google Drive · Picker · Photos Picker APIs", url: "https://developers.google.com/drive/picker",
          by: "Google LLC; your own account", lic: { k: "cr.lic.google-people" },
          k: "cr.google-drive" },
        { name: "Gravatar", url: "https://gravatar.com/",
          by: "Automattic Inc.", lic: { k: "cr.lic.gravatar" },
          k: "cr.gravatar" },
        { name: "GitHub · Bluesky · Mastodon public APIs", url: "https://docs.bsky.app/",
          by: "GitHub, Inc.; Bluesky Social PBC; each Mastodon server", lic: { k: "cr.lic.github-bluesky" },
          k: "cr.github-bluesky" },
        { name: "timologisi.online", url: "https://www.timologisi.online/",
          by: "Novus Conceptus; your own account", lic: { k: "cr.lic.timologisi-online" },
          k: "cr.timologisi-online" },
        { name: "Dropbox", url: "https://www.dropbox.com/",
          by: "Dropbox, Inc.", lic: { k: "cr.lic.gpodder-net" },
          k: "cr.dropbox" },
        { name: "GitHub Pages", url: "https://pages.github.com/",
          by: "GitHub, Inc.", lic: { k: "cr.lic.github-pages" },
          k: "cr.github-pages" }
      ]
    },
    {
      k: "cr.g.dist",
      items: [
        { name: "ungoogled-chromium", url: "https://github.com/ungoogled-software/ungoogled-chromium",
          by: "ungoogled-chromium contributors", lic: "BSD-3-Clause",
          k: "cr.ungoogled-chromium" },
        { name: "Chromium", url: "https://www.chromium.org/",
          by: "The Chromium Authors", lic: { k: "cr.lic.chromium" },
          k: "cr.chromium" },
        { name: "Debian 13", url: "https://www.debian.org/",
          by: "The Debian Project and the authors of each package", lic: { k: "cr.lic.debian" },
          k: "cr.debian" },
        { name: "cage", url: "https://github.com/cage-kiosk/cage",
          by: "Jente Hidskes Ankarberg & contributors", lic: "MIT",
          k: "cr.cage" },
        { name: "Go", url: "https://go.dev/",
          by: "The Go Authors", lic: "BSD-3-Clause",
          k: "cr.go" },
        { name: "orOS Drive Go modules (fyne systray, fsnotify, go-fuse, go-keyring, golang.org/x)", url: "https://github.com/koulaxizis/oros-drive",
          by: "Their authors", lic: "Apache-2.0, BSD-3-Clause, MIT",
          k: "cr.drive-modules" },
        { name: "orOS installers' tray Go modules (fyne systray, godbus, golang.org/x/sys)", url: "https://github.com/koulaxizis/oros-portable",
          by: "Their authors", lic: "Apache-2.0, BSD-2-Clause, BSD-3-Clause",
          k: "cr.tray-modules" },
        { name: "Tor Browser", url: "https://www.torproject.org/",
          by: "The Tor Project", lic: { k: "cr.lic.tor-browser" },
          k: "cr.tor-browser" },
        { name: "Tor button's Go modules (ProtonMail go-crypto, CIRCL, golang.org/x/crypto, ulikunitz/xz)", url: "https://github.com/ProtonMail/go-crypto",
          by: "The Go Authors, Proton AG, Cloudflare, Ulrich Kunitz", lic: "BSD-3-Clause",
          k: "cr.tor-modules" },
        { name: "Inno Setup", url: "https://jrsoftware.org/isinfo.php",
          by: "Jordan Russell & Martijn Laan; Greek texts by Anastasis Chatzioglou, XhmikosR, Vasileios Karamichail", lic: "Inno Setup License",
          k: "cr.inno-setup" },
        { name: "AppImage (appimagetool, type2-runtime)", url: "https://appimage.org/",
          by: "probonopd & AppImage contributors", lic: { k: "cr.lic.appimage" },
          k: "cr.appimage" },
        { name: "Android Browser Helper 2.7.4", url: "https://github.com/GoogleChrome/android-browser-helper",
          by: "Google LLC", lic: "Apache-2.0",
          k: "cr.android-browser-helper" }
      ]
    },
    {
      k: "cr.g.ideas",
      items: [
        { name: "Since Us", url: "https://f-droid.org/packages/app.sinceus",
          by: "DerDieDasLian", lic: { k: "cr.lic.ideas" },
          k: "cr.since-us" }
      ]
    }
  ];

  function creditsThanksText() {
    return window.t("cr.thanks");
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
    sum.textContent = window.t("cr.title");
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
      gh.textContent = window.t(g.k);
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
          (typeof it.lic === "string" ? it.lic : window.t(it.lic.k)) +
          " — " + window.t(it.k)));
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
    // One sentence with three links: "own.cred" = "Designed with <3 by
    // {a}. Assisted by {b}. Audited by {c}." (text nodes, no innerHTML).
    var links = { a: ["https://koulaxizis.gr", "Christos Koulaxizis"], b: ["https://lumo.proton.me/", "Lumo"], c: ["https://claude.ai/", "Claude"] };
    window.t("own.cred").split(/(\{[abc]\})/).forEach(function (part) {
      var m = /^\{([abc])\}$/.exec(part);
      if (m) cred.appendChild(creditLink(links[m[1]][0], links[m[1]][1]));
      else if (part) cred.appendChild(document.createTextNode(part));
    });
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
        '<div class="sc-row sc-service"><span>' + escapeHtml(window.t("sc.info.extsvc.webimport")) + '</span></div>' +
        '<div class="sc-row sc-service"><span>' + escapeHtml(window.t("sc.info.extsvc.podcasts")) + '</span></div>' +
        '<div class="sc-row sc-service"><span>' + escapeHtml(window.t("maps.providers")) + '</span></div>' +
        '<div class="sc-row sc-service"><span>' + escapeHtml(window.t("sc.info.extsvc.television")) + '</span></div>' +
        '<div class="sc-row sc-service"><span>' + escapeHtml(window.t("sc.info.extsvc.pubdomain")) + '</span></div>' +
        '<div class="sc-row sc-service"><span>' + escapeHtml(window.t("sc.info.extsvc.museum")) + '</span></div>' +
        '<div class="sc-row sc-service"><span>' + escapeHtml(window.t("sc.info.extsvc.shelf")) + '</span></div>' +
        '<div class="sc-row sc-service"><span>' + escapeHtml(window.t("sc.info.extsvc.units")) + '</span></div>' +
        '<div class="sc-row sc-service"><span>' + escapeHtml(window.t("sc.info.extsvc.assistant")) + '</span></div>' +
        '<div class="sc-sec">' + escapeHtml(window.t("sc.info.shortcuts")) + '</div>' +
        rows +
        '<div class="sc-reset-wrap" id="sc-reset-wrap"></div>' +
        '<div class="sc-foot"><span>' + escapeHtml(window.t("sc.info.repo")) + ': <a href="https://github.com/koulaxizis/oros" ' +
          'target="_blank" rel="noopener">koulaxizis/oros</a> · <a href="download/" target="_blank" rel="noopener">' +
          escapeHtml(window.t("sc.info.download")) + '</a> · <a href="privacy.html" target="_blank" rel="noopener">' +
          escapeHtml(window.t("sc.info.privacy")) + '</a></span>' +
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

  // Montage keeps device-only media outside orosFS (OPFS dir
  // "montage-media", IDB fallback "oros-montage-media", thumbnails and
  // waveforms in "oros-montage-thumbs"), so neither the orosFS wipe nor
  // the sweep sees it. The two IDBs go in stage 2; the OPFS dir here.
  function wipeMontageMedia() {
    try {
      if (!navigator.storage || typeof navigator.storage.getDirectory !== "function") return Promise.resolve(false);
      return Promise.race([
        navigator.storage.getDirectory().then(function (r) { return r.removeEntry("montage-media", { recursive: true }); })
          .then(function () { return true; }, function () { return false; }),
        new Promise(function (res) { setTimeout(function () { res(false); }, 5000); })
      ]);
    } catch (e) { return Promise.resolve(false); }
  }

  // Maps offline map packs (maps wave 51): OPFS dir "maps-packs",
  // device-only and outside orosFS, like Montage's media.
  function wipeMapPacks() {
    try {
      if (!navigator.storage || typeof navigator.storage.getDirectory !== "function") return Promise.resolve(false);
      return Promise.race([
        navigator.storage.getDirectory().then(function (r) { return r.removeEntry("maps-packs", { recursive: true }); })
          .then(function () { return true; }, function () { return false; }),
        new Promise(function (res) { setTimeout(function () { res(false); }, 5000); })
      ]);
    } catch (e) { return Promise.resolve(false); }
  }

  // deviceOnly (screen lock, "Reset this device"): the same local
  // wipe, but the cloud and the backup folder stay; `cloud` is then the
  // last push of unsynced changes (lockDeviceReset).
  function scFactoryReset(btn, deviceOnly) {
    btn.disabled = true;
    btn.textContent = window.t("sc.reset.working");

    // Cloud wipe (15s cap — a hanging network can never freeze the
    // reset; wipeEverything suspends the engine synchronously at call).
    var cloud = deviceOnly ? lockLastPush()
      : (window.orosSync && typeof window.orosSync.wipeEverything === "function")
      ? Promise.race([
          window.orosSync.wipeEverything(),
          new Promise(function (res) { setTimeout(function () { res(null); }, 15000); })
        ]).catch(function () { return null; })
      : Promise.resolve(null);

    // Folder wipe FIRST — it needs the oros-fs handle, which the
    // upcoming local sweep would orphan. OrosFS wipe rides along —
    // independent storage, best-effort like the rest.
    Promise.all([deviceOnly ? false : wipeFolderMirror(), wipeOrosFS(), wipeMapTiles(), wipeMontageMedia(), wipeMapPacks(), cloud]).then(function () {
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

  // Screen lock (lock.js), "Reset this device": changes this device
  // has not synced yet go up first when sync can (connected, unlocked,
  // 15s cap), then the engine stops and the local wipe runs. The cloud
  // and its backups stay: connecting sync again brings everything back.
  function lockLastPush() {
    var S = window.orosSync;
    var push = Promise.resolve(null);
    if (S && S.isConnected() && S.hasPassphrase() && S.isDirty()) {
      push = Promise.race([
        S.push().catch(function () { return null; }),
        new Promise(function (res) { setTimeout(function () { res(null); }, 15000); })
      ]);
    }
    return push.then(function () {
      if (S && typeof S.suspendEngine === "function") S.suspendEngine();
    }).catch(function () { return null; });
  }
  function lockDeviceReset() {
    if (osResetting) return;
    scFactoryReset({ disabled: false, textContent: "" }, true);
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
    ["oros-vault", "oros-fs", "oros-ofs", "oros-wallpaper", "oros-mail", "oros-feeds", "oros-museum", "oros-jigsaw", "oros-montage-media", "oros-montage-thumbs", "oros-maps-rec", "oros-links", "oros-chess", "oros-files-dbx", "oros-time-stage", "oros-podcasts", "oros-podcasts-sync", "oros-music", "oros-lyricsync", "oros-dav", "oros-pad", "oros-assistant", "oros-legacy"].forEach(function (name) {
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
    { key: "h", label: "sc.desc.help",       fn: function() { openHelp(); } },
    { key: "t", label: "sc.desc.timer",      fn: scTimesheetToggle },
    { key: "a", label: "sc.desc.assistant",  fn: function() { openAssistant(); } },
    { key: "y", label: "sc.desc.today",      fn: function() { openAppById("today"); } },
    { key: "n", label: "sc.desc.stickies",   fn: scNewSticky },
    { key: "k", label: "sc.desc.cmdbar",     fn: function() { openCmdBar(); } },
    { key: "w", label: "sc.desc.switcher",   fn: function() { mtSwitcher(); } },
    { key: "q", label: "sc.desc.quickask",   fn: function() { if (window.orosQuick) window.orosQuick.mini(); else openAssistant(); } },
    { key: "m", label: "sc.desc.qs",         fn: function() { if (window.orosQS) window.orosQS.toggle(); } }
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
        shLoc(),
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
    if ((!wxTrayOn() && !wgWantsWeather()) || !navigator.onLine) return;
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
          window.orosNotifs.emit({
            ns: "weather",
            key: "trayfail-" + sysYmd(),
            type: "sys",
            title: window.t("app.weather"),
            body: window.t("n.wx.fail")
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
    appFrames().forEach(function (f) {
      try {
        if (f && f.contentWindow &&
            typeof f.contentWindow.__orosWeatherUpdate === "function") {
          f.contentWindow.__orosWeatherUpdate(w);
        }
      } catch (e) { /* app not running/loaded — tray keeps it */ }
    });
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
    if (todayAbsorbs("weather")) return;   // today's summary carries the weather line

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
    // TODAY's row only, from a cache of the last 24 hours: the
    // briefing used to take the max / min / rain of all 7 days, and
    // spoke from a cache of any age.
    if (typeof p.at === "number" && Date.now() - p.at > 24 * 3600000) return;
    var todayRows = p.daily.filter(function (dd) { return dd && dd.date === sysYmd(); });
    if (!todayRows.length) return;

    var code = Number(p.current.code) || 0;
    var maxPop = 0, dmax = null, dmin = null;
    todayRows.forEach(function (dd) {
      if (dd.pop > maxPop) maxPop = dd.pop;
      if (dd.max !== null && (dmax === null || dd.max > dmax)) dmax = dd.max;
      if (dd.min !== null && (dmin === null || dd.min < dmin)) dmin = dd.min;
    });
    var brief;                              // n.wx.brief.<kind>
    if (code >= 95) brief = "storm";
    else if (code === 45 || code === 48) brief = "fog";
    else if (maxPop >= 60 || (code >= 51 && code <= 67) || (code >= 80 && code <= 82)) brief = "rain";
    else if (p.current.uv !== null && p.current.uv >= 6) brief = "uv";
    else if (dmax !== null && dmax >= 33) brief = "hot";
    else if (dmin !== null && dmin <= 0) brief = "freeze";
    else if (dmax !== null && dmin !== null && (dmax - dmin) > 12) brief = "swing";
    else return;   // pleasant day — no briefing noise

    window.orosNotifs.emit({
      ns: "weather",
      key: "brief-" + sysYmd(),
      type: "reminder",
      title: best.label || window.t("app.weather"),
      body: window.t("n.wx.brief." + brief),
      deepLink: "weather:open"
    });
  }

  // Official weather warnings (MeteoAlarm, Weather wave 38). Off by
  // default: the Weather app's device-local pref
  // `oros-weatherapp-prefs`.notify = "severe" (orange + red) or "all".
  // For the taskbar's city (nearest app city within WX_NEAR_DEG, else
  // the first). Reads the app's device-local warnings cache
  // `oros-weatherapp-warn`; when it is older than an hour the shell
  // reads the feed itself, straight from the browser only (the app
  // can also use the Mail relay). One notice per warning, ever
  // (`sent` keeps the keys until the warning expires). Parsing and
  // the city's area: weather/core.js (OrosWeatherCore).
  var wxWarnLastTick = 0, wxWarnBusy = false, wxWarnTryAt = 0;
  function wxWarnTickThrottled() {
    var now = Date.now();
    if (now - wxWarnLastTick < 60000) return;
    wxWarnLastTick = now;
    wxWarnTick();
  }
  function wxWarnRead(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  }
  function wxWarnTick() {
    var C = window.OrosWeatherCore;
    if (!C || !(window.orosNotifs && typeof window.orosNotifs.emit === "function")) return;
    var prefs = wxWarnRead("oros-weatherapp-prefs");
    var mode = prefs && prefs.notify;
    if (mode !== "severe" && mode !== "all") return;
    if (prefs.warnOn === false) return;
    var data = wxWarnRead("oros-weatherapp-data");
    if (!data || !Array.isArray(data.cities) || !data.cities.length) return;
    var cities = data.cities.filter(function (c) {
      return c && typeof c.id === "string" && typeof c.lat === "number" && typeof c.lon === "number";
    });
    if (!cities.length) return;
    var w = wxLoc(), city = null, bestD = Infinity;
    if (w) cities.forEach(function (c) {
      var d = Math.abs(c.lat - w.lat) + Math.abs(c.lon - w.lon);
      if (d < bestD) { bestD = d; city = c; }
    });
    if (!city || bestD >= WX_NEAR_DEG) {
      city = cities.slice().sort(function (a, b) { return (Number(a.pos) || 0) - (Number(b.pos) || 0); })[0];
    }
    var cache = wxWarnRead("oros-weatherapp-cache");
    var p = cache && typeof cache === "object" ? cache[city.id] : null;
    var slug = C.slugFor(city.cc, p && p.tzn), url = C.feedUrl(slug);
    if (!url) return;
    var store = wxWarnRead("oros-weatherapp-warn");
    if (!store || typeof store !== "object") store = {};
    if (!store.feeds || typeof store.feeds !== "object") store.feeds = {};
    if (!store.sent || typeof store.sent !== "object") store.sent = {};
    var feed = store.feeds[slug], now = Date.now();
    var okAt = (feed && feed.ok) || 0;
    if (now - okAt > 3600000 && now - wxWarnTryAt > 3600000 && !wxWarnBusy && navigator.onLine !== false) {
      wxWarnBusy = true;
      wxWarnTryAt = now;
      fetch(url, { credentials: "omit", referrerPolicy: "no-referrer", cache: "no-cache" })
        .then(function (r) { return r.ok ? r.text() : null; })
        .then(function (text) {
          var list = text ? C.parseAtom(text) : null;
          if (!list) return;
          var s2 = wxWarnRead("oros-weatherapp-warn");
          if (!s2 || typeof s2 !== "object") s2 = {};
          if (!s2.feeds || typeof s2.feeds !== "object") s2.feeds = {};
          var t2 = Date.now();
          s2.feeds[slug] = { at: t2, ok: t2, list: C.activeList(list, t2).slice(0, 300), err: "", via: "direct" };
          try { localStorage.setItem("oros-weatherapp-warn", JSON.stringify(s2)); } catch (e) {}
          wxWarnLastTick = 0;               // emit on the next tick
        })
        .catch(function () { /* CORS or offline: the app (relay) still can */ })
        .then(function () { wxWarnBusy = false; });
    }
    if (!feed || !Array.isArray(feed.list) || now - okAt > 6 * 3600000) return;
    var mine = C.forCity(C.activeList(feed.list, now), city).mine;
    var lang = localStorage.getItem("oros-lang") === "el" ? "el" : "en";
    var changed = false;
    Object.keys(store.sent).forEach(function (k) {
      if (!(store.sent[k] > now)) { delete store.sent[k]; changed = true; }
    });
    mine.forEach(function (x) {
      if (mode === "severe" && x.level < 3) return;
      var key = "warn-" + slug + "-" + String(x.id).slice(-60) + "-" + C.fold(x.area).slice(0, 30);
      if (store.sent[key]) return;
      // in the city's clock (the app's cache knows its offset), like the app
      var tzOff = (p && typeof p.tz === "number") ? p.tz : null;
      var until = typeof x.exp === "number"
        ? new Date(x.exp + (tzOff !== null ? tzOff * 1000 : 0)).toLocaleString(window.orosI18n ? window.orosI18n.locale(state.lang) : (lang === "el" ? "el-GR" : "en-GB"),
            tzOff !== null ? { weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" }
                           : { weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
        : "";
      window.orosNotifs.emit({
        ns: "weather",
        key: key,
        type: "reminder",
        title: C.warnTitle(x, lang),
        body: [city.label || "", x.area, until ? tr("n.wx.until", { time: until }) : ""]
          .filter(Boolean).join(" · "),
        deepLink: "weather:open"
      });
      store.sent[key] = typeof x.exp === "number" ? x.exp : now + 2 * 86400000;
      changed = true;
    });
    if (changed) {
      var s3 = wxWarnRead("oros-weatherapp-warn");
      if (!s3 || typeof s3 !== "object") s3 = { feeds: {} };
      s3.sent = store.sent;
      try { localStorage.setItem("oros-weatherapp-warn", JSON.stringify(s3)); } catch (e) {}
    }
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


  // Back from the Dropbox sign-in with no passphrase on this device
  // (a new device, "I already use orOS on another device", or Connect
  // in Settings): the page reloaded on the desktop, but the passphrase
  // is the next step, so Settings › Sync opens again. A remembered
  // passphrase (vault auto-unlock) or a single app taking the sign-in
  // back leaves the desktop as it is.
  function syncPassAfterSignIn() {
    var S = window.orosSync;
    if (!S || !S.vaultUnlocked || SOLO) return;
    S.vaultUnlocked.then(function () {
      if (typeof S.leftForSolo === "function" && S.leftForSolo()) return;
      var tries = 0;
      (function wait() {
        if (!S.isConnected() || S.hasPassphrase()) return;
        // Splash still up or apps.json not in yet.
        if (document.getElementById("oro-splash") || !state.apps.length) {
          if (++tries > 120) return;
          setTimeout(wait, 250);
          return;
        }
        if (window.orosSettings) window.orosSettings.open("sync");
      })();
    }, function () {});
  }

  function initSyncIntegration() {
    registerShellSlice();
    fdMigrateLegacy();          // FILES-V: one-time cleanup of the blob model
    legacyLsMove();             // SY-Q2: retired snapshots out of localStorage
    registerRadioProxySlice();
    registerShareOutSlice();
    registerTelevisionProxySlice();
    registerMailProxySlice();

    // OAuth return → flip the menu to connected state once tokens land
    if (window.orosSync && window.orosSync.redirectHandled) {
      window.orosSync.redirectHandled.then(function (handled) {
        if (!handled) return;
        renderMenu();
        syncPassAfterSignIn();
      });
    }

    // WebDAV W4: a move started before the Dropbox sign-in finished on
    // boot; its progress shows in Settings › Sync.
    if (window.orosSync && typeof window.orosSync.onMove === "function") {
      window.orosSync.onMove(function (p) {
        if (p.done >= p.total) return;
        state.syncMsg = { kind: "dim", text: window.t("sync.move.progress")
          .replace("{done}", String(p.done)).replace("{total}", String(p.total)) };
        renderMenu();
      });
    }
    if (window.orosSync && window.orosSync.moveDone) {
      window.orosSync.moveDone.then(function (r) {
        if (r && r.moved) { state.syncUserEmail = null; setSyncMsg("ok", "sync.move.ok"); }
        else if (r && r.error) handleSyncError(r.error);
      });
    }

    // Vault auto-unlock settled → re-render (dot turns "on" without user
    // ever typing the passphrase; silent pull already handled by engine)
    if (window.orosSync && window.orosSync.vaultUnlocked) {
      window.orosSync.vaultUnlocked.then(function () {
        renderMenu();
      });
    }

    if (window.orosSync && typeof window.orosSync.onApplyFailed === "function") {
      window.orosSync.onApplyFailed(syncApplyFailNotice);
    }
    if (window.orosSync && typeof window.orosSync.setRescueSink === "function") {
      window.orosSync.setRescueSink(syncRescueSink);
      window.orosSync.onRestored(syncRestoredNotice);
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
          syncAutoFailNotice(err);   // A72
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
  // Time wave 5: a kitchen timer picks one of these voices (stored in
  // the Time app's device-local oros-time-timers, found by alarm id).
  // "beep" is the original three pips. Each pattern fits in the 1.5 s
  // repeat. [frequency Hz, start s]
  var ALARM_SOUNDS = {
    beep:    { type: "sine",     len: 0.18, vol: 0.16, notes: [[880, 0], [880, 0.24], [880, 0.48]] },
    chime:   { type: "sine",     len: 0.45, vol: 0.14, notes: [[1318.5, 0], [1046.5, 0.3], [784, 0.6]] },
    bell:    { type: "triangle", len: 0.9,  vol: 0.22, notes: [[660, 0], [990, 0.01], [660, 0.6]] },
    digital: { type: "square",   len: 0.07, vol: 0.05, notes: [[1250, 0], [1250, 0.12], [1250, 0.24], [1250, 0.36], [1250, 0.6], [1250, 0.72], [1250, 0.84], [1250, 0.96]] },
    gentle:  { type: "sine",     len: 0.55, vol: 0.1,  notes: [[523.25, 0], [659.25, 0.32], [783.99, 0.64]] }
  };
  function alarmPip(name) {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!alarmRing.ctx) alarmRing.ctx = new AC();
      var ctx = alarmRing.ctx;
      if (ctx.state === "suspended") {
        ctx.resume().catch(function () {});
      }
      // resumed is async — schedule pips anyway; they'll fire when ready
      var snd = ALARM_SOUNDS[name] || ALARM_SOUNDS.beep;
      var t0 = ctx.currentTime;
      for (var i = 0; i < snd.notes.length; i++) {
        var o = ctx.createOscillator();
        var g = ctx.createGain();
        o.type = snd.type;
        o.frequency.value = snd.notes[i][0];
        var ts = t0 + snd.notes[i][1];
        g.gain.setValueAtTime(0.0001, ts);
        g.gain.exponentialRampToValueAtTime(snd.vol, ts + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ts + snd.len);
        o.connect(g);
        g.connect(ctx.destination);
        o.start(ts);
        o.stop(ts + snd.len + 0.02);
      }
    } catch (e) { /* no audio — visual toast stands alone */ }
  }
  // The voice of a kitchen timer's alarm; every other alarm beeps,
  // unless the Time app's "Sound" box is off ("" = silent: overlay
  // only). Before 4.66.01 that box had no effect inside orOS.
  function alarmSoundOf(a) {
    if (!a || !alarmIsTimer(a.id)) {
      try {
        var td = JSON.parse(localStorage.getItem("oros-time-data"));
        if (td && td.sound === false) return "";
      } catch (e) {}
      return "beep";
    }
    try {
      var list = JSON.parse(localStorage.getItem("oros-time-timers"));
      for (var i = 0; Array.isArray(list) && i < list.length; i++) {
        if (list[i] && list[i].aid === a.id && (ALARM_SOUNDS[list[i].sound] || ALARM_RT.test(list[i].sound))) return list[i].sound;
      }
    } catch (e) {}
    return "beep";
  }
  // A timer can also ring with a Ringtone Composer melody, "rt:<id>"
  // (stickies/host.js window.orosMelodies; gone → the beep).
  var ALARM_RT = /^rt:[A-Za-z0-9_-]{1,64}$/;
  function alarmVoice(name) {
    if (ALARM_RT.test(name) && window.orosMelodies) {
      window.orosMelodies.play(name.slice(3), function () { alarmPip("beep"); }, 15);
      return;
    }
    alarmPip(name);
  }
  // Preview for the Time app's sound pickers (same voices).
  window.orosAlarmSound = function (name) {
    if (typeof name === "string" && (ALARM_SOUNDS[name] || ALARM_RT.test(name))) alarmVoice(name);
  };

  function alarmStopRing() {
    if (alarmRing.timer) { clearInterval(alarmRing.timer); alarmRing.timer = null; }
    try { if (window.orosMelodies) window.orosMelodies.stop(); } catch (e) {}
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
        deepLink: alarmIsTimer(a.id) ? "time:timer" : "time:alarms"
      });
    }
    alarmStopRing();
    var voice = alarmSoundOf(a);
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
      shLoc(),
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
    if (voice) {
      alarmVoice(voice);
      // a melody (≤ 15 s) plays again after a pause, the pips every 1.5 s
      alarmRing.timer = setInterval(function () { alarmVoice(voice); }, ALARM_RT.test(voice) ? 17000 : 1500);
    }
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
    // BR-PHONE v3: the Android app already rang this one while orOS
    // was closed. Advance/retire as usual, but don't ring it late.
    var rangOnPhone = false;
    try {
      rangOnPhone = Date.now() - due.at > 60000 && !!(window.orosPhone && window.orosPhone.handles &&
        window.orosPhone.handles("time:alarm-" + due.id + "-" + ymdOf(due.at)));
    } catch (e) {}
    // #9: a fired alarm MUTATED data (daily advance / once retire) —
    // same dirty contract as orosAlarms.add/remove. Without this, the
    // firing never reaches the cloud and other devices ring again.
    if (window.orosSync && typeof window.orosSync.markDirty === "function") {
      window.orosSync.markDirty();
    }
    if (!rangOnPhone) { alarmNotify(due); alarmRadio(due); }
  }
  // W42 — "wake up to a station": Radio keeps { alarmId: { m, st } } in
  // its slice (oros-radio-data .wake, st null = removed). Radio's engine
  // (radio/tools.js, in this window once Radio was opened) plays it in
  // place with a fade-in; otherwise the Radio app opens and plays it
  // (sessionStorage "oros-radio-wake" asks for the fade-in).
  function alarmRadio(a) {
    try {
      var r = JSON.parse(localStorage.getItem("oros-radio-data") || "null");
      var w = r && r.wake && typeof r.wake === "object" ? r.wake[a.id] : null;
      var st = w && w.st;
      if (!st || typeof st.stationuuid !== "string" || !st.stationuuid) return;
      var eng = window.__orosRadioEngine;
      if (eng && typeof eng.wake === "function" && eng.wake(st)) return;
      try { sessionStorage.setItem("oros-radio-wake", "1"); } catch (e) {}
      if (typeof window.__orosOpenRadio === "function") window.__orosOpenRadio(st.stationuuid);
    } catch (e) {}
  }
  function ymdOf(ms) {
    var d = new Date(ms);
    return d.getFullYear() + "-" + (d.getMonth() < 9 ? "0" : "") + (d.getMonth() + 1) + "-" + (d.getDate() < 10 ? "0" : "") + d.getDate();
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
      if (gone && !alarmIsTimer(id)) {
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

  // Start timestamp of one OCCURRENCE — ev.start rides along with
  // every occurrence; all-day = local midnight.
  function calRemOccTs(ev, y, m, d) {
    var ts = new Date(y, m, d, 0, 0, 0).getTime();
    if (ev.start && /^\d{2}:\d{2}$/.test(ev.start)) {
      ts += (+ev.start.slice(0, 2)) * 3600000 + (+ev.start.slice(3)) * 60000;
    }
    return ts;
  }

  // Occurrences come from calendar/occur.js (window.OrosCalOccur), the
  // same walk the Calendar draws and the Today summary reads: sticky
  // clamp (Jan 31 → Feb 28 → Mar 31), D/W step days, interval 2 =
  // bi-weekly, exdates skipped, "until" stops the walk.
  // cb(ts, ymd) — return false to stop iterating.
  function calRemEachOccurrence(ev, cb) {
    var OCC = window.OrosCalOccur;
    if (!OCC) return;                                  // stale bundle — silent
    OCC.eachOccurrence(ev, function (occYmd) {
      var p = occYmd.split("-");
      // occur.js startTs: an event kept in its own time zone fires at
      // that zone's time (wave 5); everything else as before.
      return cb(typeof OCC.startTs === "function" ? OCC.startTs(ev, occYmd)
                                                  : calRemOccTs(ev, +p[0], +p[1] - 1, +p[2]), occYmd);
    });
  }

  function calRemTick() {
    var raw;
    try { raw = JSON.parse(localStorage.getItem(CALREM_DATA_KEY)); }
    catch (e) { raw = null; }
    // BR-HH: calendars shared with a household (calendar/house.js
    // mirror, this device's own reminders)
    var hhCal = null;
    try { hhCal = JSON.parse(localStorage.getItem("oros-calendar-hh")); } catch (e) {}
    if (hhCal && Array.isArray(hhCal.events) && hhCal.events.length) {
      raw = { events: (raw && Array.isArray(raw.events) ? raw.events : []).concat(hhCal.events) };
    }
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
          check(ev, remindMin, (window.OrosCalOccur && typeof window.OrosCalOccur.startTs === "function" && /^\d{4}-\d{2}-\d{2}$/.test(ev.date) ? window.OrosCalOccur.startTs(ev, ev.date) : calRemOccTs(ev, +p[0], +p[1] - 1, +p[2])), ev.date);
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
          title: due.ev.title || window.t("rem.title"),
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
    var loc = shLoc();
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
    var loc = shLoc();
    var titleTxt = window.t("rem.title");
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

  // The rule lives in mood/core.js (OrosMoodCore, loaded by
  // index.html), shared with the Today summary.
  function moodRaw() {
    try { return JSON.parse(localStorage.getItem("oros-mood-data")); } catch (e) { return null; }
  }
  function moodCheckInHasToday() {
    var MC = window.OrosMoodCore;
    return !!(MC && MC.hasOn(moodRaw(), moodCheckInDayKey()));
  }

  // SH-B7 (owner decision 2026-10-05): a reminder only makes sense
  // once the app has data. No Mood entry ever → no daily nagging.
  function moodHasAnyEntry() {
    var MC = window.OrosMoodCore;
    return !!(MC && MC.hasAny(moodRaw()));
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
        title: window.t("n.mood.title"),
        body: window.t("n.mood.body"),
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
  // origin — moodCheckInTick pattern) and asks cycle/core.js
  // (OrosCycleCore.dueIn, loaded by index.html: the SAME file the
  // app runs) whether the predicted start is ≤2 days away or past.
  // The i18n strings are DUPLICATED here on purpose — cycle.js
  // STRINGS are unreachable with the app closed; keys/bodies must
  // stay IDENTICAL so the app-open and app-closed paths produce the
  // same dedup key. If a string changes in cycle.js, change it here
  // too (maintenance note — changelog knows).
  var CYCLE_DATA_KEY = "oros-cycle-data";

  function cycleShellCheck() {
    var raw;
    try { raw = JSON.parse(localStorage.getItem(CYCLE_DATA_KEY)); }
    catch (e) { return null; }
    if (!raw || !Array.isArray(raw.periods)) return null;
    if (raw.prefs && raw.prefs.remind === false) return null;
    var CC = window.OrosCycleCore;
    if (!CC) return null;                               // stale bundle — silent

    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    var due = CC.dueIn(raw.periods, today);
    if (!due) return null;
    var daysLeft = due.daysLeft, ymd = due.ymd;

    if (daysLeft >= 0) {
      return {
        key: "pred-" + ymd + "-soon",
        title: window.t("app.cycle"),
        body: tr("n.cycle.soon", { n: Math.max(1, daysLeft) }),
        deepLink: "cycle:pred:" + ymd
      };
    }
    return {
      key: "pred-" + ymd + "-late",
      title: window.t("app.cycle"),
      body: tr("n.cycle.late", { n: -daysLeft }),
      deepLink: "cycle:pred:" + ymd
    };
  }
  
    // Wave 7 — Todo due reminders (#TD4). Shell-side scan of
  // "oros-todo-data" (same doctrine as cycleShellCheck: app stays
  // untouched, works with the app closed, dedup key carries the
  // day + count so a GROWING backlog re-fires — new information,
  // not spam). Criterion = todo/core.js dueSummary: !done && due <=
  // today, "due or overdue" (the app's own overdueCount badge counts
  // only due < today). Suppression = the "todo" toggle in Settings →
  // Notifications; no in-app pref by design.
  var TODO_DATA_KEY = "oros-todo-data";

  function todoCheckTick() {
    var raw;
    try { raw = JSON.parse(localStorage.getItem(TODO_DATA_KEY)); }
    catch (e) { return; }
    if (!raw || !Array.isArray(raw.lists)) return;
    var TC = window.OrosTodoCore;
    if (!TC) return;                                    // stale bundle — silent

    var today = sysYmd();
    var sum = TC.dueSummary(raw, today);
    var due = sum.count, earliestList = sum.earliestList;
    if (due === 0) return;
    if (todayAbsorbs("todo")) return;                   // said in today's summary

    var N = window.orosNotifs;
    if (!(N && typeof N.emit === "function")) return;   // stale bundle — silent

    var title = window.t("app.todo");
    if (title === "app.todo") title = "To-Do";          // missing-key fallback
    N.emit({
      ns: "todo",
      key: "due-" + today + "-" + due,
      type: "due",
      title: title,
      body: trn("rem.todo", due),
      deepLink: earliestList ? "todo:" + earliestList : ""
    });
  }

  // Wave 13 — Quote due-date reminders. Shell-side scan of
  // "oros-quote-data" for sent/accepted quotes with due dates
  // within ≤2 days or overdue (quote/core.js dueQuotes, shared with
  // the Today summary). Drafts/expired/rejected and quotes without
  // a due date excluded.
  // Dedup key "due-<ymd>-<count>" prevents spam while growing
  // backlogs re-trigger (new information each time).
  var QUOTE_DATA_KEY = "oros-quote-data";

  function quoteCheckTick() {
    var raw;
    try { raw = JSON.parse(localStorage.getItem(QUOTE_DATA_KEY)); }
    catch (e) { return; }
    if (!raw || !Array.isArray(raw.quotes)) return;
    var QC = window.OrosQuoteCore;
    if (!QC) return;                                    // stale bundle — silent

    var today = sysYmd();
    // Horizon: today + 2 days (≤2 days or overdue)
    var hd = new Date();
    hd.setDate(hd.getDate() + 2);
    var p2 = function (n) { return (n < 10 ? "0" : "") + n; };
    var horizon = hd.getFullYear() + "-" + p2(hd.getMonth() + 1) + "-" + p2(hd.getDate());
    var list = QC.dueQuotes(raw, horizon);
    var due = list.length, earliestId = due ? list[0].id : null;
    if (due === 0) return;
    if (todayAbsorbs("quote")) return;                  // said in today's summary

    var N = window.orosNotifs;
    if (!(N && typeof N.emit === "function")) return;   // stale bundle — silent

    var title = window.t("app.quote");
    if (title === "app.quote") title = "Quote";         // missing-key fallback
    N.emit({
      ns: "quote",
      key: "due-" + today + "-" + due,
      type: "due",
      title: title,
      body: trn("n.quote.due", due),
      deepLink: earliestId ? "quote:" + earliestId : ""
    });
  }

  // Invoices wave 2 — due / overdue reminder. Shell-side scan of
  // "oros-invoices-data" with invoices/core.js (reminder: the same
  // rule as the Calendar feed and Today): issued documents with money
  // still owed, overdue or due within 2 days. Key "due-<ymd>-<late>-
  // <soon>": once a day, again when the list grows. Said in today's
  // summary → silent. Click → the first document.
  var INV_DATA_KEY = "oros-invoices-data";
  var invoicesCheckLastTick = 0;
  function invoicesCheckTickThrottled() {
    var now = Date.now();
    if (now - invoicesCheckLastTick < 60000) return;
    invoicesCheckLastTick = now;
    invoicesCheckTick();
  }
  function invoicesCheckTick() {
    var IC = window.OrosInvoicesCore;
    if (!IC) return;                                    // stale bundle — silent
    var raw;
    try { raw = localStorage.getItem(INV_DATA_KEY); } catch (e) { return; }
    if (!raw) return;
    var data = IC.parse(raw);
    if (!data) return;
    var r = IC.reminder(data, sysYmd(), 2);
    if (!r) return;
    if (todayAbsorbs("invoices")) return;               // said in today's summary
    var N = window.orosNotifs;
    if (!(N && typeof N.emit === "function")) return;   // stale bundle — silent
    var title = window.t("app.invoices");
    if (title === "app.invoices") title = "Invoices";   // missing-key fallback
    var parts = [];
    if (r.late) parts.push(trn("n.inv.late", r.late));
    if (r.soon) parts.push(trn("n.inv.soon", r.soon));
    N.emit({
      ns: "invoices",
      key: r.key,
      type: "due",
      title: title,
      body: trn("n.inv.body", r.late + r.soon, { parts: parts.join(" · ") }),
      deepLink: "invoices:" + r.first
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
    if (appLive("cycle")) {
      // App open: the iframe owns the decision (prefs + math +
      // i18n — all in cycle.js). Mid-load iframe → next tick.
      var f = appFrameOf("cycle");
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
    pp.title = window.t(paused ? "rxt.play" : "rxt.pause");
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

    row.appendChild(mkIcoBtn(RX_STOP, window.t("rxt.stop"), function () {
      rxTrayStop();
      rxTrayPaintLive();
    }));

    row.appendChild(mkIcoBtn(
      RX_PLAY, window.t("rxt.playpause"),
      function () {
        var h = window.__orosRadioHost;
        if (h && h.audio) {
          if (h.audio.paused) rxTrayPlay(); else rxTrayStop();
        }
        rxTrayPaintLive();
      }, "rx-pop-pp"));

    row.appendChild(mkIcoBtn(RX_HEART, window.t("rxt.fav"),
      rxTrayFav));

    row.appendChild(mkIcoBtn(ICONS.radio,
      window.t("rxt.open"), function () {
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
    vol.setAttribute("aria-label", window.t("rxt.volume"));
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
      (errored ? " · " + window.t("rxt.err") : "");

    if (chip.getAttribute("data-state") !== dstate || chip.title !== title) {
      chip.setAttribute("data-state", dstate);
      chip.innerHTML = ICONS.radio;
      chip.title = title;
      chip.setAttribute("aria-label", title);   // SH-R11: state spoken
    }

    // Dropdown open → the Play/Pause icon follows live state
    if (rxTrayPop()) rxTrayPaintLive();
  }

  // ---------- Sound Mixer tray chip ----------
  // mixer/engine.js runs on THIS window (window.__orosMixerHost), so
  // the sounds keep playing after the Mixer app closes. While the
  // engine has a mix (playing or paused), the bar shows a chip; its
  // dropdown has Play/Pause, Stop, Open, volume and the sleep timer.
  // Stop ends the session and the chip goes away. Volume and timer go
  // through the host, and the app adopts them the next time it opens.
  var MX_POP_ID = "mx-tray-pop";
  var MX_TIMERS = [0, 15, 30, 60, 90];
  var mxPopWired = false;

  function mxHost() {
    var h = window.__orosMixerHost;
    return (h && typeof h.state === "function" && typeof h.subscribe === "function") ? h : null;
  }
  function mxPop() { return document.getElementById(MX_POP_ID); }
  function mxClosePop() { var p = mxPop(); if (p) p.remove(); }

  function mxLeft(st) {
    if (!st || !st.playing || !st.endAt) return "";
    var s = Math.max(0, Math.ceil((st.endAt - Date.now()) / 1000));
    var m = Math.floor(s / 60);
    return m + ":" + (s % 60 < 10 ? "0" : "") + (s % 60);
  }

  function mxWireDoc() {
    if (mxPopWired) return;
    mxPopWired = true;
    document.addEventListener("click", function (e) {
      var pop = mxPop();
      if (!pop || pop.contains(e.target)) return;
      var chip = document.getElementById("mx-tray-chip");
      if (chip && chip.contains(e.target)) return;
      mxClosePop();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") mxClosePop();
    });
  }

  // Repaint the dropdown's live parts (Play/Pause, timer chips, time left).
  function mxPaintPop() {
    var pop = mxPop(), h = mxHost();
    if (!pop || !h) return;
    var st = h.state();
    var pp = document.getElementById("mx-pop-pp");
    if (pp) {
      var paused = !st.playing;
      var tip = window.t(paused ? "rxt.play" : "rxt.pause");
      if (pp.title !== tip) {
        pp.innerHTML = paused ? RX_PLAY : RX_PAUSE;
        pp.title = tip;
        pp.setAttribute("aria-label", tip);
      }
    }
    var btns = pop.querySelectorAll("[data-mx-timer]");
    for (var i = 0; i < btns.length; i++) {
      var on = parseInt(btns[i].getAttribute("data-mx-timer"), 10) === st.timer;
      btns[i].setAttribute("aria-pressed", on ? "true" : "false");
      btns[i].style.background = on ? "var(--accent)" : "transparent";
      btns[i].style.color = on ? "var(--accent-text, #fff)" : "var(--text)";
    }
    var left = document.getElementById("mx-pop-left");
    if (left) {
      var l = mxLeft(st);
      var txt = l ? tr("mxt.left", { time: l }) : "";
      if (left.textContent !== txt) left.textContent = txt;
    }
    var vol = document.getElementById("mx-pop-vol");
    if (vol && document.activeElement !== vol && parseInt(vol.value, 10) !== st.vol) {
      vol.value = String(st.vol);
      var pct = document.getElementById("mx-pop-pct");
      if (pct) pct.textContent = st.vol + "%";
    }
  }

  function mxTogglePop() {
    if (mxPop()) { mxClosePop(); return; }
    var h = mxHost();
    if (!h) return;
    mxWireDoc();
    var st = h.state();

    var pop = document.createElement("div");
    pop.id = MX_POP_ID;
    pop.setAttribute("role", "menu");
    // Clicks inside stay inside: Play/Pause repaints its own icon, so
    // the outside-click check would no longer find the clicked node.
    pop.addEventListener("click", function (e) { e.stopPropagation(); });
    pop.style.cssText =
      "position:fixed;top:calc(48px + env(safe-area-inset-top,0px));right:12px;" +
      "z-index:1460;background:var(--panel-bg);color:var(--text);" +
      "border:1px solid var(--border);border-radius:12px;" +
      "box-shadow:0 8px 24px var(--shadow);padding:10px;" +
      "display:flex;flex-direction:column;gap:10px;" +
      "max-width:calc(100vw - 24px);";

    var lbl = document.createElement("div");
    lbl.style.cssText =
      "font-size:12px;font-weight:600;color:var(--text-dim);" +
      "max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
    lbl.textContent = st.label || window.t("app.mixer");
    pop.appendChild(lbl);

    function mkBtn(html, tip, fn, idAttr) {
      var b = document.createElement("button");
      b.type = "button";
      if (idAttr) b.id = idAttr;
      b.innerHTML = html;
      b.title = tip;
      b.setAttribute("aria-label", tip);
      b.style.cssText =
        "min-width:40px;height:40px;display:inline-flex;align-items:center;" +
        "justify-content:center;border:1px solid var(--border);" +
        "border-radius:9px;background:transparent;color:var(--text);" +
        "cursor:pointer;font:inherit;font-size:12px;padding:0 8px;";
      b.addEventListener("click", fn);
      return b;
    }

    var row = document.createElement("div");
    row.style.cssText = "display:flex;gap:6px;";
    row.appendChild(mkBtn(RX_PLAY, window.t("rxt.play"), function () {
      var x = mxHost();
      if (x) x.toggle();
      mixerTrayTick();
    }, "mx-pop-pp"));
    row.appendChild(mkBtn(RX_STOP, window.t("rxt.stop"), function () {
      var x = mxHost();
      mxClosePop();
      if (x) x.stop();
      mixerTrayTick();
    }));
    row.appendChild(mkBtn(ICONS.mixer, window.t("mxt.open"), function () {
      mxClosePop();
      if (!(state.running && state.running.id === "mixer")) openAppById("mixer");
    }));
    pop.appendChild(row);

    var volRow = document.createElement("div");
    volRow.style.cssText = "display:flex;align-items:center;gap:8px;";
    var vol = document.createElement("input");
    vol.type = "range";
    vol.id = "mx-pop-vol";
    vol.min = "0"; vol.max = "100"; vol.step = "1";
    vol.value = String(st.vol);
    vol.setAttribute("aria-label", window.t("rxt.volume"));
    vol.style.cssText = "width:150px;accent-color:var(--accent);cursor:pointer;margin:0;";
    var pct = document.createElement("span");
    pct.id = "mx-pop-pct";
    pct.style.cssText =
      "font-size:11px;color:var(--text-dim);min-width:34px;text-align:right;" +
      "font-variant-numeric:tabular-nums;";
    pct.textContent = st.vol + "%";
    vol.addEventListener("input", function () {
      var v = parseInt(vol.value, 10) || 0;
      var x = mxHost();
      if (x) x.update({ vol: v, mute: 0 });
      pct.textContent = v + "%";
    });
    volRow.appendChild(vol);
    volRow.appendChild(pct);
    pop.appendChild(volRow);

    var tLbl = document.createElement("div");
    tLbl.style.cssText = "font-size:11px;color:var(--text-dim);";
    tLbl.textContent = window.t("mxt.sleep");
    pop.appendChild(tLbl);
    var tRow = document.createElement("div");
    tRow.style.cssText = "display:flex;gap:4px;flex-wrap:wrap;";
    MX_TIMERS.forEach(function (m) {
      var b = mkBtn(m ? String(m) + "′" : window.t("mxt.off"),
        m ? tr("mxt.min", { n: m }) : window.t("mxt.timeroff"),
        function () {
          var x = mxHost();
          if (x) x.setTimer(m);
          mxPaintPop();
        });
      b.setAttribute("data-mx-timer", String(m));
      tRow.appendChild(b);
    });
    pop.appendChild(tRow);
    var left = document.createElement("div");
    left.id = "mx-pop-left";
    left.setAttribute("aria-live", "polite");
    left.style.cssText = "font-size:11px;color:var(--text-dim);min-height:14px;font-variant-numeric:tabular-nums;";
    pop.appendChild(left);

    document.body.appendChild(pop);
    mxPaintPop();
  }

  function mixerTrayTick() {
    var bar = document.querySelector(".bar-right");
    if (!bar) return;
    var h = mxHost();
    var chip = document.getElementById("mx-tray-chip");
    var st = null;
    if (h) { try { st = h.state(); } catch (e) { st = null; } }
    // No engine, or nothing started yet / stopped → no chip.
    if (!st || !st.active) {
      if (chip) chip.remove();
      mxClosePop();
      return;
    }
    if (!chip) {
      chip = document.createElement("button");
      chip.id = "mx-tray-chip";
      chip.type = "button";
      chip.style.minHeight = "44px";
      chip.addEventListener("click", function (e) {
        e.stopPropagation();
        mxTogglePop();
      });
      bar.insertBefore(chip, document.getElementById("btn-lang"));
    }
    var dstate = st.playing ? "on" : "off";
    var name = st.label || window.t("app.mixer");
    var l = mxLeft(st);
    var title = (st.playing ? "▶ " : "⏸ ") + name + (l ? " · " + l : "");
    if (chip.getAttribute("data-state") !== dstate || chip.title !== title) {
      chip.setAttribute("data-state", dstate);
      chip.innerHTML = ICONS.mixer;
      chip.title = title;
      chip.setAttribute("aria-label", title);
    }
    if (mxPop()) mxPaintPop();
  }

  // Radio deep-link bridge (pattern: Quote/Minimalism). Payload =
  // stationuuid. App ανοιχτό → live push __orosRadioOpen στο iframe·
  // κλειστό → staging στο sessionStorage (device-local, swept από το
  // factory reset, δεν ταξιδεύει στο sync ποτέ) + άνοιγμα app.
  window.__orosOpenRadio = function (stationUuid) {
    if (typeof stationUuid !== "string" || !stationUuid) return;
    if (appLive("radio")) {
      appShow("radio");
      var f = appFrameOf("radio");
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
               over: !!p.over, fine: !!p.fine, pinned: Number(p.pinned) || 0,
               style: typeof p.style === "string" ? p.style : null,
               hover: typeof p.hover === "string" ? p.hover : null,
               hovers: Array.isArray(p.hovers) ? p.hovers.filter(function (k) { return typeof k === "string"; }) : [],
               styles: Array.isArray(p.styles) ? p.styles.filter(function (k) { return typeof k === "string"; }) : [] };
    } catch (e) { return null; }
  }

  // Seasonal decorations (seasonal.js): only on the full desktop.
  function settingsSeasonalL() {
    var S = window.orosSeasonal;
    return (S && !SOLO && typeof S.snapshot === "function" && typeof S.set === "function") ? S : null;
  }
  function settingsSeasonal() {
    var S = settingsSeasonalL();
    if (!S) return null;
    try { return S.snapshot(); } catch (e) { return null; }
  }

  // On-screen keyboard (osk.js): none on phones (snapshot null).
  function settingsOskL() {
    var O = window.orosOsk;
    return (O && typeof O.snapshot === "function" && typeof O.set === "function") ? O : null;
  }
  function settingsOsk() {
    var O = settingsOskL();
    if (!O) return null;
    try { return O.snapshot(); } catch (e) { return null; }
  }

  // Menu apps (launcher.js 1.3.0): which apps the menu lists. Only
  // when the launcher offers it; an older bundle shows no section.
  function settingsMenuL() {
    var L = window.orosLauncher;
    return (L && typeof L.menuHidden === "function" && typeof L.setMenuHidden === "function") ? L : null;
  }
  function settingsMenuIds() {
    return state.apps.filter(function (a) { return a && a.type === "internal"; })
      .map(function (a) { return a.id; });
  }
  function settingsMenuApps() {
    var L = settingsMenuL();
    if (!L) return null;
    return state.apps.filter(function (a) { return a && a.type === "internal"; }).map(function (a) {
      var k = "app." + a.id, v = window.t(k);
      var raw = String(a.category || "other"), ck = "category." + raw.toLowerCase(), cv = window.t(ck);
      return { id: a.id, name: (v === k) ? a.name : v,
               cat: raw.toLowerCase(),
               catName: (cv === ck) ? raw.charAt(0).toUpperCase() + raw.slice(1) : cv,
               shown: !L.menuHidden(a.id) };
    });
  }

  function settingsSnapshot() {
    var S = window.orosSync || null;
    var connected = !!(S && S.isConnected());
    var unlocked = !!(connected && S.hasPassphrase());
    var art = wpArt();
    var pic = wpPic();
    var hasArt = !!(pic || (state.wpart && art));
    var folder = null, lapsed = false;
    try {
      folder = localStorage.getItem(FS_FOLDER_NAME_KEY);
      lapsed = !!localStorage.getItem(FS_LAPSED_KEY);
    } catch (e) {}
    var mac = /Mac|iPhone|iPad/i.test(navigator.platform || "");
    return {
      version: APP_VERSION,
      lang: state.lang,
      langs: window.orosI18n ? window.orosI18n.choices() : [{ code: "en", name: "English" }, { code: "el", name: "Ελληνικά" }],
      theme: state.theme,
      skin: state.skin,
      skins: SKINS.map(function (k) {
        return { id: k.id, color: k.color, name: skinTitle(k.id) };
      }),
      wallpaper: pic ? "custom" : state.wallpaper,
      suggested: skinWallpaper(state.skin),   // SKIN-WP: marked in the grid
      wallpapers: WALLPAPERS.map(function (w) {
        var css = w.css;
        if (w.id === "custom") {
          if (!hasArt) css = null;   // nothing made yet → "make one"
          else {
            var bgc = pic ? pic.bg : art.colors(state.wpart, wpAccent()).bg;
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
        provider: (S && typeof S.getProvider === "function") ? S.getProvider() : "dropbox",
        davAvailable: !!(S && typeof S.connectWebdav === "function"),
        ncAvailable: !!(S && typeof S.connectNextcloud === "function"),
        ncWaiting: !!state.ncWaiting,
        moveAvailable: !!(S && typeof S.moveToWebdav === "function"),
        dirty: !!(unlocked && S.isDirty()),
        hasVault: !!(connected && S.hasDeviceVault()),
        interval: getSafeInterval(),
        intervals: [0, 1, 3, 5, 15],
        minPass: MIN_PASS_LEN,
        canRestore: !!(S && typeof S.restoreBackup === "function"),
        backups: (connected && state.syncBackups) ? {
          loading: !!state.syncBackups.loading,
          list: state.syncBackups.list.slice(),
          err: state.syncBackups.err || null
        } : null,
        canClean: !!(window.orosVault && typeof window.orosVault.cleanUp === "function"),
        clean: (connected && state.vaultClean) ? JSON.parse(JSON.stringify(state.vaultClean)) : null,
        cleanDays: (window.orosVault && window.orosVault.cleanMinAgeDays) || 30,
        restoring: state.syncRestoring,
        oldPassFor: state.syncOldPassFor,
        msg: state.syncMsg ? { kind: state.syncMsg.kind, text: state.syncMsg.text }
           : (state.syncAutoErr ? { kind: "err", text: state.syncAutoErr } : null)
      },
      backup: {
        folderSupported: fsSupported(),
        autoexport: state.autoexport,
        folder: folder || null,
        lapsed: !!(folder && lapsed),
        encrypt: bkEncOn(),
        // On, but the key is gone from this device (site data cleared):
        // nothing is written until the passphrase is set again.
        encLost: bkEncOn() && bkKey === null
      },
      search: searchApps().map(function (a) {
        var k = "app." + a.id, v = window.t(k);
        return { id: a.id, name: (v === k) ? a.name : v, on: searchEnabled(a.id) };
      }),
      install: !!state.deferredPrompt,
      dock: settingsDock(),
      seasonal: settingsSeasonal(),
      osk: settingsOsk(),
      widgets: window.orosWidgets && window.orosWidgets.snapshot ? window.orosWidgets.snapshot() : null,
      menu: settingsMenuApps(),
      menuProfiles: !!profilesL(),
      multitask: mtSnapshot(),
      // This computer's files (orOS Portable, desktop apps): null where the
      // launcher does not ask (useoros.online, orOS USB).
      pcfiles: state.pcFiles && !state.pcFiles.fixed ? { on: state.pcFiles.state === "on" } : null,
      // Users on this computer or stick (the launcher's sign-in): null
      // where the launcher has no users API (Settings › Users explains).
      users: state.users || null,
      a11y: a11ySnapshot(),
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
        setLangUser(value);
        return;
      case "theme":      setThemeUser(value); return;
      case "skin":       setSkinUser(value); return;
      case "wallpaper":
        if (value === "custom" && !wpPic() && !(state.wpart && wpArt())) { openAppById("wallpaper"); return; }
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
      case "multitask":
        if (!SOLO) { mtSetUser(!!value); settingsNotify(); }
        return;
      case "pcfiles":
        if (typeof window.__orosPcFilesSet === "function") window.__orosPcFilesSet(!!value);
        return;
      case "textSize":
      case "contrast":
      case "focusRing":    a11ySetUser(name, value); return;
    }
    if (/^dock:(on|size|magnify|autohide|over|style|hover)$/.test(name)) {
      var L = settingsLauncher();
      if (L) { L.setPref(name.slice(5), value); settingsNotify(); }
      return;
    }
    if (/^seasonal:/.test(name)) {
      var SS = settingsSeasonalL();
      if (SS) SS.set(name.slice(9), value);
      return;
    }
    if (/^widgets:/.test(name)) {        // widgets.js: "widgets:<kind>" on/off
      if (window.orosWidgets) window.orosWidgets.set(name.slice(8), !!value);
      return;
    }
    if (/^osk:/.test(name)) {
      var OK = settingsOskL();
      if (OK) OK.set(name.slice(4), value);
      return;
    }
    if (/^menu:/.test(name)) {
      var mid = name.slice(5), ML = settingsMenuL();
      if (ML && settingsMenuIds().indexOf(mid) !== -1) ML.setMenuHidden([mid], !value);
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
      case "sync.connectDav":
        if (arg && typeof arg.url === "string" && typeof arg.pass === "string") syncConnectDav(arg);
        return;
      case "sync.connectNc":
        if (arg && typeof arg.url === "string") syncConnectNextcloud(arg);
        return;
      case "sync.moveDav":
        if (arg && typeof arg.url === "string" && typeof arg.pass === "string") syncMoveDav(arg);
        return;
      case "sync.moveDb":     syncMoveDropbox(); return;
      case "caldav.bg":       // CalDAV W6 (10e): the background pass switch, this device only
        davBgSetOn(!!(arg && arg.on));
        settingsNotify();
        return;
      case "sync.cancelNc":
        if (S && typeof S.cancelNextcloud === "function") S.cancelNextcloud();
        return;
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
      case "sync.backups.load": syncBackupsLoad(); return;
      case "sync.clean.check":  if (S && S.isConnected() && S.hasPassphrase()) vaultCleanCheck(); return;
      case "sync.clean.run":    if (S && S.isConnected() && S.hasPassphrase()) vaultCleanRun(); return;
      case "sync.restore":
        if (S && S.isConnected() && S.hasPassphrase() && arg && typeof arg.name === "string") {
          syncRestore({ name: arg.name, old: typeof arg.old === "string" ? arg.old : "" });
        }
        return;
      // Folder picker and permission prompts need a user gesture: the
      // app calls these straight from its click handler (the gesture
      // of a same-origin frame counts for the shell window too).
      case "backup.chooseFolder":    if (fsSupported()) chooseBackupFolder(); return;
      case "backup.stopFolder":      stopFolderBackups(); return;
      case "backup.reconnectFolder": reconnectFolder(); return;
      case "backup.now":      scBackupNow(); return;
      case "backup.export":   scExportDb(); return;
      case "backup.import":   importBackupFile(); return;
      case "backup.encrypt":  if (arg === true) bkEncTurnOn(); else if (arg === false) bkEncTurnOff(); return;
      case "backup.encryptPass": bkEncTurnOn(); return;
      case "install":
        if (!state.deferredPrompt) return;
        state.deferredPrompt.prompt();
        state.deferredPrompt.userChoice.then(function (choice) {
          if (choice.outcome === "accepted") { state.deferredPrompt = null; renderMenu(); }
        });
        return;
      case "updates":         scCheckUpdates(); return;
      case "info":            showInfoModal(); return;
      case "shareLinks":      if (window.orosShare) window.orosShare.links(); return;
      case "openApp":         if (typeof arg === "string") openAppById(arg); return;
      // Seasonal decorations: "Try it now" shows the desktop at once.
      case "seasonal.preview":
        if (settingsSeasonalL() && settingsSeasonalL().preview(String(arg || ""))) returnToDesktop();
        return;
      case "seasonal.keep":   if (settingsSeasonalL()) settingsSeasonalL().keep(); return;
      case "seasonal.stop":   if (settingsSeasonalL()) settingsSeasonalL().stop(); return;
      case "seasonal.hide":   if (settingsSeasonalL()) settingsSeasonalL().hideToday(!!arg); return;
      // Menu apps: show or hide every app at once (one change, one push).
      case "menu.showAll":    if (settingsMenuL()) settingsMenuL().setMenuHidden(settingsMenuIds(), false); return;
      case "menu.hideAll":    if (settingsMenuL()) settingsMenuL().setMenuHidden(settingsMenuIds(), true); return;
      case "menu.profiles":   showProfiles("settings"); return;
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

  // Screen lock (lock.js, loaded before this file): the shell owns the
  // device reset and the way back after the sync passphrase opened it
  // (the lock is off then; Settings opens where a new one is set).
  // The menu's "Lock orOS" row follows the switch.
  if (window.orosLock && typeof window.orosLock.setHooks === "function") {
    window.orosLock.setHooks({
      reset: lockDeviceReset,
      recovered: function () {
        window.orosSettings.open("lock");
        scToast("ok", window.t("lock.recovered"));
      }
    });
    var lockWasOn = window.orosLock.isOn();
    window.orosLock.onChange(function () {
      var on = window.orosLock.isOn();
      if (on !== lockWasOn) { lockWasOn = on; renderMenu(); }
    });
  }

  // ---------- 9b. Single apps (solo.js) ----------
  // "/?solo=<id>": this shell runs inside an installed single app
  // ("orOS Notes" …, /<id>/solo.html) and shows only that app. No
  // desktop, menu, Dock or tour; the bar button names the app and
  // opens a small menu (sync, settings, help, the whole orOS). Any
  // other app opened from it (Settings, a link from the app) gets
  // Back, which returns to the single app. Everything else (sync,
  // notifications, files, dialogs) is the shell as always.
  var SOLO = (window.orosSolo && window.orosSolo.has && window.orosSolo.has(window.orosSolo.id)) ? window.orosSolo.id : "";
  if (SOLO) document.body.classList.add("solo-mode");

  function soloAppObj() {
    for (var i = 0; i < state.apps.length; i++) {
      if (state.apps[i].id === SOLO && state.apps[i].type === "internal") return state.apps[i];
    }
    return null;
  }
  // The single app's name in the shell's language; a pack language
  // loads the "solo" pack once (i18n/<code>/solo.js), then repaints.
  var soloPackAsked = "";
  function soloName() {
    var I = window.orosI18n;
    if (I && state.lang !== "en" && state.lang !== "el" && soloPackAsked !== state.lang) {
      soloPackAsked = state.lang;
      I.ensure(state.lang, "solo", function () { if (SOLO) soloPaint(); });
    }
    return window.orosSolo.nameOf(SOLO, state.lang);
  }

  // Window title, bar button and the host page's title.
  function soloPaint() {
    var app = state.running;
    var mb = document.getElementById("btn-menu");
    var lbl = document.getElementById("btn-menu-label");
    if (!mb || !lbl || typeof window.t !== "function") return;
    if (!app || app.id === SOLO) {
      var k = "app." + SOLO, n = window.t(k);
      lbl.textContent = n !== k ? n : SOLO;
      mb.classList.remove("running");
      mb.setAttribute("data-i18n-title", "solo.menu");
      mb.setAttribute("title", window.t("solo.menu"));
      mb.setAttribute("aria-haspopup", "menu");
    } else {
      lbl.textContent = window.t("running.back");
      mb.classList.add("running");
      mb.setAttribute("data-i18n-title", "running.back");
      mb.setAttribute("title", window.t("running.back"));
      mb.removeAttribute("aria-haspopup");
    }
    document.title = soloName();
    var h = window.orosSolo.host();
    if (h) h.title(soloName());
  }

  // Back to the single app. true = handled (returnToDesktop stops).
  function soloHome() {
    var app = soloAppObj();
    if (!app) return false;
    soloMenuClose();
    if (!state.running || state.running.id !== SOLO) openApp(app);
    return true;
  }

  function soloMenuClose() {
    var m = document.getElementById("solo-menu");
    if (m) m.remove();
  }
  function soloMenuButton() {
    if (state.running && state.running.id !== SOLO) { soloHome(); return; }
    if (document.getElementById("solo-menu")) { soloMenuClose(); return; }
    var menu = document.createElement("div");
    menu.id = "solo-menu";
    menu.setAttribute("role", "menu");
    [
      ["solo.sync", function () { window.__orosOpenAt("settings", { section: "sync" }); }],
      ["solo.settings", function () { openAppById("settings"); }],
      ["solo.help", function () { openHelp(); }],
      ["solo.full", function () { window.open("/", "_blank", "noopener"); }]
    ].concat(window.orosLock && window.orosLock.isOn()
      ? [["menu.lock", function () { window.orosLock.lock(); }]] : []).forEach(function (it) {
      var b = document.createElement("button");
      b.type = "button";
      b.setAttribute("role", "menuitem");
      b.textContent = window.t(it[0]);
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        soloMenuClose();
        it[1]();
      });
      menu.appendChild(b);
    });
    menu.addEventListener("click", function (e) { e.stopPropagation(); });
    document.body.appendChild(menu);
    var first = menu.querySelector("button");
    if (first) first.focus();
  }
  if (SOLO) {
    document.addEventListener("click", function () { soloMenuClose(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") soloMenuClose(); });
  }

  // Once the app list is in: the shortcut word or a share decides what
  // opens first; otherwise the app itself (unless a launch parameter,
  // e.g. a notification's deep link, already opened something).
  var soloStarted = false;
  function soloStart() {
    if (soloStarted) return;
    soloStarted = true;
    var S = window.orosSolo, app = soloAppObj();
    if (!app) return;
    soloNotifsOnlyOwn();
    var sc = S.shortcut(SOLO, S.word);
    var sh = S.share ? S.shareTarget(SOLO, S.share, new Date()) : null;
    if (sh && sh.calNew) { window.__orosOpenCalendarNew(sh.calNew); }
    else if (sh && sh.target) { window.__orosOpenAt(sh.app, sh.target); }
    else if (sc && sc.calNew) { window.__orosOpenCalendarNew({ date: sysYmd() }); }
    else if (sc && sc.target) { window.__orosOpenAt(SOLO, sc.target); }
    if (!state.running) openApp(app);
    soloPaint();
    soloBadgeTick();
    setInterval(soloBadgeTick, 60000);
    window.addEventListener("storage", soloBadgeTick);
  }

  // Notifications: a single app raises only its own (and orOS system
  // notices such as an update). The other apps' reminders belong to
  // orOS, which keeps raising them.
  function soloNotifsOnlyOwn() {
    var N = window.orosNotifs;
    if (!N || typeof N.emit !== "function" || N.__soloWrapped) return;
    var emit = N.emit;
    N.emit = function (cand) {
      var ns = cand && typeof cand === "object" ? cand.ns : "";
      if (ns !== SOLO && ns !== "system") return null;
      return emit.apply(N, arguments);
    };
    N.__soloWrapped = true;
  }

  // Icon badge (Badging API, through the host page): To-Do counts the
  // open tasks due today or overdue. Others show none.
  function soloBadgeTick() {
    var h = window.orosSolo.host(), kind = window.orosSolo.APPS[SOLO].badge;
    if (!h || kind !== "due") return;
    var n = 0;
    try {
      var raw = JSON.parse(localStorage.getItem(TODO_DATA_KEY));
      var TC = window.OrosTodoCore;
      if (raw && Array.isArray(raw.lists) && TC) n = TC.dueSummary(raw, sysYmd()).count;
    } catch (e) { n = 0; }
    h.badge(n);
  }

  // ---------- 10. App opening (fullscreen takeover) ----------

  // ---------- 10a. App frames (multitasking groundwork, wave M1) ----------
  // Every shell path that talks to a running app finds its frame here.
  // The app in front is always the frame with id="app-frame" and it
  // shows state.running. With multitasking on (10b) other apps may stay
  // alive in hidden frames (mt.hidden); with it off there are none and
  // these helpers return exactly what the old inline code did.
  //   appFrames()     every live app frame (front + hidden)
  //   appFrameOf(id)  the frame that shows app `id`, or null
  //   appLive(id)     app `id` is open in a frame (shown or hidden)
  //   appShow(id)     bring a hidden app to the front (no reload); a
  //                   bridge that opens something calls it before its
  //                   live push. No-op for the app in front.
  // window.__orosAppDocs() gives sync.js the documents of the live
  // frames (SY-D5: a hidden frame is live, a closed one is not).
  function appFrames() {
    var f = document.getElementById("app-frame");
    var out = f ? [f] : [];
    if (mt && mt.side) out.push(mt.side.el);
    mtList().forEach(function (r) { out.push(r.el); });
    return out;
  }
  function appFrameOf(id) {
    if (state.running && state.running.id === id) return document.getElementById("app-frame");
    if (mt && mt.side && mt.side.app.id === id) return mt.side.el;
    var r = mtFind(id);
    return r ? r.el : null;
  }
  function appLive(id) { return !!appFrameOf(id); }
  function appShow(id) {
    if (mt && mt.side && mt.side.app.id === id) { mtSideFocus(); return; }
    var r = mtFind(id);
    if (r) openApp(r.app);
  }
  window.__orosAppDocs = function () {
    var out = [];
    var f = document.getElementById("app-frame");
    try { if (state.running && f && f.contentDocument) out.push(f.contentDocument); } catch (e) {}
    try { if (mt && mt.side && mt.side.el.contentDocument) out.push(mt.side.el.contentDocument); } catch (e) {}
    mtList().forEach(function (r) {
      try { if (r.el.contentDocument) out.push(r.el.contentDocument); } catch (e) {}
    });
    try { if (davBg && davBg.el.contentDocument) out.push(davBg.el.contentDocument); } catch (e) {}   // 10e
    return out;
  };

  // frameGo(el, url): every shell navigation of an app frame replaces
  // the frame's page instead of adding a history entry. Setting src on
  // a frame that already showed a page adds one, and the phone's Back
  // key then walked the frame back into an app that had been closed:
  // its page, without text while it loaded, under the name of the app
  // in front (Chris 2026-10-18, BK-1). Back itself is section 10d.
  function frameGo(el, url) {
    try { el.contentWindow.location.replace(new URL(url, document.baseURI).href); oskWatch(el); return; } catch (e) {}
    el.src = url;
    oskWatch(el);
  }
  // On-screen keyboard (osk.js): wire the new page as soon as it exists.
  function oskWatch(el) {
    if (window.orosOsk && window.orosOsk.watch) window.orosOsk.watch(el);
  }

  // ---------- 10b. Multitasking (wave M2; out of the experiment 2026-10-27) ----------
  // Settings › System › "Multitasking", per device
  // (oros-multitask = "1" on / "0" off, never synced; unset = on on
  // computers, off on phones and tablets: mtDefault). When you leave an app it stays alive in a
  // hidden frame and comes back as you left it, up to a number of
  // "slots" set by the device's memory (mtSlots; heavy apps take 2).
  // When the slots are full the app used longest ago closes. Off (or in
  // a single app, SOLO): nothing here runs and there is one frame.
  // Hidden frames: display:none (half the memory of a covered frame,
  // measured in M1), their document reports visibilityState "hidden"
  // with a visibilitychange (95 apps already pause on it), media
  // paused, optional window.__orosAppPause / __orosAppResume hooks.
  // Music, Radio and Podcasts play from the shell, so sound goes on.
  // Plan + measurements: /mnt/project-files/multitasking/.
  var MT_KEY = "oros-multitask";
  // Close when you leave them, as before, even with multitasking on:
  // another window writes their data while they would be hidden
  // (the M1 writer scan's "check" list: mail, radio, television,
  // weather, calendar, assistant), they hold the camera or microphone
  // (getUserMedia), they unlock secrets (passwords), or they mirror
  // shell state (settings).
  var MT_CLOSE_ON_LEAVE = {
    mail: 1, radio: 1, television: 1, weather: 1, calendar: 1, assistant: 1,
    flashcards: 1, meals: 1, montage: 1, qr: 1, scanpdf: 1, stock: 1, storage: 1, studio: 1,
    passwords: 1, settings: 1
  };
  // Heavy apps take two slots (declared + measured in M1).
  var MT_HEAVY = { atelier: 1, maps: 1, photolab: 1, layout: 1, montage: 1, scanpdf: 1, studio: 1, assistant: 1 };
  var mt = { hidden: [], side: null, pickSide: false };
  // hidden: { app, el, at } of each hidden live app
  // side:   { app, el } of the app beside the one in front (wave M4)
  // pickSide: the next app chosen in the menu opens beside
  var mtOnChange = null;     // set by the switcher (10c): repaint on change
  var mtNoKeep = false;      // the switcher closes the app in front
  function mtChanged() {
    if (typeof mtOnChange === "function") { try { mtOnChange(); } catch (e) {} }
  }

  // Out of the experiment (Chris 2026-10-27, after the load tests in
  // /mnt/project-files/multitasking/load-2026-10-27.md): on by default on
  // computers (a fine pointer that can hover, 768 px and wider), off on
  // phones and tablets. The person's own choice ("1" / "0") always wins.
  function mtDefault() {
    try {
      return !!(window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches) &&
        (window.innerWidth || 0) >= 768;
    } catch (e) { return false; }
  }
  function mtOn() {
    var v = null;
    try { v = localStorage.getItem(MT_KEY); } catch (e) { return false; }
    if (v === "1") return true;
    if (v === "0") return false;
    return mtDefault();
  }
  function mtActive() { return !SOLO && mtOn(); }
  // Slots for a device: navigator.deviceMemory (GB, Chromium only,
  // capped at 8 by the browser) or, unknown, the screen width.
  function mtSlots(mem, width) {
    if (typeof mem === "number" && mem > 0) return mem <= 1 ? 2 : mem <= 2 ? 3 : mem <= 4 ? 4 : 8;
    return width < 768 ? 3 : 6;
  }
  function mtSlotsHere() {
    return mtSlots(navigator.deviceMemory, window.innerWidth || 1024);
  }
  function mtWeight(id) { return MT_HEAVY[id] ? 2 : 1; }
  function mtKeepable(app) { return !!app && app.type === "internal" && !MT_CLOSE_ON_LEAVE[app.id]; }
  // The hidden list; empty while shell.js is still running its top
  // part (appFrames() wires the frame listeners before 10b is reached).
  function mtList() { return mt ? mt.hidden : []; }
  function mtFind(id) {
    var l = mtList();
    for (var i = 0; i < l.length; i++) if (l[i].app.id === id) return l[i];
    return null;
  }
  function mtTake(id) {
    var r = mtFind(id);
    if (r) mt.hidden.splice(mt.hidden.indexOf(r), 1);
    return r;
  }
  function mtHasDoc(el) {
    try { return !!(el && el.contentDocument && el.contentWindow.location.href !== "about:blank"); }
    catch (e) { return false; }
  }

  // The app's document reports itself hidden / visible again.
  function mtVis(el, hidden) {
    var w, d;
    try { w = el.contentWindow; d = el.contentDocument; } catch (e) { return; }
    if (!w || !d) return;
    try {
      if (hidden) {
        Object.defineProperty(d, "visibilityState", { configurable: true, get: function () { return "hidden"; } });
        Object.defineProperty(d, "hidden", { configurable: true, get: function () { return true; } });
        Array.prototype.forEach.call(d.querySelectorAll("audio,video"), function (m) {
          try { if (!m.paused) m.pause(); } catch (e2) {}
        });
      } else {
        delete d.visibilityState;
        delete d.hidden;
      }
      d.dispatchEvent(new w.Event("visibilitychange"));
    } catch (e3) {}
    try {
      var fn = w[hidden ? "__orosAppPause" : "__orosAppResume"];
      if (typeof fn === "function") fn();
    } catch (e4) {}
  }

  var mtFrameSeq = 0;
  function mtNewFrame(side) {
    var f = document.createElement("iframe");
    f.name = "oros-app-" + (++mtFrameSeq) + "-" + Date.now().toString(36);   // own name: the browser's history never takes it for an older frame
    if (!side) f.id = "app-frame";
    f.setAttribute("title", "orOS application");
    document.getElementById("oros-running").appendChild(f);
    cmdWireFrame(f);
    extWireFrame(f);
    a11yWireFrame(f);
    return f;
  }
  function mtDrop(el) {
    try { frameGo(el, "about:blank"); } catch (e) {}
    if (el.parentNode) el.parentNode.removeChild(el);
  }

  // Stale copy guard (MT-S1, 2026-10-27). A live app holds its data in
  // memory; when another document (the Assistant, the shell's bridges
  // and household mirrors, the app beside) writes one of the app's
  // keys, that copy is old and its next save would undo the write.
  // Such a write closes the hidden app (it opens fresh next time) and
  // reloads the app beside or in front in side by side. An app's keys:
  // "oros-<id>-..." and every key it was seen writing itself. Apps that
  // are screens over their own shell host follow its change events and
  // are left alone.
  var MT_HOSTED = { music: 1, podcasts: 1, today: 1, stickies: 1, newsletter: 1 };
  var mtKeyOwner = {};       // key → id of the app seen writing it
  function mtOwns(id, key) {
    if (!key || MT_HOSTED[id]) return false;
    return key.indexOf("oros-" + id + "-") === 0 || mtKeyOwner[key] === id;
  }
  // The app of a document URL of this orOS ("…/todo/index.html" → "todo").
  function mtAppOfUrl(u) {
    var base = location.pathname.replace(/[^\/]*$/, ""), p;
    try { p = new URL(u, location.href).pathname; } catch (e) { return null; }
    if (p.indexOf(base) !== 0) return null;
    var dir = p.slice(base.length).split("/")[0];
    for (var i = 0; i < state.apps.length; i++) if (state.apps[i].url === dir + "/") return state.apps[i].id;
    return null;
  }
  // Hidden apps: a write by any other document (the shell included)
  // fires "storage" in the app's own window, never one of its own.
  function mtGuard(el, app) {
    var w;
    try { w = el.contentWindow; } catch (e) { return; }
    if (!w || w.__orosMtGuard) return;
    try {
      w.__orosMtGuard = true;
      w.addEventListener("storage", function (e) {
        if (el.getAttribute("data-oros-app") !== app.id || !mtOwns(app.id, e.key)) return;
        setTimeout(function () {
          var r = mtFind(app.id);
          if (!r || r.el !== el) return;
          mtTake(app.id);
          mtDrop(el);
          mtChanged();
        }, 0);
      });
    } catch (e2) {}
  }
  // The shell's own window hears the writes of every app frame: it
  // learns who writes what, and in side by side reloads the other app
  // when one writes the other's keys.
  window.addEventListener("storage", function (e) {
    if (!e.key || !mtActive()) return;
    var by = mtAppOfUrl(e.url || "");
    if (!by) return;
    if (!mtKeyOwner[e.key] && e.key.indexOf("oros-" + by + "-") !== 0) mtKeyOwner[e.key] = by;
    if (!mt.side || !state.running) return;
    var pair = [{ app: state.running, el: document.getElementById("app-frame") }, mt.side];
    pair.forEach(function (x) {
      if (x.el && x.app.id !== by && mtOwns(x.app.id, e.key)) frameGo(x.el, x.app.url);
    });
  });
  // The front frame steps back: hidden, paused, still live.
  function mtHide(el, app) {
    el.removeAttribute("id");
    el.style.display = "none";
    el.setAttribute("data-oros-app", app.id);
    mtVis(el, true);
    mtGuard(el, app);
    if (!el.__mtLoadHook) {      // still booting: hide it again once loaded
      el.__mtLoadHook = true;
      el.addEventListener("load", function () {
        var r = el.getAttribute("data-oros-app");
        if (r) { mtVis(el, true); mtGuard(el, mtFind(r) ? mtFind(r).app : app); }
      });
    }
    mt.hidden.push({ app: app, el: el, at: Date.now() });
  }
  function mtShow(el) {
    el.id = "app-frame";
    el.removeAttribute("data-oros-app");
    el.style.display = "";
    mtVis(el, false);
  }
  // Oldest hidden apps close until front + hidden fit the slots.
  function mtFit(front) {
    var slots = mtSlotsHere();
    var used = front ? mtWeight(front.id) : 0;
    if (mt.side) used += mtWeight(mt.side.app.id);
    mt.hidden.forEach(function (r) { used += mtWeight(r.app.id); });
    mt.hidden.sort(function (a, b) { return a.at - b.at; });
    while (used > slots && mt.hidden.length) {
      var r = mt.hidden.shift();
      used -= mtWeight(r.app.id);
      mtDrop(r.el);
    }
  }
  function mtDropAll() {
    mtSideEnd(false);
    var l = mtList();
    while (l.length) mtDrop(l.shift().el);
    mtChanged();
  }

  // ---- Side by side (wave M4): two apps, from 1024 px wide ----
  // The app in front keeps #app-frame on the left; the side app is a
  // live frame on the right (data-oros-side). Frames never move in the
  // DOM (that would reload them): CSS grid order places them. Below
  // 1024 px, at home, or when switched off, the side app goes back to
  // the background (or closes if it may not stay open).
  var MT_SPLIT_MIN = 1024;
  function mtSplitFits() { return (window.innerWidth || 0) >= MT_SPLIT_MIN; }
  function mtSideIs(id) { return !!(mt.side && mt.side.app.id === id); }
  function mtSideShow(app, el) {
    mt.side = { app: app, el: el };
    el.removeAttribute("data-oros-app");
    el.setAttribute("data-oros-side", app.id);
    el.setAttribute("title", "orOS application");
    el.style.display = "";
    mtVis(el, false);
    var run = document.getElementById("oros-running");
    run.classList.add("mt-split");
    if (typeof mtSplitPaint === "function") mtSplitPaint();
  }
  // Put `app` beside the app in front: a hidden live one keeps its
  // window, any other opens fresh. The previous side app steps back.
  function mtSideOpen(app, at) {
    if (!mtActive() || !mtSplitFits() || !state.running || state.running.id === app.id || app.type !== "internal") return false;
    if (mtSideIs(app.id)) { mtSideFocus(); return true; }
    mtSideEnd(true);
    var r = mtTake(app.id), el;
    if (r) { el = r.el; if (at) frameGo(el, app.url + at); }
    else { el = mtNewFrame(true); frameGo(el, app.url + (at || "")); }
    mtSideShow(app, el);
    mtFit(state.running);
    mtChanged();
    return true;
  }
  function mtSideEnd(keep) {
    var sd = mt.side;
    if (!sd) return;
    mt.side = null;
    sd.el.removeAttribute("data-oros-side");
    var run = document.getElementById("oros-running");
    if (run) run.classList.remove("mt-split");
    appFrames().concat([sd.el]).forEach(function (f) { if (f.classList) f.classList.remove("mt-focus"); });
    if (keep && mtKeepable(sd.app) && mtHasDoc(sd.el)) { mtHide(sd.el, sd.app); mtFit(state.running); }
    else mtDrop(sd.el);
  }
  function mtSideFocus() {
    if (!mt.side) return;
    try { mt.side.el.contentWindow.focus(); } catch (e) {}
  }
  // Open apps for the switcher: the one in front, then the hidden ones,
  // the one left last first. { app, at, front }
  function mtOpenList() {
    var out = [];
    if (state.running && state.running.type === "internal") out.push({ app: state.running, at: 0, front: true });
    if (mt.side) out.push({ app: mt.side.app, at: 0, front: false, side: true });
    mtList().slice().sort(function (a, b) { return b.at - a.at; }).forEach(function (r) {
      out.push({ app: r.app, at: r.at, front: false });
    });
    return out;
  }
  // Close one open app for good (switcher ×, swipe).
  function mtClose(id) {
    if (mtSideIs(id)) { mtSideEnd(false); mtChanged(); return; }
    if (state.running && state.running.id === id && mt.side) {
      // the side app takes the whole screen, as it is (no reload)
      var sd = mt.side;
      mt.side = null;
      sd.el.removeAttribute("data-oros-side");
      document.getElementById("oros-running").classList.remove("mt-split");
      mt.hidden.push({ app: sd.app, el: sd.el, at: Date.now() });
      mtNoKeep = true;
      try { openApp(sd.app); } finally { mtNoKeep = false; }
      return;
    }
    if (state.running && state.running.id === id) {
      mtNoKeep = true;
      try { returnToDesktop(); } finally { mtNoKeep = false; }
      return;
    }
    var r = mtTake(id);
    if (r) mtDrop(r.el);
    mtChanged();
  }
  function mtCloseAll() {
    mtDropAll();
    if (state.running) mtClose(state.running.id);
  }
  // openApp with multitasking on: `prev` was in front, `app` comes.
  function mtSwitch(prev, app, at) {
    var front = document.getElementById("app-frame");
    if (prev && prev.id === app.id) { frameGo(front, app.url + (at || "")); return; }   // reopen = reload, as before
    var back = mtTake(app.id);
    if (prev && !mtNoKeep && mtKeepable(prev) && mtHasDoc(front)) { mtHide(front, prev); front = null; }
    if (back) {
      if (front) mtDrop(front);
      mtShow(back.el);
      if (at) frameGo(back.el, app.url + at);
    } else {
      // A new frame, never the old one: Back (10d) puts frames that
      // existed when its history entry was made back on the page they
      // showed then, so a frame must keep one app for its whole life.
      if (front) mtDrop(front);
      front = mtNewFrame();
      frameGo(front, app.url + (at || ""));
    }
    mtFit(app);
  }
  // returnToDesktop with multitasking on: keep the app alive if it may.
  function mtLeave(prev) {
    var front = document.getElementById("app-frame");
    if (prev && !mtNoKeep && mtKeepable(prev) && mtHasDoc(front)) {
      mtHide(front, prev);
      mtNewFrame();
      mtFit(null);
      return true;
    }
    return false;
  }
  function mtSetUser(on) {
    try {
      localStorage.setItem(MT_KEY, on ? "1" : "0");
    } catch (e) {}
    if (!on) mtDropAll();
    else mtChanged();
  }
  function mtSnapshot() {
    if (SOLO) return null;
    return { on: mtOn(), slots: mtSlotsHere(), open: mt.hidden.length };
  }

  function openApp(app, at) {
    // BOOT-L1: an app opened before the late bundle is in (a launch
    // link, a notification, a quick tap) waits for it: its bridges to
    // the shell live there. The last request wins.
    if (!late.done && app && app.type === "internal") {
      var first = !late.open;
      late.open = [app, at];
      if (first) lateWhen(function () { var o = late.open; late.open = null; if (o) openApp(o[0], o[1]); });
      return;
    }
    if (app && app.type === "internal") davBgStop(app.id);   // 10e: the background frame of this app goes first
    var pick = mt.pickSide && document.getElementById("app-menu").classList.contains("open");
    mt.pickSide = false;
    if (mtActive() && app.type === "internal" && (mtSideIs(app.id) || pick) && mtSideOpen(app, at)) {
      closeMenu();
      menuReset();
      return;
    }
    closeMenu();
    menuReset();
    if (tourEnd) tourEnd();   // a notification or shortcut opened an app mid-tour
    if (app.type === "external") {
      window.open(app.url, "_blank", "noopener");
      return;
    }
    var prev = state.running;
    state.running = app;
    if (appAway()) backArm();
    document.body.classList.add("app-running");   // narrow bar: "?" takes the language button's place
    if (mtActive()) mtSwitch(prev, app, at);
    else frameGo(document.getElementById("app-frame"), app.url + (at || ""));   // at: DL-1 launchAppSuffix only
    if (typeof window.t === "function") frameTitle();
    mtChanged();
    document.getElementById("oros-running").classList.add("active");
    document.getElementById("oros-desktop").style.display = "none";
    var mb = document.getElementById("btn-menu");
    mb.classList.add("running");
    document.getElementById("btn-menu-label").textContent = window.t("running.back");
    mb.setAttribute("data-i18n-title", "running.home");
    mb.setAttribute("title", window.t("running.home"));   // paint NOW — don't wait for applyLang()
    var nk = "app." + app.id, tv = window.t(nk);
    document.title = ((tv === nk) ? app.name : tv) + " · orOS";   // #4: title follows the running app (translated)
    if (SOLO) { soloMenuClose(); soloPaint(); }
    if (window.orosSeasonal) window.orosSeasonal.refresh();   // decorations pause under an app
  }

  function returnToDesktop() {
    if (SOLO && soloHome()) return;   // a single app has no desktop
    var prev = state.running;
    mtSideEnd(true);   // home ends side by side; the side app waits behind
    state.running = null;
    document.body.classList.remove("app-running");
    if (!(mtActive() && mtLeave(prev))) frameGo(document.getElementById("app-frame"), "about:blank");
    mtChanged();
    document.getElementById("oros-running").classList.remove("active");
    document.getElementById("oros-desktop").style.display = "";
    var mb = document.getElementById("btn-menu");
    mb.classList.remove("running");
    document.getElementById("btn-menu-label").textContent = window.t("bar.menu");
    mb.setAttribute("data-i18n-title", "bar.menu");
    mb.setAttribute("title", window.t("bar.menu"));   // paint NOW — don't wait for applyLang()
    document.title = "orOS";                 // v0.18.2: back to the bare OS title
    if (window.orosSeasonal) window.orosSeasonal.refresh();   // decorations move again
    tourMaybe();   // a first-run tour put off by a launch-param app
  }

  // ---------- 10e. CalDAV / CardDAV background pass (CalDAV wave 6) ----------
  // Calendar, Contacts and To-Do sync with the person's own DAV server
  // while they are open (waves 3-5). With them closed, the shell runs
  // one pass for them every 15 minutes: the app opens in a hidden frame
  // with ?davbg=1, runs its own pass (the same code, the same DAV rules,
  // nothing new to trust), posts {oros:"dav-bg-done"} and the frame is
  // dropped. One app at a time, never one that is open (an open app
  // syncs itself; opening one stops its background frame first). Only
  // with a saved CalDAV account, online, not in a single-app window,
  // and not when the person turned it off in Settings
  // (oros-davbg-off = "1", device-local). The hidden frame is a live
  // app document for sync.js while it runs (__orosAppDocs).
  //   oros-davbg-last  { at, apps: { calendar|contacts|todo:
  //                      { at, err, held } } }  (device-local)
  var DAVBG_EVERY = 15 * 60000;
  var DAVBG_LIMIT = 120000;          // one app may take two minutes, then it waits for the next round
  var DAVBG_APPS = ["calendar", "contacts", "todo"];
  var DAVBG_KEYS = { calendar: "oros-calendar-data", contacts: "oros-contacts-data", todo: "oros-todo-data" };
  var davBg = null;                  // { id, el, timer } while a frame runs
  var davBgLastTick = 0;
  function davBgRead() {
    try {
      var v = JSON.parse(localStorage.getItem("oros-davbg-last") || "null");
      return v && typeof v === "object" ? v : {};
    } catch (e) { return {}; }
  }
  // The app has a server link in its data (read like the apps do).
  function davBgLinked(id) {
    var d;
    try { d = JSON.parse(localStorage.getItem(DAVBG_KEYS[id]) || "null"); } catch (e) { return false; }
    if (!d || !d.dav) return false;
    if (id === "contacts") return typeof d.dav.url === "string" && !!d.dav.url;
    return Array.isArray(d.dav) && d.dav.some(function (x) { return x && typeof x.url === "string" && x.url; });
  }
  function davBgWanted() {
    try {
      if (SOLO || localStorage.getItem("oros-davbg-off") === "1") return false;
      if (!localStorage.getItem("oros-caldav-conf") || !localStorage.getItem("oros-caldav-pass")) return false;
    } catch (e) { return false; }
    return navigator.onLine !== false;
  }
  function davBgTickThrottled() {
    var now = Date.now();
    if (now - davBgLastTick < 60000) return;
    davBgLastTick = now;
    davBgTick();
  }
  function davBgTick() {
    if (davBg || !davBgWanted()) return;
    var last = davBgRead();
    if (Date.now() - (last.at || 0) < DAVBG_EVERY) return;
    var todo = DAVBG_APPS.filter(function (id) { return davBgLinked(id) && !appLive(id); });
    last.at = Date.now();
    try { localStorage.setItem("oros-davbg-last", JSON.stringify(last)); } catch (e) {}
    davBgNext(todo);
  }
  function davBgApp(id) {
    for (var i = 0; i < state.apps.length; i++) if (state.apps[i].id === id && state.apps[i].type === "internal") return state.apps[i];
    return null;
  }
  function davBgNext(todo) {
    var id = todo.shift(), app = id && davBgApp(id);
    if (!id) return;
    if (!app || appLive(id) || !davBgWanted()) { davBgNext(todo); return; }
    var f = document.createElement("iframe");
    f.name = "oros-davbg-" + Date.now().toString(36);
    f.setAttribute("aria-hidden", "true");
    f.setAttribute("tabindex", "-1");
    f.className = "oros-davbg";
    f.style.cssText = "position:fixed;width:1px;height:1px;left:-10px;top:-10px;border:0;opacity:0;pointer-events:none;";
    davBg = { id: id, el: f, todo: todo };
    davBg.timer = setTimeout(function () { davBgEnd(id, { err: "timeout" }); }, DAVBG_LIMIT);
    document.body.appendChild(f);
    frameGo(f, app.url + (app.url.indexOf("?") === -1 ? "?" : "&") + "davbg=1");
  }
  // Ends the running frame (done, timed out, or the app opened). r null:
  // stopped without a result (nothing is recorded).
  function davBgEnd(id, r, keepGoing) {
    if (!davBg || davBg.id !== id) return;
    var b = davBg;
    davBg = null;
    clearTimeout(b.timer);
    if (r) {
      var last = davBgRead();
      last.apps = last.apps && typeof last.apps === "object" ? last.apps : {};
      last.apps[id] = { at: Date.now(), err: String(r.err || "").slice(0, 40), held: r.held ? 1 : 0 };
      try { localStorage.setItem("oros-davbg-last", JSON.stringify(last)); } catch (e) {}
    }
    // Two seconds for the app's last save to reach sync.js.
    setTimeout(function () {
      mtDrop(b.el);
      if (keepGoing !== false) davBgNext(b.todo);
    }, r ? 2000 : 0);
  }
  window.addEventListener("message", function (ev) {
    var d = ev.data;
    if (!davBg || !d || d.oros !== "dav-bg-done" || ev.origin !== location.origin) return;
    if (ev.source !== davBg.el.contentWindow || d.app !== davBg.id) return;
    davBgEnd(davBg.id, { err: typeof d.err === "string" ? d.err : "", held: !!d.held });
  });
  // openApp: the app's own frame takes over, the background one goes now.
  function davBgStop(id) {
    if (davBg && davBg.id === id) davBgEnd(id, null, true);
  }
  function davBgSetOn(on) {
    try {
      if (on) localStorage.removeItem("oros-davbg-off");
      else localStorage.setItem("oros-davbg-off", "1");
    } catch (e) {}
  }
  // Settings asks: { off, at, apps } (the shape above).
  window.__orosDavBg = function () {
    var last = davBgRead(), off = false;
    try { off = localStorage.getItem("oros-davbg-off") === "1"; } catch (e) {}
    return { off: off, at: last.at || 0, apps: last.apps || {}, running: davBg ? davBg.id : "" };
  };

  // ---------- 10d. Back key (BK-1) ----------
  // The phone's Back key (and the browser's Back) does what the bar's
  // Back does: an open app returns to the desktop (in a single app, to
  // that app). Opening an app from the desktop adds one history entry
  // marked { orosApp: 1 }; Back leaves it and popstate closes the app.
  // The entry stays when the bar button is used, and the next app
  // reuses it, so entries never pile up. An app's own page changes
  // inside its frame come first, as in any browser.
  function appAway() {
    return !!state.running && !(SOLO && state.running.id === SOLO);
  }
  function backArm() {
    try {
      if (window.history.state && window.history.state.orosApp) return;
      window.history.pushState({ orosApp: 1 }, "", window.location.href);
    } catch (e) {}
  }
  window.addEventListener("popstate", function (e) {
    if (e.state && e.state.orosApp) return;   // Forward onto the entry: nothing to do
    if (appAway()) returnToDesktop();
  });

  // ---------- 10c. App switcher (multitasking, wave M3) ----------
  // The open apps of 10b in one list: the bar button (shown while
  // another app is open behind the one you see, with the count),
  // Ctrl+Alt+Shift+W, and a dot on open apps in the menu and the Dock.
  // Desktop: a centred panel, arrows / Enter / Delete / Esc; the app
  // you left last has the focus, so the shortcut + Enter goes back to
  // it. Phone (<= 600px): the same list as a sheet from the bottom,
  // swipe a card sideways to close that app. Off (or SOLO): the button
  // never shows and the shortcut says how to turn multitasking on.
  var mtSw = null;   // { ov, close } while the switcher is open

  function mtLabel(app) {
    var k = "app." + app.id, v = window.t(k);
    return (v === k) ? app.name : v;
  }
  function mtAgo(at) {
    var s = Math.max(0, Math.round((Date.now() - at) / 1000));
    if (s < 60) return window.t("mt.sw.justnow");
    var rtf = null;
    try { rtf = new Intl.RelativeTimeFormat(state.lang || "en", { numeric: "auto" }); } catch (e) {}
    var m = Math.round(s / 60), h = Math.round(s / 3600);
    if (!rtf) return m < 60 ? m + " min" : h + " h";
    return m < 60 ? rtf.format(-m, "minute") : rtf.format(-h, "hour");
  }
  // Bar button, menu rows and Dock follow every change of the list.
  function mtPaint() {
    var on = mtActive();
    var n = on ? mtOpenList().length : 0;
    var btn = document.getElementById("mt-btn");
    if (btn) {
      var show = on && mtList().length > 0;
      if (btn.hidden === show) { btn.hidden = !show; queueFitBar(); }
      var c = btn.querySelector(".mt-count");
      if (c) c.textContent = String(n);
      btn.setAttribute("aria-label", window.t("mt.sw.btn").replace("{n}", n));
    }
    Array.prototype.forEach.call(document.querySelectorAll("#app-menu .menu-item[data-app]"), function (b) {
      b.classList.toggle("mt-open", on && appLive(b.getAttribute("data-app")));
    });
    if (window.orosLauncher) window.orosLauncher.refresh();
    if (mtSw) mtSwRender();
  }
  mtOnChange = mtPaint;

  function mtSwClose() {
    if (!mtSw) return;
    var o = mtSw;
    mtSw = null;
    o.ov.remove();
    document.removeEventListener("keydown", o.onKey, true);
    if (o.back && o.back.focus && document.contains(o.back)) { try { o.back.focus(); } catch (e) {} }
  }
  function mtSwGo(app) {
    mtSwClose();
    if (state.running && state.running.id === app.id) return;
    openApp(app);
  }
  function mtSwRender() {
    var box = mtSw.ov.querySelector(".mt-sw-list");
    var list = mtOpenList();
    var focusId = document.activeElement && document.activeElement.closest &&
      document.activeElement.closest(".mt-sw-row") ? document.activeElement.closest(".mt-sw-row").getAttribute("data-app") : null;
    box.textContent = "";
    mtSw.ov.querySelector(".mt-sw-n").textContent = String(list.length);
    mtSw.ov.querySelector(".mt-sw-all").hidden = !list.length;
    if (!list.length) {
      var em = document.createElement("p");
      em.className = "mt-sw-empty";
      em.textContent = window.t("mt.sw.empty");
      box.appendChild(em);
    }
    list.forEach(function (it) {
      var row = document.createElement("div");
      row.className = "mt-sw-row" + (it.front ? " mt-sw-front" : "");
      row.setAttribute("role", "listitem");
      row.setAttribute("data-app", it.app.id);
      var go = document.createElement("button");
      go.type = "button";
      go.className = "mt-sw-go";
      go.innerHTML = '<span class="app-ico">' + (ICONS[it.app.icon] || "") + '</span>' +
        '<span class="mt-sw-name"></span><span class="mt-sw-when"></span>';
      go.querySelector(".mt-sw-name").textContent = mtLabel(it.app);
      go.querySelector(".mt-sw-when").textContent = it.front ? window.t("mt.sw.now") : it.side ? window.t("mt.sw.beside") : mtAgo(it.at);
      if (it.front) go.setAttribute("aria-current", "true");
      go.addEventListener("click", function () { if (!row.__mtSwiped) mtSwGo(it.app); });
      var x = document.createElement("button");
      x.type = "button";
      x.className = "mt-sw-x";
      x.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
      var xl = window.t("mt.sw.close").replace("{app}", mtLabel(it.app));
      x.setAttribute("aria-label", xl);
      x.title = xl;
      x.addEventListener("click", function () { mtClose(it.app.id); });
      row.appendChild(go);
      var sb = mtSwSplitBtn(it);
      if (sb) row.appendChild(sb);
      row.appendChild(x);
      mtSwSwipe(row, it.app.id);
      box.appendChild(row);
    });
    var rows = box.querySelectorAll(".mt-sw-go");
    var want = null;
    if (focusId) want = box.querySelector('.mt-sw-row[data-app="' + focusId + '"] .mt-sw-go');
    if (!want && rows.length) want = rows[list.length > 1 && list[0].front ? 1 : 0];
    if (!want) want = mtSw.ov.querySelector(".mt-sw-done");
    if (want) want.focus();
  }
  // Phone: drag a card sideways past a third of its width to close it.
  function mtSwSwipe(row, id) {
    var x0 = null, dx = 0, pid = null;
    row.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "mouse" || e.target.closest(".mt-sw-x")) return;
      x0 = e.clientX; dx = 0; pid = e.pointerId; row.__mtSwiped = false;
    });
    row.addEventListener("pointermove", function (e) {
      if (x0 === null || e.pointerId !== pid) return;
      dx = e.clientX - x0;
      if (Math.abs(dx) > 8) { row.__mtSwiped = true; row.style.transform = "translateX(" + dx + "px)"; row.style.opacity = String(Math.max(0.2, 1 - Math.abs(dx) / row.offsetWidth)); }
    });
    function end() {
      if (x0 === null) return;
      x0 = null;
      if (Math.abs(dx) > row.offsetWidth / 3) { mtClose(id); return; }
      row.style.transform = ""; row.style.opacity = "";
      setTimeout(function () { row.__mtSwiped = false; }, 0);
    }
    row.addEventListener("pointerup", end);
    row.addEventListener("pointercancel", end);
  }
  // Side by side (M4) from the list: "beside" on a background app, "add
  // an app beside" on the one in front (the menu picks it), "stop" on
  // the side app. Only from 1024 px wide.
  function mtSwSplitBtn(it) {
    if (!mtSplitFits()) return null;
    var kind = it.side ? "stop" : it.front ? (mt.side ? "" : "pick") : "beside";
    if (!kind) return null;
    var b = document.createElement("button");
    b.type = "button";
    b.className = "mt-sw-split" + (it.side ? " on" : "");
    b.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/></svg>';
    var l = window.t("mt.sw.split." + kind).replace("{app}", mtLabel(it.app));
    b.setAttribute("aria-label", l);
    b.title = l;
    b.addEventListener("click", function (e) {
      e.stopPropagation();   // the menu's outside-click would close it again
      if (kind === "stop") { mtSideEnd(true); mtChanged(); return; }
      mtSwClose();
      if (kind === "beside") { mtSideOpen(it.app); return; }
      mt.pickSide = true;
      openMenuSearch();
    });
    return b;
  }

  // The divider between the two apps: drag (or arrow keys) to share
  // the width, 25 % to 75 %; its button ends side by side. The pane you
  // click last gets the keys (the browser does that) and an outline.
  var mtSplitAt = 50;
  function mtSplitPaint() {
    var run = document.getElementById("oros-running");
    var d = document.getElementById("mt-divider");
    if (!d) {
      d = document.createElement("div");
      d.id = "mt-divider";
      d.innerHTML = '<span class="mt-grip" role="separator" aria-orientation="vertical" aria-valuemin="25" aria-valuemax="75" tabindex="0"></span>' +
        '<button type="button" class="mt-unsplit">' +
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>';
      d.querySelector(".mt-unsplit").addEventListener("click", function (e) {
        e.stopPropagation();
        mtSideEnd(true);
        mtChanged();
      });
      d.addEventListener("pointerdown", function (e) {
        if (e.target.closest(".mt-unsplit")) return;
        e.preventDefault();
        run.classList.add("mt-dragging");      // frames would swallow the pointer
        try { d.setPointerCapture(e.pointerId); } catch (e2) {}
        function move(ev) {
          var r = run.getBoundingClientRect();
          mtSplitSet((ev.clientX - r.left) / r.width * 100);
        }
        function up() {
          run.classList.remove("mt-dragging");
          d.removeEventListener("pointermove", move);
          d.removeEventListener("pointerup", up);
          d.removeEventListener("pointercancel", up);
        }
        d.addEventListener("pointermove", move);
        d.addEventListener("pointerup", up);
        d.addEventListener("pointercancel", up);
      });
      d.querySelector(".mt-grip").addEventListener("keydown", function (e) {
        var step = e.shiftKey ? 10 : 5;
        if (e.key === "ArrowLeft") { e.preventDefault(); mtSplitSet(mtSplitAt - step); }
        else if (e.key === "ArrowRight") { e.preventDefault(); mtSplitSet(mtSplitAt + step); }
        else if (e.key === "Home") { e.preventDefault(); mtSplitSet(50); }
      });
      run.appendChild(d);
    }
    var l = window.t("mt.split.divider"), g = d.querySelector(".mt-grip");
    g.setAttribute("aria-label", l);
    d.title = l;
    var u = window.t("mt.split.end");
    d.querySelector(".mt-unsplit").setAttribute("aria-label", u);
    d.querySelector(".mt-unsplit").title = u;
    mtSplitSet(mtSplitAt);
  }
  function mtSplitSet(pct) {
    mtSplitAt = Math.round(Math.max(25, Math.min(75, pct)));
    var run = document.getElementById("oros-running");
    run.style.setProperty("--mt-left", mtSplitAt + "fr");
    run.style.setProperty("--mt-right", (100 - mtSplitAt) + "fr");
    var g = document.querySelector("#mt-divider .mt-grip");
    if (g) g.setAttribute("aria-valuenow", String(mtSplitAt));
  }
  // Outline on the pane that has the keys.
  function mtSplitFocus() {
    if (!mt.side) return;
    var a = document.activeElement, front = document.getElementById("app-frame");
    if (a !== front && a !== mt.side.el) return;
    front.classList.toggle("mt-focus", a === front);
    mt.side.el.classList.toggle("mt-focus", a === mt.side.el);
  }
  window.addEventListener("blur", function () { setTimeout(mtSplitFocus, 0); });
  window.addEventListener("resize", function () {
    if (mt.side && !mtSplitFits()) { mtSideEnd(true); mtChanged(); }
  });

  function mtSwitcher() {
    if (SOLO) return;
    if (mtSw) { mtSwClose(); return; }
    closeMenu();
    var ov = document.createElement("div");
    ov.id = "mt-sw";
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-modal", "true");
    ov.setAttribute("aria-labelledby", "mt-sw-title");
    var on = mtActive();
    ov.innerHTML =
      '<div class="mt-sw-box">' +
        '<div class="mt-sw-head"><h2 id="mt-sw-title">' + escapeHtml(window.t("mt.sw.title")) +
          (on ? ' <span class="mt-sw-n"></span>' : '') + '</h2>' +
          '<button type="button" class="mt-sw-done">' + escapeHtml(window.t("mt.sw.done")) + '</button></div>' +
        (on ? '<div class="mt-sw-list" role="list"></div>' +
          '<div class="mt-sw-foot"><span class="mt-sw-keys">' + escapeHtml(window.t("mt.sw.keys")) + '</span>' +
          '<button type="button" class="mt-sw-all">' + escapeHtml(window.t("mt.sw.all")) + '</button></div>'
        : '<p class="mt-sw-empty">' + escapeHtml(window.t("mt.sw.off")) + '</p>' +
          '<div class="mt-sw-foot"><button type="button" class="mt-sw-set">' + escapeHtml(window.t("mt.sw.settings")) + '</button></div>') +
      '</div>';
    function onKey(e) {
      if (!mtSw) return;
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); mtSwClose(); return; }
      if (!ov.contains(document.activeElement)) return;
      var rows = Array.prototype.slice.call(ov.querySelectorAll(".mt-sw-go"));
      var i = rows.indexOf(document.activeElement.closest(".mt-sw-row") ? document.activeElement.closest(".mt-sw-row").querySelector(".mt-sw-go") : null);
      if ((e.key === "ArrowDown" || e.key === "ArrowUp") && rows.length) {
        e.preventDefault();
        var j = i < 0 ? 0 : (i + (e.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length;
        rows[j].focus();
      } else if ((e.key === "Delete" || e.key === "Backspace") && i >= 0) {
        e.preventDefault();
        mtClose(rows[i].closest(".mt-sw-row").getAttribute("data-app"));
      }
    }
    ov.addEventListener("click", function (e) { if (e.target === ov) mtSwClose(); });
    ov.querySelector(".mt-sw-done").addEventListener("click", mtSwClose);
    if (on) ov.querySelector(".mt-sw-all").addEventListener("click", function () { mtCloseAll(); });
    else ov.querySelector(".mt-sw-set").addEventListener("click", function () {
      mtSwClose();
      if (window.orosSettings) window.orosSettings.open("system");
    });
    document.body.appendChild(ov);
    document.addEventListener("keydown", onKey, true);
    mtSw = { ov: ov, onKey: onKey, back: document.activeElement };
    if (on) mtSwRender();
    else ov.querySelector(".mt-sw-set").focus();
  }

  (function () {
    var left = document.querySelector("#oros-bar .bar-left");
    if (!left || SOLO) return;
    var btn = document.createElement("button");
    btn.id = "mt-btn";
    btn.type = "button";
    btn.hidden = true;
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><rect x="7" y="3" width="14" height="12" rx="2"/><path d="M17 19H5a2 2 0 0 1-2-2V8"/></svg><span class="mt-count">0</span>';
    btn.setAttribute("data-i18n-title", "mt.sw.tip");
    btn.setAttribute("title", window.t("mt.sw.tip"));
    btn.addEventListener("click", function (e) { e.stopPropagation(); mtSwitcher(); });
    left.appendChild(btn);
  })();

  // ---------- 11. Menu open/close ----------
  // The bell's panel never sees a menu-button click (the button stops
  // it), so the menu closes it: one tray popup at a time (Chris 2026-10-12).
  function closeNotifPanel() {
    if (window.orosNotifs && typeof window.orosNotifs.closeNotificationPanel === "function") {
      window.orosNotifs.closeNotificationPanel();
    }
  }
  function toggleMenu() {
    closeNotifPanel();
    if (SOLO) { soloMenuButton(); return; }
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
    setLangUser(langNext());      // v0.18.1b: open apps follow the toggle
  });

  // Unsynced-changes guard: warn on close when dirty AND online
  // (offline data is safe in localStorage — nothing to warn about).
  window.addEventListener("beforeunload", function (e) {
    if (osResetting) return;   // factory reset owns this unload
    if (usersLeaving) return;   // a sign-out pushed what it could and closes the window
    if (Date.now() - extHandoffAt < 2000) return;   // EXT-1: a tel:/mailto: handoff, the page stays
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
        var loc = appFrameOf("help").contentWindow.location;
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
      if (profilesWanted()) localStorage.setItem(PROFILE_KEY, "1");
    } catch (e) { return; }
    tourMaybe();
  }

  // First-run profiles (profiles.js, strategy §9): before the tour, a
  // new user chooses which apps the menu shows. "Everything" is first
  // and chosen; Continue, X or Escape with it change nothing. Not on a
  // device that already has menu choices (pulled or made) or is
  // connected to sync: that user is not new, only this device is.
  // profiles.js loads on first use (first run or Settings), never at boot.
  var PROFILE_KEY = "oros-profile-pending";
  var profilesLoad = null;
  function profilesL() {
    var L = window.orosLauncher;
    return (L && typeof L.presetMenuHidden === "function" && typeof L.menuStored === "function") ? L : null;
  }
  function profilesModule() {
    if (window.orosProfiles) return Promise.resolve(window.orosProfiles);
    if (!profilesLoad) {
      profilesLoad = new Promise(function (resolve, reject) {
        var s = document.createElement("script");
        s.src = "profiles.js?v=" + APP_VERSION;
        s.onload = function () { if (window.orosProfiles) resolve(window.orosProfiles); else reject(new Error("profiles missing")); };
        s.onerror = reject;
        document.head.appendChild(s);
      });
      profilesLoad.catch(function () { profilesLoad = null; });
    }
    return profilesLoad;
  }
  function profilesWanted() {
    if (SOLO) return false;
    var L = profilesL();
    if (!L || L.menuStored()) return false;
    var S = window.orosSync;
    return !(S && typeof S.isConnected === "function" && S.isConnected());
  }
  function profilesApps() {
    return settingsMenuApps() || [];
  }
  // mode "first": then the tour; "settings": from Settings › Menu.
  var profilesBusy = false;   // loading or on screen: the tour waits
  function showProfiles(mode, after) {
    var L = profilesL();
    if (!L || profilesBusy) return;
    profilesBusy = true;
    var then = function (r) { profilesBusy = false; if (after) after(r); };
    profilesModule().then(function (P) {
      if (!showProfilesNow(P, L, mode, then)) then();
    }, function () { then(); });
  }
  function showProfilesNow(P, L, mode, after) {
    var apps = profilesApps();
    return P.show({
      mode: mode,
      lang: langBase(),
      apps: apps,
      shown: apps.filter(function (a) { return a.shown; }).map(function (a) { return a.id; }),
      done: function (r) {
        if (r && r.hidden) {
          if (mode === "first") L.presetMenuHidden(r.hidden);
          else {
            L.setMenuHidden(r.hidden, true);
            L.setMenuHidden(r.shown, false);
          }
        }
        if (after) after(r);
      }
    });
  }

  function tourMaybe() {
    if (SOLO) return;                  // the tour shows the desktop's top bar
    var pending;
    try { pending = localStorage.getItem(TOUR_KEY) === "1"; } catch (e) { pending = false; }
    if (!pending || tourBox || profilesBusy) return;
    var tries = 0;
    (function wait() {
      // Splash still up, apps.json not in yet, or an app on screen.
      if (document.getElementById("oro-splash") || !state.apps.length || state.running) {
        if (state.running || ++tries > 60) return;   // returnToDesktop retries
        setTimeout(wait, 250);
        return;
      }
      var prof = false;
      try { prof = localStorage.getItem(PROFILE_KEY) === "1"; } catch (e) {}
      if (prof && profilesWanted()) {
        showProfiles("first", function (r) {
          try { localStorage.removeItem(PROFILE_KEY); } catch (e) {}
          if (r && r.already) {
            // Not a new user: no tour; their apps and menu come with sync.
            try { localStorage.removeItem(TOUR_KEY); localStorage.setItem(TOUR_DONE, "1"); } catch (e) {}
            if (typeof window.__orosOpenAt === "function") window.__orosOpenAt("settings", { section: "sync" });
            return;
          }
          startTour();
        });
        return;
      }
      try { localStorage.removeItem(PROFILE_KEY); } catch (e) {}
      startTour();
    })();
  }

  function tourVisible(node) {
    if (!node || node.hidden) return false;
    var r = node.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(node).visibility !== "hidden";
  }

  function tourSteps() {
    var L = window.orosLauncher;
    var someHidden = !!(L && typeof L.menuHiddenIds === "function" && L.menuHiddenIds().length);
    var steps = [{ key: "welcome" }, { key: "menu", target: "btn-menu", body: someHidden ? "tour.menu.bodyHidden" : "" }];
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
    if (appLive("contacts")) {
      appShow("contacts");
      var f = appFrameOf("contacts");
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
    if (appLive("cycle")) {
      appShow("cycle");
      var f = appFrameOf("cycle");
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
    if (appLive("mood")) {
      appShow("mood");
      var f = appFrameOf("mood");
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
    if (appLive("time")) {
      appShow("time");
      var f = appFrameOf("time");
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
    if (appLive("todo")) {
      appShow("todo");
      var f = appFrameOf("todo");
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
    if (appLive("fitness")) {
      appShow("fitness");
      var f = appFrameOf("fitness");
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
    if (appLive("habits")) {
      appShow("habits");
      var f = appFrameOf("habits");
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
    if (appLive("quote")) {
      appShow("quote");
      var f = appFrameOf("quote");
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
    if (appLive("health")) {
      appShow("health");
      var f = appFrameOf("health");
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
    if (appLive("minimalism")) {
      appShow("minimalism");
      var f = appFrameOf("minimalism");
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
    if (appLive("plants")) {
      appShow("plants");
      var f = appFrameOf("plants");
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

  // Chore Wheel deep-link bridge (pattern: Plant Care). Payload =
  // "today" (reminder) or a day "YYYY-MM-DD" (Calendar feed row).
  // Open app → live push; closed → sessionStorage staging (device-
  // local, one-shot, consumed by chores.js at boot) + open.
  window.__orosOpenChores = function (target) {
    if (typeof target !== "string" || !/^(today|\d{4}-\d{2}-\d{2})$/.test(target)) return;
    if (appLive("chores")) {
      appShow("chores");
      var f = appFrameOf("chores");
      try {
        if (f && f.contentWindow &&
            typeof f.contentWindow.__orosChoresOpen === "function") {
          f.contentWindow.__orosChoresOpen(target);
          return;
        }
      } catch (e) {}
    }
    try { sessionStorage.setItem("oros-chores-open", target); } catch (e) {}
    openAppById("chores");
  };

  // Podcasts "add this feed" bridge (Reader, Bookmarks). Payload =
  // an http(s) feed or page address. Open app → live push; closed →
  // one-shot pending address taken by podcasts.js at boot + open.
  var podcastsPendingAdd = null;
  window.__orosOpenPodcastsAdd = function (url) {
    if (typeof url !== "string" || url.length > 2000 || !/^https?:\/\//i.test(url)) return;
    if (appLive("podcasts")) {
      appShow("podcasts");
      var f = appFrameOf("podcasts");
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
    if (appLive("garage")) {
      appShow("garage");
      var f = appFrameOf("garage");
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

  // Travel deep-link bridge (pattern: Garage). Payload = a trip id,
  // optional tab "pack" | "plan" (Calendar timed rows → itinerary).
  // Open app → live push; closed → sessionStorage staging "id" or
  // "id plan" (device-local, one-shot, consumed by travel.js at
  // boot) + open.
  window.__orosOpenTravel = function (tripId, tab) {
    if (typeof tripId !== "string" || !/^[a-z0-9][a-z0-9-]{3,40}$/.test(tripId)) return;
    tab = tab === "pack" || tab === "plan" ? tab : "";
    if (appLive("travel")) {
      appShow("travel");
      var f = appFrameOf("travel");
      try {
        if (f && f.contentWindow &&
            typeof f.contentWindow.__orosTravelOpen === "function") {
          f.contentWindow.__orosTravelOpen(tripId, tab);
          return;
        }
      } catch (e) {}
    }
    try { sessionStorage.setItem("oros-travel-open", tab ? tripId + " " + tab : tripId); } catch (e) {}
    openAppById("travel");
  };

  // Pet Health Book deep-link bridge (pattern: Minimalism). Payload =
  // "today" (reminder) or a pet id (Calendar feed row). Open app →
  // live push; closed → sessionStorage staging (device-local, one-
  // shot, consumed by petcare.js at boot) + open.
  window.__orosOpenPetcare = function (target) {
    if (typeof target !== "string" || !/^[a-z0-9]{1,40}$/.test(target)) return;
    if (appLive("petcare")) {
      appShow("petcare");
      var f = appFrameOf("petcare");
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
    if (appLive("maps")) {
      appShow("maps");
      var f = appFrameOf("maps");
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
    if (appLive("maps")) {
      appShow("maps");
      var f = appFrameOf("maps");
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
    if (appLive("kanban")) {
      appShow("kanban");
      var f = appFrameOf("kanban");
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
    if (appLive("calendar")) {
      appShow("calendar");
      var f = appFrameOf("calendar");
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
  // window.parent.__orosOpenBudgetNew({k, a, d?, n?, c?, src?, crm?}) from an
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
    if (typeof p.crm === "string" && /^[A-Za-z0-9_-]{1,60}$/.test(p.crm)) q.crm = p.crm;   // CRM partner (BR-CRM-LINK)
    var has = false;
    for (var i = 0; i < state.apps.length; i++) if (state.apps[i].id === "budget") has = true;
    if (!has) return false;
    if (appLive("budget")) {
      appShow("budget");
      var f = appFrameOf("budget");
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
  // 0 <= p <= 10000000 (2 decimals each); cur any ISO code (AAA); client <= 80 and
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
    if (typeof p.cur === "string" && /^[A-Z]{3}$/.test(p.cur)) q.cur = p.cur;   // any ISO code (Quote wave 46)
    else if (p.cur !== undefined) return false;
    if (typeof p.client === "string") q.client = txt(p.client, 80).trim();
    if (typeof p.notes === "string") q.notes = txt(p.notes, 500);
    var has = false;
    for (var k = 0; k < state.apps.length; k++) if (state.apps[k].id === "quote") has = true;
    if (!has) return false;
    if (appLive("quote")) {
      appShow("quote");
      var f = appFrameOf("quote");
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

    if (appLive("calendar")) {
      appShow("calendar");
      var f = appFrameOf("calendar");
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
    
    if (appLive("television")) {
      appShow("television");
      var f = appFrameOf("television");
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
      isOpen: function (id) { return mtActive() && appLive(id); },   // multitasking: alive behind
      icons: ICONS,
      lang: function () { return langBase(); },
      label: function (app) {
        var k = "app." + app.id, v = window.t(k);
        return (v === k) ? app.name : v;
      },
      desktop: document.getElementById("oros-desktop"),
      menuChanged: function () { renderMenu(); }
    });
  }
  // Desktop menu (quickmenu.js, a shell component like launcher.js):
  // right-click or long press on the desktop → Assistant tasks + apps.
  if (window.orosQuick && !SOLO) {
    window.orosQuick.attach({
      desktop: document.getElementById("oros-desktop"),
      apps: function () { return state.apps; },
      open: openApp,
      running: function () { return state.running || null; },
      isOpen: function (id) { return mtActive() && appLive(id); },   // multitasking: alive behind
      icons: ICONS,
      lang: function () { return langBase(); },
      label: function (app) {
        var k = "app." + app.id, v = window.t(k);
        return (v === k) ? app.name : v;
      },
      toast: function (msg) { scToast("err", msg); }
    });
  }
  applySkin();
  applyWallpaper();
  applyTheme();
  a11yApply();
  a11yWatch();
  applyLang();
  langKeepOffline();
  // Seasonal decorations (seasonal.js, a shell component like pet.js):
  // snow, lights, pumpkins… over the wallpaper in the right season.
  // A single app has no desktop, so it gets none.
  if (window.orosSeasonal && !SOLO) {
    window.orosSeasonal.attach({
      desktop: document.getElementById("oros-desktop"),
      running: function () { return !!state.running; },
      lang: function () { return langBase(); },
      changed: function () { settingsNotify(); }
    });
  }
  // On-screen keyboard (osk.js, a shell component like seasonal.js):
  // touch screens without a keyboard, never on phones. A single app
  // has text fields too, so it gets one.
  if (window.orosOsk) {
    window.orosOsk.attach({
      lang: function () { return state.lang; },   // "de" picks the German layout
      toast: function (msg) { scToast("err", msg); },
      changed: function () { settingsNotify(); }
    });
  }
  // Quick settings: the sounds that play in the shell (their hosts
  // live on this window, so they go on after their app closes). One
  // row each, with Play / Pause and the app. A host that is missing or
  // has nothing loaded gives no row.
  function qsMedia() {
    var out = [];
    var label = function (id) { var k = "app." + id, v = window.t(k); return v === k ? id : v; };
    var mu = window.__orosMusicHost;
    if (mu && typeof mu.getState === "function") {
      var ms = mu.getState();
      if (ms && ms.cur) out.push({ id: "music", name: label("music"), playing: !!ms.playing,
        title: (ms.cur.t || "") + (ms.cur.a ? " · " + ms.cur.a : ""),
        toggle: function () { mu.toggle(); }, open: function () { openAppById("music"); } });
    }
    var pc = window.__orosPodcastsHost;
    if (pc && typeof pc.getState === "function") {
      var ps = pc.getState();
      if (ps && ps.cur) out.push({ id: "podcasts", name: label("podcasts"), playing: !!ps.playing,
        title: (ps.cur.title || "") + (ps.cur.show ? " · " + ps.cur.show : ""),
        toggle: function () { pc.toggle(); }, open: function () { openAppById("podcasts"); } });
    }
    var rx = window.__orosRadioHost;
    if (rx && rx.audio && rx.api && typeof rx.api.getState === "function") {
      var rs = null;
      try { rs = rx.api.getState(); } catch (e) {}
      if (rs && rs.current && rs.current.name) {
        var on = !rx.audio.paused;
        out.push({ id: "radio", name: label("radio"), playing: on, title: rs.current.name,
          toggle: function () { if (!rx.audio.paused) rxTrayStop(); else rxTrayPlay(); },
          open: function () { openAppById("radio"); } });
      }
    }
    var mx = mxHost();
    if (mx) {
      var xs = mx.state();
      if (xs && xs.active) out.push({ id: "mixer", name: label("mixer"), playing: !!xs.playing, title: xs.label || "",
        toggle: function () { mx.toggle(); }, open: function () { openAppById("mixer"); } });
    }
    return out;
  }

  // Desktop widgets (widgets.js): the weather card reads the tray's
  // cache, so the shell keeps fetching while that card is shown.
  function wgWantsWeather() {
    return !!(window.orosWidgets && window.orosWidgets.wants && window.orosWidgets.wants("weather"));
  }
  function wgWeather() {
    if (!navigator.onLine) return { off: true };
    var loc = wxLoc(), c = wxCacheFor(loc);
    if (!loc || !c || !c.at || (Date.now() - c.at) > WX_STALE_MS || typeof c.temp !== "number") return null;
    return { temp: c.temp, icon: wxIconFor(c.code), place: loc.label || "", at: c.at };
  }

  // Quick settings (qsettings.js, a shell component like osk.js): the
  // GNOME-style status button and panel at the right of the bar. A
  // single app has the bar too, so it gets one.
  if (window.orosQS) {
    window.orosQS.attach({
      lang: function () { return state.lang; },
      langNext: function () {
        var c = langNext();
        return { short: c.toUpperCase(), label: window.t("lang.tooltip") };
      },
      langToggle: function () { scToggleLang(); },
      settings: function (section) {
        if (section && window.orosSettings) window.orosSettings.open(section);
        else openAppById("settings");
      },
      restart: function () { location.reload(); },
      // Sign out (several users on an orOS Portable / orOS USB launcher).
      users: {
        on: function () { return !!(state.users && state.users.enabled && state.users.me); },
        signOut: function () { if (window.orosUsers) window.orosUsers.signOut(); }
      },
      sync: {
        state: function () {
          var dot = document.getElementById("sync-dot");
          return dot ? dot.getAttribute("data-state") || "off" : "off";
        },
        now: function () { syncNowFromDot(); }
      },
      theme: {
        get: function () { return state.theme; },
        set: function (v) { setThemeUser(v); }
      },
      a11y: { get: a11ySnapshot, set: a11ySetUser },
      media: qsMedia
    });
  }
  // Desktop widgets (widgets.js, a shell component like launcher.js):
  // clock, calendar, Today, weather, playing, sync on the desktop. A
  // single app has no desktop, so it gets none.
  if (window.orosWidgets && !SOLO) {
    window.orosWidgets.attach({
      desktop: document.getElementById("oros-desktop"),
      lang: function () { return state.lang; },
      phone: function () {
        try {
          return !window.matchMedia("(hover: hover) and (pointer: fine)").matches &&
            Math.min(screen.width || 0, screen.height || 0) < 600;
        } catch (e) { return false; }
      },
      running: function () { return !!state.running; },
      open: function (id) { openAppById(id); },
      openDay: function (ymd) { window.__orosOpenCalendar("-", ymd); },
      appName: function (id) { var k = "app." + id, v = window.t(k); return v === k ? "" : v; },
      weather: wgWeather,
      media: qsMedia,
      settings: function (section) { if (window.orosSettings) window.orosSettings.open(section); },
      sync: {
        state: function () {
          var dot = document.getElementById("sync-dot");
          return dot ? dot.getAttribute("data-state") || "off" : "off";
        },
        now: function () { syncNowFromDot(); }
      },
      toast: function (msg) { scToast("err", msg); },
      changed: function () { settingsNotify(); wxFetch(false); }
    });
  }
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
  // BK-E: Settings shows "set the passphrase again" when the key is gone.
  if (bkEncOn()) bkKeyLoad().then(function () { settingsNotify(); });
  
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
