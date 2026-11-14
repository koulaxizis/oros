// translate/engine.js pure helpers (OrosTranslate): routes, sizes, lines,
// inline tags, language detection; and the model table's shape.
const test = require("node:test");
const assert = require("node:assert");
const T = require("../translate/engine.js");

test("routes: direct, through English, same language, none", () => {
  assert.deepStrictEqual(T.route("el", "en"), ["el-en"]);
  assert.deepStrictEqual(T.route("en", "el"), ["en-el"]);
  assert.deepStrictEqual(T.route("el", "el"), []);
  assert.strictEqual(T.route("el", "xx"), null);
  assert.deepStrictEqual(T.languages(), ["el", "en"]);
  assert.deepStrictEqual(T.pairs(), [{ from: "el", to: "en" }, { from: "en", to: "el" }]);
});

test("model table: every file has a name, sizes and a SHA-256", () => {
  Object.keys(T.MODELS).forEach((pair) => {
    assert.match(pair, /^[a-z]{2,3}(_[a-z]+)?-[a-z]{2,3}(_[a-z]+)?$/);
    const M = T.MODELS[pair];
    assert.match(M.v, /^[A-Za-z0-9_-]+$/);
    assert.deepStrictEqual(Object.keys(M.files).sort(), ["lex", "model", "vocab"]);
    Object.keys(M.files).forEach((k) => {
      const f = M.files[k];
      assert.match(f.n, /^[a-z0-9._]+$/, pair + " " + k);
      assert.match(f.sha, /^[0-9a-f]{64}$/, pair + " " + k);
      assert.ok(f.size > 0 && f.gz > 0 && f.gz <= f.size, pair + " " + k);
    });
  });
  assert.ok(T.pairBytes("el-en") > 10e6 && T.pairBytes("el-en") < 20e6);
  assert.ok(T.runtimeBytes() > 5e6 && T.runtimeBytes() < 6e6);
  assert.ok(/^https:\/\/koulaxizis\.github\.io\/oros-models\/translate\/$/.test(T.MIRROR));
});

test("lines keep their breaks", () => {
  const s = "a\r\nb\n\nc\rd";
  const l = T.splitLines(s);
  assert.deepStrictEqual(l.map((x) => x.br), ["\r\n", "\n", "\n", "\r", ""]);
  assert.strictEqual(l.map((x) => x.text + x.br).join(""), s);
  assert.deepStrictEqual(T.splitLines(""), [{ text: "", br: "" }]);
});

test("white space around a line stays, empty and symbol-only lines are not sent", () => {
  const p = T.prepare("  Καλημέρα!  ");
  assert.strictEqual(p.send, "Καλημέρα!");
  assert.strictEqual(T.finish(p, "Good morning!").text, "  Good morning!  ");
  ["", "   ", "— · —", "***", "\t"].forEach((s) => {
    const q = T.prepare(s);
    assert.ok(q.skip, JSON.stringify(s));
    assert.strictEqual(T.finish(q, "x").text, s);
  });
  assert.ok(!T.prepare("3").skip);
  assert.strictEqual(T.prepare("a < b & c").html, false);
});

test("inline tags go out as HTML and come back", () => {
  const src = "Click ⟦1⟧Save⟦/1⟧ & see ⟦2/⟧ <now>";
  const p = T.prepare(src);
  assert.ok(p.html);
  assert.strictEqual(p.send, "Click <t1>Save</t1> &amp; see <v2></v2> &lt;now&gt;");
  const back = T.finish(p, "Κάντε κλικ <t1>Αποθήκευση</t1> &amp; δείτε <v2></v2> &lt;τώρα&gt;");
  assert.strictEqual(back.text, "Κάντε κλικ ⟦1⟧Αποθήκευση⟦/1⟧ & δείτε ⟦2/⟧ <τώρα>");
  assert.ok(back.tagsOk);
  const lost = T.finish(p, "Κάντε κλικ Αποθήκευση <v2/>");
  assert.strictEqual(lost.text, "Κάντε κλικ Αποθήκευση ⟦2/⟧");
  assert.strictEqual(lost.tagsOk, false);
  assert.strictEqual(T.finish(p, "<b>x</b> <t1>y</t1><t1>z</t1> ⟦2/⟧").tagsOk, false);
  assert.strictEqual(T.fromHtml("<p>a</p> &#233;&#x3b1; &bogus;"), "a éα &bogus;");
});

test("Greek or English", () => {
  assert.strictEqual(T.detect("Καλημέρα σε όλους, hello"), "el");
  assert.strictEqual(T.detect("Good morning to everyone in Ελλάδα"), "en");
  assert.strictEqual(T.detect(""), "en");
  assert.strictEqual(T.detect("ΜΕΓΑΛΑ ΓΡΆΜΜΑΤΑ"), "el");
});
