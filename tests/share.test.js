// "Send to someone" (share/kinds.js): the item normalizers, the link
// codec (plain, compressed, password), the hostile-input guards, the
// files it builds (.ics checked with the Calendar's own parser) and the
// receivers each "Add to my orOS" target relies on.
// Run: node --test tests/

"use strict";

process.env.TZ = "Europe/Athens";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const K = require(path.join(ROOT, "share/kinds.js"));
const ICS = require(path.join(ROOT, "calendar/ics.js"));
const MC = require(path.join(ROOT, "meals/core.js")).OrosMealsCore;

const b64u = (bytes) => Buffer.from(bytes).toString("base64url");
async function deflate(str) {
  const s = new Blob([new TextEncoder().encode(str)]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

test("list: items cleaned and capped, empty items dropped, no list without items", () => {
  const d = K.norm("list", {
    t: "  Shop\u0000ping  " + "x".repeat(100),
    i: [{ x: " milk " }, { x: "" }, { x: "bread", n: "whole\r\ngrain", d: 1 }, "junk", { x: "eggs", d: true }]
  });
  assert.equal(d.t.length, 60);
  assert.ok(d.t.startsWith("Shop ping"));
  assert.deepEqual(d.i, [{ x: "milk" }, { x: "bread", n: "whole\ngrain", d: 1 }, { x: "eggs" }]);
  assert.equal(K.norm("list", { t: "x", i: [{ x: "  " }] }), null);
  const many = K.norm("list", { i: Array.from({ length: 500 }, (_, i) => ({ x: "i" + i })) });
  assert.equal(many.i.length, 200);
});

test("note, contact, event, recipe, links: caps and refusals", () => {
  assert.equal(K.norm("note", { t: "", x: "  " }), null);
  assert.equal(K.norm("note", { x: "a".repeat(30000) }).x.length, 20000);

  const c = K.norm("contact", {
    g: "Ελένη", f: "Π.", p: [{ v: "+30 69 1234", ty: "mobile" }, { v: "2", ty: "fax" }],
    e: [{ v: "a@b.gr", ty: "work" }, { v: "not an email" }],
    u: [{ v: "javascript:alert(1)" }, { v: "https://ex.gr/p" }],
    ev: [{ ty: "birthday", d: "02-29", y: 2001 }, { ty: "birthday", d: "02-29", y: 2000 }, { ty: "custom", d: "13-01" }],
    photo: "data:image/jpeg;base64,AAAA"
  });
  assert.deepEqual(c.p.map((r) => r.ty), ["mobile", "other"]);
  assert.deepEqual(c.e, [{ v: "a@b.gr", ty: "work" }]);
  assert.deepEqual(c.u, [{ v: "https://ex.gr/p", ty: "other" }]);
  assert.deepEqual(c.ev, [{ ty: "birthday", d: "02-29" }, { ty: "birthday", d: "02-29", y: 2000 }]);
  assert.equal("photo" in c, false);
  assert.equal(K.norm("contact", { x: "only a note" }), null);

  assert.equal(K.norm("event", { t: "x", d: "2026-02-30" }), null);
  const ev = K.norm("event", { t: "Party", d: "2026-11-02", de: "2026-11-01", s: "25:00", e: "21:00", r: { f: "Q" }, id: "a b" });
  assert.deepEqual(ev, { t: "Party", d: "2026-11-02" });

  const r = K.norm("recipe", { t: "Fakes", sv: 999, ig: [{ q: -1, u: "<b>", n: "lentils" }, { n: "" }], st: ["", "Boil"], dt: ["vegan", "<x>"] });
  assert.equal(r.sv, 4);
  assert.deepEqual(r.ig, [{ q: null, u: "", n: "lentils", x: "", g: "" }]);
  assert.deepEqual(r.st, ["Boil"]);
  assert.deepEqual(r.dt, ["vegan"]);
  assert.equal(K.norm("recipe", { t: "" }), null);

  const l = K.norm("links", { i: [{ u: "https://a.gr/x" }, { u: "https://a.gr/x" }, { u: "data:text/html,hi" }, { u: "ftp://x" }] });
  assert.deepEqual(l.i, [{ u: "https://a.gr/x", t: "" }]);
  assert.equal(K.norm("links", { i: [{ u: "javascript:void(0)" }] }), null);
  assert.equal(K.norm("nope", { t: "x" }), null);
  assert.equal(K.norm("note", ["x"]), null);
});

test("link codec: compressed round trip, uncompressed form, normalized on the way in", async () => {
  const env = K.pack("note", { t: "Γεια", x: "Καλημέρα\n".repeat(50) });
  const code = await K.encode(env);
  assert.match(code, /^1\.[A-Za-z0-9_-]+$/);
  assert.ok(code.length < 200, "repeated text compresses");
  assert.deepEqual(await K.decode(code), { env });
  assert.equal(K.codeFromHash("#" + code), code);
  assert.equal(K.codeFromHash("#c=" + code), "");
  assert.equal(K.isLocked(code), false);

  // "0." = plain JSON (browsers without CompressionStream)
  const raw = "0." + b64u(new TextEncoder().encode(JSON.stringify({ v: 1, k: "list", d: { t: "A", i: [{ x: " b ", z: 1 }] } })));
  assert.deepEqual((await K.decode(raw)).env, { v: 1, k: "list", d: { t: "A", i: [{ x: "b" }] } });
});

test("hostile links: garbage, wrong shape, bombs and oversize codes are refused", async () => {
  assert.deepEqual(await K.decode(""), { error: "bad" });
  assert.deepEqual(await K.decode("1.@@@"), { error: "bad" });
  assert.deepEqual(await K.decode("1." + b64u(new Uint8Array([1, 2, 3]))), { error: "bad" });
  assert.deepEqual(await K.decode("0." + b64u(new TextEncoder().encode('{"v":2,"k":"note","d":{"t":"x"}}'))), { error: "bad" });
  assert.deepEqual(await K.decode("0." + b64u(new TextEncoder().encode('{"v":1,"k":"html","d":{}}'))), { error: "bad" });
  const bomb = await deflate(JSON.stringify({ v: 1, k: "note", d: { t: "x", x: "a".repeat(K.MAX_JSON * 2) } }));
  assert.deepEqual(await K.decode("1." + b64u(bomb)), { error: "big" });
  assert.deepEqual(await K.decode("1." + "A".repeat(600000)), { error: "big" });
  await assert.rejects(K.encode({ v: 1, k: "note", d: {} }));
});

test("password links: right password opens, wrong / missing / tampered ones do not", async () => {
  const env = K.pack("contact", { g: "Νίκος", p: [{ v: "210 123", ty: "home" }] });
  const code = await K.encode(env, "kokkino-mila");
  assert.ok(K.isLocked(code));
  assert.ok(!code.includes("Νίκος"));
  assert.deepEqual(await K.decode(code), { error: "pass" });
  assert.deepEqual(await K.decode(code, "lathos"), { error: "pass" });
  assert.deepEqual(await K.decode(code, "kokkino-mila"), { env });
  const bytes = Buffer.from(code.slice(3), "base64url");
  bytes[bytes.length - 1] ^= 1;
  assert.deepEqual(await K.decode("p1." + b64u(bytes), "kokkino-mila"), { error: "pass" });
  // two encodings of the same item never look alike (fresh salt + IV)
  assert.notEqual(await K.encode(env, "kokkino-mila"), code);
});

test("event file: the Calendar's own parser reads it back", () => {
  const timed = K.pack("event", { id: "ev-9", t: "Γιορτή; με, κόμμα", d: "2026-12-24", s: "20:00", e: "23:30", l: "Σπίτι", x: "Φέρε\nκρασί", r: { f: "Y", i: 1 } });
  const p = ICS.parse(K.file(timed, "el").text);
  assert.equal(p.events.length, 1);
  const e = p.events[0];
  assert.equal(e.title, "Γιορτή; με, κόμμα");
  assert.equal(e.date, "2026-12-24");
  assert.equal(e.start, "20:00");
  assert.equal(e.end, "23:30");
  assert.equal(e.location, "Σπίτι");
  assert.equal(e.note, "Φέρε\nκρασί");
  assert.equal(e.recur.freq, "Y");

  const allDay = K.pack("event", { t: "Trip", d: "2026-08-01", de: "2026-08-03" });
  const a = ICS.parse(K.ics(allDay.d)).events[0];
  assert.equal(a.start, null);
  assert.equal(a.date, "2026-08-01");
  assert.equal(a.dateEnd, "2026-08-03");
  // same event, same UID: a re-sent event updates instead of duplicating
  assert.equal(ICS.parse(K.ics(allDay.d)).events[0].id, a.id);
});

test("contact file: vCard 3.0 with escaped values and yearless birthdays", () => {
  const env = K.pack("contact", { g: "Anna", f: "Smith", o: "A; B", p: [{ v: "123", ty: "mobile" }],
    a: [{ s: "Odos 1", c: "Athens", ty: "home" }], ev: [{ ty: "birthday", d: "05-04" }], x: "line1\nline2" });
  const v = K.file(env, "en");
  assert.equal(v.name, "Anna Smith.vcf");
  assert.match(v.text, /^BEGIN:VCARD\r\nVERSION:3\.0\r\nN:Smith;Anna;;;\r\nFN:Anna Smith\r\n/);
  assert.ok(v.text.includes("ORG:A\\; B\r\n"));
  assert.ok(v.text.includes("TEL;TYPE=CELL:123\r\n"));
  assert.ok(v.text.includes("ADR;TYPE=HOME:;;Odos 1;Athens;;;\r\n"));
  assert.ok(v.text.includes("BDAY:--05-04\r\n"));
  assert.ok(v.text.includes("NOTE:line1\\nline2\r\n"));
});

test("links file: Netscape HTML with every value escaped", () => {
  const env = K.pack("links", { t: "<b>Mine</b>", i: [{ u: "https://x.gr/?a=1&b=\"2\"", t: "<script>x</script>" }] });
  const f = K.file(env, "en");
  assert.equal(f.mime, "text/html;charset=utf-8");
  assert.ok(!f.text.includes("<script>"));
  assert.ok(f.text.includes("&lt;script&gt;x&lt;/script&gt;"));
  assert.ok(f.text.includes('HREF="https://x.gr/?a=1&amp;b=%222%22"'));
  assert.ok(f.text.includes("<H3>&lt;b&gt;Mine&lt;/b&gt;</H3>"));
});

test("text and summary in both languages", () => {
  const env = K.pack("list", { t: "Σούπερ", i: [{ x: "γάλα" }, { x: "ψωμί", d: 1, n: "ολικής" }] });
  assert.equal(K.summary(env, "el"), "Λίστα «Σούπερ» · 2 είδη");
  assert.equal(K.summary(env, "en"), "List «Σούπερ» · 2 items");
  assert.equal(K.text(env, "en"), "Σούπερ\n\n☐ γάλα\n☑ ψωμί\n   ολικής");
  const r = K.pack("recipe", { t: "Φακές", e: "🥣", sv: 2, ig: [{ q: 250, u: "g", n: "φακές" }], st: ["Βράσε"] });
  const helpers = { ingLine: (ing, lang) => MC.ingToLine(ing, lang, 1) };
  const txt = K.text(r, "el", helpers);
  assert.ok(txt.startsWith("🥣 Φακές\nΜερίδες: 2"));
  assert.ok(txt.includes("- " + MC.ingToLine(r.d.ig[0], "el", 1)));
  assert.ok(txt.includes("1. Βράσε"));
  assert.equal(K.title(K.pack("links", { i: [{ u: "https://a.gr" }] }), "el"), "Σύνδεσμοι που έλαβες");
});

test("targets fit the receivers they go to", () => {
  const list = K.target(K.pack("list", { t: "Shop", i: [{ x: "a", d: 1 }, { x: "b", n: "n" }] }), "en");
  assert.deepEqual(list, { app: "todo", target: { addItems: { newList: "Shop", from: "an orOS link", items: [{ text: "b", note: "n" }] } } });
  const allDone = K.target(K.pack("list", { i: [{ x: "a", d: 1 }] }), "en");
  assert.deepEqual(allDone.target.addItems.items, [{ text: "a", note: "" }]);

  assert.deepEqual(K.target(K.pack("note", { t: "T", x: "X" }), "en"), { app: "notes", target: { add: { title: "T", text: "X" } } });

  const ct = K.target(K.pack("contact", { g: "A" }), "en");
  assert.equal(ct.app, "contacts");
  assert.match(ct.target.importVcf.text, /^BEGIN:VCARD/);

  const ev = K.target(K.pack("event", { t: "E", d: "2026-01-02" }), "en");
  assert.equal(ev.app, "calendar");
  assert.equal(ICS.parse(ev.target.importIcs.text).events.length, 1);

  // Meals accepts the recipe as a new draft (its own normalizer, given an id)
  const rc = K.target(K.pack("recipe", { t: "Soup", ig: [{ q: 2, u: "pc", n: "carrot" }], st: ["Cook"], c: "soup", dt: ["vegan"] }), "en");
  assert.equal(rc.app, "meals");
  const draft = MC.normRecipe(Object.assign({}, rc.target.addRecipe, { id: "shared-draft", m: 0 }));
  assert.equal(draft.t, "Soup");
  assert.equal(draft.ig[0].n, "carrot");
  assert.deepEqual(draft.dt, ["vegan"]);

  assert.deepEqual(K.target(K.pack("links", { i: [{ u: "https://a.gr/", t: "A" }] }), "en"),
    { app: "bookmarks", target: { add: { url: "https://a.gr/", title: "A" } } });
  const many = K.target(K.pack("links", { t: "Trip", i: [{ u: "https://a.gr/" }, { u: "https://b.gr/" }] }), "el");
  assert.deepEqual(many.target.addMany.folder, "Trip");
  assert.equal(many.target.addMany.items.length, 2);
});

test("every receiver exists in its app, and the page keeps the palette contract", () => {
  const src = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
  assert.ok(src("todo/todo.js").includes("if (t && t.addItems) { openAddItems(t.addItems); return; }"));
  assert.ok(src("notes/notes.js").includes("if (t && t.add && typeof t.add === \"object\") {"));
  assert.ok(src("contacts/contacts.js").includes("var fi = target && typeof target === \"object\" ? target.importVcf : null;"));
  assert.ok(src("calendar/calendar.js").includes("importIcs"));
  assert.ok(src("meals/meals.js").includes("if (t.addRecipe && typeof t.addRecipe === \"object\") {"));
  assert.ok(src("bookmarks/bookmarks.js").includes("if (t && t.addMany && typeof t.addMany === \"object\") {"));
  // G3 (bump workflow): share/ has an index.html, so its scripts must
  // name both palette functions.
  const view = src("share/view.js");
  assert.ok(view.includes("function inheritPalette") && view.includes("function watchPalette"));
  // the page writes text only
  assert.ok(!/innerHTML|insertAdjacentHTML|document\.write/.test(view));
  const send = src("share/send.js");
  assert.deepEqual(send.match(/innerHTML\s*=[^;]*/g), ["innerHTML = EYE"]);
});
