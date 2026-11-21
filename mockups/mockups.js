// ============================================================
// orOS Mockups — App logic (v1.4.0)
// 3D book mockups: give the book's size, pages, paper and binding
// (paperback or hardcover, flaps / dust jacket, rounded spine,
// headband, ribbon), add the cover (front, back, spine, flaps or one
// full wrap), turn the camera, set placement, background and light,
// and save the picture (PNG / JPG / WebP, to the device, to
// Pictures, or into a new Atelier design). Wave 2: sets of books
// (front + back pair, series, shelf of spines, stack), free
// background photos (Openverse, Wikimedia Commons through
// designkit/media.js), every ready angle at once (ZIP or Pictures),
// and a turntable as MP4 / WebM (vendored Mediabunny) or GIF
// (atelier/gif.js); both libraries load only when asked for.
// Wave 3: the Print tab, the cover sheet for the printer
// (MockCore.template drawn by print.js: live flat preview, 300 dpi
// PNG / PDF with or without the guides, Pictures, a new Atelier
// design of the right size, BR-MK-TPL). Wave 4: what to show, the
// closed book, the open book (inside pages from pictures or a PDF
// through the vendored PDF.js, page curve) or the e-book on a
// tablet, phone or e-reader. v2 wave 3: products other than books
// ("What do you want to make?"): CD and DVD / Blu-ray (goods/media.js,
// goods/media3d.js), kept in their own synced slice "mockups-goods"
// (oros-mockups-goods), with their printer's sheets on the Print tab.
// Data: synced slice "mockups" (oros-mockups-data, core.js);
// pictures on the orOS disk through designkit/assets.js (R30);
// project thumbnails cached on this device only (IndexedDB
// "oros-mockups-thumbs", never synced, rebuilt when missing).
// The 3D part (scene.js + vendor/three) is imported when the editor
// opens.
// Sections:
//   1. Constants, i18n, helpers
//   2. State + storage
//   3. Thumbnails (IndexedDB) + home
//   4. Stage (3D view), pictures, camera drag
//   5. The form (book, cover, scene, save)
//   5b. Inside pages and the e-book screen
//   6. Save the picture, Pictures, Atelier, all angles, turntable
//   6b. Cover sheet for the printer (Print tab)
//   7. Dialogs: more, ask
//   8. Sync slice, palette, deep link
//   9. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var C = window.MockCore;

  // ---------- 1. Constants, i18n, helpers ----------
  // orosI18n (../i18n.js): the full language code, a pack language included.
  function appLang() {
    if (window.orosI18n) return window.orosI18n.lang();
    try {
      var l = localStorage.getItem("oros-lang") || (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  var LANG = appLang();
  var LANG2 = LANG === "el" ? "el" : "en"; // for shared modules that know only el / en
  function loc() { return window.orosI18n ? window.orosI18n.locale(LANG) : (LANG === "el" ? "el-GR" : "en-GB"); }
  var DEC_COMMA = (function () { try { return (1.5).toLocaleString(loc()).indexOf(",") >= 0; } catch (e) { return LANG === "el"; } })();

  var STRINGS = {
    en: {
      "app.name": "Mockups", "btn.new": "New mockup", "btn.more": "More", "btn.back": "All mockups",
      "empty": "No mockup yet. Make a 3D picture of your book, notebook, CD or DVD: give its size, add its pictures, pick the angle and the background, and save it.",
      "btn.first": "Make a mockup",
      "tab.book": "Book", "tab.cover": "Cover", "tab.scene": "Scene", "tab.out": "Save",
      "f.bind": "Binding", "bind.pb": "Paperback", "bind.hc": "Hardcover",
      "edge.print": "Printed (a picture)", "slot.edgeP": "Picture on the page edges",
      "sec.finish": "Finishes", "f.tex": "Cover material", "tex.paper": "Printed paper", "tex.linen": "Linen", "tex.cloth": "Book cloth",
      "tex.leather": "Leather", "tex.kraft": "Kraft paper", "f.corners": "Rounded corners", "f.deckle": "Deckled page edges (rough, uncut)",
      "f.belly": "Belly band", "f.bellyH": "Band height", "slot.belly": "Belly band picture", "aria.bellyC": "Belly band colour",
      "f.slip": "Slipcase", "slot.slip": "Slipcase picture (also the box of a box set)", "aria.slipC": "Slipcase colour",
      "f.elastic": "Elastic band (notebook)", "aria.elasticC": "Elastic band colour", "btn.notebook": "Make it a notebook",
      "toast.notebook": "A5 hardcover notebook: rounded corners, ribbon, elastic band and lined pages.",
      "sec.fx": "Foil, spot UV and embossing",
      "fx.hint": "Choose a picture for each effect: its white (or its drawn, not see-through) parts get the effect, laid on the front cover like the front picture. Make one in Atelier from your cover's title or logo.",
      "slot.foil": "Foil", "slot.uv": "Spot UV (gloss)", "slot.emb": "Embossing", "f.foilK": "Foil", "foil.gold": "Gold", "foil.silver": "Silver",
      "foil.copper": "Copper", "foil.rose": "Rose gold", "foil.holo": "Holographic", "f.embK": "Embossing", "emb.emboss": "Raised (emboss)", "emb.deboss": "Pressed in (deboss)",
      "f.stick": "Sticker on the cover", "slot.stick": "Sticker picture", "stick.round": "Round", "stick.square": "Square", "aria.stickK": "Sticker shape",
      "f.stickD": "Size", "f.stickX": "Left / right", "f.stickY": "Up / down",
      "f.rule": "Empty pages", "rule.none": "Plain", "rule.lined": "Lined", "rule.dotted": "Dotted", "rule.grid": "Squared", "set.box": "Box set",
      "tpack.norelco": "Clear case",
      "tpack.ocard": "O-card",
      "tpack.none": "Tape only",
      "f.shell": "Shell",
      "col.smoke": "Smoke",
      "col.red": "Red",
      "col.marble": "Marbled",
      "f.jp": "J-card",
      "jp.3": "3 panels",
      "jp.4": "4 panels",
      "jp.5": "5 panels",
      "vpack.slip": "Card sleeve",
      "vpack.clam": "Clamshell",
      "f.rsize": "Record",
      "rsize.lp": "12″ LP",
      "rsize.7in": "7″ single",
      "f.vjk": "Jacket",
      "vjk.single": "Single",
      "vjk.gatefold": "Gatefold",
      "f.inner": "Inner sleeve",
      "inner.printed": "Printed",
      "f.rc": "Colour of the record",
      "f.big": "Big hole (jukebox)",
      "f.beside.cd": "The disc next to the case",
      "f.beside.dvd": "The disc next to the case",
      "f.beside.tape": "The tape next to the case",
      "f.beside.vhs": "The tape next to the sleeve",
      "f.beside.vinyl": "The record next to the jacket",
      "f.openSlide.cd": "Slide the disc out",
      "f.openSlide.tape": "Slide the case out",
      "f.openSlide.vhs": "Slide the tape out",
      "f.openSlide.vinyl": "Slide the record out",
      "sub.tape": "Cassette · {pack}",
      "sub.vhs": "VHS · {pack}",
      "sub.vinyl": "{size} · {jk}",
      "kind.tape": "Cassette",
      "kind.tape.d": "Tape in a clear case with its J-card, in an O-card or on its own",
      "kind.vhs": "VHS",
      "kind.vhs.d": "Tape in a card sleeve or a clamshell case, with its labels",
      "kind.vinyl": "Vinyl",
      "kind.vinyl.d": "12″ LP or 7″ single: jacket, inner sleeve and the record",
      "untitled.tape": "Cassette mockup",
      "untitled.vhs": "VHS mockup",
      "untitled.vinyl": "Vinyl mockup",
      "make.g.home": "Home & paper",
      "kind.mug": "Mug",
      "kind.mug.d": "11 or 15 oz ceramic mug with the print round it; inside and handle colours",
      "kind.poster": "Framed poster",
      "kind.poster.d": "A4 to A1 and photo sizes, in a frame with a mat and glass, on a wall",
      "kind.card": "Postcard or card",
      "kind.card.d": "Flat postcard or folded greeting card that opens, with an envelope",
      "untitled.mug": "Mug mockup",
      "untitled.poster": "Poster mockup",
      "untitled.card": "Card mockup",
      "pics.hint.mug": "One picture goes round the mug: its middle is opposite the handle, its ends meet under the handle.",
      "pics.hint.poster": "The poster at its real size; a frame or a mat hides a few millimetres of its edge.",
      "pics.hint.card": "The front and the back; a folded card also has its two inside pages.",
      "slot.mug.wrap": "Print round the mug",
      "slot.poster.front": "Poster",
      "slot.card.front": "Front",
      "slot.card.back": "Back",
      "slot.card.inside": "Inside, left",
      "slot.card.inside2": "Inside, right",
      "slot.inside2": "Inside, right",
      "f.oz": "Size",
      "oz.11": "11 oz",
      "oz.15": "15 oz",
      "f.minner": "Inside",
      "f.mhandle": "Handle",
      "col.yellow": "Yellow",
      "col.green": "Green",
      "f.orient": "Orientation",
      "orient.portrait": "Portrait",
      "orient.landscape": "Landscape",
      "psize.a4": "A4 (210 × 297 mm)",
      "psize.a3": "A3 (297 × 420 mm)",
      "psize.a2": "A2 (420 × 594 mm)",
      "psize.a1": "A1 (594 × 841 mm)",
      "psize.30x40": "30 × 40 cm",
      "psize.50x70": "50 × 70 cm",
      "psize.61x91": "61 × 91 cm (24 × 36″)",
      "f.frame": "Frame",
      "frame.black": "Black",
      "frame.white": "White",
      "frame.oak": "Oak",
      "frame.walnut": "Walnut",
      "frame.alu": "Aluminium",
      "frame.none": "No frame",
      "f.pmat": "Mat (passe-partout)",
      "f.wall": "Wall",
      "wall.none": "None",
      "wall.light": "Light",
      "wall.dark": "Dark",
      "f.ck": "Card",
      "ck.flat": "Flat postcard",
      "ck.folded": "Folded card",
      "csize.a6": "A6",
      "csize.a5": "A5",
      "csize.dl": "DL",
      "csize.sq": "Square",
      "f.env": "Envelope",
      "env.none": "None",
      "env.white": "White",
      "env.kraft": "Kraft",
      "env.black": "Black",
      "f.openCard": "Open the card",
      "tpl.kind.mugwrap": "Mug wrap",
      "tpl.kind.poster": "Poster",
      "tpl.kind.pcfront": "Postcard, front",
      "tpl.kind.pcback": "Postcard, back",
      "tpl.kind.gcout": "Card, outside",
      "tpl.kind.gcin": "Card, inside",
      "tpl.goodNote.mugwrap": "The middle of the sheet faces away from the handle; the ends meet under it.",
      "tpl.goodNote.poster": "A frame or a mat hides about 4 to 5 mm round the edge: keep text inside the safe zone.",
      "tpl.goodNote.gcout": "Left the back, right the front; the fold is in the middle.",
      "tpl.goodNote.gcin": "The two inside pages; the fold is in the middle.",
      "make.g.wear": "Clothes & bags",
      "kind.tshirt": "T-shirt",
      "kind.tshirt.d": "Laid flat in seven colours, with a front or chest print and a back print",
      "kind.tote": "Tote bag",
      "kind.tote.d": "Cotton canvas bag with long or short handles, printed on one or both sides",
      "untitled.tshirt": "T-shirt mockup",
      "untitled.tote": "Tote bag mockup",
      "pics.hint.tshirt": "Only what the picture has is printed, so a picture with a clear background (PNG) prints best. It fits whole inside the print area, from its top.",
      "pics.hint.tote": "Only what the picture has is printed, so a picture with a clear background (PNG) prints best. It fits whole inside the print area, from its top.",
      "slot.tshirt.front": "Front print",
      "slot.tshirt.back": "Back print",
      "slot.tote.front": "Front print",
      "slot.tote.back": "Back print",
      "f.ccol": "Colour",
      "col.heather": "Heather grey",
      "col.navy": "Navy",
      "col.forest": "Forest green",
      "col.sand": "Sand",
      "col.natural": "Natural",
      "f.area": "Print area",
      "area.front": "Front",
      "area.chest": "Left chest",
      "f.backPrint": "Print on the back too",
      "f.handles": "Handles",
      "handles.long": "Long (shoulder)",
      "handles.short": "Short (hand)",
      "tpl.kind.teefront": "T-shirt, front",
      "tpl.kind.teeback": "T-shirt, back",
      "tpl.kind.totefront": "Tote bag, front",
      "tpl.kind.toteback": "Tote bag, back",
      "tpl.goodNote.teefront": "Garment print: send a PNG with a clear background at this size; nothing is printed where it is clear. No bleed.",
      "tpl.goodNote.teeback": "Garment print: send a PNG with a clear background at this size; nothing is printed where it is clear. No bleed.",
      "tpl.goodNote.totefront": "Bag print: send a PNG with a clear background at this size; nothing is printed where it is clear. No bleed.",
      "tpl.goodNote.toteback": "Bag print: send a PNG with a clear background at this size; nothing is printed where it is clear. No bleed.",
      "model.get": "Download the 3D model ({size})",
      "model.need": "The 3D model comes from orOS's own model library (koulaxizis.github.io), only if you ask, once; then it stays on this device and works offline. Until then a flat stand-in shows the print.",
      "model.busy": "Downloading the model…",
      "model.ready": "The 3D model is on this device.",
      "model.remove": "Remove the model from this device",
      "model.err.net": "The model could not be downloaded. Check the connection and try again.",
      "model.err.hash": "The downloaded file was not the expected model, so it was not kept. Try again later.",
      "f.surf": "Surface",
      "surf.none": "None (only the shadow)",
      "surf.wood": "Wood",
      "surf.marble": "Marble",
      "surf.linen": "Linen",
      "surf.paper": "Paper",
      "surf.concrete": "Concrete",
      "f.props": "Things beside it",
      "prop.cup": "Coffee cup",
      "prop.plant": "Plant",
      "prop.pencil": "Pencil",
      "kind.hoodie": "Hoodie",
      "kind.hoodie.d": "Laid flat with its hood and pocket, printed on the front or chest and the back",
      "untitled.hoodie": "Hoodie mockup",
      "pics.hint.hoodie": "Only what the picture has is printed, so a picture with a clear background (PNG) prints best. It fits whole inside the print area, from its top.",
      "slot.hoodie.front": "Front print",
      "slot.hoodie.back": "Back print",
      "tpl.kind.hoodfront": "Hoodie, front",
      "tpl.kind.hoodback": "Hoodie, back",
      "tpl.goodNote.hoodfront": "Garment print: send a PNG with a clear background at this size; nothing is printed where it is clear. No bleed. The front area sits above the pocket.",
      "tpl.goodNote.hoodback": "Garment print: send a PNG with a clear background at this size; nothing is printed where it is clear. No bleed.",
      "kind.socks": "Socks",
      "kind.socks.d": "A pair laid flat in white, black or heather grey, the same picture on both legs",
      "untitled.socks": "Socks mockup",
      "pics.hint.socks": "The same picture goes on the front of both legs, from the cuff down. A picture with a clear background shows the sock's colour round it.",
      "slot.socks.front": "Print on the legs",
      "tpl.kind.sockleg": "Sock leg",
      "tpl.goodNote.sockleg": "One leg's front at its real size, used for both socks. Sock printers often print all round: ask yours for its full template.",
      "kind.cap": "Cap",
      "kind.cap.d": "Dad cap or trucker cap, with a printed or embroidered front panel",
      "untitled.cap": "Cap mockup",
      "pics.hint.cap": "The front panel above the brim. Embroidery shows bold shapes and few colours best; thin lines and small text get lost.",
      "slot.cap.front": "Front panel",
      "tpl.kind.capfront": "Cap, front panel",
      "tpl.goodNote.capfront": "The front panel at its real size, no bleed. For embroidery send bold shapes with a few flat colours; the maker turns it into stitches.",
      "f.capStyle": "Style",
      "cap.dad": "Dad cap",
      "cap.trucker": "Trucker",
      "f.wfront": "White front panels",
      "f.capFin": "Front",
      "capfin.print": "Printed",
      "capfin.embroidery": "Embroidered",
      "make.g.merch": "Merch & small things",
      "kind.badge": "Badge",
      "kind.badge.d": "Pin-back button, 25 to 75 mm, gloss or matte, with a pin or a magnet",
      "kind.sticker": "Sticker",
      "kind.sticker.d": "Cut to the picture's outline, round or square; matte, gloss, holographic or clear",
      "kind.keychain": "Keychain",
      "kind.keychain.d": "Acrylic, metal or rubber, with its ring; printed on one or both sides",
      "kind.pin": "Enamel pin",
      "kind.pin.d": "Metal with enamel colours, hard or soft enamel, on a backing card if you like",
      "kind.magnet": "Magnet",
      "kind.magnet.d": "Fridge magnet: rectangle, round or cut to the picture",
      "untitled.badge": "Badge mockup",
      "untitled.sticker": "Sticker mockup",
      "untitled.keychain": "Keychain mockup",
      "untitled.pin": "Pin mockup",
      "untitled.magnet": "Magnet mockup",
      "pics.hint.badge": "The picture covers the whole circle: the middle is the face, the outer ring wraps round the edge.",
      "pics.hint.sticker": "For a cut to the shape use a picture with a see-through background (PNG): the cut follows its outline.",
      "pics.hint.keychain": "For a cut to the shape use a PNG with a see-through background; the back side keeps the same outline.",
      "pics.hint.pin": "Use a picture with a see-through background and a few flat colours; the pin shows it as enamel with metal lines.",
      "pics.hint.magnet": "The picture fills the magnet; for a cut to the shape use a PNG with a see-through background.",
      "slot.badge.front": "Badge picture",
      "slot.sticker.front": "Sticker picture",
      "slot.keychain.front": "Front side",
      "slot.keychain.back": "Back side",
      "slot.pin.front": "Pin design",
      "slot.pin.back": "Backing card",
      "slot.magnet.front": "Magnet picture",
      "f.gsize": "Size",
      "fin.holo": "Holographic",
      "fin.clear": "Clear",
      "f.shape": "Shape",
      "shape.die": "Cut to the picture",
      "shape.round": "Round",
      "shape.square": "Square",
      "shape.rounded": "Rounded corners",
      "shape.rect": "Rectangle",
      "f.wedge": "White edge",
      "f.bback": "Back",
      "bback.pin": "Pin",
      "bback.magnet": "Magnet",
      "f.kmat": "Material",
      "kmat.acrylic": "Acrylic",
      "kmat.metal": "Metal",
      "kmat.rubber": "Rubber",
      "f.ring": "Ring",
      "f.metal": "Metal",
      "metal.silver": "Silver",
      "metal.gold": "Gold",
      "metal.black": "Black",
      "metal.rose": "Rose gold",
      "metal.copper": "Copper",
      "f.two": "Printed on both sides",
      "f.enamel": "Enamel",
      "enamel.hard": "Hard (smooth, glossy)",
      "enamel.soft": "Soft (metal lines raised)",
      "f.card": "On a backing card",
      "f.beside.badge": "The back of the badge next to it",
      "f.beside.pin": "The back of the pin next to it",
      "good.size2": "Size: {w} × {h}.",
      "tpl.kind.badge": "Badge (round, cut)",
      "tpl.kind.sticker": "Sticker",
      "tpl.kind.kfront": "Keychain, front",
      "tpl.kind.kback": "Keychain, back",
      "tpl.kind.pin": "Pin artwork",
      "tpl.kind.pcard": "Backing card",
      "tpl.kind.magnet": "Magnet",
      "tpl.badgeInfo": "Cut a circle of {cut}; the face is {d}, the ring between wraps round the edge and under it.",
      "tpl.inkInfo": "Print area {w} × {h}, no bleed: the print shop places it on the garment.",
      "tpl.cutInfo": "Sheet {w} × {h} with the bleed, cut {tw} × {th}. The cut line is in the PDF as a thin magenta line.",
      "tpl.goodNote.badge": "Keep text inside the dashed ring: the outer ring goes round the edge and behind.",
      "tpl.goodNote.sticker": "The cut follows the outline; keep text out of the green band inside it.",
      "tpl.goodNote.kfront": "The hole sits at the top in the middle; keep the picture clear of it.",
      "tpl.goodNote.pin": "Send this as the artwork: the maker turns it into metal lines and enamel colours. Few flat colours and lines of at least 0.3 mm work best.",
      "tpl.goodNote.magnet": "Keep text out of the green band by the edge.",
      "lg.badgeCut": "Circle to cut",
      "lg.badgeFace": "Edge of the face",
      "lg.cutAway": "Cut away",
      "lg.cutLine": "Cut line",
      "warn.dieOpaque": "The picture has no see-through background, so the cut is a rectangle round it.",
      "warn.dieParts": "Parts of the picture stand apart: the cut follows the biggest one. Join them or grow the white edge.",
      "warn.dieNoPic": "Add a picture: the cut follows its outline.",
      "pics.hint.tape": "The J-card (or O-card) parts, and the two labels on the tape: side A in front, side B behind.",
      "pics.hint.vhs": "The sleeve's front, back and spine, the face label of the tape; the spine picture also goes on the tape's spine label.",
      "pics.hint.vinyl": "The jacket's front, back and spine (or one full wrap), the two record labels (round, the hole is cut out) and a printed inner sleeve.",
      "slot.sideA": "Label, side A",
      "slot.sideB": "Label, side B",
      "slot.flap": "Back flap",
      "slot.in1": "Inside panel",
      "slot.in2": "Second inside panel",
      "slot.side": "Other side",
      "slot.glue": "Glue flap",
      "slot.face": "Face label",
      "slot.tspine": "Spine label",
      "slot.labelA": "Label, side A",
      "slot.labelB": "Label, side B",
      "slot.innerF": "Inner sleeve, front",
      "slot.innerB": "Inner sleeve, back",
      "slot.tape.back": "Back flap of the J-card",
      "slot.tape.inside": "Inside panels of the J-card",
      "slot.vhs.spine": "Spine (sleeve and tape label)",
      "slot.vinyl.front": "Front of the jacket",
      "slot.vinyl.back": "Back of the jacket",
      "slot.vinyl.spine": "Spine of the jacket",
      "slot.vinyl.wrap": "Full jacket (printer's sheet)",
      "tpl.kind.jcard": "J-card",
      "tpl.kind.tlabel": "Cassette labels (A and B)",
      "tpl.kind.ocard": "O-card sleeve",
      "tpl.kind.vface": "VHS face label",
      "tpl.kind.vspine": "VHS spine label",
      "tpl.kind.vclam": "Clamshell sleeve",
      "tpl.kind.vslip": "VHS card sleeve",
      "tpl.kind.jacket": "Record jacket",
      "tpl.kind.gatefold": "Gatefold jacket (outside)",
      "tpl.kind.inner": "Printed inner sleeve",
      "tpl.kind.labelA": "Record label, side A",
      "tpl.kind.labelB": "Record label, side B",
      "tpl.goodNote.jcard": "Front, spine, then the flap that folds behind the tape; more panels fold out inside.",
      "tpl.goodNote.tlabel": "Side A and side B, each 89 × 51 mm; leave the middle clear, the window of the shell sits there.",
      "tpl.goodNote.vslip": "Back, spine, front, the other side and the glue flap; the end flaps come from the printer's cutting line.",
      "tpl.goodNote.jacket": "Back, spine and front; the glue flaps come from the pressing plant's own template.",
      "tpl.goodNote.gatefold": "The outside of a gatefold: back, spine, front; the inside spread is a sheet of the same size.",
      "tpl.goodNote.labelA": "A round label with the hole in the middle; keep text out of the dashed ring by the hole.",
      "tab.item": "Product",
      "tab.pics": "Pictures",
      "untitled.cd": "CD mockup",
      "untitled.dvd": "DVD mockup",
      "sub.cd": "CD · {pack}",
      "sub.dvd": "{fmt} · {cs} case",
      "make.title": "What do you want to make?",
      "make.g.books": "Books & paper",
      "make.g.music": "Music & film",
      "kind.book": "Book",
      "kind.book.d": "Paperback, hardcover, booklet, spiral, board book, lay-flat",
      "kind.notebook": "Notebook",
      "kind.notebook.d": "Hardcover with rounded corners, elastic band and lined pages",
      "kind.cd": "CD",
      "kind.cd.d": "Jewel case, slim case, digipak or card sleeve, with the disc",
      "kind.dvd": "DVD / Blu-ray",
      "kind.dvd.d": "The case with its sleeve, and the disc",
      "f.cdpack": "Packaging",
      "cdpack.jewel": "Jewel case",
      "cdpack.slim": "Slim case",
      "cdpack.digi": "Digipak",
      "cdpack.sleeve": "Card sleeve",
      "f.tray": "Tray",
      "col.black": "Black",
      "col.clear": "Clear",
      "col.white": "White",
      "col.blue": "Blue",
      "f.dvdfmt": "Format",
      "dvdfmt.dvd": "DVD",
      "dvdfmt.bd": "Blu-ray",
      "f.dvdcs": "Case",
      "dvdcs.std": "Standard",
      "dvdcs.slim": "Slim",
      "f.dvdcol": "Case colour",
      "f.disck": "The disc",
      "disc.silver": "Silver",
      "disc.white": "White",
      "disc.black": "Black",
      "f.hub": "Label printed from",
      "hub.15": "The hole (15 mm)",
      "hub.22": "22 mm",
      "hub.36": "36 mm (clear ring)",
      "good.size": "Closed: {w} × {h} × {d}.",
      "pics.hint.cd": "Each picture goes on its part of the case and on the printer's sheets (Print tab). The disc picture fills the label; its middle is cut out.",
      "pics.hint.dvd": "The front, spine and back of the sleeve, or one full sleeve as the printer's sheet, and the disc label.",
      "slot.disc": "Disc label",
      "slot.inside": "Inside",
      "slot.tray": "Under the tray",
      "slot.spineL": "Spine",
      "slot.spineR": "Spine",
      "slot.spineIn": "Spine (inside)",
      "slot.cd.front": "Front (booklet or cover)",
      "slot.cd.inside": "Inside (back page of the booklet, or inside panel)",
      "slot.cd.back": "Back (tray card)",
      "slot.cd.spine": "Spines",
      "slot.cd.tray": "Under the tray",
      "slot.dvd.front": "Front of the sleeve",
      "slot.dvd.back": "Back of the sleeve",
      "slot.dvd.spine": "Spine of the sleeve",
      "slot.dvd.wrap": "Full sleeve (printer's sheet)",
      "f.openCase": "Open the case",
      "f.sheet": "Sheet",
      "tpl.kind.booklet": "Booklet (4 pages, folded)",
      "tpl.kind.inlay": "Tray card with spines",
      "tpl.kind.disc": "Disc label",
      "tpl.kind.digi": "Digipak, outside",
      "tpl.kind.digiIn": "Digipak, inside",
      "tpl.kind.sleeve": "Card sleeve",
      "tpl.kind.dvd": "Case sleeve",
      "tpl.goodInfo": "{kind} · trim {tw} × {th} · bleed {b}",
      "tpl.discInfo": "Disc {d}, printed from {p} down to {hub}; the hole is {hole}.",
      "tpl.goodNote.booklet": "The back page is on the left, the front on the right; it folds in the middle.",
      "tpl.goodNote.inlay": "The two narrow spines fold up at the ends of the case; the back sits under the tray.",
      "tpl.goodNote.disc": "Pressing plants ask for the label as a square picture; the print stops at the clear ring or the hole you choose on the Product tab.",
      "tpl.goodNote.digiIn": "Inside: the left panel faces the disc; the tray is glued on the right panel.",
      "tpl.goodNote.sleeve": "Back and front of the sleeve; the glue flaps come from your plant's own cutting line.",
      "lg.noprint": "Not printed",
      "tpl.hintGood": "The sheets the pressing plant or print shop asks for, at their real size. Lay out your pictures on them, or save your finished sheets with the right bleed.",
      "lg.discEdge": "Edge of the print and the hole",
      "lg.discOut": "Edge of the disc",
      "bind.ss": "Saddle-stitched", "bind.sp": "Spiral", "bind.bb": "Board book", "bind.lf": "Lay-flat",
      "hint.ss": "Folded in the middle and stapled, like a magazine, a booklet or a zine. No spine; pages go in fours, at most about 96.",
      "hint.sp": "Spiral or wire-o: two loose covers and a coil through holes near the edge. It opens flat; there is no spine.",
      "hint.bb": "A children's board book: thick board pages and a laminated cover flush with them. Each leaf is about 1.5 mm.",
      "hint.lf": "A hardcover whose spread lies flat when open, like a photo book.",
      "f.wire": "Wire colour", "wire.black": "Black", "wire.silver": "Silver", "wire.white": "White", "wire.gold": "Gold",
      "paper.board": "Board pages",
      "tpl.kind.ss": "Saddle-stitched cover (folds in the middle)", "tpl.kind.sp": "Spiral covers (front and back, cut apart)",
      "tpl.kind.bb": "Board book cover",
      "tpl.spineSs": "No spine: the cover folds round the pages at the staples.",
      "tpl.spineSp": "No spine: the coil holds the pages. Keep the blue strip with the holes clear.",
      "tpl.spineBb": "Spine for the printer: {s} (the board pages plus the two covers).",
      "warn.ss4": "Saddle stitching needs a page count that divides by 4.", "warn.ssMax": "Over 96 pages is too many to staple at most printers: take a paperback.",
      "lg.punch": "Holes for the coil: keep clear", "slot.gap": "Gap", "spine.none": "none",
      "f.trim": "Size", "trim.custom": "My own size", "f.w": "Width", "f.h": "Height", "f.unit": "Unit", "unit.in": "inches",
      "f.pages": "Pages", "f.paper": "Paper", "f.cal": "One page (mm)",
      "paper.white": "White 80 g", "paper.cream": "Cream 90 g", "paper.color": "Colour pages", "paper.coated": "Coated (photo book)",
      "paper.bulky": "Thick, bulky", "paper.custom": "My own thickness",
      "f.spineIs": "Spine:", "spine.from": "{pages} pages × {cal} mm", "spine.hand": "typed by hand",
      "spine.block": "pages {b}", "f.spineOn": "Set the spine width by hand", "f.spine": "Spine width (mm)",
      "f.flaps": "Flaps (French flaps)", "f.flapsHc": "Dust jacket with flaps", "f.flapW": "Flap width",
      "f.round": "Rounded spine", "f.band": "Headband", "f.ribbon": "Ribbon bookmark",
      "aria.bandC": "Headband colour", "aria.ribC": "Ribbon colour",
      "f.cloth": "Cover under the jacket", "f.fin": "Finish", "fin.matte": "Matte", "fin.gloss": "Gloss", "fin.soft": "Soft-touch",
      "f.edge": "Page edges", "edge.white": "White", "edge.cream": "Cream", "edge.color": "Coloured (sprayed)",
      "f.edgeC": "Edge colour", "f.inC": "Inside of the cover",
      "f.mode": "Cover pictures", "mode.parts": "Front, back, spine", "mode.wrap": "One full wrap",
      "slot.front": "Front cover", "slot.back": "Back cover", "slot.spine": "Spine", "slot.flapF": "Front flap", "slot.flapB": "Back flap",
      "slot.wrap": "Full wrap (back + spine + front)", "slot.none": "No picture", "slot.missing": "Not on this device yet",
      "btn.choose": "Choose a picture", "btn.remove": "Remove",
      "wrap.info": "Make the wrap {w} × {h} mm, bleed included. From the left: {parts}.",
      "wrap.part": "{name} {mm} mm", "wrap.bleed": "bleed {mm} mm",
      "f.bleed": "Bleed around the wrap (mm)",
      "f.coverC": "Colour where there is no picture", "f.spTC": "Spine text colour", "f.spT": "Spine text (when there is no spine picture)",
      "cover.atelier": "Made your cover in Atelier? There, open More › Make a book mockup, and it comes here with its pages.",
      "f.place": "Placement", "place.stand": "Standing", "place.lie": "Lying", "place.lean": "Leaning",
      "f.turn": "Turn", "f.open": "Open the cover",
      "sec.cam": "Camera", "cam.hint": "Drag the picture to turn around the book; pinch or use the wheel to come closer.",
      "f.fov": "Perspective", "f.zoom": "Size in the picture", "f.dx": "Move left / right", "f.dy": "Move up / down",
      "view.front": "Front", "view.q1": "¾ spine side", "view.q2": "¾ page side", "view.spine": "Spine", "view.back": "Back",
      "view.top": "From above", "view.low": "Low angle",
      "sec.bg": "Background", "bg.none": "See-through", "bg.solid": "Colour", "bg.grad": "Gradient", "bg.photo": "Photo",
      "f.c1": "Colour", "f.c2": "Second colour", "f.ang": "Direction", "f.shadow": "Shadow", "aria.swatch": "Background {n}",
      "sec.light": "Light", "f.az": "From where", "f.el": "Height", "f.str": "Strength", "f.soft": "Softness", "f.warm": "Cool / warm",
      "f.nm": "Name of this mockup", "f.ratio": "Picture shape", "f.size": "Size", "f.fmt": "Format",
      "size.px": "{n} px (long side)",
      "out.info": "{w} × {h} px.", "out.clear": "The background stays see-through (PNG and WebP).",
      "out.jpgclear": "JPG has no see-through: the background turns white.", "out.max": "This device draws at most {n} px; the picture is made smaller.",
      "btn.save": "Save picture", "btn.pics": "Save to Pictures", "btn.atelier": "Open in Atelier",
      "more.title": "Mockup", "btn.dup": "Duplicate this mockup", "btn.resetCam": "Reset the camera and light", "btn.del": "Delete this mockup",
      "more.hint": "Your mockups follow you to every device through orOS sync, encrypted. Their pictures travel with your orOS disk.",
      "btn.cancel": "Cancel", "btn.delete": "Delete", "btn.close": "Close",
      "ask.del": "Delete the mockup \"{name}\"? This removes it from all your devices.",
      "untitled": "Book mockup", "copyOf": "(copy)", "sub.book": "{w} × {h} mm · {pages} pages · {bind}",
      "toast.saveFail": "Could not save on this device (storage full?)", "toast.full": "You have 200 mockups. Delete one first.",
      "toast.deleted": "Mockup deleted", "toast.dup": "Copy made", "toast.nofs": "Pictures need the orOS disk: open the app inside orOS.",
      "toast.badImg": "That file is not a picture orOS can read.", "toast.saved": "Picture saved",
      "toast.pics": "Saved in Pictures as {name}", "toast.picsFail": "Could not save in Pictures.",
      "toast.making": "Making the picture…", "toast.makeFail": "The picture could not be made on this device.",
      "toast.atelier": "Opened in Atelier as a new design.", "toast.noAtelier": "Atelier is not installed.",
      "toast.wrapShape": "This picture's shape does not match this book's wrap. Check the size, pages and bleed.",
      "toast.fromAtelier": "Cover from Atelier: check the size and the pages.",
      "nogl": "The 3D view needs WebGL, which this browser or device has switched off.",
      "loading": "Loading the 3D view…",
      "standalone": "Open Mockups inside orOS to keep pictures and sync.",
      "f.set": "Books in the picture", "set.one": "One book", "set.pair": "Front + back", "set.row": "Series",
      "set.shelf": "Shelf", "set.stack": "Stack", "f.n": "How many books", "f.gap": "Space between them",
      "sec.vols": "The other books", "vols.hint": "Each book can have its own pictures, pages and spine text. Where it has none, it looks like the first book.",
      "vol.n": "Book {n}", "vol.pages": "Pages", "vol.same": "as book 1", "vol.spT": "Spine text",
      "btn.find": "Find free photos", "find.title": "Free photos", "find.ph": "desk, wood, café, shelf…", "find.go": "Search",
      "find.more": "More", "find.hint": "From Openverse and Wikimedia Commons, only photos that allow commercial use. The photo is saved on your orOS disk with its credit; give that credit where you post the picture.",
      "find.intro": "Type what the background should show, for example wooden table or bookshop.", "find.none": "Nothing found. Try other words.",
      "find.busy": "Searching…", "find.offline": "No internet connection.", "find.err": "The photo library did not answer. Try again later.",
      "find.rate": "Too many searches for now. Wait a minute.", "find.getting": "Getting the photo…", "find.fail": "Could not get that photo. Try another one.",
      "find.big": "That photo is too big.", "find.added": "Background photo set", "photo.cr": "Photo: {cr}", "btn.copyCr": "Copy credit",
      "sec.angles": "All angles at once", "angles.hint": "The seven ready views (front, ¾ both sides, spine, back, from above, low angle), each as a picture in the size and format above.",
      "btn.anglesZip": "Save all angles (ZIP)", "btn.anglesPics": "All angles to Pictures",
      "toast.angles": "Making {n} pictures…", "toast.anglesPics": "Saved {n} pictures in Pictures › {name}",
      "sec.motion": "Turntable video", "f.mo": "Motion", "mo.spin": "All round", "mo.swing": "To and fro",
      "f.vfmt": "Kind", "vfmt.video": "Video (MP4 or WebM)", "vfmt.gif": "GIF (small, loops)", "f.sec": "Length", "sec.s": "{n} seconds",
      "f.vsize": "Size", "vsize.px": "{n} px (long side)",
      "mo.info": "{w} × {h} px, {fps} pictures a second, {n} pictures.", "mo.gifmax": "A GIF is at most 8 seconds.",
      "mo.clear": "A video has no see-through: the background turns white.",
      "btn.moMake": "Make the video", "btn.moSave": "Save the video", "btn.moVideos": "Save to Videos", "btn.moPics": "Save to Pictures",
      "mo.done": "{kind} ready: {size}, made in {sec} s.", "mo.making": "Making the video… {pc}%",
      "toast.noVideo": "This browser cannot make videos (it has no video encoder). Try GIF, or Chrome, Edge or Firefox.",
      "toast.moFail": "The video could not be made on this device.", "toast.moStop": "Stopped",
      "toast.videos": "Saved in Videos as {name}", "btn.moMakeGif": "Make the GIF", "dir.angles": "{name} (angles)",
      "tab.print": "Print",
      "tpl.hint": "The cover sheet for the printer, made from this book's numbers: size, pages, paper, binding and flaps. Use it to lay out your cover, or save your finished cover with the right bleed.",
      "tpl.kind.pb": "Paperback cover", "tpl.kind.case": "Hardcover case (wraps round the boards)", "tpl.kind.jacket": "Dust jacket",
      "tpl.info": "Sheet {w} × {h}, bleed included. Trim {tw} × {th}. Spine {s}.",
      "tpl.spine": "Spine for the printer: {s} ({pages} pages × {cal} mm).", "tpl.spineHand": "Spine for the printer: {s} (the page block plus the two boards).",
      "tpl.spinePb": "Spine for the printer: {s} (typed by hand).",
      "slot.hingeB": "Hinge", "slot.hingeF": "Hinge",
      "f.tbleed": "Bleed (mm)", "f.twrap": "Wrap round the boards (mm)", "f.safe": "Safe zone (mm)",
      "f.tbar": "Barcode spot on the back", "f.tart": "With my cover pictures", "f.tgd": "Show the guides",
      "tpl.gdHint": "With the guides off, the file is your finished cover with its bleed, ready for the printer.",
      "lg.bleed": "Bleed, cut away", "lg.wrap": "Wraps round the boards", "lg.trim": "Trim", "lg.fold": "Fold", "lg.hinge": "Hinge", "lg.safe": "Keep text inside",
      "tpl.bar": "Barcode", "tpl.canvasInfo": "{kind} · trim {tw} × {th} · spine {s} · {pages} pages · bleed {b}",
      "warn.thin": "The spine is thinner than 5 mm: most printers print no text on it.",
      "warn.nobar": "The back cover is too small for a barcode spot.",
      "btn.tplPng": "Save PNG", "btn.tplPdf": "Save PDF", "btn.tplPics": "Save to Pictures", "btn.tplAtelier": "Design it in Atelier",
      "tpl.printer": "Your printer's template wins. If they give another spine width, type it in Book › Set the spine width by hand; the bleed is above. The sheet is 300 dpi.",
      "toast.tplAtelier": "Opened in Atelier as a new design of the cover size.", "toast.tplFail": "The template could not be made on this device.",
      "file.tpl": "{name} · cover template", "file.cover": "{name} · cover for print",
      "toast.wrapBook": "Cover from Atelier, on the book \"{name}\" of the same size.",
      "f.show": "What to show", "show.book": "The book", "show.open": "Open book", "show.ebook": "E-book",
      "f.dev": "Device", "dev.tablet": "Tablet", "dev.phone": "Phone", "dev.reader": "E-reader",
      "f.dc": "Device colour", "dc.black": "Black", "dc.white": "White", "dc.silver": "Silver",
      "sec.ins": "Inside pages", "sec.scr": "On the screen",
      "ins.hintOpen": "The two pages the book opens at. Take pictures, or two pages of your book's PDF.",
      "ins.hintEbook": "The page on the screen. Without one, the right inside page or the front cover is shown.",
      "slot.l": "Left page", "slot.r": "Right page", "slot.scr": "Screen",
      "btn.pdf": "Pages from a PDF", "f.pdfp": "Page", "f.curl": "Page curve",
      "pdf.info": "{name}: {n} pages. Change the page number to show other pages.", "pdf.busy": "Reading the PDF…",
      "pdf.fail": "That PDF could not be read.", "pdf.again": "Choose the PDF again to show other pages.",
      "toast.pdfPages": "Pages {a} and {b} placed.", "toast.pdfPage": "Page {a} placed."
    },
    el: {
      "app.name": "Μακέτες", "btn.new": "Νέα μακέτα", "btn.more": "Περισσότερα", "btn.back": "Όλες οι μακέτες",
      "empty": "Δεν υπάρχει ακόμα μακέτα. Φτιάξε μια τρισδιάστατη εικόνα του βιβλίου, του σημειωματαρίου, του CD ή του DVD σου: δώσε μέγεθος, βάλε τις εικόνες, διάλεξε γωνία και φόντο και αποθήκευσέ τη.",
      "btn.first": "Φτιάξε μακέτα",
      "tab.book": "Βιβλίο", "tab.cover": "Εξώφυλλο", "tab.scene": "Σκηνή", "tab.out": "Αποθήκευση",
      "f.bind": "Βιβλιοδεσία", "bind.pb": "Χαρτόδετο", "bind.hc": "Σκληρόδετο",
      "edge.print": "Τυπωμένες (μια εικόνα)", "slot.edgeP": "Εικόνα στις άκρες των σελίδων",
      "sec.finish": "Φινιρίσματα", "f.tex": "Υλικό εξωφύλλου", "tex.paper": "Τυπωμένο χαρτί", "tex.linen": "Λινό", "tex.cloth": "Βιβλιοδετικό ύφασμα",
      "tex.leather": "Δέρμα", "tex.kraft": "Χαρτί kraft", "f.corners": "Στρογγυλεμένες γωνίες", "f.deckle": "Ακανόνιστες άκρες σελίδων (άκοπες)",
      "f.belly": "Ζώνη (κοιλιά)", "f.bellyH": "Ύψος ζώνης", "slot.belly": "Εικόνα της ζώνης", "aria.bellyC": "Χρώμα ζώνης",
      "f.slip": "Κασετίνα", "slot.slip": "Εικόνα κασετίνας (και του κουτιού του box set)", "aria.slipC": "Χρώμα κασετίνας",
      "f.elastic": "Λάστιχο (σημειωματάριο)", "aria.elasticC": "Χρώμα λάστιχου", "btn.notebook": "Κάν' το σημειωματάριο",
      "toast.notebook": "Σκληρόδετο σημειωματάριο A5: στρογγυλές γωνίες, κορδέλα, λάστιχο και σελίδες με γραμμές.",
      "sec.fx": "Χρυσοτυπία, spot UV και ανάγλυφο",
      "fx.hint": "Διάλεξε μια εικόνα για κάθε εφέ: τα λευκά (ή τα ζωγραφισμένα, όχι διάφανα) μέρη της παίρνουν το εφέ, πάνω στο εξώφυλλο όπως η εικόνα του εξωφύλλου. Φτιάξε τη στο Ατελιέ από τον τίτλο ή το λογότυπο του εξωφύλλου.",
      "slot.foil": "Χρυσοτυπία", "slot.uv": "Spot UV (γυαλιστερό)", "slot.emb": "Ανάγλυφο", "f.foilK": "Χρυσοτυπία", "foil.gold": "Χρυσό", "foil.silver": "Ασημί",
      "foil.copper": "Χάλκινο", "foil.rose": "Ροζ χρυσό", "foil.holo": "Ολογραφικό", "f.embK": "Ανάγλυφο", "emb.emboss": "Εξέχει (emboss)", "emb.deboss": "Βαθουλωτό (deboss)",
      "f.stick": "Αυτοκόλλητο στο εξώφυλλο", "slot.stick": "Εικόνα αυτοκόλλητου", "stick.round": "Στρογγυλό", "stick.square": "Τετράγωνο", "aria.stickK": "Σχήμα αυτοκόλλητου",
      "f.stickD": "Μέγεθος", "f.stickX": "Αριστερά / δεξιά", "f.stickY": "Πάνω / κάτω",
      "f.rule": "Άδειες σελίδες", "rule.none": "Λευκές", "rule.lined": "Με γραμμές", "rule.dotted": "Με τελείες", "rule.grid": "Τετραγωνισμένες", "set.box": "Box set",
      "tpack.norelco": "Διάφανη θήκη",
      "tpack.ocard": "O-card",
      "tpack.none": "Μόνο η κασέτα",
      "f.shell": "Κέλυφος",
      "col.smoke": "Φιμέ",
      "col.red": "Κόκκινο",
      "col.marble": "Μαρμαρωτό",
      "f.jp": "J-card",
      "jp.3": "3 πάνελ",
      "jp.4": "4 πάνελ",
      "jp.5": "5 πάνελ",
      "vpack.slip": "Χάρτινη θήκη",
      "vpack.clam": "Πλαστική θήκη",
      "f.rsize": "Δίσκος",
      "rsize.lp": "12″ LP",
      "rsize.7in": "7″ single",
      "f.vjk": "Εξώφυλλο",
      "vjk.single": "Απλό",
      "vjk.gatefold": "Gatefold (ανοιγόμενο)",
      "f.inner": "Εσωτερικός φάκελος",
      "inner.printed": "Τυπωμένος",
      "f.rc": "Χρώμα δίσκου",
      "f.big": "Μεγάλη τρύπα (jukebox)",
      "f.beside.cd": "Ο δίσκος δίπλα στη θήκη",
      "f.beside.dvd": "Ο δίσκος δίπλα στη θήκη",
      "f.beside.tape": "Η κασέτα δίπλα στη θήκη",
      "f.beside.vhs": "Η κασέτα δίπλα στη θήκη της",
      "f.beside.vinyl": "Ο δίσκος δίπλα στο εξώφυλλο",
      "f.openSlide.cd": "Βγάλε τον δίσκο",
      "f.openSlide.tape": "Βγάλε τη θήκη",
      "f.openSlide.vhs": "Βγάλε την κασέτα",
      "f.openSlide.vinyl": "Βγάλε τον δίσκο",
      "sub.tape": "Κασέτα · {pack}",
      "sub.vhs": "VHS · {pack}",
      "sub.vinyl": "{size} · {jk}",
      "kind.tape": "Κασέτα",
      "kind.tape.d": "Κασέτα σε διάφανη θήκη με J-card, σε O-card ή μόνη της",
      "kind.vhs": "VHS",
      "kind.vhs.d": "Βιντεοκασέτα σε χάρτινη ή πλαστική θήκη, με τις ετικέτες της",
      "kind.vinyl": "Βινύλιο",
      "kind.vinyl.d": "12″ LP ή 7″ single: εξώφυλλο, εσωτερικός φάκελος και δίσκος",
      "untitled.tape": "Μακέτα κασέτας",
      "untitled.vhs": "Μακέτα VHS",
      "untitled.vinyl": "Μακέτα βινυλίου",
      "make.g.home": "Σπίτι και χαρτικά",
      "kind.mug": "Κούπα",
      "kind.mug.d": "Κεραμική κούπα 11 ή 15 oz με την εκτύπωση γύρω της· χρώμα μέσα και στο χερούλι",
      "kind.poster": "Αφίσα σε κάδρο",
      "kind.poster.d": "A4 έως A1 και μεγέθη φωτογραφίας, σε κάδρο με πασπαρτού και τζάμι, στον τοίχο",
      "kind.card": "Καρτ ποστάλ ή κάρτα",
      "kind.card.d": "Επίπεδη καρτ ποστάλ ή διπλωμένη ευχετήρια κάρτα που ανοίγει, με φάκελο",
      "untitled.mug": "Μακέτα κούπας",
      "untitled.poster": "Μακέτα αφίσας",
      "untitled.card": "Μακέτα κάρτας",
      "pics.hint.mug": "Μία εικόνα γύρω από την κούπα: η μέση της είναι απέναντι από το χερούλι, οι άκρες της συναντιούνται κάτω από αυτό.",
      "pics.hint.poster": "Η αφίσα στο πραγματικό της μέγεθος· το κάδρο ή το πασπαρτού κρύβει λίγα χιλιοστά από την άκρη.",
      "pics.hint.card": "Μπροστά και πίσω· η διπλωμένη κάρτα έχει και τις δύο εσωτερικές σελίδες.",
      "slot.mug.wrap": "Εκτύπωση γύρω από την κούπα",
      "slot.poster.front": "Αφίσα",
      "slot.card.front": "Μπροστά",
      "slot.card.back": "Πίσω",
      "slot.card.inside": "Μέσα, αριστερά",
      "slot.card.inside2": "Μέσα, δεξιά",
      "slot.inside2": "Μέσα, δεξιά",
      "f.oz": "Μέγεθος",
      "oz.11": "11 oz",
      "oz.15": "15 oz",
      "f.minner": "Μέσα",
      "f.mhandle": "Χερούλι",
      "col.yellow": "Κίτρινο",
      "col.green": "Πράσινο",
      "f.orient": "Προσανατολισμός",
      "orient.portrait": "Κάθετο",
      "orient.landscape": "Οριζόντιο",
      "psize.a4": "A4 (210 × 297 mm)",
      "psize.a3": "A3 (297 × 420 mm)",
      "psize.a2": "A2 (420 × 594 mm)",
      "psize.a1": "A1 (594 × 841 mm)",
      "psize.30x40": "30 × 40 cm",
      "psize.50x70": "50 × 70 cm",
      "psize.61x91": "61 × 91 cm (24 × 36″)",
      "f.frame": "Κάδρο",
      "frame.black": "Μαύρο",
      "frame.white": "Λευκό",
      "frame.oak": "Δρυς",
      "frame.walnut": "Καρυδιά",
      "frame.alu": "Αλουμίνιο",
      "frame.none": "Χωρίς κάδρο",
      "f.pmat": "Πασπαρτού",
      "f.wall": "Τοίχος",
      "wall.none": "Χωρίς",
      "wall.light": "Ανοιχτός",
      "wall.dark": "Σκούρος",
      "f.ck": "Κάρτα",
      "ck.flat": "Επίπεδη καρτ ποστάλ",
      "ck.folded": "Διπλωμένη κάρτα",
      "csize.a6": "A6",
      "csize.a5": "A5",
      "csize.dl": "DL",
      "csize.sq": "Τετράγωνη",
      "f.env": "Φάκελος",
      "env.none": "Χωρίς",
      "env.white": "Λευκός",
      "env.kraft": "Kraft",
      "env.black": "Μαύρος",
      "f.openCard": "Άνοιγμα κάρτας",
      "tpl.kind.mugwrap": "Εκτύπωση κούπας",
      "tpl.kind.poster": "Αφίσα",
      "tpl.kind.pcfront": "Καρτ ποστάλ, μπροστά",
      "tpl.kind.pcback": "Καρτ ποστάλ, πίσω",
      "tpl.kind.gcout": "Κάρτα, έξω",
      "tpl.kind.gcin": "Κάρτα, μέσα",
      "tpl.goodNote.mugwrap": "Η μέση του φύλλου κοιτά μακριά από το χερούλι· οι άκρες συναντιούνται κάτω από αυτό.",
      "tpl.goodNote.poster": "Το κάδρο ή το πασπαρτού κρύβει περίπου 4 με 5 mm γύρω γύρω: κράτα το κείμενο μέσα στη ζώνη ασφαλείας.",
      "tpl.goodNote.gcout": "Αριστερά το πίσω, δεξιά το μπροστά· το δίπλωμα είναι στη μέση.",
      "tpl.goodNote.gcin": "Οι δύο εσωτερικές σελίδες· το δίπλωμα είναι στη μέση.",
      "make.g.wear": "Ρούχα και τσάντες",
      "kind.tshirt": "T-shirt",
      "kind.tshirt.d": "Απλωμένο, σε επτά χρώματα, με τύπωμα μπροστά ή στο στήθος και πίσω",
      "kind.tote": "Πάνινη τσάντα",
      "kind.tote.d": "Βαμβακερή τσάντα με μακριά ή κοντά χερούλια, τυπωμένη στη μία ή και στις δύο πλευρές",
      "untitled.tshirt": "Μακέτα T-shirt",
      "untitled.tote": "Μακέτα πάνινης τσάντας",
      "pics.hint.tshirt": "Τυπώνεται μόνο ό,τι έχει η εικόνα, οπότε μια εικόνα με διάφανο φόντο (PNG) τυπώνεται καλύτερα. Χωράει ολόκληρη στην περιοχή εκτύπωσης, από το πάνω μέρος της.",
      "pics.hint.tote": "Τυπώνεται μόνο ό,τι έχει η εικόνα, οπότε μια εικόνα με διάφανο φόντο (PNG) τυπώνεται καλύτερα. Χωράει ολόκληρη στην περιοχή εκτύπωσης, από το πάνω μέρος της.",
      "slot.tshirt.front": "Τύπωμα μπροστά",
      "slot.tshirt.back": "Τύπωμα πίσω",
      "slot.tote.front": "Τύπωμα μπροστά",
      "slot.tote.back": "Τύπωμα πίσω",
      "f.ccol": "Χρώμα",
      "col.heather": "Γκρι μελανζέ",
      "col.navy": "Μπλε σκούρο",
      "col.forest": "Πράσινο σκούρο",
      "col.sand": "Άμμου",
      "col.natural": "Φυσικό",
      "f.area": "Περιοχή εκτύπωσης",
      "area.front": "Μπροστά",
      "area.chest": "Στήθος αριστερά",
      "f.backPrint": "Τύπωμα και πίσω",
      "f.handles": "Χερούλια",
      "handles.long": "Μακριά (ώμου)",
      "handles.short": "Κοντά (χεριού)",
      "tpl.kind.teefront": "T-shirt, μπροστά",
      "tpl.kind.teeback": "T-shirt, πίσω",
      "tpl.kind.totefront": "Πάνινη τσάντα, μπροστά",
      "tpl.kind.toteback": "Πάνινη τσάντα, πίσω",
      "tpl.goodNote.teefront": "Τύπωμα ρούχου: στείλε PNG με διάφανο φόντο σε αυτό το μέγεθος· όπου είναι διάφανο δεν τυπώνεται τίποτα. Χωρίς ξάκρισμα.",
      "tpl.goodNote.teeback": "Τύπωμα ρούχου: στείλε PNG με διάφανο φόντο σε αυτό το μέγεθος· όπου είναι διάφανο δεν τυπώνεται τίποτα. Χωρίς ξάκρισμα.",
      "tpl.goodNote.totefront": "Τύπωμα τσάντας: στείλε PNG με διάφανο φόντο σε αυτό το μέγεθος· όπου είναι διάφανο δεν τυπώνεται τίποτα. Χωρίς ξάκρισμα.",
      "tpl.goodNote.toteback": "Τύπωμα τσάντας: στείλε PNG με διάφανο φόντο σε αυτό το μέγεθος· όπου είναι διάφανο δεν τυπώνεται τίποτα. Χωρίς ξάκρισμα.",
      "model.get": "Λήψη του τρισδιάστατου μοντέλου ({size})",
      "model.need": "Το τρισδιάστατο μοντέλο έρχεται από τη βιβλιοθήκη μοντέλων του orOS (koulaxizis.github.io), μόνο αν το ζητήσεις, μία φορά· μετά μένει σε αυτή τη συσκευή και δουλεύει χωρίς σύνδεση. Ως τότε ένα επίπεδο υποκατάστατο δείχνει το τύπωμα.",
      "model.busy": "Λήψη του μοντέλου…",
      "model.ready": "Το τρισδιάστατο μοντέλο είναι σε αυτή τη συσκευή.",
      "model.remove": "Αφαίρεση του μοντέλου από τη συσκευή",
      "model.err.net": "Δεν ήταν δυνατή η λήψη του μοντέλου. Έλεγξε τη σύνδεση και δοκίμασε ξανά.",
      "model.err.hash": "Το αρχείο που ήρθε δεν ήταν το αναμενόμενο μοντέλο, οπότε δεν κρατήθηκε. Δοκίμασε ξανά αργότερα.",
      "f.surf": "Επιφάνεια",
      "surf.none": "Καμία (μόνο η σκιά)",
      "surf.wood": "Ξύλο",
      "surf.marble": "Μάρμαρο",
      "surf.linen": "Λινό",
      "surf.paper": "Χαρτί",
      "surf.concrete": "Μπετόν",
      "f.props": "Αντικείμενα δίπλα",
      "prop.cup": "Φλιτζάνι καφέ",
      "prop.plant": "Φυτό",
      "prop.pencil": "Μολύβι",
      "kind.hoodie": "Φούτερ με κουκούλα",
      "kind.hoodie.d": "Απλωμένο με την κουκούλα και την τσέπη, τύπωμα μπροστά ή στο στήθος και πίσω",
      "untitled.hoodie": "Μακέτα φούτερ",
      "pics.hint.hoodie": "Τυπώνεται μόνο ό,τι έχει η εικόνα, οπότε μια εικόνα με διάφανο φόντο (PNG) τυπώνεται καλύτερα. Χωράει ολόκληρη στην περιοχή εκτύπωσης, από το πάνω μέρος της.",
      "slot.hoodie.front": "Τύπωμα μπροστά",
      "slot.hoodie.back": "Τύπωμα πίσω",
      "tpl.kind.hoodfront": "Φούτερ, μπροστά",
      "tpl.kind.hoodback": "Φούτερ, πίσω",
      "tpl.goodNote.hoodfront": "Τύπωμα ρούχου: στείλε PNG με διάφανο φόντο σε αυτό το μέγεθος· όπου είναι διάφανο δεν τυπώνεται τίποτα. Χωρίς ξάκρισμα. Η περιοχή μπροστά είναι πάνω από την τσέπη.",
      "tpl.goodNote.hoodback": "Τύπωμα ρούχου: στείλε PNG με διάφανο φόντο σε αυτό το μέγεθος· όπου είναι διάφανο δεν τυπώνεται τίποτα. Χωρίς ξάκρισμα.",
      "kind.socks": "Κάλτσες",
      "kind.socks.d": "Ένα ζευγάρι απλωμένο, λευκό, μαύρο ή γκρι μελανζέ, με την ίδια εικόνα και στα δύο",
      "untitled.socks": "Μακέτα κάλτσες",
      "pics.hint.socks": "Η ίδια εικόνα πάει μπροστά και στις δύο κάλτσες, από τη λάστιχα και κάτω. Με διάφανο φόντο φαίνεται γύρω της το χρώμα της κάλτσας.",
      "slot.socks.front": "Τύπωμα στις κάλτσες",
      "tpl.kind.sockleg": "Κάλτσα",
      "tpl.goodNote.sockleg": "Το μπροστινό μέρος μίας κάλτσας στο πραγματικό του μέγεθος, για τις δύο. Συχνά οι κάλτσες τυπώνονται ολόγυρα: ζήτα από τον κατασκευαστή το πλήρες πρότυπο.",
      "kind.cap": "Καπέλο",
      "kind.cap.d": "Καπέλο jockey ή trucker, με τυπωμένο ή κεντημένο μπροστινό μέρος",
      "untitled.cap": "Μακέτα καπέλου",
      "pics.hint.cap": "Το μπροστινό μέρος πάνω από το γείσο. Το κέντημα δείχνει καλύτερα έντονα σχήματα με λίγα χρώματα· οι λεπτές γραμμές και τα μικρά γράμματα χάνονται.",
      "slot.cap.front": "Μπροστινό μέρος",
      "tpl.kind.capfront": "Καπέλο, μπροστά",
      "tpl.goodNote.capfront": "Το μπροστινό μέρος στο πραγματικό του μέγεθος, χωρίς bleed. Για κέντημα στείλε έντονα σχήματα με λίγα επίπεδα χρώματα· ο κατασκευαστής τα κάνει βελονιές.",
      "f.capStyle": "Είδος",
      "cap.dad": "Jockey",
      "cap.trucker": "Trucker",
      "f.wfront": "Λευκό μπροστά",
      "f.capFin": "Μπροστά",
      "capfin.print": "Τυπωμένο",
      "capfin.embroidery": "Κεντημένο",
      "make.g.merch": "Merch και μικροαντικείμενα",
      "kind.badge": "Κονκάρδα",
      "kind.badge.d": "Κονκάρδα 25 έως 75 mm, γυαλιστερή ή ματ, με καρφίτσα ή μαγνήτη",
      "kind.sticker": "Αυτοκόλλητο",
      "kind.sticker.d": "Κομμένο στο περίγραμμα της εικόνας, στρογγυλό ή τετράγωνο· ματ, γυαλιστερό, ολογραφικό ή διάφανο",
      "kind.keychain": "Μπρελόκ",
      "kind.keychain.d": "Ακρυλικό, μεταλλικό ή λάστιχο, με τον κρίκο του· τυπωμένο από τη μία ή και τις δύο πλευρές",
      "kind.pin": "Καρφίτσα σμάλτου",
      "kind.pin.d": "Μέταλλο με χρώματα σμάλτου, σκληρό ή μαλακό σμάλτο, αν θες σε καρτελάκι",
      "kind.magnet": "Μαγνητάκι",
      "kind.magnet.d": "Μαγνητάκι ψυγείου: ορθογώνιο, στρογγυλό ή στο σχήμα της εικόνας",
      "untitled.badge": "Μακέτα κονκάρδας",
      "untitled.sticker": "Μακέτα αυτοκόλλητου",
      "untitled.keychain": "Μακέτα μπρελόκ",
      "untitled.pin": "Μακέτα καρφίτσας",
      "untitled.magnet": "Μακέτα μαγνήτη",
      "pics.hint.badge": "Η εικόνα καλύπτει όλο τον κύκλο: η μέση είναι η πρόσοψη, ο εξωτερικός δακτύλιος τυλίγεται γύρω από την άκρη.",
      "pics.hint.sticker": "Για κοπή στο σχήμα βάλε εικόνα με διάφανο φόντο (PNG): η κοπή ακολουθεί το περίγραμμά της.",
      "pics.hint.keychain": "Για κοπή στο σχήμα βάλε PNG με διάφανο φόντο· η πίσω πλευρά κρατά το ίδιο περίγραμμα.",
      "pics.hint.pin": "Βάλε εικόνα με διάφανο φόντο και λίγα επίπεδα χρώματα· η καρφίτσα τη δείχνει ως σμάλτο με μεταλλικές γραμμές.",
      "pics.hint.magnet": "Η εικόνα γεμίζει το μαγνητάκι· για κοπή στο σχήμα βάλε PNG με διάφανο φόντο.",
      "slot.badge.front": "Εικόνα κονκάρδας",
      "slot.sticker.front": "Εικόνα αυτοκόλλητου",
      "slot.keychain.front": "Μπροστινή πλευρά",
      "slot.keychain.back": "Πίσω πλευρά",
      "slot.pin.front": "Σχέδιο καρφίτσας",
      "slot.pin.back": "Καρτελάκι",
      "slot.magnet.front": "Εικόνα μαγνήτη",
      "f.gsize": "Μέγεθος",
      "fin.holo": "Ολογραφικό",
      "fin.clear": "Διάφανο",
      "f.shape": "Σχήμα",
      "shape.die": "Στο σχήμα της εικόνας",
      "shape.round": "Στρογγυλό",
      "shape.square": "Τετράγωνο",
      "shape.rounded": "Στρογγυλεμένες γωνίες",
      "shape.rect": "Ορθογώνιο",
      "f.wedge": "Λευκό περιθώριο",
      "f.bback": "Πίσω",
      "bback.pin": "Καρφίτσα",
      "bback.magnet": "Μαγνήτης",
      "f.kmat": "Υλικό",
      "kmat.acrylic": "Ακρυλικό",
      "kmat.metal": "Μέταλλο",
      "kmat.rubber": "Λάστιχο",
      "f.ring": "Κρίκος",
      "f.metal": "Μέταλλο",
      "metal.silver": "Ασημί",
      "metal.gold": "Χρυσό",
      "metal.black": "Μαύρο",
      "metal.rose": "Ροζ χρυσό",
      "metal.copper": "Χάλκινο",
      "f.two": "Τυπωμένο και από τις δύο πλευρές",
      "f.enamel": "Σμάλτο",
      "enamel.hard": "Σκληρό (λείο, γυαλιστερό)",
      "enamel.soft": "Μαλακό (ανάγλυφες γραμμές)",
      "f.card": "Σε καρτελάκι",
      "f.beside.badge": "Η πίσω πλευρά της κονκάρδας δίπλα",
      "f.beside.pin": "Η πίσω πλευρά της καρφίτσας δίπλα",
      "good.size2": "Μέγεθος: {w} × {h}.",
      "tpl.kind.badge": "Κονκάρδα (στρογγυλή, κοπή)",
      "tpl.kind.sticker": "Αυτοκόλλητο",
      "tpl.kind.kfront": "Μπρελόκ, μπροστά",
      "tpl.kind.kback": "Μπρελόκ, πίσω",
      "tpl.kind.pin": "Σχέδιο καρφίτσας",
      "tpl.kind.pcard": "Καρτελάκι",
      "tpl.kind.magnet": "Μαγνητάκι",
      "tpl.badgeInfo": "Κόψε κύκλο {cut}· η πρόσοψη είναι {d} και ο δακτύλιος ανάμεσα τυλίγεται γύρω από την άκρη και από κάτω.",
      "tpl.inkInfo": "Περιοχή εκτύπωσης {w} × {h}, χωρίς bleed: το τυπογραφείο την τοποθετεί πάνω στο ρούχο.",
      "tpl.cutInfo": "Φύλλο {w} × {h} με το bleed, κοπή {tw} × {th}. Η γραμμή κοπής είναι στο PDF ως λεπτή ματζέντα γραμμή.",
      "tpl.goodNote.badge": "Κράτα το κείμενο μέσα στον διακεκομμένο κύκλο: ο εξωτερικός δακτύλιος πάει γύρω από την άκρη και πίσω.",
      "tpl.goodNote.sticker": "Η κοπή ακολουθεί το περίγραμμα· κράτα το κείμενο έξω από την πράσινη λωρίδα μέσα της.",
      "tpl.goodNote.kfront": "Η τρύπα είναι πάνω στη μέση· κράτα την εικόνα μακριά της.",
      "tpl.goodNote.pin": "Στείλ' το ως σχέδιο: ο κατασκευαστής το κάνει μεταλλικές γραμμές και χρώματα σμάλτου. Λίγα επίπεδα χρώματα και γραμμές τουλάχιστον 0.3 mm δουλεύουν καλύτερα.",
      "tpl.goodNote.magnet": "Κράτα το κείμενο έξω από την πράσινη λωρίδα στην άκρη.",
      "lg.badgeCut": "Κύκλος κοπής",
      "lg.badgeFace": "Άκρη της πρόσοψης",
      "lg.cutAway": "Κόβεται",
      "lg.cutLine": "Γραμμή κοπής",
      "warn.dieOpaque": "Η εικόνα δεν έχει διάφανο φόντο, οπότε η κοπή είναι ένα ορθογώνιο γύρω της.",
      "warn.dieParts": "Κομμάτια της εικόνας στέκονται χωριστά: η κοπή ακολουθεί το μεγαλύτερο. Ένωσέ τα ή μεγάλωσε το λευκό περιθώριο.",
      "warn.dieNoPic": "Βάλε εικόνα: η κοπή ακολουθεί το περίγραμμά της.",
      "pics.hint.tape": "Τα μέρη του J-card (ή του O-card) και οι δύο ετικέτες της κασέτας: η πλευρά A μπροστά, η B πίσω.",
      "pics.hint.vhs": "Μπροστά, πίσω και ράχη της θήκης, η ετικέτα της κασέτας· η εικόνα της ράχης μπαίνει και στην ετικέτα ράχης της κασέτας.",
      "pics.hint.vinyl": "Μπροστά, πίσω και ράχη του εξωφύλλου (ή ένα ενιαίο), οι δύο ετικέτες του δίσκου (στρογγυλές, η τρύπα κόβεται) και τυπωμένος εσωτερικός φάκελος.",
      "slot.sideA": "Ετικέτα, πλευρά A",
      "slot.sideB": "Ετικέτα, πλευρά B",
      "slot.flap": "Πίσω αυτί",
      "slot.in1": "Εσωτερικό πάνελ",
      "slot.in2": "Δεύτερο εσωτερικό πάνελ",
      "slot.side": "Άλλη πλευρά",
      "slot.glue": "Αυτί κόλλας",
      "slot.face": "Ετικέτα προσόψης",
      "slot.tspine": "Ετικέτα ράχης",
      "slot.labelA": "Ετικέτα, πλευρά A",
      "slot.labelB": "Ετικέτα, πλευρά B",
      "slot.innerF": "Εσωτερικός φάκελος, μπροστά",
      "slot.innerB": "Εσωτερικός φάκελος, πίσω",
      "slot.tape.back": "Πίσω αυτί του J-card",
      "slot.tape.inside": "Εσωτερικά πάνελ του J-card",
      "slot.vhs.spine": "Ράχη (θήκη και ετικέτα κασέτας)",
      "slot.vinyl.front": "Μπροστά του εξωφύλλου",
      "slot.vinyl.back": "Πίσω του εξωφύλλου",
      "slot.vinyl.spine": "Ράχη του εξωφύλλου",
      "slot.vinyl.wrap": "Ενιαίο εξώφυλλο (φύλλο τυπογραφείου)",
      "tpl.kind.jcard": "J-card",
      "tpl.kind.tlabel": "Ετικέτες κασέτας (A και B)",
      "tpl.kind.ocard": "Θήκη O-card",
      "tpl.kind.vface": "Ετικέτα προσόψης VHS",
      "tpl.kind.vspine": "Ετικέτα ράχης VHS",
      "tpl.kind.vclam": "Ένθετο πλαστικής θήκης",
      "tpl.kind.vslip": "Χάρτινη θήκη VHS",
      "tpl.kind.jacket": "Εξώφυλλο δίσκου",
      "tpl.kind.gatefold": "Gatefold εξώφυλλο (έξω)",
      "tpl.kind.inner": "Τυπωμένος εσωτερικός φάκελος",
      "tpl.kind.labelA": "Ετικέτα δίσκου, πλευρά A",
      "tpl.kind.labelB": "Ετικέτα δίσκου, πλευρά B",
      "tpl.goodNote.jcard": "Μπροστά, ράχη, και το αυτί που διπλώνει πίσω από την κασέτα· τα επιπλέον πάνελ ανοίγουν μέσα.",
      "tpl.goodNote.tlabel": "Πλευρά A και πλευρά B, 89 × 51 mm η καθεμία· άφησε ελεύθερη τη μέση, εκεί είναι το παράθυρο του κελύφους.",
      "tpl.goodNote.vslip": "Πίσω, ράχη, μπροστά, η άλλη πλευρά και το αυτί κόλλας· τα αυτιά των άκρων έρχονται από τη γραμμή κοπής του τυπογραφείου.",
      "tpl.goodNote.jacket": "Πίσω, ράχη και μπροστά· τα αυτιά κόλλας έρχονται από το πρότυπο του εργοστασίου.",
      "tpl.goodNote.gatefold": "Το έξω μέρος ενός gatefold: πίσω, ράχη, μπροστά· το μέσα άνοιγμα είναι φύλλο ίδιου μεγέθους.",
      "tpl.goodNote.labelA": "Στρογγυλή ετικέτα με την τρύπα στη μέση· κράτα το κείμενο έξω από τον διακεκομμένο κύκλο δίπλα στην τρύπα.",
      "tab.item": "Προϊόν",
      "tab.pics": "Εικόνες",
      "untitled.cd": "Μακέτα CD",
      "untitled.dvd": "Μακέτα DVD",
      "sub.cd": "CD · {pack}",
      "sub.dvd": "{fmt} · θήκη {cs}",
      "make.title": "Τι θέλεις να φτιάξεις;",
      "make.g.books": "Βιβλία και χαρτί",
      "make.g.music": "Μουσική και ταινίες",
      "kind.book": "Βιβλίο",
      "kind.book.d": "Χαρτόδετο, σκληρόδετο, με καρφίτσα, σπιράλ, χαρτονένιο, που ανοίγει επίπεδα",
      "kind.notebook": "Σημειωματάριο",
      "kind.notebook.d": "Σκληρόδετο με στρογγυλές γωνίες, λάστιχο και σελίδες με γραμμές",
      "kind.cd": "CD",
      "kind.cd.d": "Θήκη jewel, λεπτή θήκη, digipak ή χάρτινος φάκελος, με τον δίσκο",
      "kind.dvd": "DVD / Blu-ray",
      "kind.dvd.d": "Η θήκη με το ένθετό της, και ο δίσκος",
      "f.cdpack": "Συσκευασία",
      "cdpack.jewel": "Θήκη jewel",
      "cdpack.slim": "Λεπτή θήκη",
      "cdpack.digi": "Digipak",
      "cdpack.sleeve": "Χάρτινος φάκελος",
      "f.tray": "Βάση δίσκου",
      "col.black": "Μαύρο",
      "col.clear": "Διάφανο",
      "col.white": "Λευκό",
      "col.blue": "Μπλε",
      "f.dvdfmt": "Μορφή",
      "dvdfmt.dvd": "DVD",
      "dvdfmt.bd": "Blu-ray",
      "f.dvdcs": "Θήκη",
      "dvdcs.std": "Κανονική",
      "dvdcs.slim": "Λεπτή",
      "f.dvdcol": "Χρώμα θήκης",
      "f.disck": "Ο δίσκος",
      "disc.silver": "Ασημί",
      "disc.white": "Λευκός",
      "disc.black": "Μαύρος",
      "f.hub": "Η ετικέτα τυπώνεται έως",
      "hub.15": "Την τρύπα (15 mm)",
      "hub.22": "22 mm",
      "hub.36": "36 mm (διάφανος δακτύλιος)",
      "good.size": "Κλειστό: {w} × {h} × {d}.",
      "pics.hint.cd": "Κάθε εικόνα πάει στο μέρος της θήκης και στα φύλλα του τυπογραφείου (καρτέλα Εκτύπωση). Η εικόνα του δίσκου γεμίζει την ετικέτα· η μέση της κόβεται.",
      "pics.hint.dvd": "Μπροστά, ράχη και πίσω του ένθετου, ή ένα ενιαίο ένθετο όπως το φύλλο του τυπογραφείου, και η ετικέτα του δίσκου.",
      "slot.disc": "Ετικέτα δίσκου",
      "slot.inside": "Εσωτερικό",
      "slot.tray": "Κάτω από τη βάση",
      "slot.spineL": "Ράχη",
      "slot.spineR": "Ράχη",
      "slot.spineIn": "Ράχη (μέσα)",
      "slot.cd.front": "Μπροστά (εξώφυλλο ή βιβλιαράκι)",
      "slot.cd.inside": "Μέσα (πίσω σελίδα του βιβλιαρακίου ή εσωτερικό)",
      "slot.cd.back": "Πίσω (ένθετο βάσης)",
      "slot.cd.spine": "Ράχες",
      "slot.cd.tray": "Κάτω από τη βάση",
      "slot.dvd.front": "Μπροστά του ένθετου",
      "slot.dvd.back": "Πίσω του ένθετου",
      "slot.dvd.spine": "Ράχη του ένθετου",
      "slot.dvd.wrap": "Ενιαίο ένθετο (φύλλο τυπογραφείου)",
      "f.openCase": "Άνοιγμα θήκης",
      "f.sheet": "Φύλλο",
      "tpl.kind.booklet": "Βιβλιαράκι (4 σελίδες, διπλωμένο)",
      "tpl.kind.inlay": "Ένθετο βάσης με ράχες",
      "tpl.kind.disc": "Ετικέτα δίσκου",
      "tpl.kind.digi": "Digipak, έξω",
      "tpl.kind.digiIn": "Digipak, μέσα",
      "tpl.kind.sleeve": "Χάρτινος φάκελος",
      "tpl.kind.dvd": "Ένθετο θήκης",
      "tpl.goodInfo": "{kind} · τελικό {tw} × {th} · bleed {b}",
      "tpl.discInfo": "Δίσκος {d}, τυπώνεται από τα {p} έως τα {hub}· η τρύπα είναι {hole}.",
      "tpl.goodNote.booklet": "Η πίσω σελίδα είναι αριστερά, το εξώφυλλο δεξιά· διπλώνει στη μέση.",
      "tpl.goodNote.inlay": "Οι δύο στενές ράχες διπλώνουν στις άκρες της θήκης· το πίσω μέρος μπαίνει κάτω από τη βάση.",
      "tpl.goodNote.disc": "Τα εργοστάσια ζητούν την ετικέτα ως τετράγωνη εικόνα· η εκτύπωση σταματά στον διάφανο δακτύλιο ή στην τρύπα που διαλέγεις στην καρτέλα Προϊόν.",
      "tpl.goodNote.digiIn": "Μέσα: το αριστερό πάνελ κοιτά τον δίσκο· η βάση κολλάει στο δεξί πάνελ.",
      "tpl.goodNote.sleeve": "Πίσω και μπροστά του φακέλου· τα αυτιά για κόλλημα έρχονται από τη γραμμή κοπής του εργοστασίου σου.",
      "lg.noprint": "Δεν τυπώνεται",
      "tpl.hintGood": "Τα φύλλα που ζητά το εργοστάσιο ή το τυπογραφείο, στο πραγματικό τους μέγεθος. Στήσε πάνω τους τις εικόνες σου ή αποθήκευσε τα έτοιμα φύλλα με το σωστό bleed.",
      "lg.discEdge": "Άκρη της εκτύπωσης και τρύπα",
      "lg.discOut": "Άκρη του δίσκου",
      "bind.ss": "Καρφίτσα", "bind.sp": "Σπιράλ", "bind.bb": "Χαρτονένιο", "bind.lf": "Ανοίγει επίπεδα",
      "hint.ss": "Διπλωμένο στη μέση και καρφιτσωμένο, σαν περιοδικό, φυλλάδιο ή fanzine. Δεν έχει ράχη· οι σελίδες πάνε ανά τέσσερις, έως περίπου 96.",
      "hint.sp": "Σπιράλ ή wire-o: δύο χωριστά εξώφυλλα και ένα σπιράλ μέσα από τρύπες κοντά στην άκρη. Ανοίγει επίπεδα· δεν έχει ράχη.",
      "hint.bb": "Παιδικό χαρτονένιο βιβλίο: χοντρές σελίδες από χαρτόνι και πλαστικοποιημένο εξώφυλλο στο ίδιο μέγεθος. Κάθε φύλλο είναι περίπου 1,5 mm.",
      "hint.lf": "Σκληρόδετο που ανοίγει εντελώς επίπεδα, σαν φωτογραφικό άλμπουμ.",
      "f.wire": "Χρώμα σπιράλ", "wire.black": "Μαύρο", "wire.silver": "Ασημί", "wire.white": "Λευκό", "wire.gold": "Χρυσό",
      "paper.board": "Σελίδες χαρτόνι",
      "tpl.kind.ss": "Εξώφυλλο με καρφίτσα (διπλώνει στη μέση)", "tpl.kind.sp": "Εξώφυλλα σπιράλ (μπροστά και πίσω, κομμένα χωριστά)",
      "tpl.kind.bb": "Εξώφυλλο χαρτονένιου βιβλίου",
      "tpl.spineSs": "Χωρίς ράχη: το εξώφυλλο διπλώνει γύρω από τις σελίδες στις καρφίτσες.",
      "tpl.spineSp": "Χωρίς ράχη: το σπιράλ κρατά τις σελίδες. Άφησε ελεύθερη τη μπλε λωρίδα με τις τρύπες.",
      "tpl.spineBb": "Ράχη για το τυπογραφείο: {s} (οι σελίδες από χαρτόνι μαζί με τα δύο εξώφυλλα).",
      "warn.ss4": "Η καρφίτσα θέλει αριθμό σελίδων που διαιρείται με το 4.", "warn.ssMax": "Πάνω από 96 σελίδες είναι πολλές για καρφίτσα στα περισσότερα τυπογραφεία: προτίμησε χαρτόδετο.",
      "lg.punch": "Τρύπες για το σπιράλ: άφησέ τες ελεύθερες", "slot.gap": "Κενό", "spine.none": "καμία",
      "f.trim": "Μέγεθος", "trim.custom": "Δικό μου μέγεθος", "f.w": "Πλάτος", "f.h": "Ύψος", "f.unit": "Μονάδα", "unit.in": "ίντσες",
      "f.pages": "Σελίδες", "f.paper": "Χαρτί", "f.cal": "Μία σελίδα (mm)",
      "paper.white": "Λευκό 80 γρ.", "paper.cream": "Κρεμ 90 γρ.", "paper.color": "Έγχρωμες σελίδες", "paper.coated": "Κουσέ (λεύκωμα)",
      "paper.bulky": "Χοντρό, αφράτο", "paper.custom": "Δικό μου πάχος",
      "f.spineIs": "Ράχη:", "spine.from": "{pages} σελίδες × {cal} mm", "spine.hand": "με το χέρι",
      "spine.block": "σελίδες {b}", "f.spineOn": "Ορίζω το πάχος της ράχης με το χέρι", "f.spine": "Πάχος ράχης (mm)",
      "f.flaps": "Αυτιά (γαλλικά αυτιά)", "f.flapsHc": "Κουβερτούρα με αυτιά", "f.flapW": "Πλάτος αυτιού",
      "f.round": "Στρογγυλή ράχη", "f.band": "Κεφαλάρι", "f.ribbon": "Κορδέλα σελιδοδείκτη",
      "aria.bandC": "Χρώμα κεφαλαριού", "aria.ribC": "Χρώμα κορδέλας",
      "f.cloth": "Εξώφυλλο κάτω από την κουβερτούρα", "f.fin": "Φινίρισμα", "fin.matte": "Ματ", "fin.gloss": "Γυαλιστερό", "fin.soft": "Soft-touch (βελούδινο)",
      "f.edge": "Ακμές σελίδων", "edge.white": "Λευκές", "edge.cream": "Κρεμ", "edge.color": "Χρωματιστές (βαμμένες)",
      "f.edgeC": "Χρώμα ακμών", "f.inC": "Εσωτερικό του εξωφύλλου",
      "f.mode": "Εικόνες εξωφύλλου", "mode.parts": "Εξώφυλλο, οπισθόφυλλο, ράχη", "mode.wrap": "Ένα ενιαίο εξώφυλλο",
      "slot.front": "Εξώφυλλο", "slot.back": "Οπισθόφυλλο", "slot.spine": "Ράχη", "slot.flapF": "Μπροστινό αυτί", "slot.flapB": "Πίσω αυτί",
      "slot.wrap": "Ενιαίο (οπισθόφυλλο + ράχη + εξώφυλλο)", "slot.none": "Χωρίς εικόνα", "slot.missing": "Δεν έχει έρθει ακόμα σε αυτή τη συσκευή",
      "btn.choose": "Διάλεξε εικόνα", "btn.remove": "Αφαίρεση",
      "wrap.info": "Φτιάξε το ενιαίο εξώφυλλο {w} × {h} mm μαζί με το bleed. Από αριστερά: {parts}.",
      "wrap.part": "{name} {mm} mm", "wrap.bleed": "bleed {mm} mm",
      "f.bleed": "Bleed γύρω από το ενιαίο (mm)",
      "f.coverC": "Χρώμα όπου δεν υπάρχει εικόνα", "f.spTC": "Χρώμα κειμένου ράχης", "f.spT": "Κείμενο ράχης (όταν δεν υπάρχει εικόνα ράχης)",
      "cover.atelier": "Έφτιαξες το εξώφυλλο στο Ατελιέ; Εκεί άνοιξε Περισσότερα › Φτιάξε μακέτα βιβλίου και έρχεται εδώ με τις σελίδες του.",
      "f.place": "Τοποθέτηση", "place.stand": "Όρθιο", "place.lie": "Ξαπλωμένο", "place.lean": "Ακουμπισμένο",
      "f.turn": "Περιστροφή", "f.open": "Άνοιγμα εξωφύλλου",
      "sec.cam": "Κάμερα", "cam.hint": "Σύρε την εικόνα για να γυρίσεις γύρω από το βιβλίο· τσίμπημα ή ροδέλα για να πλησιάσεις.",
      "f.fov": "Προοπτική", "f.zoom": "Μέγεθος στην εικόνα", "f.dx": "Μετακίνηση αριστερά / δεξιά", "f.dy": "Μετακίνηση πάνω / κάτω",
      "view.front": "Μπροστά", "view.q1": "¾ από τη ράχη", "view.q2": "¾ από τις σελίδες", "view.spine": "Ράχη", "view.back": "Πίσω",
      "view.top": "Από πάνω", "view.low": "Χαμηλή γωνία",
      "sec.bg": "Φόντο", "bg.none": "Διάφανο", "bg.solid": "Χρώμα", "bg.grad": "Διαβάθμιση", "bg.photo": "Φωτογραφία",
      "f.c1": "Χρώμα", "f.c2": "Δεύτερο χρώμα", "f.ang": "Κατεύθυνση", "f.shadow": "Σκιά", "aria.swatch": "Φόντο {n}",
      "sec.light": "Φως", "f.az": "Από πού", "f.el": "Ύψος", "f.str": "Ένταση", "f.soft": "Απαλότητα", "f.warm": "Ψυχρό / θερμό",
      "f.nm": "Όνομα αυτής της μακέτας", "f.ratio": "Σχήμα εικόνας", "f.size": "Μέγεθος", "f.fmt": "Μορφή",
      "size.px": "{n} px (μεγάλη πλευρά)",
      "out.info": "{w} × {h} px.", "out.clear": "Το φόντο μένει διάφανο (PNG και WebP).",
      "out.jpgclear": "Το JPG δεν έχει διαφάνεια: το φόντο γίνεται λευκό.", "out.max": "Αυτή η συσκευή ζωγραφίζει έως {n} px· η εικόνα βγαίνει μικρότερη.",
      "btn.save": "Αποθήκευση εικόνας", "btn.pics": "Αποθήκευση στις Εικόνες", "btn.atelier": "Άνοιγμα στο Ατελιέ",
      "more.title": "Μακέτα", "btn.dup": "Αντίγραφο αυτής της μακέτας", "btn.resetCam": "Επαναφορά κάμερας και φωτός", "btn.del": "Διαγραφή αυτής της μακέτας",
      "more.hint": "Οι μακέτες σου σε ακολουθούν σε κάθε συσκευή μέσω του sync του orOS, κρυπτογραφημένες. Οι εικόνες τους ταξιδεύουν με τον δίσκο του orOS.",
      "btn.cancel": "Άκυρο", "btn.delete": "Διαγραφή", "btn.close": "Κλείσιμο",
      "ask.del": "Διαγραφή της μακέτας «{name}»; Θα φύγει από όλες τις συσκευές σου.",
      "untitled": "Μακέτα βιβλίου", "copyOf": "(αντίγραφο)", "sub.book": "{w} × {h} mm · {pages} σελίδες · {bind}",
      "toast.saveFail": "Δεν έγινε αποθήκευση σε αυτή τη συσκευή (γέμισε ο χώρος;)", "toast.full": "Έχεις 200 μακέτες. Διάγραψε πρώτα μία.",
      "toast.deleted": "Η μακέτα διαγράφηκε", "toast.dup": "Έγινε αντίγραφο", "toast.nofs": "Οι εικόνες θέλουν τον δίσκο του orOS: άνοιξε την εφαρμογή μέσα από το orOS.",
      "toast.badImg": "Αυτό το αρχείο δεν είναι εικόνα που διαβάζει το orOS.", "toast.saved": "Η εικόνα αποθηκεύτηκε",
      "toast.pics": "Αποθηκεύτηκε στις Εικόνες ως {name}", "toast.picsFail": "Δεν έγινε αποθήκευση στις Εικόνες.",
      "toast.making": "Φτιάχνω την εικόνα…", "toast.makeFail": "Η εικόνα δεν μπόρεσε να γίνει σε αυτή τη συσκευή.",
      "toast.atelier": "Άνοιξε στο Ατελιέ ως νέο σχέδιο.", "toast.noAtelier": "Το Ατελιέ δεν είναι εγκατεστημένο.",
      "toast.wrapShape": "Το σχήμα αυτής της εικόνας δεν ταιριάζει με το ενιαίο εξώφυλλο του βιβλίου. Έλεγξε μέγεθος, σελίδες και bleed.",
      "toast.fromAtelier": "Εξώφυλλο από το Ατελιέ: έλεγξε το μέγεθος και τις σελίδες.",
      "nogl": "Η τρισδιάστατη προβολή θέλει WebGL, που είναι κλειστό σε αυτόν τον browser ή τη συσκευή.",
      "loading": "Φορτώνει η τρισδιάστατη προβολή…",
      "standalone": "Άνοιξε τις Μακέτες μέσα από το orOS για εικόνες και sync.",
      "f.set": "Βιβλία στην εικόνα", "set.one": "Ένα βιβλίο", "set.pair": "Μπρος + πίσω", "set.row": "Σειρά",
      "set.shelf": "Ράφι", "set.stack": "Στοίβα", "f.n": "Πόσα βιβλία", "f.gap": "Απόσταση μεταξύ τους",
      "sec.vols": "Τα άλλα βιβλία", "vols.hint": "Κάθε βιβλίο μπορεί να έχει δικές του εικόνες, σελίδες και κείμενο ράχης. Όπου δεν έχει, μοιάζει με το πρώτο βιβλίο.",
      "vol.n": "Βιβλίο {n}", "vol.pages": "Σελίδες", "vol.same": "όπως το βιβλίο 1", "vol.spT": "Κείμενο ράχης",
      "btn.find": "Δωρεάν φωτογραφίες", "find.title": "Δωρεάν φωτογραφίες", "find.ph": "γραφείο, ξύλο, καφέ, ράφι…", "find.go": "Αναζήτηση",
      "find.more": "Περισσότερες", "find.hint": "Από το Openverse και το Wikimedia Commons, μόνο φωτογραφίες που επιτρέπουν εμπορική χρήση. Η φωτογραφία αποθηκεύεται στον δίσκο του orOS με την αναφορά της· γράψε αυτή την αναφορά όπου δημοσιεύεις την εικόνα.",
      "find.intro": "Γράψε τι να δείχνει το φόντο, για παράδειγμα ξύλινο τραπέζι ή βιβλιοπωλείο.", "find.none": "Δεν βρέθηκε τίποτα. Δοκίμασε άλλες λέξεις.",
      "find.busy": "Αναζήτηση…", "find.offline": "Δεν υπάρχει σύνδεση στο internet.", "find.err": "Η βιβλιοθήκη φωτογραφιών δεν απάντησε. Δοκίμασε αργότερα.",
      "find.rate": "Πολλές αναζητήσεις για τώρα. Περίμενε ένα λεπτό.", "find.getting": "Φέρνω τη φωτογραφία…", "find.fail": "Δεν ήρθε αυτή η φωτογραφία. Δοκίμασε άλλη.",
      "find.big": "Η φωτογραφία είναι πολύ μεγάλη.", "find.added": "Η φωτογραφία φόντου μπήκε", "photo.cr": "Φωτογραφία: {cr}", "btn.copyCr": "Αντιγραφή αναφοράς",
      "sec.angles": "Όλες οι γωνίες μαζί", "angles.hint": "Οι επτά έτοιμες όψεις (μπροστά, ¾ και από τις δύο μεριές, ράχη, πίσω, από πάνω, χαμηλή γωνία), η καθεμία εικόνα στο μέγεθος και τη μορφή από πάνω.",
      "btn.anglesZip": "Όλες οι γωνίες (ZIP)", "btn.anglesPics": "Όλες οι γωνίες στις Εικόνες",
      "toast.angles": "Φτιάχνω {n} εικόνες…", "toast.anglesPics": "Αποθηκεύτηκαν {n} εικόνες στις Εικόνες › {name}",
      "sec.motion": "Βίντεο περιστροφής", "f.mo": "Κίνηση", "mo.spin": "Ολόγυρα", "mo.swing": "Πέρα δώθε",
      "f.vfmt": "Είδος", "vfmt.video": "Βίντεο (MP4 ή WebM)", "vfmt.gif": "GIF (μικρό, σε επανάληψη)", "f.sec": "Διάρκεια", "sec.s": "{n} δευτερόλεπτα",
      "f.vsize": "Μέγεθος", "vsize.px": "{n} px (μεγάλη πλευρά)",
      "mo.info": "{w} × {h} px, {fps} εικόνες το δευτερόλεπτο, {n} εικόνες.", "mo.gifmax": "Ένα GIF είναι έως 8 δευτερόλεπτα.",
      "mo.clear": "Το βίντεο δεν έχει διαφάνεια: το φόντο γίνεται λευκό.",
      "btn.moMake": "Φτιάξε το βίντεο", "btn.moSave": "Αποθήκευση βίντεο", "btn.moVideos": "Αποθήκευση στα Βίντεο", "btn.moPics": "Αποθήκευση στις Εικόνες",
      "mo.done": "Έτοιμο {kind}: {size}, έγινε σε {sec} δευτ.", "mo.making": "Φτιάχνω το βίντεο… {pc}%",
      "toast.noVideo": "Αυτός ο browser δεν φτιάχνει βίντεο (δεν έχει κωδικοποιητή). Δοκίμασε GIF ή Chrome, Edge, Firefox.",
      "toast.moFail": "Το βίντεο δεν μπόρεσε να γίνει σε αυτή τη συσκευή.", "toast.moStop": "Σταμάτησε",
      "toast.videos": "Αποθηκεύτηκε στα Βίντεο ως {name}", "btn.moMakeGif": "Φτιάξε το GIF", "dir.angles": "{name} (γωνίες)",
      "tab.print": "Εκτύπωση",
      "tpl.hint": "Το φύλλο του εξωφύλλου για το τυπογραφείο, από τα νούμερα αυτού του βιβλίου: μέγεθος, σελίδες, χαρτί, δέσιμο και αυτιά. Στήσε πάνω του το εξώφυλλό σου ή αποθήκευσε το έτοιμο εξώφυλλο με το σωστό bleed.",
      "tpl.kind.pb": "Εξώφυλλο χαρτόδετου", "tpl.kind.case": "Θήκη σκληρόδετου (τυλίγει τα χαρτόνια)", "tpl.kind.jacket": "Κουβερτούρα (dust jacket)",
      "tpl.info": "Φύλλο {w} × {h} μαζί με το bleed. Τελικό μέγεθος {tw} × {th}. Ράχη {s}.",
      "tpl.spine": "Ράχη για το τυπογραφείο: {s} ({pages} σελίδες × {cal} mm).", "tpl.spineHand": "Ράχη για το τυπογραφείο: {s} (το σώμα των σελίδων μαζί με τα δύο χαρτόνια).",
      "tpl.spinePb": "Ράχη για το τυπογραφείο: {s} (γραμμένη με το χέρι).",
      "slot.hingeB": "Άρθρωση", "slot.hingeF": "Άρθρωση",
      "f.tbleed": "Bleed (mm)", "f.twrap": "Τύλιγμα γύρω από τα χαρτόνια (mm)", "f.safe": "Ζώνη ασφαλείας (mm)",
      "f.tbar": "Θέση για barcode στο οπισθόφυλλο", "f.tart": "Με τις εικόνες του εξωφύλλου μου", "f.tgd": "Δείξε τους οδηγούς",
      "tpl.gdHint": "Χωρίς τους οδηγούς, το αρχείο είναι το έτοιμο εξώφυλλό σου με το bleed του, για το τυπογραφείο.",
      "lg.bleed": "Bleed, κόβεται", "lg.wrap": "Τυλίγει τα χαρτόνια", "lg.trim": "Κοπή", "lg.fold": "Δίπλωμα", "lg.hinge": "Άρθρωση", "lg.safe": "Κείμενα μέσα από εδώ",
      "tpl.bar": "Barcode", "tpl.canvasInfo": "{kind} · τελικό {tw} × {th} · ράχη {s} · {pages} σελίδες · bleed {b}",
      "warn.thin": "Η ράχη είναι λεπτότερη από 5 mm: τα περισσότερα τυπογραφεία δεν τυπώνουν κείμενο πάνω της.",
      "warn.nobar": "Το οπισθόφυλλο είναι πολύ μικρό για θέση barcode.",
      "btn.tplPng": "Αποθήκευση PNG", "btn.tplPdf": "Αποθήκευση PDF", "btn.tplPics": "Αποθήκευση στις Εικόνες", "btn.tplAtelier": "Σχεδίασέ το στο Ατελιέ",
      "tpl.printer": "Μετράει το πρότυπο του τυπογραφείου σου. Αν δίνει άλλο πλάτος ράχης, γράψ' το στο Βιβλίο › Ορίζω το πάχος της ράχης με το χέρι· το bleed είναι πιο πάνω. Το φύλλο είναι 300 dpi.",
      "toast.tplAtelier": "Άνοιξε στο Ατελιέ ως νέο σχέδιο στο μέγεθος του εξωφύλλου.", "toast.tplFail": "Το πρότυπο δεν μπόρεσε να γίνει σε αυτή τη συσκευή.",
      "file.tpl": "{name} · πρότυπο εξωφύλλου", "file.cover": "{name} · εξώφυλλο για εκτύπωση",
      "toast.wrapBook": "Εξώφυλλο από το Ατελιέ, στο βιβλίο «{name}» του ίδιου μεγέθους.",
      "f.show": "Τι να δείχνει", "show.book": "Το βιβλίο", "show.open": "Ανοιχτό βιβλίο", "show.ebook": "E-book",
      "f.dev": "Συσκευή", "dev.tablet": "Tablet", "dev.phone": "Κινητό", "dev.reader": "E-reader",
      "f.dc": "Χρώμα συσκευής", "dc.black": "Μαύρο", "dc.white": "Λευκό", "dc.silver": "Ασημί",
      "sec.ins": "Εσωτερικές σελίδες", "sec.scr": "Στην οθόνη",
      "ins.hintOpen": "Οι δύο σελίδες όπου ανοίγει το βιβλίο. Βάλε εικόνες ή δύο σελίδες από το PDF του βιβλίου σου.",
      "ins.hintEbook": "Η σελίδα στην οθόνη. Χωρίς αυτή, δείχνει τη δεξιά εσωτερική σελίδα ή το εξώφυλλο.",
      "slot.l": "Αριστερή σελίδα", "slot.r": "Δεξιά σελίδα", "slot.scr": "Οθόνη",
      "btn.pdf": "Σελίδες από PDF", "f.pdfp": "Σελίδα", "f.curl": "Καμπύλη σελίδων",
      "pdf.info": "{name}: {n} σελίδες. Άλλαξε τον αριθμό σελίδας για να δείξεις άλλες.", "pdf.busy": "Διαβάζω το PDF…",
      "pdf.fail": "Αυτό το PDF δεν διαβάστηκε.", "pdf.again": "Διάλεξε ξανά το PDF για να δείξεις άλλες σελίδες.",
      "toast.pdfPages": "Μπήκαν οι σελίδες {a} και {b}.", "toast.pdfPage": "Μπήκε η σελίδα {a}."
    }
  };
  if (window.orosI18n) window.orosI18n.table(STRINGS, "mockups", LANG);
  function t(k, vars) {
    var s = (STRINGS[LANG] && STRINGS[LANG][k] !== undefined) ? STRINGS[LANG][k] : (STRINGS.en[k] !== undefined ? STRINGS.en[k] : k);
    if (vars && typeof s === "string") s = s.replace(/\{(\w+)\}/g, function (m, n) { return vars[n] !== undefined ? vars[n] : m; });
    return s;
  }
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function setLabel(btn, text) { btn.setAttribute("aria-label", text); btn.title = text; }
  function shell() {
    try { return window.parent && window.parent !== window ? window.parent : null; } catch (e) { return null; }
  }
  function fsApi() {
    try { return (window.parent && window.parent.orosFS) || window.orosFS || null; } catch (e) { return window.orosFS || null; }
  }
  function readJSON(key) {
    try { var r = localStorage.getItem(key); return r ? JSON.parse(r) : null; } catch (e) { return null; }
  }
  function fmtNum(v, d) {
    var s = (+v).toFixed(d);
    if (s.indexOf(".") >= 0) s = s.replace(/0+$/, "").replace(/\.$/, "");   // 80 stays 80, 1.50 → 1.5
    return DEC_COMMA ? s.replace(".", ",") : s;
  }
  function parseNum(s) {
    var n = parseFloat(String(s || "").replace(",", "."));
    return isFinite(n) ? n : NaN;
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  var ICON = {
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'
  };

  var toastTimer = 0;
  function toast(msg) {
    var n = $("toast");
    n.textContent = msg;
    n.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { n.classList.remove("show"); }, 3600);
  }

  // ---------- 2. State + storage ----------
  var data = C.empty();               // books (oros-mockups-data)
  var gdata = C.empty();              // other products (oros-mockups-goods)
  var prefs = C.normPrefs(null);
  var cur = null;                    // the open project (normalized)
  var saveTimer = 0;

  function load() {
    try { data = C.parse(localStorage.getItem(C.DATA_KEY)); } catch (e) { data = C.empty(); }
    try { gdata = C.parseGoods(localStorage.getItem(C.GOODS_KEY)); } catch (e) { gdata = C.empty(); }
    prefs = C.normPrefs(readJSON(C.PREFS_KEY));
  }
  function savePrefs() { try { localStorage.setItem(C.PREFS_KEY, JSON.stringify(prefs)); } catch (e) {} }
  function storeData() {
    try { localStorage.setItem(C.DATA_KEY, JSON.stringify(data)); localStorage.setItem(C.GOODS_KEY, JSON.stringify(gdata)); }
    catch (e) { toast(t("toast.saveFail")); return false; }
    if (window.__orosSyncApi) window.__orosSyncApi.dirty();
    return true;
  }
  // Books and products live in two stores; these find the right one.
  function isG(p) { return C.isGood(p); }
  function findPrj(id) {
    var p = C.byId(data, id);
    if (p) return p;
    p = C.byId(gdata, id);
    return p && C.known(p) ? p : null;
  }
  function normAny(p) { return isG(p) ? C.normGoodProject(p) : C.normProject(p); }
  function putAny(p, now) {
    if (isG(p)) {
      if (data.prj.length + gdata.prj.length >= C.MAX_PRJ && !C.byId(gdata, p.id)) return { ok: false, why: "full" };
      var r = C.putGood(gdata, p, now);
      if (r.ok) gdata = r.data;
      return r;
    }
    if (data.prj.length + gdata.prj.length >= C.MAX_PRJ && !C.byId(data, p.id)) return { ok: false, why: "full" };
    var q = C.put(data, p, now);
    if (q.ok) data = q.data;
    return q;
  }
  function removeAny(id, now) {
    if (C.byId(gdata, id)) gdata = C.removeGood(gdata, id, now);
    else data = C.remove(data, id, now);
  }
  function allPrj() { return data.prj.concat(gdata.prj.filter(C.known)); }
  function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 500); }
  function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = 0;
    if (!cur) return;
    var old = findPrj(cur.id);
    if (old) {
      var a = clone(cur), b = clone(old);
      a.m = b.m = 0;
      if (C.canon(a) === C.canon(b)) return;
    }
    var r = putAny(cur, Date.now());
    if (!r.ok) { if (r.why === "full") toast(t("toast.full")); return; }
    cur.m = r.prj.m;
    storeData();
    thumbSoon();
  }
  function label(p) { return p.nm || t(isG(p) ? "untitled." + p.kind : "untitled"); }
  function subOf(p) {
    if (isG(p)) return goodSub(p);
    return t("sub.book", { w: fmtNum(p.bk.w, 1), h: fmtNum(p.bk.h, 1), pages: p.bk.pages, bind: t("bind." + p.bk.bind) });
  }

  // ---------- 3. Thumbnails (IndexedDB) + home ----------
  var TDB = null;
  function tdb() {
    if (TDB) return TDB;
    TDB = new Promise(function (res) {
      try {
        var rq = indexedDB.open("oros-mockups-thumbs", 1);
        rq.onupgradeneeded = function () { rq.result.createObjectStore("t"); };
        rq.onsuccess = function () { res(rq.result); };
        rq.onerror = function () { res(null); };
      } catch (e) { res(null); }
    });
    return TDB;
  }
  function tGet(id) {
    return tdb().then(function (db) {
      if (!db) return null;
      return new Promise(function (res) {
        try {
          var rq = db.transaction("t").objectStore("t").get(id);
          rq.onsuccess = function () { res(rq.result || null); };
          rq.onerror = function () { res(null); };
        } catch (e) { res(null); }
      });
    });
  }
  function tPut(id, val) {
    return tdb().then(function (db) {
      if (!db) return;
      try { db.transaction("t", "readwrite").objectStore("t").put(val, id); } catch (e) {}
    });
  }
  function tDel(id) {
    return tdb().then(function (db) {
      if (!db) return;
      try { db.transaction("t", "readwrite").objectStore("t").delete(id); } catch (e) {}
    });
  }
  var thumbTimer = 0;
  function thumbSoon() { clearTimeout(thumbTimer); thumbTimer = setTimeout(makeThumb, 1500); }
  function makeThumb() {
    clearTimeout(thumbTimer);
    thumbTimer = 0;
    if (!cur || !stage) return;
    var id = cur.id, m = cur.m;
    try {
      var snap = stage.snapshot(320, 400, false).canvas;
      snap.toBlob(function (b) { if (b) tPut(id, { m: m, blob: b }); }, "image/jpeg", 0.82);
    } catch (e) {}
  }

  var thumbUrls = [];
  function renderHome() {
    thumbUrls.forEach(function (u) { URL.revokeObjectURL(u); });
    thumbUrls = [];
    var grid = $("grid");
    grid.textContent = "";
    var list = allPrj().sort(function (a, b) { return b.m - a.m; });
    $("empty-box").hidden = list.length > 0;
    var missing = [];
    list.forEach(function (p) {
      var li = el("li"), b = el("button", "prj");
      b.type = "button";
      var pic = el("span", "prj-pic"), ph = el("span", "ph");
      ph.style.background = p.art.c;
      pic.appendChild(ph);
      b.appendChild(pic);
      b.appendChild(el("span", "prj-name", label(p)));
      b.appendChild(el("span", "prj-sub", subOf(p)));
      b.addEventListener("click", function () { openPrj(p.id); });
      li.appendChild(b);
      grid.appendChild(li);
      tGet(p.id).then(function (v) {
        if (v && v.blob) {
          var u = URL.createObjectURL(v.blob), img = el("img");
          thumbUrls.push(u);
          img.src = u; img.alt = "";
          pic.textContent = ""; pic.appendChild(img);
        }
        if (!v || v.m !== p.m) missing.push({ p: p, pic: pic });
      });
    });
    // thumbnails made on another device are drawn here, one by one
    setTimeout(function () { if (!cur && missing.length) bgThumbs(missing); }, 400);
  }
  var bgBusy = false;
  function bgThumbs(list) {
    if (bgBusy) return;
    bgBusy = true;
    var host = el("div");
    host.style.cssText = "position:fixed;left:-10000px;top:0;width:320px;height:400px;";
    document.body.appendChild(host);
    loadScene().then(function (mod) {
      var st = mod.createStage(host, C);
      st.resize(320, 400);
      var chain = Promise.resolve();
      list.forEach(function (it) {
        chain = chain.then(function () {
          if (cur) return;
          return picsFor(it.p).then(function (r) {
            st.set(it.p, r.imgs, r.bg);
            var cv = st.snapshot(320, 400, false).canvas;
            return new Promise(function (res) {
              cv.toBlob(function (b) {
                if (b) {
                  tPut(it.p.id, { m: it.p.m, blob: b });
                  var u = URL.createObjectURL(b), img = el("img");
                  thumbUrls.push(u); img.src = u; img.alt = "";
                  it.pic.textContent = ""; it.pic.appendChild(img);
                }
                res();
              }, "image/jpeg", 0.82);
            });
          });
        });
      });
      return chain.then(function () { st.destroy(); });
    }).catch(function () {}).then(function () { host.remove(); bgBusy = false; });
  }

  function showHome() {
    if (busy) return;
    if (cur) { if (saveTimer) saveNow(); makeThumb(); }
    clearMotion();
    cur = null;
    prefs.cur = ""; savePrefs();
    $("home").hidden = false;
    $("editor").hidden = true;
    $("back-btn").hidden = true;
    $("more-btn").hidden = true;
    $("title-main").textContent = t("app.name");
    $("title-sub").textContent = "";
    renderHome();
  }
  function openPrj(id) {
    var p = findPrj(id);
    if (!p) { showHome(); return; }
    if (cur && saveTimer) saveNow();
    clearMotion();
    cur = clone(p);
    prefs.cur = id; savePrefs();
    $("home").hidden = true;
    $("editor").hidden = false;
    $("back-btn").hidden = false;
    $("more-btn").hidden = false;
    renderForm();
    showTab(prefs.tab);
    ensureStage().then(function () { layoutStage(); pushAll(); });
    contNote();
  }
  // CONT-1 W4: tell the shell which mockup is open (continue.js keeps the
  // reference and the name only, never the pictures). On opening, and
  // once at the first tap or key after the start; nothing before that, so
  // a restored mockup never hides the one from the other device.
  var contLive = false;
  function contNote() {
    if (!contLive) return;
    try {
      var W = window.parent !== window ? window.parent.orosContinue : null;
      if (W && cur && typeof cur.id === "string" && findPrj(cur.id))
        W.note("mockups", { target: { id: cur.id }, title: label(cur) });
    } catch (e) {}
  }
  (function () {
    if (typeof document === "undefined") return;   // Node tests load parts of this file
    var once = function () {
      document.removeEventListener("pointerdown", once, true);
      document.removeEventListener("keydown", once, true);
      contLive = true;
      contNote();
    };
    document.addEventListener("pointerdown", once, true);
    document.addEventListener("keydown", once, true);
  })();
  // kind: "book" (default) or a product ("cd", "dvd"…)
  function newPrj(init, kind) {
    var p = kind && kind !== "book" ? C.blankGood(kind, C.newId(), Date.now()) : C.blank(C.newId(), Date.now());
    if (!p) return null;
    if (init) init(p);
    var r = putAny(p, Date.now());
    if (!r.ok) { if (r.why === "full") toast(t("toast.full")); return null; }
    storeData();
    openPrj(r.prj.id);
    return r.prj;
  }

  // ---------- 4. Stage (3D view), pictures, camera drag ----------
  var AS = window.orosDK && window.orosDK.assets;
  var MEDIA = window.orosDK && window.orosDK.media;
  var stage = null, stageP = null, sceneMod = null;
  function loadScene() {
    if (sceneMod) return Promise.resolve(sceneMod);
    return import("./scene.js").then(function (m) { sceneMod = m; return m; });
  }
  function ensureStage() {
    if (stage) return Promise.resolve(stage);
    if (stageP) return stageP;
    var msg = $("stage-msg");
    msg.textContent = t("loading"); msg.hidden = false;
    stageP = loadScene().then(function (mod) {
      stage = mod.createStage($("stage"), C);
      msg.hidden = true;
      return stage;
    }).catch(function (e) {
      console.warn("[orOS Mockups] 3D view", e);
      msg.textContent = t("nogl"); msg.hidden = false;
      stageP = null;
      return Promise.reject(e);
    });
    return stageP;
  }
  // The picture's frame inside the stage, in the output's shape.
  function layoutStage() {
    if (!stage || !cur) return;
    var box = $("stage"), bw = box.clientWidth, bh = box.clientHeight;
    if (!bw || !bh) return;
    var r = C.ratioOf(cur.out.ratio), w = bw, h = Math.round(bw / r);
    if (h > bh) { h = bh; w = Math.round(bh * r); }
    var x = Math.round((bw - w) / 2), y = Math.round((bh - h) / 2);
    [].forEach.call(box.querySelectorAll("canvas"), function (c) {
      c.style.left = x + "px"; c.style.top = y + "px"; c.style.width = w + "px"; c.style.height = h + "px";
    });
    stage.resize(w, h);
  }

  var imgCache = {};                 // asset id → HTMLImageElement
  function loadImg(id) {
    if (!id) return Promise.resolve(null);
    if (imgCache[id]) return Promise.resolve(imgCache[id]);
    if (!AS) return Promise.resolve(null);
    return AS.load(id).then(function (img) { if (img) imgCache[id] = img; return img || null; }, function () { return null; });
  }
  // Every picture a project names: { imgs: asset id → picture, bg }.
  function picsFor(p) {
    var imgs = {}, bg = null;
    var jobs = C.assetsOf(p).map(function (id) {
      return loadImg(id).then(function (img) { if (img) imgs[id] = img; });
    });
    jobs.push(loadImg(p.sc.bg.img).then(function (img) { bg = img; }));
    return Promise.all(jobs).then(function () { return { imgs: imgs, bg: bg }; });
  }
  var pushSeq = 0;
  function pushAll() {
    if (!stage || !cur) return;
    var seq = ++pushSeq, p = clone(cur);
    picsFor(p).then(function (r) {
      if (seq !== pushSeq || !stage || !cur) return;
      stage.set(p, r.imgs, r.bg);
    });
  }
  function pushScene(rebuild) {
    if (!stage || !cur) return;
    if (rebuild) { pushAll(); return; }
    var sc = clone(cur.sc);
    loadImg(sc.bg.img).then(function (bg) { if (stage && cur) stage.scene(sc, bg, false); });
  }
  if (AS && typeof AS.onChange === "function") AS.onChange(function () {
    if (cur && isG(cur)) { renderSlots(); pushAll(); drawFlat(); }
    else if (cur) { renderSlots(); renderVols(); renderIns(); renderFinish(); pushAll(); drawFlat(); }
  });

  // Drag to orbit, pinch / wheel to zoom, arrows on the keyboard.
  var ptrs = {}, pinch0 = 0, zoom0 = 1;
  function camChanged() {
    if (busy) return;
    var c = cur.sc.cam;
    c.th = ((c.th + 540) % 360) - 180;
    cur.sc = C.normScene(cur.sc);
    renderCamFields();
    pushScene(false);
    saveSoon();
  }
  function wireStage() {
    var box = $("stage");
    box.addEventListener("pointerdown", function (e) {
      if (!cur) return;
      box.setPointerCapture(e.pointerId);
      ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(ptrs);
      if (ids.length === 2) {
        var a = ptrs[ids[0]], b = ptrs[ids[1]];
        pinch0 = Math.hypot(a.x - b.x, a.y - b.y) || 1; zoom0 = cur.sc.cam.zoom;
      }
      box.classList.add("drag");
    });
    box.addEventListener("pointermove", function (e) {
      var p = ptrs[e.pointerId];
      if (!p || !cur) return;
      var ids = Object.keys(ptrs);
      if (ids.length === 1) {
        cur.sc.cam.th -= (e.clientX - p.x) * 0.4;
        cur.sc.cam.ph += (e.clientY - p.y) * 0.3;
        p.x = e.clientX; p.y = e.clientY;
        camChanged();
      } else if (ids.length === 2) {
        p.x = e.clientX; p.y = e.clientY;
        var a = ptrs[ids[0]], b = ptrs[ids[1]], d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        cur.sc.cam.zoom = zoom0 * d / pinch0;
        camChanged();
      }
    });
    function end(e) {
      delete ptrs[e.pointerId];
      if (!Object.keys(ptrs).length) box.classList.remove("drag");
    }
    box.addEventListener("pointerup", end);
    box.addEventListener("pointercancel", end);
    box.addEventListener("wheel", function (e) {
      if (!cur) return;
      e.preventDefault();
      cur.sc.cam.zoom *= Math.exp(-e.deltaY * 0.0015);
      camChanged();
    }, { passive: false });
    box.addEventListener("keydown", function (e) {
      if (!cur || e.ctrlKey || e.metaKey || e.altKey) return;
      var c = cur.sc.cam, done = true;
      if (e.key === "ArrowLeft") c.th += 5;
      else if (e.key === "ArrowRight") c.th -= 5;
      else if (e.key === "ArrowUp") c.ph += 4;
      else if (e.key === "ArrowDown") c.ph -= 4;
      else if (e.key === "+" || e.key === "=") c.zoom *= 1.08;
      else if (e.key === "-") c.zoom /= 1.08;
      else done = false;
      if (done) { e.preventDefault(); camChanged(); }
    });
    if (typeof ResizeObserver === "function") new ResizeObserver(function () { layoutStage(); }).observe(box);
    else window.addEventListener("resize", layoutStage);
  }
  var VIEWS = [
    { k: "front", th: 0, ph: 6 }, { k: "q1", th: -28, ph: 12 }, { k: "q2", th: 30, ph: 12 },
    { k: "spine", th: -90, ph: 6 }, { k: "back", th: 180, ph: 6 }, { k: "top", th: 0, ph: 80 },
    { k: "low", th: -24, ph: 1, fov: 46 }
  ];
  function renderViews() {
    var box = $("views");
    box.textContent = "";
    box.setAttribute("aria-label", t("sec.cam"));
    VIEWS.forEach(function (v) {
      var b = el("button", null, t("view." + v.k));
      b.type = "button";
      b.addEventListener("click", function () {
        if (!cur) return;
        var c = cur.sc.cam;
        c.th = v.th; c.ph = v.ph; c.dx = 0; c.dy = 0;
        c.fov = v.fov || (c.fov > 40 ? 30 : c.fov);
        camChanged();
      });
      box.appendChild(b);
    });
  }

  // ---------- 5. The form ----------
  var tabs = ["book", "cover", "scene", "print", "out"];
  function showTab(k) {
    if (tabs.indexOf(k) < 0) k = "book";
    tabs.forEach(function (x) {
      var on = x === k;
      $("pane-" + x).hidden = !on;
      $("tab-" + x).classList.toggle("on", on);
      $("tab-" + x).setAttribute("aria-selected", on ? "true" : "false");
      $("tab-" + x).tabIndex = on ? 0 : -1;
    });
    if (prefs.tab !== k) { prefs.tab = k; savePrefs(); }
    var flat = k === "print";
    if ($("flat-box").hidden === flat) {
      $("flat-box").hidden = !flat;
      if (flat) drawFlat(); else if (stage) { layoutStage(); stage.render(); }
    }
  }
  function setVal(id, v) { var n = $(id); if (n && document.activeElement !== n && n.value !== String(v)) n.value = v; }
  function setChk(id, v) { var n = $(id); if (n) n.checked = !!v; }
  function setSeg(id, v) {
    [].forEach.call($(id).querySelectorAll("button"), function (b) {
      var on = b.getAttribute("data-v") === v;
      b.setAttribute("aria-checked", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
    });
  }
  function out(id, text) { $(id).textContent = text; }
  function unitVal(mm) { return cur.unit === "in" ? +(mm / C.MM_PER_IN).toFixed(3) : +(+mm).toFixed(1); }

  // Books and products share the Scene, Print and Save tabs; the
  // first two tabs are the book's or the product's own.
  function renderKind() {
    var g = isG(cur);
    $("book-form").hidden = g;
    $("good-form").hidden = !g;
    [].forEach.call(document.querySelectorAll(".bk-only"), function (n) { n.hidden = g; });
    $("tab-book").textContent = t(g ? "tab.item" : "tab.book");
    $("tab-cover").textContent = t(g ? "tab.pics" : "tab.cover");
    $("show-grp").hidden = g;
    $("tbar-row").hidden = g;
    $("sheet-box").hidden = !g;
    return g;
  }
  function renderForm() {
    if (!cur) return;
    $("title-main").textContent = label(cur);
    $("title-sub").textContent = subOf(cur);
    if (renderKind()) { renderGoodForm(); renderCommon(); return; }
    var b = cur.bk, a = cur.art;
    $("f-spTC").parentNode.hidden = $("f-spT").parentNode.hidden = $("f-coverC").parentNode.hidden = false;
    // book
    setSeg("bind", b.bind);
    setVal("f-trim", b.trim);
    setVal("f-unit", cur.unit);
    setVal("f-w", unitVal(b.w)); setVal("f-h", unitVal(b.h));
    setVal("f-pages", b.pages); setVal("r-pages", Math.min(1200, b.pages)); out("pages-out", b.pages);
    setVal("f-paper", b.paper);
    $("cal-box").hidden = b.paper !== "custom";
    setVal("f-cal", b.cal);
    var d = C.dims(b);
    out("spine-out", !d.spineMm ? t("spine.none") : (cur.unit === "in" ? fmtNum(d.spineMm / C.MM_PER_IN, 3) + "″" : fmtNum(d.spineMm, 1) + " mm"));
    var cal = b.paper === "custom" ? b.cal : C.paperOf(b.paper).c;
    out("spine-sub", "(" + (b.spine ? t("spine.hand") : t("spine.from", { pages: b.pages, cal: fmtNum(cal, 4) })) +
      (d.hc || b.bind === "bb" ? " · " + t("spine.block", { b: fmtNum(d.T, 1) + " mm" }) : "") + ")");
    out("bind-hint", /^(ss|sp|bb|lf)$/.test(b.bind) ? t("hint." + b.bind) : "");
    $("bind-hint").hidden = !/^(ss|sp|bb|lf)$/.test(b.bind);
    $("wire-box").hidden = b.bind !== "sp";
    setVal("f-wire", b.wire);
    $("flaps-row").hidden = !(b.bind === "pb" || b.bind === "hc");
    setChk("f-spineOn", b.spine > 0);
    var noSpine = b.bind === "ss" || b.bind === "sp";
    $("spine-sub").hidden = noSpine;
    $("f-spineOn").closest("label").hidden = noSpine;
    $("spine-box").hidden = noSpine || !(b.spine > 0);
    setVal("f-spine", b.spine || +d.T.toFixed(1));
    setChk("f-flaps", b.flaps);
    $("flaps-lbl").textContent = t(b.bind === "hc" ? "f.flapsHc" : "f.flaps");
    $("flapw-box").hidden = !d.flaps;
    setVal("f-flapW", b.flapW); out("flapw-out", fmtNum(b.flapW, 0) + " mm");
    $("hc-box").hidden = !d.hc;
    $("round-row").hidden = b.bind !== "hc";
    setChk("f-round", b.round); setChk("f-band", b.band); setChk("f-ribbon", b.ribbon);
    setVal("f-bandC", b.bandC); setVal("f-ribC", b.ribC);
    $("cloth-box").hidden = !(b.bind === "hc" && d.flaps);
    setVal("f-clothC", b.clothC);
    setVal("f-fin", b.fin); setVal("f-edge", b.edge);
    $("edgec-box").hidden = b.edge !== "color";
    renderFinish();
    setVal("f-edgeC", b.edgeC); setVal("f-inC", b.inC);
    // cover
    setSeg("mode", a.mode);
    $("wrap-box").hidden = a.mode !== "wrap";
    setVal("f-bleed", C.bleedOf(b, a));
    setVal("f-coverC", a.c); setVal("f-spTC", a.spTC); setVal("f-spT", a.spT);
    renderSlots();
    renderWrapInfo();
    renderVols();
    renderIns();
    renderCommon();
  }
  // Scene, Print and Save (books and products).
  function renderCommon() {
    var s = cur.sc, g = isG(cur);
    var st = g ? C.normSet(null) : cur.set, show = g ? "good" : cur.show;
    if (g) { $("set-grp").hidden = true; $("dev-box").hidden = true; $("setn-box").hidden = true; $("gap-box").hidden = true; }
    var slideOut = g && ((cur.kind === "cd" && cur.g.pack === "sleeve") || cur.kind === "vinyl" || (cur.kind === "vhs" && cur.g.pack === "slip") || (cur.kind === "tape" && cur.g.pack === "ocard"));
    $("open-lbl").textContent = t(g ? (slideOut ? "f.openSlide." + cur.kind : "f.openCase") : "f.open");
    var gdef = g ? C.good(cur.kind) : null, noOpen = gdef && (typeof gdef.noOpen === "function" ? gdef.noOpen(cur.g) : gdef.noOpen);
    $("open-box").hidden = g && (!!noOpen || ((cur.kind === "tape" || cur.kind === "vhs") && cur.g.pack === "none"));
    if (gdef && gdef.openLbl) $("open-lbl").textContent = t(gdef.openLbl);
    if (!g) $("open-box").hidden = show !== "book";
    if (!g) {
      setSeg("showk", show);
      $("set-grp").hidden = show !== "book";
      $("dev-box").hidden = show !== "ebook";
      setSeg("devk", cur.ins.dev); setSeg("dck", cur.ins.dc);
      $("setn-box").hidden = show !== "book" || !(st.k === "row" || st.k === "shelf" || st.k === "stack" || st.k === "box");
      $("gap-box").hidden = show !== "book" || st.k === "one" || st.k === "stack";
    }
    setSeg("setk", st.k);
    setVal("f-n", st.n); out("n-out", st.n);
    setVal("f-gap", st.gap); out("gap-out", fmtNum(st.gap, 1) + " mm");
    $("place-grp").hidden = !g && (show === "open" || (show === "book" && (st.k === "shelf" || st.k === "stack" || st.k === "box")));
    setSeg("place", s.place);
    setVal("f-turn", s.turn); out("turn-out", s.turn + "°");
    setVal("f-open", s.open); out("open-out", s.open + "°");
    renderCamFields();
    setSeg("bgk", s.bg.k);
    $("bgc-box").hidden = s.bg.k === "none" || s.bg.k === "photo";
    $("c2-box").hidden = s.bg.k !== "grad";
    $("ang-box").hidden = s.bg.k !== "grad";
    $("photo-box").hidden = s.bg.k !== "photo";
    $("swatches").hidden = !(s.bg.k === "solid" || s.bg.k === "grad");
    setVal("f-c1", s.bg.c1); setVal("f-c2", s.bg.c2);
    setVal("f-ang", s.bg.ang); out("ang-out", s.bg.ang + "°");
    renderPhotoThumb();
    renderCredit();
    setVal("f-shadow", s.shadow); out("shadow-out", Math.round(s.shadow * 100) + "%");
    setVal("f-surf", s.surf);
    C.PROPS.forEach(function (k) { setChk("f-prop-" + k, s.props[k]); });
    setVal("f-az", s.light.az); out("az-out", s.light.az + "°");
    setVal("f-el", s.light.el); out("el-out", s.light.el + "°");
    setVal("f-str", s.light.str); out("str-out", Math.round(s.light.str * 100) + "%");
    setVal("f-soft", s.light.soft); out("soft-out", Math.round(s.light.soft * 100) + "%");
    setVal("f-warm", s.light.warm); out("warm-out", (s.light.warm > 0 ? "+" : "") + Math.round(s.light.warm * 100));
    renderTpl();
    // out
    setVal("f-nm", cur.nm);
    $("f-nm").placeholder = t("untitled");
    setSeg("ratio", cur.out.ratio);
    setVal("f-size", String(cur.out.size));
    setVal("f-fmt", cur.out.fmt);
    var mo = cur.out.mo;
    setSeg("mok", mo.k);
    setVal("f-vfmt", mo.fmt); setVal("f-sec", String(mo.sec)); setVal("f-vsize", String(mo.size));
    $("vsize-box").hidden = mo.fmt === "gif";
    renderOutInfo();
  }
  // ---------- 5c. Products (CD, DVD…) ----------
  var GM = window.MockMedia || null;
  function goodSub(p) {
    var g = p.g;
    if (p.kind === "cd") return t("sub.cd", { pack: t("cdpack." + g.pack) });
    if (p.kind === "dvd") return t("sub.dvd", { fmt: t("dvdfmt." + g.fmt), cs: t("dvdcs." + g.cs) });
    if (p.kind === "tape") return t("sub.tape", { pack: t("tpack." + g.pack) });
    if (p.kind === "vhs") return t("sub.vhs", { pack: t(g.pack === "none" ? "tpack.none" : "vpack." + g.pack) });
    if (p.kind === "vinyl") return t("sub.vinyl", { size: t("rsize." + g.size), jk: t("vjk." + g.jk) });
    var def = C.good(p.kind);
    if (def && def.opts) return t("kind." + p.kind) + " · " + optTxt(def.opts[0], g[def.opts[0].k]);
    return t("kind." + p.kind);
  }
  // The label of one value of a product option (goods with opts).
  function optTxt(o, v) {
    if (o.u === "mm") return lenTxt(+v, 0);
    if (o.u === "wxh") { var q = String(v).split("x"); return lenTxt(+q[0], 0) + " × " + lenTxt(+q[1], 0); }
    return t(o.p + v);
  }
  // The form of a product that describes its own options.
  function renderGen(def, g) {
    var box = $("gen-form"), key = cur.kind + "|" + LANG + "|" + cur.unit;
    if (box.getAttribute("data-k") !== key) {
      box.textContent = "";
      def.opts.forEach(function (o) {
        var row = el("div"), id = "go-" + o.k;
        row.id = id + "-row";
        if (o.t === "chk") {
          var lb = el("label", "check"), inp = el("input");
          inp.type = "checkbox"; inp.id = id; inp.setAttribute("data-o", o.k);
          lb.appendChild(inp); lb.appendChild(el("span", null, t(o.l)));
          row.appendChild(lb);
        } else if (o.t === "sel") {
          var fl = el("label", "fld"), sel = el("select");
          sel.id = id; sel.setAttribute("data-o", o.k);
          o.v.forEach(function (v) { var op = el("option", null, optTxt(o, v)); op.value = String(v); sel.appendChild(op); });
          fl.appendChild(el("span", null, t(o.l))); fl.appendChild(sel);
          row.appendChild(fl);
        } else {
          var lbl = el("span", "lbl", t(o.l)), seg = el("div", "seg" + (o.v.length > 3 ? " wrap" : ""));
          lbl.id = id + "-lbl"; seg.id = id; seg.setAttribute("role", "radiogroup"); seg.setAttribute("aria-labelledby", lbl.id); seg.setAttribute("data-o", o.k);
          o.v.forEach(function (v) { var b = el("button", null, optTxt(o, v)); b.type = "button"; b.setAttribute("role", "radio"); b.setAttribute("data-v", String(v)); seg.appendChild(b); });
          row.appendChild(lbl); row.appendChild(seg);
        }
        box.appendChild(row);
      });
      box.setAttribute("data-k", key);
    }
    def.opts.forEach(function (o) {
      $("go-" + o.k + "-row").hidden = !!(o.when && !o.when(g));
      if (o.t === "chk") setChk("go-" + o.k, g[o.k]);
      else if (o.t === "sel") setVal("go-" + o.k, String(g[o.k]));
      else setSeg("go-" + o.k, String(g[o.k]));
    });
  }
  function genSet(k, raw) {
    var def = cur && C.good(cur.kind), o = def && def.opts && def.opts.filter(function (x) { return x.k === k; })[0];
    if (!o) return;
    var v = o.t === "chk" ? (raw ? 1 : 0) : typeof o.v[0] === "number" ? +raw : raw;
    changeG(function (g) { g[k] = v; });
    curSheet = ""; legendKind = "";
  }
  function lenTxt(mm, d) { return cur && cur.unit === "in" ? fmtNum(mm / C.MM_PER_IN, 3) + "″" : fmtNum(mm, d == null ? 1 : d) + " mm"; }
  // A garment's model (goods/cloth.js): kept on the device once fetched.
  var modelBusy = "", modelErr = "", modelLooked = {};
  function modelName() { var d = cur && C.good(cur.kind); return d && d.model && window.MockCloth ? d.model : ""; }
  function renderModelBox() {
    var name = modelName(), box = $("model-box");
    box.hidden = !name;
    if (!name) return;
    var CL = window.MockCloth, have = !!CL.buffer(name), M = CL.MODELS[name];
    if (!have && !modelLooked[name]) {
      modelLooked[name] = 1;            // fetched before: from this device's cache, no network
      CL.cached(name).then(function (ok) { if (ok && modelName() === name) { renderModelBox(); pushAll(); } });
    }
    $("model-get").hidden = have;
    $("model-del").hidden = !have || !!modelBusy;
    $("model-get").disabled = !!modelBusy;
    $("model-get").textContent = t("model.get", { size: fmtNum(M.bytes / 1048576, 1) + " MB" });
    $("model-prog").hidden = modelBusy !== name;
    out("model-msg", have ? t("model.ready") : modelBusy === name ? t("model.busy") : modelErr ? t("model.err." + modelErr) : t("model.need"));
  }
  function renderGoodForm() {
    var g = cur.g, a = cur.art, k = cur.kind, D = C.good(k).dims(g);
    ["cd", "dvd", "tape", "vhs", "vinyl"].forEach(function (x) { $(x + "-form").hidden = k !== x; });
    var def = C.good(k);
    $("gen-form").hidden = !def.opts;
    if (def.opts) renderGen(def, g);
    renderModelBox();
    $("disc-box").hidden = !(k === "cd" || k === "dvd");
    if (!def.opts) $("beside-lbl").textContent = t("f.beside." + k);
    $("beside-row").hidden = !!def.opts || ((k === "tape" || k === "vhs") && g.pack === "none");
    if (def.opts) out("good-info", t("good.size2", { w: lenTxt(D.w), h: lenTxt(D.h) }));
    if (k === "tape") {
      setSeg("tpack", g.pack); setSeg("shellk", g.shell);
      $("jp-box").hidden = g.pack !== "norelco";
      setVal("f-jp", String(g.jp));
    } else if (k === "vhs") {
      setSeg("vpack", g.pack); setSeg("vcolk", g.col);
      $("vcol-box").hidden = g.pack !== "clam";
    } else if (k === "vinyl") {
      setSeg("rsizek", g.size); setSeg("vjkk", g.jk); setSeg("innerk", g.inner);
      setVal("f-rc", g.rc);
      $("big-row").hidden = g.size !== "7in";
      setChk("f-big", g.big);
    }
    if (k === "tape" || k === "vhs" || k === "vinyl") out("good-info", t("good.size", { w: lenTxt(D.w), h: lenTxt(D.h), d: lenTxt(D.d) }));
    if (k === "cd") {
      setSeg("cdpack", g.pack);
      $("tray-box").hidden = g.pack === "sleeve";
      setSeg("trayk", g.tray);
      out("good-info", t("good.size", { w: lenTxt(D.w), h: lenTxt(D.h), d: lenTxt(D.d) }));
    } else if (k === "dvd") {
      setSeg("dvdfmt", g.fmt); setSeg("dvdcs", g.cs); setSeg("dvdcol", g.col);
      out("good-info", t("good.size", { w: lenTxt(D.w), h: lenTxt(D.h), d: lenTxt(D.d) }));
    }
    if (g.disc) { setSeg("disck", g.disc); setVal("f-hub", String(g.hub)); }
    setChk("f-beside", g.beside);
    // pictures tab
    var wrapOk = !!C.good(k).wrap;
    $("mode-grp").hidden = !wrapOk;
    setSeg("mode", a.mode);
    $("wrap-box").hidden = !(wrapOk && a.mode === "wrap");
    setVal("f-bleed", C.templateOf(cur, C.sheetsOf(cur)[0]).bleed);
    $("good-pics").hidden = false;
    out("good-pics", t("pics.hint." + k));
    setVal("f-coverC", a.c); setVal("f-spTC", a.spTC); setVal("f-spT", a.spT);
    // flat products have no spine
    $("f-spTC").parentNode.hidden = $("f-spT").parentNode.hidden = !!def.opts;
    // garment ink prints nothing where there is no picture: no colour to choose
    $("f-coverC").parentNode.hidden = !!C.templateOf(cur, C.sheetsOf(cur)[0]).ink;
    renderSlots();
    if (wrapOk) renderWrapInfo();
    $("ins-box").hidden = true; $("vols-box").hidden = true;
  }
  // Which picture slots a product shows (in the order of its sheets).
  function goodSlotsShown() {
    var k = cur.kind, g = cur.g, def = C.good(k);
    if (def && typeof def.shown === "function") return def.shown(g);
    if (cur.art.mode === "wrap" && C.good(k).wrap) return k === "vinyl" ? ["wrap", "labelA", "labelB"].concat(g.inner === "printed" ? ["innerF", "innerB"] : []) : ["wrap", "disc"];
    if (k === "tape") return (g.pack === "norelco" ? ["front", "spine", "back"].concat(g.jp > 3 ? ["inside"] : [])
      : g.pack === "ocard" ? ["front", "back", "spine"] : []).concat(["sideA", "sideB"]);
    if (k === "vhs") return (g.pack === "none" ? [] : ["front", "back", "spine"]).concat(["face"]);
    if (k === "vinyl") return ["front", "back", "spine", "labelA", "labelB"].concat(g.inner === "printed" ? ["innerF", "innerB"] : []);
    if (k === "cd") {
      if (g.pack === "jewel") return ["front", "inside", "back", "spine", "disc"];
      if (g.pack === "slim") return ["front", "inside", "disc"];
      if (g.pack === "digi") return ["front", "back", "spine", "inside", "tray", "disc"];
      return ["front", "back", "disc"];
    }
    return ["front", "back", "spine", "disc"];
  }
  function changeG(fn) { change("book", function (p) { fn(p.g); }); }
  function wireGood() {
    wireSeg("cdpack", function (v) { changeG(function (g) { g.pack = v; }); curSheet = ""; legendKind = ""; });
    wireSeg("trayk", function (v) { changeG(function (g) { g.tray = v; }); });
    wireSeg("dvdfmt", function (v) {
      changeG(function (g) { if (g.fmt !== v && (g.col === "blue" || g.col === "black")) g.col = v === "bd" ? "blue" : "black"; g.fmt = v; });
    });
    wireSeg("dvdcs", function (v) { changeG(function (g) { g.cs = v; }); });
    wireSeg("dvdcol", function (v) { changeG(function (g) { g.col = v; }); });
    wireSeg("disck", function (v) { changeG(function (g) { g.disc = v; }); });
    var reset = function () { curSheet = ""; legendKind = ""; };
    wireSeg("tpack", function (v) { changeG(function (g) { g.pack = v; }); reset(); });
    wireSeg("shellk", function (v) { changeG(function (g) { g.shell = v; }); });
    $("f-jp").addEventListener("change", function () { var v = +$("f-jp").value; changeG(function (g) { g.jp = v; }); });
    wireSeg("vpack", function (v) { changeG(function (g) { g.pack = v; }); reset(); });
    wireSeg("vcolk", function (v) { changeG(function (g) { g.col = v; }); });
    wireSeg("rsizek", function (v) { changeG(function (g) { g.size = v; }); });
    wireSeg("vjkk", function (v) { changeG(function (g) { g.jk = v; }); reset(); });
    wireSeg("innerk", function (v) { changeG(function (g) { g.inner = v; }); reset(); });
    $("f-rc").addEventListener("change", function () { var v = $("f-rc").value; changeG(function (g) { g.rc = v; }); });
    $("f-big").addEventListener("change", function () { var on = $("f-big").checked ? 1 : 0; changeG(function (g) { g.big = on; }); });
    $("f-hub").addEventListener("change", function () { var v = +$("f-hub").value; changeG(function (g) { g.hub = v; }); });
    $("f-beside").addEventListener("change", function () { var on = $("f-beside").checked ? 1 : 0; changeG(function (g) { g.beside = on; }); });
    // the cloth models: downloaded only when the person asks
    $("model-get").addEventListener("click", function () {
      var name = modelName();
      if (!name || modelBusy) return;
      modelBusy = name; modelErr = ""; $("model-prog").value = 0;
      renderModelBox();
      window.MockCloth.load(name, function (f) { $("model-prog").value = f; }).then(function () {
        modelBusy = ""; renderModelBox(); pushAll();
      }, function (e) {
        modelBusy = ""; modelErr = e && e.code === "hash" ? "hash" : "net"; renderModelBox();
      });
    });
    $("model-del").addEventListener("click", function () {
      var name = modelName();
      if (!name) return;
      window.MockCloth.remove(name).then(function () { renderModelBox(); pushAll(); });
    });
    // products that describe their own options
    var gf = $("gen-form");
    gf.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-v]"), sg = b && b.closest("[data-o]");
      if (sg) genSet(sg.getAttribute("data-o"), b.getAttribute("data-v"));
    });
    gf.addEventListener("keydown", function (e) {
      var sg = e.target.closest(".seg[data-o]"), d = (e.key === "ArrowRight" || e.key === "ArrowDown") ? 1 : (e.key === "ArrowLeft" || e.key === "ArrowUp") ? -1 : 0;
      if (!sg || !d) return;
      e.preventDefault();
      var bs = [].slice.call(sg.querySelectorAll("button[data-v]")), i = bs.findIndex(function (b) { return b.getAttribute("aria-checked") === "true"; });
      var nb = bs[(i + d + bs.length) % bs.length];
      genSet(sg.getAttribute("data-o"), nb.getAttribute("data-v"));
      var nid = sg.id, v = nb.getAttribute("data-v");
      setTimeout(function () { var q = $(nid) && $(nid).querySelector('button[data-v="' + v + '"]'); if (q) q.focus(); }, 0);
    });
    gf.addEventListener("change", function (e) {
      var n = e.target, k = n.getAttribute("data-o");
      if (k) genSet(k, n.type === "checkbox" ? n.checked : n.value);
    });
  }

  // "What do you want to make?": books first, then the products
  // this orOS knows, by group.
  var MAKE = [
    { g: "books", items: [{ k: "book" }, { k: "notebook" }] },
    { g: "music", items: [{ k: "cd" }, { k: "dvd" }, { k: "vinyl" }, { k: "tape" }, { k: "vhs" }] },
    { g: "merch", items: [{ k: "badge" }, { k: "sticker" }, { k: "keychain" }, { k: "pin" }, { k: "magnet" }] },
    { g: "home", items: [{ k: "mug" }, { k: "poster" }, { k: "card" }] },
    { g: "wear", items: [{ k: "tshirt" }, { k: "hoodie" }, { k: "tote" }, { k: "cap" }, { k: "socks" }] }
  ];
  var MAKE_ICON = {
    book: '<path d="M6 4h10a2 2 0 0 1 2 2v14H8a2 2 0 0 1-2-2z"/><path d="M6 18a2 2 0 0 1 2-2h10"/>',
    notebook: '<rect x="6" y="3" width="12" height="18" rx="2.5"/><path d="M15 3v18M9 8h3"/>',
    cd: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.2"/><path d="M12 6.5a5.5 5.5 0 0 1 5.5 5.5"/>',
    dvd: '<rect x="5" y="3" width="14" height="18" rx="1.5"/><circle cx="12.5" cy="12" r="4.2"/><circle cx="12.5" cy="12" r="1"/><path d="M7.5 3v18"/>',
    vinyl: '<rect x="3" y="4" width="13" height="16" rx="1"/><circle cx="15" cy="12" r="6.5"/><circle cx="15" cy="12" r="2"/>',
    tape: '<rect x="3" y="6" width="18" height="12" rx="1.5"/><circle cx="8.5" cy="11" r="1.8"/><circle cx="15.5" cy="11" r="1.8"/><path d="M7 18l1.5-3h7l1.5 3"/>',
    vhs: '<rect x="2.5" y="6" width="19" height="12" rx="1"/><rect x="7" y="9" width="10" height="4" rx="0.5"/><circle cx="9" cy="11" r="1"/><circle cx="15" cy="11" r="1"/>',
    badge: '<circle cx="12" cy="12" r="8.5"/><path d="M7 9.5a6 6 0 0 1 5-3"/>',
    sticker: '<path d="M5 4h14v9l-6 7H5z"/><path d="M13 20v-7h6"/>',
    keychain: '<circle cx="8" cy="7" r="3.5"/><rect x="9" y="10" width="10" height="10" rx="2"/><circle cx="12.5" cy="13.5" r="1"/>',
    pin: '<path d="M12 3l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.3 6.8 19.1l1-5.8-4.3-4.1 5.9-.8z"/>',
    magnet: '<path d="M6 4v8a6 6 0 0 0 12 0V4h-4v8a2 2 0 0 1-4 0V4z"/><path d="M6 8h4M14 8h4"/>',
    mug: '<path d="M5 6h11v11a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3z"/><path d="M16 9h1.5a2.5 2.5 0 0 1 0 5H16"/>',
    poster: '<rect x="4" y="3" width="16" height="18" rx="1"/><rect x="7.5" y="6.5" width="9" height="11"/>',
    card: '<path d="M4 5h9v14H4z"/><path d="M13 5l7 2v14l-7-2"/>',
    tshirt: '<path d="M9 4a3 3 0 0 0 6 0l5 2.5-2 4-2-1V20H8V9.5l-2 1-2-4z"/>',
    tote: '<path d="M5 9h14l-1 11H6z"/><path d="M9 9V7a3 3 0 0 1 6 0v2"/>',
    hoodie: '<path d="M8 6a4 4 0 0 1 8 0l4 2-1.5 11H16V11v9H8v-9 8H5.5L4 8z"/><path d="M10.5 9v3M13.5 9v3"/>',
    cap: '<path d="M4 15a8 8 0 0 1 16 0z"/><path d="M14 15h7"/><circle cx="12" cy="6.5" r="0.6"/>',
    socks: '<path d="M7 3h5v9l4 4a2.5 2.5 0 0 1-3.5 3.5L7 14z"/><path d="M7 6h5"/>'
  };
  function renderMake() {
    var box = $("make-groups");
    box.textContent = "";
    MAKE.forEach(function (grp) {
      var items = grp.items.filter(function (it) { return it.k === "book" || it.k === "notebook" || C.good(it.k); });
      if (!items.length) return;
      box.appendChild(el("h3", "make-g", t("make.g." + grp.g)));
      var ul = el("ul", "make-list");
      items.forEach(function (it) {
        var li = el("li"), b = el("button", "make-item");
        b.type = "button";
        var ic = el("span", "make-ic");
        ic.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + MAKE_ICON[it.k] + "</svg>";
        b.appendChild(ic);
        var tx = el("span", "make-tx");
        tx.appendChild(el("span", "make-n", t("kind." + it.k)));
        tx.appendChild(el("span", "make-d", t("kind." + it.k + ".d")));
        b.appendChild(tx);
        b.addEventListener("click", function () { hideDlg(); make(it.k); });
        li.appendChild(b); ul.appendChild(li);
      });
      box.appendChild(ul);
    });
  }
  function make(k) {
    if (cur && saveTimer) saveNow();
    if (k === "book") { newPrj(); showTab("book"); return; }
    if (k === "notebook") {
      newPrj(function (p) { notebookPreset(p); p.nm = t("kind.notebook"); });
      showTab("book");
      return;
    }
    curSheet = ""; legendKind = "";
    newPrj(null, k);
    showTab("book");
  }
  function notebookPreset(p) {
    var bk = p.bk;
    bk.bind = "hc"; bk.trim = "a5"; bk.w = 148; bk.h = 210; bk.pages = 192; bk.paper = "cream"; bk.spine = 0; bk.flaps = 0; bk.round = 0;
    bk.corners = 1; bk.elastic = 1; bk.ribbon = 1; bk.band = 1; bk.tex = bk.tex === "paper" ? "linen" : bk.tex; bk.edge = "cream";
    p.ins.rule = "lined";
  }

  function renderCamFields() {
    var c = cur.sc.cam;
    setVal("f-fov", c.fov); out("fov-out", c.fov + "°");
    setVal("f-zoom", c.zoom); out("zoom-out", Math.round(c.zoom * 100) + "%");
    setVal("f-dx", c.dx); out("dx-out", Math.round(c.dx * 100));
    setVal("f-dy", c.dy); out("dy-out", Math.round(c.dy * 100));
  }
  function renderOutInfo() {
    var sz = C.outSize(cur.out), max = stage ? stage.MAX : 4096, lines = [];
    var k = Math.min(1, max / Math.max(sz.w, sz.h));
    lines.push(t("out.info", { w: Math.round(sz.w * k), h: Math.round(sz.h * k) }));
    if (k < 1) lines.push(t("out.max", { n: max }));
    if (cur.sc.bg.k === "none") lines.push(t(cur.out.fmt === "jpg" ? "out.jpgclear" : "out.clear"));
    out("out-info", lines.join(" "));
    var ms = C.motionSize(cur.out), mp = C.motionPlan(cur.out), ml = [];
    ml.push(t("mo.info", { w: ms.w, h: ms.h, fps: mp.fps, n: mp.n }));
    if (cur.out.mo.fmt === "gif" && cur.out.mo.sec > 8) ml.push(t("mo.gifmax"));
    if (cur.sc.bg.k === "none" && cur.out.mo.fmt === "video") ml.push(t("mo.clear"));
    out("mo-info", ml.join(" "));
    $("mo-make").textContent = t(cur.out.mo.fmt === "gif" ? "btn.moMakeGif" : "btn.moMake");
  }
  // The wrap picture is the printer's sheet (Print tab).
  function renderWrapInfo() {
    var T = isG(cur) ? C.templateOf(cur, C.sheetsOf(cur)[0]) : C.template(cur.bk, cur.art), bl = T.bleed;
    var parts = [t("wrap.bleed", { mm: fmtNum(bl, 1) })];
    T.parts.forEach(function (p) { parts.push(t("wrap.part", { name: t("slot." + p.k), mm: fmtNum(p.w, 2) })); });
    parts.push(t("wrap.bleed", { mm: fmtNum(bl, 1) }));
    out("wrap-info", t("wrap.info", { w: fmtNum(T.sheet.w, 2), h: fmtNum(T.sheet.h, 2), parts: parts.join(" · ") }));
  }

  // Picture slots (cover tab).
  function slotsShown() {
    if (isG(cur)) return goodSlotsShown();
    if (cur.art.mode === "wrap") return ["wrap"];
    return cur.bk.flaps ? ["front", "back", "spine", "flapF", "flapB"] : ["front", "back", "spine"];
  }
  function thumbInto(box, id) {
    box.textContent = "";
    if (!id) { box.textContent = t("slot.none"); return; }
    loadImg(id).then(function (img) {
      box.textContent = "";
      if (!img) { box.textContent = AS && AS.isMissing(id) ? "…" : t("slot.none"); box.title = t("slot.missing"); return; }
      var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height, k = Math.min(1, 112 / Math.max(iw, ih));
      var cv = document.createElement("canvas");
      cv.width = Math.max(1, Math.round(iw * k)); cv.height = Math.max(1, Math.round(ih * k));
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      var im = el("img"); im.src = cv.toDataURL("image/png"); im.alt = "";
      box.appendChild(im);
    });
  }
  // One picture slot: thumbnail, name, Choose / Remove, drop a file.
  function slotRow(name, id, set) {
    var li = el("li", "slot"), th = el("span", "thumb");
    thumbInto(th, id);
    li.appendChild(th);
    li.appendChild(el("span", "slot-name", name));
    var chips = el("span", "chips");
    var pickB = el("button", "chip small", t("btn.choose"));
    pickB.type = "button";
    pickB.addEventListener("click", function () { pickPicture(set); });
    chips.appendChild(pickB);
    if (id) {
      var del = el("button", "chip small", t("btn.remove"));
      del.type = "button";
      del.addEventListener("click", function () { set("", 0, 0); });
      chips.appendChild(del);
    }
    li.appendChild(chips);
    li.addEventListener("dragover", function (e) { e.preventDefault(); li.classList.add("drop"); });
    li.addEventListener("dragleave", function () { li.classList.remove("drop"); });
    li.addEventListener("drop", function (e) {
      e.preventDefault(); li.classList.remove("drop");
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) importPicture(f, set);
    });
    return li;
  }
  // Finishes (Book tab) and the effects + sticker (Cover tab).
  function artSlot(ul, k) {
    ul.appendChild(slotRow(t("slot." + k), cur.art[k], function (id) { change("art", function (p) { p.art[k] = id; }); }));
  }
  function renderFinish() {
    var b = cur.bk, a = cur.art;
    setVal("f-tex", b.tex);
    setChk("f-corners", b.corners); setChk("f-deckle", b.deckle);
    $("deckle-row").hidden = !C.canHave(b, "deckle");
    var ep = $("edgep-slot"); ep.textContent = ""; ep.hidden = b.edge !== "print";
    if (b.edge === "print") artSlot(ep, "edgeP");
    var cb = C.canHave(b, "belly");
    $("belly-row").hidden = !cb;
    setChk("f-belly", b.belly); setVal("f-bellyC", b.bellyC);
    $("belly-box").hidden = !(cb && b.belly);
    setVal("f-bellyH", b.bellyH); out("bellyh-out", fmtNum(b.bellyH, 0) + " mm");
    var bs = $("belly-slot"); bs.textContent = ""; if (cb && b.belly) artSlot(bs, "belly");
    var cs = C.canHave(b, "slip"), box = cur.set.k === "box";
    $("slip-row").hidden = !cs && !box;
    setChk("f-slip", b.slip); setVal("f-slipC", b.slipC);
    var ss = $("slip-slot"); ss.textContent = ""; ss.hidden = !((cs && b.slip) || box);
    if (!ss.hidden) artSlot(ss, "slip");
    setChk("f-elastic", b.elastic); setVal("f-elasticC", b.elasticC);
    $("elastic-row").hidden = b.bind === "sp";
    // cover tab
    var fx = $("fx-slots"); fx.textContent = "";
    ["foil", "uv", "emb"].forEach(function (k) { artSlot(fx, k); });
    setVal("f-foilK", b.foilK); setVal("f-embK", b.embK);
    setChk("f-stick", b.stick);
    $("stick-more").hidden = !b.stick;
    var st = $("stick-slot"); st.textContent = ""; if (b.stick) artSlot(st, "stick");
    setSeg("stickk", b.stickK);
    setVal("f-stickD", b.stickD); out("stickd-out", fmtNum(b.stickD, 0) + " mm");
    setVal("f-stickX", b.stickX); setVal("f-stickY", b.stickY);
    void a;
  }
  function renderSlots() {
    var ul = $("slots"), g = isG(cur);
    ul.textContent = "";
    slotsShown().forEach(function (k) {
      var nm = g && t("slot." + cur.kind + "." + k) !== "slot." + cur.kind + "." + k ? t("slot." + cur.kind + "." + k) : t("slot." + k);
      ul.appendChild(slotRow(nm, cur.art[k], function (id, w, h) { setSlot(k, id, w, h); }));
    });
  }
  // The other books of a series, shelf or stack (cover tab).
  function renderVols() {
    var st = cur.set, box = $("vols"), n = C.count(cur);
    var on = cur.show === "book" && (st.k === "row" || st.k === "shelf" || st.k === "stack" || st.k === "box");
    $("vols-box").hidden = !on;
    box.textContent = "";
    if (!on) return;
    var keys = cur.art.mode === "wrap" ? ["wrap"] : ["front", "spine", "back"];
    for (var i = 1; i < n; i++) (function (i) {
      var v = st.vols[i - 1] || C.normVol(null), wrap = el("div", "vol");
      wrap.appendChild(el("span", "vol-name", t("vol.n", { n: i + 1 })));
      var ul = el("ul", "slots");
      keys.forEach(function (k) {
        ul.appendChild(slotRow(t("slot." + k), v[k], function (id) { setVol(i, function (x) { x[k] = id; }); }));
      });
      wrap.appendChild(ul);
      var g = el("div", "grid2");
      var f1 = el("label", "fld"), in1 = el("input");
      f1.appendChild(el("span", null, t("vol.pages")));
      in1.type = "number"; in1.inputMode = "numeric"; in1.min = "4"; in1.max = "2000"; in1.step = "2";
      in1.placeholder = cur.bk.pages + " · " + t("vol.same");
      in1.value = v.pages ? String(v.pages) : "";
      in1.addEventListener("change", function () {
        var nv = parseNum(in1.value);
        setVol(i, function (x) { x.pages = isFinite(nv) && nv > 0 ? Math.round(nv) : 0; });
      });
      f1.appendChild(in1);
      var f2 = el("label", "fld"), in2 = el("input");
      f2.appendChild(el("span", null, t("vol.spT")));
      in2.maxLength = 80; in2.autocomplete = "off";
      in2.placeholder = cur.art.spT || t("vol.same");
      in2.value = v.spT;
      in2.addEventListener("change", function () { setVol(i, function (x) { x.spT = in2.value; }); });
      f2.appendChild(in2);
      g.appendChild(f1); g.appendChild(f2);
      wrap.appendChild(g);
      box.appendChild(wrap);
    })(i);
  }
  function setVol(i, fn) {
    change("book", function (p) {
      while (p.set.vols.length < i) p.set.vols.push(C.normVol(null));
      fn(p.set.vols[i - 1]);
    });
  }
  function setSlot(k, id, w, h) {
    change("art", function (p) { p.art[k] = id; });
    if (k === "wrap" && id && w && h) {
      var T = isG(cur) ? C.templateOf(cur, C.sheetsOf(cur)[0]) : C.template(cur.bk, cur.art), want = T.sheet.w / T.sheet.h, got = w / h;
      if (Math.abs(got / want - 1) > 0.04) toast(t("toast.wrapShape"));
    }
  }
  function renderPhotoThumb() { thumbInto($("photo-thumb"), cur.sc.bg.img); $("photo-del").hidden = !cur.sc.bg.img; }
  function creditLine(cr) {
    if (!cr) return "";
    if (MEDIA && typeof MEDIA.credit === "function") { var l = MEDIA.credit(cr, LANG2); if (l) return l; }
    return (cr.title || "") + (cr.author ? " · " + cr.author : "");
  }
  function renderCredit() {
    var box = $("photo-cr"), cr = cur.sc.bg.k === "photo" ? cur.sc.bg.cr : null;
    box.textContent = "";
    box.hidden = !cr;
    if (!cr) return;
    var line = creditLine(cr);
    if (cr.page) {
      var a = el("a", null, t("photo.cr", { cr: line }));
      a.href = cr.page; a.target = "_blank"; a.rel = "noopener noreferrer";
      box.appendChild(a);
    } else box.appendChild(document.createTextNode(t("photo.cr", { cr: line })));
    box.appendChild(document.createTextNode(" "));
    var cp = el("button", "chip small", t("btn.copyCr"));
    cp.type = "button";
    cp.addEventListener("click", function () {
      try { navigator.clipboard.writeText(line).then(function () { toast(t("btn.copyCr") + " ✓"); }, function () {}); } catch (e) {}
    });
    box.appendChild(cp);
  }

  // File → orOS disk → callback(id, w, h).
  function importPicture(f, done) {
    if (!AS || !fsApi()) { toast(t("toast.nofs")); return; }
    AS.importFile(f).then(function (r) { done(r.id, r.w, r.h); }, function (e) {
      toast(e && e.message === "nofs" ? t("toast.nofs") : t("toast.badImg"));
    });
  }
  function pickPicture(done) {
    var s = shell(), dlg = null;
    try { dlg = s && s.orosDialog; } catch (e) {}
    if (dlg && typeof dlg.openFile === "function") {
      dlg.openFile("image/*").then(function (f) { if (f) importPicture(f, done); });
      return;
    }
    var inp = $("file-in");
    inp.value = "";
    inp.onchange = function () { var f = inp.files && inp.files[0]; if (f) importPicture(f, done); };
    inp.click();
  }

  // One change to the open project. kind: book | art | scene | out | name
  function change(kind, fn) {
    if (!cur || busy) return;
    fn(cur);
    var n = normAny(cur);
    if (!n) return;
    cur = n;
    renderForm();
    if (kind === "book" || kind === "art") pushAll();
    else if (kind === "scene") pushScene(false);
    else if (kind === "out") layoutStage();
    if (kind === "scene" || kind === "out") renderOutInfo();
    if (kind === "book" || kind === "art" || kind === "tpl" || kind === "name") drawFlat();
    saveSoon();
  }

  function fillSelects() {
    var tr = $("f-trim");
    C.TRIMS.forEach(function (x) {
      var o = el("option", null, x.n + " · " + fmtNum(x.w, 1) + " × " + fmtNum(x.h, 1) + " mm");
      o.value = x.k; tr.appendChild(o);
    });
    var oc = el("option", null, t("trim.custom")); oc.value = "custom"; tr.appendChild(oc);
    var pp = $("f-paper");
    C.PAPERS.forEach(function (x) {
      var o = el("option", null, t("paper." + x.k));
      o.value = x.k; pp.appendChild(o);
    });
    var sz = $("f-size");
    C.SIZES.forEach(function (n) { var o = el("option", null, t("size.px", { n: n })); o.value = String(n); sz.appendChild(o); });
    var se = $("f-sec");
    C.SECS.forEach(function (n) { var o = el("option", null, t("sec.s", { n: n })); o.value = String(n); se.appendChild(o); });
    var vs = $("f-vsize");
    C.VSIZES.forEach(function (n) { var o = el("option", null, t("vsize.px", { n: n })); o.value = String(n); vs.appendChild(o); });
    var ra = $("ratio");
    C.RATIOS.forEach(function (r) {
      var b = el("button", null, r); b.type = "button"; b.setAttribute("role", "radio"); b.setAttribute("data-v", r);
      ra.appendChild(b);
    });
  }
  var SWATCHES = [["#f4f1ea", "#d9d2c3"], ["#eef1f5", "#c9d2de"], ["#ffffff", "#e9e9e9"], ["#1f2430", "#0d1016"],
                  ["#f6d6c8", "#e8a990"], ["#d7eadf", "#9cc5ae"], ["#fef3c7", "#f5c56a"], ["#e3dcf7", "#a998e0"]];
  function renderSwatches() {
    var box = $("swatches");
    box.setAttribute("aria-label", t("sec.bg"));
    SWATCHES.forEach(function (sw, i) {
      var b = el("button");
      b.type = "button";
      b.style.background = "linear-gradient(180deg," + sw[0] + "," + sw[1] + ")";
      setLabel(b, t("aria.swatch", { n: i + 1 }));
      b.addEventListener("click", function () {
        change("scene", function (p) { p.sc.bg.c1 = sw[0]; p.sc.bg.c2 = sw[1]; });
      });
      box.appendChild(b);
    });
  }

  function wireSeg(id, fn) {
    var box = $(id);
    box.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-v]");
      if (b) fn(b.getAttribute("data-v"));
    });
    box.addEventListener("keydown", function (e) {
      var d = (e.key === "ArrowRight" || e.key === "ArrowDown") ? 1 : (e.key === "ArrowLeft" || e.key === "ArrowUp") ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      var bs = [].slice.call(box.querySelectorAll("button[data-v]"));
      var i = bs.findIndex(function (b) { return b.getAttribute("aria-checked") === "true"; });
      var nb = bs[(i + d + bs.length) % bs.length];
      fn(nb.getAttribute("data-v"));
      nb.focus();
    });
  }
  function wireForm() {
    wireSeg("bind", function (v) {
      change("book", function (p) {
        // board books have board pages and few of them; leaving one, the pages turn back to paper
        if (v === "bb" && p.bk.bind !== "bb") { if (p.bk.paper !== "board") p.bk.paper = "board"; if (p.bk.pages > 40) p.bk.pages = 20; }
        else if (v !== "bb" && p.bk.bind === "bb" && p.bk.paper === "board") p.bk.paper = "white";
        p.bk.bind = v;
      });
    });
    $("f-wire").addEventListener("change", function () { change("book", function (p) { p.bk.wire = $("f-wire").value; }); });
    // finishes (v2 wave 2)
    [["f-tex", "tex"], ["f-foilK", "foilK"], ["f-embK", "embK"]].forEach(function (x) {
      $(x[0]).addEventListener("change", function () { var v = $(x[0]).value; change("book", function (p) { p.bk[x[1]] = v; }); });
    });
    ["corners", "deckle", "belly", "slip", "elastic", "stick"].forEach(function (k) {
      $("f-" + k).addEventListener("change", function () { var v = $("f-" + k).checked ? 1 : 0; change("book", function (p) { p.bk[k] = v; }); });
    });
    ["bellyC", "slipC", "elasticC"].forEach(function (k) {
      $("f-" + k).addEventListener("change", function () { var v = $("f-" + k).value; change("book", function (p) { p.bk[k] = v; }); });
    });
    [["f-bellyH", "bellyH"], ["f-stickD", "stickD"], ["f-stickX", "stickX"], ["f-stickY", "stickY"]].forEach(function (x) {
      $(x[0]).addEventListener("input", function () { var v = +$(x[0]).value; change("book", function (p) { p.bk[x[1]] = v; }); });
    });
    wireSeg("stickk", function (v) { change("book", function (p) { p.bk.stickK = v; }); });
    $("f-rule").addEventListener("change", function () { var v = $("f-rule").value; change("art", function (p) { p.ins.rule = v; }); });
    $("nb-btn").addEventListener("click", function () {
      change("book", notebookPreset);
      toast(t("toast.notebook"));
    });
    $("f-trim").addEventListener("change", function () {
      var tr = C.trimOf($("f-trim").value);
      change("book", function (p) { if (tr) { p.bk.w = tr.w; p.bk.h = tr.h; p.bk.trim = tr.k; } else p.bk.trim = "custom"; });
    });
    $("f-unit").addEventListener("change", function () { change("name", function (p) { p.unit = $("f-unit").value; }); });
    ["w", "h"].forEach(function (k) {
      $("f-" + k).addEventListener("change", function () {
        var v = parseNum($("f-" + k).value);
        if (!isFinite(v)) { renderForm(); return; }
        var mm = cur.unit === "in" ? v * C.MM_PER_IN : v;
        change("book", function (p) { p.bk[k] = mm; p.bk.trim = "custom"; });
        $("f-" + k).value = unitVal(cur.bk[k]);
      });
    });
    $("f-pages").addEventListener("change", function () {
      var v = parseNum($("f-pages").value);
      change("book", function (p) { if (isFinite(v)) p.bk.pages = Math.round(v); });
      $("f-pages").value = cur.bk.pages;
    });
    $("r-pages").addEventListener("input", function () { change("book", function (p) { p.bk.pages = +$("r-pages").value; }); });
    $("f-paper").addEventListener("change", function () { change("book", function (p) { p.bk.paper = $("f-paper").value; }); });
    $("f-cal").addEventListener("change", function () {
      var v = parseNum($("f-cal").value);
      change("book", function (p) { if (isFinite(v)) p.bk.cal = v; });
      $("f-cal").value = cur.bk.cal;
    });
    $("f-spineOn").addEventListener("change", function () {
      var on = $("f-spineOn").checked;
      change("book", function (p) { p.bk.spine = on ? +C.dims(p.bk).T.toFixed(1) : 0; });
    });
    $("f-spine").addEventListener("change", function () {
      var v = parseNum($("f-spine").value);
      change("book", function (p) { if (isFinite(v) && v >= 1) p.bk.spine = v; });
      $("f-spine").value = cur.bk.spine;
    });
    $("f-flaps").addEventListener("change", function () { change("book", function (p) { p.bk.flaps = $("f-flaps").checked ? 1 : 0; }); });
    $("f-flapW").addEventListener("input", function () { change("book", function (p) { p.bk.flapW = +$("f-flapW").value; }); });
    ["round", "band", "ribbon"].forEach(function (k) {
      $("f-" + k).addEventListener("change", function () { change("book", function (p) { p.bk[k] = $("f-" + k).checked ? 1 : 0; }); });
    });
    ["bandC", "ribC", "clothC", "edgeC", "inC"].forEach(function (k) {
      $("f-" + k).addEventListener("input", function () { change("book", function (p) { p.bk[k] = $("f-" + k).value; }); });
    });
    $("f-fin").addEventListener("change", function () { change("book", function (p) { p.bk.fin = $("f-fin").value; }); });
    $("f-edge").addEventListener("change", function () { change("book", function (p) { p.bk.edge = $("f-edge").value; }); });
    // cover
    wireSeg("mode", function (v) { change("art", function (p) { p.art.mode = v; }); });
    $("f-bleed").addEventListener("change", function () {
      var v = parseNum($("f-bleed").value);
      change("art", function (p) { if (isFinite(v)) p.art.bleed = Math.max(0, v); });
    });
    $("f-coverC").addEventListener("input", function () { change("art", function (p) { p.art.c = $("f-coverC").value; }); });
    $("f-spTC").addEventListener("input", function () { change("art", function (p) { p.art.spTC = $("f-spTC").value; }); });
    $("f-spT").addEventListener("input", function () { change("art", function (p) { p.art.spT = $("f-spT").value; }); });
    // scene
    wireSeg("showk", function (v) {
      change("book", function (p) {
        // an open book reads best from above
        if (p.show !== v && v === "open" && p.sc.cam.ph < 25) { p.sc.cam.ph = 40; p.sc.cam.th = 0; }
        if (p.show !== v && v !== "open" && p.show === "open" && p.sc.cam.ph > 30) p.sc.cam.ph = 12;
        p.show = v;
      });
    });
    wireSeg("devk", function (v) { change("art", function (p) { p.ins.dev = v; }); });
    wireSeg("dck", function (v) { change("art", function (p) { p.ins.dc = v; }); });
    $("f-curl").addEventListener("input", function () { var v = +$("f-curl").value; change("art", function (p) { p.ins.curl = v; }); });
    $("pdf-pick").addEventListener("click", pickPdf);
    $("f-pdfp").addEventListener("change", function () {
      var n = Math.round(parseNum($("f-pdfp").value));
      if (!(n >= 1)) { renderIns(); return; }
      if (pdfDoc) pdfPages(n);
      else { change("art", function (p) { p.ins.pdfp = n; }); toast(t("pdf.again")); }
    });
    wireSeg("setk", function (v) {
      change("book", function (p) {
        if (p.set.k !== v) {
          p.set.gap = C.GAP_DEF[v];
          // a shelf shows its spines best from the front
          if (v === "shelf" && Math.abs(p.sc.cam.th) > 20) { p.sc.cam.th = -14; p.sc.cam.ph = 8; }
        }
        p.set.k = v;
      });
    });
    $("f-n").addEventListener("input", function () { var v = +$("f-n").value; change("book", function (p) { p.set.n = v; }); });
    $("f-gap").addEventListener("input", function () { var v = +$("f-gap").value; change("book", function (p) { p.set.gap = v; }); });
    wireSeg("place", function (v) {
      change("scene", function (p) {
        if (p.sc.place !== v && v === "lie" && p.sc.cam.ph < 35) p.sc.cam.ph = 55;
        if (p.sc.place !== v && v !== "lie" && p.sc.cam.ph > 50) p.sc.cam.ph = 12;
        p.sc.place = v;
      });
    });
    function rng(id, set) { $(id).addEventListener("input", function () { var v = +$(id).value; change("scene", function (p) { set(p.sc, v); }); }); }
    rng("f-turn", function (s, v) { s.turn = v; });
    rng("f-open", function (s, v) { s.open = v; });
    rng("f-fov", function (s, v) { s.cam.fov = v; });
    rng("f-zoom", function (s, v) { s.cam.zoom = v; });
    rng("f-dx", function (s, v) { s.cam.dx = v; });
    rng("f-dy", function (s, v) { s.cam.dy = v; });
    rng("f-ang", function (s, v) { s.bg.ang = v; });
    rng("f-shadow", function (s, v) { s.shadow = v; });
    $("f-surf").addEventListener("change", function () { var v = $("f-surf").value; change("scene", function (p) { p.sc.surf = v; }); });
    C.PROPS.forEach(function (k) {
      $("f-prop-" + k).addEventListener("change", function () { var on = $("f-prop-" + k).checked ? 1 : 0; change("scene", function (p) { p.sc.props[k] = on; }); });
    });
    rng("f-az", function (s, v) { s.light.az = v; });
    rng("f-el", function (s, v) { s.light.el = v; });
    rng("f-str", function (s, v) { s.light.str = v; });
    rng("f-soft", function (s, v) { s.light.soft = v; });
    rng("f-warm", function (s, v) { s.light.warm = v; });
    wireSeg("bgk", function (v) { change("scene", function (p) { p.sc.bg.k = v; }); if (v === "photo" && !cur.sc.bg.img) pickBgPhoto(); });
    $("f-c1").addEventListener("input", function () { change("scene", function (p) { p.sc.bg.c1 = $("f-c1").value; }); });
    $("f-c2").addEventListener("input", function () { change("scene", function (p) { p.sc.bg.c2 = $("f-c2").value; }); });
    $("photo-pick").addEventListener("click", pickBgPhoto);
    $("photo-find").addEventListener("click", openFind);
    $("photo-del").addEventListener("click", function () { change("scene", function (p) { p.sc.bg.img = ""; p.sc.bg.cr = null; }); });
    // out
    $("f-nm").addEventListener("input", function () { change("name", function (p) { p.nm = $("f-nm").value; }); });
    wireSeg("ratio", function (v) { change("out", function (p) { p.out.ratio = v; }); });
    $("f-size").addEventListener("change", function () { change("out", function (p) { p.out.size = +$("f-size").value; }); });
    $("f-fmt").addEventListener("change", function () { change("out", function (p) { p.out.fmt = $("f-fmt").value; }); });
    $("save-btn").addEventListener("click", savePicture);
    $("pics-btn").addEventListener("click", saveToPictures);
    $("atelier-btn").addEventListener("click", openInAtelier);
    $("angles-zip").addEventListener("click", function () { allAngles(false); });
    $("angles-pics").addEventListener("click", function () { allAngles(true); });
    wireSeg("mok", function (v) { change("out", function (p) { p.out.mo.k = v; }); });
    $("f-vfmt").addEventListener("change", function () { change("out", function (p) { p.out.mo.fmt = $("f-vfmt").value; }); clearMotion(); });
    $("f-sec").addEventListener("change", function () { change("out", function (p) { p.out.mo.sec = +$("f-sec").value; }); });
    $("f-vsize").addEventListener("change", function () { change("out", function (p) { p.out.mo.size = +$("f-vsize").value; }); });
    $("mo-make").addEventListener("click", makeMotion);
    $("mo-stop").addEventListener("click", function () { moStop = true; });
    $("mo-save").addEventListener("click", saveMotion);
    $("mo-keep").addEventListener("click", keepMotion);
    // free photos
    $("find-form").addEventListener("submit", function (e) { e.preventDefault(); findRun(false); });
    $("find-more").addEventListener("click", function () { find.page++; findRun(true); });
  }
  function pickBgPhoto() {
    pickPicture(function (id) { change("scene", function (p) { p.sc.bg.img = id; p.sc.bg.k = "photo"; p.sc.bg.cr = null; }); });
  }

  // ---------- 5b. Inside pages and the e-book screen ----------
  // Pictures, or pages of a PDF drawn by the vendored PDF.js (loaded
  // only when asked for). The PDF itself is not kept: its pages
  // become pictures on the orOS disk, like any other.
  function renderIns() {
    if (!cur) return;
    var show = cur.show, ins = cur.ins;
    $("ins-box").hidden = show === "book";
    if (show === "book") return;
    $("ins-lbl").textContent = t(show === "open" ? "sec.ins" : "sec.scr");
    $("ins-hint").textContent = t(show === "open" ? "ins.hintOpen" : "ins.hintEbook");
    var ul = $("ins-slots");
    ul.textContent = "";
    (show === "open" ? ["l", "r"] : ["scr"]).forEach(function (k) {
      ul.appendChild(slotRow(t("slot." + k), ins[k], function (id) { change("art", function (p) { p.ins[k] = id; }); }));
    });
    setVal("f-pdfp", ins.pdfp);
    $("curl-box").hidden = show !== "open";
    setVal("f-rule", ins.rule);
    setVal("f-curl", ins.curl); out("curl-out", Math.round(ins.curl * 100) + "%");
    out("pdf-info", pdfDoc ? t("pdf.info", { name: pdfName, n: pdfDoc.numPages }) : "");
  }
  var pdfDoc = null, pdfName = "";
  // PDF.js is an ES module that sets window.pdfjsLib (as in Layout).
  var pdfP = null;
  function pdfLib() {
    if (!pdfP) pdfP = new Promise(function (res, rej) {
      if (window.pdfjsLib) { res(window.pdfjsLib); return; }
      var n = document.createElement("script");
      n.type = "module"; n.src = "../vendor/pdfjs/pdf.min.js" + VQ;
      n.onload = function () { if (window.pdfjsLib) res(window.pdfjsLib); else rej(new Error("pdfjs")); };
      n.onerror = function () { rej(new Error("pdfjs")); };
      document.head.appendChild(n);
    }).then(function (L) {
      L.GlobalWorkerOptions.workerSrc = "../vendor/pdfjs/pdf.worker.min.js" + VQ;
      return L;
    }, function (e) { pdfP = null; throw e; });
    return pdfP;
  }
  function pickPdf() {
    if (!cur || busy) return;
    if (!AS || !fsApi()) { toast(t("toast.nofs")); return; }
    var s = shell(), dlg = null;
    try { dlg = s && s.orosDialog; } catch (e) {}
    if (dlg && typeof dlg.openFile === "function") {
      dlg.openFile("application/pdf").then(function (f) { if (f) openPdf(f); });
      return;
    }
    var inp = $("pdf-in");
    inp.value = "";
    inp.onchange = function () { var f = inp.files && inp.files[0]; if (f) openPdf(f); };
    inp.click();
  }
  function openPdf(f) {
    toast(t("pdf.busy"));
    setBusy(true);
    Promise.all([pdfLib(), f.arrayBuffer()]).then(function (r) {
      return r[0].getDocument({ data: new Uint8Array(r[1]), isEvalSupported: false, enableXfa: false, disableAutoFetch: true, disableStream: true }).promise;
    }).then(function (doc) {
      if (pdfDoc) try { pdfDoc.destroy(); } catch (e) {}
      pdfDoc = doc; pdfName = String(f.name || "PDF").slice(0, 80);
      setBusy(false);
      pdfPages(Math.min(cur.ins.pdfp || 1, doc.numPages));
    }).catch(function (e) {
      console.warn("[orOS Mockups] pdf", e);
      setBusy(false);
      toast(t("pdf.fail"));
    });
  }
  // Page n (and n + 1 for an open book) → pictures on the orOS disk.
  function pdfPage(n) {
    return pdfDoc.getPage(n).then(function (pg) {
      var vp0 = pg.getViewport({ scale: 1 }), k = Math.min(4, 2000 / vp0.height, 2000 / vp0.width);
      var vp = pg.getViewport({ scale: k }), cv = document.createElement("canvas");
      cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
      var ctx = cv.getContext("2d");
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, cv.width, cv.height);
      return pg.render({ canvasContext: ctx, viewport: vp }).promise.then(function () {
        return importCanvas(cv, fileBase() + " p" + n);
      });
    });
  }
  function pdfPages(n) {
    if (!pdfDoc || !cur || busy) return;
    var N = pdfDoc.numPages, a = Math.max(1, Math.min(N, n)), two = cur.show === "open" && a + 1 <= N;
    toast(t("pdf.busy"));
    setBusy(true);
    pdfPage(a).then(function (ia) {
      return (two ? pdfPage(a + 1) : Promise.resolve("")).then(function (ib) { return [ia, ib]; });
    }).then(function (r) {
      setBusy(false);
      change("art", function (p) {
        p.ins.pdfp = a;
        if (p.show === "open") { p.ins.l = r[0]; p.ins.r = r[1] || ""; }
        else p.ins.scr = r[0];
      });
      toast(two ? t("toast.pdfPages", { a: a, b: a + 1 }) : t("toast.pdfPage", { a: a }));
    }).catch(function (e) {
      console.warn("[orOS Mockups] pdf page", e);
      setBusy(false);
      toast(t("pdf.fail"));
    });
  }

  // ---------- 6. Save the picture, Pictures, Atelier ----------
  var MIME = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };
  function fileBase() {
    var n = (cur.nm || t("untitled")).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
    return n || "mockup";
  }
  // → Promise<Blob>. o: { cam } (another camera, for all angles)
  function makeBlob(fmt, o) {
    if (!stage || !cur) return Promise.reject(new Error("nostage"));
    var sz = C.outSize(cur.out), clear = cur.sc.bg.k === "none";
    return new Promise(function (res, rej) {
      setTimeout(function () {
        try {
          var cv = stage.snapshot(sz.w, sz.h, false, o).canvas;
          if (fmt === "jpg" && clear) {
            var c2 = document.createElement("canvas"); c2.width = cv.width; c2.height = cv.height;
            var x = c2.getContext("2d"); x.fillStyle = "#ffffff"; x.fillRect(0, 0, c2.width, c2.height); x.drawImage(cv, 0, 0);
            cv = c2;
          }
          cv.toBlob(function (b) { if (b) res(b); else rej(new Error("encode")); }, MIME[fmt], fmt === "png" ? undefined : 0.92);
        } catch (e) { rej(e); }
      }, 30);
    });
  }
  function savePicture() {
    if (!cur) return;
    if (saveTimer) saveNow();
    var fmt = cur.out.fmt, name = fileBase() + "." + fmt;
    toast(t("toast.making"));
    makeBlob(fmt).then(function (blob) { return saveBlob(blob, name, MIME[fmt]); }, function () { toast(t("toast.makeFail")); });
  }
  // The shell's save dialog, else a download.
  function saveBlob(blob, name, mime) {
    var s = shell(), dlg = null;
    try { dlg = s && s.orosDialog; } catch (e) {}
    if (dlg && typeof dlg.saveFile === "function") {
      return dlg.saveFile({ blob: blob, filename: name, mime: mime }).then(function (r) { if (r && r.ok) toast(t("toast.saved")); });
    }
    var a = document.createElement("a"), u = URL.createObjectURL(blob);
    a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(u); }, 40000);
    toast(t("toast.saved"));
    return Promise.resolve();
  }
  // A free path in a folder of the orOS disk: "<base>.ext", "<base> (1).ext"…
  function freePath(dir, base, ext) {
    var F = fsApi();
    function tryName(n) {
      var p = dir + "/" + (n ? base + " (" + n + ")" : base) + ext;
      return F.stat(p).then(function () { return n < 99 ? tryName(n + 1) : Promise.reject(new Error("name")); }, function () { return p; });
    }
    return tryName(0);
  }
  function saveToPictures() {
    if (!cur) return;
    var F = fsApi();
    if (!F) { toast(t("toast.nofs")); return; }
    var fmt = cur.out.fmt, base = fileBase(), ext = "." + fmt;
    toast(t("toast.making"));
    makeBlob(fmt).then(function (blob) {
      return freePath("/internal/Pictures", base, ext).then(function (p) {
        return F.write(p, blob).then(function () { toast(t("toast.pics", { name: p.split("/").pop() })); });
      });
    }).catch(function () { toast(t("toast.picsFail")); });
  }
  // Bridge BR-MK-AT: the picture goes onto the orOS disk and Atelier
  // makes a new design of its size with it:
  // __orosOpenAt("atelier", { newPicture: { path, w, h, name } }).
  function openInAtelier() {
    var s = shell();
    if (!cur) return;
    if (!s || typeof s.__orosOpenAt !== "function") { toast(t("standalone")); return; }
    if (!AS || !fsApi()) { toast(t("toast.nofs")); return; }
    toast(t("toast.making"));
    makeBlob("png").then(function (blob) {
      var f;
      try { f = new File([blob], fileBase() + ".png", { type: "image/png" }); } catch (e) { f = blob; f.name = fileBase() + ".png"; }
      return AS.importFile(f).then(function (r) {
        s.__orosOpenAt("atelier", { newPicture: { path: AS.FOLDER + "/" + r.id, w: r.w, h: r.h, name: label(cur) } });
        toast(t("toast.atelier"));
      });
    }).catch(function () { toast(t("toast.makeFail")); });
  }

  // Libraries that load only when asked for (same ?v= as this file).
  var VQ = (function () {
    var sc = document.currentScript, m = sc && /\?v=[^&#]+/.exec(sc.src || "");
    return m ? m[0] : "";
  })();
  var scriptP = {};
  function loadScript(src) {
    if (!scriptP[src]) scriptP[src] = new Promise(function (res, rej) {
      var n = document.createElement("script");
      n.src = src + VQ;
      n.onload = res;
      n.onerror = function () { delete scriptP[src]; n.remove(); rej(new Error("script")); };
      document.head.appendChild(n);
    });
    return scriptP[src];
  }
  function pause() { return new Promise(function (r) { setTimeout(r, 0); }); }

  // Long jobs (all angles, turntable): the form and the camera wait.
  var busy = false;
  function setBusy(on) {
    busy = on;
    $("panel").classList.toggle("busy", on);
    ["save-btn", "pics-btn", "atelier-btn", "angles-zip", "angles-pics", "mo-make", "more-btn", "back-btn", "new-btn",
     "tpl-png", "tpl-pdf", "tpl-pics", "tpl-atelier", "pdf-pick"].forEach(function (id) { $(id).disabled = on; });
    if (!on && stage) stage.render();
  }

  // All seven ready views, in the picture's size and format.
  function allAngles(toPics) {
    if (!cur || !stage || busy) return;
    if (saveTimer) saveNow();
    var fmt = cur.out.fmt, base = fileBase(), F = fsApi(), files = [];
    if (toPics && !F) { toast(t("toast.nofs")); return; }
    toast(t("toast.angles", { n: VIEWS.length }));
    setBusy(true);
    var chain = Promise.resolve();
    VIEWS.forEach(function (v, i) {
      chain = chain.then(function () {
        var c = cur.sc.cam;
        var cam = Object.assign({}, c, { th: v.th, ph: v.ph, dx: 0, dy: 0, fov: v.fov || (c.fov > 40 ? 30 : c.fov) });
        return makeBlob(fmt, { cam: cam }).then(function (b) {
          files.push({ name: (i + 1) + " " + t("view." + v.k) + "." + fmt, blob: b });
        });
      });
    });
    chain.then(function () {
      if (toPics) {
        var dirName = t("dir.angles", { name: base });
        return freePath("/internal/Pictures", dirName, "").then(function (dir) {
          var w = Promise.resolve();
          files.forEach(function (f) { w = w.then(function () { return F.write(dir + "/" + f.name, f.blob); }); });
          return w.then(function () { toast(t("toast.anglesPics", { n: files.length, name: dir.split("/").pop() })); });
        });
      }
      return loadScript("../atelier/zip.js").then(function () {
        var Z = window.AtelierZip;
        if (!Z) throw new Error("zip");
        return Promise.all(files.map(function (f) {
          return f.blob.arrayBuffer().then(function (ab) { return { name: f.name, data: new Uint8Array(ab) }; });
        })).then(function (list) {
          var zip = new Blob([Z.write(list, new Date())], { type: "application/zip" });
          return saveBlob(zip, base + " · " + t("sec.angles") + ".zip", "application/zip");
        });
      });
    }).catch(function () { toast(t("toast.makeFail")); }).then(function () { setBusy(false); });
  }

  // Turntable: the set turns (all round or to and fro) under the
  // camera, frame by frame, into MP4 / WebM (Mediabunny, WebCodecs)
  // or a GIF (atelier/gif.js). Nothing leaves the device.
  var moStop = false, moResult = null;
  function clearMotion() { moResult = null; $("mo-done").hidden = true; }
  function pickVideo(M, w, h) {
    return M.getFirstEncodableVideoCodec(["avc"], { width: w, height: h, bitrate: M.QUALITY_HIGH }).then(function (vc) {
      if (vc) return { ext: "mp4", mime: "video/mp4", vc: vc };
      return M.getFirstEncodableVideoCodec(["vp9", "vp8", "av1"], { width: w, height: h, bitrate: M.QUALITY_HIGH }).then(function (vc2) {
        return vc2 ? { ext: "webm", mime: "video/webm", vc: vc2 } : null;
      });
    });
  }
  function makeMotion() {
    if (!cur || !stage || busy) return;
    if (saveTimer) saveNow();
    clearMotion();
    var mo = cur.out.mo, sz = C.motionSize(cur.out), plan = C.motionPlan(cur.out), f = stage.fit(sz.w, sz.h);
    var w = f.w - f.w % 2, h = f.h - f.h % 2, gif = mo.fmt === "gif";
    if (!gif && typeof window.VideoEncoder === "undefined") { toast(t("toast.noVideo")); return; }
    var cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    var ctx = cv.getContext("2d", gif ? { willReadFrequently: true } : undefined);
    var under = cur.sc.bg.k === "none" ? "#ffffff" : "";
    function draw(i) { stage.drawTo(ctx, w, h, false, { spin: plan.turn(i), under: under }); }
    function progress(k) { $("mo-prog").value = k; $("mo-prog").textContent = t("mo.making", { pc: Math.round(k * 100) }); }
    moStop = false;
    setBusy(true);
    $("mo-run").hidden = false;
    progress(0);
    var t0 = performance.now(), job;
    if (gif) {
      job = loadScript("../atelier/gif.js").then(function () {
        var G = window.AtelierGif, frames = [], i = 0;
        if (!G) throw new Error("lib");
        function next() {
          if (moStop) throw new Error("stop");
          if (i >= plan.n) {
            var bytes = G.encode({ w: w, h: h, frames: frames, loop: 0 });
            return { blob: new Blob([bytes], { type: "image/gif" }), ext: "gif", mime: "image/gif", gif: true };
          }
          draw(i);
          frames.push({ idx: G.quantize(ctx.getImageData(0, 0, w, h).data, w, h), delay: 100 / plan.fps });
          i++; progress(i / plan.n);
          return pause().then(next);
        }
        return next();
      });
    } else {
      job = loadScript("../vendor/mediabunny.min.js").then(function () {
        var M = window.Mediabunny;
        if (!M) throw new Error("lib");
        return pickVideo(M, w, h).then(function (fmt) {
          if (!fmt) throw new Error("novideo");
          var target = new M.BufferTarget();
          var output = new M.Output({ format: fmt.ext === "mp4" ? new M.Mp4OutputFormat({ fastStart: "in-memory" }) : new M.WebMOutputFormat(), target: target });
          var src = new M.CanvasSource(cv, { codec: fmt.vc, bitrate: M.QUALITY_HIGH, keyFrameInterval: 2 });
          output.addVideoTrack(src, { frameRate: plan.fps });
          var i = 0;
          function next() {
            if (moStop) throw new Error("stop");
            if (i >= plan.n) return output.finalize();
            draw(i);
            return src.add(i / plan.fps, 1 / plan.fps).then(function () {
              i++; progress(i / plan.n);
              return i % 4 ? next() : pause().then(next);
            });
          }
          return output.start().then(next).then(function () {
            return { blob: new Blob([target.buffer], { type: fmt.mime }), ext: fmt.ext, mime: fmt.mime, gif: false };
          }, function (e) {
            return Promise.resolve().then(function () { return output.cancel(); }).catch(function () {}).then(function () { throw e; });
          });
        });
      });
    }
    job.then(function (r) {
      r.name = fileBase() + "." + r.ext;
      moResult = r;
      var mb = r.blob.size / 1048576;
      $("mo-done-info").textContent = t("mo.done", {
        kind: r.gif ? "GIF" : r.ext.toUpperCase(),
        size: (mb >= 1 ? fmtNum(mb, 1) + " MB" : Math.max(1, Math.round(r.blob.size / 1024)) + " KB"),
        sec: fmtNum((performance.now() - t0) / 1000, 1)
      });
      $("mo-keep").textContent = t(r.gif ? "btn.moPics" : "btn.moVideos");
      $("mo-save").textContent = t("btn.moSave");
      $("mo-done").hidden = false;
    }, function (e) {
      var m = e && e.message;
      toast(m === "stop" ? t("toast.moStop") : m === "novideo" ? t("toast.noVideo") : t("toast.moFail"));
      if (m !== "stop") console.warn("[orOS Mockups] turntable", e);
    }).then(function () {
      $("mo-run").hidden = true;
      setBusy(false);
    });
  }
  function saveMotion() { if (moResult) saveBlob(moResult.blob, moResult.name, moResult.mime); }
  function keepMotion() {
    var r = moResult, F = fsApi();
    if (!r) return;
    if (!F) { toast(t("toast.nofs")); return; }
    var dir = r.gif ? "/internal/Pictures" : "/internal/Videos";
    freePath(dir, fileBase(), "." + r.ext).then(function (p) {
      return F.write(p, r.blob).then(function () { toast(t(r.gif ? "toast.pics" : "toast.videos", { name: p.split("/").pop() })); });
    }).catch(function () { toast(t("toast.picsFail")); });
  }

  // Free background photos (Openverse, Wikimedia Commons): searched
  // from the browser, downloaded once onto the orOS disk with their
  // credit, so the mockup works offline afterwards.
  var find = { q: "", src: "", page: 1, items: [], more: false, busy: false, err: "", seq: 0 };
  var findMem = {};
  var findCache = {
    get: function (k) { return Promise.resolve(findMem[k] || null); },
    put: function (k, v) { findMem[k] = v; return Promise.resolve(); }
  };
  function findEnv() { return { fetch: window.fetch.bind(window), now: function () { return Date.now(); }, cache: findCache, keys: {} }; }
  function findSources() { return MEDIA ? MEDIA.sourcesFor("photo", {}) : []; }
  function openFind() {
    if (!MEDIA) return;
    if (!find.src) find.src = findSources()[0] || "";
    showDlg("find");
    renderFind();
    setTimeout(function () { try { $("find-q").focus(); } catch (e) {} }, 0);
  }
  function renderFind() {
    var srcs = $("find-srcs");
    srcs.textContent = "";
    findSources().forEach(function (id) {
      var b = el("button", null, MEDIA.SOURCES[id].name);
      b.type = "button"; b.setAttribute("role", "radio"); b.setAttribute("data-v", id);
      b.addEventListener("click", function () { if (find.src !== id) { find.src = id; renderFind(); if (find.q) findRun(false); } });
      srcs.appendChild(b);
    });
    setSeg("find-srcs", find.src);
    var msg = !navigator.onLine ? t("find.offline")
      : find.err ? t(find.err === "rate" ? "find.rate" : find.err === "offline" ? "find.offline" : "find.err")
      : find.busy ? t("find.busy")
      : !find.q ? t("find.intro")
      : !find.items.length ? t("find.none") : "";
    $("find-msg").textContent = msg;
    $("find-msg").hidden = !msg;
    var grid = $("find-grid");
    grid.textContent = "";
    find.items.forEach(function (it) {
      var b = el("button", "find-tile");
      b.type = "button";
      var L = MEDIA.licenseOf(it.lic, it.licVer), lab = (it.title || "") + (it.author ? " · " + it.author : "") + (L ? " · " + L.label : "");
      b.title = lab; b.setAttribute("aria-label", lab);
      var img = el("img");
      img.alt = ""; img.loading = "lazy"; img.decoding = "async"; img.referrerPolicy = "no-referrer";
      img.src = it.thumb || it.full;
      b.appendChild(img);
      b.addEventListener("click", function () { placeFind(it, b); });
      grid.appendChild(b);
    });
    $("find-more").hidden = !(find.more && !find.busy && find.items.length);
  }
  function findRun(more) {
    var q = ($("find-q").value || "").trim().slice(0, 120);
    if (!more) { find.q = q; find.page = 1; find.items = []; find.more = false; }
    if (!find.q || !find.src || !MEDIA) { renderFind(); return; }
    var my = ++find.seq;
    find.busy = true; find.err = "";
    renderFind();
    MEDIA.search(find.src, "photo", find.q, { page: find.page, restricted: false, lang: LANG2 }, findEnv()).then(function (res) {
      if (my !== find.seq) return;
      find.busy = false;
      find.err = res.error || "";
      find.items = find.items.concat((res.items || []).filter(function (it) { return MEDIA.allowed(it, { restricted: false }); }));
      find.more = !!res.more;
      renderFind();
    }, function () {
      if (my !== find.seq) return;
      find.busy = false; find.err = "server";
      renderFind();
    });
  }
  function placeFind(it, tile) {
    if (!AS || !fsApi()) { toast(t("toast.nofs")); return; }
    if (!navigator.onLine) { toast(t("find.offline")); return; }
    tile.disabled = true;
    toast(t("find.getting"));
    var E = findEnv();
    MEDIA.fetchMedia(it, E).then(null, function (e) {
      // a library's full file may refuse CORS: the thumbnail is the fallback
      if (it.thumb && it.thumb !== it.full && e && e.message === "offline") return MEDIA.fetchMedia(it, E, it.thumb);
      throw e;
    }).then(function (blob) {
      var ext = blob.type === "image/png" ? ".png" : ".jpg";
      return AS.importFile(new File([blob], (it.title || it.src).slice(0, 60) + ext, { type: blob.type }));
    }).then(function (r) {
      var cr = MEDIA.normCredit(it);
      change("scene", function (p) { p.sc.bg.k = "photo"; p.sc.bg.img = r.id; p.sc.bg.cr = cr; });
      hideDlg();
      toast(t("find.added"));
    }, function (e) {
      var m = e && e.message;
      tile.disabled = false;
      toast(m === "nofs" ? t("toast.nofs") : m === "size" ? t("find.big") : m === "offline" ? t("find.offline") : t("find.fail"));
    });
  }

  // ---------- 6b. Cover sheet for the printer (Print tab) ----------
  // MockCore.template() gives the numbers, MockPrint draws them: a
  // live flat preview over the 3D view, a 300 dpi PNG or PDF (with
  // the guides, or the finished cover with its bleed), Pictures, or
  // a new Atelier design of the sheet's size (BR-MK-TPL).
  var MP = window.MockPrint;
  function tplLen(mm) { return cur && cur.unit === "in" ? fmtNum(mm / C.MM_PER_IN, 3) + "″" : fmtNum(mm, 2) + " mm"; }
  var curSheet = "";
  function sheetOf(p) { var l = C.sheetsOf(p); return l.indexOf(curSheet) >= 0 ? curSheet : l[0]; }
  // A product's full wrap is its first sheet only.
  function artFor(p) {
    if (!isG(p) || p.art.mode !== "wrap" || sheetOf(p) === C.sheetsOf(p)[0]) return p.art;
    return Object.assign({}, p.art, { mode: "parts" });
  }
  function tplOf(p) { return isG(p) ? C.templateOf(p, sheetOf(p)) : C.template(p.bk, p.art, p.tpl); }
  function tplLabels(p, T) {
    if (isG(p)) return {
      name: function (k) { var own = "slot." + p.kind + "." + k; return t(own) !== own ? t(own) : t("slot." + k); }, len: tplLen, bar: t("tpl.bar"),
      info: t("tpl.goodInfo", { kind: t("tpl.kind." + T.kind), tw: tplLen(T.W), th: tplLen(T.H), b: tplLen(T.bleed) })
    };
    return {
      name: function (k) { return t("slot." + k); }, len: tplLen, bar: t("tpl.bar"),
      info: t("tpl.canvasInfo", { kind: t("tpl.kind." + T.kind), tw: tplLen(T.W), th: tplLen(T.H), s: tplLen(T.spine), pages: p.bk.pages, b: tplLen(T.bleed) })
    };
  }
  var legendKind = "";
  function renderGoodTpl() {
    var T = tplOf(cur), o = cur.tpl, sel = $("f-sheet"), list = C.sheetsOf(cur), sh = sheetOf(cur);
    if (sel.getAttribute("data-k") !== list.join(",") + LANG) {
      sel.textContent = "";
      list.forEach(function (k) { var op = el("option", null, t("tpl.kind." + C.templateOf(cur, k).kind)); op.value = k; sel.appendChild(op); });
      sel.setAttribute("data-k", list.join(",") + LANG);
    }
    setVal("f-sheet", sh);
    $("tpl-hint").textContent = t("tpl.hintGood");
    out("tpl-kind", t("tpl.kind." + T.kind));
    out("tpl-info", T.circle && T.circle.fold
      ? t("tpl.badgeInfo", { cut: tplLen(T.W), d: tplLen(T.circle.fold) })
      : T.ink ? t("tpl.inkInfo", { w: tplLen(T.W), h: tplLen(T.H) })
      : T.cut ? t("tpl.cutInfo", { w: tplLen(T.sheet.w), h: tplLen(T.sheet.h), tw: tplLen(T.W), th: tplLen(T.H) })
      : T.circle
      ? t("tpl.discInfo", { d: tplLen(T.W), p: tplLen(T.circle.print), hub: tplLen(T.circle.hub), hole: tplLen(T.circle.hole) })
      : t("tpl.info", { w: tplLen(T.sheet.w), h: tplLen(T.sheet.h), tw: tplLen(T.W), th: tplLen(T.H), s: tplLen(T.spine) }));
    var ul = $("tpl-parts");
    ul.textContent = "";
    if (!T.circle && !T.cut && !T.ink) T.parts.forEach(function (p) { ul.appendChild(el("li", null, t("slot." + p.k) + " " + tplLen(p.w))); });
    out("tpl-spine", t("tpl.goodNote." + T.kind) !== "tpl.goodNote." + T.kind ? t("tpl.goodNote." + T.kind) : "");
    $("tpl-warn").hidden = true;
    $("tbleed-lbl").textContent = t("f.tbleed");
    setVal("f-tbleed", T.bleed);
    $("f-tbleed").disabled = !!T.circle || !!T.ink;
    setVal("f-safe", o.safe);
    setChk("f-tart", o.art); setChk("f-tgd", o.gd);
    var lk = T.circle ? (T.circle.fold ? "badge" : "disc") : T.cut ? "cut" : "flat";
    if (legendKind !== lk) {
      legendKind = lk;
      var lg = $("legend"), K = MP ? MP.COL : {};
      lg.textContent = "";
      (lk === "badge" ? [["bleed", "lg.noprint", ""], ["trim", "lg.badgeCut", "solid"], ["hinge", "lg.badgeFace", "line"], ["safe", "lg.safe", "line"]]
        : lk === "disc" ? [["bleed", "lg.noprint", ""], ["trim", "lg.discEdge", "solid"], ["fold", "lg.discOut", "line"], ["safe", "lg.safe", "line"]]
        : lk === "cut" ? [["bleed", "lg.cutAway", ""], ["trim", "lg.cutLine", "solid"], ["safe", "lg.safe", ""]]
        : [["bleed", "lg.bleed", ""], ["trim", "lg.trim", "solid"], ["fold", "lg.fold", "line"], ["safe", "lg.safe", "line"]]).forEach(function (x) {
        var li = el("li"), i = el("i", x[2] === "line" ? "line" : null);
        if (x[2] === "line") i.style.color = K[x[0]]; else if (x[2] === "solid") { i.style.height = "0"; i.style.borderTop = "2px solid " + K[x[0]]; } else i.style.background = K[x[0]];
        li.appendChild(i); li.appendChild(el("span", null, t(x[1])));
        lg.appendChild(li);
      });
    }
  }
  function renderTpl() {
    if (isG(cur)) { renderGoodTpl(); return; }
    $("f-tbleed").disabled = false;
    $("tpl-hint").textContent = t("tpl.hint");
    var T = tplOf(cur), b = cur.bk, o = cur.tpl;
    out("tpl-kind", t("tpl.kind." + T.kind));
    out("tpl-info", t("tpl.info", { w: tplLen(T.sheet.w), h: tplLen(T.sheet.h), tw: tplLen(T.W), th: tplLen(T.H), s: tplLen(T.spine) }));
    var ul = $("tpl-parts");
    ul.textContent = "";
    T.parts.forEach(function (p) { if (p.k !== "gap") ul.appendChild(el("li", null, t("slot." + p.k) + " " + tplLen(p.w))); });
    var cal = b.paper === "custom" ? b.cal : C.paperOf(b.paper).c;
    out("tpl-spine", T.kind === "ss" ? t("tpl.spineSs") : T.kind === "sp" ? t("tpl.spineSp")
      : T.kind === "bb" ? t("tpl.spineBb", { s: tplLen(T.spine) })
      : T.kind !== "pb" ? t("tpl.spineHand", { s: tplLen(T.spine) })
      : b.spine ? t("tpl.spinePb", { s: tplLen(T.spine) }) : t("tpl.spine", { s: tplLen(T.spine), pages: b.pages, cal: fmtNum(cal, 4) }));
    var w = T.warn.filter(function (k) { return k !== "nobar" || o.bar; }).map(function (k) { return t("warn." + k); });
    $("tpl-warn").hidden = !w.length;
    out("tpl-warn", w.join(" "));
    $("tbleed-lbl").textContent = t(T.kind === "case" ? "f.twrap" : "f.tbleed");
    setVal("f-tbleed", T.bleed);
    setVal("f-safe", o.safe);
    setChk("f-tbar", o.bar); setChk("f-tart", o.art); setChk("f-tgd", o.gd);
    if (legendKind !== T.kind) {
      legendKind = T.kind;
      var lg = $("legend"), K = MP ? MP.COL : {};
      lg.textContent = "";
      [["bleed", T.kind === "case" ? "lg.wrap" : "lg.bleed", ""], ["trim", "lg.trim", "solid"], ["fold", "lg.fold", "line"],
       ["hinge", "lg.hinge", "line"], ["safe", "lg.safe", "line"], ["punch", "lg.punch", ""]].forEach(function (x) {
        if (x[0] === "hinge" && T.kind !== "case") return;
        if (x[0] === "fold" && T.kind === "sp") return;
        if (x[0] === "punch" && T.kind !== "sp") return;
        var li = el("li"), i = el("i", x[2] === "line" ? "line" : null);
        if (x[2] === "line") i.style.color = K[x[0]]; else if (x[2] === "solid") { i.style.height = "0"; i.style.borderTop = "2px solid " + K[x[0]]; } else i.style.background = K[x[0]];
        li.appendChild(i); li.appendChild(el("span", null, t(x[1])));
        lg.appendChild(li);
      });
    }
  }
  // Pictures of the first book: slot → picture.
  function slotPics(p) {
    var pics = {};
    return Promise.all((isG(p) ? C.goodSlots(p.kind) : C.SLOTS).map(function (k) {
      return loadImg(p.art[k]).then(function (img) { if (img) pics[k] = img; });
    })).then(function () { return pics; });
  }
  var flatRaf = 0, flatSeq = 0;
  function drawFlat() {
    if (!cur || !MP || $("flat-box").hidden || flatRaf) return;
    flatRaf = requestAnimationFrame(function () {
      flatRaf = 0;
      if (!cur) return;
      var p = clone(cur), seq = ++flatSeq;
      slotPics(p).then(function (pics) {
        if (seq !== flatSeq || !cur) return;
        var box = $("flat-box"), T = tplOf(p);
        var bw = box.clientWidth - 24, bh = box.clientHeight - 24;
        if (bw < 20 || bh < 20) return;
        var dpr = Math.min(2, window.devicePixelRatio || 1), k = Math.min(bw / T.sheet.w, bh / T.sheet.h);
        var cv = MP.render(T, artFor(p), pics, k * dpr, { art: !!p.tpl.art, guides: !!p.tpl.gd, white: true, L: tplLabels(p, T) });
        var fl = $("flat");
        fl.width = cv.width; fl.height = cv.height;
        fl.getContext("2d").drawImage(cv, 0, 0);
        fl.style.width = Math.round(T.sheet.w * k) + "px"; fl.style.height = Math.round(T.sheet.h * k) + "px";
        fl.setAttribute("aria-label", t("tpl.kind." + T.kind) + ", " + tplLen(T.sheet.w) + " × " + tplLen(T.sheet.h));
        // a die cut: what the outline found (no see-through background, pieces apart)
        if (T.cut) {
          var w = (cv.cut && cv.cut.warn || []).map(function (k) { return t("warn." + k); });
          $("tpl-warn").hidden = !w.length;
          out("tpl-warn", w.join(" "));
        }
      });
    });
  }
  function canvasBlob(cv, mime, q) {
    return new Promise(function (res, rej) { cv.toBlob(function (b) { if (b) res(b); else rej(new Error("encode")); }, mime, q); });
  }
  function tplName() {
    if (isG(cur)) return t(cur.tpl.gd ? "file.tpl" : "file.cover", { name: fileBase() + " " + t("tpl.kind." + tplOf(cur).kind) }).replace(/[\\/:*?"<>|]+/g, " ").slice(0, 120);
    return t(cur.tpl.gd ? "file.tpl" : "file.cover", { name: fileBase() }).replace(/[\\/:*?"<>|]+/g, " ").slice(0, 120);
  }
  // kind: "png" | "pdf" | "pics" (PNG in Pictures)
  function tplSave(kind) {
    if (!cur || busy || !MP) return;
    if (saveTimer) saveNow();
    var F = fsApi();
    if (kind === "pics" && !F) { toast(t("toast.nofs")); return; }
    var p = clone(cur), T = tplOf(p), name = tplName();
    toast(t("toast.making"));
    setBusy(true);
    var job = slotPics(p).then(function (pics) {
      return MP.render(T, artFor(p), pics, MP.ppmFor(T, 300), { art: !!p.tpl.art, guides: !!p.tpl.gd, white: true, L: tplLabels(p, T) });
    });
    if (kind === "pdf") {
      job = Promise.all([job, loadScript("../vendor/jspdf.umd.min.js")]).then(function (r) {
        var J = window.jspdf && window.jspdf.jsPDF;
        if (!J) throw new Error("jspdf");
        return MP.pdf(J, r[0], T, name).output("blob");
      });
    } else job = job.then(function (cv) { return canvasBlob(cv, "image/png"); });
    job.then(function (blob) {
      if (kind === "pics") {
        return freePath("/internal/Pictures", name, ".png").then(function (path) {
          return F.write(path, blob).then(function () { toast(t("toast.pics", { name: path.split("/").pop() })); });
        });
      }
      return saveBlob(blob, name + "." + (kind === "pdf" ? "pdf" : "png"), kind === "pdf" ? "application/pdf" : "image/png");
    }).catch(function (e) {
      console.warn("[orOS Mockups] template", e);
      toast(t("toast.tplFail"));
    }).then(function () { setBusy(false); });
  }
  function importCanvas(cv, base) {
    return canvasBlob(cv, "image/png").then(function (blob) {
      var f;
      try { f = new File([blob], base + ".png", { type: "image/png" }); } catch (e) { f = blob; f.name = base + ".png"; }
      return AS.importFile(f).then(function (r) { return r.id; });
    });
  }
  // A new Atelier design of the sheet's trim with its bleed: the
  // cover picture (when "With my cover pictures" is on) and the
  // guides on top, seen only in Atelier's editor.
  function tplAtelier() {
    var s = shell();
    if (!cur || busy || !MP) return;
    if (!s || typeof s.__orosOpenAt !== "function") { toast(t("standalone")); return; }
    if (!AS || !fsApi()) { toast(t("toast.nofs")); return; }
    if (saveTimer) saveNow();
    var p = clone(cur), T = tplOf(p);
    toast(t("toast.making"));
    setBusy(true);
    slotPics(p).then(function (pics) {
      var ppm = MP.ppmFor(T, 300), base = fileBase();
      return importCanvas(MP.render(T, artFor(p), pics, ppm, { guides: true, L: tplLabels(p, T) }), base + " guides").then(function (g) {
        if (!p.tpl.art) return [g, ""];
        return importCanvas(MP.render(T, artFor(p), pics, ppm, { art: true }), base + " cover").then(function (a) { return [g, a]; });
      });
    }).then(function (r) {
      s.__orosOpenAt("atelier", { newTemplate: {
        guides: AS.FOLDER + "/" + r[0], art: r[1] ? AS.FOLDER + "/" + r[1] : "",
        w: T.W, h: T.H, bleed: T.bleed, name: label(p)
      } });
      toast(t("toast.tplAtelier"));
    }).catch(function (e) {
      console.warn("[orOS Mockups] template to Atelier", e);
      toast(t("toast.tplFail"));
    }).then(function () { setBusy(false); });
  }
  function wireTpl() {
    $("f-tbleed").addEventListener("change", function () {
      var v = parseNum($("f-tbleed").value);
      if (!(v >= 0)) { renderTpl(); return; }
      change("art", function (p) { p.art.bleed = Math.min(25, v); });
    });
    $("f-safe").addEventListener("change", function () {
      var v = parseNum($("f-safe").value);
      if (!(v >= 0)) { renderTpl(); return; }
      change("tpl", function (p) { p.tpl.safe = Math.min(20, v); });
    });
    [["f-tbar", "bar"], ["f-tart", "art"], ["f-tgd", "gd"]].forEach(function (x) {
      $(x[0]).addEventListener("change", function () { var on = $(x[0]).checked ? 1 : 0; change("tpl", function (p) { p.tpl[x[1]] = on; }); });
    });
    $("f-sheet").addEventListener("change", function () { curSheet = $("f-sheet").value; legendKind = ""; renderTpl(); drawFlat(); });
    $("tpl-png").addEventListener("click", function () { tplSave("png"); });
    $("tpl-pdf").addEventListener("click", function () { tplSave("pdf"); });
    $("tpl-pics").addEventListener("click", function () { tplSave("pics"); });
    $("tpl-atelier").addEventListener("click", tplAtelier);
    if (typeof ResizeObserver === "function") new ResizeObserver(function () { drawFlat(); }).observe($("flat-box"));
  }

  // ---------- 7. Dialogs ----------
  var openDlg = null, lastFocus = null, askYes = null;
  function showDlg(id) {
    if (openDlg) hideDlg();
    lastFocus = document.activeElement;
    openDlg = $(id);
    $("scrim").hidden = false;
    openDlg.hidden = false;
    var f = openDlg.querySelector("button:not(.dlg-close)") || openDlg.querySelector("button");
    if (f) f.focus();
  }
  function hideDlg() {
    if (!openDlg) return;
    openDlg.hidden = true;
    $("scrim").hidden = true;
    openDlg = null;
    if (lastFocus && lastFocus.focus) try { lastFocus.focus(); } catch (e) {}
  }
  function ask(text, yesLabel, fn) {
    $("ask-text").textContent = text;
    $("ask-yes").textContent = yesLabel;
    askYes = fn;
    showDlg("ask");
  }
  function duplicate() {
    hideDlg();
    if (!cur) return;
    if (saveTimer) saveNow();
    var src = clone(cur);
    if (isG(src)) {
      newPrj(function (p) {
        p.g = src.g; p.art = src.art; p.sc = src.sc; p.out = src.out; p.unit = src.unit; p.tpl = src.tpl;
        p.nm = (label(src) + " " + t("copyOf")).slice(0, 80);
      }, src.kind);
      toast(t("toast.dup"));
      return;
    }
    newPrj(function (p) {
      p.bk = src.bk; p.art = src.art; p.sc = src.sc; p.out = src.out; p.unit = src.unit; p.set = src.set; p.tpl = src.tpl;
      p.show = src.show; p.ins = src.ins;
      p.nm = (label(src) + " " + t("copyOf")).slice(0, 80);
    });
    toast(t("toast.dup"));
  }
  function delPrj() {
    hideDlg();
    if (!cur) return;
    var id = cur.id;
    ask(t("ask.del", { name: label(cur) }), t("btn.delete"), function () {
      clearTimeout(saveTimer); saveTimer = 0;
      removeAny(id, Date.now());
      storeData();
      tDel(id);
      cur = null;
      showHome();
      toast(t("toast.deleted"));
    });
  }
  function resetCam() {
    hideDlg();
    var def = C.normScene({});
    change("scene", function (p) { p.sc.cam = def.cam; p.sc.light = def.light; p.sc.shadow = def.shadow; });
  }

  // ---------- 8. Sync slice, palette, deep link ----------
  var PAL_VARS = ["--bg", "--bg-desktop", "--bar-bg", "--text", "--text-dim",
                  "--accent", "--accent-hover", "--accent-soft", "--accent-ink",
                  "--panel-bg", "--border", "--shadow", "--danger"];
  function inheritPalette() {
    try {
      var pRoot = window.parent.document.documentElement;
      document.documentElement.setAttribute("data-theme", pRoot.getAttribute("data-theme") || "dark");
      var cs = window.parent.getComputedStyle(pRoot);
      PAL_VARS.forEach(function (v) {
        var val = cs.getPropertyValue(v).trim();
        if (val) document.documentElement.style.setProperty(v, val);
      });
    } catch (e) { /* standalone */ }
  }
  function watchPalette() {
    try {
      new MutationObserver(inheritPalette).observe(window.parent.document.documentElement,
        { attributes: true, attributeFilter: ["data-skin", "data-theme"] });
    } catch (e) { /* standalone */ }
  }
  function syncApi() {
    try { return (window.parent && window.parent.orosSync) || window.orosSync || null; }
    catch (e) { return window.orosSync || null; }
  }
  function registerSync() {
    // LOCAL FIRST: load() has already run (boot order).
    var api = syncApi();
    window.__orosSyncApi = {
      _suppress: false,
      dirty: function () {
        if (this._suppress) return;
        if (api && typeof api.markDirty === "function") api.markDirty();
      }
    };
    if (!api || typeof api.registerSlice !== "function") return;
    api.registerSlice("mockups", sliceGet, sliceSet, C.DATA_KEY, C.merge);
    api.registerSlice("mockups-goods", gSliceGet, gSliceSet, C.GOODS_KEY, C.mergeGoods);
  }
  function gSliceGet() { return C.mergeGoods(gdata, null); }
  function gSliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.prj)) return;
    var before = JSON.stringify(gdata);
    window.__orosSyncApi._suppress = true;
    try {
      gdata = C.mergeGoods(incoming, null);
      localStorage.setItem(C.GOODS_KEY, JSON.stringify(gdata));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    if (JSON.stringify(gdata) === before) return;
    afterPull();
  }
  // A pull changed a store: the open project follows, or the list.
  function afterPull() {
    if (cur && !saveTimer) {
      var p = findPrj(cur.id);
      if (!p) { showHome(); return; }
      if (p.m !== cur.m) { cur = clone(p); renderForm(); pushAll(); }
    } else if (!cur) renderHome();
  }
  function sliceGet() { return C.merge(data, null); }     // canonical copy (R26)
  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.prj)) return;
    var before = JSON.stringify(data);
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = C.merge(incoming, null);
      localStorage.setItem(C.DATA_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    if (JSON.stringify(data) === before) return;
    afterPull();
  }
  // A full wrap from Atelier with its trim size (ww × wh mm): the
  // newest mockup whose cover sheet has that trim (it was most likely
  // made from that mockup's template), else null.
  function wrapTwin(ww, wh) {
    var list = data.prj.slice().sort(function (a, b) { return b.m - a.m; });
    for (var i = 0; i < list.length; i++) {
      var T = C.template(list[i].bk, list[i].art, list[i].tpl);
      if (Math.abs(T.W - ww) <= 1 && Math.abs(T.H - wh) <= 1) return list[i];
    }
    return null;
  }
  // Deep links: { id } opens a mockup (search); { cover: {front, back,
  // spine, wrap, name, w, h} } makes a new one (Atelier, BR-AT-MK).
  function openTarget(target) {
    if (!target || typeof target !== "object") return false;
    if (target.cover) {
      var c = C.parseCover(target.cover);
      if (!c) return false;
      hideDlg();
      if (cur && saveTimer) saveNow();
      var twin = c.wrap && c.ww ? wrapTwin(c.ww, c.wh) : null;
      newPrj(function (p) {
        p.nm = c.name;
        if (twin) {
          p.bk = clone(twin.bk); p.sc = clone(twin.sc); p.out = clone(twin.out); p.set = clone(twin.set);
          p.tpl = clone(twin.tpl); p.unit = twin.unit;
          p.art.c = twin.art.c; p.art.spT = twin.art.spT; p.art.spTC = twin.art.spTC;
          p.nm = c.name || twin.nm;
        }
        if (c.w && c.h) { p.bk.w = c.w; p.bk.h = c.h; p.bk.trim = "custom"; }
        if (c.wrap) { p.art.mode = "wrap"; p.art.wrap = c.wrap; p.art.bleed = 0; }
        else { p.art.front = c.front; p.art.back = c.back; p.art.spine = c.spine; }
      });
      showTab(twin ? "scene" : "book");
      toast(twin ? t("toast.wrapBook", { name: label(twin) }) : t("toast.fromAtelier"));
      return true;
    }
    if (typeof target.id !== "string" || !findPrj(target.id)) return false;
    hideDlg();
    openPrj(target.id);
    return true;
  }
  window.__orosOpenAt = openTarget;

  // ---------- 9. Wiring & boot ----------
  function applyI18n() {
    document.documentElement.lang = LANG;
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) { n.textContent = t(n.getAttribute("data-i18n")); });
    [].forEach.call(document.querySelectorAll("[data-i18n-ph]"), function (n) { n.placeholder = t(n.getAttribute("data-i18n-ph")); });
    document.title = t("app.name") + " · orOS";
    $("new-btn").innerHTML = ICON.plus; setLabel($("new-btn"), t("btn.new"));
    $("more-btn").innerHTML = ICON.more; setLabel($("more-btn"), t("btn.more"));
    $("back-btn").innerHTML = ICON.back; setLabel($("back-btn"), t("btn.back"));
    [].forEach.call(document.querySelectorAll(".dlg-close"), function (b) { b.innerHTML = ICON.close; setLabel(b, t("btn.close")); });
    $("f-bandC").setAttribute("aria-label", t("aria.bandC"));
    $("f-ribC").setAttribute("aria-label", t("aria.ribC"));
    $("f-bellyC").setAttribute("aria-label", t("aria.bellyC"));
    $("f-slipC").setAttribute("aria-label", t("aria.slipC"));
    $("f-elasticC").setAttribute("aria-label", t("aria.elasticC"));
    $("stickk").setAttribute("aria-label", t("aria.stickK"));
    $("tabs").setAttribute("aria-label", t("app.name"));
    $("stage").setAttribute("aria-label", t("cam.hint"));
  }
  function wire() {
    $("new-btn").addEventListener("click", function () { renderMake(); showDlg("make"); });
    $("first-btn").addEventListener("click", function () { renderMake(); showDlg("make"); });
    $("back-btn").addEventListener("click", showHome);
    $("more-btn").addEventListener("click", function () { showDlg("more"); });
    tabs.forEach(function (k) { $("tab-" + k).addEventListener("click", function () { showTab(k); }); });
    $("tabs").addEventListener("keydown", function (e) {
      var d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!d) return;
      var i = (tabs.indexOf(prefs.tab) + d + tabs.length) % tabs.length;
      showTab(tabs[i]); $("tab-" + tabs[i]).focus();
    });
    wireForm();
    wireGood();
    wireTpl();
    wireStage();
    $("dup-btn").addEventListener("click", duplicate);
    $("del-btn").addEventListener("click", delPrj);
    $("reset-cam").addEventListener("click", resetCam);
    $("ask-no").addEventListener("click", hideDlg);
    $("ask-yes").addEventListener("click", function () { var f = askYes; askYes = null; hideDlg(); if (f) f(); });
    $("scrim").addEventListener("click", hideDlg);
    [].forEach.call(document.querySelectorAll(".dlg-close"), function (b) { b.addEventListener("click", hideDlg); });
    // Contract B: Ctrl+Alt+Shift belongs to the shell
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
      var p = null; try { p = window.parent; } catch (err) { return; }
      if (!(p && p !== window && p.orosShortcuts && typeof p.orosShortcuts.handle === "function")) return;
      if (p.orosShortcuts.handle(e)) e.stopPropagation();
    }, true);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && openDlg) { e.preventDefault(); hideDlg(); return; }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.shiftKey && e.code === "KeyS" && cur && !openDlg) { e.preventDefault(); savePicture(); }
    });
    window.addEventListener("pagehide", function () { if (saveTimer) saveNow(); });
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden" && saveTimer) saveNow(); });
  }

  function boot() {
    load();
    fillSelects();
    applyI18n();
    renderViews();
    renderSwatches();
    inheritPalette();
    wire();
    registerSync();
    watchPalette();
    if (!shell()) toast(t("standalone"));
    var opened = false;
    try {
      var s = shell();
      if (s && typeof s.__orosTakeTarget === "function") {
        var pending = s.__orosTakeTarget("mockups");
        if (pending) opened = openTarget(pending);
      }
    } catch (e) {}
    if (!opened) {
      if (prefs.cur && findPrj(prefs.cur)) openPrj(prefs.cur);
      else showHome();
    }
    console.log("[orOS Mockups] v" + C.VERSION + " ready");
  }

  boot();
})();
