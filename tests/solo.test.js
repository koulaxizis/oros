// Single apps (solo.js): "orOS Notes", "orOS Calendar" … installed on
// their own. Keeps the table, the committed pages, manifests and icons
// in step, and checks the launch parameters, shortcuts and shares.
// Run: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const S = require(path.join(ROOT, "solo.js"));
const CSP = require(path.join(ROOT, ".github", "scripts", "csp.js"));
const F = require(path.join(ROOT, "fileopen.js"));
const BASE = JSON.parse(read("manifest.webmanifest"));
const APPS = JSON.parse(read("apps.json")).apps;

test("every single app is a registered internal app with a page, a manifest and icons that match the table", () => {
  assert.ok(S.ids().length >= 4);
  S.ids().forEach((id) => {
    const app = APPS.find((a) => a.id === id);
    assert.ok(app && app.type === "internal", id + ": not an internal app");
    assert.equal(read(id + "/solo.html"), CSP.withPolicy(S.pageFor(id, BASE)), id + ": solo.html is stale (node tools/solo-manifests.js)");
    assert.deepEqual(JSON.parse(read(id + "/manifest.webmanifest")), S.manifestFor(id, F.table(), BASE),
      id + ": manifest is stale (node tools/solo-manifests.js)");
    ["", "-192", "-512", "-maskable-512"].forEach((k) => {
      const f = "icons/solo/" + id + k + (k ? ".png" : ".svg");
      assert.ok(fs.existsSync(path.join(ROOT, f)), f + " missing (node tools/solo-icons.js)");
    });
    assert.ok(S.nameOf(id, "en").startsWith("orOS "));
    assert.ok(S.nameOf(id, "el").startsWith("orOS "));
  });
});

test("each manifest is its own app: id, scope and every action stay inside /<id>/", () => {
  S.ids().forEach((id) => {
    const m = S.manifestFor(id, F.table(), BASE);
    const scope = "/" + id + "/";
    assert.equal(m.scope, scope);
    assert.equal(m.id, scope + "solo.html");
    assert.equal(m.start_url, scope + "solo.html");
    assert.notEqual(m.id, BASE.id);
    const urls = (m.share_target ? [m.share_target.action] : []).concat(m.shortcuts.map((s) => s.url), (m.file_handlers || []).map((h) => h.action));
    urls.forEach((u) => assert.ok(u.startsWith(scope + "solo.html?"), id + ": " + u));
    if (m.share_target) assert.equal(m.share_target.method, "POST");
    assert.ok(m.icons.some((i) => i.purpose === "maskable"));
    assert.equal(m.launch_handler, undefined);   // Dropbox sign-in comes back as a navigation
  });
});

test("file types: a single app opens exactly the types its app opens in orOS", () => {
  const notes = S.manifestFor("notes", F.table(), BASE).file_handlers[0];
  assert.deepEqual(notes.accept, { "text/plain": [".txt"], "text/markdown": [".md", ".markdown"], "application/x-oros-notes": [".orosnotes"] });
  assert.equal(notes.action, "/notes/solo.html?file-open=notes");
  assert.deepEqual(S.manifestFor("calendar", F.table(), BASE).file_handlers[0].accept,
    { "text/calendar": [".ics"], "application/x-oros-cal": [".oroscal"] });
  // phase 4b: a record app opens its own .oros<word> file
  assert.deepEqual(S.manifestFor("todo", F.table(), BASE).file_handlers[0].accept, { "application/x-oros-tasks": [".orostasks"] });
  assert.deepEqual(S.manifestFor("bookmarks", F.table(), BASE).file_handlers[0].accept, { "application/x-oros-bookmarks": [".orosbookmarks"] });
  assert.equal(S.manifestFor("passwords", F.table(), BASE).file_handlers, undefined);
  assert.deepEqual(S.manifestFor("calendar", F.table(), BASE).share_target.params.files[0].accept,
    ["text/calendar", ".ics", "application/x-oros-cal", ".oroscal"]);
  assert.deepEqual(S.manifestFor("todo", F.table(), BASE).share_target.params.files[0].accept, ["application/x-oros-tasks", ".orostasks"]);
});

test("ids come only from the table: paths and parameters cannot name anything else", () => {
  assert.equal(S.idFromPath("/notes/solo.html"), "notes");
  assert.equal(S.idFromPath("/notes/solo.html/"), "");
  assert.equal(S.idFromPath("/chess/solo.html"), "");         // not a single app (yet)
  assert.equal(S.idFromPath("/../notes/solo.html"), "");
  assert.equal(S.idFromPath("/a/notes/solo.html"), "");
  assert.equal(S.idFromSearch("?solo=todo"), "todo");
  assert.equal(S.idFromSearch("?solo=Todo"), "");
  assert.equal(S.idFromSearch("?solo=__proto__"), "");
  assert.equal(S.idFromSearch("?solo=constructor"), "");
  assert.equal(S.idFromSearch("?x=1"), "");
});

test("host → frame: only the launch parameters travel, bounded; 'do' becomes solo-do", () => {
  assert.equal(S.frameSrc("notes", ""), "/?solo=notes");
  const src = S.frameSrc("notes", "?do=new&share-text=hi&evil=1&solo=maps&open=settings&file-open=notes&share-files=abc");
  const q = new URLSearchParams(src.slice(2));
  assert.equal(q.get("solo"), "notes");
  assert.equal(q.get("solo-do"), "new");
  assert.equal(q.get("share-text"), "hi");
  assert.equal(q.get("file-open"), "notes");
  assert.equal(q.get("share-files"), "abc");
  assert.equal(q.get("evil"), null);
  assert.equal(q.get("open"), null);
  assert.equal(q.getAll("solo").length, 1);
  assert.ok(src.startsWith("/?"));
  const long = S.frameSrc("notes", "?share-text=" + "x".repeat(9000));
  assert.equal(new URLSearchParams(long.slice(2)).get("share-text").length, 4000);
  assert.equal(S.frameSrc("nope", "?do=new"), "");
});

test("icon shortcuts: every manifest shortcut maps to an action the app takes", () => {
  S.ids().forEach((id) => {
    S.manifestFor(id, F.table(), BASE).shortcuts.forEach((sc) => {
      const word = new URL(sc.url, "https://x.invalid").searchParams.get("do");
      const hit = S.shortcut(id, word);
      assert.ok(hit && (hit.target || hit.calNew), id + ": " + word);
    });
  });
  assert.deepEqual(S.shortcut("notes", "new").target, { newPage: true });
  assert.deepEqual(S.shortcut("todo", "new").target, { quickAdd: true });
  assert.deepEqual(S.shortcut("bookmarks", "add").target, { quickAdd: true });
  assert.equal(S.shortcut("calendar", "new").calNew, true);
  assert.equal(S.shortcut("notes", "toString"), null);
  assert.equal(S.shortcut("notes", "zzz"), null);
  // the receivers exist in the apps
  assert.match(read("notes/notes.js"), /t\.newPage === true/);
  assert.match(read("todo/todo.js"), /t && t\.quickAdd/);
  assert.match(read("bookmarks/bookmarks.js"), /t && t\.quickAdd/);
  assert.match(read("shell.js"), /window\.__orosOpenCalendarNew = function/);
});

test("shares: link → bookmark, text → page, task or event; nothing unusable gets through", () => {
  const now = new Date(2026, 9, 14, 10, 0);
  const s1 = S.shareFromSearch("?share-title=Read%20me&share-text=Look%20https%3A%2F%2Fexample.com%2Fa");
  assert.deepEqual(s1, { url: "https://example.com/a", title: "Read me", text: "Look https://example.com/a" });
  assert.deepEqual(S.shareTarget("bookmarks", s1, now), { app: "bookmarks", target: { add: { url: "https://example.com/a", title: "Read me" } } });
  assert.deepEqual(S.shareTarget("notes", s1, now), { app: "notes", target: { add: { title: "Read me", text: "Look https://example.com/a" } } });
  const task = S.shareTarget("todo", { url: "", title: "", text: "Buy milk\nand bread" }, now);
  assert.deepEqual(task, { app: "todo", target: { addItems: { items: [{ text: "Buy milk", note: "and bread" }] } } });
  const ev = S.shareTarget("calendar", { url: "", title: "Dentist", text: "" }, now);
  assert.deepEqual(ev, { calNew: { date: "2026-10-14", title: "Dentist", note: "" } });
  // a bookmark needs a web link
  assert.equal(S.shareTarget("bookmarks", { url: "", title: "x", text: "no link" }, now), null);
  assert.equal(S.shareFromSearch("?share-url=javascript%3Aalert(1)"), null);
  assert.equal(S.shareFromSearch("?share-url=javascript%3Aalert(1)&share-title=t").url, "");
  assert.equal(S.shareTarget("bookmarks", S.shareFromSearch("?share-url=javascript%3Aalert(1)&share-title=t"), now), null);
  assert.equal(S.shareFromSearch("?x=1"), null);
  assert.equal(S.shareFromSearch("?share-text=%20%20"), null);
  // control characters are dropped, lengths bounded
  const t = S.shareFromSearch("?share-text=" + encodeURIComponent("a\u0000b\u0007c" + "y".repeat(30000)));
  assert.ok(t.text.startsWith("abc"));
  assert.equal(t.text.length, 20000);
  assert.ok(S.shareTarget("calendar", { url: "", title: "x".repeat(300), text: "" }, now).calNew.title.length <= 80);
});

test("the shell side: solo.js loads before the shell, which has the solo hooks; sw and sync know single apps", () => {
  const idx = read("index.html");
  const i = idx.indexOf('<script src="solo.js'), j = idx.indexOf('<script src="shell.js'), k = idx.indexOf('<script src="fileopen.js');
  assert.ok(i > 0 && i < j && i < k, "solo.js must load before fileopen.js and shell.js");
  assert.match(idx, /solo-mode/);                       // update broker: background reload
  const sh = read("shell.js");
  ["function soloStart", "function soloHome", "function soloMenuButton", "function soloNotifsOnlyOwn", "if (SOLO) soloStart();",
   "if (SOLO && soloHome()) return;", "if (SOLO) { soloMenuButton(); return; }"].forEach((s) => assert.ok(sh.includes(s), s));
  const sw = read("sw.js");
  assert.match(sw, /solo\\\.html\$\/\.exec\(new URL\(request\.url\)\.pathname\)/);
  assert.match(sw, /url\.search\.indexOf\("solo="\) === -1/);
  const sy = read("sync.js");
  assert.match(sy, /SOLO_RETURN_KEY = "oros-solo-return"/);
  assert.match(sy, /ROUND_LOCK = "oros-sync-round"/);
  assert.match(read("fileopen.js"), /function soloApp\(\)/);
});

test("wave 2: shares into the office apps open a form or dialog; shortcuts reach their receivers", () => {
  const now = new Date(2026, 9, 14, 10, 0);
  const s = { url: "", title: "Plan", text: "Plan\nfirst\nsecond" };
  assert.deepEqual(S.shareTarget("contacts", { url: "", title: "", text: "Maria Papadopoulou\nmaria@example.com" }, now),
    { app: "contacts", target: { cardText: { text: "Maria Papadopoulou\nmaria@example.com" } } });
  assert.deepEqual(S.shareTarget("writer", s, now), { app: "writer", target: { newDoc: { title: "Plan", text: "Plan\nfirst\nsecond" } } });
  assert.deepEqual(S.shareTarget("spreadsheet", { url: "", title: "", text: "a\tb\n1\t2\n\nx,y" }, now),
    { app: "spreadsheet", target: { newSheet: { name: "", rows: [["a", "b"], ["1", "2"], ["x", "y"]] } } });
  assert.deepEqual(S.shareTarget("kanban", s, now), { app: "kanban", target: { asNew: { title: "Plan", note: "first\nsecond" } } });
  assert.deepEqual(S.shareTarget("mindmap", s, now), { app: "mindmap", target: { pasteText: { text: "Plan\nfirst\nsecond" } } });
  assert.deepEqual(S.shareTarget("wiki", s, now), { app: "wiki", target: { newArt: { title: "Plan", text: "Plan\nfirst\nsecond" } } });
  assert.deepEqual(S.shareTarget("wiki", { url: "", title: "", text: "Plan\nbody" }, now), { app: "wiki", target: { newArt: { title: "Plan", text: "body" } } });
  assert.deepEqual(S.shareTarget("slides", s, now), { app: "slides", target: { outline: "# Plan\nPlan\nfirst\nsecond", title: "Plan" } });
  ["contacts", "writer", "spreadsheet", "kanban", "mindmap", "wiki", "slides"].forEach((id) => {
    assert.equal(S.shareTarget(id, { url: "", title: "", text: "" }, now), null, id);
  });
  // the receivers exist in the apps
  [["contacts/contacts.js", /target\.newContact === true/], ["contacts/contacts.js", /CCx\.parse\(ctx\.text/],
   ["writer/writer.js", /t\.newBlank === true/], ["spreadsheet/spreadsheet.js", /tg\.newBlank === true/],
   ["kanban/kanban.js", /tg\.quickAdd === true/], ["mindmap/mindmap.js", /t\.newMap === true \|\| t\.pasteText/],
   ["wiki/wiki.js", /target\.newArt/], ["slides/app.js", /tg\.newDeck === true/]].forEach(([f, re]) => assert.match(read(f), re, f));
});

test("Install: Android goes through an intent to Chrome (the orOS app would catch the link); the page offers its install bar", () => {
  const a = S.installUrl("notes", "Mozilla/5.0 (Linux; Android 14; Pixel 8)", "https://useoros.online");
  assert.equal(a, "intent://useoros.online/notes/solo.html?install#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=" +
    encodeURIComponent("https://useoros.online/notes/solo.html?install") + ";end");
  assert.equal(S.installUrl("notes", "Mozilla/5.0 (Windows NT 10.0)", "https://useoros.online"), "/notes/solo.html?install");
  assert.equal(S.installUrl("notes", "Android", "http://127.0.0.1:8080"), "/notes/solo.html?install");
  assert.equal(S.installUrl("notes", "Android", "https://a.b/c"), "/notes/solo.html?install");
  assert.equal(S.installUrl("chess", "Android", "https://useoros.online"), "");
  // In a browser tab (Brave, Firefox, Chrome): the same browser installs it.
  assert.equal(S.installUrl("notes", "Android", "https://useoros.online", false, true), "/notes/solo.html?install");
  // In the orOS Android app: its own activity opens Chrome.
  assert.equal(S.installUrl("notes", "Android", "https://useoros.online", true),
    "intent://install/notes#Intent;scheme=oros-permission;package=online.useoros.twa;end");
  assert.equal(S.installUrl("chess", "Android", "https://useoros.online", true), "");
  assert.match(read("android/app/src/main/java/online/useoros/twa/PermissionActivity.java"), /"install"\.equals\(kind\)/);
  assert.match(read("settings/settings.js"), /S\.installUrl\(id, navigator\.userAgent, location\.origin, !!phone\(\), inBrowserTab\(\)\)/);
  const src = read("solo.js");
  assert.match(src, /addEventListener\("beforeinstallprompt"/);
  assert.match(src, /installBar\(win, id, asked\)/);
});

test("wave 3: personal apps — shares only where a text means something, shortcuts reach their receivers", () => {
  const now = new Date(2026, 9, 14, 10, 0);
  assert.deepEqual(S.shareTarget("passwords", { url: "https://shop.example/login", title: "Shop", text: "" }, now),
    { app: "passwords", target: { newEntry: { title: "Shop", url: "https://shop.example/login" } } });
  assert.equal(S.shareTarget("passwords", { url: "", title: "x", text: "no link" }, now), null);
  assert.deepEqual(S.shareTarget("budget", { url: "", title: "", text: "Coffee 3.50\nwith Anna" }, now),
    { app: "budget", target: { newTx: { n: "Coffee 3.50" } } });
  assert.deepEqual(S.shareTarget("habits", { url: "", title: "", text: "Read 10 pages" }, now),
    { app: "habits", target: { asNew: { name: "Read 10 pages" } } });
  assert.deepEqual(S.shareTarget("fitness", { url: "", title: "", text: "Ran 5 km" }, now),
    { app: "fitness", target: { asNew: { note: "Ran 5 km" } } });
  // no text share; the share target only carries the app's own file (phase 4b)
  ["water", "diary", "mood", "health", "cycle"].forEach((id) => {
    assert.equal(S.shareTarget(id, { url: "", title: "x", text: "y" }, now), null, id);
    const st = S.manifestFor(id, F.table(), BASE).share_target;
    assert.deepEqual(st.params.files[0].accept, F.table().filter((h) => h.app === id)
      .flatMap((h) => Object.keys(h.accept).flatMap((m) => [m].concat(h.accept[m]))), id);
    assert.ok(st.params.files[0].accept.every((x) => /^(application\/x-oros-[a-z]+|\.oros[a-z]+)$/.test(x)), id);
  });
  assert.ok(S.manifestFor("health", F.table(), BASE).shortcuts.length === 2);
  [["passwords/passwords.js", /tg\.gen === true/], ["passwords/pmapp.js", /addEntry: function/],
   ["passwords/passwords.js", /__orosTakeTarget\("passwords"\)/], ["budget/budget.js", /x\.newTx && typeof x\.newTx === "object"/],
   ["habits/habits.js", /t\.add === true/], ["water/water.js", /tg\.sip !== "glass"/], ["mood/mood.js", /tg\.checkin === true/],
   ["mood/mood.js", /__orosTakeTarget\("mood"\)/], ["fitness/fitness.js", /t\.logNew === true/],
   ["health/health.js", /typeof t\.add === "string"/], ["cycle/cycle.js", /t\.today === true/]].forEach(([f, re]) => assert.match(read(f), re, f));
});

test("wave 4: tools and media — places, links and mail shares; shortcuts reach their receivers", () => {
  const now = new Date(2026, 9, 14, 10, 0);
  assert.deepEqual(S.shareTarget("maps", { url: "", title: "", text: "Acropolis Museum\ngeo:37.9684,23.7286?q=Acropolis" }, now),
    { app: "maps", target: { asNew: { name: "Acropolis Museum", lat: 37.9684, lon: 23.7286 } } });
  assert.deepEqual(S.shareTarget("maps", { url: "https://maps.example/x", title: "", text: "Cafe Nikos https://maps.example/x" }, now),
    { app: "maps", target: { asNew: { name: "Cafe Nikos", query: "Cafe Nikos" } } });
  assert.equal(S.shareTarget("maps", { url: "https://maps.example/x", title: "", text: "https://maps.example/x" }, now), null);
  assert.deepEqual(S.shareTarget("feeds", { url: "https://blog.example/", title: "", text: "" }, now), { app: "feeds", target: { add: { url: "https://blog.example/" } } });
  assert.deepEqual(S.shareTarget("podcasts", { url: "https://pod.example/rss", title: "", text: "" }, now), { app: "podcasts", target: { add: { url: "https://pod.example/rss" } } });
  assert.equal(S.shareTarget("feeds", { url: "", title: "", text: "no link" }, now), null);
  assert.deepEqual(S.shareTarget("mail", { url: "", title: "Trip", text: "See you at 9" }, now),
    { app: "mail", target: { compose: { subject: "Trip", body: "See you at 9" } } });
  ["calculator", "time", "weather", "files", "radio"].forEach((id) => assert.equal(S.manifestFor(id, F.table(), BASE).share_target, undefined, id));
  assert.ok(S.manifestFor("photolab", F.table(), BASE).share_target.params.files[0].accept.includes(".png"));
  [["calculator/calculator.js", /MODES\.indexOf\(t\.mode\)/], ["calculator/calculator.js", /__orosTakeTarget\("calculator"\)/],
   ["time/astro.js", /typeof pending\.pane === "string"/], ["weather/weather.js", /t\.addCity === true/],
   ["weather/weather.js", /__orosTakeTarget\("weather"\)/], ["maps/maps.js", /target\.locate === true/],
   ["maps/tools.js", /target\.park/], ["feeds/feeds.js", /x\.addBlank === true/], ["mail/mail.js", /var c = target\.compose/],
   ["files/files.js", /t\.newFolder === true/], ["podcasts/podcasts.js", /x\.find === true/],
   ["radio/radio.js", /t\.play === "last"/], ["radio/radio.js", /__orosTakeTarget\("radio"\)/],
   ["photolab/app.js", /target\.newPic === true/]].forEach(([f, re]) => assert.match(read(f), re, f));
});

test("wave 5: business — invoice and customer shares; shortcuts reach their receivers", () => {
  const now = new Date(2026, 9, 14, 10, 0);
  assert.deepEqual(S.shareTarget("invoices", { url: "", title: "Logo design", text: "3 drafts, 2 revisions" }, now),
    { app: "invoices", target: { newDoc: "inv", notes: "Logo design\n3 drafts, 2 revisions" } });
  assert.equal(S.shareTarget("invoices", { url: "", title: "", text: "  " }, now), null);
  assert.deepEqual(S.shareTarget("crm", { url: "", title: "", text: "Maria Papadopoulou <maria@example.gr>\nTel +30 210 123 4567\nMet at the fair" }, now),
    { app: "crm", target: { asNew: { name: "Maria Papadopoulou", note: "Tel +30 210 123 4567\nMet at the fair", email: "maria@example.gr", phone: "+30 210 123 4567" } } });
  assert.deepEqual(S.shareTarget("crm", { url: "", title: "", text: "nikos@shop.example" }, now),
    { app: "crm", target: { asNew: { name: "nikos", note: "", email: "nikos@shop.example" } } });
  assert.deepEqual(S.manifestFor("timesheet", F.table(), BASE).share_target.params.files[0].accept,
    ["application/x-oros-hours", ".oroshours"]);                // its own file only (phase 4b)
  assert.deepEqual(S.APPS.invoices.shortcuts.map((x) => x.target.newDoc), ["inv", "rcpt"]);
  [["invoices/invoices.js", /tg\.newDoc === "inv" \|\| tg\.newDoc === "rcpt"/], ["invoices/invoices.js", /x\.notes = notes/], ["crm/crm.js", /if \(x\.newCust\)/],
   ["timesheet/timesheet.js", /if \(t\.toggle\) \{ window\.__orosTimesheetToggle\(\)/], ["timesheet/timesheet.js", /if \(t\.newEntry\)/]
  ].forEach(([f, re]) => assert.match(read(f), re, f));
});

test("wave 6: orOS Games — every game in one app, Daily shortcuts, .pgn through Chess", () => {
  assert.equal(S.nameOf("gamecenter", "el"), "orOS Παιχνίδια");
  assert.deepEqual(S.APPS.gamecenter.shortcuts.map((x) => x.target.play), ["wordle", "crossword", "sudoku", "chess"]);
  const m = S.manifestFor("gamecenter", F.table(), BASE);
  assert.deepEqual(m.file_handlers[0].accept, { "application/x-chess-pgn": [".pgn"] });
  assert.equal(S.shareTarget("gamecenter", { url: "", title: "", text: "hi" }, new Date()), null);
  assert.equal(S.manifestFor("chess", F.table(), BASE), null);
  assert.match(read("gamecenter/gamecenter.js"), /typeof tg\.play === "string" && CORE\.GAMES\.indexOf\(tg\.play\) >= 0/);
  assert.match(read("gamecenter/gamecenter.js"), /openTarget\(DK \? DK\.takeTarget\("gamecenter"\) : null\)/);
});

test("Android APKs: every single app has a package, an assetlinks entry and an APK link", () => {
  const pk = JSON.parse(read("android/solo-apps.json")).apps;
  const links = JSON.parse(read(".well-known/assetlinks.json")).map((x) => x.target.package_name);
  assert.deepEqual(Object.keys(pk).sort(), S.ids().slice().sort());
  Object.keys(pk).forEach((id) => {
    assert.match(pk[id], /^online\.useoros\.[a-z]+$/, id);
    assert.ok(links.includes(pk[id]), "assetlinks: " + pk[id]);
    assert.equal(S.apkUrl(id), "https://github.com/koulaxizis/oros/releases/download/android-apks/oros-" + id + ".apk");
  });
  assert.equal(new Set(Object.values(pk)).size, Object.keys(pk).length);
  assert.equal(S.apkUrl("nope"), "");
  assert.match(read("settings/settings.js"), /S\.apkUrl && \/Android\/i\.test\(navigator\.userAgent\)/);
  assert.match(read("settings/settings.js"), /S\.apkHref\(id, navigator\.userAgent, !inBrowserTab\(\), phone\(\) \? "online\.useoros\.twa" : ""\)/);
  assert.match(read("solo.js"), /k\.href = apkHref\(id, win\.navigator\.userAgent, true\)/);
  // In an installed app on Android the link asks Chrome for a real tab:
  // the in-app tab never finishes an APK download (Chris 2026-10-15)
  const and = "Mozilla/5.0 (Linux; Android 14) Chrome/140 Mobile";
  const u = S.apkUrl("notes");
  assert.equal(S.apkHref("notes", and, false), u);
  assert.equal(S.apkHref("notes", "Mozilla/5.0 (Windows NT 10.0)", true), u);
  assert.equal(S.apkHref("notes", and, true),
    "intent://github.com/koulaxizis/oros/releases/download/android-apks/oros-notes.apk#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=" + encodeURIComponent(u) + ";end");
  assert.match(S.apkHref("oros", and, true), /^intent:\/\/github\.com\/.+\/oros\.apk#Intent;/);
  assert.equal(S.apkHref("nope", and, true), "");
});

test("F-Droid repo (FDROID-1): packages, links, launch version and metadata for every APK", () => {
  const pk = JSON.parse(read("android/solo-apps.json")).apps;
  Object.keys(pk).forEach((id) => {
    assert.equal(S.pkgOf(id), pk[id], id);
    assert.equal(S.obtainiumLink(id), "obtainium://add/https://koulaxizis.github.io/oros-fdroid/repo?appId=" + pk[id]);
  });
  assert.equal(S.pkgOf("oros"), "online.useoros.twa");
  assert.equal(S.pkgOf("nope"), "");
  assert.match(S.repoLink(), /^fdroidrepos:\/\/koulaxizis\.github\.io\/oros-fdroid\/repo\?fingerprint=[0-9A-F]{64}$/);
  assert.equal(S.apkCode("?apk=2025007"), 2025007);
  assert.equal(S.apkCode("?source=pwa&apk=2025007"), 2025007);
  assert.equal(S.apkCode("?apk=x1"), 0);
  assert.equal(S.apkCode(""), 0);
  // The metadata tool covers exactly the APKs the android workflow publishes
  const M = require(path.join(ROOT, "tools", "fdroid-metadata.js"));
  const l = M.list();
  // orOS Drive (DRIVE-APP) is built from koulaxizis/oros-drive by the same workflow
  assert.deepEqual(l.map((a) => a.apk).sort(), ["oros.apk", "oros-drive.apk"].concat(Object.keys(pk).map((id) => "oros-" + id + ".apk")).sort());
  assert.ok(!pk.drive, "a single app called drive would publish a second oros-drive.apk");
  const dr = l.find((a) => a.id === "drive");
  assert.equal(dr.pkg, "online.useoros.drive");
  assert.equal(M.texts(dr, "el").name, "orOS Drive");
  l.forEach((a) => {
    assert.ok(fs.existsSync(a.icon), a.icon);
    ["en", "el"].forEach((lg) => {
      const t = M.texts(a, lg);
      assert.ok(t.name && t.summary.length <= 80 && t.description, a.id + " " + lg);
    });
  });
  // Settings shows the repo links; the workflow uses the same key alias and address
  assert.match(read("settings/settings.js"), /S\.repoLink\(\)/);
  const wf = read(".github/workflows/fdroid.yml");
  assert.match(wf, /repo_keyalias: orosrepo/);
  assert.match(wf, /SITE: https:\/\/koulaxizis\.github\.io\/oros-fdroid/);
  assert.match(wf, /versions\.json/);
  // Each build gets its own file name in the repository (a fixed oros.apk
  // made F-Droid report "Hash not matching" and HTTP 416 after an update)
  assert.match(wf, /mv "\$f" "\$fd\/repo\/\$\{pkg\}_\$\{code\}_\$\{sum\}\.apk"/);
});

test("F-Droid store listing (FDROID-2): texts, categories, pictures and front page", () => {
  const M = require(path.join(ROOT, "tools", "fdroid-metadata.js"));
  const CATS = ["Connectivity", "Development", "Games", "Graphics", "Internet", "Money", "Multimedia", "Navigation", "Phone & SMS",
    "Reading", "Science & Education", "Security", "Sports & Health", "System", "Theming", "Time", "Writing", "Office"];
  const dir = path.join(ROOT, "tools", "fdroid");
  const ids = new Set(M.list().map((a) => a.id));
  fs.readdirSync(dir).forEach((id) => {
    assert.ok(ids.has(id), "tools/fdroid/" + id + " is not a published app");
    const t = JSON.parse(fs.readFileSync(path.join(dir, id, "texts.json"), "utf8"));
    assert.ok(CATS.includes(t.category), id + " category " + t.category);
    ["en", "el"].forEach((l) => {
      assert.ok(t[l].summary.length <= 80 && !/\.$/.test(t[l].summary), id + " " + l + " summary");
      assert.ok(t[l].description.length > 200 && t[l].description.length < 4000, id + " " + l + " description");
      assert.ok(!/google/i.test(t[l].summary + t[l].description), id + " mentions Google");
      // screenshotsLater: an app whose phone screenshots are still to come (orOS Drive, DRIVE-APP wave 5)
      assert.ok(M.shots(id, l).length >= 2 || t.screenshotsLater === true, id + " " + l + " screenshots");
    });
    assert.ok(M.feature(id), id + " feature.jpg");
  });
  // Metadata and front page land where fdroid and Pages expect them
  const tmp = fs.mkdtempSync(path.join(require("os").tmpdir(), "fd-"));
  M.write(tmp);
  const m = path.join(tmp, "metadata", "online.useoros.notes");
  assert.match(fs.readFileSync(m + ".yml", "utf8"), /Categories:\n {2}- Writing\n/);
  assert.ok(fs.existsSync(path.join(m, "en-US", "featureGraphic.jpg")));
  assert.ok(fs.existsSync(path.join(m, "el", "phoneScreenshots", "1.jpg")));
  const html = fs.readFileSync(path.join(tmp, "site", "index.html"), "utf8");
  assert.ok(html.includes("https://fdroid.link/#https://koulaxizis.github.io/oros-fdroid/repo?fingerprint="));
  assert.ok(html.includes('src="repo/index.png"'));
  M.list().forEach((a) => assert.ok(fs.existsSync(path.join(tmp, "site", "icons", a.pkg + ".png")), a.pkg));
  fs.rmSync(tmp, { recursive: true, force: true });
  // Store-only changes republish the repository
  const wf = read(".github/workflows/fdroid.yml");
  assert.match(wf, /paths: \['tools\/fdroid-metadata\.js', 'tools\/fdroid-keep\.js', 'tools\/fdroid\/\*\*', '\.github\/workflows\/fdroid\.yml'\]/);
  assert.match(wf, /tools\/fdroid-metadata\.js tools\/fdroid-keep\.js tools\/fdroid\n/);
  assert.match(wf, /cp -r "\$fd\/site\/\." "\$site\/"/);
});

test("Official F-Droid prerequisites (FDROID-3): Gradle version and android-v tags", () => {
  const ci = read(".github/workflows/android.yml").match(/gradle-version: ([\d.]+)/)[1];
  const wrap = read("android/gradle/wrapper/gradle-wrapper.properties");
  assert.ok(wrap.includes("gradle-" + ci + "-bin.zip"), "wrapper and CI use the same Gradle");
  assert.match(wrap, /distributionSha256Sum=[0-9a-f]{64}/);
  const wf = read(".github/workflows/fdroid.yml");
  assert.match(wf, /contents: write/);
  assert.match(wf, /git tag "android-v\$v" HEAD/);
  assert.match(wf, /git diff --quiet "\$last" HEAD -- android phone\.js/);
  // F-Droid signs its own build, so it must not point users at our APKs
  const gen = path.join(ROOT, "android", "tools", "gen.js");
  const launch = (args) => require("child_process").execFileSync(process.execPath, ["-e",
    "const fs=require('fs');const {build}=require(" + JSON.stringify(gen) + ");" +
    "const o=build(JSON.parse(fs.readFileSync(" + JSON.stringify(path.join(ROOT, "manifest.webmanifest")) + ",'utf8')));" +
    "console.log(/<string name=\"launchUrl\">([^<]*)/.exec(o['res/values/web_manifest.xml'])[1])", "--"].concat(args), { encoding: "utf8" }).trim();
  assert.match(launch([]), /[?;]apk=\d+$/);
  assert.doesNotMatch(launch(["--no-apk"]), /apk=/);
});

test("APK links leave the Android app through BrowserActivity (default browser, normal tab)", () => {
  const and = "Mozilla/5.0 (Linux; Android 14) Chrome/140 Mobile";
  const u = S.apkUrl("notes");
  const viaApp = "intent://open?u=" + encodeURIComponent(u) + "#Intent;scheme=oros-browser;package=online.useoros.notes;S.browser_fallback_url=" + encodeURIComponent(u) + ";end";
  assert.equal(S.apkHref("notes", and, true, "online.useoros.notes"), viaApp);
  assert.equal(S.apkHref("notes", and, false, "online.useoros.notes"), u);          // a browser tab: the plain link
  assert.match(S.apkHref("notes", and, true, ""), /package=com\.android\.chrome/); // Chrome's installed orOS
  assert.equal(S.browserHref("https://useoros.online/download/", "evil.pkg"), "https://useoros.online/download/");
  // apkPkgOf: referrer of the TWA, or the remembered launch version; never in a browser tab
  const win = (tab, ref, store) => ({
    matchMedia: () => ({ matches: tab }),
    document: { referrer: ref },
    localStorage: { getItem: () => store }
  });
  assert.equal(S.apkPkgOf(win(false, "android-app://online.useoros.twa/", null), "oros"), "online.useoros.twa");
  assert.equal(S.apkPkgOf(win(false, "", JSON.stringify({ installed: { "online.useoros.notes": 2026001 } })), "notes"), "online.useoros.notes");
  assert.equal(S.apkPkgOf(win(true, "android-app://online.useoros.twa/", null), "oros"), "");
  assert.equal(S.apkPkgOf(win(false, "", null), "notes"), "");
  // The Android side: BrowserActivity in every flavour, accepting only orOS links
  const ba = read("android/app/src/main/java/online/useoros/twa/BrowserActivity.java");
  assert.match(ba, /oros\(-\[a-z0-9\]\{1,40\}\)\?\\\\\.apk/);
  assert.match(ba, /https:\/\/useoros\\\\\.online\/download\//);
  const gen = read("android/tools/gen.js");
  assert.match(gen, /<activity android:name="\.BrowserActivity"/);
  assert.match(gen, /<data android:scheme="oros-browser" \/>/);
  assert.ok(!/\["activity", "\.BrowserActivity"\]/.test(gen), "single apps keep BrowserActivity");
  // The menu's Get orOS row uses it in the orOS app
  assert.match(read("shell.js"), /S\.browserHref\("https:\/\/useoros\.online\/" \+ page, pkg\)/);
});
