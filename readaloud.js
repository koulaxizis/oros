// ============================================================
// orOS — readaloud.js (Read aloud, shell component, v1.1.0) [READ-1]
// ------------------------------------------------------------
// Chris 2026-11-17 (big-OS ideas, item 4; plan
// /mnt/project-files/read-aloud/plan.md): text selected in any orOS
// app is read aloud with the voices installed on this device only
// (rule 30: speechSynthesis, only voices with localService === true;
// nothing leaves the device, never the browser's online voices).
//
//   • Off by default (Chris 23:24). Settings › Accessibility › Read
//     aloud turns it on for this device and sets the speed. The
//     switch and the speed live in shell.js (window.orosRead, the
//     facade, key oros-readaloud); this file is the engine and is
//     loaded only on the first read (not a start-up script: the boot
//     budget of the quality gate).
//   • Entry points (shell.js / quickmenu.js / qsettings.js):
//     Ctrl+Alt+Shift+Z (SC_DEFS id "read"; outside text fields, like
//     every shell shortcut, rule X5), the selection menu's "Read
//     aloud" (right-click on selected text, or the button under text
//     selected by touch or in a field: it opens without the Assistant
//     too while this is on, Chris 23:21), Quick settings › Read aloud.
//     The same key or pill stops it.
//   • Never: Passwords, password / one-time code fields, anything
//     inside data-oros-noclip (the Clipboard history rule), while
//     Sensitive work is on or the screen is locked. Turning Sensitive
//     work on or locking the screen stops a reading at once.
//   • The text is read one sentence at a time (speechParts, the same
//     cut as Library's read aloud); a bar at the top shows previous /
//     pause / next / speed / stop. At most MAX_TEXT characters.
//   • Language: the lang attribute around the selection (below the
//     page itself), else Greek when most letters are Greek, else
//     German when it reads like German, else English; no letters: the
//     orOS language. No local voice for it → a note, nothing is read.
//
//   • 1.1.0 (W2): the sentence being read is lit up in the app (CSS
//     Custom Highlight API: the app's DOM is never changed) and the
//     page scrolls to it; nothing selected → the app's main text is
//     read (not menus, buttons, fields, navigation or hidden parts;
//     Chris 23:29 "Ναι, στο W2"); a voice per language (en, el, de)
//     chosen in Settings › Accessibility, with Test (prefs vo).
//
// The pure part (section 1) is the same code as Library's
// library/core.js speechParts / localVoice / speechText / guessLang;
// tests/readaloud.test.js checks that both give the same results.
// Exposes window.orosReadEngine (browser) or module.exports (Node).
// i18n-inline-ok: the Greek letters in the regular expressions are data (sentence ends, letter ranges), not text to translate.
// ============================================================
(function (root) {
  "use strict";

  var VER = "1.1.0";
  var KEY = "oros-readaloud";
  var RATES = [0.8, 1, 1.2, 1.4, 1.6, 2];
  var MAX_TEXT = 20000;
  var SPEAK_MAX = 300;
  // Apps whose text is never read: Passwords (passwords, codes).
  var SKIP_APPS = { passwords: 1 };

  // ---------- 1. Model (pure) ----------
  // The stored switch: { v:1, on:1, rate } → { on, rate }; anything
  // else is off at 1×.
  // W2: vo = { <language>: voiceURI } for VOICE_LANGS, chosen in Settings.
  var VOICE_LANGS = ["en", "el", "de"];
  function cleanVo(vo) {
    var out = {};
    if (!vo || typeof vo !== "object" || Array.isArray(vo)) return out;
    VOICE_LANGS.forEach(function (l) {
      if (typeof vo[l] === "string" && vo[l] && vo[l].length <= 200) out[l] = vo[l];
    });
    return out;
  }
  function parsePrefs(raw) {
    var o = null;
    try { o = typeof raw === "string" ? JSON.parse(raw) : raw; } catch (e) { o = null; }
    var on = !!(o && typeof o === "object" && o.v === 1 && o.on === 1);
    var rate = o && typeof o === "object" ? o.rate : 1;
    return { on: on, rate: RATES.indexOf(rate) !== -1 ? rate : 1, vo: cleanVo(o && o.vo) };
  }
  function prefsRecord(p) {
    if (!p || !p.on) return null;                   // off = no key at all
    var r = { v: 1, on: 1, rate: RATES.indexOf(p.rate) !== -1 ? p.rate : 1 };
    var vo = cleanVo(p.vo);
    if (Object.keys(vo).length) r.vo = vo;
    return r;
  }

  // A text cut into parts to speak: sentences (". ! ? …", in Greek
  // also ";" and the Greek question mark) followed by a space or a
  // block edge, a block edge (breaks), or the last space before max
  // characters. Same as library/core.js speechParts.
  function speechParts(text, breaks, lang, max) {
    text = String(text || "");
    max = max || SPEAK_MAX;
    var ends = lang === "el" ? /[.!?…;;]/ : /[.!?…]/;
    var closers = /["'”’»)\]·]/;
    var brk = {};
    (breaks || []).forEach(function (o) { if (o > 0) brk[o] = 1; });
    var out = [], a = 0, lastSpace = -1;
    function push(x, y) {
      while (x < y && /\s/.test(text.charAt(x))) x++;
      while (y > x && /\s/.test(text.charAt(y - 1))) y--;
      if (y > x && /[0-9A-Za-zÀ-ɏͰ-Ͽἀ-῿Ѐ-ӿ]/.test(text.slice(x, y))) out.push({ a: x, b: y });
    }
    for (var i = 0; i < text.length; i++) {
      if (brk[i] && i > a) { push(a, i); a = i; lastSpace = -1; }
      var c = text.charAt(i);
      if (/\s/.test(c)) lastSpace = i;
      if (ends.test(c)) {
        var j = i + 1;
        while (j < text.length && (ends.test(text.charAt(j)) || closers.test(text.charAt(j)))) j++;
        if (j >= text.length || /\s/.test(text.charAt(j)) || brk[j]) {
          push(a, j); a = j; lastSpace = -1; i = j - 1;
          continue;
        }
      }
      if (i - a >= max) {
        var cut = lastSpace > a ? lastSpace : i;
        push(a, cut); a = cut; lastSpace = -1;
      }
    }
    if (a < text.length) push(a, text.length);
    return out;
  }
  // Only a voice installed on this device (localService === true);
  // same language first, then the exact tag, then the default.
  function localVoice(voices, lang) {
    var want = String(lang || "").toLowerCase().replace(/_/g, "-").trim();
    var base = want.split("-")[0];
    if (!voices || !base) return null;
    var best = null, score = -1;
    for (var i = 0; i < (voices.length || 0); i++) {
      var v = voices[i];
      if (!v || v.localService !== true) continue;
      var vl = String(v.lang || "").toLowerCase().replace(/_/g, "-");
      if (vl.split("-")[0] !== base) continue;
      var sc = (vl === want ? 2 : 0) + (v["default"] === true ? 1 : 0);
      if (sc > score) { score = sc; best = v; }
    }
    return best;
  }
  // What the voice is given: line-end hyphens joined, spaces squashed.
  function speechText(s) {
    return String(s || "").replace(/(\S)[-­]\n(?=[a-zß-ÿά-ώἀ-῿])/g, "$1")
      .replace(/­/g, "").replace(/\s+/g, " ").trim();
  }
  // Greek when most of its letters are.
  function guessLang(text) {
    var s = String(text || "").slice(0, 4000);
    var gr = (s.match(/[Ͱ-Ͽἀ-῿]/g) || []).length;
    var lat = (s.match(/[A-Za-z]/g) || []).length;
    return gr > lat ? "el" : lat ? "en" : "";
  }
  // Latin text that reads like German: ä ö ü ß, or several of its
  // most common short words.
  var DE_WORDS = /\b(und|der|die|das|ist|nicht|ein|eine|mit|auf|für|sich|auch|ich|du|wir|sie|es|zu|den|dem|von)\b/gi;
  function germanish(text) {
    var s = String(text || "").slice(0, 4000);
    if (/[äöüßÄÖÜ]/.test(s)) return true;
    var words = (s.match(/[A-Za-z]+/g) || []).length;
    var de = (s.match(DE_WORDS) || []).length;
    return words > 0 && de >= 2 && de / words >= 0.08;
  }
  // The language to read in: a lang attribute around the text (tag),
  // else what the text looks like, else the orOS language.
  function langOf(text, tag, ui) {
    var t = String(tag || "").trim().replace(/_/g, "-");
    if (/^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/.test(t)) return t;
    var g = guessLang(text);
    if (g === "el") return "el";
    if (g === "en") return germanish(text) ? "de" : "en";
    return /^(en|el|de)$/.test(String(ui || "")) ? ui : "en";
  }
  // The text as it is read: line ends unified, at most MAX_TEXT
  // characters (cut at a space), and the offsets where a line starts
  // (breaks for speechParts). "" when there is nothing to read.
  function prepare(text) {
    var t = String(text || "").replace(/\r\n?/g, "\n");
    if (!/\S/.test(t)) return { text: "", cut: false, breaks: [] };
    var cut = false;
    if (t.length > MAX_TEXT) {
      var sp = t.lastIndexOf(" ", MAX_TEXT);
      t = t.slice(0, sp > MAX_TEXT / 2 ? sp : MAX_TEXT);
      cut = true;
    }
    var breaks = [];
    for (var i = 0; i < t.length; i++) if (t.charAt(i) === "\n" && i + 1 < t.length) breaks.push(i + 1);
    return { text: t, cut: cut, breaks: breaks };
  }
  function appOk(app) { return !SKIP_APPS[String(app || "")]; }
  // The app folder of a path: "/notes/index.html" → "notes".
  function appOfPath(p) {
    var parts = String(p || "").split("/").filter(Boolean);
    if (parts.length && parts[parts.length - 1].indexOf(".") !== -1) parts.pop();
    return parts.length ? parts[parts.length - 1] : "";
  }
  // An element whose text is never read: a password or one-time code
  // field, or anything inside data-oros-noclip.
  function fieldSecret(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.closest && el.closest("[data-oros-noclip]")) return true;
    if (String(el.tagName).toUpperCase() !== "INPUT") return false;
    var type = String(el.getAttribute("type") || "").toLowerCase();
    if (type === "password" || type === "hidden") return true;
    var ac = String(el.getAttribute("autocomplete") || "").toLowerCase();
    return /(^|\s)(one-time-code|current-password|new-password)(\s|$)/.test(ac);
  }
  function nextRate(r) { var i = RATES.indexOf(r); return RATES[(i + 1) % RATES.length]; }
  // W2: the voice chosen for the language (voiceURI), when it is still
  // installed, local and of that language; else localVoice.
  function pickVoice(voices, lang, uri) {
    var base = String(lang || "").toLowerCase().split(/[-_]/)[0];
    if (uri && voices) {
      for (var i = 0; i < (voices.length || 0); i++) {
        var v = voices[i];
        if (v && v.localService === true && v.voiceURI === uri &&
            String(v.lang || "").toLowerCase().split(/[-_]/)[0] === base) return v;
      }
    }
    return localVoice(voices, lang);
  }
  // The device's local voices of one language, for the Settings list.
  function voicesOf(voices, lang) {
    var out = [];
    for (var i = 0; i < ((voices && voices.length) || 0); i++) {
      var v = voices[i];
      if (!v || v.localService !== true) continue;
      if (String(v.lang || "").toLowerCase().split(/[-_]/)[0] !== lang) continue;
      out.push({ name: String(v.name || v.voiceURI || ""), uri: String(v.voiceURI || v.name || ""), lang: String(v.lang || "") });
    }
    return out.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
  }
  // What Test says, in the voice's own language.
  var SAMPLES = { en: "This is how orOS reads aloud.", el: "Έτσι διαβάζει φωναχτά το orOS.", de: "So liest orOS vor." };
  // W2: a place in the collected text → { i: segment, off: inside it }.
  // segs = [{ ts: start in the text, len }], in order.
  function locate(segs, pos, end) {
    if (!segs || !segs.length) return null;
    for (var i = 0; i < segs.length; i++) {
      var g = segs[i];
      if (pos < g.ts + g.len || (end && pos === g.ts + g.len)) return { i: i, off: Math.max(0, pos - g.ts) };
    }
    var last = segs[segs.length - 1];
    return { i: segs.length - 1, off: last.len };
  }
  // W2, reading a whole page: the parts never read (selector for
  // Element.closest) and the tags whose start begins a new line.
  var PAGE_SKIP = "script,style,noscript,template,svg,button,input,select,textarea,option,nav,iframe,canvas,video,audio," +
    "[aria-hidden=true],[hidden],[role=navigation],[role=toolbar],[role=menu],[role=menubar],[role=tablist],[role=tab]," +
    "[role=button],[role=dialog]:not([open]),dialog:not([open]),[data-oros-noclip],[data-oros-noread]";
  var BLOCK_TAGS = /^(P|DIV|LI|UL|OL|DL|DT|DD|H[1-6]|TR|TD|TH|TABLE|SECTION|ARTICLE|MAIN|HEADER|FOOTER|ASIDE|BLOCKQUOTE|PRE|FIGCAPTION|FORM|FIELDSET|DETAILS|SUMMARY|LABEL|HR|BR)$/;

  var model = { VER: VER, KEY: KEY, RATES: RATES, MAX_TEXT: MAX_TEXT, SKIP_APPS: SKIP_APPS,
                parsePrefs: parsePrefs, prefsRecord: prefsRecord, speechParts: speechParts,
                localVoice: localVoice, speechText: speechText, guessLang: guessLang,
                germanish: germanish, langOf: langOf, prepare: prepare, appOk: appOk,
                appOfPath: appOfPath, fieldSecret: fieldSecret, nextRate: nextRate,
                VOICE_LANGS: VOICE_LANGS, cleanVo: cleanVo, pickVoice: pickVoice, voicesOf: voicesOf,
                SAMPLES: SAMPLES, locate: locate, PAGE_SKIP: PAGE_SKIP };
  if (typeof module !== "undefined" && module.exports) module.exports = model;
  if (typeof document === "undefined") return;

  // ---------- 2. Shell side ----------
  var doc = document;
  var host = null, synth = root.speechSynthesis || null;
  // st: { text, lang, parts, k, playing, gen, spoken, win, segs }
  var st = null, gen = 0, bar = null, voicesWaited = false;

  function t(k, vars) {
    var s = typeof root.t === "function" ? root.t(k) : k;
    if (vars) Object.keys(vars).forEach(function (n) { s = s.split("{" + n + "}").join(String(vars[n])); });
    return s;
  }
  function call(fn) { try { return fn(); } catch (e) { return undefined; } }
  function toast(kind, k, vars) { if (host && host.toast) host.toast(kind, t(k, vars)); }
  function strictOn() { return !!call(function () { return root.orosStrict && root.orosStrict.level(); }); }
  function locked() { return !!call(function () { return root.orosLock && root.orosLock.isLocked(); }); }
  function available() { return !!(synth && typeof root.SpeechSynthesisUtterance === "function"); }
  function changed() { if (host && host.changed) call(host.changed); }

  // ---------- 3. What is selected ----------
  // The selection in an app window: { text, lang, app } (text "" when
  // it may not be read), or null when nothing is selected there.
  function langAt(node, d) {
    var e = node && (node.nodeType === 1 ? node : node.parentElement);
    var l = e && e.closest ? e.closest("[lang]") : null;
    return l && l !== d.documentElement ? l.getAttribute("lang") || "" : "";
  }
  function selIn(w) {
    var d, a, app;
    try { d = w.document; a = d.activeElement; app = appOfPath(w.location.pathname); } catch (e) { return null; }
    if (!appOk(app)) {                         // Passwords: never, but say so
      var any = "";
      try { any = String(w.getSelection ? w.getSelection() : ""); } catch (e) { any = ""; }
      if (a && (a.tagName === "TEXTAREA" || a.tagName === "INPUT")) { try { any = any || a.value.slice(a.selectionStart, a.selectionEnd); } catch (e) {} }
      return /\S/.test(any) ? { text: "", lang: "", app: app } : null;
    }
    if (a && (a.tagName === "TEXTAREA" || a.tagName === "INPUT")) {
      var text = "";
      try { text = a.value.slice(a.selectionStart, a.selectionEnd); } catch (e) { text = ""; }
      if (!text || !/\S/.test(text)) return null;
      var blocked = !appOk(app) || fieldSecret(a) ||
        (a.tagName === "INPUT" && !/^(text|search|url|email|tel)?$/i.test(a.getAttribute("type") || ""));
      return { text: blocked ? "" : text, lang: langAt(a, d), app: app };
    }
    var sel = w.getSelection && w.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    var s = sel.toString();
    if (!s || !/\S/.test(s)) return null;
    var n = sel.anchorNode, f = sel.focusNode;
    var ne = n && (n.nodeType === 1 ? n : n.parentElement), fe = f && (f.nodeType === 1 ? f : f.parentElement);
    var secret = !appOk(app) || fieldSecret(ne) || fieldSecret(fe);
    if (secret) return { text: "", lang: "", app: app };
    // W2: the text with its place in the page, so the sentence read can
    // be lit up; a part inside data-oros-noclip refuses the whole of it.
    var c = call(function () { return collect(w, sel.getRangeAt(0), false); });
    if (c && c.secret) return { text: "", lang: "", app: app };
    if (c && /\S/.test(c.text)) return { text: c.text, lang: langAt(n, d), app: app, win: w, segs: c.segs };
    return { text: s, lang: langAt(n, d), app: app };
  }
  // W2: the text nodes under root (inside range when given) as one
  // text, a new line where a block starts, and where each node sits in
  // it: { text, segs: [{ node, ns, ts, len }], secret }. page: a whole
  // page, without the parts PAGE_SKIP names or that are not shown.
  function blockOf(node, stop) {
    for (var e = node.parentElement; e && e !== stop; e = e.parentElement) if (BLOCK_TAGS.test(e.tagName)) return e;
    return stop;
  }
  function collect(w, range, page) {
    var d = w.document;
    var root = range ? range.commonAncestorContainer : (d.querySelector("main, [role=main], article") || d.body);
    if (!root) return null;
    if (root.nodeType === 3) root = root.parentNode;
    var text = "", segs = [], lastBlock = null, secret = false;
    var tw = d.createTreeWalker(root, 4, null);   // NodeFilter.SHOW_TEXT
    for (var n = tw.nextNode(); n; n = tw.nextNode()) {
      if (range && !range.intersectsNode(n)) continue;
      var e = n.parentElement;
      if (!e) continue;
      if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(e.tagName)) continue;
      if (page) {
        if (e.closest(PAGE_SKIP)) continue;
        if (!e.getClientRects().length) continue;      // not shown
      } else if (e.closest("[data-oros-noclip]")) { secret = true; break; }
      var a = 0, b = n.data.length;
      if (range && n === range.startContainer) a = range.startOffset;
      if (range && n === range.endContainer) b = range.endOffset;
      if (b <= a) continue;
      var blk = blockOf(n, root);
      if (lastBlock && blk !== lastBlock && text && !/\n$/.test(text)) text += "\n";
      lastBlock = blk;
      segs.push({ node: n, ns: a, ts: text.length, len: b - a });
      text += n.data.slice(a, b).replace(/\r/g, " ");   // same length: the places stay right
      if (text.length > MAX_TEXT) break;
    }
    return { text: text, segs: segs, secret: secret };
  }
  // W2: nothing selected → the main text of the app in front.
  function pageOf(f) {
    var w = f && f.contentWindow, app;
    try { app = appOfPath(w.location.pathname); } catch (e) { return null; }
    if (!appOk(app)) return { text: "", lang: "", app: app };
    var c = call(function () { return collect(w, null, true); });
    if (!c || !/\S/.test(c.text)) return null;
    var root = w.document.querySelector("main, [role=main], article") || w.document.body;
    return { text: c.text, lang: langAt(root, w.document), app: app, win: w, segs: c.segs, page: true };
  }
  // The app in front first (the focused frame), then any app on screen
  // with text selected.
  function findSel() {
    var frames = (host && host.frames ? call(host.frames) : null) || [];
    var act = doc.activeElement, list = [];
    if (act && act.tagName === "IFRAME") list.push(act);
    frames.forEach(function (f) { if (f !== act) list.push(f); });
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      if (f.closest && f.closest("#qa-mini")) continue;
      var r = f.getBoundingClientRect ? f.getBoundingClientRect() : null;
      if (r && (!r.width || !r.height)) continue;
      var s = call(function () { return selIn(f.contentWindow); });
      if (s) return s;
    }
    // W2: no selection anywhere: the page of the app in front
    for (var j = 0; j < list.length; j++) {
      var g = list[j], gr = g.getBoundingClientRect ? g.getBoundingClientRect() : null;
      if ((g.closest && g.closest("#qa-mini")) || (gr && (!gr.width || !gr.height))) continue;
      return pageOf(g);
    }
    return null;
  }

  // ---------- 4. Voice ----------
  function voiceFor(lang) {
    if (!synth || !lang) return null;
    var list = [];
    try { list = synth.getVoices() || []; } catch (e) { list = []; }
    var uri = host && host.voice ? call(function () { return host.voice(lang.split("-")[0]); }) : "";
    return pickVoice(list, lang, uri);
  }
  // Chrome fills the list a moment after the first ask: wait once.
  function waitVoices(cb) {
    var done = false;
    function go() {
      if (done) return;
      done = true;
      voicesWaited = true;
      try { synth.removeEventListener("voiceschanged", go); } catch (e) {}
      cb();
    }
    try { synth.addEventListener("voiceschanged", go); } catch (e) {}
    setTimeout(go, 2000);
  }

  // ---------- 5. Playback ----------
  function rate() { var r = host && host.rate ? call(host.rate) : 1; return RATES.indexOf(r) !== -1 ? r : 1; }
  // Read a selection { text, lang, app }; false when it was refused.
  function read(sel) {
    // the selection menu's text: take it again with its place in the page
    if (sel && sel.win && !sel.segs && sel.text) {
      var again = call(function () { return selIn(sel.win); });
      sel = again && again.text && again.segs ? again : { text: sel.text, lang: sel.lang, app: sel.app };
    }
    if (!sel) { toast("", "ra.nosel"); return false; }
    if (strictOn()) { toast("err", "ra.strict"); return false; }
    if (locked()) return false;
    if (!sel.text) { toast("err", "ra.blocked"); return false; }
    if (!available()) { toast("err", "ra.none"); return false; }
    var p = prepare(sel.text);
    if (!p.text) { toast("", "ra.nosel"); return false; }
    var lang = langOf(p.text, sel.lang, host && host.lang ? call(host.lang) : "en");
    var parts = speechParts(p.text, p.breaks, lang.split("-")[0]);
    if (!parts.length) { toast("", "ra.nosel"); return false; }
    stop(true);
    st = { text: p.text, lang: lang, parts: parts, k: 0, playing: true, gen: ++gen, spoken: 0,
           win: sel.segs ? sel.win : null, segs: sel.segs || null };
    if (p.cut) toast("", "ra.cut", { n: MAX_TEXT.toLocaleString() });
    draw();
    speak();
    changed();
    return true;
  }
  function speak() {
    if (!st || !st.playing) return;
    if (st.k >= st.parts.length) { stop(); return; }
    var p = st.parts[st.k], my = st.gen, k = st.k;
    var v = voiceFor(st.lang);
    if (!v) {
      var none = true;
      try { none = !(synth.getVoices() || []).length; } catch (e) {}
      if (none && !voicesWaited) {
        waitVoices(function () { if (st && st.gen === my && st.playing) speak(); });
        return;
      }
      stop();
      toast("err", "ra.novoice");
      return;
    }
    var u = new root.SpeechSynthesisUtterance(speechText(st.text.slice(p.a, p.b)));
    u.lang = v.lang || st.lang;
    u.voice = v;
    u.rate = rate();
    u.onend = function () {
      if (!st || st.gen !== my || st.k !== k || !st.playing) return;
      st.spoken++;
      st.k++;
      draw();
      speak();
    };
    u.onerror = function (e) {
      if (!st || st.gen !== my || st.k !== k) return;
      var why = e && e.error;
      if (why === "interrupted" || why === "canceled") return;     // our own cancel()
      stop();
      toast("err", "ra.fail");
    };
    try { if (synth.speaking || synth.pending) synth.cancel(); } catch (e) {}
    mark(p);
    synth.speak(u);
  }
  // ---------- 5b. The sentence lit up in the app (W2) ----------
  // CSS Custom Highlight API: a highlight over a Range, no change to the
  // app's DOM (so never to its data); browsers without it read unlit.
  var HL = "oros-read";
  function mark(p) {
    if (!st || !st.segs || !st.win) return;
    var w = st.win;
    call(function () {
      if (!w.CSS || !w.CSS.highlights || typeof w.Highlight !== "function") return;
      var a = locate(st.segs, p.a, false), b = locate(st.segs, p.b, true);
      if (!a || !b) return;
      var sa = st.segs[a.i], sb = st.segs[b.i];
      if (!sa.node.isConnected || !sb.node.isConnected) { clearMark(); return; }
      var r = w.document.createRange();
      r.setStart(sa.node, sa.ns + Math.min(a.off, sa.len));
      r.setEnd(sb.node, sb.ns + Math.min(b.off, sb.len));
      if (!w.document.getElementById("oros-read-hl")) {
        var css = w.document.createElement("style");
        css.id = "oros-read-hl";
        css.textContent = "::highlight(" + HL + "){background-color:rgba(255,196,0,.42);color:inherit}" +
          "@media (forced-colors:active){::highlight(" + HL + "){background-color:Highlight;color:HighlightText}}";
        (w.document.head || w.document.documentElement).appendChild(css);
      }
      w.CSS.highlights.set(HL, new w.Highlight(r));
      // the page follows the voice
      var box = r.getBoundingClientRect();
      if (box && (box.top < 0 || box.bottom > w.innerHeight)) {
        var el = sa.node.parentElement;
        var still = call(function () { return w.matchMedia("(prefers-reduced-motion: reduce)").matches; });
        if (el && el.scrollIntoView) el.scrollIntoView({ block: "center", behavior: still ? "auto" : "smooth" });
      }
    });
  }
  function clearMark(w) {
    w = w || (st && st.win);
    if (w) call(function () { w.CSS.highlights.delete(HL); });
  }
  // Test (Settings): a short sentence in that language and voice.
  function test(lang, uri) {
    if (!available() || strictOn() || locked()) return false;
    stop(true);
    var list = [];
    try { list = synth.getVoices() || []; } catch (e) {}
    var v = pickVoice(list, lang, uri);
    if (!v) { toast("err", "ra.novoice"); return false; }
    var u = new root.SpeechSynthesisUtterance(SAMPLES[lang] || SAMPLES.en);
    u.lang = v.lang || lang;
    u.voice = v;
    u.rate = rate();
    try { synth.cancel(); } catch (e) {}
    synth.speak(u);
    return true;
  }
  // A pause is a cancel that keeps the sentence (pause() is not
  // reliable on Android); play reads that sentence again.
  function pause() {
    if (!st || !st.playing) return;
    st.playing = false;
    st.gen = ++gen;
    try { synth.cancel(); } catch (e) {}
    draw();
    changed();
  }
  function play() {
    if (!st || st.playing) return;
    if (strictOn() || locked()) { stop(); return; }
    st.playing = true;
    st.gen = ++gen;
    draw();
    speak();
    changed();
  }
  function stop(quiet) {
    var was = !!st;
    if (was) clearMark(st.win);
    st = null;
    gen++;
    if (was) { try { synth.cancel(); } catch (e) {} }
    hideBar();
    if (was && !quiet) changed();
  }
  function step(d) {
    if (!st) return;
    var k = Math.max(0, st.k + d);
    if (k >= st.parts.length) { stop(); return; }
    st.k = k;
    st.gen = ++gen;
    draw();
    if (st.playing) speak();
    else { try { synth.cancel(); } catch (e) {} }
  }
  function cycleRate() {
    var r = nextRate(rate());
    if (host && host.setRate) call(function () { host.setRate(r); });
    draw();
    if (st && st.playing) { st.gen = ++gen; speak(); }
  }

  // ---------- 6. The bar ----------
  var SV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  var IC = {
    prev: SV + '<path d="M19 20L9 12l10-8z"/><path d="M5 19V5"/></svg>',
    next: SV + '<path d="M5 4l10 8-10 8z"/><path d="M19 5v14"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
    stop: SV + '<path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>'
  };
  var CSS = [
    "#ra-bar{position:fixed;z-index:1150;top:calc(48px + env(safe-area-inset-top,0px));left:50%;transform:translateX(-50%);",
    "display:flex;align-items:center;gap:2px;max-width:calc(100vw - 16px);padding:4px;background:var(--panel-bg);color:var(--text);",
    "border:1px solid var(--border);border-radius:999px;box-shadow:0 8px 32px var(--shadow)}",
    "#ra-bar[hidden]{display:none}",
    "#ra-bar button{display:inline-flex;align-items:center;justify-content:center;min-width:44px;height:44px;padding:0 10px;",
    "border:none;border-radius:999px;background:transparent;color:inherit;font:inherit;font-size:14px;cursor:pointer}",
    "#ra-bar button:hover{background:var(--accent-soft)}",
    "#ra-bar button:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}",
    "#ra-bar button svg{width:20px;height:20px}",
    "#ra-bar .ra-main{background:var(--accent);color:var(--accent-ink,#fff)}",
    "#ra-bar .ra-pos{padding:0 8px;font-size:12px;color:var(--text-dim);white-space:nowrap;font-variant-numeric:tabular-nums}",
    "html[data-oros-contrast=\"high\"] #ra-bar{border-width:2px}",
    "@media (max-width:720px){#ra-bar{top:calc(108px + env(safe-area-inset-top,0px))}}",
    "@media (max-width:400px){#ra-bar button{min-width:40px;padding:0 6px}#ra-bar .ra-pos{display:none}}"
  ].join("");
  function injectCss() {
    if (doc.getElementById("ra-css")) return;
    var s = doc.createElement("style");
    s.id = "ra-css";
    s.textContent = CSS;
    doc.head.appendChild(s);
  }
  function btn(cls, icon, label, fn) {
    var b = doc.createElement("button");
    b.type = "button";
    if (cls) b.className = cls;
    b.innerHTML = icon;                        // static shell icon, not data
    b.setAttribute("aria-label", label);
    b.title = label;
    b.addEventListener("click", fn);
    return b;
  }
  // 1.2× (English), 1,2× (Greek, German)
  function rateText() {
    var l = host && host.lang ? call(host.lang) : "en";
    return String(rate()).replace(".", l === "en" ? "." : ",") + "×";
  }
  function draw() {
    if (!st) { hideBar(); return; }
    injectCss();
    var had = !!bar, focusCls = "";
    if (had && bar.contains(doc.activeElement)) focusCls = doc.activeElement.getAttribute("data-k") || "";
    if (!bar) {
      bar = doc.createElement("div");
      bar.id = "ra-bar";
      bar.setAttribute("role", "toolbar");
      doc.body.appendChild(bar);
    }
    bar.setAttribute("aria-label", t("ra.title"));
    bar.textContent = "";
    var b1 = btn("", IC.prev, t("ra.prev"), function () { step(-1); });
    var b2 = btn("ra-main", st.playing ? IC.pause : IC.play, t(st.playing ? "ra.pause" : "ra.play"),
      function () { if (st && st.playing) pause(); else play(); });
    var b3 = btn("", IC.next, t("ra.next"), function () { step(1); });
    var pos = doc.createElement("span");
    pos.className = "ra-pos";
    pos.textContent = (st.k + 1) + " / " + st.parts.length;
    var b4 = doc.createElement("button");
    b4.type = "button";
    b4.textContent = rateText();
    b4.setAttribute("aria-label", t("ra.rate", { r: rateText() }));
    b4.title = t("ra.rate", { r: rateText() });
    b4.addEventListener("click", cycleRate);
    var b5 = btn("", IC.stop, t("ra.stop"), function () { stop(); });
    [[b1, "prev"], [b2, "main"], [b3, "next"], [b4, "rate"], [b5, "stop"]].forEach(function (x) { x[0].setAttribute("data-k", x[1]); });
    bar.appendChild(b1); bar.appendChild(b2); bar.appendChild(b3); bar.appendChild(pos); bar.appendChild(b4); bar.appendChild(b5);
    bar.hidden = false;
    if (focusCls) { var f = bar.querySelector('[data-k="' + focusCls + '"]'); if (f) f.focus(); }
  }
  function hideBar() { if (bar) bar.hidden = true; }

  // ---------- 7. Public API ----------
  // host = { frames() → app iframes, lang() → "en"|"el"|"de",
  //          rate(), setRate(r), voice(lang) → voiceURI or "" (W2),
  //          toast(kind, msg), changed() }
  function attach(h) {
    if (host) return;
    host = h || {};
    // Sensitive work on, or the screen locked: stop at once.
    call(function () { root.orosStrict.onChange(function () { if (strictOn()) stop(); }); });
    call(function () { root.orosLock.onChange(function () { if (locked()) stop(); }); });
    doc.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && st && bar && bar.contains(doc.activeElement)) { e.preventDefault(); stop(); }
    });
    if (synth) { try { synth.getVoices(); } catch (e) {} }   // Chrome loads the list on first ask
  }

  root.orosReadEngine = {
    VER: VER,
    model: model,
    attach: attach,
    // the app in front's selection, or the note "select text first"
    readSelection: function () { return read(findSel()); },
    // a selection the menu already took: { text, lang, app, secret }
    read: function (s) { return read(s && s.secret ? { text: "", lang: "", app: s.app } : s); },
    stop: function () { stop(); },
    test: test,
    pause: pause,
    play: play,
    active: function () { return !!st; },
    playing: function () { return !!(st && st.playing); },
    available: available,
    refresh: function () { if (st) draw(); }
  };
})(typeof window !== "undefined" ? window : globalThis);
