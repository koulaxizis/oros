// ============================================================
// orOS Reader — App logic (v1.0.0, phase 1)
// An RSS / Atom / JSON Feed reader: an InoReader replacement.
//   - add a feed from its address OR from any page: discovery
//     (core.js) finds the page's feeds, platform feeds (YouTube,
//     Reddit, Mastodon, GitHub, …) and the usual paths
//   - folders, unread counts, All / Starred / Read later
//   - reading pane: the article is sanitized (sanitize.js) AND shown
//     in a sandboxed iframe without scripts or origin (CSP); podcast
//     and video enclosures play inside it
//   - mark as read on open, on scroll (setting), "mark all" with
//     choices and Undo; j/k keys; swipe on phones
//   - OPML import / export (orosDialog, R33)
//   - offline: what was fetched stays readable for 60 days
// Network: the page first asks the site itself; most sites send no
// CORS headers, so the rest goes through the orOS relay (relay/,
// op "web", the same Worker as Mail), in batches. Each feed
// remembers which way worked. Conditional requests (ETag), the
// feed's ttl and an exponential backoff keep the traffic low.
// Data:
//   - synced slice "feeds" (oros-feeds-data, FEEDS v1, core.js §6):
//     subscriptions, folders, saved articles, settings, read state
//   - device-local (R10): oros-feeds-prefs (selection, unread-only,
//     text size, closed folders), oros-feeds-state (per feed: next
//     check, errors, ETag, way), IndexedDB "oros-feeds" (articles:
//     "heads" and "bodies"). Never synced, never exported.
// Sections:
//   1. Constants, i18n, helpers
//   2. Data, prefs, feed state
//   3. Device store (IndexedDB)
//   4. Network: direct + relay
//   5. Refresh
//   6. Discovery
//   7. Counts + selection
//   8. UI: toolbar, side, list
//   9. UI: reader
//  10. Actions: read, star, later, mark all
//  11. Dialogs: add, feed, folder, settings, OPML
//  12. Dialogs + toasts
//  13. Keyboard + swipe
//  14. Sync slice + palette
//  15. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var C = window.orosFeedsCore;
  var STORAGE_KEY   = "oros-feeds-data";
  var PREFS_KEY     = "oros-feeds-prefs";
  var STATE_KEY     = "oros-feeds-state";
  var DB_NAME       = "oros-feeds";
  // The orOS relay. Empty until the Worker is deployed; Mail's relay
  // address is used when Mail has one, else Settings asks for it.
  var DEFAULT_RELAY = "";
  var KEEP_PER_FEED = 200;
  var PAGE          = 60;
  var DIRECT_PAR    = 4;
  var RELAY_BATCH   = 10;
  var CALL_TIMEOUT  = 30000;
  var TICK_MS       = 60000;
  var UNDO_MS       = 8000;
  var DAY           = 86400000;

  // ---------- 1. Constants, i18n, helpers ----------
  function appLang() {
    try {
      var l = localStorage.getItem("oros-lang") ||
              (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  var LANG = appLang();

  var STRINGS = {
    en: {
      "app": "Reader", "nav.side": "Subscriptions", "nav.back": "Back", "btn.refresh": "Refresh",
      "btn.add": "Add a feed", "btn.settings": "Settings", "btn.markAll": "Mark as read",
      "btn.edit": "Edit", "btn.unreadOnly": "Unread only", "btn.showAll": "Show all",
      "sel.all": "All articles", "sel.star": "Starred", "sel.later": "Read later",
      "side.feeds": "Subscriptions", "side.add": "Add a feed", "side.noFolder": "Not in a folder",
      "wel.title": "Your news, inside orOS",
      "wel.text": "Add a site or a feed address. The Reader finds the feed by itself, keeps the articles for offline reading and syncs what you read.",
      "wel.import": "Import from another reader (OPML)",
      "list.empty": "Nothing new here.", "list.emptyAll": "No articles here yet.",
      "list.emptySaved": "Nothing saved yet. Use the star or \"Read later\" on an article.",
      "list.loading": "Loading…", "list.more": "Show more", "list.count": "{n} unread",
      "list.allRead": "All read. Show all articles", "read.none": "Choose an article to read it.",
      "read.offline": "This article is not saved on this device. Connect to the internet and refresh the feed.",
      "read.star": "Star", "read.unstar": "Remove star", "read.later": "Read later", "read.unlater": "Remove from Read later",
      "read.markUnread": "Mark as unread", "read.markRead": "Mark as read", "read.open": "Open the original",
      "read.copy": "Copy the link", "read.by": "by {who}", "read.listen": "Listen", "read.watch": "Watch",
      "read.download": "Download ({size})",
      "img.blocked": "Pictures are off, so the site cannot tell you opened this.",
      "img.show": "Show pictures", "img.always": "Always for this feed",
      "embed.on": "Watch on {site}", "embed.other": "Open the embedded content ({site})",
      "net.offline": "Offline: showing articles saved on this device.",
      "net.relay": "Some feeds can only be read through the relay. Set its address in Settings.",
      "add.title": "Add a feed", "add.url": "Site or feed address", "add.ph": "e.g. news.example.gr or a YouTube channel",
      "add.find": "Find", "add.finding": "Looking for feeds…", "add.none": "No feed found on this page.",
      "add.pick": "Feeds found", "add.items": "{n} articles", "add.last": "latest {when}", "add.have": "Already subscribed",
      "add.folder": "Folder", "add.newFolder": "New folder…", "add.folderName": "Folder name",
      "add.go": "Subscribe", "add.done": "Subscribed to {name}.", "add.doneN": "{n} subscriptions added.",
      "add.bad": "This does not look like a web address.", "add.limit": "The list of subscriptions is full.",
      "feed.title": "Subscription", "feed.name": "Name", "feed.addr": "Feed address", "feed.site": "Site",
      "feed.img": "Pictures", "feed.imgDef": "As in Settings", "feed.imgOn": "Show", "feed.imgOff": "Hide",
      "feed.last": "Last checked {when}", "feed.never": "Not checked yet", "feed.via": "Read through the relay",
      "feed.unsub": "Unsubscribe", "feed.unsubQ": "Unsubscribe from {name}? Its saved articles stay in Starred / Read later.",
      "feed.refresh": "Check now",
      "folder.title": "Folder", "folder.del": "Delete folder", "folder.delQ": "Delete the folder {name}? Its feeds stay, outside any folder.",
      "mark.title": "Mark as read", "mark.all": "Everything here", "mark.day": "Older than a day",
      "mark.week": "Older than a week", "mark.done": "{n} marked as read.", "mark.undo": "Undo",
      "set.title": "Settings", "set.refresh": "Check for new articles", "set.r0": "Only when I ask",
      "set.r15": "Every 15 minutes", "set.r30": "Every 30 minutes", "set.r60": "Every hour", "set.r180": "Every 3 hours",
      "set.img": "Show pictures in articles", "set.scroll": "Mark as read while scrolling the list",
      "set.sort": "Order", "set.new": "Newest first", "set.old": "Oldest first",
      "set.font": "Text size", "set.f1": "Small", "set.f2": "Normal", "set.f3": "Large",
      "set.relay": "Relay address", "set.relayHint": "The orOS relay (https://…) reads feeds of sites that do not allow it directly. It passes the feed through and keeps nothing.",
      "set.relayMail": "Empty: the Mail app's relay is used ({url}).",
      "set.opml": "Move to or from another reader", "set.import": "Import OPML", "set.export": "Export OPML",
      "set.keep": "Articles stay on this device for 60 days (up to 200 per feed). Starred and Read later stay for ever, on every device.",
      "opml.none": "No feeds in this file.", "opml.bad": "This is not an OPML file.",
      "dlg.save": "Save", "dlg.cancel": "Cancel", "dlg.close": "Close", "dlg.ok": "OK", "dlg.delete": "Delete",
      "toast.copied": "Link copied.", "toast.updated": "Up to date.", "toast.storage": "Storage is full: the change was not saved.",
      "toast.saveFail": "The file was not saved.", "toast.relayBad": "Not a valid relay address (https://…).",
      "err.offline": "You are offline.", "err.cors": "This site does not allow direct reading: it needs the relay.",
      "err.norelay": "This site needs the relay. Set its address in Settings.",
      "err.network": "The site could not be reached.", "err.timeout": "The site took too long to answer.",
      "err.http": "The site answered with an error ({code}).", "err.gone": "The feed is no longer there ({code}).",
      "err.notfeed": "The address does not hold a feed.", "err.relay": "The relay did not answer properly.",
      "err.rate": "Too many requests: trying again later.", "err.too-big": "The feed is too large.",
      "err.host": "This address is not allowed.", "err.type": "The address holds a file, not a feed.",
      "err.budget": "Will try again shortly.", "err.origin": "The relay does not accept this page (ALLOWED_ORIGINS).",
      "when.now": "just now", "when.min": "{n} min ago", "when.hour": "{n} h ago", "when.yday": "yesterday"
    },
    el: {
      "app": "Αναγνώστης", "nav.side": "Συνδρομές", "nav.back": "Πίσω", "btn.refresh": "Ανανέωση",
      "btn.add": "Προσθήκη feed", "btn.settings": "Ρυθμίσεις", "btn.markAll": "Σήμανση ως διαβασμένα",
      "btn.edit": "Επεξεργασία", "btn.unreadOnly": "Μόνο αδιάβαστα", "btn.showAll": "Όλα",
      "sel.all": "Όλα τα άρθρα", "sel.star": "Με αστέρι", "sel.later": "Για αργότερα",
      "side.feeds": "Συνδρομές", "side.add": "Προσθήκη feed", "side.noFolder": "Εκτός φακέλου",
      "wel.title": "Οι ειδήσεις σου, μέσα στο orOS",
      "wel.text": "Πρόσθεσε ένα site ή τη διεύθυνση ενός feed. Ο Αναγνώστης βρίσκει μόνος του το feed, κρατά τα άρθρα για ανάγνωση offline και συγχρονίζει ό,τι διάβασες.",
      "wel.import": "Εισαγωγή από άλλο πρόγραμμα (OPML)",
      "list.empty": "Τίποτα καινούριο εδώ.", "list.emptyAll": "Δεν υπάρχουν ακόμη άρθρα εδώ.",
      "list.emptySaved": "Δεν έχεις κρατήσει τίποτα. Βάλε αστέρι ή «Για αργότερα» σε ένα άρθρο.",
      "list.loading": "Φόρτωση…", "list.more": "Περισσότερα", "list.count": "{n} αδιάβαστα",
      "list.allRead": "Διάβασες τα πάντα. Εμφάνιση όλων", "read.none": "Διάλεξε ένα άρθρο για να το διαβάσεις.",
      "read.offline": "Αυτό το άρθρο δεν είναι αποθηκευμένο σε αυτή τη συσκευή. Σύνδεσε το internet και ανανέωσε το feed.",
      "read.star": "Αστέρι", "read.unstar": "Αφαίρεση αστεριού", "read.later": "Για αργότερα", "read.unlater": "Αφαίρεση από «Για αργότερα»",
      "read.markUnread": "Σήμανση ως αδιάβαστο", "read.markRead": "Σήμανση ως διαβασμένο", "read.open": "Άνοιγμα του πρωτοτύπου",
      "read.copy": "Αντιγραφή συνδέσμου", "read.by": "από {who}", "read.listen": "Ακρόαση", "read.watch": "Προβολή",
      "read.download": "Λήψη ({size})",
      "img.blocked": "Οι εικόνες είναι κλειστές, για να μη μαθαίνει το site ότι το άνοιξες.",
      "img.show": "Εμφάνιση εικόνων", "img.always": "Πάντα για αυτό το feed",
      "embed.on": "Προβολή στο {site}", "embed.other": "Άνοιγμα του ενσωματωμένου περιεχομένου ({site})",
      "net.offline": "Χωρίς σύνδεση: βλέπεις τα άρθρα που έχει αυτή η συσκευή.",
      "net.relay": "Κάποια feeds διαβάζονται μόνο μέσω του relay. Βάλε τη διεύθυνσή του στις Ρυθμίσεις.",
      "add.title": "Προσθήκη feed", "add.url": "Διεύθυνση site ή feed", "add.ph": "π.χ. news.example.gr ή ένα κανάλι YouTube",
      "add.find": "Αναζήτηση", "add.finding": "Ψάχνω για feeds…", "add.none": "Δεν βρέθηκε feed σε αυτή τη σελίδα.",
      "add.pick": "Feeds που βρέθηκαν", "add.items": "{n} άρθρα", "add.last": "τελευταίο {when}", "add.have": "Ήδη στις συνδρομές",
      "add.folder": "Φάκελος", "add.newFolder": "Νέος φάκελος…", "add.folderName": "Όνομα φακέλου",
      "add.go": "Εγγραφή", "add.done": "Έγινε εγγραφή στο {name}.", "add.doneN": "Προστέθηκαν {n} συνδρομές.",
      "add.bad": "Δεν μοιάζει με διεύθυνση ιστού.", "add.limit": "Η λίστα συνδρομών γέμισε.",
      "feed.title": "Συνδρομή", "feed.name": "Όνομα", "feed.addr": "Διεύθυνση feed", "feed.site": "Site",
      "feed.img": "Εικόνες", "feed.imgDef": "Όπως στις Ρυθμίσεις", "feed.imgOn": "Εμφάνιση", "feed.imgOff": "Απόκρυψη",
      "feed.last": "Τελευταίος έλεγχος {when}", "feed.never": "Δεν έχει ελεγχθεί ακόμη", "feed.via": "Διαβάζεται μέσω του relay",
      "feed.unsub": "Διαγραφή συνδρομής", "feed.unsubQ": "Διαγραφή της συνδρομής {name}; Τα άρθρα που κράτησες μένουν στα «Με αστέρι» / «Για αργότερα».",
      "feed.refresh": "Έλεγχος τώρα",
      "folder.title": "Φάκελος", "folder.del": "Διαγραφή φακέλου", "folder.delQ": "Διαγραφή του φακέλου {name}; Τα feeds του μένουν, εκτός φακέλου.",
      "mark.title": "Σήμανση ως διαβασμένα", "mark.all": "Όλα εδώ", "mark.day": "Παλαιότερα από μία ημέρα",
      "mark.week": "Παλαιότερα από μία εβδομάδα", "mark.done": "{n} σημειώθηκαν ως διαβασμένα.", "mark.undo": "Αναίρεση",
      "set.title": "Ρυθμίσεις", "set.refresh": "Έλεγχος για νέα άρθρα", "set.r0": "Μόνο όταν το ζητώ",
      "set.r15": "Κάθε 15 λεπτά", "set.r30": "Κάθε 30 λεπτά", "set.r60": "Κάθε ώρα", "set.r180": "Κάθε 3 ώρες",
      "set.img": "Εμφάνιση εικόνων στα άρθρα", "set.scroll": "Σήμανση ως διαβασμένα με την κύλιση της λίστας",
      "set.sort": "Σειρά", "set.new": "Πρώτα τα νεότερα", "set.old": "Πρώτα τα παλαιότερα",
      "set.font": "Μέγεθος κειμένου", "set.f1": "Μικρό", "set.f2": "Κανονικό", "set.f3": "Μεγάλο",
      "set.relay": "Διεύθυνση relay", "set.relayHint": "Το relay του orOS (https://…) διαβάζει feeds από sites που δεν το επιτρέπουν απευθείας. Περνά το feed και δεν κρατά τίποτα.",
      "set.relayMail": "Κενό: χρησιμοποιείται το relay της Αλληλογραφίας ({url}).",
      "set.opml": "Μεταφορά από ή προς άλλο πρόγραμμα", "set.import": "Εισαγωγή OPML", "set.export": "Εξαγωγή OPML",
      "set.keep": "Τα άρθρα μένουν σε αυτή τη συσκευή 60 ημέρες (έως 200 ανά feed). Όσα έχουν αστέρι ή είναι «Για αργότερα» μένουν για πάντα, σε κάθε συσκευή.",
      "opml.none": "Δεν υπάρχουν feeds σε αυτό το αρχείο.", "opml.bad": "Δεν είναι αρχείο OPML.",
      "dlg.save": "Αποθήκευση", "dlg.cancel": "Άκυρο", "dlg.close": "Κλείσιμο", "dlg.ok": "OK", "dlg.delete": "Διαγραφή",
      "toast.copied": "Ο σύνδεσμος αντιγράφηκε.", "toast.updated": "Όλα ενημερωμένα.", "toast.storage": "Ο χώρος γέμισε: η αλλαγή δεν αποθηκεύτηκε.",
      "toast.saveFail": "Το αρχείο δεν αποθηκεύτηκε.", "toast.relayBad": "Μη έγκυρη διεύθυνση relay (https://…).",
      "err.offline": "Δεν υπάρχει σύνδεση.", "err.cors": "Αυτό το site δεν επιτρέπει απευθείας ανάγνωση: χρειάζεται το relay.",
      "err.norelay": "Αυτό το site χρειάζεται το relay. Βάλε τη διεύθυνσή του στις Ρυθμίσεις.",
      "err.network": "Το site δεν απάντησε.", "err.timeout": "Το site άργησε πολύ να απαντήσει.",
      "err.http": "Το site απάντησε με σφάλμα ({code}).", "err.gone": "Το feed δεν υπάρχει πια ({code}).",
      "err.notfeed": "Η διεύθυνση δεν έχει feed.", "err.relay": "Το relay δεν απάντησε σωστά.",
      "err.rate": "Πάρα πολλά αιτήματα: νέα προσπάθεια αργότερα.", "err.too-big": "Το feed είναι πολύ μεγάλο.",
      "err.host": "Αυτή η διεύθυνση δεν επιτρέπεται.", "err.type": "Η διεύθυνση έχει αρχείο, όχι feed.",
      "err.budget": "Νέα προσπάθεια σε λίγο.", "err.origin": "Το relay δεν δέχεται αυτή τη σελίδα (ALLOWED_ORIGINS).",
      "when.now": "μόλις τώρα", "when.min": "πριν {n} λεπ.", "when.hour": "πριν {n} ώρ.", "when.yday": "χθες"
    }
  };

  var UI = {
    menu: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>',
    back: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>',
    refresh: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
    gear: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    plus: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    check: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="2 12 7 17 12 12"/><polyline points="10 15 12 17 22 7"/></svg>',
    dots: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
    star: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    starOn: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    clock: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    clockOn: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="var(--panel-bg)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    dot: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="7"/></svg>',
    dotOn: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="7"/></svg>',
    ext: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
    link: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
    chev: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
    all: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1.5" fill="currentColor"/></svg>',
    warn: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="7" x2="12" y2="13"/><line x1="12" y1="17" x2="12" y2="17.01"/><circle cx="12" cy="12" r="10"/></svg>',
    big: '<svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1.5" fill="currentColor"/></svg>'
  };

  function t(key, params) {
    var s = (STRINGS[LANG] && STRINGS[LANG][key]) || STRINGS.en[key] || key;
    if (params) {
      Object.keys(params).forEach(function (k) {
        s = s.split("{" + k + "}").join(String(params[k]));
      });
    }
    return s;
  }
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function svgBtn(cls, svg, label) {
    var b = el("button", cls);
    b.type = "button";
    b.innerHTML = svg;   // constant markup from UI only
    b.setAttribute("aria-label", label);
    b.title = label;
    return b;
  }
  function locale() { return LANG === "el" ? "el-GR" : "en-GB"; }
  function ago(ms) {
    if (!ms) return "";
    var d = Date.now() - ms;
    if (d < 60000) return t("when.now");
    if (d < 3600000) return t("when.min", { n: Math.floor(d / 60000) });
    if (d < 24 * 3600000 && new Date(ms).getDate() === new Date().getDate()) return t("when.hour", { n: Math.floor(d / 3600000) });
    var y = new Date(); y.setDate(y.getDate() - 1);
    if (new Date(ms).toDateString() === y.toDateString()) return t("when.yday");
    var opts = { day: "numeric", month: "short" };
    if (new Date(ms).getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
    return new Date(ms).toLocaleDateString(locale(), opts);
  }
  function fullDate(ms) {
    if (!ms) return "";
    return new Date(ms).toLocaleString(locale(), { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  function fmtSize(n) {
    if (!(n > 0)) return "";
    if (n < 1024 * 1024) return Math.max(1, Math.round(n / 1024)) + " KB";
    return (n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0) + " MB";
  }
  function hue(s) {
    var h = 0;
    s = String(s || "");
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return h;
  }
  function letter(s) {
    var m = /[\p{L}\p{N}]/u.exec(String(s || ""));
    return m ? m[0].toUpperCase() : "#";
  }
  function avatar(feed, cls) {
    var av = el("span", "fav" + (cls ? " " + cls : ""), letter(feed ? feed.title : ""));
    av.style.background = "hsl(" + hue(feed ? feed.id : "") + " 42% 40%)";
    av.setAttribute("aria-hidden", "true");
    return av;
  }

  // BOOT MARKER
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "").match(/[?&]v=([^&#]+)/);
    document.documentElement.lang = LANG;
    console.log("feeds.js v" + (m ? m[1] : "?") + " boot");
  })();

  // ---------- 2. Data, prefs, feed state ----------
  var data = C.emptyData();
  var prefs = { sel: "all", unread: 1, font: 2, closed: {} };
  var fstate = {};          // feedId -> { next, fails, err, code, via, ok, ttl, etag, lm }
  var heads = {};           // itemId -> head (all articles on this device)
  var view = "list";
  var openItem = null;      // { id, feed, head, saved, body, loading, err, imgOnce }
  var shown = PAGE;
  var sticky = {};          // read while this list is open: stay visible
  var busy = 0;             // feeds being fetched
  var undo = null;

  function now() { return Date.now(); }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      data = raw ? C.merge(JSON.parse(raw), null) : C.emptyData();
    } catch (e) { data = C.emptyData(); }
  }
  function saveData() {
    data = C.merge(data, null);   // canonical (R26)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      showToast(t("toast.storage"));
      return;
    }
    if (window.__orosSyncApi) window.__orosSyncApi.dirty();
  }
  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (p && typeof p === "object") {
        if (typeof p.sel === "string" && /^(all|star|later|f:f[a-z0-9]+|d:d[a-z0-9]+)$/.test(p.sel)) prefs.sel = p.sel;
        prefs.unread = p.unread === 0 ? 0 : 1;
        prefs.font = p.font === 1 || p.font === 3 ? p.font : 2;
        if (p.closed && typeof p.closed === "object") Object.keys(p.closed).forEach(function (k) { if (/^d[a-z0-9]+$/.test(k)) prefs.closed[k] = 1; });
      }
    } catch (e) {}
  }
  function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {} }
  function loadState() {
    try {
      var s = JSON.parse(localStorage.getItem(STATE_KEY) || "null");
      if (s && typeof s === "object") fstate = s;
    } catch (e) { fstate = {}; }
  }
  var stateTimer = null;
  function saveState() {
    clearTimeout(stateTimer);
    stateTimer = setTimeout(function () {
      Object.keys(fstate).forEach(function (id) { if (!C.feedById(data, id)) delete fstate[id]; });
      try { localStorage.setItem(STATE_KEY, JSON.stringify(fstate)); } catch (e) {}
    }, 300);
  }
  function st(id) { return fstate[id] || (fstate[id] = { next: 0, fails: 0, err: "", via: "" }); }

  function mailRelay() {
    try {
      var m = JSON.parse(localStorage.getItem("oros-mail-data") || "null");
      var u = m && m.relay && C.normRelayUrl(m.relay.url);
      return u || "";
    } catch (e) { return ""; }
  }
  function relayUrl() { return C.setting(data, "relay") || mailRelay() || DEFAULT_RELAY; }
  function imagesFor(feed) {
    if (feed && (feed.img === 0 || feed.img === 1)) return feed.img === 1;
    return C.setting(data, "img") === 1;
  }

  // ---------- 3. Device store (IndexedDB) ----------
  var dbPromise = null;
  function db() {
    if (!dbPromise) {
      dbPromise = new Promise(function (resolve, reject) {
        var req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = function () {
          var d = req.result;
          if (!d.objectStoreNames.contains("heads")) d.createObjectStore("heads", { keyPath: "id" }).createIndex("feed", "feed");
          if (!d.objectStoreNames.contains("bodies")) d.createObjectStore("bodies", { keyPath: "id" });
        };
        req.onsuccess = function () {
          var d = req.result;
          d.onversionchange = function () { d.close(); dbPromise = null; };   // factory reset can delete it
          resolve(d);
        };
        req.onerror = function () { reject(req.error); };
        req.onblocked = function () { reject(new Error("blocked")); };
      });
      dbPromise.catch(function () { dbPromise = null; });
    }
    return dbPromise;
  }
  function tx(stores, mode, fn) {
    return db().then(function (d) {
      return new Promise(function (resolve, reject) {
        var x = d.transaction(stores, mode);
        var res;
        var r = fn(x);
        if (r) r.onsuccess = function () { res = r.result; };
        x.oncomplete = function () { resolve(res); };
        x.onerror = function () { reject(x.error); };
        x.onabort = function () { reject(x.error); };
      });
    });
  }
  // Fills the in-memory map once at boot; every refresh waits for it
  // (a refresh that stored articles first would otherwise be lost).
  var headsReady = null;
  function loadHeads() {
    if (!headsReady) {
      headsReady = tx(["heads"], "readonly", function (x) { return x.objectStore("heads").getAll(); }).then(function (list) {
        (list || []).forEach(function (h) { if (h && h.id && h.feed && !heads[h.id]) heads[h.id] = h; });
      }).catch(function () {});
    }
    return headsReady;
  }
  function getBody(id) {
    return tx(["bodies"], "readonly", function (x) { return x.objectStore("bodies").get(id); })
      .then(function (r) { return r || null; }, function () { return null; });
  }
  function dropFeedArticles(fid) {
    var ids = Object.keys(heads).filter(function (id) { return heads[id].feed === fid; });
    ids.forEach(function (id) { delete heads[id]; });
    return tx(["heads", "bodies"], "readwrite", function (x) {
      var hs = x.objectStore("heads"), bs = x.objectStore("bodies");
      ids.forEach(function (id) { hs.delete(id); bs.delete(id); });
    }).catch(function () {});
  }

  // Merge a fetched feed into the store; prune what is old.
  function storeItems(feed, parsed) {
    var t0 = now();
    var present = {}, puts = [], bodies = [];
    parsed.items.forEach(function (it) {
      var id = C.itemId(feed.id, it.key);
      present[id] = 1;
      var old = heads[id];
      var h = {
        id: id, feed: feed.id, title: it.title, link: it.link,
        date: it.date || (old ? old.date : t0), seen: old ? old.seen : t0,
        author: it.author, snip: it.snip, img: it.img || "", enc: it.enc || null
      };
      var same = old && old.title === h.title && old.snip === h.snip && old.link === h.link && old.img === h.img &&
                 old.date === h.date && JSON.stringify(old.enc) === JSON.stringify(h.enc);
      heads[id] = h;
      if (!same) { puts.push(h); bodies.push({ id: id, html: it.html, base: it.link || feed.site || feed.url }); }
    });
    var mine = Object.keys(heads).filter(function (id) { return heads[id].feed === feed.id; })
      .map(function (id) { return heads[id]; })
      .sort(function (a, b) { return (b.date - a.date) || (a.id < b.id ? -1 : 1); });
    var cutoff = t0 - C.KEEP_DAYS * DAY, drop = [];
    mine.forEach(function (h, i) {
      if (present[h.id]) return;
      if (i >= KEEP_PER_FEED || h.date < cutoff) drop.push(h.id);
    });
    drop.forEach(function (id) { delete heads[id]; });
    if (!puts.length && !drop.length) return Promise.resolve(0);
    return tx(["heads", "bodies"], "readwrite", function (x) {
      var hs = x.objectStore("heads"), bs = x.objectStore("bodies");
      puts.forEach(function (h) { hs.put(h); });
      bodies.forEach(function (b) { bs.put(b); });
      drop.forEach(function (id) { hs.delete(id); bs.delete(id); });
    }).then(function () { return puts.length; }, function () { return puts.length; });
  }

  // ---------- 4. Network: direct + relay ----------
  function FeedError(code, extra) { this.code = code; this.extra = extra || ""; }
  function errText(e) {
    var code = e && e.code ? e.code : "network";
    var s = t("err." + code, { code: (e && e.extra) || "" });
    return s === "err." + code ? t("err.network") : s;
  }

  // One GET straight from the browser. CORS or mixed content -> "cors".
  function fetchDirect(url) {
    if (!/^https:/i.test(url) && location.protocol === "https:") return Promise.reject(new FeedError("cors"));
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, CALL_TIMEOUT);
    return fetch(url, { method: "GET", mode: "cors", credentials: "omit", cache: "no-cache",
                        redirect: "follow", referrerPolicy: "no-referrer", signal: ctl.signal })
      .then(function (r) {
        if (!r.ok) { clearTimeout(timer); return { status: r.status, url: r.url || url, type: "", bytes: null }; }
        return r.arrayBuffer().then(function (buf) {
          clearTimeout(timer);
          return { status: r.status, url: r.url || url, type: r.headers.get("Content-Type") || "", bytes: new Uint8Array(buf) };
        });
      }, function () {
        clearTimeout(timer);
        throw new FeedError(ctl.signal.aborted ? "timeout" : "cors");
      });
  }

  // Up to RELAY_BATCH GETs through the relay, one call.
  function fetchRelay(reqs) {
    var url = relayUrl();
    if (!url) return Promise.reject(new FeedError("norelay"));
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, CALL_TIMEOUT + 15000);
    return fetch(url + "/v1", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "web", reqs: reqs }), signal: ctl.signal,
      credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer"
    }).then(function (r) {
      return r.json().catch(function () { return null; });
    }, function () {
      throw new FeedError(ctl.signal.aborted ? "timeout" : "relay");
    }).then(function (j) {
      clearTimeout(timer);
      if (!j || typeof j !== "object") throw new FeedError("relay");
      if (!j.ok) throw new FeedError((j.error && j.error.code) || "relay");
      var res = j.data && Array.isArray(j.data.res) ? j.data.res : [];
      return reqs.map(function (q, i) {
        var x = res[i];
        if (!x || typeof x !== "object") return { err: "relay" };
        if (x.err) return { err: String(x.err) };
        return { status: x.status | 0, url: typeof x.url === "string" ? x.url : q.url, type: String(x.type || ""),
                 etag: String(x.etag || ""), lm: String(x.lm || ""), retry: String(x.retry || ""),
                 bytes: typeof x.body === "string" ? C.b64ToBytes(x.body) : null };
      });
    }, function (e) { clearTimeout(timer); throw e; });
  }

  // One page for discovery: direct first, then the relay.
  function getPage(url) {
    if (!navigator.onLine) return Promise.reject(new FeedError("offline"));
    return fetchDirect(url).then(function (r) { r.via = "d"; return r; }, function (e) {
      if (e.code !== "cors") throw e;
      return fetchRelay([{ url: url }]).then(function (list) {
        var r = list[0];
        if (r.err) throw new FeedError(r.err);
        r.via = "r";
        return r;
      });
    }).then(function (r) {
      if (r.status === 404 || r.status === 410) throw new FeedError("gone", r.status);
      if (r.status < 200 || r.status >= 300 || !r.bytes) throw new FeedError("http", r.status);
      r.text = C.decodeBytes(r.bytes, r.type);
      return r;
    });
  }

  // ---------- 5. Refresh ----------
  function due(feed, t0) { var s = fstate[feed.id]; return !s || !s.next || s.next <= t0; }

  function settle(feed, ok, e, extra) {
    var s = st(feed.id), t0 = now();
    if (ok) {
      s.fails = 0; s.err = ""; s.code = ""; s.ok = t0;
    } else {
      s.fails = (s.fails || 0) + 1;
      s.err = e.code; s.code = e.extra || "";
    }
    if (extra && extra.ttl !== undefined) s.ttl = extra.ttl;
    var delay = C.nextDelay(C.setting(data, "refresh") || 30, s);
    if (extra && extra.retry) {
      var ra = /^\d+$/.test(extra.retry) ? +extra.retry * 1000 : (Date.parse(extra.retry) - t0);
      if (ra > delay) delay = Math.min(ra, DAY);
    }
    s.next = t0 + delay;
    saveState();
  }

  function absorb(feed, r) {
    var s = st(feed.id);
    if (r.status === 304) { settle(feed, true, null, {}); return Promise.resolve(0); }
    if (r.status === 429 || r.status === 503) { settle(feed, false, new FeedError("rate"), { retry: r.retry }); return Promise.resolve(0); }
    if (r.status === 404 || r.status === 410) { settle(feed, false, new FeedError("gone", r.status)); return Promise.resolve(0); }
    if (r.status < 200 || r.status >= 300 || !r.bytes) { settle(feed, false, new FeedError("http", r.status || "?")); return Promise.resolve(0); }
    var parsed = C.parseFeed(C.decodeBytes(r.bytes, r.type), r.url || feed.url, now());
    if (!parsed) { settle(feed, false, new FeedError("notfeed")); return Promise.resolve(0); }
    if (r.etag !== undefined) { s.etag = r.etag; s.lm = r.lm; }
    if (!feed.site && parsed.site) {
      var f = C.feedById(data, feed.id);
      if (f) { f.site = parsed.site; f.m = Math.max(now(), f.m + 1); saveData(); }
    }
    settle(feed, true, null, { ttl: parsed.ttl || 0 });
    return storeItems(feed, parsed);
  }

  function refresh(ids, manual) {
    return loadHeads().then(function () { return refreshNow(ids, manual); });
  }
  function refreshNow(ids, manual) {
    if (!navigator.onLine) {
      if (manual) showToast(t("err.offline"));
      renderBar();
      return Promise.resolve(0);
    }
    var t0 = now();
    var list = data.feeds.filter(function (f) {
      if (ids && ids.indexOf(f.id) < 0) return false;
      if (manual) return true;
      return due(f, t0);
    });
    if (!list.length) { if (manual) showToast(t("toast.updated")); return Promise.resolve(0); }
    var direct = [], viaRelay = [], added = 0, failed = 0;
    list.forEach(function (f) { (st(f.id).via === "r" ? viaRelay : direct).push(f); });
    busy += list.length;
    renderBar();
    function done(n) { busy = Math.max(0, busy - n); }

    var qi = 0;
    function worker() {
      if (qi >= direct.length) return Promise.resolve();
      var f = direct[qi++];
      return fetchDirect(f.url).then(function (r) {
        st(f.id).via = "d";
        return absorb(f, r).then(function (n) { added += n; done(1); });
      }, function (e) {
        if (e.code === "cors" && relayUrl()) { viaRelay.push(f); return; }
        failed++;
        settle(f, false, relayUrl() || e.code !== "cors" ? e : new FeedError("norelay"));
        if (e.code === "cors") st(f.id).via = "r";   // known now: the relay is the only way
        done(1);
      }).then(worker);
    }
    var ws = [];
    for (var i = 0; i < DIRECT_PAR; i++) ws.push(worker());
    return Promise.all(ws).then(function () {
      var chunks = [];
      for (var j = 0; j < viaRelay.length; j += RELAY_BATCH) chunks.push(viaRelay.slice(j, j + RELAY_BATCH));
      return chunks.reduce(function (p, chunk) {
        return p.then(function () {
          if (!relayUrl()) {
            chunk.forEach(function (f) { failed++; settle(f, false, new FeedError("norelay")); });
            done(chunk.length);
            return;
          }
          var reqs = chunk.map(function (f) {
            var s = st(f.id), q = { url: f.url };
            if (s.etag) q.etag = s.etag;
            if (s.lm) q.lm = s.lm;
            return q;
          });
          return fetchRelay(reqs).then(function (res) {
            return res.reduce(function (pp, r, k) {
              return pp.then(function () {
                var f = chunk[k];
                st(f.id).via = "r";
                if (r.err) {
                  failed++;
                  settle(f, false, new FeedError(r.err === "budget" ? "budget" : r.err));
                  if (r.err === "budget") st(f.id).next = now() + 2 * 60000;
                  return;
                }
                return absorb(f, r).then(function (n) { added += n; });
              });
            }, Promise.resolve()).then(function () { done(chunk.length); });
          }, function (e) {
            chunk.forEach(function (f) { failed++; settle(f, false, e); });
            done(chunk.length);
          });
        });
      }, Promise.resolve());
    }).then(function () {
      busy = Math.max(0, busy);
      if (C.compact) {
        var before = JSON.stringify(data.read);
        C.compact(data, Object.keys(heads).map(function (id) { return heads[id]; }), now());
        if (JSON.stringify(C.merge(data, null).read) !== before) saveData();
      }
      saveState();
      renderAll();
      if (manual && !failed) showToast(t("toast.updated"));
      else if (manual && failed && list.length === 1) showToast(errText({ code: st(list[0].id).err, extra: st(list[0].id).code }));
      return added;
    });
  }

  var tickTimer = null;
  function scheduleTick() {
    clearTimeout(tickTimer);
    tickTimer = setTimeout(function () {
      if (document.visibilityState === "visible" && navigator.onLine && C.setting(data, "refresh") > 0 && !busy) refresh(null, false);
      scheduleTick();
    }, TICK_MS);
  }

  // ---------- 6. Discovery ----------
  // address -> [{ url, title, items, last, parsed, via, have }]
  function discoverFeeds(input) {
    var url = C.normUrl(input);
    if (!url) return Promise.reject(new FeedError("bad"));
    var t0 = now(), found = [], tried = {};
    function verify(cands, max) {
      var list = cands.filter(function (c) { if (tried[c.url]) return false; tried[c.url] = 1; return true; }).slice(0, max);
      return Promise.all(list.map(function (c) {
        return getPage(c.url).then(function (r) {
          var p = C.parseFeed(r.text, r.url, t0);
          if (p) add(C.normUrl(r.url) || c.url, p, r.via, c.title);
        }, function () {});
      }));
    }
    function add(u, parsed, via, hint) {
      var id = C.feedId(u);
      if (!id || found.some(function (f) { return f.id === id; })) return;
      var last = 0;
      parsed.items.forEach(function (it) { if (it.date > last) last = it.date; });
      found.push({ id: id, url: u, title: parsed.title || hint || C.siteOf(u), items: parsed.items.length, last: last,
                   parsed: parsed, via: via, have: !!C.feedById(data, id) });
    }
    return getPage(url).then(function (page) {
      var p = C.parseFeed(page.text, page.url, t0);
      if (p) { add(C.normUrl(page.url) || url, p, page.via); return; }
      var cands = C.platformFeeds(url).concat(C.platformFeeds(page.url), C.discover(page.text, page.url));
      return verify(cands, 8).then(function () {
        if (found.length) return;
        return verify(C.guessFeeds(page.url).map(function (u) { return { url: u, title: "" }; }), 12);
      });
    }, function (e) {
      // The page itself is out of reach: platform rules may still know the feed.
      var cands = C.platformFeeds(url);
      if (!cands.length) throw e;
      return verify(cands, 4).then(function () { if (!found.length) throw e; });
    }).then(function () { return found; });
  }

  function subscribe(cand, folderId) {
    if (data.feeds.length >= C.MAX_FEEDS) { showToast(t("add.limit")); return Promise.resolve(null); }
    var t0 = now();
    var tomb = data.tombs["f:" + cand.id] || 0;
    var feed = { id: cand.id, url: cand.url, title: cand.title.slice(0, 200), site: cand.parsed ? (cand.parsed.site || "") : "",
                 folder: folderId || "", img: -1, m: Math.max(t0, tomb + 1) };
    var exists = C.feedById(data, cand.id);
    if (exists) return Promise.resolve(exists);
    data.feeds.push(feed);
    saveData();
    feed = C.feedById(data, cand.id);
    var s = st(feed.id);
    s.via = cand.via || "";
    if (cand.parsed) {
      settle(feed, true, null, { ttl: cand.parsed.ttl || 0 });
      return storeItems(feed, cand.parsed).then(function () { return feed; });
    }
    return Promise.resolve(feed);
  }

  // ---------- 7. Counts + selection ----------
  var counts = { all: 0, feed: {}, folder: {} };
  function itemOf(id) { var h = heads[id]; if (h) return h; return C.savedById(data, id); }
  function recount() {
    var c = { all: 0, feed: {}, folder: {} };
    var folderOf = {};
    data.feeds.forEach(function (f) { folderOf[f.id] = f.folder; c.feed[f.id] = 0; });
    Object.keys(heads).forEach(function (id) {
      var h = heads[id];
      if (folderOf[h.feed] === undefined || C.isRead(data, h)) return;
      c.all++;
      c.feed[h.feed]++;
      var d = folderOf[h.feed];
      if (d) c.folder[d] = (c.folder[d] || 0) + 1;
    });
    counts = c;
  }
  function selKind() { return prefs.sel.indexOf("f:") === 0 ? "feed" : (prefs.sel.indexOf("d:") === 0 ? "folder" : prefs.sel); }
  function selId() { return prefs.sel.slice(2); }
  function validSel() {
    var k = selKind();
    if (k === "feed" && !C.feedById(data, selId())) prefs.sel = "all";
    if (k === "folder" && !C.folderById(data, selId())) prefs.sel = "all";
  }
  function selTitle() {
    var k = selKind();
    if (k === "feed") { var f = C.feedById(data, selId()); return f ? f.title : ""; }
    if (k === "folder") { var d = C.folderById(data, selId()); return d ? d.name : ""; }
    return t("sel." + k);
  }
  function selFeeds() {
    var k = selKind();
    if (k === "feed") return [selId()];
    if (k === "folder") return data.feeds.filter(function (f) { return f.folder === selId(); }).map(function (f) { return f.id; });
    return data.feeds.map(function (f) { return f.id; });
  }
  function listItems() {
    var k = selKind();
    var order = C.setting(data, "sort") === "old" ? 1 : -1;
    var out;
    if (k === "star" || k === "later") {
      out = data.items.filter(function (x) { return k === "star" ? x.star : x.later; })
        .map(function (x) { return heads[x.id] || x; });
    } else {
      var set = {};
      selFeeds().forEach(function (id) { set[id] = 1; });
      out = Object.keys(heads).map(function (id) { return heads[id]; }).filter(function (h) {
        if (!set[h.feed]) return false;
        return !prefs.unread || sticky[h.id] || !C.isRead(data, h);
      });
    }
    return out.sort(function (a, b) { return order * (a.date - b.date) || (a.id < b.id ? -1 : 1); });
  }
  function select(sel) {
    prefs.sel = sel;
    savePrefs();
    sticky = {};
    shown = PAGE;
    openItem = null;
    if (narrow()) setView("list");
    renderAll();
    var lp = $("listp");
    if (lp) lp.scrollTop = 0;
  }

  // ---------- 8. UI: toolbar, side, list ----------
  function narrow() { return window.matchMedia("(max-width: 899px)").matches; }
  function phone() { return window.matchMedia("(max-width: 639px)").matches; }
  function setView(v) {
    view = v;
    document.body.setAttribute("data-view", v);
    $("scrim").hidden = v !== "side";
    renderBar();
  }

  function renderBar() {
    var nav = $("nav-btn");
    var back = phone() && view === "read";
    nav.innerHTML = back ? UI.back : UI.menu;
    nav.setAttribute("aria-label", back ? t("nav.back") : t("nav.side"));
    nav.title = nav.getAttribute("aria-label");
    nav.hidden = !narrow() && !back;
    $("bar-title").textContent = data.feeds.length || data.items.length ? selTitle() : t("app");
    $("refresh-btn").classList.toggle("spin", busy > 0);
    var net = $("net"), msg = "";
    if (!navigator.onLine) msg = t("net.offline");
    else if (!relayUrl() && data.feeds.some(function (f) { var s = fstate[f.id]; return s && s.err === "norelay"; })) msg = t("net.relay");
    net.textContent = msg;
    net.hidden = !msg;
  }

  function sideRow(label, sel, count, lead, err) {
    var b = el("button", "side-row");
    b.type = "button";
    if (prefs.sel === sel) { b.classList.add("on"); b.setAttribute("aria-current", "true"); }
    if (lead) b.appendChild(lead);
    b.appendChild(el("span", "side-name", label));
    if (err) {
      var w = el("span", "side-err");
      w.innerHTML = UI.warn;
      w.title = err;
      w.setAttribute("aria-label", err);
      b.appendChild(w);
    }
    if (count > 0) b.appendChild(el("span", "badge", count > 999 ? "999+" : String(count)));
    b.addEventListener("click", function () { select(sel); });
    return b;
  }
  function icon(svg) { var s = el("span", "side-ic"); s.innerHTML = svg; s.setAttribute("aria-hidden", "true"); return s; }

  function feedRow(f) {
    var s = fstate[f.id];
    var err = s && s.err && s.fails >= 2 ? errText({ code: s.err, extra: s.code }) : "";
    var li = el("li");
    li.appendChild(sideRow(f.title, "f:" + f.id, counts.feed[f.id] || 0, avatar(f, "sm"), err));
    return li;
  }

  function renderSide() {
    var box = $("side-list");
    box.innerHTML = "";
    var top = el("ul", "side-sec");
    [["all", UI.all], ["star", UI.starOn], ["later", UI.clock]].forEach(function (r) {
      var li = el("li");
      li.appendChild(sideRow(t("sel." + r[0]), r[0], r[0] === "all" ? counts.all : 0, icon(r[1])));
      top.appendChild(li);
    });
    box.appendChild(top);
    if (data.feeds.length) box.appendChild(el("div", "side-head", t("side.feeds")));
    var byFolder = {};
    data.feeds.forEach(function (f) {
      var k = f.folder && C.folderById(data, f.folder) ? f.folder : "";
      (byFolder[k] = byFolder[k] || []).push(f);
    });
    function byTitle(a, b) { return a.title.toLowerCase().localeCompare(b.title.toLowerCase(), locale()) || (a.id < b.id ? -1 : 1); }
    C.sortFolders(data.folders).forEach(function (d) {
      var sec = el("div", "folder");
      var head = el("div", "folder-head");
      var closed = !!prefs.closed[d.id];
      var tg = svgBtn("folder-tg" + (closed ? "" : " open"), UI.chev, d.name);
      tg.setAttribute("aria-expanded", closed ? "false" : "true");
      tg.addEventListener("click", function () {
        if (prefs.closed[d.id]) delete prefs.closed[d.id]; else prefs.closed[d.id] = 1;
        savePrefs();
        renderSide();
      });
      head.appendChild(tg);
      head.appendChild(sideRow(d.name, "d:" + d.id, counts.folder[d.id] || 0, null));
      sec.appendChild(head);
      if (!closed) {
        var ul = el("ul", "side-sec in");
        (byFolder[d.id] || []).sort(byTitle).forEach(function (f) { ul.appendChild(feedRow(f)); });
        sec.appendChild(ul);
      }
      box.appendChild(sec);
    });
    var loose = (byFolder[""] || []).sort(byTitle);
    if (loose.length) {
      var ul = el("ul", "side-sec");
      loose.forEach(function (f) { ul.appendChild(feedRow(f)); });
      box.appendChild(ul);
    }
  }

  function showWelcome() {
    var none = !data.feeds.length && !data.items.length;
    $("welcome").hidden = !none;
    $("side").hidden = none;
    $("listp").hidden = none;
    $("read").hidden = none;
    $("refresh-btn").hidden = none;
  }

  function renderList() {
    var ul = $("list"), foot = $("list-foot");
    ul.innerHTML = "";
    foot.innerHTML = "";
    var k = selKind();
    $("list-title").textContent = selTitle();
    var unread = k === "all" ? counts.all : (k === "feed" ? counts.feed[selId()] || 0 : (k === "folder" ? counts.folder[selId()] || 0 : 0));
    $("list-count").textContent = unread > 0 ? t("list.count", { n: unread }) : "";
    var saved = k === "star" || k === "later";
    var tools = $("list-tools");
    tools.innerHTML = "";
    if (!saved) {
      var tog = el("button", "chip" + (prefs.unread ? " on" : ""), prefs.unread ? t("btn.unreadOnly") : t("btn.showAll"));
      tog.type = "button";
      tog.setAttribute("aria-pressed", prefs.unread ? "true" : "false");
      tog.addEventListener("click", function () { prefs.unread = prefs.unread ? 0 : 1; savePrefs(); sticky = {}; shown = PAGE; renderList(); });
      tools.appendChild(tog);
      var mk = svgBtn("icon-btn sm", UI.check, t("btn.markAll"));
      mk.disabled = unread === 0;
      mk.addEventListener("click", markAllDialog);
      tools.appendChild(mk);
      if (k === "feed" || k === "folder") {
        var ed = svgBtn("icon-btn sm", UI.dots, t("btn.edit"));
        ed.addEventListener("click", function () { if (k === "feed") feedDialog(C.feedById(data, selId())); else folderDialog(C.folderById(data, selId())); });
        tools.appendChild(ed);
      }
    }
    var items = listItems();
    if (!items.length) {
      var msg = saved ? t("list.emptySaved") : (busy ? t("list.loading") : (prefs.unread ? t("list.empty") : t("list.emptyAll")));
      foot.appendChild(el("p", "hint", msg));
      if (!saved && prefs.unread && !busy && Object.keys(heads).some(function (id) { return selFeeds().indexOf(heads[id].feed) >= 0; })) {
        var sa = el("button", "link-btn", t("list.allRead"));
        sa.type = "button";
        sa.addEventListener("click", function () { prefs.unread = 0; savePrefs(); renderList(); });
        foot.appendChild(sa);
      }
      if (k === "feed") {
        var s = fstate[selId()];
        if (s && s.err) foot.appendChild(el("p", "hint err", errText({ code: s.err, extra: s.code })));
      }
      return;
    }
    items.slice(0, shown).forEach(function (it) { ul.appendChild(listRow(it, k !== "feed")); });
    if (items.length > shown) {
      var more = el("button", "older-btn", t("list.more"));
      more.type = "button";
      more.id = "more-btn";
      more.addEventListener("click", function () { shown += PAGE; renderList(); });
      foot.appendChild(more);
      watchMore(more);
    }
    watchScroll();
  }

  function listRow(it, showFeed) {
    var feed = C.feedById(data, it.feed);
    var li = el("li");
    var b = el("button", "row");
    b.type = "button";
    b.setAttribute("data-id", it.id);
    var unread = !C.isRead(data, it);
    if (unread) b.classList.add("unseen");
    if (openItem && openItem.id === it.id) { b.classList.add("on"); b.setAttribute("aria-current", "true"); }
    var mid = el("span", "row-mid");
    var top = el("span", "row-top");
    if (showFeed) top.appendChild(el("span", "row-feed", feed ? feed.title : C.siteOf(it.link)));
    top.appendChild(el("time", "row-date", ago(it.date)));
    mid.appendChild(top);
    mid.appendChild(el("span", "row-title", it.title || "…"));
    var snip = it.snip !== undefined ? it.snip : (it.sum || "").slice(0, 240);
    if (snip && snip !== it.title) mid.appendChild(el("span", "row-snip", snip));
    b.appendChild(mid);
    var sv = C.savedById(data, it.id);
    if (sv && (sv.star || sv.later)) {
      var ic = el("span", "row-ic");
      ic.innerHTML = sv.star ? UI.starOn : UI.clockOn;
      ic.setAttribute("aria-hidden", "true");
      b.appendChild(ic);
    }
    if (it.img && imagesFor(feed)) {
      var th = el("img", "row-img");
      th.alt = "";
      th.loading = "lazy";
      th.decoding = "async";
      th.referrerPolicy = "no-referrer";
      th.src = it.img;
      th.addEventListener("error", function () { th.remove(); });
      b.appendChild(th);
    }
    b.addEventListener("click", function () { openArticle(it.id); });
    wireSwipe(b, it);
    li.appendChild(b);
    return li;
  }

  var moreObs = null, scrollObs = null;
  function watchMore(btn) {
    if (!("IntersectionObserver" in window)) return;
    if (moreObs) moreObs.disconnect();
    moreObs = new IntersectionObserver(function (es) {
      if (es.some(function (e) { return e.isIntersecting; })) { shown += PAGE; renderList(); }
    }, { root: $("listp"), rootMargin: "300px" });
    moreObs.observe(btn);
  }
  // "Mark as read while scrolling": a row that leaves the top of the list.
  var scrollMarks = [], scrollTimer = null;
  function watchScroll() {
    if (scrollObs) { scrollObs.disconnect(); scrollObs = null; }
    if (!C.setting(data, "scroll") || !("IntersectionObserver" in window)) return;
    var root = $("listp");
    scrollObs = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (e.isIntersecting || !e.rootBounds || e.boundingClientRect.bottom > e.rootBounds.top + 4) return;
        var id = e.target.getAttribute("data-id"), it = itemOf(id);
        if (!it || C.isRead(data, it)) return;
        sticky[id] = 1;
        scrollMarks.push(it);
        e.target.classList.remove("unseen");
      });
      if (scrollMarks.length) {
        clearTimeout(scrollTimer);
        scrollTimer = setTimeout(flushScrollMarks, 600);
      }
    }, { root: root, threshold: 0 });
    [].forEach.call(document.querySelectorAll("#list .row.unseen"), function (r) { scrollObs.observe(r); });
  }
  function flushScrollMarks() {
    var list = scrollMarks;
    scrollMarks = [];
    if (C.markItems(data, list, 1, now())) { saveData(); recount(); renderSide(); renderCountOnly(); renderBar(); }
  }
  function renderCountOnly() {
    var k = selKind();
    var unread = k === "all" ? counts.all : (k === "feed" ? counts.feed[selId()] || 0 : (k === "folder" ? counts.folder[selId()] || 0 : 0));
    $("list-count").textContent = unread > 0 ? t("list.count", { n: unread }) : "";
  }

  function renderAll() {
    validSel();
    recount();
    showWelcome();
    renderSide();
    renderList();
    renderReader();
    renderBar();
  }

  // ---------- 9. UI: reader ----------
  function openArticle(id) {
    var it = itemOf(id);
    if (!it) return;
    openItem = { id: id, feed: it.feed, head: heads[id] || null, saved: C.savedById(data, id), body: null, loading: true };
    if (!C.isRead(data, it)) {
      sticky[id] = 1;
      if (C.markItems(data, [it], 1, now())) { saveData(); recount(); }
    }
    if (phone()) setView("read");
    renderSide();
    renderList();
    renderReader();
    getBody(id).then(function (b) {
      if (!openItem || openItem.id !== id) return;
      openItem.body = b;
      openItem.loading = false;
      renderReader();
    });
    var row = document.querySelector('.row[data-id="' + id + '"]');
    if (row) row.scrollIntoView({ block: "nearest" });
  }

  function palette() {
    var cs = getComputedStyle(document.documentElement);
    function v(n, d) { return (cs.getPropertyValue(n) || "").trim() || d; }
    return { bg: v("--bg", "#14120d"), text: v("--text", "#f0ead9"), dim: v("--text-dim", "#a89f8a"),
             accent: v("--accent", "#d4af37"), border: v("--border", "#322d20"), panel: v("--panel-bg", "#1d1a13") };
  }
  function cssColor(c) { return /^[#\w\s(),.%-]{1,80}$/.test(c) ? c : "inherit"; }

  function renderReader() {
    var empty = $("read-empty"), art = $("art");
    if (!openItem) { art.hidden = true; empty.hidden = false; empty.textContent = t("read.none"); return; }
    empty.hidden = true;
    art.hidden = false;
    var it = openItem.head || openItem.saved || itemOf(openItem.id);
    var feed = C.feedById(data, openItem.feed);
    var sv = C.savedById(data, openItem.id);
    var read = C.isRead(data, it);
    var acts = $("art-acts");
    acts.innerHTML = "";
    var bStar = svgBtn("icon-btn" + (sv && sv.star ? " on" : ""), sv && sv.star ? UI.starOn : UI.star, sv && sv.star ? t("read.unstar") : t("read.star"));
    bStar.setAttribute("aria-pressed", sv && sv.star ? "true" : "false");
    bStar.addEventListener("click", function () { toggleSaved(openItem.id, "star"); });
    var bLater = svgBtn("icon-btn" + (sv && sv.later ? " on" : ""), sv && sv.later ? UI.clockOn : UI.clock, sv && sv.later ? t("read.unlater") : t("read.later"));
    bLater.setAttribute("aria-pressed", sv && sv.later ? "true" : "false");
    bLater.addEventListener("click", function () { toggleSaved(openItem.id, "later"); });
    var bRead = svgBtn("icon-btn", read ? UI.dot : UI.dotOn, read ? t("read.markUnread") : t("read.markRead"));
    bRead.addEventListener("click", function () { toggleRead(openItem.id); });
    [bStar, bLater, bRead].forEach(function (b) { acts.appendChild(b); });
    acts.appendChild(el("span", "spacer"));
    if (it.link) {
      var bCopy = svgBtn("icon-btn", UI.link, t("read.copy"));
      bCopy.addEventListener("click", function () { copyLink(it.link); });
      acts.appendChild(bCopy);
      var bOpen = svgBtn("icon-btn", UI.ext, t("read.open"));
      bOpen.addEventListener("click", function () { window.open(it.link, "_blank", "noopener,noreferrer"); });
      acts.appendChild(bOpen);
    }
    var bars = $("art-bars"), box = $("art-body");
    bars.innerHTML = "";
    box.innerHTML = "";
    if (openItem.loading) { box.appendChild(el("p", "hint pad", t("list.loading"))); return; }
    var html = openItem.body ? openItem.body.html : "";
    var base = openItem.body ? openItem.body.base : (it.link || (feed && feed.url) || "");
    if (!openItem.body) {
      html = it.sum ? C.escHtml(it.sum) : "";
      if (!it.sum) bars.appendChild(el("div", "bar", t("read.offline")));
    }
    var images = imagesFor(feed) || !!openItem.imgOnce;
    var clean = window.orosFeedsSanitize(html, { base: base, images: images, t: t });
    if (clean.blocked > 0 && !images) {
      var bar = el("div", "bar");
      bar.appendChild(el("span", "", t("img.blocked")));
      var ba = el("span", "bar-acts");
      var b1 = el("button", "link-btn", t("img.show"));
      b1.type = "button";
      b1.addEventListener("click", function () { openItem.imgOnce = 1; renderReader(); });
      ba.appendChild(b1);
      if (feed) {
        var b2 = el("button", "link-btn", t("img.always"));
        b2.type = "button";
        b2.addEventListener("click", function () {
          var f = C.feedById(data, feed.id);
          if (f) { f.img = 1; f.m = Math.max(now(), f.m + 1); saveData(); }
          renderAll();
        });
        ba.appendChild(b2);
      }
      bar.appendChild(ba);
      bars.appendChild(bar);
    }
    box.appendChild(articleFrame(it, feed, clean.html, images));
  }

  // Second wall: an iframe with sandbox (no scripts, opaque origin, no
  // forms) and a CSP that allows only inline style, pictures (when on)
  // and media. Header, text and player share its one scroller.
  function articleFrame(it, feed, body, images) {
    var p = palette();
    var size = [15, 17, 20][prefs.font - 1] || 17;
    var csp = "default-src 'none'; style-src 'unsafe-inline'; img-src data:" + (images ? " https: http:" : "") +
              "; media-src https: http:; form-action 'none'; frame-src 'none'; font-src 'none'";
    var E = C.escHtml;
    var meta = [feed ? feed.title : C.siteOf(it.link), it.author ? t("read.by", { who: it.author }) : "", fullDate(it.date)]
      .filter(Boolean).map(E).join(" · ");
    var title = E(it.title || "");
    var head = "<header><div class=\"meta\">" + meta + "</div><h1>" +
      (it.link ? "<a href=\"" + E(it.link) + "\" target=\"_blank\" rel=\"noopener noreferrer\">" + title + "</a>" : title) + "</h1></header>";
    var media = "";
    var enc = it.enc;
    if (enc && /^https?:\/\//i.test(enc.url)) {
      var isVideo = /^video\//.test(enc.type) || /\.(mp4|m4v|webm)(\?|$)/i.test(enc.url);
      media = "<div class=\"media\">" + (isVideo
        ? "<video controls preload=\"none\" src=\"" + E(enc.url) + "\"></video>"
        : "<audio controls preload=\"none\" src=\"" + E(enc.url) + "\"></audio>") +
        "<a class=\"dl\" href=\"" + E(enc.url) + "\" target=\"_blank\" rel=\"noopener noreferrer\">" +
        E(enc.len ? t("read.download", { size: fmtSize(enc.len) }) : (isVideo ? t("read.watch") : t("read.listen"))) + "</a></div>";
    }
    var lead = "";
    if (it.img && images && body.indexOf(it.img) < 0 && !/<img\b/i.test(body)) {
      lead = "<img class=\"lead\" src=\"" + E(it.img) + "\" alt=\"\" referrerpolicy=\"no-referrer\">";
    }
    var css = "html{background:" + cssColor(p.bg) + ";color-scheme:" + (document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark") + "}" +
      "body{margin:0 auto;max-width:720px;padding:16px 18px 48px;font:" + size + "px/1.65 Georgia,'Noto Serif','Times New Roman',serif;" +
      "color:" + cssColor(p.text) + ";overflow-wrap:anywhere}" +
      "header{margin-bottom:18px;font-family:'Nunito','Segoe UI',system-ui,sans-serif}" +
      ".meta{font-size:13px;color:" + cssColor(p.dim) + ";line-height:1.4}" +
      "h1{font-size:1.45em;line-height:1.25;margin:6px 0 0}h1 a{color:inherit;text-decoration:none}" +
      "h2,h3,h4{line-height:1.3}a{color:" + cssColor(p.accent) + "}" +
      "img,video{max-width:100%;height:auto;border-radius:6px}img.lead{display:block;margin:0 0 16px}" +
      "figure{margin:1em 0}figcaption{font-size:.85em;color:" + cssColor(p.dim) + "}" +
      "blockquote{margin:1em 0;padding-left:14px;border-left:3px solid " + cssColor(p.accent) + ";color:" + cssColor(p.dim) + "}" +
      "pre{white-space:pre-wrap;background:" + cssColor(p.panel) + ";padding:10px;border-radius:6px;font-size:.85em}" +
      "code{font-size:.9em}table{max-width:100%;border-collapse:collapse;display:block;overflow-x:auto}" +
      "td,th{border:1px solid " + cssColor(p.border) + ";padding:4px 8px}hr{border:0;border-top:1px solid " + cssColor(p.border) + "}" +
      ".media{margin:0 0 18px;display:flex;flex-direction:column;gap:8px}.media audio{width:100%}" +
      ".dl,.embed a{font-family:'Nunito','Segoe UI',system-ui,sans-serif;font-size:14px}" +
      ".embed{padding:10px 12px;border:1px solid " + cssColor(p.border) + ";border-radius:8px}";
    var doc = "<!DOCTYPE html><html><head><meta charset=\"utf-8\">" +
      "<meta http-equiv=\"Content-Security-Policy\" content=\"" + csp + "\">" +
      "<meta name=\"referrer\" content=\"no-referrer\"><base target=\"_blank\">" +
      "<style>" + css + "</style></head><body dir=\"auto\">" + head + media + lead + body + "</body></html>";
    var fr = document.createElement("iframe");
    fr.className = "art-frame";
    fr.setAttribute("sandbox", "allow-popups allow-popups-to-escape-sandbox");
    fr.setAttribute("referrerpolicy", "no-referrer");
    fr.setAttribute("title", it.title || t("app"));
    fr.srcdoc = doc;
    return fr;
  }

  function copyLink(u) {
    var done = function () { showToast(t("toast.copied")); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(u).then(done, fallback); return; }
    } catch (e) {}
    fallback();
    function fallback() {
      var ta = el("textarea");
      ta.value = u;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); done(); } catch (e) {}
      ta.remove();
    }
  }

  // ---------- 10. Actions: read, star, later, mark all ----------
  function toggleRead(id) {
    var it = itemOf(id);
    if (!it) return;
    var state = C.isRead(data, it) ? 0 : 1;
    if (C.markItems(data, [it], state, now())) {
      sticky[id] = 1;
      saveData();
      recount();
      renderSide();
      renderList();
      renderReader();
      renderBar();
    }
  }

  function toggleSaved(id, field) {
    var t0 = now();
    var sv = C.savedById(data, id);
    var h = heads[id];
    if (!sv) {
      if (!h) return;
      var p = Promise.resolve(openItem && openItem.id === id && openItem.body ? openItem.body : null);
      p.then(function (b) {
        return b || getBody(id);
      }).then(function (b) {
        var sum = b ? C.textOf(b.html).slice(0, 2000) : h.snip;
        var rec = { id: id, feed: h.feed, title: h.title, link: h.link, date: h.date, author: h.author, sum: sum,
                    star: field === "star" ? 1 : 0, later: field === "later" ? 1 : 0,
                    m: Math.max(t0, (data.tombs["i:" + id] || 0) + 1) };
        data.items.push(rec);
        saveData();
        afterSaved();
      });
      return;
    }
    sv[field] = sv[field] ? 0 : 1;
    sv.m = Math.max(t0, sv.m + 1);
    if (!sv.star && !sv.later) {
      data.items = data.items.filter(function (x) { return x.id !== id; });
      data.tombs["i:" + id] = sv.m;
    }
    saveData();
    afterSaved();
  }
  function afterSaved() {
    if (openItem) openItem.saved = C.savedById(data, openItem.id);
    renderSide();
    renderList();
    renderReader();
  }

  function markAllDialog() {
    var dlg = makeDialog("mark-dlg");
    dlg.appendChild(el("h2", "dlg-title", t("mark.title") + " · " + selTitle()));
    var acts = el("div", "dlg-col");
    [["mark.all", 0], ["mark.day", DAY], ["mark.week", 7 * DAY]].forEach(function (o) {
      acts.appendChild(button(t(o[0]), o[1] ? "" : "primary", function () { dlg.close(); markAll(o[1]); }));
    });
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
  }
  function markAll(age) {
    var t0 = now(), upTo = age ? t0 - age : t0;
    var ids = selFeeds();
    var set = {};
    ids.forEach(function (id) { set[id] = 1; });
    var affected = Object.keys(heads).map(function (id) { return heads[id]; })
      .filter(function (h) { return set[h.feed] && h.date <= upTo && !C.isRead(data, h); });
    if (!affected.length) return;
    // per feed: the newest affected date is the cut (articles newer than
    // "now" on this device's clock cannot exist: the parser caps them)
    var cutBy = {};
    affected.forEach(function (h) { if (!(cutBy[h.feed] >= h.date)) cutBy[h.feed] = h.date; });
    Object.keys(cutBy).forEach(function (fid) { C.markAllBefore(data, [fid], age ? upTo : cutBy[fid], t0); });
    // anything still unread under the cut (explicit unread marks) is now read
    C.markItems(data, affected.filter(function (h) { return !C.isRead(data, h); }), 1, t0);
    saveData();
    sticky = {};
    renderAll();
    showUndo(t("mark.done", { n: affected.length }), function () {
      C.markItems(data, affected, 0, now());
      saveData();
      renderAll();
    });
  }

  // ---------- 11. Dialogs: add, feed, folder, settings, OPML ----------
  function folderSelect(current) {
    var sel = el("select");
    sel.id = "folder-sel";
    var o0 = el("option", "", t("side.noFolder"));
    o0.value = "";
    sel.appendChild(o0);
    C.sortFolders(data.folders).forEach(function (d) {
      var o = el("option", "", d.name);
      o.value = d.id;
      if (d.id === current) o.selected = true;
      sel.appendChild(o);
    });
    var on = el("option", "", t("add.newFolder"));
    on.value = "+";
    sel.appendChild(on);
    return sel;
  }
  function wireNewFolder(sel, box) {
    var inp = el("input");
    inp.type = "text";
    inp.maxLength = 60;
    inp.placeholder = t("add.folderName");
    inp.setAttribute("aria-label", t("add.folderName"));
    inp.hidden = true;
    inp.className = "mt";
    box.appendChild(inp);
    sel.addEventListener("change", function () { inp.hidden = sel.value !== "+"; if (!inp.hidden) inp.focus(); });
    return function () {
      if (sel.value !== "+") return sel.value;
      var name = inp.value.replace(/\s+/g, " ").trim().slice(0, 60);
      if (!name) return "";
      return folderByName(name, true);
    };
  }
  function folderByName(name, create) {
    var low = name.toLowerCase();
    for (var i = 0; i < data.folders.length; i++) if (data.folders[i].name.toLowerCase() === low) return data.folders[i].id;
    if (!create) return "";
    var id = C.newId("d", now());
    var ord = data.folders.reduce(function (m, d) { return Math.max(m, d.ord + 1); }, 0);
    data.folders.push({ id: id, name: name, ord: ord, m: now() });
    return id;
  }

  function addDialog(prefill) {
    var dlg = makeDialog("add-dlg");
    dlg.classList.add("wide");
    dlg.appendChild(el("h2", "dlg-title", t("add.title")));
    var form = el("form");
    var lbl = el("label", "dlg-lbl", t("add.url"));
    lbl.htmlFor = "add-url";
    form.appendChild(lbl);
    var row = el("div", "inline");
    var inp = el("input");
    inp.type = "text";            // not "url": "site.gr" without https:// must pass
    inp.inputMode = "url";
    inp.id = "add-url";
    inp.placeholder = t("add.ph");
    inp.autocomplete = "off";
    inp.setAttribute("autocapitalize", "off");
    inp.spellcheck = false;
    inp.value = prefill || "";
    row.appendChild(inp);
    var find = button(t("add.find"), "primary small");
    find.type = "submit";
    row.appendChild(find);
    form.appendChild(row);
    var status = el("p", "dlg-hint");
    status.setAttribute("aria-live", "polite");
    form.appendChild(status);
    dlg.appendChild(form);
    var res = el("div", "found");
    dlg.appendChild(res);
    var acts = el("div", "dlg-actions");
    var go = button(t("add.go"), "primary");
    go.hidden = true;
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    acts.appendChild(go);
    dlg.appendChild(acts);
    var found = [], token = 0;
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var v = inp.value.trim();
      if (!v) return;
      if (!C.normUrl(v)) { status.textContent = t("add.bad"); status.className = "dlg-err"; return; }
      var my = ++token;
      status.className = "dlg-hint";
      status.textContent = t("add.finding");
      res.innerHTML = "";
      go.hidden = true;
      find.disabled = true;
      discoverFeeds(v).then(function (list) {
        if (my !== token) return;
        find.disabled = false;
        found = list;
        if (!list.length) { status.className = "dlg-err"; status.textContent = t("add.none"); return; }
        status.textContent = "";
        renderFound();
      }, function (err) {
        if (my !== token) return;
        find.disabled = false;
        status.className = "dlg-err";
        status.textContent = err.code === "bad" ? t("add.bad") : (err.code === "notfeed" ? t("add.none") : errText(err));
      });
    });
    function renderFound() {
      res.innerHTML = "";
      res.appendChild(el("div", "dlg-lbl", t("add.pick")));
      var ul = el("ul", "found-list");
      found.forEach(function (f, i) {
        var li = el("li");
        var lab = el("label", "found-row");
        var cb = el("input");
        cb.type = "checkbox";
        cb.checked = !f.have && i === found.findIndex(function (x) { return !x.have; });
        cb.disabled = f.have;
        cb.setAttribute("data-i", String(i));
        lab.appendChild(cb);
        var tx = el("span", "found-tx");
        tx.appendChild(el("span", "found-name", f.title));
        var bits = [f.have ? t("add.have") : "", t("add.items", { n: f.items }), f.last ? t("add.last", { when: ago(f.last) }) : ""].filter(Boolean);
        tx.appendChild(el("span", "found-meta", bits.join(" · ")));
        tx.appendChild(el("span", "found-url", f.url));
        lab.appendChild(tx);
        li.appendChild(lab);
        ul.appendChild(li);
      });
      res.appendChild(ul);
      var fl = el("label", "dlg-lbl", t("add.folder"));
      fl.htmlFor = "folder-sel";
      res.appendChild(fl);
      var sel = folderSelect(selKind() === "folder" ? selId() : "");
      res.appendChild(sel);
      var folderOf = wireNewFolder(sel, res);
      go.hidden = !found.some(function (f) { return !f.have; });
      go.onclick = function () {
        var picks = [].filter.call(res.querySelectorAll("input[type=checkbox]"), function (c) { return c.checked && !c.disabled; })
          .map(function (c) { return found[+c.getAttribute("data-i")]; });
        if (!picks.length) return;
        var folder = folderOf();
        go.disabled = true;
        picks.reduce(function (p, f) { return p.then(function () { return subscribe(f, folder); }); }, Promise.resolve()).then(function () {
          saveData();
          dlg.close();
          showToast(picks.length === 1 ? t("add.done", { name: picks[0].title }) : t("add.doneN", { n: picks.length }));
          select("f:" + picks[0].id);
        });
      };
    }
    document.body.appendChild(dlg);
    dlg.showModal();
    inp.focus();
    if (prefill) find.click();
  }

  function feedDialog(feed) {
    if (!feed) return;
    var dlg = makeDialog("feed-dlg");
    dlg.classList.add("wide");
    dlg.appendChild(el("h2", "dlg-title", t("feed.title")));
    var nl = el("label", "dlg-lbl", t("feed.name"));
    nl.htmlFor = "feed-name";
    dlg.appendChild(nl);
    var name = el("input");
    name.type = "text";
    name.id = "feed-name";
    name.maxLength = 200;
    name.value = feed.title;
    dlg.appendChild(name);
    var fl = el("label", "dlg-lbl", t("add.folder"));
    fl.htmlFor = "folder-sel";
    dlg.appendChild(fl);
    var sel = folderSelect(feed.folder);
    dlg.appendChild(sel);
    var folderOf = wireNewFolder(sel, dlg);
    var il = el("label", "dlg-lbl", t("feed.img"));
    il.htmlFor = "feed-img";
    dlg.appendChild(il);
    var img = el("select");
    img.id = "feed-img";
    [["-1", "feed.imgDef"], ["1", "feed.imgOn"], ["0", "feed.imgOff"]].forEach(function (o) {
      var op = el("option", "", t(o[1]));
      op.value = o[0];
      if (String(feed.img) === o[0]) op.selected = true;
      img.appendChild(op);
    });
    dlg.appendChild(img);
    dlg.appendChild(el("div", "dlg-lbl", t("feed.addr")));
    dlg.appendChild(el("p", "mono", feed.url));
    if (feed.site) {
      dlg.appendChild(el("div", "dlg-lbl", t("feed.site")));
      var a = el("a", "mono", feed.site);
      a.href = feed.site;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      dlg.appendChild(a);
    }
    var s = fstate[feed.id];
    var info = [s && s.ok ? t("feed.last", { when: ago(s.ok) }) : t("feed.never"), s && s.via === "r" ? t("feed.via") : ""].filter(Boolean).join(" · ");
    dlg.appendChild(el("p", "dlg-hint", info));
    if (s && s.err) dlg.appendChild(el("p", "dlg-err", errText({ code: s.err, extra: s.code })));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("feed.unsub"), "danger", function () {
      confirmDialog(t("feed.unsubQ", { name: feed.title }), t("dlg.delete"), function () { dlg.close(); unsubscribe(feed.id); });
    }));
    acts.appendChild(button(t("feed.refresh"), "", function () { dlg.close(); refresh([feed.id], true); }));
    acts.appendChild(button(t("dlg.save"), "primary", function () {
      var f = C.feedById(data, feed.id);
      if (!f) { dlg.close(); return; }
      var nv = name.value.replace(/\s+/g, " ").trim().slice(0, 200) || f.title;
      var folder = folderOf();
      var iv = +img.value;
      if (nv !== f.title || folder !== f.folder || iv !== f.img) {
        f.title = nv; f.folder = folder; f.img = iv; f.m = Math.max(now(), f.m + 1);
        saveData();
      }
      dlg.close();
      renderAll();
    }));
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  function unsubscribe(fid) {
    var f = C.feedById(data, fid);
    if (!f) return;
    var t0 = Math.max(now(), f.m + 1);
    data.feeds = data.feeds.filter(function (x) { return x.id !== fid; });
    data.tombs["f:" + fid] = t0;
    delete fstate[fid];
    saveData();
    saveState();
    dropFeedArticles(fid).then(function () {
      if (openItem && openItem.feed === fid && !C.savedById(data, openItem.id)) openItem = null;
      renderAll();
    });
  }

  function folderDialog(d) {
    if (!d) return;
    var dlg = makeDialog("folder-dlg");
    dlg.appendChild(el("h2", "dlg-title", t("folder.title")));
    var nl = el("label", "dlg-lbl", t("feed.name"));
    nl.htmlFor = "folder-name";
    dlg.appendChild(nl);
    var name = el("input");
    name.type = "text";
    name.id = "folder-name";
    name.maxLength = 60;
    name.value = d.name;
    dlg.appendChild(name);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("folder.del"), "danger", function () {
      confirmDialog(t("folder.delQ", { name: d.name }), t("dlg.delete"), function () {
        dlg.close();
        var t0 = now();
        data.feeds.forEach(function (f) { if (f.folder === d.id) { f.folder = ""; f.m = Math.max(t0, f.m + 1); } });
        data.folders = data.folders.filter(function (x) { return x.id !== d.id; });
        data.tombs["d:" + d.id] = Math.max(t0, d.m + 1);
        saveData();
        select("all");
      });
    }));
    acts.appendChild(button(t("dlg.save"), "primary", function () {
      var cur = C.folderById(data, d.id);
      var nv = name.value.replace(/\s+/g, " ").trim().slice(0, 60);
      if (cur && nv && nv !== cur.name) { cur.name = nv; cur.m = Math.max(now(), cur.m + 1); saveData(); }
      dlg.close();
      renderAll();
    }));
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  function settingsDialog() {
    var dlg = makeDialog("set-dlg");
    dlg.classList.add("wide");
    dlg.appendChild(el("h2", "dlg-title", t("set.title")));
    function selectRow(id, label, opts, cur) {
      var l = el("label", "dlg-lbl", label);
      l.htmlFor = id;
      dlg.appendChild(l);
      var s = el("select");
      s.id = id;
      opts.forEach(function (o) {
        var op = el("option", "", o[1]);
        op.value = String(o[0]);
        if (o[0] === cur) op.selected = true;
        s.appendChild(op);
      });
      dlg.appendChild(s);
      return s;
    }
    function check(id, label, on) {
      var l = el("label", "check");
      var c = el("input");
      c.type = "checkbox";
      c.id = id;
      c.checked = !!on;
      l.appendChild(c);
      l.appendChild(el("span", "", label));
      dlg.appendChild(l);
      return c;
    }
    var rf = selectRow("set-refresh", t("set.refresh"), [0, 15, 30, 60, 180].map(function (v) { return [v, t("set.r" + v)]; }), C.setting(data, "refresh"));
    var so = selectRow("set-sort", t("set.sort"), [["new", t("set.new")], ["old", t("set.old")]], C.setting(data, "sort"));
    var fo = selectRow("set-font", t("set.font"), [[1, t("set.f1")], [2, t("set.f2")], [3, t("set.f3")]], prefs.font);
    var im = check("set-img", t("set.img"), C.setting(data, "img") === 1);
    var sc = check("set-scroll", t("set.scroll"), C.setting(data, "scroll") === 1);
    var rl = el("label", "dlg-lbl", t("set.relay"));
    rl.htmlFor = "set-relay";
    dlg.appendChild(rl);
    var relay = el("input");
    relay.type = "url";
    relay.id = "set-relay";
    relay.placeholder = "https://…";
    relay.value = C.setting(data, "relay");
    relay.spellcheck = false;
    dlg.appendChild(relay);
    dlg.appendChild(el("p", "dlg-hint", t("set.relayHint")));
    var mr = mailRelay();
    if (mr) dlg.appendChild(el("p", "dlg-hint dim", t("set.relayMail", { url: mr })));
    var err = el("p", "dlg-err");
    dlg.appendChild(err);
    dlg.appendChild(el("div", "dlg-lbl", t("set.opml")));
    var io = el("div", "inline");
    io.appendChild(button(t("set.import"), "small", function () { dlg.close(); importOpml(); }));
    var ex = button(t("set.export"), "small", function () { exportOpml(); });
    ex.disabled = !data.feeds.length;
    io.appendChild(ex);
    dlg.appendChild(io);
    dlg.appendChild(el("p", "dlg-hint", t("set.keep")));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    acts.appendChild(button(t("dlg.save"), "primary", function () {
      var ru = C.normRelayUrl(relay.value);
      if (ru === null) { err.textContent = t("toast.relayBad"); return; }
      var t0 = now(), ch = false;
      ch = C.putSetting(data, "refresh", +rf.value, t0) || ch;
      ch = C.putSetting(data, "sort", so.value, t0) || ch;
      ch = C.putSetting(data, "img", im.checked ? 1 : 0, t0) || ch;
      ch = C.putSetting(data, "scroll", sc.checked ? 1 : 0, t0) || ch;
      var hadRelay = !!relayUrl();
      ch = C.putSetting(data, "relay", ru, t0) || ch;
      if (ch) saveData();
      prefs.font = +fo.value;
      savePrefs();
      dlg.close();
      renderAll();
      if (!hadRelay && relayUrl()) {   // feeds waiting for the relay: now
        var waiting = data.feeds.filter(function (f) { var s = fstate[f.id]; return s && s.err === "norelay"; }).map(function (f) { return f.id; });
        if (waiting.length) refresh(waiting, false);
      }
    }));
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  function dialogHost() {
    try {
      var d = window.parent && window.parent !== window ? window.parent.orosDialog : null;
      if (d && typeof d.saveFile === "function") return d;
    } catch (e) {}
    return null;
  }
  function importOpml() {
    var host = dialogHost();
    var pick = host ? host.openFile(".opml,.xml,text/xml,text/x-opml,application/xml") : localOpen(".opml,.xml");
    pick.then(function (file) {
      if (!file) return;
      return file.text().then(function (text) {
        var list = C.parseOpml(text);
        if (list === null) { showToast(t("opml.bad")); return; }
        list = list.filter(function (x) { return !C.feedById(data, C.feedId(x.url)); });
        if (!list.length) { showToast(t("opml.none")); return; }
        var room = C.MAX_FEEDS - data.feeds.length;
        if (room <= 0) { showToast(t("add.limit")); return; }
        list = list.slice(0, room);
        var t0 = now(), ids = [];
        list.forEach(function (x) {
          var id = C.feedId(x.url);
          var folder = x.folder ? folderByName(x.folder, true) : "";
          data.feeds.push({ id: id, url: x.url, title: x.title || C.siteOf(x.url), site: x.site, folder: folder, img: -1,
                            m: Math.max(t0, (data.tombs["f:" + id] || 0) + 1) });
          ids.push(id);
        });
        saveData();
        showToast(t("add.doneN", { n: ids.length }));
        renderAll();
        refresh(ids, false);
      });
    }).catch(function () {});
  }
  function localOpen(accept) {
    return new Promise(function (resolve) {
      var inp = el("input");
      inp.type = "file";
      inp.accept = accept;
      inp.addEventListener("change", function () { resolve(inp.files && inp.files[0] || null); });
      inp.click();
    });
  }
  function exportOpml() {
    var text = C.buildOpml(data, "orOS " + t("app"), now());
    var d = new Date(), pad = function (n) { return (n < 10 ? "0" : "") + n; };
    var name = "oros-reader-" + d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + ".opml";
    var host = dialogHost();
    if (host) {
      host.saveFile({ text: text, filename: name, mime: "text/x-opml",
                      types: [{ description: "OPML", accept: { "text/x-opml": [".opml"] } }] }).then(function (r) {
        if (!r || (!r.ok && r.mode !== "native")) showToast(t("toast.saveFail"));
      });
      return;
    }
    var url = URL.createObjectURL(new Blob([text], { type: "text/x-opml" }));
    var link = el("a");
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 40000);
  }

  // ---------- 12. Dialogs + toasts ----------
  function button(label, cls, fn) {
    var b = el("button", "dlg-btn" + (cls ? " " + cls : ""), label);
    b.type = "button";
    if (fn) b.addEventListener("click", fn);
    return b;
  }
  function makeDialog(id) {
    var stale = document.getElementById(id);
    if (stale) stale.remove();
    var dlg = document.createElement("dialog");
    dlg.id = id;
    dlg.className = "mm-dlg";
    dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener("close", function () {
      parkToast();
      setTimeout(function () { dlg.remove(); }, 0);
    });
    return dlg;
  }
  function confirmDialog(text, okLabel, fn) {
    var dlg = makeDialog("confirm-dlg");
    dlg.appendChild(el("p", "dlg-text", text));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    acts.appendChild(button(okLabel, "danger", function () { dlg.close(); fn(); }));
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  function showToast(text) {
    try {
      var n = (window.parent && window.parent !== window && window.parent.orosNotifs) || null;
      if (n && typeof n.transient === "function" && n.transient({ ns: "feeds", title: String(text) })) return;
    } catch (e) {}
    localToast(text);
  }
  var toastTimer = null;
  function localToast(text) {
    var box = $("toast");
    if (!box) return;
    hostToast();
    box.textContent = text;
    box.classList.remove("show");
    void box.offsetWidth;
    box.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.classList.remove("show"); }, 4000);
  }
  function hostToast() {
    var box = $("toast"), d = document.querySelector("dialog[open]");
    if (box && d && box.parentNode !== d) d.appendChild(box);
  }
  function parkToast() {
    var box = $("toast");
    if (box && box.parentNode !== document.body) document.body.appendChild(box);
  }
  // Undo bar: in the app (an action button cannot ride a shell toast).
  function showUndo(text, fn) {
    var bar = $("undo");
    clearTimeout(undo);
    bar.innerHTML = "";
    bar.appendChild(el("span", "", text));
    var b = el("button", "link-btn", t("mark.undo"));
    b.type = "button";
    b.addEventListener("click", function () { clearTimeout(undo); bar.hidden = true; fn(); });
    bar.appendChild(b);
    bar.hidden = false;
    undo = setTimeout(function () { bar.hidden = true; }, UNDO_MS);
  }

  // ---------- 13. Keyboard + swipe ----------
  function wireKeyboard() {
    // Contract B: forward Ctrl+Alt+Shift shortcuts to the shell (capture)
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
      var p = null;
      try { p = window.parent; } catch (err) { return; }
      if (!(p && p !== window && p.orosShortcuts && typeof p.orosShortcuts.handle === "function")) return;
      if (p.orosShortcuts.handle(e)) e.stopPropagation();
    }, true);
    // InoReader-style keys: j/k next/previous, s star, l later,
    // m read/unread, v original, r refresh, a add, Shift+A mark all
    document.addEventListener("keydown", function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var tag = e.target && e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (document.querySelector("dialog[open]")) return;
      var k = e.key;
      if (k === "Escape" && view !== "list" && narrow()) { e.preventDefault(); setView("list"); return; }
      if (k === "j" || k === "k" || k === "ArrowDown" || k === "ArrowUp") {
        if (tag === "BUTTON" && (k === "ArrowDown" || k === "ArrowUp") && !e.target.classList.contains("row")) return;
        var items = listItems().slice(0, shown);
        if (!items.length) return;
        e.preventDefault();
        var idx = -1;
        if (openItem) items.forEach(function (it, i) { if (it.id === openItem.id) idx = i; });
        var dir = (k === "j" || k === "ArrowDown") ? 1 : -1;
        var next = items[Math.max(0, Math.min(items.length - 1, idx + dir))];
        if (next && (!openItem || next.id !== openItem.id)) {
          openArticle(next.id);
          var row = document.querySelector('.row[data-id="' + next.id + '"]');
          if (row) row.focus();
        }
        return;
      }
      if (k === "a") { e.preventDefault(); addDialog(""); return; }
      if (k === "A") { e.preventDefault(); if (selKind() !== "star" && selKind() !== "later") markAllDialog(); return; }
      if (k === "r") { e.preventDefault(); refresh(selKind() === "feed" ? [selId()] : (selKind() === "folder" ? selFeeds() : null), true); return; }
      if (!openItem) return;
      if (k === "s") { e.preventDefault(); toggleSaved(openItem.id, "star"); }
      else if (k === "l") { e.preventDefault(); toggleSaved(openItem.id, "later"); }
      else if (k === "m") { e.preventDefault(); toggleRead(openItem.id); }
      else if (k === "v") {
        var it = itemOf(openItem.id);
        if (it && it.link) { e.preventDefault(); window.open(it.link, "_blank", "noopener,noreferrer"); }
      }
    });
  }

  // Phones: swipe a row right = read/unread, left = star.
  function wireSwipe(b, it) {
    var x0 = 0, y0 = 0, dx = 0, on = false, locked = false;
    b.addEventListener("touchstart", function (e) {
      if (e.touches.length !== 1) return;
      x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; on = true; locked = false;
    }, { passive: true });
    b.addEventListener("touchmove", function (e) {
      if (!on) return;
      var mx = e.touches[0].clientX - x0, my = e.touches[0].clientY - y0;
      if (!locked) {
        if (Math.abs(my) > 10 && Math.abs(my) > Math.abs(mx)) { on = false; return; }
        if (Math.abs(mx) > 12) locked = true;
      }
      if (locked) {
        dx = Math.max(-120, Math.min(120, mx));
        b.style.transform = "translateX(" + dx + "px)";
        b.classList.toggle("sw-r", dx > 70);
        b.classList.toggle("sw-l", dx < -70);
      }
    }, { passive: true });
    function end() {
      if (!on) return;
      on = false;
      b.style.transform = "";
      b.classList.remove("sw-r", "sw-l");
      if (dx > 70) toggleRead(it.id);
      else if (dx < -70) toggleSaved(it.id, "star");
      if (locked) { b.addEventListener("click", swallow, true); setTimeout(function () { b.removeEventListener("click", swallow, true); }, 350); }
    }
    function swallow(e) { e.stopPropagation(); e.preventDefault(); }
    b.addEventListener("touchend", end);
    b.addEventListener("touchcancel", end);
  }

  // ---------- 14. Sync slice + palette ----------
  var PAL_VARS = ["--bg", "--bg-desktop", "--bar-bg", "--text", "--text-dim", "--accent", "--accent-hover",
                  "--accent-soft", "--panel-bg", "--border", "--shadow", "--danger"];
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
      new MutationObserver(function () { inheritPalette(); if (openItem) renderReader(); }).observe(
        window.parent.document.documentElement, { attributes: true, attributeFilter: ["data-skin", "data-theme"] });
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
    api.registerSlice("feeds", sliceGet, sliceSet, STORAGE_KEY, C.merge);
  }
  function sliceGet() { return C.merge(data, null); }   // canonical copy (R26)
  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.feeds)) return;
    var before = JSON.stringify(data);
    var had = {};
    data.feeds.forEach(function (f) { had[f.id] = 1; });
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = C.merge(incoming, null);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    if (JSON.stringify(data) === before) return;
    var live = {}, fresh = [];
    data.feeds.forEach(function (f) { live[f.id] = 1; if (!had[f.id]) fresh.push(f.id); });
    Object.keys(had).forEach(function (id) { if (!live[id]) dropFeedArticles(id); });   // removed elsewhere
    if (openItem && !live[openItem.feed] && !C.savedById(data, openItem.id)) openItem = null;
    renderAll();
    if (fresh.length) refresh(fresh, false);                                             // added elsewhere
  }

  // ---------- 15. Wiring & boot ----------
  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) { n.textContent = t(n.getAttribute("data-i18n")); });
    document.title = t("app") + " · orOS";
    $("side").setAttribute("aria-label", t("nav.side"));
    [["refresh-btn", UI.refresh, "btn.refresh"], ["add-btn", UI.plus, "btn.add"], ["settings-btn", UI.gear, "btn.settings"]].forEach(function (r) {
      var b = $(r[0]);
      b.innerHTML = r[1];
      b.setAttribute("aria-label", t(r[2]));
      b.title = t(r[2]);
    });
    var sa = $("side-add");
    sa.innerHTML = UI.plus;
    sa.appendChild(el("span", "", t("side.add")));
    $("wel-icon").innerHTML = UI.big;
  }

  function wire() {
    $("nav-btn").addEventListener("click", function () {
      if (phone() && view === "read") setView("list");
      else setView(view === "side" ? "list" : "side");
    });
    $("scrim").addEventListener("click", function () { setView("list"); });
    $("refresh-btn").addEventListener("click", function () {
      var k = selKind();
      refresh(k === "feed" ? [selId()] : (k === "folder" ? selFeeds() : null), true);
    });
    $("add-btn").addEventListener("click", function () { addDialog(""); });
    $("side-add").addEventListener("click", function () { addDialog(""); });
    $("wel-add").addEventListener("click", function () { addDialog(""); });
    $("wel-import").addEventListener("click", importOpml);
    $("settings-btn").addEventListener("click", settingsDialog);
    window.addEventListener("online", function () { renderBar(); refresh(null, false); });
    window.addEventListener("offline", renderBar);
    window.addEventListener("resize", function () {
      if (!narrow() && view === "side") setView("list");
      if (!phone() && view === "read") setView("list");
      renderBar();
    });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible" && C.setting(data, "refresh") > 0 && !busy) refresh(null, false);
    });
    wireKeyboard();
  }

  function boot() {
    load();
    loadPrefs();
    loadState();
    applyI18n();
    wire();
    registerSync();
    inheritPalette();
    watchPalette();
    setView("list");
    renderAll();
    loadHeads().then(function () {
      renderAll();
      if (data.feeds.length && C.setting(data, "refresh") > 0) refresh(null, false);
      scheduleTick();
    });
  }

  boot();
})();
