/* ============================================================
   orOS Studio — Remote
   A tablet or phone controls the console of Studio on a PC.

   The PC (host) shows a 6-digit code and a QR code; the tablet
   (remote) joins with it. Both meet in a room on the orOS relay
   (relay/remote.js): the room id is a hash of the code and every frame
   is AES-GCM encrypted with a key derived from the code (six digits
   can be tried one by one, so the PC also has to Allow each device,
   see derive and Link). Through the room they set up a WebRTC data
   channel and talk directly (same Wi-Fi: a few ms). When a direct link
   is not possible (a VPN, different networks) the room itself carries
   the messages.

   The PC stays the place where things happen: every move from the
   tablet becomes a normal Studio edit there (undo, save, sync). The
   tablet keeps no project data; it draws what the PC sends.

   Sections:
     1. Codes, keys and frames
     2. Link: relay room + direct channel
     3. Host (PC): pairing dialog, commands, state and meters
     4. Remote (tablet / phone): join dialog and the console
     5. Remote: the Effects window of a track (phase 2)
     6. Remote for orOS Studio (STUDIO-RA): the remote on its own
        (studio/remote/, the Android app), QR scan, screen kept on,
        haptics, rejoin without a new Allow

   Remote mode: studio/index.html?remote (framed by studio/remote/)
   boots only the join screen and the console (studio.js bootRemote):
   no project, no sync, nothing stored but the last code (RA_KEY).
   ============================================================ */
(function () {
  "use strict";

  var PROTO = 1;
  var ICE = [{ urls: "stun:stun.cloudflare.com:3478" }];
  var CODE_RE = /^[0-9]{6}$/;
  var ID_RE = /^t[a-z0-9]{6,20}$/;
  var FXU_RE = /^f[a-z0-9]{6,20}$/;
  var MAX_MSG = 12000;                 // characters of one app message
  var STATE_MS = 80;                   // host: state pushes are batched
  var METER_MS = 66;                   // host: meters while playing (~15/s)
  var SEND_MS = 33;                    // remote: fader moves (~30/s)
  var HOLD_MS = 600;                   // remote: a fader just moved ignores echoes this long
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
  function derive(code) {
    var S = crypto.subtle;
    return Promise.all([
      S.digest("SHA-256", enc.encode("oros-studio-remote/room/" + code)),
      S.importKey("raw", enc.encode(code), "PBKDF2", false, ["deriveKey"]).then(function (base) {
        return S.deriveKey({ name: "PBKDF2", salt: enc.encode("oros-studio-remote/key/v1"), iterations: 100000, hash: "SHA-256" },
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
    // A remote that was allowed before brings the same id back (o.rid),
    // so the PC lets it in again without asking (STUDIO-RA rejoin).
    var rid = self.role !== "remote" ? "" : typeof o.rid === "string" && /^[0-9a-f]{32}$/.test(o.rid) ? o.rid
      : hex(crypto.getRandomValues(new Uint8Array(16)));
    this.rid = rid;
    var okRid = "", asking = "";

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
      dc = pc.createDataChannel("studio", { ordered: true });
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
    // Back from the background (a phone app): try the room at once
    // instead of waiting for the next retry.
    this.kick = function () {
      if (closed || !keys) return;
      if (!ws) { retry = 0; openWs(); }
      else if (ws.readyState === 1) frame({ k: "ping" });
    };
    this.peer = function () { return peer; };

    derive(o.code).then(function (k) {
      if (closed) return;
      keys = k;
      openWs();
      pingTimer = setInterval(ping, 2000);
    }, function () { setState("closed"); if (o.onState) o.onState("nocrypto"); });
  }

  // ---------- helpers shared by both sides ----------
  function num(v, lo, hi) { return typeof v === "number" && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : null; }
  function deviceName() {
    var ua = navigator.userAgent || "";
    if (/iPad|Tablet|SM-T|Tab/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return "tablet";
    if (/Mobi|iPhone|Android/i.test(ua)) return "phone";
    return "computer";
  }

  window.StudioRemote = function (host) {
    var C = host.C, t = host.t, el = host.el, setLabel = host.setLabel, $ = function (id) { return document.getElementById(id); };

    function relayUrl() {
      try {
        var m = JSON.parse(localStorage.getItem("oros-mail-data") || "null");
        var u = m && m.relay && m.relay.url;
        if (typeof u === "string" && /^https:\/\/[^\s/]+/.test(u)) return u;
      } catch (e) {}
      return host.relay;
    }
    function stateText(s, role) {
      if (s === "direct") return t("rm.direct");
      if (s === "relay") return t("rm.relay");
      if (s === "waiting") return role === "host" ? t("rm.waitRemote") : t("rm.waitHost");
      if (s === "pending") return t("rm.waitOk");
      if (s === "closed") return t("rm.closed");
      return t("rm.connecting");
    }

    // ---------- 3. Host (PC) ----------
    var H = { link: null, code: "", dev: "", stTimer: 0, mTimer: 0, lastSt: "", held: {} };

    function hostStart() {
      hostStop(true);
      H.code = newCode();
      host.wakeAudio();                       // the click is the gesture the audio needs later
      H.link = new Link({
        role: "host", code: H.code, relay: relayUrl(), dev: deviceName(),
        onState: function (s) { if (s !== "direct" && s !== "relay") releaseNotes(); renderHost(); if (s === "direct" || s === "relay") pushState(true); syncMeters(); syncPeek(); },
        onPeer: function (dev) {
          H.dev = dev;
          host.showToast(t("rm.joined", { dev: t("rm.dev." + (dev === "phone" || dev === "tablet" ? dev : "computer")) }));
          pushState(true);
        },
        onGone: function () { releaseNotes(); HF.key = ""; HF.watch = []; renderHost(); syncMeters(); syncPeek(); },
        admit: askAllow,
        onApp: onCommand
      });
      renderHost();
    }
    // A device found the room: only the person at the PC lets it in.
    function askAllow(dev, answer) {
      var name = t("rm.dev." + (dev === "phone" || dev === "tablet" ? dev : "computer"));
      if (H.answer) H.answer(false);
      H.answer = function (yes) { H.answer = null; $("rm-ask").hidden = true; answer(yes); renderHost(); };
      $("rm-ask-text").textContent = t("rm.ask", { dev: name });
      $("rm-ask").hidden = false;
      if (!$("remote-dlg").open) host.showDlg("remote-dlg");
      renderHost();
      try { $("rm-allow").focus(); } catch (e) {}
    }
    function hostStop(quiet) {
      releaseNotes();
      if (H.answer) H.answer(false);
      if (H.link) H.link.close();
      H.link = null; H.code = ""; H.dev = "";
      clearTimeout(H.stTimer); clearInterval(H.mTimer); H.mTimer = 0;
      clearInterval(HF.timer); HF.timer = 0; HF.key = ""; HF.watch = [];
      if (!quiet) renderHost();
    }
    // notes the tablet's pads hold: let go when the tablet goes, so nothing hangs
    function releaseNotes() {
      var held = H.held;
      H.held = {};
      Object.keys(held).forEach(function (k) { var p = k.split(":"); if (host.note) host.note(p[0], +p[1], 0); });
    }
    function hostLive() { return !!(H.link && (H.link.state === "relay" || H.link.state === "direct")); }
    function openHost() {
      if (!H.link) hostStart();
      host.showDlg("remote-dlg");
      renderHost();                           // after showing: it only fills an open dialog
    }
    function renderHost() {
      var ind = $("remote-ind");
      if (ind) {
        ind.hidden = !H.link;
        ind.classList.toggle("on", hostLive());
        setLabel(ind, t("rm.title") + ": " + (H.link ? stateText(H.link.state, "host") : ""));
      }
      if (!$("remote-dlg") || !$("remote-dlg").open) return;
      var on = !!H.link;
      $("rm-code").textContent = on ? H.code.slice(0, 3) + " " + H.code.slice(3) : "";
      $("rm-status").textContent = on ? stateText(H.link.state, "host") : t("rm.off");
      $("rm-new").hidden = !on || hostLive();
      $("rm-stop").hidden = !on;
      $("rm-start").hidden = on;
      $("rm-pair").hidden = !on || hostLive();
      drawQr(on ? joinUrl(H.code) : "");
    }
    // The QR opens Remote for orOS Studio (studio/remote/): the Android
    // app when it is installed, else the same page in the browser.
    function joinUrl(code) {
      return new URL("remote/#studio-remote=" + code, location.href).href;
    }
    function drawQr(text) {
      var cv = $("rm-qr");
      if (!cv) return;
      var g = cv.getContext && cv.getContext("2d");
      if (!g) return;
      var Q = window.orosQR, mods = null;
      if (text && Q) { try { mods = Q.encode(text, { ecl: "M" }).modules; } catch (e) { mods = null; } }
      cv.hidden = !mods;
      $("rm-url").textContent = text;
      if (!mods) return;
      var n = mods.length, q = 4, px = Math.max(2, Math.floor(232 / (n + 2 * q)));
      cv.width = cv.height = px * (n + 2 * q);
      g.fillStyle = "#ffffff"; g.fillRect(0, 0, cv.width, cv.height);
      g.fillStyle = "#000000";
      for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) if (mods[y][x]) g.fillRect((x + q) * px, (y + q) * px, px, px);
    }

    // What the tablet sees: the project's console, nothing else.
    function snapshot() {
      var s = host.snapshot();
      if (!s) return { t: "st", v: PROTO, none: true };
      return {
        t: "st", v: PROTO, name: s.name, bpm: s.bpm, sig: s.sig, vol: s.vol, loop: s.loop, metro: s.metro,
        playing: s.playing, rec: s.rec, pos: Math.round(s.pos * 1000) / 1000, len: Math.round(s.len * 1000) / 1000,
        min: C.VOL_MIN, max: C.VOL_MAX, mfx: s.mfx, fxr: 1, nt: host.note ? 1 : 0,
        tracks: s.tracks.map(function (tr) {
          return { id: tr.id, name: tr.name, color: tr.color, vol: tr.vol, pan: tr.pan, mute: tr.mute, solo: tr.solo, arm: tr.arm, fx: tr.fx, ins: tr.ins };
        })
      };
    }
    function pushState(now) {
      if (!hostLive()) return;
      clearTimeout(H.stTimer);
      H.stTimer = setTimeout(function () {
        if (!hostLive()) return;
        var st = snapshot(), txt = JSON.stringify(st);
        pushChain(now);
        if (txt === H.lastSt && !now) return;
        H.lastSt = txt;
        H.link.send(st);
      }, now ? 0 : STATE_MS);
    }

    // The chain whose Effects window is open on the tablet: every slider
    // value, sent again whenever it changes. File sliders show the file's
    // name only.
    var HF = { key: "", watch: [], last: "", timer: 0, busy: {}, tick: 0 };
    function chainMsg() {
      var key = HF.key, FXA = host.fx;
      if (!key || !FXA) return null;
      if (key !== "master" && !C.find(host.data(), "tracks", key)) return { t: "fc", key: key, gone: true };
      return {
        t: "fc", key: key, sr: host.srate(),
        items: FXA.chainOf(key).map(function (x) {
          var o = { u: x.u, id: x.id, on: !!x.on, s: {} };
          Object.keys(x.s || {}).forEach(function (k) { if (typeof x.s[k] === "number" && isFinite(x.s[k])) o.s[k] = x.s[k]; });
          if (x.f) { o.f = {}; Object.keys(x.f).forEach(function (k) { o.f[k] = String(x.f[k]).replace(/^.*\//, "").slice(0, 80); }); }
          return o;
        })
      };
    }
    function pushChain(now) {
      var m = hostLive() ? chainMsg() : null;
      if (!m) return;
      var txt = JSON.stringify(m);
      if (txt === HF.last && !now) return;
      HF.last = txt;
      H.link.send(m);
    }
    // While playing, the interfaces open on the tablet get what the
    // effect's @gfx shows (a few numbers; Spread also a scope buffer).
    function syncPeek() {
      var want = hostLive() && HF.key && HF.watch.length && host.isPlaying();
      var ms = H.link && H.link.direct() ? PEEK_DIRECT : PEEK_RELAY;
      if (HF.timer && (!want || HF.ms !== ms)) { clearInterval(HF.timer); HF.timer = 0; }
      if (want && !HF.timer) { HF.ms = ms; HF.timer = setInterval(sendPeek, ms); }
    }
    function sendPeek() {
      if (!hostLive() || !HF.key) return;
      var key = HF.key;
      HF.watch.forEach(function (u) {
        if (HF.busy[u]) return;
        HF.busy[u] = true;
        host.fx.peek(key, u).then(function (m) {
          HF.busy[u] = false;
          if (!m || !hostLive() || HF.key !== key) return;
          var out = { t: "fl", u: u, l: Array.prototype.map.call(m.live || [], function (v) { return isFinite(v) ? Math.round(v * 1e5) / 1e5 : 0; }) };
          if (m.mem && m.mem.data && m.mem.data.length <= 8192) {
            // a scope: one byte per sample is plenty for drawing it
            var d = m.mem.data, q = new Int8Array(d.length);
            for (var i = 0; i < d.length; i++) q[i] = Math.max(-127, Math.min(127, Math.round((d[i] || 0) * 127)));
            out.m = { b: m.mem.base, d: b64(new Uint8Array(q.buffer)) };
          }
          H.link.send(out);
        }, function () { HF.busy[u] = false; });
      });
    }
    function setWatch(key) {
      HF.key = key; HF.watch = []; HF.last = ""; HF.busy = {};
      if (key) pushChain(true);
      syncPeek();
    }
    // A slider from the tablet: it must exist, is clamped to its range
    // and, for a list, rounded to one of its choices.
    function fxSlider(key, u, i, v) {
      var FXA = host.fx, x = FXA.chainOf(key).filter(function (it) { return it.u === u; })[0];
      if (!x || !C.FX_ID_RE.test(x.id)) return;
      FXA.meta(x.id).then(function (FX) {
        var sl = (FX.sliders || []).filter(function (q) { return q.i === i; })[0];
        if (!sl || sl.path) return;
        var val = num(v, Math.min(sl.min, sl.max), Math.max(sl.min, sl.max));
        if (val === null) return;
        if (sl.enums) val = Math.round(val);
        FXA.setSlider(key, u, i, val);
      }, function () {});
    }
    function syncMeters() {
      var want = hostLive() && host.isPlaying();
      if (want && !H.mTimer) H.mTimer = setInterval(sendMeters, METER_MS);
      if (!want && H.mTimer) { clearInterval(H.mTimer); H.mTimer = 0; sendMeters(); }
    }
    function sendMeters() {
      if (!hostLive()) return;
      var m = host.meters();
      H.link.send({ t: "m", pos: Math.round(m.pos * 1000) / 1000, p: m.tracks.map(function (x) { return Math.round(x * 1000) / 1000; }), mp: Math.round(m.master * 1000) / 1000 });
    }

    // Commands from the tablet: checked here, then the same calls the
    // PC's own buttons make.
    function onCommand(c) {
      if (!c || typeof c.t !== "string") return;
      var s = host.snapshot();
      if (c.t === "hi") { pushState(true); return; }
      if (!s) return;
      var tr = null;
      if (c.id !== undefined) {
        if (typeof c.id !== "string" || !ID_RE.test(c.id)) return;
        s.tracks.forEach(function (x) { if (x.id === c.id) tr = x; });
        if (!tr) return;
      }
      switch (c.t) {
        case "tp":
          if (c.a === "play") host.togglePlay();
          else if (c.a === "stop") host.stop();
          else if (c.a === "rec") host.record();
          else if (c.a === "loop") host.toggleLoop();
          else if (c.a === "metro") host.toggleMetro();
          else if (c.a === "home") host.seek(0);
          break;
        case "seek": { var sec = num(c.s, 0, C.MAX_SEC); if (sec !== null) host.seek(sec); break; }
        case "bpm": { var b = num(c.v, C.MIN_BPM, C.MAX_BPM); if (b !== null) host.setBpm(Math.round(b)); break; }
        case "mv": { var mv = num(c.v, C.VOL_MIN, C.VOL_MAX); if (mv !== null) host.setMaster(Math.round(mv * 2) / 2); break; }
        case "tr": {
          if (!tr || !c.f || typeof c.f !== "object") return;
          var f = {};
          if (c.f.vol !== undefined) { var v = num(c.f.vol, C.VOL_MIN, C.VOL_MAX); if (v === null) return; f.vol = Math.round(v * 2) / 2; }
          if (c.f.pan !== undefined) { var p = num(c.f.pan, -100, 100); if (p === null) return; f.pan = Math.round(p); }
          if (c.f.mute !== undefined) { if (typeof c.f.mute !== "boolean") return; f.mute = c.f.mute; }
          if (c.f.solo !== undefined) { if (typeof c.f.solo !== "boolean") return; f.solo = c.f.solo; }
          if (Object.keys(f).length) host.setTrack(tr.id, f);
          break;
        }
        case "arm": if (tr) host.arm(tr.id); break;
        // a pad or key on the tablet: a note to the track's NULL instrument (v 0: let go)
        case "nt": {
          if (!tr || !tr.ins || !host.note || !Number.isInteger(c.n) || c.n < 0 || c.n > 127 || !Number.isInteger(c.v) || c.v < 0 || c.v > 127) return;
          var hk = tr.id + ":" + c.n;
          if (c.v) H.held[hk] = 1;
          else if (H.held[hk]) delete H.held[hk];
          else return;
          host.note(tr.id, c.n, c.v);
          break;
        }
        case "fx": {
          if (typeof c.u !== "string" || !FXU_RE.test(c.u) || typeof c.on !== "boolean") return;
          var key = c.key === "master" ? "master" : tr ? tr.id : "";
          if (key) host.toggleFx(key, c.u, c.on);
          break;
        }
        // the Effects window on the tablet
        case "fxo": setWatch(c.key === "master" ? "master" : tr ? tr.id : ""); break;
        case "fxx": setWatch(""); break;
        default: fxCommand(c, c.key === "master" ? "master" : tr ? tr.id : "");
      }
    }
    function fxCommand(c, key) {
      var FXA = host.fx;
      if (!key || !FXA) return;
      var u = typeof c.u === "string" && FXU_RE.test(c.u) ? c.u : "";
      switch (c.t) {
        case "fxw":
          if (key !== HF.key || !Array.isArray(c.w)) return;
          HF.watch = c.w.filter(function (w) { return typeof w === "string" && FXU_RE.test(w); }).slice(0, C.MAX_FX);
          syncPeek();
          break;
        case "fs": if (u && Number.isInteger(c.i) && c.i > 0 && c.i <= 64) fxSlider(key, u, c.i, c.v); break;
        case "fxa": {
          var cat = FXA.catalog();
          if (typeof c.fid !== "string" || !C.FX_ID_RE.test(c.fid) || !cat || !cat.some(function (e) { return e.id === c.fid; })) return;
          FXA.addTo(key, c.fid);
          break;
        }
        case "fxd": if (u) FXA.removeFrom(key, u); break;
        case "fxm": if (u && (c.d === 1 || c.d === -1)) FXA.moveIn(key, u, c.d); break;
      }
    }

    // ---------- 4. Remote (tablet / phone) ----------
    var R = { link: null, code: "", st: null, hold: {}, sendT: {}, pend: {}, meters: {}, raf: 0, posAt: 0, pos: 0 };

    function openJoin(code) {
      $("rj-code").value = code || "";
      $("rj-status").textContent = "";
      host.showDlg("join-dlg");
      if (code && CODE_RE.test(code)) joinStart(code);
      else setTimeout(function () { try { $("rj-code").focus(); } catch (e) {} }, 50);
    }
    function joinStart(code) {
      code = String(code || "").replace(/\D/g, "");
      if (!CODE_RE.test(code)) { $("rj-status").textContent = t("rm.badCode"); return; }
      if (H.link) hostStop();
      joinStop(true);
      R.code = code; R.st = null;
      var last = lastJoin();
      R.link = new Link({
        role: "remote", code: code, relay: relayUrl(), dev: deviceName(), rid: last && last.code === code ? last.rid : "",
        onState: function (s) {
          $("rj-status").textContent = stateText(s, "remote");
          renderBadge();
          if (s === "direct" || s === "relay") {
            R.link.send({ t: "hi" });
            if (RF.key) { send(fxAddr({ t: "fxo" })); RF.watch = ""; sendWatch(); }
          }
        },
        onApp: onHostMsg,
        onDeny: function () {
          saveJoin(null);
          joinStop(true);
          $("rj-status").textContent = t("rm.denied");
          renderBadge();
        },
        onGone: function () { renderBadge(); }
      });
      saveJoin({ code: code, rid: R.link.rid });
      $("rj-status").textContent = t("rm.connecting");
    }
    function joinStop(quiet) {
      if (R.link) R.link.close();
      R.link = null; R.st = null;
      cancelAnimationFrame(R.raf); R.raf = 0;
      if (!quiet) leaveConsole();
    }
    function onHostMsg(m) {
      if (!m || typeof m.t !== "string") return;
      if (m.t === "st" && m.v === PROTO) {
        var first = !R.st;
        R.st = m;
        R.pos = num(m.pos, 0, C.MAX_SEC) || 0; R.posAt = performance.now();
        if (first) enterConsole();
        renderConsole();
      } else if (m.t === "m" && R.st) {
        R.pos = num(m.pos, 0, C.MAX_SEC) || 0; R.posAt = performance.now();
        var p = Array.isArray(m.p) ? m.p : [];
        R.st.tracks.forEach(function (tr, i) { feedMeter(tr.id, num(p[i], 0, 4) || 0); });
        feedMeter("master", num(m.mp, 0, 4) || 0);
      } else if (m.t === "fc") onChain(m);
      else if (m.t === "fl" && typeof m.u === "string") onFxLive(m);
    }
    function send(c) { if (R.link) R.link.send(c); }

    function enterConsole() {
      stopScan();
      host.hideDlg("join-dlg");
      document.body.classList.add("remote-on");
      $("remote-ui").hidden = false;
      if (!R.raf) R.raf = requestAnimationFrame(animate);
      keepAwake(true);
    }
    function leaveConsole() {
      if (RF.key) host.hideDlg("ruf-dlg");
      if (RP.id) host.hideDlg("rup-dlg");
      document.body.classList.remove("remote-on");
      $("remote-ui").hidden = true;
      $("ru-strips").textContent = "";
      shape = "";
      keepAwake(false);
      if (RA.on) {                      // the remote app has nothing behind the console
        var last = lastJoin();
        openJoin("");
        if (last) $("rj-code").value = last.code;
      }
    }
    function renderBadge() {
      var b = $("ru-link");
      if (!b || !R.link) return;
      var s = R.link.state;
      b.textContent = s === "direct" ? t("rm.badge.direct") : s === "relay" ? t("rm.badge.relay") : t("rm.badge.lost");
      b.className = "ru-link " + (s === "direct" ? "ok" : s === "relay" ? "via" : "lost");
      setLabel(b, stateText(s, "remote"));
    }

    // The console is rebuilt only when the tracks change; values update in place.
    var shape = "";
    function renderConsole() {
      var st = R.st;
      if (!st) return;
      renderBadge();
      $("ru-name").textContent = st.none ? t("rm.noProject") : (st.name || t("proj.untitled"));
      $("ru-empty").hidden = !st.none && st.tracks && st.tracks.length > 0;
      tpBtn("ru-play", st.playing && !st.rec, st.playing && !st.rec ? "pause" : "play", st.playing && !st.rec ? t("btn.pause") : t("btn.play"));
      tpBtn("ruf-play", st.playing && !st.rec, st.playing && !st.rec ? "pause" : "play", st.playing && !st.rec ? t("btn.pause") : t("btn.play"));
      tpBtn("ru-rec", !!st.rec, "rec", st.rec ? t("btn.recStop") : t("btn.rec"));
      tpBtn("ru-loop", !!st.loop, "loop", t("btn.loop"));
      tpBtn("ru-metro", !!st.metro, null, t("btn.metro"));
      if (document.activeElement !== $("ru-bpm")) $("ru-bpm").value = String(st.bpm || "");
      var sig = (st.tracks || []).map(function (x) { return x.id + ":" + x.name + ":" + x.color + ":" + (x.ins || "") + ":" + (x.fx || []).map(function (f) { return f.u; }).join(","); }).join("|") + "|M:" + (st.mfx || []).map(function (f) { return f.u; }).join(",");
      if (sig !== shape) { shape = sig; buildStrips(); }
      (st.tracks || []).forEach(function (tr) { updateStrip(tr.id, tr); });
      updateStrip("master", { vol: st.vol, fx: st.mfx });
      if (RF.key && RF.key !== "master" && !(st.tracks || []).some(function (x) { return x.id === RF.key; })) host.hideDlg("ruf-dlg");
      else if (RF.key) $("ruf-title").textContent = t("fx.title", { name: fxTitle() });
      if (RP.id && !(padTrack() || {}).ins) host.hideDlg("rup-dlg");
    }
    function tpBtn(id, on, icon, label) {
      var b = $(id);
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
      if (icon && b.getAttribute("data-icon") !== icon) { b.innerHTML = host.ICON[icon]; b.setAttribute("data-icon", icon); }
      setLabel(b, label);
    }

    function buildStrips() {
      var box = $("ru-strips"), st = R.st;
      box.textContent = "";
      (st.tracks || []).forEach(function (tr) { box.appendChild(strip(tr.id, tr)); });
      box.appendChild(strip("master", { name: t("f.master"), color: "", fx: st.mfx }));
    }
    function strip(id, tr) {
      var master = id === "master";
      var s = el("div", "ru-strip" + (master ? " master" : ""));
      s.setAttribute("data-id", id);
      if (tr.color) s.style.setProperty("--tc", tr.color);
      var nm = el("div", "ru-sname", tr.name || "");
      nm.title = tr.name || "";
      s.appendChild(nm);
      // effects: the Effects window, then one toggle per effect (bypass)
      if (R.st.fxr) {
        var fo = el("button", "ru-fxo", t("fx.btn"));
        fo.type = "button";
        setLabel(fo, master ? t("fx.openMaster") : t("fx.open") + ": " + (tr.name || ""));
        fo.addEventListener("click", function () { openFx(id); });
        s.appendChild(fo);
      }
      // a NULL instrument: its pads or keys
      if (!master && R.st.nt && tr.ins) {
        var pb = el("button", "ru-fxo ru-pads", tr.ins === "drums" ? t("rp.pads") : t("rp.keys"));
        pb.type = "button";
        setLabel(pb, t("rp.open", { name: tr.name || "" }));
        pb.addEventListener("click", function () { openPads(id); });
        s.appendChild(pb);
      }
      var fxs = el("div", "ru-fx");
      (tr.fx || []).forEach(function (f) {
        var b = el("button", "ru-fxb", f.name || f.id || "FX");
        b.type = "button";
        b.setAttribute("data-u", f.u);
        b.addEventListener("click", function () {
          var on = b.getAttribute("aria-pressed") !== "true";
          b.setAttribute("aria-pressed", on ? "true" : "false");
          b.classList.toggle("on", on);
          var c = { t: "fx", u: f.u, on: on };
          if (master) c.key = "master"; else c.id = id;
          send(c);
        });
        fxs.appendChild(b);
      });
      s.appendChild(fxs);
      if (!master) {
        var pan = el("input", "ru-pan");
        pan.type = "range"; pan.min = "-100"; pan.max = "100"; pan.step = "1";
        pan.addEventListener("input", function () { move(id, "pan", parseFloat(pan.value)); });
        pan.addEventListener("dblclick", function () { pan.value = "0"; move(id, "pan", 0); });
        s.appendChild(pan);
      }
      var body = el("div", "ru-body");
      var fader = el("div", "ru-fader");
      fader.setAttribute("role", "slider");
      fader.tabIndex = 0;
      fader.setAttribute("aria-valuemin", String(R.st.min));
      fader.setAttribute("aria-valuemax", String(R.st.max));
      var knob = el("div", "ru-knob");
      fader.appendChild(el("div", "ru-track"));
      fader.appendChild(knob);
      wireFader(fader, id, tr.name || "");
      body.appendChild(fader);
      var mt = el("canvas", "ru-meter");
      mt.width = 10; mt.height = 200;
      body.appendChild(mt);
      s.appendChild(body);
      s.appendChild(el("div", "ru-db"));
      if (!master) {
        var row = el("div", "ru-ms");
        row.appendChild(msBtn("m", "M", t("track.mute"), function (on) { move(id, "mute", on, true); }));
        row.appendChild(msBtn("s", "S", t("track.solo"), function (on) { move(id, "solo", on, true); }));
        row.appendChild(msBtn("r", "R", t("track.arm"), function () { send({ t: "arm", id: id }); }));
        s.appendChild(row);
      }
      return s;
    }
    function msBtn(cls, txt, label, fn) {
      var b = el("button", "ru-b " + cls, txt);
      b.type = "button";
      setLabel(b, label);
      b.addEventListener("click", function () {
        var on = b.getAttribute("aria-pressed") !== "true";
        buzz(10);
        fn(on);
      });
      return b;
    }
    function stripEl(id) { return document.querySelector('#ru-strips .ru-strip[data-id="' + id + '"]'); }
    function updateStrip(id, tr) {
      var s = stripEl(id);
      if (!s) return;
      var now = performance.now(), held = R.hold[id] && now - R.hold[id] < HOLD_MS;
      if (!held && typeof tr.vol === "number") setFader(s, tr.vol);
      var pan = s.querySelector(".ru-pan");
      if (pan && document.activeElement !== pan && !(R.hold[id + ".pan"] && now - R.hold[id + ".pan"] < HOLD_MS)) pan.value = String(tr.pan || 0);
      if (pan) setLabel(pan, t("f.pan") + ": " + host.panTxt(Number(pan.value)));
      [["m", tr.mute], ["s", tr.solo], ["r", tr.arm]].forEach(function (p) {
        var b = s.querySelector(".ru-b." + p[0]);
        if (!b) return;
        b.classList.toggle("on", !!p[1]);
        b.setAttribute("aria-pressed", p[1] ? "true" : "false");
      });
      (tr.fx || []).forEach(function (f) {
        var b = s.querySelector('.ru-fxb[data-u="' + f.u + '"]');
        if (!b) return;
        b.classList.toggle("on", !!f.on);
        b.setAttribute("aria-pressed", f.on ? "true" : "false");
        setLabel(b, (f.name || "FX") + ": " + (f.on ? t("rm.fxOn") : t("rm.fxOff")));
      });
    }
    function setFader(s, db) {
      var f = s.querySelector(".ru-fader"), k = s.querySelector(".ru-knob"), st = R.st;
      var x = (db - st.min) / (st.max - st.min);
      f.setAttribute("data-v", String(db));
      f.setAttribute("aria-valuenow", String(db));
      f.setAttribute("aria-valuetext", host.dbTxt(db));
      k.style.bottom = "calc(" + (x * 100).toFixed(2) + "% - " + (x * 28).toFixed(1) + "px)";
      s.querySelector(".ru-db").textContent = host.dbTxt(db);
    }
    // A move is shown at once, then sent at most every SEND_MS.
    function move(id, field, v, now) {
      var s = stripEl(id);
      R.hold[field === "vol" || field === "mvol" ? id : id + "." + field] = performance.now();
      if (field === "vol" && s) setFader(s, v);
      var key = id + "." + field;
      R.pend[key] = v;
      var fire = function () {
        R.sendT[key] = 0;
        if (!(key in R.pend)) return;
        var val = R.pend[key];
        delete R.pend[key];
        if (id === "master") send({ t: "mv", v: val });
        else { var f = {}; f[field] = val; send({ t: "tr", id: id, f: f }); }
        R.sendT[key] = setTimeout(function () { R.sendT[key] = 0; if (key in R.pend) fire(); }, SEND_MS);
      };
      if (now || !R.sendT[key]) fire();
    }
    // Faders move by how far the finger travels, so touching one never makes it jump.
    function wireFader(f, id) {
      var drag = null;
      f.addEventListener("pointerdown", function (e) {
        e.preventDefault();
        try { f.setPointerCapture(e.pointerId); } catch (err) {}
        drag = { y: e.clientY, v: parseFloat(f.getAttribute("data-v")) || 0, id: e.pointerId };
        drag.last = drag.v;
        f.classList.add("drag");
        buzz(8);
      });
      f.addEventListener("pointermove", function (e) {
        if (!drag || e.pointerId !== drag.id) return;
        var st = R.st, h = Math.max(60, f.clientHeight - 28);
        var fine = e.shiftKey ? 0.25 : 1;
        var v = drag.v - (e.clientY - drag.y) / h * (st.max - st.min) * fine;
        v = Math.max(st.min, Math.min(st.max, Math.round(v * 2) / 2));
        // a tick when the fader passes 0 dB (unity) or hits an end
        if ((drag.last < 0) !== (v < 0) || ((v === st.min || v === st.max) && v !== drag.last)) buzz(15);
        drag.last = v;
        move(id, "vol", v);
      });
      var end = function (e) {
        if (!drag || (e && e.pointerId !== drag.id)) return;
        drag = null;
        f.classList.remove("drag");
      };
      f.addEventListener("pointerup", end);
      f.addEventListener("pointercancel", end);
      f.addEventListener("dblclick", function () { move(id, "vol", 0, true); });
      f.addEventListener("keydown", function (e) {
        var v = parseFloat(f.getAttribute("data-v")) || 0, st = R.st, d = 0;
        if (e.key === "ArrowUp" || e.key === "ArrowRight") d = 0.5;
        else if (e.key === "ArrowDown" || e.key === "ArrowLeft") d = -0.5;
        else if (e.key === "PageUp") d = 6;
        else if (e.key === "PageDown") d = -6;
        else if (e.key === "Home") d = st.max - v;
        else if (e.key === "End") d = st.min - v;
        else return;
        e.preventDefault();
        move(id, "vol", Math.max(st.min, Math.min(st.max, v + d)), true);
      });
    }

    // Meters fall back slowly between frames from the PC; the clock runs on its own.
    function feedMeter(id, pk) {
      var m = R.meters[id] || (R.meters[id] = { v: 0, hold: 0, at: 0 });
      var now = performance.now();
      if (pk >= m.v) m.v = pk;
      if (pk >= m.hold || now - m.at > 1500) { m.hold = pk; m.at = now; }
    }
    function animate() {
      R.raf = requestAnimationFrame(animate);
      var st = R.st;
      if (!st) return;
      if (RF.key) drawFx();
      var pos = R.pos + (st.playing ? (performance.now() - R.posAt) / 1000 : 0);
      var tt = C.fmtTime(pos);
      if ($("ru-clock").textContent !== tt) $("ru-clock").textContent = tt;
      var len = Math.max(st.len || 0, pos, 1), bar = $("ru-pos");
      if (document.activeElement !== bar) { bar.max = String(len); bar.value = String(pos); }
      [].forEach.call(document.querySelectorAll("#ru-strips .ru-strip"), function (s) {
        var id = s.getAttribute("data-id"), m = R.meters[id], cv = s.querySelector(".ru-meter");
        if (!cv) return;
        var g = cv.getContext && cv.getContext("2d");
        if (!g) return;
        var h = cv.clientHeight || 200;
        if (cv.height !== h) cv.height = h;
        var v = m ? m.v : 0;
        if (m) { m.v *= 0.86; if (!st.playing && m.v < 0.001) m.v = 0; }
        var db = v > 0 ? 20 * Math.log10(v) : -60, f = Math.max(0, Math.min(1, (db + 48) / 48));
        g.clearRect(0, 0, cv.width, h);
        g.fillStyle = "rgba(127,127,127,0.25)"; g.fillRect(0, 0, cv.width, h);
        g.fillStyle = v >= 0.99 ? "#e01b24" : db > -6 ? "#f6d32d" : "#33d17a";
        g.fillRect(0, Math.round(h * (1 - f)), cv.width, h);
        if (m && m.hold > 0) {
          var hd = 20 * Math.log10(m.hold), hf = Math.max(0, Math.min(1, (hd + 48) / 48));
          g.fillStyle = m.hold >= 0.99 ? "#e01b24" : "#ffffff";
          g.fillRect(0, Math.round(h * (1 - hf)), cv.width, 2);
        }
      });
    }


    // ---------- 5. Remote: a track's Effects window ----------
    // The tablet draws the effect interfaces itself (it has the same
    // effect files as the PC); the PC owns the values, sends them on every
    // change and, while playing, what the interfaces show (meters, scope).
    var RF = { key: "", items: null, sr: 48000, open: {}, views: {}, hold: {}, pend: {}, sendT: {}, picking: false, q: "", shape: "", watch: "", adding: null };
    // fixed icons, built as nodes (no HTML strings)
    function svgIcon(paths, width) {
      var NS = "http://www.w3.org/2000/svg", sv = document.createElementNS(NS, "svg");
      sv.setAttribute("viewBox", "0 0 24 24"); sv.setAttribute("fill", "none"); sv.setAttribute("stroke", "currentColor");
      sv.setAttribute("stroke-width", width); sv.setAttribute("stroke-linecap", "round"); sv.setAttribute("stroke-linejoin", "round");
      sv.setAttribute("aria-hidden", "true");
      paths.forEach(function (d) { var p = document.createElementNS(NS, "path"); p.setAttribute("d", d); sv.appendChild(p); });
      return sv;
    }

    function fxAddr(c) { if (RF.key === "master") c.key = "master"; else c.id = RF.key; return c; }
    function openFx(key) {
      dropViews();
      RF.key = key; RF.items = null; RF.open = {}; RF.picking = false; RF.q = ""; RF.shape = ""; RF.watch = ""; RF.adding = null;
      send(fxAddr({ t: "fxo" }));
      renderFx();
      host.showDlg("ruf-dlg");
      host.fx.loadCatalog().then(function () { if (RF.key === key) renderFx(); }, function () {});
    }
    function closeFx() {
      if (!RF.key) return;
      send({ t: "fxx" });
      dropViews();
      RF.key = ""; RF.items = null;
    }
    function dropViews() {
      Object.keys(RF.views).forEach(function (u) { try { RF.views[u].view.destroy(); } catch (e) {} });
      RF.views = {};
    }
    function fxItem(u) { return (RF.items || []).filter(function (x) { return x.u === u; })[0] || null; }
    // an effect, a MIDI effect or an instrument of the catalog
    function infoOf(id) {
      var cat = host.fx.catalog(), all = cat ? cat.concat(host.fx.instruments() || []) : null;
      return all ? all.filter(function (e) { return e.id === id; })[0] || null : null;
    }
    function fxName(id) { var e = infoOf(id); return e ? e.name : id; }
    function slOf(FX, i) { return (FX.sliders || []).filter(function (q) { return q.i === i; })[0] || null; }

    function onChain(m) {
      if (!RF.key || m.key !== RF.key) return;
      if (m.gone) { host.hideDlg("ruf-dlg"); return; }
      if (!Array.isArray(m.items)) return;
      RF.sr = num(m.sr, 8000, 384000) || 48000;
      var now = performance.now();
      var items = m.items.filter(function (x) {
        return x && typeof x.u === "string" && FXU_RE.test(x.u) && typeof x.id === "string" && C.FX_ID_RE.test(x.id);
      }).slice(0, C.MAX_FX).map(function (x) {
        var o = { u: x.u, id: x.id, on: !!x.on, s: {}, f: {} }, old = fxItem(x.u);
        if (x.s && typeof x.s === "object") Object.keys(x.s).forEach(function (k) {
          var v = num(x.s[k], -1e9, 1e9);
          if (v === null || !/^[0-9]{1,2}$/.test(k)) return;
          // a slider moved here a moment ago keeps its value until the PC has it
          o.s[k] = old && RF.hold[x.u + "." + k] && now - RF.hold[x.u + "." + k] < HOLD_MS && old.s[k] !== undefined ? old.s[k] : v;
        });
        if (x.f && typeof x.f === "object") Object.keys(x.f).forEach(function (k) { if (/^[0-9]{1,2}$/.test(k)) o.f[k] = String(x.f[k]).slice(0, 80); });
        return o;
      });
      if (RF.adding) {
        items.forEach(function (x) { if (RF.adding.indexOf(x.u) < 0) RF.open[x.u] = true; });
        RF.adding = null;
      }
      RF.items = items;
      renderFx();
    }
    function onFxLive(m) {
      var vw = RF.views[m.u];
      if (!vw || !Array.isArray(m.l) || m.l.length > 256) return;
      var out = { live: Float64Array.from(m.l.map(function (v) { return typeof v === "number" && isFinite(v) ? v : 0; })) };
      if (m.m && typeof m.m.d === "string" && m.m.d.length <= 12000 && Number.isInteger(m.m.b) && m.m.b >= 0) {
        try {
          var q = new Int8Array(unb64(m.m.d).buffer), d = new Float64Array(q.length);
          for (var i = 0; i < q.length; i++) d[i] = q[i] / 127;
          out.mem = { base: m.m.b, data: d };
        } catch (e) {}
      }
      try { vw.view.setLive(out); } catch (e) {}
    }

    function fxTitle() {
      if (RF.key === "master") return t("f.master");
      var tr = ((R.st && R.st.tracks) || []).filter(function (x) { return x.id === RF.key; })[0];
      return tr ? tr.name : "";
    }
    // The list is rebuilt when its shape changes; values update in place.
    function renderFx() {
      if (!RF.key) return;
      var FXA = host.fx, items = RF.items, list = $("ruf-list");
      $("ruf-title").textContent = t("fx.title", { name: fxTitle() });
      var shape = items ? items.map(function (x) { return [x.u, x.id, x.on ? 1 : 0, RF.open[x.u] ? 1 : 0, FXA.fxMeta(x.id) ? 1 : 0, infoOf(x.id) ? 1 : 0].join(":"); }).join("|") : "-";
      if (shape !== RF.shape) {
        RF.shape = shape;
        var keep = {};
        Object.keys(RF.views).forEach(function (u) { keep[u] = RF.views[u].canvas; });
        list.textContent = "";
        if (!items) list.appendChild(el("li", "hint small", t("clip.loading")));
        else items.forEach(function (x, k) { list.appendChild(fxSlot(x, k, items.length, keep[x.u])); });
        Object.keys(RF.views).forEach(function (u) {
          var x = fxItem(u);
          if (!x || !RF.open[u] || RF.views[u].id !== x.id) { try { RF.views[u].view.destroy(); } catch (e) {} delete RF.views[u]; }
        });
      }
      if (items) items.forEach(updateSlot);
      $("ruf-empty").hidden = !items || items.length > 0;
      var add = $("ruf-add");
      add.disabled = !items || items.length >= C.MAX_FX || !FXA.catalog();
      add.setAttribute("aria-expanded", RF.picking ? "true" : "false");
      $("ruf-status").textContent = items && items.length >= C.MAX_FX ? t("fx.max", { n: C.MAX_FX }) : "";
      renderPick();
      sendWatch();
    }
    function fxIconBtn(cls, path, label, disabled, fn) {
      var b = el("button", "icon-btn small " + cls);
      b.type = "button";
      b.appendChild(svgIcon([path], "2"));
      setLabel(b, label);
      b.disabled = disabled;
      b.addEventListener("click", fn);
      return b;
    }
    function fxSlot(x, k, n, canvas) {
      var FXA = host.fx, e = infoOf(x.id), FX = FXA.fxMeta(x.id), isOpen = !!RF.open[x.u], name = fxName(x.id);
      var li = el("li", "fx-slot" + (x.on ? "" : " off") + (e ? "" : " unknown"));
      li.setAttribute("data-u", x.u);
      var head = el("div", "fx-head");
      var pw = el("button", "fx-pw" + (x.on ? " on" : ""));
      pw.type = "button";
      pw.setAttribute("aria-pressed", x.on ? "true" : "false");
      setLabel(pw, t("fx.on") + ": " + name);
      pw.appendChild(svgIcon(["M12 3v8", "M6.3 7.5a8 8 0 1 0 11.4 0"], "2.4"));
      pw.addEventListener("click", function () {
        var cur = fxItem(x.u);
        if (!cur) return;
        cur.on = !cur.on;
        send(fxAddr({ t: "fx", u: x.u, on: cur.on }));
        renderFx();
        focusIn(x.u, ".fx-pw");
      });
      head.appendChild(pw);
      var nm = el("button", "fx-name");
      nm.type = "button";
      nm.setAttribute("aria-expanded", isOpen ? "true" : "false");
      nm.appendChild(el("span", "fx-label", e ? e.name : t("fx.unknown", { id: x.id })));
      if (e) nm.appendChild(el("span", "fx-cat", FXA.catName(e.category)));
      nm.addEventListener("click", function () { RF.open[x.u] = !RF.open[x.u]; renderFx(); focusIn(x.u, ".fx-name"); });
      head.appendChild(nm);
      head.appendChild(fxIconBtn("fx-up", "M6 15l6-6 6 6", t("btn.up") + ": " + name, !host.fx.movable(RF.items, k, -1), function () { send(fxAddr({ t: "fxm", u: x.u, d: -1 })); }));
      head.appendChild(fxIconBtn("fx-down", "M6 9l6 6 6-6", t("btn.down") + ": " + name, !host.fx.movable(RF.items, k, 1), function () { send(fxAddr({ t: "fxm", u: x.u, d: 1 })); }));
      head.appendChild(fxIconBtn("fx-del", "M6 6l12 12M18 6L6 18", t("fx.remove") + ": " + name, false, function () { send(fxAddr({ t: "fxd", u: x.u })); }));
      li.appendChild(head);
      if (!isOpen) return li;
      var body = el("div", "fx-body");
      li.appendChild(body);
      if (!e) { body.appendChild(el("p", "hint small", t("fx.unknownHint"))); return li; }
      if (!FX) {
        body.appendChild(el("p", "hint small", t("clip.loading")));
        FXA.meta(x.id).then(function () { if (RF.key) renderFx(); }, function () {});
        return li;
      }
      if (FX.gfx) {
        var cv = canvas || el("canvas", "fx-gfx");
        cv.style.aspectRatio = FX.gfx.w + " / " + FX.gfx.h;
        cv.setAttribute("role", "img");
        setLabel(cv, t("fx.gfx", { name: e.name }));
        body.appendChild(cv);
        fxView(x, FX, cv);
      }
      var ctl = el("details", "fx-ctl");
      ctl.open = !FX.gfx;
      ctl.appendChild(el("summary", "", t("fx.controls")));
      FX.sliders.forEach(function (sl) { ctl.appendChild(fxRow(x, sl)); });
      body.appendChild(ctl);
      return li;
    }
    function focusIn(u, sel) {
      var b = document.querySelector('#ruf-list [data-u="' + u + '"] ' + sel);
      if (b && !b.disabled) b.focus();
    }
    function fxRow(x, sl) {
      var FXA = host.fx, v = C.fxValue(x, sl), id = "ruf-" + x.u + "-" + sl.i, row = el("div", "fx-row");
      row.setAttribute("data-i", String(sl.i));
      var lab = el("label", "field");
      lab.htmlFor = id;
      lab.appendChild(el("span", "", sl.name || ("Slider " + sl.i)));
      if (sl.path) {
        // files live on the PC's disk: chosen there
        lab.appendChild(el("output", "", x.f[sl.i] || t("fx.noFile")));
        row.appendChild(lab);
        var hint = el("p", "hint small", t("rm.fxFile"));
        hint.id = id;
        row.appendChild(hint);
        return row;
      }
      lab.appendChild(el("output", "", FXA.valueText(sl, v)));
      row.appendChild(lab);
      if (sl.enums) {
        var sel = el("select", "");
        sel.id = id;
        sl.enums.forEach(function (name, k) { var o = el("option", "", name); o.value = String(sl.min + k); sel.appendChild(o); });
        sel.value = String(Math.round(v));
        sel.addEventListener("change", function () { fxSet(x.u, sl, parseFloat(sel.value), false); });
        row.appendChild(sel);
      } else {
        var r = el("input", "");
        r.type = "range"; r.id = id; r.min = "0"; r.max = String(C.POS_STEPS); r.step = "1";
        r.value = String(Math.round(C.sliderToPos(sl, v) * C.POS_STEPS));
        r.setAttribute("aria-valuetext", FXA.valueText(sl, v));
        r.addEventListener("input", function () { fxSet(x.u, sl, C.sliderFromPos(sl, parseInt(r.value, 10) / C.POS_STEPS), false); });
        r.addEventListener("dblclick", function () { fxSet(x.u, sl, sl.def, false); updateSlot(fxItem(x.u)); });
        row.appendChild(r);
      }
      return row;
    }
    // A slider moved here (a control or the interface): shown at once,
    // sent at most every SEND_MS.
    function fxSet(u, sl, v, fromView) {
      var x = fxItem(u);
      if (!x) return;
      x.s[String(sl.i)] = v;
      RF.hold[u + "." + sl.i] = performance.now();
      var vw = RF.views[u];
      if (vw && !fromView) { try { vw.view.setSlider(sl.i, v); } catch (e) {} }
      updateSlot(x, fromView ? -1 : sl.i);
      var key = u + "." + sl.i;
      RF.pend[key] = fxAddr({ t: "fs", u: u, i: sl.i, v: v });
      if (RF.sendT[key]) return;
      var fire = function () {
        if (!(key in RF.pend)) { RF.sendT[key] = 0; return; }
        send(RF.pend[key]);
        delete RF.pend[key];
        RF.sendT[key] = setTimeout(fire, SEND_MS);
      };
      fire();
    }
    // values into the controls and the interface (skip: the control being dragged)
    function updateSlot(x, skip) {
      if (!x) return;
      var FXA = host.fx, FX = FXA.fxMeta(x.id), li = document.querySelector('#ruf-list [data-u="' + x.u + '"]');
      if (!FX || !li) return;
      var vw = RF.views[x.u], now = performance.now();
      FX.sliders.forEach(function (sl) {
        if (sl.path) return;
        var v = C.fxValue(x, sl), row = li.querySelector('.fx-row[data-i="' + sl.i + '"]');
        var held = RF.hold[x.u + "." + sl.i] && now - RF.hold[x.u + "." + sl.i] < HOLD_MS;
        if (vw && !held) { try { if (vw.view.fx.inst.getSlider(sl.i) !== v) vw.view.setSlider(sl.i, v); } catch (e) {} }
        if (!row) return;
        var out = row.querySelector("output"), r = row.querySelector("input[type=range]"), sel = row.querySelector("select");
        if (out) out.textContent = FXA.valueText(sl, v);
        if (r) {
          r.setAttribute("aria-valuetext", FXA.valueText(sl, v));
          if (skip !== sl.i && document.activeElement !== r) r.value = String(Math.round(C.sliderToPos(sl, v) * C.POS_STEPS));
        }
        if (sel && document.activeElement !== sel) sel.value = String(Math.round(v));
      });
    }
    function fxView(x, FX, canvas) {
      var vw = RF.views[x.u];
      if (vw && vw.canvas === canvas && vw.id === x.id) return;
      if (vw) { try { vw.view.destroy(); } catch (e) {} }
      var init = {};
      FX.sliders.forEach(function (sl) { init[sl.i] = sl.path ? 0 : C.fxValue(x, sl); });
      try {
        var view = new window.NULLGfx.View(FX, canvas, {
          srate: RF.sr, sliders: init,
          onSlider: function (i, v) { var sl = slOf(FX, i); if (sl && !sl.path) fxSet(x.u, sl, v, true); }
        });
        RF.views[x.u] = { view: view, canvas: canvas, id: x.id };
      } catch (e) { delete RF.views[x.u]; }
    }
    // which interfaces are open: the PC sends live data for those only
    function sendWatch() {
      var w = Object.keys(RF.views).sort(), txt = w.join(",");
      if (txt === RF.watch) return;
      RF.watch = txt;
      send(fxAddr({ t: "fxw", w: w }));
    }
    function renderPick() {
      var box = $("ruf-pick"), FXA = host.fx, cat = FXA.catalog();
      box.hidden = !RF.picking;
      if (!RF.picking) return;
      var cats = $("ruf-cats");
      cats.textContent = "";
      if (!cat) { cats.appendChild(el("p", "hint small", t("clip.loading"))); return; }
      var q = RF.q.trim().toLowerCase(), any = false;
      FXA.cats(FXA.instrumentOf(RF.items)).forEach(function (c) {
        var list = cat.filter(function (e) { return e.category === c && (!q || (e.name + " " + (e.tags || "")).toLowerCase().indexOf(q) >= 0); });
        if (!list.length) return;
        any = true;
        cats.appendChild(el("h3", "", FXA.catName(c)));
        var ul = el("ul", "fx-picks");
        list.forEach(function (e) {
          var li = el("li", ""), b = el("button", "chip", e.name);
          b.type = "button";
          if (e.gfx) b.classList.add("has-gfx");
          setLabel(b, t("fx.add") + ": " + e.name);
          b.addEventListener("click", function () {
            RF.picking = false; RF.q = "";
            RF.adding = (RF.items || []).map(function (x) { return x.u; });
            send(fxAddr({ t: "fxa", fid: e.id }));
            renderFx();
          });
          li.appendChild(b); ul.appendChild(li);
        });
        cats.appendChild(ul);
      });
      if (!any) cats.appendChild(el("p", "hint small", t("fx.none")));
    }
    // ---------- Pads / keys: a track's NULL instrument, played on the PC ----------
    // General MIDI drum notes, as a 4 x 4 pad bank (36 at the bottom left)
    var DRUMS = [48, 49, 50, 51, 44, 45, 46, 47, 40, 41, 42, 43, 36, 37, 38, 39];
    var NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    var RP = { id: "", mode: "", oct: 0, down: {} };       // down: pointer id (or "k") -> note
    function padTrack() {
      return RP.id && R.st ? (R.st.tracks || []).filter(function (x) { return x.id === RP.id; })[0] || null : null;
    }
    function openPads(id) {
      RP.id = id;
      var tr = padTrack();
      if (!tr || !tr.ins) { RP.id = ""; return; }
      RP.mode = tr.ins === "drums" ? "pads" : "keys";
      renderPads();
      host.showDlg("rup-dlg");
    }
    function closePads() { padsOff(); RP.id = ""; }
    function noteSend(n, v) { if (RP.id) send({ t: "nt", id: RP.id, n: n, v: v }); }
    function padEl(n) { return document.querySelector('#rup-pads [data-n="' + n + '"]'); }
    function padOn(key, n, v) {
      if (RP.down[key] === n) return;
      if (RP.down[key] !== undefined) padOff(key);
      RP.down[key] = n;
      noteSend(n, v);
      var b = padEl(n);
      if (b) b.classList.add("on");
      buzz(8);
    }
    function padOff(key) {
      var n = RP.down[key];
      if (n === undefined) return;
      delete RP.down[key];
      noteSend(n, 0);
      var still = Object.keys(RP.down).some(function (k) { return RP.down[k] === n; }), b = padEl(n);
      if (b && !still) b.classList.remove("on");
    }
    function padsOff() { Object.keys(RP.down).forEach(padOff); }
    function noteName(n) { return NOTE_NAMES[n % 12] + (Math.floor(n / 12) - 1); }
    function renderPads() {
      var tr = padTrack();
      if (!tr) return;
      padsOff();
      var keys = RP.mode === "keys", box = $("rup-pads");
      $("rup-title").textContent = t("rp.title", { name: tr.name || "" });
      $("rup-mode").textContent = keys ? t("rp.pads") : t("rp.keys");
      $("rup-oct").hidden = !keys;
      $("rup-octv").textContent = t("kb.oct", { n: RP.oct > 0 ? "+" + RP.oct : String(RP.oct) });
      $("rup-dn").disabled = RP.oct <= -3;
      $("rup-up").disabled = RP.oct >= 3;
      box.textContent = "";
      box.className = "rup-pads" + (keys ? " keys kb-keys" : "");
      if (!keys) {
        DRUMS.forEach(function (n) {
          var b = el("button", "rup-pad", t("rp.d" + n));
          b.type = "button";
          b.setAttribute("data-n", String(n));
          box.appendChild(b);
        });
        return;
      }
      var base = 48 + 12 * RP.oct, whites = 0, wi = 0, n;
      for (n = base; n <= base + 24; n++) if (NOTE_NAMES[n % 12].length === 1) whites++;
      for (n = base; n <= base + 24; n++) {
        var black = NOTE_NAMES[n % 12].length > 1, k = el("button", "kb-key " + (black ? "b" : "w"));
        k.type = "button";
        k.setAttribute("data-n", String(n));
        setLabel(k, noteName(n));
        if (black) { k.style.left = "calc(" + (wi / whites * 100) + "% - " + (50 / whites * 0.62) + "%)"; k.style.width = (100 / whites * 0.62) + "%"; }
        else { k.style.left = (wi / whites * 100) + "%"; k.style.width = (100 / whites) + "%"; wi++; }
        if (!black && n % 12 === 0) k.appendChild(el("span", "kb-c", noteName(n)));
        box.appendChild(k);
      }
    }
    // a pad's velocity: higher on the pad is louder (40..127); keys play at 100
    function velAt(b, y) {
      if (RP.mode === "keys") return 100;
      var r = b.getBoundingClientRect(), f = r.height > 0 ? Math.max(0, Math.min(1, (y - r.top) / r.height)) : 0;
      return Math.max(1, Math.min(127, Math.round(127 - 87 * f)));
    }
    function noteAt(x, y) {
      var b = document.elementFromPoint(x, y);
      b = b && b.closest ? b.closest("#rup-pads [data-n]") : null;
      return b;
    }
    function wirePads() {
      var box = $("rup-pads");
      $("rup-close").innerHTML = host.ICON.close;
      $("rup-close").addEventListener("click", function () { host.hideDlg("rup-dlg"); });
      $("rup-dlg").addEventListener("close", closePads);
      $("rup-mode").addEventListener("click", function () { RP.mode = RP.mode === "keys" ? "pads" : "keys"; renderPads(); });
      $("rup-dn").innerHTML = host.ICON.minus;
      $("rup-up").innerHTML = host.ICON.plus;
      $("rup-dn").addEventListener("click", function () { if (RP.oct > -3) { RP.oct--; renderPads(); } });
      $("rup-up").addEventListener("click", function () { if (RP.oct < 3) { RP.oct++; renderPads(); } });
      box.addEventListener("pointerdown", function (e) {
        var b = e.target.closest ? e.target.closest("[data-n]") : null;
        if (!b) return;
        e.preventDefault();
        try { box.setPointerCapture(e.pointerId); } catch (x) { /* old browsers */ }
        padOn(String(e.pointerId), +b.getAttribute("data-n"), velAt(b, e.clientY));
      });
      // keys: a finger sliding along plays the keys it reaches
      box.addEventListener("pointermove", function (e) {
        var key = String(e.pointerId);
        if (RP.mode !== "keys" || RP.down[key] === undefined) return;
        var b = noteAt(e.clientX, e.clientY);
        if (b && +b.getAttribute("data-n") !== RP.down[key]) padOn(key, +b.getAttribute("data-n"), 100);
      });
      ["pointerup", "pointercancel", "lostpointercapture"].forEach(function (k) {
        box.addEventListener(k, function (e) { padOff(String(e.pointerId)); });
      });
      box.addEventListener("contextmenu", function (e) { e.preventDefault(); });
      // the keyboard: Space or Enter holds the focused pad
      box.addEventListener("keydown", function (e) {
        var b = e.target.closest ? e.target.closest("[data-n]") : null;
        if (!b || (e.key !== " " && e.key !== "Enter")) return;
        e.preventDefault();
        if (!e.repeat) padOn("k", +b.getAttribute("data-n"), 100);
      });
      box.addEventListener("keyup", function (e) { if (e.key === " " || e.key === "Enter") { e.preventDefault(); padOff("k"); } });
      box.addEventListener("focusout", function () { padOff("k"); });
    }

    function drawFx() {
      Object.keys(RF.views).forEach(function (u) { try { RF.views[u].view.draw(); } catch (e) {} });
    }
    function wireFx() {
      wirePads();
      $("ruf-close").innerHTML = host.ICON.close;
      $("ruf-close").addEventListener("click", function () { host.hideDlg("ruf-dlg"); });
      $("ruf-play").addEventListener("click", function () { send({ t: "tp", a: "play" }); });
      $("ruf-dlg").addEventListener("close", closeFx);
      $("ruf-add").addEventListener("click", function () {
        RF.picking = !RF.picking;
        renderFx();
        if (RF.picking) { var sr = $("ruf-search"); sr.value = RF.q; sr.focus(); }
      });
      $("ruf-search").addEventListener("input", function () { RF.q = $("ruf-search").value; renderPick(); });
    }

    // ---------- 6. Remote for orOS Studio (STUDIO-RA) ----------
    // RA.on: this page is the remote on its own (studio/remote/ frames
    // studio/index.html?remote). The last code and the device's id for
    // it are kept on this device only (RA_KEY), so the app can come back
    // to the same PC without a new Allow while the PC still shows that code.
    var RA_KEY = "oros-studio-remote-join", RA_DAYS = 7;
    var RA = { on: false, lock: null, scan: null };
    function lastJoin() {
      try {
        var j = JSON.parse(localStorage.getItem(RA_KEY) || "null");
        if (j && CODE_RE.test(j.code) && /^[0-9a-f]{32}$/.test(j.rid) && typeof j.at === "number" &&
            Date.now() - j.at < RA_DAYS * 864e5) return j;
      } catch (e) {}
      return null;
    }
    function saveJoin(j) {
      try {
        if (j) localStorage.setItem(RA_KEY, JSON.stringify({ code: j.code, rid: j.rid, at: Date.now() }));
        else localStorage.removeItem(RA_KEY);
      } catch (e) {}
    }
    // The screen stays on while the console is shown (Wake Lock; the
    // browser lets it go when the page is hidden, so it is asked again).
    function keepAwake(on) {
      if (!on) {
        if (RA.lock) { try { RA.lock.release(); } catch (e) {} }
        RA.lock = null;
        return;
      }
      if (RA.lock || !navigator.wakeLock || document.visibilityState !== "visible") return;
      navigator.wakeLock.request("screen").then(function (l) {
        if (!R.st) { try { l.release(); } catch (e) {} return; }
        RA.lock = l;
        l.addEventListener("release", function () { if (RA.lock === l) RA.lock = null; });
      }, function () {});
    }
    // A short tick under the finger (phones; silently nothing elsewhere).
    function buzz(ms) {
      try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {}
    }
    function onVisible() {
      if (document.visibilityState !== "visible") { padsOff(); return; }
      if (R.link) R.link.kick();
      if (R.st) keepAwake(true);
    }

    // The code from a scanned QR: Studio's own link (…#studio-remote=123456)
    // or the bare six digits.
    function codeFrom(text) {
      var s = String(text || "").trim(), m = /#studio-remote=([0-9]{6})$/.exec(s);
      if (m) return m[1];
      return CODE_RE.test(s) ? s : "";
    }
    // QR scan: BarcodeDetector where the browser has it (Chrome on
    // Android), else jsQR (vendor/jsqr, as the QR app); a frame every
    // 150 ms; the camera stops when a code is read or the dialog closes.
    var detP = null, jsqrP = null, grabCv = null;
    function detector() {
      if (detP) return detP;
      detP = Promise.resolve(null);
      if (typeof window.BarcodeDetector !== "function") return detP;
      var BD = window.BarcodeDetector;
      detP = (typeof BD.getSupportedFormats === "function" ? BD.getSupportedFormats() : Promise.resolve(["qr_code"]))
        .then(function (f) { return f && f.indexOf("qr_code") >= 0 ? new BD({ formats: ["qr_code"] }) : null; })
        .catch(function () { return null; });
      return detP;
    }
    function loadJsQR() {
      if (window.jsQR) return Promise.resolve(window.jsQR);
      if (jsqrP) return jsqrP;
      jsqrP = new Promise(function (resolve, reject) {
        var sc = document.createElement("script");
        sc.src = "../vendor/jsqr/jsQR.js";
        sc.onload = function () { if (typeof window.jsQR === "function") resolve(window.jsQR); else reject(new Error("jsqr")); };
        sc.onerror = function () { jsqrP = null; reject(new Error("jsqr")); };
        document.head.appendChild(sc);
      });
      return jsqrP;
    }
    function readFrame(v) {
      var w = v.videoWidth, h = v.videoHeight;
      if (!w || !h) return Promise.resolve("");
      return detector().then(function (det) {
        if (det) {
          return det.detect(v).then(function (list) {
            var hit = (list || []).filter(function (b) { return typeof b.rawValue === "string" && b.rawValue; })[0];
            return hit ? hit.rawValue : "";
          }, function () { return ""; });
        }
        return loadJsQR().then(function (jsQR) {
          var k = Math.min(1, 640 / Math.max(w, h));
          if (!grabCv) grabCv = document.createElement("canvas");
          grabCv.width = Math.round(w * k); grabCv.height = Math.round(h * k);
          var g = grabCv.getContext("2d", { willReadFrequently: true });
          g.drawImage(v, 0, 0, grabCv.width, grabCv.height);
          var px = g.getImageData(0, 0, grabCv.width, grabCv.height);
          var r = jsQR(px.data, px.width, px.height, { inversionAttempts: "dontInvert" });
          return r && typeof r.data === "string" ? r.data : "";
        });
      });
    }
    function canScan() { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia); }
    function startScan() {
      if (RA.scan) { stopScan(); return; }
      var v = $("rj-cam"), job = { stream: null, timer: 0, bad: "" };
      RA.scan = job;
      $("rj-status").textContent = t("rm.scanHint");
      renderScan();
      navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false }).then(function (stream) {
        if (RA.scan !== job) { stream.getTracks().forEach(function (x) { x.stop(); }); return; }
        job.stream = stream;
        v.srcObject = stream;
        v.hidden = false;
        var p = v.play();
        if (p && p.catch) p.catch(function () {});
        var tick = function () {
          if (RA.scan !== job) return;
          readFrame(v).then(function (text) {
            if (RA.scan !== job) return;
            var code = codeFrom(text);
            if (code) { buzz(20); stopScan(); $("rj-code").value = code; joinStart(code); return; }
            if (text && text !== job.bad) { job.bad = text; $("rj-status").textContent = t("rm.scanBad"); }
            job.timer = setTimeout(tick, 150);
          }, function () { if (RA.scan === job) job.timer = setTimeout(tick, 150); });
        };
        tick();
      }, function () {
        if (RA.scan !== job) return;
        stopScan();
        $("rj-status").textContent = t("rm.scanNo");
      });
    }
    function stopScan() {
      var job = RA.scan;
      RA.scan = null;
      if (job) {
        clearTimeout(job.timer);
        if (job.stream) job.stream.getTracks().forEach(function (x) { x.stop(); });
      }
      var v = $("rj-cam");
      if (v) { try { v.pause(); } catch (e) {} v.srcObject = null; v.hidden = true; }
      renderScan();
    }
    function renderScan() {
      var b = $("rj-scan");
      if (!b) return;
      b.hidden = !canScan();
      b.textContent = RA.scan ? t("rm.scanStop") : t("rm.scan");
      b.setAttribute("aria-pressed", RA.scan ? "true" : "false");
    }
    function hashJoinCode() {
      var code = "";
      try {
        var h = window.parent.location.hash || "", m = h.match(/^#studio-remote=([0-9]{6})$/);
        if (m) {
          code = m[1];
          window.parent.history.replaceState(window.parent.history.state, "", window.parent.location.pathname + window.parent.location.search);
        }
      } catch (e) {}
      return code;
    }
    // The remote on its own: the join screen is the page; Back or Esc
    // on it does not close it, Stop controlling comes back to it.
    function app() {
      RA.on = true;
      document.body.classList.add("remote-app");
      $("rj-close").hidden = true;
      $("join-dlg").addEventListener("cancel", function (e) { if (RA.on) e.preventDefault(); });
      // A QR scanned while the app is open only changes the hash of its page.
      try {
        window.parent.addEventListener("hashchange", function () {
          var c = hashJoinCode();
          if (!c || (R.link && R.code === c)) return;
          if (R.link) joinStop(true);
          leaveConsole();
          openJoin(c);
        });
      } catch (e) {}
      if (!$("join-dlg").open && !R.link) {
        var last = lastJoin();
        openJoin("");
        if (last && !$("rj-code").value) $("rj-code").value = last.code;
      }
    }

    function wire() {
      wireFx();
      $("rm-start").addEventListener("click", hostStart);
      $("rm-allow").addEventListener("click", function () { if (H.answer) H.answer(true); });
      $("rm-deny").addEventListener("click", function () { if (H.answer) H.answer(false); });
      $("rm-new").addEventListener("click", hostStart);
      $("rm-stop").addEventListener("click", function () { hostStop(); });
      $("rm-close").addEventListener("click", function () { host.hideDlg("remote-dlg"); });
      $("remote-ind").addEventListener("click", openHost);
      $("more-remote").addEventListener("click", function () { host.hideDlg("more-dlg"); openHost(); });
      $("more-join").addEventListener("click", function () { host.hideDlg("more-dlg"); openJoin(""); });
      $("rj-go").addEventListener("click", function () { joinStart($("rj-code").value); });
      $("rj-code").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); joinStart($("rj-code").value); } });
      $("rj-close").addEventListener("click", function () { host.hideDlg("join-dlg"); if (R.link && !R.st) joinStop(); });
      $("rj-scan").addEventListener("click", startScan);
      $("join-dlg").addEventListener("close", stopScan);
      renderScan();
      document.addEventListener("visibilitychange", onVisible);
      $("ru-exit").addEventListener("click", function () { joinStop(); });
      ["play", "stop", "home", "rec", "loop", "metro"].forEach(function (a) {
        $("ru-" + a).addEventListener("click", function () { buzz(10); send({ t: "tp", a: a }); });
      });
      $("ru-bpm").addEventListener("change", function () {
        var v = parseFloat($("ru-bpm").value);
        if (isFinite(v)) send({ t: "bpm", v: v });
      });
      $("ru-pos").addEventListener("change", function () {
        var v = parseFloat($("ru-pos").value);
        if (isFinite(v)) send({ t: "seek", s: v });
        $("ru-pos").blur();
      });
      ["ru-home", "ru-play", "ru-stop", "ru-exit"].forEach(function (id) {
        var ic = { "ru-home": "home", "ru-play": "play", "ru-stop": "stop", "ru-exit": "close" }[id];
        $(id).innerHTML = host.ICON[ic];
      });
      $("ru-rec").innerHTML = host.ICON.rec;
      $("ru-loop").innerHTML = host.ICON.loop;
      $("rm-close").innerHTML = host.ICON.close;
      $("rj-close").innerHTML = host.ICON.close;
      setLabel($("ru-exit"), t("rm.exit"));
      setLabel($("ru-home"), t("btn.home"));
      setLabel($("ru-stop"), t("btn.stop"));
      // a QR scanned on the tablet opens "…#studio-remote=<code>": orOS
      // (older QR codes) or Remote for orOS Studio (studio/remote/)
      var code = hashJoinCode();
      if (code) openJoin(code);
    }

    return {
      wire: wire,
      app: app,
      // the PC's state changed (any render): the tablet follows
      changed: function () { if (H.link) { pushState(false); syncMeters(); syncPeek(); renderHost(); } },
      hosting: function () { return !!H.link; },
      remoteOn: function () { return !!R.link; },
      _command: onCommand
    };
  };

  // for tests
  window.StudioRemote._test = { derive: derive, seal: seal, unseal: unseal, newCode: newCode, wsUrl: wsUrl, Link: Link, PROTO: PROTO };
})();
