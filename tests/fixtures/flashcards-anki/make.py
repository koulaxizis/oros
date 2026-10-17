# Builds the two Anki test packages used by tests/flashcards-anki.test.js:
#   legacy.apkg  collection.anki2 (schema 11: note types and decks as JSON in col)
#   modern.apkg  collection.anki21b (zstd SQLite, schema 18 tables with protobuf
#                blobs, WITHOUT ROWID fields/templates), zstd media map + files
# Run once: python3 -I tests/fixtures/flashcards-anki/make.py  (needs the
# "zstandard" Python package). The packages are committed, so tests need
# neither Python nor zstandard.
import json, os, sqlite3, struct, sys, tempfile, zipfile, zlib
import zstandard

HERE = os.path.dirname(os.path.abspath(__file__))
SEP = "\x1f"

def png():
    raw = b"".join(b"\x00" + b"\xff\x00\x00" * 4 for _ in range(4))
    def chunk(t, d): return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 4, 4, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")

MEDIA = {"pic.png": png(), "say.mp3": b"ID3\x03\x00\x00\x00\x00\x00\x00" + bytes(range(200))}

BASIC = {"name": "Basic", "kind": 0, "flds": ["Front", "Back"],
         "tmpls": [("{{Front}}", "{{FrontSide}}<hr id=answer>{{Back}}")]}
REV = {"name": "Basic (and reversed card)", "kind": 0, "flds": ["Front", "Back"],
       "tmpls": [("{{Front}}", "{{FrontSide}}<hr id=answer>{{Back}}"), ("{{Back}}", "{{FrontSide}}<hr id=answer>{{Front}}")]}
CLOZE = {"name": "Cloze", "kind": 1, "flds": ["Text", "Back Extra"],
         "tmpls": [("{{cloze:Text}}", "{{cloze:Text}}<br>{{Back Extra}}")]}
WORDS = {"name": "Vocab", "kind": 0, "flds": ["Word", "Meaning", "Example"],
         "tmpls": [("{{Word}}", "{{FrontSide}}<hr id=answer>{{Meaning}}"),
                   ("{{Meaning}}", "{{FrontSide}}<hr id=answer>{{Word}}"),
                   ("{{#Example}}<i>{{Example}}</i>{{/Example}}", "{{FrontSide}}<hr id=answer>{{Word}}{{type:Word}}")]}
TYPES = {1001: BASIC, 1002: REV, 1003: CLOZE, 1004: WORDS}
DECKS = {1: ["Default"], 2001: ["Languages", "Spanish"], 2002: ["Languages"], 2003: ["Filtered"]}

T0 = 1760000000000   # ms

def content():
    notes, cards, revlog = [], [], []
    def note(nid, mid, flds, tags="", decks=None, queues=None):
        notes.append((nid, "g%d" % nid, mid, 1760000000, -1, tags, SEP.join(flds), flds[0], 0, 0, ""))
        nt = TYPES[mid]
        ords = list(range(len(nt["tmpls"]))) if nt["kind"] == 0 else [0, 1]
        for i, o in enumerate(ords):
            cid = nid * 10 + o
            did = (decks or {}).get(o, 2001)
            odid = 0
            if did == 2003: did, odid = 2003, 2001
            q = (queues or {}).get(o, 2)
            cards.append((cid, nid, did, o, 1760000100, -1, 2, q, 0, 10, 2500, 3, 0, 0, 0, odid, 0, ""))
    note(1, 1001, ['<b>Dog</b> &amp; cat<br><img src="pic.png">', 'σκύλος [sound:say.mp3]'], "animals greek::basics")
    revlog.extend([(T0 + 1000, 10, -1, 3, 1, 0, 0, 8000, 0), (T0 + 86400000, 10, -1, 3, 3, 1, 2500, 5000, 1),
                   (T0 + 5 * 86400000, 10, -1, 1, 1, 3, 2500, 9000, 1), (T0 + 6 * 86400000, 10, -1, 0, 0, 0, 0, 0, 4)])
    note(2, 1002, ["casa", "house"], "", {1: 2002})
    revlog.append((T0 + 2000, 20, -1, 4, 4, 0, 0, 3000, 0))
    note(3, 1003, ["{{c1::Athens}} is in {{c2::Greece::country}}", "<ul><li>capital</li><li>old</li></ul>"], "geo", None, {1: -1})
    revlog.append((T0 + 3000, 31, -1, 2, 1, 0, 0, 4000, 0))
    note(4, 1004, ["gato", "cat", "El gato duerme"], "")
    note(5, 1001, ["<script>alert(1)</script>Hi<style>b{}</style>", "there"], "", {0: 2003})
    revlog.append((T0 + 4000, 50, -1, 3, 1, 0, 0, 1000, 3))     # filtered, no rescheduling: skipped
    for i in range(250):
        note(100 + i, 1001, ["word %d " % i + "x" * (i % 30), "meaning %d" % i])
    note(9999, 1001, ["long " + "y" * 9000, "end"])
    return notes, cards, revlog

def legacy(path):
    db = sqlite3.connect(path)
    db.executescript("""
CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null, scm integer not null, ver integer not null, dty integer not null, usn integer not null, ls integer not null, conf text not null, models text not null, decks text not null, dconf text not null, tags text not null);
CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null, mod integer not null, usn integer not null, tags text not null, flds text not null, sfld integer not null, csum integer not null, flags integer not null, data text not null);
CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null, ord integer not null, mod integer not null, usn integer not null, type integer not null, queue integer not null, due integer not null, ivl integer not null, factor integer not null, reps integer not null, lapses integer not null, left integer not null, odue integer not null, odid integer not null, flags integer not null, data text not null);
CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null, ease integer not null, ivl integer not null, lastIvl integer not null, factor integer not null, time integer not null, type integer not null);
""")
    models = {str(mid): {"name": t["name"], "type": t["kind"], "flds": [{"name": f, "ord": i} for i, f in enumerate(t["flds"])],
                         "tmpls": [{"name": "Card %d" % (i + 1), "ord": i, "qfmt": q, "afmt": a} for i, (q, a) in enumerate(t["tmpls"])]}
              for mid, t in TYPES.items()}
    decks = {str(did): {"name": "::".join(p), "id": did} for did, p in DECKS.items()}
    db.execute("insert into col values (1,0,0,0,11,0,0,0,'{}',?,?,'{}','{}')", (json.dumps(models), json.dumps(decks)))
    notes, cards, revlog = content()
    db.executemany("insert into notes values (?,?,?,?,?,?,?,?,?,?,?)", notes)
    db.executemany("insert into cards values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", cards)
    db.executemany("insert into revlog values (?,?,?,?,?,?,?,?,?)", revlog)
    db.commit(); db.close()

def pb_varint(n):
    out = b""
    while True:
        b = n & 0x7f; n >>= 7
        if n: out += bytes([b | 0x80])
        else: return out + bytes([b])
def pb_bytes(f, b): return pb_varint(f << 3 | 2) + pb_varint(len(b)) + b
def pb_int(f, n): return pb_varint(f << 3) + pb_varint(n)

def modern(path):
    db = sqlite3.connect(path)
    db.executescript("""
CREATE TABLE col (id integer PRIMARY KEY, crt integer NOT NULL, mod integer NOT NULL, scm integer NOT NULL, ver integer NOT NULL, dty integer NOT NULL, usn integer NOT NULL, ls integer NOT NULL, conf text NOT NULL, models text NOT NULL, decks text NOT NULL, dconf text NOT NULL, tags text NOT NULL);
CREATE TABLE notes (id integer PRIMARY KEY, guid text NOT NULL, mid integer NOT NULL, mod integer NOT NULL, usn integer NOT NULL, tags text NOT NULL, flds text NOT NULL, sfld integer NOT NULL, csum integer NOT NULL, flags integer NOT NULL, data text NOT NULL);
CREATE TABLE cards (id integer PRIMARY KEY, nid integer NOT NULL, did integer NOT NULL, ord integer NOT NULL, mod integer NOT NULL, usn integer NOT NULL, type integer NOT NULL, queue integer NOT NULL, due integer NOT NULL, ivl integer NOT NULL, factor integer NOT NULL, reps integer NOT NULL, lapses integer NOT NULL, left integer NOT NULL, odue integer NOT NULL, odid integer NOT NULL, flags integer NOT NULL, data text NOT NULL);
CREATE TABLE revlog (id integer PRIMARY KEY, cid integer NOT NULL, usn integer NOT NULL, ease integer NOT NULL, ivl integer NOT NULL, lastIvl integer NOT NULL, factor integer NOT NULL, time integer NOT NULL, type integer NOT NULL);
CREATE TABLE notetypes (id integer NOT NULL PRIMARY KEY, name text NOT NULL, mtime_secs integer NOT NULL, usn integer NOT NULL, config blob NOT NULL);
CREATE TABLE fields (ntid integer NOT NULL, ord integer NOT NULL, name text NOT NULL, config blob NOT NULL, PRIMARY KEY (ntid, ord)) without rowid;
CREATE TABLE templates (ntid integer NOT NULL, ord integer NOT NULL, name text NOT NULL, mtime_secs integer NOT NULL, usn integer NOT NULL, config blob NOT NULL, PRIMARY KEY (ntid, ord)) without rowid;
CREATE TABLE decks (id integer PRIMARY KEY NOT NULL, name text NOT NULL, mtime_secs integer NOT NULL, usn integer NOT NULL, common blob NOT NULL, kind blob NOT NULL);
""")
    db.execute("insert into col values (1,0,0,0,18,0,0,0,'','','','','')")
    for mid, t in TYPES.items():
        db.execute("insert into notetypes values (?,?,0,0,?)", (mid, t["name"], pb_int(1, t["kind"]) + pb_bytes(3, b".card{}")))
        for i, f in enumerate(t["flds"]):
            db.execute("insert into fields values (?,?,?,?)", (mid, i, f, b""))
        for i, (q, a) in enumerate(t["tmpls"]):
            db.execute("insert into templates values (?,?,?,0,0,?)", (mid, i, "Card %d" % (i + 1), pb_bytes(1, q.encode()) + pb_bytes(2, a.encode())))
    for did, p in DECKS.items():
        db.execute("insert into decks values (?,?,0,0,?,?)", (did, SEP.join(p), b"", b""))
    notes, cards, revlog = content()
    db.executemany("insert into notes values (?,?,?,?,?,?,?,?,?,?,?)", notes)
    db.executemany("insert into cards values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", cards)
    db.executemany("insert into revlog values (?,?,?,?,?,?,?,?,?)", revlog)
    db.commit(); db.close()

def package(out, coll_name, coll_bytes, modern_media):
    names = list(MEDIA)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(coll_name, coll_bytes)
        if modern_media:
            z.writestr("collection.anki2", b"stub")   # the "please update Anki" stub
            entries = b"".join(pb_bytes(1, pb_bytes(1, n.encode()) + pb_int(2, len(MEDIA[n]))) for n in names)
            z.writestr("media", zstandard.ZstdCompressor().compress(entries))
            for i, n in enumerate(names):
                z.writestr(str(i), zstandard.ZstdCompressor().compress(MEDIA[n]))
        else:
            z.writestr("media", json.dumps({str(i): n for i, n in enumerate(names)}))
            for i, n in enumerate(names):
                z.writestr(str(i), MEDIA[n])

with tempfile.TemporaryDirectory() as tmp:
    p = os.path.join(tmp, "l.db"); legacy(p)
    package(os.path.join(HERE, "legacy.apkg"), "collection.anki2", open(p, "rb").read(), False)
    p = os.path.join(tmp, "m.db"); modern(p)
    package(os.path.join(HERE, "modern.apkg"), "collection.anki21b", zstandard.ZstdCompressor().compress(open(p, "rb").read()), True)
print("ok")
