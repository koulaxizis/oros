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
// source({ k: "lut" })). Titles are drawn with the 2D canvas into a
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
    "void main(){vec2 f=vec2(gl_FragCoord.x/res.x,1.0-gl_FragCoord.y/res.y);\n" +
    " if(f.x<clip.x||f.x>clip.z||f.y<clip.y||f.y>clip.w)discard;\n" +
    " if(iris>=0.0){vec2 d=(f-0.5)*res/max(res.x,res.y);if(length(d)>iris*0.7072)discard;}\n" +
    " vec4 c=solid?vec4(col,1.0):texture(t,uv);\n" +
    " c.rgb+=lk.x;c.rgb=(c.rgb-0.5)*(1.0+lk.y)+0.5;\n" +
    " float l=dot(c.rgb,vec3(0.2126,0.7152,0.0722));c.rgb=mix(vec3(l),c.rgb,1.0+lk.z);\n" +
    " c.r+=lk.w*0.1;c.b-=lk.w*0.1;\n" +
    " c.rgb=clamp(fm*c.rgb+fo,0.0,1.0);\n" +
    " if(ln>1.0){vec3 q=clamp(c.rgb,0.0,1.0)*(ln-1.0);float b0=floor(q.b),b1=min(b0+1.0,ln-1.0);\n" +
    "  vec2 rg=(q.rg+0.5)/vec2(ln*ln,ln);\n" +
    "  c.rgb=mix(texture(lt,rg+vec2(b0/ln,0.0)).rgb,texture(lt,rg+vec2(b1/ln,0.0)).rgb,q.b-b0);}\n" +
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
  // Transpose a row-major 3x3 for uniformMatrix3fv (column-major).
  function colMajor(m) { return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]; }

  // Where a w×h picture lands inside a box (fractions of the frame),
  // for a frame of fw×fh pixels. fit: contain; fill: cover.
  function placeIn(box, w, h, fw, fh, fill) {
    var bw = box.w * fw, bh = box.h * fh, sr = w / h, br = bw / bh;
    var dw, dh;
    if ((sr > br) !== !!fill) { dw = bw; dh = bw / sr; } else { dh = bh; dw = bh * sr; }
    return { x: box.x + (bw - dw) / 2 / fw, y: box.y + (bh - dh) / 2 / fh, w: dw / fw, h: dh / fh };
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
    ["r", "rot", "fl", "t", "lt", "ln", "a", "bri", "lk", "fm", "fo", "clip", "res", "solid", "col", "iris"].forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });
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
        var rect = placeIn(box, sideways ? s.h : s.w, sideways ? s.w : s.h, fw, fh, L.fit === "fill");
        if (L.fit === "fill") {
          clip[0] = Math.max(clip[0], box.x); clip[2] = Math.min(clip[2], box.x + box.w);
          clip[1] = box.y; clip[3] = box.y + box.h;
        }
        try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, s.img); }
        catch (e) { return; }                         // a frame that cannot be read yet
        useLut(L.lut, source);
        quad(rect, L.rot, L.fl, L.alpha, L.bri, L.lk, L.flt, clip, null, iris);
        gl.uniform1f(U.ln, 0);
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

  var api = { create: create, placeIn: placeIn, titleAnim: titleAnim, FILTERS: Object.keys(FILTERS), FONTS: Object.keys(FONTS) };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MontageGL = api;
})(typeof window !== "undefined" ? window : this);
