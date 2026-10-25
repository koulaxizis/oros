// Newsletter by chat, wave N1: the Assistant's newsletter_add card
// becomes { asAdd } for Newsletter, and every block the card shows is
// one Newsletter's own normaliser keeps with the same values.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const root = path.join(__dirname, "..");
const A = require(path.join(root, "assistant/core.js"));
const C = require(path.join(root, "newsletter/core.js"));

const ARGS = {
  subject: "October news",
  blocks: [
    { kind: "heading", text: "Interview with Maria", level: 1 },
    { kind: "text", text: "Maria talks about her new book.\n\nRead **all** of it [here](https://example.com/i)." },
    { kind: "quote", text: "Books are slow on purpose.", by: "Maria" },
    { kind: "button", text: "Read the interview", url: "https://example.com/interview", align: "center" },
    { kind: "list", items: ["One", " Two ", ""], ordered: true },
    { kind: "divider" },
    { kind: "spacer" }
  ]
};

test("normNewsletter maps the model's blocks to Newsletter blocks", () => {
  const n = A.normNewsletter(ARGS);
  assert.equal(n.ok, true);
  assert.equal(n.subj, "October news");
  assert.deepEqual(n.blocks, [
    { k: "h", t: "Interview with Maria", lv: 1 },
    { k: "p", t: "Maria talks about her new book.\n\nRead **all** of it [here](https://example.com/i)." },
    { k: "quote", t: "Books are slow on purpose.", by: "Maria" },
    { k: "btn", t: "Read the interview", href: "https://example.com/interview", al: "center" },
    { k: "list", t: "One\nTwo", ord: 1 },
    { k: "hr" },
    { k: "sp", h: 24 }
  ]);
  assert.equal(n.view.length, 7);
  assert.equal(n.view[3].text, "Read the interview → https://example.com/interview");
});

test("normNewsletter refuses what Newsletter could not keep", () => {
  assert.equal(A.normNewsletter({}).ok, false);
  assert.equal(A.normNewsletter({ blocks: [] }).ok, false);
  assert.match(A.normNewsletter({ blocks: [{ kind: "video" }] }).err, /unknown kind/);
  assert.match(A.normNewsletter({ blocks: [{ kind: "button", text: "Go", url: "javascript:alert(1)" }] }).err, /http/);
  assert.match(A.normNewsletter({ blocks: [{ kind: "text", text: "  " }] }).err, /no text/);
  const many = { blocks: Array.from({ length: A.NL_MAX + 1 }, () => ({ kind: "divider" })) };
  assert.match(A.normNewsletter(many).err, /At most/);
  // a heading of level 2 is Newsletter's default and is left out
  assert.deepEqual(A.normNewsletter({ blocks: [{ kind: "heading", text: "H", level: 2 }] }).blocks, [{ k: "h", t: "H" }]);
});

test("every block the card sends is kept by Newsletter as it is", () => {
  const n = A.normNewsletter(ARGS);
  const v = C.asAdd({ blocks: n.blocks, subj: n.subj, issue: "" });
  assert.ok(v);
  assert.deepEqual(v.blocks, n.blocks);
  assert.equal(v.subj, "October news");
  assert.equal(v.issue, "");
  Object.keys(A.NL_KINDS).forEach((k) => assert.ok(C.AS_KINDS.includes(A.NL_KINDS[k]), k));
  assert.equal(A.NL_MAX, C.AS_MAX);
});

test("asAdd takes only plain kinds and drops empty blocks", () => {
  const v = C.asAdd({
    blocks: [
      { k: "prod", items: [{ name: "x", href: "https://x.example.com" }] },
      { k: "head", t: "x" },
      { k: "p", t: "" },
      { k: "btn", t: "Go", href: "" },
      { k: "btn", t: "Go", href: "javascript:alert(1)" },
      { k: "p", t: "kept" },
      null, "x"
    ],
    issue: "../bad"
  });
  assert.deepEqual(v.blocks, [{ k: "p", t: "kept" }]);
  assert.equal(v.issue, "");
  assert.equal(C.asAdd({ blocks: [{ k: "p", t: "" }] }), null);
  assert.equal(C.asAdd(null), null);
  assert.equal(C.asAdd({ blocks: "p" }), null);
  const lots = C.asAdd({ blocks: Array.from({ length: 30 }, () => ({ k: "hr" })) });
  assert.equal(lots.blocks.length, C.AS_MAX);
});

test("insertAt puts new blocks before the footer and its social row", () => {
  assert.equal(C.insertAt([]), 0);
  assert.equal(C.insertAt([{ k: "head" }, { k: "p" }]), 2);
  assert.equal(C.insertAt([{ k: "head" }, { k: "p" }, { k: "foot" }]), 2);
  assert.equal(C.insertAt([{ k: "head" }, { k: "p" }, { k: "social" }, { k: "foot" }]), 2);
  assert.equal(C.insertAt([{ k: "foot" }]), 0);
});

test("the tool and its prompt line come only with Newsletter", () => {
  const names = (o) => A.toolsFor(o).map((x) => x.name);
  assert.ok(!names({ entries: true }).includes("newsletter_add"));
  assert.ok(names({ entries: true, newsletter: true }).includes("newsletter_add"));
  const on = A.systemPrompt({ lang: "en", now: 0, newsletter: true, entries: ["todo"] });
  const off = A.systemPrompt({ lang: "en", now: 0, entries: ["todo"] });
  assert.match(on, /newsletter_add/);
  assert.match(on, /never that they were added or sent/);
  assert.doesNotMatch(off, /newsletter_add/);
  assert.doesNotMatch(A.systemPrompt({ lang: "en", now: 0, newsletter: true, builtin: true }), /newsletter_add/);
});

// Wave N2: pictures come as web addresses, never as files.
test("picture blocks carry the picture's https address, checked", () => {
  const n = A.normNewsletter({ blocks: [
    { kind: "picture_text", image_url: "https://shop.example.com/cover.jpg", heading: "New book", text: "Out now.",
      button_text: "Get it", button_url: "https://shop.example.com/b", side: "right", alt: "Cover" },
    { kind: "image", url: "https://fair.example.com", alt: "Book fair banner" }
  ] });
  assert.equal(n.ok, true);
  assert.deepEqual(n.blocks[0], { k: "imgtxt", src: "https://shop.example.com/cover.jpg", alt: "Cover", hd: "New book", t: "Out now.",
                                  bt: "Get it", bh: "https://shop.example.com/b", side: "r" });
  assert.deepEqual(n.blocks[1], { k: "img", alt: "Book fair banner", href: "https://fair.example.com/" });
  assert.match(A.normNewsletter({ blocks: [{ kind: "image", image_url: "http://x.example.com/a.jpg" }] }).err, /https/);
  assert.match(A.normNewsletter({ blocks: [{ kind: "image", image_url: "https://u:p@x.example.com/a.jpg" }] }).err, /https/);
  assert.match(A.normNewsletter({ blocks: [{ kind: "picture_text", heading: "H", button_text: "Go" }] }).err, /button/);
  assert.match(A.normNewsletter({ blocks: [{ kind: "picture_text", image_url: "https://x.example.com/a.jpg" }] }).err, /heading or text/);
  assert.match(A.normNewsletter({ blocks: [{ kind: "image", url: "ftp://x" }] }).err, /url/);
});

test("asAdd turns picture addresses into pics and never takes a file", () => {
  const n = A.normNewsletter({ blocks: [
    { kind: "heading", text: "H" },
    { kind: "picture_text", image_url: "https://shop.example.com/cover.jpg", heading: "New book" },
    { kind: "image", alt: "Banner", url: "https://fair.example.com" }
  ] });
  const v = C.asAdd({ blocks: n.blocks });
  assert.deepEqual(v.pics, [{ i: 1, src: "https://shop.example.com/cover.jpg" }]);
  assert.equal(v.blocks[1].k, "imgtxt");
  assert.equal(v.blocks[1].f, "");
  assert.equal(v.blocks[1].hd, "New book");
  assert.ok(!("src" in v.blocks[1]));
  assert.equal(v.blocks[2].href, "https://fair.example.com/");
  const bad = C.asAdd({ blocks: [
    { k: "img", f: "/internal/Newsletter/old.jpg", src: "http://plain.example.com/a.jpg" },
    { k: "imgtxt", src: "https://x.example.com/a.jpg" }
  ] });
  assert.equal(bad.blocks.length, 1);
  assert.equal(bad.blocks[0].f, "");
  assert.deepEqual(bad.pics, []);
});
