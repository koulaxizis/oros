// ============================================================
// orOS Wiki — App logic (v1.2.0)
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
//   - wave 2: pictures (designkit/assets.js on the orOS disk) and
//     galleries, infobox form, references with a Cite form, a table
//     editor, print and save as PDF (pdf.js)
//   - wave 3 (io.js): import from Notes and Markdown (.md / .zip),
//     export as Markdown or an offline website (.zip), Start from
//     Wikipedia (CC BY-SA credit kept), Send to someone (kind "wiki")
//   - wave 4 (import.js): import from Notion, TiddlyWiki, MediaWiki
//     and Confluence exports (and Markdown) with a preview, stable
//     ids (a new import updates untouched articles) and Undo
// Data: synced slice "wiki" (oros-wiki-data, core.js); history files
// /internal/Wiki/History/<article>/ on the orOS disk (Vault Drive).
// Sections:
//   1. Constants, i18n, helpers
//   2. State + storage
//   3. Navigation
//   4. Article view
//   5. Editor
//   5b. Pictures, infobox, references, tables, PDF (wave 2)
//   5c. Import, export, Wikipedia, sending (wave 3)
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
      "tb.img": "Picture", "tb.gal": "Gallery", "tb.ibox": "Infobox", "tb.cite": "Reference",
      "art.refs": "References", "art.refUp": "Back to the text", "art.refMissing": "This reference has no text yet.",
      "img.missing": "This picture has not reached this device yet.", "img.open": "Open the picture",
      "pick.title": "Add a picture", "pick.galTitle": "Add pictures for a gallery", "pick.device": "From this device",
      "pick.camera": "Take a photo", "pick.files": "From Files", "pick.add": "Add",
      "files.title": "Pick from Files", "files.up": "Up", "files.empty": "No pictures here.", "files.loading": "Loading…",
      "files.err": "Files could not be read.", "files.picked": "{n} selected", "files.picked1": "1 selected",
      "pic.title": "Picture", "pic.cap": "Caption", "pic.pos": "Place", "pic.right": "Right", "pic.left": "Left",
      "pic.center": "Centre", "pic.full": "Full width", "pic.size": "Size", "pic.small": "Small", "pic.medium": "Medium",
      "pic.large": "Large", "pic.insert": "Insert",
      "ibox.title": "Infobox", "ibox.name": "Title", "ibox.image": "Picture", "ibox.pick": "Choose a picture…",
      "ibox.change": "Change the picture…", "ibox.noImg": "No picture", "ibox.remImg": "Remove the picture",
      "ibox.cap": "Caption", "ibox.rows": "Facts", "ibox.key": "Name", "ibox.val": "Value", "ibox.addRow": "Add a row",
      "ibox.remRow": "Remove this row", "ibox.del": "Remove the infobox", "ibox.save": "Save",
      "ibox.hint": "The infobox shows at the top right of the article, and above the text on a phone.",
      "cite.title": "Add a reference", "cite.kind": "Kind", "cite.book": "Book", "cite.web": "Web page", "cite.person": "Person",
      "cite.note": "Note", "cite.author": "Author", "cite.btitle": "Title", "cite.publisher": "Publisher", "cite.place": "Place",
      "cite.year": "Year", "cite.pages": "Pages", "cite.isbn": "ISBN", "cite.url": "Address (https://…)", "cite.site": "Website",
      "cite.date": "Date you read it", "cite.name": "Name", "cite.role": "Who they are", "cite.how": "How",
      "cite.howPh": "Interview, conversation, letter…", "cite.pdate": "Date", "cite.text": "Text",
      "cite.insert": "Insert", "cite.empty": "Fill in at least one field.", "cite.preview": "It will read:",
      "cite.L.pages": "p.", "cite.L.retrieved": "Retrieved", "cite.L.interview": "Interview",
      "tbl.title": "Table", "tbl.addRow": "Add a row", "tbl.addCol": "Add a column", "tbl.delRow": "Remove row {n}",
      "tbl.delCol": "Remove column {n}", "tbl.align": "Alignment of column {n}", "tbl.auto": "Auto", "tbl.left": "Left",
      "tbl.center": "Centre", "tbl.right": "Right", "tbl.save": "Insert", "tbl.hint": "The first row is the header row.",
      "tbl.cell": "Row {r}, column {c}", "tbl.head": "Header",
      "menu.print": "Print", "menu.pdf": "Save as PDF",
      "toast.nofs": "Pictures need the orOS disk: open Wiki inside orOS.", "toast.imgFail": "Some files are not pictures that can be used.",
      "toast.importing": "Adding the pictures…", "toast.pdfBusy": "Making the PDF…", "toast.pdfFail": "The PDF could not be made.",
      "toast.file": "Saved",
      "cheat": [
        "## Heading  ·  ### Subheading",
        "**bold**  ·  *italic*  ·  ~~struck~~  ·  `code`",
        "[[Article]]  ·  [[Article|other text]]  ·  [[Article#Section]]",
        "[text](https://example.com)  ·  https://example.com",
        "- list item  ·  1. numbered item (two spaces in front: one level deeper)",
        "> quote  ·  --- line  ·  ``` code block ```",
        "| A | B |  then  |---|---|  then rows: a table",
        "[[Category:Name]] files the article in a category",
        "#REDIRECT [[Article]] as the first line sends readers to another article",
        "[[File:…|left|200px|Caption]] a picture (use the Picture button)  ·  {{gallery … }} several pictures",
        "{{infobox  | title = …  | Name = value  }} the facts box at the top",
        "text[^1] then a line  [^1]: source  adds a numbered reference; {{references}} places the list"
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
      "sum.keep": "Kept this version (parallel edit)", "sum.useOther": "Took the version from another device",
      "nav.io": "Import and export…", "io.title": "Import and export", "io.import": "Bring in", "io.export": "Save this wiki",
      "io.lead": "Imports add articles. Importing the same file again updates only the articles it brought in that you haven't changed since; nothing else in your wiki is touched.",
      "io.notes": "From Notes…", "io.notesHint": "A notebook of orOS Notes: every page becomes an article; subpages and labels become categories.",
      "io.md": "From a file…", "io.mdHint": "Markdown (.md or a .zip), a Notion export (Markdown & CSV), TiddlyWiki (.json or the .html file), a MediaWiki dump (.xml) or a Confluence space export (HTML .zip).",
      "io.wp": "Start from Wikipedia…", "io.wpHint": "One Wikipedia article as a starting text, with its source and licence.",
      "io.mdOut": "Markdown (.zip)", "io.mdOutHint": "Every article as a .md file, with its pictures.",
      "io.site": "Website (.zip)", "io.siteHint": "This wiki as an offline website: unzip it and open index.html in any browser.",
      "notes.title": "Import from Notes", "notes.book": "Notebook", "notes.pages": "{t} ({n} pages)", "notes.pages1": "{t} (1 page)",
      "notes.where": "Put the articles in", "notes.new": "A new wiki called “{t}”", "notes.cur": "This wiki (“{t}”)",
      "notes.none": "Notes has no pages on this device yet.", "notes.ok": "Import",
      "imp.done": "{n} articles imported", "imp.done1": "1 article imported", "imp.none": "Nothing to import in these files.",
      "imp.cut": "Only {n} articles fit: a wiki holds up to 5,000.", "imp.busy": "Importing…", "imp.fail": "These files could not be read.",
      "imp.untitled": "Untitled", "imp.wiki": "Imported",
      "ix.title": "Import from {s}", "ix.ok": "Import", "ix.big": "This file is too large to import.",
      "ix.pages": "{n} pages in the file", "ix.pages1": "1 page in the file", "ix.range": "Written between {a} and {b}",
      "ix.add": "{n} new articles", "ix.add1": "1 new article",
      "ix.update": "{n} articles from an earlier import get the newer text", "ix.update1": "1 article from an earlier import gets the newer text",
      "ix.same": "{n} articles are already here, unchanged", "ix.same1": "1 article is already here, unchanged",
      "ix.edited": "{n} articles you changed since the last import stay as you left them", "ix.edited1": "1 article you changed since the last import stays as you left it",
      "ix.renamed": "{n} titles are taken in this wiki: those articles get a number, like “Olives (2)”", "ix.renamed1": "1 title is taken in this wiki: that article gets a number, like “Olives (2)”",
      "ix.cut": "{n} pages don't fit: a wiki holds up to 5,000 articles", "ix.cut1": "1 page doesn't fit: a wiki holds up to 5,000 articles",
      "ix.pics": "{n} pictures go to the orOS disk", "ix.pics1": "1 picture goes to the orOS disk",
      "ix.skipSystem": "{n} system tiddlers ($:/…) and drafts are left out", "ix.skipSystem1": "1 system tiddler ($:/…) or draft is left out",
      "ix.skipType": "{n} tiddlers that aren't text (pictures, files) are left out", "ix.skipType1": "1 tiddler that isn't text (a picture or file) is left out",
      "ix.skipNs": "{n} pages outside the main namespace (users, talk, templates…) are left out", "ix.skipNs1": "1 page outside the main namespace (users, talk, templates…) is left out",
      "ix.skipCut": "Only the first 2,000 pages are read: {n} more are left out", "ix.skipCut1": "Only the first 2,000 pages are read: 1 more is left out",
      "ix.empty": "{n} pages are empty", "ix.empty1": "1 page is empty",
      "ix.nothing": "Everything in this file is already in the wiki.",
      "ix.map.markdown": "Each file becomes an article; folders and tags become categories; links to other .md files become article links; pictures inside a .zip come along.",
      "ix.map.notion": "Each page becomes an article, without Notion's long ids; subpages go in a category named after their page; a database becomes an article with a table; links between pages and pictures are kept.",
      "ix.map.tiddlywiki": "Each tiddler becomes an article; tags become categories; WikiText formatting, lists, tables and links are converted; a transclusion becomes a link.",
      "ix.map.mediawiki": "Each page becomes an article from its latest revision; categories and redirects are kept; templates are left out.",
      "ix.map.confluence": "Each page becomes an article in a category named after its parent page; headings, lists, tables, code, links between pages and pictures are kept.",
      "ix.doneU": "{n} new articles, {u} updated", "ix.undone": "Import undone", "sum.imp": "Imported from {s}",
      "exp.busy": "Making the file…", "exp.empty": "This wiki has no articles yet.", "exp.fail": "The file could not be made.",
      "wp.title": "Start from Wikipedia", "wp.lang": "Wikipedia in", "wp.q": "Article title or Wikipedia address", "wp.ph": "e.g. Olive",
      "wp.privacy": "The title you type goes to Wikipedia (Wikimedia Foundation) to fetch the article. Pictures are not copied.",
      "wp.ok": "Fetch", "wp.busy": "Fetching from Wikipedia…", "wp.missing": "Wikipedia has no article with this title.",
      "wp.fail": "Wikipedia could not be reached. Check the connection and try again.", "wp.empty": "Write a title.",
      "wp.sugg": "Articles with this title:", "wp.sum": "Started from Wikipedia",
      "wp.edit": "Check the text, then press Save. Keep the Source section at the end: it names the authors and the licence.",
      "wp.replace": "Replace what you wrote with the Wikipedia article?", "wp.replaceBtn": "Replace",
      "ed.wp": "Start from Wikipedia",
      "menu.send": "Send to someone…", "send.noPics": "Pictures stay here: the link carries the text.",
      "toast.noShare": "Sending needs orOS: open Wiki inside orOS.", "sum.recv": "Received with a link",
      "sum.notes": "Imported from Notes", "sum.md": "Imported from Markdown",
      "site.main": "Main page", "site.all": "All articles", "site.cats": "Categories", "site.cat": "Category: {t}",
      "site.redirect": "Redirect to", "site.foot": "Made with orOS Wiki · last change {d}", "site.footList": "Made with orOS Wiki"
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
      "tb.img": "Εικόνα", "tb.gal": "Γκαλερί", "tb.ibox": "Πλαίσιο πληροφοριών", "tb.cite": "Παραπομπή",
      "art.refs": "Παραπομπές", "art.refUp": "Πίσω στο κείμενο", "art.refMissing": "Αυτή η παραπομπή δεν έχει ακόμα κείμενο.",
      "img.missing": "Αυτή η εικόνα δεν έχει φτάσει ακόμα σε αυτή τη συσκευή.", "img.open": "Άνοιγμα της εικόνας",
      "pick.title": "Προσθήκη εικόνας", "pick.galTitle": "Εικόνες για γκαλερί", "pick.device": "Από αυτή τη συσκευή",
      "pick.camera": "Λήψη φωτογραφίας", "pick.files": "Από τα Αρχεία", "pick.add": "Προσθήκη",
      "files.title": "Επιλογή από τα Αρχεία", "files.up": "Πάνω", "files.empty": "Δεν υπάρχουν εικόνες εδώ.", "files.loading": "Φόρτωση…",
      "files.err": "Δεν ήταν δυνατή η ανάγνωση των Αρχείων.", "files.picked": "Επιλέχτηκαν {n}", "files.picked1": "Επιλέχτηκε 1",
      "pic.title": "Εικόνα", "pic.cap": "Λεζάντα", "pic.pos": "Θέση", "pic.right": "Δεξιά", "pic.left": "Αριστερά",
      "pic.center": "Στο κέντρο", "pic.full": "Σε όλο το πλάτος", "pic.size": "Μέγεθος", "pic.small": "Μικρή", "pic.medium": "Μεσαία",
      "pic.large": "Μεγάλη", "pic.insert": "Εισαγωγή",
      "ibox.title": "Πλαίσιο πληροφοριών", "ibox.name": "Τίτλος", "ibox.image": "Εικόνα", "ibox.pick": "Διάλεξε εικόνα…",
      "ibox.change": "Άλλαξε την εικόνα…", "ibox.noImg": "Χωρίς εικόνα", "ibox.remImg": "Αφαίρεση της εικόνας",
      "ibox.cap": "Λεζάντα", "ibox.rows": "Στοιχεία", "ibox.key": "Όνομα", "ibox.val": "Τιμή", "ibox.addRow": "Προσθήκη γραμμής",
      "ibox.remRow": "Αφαίρεση αυτής της γραμμής", "ibox.del": "Αφαίρεση του πλαισίου", "ibox.save": "Αποθήκευση",
      "ibox.hint": "Το πλαίσιο φαίνεται πάνω δεξιά στο άρθρο, και πάνω από το κείμενο στο κινητό.",
      "cite.title": "Προσθήκη παραπομπής", "cite.kind": "Είδος", "cite.book": "Βιβλίο", "cite.web": "Ιστοσελίδα", "cite.person": "Πρόσωπο",
      "cite.note": "Σημείωση", "cite.author": "Συγγραφέας", "cite.btitle": "Τίτλος", "cite.publisher": "Εκδότης", "cite.place": "Τόπος",
      "cite.year": "Έτος", "cite.pages": "Σελίδες", "cite.isbn": "ISBN", "cite.url": "Διεύθυνση (https://…)", "cite.site": "Ιστότοπος",
      "cite.date": "Ημερομηνία που το διάβασες", "cite.name": "Όνομα", "cite.role": "Ποιος είναι", "cite.how": "Πώς",
      "cite.howPh": "Συνέντευξη, συζήτηση, επιστολή…", "cite.pdate": "Ημερομηνία", "cite.text": "Κείμενο",
      "cite.insert": "Εισαγωγή", "cite.empty": "Συμπλήρωσε τουλάχιστον ένα πεδίο.", "cite.preview": "Θα γράφει:",
      "cite.L.pages": "σ.", "cite.L.retrieved": "Ανακτήθηκε", "cite.L.interview": "Συνέντευξη",
      "tbl.title": "Πίνακας", "tbl.addRow": "Προσθήκη γραμμής", "tbl.addCol": "Προσθήκη στήλης", "tbl.delRow": "Αφαίρεση της γραμμής {n}",
      "tbl.delCol": "Αφαίρεση της στήλης {n}", "tbl.align": "Στοίχιση της στήλης {n}", "tbl.auto": "Αυτόματη", "tbl.left": "Αριστερά",
      "tbl.center": "Στο κέντρο", "tbl.right": "Δεξιά", "tbl.save": "Εισαγωγή", "tbl.hint": "Η πρώτη γραμμή είναι η γραμμή επικεφαλίδων.",
      "tbl.cell": "Γραμμή {r}, στήλη {c}", "tbl.head": "Επικεφαλίδα",
      "menu.print": "Εκτύπωση", "menu.pdf": "Αποθήκευση ως PDF",
      "toast.nofs": "Οι εικόνες θέλουν τον δίσκο του orOS: άνοιξε το Wiki μέσα από το orOS.", "toast.imgFail": "Κάποια αρχεία δεν είναι εικόνες που μπορούν να χρησιμοποιηθούν.",
      "toast.importing": "Προστίθενται οι εικόνες…", "toast.pdfBusy": "Φτιάχνεται το PDF…", "toast.pdfFail": "Δεν ήταν δυνατό να γίνει το PDF.",
      "toast.file": "Αποθηκεύτηκε",
      "cheat": [
        "## Επικεφαλίδα  ·  ### Υποεπικεφαλίδα",
        "**έντονα**  ·  *πλάγια*  ·  ~~διαγραμμένα~~  ·  `κώδικας`",
        "[[Άρθρο]]  ·  [[Άρθρο|άλλο κείμενο]]  ·  [[Άρθρο#Ενότητα]]",
        "[κείμενο](https://example.com)  ·  https://example.com",
        "- στοιχείο λίστας  ·  1. αριθμημένο στοιχείο (δύο κενά μπροστά: ένα επίπεδο πιο μέσα)",
        "> παράθεση  ·  --- γραμμή  ·  ``` μπλοκ κώδικα ```",
        "| Α | Β |  μετά  |---|---|  μετά οι γραμμές: ένας πίνακας",
        "[[Κατηγορία:Όνομα]] βάζει το άρθρο σε κατηγορία",
        "#REDIRECT [[Άρθρο]] στην πρώτη γραμμή στέλνει τον αναγνώστη σε άλλο άρθρο",
        "[[Αρχείο:…|αριστερά|200px|Λεζάντα]] μια εικόνα (με το κουμπί Εικόνα)  ·  {{γκαλερί … }} πολλές εικόνες",
        "{{πλαίσιο  | τίτλος = …  | Όνομα = τιμή  }} το πλαίσιο πληροφοριών στην κορυφή",
        "κείμενο[^1] και μια γραμμή  [^1]: πηγή  προσθέτει αριθμημένη παραπομπή· το {{παραπομπές}} βάζει τη λίστα"
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
      "sum.keep": "Κρατήθηκε αυτή η εκδοχή (παράλληλη αλλαγή)", "sum.useOther": "Πάρθηκε η εκδοχή άλλης συσκευής",
      "nav.io": "Εισαγωγή και εξαγωγή…", "io.title": "Εισαγωγή και εξαγωγή", "io.import": "Φέρε μέσα", "io.export": "Αποθήκευσε αυτό το wiki",
      "io.lead": "Οι εισαγωγές προσθέτουν άρθρα. Αν εισαγάγεις ξανά το ίδιο αρχείο, ενημερώνονται μόνο τα άρθρα που έφερε και δεν έχεις αλλάξει από τότε· τίποτε άλλο στο wiki σου δεν αγγίζεται.",
      "io.notes": "Από τις Σημειώσεις…", "io.notesHint": "Ένα σημειωματάριο των Σημειώσεων του orOS: κάθε σελίδα γίνεται άρθρο, οι υποσελίδες και οι ετικέτες γίνονται κατηγορίες.",
      "io.md": "Από αρχείο…", "io.mdHint": "Markdown (.md ή .zip), εξαγωγή του Notion (Markdown & CSV), TiddlyWiki (.json ή το αρχείο .html), αντίγραφο MediaWiki (.xml) ή εξαγωγή χώρου του Confluence (.zip με HTML).",
      "io.wp": "Ξεκίνα από τη Βικιπαίδεια…", "io.wpHint": "Ένα άρθρο της Βικιπαίδειας ως κείμενο αφετηρίας, με την πηγή και την άδειά του.",
      "io.mdOut": "Markdown (.zip)", "io.mdOutHint": "Κάθε άρθρο ως αρχείο .md, μαζί με τις εικόνες του.",
      "io.site": "Ιστότοπος (.zip)", "io.siteHint": "Αυτό το wiki ως ιστότοπος χωρίς σύνδεση: αποσυμπίεσέ το και άνοιξε το index.html σε οποιονδήποτε browser.",
      "notes.title": "Εισαγωγή από τις Σημειώσεις", "notes.book": "Σημειωματάριο", "notes.pages": "{t} ({n} σελίδες)", "notes.pages1": "{t} (1 σελίδα)",
      "notes.where": "Βάλε τα άρθρα", "notes.new": "Σε νέο wiki με όνομα «{t}»", "notes.cur": "Σε αυτό το wiki («{t}»)",
      "notes.none": "Οι Σημειώσεις δεν έχουν ακόμα σελίδες σε αυτή τη συσκευή.", "notes.ok": "Εισαγωγή",
      "imp.done": "Μπήκαν {n} άρθρα", "imp.done1": "Μπήκε 1 άρθρο", "imp.none": "Δεν υπάρχει τίποτα για εισαγωγή σε αυτά τα αρχεία.",
      "imp.cut": "Χώρεσαν μόνο {n} άρθρα: ένα wiki έχει έως 5.000.", "imp.busy": "Εισαγωγή…", "imp.fail": "Δεν ήταν δυνατό να διαβαστούν αυτά τα αρχεία.",
      "imp.untitled": "Χωρίς τίτλο", "imp.wiki": "Εισαγωγή",
      "ix.title": "Εισαγωγή από {s}", "ix.ok": "Εισαγωγή", "ix.big": "Το αρχείο είναι πολύ μεγάλο για εισαγωγή.",
      "ix.pages": "{n} σελίδες στο αρχείο", "ix.pages1": "1 σελίδα στο αρχείο", "ix.range": "Γράφτηκαν από {a} έως {b}",
      "ix.add": "{n} νέα άρθρα", "ix.add1": "1 νέο άρθρο",
      "ix.update": "{n} άρθρα από προηγούμενη εισαγωγή παίρνουν το νεότερο κείμενο", "ix.update1": "1 άρθρο από προηγούμενη εισαγωγή παίρνει το νεότερο κείμενο",
      "ix.same": "{n} άρθρα υπάρχουν ήδη, χωρίς αλλαγές", "ix.same1": "1 άρθρο υπάρχει ήδη, χωρίς αλλαγές",
      "ix.edited": "{n} άρθρα που άλλαξες μετά την τελευταία εισαγωγή μένουν όπως τα άφησες", "ix.edited1": "1 άρθρο που άλλαξες μετά την τελευταία εισαγωγή μένει όπως το άφησες",
      "ix.renamed": "{n} τίτλοι υπάρχουν ήδη σε αυτό το wiki: τα άρθρα αυτά παίρνουν αριθμό, π.χ. «Ελιές (2)»", "ix.renamed1": "1 τίτλος υπάρχει ήδη σε αυτό το wiki: το άρθρο παίρνει αριθμό, π.χ. «Ελιές (2)»",
      "ix.cut": "{n} σελίδες δεν χωράνε: ένα wiki έχει έως 5.000 άρθρα", "ix.cut1": "1 σελίδα δεν χωράει: ένα wiki έχει έως 5.000 άρθρα",
      "ix.pics": "{n} εικόνες πηγαίνουν στον δίσκο του orOS", "ix.pics1": "1 εικόνα πηγαίνει στον δίσκο του orOS",
      "ix.skipSystem": "{n} tiddlers συστήματος ($:/…) και πρόχειρα μένουν έξω", "ix.skipSystem1": "1 tiddler συστήματος ($:/…) ή πρόχειρο μένει έξω",
      "ix.skipType": "{n} tiddlers που δεν είναι κείμενο (εικόνες, αρχεία) μένουν έξω", "ix.skipType1": "1 tiddler που δεν είναι κείμενο (εικόνα ή αρχείο) μένει έξω",
      "ix.skipNs": "{n} σελίδες εκτός του κύριου χώρου ονομάτων (χρήστες, συζητήσεις, πρότυπα…) μένουν έξω", "ix.skipNs1": "1 σελίδα εκτός του κύριου χώρου ονομάτων (χρήστες, συζητήσεις, πρότυπα…) μένει έξω",
      "ix.skipCut": "Διαβάζονται μόνο οι πρώτες 2.000 σελίδες: άλλες {n} μένουν έξω", "ix.skipCut1": "Διαβάζονται μόνο οι πρώτες 2.000 σελίδες: άλλη 1 μένει έξω",
      "ix.empty": "{n} σελίδες είναι άδειες", "ix.empty1": "1 σελίδα είναι άδεια",
      "ix.nothing": "Όλα όσα έχει αυτό το αρχείο υπάρχουν ήδη στο wiki.",
      "ix.map.markdown": "Κάθε αρχείο γίνεται άρθρο· οι φάκελοι και οι ετικέτες γίνονται κατηγορίες· οι σύνδεσμοι προς άλλα αρχεία .md γίνονται σύνδεσμοι άρθρων· οι εικόνες μέσα στο .zip έρχονται μαζί.",
      "ix.map.notion": "Κάθε σελίδα γίνεται άρθρο, χωρίς τους μακριούς κωδικούς του Notion· οι υποσελίδες μπαίνουν σε κατηγορία με το όνομα της σελίδας τους· μια βάση δεδομένων γίνεται άρθρο με πίνακα· οι σύνδεσμοι ανάμεσα στις σελίδες και οι εικόνες μένουν.",
      "ix.map.tiddlywiki": "Κάθε tiddler γίνεται άρθρο· οι ετικέτες γίνονται κατηγορίες· η μορφοποίηση WikiText, οι λίστες, οι πίνακες και οι σύνδεσμοι μετατρέπονται· μια ενσωμάτωση (transclusion) γίνεται σύνδεσμος.",
      "ix.map.mediawiki": "Κάθε σελίδα γίνεται άρθρο από την πιο πρόσφατη αναθεώρησή της· οι κατηγορίες και οι ανακατευθύνσεις μένουν· τα πρότυπα μένουν έξω.",
      "ix.map.confluence": "Κάθε σελίδα γίνεται άρθρο, σε κατηγορία με το όνομα της γονικής της σελίδας· οι επικεφαλίδες, οι λίστες, οι πίνακες, ο κώδικας, οι σύνδεσμοι ανάμεσα στις σελίδες και οι εικόνες μένουν.",
      "ix.doneU": "{n} νέα άρθρα, {u} ενημερώθηκαν", "ix.undone": "Η εισαγωγή αναιρέθηκε", "sum.imp": "Εισαγωγή από {s}",
      "exp.busy": "Φτιάχνεται το αρχείο…", "exp.empty": "Αυτό το wiki δεν έχει ακόμα άρθρα.", "exp.fail": "Δεν ήταν δυνατό να γίνει το αρχείο.",
      "wp.title": "Ξεκίνα από τη Βικιπαίδεια", "wp.lang": "Βικιπαίδεια στα", "wp.q": "Τίτλος άρθρου ή διεύθυνση της Βικιπαίδειας", "wp.ph": "π.χ. Ελιά",
      "wp.privacy": "Ο τίτλος που γράφεις πηγαίνει στη Βικιπαίδεια (Wikimedia Foundation) για να έρθει το άρθρο. Οι εικόνες δεν αντιγράφονται.",
      "wp.ok": "Φέρ' το", "wp.busy": "Έρχεται από τη Βικιπαίδεια…", "wp.missing": "Η Βικιπαίδεια δεν έχει άρθρο με αυτόν τον τίτλο.",
      "wp.fail": "Η Βικιπαίδεια δεν απάντησε. Έλεγξε τη σύνδεση και δοκίμασε ξανά.", "wp.empty": "Γράψε έναν τίτλο.",
      "wp.sugg": "Άρθρα με αυτόν τον τίτλο:", "wp.sum": "Ξεκίνησε από τη Βικιπαίδεια",
      "wp.edit": "Έλεγξε το κείμενο και πάτα Αποθήκευση. Κράτα την ενότητα Πηγή στο τέλος: γράφει τους συντάκτες και την άδεια.",
      "wp.replace": "Να αντικατασταθεί ό,τι έγραψες με το άρθρο της Βικιπαίδειας;", "wp.replaceBtn": "Αντικατάσταση",
      "ed.wp": "Ξεκίνα από τη Βικιπαίδεια",
      "menu.send": "Στείλε σε κάποιον…", "send.noPics": "Οι εικόνες μένουν εδώ: ο σύνδεσμος παίρνει το κείμενο.",
      "toast.noShare": "Η αποστολή θέλει το orOS: άνοιξε το Wiki μέσα από το orOS.", "sum.recv": "Ήρθε με σύνδεσμο",
      "sum.notes": "Εισαγωγή από τις Σημειώσεις", "sum.md": "Εισαγωγή από Markdown",
      "site.main": "Κεντρική σελίδα", "site.all": "Όλα τα άρθρα", "site.cats": "Κατηγορίες", "site.cat": "Κατηγορία: {t}",
      "site.redirect": "Ανακατεύθυνση στο", "site.foot": "Φτιάχτηκε με το Wiki του orOS · τελευταία αλλαγή {d}", "site.footList": "Φτιάχτηκε με το Wiki του orOS"
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
    else body.appendChild(C.render(document, parsed, renderOpts({ edit: t("art.secEdit") })));
    art.appendChild(body);
    hydrate(body);
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
      var rf = n.closest("a[data-ref]");
      if (rf) { e.preventDefault(); scrollToId(body, "ref-" + rf.getAttribute("data-ref")); return; }
      var up = n.closest("a[data-cite]");
      if (up) { e.preventDefault(); scrollToId(body, up.getAttribute("data-cite")); return; }
      var im = n.closest("img.wimg");
      if (im && im.src) { e.preventDefault(); lightbox(im); return; }
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
    // opts.text: a new article's first text (a share to the single
    // app); it counts as unsaved, so leaving the editor asks first.
    var text = a ? (whole ? a.x : C.getSection(a.x, sec)) : (typeof opts.text === "string" ? opts.text : "");
    if (text === null) { text = a.x; sec = 0; whole = true; }
    ed = {
      a: a ? a.id : "", w: w.id, sec: whole ? 0 : sec, whole: whole,
      base: a ? a.r : "", baseX: a ? a.x : "", baseT: a ? a.t : "",
      title: a ? a.t : C.cleanTitle(opts.title || ""), text: text, start: a ? text : "", sum: opts.sum || "",
      makeMain: !!opts.makeMain, tab: "write", restored: false
    };
    ed.dirty = function () {
      var x = $("ed-text"), tt = $("ed-name");
      var cur = x ? x.value : ed.text, curT = tt ? tt.value : ed.title;
      return cur !== ed.start || (!ed.a && C.cleanTitle(curT) !== C.cleanTitle(opts.title || ""));
    };
    var dr = readDraft();
    if (!opts.text && dr && dr.w === ed.w && dr.a === ed.a && dr.sec === ed.sec && dr.base === ed.base &&
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
      var wpb = btn("chip small ed-wp", "W " + t("ed.wp"), wpFromEditor);
      box.appendChild(wpb);
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
      else pv.appendChild(C.render(document, p, renderOpts()));
      if (p.cats.length) pv.appendChild(catsBox(p.cats));
      hydrate(pv);
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
    ["table", "▦", function () { tableDialog(); }],
    ["img", "🖼", function () { pictureTool(); }],
    ["gal", "▤", function () { galleryTool(); }],
    ["ibox", "ⓘ", function () { infoboxDialog(); }],
    ["cite", "[1]", function () { citeDialog(); }],
    ["code", "</>", function () { codeTool(); }],
    ["quote", "❝", function () { linePrefix("> "); }],
    ["cat", "#", function () { insertBlock("[[" + (LANG === "el" ? "Κατηγορία" : "Category") + ":" + t("tb.catPh") + "]]\n", true); }]
  ];
  function toolbar() {
    var bar = el("div", "tb");
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", t("ed.write"));
    TOOLS.forEach(function (tool) {
      var b = btn("tb-btn tb-" + tool[0], tool[1], function () {
        keepCaret();
        tool[2]();
        if (!openDlg) { $("ed-text").focus(); saveDraftSoon(); }
      });
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

  // ---------- 5b. Pictures, infobox, references, tables, PDF (wave 2) ----------
  // Pictures are designkit/assets.js files on the orOS disk
  // (/internal/Assets/<sha256>.jpg|png, synced by Vault Drive); the
  // text keeps only the id. The renderer never sets a src: hydrate()
  // gives each <img data-img> a blob: URL read from the disk.
  function AS() { return window.orosDK && window.orosDK.assets; }
  function renderOpts(extra) {
    return Object.assign({ state: linkState, toc: t("art.toc"), refs: t("art.refs"), refUp: t("art.refUp"), refMissing: t("art.refMissing") }, extra || {});
  }
  var imgUrls = {};          // asset id → blob: URL
  function imgUrl(id) {
    if (imgUrls[id]) return Promise.resolve(imgUrls[id]);
    var A = AS();
    if (!A || !C.IMG_RE.test(id)) return Promise.resolve("");
    return A.blob(id).then(function (b) {
      if (!b) return "";
      if (!imgUrls[id]) imgUrls[id] = URL.createObjectURL(b);
      return imgUrls[id];
    }, function () { return ""; });
  }
  function hydrate(root) {
    [].forEach.call(root.querySelectorAll("img[data-img]"), function (im) {
      var id = im.getAttribute("data-img");
      if (!C.IMG_RE.test(id)) return;
      if (imgUrls[id]) { im.src = imgUrls[id]; return; }
      im.classList.add("wait");
      imgUrl(id).then(function (u) {
        im.classList.remove("wait");
        if (u) { im.src = u; im.title = t("img.open"); }
        else { im.classList.add("missing"); im.title = t("img.missing"); }
      });
    });
  }
  function scrollToId(root, id) {
    var n = null;
    [].some.call(root.querySelectorAll("[id]"), function (x) { if (x.id === id) { n = x; return true; } return false; });
    if (!n) return;
    var sec = n.closest && n.closest(".sec");
    if (sec) sec.classList.remove("closed");
    n.scrollIntoView({ block: "center" });
    n.classList.remove("flash");
    void n.offsetWidth;
    n.classList.add("flash");
  }
  function lightbox(im) {
    var box = $("lb-img");
    box.src = im.src;
    box.alt = im.alt || "";
    var fig = im.closest && im.closest("figure");
    var cap = fig && fig.querySelector("figcaption");
    $("lb-cap").textContent = cap ? cap.textContent : (im.alt || "");
    showDlg("lightbox");
  }

  // The editor's selection, kept while a dialog is open.
  var caret = { s: 0, e: 0 };
  function keepCaret() {
    var ta = $("ed-text");
    caret = ta ? { s: ta.selectionStart, e: ta.selectionEnd } : { s: 0, e: 0 };
  }
  function edFocus() {
    var ta = $("ed-text");
    if (!ta) return null;
    ta.focus();
    ta.setSelectionRange(caret.s, caret.e);
    return ta;
  }
  function putBlock(block) { if (edFocus()) { insertBlock(block); saveDraftSoon(); } }
  function replaceRange(start, end, text) {
    var ta = edFocus();
    if (!ta) return;
    ta.setRangeText(text, start, end, "end");
    saveDraftSoon();
  }

  // A form in the shared dialog. o: { title, body, ok, check() → error, done(), extra:[[label, fn, cls]] }
  var formCur = null;
  function openForm(o) {
    formCur = o;
    $("form-title").textContent = o.title;
    var body = $("form-body");
    body.textContent = "";
    body.appendChild(o.body);
    $("form-err").textContent = "";
    var acts = $("form-actions");
    acts.textContent = "";
    (o.extra || []).forEach(function (x) { acts.appendChild(btn("chip" + (x[2] ? " " + x[2] : ""), x[0], x[1])); });
    acts.appendChild(el("span", "spacer"));
    acts.appendChild(btn("chip", o.cancel || t("btn.cancel"), hideDlg));
    if (o.ok) acts.appendChild(btn("chip primary", o.ok, formOk));
    showDlg("form");
  }
  function formOk() {
    var o = formCur;
    if (!o) return;
    var err = o.check ? o.check() : "";
    if (err) { $("form-err").textContent = err; return; }
    if (o.submit) { o.submit(); return; }
    formCur = null;
    hideDlg();
    if (o.done) o.done();
  }
  function field(label, input, cls) {
    var l = el("label", "fld" + (cls ? " " + cls : ""));
    l.appendChild(el("span", "lbl", label));
    l.appendChild(input);
    return l;
  }
  function inp(value, ph, max) {
    var i = el("input");
    i.type = "text";
    i.autocomplete = "off";
    i.value = value || "";
    if (ph) i.placeholder = ph;
    i.maxLength = max || 500;
    return i;
  }
  function sel(opts, value) {
    var s = el("select");
    opts.forEach(function (o) { var op = el("option", null, o[1]); op.value = o[0]; s.appendChild(op); });
    s.value = value;
    return s;
  }
  function thumb(id) {
    var im = el("img", "thumb");
    im.alt = "";
    im.setAttribute("data-img", id);
    var wrap = el("div", "thumb-box");
    wrap.appendChild(im);
    hydrate(wrap);
    return wrap;
  }
  function coarse() { return !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches); }

  // Picking pictures: this device, the camera, or the orOS disk.
  // cb([{ id, w, h, name }])
  function pickImages(multi, cb) {
    if (!AS() || !fsApi()) { toast(t("toast.nofs")); return; }
    var items = [[t("pick.device"), function () { chooseFiles(multi, false, cb); }]];
    if (coarse()) items.push([t("pick.camera"), function () { chooseFiles(false, true, cb); }]);
    items.push([t("pick.files"), function () { filesDialog(multi, cb); }]);
    var list = $("menu-list");
    list.textContent = "";
    $("menu-title").textContent = t(multi ? "pick.galTitle" : "pick.title");
    items.forEach(function (it) { list.appendChild(btn("menu-item", it[0], function () { hideDlg(); it[1](); })); });
    showDlg("menu");
  }
  function chooseFiles(multi, camera, cb) {
    var f = document.createElement("input");
    f.type = "file";
    f.accept = "image/*";
    if (multi) f.multiple = true;
    if (camera) f.setAttribute("capture", "environment");
    f.addEventListener("change", function () { importAll([].slice.call(f.files || []), cb); });
    f.click();
  }
  function importAll(files, cb) {
    files = files.slice(0, 60);
    if (!files.length) return;
    if (files.length > 1) toast(t("toast.importing"));
    var out = [], bad = 0, chain = Promise.resolve();
    files.forEach(function (file) {
      chain = chain.then(function () { return AS().importFile(file); })
        .then(function (r) { out.push(r); }, function () { bad++; });
    });
    chain.then(function () {
      if (bad) toast(t("toast.imgFail"));
      if (out.length) cb(out);
    });
  }
  var IMG_EXT = /\.(jpe?g|png|gif|webp|bmp|svg|avif)$/i;
  function filesDialog(multi, cb) {
    var F = fsApi();
    if (!F || typeof F.ls !== "function") { toast(t("toast.nofs")); return; }
    var box = el("div", "fl");
    var bar = el("div", "fl-bar");
    var up = btn("chip small", "↑ " + t("files.up"));
    var where = el("span", "fl-path");
    var count = el("span", "fl-count");
    bar.appendChild(up); bar.appendChild(where); bar.appendChild(count);
    var list = el("div", "fl-list");
    box.appendChild(bar); box.appendChild(list);
    var cwd = "/internal", gen = 0, picked = [];
    function showCount() { count.textContent = !multi || !picked.length ? "" : (picked.length === 1 ? t("files.picked1") : t("files.picked", { n: picked.length })); }
    function readAll(paths) {
      Promise.all(paths.map(function (p) {
        return F.read(p).then(function (b) { return new File([b], p.split("/").pop(), { type: b.type || "" }); }, function () { return null; });
      })).then(function (files) { importAll(files.filter(Boolean), cb); });
    }
    function go(path) {
      cwd = path;
      var my = ++gen;
      up.disabled = path === "/internal";
      where.textContent = path === "/internal" ? "/" : path.replace(/^\/internal/, "");
      list.textContent = "";
      list.appendChild(el("p", "hint", t("files.loading")));
      Promise.resolve(typeof F.ready === "function" ? F.ready() : null).then(function () { return F.ls(path); }).then(function (entries) {
        if (my !== gen) return;
        list.textContent = "";
        var shown = 0;
        (entries || []).slice().sort(function (a, b) { return (b.dir ? 1 : 0) - (a.dir ? 1 : 0) || String(a.name).localeCompare(String(b.name)); }).forEach(function (en) {
          if (!en || typeof en.name !== "string") return;
          if (!en.dir && !IMG_EXT.test(en.name)) return;
          if (path === "/internal" && /^(Assets|Wiki)$/.test(en.name)) return;
          shown++;
          var full = path + "/" + en.name;
          var b = btn("fl-item" + (en.dir ? " dir" : ""), (en.dir ? "📁 " : "🖼 ") + en.name, function () {
            if (en.dir) { go(full); return; }
            if (!multi) { hideDlg(); readAll([full]); return; }
            var k = picked.indexOf(full);
            if (k >= 0) picked.splice(k, 1); else picked.push(full);
            b.setAttribute("aria-pressed", k >= 0 ? "false" : "true");
            showCount();
          });
          if (multi && !en.dir) b.setAttribute("aria-pressed", picked.indexOf(full) >= 0 ? "true" : "false");
          list.appendChild(b);
        });
        if (!shown) list.appendChild(el("p", "hint", t("files.empty")));
      }, function () {
        if (my !== gen) return;
        list.textContent = "";
        list.appendChild(el("p", "hint", t("files.err")));
      });
    }
    up.addEventListener("click", function () { if (cwd !== "/internal") go(cwd.replace(/\/[^/]+$/, "") || "/internal"); });
    openForm({
      title: t("files.title"), body: box, ok: multi ? t("pick.add") : "",
      check: function () { return picked.length ? "" : t("files.empty"); },
      done: function () { readAll(picked.slice()); }
    });
    go("/internal");
  }

  // Toolbar: one picture with caption, place and size.
  function pictureTool() {
    pickImages(false, function (list) { pictureForm(list[0]); });
  }
  function pictureForm(img) {
    var body = el("div", "form");
    body.appendChild(thumb(img.id));
    var cap = inp("", "", 300);
    var pos = sel([["right", t("pic.right")], ["left", t("pic.left")], ["center", t("pic.center")], ["none", t("pic.full")]], "right");
    var size = sel([["150", t("pic.small")], ["", t("pic.medium")], ["360", t("pic.large")]], "");
    body.appendChild(field(t("pic.cap"), cap));
    var row = el("div", "fld-row");
    row.appendChild(field(t("pic.pos"), pos));
    row.appendChild(field(t("pic.size"), size));
    body.appendChild(row);
    pos.addEventListener("change", function () { size.disabled = pos.value === "none"; });
    openForm({
      title: t("pic.title"), body: body, ok: t("pic.insert"),
      done: function () {
        var full = pos.value === "none";
        putBlock(C.fileText(img.id, { al: pos.value, w: full ? 0 : Number(size.value) || 0, cap: cap.value }, LANG));
      }
    });
  }
  function galleryTool() {
    pickImages(true, function (list) {
      putBlock(C.galleryText(list.map(function (r) { return { id: r.id, cap: "" }; }), LANG));
    });
  }

  // Infobox: a form over the {{infobox}} block (the one at the caret,
  // else the first one); a new one goes at the top of the text.
  function infoboxDialog() {
    var ta = $("ed-text");
    if (!ta) return;
    var blk = C.blockAt(ta.value, caret.s, "ibox");
    var o = blk ? C.iboxParse(blk.body) : { title: ed && !ed.sec ? ($("ed-name") ? $("ed-name").value : ed.title) : "", image: "", caption: "", rows: [["", ""]] };
    if (!o.rows.length) o.rows.push(["", ""]);
    var body = el("div", "form");
    body.appendChild(el("p", "hint small", t("ibox.hint")));
    var ti = inp(o.title, "", 200);
    body.appendChild(field(t("ibox.name"), ti));
    var img = o.image;
    var imgRow = el("div", "ibox-img-row");
    function drawImg() {
      imgRow.textContent = "";
      if (img) imgRow.appendChild(thumb(img));
      else imgRow.appendChild(el("span", "hint small", t("ibox.noImg")));
      var acts = el("span", "chips inline");
      acts.appendChild(btn("chip small", t(img ? "ibox.change" : "ibox.pick"), function () {
        var keep = collect();
        pickImages(false, function (list) { keep.image = list[0].id; reopen(keep); });
      }));
      if (img) acts.appendChild(btn("chip small", t("ibox.remImg"), function () { img = ""; drawImg(); }));
      imgRow.appendChild(acts);
    }
    var imgFld = el("div", "fld");
    imgFld.appendChild(el("span", "lbl", t("ibox.image")));
    imgFld.appendChild(imgRow);
    body.appendChild(imgFld);
    drawImg();
    var cap = inp(o.caption, "", 300);
    body.appendChild(field(t("ibox.cap"), cap));
    body.appendChild(el("span", "lbl", t("ibox.rows")));
    var rows = el("div", "kv");
    body.appendChild(rows);
    function addRow(k, v) {
      var r = el("div", "kv-row");
      var ki = inp(k, t("ibox.key"), 80), vi = inp(v, t("ibox.val"), 500);
      ki.setAttribute("aria-label", t("ibox.key"));
      vi.setAttribute("aria-label", t("ibox.val"));
      var del = btn("icon-btn small", null, function () { r.remove(); });
      del.innerHTML = ICON.close;
      setLabel(del, t("ibox.remRow"));
      r.appendChild(ki); r.appendChild(vi); r.appendChild(del);
      rows.appendChild(r);
      return ki;
    }
    o.rows.forEach(function (r) { addRow(r[0], r[1]); });
    body.appendChild(btn("chip small", "+ " + t("ibox.addRow"), function () { addRow("", "").focus(); }));
    function collect() {
      return {
        title: ti.value, image: img, caption: cap.value,
        rows: [].map.call(rows.querySelectorAll(".kv-row"), function (r) {
          var i2 = r.querySelectorAll("input");
          return [i2[0].value, i2[1].value];
        }).filter(function (r) { return r[0].trim() || r[1].trim(); })
      };
    }
    // the picture picker replaces this dialog; it comes back with the same fields
    function reopen(keep) { infoboxWith(keep, blk); }
    infoboxOpen(body, collect, blk);
  }
  function infoboxWith(o, blk) {
    // re-render the form with given fields (after picking a picture)
    var ta = $("ed-text");
    if (!ta) return;
    var text = C.iboxText(o, LANG);
    if (blk) {
      // keep the block in the text as the source of truth, then reopen on it
      var cur = C.blockAt(ta.value, blk.start, "ibox");
      if (cur) { replaceRange(cur.start, cur.end, text); caret = { s: cur.start, e: cur.start }; }
    } else {
      var at = ed && ed.sec ? caret.s : 0;
      if (ed && ed.sec) putBlock(text); else replaceRange(0, 0, text + "\n\n");
      caret = { s: at, e: at };
    }
    infoboxDialog();
  }
  function infoboxOpen(body, collect, blk) {
    if (blk) body.appendChild(btn("chip small danger", t("ibox.del"), function () {
      formCur = null;
      hideDlg();
      var ta = $("ed-text"), cur = ta && C.blockAt(ta.value, blk.start, "ibox");
      if (cur) {
        var end = cur.end;
        while (ta.value.charAt(end) === "\n" && end < cur.end + 2) end++;
        replaceRange(cur.start, end, "");
      }
    }));
    openForm({
      title: t("ibox.title"), body: body, ok: t("ibox.save"),
      done: function () {
        var ta = $("ed-text");
        if (!ta) return;
        var text = C.iboxText(collect(), LANG);
        var cur = blk && C.blockAt(ta.value, blk.start, "ibox");
        if (cur) replaceRange(cur.start, cur.end, text);
        else if (ed && ed.sec) putBlock(text);
        else { replaceRange(0, 0, text + "\n\n"); }
      }
    });
  }

  // References: a Cite form writes "[^n]" at the caret and the
  // definition near the end of the text.
  function citeDialog() {
    var ta = $("ed-text");
    if (!ta) return;
    var body = el("div", "form");
    var kind = sel([["book", t("cite.book")], ["web", t("cite.web")], ["person", t("cite.person")], ["note", t("cite.note")]], "book");
    body.appendChild(field(t("cite.kind"), kind));
    var FIELDS = {
      book: [["author", "cite.author"], ["title", "cite.btitle"], ["publisher", "cite.publisher"], ["place", "cite.place"], ["year", "cite.year"], ["pages", "cite.pages"], ["isbn", "cite.isbn"]],
      web: [["title", "cite.btitle"], ["url", "cite.url"], ["site", "cite.site"], ["author", "cite.author"], ["date", "cite.date"]],
      person: [["name", "cite.name"], ["role", "cite.role"], ["how", "cite.how"], ["date", "cite.pdate"]],
      note: [["text", "cite.text"]]
    };
    var box = el("div", "cite-fields"), inputs = {};
    body.appendChild(box);
    var prev = el("p", "cite-prev");
    body.appendChild(el("span", "lbl", t("cite.preview")));
    body.appendChild(prev);
    var L = { pages: t("cite.L.pages"), retrieved: t("cite.L.retrieved"), interview: t("cite.L.interview") };
    function values() { var o = {}; Object.keys(inputs).forEach(function (k) { o[k] = inputs[k].value; }); return o; }
    function preview() {
      prev.textContent = "";
      var txt = C.citeText(kind.value, values(), L);
      if (txt) C.renderInline(document, C.parseInline(txt, 0, { links: [], cats: [], noRef: true }).nodes, prev, renderOpts());
      else prev.appendChild(el("span", "hint small", "—"));
    }
    function draw() {
      var keep = values();
      box.textContent = "";
      inputs = {};
      FIELDS[kind.value].forEach(function (f) {
        var i = inp(keep[f[0]] || (f[0] === "date" && kind.value === "web" ? new Date().toISOString().slice(0, 10) : ""),
                    f[0] === "how" ? t("cite.howPh") : "", f[0] === "url" ? 2000 : 500);
        if (f[0] === "url") { i.type = "url"; i.inputMode = "url"; }
        i.addEventListener("input", preview);
        inputs[f[0]] = i;
        box.appendChild(field(t(f[1]), i));
      });
      preview();
    }
    kind.addEventListener("change", draw);
    draw();
    openForm({
      title: t("cite.title"), body: body, ok: t("cite.insert"),
      check: function () { return C.citeText(kind.value, values(), L) ? "" : t("cite.empty"); },
      done: function () {
        var ta2 = edFocus();
        if (!ta2) return;
        var name = C.nextRefName((ed && !ed.whole ? ed.baseX + "\n" : "") + ta2.value);
        var r = C.addRef(ta2.value, caret.e, name, C.citeText(kind.value, values(), L));
        ta2.value = r.text;
        ta2.setSelectionRange(r.pos, r.pos);
        saveDraftSoon();
      }
    });
  }

  // Table editor: the table at the caret, else a new 2 × 2 one.
  function tableDialog() {
    var ta = $("ed-text");
    if (!ta) return;
    var found = C.tableAt(ta.value, caret.s);
    // cells show "|" as typed; tableText escapes it again
    function unesc(c) { return String(c).replace(/\\\|/g, "|"); }
    var head = found ? found.head.map(unesc) : [t("tb.col") + " 1", t("tb.col") + " 2"];
    var rows = found ? found.rows.map(function (r) { return r.map(unesc); }) : [["", ""]];
    var al = found ? found.al.slice() : [];
    var body = el("div", "form");
    body.appendChild(el("p", "hint small", t("tbl.hint")));
    var wrap = el("div", "te-wrap");
    body.appendChild(wrap);
    var acts = el("div", "chips");
    acts.appendChild(btn("chip small", "+ " + t("tbl.addRow"), function () { read(); rows.push([]); draw(); focusCell(rows.length, 0); }));
    acts.appendChild(btn("chip small", "+ " + t("tbl.addCol"), function () { read(); head.push(""); draw(); focusCell(0, cols() - 1); }));
    body.appendChild(acts);
    function cols() { var n = Math.max(1, head.length); rows.forEach(function (r) { n = Math.max(n, r.length); }); return n; }
    function read() {
      var tb = wrap.querySelector("table");
      if (!tb) return;
      [].forEach.call(tb.querySelectorAll("input[data-r]"), function (i) {
        var r = Number(i.getAttribute("data-r")), c = Number(i.getAttribute("data-c"));
        if (r === 0) head[c] = i.value; else { rows[r - 1] = rows[r - 1] || []; rows[r - 1][c] = i.value; }
      });
      [].forEach.call(tb.querySelectorAll("select[data-c]"), function (s) { al[Number(s.getAttribute("data-c"))] = s.value; });
    }
    function focusCell(r, c) { var i = wrap.querySelector('input[data-r="' + r + '"][data-c="' + c + '"]'); if (i) i.focus(); }
    function draw() {
      var n = cols();
      wrap.textContent = "";
      var tb = el("table", "te");
      var top = el("tr");
      top.appendChild(el("td"));
      for (var c = 0; c < n; c++) {
        var td = el("td", "te-ctl");
        var s = sel([["", t("tbl.auto")], ["left", t("tbl.left")], ["center", t("tbl.center")], ["right", t("tbl.right")]], al[c] || "");
        s.setAttribute("data-c", String(c));
        s.setAttribute("aria-label", t("tbl.align", { n: c + 1 }));
        td.appendChild(s);
        if (n > 1) {
          var dc = btn("icon-btn small", null, (function (cc) { return function () { read(); head.splice(cc, 1); rows.forEach(function (r) { r.splice(cc, 1); }); al.splice(cc, 1); draw(); }; })(c));
          dc.innerHTML = ICON.close;
          setLabel(dc, t("tbl.delCol", { n: c + 1 }));
          td.appendChild(dc);
        }
        top.appendChild(td);
      }
      tb.appendChild(top);
      [head].concat(rows).forEach(function (cells, r) {
        var tr = el("tr", r === 0 ? "te-head" : "");
        var lead = el("td", "te-ctl");
        if (r > 0) {
          var dr = btn("icon-btn small", null, function () { read(); rows.splice(r - 1, 1); draw(); });
          dr.innerHTML = ICON.close;
          setLabel(dr, t("tbl.delRow", { n: r }));
          lead.appendChild(dr);
        }
        tr.appendChild(lead);
        for (var c2 = 0; c2 < n; c2++) {
          var td2 = el("td");
          var i = inp(cells[c2] || "", "", 1000);
          i.setAttribute("data-r", String(r));
          i.setAttribute("data-c", String(c2));
          i.setAttribute("aria-label", r === 0 ? t("tbl.head") + " " + (c2 + 1) : t("tbl.cell", { r: r, c: c2 + 1 }));
          td2.appendChild(i);
          tr.appendChild(td2);
        }
        tb.appendChild(tr);
      });
      wrap.appendChild(tb);
    }
    draw();
    openForm({
      title: t("tbl.title"), body: body, ok: t("tbl.save"),
      done: function () {
        read();
        var text = C.tableText(head, rows, al);
        var ta2 = $("ed-text");
        var cur = found && ta2 ? C.tableAt(ta2.value, found.start) : null;
        if (cur && cur.start === found.start) replaceRange(cur.start, cur.end, text);
        else putBlock(text);
      }
    });
  }

  // Print: the shell prints this frame with the print styles.
  function printArt(a) {
    if (!view || view.v !== "art" || view.a !== a.id) openArt(a);
    setTimeout(function () { try { window.focus(); window.print(); } catch (e) {} }, 300);
  }
  // Save as PDF: jsPDF + the Noto fonts, all vendored, loaded on first use.
  var jspdfP = null, fontsP = null;
  function loadJsPDF() {
    if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
    if (jspdfP) return jspdfP;
    jspdfP = new Promise(function (resolve, reject) {
      var sc = document.createElement("script");
      sc.src = "../vendor/jspdf.umd.min.js";
      sc.onload = function () { if (window.jspdf && window.jspdf.jsPDF) resolve(window.jspdf.jsPDF); else reject(new Error("jspdf")); };
      sc.onerror = function () { jspdfP = null; sc.remove(); reject(new Error("jspdf")); };
      document.head.appendChild(sc);
    });
    return jspdfP;
  }
  function fontB64(url) {
    return fetch(url).then(function (r) { if (!r.ok) throw new Error("font"); return r.arrayBuffer(); }).then(function (buf) {
      var u8 = new Uint8Array(buf), bin = "";
      for (var i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
      return btoa(bin);
    });
  }
  function loadFonts() {
    if (fontsP) return fontsP;
    var names = window.WikiPdf.FONTS;
    fontsP = Promise.all(names.map(function (n) { return fontB64("../vendor/noto/" + n + ".ttf"); }))
      .then(function (list) { var o = {}; names.forEach(function (n, i) { o[n] = list[i]; }); return o; })
      .catch(function (e) { fontsP = null; throw e; });
    return fontsP;
  }
  function pdfImage(id) {
    var A = AS();
    if (!A) return Promise.resolve(null);
    return A.blob(id).then(function (b) {
      if (!b) return null;
      return A.decode(b).then(function (img) {
        return b.arrayBuffer().then(function (ab) { return { data: new Uint8Array(ab), w: img.naturalWidth, h: img.naturalHeight }; });
      });
    }).catch(function () { return null; });
  }
  function dialogHost() {
    try { return window.orosDialog || (window.parent && window.parent.orosDialog) || null; }
    catch (e) { return window.orosDialog || null; }
  }
  function saveBlob(blob, name, mime, ext) {
    var dlg = dialogHost();
    if (dlg && typeof dlg.saveFile === "function") {
      var acc = {};
      acc[mime] = ["." + ext];
      dlg.saveFile({ blob: blob, filename: name, mime: mime, types: [{ description: ext.toUpperCase(), accept: acc }] })
        .then(function (r) { if (r && r.ok) toast(t("toast.file")); }, function () {});
      return;
    }
    var url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }
  var pdfBusy = false;
  function pdfArt(a) {
    if (pdfBusy || !window.WikiPdf) return;
    pdfBusy = true;
    toast(t("toast.pdfBusy"));
    var parsed = C.parseDoc(a.x), imgs = {};
    var chain = Promise.resolve();
    C.images(parsed).forEach(function (id) {
      chain = chain.then(function () { return pdfImage(id); }).then(function (p) { if (p) imgs[id] = p; });
    });
    Promise.all([loadJsPDF(), loadFonts(), chain]).then(function (r) {
      var w = curWiki();
      var doc = window.WikiPdf.build(r[0], r[1], {
        title: a.t, sub: [wikiName(w), t("art.lastEdit", { d: fmtDate(a.m) })].filter(Boolean).join(" · "),
        parsed: parsed, imgs: imgs, L: { refs: t("art.refs"), missingImg: t("img.missing") }
      });
      var stem = (C.slug(a.t) || "article").replace(/_/g, "-").slice(0, 60);
      saveBlob(doc.output("blob"), stem + ".pdf", "application/pdf", "pdf");
    }).catch(function (e) {
      try { console.error("[orOS wiki] pdf", e); } catch (x) {}
      toast(t("toast.pdfFail"));
    }).then(function () { pdfBusy = false; });
  }

  // ---------- 5c. Import, export, Wikipedia, sending (wave 3) ----------
  // Converters live in io.js (pure). Imports only ADD articles (titles
  // made unique), each one with its first revision on the orOS disk.
  function IO() { return window.WikiIO; }
  var scriptP = {};
  function loadScript(src, ready) {
    if (ready()) return Promise.resolve();
    if (scriptP[src]) return scriptP[src];
    scriptP[src] = new Promise(function (resolve, reject) {
      var sc = document.createElement("script");
      sc.src = src;
      sc.onload = function () { if (ready()) resolve(); else reject(new Error(src)); };
      sc.onerror = function () { delete scriptP[src]; sc.remove(); reject(new Error(src)); };
      document.head.appendChild(sc);
    });
    return scriptP[src];
  }
  function loadZip() {
    return loadScript("../atelier/zip.js", function () { return !!window.AtelierZip; }).then(function () { return window.AtelierZip; });
  }
  function ymd(d) {
    d = d || new Date();
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  }
  function takenTitles(w) {
    var o = {}, ix = C.titleIndex(data, w.id);
    Object.keys(ix).forEach(function (k) { o[k] = true; });
    return o;
  }
  // A wiki object for an import (not saved yet).
  function newWikiObj(name) {
    if (data.wikis.length >= C.MAX_WIKIS) { toast(t("err.wikis")); return null; }
    var w = { id: C.uid("w"), m: now(), n: String(name || "").replace(/\s+/g, " ").trim().slice(0, 80) || t("imp.wiki"), main: "" };
    data.wikis.push(w);
    return w;
  }
  // Add [{ t, x }] to wiki w (titles already unique). → { n, cut } or null
  function addArticles(w, list, sum, isNew) {
    var room = Math.max(0, C.MAX_ARTS - C.live(data, w.id).length);
    var take = list.slice(0, room), added = [], m0 = now();
    take.forEach(function (it, i) {
      var m = m0 + i;
      var art = C.normArt({ id: C.uid("a"), m: m, w: w.id, t: it.t, x: it.x, r: C.uid("r"), anc: [], alt: [], s: sum, c: m });
      if (art) { data.arts.push(art); added.push(art); }
    });
    if (isNew && added.length) w.main = added[0].id;
    if (!added.length || !persist()) {
      var ids = {};
      added.forEach(function (a) { ids[a.id] = 1; });
      data.arts = data.arts.filter(function (a) { return !ids[a.id]; });
      if (isNew) data.wikis = data.wikis.filter(function (x) { return x.id !== w.id; });
      return null;
    }
    var F = fsApi(), chain = Promise.resolve(), bad = 0;
    if (F && typeof F.writeText === "function") {
      added.forEach(function (a) {
        chain = chain.then(function () { return F.writeText(C.revPath(a.id, a.m, a.r), JSON.stringify(C.revFile(a, "", ""))); })
          .catch(function () { bad++; });
      });
      chain.then(function () { if (bad) toast(t("toast.histFail")); });
    }
    return { n: added.length, cut: take.length < list.length };
  }
  function importDone(w, r) {
    prefs.w = w.id; prefs.a = ""; savePrefs();
    stack = [];
    view = null;
    if (r.cut) toast(t("imp.cut", { n: r.n }));
    else toast(r.n === 1 ? t("imp.done1") : t("imp.done", { n: r.n }));
    go({ v: "all" });
  }

  function ioDialog() {
    closeSide(true);
    var w = curWiki();
    var body = el("div", "form io");
    body.appendChild(el("p", "hint small", t("io.lead")));
    function row(label, hint, fn, off) {
      var r = el("div", "io-row");
      var b = btn("chip", label, function () { hideDlg(); fn(); });
      b.disabled = !!off;
      r.appendChild(b);
      r.appendChild(el("p", "hint small", hint));
      body.appendChild(r);
    }
    body.appendChild(el("h3", "io-h", t("io.import")));
    row(t("io.notes"), t("io.notesHint"), notesDialog);
    row(t("io.md"), t("io.mdHint"), filePick);
    row(t("io.wp"), t("io.wpHint"), function () { wpDialog("", false); }, !w);
    body.appendChild(el("h3", "io-h", t("io.export")));
    row(t("io.mdOut"), t("io.mdOutHint"), exportMd, !w);
    row(t("io.site"), t("io.siteHint"), exportSite, !w);
    openForm({ title: t("io.title"), body: body, cancel: t("btn.close") });
  }

  // --- Notes notebook → wiki ---
  function notesDialog() {
    var nd = null;
    try { nd = JSON.parse(localStorage.getItem("oros-notes-data") || "null"); } catch (e) {}
    var books = IO().notesBooks(nd);
    if (!books.length) { toast(t("notes.none")); return; }
    var w = curWiki();
    var body = el("div", "form");
    var book = sel(books.map(function (b) {
      var name = b.name || t("imp.untitled");
      return [b.id, b.n === 1 ? t("notes.pages1", { t: name }) : t("notes.pages", { t: name, n: b.n })];
    }), books[0].id);
    body.appendChild(field(t("notes.book"), book));
    var where = sel([["new", ""]].concat(w ? [["cur", t("notes.cur", { t: wikiName(w) })]] : []), "new");
    function label() {
      var b = books.filter(function (x) { return x.id === book.value; })[0];
      where.options[0].textContent = t("notes.new", { t: (b && b.name) || t("imp.untitled") });
    }
    book.addEventListener("change", label);
    label();
    body.appendChild(field(t("notes.where"), where));
    openForm({
      title: t("notes.title"), body: body, ok: t("notes.ok"),
      done: function () {
        var b = books.filter(function (x) { return x.id === book.value; })[0];
        var isNew = where.value === "new" || !curWiki();
        var target = isNew ? null : curWiki();
        var res = IO().fromNotes(nd, book.value, target ? takenTitles(target) : {}, t("imp.untitled"), LANG === "el" ? "Κατηγορία" : "Category");
        if (!res || !res.arts.length) { toast(t("imp.none")); return; }
        if (isNew) target = newWikiObj((b && b.name) || t("imp.wiki"));
        if (!target) return;
        var r = addArticles(target, res.arts, t("sum.notes"), isNew);
        if (r) importDone(target, r);
      }
    });
  }

  // --- Files from other wikis → wiki (import.js, wave 4) ---
  // Markdown, Notion, TiddlyWiki, MediaWiki, Confluence: read → detect
  // + parse (pure) → preview → pictures to the orOS disk → ONE write
  // (persist: one dirty mark) → a toast with Undo. Article ids come
  // from the source, so importing again updates the articles still as
  // imported and leaves alone the ones changed here since. Everything
  // from a file reaches the page through textContent only.
  function IMP() { return window.OrosWikiImport; }
  var IMP_MAX = 60 * 1024 * 1024;
  var IMP_SRC = { markdown: "Markdown", notion: "Notion", tiddlywiki: "TiddlyWiki", mediawiki: "MediaWiki", confluence: "Confluence" };
  var impBusy = false;
  function filePick() {
    if (!IMP()) return;
    var host = null;
    try { host = shell() && shell().orosDialog; } catch (e) { host = null; }
    if (host && typeof host.openFiles === "function") {
      host.openFiles(IMP().ACCEPT).then(function (files) { if (files && files.length) fileImport([].slice.call(files)); });
      return;
    }
    var f = document.createElement("input");
    f.type = "file";
    f.multiple = true;
    f.accept = IMP().ACCEPT;
    f.addEventListener("change", function () { fileImport([].slice.call(f.files || [])); });
    f.click();
  }
  // Also the handle for a file opened with orOS / tests (Promise<bool>)
  function fileImport(files) {
    var K = window.OrosImportKit;
    if (!files.length || impBusy || !IMP() || !K) return Promise.resolve(false);
    impBusy = true;
    toast(t("imp.busy"));
    var items = [], chain = Promise.resolve();
    files.forEach(function (f) {
      chain = chain.then(function () { return K.readFile(f, IMP_MAX); }).then(function (r) { items.push(r); });
    });
    return chain.then(function () {
      return items.some(function (it) { return K.isZip(it.bytes); }) ? loadZip() : null;
    }).then(function (Zip) { return IMP().readBundle(items, Zip); }).then(function (b) {
      var res = IMP().parse(b, { lang: LANG, untitled: t("imp.untitled") });
      impBusy = false;
      if (!res || !res.pages.length) { toast(t("imp.none")); return false; }
      importPreview(res, b);
      return true;
    }).catch(function (e) {
      impBusy = false;
      try { console.error("[orOS wiki] import", e); } catch (x) {}
      toast(t(e && e.message === "toobig" ? "ix.big" : "imp.fail"));
      return false;
    });
  }
  function catWord() { return LANG === "el" ? "Κατηγορία" : "Category"; }
  // Pictures the import will store: those of pages added or updated.
  function picsFor(res, pl) {
    var on = {}, out = [];
    pl.items.forEach(function (it) {
      if (it.act !== "add" && it.act !== "update") return;
      it.page.x.replace(/\u0002(\d+)\u0002/g, function (m, n) { if (!on[n]) { on[n] = 1; out.push(Number(n)); } return m; });
    });
    return out;
  }
  var SHORT = null;
  function fmtShort(ms) {
    try {
      SHORT = SHORT || new Intl.DateTimeFormat(LANG === "el" ? "el-GR" : "en-GB", { dateStyle: "medium" });
      return SHORT.format(new Date(ms));
    } catch (e) { return new Date(ms).toISOString().slice(0, 10); }
  }
  function importPreview(res, b) {
    var w = curWiki(), src = IMP_SRC[res.source] || res.source;
    var newName = res.name || t("imp.wiki"), newId = C.uid("w");
    var body = el("div", "form imp-prev");
    var where = sel([["new", t("notes.new", { t: newName })]].concat(w ? [["cur", t("notes.cur", { t: wikiName(w) })]] : []), w ? "cur" : "new");
    body.appendChild(field(t("notes.where"), where));
    var info = el("ul", "imp-info");
    body.appendChild(info);
    var map = el("p", "hint small", t("ix.map." + res.source));
    body.appendChild(map);
    var pl = null;
    function wid() { return where.value === "cur" && curWiki() ? curWiki().id : newId; }
    function line(s, cls) { if (s) info.appendChild(el("li", cls || null, s)); }
    function show() {
      pl = IMP().plan(data, wid(), res, { untitled: t("imp.untitled") });
      var n = pl.n, sk = res.skipped;
      info.textContent = "";
      line(tn("ix.pages", res.pages.length));
      if (res.range) line(t("ix.range", { a: fmtShort(res.range[0]), b: fmtShort(res.range[1]) }));
      if (n.add) line(tn("ix.add", n.add), "imp-strong");
      if (n.update) line(tn("ix.update", n.update), "imp-strong");
      if (n.same) line(tn("ix.same", n.same));
      if (n.edited) line(tn("ix.edited", n.edited));
      if (n.renamed) line(tn("ix.renamed", n.renamed));
      if (n.cut) line(tn("ix.cut", n.cut), "imp-warn");
      var np = picsFor(res, pl).length;
      if (np) line(tn("ix.pics", np));
      if (sk.system) line(tn("ix.skipSystem", sk.system));
      if (sk.other) line(tn(res.source === "mediawiki" ? "ix.skipNs" : "ix.skipType", sk.other));
      if (sk.empty) line(tn("ix.empty", sk.empty));
      if (sk.cut) line(tn("ix.skipCut", sk.cut), "imp-warn");
      if (!n.add && !n.update) line(t("ix.nothing"), "imp-strong");
    }
    where.addEventListener("change", show);
    show();
    openForm({
      title: t("ix.title", { s: src }), body: body, ok: t("ix.ok"),
      check: function () { show(); return pl.n.add || pl.n.update ? "" : t("ix.nothing"); },
      done: function () { runImport(res, b, wid(), wid() === newId ? newName : "", src); }
    });
  }
  function runImport(res, b, wid, newName, src) {
    var isNew = !!newName && !C.wikiById(data, wid);
    if (isNew && data.wikis.length >= C.MAX_WIKIS) { toast(t("err.wikis")); return; }
    var opt = { untitled: t("imp.untitled") };
    var pl = IMP().plan(data, wid, res, opt);
    var need = picsFor(res, pl), ids = [], A = AS(), chain = Promise.resolve();
    if (need.length) toast(t("toast.importing"));
    need.forEach(function (i) {
      chain = chain.then(function () {
        var pic = b.pics[res.pics[i]];
        if (!A || !fsApi() || !pic) return "";
        return pic.load().then(function (bytes) {
          if (!bytes) return "";
          var name = pic.path.split("/").pop(), blob = new Blob([bytes]);
          // our own Markdown export names pictures by their id
          if (C.IMG_RE.test(name)) return A.put(name, blob).catch(function () { return A.importFile(new File([blob], name)).then(function (r) { return r.id; }); });
          return A.importFile(new File([blob], name)).then(function (r) { return r.id; });
        });
      }).then(function (id) { ids[i] = id || ""; }, function () { ids[i] = ""; });
    });
    chain.then(function () {
      // the data may have changed while the pictures were stored (sync)
      pl = IMP().plan(data, wid, res, opt);
      var r = IMP().apply(data, pl, res, {
        now: now(), sum: t("sum.imp", { s: src }), lang: LANG, catWord: catWord(), picIds: ids,
        newWiki: isNew ? { id: wid, n: newName } : null
      });
      if (!r.added.length && !r.updated.length) { toast(t("ix.nothing")); return; }
      var before = data;
      data = r.data;
      if (!persist()) { data = before; renderSide(); return; }   // one write, one dirty mark
      writeRevs(r.added.map(function (a) { return [a, ""]; }).concat(r.updated.map(function (u) { return [u.art, u.prev.r]; })));
      prefs.w = wid; prefs.a = ""; savePrefs();
      stack = [];
      view = null;
      go({ v: "all" });
      var msg = r.updated.length ? t("ix.doneU", { n: r.added.length, u: r.updated.length }) : tn("imp.done", r.added.length);
      var used = false;
      toast(msg, t("btn.undo"), function () {
        if (used) return;
        used = true;
        var prev = data;
        data = C.merge(IMP().undo(data, r.info, now()), null);
        if (!persist()) { data = prev; return; }
        stack = [];
        view = null;
        if (C.wikiById(data, prefs.w)) go({ v: "all" }); else goMain();
        toast(t("ix.undone"));
      });
    });
  }
  // History files for imported revisions, one after another.
  function writeRevs(list) {
    var F = fsApi(), chain = Promise.resolve(), bad = 0;
    if (!F || typeof F.writeText !== "function") return;
    list.forEach(function (p) {
      chain = chain.then(function () { return F.writeText(C.revPath(p[0].id, p[0].m, p[0].r), JSON.stringify(C.revFile(p[0], p[1], ""))); })
        .catch(function () { bad++; });
    });
    chain.then(function () { if (bad) toast(t("toast.histFail")); });
  }

  // --- this wiki → Markdown zip / website zip ---
  var expBusy = false;
  function zipName(w, tail) {
    return (IO().fileStem(wikiName(w)) || "wiki") + tail + "-" + ymd() + ".zip";
  }
  function mediaFiles(ids) {
    var out = [], A = AS(), chain = Promise.resolve();
    ids.forEach(function (id) {
      chain = chain.then(function () { return A ? A.blob(id) : null; })
        .then(function (b) { return b ? b.arrayBuffer() : null; })
        .then(function (ab) { if (ab) out.push({ name: "media/" + id, data: new Uint8Array(ab), id: id }); }, function () {});
    });
    return chain.then(function () { return out; });
  }
  function exportRun(fn) {
    var w = curWiki();
    if (!w || expBusy) return;
    var arts = C.live(data, w.id).sort(C.byTitle);
    if (!arts.length) { toast(t("exp.empty")); return; }
    expBusy = true;
    toast(t("exp.busy"));
    Promise.all([loadZip(), fn(w, arts)]).then(function (r) {
      var bytes = r[0].write(r[1].files, new Date());
      saveBlob(new Blob([bytes], { type: "application/zip" }), r[1].name, "application/zip", "zip");
    }).catch(function (e) {
      try { console.error("[orOS wiki] export", e); } catch (x) {}
      toast(t("exp.fail"));
    }).then(function () { expBusy = false; });
  }
  function usedImages(arts) {
    var seen = {}, ids = [];
    arts.forEach(function (a) { C.images(C.parseDoc(a.x)).forEach(function (id) { if (!seen[id]) { seen[id] = 1; ids.push(id); } }); });
    return ids;
  }
  function exportMd() {
    exportRun(function (w, arts) {
      var used = {}, files = arts.map(function (a) {
        return { name: IO().uniqueFile(IO().fileStem(a.t), ".md", used), data: IO().toMarkdown(a) };
      });
      return mediaFiles(usedImages(arts)).then(function (media) {
        return { files: files.concat(media), name: zipName(w, "-markdown") };
      });
    });
  }
  function exportSite() {
    exportRun(function (w, arts) {
      return mediaFiles(usedImages(arts)).then(function (media) {
        var have = {};
        media.forEach(function (m) { have[m.id] = 1; });
        var used = { "index.html": 1, "all.html": 1, "categories.html": 1, "style.css": 1 };
        var fileOf = {};
        arts.forEach(function (a) { fileOf[a.id] = IO().pageFile(a.t, used); });
        var cats = C.categories(data, w.id), catFile = {};
        cats.forEach(function (c) { catFile[C.fold(c.name)] = IO().pageFile("category " + c.name, used); });
        var ix = C.titleIndex(data, w.id), doc = document.implementation.createHTMLDocument("");
        var L = { main: t("site.main"), all: t("site.all"), cats: t("site.cats") };
        var opts = { state: function (to) { return C.resolve(data, w.id, to, ix).art ? "ok" : "new"; },
                     toc: t("art.toc"), refs: t("art.refs"), refUp: t("art.refUp"), refMissing: t("art.refMissing") };
        function catHref(name) { var f = catFile[C.fold(name)]; return f ? IO().href(f) : ""; }
        function fix(root) {
          [].slice.call(root.querySelectorAll("a[data-to], a[data-cat], a[data-anchor], a[data-ref], a[data-cite], a.wl")).forEach(function (n) {
            var h = "";
            if (n.hasAttribute("data-to")) {
              var to = n.getAttribute("data-to"), fr = n.getAttribute("data-frag") || "";
              var r = to ? C.resolve(data, w.id, to, ix).art : null;
              if (r) h = IO().href(fileOf[r.id]) + (fr ? "#s-" + C.slug(fr) : "");
              else if (!to && fr) h = "#s-" + C.slug(fr);
            } else if (n.hasAttribute("data-cat")) h = catHref(n.getAttribute("data-cat"));
            else if (n.hasAttribute("data-anchor")) h = "#s-" + n.getAttribute("data-anchor");
            else if (n.hasAttribute("data-ref")) h = "#ref-" + n.getAttribute("data-ref");
            else if (n.hasAttribute("data-cite")) h = "#" + n.getAttribute("data-cite");
            if (h) {
              n.setAttribute("href", h);
              ["data-to", "data-frag", "data-cat", "data-anchor", "data-ref", "data-cite"].forEach(function (k) { n.removeAttribute(k); });
            } else {
              var sp = doc.createElement("span");
              sp.className = n.className;
              sp.textContent = n.textContent;
              n.parentNode.replaceChild(sp, n);
            }
          });
          [].slice.call(root.querySelectorAll("img[data-img]")).forEach(function (im) {
            var id = im.getAttribute("data-img");
            im.removeAttribute("data-img");
            if (have[id]) im.setAttribute("src", "media/" + id);
            else {
              var sp = doc.createElement("span");
              sp.className = "img-missing";
              sp.textContent = im.getAttribute("alt") || t("img.missing");
              im.parentNode.replaceChild(sp, im);
            }
          });
        }
        function catsHtml(list) {
          if (!list.length) return "";
          var box = doc.createElement("div");
          box.className = "cats";
          box.appendChild(doc.createTextNode((list.length === 1 ? t("art.cat1") : t("art.cats")) + ": "));
          list.forEach(function (c) {
            var a = doc.createElement("a");
            a.setAttribute("href", catHref(c));
            a.textContent = c;
            box.appendChild(a);
          });
          return box.outerHTML;
        }
        function articleHtml(a) {
          var inf = C.info(a), box = doc.createElement("div");
          if (inf.redirect) {
            var p = doc.createElement("p");
            p.className = "redir";
            p.appendChild(doc.createTextNode("↳ " + t("site.redirect") + " "));
            var l = doc.createElement("a");
            l.className = "wl";
            l.setAttribute("data-to", inf.redirect);
            l.textContent = inf.redirect;
            p.appendChild(l);
            box.appendChild(p);
          } else box.appendChild(C.render(doc, C.parseDoc(a.x), opts));
          fix(box);
          return box.innerHTML + catsHtml(inf.cats);
        }
        var files = [{ name: "style.css", data: IO().SITE_CSS }];
        var main = w.main && C.byId(data, w.main);
        arts.forEach(function (a) {
          var html = IO().sitePage({ lang: LANG, wiki: wikiName(w), title: a.t, body: articleHtml(a), L: L, foot: t("site.foot", { d: fmtDate(a.m) }) });
          files.push({ name: fileOf[a.id], data: html });
          if (main && main.id === a.id) files.push({ name: "index.html", data: html });
        });
        var listed = arts.filter(function (a) { return !C.info(a).redirect; }).map(function (a) { return { t: a.t, file: fileOf[a.id] }; });
        var allHtml = IO().sitePage({ lang: LANG, wiki: wikiName(w), title: t("site.all"), body: IO().siteList(listed), L: L, foot: t("site.footList") });
        files.push({ name: "all.html", data: allHtml });
        if (!main) files.push({ name: "index.html", data: allHtml });
        files.push({ name: "categories.html", data: IO().sitePage({ lang: LANG, wiki: wikiName(w), title: t("site.cats"),
          body: IO().siteList(cats.map(function (c) { return { t: c.name + " (" + c.arts.length + ")", file: catFile[C.fold(c.name)] }; })), L: L, foot: t("site.footList") }) });
        cats.forEach(function (c) {
          files.push({ name: catFile[C.fold(c.name)], data: IO().sitePage({ lang: LANG, wiki: wikiName(w), title: t("site.cat", { t: c.name }),
            body: IO().siteList(c.arts.map(function (a) { return { t: a.t, file: fileOf[a.id] }; })), L: L, foot: t("site.footList") }) });
        });
        return { files: files.concat(media.map(function (m) { return { name: m.name, data: m.data }; })), name: zipName(w, "-website") };
      });
    });
  }

  // --- Start from Wikipedia ---
  var WP_LANGS = [["el", "Ελληνικά"], ["en", "English"], ["de", "Deutsch"], ["fr", "Français"], ["es", "Español"],
                  ["it", "Italiano"], ["pt", "Português"], ["nl", "Nederlands"]];
  function fetchJson(url) {
    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 20000);
    return fetch(url, { credentials: "omit", referrerPolicy: "no-referrer", signal: ctl ? ctl.signal : undefined })
      .then(function (r) { if (!r.ok) throw new Error("http " + r.status); return r.json(); })
      .then(function (j) { clearTimeout(timer); return j; }, function (e) { clearTimeout(timer); throw e; });
  }
  // inEditor: fill the open editor of a new article instead of opening one
  function wpDialog(title, inEditor) {
    if (!curWiki() || !IO()) return;
    var body = el("div", "form");
    var lang = sel(WP_LANGS, LANG === "el" ? "el" : "en");
    body.appendChild(field(t("wp.lang"), lang));
    var q = inp(title || "", t("wp.ph"), 300);
    q.type = "search";
    q.enterKeyHint = "go";
    body.appendChild(field(t("wp.q"), q));
    var sugg = el("div", "wp-sugg");
    body.appendChild(sugg);
    body.appendChild(el("p", "hint small", t("wp.privacy")));
    var busy = false, gen = 0, timer = 0;
    function suggest() {
      clearTimeout(timer);
      var v = q.value.trim(), my = ++gen;
      if (!busy) $("form-err").textContent = "";
      if (v.length < 2 || IO().wpFromUrl(v)) { sugg.textContent = ""; return; }
      timer = setTimeout(function () {
        fetchJson(IO().wpSearchUrl(lang.value, v)).then(function (j) {
          if (my !== gen) return;
          var list = IO().wpSearchAnswer(j);
          sugg.textContent = "";
          if (!list.length) return;
          sugg.appendChild(el("span", "lbl", t("wp.sugg")));
          list.forEach(function (s) { sugg.appendChild(btn("chip small", s, function () { q.value = s; fetchIt(); })); });
        }, function () {});
      }, 350);
    }
    q.addEventListener("input", suggest);
    lang.addEventListener("change", suggest);
    q.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); fetchIt(); } });
    function fetchIt() {
      if (busy) return;
      var v = q.value.trim(), lg = lang.value;
      var fromUrl = IO().wpFromUrl(v);
      if (fromUrl) { v = fromUrl.title; lg = fromUrl.lang; }
      if (!v) { $("form-err").textContent = t("wp.empty"); return; }
      busy = true;
      gen++;
      $("form-err").textContent = t("wp.busy");
      fetchJson(IO().wpParseUrl(lg, v)).then(function (j) {
        busy = false;
        var ans = IO().wpParseAnswer(j);
        if (ans.error) { $("form-err").textContent = t(ans.error === "missing" ? "wp.missing" : "wp.fail"); return; }
        var res = IO().fromWikipedia(ans, { lang: lg, ui: LANG, date: ymd() });
        formCur = null;
        hideDlg();
        useArticle(res, inEditor);
      }, function () {
        busy = false;
        $("form-err").textContent = t("wp.fail");
      });
    }
    openForm({ title: t("wp.title"), body: body, ok: t("wp.ok"), submit: fetchIt });
    if (title) suggest();
  }
  function useArticle(res, inEditor) {
    var w = curWiki();
    if (inEditor && ed && !ed.a && $("ed-text")) {
      var nameIn = $("ed-name");
      var keep = C.cleanTitle(nameIn.value);
      if (!keep || idx()[C.fold(keep)]) nameIn.value = IO().uniqueTitle(res.t, takenTitles(w));
      $("ed-text").value = res.x;
      $("ed-sum").value = t("wp.sum");
      edTab("write");
      saveDraftSoon();
      toast(t("wp.edit"));
      return;
    }
    startEdit({ title: IO().uniqueTitle(res.t, takenTitles(w)), text: res.x, sum: t("wp.sum") });
    toast(t("wp.edit"));
  }
  function wpFromEditor() {
    var ta = $("ed-text");
    var go2 = function () { wpDialog($("ed-name") ? $("ed-name").value : "", true); };
    if (ta && ta.value.trim()) ask(t("wp.replace"), t("wp.replaceBtn"), go2);
    else go2();
  }

  // --- Send to someone (share kind "wiki": title + text, no pictures) ---
  function shareApi() {
    try { return window.parent !== window && window.parent.orosShare ? window.parent.orosShare : null; } catch (e) { return null; }
  }
  function sendArt(a) {
    var api = shareApi();
    if (!api || !IO()) { toast(t("toast.noShare")); return; }
    var x = IO().shareText(a.x);
    if (C.images(C.parseDoc(a.x)).length) toast(t("send.noPics"));
    api.open({ kind: "wiki", data: { t: a.t, x: x }, text: a.t + "\n\n" + C.plainText(x) });
  }
  // From a link someone sent: a new article in the editor, not saved yet.
  function receiveArt(o) {
    var w = curWiki();
    if (!w) {
      w = newWikiObj(t("wiki.default"));
      if (!w || !persist()) return false;
      prefs.w = w.id; savePrefs();
    }
    var title = C.cleanTitle(o.t) || t("imp.untitled");
    var text = typeof o.x === "string" ? o.x.replace(/\r\n?/g, "\n").slice(0, C.MAX_TEXT) : "";
    hideDlg();
    ed = null;
    view = null;
    stack = [];
    startEdit({ title: IO().uniqueTitle(title, takenTitles(w)), text: text, sum: t("sum.recv") });
    return true;
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
    body.appendChild(C.render(document, parsed, renderOpts()));
    art.appendChild(body);
    hydrate(body);
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
    items.push([t("menu.send"), function () { sendArt(a); }]);
    items.push([t("menu.print"), function () { printArt(a); }]);
    items.push([t("menu.pdf"), function () { pdfArt(a); }]);
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
    if (!target || typeof target !== "object") return false;
    // Single app (solo.js): { newArt: { title?, text? } } → a new
    // article in the editor (icon shortcut, or a share).
    var na = target.newArt;
    if (na && typeof na === "object") {
      if (!curWiki() || (view && view.v === "edit" && ed && ed.dirty())) return false;
      hideDlg();
      startEdit({ title: typeof na.title === "string" ? na.title : "", text: typeof na.text === "string" ? na.text.slice(0, 20000) : "" });
      return true;
    }
    if (target.addArticle && typeof target.addArticle === "object") {
      if (view && view.v === "edit" && ed && ed.dirty()) return false;
      return receiveArt(target.addArticle);
    }
    if (typeof target.a !== "string") return false;
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
  // "Import from a file" without the picker: Files → the preview
  // (Promise<boolean>: something to import was found)
  window.__orosWikiImport = function (files) { return fileImport([].slice.call(files || [])); };

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
    $("wiki-io").addEventListener("click", ioDialog);
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
