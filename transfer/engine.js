/* ============================================================
   orOS Transfer — engine.js, v1.0.0
   One transfer between two browsers: the sender, who has the files,
   and the receiver, who opened the link or typed the code.

   1. Meeting. Both open the same room on the orOS relay
      (relay/remote.js, /rt/<room>; the room id is a hash of the code).
      The relay passes sealed frames on and stores nothing. A room
      holds two sockets, so a transfer has one receiver.
   2. Direct link. The sender offers a WebRTC data channel; offer,
      answer and candidates go through the room, sealed. The file
      bytes go only over the data channel, never through a server
      (W1: when no direct link can be made, the transfer says so).
   3. The files. Over the channel the sender sends the list (sealed),
      the receiver looks and answers go or no; then every file in
      pieces of 60 KiB (core.js sealPiece: AES-GCM on top of WebRTC's
      own encryption), each file followed by its SHA-256. The receiver
      checks the order of every piece, the size and the hash of every
      file, and tells which files did not arrive whole.
   4. Pace. The receiver acknowledges what it has written; the sender
      never has more than WINDOW pieces unacknowledged and waits while
      the channel's buffer is full, so neither side holds a big file
      in memory.

   new OrosTransferEngine.Transfer({
     role: "sender"|"receiver", code, relay?, dev,
     WebSocket?, RTCPeerConnection?, iceServers?,
     files (sender: manifest from core.buildManifest),
     read(i, start, end) → Promise<Uint8Array> (sender),
     onState(phase, info), onProgress({ bytes, total, file })
   }).start(), .accept(sink) (receiver), .decline(), .cancel()
   sink = { open(i, f) → Promise, write(i, bytes) → Promise, close(i, ok) → Promise }
   Phases, sender:   connecting → wait → linking → offered → sending → done {bad}
           receiver: connecting → [wait] → linking → offer {files,total,biggest,dev} → receiving → done {bad}
           either:   error {e}  e ∈ noroom, left, nodirect, declined, cancelled, lost, bad, version, nocrypto, io
   ============================================================ */
(function (root) {
  "use strict";

  var CORE = root.OrosTransferCore || (typeof require === "function" ? require("./core.js") : null);
  var RELAY = "https://oros-mail-relay.koulaxizis.workers.dev";
  var ICE = [{ urls: "stun:stun.cloudflare.com:3478" }];
  var WINDOW = 256;                 // pieces sent but not yet written on the other side (~15 MB)
  var ACK_EVERY = 32;
  var READ_PIECES = 16;             // the sender reads ~1 MB of a file at a time
  var BUF_HIGH = 8 * 1048576, BUF_LOW = 1048576;
  var LINK_MS = 25000;              // a direct link must open within this
  var PING_MS = 20000;

  function wsUrl(relay, room) { return String(relay).replace(/^http(s?):/, "ws$1:").replace(/\/+$/, "") + "/rt/" + room; }

  function Transfer(o) {
    var self = this;
    var role = o.role === "receiver" ? "receiver" : "sender", other = role === "sender" ? "receiver" : "sender";
    var WS = o.WebSocket || root.WebSocket, RTC = o.RTCPeerConnection || root.RTCPeerConnection;
    var keys = null, ws = null, pc = null, dc = null, ended = false, opened = false, tries = 0;
    var saidHi = false, linkTimer = 0, pingTimer = 0;
    var sendQ = Promise.resolve(), inQ = Promise.resolve(), dcQ = Promise.resolve();
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
    function progress(p) { if (o.onProgress) { try { o.onProgress(p); } catch (e) {} } }

    // ----- the room -----
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
      w.onopen = function () { gotOpen = true; opened = true; tries = 0; };
      w.onmessage = function (e) { if (w === ws) onRoom(e.data); };
      w.onerror = function () {};
      w.onclose = function () {
        if (w !== ws) return;
        ws = null;
        if (ended || (dc && dc.readyState === "open")) return;    // the direct link carries on
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
        inQ = inQ.then(function () {
          if (ended || !sys) return;
          if (sys === "wait") { if (!dcOpen()) set("wait"); }
          else if (sys === "peer") hello();
          else if (sys === "left") {
            if (dcOpen()) return;
            dropRtc();
            saidHi = false;
            if (role === "receiver") fail("left");
            else set("wait");                                    // a new receiver may still come
          }
        });
        return;
      }
      inQ = inQ.then(function () { return CORE.unseal(keys.key, other, data); }).then(function (m) {
        if (!m || ended) return;
        if (m.t === "hi") {
          if (m.v !== CORE.PROTO) { fail("version"); return; }
          hello();
          set("linking", { dev: CORE.cleanDev(m.dev) });
          if (role === "sender") startRtc();
        } else if (m.t === "sdp" && m.d && typeof m.d.sdp === "string") onSdp(m.d);
        else if (m.t === "ice" && m.d && pc) pc.addIceCandidate(m.d).catch(function () {});
        else if (m.t === "x") fail("cancelled");
      });
    }
    function dcOpen() { return !!(dc && dc.readyState === "open"); }

    // ----- the direct link -----
    function newPc() {
      var p = new RTC({ iceServers: o.iceServers || ICE });
      p.onicecandidate = function (e) {
        if (e.candidate) roomSend({ t: "ice", d: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate });
      };
      p.onconnectionstatechange = function () {
        if (p !== pc) return;
        if (p.connectionState === "failed") { if (self.phase === "sending" || self.phase === "receiving" || self.phase === "offer" || self.phase === "offered") fail("lost"); else noDirect(); }
      };
      return p;
    }
    function armLinkTimer() {
      clearTimeout(linkTimer);
      linkTimer = setTimeout(function () { if (!dcOpen()) noDirect(); }, LINK_MS);
    }
    function noDirect() { if (!ended && !dcOpen()) fail("nodirect"); }
    function startRtc() {
      if (typeof RTC !== "function") { fail("nodirect"); return; }
      dropRtc();
      pc = newPc();
      dc = pc.createDataChannel("oros-transfer", { ordered: true });
      wireDc(dc);
      pc.createOffer().then(function (d) { return pc.setLocalDescription(d); }).then(function () {
        roomSend({ t: "sdp", d: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
      }).catch(noDirect);
      armLinkTimer();
    }
    function onSdp(d) {
      if (typeof RTC !== "function") { fail("nodirect"); return; }
      if (d.type === "offer" && role === "receiver") {
        dropRtc();
        pc = newPc();
        pc.ondatachannel = function (e) { dc = e.channel; wireDc(dc); };
        pc.setRemoteDescription(d).then(function () { return pc.createAnswer(); })
          .then(function (a) { return pc.setLocalDescription(a); })
          .then(function () { roomSend({ t: "sdp", d: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } }); })
          .catch(noDirect);
        armLinkTimer();
      } else if (d.type === "answer" && role === "sender" && pc) {
        pc.setRemoteDescription(d).catch(noDirect);
      }
    }
    function wireDc(ch) {
      ch.binaryType = "arraybuffer";
      try { ch.bufferedAmountLowThreshold = BUF_LOW; } catch (e) {}
      ch.onopen = function () {
        if (ch !== dc) return;
        clearTimeout(linkTimer);
        if (role === "sender") offerFiles();
      };
      ch.onclose = function () {
        if (ch !== dc || ended) return;
        fail(self.phase === "linking" ? "nodirect" : "lost");
      };
      ch.onbufferedamountlow = function () { var w = bufWaiters; bufWaiters = []; w.forEach(function (f) { f(); }); };
      ch.onmessage = function (e) {
        if (ch !== dc || ended) return;
        var d = e.data;
        if (typeof d === "string") {
          dcQ = dcQ.then(function () { return CORE.unseal(keys.key, other, d); }).then(function (m) { if (m && !ended) return onCtrl(m); })
            .catch(function (err) { fail(err && err.code === "io" ? "io" : "bad"); });
        } else if (role === "receiver") {
          dcQ = dcQ.then(function () { return onPiece(d); }).catch(function (err) { fail(err && err.code === "io" ? "io" : "bad"); });
        }
      };
    }
    function dcSend(obj) {
      return CORE.seal(keys.key, role, obj).then(function (txt) {
        if (dcOpen()) dc.send(txt);
      });
    }
    var bufWaiters = [];
    function roomInBuffer() {
      if (!dc || dc.bufferedAmount <= BUF_HIGH) return Promise.resolve();
      return new Promise(function (res) {
        bufWaiters.push(res);
        // some browsers miss the event while the channel closes
        setTimeout(res, 2000);
      }).then(roomInBuffer);
    }
    function dropRtc() {
      clearTimeout(linkTimer);
      var p = pc, d = dc;
      pc = null; dc = null;
      try { if (d) d.close(); } catch (e) {}
      try { if (p) p.close(); } catch (e) {}
    }

    // ----- the sender -----
    var files = role === "sender" ? (o.files || []) : [], total = 0, acked = 0, ackedBytes = 0, ackWaiters = [];
    files.forEach(function (f) { total += f.s; });
    function offerFiles() {
      set("offered");
      var parts = CORE.splitManifest(files);
      var q = Promise.resolve();
      parts.forEach(function (p, i) {
        q = q.then(function () { return dcSend({ t: "man", i: i, n: parts.length, files: p, total: total }); });
      });
    }
    function waitWindow(sent) {
      if (sent - acked < WINDOW || ended) return Promise.resolve();
      return new Promise(function (res) { ackWaiters.push(res); }).then(function () { return waitWindow(sent); });
    }
    function sendAll() {
      set("sending");
      var sent = 0, i = 0;
      function nextFile() {
        if (ended) return null;
        if (i >= files.length) return dcSend({ t: "fin" });
        var f = files[i], fi = i, h = new CORE.Sha256(), n = 0, pos = 0;
        function block() {
          if (ended) return null;
          if (pos >= f.s) {
            return dcSend({ t: "end", i: fi, h: h.hex(), s: f.s }).then(function () { i++; return nextFile(); });
          }
          var end = Math.min(f.s, pos + READ_PIECES * CORE.PIECE);
          return Promise.resolve(o.read(fi, pos, end)).then(function (bytes) {
            if (!bytes || bytes.length !== end - pos) { var er = new Error("read"); er.code = "io"; throw er; }
            h.update(bytes);
            var q = Promise.resolve();
            for (var off = 0; off < bytes.length; off += CORE.PIECE) {
              (function (part) {
                q = q.then(function () { return waitWindow(sent); }).then(roomInBuffer).then(function () {
                  if (ended) return null;
                  return CORE.sealPiece(keys.key, fi, n++, part).then(function (buf) {
                    if (!dcOpen()) { var er = new Error("lost"); er.code = "lost"; throw er; }
                    dc.send(buf);
                    sent++;
                  });
                });
              })(bytes.subarray(off, Math.min(bytes.length, off + CORE.PIECE)));
            }
            pos = end;
            return q.then(block);
          });
        }
        return block();
      }
      Promise.resolve().then(nextFile).catch(function (err) { fail(err && err.code === "lost" ? "lost" : "io"); });
    }

    // ----- the receiver -----
    var manParts = [], manN = 0, offer = null, sink = null, cur = -1, curN = 0, curBytes = 0, curHash = null, curOpen = false;
    var written = 0, writtenBytes = 0, bad = [], doneFiles = 0;
    function onCtrl(m) {
      if (role === "sender") {
        if (m.t === "go" && self.phase === "offered") sendAll();
        else if (m.t === "no") fail("declined");
        else if (m.t === "ack") {
          if (+m.n > acked) { acked = +m.n; ackedBytes = +m.b || ackedBytes; }
          progress({ bytes: ackedBytes, total: total, file: +m.f || 0 });
          var w = ackWaiters; ackWaiters = []; w.forEach(function (f) { f(); });
        } else if (m.t === "done") {
          var b = Array.isArray(m.bad) ? m.bad.filter(function (x) { return x >= 0 && x < files.length; }) : [];
          progress({ bytes: total, total: total, file: files.length });
          set("done", { bad: b });
        } else if (m.t === "x") fail("cancelled");
        return;
      }
      // receiver
      if (m.t === "man" && !offer) {
        if (!(m.n >= 1 && m.n <= 1000) || !(m.i >= 0 && m.i < m.n) || !Array.isArray(m.files)) { refuse(); return; }
        manN = m.n;
        manParts[m.i] = m.files;
        for (var k = 0; k < manN; k++) if (!manParts[k]) return;
        var all = [].concat.apply([], manParts);
        var ok = CORE.checkManifest(all);
        if (!ok) { refuse(); return; }
        offer = ok;
        set("offer", { files: ok.files, total: ok.total, biggest: ok.biggest });
      } else if (m.t === "end") {
        return endFile(m);                     // in order with the pieces (same queue)
      } else if (m.t === "fin") {
        if (self.phase !== "receiving" || doneFiles !== offer.files.length) throw new Error("bad");
        return dcSend({ t: "done", bad: bad }).then(function () { set("done", { bad: bad.slice() }); });
      } else if (m.t === "x") fail("cancelled");
    }
    function refuse() { dcSend({ t: "no" }); fail("bad"); }
    function ioErr(e) { var er = new Error("io"); er.code = "io"; er.cause = e; throw er; }
    function startFile(i) {
      if (i !== doneFiles || !offer || i >= offer.files.length) throw new Error("bad");
      cur = i; curN = 0; curBytes = 0; curHash = new CORE.Sha256(); curOpen = true;
      return Promise.resolve(sink.open(i, offer.files[i])).catch(ioErr);
    }
    function onPiece(buf) {
      if (self.phase !== "receiving" || !sink) throw new Error("bad");
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
          if (written % ACK_EVERY === 0) dcSend({ t: "ack", n: written, b: writtenBytes, f: cur });
        });
      });
    }
    function endFile(m) {
      if (self.phase !== "receiving") throw new Error("bad");
      var start = (!curOpen || m.i !== cur) ? startFile(m.i) : Promise.resolve();    // an empty file has no pieces
      return start.then(function () {
        var f = offer.files[cur];
        var whole = curBytes === f.s && typeof m.h === "string" && curHash.hex() === m.h;
        if (!whole) bad.push(cur);
        curOpen = false;
        doneFiles++;
        return Promise.resolve(sink.close(cur, whole)).catch(ioErr);
      }).then(function () {
        dcSend({ t: "ack", n: written, b: writtenBytes, f: cur });
      });
    }

    // ----- both -----
    function shutdown() {
      clearInterval(pingTimer);
      clearTimeout(linkTimer);
      var w = ws;
      // let the last sealed words go out first
      Promise.all([sendQ, dcQ]).then(function () {
        setTimeout(function () {
          dropRtc();
          ws = null;
          try { if (w) w.close(1000, "bye"); } catch (e) {}
        }, 300);
      });
      var a = ackWaiters; ackWaiters = []; a.forEach(function (f) { f(); });
    }

    this.start = function () {
      set("connecting");
      if (!CORE || !root.crypto && !(typeof require === "function")) { fail("nocrypto"); return self; }
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
      dcSend({ t: "go" });
      return true;
    };
    this.decline = function () {
      if (role !== "receiver" || self.phase !== "offer") return;
      dcSend({ t: "no" }).then(function () { fail("declined"); });
    };
    this.cancel = function () {
      if (ended) return;
      var say = dcOpen() ? dcSend({ t: "x" }) : (keys && ws ? roomSend({ t: "x" }) : Promise.resolve());
      Promise.resolve(say).catch(function () {}).then(function () { fail("cancelled"); });
    };
    this.offer = function () { return offer; };
  }

  var api = { VERSION: "1.0.0", Transfer: Transfer, wsUrl: wsUrl, RELAY: RELAY, WINDOW: WINDOW };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrosTransferEngine = api;
})(typeof window !== "undefined" ? window : globalThis);
