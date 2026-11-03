// ============================================================
// orOS Reader — "Summarise" with the Assistant's AI
// Uses the AI the user set up in the Assistant app (their own key for
// Claude, ChatGPT, Gemini…, a server on their computer, or the
// browser's built-in model), the same way Atelier does (atelier/ai.js):
//   - reads the Assistant's choice (oros-assistant-data, merged with
//     the Assistant's own core) and its sealed key (IndexedDB
//     "oros-assistant", opened WITHOUT a version so nothing is ever
//     created; decrypted with the device key exactly as the Assistant
//     does). Never writes either. orOS ships no key of its own.
//   - the question goes from this device straight to that provider,
//     with only the article's title and text (sources.js
//     summaryPrompt), never through an orOS server
//   - the answer is plain text: the caller shows it with textContent
// The Assistant's core (../assistant/core.js) is loaded on first use.
// window.orosFeedsAI:
//   ready()                -> Promise<conf | null>   null = not set up;
//                             the first service of the Assistant's
//                             order that is there (AS-CHAIN; conf.fb = 1
//                             when not the chosen one)
//   ask(conf, q, signal, onText(textSoFar), onSwitch(conf)) -> Promise<text>
//                             rejects ProviderError ("nokey", "net",
//                             "builtin", HTTP status …); a service that
//                             fails before answering hands over to the
//                             next in the order and onSwitch says so
//   errorText(e, conf, t)  -> one line for the user
// conf: { pid, name, model, base, p, fb }
// ============================================================
(function (root) {
  "use strict";

  var ASSIST_DATA = "oros-assistant-data", ASSIST_DB = "oros-assistant";
  var CORE_SRC = "../assistant/core.js";
  try {
    var cs = root.document && root.document.currentScript;
    if (cs && typeof cs.src === "string") {
      var v = /[?](v=[^#]*)/.exec(cs.src);
      if (v) CORE_SRC += "?" + v[1];
    }
  } catch (e) {}

  var coreLoading = null;
  function core() {
    if (root.OrosAssistCore) return Promise.resolve(root.OrosAssistCore);
    if (!coreLoading) {
      coreLoading = new Promise(function (resolve) {
        var s = root.document.createElement("script");
        s.src = CORE_SRC;
        s.async = true;
        s.onload = s.onerror = function () { resolve(); };
        root.document.head.appendChild(s);
      }).then(function () {
        if (!root.OrosAssistCore) coreLoading = null;
        return root.OrosAssistCore || null;
      });
    }
    return coreLoading;
  }

  function assistData(C) {
    try { return C.mergeAssist(JSON.parse(root.localStorage.getItem(ASSIST_DATA) || "null"), null); }
    catch (e) { return C.emptyData(); }
  }
  // → { pid, name, model, base, p } | null (nothing chosen)
  function conf(C, d, pid) {
    pid = pid || (d.set && d.set.prov);
    var p = pid && C.PROVIDERS[pid];
    if (!p) return null;
    var pc = d.provs[pid] || {};
    var model = pc.model || p.model || "";
    if (!model) return null;
    return { pid: pid, name: p.name, model: model, base: C.provBase(pid, pc), p: p };
  }
  // The Assistant's AI: the first service in its order of use that is
  // there on this device (AS-CHAIN), or the chosen one and its online
  // stand-in (AS-FB). cf.fb = 1: not the chosen assistant. Services
  // that just failed are passed over for a while (cool).
  var cool = {};
  // Reader can't run the in-browser model; the browser's own one only
  // when it is ready here (not "downloadable").
  function device(pid) { return pid === "browser" && lmReady(); }
  function lmReady() {
    var api = LM();
    if (!api) return Promise.resolve(false);
    return Promise.resolve().then(function () {
      return typeof api.availability === "function" ? api.availability() : "available";
    }).then(function (a) { return a === "available"; }, function () { return false; });
  }
  function ready() {
    return core().then(function (C) {
      if (!C) return null;
      var d = assistData(C), cf = conf(C, d);
      if (!C.pickChain) return cf;
      return C.pickChain(d, { readKey: readKey, device: device, cool: cool }).then(function (r) {
        var alt = r.pid ? conf(C, d, r.pid) : null;
        if (alt && (alt.p.kind === "webllm")) alt = null;
        if (alt) alt.fb = r.fb;
        return alt || cf;
      });
    }, function () { return null; });
  }

  function readKey(pid) {
    return new Promise(function (resolve) {
      var req;
      try { req = root.indexedDB.open(ASSIST_DB); } catch (e) { resolve(""); return; }
      req.onupgradeneeded = function () { try { req.transaction.abort(); } catch (e) {} };   // none: leave it so
      req.onerror = function (e) { if (e && e.preventDefault) e.preventDefault(); resolve(""); };
      req.onblocked = function () { resolve(""); };
      req.onsuccess = function () {
        var d = req.result;
        function done(v) { try { d.close(); } catch (e) {} resolve(v); }
        if (!d.objectStoreNames.contains("creds") || !d.objectStoreNames.contains("keys")) { done(""); return; }
        var tx = d.transaction(["creds", "keys"], "readonly");
        var rc = tx.objectStore("creds").get(pid), rk = tx.objectStore("keys").get("device");
        tx.oncomplete = function () {
          var rec = rc.result, dk = rk.result;
          if (!rec || !dk) { done(""); return; }
          root.crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(rec.iv) }, dk, rec.data).then(function (plain) {
            done(new TextDecoder().decode(plain));
          }, function () { done(""); });
        };
        tx.onerror = tx.onabort = function () { done(""); };
      };
    });
  }

  function LM() {
    try { return root.LanguageModel && typeof root.LanguageModel.create === "function" ? root.LanguageModel : null; }
    catch (e) { return null; }
  }

  // q: { system, user }. A service that fails before it answers (off,
  // over its limit, busy: core.coolFor) is passed over for a while and
  // the question goes to the next one in the order, at most 3 times;
  // onSwitch(cf) says which one answers then.
  function ask(cf, q, signal, onText, onSwitch, tries) {
    var C = root.OrosAssistCore;
    return askNow(cf, q, signal, onText).catch(function (e) {
      var ms = C.coolFor ? C.coolFor(e) : 0;
      if (!ms || (signal && signal.aborted) || (tries || 0) >= 3) throw e;
      cool[cf.pid] = Date.now() + ms;
      if (cf.p.local && e.code === "net") C.probeSet(cf.base, false);
      return ready().then(function (alt) {
        if (!alt || alt.pid === cf.pid) throw e;
        if (onSwitch) onSwitch(alt);
        return ask(alt, q, signal, onText, onSwitch, (tries || 0) + 1);
      });
    });
  }
  function askNow(cf, q, signal, onText) {
    var C = root.OrosAssistCore;
    var msgs = [{ r: "user", text: q.user }];
    if (cf.p.builtin) {
      var api = LM();
      if (!api) return Promise.reject(new C.ProviderError("builtin"));
      var pr = C.browserPrompts(msgs, q.system), sess = null;
      return Promise.resolve(api.create({ initialPrompts: pr.initial, signal: signal })).then(function (s) {
        sess = s;
        if (typeof s.promptStreaming !== "function") return s.prompt(pr.prompt, { signal: signal });
        var reader = s.promptStreaming(pr.prompt, { signal: signal }).getReader(), text = "";
        function pump() {
          return reader.read().then(function (r) {
            if (r.done) return text;
            text += String(r.value == null ? "" : r.value);
            if (onText) onText(text);
            return pump();
          });
        }
        return pump();
      }).then(function (text) {
        try { if (sess && sess.destroy) sess.destroy(); } catch (e) {}
        return String(text || "");
      }, function (e) {
        try { if (sess && sess.destroy) sess.destroy(); } catch (e2) {}
        throw e;
      });
    }
    return readKey(cf.pid).then(function (key) {
      if (cf.p.key === "yes" && !key) throw new C.ProviderError("nokey");
      var req = C.buildRequest(cf.pid, { key: key, base: cf.base, model: cf.model }, msgs, { system: q.system });
      return fetch(req.url, {
        method: "POST", headers: req.headers, body: JSON.stringify(req.body), signal: signal,
        credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer"
      }).catch(function (e) {
        if (signal && signal.aborted) throw e;
        throw new C.ProviderError("net");
      });
    }).then(function (res) {
      if (!res.ok) return res.text().catch(function () { return ""; }).then(function (b) { throw C.errorFrom(res.status, b); });
      var red = C.makeReducer(cf.pid);
      var sse = C.makeSSE(function (d) {
        var j;
        if (d === "[DONE]") j = d;
        else { try { j = JSON.parse(d); } catch (e) { return; } }
        red.push(j);
        if (onText) onText(red.text());
      });
      if (!res.body || typeof res.body.getReader !== "function") {
        return res.text().then(function (txt) { sse.feed(txt); sse.end(); return red.result().text || ""; });
      }
      var reader = res.body.getReader(), dec = new TextDecoder();
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) { sse.feed(dec.decode()); sse.end(); return red.result().text || ""; }
          sse.feed(dec.decode(r.value, { stream: true }));
          return pump();
        });
      }
      return pump();
    });
  }

  // t: the Reader's own t(key, params)
  function errorText(e, cf, t) {
    if (e && e.code === "nokey") return t("ai.noKey", { name: cf.name });
    var why = e && e.code === "net" ? t("ai.whyNet")
      : e && e.code === "builtin" ? t("ai.whyBuiltin")
      : e && e.status ? "HTTP " + e.status + (e.msg ? " · " + String(e.msg).slice(0, 160) : "")
      : String(e && (e.msg || e.message) || e).slice(0, 160);
    return t("ai.err", { name: cf.name, why: why });
  }

  root.orosFeedsAI = { ready: ready, ask: ask, errorText: errorText };
})(typeof window !== "undefined" ? window : globalThis);
