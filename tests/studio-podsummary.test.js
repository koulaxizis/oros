// Studio wave P4 (Publish as podcast): the Assistant and the Gate read
// the podcast shows and their episodes (app_summary app studio), the
// same summary on both sides (GATE-PAR), read only.
const test = require("node:test");
const assert = require("node:assert/strict");
global.window = global.window || {};
const S = require("../assistant/summary.js");
const G = require("../gate/gate.js");
const C = require("../assistant/core.js");

const raw = {
  ver: 1,
  shows: [
    { id: "hshow0001", m: 1, title: "Ιστορίες της γειτονιάς", author: "Χρήστος", url: "https://me.github.io/geitonia/", cover: "/internal/Studio/Podcasts/hshow0001/cover.jpg" },
    { id: "hshow0002", m: 1, title: "Άλλη εκπομπή", url: "javascript:alert(1)/" },
    { id: "hgone0003", m: 1, title: "Σβησμένη" },
    { id: "bad", m: 1, title: "not a show id" }
  ],
  tombs: { hgone0003: 9, pdead0001: 9 },
  projects: [
    { id: "pproj0001", m: 1, name: "x", sh: "hshow0001", ep: { n: 2, type: "full", title: "Δεύτερη μέρα", date: Date.UTC(2026, 10, 2), file: "/internal/Studio/Podcasts/hshow0001/002-b.mp3", dur: 754.2 } },
    { id: "pproj0002", m: 1, name: "y", sh: "hshow0001", ep: { n: 1, type: "full", title: "Πρώτη μέρα", date: Date.UTC(2026, 10, 1) } },
    { id: "pproj0003", m: 1, name: "z", sh: "hshow0001", ep: { n: 0, type: "trailer", title: "", date: Date.UTC(2026, 9, 30), file: "/internal/Studio/Podcasts/hshow0001/trailer.mp3", dur: 30 } },
    { id: "pdead0001", m: 1, name: "gone", sh: "hshow0001", ep: { n: 9, title: "deleted" } },
    { id: "pproj0004", m: 1, name: "w", sh: "hgone0003", ep: { n: 1, title: "of a deleted show" } },
    { id: "pproj0005", m: 1, name: "plain project" }
  ]
};

test("P4: app_summary studio lists the shows and every episode, read only", () => {
  assert.equal(S.OWN.studio, "shows");
  const s = S.studioShows(raw, {});
  assert.equal(s.ok, true);
  assert.deepEqual(s.shows, [
    { title: "Άλλη εκπομπή", author: "", site: "", feed: "", episodes: 0, files_made: 0, latest: "" },
    { title: "Ιστορίες της γειτονιάς", author: "Χρήστος", site: "https://me.github.io/geitonia/", feed: "https://me.github.io/geitonia/feed.xml", episodes: 3, files_made: 2, latest: "2026-11-02" }
  ], "a deleted show and a bad id are left out; only an https site counts");
  assert.deepEqual(s.items, [
    { title: "Δεύτερη μέρα", date: "2026-11-02", by: "Ιστορίες της γειτονιάς", text: "episode 2 · episode file made, 12:34" },
    { title: "Πρώτη μέρα", date: "2026-11-01", by: "Ιστορίες της γειτονιάς", text: "episode 1 · no episode file yet" },
    { title: "z", date: "2026-10-30", by: "Ιστορίες της γειτονιάς", text: "trailer · episode file made, 0:30" }
  ]);
  const txt = JSON.stringify(s);
  assert.ok(!/internal\/Studio|cover\.jpg|token|pass/i.test(txt), "no file path, token or password");
  assert.match(s.note, /Read only/);
  const one = S.studioShows(raw, { show: "ιστορίες της γειτονιάς" });
  assert.equal(one.shows.length, 1);
  assert.equal(one.items.length, 3);
  const none = S.studioShows(raw, { show: "Ραδιόφωνο" });
  assert.equal(none.ok, false);
  assert.match(none.err, /Ιστορίες της γειτονιάς/);
  assert.deepEqual(S.studioShows(null, {}).shows, []);
  assert.equal(S.normArgs({ app: "studio", show: "  Ιστορίες  " }, "2026-11-15").show, "Ιστορίες");
  const lines = S.preview(s, "el");
  assert.equal(lines[1], "Ιστορίες της γειτονιάς: 3 επεισόδια · 2 με αρχείο · https://me.github.io/geitonia/feed.xml");
});

test("P4: the Gate offers app_summary for Studio, and both sides describe it the same way (GATE-PAR)", async () => {
  assert.ok(G.toolsOf("studio").indexOf("app_summary") >= 0);
  const as = C.toolsFor({ data: 1, summary: 1 }).filter((t) => t.name === "app_summary")[0];
  assert.match(as.description, /studio lists the podcast shows/);
  assert.ok(as.params.properties.show);
  const R = await import("../relay/gate.js");
  const rg = R.TOOLS.filter((t) => t.name === "app_summary")[0];
  assert.match(rg.description, /studio: the podcast shows/);
  assert.ok(rg.inputSchema.properties.show);
  // no tool on either side publishes a podcast
  const names = C.toolsFor({ data: 1, summary: 1, changes: 1, creates: ["todo"], actions: ["timer"], edits: { writer: 1 } }).map((t) => t.name).concat(R.TOOLS.map((t) => t.name));
  assert.ok(!names.some((n) => /publish_pod|podcast_publish|upload/.test(n)));
});
