// ============================================================
// orOS — assistant/imgai.js: image AI providers (v1.3.0)
// v1.3.0 (AI-MARK, EU AI Act art. 50(2)): every picture an AI makes or
// redraws here comes back marked in a machine-readable way: XMP with
// the IPTC digital source type (trainedAlgorithmicMedia for a new
// picture, compositeWithTrainedAlgorithmicMedia for an edit) in PNG,
// JPEG and WebP. A picture that already carries the provider's own
// C2PA Content Credentials (OpenAI) is kept byte for byte, since any
// change would break their signature; they already say it is AI.
// markBytes / markBlob / isAIBytes are also used by Atelier and Photo
// Lab when they export a design or picture with AI parts.
// v1.2.0 (PL-AI): ComfyUI on the owner's computer; WebUI upscale.
// Shared by the Assistant (Settings › Image AI: choose, key, test)
// and Atelier (Image from text; Magic edit and Magic expand). The
// choice is kept on this device only (localStorage IMG_PREF); keys
// are the Assistant's own sealed keys (IndexedDB "oros-assistant"),
// under the id in `keyId`: the same key as the text provider where
// the service is the same (OpenAI, Hugging Face, Pollinations).
// AI Horde (the free default since v1.1.0) needs no account: with no
// key it sends the anonymous key, and a free AI Horde key only gives
// a place further up its volunteers' queue.
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
    horde: {
      name: "AI Horde", kind: "horde", key: "opt", keyId: "horde", free: 1, n: 2,
      base: "https://aihorde.net/api/v2", keyUrl: "https://aihorde.net/register", model: "AlbedoBase XL (SDXL)"
    },
    pollinations: {
      // A secret key (sk_) is needed: since 2026 Pollinations answers
      // 401 without one and is paid with Pollen (gen.pollinations.ai).
      name: "Pollinations", kind: "pollinations", key: "yes", keyId: "pollinations", n: 1,
      base: "https://gen.pollinations.ai",
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
      name: "Stable Diffusion WebUI / Forge", kind: "sdwebui", key: "no", local: 1, n: 4, mask: 1, expand: 1, upscale: 1,
      base: "", defaultBase: "http://127.0.0.1:7860", model: ""
    },
    // PL-AI (Chris 2026-11-22): ComfyUI on the owner's computer, run with
    // --enable-cors-header; model = the checkpoint's file name there.
    comfyui: {
      name: "ComfyUI", kind: "comfyui", key: "no", local: 1, n: 1, mask: 1, expand: 1,
      base: "", defaultBase: "http://127.0.0.1:8188", model: "sd_xl_base_1.0.safetensors"
    }
  };
  var IDS = ["horde", "pollinations", "huggingface", "openai", "stability", "sdwebui", "comfyui"];
  var COMFY_WAIT = 900000, COMFY_POLL = 2000;   // a CPU may take minutes
  // Key ids the Assistant keeps for image AI only (the others are the
  // text providers' own).
  var KEY_EXTRA = ["stability", "horde"];
  // AI Horde: the anonymous key, and how this app names itself there
  // (the Horde asks every client for a Client-Agent).
  var HORDE_ANON = "0000000000", HORDE_AGENT = "orOS:1.1:https://useoros.online";
  var HORDE_WAIT = 300000, HORDE_POLL = 3000;

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

  // The choice, or the free default (AI Horde) when none is made.
  function use(pref) { return conf(pref) || conf({ prov: "horde" }); }

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
    if (pid === "horde") {
      return { url: cf.base + "/generate/async", method: "POST", headers: hordeHeaders(key, true),
        json: { prompt: prompt, params: { width: +wh[0], height: +wh[1], steps: 20, n: n, sampler_name: "k_euler_a", cfg_scale: 6 },
                models: cf.model ? [cf.model] : [], nsfw: false, censor_nsfw: true, r2: false, shared: false },
        reply: "horde" };
    }
    if (pid === "pollinations") {
      var q = "?model=" + encodeURIComponent(cf.model || "flux") + "&width=" + wh[0] + "&height=" + wh[1] +
        "&nologo=true&private=true&seed=" + (opts.seed != null ? opts.seed : Math.floor(Math.random() * 1e9));
      return { url: cf.p.base + "/image/" + encodeURIComponent(prompt) + q, method: "GET", headers: auth, reply: "image" };
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
    if (pid === "comfyui") return { url: cf.base + "/prompt", method: "POST", headers: { "Content-Type": "application/json" },
      json: { prompt: comfyFlow(cf.model, prompt, +wh[0], +wh[1], opts.seed, null) }, reply: "comfy" };
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
    if (pid === "comfyui") {
      // the picture and the mask (transparent = change, as for OpenAI) are uploaded first (run)
      return { url: cf.base + "/prompt", method: "POST", headers: { "Content-Type": "application/json" },
        json: { prompt: comfyFlow(cf.model, prompt, 0, 0, opts.seed, { image: "@image", mask: "@mask" }) }, reply: "comfy",
        uploads: [["@image", { blob: opts.image, name: "oros-image.png" }], ["@mask", { blob: opts.mask, name: "oros-mask.png" }]] };
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

  // PL-AI: a sharper, bigger copy (Stable Diffusion WebUI's extras).
  // b64: the picture as a data URL; f: 2-4.
  function buildUpscale(cf, opts) {
    if (cf.pid !== "sdwebui") return null;
    return { url: cf.base + "/sdapi/v1/extra-single-image", method: "POST", headers: { "Content-Type": "application/json" },
      json: { image: opts.b64, upscaling_resize: Math.max(1, Math.min(4, +opts.f || 2)), upscaler_1: opts.upscaler || "R-ESRGAN 4x+" }, reply: "sd-one" };
  }

  // ComfyUI's API graph: SDXL text to picture, or (inp: uploaded names)
  // the masked part of a picture redrawn (VAEEncodeForInpaint; the
  // mask's alpha: transparent = change).
  function comfyFlow(model, prompt, w, h, seed, inp) {
    var g = {
      "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: model || "sd_xl_base_1.0.safetensors" } },
      "6": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["4", 1] } },
      "7": { class_type: "CLIPTextEncode", inputs: { text: "blurry, low quality, watermark, text", clip: ["4", 1] } },
      "3": { class_type: "KSampler", inputs: { seed: seed != null ? seed : Math.floor(Math.random() * 1e9), steps: 20, cfg: 6, sampler_name: "euler", scheduler: "normal",
        denoise: 1, model: ["4", 0], positive: ["6", 0], negative: ["7", 0], latent_image: ["5", 0] } },
      "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
      "9": { class_type: "SaveImage", inputs: { filename_prefix: "orOS", images: ["8", 0] } }
    };
    if (inp) {
      g["10"] = { class_type: "LoadImage", inputs: { image: inp.image } };
      g["11"] = { class_type: "LoadImageMask", inputs: { image: inp.mask, channel: "alpha" } };
      g["5"] = { class_type: "VAEEncodeForInpaint", inputs: { pixels: ["10", 0], vae: ["4", 2], mask: ["11", 0], grow_mask_by: 8 } };
    } else g["5"] = { class_type: "EmptyLatentImage", inputs: { width: w, height: h, batch_size: 1 } };
    return g;
  }

  // AI-MARK: which mark a request's pictures get ("gen" new, "edit"
  // redrawn) and who made them, for the XMP.
  function tagged(req, kind, cf) {
    if (req) { req.mark = kind; req.by = cf.p.name + (cf.model && cf.p.name.indexOf(cf.model) < 0 ? " " + cf.model : ""); }
    return req;
  }
  function generateReq(cf, key, opts) { return tagged(buildGenerate(cf, key, opts), "gen", cf); }
  function editReq(cf, key, opts) { return tagged(buildEdit(cf, key, opts), "edit", cf); }
  function expandReq(cf, key, opts) { return tagged(buildExpand(cf, key, opts), "edit", cf); }

  // ---------- AI-MARK: machine-readable marking ----------
  var DST = "http://cv.iptc.org/newscodes/digitalsourcetype/";
  var XMP_NS = "http://ns.adobe.com/xap/1.0/";
  function xmlEsc(v) {
    return String(v == null ? "" : v).slice(0, 200).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  // info: { src: "gen" | "edit", tool: "orOS Atelier", by: "OpenAI (gpt-image-1)" }
  function xmpPacket(info) {
    info = info || {};
    var type = info.src === "gen" ? "trainedAlgorithmicMedia" : "compositeWithTrainedAlgorithmicMedia";
    var what = (info.src === "gen" ? "Made with AI" : "Contains parts made with AI") + (info.by ? " (" + info.by + ")" : "");
    return '<?xpacket begin="\ufeff" id="W5M0MpCehiHzreSzNTczkc9d"?>' +
      '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
      '<rdf:Description rdf:about="" xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/"' +
      ' xmlns:xmp="' + XMP_NS + '" xmlns:dc="http://purl.org/dc/elements/1.1/"' +
      ' Iptc4xmpExt:DigitalSourceType="' + DST + type + '"' +
      ' xmp:CreatorTool="' + xmlEsc(info.tool || "orOS") + '">' +
      '<dc:description><rdf:Alt><rdf:li xml:lang="x-default">' + xmlEsc(what) + '</rdf:li></rdf:Alt></dc:description>' +
      '</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="r"?>';
  }
  function utf8(sv) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(sv);
    var b = unescape(encodeURIComponent(sv)), u = new Uint8Array(b.length);
    for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
    return u;
  }
  function ascii(b, o, n) { var r = ""; for (var i = 0; i < n && o + i < b.length; i++) r += String.fromCharCode(b[o + i]); return r; }
  function u32be(b, o) { return b[o] * 16777216 + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]); }
  function u32le(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 16777216; }
  function concat(parts) {
    var n = 0, i, p = 0;
    for (i = 0; i < parts.length; i++) n += parts[i].length;
    var out = new Uint8Array(n);
    for (i = 0; i < parts.length; i++) { out.set(parts[i], p); p += parts[i].length; }
    return out;
  }
  var CRC = null;
  function crc32(b) {
    if (!CRC) {
      CRC = new Int32Array(256);
      for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c; }
    }
    var x = -1;
    for (var i = 0; i < b.length; i++) x = CRC[(x ^ b[i]) & 255] ^ (x >>> 8);
    return (x ^ -1) >>> 0;
  }
  function be32(v) { return new Uint8Array([(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]); }
  function le32(v) { return new Uint8Array([v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]); }
  // Already says it is AI: the IPTC term in XMP or in a C2PA manifest.
  function hasAITerm(b) {
    var lim = Math.min(b.length, 4 * 1024 * 1024), needle = "rainedAlgorithmicMedia", n = needle.length;
    outer: for (var i = 1; i + n <= lim; i++) {
      if (b[i] !== 114) continue;                          // "r"
      for (var j = 1; j < n; j++) if (b[i + j] !== needle.charCodeAt(j)) continue outer;
      var t0 = b[i - 1];
      if (t0 === 116 || t0 === 84) return true;            // "t" / "T"
    }
    return false;
  }
  function pngMark(b, xmp) {
    var parts = [b.subarray(0, 8)], p = 8, put = false;
    var key = utf8("XML:com.adobe.xmp"), body = concat([key, new Uint8Array([0, 0, 0, 0, 0]), utf8(xmp)]);
    var type = utf8("iTXt"), chunk = concat([be32(body.length), type, body, be32(crc32(concat([type, body])))]);
    while (p + 12 <= b.length) {
      var len = u32be(b, p), t = ascii(b, p + 4, 4), end = p + 12 + len;
      if (end > b.length) return null;
      if (t === "caBX") return "c2pa";
      var isXmp = t === "iTXt" && ascii(b, p + 8, 17) === "XML:com.adobe.xmp";
      if (!isXmp) parts.push(b.subarray(p, end));
      if (t === "IHDR" && !put) { parts.push(chunk); put = true; }
      p = end;
      if (t === "IEND") break;
    }
    return put ? concat(parts) : null;
  }
  function jpegMark(b, xmp) {
    var head = utf8(XMP_NS + "\u0000"), body = concat([head, utf8(xmp)]);
    if (body.length + 2 > 65535) return null;
    var seg = concat([new Uint8Array([0xff, 0xe1, ((body.length + 2) >> 8) & 255, (body.length + 2) & 255]), body]);
    var parts = [b.subarray(0, 2)], p = 2, put = false;
    while (p + 4 <= b.length && b[p] === 0xff) {
      var m = b[p + 1];
      if (m === 0xda || m === 0xd9) break;                 // image data: the rest as it is
      if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { parts.push(b.subarray(p, p + 2)); p += 2; continue; }
      var len = (b[p + 2] << 8) | b[p + 3], end = p + 2 + len;
      if (end > b.length) return null;
      if (m === 0xeb && ascii(b, p + 4, Math.min(len, 64)).indexOf("JP") >= 0) return "c2pa";   // APP11 JUMBF
      var isXmp = m === 0xe1 && ascii(b, p + 4, head.length - 1) === XMP_NS;
      // after APP0 (JFIF) / APP1 (EXIF), before anything else
      if (!put && !(m === 0xe0 || (m === 0xe1 && !isXmp))) { parts.push(seg); put = true; }
      if (!isXmp) parts.push(b.subarray(p, end));
      p = end;
    }
    if (!put) parts.push(seg);
    parts.push(b.subarray(p));
    return concat(parts);
  }
  function webpMark(b, xmp) {
    var chunks = [], p = 12, vp8x = -1, img = null;
    while (p + 8 <= b.length) {
      var id = ascii(b, p, 4), len = u32le(b, p + 4), end = p + 8 + len + (len & 1);
      if (p + 8 + len > b.length) return null;
      if (id === "C2PA") return "c2pa";
      if (id !== "XMP ") {
        var c = b.slice(p, Math.min(end, b.length));
        if (id === "VP8X") vp8x = chunks.length;
        if ((id === "VP8 " || id === "VP8L") && !img) img = { id: id, d: c.subarray(8) };
        chunks.push(c);
      }
      p = end;
    }
    if (vp8x < 0) {
      if (!img) return null;
      var w, h, alpha = 0, d = img.d;
      if (img.id === "VP8 ") {
        if (d.length < 10) return null;
        w = (d[6] | (d[7] << 8)) & 0x3fff; h = (d[8] | (d[9] << 8)) & 0x3fff;
      } else {
        if (d.length < 5 || d[0] !== 0x2f) return null;
        var bits = u32le(d, 1);
        w = (bits & 0x3fff) + 1; h = ((bits >>> 14) & 0x3fff) + 1; alpha = (bits >>> 28) & 1;
      }
      var x = new Uint8Array(18);
      x.set(utf8("VP8X")); x.set(le32(10), 4);
      x[8] = alpha ? 0x10 : 0;
      x[12] = (w - 1) & 255; x[13] = ((w - 1) >> 8) & 255; x[14] = ((w - 1) >> 16) & 255;
      x[15] = (h - 1) & 255; x[16] = ((h - 1) >> 8) & 255; x[17] = ((h - 1) >> 16) & 255;
      chunks.unshift(x); vp8x = 0;
    }
    chunks[vp8x][8] |= 0x04;                               // the XMP flag
    var data = utf8(xmp), pad = data.length & 1 ? new Uint8Array([0]) : new Uint8Array(0);
    chunks.push(concat([utf8("XMP "), le32(data.length), data, pad]));
    var bodyAll = concat(chunks);
    return concat([utf8("RIFF"), le32(bodyAll.length + 4), utf8("WEBP"), bodyAll]);
  }
  // bytes (Uint8Array) → { bytes, how: "xmp" (marked here) | "c2pa" (the
  // provider's credentials, kept) | "has" (already marked) | "" (a kind
  // that can't be marked: kept as it is) }
  function markBytes(b, info) {
    var none = { bytes: b, how: "" };
    if (!b || b.length < 12) return none;
    if (hasAITerm(b)) return { bytes: b, how: "has" };
    var out = null, xmp = xmpPacket(info);
    try {
      if (b[0] === 0x89 && ascii(b, 1, 3) === "PNG") out = pngMark(b, xmp);
      else if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) out = jpegMark(b, xmp);
      else if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") out = webpMark(b, xmp);
    } catch (e) { out = null; }
    if (out === "c2pa") return { bytes: b, how: "c2pa" };
    return out ? { bytes: out, how: "xmp" } : none;
  }
  // → Promise<Blob> (the same blob when nothing was added)
  function markBlob(blob, info) {
    if (!blob || typeof blob.arrayBuffer !== "function") return Promise.resolve(blob);
    return blob.arrayBuffer().then(function (ab) {
      var r = markBytes(new Uint8Array(ab), info);
      return r.how === "xmp" ? new Blob([r.bytes], { type: blob.type || "image/png" }) : blob;
    }, function () { return blob; });
  }
  function isAIBytes(b) { return !!b && hasAITerm(b); }

  function hordeHeaders(key, json) {
    var h = { apikey: key || HORDE_ANON, "Client-Agent": HORDE_AGENT };
    if (json) h["Content-Type"] = "application/json";
    return h;
  }

  // A cheap request that shows whether the key / address works.
  function buildTest(cf, key) {
    var auth = key ? { Authorization: "Bearer " + key } : {};
    if (cf.pid === "horde") return { url: cf.base + "/find_user", method: "GET", headers: hordeHeaders(key) };
    if (cf.pid === "pollinations") return null;               // nothing to check without generating
    if (cf.pid === "huggingface") return { url: "https://huggingface.co/api/whoami-v2", method: "GET", headers: auth };
    if (cf.pid === "openai") return { url: cf.base + "/models", method: "GET", headers: auth };
    if (cf.pid === "stability") return { url: cf.base + "/v1/user/balance", method: "GET", headers: auth };
    if (cf.pid === "sdwebui") return { url: cf.base + "/sdapi/v1/sd-models", method: "GET", headers: {} };
    if (cf.pid === "comfyui") return { url: cf.base + "/system_stats", method: "GET", headers: {} };
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
  // AI Horde answers a job id; its volunteers make the picture while
  // we ask every few seconds, then fetch it (base64 WebP). A stop
  // cancels the job there too.
  function hordeWait(req, job, signal, deps) {
    deps = deps || {};
    var base = req.url.replace(/\/generate\/async$/, ""), id = String(job && job.id || "");
    if (!/^[\w-]{1,80}$/.test(id)) return Promise.reject(new ImageError("bad"));
    var get = function (path, method) {
      return fetch(base + path + id, { method: method || "GET", headers: { "Client-Agent": HORDE_AGENT }, credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" })
        .catch(function () { throw new ImageError("net"); })
        .then(function (res) {
          if (!res.ok) throw new ImageError(res.status === 429 ? "limit" : "http", "", res.status);
          return res.json();
        });
    };
    var sleep = deps.sleep || function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    var now = deps.now || Date.now, t0 = now();
    var stop = function () { get("/generate/status/", "DELETE").catch(function () {}); };
    if (signal) signal.addEventListener("abort", stop, { once: true });
    var loop = function () {
      if (signal && signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
      if (now() - t0 > HORDE_WAIT) { stop(); return Promise.reject(new ImageError("http", "timeout")); }
      return get("/generate/check/").then(function (c) {
        if (c.faulted) throw new ImageError("http", "faulted");
        if (c.is_possible === false) { stop(); throw new ImageError("http", "no worker for this model"); }
        if (c.done) return get("/generate/status/").then(function (s) {
          var list = (s.generations || []).filter(function (g) { return g && !g.censored && typeof g.img === "string" && g.img; });
          if (!list.length) throw new ImageError("bad");
          return Promise.all(list.map(function (g) {
            // r2: false asks for base64; a link (r2) is fetched the same way
            if (/^https:\/\//.test(g.img)) return fetch(g.img, { credentials: "omit", referrerPolicy: "no-referrer" })
              .then(function (r) { if (!r.ok) throw new ImageError("http", "", r.status); return r.blob(); });
            return b64Blob(g.img, "image/webp");
          }));
        });
        return sleep(HORDE_POLL).then(loop);
      });
    };
    return loop().then(function (r) {
      if (signal) signal.removeEventListener("abort", stop);
      return r;
    }, function (e) {
      if (signal) signal.removeEventListener("abort", stop);
      throw e;
    });
  }

  // ComfyUI: upload the pictures, queue the graph, ask until it is done,
  // fetch what SaveImage wrote.
  function comfyRun(req, signal, deps) {
    deps = deps || {};
    var base = req.url.replace(/\/prompt$/, ""), flow = JSON.parse(JSON.stringify(req.json.prompt));
    var sleep = deps.sleep || function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    var now = deps.now || Date.now, t0 = now();
    function call(url, init) {
      init = Object.assign({ credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer", signal: signal }, init || {});
      return fetch(url, init).catch(function (e) { if (signal && signal.aborted) throw e; throw new ImageError("net"); }).then(function (res) {
        if (!res.ok) return res.text().catch(function () { return ""; }).then(function (b) { throw new ImageError("http", String(b).slice(0, 200), res.status); });
        return res;
      });
    }
    var up = Promise.resolve();
    (req.uploads || []).forEach(function (u) {
      up = up.then(function () {
        var fd = new FormData();
        fd.append("image", u[1].blob, u[1].name);
        fd.append("type", "input");
        fd.append("overwrite", "true");
        return call(base + "/upload/image", { method: "POST", body: fd }).then(function (r) { return r.json(); }).then(function (j) {
          var name = (j.subfolder ? j.subfolder + "/" : "") + j.name;
          Object.keys(flow).forEach(function (k) { var i = flow[k].inputs; Object.keys(i).forEach(function (f) { if (i[f] === u[0]) i[f] = name; }); });
        });
      });
    });
    return up.then(function () {
      return call(base + "/prompt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: flow, client_id: "oros" }) });
    }).then(function (r) { return r.json(); }).then(function (j) {
      var id = String(j && j.prompt_id || "");
      if (!/^[\w-]{1,80}$/.test(id)) throw new ImageError("bad");
      var loop = function () {
        if (signal && signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
        if (now() - t0 > COMFY_WAIT) return Promise.reject(new ImageError("http", "timeout"));
        return call(base + "/history/" + id).then(function (r) { return r.json(); }).then(function (h) {
          var e = h && h[id];
          if (!e) return sleep(COMFY_POLL).then(loop);
          if (e.status && e.status.status_str === "error") throw new ImageError("http", "ComfyUI error");
          var pics = [];
          Object.keys(e.outputs || {}).forEach(function (k) { (e.outputs[k].images || []).forEach(function (im) { if (im && im.type === "output") pics.push(im); }); });
          if (!pics.length) return sleep(COMFY_POLL).then(loop);
          return Promise.all(pics.slice(0, 4).map(function (im) {
            return call(base + "/view?filename=" + encodeURIComponent(im.filename) + "&subfolder=" + encodeURIComponent(im.subfolder || "") + "&type=output")
              .then(function (r) { return r.blob(); });
          }));
        });
      };
      return loop();
    });
  }

  // → Promise<Blob[]>; a request with a mark (generate, edit, expand)
  // gives its pictures marked (AI-MARK).
  function run(req, signal, deps) {
    if (!req) return Promise.reject(new ImageError("unsupported"));
    var go = runRaw(req, signal, deps);
    if (!req.mark) return go;
    return go.then(function (list) {
      return Promise.all((list || []).map(function (b) { return markBlob(b, { src: req.mark, by: req.by, tool: "orOS" }); }));
    });
  }
  function runRaw(req, signal, deps) {
    if (req.reply === "comfy") return comfyRun(req, signal, deps);
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
      if (req.reply === "horde") return res.json().then(function (j) { return hordeWait(req, j, signal, deps); });
      if (req.reply === "image") return res.blob().then(function (b) {
        if (!/^image\//.test(b.type || "image/")) throw new ImageError("bad");
        return [b];
      });
      return res.json().then(function (j) {
        if (req.reply === "sd-one") { if (typeof j.image !== "string" || !j.image) throw new ImageError("bad"); return [b64Blob(j.image, "image/png")]; }
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
    buildGenerate: generateReq, buildEdit: editReq, buildExpand: expandReq, buildTest: buildTest, buildUpscale: buildUpscale, comfyFlow: comfyFlow,
    xmpPacket: xmpPacket, markBytes: markBytes, markBlob: markBlob, isAIBytes: isAIBytes,
    run: run, ImageError: ImageError, b64Blob: b64Blob, hordeWait: hordeWait, HORDE_ANON: HORDE_ANON
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrosImageAI = api;
})(typeof window !== "undefined" ? window : this);
