// ============================================================
// orOS Device Info — pure helpers (no DOM, no storage access)
// UMD-style: in Node they export through module.exports (tests),
// in the app they set window.DeviceCore.
//   - formatBytes: 1 KB = 1024 bytes, one decimal under 10
//   - keyOwner / sizeByOwner: which app a localStorage key belongs to
//   - cacheOwner: which app a Cache Storage cache belongs to
//   - parseUA: approximate browser + OS from the user agent
//   - featureImpact: which apps lose what when a feature is missing
//   - buildReport: the plain-text report for "Copy report"
// Nothing here ever looks at a stored VALUE beyond its length.
// ============================================================
(function (root) {
  "use strict";

  // Key prefixes that do not match an app id. Values are app ids;
  // "_shell" is orOS itself (desktop, sync, menu, notifications).
  var KEY_ALIASES = {
    wx: "weather", weatherapp: "weather",
    cal: "calendar",
    petgarden: "petworld", petnest: "petworld", petgames: "petworld",
    petprogress: "petworld",
    alarms: "time", alarm: "time",
    pet: "_pet",
    sync: "_shell", db: "_shell", slices: "_shell", shell: "_shell",
    lang: "_shell", theme: "_shell", skin: "_shell", wallpaper: "wallpaper",
    autoexport: "_shell", fs: "_shell", notifs: "_shell", last: "_shell",
    reset: "_shell", menu: "_shell", palette: "_shell", desktop: "_shell",
    vault: "_shell", ofs: "_shell", pkce: "_shell", remote: "_shell",
    running: "_shell", runtime: "_shell", backups: "_shell"
  };

  // Shell-owned keys that carry an app name but belong to orOS.
  var SHELL_KEYS = {
    "oros-wallpaper": 1, "oros-wallpaper-art": 1
  };

  // The owner of one localStorage key: an app id from `appIds`,
  // "_shell", "_pet", or "_other" (not an orOS key).
  // `slices` is the sync registry (slice name -> storage key): a key
  // registered by a slice whose name is an app id belongs to it.
  function keyOwner(key, appIds, slices) {
    key = String(key);
    if (key.indexOf("oros-") !== 0) return "_other";
    if (SHELL_KEYS[key]) return "_shell";
    var ids = {};
    (appIds || []).forEach(function (id) { ids[id] = 1; });
    if (slices && typeof slices === "object") {
      for (var name in slices) {
        if (Object.prototype.hasOwnProperty.call(slices, name) &&
            slices[name] === key && ids[name]) return name;
      }
    }
    var rest = key.slice(5);
    // Longest app id that is the whole rest or a "<id>-" prefix.
    var best = "";
    for (var id in ids) {
      if ((rest === id || rest.indexOf(id + "-") === 0) && id.length > best.length) best = id;
    }
    if (best) return best;
    var head = rest.split("-")[0];
    var alias = KEY_ALIASES[head];
    if (alias && (alias.charAt(0) === "_" || ids[alias])) return alias;
    return "_shell";
  }

  // Bytes a key/value pair takes in localStorage. Browsers store
  // UTF-16, two bytes per code unit, and count the key too.
  function entryBytes(key, valueLength) {
    return (String(key).length + (valueLength || 0)) * 2;
  }

  // entries: [{ key, len }] (len = value length in code units).
  // Returns [{ owner, bytes, keys }] sorted by bytes, largest first;
  // equal sizes sort by owner so the order is stable.
  function sizeByOwner(entries, appIds, slices) {
    var map = {};
    (entries || []).forEach(function (e) {
      var o = keyOwner(e.key, appIds, slices);
      if (!map[o]) map[o] = { owner: o, bytes: 0, keys: 0 };
      map[o].bytes += entryBytes(e.key, e.len);
      map[o].keys += 1;
    });
    var out = [];
    for (var k in map) out.push(map[k]);
    out.sort(function (a, b) {
      return b.bytes - a.bytes || (a.owner < b.owner ? -1 : a.owner > b.owner ? 1 : 0);
    });
    return out;
  }

  function totalBytes(rows) {
    var n = 0;
    (rows || []).forEach(function (r) { n += r.bytes; });
    return n;
  }

  // Cache Storage names (sw.js and the apps) -> owner.
  function cacheOwner(name) {
    name = String(name);
    if (name === "oros-map-tiles") return "maps";
    if (name.indexOf("oros-television") === 0) return "television";
    if (name.indexOf("oros-radio") === 0) return "radio";
    if (name.indexOf("oros-shell-") === 0 || name.indexOf("oros-runtime-") === 0 ||
        name.indexOf("oros-v") === 0) return "_offline";
    return "_other";
  }

  // 1536 -> "1.5 KB"; decimals is a separator for the language.
  function formatBytes(n, dec) {
    dec = dec || ".";
    n = Math.max(0, Number(n) || 0);
    var units = ["B", "KB", "MB", "GB", "TB"];
    var i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    var s;
    if (i === 0) s = String(Math.round(n));
    else if (n < 10) s = (Math.round(n * 10) / 10).toFixed(1);
    else s = String(Math.round(n));
    if (s === "1024" && i < units.length - 1) { s = "1.0"; i++; }
    return s.replace(".", dec) + " " + units[i];
  }

  function percent(part, whole) {
    if (!(whole > 0)) return 0;
    var p = part / whole * 100;
    return Math.max(0, Math.min(100, p));
  }

  // Approximate browser + OS. Returns { browser, version, os, osVersion }.
  // User agents lie and freeze (iPadOS says Mac, Chrome freezes the
  // Android version), so the UI always labels this "about".
  function parseUA(ua, platformHint) {
    ua = String(ua || "");
    var r = { browser: "", version: "", os: "", osVersion: "" };
    var m;
    if ((m = ua.match(/Edg(?:A|iOS)?\/([\d.]+)/))) { r.browser = "Edge"; r.version = m[1]; }
    else if ((m = ua.match(/(?:OPR|Opera)\/([\d.]+)/))) { r.browser = "Opera"; r.version = m[1]; }
    else if ((m = ua.match(/SamsungBrowser\/([\d.]+)/))) { r.browser = "Samsung Internet"; r.version = m[1]; }
    else if ((m = ua.match(/(?:Firefox|FxiOS)\/([\d.]+)/))) { r.browser = "Firefox"; r.version = m[1]; }
    else if ((m = ua.match(/(?:Chrome|CriOS)\/([\d.]+)/))) { r.browser = "Chrome"; r.version = m[1]; }
    else if (/Safari\//.test(ua) && (m = ua.match(/Version\/([\d.]+)/))) { r.browser = "Safari"; r.version = m[1]; }
    r.version = r.version.split(".")[0];

    if ((m = ua.match(/(?:iPhone|iPod).*? OS ([\d_]+)/))) { r.os = "iOS"; r.osVersion = m[1].replace(/_/g, "."); }
    else if ((m = ua.match(/iPad.*? OS ([\d_]+)/))) { r.os = "iPadOS"; r.osVersion = m[1].replace(/_/g, "."); }
    else if ((m = ua.match(/Android ([\d.]+)/))) { r.os = "Android"; r.osVersion = m[1]; }
    else if (/CrOS/.test(ua)) r.os = "ChromeOS";
    else if ((m = ua.match(/Windows NT ([\d.]+)/))) {
      r.os = "Windows";
      // NT 10.0 is both Windows 10 and 11; the UA cannot tell them apart.
      r.osVersion = { "10.0": "10/11", "6.3": "8.1", "6.2": "8", "6.1": "7" }[m[1]] || "";
    }
    else if (/Mac OS X/.test(ua)) {
      // An iPad asking for the desktop site says "Macintosh"; the
      // touch hint tells them apart.
      r.os = platformHint === "touch-mac" ? "iPadOS" : "macOS";
    }
    else if (/Linux/.test(ua)) r.os = "Linux";
    return r;
  }

  // Feature id -> app ids that use it (shell features listed as "_shell").
  // Only apps present in apps.json are shown, so unregistered or
  // removed apps simply drop out.
  var FEATURE_APPS = {
    notifications: ["_shell", "calendar", "cycle", "fitness"],
    folder:        ["_shell"],
    share:         ["contacts", "meals", "qr", "travel"],
    clipboard:     ["calculator", "contacts", "dice", "files", "meals", "names", "netizen",
                    "passwords", "prompter", "qr", "travel", "wordle"],
    vibrate:       ["zen", "fitness", "meals", "minesweeper", "bookmarks", "passwords"],
    wakelock:      ["zen", "fitness", "maps", "meals"],
    geolocation:   ["weather", "maps", "time"],
    opfs:          ["files"],
    serviceworker: ["_shell"],
    crypto:        ["_shell", "mail"],
    audio:         ["mixer", "radio", "time", "zen"]
  };

  function featureImpact(feature, appIds) {
    var ids = {};
    (appIds || []).forEach(function (id) { ids[id] = 1; });
    return (FEATURE_APPS[feature] || []).filter(function (id) {
      return id.charAt(0) === "_" || ids[id];
    });
  }

  // Plain-text report. sections: [{ title, rows: [[label, value]] }].
  function buildReport(header, sections) {
    var out = [header, ""];
    (sections || []).forEach(function (s) {
      out.push("## " + s.title);
      (s.rows || []).forEach(function (r) {
        out.push("- " + r[0] + ": " + r[1]);
      });
      out.push("");
    });
    return out.join("\n").replace(/\n+$/, "\n");
  }

  var api = {
    keyOwner: keyOwner,
    entryBytes: entryBytes,
    sizeByOwner: sizeByOwner,
    totalBytes: totalBytes,
    cacheOwner: cacheOwner,
    formatBytes: formatBytes,
    percent: percent,
    parseUA: parseUA,
    featureImpact: featureImpact,
    FEATURES: Object.keys(FEATURE_APPS),
    buildReport: buildReport
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DeviceCore = api;
})(typeof window !== "undefined" ? window : this);
