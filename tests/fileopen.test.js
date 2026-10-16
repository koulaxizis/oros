// Opening files from the device (fileopen.js): the type → app table,
// the manifest's file_handlers that mirror it, the person's choices,
// the launchQueue → __orosOpenAt handover and every app's receiver.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const F = require(path.join(ROOT, "fileopen.js"));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

test("manifest file_handlers are built from the table, one handler per type", () => {
  const m = JSON.parse(read("manifest.webmanifest"));
  assert.deepEqual(m.file_handlers, F.manifestHandlers());
  const seen = {};
  m.file_handlers.forEach((h) => {
    assert.match(h.action, /^\/\?file-open=[a-z0-9]+$/);
    Object.keys(h.accept).forEach((mime) => {
      assert.match(mime, /^[a-z]+\/[a-z0-9.+-]+$/, mime);
      h.accept[mime].forEach((x) => {
        assert.match(x, /^\.[a-z0-9]+$/);
        assert.ok(!seen[x], "listed twice: " + x);
        seen[x] = true;
      });
    });
  });
  assert.deepEqual(Object.keys(seen).sort(), F.extensions().slice().sort());
  // the link share stays as it was (Bookmarks), no launch_handler (Dropbox OAuth)
  // Android Share: POST multipart, links keep their url/title/text params
  assert.deepEqual(m.share_target, F.shareTarget());
  assert.equal(m.share_target.method, "POST");
  assert.equal(m.share_target.enctype, "multipart/form-data");
  F.extensions().forEach((x) => assert.ok(m.share_target.params.files[0].accept.includes(x), x));
  assert.equal(m.launch_handler, undefined);
});

test("no SVG, sound, mkv, html, json or zip are taken over", () => {
  [".svg", ".mp3", ".mkv", ".html", ".htm", ".json", ".zip", ".exe", ".js"]
    .forEach((x) => assert.deepEqual(F.appsFor(x), [], x));
});

test("every app in the table exists and takes a file through its deep link", () => {
  const apps = JSON.parse(read("apps.json")).apps.map((a) => a.id);
  const files = {
    writer: ["writer/writer.js"], spreadsheet: ["spreadsheet/spreadsheet.js"],
    atelier: ["atelier/core.js"], slides: ["slides/app.js"], layout: ["layout/layout.js"],
    feeds: ["feeds/feeds.js"], podcasts: ["podcasts/podcasts.js"], mindmap: ["mindmap/mindmap.js"],
    familytree: ["familytree/familytree.js"], ringtones: ["ringtones/ringtones.js"],
    notes: ["notes/notes.js"], texttools: ["texttools/texttools.js"], photolab: ["photolab/app.js"], montage: ["montage/montage.js"], library: ["library/app.js"],
    wiki: ["wiki/wiki.js", "wiki/io.js"], kanban: ["kanban/kanban.js"], prompter: ["prompter/prompter.js"], studio: ["studio/studio.js"], pixel: ["pixel/pixel.js"],
    certificates: ["certificates/certificates.js"], labels: ["labels/labels.js"], travel: ["travel/travel.js"],
    maps: ["maps/tracks.js"], chess: ["chess/chess.js"], calendar: ["calendar/calendar.js"], contacts: ["contacts/contacts.js"],
    // phase 4b record apps (recordpkg.js)
    todo: ["todo/todo.js", "recordpkg.js"], habits: ["habits/habits.js"], water: ["water/water.js"], chores: ["chores/chores.js"],
    scores: ["scores/scores.js"], cycle: ["cycle/cycle.js"], mood: ["mood/mood.js"], bookmarks: ["bookmarks/bookmarks.js"],
    meals: ["meals/meals.js"], stickies: ["stickies/stickies.js"], budget: ["budget/budget.js"], invoices: ["invoices/invoices.js"],
    crm: ["crm/crm.js"], timesheet: ["timesheet/timesheet.js"], quote: ["quote/quote.js"], split: ["split/split.js"],
    stock: ["stock/stock.js"], diary: ["diary/diary.js"], health: ["health/health.js"], fitness: ["fitness/fitness.js"],
    baby: ["baby/baby.js"], petcare: ["petcare/petcare.js"], plants: ["plants/plants.js"], garage: ["garage/garage.js"],
    shelf: ["shelf/shelf.js"], signature: ["signature/signature.js"], newsletter: ["newsletter/newsletter.js"], storage: ["storage/storage.js"]
  };
  // Phase 4b: the record apps' bundle types are registered ahead of
  // their waves. An app listed here has no "Open with" receiver for its
  // .oros<word> file yet; its wave adds the receiver and takes the app
  // off this list (one app per line, so parallel waves merge cleanly).
  const PENDING_4B = [
    "calendar",
    "contacts",
    "bookmarks",
    "feeds",
    "podcasts",
    "meals",
    "stickies",
    "budget",
    "invoices",
    "crm",
    "timesheet",
    "quote",
    "split",
    "stock",
    "diary",
    "health",
    "fitness",
    "baby",
    "petcare",
    "plants",
    "garage",
    "library",
    "shelf",
    "signature",
    "newsletter",
    "storage"
  ];
  F.HANDLERS.forEach((h) => {
    assert.ok(apps.includes(h.app), "registered: " + h.app);
    assert.ok(files[h.app], "receiver file known: " + h.app);
    const src = files[h.app].map(read).join("\n");
    if (h.text) {                                       // BR-FILE-IMPORT receivers
      assert.match(src, new RegExp("\\." + h.text + "\\b"), h.app);
      assert.match(src, /window\.__orosOpenAt\s*=/, h.app);
      assert.match(src, /__orosTakeTarget\(\s*["']/, h.app);
      if (!h.textExt) return;                            // also a File type (its bundle): checked below
    }
    if (PENDING_4B.includes(h.app)) return;
    assert.match(src, /openFile/, h.app);
    assert.match(src, /__orosTakeFile\(/, h.app);
    assert.match(src, /window\.__orosOpenAt\s*=/, h.app);
    assert.match(src, /__orosTakeTarget\(\s*["']/, h.app);
  });
});

test("extOf and appsFor", () => {
  assert.equal(F.extOf("Report.DOCX"), ".docx");
  assert.equal(F.extOf("a.tar.gz"), ".gz");
  assert.equal(F.extOf("noext"), "");
  assert.equal(F.extOf(""), "");
  assert.equal(F.extOf(null), "");
  assert.deepEqual(F.appsFor(".docx"), ["writer"]);
  assert.deepEqual(F.appsFor(".DOCX"), ["writer"]);
  assert.deepEqual(F.appsFor(".txt"), ["writer", "mindmap", "notes", "texttools"]);
  assert.deepEqual(F.appsFor(".opml"), ["feeds", "podcasts", "mindmap"]);
  assert.deepEqual(F.appsFor(".csv"), ["spreadsheet", "texttools"]);
  assert.deepEqual(F.appsFor(".tsv"), ["texttools"]);
  assert.deepEqual(F.appsFor("__proto__"), []);
  assert.deepEqual(F.appsFor("constructor"), []);
  assert.deepEqual(F.shared().sort(), [".csv", ".markdown", ".md", ".opml", ".pptx", ".txt"]);
  assert.deepEqual(F.appsFor(".pptx"), ["atelier", "slides"]);
});

test("choose: the only app, the person's choice, else ask", () => {
  assert.deepEqual(F.choose("a.xlsx", null), { app: "spreadsheet", ext: ".xlsx" });
  assert.deepEqual(F.choose("a.txt", null), { ask: ["writer", "mindmap", "notes", "texttools"], ext: ".txt" });
  assert.deepEqual(F.choose("a.txt", { map: { ".txt": "mindmap" } }), { app: "mindmap", ext: ".txt" });
  assert.deepEqual(F.choose("a.txt", { map: { ".txt": "ask" } }), { ask: ["writer", "mindmap", "notes", "texttools"], ext: ".txt" });
  // a choice for an app that cannot read the type is ignored
  assert.deepEqual(F.choose("a.txt", { map: { ".txt": "spreadsheet" } }).ask, ["writer", "mindmap", "notes", "texttools"]);
  assert.deepEqual(F.choose("a.pdf", null), { app: "library", ext: ".pdf" });
  assert.equal(F.choose("a.svg", null), null);
  assert.equal(F.choose("", null), null);
});

test("prefs: junk drops out, set and clear", () => {
  assert.deepEqual(F.normPrefs(null), { ver: 1, map: {} });
  assert.deepEqual(F.normPrefs({ map: "x" }), { ver: 1, map: {} });
  assert.deepEqual(F.normPrefs({ map: { ".txt": "writer", ".pdf": "writer", ".md": 3, ".opml": "ask", ".csv": "notes" } }),
    { ver: 1, map: { ".txt": "writer", ".opml": "ask" } });
  let p = F.setChoice(null, ".TXT", "mindmap");
  assert.equal(F.choiceFor(".txt", p), "mindmap");
  p = F.setChoice(p, ".txt", "");
  assert.equal(F.choiceFor(".txt", p), "");
});

test("strings: every key in both languages", () => {
  assert.deepEqual(Object.keys(F.STRINGS.en).sort(), Object.keys(F.STRINGS.el).sort());
  assert.equal(F.str("el", "always", { ext: ".txt" }), "Πάντα με αυτή την εφαρμογή για αρχεία .txt");
});

test("shell wiring: loaded before shell.js, released after the app list, sw skips the launch URL", () => {
  const html = read("index.html");
  const a = html.indexOf('src="fileopen.js'), b = html.indexOf('src="shell.js');
  assert.ok(a > 0 && a < b);
  assert.match(read("shell.js"), /window\.orosFileOpen\.ready\(\)/);
  assert.match(read("sw.js"), /url\.search\.indexOf\("file-open="\) === -1/);
});

// ---------- Browser side, in a small fake window ----------
function fakeWindow(opts) {
  opts = opts || {};
  const store = Object.assign({}, opts.store || {});
  const calls = [];
  let consumer = null;
  const w = {
    document: { getElementById: () => null, createElement: () => { throw new Error("no DOM in this test"); } },
    location: { href: opts.href || "https://useoros.online/?file-open=writer&x=1" },
    history: { state: null, replaceState: (s, t, u) => { w.replaced = u; } },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    crypto: { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) a[i] = (i * 37 + 11) & 255; return a; } },
    launchQueue: { setConsumer: (fn) => { consumer = fn; } },
    orosNotifs: { transient: (n) => { calls.push(["notice", n.title]); return true; } },
    __orosOpenAt: (app, target) => calls.push(["open", app, target]),
    matchMedia: () => ({ matches: true }),
    caches: opts.caches,
    File: class { constructor(parts, name, o) { this.parts = parts; this.name = name; this.type = (o && o.type) || ""; this.size = 1; } },
    URL, Promise, console
  };
  w.window = w;
  vm.runInNewContext(read("fileopen.js"), w);
  return { w, calls, store, launch: (files) => consumer({ files: files.map((f) => ({ getFile: () => Promise.resolve(f) })) }) };
}
const file = (name, size) => ({ name, size: size || 10, type: "" });
const tick = () => new Promise((r) => setTimeout(r, 0));

test("launch: waits for the app list, hands over a one-shot token", async () => {
  const { w, calls, launch } = fakeWindow();
  assert.equal(w.replaced, "/?x=1");                    // ?file-open= left the address bar
  const f = file("Letter.docx");
  launch([f]);
  await tick();
  assert.deepEqual(calls, []);                         // not before ready()
  w.orosFileOpen.ready();
  assert.equal(calls.length, 1);
  const [, app, target] = calls[0];
  assert.equal(app, "writer");
  assert.equal(target.openFile.name, "Letter.docx");
  assert.equal(JSON.parse(JSON.stringify(target)).openFile.token, target.openFile.token);
  assert.equal(w.__orosTakeFile(target.openFile.token), f);
  assert.equal(w.__orosTakeFile(target.openFile.token), null);   // once only
  assert.equal(w.__orosTakeFile("nope"), null);
  assert.equal(w.__orosTakeFile("__proto__"), null);
});

test("launch: several files open the first and say so; too big and unknown are refused", async () => {
  const { w, calls, launch } = fakeWindow();
  w.orosFileOpen.ready();
  launch([file("a.xlsx"), file("b.xlsx")]);
  await tick();
  assert.deepEqual(calls.map((c) => c[0] + ":" + c[1]), ["notice:orOS opened the first file only.", "open:spreadsheet"]);
  calls.length = 0;
  launch([file("huge.docx", F.MAX_BYTES + 1)]);
  await tick();
  launch([file("x.svg")]);
  await tick();
  assert.deepEqual(calls.map((c) => c[0]), ["notice", "notice"]);
});

test("launch: .ics and .vcf go as text (BR-FILE-IMPORT), over 5 MB refused", async () => {
  const { w, calls, launch } = fakeWindow();
  w.orosFileOpen.ready();
  const ics = Object.assign(file("trip.ics"), { text: () => Promise.resolve("BEGIN:VCALENDAR") });
  launch([ics]);
  await tick(); await tick();
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), ["open", "calendar", { importIcs: { name: "trip.ics", text: "BEGIN:VCALENDAR" } }]);
  const vcf = Object.assign(file("anna.vcf"), { text: () => Promise.resolve("BEGIN:VCARD") });
  launch([vcf]);
  await tick(); await tick();
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1])), ["open", "contacts", { importVcf: { name: "anna.vcf", text: "BEGIN:VCARD" } }]);
  launch([Object.assign(file("big.vcf", F.TEXT_MAX + 1), { text: () => Promise.resolve("x") })]);
  await tick(); await tick();
  assert.equal(calls[2][0], "notice");
  assert.equal(F.textKey("writer"), "");
  // their orOS bundles go as Files (token), not as text
  assert.equal(F.textKey("calendar", ".oroscal"), "");
  assert.equal(F.textKey("contacts", ".ICS"), "");
  assert.equal(F.textKey("calendar", ".ICS"), "importIcs");
  launch([Object.assign(file("week.oroscal"), { text: () => Promise.reject(new Error("never read as text")) })]);
  await tick(); await tick();
  assert.equal(calls[3][1], "calendar");
  assert.equal(typeof calls[3][2].openFile.token, "string");
  assert.equal(w.__orosTakeFile(calls[3][2].openFile.token).name, "week.oroscal");
});

test("launch: a shared type follows the saved choice; Settings API checks its input", async () => {
  const { w, calls, launch, store } = fakeWindow({ store: { "oros-file-open": JSON.stringify({ map: { ".opml": "podcasts" } }) } });
  w.orosFileOpen.ready();
  launch([file("subs.opml")]);
  await tick();
  assert.equal(calls[0][1], "podcasts");
  assert.equal(w.orosFileOpen.choice(".opml"), "podcasts");
  w.orosFileOpen.setChoice(".opml", "writer");          // cannot read OPML: ignored
  assert.equal(w.orosFileOpen.choice(".opml"), "podcasts");
  w.orosFileOpen.setChoice(".opml", "");
  assert.equal(w.orosFileOpen.choice(".opml"), "");
  assert.deepEqual(JSON.parse(store["oros-file-open"]), { ver: 1, map: {} });
  assert.ok(w.orosFileOpen.handlers().some((h) => h.app === "mindmap" && h.exts.includes(".xmind")));
});

test("Android share: ?share-files=<id> is taken once from the sw inbox", async () => {
  const deleted = [];
  const entry = { headers: { get: (k) => ({ "X-Name": encodeURIComponent("Λίστα.txt"), "X-More": "1" })[k] || null },
                  blob: () => Promise.resolve({ type: "text/plain" }) };
  const caches = {
    open: (n) => { assert.equal(n, F.SHARE_INBOX); return Promise.resolve({ match: (k) => Promise.resolve(k === "/__share/abc123xyz" ? entry : undefined) }); },
    delete: (n) => { deleted.push(n); return Promise.resolve(true); }
  };
  const { w, calls } = fakeWindow({ href: "https://useoros.online/?share-files=abc123xyz", caches,
    store: { "oros-file-open": JSON.stringify({ map: { ".txt": "notes" } }) } });
  assert.equal(w.replaced, "/");
  await tick(); await tick(); await tick();
  assert.deepEqual(calls, []);                         // waits for ready(), notices too
  w.orosFileOpen.ready();
  assert.deepEqual(calls.map((c) => c[0] + ":" + c[1]), ["notice:orOS opened the first file only.", "open:notes"]);
  assert.equal(calls[1][2].openFile.name, "Λίστα.txt");
  assert.deepEqual(deleted, [F.SHARE_INBOX]);
});

test("Android share: ids are checked; 'big' only says so", () => {
  assert.equal(F.shareIdFromUrl("/?share-files=abc123"), "abc123");
  assert.equal(F.shareIdFromUrl("/?share-files=big"), "big");
  ["/?share-files=../x", "/?share-files=ab", "/?share-files=ABC123", "/", "/?share-files="].forEach((u) =>
    assert.equal(F.shareIdFromUrl(u), "", u));
  const { w, calls } = fakeWindow({ href: "https://useoros.online/?share-files=big" });
  w.orosFileOpen.ready();
  assert.deepEqual(calls.map((c) => c[0]), ["notice"]);
});

// ---------- sw.js: the POST share target ----------
function swSandbox() {
  const puts = {};
  const sb = {
    self: { location: { origin: "https://useoros.online" }, registration: { scope: "https://useoros.online/" },
            addEventListener: () => {}, clients: {}, skipWaiting: () => {} },
    caches: { open: () => Promise.resolve({ put: (k, r) => { puts[k] = r; return Promise.resolve(); } }) },
    Response: class { constructor(body, o) { this.body = body; this.headers = (o && o.headers) || {}; }
                      static redirect(u, s) { return { redirect: u, status: s }; } },
    URL, URLSearchParams, Promise, console, setTimeout, clearTimeout, Date, Math
  };
  sb.self.caches = sb.caches;
  vm.runInNewContext(read("sw.js"), sb);
  return { sb, puts };
}
const form = (o) => ({ formData: () => Promise.resolve({
  getAll: (k) => (k === "files" ? o.files || [] : []),
  get: (k) => (k in o ? o[k] : null) }) });

test("sw share target: a link goes on to Bookmarks as GET share- params", async () => {
  const { sb, puts } = swSandbox();
  const r = await sb.shareTargetPost(form({ url: "", title: "Read this", text: "see https://example.com/a" }));
  assert.equal(r.status, 303);
  assert.equal(r.redirect, "https://useoros.online/?share-title=Read+this&share-text=see+https%3A%2F%2Fexample.com%2Fa");
  assert.deepEqual(Object.keys(puts), []);
});

test("sw share target: a file lands in the inbox, the first only; too big is refused", async () => {
  const { sb, puts } = swSandbox();
  const f1 = { name: "notes.md", size: 12, type: "text/markdown" }, f2 = { name: "b.txt", size: 3, type: "" };
  const r = await sb.shareTargetPost(form({ files: [f1, f2] }));
  const id = /\?share-files=([a-z0-9]+)$/.exec(r.redirect)[1];
  assert.equal(F.shareIdFromUrl(r.redirect), id);
  const put = puts["/__share/" + id];
  assert.equal(put.body, f1);
  assert.equal(put.headers["X-Name"], "notes.md");
  assert.equal(put.headers["X-More"], "1");
  const big = await sb.shareTargetPost(form({ files: [{ name: "x.docx", size: 60 * 1024 * 1024 }] }));
  assert.equal(big.redirect, "https://useoros.online/?share-files=big");
  const bad = await sb.shareTargetPost({ formData: () => Promise.reject(new Error("x")) });
  assert.equal(bad.redirect, "https://useoros.online/");
});

test("sw share target: a single app's share goes back to its own page (solo.js)", async () => {
  const { sb } = swSandbox();
  const req = form({ url: "https://example.com/x", title: "", text: "" });
  req.url = "https://useoros.online/bookmarks/solo.html?share-target";
  const r = await sb.shareTargetPost(req);
  assert.equal(r.redirect, "https://useoros.online/bookmarks/solo.html?share-url=https%3A%2F%2Fexample.com%2Fx");
  const odd = form({ url: "https://example.com/x" });
  odd.url = "https://useoros.online/x/y/solo.html?share-target";
  assert.equal((await sb.shareTargetPost(odd)).redirect, "https://useoros.online/?share-url=https%3A%2F%2Fexample.com%2Fx");
});
