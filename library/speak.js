// ============================================================
// orOS Library — read aloud (v1.1.0)
// Reads the book from the page on screen with the device's own voices
// (speechSynthesis; nothing leaves the device). The text is spoken one
// short part at a time (core.speechParts); the part being read is
// marked in the book and the page follows it, so the place read moves
// on as it is heard. Pause keeps the part; play again resumes there,
// or from the page on screen if you turned pages meanwhile.
// Engine hooks (epub.js, pdfview.js):
//   speechStart() → { s, o, n }   section + offset on screen, sections
//   speechSection(s) → Promise({ text, breaks, lang })
//   speakMark(s, a, b)            mark a part (s null: clear)
//   speakAt(s, o)                 optional: the voice reached o
// Rate is a device-local preference (LIB.prefs.rate).
// ============================================================
(function () {
  "use strict";

  var LIB = window.LIB, C = LIB.C, t = LIB.t, el = LIB.el, $ = LIB.$;
  var RATES = [0.8, 1, 1.2, 1.4, 1.6, 2];
  var synth = window.speechSynthesis || null;
  // st: { c (reader), s, parts, k, text, lang, playing, gen, spoken, empty }
  var st = null, gen = 0, bar = null;

  function available() { return !!(synth && typeof window.SpeechSynthesisUtterance === "function"); }

  // ---------- Voice ----------
  function voiceFor(lang) {
    if (!synth || !lang) return null;
    var base = lang.toLowerCase().split("-")[0];
    var list = synth.getVoices() || [], best = null, score = -1;
    list.forEach(function (v) {
      var vl = String(v.lang || "").toLowerCase().replace("_", "-");
      if (vl.split("-")[0] !== base) return;
      var sc = (v.localService ? 4 : 0) + (vl === lang.toLowerCase() ? 2 : 0) + (v["default"] ? 1 : 0);
      if (sc > score) { score = sc; best = v; }
    });
    return best;
  }
  function langOf(c, sec) {
    var l = (c.book.lang || sec.lang || "").trim();
    if (!l) l = C.guessLang(sec.text) || LIB.LANG;
    return l;
  }

  // ---------- Playback ----------
  function start() {
    var c = LIB.reader.current();
    if (!c || !c.ready) return;
    if (!available()) { LIB.toast(t("speak.none")); return; }
    if (st && st.c === c) {
      if (st.playing) return;
      // resume the part kept on pause, unless the page moved away from it
      var p = st.parts[st.k];
      if (p && c.engine.visible(locOf(st, p.a))) { st.playing = true; draw(); speak(); return; }
    }
    stop(true);
    var at = c.engine.speechStart();
    if (!at) return;
    st = { c: c, s: at.s, n: at.n, parts: [], k: 0, text: "", lang: "", playing: true, gen: ++gen, spoken: 0, empty: 0 };
    draw();
    load(at.s, at.o);
  }
  function locOf(s, o) { return C.makeLoc(s.c.book.fmt === "pdf" ? "p" : "e", s.c.book.fmt === "pdf" ? s.s + 1 : s.s, o); }
  // A section's parts; from: start with the part that holds this offset.
  function load(si, from) {
    var my = st.gen;
    st.c.engine.speechSection(si).then(function (sec) {
      if (!st || st.gen !== my) return;
      st.s = si;
      st.text = sec.text || "";
      if (!st.lang) st.lang = langOf(st.c, sec);
      st.parts = C.speechParts(st.text, sec.breaks, st.lang.split("-")[0]);
      st.k = 0;
      if (from > 0) {
        while (st.k < st.parts.length && st.parts[st.k].b <= from) st.k++;
      }
      if (!st.parts.length) st.empty++; else st.empty = 0;
      if (st.playing) speak();
    }, function () {
      if (st && st.gen === my) nextSection();
    });
  }
  function nextSection() {
    if (st.s + 1 < st.n && st.empty < 40) { load(st.s + 1, 0); return; }
    var none = !st.spoken;
    stop();
    LIB.toast(t(none ? "speak.noText" : "speak.end"));
  }
  function speak() {
    if (!st || !st.playing) return;
    if (st.k >= st.parts.length) { nextSection(); return; }
    var p = st.parts[st.k], my = st.gen, k = st.k;
    var u = new window.SpeechSynthesisUtterance(C.speechText(st.text.slice(p.a, p.b)));
    u.lang = st.lang;
    var v = voiceFor(st.lang);
    if (v) u.voice = v;
    u.rate = LIB.prefs.rate || 1;
    u.onend = function () {
      if (!st || st.gen !== my || st.k !== k || !st.playing) return;
      st.spoken++;
      st.k++;
      speak();
    };
    // word boundaries (where the voice reports them) let the page turn
    // mid-part; the spoken string is squashed, so the place is scaled
    u.onboundary = function (e) {
      if (!st || st.gen !== my || st.k !== k || !st.c.engine.speakAt || !(e && e.charIndex >= 0)) return;
      var len = u.text.length || 1;
      st.c.engine.speakAt(st.s, p.a + Math.floor(e.charIndex / len * (p.b - p.a)));
    };
    u.onerror = function (e) {
      if (!st || st.gen !== my || st.k !== k) return;
      var why = e && e.error;
      if (why === "interrupted" || why === "canceled") return;     // our own cancel()
      stop();
      LIB.toast(t("speak.fail"));
    };
    st.c.engine.speakMark(st.s, p.a, p.b);
    LIB.reader.touched();
    if (synth.speaking || synth.pending) synth.cancel();
    synth.speak(u);
  }
  // A pause is a cancel that keeps the part: a real pause() is not
  // reliable on Android, and resuming re-reads the part from its start.
  function pause() {
    if (!st || !st.playing) return;
    st.playing = false;
    st.gen = ++gen;
    synth.cancel();
    draw();
  }
  function stop(quiet) {
    if (!st) { hideBar(); return; }
    var c = st.c;
    st = null;
    gen++;
    try { synth.cancel(); } catch (e) {}
    try { c.engine.speakMark(null); } catch (e) {}
    hideBar();
    if (!quiet) LIB.reader.speakChanged(false);
  }
  function step(d) {
    if (!st) return;
    var k = st.k + d;
    if (k < 0) k = 0;
    st.gen = ++gen;
    if (k >= st.parts.length) { st.k = st.parts.length; if (st.playing) { synth.cancel(); nextSection(); } return; }
    st.k = k;
    if (st.playing) speak();
    else { st.c.engine.speakMark(st.s, st.parts[k].a, st.parts[k].b); }
  }
  function cycleRate() {
    var r = LIB.prefs.rate || 1, i = RATES.indexOf(r);
    LIB.prefs.rate = RATES[(i + 1) % RATES.length];
    LIB.savePrefs();
    draw();
    if (st && st.playing) { st.gen = ++gen; speak(); }
  }

  // ---------- The bar ----------
  function rateText() { return LIB.num(LIB.prefs.rate || 1) + "×"; }
  function draw() {
    if (!bar) {
      bar = el("div", "speak-bar");
      bar.id = "speak-bar";
      bar.setAttribute("role", "toolbar");
      bar.setAttribute("aria-label", t("speak.title"));
      document.body.appendChild(bar);
    }
    bar.textContent = "";
    var U = LIB.UI;
    bar.appendChild(LIB.btn("icon-btn", t("speak.prev"), U.skipBack, function () { step(-1); }));
    var play = st && st.playing;
    bar.appendChild(LIB.btn("icon-btn speak-main", t(play ? "speak.pause" : "speak.play"), play ? U.pause : U.play,
      function () { if (st && st.playing) pause(); else start(); }));
    bar.appendChild(LIB.btn("icon-btn", t("speak.next"), U.skipFwd, function () { step(1); }));
    var r = LIB.textBtn("chip speak-rate", rateText(), cycleRate);
    r.setAttribute("aria-label", t("speak.rate", { r: rateText() }));
    r.title = t("speak.rate", { r: rateText() });
    bar.appendChild(r);
    bar.appendChild(LIB.btn("icon-btn", t("speak.stop"), U.close, function () { stop(); }));
    bar.hidden = false;
    LIB.reader.speakChanged(true);
  }
  function hideBar() { if (bar) bar.hidden = true; }

  if (synth) { try { synth.getVoices(); } catch (e) {} }        // Chrome loads the list on first ask

  LIB.speak = {
    available: available,
    toggle: function () { if (st && st.playing) pause(); else start(); },
    start: start, pause: pause, stop: stop,
    active: function () { return !!st; },
    playing: function () { return !!(st && st.playing); }
  };
})();
