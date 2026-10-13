/* ============================================================
   orOS — Remote link (shared)
   Pairs two devices with a 6-digit code and keeps a link between
   them: a room on the orOS relay (relay/remote.js, /rt/<room>) that
   only passes AES-GCM sealed frames on, then a direct WebRTC data
   channel when one can be set up (same Wi-Fi: a few ms), with the
   room as the fallback path (a VPN, different networks).

   The room id is a hash of the code and the key is derived from it.
   Six digits can be tried one by one, so the host also has to let
   each device in (o.admit) and, once one is in, no other device gets
   in on that code.

   This is Studio Remote's link layer (studio/remote.js, PR #263) as a
   module of its own, so other apps can use it. Each app passes its own
   namespace (o.ns), which keeps rooms and keys of different apps
   apart; with ns "oros-studio-remote" it speaks exactly Studio's
   protocol. Used by Time › Stage (time/stage-link.js).

   window.OrosRemoteLink = { Link, derive, seal, unseal, newCode, wsUrl,
     deviceName, relayUrl, CODE_RE }
   new Link({ role: "host"|"remote", code, relay, ns, dev, label,
     rid (remote: keep the same id after a reload), allow (host: the id
     let in before a reload), admit(dev, answer), onState, onPeer,
     onGone, onDeny, onApp, onAllow(rid) })
   ============================================================ */
(function () {
  "use strict";

  var PROTO = 1;
  var ICE = [{ urls: "stun:stun.cloudflare.com:3478" }];
  var CODE_RE = /^[0-9]{6}$/;
  var RID_RE = /^[0-9a-f]{32}$/;
  var NS_RE = /^[a-z0-9-]{3,40}$/;
  var MAX_MSG = 12000;                 // characters of one app message
  var RELAY = "https://oros-mail-relay.koulaxizis-25b.workers.dev";   // = mail.js

  var PEEK_DIRECT = 66, PEEK_RELAY = 200;   // host: effect interfaces' live data

  // ---------- 1. Codes, keys and frames ----------
  var enc = new TextEncoder(), dec = new TextDecoder();
  function hex(buf) {
    var b = new Uint8Array(buf), s = "";
    for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? "0" : "") + b[i].toString(16);
    return s;
  }
  function b64(u8) {
    var s = "";
    for (var i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function unb64(s) {
    var bin = atob(s), u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }
  function newCode() {
    var a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return String(100000 + a[0] % 900000);
  }
  // The room id and the key both come from the code. The relay only passes
  // sealed frames on, but six digits can be tried one by one: anyone who
  // reads room ids could find the code, and anyone could guess their way
  // into a waiting room. So the encryption keeps out casual eyes, and the
  // PC itself decides who may control it: every new device needs "Allow"
  // on the PC, and once one is allowed no other device gets in on that
  // code (see Link: admit).
  function derive(code, ns) {
    var S = crypto.subtle;
    ns = NS_RE.test(ns || "") ? ns : "oros-studio-remote";
    return Promise.all([
      S.digest("SHA-256", enc.encode(ns + "/room/" + code)),
      S.importKey("raw", enc.encode(code), "PBKDF2", false, ["deriveKey"]).then(function (base) {
        return S.deriveKey({ name: "PBKDF2", salt: enc.encode(ns + "/key/v1"), iterations: 100000, hash: "SHA-256" },
          base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
      })
    ]).then(function (r) { return { room: hex(r[0]), key: r[1] }; });
  }
  function seal(key, obj) {
    var iv = crypto.getRandomValues(new Uint8Array(12));
    return crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, enc.encode(JSON.stringify(obj))).then(function (ct) {
      var out = new Uint8Array(12 + ct.byteLength);
      out.set(iv, 0); out.set(new Uint8Array(ct), 12);
      return b64(out);
    });
  }
  function unseal(key, text) {
    try {
      var u8 = unb64(text);
      if (u8.length < 29) return Promise.resolve(null);
      return crypto.subtle.decrypt({ name: "AES-GCM", iv: u8.subarray(0, 12) }, key, u8.subarray(12)).then(function (pt) {
        return JSON.parse(dec.decode(pt));
      }, function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }
  function wsUrl(relay, room) { return relay.replace(/^http(s?):/, "ws$1:").replace(/\/+$/, "") + "/rt/" + room; }

  // ---------- 2. Link: relay room + direct channel ----------
  // states: "connecting" (no room yet), "waiting" (alone in the room),
  // "relay" (peer there, talking through the relay), "direct" (data
  // channel open), "closed" (ended here).
  function Link(o) {
    var self = this;
    this.role = o.role;
    this.state = "connecting";
    var keys = null, ws = null, pc = null, dc = null, closed = false;
    var peer = false, lastHeard = 0, lastDirect = 0, retry = 0, retryTimer = 0, pingTimer = 0, rtcTimer = 0;
    var sendQ = Promise.resolve();
    // Who is on the other end: the remote picks a random id per pairing;
    // the host lets in only the id it was told to allow (o.admit).
    var rid = self.role !== "remote" ? "" : RID_RE.test(o.rid || "") ? o.rid : hex(crypto.getRandomValues(new Uint8Array(16)));
    var okRid = self.role === "host" && RID_RE.test(o.allow || "") ? o.allow : "", asking = "";

    function setState(s) {
      if (self.state === s) return;
      self.state = s;
      if (o.onState) o.onState(s);
    }
    function frame(obj) {
      if (!ws || ws.readyState !== 1 || !keys) return;
      var w = ws;
      sendQ = sendQ.then(function () { return seal(keys.key, obj); }).then(function (txt) {
        if (w.readyState === 1) w.send(txt);
      }, function () {});
    }
    function heard(direct) {
      lastHeard = Date.now();
      if (direct) lastDirect = lastHeard;
    }
    function onFrame(m, direct) {
      if (!m || typeof m !== "object") return;
      heard(direct);
      if (m.k === "hello") {
        if (m.v !== PROTO || (m.role !== "host" && m.role !== "remote") || m.role === self.role) return;
        if (self.role === "host") {
          var r = typeof m.rid === "string" && /^[0-9a-f]{32}$/.test(m.rid) ? m.rid : "";
          if (!r) return;
          if (okRid && r !== okRid) { frame({ k: "deny" }); return; }   // already paired with another device
          if (!okRid) {
            if (asking === r) return;
            asking = r;
            var dev = String(m.dev || "").slice(0, 60);
            var answer = function (yes) {
              if (closed || asking !== r) return;
              asking = "";
              if (!yes) { frame({ k: "deny" }); return; }
              okRid = r;
              if (o.onAllow) o.onAllow(r);
              onFrame(m, direct);
            };
            if (o.admit) o.admit(dev, answer); else answer(false);
            return;
          }
        }
        var first = !peer;
        peer = true;
        if (self.state !== "direct") setState("relay");
        if (first) frame({ k: "hello", role: self.role, v: PROTO, rid: rid });
        if (self.role === "host" && (!dc || dc.readyState !== "open")) startRtc();
        if (o.onPeer) o.onPeer(String(m.dev || "").slice(0, 60));
      } else if (m.k === "bye") {
        if (peer) peerGone();
      } else if (m.k === "deny") {
        if (self.role === "remote" && !peer && o.onDeny) o.onDeny();
      } else if (!peer) {
        return;                                          // nothing else before the hello is accepted
      } else if (m.k === "sdp" && m.d && typeof m.d.sdp === "string") onSdp(m.d);
      else if (m.k === "ice" && m.d) { if (pc) pc.addIceCandidate(m.d).catch(function () {}); }
      else if (m.k === "app" && m.d && typeof m.d === "object") { if (o.onApp) o.onApp(m.d); }
    }

    function openWs() {
      if (closed) return;
      clearTimeout(retryTimer);
      try { ws = new WebSocket(wsUrl(o.relay, keys.room)); }
      catch (e) { again(); return; }
      var me = ws;
      ws.onopen = function () { retry = 0; };
      ws.onmessage = function (e) {
        if (me !== ws || typeof e.data !== "string" || e.data === "pong") return;
        if (e.data.charAt(0) === "{") {                  // the relay's own notes
          var s = null;
          try { s = JSON.parse(e.data); } catch (err) { return; }
          if (s.sys === "wait") { if (self.state !== "direct") { peer = false; setState("waiting"); } }
          else if (s.sys === "peer" && self.role === "remote") {
            // the remote knocks; the host answers only once it is allowed in
            if (self.state !== "direct") setState("pending");
            frame({ k: "hello", role: self.role, v: PROTO, dev: o.dev || "", rid: rid });
          }
          else if (s.sys === "left") peerGone();
          return;
        }
        unseal(keys.key, e.data).then(function (m) { onFrame(m, false); });
      };
      ws.onclose = function () {
        if (me !== ws) return;
        ws = null;
        if (closed) return;
        if (self.state !== "direct") setState("connecting");
        again();
      };
      ws.onerror = function () {};
    }
    function again() {
      if (closed) return;
      retry = Math.min(retry + 1, 5);
      retryTimer = setTimeout(openWs, [0, 1000, 2000, 4000, 8000, 15000][retry]);
    }
    function peerGone() {
      peer = false;
      asking = "";
      dropRtc();
      if (!closed) setState("waiting");
      if (o.onGone) o.onGone();
    }

    // WebRTC: the host offers, the remote answers; candidates go
    // through the room. No TURN: when it cannot connect, the room carries on.
    function startRtc() {
      if (typeof RTCPeerConnection !== "function" || pc) return;
      pc = newPc();
      dc = pc.createDataChannel(o.label || "studio", { ordered: true });
      wireDc();
      pc.createOffer().then(function (d) { return pc.setLocalDescription(d); }).then(function () {
        frame({ k: "sdp", d: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
      }).catch(dropRtc);
      clearTimeout(rtcTimer);
      rtcTimer = setTimeout(function () { if (!dc || dc.readyState !== "open") dropRtc(); }, 10000);
    }
    function newPc() {
      var p = new RTCPeerConnection({ iceServers: ICE });
      p.onicecandidate = function (e) { if (e.candidate) frame({ k: "ice", d: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate }); };
      p.onconnectionstatechange = function () { if (p === pc && (p.connectionState === "failed" || p.connectionState === "closed")) dropRtc(); };
      return p;
    }
    function onSdp(d) {
      if (typeof RTCPeerConnection !== "function") return;
      if (d.type === "offer" && self.role === "remote") {
        dropRtc();
        pc = newPc();
        pc.ondatachannel = function (e) { dc = e.channel; wireDc(); };
        pc.setRemoteDescription(d).then(function () { return pc.createAnswer(); })
          .then(function (a) { return pc.setLocalDescription(a); })
          .then(function () { frame({ k: "sdp", d: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } }); })
          .catch(dropRtc);
      } else if (d.type === "answer" && self.role === "host" && pc) {
        pc.setRemoteDescription(d).catch(dropRtc);
      }
    }
    function wireDc() {
      var my = dc;
      dc.onopen = function () { if (my === dc) { heard(true); setState("direct"); } };
      dc.onclose = function () { if (my === dc) dropRtc(); };
      dc.onmessage = function (e) {
        if (my !== dc || typeof e.data !== "string" || e.data.length > MAX_MSG * 2) return;
        var m = null;
        try { m = JSON.parse(e.data); } catch (err) { return; }
        onFrame(m, true);
      };
    }
    function dropRtc() {
      clearTimeout(rtcTimer);
      var p = pc, d = dc;
      pc = null; dc = null;
      try { if (d) d.close(); } catch (e) {}
      try { if (p) p.close(); } catch (e) {}
      if (closed) return;
      if (self.state === "direct") setState(peer && ws ? "relay" : ws ? "waiting" : "connecting");
      // the host tries a direct link again after a while
      if (self.role === "host" && peer) rtcTimer = setTimeout(function () { if (peer && !pc) startRtc(); }, 15000);
    }

    // Keep-alive: a ping on the direct channel every 2 s (a silent one is
    // dropped after 7 s) and through the room every 20 s (keeps it open).
    // While direct, the room ping is a bare "ping" the relay answers by
    // itself (it does not wake the room); otherwise it is a sealed frame,
    // so the other side knows we are still there.
    var tick = 0;
    function ping() {
      tick++;
      var now = Date.now();
      if (dc && dc.readyState === "open") {
        try { dc.send('{"k":"ping"}'); } catch (e) {}
        if (now - lastDirect > 7000) dropRtc();
      }
      if (tick % 10 === 0) {
        if (dc && dc.readyState === "open") { try { if (ws && ws.readyState === 1) ws.send("ping"); } catch (e) {} }
        else frame({ k: "ping" });
      }
      if (peer && now - lastHeard > 50000) peerGone();
    }

    this.send = function (obj) {
      var m = { k: "app", d: obj };
      if (dc && dc.readyState === "open") {
        try { dc.send(JSON.stringify(m)); return true; } catch (e) {}
      }
      if (!peer) return false;
      frame(m);
      return true;
    };
    // Ending here tells the other side at once (a closing data channel or
    // socket can take a while to be noticed there).
    this.close = function () {
      if (peer) {
        try { if (dc && dc.readyState === "open") dc.send('{"k":"bye"}'); } catch (e) {}
        frame({ k: "bye" });
      }
      closed = true;
      clearTimeout(retryTimer); clearInterval(pingTimer); clearTimeout(rtcTimer);
      dropRtc();
      var w = ws; ws = null;
      sendQ.then(function () { try { if (w) w.close(1000, "bye"); } catch (e) {} });
      setState("closed");
    };
    this.direct = function () { return !!(dc && dc.readyState === "open"); };
    this.peer = function () { return peer; };
    this.rid = function () { return rid; };

    derive(o.code, o.ns).then(function (k) {
      if (closed) return;
      keys = k;
      openWs();
      pingTimer = setInterval(ping, 2000);
    }, function () { setState("closed"); if (o.onState) o.onState("nocrypto"); });
  }


  function deviceName() {
    var ua = navigator.userAgent || "";
    if (/iPad|Tablet|SM-T|Tab/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return "tablet";
    if (/Mobi|iPhone|Android/i.test(ua)) return "phone";
    return "computer";
  }
  // The relay Mail is set up with (a self-hosted one), else orOS's own.
  function relayUrl() {
    try {
      var m = JSON.parse(localStorage.getItem("oros-mail-data") || "null");
      var u = m && m.relay && m.relay.url;
      if (typeof u === "string" && /^https:\/\/[^\s/]+/.test(u)) return u;
    } catch (e) {}
    return RELAY;
  }

  window.OrosRemoteLink = {
    Link: Link, derive: derive, seal: seal, unseal: unseal, newCode: newCode, wsUrl: wsUrl,
    deviceName: deviceName, relayUrl: relayUrl, CODE_RE: CODE_RE, MAX_MSG: MAX_MSG, PROTO: PROTO
  };
})();
