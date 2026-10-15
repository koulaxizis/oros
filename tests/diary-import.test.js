// One-Sentence Diary: import from other journaling apps (diary/import.js)
// — Day One JSON ZIP, Journey ZIP, Diaro XML, Daylio CSV; the day's
// line and long entry, place and weather, photos picked from the ZIP,
// several entries on one day, never over the user's text, no
// duplicates on a second import, the undo, and the wiring in the app.
// Fixtures are built here (ZIPs through atelier/zip.js write()).
// Run: node --test tests/*.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const C = require(path.join(__dirname, "..", "diary/core.js"));
const I = require(path.join(__dirname, "..", "diary/import.js"));
const Z = require(path.join(__dirname, "..", "atelier/zip.js"));
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const enc = (s) => new TextEncoder().encode(s);

const T0 = 1760000000000;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

function dayOneJson() {
  return JSON.stringify({
    metadata: { version: "1.0" },
    entries: [
      {
        uuid: "A1", creationDate: "2024-03-05T21:30:00Z", timeZone: "Europe/Athens",
        text: "# Walk by the sea\n\nA long walk with Maria\\. The light was gold\\!\n\n![](dayone-moment://P1)",
        tags: ["sea"],
        location: { placeName: "Thessaloniki waterfront", localityName: "Thessaloniki", latitude: 40.62649, longitude: 22.94834 },
        weather: { temperatureCelsius: 18.46, conditionsDescription: "Mostly Cloudy", weatherCode: "mostly-cloudy" },
        photos: [{ identifier: "P1", md5: "abc123", type: "jpeg" }, { identifier: "P2", md5: "missing", type: "jpeg" }]
      },
      // 23:30 UTC on the 5th is the 6th in Athens
      { uuid: "A2", creationDate: "2024-03-05T23:30:00Z", timeZone: "Europe/Athens", text: "Late night tea." },
      { uuid: "A3", creationDate: "2024-03-06T08:00:00Z", timeZone: "Europe/Athens", text: "Morning run." },
      { uuid: "A4", creationDate: "2024-03-07T10:00:00Z", timeZone: "Europe/Athens", text: "" },
      { uuid: "A5", creationDate: "not a date", text: "lost" }
    ]
  });
}
function dayOneZip() {
  return Z.write([
    { name: "Journal.json", data: dayOneJson() },
    { name: "photos/abc123.jpeg", data: PNG }
  ]);
}

test("Day One ZIP: entries, local days, line, long entry, place, weather, photos", async () => {
  const r = await I.read({ name: "export.zip", bytes: dayOneZip() });
  assert.equal(r.source, "dayone");
  assert.equal(r.name, "Day One");
  assert.equal(r.entries.length, 3);
  assert.equal(r.photos, 1);
  const days = I.group(r.entries);
  assert.deepEqual(days.map((d) => d.ymd), ["2024-03-05", "2024-03-06"]);
  const d5 = days[0];
  assert.equal(d5.line, "Walk by the sea");
  assert.match(d5.md, /^# Walk by the sea\n\nA long walk with Maria\. The light was gold!$/);
  assert.ok(!/dayone-moment/.test(d5.md));
  assert.deepEqual(d5.loc, { n: "Thessaloniki waterfront", la: 40.63, lo: 22.95 });
  assert.deepEqual(d5.wx, { c: 3, hi: 18.5 });
  assert.deepEqual(d5.ph, ["photos/abc123.jpeg"]);
  // two entries on the 6th: time order, joined with a rule
  const d6 = days[1];
  assert.equal(d6.n, 2);
  assert.equal(d6.line, "Late night tea.");
  assert.equal(d6.md, "Late night tea.\n\n---\n\nMorning run.");
  const bytes = await r.zip.bytes(d5.ph[0]);
  assert.deepEqual([...bytes], [...PNG]);
});

test("Day One JSON alone and richText fallback", async () => {
  const j = JSON.stringify({ entries: [{ creationDate: "2024-01-02T10:00:00Z", timeZone: "UTC",
    richText: JSON.stringify({ contents: [{ text: "From rich " }, { text: "text." }] }) }] });
  const r = await I.read({ name: "Journal.json", bytes: enc(j) });
  assert.equal(r.source, "dayone");
  assert.equal(r.entries[0].md, "From rich text.");
  assert.equal(r.zip, null);
});

test("plan + apply: new days, a day with a line, never over text, Undo", () => {
  const days = I.group(I.fromDayOne(JSON.parse(dayOneJson()).entries, { "#abc123": "photos/abc123.jpeg" }));
  let data = { ver: 1, days: {}, tombs: {} };
  data = C.setDay(data, "2024-03-06", "My own line", "😊", T0 - 5000);
  const before = JSON.parse(JSON.stringify(data));
  const pl = I.plan(data, days);
  assert.equal(pl.add, 1);
  assert.equal(pl.append, 1);
  assert.equal(pl.had, 0);
  assert.equal(pl.photos, 1);
  assert.equal(pl.from, "2024-03-05");
  assert.equal(pl.to, "2024-03-06");
  const r = I.apply(data, pl, T0, { "2024-03-05": ["20240305-abcdef12.jpg"] });
  assert.equal(r.added, 1);
  assert.equal(r.appended, 1);
  assert.deepEqual(data, before, "input untouched");
  const D = r.data;
  assert.equal(D.days["2024-03-05"].t, "Walk by the sea");
  assert.equal(D.days["2024-03-06"].t, "My own line", "own line kept");
  assert.equal(D.days["2024-03-06"].e, "😊");
  const L5 = C.longOf(D, "2024-03-05");
  assert.match(L5.md, /A long walk/);
  assert.deepEqual(L5.ph, ["20240305-abcdef12.jpg"]);
  assert.deepEqual(L5.loc, { n: "Thessaloniki waterfront", la: 40.63, lo: 22.95 });
  assert.deepEqual(L5.wx, { c: 3, hi: 18.5 });
  assert.equal(C.longOf(D, "2024-03-06").md, "Late night tea.\n\n---\n\nMorning run.");
  // merge stays stable (no endless uploads)
  assert.deepEqual(C.mergeDiary(D, D), D);
  assert.deepEqual(C.mergeDiary(D, before), D);

  // a second import of the same file: nothing to do
  const again = I.plan(D, days);
  assert.equal(again.items.length, 0);
  assert.equal(again.dup, 2);

  // a day whose long entry has the user's text is skipped
  let mine = C.setLong(before, "2024-03-05", "md", "My own story", T0 - 1000);
  const p2 = I.plan(mine, days);
  assert.equal(p2.had, 1);
  assert.ok(!p2.items.some((i) => i.ymd === "2024-03-05"));

  // Undo: the visible diary is exactly the one before
  const U = I.revert(D, r.undo, T0 + 1000);
  const visible = (x) => {
    const out = {};
    Object.keys(x.days).forEach((k) => { out[k] = { t: x.days[k].t, e: x.days[k].e }; });
    const long = {};
    Object.keys(x.long || {}).forEach((k) => { if (C.hasLong(x, k)) long[k] = C.longOf(x, k); });
    return { out, long };
  };
  assert.deepEqual(visible(U), visible(before));
  assert.deepEqual(C.photosOf(U), []);
  // and it wins over a device that still has the import
  assert.deepEqual(visible(C.mergeDiary(U, D)), visible(before));
  // re-importing after an undo works again
  assert.equal(I.plan(U, days).items.length, 2);
});

test("revert leaves a line changed after the import alone", () => {
  const days = I.group([{ ms: 1, ymd: "2024-05-01", md: "Short one.", loc: null, wx: null, ph: [] }]);
  const r = I.apply({ ver: 1, days: {}, tombs: {} }, I.plan({ ver: 1, days: {}, tombs: {} }, days), T0, null);
  assert.equal(C.longOf(r.data, "2024-05-01").md, "", "a one-sentence entry needs no long entry");
  const edited = C.setDay(r.data, "2024-05-01", "Edited by me", "", T0 + 10);
  const U = I.revert(edited, r.undo, T0 + 20);
  assert.equal(U.days["2024-05-01"].t, "Edited by me");
  // the single sentence re-imported over its own line: a duplicate
  assert.equal(I.plan(r.data, days).dup, 1);
});

test("Journey ZIP: HTML text, timezone, weather, address, photos", async () => {
  const e1 = { id: "j1", date_journal: Date.UTC(2023, 6, 1, 22, 30), timezone: "Europe/Athens",
    text: "<p>Swim at <b>Halkidiki</b>.</p><p>Then <a href=\"javascript:alert(1)\">a trick</a> and <a href=\"https://example.com/x\">a link</a>.</p><script>alert(1)</script><img src=x onerror=alert(1)>",
    lat: 40.0, lon: 23.5, address: "Kassandra", mood: 1, tags: ["summer"],
    weather: { id: 800, degree_c: 31.2, description: "Clear", icon: "01d", place: "Kassandra" }, photos: ["j1-photo.jpg"] };
  const e2 = { id: "j2", date_journal: Date.UTC(2023, 6, 3, 9, 0), timezone: "+02:00", text: "Plain **markdown** day",
    lat: 1.7976931348623157e308, lon: 1.7976931348623157e308, address: "", weather: { id: -1, degree_c: 1.7976931348623157e308, description: "" }, photos: [] };
  const zip = Z.write([
    { name: "1688250600000-j1.json", data: JSON.stringify(e1) },
    { name: "1688374800000-j2.json", data: JSON.stringify(e2) },
    { name: "j1-photo.jpg", data: PNG }
  ]);
  const r = await I.read({ name: "journey.zip", bytes: zip });
  assert.equal(r.source, "journey");
  const days = I.group(r.entries);
  assert.deepEqual(days.map((d) => d.ymd), ["2023-07-02", "2023-07-03"]);   // 22:30 UTC = 01:30 Athens
  const d = days[0];
  assert.equal(d.line, "Swim at Halkidiki.");
  assert.ok(!/[<>]/.test(d.md), "no tags left: " + d.md);
  assert.ok(!/javascript|alert|onerror/.test(d.md), d.md);
  assert.match(d.md, /\*\*Halkidiki\*\*/);
  assert.match(d.md, /\[a link\]\(https:\/\/example\.com\/x\)/);
  assert.deepEqual(d.loc, { n: "Kassandra", la: 40, lo: 23.5 });
  assert.deepEqual(d.wx, { c: 0, hi: 31.2 });
  assert.deepEqual(d.ph, ["j1-photo.jpg"]);
  assert.equal(days[1].loc, null);
  assert.equal(days[1].wx, null);
  assert.equal(days[1].line, "Plain markdown day");
});

test("Diaro XML (alone and in a ZIP): title, text, location, photos", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<data version="2">
<table name="diaro_folders"><r><uid>f1</uid><title>Life</title></r></table>
<table name="diaro_locations"><r><uid>l1</uid><title>Αθήνα</title><address>Syntagma</address><lat>37.9755</lat><lng>23.7348</lng></r></table>
<table name="diaro_entries">
<r><uid>e1</uid><date>1700000000000</date><tz_offset>+02:00</tz_offset><title>Μια καλή μέρα</title><text><![CDATA[Βόλτα στο κέντρο & καφές.
Δεύτερη γραμμή <b>όχι html</b>]]></text><folder_uid>f1</folder_uid><location_uid>l1</location_uid><tags>,t1,</tags></r>
<r><uid>e2</uid><date>1700100000000</date><tz_offset>+02:00</tz_offset><title/><text>Fish &amp; chips &lt;3</text><folder_uid/><location_uid/><tags/></r>
</table>
<table name="diaro_attachments"><r><uid>a1</uid><entry_uid>e1</entry_uid><type>photo</type><filename>photo_1.jpg</filename><position>1</position></r></table>
</data>`;
  const alone = await I.read({ name: "DiaroBackup.xml", bytes: enc(xml) });
  assert.equal(alone.source, "diaro");
  assert.equal(alone.entries.length, 2);
  assert.deepEqual(alone.entries[0].ph, []);
  const zr = await I.read({ name: "Diaro_backup.zip", bytes: Z.write([{ name: "DiaroBackup.xml", data: xml }, { name: "media/photo/photo_1.jpg", data: PNG }]) });
  const days = I.group(zr.entries);
  assert.equal(days[0].ymd, "2023-11-15");
  assert.equal(days[0].line, "Μια καλή μέρα");
  assert.match(days[0].md, /^### Μια καλή μέρα\n\nΒόλτα στο κέντρο & καφές\./);
  assert.ok(!/<b>/.test(days[0].md));
  assert.deepEqual(days[0].loc, { n: "Αθήνα", la: 37.98, lo: 23.73 });
  assert.deepEqual(days[0].ph, ["media/photo/photo_1.jpg"]);
  assert.equal(days[1].line, "Fish & chips <3");
});

test("Daylio CSV: note title and note, moods ignored, empty notes skipped", async () => {
  const csv = "﻿full_date,date,weekday,time,mood,activities,note_title,note\n" +
    "2024-02-10,February 10,Saturday,21:15,good,friends | movies,Cinema night,\"Saw a film.<br>Then pizza.\"\n" +
    "2024-02-10,February 10,Saturday,09:00,meh,work,,Early start.\n" +
    "2024-02-11,February 11,Sunday,10:00,rad,,,\n";
  const r = await I.read({ name: "daylio_export.csv", bytes: enc(csv) });
  assert.equal(r.source, "daylio");
  assert.equal(r.entries.length, 2);
  const days = I.group(r.entries);
  assert.equal(days.length, 1);
  assert.equal(days[0].line, "Early start.");
  assert.equal(days[0].md, "Early start.\n\n---\n\n### Cinema night\n\nSaw a film.\nThen pizza.");
  assert.ok(!/good|meh|friends/.test(days[0].md));
});

test("not one of these apps → null (the app's own formats stay)", async () => {
  assert.equal(await I.read({ name: "d.csv", bytes: enc("date,text,emoji\n2024-01-01,hi,\n") }), null);
  assert.equal(await I.read({ name: "d.json", bytes: enc('{"app":"oros-diary","days":[]}') }), null);
  assert.equal(await I.read({ name: "x.zip", bytes: Z.write([{ name: "a.txt", data: "x" }]) }), null);
  assert.equal(await I.read({ name: "x.xml", bytes: enc("<html><table name=\"x\"></table></html>") }), null);
});

test("helpers: first line, clipping, weather words, time zones, HTML scan", () => {
  assert.equal(I.firstLine("## Hello *there*\n\nmore"), "Hello there");
  assert.equal(I.firstLine("---\n- First item. Second."), "First item.");
  assert.equal(I.firstLine("Τι ωραία μέρα; Ναι."), "Τι ωραία μέρα;");
  const long = I.firstLine("word ".repeat(100));
  assert.ok(Array.from(long).length <= 280 && long.endsWith("…"));
  assert.equal(I.wmo("Partly Cloudy"), 2);
  assert.equal(I.wmo("light-rain"), 63);
  assert.equal(I.wmo("Thunderstorms"), 95);
  assert.equal(I.wmo("Clear"), 0);
  assert.equal(I.wmo("weird"), null);
  assert.equal(I.ymdIn(Date.UTC(2024, 0, 1, 23, 0), "+02:00"), "2024-01-02");
  assert.equal(I.ymdIn(Date.UTC(2024, 0, 1, 23, 0), "America/New_York"), "2024-01-01");
  assert.equal(I.ymdIn(Date.UTC(2024, 0, 1, 23, 0), "GMT-05:00"), "2024-01-01");
  assert.equal(I.htmlToMd("<h1>T</h1><ul><li>a</li><li>b</li></ul><style>x{}</style>"), "# T\n\n- a\n- b");
  assert.equal(I.htmlToMd("a &amp; b &#x3b1;"), "a & b α");
});

test("caps: huge text is clipped, the long entry stays ≤ 20 000", () => {
  const big = "x".repeat(100000);
  const days = I.group([{ ms: 1, ymd: "2024-05-02", md: I.toMd(big), loc: null, wx: null, ph: [] }]);
  assert.ok(Array.from(days[0].line).length <= 280);
  assert.ok(days[0].md.length <= C.MD_MAX);
});

test("app wiring: scripts, preview dialog, strings, accept list", () => {
  const html = read("diary/index.html");
  const v = /core\.js\?v=([^"]+)"/.exec(html)[1];
  assert.ok(html.includes('src="../atelier/zip.js?v=' + v + '"'));
  assert.ok(html.includes('src="../importkit.js?v=' + v + '"'));
  assert.ok(html.includes('src="import.js?v=' + v + '"'));
  assert.ok(html.indexOf("import.js?v") < html.indexOf("diary.js?v"));
  assert.ok(/id="imp-dlg"/.test(html));
  assert.ok(/accept="[^"]*\.zip[^"]*\.xml/.test(html));
  const js = read("diary/diary.js");
  assert.ok(js.includes("OrosDiaryImport"));
  ["imp.title", "imp.go", "imp.had", "imp.dup", "toast.impDone", "toast.impUndone"].forEach((k) => {
    assert.equal(js.split('"' + k + '":').length - 1, 2, k + " in EN and EL");
  });
  assert.ok(!/innerHTML\s*=\s*[^"';]*(md|text|line)\b/.test(js.slice(js.indexOf("7c. Import from other apps"))), "no file text as HTML");
});
