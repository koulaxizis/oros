// ============================================================
// orOS translation engine (translate/engine.js, v1.1.0)
// Translation on the device with Mozilla's Firefox Translations
// models and the Bergamot translator (both MPL-2.0). Any app frame
// loads this file (<script src="../translate/engine.js">) and gets
// window.OrosTranslate; Text Tools has the screen for it, Writer uses
// it for machine suggestions (shared engine, Bible "TRANSLATE").
//   - nothing is downloaded until the person asks: then the runtime
//     (vendor/bergamot on this site, ~5 MB, once) and the pair's model
//     (15-30 MB per direction, from our own copy on GitHub Pages,
//     koulaxizis/oros-models) are fetched, unpacked, checked against
//     the SHA-256 written below and kept in IndexedDB "oros-translate"
//     (never synced, never in the service worker's precache)
//   - the text never leaves the device, unless the person turned on
//     "the Assistant's AI where no model fits" (off by default, this
//     device only): then a direction without models goes to the AI
//     service set up in the Assistant (feeds/ai.js, their own key or
//     their own computer), and every result says engine "ai"
//   - languages without a direct model go through English (two models)
// API (every call returns a Promise; errors carry .code):
//   pairs()            → [{ from, to }] the directions this build knows
//   languages()        → ["ar", "bg", …, "el", "en", …] (any model)
//   froms() / tos()    → the languages a model can translate from / into
//   name(code, ui)     → "German" / "Γερμανικά" (Intl.DisplayNames)
//   route(from, to)    → ["el-en"] | ["el-en", "en-de"] | [] (same) | null
//   status(from, to)   → { ok, legs, need: [legs], mb }  (mb = still to download)
//   installed()        → [{ pair, mb }]
//   install(from, to, { progress(f), cancelled() }) → true
//   remove(pair)       → true (the runtime goes with the last pair)
//   detect(text)       → a language code (script, then common words)
//   translate(text, { from, to, progress, cancelled, engine }) → { text, engine, via? }
//   translateMany(segments, { from, to, terms, progress(done, total), cancelled, engine })
//                      → [{ text, engine, tagsOk }] in order
//     engine: "auto" (models, else the AI when it is on), "bergamot", "ai"
//   ai: { on(), set(bool), ready() → Promise<{ name } | null> }
// Inline tags: ⟦1⟧…⟦/1⟧ and ⟦2/⟧ (Writer) are kept: they go to
// Bergamot as HTML and come back; tagsOk says whether every tag came
// back exactly once. Error codes: unsupported, pair, not-installed,
// download, hash, quota, cancelled, engine, ai-off, ai-none, ai.
// The pure helpers are exported for the tests (Node).
// ============================================================
(function (root) {
  "use strict";

  var MIRROR = "https://koulaxizis.github.io/oros-models/translate/";
  var RUNTIME_VER = "bergamot-0.4.9";
  var RUNTIME = {
    glue: { n: "bergamot-translator-worker.js", size: 80474 },
    wasm: { n: "bergamot-translator-worker.wasm", size: 5174294 }
  };
  // Mozilla's released models (Firefox Translations, registry
  // models.json), copied unchanged to MIRROR/<pair>/<v>/. Written by
  // translate/make-models.js from koulaxizis/oros-models
  // translate/index.json; never edit by hand.
  // size = unpacked bytes, gz = download bytes, sha = SHA-256 unpacked.
  // MODELS-BEGIN
  var MODELS = {
    "ar-en": { v: "retrain_base-memory_X9fDxFreTOCslPKzb1CXTg", files: {
      model: { n: "model.aren.intgemm.alphas.bin", size: 31561787, gz: 23224456, sha: "7b7af0282dc5f4d8805b9a298c2fa828967e3f09ca10f1942ebeea0b2cfc12fa" },
      lex: { n: "lex.50.50.aren.s2t.bin", size: 4627200, gz: 2259861, sha: "4b45f14dbea40d368093a13563fc1ca48457ee70c1291c82b206f3baff210081" },
      vocab: { n: "vocab.aren.spm", size: 860035, gz: 416700, sha: "51b4ee3f828d10015464523d0b4f5a6c086b0b2a9bde716a581001cf6c260366" } } },
    "bg-en": { v: "retrain_hr_WvwHu4k6TgmJ2YTvL4Mu2g", files: {
      model: { n: "model.bgen.intgemm.alphas.bin", size: 31561787, gz: 22399269, sha: "78f7e6e1435cc2d4a29cf597f493187fe29ddb9ce9d3766c287e2e6d37052d01" },
      lex: { n: "lex.50.50.bgen.s2t.bin", size: 4355920, gz: 2187053, sha: "e661dfdd88aa9ff9606f237a60c910d97c2e710960199589579f628c5d8aa899" },
      vocab: { n: "vocab.bgen.spm", size: 922482, gz: 434940, sha: "4bafad5fcc0e771ed82233d1e99d69dcb96487b430702f7e688615c8a61f3df4" } } },
    "cs-en": { v: "retrain_hr_EwWhUov8TP6D_oolATvbUA", files: {
      model: { n: "model.csen.intgemm.alphas.bin", size: 31561787, gz: 22830296, sha: "c815273b31074492eaab0ccd78d33d7ac16f94088707ab2492abaedcb9ee0b75" },
      lex: { n: "lex.50.50.csen.s2t.bin", size: 4990588, gz: 2493702, sha: "eba6bd9575251525f1941640ea0b6527a06e72a46421579eafea04d635ee20a8" },
      vocab: { n: "vocab.csen.spm", size: 815154, gz: 412691, sha: "ee4b8ce15c8e1237c5f7a2d04741341beb0a5d5c09820f7ec08f13ee2b212755" } } },
    "de-en": { v: "retrain_hr2_WZOW24i4QJmIib61LeHfwg", files: {
      model: { n: "model.deen.intgemm.alphas.bin", size: 31561787, gz: 22403755, sha: "3e6f7c2c2425d10824797270b382bee718ff34af2cab9308841c82ca46dc6f20" },
      lex: { n: "lex.50.50.deen.s2t.bin", size: 4945796, gz: 2626658, sha: "113b98460468360cca68c042e1cddf49c4e1931cbb975ed04349c9a3bd607010" },
      vocab: { n: "vocab.deen.spm", size: 810073, gz: 413879, sha: "69f730becafa48e3bb2c244eab66456877c08959a02f2bd5519b5a3088b62f9c" } } },
    "el-en": { v: "spring-2024_RJucgx7LRMKB9E4oSSzdtA", files: {
      model: { n: "model.elen.intgemm.alphas.bin", size: 17141051, gz: 12696541, sha: "0a43c3716156061494d995d0c88113e789f8d919e0c88a15bc1ad360e0482a8c" },
      lex: { n: "lex.50.50.elen.s2t.bin", size: 4295860, gz: 1851246, sha: "2c969b069b3d230feddd17db2d74eb658a9b33b960d2d40adbca5496c9784e85" },
      vocab: { n: "vocab.elen.spm", size: 894960, gz: 419174, sha: "e1a1298cc2cf3968f3d7cc3b36bc463a4e1bf154272e8fb2f15142b54edc4349" } } },
    "en-ar": { v: "retrain_base-memory_G3CmhwG_TZext3cys-udHg", files: {
      model: { n: "model.enar.intgemm.alphas.bin", size: 31561787, gz: 22857819, sha: "ae659d7045fc2e5d6ba50583586a5d94ee4358d92c019847e37b57a0e627faa8" },
      lex: { n: "lex.50.50.enar.s2t.bin", size: 3139692, gz: 1639219, sha: "2b7194817c5dd9225ca90c0d908cc92e1d6d1f45625781a5feb037ac568d6a61" },
      vocab: { n: "vocab.enar.spm", size: 863591, gz: 418930, sha: "8d93c54aa5e2044c416ec680b5ff9af0227bd698521666e8b1a1ea1b041fbae8" } } },
    "en-bg": { v: "retrain_hr_eAF9fkYRScmBmvvfdT4XWw", files: {
      model: { n: "model.enbg.intgemm.alphas.bin", size: 31561787, gz: 23432015, sha: "e2b30db98ac6706efc893067a74e51f36f015a8f820fe8a4f0f5052fa6a22f30" },
      lex: { n: "lex.50.50.enbg.s2t.bin", size: 3075948, gz: 1548577, sha: "93d4ca4412db269cc4164cbfa04c08edd0f65690c8264d6215a0522d4a13ec1a" },
      vocab: { n: "vocab.enbg.spm", size: 922482, gz: 434940, sha: "4bafad5fcc0e771ed82233d1e99d69dcb96487b430702f7e688615c8a61f3df4" } } },
    "en-cs": { v: "retrain_hr_F_JF0vqvSjSwn3caQQcicA", files: {
      model: { n: "model.encs.intgemm.alphas.bin", size: 31561787, gz: 23192301, sha: "1d7855f91c3e2b8ef79fbea62707d46ceb8a1ad01834ef6dd500f32a7006cc2c" },
      lex: { n: "lex.50.50.encs.s2t.bin", size: 3572436, gz: 1896925, sha: "699b9b59fe3acbcddf831380024b2e139f2cbe225dce96d59ade2b159318f58b" },
      vocab: { n: "vocab.encs.spm", size: 815154, gz: 412691, sha: "ee4b8ce15c8e1237c5f7a2d04741341beb0a5d5c09820f7ec08f13ee2b212755" } } },
    "en-de": { v: "retrain_hr_fix_names_SCgGhxUPQ2WAECHLRtzrMg", files: {
      model: { n: "model.ende.intgemm.alphas.bin", size: 31561787, gz: 22992073, sha: "8df29d9494d19f47fd5d97c6a73474c6f657e9f81c1a607c431d02befdf3810f" },
      lex: { n: "lex.50.50.ende.s2t.bin", size: 4347672, gz: 2314750, sha: "7ed39f1cffbd68a27ddf05bbfe068de2060f1d7e69f1a20e27ae923551dd7393" },
      vocab: { n: "vocab.ende.spm", size: 810073, gz: 413879, sha: "69f730becafa48e3bb2c244eab66456877c08959a02f2bd5519b5a3088b62f9c" } } },
    "en-el": { v: "spring-2024_Y3ThG3XkTxG4ROUQK2LpVg", files: {
      model: { n: "model.enel.intgemm.alphas.bin", size: 17141051, gz: 12808027, sha: "724b358d399c6b23444de36d76e9e2630c7024c29d9e617323b820a11631535a" },
      lex: { n: "lex.50.50.enel.s2t.bin", size: 2856724, gz: 1352643, sha: "c2acd9241eb8a1e5b13a43efa5723628839d6e3b3dc7b93e2f20990a6ab81e24" },
      vocab: { n: "vocab.enel.spm", size: 896168, gz: 419275, sha: "0ffc5569d7f400f03539c5fc3e28ff35f1d0381eba0ec866c44aef0c26f3ce5e" } } },
    "en-es": { v: "retrain_hr_fix_names_CUAEXUHoQum_cFqh-ZAryw", files: {
      model: { n: "model.enes.intgemm.alphas.bin", size: 31561787, gz: 22698792, sha: "3b1c399511c01c84c36fae5c0524df44096288efdc8236e182b5c97d7ad2244c" },
      lex: { n: "lex.50.50.enes.s2t.bin", size: 4198436, gz: 2265250, sha: "7d51237c0a07027dcd61643cfbbb0f8c48597d19907ef53d2cae9d6bec2cf25c" },
      vocab: { n: "vocab.enes.spm", size: 816054, gz: 409312, sha: "5ae254fa9b15aa182e70fd2a6186b1333c63a29a48043a9224c6aa4fcac058ad" } } },
    "en-fi": { v: "retrain_hr_b45LsGaNQFyDRhHAvBbKrA", files: {
      model: { n: "model.enfi.intgemm.alphas.bin", size: 31561787, gz: 22580027, sha: "88b0caa4cc6980d632801cb2b1950748f1dc43ad2ac83678917ad86c720b5cdd" },
      lex: { n: "lex.50.50.enfi.s2t.bin", size: 3490092, gz: 1875557, sha: "26e95a87f87e4b0fa9a35524cf9fea691204504453877ba4ac81ccc66af1488c" },
      vocab: { n: "vocab.enfi.spm", size: 818770, gz: 414280, sha: "6a866911427f2916609ae89c7f2f04a78de3fdd8aa183039ecba986635d4f246" } } },
    "en-fr": { v: "retrain_hr_NLIxDbE1TBGyOTI-zwZagw", files: {
      model: { n: "model.enfr.intgemm.alphas.bin", size: 31561787, gz: 23045432, sha: "6322e296d4fecfe395a8d5723da4ec37ecbe6d7613bb1dfcf4b28e2a47498b68" },
      lex: { n: "lex.50.50.enfr.s2t.bin", size: 4372936, gz: 2297334, sha: "2585ed98d3af0bc949865aedeb390493d591f56870814376e73e4144c41ed059" },
      vocab: { n: "vocab.enfr.spm", size: 814404, gz: 409706, sha: "783abf3abe075afdf8d85d233994bef2c3a064e935ab1bed946820aff6ac002a" } } },
    "en-hu": { v: "next26_Tzv045N-SASkA8X287pEqg", files: {
      model: { n: "model.enhu.intgemm.alphas.bin", size: 31561787, gz: 22889950, sha: "0c42f56edca74b3f732a74c64553c47d0005b50cf095f43024601985fab5d461" },
      lex: { n: "lex.50.50.enhu.s2t.bin", size: 3419024, gz: 1794658, sha: "b1c9763567bfa24082fee43a9c4cc05b8ceada949fa52f6686b11f70ce481238" },
      vocab: { n: "vocab.enhu.spm", size: 832855, gz: 421527, sha: "8c3038afc15c5a3f7bb3c6fc4c4962907632b6f6d0ce7444974504bef19ef57b" } } },
    "en-it": { v: "retrain_hr_fix_names_GPSr_u8PSmC9fOx1ZDCHoA", files: {
      model: { n: "model.enit.intgemm.alphas.bin", size: 31561787, gz: 23892889, sha: "248f47568788ecc351da7e5e07064d4153b4f71e011364ae2c931ffeec4d1cc2" },
      lex: { n: "lex.50.50.enit.s2t.bin", size: 4133192, gz: 2209348, sha: "8b21914804625b2777dae7fdb636eb78f02a3eb8b7bceaa50f29ac740961da93" },
      vocab: { n: "vocab.enit.spm", size: 812724, gz: 407598, sha: "3ef0211d4ae6db21440892f180f2019fe2bfc110a330ffa9d2eca9665e4f2bc5" } } },
    "en-ja": { v: "llmaat_finetune10M_qe8_f2_ApiGGQIwTKuF9i_k3n9Q2Q", files: {
      model: { n: "model.enja.intgemm.alphas.bin", size: 43849787, gz: 33052218, sha: "59ae659f9bb63e4f81f474fe3c03d3f4499434b5f9e779fab7c12a45f31fd562" },
      lex: { n: "lex.50.50.enja.s2t.bin", size: 4128360, gz: 2341409, sha: "edfb7eb47b98a2689b804ab3614c31b24f1257aa54b1154da3d85e1ae8152d9f" },
      srcvocab: { n: "srcvocab.enja.spm", size: 796275, gz: 404352, sha: "970c98d174fc01e0339fbabbf45af36a4be3f26f819ec1a5ea1189f71e091889" },
      trgvocab: { n: "trgvocab.enja.spm", size: 827144, gz: 431278, sha: "3b3d9f8f3a034d98d0a476f1794fa79c01e4e98a967ceb6777a66ba2d03ec1e1" } } },
    "en-nl": { v: "retrain_hr_fix_names_fR8XhBiBQniIbi4I_ebJ2Q", files: {
      model: { n: "model.ennl.intgemm.alphas.bin", size: 31561787, gz: 23386633, sha: "7e8402da61972dc2fdcf7147c7f1e12f7916a6d9349514ee7a731288357575a9" },
      lex: { n: "lex.50.50.ennl.s2t.bin", size: 4030624, gz: 2155034, sha: "bb4922718f8ca6d746ad090c0a88110a664dc050ee3f311bce33698b4e1679e9" },
      vocab: { n: "vocab.ennl.spm", size: 807708, gz: 410222, sha: "c09588ca5662b230ed65bd39a07f58d9f7dd21c3a19e4aeb1bff39bf3b297c56" } } },
    "en-pl": { v: "retrain_hr_fix_names_YmTlfuUsSKCbUp75UXaUuw", files: {
      model: { n: "model.enpl.intgemm.alphas.bin", size: 31561787, gz: 22577447, sha: "b0b59716bcc8f46b8dc6ab5c32a2732acaad42a5a6d9ae9b472526a1bb0d71d4" },
      lex: { n: "lex.50.50.enpl.s2t.bin", size: 3540052, gz: 1874327, sha: "d7d7b364673f633763c9f8f2e8ee9c7a184e92f4086e8b84abe870a2a8dbe5d5" },
      vocab: { n: "vocab.enpl.spm", size: 821612, gz: 413194, sha: "2000f182efa8ce5f69bc3f9e574666b5bc2c0af684eedd32f69d15aa9021ea85" } } },
    "en-pt": { v: "retrain_hr_fix_names_Vnb0RUXTTd67hR-oLHM3eg", files: {
      model: { n: "model.enpt.intgemm.alphas.bin", size: 31561787, gz: 23340019, sha: "07892fd2544ee79dcb643615d8f2debb9793fae16842e87c328e27a3dd26a770" },
      lex: { n: "lex.50.50.enpt.s2t.bin", size: 3970340, gz: 2117608, sha: "ccb4c31c9e1899d77a200e71a86958e6ef6c8649627d0bbf3f873b57d9f236bd" },
      vocab: { n: "vocab.enpt.spm", size: 816726, gz: 408686, sha: "d9f46182823d5bbc84201252b2dfcac28f63e561f0ec827ed858f241864c9def" } } },
    "en-ro": { v: "spring-2024_Ov3G4D_DRJa-4qTlILkPhg", files: {
      model: { n: "model.enro.intgemm.alphas.bin", size: 17141051, gz: 12207487, sha: "aa98c415e5beb1c5ee2f7d2508a3bbba949be223d7d9e5e1788ad0ae8598dda5" },
      lex: { n: "lex.50.50.enro.s2t.bin", size: 3739880, gz: 1846074, sha: "508bce64a8bc906a99043ad2f4855b4662e06f8827c1c6a75ab83181b4f17f81" },
      vocab: { n: "vocab.enro.spm", size: 801522, gz: 397137, sha: "d89eedf6cbbcb30d7ed4b0b092189196ac2b010ec0c3ede33a6676b17ea1c95e" } } },
    "en-sq": { v: "h1-2025_HIreYm8_RDymI1qFdn0V5Q", files: {
      model: { n: "model.ensq.intgemm.alphas.bin", size: 17141051, gz: 13366206, sha: "8a90d17ab2798509e639e544caa1d577f7cf87c31b9ab7e53890c8d1d59b6eee" },
      lex: { n: "lex.50.50.ensq.s2t.bin", size: 3303648, gz: 1599959, sha: "c901d1f5910315e0791720fa6f1275d79565e59d85013cf66b2f98cd9ba58ce1" },
      vocab: { n: "vocab.ensq.spm", size: 820048, gz: 410650, sha: "f27814dffca6102255ed7a338f2a83c16905a07e09444016187c768aaf9ac7b6" } } },
    "en-sv": { v: "spring-2024_bQQme71PS4eZRDl3NM-kgA", files: {
      model: { n: "model.ensv.intgemm.alphas.bin", size: 17141051, gz: 12775086, sha: "65ea0db8e658435846f297384face62dbf1804cfc92de8388b0e368e6ecc25a7" },
      lex: { n: "lex.50.50.ensv.s2t.bin", size: 3948180, gz: 1921270, sha: "5761c39887a0e0cd3dd38d22cadc31cecd2a43b0514c4bba96b426736e7fd72d" },
      vocab: { n: "vocab.ensv.spm", size: 793868, gz: 398384, sha: "ff7e366ff4228107e58d76ca348e7dea2eb325452363d68e0047e97fb483e40e" } } },
    "en-tr": { v: "spring-2024_LiFGeNrEQpKdNlziG2qP_A", files: {
      model: { n: "model.entr.intgemm.alphas.bin", size: 17141051, gz: 13159314, sha: "ea3cd4ee09de190df265c78d84260e277a9a8a3ddff05eb55d72afe7fc0fdbf4" },
      lex: { n: "lex.50.50.entr.s2t.bin", size: 3261300, gz: 1546258, sha: "3aba0be842bd4c192659c781e6fdce8eb9b2b1fff29a40d22f75da369d59f46f" },
      vocab: { n: "vocab.entr.spm", size: 798793, gz: 395473, sha: "a220363d60391f7ce3df8ec9785424dbc00c24d5786d1a4308cf8ca3ed3385c2" } } },
    "en-uk": { v: "docmt-vocab_a2OVwdI-Sg-SBZ_0Joqb0w", files: {
      model: { n: "model.enuk.intgemm.alphas.bin", size: 31561787, gz: 22864374, sha: "ed8bb4a811e1c45a259e91052080d25e5c8b4e2df0e59cb1521c04a57855ef97" },
      lex: { n: "lex.50.50.enuk.s2t.bin", size: 3054364, gz: 1564122, sha: "dbfd4f8dc95da9c575164f7fc95ef00a2fb5f7d9f51b656559f99eeebdb57c87" },
      vocab: { n: "vocab.enuk.spm", size: 922077, gz: 436850, sha: "4dd6a91feff71e745395dcc0d52f885848ca0d843d5f70628ca51b3be1b70b45" } } },
    "en-zh": { v: "llmaat_finetune10M_qe8_f2_ByQcSxGXQRqGi-UTxYE43g", files: {
      model: { n: "model.enzh.intgemm.alphas.bin", size: 43849787, gz: 33375922, sha: "4e5accc141373565ddc8fa1565bceaa8d0c3482a82cab8131c719ebcc6c2157c" },
      lex: { n: "lex.50.50.enzh.s2t.bin", size: 4485184, gz: 2536039, sha: "8575d8daa10e2dbff316dcdf8e1ce475357bcc2c92bdc63b736a2d5add22f681" },
      srcvocab: { n: "srcvocab.enzh.spm", size: 806952, gz: 407784, sha: "bd9b65504acc6d9726dd281f7defc2adb7c2c22d0688fe2f84697de25197c8c5" },
      trgvocab: { n: "trgvocab.enzh.spm", size: 772004, gz: 425748, sha: "aded6993c36e440284d11cec3f6b8aef9c0e43188a772d80be342a713adf223d" } } },
    "es-en": { v: "retrain_hr_HbNjJ60BTwmVTbhfFxuduA", files: {
      model: { n: "model.esen.intgemm.alphas.bin", size: 31561787, gz: 23288494, sha: "4aed7734152ae0045d1a69ae49c86cfda18f53c61f90e95e1d1de1c7c7c3b033" },
      lex: { n: "lex.50.50.esen.s2t.bin", size: 4636248, gz: 2543246, sha: "e2610211d3b9577d012638fe7e7e74ed7b4b708ce96b9e792e67c282a6492daa" },
      vocab: { n: "vocab.esen.spm", size: 816054, gz: 409312, sha: "5ae254fa9b15aa182e70fd2a6186b1333c63a29a48043a9224c6aa4fcac058ad" } } },
    "fi-en": { v: "retrain_hr_C7-zSzS7Tm6zkOfVP7k0Gw", files: {
      model: { n: "model.fien.intgemm.alphas.bin", size: 31561787, gz: 22935246, sha: "e3887341f18bcc7787d9b59eb1229b56eefce18d49b7ebf1e62c55d65a377321" },
      lex: { n: "lex.50.50.fien.s2t.bin", size: 5195132, gz: 2580517, sha: "8bad431e07b062ba47f363b76e4656cc743fd608316d8a4830a4315e44ac9abb" },
      vocab: { n: "vocab.fien.spm", size: 818770, gz: 414280, sha: "6a866911427f2916609ae89c7f2f04a78de3fdd8aa183039ecba986635d4f246" } } },
    "fr-en": { v: "retrain_hr_EFgIftH_RrCyzl5gjemVNg", files: {
      model: { n: "model.fren.intgemm.alphas.bin", size: 31561787, gz: 23175075, sha: "15f997bc0d13808b0b0fbd0786e684a3c8a52adcd8071844b76123fdacbf2b90" },
      lex: { n: "lex.50.50.fren.s2t.bin", size: 4824120, gz: 2649934, sha: "87c6752ea908f5f0347c10ac0cf7d80d9c2f4f20c81c90168f3e8230b56d4440" },
      vocab: { n: "vocab.fren.spm", size: 814404, gz: 409706, sha: "783abf3abe075afdf8d85d233994bef2c3a064e935ab1bed946820aff6ac002a" } } },
    "hu-en": { v: "andre_xxxxxxxxRxSxxxxxxxxxxA", files: {
      model: { n: "model.huen.intgemm.alphas.bin", size: 17140899, gz: 13181613, sha: "518356dbb0c071739318601963a87580fb41732652f52bd3635246330c186d9e" },
      lex: { n: "lex.50.50.huen.s2t.bin", size: 5162428, gz: 2778202, sha: "fff56b2501258ec4c46a8fc715caee7aeb15d853f859cdfacd3ef9903ed2fff1" },
      vocab: { n: "vocab.huen.spm", size: 820746, gz: 419908, sha: "0db772702235b02d1f29abafb7a49ed77e54c60245b3a46e90716e74263aedd6" } } },
    "it-en": { v: "retrain_hr_d1nPDwVeSD6t-HdtWA4xNg", files: {
      model: { n: "model.iten.intgemm.alphas.bin", size: 31561787, gz: 23301774, sha: "21b70978ce2f3b4da7a06b5de86a09abe3acd30b9eee1b2ebb3582b9bad790bf" },
      lex: { n: "lex.50.50.iten.s2t.bin", size: 4713616, gz: 2532929, sha: "0700d6d70b30490e68ff9deca0b45b80310745b491855bde3a13e1692d0cbce1" },
      vocab: { n: "vocab.iten.spm", size: 812724, gz: 407598, sha: "3ef0211d4ae6db21440892f180f2019fe2bfc110a330ffa9d2eca9665e4f2bc5" } } },
    "nl-en": { v: "retrain_hr_JbTCb42HREGvK8d6aOCjFQ", files: {
      model: { n: "model.nlen.intgemm.alphas.bin", size: 31561787, gz: 22647743, sha: "ff987741ff15a5d94fff16cbef28f2b0a85a6e9547d982fad60ac09d16d11270" },
      lex: { n: "lex.50.50.nlen.s2t.bin", size: 4862412, gz: 2616098, sha: "811ac8f9dcbd12706e2d73a7057a7bbe6b9f0607d15170ffe9439977e8229b41" },
      vocab: { n: "vocab.nlen.spm", size: 807708, gz: 410222, sha: "c09588ca5662b230ed65bd39a07f58d9f7dd21c3a19e4aeb1bff39bf3b297c56" } } },
    "pl-en": { v: "retrain_hr_HLLa6ZwsSomB0kyBr7Iz6w", files: {
      model: { n: "model.plen.intgemm.alphas.bin", size: 31561787, gz: 22630393, sha: "06dbab3baa3bbceab746bc6a3bba807878f38536382c03acddf59d3edf3b5d94" },
      lex: { n: "lex.50.50.plen.s2t.bin", size: 4964208, gz: 2489764, sha: "b295dfefa7022a62e105276e8c39fdfd67bffe588f4fd78583edd4e04ee0cb3b" },
      vocab: { n: "vocab.plen.spm", size: 821612, gz: 413194, sha: "2000f182efa8ce5f69bc3f9e574666b5bc2c0af684eedd32f69d15aa9021ea85" } } },
    "pt-en": { v: "retrain_hr_drxrs5bGSsOWvfK9lyZISw", files: {
      model: { n: "model.pten.intgemm.alphas.bin", size: 31561787, gz: 22700409, sha: "7b854f1ec5a485dd33efd7c1bc01dd7d5a57f566957c5e47722af333f0ce9157" },
      lex: { n: "lex.50.50.pten.s2t.bin", size: 4634492, gz: 2487847, sha: "2685d8b6530be92a4db4cc61f15a097eb114552be15cb6c1699e9d2d99d24470" },
      vocab: { n: "vocab.pten.spm", size: 816726, gz: 408686, sha: "d9f46182823d5bbc84201252b2dfcac28f63e561f0ec827ed858f241864c9def" } } },
    "ro-en": { v: "spring-2024_RwH0W_MDRK2BmZA6VzAmBg", files: {
      model: { n: "model.roen.intgemm.alphas.bin", size: 17141051, gz: 12722200, sha: "e7542557fc6dbafacddae7b48e67fcdb07bd67b3fb55a76139edf366eca5dbdb" },
      lex: { n: "lex.50.50.roen.s2t.bin", size: 4691708, gz: 2159556, sha: "d242745eadff6f345784fccf1d58046061501b28c8190ba5912a9da5f056cd2f" },
      vocab: { n: "vocab.roen.spm", size: 800832, gz: 396717, sha: "2a690fbcd1b79bc9b99c43d582252720e0900245c82ecc813c8eb05cf063fd0c" } } },
    "ru-en": { v: "spring-2024_QrcdYgbwS7e7xbhtOSdoNQ", files: {
      model: { n: "model.ruen.intgemm.alphas.bin", size: 17141051, gz: 12613599, sha: "b1d85c13cfbb05e1d326dd6f0fb5ef270a2011b547450260f96567a93f446c94" },
      lex: { n: "lex.50.50.ruen.s2t.bin", size: 4483844, gz: 1962008, sha: "f654693577505fd38b1f3d220cdd4ffffbb45afb900a60cf751f0724eadc74e0" },
      vocab: { n: "vocab.ruen.spm", size: 905257, gz: 419860, sha: "93bdc941b16e523695c319f74778bca9fd8b75a25ad75020cdc98aef74cdc0fc" } } },
    "sq-en": { v: "h1-2025_I8xy7KMeQoe3mMEV3umzfQ", files: {
      model: { n: "model.sqen.intgemm.alphas.bin", size: 17141051, gz: 12593638, sha: "4b0ce319e7c8f7e1836ce18cb6522c83268e8cff54f2a7f5dcef270250a44475" },
      lex: { n: "lex.50.50.sqen.s2t.bin", size: 4256516, gz: 2165940, sha: "b2f51df0bc14b9f89a29d39652a80167ef413eb1579957ecea825cb0a7575c60" },
      vocab: { n: "vocab.sqen.spm", size: 820200, gz: 410423, sha: "6b7ce057b54ed983eb47087254ea8673e20a857739fc5b57874c80c3301bb91d" } } },
    "sv-en": { v: "spring-2024_ObaRXwXeSW6HA_-J5_dE-g", files: {
      model: { n: "model.sven.intgemm.alphas.bin", size: 17141051, gz: 12847259, sha: "92d79e2725718b84aed486473bdfcbe6bba3e7094922d4bead8a121cfa346372" },
      lex: { n: "lex.50.50.sven.s2t.bin", size: 4645680, gz: 2165215, sha: "1c4640765e806d905cdc4f51158f6f869c78709b9e8a43070877965fa13c160e" },
      vocab: { n: "vocab.sven.spm", size: 793049, gz: 397625, sha: "93427195fac4125722ed778707478ef78cb77b3fdf1ed5b93bee9fd36e30a8ec" } } },
    "tr-en": { v: "statmt_xxxxxxxxRxSxxxxxxxxxxA", files: {
      model: { n: "model.tren.intgemm.alphas.bin", size: 17140836, gz: 12362908, sha: "bd18594ac5a7f1d9997e7ea5bd80272082219cf8b1ce604766e4f207eb86abbf" },
      lex: { n: "lex.50.50.tren.s2t.bin", size: 4662492, gz: 2470683, sha: "d3374ab5267a73ee1aa1d926a298bd349426835f40856991ee959bc5cd4f9fce" },
      vocab: { n: "vocab.tren.spm", size: 811353, gz: 409060, sha: "ed328e589a3ccd70fd3ce7773fc3c01d8b7b18c687464cacf17fd40a8c0daadd" } } },
    "uk-en": { v: "spring-2024_WEPBsc-zQWSDn34b5KFscw", files: {
      model: { n: "model.uken.intgemm.alphas.bin", size: 17141051, gz: 12677432, sha: "2e7b8bc9d2569d8b4ae244e964cdc343a0aa3735cc83ecb664be84a37cb45f48" },
      lex: { n: "lex.50.50.uken.s2t.bin", size: 3914120, gz: 1790588, sha: "32b5e0df493671a223cb5cb32430181cbb7fe6b5562c91dbc3d35410d37e5ff6" },
      vocab: { n: "vocab.uken.spm", size: 886410, gz: 415266, sha: "8b51480dfc4ca2d7a08d2bfdaa9e57353ca97e6cf3d5f9aba4c0179d3665bfc0" } } }
  };
  // MODELS-END
  var PIVOT = "en";
  var AI_SEGS = 30, AI_CHARS = 4000, AI_TERMS = 50;   // one AI call: segments, characters; terms in the prompt
  var CHUNK = 16;                  // segments per worker call (progress, cancel)
  var IDLE_MS = 120000;            // the worker (and its memory) goes after this
  var MB = 1024 * 1024;

  // ---------- Pure helpers ----------
  function err(code, msg) { var e = new Error(msg || code); e.code = code; return e; }

  function side(i) {
    var seen = {}, out = [];
    Object.keys(MODELS).forEach(function (p) {
      p.split("-").forEach(function (l, j) { if ((i < 0 || i === j) && !seen[l]) { seen[l] = 1; out.push(l); } });
    });
    return out.sort();
  }
  function languages() { return side(-1); }
  // A language is a source when a model starts from it, a target when
  // one ends in it (Russian only into English, Japanese only from it).
  function froms() { return side(0); }
  function tos() { return side(1); }
  var NAMES = {};
  function name(code, ui) {
    var k = (ui || "en") + ":" + code;
    if (NAMES[k]) return NAMES[k];
    var n = code;
    try {
      if (typeof Intl === "object" && Intl.DisplayNames) {
        n = new Intl.DisplayNames([ui || "en"], { type: "language" }).of(code.replace("_", "-")) || code;
      }
    } catch (e) { n = code; }
    n = n.charAt(0).toLocaleUpperCase(ui || "en") + n.slice(1);
    NAMES[k] = n;
    return n;
  }
  function pairs() {
    var langs = languages(), out = [];
    langs.forEach(function (a) {
      langs.forEach(function (b) { if (a !== b && route(a, b)) out.push({ from: a, to: b }); });
    });
    return out;
  }
  // The models a direction needs, in order; [] for the same language.
  function route(from, to) {
    if (from === to) return [];
    if (MODELS[from + "-" + to]) return [from + "-" + to];
    if (from !== PIVOT && to !== PIVOT && MODELS[from + "-" + PIVOT] && MODELS[PIVOT + "-" + to]) {
      return [from + "-" + PIVOT, PIVOT + "-" + to];
    }
    return null;
  }
  function pairBytes(pair, key) {
    var f = MODELS[pair].files;
    return Object.keys(f).reduce(function (s, k) { return s + f[k][key || "gz"]; }, 0);
  }
  function runtimeBytes() { return RUNTIME.glue.size + RUNTIME.wasm.size; }

  // The language of a text: the script first (a script with at least
  // 30% of the letters), then, for the Latin script, the most common
  // words and letters of each language. Unknown or empty → "en".
  var SCRIPTS = [
    ["el", /[Ͱ-Ͽἀ-῿]/g],
    ["cyr", /[Ѐ-ӿ]/g],
    ["ar", /[؀-ۿݐ-ݿ]/g],
    ["kana", /[぀-ヿ]/g],
    ["han", /[一-鿿㐀-䶿]/g]
  ];
  var LETTERS = /[A-Za-zÀ-ɏͰ-Ͽἀ-῿Ѐ-ӿ؀-ۿݐ-ݿ぀-ヿ㐀-䶿一-鿿]/g;
  var WORDS = {
    en: "the and of to is in that it for you with on are this was be have not",
    de: "der die und das ist nicht ich ein eine zu mit den sie es auf auch sich",
    fr: "le la les et est des une un que pas pour dans je du qui sur ce avec",
    es: "el los las y que es en una por con para del se lo como pero muy",
    it: "il che di una per non sono gli della con del le ma come anche questo",
    pt: "os que de um uma não para com do da em se mais como mas muito",
    nl: "het een en is van niet dat ik op te zijn met voor maar ook die",
    tr: "ve bir bu da için ile çok ne ben mi değil gibi var daha olarak",
    ro: "și în este un nu că cu pe la să ce sunt mai din care pentru",
    pl: "i w się nie na jest to że z do jak co ale tak już od",
    cs: "a je se v na to že s z do jsem jak ale není jsou by",
    sv: "och att det är en som på för med jag inte av till har den",
    hu: "a az és hogy nem is egy van de meg ez már csak volt mint ilyen",
    fi: "ja on ei se että hän oli mutta kun tai ovat myös ole kuin",
    sq: "dhe është një në të që me për nga nuk si por janë më"
  };
  var MARKS = {
    de: /[ßäöü]/g, fr: /[çœèêàùâîô]/g, es: /[ñ¿¡]/g, pt: /[ãõ]/g, tr: /[ğış]/g,
    ro: /[șțăâî]/g, pl: /[ąęłńśźż]/g, cs: /[ěřůčšž]/g, hu: /[őű]/g, sv: /[å]/g, fi: /[äö]/g, sq: /[ë]/g
  };
  var WORD_SET = null;
  function wordSet() {
    if (WORD_SET) return WORD_SET;
    WORD_SET = {};
    Object.keys(WORDS).forEach(function (l) {
      WORDS[l].split(" ").forEach(function (w) { (WORD_SET[w] = WORD_SET[w] || []).push(l); });
    });
    return WORD_SET;
  }
  function count(s, re) { re.lastIndex = 0; return (s.match(re) || []).length; }
  function detect(text) {
    var s = String(text || "").slice(0, 5000), all = count(s, LETTERS);
    if (!all) return PIVOT;
    var n = {};
    SCRIPTS.forEach(function (x) { n[x[0]] = count(s, x[1]); });
    if (n.el / all >= 0.3) return "el";
    if (n.cyr / all >= 0.3) {
      if (/[іїєґІЇЄҐ]/.test(s)) return "uk";
      if (/[ыэёЫЭЁ]/.test(s)) return "ru";
      return /[ъЪ]/.test(s) ? "bg" : "ru";
    }
    if (n.ar / all >= 0.3) return "ar";
    if (n.kana && (n.kana + n.han) / all >= 0.3) return "ja";
    if (n.han / all >= 0.3) return "zh";
    var low = s.toLowerCase(), score = {}, ws = wordSet();
    low.split(/[^a-zÀ-ɏ]+/).forEach(function (w) {
      (ws[w] || []).forEach(function (l) { score[l] = (score[l] || 0) + 1; });
    });
    Object.keys(MARKS).forEach(function (l) { score[l] = (score[l] || 0) + Math.min(10, count(low, MARKS[l])); });
    var best = PIVOT, top = score[PIVOT] || 0;
    Object.keys(score).sort().forEach(function (l) { if (score[l] > top) { best = l; top = score[l]; } });
    return best;
  }

  // Lines with their breaks: [{ text, br }]; joining them gives the input back.
  function splitLines(text) {
    var out = [], re = /\r\n|\n|\r/g, last = 0, m;
    text = String(text || "");
    while ((m = re.exec(text))) { out.push({ text: text.slice(last, m.index), br: m[0] }); last = re.lastIndex; }
    out.push({ text: text.slice(last), br: "" });
    return out;
  }
  // Leading and trailing white space stays where it was; only the core
  // of a line is translated.
  function trimParts(s) {
    var m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
    return { pre: m[1], core: m[2], post: m[3] };
  }

  function escHtml(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  var ENT = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };
  function unescHtml(s) {
    return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, function (all, e) {
      if (e[0] === "#") {
        var n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : all;
      }
      var k = e.toLowerCase();
      return ENT.hasOwnProperty(k) ? ENT[k] : all;
    });
  }
  // ⟦n⟧ ⟦/n⟧ ⟦n/⟧ ↔ <tn> </tn> <vn></vn>
  var TAG_RE = /⟦(\/?)(\d{1,4})(\/?)⟧/g;
  function hasTags(s) { TAG_RE.lastIndex = 0; return TAG_RE.test(s); }
  function tagSig(s) {
    var out = [];
    String(s).replace(TAG_RE, function (all, c, n, v) { out.push((c ? "/" : "") + n + (v ? "/" : "")); return all; });
    return out.sort().join(",");
  }
  function toHtml(s) {
    return escHtml(s).replace(TAG_RE, function (all, c, n, v) {
      if (v) return "<v" + n + "></v" + n + ">";
      return c ? "</t" + n + ">" : "<t" + n + ">";
    });
  }
  function fromHtml(s) {
    s = s.replace(/<v(\d{1,4})\s*\/?>(\s*<\/v\1>)?/g, function (all, n) { return "⟦" + n + "/⟧"; })
         .replace(/<(\/?)t(\d{1,4})>/g, function (all, c, n) { return "⟦" + c + n + "⟧"; })
         .replace(/<\/?[a-z][^>]*>/gi, "");
    return unescHtml(s);
  }
  // What goes to Bergamot for one segment: null = nothing to translate.
  function prepare(seg) {
    var p = trimParts(String(seg == null ? "" : seg));
    if (!/[0-9A-Za-z\u00aa\u00b5\u00ba\u00c0-\u1fff\u3040-\uffef]/.test(p.core)) return { pre: p.pre, core: p.core, post: p.post, skip: true };
    var html = hasTags(p.core);
    return { pre: p.pre, core: p.core, post: p.post, html: html, send: html ? toHtml(p.core) : p.core };
  }
  function finish(prep, out) {
    if (prep.skip) return { text: prep.pre + prep.core + prep.post, tagsOk: true };
    var core = prep.html ? fromHtml(out) : out;
    return { text: prep.pre + core + prep.post, tagsOk: tagSig(core) === tagSig(prep.core) };
  }

  var pure = {
    MODELS: MODELS, RUNTIME: RUNTIME, MIRROR: MIRROR, languages: languages, froms: froms, tos: tos,
    name: name, pairs: pairs, route: route,
    pairBytes: pairBytes, runtimeBytes: runtimeBytes, detect: detect, splitLines: splitLines,
    trimParts: trimParts, toHtml: toHtml, fromHtml: fromHtml, tagSig: tagSig, prepare: prepare,
    finish: finish, unescHtml: unescHtml, aiPrompt: aiPrompt, aiParse: aiParse, aiBatches: aiBatches
  };
  if (typeof module === "object" && module.exports) { module.exports = pure; return; }

  // ---------- Browser: files (IndexedDB) ----------
  var BASE = (function () {
    var src = (document.currentScript && document.currentScript.src) || location.href;
    return new URL("../", src).href;               // the orOS root
  })();
  var DB_NAME = "oros-translate", dbP = null;
  function db() {
    if (!dbP) {
      dbP = new Promise(function (resolve, reject) {
        if (!root.indexedDB) { reject(err("unsupported", "indexedDB")); return; }
        var req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = function () { if (!req.result.objectStoreNames.contains("files")) req.result.createObjectStore("files"); };
        req.onsuccess = function () { var d = req.result; d.onversionchange = function () { d.close(); dbP = null; }; resolve(d); };
        req.onerror = function () { reject(req.error); };
        req.onblocked = function () { reject(new Error("blocked")); };
      });
      dbP.catch(function () { dbP = null; });
    }
    return dbP;
  }
  function tx(mode, fn) {
    return db().then(function (d) {
      return new Promise(function (resolve, reject) {
        var t = d.transaction("files", mode), res, r = fn(t.objectStore("files"));
        if (r) r.onsuccess = function () { res = r.result; };
        t.oncomplete = function () { resolve(res); };
        t.onerror = t.onabort = function () {
          var e = t.error || new Error("idb");
          reject(e && e.name === "QuotaExceededError" ? err("quota") : e);
        };
      });
    });
  }
  function keyOf(pair, k) { return pair + ":" + k; }
  function verOf(pair) { return pair === "runtime" ? RUNTIME_VER : MODELS[pair].v; }
  function partsOf(pair) { return Object.keys(pair === "runtime" ? RUNTIME : MODELS[pair].files); }
  function stored(pair, k) {
    return tx("readonly", function (s) { return s.get(keyOf(pair, k)); }).then(function (rec) {
      return rec && rec.v === verOf(pair) && rec.blob instanceof Blob ? rec.blob : null;
    }, function () { return null; });
  }
  function have(pair) {
    return Promise.all(partsOf(pair).map(function (k) { return stored(pair, k); }))
      .then(function (l) { return l.every(Boolean); });
  }
  function supported() {
    return !!(root.WebAssembly && root.Worker && root.indexedDB && root.DecompressionStream &&
              root.crypto && root.crypto.subtle && root.TextDecoder);
  }

  function fetchBlob(url, onBytes, cancelled) {
    var ctl = root.AbortController ? new AbortController() : null;
    var timer = setInterval(function () { if (cancelled && cancelled() && ctl) ctl.abort(); }, 300);
    return fetch(url, { cache: "no-cache", credentials: "omit", signal: ctl ? ctl.signal : undefined }).then(function (res) {
      if (!res.ok) throw err("download", "http " + res.status);
      if (!res.body || !res.body.getReader) return res.blob().then(function (b) { onBytes(b.size); return b; });
      var reader = res.body.getReader(), parts = [];
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) return new Blob(parts);
          parts.push(r.value); onBytes(r.value.byteLength);
          return pump();
        });
      }
      return pump();
    }).then(function (b) { clearInterval(timer); return b; }, function (e) {
      clearInterval(timer);
      if (cancelled && cancelled()) throw err("cancelled");
      throw e && e.code ? e : err("download", String(e && e.message || e));
    });
  }
  // A host that already undid the gzip (Content-Encoding) hands the
  // plain file over: only bytes that start like gzip are unpacked.
  function gunzip(blob) {
    return blob.slice(0, 2).arrayBuffer().then(function (h) {
      var b = new Uint8Array(h);
      if (b[0] !== 0x1f || b[1] !== 0x8b) return blob.arrayBuffer();
      return new Response(blob.stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
    });
  }
  function hex(buf) {
    var b = new Uint8Array(buf), s = "";
    for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? "0" : "") + b[i].toString(16);
    return s;
  }
  function getPart(pair, k, onBytes, cancelled) {
    if (pair === "runtime") {
      return fetchBlob(BASE + "vendor/bergamot/" + RUNTIME[k].n, onBytes, cancelled);
    }
    var M = MODELS[pair], f = M.files[k];
    return fetchBlob(MIRROR + pair + "/" + M.v + "/" + f.n + ".gz", onBytes, cancelled).then(function (gz) {
      return gunzip(gz).then(function (buf) {
        if (buf.byteLength !== f.size) throw err("hash", f.n);
        return crypto.subtle.digest("SHA-256", buf).then(function (h) {
          if (hex(h) !== f.sha) throw err("hash", f.n);
          return new Blob([buf]);
        });
      }, function (e) { throw e && e.code ? e : err("hash", f.n); });
    });
  }

  // ---------- Status, install, remove ----------
  function status(from, to) {
    var legs = route(from, to);
    if (!legs) return Promise.resolve({ ok: false, legs: null, need: [], mb: 0 });
    var all = legs.length ? legs.concat(["runtime"]) : [];
    return Promise.all(all.map(have)).then(function (h) {
      var need = all.filter(function (p, i) { return !h[i]; }), bytes = 0;
      need.forEach(function (p) { bytes += p === "runtime" ? runtimeBytes() : pairBytes(p); });
      return { ok: !need.length, legs: legs, need: need, mb: Math.ceil(bytes / MB) };
    });
  }
  function installed() {
    var list = Object.keys(MODELS);
    return Promise.all(list.map(have)).then(function (h) {
      return list.filter(function (p, i) { return h[i]; }).map(function (p) {
        return { pair: p, mb: Math.ceil(pairBytes(p, "size") / MB) };
      });
    });
  }
  var installing = null;
  function install(from, to, opts) {
    opts = opts || {};
    if (!supported()) return Promise.reject(err("unsupported"));
    if (installing) return Promise.reject(err("engine", "busy"));
    var progress = opts.progress || function () {}, cancelled = opts.cancelled || function () { return false; };
    installing = status(from, to).then(function (st) {
      if (!st.legs) throw err("pair");
      var total = 0, done = 0;
      st.need.forEach(function (p) { total += p === "runtime" ? runtimeBytes() : pairBytes(p); });
      return st.need.reduce(function (chain, pair) {
        return chain.then(function () {
          return partsOf(pair).reduce(function (c, k) {
            return c.then(function () {
              return stored(pair, k).then(function (b) {
                var size = pair === "runtime" ? RUNTIME[k].size : MODELS[pair].files[k].gz;
                if (b) { done += size; progress(total ? done / total : 1); return; }
                var base = done;
                return getPart(pair, k, function (n) {
                  done += n; progress(Math.min(0.99, done / total));
                }, cancelled).then(function (blob) {
                  done = base + size;
                  if (cancelled()) throw err("cancelled");
                  return tx("readwrite", function (s) { s.put({ v: verOf(pair), blob: blob }, keyOf(pair, k)); });
                });
              });
            });
          }, Promise.resolve());
        });
      }, Promise.resolve()).then(function () { progress(1); return true; });
    });
    var p = installing;
    installing.then(function () { installing = null; }, function () { installing = null; });
    return p;
  }
  function remove(pair) {
    if (!MODELS[pair]) return Promise.reject(err("pair"));
    stopWorker();
    return tx("readwrite", function (s) {
      partsOf(pair).forEach(function (k) { s.delete(keyOf(pair, k)); });
    }).then(installed).then(function (left) {
      if (left.length) return true;
      return tx("readwrite", function (s) { partsOf("runtime").forEach(function (k) { s.delete(keyOf("runtime", k)); }); })
        .then(function () { return true; });
    });
  }

  // ---------- The worker ----------
  var worker = null, wseq = 0, wpend = {}, loaded = {}, idleTimer = null, workerReady = null;
  function stopWorker() {
    clearTimeout(idleTimer);
    if (worker) { try { worker.terminate(); } catch (e) {} }
    worker = null; workerReady = null; loaded = {};
    Object.keys(wpend).forEach(function (id) { wpend[id].reject(err("engine", "stopped")); });
    wpend = {};
  }
  function call(op, msg, transfer) {
    return new Promise(function (resolve, reject) {
      var id = ++wseq;
      msg.id = id; msg.op = op;
      wpend[id] = { resolve: resolve, reject: reject };
      try { worker.postMessage(msg, transfer || []); }
      catch (e) { delete wpend[id]; reject(err("engine", String(e && e.message || e))); }
    });
  }
  function startWorker() {
    if (workerReady) return workerReady;
    try { worker = new Worker(BASE + "translate/worker.js"); }
    catch (e) { return Promise.reject(err("unsupported", "worker")); }
    worker.onmessage = function (e) {
      var m = e.data || {}, p = wpend[m.id];
      if (!p) return;
      delete wpend[m.id];
      if (m.ok) p.resolve(m.result); else p.reject(err("engine", m.error));
    };
    worker.onerror = function (e) {
      if (e && e.preventDefault) e.preventDefault();
      stopWorker();
    };
    workerReady = Promise.all([stored("runtime", "glue"), stored("runtime", "wasm")]).then(function (r) {
      if (!r[0] || !r[1]) throw err("not-installed");
      return r[1].arrayBuffer().then(function (wasm) {
        return call("init", { glue: r[0], wasm: wasm }, [wasm]);
      });
    });
    workerReady.catch(function () { stopWorker(); });
    return workerReady;
  }
  // Only the models of the direction at hand stay in the worker's memory
  // (a base model takes about 60 MB there).
  function keepOnly(legs) {
    return Promise.all(Object.keys(loaded).filter(function (p) { return legs.indexOf(p) < 0; }).map(function (p) {
      var was = loaded[p];
      delete loaded[p];
      return was.then(function () { return call("free", { pair: p }); }, function () {});
    }));
  }
  function loadLeg(pair) {
    if (loaded[pair]) return loaded[pair];
    loaded[pair] = Promise.all(partsOf(pair).map(function (k) { return stored(pair, k); })).then(function (b) {
      if (!b.every(Boolean)) throw err("not-installed");
      return Promise.all(b.map(function (x) { return x.arrayBuffer(); }));
    }).then(function (buf) {
      var names = partsOf(pair), msg = { pair: pair };
      names.forEach(function (k, i) { msg[k] = buf[i]; });
      return call("load", msg, buf);
    });
    loaded[pair].catch(function () { delete loaded[pair]; });
    return loaded[pair];
  }
  function touch() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(stopWorker, IDLE_MS);
  }

  // One job at a time: a chapter and a line from another place wait in turn.
  var queue = Promise.resolve();
  function serial(fn) {
    var p = queue.then(fn, fn);
    queue = p.then(function () {}, function () {});
    return p;
  }

  // ---------- The Assistant's AI (off by default, this device only) ----------
  var PREFS = "oros-translate-prefs";
  function prefs() {
    try { var p = JSON.parse(root.localStorage.getItem(PREFS) || "null"); return p && typeof p === "object" ? p : {}; }
    catch (e) { return {}; }
  }
  function aiOn() { return prefs().ai === 1; }
  function aiSet(v) {
    var p = prefs();
    p.ai = v ? 1 : 0;
    try { root.localStorage.setItem(PREFS, JSON.stringify(p)); return true; } catch (e) { return false; }
  }
  var aiLoading = null;
  function aiLib() {
    if (root.orosFeedsAI) return Promise.resolve(root.orosFeedsAI);
    if (!aiLoading) {
      aiLoading = new Promise(function (resolve) {
        var sc = document.createElement("script");
        sc.src = BASE + "feeds/ai.js";
        sc.async = true;
        sc.onload = sc.onerror = function () { resolve(); };
        document.head.appendChild(sc);
      }).then(function () {
        if (!root.orosFeedsAI) aiLoading = null;
        return root.orosFeedsAI || null;
      });
    }
    return aiLoading;
  }
  // → { name } of the service that would answer, or null (none set up)
  function aiReady() {
    return aiLib().then(function (L) { return L ? L.ready() : null; }, function () { return null; })
      .then(function (cf) { return cf ? { name: cf.name } : null; }, function () { return null; });
  }
  function aiPrompt(from, to, terms) {
    var sys = "You are a translator. Translate every string of the JSON array the user sends from " +
      name(from, "en") + " to " + name(to, "en") + ". Answer with only a JSON array of the translated strings, " +
      "the same number and order, and nothing else. Keep the markers like ⟦1⟧, ⟦/1⟧ and ⟦2/⟧ exactly, " +
      "around the words they belong to. Keep numbers, names and web addresses. Add no notes.";
    var tl = (Array.isArray(terms) ? terms : []).filter(function (x) {
      return x && typeof x.src === "string" && typeof x.tgt === "string" && x.src.trim() && x.tgt.trim();
    }).slice(0, AI_TERMS).map(function (x) { return x.src.trim().slice(0, 100) + " → " + x.tgt.trim().slice(0, 100); });
    if (tl.length) sys += " Use these translations of terms: " + tl.join("; ") + ".";
    return sys;
  }
  // The array in an answer, or null when it is not one of n strings.
  function aiParse(text, n) {
    var s = String(text || ""), a = s.indexOf("["), b = s.lastIndexOf("]");
    if (a < 0 || b <= a) return null;
    var arr;
    try { arr = JSON.parse(s.slice(a, b + 1)); } catch (e) { return null; }
    if (!Array.isArray(arr) || arr.length !== n) return null;
    for (var i = 0; i < n; i++) if (typeof arr[i] !== "string") return null;
    return arr;
  }
  function aiBatches(ids, prep) {
    var out = [], cur = [], len = 0;
    ids.forEach(function (i) {
      var l = prep[i].core.length;
      if (cur.length && (cur.length >= AI_SEGS || len + l > AI_CHARS)) { out.push(cur); cur = []; len = 0; }
      cur.push(i); len += l;
    });
    if (cur.length) out.push(cur);
    return out;
  }
  function aiMany(list, opts, progress, cancelled) {
    if (!aiOn()) return Promise.reject(err("ai-off"));
    var prep = list.map(function (x) {
      var p = trimParts(String(x == null ? "" : x));
      p.skip = !/[0-9A-Za-z\u00aa\u00b5\u00ba\u00c0-\u1fff\u3040-\uffef]/.test(p.core);
      return p;
    });
    var out = new Array(list.length), work = [], via = "";
    prep.forEach(function (p, i) { if (p.skip) out[i] = { text: p.pre + p.core + p.post, tagsOk: true }; else work.push(i); });
    var ctl = root.AbortController ? new AbortController() : null;
    var watch = setInterval(function () { if (cancelled() && ctl) ctl.abort(); }, 300);
    var sys = aiPrompt(opts.from, opts.to, opts.terms), done = 0;
    function put(i, t) {
      var core = String(t).trim();
      out[i] = { text: prep[i].pre + core + prep[i].post, tagsOk: tagSig(core) === tagSig(prep[i].core) };
    }
    function one(L, cf, ids) {
      if (cancelled()) return Promise.reject(err("cancelled"));
      var q = { system: sys, user: JSON.stringify(ids.map(function (i) { return prep[i].core; })) };
      return L.ask(cf, q, ctl ? ctl.signal : null, null, null).then(function (text) {
        var arr = aiParse(text, ids.length);
        if (!arr && ids.length > 1) {                  // a muddled answer: halves, then lines
          var h = Math.ceil(ids.length / 2);
          return one(L, cf, ids.slice(0, h)).then(function () { return one(L, cf, ids.slice(h)); });
        }
        if (!arr) arr = [String(text || "").replace(/^\s*\[\s*"?|"?\s*\]\s*$/g, "")];
        ids.forEach(function (i, j) { put(i, arr[j]); });
        done += ids.length;
        progress(done, work.length);
      }, function (e) {
        if (cancelled()) throw err("cancelled");
        var x = err("ai", String(e && (e.msg || e.message || e.code) || e).slice(0, 200));
        x.why = e && e.code ? e.code : "";
        throw x;
      });
    }
    return serial(function () {
      return aiLib().then(function (L) {
        if (!L) throw err("ai-none");
        return L.ready().then(function (cf) {
          if (!cf) throw err("ai-none");
          via = cf.name;
          return aiBatches(work, prep).reduce(function (c, ids) {
            return c.then(function () { return one(L, cf, ids); });
          }, Promise.resolve());
        });
      });
    }).then(function () {
      clearInterval(watch);
      return out.map(function (r) { return { text: r.text, engine: "ai", tagsOk: r.tagsOk, via: via }; });
    }, function (e) { clearInterval(watch); throw e; });
  }

  function translateMany(segments, opts) {
    opts = opts || {};
    var list = Array.isArray(segments) ? segments : [];
    var from = opts.from, to = opts.to, eng = opts.engine || "auto";
    var progress = opts.progress || function () {}, cancelled = opts.cancelled || function () { return false; };
    var legs = route(from, to);
    if (from !== to && (eng === "ai" || (eng === "auto" && !legs && aiOn()))) return aiMany(list, opts, progress, cancelled);
    if (!legs) return Promise.reject(err("pair"));
    var prep = list.map(prepare);
    if (!legs.length) {
      return Promise.resolve(list.map(function (s) { return { text: String(s == null ? "" : s), engine: "bergamot", tagsOk: true }; }));
    }
    if (!supported()) return Promise.reject(err("unsupported"));
    return serial(function () {
      var out = new Array(list.length), work = [];
      prep.forEach(function (p, i) { if (p.skip) out[i] = finish(p, ""); else work.push(i); });
      return startWorker().then(function () { return keepOnly(legs); }).then(function () {
        return legs.reduce(function (c, leg) { return c.then(function () { return loadLeg(leg); }); }, Promise.resolve());
      }).then(function () {
        var done = 0;
        function next() {
          touch();
          if (cancelled()) throw err("cancelled");
          if (done >= work.length) return;
          var ids = work.slice(done, done + CHUNK);
          return call("translate", { legs: legs, texts: ids.map(function (i) { return { text: prep[i].send, html: prep[i].html }; }) }).then(function (r) {
            ids.forEach(function (i, j) { out[i] = finish(prep[i], r[j] || ""); });
            done += ids.length;
            progress(done, work.length);
            return next();
          });
        }
        return next();
      }).then(function () {
        touch();
        return out.map(function (r) { return { text: r.text, engine: "bergamot", tagsOk: r.tagsOk }; });
      });
    });
  }
  function translate(text, opts) {
    opts = opts || {};
    var lines = splitLines(text);
    return translateMany(lines.map(function (l) { return l.text; }), {
      from: opts.from, to: opts.to, cancelled: opts.cancelled, engine: opts.engine, terms: opts.terms,
      progress: opts.progress ? function (d, n) { opts.progress(n ? d / n : 1); } : null
    }).then(function (r) {
      var res = { text: lines.map(function (l, i) { return r[i].text + l.br; }).join(""), engine: r.length ? r[0].engine : "bergamot" };
      if (r.length && r[0].via) res.via = r[0].via;
      return res;
    });
  }

  root.OrosTranslate = {
    pairs: pairs, languages: languages, froms: froms, tos: tos, name: name, route: route,
    status: status, installed: installed, install: install, remove: remove, detect: detect,
    translate: translate, translateMany: translateMany, supported: supported,
    ai: { on: aiOn, set: aiSet, ready: aiReady }
  };
})(typeof window !== "undefined" ? window : this);
