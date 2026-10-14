// Radio wave 42: pure helpers of radio/tools.js (sleep fade, wake-up
// fade-in, ICY / Icecast titles, song history, recording file names,
// the synced wake-up rows) and the shell's alarm → station hook.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const T = require(path.join(__dirname, "..", "radio/tools.js"));
const enc = (s) => new Uint8Array(Buffer.from(s, "utf8"));

test("sleep fade: full volume until the last stretch, then down to silence", () => {
  const until = 100000, fade = 60000;
  assert.equal(T.fadeVolume(0.8, 0, until, fade), 0.8);
  assert.equal(T.fadeVolume(0.8, 40000, until, fade), 0.8, "exactly at the start of the fade");
  assert.equal(T.fadeVolume(1, 70000, until, fade), 0.25, "half way: squared curve");
  assert.equal(T.fadeVolume(1, 100000, until, fade), 0);
  assert.equal(T.fadeVolume(1, 120000, until, fade), 0);
  assert.equal(T.fadeVolume(5, 0, until, fade), 1, "bad base → 1");
  assert.equal(T.fadeLength(15 * 60000), 60000);
  assert.equal(T.fadeLength(60000), 15000);
  assert.equal(T.fadeLength(0), 5000);
});

test("wake-up fade-in: 5% to the target over the given time", () => {
  assert.equal(T.fadeIn(0.8, 0, 0, 30000), 0.04);
  assert.equal(T.fadeIn(1, 0, 15000, 30000), 0.525);
  assert.equal(T.fadeIn(0.8, 0, 30000, 30000), 0.8);
  assert.equal(T.fadeIn(0, 0, 0, 30000), 0.05, "a muted target counts as full");
});

test("ICY: StreamTitle found anywhere in the bytes, UTF-8 or Latin-1", () => {
  const audio = new Uint8Array(500).fill(0xff);
  const meta = enc("StreamTitle='Μάνος Χατζιδάκις - Το χαμόγελο της Τζοκόντας';StreamUrl='';");
  const block = new Uint8Array(audio.length + 1 + meta.length + 10);
  block.set(audio, 0); block[audio.length] = Math.ceil(meta.length / 16); block.set(meta, audio.length + 1);
  assert.equal(T.scanIcy(block), "Μάνος Χατζιδάκις - Το χαμόγελο της Τζοκόντας");
  const latin = new Uint8Array([...enc("xxStreamTitle='Caf"), 0xe9, ...enc(" del Mar';")]);
  assert.equal(T.scanIcy(latin), "Café del Mar");
  assert.equal(T.scanIcy(enc("no metadata here")), null, "no block: null");
  assert.equal(T.scanIcy(enc("StreamTitle='';")), "", "a block with no title: empty");
  assert.equal(T.scanIcy(new Uint8Array([...enc("StreamTitle='Cut off"), 0, 0, 0])), "Cut off", "zero padding ends it");
  assert.equal(T.scanIcy(enc("StreamTitle='Don't Stop';StreamUrl='x';")), "Don't Stop", "an apostrophe inside is kept, the first '; ends it");
});

test("titles: junk dropped, artist split", () => {
  assert.equal(T.cleanTitle("  -  "), "");
  assert.equal(T.cleanTitle("Unknown"), "");
  assert.equal(T.cleanTitle("https://radio.example/live"), "");
  assert.equal(T.cleanTitle("Radio Kiss", "radio kiss"), "", "the station's own name");
  assert.equal(T.cleanTitle("A\u0000B\nC"), "A B C");
  assert.deepEqual(T.splitTitle("Nina Simone - Feeling Good"), { artist: "Nina Simone", title: "Feeling Good" });
  assert.deepEqual(T.splitTitle("Just a show"), { artist: "", title: "Just a show" });
});

test("Icecast status: the source whose mount matches, artist + title", () => {
  const url = "https://ice.example:8000/jazz.mp3";
  assert.equal(T.icecastStatusUrl(url), "https://ice.example:8000/status-json.xsl");
  assert.equal(T.icecastStatusUrl("ftp://x"), "");
  const j = { icestats: { source: [
    { listenurl: "http://ice.example:8000/rock.mp3", title: "Rock song" },
    { listenurl: "http://ice.example:8000/jazz.mp3", artist: "Miles Davis", title: "So What" }
  ] } };
  assert.equal(T.parseIcecast(j, url), "Miles Davis - So What");
  assert.equal(T.parseIcecast({ icestats: { source: { listenurl: "http://x/other", title: "Only one" } } }, url), "Only one", "a single source");
  assert.equal(T.parseIcecast({ icestats: {} }, url), "");
  assert.equal(T.parseIcecast(j, "https://ice.example:8000/news"), "", "several sources, none matches");
});

test("song history: newest first, no back-to-back repeats per station, capped", () => {
  let h = T.historyAdd([], { t: 1, u: "a", n: "A", s: "Song 1" });
  h = T.historyAdd(h, { t: 2, u: "a", n: "A", s: "Song 1" });
  assert.equal(h.length, 1, "same song, same station: once");
  h = T.historyAdd(h, { t: 3, u: "b", n: "B", s: "Song 1" });
  h = T.historyAdd(h, { t: 4, u: "a", n: "A", s: "Song 2" });
  assert.deepEqual(h.map((x) => x.s + "@" + x.u), ["Song 2@a", "Song 1@b", "Song 1@a"]);
  assert.equal(T.historyAdd(h, { t: 5, u: "a", s: "  " }).length, 3, "empty titles never stored");
  let big = [];
  for (let i = 0; i < 400; i++) big = T.historyAdd(big, { t: i + 1, u: "a", s: "S" + i });
  assert.equal(big.length, T.LIM.hist);
  assert.equal(big[0].s, "S399");
  assert.deepEqual(T.historyAdd([null, { s: 5 }], null), [], "junk rows dropped");
});

test("recording: format from the stream, a safe file name under /internal/Radio", () => {
  assert.equal(T.recExt("audio/mpeg", "https://x/live"), "mp3");
  assert.equal(T.recExt("audio/aacp", "https://x/live"), "aac");
  assert.equal(T.recExt("application/ogg", "https://x/live", "OPUS"), "opus");
  assert.equal(T.recExt("audio/ogg", "https://x/live", "OGG"), "ogg");
  assert.equal(T.recExt("audio/flac", "https://x/live"), "flac");
  assert.equal(T.recExt("application/vnd.apple.mpegurl", "https://x/live.m3u8"), "", "HLS cannot be copied");
  assert.equal(T.recExt("", "https://x/live", "AAC+"), "aac");
  assert.equal(T.recExt("text/html", "https://x/live"), "", "a web page is not a stream");
  const ms = new Date(2026, 9, 14, 8, 5).getTime();
  assert.equal(T.recPath("Jazz FM / 24/7: <best>", ms, "mp3"), "/internal/Radio/2026-10-14 08.05 Jazz FM 24 7 best.mp3");
  assert.equal(T.recPath("...", ms, "aac"), "/internal/Radio/2026-10-14 08.05 Radio.aac");
  assert.equal(T.fmtBytes(512), "1 KB");
  assert.equal(T.fmtBytes(3 * 1048576), "3 MB");
  assert.equal(T.fmtClock(3723000), "1:02:03");
  assert.equal(T.fmtClock(65000), "1:05");
});

test("next alarm time: today when still ahead, else tomorrow", () => {
  const now = new Date(2026, 9, 14, 8, 0).getTime();
  assert.equal(T.nextAt(9, 30, now), new Date(2026, 9, 14, 9, 30).getTime());
  assert.equal(T.nextAt(7, 0, now), new Date(2026, 9, 15, 7, 0).getTime());
  assert.equal(T.nextAt(8, 0, now), new Date(2026, 9, 15, 8, 0).getTime(), "this very minute: tomorrow");
  assert.equal(T.nextAt(25, 0, now), 0);
});

const ST = (uuid, extra) => Object.assign({ stationuuid: uuid, name: "St " + uuid, url_resolved: "https://s.example/" + uuid }, extra || {});

test("wake rows: cleaned, LWW per alarm, symmetric, tombstones expire", () => {
  const w = T.normWake({
    a1: { m: 10, st: ST("u1", { favicon: "javascript:x", bitrate: 128, extra: "dropped" }) },
    "bad id!": { m: 10, st: ST("u2") },
    a2: { m: 0, st: ST("u2") },
    a3: { m: 5, st: { stationuuid: "u3", url_resolved: "ftp://x" } },
    a4: { m: 7, st: null }
  });
  assert.deepEqual(Object.keys(w), ["a1", "a4"]);
  assert.deepEqual(w.a1.st, { stationuuid: "u1", name: "St u1", url_resolved: "https://s.example/u1", favicon: "", codec: "", bitrate: 128, country: "", countrycode: "" });
  const A = { a1: { m: 10, st: ST("u1") }, a2: { m: 20, st: ST("u2") } };
  const B = { a1: { m: 15, st: null }, a2: { m: 20, st: ST("u9") }, a3: { m: 1, st: ST("u3") } };
  const m1 = T.mergeWake(A, B), m2 = T.mergeWake(B, A);
  assert.equal(JSON.stringify(m1), JSON.stringify(m2), "symmetric");
  assert.equal(m1.a1.st, null, "the later removal wins");
  assert.ok(m1.a3.st, "a row only one side has is kept");
  assert.equal(JSON.stringify(T.mergeWake(m1, null)), JSON.stringify(m1), "canonical");
  const day = 86400000;
  const old = T.normWake({ gone: { m: 1, st: null }, live: { m: 100 * day, st: ST("u1") }, oldLive: { m: 1, st: ST("u2") } });
  assert.deepEqual(Object.keys(old), ["live", "oldLive"], "removals older than 90 days go; live rows stay");
  assert.deepEqual(T.normWake([1, 2]), {});
});

test("radio slice: the merge keeps wake rows (radio.js uses tools.mergeWake)", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "radio/radio.js"), "utf8");
  assert.match(src, /merged\.wake = RT\.mergeWake\(remote\.wake, local\.wake\)/);
  assert.match(src, /var wk = RT\.normWake\(obj\.wake\);/);
  const html = fs.readFileSync(path.join(__dirname, "..", "radio/index.html"), "utf8");
  assert.ok(html.indexOf("tools.js") > 0 && html.indexOf("tools.js") < html.indexOf("radio.js"), "tools.js loads before radio.js");
});

test("shell: an alarm with a linked station plays it (engine first, else the Radio app)", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "shell.js"), "utf8");
  const m = src.match(/  function alarmRadio\(a\) \{[\s\S]*?\n  \}\n/);
  assert.ok(m, "alarmRadio found");
  assert.match(src, /alarmNotify\(due\); alarmRadio\(due\);/);
  const run = (store, engine) => {
    const calls = [];
    const ss = {};
    const window = { __orosRadioEngine: engine, __orosOpenRadio: (u) => calls.push(["open", u]) };
    const localStorage = { getItem: (k) => (k in store ? store[k] : null) };
    const sessionStorage = { setItem: (k, v) => { ss[k] = v; } };
    const fn = new Function("window", "localStorage", "sessionStorage", m[0] + "\nreturn alarmRadio;");
    fn(window, localStorage, sessionStorage)({ id: "al1" });
    return { calls, ss };
  };
  const data = JSON.stringify({ ver: 1, favorites: [], deleted: {}, wake: { al1: { m: 1, st: ST("u1") }, al2: { m: 1, st: null } } });
  let r = run({ "oros-radio-data": data }, null);
  assert.deepEqual(r.calls, [["open", "u1"]]);
  assert.equal(r.ss["oros-radio-wake"], "1");
  const woke = [];
  r = run({ "oros-radio-data": data }, { wake: (st) => { woke.push(st.stationuuid); return true; } });
  assert.deepEqual([woke, r.calls], [["u1"], []], "the engine plays it in place");
  r = run({ "oros-radio-data": data.replace('"al1"', '"other"') }, null);
  assert.deepEqual(r.calls, [], "no linked station: nothing");
  r = run({ "oros-radio-data": "{bad json" }, null);
  assert.deepEqual(r.calls, []);
});
