// ============================================================
// orOS Reader — network layer (shared, read-only for other apps)
// Every GET a feed app needs: straight from the browser first; when
// the site sends no CORS headers, through the Mail relay's "web" op
// (relay/web.js), up to 10 addresses per call.
// Used by the Reader (feeds.js) and the Podcasts app. Other apps load
// this file by path and never edit it; changes go through the Reader.
//
// window.orosFeedsFetch (module.exports in Node):
//   relayUrl(opts)          -> "" | normalised relay address
//   relayAvailable(opts)    -> bool
//   direct(url, opts)       -> Promise<{status, url, type, etag, lm, bytes}>
//                              rejects FetchError("cors" | "timeout")
//   relay(reqs, opts)       -> Promise<[{status, url, type, etag, lm, retry, bytes} | {err}]>
//                              rejects FetchError("norelay" | "relay" | "timeout" | <relay code>)
//   fetchOne(url, opts)     -> Promise<{status, url, finalUrl, type, etag, lm, bytes, text, via}>
//                              rejects FetchError("offline" | "cors" | "norelay" | ...)
//   fetchFeeds(reqs, opts)  -> Promise<[{url, status, finalUrl, type, etag, lm, retry, bytes, via} | {url, err, via}]>
//                              never rejects; one answer per request, same order
// opts: { relay: string | function () -> string   (default: Mail's relay),
//         accept: string, timeout: ms, via: "direct" | "relay" (per request in fetchFeeds) }
// via is "direct" or "relay".
// ============================================================
(function (root) {
  "use strict";

  var C = root.orosFeedsCore || (typeof require === "function" ? require("./core.js") : null);
  var TIMEOUT = 20000;        // ms per direct GET
  var RELAY_EXTRA = 15000;    // a relay call carries up to 10 GETs
  var BATCH = 10;             // relay/web.js WEB_LIMITS.reqs
  var PARALLEL = 4;           // direct GETs at once

  function FetchError(code, extra) { this.code = code; this.extra = extra || ""; }
  FetchError.prototype.toString = function () { return "FetchError: " + this.code; };

  function mailRelay() {
    try {
      var m = JSON.parse(root.localStorage.getItem("oros-mail-data") || "null");
      return (m && m.relay && C.normRelayUrl(m.relay.url)) || "";
    } catch (e) { return ""; }
  }
  function relayUrl(opts) {
    var r = opts && opts.relay;
    if (typeof r === "function") r = r();
    return (r && C.normRelayUrl(r)) || mailRelay();
  }
  function relayAvailable(opts) { return !!relayUrl(opts); }
  function online() { return !root.navigator || root.navigator.onLine !== false; }

  // One GET straight from the browser. CORS or mixed content -> "cors".
  function direct(url, opts) {
    opts = opts || {};
    var page = root.location && root.location.protocol;
    if (!/^https:/i.test(url) && page === "https:") return Promise.reject(new FetchError("cors"));
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, opts.timeout || TIMEOUT);
    var init = { method: "GET", mode: "cors", credentials: "omit", cache: "no-cache",
                 redirect: "follow", referrerPolicy: "no-referrer", signal: ctl.signal };
    if (opts.accept) init.headers = { Accept: opts.accept };
    return fetch(url, init).then(function (r) {
      var head = { status: r.status, url: r.url || url, type: r.headers.get("Content-Type") || "",
                   etag: r.headers.get("ETag") || "", lm: r.headers.get("Last-Modified") || "", bytes: null };
      if (!r.ok) { clearTimeout(timer); return head; }
      return r.arrayBuffer().then(function (buf) {
        clearTimeout(timer);
        head.bytes = new Uint8Array(buf);
        return head;
      });
    }, function () {
      clearTimeout(timer);
      throw new FetchError(ctl.signal.aborted ? "timeout" : "cors");
    });
  }

  // Up to BATCH GETs through the relay, one call.
  function relay(reqs, opts) {
    opts = opts || {};
    var url = relayUrl(opts);
    if (!url) return Promise.reject(new FetchError("norelay"));
    if (!reqs.length) return Promise.resolve([]);
    if (reqs.length > BATCH) return Promise.reject(new FetchError("relay", "batch"));
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, (opts.timeout || TIMEOUT) + RELAY_EXTRA);
    var send = reqs.map(function (q) {
      var o = { url: q.url };
      if (q.etag) o.etag = q.etag;
      if (q.lm) o.lm = q.lm;
      return o;
    });
    return fetch(url + "/v1", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "web", reqs: send }), signal: ctl.signal,
      credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer"
    }).then(function (r) {
      return r.json().catch(function () { return null; });
    }, function () {
      throw new FetchError(ctl.signal.aborted ? "timeout" : "relay");
    }).then(function (j) {
      clearTimeout(timer);
      if (!j || typeof j !== "object") throw new FetchError("relay");
      if (!j.ok) throw new FetchError((j.error && j.error.code) || "relay");
      var res = j.data && Array.isArray(j.data.res) ? j.data.res : [];
      return reqs.map(function (q, i) {
        var x = res[i];
        if (!x || typeof x !== "object") return { err: "relay" };
        if (x.err) return { err: String(x.err) };
        return { status: x.status | 0, url: typeof x.url === "string" ? x.url : q.url, type: String(x.type || ""),
                 etag: String(x.etag || ""), lm: String(x.lm || ""), retry: String(x.retry || ""),
                 bytes: typeof x.body === "string" ? C.b64ToBytes(x.body) : null };
      });
    }, function (e) { clearTimeout(timer); throw e; });
  }

  // One GET (a page, a search answer): direct first, then the relay.
  // Any HTTP status resolves; text is decoded when there is a body.
  function fetchOne(url, opts) {
    opts = opts || {};
    if (!online()) return Promise.reject(new FetchError("offline"));
    var first = opts.via === "relay" ? Promise.reject(new FetchError("cors")) : direct(url, opts);
    return first.then(function (r) { r.via = "direct"; return r; }, function (e) {
      if (e.code !== "cors") throw e;
      return relay([{ url: url }], opts).then(function (list) {
        var r = list[0];
        if (r.err) throw new FetchError(r.err);
        r.via = "relay";
        return r;
      });
    }).then(function (r) {
      r.finalUrl = r.url;
      r.text = r.bytes ? C.decodeBytes(r.bytes, r.type) : "";
      return r;
    });
  }

  // Many feeds: direct in parallel, the CORS-blocked ones (and those
  // asked with via "relay") through the relay in batches.
  function fetchFeeds(reqs, opts) {
    opts = opts || {};
    var out = new Array(reqs.length), toDirect = [], toRelay = [];
    function answer(i, r, via) {
      var q = reqs[i];
      out[i] = r.err ? { url: q.url, err: r.err, via: via }
        : { url: q.url, status: r.status, finalUrl: r.url, type: r.type, etag: r.etag || "", lm: r.lm || "",
            retry: r.retry || "", bytes: r.bytes, via: via };
    }
    if (!online()) { reqs.forEach(function (q, i) { answer(i, { err: "offline" }, "direct"); }); return Promise.resolve(out); }
    reqs.forEach(function (q, i) { (q.via === "relay" ? toRelay : toDirect).push(i); });
    var qi = 0;
    function worker() {
      if (qi >= toDirect.length) return Promise.resolve();
      var i = toDirect[qi++];
      return direct(reqs[i].url, opts).then(function (r) { answer(i, r, "direct"); }, function (e) {
        if (e.code === "cors") toRelay.push(i);
        else answer(i, { err: e.code }, "direct");
      }).then(worker);
    }
    var ws = [];
    for (var k = 0; k < PARALLEL; k++) ws.push(worker());
    return Promise.all(ws).then(function () {
      toRelay.sort(function (a, b) { return a - b; });
      var chunks = [];
      for (var j = 0; j < toRelay.length; j += BATCH) chunks.push(toRelay.slice(j, j + BATCH));
      return chunks.reduce(function (p, chunk) {
        return p.then(function () {
          return relay(chunk.map(function (i) { return reqs[i]; }), opts).then(function (res) {
            chunk.forEach(function (i, n) { answer(i, res[n], "relay"); });
          }, function (e) {
            chunk.forEach(function (i) { answer(i, { err: e.code || "relay" }, "relay"); });
          });
        });
      }, Promise.resolve());
    }).then(function () { return out; });
  }

  var api = { FetchError: FetchError, BATCH: BATCH, relayUrl: relayUrl, relayAvailable: relayAvailable,
              direct: direct, relay: relay, fetchOne: fetchOne, fetchFeeds: fetchFeeds };
  root.orosFeedsFetch = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
