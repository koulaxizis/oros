// ============================================================
// orOS Converter — registry.js: which app converts what
// ------------------------------------------------------------
// One entry per app that ships <app>/convert.js (the converter
// contract, window.OrosConvert.<app>). The Converter reads this
// list to recognise a file before it loads anything; Files reads
// it to offer "Convert to orOS" on a selection.
//   app     the app id (and the key in window.OrosConvert)
//   script  root-relative path of the app's convert.js
//   to      the orOS bundle extension it writes
//   from    the extensions it accepts (lower case, with the dot).
//           Must match the module's own `from`
//           (tests/converter.test.js checks it once the file exists).
// The first entry that lists an extension wins.
// Pure data + lookups: no DOM, no storage.
// UMD: window.OrosConvertRegistry, or module.exports in Node.
// ============================================================
(function (root) {
  "use strict";

  var CONVERTERS = [
    { app: "writer", script: "writer/convert.js", to: ".orosdoc",
      from: [".docx", ".odt", ".rtf", ".html", ".htm", ".md", ".markdown", ".txt"] },
    { app: "spreadsheet", script: "spreadsheet/convert.js", to: ".orossheet",
      from: [".xlsx", ".xls", ".ods", ".csv"] }
  ];

  function extOf(name) {
    var m = /(\.[a-z0-9]+)$/i.exec(String(name || ""));
    return m ? m[1].toLowerCase() : "";
  }

  // The converter entry for a file name (or an extension), or null.
  function forName(name) {
    var s = String(name || ""), ext = s.charAt(0) === "." && s.indexOf(".", 1) === -1 ? s.toLowerCase() : extOf(s);
    if (!ext) return null;
    for (var i = 0; i < CONVERTERS.length; i++) {
      if (CONVERTERS[i].from.indexOf(ext) !== -1) return CONVERTERS[i];
    }
    return null;
  }

  function byApp(app) {
    for (var i = 0; i < CONVERTERS.length; i++) if (CONVERTERS[i].app === app) return CONVERTERS[i];
    return null;
  }

  // Every extension any converter accepts, in registry order.
  function extensions() {
    var out = [];
    CONVERTERS.forEach(function (c) {
      c.from.forEach(function (x) { if (out.indexOf(x) === -1) out.push(x); });
    });
    return out;
  }

  // A copy, so a caller can never change the table.
  function list() { return JSON.parse(JSON.stringify(CONVERTERS)); }

  var api = { list: list, forName: forName, byApp: byApp, extensions: extensions, extOf: extOf };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosConvertRegistry = api;
})(typeof window !== "undefined" ? window : this);
