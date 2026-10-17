// ============================================================
// orOS — assistant/imgai.js: image AI providers (v1.0.0)
// Shared by the Assistant (Settings › Image AI: choose, key, test)
// and Atelier (Image from text; Magic edit and Magic expand). The
// choice is kept on this device only (localStorage IMG_PREF); keys
// are the Assistant's own sealed keys (IndexedDB "oros-assistant"),
// under the id in `keyId`: the same key as the text provider where
// the service is the same (OpenAI, Hugging Face, Pollinations).
// Every request goes from this device straight to the provider (or
// the user's own computer), with only the description and, to edit,
// the picture and its mask. No Google service is offered.
// build*() are pure (unit-tested); run() needs fetch.
// ============================================================
(function (root) {
  "use strict";

  var IMG_PREF = "oros-assistant-img";
  var MAX_PROMPT = 2000;

  // kind: how to call it. key: "yes" | "opt" | "no". mask: can fill a
  // painted part (Magic edit). expand: can grow a picture (Magic
  // expand). n: pictures per request.
  var PROVIDERS = {
    pollinations: {
      name: "Pollinations", kind: "pollinations", key: "opt", keyId: "pollinations", free: 1, n: 1,
      base: "https://gen.pollinations.ai", freeBase: "https://image.pollinations.ai",
      keyUrl: "https://enter.pollinations.ai/", model: "flux"
    },
    huggingface: {
      name: "Hugging Face", kind: "hf", key: "yes", keyId: "huggingface", free: 1, n: 1,
      base: "https://router.huggingface.co/hf-inference/models",
      keyUrl: "https://huggingface.co/settings/tokens", model: "black-forest-labs/FLUX.1-schnell"
    },
    openai: {
      name: "OpenAI (gpt-image-1)", kind: "openai", key: "yes", keyId: "openai", n: 4, mask: 1, expand: 1,
      base: "https://api.openai.com/v1", keyUrl: "https://platform.openai.com/api-keys", model: "gpt-image-1"
    },
    stability: {
      name: "Stability AI", kind: "stability", key: "yes", keyId: "stability", n: 1, mask: 1, expand: 1,
      base: "https://api.stability.ai", keyUrl: "https://platform.stability.ai/account/keys", model: "core"
    },
    sdwebui: {
      name: "Stable Diffusion WebUI / Forge", kind: "sdwebui", key: "no", local: 1, n: 4, mask: 1, expand: 1,
      base: "", defaultBase: "http://127.0.0.1:7860", model: ""
    }
  };
  var IDS = ["pollinations", "huggingface", "openai", "stability", "sdwebui"];
  // Key ids the Assistant keeps for image AI only (the others are the
  // text providers' own).
  var KEY_EXTRA = ["stability"];

  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function str(v, max) { return typeof v === "string" ? v.slice(0, max) : ""; }
  function normBase(u) {
    u = str(u, 300).trim().replace(/\/+$/, "");
    return /^https?:\/\/[^\s\/?#@]+(\/[^\s?#]*)?$/i.test(u) ? u : "";
  }
  // The device-local choice: { prov, base, model }
  function normPref(x) {
    x = isObj(x) ? x : {};
    var prov = PROVIDERS[x.prov] && IDS.indexOf(x.prov) >= 0 ? x.prov : "";
    return { prov: prov, base: normBase(x.base), model: str(x.model, 200).trim() };
  }
  function readPref(ls) {
    try { return normPref(JSON.parse((ls || root.localStorage).getItem(IMG_PREF) || "null")); }
    catch (e) { return normPref(null); }
  }
  function writePref(p, ls) {
    try { (ls || root.localStorage).setItem(IMG_PREF, JSON.stringify(normPref(p))); return true; } catch (e) { return false; }
  }
  // → { pid, p, base, model } | null
  function conf(pref) {
    pref = normPref(pref);
    var p = PROVIDERS[pref.prov];
    if (!p) return null;
    return { pid: pref.prov, p: p, base: p.local ? (pref.base || p.defaultBase) : p.base, model: pref.model || p.model };
  }

  // The choice, or the free default (Pollinations) when none is made.
  function use(pref) { return conf(pref) || conf({ prov: "pollinations" }); }

  // A style word added to the description (English: the models read
  // English best). "" = as written.
  var STYLES = {
    photo: "realistic photo, natural light, high detail",
    illus: "flat vector illustration, clean shapes",
    paint: "watercolour painting, soft paper texture",
    three: "3D render, soft studio light",
    sketch: "pencil sketch, hand drawn",
    pixel: "pixel art, 8-bit"
  };
  var STYLE_IDS = ["", "photo", "illus", "paint", "three", "sketch", "pixel"];
  function styled(prompt, style) {
    prompt = str(prompt, MAX_PROMPT).trim();
    return STYLES[style] && prompt ? prompt + ", " + STYLES[style] : prompt;
  }

  // The page shape → the size to ask for.
  function sizeFor(pid, w, h) {
    var r = w > 0 && h > 0 ? w / h : 1;
    if (pid === "openai") return r > 1.2 ? "1536x1024" : r < 0.83 ? "1024x1536" : "1024x1024";
    if (pid === "stability") {
      var list = [["21:9", 21 / 9], ["16:9", 16 / 9], ["3:2", 1.5], ["5:4", 1.25], ["1:1", 1], ["4:5", 0.8], ["2:3", 2 / 3], ["9:16", 9 / 16], ["9:21", 9 / 21]];
      var best = list[0];
      list.forEach(function (a) { if (Math.abs(Math.log(a[1] / r)) < Math.abs(Math.log(best[1] / r))) best = a; });
      return best[0];
    }
    // the rest take pixels: long side 1024, multiples of 64
    var lw = r >= 1 ? 1024 : Math.round(1024 * r / 64) * 64, lh = r >= 1 ? Math.round(1024 / r / 64) * 64 : 1024;
    return Math.max(256, lw) + "x" + Math.max(256, lh);
  }

  // A request: { url, method, headers, json | form | none, reply }
  //   reply: "json-b64" (OpenAI data[].b64_json), "sd-b64" (images[]),
  //          "image" (the body is the picture)
  // form: [[name, value | { blob, name }]] (multipart, built by run)
  function buildGenerate(cf, key, opts) {
    var pid = cf.pid, prompt = str(opts.prompt, MAX_PROMPT).trim(), n = Math.max(1, Math.min(cf.p.n, opts.n || 1));
    var size = sizeFor(pid, opts.w, opts.h), wh = size.split("x");
    var auth = key ? { Authorization: "Bearer " + key } : {};
    if (pid === "pollinations") {
      var q = "?model=" + encodeURIComponent(cf.model || "flux") + "&width=" + wh[0] + "&height=" + wh[1] +
        "&nologo=true&private=true&seed=" + (opts.seed != null ? opts.seed : Math.floor(Math.random() * 1e9));
      return key
        ? { url: cf.p.base + "/image/" + encodeURIComponent(prompt) + q, method: "GET", headers: auth, reply: "image" }
        : { url: cf.p.freeBase + "/prompt/" + encodeURIComponent(prompt) + q, method: "GET", headers: {}, reply: "image" };
    }
    if (pid === "huggingface") {
      return { url: cf.base + "/" + cf.model.split("/").map(encodeURIComponent).join("/"), method: "POST",
        headers: Object.assign({ "Content-Type": "application/json", Accept: "image/png" }, auth),
        json: { inputs: prompt, parameters: { width: +wh[0], height: +wh[1] } }, reply: "image" };
    }
    if (pid === "openai") {
      return { url: cf.base + "/images/generations", method: "POST",
        headers: Object.assign({ "Content-Type": "application/json" }, auth),
        json: { model: cf.model || "gpt-image-1", prompt: prompt, n: n, size: size }, reply: "json-b64" };
    }
    if (pid === "stability") {
      return { url: cf.base + "/v2beta/stable-image/generate/" + (cf.model || "core"), method: "POST",
        headers: Object.assign({ Accept: "image/*" }, auth),
        form: [["prompt", prompt], ["aspect_ratio", size], ["output_format", "png"]], reply: "image" };
    }
    if (pid === "sdwebui") {
      return { url: cf.base + "/sdapi/v1/txt2img", method: "POST", headers: { "Content-Type": "application/json" },
        json: { prompt: prompt, width: +wh[0], height: +wh[1], batch_size: n, steps: 25 }, reply: "sd-b64" };
    }
    return null;
  }

  // Fill a painted part (Magic edit). image / mask: PNG blobs of the
  // same size. mask: transparent (alpha 0) = to fill, the OpenAI way;
  // the others get a black-and-white copy (white = fill) from the
  // caller in maskBw. b64: the same picture and mask as base64 (WebUI).
  function buildEdit(cf, key, opts) {
    var pid = cf.pid, prompt = str(opts.prompt, MAX_PROMPT).trim();
    var auth = key ? { Authorization: "Bearer " + key } : {};
    if (pid === "openai") {
      return { url: cf.base + "/images/edits", method: "POST", headers: auth,
        form: [["model", cf.model || "gpt-image-1"], ["prompt", prompt], ["n", String(Math.max(1, Math.min(4, opts.n || 1)))],
               ["image", { blob: opts.image, name: "image.png" }], ["mask", { blob: opts.mask, name: "mask.png" }]],
        reply: "json-b64" };
    }
    if (pid === "stability") {
      return { url: cf.base + "/v2beta/stable-image/edit/inpaint", method: "POST", headers: Object.assign({ Accept: "image/*" }, auth),
        form: [["prompt", prompt], ["image", { blob: opts.image, name: "image.png" }], ["mask", { blob: opts.maskBw, name: "mask.png" }],
               ["output_format", "png"]], reply: "image" };
    }
    if (pid === "sdwebui") {
      return { url: cf.base + "/sdapi/v1/img2img", method: "POST", headers: { "Content-Type": "application/json" },
        json: { prompt: prompt, init_images: [opts.imageB64], mask: opts.maskB64, inpainting_fill: 1, inpaint_full_res: false,
                denoising_strength: 0.85, mask_blur: 4, batch_size: Math.max(1, Math.min(4, opts.n || 1)), steps: 25,
                width: opts.w, height: opts.h }, reply: "sd-b64" };
    }
    return null;
  }

  // Grow a picture (Magic expand): pad = { left, right, up, down } in
  // pixels. Stability has its own call; the others fill the empty
  // border of a bigger canvas the caller made (edit).
  function buildExpand(cf, key, opts) {
    if (cf.pid !== "stability") return buildEdit(cf, key, opts);
    var auth = key ? { Authorization: "Bearer " + key } : {}, pad = opts.pad || {};
    var form = [["image", { blob: opts.original, name: "image.png" }], ["output_format", "png"]];
    if (opts.prompt) form.push(["prompt", str(opts.prompt, MAX_PROMPT)]);
    ["left", "right", "up", "down"].forEach(function (k) { if (pad[k] > 0) form.push([k, String(Math.min(2000, Math.round(pad[k])))]); });
    return { url: cf.base + "/v2beta/stable-image/edit/outpaint", method: "POST", headers: Object.assign({ Accept: "image/*" }, auth),
      form: form, reply: "image" };
  }

  // A cheap request that shows whether the key / address works.
  function buildTest(cf, key) {
    var auth = key ? { Authorization: "Bearer " + key } : {};
    if (cf.pid === "pollinations") return null;               // nothing to check without generating
    if (cf.pid === "huggingface") return { url: "https://huggingface.co/api/whoami-v2", method: "GET", headers: auth };
    if (cf.pid === "openai") return { url: cf.base + "/models", method: "GET", headers: auth };
    if (cf.pid === "stability") return { url: cf.base + "/v1/user/balance", method: "GET", headers: auth };
    if (cf.pid === "sdwebui") return { url: cf.base + "/sdapi/v1/sd-models", method: "GET", headers: {} };
    return null;
  }

  // ---------- Network ----------
  function ImageError(code, msg, status) { this.code = code; this.msg = msg || ""; this.status = status || 0; }
  ImageError.prototype.toString = function () { return this.code + (this.msg ? ": " + this.msg : ""); };

  function b64Blob(b64, type) {
    var bin = atob(String(b64).replace(/^data:[^,]*,/, "")), u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return new Blob([u], { type: type || "image/png" });
  }
  // → Promise<Blob[]>
  function run(req, signal) {
    if (!req) return Promise.reject(new ImageError("unsupported"));
    var init = { method: req.method, headers: req.headers || {}, signal: signal, credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" };
    if (req.json) init.body = JSON.stringify(req.json);
    else if (req.form) {
      var fd = new FormData();
      req.form.forEach(function (f) { if (f[1] && f[1].blob) fd.append(f[0], f[1].blob, f[1].name); else fd.append(f[0], f[1]); });
      init.body = fd;
    }
    return fetch(req.url, init).catch(function (e) {
      if (signal && signal.aborted) throw e;
      throw new ImageError("net");
    }).then(function (res) {
      if (!res.ok) {
        return res.text().catch(function () { return ""; }).then(function (b) {
          var m = "";
          try { var j = JSON.parse(b); m = (j.error && (j.error.message || j.error)) || j.errors || j.message || j.detail || ""; } catch (e) { m = b; }
          throw new ImageError(res.status === 401 || res.status === 403 ? "key" : res.status === 402 || res.status === 429 ? "limit" : "http",
            String(typeof m === "string" ? m : JSON.stringify(m)).slice(0, 200), res.status);
        });
      }
      if (!req.reply) return [];
      if (req.reply === "image") return res.blob().then(function (b) {
        if (!/^image\//.test(b.type || "image/")) throw new ImageError("bad");
        return [b];
      });
      return res.json().then(function (j) {
        var list = req.reply === "json-b64" ? (j.data || []).map(function (d) { return d.b64_json; }) : (j.images || []);
        list = list.filter(function (x) { return typeof x === "string" && x; });
        if (!list.length) throw new ImageError("bad");
        return list.map(function (x) { return b64Blob(x, "image/png"); });
      });
    });
  }

  var api = {
    IMG_PREF: IMG_PREF, PROVIDERS: PROVIDERS, IDS: IDS, KEY_EXTRA: KEY_EXTRA,
    normPref: normPref, readPref: readPref, writePref: writePref, conf: conf, use: use,
    STYLES: STYLES, STYLE_IDS: STYLE_IDS, styled: styled, MAX_PROMPT: MAX_PROMPT, sizeFor: sizeFor,
    buildGenerate: buildGenerate, buildEdit: buildEdit, buildExpand: buildExpand, buildTest: buildTest,
    run: run, ImageError: ImageError, b64Blob: b64Blob
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosImageAI = api;
})(typeof window !== "undefined" ? window : this);
