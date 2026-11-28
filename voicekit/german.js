// ============================================================
// orOS voices — German text to phonemes (voicekit/german.js, v1.0.0)
// Turns German text into the IPA phonemes a Piper voice was trained on
// (the German Piper voices were trained on espeak-ng's phonemes). Written
// here from German spelling rules, MIT like the rest of orOS: espeak-ng
// itself (GPL-3.0) is never shipped or loaded. tests/voicekit-german.test.js
// checks the output against words that espeak-ng phonemized
// (tests/fixtures/voicekit-german.tsv), so the voice hears what it learned.
//   GermanVoice.words(text)      → the text with numbers, symbols and
//                                  short forms spelled out as German words
//   GermanVoice.word(w)          → the phonemes of one word ("ʃpɾˈɑːxə")
//   GermanVoice.sentences(text)  → [{ text, ph }]: one entry per sentence,
//                                  ph = phonemes with spaces and punctuation
// Pure: no DOM, no network. UMD: module.exports in Node,
// window.GermanVoice in the browser and in workers.
// i18n-inline-ok: the German words here are data (spelling rules, number words, short forms), not text to translate.
// ============================================================
(function (root) {
  "use strict";

  var P = "ˈ", S = "ˌ", L = "ː";   // ˈ ˌ ː
  var VOW = "aeiouäöüy";

  // ---------- words said their own way ----------
  // "-" before a vowel: no stress of its own; "," : a light (secondary) stress
  var LEX = {};
  function lex(list) {
    list.split(/\s+/).forEach(function (e) {
      if (!e) return;
      var i = e.indexOf("=");
      LEX[e.slice(0, i)] = e.slice(i + 1).replace(/_/g, " ");
    });
  }
  // short words without stress of their own (articles, pronouns, auxiliaries)
  lex("der=dɛɾ die=diː das=das des=dɛs dem=deːm den=deːn es=ɛs ist=ɪst sich=zɪç sind=zɪnt hat=hat " +
      "du=duː sie=ziː wie=viː er=ɛɾ wir=viːɾ ihr=iːɾ ich=ɪç mich=mɪç dich=dɪç mir=miːɾ dir=diːɾ uns=ʊns " +
      "zum=tsʊm zur=tsuːɾ vom=fɔm beim=baɪm ins=ɪns am=am so=zoː da=daː man=man sein=zaɪn " +
      "kann=kan " +
      // a light stress
      "eine=ˌaɪnə einen=ˌaɪnən einem=ˌaɪnəm einer=ˌaɪnɜ eines=ˌaɪnəs wird=vˌɪɾt werden=vˌɛɾdən " +
      "auch=ˌaʊx wurde=vˌʊɐdə wurden=vˌʊɐdən ihre=ˌiːrə ihren=ˌiːrən ihrem=ˌiːrəm ihrer=ˌiːrɜ ihr=ˌiːɾ " +
      "diese=dˌiːzə diesem=dˌiːzəm diesen=dˌiːzən dieser=dˌiːzɜ dieses=dˌiːzəs etwa=ˌɛtvɑː " +
      // stressed short words that break the rules
      "und=ˈʊnt in=ˈɪn an=ˈan um=ˈʊm im=ˈɪm mit=mˈɪt ab=ˈap ob=ˈɔp bis=bˈɪs was=vˈas " +
      "von=fˈɔn wenn=vˈɛn denn=dˈɛn dann=dˈan nicht=nˈɪçt nach=nˈɑːx noch=nˈɔx doch=dˈɔx " +
      "zu=tsˈuː für=fˈyːɾ aus=ˈaʊs auf=ˈaʊf als=ˈals oder=ˈoːdɜ aber=ˈɑːbɜ ein=ˈaɪn " +
      "es=ɛs dass=dˈas weg=vˈɛk hin=hˈɪn her=hˈeːɾ mehr=mˈeːɾ sehr=zˈeːɾ schon=ʃˈoːn " +
      "etwas=ˈɛtvɑːs damit=dɑːmˈɪt jetzt=jˈɛtst nur=nˈuːɾ hier=hˈiːɾ dort=dˈɔɾt " +
      "ja=jˈɑː nein=nˈaɪn pro=pɾoː zurück=tsuːrˈʏk über=ˈyːbɜ unter=ˈʊntɜ " +
      "mal=mˈɑːl einmal=ˈaɪnmˌɑːl viel=fˈiːl viele=fˈiːlə vier=fˈiːɾ " +
      "oros=ˈoːɾ_ˈoːs chance=ʃˈɑ̃sə chip=tʃˈɪp euro=ˈɔøroː app=ˈap apps=ˈaps");
  // more short words (closed classes) and how strongly they are said
  lex("eins=ˈaɪns zwei=tsvˈaɪ drei=dɾˈaɪ fünf=fˈʏnf sieben=zˈiːbən acht=ˈaxt neun=nˈɔøn zehn=tsˈeːn " +
      "elf=ˈɛlf zwölf=tsvˈœlf zwanzig=tsvˈantsɪç dreißig=dɾˈaɪsɪç hundert=hˈʊndɜt tausend=tˈaʊzənt " +
      "dreizehn=dɾˈaɪtseːn vierzehn=fˈiːɾtseːn fünfzehn=fˈʏnftseːn sechzehn=zˈɛçtseːn siebzehn=zˈiːptseːn " +
      "achtzehn=ˈaxtseːn neunzehn=nˈɔøntseːn vierzig=fˈiːɾtsɪç fünfzig=fˈʏnftsɪç sechzig=zˈɛçtsɪç " +
      "siebzig=zˈiːptsɪç achtzig=ˈaxtsɪç neunzig=nˈɔøntsɪç null=nˈʊl uhr=ˈuːɾ komma=kˈɔma " +
      "zusammen=tsuːzˈamən denen=dˈeːnən dasselbe=daszˈɛlbə dieselbe=diːzˈɛlbə derselbe=deːɾzˈɛlbə " +
      "dieselben=diːzˈɛlbən zum=tsˈʊm zur=tsˈuːɾ dann=dan hast=hast kann=kˌan kannst=kˌanst am=ˈam noch=nɔx " +
      "dich=dˈɪç so=zˈoː beim=bˈaɪm dir=dˈiːɾ ihr=iːɾ wo=vˌoː seinen=zˌaɪnən seiner=zˌaɪnɜ seine=zˈaɪnə " +
      "sein=zaɪn seinem=zˌaɪnəm willst=vɪlst will=vɪl wollen=vɔlən konnte=kˈɔntə musst=mˈʊst muss=mˈʊs " +
      "müssen=mˈʏsən soll=zˌɔl sollst=zˌɔlst sollte=zˌɔltə darf=dˈaɾf darfst=dˈaɾfst mein=mˈaɪn " +
      "meine=mˈaɪnə meinen=mˈaɪnən meiner=mˈaɪnɜ dein=dˈaɪn deine=dˈaɪnə deinen=dˈaɪnən deinem=dˈaɪnəm " +
      "deiner=dˈaɪnɜ unser=ˌʊnzɜ unsere=ˌʊnzrə euer=ˈɔøɜ eure=ˈɔørə man=man uns=ˈʊns euch=ˈɔøç ihm=ˈiːm " +
      "ihn=ˈiːn ihnen=ˈiːnən wer=vˈeːɾ wen=vˈeːn wem=vˈeːm warum=vɑːrˈʊm wann=vˈan weil=vˌaɪl " +
      "sondern=zˈɔndɜn bereits=bərˈaɪts immer=ˈɪmɜ nie=nˈiː kein=kˈaɪn keine=kˈaɪnə keinen=kˈaɪnən " +
      "keiner=kˈaɪnɜ bin=bɪn bist=bɪst seid=zˈaɪt war=vɑːɾ waren=vɑːrən gibt=ɡˈiːpt habe=hɑːbə " +
      "haben=hˈɑːbən hatte=hˌatə hätte=hˌɛtə wäre=vˈɛːrə würde=vˈʏɾdə würdest=vˈʏɾdəst wirst=vˌɪɾst " +
      "werde=vˌɛɾdə dabei=dɑːbˈaɪ dafür=dɑːfˈyːɾ danach=danˈax darauf=dɑːrˈaʊf daran=dɑːrˈan darin=dɑːrˈɪn " +
      "darum=dɑːrˈʊm darüber=dɑːrˈyːbɜ dazu=dɑːtsˈuː davon=dɑːfˈɔn dadurch=dɑːdˈʊɐç dagegen=daɡˈeːɡən " +
      "daher=dɑːhˈɛɾ deshalb=dɛshˈalp also=ˈalzoː zwar=tsvɑːɾ sowie=zoːvˈiː nun=nˈuːn gegen=ɡˈeːɡən " +
      "ohne=ˈoːnə bei=bˈaɪ seit=zaɪt während=vˌɛːrənt wegen=vˈeːɡən trotz=tɾˈɔts zwischen=tsvˈɪʃən " +
      "neben=nˈeːbən hinter=hˈɪntɜ vor=fˈɔɾ vom=fˈɔm aufs=ˈaʊfs fürs=fˈyːɾs ganz=ɡˌants gern=ɡˈɛɾn " +
      "gerne=ɡˈɛɾnə hallo=hˈaloː alle=ˈalə alles=ˈaləs allen=ˈalən jede=jˈeːdə jeden=jˈeːdən jedes=jˈeːdəs " +
      "jeder=jˈeːdɜ weniger=vˈeːnɪɡɜ da=dˈɑː dies=diːs solche=zˈɔlçə selbst=zˈɛlpst genau=ɡənˈaʊ " +
      "eben=ˈeːbən einfach=ˈaɪnfˌax erst=ˈeːɾst erste=ˈeːɾstə ersten=ˈeːɾstən erster=ˈeːɾstɜ " +
      "erstes=ˈeːɾstəs zuerst=tsuːˈeːɾst andere=ˈandərə anderen=ˈandərən anderer=ˈandərɜ anderes=ˈandərəs " +
      "anderem=ˈandərəm unten=ˈʊntən");

  // endings that take the stress (foreign words)
  var STR_SUF = ["ation", "ition", "ution", "tionen", "tion", "sion", "sionen", "ität", "itäten", "tät", "täten",
    "ieren", "iert", "ierst", "ierung", "ierungen", "iere", "ierte", "ierten",
    "erie", "ie", "ien", "ei", "eien", "ur", "uren", "ant", "anten", "ent", "enten", "enz", "enzen", "anz",
    "ell", "elle", "ellen", "iv", "ive", "iven", "ös", "öse", "är", "äre", "eur", "eure", "ist", "isten",
    "ismus", "al", "ale", "alen", "at", "ate", "aten", "ik", "iken", "ine", "inen", "ade", "age", "ett", "ette",
    "on", "ons", "ür", "ment", "mente", "ekt", "ekte", "ekten", "ekts"];
  // endings without stress (native): the stem before them takes it
  var SUF = ["ungen", "ung", "heiten", "heit", "keiten", "keit", "schaften", "schaft", "lichen", "liche", "licher",
    "lichem", "liches", "lich", "igen", "ige", "iger", "igem", "iges", "igt", "ig", "ischen", "ische", "isch",
    "baren", "bare", "bar", "samen", "same", "sam", "losen", "lose", "los", "chen", "lein", "nisse", "nis",
    "tum", "ern", "erst", "ert", "ere", "eren", "erem", "erer", "eres", "er", "elt", "eln", "el",
    "est", "en", "em", "es", "et", "st", "e", "t"];

  // ---------- letters → sounds ----------
  // A tiny parser: returns [{ ph, v }] where v marks a vowel segment
  // (ph = its sound) so stress can be put in front of it.
  function isV(c) { return c && VOW.indexOf(c) !== -1; }

  // the sound of one morph; long = whether a lone vowel is long here,
  // weak = an unstressed native ending (e → ə)
  function sounds(m, opts) {
    opts = opts || {};
    var out = [], i = 0, n = m.length;
    function push(ph, v) { out.push({ ph: ph, v: !!v }); }
    // how many consonant letters follow position j (until a vowel or the end)
    function consAfter(j) { var k = j; while (k < n && !isV(m[k])) k++; return { count: k - j, end: k >= n }; }
    while (i < n) {
      var c = m[i], c2 = m.substr(i, 2), c3 = m.substr(i, 3), c4 = m.substr(i, 4);
      // ---- vowels ----
      if (isV(c)) {
        var dip = { ei: "aɪ", ai: "aɪ", ey: "aɪ", ay: "aɪ", au: "aʊ", eu: "ɔø", "äu": "ɔø" }[c2];
        if (dip) { push(dip, true); i += 2; continue; }
        if (c2 === "ie") {
          push("i" + L, true); i += 2; if (m[i] === "h") i++; continue;
        }
        var base = { a: ["a", "ɑ"], e: ["ɛ", "e"], i: ["ɪ", "i"], o: ["ɔ", "o"], u: ["ʊ", "u"],
          "ä": ["ɛ", "ɛ"], "ö": ["œ", "ø"], "ü": ["ʏ", "y"], y: ["ʏ", "y"] }[c];
        var isLong;
        if (m[i + 1] === c && "aeo".indexOf(c) !== -1) { isLong = true; i++; }
        else if (m[i + 1] === "h" && !isV(m[i + 2] || "x") ) { isLong = true; i++; }
        else if (m[i + 1] === "h" && isV(m[i + 2])) { isLong = true; i++; }
        else {
          var ca = consAfter(i + 1);
          var next = m.substr(i + 1, 3);
          if (/^(ch|sch|ck|ng|nk|tz|pf|ss|x)/.test(next) && !/^ß/.test(next)) isLong = c === "u" && /^ch([^t]|$)/.test(next);
          else if (m[i + 1] === "ß") isLong = true;
          else if (ca.count === 0) isLong = true;
          else if (ca.count === 1) isLong = ca.end ? opts.closedLong !== false : true;
          else if (ca.count === 2 && /^(pr|pl|tr|kr|kl|br|bl|dr|gr|gl|fr|fl)/.test(next) && !ca.end) isLong = true;
          else isLong = false;
        }
        if (c === "e" && opts.weak) { push("ə", true); i++; continue; }
        var ph = base[isLong ? 1 : 0] + (isLong ? L : "");
        push(ph, true);
        if (c === "e") out[out.length - 1].e = true;
        i++;
        continue;
      }
      // ---- consonants ----
      var prevV = out.length && out[out.length - 1].v;
      var last = i === n - 1;
      if (c4 === "tsch") { push("tʃ"); i += 4; continue; }
      if (c2 === "ti" && i > 0 && /[aoäöu]/.test(m[i + 2] || "")) { push("tsj"); i += 2; continue; }
      if (c3 === "sch") { push("ʃ"); i += 3; continue; }
      if (c3 === "chs" && m[i + 3] !== "t") { push("ks"); i += 3; continue; }
      if (c2 === "ch" && (m[i + 2] === "r" || m[i + 2] === "l")) { push("k"); i += 2; continue; }
      if (c2 === "ch") {
        var pv = out.length ? out[out.length - 1].ph : "";
        push(/(a|ɑː|o|oː|ɔ|u|uː|ʊ|aʊ)$/.test(pv) && prevV ? "x" : "ç"); i += 2; continue;
      }
      if (c2 === "ck") { push("k"); i += 2; continue; }
      if (c2 === "ph") { push("f"); i += 2; continue; }
      if (c2 === "th") { push("t"); i += 2; continue; }
      if (c2 === "qu") { push("kv"); i += 2; continue; }
      if (c2 === "tz") { push("ts"); i += 2; continue; }
      if (c2 === "dt") { push("t"); i += 2; continue; }
      if (c2 === "ng") { push("ŋ"); i += 2; continue; }
      if (c2 === "nk") { push("ŋk"); i += 2; continue; }
      if (c2 === "pf") { push("pf"); i += 2; continue; }
      if ((c2 === "sp" || c2 === "st") && i === 0) { push("ʃ" + c2[1]); i += 2; continue; }
      if (c === "ß") { push("s"); i++; continue; }
      if (c2 === "ss") { push("s"); i += 2; continue; }
      if (c === m[i + 1] && !isV(c)) { i++; continue; }        // a double consonant is one sound
      if (c === "h") {
        if (prevV && !(isV(m[i + 1]) && /^(aɪ|aʊ|ɔø)$/.test(out[out.length - 1].ph))) { i++; continue; }
        push("h"); i++; continue;
      }
      if (c === "r") {
        var before = out.length ? out[out.length - 1] : null;
        if (isV(m[i + 1])) { push(before && !before.v && !/^(ʃ|f)$/.test(before.ph) ? "ɾ" : "r"); i++; continue; }
        if (before && before.v && before.ph === "ʊ") { out[out.length - 1].ph = "ʊɐ"; i++; continue; }
        push("ɾ"); i++; continue;
      }
      if (c === "s") {
        if (isV(m[i + 1]) && (i === 0 || prevV || /[lnmr]/.test(m[i - 1]))) { push("z"); i++; continue; }
        push("s"); out[out.length - 1].s1 = true; i++; continue;
      }
      var finalDev = last || (!isV(m[i + 1]) && m[i + 1] !== "r" && m[i + 1] !== "l" && m[i + 1] !== c && !(c === "d" && m[i + 1] === "n"));
      var VOICED = { b: ["p", "b"], d: ["t", "d"], g: ["k", "ɡ"] };
      if (VOICED[c]) {
        var dev = finalDev && !opts.voiceEnd;
        push(VOICED[c][dev ? 0 : 1]);
        if (dev) out[out.length - 1].voiced = VOICED[c][1];
        i++; continue;
      }
      if (c === "v") { push(i === 0 || !prevV ? "f" : "v"); i++; continue; }
      if (c === "w") { push("v"); i++; continue; }
      if (c === "z") { push("ts"); i++; continue; }
      if (c === "x") { push("ks"); i++; continue; }
      if (c === "j") { push("j"); i++; continue; }
      if (c === "c") { push(/[eiäy]/.test(m[i + 1] || "") ? "ts" : "k"); i++; continue; }
      if ("lmnpkft".indexOf(c) !== -1) { push(c); i++; continue; }
      i++;          // anything else is silent
    }
    return out;
  }

  // the endings: e → ə, er → ɜ
  function ending(e) {
    var map = { e: "ə", en: "ən", em: "əm", es: "əs", et: "ət", est: "əst", el: "əl", eln: "əln", elt: "əlt",
      er: "ɜ", ern: "ɜn", ert: "ɜt", erst: "ɜst", ere: "ərə", eren: "ərən", erem: "ərəm", erer: "ərɜ", eres: "ərəs",
      n: "n", s: "s", t: "t", st: "st",
      ung: "ʊŋ", ungen: "ʊŋən", heit: "haɪt", heiten: "haɪtən", keit: "kaɪt", keiten: "kaɪtən",
      schaft: "ʃaft", schaften: "ʃaftən", lich: "lɪç", liche: "lɪçə", licher: "lɪçɜ", lichen: "lɪçən",
      lichem: "lɪçəm", liches: "lɪçəs", ig: "ɪç", ige: "ɪɡə", iger: "ɪɡɜ", igen: "ɪɡən", igem: "ɪɡəm",
      iges: "ɪɡəs", igt: "ɪçt", isch: "ɪʃ", ische: "ɪʃə", ischen: "ɪʃən", bar: "bɑːɾ", bare: "bɑːrə",
      baren: "bɑːrən", sam: "zɑːm", same: "zɑːmə", samen: "zɑːmən", los: "loːs", lose: "loːzə", losen: "loːzən", _ie: "ɪə", _ien: "ɪən",
      chen: "çən", lein: "laɪn", nis: "nɪs", nisse: "nɪsə", tum: "tuːm" };
    return map[e] == null ? null : map[e];
  }

  // the sounds of a prefix; "|" marks where its stress goes
  var PRE_PH = {
    be: "b|ə", ge: "ɡ|ə", er: "|ɛɾ", ver: "f|ɛɾ", zer: "ts|ɛɾ", ent: "|ɛnt", emp: "|ɛmp", miss: "m|ɪs",
    zurück: "tsuːr|ʏk", zusammen: "tsuːz|amən", wieder: "v|iːdɜ", voraus: "foːr|aʊs", vorbei: "foːɾb|aɪ",
    heraus: "hɛr|aʊs", herein: "hɛr|aɪn", hinaus: "hɪn|aʊs", hinein: "hɪn|aɪn", herunter: "hɛr|ʊntɜ",
    hinunter: "hɪn|ʊntɜ", hinzu: "hɪnts|uː", weiter: "v|aɪtɜ", durch: "d|ʊɐç", unter: "|ʊntɜ", "über": "|yːbɜ",
    nach: "n|ɑːx", auf: "|aʊf", aus: "|aʊs", ein: "|aɪn", mit: "m|ɪt", vor: "f|oːɾ", weg: "v|ɛk", fest: "f|ɛst",
    frei: "fr|aɪ", los: "l|oːs", fort: "f|ɔɾt", her: "h|eːɾ", hin: "h|ɪn", bei: "b|aɪ", ab: "|ap", an: "|an",
    um: "|ʊm", zu: "ts|uː", un: "|ʊn", ur: "|uːɾ", rück: "r|ʏk", haupt: "h|aʊpt", zwischen: "tsv|ɪʃən"
  };
  // prefixes that may stand before a vowel
  var PRE_BEFORE_V = { be: 1, ge: 1, er: 1, ver: 1, zer: 1, ent: 1, "über": 1, unter: 1, durch: 1, wieder: 1,
    zurück: 1, heraus: 1, hinaus: 1, herein: 1, hinein: 1, herunter: 1, hinunter: 1, vor: 1, aus: 1 };
  // words that only look as if they had a prefix
  var NOT_PRE = /^(ge(ben|bt|bst|be|hen|ht|hst|he|gen|rn|rne|lb|lbe|ld|lde|lder|stern)$|be(ten|tet|te|sser|ste|sten|ster|stes|stem|i(den|de|des|der|dem))$|bei(de|den|des|der|dem)$|er(de|den|ster|ste|sten|stes|stem|st|nte)$)/;
  var PRE_ORDER = Object.keys(PRE_PH).sort(function (a, b) { return b.length - a.length; });
  var WEAK_PRE = { be: 1, ge: 1, er: 1, ver: 1, zer: 1, ent: 1, emp: 1, miss: 1 };
  // native endings must not break a letter group
  var GROUPS = ["ie", "ei", "ai", "au", "eu", "äu", "ch", "ck", "ng", "nk", "ph", "th", "qu", "tz", "sc", "ee", "aa", "oo"];
  function fits(stem, e, round) {
    var a = stem.slice(-1), b = e[0];
    if (GROUPS.indexOf(a + b) !== -1) return false;
    if (/sc$/.test(stem) || (/s$/.test(stem) && /^ch/.test(e))) return false;
    if (isV(b) && !(/[^aeiouäöüy]$/.test(stem))) return false;       // a vowel ending after a consonant only
    if (a === b && !isV(a)) return false;                            // never inside a double letter
    if (/^(t|st)$/.test(e)) return round === 0 && /([bgh]|[aeiouäöü]h|ß)$/.test(stem);
    if (/^(chen|lich|los|bar|sam|heit|keit|schaft|nis|tum|lein)/.test(e) && isV(a)) return false;
    return true;
  }

  // ---------- splitting a word ----------
  function split(w) {
    var pre = [], suf = [], stem = w, g;
    for (var k = 0; k < 2; k++) {
      var found = "";
      for (var q0 = 0; q0 < PRE_ORDER.length; q0++) {
        var p = PRE_ORDER[q0], rest = stem.slice(p.length);
        if (stem.indexOf(p) !== 0 || rest.length < 3 || !/[aeiouäöüy]/.test(rest)) continue;
        if (NOT_PRE.test(stem)) continue;
        if (isV(rest[0]) && !PRE_BEFORE_V[p]) continue;
        if (WEAK_PRE[p] && k > 0 && !WEAK_PRE[pre[pre.length - 1]] === false) continue;
        found = p; break;
      }
      if (!found) break;
      pre.push(found);
      stem = stem.slice(found.length);
      if (WEAK_PRE[found]) break;            // nothing stands after be-, ge-, ver-…
    }
    var ln = /([ln])(ie|ien)$/.exec(stem);
    if (ln && stem.length > 4) return { pre: pre, stem: stem.slice(0, -ln[2].length), suf: [ln[2] === "ie" ? "_ie" : "_ien"], strong: "" };
    for (var i = 0; i < STR_SUF.length; i++) {
      var s = STR_SUF[i];
      if (stem.length > s.length + 2 && stem.slice(-s.length) === s && /[aeiouäöüy]/.test(stem.slice(0, -s.length)) &&
          GROUPS.indexOf(stem.slice(-s.length - 1, -s.length) + s[0]) === -1) {
        return { pre: pre, stem: stem.slice(0, -s.length), suf: [s], strong: s };
      }
    }
    for (var j = 0; j < 2; j++) {
      g = "";
      for (var q = 0; q < SUF.length; q++) {
        var e = SUF[q];
        if (stem.length > e.length + 1 && stem.slice(-e.length) === e && /[aeiouäöüy]/.test(stem.slice(0, -e.length)) &&
            fits(stem.slice(0, -e.length), e, j)) { g = e; break; }
      }
      if (!g) break;
      suf.unshift(g);
      stem = stem.slice(0, -g.length);
    }
    return { pre: pre, stem: stem, suf: suf, strong: "" };
  }

  // a phoneme string with "|" (stress here) → segments
  function segsOf(ph, at) {
    var out = [], re = /(aɪ|aʊ|ɔø|ʊɐ|[aeiouyøɛɪɔʊʏœɑəɜ]ː?)|([^aeiouyøɛɪɔʊʏœɑəɜ|]+)|(\|)/g, m, mark = false;
    while ((m = re.exec(ph))) {
      if (m[3]) { mark = true; continue; }
      if (m[1]) { out.push({ ph: m[1], v: true, stress: mark ? at : "" }); mark = false; }
      else out.push({ ph: m[2], v: false });
    }
    return out;
  }

  function endingSegs(e) {
    var ph = ending(e);
    if (ph == null) return sounds(e, { weak: true });
    return segsOf(ph, "");
  }

  function word(w) {
    var low = String(w || "").toLowerCase().normalize("NFC").replace(/[^a-zäöüß]/g, "");
    if (!low) return "";
    if (LEX[low] != null) return LEX[low];
    if ((/^[A-ZÄÖÜ]{2,5}$/.test(w) || low.length <= 5) && !/[aeiouäöüy]/.test(low)) return spell(low);
    var sp = split(low);
    var segs = [], primary = -1, compound = -1;
    function add(list, role) {
      list.forEach(function (s) { s.role = role; segs.push(s); });
    }
    // prefixes
    var strongPre = false;
    sp.pre.forEach(function (p) {
      var weak = !!WEAK_PRE[p];
      var list = segsOf(PRE_PH[p], weak ? "" : (strongPre ? "" : "P"));
      if (!weak) strongPre = true;
      add(list, weak ? "weak" : "pre");
    });
    // the stem; a vowel ending is glued on so the syllable rules see it
    var glue = sp.suf.length && !sp.strong && isV(sp.suf[0][0]);
    var stemSegs;
    if (sp.strong) {
      // a foreign word: the syllables before the stress; a is said short
      var nextL = sp.strong[0], added = sounds(sp.stem + nextL, { closedLong: true });
      stemSegs = sounds(sp.stem + nextL, { closedLong: true }).slice(0, added.length - 1);
      stemSegs.forEach(function (x) { if (x.v && x.ph === "ɑː") x.ph = "a"; if (x.v && x.e && !/ː/.test(x.ph)) x.ph = "ɛ"; });
    } else {
      stemSegs = sounds(sp.stem + (glue ? "e" : ""), { closedLong: true });
      if (glue) stemSegs.pop();
    }
    var stemStart = segs.length;
    add(stemSegs, "stem");
    var stemEnd = segs.length;
    if (sp.strong) add(segsOf(foreignPh(sp.strong), "P"), "strong");
    else sp.suf.forEach(function (e, k) {
      var nx = sp.suf[k + 1];
      if (nx && isV(nx[0]) && (e === "er" || e === "el")) add(segsOf(e === "er" ? "ər" : "əl", ""), "suf");
      else add(endingSegs(e), "suf");
    });
    // across the joins: s between voiced sounds is z, b d g before a vowel stay voiced
    for (var y = 1; y < segs.length - 1; y++) {
      var nv = segs[y + 1].v;
      if (segs[y].s1 && nv && (segs[y - 1].v || /^[lnmrɾ]$/.test(segs[y - 1].ph))) segs[y].ph = "z";
      if (segs[y].voiced && nv) segs[y].ph = segs[y].voiced;
    }

    // an unstressed e after the stem's first vowel is a schwa (er → ɜ)
    if (!sp.strong) {
      var seen = 0;
      for (var z = stemStart; z < stemEnd; z++) {
        if (!segs[z].v) continue;
        seen++;
        if (seen > 1 && segs[z].e) {
          var nx = segs[z + 1], nx2 = segs[z + 2];
          if (nx && (nx.ph === "ɾ" || nx.ph === "r") && (!nx2 || (!nx2.v && z + 2 >= stemEnd))) { segs[z].ph = "ɜ"; segs.splice(z + 1, 1); stemEnd--; }
          else if (nx && nx.ph === "r" && nx2 && nx2.v) segs[z].ph = "ə";
          else segs[z].ph = "ə";
        }
      }
    }
    // the vowels
    var vix = [];
    segs.forEach(function (s, i) { if (s.v) vix.push(i); });
    var full = function (i) { return segs[i].ph !== "ə" && segs[i].ph !== "ɜ"; };
    // primary: a stressed ending, else a stressed prefix, else the stem's first full vowel
    var marked = vix.filter(function (i) { return segs[i].stress === "P"; });
    if (sp.strong) primary = marked[marked.length - 1];
    else if (marked.length) {
      primary = marked[0];
      // the stem of a compound keeps a light stress, unless be-/ge- stands before it
      if (!sp.pre.some(function (p) { return WEAK_PRE[p]; })) {
        for (var a = stemStart; a < stemEnd; a++) if (segs[a].v && full(a)) { compound = a; break; }
      }
    } else if (/^_ie/.test(sp.suf[0] || "")) {
      // Familie, Linie: the vowel before -ie takes the stress
      for (var b0 = stemEnd - 1; b0 >= stemStart; b0--) if (segs[b0].v) { primary = b0; break; }
    } else {
      for (var b = stemStart; b < stemEnd; b++) if (segs[b].v && full(b)) { primary = b; break; }
      if (primary < 0) for (var c = 0; c < vix.length; c++) if (full(vix[c])) { primary = vix[c]; break; }
      if (primary < 0 && vix.length) primary = vix[0];
    }
    // unstressed long vowels in native parts are said short
    var pos = vix.indexOf(primary);
    var second = -1;
    if (pos >= 2 && full(vix[0])) second = vix[0];
    else {
      // the last full vowel two or more syllables after the primary
      for (var d = vix.length - 1; d > pos; d--) {
        var vi = vix[d];
        if (!full(vi)) continue;
        if (d - pos >= 2) second = vi;
        break;
      }
      // else the stem of a compound
      if (second < 0 && compound >= 0 && compound !== primary) second = compound;
    }
    // a long a before the stress is said short (Familie, Datei)
    for (var f = stemStart; f < Math.min(primary, stemEnd); f++) if (segs[f].ph === "ɑː" && f !== second) segs[f].ph = "a";
    return segs.map(function (s, i) {
      if (i === primary) return P + s.ph;
      if (i === second) return S + s.ph;
      return s.ph;
    }).join("");
  }

  function foreignPh(s) {
    var map = {
      tion: "tsj|oːn", tionen: "tsj|oːnən", ation: "atsj|oːn", ition: "ɪtsj|oːn", ution: "ʊtsj|oːn",
      sion: "zj|oːn", sionen: "zj|oːnən", "ität": "iːt|ɛːt", "itäten": "iːt|ɛːtən", "tät": "t|ɛːt", "täten": "t|ɛːtən",
      ieren: "|iːrən", iert: "|iːɾt", ierst: "|iːɾst", ierung: "|iːrʊŋ", ierungen: "|iːrʊŋən", iere: "|iːrə",
      ierte: "|iːɾtə", ierten: "|iːɾtən", erie: "əɾ|iː", ie: "|iː", ien: "|iːən", ei: "|aɪ", eien: "|aɪən",
      ur: "|uːɾ", uren: "|uːrən", ant: "|ant", anten: "|antən", ent: "|ɛnt", enten: "|ɛntən", enz: "|ɛnts",
      enzen: "|ɛntsən", anz: "|ants", ell: "|ɛl", elle: "|ɛlə", ellen: "|ɛlən", iv: "|iːf", ive: "|iːvə",
      iven: "|iːvən", "ös": "|øːs", "öse": "|øːzə", "är": "|ɛːɾ", "äre": "|ɛːrə", eur: "|øːɾ", eure: "|øːrə",
      ist: "|ɪst", isten: "|ɪstən", ismus: "|ɪsmʊs", al: "|ɑːl", ale: "|ɑːlə", alen: "|ɑːlən", at: "|ɑːt",
      ate: "|ɑːtə", aten: "|ɑːtən", ik: "|iːk", iken: "|iːkən", ine: "|iːnə", inen: "|iːnən", ade: "|ɑːdə",
      age: "|ɑːʒə", ett: "|ɛt", ette: "|ɛtə", on: "|oːn", ons: "|oːns", "ür": "|yːɾ", ment: "m|ɛnt", mente: "m|ɛntə",
      ekt: "|ɛkt", ekte: "|ɛktə", ekten: "|ɛktən", ekts: "|ɛkts"
    };
    return map[s] || s;
  }

  // ---------- letters spelled out ----------
  var LETTER = { a: "ɑː", b: "beː", c: "tseː", d: "deː", e: "eː", f: "ɛf", g: "ɡeː", h: "hɑː", i: "iː", j: "jɔt",
    k: "kɑː", l: "ɛl", m: "ɛm", n: "ɛn", o: "oː", p: "peː", q: "kuː", r: "ɛɾ", s: "ɛs", t: "teː", u: "uː", v: "faʊ",
    w: "veː", x: "ɪks", y: "ʏpsɪlɔn", z: "tsɛt", "ä": "ɛː", "ö": "øː", "ü": "yː", "ß": "ɛstsɛt" };
  function spell(low) {
    var parts = low.split("").map(function (c) { return LETTER[c] || ""; }).filter(Boolean);
    return parts.map(function (p, i) {
      var k = p.search(/[aeiouɑɛɪɔʊʏøy]/);
      var mark = i === parts.length - 1 ? P : S;
      return k < 0 ? p : p.slice(0, k) + mark + p.slice(k);
    }).join("");
  }

  // ---------- numbers ----------
  var ONES = ["null", "eins", "zwei", "drei", "vier", "fünf", "sechs", "sieben", "acht", "neun", "zehn",
    "elf", "zwölf", "dreizehn", "vierzehn", "fünfzehn", "sechzehn", "siebzehn", "achtzehn", "neunzehn"];
  var TENS = ["", "", "zwanzig", "dreißig", "vierzig", "fünfzig", "sechzig", "siebzig", "achtzig", "neunzig"];
  // number words come apart ("vier und dreißig") so each one is said well
  function num(n) {
    if (n < 20) return ONES[n];
    if (n < 100) { var o = n % 10, t = TENS[Math.floor(n / 10)]; return o ? (o === 1 ? "ein" : ONES[o]) + " und " + t : t; }
    if (n < 1000) { var h = Math.floor(n / 100), r = n % 100; return (h === 1 ? "ein" : ONES[h]) + " hundert" + (r ? " " + num(r) : ""); }
    if (n < 1e6) { var th = Math.floor(n / 1000), r2 = n % 1000; return (th === 1 ? "ein" : num(th)) + " tausend" + (r2 ? " " + num(r2) : ""); }
    if (n < 1e9) { var mi = Math.floor(n / 1e6), r3 = n % 1e6; return (mi === 1 ? "eine Million" : num(mi) + " Millionen") + (r3 ? " " + num(r3) : ""); }
    return String(n).split("").map(function (d) { return ONES[+d]; }).join(" ");
  }
  // a number as words: 1.234,56 → "ein tausend zwei hundert vier und dreißig Komma fünf sechs"
  function number(s) {
    if (typeof s === "number") return num(Math.floor(Math.abs(s)));
    var t = String(s).replace(/\.(?=\d{3}(\D|$))/g, "");
    var m = t.split(",");
    var out = num(parseInt(m[0], 10) || 0);
    if (m[1]) out += " Komma " + m[1].split("").map(function (d) { return ONES[+d]; }).join(" ");
    return out;
  }
  // a year: 1999 → "neunzehn hundert neun und neunzig", 2026 → "zwei tausend sechs und zwanzig"
  function year(n) {
    if (n >= 1100 && n < 2000) { var r = n % 100; return num(Math.floor(n / 100)) + " hundert" + (r ? " " + num(r) : ""); }
    return num(n);
  }
  // 1. erste, 3. dritte, 7. siebte, 8. achte, 20. zwanzigste
  function ordinal(n) {
    var SPECIAL = { 1: "erste", 3: "dritte", 7: "siebte", 8: "achte" };
    if (SPECIAL[n]) return SPECIAL[n];
    var w = num(n).split(" ");
    var last = w[w.length - 1];
    w[w.length - 1] = n < 20 ? last + "te" : last + "ste";
    return w.join(" ");
  }
  var MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober",
    "November", "Dezember"];

  // short forms and symbols
  var SHORT = [
    [/\bz\.\s?B\./g, "zum Beispiel"], [/\bd\.\s?h\./g, "das heißt"], [/\bu\.\s?a\./g, "unter anderem"],
    [/\busw\./g, "und so weiter"], [/\bbzw\./g, "beziehungsweise"], [/\bca\./g, "circa"], [/\bggf\./g, "gegebenenfalls"],
    [/\bNr\./g, "Nummer"], [/\bS\.(?=\s*\d)/g, "Seite"], [/\bDr\./g, "Doktor"], [/\bevtl\./g, "eventuell"],
    [/\bvgl\./g, "vergleiche"], [/\binkl\./g, "inklusive"], [/\bMio\./g, "Millionen"], [/\bMrd\./g, "Milliarden"]
  ];
  var SYM = { "€": " Euro", "$": " Dollar", "%": " Prozent", "&": " und ", "+": " plus ", "=": " gleich ", "°": " Grad", "§": "Paragraf " };

  function words(text) {
    var t = String(text || "").normalize("NFC");
    SHORT.forEach(function (r) { t = t.replace(r[0], r[1]); });
    t = t.replace(/\b(\d{1,2}):(\d{2})(\s*Uhr)?\b/g, function (m, h, mi) { return num(+h) + " Uhr" + (+mi ? " " + num(+mi) : ""); });
    // 5.12.2026 → fünfte Dezember zwei tausend sechs und zwanzig
    t = t.replace(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/g, function (m, d, mo, y) {
      return +mo >= 1 && +mo <= 12 && +d >= 1 && +d <= 31 ? ordinal(+d) + " " + MONTHS[+mo - 1] + " " + year(+y) : m;
    });
    // 12,50 € → zwölf Euro fünfzig
    t = t.replace(/(\d+(?:\.\d{3})*),(\d{2})\s?€/g, function (m, a, c) { return number(a) + " Euro" + (+c ? " " + num(+c) : ""); });
    t = t.replace(/\b(\d{1,3})\.(?=\s+[A-Za-zÄÖÜäöü])/g, function (m, d) { return ordinal(+d); });     // 3. Platz → dritte Platz
    t = t.replace(/\b(1[1-9]\d\d)\b(?![.,]\d)/g, function (m, y) { return year(+y); });          // years
    t = t.replace(/[€$%&+=°§]/g, function (c) { return SYM[c]; });
    t = t.replace(/\d+(?:[.,]\d+)*/g, function (m) { return " " + number(m) + " "; });
    return t.replace(/[ \t]+/g, " ").trim();
  }

  // inside a sentence these short words lose their stress
  var IN_SENTENCE = { und: "ʊnt", um: "ʊm", am: "am", ein: "aɪn", im: "ɪm", "in": "ɪn", an: "an", zum: "tsʊm",
    dir: "diːɾ", da: "dɑː", das: "das", uhr: "uːɾ" };

  // ---------- sentences ----------
  function sentences(text) {
    var t = words(text);
    if (!t.trim()) return [];
    var list = t.match(/[^.!?…]+[.!?…]*["»«“”)]*/g) || [];
    var out = [];
    list.forEach(function (raw) {
      var s = raw.trim();
      if (!/[A-Za-zÄÖÜäöüß]/.test(s)) return;
      var ph = s.replace(/[A-Za-zÄÖÜäöüß]+/g, function (w) {
        var low = w.toLowerCase();
        return IN_SENTENCE[low] != null ? IN_SENTENCE[low] : word(w);
      })
        .replace(/[«»"“”„()\[\]]/g, "")
        .replace(/[;:–—]/g, ",")
        .replace(/…/g, ".")
        .replace(/[^\p{L}\p{M}ˈˌː ,.!?]/gu, " ")
        .replace(/\s+/g, " ")
        .replace(/\s+([,.!?])/g, "$1")
        .trim();
      out.push({ text: s, ph: ph });
    });
    return out;
  }

  var api = { word: word, words: words, sentences: sentences, number: number, ordinal: ordinal };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.GermanVoice = api;
})(typeof self !== "undefined" ? self : this);
