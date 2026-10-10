/* Send to orOS: pure helpers shared by background.js and options.js
   (and tests/extension.test.js through module.exports). The add-on
   keeps no data of its own: it only opens orOS with the page's
   address and title in the URL, and orOS asks before saving. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.OrosExt = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var DEFAULT_BASE = "https://useoros.online/";
  var MAX_URL = 2048, MAX_TITLE = 256, MAX_QUERY = 200;

  /* The orOS address from the options: https anywhere, plain http
     only on this machine (a local copy). Query and fragment drop,
     the path always ends in "/". null = not usable. */
  function normBase(raw) {
    var s = String(raw == null ? "" : raw).trim();
    if (!s) return null;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = "https://" + s;
    var u;
    try { u = new URL(s); } catch (e) { return null; }
    var local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname);
    if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) return null;
    if (u.username || u.password) return null;
    u.search = "";
    u.hash = "";
    if (!/\/$/.test(u.pathname)) u.pathname += "/";
    return u.href;
  }

  /* Only web pages can be bookmarks (no browser pages, files, data:). */
  function isSavable(url) {
    if (typeof url !== "string" || url.length > MAX_URL) return false;
    try {
      var p = new URL(url).protocol;
      return p === "http:" || p === "https:";
    } catch (e) { return false; }
  }

  function clip(s, n) {
    return String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);
  }

  /* orOS reads these in shell.js (shareFromHref) and opens Bookmarks'
     add dialog. */
  function shareUrl(base, url, title) {
    var b = normBase(base) || DEFAULT_BASE;
    return b + "?share-url=" + encodeURIComponent(url) +
      "&share-title=" + encodeURIComponent(clip(title, MAX_TITLE));
  }

  /* Address-bar keyword "oros <words>": the orOS menu opens with the
     words in its search field (shell.js searchFromLaunchParam). */
  function searchUrl(base, query) {
    var b = normBase(base) || DEFAULT_BASE;
    var q = clip(query, MAX_QUERY);
    return q ? b + "?search=" + encodeURIComponent(q) : b;
  }

  return {
    DEFAULT_BASE: DEFAULT_BASE,
    normBase: normBase,
    isSavable: isSavable,
    shareUrl: shareUrl,
    searchUrl: searchUrl
  };
});
