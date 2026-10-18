// ============================================================
// orOS Atelier — ai.js: AI in Atelier (v1.1.0)
//   - words: write / shorten / lengthen / fix / change the tone /
//     translate a text box, write a new text, ideas for a whole page
//     (new words + a colour palette). These use the AI the user set
//     up in the Assistant app (their own key for Claude, ChatGPT,
//     Gemini…, a local server, the browser's built-in model, or the
//     Assistant's in-browser model (WebLLM, run here in a worker of
//     its own once the Assistant has downloaded it)):
//     Atelier reads the Assistant's choice (oros-assistant-data) and
//     its sealed key (IndexedDB "oros-assistant") and never writes
//     either. The request goes from this device straight to that
//     provider, like in the Assistant, with only the text in question.
//   - pictures: remove a photo's background, always on this device
//     (cutout.js), nothing is uploaded.
// The "AI" drawer tab holds all of it; the text and photo context
// bars have a shortcut each.
// ============================================================
(function () {
  "use strict";

  var AT = window.AT, t = AT.t, el = AT.el, ED = AT.ed, M = AT.M, A = AT.A;
  var AIT = window.AtelierAIText, CUT = window.AtelierCutout;

  var STR = {
    en: {
      "ai.k.write": "Write it for me…", "ai.k.shorter": "Shorter", "ai.k.longer": "Longer",
      "ai.k.fix": "Fix spelling", "ai.k.formal": "More formal", "ai.k.friendly": "Friendlier",
      "ai.k.translate": "Translate to Greek", "ai.k.translateEl": "Translate to English",
      "ai.writeAsk": "What should it say?", "ai.writePh": "e.g. a summer sale, 20% off, ends Sunday",
      "ai.asking": "Asking {name}…", "ai.use": "Use this", "ai.add": "Add to the page", "ai.again": "Try again",
      "ai.stop": "Stop", "ai.empty": "The answer was empty. Try again.",
      "ai.sent": "Only this text goes to {name}, straight from this device.",
      "ai.none": "Atelier uses the AI you set up in the Assistant app: your own key (Claude, ChatGPT, Gemini…), a free online provider, a server on your computer, or a model that runs in the browser.",
      "ai.noneBtn": "Set up in the Assistant", "ai.noAssistant": "The Assistant app is needed for this.",
      "ai.using": "Words: {name} · {model}", "ai.change": "Change in the Assistant",
      "ai.noKey": "There is no key for {name} on this device. Add it in the Assistant.",
      "ai.ideas": "Ideas for this page", "ai.ideasHint": "New words for every text box on this page, keeping the layout.",
      "ai.topic": "What is it about? (optional)", "ai.topicPh": "e.g. opening of a bakery in Thessaloniki",
      "ai.colours": "New colours too", "ai.getIdeas": "Get ideas", "ai.ideasNone": "No text boxes on this page.",
      "ai.ideasBad": "The answer could not be read. Try again.", "ai.idea": "Idea {n}", "ai.applied": "Idea applied",
      "ai.newText": "Write a new text", "ai.newHint": "A new text box, written for you.",
      "ai.write": "Write",
      "ai.cutHint": "Select a photo on the page to remove its background, erase something from it or grab its subject.",
      "ai.cutNeed": "Runs on this device: the picture is not sent anywhere. The first time, Atelier downloads the tool (about {mb} MB); after that it works offline.",
      "ai.cutGo": "Download and remove", "ai.cutLoad": "Downloading the tool… {p}%", "ai.cutRun": "Removing the background…",
      "ai.cutEdge": "Keep more · keep less", "ai.cutDone": "Background removed", "ai.cutFail": "The background could not be removed ({why}).",
      "ai.cutVideo": "Not for videos.", "ai.cutLittle": "Hardly anything was left: try “Keep more”.",
      "ai.cutReady": "The background tool is on this device ({mb} MB).", "ai.cutForget": "Remove the picture tools",
      "ai.cutGone": "The picture tools were removed from this device.", "ai.cutMissing": "Downloads once (about {mb} MB) the first time you use it.",
      "ai.err": "{name} did not answer: {why}",
      "ai.wlName": "In-browser model", "ai.here": "Runs on this device: the text is not sent anywhere.",
      "ai.wlGet": "the model is not on this device yet: download it once in the Assistant (Settings › In-browser model)",
      "ai.wlGpu": "this browser has no WebGPU (use a recent Chrome or Edge)",
      "ai.wlSpace": "there is not enough memory or space for this model",
      "ai.net": "no connection", "ai.builtin": "the browser's model is not available", "ai.noPic": "picture not found"
    },
    el: {
      "ai.k.write": "Γράψ' το εσύ…", "ai.k.shorter": "Πιο σύντομο", "ai.k.longer": "Πιο μεγάλο",
      "ai.k.fix": "Διόρθωση ορθογραφίας", "ai.k.formal": "Πιο επίσημο", "ai.k.friendly": "Πιο φιλικό",
      "ai.k.translate": "Μετάφραση στα Ελληνικά", "ai.k.translateEl": "Μετάφραση στα Αγγλικά",
      "ai.writeAsk": "Τι να λέει;", "ai.writePh": "π.χ. καλοκαιρινές εκπτώσεις 20%, μέχρι την Κυριακή",
      "ai.asking": "Ρωτάω το {name}…", "ai.use": "Χρήση", "ai.add": "Προσθήκη στη σελίδα", "ai.again": "Ξανά",
      "ai.stop": "Διακοπή", "ai.empty": "Η απάντηση ήταν κενή. Δοκίμασε ξανά.",
      "ai.sent": "Μόνο αυτό το κείμενο πηγαίνει στο {name}, απευθείας από αυτή τη συσκευή.",
      "ai.none": "Το Ατελιέ χρησιμοποιεί το AI που έχεις ρυθμίσει στον Βοηθό: δικό σου κλειδί (Claude, ChatGPT, Gemini…), δωρεάν πάροχο στο διαδίκτυο, διακομιστή στον υπολογιστή σου ή μοντέλο που τρέχει μέσα στον browser.",
      "ai.noneBtn": "Ρύθμιση στον Βοηθό", "ai.noAssistant": "Χρειάζεται η εφαρμογή Βοηθός.",
      "ai.using": "Κείμενα: {name} · {model}", "ai.change": "Αλλαγή στον Βοηθό",
      "ai.noKey": "Δεν υπάρχει κλειδί για το {name} σε αυτή τη συσκευή. Πρόσθεσέ το στον Βοηθό.",
      "ai.ideas": "Ιδέες για αυτή τη σελίδα", "ai.ideasHint": "Νέα κείμενα σε κάθε πλαίσιο της σελίδας, με την ίδια διάταξη.",
      "ai.topic": "Για τι είναι; (προαιρετικό)", "ai.topicPh": "π.χ. εγκαίνια φούρνου στη Θεσσαλονίκη",
      "ai.colours": "Και νέα χρώματα", "ai.getIdeas": "Πάρε ιδέες", "ai.ideasNone": "Δεν υπάρχουν κείμενα σε αυτή τη σελίδα.",
      "ai.ideasBad": "Η απάντηση δεν διαβάστηκε. Δοκίμασε ξανά.", "ai.idea": "Ιδέα {n}", "ai.applied": "Η ιδέα εφαρμόστηκε",
      "ai.newText": "Γράψε νέο κείμενο", "ai.newHint": "Ένα νέο πλαίσιο κειμένου, γραμμένο για σένα.",
      "ai.write": "Γράψε",
      "ai.cutHint": "Διάλεξε μια φωτογραφία στη σελίδα για να αφαιρέσεις το φόντο της, να σβήσεις κάτι ή να πιάσεις το θέμα της.",
      "ai.cutNeed": "Γίνεται σε αυτή τη συσκευή: η εικόνα δεν στέλνεται πουθενά. Την πρώτη φορά το Ατελιέ κατεβάζει το εργαλείο (περίπου {mb} MB)· μετά δουλεύει και χωρίς σύνδεση.",
      "ai.cutGo": "Λήψη και αφαίρεση", "ai.cutLoad": "Λήψη του εργαλείου… {p}%", "ai.cutRun": "Αφαιρώ το φόντο…",
      "ai.cutEdge": "Κράτα περισσότερο · λιγότερο", "ai.cutDone": "Το φόντο αφαιρέθηκε", "ai.cutFail": "Το φόντο δεν αφαιρέθηκε ({why}).",
      "ai.cutVideo": "Όχι για βίντεο.", "ai.cutLittle": "Δεν έμεινε σχεδόν τίποτα: δοκίμασε «Κράτα περισσότερο».",
      "ai.cutReady": "Το εργαλείο φόντου είναι σε αυτή τη συσκευή ({mb} MB).", "ai.cutForget": "Αφαίρεση των εργαλείων εικόνας",
      "ai.cutGone": "Τα εργαλεία εικόνας αφαιρέθηκαν από τη συσκευή.", "ai.cutMissing": "Κατεβαίνει μία φορά (περίπου {mb} MB) την πρώτη φορά που θα το χρησιμοποιήσεις.",
      "ai.err": "Το {name} δεν απάντησε: {why}",
      "ai.wlName": "Μοντέλο μέσα στον browser", "ai.here": "Γίνεται σε αυτή τη συσκευή: το κείμενο δεν στέλνεται πουθενά.",
      "ai.wlGet": "το μοντέλο δεν είναι ακόμα σε αυτή τη συσκευή: κατέβασέ το μία φορά στον Βοηθό (Ρυθμίσεις › Μοντέλο μέσα στον browser)",
      "ai.wlGpu": "αυτός ο browser δεν έχει WebGPU (χρησιμοποίησε πρόσφατο Chrome ή Edge)",
      "ai.wlSpace": "δεν υπάρχει αρκετή μνήμη ή χώρος για αυτό το μοντέλο",
      "ai.net": "δεν υπάρχει σύνδεση", "ai.builtin": "το μοντέλο του browser δεν είναι διαθέσιμο", "ai.noPic": "η εικόνα δεν βρέθηκε"
    }
  };
  // into Atelier's strings; a pack language gets its lines (core.js AT.addStrings)
  AT.addStrings(STR);

  // ---------- 1. The Assistant's AI ----------
  var ASSIST_DATA = "oros-assistant-data", ASSIST_DB = "oros-assistant";
  function C() { return window.OrosAssistCore || null; }

  // → { pid, name, model, base, p } | null (nothing chosen)
  function conf() {
    var core = C();
    if (!core) return null;
    var d;
    try { d = core.mergeAssist(JSON.parse(localStorage.getItem(ASSIST_DATA) || "null"), null); }
    catch (e) { d = core.emptyData(); }
    var pid = d.set && d.set.prov;
    var p = pid && core.PROVIDERS[pid];
    if (!p) return null;
    var pc = d.provs[pid] || {};
    var model = pc.model || p.model || "";
    if (p.kind === "webllm" && core.webllmModel && !core.webllmModel(model)) model = p.model;
    if (!model) return null;
    var name = p.kind === "webllm" ? t("ai.wlName") : p.name;
    return { pid: pid, name: name, model: model, base: core.provBase(pid, pc), p: p };
  }

  // The Assistant's key for pid, read from its IndexedDB without
  // ever creating or changing it. → string ("" = none)
  function readKey(pid) {
    return new Promise(function (resolve) {
      var req;
      try { req = indexedDB.open(ASSIST_DB); } catch (e) { resolve(""); return; }
      req.onupgradeneeded = function () { try { req.transaction.abort(); } catch (e) {} };   // it does not exist: leave it so
      req.onerror = function () { resolve(""); };
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
          crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(rec.iv) }, dk, rec.data).then(function (plain) {
            done(new TextDecoder().decode(plain));
          }, function () { done(""); });
        };
        tx.onerror = tx.onabort = function () { done(""); };
      };
    });
  }

  function LM() {
    try { return window.LanguageModel && typeof window.LanguageModel.create === "function" ? window.LanguageModel : null; }
    catch (e) { return null; }
  }

  // ---------- The Assistant's in-browser model (WebLLM) ----------
  // Same library, worker and Cache Storage ("webllm/model") as the
  // Assistant, so a model downloaded there is used here as it is.
  // Atelier never downloads one: a model that is not cached yet only
  // says where to get it. The engine stays loaded while Atelier is open.
  var WL_SRC = "../vendor/webllm/web-llm-0.2.86.js", WL_WORKER = "../assistant/webllm-worker.js";
  var wl = { lib: null, engine: null, worker: null, model: "", loading: null };
  function wlGpu() { try { return !!navigator.gpu; } catch (e) { return false; } }
  function wlCached(model) {
    if (typeof caches === "undefined") return Promise.resolve(false);
    return caches.has("webllm/model").then(function (has) {
      if (!has) return false;
      return caches.open("webllm/model").then(function (c) { return c.keys(); }).then(function (keys) {
        return keys.some(function (r) { return r.url.indexOf("/" + model + "/") >= 0; });
      });
    }).catch(function () { return false; });
  }
  function wlDrop() {
    try { if (wl.engine && wl.engine.unload) wl.engine.unload(); } catch (e) {}
    try { if (wl.worker) wl.worker.terminate(); } catch (e) {}
    wl.engine = null; wl.worker = null; wl.model = "";
  }
  function wlEngine(model) {
    if (wl.engine && wl.model === model) return Promise.resolve(wl.engine);
    if (wl.loading && wl.loading.model === model) return wl.loading.p;
    wlDrop();
    if (!wl.lib) wl.lib = import(WL_SRC).catch(function (e) { wl.lib = null; throw e; });
    var p = wl.lib.then(function (lib) {
      wl.worker = new Worker(new URL(WL_WORKER, location.href), { type: "module" });
      return lib.CreateWebWorkerMLCEngine(wl.worker, model, {});
    }).then(function (engine) {
      wl.engine = engine; wl.model = model; wl.loading = null;
      return engine;
    }, function (e) { wl.loading = null; wlDrop(); throw e; });
    wl.loading = { model: model, p: p };
    return p;
  }
  function wlAsk(cf, system, user, signal, onText) {
    var core = C(), engine = null;
    function err(code, msg) { return new core.ProviderError(code, msg || ""); }
    if (!wlGpu()) return Promise.reject(err("webgpu"));
    function stop() { try { if (engine) engine.interruptGenerate(); } catch (e) {} }
    if (signal) signal.addEventListener("abort", stop);
    return wlCached(cf.model).then(function (yes) {
      if (!yes) throw err("wlget");
      return wlEngine(cf.model);
    }).then(function (eng) {
      engine = eng;
      if (signal && signal.aborted) throw new DOMException("Aborted", "AbortError");
      var req = { messages: core.webllmMessages([{ r: "user", text: user }], system), stream: true };
      if (/^Qwen3/.test(cf.model)) req.extra_body = { enable_thinking: false };   // no thinking out loud
      return eng.chat.completions.create(req);
    }).then(function (chunks) {
      var red = core.makeReducer("webllm"), it = chunks[Symbol.asyncIterator]();
      function pump() {
        return it.next().then(function (r) {
          if (signal && signal.aborted) throw new DOMException("Aborted", "AbortError");
          if (r.done) return red.result().text || "";
          red.push(r.value);
          if (onText) onText(red.text());
          return pump();
        });
      }
      return pump();
    }).then(function (text) {
      if (signal) signal.removeEventListener("abort", stop);
      return text;
    }, function (e) {
      if (signal) signal.removeEventListener("abort", stop);
      if (signal && signal.aborted) throw e;
      if (e instanceof core.ProviderError) throw e;
      var m = String(e && e.message || e || "");
      throw /webgpu|adapter|gpu/i.test(m) ? err("webgpu", m.slice(0, 200))
        : /memory|quota|storage/i.test(m) ? err("wlspace", m.slice(0, 200))
        : err("server", m.slice(0, 200));
    });
  }

  // One question → the answer's text. onText(text so far) as it streams.
  function ask(cf, system, user, signal, onText) {
    var core = C();
    var msgs = [{ r: "user", text: user }];
    if (cf.p.kind === "webllm") return wlAsk(cf, system, user, signal, onText);
    if (cf.p.builtin) {
      var api = LM();
      if (!api) return Promise.reject(new core.ProviderError("builtin"));
      var pr = core.browserPrompts(msgs, system), sess = null;
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
      if (cf.p.key === "yes" && !key) throw new core.ProviderError("nokey");
      var req = core.buildRequest(cf.pid, { key: key, base: cf.base, model: cf.model }, msgs, { system: system });
      return fetch(req.url, {
        method: "POST", headers: req.headers, body: JSON.stringify(req.body), signal: signal,
        credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer"
      }).catch(function (e) {
        if (signal && signal.aborted) throw e;
        throw new core.ProviderError("net");
      });
    }).then(function (res) {
      if (!res.ok) return res.text().catch(function () { return ""; }).then(function (b) { throw core.errorFrom(res.status, b); });
      var red = core.makeReducer(cf.pid);
      var sse = core.makeSSE(function (d) {
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

  function errText(e, cf) {
    var core = C();
    if (e && e.code === "nokey") return t("ai.noKey", { name: cf.name });
    var why = e && e.code === "net" ? t("ai.net")
      : e && e.code === "builtin" ? t("ai.builtin")
      : e && e.code === "wlget" ? t("ai.wlGet")
      : e && e.code === "webgpu" ? t("ai.wlGpu")
      : e && e.code === "wlspace" ? t("ai.wlSpace")
      : e && e.status ? "HTTP " + e.status + (e.msg ? " · " + String(e.msg).slice(0, 160) : "")
      : String(e && (e.msg || e.message) || e).slice(0, 160);
    void core;
    return t("ai.err", { name: cf.name, why: why });
  }

  function openAssistant() {
    try {
      var p = window.parent;
      if (p && p !== window && typeof p.__orosOpenAt === "function") { p.__orosOpenAt("assistant", {}); return; }
    } catch (e) {}
    AT.toast(t("ai.noAssistant"));
  }

  // The AI to use, or the "set it up" dialog.
  function need(then) {
    var cf = conf();
    if (cf) { then(cf); return; }
    AT.openDialog(t("ai.menu"), function (body, close) {
      body.appendChild(el("p", "hint", t("ai.none")));
      var act = el("div", "dlg-actions");
      var c = el("button", "btn", t("btn.cancel")); c.type = "button";
      var o = el("button", "btn primary", t("ai.noneBtn")); o.type = "button";
      c.addEventListener("click", close);
      o.addEventListener("click", function () { close(); openAssistant(); });
      act.appendChild(c); act.appendChild(o);
      body.appendChild(act);
    });
  }

  // ---------- 2. Answer dialog ----------
  // spec: { title, system, user, actions: [{ label, primary, fn(text) }],
  //         post(text) → text (clean) }
  function answer(cf, spec) {
    var dlg = AT.$("dlg"), ctl = null;
    AT.openDialog(spec.title, function (body, close) {
      var note = el("p", "hint ai-note", cf.p.device ? t("ai.here") : t("ai.sent", { name: cf.name }));
      var out = el("div", "ai-out");
      out.setAttribute("aria-live", "polite");
      var stat = el("p", "hint ai-stat");
      var act = el("div", "dlg-actions");
      var stop = el("button", "btn", t("ai.stop")); stop.type = "button";
      var again = el("button", "btn", t("ai.again")); again.type = "button";
      var useBtns = spec.actions.map(function (a) {
        var b = el("button", "btn" + (a.primary ? " primary" : ""), a.label); b.type = "button"; b.disabled = true;
        b.addEventListener("click", function () { var v = out.textContent; close(); a.fn(v); });
        return b;
      });
      stop.addEventListener("click", function () { if (ctl) ctl.abort(); else close(); });
      again.addEventListener("click", run);
      act.appendChild(stop); act.appendChild(again);
      useBtns.forEach(function (b) { act.appendChild(b); });
      body.appendChild(note); body.appendChild(out); body.appendChild(stat); body.appendChild(act);
      function run() {
        if (ctl) ctl.abort();
        var my = ctl = new AbortController();
        out.textContent = ""; out.classList.add("busy");
        stat.textContent = t("ai.asking", { name: cf.name });
        again.disabled = true; stop.textContent = t("ai.stop");
        useBtns.forEach(function (b) { b.disabled = true; });
        ask(cf, spec.system, spec.user, my.signal, function (txt) { if (ctl === my) out.textContent = txt; }).then(function (txt) {
          if (ctl !== my) return;
          var v = spec.post ? spec.post(txt) : txt;
          out.textContent = v;
          stat.textContent = v ? "" : t("ai.empty");
          useBtns.forEach(function (b) { b.disabled = !v; });
        }, function (e) {
          if (ctl !== my) return;
          stat.textContent = my.signal.aborted ? "" : errText(e, cf);
        }).then(function () {
          if (ctl !== my) return;
          ctl = null; out.classList.remove("busy");
          again.disabled = false; stop.textContent = t("btn.cancel");
        });
      }
      run();
    }, true);
    dlg.addEventListener("close", function () { if (ctl) { ctl.abort(); ctl = null; } }, { once: true });
  }

  // ---------- 3. Text boxes ----------
  function textMenu(anchor, it) {
    var gr = AIT.isGreek(it.ax.tx || "");
    AT.menu(anchor, AIT.KINDS.map(function (k) {
      var label = k === "translate" ? t(gr ? "ai.k.translateEl" : "ai.k.translate") : t("ai.k." + k);
      return { label: label, fn: function () { rewriteText(k, it.id); } };
    }));
  }
  function rewriteText(kind, id, askText) {
    need(function (cf) {
      var it = AT.doc && M.find(AT.doc.items, id);
      if (!it) return;
      if (kind === "write" && askText === undefined) {
        askFor(t("ai.k.write").replace(/…$/, ""), function (v) { rewriteText("write", id, v); });
        return;
      }
      var q = AIT.rewrite(kind, it.ax.tx || "", { ask: askText, lang: AT.LANG });
      answer(cf, {
        title: kind === "translate" ? t(AIT.isGreek(it.ax.tx || "") ? "ai.k.translateEl" : "ai.k.translate") : t("ai.k." + kind).replace(/…$/, ""),
        system: q.system, user: q.user, post: AIT.clean,
        actions: [{ label: t("ai.use"), primary: true, fn: function (v) {
          AT.editItems([id], function (x) { x.ax.tx = v; });
        } }]
      });
    });
  }
  // a multi-line question
  function askFor(title, done) {
    AT.openDialog(title, function (body, close) {
      var f = el("label", "fld");
      f.appendChild(el("span", "fld-lbl", t("ai.writeAsk")));
      var ta = el("textarea", "inp ai-ta"); ta.rows = 3; ta.maxLength = 2000; ta.placeholder = t("ai.writePh");
      f.appendChild(ta);
      body.appendChild(f);
      var act = el("div", "dlg-actions");
      var c = el("button", "btn", t("btn.cancel")); c.type = "button";
      var o = el("button", "btn primary", t("ai.write")); o.type = "button";
      c.addEventListener("click", close);
      o.addEventListener("click", function () { if (!ta.value.trim()) { ta.focus(); return; } close(); done(ta.value.trim()); });
      ta.addEventListener("keydown", function (e) { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) o.click(); });
      act.appendChild(c); act.appendChild(o); body.appendChild(act);
      setTimeout(function () { ta.focus(); }, 0);
    });
  }
  function newText(askText) {
    need(function (cf) {
      var q = AIT.rewrite("write", "", { ask: askText, lang: AT.LANG });
      answer(cf, {
        title: t("ai.newText"), system: q.system, user: q.user, post: AIT.clean,
        actions: [{ label: t("ai.add"), primary: true, fn: function (v) {
          var P = AT.doc.setup;
          var size = Math.max(10, Math.round(Math.min(P.w, P.h) / (v.length > 80 ? 22 : 12)));
          ED.add({ k: "text", tx: v, size: size, fc: "#000000", autoW: 1 });
        } }]
      });
    });
  }

  // ---------- 4. Ideas for a page ----------
  var ideasSt = { busy: null, list: [], err: "", base: null, slots: [], pg: null, doc: null };
  function getIdeas(topic, colours) {
    need(function (cf) {
      var slots = AIT.slotsOf(AT.doc, ED.pg);
      if (!slots.length) { AT.toast(t("ai.ideasNone")); return; }
      if (ideasSt.busy) ideasSt.busy.abort();
      var ctl = new AbortController();
      // the page as it is now: every idea is applied onto this
      var base = {};
      AT.doc.items.forEach(function (it) { if (it.pg === ED.pg) base[it.id] = JSON.parse(JSON.stringify(it.ax)); });
      ideasSt = { busy: ctl, list: [], err: "", base: base, slots: slots, pg: ED.pg, doc: AT.doc.id, cf: cf, colours: colours };
      AT.renderDrawer();
      var q = AIT.ideas(topic, slots, { colors: colours, lang: AT.LANG });
      ask(cf, q.system, q.user, ctl.signal, null).then(function (txt) {
        if (ideasSt.busy !== ctl) return;
        ideasSt.list = AIT.parseIdeas(txt, slots);
        if (!ideasSt.list.length) ideasSt.err = t("ai.ideasBad");
      }, function (e) {
        if (ideasSt.busy !== ctl) return;
        ideasSt.err = ctl.signal.aborted ? "" : errText(e, cf);
      }).then(function () {
        if (ideasSt.busy !== ctl) return;
        ideasSt.busy = null;
        AT.renderDrawer();
      });
    });
  }
  function applyIdea(idea) {
    var st = ideasSt;
    if (!AT.doc || AT.doc.id !== st.doc) return;
    var ok = AT.op(function (d, nw) {
      var was = {};
      // back to the page as it was when the ideas came
      d.items.forEach(function (it) {
        var b = st.base[it.id];
        if (!b || it.pg !== st.pg || !it.ax) return;
        was[it.id] = JSON.stringify(it);
        ["tx", "fc", "sc", "g", "tfx"].forEach(function (k) {
          if (b[k] === undefined) delete it.ax[k]; else it.ax[k] = JSON.parse(JSON.stringify(b[k]));
        });
      });
      st.slots.forEach(function (s, i) {
        var it = M.find(d.items, s.id);
        if (it && it.ax && it.ax.k === "text") it.ax.tx = idea.texts[i];
      });
      if (st.colours && idea.colors.length) AIT.recolor(d, st.pg, idea.colors);
      // stamp only what really changed (the same idea twice is no change)
      d.items.forEach(function (it) {
        if (!was[it.id]) return;
        if (it.ax.k === "text") it.h = AT.AX.textHeight(M.normItem(it) || it);
        if (JSON.stringify(it) !== was[it.id]) M.touch(it, nw);
      });
    });
    if (ok) AT.toast(t("ai.applied"), t("btn.undo"), AT.undo);
  }

  // ---------- 5. Background removal ----------
  function cutout(id) {
    var it = AT.doc && M.find(AT.doc.items, id);
    if (!it || !it.ax || it.ax.k !== "photo" || !it.a) { AT.toast(t("ai.cutHint")); return; }
    if (it.ax.vid) { AT.toast(t("ai.cutVideo")); return; }
    CUT.ready().then(function (have) {
      var dlg = AT.$("dlg"), ctl = new AbortController(), res = null, lo = CUT.LO;
      AT.openDialog(t("ai.cut"), function (body, close) {
        var stat = el("p", "hint ai-stat");
        var stage = el("div", "ai-cut-stage ai-checker");
        stage.hidden = true;
        var edge = el("label", "fld ai-edge"); edge.hidden = true;
        edge.appendChild(el("span", "fld-lbl", t("ai.cutEdge")));
        var rng = el("input", "rng"); rng.type = "range"; rng.min = "0"; rng.max = "60"; rng.value = String(Math.round(lo * 100));
        rng.setAttribute("aria-label", t("ai.cutEdge"));
        edge.appendChild(rng);
        var act = el("div", "dlg-actions");
        var c = el("button", "btn", t("btn.cancel")); c.type = "button";
        var go = el("button", "btn primary", have ? t("ai.cut") : t("ai.cutGo")); go.type = "button";
        c.addEventListener("click", close);
        act.appendChild(c); act.appendChild(go);
        var needP = have ? null : body.appendChild(el("p", "hint", t("ai.cutNeed", { mb: CUT.APPROX_MB })));
        body.appendChild(stage); body.appendChild(edge); body.appendChild(stat); body.appendChild(act);
        function preview() {
          var cv = res.render(lo, 480);
          cv.className = "ai-cut-img";
          stage.innerHTML = ""; stage.appendChild(cv);
          stat.textContent = cv.kept < 0.01 ? t("ai.cutLittle") : "";
        }
        var pend = 0;
        rng.addEventListener("input", function () {
          lo = Number(rng.value) / 100;
          if (!res || pend) return;
          pend = requestAnimationFrame(function () { pend = 0; preview(); });
        });
        function start() {
          go.disabled = true;
          stat.textContent = have ? t("ai.cutRun") : t("ai.cutLoad", { p: 0 });
          A.load(it.a).then(function (img) {
            if (!img) throw new Error(t("ai.noPic"));
            return CUT.cut(img, {
              signal: ctl.signal,
              onProgress: function (p) { if (!have) stat.textContent = t("ai.cutLoad", { p: Math.round(p * 100) }); },
              onRun: function () { stat.textContent = t("ai.cutRun"); }
            });
          }).then(function (r) {
            if (ctl.signal.aborted) return;
            res = r; have = true; cutHave = true;
            if (needP) needP.hidden = true;
            stage.hidden = false; edge.hidden = false;
            preview();
            go.textContent = t("ai.use"); go.disabled = false;
          }, function (e) {
            if (ctl.signal.aborted) return;
            stat.textContent = t("ai.cutFail", { why: String(e && e.message || e).slice(0, 120) });
            go.disabled = false;
          });
        }
        go.addEventListener("click", function () {
          if (!res) { start(); return; }
          go.disabled = true;
          var cv = res.render(lo);
          cv.toBlob(function (blob) {
            if (!blob) { stat.textContent = t("ai.cutFail", { why: "PNG" }); go.disabled = false; return; }
            var nm = (it.nm || "picture").replace(/\.[a-z0-9]+$/i, "") + "-cutout.png";
            A.importFile(new File([blob], nm, { type: "image/png" })).then(function (r) {
              close();
              AT.noteUpload(r.id);
              AT.editItems([id], function (x) { x.a = r.id; x.iw = r.w; x.ih = r.h; });
              AT.emit("rc-note", { op: "cutout" });
              AT.toast(t("ai.cutDone"), t("btn.undo"), AT.undo);
            }, function (e) {
              stat.textContent = t("ai.cutFail", { why: e && e.message === "nofs" ? t("img.nofs") : String(e && e.message || e).slice(0, 120) });
              go.disabled = false;
            });
          }, "image/png");
        });
        if (have) start();
      }, true);
      dlg.addEventListener("close", function () { ctl.abort(); }, { once: true });
    });
  }

  // ---------- 6. The AI tab ----------
  function sec(title, hint) {
    var s = el("div", "pn-sec");
    if (title) s.appendChild(el("div", "pn-h", title));
    if (hint) s.appendChild(el("p", "hint", hint));
    return s;
  }
  function button(cls, label, fn) {
    var b = el("button", cls, label); b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }
  var draft = { topic: "", colours: true, text: "" };
  var cutHave = null;
  function view(body) {
    var cf = conf();
    // ideas
    var s1 = sec(t("ai.ideas"), t("ai.ideasHint"));
    var f = el("label", "fld");
    f.appendChild(el("span", "fld-lbl", t("ai.topic")));
    var ta = el("textarea", "inp ai-ta"); ta.rows = 2; ta.maxLength = 2000; ta.placeholder = t("ai.topicPh"); ta.value = draft.topic;
    ta.addEventListener("input", function () { draft.topic = ta.value; });
    f.appendChild(ta); s1.appendChild(f);
    var ck = el("label", "chk");
    var cb = el("input"); cb.type = "checkbox"; cb.checked = draft.colours;
    cb.addEventListener("change", function () { draft.colours = cb.checked; });
    ck.appendChild(cb); ck.appendChild(el("span", "", t("ai.colours")));
    s1.appendChild(ck);
    var busy = !!ideasSt.busy;
    var gb = button("btn primary block", busy ? t("ai.asking", { name: (ideasSt.cf || cf || { name: "AI" }).name }) : t("ai.getIdeas"), function () { getIdeas(draft.topic, draft.colours); });
    gb.disabled = busy;
    s1.appendChild(gb);
    if (ideasSt.err) s1.appendChild(el("p", "hint ai-err", ideasSt.err));
    if (AT.doc && ideasSt.doc === AT.doc.id && ideasSt.pg === ED.pg) {
      ideasSt.list.forEach(function (idea, i) {
        var card = el("button", "ai-idea");
        card.type = "button";
        card.appendChild(el("strong", "ai-idea-name", idea.name || t("ai.idea", { n: i + 1 })));
        idea.texts.slice(0, 3).forEach(function (tx, j) {
          card.appendChild(el("span", "ai-idea-tx" + (j === 0 ? " big" : ""), tx.replace(/\n+/g, " ").slice(0, 120)));
        });
        if (idea.colors.length && ideasSt.colours) {
          var sw = el("span", "ai-idea-pal");
          idea.colors.forEach(function (c) { var d = el("i", ""); d.style.background = c; sw.appendChild(d); });
          card.appendChild(sw);
        }
        card.addEventListener("click", function () { applyIdea(idea); });
        s1.appendChild(card);
      });
    }
    body.appendChild(s1);

    // a new text
    var s2 = sec(t("ai.newText"), t("ai.newHint"));
    var ta2 = el("textarea", "inp ai-ta"); ta2.rows = 2; ta2.maxLength = 2000; ta2.placeholder = t("ai.writePh"); ta2.value = draft.text;
    ta2.setAttribute("aria-label", t("ai.writeAsk"));
    ta2.addEventListener("input", function () { draft.text = ta2.value; });
    s2.appendChild(ta2);
    s2.appendChild(button("btn block", t("ai.write"), function () {
      if (!draft.text.trim()) { ta2.focus(); return; }
      newText(draft.text.trim());
    }));
    var sel = ED.selItems ? ED.selItems() : [];
    var one = sel.length === 1 ? sel[0] : null;
    if (one && one.ax.k === "text") s2.appendChild(button("btn block", t("ai.menu") + "…", function (e) { textMenu(e.currentTarget, one); }));
    body.appendChild(s2);

    // a picture from a description (imagine.js)
    if (AT.imagine) AT.imagine.section(body);

    // picture tools: background, Magic eraser, Magic grab
    var s3 = sec(t("ai.pics"));
    if (one && one.ax.k === "photo" && !one.ax.vid) {
      s3.appendChild(button("btn primary block", t("ai.cut"), function () { cutout(one.id); }));
      if (AT.magic) {
        s3.appendChild(button("btn block", t("ai.erase"), function () { AT.magic.erase(one.id); }));
        s3.appendChild(button("btn block", t("ai.grab"), function () { AT.magic.grab(one.id); }));
        if (AT.magic.edit) {
          s3.appendChild(button("btn block", t("ai.edit"), function () { AT.magic.edit(one.id); }));
          s3.appendChild(button("btn block", t("ai.expand"), function () { AT.magic.expand(one.id); }));
        }
      }
    } else s3.appendChild(el("p", "hint", t("ai.cutHint")));
    var st = el("p", "hint");
    s3.appendChild(st);
    function showHave() {
      st.textContent = cutHave ? t("ai.cutReady", { mb: CUT.APPROX_MB }) : t("ai.cutMissing", { mb: CUT.APPROX_MB });
      if (cutHave && !s3.querySelector(".ai-forget")) {
        s3.appendChild(button("btn small ai-forget", t("ai.cutForget"), function () {
          CUT.forget().then(function () { cutHave = false; AT.toast(t("ai.cutGone")); AT.renderDrawer(); });
        }));
      }
    }
    if (cutHave === null) CUT.ready().then(function (h) { cutHave = h; showHave(); });
    else showHave();
    body.appendChild(s3);

    // which AI
    var s4 = sec();
    if (cf) {
      var wm = cf.p.kind === "webllm" && C().webllmModel && C().webllmModel(cf.model);
      s4.appendChild(el("p", "hint", t("ai.using", { name: cf.name, model: wm ? wm.name : cf.model })));
      s4.appendChild(button("btn small", t("ai.change"), openAssistant));
    } else {
      s4.appendChild(el("p", "hint", t("ai.none")));
      s4.appendChild(button("btn small", t("ai.noneBtn"), openAssistant));
    }
    body.appendChild(s4);
  }
  AT.registerView("ai", view);

  AT.ai = { textMenu: textMenu, rewriteText: rewriteText, newText: newText, cutout: cutout, conf: conf, readKey: readKey,
    need: need, ask: ask, errText: errText, openAssistant: openAssistant };
})();
