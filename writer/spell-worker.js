// ============================================================
// orOS Writer — spelling worker
// Loads a Hunspell dictionary only when it is first needed, keeps the
// downloaded files in IndexedDB ("oros-writer-spell") so later visits
// (and offline use) never download them again, and answers checks and
// suggestions off the page's main thread. The dictionaries are NOT in
// the service-worker precache (about 2.3 MB for both).
// Messages in:  {op:"load", lang} · {op:"check", id, lang, words[]} ·
//               {op:"suggest", id, lang, word}
// Messages out: {op:"loaded", lang, ok, err?} · {op:"checked", id,
//               lang, bad[]} · {op:"suggested", id, list[]}
// ============================================================
/* global importScripts, WriterSpell */
"use strict";
importScripts("spell.js");

var DICT_VER = "1";   // bump when a dictionary file changes
var BASE = "../vendor/hunspell/";
var FILES = {
  en: { aff: "en_US.aff", dic: "en_US.dic.gz" },
  el: { aff: "el_GR.aff", dic: "el_GR.dic.gz" }
};
var dicts = {};     // lang → WriterSpell.Dictionary
var loading = {};   // lang → Promise

/* ----- IndexedDB cache (files as downloaded) ----- */
var dbP = null;
function db() {
  if (dbP) return dbP;
  dbP = new Promise(function (res) {
    try {
      var rq = indexedDB.open("oros-writer-spell", 1);
      rq.onupgradeneeded = function () { rq.result.createObjectStore("files"); };
      rq.onsuccess = function () { res(rq.result); };
      rq.onerror = function () { res(null); };
      rq.onblocked = function () { res(null); };
    } catch (e) { res(null); }
  });
  return dbP;
}
function idbGet(key) {
  return db().then(function (d) {
    if (!d) return null;
    return new Promise(function (res) {
      try {
        var rq = d.transaction("files", "readonly").objectStore("files").get(key);
        rq.onsuccess = function () { res(rq.result || null); };
        rq.onerror = function () { res(null); };
      } catch (e) { res(null); }
    });
  });
}
function idbPut(key, val) {
  return db().then(function (d) {
    if (!d) return;
    return new Promise(function (res) {
      try {
        var tx = d.transaction("files", "readwrite");
        tx.objectStore("files").put(val, key);
        // drop the files of older dictionary versions
        var all = tx.objectStore("files").getAllKeys();
        all.onsuccess = function () {
          (all.result || []).forEach(function (k) {
            if (String(k).split("@")[1] !== DICT_VER) tx.objectStore("files").delete(k);
          });
        };
        tx.oncomplete = function () { res(); };
        tx.onerror = function () { res(); };
      } catch (e) { res(); }
    });
  });
}

function getFile(name) {
  var key = name + "@" + DICT_VER;
  return idbGet(key).then(function (buf) {
    if (buf) return buf;
    return fetch(BASE + name).then(function (r) {
      if (!r.ok) throw new Error("http " + r.status);
      return r.arrayBuffer();
    }).then(function (b) { return idbPut(key, b).then(function () { return b; }); });
  });
}

// .gz → bytes (a server that already unpacked it is fine too)
function gunzip(buf) {
  var u8 = new Uint8Array(buf);
  if (!(u8[0] === 0x1f && u8[1] === 0x8b)) return Promise.resolve(buf);
  return new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
}

function encodingOf(affBuf) {
  var head = new TextDecoder("latin1").decode(new Uint8Array(affBuf).subarray(0, 4096));
  var m = /^SET\s+(\S+)/m.exec(head);
  var set = m ? m[1].toUpperCase() : "UTF-8";
  var mm = /^ISO-?8859-?(\d+)$/.exec(set);
  if (mm) return "iso-8859-" + mm[1];
  if (/^KOI8-?R$/.test(set)) return "koi8-r";
  if (/^(MICROSOFT-)?CP-?1253$/.test(set)) return "windows-1253";
  return "utf-8";
}

function load(lang) {
  if (dicts[lang]) return Promise.resolve(dicts[lang]);
  if (loading[lang]) return loading[lang];
  var f = FILES[lang];
  if (!f) return Promise.reject(new Error("no dictionary"));
  loading[lang] = Promise.all([getFile(f.aff), getFile(f.dic).then(gunzip)]).then(function (bufs) {
    var enc = encodingOf(bufs[0]);
    var dec = new TextDecoder(enc);
    dicts[lang] = new WriterSpell.Dictionary(dec.decode(bufs[0]), dec.decode(bufs[1]));
    return dicts[lang];
  });
  loading[lang].catch(function () { delete loading[lang]; });
  return loading[lang];
}

self.onmessage = function (ev) {
  var m = ev.data || {};
  if (m.op === "load") {
    load(m.lang).then(function () { self.postMessage({ op: "loaded", lang: m.lang, ok: true }); },
      function (e) { self.postMessage({ op: "loaded", lang: m.lang, ok: false, err: String(e && e.message || e) }); });
  } else if (m.op === "check") {
    load(m.lang).then(function (d) {
      var bad = [];
      (m.words || []).forEach(function (w) { if (!d.spell(w)) bad.push(w); });
      self.postMessage({ op: "checked", id: m.id, lang: m.lang, bad: bad });
    }, function () { self.postMessage({ op: "checked", id: m.id, lang: m.lang, bad: [], failed: true }); });
  } else if (m.op === "suggest") {
    load(m.lang).then(function (d) {
      self.postMessage({ op: "suggested", id: m.id, list: d.suggest(m.word, 6) });
    }, function () { self.postMessage({ op: "suggested", id: m.id, list: [] }); });
  }
};
