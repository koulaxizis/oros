# The orOS file format (OBF 1.0)

Every orOS app that makes a project you keep (a document, a deck, a design, a layout) saves it as one open file with the app's own extension. The file is a plain ZIP archive: unzip it with any tool and the folder holds the whole project in readable form. orOS opens the same file, or the unzipped folder, again without loss.

The format is free and open (MIT, like orOS). Reader and writer: [`bundle.js`](../bundle.js); tests: [`tests/bundle.test.js`](../tests/bundle.test.js).

## Extensions

| Extension | App | MIME type |
|---|---|---|
| `.orosdoc` | Writer | `application/x-oros-doc` |
| `.orosslides` | Slides | `application/x-oros-slides` |
| `.orosdesign` | Atelier | `application/x-oros-design` |
| `.oroslayout` | Layout | `application/x-oros-layout` |
| `.orossheet` | Spreadsheet | `application/x-oros-sheet` |
| `.orosmind` | Mind map | `application/x-oros-mind` |
| `.orosnotes` | Notes | `application/x-oros-notes` |
| `.oroswiki` | Wiki | `application/x-oros-wiki` |
| `.orosboard` | Kanban | `application/x-oros-board` |
| `.orosscript` | Prompter | `application/x-oros-script` |
| `.orostone` | Ringtones | `application/x-oros-tone` |
| `.orosstudio` | Studio | `application/x-oros-studio` |
| `.orosmontage` | Montage | `application/x-oros-montage` |
| `.orosphoto` | Photo Lab | `application/x-oros-photo` |
| `.orospixel` | Pixel | `application/x-oros-pixel` |
| `.orostree` | Family tree | `application/x-oros-tree` |
| `.oroscert` | Certificates | `application/x-oros-cert` |
| `.oroslabels` | Label Maker | `application/x-oros-labels` |
| `.orostrip` | Travel | `application/x-oros-trip` |
| `.orosmap` | Maps | `application/x-oros-map` |
| `.orostasks` | To-Do | `application/x-oros-tasks` |
| `.oroshabits` | Habits | `application/x-oros-habits` |
| `.oroswater` | Water | `application/x-oros-water` |
| `.oroschores` | Chores | `application/x-oros-chores` |
| `.orosscores` | Scores | `application/x-oros-scores` |
| `.oroscycle` | Cycle | `application/x-oros-cycle` |
| `.orosmood` | Mood | `application/x-oros-mood` |
| `.oroscal` | Calendar | `application/x-oros-cal` |
| `.oroscontacts` | Contacts | `application/x-oros-contacts` |
| `.orosbookmarks` | Bookmarks | `application/x-oros-bookmarks` |
| `.orosfeeds` | Feeds | `application/x-oros-feeds` |
| `.orospodcasts` | Podcasts | `application/x-oros-podcasts` |
| `.orosmeals` | Meals | `application/x-oros-meals` |
| `.orosstickies` | Stickies | `application/x-oros-stickies` |
| `.orosbudget` | Budget | `application/x-oros-budget` |
| `.orosinvoices` | Invoices | `application/x-oros-invoices` |
| `.oroscrm` | CRM | `application/x-oros-crm` |
| `.oroshours` | Timesheet | `application/x-oros-hours` |
| `.orosquote` | Quote | `application/x-oros-quote` |
| `.orossplit` | Split | `application/x-oros-split` |
| `.orosstock` | Stock | `application/x-oros-stock` |
| `.orosdiary` | Diary | `application/x-oros-diary` |
| `.oroshealth` | Health | `application/x-oros-health` |
| `.orosworkouts` | Fitness | `application/x-oros-workouts` |
| `.orosbaby` | Baby | `application/x-oros-baby` |
| `.orospet` | Pet care | `application/x-oros-pet` |
| `.orosplants` | Plants | `application/x-oros-plants` |
| `.orosgarage` | Garage | `application/x-oros-garage` |
| `.oroslibrary` | Library | `application/x-oros-library` |
| `.orosshelf` | Shelf | `application/x-oros-shelf` |
| `.orossignature` | Signature | `application/x-oros-signature` |
| `.orosnewsletter` | Newsletter | `application/x-oros-newsletter` |
| `.orosinventory` | Storage | `application/x-oros-inventory` |

The record apps (To-Do to Storage) follow the rules in "Record apps" below. More apps follow; each gets its own extension (`.oros` + one short English word) and MIME type `application/x-oros-<word>`.

## Layout of the archive

```
Report.orosdoc
├── mimetype                 first entry, stored (not compressed), no extra field
├── META-INF/manifest.xml    every other file: path, type, size, sha256
├── meta.xml                 title, author, dates, language (Dublin Core)
├── content.json             the project, in the app's own model (JSON)
├── settings.json            optional view state; safe to delete
├── media/<key>              pictures, sounds, videos, fonts
├── preview/thumbnail.png    optional, at most 512 px
├── preview/…                optional copies other programs open (e.g. document.html)
└── README.txt               what this file is (English and Greek)
```

- `mimetype` holds the MIME type as ASCII and comes first, uncompressed, so the type can be read from bytes 38 on without unzipping (the same rule as ODF and EPUB). `file` on Linux reports it.
- Paths are printable ASCII, `/`-separated, at most 200 characters, never absolute, never `.` or `..`, no `\` or `:`.
- Media keys are `[A-Za-z0-9][A-Za-z0-9._-]{0,127}`. Apps that store pictures by hash use `<sha256>.<ext>`; content.json refers to media by key.
- Text files are deflated; media are stored as they are (already compressed).
- Encryption is never used.
- ZIP64 records are written only when they are needed: an entry or the whole file past 4 GB, or more than 65 535 entries. Smaller bundles are plain ZIP, byte for byte as before.

### Big projects

Video and sound projects (Montage, Studio) can hold files of several GB. `bundle.js` then never holds them in memory whole:

- `writeBlob()` builds the bundle as one Blob made of small headers and the media Blobs themselves; SHA-256 and CRC-32 are computed a piece at a time (4 MB).
- `read(file, { big: true })` reads a File a piece at a time: only the end of the file, the central directory and the small text files are loaded. Each media file comes back as a Blob slice of the bundle (`media[key].blob`), hashed while streaming. Stored media may then be up to 16 GB each and 64 GB in all; deflated entries keep the 512 MB cap, because they inflate in memory.

### META-INF/manifest.xml

```xml
<?xml version="1.0" encoding="UTF-8"?>
<manifest xmlns="https://useoros.online/ns/bundle/1" version="1.0" app="writer" schema="writer/1" min-reader="1.0">
  <file path="content.json" type="application/json" size="18233" sha256="…"/>
  <file path="media/3f2a…e1.png" type="image/png" size="402113" sha256="3f2a…e1"/>
</manifest>
```

`version` is the container version, `schema` the version of content.json's model (`<app>/<n>`), `min-reader` the lowest container version that can open the file.

### meta.xml

```xml
<?xml version="1.0" encoding="UTF-8"?>
<meta xmlns="https://useoros.online/ns/bundle/1" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:title>Quarterly report</dc:title>
  <dc:creator>Chris</dc:creator>
  <dc:language>el</dc:language>
  <dc:date>2026-10-15T12:30:00Z</dc:date>
  <dc:subject>work</dc:subject>
  <created>2026-10-01T09:00:00Z</created>
  <generator>orOS Writer</generator>
  <id>doc-7f3c…</id>
</meta>
```

### content.json per app

| App | content.json | media |
|---|---|---|
| Writer | `{ orosWriter: true, ver: 1, doc: { title, author, tags, category, html, footnotes, comments, pageSize, margins, header, footer } }`; pictures in `html` are `src="media/<key>"` | pictures; `preview/document.html` is the document as a web page with `../media/` pictures |
| Slides | `{ kind: "oros-slides-package", ver: 1, deck, slides, items }` | pictures by `<sha256>.<jpg|png>` |
| Atelier | `{ kind: "oros-atelier-package", ver: 1, doc }` | pictures and clips by id |
| Layout | `{ kind: "oros-layout-package", ver: 1, doc }` | images by `<sha256>.<jpg|png>` |
| Spreadsheet | `{ kind: "oros-spreadsheet-package", ver: 1, workbook: { ver: 2, sheets, cells: { "sid|r|c": { v, f?, fm?, cv? } }, charts?, cf? } }`; `settings.json` `{ active }` | no media; `preview/NN-<sheet>.csv` per sheet (values as shown) + thumbnail |
| Mind map | `{ kind: "oros-mindmap-package", ver: 1, map, data: { app: "mindmap", format: 1, maps, nodes, links, pos, imgs, styles, frames, layouts } }`; `imgs[].media` is a media key | node pictures by `<sha256>.<ext>`; `preview/map.md`, `preview/map.opml` + thumbnail |
| Notes | `{ kind: "oros-notes-package", ver: 1, notebook: { id, name, mtime, pos }, labels, pages: [{ id, parent, title, text, mtime, pos, labels, pinned }] }`; `text` is Markdown | no media; `preview/index.md` + `preview/pages/NNN-<slug>.md` |
| Wiki | `{ kind: "oros-wiki-package", ver: 1, wiki: { id, m, n, main }, arts, revs }`; `revs` is the whole history | pictures by `<sha256>.<jpg|png>` (the wiki's own ids); `preview/<page>.md` per article |
| Kanban | `{ kind: "oros-kanban-package", ver: 1, board }`; `card.att[].file` is a media key | card attachments by `<sha256>.<ext>`; `preview/board.md`, `preview/board.csv` |
| Prompter | `{ kind: "oros-prompter-package", ver: 1, prompt: { id, cat, en, el, var_en, var_el, tags, mtime, pos }, favorite, completed }` | no media; `preview/script.txt` |
| Ringtones | `{ kind: "oros-ringtones-package", ver: 1, melody: { id, m, name, bpm, voice, notes } }` | no media; `preview/tone.rtttl`, `preview/tone.wav` (melodies up to 60 s) |
| Studio | `{ kind: "oros-studio-package", ver: 1, project { id, name, bpm, sig, vol, loop, fx }, tracks [{ id, name, color, vol, pan, mute, solo, ord, fx, inst?, auto? }], sources [{ id, name, dur, ch, media }], clips [{ id, t, s?, at, off, len, gain, fi, fo, name?, n? }] }`; effect file sliders are `{ media, name }` | audio and impulse responses by `<sha256>.<ext>`; `preview/tracks.txt`, `preview/song.mid` + timeline thumbnail |
| Montage | `{ kind: "oros-montage-package", ver: 1, project: { id, name, ar, fps, bg, vs, m, items } }`; `item.src`, `lut`, `na` are media keys | videos, pictures and sounds by `<sha256>.<ext>` (the app's own ids); poster thumbnail, `preview/timeline.txt`, `preview/captions.srt` |
| Photo Lab | `{ kind: "oros-photolab-package", ver: 1, doc: { name, w, h, m, layers: [{ id, k, name, vis, lock, op, bl, x, y, px?, tx?, sh?, aj?, fx?, mk? }], gd?, sels? } }`; `px = { key, x, y, w, h }` | one lossless PNG per raster layer, mask and selection; `preview/image.png` (flattened) + thumbnail |
| Pixel | `{ kind: "oros-pixel-package", ver: 1, item: { id, m, name, f }, colors, grid }` | no media; `preview/face.png`, `preview/face.svg` + thumbnail |
| Family tree | `{ kind: "oros-familytree-package", ver: 1, tree: { id, m, name, home }, people, unions, focus }`; `person.photo` is a media key | photos by `<sha256>.<jpg|png>`; `preview/tree.ged` (GEDCOM) + chart thumbnail |
| Certificates | `{ kind: "oros-certificates-package", ver: 1, ev, ppl }`: one event and its people; signing keys are never written | logo, seal and signature pictures by `<sha256>.<jpg|png>` (the design kit's ids); `preview/people.csv` + thumbnail |
| Label Maker | `{ kind: "oros-labels-package", ver: 1, copies, labels: [{ id, m, text, tape, width, cut, margin }] }`: the sheet Print would print | no media; `preview/labels.csv` + thumbnail |
| Travel | `{ kind: "oros-travel-package", ver: 1, trip: { id, name, dest, start, end, people, notes, cur, bplan, geo, f, pack, plan, docs, spend, jrnl } }`; `docs[].file` is a media key | tickets and journal photos by `<sha256>.<jpg|pdf>`; `preview/trip.md`, `preview/trip.ics`, `preview/places.gpx` |
| Maps | `{ kind: "oros-maps-package", ver: 1, title, groups: [{ id, name, color }], places: [{ id, name, sub, lat, lon, mtime, group }], tracks: [{ id, name, color, folder, hidden, src, m, track: { name, segs, wpts, trace? } }] }`: the chosen place groups and tracks | no media; `preview/places.geojson`, `preview/tracks.gpx` |

The models are the ones each app syncs (OROS_BIBLE.md Part IV).

## Record apps

Apps that keep many small records (tasks, habits, transactions, diary entries …) save ALL of them as one file with the app's own extension, through the shared kit [`recordpkg.js`](../recordpkg.js) (tests: [`tests/recordpkg.test.js`](../tests/recordpkg.test.js)).

content.json:

```json
{ "kind": "oros-<app>-package", "ver": 1, "data": { … } }
```

`data` is the app's sync slice (OROS_BIBLE.md Part IV) with its tombstones and device-only fields removed. Files on the orOS disk the records point at (receipts, photos) go in `media/`; `preview/` holds a copy other programs open where the app already has an exporter (CSV, Markdown, ICS, VCF, OPML, HTML bookmarks). meta.xml has the title, the oldest and newest record stamps as created / modified, the language and `generator` "orOS <App>".

Opening a record app's file is an **add-only merge**. This replaces rule 8 above ("fresh ids") for these apps only:

1. The kind must be the app's own; the app's normaliser cleans the data. Tombstones in the file are ignored: a file never deletes anything.
2. Every record the device lacks is added **with its id**, so opening the same file again adds nothing.
3. A record whose id is already on the device, live or deleted, is kept as it is: a file never overwrites. A record of a list the device already has (a task of a known list) goes into the device's copy of that list.
4. The dialog shows how many records are new, already here and newer in the file. With **Update with newer versions** ticked (for moving your own data between devices), a live record takes the file's copy when the file's stamp is newer; a deleted one stays deleted.
5. Stamps in the file are clamped to at most now + 5 minutes, so a file cannot make its records win every later sync.
6. The result goes through the app's own save and sync path (its merge), never `orosSync.importData`. `Undo` removes the added records the app's own way.

Quote and Meals also offer "Open as copy" (fresh ids), as they work like templates. Record files are not encrypted; Save says so in one line.

| App | `data` | previews |
|---|---|---|
| To-Do | `{ labels, lists: [{ …, items: [{ …, subs }] }] }` | `tasks.md`, `tasks.csv` |
| Habits | `{ ver: 2, habits, comps: [{ id: "<habit>|<date>", habitId, date, mtime, v?, sk?, nt? }] }` (the Steps setting stays on the device) | `habits.md`, `checkins.csv` |
| Water | `{ ver: 1, sips: [{ id, ts, ml, m }], goals: [{ id: "YYYY-MM-DD", ml, m }] }` (glass sizes, unit and reminders stay on the device) | `drinks.csv` |
| Chore Wheel | `{ ver: 1, members, tasks, done: { "<task>|<date>": [state, by, m] }, set: { "<task>|<date>": [member, m] } }` | `chores.md`, `chores.csv`, `history.csv` |
| Score Keeper | `{ ver: 1, matches, rounds, tpls, players }` | `history.csv` (= the app's Export CSV), `rounds.csv` |
| Cycle | `{ ver: 1, periods, days: [{ id: "d-YYYY-MM-DD", … }], cols: { sym, med } }` (reminders and views stay on the device) | `cycle.md`, `periods.csv`, `days.csv` |
| Mood | `{ ver: 3, entries, cols: { loc, trig, person }, vocab?, goals? }` (a value with the same name as one on the device is folded into it) | `mood.md`, `mood.csv` |

## Versions

- Container minor versions only add optional files or attributes; readers ignore what they do not know. A newer major version is refused with "update orOS".
- Older orOS files (one JSON object with base64 pictures, before 1.0) still open: a file that does not start with `PK` is read the old way.

## Opening a file (what a reader must check)

A file from outside is treated as hostile.

1. The first entry is `mimetype`, stored, holding an `application/x-oros-…` type the app expects.
2. Every path passes the path rule above; duplicates and encrypted entries are refused.
3. Sizes: at most 10 000 entries, 512 MB per file and 1 GB in all once inflated, and 1000 : 1 compression per file. Inflation stops at the size the header declared, so a lying header cannot grow a file.
4. XML: any `<!DOCTYPE`, `<!ENTITY`, CDATA or processing instruction is refused (no entity bombs, no external entities). Only the elements above are read.
5. Every file is hashed and compared with the manifest. A mismatch does not refuse the file (people may edit an unzipped folder) but is reported. A hash-named media file whose bytes changed gets its real hash as its key, and content.json follows it.
6. Media types are read from the bytes, never the name.
7. content.json goes through the app's own normaliser and sanitiser, exactly like any import. Nothing in a bundle is ever run: no scripts, no HTML from `preview/`.
8. Opening always makes a new item with fresh ids; it never overwrites one. Record apps instead add the records they lack with their ids and never overwrite or delete by default (see "Record apps").

## Unzipped folders

The apps also open an unzipped bundle folder ("Open unzipped folder"). The folder that holds `mimetype` is the bundle's root; the same checks apply. People can change a picture or fix a text in the folder and bring the project back.
