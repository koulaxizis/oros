// orOS Feeds — one-time import of YouTube subscriptions (feeds/youtube.js)
//
// The sign-in, the token and its revoke are /google-import.js's
// (window.OrosGoogleImport, scope youtube.readonly, GET only); this
// file reads the subscriptions and maps them. Each subscribed channel
// becomes the channel's own public feed,
//   https://www.youtube.com/feeds/videos.xml?channel_id=<id>
// titled with the channel's name: from then on the feed is read like
// any other, with no Google account involved. feeds.js adds them the
// way an OPML import does (same ids from the address, so a channel
// already followed is skipped), with a preview and Undo.
// Pure (tests/google-import.test.js): channels(items) → [{ id, url, title, site }]
// Browser: read(api, progress) → the same list (api from OrosGoogleImport.run)
(function (root) {
  "use strict";

  var API = "https://www.googleapis.com/youtube/v3/subscriptions";
  var MAX = 2000;
  var CH_RE = /^UC[A-Za-z0-9_-]{10,40}$/;

  function oneLine(s, n) {
    return (typeof s === "string" ? s : "").replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
  }
  function feedUrl(id) { return "https://www.youtube.com/feeds/videos.xml?channel_id=" + id; }

  // subscriptions.list items → channels, once each, in the order given.
  function channels(items, seen) {
    var out = [];
    seen = seen || {};
    (Array.isArray(items) ? items : []).forEach(function (x) {
      var sn = x && x.snippet, rid = sn && sn.resourceId;
      var id = rid && (rid.kind === "youtube#channel" || !rid.kind) ? rid.channelId : "";
      if (typeof id !== "string" || !CH_RE.test(id) || seen[id]) return;
      seen[id] = 1;
      out.push({ id: id, url: feedUrl(id), title: oneLine(sn.title, 200) || id, site: "https://www.youtube.com/channel/" + id });
    });
    return out;
  }

  function read(api, progress) {
    var out = [], seen = {};
    return api.pages(function (cur) {
      return API + "?part=snippet&mine=true&maxResults=50&order=alphabetical" + (cur ? "&pageToken=" + encodeURIComponent(cur) : "");
    }, function (d) {
      channels(d && d.items, seen).forEach(function (c) { if (out.length < MAX) out.push(c); });
      if (progress) progress(out.length);
      return out.length < MAX ? api.nextToken(d) : "";
    }, 60).then(function () { return out; });
  }

  var api = { channels: channels, read: read, feedUrl: feedUrl, MAX: MAX };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.OrosFeedsYoutube = api;
})(typeof window !== "undefined" ? window : null);
