// create_items: a field the app does not take is an error, never
// dropped in silence (2026-11-08, a Publishing title through orOS Gate
// lost "people" and "editions"); Publishing's other roles.
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../assistant/core.js");

test("crUnknown names fields the app does not take, also inside formats", () => {
  const r = C.crUnknown("publish", [{ title: "Άμμος", status: "released", people: [], editions: [], formats: [{ format: "paperback", isbn: "x", issn: "y" }] }]);
  assert.deepEqual(r.bad, ["items[0].people", "items[0].editions", "items[0].formats[0].issn"]);
  ["by", "translator", "illustrator", "editor", "cover_designer", "narrator", "other", "formats", "note", "blurb", "series", "date"].forEach((f) => assert.ok(r.fields.indexOf(f) >= 0, f));
  assert.deepEqual(C.crUnknown("publish", [{ title: "A", by: "B", other: "C (typesetting)", formats: [{ format: "ebook", wc_id: 5 }] }]).bad, []);
  assert.deepEqual(C.crUnknown("contacts", [{ name: "A", phones: ["1"], title: "x" }]).bad, ["items[0].title"]);
});
