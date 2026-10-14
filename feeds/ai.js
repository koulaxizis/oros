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
//   ready()                -> Promise<conf | null>   null = not set up
//   ask(conf, q, signal, onText(textSoFar)) -> Promise<text>
//                             rejects ProviderError ("nokey", "net",
//                             "builtin", HTTP status …)
//   errorText(e, conf, t)  -> one line for the user
// conf: { pid, name, model, base, p }
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

  // → { pid, name, model, base, p } | null (nothing chosen)
  function conf(C) {
    var d;
    try { d = C.mergeAssist(JSON.parse(root.localStorage.getItem(ASSIST_DATA) || "null"), null); }
    catch (e) { d = C.emptyData(); }
    var pid = d.set && d.set.prov;
    var p = pid && C.PROVIDERS[pid];
    if (!p) return null;
    var pc = d.provs[pid] || {};
    var model = pc.model || p.model || "";
    if (!model) return null;
    return { pid: pid, name: p.name, model: model, base: C.provBase(pid, pc), p: p };
  }
  function ready() {
    return core().then(function (C) { return C ? conf(C) : null; }, function () { return null; });
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

  // q: { system, user }
  function ask(cf, q, signal, onText) {
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
