// Read aloud (readaloud.js, READ-1): the model (prefs, language,
// preparing the text, skipped apps and fields), the same speech
// helpers as Library's, the engine with a stand-in speechSynthesis,
// and the wiring in the shell, the selection menu, Quick settings,
// Settings, the strings and the help pages.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const R = require(path.join(ROOT, "readaloud.js"));
const L = require(path.join(ROOT, "library", "core.js"));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

test("prefs: off unless { v:1, on:1 }; the speed is one of the list", () => {
  assert.deepEqual(R.parsePrefs(null), { on: false, rate: 1 });
  assert.deepEqual(R.parsePrefs("{"), { on: false, rate: 1 });
  assert.deepEqual(R.parsePrefs({ v: 1, on: true }), { on: false, rate: 1 });
  assert.deepEqual(R.parsePrefs(JSON.stringify({ v: 1, on: 1, rate: 1.4 })), { on: true, rate: 1.4 });
  assert.deepEqual(R.parsePrefs({ v: 1, on: 1, rate: 7 }), { on: true, rate: 1 });
  assert.equal(R.prefsRecord({ on: false, rate: 2 }), null, "off = no key at all");
  assert.deepEqual(R.prefsRecord({ on: true, rate: 2 }), { v: 1, on: 1, rate: 2 });
  assert.equal(R.nextRate(2), 0.8);
  assert.equal(R.nextRate(1), 1.2);
});

test("the speech helpers give exactly what Library's give", () => {
  const texts = [
    "Καλημέρα. Τι κάνεις; Όλα καλά! «Ναι», είπε· και έφυγε…",
    "Hello there. How are you? Fine!\nNext line \"quoted.\" (Yes.) Done",
    "Ein Satz. Noch einer? Ja! Ende",
    "a".repeat(700) + " " + "word ".repeat(120),
    "No punctuation at all but quite long " .repeat(20),
    "  \n  ", "", "123. 456; 789"
  ];
  for (const t of texts) {
    for (const lang of ["el", "en", "de"]) {
      const br = [t.indexOf("\n") + 1].filter((x) => x > 0);
      assert.deepEqual(R.speechParts(t, br, lang), L.speechParts(t, br, lang), JSON.stringify(t.slice(0, 20)) + " " + lang);
    }
    assert.equal(R.speechText(t), L.speechText(t));
    assert.equal(R.guessLang(t), L.guessLang(t));
  }
  assert.equal(R.speechText("συνε-\nχίζει και­κάτι"), L.speechText("συνε-\nχίζει και­κάτι"));
  const voices = [
    { lang: "el-GR", localService: false, name: "Google ελληνικά" },
    { lang: "en-US", localService: true, name: "A" },
    { lang: "en-GB", localService: true, default: true, name: "B" },
    { lang: "de_DE", localService: true, name: "C" }
  ];
  for (const l of ["el", "el-GR", "en", "en-US", "en-GB", "de", "de-AT", "fr", ""]) {
    assert.equal(R.localVoice(voices, l), L.localVoice(voices, l), l);
  }
  assert.equal(R.localVoice(voices, "el"), null, "an online voice is never picked");
});

test("language: lang attribute, then the text, then the orOS language", () => {
  assert.equal(R.langOf("Hello", "fr-FR", "en"), "fr-FR");
  assert.equal(R.langOf("Καλημέρα κόσμε", "", "en"), "el");
  assert.equal(R.langOf("Good morning, how are you today?", "", "el"), "en");
  assert.equal(R.langOf("Das ist nicht gut, und ich weiß es.", "", "en"), "de");
  assert.equal(R.langOf("Schöne Grüße", "", "en"), "de");
  assert.equal(R.langOf("12 34 56", "", "el"), "el");
  assert.equal(R.langOf("12 34 56", "", "xx"), "en");
  assert.equal(R.langOf("Hello", "not a tag!", "en"), "en");
  assert.equal(R.germanish("The dog is in the garden and the cat is not."), false);
});

test("prepare: line ends, breaks, at most 20 000 characters", () => {
  assert.deepEqual(R.prepare("  \n "), { text: "", cut: false, breaks: [] });
  const p = R.prepare("One.\r\nTwo.\rThree.");
  assert.equal(p.text, "One.\nTwo.\nThree.");
  assert.deepEqual(p.breaks, [5, 10]);
  const long = R.prepare("word ".repeat(5000));
  assert.ok(long.cut);
  assert.ok(long.text.length <= R.MAX_TEXT);
  assert.equal(R.prepare("x".repeat(100)).cut, false);
});

test("Passwords, password and one-time code fields, data-oros-noclip are never read", () => {
  assert.equal(R.appOk("passwords"), false);
  assert.equal(R.appOk("notes"), true);
  assert.equal(R.appOfPath("/notes/index.html"), "notes");
  assert.equal(R.appOfPath("/oros/writer/"), "writer");
  const elOf = (tag, attrs, inNoclip) => ({
    nodeType: 1, tagName: tag,
    getAttribute: (k) => (attrs && attrs[k]) || null,
    closest: (sel) => (sel === "[data-oros-noclip]" && inNoclip ? {} : null)
  });
  assert.equal(R.fieldSecret(elOf("INPUT", { type: "password" })), true);
  assert.equal(R.fieldSecret(elOf("INPUT", { autocomplete: "one-time-code" })), true);
  assert.equal(R.fieldSecret(elOf("INPUT", { type: "text" })), false);
  assert.equal(R.fieldSecret(elOf("P", {}, true)), true);
  assert.equal(R.fieldSecret(elOf("P", {})), false);
  assert.equal(R.fieldSecret(null), false);
});

// ---------- the engine in a small stand-in page ----------
function engine(opts) {
  opts = opts || {};
  const spoken = [];
  const els = [];
  function mkEl(tag) {
    const e = {
      tagName: tag.toUpperCase(), children: [], attrs: {}, style: {}, hidden: false, textContent: "",
      set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html || ""; },
      setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k] || null; },
      appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
      addEventListener(t, fn) { (this.on = this.on || {})[t] = fn; },
      contains() { return false; }, querySelector() { return null }, focus() {}
    };
    Object.defineProperty(e, "textContent", { get() { return this._t || ""; }, set(v) { this._t = v; if (v === "") this.children = []; } });
    els.push(e);
    return e;
  }
  const doc = {
    activeElement: null, head: mkEl("head"), body: mkEl("body"),
    createElement: mkEl, getElementById: () => null, addEventListener() {}
  };
  const voices = opts.voices || [{ lang: "en-GB", localService: true, name: "Local" }, { lang: "el-GR", localService: true, name: "Τοπική" }];
  const synth = {
    speaking: false, pending: false,
    getVoices: () => voices, addEventListener() {}, removeEventListener() {},
    cancel() { synth.cancelled = (synth.cancelled || 0) + 1; },
    speak(u) { spoken.push(u); }
  };
  let strict = opts.strict || null, strictFn = null, lockFn = null, isLocked = false;
  const toasts = [];
  const win = {
    document: doc, speechSynthesis: synth,
    SpeechSynthesisUtterance: function (text) { this.text = text; },
    t: (k) => k,
    orosStrict: { level: () => strict, onChange: (fn) => { strictFn = fn; } },
    orosLock: { isLocked: () => isLocked, onChange: (fn) => { lockFn = fn; } },
    setTimeout: (fn) => fn()
  };
  win.window = win;
  vm.runInNewContext(read("readaloud.js"), Object.assign(win, { setTimeout: win.setTimeout }));
  const E = win.orosReadEngine;
  let rate = 1;
  E.attach({ frames: () => [], lang: () => "en", rate: () => rate, setRate: (r) => { rate = r; },
             toast: (kind, msg) => toasts.push(msg), changed() {} });
  return {
    E, spoken, toasts, synth,
    end() { const u = spoken[spoken.length - 1]; u.onend(); },
    setStrict(v) { strict = v; strictFn(); },
    lock() { isLocked = true; lockFn(); }
  };
}

test("engine: sentence by sentence with a local voice, next, pause, play, stop", () => {
  const x = engine();
  assert.equal(x.E.read({ text: "One. Two. Three.", lang: "", app: "notes" }), true);
  assert.equal(x.spoken.length, 1);
  assert.equal(x.spoken[0].text, "One.");
  assert.equal(x.spoken[0].voice.name, "Local");
  x.end();
  assert.equal(x.spoken[1].text, "Two.");
  x.E.pause();
  assert.equal(x.E.playing(), false);
  x.E.play();
  assert.equal(x.spoken[2].text, "Two.", "play reads the paused sentence again");
  x.end();
  assert.equal(x.spoken[3].text, "Three.");
  x.end();
  assert.equal(x.E.active(), false, "the end stops");
  assert.equal(x.E.read({ text: "Καλημέρα. Τι κάνεις;", lang: "", app: "notes" }), true);
  assert.equal(x.spoken[4].voice.name, "Τοπική");
  x.E.stop();
  assert.equal(x.E.active(), false);
});

test("engine: refused texts, no local voice, Sensitive work and the lock", () => {
  let x = engine();
  assert.equal(x.E.read(null), false);
  assert.deepEqual(x.toasts, ["ra.nosel"]);
  assert.equal(x.E.read({ text: "secret", app: "notes", secret: true }), false);
  assert.equal(x.E.read({ text: "", app: "passwords" }), false);
  assert.equal(x.toasts.filter((t) => t === "ra.blocked").length, 2);
  assert.equal(x.spoken.length, 0);

  x = engine({ voices: [{ lang: "de-DE", localService: false, name: "Online" }, { lang: "en-GB", localService: true }] });
  x.E.read({ text: "Das ist nicht gut, und ich weiß es.", app: "notes" });
  assert.equal(x.spoken.length, 0, "no local German voice: nothing is read");
  assert.ok(x.toasts.includes("ra.novoice"));

  x = engine({ strict: "on" });
  assert.equal(x.E.read({ text: "Hello.", app: "notes" }), false);
  assert.ok(x.toasts.includes("ra.strict"));

  x = engine();
  x.E.read({ text: "One. Two.", app: "notes" });
  x.setStrict("on");
  assert.equal(x.E.active(), false, "Sensitive work stops it");
  x.E.read({ text: "One. Two.", app: "notes" });
  x.lock();
  assert.equal(x.E.active(), false, "the lock stops it");
});

test("wiring: lazy engine, shortcut, settings, Quick settings, selection menu", () => {
  const shell = read("shell.js"), html = read("index.html");
  assert.ok(!/src="readaloud\.js/.test(html), "not a start-up script");
  assert.match(shell, /sc\.src = "readaloud\.js\?v=" \+ encodeURIComponent\(APP_VERSION\)/);
  assert.match(shell, /\{ id: "read", key: "z", label: "sc\.desc\.read"/);
  assert.match(shell, /read: window\.orosRead \? window\.orosRead\.snapshot\(\) : null/);
  assert.match(shell, /case "readAloud":/);
  assert.match(shell, /case "readRate":/);
  assert.match(shell, /var RA_KEY = "oros-readaloud"/);
  const qm = read("quickmenu.js");
  assert.match(qm, /function selMenuOk\(\) \{ return hasAssistant\(\) \|\| readOn\(\); \}/);
  assert.match(qm, /root\.orosRead\.read\(\{ text: s\.text/);
  assert.match(read("qsettings.js"), /root\.orosRead\.toggle\(\)/);
  const st = read("settings/settings.js");
  assert.match(st, /set\("readAloud", v\)/);
  assert.match(st, /set\("readRate", v\)/);
  const used = new Set(), keys = shell.match(/\{ id: "[a-z-]+",\s+(?:key|code): "[^"]+"/g);
  for (const k of keys) {
    const m = /(key|code): "([^"]+)"/.exec(k);
    assert.ok(!used.has(m[2]), "key " + m[2] + " used twice");
    used.add(m[2]);
  }
});

test("strings in English, Greek and German", () => {
  const keys = ["sc.desc.read", "qs.read", "qs.read.sel", "qs.read.stop", "qm.sel.read", "ra.title", "ra.prev", "ra.next",
    "ra.play", "ra.pause", "ra.stop", "ra.rate", "ra.nosel", "ra.strict", "ra.blocked", "ra.none", "ra.novoice", "ra.fail",
    "ra.cut", "ra.off", "ra.loadfail"];
  const tr = read("translations.js"), de = read("i18n/de/shell.js");
  for (const k of keys) {
    assert.equal(tr.split('"' + k + '":').length - 1, 2, k + " in EN and EL");
    assert.ok(de.includes('"' + k + '":'), k + " in DE");
  }
  const src = read("readaloud.js") + read("shell.js") + read("quickmenu.js") + read("qsettings.js");
  for (const k of (src.match(/["'](ra\.[a-z]+)["']/g) || []).map((s) => s.slice(1, -1))) {
    assert.ok(keys.includes(k), k + " is in the list above");
  }
  const sc = read("settings/core.js"), sde = read("i18n/de/settings.js");
  for (const k of ["ac.read", "ac.read.on", "ac.read.hint", "ac.read.rate", "ac.read.none", "ac.read.strict", "w.readaloud", "w.readaloud-rate"]) {
    assert.equal(sc.split('"' + k + '":').length - 1, 2, k + " in Settings EN and EL");
    assert.ok(sde.includes('"' + k + '":'), k + " in Settings DE");
  }
});

test("help: Shortcuts and Settings pages in every language", () => {
  for (const f of ["help/topics/shortcuts.en.txt", "help/topics/shortcuts.el.txt", "i18n/de/help/topics/shortcuts.txt",
    "settings/help.en.txt", "settings/help.el.txt", "i18n/de/help/settings.txt"]) {
    assert.match(read(f), /Ctrl\+Alt\+Shift\+Z/, f);
  }
});
