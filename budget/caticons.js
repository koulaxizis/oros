// ============================================================
// orOS Budget — Category icons (budget/caticons.js)
// A fixed set of line icons drawn for orOS (24 × 24, round strokes,
// currentColor), no icon font and no emoji. A category stores only the
// icon's id (`ic`); an id this version does not know draws nothing.
// The SVG strings are fixed here, never built from stored data.
// ============================================================
(function (root) {
  "use strict";

  // A circle as a path (two arcs), so every icon is one <path>.
  function c(x, y, r) {
    return " M" + (x - r) + " " + y + "a" + r + " " + r + " 0 1 0 " + 2 * r + " 0a" + r + " " + r + " 0 1 0 " + -2 * r + " 0";
  }
  // id → path data, in the order the picker shows them (by theme).
  var ICONS = [
    // food and shopping
    ["cart", "M3 4h2l2.4 10.2a1 1 0 0 0 1 .8h8.8a1 1 0 0 0 1-.8L20 8H6.2" + c(9, 19.5, 1.2) + c(17, 19.5, 1.2)],
    ["basket", "M4 10h16l-1.5 9a1 1 0 0 1-1 .9h-11a1 1 0 0 1-1-.9L4 10z M8 10l3-6 M16 10l-3-6 M9 14v3 M12 14v3 M15 14v3"],
    ["bag", "M5 8h14l-1 12H6L5 8z M9 8V6a3 3 0 0 1 6 0v2"],
    ["cutlery", "M7 3v18 M5 3v5a2 2 0 0 0 4 0V3 M16 21V3c-2 1-3 4-3 7h3"],
    ["coffee", "M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9z M16 10h1.5a2.5 2.5 0 0 1 0 5H16 M8 3v3 M12 3v3"],
    ["pizza", "M12 21L3.5 6.5a14 14 0 0 1 17 0L12 21z M5.5 9.5a11 11 0 0 1 13 0" + c(10, 12, 0.8) + c(14, 13.5, 0.8)],
    ["wine", "M8 3h8l-.5 5a3.5 3.5 0 0 1-7 0L8 3z M12 11.5V20 M8.5 20h7"],
    ["beer", "M6 8h10v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V8z M16 11h2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-2 M6 8a3 3 0 0 1 5-3 3 3 0 0 1 5 3 M10 12v5 M12.5 12v5"],
    ["bread", "M5 11a3 3 0 0 1 0-6h14a3 3 0 0 1 0 6v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8z"],
    ["apple", "M12 7.5c-2-1.5-7-1-7 4.5S8 20 10 20c1 0 1.3-.5 2-.5s1 .5 2 .5c2 0 5-3.5 5-8S14 6 12 7.5z M12 7.5c0-2 1-3.5 3-4.5"],
    // home and bills
    ["home", "M3 11l9-7 9 7 M5 10v10h14V10 M10 20v-6h4v6"],
    ["bolt", "M13 3L5 13h6l-1 8 8-10h-6l1-8z"],
    ["drop", "M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"],
    ["flame", "M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-4 2.5-5 .5 2 1.5 3 2.5 3 0-3-1-5 0-8z"],
    ["wifi", "M3 9a13 13 0 0 1 18 0 M6 12.5a8.5 8.5 0 0 1 12 0 M9 16a4 4 0 0 1 6 0" + c(12, 19, 0.9)],
    ["phone", "M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z M11 18h2"],
    ["tv", "M3 6h18v11H3z M8 21h8 M12 17v4"],
    ["cloud", "M7 18a4 4 0 0 1-.5-8 6 6 0 0 1 11.5 1.5A3.5 3.5 0 0 1 17.5 18H7z"],
    ["repeat", "M4 11V9a3 3 0 0 1 3-3h13 M17 3l3 3-3 3 M20 13v2a3 3 0 0 1-3 3H4 M7 21l-3-3 3-3"],
    ["receipt", "M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L6 21V3z M9 8h6 M9 12h6 M9 16h4"],
    ["tool", "M15 4a5 5 0 0 0-5 6.5l-6 6L7.5 20l6-6A5 5 0 0 0 20 9l-3 3-3-1-1-3 3-3z"],
    // getting around
    ["bus", "M5 5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v12H5V5z M5 11h14 M5 17v3 M19 17v3" + c(8.5, 14, 0.8) + c(15.5, 14, 0.8)],
    ["car", "M4 16v-4l2-5h12l2 5v4H4z M4 12h16 M6 16v3 M18 16v3 M6.5 14h1 M16.5 14h1"],
    ["taxi", "M9 4h6v3 M4 16v-4l2-5h12l2 5v4H4z M4 12h16 M6 16v3 M18 16v3"],
    ["fuel", "M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16 M4 21h12 M5 10h10 M15 8l3 3v7a1.5 1.5 0 0 0 3 0V9l-2-2"],
    ["bike", c(6, 16, 3.5) + c(18, 16, 3.5) + " M6 16l3.5-7h6L18 16 M9.5 9L12 16 M14 6h2.5"],
    ["train", "M7 3h10a2 2 0 0 1 2 2v9a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V5a2 2 0 0 1 2-2z M5 10h14 M8 21l2-4 M16 21l-2-4 M8.5 13.5h.01 M15.5 13.5h.01"],
    ["plane", "M10.5 13.5L3 11l1.5-1.5 8 .5 4-4.5a2 2 0 0 1 3 3L15 12.5l.5 8L14 22l-2.5-7.5L8 18v2.5L6.5 22l-1-3.5L2 17.5 3.5 16H6l3.5-3.5"],
    ["parking", "M4 4h16v16H4z M10 17V7h3a3 3 0 0 1 0 6h-3"],
    // health and care
    ["heart", "M12 20s-8-4.5-8-10.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 2.5C20 15.5 12 20 12 20z"],
    ["cross", "M9 3h6v6h6v6h-6v6H9v-6H3V9h6V3z"],
    ["pill", "M10.5 3.5a5 5 0 0 1 7 7l-7 7a5 5 0 0 1-7-7l7-7z M7 7l7 7"],
    ["tooth", "M7 4c2 0 3 1 5 1s3-1 5-1c3 0 4 3 3 6-1 2-1 4-2 7-.5 2-2.5 3-3-1-.3-2-1-3-2-3s-1.7 1-2 3c-.5 4-2.5 3-3 1-1-3-1-5-2-7-1-3 0-6 3-6z"],
    ["dumbbell", "M6 8v8 M3 10v4 M18 8v8 M21 10v4 M6 12h12"],
    ["sparkles", "M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z M18 15l.7 2.3L21 18l-2.3.7L18 21l-.7-2.3L15 18l2.3-.7L18 15z"],
    ["scissors", c(6, 6, 2.5) + c(6, 18, 2.5) + " M8 7.5L20 18 M8 16.5L20 6"],
    // free time
    ["film", "M4 4h16v16H4z M8 4v16 M16 4v16 M4 8h4 M4 12h4 M4 16h4 M16 8h4 M16 12h4 M16 16h4"],
    ["music", "M9 18V5l11-2v13" + c(6.5, 18, 2.5) + c(17.5, 16, 2.5)],
    ["game", "M7 8h10a4 4 0 0 1 4 4v1a3 3 0 0 1-5.4 1.8L14.5 14h-5l-1.1.8A3 3 0 0 1 3 13v-1a4 4 0 0 1 4-4z M7 10.5v3 M5.5 12h3 M16 11h.01 M18 13h.01"],
    ["book", "M4 5a2 2 0 0 1 2-2h13v15H6a2 2 0 0 0-2 2V5z M4 20a2 2 0 0 0 2 1h13v-3"],
    ["ticket", "M3 7a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v3a2 2 0 0 0 0 4v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-3a2 2 0 0 0 0-4V7z M14 6v12"],
    ["sun", c(12, 12, 4) + " M12 2v2 M12 20v2 M2 12h2 M20 12h2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4"],
    ["star", "M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3l-5.5 2.9 1-6.2L3 9.6l6.2-.9L12 3z"],
    ["leaf", "M5 19C5 10 10 5 20 4c-1 10-6 15-15 15z M5 19l8-8"],
    // people
    ["shirt", "M8 3L3 6l2 4 2-1v12h10V9l2 1 2-4-5-3a4 4 0 0 1-8 0z"],
    ["shoe", "M3 17v-6l3-1 3 3 4 1 6 1a2 2 0 0 1 2 2v1H3z M3 17v2h18v-2"],
    ["gift", "M4 9h16v4H4z M5 13h14v8H5z M12 9v12 M12 9C10 9 7 8 7 6a2 2 0 0 1 4-1l1 4 M12 9c2 0 5-1 5-3a2 2 0 0 0-4-1l-1 4"],
    ["baby", c(12, 12, 8) + " M9 11h.01 M15 11h.01 M10 15a3 3 0 0 0 4 0 M12 4c-1 1-1 2.5 0 3"],
    ["person", c(12, 8, 4) + " M4 21a8 8 0 0 1 16 0"],
    ["paw", c(8, 7, 1.5) + c(16, 7, 1.5) + c(5, 12, 1.5) + c(19, 12, 1.5) + " M12 12c-3 0-5 3.5-5 5.5S9 20 12 20s5-.5 5-2.5S15 12 12 12z"],
    ["school", "M2 9l10-5 10 5-10 5L2 9z M6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5 M22 9v6"],
    ["charity", "M3 13h3l4 3h5a1.5 1.5 0 0 1 0 3H8 M6 13v7 M13.5 4.5a2.3 2.3 0 0 1 3.5 0 2.3 2.3 0 0 1 3.5 3c-1 1.5-3.5 3.5-3.5 3.5s-2.5-2-3.5-3.5a2.3 2.3 0 0 1 0-3z"],
    // money and work
    ["briefcase", "M3 8h18v12H3z M8 8V5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v3 M3 13h18"],
    ["laptop", "M5 5h14v10H5z M2 19h20l-2-4H4l-2 4z"],
    ["bank", "M3 9l9-5 9 5 M5 9v9 M10 9v9 M14 9v9 M19 9v9 M3 20h18"],
    ["card", "M3 6h18v12H3z M3 10h18 M7 15h4"],
    ["coins", "M5 7c0-1.1 3.1-2 7-2s7 .9 7 2-3.1 2-7 2-7-.9-7-2z M5 7v5c0 1.1 3.1 2 7 2s7-.9 7-2V7 M5 12v5c0 1.1 3.1 2 7 2s7-.9 7-2v-5"],
    ["piggy", "M5 11a7 6 0 0 1 12-3l3-1-1 3.5a6 6 0 0 1 1 3.5h-2l-1 2.5V19h-3v-1.5h-4V19H7v-2.5A6 6 0 0 1 5 11z M3 10c0 1.5 1 2 2 2 M15 11h.01"],
    ["wallet", "M4 7a2 2 0 0 1 2-2h12v4 M4 7v11a2 2 0 0 0 2 2h14V9H6a2 2 0 0 1-2-2z M16 14.5h.01"],
    ["chart", "M3 17l6-6 4 4 8-8 M15 7h6v6"],
    ["percent", "M19 5L5 19" + c(7, 7, 2.5) + c(17, 17, 2.5)],
    ["shield", "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z"],
    ["umbrella", "M3 12a9 9 0 0 1 18 0H3z M12 12v7a2 2 0 0 1-4 0"],
    ["tag", "M3 12V4h8l9 9-8 8-9-9z" + c(7.5, 8, 1)],
    ["dots", c(6, 12, 1.2) + c(12, 12, 1.2) + c(18, 12, 1.2)]
  ];
  var BY_ID = {};
  ICONS.forEach(function (x) { BY_ID[x[0]] = x[1]; });

  // The icon as SVG markup ("" for an id this set does not have).
  function svg(id) {
    var d = Object.prototype.hasOwnProperty.call(BY_ID, id) ? BY_ID[id] : "";
    if (!d) return "";
    return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" ' +
           'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="' + d + '"/></svg>';
  }

  var api = { ids: ICONS.map(function (x) { return x[0]; }), svg: svg, has: function (id) { return Object.prototype.hasOwnProperty.call(BY_ID, id); } };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosBudgetIcons = api;
})(typeof window !== "undefined" ? window : this);
