// ============================================================
// orOS Wiki — App logic (v1.0.0)
// Your own encyclopedia: articles that link to each other, read like
// Wikipedia (contents box, sections, categories, red links) and kept
// with their full history.
//   - several wikis, each with a main page
//   - read view, whole-article and section editing with a toolbar
//     and a preview, rename with a redirect, delete with Undo
//   - history: every saved version as a file on the orOS disk, the
//     changes between two versions, restore an old version
//   - parallel edits on two devices are both kept until you choose
//   - Recent changes, Random article, All articles, Categories,
//     Wanted articles, What links here, search with suggestions
// Data: synced slice "wiki" (oros-wiki-data, core.js); history files
// /internal/Wiki/History/<article>/ on the orOS disk (Vault Drive).
// Sections:
//   1. Constants, i18n, helpers
//   2. State + storage
//   3. Navigation
//   4. Article view
//   5. Editor
//   6. History + parallel edits
//   7. Lists (recent, all, categories, wanted, links, search)
//   8. Wikis + article actions
//   9. Dialogs, toast
//  10. Sync slice, palette, deep link
//  11. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var C = window.WikiCore;

  // ---------- 1. Constants, i18n, helpers ----------
  function appLang() {
    try {
      var l = localStorage.getItem("oros-lang") || (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  var LANG = appLang();

  var STRINGS = {
    en: {
      "app.name": "Wiki",
      "search.label": "Search the wiki", "search.ph": "Search the wiki",
      "side.title": "Wiki menu", "side.wiki": "Wiki", "btn.side": "Menu", "btn.back": "Back", "btn.new": "New article",
      "nav.main": "Main page", "nav.recent": "Recent changes", "nav.random": "Random article", "nav.all": "All articles",
      "nav.cats": "Categories", "nav.wanted": "Wanted articles",
      "nav.newWiki": "New wiki…", "nav.renWiki": "Rename this wiki…", "nav.delWiki": "Delete this wiki…",
      "side.sync": "Your wikis follow you to every device through orOS sync, encrypted. The history of each article travels with your orOS disk.",
      "side.stats": "{n} articles · {kb} KB", "side.stats1": "1 article · {kb} KB",
      "wiki.default": "My wiki", "wiki.unnamed": "Recovered wiki",
      "welcome.title": "Your own encyclopedia",
      "welcome.text": "Write down what you know in articles that link to each other, read them like Wikipedia, and keep every version.",
      "welcome.btn": "Create my wiki",
      "tab.read": "Read", "tab.edit": "Edit", "tab.history": "History", "btn.more": "More",
      "art.redirectedFrom": "(Redirected from {t})", "art.isRedirect": "This page redirects to",
      "art.lastEdit": "Last edited on {d}", "art.empty": "This article is empty. Press Edit to write it.",
      "art.cats": "Categories", "art.cat1": "Category", "art.toc": "Contents", "art.secEdit": "edit",
      "art.dup": "Another article has the same title:", "art.dupOpen": "open it",
      "art.conflict": "This article was also changed on another device ({d}). Both versions are kept until you choose.",
      "art.conflictN": "This article was also changed on other devices ({n} versions). Both versions are kept until you choose.",
      "btn.compare": "Compare", "btn.keepMine": "Keep this version", "btn.useOther": "Use the other version",
      "main.missing": "This wiki has no main page yet.", "main.make": "Write the main page",
      "main.title": "Main page",
      "nf.title": "No article called “{t}” yet.", "nf.make": "Write it",
      "ed.title": "Editing {t}", "ed.titleSec": "Editing {t} (section)", "ed.new": "New article",
      "ed.name": "Title", "ed.write": "Write", "ed.preview": "Preview", "ed.sum": "Summary of your changes",
      "ed.sumPh": "What did you change?", "ed.save": "Save", "ed.cancel": "Cancel",
      "ed.help": "Formatting help", "ed.changed": "This article changed on another device while you were writing. Saving keeps both versions.",
      "ed.restored": "Your unsaved changes are back.",
      "tb.b": "Bold", "tb.i": "Italic", "tb.s": "Struck through", "tb.h2": "Heading", "tb.h3": "Subheading",
      "tb.ul": "Bulleted list", "tb.ol": "Numbered list", "tb.link": "Link to an article", "tb.xlink": "Web link",
      "tb.table": "Table", "tb.code": "Code", "tb.quote": "Quote", "tb.cat": "Category",
      "tb.linkPh": "Article title", "tb.xlinkPh": "text", "tb.catPh": "Name", "tb.col": "Column",
      "cheat": [
        "## Heading  ·  ### Subheading",
        "**bold**  ·  *italic*  ·  ~~struck~~  ·  `code`",
        "[[Article]]  ·  [[Article|other text]]  ·  [[Article#Section]]",
        "[text](https://example.com)  ·  https://example.com",
        "- list item  ·  1. numbered item (two spaces in front: one level deeper)",
        "> quote  ·  --- line  ·  ``` code block ```",
        "| A | B |  then  |---|---|  then rows: a table",
        "[[Category:Name]] files the article in a category",
        "#REDIRECT [[Article]] as the first line sends readers to another article"
      ],
      "hist.title": "History of {t}", "hist.cur": "Current version", "hist.none": "No saved versions on this device yet.",
      "hist.nofs": "History needs the orOS disk: open Wiki inside orOS.",
      "hist.later": "Versions saved on your other devices show up here once the orOS disk has synced.",
      "hist.view": "View", "hist.diff": "Changes", "hist.diffCur": "Compare with current", "hist.restore": "Restore",
      "hist.old": "Old version from {d}", "hist.backCur": "Back to the current version",
      "hist.restored": "Restored the version of {d}", "hist.noSum": "(no summary)",
      "hist.loading": "Loading…",
      "diff.title": "Changes", "diff.from": "Before: {d}", "diff.to": "After: {d}", "diff.same": "No difference in the text.",
      "diff.gap": "{n} unchanged lines", "diff.gap1": "1 unchanged line", "diff.stats": "+{a} lines · −{d} lines",
      "diff.titleChanged": "Title: {a} → {b}", "diff.other": "The other version",
      "recent.title": "Recent changes", "recent.none": "No changes yet.", "recent.new": "new",
      "all.title": "All articles", "all.none": "No articles yet.", "all.filter": "Filter",
      "cats.title": "Categories", "cats.none": "No categories yet. Add [[Category:Name]] to an article.",
      "cats.count": "{n} articles", "cats.count1": "1 article",
      "cat.title": "Category: {t}", "cat.none": "No article is in this category.",
      "wanted.title": "Wanted articles", "wanted.none": "Every link points to an article. Nothing is missing.",
      "wanted.from": "linked from {n} articles", "wanted.from1": "linked from 1 article",
      "links.title": "What links here: {t}", "links.none": "No article links here.", "links.redir": "redirect",
      "search.title": "Search results for “{q}”", "search.none": "No results.", "search.make": "Write the article “{t}”",
      "search.short": "Type at least 2 letters.",
      "menu.title": "Article", "menu.rename": "Rename…", "menu.links": "What links here",
      "menu.copy": "Copy the text", "menu.main": "Make this the main page", "menu.del": "Delete this article",
      "ren.title": "Rename the article", "ren.lbl": "New title", "ren.redirect": "Leave a redirect from the old title",
      "ren.sum": "Renamed from “{t}”", "ren.redirSum": "Redirect to “{t}”", "ren.ok": "Rename",
      "wikiNew.title": "New wiki", "wikiNew.lbl": "Name", "wikiNew.ok": "Create",
      "wikiRen.title": "Rename this wiki", "wikiRen.ok": "Rename",
      "ask.delArt": "Delete the article “{t}”? It goes from all your devices.",
      "ask.delWiki": "Delete the wiki “{t}” and its {n} articles? They go from all your devices.",
      "ask.delWiki1": "Delete the wiki “{t}” and its 1 article? It goes from all your devices.",
      "ask.discard": "Throw away your changes?", "btn.discard": "Throw away",
      "btn.cancel": "Cancel", "btn.delete": "Delete", "btn.close": "Close", "btn.undo": "Undo", "btn.ok": "OK",
      "err.title": "Give the article a title.", "err.exists": "An article with this title already exists.",
      "err.name": "Give the wiki a name.", "err.full": "This wiki is full (5,000 articles).", "err.wikis": "You have 50 wikis. Delete one first.",
      "err.long": "The text is too long (200,000 characters at most).",
      "toast.saved": "Saved", "toast.nochange": "No changes to save", "toast.saveFail": "Could not save on this device (storage full?)",
      "toast.deleted": "Article deleted", "toast.wikiDeleted": "Wiki deleted", "toast.copied": "Text copied",
      "toast.copyFail": "Copying did not work here.", "toast.noRandom": "No articles yet.",
      "toast.histFail": "Saved, but the version could not be written to the orOS disk.",
      "toast.main": "This is now the main page", "toast.resolved": "Done: one version kept, the other stays in the history",
      "standalone": "Open Wiki inside orOS to sync your wikis and keep their history.",
      "sum.new": "New article", "sum.restore": "Restored an older version",
      "sum.keep": "Kept this version (parallel edit)", "sum.useOther": "Took the version from another device"
    },
    el: {
      "app.name": "Wiki",
      "search.label": "Αναζήτηση στο wiki", "search.ph": "Αναζήτηση στο wiki",
      "side.title": "Μενού του wiki", "side.wiki": "Wiki", "btn.side": "Μενού", "btn.back": "Πίσω", "btn.new": "Νέο άρθρο",
      "nav.main": "Κεντρική σελίδα", "nav.recent": "Πρόσφατες αλλαγές", "nav.random": "Τυχαίο άρθρο", "nav.all": "Όλα τα άρθρα",
      "nav.cats": "Κατηγορίες", "nav.wanted": "Άρθρα που λείπουν",
      "nav.newWiki": "Νέο wiki…", "nav.renWiki": "Μετονομασία αυτού του wiki…", "nav.delWiki": "Διαγραφή αυτού του wiki…",
      "side.sync": "Τα wiki σου σε ακολουθούν σε κάθε συσκευή μέσω του sync του orOS, κρυπτογραφημένα. Το ιστορικό κάθε άρθρου ταξιδεύει με τον δίσκο του orOS.",
      "side.stats": "{n} άρθρα · {kb} KB", "side.stats1": "1 άρθρο · {kb} KB",
      "wiki.default": "Το wiki μου", "wiki.unnamed": "Wiki που ανακτήθηκε",
      "welcome.title": "Η δική σου εγκυκλοπαίδεια",
      "welcome.text": "Γράψε όσα ξέρεις σε άρθρα που συνδέονται μεταξύ τους, διάβασέ τα όπως στη Wikipedia και κράτα κάθε εκδοχή τους.",
      "welcome.btn": "Φτιάξε το wiki μου",
      "tab.read": "Ανάγνωση", "tab.edit": "Επεξεργασία", "tab.history": "Ιστορικό", "btn.more": "Περισσότερα",
      "art.redirectedFrom": "(Ανακατεύθυνση από {t})", "art.isRedirect": "Αυτή η σελίδα οδηγεί στο",
      "art.lastEdit": "Τελευταία αλλαγή: {d}", "art.empty": "Αυτό το άρθρο είναι άδειο. Πάτα Επεξεργασία για να το γράψεις.",
      "art.cats": "Κατηγορίες", "art.cat1": "Κατηγορία", "art.toc": "Περιεχόμενα", "art.secEdit": "επεξεργασία",
      "art.dup": "Υπάρχει κι άλλο άρθρο με τον ίδιο τίτλο:", "art.dupOpen": "άνοιξέ το",
      "art.conflict": "Αυτό το άρθρο άλλαξε και σε άλλη συσκευή ({d}). Κρατιούνται και οι δύο εκδοχές μέχρι να διαλέξεις.",
      "art.conflictN": "Αυτό το άρθρο άλλαξε και σε άλλες συσκευές ({n} εκδοχές). Κρατιούνται όλες μέχρι να διαλέξεις.",
      "btn.compare": "Σύγκριση", "btn.keepMine": "Κράτα αυτή την εκδοχή", "btn.useOther": "Πάρε την άλλη εκδοχή",
      "main.missing": "Αυτό το wiki δεν έχει ακόμα κεντρική σελίδα.", "main.make": "Γράψε την κεντρική σελίδα",
      "main.title": "Κεντρική σελίδα",
      "nf.title": "Δεν υπάρχει ακόμα άρθρο με τίτλο «{t}».", "nf.make": "Γράψ' το",
      "ed.title": "Επεξεργασία: {t}", "ed.titleSec": "Επεξεργασία: {t} (ενότητα)", "ed.new": "Νέο άρθρο",
      "ed.name": "Τίτλος", "ed.write": "Γραφή", "ed.preview": "Προεπισκόπηση", "ed.sum": "Σύνοψη των αλλαγών σου",
      "ed.sumPh": "Τι άλλαξες;", "ed.save": "Αποθήκευση", "ed.cancel": "Άκυρο",
      "ed.help": "Βοήθεια μορφοποίησης", "ed.changed": "Αυτό το άρθρο άλλαξε σε άλλη συσκευή όσο έγραφες. Η αποθήκευση κρατά και τις δύο εκδοχές.",
      "ed.restored": "Οι αλλαγές σου που δεν είχαν αποθηκευτεί επέστρεψαν.",
      "tb.b": "Έντονα", "tb.i": "Πλάγια", "tb.s": "Διαγραμμένα", "tb.h2": "Επικεφαλίδα", "tb.h3": "Υποεπικεφαλίδα",
      "tb.ul": "Λίστα με κουκκίδες", "tb.ol": "Αριθμημένη λίστα", "tb.link": "Σύνδεσμος σε άρθρο", "tb.xlink": "Σύνδεσμος στο web",
      "tb.table": "Πίνακας", "tb.code": "Κώδικας", "tb.quote": "Παράθεση", "tb.cat": "Κατηγορία",
      "tb.linkPh": "Τίτλος άρθρου", "tb.xlinkPh": "κείμενο", "tb.catPh": "Όνομα", "tb.col": "Στήλη",
      "cheat": [
        "## Επικεφαλίδα  ·  ### Υποεπικεφαλίδα",
        "**έντονα**  ·  *πλάγια*  ·  ~~διαγραμμένα~~  ·  `κώδικας`",
        "[[Άρθρο]]  ·  [[Άρθρο|άλλο κείμενο]]  ·  [[Άρθρο#Ενότητα]]",
        "[κείμενο](https://example.com)  ·  https://example.com",
        "- στοιχείο λίστας  ·  1. αριθμημένο στοιχείο (δύο κενά μπροστά: ένα επίπεδο πιο μέσα)",
        "> παράθεση  ·  --- γραμμή  ·  ``` μπλοκ κώδικα ```",
        "| Α | Β |  μετά  |---|---|  μετά οι γραμμές: ένας πίνακας",
        "[[Κατηγορία:Όνομα]] βάζει το άρθρο σε κατηγορία",
        "#REDIRECT [[Άρθρο]] στην πρώτη γραμμή στέλνει τον αναγνώστη σε άλλο άρθρο"
      ],
      "hist.title": "Ιστορικό: {t}", "hist.cur": "Τρέχουσα εκδοχή", "hist.none": "Δεν υπάρχουν ακόμα αποθηκευμένες εκδοχές σε αυτή τη συσκευή.",
      "hist.nofs": "Το ιστορικό θέλει τον δίσκο του orOS: άνοιξε το Wiki μέσα από το orOS.",
      "hist.later": "Οι εκδοχές που αποθηκεύτηκαν στις άλλες συσκευές σου εμφανίζονται εδώ μόλις συγχρονιστεί ο δίσκος του orOS.",
      "hist.view": "Προβολή", "hist.diff": "Αλλαγές", "hist.diffCur": "Σύγκριση με την τρέχουσα", "hist.restore": "Επαναφορά",
      "hist.old": "Παλιά εκδοχή: {d}", "hist.backCur": "Πίσω στην τρέχουσα εκδοχή",
      "hist.restored": "Επαναφέρθηκε η εκδοχή της {d}", "hist.noSum": "(χωρίς σύνοψη)",
      "hist.loading": "Φόρτωση…",
      "diff.title": "Αλλαγές", "diff.from": "Πριν: {d}", "diff.to": "Μετά: {d}", "diff.same": "Το κείμενο δεν έχει διαφορά.",
      "diff.gap": "{n} γραμμές χωρίς αλλαγή", "diff.gap1": "1 γραμμή χωρίς αλλαγή", "diff.stats": "+{a} γραμμές · −{d} γραμμές",
      "diff.titleChanged": "Τίτλος: {a} → {b}", "diff.other": "Η άλλη εκδοχή",
      "recent.title": "Πρόσφατες αλλαγές", "recent.none": "Δεν υπάρχουν ακόμα αλλαγές.", "recent.new": "νέο",
      "all.title": "Όλα τα άρθρα", "all.none": "Δεν υπάρχουν ακόμα άρθρα.", "all.filter": "Φίλτρο",
      "cats.title": "Κατηγορίες", "cats.none": "Δεν υπάρχουν ακόμα κατηγορίες. Πρόσθεσε [[Κατηγορία:Όνομα]] σε ένα άρθρο.",
      "cats.count": "{n} άρθρα", "cats.count1": "1 άρθρο",
      "cat.title": "Κατηγορία: {t}", "cat.none": "Κανένα άρθρο δεν είναι σε αυτή την κατηγορία.",
      "wanted.title": "Άρθρα που λείπουν", "wanted.none": "Κάθε σύνδεσμος οδηγεί σε άρθρο. Δεν λείπει τίποτα.",
      "wanted.from": "σύνδεσμος από {n} άρθρα", "wanted.from1": "σύνδεσμος από 1 άρθρο",
      "links.title": "Τι συνδέει εδώ: {t}", "links.none": "Κανένα άρθρο δεν συνδέει εδώ.", "links.redir": "ανακατεύθυνση",
      "search.title": "Αποτελέσματα για «{q}»", "search.none": "Δεν βρέθηκε τίποτα.", "search.make": "Γράψε το άρθρο «{t}»",
      "search.short": "Γράψε τουλάχιστον 2 γράμματα.",
      "menu.title": "Άρθρο", "menu.rename": "Μετονομασία…", "menu.links": "Τι συνδέει εδώ",
      "menu.copy": "Αντιγραφή του κειμένου", "menu.main": "Κάν' το κεντρική σελίδα", "menu.del": "Διαγραφή αυτού του άρθρου",
      "ren.title": "Μετονομασία του άρθρου", "ren.lbl": "Νέος τίτλος", "ren.redirect": "Άφησε ανακατεύθυνση από τον παλιό τίτλο",
      "ren.sum": "Μετονομάστηκε από «{t}»", "ren.redirSum": "Ανακατεύθυνση στο «{t}»", "ren.ok": "Μετονομασία",
      "wikiNew.title": "Νέο wiki", "wikiNew.lbl": "Όνομα", "wikiNew.ok": "Δημιουργία",
      "wikiRen.title": "Μετονομασία αυτού του wiki", "wikiRen.ok": "Μετονομασία",
      "ask.delArt": "Διαγραφή του άρθρου «{t}»; Θα φύγει από όλες τις συσκευές σου.",
      "ask.delWiki": "Διαγραφή του wiki «{t}» και των {n} άρθρων του; Θα φύγουν από όλες τις συσκευές σου.",
      "ask.delWiki1": "Διαγραφή του wiki «{t}» και του 1 άρθρου του; Θα φύγει από όλες τις συσκευές σου.",
      "ask.discard": "Να πεταχτούν οι αλλαγές σου;", "btn.discard": "Πέτα τις",
      "btn.cancel": "Άκυρο", "btn.delete": "Διαγραφή", "btn.close": "Κλείσιμο", "btn.undo": "Αναίρεση", "btn.ok": "Εντάξει",
      "err.title": "Δώσε τίτλο στο άρθρο.", "err.exists": "Υπάρχει ήδη άρθρο με αυτόν τον τίτλο.",
      "err.name": "Δώσε όνομα στο wiki.", "err.full": "Αυτό το wiki γέμισε (5.000 άρθρα).", "err.wikis": "Έχεις 50 wiki. Διάγραψε πρώτα ένα.",
      "err.long": "Το κείμενο είναι πολύ μεγάλο (έως 200.000 χαρακτήρες).",
      "toast.saved": "Αποθηκεύτηκε", "toast.nochange": "Δεν υπάρχουν αλλαγές για αποθήκευση", "toast.saveFail": "Δεν έγινε αποθήκευση σε αυτή τη συσκευή (γέμισε ο χώρος;)",
      "toast.deleted": "Το άρθρο διαγράφηκε", "toast.wikiDeleted": "Το wiki διαγράφηκε", "toast.copied": "Το κείμενο αντιγράφηκε",
      "toast.copyFail": "Η αντιγραφή δεν δούλεψε εδώ.", "toast.noRandom": "Δεν υπάρχουν ακόμα άρθρα.",
      "toast.histFail": "Αποθηκεύτηκε, αλλά η εκδοχή δεν γράφτηκε στον δίσκο του orOS.",
      "toast.main": "Αυτή είναι τώρα η κεντρική σελίδα", "toast.resolved": "Έγινε: κρατήθηκε μία εκδοχή, η άλλη μένει στο ιστορικό",
      "standalone": "Άνοιξε το Wiki μέσα από το orOS για sync και ιστορικό.",
      "sum.new": "Νέο άρθρο", "sum.restore": "Επαναφορά παλιότερης εκδοχής",
      "sum.keep": "Κρατήθηκε αυτή η εκδοχή (παράλληλη αλλαγή)", "sum.useOther": "Πάρθηκε η εκδοχή άλλης συσκευής"
    }
  };
  function t(k, vars) {
    var s = (STRINGS[LANG] && STRINGS[LANG][k] !== undefined) ? STRINGS[LANG][k] : (STRINGS.en[k] !== undefined ? STRINGS.en[k] : k);
    if (vars && typeof s === "string") s = s.replace(/\{(\w+)\}/g, function (m, n) { return vars[n] !== undefined ? vars[n] : m; });
    return s;
  }
  function tn(k, n, vars) {
    vars = Object.assign({ n: n }, vars || {});
    return n === 1 && STRINGS.en[k + "1"] !== undefined ? t(k + "1", vars) : t(k, vars);
  }

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function btn(cls, text, onClick) {
    var b = el("button", cls, text);
    b.type = "button";
    if (onClick) b.addEventListener("click", onClick);
    return b;
  }
  function setLabel(b, text) { b.setAttribute("aria-label", text); b.title = text; }
  function shell() {
    try { return window.parent && window.parent !== window ? window.parent : null; } catch (e) { return null; }
  }
  function fsApi() {
    try { return (window.parent && window.parent.orosFS) || window.orosFS || null; } catch (e) { return window.orosFS || null; }
  }
  var DTF = null;
  function fmtDate(ms) {
    if (!ms) return "";
    try {
      DTF = DTF || new Intl.DateTimeFormat(LANG === "el" ? "el-GR" : "en-GB", { dateStyle: "medium", timeStyle: "short" });
      return DTF.format(new Date(ms));
    } catch (e) { return new Date(ms).toISOString().slice(0, 16).replace("T", " "); }
  }
  var DAYF = null;
  function fmtDay(ms) {
    try {
      DAYF = DAYF || new Intl.DateTimeFormat(LANG === "el" ? "el-GR" : "en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
      return DAYF.format(new Date(ms));
    } catch (e) { return new Date(ms).toISOString().slice(0, 10); }
  }

  var ICON = {
    menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'
  };

  // ---------- 2. State + storage ----------
  var data = C.empty();
  var prefs = C.normPrefs(null);
  var view = null;          // { v: "art"|"edit"|"hist"|"rev"|"diff"|"recent"|"all"|"cats"|"cat"|"wanted"|"links"|"search"|"welcome"|"missing", … }
  var stack = [];           // views to go back to
  var ed = null;            // editor state while view.v === "edit"
  var draftTimer = 0;

  function load() {
    try { data = C.parse(localStorage.getItem(C.DATA_KEY)); } catch (e) { data = C.empty(); }
    try { prefs = C.normPrefs(JSON.parse(localStorage.getItem(C.PREFS_KEY) || "null")); } catch (e) { prefs = C.normPrefs(null); }
  }
  function savePrefs() {
    try { localStorage.setItem(C.PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }
  // Write the slice and tell sync. Returns false when the device is full.
  function persist() {
    data = C.merge(data, null);
    var ok = true;
    try { localStorage.setItem(C.DATA_KEY, JSON.stringify(data)); }
    catch (e) { ok = false; toast(t("toast.saveFail")); }
    if (window.__orosSyncApi) window.__orosSyncApi.dirty();
    renderSide();
    return ok;
  }
  function curWiki() {
    var w = C.wikiById(data, prefs.w);
    if (!w && data.wikis.length) {
      w = data.wikis.slice().sort(function (a, b) { return wikiName(a).localeCompare(wikiName(b)); })[0];
      prefs.w = w.id; savePrefs();
    }
    return w;
  }
  function wikiName(w) { return w ? (w.n || t("wiki.unnamed")) : ""; }
  function idx() { var w = curWiki(); return C.titleIndex(data, w ? w.id : ""); }
  function linkState(title) { return idx()[C.fold(title)] ? "ok" : "new"; }
  function now(prev) { return Math.max(Date.now(), (prev || 0) + 1); }

  // ---------- 3. Navigation ----------
  function go(v, opts) {
    opts = opts || {};
    if (view && view.v === "edit" && ed && ed.dirty() && !opts.force) {
      ask(t("ask.discard"), t("btn.discard"), function () { clearDraft(); ed = null; go(v, Object.assign({}, opts, { force: true })); });
      return;
    }
    if (view && !opts.replace && !(view.v === "edit")) stack.push(view);
    if (stack.length > 50) stack.shift();
    if (view && view.v === "edit" && v.v !== "edit") ed = null;
    view = v;
    closeSide(true);
    hideSugg();
    render();
    if (!opts.keepScroll) $("main").scrollTop = 0;
  }
  function back() {
    var v = stack.pop();
    if (!v) return;
    if (view && view.v === "edit" && ed && ed.dirty()) {
      stack.push(v);
      ask(t("ask.discard"), t("btn.discard"), function () { clearDraft(); ed = null; stack.pop(); view = v; render(); });
      return;
    }
    ed = null;
    view = v;
    render();
  }
  function openArt(a, extra) {
    if (!a) return;
    prefs.a = a.id; savePrefs();
    go(Object.assign({ v: "art", a: a.id }, extra || {}));
  }
  // A [[link]]: the article, a redirect to follow, or the editor for a new one.
  function follow(title, frag) {
    var w = curWiki();
    if (!w) return;
    if (!title && frag) { scrollToAnchor(frag); return; }
    var r = C.resolve(data, w.id, title);
    if (r.art) openArt(r.art, { from: r.from ? r.from.id : "", frag: frag || "" });
    else startEdit({ title: title });
  }
  function goMain(opts) {
    var w = curWiki();
    if (!w) { go({ v: "welcome" }, opts); return; }
    var a = w.main && C.byId(data, w.main);
    if (a && a.w === w.id) { prefs.a = a.id; savePrefs(); go({ v: "art", a: a.id }, opts); }
    else go({ v: "missing" }, opts);
  }
  function scrollToAnchor(frag) {
    var id = "s-" + C.slug(frag);
    var n = document.getElementById(id);
    if (!n) return;
    var sec = n.closest && n.closest(".sec");
    if (sec) sec.classList.remove("closed");
    n.scrollIntoView({ block: "start" });
  }

  function render() {
    var page = $("page");
    page.textContent = "";
    $("back-btn").hidden = !stack.length;
    var w = curWiki();
    $("title-sub").textContent = w ? wikiName(w) : "";
    if (!w && view.v !== "welcome") view = { v: "welcome" };
    switch (view.v) {
      case "welcome": renderWelcome(page); break;
      case "missing": renderMissing(page); break;
      case "art": renderArticle(page); break;
      case "edit": renderEditor(page); break;
      case "hist": renderHistory(page); break;
      case "rev": renderRevision(page); break;
      case "diff": renderDiff(page); break;
      case "recent": renderRecent(page); break;
      case "all": renderAll(page); break;
      case "cats": renderCats(page); break;
      case "cat": renderCat(page); break;
      case "wanted": renderWanted(page); break;
      case "links": renderLinks(page); break;
      case "search": renderSearch(page); break;
      default: renderWelcome(page);
    }
    markNav();
  }
  function markNav() {
    var go2 = { recent: "recent", all: "all", cats: "cats", wanted: "wanted" }[view.v] || "";
    var w = curWiki();
    if (view.v === "art" && w && w.main === view.a) go2 = "main";
    [].forEach.call(document.querySelectorAll(".nav-item[data-go]"), function (b) {
      b.classList.toggle("on", b.getAttribute("data-go") === go2);
      if (b.getAttribute("data-go") === go2) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
  }
  // "text {t} text" with a link node in place of {t}
  function withLink(parent, tpl, node) {
    var i = tpl.indexOf("{t}");
    if (i < 0) { parent.appendChild(document.createTextNode(tpl + " ")); parent.appendChild(node); return; }
    parent.appendChild(document.createTextNode(tpl.slice(0, i)));
    parent.appendChild(node);
    parent.appendChild(document.createTextNode(tpl.slice(i + 3)));
  }
  function pageHead(page, title, sub) {
    var h = el("h1", "pg-title", title);
    page.appendChild(h);
    if (sub) page.appendChild(el("p", "pg-sub", sub));
    return h;
  }

  // ---------- 4. Article view ----------
  function renderWelcome(page) {
    var box = el("div", "welcome");
    box.appendChild(el("div", "welcome-logo", "W"));
    box.appendChild(el("h1", "pg-title", t("welcome.title")));
    box.appendChild(el("p", "hint", t("welcome.text")));
    box.appendChild(btn("chip primary", t("welcome.btn"), function () { createWiki(t("wiki.default"), true); }));
    page.appendChild(box);
  }
  function renderMissing(page) {
    pageHead(page, t("main.title"));
    page.appendChild(el("p", "hint", t("main.missing")));
    page.appendChild(btn("chip primary", t("main.make"), function () { startEdit({ title: t("main.title"), makeMain: true }); }));
    var list = C.live(data, curWiki().id).sort(C.byTitle);
    if (list.length) {
      page.appendChild(el("h2", "pg-h2", t("all.title")));
      page.appendChild(artList(list.slice(0, 200)));
    }
  }

  function renderArticle(page) {
    var a = C.byId(data, view.a), w = curWiki();
    if (!a || a.w !== w.id) { goMain({ replace: true, force: true }); return; }
    var inf = C.info(a), parsed = C.parseDoc(a.x);
    var art = el("article", "art");
    art.appendChild(artTabs(a, "read"));
    var h1 = el("h1", "art-title", a.t);
    art.appendChild(h1);
    if (view.from) {
      var fr = C.byId(data, view.from);
      if (fr) {
        var sub = el("p", "art-sub");
        var fl = el("a", "wl", fr.t);
        fl.href = "#";
        fl.addEventListener("click", function (e) { e.preventDefault(); go({ v: "art", a: fr.id }); });
        withLink(sub, t("art.redirectedFrom"), fl);
        art.appendChild(sub);
      }
    }
    if (a.alt.length) art.appendChild(conflictBox(a));
    var dup = C.live(data, w.id).filter(function (o) { return o.id !== a.id && C.fold(o.t) === C.fold(a.t); })[0];
    if (dup) {
      var db = el("p", "note");
      db.appendChild(document.createTextNode(t("art.dup") + " "));
      var dl = el("a", "wl", t("art.dupOpen"));
      dl.href = "#";
      dl.addEventListener("click", function (e) { e.preventDefault(); openArt(dup); });
      db.appendChild(dl);
      art.appendChild(db);
    }
    if (inf.redirect) {
      var rb = el("div", "redir");
      rb.appendChild(el("span", "redir-arrow", "↳"));
      rb.appendChild(document.createTextNode(t("art.isRedirect") + " "));
      var rl = el("a", "wl" + (linkState(inf.redirect) === "new" ? " new" : ""), inf.redirect);
      rl.href = "#";
      rl.setAttribute("data-to", inf.redirect);
      rb.appendChild(rl);
      art.appendChild(rb);
    }
    var body = el("div", "art-body");
    if (!a.x.trim()) body.appendChild(el("p", "hint", t("art.empty")));
    else body.appendChild(C.render(document, parsed, { state: linkState, edit: t("art.secEdit"), toc: t("art.toc") }));
    art.appendChild(body);
    if (inf.cats.length) art.appendChild(catsBox(inf.cats));
    var foot = el("footer", "art-foot");
    foot.appendChild(el("span", null, t("art.lastEdit", { d: fmtDate(a.m) })));
    art.appendChild(foot);
    page.appendChild(art);
    wireArticleBody(body, a);
    if (view.frag) setTimeout(function () { scrollToAnchor(view.frag); view.frag = ""; }, 0);
  }

  function artTabs(a, on) {
    var bar = el("div", "art-tabs");
    bar.setAttribute("role", "toolbar");
    [["read", "tab.read"], ["edit", "tab.edit"], ["history", "tab.history"]].forEach(function (p) {
      var b = btn("art-tab" + (on === p[0] ? " on" : ""), t(p[1]), function () {
        if (p[0] === on) return;
        if (p[0] === "read") openArt(a);
        else if (p[0] === "edit") startEdit({ a: a.id });
        else go({ v: "hist", a: a.id });
      });
      if (on === p[0]) b.setAttribute("aria-pressed", "true");
      bar.appendChild(b);
    });
    bar.appendChild(el("span", "spacer"));
    var more = btn("icon-btn", null, function () { openArtMenu(a); });
    more.innerHTML = ICON.more;
    setLabel(more, t("btn.more"));
    bar.appendChild(more);
    return bar;
  }

  function catsBox(cats) {
    var box = el("div", "cats-box");
    box.appendChild(el("span", "cats-lbl", (cats.length === 1 ? t("art.cat1") : t("art.cats")) + ":"));
    cats.forEach(function (c) {
      var a = el("a", "wl cat", c);
      a.href = "#";
      a.setAttribute("data-cat", c);
      box.appendChild(a);
    });
    box.addEventListener("click", function (e) {
      var l = e.target.closest && e.target.closest("a[data-cat]");
      if (!l) return;
      e.preventDefault();
      go({ v: "cat", c: l.getAttribute("data-cat") });
    });
    return box;
  }

  // Clicks inside rendered text: links, contents box, section edit, folding.
  function wireArticleBody(body, a) {
    body.addEventListener("click", function (e) {
      var n = e.target;
      if (!n.closest) return;
      var se = n.closest(".sec-edit");
      if (se) { e.preventDefault(); startEdit({ a: a.id, sec: Number(se.getAttribute("data-sec")) || 0 }); return; }
      var tl = n.closest("a[data-anchor]");
      if (tl) { e.preventDefault(); scrollToAnchor(tl.getAttribute("data-anchor")); return; }
      var cl = n.closest("a[data-cat]");
      if (cl) { e.preventDefault(); go({ v: "cat", c: cl.getAttribute("data-cat") }); return; }
      var wl = n.closest("a.wl");
      if (wl) { e.preventDefault(); follow(wl.getAttribute("data-to") || "", wl.getAttribute("data-frag") || ""); return; }
      var hd = n.closest(".sec > h2");
      if (hd && window.matchMedia && window.matchMedia("(max-width: 719px)").matches && !n.closest("a, button")) {
        var sec = hd.parentNode;
        sec.classList.toggle("closed");
        hd.setAttribute("aria-expanded", sec.classList.contains("closed") ? "false" : "true");
      }
    });
  }
  // Redirect notes are rendered outside .art-body; route their link too.
  function wirePageLinks() {
    $("page").addEventListener("click", function (e) {
      var n = e.target;
      if (!n.closest || n.closest(".art-body")) return;
      var wl = n.closest("a.wl[data-to]");
      if (wl) { e.preventDefault(); follow(wl.getAttribute("data-to"), wl.getAttribute("data-frag") || ""); }
    });
  }

  // ---------- 5. Editor ----------
  // opts: { a: id, sec: n } (existing), { title } (new), makeMain
  function startEdit(opts) {
    var w = curWiki();
    if (!w) return;
    var a = opts.a ? C.byId(data, opts.a) : null;
    var sec = a && opts.sec ? opts.sec : 0;
    var whole = !a || !opts.sec;
    var text = a ? (whole ? a.x : C.getSection(a.x, sec)) : "";
    if (text === null) { text = a.x; sec = 0; whole = true; }
    ed = {
      a: a ? a.id : "", w: w.id, sec: whole ? 0 : sec, whole: whole,
      base: a ? a.r : "", baseX: a ? a.x : "", baseT: a ? a.t : "",
      title: a ? a.t : C.cleanTitle(opts.title || ""), text: text, start: text, sum: "",
      makeMain: !!opts.makeMain, tab: "write", restored: false
    };
    ed.dirty = function () {
      var x = $("ed-text"), tt = $("ed-name");
      var cur = x ? x.value : ed.text, curT = tt ? tt.value : ed.title;
      return cur !== ed.start || (!ed.a && C.cleanTitle(curT) !== C.cleanTitle(opts.title || ""));
    };
    var dr = readDraft();
    if (dr && dr.w === ed.w && dr.a === ed.a && dr.sec === ed.sec && dr.base === ed.base &&
        (ed.a || C.fold(dr.t) === C.fold(ed.title) || !ed.title) && dr.x !== ed.start) {
      ed.text = dr.x; ed.sum = dr.s || ""; if (!ed.a && dr.t) ed.title = dr.t;
      ed.restored = true;
    }
    go({ v: "edit" });
  }

  function renderEditor(page) {
    if (!ed) { goMain({ replace: true, force: true }); return; }
    var a = ed.a ? C.byId(data, ed.a) : null;
    if (ed.a && !a) { ed = null; goMain({ replace: true, force: true }); return; }
    var box = el("div", "ed");
    if (a) box.appendChild(artTabs(a, "edit"));
    pageHead(box, a ? t(ed.whole ? "ed.title" : "ed.titleSec", { t: a.t }) : t("ed.new"));
    if (a && a.r !== ed.base) box.appendChild(el("p", "note", t("ed.changed")));
    if (!a) {
      var nl = el("label", "fld");
      nl.appendChild(el("span", "lbl", t("ed.name")));
      var ni = el("input");
      ni.id = "ed-name";
      ni.maxLength = 200;
      ni.autocomplete = "off";
      ni.value = ed.title;
      ni.addEventListener("input", saveDraftSoon);
      nl.appendChild(ni);
      box.appendChild(nl);
    }
    var tabs = el("div", "ed-tabs");
    tabs.setAttribute("role", "tablist");
    var tw = btn("ed-tab", t("ed.write"), function () { edTab("write"); });
    var tp = btn("ed-tab", t("ed.preview"), function () { edTab("preview"); });
    tw.id = "ed-tw"; tp.id = "ed-tp";
    tw.setAttribute("role", "tab"); tp.setAttribute("role", "tab");
    tabs.appendChild(tw); tabs.appendChild(tp);
    box.appendChild(tabs);
    box.appendChild(toolbar());
    var ta = el("textarea", "ed-text");
    ta.id = "ed-text";
    ta.spellcheck = true;
    ta.value = ed.text;
    ta.setAttribute("aria-label", t("ed.write"));
    ta.addEventListener("input", saveDraftSoon);
    ta.addEventListener("keydown", edKeys);
    box.appendChild(ta);
    var pv = el("div", "art-body ed-prev");
    pv.id = "ed-prev";
    pv.hidden = true;
    box.appendChild(pv);
    pv.addEventListener("click", function (e) { if (e.target.closest && e.target.closest("a")) e.preventDefault(); });
    var sl = el("label", "fld");
    sl.appendChild(el("span", "lbl", t("ed.sum")));
    var si = el("input");
    si.id = "ed-sum";
    si.maxLength = C.MAX_SUM;
    si.placeholder = t("ed.sumPh");
    si.value = ed.sum;
    si.addEventListener("input", saveDraftSoon);
    si.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); saveEdit(); } });
    sl.appendChild(si);
    box.appendChild(sl);
    var act = el("div", "actions");
    act.appendChild(btn("chip primary", t("ed.save"), saveEdit));
    act.appendChild(btn("chip", t("ed.cancel"), cancelEdit));
    box.appendChild(act);
    var help = el("details", "cheat");
    help.appendChild(el("summary", null, t("ed.help")));
    var ul = el("ul");
    t("cheat").forEach(function (line) { ul.appendChild(el("li", null, line)); });
    help.appendChild(ul);
    box.appendChild(help);
    page.appendChild(box);
    edTab(ed.tab);
    if (ed.restored) { ed.restored = false; toast(t("ed.restored")); }
    setTimeout(function () { (a ? ta : $("ed-name")).focus(); }, 0);
  }
  function edTab(k) {
    ed.tab = k;
    var pv = $("ed-prev"), ta = $("ed-text"), tb = document.querySelector(".tb");
    var prev = k === "preview";
    $("ed-tw").classList.toggle("on", !prev); $("ed-tw").setAttribute("aria-selected", prev ? "false" : "true");
    $("ed-tp").classList.toggle("on", prev); $("ed-tp").setAttribute("aria-selected", prev ? "true" : "false");
    ta.hidden = prev; tb.hidden = prev; pv.hidden = !prev;
    if (prev) {
      pv.textContent = "";
      var p = C.parseDoc(ta.value);
      if (!ta.value.trim()) pv.appendChild(el("p", "hint", t("art.empty")));
      else pv.appendChild(C.render(document, p, { state: linkState, toc: t("art.toc") }));
      if (p.cats.length) pv.appendChild(catsBox(p.cats));
    }
  }

  var TOOLS = [
    ["b", "B", function () { wrap("**", "**", ""); }],
    ["i", "I", function () { wrap("*", "*", ""); }],
    ["s", "S", function () { wrap("~~", "~~", ""); }],
    ["h2", "H2", function () { linePrefix("## ", true); }],
    ["h3", "H3", function () { linePrefix("### ", true); }],
    ["ul", "•", function () { linePrefix("- "); }],
    ["ol", "1.", function () { linePrefix("1. "); }],
    ["link", "[[ ]]", function () { wrap("[[", "]]", t("tb.linkPh")); }],
    ["xlink", "🔗", function () { wrap("[", "](https://)", t("tb.xlinkPh")); }],
    ["table", "▦", function () { insertBlock("| " + t("tb.col") + " | " + t("tb.col") + " |\n|---|---|\n|  |  |\n"); }],
    ["code", "</>", function () { codeTool(); }],
    ["quote", "❝", function () { linePrefix("> "); }],
    ["cat", "#", function () { insertBlock("[[" + (LANG === "el" ? "Κατηγορία" : "Category") + ":" + t("tb.catPh") + "]]\n", true); }]
  ];
  function toolbar() {
    var bar = el("div", "tb");
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", t("ed.write"));
    TOOLS.forEach(function (tool) {
      var b = btn("tb-btn tb-" + tool[0], tool[1], function () { tool[2](); $("ed-text").focus(); saveDraftSoon(); });
      setLabel(b, t("tb." + tool[0]));
      b.addEventListener("mousedown", function (e) { e.preventDefault(); });   // keep the selection
      bar.appendChild(b);
    });
    return bar;
  }
  function wrap(pre, post, placeholder) {
    var ta = $("ed-text"), s = ta.selectionStart, e = ta.selectionEnd, v = ta.value;
    var sel = v.slice(s, e) || placeholder;
    ta.setRangeText(pre + sel + post, s, e, "end");
    if (s === e && placeholder) ta.setSelectionRange(s + pre.length, s + pre.length + sel.length);
  }
  function linePrefix(prefix, single) {
    var ta = $("ed-text"), v = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
    var ls = v.lastIndexOf("\n", s - 1) + 1, le = v.indexOf("\n", e);
    if (le < 0) le = v.length;
    var lines = v.slice(ls, le).split("\n");
    if (single) lines = [lines.join(" ")];
    var out = lines.map(function (l, i) {
      var bare = l.replace(/^(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s?)/, "");
      var p = prefix === "1. " ? (i + 1) + ". " : prefix;
      return l.indexOf(p) === 0 ? bare : p + bare;
    }).join("\n");
    ta.setRangeText(out, ls, le, "end");
  }
  function insertBlock(block, atEnd) {
    var ta = $("ed-text"), v = ta.value;
    if (atEnd) {
      var add = (v && !/\n$/.test(v) ? "\n" : "") + (v ? "\n" : "") + block;
      ta.setRangeText(add, v.length, v.length, "end");
      return;
    }
    var s = ta.selectionStart;
    var before = v.slice(0, s), lead = !before || /\n\n$/.test(before) ? "" : (/\n$/.test(before) ? "\n" : "\n\n");
    ta.setRangeText(lead + block + "\n", s, ta.selectionEnd, "end");
  }
  function codeTool() {
    var ta = $("ed-text"), sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
    if (sel.indexOf("\n") >= 0) insertBlock("```\n" + sel.replace(/\n$/, "") + "\n```");
    else wrap("`", "`", "code");
  }
  function edKeys(e) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    var k = e.code;
    if (k === "KeyB" && !e.shiftKey) { e.preventDefault(); wrap("**", "**", ""); saveDraftSoon(); }
    else if (k === "KeyI" && !e.shiftKey) { e.preventDefault(); wrap("*", "*", ""); saveDraftSoon(); }
    else if (k === "KeyK" && !e.shiftKey) { e.preventDefault(); wrap("[[", "]]", t("tb.linkPh")); saveDraftSoon(); }
  }

  function readDraft() {
    try {
      var d = JSON.parse(localStorage.getItem(C.DRAFT_KEY) || "null");
      if (!d || typeof d !== "object" || typeof d.x !== "string") return null;
      return { w: String(d.w || ""), a: String(d.a || ""), sec: Number(d.sec) || 0, base: String(d.base || ""),
               t: String(d.t || ""), x: d.x, s: String(d.s || "") };
    } catch (e) { return null; }
  }
  function saveDraftSoon() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, 400);
  }
  function saveDraft() {
    if (!ed || !$("ed-text")) return;
    var d = { w: ed.w, a: ed.a, sec: ed.sec, base: ed.base, t: $("ed-name") ? $("ed-name").value : ed.title,
              x: $("ed-text").value, s: $("ed-sum").value };
    try { localStorage.setItem(C.DRAFT_KEY, JSON.stringify(d)); } catch (e) {}
  }
  function clearDraft() {
    clearTimeout(draftTimer);
    try { localStorage.removeItem(C.DRAFT_KEY); } catch (e) {}
  }

  function cancelEdit() {
    if (ed && ed.dirty()) {
      ask(t("ask.discard"), t("btn.discard"), function () { clearDraft(); var a = ed.a; ed = null; leaveEditor(a); });
      return;
    }
    clearDraft();
    var a2 = ed ? ed.a : "";
    ed = null;
    leaveEditor(a2);
  }
  function leaveEditor(aid) {
    var a = aid && C.byId(data, aid);
    if (stack.length) { view = stack.pop(); render(); return; }
    if (a) { view = { v: "art", a: a.id }; render(); return; }
    goMain();
  }

  function saveEdit() {
    if (!ed) return;
    var w = C.wikiById(data, ed.w);
    if (!w) { goMain(); return; }
    var text = $("ed-text").value.replace(/\r\n?/g, "\n");
    var sum = $("ed-sum").value.replace(/\s+/g, " ").trim();
    var cur = ed.a ? C.byId(data, ed.a) : null;
    if (ed.a && !cur) { toast(t("toast.saveFail")); return; }
    var full = text;
    if (cur && !ed.whole) {
      // splice the section into the text the editing started from
      full = C.setSection(ed.baseX, ed.sec, text);
      if (full === null) full = text;
    }
    if (full.length > C.MAX_TEXT) { toast(t("err.long")); return; }
    if (!cur) {
      var title = C.cleanTitle($("ed-name").value);
      if (!title) { toast(t("err.title")); $("ed-name").focus(); return; }
      if (idx()[C.fold(title)]) { toast(t("err.exists")); $("ed-name").focus(); return; }
      if (C.live(data, w.id).length >= C.MAX_ARTS) { toast(t("err.full")); return; }
      var m = now();
      var art = C.normArt({ id: C.uid("a"), m: m, w: w.id, t: title, x: full, r: C.uid("r"), anc: [], alt: [], s: sum || t("sum.new"), c: m });
      data.arts.push(art);
      if (ed.makeMain || !w.main || !C.byId(data, w.main)) { w.main = art.id; w.m = now(w.m); }
      if (!persist()) return;
      writeRev(art, "");
      clearDraft();
      ed = null;
      toast(t("toast.saved"));
      view = null;
      openArt(art);
      return;
    }
    if (full === cur.x && cur.r === ed.base) {
      clearDraft();
      ed = null;
      toast(t("toast.nochange"));
      leaveEditor(cur.id);
      return;
    }
    var next = saveRevision(cur, { x: full, s: sum, base: ed.base, baseT: ed.baseT, baseX: ed.baseX });
    if (!next) return;
    clearDraft();
    ed = null;
    toast(t("toast.saved"));
    if (stack.length && stack[stack.length - 1].v === "art" && stack[stack.length - 1].a === next.id) { view = stack.pop(); render(); }
    else { view = null; openArt(next); }
  }

  // A new revision of `cur`. fields: { x, t?, s, base?, baseT?, baseX?, resolve? }
  // When the article changed since `base`, the version now stored is
  // kept as a parallel edit (alt), so nothing is lost.
  function saveRevision(cur, f) {
    var base = f.base || cur.r;
    var alt = cur.alt.slice();
    var anc = [base].concat(cur.anc);
    if (cur.r !== base) {
      alt.push({ r: cur.r, m: cur.m, t: cur.t, x: cur.x });
    } else {
      anc = [cur.r].concat(cur.anc);
    }
    if (f.resolve) {
      // every parallel version shown to the person is now settled
      alt.forEach(function (v) { anc.unshift(v.r); });
      alt = [];
    }
    var next = C.normArt({
      id: cur.id, m: now(cur.m), w: cur.w, t: f.t || cur.t, x: f.x, r: C.uid("r"),
      anc: anc, alt: alt, s: f.s || "", c: cur.c
    });
    data.arts = data.arts.map(function (x) { return x.id === cur.id ? next : x; });
    if (!persist()) return null;
    writeRev(next, cur.r);
    return next;
  }
  function writeRev(art, prev) {
    var F = fsApi();
    if (!F || typeof F.writeText !== "function") return;
    F.writeText(C.revPath(art.id, art.m, art.r), JSON.stringify(C.revFile(art, prev, "")))
      .catch(function () { toast(t("toast.histFail")); });
  }

  // ---------- 6. History + parallel edits ----------
  var revCache = {};   // path → parsed revision
  function listRevs(aid) {
    var F = fsApi();
    if (!F || typeof F.ls !== "function") return Promise.reject(new Error("nofs"));
    return F.ls(C.revDir(aid)).catch(function (e) {
      if (e && e.code === "ENOENT") return [];
      throw e;
    }).then(function (list) {
      var revs = [];
      (list || []).forEach(function (it) {
        if (!it || it.dir) return;
        var p = C.parseRevName(it.name);
        if (p) revs.push({ m: p.m, r: p.r, path: C.revDir(aid) + "/" + it.name });
      });
      revs.sort(function (a, b) { return b.m - a.m || (a.r < b.r ? 1 : -1); });
      return revs.slice(0, 300);
    });
  }
  function readRev(path) {
    if (revCache[path]) return Promise.resolve(revCache[path]);
    var F = fsApi();
    if (!F) return Promise.reject(new Error("nofs"));
    return F.readText(path).then(function (txt) {
      var r = C.parseRevFile(txt);
      if (r) revCache[path] = r;
      return r;
    });
  }

  function renderHistory(page) {
    var a = C.byId(data, view.a);
    if (!a) { goMain({ replace: true, force: true }); return; }
    var box = el("div", "hist");
    box.appendChild(artTabs(a, "history"));
    pageHead(box, t("hist.title", { t: a.t }));
    var ul = el("ul", "hist-list");
    box.appendChild(ul);
    var info = el("p", "hint small", t("hist.loading"));
    box.appendChild(info);
    page.appendChild(box);
    var token = view;
    listRevs(a.id).then(function (revs) {
      if (view !== token) return;
      var hasCur = revs.some(function (r) { return r.r === a.r; });
      var rows = revs.slice();
      if (!hasCur) rows.unshift({ m: a.m, r: a.r, path: "", cur: true });
      return Promise.all(rows.map(function (r) {
        if (!r.path) return Promise.resolve({ a: a.id, r: a.r, m: a.m, t: a.t, x: a.x, s: a.s || "" });
        return readRev(r.path).catch(function () { return null; });
      })).then(function (full) {
        if (view !== token) return;
        var list = full.filter(Boolean);
        info.textContent = revs.length ? t("hist.later") : t("hist.none") + " " + t("hist.later");
        list.forEach(function (rv, i) {
          var isCur = rv.r === a.r;
          var prev = list[i + 1] || null;
          var li = el("li", "hist-row" + (isCur ? " cur" : ""));
          var top = el("div", "hist-top");
          top.appendChild(el("span", "hist-date", fmtDate(rv.m)));
          if (isCur) top.appendChild(el("span", "badge", t("hist.cur")));
          li.appendChild(top);
          li.appendChild(el("div", "hist-sum" + (rv.s ? "" : " dim"), rv.s || t("hist.noSum")));
          var acts = el("div", "chips");
          if (!isCur) acts.appendChild(btn("chip small", t("hist.view"), function () { go({ v: "rev", a: a.id, rev: rv }); }));
          if (prev) acts.appendChild(btn("chip small", t("hist.diff"), function () {
            go({ v: "diff", a: a.id, l: { t: prev.t, x: prev.x, m: prev.m }, r: { t: rv.t, x: rv.x, m: rv.m } });
          }));
          if (!isCur) {
            acts.appendChild(btn("chip small", t("hist.diffCur"), function () {
              var c = C.byId(data, a.id);
              if (c) go({ v: "diff", a: a.id, l: { t: rv.t, x: rv.x, m: rv.m }, r: { t: c.t, x: c.x, m: c.m } });
            }));
            acts.appendChild(btn("chip small", t("hist.restore"), function () { restoreRev(a.id, rv); }));
          }
          li.appendChild(acts);
          ul.appendChild(li);
        });
      });
    }).catch(function () {
      if (view !== token) return;
      info.textContent = t("hist.nofs");
    });
  }

  function renderRevision(page) {
    var a = C.byId(data, view.a), rv = view.rev;
    if (!a || !rv) { goMain({ replace: true, force: true }); return; }
    var art = el("article", "art");
    art.appendChild(artTabs(a, "history"));
    art.appendChild(el("h1", "art-title", rv.t || a.t));
    var note = el("div", "note");
    note.appendChild(el("span", null, t("hist.old", { d: fmtDate(rv.m) }) + " "));
    var acts = el("span", "chips inline");
    acts.appendChild(btn("chip small", t("hist.backCur"), function () { openArt(a); }));
    acts.appendChild(btn("chip small primary", t("hist.restore"), function () { restoreRev(a.id, rv); }));
    note.appendChild(acts);
    art.appendChild(note);
    var body = el("div", "art-body");
    var parsed = C.parseDoc(rv.x);
    body.appendChild(C.render(document, parsed, { state: linkState, toc: t("art.toc") }));
    art.appendChild(body);
    if (parsed.cats.length) art.appendChild(catsBox(parsed.cats));
    page.appendChild(art);
    wireArticleBody(body, a);
  }

  function restoreRev(aid, rv) {
    var cur = C.byId(data, aid);
    if (!cur) return;
    var title = rv.t && !clash(rv.t, cur) ? rv.t : cur.t;
    if (rv.x === cur.x && title === cur.t) { toast(t("toast.nochange")); return; }
    var next = saveRevision(cur, { x: rv.x, t: title, s: t("hist.restored", { d: fmtDate(rv.m) }) });
    if (!next) return;
    toast(t("toast.saved"));
    view = null;
    openArt(next);
  }
  function clash(title, self) {
    var hit = idx()[C.fold(title)];
    return !!hit && (!self || hit.id !== self.id);
  }

  function conflictBox(a) {
    var alt = a.alt[a.alt.length - 1];
    var box = el("div", "conflict");
    box.appendChild(el("p", null, a.alt.length > 1 ? t("art.conflictN", { n: a.alt.length + 1 }) : t("art.conflict", { d: fmtDate(alt.m) })));
    var acts = el("div", "chips");
    acts.appendChild(btn("chip small", t("btn.compare"), function () {
      go({ v: "diff", a: a.id, l: { t: alt.t, x: alt.x, m: alt.m, other: 1 }, r: { t: a.t, x: a.x, m: a.m } });
    }));
    acts.appendChild(btn("chip small", t("btn.keepMine"), function () { resolveAlt(a, null); }));
    acts.appendChild(btn("chip small", t("btn.useOther"), function () { resolveAlt(a, alt); }));
    box.appendChild(acts);
    return box;
  }
  // Keep the shown text (other = null) or take the other version.
  // Either way both versions stay in the history files.
  function resolveAlt(a, other) {
    var cur = C.byId(data, a.id);
    if (!cur) return;
    // the parallel version becomes a history file too, so "keep" never loses it
    cur.alt.forEach(function (v) { writeRev({ id: cur.id, w: cur.w, r: v.r, m: v.m, t: v.t, x: v.x, s: "" }, ""); });
    var title = other && other.t && !clash(other.t, cur) ? other.t : cur.t;
    var next = saveRevision(cur, { x: other ? other.x : cur.x, t: title, s: t(other ? "sum.useOther" : "sum.keep"), resolve: true });
    if (!next) return;
    toast(t("toast.resolved"));
    view = null;
    openArt(next);
  }

  function renderDiff(page) {
    var a = C.byId(data, view.a), L = view.l, R = view.r;
    if (!a || !L || !R) { goMain({ replace: true, force: true }); return; }
    var box = el("div", "diff-view");
    box.appendChild(artTabs(a, "history"));
    pageHead(box, t("diff.title") + ": " + a.t);
    var meta = el("div", "diff-meta");
    meta.appendChild(el("span", "d-del-lbl", L.other ? t("diff.other") + " · " + fmtDate(L.m) : t("diff.from", { d: fmtDate(L.m) })));
    meta.appendChild(el("span", "d-add-lbl", t("diff.to", { d: fmtDate(R.m) })));
    box.appendChild(meta);
    if (L.t && R.t && L.t !== R.t) box.appendChild(el("p", "note", t("diff.titleChanged", { a: L.t, b: R.t })));
    var rows = C.diffText(L.x, R.x), st = C.diffStats(rows);
    if (!st.add && !st.del) {
      box.appendChild(el("p", "hint", t("diff.same")));
    } else {
      box.appendChild(el("p", "hint small", t("diff.stats", { a: st.add, d: st.del })));
      var tbl = el("div", "diff");
      C.diffContext(rows, 2).forEach(function (r) {
        if (r.op === "gap") { tbl.appendChild(el("div", "d-gap", tn("diff.gap", r.n))); return; }
        var line = el("div", "d-line " + (r.op === "+" ? "d-add" : r.op === "-" ? "d-del" : "d-eq"));
        line.appendChild(el("span", "d-sign", r.op === "=" ? " " : (r.op === "+" ? "+" : "−")));
        var txt = el("span", "d-text");
        if (r.parts) {
          r.parts.forEach(function (p) {
            if (p.op === "=") txt.appendChild(document.createTextNode(p.v));
            else txt.appendChild(el(p.op === "+" ? "ins" : "del", null, p.v));
          });
        } else txt.textContent = r.v || " ";
        line.appendChild(txt);
        tbl.appendChild(line);
      });
      box.appendChild(tbl);
    }
    page.appendChild(box);
  }

  // ---------- 7. Lists ----------
  function artLink(a, text) {
    var l = el("a", "wl", text || a.t);
    l.href = "#";
    l.addEventListener("click", function (e) { e.preventDefault(); openArt(a); });
    return l;
  }
  function artList(list, sub) {
    var ul = el("ul", "list");
    list.forEach(function (a) {
      var li = el("li");
      li.appendChild(artLink(a));
      var extra = sub ? sub(a) : "";
      if (extra) li.appendChild(el("span", "dim", " · " + extra));
      ul.appendChild(li);
    });
    return ul;
  }
  // Grouped by first letter (A–Z lists and category pages).
  function letterList(list) {
    var box = el("div", "letters"), cur = null, ul = null;
    list.forEach(function (a) {
      var f = C.fold(a.t).charAt(0).toUpperCase() || "#";
      if (!/[\p{L}]/u.test(f)) f = "#";
      if (f !== cur) {
        cur = f;
        var grp = el("section", "letter");
        grp.appendChild(el("h2", "letter-h", f));
        ul = el("ul", "list");
        grp.appendChild(ul);
        box.appendChild(grp);
      }
      var li = el("li");
      li.appendChild(artLink(a));
      if (C.info(a).redirect) li.appendChild(el("span", "dim", " → " + C.info(a).redirect));
      ul.appendChild(li);
    });
    return box;
  }

  function renderRecent(page) {
    pageHead(page, t("recent.title"));
    var list = C.live(data, curWiki().id).sort(function (a, b) { return b.m - a.m || (a.id < b.id ? -1 : 1); }).slice(0, 150);
    if (!list.length) { page.appendChild(el("p", "hint", t("recent.none"))); return; }
    var day = "", ul = null;
    list.forEach(function (a) {
      var d = fmtDay(a.m);
      if (d !== day) {
        day = d;
        page.appendChild(el("h2", "pg-h2", d));
        ul = el("ul", "list recent");
        page.appendChild(ul);
      }
      var li = el("li");
      var tm = "";
      try { tm = new Date(a.m).toLocaleTimeString(LANG === "el" ? "el-GR" : "en-GB", { hour: "2-digit", minute: "2-digit" }); } catch (e) {}
      li.appendChild(el("span", "dim", tm + " "));
      li.appendChild(artLink(a));
      if (a.c && a.c === a.m) li.appendChild(el("span", "badge", t("recent.new")));
      if (a.s) li.appendChild(el("span", "dim", " · " + a.s));
      ul.appendChild(li);
    });
  }

  function renderAll(page) {
    pageHead(page, t("all.title"));
    var list = C.live(data, curWiki().id).sort(C.byTitle);
    if (!list.length) { page.appendChild(el("p", "hint", t("all.none"))); return; }
    var f = el("input", "filter");
    f.type = "search";
    f.placeholder = t("all.filter");
    f.setAttribute("aria-label", t("all.filter"));
    page.appendChild(f);
    var holder = el("div");
    page.appendChild(holder);
    function draw() {
      var q = C.fold(f.value);
      holder.textContent = "";
      holder.appendChild(letterList(q ? list.filter(function (a) { return C.fold(a.t).indexOf(q) >= 0; }) : list));
    }
    f.addEventListener("input", draw);
    draw();
  }

  function renderCats(page) {
    pageHead(page, t("cats.title"));
    var cats = C.categories(data, curWiki().id);
    if (!cats.length) { page.appendChild(el("p", "hint", t("cats.none"))); return; }
    var ul = el("ul", "list");
    cats.forEach(function (c) {
      var li = el("li"), l = el("a", "wl cat", c.name);
      l.href = "#";
      l.addEventListener("click", function (e) { e.preventDefault(); go({ v: "cat", c: c.name }); });
      li.appendChild(l);
      li.appendChild(el("span", "dim", " · " + tn("cats.count", c.arts.length)));
      ul.appendChild(li);
    });
    page.appendChild(ul);
  }
  function renderCat(page) {
    pageHead(page, t("cat.title", { t: view.c }));
    var c = C.categories(data, curWiki().id).filter(function (x) { return C.fold(x.name) === C.fold(view.c); })[0];
    if (!c) { page.appendChild(el("p", "hint", t("cat.none"))); return; }
    page.appendChild(letterList(c.arts));
  }

  function renderWanted(page) {
    pageHead(page, t("wanted.title"));
    var list = C.wanted(data, curWiki().id);
    if (!list.length) { page.appendChild(el("p", "hint", t("wanted.none"))); return; }
    var ul = el("ul", "list");
    list.slice(0, 300).forEach(function (wt) {
      var li = el("li"), l = el("a", "wl new", wt.title);
      l.href = "#";
      l.addEventListener("click", function (e) { e.preventDefault(); startEdit({ title: wt.title }); });
      li.appendChild(l);
      li.appendChild(el("span", "dim", " · " + tn("wanted.from", wt.n)));
      ul.appendChild(li);
    });
    page.appendChild(ul);
  }

  function renderLinks(page) {
    var a = C.byId(data, view.a);
    if (!a) { goMain({ replace: true, force: true }); return; }
    pageHead(page, t("links.title", { t: a.t }));
    var list = C.backlinks(data, a.w, a);
    if (!list.length) { page.appendChild(el("p", "hint", t("links.none"))); return; }
    page.appendChild(artList(list, function (x) { return C.info(x).redirect ? t("links.redir") : ""; }));
  }

  function renderSearch(page) {
    var q = view.q || "";
    pageHead(page, t("search.title", { q: q }));
    if (C.fold(q).length < 2) { page.appendChild(el("p", "hint", t("search.short"))); return; }
    var w = curWiki(), title = C.cleanTitle(q);
    if (title && !idx()[C.fold(title)]) {
      var mk = el("p", "make");
      var l = el("a", "wl new", t("search.make", { t: title }));
      l.href = "#";
      l.addEventListener("click", function (e) { e.preventDefault(); startEdit({ title: title }); });
      mk.appendChild(l);
      page.appendChild(mk);
    }
    var hits = C.search(data, w.id, q, 100);
    if (!hits.length) { page.appendChild(el("p", "hint", t("search.none"))); return; }
    var ul = el("ul", "list results");
    hits.forEach(function (a) {
      var li = el("li");
      li.appendChild(artLink(a));
      var sn = C.snippet(a.x, 200);
      if (sn) li.appendChild(el("div", "snip", sn));
      ul.appendChild(li);
    });
    page.appendChild(ul);
  }

  // Search field with title suggestions.
  var suggItems = [], suggOn = -1;
  function onSearchInput() {
    var w = curWiki(), q = $("q").value;
    if (!w || !q.trim()) { hideSugg(); return; }
    suggItems = C.suggest(data, w.id, q, 8);
    suggOn = -1;
    var ul = $("sugg");
    ul.textContent = "";
    suggItems.forEach(function (a, i) {
      var li = el("li", "sugg-item", a.t);
      li.id = "sugg-" + i;
      li.setAttribute("role", "option");
      li.addEventListener("mousedown", function (e) { e.preventDefault(); pickSugg(i); });
      ul.appendChild(li);
    });
    var all = el("li", "sugg-item all", t("search.title", { q: q.trim() }));
    all.id = "sugg-" + suggItems.length;
    all.setAttribute("role", "option");
    all.addEventListener("mousedown", function (e) { e.preventDefault(); runSearch(); });
    ul.appendChild(all);
    ul.hidden = false;
    $("q").setAttribute("aria-expanded", "true");
  }
  function hideSugg() {
    $("sugg").hidden = true;
    $("q").setAttribute("aria-expanded", "false");
    $("q").removeAttribute("aria-activedescendant");
    suggOn = -1;
  }
  function moveSugg(d) {
    var n = suggItems.length + 1;
    if ($("sugg").hidden) return;
    suggOn = (suggOn + d + n + 1) % (n + 1) - 1;
    if (suggOn < -1) suggOn = n - 1;
    [].forEach.call($("sugg").children, function (li, i) { li.classList.toggle("on", i === suggOn); });
    if (suggOn >= 0) $("q").setAttribute("aria-activedescendant", "sugg-" + suggOn);
    else $("q").removeAttribute("aria-activedescendant");
  }
  function pickSugg(i) {
    var a = suggItems[i];
    hideSugg();
    if (!a) { runSearch(); return; }
    $("q").value = "";
    $("q").blur();
    openArt(a);
  }
  function runSearch() {
    var w = curWiki(), q = $("q").value.trim();
    hideSugg();
    if (!w || !q) return;
    var hit = idx()[C.fold(C.cleanTitle(q))];
    $("q").blur();
    if (hit) { $("q").value = ""; var r = C.resolve(data, w.id, hit.t); openArt(r.art || hit, { from: r.from ? r.from.id : "" }); return; }
    go({ v: "search", q: q });
  }

  // ---------- 8. Wikis + article actions ----------
  function createWiki(name, withMain) {
    name = String(name || "").replace(/\s+/g, " ").trim().slice(0, 80);
    if (!name) return false;
    if (data.wikis.length >= C.MAX_WIKIS) { toast(t("err.wikis")); return false; }
    var m = now(), w = { id: C.uid("w"), m: m, n: name, main: "" };
    if (withMain) {
      var art = C.normArt({ id: C.uid("a"), m: m, w: w.id, t: t("main.title"), x: C.welcomeText(LANG), r: C.uid("r"), anc: [], alt: [], s: t("sum.new"), c: m });
      data.arts.push(art);
      w.main = art.id;
    }
    data.wikis.push(w);
    if (!persist()) return false;
    prefs.w = w.id; savePrefs();
    stack = [];
    view = null;
    goMain();
    return true;
  }
  function renameWiki() {
    var w = curWiki();
    if (!w) return;
    prompt2({ title: t("wikiRen.title"), label: t("wikiNew.lbl"), value: w.n, ok: t("wikiRen.ok") }, function (v) {
      v = v.replace(/\s+/g, " ").trim().slice(0, 80);
      if (!v) return t("err.name");
      w.n = v; w.m = now(w.m);
      persist();
      render();
      return "";
    });
  }
  function deleteWiki() {
    var w = curWiki();
    if (!w) return;
    var arts = C.live(data, w.id);
    var msg = arts.length === 1 ? t("ask.delWiki1", { t: wikiName(w) }) : t("ask.delWiki", { t: wikiName(w), n: arts.length });
    ask(msg, t("btn.delete"), function () {
      var m = now(w.m);
      arts.forEach(function (a) { data.tombs[a.id] = Math.max(m, a.m); });
      data.tombs[w.id] = Math.max(m, w.m);
      data.arts = data.arts.filter(function (a) { return a.w !== w.id; });
      data.wikis = data.wikis.filter(function (x) { return x.id !== w.id; });
      persist();
      prefs.w = ""; prefs.a = ""; savePrefs();
      stack = [];
      view = null;
      toast(t("toast.wikiDeleted"));
      goMain();
    });
  }
  function switchWiki(id) {
    if (!C.wikiById(data, id)) return;
    prefs.w = id; prefs.a = ""; savePrefs();
    stack = [];
    view = null;
    goMain();
  }

  function openArtMenu(a) {
    var w = curWiki();
    var items = [
      [t("menu.rename"), function () { renameArt(a); }],
      [t("menu.links"), function () { go({ v: "links", a: a.id }); }],
      [t("menu.copy"), function () { copyText(a.x); }]
    ];
    if (w && w.main !== a.id) items.push([t("menu.main"), function () { w.main = a.id; w.m = now(w.m); persist(); toast(t("toast.main")); render(); }]);
    items.push([t("menu.del"), function () { deleteArt(a); }, "danger"]);
    var list = $("menu-list");
    list.textContent = "";
    $("menu-title").textContent = a.t;
    items.forEach(function (it) {
      list.appendChild(btn("menu-item" + (it[2] ? " " + it[2] : ""), it[0], function () { hideDlg(); it[1](); }));
    });
    showDlg("menu");
  }
  function renameArt(a) {
    prompt2({ title: t("ren.title"), label: t("ren.lbl"), value: a.t, ok: t("ren.ok"), check: t("ren.redirect"), checked: true }, function (v, chk) {
      var cur = C.byId(data, a.id);
      if (!cur) return "";
      var title = C.cleanTitle(v);
      if (!title) return t("err.title");
      if (title === cur.t) return "";
      if (clash(title, cur)) return t("err.exists");
      var old = cur.t;
      var next = saveRevision(cur, { x: cur.x, t: title, s: t("ren.sum", { t: old }) });
      if (!next) return "";
      if (chk && !clash(old, next)) {
        var m = now();
        var red = C.normArt({ id: C.uid("a"), m: m, w: next.w, t: old, x: "#REDIRECT [[" + title + "]]\n", r: C.uid("r"), anc: [], alt: [], s: t("ren.redirSum", { t: title }), c: m });
        data.arts.push(red);
        if (persist()) writeRev(red, "");
      }
      view = null;
      openArt(next);
      return "";
    });
  }
  function deleteArt(a) {
    ask(t("ask.delArt", { t: a.t }), t("btn.delete"), function () {
      var cur = C.byId(data, a.id);
      if (!cur) return;
      var stamp = now(cur.m);
      data.tombs[cur.id] = stamp;
      data.arts = data.arts.filter(function (x) { return x.id !== cur.id; });
      persist();
      stack = stack.filter(function (v) { return v.a !== cur.id; });
      view = null;
      goMain();
      toast(t("toast.deleted"), t("btn.undo"), function () {
        // the article comes back newer than its tombstone
        var back2 = C.normArt(Object.assign({}, cur, { m: now(stamp) }));
        delete data.tombs[cur.id];
        data.arts.push(back2);
        persist();
        view = null;
        openArt(back2);
      });
    });
  }
  function copyText(text) {
    try {
      navigator.clipboard.writeText(text).then(function () { toast(t("toast.copied")); }, function () { toast(t("toast.copyFail")); });
    } catch (e) { toast(t("toast.copyFail")); }
  }
  function randomArt() {
    var w = curWiki();
    if (!w) return;
    var list = C.live(data, w.id).filter(function (a) { return !C.info(a).redirect && a.id !== (view && view.a); });
    if (!list.length) list = C.live(data, w.id);
    if (!list.length) { toast(t("toast.noRandom")); return; }
    var r = new Uint32Array(1);
    crypto.getRandomValues(r);
    openArt(list[r[0] % list.length]);
  }

  // ---------- Side menu ----------
  function renderSide() {
    var sel = $("wiki-sel");
    sel.textContent = "";
    data.wikis.slice().sort(function (a, b) { return wikiName(a).localeCompare(wikiName(b)); }).forEach(function (w) {
      var o = el("option", null, wikiName(w));
      o.value = w.id;
      sel.appendChild(o);
    });
    var w = curWiki();
    if (w) sel.value = w.id;
    sel.disabled = !w;
    $("wiki-ren").hidden = !w;
    $("wiki-del").hidden = !w;
    [].forEach.call(document.querySelectorAll(".nav-item[data-go]"), function (b) { b.disabled = !w; });
    var n = w ? C.live(data, w.id).length : 0;
    var kb = 0;
    try { kb = Math.ceil((localStorage.getItem(C.DATA_KEY) || "").length / 1024); } catch (e) {}
    $("side-stats").textContent = w ? (n === 1 ? t("side.stats1", { kb: kb }) : t("side.stats", { n: n, kb: kb })) : "";
  }
  function narrow() { return window.matchMedia && window.matchMedia("(max-width: 799px)").matches; }
  function toggleSide() {
    if (narrow()) {
      var open = !document.body.classList.contains("side-open");
      document.body.classList.toggle("side-open", open);
      $("side-scrim").hidden = !open;
      $("side-btn").setAttribute("aria-expanded", open ? "true" : "false");
      if (open) { var f = $("side").querySelector("select, button"); if (f) f.focus(); }
    } else {
      prefs.side = prefs.side ? 0 : 1; savePrefs();
      document.body.classList.toggle("side-hidden", !prefs.side);
      $("side-btn").setAttribute("aria-expanded", prefs.side ? "true" : "false");
    }
  }
  function closeSide(quiet) {
    if (!document.body.classList.contains("side-open")) return;
    document.body.classList.remove("side-open");
    $("side-scrim").hidden = true;
    $("side-btn").setAttribute("aria-expanded", "false");
    if (!quiet) $("side-btn").focus();
  }

  // ---------- 9. Dialogs, toast ----------
  var openDlg = null, lastFocus = null, askYes = null, promptCb = null, toastTimer = 0;
  function showDlg(id) {
    if (openDlg) hideDlg();
    lastFocus = document.activeElement;
    openDlg = $(id);
    $("scrim").hidden = false;
    openDlg.hidden = false;
    var f = openDlg.querySelector("input, .menu-item, button:not(.dlg-close)") || openDlg.querySelector("button");
    if (f) f.focus();
  }
  function hideDlg() {
    if (!openDlg) return;
    openDlg.hidden = true;
    $("scrim").hidden = true;
    openDlg = null;
    if (lastFocus && lastFocus.focus && document.contains(lastFocus)) try { lastFocus.focus(); } catch (e) {}
  }
  function ask(text, yes, fn) {
    $("ask-text").textContent = text;
    $("ask-yes").textContent = yes;
    askYes = fn;
    showDlg("ask");
  }
  // o: { title, label, value, ok, check?, checked? }; cb(value, checked) → error text or ""
  function prompt2(o, cb) {
    $("prompt-title").textContent = o.title;
    $("prompt-lbl").textContent = o.label;
    $("prompt-in").value = o.value || "";
    $("prompt-ok").textContent = o.ok;
    $("prompt-err").textContent = "";
    $("prompt-chk-row").hidden = !o.check;
    $("prompt-chk-lbl").textContent = o.check || "";
    $("prompt-chk").checked = !!o.checked;
    promptCb = cb;
    showDlg("prompt");
    $("prompt-in").select();
  }
  function promptOk() {
    if (!promptCb) return;
    var err = promptCb($("prompt-in").value, $("prompt-chk").checked);
    if (err) { $("prompt-err").textContent = err; $("prompt-in").focus(); return; }
    promptCb = null;
    hideDlg();
  }
  function toast(msg, actLabel, act) {
    var n = $("toast");
    n.textContent = "";
    n.appendChild(el("span", null, msg));
    if (actLabel && act) {
      var b = el("button", null, actLabel);
      b.type = "button";
      b.addEventListener("click", function () { n.classList.remove("show"); act(); });
      n.appendChild(b);
    }
    n.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { n.classList.remove("show"); }, actLabel ? 8000 : 3200);
  }

  // ---------- 10. Sync slice, palette, deep link ----------
  var PAL_VARS = ["--bg", "--bg-desktop", "--bar-bg", "--text", "--text-dim",
                  "--accent", "--accent-hover", "--accent-soft",
                  "--panel-bg", "--border", "--shadow", "--danger"];
  function inheritPalette() {
    try {
      var pRoot = window.parent.document.documentElement;
      document.documentElement.setAttribute("data-theme", pRoot.getAttribute("data-theme") || "dark");
      var cs = window.parent.getComputedStyle(pRoot);
      PAL_VARS.forEach(function (v) {
        var val = cs.getPropertyValue(v).trim();
        if (val) document.documentElement.style.setProperty(v, val);
      });
    } catch (e) { /* standalone */ }
  }
  function watchPalette() {
    try {
      new MutationObserver(inheritPalette).observe(window.parent.document.documentElement,
        { attributes: true, attributeFilter: ["data-skin", "data-theme"] });
    } catch (e) { /* standalone */ }
  }
  function syncApi() {
    try { return (window.parent && window.parent.orosSync) || window.orosSync || null; }
    catch (e) { return window.orosSync || null; }
  }
  function registerSync() {
    // LOCAL FIRST: load() has already run (boot order).
    var api = syncApi();
    window.__orosSyncApi = {
      _suppress: false,
      dirty: function () {
        if (this._suppress) return;
        if (api && typeof api.markDirty === "function") api.markDirty();
      }
    };
    if (!api || typeof api.registerSlice !== "function") return;
    api.registerSlice("wiki", sliceGet, sliceSet, C.DATA_KEY, C.merge);
  }
  function sliceGet() { return C.merge(data, null); }     // canonical copy (R26)
  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.arts)) return;
    var before = JSON.stringify(data);
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = C.merge(incoming, null);
      localStorage.setItem(C.DATA_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    if (JSON.stringify(data) === before) return;
    renderSide();
    // the editor stays as it is: saving keeps both versions if needed
    if (!view || view.v === "edit") return;
    if (view.v === "welcome" && data.wikis.length) { view = null; goMain(); return; }
    var keep = $("main").scrollTop;
    render();
    $("main").scrollTop = keep;
  }
  // Deep link (search hit): { a } opens that article (and its wiki).
  function openTarget(target) {
    if (!target || typeof target !== "object" || typeof target.a !== "string") return false;
    var a = C.byId(data, target.a);
    if (!a) return false;
    if (view && view.v === "edit" && ed && ed.dirty()) return false;
    hideDlg();
    ed = null;
    if (prefs.w !== a.w) { prefs.w = a.w; stack = []; }
    view = null;
    openArt(a);
    return true;
  }
  window.__orosOpenAt = openTarget;

  // ---------- 11. Wiring & boot ----------
  function applyI18n() {
    document.documentElement.lang = LANG;
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) { n.textContent = t(n.getAttribute("data-i18n")); });
    document.title = t("app.name") + " · orOS";
    $("side-btn").innerHTML = ICON.menu; setLabel($("side-btn"), t("btn.side"));
    $("back-btn").innerHTML = ICON.back; setLabel($("back-btn"), t("btn.back"));
    $("new-btn").innerHTML = ICON.plus; setLabel($("new-btn"), t("btn.new"));
    [].forEach.call(document.querySelectorAll(".dlg-close"), function (b) { b.innerHTML = ICON.close; setLabel(b, t("btn.close")); });
    $("q").placeholder = t("search.ph");
  }

  function wire() {
    wirePageLinks();
    $("side-btn").addEventListener("click", toggleSide);
    $("side-scrim").addEventListener("click", function () { closeSide(); });
    $("back-btn").addEventListener("click", back);
    $("new-btn").addEventListener("click", function () { if (curWiki()) startEdit({ title: "" }); });
    $("wiki-sel").addEventListener("change", function () { switchWiki($("wiki-sel").value); });
    [].forEach.call(document.querySelectorAll(".nav-item[data-go]"), function (b) {
      b.addEventListener("click", function () {
        var k = b.getAttribute("data-go");
        if (k === "main") goMain();
        else if (k === "random") randomArt();
        else go({ v: k });
      });
    });
    $("wiki-new").addEventListener("click", function () {
      closeSide(true);
      prompt2({ title: t("wikiNew.title"), label: t("wikiNew.lbl"), value: "", ok: t("wikiNew.ok") }, function (v) {
        if (!v.trim()) return t("err.name");
        hideDlg();
        createWiki(v, true);
        return "";
      });
    });
    $("wiki-ren").addEventListener("click", function () { closeSide(true); renameWiki(); });
    $("wiki-del").addEventListener("click", function () { closeSide(true); deleteWiki(); });
    $("q").addEventListener("input", onSearchInput);
    $("q").addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); moveSugg(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); moveSugg(-1); }
      else if (e.key === "Enter") { e.preventDefault(); if (suggOn >= 0) pickSugg(suggOn); else runSearch(); }
      else if (e.key === "Escape") { if (!$("sugg").hidden) { e.preventDefault(); e.stopPropagation(); hideSugg(); } }
    });
    $("q").addEventListener("blur", function () { setTimeout(hideSugg, 150); });
    $("prompt-ok").addEventListener("click", promptOk);
    $("prompt-no").addEventListener("click", function () { promptCb = null; hideDlg(); });
    $("prompt-in").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); promptOk(); } });
    $("ask-no").addEventListener("click", hideDlg);
    $("ask-yes").addEventListener("click", function () { var f = askYes; askYes = null; hideDlg(); if (f) f(); });
    $("scrim").addEventListener("click", hideDlg);
    [].forEach.call(document.querySelectorAll(".dlg-close"), function (b) { b.addEventListener("click", hideDlg); });
    // Contract Β: Ctrl+Alt+Shift belongs to the shell
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
      var p = null; try { p = window.parent; } catch (err) { return; }
      if (!(p && p !== window && p.orosShortcuts && typeof p.orosShortcuts.handle === "function")) return;
      if (p.orosShortcuts.handle(e)) e.stopPropagation();
    }, true);
    document.addEventListener("keydown", function (e) {
      if (e.ctrlKey && e.altKey && e.shiftKey) return;
      if (e.key === "Escape") {
        if (openDlg) { e.preventDefault(); hideDlg(); return; }
        if (document.body.classList.contains("side-open")) { e.preventDefault(); closeSide(); return; }
      }
      if (openDlg) return;
      var typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || "");
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === "KeyS" && view && view.v === "edit") { e.preventDefault(); saveEdit(); return; }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === "KeyK" && !(e.target && e.target.id === "ed-text")) { e.preventDefault(); $("q").focus(); $("q").select(); return; }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === "KeyE" && view && view.v === "art") { e.preventDefault(); startEdit({ a: view.a }); }
    });
    window.addEventListener("pagehide", saveDraft);
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") saveDraft(); });
  }

  function boot() {
    load();
    applyI18n();
    inheritPalette();
    document.body.classList.toggle("side-hidden", !prefs.side);
    $("side-btn").setAttribute("aria-expanded", narrow() ? "false" : (prefs.side ? "true" : "false"));
    wire();
    registerSync();
    watchPalette();
    renderSide();
    if (!shell()) toast(t("standalone"));
    var opened = false;
    try {
      var s = shell();
      if (s && typeof s.__orosTakeTarget === "function") {
        var pending = s.__orosTakeTarget("wiki");
        if (pending) opened = openTarget(pending);
      }
    } catch (e) {}
    if (!opened) {
      var a = prefs.a && C.byId(data, prefs.a);
      var w = curWiki();
      if (a && w && a.w === w.id) { view = null; openArt(a); }
      else { view = null; goMain(); }
      stack = [];
      $("back-btn").hidden = true;
    }
    console.log("[orOS Wiki] v" + C.VERSION + " ready");
  }

  boot();
})();
