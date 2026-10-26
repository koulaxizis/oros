// Contacts from any document (wave CF1/DOC1): the Assistant reads
// documents on the device (assistant/doctext.js) and proposes contact
// updates with more fields, per-person changes and ticks
// (assistant/edits.js, assistant.js changeList).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const REPO = path.join(__dirname, "..");
const E = require(path.join(REPO, "assistant/edits.js"));
const C = require(path.join(REPO, "assistant/core.js"));
const D = require(path.join(REPO, "assistant/doctext.js"));
const Z = require(path.join(REPO, "atelier/zip.js"));
const X = require(path.join(REPO, "vendor/xlsx.full.min.js"));
const MG = require(path.join(REPO, "contacts/merge.js"));

const NOW = 1760000000000;
const enc = (s) => new TextEncoder().encode(s);
const ok = (args) => { const r = E.normArgs(args); assert.equal(r.ok, true, r.err); return r; };

function data() {
  return {
    ver: 1, labels: [],
    contacts: [
      { id: "c1", given: "Anna", middle: "", family: "Pappa", nickname: "", org: "Acme", jobTitle: "",
        phones: [{ v: "+30 691 234 5678", type: "mobile" }, { v: "210 1234567", type: "work" }],
        emails: [{ v: "anna@example.com", type: "home" }],
        addresses: [{ street: "Old St 1", city: "Athens", zip: "10431", region: "", country: "", type: "home" }],
        websites: [{ v: "https://anna.example", type: "home" }], im: [], events: [], relations: [], labelIds: [],
        starred: false, note: "old", avatar: null, mtime: 1000 },
      { id: "c2", given: "Nikos", middle: "", family: "Kos", nickname: "", org: "", jobTitle: "",
        phones: [], emails: [], addresses: [], websites: [], im: [], events: [], relations: [], labelIds: [],
        starred: false, note: "", avatar: null, mtime: 500 }
    ],
    deleted: []
  };
}
const find = (d, id) => d.contacts.find((c) => c.id === id);
function run(d, target, args) {
  const ch = ok(args);
  const p = E.plan("contacts", d, target, ch, NOW);
  assert.equal(p.ok, true, p.err);
  const a = E.apply("contacts", d, target, ch, NOW, p.before);
  assert.equal(a.ok, true, a.err);
  return { ch, p, a };
}

// ---------- edits.js: more of a contact card ----------
test("contacts: nickname, job title, website and address are added", () => {
  const { p, a } = run(data(), "c2", { ref: "r1", action: "update", nickname: "N. K.", job_title: "Translator",
    website: "nikos.example.org", address: { street: "Main 5", city: "Patra", zip: "26221", country: "Greece" } });
  assert.deepEqual(p.rows.map((r) => r.f), ["nickname", "job", "address", "website"]);
  assert.equal(p.after.address, "Main 5, 26221 Patra, Greece");
  const c = find(a.data, "c2");
  assert.equal(c.nickname, "N. K."); assert.equal(c.jobTitle, "Translator");
  assert.deepEqual(c.addresses, [{ street: "Main 5", city: "Patra", zip: "26221", region: "", country: "Greece", type: "home" }]);
  assert.deepEqual(c.websites, [{ v: "nikos.example.org", type: "home" }]);
  for (const f of ["nickname", "jobTitle", "addresses", "websites"]) assert.equal(c.fm[f], NOW, f);
});

test("contacts: a phone, e-mail or website already there is not added twice", () => {
  const ch = ok({ ref: "r1", action: "update", phone: "6912345678", email: "ANNA@example.com", website: "http://www.anna.example/" });
  const p = E.plan("contacts", data(), "c1", ch, NOW);
  assert.equal(p.ok, false);
  assert.match(p.err, /Nothing would change/);
});

test("contacts: old_phone / old_email / old_website replace that one value only, keeping its type", () => {
  const { a, p } = run(data(), "c1", { ref: "r1", action: "update", phone: "+30 697 000 0000", old_phone: "6912345678",
    email: "anna@new.example", old_email: "Anna@Example.com", website: "anna.new", old_website: "anna.example" });
  const c = find(a.data, "c1");
  assert.deepEqual(c.phones, [{ v: "+30 697 000 0000", type: "mobile" }, { v: "210 1234567", type: "work" }]);
  assert.deepEqual(c.emails, [{ v: "anna@new.example", type: "home" }]);
  assert.deepEqual(c.websites, [{ v: "anna.new", type: "home" }]);
  assert.deepEqual(p.rows.find((r) => r.f === "phone"), { f: "phone", b: "+30 691 234 5678, 210 1234567", a: "+30 697 000 0000, 210 1234567" });
  // an old value the contact doesn't have: refused, nothing changes
  const bad = E.plan("contacts", data(), "c1", ok({ ref: "r1", action: "update", phone: "699", old_phone: "2100000000" }), NOW);
  assert.equal(bad.ok, false);
  assert.match(bad.err, /old_phone 2100000000 is not one of the contact's numbers/);
  // old_* needs the new value
  assert.match(E.normArgs({ ref: "r1", action: "update", old_email: "a@b.c" }).err, /old_email goes with email/);
});

test("contacts: an address is added, or replaces the one of its type with address_replace", () => {
  const add = run(data(), "c1", { ref: "r1", action: "update", address: { street: "Work Rd 2", city: "Athens", type: "work" } }).a;
  assert.equal(find(add.data, "c1").addresses.length, 2);
  const rep = run(data(), "c1", { ref: "r1", action: "update", address: { street: "New St 9", city: "Volos", zip: "38221" }, address_replace: true }).a;
  assert.deepEqual(find(rep.data, "c1").addresses, [{ street: "New St 9", city: "Volos", zip: "38221", region: "", country: "", type: "home" }]);
  assert.match(E.normArgs({ ref: "r1", action: "update", address_replace: true }).err, /address_replace goes with address/);
  assert.match(E.normArgs({ ref: "r1", action: "update", address: { type: "x", city: "a" } }).err, /home, work or other/);
  assert.match(E.normArgs({ ref: "r1", action: "update", website: "not a site" }).err, /web address/);
});

test("contacts: note_add adds a line, never twice, within 2000 characters (CT-N2K)", () => {
  const { a } = run(data(), "c1", { ref: "r1", action: "update", note_add: "Tax no. 123456789" });
  assert.equal(find(a.data, "c1").note, "old\nTax no. 123456789");
  const again = E.plan("contacts", a.data, "c1", ok({ ref: "r1", action: "update", note_add: "Tax no. 123456789" }), NOW + 5);
  assert.match(again.err, /Nothing would change/);
  const bio = "b".repeat(1500);
  const { a: a2 } = run(data(), "c1", { ref: "r1", action: "update", note_add: bio });
  assert.equal(find(a2.data, "c1").note, "old\n" + bio);            // past the old 500, whole
  const long = E.plan("contacts", data(), "c1", ok({ ref: "r1", action: "update", note_add: "x".repeat(1999) }), NOW);
  assert.equal(long.ok, false);
  assert.match(long.err, /Contacts keeps 2000/);
  // note (replace): whole up to 2000, refused past it, never cut
  const { a: a3 } = run(data(), "c1", { ref: "r1", action: "update", note: "n".repeat(2000) });
  assert.equal(find(a3.data, "c1").note.length, 2000);
  const over = E.plan("contacts", data(), "c1", ok({ ref: "r1", action: "update", note: "n".repeat(2001) }), NOW);
  assert.equal(over.ok, false);
  assert.match(over.err, /2001 characters; Contacts keeps 2000.*nothing is cut/);
  assert.equal(find(data(), "c1").note, "old");
  assert.match(E.normArgs({ ref: "r1", action: "update", note: "a", note_add: "b" }).err, /not both/);
});

test("contacts: what the Assistant writes is what Contacts itself would store, stamped like merge.js", () => {
  const { a } = run(data(), "c1", { ref: "r1", action: "update", job_title: "Editor", website: "x.example",
    address: { street: "A 1", city: "B", type: "work" }, phone: "699", old_phone: "210 1234567" });
  const c = find(a.data, "c1"), prev = find(data(), "c1");
  const me = JSON.parse(JSON.stringify(c));
  const theirs = JSON.parse(JSON.stringify(prev));
  ["jobTitle", "websites", "addresses", "phones"].forEach((k) => { theirs[k] = c[k]; });
  delete me.fm; delete me.mtime;
  MG.restamp(prev, theirs, NOW);
  assert.deepEqual(c.fm, theirs.fm);
  assert.equal(c.mtime, theirs.mtime);
});

test("contacts: undo takes the new fields back", () => {
  const { a } = run(data(), "c1", { ref: "r1", action: "update", nickname: "Ann", address: { city: "Volos" }, address_replace: true, website: "w.example" });
  const u = E.apply("contacts", data(), "c1", ok({ ref: "r1", action: "update", nickname: "Ann", address: { city: "Volos" }, address_replace: true, website: "w.example" }), NOW, null).undo;
  const back = E.undo("contacts", a.data, u, NOW + 10);
  assert.equal(back.ok, true, back.err);
  const c = find(back.data, "c1"), o = find(data(), "c1");
  for (const k of ["nickname", "addresses", "websites"]) assert.deepEqual(c[k], o[k], k);
});

test("ticks: rows map to the arguments that make them; unticked rows are left out", () => {
  const ch = ok({ ref: "r1", action: "update", phone: "699", old_phone: "210 1234567", job_title: "Editor", note_add: "hi" });
  const p = E.plan("contacts", data(), "c1", ch, NOW);
  assert.equal(E.canTick("contacts", p.rows), true);
  assert.equal(E.canTick("todo", [{ f: "title" }]), false);
  const w = E.without("contacts", ch, ["phone", "note"]);
  assert.deepEqual(Object.keys(w.set), ["job_title"]);
  assert.equal(E.without("contacts", ch, ["phone", "job", "note"]), null);
  const a = E.apply("contacts", data(), "c1", w, NOW, p.before);
  const c = find(a.data, "c1");
  assert.equal(c.jobTitle, "Editor");
  assert.deepEqual(c.phones, find(data(), "c1").phones);
  assert.equal(c.note, "old");
});

// ---------- core.js ----------
test("core: documents are attachments that always go as text read on the device", () => {
  assert.equal(C.attKind("application/vnd.openxmlformats-officedocument.wordprocessingml.document"), "doc");
  assert.equal(C.attKind("text/vcard"), "doc");
  for (const pid of ["anthropic", "openai", "gemini", "mistral", "local"]) assert.ok(!C.attCaps(pid, {}).doc, pid);
  const a = { id: "adoc0001", name: "form.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 9, data: "QUJD", text: "Name: Anna\tPhone: 699" };
  const body = C.buildRequest("anthropic", { key: "k", model: "m" }, [{ r: "user", text: "update her", att: [a] }], {}).body;
  const s = JSON.stringify(body.messages);
  assert.match(s, /from the document “form\.docx”/);
  assert.ok(!s.includes("QUJD"));
});

test("core: change_item offers changes with every field, and the people rule when Contacts can change", () => {
  const src = fs.readFileSync(path.join(REPO, "assistant/core.js"), "utf8");
  assert.match(src, /P\.changes = \{ type: "array"/);
  const pr = C.systemPrompt({ lang: "en", now: NOW, apps: ["Contacts (contacts)"], entries: ["contact"], changes: ["contacts"], files: "pdf" });
  assert.match(pr, /look each one up first with search_data \(Contacts, and CRM/);
  const noFiles = C.systemPrompt({ lang: "en", now: NOW, apps: ["Contacts (contacts)"], entries: ["contact"], changes: ["contacts"] });
  assert.ok(!/look each person up/.test(noFiles));
});

test("propose_entry contact: a note up to 2000 goes whole, a longer one is refused, not cut (CT-N2K)", () => {
  const src = fs.readFileSync(path.join(REPO, "assistant/core.js"), "utf8");
  assert.match(src, /var nt = para\(a\.note, 5000\);\s*if \(nt\.length > 2000\) return \{ err:/);
  assert.match(src, /whole note holds 2000 characters in Contacts/);
});

test("merge.js: a note an older device cut to 500 loses a tie to the whole note (CT-N2K)", () => {
  const whole = "Bio. " + "word ".repeat(200);                 // 1,005 characters, a space at 501
  const cut = whole.slice(0, 500);
  const base = { id: "c1", given: "A", mtime: 10, fm: { note: 10 } };
  const a = Object.assign({}, base, { note: whole }), b = Object.assign({}, base, { note: cut });
  assert.equal(MG.mergeContact(a, b).note, whole);
  assert.equal(MG.mergeContact(b, a).note, whole);
  assert.equal(JSON.stringify(MG.mergeContact(a, b)), JSON.stringify(MG.mergeContact(b, a)));
  // a real edit (newer stamp) still wins, even when it is the shorter note
  const ed = Object.assign({}, base, { note: cut, fm: { note: 11 } });
  assert.equal(MG.mergeContact(a, ed).note, cut);
  // not a cut (other length or other text): the old tie rule
  const x = Object.assign({}, base, { note: "zz" }), y = Object.assign({}, base, { note: "zz and more" });
  assert.equal(MG.mergeContact(x, y).note, MG.mergeContact(y, x).note);
});

test("assistant.js: a changes entry that can't be changed stays off the card, the others go (CT-N2K)", () => {
  const src = fs.readFileSync(path.join(REPO, "assistant/assistant.js"), "utf8");
  const list = src.slice(src.indexOf("function changeList("), src.indexOf("function undoChange("));
  assert.doesNotMatch(list, /return Promise\.resolve\(\{ content: "Error: changes\[" \+ i/);
  assert.match(list, /if \(!ch\.ok\) \{ bad\.push/);
  assert.match(list, /if \(!plans\.length && bad\.length\)/);
  assert.match(list, /sameNote \+= badNote\(bad\)/);
  assert.match(src, /never shorten the user's text unless they ask/);
  const many = src.slice(src.indexOf("function changeMany("), src.indexOf("function changeList("));
  assert.match(many, /if \(!plans\.length && bad\.length\)/);
});

// ---------- doctext.js ----------
const zip = (files) => Z.write(Object.keys(files).map((n) => ({ name: n, data: enc(files[n]) })));

test("doctext: kinds by extension or type; unknown is not a document", () => {
  assert.equal(D.kindOf("Form.DOCX", ""), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.equal(D.kindOf("x", "text/x-vcard"), "text/vcard");
  assert.equal(D.kindOf("photo.jpg", "image/jpeg"), "");
  assert.equal(D.kindOf("a.exe", "application/octet-stream"), "");
});

test("doctext: Word keeps tabs, table cells and form results; drops deletions and field codes", async () => {
  const b = zip({ "word/document.xml": '<w:document><w:body><w:p><w:r><w:t>Name:</w:t></w:r><w:r><w:tab/><w:t xml:space="preserve">Anna &amp; Co</w:t></w:r></w:p>' +
    '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Tax no.</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>123</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
    '<w:p><w:r><w:instrText> FORMTEXT </w:instrText><w:t>typed</w:t></w:r><w:r><w:delText>gone</w:delText></w:r></w:p></w:body></w:document>',
    "word/footer1.xml": "<w:ftr><w:p><w:r><w:t>Publisher footer</w:t></w:r></w:p></w:ftr>" });
  assert.equal(await D.read(b, "f.docx"), "Name:\tAnna & Co\nTax no.\t123\ntyped\n\nPublisher footer");
});

test("doctext: OpenDocument text and slides, PowerPoint, e-book", async () => {
  const odt = zip({ "content.xml": '<office:document-content><office:body><office:text><text:p>Α<text:s text:c="2"/>Β<text:tab/>Γ</text:p><text:tracked-changes><text:p>old</text:p></text:tracked-changes></office:text></office:body></office:document-content>' });
  assert.equal(await D.read(odt, "f.odt"), "Α  Β\tΓ");
  const pptx = zip({ "ppt/slides/slide2.xml": "<p:sld><a:p><a:r><a:t>Two</a:t></a:r></a:p></p:sld>", "ppt/slides/slide1.xml": "<p:sld><a:p><a:r><a:t>One</a:t></a:r></a:p></p:sld>" });
  assert.equal(await D.read(pptx, "s.pptx"), "--- 1 ---\nOne\n\n--- 2 ---\nTwo");
  const epub = zip({ "META-INF/container.xml": '<container><rootfile full-path="OEBPS/c.opf"/></container>',
    "OEBPS/c.opf": '<package><manifest><item id="a" href="a.xhtml"/><item id="b" href="b.xhtml"/></manifest><spine><itemref idref="b"/><itemref idref="a"/></spine></package>',
    "OEBPS/a.xhtml": "<html><body><p>Second</p></body></html>", "OEBPS/b.xhtml": "<html><body><h1>First</h1><script>x()</script></body></html>" });
  assert.equal(await D.read(epub, "b.epub"), "First\n\nSecond");
});

test("doctext: spreadsheets (xlsx, ods, xls) as CSV per sheet", async () => {
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([["Name", "Phone"], ["Νίκος", "6912345678"]]), "People");
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([["x"]]), "Other");
  for (const [t, ext] of [["xlsx", "xlsx"], ["ods", "ods"], ["biff8", "xls"]]) {
    const b = new Uint8Array(X.write(wb, { type: "array", bookType: t }));
    assert.equal(await D.read(b, "a." + ext, { sheets: () => X }), "## People\nName,Phone\nΝίκος,6912345678\n\n## Other\nx", ext);
  }
  await assert.rejects(D.read(new Uint8Array(4), "a.xlsx"), /spreadsheet reader/);
});

test("doctext: Word 97 (.doc) piece table: Unicode and 8-bit pieces, field codes dropped", async () => {
  // A minimal .doc: WordDocument stream (FIB + text) and 1Table (Clx).
  const textU = "Όνομα: Άννα\r", text8 = "Tel \x13 FORMTEXT \x14699\x15\r";
  const wd = new Uint8Array(0x400);
  const dv = new DataView(wd.buffer);
  dv.setUint16(0, 0xa5ec, true);
  dv.setUint16(0x0a, 0x0200, true);              // 1Table
  const fcU = 0x200, fc8 = 0x300;
  for (let i = 0; i < textU.length; i++) dv.setUint16(fcU + i * 2, textU.charCodeAt(i), true);
  for (let i = 0; i < text8.length; i++) wd[fc8 + i] = text8.charCodeAt(i);
  const clx = new Uint8Array(1 + 4 + 12 + 16), cv = new DataView(clx.buffer);
  clx[0] = 2; cv.setUint32(1, 12 + 16, true);
  cv.setUint32(5, 0, true); cv.setUint32(9, textU.length, true); cv.setUint32(13, textU.length + text8.length, true);
  cv.setUint32(17 + 2, fcU, true);
  cv.setUint32(25 + 2, (fc8 * 2) | 0x40000000, true);
  const tbl = new Uint8Array(64 + clx.length); tbl.set(clx, 64);
  dv.setUint32(0x01a2, 64, true); dv.setUint32(0x01a6, clx.length, true);
  const cfb = X.CFB.utils.cfb_new();
  X.CFB.utils.cfb_add(cfb, "/WordDocument", wd);
  X.CFB.utils.cfb_add(cfb, "/1Table", tbl);
  const bytes = new Uint8Array(X.CFB.write(cfb, { type: "array" }));
  assert.equal(await D.read(bytes, "old.doc", { sheets: () => X }), "Όνομα: Άννα\nTel 699");
});

test("doctext: RTF in its code page, HTML without scripts, e-mail text part, plain text encodings", async () => {
  assert.equal(await D.read(enc("{\\rtf1\\ansi\\ansicpg1253{\\fonttbl{\\f0 Arial;}}{\\*\\generator x;}\\f0 \\'cc\\'e1\\'f1\\'df\\'e1\\par Tel\\tab 69\\u8364?}"), "a.rtf"), "Μαρία\nTel\t69€");
  assert.equal(await D.read(enc("<html><head><title>t</title><style>p{}</style></head><body><p>a&nbsp;b<br>c</p><script>alert(1)</script><table><tr><td>x</td><td>y</td></tr></table></body></html>"), "p.html"), "a b\nc\n\nx\ty");
  const eml = "From: Anna <a@b.c>\nSubject: details\nContent-Type: multipart/alternative; boundary=\"zz\"\n\n--zz\nContent-Type: text/plain; charset=utf-8\nContent-Transfer-Encoding: quoted-printable\n\nTel =CE=91 699\n--zz\nContent-Type: text/html\n\n<p>html</p>\n--zz--";
  assert.equal(await D.read(enc(eml), "m.eml"), "From: Anna <a@b.c>\nSubject: details\n\nTel Α 699");
  assert.equal(await D.read(new Uint8Array([0xc1, 0xed, 0xed, 0xe1]), "w.txt"), "Αννα");              // Windows-1253
  const u16 = new Uint8Array([0xff, 0xfe, 0x91, 0x03, 0x42, 0x00]);
  assert.equal(await D.read(u16, "u.txt"), "ΑB");
  assert.equal(await D.read(enc("BEGIN:VCARD\nFN:Anna\nEND:VCARD"), "a.vcf"), "BEGIN:VCARD\nFN:Anna\nEND:VCARD");
});

// ---------- assistant.js wiring ----------
test("assistant.js: documents are read on the device, other photos redrawn, ticks and changes wired", () => {
  const src = fs.readFileSync(path.join(REPO, "assistant/assistant.js"), "utf8");
  const html = fs.readFileSync(path.join(REPO, "assistant/index.html"), "utf8");
  assert.ok(html.indexOf("atelier/zip.js") < html.indexOf("doctext.js") && html.indexOf("doctext.js") < html.indexOf('"core.js?'));
  assert.match(src, /k === "doc" \? docText/);
  assert.match(src, /XLSX_SRC = "\.\.\/vendor\/xlsx\.full\.min\.js"/);
  assert.match(src, /inp\.accept = attAccept\(\)/);
  assert.match(src, /if \(args && Array\.isArray\(args\.changes\)\) return changeList/);
  const list = src.slice(src.indexOf("function changeList("), src.indexOf("function undoChange("));
  assert.equal((list.match(/writeStore\(/g) || []).length, 1);
  assert.match(list, /E\.apply\(app\.id, d, p\.x\.target, ch, t2, p\.pl\.before\)/);
  assert.match(list, /E\.without\(app\.id, p\.x\.ch, off\[i\]\)/);
  assert.match(src, /yes\.disabled = offN >= total/);
  for (const k of ["att.docs", "att.err.photo", "chg.textEach", "chg.tickHint", "chg.tick", "f.nickname", "f.job", "f.website"]) {
    assert.equal((src.match(new RegExp('"' + k.replace(/\./g, "\\.") + '":', "g")) || []).length, 2, k);
  }
});

// ---------- edits.js: CRM customers (wave CF2) ----------
const CRM = require(path.join(REPO, "crm/core.js"));
function crmData() {
  return CRM.norm({ ver: 1, cust: [
    { id: "cust000001", m: 1000, name: "Anna Pappa", kind: "person", st: "active", phone: "+30 691 234 5678", note: "met at the fair" },
    { id: "cust000002", m: 1000, name: "Acme", kind: "co", st: "lead", afm: "094014201", addr: "Old St 1, 10431 Athens" }],
    deals: [], acts: [], fups: [], tags: [], stg: [], prefs: {}, tombs: { cust000009: NOW - 1000 } });
}
function crmRun(d, target, args) {
  const ch = ok(args);
  const p = E.plan("crm", d, target, ch, NOW);
  assert.equal(p.ok, true, p.err);
  const a = E.apply("crm", d, target, ch, NOW, p.before);
  assert.equal(a.ok, true, a.err);
  return { p, a };
}
test("crm: tax id, tax office, job, web, address and a note line; stored exactly as CRM itself stores it", () => {
  const { p, a } = crmRun(crmData(), { cust: "cust000001" }, { ref: "r1", action: "update", tax_id: "EL 094014201", tax_office: "Α' Αθηνών",
    job_title: "Author", website: "anna.example", address: { street: "Main 5", zip: "26221", city: "Patra", country: "Greece" }, note_add: "IBAN GR16 0110 1250 0000 0001 2300 695" });
  assert.deepEqual(p.rows.map((r) => r.f), ["job", "vat", "taxoffice", "address", "website", "note"]);
  const c = a.data.cust.find((x) => x.id === "cust000001");
  assert.equal(c.afm, "EL094014201"); assert.equal(c.doy, "Α' Αθηνών"); assert.equal(c.job, "Author");
  assert.equal(c.addr, "Main 5, 26221 Patra"); assert.equal(c.country, "Greece"); assert.equal(c.web, "anna.example");
  assert.equal(c.note, "met at the fair\nIBAN GR16 0110 1250 0000 0001 2300 695");
  assert.equal(c.m, NOW);
  // CRM's own normaliser and merge keep it byte for byte, and it wins over the old copy
  assert.deepEqual(CRM.norm(a.data), a.data);
  assert.deepEqual(CRM.merge(crmData(), a.data), a.data);
  assert.deepEqual(CRM.merge(a.data, crmData()), a.data);
});
test("crm: a filled single field is replaced only with old_* / address_replace; a bad Greek ΑΦΜ is refused", () => {
  const ph = E.plan("crm", crmData(), { cust: "cust000001" }, ok({ ref: "r1", action: "update", phone: "6970000000" }), NOW);
  assert.match(ph.err, /already has phone \+30 691 234 5678; to replace it pass old_phone/);
  const rp = crmRun(crmData(), { cust: "cust000001" }, { ref: "r1", action: "update", phone: "6970000000", old_phone: "6912345678" }).a;
  assert.equal(rp.data.cust[0].phone, "6970000000");
  const ad = E.plan("crm", crmData(), { cust: "cust000002" }, ok({ ref: "r1", action: "update", address: { street: "New 2", city: "Volos" } }), NOW);
  assert.match(ad.err, /address_replace/);
  const afm = E.plan("crm", crmData(), { cust: "cust000002" }, ok({ ref: "r1", action: "update", tax_id: "123456789" }), NOW);
  assert.match(afm.err, /Greek check digit/);
  assert.match(E.plan("crm", crmData(), { deal: "x" }, ok({ ref: "r1", action: "update", note: "x" }), NOW).err, /That deal is no longer in CRM/);
  assert.match(E.plan("crm", crmData(), { act: "x" }, ok({ ref: "r1", action: "update", note: "x" }), NOW).err, /not a history entry/);
  assert.match(E.plan("crm", crmData(), { cust: "cust000001" }, ok({ ref: "r1", action: "update", labels: ["x"] }), NOW).err, /has no labels/);
  assert.deepEqual(E.actionsFor("crm"), ["complete", "reopen", "reschedule", "update"]);
});
test("crm: undo puts the customer back, only while it still looks as the change left it", () => {
  const { a } = crmRun(crmData(), { cust: "cust000001" }, { ref: "r1", action: "update", tax_id: "094014201" });
  const u = E.apply("crm", crmData(), { cust: "cust000001" }, ok({ ref: "r1", action: "update", tax_id: "094014201" }), NOW, null).undo;
  const back = E.undo("crm", a.data, u, NOW + 5);
  assert.equal(back.ok, true, back.err);
  const c = back.data.cust[0];
  assert.equal(c.afm, undefined);
  assert.equal(c.m, NOW + 5);
  assert.deepEqual(CRM.norm(back.data), back.data);
  const moved = JSON.parse(JSON.stringify(a.data)); moved.cust[0].m += 1;
  assert.match(E.undo("crm", moved, u, NOW + 9).err, /changed since/);
});
test("crm: ticks and the search text the model sees", () => {
  const p = E.plan("crm", crmData(), { cust: "cust000002" }, ok({ ref: "r1", action: "update", tax_office: "ΔΟΥ Χ", website: "acme.example" }), NOW);
  assert.equal(E.canTick("crm", p.rows), true);
  const S = require(path.join(REPO, "crm/search.js"));
  const hits = S.search({ readJSON: () => crmData(), lang: "en" });
  assert.match(hits.find((h) => h.title === "Acme").text, /094014201 · Old St 1, 10431 Athens/);
});
