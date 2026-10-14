// ============================================================
// orOS One-Sentence Diary — journal.js (pure, no DOM) — wave 30
// The parts of the long entry that need no storage:
//   - a small, safe Markdown reader → blocks of text runs (the app
//     builds DOM nodes from them with textContent, the PDF book draws
//     them; no HTML string ever comes out of here)
//   - daily prompt questions and templates (EN + EL) and the pick of
//     the day (built-in set + the user's own prompts)
//   - weather and place helpers (Open-Meteo, the provider the Weather
//     app uses; only URLs and parsing here — the app fetches, and only
//     when the user asks)
//   - the PIN lock (PBKDF2-SHA-256 through WebCrypto; a salted hash is
//     all that is stored, on this device only)
//   - the PDF book's list of days
// UMD: module.exports in Node (tests), window.DiaryJournal in the app.
// ============================================================
(function (root) {
  "use strict";

  // ---------- Markdown (subset) ----------
  // Blocks: # / ## / ### headings, paragraphs (lines joined), "- " or
  // "* " bullets, "1. " numbered items, "> " quotes, "---" rules.
  // Inline: **bold**, *italic* / _italic_, `code`, [text](url) with
  // http, https or mailto only (anything else stays plain text).
  function safeUrl(u) {
    u = String(u || "").trim();
    if (/^(https?:\/\/|mailto:)[^\s<>"'`]+$/i.test(u)) return u;
    return null;
  }
  function inline(s) {
    var runs = [], i = 0, buf = "", st = { b: false, i: false };
    function push(text, extra) {
      if (!text) return;
      var r = { s: text };
      if (st.b) r.b = true;
      if (st.i) r.i = true;
      if (extra) Object.keys(extra).forEach(function (k) { r[k] = extra[k]; });
      var last = runs[runs.length - 1];
      if (last && !extra && !last.c && !last.href && !!last.b === !!r.b && !!last.i === !!r.i) last.s += text;
      else runs.push(r);
    }
    function flush() { push(buf); buf = ""; }
    while (i < s.length) {
      var c = s.charAt(i);
      if (c === "\\" && i + 1 < s.length && /[\\`*_\[\]()#>-]/.test(s.charAt(i + 1))) { buf += s.charAt(i + 1); i += 2; continue; }
      if (c === "`") {
        var j = s.indexOf("`", i + 1);
        if (j > i + 1) { flush(); push(s.slice(i + 1, j), { c: true }); i = j + 1; continue; }
      }
      if (c === "[") {
        var m = /^\[([^\]\n]{1,200})\]\(((?:[^()\s]|\([^()\s]*\)){1,500})\)/.exec(s.slice(i));
        if (m) {
          var url = safeUrl(m[2]);
          flush();
          if (url) push(m[1], { href: url }); else push(m[1]);
          i += m[0].length; continue;
        }
      }
      if (s.substr(i, 2) === "**" || s.substr(i, 2) === "__") {
        var mk = s.substr(i, 2), close = s.indexOf(mk, i + 2);
        if (st.b || close > i + 2) { flush(); st.b = !st.b; i += 2; continue; }
      }
      if ((c === "*" || c === "_") && s.charAt(i + 1) !== c) {
        var prev = i ? s.charAt(i - 1) : " ";
        var opening = !st.i && /\S/.test(s.charAt(i + 1) || "") && s.indexOf(c, i + 1) > i + 1 && (c === "*" || /[\s(]/.test(prev));
        var closing = st.i && /\S/.test(prev);
        if (opening || closing) { flush(); st.i = !st.i; i++; continue; }
      }
      buf += c; i++;
    }
    flush();
    return runs;
  }
  function parseMd(text) {
    var lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
    var out = [], para = null;
    function endPara() { if (para) { out.push({ t: "p", runs: inline(para.join(" ")) }); para = null; } }
    lines.forEach(function (ln) {
      var m;
      if (!ln.trim()) { endPara(); return; }
      if ((m = /^(#{1,3})\s+(.*)$/.exec(ln))) { endPara(); out.push({ t: "h", l: m[1].length, runs: inline(m[2].trim()) }); return; }
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(ln)) { endPara(); out.push({ t: "hr" }); return; }
      if ((m = /^\s*[-*+]\s+(.*)$/.exec(ln))) { endPara(); out.push({ t: "li", runs: inline(m[1]) }); return; }
      if ((m = /^\s*(\d{1,3})[.)]\s+(.*)$/.exec(ln))) { endPara(); out.push({ t: "li", n: +m[1], runs: inline(m[2]) }); return; }
      if ((m = /^\s*>\s?(.*)$/.exec(ln))) {
        endPara();
        var last = out[out.length - 1];
        if (last && last.t === "q") last.runs = last.runs.concat([{ s: " " }], inline(m[1]));
        else out.push({ t: "q", runs: inline(m[1]) });
        return;
      }
      (para = para || []).push(ln.trim());
    });
    endPara();
    return out;
  }
  // Plain text of a run list / of a whole entry (search, excerpts).
  function runsText(runs) { return (runs || []).map(function (r) { return r.s; }).join(""); }
  function plain(text) {
    return parseMd(text).map(function (b) { return b.t === "hr" ? "" : runsText(b.runs); }).filter(Boolean).join("\n");
  }

  // ---------- Prompts and templates ----------
  var PROMPTS = {
    en: [
      "What made you smile today?",
      "What are three things you are grateful for?",
      "What did you learn today?",
      "Who made a difference to your day, and how?",
      "What was the hardest moment today, and how did you handle it?",
      "What would you like to remember about today in a year?",
      "What drained your energy today, and what gave it back?",
      "What is one small thing you did well?",
      "What surprised you today?",
      "What are you looking forward to tomorrow?",
      "What did you notice outside today?",
      "If today had a title, what would it be?",
      "What did you do just for yourself?",
      "What would you do differently if you lived today again?",
      "What conversation stayed with you?",
      "What made you feel calm today?",
      "Which worry turned out smaller than you thought?",
      "What did your body tell you today?",
      "What kindness did you give or receive?",
      "What is on your mind as the day ends?",
      "What did you eat that you enjoyed?",
      "Where did you feel most like yourself today?",
      "What is one thing you want to let go of?",
      "What made you laugh?",
      "What are you proud of this week?",
      "What did you put off, and why?",
      "Describe one moment of today in detail.",
      "What would you tell a friend who had your day?",
      "What song, book or film fits today?",
      "What do you need more of right now?"
    ],
    el: [
      "Τι σε έκανε να χαμογελάσεις σήμερα;",
      "Ποια τρία πράγματα σε κάνουν να νιώθεις ευγνωμοσύνη;",
      "Τι έμαθες σήμερα;",
      "Ποιος έκανε τη διαφορά στη μέρα σου, και πώς;",
      "Ποια ήταν η πιο δύσκολη στιγμή σήμερα, και πώς την αντιμετώπισες;",
      "Τι θα ήθελες να θυμάσαι από τη σημερινή μέρα σε έναν χρόνο;",
      "Τι σου πήρε ενέργεια σήμερα, και τι σου την έδωσε πίσω;",
      "Ποιο μικρό πράγμα έκανες καλά;",
      "Τι σε ξάφνιασε σήμερα;",
      "Τι περιμένεις με χαρά για αύριο;",
      "Τι πρόσεξες έξω σήμερα;",
      "Αν η σημερινή μέρα είχε τίτλο, ποιος θα ήταν;",
      "Τι έκανες μόνο για τον εαυτό σου;",
      "Τι θα έκανες αλλιώς αν ζούσες ξανά τη σημερινή μέρα;",
      "Ποια κουβέντα σού έμεινε;",
      "Τι σε ηρέμησε σήμερα;",
      "Ποια ανησυχία βγήκε μικρότερη απ' όσο νόμιζες;",
      "Τι σου είπε το σώμα σου σήμερα;",
      "Ποια καλοσύνη έδωσες ή δέχτηκες;",
      "Τι έχεις στο μυαλό σου καθώς τελειώνει η μέρα;",
      "Τι έφαγες και το απόλαυσες;",
      "Πού ένιωσες περισσότερο ο εαυτός σου σήμερα;",
      "Τι θέλεις να αφήσεις πίσω σου;",
      "Τι σε έκανε να γελάσεις;",
      "Για τι είσαι περήφανος ή περήφανη αυτή την εβδομάδα;",
      "Τι ανέβαλες, και γιατί;",
      "Περίγραψε μια στιγμή της μέρας με λεπτομέρειες.",
      "Τι θα έλεγες σε έναν φίλο που είχε τη δική σου μέρα;",
      "Ποιο τραγούδι, βιβλίο ή ταινία ταιριάζει στη σημερινή μέρα;",
      "Τι χρειάζεσαι περισσότερο αυτή τη στιγμή;"
    ]
  };
  var TEMPLATES = {
    gratitude: {
      en: { name: "Gratitude", text: "## Grateful for\n\n1. \n2. \n3. \n\n## One good moment\n\n" },
      el: { name: "Ευγνωμοσύνη", text: "## Νιώθω ευγνωμοσύνη για\n\n1. \n2. \n3. \n\n## Μια καλή στιγμή\n\n" }
    },
    review: {
      en: { name: "Daily review", text: "## What went well\n\n- \n\n## What was hard\n\n- \n\n## What I learned\n\n- \n\n## Tomorrow\n\n- \n" },
      el: { name: "Ανασκόπηση μέρας", text: "## Τι πήγε καλά\n\n- \n\n## Τι ήταν δύσκολο\n\n- \n\n## Τι έμαθα\n\n- \n\n## Αύριο\n\n- \n" }
    },
    morning: {
      en: { name: "Morning pages", text: "## Today I want to\n\n- \n\n## I am looking forward to\n\n- \n\n## A kind word to myself\n\n" },
      el: { name: "Πρωινές σελίδες", text: "## Σήμερα θέλω να\n\n- \n\n## Περιμένω με χαρά\n\n- \n\n## Μια καλή κουβέντα στον εαυτό μου\n\n" }
    }
  };
  var TEMPLATE_IDS = ["gratitude", "review", "morning"];
  function template(id, lang) {
    var t = TEMPLATES[id];
    return t ? (t[lang === "el" ? "el" : "en"]) : null;
  }
  function hashStr(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }
  // The question of a day: the same all day on every device, from the
  // built-in set of the language plus the user's own prompts; `skip`
  // walks to the next ones ("Another question").
  function promptPool(lang, own) {
    var base = PROMPTS[lang === "el" ? "el" : "en"].map(function (t) { return { t: t }; });
    return base.concat((own || []).map(function (p) { return { t: p.t, own: true, id: p.id }; }));
  }
  function dailyPrompt(ymd, lang, own, skip) {
    var pool = promptPool(lang, own);
    var i = (hashStr(String(ymd)) + (skip || 0)) % pool.length;
    return pool[i];
  }
  // A template or a question goes at the end of the text (or alone).
  function insertBlock(md, block) {
    md = String(md || "").replace(/\s+$/, "");
    block = String(block || "").replace(/^\s+/, "");
    return md ? md + "\n\n" + block : block;
  }
  function questionBlock(q) { return "### " + String(q || "").replace(/\s+/g, " ").trim() + "\n\n"; }

  // ---------- Weather and place (Open-Meteo, as in the Weather app) ----------
  var DAY_MS = 86400000;
  function ymdNum(ymd) { var p = ymd.split("-"); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  // Forecast API for the last ~3 months (it keeps past days), the
  // archive API for older days. Daily code + max/min, °C.
  function wxUrl(lat, lon, ymd, today) {
    var la = Math.round(lat * 100) / 100, lo = Math.round(lon * 100) / 100;
    var back = Math.round((ymdNum(today) - ymdNum(ymd)) / DAY_MS);
    var q = "?latitude=" + la + "&longitude=" + lo +
      "&daily=weathercode,temperature_2m_max,temperature_2m_min&timezone=auto" +
      "&start_date=" + ymd + "&end_date=" + ymd;
    return (back > 80 ? "https://archive-api.open-meteo.com/v1/archive" : "https://api.open-meteo.com/v1/forecast") + q;
  }
  function parseWx(d, ymd) {
    if (!d || !d.daily || !Array.isArray(d.daily.time)) return null;
    var i = d.daily.time.indexOf(ymd);
    if (i < 0) return null;
    var code = d.daily.weathercode && d.daily.weathercode[i];
    if (typeof code !== "number") return null;
    var o = { c: code };
    var hi = d.daily.temperature_2m_max && d.daily.temperature_2m_max[i];
    var lo = d.daily.temperature_2m_min && d.daily.temperature_2m_min[i];
    if (typeof hi === "number") o.hi = Math.round(hi * 10) / 10;
    if (typeof lo === "number") o.lo = Math.round(lo * 10) / 10;
    return o;
  }
  function geoUrl(name, lang) {
    return "https://geocoding-api.open-meteo.com/v1/search?count=1&language=" + (lang === "el" ? "el" : "en") +
      "&name=" + encodeURIComponent(String(name || "").trim());
  }
  function parseGeo(d) {
    var g = d && d.results && d.results[0];
    if (!g || typeof g.latitude !== "number" || typeof g.longitude !== "number") return null;
    return { la: Math.round(g.latitude * 100) / 100, lo: Math.round(g.longitude * 100) / 100, n: String(g.name || "") };
  }
  // WMO code → condition (same grouping as the Weather app) and emoji.
  function wxText(code, lang) {
    var c = Number(code) || 0, en, el;
    if (c === 0) { en = "Clear sky"; el = "Καθαρός ουρανός"; }
    else if (c === 1 || c === 2) { en = "Partly cloudy"; el = "Λίγες νεφώσεις"; }
    else if (c === 3) { en = "Overcast"; el = "Συννεφιά"; }
    else if (c === 45 || c === 48) { en = "Fog"; el = "Ομίχλη"; }
    else if (c >= 51 && c <= 57) { en = "Drizzle"; el = "Ψιλή βροχή"; }
    else if (c >= 58 && c <= 67) { en = "Rain"; el = "Βροχή"; }
    else if (c >= 71 && c <= 77) { en = "Snow"; el = "Χιόνι"; }
    else if (c >= 80 && c <= 82) { en = "Showers"; el = "Μπόρες"; }
    else if (c === 85 || c === 86) { en = "Snow showers"; el = "Χιονοπτώσεις"; }
    else if (c >= 95) { en = "Thunderstorm"; el = "Καταιγίδα"; }
    else { en = "Cloudy"; el = "Νεφελώδης"; }
    return lang === "el" ? el : en;
  }
  function wxEmoji(code) {
    var c = Number(code) || 0;
    if (c === 0) return "☀️";
    if (c === 1 || c === 2) return "⛅";
    if (c === 3) return "☁️";
    if (c === 45 || c === 48) return "🌫️";
    if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82)) return "🌧️";
    if ((c >= 71 && c <= 77) || c === 85 || c === 86) return "❄️";
    if (c >= 95) return "⛈️";
    return "☁️";
  }
  function temp(v, imperial) {
    if (typeof v !== "number") return "";
    return Math.round(imperial ? v * 9 / 5 + 32 : v) + "°";
  }
  function wxLine(wx, lang, imperial) {
    if (!wx) return "";
    var t = [temp(wx.hi, imperial), temp(wx.lo, imperial)].filter(Boolean).join(" / ");
    return wxText(wx.c, lang) + (t ? " · " + t : "");
  }
  function locLine(loc) {
    if (!loc) return "";
    if (loc.n) return loc.n;
    if (typeof loc.la === "number") return loc.la.toFixed(2) + ", " + loc.lo.toFixed(2);
    return "";
  }

  // ---------- PIN lock ----------
  // A privacy screen, not encryption: the diary data stays readable in
  // this browser's storage. Stored (device-local): { v, s, h, it }.
  var PIN_ITER = 150000;
  function pinOk(pin) { return typeof pin === "string" && /^\d{4,8}$/.test(pin); }
  function b64(bytes) {
    var u8 = new Uint8Array(bytes), s = "";
    for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return typeof btoa === "function" ? btoa(s) : Buffer.from(s, "binary").toString("base64");
  }
  function unb64(str) {
    var s = typeof atob === "function" ? atob(str) : Buffer.from(str, "base64").toString("binary");
    var u8 = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
    return u8;
  }
  function derive(subtle, pin, salt, iter) {
    var enc = new TextEncoder().encode(pin);
    return subtle.importKey("raw", enc, { name: "PBKDF2" }, false, ["deriveBits"]).then(function (k) {
      return subtle.deriveBits({ name: "PBKDF2", salt: salt, iterations: iter, hash: "SHA-256" }, k, 256);
    });
  }
  // → Promise<lock record>
  function makeLock(cryptoObj, pin, iter) {
    if (!pinOk(pin)) return Promise.reject(new Error("pin"));
    var salt = new Uint8Array(16);
    cryptoObj.getRandomValues(salt);
    var it = iter || PIN_ITER;
    return derive(cryptoObj.subtle, pin, salt, it).then(function (bits) {
      return { v: 1, s: b64(salt), h: b64(bits), it: it };
    });
  }
  function readLock(raw) {
    if (!raw || typeof raw !== "object" || raw.v !== 1) return null;
    if (typeof raw.s !== "string" || typeof raw.h !== "string" || typeof raw.it !== "number") return null;
    if (raw.it < 1000 || raw.it > 5000000) return null;
    return raw;
  }
  // → Promise<boolean>; compares without an early exit
  function checkPin(cryptoObj, lock, pin) {
    lock = readLock(lock);
    if (!lock || !pinOk(pin)) return Promise.resolve(false);
    return derive(cryptoObj.subtle, pin, unb64(lock.s), lock.it).then(function (bits) {
      var a = new Uint8Array(bits), b = unb64(lock.h), diff = a.length ^ b.length;
      for (var i = 0; i < Math.min(a.length, b.length); i++) diff |= a[i] ^ b[i];
      return diff === 0;
    });
  }
  // Wrong tries: a growing wait (device-local counter).
  function lockWait(fails) { return fails < 5 ? 0 : Math.min(300, 15 * Math.pow(2, fails - 5)); }

  // ---------- PDF book ----------
  // The days of the book in order: every day with a sentence or a long
  // entry in the year (or all years when year is 0).
  function bookDays(data, C, year) {
    var keys = {};
    Object.keys((data && data.days) || {}).forEach(function (k) { keys[k] = 1; });
    Object.keys((data && data.long) || {}).forEach(function (k) { if (C.hasLong(data, k)) keys[k] = 1; });
    return Object.keys(keys).filter(function (k) { return !year || k.slice(0, 4) === String(year); }).sort().map(function (k) {
      var d = data.days[k], l = C.longOf(data, k);
      return { ymd: k, t: d ? d.t : "", e: d ? d.e : "", md: l.md, ph: l.ph, loc: l.loc, wx: l.wx };
    });
  }

  var API = {
    safeUrl: safeUrl, inline: inline, parseMd: parseMd, runsText: runsText, plain: plain,
    PROMPTS: PROMPTS, TEMPLATE_IDS: TEMPLATE_IDS.slice(), template: template, promptPool: promptPool,
    dailyPrompt: dailyPrompt, insertBlock: insertBlock, questionBlock: questionBlock,
    wxUrl: wxUrl, parseWx: parseWx, geoUrl: geoUrl, parseGeo: parseGeo, wxText: wxText, wxEmoji: wxEmoji,
    wxLine: wxLine, locLine: locLine,
    PIN_ITER: PIN_ITER, pinOk: pinOk, makeLock: makeLock, readLock: readLock, checkPin: checkPin, lockWait: lockWait,
    bookDays: bookDays, LOCK_KEY: "oros-diary-lock"
  };
  if (typeof module === "object" && module.exports) module.exports = API;
  if (root) root.DiaryJournal = API;
})(typeof window !== "undefined" ? window : globalThis);
