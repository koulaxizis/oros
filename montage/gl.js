// ============================================================
// orOS Montage — compositor (WebGL2). Draws one frame of a project:
// the layers of MontageCore.framePlan(), bottom to top, onto a canvas.
// The same code draws the preview and every exported frame, so the
// file looks exactly like the preview.
//
//   var comp = MontageGL.create(canvas)
//   comp.draw(layers, source, { bg: "#000000" })
//     layers  from framePlan(project, t)
//     source  function (layer) → { img, w, h } | null, where img is
//             anything WebGL can upload (video element, image, canvas,
//             VideoFrame); null = not ready, the layer is skipped
//   comp.dispose()
//
// Per layer: fit (contain) or fill (cover, cropped to its box),
// rotation 0/90/180/270, mirror, opacity, brightness, contrast,
// saturation, temperature, a filter, transitions (dx/dy shift, sc
// zoom, iris circle, wipe clip, fade to black), a colour look from a
// .cube table (layer lut: the table as an n²×n picture, asked from
// source({ k: "lut" })), chroma key (ck), border and rounded corners
// (bd), and a reframe focus for fill (fc). Titles are drawn with the 2D canvas into a
// texture and cached until their text or size changes.
// ============================================================
(function (root) {
  "use strict";

  var VS = "#version 300 es\n" +
    "in vec2 p;uniform vec4 r;uniform int rot;uniform bool fl;out vec2 uv;\n" +
    "void main(){vec2 q=p;if(fl)q.x=1.0-q.x;\n" +
    " if(rot==1)q=vec2(q.y,1.0-q.x);else if(rot==2)q=vec2(1.0-q.x,1.0-q.y);else if(rot==3)q=vec2(1.0-q.y,q.x);\n" +
    " uv=q;vec2 d=r.xy+p*r.zw;gl_Position=vec4(d.x*2.0-1.0,1.0-d.y*2.0,0.0,1.0);}";
  var FS = "#version 300 es\nprecision highp float;\n" +
    "uniform sampler2D t;uniform sampler2D lt;uniform float ln;uniform float a;uniform float bri;uniform vec4 lk;uniform mat3 fm;uniform vec3 fo;\n" +
    "uniform vec4 clip;uniform vec2 res;uniform bool solid;uniform vec3 col;uniform float iris;in vec2 uv;out vec4 o;\n" +
    "uniform vec4 ck;uniform vec2 kc;uniform vec4 rr;uniform vec3 rd;uniform vec3 bc;\n" +
    "void main(){vec2 f=vec2(gl_FragCoord.x/res.x,1.0-gl_FragCoord.y/res.y);\n" +
    " if(f.x<clip.x||f.x>clip.z||f.y<clip.y||f.y>clip.w)discard;\n" +
    " if(iris>=0.0){vec2 d=(f-0.5)*res/max(res.x,res.y);if(length(d)>iris*0.7072)discard;}\n" +
    " vec4 c=solid?vec4(col,1.0):texture(t,uv);\n" +
    // chroma key (MontageCore.chromaKey): distance in the CbCr plane
    " if(ck.w>0.5){vec2 q=vec2(-0.1687*c.r-0.3313*c.g+0.5*c.b,0.5*c.r-0.4187*c.g-0.0813*c.b);\n" +
    "  float bs=distance(q,kc)-ck.x;float l0=dot(c.rgb,vec3(0.2126,0.7152,0.0722));\n" +
    "  c.rgb=mix(vec3(l0),c.rgb,pow(clamp(bs/ck.z,0.0,1.0),1.5));c.a*=pow(clamp(bs/ck.y,0.0,1.0),1.5);}\n" +
    " c.rgb+=lk.x;c.rgb=(c.rgb-0.5)*(1.0+lk.y)+0.5;\n" +
    " float l=dot(c.rgb,vec3(0.2126,0.7152,0.0722));c.rgb=mix(vec3(l),c.rgb,1.0+lk.z);\n" +
    " c.r+=lk.w*0.1;c.b-=lk.w*0.1;\n" +
    " c.rgb=clamp(fm*c.rgb+fo,0.0,1.0);\n" +
    " if(ln>1.0){vec3 q=clamp(c.rgb,0.0,1.0)*(ln-1.0);float b0=floor(q.b),b1=min(b0+1.0,ln-1.0);\n" +
    "  vec2 rg=(q.rg+0.5)/vec2(ln*ln,ln);\n" +
    "  c.rgb=mix(texture(lt,rg+vec2(b0/ln,0.0)).rgb,texture(lt,rg+vec2(b1/ln,0.0)).rgb,q.b-b0);}\n" +
    // rounded corners and a border inside the region rr (frame fractions)
    " if(rd.z>0.5){vec2 q2=(f-rr.xy)*res;vec2 hs=rr.zw*res*0.5;vec2 e=abs(q2-hs)-(hs-vec2(rd.x));\n" +
    "  float sd=length(max(e,0.0))+min(max(e.x,e.y),0.0)-rd.x;\n" +
    "  if(rd.y>0.0){float bm=clamp(sd+rd.y+0.5,0.0,1.0);c.rgb=mix(c.rgb,bc,bm);c.a=mix(c.a,1.0,bm);}\n" +
    "  c.a*=clamp(0.5-sd,0.0,1.0);}\n" +
    " c.rgb*=bri;o=vec4(c.rgb,c.a*a);}";

  // Filters: colour matrix (rows) + offset
  var ID = [1, 0, 0, 0, 1, 0, 0, 0, 1], Z = [0, 0, 0];
  var FILTERS = {
    none: [ID, Z],
    mono: [[0.2126, 0.7152, 0.0722, 0.2126, 0.7152, 0.0722, 0.2126, 0.7152, 0.0722], Z],
    sepia: [[0.393, 0.769, 0.189, 0.349, 0.686, 0.168, 0.272, 0.534, 0.131], Z],
    warm: [[1.08, 0, 0, 0, 1.0, 0, 0, 0, 0.88], [0.02, 0.01, 0]],
    cool: [[0.9, 0, 0, 0, 1.0, 0, 0, 0, 1.1], [0, 0.01, 0.03]],
    vivid: [[1.3, -0.15, -0.15, -0.15, 1.3, -0.15, -0.15, -0.15, 1.3], Z],
    fade: [[0.8, 0.05, 0.05, 0.05, 0.8, 0.05, 0.05, 0.05, 0.8], [0.08, 0.08, 0.1]],
    noir: [[0.3, 0.8, 0.1, 0.3, 0.8, 0.1, 0.3, 0.8, 0.1], [-0.12, -0.12, -0.12]],
    film: [[1.05, 0.05, -0.05, 0, 1.0, 0.03, -0.03, 0.05, 0.92], [0.02, 0.0, 0.04]],
    vintage: [[0.85, 0.12, 0.05, 0.06, 0.82, 0.06, 0.05, 0.12, 0.65], [0.07, 0.05, 0.04]],
    chrome: [[1.2, -0.05, -0.05, -0.05, 1.18, -0.05, -0.05, -0.05, 1.2], [-0.05, -0.05, -0.04]],
    dusk: [[1.02, 0.06, 0.04, 0.0, 0.88, 0.06, 0.06, 0.04, 1.05], [0.03, 0.0, 0.06]],
    golden: [[1.12, 0.06, 0.0, 0.04, 1.02, 0.0, 0.0, 0.02, 0.78], [0.03, 0.02, 0.0]]
  };
  var FONTS = {
    sans: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', sans-serif",
    serif: "Georgia, 'Noto Serif', 'Times New Roman', serif",
    mono: "ui-monospace, 'Cascadia Mono', 'Noto Sans Mono', monospace",
    display: "Impact, 'Arial Black', 'Noto Sans', sans-serif"
  };

  function hexRgb(h) {
    var n = parseInt(String(h || "#000000").slice(1), 16) || 0;
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  }
  // The chroma key's numbers (MontageCore.ckParams, kept here too so the
  // compositor works on its own).
  function ckParams(ck) {
    return { sim: ck.tol / 100 * 0.3, sm: Math.max(0.001, ck.soft / 100 * 0.2), sp: Math.max(0.001, ck.sp / 100 * 0.3) };
  }
  // Transpose a row-major 3x3 for uniformMatrix3fv (column-major).
  function colMajor(m) { return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]; }

  // Where a w×h picture lands inside a box (fractions of the frame),
  // for a frame of fw×fh pixels. fit: contain; fill: cover. focus
  // (fill only) { x, y } 0..1 of the picture: that point goes to the
  // middle of the box as far as the picture still covers the box
  // (auto reframe).
  function placeIn(box, w, h, fw, fh, fill, focus) {
    var bw = box.w * fw, bh = box.h * fh, sr = w / h, br = bw / bh;
    var dw, dh;
    if ((sr > br) !== !!fill) { dw = bw; dh = bw / sr; } else { dh = bh; dw = bh * sr; }
    var x = box.x + (bw - dw) / 2 / fw, y = box.y + (bh - dh) / 2 / fh;
    if (fill && focus) {
      var cx = box.x + box.w / 2 - focus.x * dw / fw, cy = box.y + box.h / 2 - focus.y * dh / fh;
      x = Math.min(box.x, Math.max(box.x + box.w - dw / fw, cx));
      y = Math.min(box.y, Math.max(box.y + box.h - dh / fh, cy));
    }
    return { x: x, y: y, w: dw / fw, h: dh / fh };
  }
  // Corner radius and border width in pixels for a region of rw×rh px
  // in a fw×fh frame (bd from MontageCore: w % of the frame's shorter
  // side, r % of the region's shorter side, at most a circle).
  function borderPx(bd, rw, rh, fw, fh) {
    var half = Math.min(rw, rh) / 2;
    return { r: Math.min(half, bd.r / 100 * Math.min(rw, rh)), w: Math.min(half, bd.w / 100 * Math.min(fw, fh)) };
  }
  // The key colour in the CbCr plane (the shader's kc).
  function keyCbCr(hex) {
    var c = hexRgb(hex);
    return [-0.1687 * c[0] - 0.3313 * c[1] + 0.5 * c[2], 0.5 * c[0] - 0.4187 * c[1] - 0.0813 * c[2]];
  }

  // Title layout: lines of text, size sz% of the frame height, inside
  // the box, with an optional outline and background box.
  function drawTitle(cv, text, pxW, pxH) {
    var g = cv.getContext("2d");
    cv.width = Math.max(2, Math.round(pxW)); cv.height = Math.max(2, Math.round(pxH));
    g.clearRect(0, 0, cv.width, cv.height);
    var size = Math.max(6, text.sz / 100 * text.fh);
    g.font = "600 " + size + "px " + (FONTS[text.f] || FONTS.sans);
    g.textBaseline = "middle";
    var lines = String(text.t || "").split("\n"), lh = size * 1.22, pad = size * 0.35;
    // wrap long lines to the box width
    var wrapped = [];
    lines.forEach(function (ln) {
      var words = ln.split(" "), cur = "";
      words.forEach(function (w) {
        var tryS = cur ? cur + " " + w : w;
        if (cur && g.measureText(tryS).width > cv.width - 2 * pad) { wrapped.push(cur); cur = w; } else cur = tryS;
      });
      wrapped.push(cur);
    });
    var total = wrapped.length * lh, y0 = (cv.height - total) / 2 + lh / 2;
    var align = text.al === "l" ? "left" : (text.al === "r" ? "right" : "center");
    var x = align === "left" ? pad : (align === "right" ? cv.width - pad : cv.width / 2);
    g.textAlign = align;
    wrapped.forEach(function (ln, i) {
      var y = y0 + i * lh, w = g.measureText(ln).width;
      if (text.bx && ln) {
        var bx = align === "left" ? x - pad / 2 : (align === "right" ? x - w - pad / 2 : x - w / 2 - pad / 2);
        g.fillStyle = text.bx; g.fillRect(bx, y - lh / 2, w + pad, lh);
      }
      if (text.ol) { g.lineWidth = Math.max(2, size * 0.12); g.strokeStyle = text.ol; g.lineJoin = "round"; g.strokeText(ln, x, y); }
      g.fillStyle = text.col; g.fillText(ln, x, y);
    });
  }
  // A shape filling a pw×ph canvas: fill and/or outline.
  function drawShape(cv, sh, pw, ph) {
    var g = cv.getContext("2d");
    cv.width = Math.max(2, Math.round(pw)); cv.height = Math.max(2, Math.round(ph));
    g.clearRect(0, 0, cv.width, cv.height);
    var W = cv.width, H = cv.height, lw = sh.ol && sh.ow ? Math.max(1, sh.ow / 100 * Math.min(W, H)) : 0, m = lw / 2 + 1;
    var x0 = m, y0 = m, x1 = W - m, y1 = H - m, w = x1 - x0, h = y1 - y0;
    g.beginPath();
    if (sh.k === "round" || sh.k === "bubble") {
      var bh = sh.k === "bubble" ? h * 0.78 : h, r = Math.min(w, bh) * 0.22;
      g.moveTo(x0 + r, y0); g.arcTo(x1, y0, x1, y0 + bh, r); g.arcTo(x1, y0 + bh, x0, y0 + bh, r);
      if (sh.k === "bubble") { g.lineTo(x0 + w * 0.42, y0 + bh); g.lineTo(x0 + w * 0.2, y1); g.lineTo(x0 + w * 0.26, y0 + bh); }
      g.arcTo(x0, y0 + bh, x0, y0, r); g.arcTo(x0, y0, x1, y0, r);
    } else if (sh.k === "ellipse") g.ellipse(W / 2, H / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    else if (sh.k === "triangle") { g.moveTo(W / 2, y0); g.lineTo(x1, y1); g.lineTo(x0, y1); }
    else if (sh.k === "star") {
      for (var i = 0; i < 10; i++) {
        var a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? 0.4 : 1;
        var px = W / 2 + Math.cos(a) * w / 2 * rr, py = y0 + h * 0.52 + Math.sin(a) * h / 2 * rr;
        if (i) g.lineTo(px, py); else g.moveTo(px, py);
      }
    } else if (sh.k === "heart") {
      g.moveTo(W / 2, y0 + h * 0.28);
      g.bezierCurveTo(W / 2, y0, x0, y0, x0, y0 + h * 0.32);
      g.bezierCurveTo(x0, y0 + h * 0.62, W / 2, y0 + h * 0.8, W / 2, y1);
      g.bezierCurveTo(W / 2, y0 + h * 0.8, x1, y0 + h * 0.62, x1, y0 + h * 0.32);
      g.bezierCurveTo(x1, y0, W / 2, y0, W / 2, y0 + h * 0.28);
    } else if (sh.k === "arrow") {
      g.moveTo(x0, y0 + h * 0.32); g.lineTo(x0 + w * 0.6, y0 + h * 0.32); g.lineTo(x0 + w * 0.6, y0);
      g.lineTo(x1, y0 + h / 2); g.lineTo(x0 + w * 0.6, y1); g.lineTo(x0 + w * 0.6, y0 + h * 0.68); g.lineTo(x0, y0 + h * 0.68);
    } else g.rect(x0, y0, w, h);
    g.closePath();
    if (sh.col) { g.fillStyle = sh.col; g.fill(); }
    if (lw) { g.lineWidth = lw; g.lineJoin = "round"; g.strokeStyle = sh.ol; g.stroke(); }
  }
  // Entrance animation in the first 0.5 s: alpha, y shift, scale.
  function titleAnim(an, local) {
    var q = Math.min(1, Math.max(0, local / 0.5)), e = 1 - Math.pow(1 - q, 3);
    if (an === "fade") return { a: e, dy: 0, s: 1 };
    if (an === "rise") return { a: e, dy: (1 - e) * 0.06, s: 1 };
    if (an === "pop") return { a: Math.min(1, q * 2), dy: 0, s: 0.6 + 0.4 * e + Math.sin(q * Math.PI) * 0.08 };
    return { a: 1, dy: 0, s: 1 };
  }

  function create(canvas) {
    var gl = canvas.getContext("webgl2", { alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
    if (!gl) throw new Error("WebGL2 is not available");
    function sh(type, src) {
      var s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "shader");
      return s;
    }
    var prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || "link");
    gl.useProgram(prog);
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    var U = {};
    ["r", "rot", "fl", "t", "lt", "ln", "a", "bri", "lk", "fm", "fo", "clip", "res", "solid", "col", "iris", "ck", "kc", "rr", "rd", "bc"].forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(U.t, 0);
    // colour look (.cube) table: texture unit 1, uploaded when it changes
    var lutTex = gl.createTexture(), lutId = null;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, lutTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(U.lt, 1);
    gl.uniform1f(U.ln, 0);
    function useLut(id, source) {
      if (!id) { gl.uniform1f(U.ln, 0); return; }
      var s = source({ k: "lut", id: "lut:" + id, src: id });
      if (!s || !s.img || !(s.h >= 2) || s.w !== s.h * s.h) { gl.uniform1f(U.ln, 0); return; }
      if (lutId !== id) {
        gl.activeTexture(gl.TEXTURE1);
        try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, s.img); lutId = id; }
        catch (e) { lutId = null; }
        gl.activeTexture(gl.TEXTURE0);
      }
      gl.uniform1f(U.ln, lutId === id ? s.h : 0);
    }
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    var titles = {};                                  // layer id → { key, cv }

    function quad(rect, rot, fl, alpha, bri, lk, flt, clip, solidCol, iris) {
      var f = FILTERS[flt] || FILTERS.none;
      gl.uniform4f(U.r, rect.x, rect.y, rect.w, rect.h);
      gl.uniform1i(U.rot, (rot || 0) / 90);
      gl.uniform1i(U.fl, fl ? 1 : 0);
      gl.uniform1f(U.a, alpha);
      gl.uniform1f(U.bri, bri);
      gl.uniform4f(U.lk, lk ? lk.b / 200 : 0, lk ? lk.c / 100 : 0, lk ? lk.s / 100 : 0, lk ? lk.t / 100 : 0);
      gl.uniformMatrix3fv(U.fm, false, colMajor(f[0]));
      gl.uniform3f(U.fo, f[1][0], f[1][1], f[1][2]);
      gl.uniform4f(U.clip, clip[0], clip[1], clip[2], clip[3]);
      gl.uniform1f(U.iris, iris >= 0 ? iris : -1);
      gl.uniform1i(U.solid, solidCol ? 1 : 0);
      if (solidCol) gl.uniform3f(U.col, solidCol[0], solidCol[1], solidCol[2]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    function draw(layers, source, opts) {
      var fw = canvas.width, fh = canvas.height, bg = hexRgb(opts && opts.bg);
      gl.viewport(0, 0, fw, fh);
      gl.uniform2f(U.res, fw, fh);
      gl.clearColor(bg[0], bg[1], bg[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      var seen = {};
      (layers || []).forEach(function (L) {
        if (!(L.alpha > 0)) return;
        var box = L.box || { x: 0, y: 0, w: 1, h: 1 };
        var sc = L.sc > 0 ? L.sc : 1, iris = L.iris >= 0 ? L.iris : -1;
        box = {
          x: box.x + (L.dx || 0) + box.w * (1 - sc) / 2, y: box.y + (L.dy || 0) + box.h * (1 - sc) / 2,
          w: box.w * sc, h: box.h * sc
        };
        // the wipe shows [clip0, clip1] of the frame; a fill picture is cut to its box
        var clip = [L.clip ? L.clip[0] : -9, -9, L.clip ? L.clip[1] : 9, 9];
        if (L.k === "shape") {
          seen[L.id] = 1;
          var sw = box.w * fw, shh = box.h * fh, skey = "shape|" + JSON.stringify(L.sh) + "|" + Math.round(sw) + "x" + Math.round(shh);
          var sc0 = titles[L.id];
          if (!sc0) sc0 = titles[L.id] = { key: "", cv: document.createElement("canvas") };
          if (sc0.key !== skey) { drawShape(sc0.cv, L.sh, sw, shh); sc0.key = skey; }
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sc0.cv);
          quad(box, 0, false, L.alpha, L.bri, null, "none", clip, null, iris);
          return;
        }
        if (L.k === "title") {
          seen[L.id] = 1;
          if (L.bg) quad(box, 0, false, L.alpha, L.bri, null, "none", clip, hexRgb(L.bg), iris);
          var pw = box.w * fw, ph = box.h * fh;
          var key = JSON.stringify(L.text) + "|" + Math.round(pw) + "x" + Math.round(ph) + "|" + fh;
          var tt = titles[L.id];
          if (!tt) tt = titles[L.id] = { key: "", cv: document.createElement("canvas") };
          if (tt.key !== key) {
            var tx = {}; Object.keys(L.text).forEach(function (k) { tx[k] = L.text[k]; });
            tx.fh = fh;
            drawTitle(tt.cv, tx, pw, ph);
            tt.key = key;
          }
          var an = titleAnim(L.text.an, L.local || 0);
          var r = { x: box.x + box.w * (1 - an.s) / 2, y: box.y + an.dy + box.h * (1 - an.s) / 2, w: box.w * an.s, h: box.h * an.s };
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, tt.cv);
          quad(r, 0, false, L.alpha * an.a, L.bri, null, "none", clip, null, iris);
          return;
        }
        var s = source(L);
        if (!s || !s.img || !(s.w > 0) || !(s.h > 0)) return;
        var sideways = L.rot === 90 || L.rot === 270;
        var rect = placeIn(box, sideways ? s.h : s.w, sideways ? s.w : s.h, fw, fh, L.fit === "fill", L.fc);
        if (L.fit === "fill") {
          clip[0] = Math.max(clip[0], box.x); clip[2] = Math.min(clip[2], box.x + box.w);
          clip[1] = box.y; clip[3] = box.y + box.h;
        }
        try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, s.img); }
        catch (e) { return; }                         // a frame that cannot be read yet
        useLut(L.lut, source);
        if (L.ck) {
          var cp = ckParams(L.ck), kc = keyCbCr(L.ck.col);
          gl.uniform4f(U.ck, cp.sim, cp.sm, cp.sp, 1); gl.uniform2f(U.kc, kc[0], kc[1]);
        }
        if (L.bd) {
          var reg = L.fit === "fill" ? box : rect, bp = borderPx(L.bd, reg.w * fw, reg.h * fh, fw, fh), bcol = hexRgb(L.bd.col);
          gl.uniform4f(U.rr, reg.x, reg.y, reg.w, reg.h); gl.uniform3f(U.rd, bp.r, bp.w, 1); gl.uniform3f(U.bc, bcol[0], bcol[1], bcol[2]);
        }
        quad(rect, L.rot, L.fl, L.alpha, L.bri, L.lk, L.flt, clip, null, iris);
        gl.uniform1f(U.ln, 0);
        if (L.ck) gl.uniform4f(U.ck, 0, 1, 1, 0);
        if (L.bd) gl.uniform3f(U.rd, 0, 0, 0);
      });
      Object.keys(titles).forEach(function (k) { if (!seen[k]) delete titles[k]; });
      gl.flush();
    }

    function dispose() {
      titles = {};
      try { gl.deleteTexture(tex); gl.deleteTexture(lutTex); gl.deleteBuffer(buf); gl.deleteProgram(prog); } catch (e) {}
      var ext = gl.getExtension("WEBGL_lose_context");
      if (ext) ext.loseContext();
    }

    return { draw: draw, dispose: dispose, gl: gl };
  }

  var api = { create: create, placeIn: placeIn, borderPx: borderPx, keyCbCr: keyCbCr, ckParams: ckParams, titleAnim: titleAnim, FILTERS: Object.keys(FILTERS), FONTS: Object.keys(FONTS) };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MontageGL = api;
})(typeof window !== "undefined" ? window : this);
