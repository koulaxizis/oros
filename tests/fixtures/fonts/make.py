# Builds the WOFF2 fixtures of tests/fonts-woff2.test.js from the Noto
# Serif subset in vendor/noto (SIL OFL): the same glyphs as a plain TTF,
# a WOFF2 with transformed glyf/loca + hmtx, and a WOFF2 with the null
# transform. Needs fontTools + brotli (pip install fonttools brotli).
# Run from the repo root: python3 tests/fixtures/fonts/make.py
import os
from fontTools import subset
from fontTools.ttLib import TTFont, woff2

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "..", "..", "vendor", "noto", "NotoSerif-Regular.ttf")
TEXT = "AaBbΑαΒβΓγάέήίόύώΐΰϊϋΆΈΉΊΌΎΏ;·0123€«»—ÉéÇç"

opts = subset.Options()
opts.name_IDs = ["*"]
opts.notdef_outline = True
opts.layout_features = []
f = TTFont(SRC)
s = subset.Subsetter(opts)
s.populate(text=TEXT)
s.subset(f)
ttf = os.path.join(HERE, "noto-serif-sub.ttf")
f.save(ttf)
woff2.compress(ttf, os.path.join(HERE, "noto-serif-sub-hmtx.woff2"), transform_tables={"glyf", "loca", "hmtx"})
woff2.compress(ttf, os.path.join(HERE, "noto-serif-sub-null.woff2"), transform_tables=set())

# The same font with another licence text and an address that is not a
# web page (licence(): Apache, url dropped), and edit-only embedding.
f = TTFont(ttf)
for r in f["name"].names:
    if r.nameID == 13:
        r.string = "Licensed under the Apache License, Version 2.0"
    if r.nameID == 14:
        r.string = "javascript:alert(1)"
f["OS/2"].fsType = 0x0108
f.save(os.path.join(HERE, "noto-serif-sub-apache.ttf"))

# A tiny PostScript-outline (CFF) font: two glyphs, Latin A only.
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.t2CharStringPen import T2CharStringPen
fb = FontBuilder(1000, isTTF=False)
fb.setupGlyphOrder([".notdef", "A"])
fb.setupCharacterMap({0x41: "A"})
def box(w):
    pen = T2CharStringPen(w, None)
    pen.moveTo((50, 0)); pen.lineTo((450, 0)); pen.lineTo((250, 700)); pen.closePath()
    return pen.getCharString()
fb.setupCFF("OrosTestCFF-Regular", {"FullName": "Oros Test CFF"}, {".notdef": box(500), "A": box(500)}, {})
fb.setupHorizontalMetrics({".notdef": (500, 50), "A": (500, 50)})
fb.setupHorizontalHeader(ascent=800, descent=-200)
fb.setupNameTable({"familyName": "Oros Test CFF", "styleName": "Regular"})
fb.setupOS2(sTypoAscender=800, usWinAscent=800, usWinDescent=200, fsType=0)
fb.setupPost()
fb.save(os.path.join(HERE, "oros-test-cff.otf"))

# A font collection (.ttc, FM-3): the Noto Serif subset and its Apache
# twin renamed, as a device's collection files come.
from fontTools.ttLib import TTCollection
a = TTFont(os.path.join(HERE, "noto-serif-sub.ttf"))
b = TTFont(os.path.join(HERE, "noto-serif-sub-apache.ttf"))
for r in b["name"].names:
    if r.nameID == 6:
        r.string = "OrosTwin-Regular"
    if r.nameID in (1, 4, 16):
        r.string = "Oros Twin"
c = TTCollection()
c.fonts = [a, b]
c.save(os.path.join(HERE, "pair.ttc"))
