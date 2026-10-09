// ============================================================
// orOS Podcasts — net.js (temporary transport shim, v1.0.0)
// Same shape as the shared feeds/fetch.js (window.orosFeedsFetch)
// the Reader thread will split out of feeds/feeds.js; once that
// lands this file goes and podcasts.js uses the shared one.
//   fetchOne(url)       → Promise<{status, url, type, text, via}>
//   fetchFeeds([{url, etag?, lm?}]) → Promise<[{url, status, finalUrl,
//                         type, etag, lm, retry, text, via, err?}]>
//   relayAvailable()    → bool
// Direct GET first (the browser's own cache revalidates it); when
// CORS blocks it, the Mail relay's "web" operation (GET only, public
// hosts, ≤ 10 per call). Audio never goes through here.
// Needs window.orosFeedsCore (decodeBytes, b64ToBytes, normRelayUrl).
// ============================================================
(function (root) {
  "use strict";
  var TIMEOUT = 20000, BATCH = 10;
  var viaRelay = {};      // host → true once CORS blocked it (session only)

  function F() { return root.orosFeedsCore; }
  function relayUrl() {
    try {
      var m = JSON.parse(root.localStorage.getItem("oros-mail-data") || "null");
      var u = m && m.relay && F().normRelayUrl(m.relay.url);
      return u || "";
    } catch (e) { return ""; }
  }
  function hostOf(u) { try { return new URL(u).host; } catch (e) { return ""; } }
  function NetError(code, status) { this.code = code; this.status = status || 0; }

  function direct(url) {
    if (!/^https:/i.test(url) && root.location.protocol === "https:") return Promise.reject(new NetError("cors"));
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, TIMEOUT);
    return fetch(url, { method: "GET", mode: "cors", credentials: "omit", cache: "no-cache",
      redirect: "follow", referrerPolicy: "no-referrer", signal: ctl.signal })
      .then(function (r) {
        return r.arrayBuffer().then(function (buf) {
          clearTimeout(timer);
          return { status: r.status, url: r.url || url, type: r.headers.get("Content-Type") || "",
            etag: "", lm: "", retry: r.headers.get("Retry-After") || "", bytes: new Uint8Array(buf), via: "direct" };
        });
      }, function () {
        clearTimeout(timer);
        throw new NetError(ctl.signal.aborted ? "timeout" : "cors");
      });
  }
  function relay(reqs) {
    var base = relayUrl();
    if (!base) return Promise.reject(new NetError("norelay"));
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, TIMEOUT + 15000);
    return fetch(base + "/v1", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "web", reqs: reqs }), signal: ctl.signal,
      credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer"
    }).then(function (r) { return r.json().catch(function () { return null; }); },
      function () { throw new NetError(ctl.signal.aborted ? "timeout" : "relay"); })
      .then(function (j) {
        clearTimeout(timer);
        if (!j || typeof j !== "object") throw new NetError("relay");
        if (!j.ok) throw new NetError((j.error && j.error.code) || "relay");
        var res = j.data && Array.isArray(j.data.res) ? j.data.res : [];
        return reqs.map(function (q, i) {
          var x = res[i];
          if (!x || typeof x !== "object") return { url: q.url, err: "relay" };
          if (x.err) return { url: q.url, err: String(x.err) };
          return { status: x.status | 0, url: typeof x.url === "string" ? x.url : q.url, type: String(x.type || ""),
            etag: String(x.etag || ""), lm: String(x.lm || ""), retry: String(x.retry || ""),
            bytes: typeof x.body === "string" ? F().b64ToBytes(x.body) : null, via: "relay" };
        });
      }, function (e) { clearTimeout(timer); throw e; });
  }
  function finish(q, r) {
    if (!r || r.err) return { url: q.url, err: (r && r.err) || "network" };
    var out = { url: q.url, status: r.status, finalUrl: r.url, type: r.type, etag: r.etag, lm: r.lm, retry: r.retry, via: r.via, text: "" };
    if (r.status >= 200 && r.status < 300 && r.bytes) out.text = F().decodeBytes(r.bytes, r.type);
    else if (r.status !== 304) out.err = r.status === 404 || r.status === 410 ? "gone" : "http";
    return out;
  }

  function fetchOne(url) {
    if (root.navigator && root.navigator.onLine === false) return Promise.reject(new NetError("offline"));
    var h = hostOf(url);
    var viaR = function () {
      return relay([{ url: url }]).then(function (list) {
        var r = list[0];
        if (r.err) throw new NetError(r.err);
        viaRelay[h] = true;
        return r;
      });
    };
    var p = viaRelay[h] && relayUrl() ? viaR() : direct(url).catch(function (e) { if (e.code !== "cors") throw e; return viaR(); });
    return p.then(function (r) {
      var o = finish({ url: url }, r);
      if (o.err) throw new NetError(o.err, o.status);
      return o;
    });
  }

  // Many feeds: the ones known to need the relay go in batches, the
  // rest try direct first (4 at a time) and fall back in batches.
  function fetchFeeds(list) {
    if (root.navigator && root.navigator.onLine === false) return Promise.resolve(list.map(function (q) { return { url: q.url, err: "offline" }; }));
    var out = new Array(list.length), later = [];
    var idx = 0;
    function worker() {
      if (idx >= list.length) return Promise.resolve();
      var i = idx++, q = list[i];
      if (viaRelay[hostOf(q.url)] && relayUrl()) { later.push(i); return worker(); }
      return direct(q.url).then(function (r) { out[i] = finish(q, r); }, function (e) {
        if (e.code === "cors") { viaRelay[hostOf(q.url)] = true; later.push(i); }
        else out[i] = { url: q.url, err: e.code || "network" };
      }).then(worker);
    }
    return Promise.all([worker(), worker(), worker(), worker()]).then(function () {
      var batches = [];
      for (var b = 0; b < later.length; b += BATCH) batches.push(later.slice(b, b + BATCH));
      return batches.reduce(function (pr, ids) {
        return pr.then(function () {
          var reqs = ids.map(function (i) {
            var q = { url: list[i].url };
            if (list[i].etag) q.etag = list[i].etag;
            if (list[i].lm) q.lm = list[i].lm;
            return q;
          });
          return relay(reqs).then(function (res) {
            ids.forEach(function (i, k) { out[i] = finish(list[i], res[k]); });
          }, function (e) {
            ids.forEach(function (i) { out[i] = { url: list[i].url, err: e.code === "norelay" ? "norelay" : (e.code || "relay") }; });
          });
        });
      }, Promise.resolve());
    }).then(function () { return out; });
  }

  root.orosPodcastsNet = {
    fetchOne: fetchOne,
    fetchFeeds: fetchFeeds,
    relayAvailable: function () { return !!relayUrl(); }
  };
})(window);
