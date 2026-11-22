// ============================================================
// orOS Layout — commands.js: what the Assistant may change in a
// document (AS-EDIT for Layout, v1.0.0)
// The commands are Layout's automation steps (recipesteps.js, LY-IN
// wave Q5) without preflight and export, plus rename; the Assistant
// never writes code or raw data, it sends { op, …fields } that
// check() accepts. The same file runs in two places:
//   - in the Assistant, to check a command list, find the documents it
//     is for (targets), count what it would change on copies of the
//     stored documents (preview) and describe a document to the AI
//     (outline, with the user's consent);
//   - in Layout (assist.js), which applies it.
// Styles and masters are named by id or by name (any language, any
// case), pages by position ("3-10,12", 1 = the first page).
// apply(doc, step, env) edits a copy of a document in place and
// returns how many things changed. env: { now, grey: { asset id: its
// black and white copy } }. Without the text engine (the Assistant
// loads only the model) pages are added without running text on and
// fit counts as one change, made when Layout applies it (note "fitLater").
// Pure: no DOM. Exposes window.LayoutCommands (browser) or module.exports.
// ============================================================
(function (root) {
  "use strict";

  var node = typeof module !== "undefined" && module.exports;
  var R = node ? require("../recipes/core.js") : root.orosRecipes;
  var PRO = node ? require("./pro.js") : root.LayoutPro;
  var S = node ? require("./recipesteps.js") : root.LayoutRecipes;
  var SH = node ? require("../recipes/share.js") : root.orosRecipeShare;
  var M = node ? require("../designkit/model.js") : root.orosDK && root.orosDK.model;
  if (!R || !S || !M) return;
  function hasEngine() { return node || !!(root.orosDK && root.orosDK.render && root.orosDK.text); }

  // The picture op's corrections → a record for setPicture, "none" or
  // null (nothing asked). Each is a list of numbers in its fields' order.
  var ADJ_FIELDS = { levels: ["ib", "iw", "g", "ob", "ow"], curves: ["s", "m", "h"], bc: ["b", "c"], balance: ["r", "g", "b"], hsl: ["h", "s", "l"] };
  function pictureAdj(st) {
    if (st.adjust === "none") return "none";
    var out = {}, any = false;
    Object.keys(ADJ_FIELDS).forEach(function (id) {
      var v = String(st[id] || "").trim();
      if (!v) return;
      var nums = v.split(/[\s,;]+/).map(Number), o = {};
      ADJ_FIELDS[id].forEach(function (k, i) { if (isFinite(nums[i])) o[k] = nums[i]; });
      out[id] = o; any = true;
    });
    if (st.gray === "on") { out.gray = 1; any = true; } else if (st.gray === "off") { out.gray = 0; any = true; }
    return any ? out : null;
  }
  var OPS = ["text", "pstyle", "style", "master", "margins", "pages", "delpages", "fit", "numbering", "bleed", "grey", "imgfit"];
  var CATALOG = {};
  OPS.forEach(function (op) { CATALOG[op] = S.CATALOG[op]; });
  CATALOG.rename = { kind: "doc", args: { title: { t: "str", max: 120, req: 1 } } };
  // LY-PRO W1 (Chris's spec v2, items 2, 8, 13, 38): a new document,
  // pages from pictures in Claude's folders, the bleed of full-page
  // pictures and page pictures for Claude to look at.
  var MMv = function (lo, hi, def) { return { t: "num", lo: lo, hi: hi, def: def }; };
  CATALOG.create = { kind: "new", args: { title: { t: "str", max: 120 }, w: { t: "num", lo: 10, hi: 5000, def: 210, req: 1 }, h: { t: "num", lo: 10, hi: 5000, def: 297, req: 1 },
    u: { t: "enum", v: ["mm", "pt", "in", "px"], def: "mm" }, n: { t: "int", lo: 1, hi: 999, def: 1 }, facing: { t: "bool", def: 1 }, side: { t: "enum", v: ["right", "left"], def: "right" },
    mm: MMv(0, 25, 3), bt: MMv(-1, 25, -1), bb: MMv(-1, 25, -1), bi: MMv(-1, 25, -1), bo: MMv(-1, 25, -1), slug: MMv(0, 50, 0),
    t: MMv(-1, 500, -1), b: MMv(-1, 500, -1), i: MMv(-1, 500, -1), o: MMv(-1, 500, -1),
    ncol: { t: "int", lo: 1, hi: 20, def: 1 }, gut: MMv(-1, 100, -1), grid: MMv(0, 72, 0),
    color: { t: "enum", v: ["rgb", "cmyk"], def: "rgb" }, icc: { t: "enum", v: ["", "fogra39"], def: "" },
    // a starter book (LY-N1, layout/starters.js) and its type pair
    starter: { t: "enum", v: ["", "novel", "stories", "poetry", "essay", "study", "children", "photo", "cookbook", "catalogue", "magazine", "workbook", "zine"], def: "" },
    pair: { t: "enum", v: ["", "noto", "garamond", "literata", "alegreya", "sans"], def: "" } } };
  CATALOG.images = { kind: "async", args: { paths: { t: "list", of: { t: "str", max: 1024 }, max: 400 }, folder: { t: "str", max: 1024 },
    sort: { t: "enum", v: ["natural", "name", "given"], def: "natural" }, fit: { t: "enum", v: ["trim", "bleed", "margins", "proportional"], def: "trim" },
    at: { t: "enum", v: ["end", "before", "after"], def: "end" }, page: { t: "int", lo: 0, hi: 9999, def: 0 }, side: { t: "enum", v: ["any", "right", "left"], def: "any" } } };
  CATALOG.bleedfill = { kind: "async", args: { pages: { t: "str", max: 60 }, mode: { t: "enum", v: ["smart", "mirror", "stretch"], def: "smart" } } };
  CATALOG.thumbs = { kind: "out", args: { pages: { t: "str", max: 60 }, spreads: { t: "bool", def: 1 }, dpi: { t: "num", lo: 36, hi: 150, def: 96 }, out: { t: "str", max: 1030 } } };
  // LY-PRO W2 (items 5, 17, 18, 21): styles made by name (nested
  // styles too), a set of play styles, text frames, a story's new text
  // and the house's front and back pages, padded to a multiple of pages.
  var OO = { t: "enum", v: ["", "on", "off"], def: "" }, PTv = { t: "num", lo: -1, hi: 1000, def: -1 };
  var LINES = { t: "list", of: { t: "str", max: 5000 }, max: 400 };
  CATALOG.defstyle = { kind: "doc", args: { kind: { t: "enum", v: ["para", "char"], def: "para" }, name: { t: "str", max: 60, req: 1 }, base: { t: "str", max: 60 },
    font: { t: "str", max: 80 }, size: { t: "num", lo: 0, hi: 400, def: 0 }, lead: { t: "num", lo: 0, hi: 500, def: 0 },
    align: { t: "enum", v: ["", "l", "c", "r", "j"], def: "" }, track: { t: "num", lo: -500, hi: 2000, def: 0 },
    sb: PTv, sa: PTv, fi: PTv, li: PTv, ri: PTv, bold: OO, ital: OO, caps: OO, under: OO, color: { t: "color" },
    nest_cs: { t: "str", max: 60 }, nest_to: { t: "str", max: 4 }, keep: OO,
    brk: { t: "enum", v: ["", "any", "col", "page", "odd", "even"], def: "" }, hyph: OO } };
  CATALOG.styleset = { kind: "doc", args: { set: { t: "enum", v: ["play"], def: "play", req: 1 }, lang: { t: "enum", v: ["el", "en"], def: "el" } } };
  CATALOG.frame = { kind: "doc", args: { page: { t: "int", lo: 1, hi: 9999, def: 1, req: 1 }, x: MMv(-1, 5000, -1), y: MMv(-1, 5000, -1), w: MMv(-1, 5000, -1), h: MMv(-1, 5000, -1),
    lines: LINES, style: { t: "str", max: 60 }, ncol: { t: "int", lo: 1, hi: 20, def: 1 }, gut: MMv(-1, 100, -1), ins: MMv(0, 50, 0),
    va: { t: "enum", v: ["t", "m", "b", "j"], def: "t" }, fill: { t: "color" }, opacity: { t: "int", lo: 0, hi: 100, def: 100 }, clear: { t: "bool", def: 0 } } };
  CATALOG.retext = { kind: "doc", args: { frame: { t: "str", max: 80 }, story: { t: "str", max: 80 }, lines: LINES, style: { t: "str", max: 60 } } };
  CATALOG.house_pages = { kind: "doc", args: { house: { t: "str", max: 120 }, where: { t: "enum", v: ["both", "front", "back", "none"], def: "both" },
    pad: { t: "enum", v: [0, 2, 4, 8, 16], def: 0 }, keep_side: { t: "bool", def: 1 },
    title: { t: "str", max: 120 }, subtitle: { t: "str", max: 200 }, author: { t: "str", max: 200 }, isbn: { t: "str", max: 20 }, year: { t: "str", max: 4 }, publisher: { t: "str", max: 120 } } };
  // LY-PRO W3 (items 3, 4): sections with their own numbering, pages
  // moved and copied by range, masters by range and based on masters.
  var RANGE = { t: "str", max: 60, req: 1 };
  CATALOG.section = { kind: "doc", args: { page: { t: "int", lo: 1, hi: 9999, def: 1, req: 1 }, start: { t: "int", lo: -1, hi: 9999, def: -1 },
    numstyle: { t: "enum", v: ["1", "i", "I", "a", "A"], def: "1" }, prefix: { t: "str", max: 8 }, off: { t: "bool", def: 0 } } };
  CATALOG.movepages = { kind: "doc", args: { pages: RANGE, before: { t: "int", lo: 0, hi: 9999, def: 0 } } };
  CATALOG.duppages = { kind: "doc", args: { pages: RANGE } };
  CATALOG.masterpages = { kind: "doc", args: { pages: RANGE, master: { t: "str", max: 60 } } };
  CATALOG.defmaster = { kind: "doc", args: { name: { t: "str", max: 60, req: 1 }, prefix: { t: "str", max: 8 }, base: { t: "str", max: 60 } } };
  CATALOG.pagesize = { kind: "doc", args: { pages: RANGE, w: MMv(0, 5080, 0), h: MMv(0, 5080, 0) } };
  // LY-PRO W4 (items 9, 10): picture frames
  CATALOG.picture = { kind: "doc", args: { frame: { t: "str", max: 400 }, pages: { t: "str", max: 60 },
    flip: { t: "enum", v: ["", "none", "h", "v", "hv"], def: "" }, corner: MMv(-1, 500, -1), fit: { t: "enum", v: ["", "fit", "fill", "frame"], def: "" },
    // colour corrections (W4b): numbers separated by spaces, "" = as it is
    adjust: { t: "enum", v: ["", "none"], def: "" }, gray: OO, levels: { t: "str", max: 40 }, curves: { t: "str", max: 30 },
    bc: { t: "str", max: 20 }, balance: { t: "str", max: 30 }, hsl: { t: "str", max: 30 } } };
  // Chris 2026-11-18: a font into the owner's collection and this
  // document (the gate has no room for a fonts_add tool)
  CATALOG.addfont = { kind: "doc", args: { family: { t: "str", max: 60 }, source: { t: "enum", v: ["free", "local"], def: "free" }, path: { t: "str", max: 600 },
    styles: { t: "list", of: { t: "str", max: 12 }, max: 4 }, collection: { t: "str", max: 60 } } };
  // framemod (Chris 2026-11-18, P0): change or remove frames by id
  CATALOG.framemod = { kind: "doc", args: { frame: { t: "str", max: 400, req: 1 }, x: MMv(-1, 5000, -1), y: MMv(-1, 5000, -1), w: MMv(-1, 5000, -1), h: MMv(-1, 5000, -1),
    ncol: { t: "int", lo: 0, hi: 20, def: 0 }, gut: MMv(-1, 100, -1), ins: MMv(-1, 50, -1), va: { t: "enum", v: ["", "t", "m", "b", "j"], def: "" },
    fill: { t: "color" }, nofill: { t: "bool", def: 0 }, opacity: { t: "int", lo: -1, hi: 100, def: -1 }, del: { t: "bool", def: 0 },
    // text wrap (W4b): around the frame, an ellipse, its outline or a picture's transparent edges
    wrap: { t: "enum", v: ["", "none", "box", "ell", "shape", "alpha"], def: "" }, wrap_mm: MMv(-1, 100, -1),
    // anchored in the text (W4b): the frame moves with its place in the text
    anchor: { t: "enum", v: ["", "inline", "off"], def: "" }, anchor_in: { t: "str", max: 80 }, anchor_para: { t: "int", lo: 1, hi: 99999, def: 1 },
    anchor_at: { t: "enum", v: ["start", "end"], def: "start" } } };
  // placepage (W4b): a page of a PDF / Scribus / InDesign file as a picture frame's picture
  CATALOG.placepage = { kind: "async", args: { frame: { t: "str", max: 80, req: 1 }, path: { t: "str", max: 1024, req: 1 }, page: { t: "int", lo: 1, hi: 9999, def: 1 } } };
  // colormode (Chris 2026-11-18, P1): the document's colour after create
  CATALOG.colormode = { kind: "doc", args: { color: { t: "enum", v: ["rgb", "cmyk"], def: "cmyk", req: 1 }, icc: { t: "enum", v: ["", "fogra39"], def: "" } } };
  // masterfield (Chris 2026-11-18, P1): page numbers and running heads
  CATALOG.masterfield = { kind: "doc", args: { master: { t: "str", max: 60, req: 1 }, kind: { t: "enum", v: ["pagenum", "runhead"], def: "pagenum" }, text: { t: "str", max: 200 },
    pos: { t: "enum", v: ["bc", "bo", "bi", "tc", "to", "ti"], def: "bc" }, from_edge: MMv(-1, 100, -1), font: { t: "str", max: 80 }, size: { t: "num", lo: 0, hi: 72, def: 0 },
    hide: { t: "str", max: 60 }, show: { t: "str", max: 60 }, remove: { t: "bool", def: 0 }, lang: { t: "enum", v: ["el", "en"], def: "el" } } };
  // cancel (alone): stops the commands that hold Layout ("busy")
  CATALOG.cancel = { kind: "doc", args: {} };
  // version (LY-W11, LY-N7): a named version of the document as it is
  // before these commands (assist.js saves it; it changes nothing here)
  CATALOG.version = { kind: "doc", args: { name: { t: "str", max: 80, req: 1 } } };
  // table (LY-W12): a table into a story
  CATALOG.table = { kind: "doc", args: { frame: { t: "str", max: 80 }, story: { t: "str", max: 80 }, rows: { t: "list", of: { t: "str", max: 4000 }, max: 1000, req: 1 },
    header: { t: "int", lo: 0, hi: 20, def: 1 }, repeat: { t: "bool", def: 1 }, after_para: { t: "int", lo: 0, hi: 99999, def: 0 }, replace: { t: "int", lo: 0, hi: 9999, def: 0 },
    widths: { t: "str", max: 200 }, rule: { t: "num", lo: -1, hi: 12, def: -1 }, padding: { t: "num", lo: -1, hi: 36, def: -1 },
    rule_color: { t: "color" }, header_fill: { t: "color" }, style: { t: "str", max: 60 } } };
  // index (LY-W13): words marked for the book's index, the index made
  // effects (LY-W14): shadow, glow, soft edges, blend mode on frames
  CATALOG.effects = { kind: "doc", args: { frame: { t: "str", max: 400, req: 1 }, blend: { t: "enum", v: ["", "normal", "multiply", "screen", "overlay", "darken", "lighten"], def: "" },
    shadow_x: { t: "num", lo: -145, hi: 144, def: -145 }, shadow_y: { t: "num", lo: -145, hi: 144, def: -145 }, shadow_blur: { t: "num", lo: -1, hi: 72, def: -1 }, shadow_opacity: { t: "int", lo: -1, hi: 100, def: -1 }, shadow_color: { t: "color" },
    glow_blur: { t: "num", lo: -1, hi: 72, def: -1 }, glow_opacity: { t: "int", lo: -1, hi: 100, def: -1 }, glow_color: { t: "color" }, soft_edges: { t: "num", lo: -1, hi: 144, def: -1 } } };
  CATALOG.index = { kind: "doc", args: { terms: { t: "list", of: { t: "str", max: 200 }, max: 200 }, unmark: { t: "str", max: 120 }, build: { t: "bool", def: 1 }, title: { t: "str", max: 120 } } };
  // symbol (LY-W14): a symbol made, placed, updated, detached, renamed, deleted
  CATALOG.symbol = { kind: "doc", args: { act: { t: "enum", v: ["place", "make", "update", "detach", "rename", "delete"], def: "place" }, name: { t: "str", max: 60, req: 1 },
    frame: { t: "str", max: 400 }, new_name: { t: "str", max: 60 }, page: { t: "int", lo: 1, hi: 9999, def: 1 }, x: MMv(-1, 5000, -1), y: MMv(-1, 5000, -1), w: MMv(-1, 5000, -1) } };
  var W3 = ["section", "movepages", "duppages", "masterpages", "defmaster", "pagesize", "picture", "placepage", "framemod", "masterfield", "colormode", "addfont", "cancel", "version", "table", "index", "effects", "symbol"];
  var PRO_OPS = ["create", "images", "bleedfill", "thumbs", "defstyle", "styleset", "frame", "retext", "house_pages"].concat(W3);
  var ORDER = ["create"].concat(OPS, ["rename", "images", "bleedfill", "thumbs", "defstyle", "styleset", "frame", "retext", "house_pages"], W3);
  var MAX_PICS = 400;
  var MAX_STEPS = 40;

  // What each command does, for the model (the automation guide's
  // words, a test checks that every op and field is named).
  var GUIDE = "Layout commands (documents are print layouts: books, magazines, brochures; styles and masters by name, e.g. Body text; pages by position, 1 = the first page; null or \"\" leaves a field as it is):\n" +
    OPS.map(function (op) { return op + ": " + SH.GUIDE.layout.ops[op]; }).join("\n") +
    "\nrename: the document's name becomes `title`" +
    "\ncreate: a new document (only as the first command, with designs new): title, w and h the trim in u mm|pt|in|px, n pages, facing (facing pages, default true), " +
    "side right|left (the side of the first page), mm the bleed on every side in mm, or bt bb bi bo for top, bottom, inside and outside (-1 = as mm), slug in mm, " +
    "margins t b i o in mm (-1 = 15), ncol columns, gut the gutter in mm, grid a baseline grid step in pt (0 = none), color rgb|cmyk, icc fogra39 (the print profile for cmyk), " +
    "starter novel|stories|poetry|essay|study|children|photo|cookbook|catalogue|magazine|workbook|zine (a starter book of that kind made for the trim: its styles, masters with page numbers and running heads, title, copyright and contents pages, a sample chapter or spread; n, facing and side are then the starter's; margins given still apply), pair noto|garamond|literata|alegreya|sans (its type: built-in Noto, EB Garamond + Fira Sans, Literata + Open Sans, Alegreya + Alegreya Sans, Fira Sans)" +
    "\nimages: one new page per picture, in order: paths (files on the orOS disk inside Claude's folders, as files_list shows them, or local:<root>/<path> in a local folder the owner opened for Claude) or folder (every picture in it), " +
    "sort natural (1_A, 2_a … 10, 27) | name | given (paths as listed), fit trim (the picture fills the trim) | bleed (it fills trim and bleed) | margins | proportional (whole picture, no crop), " +
    "at end | before | after page `page`, side any | right | left (a blank page goes first when the first picture would land on the other side); Layout copies the pictures into the document, the folder is never changed" +
    "\nbleedfill: the full-page pictures on `pages` that stop at the trim get a bleed: mode smart (the texture of paper, wood or cloth carried on) | mirror | stretch; the original picture is kept for undo" +
    "\nthumbs: page pictures (PNG, dpi 36-150) of `pages`, spreads true = facing pages side by side, saved under /internal/Layout/Proofs/ (read them with files_link when that folder is one of Claude's folders), out local:<root>/<folder> also saves them in a local write folder the owner opened, or out a folder of Claude's on the orOS disk (e.g. Drive/Books/Proofs; Files at «may change») saves them there too (with no out and exactly one write folder open, they also go to local:<that root>/Proofs, which Claude can look at); changes nothing" +
    "\ndefstyle: makes or changes a style by `name`: kind para (paragraph) | char (character), base the style it is based on, font a family as list_fonts shows it (serif, sans, mono, a family the document or the owner's fonts have, or any Fontsource family by name: Layout adds it to the document), " +
    "size, lead (leading) and track in pt (0 = as it is), align l|c|r|j, sb sa (space before, after) fi (first line indent) li ri (left, right indent) in pt (-1 = as it is), " +
    "bold ital caps under on|off, color #rrggbb, a nested style: nest_cs a character style for the start of each paragraph up to and including the first nest_to (e.g. \":\" for a speaker; nest_cs none removes it), " +
    "keep on = keep with the next paragraph, brk any|col|page|odd|even (start the paragraph there), hyph on|off" +
    "\nstyleset: set play makes the styles of a play (lang el|en names): Speaker (character), Cast list heading, Cast list, Act heading (new page), Scene heading, Dialogue (speaker up to \":\" nested), Stage direction, Song; changes no existing style" +
    "\nframe: a new text frame on page `page`: x y w h in mm from the page's top left (-1 = the margins), lines the paragraphs, one per entry (\"[Style name] text\" picks a paragraph style, " +
    "\"{Character style|words}\" a character style; style is the default paragraph style), ncol columns, gut the gutter in mm, ins the inset in mm, va t|m|b vertical alignment (top, middle, bottom), " +
    "fill #rrggbb, opacity 0-100, clear true = what is on the page goes first (for a picture of a text page retypeset as live text)" +
    "\nretext: the paragraphs of a story (story id, or the frame id of one of its frames, as the document's frames list shows) become `lines` (same marks as frame; style the default)" +
    "\nhouse_pages: the front and back pages of the house style document `house` (or the only one) are added before and after the book, scaled to its trim, their fields " +
    "({title} {subtitle} {author} {isbn} {year} {publisher}) filled from title subtitle author isbn year publisher or the Publishing app's title of that name; " +
    "where both|front|back|none, pad 0|2|4|8|16 adds blank pages before the back pages so the page count is a multiple of pad, keep_side true keeps the first page of the book on its side" +
    "\nsection: page `page` opens a section: start the number it gets (-1 = the count goes on), numstyle 1 | i | I (roman) | a | A (letters), prefix (up to 8 characters, e.g. A-); off true removes the section (page numbers and contents follow)" +
    "\nmovepages: the pages `pages` (e.g. 3-5,9) go, in their order, before page `before` (0 = to the end)" +
    "\nduppages: copies of the pages `pages` (with their own copy of the text) go after the last of them" +
    "\nmasterpages: the pages `pages` (all, odd, even or 3-10) get the master `master` by name (\"\" = none)" +
    "\ndefmaster: makes or changes a master by `name`: prefix 1-3 letters, base the master it is based on (its objects show under this one's; none = not based on any)" +
    "\npagesize: the pages `pages` get their own trim w × h in mm (a fold-out, a smaller insert; at least 13 mm); w 0 and h 0 = the document's size again; the PDF, the pictures and the editor follow" +
    "\nplacepage: the picture frame `frame` (an id from the frames list) gets page `page` (1 = the first) of the file `path` (a .pdf, .sla or .idml on the orOS disk inside Claude's folders, or local:<root>/<file>), drawn at 300 ppi and shown whole; read-back says page_of" +
    "\nframemod: the frames `frame` (ids as the document's frames list shows, comma-separated; text or picture) get x y (mm from the page's top left) w h (mm; -1 = as it is), " +
    "ncol columns (0 = as it is), gut the gutter and ins the inset in mm (-1 = as it is), va t|m|b, fill #rrggbb or nofill true, opacity 0-100 (-1 = as it is); del true removes them " +
    "(a story goes with its last frame; with other frames in its chain the text flows on in them); " +
    "wrap: text of other frames goes around it: none | box (its frame) | ell (an ellipse in the frame) | shape (its outline: a path's curve, a turned box) | alpha (a picture's opaque part, its transparent edges let the text in), wrap_mm the distance in mm (-1 = as it is); " +
    "anchor inline puts the first frame `frame` (a picture or shape) into the text of `anchor_in` (a text frame id or story id) at paragraph `anchor_para` (1 = the first), anchor_at start|end of it: it then sits on the line like a big letter and moves with the text; anchor off frees it where it is" +
    "\nmasterfield: on the master `master` (by name), kind pagenum = the page number | runhead = a running head with `text` ({title} = the document's name), " +
    "pos bc|bo|bi (bottom centre, outside, inside) | tc|to|ti (top), from_edge the distance from the trim edge in mm (-1 = 10), font and size (pt, 0 = 9) as defstyle; a second call changes it in place; " +
    "hide a page list (e.g. 1-6,23) keeps it off those pages of that master (front matter, picture pages), show puts it back there; remove true takes it off the master; lang el|en names its style" +
    "\ncolormode: the document's colour becomes color cmyk (for print; icc fogra39, Coated FOGRA39, the default) or rgb (screen); swatches keep their values, the print PDF converts pictures and RGB colours to the profile" +
    "\naddfont: a font family into the owner's font collection `collection` (default Claude; list_fonts then shows it) and this document's fonts, so defstyle font can use it: " +
    "source free = a Fontsource family by `family` (e.g. Carlito, as fontsource.org names it; its files are kept on the device for offline use), styles regular|bold|italic|bold italic (or 400, 700, 400i, 700i; default all it has); " +
    "source local = the font file `path` local:<root>/<file>.ttf|.otf in a local folder the owner opened (one file per command: add the bold and italic files too), kept in the owner's fonts" +
    "\nversion: keeps a named version `name` of the document as it is before the other commands (the owner compares and restores it in More › Versions; 30 per document, kept on their device); use it before large changes" +
    "\ntable: a table into the story `story` (or the frame `frame` of it): rows one entry per row, cells separated by | (\\n = a new line in a cell), header the first rows that repeat at the top of each new column or page (repeat false = not repeated), " +
    "after_para after that paragraph (1 = the first; 0 = at the end), replace n = the story's n-th table becomes this one, widths relative column widths (e.g. \"2 1 1\"), rule the rule width in pt (0 = none, -1 = 0.5), padding the cell padding in pt (-1 = 4), " +
    "rule_color and header_fill #rrggbb, style the paragraph style of the cells; rows never split, the owner merges cells in the Story Editor" +
    "\neffects: on the frames `frame` (ids, comma-separated): blend normal|multiply|screen|overlay|darken|lighten; a drop shadow shadow_x shadow_y (offset in pt, -144..144; -145 = as it is) shadow_blur (pt) shadow_opacity (%, 0 = no shadow) shadow_color #rrggbb (none = black); " +
    "an outer glow glow_blur glow_opacity (0 = none) glow_color; soft_edges in pt for pictures (0 = none); -1 or empty leaves a field as it is; the PDF and every export show them" +
    "\nsymbol: a reusable group of objects (a logo, a badge, a series emblem) by `name`: act make = the frames `frame` (ids, comma-separated, one page) become the symbol and its first placement; " +
    "place = a placement on page `page` at x y (mm from the page's top-left corner; -1 = centred) w wide (mm; -1 = its own size); update = the symbol becomes what its placement holding frame `frame` is now and every other placement follows; " +
    "detach = the placement holding `frame` becomes plain objects; rename to new_name; delete = the symbol goes, its placements stay as plain objects" +
    "\nindex: the book's index: terms one entry per word or phrase to mark wherever it stands in the text (any case or accents, whole words): \"word\", \"word = Topic\" or \"word = Topic / Sub-topic\"; " +
    "unmark a topic whose marks go (* = every mark); build true makes the index again from the marks (a new last page with two columns titled `title`, default Index, or its Greek word in a Greek book, when the book has none); pages as the pages show them" +
    "\ncancel: alone, stops the commands that keep Layout busy now (what they changed so far stays, with Undo; a run also stops by itself after 60 s without progress)" +
    "\npicture: picture frames by `frame` (ids as the document's frames list shows, comma-separated) or every picture on `pages`: flip none|h|v|hv (mirrored), corner the corner radius in mm (-1 = as it is), fit fit (whole picture) | fill (fills the frame) | frame (the frame takes the picture's proportions, same width); " +
    "colour corrections, kept apart from the file (numbers separated by spaces; empty = as it is; values that change nothing take that correction off; applied in this order): " +
    "levels \"black white gamma [out_black out_white]\" (0-255, gamma 0.1-9.99, e.g. \"12 240 1.1\"), curves \"shadows mids highlights\" (outputs at 64 128 192, e.g. \"56 132 200\"), " +
    "bc \"brightness contrast\" (-150..150, -100..100), balance \"red green blue\" midtones -100..100, hsl \"hue saturation lightness\" (-180..180, -100..100, -100..100), gray on|off (black and white), adjust none takes every correction off";

  // addfont styles → fonts.js variants
  var STYLE_OF = { regular: "r", "400": "r", bold: "b", "700": "b", italic: "i", "400i": "i", "400 italic": "i", "bold italic": "bi", "700i": "bi", "700 italic": "bi" };
  function fontVars(list) {
    var out = [];
    (list || []).forEach(function (v) { var k = STYLE_OF[String(v).toLowerCase().replace(/\s+/g, " ").trim()]; if (k && out.indexOf(k) < 0) out.push(k); });
    return out;
  }

  // ---------- 1. Checking ----------
  function given(v) { return v !== null && v !== undefined && v !== ""; }
  function wrap(op) { var c = {}; c[op] = CATALOG[op]; return c; }
  // One command → { step } or { err } (English, for the model).
  function checkStep(raw) {
    if (!raw || typeof raw !== "object" || typeof raw.op !== "string") return { err: "a command needs op" };
    var def = Object.prototype.hasOwnProperty.call(CATALOG, raw.op) ? CATALOG[raw.op] : null;
    if (!def) return { err: "unknown command " + JSON.stringify(String(raw.op).slice(0, 40)) + " (use " + ORDER.join(", ") + ")" };
    var bad = [];
    Object.keys(raw).forEach(function (k) {
      if (k === "op" || raw[k] === null || raw[k] === undefined) return;
      var spec = def.args[k];
      if (!spec) { bad.push(k + " is not a field of " + raw.op); return; }
      var v = R.arg(spec, raw[k]);
      if (v === undefined || (spec.t === "enum" && spec.v.indexOf(raw[k]) < 0) ||
          ((spec.t === "num" || spec.t === "int") && (raw[k] < spec.lo || raw[k] > spec.hi))) {
        bad.push(k + " " + JSON.stringify(raw[k]).slice(0, 60) + " is not allowed");
      }
    });
    Object.keys(def.args).forEach(function (k) { if (def.args[k].req && !given(raw[k])) bad.push(k + " is missing"); });
    if (typeof raw.pages === "string" && !S.pageTest(raw.pages)) bad.push("pages " + JSON.stringify(raw.pages) + " is not a page list");
    // an optional list left out is an empty list (recipes/core.js arg
    // refuses a missing list: images with a folder and no paths)
    var full = Object.assign({}, raw);
    Object.keys(def.args).forEach(function (k) { if (def.args[k].t === "list" && !def.args[k].req && !given(full[k])) full[k] = []; });
    var st = bad.length ? null : R.normStep(full, wrap(raw.op));
    if (!st) return { err: raw.op + ": " + (bad.join("; ") || "not valid") };
    return { step: st };
  }
  // A command list → { ok, steps } | { ok: false, err }
  function check(list) {
    if (!Array.isArray(list) || !list.length) return { ok: false, err: "steps is empty" };
    if (list.length > MAX_STEPS) return { ok: false, err: "at most " + MAX_STEPS + " commands" };
    var steps = [], errs = [];
    list.forEach(function (raw, i) {
      var r = checkStep(raw);
      if (r.err) errs.push("command " + (i + 1) + " " + r.err);
      else steps.push(r.step);
    });
    if (errs.length) return { ok: false, err: errs.slice(0, 6).join(". ") };
    if (steps.some(function (st, i) { return st.op === "create" && i > 0; })) return { ok: false, err: "create can only be the first command" };
    if (steps.length > 1 && steps.some(function (st) { return st.op === "cancel"; })) return { ok: false, err: "cancel goes alone" };
    if (steps.some(function (st) { return st.op === "masterfield" && ((st.hide && !S.pageTest(st.hide)) || (st.show && !S.pageTest(st.show))); })) return { ok: false, err: "masterfield: hide and show are page lists such as 1-6,23" };
    var bad = steps.filter(function (st) { return st.op === "images" && !(st.paths && st.paths.length) && !st.folder; });
    if (bad.length) return { ok: false, err: "images needs paths or folder" };
    if (steps.some(function (st) { return st.op === "images" && (st.paths || []).some(function (p) { return !/^local:/i.test(String(p).trim()) && !PRO.normPath(p); }); })) return { ok: false, err: "images: every path is a file on the orOS disk (/internal/… or as files_list shows it)" };
    if (steps.some(function (st) { return st.op === "placepage" && !/^local:/i.test(String(st.path).trim()) && !PRO.normPath(st.path); })) return { ok: false, err: "placepage: path is a file on the orOS disk (/internal/… or as files_list shows it) or local:<root>/<file>" };
    if (steps.some(function (st) { return st.op === "placepage" && !/\.(pdf|sla|sla\.gz|idml)$/i.test(String(st.path).trim()); })) return { ok: false, err: "placepage: path is a .pdf, .sla (or .sla.gz) or .idml file (an Affinity .af page: export it as a PDF first)" };
    if (steps.some(function (st) { return st.op === "retext" && !st.frame && !st.story; })) return { ok: false, err: "retext needs frame or story" };
    if (steps.some(function (st) { return st.op === "table" && !st.frame && !st.story; })) return { ok: false, err: "table needs frame or story" };
    if (steps.some(function (st) { return st.op === "addfont" && st.source === "free" && !st.family; })) return { ok: false, err: "addfont source free needs family (a Fontsource family name, e.g. Carlito)" };
    if (steps.some(function (st) { return st.op === "addfont" && st.source === "local" && !/^local:.+\.(ttf|otf|ttc|otc|woff2?)$/i.test(String(st.path || "").trim()); })) return { ok: false, err: "addfont source local needs path local:<root>/<file>.ttf (or .otf), a file in a local folder the owner opened for Claude" };
    if (steps.some(function (st) { return st.op === "addfont" && (st.styles || []).some(function (v) { return !STYLE_OF[String(v).toLowerCase().replace(/\s+/g, " ").trim()]; }); })) return { ok: false, err: "addfont styles: regular, bold, italic, bold italic (or 400, 700, 400i, 700i)" };
    return { ok: true, steps: steps };
  }

  // ---------- 2. Applying ----------
  function apply(doc, st, env) {
    env = env || {};
    var now = env.now || Date.now();
    if (!doc.tombs) doc.tombs = {};
    if (st.op === "rename") {
      if (doc.name === st.title) return 0;
      doc.name = st.title;
      doc.m = Math.max(now, (doc.m || 0) + 1);
      return 1;
    }
    if (st.op === "create" || st.op === "thumbs" || st.op === "cancel" || st.op === "version") return 0;
    if (st.op === "images") {
      // env.pics: the pictures Layout read and stored, in order
      if (!env.pics) return (st.paths && st.paths.length) || 1;
      var r = PRO.placePictures(doc, env.pics, st, now, env.idf);
      if (r.blank && env.notes && env.notes.indexOf("blankFirst") < 0) env.notes.push("blankFirst");
      return r.items.length;
    }
    if (st.op === "bleedfill") {
      var list = PRO.bleedTargets(doc, S.pageTest(st.pages));
      if (!env.fills) return list.length;
      var k = 0;
      list.forEach(function (it) { var f = env.fills[it.id]; if (f) k += PRO.applyFill(doc, it, f, now); });
      return k;
    }
    if (st.op === "defstyle") return PRO.defStyle(doc, st, now, env.idf, env);
    // addfont: Layout found the family before the run (env.font); the
    // document lists it, so its styles can use it
    if (st.op === "addfont") return env.font ? PRO.listFont(doc, env.font) : env.prepared ? 0 : 1;
    if (st.op === "styleset") return PRO.playStyles(doc, st.lang, now);
    if (st.op === "frame") return PRO.addFrame(doc, st, now, env.idf) ? 1 : 0;
    if (st.op === "retext") return PRO.setStory(doc, st, now);
    if (st.op === "table") return PRO.addTable(doc, st, now);
    if (st.op === "index") return applyIndex(doc, st, env, now);
    if (st.op === "symbol") return applySymbol(doc, st, env, now);
    if (st.op === "effects") {
      // shadow_x/y -145 = as it is (an offset can be below 0)
      var ef = Object.assign({}, st);
      if (ef.shadow_x <= -145) delete ef.shadow_x;
      if (ef.shadow_y <= -145) delete ef.shadow_y;
      return PRO.setEffects(doc, String(st.frame).split(/[\s,]+/).filter(Boolean).slice(0, 200), ef, now);
    }
    if (st.op === "house_pages") {
      var house = env.house || houseIn(env.docs, st.house, doc.id);
      if (!house) { if (env.notes && env.notes.indexOf("noHouse") < 0) env.notes.push("noHouse"); return 0; }
      var meta = Object.assign({}, env.meta || {});
      ["title", "subtitle", "author", "isbn", "year", "publisher"].forEach(function (k) { if (st[k]) meta[k] = st[k]; });
      if (!meta.title && doc.name) meta.title = doc.name;
      var hp = PRO.housePages(doc, house, meta, { where: st.where, pad: st.pad, keep: st.keep_side }, now, env.idf, env.fill || null);
      return hp.front + hp.back + hp.blank;
    }
    if (st.op === "section") return PRO.setSection(doc, st, now);
    if (st.op === "movepages") return PRO.movePages(doc, S.pageTest(st.pages), st.before, now);
    if (st.op === "duppages") return PRO.dupPages(doc, S.pageTest(st.pages), now, env.idf);
    if (st.op === "masterpages") {
      var msx = st.master ? PRO.styleNamed(doc.masters, st.master) : null;
      if (st.master && !msx) { if (env.notes && env.notes.indexOf("noMaster") < 0) env.notes.push("noMaster"); return 0; }
      return PRO.masterPages(doc, S.pageTest(st.pages), msx ? msx.id : "", now);
    }
    if (st.op === "defmaster") return PRO.defMaster(doc, st, now, env.idf);
    if (st.op === "picture") {
      var fids = st.frame ? String(st.frame).split(/[\s,]+/).filter(Boolean) : [];
      if (!fids.length && !st.pages) return 0;
      return PRO.setPicture(doc, fids, st.pages ? S.pageTest(st.pages) : null, { flip: st.flip, corner: st.corner >= 0 ? st.corner * PT_PER_MM : -1, fit: st.fit, adj: pictureAdj(st) }, now);
    }
    if (st.op === "masterfield") {
      var mfr = PRO.masterField(doc, Object.assign({}, st, { env: env }), now, env.idf, function (list) {
        if (!list) return [];
        var test = S.pageTest(list), out = [];
        M.pagesInOrder(doc).forEach(function (pg, i) { if (test(i + 1, M.pagesInOrder(doc).length)) out.push(i); });
        return out;
      });
      if (mfr < 0) { if (env.notes && env.notes.indexOf("noMaster") < 0) env.notes.push("noMaster"); return 0; }
      return mfr;
    }
    if (st.op === "colormode") {
      doc.setup.ext = doc.setup.ext || {};
      var cx = doc.setup.ext, cm = st.color === "cmyk" ? "cmyk" : "", ic = cm ? st.icc || "fogra39" : "";
      if ((cx.cm || "") === cm && (cx.icc || "") === ic) return 0;
      if (cm) { cx.cm = cm; cx.icc = ic; } else { delete cx.cm; delete cx.icc; }
      doc.m = Math.max(now, (doc.m || 0) + 1);
      return 1;
    }
    if (st.op === "placepage") {
      // env.page: the page Layout drew and stored (proassist.js)
      if (!env.page) return M.find(doc.items, String(st.frame)) ? 1 : 0;
      return PRO.setPage(doc, String(st.frame), env.page, now) ? 1 : 0;
    }
    if (st.op === "framemod") {
      var fmIds = String(st.frame).split(/[\s,]+/).filter(Boolean).slice(0, 200);
      var fmN = PRO.modFrame(doc, fmIds, st, now);
      if (!st.del && st.anchor === "inline" && fmIds.length) {
        var tfr = M.find(doc.items, String(st.anchor_in || "")), sidA = tfr && tfr.t === "text" ? tfr.story : String(st.anchor_in || "");
        if (M.story(doc, sidA) && PRO.anchorItem(doc, fmIds[0], sidA, (st.anchor_para || 1) - 1, st.anchor_at === "end" ? -1 : 0, now)) fmN++;
        else if (env.notes && env.notes.indexOf("noAnchor") < 0) env.notes.push("noAnchor");
      } else if (!st.del && st.anchor === "off") fmIds.forEach(function (id) { if (PRO.releaseItem(doc, id, now)) fmN++; });
      if (st.del || (!st.wrap && !(st.wrap_mm >= 0))) return fmN;
      var wst = { wo: st.wrap_mm >= 0 ? st.wrap_mm * PT_PER_MM : -1 };
      if (st.wrap === "none" || st.wrap === "ell") { wst.wrap = st.wrap; wst.wc = "box"; }
      else if (st.wrap) wst.wc = st.wrap;
      if (st.wrap === "box") wst.wrap = "box";
      return fmN + PRO.setWrap(doc, fmIds, wst, now);
    }
    if (st.op === "pagesize") return PRO.setPageSize(doc, S.pageTest(st.pages), (st.w || 0) * PT_PER_MM, (st.h || 0) * PT_PER_MM, now);
    if (!hasEngine()) {
      if (st.op === "fit") { if (env.notes && env.notes.indexOf("fitLater") < 0) env.notes.push("fitLater"); return 1; }
      if (st.op === "pages" && st.flow) st = Object.assign({}, st, { flow: 0 });
    }
    return S.apply(doc, st, now, { grey: env.grey || {} });
  }

  // index (LY-W13): marks, then the index story (made by Layout when
  // the text engine is not here: note "indexLater")
  function applyIndex(doc, st, env, now) {
    var IX = node ? require("./bookindex.js") : root.LY_INDEX;
    var terms = (st.terms || []).filter(function (x) { return String(x || "").trim(); });
    if (!IX) return terms.length + (st.unmark ? 1 : 0) + (st.build ? 1 : 0);
    var n = 0;
    if (st.unmark) n += IX.unmark(doc, st.unmark.trim() === "*" ? null : st.unmark, now);
    terms = terms.map(IX.parseTerm).filter(Boolean);
    if (terms.length) n += IX.markAll(doc, terms, now);
    if (!st.build) return n;
    if (!IX.idxStory(doc)) {
      var lang = doc.setup.ext && typeof doc.setup.ext.lang === "string" ? doc.setup.ext.lang : "el";
      if (!IX.place(doc, now, st.title || (/^el/.test(lang) ? "Ευρετήριο" : "Index"), env.idf)) return n; // i18n-inline-ok: the title written into the book, in the book's language
      n++;
    }
    if (!hasEngine()) { if (env.notes && env.notes.indexOf("indexLater") < 0) env.notes.push("indexLater"); return n + 1; }
    return n + (IX.update(doc, now) ? 1 : 0);
  }

  // symbol (LY-W14)
  function applySymbol(doc, st, env, now) {
    var SY = node ? require("./symbols.js") : root.LY_SYM;
    if (!SY) return 0;
    var ids = String(st.frame || "").split(/[\s,]+/).filter(Boolean).slice(0, 200);
    if (st.act === "make") { var r = SY.make(doc, ids, st.name, now, env.idf); return r.err ? 0 : r.it.length; }
    if (st.act === "update") return ids.length ? Math.max(0, SY.redefine(doc, ids[0], now, env.idf)) : 0;
    if (st.act === "detach") return ids.length ? SY.detach(doc, ids[0], now) : 0;
    if (st.act === "rename") return SY.rename(doc, st.name, st.new_name, now);
    if (st.act === "delete") return SY.remove(doc, st.name, now);
    var sym = SY.find(doc, st.name), pg = M.pagesInOrder(doc)[(st.page || 1) - 1];
    if (!sym || !pg) return 0;
    var s = M.pageSize(doc, pg), MM = 72 / 25.4, w = st.w > 0 ? st.w * MM : sym.w, h = sym.h * w / sym.w;
    var x = st.x >= 0 ? st.x * MM : (s.w - w) / 2, y = st.y >= 0 ? st.y * MM : (s.h - h) / 2;
    return SY.place(doc, sym.id, pg.id, x, y, now, env.idf, w).length;
  }

  // A house style document (LY-HS: setup.ext.house) by name, or the
  // only one; never the book itself.
  function isHouse(d) { var h = d && d.setup && d.setup.ext && d.setup.ext.house; return !!(h && typeof h === "object" && Array.isArray(h.rules)); }
  function houseIn(docs, name, self) {
    var hs = (docs || []).filter(function (d) { return d && d.id !== self && !d.del && isHouse(d) && !M.needsNewer(d); });
    if (!name) return hs.length === 1 ? hs[0] : null;
    var q = norm(name);
    return hs.filter(function (d) { return norm(d.name) === q; })[0] || hs.filter(function (d) { return norm(d.name).indexOf(q) >= 0; })[0] || null;
  }

  // ---------- 3. For the Assistant ----------
  function norm(s) { return String(s || "").toLowerCase().replace(/\s+/g, " ").trim(); }
  function docsOf(data) {
    return (data && Array.isArray(data.docs) ? data.docs : []).filter(function (d) { return d && d.id && !M.needsNewer(d); });
  }
  // Which documents a request is for. data: the stored Layout data,
  // folders: none in Layout, open: the open (or last opened) document's
  // id. designs: open | named | all; name: the document's name.
  function targets(data, folders, open, designs, name) {
    if (designs === "new") return { ok: true, docs: [{ id: "", name: String(name || "") }], fresh: 1 };
    var docs = docsOf(data);
    if (!docs.length) return { ok: false, err: "the user has no documents in Layout yet" };
    var list = [];
    if (designs === "all") list = docs.slice();
    else if (designs === "folder") return { ok: false, err: "Layout has no folders; use designs named or all" };
    else if (designs === "named") {
      var q = norm(name);
      if (!q) return { ok: false, err: "give the document's name" };
      list = docs.filter(function (d) { return norm(d.name) === q; });
      if (!list.length) list = docs.filter(function (d) { return norm(d.name).indexOf(q) >= 0; });
      if (!list.length) return { ok: false, err: "no document is called " + JSON.stringify(String(name).slice(0, 80)) + "; documents: " + docs.slice(0, 30).map(function (d) { return JSON.stringify(d.name || "Untitled"); }).join(", ") };
      if (list.length > 1 && !docs.some(function (d) { return norm(d.name) === q; })) {
        return { ok: false, err: "several documents match " + JSON.stringify(String(name).slice(0, 80)) + ": " + list.slice(0, 20).map(function (d) { return JSON.stringify(d.name); }).join(", ") + "; give the whole name" };
      }
    } else {
      var o = null;
      docs.forEach(function (d) { if (d.id === open) o = d; });
      if (!o) return { ok: false, err: "no document is open in Layout; name the document (designs: named)" };
      list = [o];
    }
    return { ok: true, docs: list.map(function (d) { return { id: d.id, name: d.name || "" }; }) };
  }
  // What a list of commands would change, on copies: { n, d, per[{id,
  // name, n}], cut: 0, notes[] }. Black and white counts the pictures
  // it would change (their copies are made when Layout applies it).
  function preview(data, ids, steps) {
    var docs = docsOf(data), out = { n: 0, d: 0, per: [], cut: 0, made: 0, files: 0, notes: [] };
    // cancel changes no document: it stops the run that holds Layout
    if (steps.length && steps[0].op === "cancel") { out.ctl = 1; return out; }
    if (steps.length && steps[0].op === "create") {
      var nd = PRO.makeDoc(steps[0], 1), k0 = 0;
      out.made = 1;
      steps.slice(1).forEach(function (st) { if (st.op === "thumbs") out.files++; else k0 += apply(nd, st, { now: 1, notes: out.notes, grey: {}, docs: docs }); });
      out.n = k0;
      out.per.push({ id: "", name: steps[0].title || "", n: k0 });
      return out;
    }
    ids.forEach(function (id) {
      var src = null;
      docs.forEach(function (d) { if (d.id === id) src = d; });
      if (!src) return;
      var w = JSON.parse(JSON.stringify(src)), k = 0, grey = {};
      steps.forEach(function (st) {
        if (st.op === "grey") S.greyAssets(w, st).forEach(function (a) { grey[a] = a + "~"; });
        if (st.op === "thumbs") { out.files++; return; }
        if (st.op === "version") { if (out.notes.length < 40) out.notes.push("version saved first: " + st.name); return; }
        k += apply(w, st, { now: 1, notes: out.notes, grey: grey, docs: docs });
      });
      out.n += k;
      if (k) out.d++;
      out.per.push({ id: id, name: src.name || "", n: k });
    });
    return out;
  }
  // A document for the AI: size, margins, numbering, its styles and
  // masters by name, and per page the master and the start of each
  // text and the pictures, without file data.
  var OUT_PAGES = 400, OUT_TEXT = 160;
  var PT_MM = 25.4 / 72, PT_PER_MM = 72 / 25.4;
  function mm(v) { return Math.round((v || 0) * PT_MM * 10) / 10; }
  function nameOf(n) { return n && typeof n === "object" ? n.en || n.el || n[Object.keys(n)[0]] || "" : String(n || ""); }
  function textOf(st) {
    return (st && st.paras || []).map(function (p) {
      var tb = p.ext && p.ext.tbl;
      if (tb && Array.isArray(tb.rows)) return "[table " + tb.rows.length + "×" + (Array.isArray(tb.cols) ? tb.cols.length : 0) + "]";
      return (p.runs || []).map(function (r) { return typeof r.t === "string" ? r.t : ""; }).join("");
    }).join(" ").replace(/\s+/g, " ").trim();
  }
  function outline(doc, L, opts) {
    var u = doc.setup || {}, order = M.pagesInOrder(doc), used = {}, msName = {};
    (doc.stories || []).forEach(function (s) { (s.paras || []).forEach(function (p) { var k = p.ps || "ps-base"; used[k] = (used[k] || 0) + 1; }); });
    (doc.masters || []).forEach(function (m) { msName[m.id] = nameOf(m.name) || m.id; });
    var o = {
      name: doc.name || "", size_mm: mm(u.w) + " × " + mm(u.h), pages: order.length, facing: !!u.facing,
      margins_mm: { t: mm(u.mt), b: mm(u.mb), i: mm(u.mi), o: mm(u.mo) }, bleed_mm: mm(u.bleed), first_page_number: M.firstNumber(doc),
      paragraph_styles: (doc.pstyles || []).map(function (s) {
        var e = { name: nameOf(s.name) || s.id, paragraphs: used[s.id] || 0 };
        if (s.size) e.size = s.size;
        if (s.font) e.font = s.font;
        if (s.align) e.align = s.align;
        return e;
      }),
      masters: (doc.masters || []).map(function (m) { return msName[m.id]; }),
      page_list: []
    };
    var seen = {};
    order.slice(0, OUT_PAGES).forEach(function (pg, i) {
      var e = { page: i + 1 };
      if (pg.ms) e.master = msName[pg.ms] || "";
      var texts = [], pics = 0;
      (doc.items || []).filter(function (it) { return it.pg === pg.id; }).forEach(function (it) {
        if (it.t === "img") { pics++; return; }
        if (it.t !== "text" || seen[it.story]) return;
        seen[it.story] = 1;
        var tx = textOf(M.find(doc.stories || [], it.story));
        if (tx) texts.push(tx.length > OUT_TEXT ? tx.slice(0, OUT_TEXT) + "…" : tx);
      });
      if (texts.length) e.text_starts = texts.slice(0, 6);
      if (pics) e.pictures = pics;
      o.page_list.push(e);
    });
    if (order.length > OUT_PAGES) o.note = "Only the first " + OUT_PAGES + " pages are listed.";
    // LY-PRO W1 (item 37): every frame, story, style, swatch and the
    // page sides; L (the text layout) and opts (preflight, fonts, the
    // last export) when Layout itself answers
    var full = PRO.outline(doc, L || null, opts || {});
    Object.keys(full).forEach(function (k) {
      if (k === "page_list") full.page_list.forEach(function (e, i) { if (o.page_list[i]) o.page_list[i] = Object.assign(e, o.page_list[i]); });
      else if (k === "paragraph_styles") full.paragraph_styles.forEach(function (e, i) { if (o.paragraph_styles[i]) o.paragraph_styles[i] = Object.assign(e, o.paragraph_styles[i]); });
      else if (!(k in o)) o[k] = full[k];
    });
    return o;
  }

  var api = { houseIn: houseIn, fontVars: fontVars, CATALOG: CATALOG, ORDER: ORDER, GUIDE: GUIDE, MAX_STEPS: MAX_STEPS, check: check, apply: apply, targets: targets, preview: preview, outline: outline };
  if (node) module.exports = api;
  else root.LayoutCommands = api;
})(typeof window !== "undefined" ? window : this);
