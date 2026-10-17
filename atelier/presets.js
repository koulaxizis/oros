// ============================================================
// orOS Atelier — design sizes (data only, v1.0.0)
// The "What will you make?" cards. Screen formats are in pixels;
// print formats in millimetres. The design itself is in points
// (designkit): 1 px of a screen format = 1 pt, 1 mm = 72 / 25.4 pt;
// export picks the real pixels / dpi.
// Groups and sizes are listed in display order.
// ============================================================
(function (root) {
  "use strict";

  // Names: one table (a pack language adds its own, ../i18n.js).
  var S = {
    en: {
      "sgrp.social": "Social media",
      "sgrp.video": "Video & slides",
      "sgrp.print": "Print",
      "sgrp.brand": "Brand & web",
      "size.ig-post": "Instagram post",
      "size.ig-portrait": "Instagram portrait",
      "size.story": "Story / Reel",
      "size.fb-post": "Facebook post",
      "size.fb-cover": "Facebook cover",
      "size.x-post": "X / Bluesky post",
      "size.li-banner": "LinkedIn banner",
      "size.pin": "Pinterest pin",
      "size.yt-thumb": "YouTube thumbnail",
      "size.yt-banner": "YouTube banner",
      "size.slides": "Presentation 16:9",
      "size.slides-43": "Presentation 4:3",
      "size.video-hd": "Video 1080p",
      "size.poster-a3": "Poster A3",
      "size.poster-a4": "Poster / flyer A4",
      "size.flyer-a5": "Flyer A5",
      "size.invite": "Invitation 5×7 in",
      "size.card-post": "Postcard",
      "size.card-biz": "Business card",
      "size.menu": "Menu A4",
      "size.cv": "CV / resume A4",
      "size.certificate": "Certificate A4",
      "size.logo": "Logo",
      "size.web-banner": "Web banner",
      "size.email-head": "Email header",
      "size.wallpaper-d": "Desktop wallpaper",
      "size.wallpaper-m": "Phone wallpaper"
    },
    el: {
      "sgrp.social": "Μέσα κοινωνικής δικτύωσης",
      "sgrp.video": "Βίντεο & παρουσιάσεις",
      "sgrp.print": "Έντυπα",
      "sgrp.brand": "Brand & web",
      "size.ig-post": "Ανάρτηση Instagram",
      "size.ig-portrait": "Κάθετη ανάρτηση Instagram",
      "size.story": "Story / Reel",
      "size.fb-post": "Ανάρτηση Facebook",
      "size.fb-cover": "Εξώφυλλο Facebook",
      "size.x-post": "Ανάρτηση X / Bluesky",
      "size.li-banner": "Banner LinkedIn",
      "size.pin": "Pin στο Pinterest",
      "size.yt-thumb": "Μικρογραφία YouTube",
      "size.yt-banner": "Banner YouTube",
      "size.slides": "Παρουσίαση 16:9",
      "size.slides-43": "Παρουσίαση 4:3",
      "size.video-hd": "Βίντεο 1080p",
      "size.poster-a3": "Αφίσα A3",
      "size.poster-a4": "Αφίσα / φέιγ βολάν A4",
      "size.flyer-a5": "Φέιγ βολάν A5",
      "size.invite": "Πρόσκληση 5×7 in",
      "size.card-post": "Καρτ ποστάλ",
      "size.card-biz": "Επαγγελματική κάρτα",
      "size.menu": "Μενού A4",
      "size.cv": "Βιογραφικό A4",
      "size.certificate": "Πιστοποιητικό A4",
      "size.logo": "Λογότυπο",
      "size.web-banner": "Banner ιστοσελίδας",
      "size.email-head": "Κεφαλίδα email",
      "size.wallpaper-d": "Ταπετσαρία υπολογιστή",
      "size.wallpaper-m": "Ταπετσαρία κινητού"
    }
  };
  var I = typeof window !== "undefined" && window.orosI18n;
  var LANG = I ? I.lang() : "en";
  if (I) I.table(S, "atelier", LANG);
  var PACK = LANG !== "en" && LANG !== "el" && S[LANG] ? S[LANG] : null;
  // [id, EN, EL] plus row[LANG] for a pack language (core.js AT.lbl3)
  function named(row, k, at) {
    row.splice(at, 0, S.en[k], S.el[k]);
    if (PACK) row[LANG] = PACK[k];
    return row;
  }

  var PRESETS = {
    groups: ["social", "video", "print", "brand"].map(function (id) { return named([id], "sgrp." + id, 1); }),
    // [id, group, EN, EL, width, height, unit "px" | "mm"]
    list: [
      ["ig-post",     "social", 1080, 1080, "px"],
      ["ig-portrait", "social", 1080, 1350, "px"],
      ["story",       "social", 1080, 1920, "px"],
      ["fb-post",     "social", 1200, 630,  "px"],
      ["fb-cover",    "social", 1640, 624,  "px"],
      ["x-post",      "social", 1600, 900,  "px"],
      ["li-banner",   "social", 1584, 396,  "px"],
      ["pin",         "social", 1000, 1500, "px"],
      ["yt-thumb",    "video",  1280, 720,  "px"],
      ["yt-banner",   "video",  2560, 1440, "px"],
      ["slides",      "video",  1920, 1080, "px"],
      ["slides-43",   "video",  1024, 768,  "px"],
      ["video-hd",    "video",  1920, 1080, "px"],
      ["poster-a3",   "print",  297,  420,  "mm"],
      ["poster-a4",   "print",  210,  297,  "mm"],
      ["flyer-a5",    "print",  148,  210,  "mm"],
      ["invite",      "print",  127,  178,  "mm"],
      ["card-post",   "print",  148,  105,  "mm"],
      ["card-biz",    "print",  85,   55,   "mm"],
      ["menu",        "print",  210,  297,  "mm"],
      ["cv",          "print",  210,  297,  "mm"],
      ["certificate", "print",  297,  210,  "mm"],
      ["logo",        "brand",  500,  500,  "px"],
      ["web-banner",  "brand",  1920, 600,  "px"],
      ["email-head",  "brand",  600,  200,  "px"],
      ["wallpaper-d", "brand",  1920, 1080, "px"],
      ["wallpaper-m", "brand",  1080, 2340, "px"]
    ].map(function (p) { return named(p, "size." + p[0], 2); }),
    // Custom size limits (editor units; designkit pages are 36..14400 pt).
    custom: { px: [36, 8000], mm: [13, 1200] },
    PX_PER_MM: 96 / 25.4
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PRESETS;
  else root.ATELIER_PRESETS = PRESETS;
})(this);
