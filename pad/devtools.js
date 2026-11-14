// ============================================================
// orOS Pad — developer tools (wave D1), pure functions only.
// Loaded by pad/app.js the first time Tools… opens (and by the tests
// in Node). Nothing here touches the page, the network or storage:
// every function takes text or bytes and returns text or data.
//   - JSON: check, sort keys, JSON → YAML. Numbers and strings are
//     copied as written (PadCore.jsonTokens), never through JSON.parse.
//   - YAML (vendor/yaml, ISC, passed in as Y): check, format with the
//     comments kept, YAML → JSON. Numbers keep their source text.
//   - Hashes: MD5 (own code), SHA-1/256/384/512 (WebCrypto), hex and
//     Base64, and "compare with" a pasted checksum.
//   - UUID v4 and v7, timestamps, number bases, CSS colours.
// ============================================================
(function (root) {
  "use strict";

  var PC = root.PadCore || (typeof require === "function" ? require("./core.js") : null);

  // ---------- Bytes ----------
  var HEX = "0123456789abcdef";
  function toHex(b) {
    var s = "";
    for (var i = 0; i < b.length; i++) s += HEX.charAt(b[i] >> 4) + HEX.charAt(b[i] & 15);
    return s;
  }
  var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  function toB64(b) {
    var s = "", i;
    for (i = 0; i + 2 < b.length; i += 3) {
      var n = (b[i] << 16) | (b[i + 1] << 8) | b[i + 2];
      s += B64.charAt(n >> 18) + B64.charAt((n >> 12) & 63) + B64.charAt((n >> 6) & 63) + B64.charAt(n & 63);
    }
    var r = b.length - i;
    if (r === 1) { var a = b[i] << 16; s += B64.charAt(a >> 18) + B64.charAt((a >> 12) & 63) + "=="; }
    else if (r === 2) { var c = (b[i] << 16) | (b[i + 1] << 8); s += B64.charAt(c >> 18) + B64.charAt((c >> 12) & 63) + B64.charAt((c >> 6) & 63) + "="; }
    return s;
  }
  function utf8(s) { return new TextEncoder().encode(String(s)); }

  // ---------- MD5 (RFC 1321) on bytes ----------
  var MD5_K = [], MD5_R = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  for (var mk = 0; mk < 64; mk++) MD5_K[mk] = Math.floor(Math.abs(Math.sin(mk + 1)) * 4294967296) | 0;
  function md5(b) {
    var n = b.length, words = (((n + 8) >>> 6) + 1) * 16, W = new Int32Array(words), i;
    for (i = 0; i < n; i++) W[i >> 2] |= b[i] << ((i % 4) * 8);
    W[n >> 2] |= 0x80 << ((n % 4) * 8);
    W[words - 2] = (n * 8) | 0;
    W[words - 1] = Math.floor(n / 0x20000000);
    var h = [0x67452301, 0xefcdab89 | 0, 0x98badcfe | 0, 0x10325476];
    for (var o = 0; o < words; o += 16) {
      var a = h[0], bb = h[1], c = h[2], d = h[3];
      for (var j = 0; j < 64; j++) {
        var f, g, r = j >> 4;
        if (r === 0) { f = (bb & c) | (~bb & d); g = j; }
        else if (r === 1) { f = (d & bb) | (~d & c); g = (5 * j + 1) % 16; }
        else if (r === 2) { f = bb ^ c ^ d; g = (3 * j + 5) % 16; }
        else { f = c ^ (bb | ~d); g = (7 * j) % 16; }
        var sh = MD5_R[r * 4 + (j % 4)], x = (a + f + MD5_K[j] + W[o + g]) | 0, tmp = d;
        d = c; c = bb;
        bb = (bb + ((x << sh) | (x >>> (32 - sh)))) | 0;
        a = tmp;
      }
      h[0] = (h[0] + a) | 0; h[1] = (h[1] + bb) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
    }
    var out = new Uint8Array(16);
    for (i = 0; i < 16; i++) out[i] = (h[i >> 2] >>> ((i % 4) * 8)) & 255;
    return out;
  }

  // ---------- All hashes ----------
  var ALGOS = [
    { id: "md5", name: "MD5" }, { id: "sha1", name: "SHA-1", web: "SHA-1" }, { id: "sha256", name: "SHA-256", web: "SHA-256" },
    { id: "sha384", name: "SHA-384", web: "SHA-384" }, { id: "sha512", name: "SHA-512", web: "SHA-512" }
  ];
  // bytes → Promise<[{ id, name, hex, b64 }]>. subtle: crypto.subtle
  // (an orOS page is a secure context: https, or localhost on Portable
  // and the USB stick). Without it only MD5 is given.
  function hashAll(bytes, subtle) {
    var b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
    return Promise.all(ALGOS.map(function (a) {
      if (!a.web) return Promise.resolve(md5(b));
      if (!subtle || typeof subtle.digest !== "function") return Promise.resolve(null);
      return Promise.resolve(subtle.digest(a.web, b)).then(function (d) { return new Uint8Array(d); }, function () { return null; });
    })).then(function (res) {
      var out = [];
      res.forEach(function (d, i) { if (d) out.push({ id: ALGOS[i].id, name: ALGOS[i].name, hex: toHex(d), b64: toB64(d) }); });
      return out;
    });
  }
  // A pasted checksum (a .sha256 line "<hex>  file.zip", "SHA256 (f) =
  // <hex>", a Base64 digest) → the hash row it equals, or null; "" when
  // nothing that looks like a checksum was typed.
  function matchHash(rows, typed) {
    var s = String(typed || "").trim();
    if (!s) return "";
    var hex = s.match(/\b[0-9a-fA-F]{32,128}\b/g) || [], b64 = s.match(/[A-Za-z0-9+\/]{22,88}={0,2}/g) || [];
    if (!hex.length && !b64.length) return "";
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (hex.some(function (h) { return h.toLowerCase() === r.hex; })) return r;
      if (b64.some(function (h) { return h === r.b64 || h + "=" === r.b64 || h + "==" === r.b64; })) return r;
    }
    return null;
  }

  // ---------- UUID (RFC 9562) ----------
  function rnd(n, rand) {
    var b = new Uint8Array(n);
    if (typeof rand === "function") rand(b);
    else if (root.crypto && root.crypto.getRandomValues) root.crypto.getRandomValues(b);
    else throw new Error("no-random");
    return b;
  }
  function fmtUuid(b) {
    var h = toHex(b);
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }
  function uuid4(rand) {
    var b = rnd(16, rand);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    return fmtUuid(b);
  }
  // 48-bit Unix milliseconds, version 7, then random bits.
  function uuid7(ms, rand) {
    var b = rnd(16, rand), t = Math.max(0, Math.floor(typeof ms === "number" ? ms : Date.now()));
    for (var i = 5; i >= 0; i--) { b[i] = t % 256; t = Math.floor(t / 256); }
    b[6] = (b[6] & 0x0f) | 0x70;
    b[8] = (b[8] & 0x3f) | 0x80;
    return fmtUuid(b);
  }

  // ---------- Timestamps ----------
  // "1700000000" (seconds), "1700000000000" (ms), 16 digits µs, 19 ns,
  // or a date such as 2026-11-13T07:30:00Z → { ms, unit } | null.
  function parseStamp(text) {
    var s = String(text || "").trim();
    if (!s || s.length > 40) return null;
    var m = /^([+-]?)(\d{1,19})(?:\.(\d{1,9}))?$/.exec(s);
    if (m) {
      var digits = m[2].replace(/^0+(?=\d)/, ""), sign = m[1] === "-" ? -1 : 1, unit, div;
      if (digits.length <= 11) { unit = "s"; div = 1e-3; }
      else if (digits.length <= 14) { unit = "ms"; div = 1; }
      else if (digits.length <= 17) { unit = "us"; div = 1e3; }
      else { unit = "ns"; div = 1e6; }
      if (m[3] && unit !== "s") return null;
      var whole = Number(digits) / div + (m[3] ? Number("0." + m[3]) * 1000 : 0);
      var ms = sign * whole;
      if (!isFinite(ms) || Math.abs(ms) > 8.64e15) return null;
      return { ms: Math.round(ms), unit: unit };
    }
    if (/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/i.test(s)) {
      var t = Date.parse(s.replace(" ", "T"));
      if (isFinite(t)) return { ms: t, unit: "date" };
    }
    return null;
  }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  // Local ISO 8601 with the offset, e.g. 2026-11-13T09:30:00+02:00.
  function isoLocal(ms) {
    var d = new Date(ms), off = -d.getTimezoneOffset(), sg = off >= 0 ? "+" : "-", a = Math.abs(off);
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) + "T" + pad2(d.getHours()) + ":" +
      pad2(d.getMinutes()) + ":" + pad2(d.getSeconds()) + sg + pad2(Math.floor(a / 60)) + ":" + pad2(a % 60);
  }
  function relTime(ms, now, locale) {
    var diff = (ms - now) / 1000, ab = Math.abs(diff), u, v;
    if (ab < 45) { u = "second"; v = diff; }
    else if (ab < 2700) { u = "minute"; v = diff / 60; }
    else if (ab < 64800) { u = "hour"; v = diff / 3600; }
    else if (ab < 26 * 86400) { u = "day"; v = diff / 86400; }
    else if (ab < 320 * 86400) { u = "month"; v = diff / (30.44 * 86400); }
    else { u = "year"; v = diff / (365.25 * 86400); }
    try { return new Intl.RelativeTimeFormat(locale || undefined, { numeric: "auto" }).format(Math.round(v), u); }
    catch (e) { return Math.round(v) + " " + u; }
  }
  // → [{ k, v }] for the panel; k is a string key the page translates.
  function stampRows(ms, now, locale) {
    var d = new Date(ms), local;
    try { local = new Intl.DateTimeFormat(locale || undefined, { dateStyle: "full", timeStyle: "long" }).format(d); }
    catch (e) { local = d.toString(); }
    var rows = [
      { k: "local", v: local },
      { k: "isoLocal", v: isoLocal(ms) },
      { k: "isoUtc", v: d.toISOString() },
      { k: "unixS", v: String(Math.floor(ms / 1000)) },
      { k: "unixMs", v: String(ms) }
    ];
    if (typeof now === "number") rows.push({ k: "rel", v: relTime(ms, now, locale) });
    return rows;
  }

  // ---------- Number bases ----------
  // 255, -255, 0xFF, $xFF (EEL2), 0b1111, 0o377, 1_000 → BigInt | null.
  function parseNumber(text) {
    var s = String(text || "").trim().replace(/_/g, "");
    if (!s || s.length > 300 || typeof BigInt !== "function") return null;
    var m = /^([+-]?)(0x|\$x|0b|0o|)([0-9a-f]+)$/i.exec(s);
    if (!m) return null;
    var p = m[2].toLowerCase(), body = m[3];
    var re = p === "0b" ? /^[01]+$/ : p === "0o" ? /^[0-7]+$/ : p ? /^[0-9a-f]+$/i : /^[0-9]+$/;
    if (!re.test(body)) return null;
    var v = BigInt((p === "$x" ? "0x" : p) + body);
    return m[1] === "-" ? -v : v;
  }
  function baseRows(v, eel2) {
    var neg = v < 0, a = neg ? -v : v, sg = neg ? "-" : "";
    var rows = [
      { k: "dec", v: sg + a.toString(10) },
      { k: "hex", v: sg + "0x" + a.toString(16).toUpperCase() },
      { k: "bin", v: sg + "0b" + a.toString(2) },
      { k: "oct", v: sg + "0o" + a.toString(8) }
    ];
    if (eel2) rows.push({ k: "eel2", v: sg + "$x" + a.toString(16).toUpperCase() });
    return rows;
  }

  // ---------- CSS colours ----------
  function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }
  function num(s, scale) {
    s = String(s).trim();
    var pct = /%$/.test(s), v = parseFloat(s);
    if (!isFinite(v)) return NaN;
    return pct ? v / 100 * scale : v;
  }
  function hue(s) {
    var m = /^(-?[\d.]+)(deg|turn|rad|grad)?$/i.exec(String(s).trim());
    if (!m) return NaN;
    var v = parseFloat(m[1]), u = (m[2] || "deg").toLowerCase();
    if (u === "turn") v *= 360; else if (u === "rad") v = v * 180 / Math.PI; else if (u === "grad") v *= 0.9;
    return ((v % 360) + 360) % 360;
  }
  function hslToRgb(h, s, l) {
    var c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2, r, g, b;
    if (h < 60) { r = c; g = x; b = 0; } else if (h < 120) { r = x; g = c; b = 0; } else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; } else if (h < 300) { r = x; g = 0; b = c; } else { r = c; g = 0; b = x; }
    return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
  }
  // #rgb #rgba #rrggbb #rrggbbaa, rgb()/rgba(), hsl()/hsla() with commas
  // or spaces and "/ alpha" → { r, g, b, a } (0-255, a 0-1) | null.
  function parseColor(text) {
    var s = String(text || "").trim().toLowerCase();
    if (!s || s.length > 80) return null;
    var m = /^#([0-9a-f]{3,8})$/.exec(s);
    if (m) {
      var h = m[1];
      if (h.length === 3 || h.length === 4) h = h.split("").map(function (c) { return c + c; }).join("");
      if (h.length !== 6 && h.length !== 8) return null;
      return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16),
        a: h.length === 8 ? Math.round(parseInt(h.slice(6, 8), 16) / 255 * 1000) / 1000 : 1 };
    }
    m = /^(rgba?|hsla?)\(\s*([^)]*)\)$/.exec(s);
    if (!m) return null;
    var parts = m[2].split(/\s*\/\s*/), main = parts[0].split(/\s*,\s*|\s+/).filter(Boolean), alpha = parts[1];
    if (parts.length > 2) return null;
    if (main.length === 4 && alpha === undefined) alpha = main.pop();
    if (main.length !== 3) return null;
    var a = alpha === undefined ? 1 : num(alpha, 1);
    if (!isFinite(a)) return null;
    var rgb;
    if (m[1].charAt(0) === "r") rgb = main.map(function (p) { return num(p, 255); });
    else {
      var H = hue(main[0]), S = num(main[1], 1), L = num(main[2], 1);
      if (!/%$/.test(main[1]) || !/%$/.test(main[2])) { S = parseFloat(main[1]) / 100; L = parseFloat(main[2]) / 100; }
      if (!isFinite(H) || !isFinite(S) || !isFinite(L)) return null;
      rgb = hslToRgb(H, clamp(S, 0, 1), clamp(L, 0, 1));
    }
    if (rgb.some(function (x) { return !isFinite(x); })) return null;
    return { r: Math.round(clamp(rgb[0], 0, 255)), g: Math.round(clamp(rgb[1], 0, 255)), b: Math.round(clamp(rgb[2], 0, 255)), a: clamp(Math.round(a * 1000) / 1000, 0, 1) };
  }
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, h = 0, s = 0, d = mx - mn;
    if (d) {
      s = d / (1 - Math.abs(2 * l - 1));
      if (mx === r) h = 60 * (((g - b) / d) % 6); else if (mx === g) h = 60 * ((b - r) / d + 2); else h = 60 * ((r - g) / d + 4);
    }
    return [Math.round((h + 360) % 360), Math.round(s * 100), Math.round(l * 100)];
  }
  function hx(n) { return (n < 16 ? "0" : "") + n.toString(16); }
  // → [{ k, v }]; hex is always first and safe to paint the sample with.
  function colorRows(c) {
    var hsl = rgbToHsl(c.r, c.g, c.b), op = c.a < 1;
    return [
      { k: "hex", v: "#" + hx(c.r) + hx(c.g) + hx(c.b) + (op ? hx(Math.round(c.a * 255)) : "") },
      { k: "rgb", v: op ? "rgba(" + c.r + ", " + c.g + ", " + c.b + ", " + c.a + ")" : "rgb(" + c.r + ", " + c.g + ", " + c.b + ")" },
      { k: "hsl", v: op ? "hsla(" + hsl[0] + ", " + hsl[1] + "%, " + hsl[2] + "%, " + c.a + ")" : "hsl(" + hsl[0] + ", " + hsl[1] + "%, " + hsl[2] + "%)" }
    ];
  }

  // ---------- JSON tree (numbers and strings as written) ----------
  // → { node } | { error: { line, col } }. node: { t: "o", items: [[keyRaw, node]] }
  // | { t: "a", items: [node] } | { t: "v", v: raw }.
  function jsonTree(text) {
    var r = PC.jsonTokens(String(text));
    if (r.error) return r;
    var toks = r.toks, p = 0, depth = 0;
    function fail(tk) { return { error: tk ? tk.at : r.end }; }
    function value() {
      var tk = toks[p];
      if (!tk) return fail();
      if (tk.t === "v") { p++; return { node: { t: "v", v: tk.v } }; }
      if (tk.t !== "{" && tk.t !== "[") return fail(tk);
      if (++depth > 512) return fail(tk);
      var obj = tk.t === "{", close = obj ? "}" : "]", items = [];
      p++;
      if (toks[p] && toks[p].t === close) { p++; depth--; return { node: { t: obj ? "o" : "a", items: items } }; }
      for (;;) {
        var key = null;
        if (obj) {
          key = toks[p];
          if (!key || key.t !== "v" || key.v.charAt(0) !== '"') return fail(key);
          p++;
          if (!toks[p] || toks[p].t !== ":") return fail(toks[p]);
          p++;
        }
        var e = value();
        if (e.error) return e;
        items.push(obj ? [key.v, e.node] : e.node);
        var nx = toks[p];
        if (nx && nx.t === ",") { p++; continue; }
        if (nx && nx.t === close) { p++; depth--; return { node: { t: obj ? "o" : "a", items: items } }; }
        return fail(nx);
      }
    }
    var v = value();
    if (v.error) return v;
    if (p < toks.length) return fail(toks[p]);
    return v;
  }
  function jsonCheck(text) {
    var r = jsonTree(text);
    return r.error ? { error: r.error } : { ok: true };
  }
  function keyText(raw) { try { return JSON.parse(raw); } catch (e) { return raw; } }
  function emitJson(node, ind, depth, out) {
    if (node.t === "v") { out.push(node.v); return; }
    var obj = node.t === "o", open = obj ? "{" : "[", close = obj ? "}" : "]";
    if (!node.items.length) { out.push(open + close); return; }
    out.push(open);
    node.items.forEach(function (it, i) {
      if (i) out.push(",");
      if (ind) { out.push("\n"); for (var k = 0; k <= depth; k++) out.push(ind); }
      if (obj) { out.push(it[0], ind ? ": " : ":"); emitJson(it[1], ind, depth + 1, out); }
      else emitJson(it, ind, depth + 1, out);
    });
    if (ind) { out.push("\n"); for (var k2 = 0; k2 < depth; k2++) out.push(ind); }
    out.push(close);
  }
  function sortNode(node) {
    if (node.t === "v") return node;
    if (node.t === "a") return { t: "a", items: node.items.map(sortNode) };
    var items = node.items.map(function (it, i) { return { k: keyText(it[0]), i: i, it: [it[0], sortNode(it[1])] }; });
    items.sort(function (a, b) { return a.k < b.k ? -1 : a.k > b.k ? 1 : a.i - b.i; });
    return { t: "o", items: items.map(function (x) { return x.it; }) };
  }
  // Keys A → Z at every level (by code point, equal keys keep their
  // order); arrays keep theirs. indent "" = one line.
  function jsonSortKeys(text, indent) {
    var r = jsonTree(text);
    if (r.error) return r;
    var out = [];
    emitJson(sortNode(r.node), indent || "", 0, out);
    return { text: out.join("") + (indent ? "\n" : "") };
  }

  // ---------- JSON → YAML ----------
  var YAML_WORD = /^(?:true|false|null|yes|no|on|off|y|n|~)$/i;
  var YAML_NUMLIKE = /^[-+.]?(?:\d|\.inf|\.nan)|^0[xob]/i;
  // A string as YAML: plain when it cannot be read as anything else,
  // otherwise in double quotes (JSON's escapes are YAML's too).
  function yamlStr(s) {
    if (s !== "" && /^[\p{L}_\/][\p{L}\p{N}_ .\/@()-]*$/u.test(s) && !/ $/.test(s) && !YAML_WORD.test(s) && !YAML_NUMLIKE.test(s)) return s;
    return JSON.stringify(s);
  }
  function yamlScalar(raw) {
    if (raw.charAt(0) === '"') { var s = keyText(raw); return typeof s === "string" ? yamlStr(s) : raw; }
    return raw;   // number, true, false, null: the same words in YAML 1.2
  }
  function emitYaml(node, ind, depth, out) {
    var pre = new Array(depth + 1).join(ind);
    if (node.t === "o") {
      node.items.forEach(function (it) {
        var k = yamlStr(String(keyText(it[0]))), v = it[1];
        if (v.t === "v" || !v.items.length) out.push(pre + k + ": " + (v.t === "v" ? yamlScalar(v.v) : v.t === "o" ? "{}" : "[]"));
        else { out.push(pre + k + ":"); emitYaml(v, ind, depth + 1, out); }
      });
      return;
    }
    if (node.t === "a") {
      node.items.forEach(function (v) {
        if (v.t === "v" || !v.items.length) { out.push(pre + "- " + (v.t === "v" ? yamlScalar(v.v) : v.t === "o" ? "{}" : "[]")); return; }
        var sub = [];
        emitYaml(v, ind, 0, sub);
        // "- " takes the first line, the rest line up under it.
        var lead = pre + "-" + ind.slice(1);
        sub.forEach(function (line, i) { out.push((i ? pre + ind : lead) + line); });
      });
    }
  }
  function jsonToYaml(text, indentSize) {
    var r = jsonTree(text);
    if (r.error) return r;
    var ind = new Array(Math.max(2, Math.min(8, indentSize || 2)) + 1).join(" "), n = r.node, out = [];
    if (n.t === "v") return { text: yamlScalar(n.v) + "\n" };
    if (!n.items.length) return { text: (n.t === "o" ? "{}" : "[]") + "\n" };
    emitYaml(n, ind, 0, out);
    return { text: out.join("\n") + "\n" };
  }

  // ---------- YAML (Y = the yaml library, self.OrosYAML) ----------
  var NUM_TAG = /^tag:yaml.org,2002:(int|float)$/;
  // Numbers are written back as they were (0x1F, 1e3, 20 digits).
  function keepNumbers(tags) {
    return tags.map(function (t) {
      if (!NUM_TAG.test(t.tag)) return t;
      var c = {};
      for (var k in t) c[k] = t[k];
      c.stringify = function (item, ctx, a, b) {
        return typeof item.source === "string" && item.source ? item.source : t.stringify(item, ctx, a, b);
      };
      return c;
    });
  }
  function yamlDocs(Y, text) {
    return Y.parseAllDocuments(String(text), { intAsBigInt: true, customTags: keepNumbers, prettyErrors: true, maxAliasCount: 1000 });
  }
  function firstError(docs) {
    if (docs && !Array.isArray(docs) && docs.errors) docs = [docs];
    for (var i = 0; i < docs.length; i++) {
      var e = docs[i].errors && docs[i].errors[0];
      if (e) {
        var lp = e.linePos && e.linePos[0];
        return { line: lp ? lp.line : 1, col: lp ? lp.col : 1, msg: String(e.message || "").split("\n")[0].replace(/ at line \d+, column \d+:?$/, "") };
      }
    }
    return null;
  }
  function yamlCheck(Y, text) {
    var docs = yamlDocs(Y, text), e = firstError(docs);
    return e ? { error: e } : { ok: true, docs: Array.isArray(docs) ? docs.length : 1 };
  }
  function yamlFormat(Y, text, indentSize) {
    var docs = yamlDocs(Y, text), e = firstError(docs);
    if (e) return { error: e };
    if (!Array.isArray(docs)) docs = [docs];
    var opt = { indent: Math.max(2, Math.min(8, indentSize || 2)), flowCollectionPadding: false, lineWidth: 0 };
    var out = docs.map(function (d) { return d.toString(opt); }).join("");
    return { text: out };
  }
  var JSON_NUM = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
  // → { text, notes: { comments, docs, inf, keys } } | { error }.
  function yamlToJson(Y, text, indent) {
    var docs = yamlDocs(Y, text), e = firstError(docs);
    if (e) return { error: e };
    if (!Array.isArray(docs)) docs = [docs];
    var notes = { comments: /(^|\s)#/.test(String(text)), docs: docs.length, inf: 0, keys: 0 }, count = 0;
    function scalarJson(n) {
      var v = n.value;
      if (v === null || v === undefined) return "null";
      if (typeof v === "boolean") return v ? "true" : "false";
      if (typeof v === "bigint") return v.toString();
      if (typeof v === "number") {
        if (!isFinite(v)) { notes.inf++; return "null"; }
        return typeof n.source === "string" && JSON_NUM.test(n.source) ? n.source : String(v);
      }
      return JSON.stringify(String(v));
    }
    function conv(n, doc, depth) {
      if (++count > 1000000 || depth > 512) throw new Error("too-big");
      if (Y.isAlias(n)) n = n.resolve(doc);
      if (n === null || n === undefined) return { t: "v", v: "null" };
      if (Y.isScalar(n)) return { t: "v", v: scalarJson(n) };
      if (Y.isMap(n)) return { t: "o", items: n.items.map(function (p) {
        var k = p.key, kv;
        if (Y.isAlias(k)) k = k.resolve(doc);
        if (k === null || k === undefined) kv = "";
        else if (Y.isScalar(k)) kv = k.value === null || k.value === undefined ? "" : (typeof k.source === "string" && typeof k.value !== "string" ? k.source : String(k.value));
        else { notes.keys++; kv = String(k); }
        return [JSON.stringify(kv), conv(p.value, doc, depth + 1)];
      }) };
      if (Y.isSeq(n)) return { t: "a", items: n.items.map(function (x) { return conv(x, doc, depth + 1); }) };
      return { t: "v", v: "null" };
    }
    try {
      var nodes = docs.map(function (d) { return conv(d.contents, d, 0); });
      var root = nodes.length === 1 ? nodes[0] : { t: "a", items: nodes }, out = [];
      emitJson(root, indent === undefined ? "  " : indent, 0, out);
      return { text: out.join("") + "\n", notes: notes };
    } catch (err) { return { error: { line: 1, col: 1, msg: "", big: true } }; }
  }

  // ---------- JWT (RFC 7519), decode only (wave D2) ----------
  // The signature is never checked: no key is asked for or kept.
  function b64urlBytes(s) {
    if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
    s = s.replace(/-/g, "+").replace(/_/g, "/");
    if (s.length % 4 === 1) return null;
    while (s.length % 4) s += "=";
    var bin;
    try { bin = (typeof atob === "function" ? atob(s) : Buffer.from(s, "base64").toString("binary")); } catch (e) { return null; }
    var b = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    return b;
  }
  function partJson(seg) {
    var b = b64urlBytes(seg);
    if (!b) return null;
    var text;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(b); } catch (e) { return null; }
    var pretty = PC.jsonFormat(text, "  ");
    if (pretty.error) return null;
    var obj = null;
    try { obj = JSON.parse(text); } catch (e) { obj = null; }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
    return { text: pretty.text.replace(/\n$/, ""), obj: obj };
  }
  // "eyJ…" (also "Bearer eyJ…" or with quotes) → { header, payload,
  // alg, signed, times: [{ k: "exp"|"nbf"|"iat", ms }], expired, early }
  // | { error: "parts" | "header" | "payload" | "jwe" }.
  function jwtDecode(text, now) {
    var s = String(text || "").trim().replace(/^(?:bearer|authorization:\s*bearer)\s+/i, "").replace(/^["']|["']$/g, "");
    var parts = s.split(".");
    if (parts.length === 5) return { error: "jwe" };
    if (parts.length !== 3) return { error: "parts" };
    var h = partJson(parts[0]);
    if (!h) return { error: "header" };
    var p = partJson(parts[1]);
    if (!p) return { error: "payload" };
    var times = [], t = typeof now === "number" ? now : Date.now();
    ["iat", "nbf", "exp"].forEach(function (k) {
      var v = p.obj[k];
      if (typeof v === "number" && isFinite(v) && Math.abs(v) < 1e12) times.push({ k: k, ms: Math.round(v * 1000) });
    });
    var exp = times.filter(function (x) { return x.k === "exp"; })[0], nbf = times.filter(function (x) { return x.k === "nbf"; })[0];
    return {
      header: h.text, payload: p.text, alg: typeof h.obj.alg === "string" ? h.obj.alg : "", typ: typeof h.obj.typ === "string" ? h.obj.typ : "",
      signed: parts[2].length > 0, times: times, expired: !!exp && exp.ms <= t, early: !!nbf && nbf.ms > t
    };
  }
  function looksJwt(sel) { return /^(?:bearer\s+)?["']?eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*["']?$/i.test(String(sel || "").trim()); }

  // ---------- Regular expressions (wave D2) ----------
  // Runs in pad/regex-worker.js, so a pattern that never ends (such as
  // (a+)+$ on a long line) is stopped by the page instead of freezing it.
  function regexFlags(f) {
    var out = "g";
    String(f || "").split("").forEach(function (c) { if ("imsu".indexOf(c) >= 0 && out.indexOf(c) < 0) out += c; });
    return out;
  }
  // → { count, matches: [{ i, len, text, groups: [..], named: {..} }], more, replaced? } | { error }
  function regexRun(pattern, flags, text, replace, max) {
    var re;
    try { re = new RegExp(String(pattern), regexFlags(flags)); } catch (e) { return { error: String(e && e.message || e) }; }
    var s = String(text), limit = max || 10000, matches = [], pos = [], m, count = 0, cap = 200;
    re.lastIndex = 0;
    while ((m = re.exec(s)) !== null) {
      count++;
      pos.push(m.index, m[0].length);
      if (matches.length < cap) {
        var named = {};
        if (m.groups) Object.keys(m.groups).forEach(function (k) { named[k] = m.groups[k] === undefined ? null : m.groups[k]; });
        matches.push({ i: m.index, len: m[0].length, text: m[0].slice(0, 500),
          groups: m.slice(1).map(function (g) { return g === undefined ? null : g.slice(0, 500); }), named: named });
      }
      if (m[0] === "") re.lastIndex += (re.unicode && s.codePointAt(re.lastIndex) > 0xFFFF) ? 2 : 1;
      if (count >= limit) break;
    }
    var out = { count: count, matches: matches, more: count >= limit, pos: pos };
    if (typeof replace === "string") {
      try { out.replaced = s.replace(new RegExp(String(pattern), regexFlags(flags)), replace).slice(0, 20000); } catch (e) { out.replaced = ""; }
    }
    return out;
  }

  // ---------- What the selection looks like (suggested tool) ----------
  function sniff(sel) {
    var s = String(sel || "").trim();
    if (!s || /\n/.test(s)) return "";
    if (s.length > 40 && s.length < 20000 && looksJwt(s)) return "jwt";
    if (s.length > 300) return "";
    if (parseColor(s)) return "color";
    if (/^\d{9,19}$/.test(s) || (parseStamp(s) && /^\d{4}-/.test(s))) return "time";
    if (parseNumber(s) !== null) return "base";
    return "";
  }

  var api = {
    toHex: toHex, toB64: toB64, utf8: utf8, md5: md5, ALGOS: ALGOS, hashAll: hashAll, matchHash: matchHash,
    uuid4: uuid4, uuid7: uuid7, parseStamp: parseStamp, isoLocal: isoLocal, relTime: relTime, stampRows: stampRows,
    parseNumber: parseNumber, baseRows: baseRows, parseColor: parseColor, colorRows: colorRows,
    jsonTree: jsonTree, jsonCheck: jsonCheck, jsonSortKeys: jsonSortKeys, jsonToYaml: jsonToYaml, yamlStr: yamlStr,
    yamlCheck: yamlCheck, yamlFormat: yamlFormat, yamlToJson: yamlToJson, sniff: sniff,
    jwtDecode: jwtDecode, looksJwt: looksJwt, regexFlags: regexFlags, regexRun: regexRun
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PadDev = api;
})(typeof window !== "undefined" ? window : globalThis);
