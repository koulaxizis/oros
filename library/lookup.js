// ============================================================
// orOS Library — look up and ask (v1.1.0)
// Select a word or a passage while reading and pick "Look up":
//   - a word (up to three) gets its meanings from Wiktionary, only
//     after you turn online lookups on (device-local, LIB.prefs.dict);
//     the word alone is sent, to en.wiktionary.org, and the answer is
//     shown as plain text (core.dictParse);
//   - "Ask the Assistant" opens the orOS Assistant with a question
//     about the word or passage ready (core.askText); nothing is sent
//     until you send it there.
// The book's details have "Ask the Assistant" about the whole book.
// ============================================================
(function () {
  "use strict";

  var LIB = window.LIB, C = LIB.C, t = LIB.t, el = LIB.el;
  var cache = {};

  function fetchDefs(word) {
    if (cache[word]) return Promise.resolve(cache[word]);
    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 8000);
    function get(w) {
      return fetch(C.dictUrl(w), { credentials: "omit", referrerPolicy: "no-referrer", signal: ctl ? ctl.signal : undefined })
        .then(function (r) {
          if (r.status === 404) return null;
          if (!r.ok) throw new Error("http");
          return r.json();
        });
    }
    // as selected, then in lower case ("Θάλασσα" at the start of a sentence)
    return get(word).then(function (j) {
      if (j || word === word.toLowerCase()) return j;
      return get(word.toLowerCase());
    }).then(function (j) {
      clearTimeout(timer);
      cache[word] = j || {};
      return cache[word];
    }, function (e) { clearTimeout(timer); throw e; });
  }

  function canAsk() {
    var p = LIB.parentWin();
    try { return !!(p && typeof p.__orosOpenAt === "function"); } catch (e) { return false; }
  }
  function ask(text) {
    if (!LIB.openApp("assistant", { ask: text })) LIB.toast(t("look.askFail"));
  }

  // sel: the reader's selection { q, pre, suf }; book: its record.
  function open(sel, book, pct) {
    var word = C.dictWord(sel.q);
    var dlg = LIB.dialog("lb-lookup", word || t("look.passage"), "small");
    var body = el("div", "lk-body");
    dlg.appendChild(body);
    if (!word) body.appendChild(el("p", "lk-quote", "“" + C.squash(sel.q).trim().slice(0, 600) + "”"));
    var acts = el("div", "dlg-actions wrap");
    if (canAsk()) {
      acts.appendChild(LIB.textBtn("btn" + (word ? "" : " primary"), t("look.ask"), function () {
        dlg.close();
        var lang = LIB.LANG;
        if (word) ask(C.askText("word", book, { word: word, quote: sel.sent || (sel.pre || "") + sel.q + (sel.suf || "") }, lang));
        else ask(C.askText("passage", book, { quote: sel.q, pct: pct }, lang));
      }));
    }
    if (word) {
      acts.appendChild(LIB.textBtn("btn", t("look.wiki"), function () {
        try { var w = window.open(C.dictPage(word, (book.lang || LIB.LANG).split("-")[0]), "_blank", "noopener,noreferrer"); if (w) w.opener = null; } catch (e) {}
      }));
    }
    dlg.appendChild(acts);
    if (word) defs();
    dlg.showModal();

    function defs() {
      body.textContent = "";
      if (!LIB.prefs.dict) {
        body.appendChild(el("p", "dlg-text", t("look.offer")));
        var on = LIB.textBtn("btn primary", t("look.turnOn"), function () {
          LIB.prefs.dict = true;
          LIB.savePrefs();
          defs();
        });
        var row = el("div", "lk-on");
        row.appendChild(on);
        body.appendChild(row);
        return;
      }
      if (navigator.onLine === false) { body.appendChild(el("p", "hint", t("look.offline"))); return; }
      var wait = el("p", "hint", t("look.loading"));
      body.appendChild(wait);
      fetchDefs(word).then(function (j) {
        if (!dlg.open) return;
        body.textContent = "";
        var list = C.dictParse(j, book.lang || LIB.LANG);
        if (!list.length) body.appendChild(el("p", "hint", t("look.none")));
        list.forEach(function (sec) {
          body.appendChild(el("h3", "lk-lang", sec.name));
          sec.items.forEach(function (it) {
            if (it.pos) body.appendChild(el("p", "lk-pos", it.pos));
            var ol = el("ol", "lk-defs");
            it.defs.forEach(function (d) {
              var li = el("li", "", d.d);
              if (d.ex) li.appendChild(el("span", "lk-ex", d.ex));
              ol.appendChild(li);
            });
            body.appendChild(ol);
          });
        });
        var src = el("p", "hint lk-src", t("look.source"));
        var off = LIB.textBtn("link-btn", t("look.turnOff"), function () {
          LIB.prefs.dict = false;
          LIB.savePrefs();
          defs();
        });
        src.appendChild(document.createTextNode(" "));
        src.appendChild(off);
        body.appendChild(src);
      }, function () {
        if (!dlg.open) return;
        body.textContent = "";
        body.appendChild(el("p", "hint", t("look.fail")));
      });
    }
  }

  // The whole book, from its details.
  function askBook(book) {
    ask(C.askText("book", book, { pct: C.progressOf(LIB.data, book.id) }, LIB.LANG));
  }

  LIB.lookup = { open: open, askBook: askBook, canAsk: canAsk };
})();
