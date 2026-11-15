/* ============================================================
   orOS Transfer — engine.js, v1.3.0 (1.2.0, D1: the sender's title and message in the first manifest part; 1.3.0, D3: the sender's background picture before the list)
   One transfer between two browsers: the sender, who has the files,
   and the receiver, who opened the link or typed the code.

   1. Meeting. Both open the same room on the orOS relay
      (relay/remote.js, /rt/<room>; the room id is a hash of the code).
      The relay passes sealed frames on and stores nothing. A room
      holds two sockets, so a transfer has one receiver.
   2. Direct link. The sender offers a WebRTC data channel; offer,
      answer and candidates go through the room, sealed. The file
      bytes go over the data channel, never through a server.
   3. Relay path (W2). When no direct link opens within LINK_MS and
      the whole transfer is at most RELAY_MAX (50 MB), the sender says
      "relay" and the same messages go through the room instead: pieces
      of 8 KiB as text ("~" + base64), at most ~33 frames a second so
      the relay's per-socket limit (400 frames / 10 s) is never hit.
      They are sealed exactly like the direct ones: the relay still
      sees nothing but ciphertext. Over 50 MB the sender says
      "nodirect" and both sides stop.
   4. The files. The sender sends the list (sealed), the receiver
      looks and answers go or no; then every file in pieces
      (core.js sealPiece: AES-GCM with file and piece number as
      additional data), each file followed by its SHA-256. The receiver
      checks the order of every piece, the size and the hash of every
      file, and tells which files did not arrive whole.
   5. Pace. The receiver acknowledges what it has written; the sender
      never has more than WINDOW pieces unacknowledged and waits while
      the channel's buffer is full.
   6. Resume (W2). When the direct channel drops mid-transfer while
      the room still stands, the sender offers a new channel; on it the
      receiver says where it stopped (file and piece, once everything
      it already had is written) and the sender goes on from there,
      re-hashing the start of that file from its own copy. No new
      channel within RESUME_MS: "lost". A page that was closed or
      reloaded starts again from the beginning.

   new OrosTransferEngine.Transfer({
     role: "sender"|"receiver", code, relay?, dev,
     WebSocket?, RTCPeerConnection?, iceServers?,
     files (sender: manifest from core.buildManifest),
     meta? {t, m} (sender: title and message), bg? Uint8Array (sender: a JPEG/PNG/WebP picture, ≤ core.BG_MAX),
     onBg({ bytes, type }) (receiver: the picture arrived whole, before the offer),
     read(i, start, end) → Promise<Uint8Array> (sender),
     onState(phase, info), onProgress({ bytes, total, file })
   }).start(), .accept(sink) (receiver), .decline(), .cancel(), .mode()
   sink = { open(i, f) → Promise, write(i, bytes) → Promise, close(i, ok) → Promise }
   Phases, sender:   connecting → wait → linking → offered {mode} → sending → done {bad}
           receiver: connecting → [wait] → linking → offer {files,total,biggest,mode} → receiving → done {bad}
           either:   reconnecting (then back to sending / receiving), error {e}
           e ∈ noroom, left, nodirect, declined, cancelled, lost, bad, version, nocrypto, io
   ============================================================ */
(function (root) {
  "use strict";

  var CORE = root.OrosTransferCore || (typeof require === "function" ? require("./core.js") : null);
  var RELAY = "https://oros-mail-relay.koulaxizis.workers.dev";
  var ICE = [{ urls: "stun:stun.cloudflare.com:3478" }];
  var WINDOW = 256;                 // pieces sent but not yet written on the other side
  var ACK_EVERY = 32;
  var READ_PIECES = 16;             // the sender reads ~1 MB of a file at a time (direct)
  var BUF_HIGH = 8 * 1048576, BUF_LOW = 1048576;
  var LINK_MS = 25000;              // a direct link must open within this
  var RECV_LINK_MS = 45000;         // the receiver waits longer: the sender decides relay or not
  var RESUME_MS = 40000;
  var PING_MS = 20000;
  var RELAY_MAX = 50 * 1048576;     // the most a transfer may send through the relay room
  var RELAY_PIECE = 8192;           // "~" + base64(12 + 12 + 8192 + 16) ≈ 11,000 characters < 16 KB frame
  var RELAY_GAP_MS = 30;            // one piece frame per 30 ms at most
  var RELAY_MAN = 9000;
  var BG_PART = 24000, RELAY_BG_PART = 6000;   // raw bytes of the picture per sealed message (relay: < 16 KB frame)
  var BG_PARTS_MAX = 400;

  function wsUrl(relay, room) { return String(relay).replace(/^http(s?):/, "ws$1:").replace(/\/+$/, "") + "/rt/" + room; }
  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function stale() { var e = new Error("stale"); e.code = "stale"; return e; }

  function Transfer(o) {
    var self = this;
    var role = o.role === "receiver" ? "receiver" : "sender", other = role === "sender" ? "receiver" : "sender";
    var WS = o.WebSocket || root.WebSocket, RTC = o.RTCPeerConnection || root.RTCPeerConnection;
    var keys = null, ws = null, pc = null, dc = null, ended = false, tries = 0;
    var saidHi = false, linkTimer = 0, pingTimer = 0, resumeTimer = 0;
    var mode = "";                  // "direct" | "relay" once the files are offered
    var resuming = "";              // the phase to go back to after a reconnect
    var sendQ = Promise.resolve(), dcQ = Promise.resolve();
    this.role = role;
    this.phase = "";

    function set(p, info) {
      if (ended) return;
      self.phase = p;
      if (p === "done" || p === "error") ended = true;
      if (o.onState) { try { o.onState(p, info || {}); } catch (e) {} }
      if (ended) shutdown();
    }
    function fail(e) { set("error", { e: e }); }
    function failFrom(err) {
      if (err && err.code === "stale") return;
      fail(err && (err.code === "io" || err.code === "lost") ? err.code : "bad");
    }
    function progress(p) { if (o.onProgress) { try { o.onProgress(p); } catch (e) {} } }
    function transferring() { return self.phase === "sending" || self.phase === "receiving" || self.phase === "reconnecting"; }

    // ----- the room -----
    function wsOpen() { return !!(ws && ws.readyState === 1); }
    function roomSend(obj) {
      var w = ws;
      sendQ = sendQ.then(function () { return CORE.seal(keys.key, role, obj); }).then(function (txt) {
        if (w && w.readyState === 1) w.send(txt);
      }, function () {});
      return sendQ;
    }
    function hello() {
      if (saidHi) return;
      saidHi = true;
      roomSend({ t: "hi", v: CORE.PROTO, dev: CORE.cleanDev(o.dev) });
    }
    function openRoom() {
      if (ended) return;
      var w;
      try { w = new WS(wsUrl(o.relay || RELAY, keys.room)); } catch (e) { fail("noroom"); return; }
      ws = w;
      var gotOpen = false;
      w.onopen = function () { gotOpen = true; tries = 0; };
      w.onmessage = function (e) { if (w === ws) onRoom(e.data); };
      w.onerror = function () {};
      w.onclose = function () {
        if (w !== ws) return;
        ws = null;
        if (ended) return;
        if (mode === "relay" && (self.phase !== "linking")) { fail("lost"); return; }
        if (dcOpen()) return;                                    // the direct link carries on
        if (transferring()) { fail("lost"); return; }
        saidHi = false;
        // A full room (someone else is receiving) or no network: a few tries, then say so.
        if (++tries > (gotOpen ? 6 : 3)) { fail("noroom"); return; }
        setTimeout(openRoom, [0, 1000, 2000, 4000, 8000, 8000, 8000][tries]);
      };
    }
    function onRoom(data) {
      if (typeof data !== "string" || ended || data === "pong") return;
      if (data.charAt(0) === "{") {
        var sys = null;
        try { sys = JSON.parse(data).sys; } catch (e) {}
        dcQ = dcQ.then(function () {
          if (ended || !sys) return;
          if (sys === "wait") { if (!dcOpen() && mode !== "relay" && !transferring()) set("wait"); }
          else if (sys === "peer") hello();
          else if (sys === "left") {
            if (dcOpen() && !resuming) return;
            if (mode === "relay" || transferring()) { fail("left"); return; }
            dropRtc();
            saidHi = false;
            if (role === "receiver") fail("left");
            else set("wait");                                    // a new receiver may still come
          }
        });
        return;
      }
      // One queue for everything from the room: on the relay path pieces
      // and control messages must be read in the order they came.
      if (data.charAt(0) === "~") {
        if (role !== "receiver" || mode !== "relay") return;
        var bytes;
        try { bytes = CORE.unb64(data.slice(1)); } catch (e) { return; }
        dcQ = dcQ.then(function () { return onPiece(bytes); }).catch(failFrom);
        return;
      }
      dcQ = dcQ.then(function () { return CORE.unseal(keys.key, other, data); }).then(function (m) {
        if (!m || ended) return null;
        return onRoomMsg(m);
      }).catch(failFrom);
    }
    function onRoomMsg(m) {
      if (m.t === "hi") {
        if (m.v !== CORE.PROTO) { fail("version"); return null; }
        hello();
        if (transferring()) return null;
        set("linking", { dev: CORE.cleanDev(m.dev) });
        if (role === "sender") startRtc();
        else armLinkTimer(RECV_LINK_MS);
      } else if (m.t === "sdp" && m.d && typeof m.d.sdp === "string") onSdp(m.d);
      else if (m.t === "ice" && m.d && pc) pc.addIceCandidate(m.d).catch(function () {});
      else if (m.t === "x") fail("cancelled");
      else if (m.t === "relay" && role === "receiver" && self.phase === "linking") {
        mode = "relay";
        clearTimeout(linkTimer);
        dropRtc();
      } else if (m.t === "nodirect" && role === "receiver") fail("nodirect");
      else if (mode === "relay") return onCtrl(m);
      return null;
    }
    function dcOpen() { return !!(dc && dc.readyState === "open"); }

    // ----- the direct link -----
    function newPc() {
      var p = new RTC({ iceServers: o.iceServers || ICE });
      p.onicecandidate = function (e) {
        if (e.candidate) roomSend({ t: "ice", d: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate });
      };
      p.onconnectionstatechange = function () {
        if (p !== pc || p.connectionState !== "failed") return;
        if (resuming || transferring()) lostLink();
        else if (role === "sender") noDirect();
      };
      return p;
    }
    function armLinkTimer(ms) {
      clearTimeout(linkTimer);
      linkTimer = setTimeout(function () {
        if (dcOpen() || ended || mode === "relay") return;
        if (role === "sender") noDirect(); else if (!resuming) fail("nodirect");
      }, ms);
    }
    // No direct link: the sender decides between the relay path and giving up.
    function noDirect() {
      if (ended || dcOpen() || mode || role !== "sender") return;
      dropRtc();
      if (total <= RELAY_MAX && wsOpen()) {
        mode = "relay";
        roomSend({ t: "relay" }).then(offerFiles);
      } else {
        roomSend({ t: "nodirect" }).then(function () { fail("nodirect"); });
      }
    }
    function startRtc() {
      if (typeof RTC !== "function") { if (resuming) fail("lost"); else noDirect(); return; }
      dropRtc();
      pc = newPc();
      dc = pc.createDataChannel("oros-transfer", { ordered: true });
      wireDc(dc);
      pc.createOffer().then(function (d) { return pc.setLocalDescription(d); }).then(function () {
        roomSend({ t: "sdp", d: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
      }).catch(function () { if (resuming) lostLink(); else noDirect(); });
      if (!resuming) armLinkTimer(LINK_MS);
    }
    function onSdp(d) {
      if (typeof RTC !== "function" || mode === "relay") return;
      if (d.type === "offer" && role === "receiver") {
        dropRtc();
        pc = newPc();
        pc.ondatachannel = function (e) { dc = e.channel; wireDc(dc); };
        pc.setRemoteDescription(d).then(function () { return pc.createAnswer(); })
          .then(function (a) { return pc.setLocalDescription(a); })
          .then(function () { roomSend({ t: "sdp", d: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } }); })
          .catch(function () {});
      } else if (d.type === "answer" && role === "sender" && pc) {
        pc.setRemoteDescription(d).catch(function () { if (resuming) lostLink(); else noDirect(); });
      }
    }
    function wireDc(ch) {
      ch.binaryType = "arraybuffer";
      try { ch.bufferedAmountLowThreshold = BUF_LOW; } catch (e) {}
      ch.onopen = function () {
        if (ch !== dc || ended) return;
        clearTimeout(linkTimer);
        if (resuming) {
          // the receiver says where it stopped, once all it had is written
          if (role === "receiver") dcQ = dcQ.then(sendResume).catch(failFrom);
          return;
        }
        mode = "direct";
        if (role === "sender") offerFiles();
      };
      ch.onclose = function () {
        if (ch !== dc || ended) return;
        if (transferring() && mode === "direct") lostLink();
        else if (role === "sender" && self.phase === "linking") noDirect();
        else if (self.phase !== "linking") fail("lost");
      };
      ch.onbufferedamountlow = function () { var w = bufWaiters; bufWaiters = []; w.forEach(function (f) { f(); }); };
      ch.onmessage = function (e) {
        if (ch !== dc || ended) return;
        var d = e.data;
        if (typeof d === "string") {
          dcQ = dcQ.then(function () { return CORE.unseal(keys.key, other, d); }).then(function (m) { if (m && !ended) return onCtrl(m); })
            .catch(failFrom);
        } else if (role === "receiver") {
          dcQ = dcQ.then(function () { return onPiece(d); }).catch(failFrom);
        }
      };
    }
    // Control messages go where the files go.
    function send(obj) {
      if (mode === "relay") return roomSend(obj);
      return CORE.seal(keys.key, role, obj).then(function (txt) {
        if (dcOpen()) dc.send(txt);
      });
    }
    var bufWaiters = [];
    function roomInBuffer() {
      var ch = mode === "relay" ? ws : dc;
      if (!ch || !(ch.bufferedAmount > (mode === "relay" ? 262144 : BUF_HIGH))) return Promise.resolve();
      return new Promise(function (res) {
        bufWaiters.push(res);
        setTimeout(res, mode === "relay" ? 50 : 2000);           // some browsers miss the event
      }).then(roomInBuffer);
    }
    function dropRtc() {
      clearTimeout(linkTimer);
      var p = pc, d = dc;
      pc = null; dc = null;
      try { if (d) d.close(); } catch (e) {}
      try { if (p) p.close(); } catch (e) {}
    }
    // The direct channel dropped mid-transfer: try a new one over the room.
    function lostLink() {
      if (ended) return;
      if (!wsOpen() || mode !== "direct") { fail("lost"); return; }
      if (!resuming) {
        resuming = self.phase;
        set("reconnecting");
        clearTimeout(resumeTimer);
        resumeTimer = setTimeout(function () { if (resuming) fail("lost"); }, RESUME_MS);
      }
      gen++;
      wake();
      dropRtc();
      if (role === "sender") setTimeout(function () { if (resuming && !ended) startRtc(); }, 500);
    }
    function resumed() {
      clearTimeout(resumeTimer);
      var back = resuming;
      resuming = "";
      set(back);
    }

    // ----- the sender -----
    var meta = role === "sender" ? CORE.cleanMeta(o.meta) : null;
    var files = role === "sender" ? (o.files || []) : [], total = 0, acked = 0, ackedBytes = 0, ackWaiters = [];
    var sent = 0, gen = 0;
    files.forEach(function (f) { total += f.s; });
    function pieceSize() { return mode === "relay" ? RELAY_PIECE : CORE.PIECE; }
    function wake() { var w = ackWaiters; ackWaiters = []; w.forEach(function (f) { f(); }); w = bufWaiters; bufWaiters = []; w.forEach(function (f) { f(); }); }
    var bg = role === "sender" && o.bg && CORE.picType(o.bg) ? o.bg : null;
    // D3: the picture goes first, in sealed parts, so the receiver sees it
    // with the list. The hash is in part 0; a picture that does not arrive
    // whole is left out on the other side and the transfer goes on.
    function sendBg() {
      if (!bg || ended) return Promise.resolve();
      var size = mode === "relay" ? RELAY_BG_PART : BG_PART, n = Math.ceil(bg.length / size);
      var h = new CORE.Sha256(); h.update(bg);
      var hx = h.hex(), q = Promise.resolve(), last = 0;
      for (var i = 0; i < n; i++) {
        (function (i) {
          q = q.then(function () {
            if (ended) return null;
            var wait = mode === "relay" ? last + RELAY_GAP_MS - Date.now() : 0;
            return (wait > 0 ? delay(wait) : Promise.resolve()).then(roomInBuffer).then(function () {
              if (ended) return null;
              var m = { t: "bg", i: i, n: n, s: bg.length, d: CORE.b64(bg.subarray(i * size, Math.min(bg.length, (i + 1) * size))) };
              if (i === 0) m.h = hx;
              last = Date.now();
              return send(m);
            });
          });
        })(i);
      }
      return q;
    }
    function offerFiles() {
      if (ended) return null;
      set("offered", { mode: mode });
      return sendBg().then(offerList);
    }
    function offerList() {
      if (ended) return null;
      var parts = CORE.splitManifest(files, (mode === "relay" ? RELAY_MAN : 30000) - (meta ? 1200 : 0));   // room for the title and message
      var q = Promise.resolve();
      parts.forEach(function (p, i) {
        q = q.then(function () {
          var man = { t: "man", i: i, n: parts.length, files: p, total: total, mode: mode };
          if (i === 0 && meta) man.meta = meta;        // D1: the title and message ride in the first part
          return send(man);
        });
      });
      return q;
    }
    function waitWindow(g) {
      if (g !== gen) return Promise.reject(stale());
      if (sent - acked < WINDOW || ended) return Promise.resolve();
      return new Promise(function (res) { ackWaiters.push(res); }).then(function () { return waitWindow(g); });
    }
    function readChecked(fi, a, b) {
      return Promise.resolve(o.read(fi, a, b)).then(function (bytes) {
        if (!bytes || bytes.length !== b - a) { var er = new Error("read"); er.code = "io"; throw er; }
        return bytes;
      });
    }
    // Send from file `startFile`, piece `startN` on (0, 0 at first).
    function sendFrom(startFile, startN) {
      var g = gen, i = startFile, ps = pieceSize(), lastFrame = 0;
      function nextFile(firstN) {
        if (ended || g !== gen) return null;
        if (i >= files.length) return send({ t: "fin" });
        var f = files[i], fi = i, h = new CORE.Sha256(), n = firstN || 0, pos = Math.min(f.s, n * ps);
        // a resumed file: hash what the receiver already has, from our own copy
        function rehash(at) {
          if (at >= pos) return Promise.resolve();
          var end = Math.min(pos, at + READ_PIECES * CORE.PIECE);
          return readChecked(fi, at, end).then(function (b) {
            if (g !== gen) throw stale();
            h.update(b);
            return rehash(end);
          });
        }
        function block() {
          if (ended) return null;
          if (g !== gen) throw stale();
          if (pos >= f.s) {
            return send({ t: "end", i: fi, h: h.hex(), s: f.s }).then(function () { i++; return nextFile(0); });
          }
          var end = Math.min(f.s, pos + Math.max(1, Math.floor(READ_PIECES * CORE.PIECE / ps)) * ps);
          return readChecked(fi, pos, end).then(function (bytes) {
            h.update(bytes);
            var q = Promise.resolve();
            for (var off = 0; off < bytes.length; off += ps) {
              (function (part) {
                q = q.then(function () { return waitWindow(g); }).then(roomInBuffer).then(function () {
                  if (ended) return null;
                  if (mode !== "relay") return null;
                  var wait = lastFrame + RELAY_GAP_MS - Date.now();
                  return wait > 0 ? delay(wait) : null;
                }).then(function () {
                  if (ended) return null;
                  if (g !== gen) throw stale();
                  return CORE.sealPiece(keys.key, fi, n, part).then(function (buf) {
                    if (g !== gen) throw stale();
                    if (mode === "relay") {
                      if (!wsOpen()) { var er = new Error("lost"); er.code = "lost"; throw er; }
                      ws.send("~" + CORE.b64(buf));
                      lastFrame = Date.now();
                    } else {
                      if (!dcOpen()) throw stale();                // the channel dropped: a resume takes over
                      dc.send(buf);
                    }
                    n++;
                    sent++;
                  });
                });
              })(bytes.subarray(off, Math.min(bytes.length, off + ps)));
            }
            pos = end;
            return q.then(block);
          });
        }
        return rehash(0).then(block);
      }
      Promise.resolve().then(function () { return nextFile(startN); }).catch(failFrom);
    }

    // ----- the receiver -----
    var manParts = [], manN = 0, offerMeta = null, offer = null, sink = null, cur = -1, curN = 0, curBytes = 0, curHash = null, curOpen = false;
    var written = 0, writtenBytes = 0, bad = [], doneFiles = 0;
    function sendResume() {
      if (ended || !resuming) return null;
      var at = curOpen ? { i: cur, n: curN } : { i: doneFiles, n: 0 };
      return send({ t: "resume", i: at.i, n: at.n, w: written, b: writtenBytes }).then(resumed);
    }
    function onCtrl(m) {
      if (role === "sender") {
        if (m.t === "go" && self.phase === "offered") { set("sending"); sendFrom(0, 0); }
        else if (m.t === "no") fail("declined");
        else if (m.t === "ack") {
          if (+m.n > acked) { acked = +m.n; ackedBytes = +m.b || ackedBytes; }
          progress({ bytes: ackedBytes, total: total, file: +m.f || 0 });
          var w = ackWaiters; ackWaiters = []; w.forEach(function (f) { f(); });
        } else if (m.t === "resume" && resuming) {
          var ri = +m.i, rn = +m.n;
          if (!(ri >= 0 && ri <= files.length) || !(rn >= 0) || Math.floor(rn) !== rn) { fail("bad"); return null; }
          gen++;
          wake();
          acked = sent = Math.max(0, +m.w || 0);
          ackedBytes = Math.max(0, +m.b || 0);
          resumed();
          sendFrom(ri, rn);
        } else if (m.t === "done") {
          var b = Array.isArray(m.bad) ? m.bad.filter(function (x) { return x >= 0 && x < files.length; }) : [];
          progress({ bytes: total, total: total, file: files.length });
          set("done", { bad: b });
        } else if (m.t === "x") fail("cancelled");
        return null;
      }
      // receiver
      if (m.t === "bg") { onBgPart(m); return null; }
      if (m.t === "man" && !offer) {
        if (!(m.n >= 1 && m.n <= 5000) || !(m.i >= 0 && m.i < m.n) || !Array.isArray(m.files)) { refuse(); return null; }
        manN = m.n;
        manParts[m.i] = m.files;
        if (m.i === 0) offerMeta = CORE.cleanMeta(m.meta);
        for (var k = 0; k < manN; k++) if (!manParts[k]) return null;
        var all = [].concat.apply([], manParts);
        var ok = CORE.checkManifest(all);
        if (!ok) { refuse(); return null; }
        if (mode === "relay" && ok.total > RELAY_MAX) { refuse(); return null; }
        offer = ok;
        set("offer", { files: ok.files, total: ok.total, biggest: ok.biggest, mode: mode, meta: offerMeta });
      } else if (m.t === "end") {
        return endFile(m);                     // in order with the pieces (same queue)
      } else if (m.t === "fin") {
        if (self.phase !== "receiving" || doneFiles !== offer.files.length) throw new Error("bad");
        return send({ t: "done", bad: bad }).then(function () { set("done", { bad: bad.slice() }); });
      } else if (m.t === "x") fail("cancelled");
      return null;
    }
    // D3: the picture, in order, before the list; anything odd drops the picture only.
    var bgParts = [], bgGot = 0, bgLen = 0, bgN = 0, bgS = 0, bgH = "", bgOver = false;
    function onBgPart(m) {
      if (bgOver || offer) return;
      var d = null;
      try { d = typeof m.d === "string" ? CORE.unb64(m.d) : null; } catch (e) { d = null; }
      if (m.i === 0) {
        bgN = m.n; bgS = m.s; bgH = typeof m.h === "string" ? m.h : "";
        if (!(bgN >= 1 && bgN <= BG_PARTS_MAX) || !(bgS >= 12 && bgS <= CORE.BG_MAX) || !/^[0-9a-f]{64}$/.test(bgH)) { bgOver = true; return; }
      }
      if (!d || m.i !== bgGot || !bgN || m.n !== bgN || m.s !== bgS || bgLen + d.length > bgS) { bgOver = true; return; }
      bgParts.push(d); bgGot++; bgLen += d.length;
      if (bgGot < bgN) return;
      bgOver = true;
      if (bgLen !== bgS) return;
      var all = new Uint8Array(bgS), at = 0;
      bgParts.forEach(function (p) { all.set(p, at); at += p.length; });
      bgParts = [];
      var h = new CORE.Sha256(); h.update(all);
      var type = CORE.picType(all);
      if (h.hex() !== bgH || !type) return;
      if (o.onBg) { try { o.onBg({ bytes: all, type: type }); } catch (e) {} }
    }
    function refuse() { send({ t: "no" }); fail("bad"); }
    this.__bgPart = onBgPart;                 // tests only: feed the picture handler directly
    function ioErr(e) { var er = new Error("io"); er.code = "io"; er.cause = e; throw er; }
    function receivingNow() { return (self.phase === "receiving" || self.phase === "reconnecting") && !!sink; }
    function startFile(i) {
      if (i !== doneFiles || !offer || i >= offer.files.length) throw new Error("bad");
      cur = i; curN = 0; curBytes = 0; curHash = new CORE.Sha256(); curOpen = true;
      return Promise.resolve(sink.open(i, offer.files[i])).catch(ioErr);
    }
    function onPiece(buf) {
      if (!receivingNow()) throw new Error("bad");
      return CORE.openPiece(keys.key, buf).then(function (p) {
        if (!p) throw new Error("bad");
        var start = (!curOpen || p.file !== cur) ? startFile(p.file) : Promise.resolve();
        return start.then(function () {
          if (p.n !== curN || curBytes + p.bytes.length > offer.files[cur].s) throw new Error("bad");
          curN++; curBytes += p.bytes.length;
          curHash.update(p.bytes);
          return Promise.resolve(sink.write(cur, p.bytes)).catch(ioErr);
        }).then(function () {
          written++; writtenBytes += p.bytes.length;
          progress({ bytes: writtenBytes, total: offer.total, file: cur });
          if (written % ACK_EVERY === 0 && !resuming) send({ t: "ack", n: written, b: writtenBytes, f: cur });
        });
      });
    }
    function endFile(m) {
      if (!receivingNow()) throw new Error("bad");
      var start = (!curOpen || m.i !== cur) ? startFile(m.i) : Promise.resolve();    // an empty file has no pieces
      return start.then(function () {
        var f = offer.files[cur];
        var whole = curBytes === f.s && typeof m.h === "string" && curHash.hex() === m.h;
        if (!whole) bad.push(cur);
        curOpen = false;
        doneFiles++;
        return Promise.resolve(sink.close(cur, whole)).catch(ioErr);
      }).then(function () {
        if (!resuming) send({ t: "ack", n: written, b: writtenBytes, f: cur });
      });
    }

    // ----- both -----
    function shutdown() {
      clearInterval(pingTimer);
      clearTimeout(linkTimer);
      clearTimeout(resumeTimer);
      var w = ws;
      // let the last sealed words go out first
      Promise.all([sendQ, dcQ]).then(function () {
        setTimeout(function () {
          dropRtc();
          ws = null;
          try { if (w) w.close(1000, "bye"); } catch (e) {}
        }, 300);
      });
      gen++;
      wake();
    }

    this.start = function () {
      set("connecting");
      if (!CORE || !CORE.derive) { fail("nocrypto"); return self; }
      CORE.derive(o.code).then(function (k) {
        if (ended) return;
        keys = k;
        openRoom();
        pingTimer = setInterval(function () { try { if (ws && ws.readyState === 1) ws.send("ping"); } catch (e) {} }, PING_MS);
      }, function () { fail("nocrypto"); });
      return self;
    };
    this.accept = function (s) {
      if (role !== "receiver" || self.phase !== "offer" || !s) return false;
      sink = s;
      set("receiving");
      send({ t: "go" });
      return true;
    };
    this.decline = function () {
      if (role !== "receiver" || self.phase !== "offer") return;
      send({ t: "no" }).then(function () { fail("declined"); });
    };
    this.cancel = function () {
      if (ended) return;
      var say = (mode === "direct" && dcOpen()) ? send({ t: "x" }) : (keys && ws ? roomSend({ t: "x" }) : Promise.resolve());
      Promise.resolve(say).catch(function () {}).then(function () { fail("cancelled"); });
    };
    this.offer = function () { return offer; };
    this.mode = function () { return mode; };
  }

  var api = { VERSION: "1.2.0", Transfer: Transfer, wsUrl: wsUrl, RELAY: RELAY, WINDOW: WINDOW,
    RELAY_MAX: RELAY_MAX, RELAY_PIECE: RELAY_PIECE };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrosTransferEngine = api;
})(typeof window !== "undefined" ? window : globalThis);
