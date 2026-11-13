// Lyric Sync Songbook S3: sets (SONGBOOK v1, slice "songbook"), bundles,
// the song-list text and the PDF layout.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const S = require("../lyricsync/sets.js");
const P = require("../lyricsync/sheetpdf.js");
const H = require("../lyricsync/chords.js");
const C = require("../lyricsync/core.js");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

function seq(vals) { let i = 0; return () => vals[i++ % vals.length]; }
function set(id, mtime, items, extra) { return Object.assign({ id, name: "Gig " + id, items: items.map((s) => ({ s })), mtime }, extra || {}); }

test("sets: merge is symmetric, idempotent and keeps the newer set", () => {
  const a = { ver: 1, sets: [set("ta1", 10, ["sa1", "sb2"]), set("tb2", 5, ["sc3"])], tombs: {} };
  const b = { ver: 1, sets: [set("ta1", 12, ["sb2"]), set("tc3", 7, [])], tombs: {} };
  const ab = S.merge(a, b), ba = S.merge(b, a);
  assert.deepStrictEqual(ab, ba);
  assert.deepStrictEqual(S.merge(ab, ab), ab);
  assert.deepStrictEqual(S.merge(a, a), S.normalize(a));
  assert.deepStrictEqual(S.find(ab, "ta1").items, [{ s: "sb2" }]);
  assert.deepStrictEqual(ab.sets.map((x) => x.id), ["ta1", "tb2", "tc3"]);
});

test("sets: equal mtime picks the longer canonical JSON, the same on both sides", () => {
  const a = { ver: 1, sets: [set("ta1", 10, ["sa1"])], tombs: {} };
  const b = { ver: 1, sets: [set("ta1", 10, ["sa1", "sb2"])], tombs: {} };
  assert.deepStrictEqual(S.merge(a, b), S.merge(b, a));
  assert.strictEqual(S.find(S.merge(a, b), "ta1").items.length, 2);
});

test("sets: tombstones hide older copies, a newer edit comes back", () => {
  let d = S.put(S.empty(), set("ta1", 10, ["sa1"]), 10);
  const gone = S.remove(d, "ta1", 20);
  assert.strictEqual(S.find(gone, "ta1"), null);
  assert.strictEqual(S.find(S.merge(gone, d), "ta1"), null, "an older copy stays hidden");
  const edited = { ver: 1, sets: [set("ta1", 30, ["sa1"])], tombs: {} };
  assert.ok(S.find(S.merge(gone, edited), "ta1"), "a newer edit resurrects it");
});

test("sets: bad sets and items are dropped, never repaired; caps hold", () => {
  const d = S.normalize({ ver: 1, sets: [
    { id: "x1", name: "no t prefix", items: [], mtime: 5 },
    { id: "ta1", name: "no mtime", items: [] },
    { id: "tb2", name: "a".repeat(500), date: "2026-02-30", items: [{ s: "sok" }, { s: "bad id" }, { s: "sk1", key: "H" }, { s: "sk2", key: "Bbm", nt: " x " }, null], mtime: 3 }
  ], tombs: { "": 4, tz: "x" } });
  assert.deepStrictEqual(d.sets.map((x) => x.id), ["tb2"]);
  const s = d.sets[0];
  assert.strictEqual(s.name.length, 120);
  assert.strictEqual(s.date, undefined, "30 February is not a date");
  assert.deepStrictEqual(s.items, [{ s: "sok" }, { s: "sk1" }, { s: "sk2", key: "Bbm", nt: "x" }]);
  assert.deepStrictEqual(d.tombs, {});
  const many = { ver: 1, sets: [], tombs: {} };
  for (let i = 0; i < 230; i++) many.sets.push(set("t" + String(i).padStart(4, "0"), 100 + i, []));
  const capped = S.normalize(many);
  assert.strictEqual(capped.sets.length, S.MAX_SETS);
  assert.ok(!S.find(capped, "t0000"), "the oldest edits go first");
  const big = set("tz9", 9, Array.from({ length: 150 }, (_, i) => "s" + i));
  assert.strictEqual(S.normalize({ sets: [big] }).sets[0].items.length, S.MAX_ITEMS);
  assert.ok(S.isDate("2028-02-29") && !S.isDate("2027-02-29") && !S.isDate("2026-13-01"));
});

test("sets: editing a set never touches the songs, order moves are exact", () => {
  let s = S.newSet("Live", 5, seq([0.1, 0.2, 0.3]));
  assert.ok(/^t[a-z0-9]+$/.test(s.id));
  ["sa1", "sb2", "sc3"].forEach((id) => { s = S.addSong(s, id); });
  assert.deepStrictEqual(S.move(s, 0, 2).items.map((x) => x.s), ["sb2", "sc3", "sa1"]);
  assert.deepStrictEqual(S.move(s, 2, 0).items.map((x) => x.s), ["sc3", "sa1", "sb2"]);
  assert.deepStrictEqual(S.removeAt(s, 1).items.map((x) => x.s), ["sa1", "sc3"]);
  const k = S.setItem(s, 1, { key: "D", nt: "slow" });
  assert.deepStrictEqual(k.items[1], { s: "sb2", key: "D", nt: "slow" });
  assert.deepStrictEqual(S.setItem(k, 1, { key: "", nt: "" }).items[1], { s: "sb2" });
  assert.strictEqual(s.items[1].key, undefined, "the original is unchanged");
  const songs = { items: [{ id: "sa1", name: "A" }, { id: "sc3", name: "C" }] };
  assert.deepStrictEqual(S.songsOf(s, songs).map((x) => [x.i, x.song.name]), [[0, "A"], [2, "C"]], "a deleted song just drops out");
});

test("sets: the key for a set is a step from the song's key; same mode only", () => {
  assert.strictEqual(S.steps("Am", "Cm"), 3);
  assert.strictEqual(S.steps("G", "F"), 10);
  assert.strictEqual(S.steps("", "F"), 0);
  assert.strictEqual(S.steps("C", "nope"), 0);
  assert.strictEqual(S.keysLike("Em").length, 12);
  assert.ok(S.keysLike("Em").every((k) => /m$/.test(k)));
  assert.ok(S.keysLike("Bb").every((k) => !/m$/.test(k)));
  assert.deepStrictEqual(S.keysLike(""), []);
  // Played in the set's key, the chords move and the song stays.
  const song = { key: "Am", ln: [{ t: "Σε θυμάμαι", c: [[0, "Am"], [3, "E7"]] }] };
  const v = H.transposeSong(song, S.steps(song.key, "Cm"));
  assert.deepStrictEqual(v.ln[0].c, [[0, "Cm"], [3, "G7"]]);
  assert.strictEqual(v.key, "Cm");
  assert.deepStrictEqual(song.ln[0].c, [[0, "Am"], [3, "E7"]]);
});

test("sets: ChordPro bundles split and join; the list as text", () => {
  const txt = "﻿{title: Ένα}\n[Am]Λα\n\n{new_song}\n{title: Two}\n[C]la\r\n{ns}\n\n{ns}\n{title: Three}\n";
  const parts = S.splitBundle(txt);
  assert.strictEqual(parts.length, 3, "empty songs are dropped");
  assert.ok(/Ένα/.test(parts[0]) && /Two/.test(parts[1]) && /Three/.test(parts[2]));
  const back = S.splitBundle(S.joinBundle(parts));
  assert.deepStrictEqual(back.map((x) => x.trim()), parts.map((x) => x.trim()));
  assert.strictEqual(S.splitBundle(Array(400).fill("{title:x}").join("\n{new_song}\n")).length, S.MAX_BUNDLE);
  const st = { name: "Live", date: "2026-12-01", nt: "Bring capo", items: [{ s: "sa1", key: "C" }, { s: "sgone" }, { s: "sb2", nt: "a capella" }] };
  const songs = { items: [{ id: "sa1", name: "First", ar: "Me", key: "A" }, { id: "sb2", name: "Second" }] };
  assert.strictEqual(S.toList(st, songs, { show: (k) => H.show(k, true) }),
    "Live · 2026-12-01\nBring capo\n\n1. First · Me · Ντο\n2. Second (a capella)\n");
});

test("sets: a bundle exported in the set's key reads back as the same songs", () => {
  const F = require("../lyricsync/formats.js");
  const r = H.parseSheet("Am      F\nΣε θυμάμαι κάθε βράδυ\n\nC   G\nΛα λα λα");
  const song = Object.assign({ name: "Βράδυ", key: "Am" }, { ln: r.lines, xo: r.xo });
  const n = S.steps("Am", "Bm");
  const text = S.joinBundle([H.toChordPro(Object.assign({}, song, H.transposeSong(song, n))), H.toChordPro(song)]);
  const parts = S.splitBundle(text).map((x) => F.parse("song.cho", x));
  assert.strictEqual(parts.length, 2);
  assert.strictEqual(parts[0].key, "Bm");
  assert.strictEqual(parts[0].lines[0].t, "Σε θυμάμαι κάθε βράδυ");
  assert.deepStrictEqual(parts[0].lines[0].c.map((x) => x[1]), ["Bm", "G"]);
  assert.deepStrictEqual(parts[1].lines[0].c.map((x) => x[1]), ["Am", "F"]);
});

// A fixed-width measure: every character half the font size.
const measure = (t, face, size) => String(t).length * size * 0.5;
function songOf(text, extra) { const r = H.parseSheet(text); return Object.assign({ name: "Song" }, extra || {}, { ln: r.lines, xo: r.xo }); }

test("pdf layout: chords above their words, never on top of each other", () => {
  const song = songOf("Am F C G\nΣε θυμάμαι");
  const L = P.layout([song], { measure, size: 10 });
  const items = L.pages[0].items;
  const chords = items.filter((x) => x.f === "b" && /^[A-G]/.test(x.t) && x.t.length <= 2);
  assert.deepStrictEqual(chords.map((x) => x.t), ["Am", "F", "C", "G"]);
  for (let i = 1; i < chords.length; i++) assert.ok(chords[i].x >= chords[i - 1].x + measure(chords[i - 1].t + " ", "b", 10) - 1e-9, "no overlap");
  const words = items.find((x) => x.t === "Σε θυμάμαι");
  assert.ok(words && words.f === "r" && words.y > chords[0].y, "words under the chords");
});

test("pdf layout: long lines wrap at a space and their chords go with their words", () => {
  const words = "ένα δύο τρία τέσσερα πέντε έξι επτά οκτώ εννιά δέκα έντεκα δώδεκα δεκατρία δεκατέσσερα δεκαπέντε δεκαέξι";
  const song = { name: "Long", ln: [{ id: "l1", t: words, s: null, e: null, c: [[0, "C"], [words.indexOf("δεκαέξι"), "G"]] }] };
  const L = P.layout([song], { measure, size: 12, cols: 2 });
  const it = L.pages[0].items;
  const rows = it.filter((x) => x.f === "r" && x.t && x.t !== "Long");
  assert.ok(rows.length >= 2, "wrapped");
  assert.strictEqual(rows.map((x) => x.t).join(" "), words, "no word lost");
  const colW = (P.PAGES.a4[0] - 2 * 48 - 24) / 2;
  rows.forEach((x) => assert.ok(measure(x.t, "r", 12) <= colW + 1e-9));
  const g = it.find((x) => x.t === "G"), last = rows[rows.length - 1];
  assert.ok(g.y < last.y && last.y - g.y < 12 * 1.31 + 1e-9, "the G sits right above the piece with its word");
  assert.strictEqual(g.x, 48 + measure(last.t.slice(0, last.t.indexOf("δεκαέξι")), "r", 12), "over δεκαέξι in its piece");
});

test("pdf layout: a set has a cover page, each song a new page, words only drops chords", () => {
  const a = songOf("{title: A}\n[Am]Λα [E]λα", { name: "A" }), b = songOf("C\nla", { name: "B" });
  const L = P.layout([a, b], { measure, cover: { title: "Live", sub: "Tue", list: ["A", "B"] } });
  assert.strictEqual(L.pages.length, 3);
  assert.ok(L.pages[0].items.some((x) => x.t === "1. A") && L.pages[0].items.some((x) => x.t === "2. B"));
  assert.strictEqual(L.pages[1].items[0].t, "A");
  assert.strictEqual(L.pages[2].items[0].t, "B");
  const W = P.layout([a], { measure, show: "words" });
  assert.ok(!W.pages[0].items.some((x) => x.t === "Am"), "no chords");
  assert.ok(W.pages[0].items.some((x) => /Λα/.test(x.t)));
  const Ch = P.layout([a], { measure, show: "chords", solfege: true });
  assert.ok(Ch.pages[0].items.some((x) => x.t === "Λα-" || x.t === "Λαm"), "solfege names");
  const pages = P.layout([songOf(Array(200).fill("C\nla").join("\n"))], { measure, page: "letter" });
  assert.ok(pages.pages.length > 1 && pages.w === 612, "a long song flows onto more pages");
  pages.pages.forEach((p) => p.items.forEach((x) => assert.ok(x.y <= 792 - 48)));
});

test("app wiring: sets slice, scripts, strings, no markup from data", () => {
  const html = read("lyricsync/index.html");
  const iCh = html.indexOf('src="chords.js'), iSets = html.indexOf('src="sets.js'), iPdf = html.indexOf('src="sheetpdf.js'), iApp = html.indexOf('src="app.js');
  assert.ok(iCh > 0 && iSets > iCh && iPdf > iSets && iApp > iPdf, "sets.js and sheetpdf.js load after chords.js, before app.js");
  const app = read("lyricsync/app.js");
  assert.ok(app.includes('api.registerSlice("songbook", setsGet, setsSet, SETS_KEY, S.merge)'), "own slice");
  assert.ok(app.includes('var SETS_KEY = "oros-songbook-data"'));
  assert.ok(!/innerHTML/.test(app), "text only through textContent");
  assert.ok(!/innerHTML|eval\(|new Function/.test(read("lyricsync/sets.js") + read("lyricsync/sheetpdf.js")));
  // Every S3 string in EN and EL, and in the DE pack.
  const de = read("i18n/de/lyricsync.js");
  ["lt.sets", "set.new", "set.keyHere", "sg.nextUp", "pdf.save", "setx.bundle", "ex.pdf"].forEach((k) => {
    assert.strictEqual((app.match(new RegExp('"' + k.replace(".", "\\.") + '":', "g")) || []).length, 2, k + " EN + EL");
    assert.ok(de.includes('"' + k + '":'), k + " DE");
  });
  ["lyricsync/help.en.txt", "lyricsync/help.el.txt", "i18n/de/help/lyricsync.txt"].forEach((f) => assert.ok(/\{new_song\}/.test(read(f)), f + " explains sets"));
  // The core never learns about sets (an old build drops unknown fields).
  assert.ok(!/sets/.test(Object.keys(C).join(" ")));
});
