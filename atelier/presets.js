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

  var PRESETS = {
    groups: [
      ["social", "Social media", "Μέσα κοινωνικής δικτύωσης"],
      ["video", "Video & slides", "Βίντεο & παρουσιάσεις"],
      ["print", "Print", "Έντυπα"],
      ["brand", "Brand & web", "Brand & web"]
    ],
    // [id, group, EN, EL, width, height, unit "px" | "mm"]
    list: [
      ["ig-post",     "social", "Instagram post",      "Ανάρτηση Instagram",        1080, 1080, "px"],
      ["ig-portrait", "social", "Instagram portrait",  "Κάθετη ανάρτηση Instagram", 1080, 1350, "px"],
      ["story",       "social", "Story / Reel",        "Story / Reel",              1080, 1920, "px"],
      ["fb-post",     "social", "Facebook post",       "Ανάρτηση Facebook",         1200, 630,  "px"],
      ["fb-cover",    "social", "Facebook cover",      "Εξώφυλλο Facebook",         1640, 624,  "px"],
      ["x-post",      "social", "X / Bluesky post",    "Ανάρτηση X / Bluesky",      1600, 900,  "px"],
      ["li-banner",   "social", "LinkedIn banner",     "Banner LinkedIn",           1584, 396,  "px"],
      ["pin",         "social", "Pinterest pin",       "Pin στο Pinterest",         1000, 1500, "px"],
      ["yt-thumb",    "video",  "YouTube thumbnail",   "Μικρογραφία YouTube",       1280, 720,  "px"],
      ["yt-banner",   "video",  "YouTube banner",      "Banner YouTube",            2560, 1440, "px"],
      ["slides",      "video",  "Presentation 16:9",   "Παρουσίαση 16:9",           1920, 1080, "px"],
      ["slides-43",   "video",  "Presentation 4:3",    "Παρουσίαση 4:3",            1024, 768,  "px"],
      ["video-hd",    "video",  "Video 1080p",         "Βίντεο 1080p",              1920, 1080, "px"],
      ["poster-a3",   "print",  "Poster A3",           "Αφίσα A3",                  297,  420,  "mm"],
      ["poster-a4",   "print",  "Poster / flyer A4",   "Αφίσα / φέιγ βολάν A4",     210,  297,  "mm"],
      ["flyer-a5",    "print",  "Flyer A5",            "Φέιγ βολάν A5",             148,  210,  "mm"],
      ["invite",      "print",  "Invitation 5×7 in",   "Πρόσκληση 5×7 in",          127,  178,  "mm"],
      ["card-post",   "print",  "Postcard",            "Καρτ ποστάλ",               148,  105,  "mm"],
      ["card-biz",    "print",  "Business card",       "Επαγγελματική κάρτα",       85,   55,   "mm"],
      ["menu",        "print",  "Menu A4",             "Μενού A4",                  210,  297,  "mm"],
      ["cv",          "print",  "CV / resume A4",      "Βιογραφικό A4",             210,  297,  "mm"],
      ["certificate", "print",  "Certificate A4",      "Πιστοποιητικό A4",          297,  210,  "mm"],
      ["logo",        "brand",  "Logo",                "Λογότυπο",                  500,  500,  "px"],
      ["web-banner",  "brand",  "Web banner",          "Banner ιστοσελίδας",        1920, 600,  "px"],
      ["email-head",  "brand",  "Email header",        "Κεφαλίδα email",            600,  200,  "px"],
      ["wallpaper-d", "brand",  "Desktop wallpaper",   "Ταπετσαρία υπολογιστή",     1920, 1080, "px"],
      ["wallpaper-m", "brand",  "Phone wallpaper",     "Ταπετσαρία κινητού",        1080, 2340, "px"]
    ],
    // Custom size limits (editor units; designkit pages are 36..14400 pt).
    custom: { px: [36, 8000], mm: [13, 1200] },
    PX_PER_MM: 96 / 25.4
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PRESETS;
  else root.ATELIER_PRESETS = PRESETS;
})(this);
