// "Send to an app" (send/core.js, BR-SEND): the kind normalizers, which
// installed apps the sheet offers, the targets it hands to each app's
// own deep link, and the receiving apps' code that those targets rely on.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const C = require(path.join(ROOT, "send/core.js"));
const src = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const ALL = C.ORDER.slice();

test("text: control characters out, CRLF → LF, title one line, empty text refused", () => {
  const d = C.norm("text", { title: "  My\n\tpage\u0000 ", text: "a\r\nb\u0007c\u2028d" });
  assert.deepEqual(d, { title: "My page", text: "a\nb c d" });
  assert.equal(C.norm("text", { title: "x", text: "   \n " }), null);
  assert.equal(C.norm("text", { text: 5 }), null);
  assert.equal(C.norm("text", null), null);
  assert.equal(C.norm("nope", { text: "x" }), null);
  assert.equal(C.norm("text", { text: "x".repeat(300000) }).text.length, 200000);
});

test("link: only http(s), capped", () => {
  assert.equal(C.norm("link", { url: "javascript:alert(1)" }), null);
  assert.equal(C.norm("link", { url: "data:text/html,x" }), null);
  assert.equal(C.norm("link", { url: "https://" }), null);
  const d = C.norm("link", { url: " https://example.org/a?b=1 ", title: "Ex", note: "n".repeat(2000) });
  assert.equal(d.url, "https://example.org/a?b=1");
  assert.equal(d.note.length, 1000);
});

test("items and table: caps, junk dropped, nothing usable → null", () => {
  const it = C.norm("items", { title: "Shop", items: [" milk ", { text: "" }, { text: "bread", note: "whole" }, 7, null] });
  assert.deepEqual(it, { title: "Shop", items: [{ text: "milk", note: "" }, { text: "bread", note: "whole" }] });
  assert.equal(C.norm("items", { items: ["", { text: " " }] }), null);
  assert.equal(C.norm("items", { items: Array(300).fill("x") }).items.length, 200);
  const tb = C.norm("table", { name: "T", rows: [["a", 1, NaN, { x: 1 }, "=SUM(A1)"], "bad", []], sum: [1, -1, 1.5, "2"] });
  assert.deepEqual(tb.rows, [["a", 1, "", "", "=SUM(A1)"], []]);
  assert.deepEqual(tb.sum, [1]);
  assert.equal(C.norm("table", { rows: [["", ""]] }), null);
  assert.equal(C.norm("table", { rows: Array(600).fill(["x"]) }).rows.length, 500);
  assert.equal(C.norm("table", { rows: [Array(100).fill(1)] }).rows[0].length, 64);
});

test("the sheet offers installed apps only, never the sender, in ORDER", () => {
  const text = { title: "T", text: "hello\nworld" };
  assert.deepEqual(C.appsFor("text", text, ALL, "notes"),
    ["todo", "writer", "mail", "kanban", "whiteboard", "slides", "forms", "crm", "wiki", "diary", "mindmap", "prompter", "flashcards", "typing", "qr", "assistant", "texttools"]);
  assert.deepEqual(C.appsFor("text", text, ["writer", "mail", "calculator"], ""), ["writer", "mail"]);
  assert.deepEqual(C.appsFor("link", { url: "https://a.b" }, ALL, "bookmarks"), ["notes", "todo", "writer", "mail", "kanban", "diary", "qr", "assistant"]);
  assert.deepEqual(C.appsFor("items", { items: ["a"] }, ALL, ""), ["notes", "todo", "writer", "mail", "kanban", "whiteboard", "slides", "spreadsheet", "base", "forms", "wiki", "diary", "mindmap", "flashcards", "texttools"]);
  assert.deepEqual(C.appsFor("table", { rows: [["a"]] }, ALL, ""), ["writer", "mail", "spreadsheet", "texttools"]);
  assert.deepEqual(C.appsFor("text", { text: "" }, ALL, ""), []);
});

test("Label Maker only for one short line", () => {
  assert.ok(C.appsFor("text", { text: "Pantry: rice" }, ALL, "").includes("labels"));
  assert.ok(!C.appsFor("text", { text: "two\nlines" }, ALL, "").includes("labels"));
  assert.ok(!C.appsFor("text", { text: "x".repeat(41) }, ALL, "").includes("labels"));
  assert.deepEqual(C.target("labels", "text", { text: "  Rice  " }), { text: "Rice" });
  assert.equal(C.target("labels", "text", { text: "a\nb" }), null);
});

test("targets are each app's own deep-link shapes", () => {
  const text = { title: "Plan", text: "- buy milk\n2. call Anna\n\n[x] pay rent" };
  assert.deepEqual(C.target("notes", "text", text), { add: { title: "Plan", text: text.text } });
  assert.deepEqual(C.target("writer", "text", text), { newDoc: { title: "Plan", text: text.text } });
  assert.deepEqual(C.target("todo", "text", text, "Notes"), { addItems: { from: "Notes",
    items: [{ text: "buy milk", note: "" }, { text: "call Anna", note: "" }, { text: "pay rent", note: "" }] } });
  assert.deepEqual(C.target("mail", "text", text), { compose: { subject: "Plan", body: text.text } });
  assert.deepEqual(C.target("assistant", "text", text), { ask: text.text });
  assert.deepEqual(C.target("wiki", "text", text), { addArticle: { t: "Plan", x: text.text } });
  assert.deepEqual(C.target("texttools", "text", text), { text: text.text });
  assert.equal(C.target("bookmarks", "text", text), null);
  assert.equal(C.target("spreadsheet", "text", text), null);

  const link = { url: "https://ex.org", title: "Ex", note: "why" };
  assert.deepEqual(C.target("bookmarks", "link", link), { add: { url: "https://ex.org", title: "Ex" } });
  assert.deepEqual(C.target("notes", "link", link), { add: { title: "Ex", text: "Ex\nhttps://ex.org\n\nwhy" } });
  assert.deepEqual(C.target("todo", "link", link, "Feeds"), { addItems: { from: "Feeds", items: [{ text: "Ex", note: "https://ex.org\nwhy" }] } });

  const items = { title: "Groceries", items: [{ text: "milk", note: "2 l" }, "bread"] };
  assert.deepEqual(C.target("todo", "items", items, "Meals"), { addItems: { from: "Meals", newList: "Groceries",
    items: [{ text: "milk", note: "2 l" }, { text: "bread", note: "" }] } });
  assert.deepEqual(C.target("spreadsheet", "items", items), { newSheet: { name: "Groceries", rows: [["milk", "2 l"], ["bread"]] } });
  assert.deepEqual(C.target("notes", "items", items).add.text, "- milk (2 l)\n- bread");

  const table = { name: "Hours", rows: [["Day", "h"], ["Mon", 3]], sum: [1] };
  assert.deepEqual(C.target("spreadsheet", "table", table), { newSheet: { name: "Hours", rows: [["Day", "h"], ["Mon", 3]], sum: [1] } });
  assert.deepEqual(C.target("writer", "table", table), { newDoc: { title: "Hours", rows: [["Day", "h"], ["Mon", 3]] } });
});

test("caps follow each receiver's own limit", () => {
  const big = { title: "B", text: "y".repeat(150000) };
  assert.equal(C.target("notes", "text", big).add.text.length, 20000);
  assert.equal(C.target("mail", "text", big).compose.body.length, 20000);
  assert.equal(C.target("assistant", "text", big).ask.length, 20000);
  assert.equal(C.target("writer", "text", big).newDoc.text.length, 150000);
});

test("summary line in both languages", () => {
  assert.equal(C.summary("items", { title: "Shop", items: ["a", "b"] }, "en"), "List · Shop · 2 items");
  assert.equal(C.summary("items", { title: "Shop", items: ["a", "b"] }, "el"), "Λίστα · Shop · 2 στοιχεία");
  assert.equal(C.summary("link", { url: "https://a.b" }, "en"), "Link · https://a.b");
  assert.equal(C.summary("text", { text: "" }, "en"), "");
});

// The receivers really read these shapes (a renamed key would silently
// make the sheet open an app that does nothing).
test("every receiver's app code takes the target it is sent", () => {
  const need = {
    notes: ["notes/notes.js", ["t.add", "t.add.title", "t.add.text"]],
    writer: ["writer/writer.js", ["t.newDoc", "t.newDoc.text", "t.newDoc.title", "t.newDoc.rows"]],
    todo: ["todo/todo.js", ["addItems"]],
    mail: ["mail/mail.js", ["target.compose", "c.subject", "c.body"]],
    assistant: ["assistant/assistant.js", ["tg.ask"]],
    bookmarks: ["bookmarks/bookmarks.js", ["t.add"]],
    wiki: ["wiki/wiki.js", ["target.addArticle", "o.t", "o.x"]],
    spreadsheet: ["spreadsheet/spreadsheet.js", ["tg.newSheet", "p.rows", "p.sum"]],
    base: ["base/app.js", ["tg.newTable", "nt.rows", "nt.name"]],
    texttools: ["texttools/texttools.js", ["tg.text"]],
    labels: ["labels/labels.js", ["target.text"]],
    slides: ["slides/app.js", ["tg.outline", "tg.title"]],
    mindmap: ["mindmap/mindmap.js", ["t.pasteText", "t.pasteText.text"]],
    kanban: ["kanban/kanban.js", ["tg.addCards", "T.asCards"]],
    prompter: ["prompter/prompter.js", ["tg.newPrompt", "tg.newPrompt.text"]],
    layout: ["layout/layout.js", ["placeImage"]],
    flashcards: ["flashcards/app.js", ["target.make", "FlashcardsMake"]],
    typing: ["typing/app.js", ["target.addText", "target.addText.text"]],
    // wave A3
    contacts: ["contacts/contacts.js", ["target.cardText", "ctx.text"]],
    maps: [["maps/maps.js", "maps/tracks.js"], ["target.asNew", "x.query", "pendingTarget"]],
    invoices: ["invoices/invoices.js", ['tg["new"]', "prefillNew"]],
    diary: ["diary/diary.js", ["target.write", "w.date", "w.text"]],
    // files wave (BR-SEND-12)
    transfer: ["transfer/app.js", ["target.send", "takeSend"]],
    photolab: ["photolab/app.js", ["target.openFile", "openDiskPath"]],
    scanpdf: [["scanpdf/scanpdf.js", "scanpdf/core.js"], ["t.paths", "addPaths"]],
    library: ["library/app.js", ["target.path", "LIB.home.openPath"]],
    // gap review proposal 5
    qr: ["qr/qr.js", ["tg.make", "mk.fields", "newDraft"]],
    whiteboard: ["whiteboard/app.js", ["target.addNotes", "addNotes(target.addNotes.notes)"]],
    forms: ["forms/app.js", ["tg.draft", "LK.fromDraft"]],
    crm: ["crm/crm.js", ["x.logNote", "x.logNote.text"]]
  };
  // Through the shell: Music and Atelier take a File as a token (BR-FO-4).
  const viaFile = {
    music: ["music/music.js", ["tg.playPath", "openFileTarget", "__orosTakeFile"]],
    atelier: ["atelier/core.js", ["tg.openFile", "takeOpenFile", "__orosTakeFile"]]
  };
  // Calendar and Budget open through the shell's openers (C.via), tested
  // in tests/send-detect.test.js.
  const via = Object.keys(C.RECEIVERS).filter((id) => C.via(id));
  assert.deepEqual(via.sort(), ["atelier", "budget", "calendar", "music", "wallpaper"]);
  for (const app of Object.keys(viaFile)) {
    assert.equal(C.via(app), "file");
    const s = src(viaFile[app][0]);
    for (const k of viaFile[app][1]) assert.ok(s.includes(k), app + " reads " + k);
  }
  assert.deepEqual(Object.keys(need).concat(via).sort(), Object.keys(C.RECEIVERS).sort());
  for (const app of Object.keys(need)) {
    const [file, keys] = need[app];
    const s = [].concat(file).map(src).join("\n");
    assert.match(s, /window\.__orosOpenAt\s*=/, app + " has a live deep-link receiver");
    const staged = new RegExp("__orosTakeTarget\\(\\s*['\"]" + app + "['\"]").test(s) ||
      (/__orosTakeTarget\(\s*APP_ID\s*\)/.test(s) && new RegExp("APP_ID\\s*=\\s*['\"]" + app + "['\"]").test(s));
    assert.ok(staged, app + " takes a staged target at boot");
    for (const k of keys) assert.ok(s.includes(k), app + " reads " + k);
  }
});

test("shell and sheet: loaded on demand, no innerHTML from data", () => {
  const shell = src("shell.js");
  assert.match(shell, /window\.orosSend = \{/);
  assert.match(shell, /load\("send\/core\.js"\)/);
  assert.match(shell, /load\("send\/sheet\.js"\)/);
  assert.doesNotMatch(src("index.html"), /send\/(core|sheet)\.js/);
  const sheet = src("send/sheet.js");
  assert.doesNotMatch(sheet, /innerHTML|insertAdjacentHTML|outerHTML/);
  assert.doesNotMatch(src("send/core.js"), /innerHTML|localStorage|sessionStorage|fetch\(/);
});

test("senders: Writer, Notes, Wiki, Mail, Bookmarks, Feeds and the office apps call orosSend", () => {
  for (const f of ["writer/writer.js", "notes/notes.js", "wiki/wiki.js", "mail/mail.js", "bookmarks/bookmarks.js", "feeds/feeds.js",
    "spreadsheet/spreadsheet.js", "slides/editor.js", "mindmap/mindmap.js", "kanban/kanban.js",
    "pixel/pixel.js", "photolab/io.js", "atelier/io.js", "studio/studio.js", "capture/app.js", "layout/io.js"]) {
    assert.match(src(f), /orosSend/, f);
  }
});

test("Flashcards takes text, lists, articles and two-column tables (Flashcards wave 4)", () => {
  assert.deepEqual(C.target("flashcards", "text", { title: "Spanish", text: "hola :: hello" }), { make: { title: "Spanish", text: "hola :: hello" } });
  assert.deepEqual(C.target("flashcards", "items", { title: "L", items: [{ text: "perro", note: "dog\nanimal" }, "gato"] }),
    { make: { title: "L", text: "perro :: dog animal\ngato" } });
  // An article from Reader: its text rides in the note; a bare link has nothing to learn.
  assert.deepEqual(C.target("flashcards", "link", { url: "https://a.b", title: "News", note: "The ==sun== is a star." }),
    { make: { title: "News", text: "The ==sun== is a star." } });
  assert.equal(C.target("flashcards", "link", { url: "https://a.b", title: "News" }), null);
  assert.deepEqual(C.target("typing", "text", { title: "Poem", text: "Σα βγεις" }), { addText: { title: "Poem", text: "Σα βγεις" } });
  assert.equal(C.target("typing", "link", { url: "https://a.b", title: "News" }), null);
  // A table: row 1 is the heading row; at least one later row needs two cells.
  assert.deepEqual(C.target("flashcards", "table", { name: "W", rows: [["Word", "Meaning"], ["perro", "dog"]] }),
    { make: { title: "W", rows: [["Word", "Meaning"], ["perro", "dog"]] } });
  assert.equal(C.target("flashcards", "table", { rows: [["Word", "Meaning"], ["perro", ""]] }), null);
  assert.ok(C.appsFor("table", { rows: [["a", "b"]] }, ALL, "").includes("flashcards"));
});

test("Layout takes one picture from the disk (wave 5)", () => {
  const one = { items: [{ path: "/internal/Pictures/cat.png", name: "cat.png" }] };
  assert.deepEqual(C.appsFor("files", one, ALL, ""), ["mail", "transfer", "photolab", "scanpdf", "layout", "atelier", "wallpaper"]);
  assert.deepEqual(C.target("layout", "files", one), { placeImage: { path: "/internal/Pictures/cat.png", name: "cat.png" } });
  assert.equal(C.target("layout", "files", { items: [{ path: "/internal/Docs/a.pdf", name: "a.pdf" }] }), null);
  assert.equal(C.target("layout", "files", { items: [one.items[0], { path: "/internal/Pictures/b.jpg", name: "b.jpg" }] }), null);
});

test("files wave: Transfer, Photo Lab, Scan & PDF, Music, Library, Atelier, Wallpaper (BR-SEND-12)", () => {
  const f = (p) => ({ path: p, name: p.replace(/^.*\//, "") });
  const pdf = { items: [f("/internal/Layout/PDF/Book.pdf")] };
  assert.deepEqual(C.appsFor("files", pdf, ALL, "layout"), ["mail", "transfer", "scanpdf", "library"]);
  assert.deepEqual(C.target("scanpdf", "files", pdf), { paths: ["/internal/Layout/PDF/Book.pdf"] });
  assert.deepEqual(C.target("library", "files", pdf), { path: "/internal/Layout/PDF/Book.pdf" });
  // Transfer takes any files (up to the kind's 10), Scan & PDF only when all are PDFs or pictures.
  const mixed = { items: [f("/internal/Docs/a.zip"), f("/internal/Pictures/b.png")] };
  assert.deepEqual(C.appsFor("files", mixed, ALL, ""), ["mail", "transfer"]);
  assert.deepEqual(C.target("transfer", "files", mixed), { send: ["/internal/Docs/a.zip", "/internal/Pictures/b.png"] });
  const many = { items: Array.from({ length: 14 }, (_, i) => f("/internal/Pictures/p" + i + ".jpg")) };
  assert.equal(C.target("transfer", "files", many).send.length, 10);
  assert.equal(C.target("scanpdf", "files", many).paths.length, 10);
  assert.equal(C.target("photolab", "files", many), null);
  // Photo Lab reads the disk itself; a video is not a picture.
  assert.deepEqual(C.target("photolab", "files", { items: [f("/internal/Pictures/x.psd")] }), { openFile: "/internal/Pictures/x.psd" });
  assert.equal(C.target("photolab", "files", { items: [f("/internal/Videos/x.webm")] }), null);
  assert.deepEqual(C.appsFor("files", { items: [f("/internal/Videos/Capture.webm")] }, ALL, "capture"), ["mail", "transfer"]);
  // Music: a song in the music folder plays by path, any other one is handed over.
  assert.deepEqual(C.target("music", "files", { items: [f("/internal/Music/Mix.mp3")] }), { playPath: "/internal/Music/Mix.mp3" });
  assert.deepEqual(C.target("music", "files", { items: [f("/internal/Downloads/a.flac")] }),
    { openFile: { path: "/internal/Downloads/a.flac", name: "a.flac", max: 500 * 1024 * 1024 } });
  assert.equal(C.target("music", "files", { items: [f("/internal/Music/a.mp3"), f("/internal/Music/b.mp3")] }), null);
  assert.deepEqual(C.appsFor("files", { items: [f("/internal/Music/Mix.wav")] }, ALL, "studio"), ["mail", "transfer", "music"]);
  // Atelier: pictures, .pptx and designs; Wallpaper: a picture, after the sheet asks.
  assert.deepEqual(C.target("atelier", "files", { items: [f("/internal/Docs/Talk.pptx")] }),
    { openFile: { path: "/internal/Docs/Talk.pptx", name: "Talk.pptx", max: 50 * 1024 * 1024 } });
  assert.deepEqual(C.target("wallpaper", "files", { items: [f("/internal/Pictures/sea.jpg")] }),
    { picture: { path: "/internal/Pictures/sea.jpg", name: "sea.jpg", max: 20 * 1024 * 1024 } });
  assert.equal(C.target("wallpaper", "files", { items: [f("/internal/Pictures/a.svg")] }), null);
  // Paths stay on the orOS disk (BR-SEND-2 diskPath).
  assert.equal(C.norm("files", { items: [{ path: "/internal/../etc/x.png" }] }), null);
});

test("files wave: the shell hands disk files over and asks before a wallpaper", () => {
  const shell = src("shell.js"), sheet = src("send/sheet.js");
  assert.match(shell, /file: sendFileHand/);
  assert.match(shell, /wallpaper: sendWallpaper/);
  assert.match(shell, /orosFileOpen\.hand\(file\)/);
  assert.match(shell, /orosWallpaper\.setImage\(/);
  assert.match(sheet, /via === "wallpaper"\) askWallpaper/);
  assert.match(sheet, /wallYes/);
  // Senders: Studio's export dialog, Capture's two result views, Layout's export dialog.
  assert.match(src("studio/index.html"), /id="export-send"/);
  assert.match(src("capture/index.html"), /id="b-send"/);
  assert.match(src("capture/index.html"), /id="b-rsend"/);
  assert.match(src("layout/panels.js"), /exp-send/);
  assert.match(src("layout/io.js"), /\/internal\/Layout\/PDF/);
});

test("data apps send to an app (gap review proposal 4)", () => {
  // Each sender asks for parent.orosSend and shows its entry only inside orOS.
  for (const f of ["todo/todo.js", "calendar/calendar.js", "contacts/contacts.js", "diary/diary.js", "crm/crm.js",
    "invoices/invoices.js", "quote/view.js", "base/app.js", "forms/app.js", "library/app.js", "meals/meals.js",
    "travel/travel.js", "stickies/stickies.js"]) {
    assert.match(src(f), /parent\.orosSend/, f);
    assert.match(src(f), /\{ kind: "(text|items|table)", data: /, f);
  }
  assert.match(src("todo/index.html"), /id="list-send" hidden/);
  assert.match(src("todo/index.html"), /id="f-send" hidden/);
  assert.match(src("calendar/index.html"), /id="ev-send"[^>]*hidden/);
  assert.match(src("diary/index.html"), /id="send-btn"[^>]*hidden/);
  assert.match(src("meals/index.html"), /id="sh-send" hidden/);
  assert.match(src("quote/view.js"), /qv-send-app/);
  assert.match(src("library/reader.js"), /LIB\.sendQuote\(/);
  assert.match(src("library/home.js"), /export\.sendApp/);
  assert.match(src("base/app.js"), /sendView\("table"\)/);
  assert.match(src("base/app.js"), /sendView\("items"\)/);
  assert.match(src("travel/travel.js"), /sendPlan\(id\)/);
  // Passwords stays out.
  for (const f of fs.readdirSync(path.join(ROOT, "passwords")).filter((x) => /\.js$/.test(x))) assert.doesNotMatch(src("passwords/" + f), /orosSend/, f);
  // What they send is a valid item of its kind.
  assert.ok(C.norm("table", { name: "Invoice 12", rows: [["Description", "Qty", "Unit price", "Net"], ["Design", 2, 40.5, 81], ["Total", "", "", 100.44]] }));
  assert.ok(C.norm("items", { title: "Groceries", items: [{ text: "2 eggs", note: "From: Omelette" }, { text: "milk" }] }));
  assert.deepEqual(C.target("todo", "text", { title: "Shop", text: "[ ] eggs\n[x] milk\nbread" }).addItems.items.map((i) => i.text), ["eggs", "milk", "bread"]);
});

test("new receivers: QR, Whiteboard, Forms, CRM, Base lists (gap review proposal 5)", () => {
  // QR: a link → URL code, a text → Text code (the QR app's 2000 limit).
  assert.deepEqual(C.target("qr", "link", { url: "https://a.b/c", title: "A" }), { make: { type: "url", fields: { url: "https://a.b/c" } } });
  assert.deepEqual(C.target("qr", "text", { title: "Wi", text: "Hello" }), { make: { type: "text", fields: { text: "Hello" } } });
  assert.equal(C.target("qr", "text", { text: "x".repeat(2001) }), null);
  assert.equal(C.target("qr", "items", { items: ["a"] }), null);
  // Whiteboard: one sticky note per item (text + note) or line, ≤ 50.
  assert.deepEqual(C.target("whiteboard", "items", { title: "L", items: [{ text: "Idea", note: "why" }, "Two"] }),
    { addNotes: { notes: [{ tx: "Idea\nwhy" }, { tx: "Two" }] } });
  assert.deepEqual(C.target("whiteboard", "text", { text: "- one\n- two" }).addNotes.notes, [{ tx: "one" }, { tx: "two" }]);
  const many = { items: Array.from({ length: 120 }, (_, i) => "q" + i) };
  assert.equal(C.target("whiteboard", "items", many).addNotes.notes.length, 50);
  // Forms: one question per item, ≤ 100 (links.js MAX_DRAFT), the Assistant's draft.
  assert.deepEqual(C.target("forms", "items", { title: "Sign-up", items: ["Name", { text: "E-mail", note: "x" }] }),
    { draft: { title: "Sign-up", questions: [{ label: "Name" }, { label: "E-mail" }] } });
  assert.equal(C.target("forms", "items", many).draft.questions.length, 100);
  assert.equal(require(path.join(ROOT, "forms/links.js")).MAX_DRAFT, 100);
  // CRM: a text → a Note in the history window; the title goes first.
  assert.deepEqual(C.target("crm", "text", { title: "Call notes", text: "Wants a quote" }), { logNote: { text: "Call notes\nWants a quote" } });
  assert.deepEqual(C.target("crm", "text", { title: "Acme", text: "Acme\nCompany" }), { logNote: { text: "Acme\nCompany" } });
  assert.equal(C.target("crm", "text", { text: "x".repeat(3000) }).logNote.text.length, 2000);
  // Base: a list becomes a table for "Add as a table", column names in the person's language.
  assert.deepEqual(C.target("base", "items", { title: "Books", items: [{ text: "Odyssey", note: "Homer" }, "Iliad"] }, "", "el"),
    { newTable: { name: "Books", rows: [["Όνομα", "Σημειώσεις"], ["Odyssey", "Homer"], ["Iliad", ""]] } });
  assert.deepEqual(C.target("base", "items", { title: "B", items: ["a"] }), { newTable: { name: "B", rows: [["Name"], ["a"]] } });
  assert.match(src("send/sheet.js"), /C\.target\(id, kind, d, env\.from, window\.orosLang\)/);
});
