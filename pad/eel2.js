// ============================================================
// orOS Pad — EEL2 / JSFX highlighting (a CodeMirror stream mode)
// REAPER's JSFX language: a header (desc:, slider1:…, in_pin:,
// import, options:, filename:), code sections (@init, @slider,
// @block, @sample, @serialize, @gfx) written in EEL2. Used for
// .jsfx, .jsfx-inc, .eel and NULL JSFX's own files.
// Plain data and functions, no DOM: app.js hands it to
// StreamLanguage.define(); Node tests it (tests/pad.test.js).
// Token names are CodeMirror's legacy names (keyword, number,
// string, comment, variableName.special, meta, heading, operator).
// ============================================================
(function (root) {
  "use strict";

  var KEYWORDS = /^(?:function|local|static|instance|globals|global|this|while|loop|_global)$/;
  var BUILTINS = /^(?:sin|cos|tan|asin|acos|atan|atan2|sqr|sqrt|pow|exp|log|log10|abs|min|max|sign|rand|floor|ceil|invsqrt|freembuf|memcpy|memset|mem_set_values|mem_get_values|mem_multiply_sum|mem_insert_shuffle|stack_push|stack_pop|stack_peek|stack_exch|fft|ifft|fft_real|ifft_real|fft_permute|fft_ipermute|convolve_c|mdct|imdct|sprintf|printf|strlen|strcat|strcpy|strncpy|strncat|strcmp|stricmp|strncmp|strnicmp|str_getchar|str_setchar|str_setlen|str_delsub|str_insert|strcpy_from|strcpy_substr|match|matchi|tolower|toupper|atomic_setifequal|atomic_exch|atomic_add|atomic_set|atomic_get|slider|slider_automate|slider_show|slider_next_chg|sliderchange|spl|midirecv|midisend|midisend_buf|midirecv_buf|midisyx|midirecv_str|midisend_str|file_open|file_close|file_rewind|file_var|file_mem|file_avail|file_riff|file_text|file_string|export_buffer_to_project|get_host_numchan|set_host_numchan|get_pin_mapping|set_pin_mapping|get_pinmapper_flags|set_pinmapper_flags|get_host_placement|time|time_precise|gfx_set|gfx_lineto|gfx_line|gfx_rectto|gfx_rect|gfx_setpixel|gfx_getpixel|gfx_drawnumber|gfx_drawchar|gfx_drawstr|gfx_measurestr|gfx_measurechar|gfx_printf|gfx_setfont|gfx_getfont|gfx_blurto|gfx_blit|gfx_blitext|gfx_getimgdim|gfx_setimgdim|gfx_loadimg|gfx_gradrect|gfx_muladdrect|gfx_deltablit|gfx_transformblit|gfx_circle|gfx_roundrect|gfx_arc|gfx_triangle|gfx_getchar|gfx_showmenu|gfx_setcursor|gfx_getsyscol)$/;
  var SPECIAL = /^(?:spl\d+|slider\d+|srate|num_ch|samplesblock|tempo|play_state|play_position|beat_position|ts_num|ts_denom|trigger|pdc_delay|pdc_bot_ch|pdc_top_ch|pdc_midi|ext_noinit|ext_nodenorm|ext_tail_size|ext_midi_bus|midi_bus|reg\d\d|gfx_[a-z_]+|mouse_[a-z_]+|\$pi|\$e|\$phi)$/;
  var HEADER = /^(?:desc|tags|author|version|about|changelog|link|provides|screenshot|donation|import|options|filename|in_pin|out_pin|slider\d+|config):?/;

  function startState() { return { section: "", inComment: false }; }

  function token(stream, state) {
    if (state.inComment) {
      if (stream.match(/^.*?\*\//)) state.inComment = false;
      else stream.skipToEnd();
      return "comment";
    }
    if (stream.sol()) {
      // A section line: @init, @slider, @block, @sample, @serialize, @gfx [w h]
      if (stream.match(/^@[a-z_]+/)) { state.section = stream.current(); stream.skipToEnd(); return "heading"; }
      // Header lines only before the first section.
      if (!state.section && stream.match(HEADER)) { return "meta"; }
    }
    if (stream.eatSpace()) return null;
    if (stream.match("//")) { stream.skipToEnd(); return "comment"; }
    if (stream.match("/*")) { state.inComment = true; return token(stream, state); }
    var ch = stream.peek();
    if (ch === '"' || ch === "'") {
      stream.next();
      var esc = false, c;
      while ((c = stream.next()) != null) {
        if (c === ch && !esc) break;
        esc = !esc && c === "\\";
      }
      return "string";
    }
    if (stream.match(/^\$x[0-9a-f]+/i) || stream.match(/^\$'.'/) ||
        stream.match(/^0x[0-9a-f]+/i) || stream.match(/^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i)) return "number";
    if (stream.match(/^\$(?:pi|e|phi)\b/i)) return "variableName.special";
    if (stream.match(/^#[A-Za-z_][\w.]*/)) return "string";
    var w = stream.match(/^[A-Za-z_][\w.]*/);
    if (w) {
      var word = w[0];
      if (KEYWORDS.test(word)) return "keyword";
      if (SPECIAL.test(word)) return "variableName.special";
      if (BUILTINS.test(word)) return "variableName.function";
      return "variableName";
    }
    if (stream.match(/^(?:==|!=|<=|>=|&&|\|\||<<|>>|\+=|-=|\*=|\/=|%=|\^=|\|=|&=|[-+*\/%^=<>!?:&|~])/)) return "operator";
    stream.next();
    return null;
  }

  var MODE = {
    name: "eel2",
    startState: startState,
    copyState: function (s) { return { section: s.section, inComment: s.inComment }; },
    token: token,
    languageData: { commentTokens: { line: "//", block: { open: "/*", close: "*/" } } }
  };

  if (typeof module === "object" && module.exports) module.exports = MODE;
  else root.PadEel2 = MODE;
})(typeof window !== "undefined" ? window : globalThis);
