// Studio wave P3 (Publish as podcast): an episode's transcript, made on
// request with Montage's Whisper on the device, edited as text, saved as
// WebVTT beside the MP3 and carried by the feed (podcast:transcript, read
// back by the Podcasts app's parser) and the show's page.
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../studio/podcast.js");
const PC = require("../podcasts/core.js").OrosPodcastsCore;
const FEEDS = require("../feeds/core.js");

test("P3: WebVTT out and back, escaped, bounded", () => {
  const cues = [{ start: 4.2, end: 9, text: "δεύτερο" }, { start: 0, end: 4.2, text: "Καλησπέρα <σας> & --> γεια" }];
  const v = P.vtt(cues);
  assert.ok(v.startsWith("WEBVTT\n\n1\n00:00:00.000 --> 00:00:04.200\n"));
  assert.ok(v.includes("Καλησπέρα &lt;σας&gt; &amp; → γεια"), "markup and the cue arrow cannot get in");
  assert.ok(!/<σας>/.test(v));
  assert.deepEqual(P.parseVtt(v), [{ start: 0, end: 4.2, text: "Καλησπέρα <σας> & → γεια" }, { start: 4.2, end: 9, text: "δεύτερο" }]);
  assert.equal(P.vtt(P.parseVtt(v)), v, "the same bytes again");
  assert.deepEqual(P.parseVtt("not a vtt"), []);
  assert.deepEqual(P.parseVtt(null), []);
  assert.deepEqual(P.parseVtt("WEBVTT\n\n01:02:03.500 --> 01:02:04.000 align:start\n<v Chris>hello</v>\n"), [], "an episode is at most an hour, a cue past it goes");
  assert.equal(P.normCues(Array.from({ length: 5000 }, (_, i) => ({ start: i * 0.5, end: i * 0.5 + 0.4, text: "x" }))).length, P.LIM.cues);
  assert.equal(P.normCues([{ start: 1, end: 2, text: "y".repeat(900) }])[0].text.length, P.LIM.cue);
  assert.deepEqual(P.normCues([{ start: 5, end: 6, text: "   " }, { start: "1", text: "a" }, null, { start: 20, end: 30, text: "late" }], 10), [], "empty, untimed and late cues go");
  assert.deepEqual(P.normCues([{ start: 8, end: 30, text: "end" }], 10), [{ start: 8, end: 10, text: "end" }], "an end past the episode is cut");
});

test("P3: the editor's text: one line per cue, times kept, loose lines join the one before", () => {
  const cues = [{ start: 0, end: 4.2, text: "Καλησπέρα" }, { start: 65.55, end: 70, text: "τρίτο" }];
  const e = P.editText(cues);
  assert.equal(e, "[0:00.0] Καλησπέρα\n[1:05.6] τρίτο");
  const back = P.fromEdit("[0:00.0] Καλησπέρα σας\nκαι καλώς ήρθατε\n\n[1:05.6] τρίτο\n[0:30] δεύτερο", 90);
  assert.deepEqual(back, [
    { start: 0, end: 30, text: "Καλησπέρα σας και καλώς ήρθατε" },
    { start: 30, end: 65.6, text: "δεύτερο" },
    { start: 65.6, end: 90, text: "τρίτο" }
  ], "sorted by time, each ends where the next starts, the last at the episode's end");
  assert.deepEqual(P.fromEdit("no times at all", 60), []);
  assert.deepEqual(P.fromEdit("[1:02:03] long"), [], "past the one-hour limit it is dropped");
  assert.equal(P.asrLang("el"), "el");
  assert.equal(P.asrLang("pt-BR"), "pt");
  assert.equal(P.asrLang(""), "auto");
  assert.equal(P.trPath("hshow0001", "001-proti-mera"), "/internal/Studio/Podcasts/hshow0001/001-proti-mera.vtt");
});

test("P3: the feed and the page carry the saved transcript", () => {
  const show = P.normShow({ id: "hshow0001", m: 1, title: "Δοκιμή", author: "Chris", desc: "Περιγραφή", lang: "el", url: "https://me.github.io/show/", cover: "/internal/Studio/Podcasts/hshow0001/cover.jpg" });
  show.guid = P.feedGuid(P.feedUrl(show));
  const mk = (pid, n) => {
    const ep = { n, type: "full", title: "Επεισόδιο " + n, date: Date.UTC(2026, 10, n), guid: P.epGuid(show.id, pid), slug: P.epSlug({ n, type: "full" }, "Επεισόδιο " + n), bytes: 1000, dur: 600, kbps: 96, ch: 1 };
    ep.file = P.epPath(show.id, ep.slug);
    return { id: pid, m: 1, name: "x", sh: show.id, ep, mk: [] };
  };
  const dat = { shows: [show], projects: [mk("pproject1", 1), mk("pproject2", 2)] };
  const eps = P.episodes(dat, show.id).map((e) => Object.assign({}, e, { tr: e.ep.n === 2 }));
  const f = P.files(show, eps);
  assert.deepEqual(f.eps.map((x) => x.transcript), ["transcripts/002-epeisodio-2.vtt", ""]);
  const xml = P.feedXml(show, eps, { now: Date.UTC(2026, 10, 15) });
  assert.ok(xml.includes('<podcast:transcript url="https://me.github.io/show/transcripts/002-epeisodio-2.vtt" type="text/vtt" language="el"/>'));
  const feed = PC.parseFeed(PC.fromFeedsXml(FEEDS.parseXml(xml)), P.feedUrl(show));
  const e2 = feed.eps.find((e) => e.title === "Επεισόδιο 2"), e1 = feed.eps.find((e) => e.title === "Επεισόδιο 1");
  assert.deepEqual(e2.transcripts, [{ url: "https://me.github.io/show/transcripts/002-epeisodio-2.vtt", type: "text/vtt", lang: "el" }]);
  assert.deepEqual(e1.transcripts, []);
  const page = P.pageHtml(show, eps, { transcript: "Απομαγνητοφώνηση" });
  assert.ok(page.includes('<p class="tr"><a href="transcripts/002-epeisodio-2.vtt">Απομαγνητοφώνηση</a></p>'));
  assert.equal((page.match(/class="tr"/g) || []).length, 1);
  assert.ok(!/<script/i.test(page));
});
