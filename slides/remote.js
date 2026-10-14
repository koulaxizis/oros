// ============================================================
// orOS Slides — remote.js: control a presentation from a phone (v1.0.0)
// The device that presents is the host: in the show, "Phone" opens a
// dialog with a 6-digit code, a QR code and a link. A phone opens orOS
// › Slides › Phone remote (or the link / QR), enters the code, and the
// person at the host lets it in ("Allow"). From then on the phone has
// Next / Previous, black and white screen, first slide, the slide
// number, builds left, the time and the speaker notes.
// Pairing and the link are the shared remote-link.js (OrosRemoteLink,
// as Time › Stage uses it): a relay room that only passes sealed
// frames, then a direct WebRTC channel on the same Wi-Fi.
// The phone writes nothing to the deck; the host checks every command
// (cmd) and the phone every snapshot (adopt) before using it.
// Device-local (never synced):
//   oros-slides-remote-host  (host) the paired phone: code, id, kind
//   oros-slides-remote-join  (phone) the code and id it joined with
// Pure parts (cmd, snapshot, adopt) are on OrosSlidesRemote for the
// tests; the rest needs the DOM and SL.
// ============================================================
(function (root) {
  "use strict";

  var NS = "oros-slides-remote";
  var ACTS = ["next", "prev", "first", "black", "white"];
  var MAX_NOTES = 5000, MAX_TITLE = 200;

  // ---------- 1. Pure: messages ----------
  function str(v, max) { return typeof v === "string" ? v.slice(0, max) : ""; }
  function int(v, lo, hi) { v = Math.floor(Number(v)); return isFinite(v) ? Math.max(lo, Math.min(hi, v)) : lo; }
  // phone -> host: only these, nothing else
  function cmd(m) {
    if (!m || typeof m !== "object" || typeof m.t !== "string") return null;
    if (m.t === "hi" || m.t === "leave") return { t: m.t };
    if (m.t === "a" && ACTS.indexOf(m.a) >= 0) return { t: "a", a: m.a };
    return null;
  }
  // host -> phone: what the show is doing. st: show.js state(),
  // slides: [{ title, notes }] in deck order.
  function snapshot(st, slides) {
    if (!st || st.closed || !slides) return { t: "st", on: false };
    var i = st.index, cur = i >= 0 ? slides[i] : null, next = null;
    for (var k = i + 1; k < slides.length && !next; k++) if (!slides[k].hid) next = slides[k];
    return {
      t: "st", on: true, end: !!st.atEnd || i < 0,
      n: (st.pos || 0) + 1, c: st.visible || 0,
      left: Math.max(0, (st.steps || 0) - (st.step || 0)),
      blank: st.blank === "b" || st.blank === "w" ? st.blank : "",
      title: cur ? str(cur.title, MAX_TITLE) : "",
      notes: cur ? str(cur.notes, MAX_NOTES) : "",
      next: next ? str(next.title, MAX_TITLE) : "",
      el: Math.max(0, Math.round(st.el || 0)), paused: !!st.paused
    };
  }
  function adopt(m) {
    if (!m || m.t !== "st") return null;
    if (m.on !== true) return { on: false };
    return {
      on: true, end: m.end === true,
      n: int(m.n, 0, 100000), c: int(m.c, 0, 100000), left: int(m.left, 0, 10000),
      blank: m.blank === "b" || m.blank === "w" ? m.blank : "",
      title: str(m.title, MAX_TITLE), notes: str(m.notes, MAX_NOTES), next: str(m.next, MAX_TITLE),
      el: int(m.el, 0, 1e9), paused: m.paused === true
    };
  }
  var API = root.OrosSlidesRemote = { NS: NS, ACTS: ACTS, cmd: cmd, snapshot: snapshot, adopt: adopt };

  // ---------- 2. DOM ----------
  if (typeof document === "undefined" || !root.SL || !root.OrosRemoteLink) return;
  var SL = root.SL, L = root.OrosRemoteLink, t = SL.t, $ = SL.$, el = SL.el;
  var HOST_KEY = "oros-slides-remote-host", JOIN_KEY = "oros-slides-remote-join";
  var KEEP_MS = 3 * 24 * 3600 * 1000, RID_RE = /^[0-9a-f]{32}$/;

  function readJSON(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function writeJSON(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function live(link) { return !!(link && (link.state === "relay" || link.state === "direct")); }
  function devName(kind) { return t("rm.dev." + (kind === "phone" || kind === "tablet" ? kind : "computer")); }
  function spaced(code) { return code.slice(0, 3) + " " + code.slice(3); }
  function stateText(s) {
    if (s === "direct") return t("rm.s.direct");
    if (s === "relay") return t("rm.s.relay");
    if (s === "closed") return t("rm.s.closed");
    if (s === "nocrypto") return t("rm.s.nocrypto");
    return t("rm.s.connecting");
  }
  function drawQr(cv, text) {
    var g = cv.getContext && cv.getContext("2d"), Q = root.orosQR, mods = null;
    if (text && Q && g) { try { mods = Q.encode(text, { ecl: "M" }).modules; } catch (e) { mods = null; } }
    cv.hidden = !mods;
    if (!mods) return;
    var n = mods.length, q = 4, px = Math.max(2, Math.floor(200 / (n + 2 * q)));
    cv.width = cv.height = px * (n + 2 * q);
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, cv.width, cv.height);
    g.fillStyle = "#000000";
    for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) if (mods[y][x]) g.fillRect((x + q) * px, (y + q) * px, px, px);
  }
  function joinUrl(code) {
    var base = "";
    try { base = root.parent.location.origin + root.parent.location.pathname; } catch (e) {}
    if (!base) base = location.origin + "/";
    return base.replace(/\/index\.html$/, "/") + "?open=slides#slides-remote=" + code;
  }

  // ---------- 3. Host: the device that presents ----------
  var H = { link: null, code: "", rid: "", kind: "", answer: null, last: "", st: null, slides: null, dlg: null };
  function saveHost() { writeJSON(HOST_KEY, H.code ? { code: H.code, rid: H.rid, kind: H.kind, at: Date.now() } : null); }
  function hostStart(code, rid, kind) {
    hostStop(true);
    H.code = code; H.rid = rid || ""; H.kind = kind || "";
    H.link = new L.Link({
      role: "host", code: code, relay: L.relayUrl(), ns: NS, label: "slides", dev: L.deviceName(), allow: H.rid,
      admit: function (dev, answer) { askAllow(dev, answer); },
      onAllow: function (r) { H.rid = r; saveHost(); },
      onState: function () { if (live(H.link)) push(true); renderHost(); },
      onPeer: function (dev) {
        if (dev) H.kind = dev === "phone" || dev === "tablet" ? dev : "computer";
        saveHost();
        push(true);
        renderHost();
        if (SL.showCtl && !SL.showCtl.state().closed) SL.showCtl.toast(t("rm.joined"), 2500);
      },
      onGone: renderHost,
      onApp: onCommand
    });
    saveHost();
  }
  function hostStop(quiet) {
    if (H.answer) H.answer(false);
    var link = H.link;
    if (link) {
      if (live(link) && !quiet) link.send({ t: "off" });
      setTimeout(function () { try { link.close(); } catch (e) {} }, 150);
    }
    H.link = null; H.code = ""; H.rid = ""; H.kind = ""; H.last = "";
    if (!quiet) saveHost();
  }
  function push(force) {
    if (!live(H.link)) return;
    var s = snapshot(H.st, H.slides);
    var key = JSON.stringify(Object.assign({}, s, { el: 0 }));
    if (key === H.last && !force) return;
    H.last = key;
    H.link.send(s);
  }
  function onCommand(m) {
    var c = cmd(m);
    if (!c) return;
    if (c.t === "hi") { push(true); return; }
    if (c.t === "leave") { hostStop(false); renderHost(); return; }
    var ctl = SL.showCtl;
    if (!ctl || ctl.state().closed) { push(true); return; }
    ctl[c.a]();
  }
  function askAllow(dev, answer) {
    if (H.answer) H.answer(false);
    H.answer = function (yes) { H.answer = null; answer(yes); renderHost(); };
    H.askDev = dev;
    if (!H.dlg || !H.dlg.open) openHost();
    else renderHost();
  }
  // the dialog
  function openHost() {
    if (!H.link) hostStart(L.newCode(), "", "");
    SL.openDialog(t("rm.title"), function (body, close) {
      H.dlg = $("dlg");
      var box = el("div", "rm-host");
      body.appendChild(box);
      H.render = function () {
        box.innerHTML = "";
        var s = H.link ? H.link.state : "closed";
        var paired = !!H.rid;
        var st = el("p", "rm-st" + (live(H.link) ? " ok" : ""), paired || live(H.link) ? (H.kind ? devName(H.kind) + " · " : "") + (live(H.link) ? stateText(s) : t("rm.s.away")) :
          s === "waiting" ? t("rm.s.waiting", { code: spaced(H.code) }) : stateText(s));
        box.appendChild(st);
        if (H.answer) {
          var ask = el("div", "rm-ask");
          ask.appendChild(el("p", "", t("rm.ask", { dev: devName(H.askDev) })));
          var r = el("div", "pn-row");
          var yes = el("button", "btn primary", t("rm.allow")); yes.type = "button";
          var no = el("button", "btn", t("rm.deny")); no.type = "button";
          yes.addEventListener("click", function () { if (H.answer) H.answer(true); });
          no.addEventListener("click", function () { if (H.answer) H.answer(false); });
          r.appendChild(yes); r.appendChild(no);
          ask.appendChild(r);
          box.appendChild(ask);
          setTimeout(function () { try { yes.focus(); } catch (e) {} }, 0);
        } else if (!paired && H.code) {
          box.appendChild(el("p", "hint", t("rm.how")));
          var pair = el("div", "rm-pair");
          var cv = el("canvas", "rm-qr");
          cv.setAttribute("aria-hidden", "true");
          pair.appendChild(cv);
          var side = el("div", "rm-codebox");
          side.appendChild(el("span", "fld-lbl", t("rm.code")));
          side.appendChild(el("span", "rm-code", spaced(H.code)));
          side.appendChild(el("span", "rm-url", joinUrl(H.code)));
          pair.appendChild(side);
          box.appendChild(pair);
          drawQr(cv, joinUrl(H.code));
        }
        var act = el("div", "dlg-actions");
        if (paired) {
          var stop = el("button", "btn danger", t("rm.stop")); stop.type = "button";
          stop.addEventListener("click", function () { hostStop(false); close(); });
          act.appendChild(stop);
        }
        var cl = el("button", "btn", t("rm.close")); cl.type = "button";
        cl.addEventListener("click", close);
        act.appendChild(cl);
        box.appendChild(act);
      };
      H.render();
      H.dlg.addEventListener("close", function onClose() {
        H.dlg.removeEventListener("close", onClose);
        if (H.answer) H.answer(false);           // closing while a phone asks means no
        H.render = null;
        // a code nobody used is dropped with the dialog
        if (H.link && !H.rid && !live(H.link)) hostStop(false);
      });
    }, false);
  }
  function renderHost() { if (H.render && H.dlg && H.dlg.open) H.render(); }

  SL.remote = {
    host: openHost,
    // the show changed (show.js onChange): keep a snapshot for the phone
    showChanged: function (st, list, data) {
      H.st = st;
      H.slides = list.map(function (s, i) {
        return { title: SL.C.slideTitle(data, s.id) || t("slide.n", { n: i + 1 }), notes: data.slides[s.id] && data.slides[s.id].n || "", hid: !!s.hid };
      });
      if (st.closed) { H.st = null; H.slides = null; }
      push(false);
    }
  };

  // ---------- 4. Phone ----------
  var P = { link: null, st: null, at: 0, ov: null, timer: 0, wake: null, status: null };
  function joinStart(code, rid) {
    code = String(code || "").replace(/\D/g, "");
    if (!L.CODE_RE.test(code)) { setJoinStatus(t("rm.s.bad")); return; }
    joinStop(true);
    P.link = new L.Link({
      role: "remote", code: code, relay: L.relayUrl(), ns: NS, label: "slides", dev: L.deviceName(), rid: rid,
      onState: function (s) {
        setJoinStatus(s === "waiting" ? t("rm.s.waitHost") : s === "pending" ? t("rm.s.pending") : stateText(s));
        renderPhone();
        if (live(P.link)) P.link.send({ t: "hi" });
      },
      onApp: onHostMsg,
      onDeny: function () {
        joinStop(true);
        writeJSON(JOIN_KEY, null);
        leaveOverlay();
        openJoin("", t("rm.s.denied"));
      },
      onGone: renderPhone
    });
    writeJSON(JOIN_KEY, { code: code, rid: P.link.rid(), at: Date.now() });
    setJoinStatus(t("rm.s.connecting"));
  }
  function joinStop(quiet) {
    if (P.link) { try { P.link.close(); } catch (e) {} }
    P.link = null; P.st = null;
    if (!quiet) { writeJSON(JOIN_KEY, null); leaveOverlay(); }
  }
  function send(c) { if (P.link) P.link.send(c); }
  function onHostMsg(m) {
    if (!m || typeof m.t !== "string") return;
    if (m.t === "st") {
      var a = adopt(m);
      if (!a) return;
      P.st = a; P.at = Date.now();
      var d = $("dlg");
      if (d.open && P.joining) d.close();
      enterOverlay();
      renderPhone();
    } else if (m.t === "off") {
      joinStop(false);
      openJoin("", t("rm.s.off"));
    }
  }
  function setJoinStatus(s) { if (P.status) P.status.textContent = s; }
  function openJoin(code, msg) {
    SL.openDialog(t("rm.join.h"), function (body, close) {
      P.joining = true;
      body.appendChild(el("p", "hint", t("rm.join.hint")));
      var inp = el("input", "inp rm-code-inp");
      inp.type = "text"; inp.inputMode = "numeric"; inp.autocomplete = "off"; inp.maxLength = 7;
      inp.placeholder = "000 000"; inp.value = code ? spaced(code) : "";
      inp.setAttribute("aria-label", t("rm.code"));
      var f = el("label", "fld"); f.appendChild(el("span", "fld-lbl", t("rm.code"))); f.appendChild(inp);
      body.appendChild(f);
      P.status = el("p", "hint rm-st", msg || "");
      body.appendChild(P.status);
      var act = el("div", "dlg-actions");
      var c = el("button", "btn", t("btn.cancel")); c.type = "button";
      var go = el("button", "btn primary", t("rm.connect")); go.type = "button";
      c.addEventListener("click", close);
      go.addEventListener("click", function () { joinStart(inp.value, ""); });
      inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); joinStart(inp.value, ""); } });
      act.appendChild(c); act.appendChild(go);
      body.appendChild(act);
      var d = $("dlg");
      d.addEventListener("close", function onClose() {
        d.removeEventListener("close", onClose);
        P.joining = false; P.status = null;
        if (P.link && !P.st) joinStop(false);    // gave up before the host answered
      });
      if (code && L.CODE_RE.test(code)) joinStart(code, "");
    });
  }

  // the overlay with the buttons and the notes
  function button(parent, cls, label, fn) {
    var b = el("button", "btn " + cls, label);
    b.type = "button";
    b.addEventListener("click", fn);
    parent.appendChild(b);
    return b;
  }
  function enterOverlay() {
    if (P.ov) return;
    var ov = P.ov = el("div", "rm-dev");
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-label", t("home.remote"));
    var top = el("div", "rm-top");
    P.badge = el("span", "rm-badge");
    top.appendChild(P.badge);
    top.appendChild(el("span", "spacer"));
    button(top, "ghost small", t("rm.leave"), function () { send({ t: "leave" }); setTimeout(function () { joinStop(false); }, 150); });
    ov.appendChild(top);
    var info = el("div", "rm-info");
    P.count = el("div", "rm-count"); P.clock = el("div", "rm-clock");
    info.appendChild(P.count); info.appendChild(P.clock);
    ov.appendChild(info);
    P.builds = el("div", "rm-builds");
    P.title = el("div", "rm-title");
    P.next = el("div", "rm-next");
    ov.appendChild(P.title); ov.appendChild(P.builds); ov.appendChild(P.next);
    ov.appendChild(el("div", "rm-notes-h", t("rm.notes")));
    P.notes = el("div", "rm-notes");
    ov.appendChild(P.notes);
    var ctl = el("div", "rm-ctl");
    P.prev = button(ctl, "rm-prev", t("rm.prev"), function () { send({ t: "a", a: "prev" }); });
    P.nextBtn = button(ctl, "primary rm-nextb", t("rm.next"), function () { send({ t: "a", a: "next" }); });
    ov.appendChild(ctl);
    var ctl2 = el("div", "rm-ctl2");
    P.black = button(ctl2, "small", t("rm.black"), function () { send({ t: "a", a: "black" }); });
    P.white = button(ctl2, "small", t("rm.white"), function () { send({ t: "a", a: "white" }); });
    button(ctl2, "small", t("rm.first"), function () { send({ t: "a", a: "first" }); });
    ov.appendChild(ctl2);
    document.body.appendChild(ov);
    document.body.classList.add("rm-on");
    try { if (navigator.wakeLock) navigator.wakeLock.request("screen").then(function (w) { P.wake = w; }, function () {}); } catch (e) {}
    clearInterval(P.timer);
    P.timer = setInterval(tickClock, 1000);
  }
  function leaveOverlay() {
    if (!P.ov) return;
    if (P.ov.parentNode) P.ov.parentNode.removeChild(P.ov);
    P.ov = null;
    document.body.classList.remove("rm-on");
    clearInterval(P.timer); P.timer = 0;
    try { if (P.wake) P.wake.release().catch(function () {}); } catch (e) {}
    P.wake = null;
  }
  function fmt(ms) {
    var s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
    s = s % 60;
    return (h ? h + ":" + (m < 10 ? "0" : "") : "") + m + ":" + (s < 10 ? "0" : "") + s;
  }
  function tickClock() {
    if (!P.ov || !P.st) return;
    P.clock.textContent = P.st.on ? fmt(P.st.el + (P.st.paused ? 0 : Date.now() - P.at)) : "";
  }
  function renderPhone() {
    if (!P.ov) return;
    var s = P.link ? P.link.state : "closed";
    P.badge.textContent = live(P.link) ? stateText(s) : t("rm.s.away");
    P.badge.className = "rm-badge " + (s === "direct" ? "ok" : s === "relay" ? "via" : "lost");
    var st = P.st || { on: false };
    P.ov.classList.toggle("idle", !st.on);
    if (!st.on) {
      P.count.textContent = "";
      P.title.textContent = t("rm.idle");
      P.builds.textContent = ""; P.next.textContent = ""; P.notes.textContent = "";
    } else {
      P.count.textContent = st.end ? t("rm.end") : t("rm.slide", { n: st.n, t: st.c });
      P.title.textContent = st.end ? "" : st.title;
      P.builds.textContent = st.left > 1 ? t("rm.builds", { n: st.left }) : st.left === 1 ? t("rm.build1") : "";
      P.next.textContent = st.next && !st.end ? t("rm.nextUp", { t: st.next }) : "";
      P.notes.textContent = st.end ? "" : st.notes || t("rm.noNotes");
    }
    P.black.textContent = st.blank === "b" ? t("rm.back") : t("rm.black");
    P.white.textContent = st.blank === "w" ? t("rm.back") : t("rm.white");
    P.black.classList.toggle("on", st.blank === "b");
    P.white.classList.toggle("on", st.blank === "w");
    [P.prev, P.nextBtn, P.black, P.white].forEach(function (b) { b.disabled = !st.on || !live(P.link); });
    tickClock();
  }
  // keys on the phone (a keyboard or a clicker paired with it)
  window.addEventListener("keydown", function (e) {
    if (!P.ov || e.ctrlKey || e.metaKey || e.altKey || $("dlg").open) return;
    var k = e.key, a = null;
    if (k === "ArrowRight" || k === "PageDown" || k === " " || k === "ArrowDown") a = "next";
    else if (k === "ArrowLeft" || k === "PageUp" || k === "ArrowUp") a = "prev";
    else if (k === "b" || k === "B" || k === ".") a = "black";
    else if (k === "w" || k === "W" || k === ",") a = "white";
    else if (k === "Home") a = "first";
    if (!a) return;
    e.preventDefault(); e.stopPropagation();
    send({ t: "a", a: a });
  }, true);

  // ---------- 5. Boot ----------
  SL.on("boot", function () {
    var b = $("btn-remote");
    if (b) {
      SL.setIcon(b, "phone", t("home.remote"));
      b.addEventListener("click", function () { openJoin("", ""); });
    }
    var now = Date.now();
    // host: the phone paired before a reload comes back by itself
    var h = readJSON(HOST_KEY);
    if (h && typeof h.code === "string" && L.CODE_RE.test(h.code) && typeof h.rid === "string" && RID_RE.test(h.rid) && h.at > now - KEEP_MS) {
      hostStart(h.code, h.rid, h.kind);
    } else writeJSON(HOST_KEY, null);
    // phone: a QR scanned opens "?open=slides#slides-remote=<code>";
    // a reload rejoins with the code and id it had
    var code = "";
    try {
      var hs = root.parent.location.hash || "", mm = hs.match(/^#slides-remote=([0-9]{6})$/);
      if (mm) {
        code = mm[1];
        root.parent.history.replaceState(null, "", root.parent.location.pathname + root.parent.location.search);
      }
    } catch (e) {}
    var j = readJSON(JOIN_KEY);
    if (code) openJoin(code, "");
    else if (j && typeof j.code === "string" && L.CODE_RE.test(j.code) && typeof j.rid === "string" && RID_RE.test(j.rid) && j.at > now - KEEP_MS) {
      joinStart(j.code, j.rid);
    }
  });
  // keep the "last used" stamps fresh while paired
  setInterval(function () {
    if (H.link && H.rid && live(H.link)) saveHost();
    if (P.link && live(P.link)) { var j = readJSON(JOIN_KEY); if (j) { j.at = Date.now(); writeJSON(JOIN_KEY, j); } }
    push(false);
  }, 30000);
  void API;
})(typeof window !== "undefined" ? window : this);
