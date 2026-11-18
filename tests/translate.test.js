// translate/engine.js pure helpers (OrosTranslate): routes, sizes, lines,
// inline tags, language detection, the AI prompt; and the model table.
const test = require("node:test");
const assert = require("node:assert");
const T = require("../translate/engine.js");

test("routes: direct, through English, same language, none", () => {
  assert.deepStrictEqual(T.route("el", "en"), ["el-en"]);
  assert.deepStrictEqual(T.route("en", "el"), ["en-el"]);
  assert.deepStrictEqual(T.route("el", "el"), []);
  assert.deepStrictEqual(T.route("el", "de"), ["el-en", "en-de"]);
  assert.deepStrictEqual(T.route("ru", "el"), ["ru-en", "en-el"]);
  assert.strictEqual(T.route("el", "ru"), null);            // no English → Russian yet
  assert.strictEqual(T.route("ja", "en"), null);            // Japanese only from English
  assert.strictEqual(T.route("el", "xx"), null);
  assert.strictEqual(T.languages().length, 22);
  ["ar", "bg", "de", "el", "en", "fr", "ru", "sq", "tr", "uk", "zh"].forEach((l) => assert.ok(T.languages().indexOf(l) >= 0, l));
  assert.ok(T.froms().indexOf("ru") >= 0 && T.froms().indexOf("ja") < 0);
  assert.ok(T.tos().indexOf("ja") >= 0 && T.tos().indexOf("ru") < 0);
  const p = T.pairs();
  assert.ok(p.some((x) => x.from === "de" && x.to === "el"));
  assert.ok(!p.some((x) => x.from === x.to));
  p.forEach((x) => assert.ok(T.route(x.from, x.to), x.from + "-" + x.to));
});

test("model table: every file has a name, sizes and a SHA-256", () => {
  Object.keys(T.MODELS).forEach((pair) => {
    assert.match(pair, /^[a-z]{2,3}(_[a-z]+)?-[a-z]{2,3}(_[a-z]+)?$/);
    const M = T.MODELS[pair];
    assert.match(M.v, /^[A-Za-z0-9_-]+$/);
    const parts = Object.keys(M.files).sort().join(",");
    assert.ok(parts === "lex,model,vocab" || parts === "lex,model,srcvocab,trgvocab", pair + " " + parts);
    Object.keys(M.files).forEach((k) => {
      const f = M.files[k];
      assert.match(f.n, /^[a-z0-9._]+$/, pair + " " + k);
      assert.match(f.sha, /^[0-9a-f]{64}$/, pair + " " + k);
      assert.ok(f.size > 0 && f.gz > 0 && f.gz <= f.size, pair + " " + k);
    });
    assert.ok(T.pairBytes(pair) > 10e6 && T.pairBytes(pair) < 40e6, pair);
  });
  assert.strictEqual(T.MODELS["el-en"].files.model.sha, "0a43c3716156061494d995d0c88113e789f8d919e0c88a15bc1ad360e0482a8c");
  assert.ok(T.runtimeBytes() > 5e6 && T.runtimeBytes() < 6e6);
  assert.ok(/^https:\/\/koulaxizis\.github\.io\/oros-models\/translate\/$/.test(T.MIRROR));
});

test("the table is what make-models.js writes from the copy's index", () => {
  const M = require("../translate/make-models.js");
  const index = { pairs: {} };
  Object.keys(T.MODELS).forEach((pair) => {
    index.pairs[pair] = { folder: T.MODELS[pair].v, files: T.MODELS[pair].files };
  });
  const src = require("fs").readFileSync(require("path").join(__dirname, "../translate/engine.js"), "utf8");
  const a = src.indexOf("  // MODELS-BEGIN\n") + "  // MODELS-BEGIN\n".length, b = src.indexOf("\n  // MODELS-END");
  assert.strictEqual(src.slice(a, b), M.table(index));
  assert.throws(() => M.table({ pairs: { "el-en": { folder: "x", files: { model: { n: "a/b", size: 1, gz: 1, sha: "0".repeat(64) } } } } }));
  assert.throws(() => M.table({ pairs: { "el-en": { folder: "x", files: { other: {} } } } }));
});

test("names of languages in the person's language", () => {
  assert.strictEqual(T.name("de", "en"), "German");
  assert.strictEqual(T.name("de", "el"), "Γερμανικά");
  assert.strictEqual(T.name("el", "de"), "Griechisch");
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

test("language of a text: script, then common words", () => {
  const s = {
    el: "Δεν ξέρω γιατί έφυγε τόσο νωρίς.", en: "I do not know why he left so early this morning with his sister.",
    de: "Ich habe heute keine Zeit, aber morgen gehe ich mit dir ins Kino.",
    fr: "Je ne sais pas pourquoi il est parti si tôt ce matin avec sa sœur.",
    es: "No sé por qué se fue tan temprano esta mañana con su hermana.",
    it: "Non so perché è andato via così presto stamattina con sua sorella.",
    pt: "Não sei por que ele saiu tão cedo esta manhã com a irmã dele.",
    nl: "Ik weet niet waarom hij vanochtend zo vroeg met zijn zus vertrok.",
    tr: "Bu sabah kız kardeşiyle neden bu kadar erken gittiğini bilmiyorum.",
    ro: "Nu știu de ce a plecat atât de devreme în această dimineață cu sora lui.",
    pl: "Nie wiem, dlaczego wyszedł tak wcześnie dziś rano z siostrą.",
    cs: "Nevím, proč dnes ráno odešel tak brzy se svou sestrou.",
    sv: "Jag vet inte varför han gick så tidigt i morse med sin syster.",
    hu: "Nem tudom, miért ment el ilyen korán ma reggel a húgával.",
    fi: "En tiedä, miksi hän lähti niin aikaisin tänä aamuna siskonsa kanssa.",
    sq: "Nuk e di pse u largua kaq herët këtë mëngjes me motrën e tij.",
    ru: "Я не знаю, почему он ушёл так рано сегодня утром.",
    uk: "Я не знаю, чому він пішов так рано сьогодні вранці зі своєю сестрою.",
    bg: "Не знам защо си тръгна толкова рано тази сутрин със сестра си.",
    ar: "لا أعرف لماذا غادر مبكرا هذا الصباح", ja: "今朝、彼がなぜそんなに早く出かけたのか分かりません。",
    zh: "我不知道他今天早上为什么这么早离开。"
  };
  Object.keys(s).forEach((l) => assert.strictEqual(T.detect(s[l]), l, l));
  assert.strictEqual(T.detect("Καλημέρα σε όλους, hello"), "el");
  assert.strictEqual(T.detect("Good morning to everyone in Ελλάδα"), "en");
  assert.strictEqual(T.detect(""), "en");
  assert.strictEqual(T.detect("12345 !!!"), "en");
  assert.strictEqual(T.detect("ΜΕΓΑΛΑ ΓΡΆΜΜΑΤΑ"), "el");
});

test("the Assistant's AI: prompt, answer, batches", () => {
  const sys = T.aiPrompt("el", "de", [{ src: "πίτα", tgt: "Pita" }, { src: " ", tgt: "x" }, null]);
  assert.match(sys, /from Greek to German/);
  assert.match(sys, /πίτα → Pita/);
  assert.ok(!/ → x/.test(sys));
  assert.deepStrictEqual(T.aiParse('Sure: ["a", "b"]', 2), ["a", "b"]);
  assert.strictEqual(T.aiParse('["a"]', 2), null);
  assert.strictEqual(T.aiParse('["a", 3]', 2), null);
  assert.strictEqual(T.aiParse("no array", 1), null);
  const prep = Array.from({ length: 70 }, (_, i) => ({ core: i === 5 ? "x".repeat(3990) : "word" }));
  const b = T.aiBatches(prep.map((_, i) => i), prep);
  assert.deepStrictEqual(b.flat(), prep.map((_, i) => i));
  b.forEach((ids) => {
    assert.ok(ids.length <= 30);
    assert.ok(ids.length === 1 || ids.reduce((n, i) => n + prep[i].core.length, 0) <= 4000);
  });
});
