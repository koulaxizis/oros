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
  assert.equal(m.share_target.method, "GET");
  assert.equal(m.launch_handler, undefined);
});

test("no PDF, pictures, media, html, json or zip are taken over", () => {
  [".pdf", ".png", ".jpg", ".svg", ".mp3", ".mp4", ".html", ".htm", ".json", ".zip", ".exe", ".js"]
    .forEach((x) => assert.deepEqual(F.appsFor(x), [], x));
});

test("every app in the table exists and takes a file through its deep link", () => {
  const apps = JSON.parse(read("apps.json")).apps.map((a) => a.id);
  const files = {
    writer: ["writer/writer.js"], spreadsheet: ["spreadsheet/spreadsheet.js"],
    atelier: ["atelier/core.js"], slides: ["slides/app.js"], layout: ["layout/layout.js"],
    feeds: ["feeds/feeds.js"], podcasts: ["podcasts/podcasts.js"], mindmap: ["mindmap/mindmap.js"],
    familytree: ["familytree/familytree.js"], ringtones: ["ringtones/ringtones.js"],
    calendar: ["calendar/calendar.js"], contacts: ["contacts/contacts.js"]
  };
  F.HANDLERS.forEach((h) => {
    assert.ok(apps.includes(h.app), "registered: " + h.app);
    assert.ok(files[h.app], "receiver file known: " + h.app);
    const src = files[h.app].map(read).join("\n");
    if (h.text) {                                       // BR-FILE-IMPORT receivers
      assert.match(src, new RegExp("\\." + h.text + "\\b"), h.app);
      assert.match(src, /window\.__orosOpenAt\s*=/, h.app);
      assert.match(src, /__orosTakeTarget\(\s*["']/, h.app);
      return;
    }
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
  assert.deepEqual(F.appsFor(".txt"), ["writer", "mindmap"]);
  assert.deepEqual(F.appsFor(".opml"), ["feeds", "podcasts", "mindmap"]);
  assert.deepEqual(F.appsFor("__proto__"), []);
  assert.deepEqual(F.appsFor("constructor"), []);
  assert.deepEqual(F.shared().sort(), [".markdown", ".md", ".opml", ".txt"]);
});

test("choose: the only app, the person's choice, else ask", () => {
  assert.deepEqual(F.choose("a.xlsx", null), { app: "spreadsheet", ext: ".xlsx" });
  assert.deepEqual(F.choose("a.txt", null), { ask: ["writer", "mindmap"], ext: ".txt" });
  assert.deepEqual(F.choose("a.txt", { map: { ".txt": "mindmap" } }), { app: "mindmap", ext: ".txt" });
  assert.deepEqual(F.choose("a.txt", { map: { ".txt": "ask" } }), { ask: ["writer", "mindmap"], ext: ".txt" });
  // a choice for an app that cannot read the type is ignored
  assert.deepEqual(F.choose("a.txt", { map: { ".txt": "spreadsheet" } }).ask, ["writer", "mindmap"]);
  assert.equal(F.choose("a.pdf", null), null);
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
  launch([file("x.pdf")]);
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
