// ============================================================
// orOS Assistant — App logic (v1.1.0, phase 2: entry cards, chat sync)
// A chat with the AI assistant the user picks (Claude, ChatGPT,
// Gemini, Mistral, OpenRouter, or a local / OpenAI-compatible
// model), called straight from the browser: no orOS server in
// between. It can search the user's orOS data through the shell's
// universal search, and every result the user has not allowed for
// good is shown to them first ("Share" / "Don't share").
// The assistant writes no app's data: a suggested entry is a card
// whose button opens that app's own prefill bridge, where the user
// saves it (core.js section 10).
// Data:
//   - synced slice "assistant" (oros-assistant-data): provider,
//     model, permissions per app, "chat only", key-sync switch and,
//     only when that switch is on, the API keys sealed with the sync
//     passphrase (core.js section 2)
//   - device-local (R10): oros-assistant-prefs (open chat, keep
//     history, token counts per month); IndexedDB "oros-assistant":
//     non-extractable device key, API keys sealed with it,
//     conversations. Never exported.
//   - optional (switch "cs" in the slice): every conversation also as
//     a file in /internal/Assistant/Chats on the orOS disk, carried
//     to the other devices, encrypted, by Vault Drive (section 7b)
// Sections:
//   1. Constants, i18n, helpers
//   2. Data + prefs
//   3. Device store (IndexedDB)
//   4. API keys (sealed on the device; optional encrypted sync)
//   5. Shell bridges (apps, search, open)
//   6. Provider calls (fetch + streaming)
//   7. Conversation: turns, tools, sharing consent, entry cards
//  7b. Conversation sync (files through Vault Drive)
//   8. UI: chats, messages, Markdown
//   9. Settings dialog
//  10. Dialogs + toasts
//  11. Keyboard
//  12. Sync slice + palette
//  13. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var C = window.OrosAssistCore;
  var STORAGE_KEY = "oros-assistant-data";
  var PREFS_KEY   = "oros-assistant-prefs";
  var DB_NAME     = "oros-assistant";
  var MAX_CHATS   = 200;
  var MAX_INPUT   = 20000;

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
      "app": "Assistant",
      "btn.new": "New chat", "btn.settings": "Settings", "btn.chats": "Conversations",
      "btn.send": "Send", "btn.stop": "Stop", "btn.close": "Close", "btn.cancel": "Cancel",
      "btn.delete": "Delete", "btn.setup": "Set up the assistant",
      "wel.title": "Your AI assistant",
      "wel.text": "Pick the assistant you want: Claude, ChatGPT, Gemini, Mistral, OpenRouter, or a model running on your own computer. It reads your orOS data only when you allow it, and nothing is saved in your apps until you save it yourself.",
      "wel.ready": "Ask anything. For questions about your own notes, tasks or events, the assistant searches your apps and shows you what it found before anything is shared. It can also prepare a task, an event or an expense for you to save.",
      "ph.input": "Message the assistant…", "ph.noSetup": "Set up the assistant first",
      "chats.empty": "No conversations yet",
      "chats.local": "Kept on this device only",
      "chats.synced": "Synced to your devices (encrypted)",
      "chats.off": "History is off: conversations are not kept",
      "who": "{name} · {model}", "who.to": "Sent to {host}",
      "who.chatOnly": "Chat only: no access to your data",
      "off.line": "You are offline. {name} can't be reached until you are back online.",
      "tool.search": "Searched for “{q}”",
      "tool.shared": "you shared {n} ({apps})",
      "tool.none": "nothing found",
      "tool.held": "you kept {n} back",
      "tool.noneShared": "you shared nothing",
      "tool.apps": "Looked at which apps it may search",
      "tool.err": "The search did not work",
      "tool.read": "Read “{title}”", "tool.readNo": "You kept “{title}” back", "tool.readGone": "“{title}” is no longer there",
      "read.title": "Share all of “{title}” with {name}?",
      "read.text": "{app} · {n} characters. Only this item is sent.",
      "read.yes": "Share", "read.no": "Don't share",
      "entry.todo": "Add to {app}", "entry.event": "New event · {app}",
      "entry.expense": "New expense · {app}", "entry.income": "New income · {app}",
      "entry.quote": "New quote · {app}", "entry.sheet": "New sheet · {app}",
      "entry.slides": "New presentation · {app}", "entry.bookmark": "New bookmark · {app}", "entry.note": "New note · {app}",
      "entry.open": "Open in {app}", "entry.dismiss": "Dismiss",
      "entry.hint.form": "Opens {app} with this filled in. Nothing is saved until you save it there.",
      "entry.hint.make": "The button makes it in {app}; you can change or delete it there.",
      "entry.hint.slides": "Opens {app}; the presentation is made when you pick a theme there.",
      "entry.opened": "Opened in {app}", "entry.dismissed": "Dismissed", "entry.failed": "{app} did not accept it",
      "entry.more": "+{n} more", "entry.gone": "{app} is not installed",
      "f.list": "New list", "f.date": "Date", "f.start": "Time", "f.location": "Place", "f.amount": "Amount",
      "f.category": "Category", "f.client": "Client", "f.currency": "Currency", "f.url": "Address",
      "cat.groceries": "Groceries", "cat.eating-out": "Eating out", "cat.bills": "Bills", "cat.home": "Home",
      "cat.transport": "Transport", "cat.health": "Health", "cat.fun": "Fun", "cat.clothes": "Clothes",
      "cat.gift": "Gifts", "cat.salary": "Salary", "cat.freelance": "Freelance", "cat.other": "Other",
      "share.title": "Share with {name}?",
      "share.text": "The assistant searched your data for “{q}”. Tick what it may see; the rest stays on this device.",
      "share.always": "Always share from {apps} without asking",
      "share.yes": "Share ({n})", "share.no": "Don't share",
      "note.stopped": "Stopped.", "note.refused": "The assistant declined to answer this.",
      "note.cut": "The answer was cut off because it was too long.",
      "note.rounds": "The assistant stopped after too many searches. Ask again more precisely.",
      "err.key": "{name} did not accept the key. Check it in Settings.",
      "err.credit": "Your {name} account has no credit left.",
      "err.rate": "{name} is limiting requests right now (too many, or your quota is used up). Try again in a little while.",
      "err.model": "{name} does not know the model “{model}”. Pick another one in Settings.",
      "err.bad": "{name} refused the request: {msg}",
      "err.busy": "{name} is overloaded. Try again in a moment.",
      "err.server": "{name} answered with an error: {msg}",
      "err.net": "Could not reach {host}. You may be offline, the service may not accept calls from a browser, or (for a model on your computer) the server is not running or does not allow this site.",
      "err.noKey": "The key for {name} could not be read on this device. Enter it again in Settings.",
      "err.stream": "The answer could not be read.",
      "set.title": "Assistant settings",
      "set.provider": "Assistant", "set.choose": "Choose…",
      "set.key": "API key", "set.keySaved": "Saved on this device (…{tail})", "set.keyNone": "No key on this device yet",
      "set.keySave": "Save key", "set.keyRemove": "Remove key", "set.keyGet": "Get a key",
      "set.keyHint": "The key is kept on this device, encrypted, and is sent only to {host}. You pay {name} for what you use: set a spending limit on their site.",
      "set.keyOpt": "API key (optional)",
      "set.base": "Server address",
      "set.baseHint": "Ollama: http://localhost:11434/v1 (start it with OLLAMA_ORIGINS=https://useoros.online). LM Studio: http://localhost:1234/v1 with CORS on. Nothing leaves your network.",
      "set.model": "Model", "set.models": "Load models", "set.modelsBusy": "Loading…",
      "set.modelsOk": "The key works · {n} models", "set.modelsNone": "No chat models came back",
      "set.data": "Your data", "set.chatOnly": "Chat only: the assistant can't search my orOS data",
      "set.dataHint": "When the assistant needs your data it searches these apps. “Ask first” shows you every result before it is shared.",
      "perm.ask": "Ask first", "perm.always": "Always share", "perm.never": "Never",
      "set.noApps": "Open orOS from its home screen to choose apps.",
      "set.sync": "Sync", "set.syncKeys": "Sync API keys to my other devices (end-to-end encrypted)",
      "set.syncHint": "Keys travel inside your encrypted orOS sync, sealed with your sync passphrase. Anyone who knows that passphrase can use them.",
      "set.syncNeeds": "Turn on orOS sync and unlock it with your passphrase first.",
      "set.syncChats": "Sync conversations to my other devices (end-to-end encrypted)",
      "set.syncChatsHint": "Each conversation is also kept as an encrypted file in Files (internal › Assistant), and Vault Drive carries it to your other devices. Turning this off stops it; the files stay until you delete them in Files.",
      "set.syncChatsWait": "orOS sync is not connected and unlocked on this device, so the conversations wait here until it is.",
      "set.syncChatsKeep": "Turn on “Keep conversations on this device” first.",
      "set.wipeQAll": "Delete every conversation on all your devices? This cannot be undone.",
      "set.device": "This device", "set.keep": "Keep conversations on this device",
      "set.wipe": "Delete all conversations", "set.wipeQ": "Delete every conversation on this device? This cannot be undone.",
      "set.keepOffQ": "Stop keeping conversations and delete the ones on this device?",
      "set.usage": "Used this month", "set.usageRow": "{name}: {i} in · {o} out (tokens)", "set.usageNone": "Nothing yet",
      "del.title": "Delete conversation", "del.q": "Delete “{title}”?",
      "toast.saved": "Saved", "toast.keyRemoved": "Key removed", "toast.storage": "Not saved: storage is full",
      "toast.deleted": "Deleted", "toast.lock": "Unlock orOS sync to use the keys from your other devices",
      "open.gone": "That item is no longer there",
      "chat.untitled": "New conversation", "time.today": "Today", "time.yesterday": "Yesterday",
      "you": "You"
    },
    el: {
      "app": "Βοηθός",
      "btn.new": "Νέα συζήτηση", "btn.settings": "Ρυθμίσεις", "btn.chats": "Συζητήσεις",
      "btn.send": "Αποστολή", "btn.stop": "Διακοπή", "btn.close": "Κλείσιμο", "btn.cancel": "Άκυρο",
      "btn.delete": "Διαγραφή", "btn.setup": "Ρύθμιση του βοηθού",
      "wel.title": "Ο AI βοηθός σου",
      "wel.text": "Διάλεξε τον βοηθό που θέλεις: Claude, ChatGPT, Gemini, Mistral, OpenRouter ή ένα μοντέλο στον δικό σου υπολογιστή. Διαβάζει τα δεδομένα σου στο orOS μόνο όταν το επιτρέψεις, και τίποτα δεν αποθηκεύεται στις εφαρμογές σου αν δεν το αποθηκεύσεις εσύ.",
      "wel.ready": "Ρώτα ό,τι θέλεις. Για ερωτήσεις πάνω στις σημειώσεις, τις εργασίες ή τα γεγονότα σου, ο βοηθός ψάχνει στις εφαρμογές σου και σου δείχνει τι βρήκε πριν μοιραστεί οτιδήποτε. Μπορεί επίσης να σου ετοιμάσει μια εργασία, ένα γεγονός ή ένα έξοδο για να το αποθηκεύσεις.",
      "ph.input": "Γράψε στον βοηθό…", "ph.noSetup": "Ρύθμισε πρώτα τον βοηθό",
      "chats.empty": "Καμία συζήτηση ακόμη",
      "chats.local": "Μένουν μόνο σε αυτή τη συσκευή",
      "chats.synced": "Συγχρονίζονται στις συσκευές σου (κρυπτογραφημένα)",
      "chats.off": "Το ιστορικό είναι κλειστό: οι συζητήσεις δεν κρατιούνται",
      "who": "{name} · {model}", "who.to": "Στέλνεται στο {host}",
      "who.chatOnly": "Μόνο συζήτηση: χωρίς πρόσβαση στα δεδομένα σου",
      "off.line": "Είσαι εκτός σύνδεσης. Το {name} δεν είναι διαθέσιμο μέχρι να ξανασυνδεθείς.",
      "tool.search": "Αναζήτηση για «{q}»",
      "tool.shared": "μοιράστηκες {n} ({apps})",
      "tool.none": "δεν βρέθηκε τίποτα",
      "tool.held": "κράτησες {n}",
      "tool.noneShared": "δεν μοιράστηκες τίποτα",
      "tool.apps": "Κοίταξε σε ποιες εφαρμογές μπορεί να ψάξει",
      "tool.err": "Η αναζήτηση δεν έγινε",
      "tool.read": "Διάβασε το «{title}»", "tool.readNo": "Κράτησες το «{title}»", "tool.readGone": "Το «{title}» δεν υπάρχει πια",
      "read.title": "Να δει το {name} ολόκληρο το «{title}»;",
      "read.text": "{app} · {n} χαρακτήρες. Στέλνεται μόνο αυτό το στοιχείο.",
      "read.yes": "Κοινοποίηση", "read.no": "Όχι",
      "entry.todo": "Προσθήκη: {app}", "entry.event": "Νέο γεγονός · {app}",
      "entry.expense": "Νέο έξοδο · {app}", "entry.income": "Νέο έσοδο · {app}",
      "entry.quote": "Νέα προσφορά · {app}", "entry.sheet": "Νέο φύλλο · {app}",
      "entry.slides": "Νέα παρουσίαση · {app}", "entry.bookmark": "Νέος σελιδοδείκτης · {app}", "entry.note": "Νέα σημείωση · {app}",
      "entry.open": "Άνοιγμα: {app}", "entry.dismiss": "Απόρριψη",
      "entry.hint.form": "Ανοίγει συμπληρωμένη η φόρμα ({app}). Δεν αποθηκεύεται τίποτα μέχρι να την αποθηκεύσεις εκεί.",
      "entry.hint.make": "Το κουμπί το δημιουργεί ({app})· εκεί μπορείς να το αλλάξεις ή να το σβήσεις.",
      "entry.hint.slides": "Ανοίγει: {app}· η παρουσίαση δημιουργείται όταν διαλέξεις θέμα εκεί.",
      "entry.opened": "Άνοιξε: {app}", "entry.dismissed": "Απορρίφθηκε", "entry.failed": "Δεν έγινε δεκτό ({app})",
      "entry.more": "+{n} ακόμη", "entry.gone": "Δεν είναι εγκατεστημένο: {app}",
      "f.list": "Νέα λίστα", "f.date": "Ημερομηνία", "f.start": "Ώρα", "f.location": "Τοποθεσία", "f.amount": "Ποσό",
      "f.category": "Κατηγορία", "f.client": "Πελάτης", "f.currency": "Νόμισμα", "f.url": "Διεύθυνση",
      "cat.groceries": "Σούπερ μάρκετ", "cat.eating-out": "Φαγητό έξω", "cat.bills": "Λογαριασμοί", "cat.home": "Σπίτι",
      "cat.transport": "Μετακινήσεις", "cat.health": "Υγεία", "cat.fun": "Διασκέδαση", "cat.clothes": "Ρούχα",
      "cat.gift": "Δώρα", "cat.salary": "Μισθός", "cat.freelance": "Ελεύθερη εργασία", "cat.other": "Άλλα",
      "share.title": "Να το δει το {name};",
      "share.text": "Ο βοηθός έψαξε στα δεδομένα σου για «{q}». Τσέκαρε ό,τι επιτρέπεις να δει· τα υπόλοιπα μένουν σε αυτή τη συσκευή.",
      "share.always": "Να μοιράζονται πάντα χωρίς ερώτηση από: {apps}",
      "share.yes": "Κοινοποίηση ({n})", "share.no": "Όχι",
      "note.stopped": "Διακόπηκε.", "note.refused": "Ο βοηθός αρνήθηκε να απαντήσει σε αυτό.",
      "note.cut": "Η απάντηση κόπηκε γιατί ήταν πολύ μεγάλη.",
      "note.rounds": "Ο βοηθός σταμάτησε μετά από πολλές αναζητήσεις. Ρώτα ξανά πιο συγκεκριμένα.",
      "err.key": "Το {name} δεν δέχτηκε το κλειδί. Έλεγξέ το στις Ρυθμίσεις.",
      "err.credit": "Ο λογαριασμός σου στο {name} δεν έχει άλλη πίστωση.",
      "err.rate": "Το {name} περιορίζει τα αιτήματα αυτή τη στιγμή (πάρα πολλά ή τελείωσε το όριό σου). Δοκίμασε ξανά σε λίγο.",
      "err.model": "Το {name} δεν γνωρίζει το μοντέλο «{model}». Διάλεξε άλλο στις Ρυθμίσεις.",
      "err.bad": "Το {name} απέρριψε το αίτημα: {msg}",
      "err.busy": "Το {name} έχει φόρτο. Δοκίμασε ξανά σε λίγο.",
      "err.server": "Το {name} απάντησε με σφάλμα: {msg}",
      "err.net": "Δεν έγινε σύνδεση με το {host}. Ίσως είσαι εκτός σύνδεσης, ίσως η υπηρεσία δεν δέχεται κλήσεις από browser, ή (για μοντέλο στον υπολογιστή σου) ο server δεν τρέχει ή δεν επιτρέπει αυτή τη σελίδα.",
      "err.noKey": "Το κλειδί για το {name} δεν διαβάζεται σε αυτή τη συσκευή. Βάλ' το ξανά στις Ρυθμίσεις.",
      "err.stream": "Η απάντηση δεν διαβάστηκε.",
      "set.title": "Ρυθμίσεις βοηθού",
      "set.provider": "Βοηθός", "set.choose": "Διάλεξε…",
      "set.key": "Κλειδί API", "set.keySaved": "Αποθηκευμένο σε αυτή τη συσκευή (…{tail})", "set.keyNone": "Δεν υπάρχει κλειδί σε αυτή τη συσκευή",
      "set.keySave": "Αποθήκευση κλειδιού", "set.keyRemove": "Αφαίρεση κλειδιού", "set.keyGet": "Πάρε κλειδί",
      "set.keyHint": "Το κλειδί μένει κρυπτογραφημένο σε αυτή τη συσκευή και στέλνεται μόνο στο {host}. Πληρώνεις το {name} για όσα χρησιμοποιείς: βάλε όριο δαπάνης στη σελίδα του.",
      "set.keyOpt": "Κλειδί API (προαιρετικό)",
      "set.base": "Διεύθυνση server",
      "set.baseHint": "Ollama: http://localhost:11434/v1 (ξεκίνα το με OLLAMA_ORIGINS=https://useoros.online). LM Studio: http://localhost:1234/v1 με ενεργό το CORS. Τίποτα δεν φεύγει από το δίκτυό σου.",
      "set.model": "Μοντέλο", "set.models": "Φόρτωση μοντέλων", "set.modelsBusy": "Φόρτωση…",
      "set.modelsOk": "Το κλειδί δουλεύει · {n} μοντέλα", "set.modelsNone": "Δεν ήρθαν μοντέλα συζήτησης",
      "set.data": "Τα δεδομένα σου", "set.chatOnly": "Μόνο συζήτηση: ο βοηθός δεν ψάχνει στα δεδομένα μου στο orOS",
      "set.dataHint": "Όταν ο βοηθός χρειάζεται τα δεδομένα σου, ψάχνει σε αυτές τις εφαρμογές. Το «Ρώτα πρώτα» σού δείχνει κάθε αποτέλεσμα πριν μοιραστεί.",
      "perm.ask": "Ρώτα πρώτα", "perm.always": "Πάντα", "perm.never": "Ποτέ",
      "set.noApps": "Άνοιξε το orOS από την αρχική του οθόνη για να διαλέξεις εφαρμογές.",
      "set.sync": "Συγχρονισμός", "set.syncKeys": "Συγχρονισμός κλειδιών API στις άλλες συσκευές μου (κρυπτογραφημένα)",
      "set.syncHint": "Τα κλειδιά ταξιδεύουν μέσα στο κρυπτογραφημένο sync του orOS, σφραγισμένα με το passphrase σου. Όποιος ξέρει το passphrase μπορεί να τα χρησιμοποιήσει.",
      "set.syncNeeds": "Άνοιξε πρώτα το sync του orOS και ξεκλείδωσέ το με το passphrase σου.",
      "set.syncChats": "Συγχρονισμός συζητήσεων στις άλλες συσκευές μου (κρυπτογραφημένα)",
      "set.syncChatsHint": "Κάθε συζήτηση κρατιέται και ως κρυπτογραφημένο αρχείο στα Αρχεία (internal › Assistant) και το Vault Drive τη μεταφέρει στις άλλες συσκευές σου. Αν το κλείσεις, σταματά· τα αρχεία μένουν μέχρι να τα σβήσεις από τα Αρχεία.",
      "set.syncChatsWait": "Το sync του orOS δεν είναι συνδεδεμένο και ξεκλείδωτο σε αυτή τη συσκευή, οπότε οι συζητήσεις περιμένουν εδώ μέχρι να γίνει.",
      "set.syncChatsKeep": "Άνοιξε πρώτα το «Να κρατιούνται οι συζητήσεις σε αυτή τη συσκευή».",
      "set.wipeQAll": "Να διαγραφούν όλες οι συζητήσεις σε όλες τις συσκευές σου; Δεν αναιρείται.",
      "set.device": "Αυτή η συσκευή", "set.keep": "Να κρατιούνται οι συζητήσεις σε αυτή τη συσκευή",
      "set.wipe": "Διαγραφή όλων των συζητήσεων", "set.wipeQ": "Να διαγραφούν όλες οι συζητήσεις σε αυτή τη συσκευή; Δεν αναιρείται.",
      "set.keepOffQ": "Να μην κρατιούνται πια οι συζητήσεις και να διαγραφούν όσες υπάρχουν σε αυτή τη συσκευή;",
      "set.usage": "Χρήση αυτόν τον μήνα", "set.usageRow": "{name}: {i} εισερχόμενα · {o} εξερχόμενα (tokens)", "set.usageNone": "Τίποτα ακόμη",
      "del.title": "Διαγραφή συζήτησης", "del.q": "Να διαγραφεί η «{title}»;",
      "toast.saved": "Αποθηκεύτηκε", "toast.keyRemoved": "Το κλειδί αφαιρέθηκε", "toast.storage": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος",
      "toast.deleted": "Διαγράφηκε", "toast.lock": "Ξεκλείδωσε το sync του orOS για να χρησιμοποιηθούν τα κλειδιά από τις άλλες συσκευές σου",
      "open.gone": "Αυτό το στοιχείο δεν υπάρχει πια",
      "chat.untitled": "Νέα συζήτηση", "time.today": "Σήμερα", "time.yesterday": "Χθες",
      "you": "Εσύ"
    }
  };

  function t(key, params) {
    var p = STRINGS[LANG] || STRINGS.en;
    var s = p[key] !== undefined ? p[key] : (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
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
  function newId() {
    var a = new Uint8Array(8);
    crypto.getRandomValues(a);
    return "c" + Date.now().toString(36) + Array.prototype.map.call(a, function (b) {
      return (b < 16 ? "0" : "") + b.toString(16);
    }).join("").slice(0, 8);
  }
  function narrow() { return window.innerWidth < 720; }
  function hostOf(url) {
    var m = /^https?:\/\/([^\/?#:]+)/i.exec(String(url || ""));
    return m ? m[1] : String(url || "");
  }
  function fmtNum(n) {
    try { return Number(n || 0).toLocaleString(LANG === "el" ? "el-GR" : "en-GB"); }
    catch (e) { return String(n || 0); }
  }

  var ICON = {
    menu: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
    plus: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    gear: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    send: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    stop: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
    spark: '<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>',
    search: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
    x: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>'
  };

  // ---------- 2. Data + prefs ----------
  var data = C.emptyData();
  var prefs = { open: "", keep: 1, usage: {}, sealOk: {} };

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      data = raw ? C.mergeAssist(JSON.parse(raw), null) : C.emptyData();
    } catch (e) { data = C.emptyData(); }
  }
  function saveData() {
    data = C.mergeAssist(data, null);
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
        if (typeof p.open === "string") prefs.open = p.open.slice(0, 40);
        prefs.keep = p.keep === 0 ? 0 : 1;
        if (p.usage && typeof p.usage === "object") prefs.usage = p.usage;
        if (p.sealOk && typeof p.sealOk === "object") prefs.sealOk = p.sealOk;
      }
    } catch (e) {}
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }
  function addUsage(pid, u) {
    if (!u || (!u.i && !u.o)) return;
    var mk = C.monthKey(Date.now());
    var month = prefs.usage[mk] || (prefs.usage[mk] = {});
    var row = month[pid] || (month[pid] = { i: 0, o: 0 });
    row.i += u.i || 0;
    row.o += u.o || 0;
    Object.keys(prefs.usage).sort().slice(0, -3).forEach(function (k) { delete prefs.usage[k]; });
    savePrefs();
  }

  function provName(pid) { return C.PROVIDERS[pid] ? C.PROVIDERS[pid].name : pid; }
  function curProv() { return data.set.prov; }
  function provConf(pid) { return data.provs[pid] || { m: 0, base: "", model: "" }; }
  function modelOf(pid) { return provConf(pid).model || (C.PROVIDERS[pid] && C.PROVIDERS[pid].model) || ""; }
  function baseOf(pid) { return C.provBase(pid, provConf(pid)); }
  function setProvConf(pid, patch) {
    var cur = provConf(pid);
    var next = { m: Math.max(Date.now(), cur.m + 1), base: cur.base, model: cur.model };
    Object.keys(patch).forEach(function (k) { next[k] = patch[k]; });
    data.provs[pid] = next;
    saveData();
  }
  function setSetting(patch) {
    var cur = data.set;
    var next = { m: Math.max(Date.now(), cur.m + 1), chat: cur.chat, prov: cur.prov };
    Object.keys(patch).forEach(function (k) { next[k] = patch[k]; });
    data.set = next;
    saveData();
  }

  // ---------- 3. Device store (IndexedDB) ----------
  var dbPromise = null;
  function db() {
    if (!dbPromise) {
      dbPromise = new Promise(function (resolve, reject) {
        var req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = function () {
          var d = req.result;
          ["keys", "creds", "chats"].forEach(function (n) {
            if (!d.objectStoreNames.contains(n)) d.createObjectStore(n);
          });
        };
        req.onsuccess = function () {
          var d = req.result;
          d.onversionchange = function () { d.close(); dbPromise = null; };   // factory reset deletes it
          resolve(d);
        };
        req.onerror = function () { reject(req.error); };
        req.onblocked = function () { reject(new Error("blocked")); };
      });
      dbPromise.catch(function () { dbPromise = null; });
    }
    return dbPromise;
  }
  function idb(store, mode, fn) {
    return db().then(function (d) {
      return new Promise(function (resolve, reject) {
        var tx = d.transaction(store, mode);
        var res;
        var r = fn(tx.objectStore(store));
        if (r) r.onsuccess = function () { res = r.result; };
        tx.oncomplete = function () { resolve(res); };
        tx.onerror = function () { reject(tx.error); };
        tx.onabort = function () { reject(tx.error); };
      });
    });
  }
  function idbGet(store, key) { return idb(store, "readonly", function (s) { return s.get(key); }); }
  function idbPut(store, key, val) { return idb(store, "readwrite", function (s) { s.put(val, key); }); }
  function idbDel(store, key) { return idb(store, "readwrite", function (s) { s.delete(key); }); }
  function idbAll(store) { return idb(store, "readonly", function (s) { return s.getAll(); }); }
  function idbClear(store) { return idb(store, "readwrite", function (s) { s.clear(); }); }

  // ---------- 4. API keys ----------
  // A non-extractable AES-GCM key lives in this app's IndexedDB: the
  // raw bytes can never be read, not even by script (same as Mail).
  // Each API key is sealed with it: creds[pid] = { iv, data, m }.
  var keyCache = {};
  function deviceKey() {
    return idbGet("keys", "device").then(function (k) {
      if (k) return k;
      return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"])
        .then(function (nk) { return idbPut("keys", "device", nk).then(function () { return nk; }); });
    });
  }
  function saveKey(pid, key, m) {
    return deviceKey().then(function (dk) {
      var iv = crypto.getRandomValues(new Uint8Array(12));
      return crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, dk, new TextEncoder().encode(key))
        .then(function (sealed) { return idbPut("creds", pid, { iv: iv.buffer, data: sealed, m: m }); })
        .then(function () { keyCache[pid] = { key: key, m: m }; });
    });
  }
  // → { key, m } | null
  function loadKey(pid) {
    if (keyCache[pid] !== undefined) return Promise.resolve(keyCache[pid]);
    return idbGet("creds", pid).then(function (rec) {
      if (!rec) { keyCache[pid] = null; return null; }
      return deviceKey().then(function (dk) {
        return crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(rec.iv) }, dk, rec.data);
      }).then(function (plain) {
        var v = { key: new TextDecoder().decode(plain), m: rec.m || 0 };
        keyCache[pid] = v;
        return v;
      });
    }).catch(function () { return null; });
  }
  function dropKey(pid) {
    keyCache[pid] = null;
    return idbDel("creds", pid).catch(function () {});
  }

  // Key sync (switch in Settings, off by default). While it is on,
  // every key this device holds is also put in the synced slice,
  // sealed with the sync passphrase (orosSync.vaultCrypto), so the
  // sync blob carries it encrypted twice and this device's storage
  // never holds it in clear. The newer key wins (m); a removed key
  // (d = 1) is removed everywhere.
  function syncApi() {
    try { return (window.parent && window.parent.orosSync) || window.orosSync || null; }
    catch (e) { return window.orosSync || null; }
  }
  function sealer() {
    var api = syncApi();
    if (!api || !api.vaultCrypto || typeof api.hasPassphrase !== "function") return null;
    try {
      if (!api.hasPassphrase() || (typeof api.isConnected === "function" && !api.isConnected())) return null;
    } catch (e) { return null; }
    return api.vaultCrypto;
  }
  var keySyncBusy = null;
  function syncKeys() {
    if (keySyncBusy) return keySyncBusy;
    keySyncBusy = runKeySync().then(function (changed) {
      keySyncBusy = null;
      if (changed) { saveData(); }
      renderAll();
    }, function () { keySyncBusy = null; });
    return keySyncBusy;
  }
  function runKeySync() {
    var vc = sealer(), changed = false;
    var ids = C.PROV_IDS.slice();
    function step() {
      if (!ids.length) return Promise.resolve(changed);
      var pid = ids.shift();
      return loadKey(pid).then(function (local) {
        var e = data.keys[pid];
        // A removal applies whether or not this device can unseal.
        if (e && e.d) {
          if (local && e.m >= local.m) return dropKey(pid);
          if (!local || !data.ks.on || !vc) return null;
        }
        if (!data.ks.on || !vc) return null;
        if (e && e.s && (!local || e.m > local.m)) {
          return vc.decryptJson(e.s).then(function (o) {
            if (o && o.p === pid && typeof o.k === "string" && o.k) {
              prefs.sealOk[pid] = e.s.slice(-24);
              savePrefs();
              return saveKey(pid, o.k, e.m);
            }
          }, function () {
            // Sealed with another passphrase (changed elsewhere): a
            // device that still has the key re-seals it below.
            if (local) return reseal(pid, local);
          });
        }
        if (local && (!e || e.m < local.m || (!e.s && !e.d))) return reseal(pid, local);
        if (local && e && e.s && e.m === local.m && prefs.sealOk[pid] !== e.s.slice(-24)) {
          return vc.decryptJson(e.s).then(function () {
            prefs.sealOk[pid] = e.s.slice(-24);
            savePrefs();
          }, function () { return reseal(pid, local); });
        }
        return null;
      }).then(step, step);
      function reseal(p, local) {
        return vc.encryptJson({ p: p, k: local.key }).then(function (s) {
          data.keys[p] = { m: local.m, d: 0, s: s };
          prefs.sealOk[p] = s.slice(-24);
          savePrefs();
          changed = true;
        });
      }
    }
    return step();
  }
  function setKeySync(on) {
    var now = Date.now();
    data.ks = { m: Math.max(now, data.ks.m + 1), on: on ? 1 : 0 };
    if (!on) {
      // The cloud copies go; every device keeps its own key.
      Object.keys(data.keys).forEach(function (pid) {
        if (data.keys[pid].s) data.keys[pid] = { m: Math.max(now, data.keys[pid].m + 1), d: 0, s: "" };
      });
    }
    saveData();
    if (on) syncKeys();
  }
  function storeKey(pid, key) {
    var m = Date.now();
    return saveKey(pid, key, m).then(function () {
      if (data.ks.on) return syncKeys();
    });
  }
  function removeKey(pid) {
    return loadKey(pid).then(function (local) {
      return dropKey(pid).then(function () {
        var e = data.keys[pid];
        if (data.ks.on || (e && e.s)) {
          data.keys[pid] = { m: Math.max(Date.now(), (local && local.m || 0) + 1, (e && e.m || 0) + 1), d: 1, s: "" };
          saveData();
        }
      });
    });
  }

  // ---------- 5. Shell bridges ----------
  function shell() {
    try { return (window.parent && window.parent !== window) ? window.parent : null; } catch (e) { return null; }
  }
  // Searchable apps (from the shell) with this assistant's permission.
  function appList() {
    var p = shell(), list = [];
    try { if (p && typeof p.orosAssistApps === "function") list = p.orosAssistApps() || []; } catch (e) { list = []; }
    return list.filter(function (a) { return a && C.permFor(data, a) !== "off"; })
      .map(function (a) { return { id: String(a.id), name: String(a.name || a.id), sensitive: !!a.sensitive, perm: C.permFor(data, a) }; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
  }
  function readableApps() {
    if (data.set.chat) return [];
    return appList().filter(function (a) { return a.perm === "ask" || a.perm === "always"; });
  }
  function setPerm(appId, v) {
    var cur = data.perm[appId];
    data.perm[appId] = { m: Math.max(Date.now(), (cur ? cur.m : 0) + 1), v: v };
    saveData();
  }
  // Every installed app (id → shown name), for the entry cards.
  function installed() {
    var p = shell(), out = {};
    try {
      if (p && typeof p.orosAssistInstalled === "function") {
        (p.orosAssistInstalled() || []).forEach(function (a) { if (a && a.id) out[String(a.id)] = String(a.name || a.id); });
      }
    } catch (e) {}
    return out;
  }
  function entryKinds() {
    var have = installed();
    return C.entryKinds(function (id) { return !!have[id]; });
  }
  // The shell's prefill bridges an entry card may call (core.js §10).
  var ENTRY_FNS = { __orosOpenCalendarNew: 1, __orosOpenBudgetNew: 1, __orosOpenQuoteNew: 1 };
  function runEntry(e) {
    var p = shell();
    if (!p || !e || !e.call) return false;
    try {
      if (e.call.fn === "openAt") {
        if (typeof p.__orosOpenAt !== "function") return false;
        p.__orosOpenAt(e.call.args[0], JSON.parse(JSON.stringify(e.call.args[1])));
        return true;
      }
      if (!ENTRY_FNS[e.call.fn] || typeof p[e.call.fn] !== "function") return false;
      var r = p[e.call.fn](JSON.parse(JSON.stringify(e.call.args[0])));
      return r !== false;
    } catch (x) { return false; }
  }
  function openRef(chat, ref) {
    var r = chat && chat.refs && chat.refs[ref];
    var p = shell();
    if (!r || !p || typeof p.orosAssistOpen !== "function") { showToast(t("open.gone")); return; }
    try { p.orosAssistOpen(r.app, r.target); } catch (e) { showToast(t("open.gone")); }
  }

  // ---------- 6. Provider calls ----------
  function ready() {
    var pid = curProv();
    if (!pid || !modelOf(pid)) return false;
    if (C.PROVIDERS[pid].local) return !!baseOf(pid);
    return !!(keyCache[pid] && keyCache[pid].key);
  }

  // One streamed request → reducer result. onText(text) as it arrives.
  function callModel(pid, msgs, opts, signal, onText) {
    var p = C.PROVIDERS[pid];
    return loadKey(pid).then(function (k) {
      if (p.key === "yes" && !(k && k.key)) throw new C.ProviderError("nokey");
      var req = C.buildRequest(pid, { key: k ? k.key : "", base: provConf(pid).base, model: modelOf(pid) }, msgs, opts);
      return fetch(req.url, {
        method: "POST", headers: req.headers, body: JSON.stringify(req.body), signal: signal,
        credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer"
      }).catch(function (e) {
        if (signal && signal.aborted) throw e;
        throw new C.ProviderError("net");
      });
    }).then(function (res) {
      if (!res.ok) {
        return res.text().catch(function () { return ""; }).then(function (body) {
          throw C.errorFrom(res.status, body);
        });
      }
      var red = C.makeReducer(pid);
      var sse = C.makeSSE(function (d) {
        var j;
        if (d === "[DONE]") j = d;
        else { try { j = JSON.parse(d); } catch (e) { return; } }
        red.push(j);
        if (onText) onText(red.text());
      });
      if (!res.body || typeof res.body.getReader !== "function") {
        return res.text().then(function (txt) { sse.feed(txt); sse.end(); return red.result(); });
      }
      var reader = res.body.getReader(), dec = new TextDecoder();
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) { sse.feed(dec.decode()); sse.end(); return red.result(); }
          sse.feed(dec.decode(r.value, { stream: true }));
          return pump();
        });
      }
      return pump();
    });
  }

  function errText(e, pid) {
    var name = provName(pid), host = hostOf(baseOf(pid));
    if (!(e instanceof C.ProviderError)) return t("err.stream");
    if (e.code === "nokey") return t("err.noKey", { name: name });
    if (e.code === "net") return t("err.net", { host: host });
    return t("err." + e.code, { name: name, host: host, model: modelOf(pid), msg: e.msg || ("HTTP " + e.status) });
  }

  // ---------- 7. Conversation ----------
  var chats = [];          // newest first
  var chat = null;         // the open one
  var busy = null;         // { abort, live, consent }

  function loadChats() {
    if (!prefs.keep) return Promise.resolve();
    return idbAll("chats").then(function (list) {
      chats = (list || []).filter(function (c) { return c && c.id && Array.isArray(c.msgs); })
        .sort(function (a, b) { return b.m - a.m; });
      chat = null;
      for (var i = 0; i < chats.length; i++) if (chats[i].id === prefs.open) chat = chats[i];
    }).catch(function () { chats = []; });
  }
  function saveChat(c) {
    c.m = Math.max(Date.now(), (c.m || 0) + 1);
    chats.sort(function (a, b) { return b.m - a.m; });
    if (!prefs.keep) return Promise.resolve();
    var put = idbPut("chats", c.id, c).catch(function () { showToast(t("toast.storage")); });
    if (chats.length > MAX_CHATS) {
      chats.slice(MAX_CHATS).forEach(function (old) {
        idbDel("chats", old.id).catch(function () {});
        dropChatFile(old.id);
      });
      chats = chats.slice(0, MAX_CHATS);
    }
    queueChatFile(c.id);
    return put;
  }
  function newChat() {
    if (busy) return;
    chat = null;
    prefs.open = "";
    savePrefs();
    renderAll();
    if (!narrow()) $("input").focus();
  }
  function openChat(id) {
    if (busy) return;
    for (var i = 0; i < chats.length; i++) if (chats[i].id === id) chat = chats[i];
    prefs.open = chat ? chat.id : "";
    savePrefs();
    setSide(false);
    renderAll();
    scrollEnd();
  }
  function deleteChat(c) {
    confirmDialog(t("del.title"), t("del.q", { title: c.title || t("chat.untitled") }), t("btn.delete"), function () {
      chats = chats.filter(function (x) { return x.id !== c.id; });
      idbDel("chats", c.id).catch(function () {});
      dropChatFile(c.id);
      if (chat && chat.id === c.id) { chat = null; prefs.open = ""; savePrefs(); }
      renderAll();
      showToast(t("toast.deleted"));
    });
  }

  function send() {
    var box = $("input");
    var text = box.value.trim();
    if (!text || busy) return;
    if (!ready()) { settingsDialog(); return; }
    if (text.length > MAX_INPUT) text = text.slice(0, MAX_INPUT);
    if (!chat) {
      chat = { id: newId(), m: Date.now(), title: C.chatTitle(text), msgs: [], refs: {}, refN: 0 };
      chats.unshift(chat);
      prefs.open = chat.id;
      savePrefs();
    }
    chat.msgs.push({ r: "user", text: text });
    box.value = "";
    autosize();
    saveChat(chat);
    runTurn(chat);
  }

  function runTurn(c) {
    var pid = curProv();
    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    busy = { abort: ctl, live: "", consent: null, chat: c };
    renderAll();
    scrollEnd();
    var apps = readableApps();
    var kinds = entryKinds();
    var tools = C.toolsFor({ data: apps.length > 0, entries: kinds.length > 0 });
    var system = C.systemPrompt({
      lang: LANG, now: Date.now(), chatOnly: !!data.set.chat,
      tz: (function () { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) { return ""; } })(),
      apps: apps.map(function (a) { return a.name + " (" + a.id + ")"; }),
      entries: kinds
    });
    var round = 0;
    function note(kind, text) { c.msgs.push({ r: "note", kind: kind, text: text }); }
    function next() {
      busy.live = "";
      return callModel(pid, c.msgs, { system: system, tools: tools }, ctl && ctl.signal, function (txt) {
        busy.live = txt;
        scheduleLive();
      }).then(function (res) {
        addUsage(pid, res.usage);
        var m = { r: "asst", prov: pid, model: modelOf(pid), text: res.text, raw: res.raw };
        if (res.tools.length) m.tools = res.tools;
        c.msgs.push(m);
        if (res.refused) note("info", t("note.refused"));
        if (res.cut) note("info", t("note.cut"));
        busy.live = "";
        saveChat(c);
        renderMessages();
        if (!res.tools.length) return null;
        return runTools(c, res.tools, apps).then(function (results) {
          c.msgs.push({ r: "tool", results: results });
          saveChat(c);
          renderMessages();
          if (++round >= C.TOOL_ROUNDS) { note("info", t("note.rounds")); return null; }
          return next();
        });
      });
    }
    next().catch(function (e) {
      if (ctl && ctl.signal.aborted) {
        if (busy && busy.live) c.msgs.push({ r: "asst", prov: pid, model: modelOf(pid), text: busy.live });
        note("info", t("note.stopped"));
      } else {
        note("err", errText(e, pid));
      }
    }).then(function () {
      busy = null;
      saveChat(c);
      renderAll();
      scrollEnd();
    });
  }

  function stop() {
    if (!busy) return;
    if (busy.consent) busy.consent(null);
    if (busy.abort) busy.abort.abort();
  }

  function runTools(c, calls, apps) {
    var out = [];
    var i = 0;
    function step() {
      if (i >= calls.length) return Promise.resolve(out);
      var call = calls[i++];
      return runTool(c, call, apps).then(function (r) {
        r.id = call.id;
        r.name = call.name;
        if (call.nid) r.nid = call.nid;
        out.push(r);
        return step();
      });
    }
    return step();
  }

  function runTool(c, call, apps) {
    if (busy && busy.abort && busy.abort.signal.aborted) {
      return Promise.resolve({ content: "Cancelled by the user.", err: 1 });
    }
    if (call.bad) return Promise.resolve({ content: "Error: the arguments were not valid JSON.", err: 1 });
    if (call.name === "list_apps") {
      return Promise.resolve({
        content: JSON.stringify({ apps: apps.map(function (a) { return { id: a.id, name: a.name }; }) }),
        ui: { k: "apps" }
      });
    }
    if (call.name === "propose_entry") return Promise.resolve(proposeEntry(call.args));
    if (call.name === "read_item") return readItem(c, call.args, apps);
    if (call.name !== "search_data") return Promise.resolve({ content: "Error: unknown tool " + call.name, err: 1 });
    var q = String(call.args && call.args.query || "").replace(/\s+/g, " ").trim().slice(0, 200);
    if (!q) return Promise.resolve({ content: "Error: query is empty.", err: 1 });
    var byId = {};
    apps.forEach(function (a) { byId[a.id] = a; });
    var all = appList(), allById = {};
    all.forEach(function (a) { allById[a.id] = a; });
    var ids = apps.map(function (a) { return a.id; }), blocked = [], unknown = [];
    if (Array.isArray(call.args.apps) && call.args.apps.length) {
      ids = [];
      call.args.apps.slice(0, 50).forEach(function (raw) {
        var id = String(raw).toLowerCase();
        if (byId[id]) ids.push(id);
        else if (allById[id]) blocked.push(allById[id].name);
        else unknown.push(String(raw).slice(0, 40));
      });
    }
    var p = shell();
    var search = (p && typeof p.orosAssistSearch === "function") ? p.orosAssistSearch(q, ids) : Promise.resolve([]);
    return Promise.resolve(search).then(function (groups) {
      var items = C.packHits(groups, function (id) { return byId[id] ? byId[id].name : id; });
      var free = items.filter(function (it) { return byId[it.app] && byId[it.app].perm === "always"; });
      var ask = items.filter(function (it) { return byId[it.app] && byId[it.app].perm === "ask"; });
      var choice = ask.length ? askConsent(q, ask) : Promise.resolve({ chosen: [], always: [] });
      return choice.then(function (ch) {
        if (!ch) ch = { chosen: [], always: [] };
        ch.always.forEach(function (id) { setPerm(id, "always"); });
        var shared = free.concat(ch.chosen);
        shared.forEach(function (it) {
          c.refN = (c.refN || 0) + 1;
          it.ref = "r" + c.refN;
          c.refs[it.ref] = { app: it.app, target: it.target, title: it.title, q: q, id: it.id };
        });
        var held = ask.length - ch.chosen.length;
        var names = [];
        shared.forEach(function (it) { if (names.indexOf(it.appName) < 0) names.push(it.appName); });
        return {
          content: C.searchResult(q, shared, { declined: held, blocked: blocked, unknown: unknown }),
          ui: { k: "search", q: q, n: shared.length, held: held, found: items.length, apps: names }
        };
      });
    }, function () {
      return { content: "Error: the search failed.", err: 1, ui: { k: "err" } };
    });
  }

  // propose_entry: checked now (the model hears at once what was
  // wrong), shown as a card; the button runs the check again and calls
  // the app's bridge. The model is told the user decides.
  function proposeEntry(args) {
    var have = installed();
    var e = C.normEntry(args, { from: t("app"), has: function (id) { return !!have[id]; } });
    if (!e.ok) return { content: "Error: " + e.err, err: 1, ui: { k: "entryErr" } };
    return {
      content: "Shown to the user as a card. They will open it in the app and save it themselves, or dismiss it. It is not saved yet.",
      ui: { k: "entry", args: JSON.parse(JSON.stringify(args)), st: "" }
    };
  }

  // read_item: the full text of an item a search returned (its ref),
  // found again with the same search. "Ask first" apps show one more
  // card with the item and its size.
  var READ_MAX = 12000;
  function readItem(c, args, apps) {
    var ref = String(args && args.ref || "").replace(/^oros:/, "").trim();
    var r = c.refs && /^r\d{1,5}$/.test(ref) ? c.refs[ref] : null;
    if (!r) return Promise.resolve({ content: "Error: unknown ref. Use a ref that search_data returned.", err: 1 });
    var app = null;
    apps.forEach(function (a) { if (a.id === r.app) app = a; });
    if (!app) return Promise.resolve({ content: "Error: the user does not allow this app to be read any more.", err: 1, ui: { k: "readNo", title: r.title } });
    var p = shell();
    var search = (p && typeof p.orosAssistSearch === "function" && r.q) ? p.orosAssistSearch(r.q, [r.app]) : Promise.resolve([]);
    return Promise.resolve(search).then(function (groups) {
      var hit = null;
      (groups || []).forEach(function (g) {
        (g && g.hits || []).forEach(function (h) { if (!hit && h && String(h.id) === String(r.id)) hit = h; });
      });
      if (!hit) return { content: "Error: the item is no longer there.", err: 1, ui: { k: "readGone", title: r.title } };
      var text = String(hit.text || "").replace(/\r\n?/g, "\n");
      var cut = text.length > READ_MAX;
      if (cut) text = text.slice(0, READ_MAX);
      var okP = app.perm === "always" ? Promise.resolve(true) : askRead(r.title, app.name, text);
      return okP.then(function (ok) {
        if (!ok) return { content: JSON.stringify({ ref: ref, note: "The user chose not to share the full text." }), ui: { k: "readNo", title: r.title } };
        var out = { ref: ref, app: app.name, title: hit.title, text: text };
        if (hit.when) out.date = C.ymd(hit.when);
        if (cut) out.note = "The text was cut at " + READ_MAX + " characters.";
        return { content: JSON.stringify(out), ui: { k: "read", title: r.title } };
      });
    }, function () {
      return { content: "Error: the item could not be read.", err: 1, ui: { k: "err" } };
    });
  }
  function askRead(title, appName, text) {
    return new Promise(function (resolve) {
      var done = false;
      function finish(v) {
        if (done) return;
        done = true;
        if (busy) { busy.consent = null; busy.card = null; }
        renderMessages();
        resolve(v);
      }
      var card = el("section", "consent");
      card.setAttribute("role", "group");
      card.appendChild(el("h3", "", t("read.title", { title: title, name: provName(curProv()) })));
      card.appendChild(el("p", "consent-text", t("read.text", { app: appName, n: fmtNum(text.length) })));
      var pre = el("p", "consent-preview", text.length > 600 ? text.slice(0, 600) + "…" : text);
      card.appendChild(pre);
      var acts = el("div", "dlg-actions");
      acts.appendChild(button(t("read.no"), "", function () { finish(false); }));
      var yes = button(t("read.yes"), "primary", function () { finish(true); });
      acts.appendChild(yes);
      card.appendChild(acts);
      if (busy) { busy.consent = function () { finish(false); }; busy.card = card; }
      renderMessages();
      scrollEnd();
      yes.focus();
    });
  }

  // The card that asks before results leave the device.
  // → Promise<{ chosen: [items], always: [appIds] } | null (declined)>
  function askConsent(q, items) {
    return new Promise(function (resolve) {
      var done = false;
      function finish(v) {
        if (done) return;
        done = true;
        if (busy) { busy.consent = null; busy.card = null; }
        renderMessages();
        resolve(v);
      }
      var card = el("section", "consent");
      card.setAttribute("role", "group");
      card.appendChild(el("h3", "", t("share.title", { name: provName(curProv()) })));
      card.appendChild(el("p", "consent-text", t("share.text", { q: q })));
      var boxes = [], groups = {}, order = [];
      items.forEach(function (it) {
        if (!groups[it.app]) { groups[it.app] = []; order.push(it.app); }
        groups[it.app].push(it);
      });
      var names = [];
      order.forEach(function (app) {
        var g = groups[app];
        names.push(g[0].appName);
        card.appendChild(el("h4", "consent-app", g[0].appName));
        var ul = el("ul", "consent-list");
        g.forEach(function (it) {
          var li = el("li");
          var lab = el("label", "consent-item");
          var cb = el("input");
          cb.type = "checkbox";
          cb.checked = true;
          cb.addEventListener("change", count);
          boxes.push({ cb: cb, it: it });
          lab.appendChild(cb);
          var txt = el("span", "consent-body");
          txt.appendChild(el("span", "consent-title", it.title));
          var meta = [it.date, it.text].filter(Boolean).join(" · ");
          if (meta) txt.appendChild(el("span", "consent-meta", meta));
          lab.appendChild(txt);
          li.appendChild(lab);
          ul.appendChild(li);
        });
        card.appendChild(ul);
      });
      var alab = el("label", "consent-always");
      var always = el("input");
      always.type = "checkbox";
      alab.appendChild(always);
      alab.appendChild(el("span", "", t("share.always", { apps: names.join(", ") })));
      card.appendChild(alab);
      var acts = el("div", "dlg-actions");
      var no = button(t("share.no"), "", function () { finish(null); });
      var yes = button("", "primary", function () {
        finish({
          chosen: boxes.filter(function (b) { return b.cb.checked; }).map(function (b) { return b.it; }),
          always: always.checked ? order.slice() : []
        });
      });
      acts.appendChild(no);
      acts.appendChild(yes);
      card.appendChild(acts);
      function count() {
        var n = boxes.filter(function (b) { return b.cb.checked; }).length;
        yes.textContent = t("share.yes", { n: n });
        yes.disabled = n === 0;
      }
      count();
      if (busy) { busy.consent = finish; busy.card = card; }
      renderMessages();
      scrollEnd();
      yes.focus();
    });
  }

  // ---------- 7b. Conversation sync (files through Vault Drive) ----------
  // Switch data.cs.on (synced, so every device follows it). Each chat
  // is written to C.CHAT_DIR/<id>.json on the orOS disk; Vault Drive
  // uploads, downloads and encrypts the files like any other file. A
  // deleted chat leaves a tombstone file, so a missing file is never
  // read as "deleted", only written again. reconcile() folds the
  // folder into this device's chats (core.js mergeChat) and writes
  // back only what differs, so two devices settle without ping-pong.
  var fileQ = {}, fileTimer = 0, reconciling = null, reconcileAgain = false, vaultUnsub = null;
  function fsApi() {
    try {
      var f = window.parent && window.parent !== window ? window.parent.orosFS : null;
      return f && typeof f.writeText === "function" && typeof f.readText === "function" &&
             typeof f.ls === "function" && typeof f.rm === "function" ? f : null;
    } catch (e) { return null; }
  }
  function chatSyncOn() { return !!(data.cs && data.cs.on && prefs.keep && fsApi()); }
  function vaultUsable() {
    try {
      var v = window.parent && window.parent.orosVault;
      return !!(v && typeof v.status === "function" && v.status().usable);
    } catch (e) { return false; }
  }
  function findChat(id) {
    for (var i = 0; i < chats.length; i++) if (chats[i].id === id) return chats[i];
    return null;
  }
  function writeFile(id, text) {
    var fs = fsApi(), path = C.chatPath(id);
    if (!fs || !path || !text) return Promise.resolve();
    return Promise.resolve(fs.writeText(path, text)).catch(function () {});
  }
  function queueChatFile(id) {
    if (!chatSyncOn()) return;
    fileQ[id] = 1;
    clearTimeout(fileTimer);
    fileTimer = setTimeout(flushChatFiles, 1500);
  }
  function flushChatFiles() {
    fileTimer = 0;
    var ids = Object.keys(fileQ);
    fileQ = {};
    if (!chatSyncOn()) return Promise.resolve();
    return ids.reduce(function (p, id) {
      return p.then(function () {
        var c = findChat(id);
        return c ? writeFile(id, C.chatFile(c)) : null;
      });
    }, Promise.resolve());
  }
  function dropChatFile(id) {
    delete fileQ[id];
    if (!chatSyncOn()) return;
    writeFile(id, JSON.stringify({ id: id, m: Date.now(), del: 1 }));
  }
  function setChatSync(on) {
    var cur = data.cs || { m: 0, on: 0 };
    data.cs = { m: Math.max(Date.now(), cur.m + 1), on: on ? 1 : 0 };
    saveData();
    renderChats();
    if (on) reconcile();
  }
  function scheduleReconcile() {
    clearTimeout(scheduleReconcile.t);
    scheduleReconcile.t = setTimeout(reconcile, 400);
  }
  function reconcile() {
    if (!chatSyncOn()) return Promise.resolve();
    if (reconciling) { reconcileAgain = true; return reconciling; }
    var fs = fsApi();
    reconciling = Promise.resolve(fs.ls(C.CHAT_DIR)).catch(function () { return []; }).then(function (list) {
      var files = {};
      var reads = (list || []).filter(function (en) {
        return en && !en.dir && /\.json$/i.test(String(en.name || "")) && String(en.name).length < 120;
      }).map(function (en) {
        var path = C.CHAT_DIR + "/" + en.name;
        return Promise.resolve(fs.readText(path)).then(function (text) {
          var ch = C.parseChatFile(text);
          if (!ch) return;
          var f = files[ch.id] || (files[ch.id] = { exact: null, text: null, others: [] });
          if (en.name === ch.id + ".json") { f.exact = ch; f.text = text; }
          else f.others.push({ path: path, chat: ch });
        }, function () {});
      });
      return Promise.all(reads).then(function () { return files; });
    }).then(function (files) {
      var byId = {}, changed = false, work = [];
      chats.forEach(function (c) { byId[c.id] = c; });
      var ids = Object.keys(byId);
      Object.keys(files).forEach(function (id) { if (!byId[id]) ids.push(id); });
      var copies = [];
      ids.forEach(function (id) {
        if (busy && busy.chat && busy.chat.id === id) return;   // answering in it: next time
        var f = files[id] || { exact: null, text: null, others: [] };
        var remote = f.exact;
        f.others.forEach(function (o) {
          var r = C.mergeChat(remote, o.chat);
          remote = r.chat;
          if (r.copy) copies.push(r.copy);
        });
        var local = byId[id] ? C.normChat(byId[id]) : null;
        var res = C.mergeChat(local, remote);
        if (res.copy) copies.push(res.copy);
        var keep = res.chat;
        if (!keep) return;
        var text = keep.del ? JSON.stringify({ id: keep.id, m: keep.m, del: 1 }) : C.chatFile(keep);
        if (keep.del) {
          if (byId[id]) {
            chats = chats.filter(function (x) { return x.id !== id; });
            if (chat && chat.id === id) { chat = null; prefs.open = ""; savePrefs(); }
            work.push(idbDel("chats", id).catch(function () {}));
            changed = true;
          }
        } else if (!local || C.chatFile(local) !== text) {
          var target = byId[id];
          if (target) {
            Object.keys(keep).forEach(function (k) { target[k] = keep[k]; });
          } else {
            target = keep;
            chats.push(target);
          }
          work.push(idbPut("chats", id, target).catch(function () {}));
          changed = true;
        }
        if (f.text !== text) work.push(writeFile(id, text));
        f.others.forEach(function (o) { work.push(Promise.resolve(fs.rm(o.path)).catch(function () {})); });
      });
      copies.forEach(function (cp) {
        if (findChat(cp.id) || files[cp.id]) return;
        chats.push(cp);
        work.push(idbPut("chats", cp.id, cp).catch(function () {}));
        work.push(writeFile(cp.id, C.chatFile(cp)));
        changed = true;
      });
      chats.sort(function (a, b) { return b.m - a.m; });
      if (chats.length > MAX_CHATS) {
        chats.slice(MAX_CHATS).forEach(function (old) {
          work.push(idbDel("chats", old.id).catch(function () {}));
          dropChatFile(old.id);
        });
        chats = chats.slice(0, MAX_CHATS);
      }
      if (changed) renderAll();
      return Promise.all(work);
    }).catch(function () {}).then(function () {
      reconciling = null;
      if (reconcileAgain) { reconcileAgain = false; return reconcile(); }
    });
    return reconciling;
  }
  function watchVault() {
    try {
      var v = window.parent && window.parent !== window ? window.parent.orosVault : null;
      if (!v || typeof v.onStatus !== "function" || vaultUnsub) return;
      vaultUnsub = v.onStatus(function (kind) { if (kind === "done") scheduleReconcile(); });
      window.addEventListener("pagehide", function () {
        if (vaultUnsub) { vaultUnsub(); vaultUnsub = null; }
        if (fileTimer) { clearTimeout(fileTimer); flushChatFiles(); }
      });
    } catch (e) {}
  }

  // ---------- 8. UI ----------
  var sideOpen = false;
  function setSide(open) {
    sideOpen = !!open && narrow();
    document.body.setAttribute("data-side", sideOpen ? "open" : "closed");
    $("scrim").hidden = !sideOpen;
  }

  function renderAll() {
    renderChats();
    renderBar();
    renderMessages();
    renderComposer();
  }

  function dayLabel(ms) {
    var d = new Date(ms), now = new Date();
    var a = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    var b = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (a === b) return t("time.today");
    if (b - a === 86400000) return t("time.yesterday");
    try { return d.toLocaleDateString(LANG === "el" ? "el-GR" : "en-GB", { day: "numeric", month: "short" }); }
    catch (e) { return C.ymd(ms); }
  }

  function renderChats() {
    var host = $("chats");
    host.textContent = "";
    if (!chats.length) host.appendChild(el("p", "hint pad", t("chats.empty")));
    chats.forEach(function (c) {
      var row = el("div", "chat-row" + (chat && chat.id === c.id ? " on" : ""));
      var b = el("button", "chat-open");
      b.type = "button";
      b.appendChild(el("span", "chat-title", c.title || t("chat.untitled")));
      b.appendChild(el("span", "chat-date", dayLabel(c.m)));
      b.addEventListener("click", function () { openChat(c.id); });
      var del = el("button", "icon-btn small chat-del");
      del.type = "button";
      del.innerHTML = ICON.x;
      del.setAttribute("aria-label", t("btn.delete"));
      del.title = t("btn.delete");
      del.addEventListener("click", function () { deleteChat(c); });
      row.appendChild(b);
      row.appendChild(del);
      host.appendChild(row);
    });
    $("chats-foot").textContent = !prefs.keep ? t("chats.off") : (chatSyncOn() ? t("chats.synced") : t("chats.local"));
  }

  function renderBar() {
    var pid = curProv();
    $("bar-title").textContent = chat ? (chat.title || t("chat.untitled")) : t("app");
    var who = $("who");
    who.textContent = "";
    if (!pid || !ready()) { who.hidden = true; }
    else {
      who.hidden = false;
      who.appendChild(el("span", "who-name", t("who", { name: provName(pid), model: modelOf(pid) })));
      who.appendChild(el("span", "who-to", data.set.chat ? t("who.chatOnly") : t("who.to", { host: hostOf(baseOf(pid)) })));
      if (!data.set.chat) {
        var tip = t("who.to", { host: hostOf(baseOf(pid)) });
        who.title = tip;
      }
    }
    var off = $("net");
    var offline = typeof navigator !== "undefined" && navigator.onLine === false && pid && !C.PROVIDERS[pid].local;
    off.hidden = !offline;
    if (offline) off.textContent = t("off.line", { name: provName(pid) });
    $("new-btn").disabled = !!busy;
  }

  function renderComposer() {
    var ok = ready();
    var box = $("input");
    box.placeholder = ok ? t("ph.input") : t("ph.noSetup");
    var sb = $("send-btn");
    sb.innerHTML = busy ? ICON.stop : ICON.send;
    sb.setAttribute("aria-label", busy ? t("btn.stop") : t("btn.send"));
    sb.title = busy ? t("btn.stop") : t("btn.send");
    sb.classList.toggle("stop", !!busy);
  }

  var liveTimer = 0;
  function scheduleLive() {
    if (liveTimer) return;
    liveTimer = setTimeout(function () {
      liveTimer = 0;
      var n = document.getElementById("live-answer");
      if (!n || !busy) return;
      var nearEnd = isNearEnd();
      n.textContent = "";
      drawMd(n, busy.live, busy.chat);
      if (nearEnd) scrollEnd();
    }, 40);
  }

  function renderMessages() {
    var host = $("msgs");
    var nearEnd = isNearEnd();
    host.textContent = "";
    var pid = curProv();
    // Not set up on this device: the welcome, unless a conversation
    // (e.g. one synced from another device) is open to read.
    if ((!pid || !ready()) && !(chat && chat.msgs.length)) {
      $("welcome").hidden = false;
      $("wel-text").textContent = t("wel.text");
      $("wel-setup").hidden = false;
      host.hidden = true;
      return;
    }
    host.hidden = false;
    if (!chat || !chat.msgs.length) {
      $("welcome").hidden = false;
      $("wel-text").textContent = t("wel.ready");
      $("wel-setup").hidden = true;
      if (!busy) return;
    } else {
      $("welcome").hidden = true;
    }
    (chat ? chat.msgs : []).forEach(function (m) { drawMsg(host, m, chat); });
    if (busy && busy.chat === chat) {
      if (busy.card) host.appendChild(busy.card);
      else {
        var live = el("div", "msg asst");
        var body = el("div", "md");
        body.id = "live-answer";
        if (busy.live) drawMd(body, busy.live, chat);
        else body.appendChild(el("span", "dots", "…"));
        live.appendChild(body);
        host.appendChild(live);
      }
    }
    if (nearEnd) scrollEnd();
  }

  function drawMsg(host, m, c) {
    if (m.r === "user") {
      var u = el("div", "msg user");
      u.appendChild(el("div", "bubble", m.text));
      host.appendChild(u);
    } else if (m.r === "asst") {
      if (!m.text) return;
      var a = el("div", "msg asst");
      var body = el("div", "md");
      drawMd(body, m.text, c);
      a.appendChild(body);
      host.appendChild(a);
    } else if (m.r === "tool") {
      (m.results || []).forEach(function (r) {
        var ui = r.ui || {};
        if (ui.k === "entry") { drawEntry(host, r, c); return; }
        if (ui.k === "entryErr") return;
        var line = el("div", "tool-line");
        var ico = el("span", "tool-ico");
        ico.innerHTML = ICON.search;
        line.appendChild(ico);
        var txt;
        if (ui.k === "search") {
          var parts = [t("tool.search", { q: ui.q })];
          if (!ui.found) parts.push(t("tool.none"));
          else if (ui.n) parts.push(t("tool.shared", { n: ui.n, apps: (ui.apps || []).join(", ") }));
          else parts.push(t("tool.noneShared"));
          if (ui.held && ui.n) parts.push(t("tool.held", { n: ui.held }));
          txt = parts[0] + ": " + parts.slice(1).join(", ");
        } else if (ui.k === "apps") txt = t("tool.apps");
        else if (ui.k === "read") txt = t("tool.read", { title: ui.title || "" });
        else if (ui.k === "readNo") txt = t("tool.readNo", { title: ui.title || "" });
        else if (ui.k === "readGone") txt = t("tool.readGone", { title: ui.title || "" });
        else txt = t("tool.err");
        line.appendChild(el("span", "", txt));
        host.appendChild(line);
      });
    } else if (m.r === "note") {
      host.appendChild(el("div", "note" + (m.kind === "err" ? " err" : ""), m.text));
    }
  }

  // An entry card (propose_entry). What it shows and what its button
  // sends are rebuilt from the stored arguments with the same check
  // every time (a stored or synced chat is never trusted as it is).
  function drawEntry(host, r, c) {
    var ui = r.ui, have = installed();
    var e = C.normEntry(ui.args, { from: t("app"), has: function (id) { return !!have[id]; } });
    if (!e.ok) {
      var app0 = ui.args && C.ENTRY_KINDS[ui.args.kind];
      host.appendChild(el("div", "tool-line", t("entry.gone", { app: app0 || "?" })));
      return;
    }
    var name = have[e.app] || e.app, v = e.view;
    var card = el("section", "entry-card");
    card.appendChild(el("h3", "entry-head", t("entry." + e.kind, { app: name })));
    if (v.title) card.appendChild(el("p", "entry-title", v.title));
    if (v.fields.length) {
      var dl = el("dl", "entry-fields");
      v.fields.forEach(function (f) {
        dl.appendChild(el("dt", "", t("f." + f[0])));
        dl.appendChild(el("dd", "", f[0] === "category" ? t("cat." + f[1]) : f[1]));
      });
      card.appendChild(dl);
    }
    if (v.list) {
      var ul = el("ul", "entry-list");
      v.list.forEach(function (x) { ul.appendChild(el("li", "", x)); });
      card.appendChild(ul);
    }
    if (v.table) {
      var wrap = el("div", "entry-table");
      var tb = el("table");
      v.table.forEach(function (row) {
        var tr = el("tr");
        row.forEach(function (cell) { tr.appendChild(el("td", "", cell)); });
        tb.appendChild(tr);
      });
      wrap.appendChild(tb);
      card.appendChild(wrap);
    }
    if (v.more) card.appendChild(el("p", "entry-more", t("entry.more", { n: v.more })));
    if (v.text) card.appendChild(el("p", "entry-text", v.text));
    if (ui.st) {
      card.appendChild(el("p", "entry-state" + (ui.st === "failed" ? " err" : ""),
        t("entry." + ui.st, { app: name })));
    } else {
      var hint = e.kind === "slides" ? "entry.hint.slides" :
                 (e.kind === "note" || e.kind === "sheet") ? "entry.hint.make" : "entry.hint.form";
      card.appendChild(el("p", "dlg-hint", t(hint, { app: name })));
      var acts = el("div", "dlg-actions");
      acts.appendChild(button(t("entry.dismiss"), "", function () {
        ui.st = "dismissed";
        saveChat(c);
        renderMessages();
      }));
      acts.appendChild(button(t("entry.open", { app: name }), "primary", function () {
        // Saved before the app opens (it takes this frame's place).
        ui.st = "opened";
        saveChat(c).then(function () {
          if (!runEntry(e)) { ui.st = "failed"; saveChat(c); }
          renderMessages();
        });
      }));
      card.appendChild(acts);
    }
    host.appendChild(card);
  }

  // Markdown tokens (core.js) → DOM, textContent only.
  function drawInline(parent, inl, c) {
    inl.forEach(function (tok) {
      if (tok.t === "text") parent.appendChild(document.createTextNode(tok.s));
      else if (tok.t === "b") parent.appendChild(el("strong", "", tok.s));
      else if (tok.t === "i") parent.appendChild(el("em", "", tok.s));
      else if (tok.t === "code") parent.appendChild(el("code", "", tok.s));
      else if (tok.t === "link" && tok.kind === "oros") {
        var ref = tok.href.slice(5);
        if (c && c.refs && c.refs[ref]) {
          var b = el("button", "ref-link", tok.s);
          b.type = "button";
          b.title = c.refs[ref].title;
          b.addEventListener("click", function () { openRef(c, ref); });
          parent.appendChild(b);
        } else parent.appendChild(document.createTextNode(tok.s));
      } else if (tok.t === "link" && tok.kind === "web") {
        var a = el("a", "web-link", tok.s);
        a.href = tok.href;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.referrerPolicy = "no-referrer";
        a.title = tok.href;
        parent.appendChild(a);
      }
    });
  }
  function drawMd(host, text, c) {
    C.parseMd(text).forEach(function (b) {
      if (b.t === "p") { var p = el("p"); drawInline(p, b.inl, c); host.appendChild(p); }
      else if (b.t === "h") { var h = el("p", "md-h"); drawInline(h, b.inl, c); host.appendChild(h); }
      else if (b.t === "quote") { var q = el("blockquote"); drawInline(q, b.inl, c); host.appendChild(q); }
      else if (b.t === "code") { var pre = el("pre"); pre.appendChild(el("code", "", b.text)); host.appendChild(pre); }
      else if (b.t === "ul" || b.t === "ol") {
        var l = el(b.t);
        b.items.forEach(function (inl) { var li = el("li"); drawInline(li, inl, c); l.appendChild(li); });
        host.appendChild(l);
      }
    });
  }

  function isNearEnd() {
    var s = $("scroll");
    return !s || s.scrollHeight - s.scrollTop - s.clientHeight < 80;
  }
  function scrollEnd() {
    var s = $("scroll");
    if (s) s.scrollTop = s.scrollHeight;
  }
  function autosize() {
    var box = $("input");
    box.style.height = "auto";
    box.style.height = Math.min(box.scrollHeight, 180) + "px";
  }

  // ---------- 9. Settings dialog ----------
  function settingsDialog() {
    if (document.querySelector("dialog[open]")) return;
    var dlg = makeDialog("as-set");
    dlg.classList.add("wide");
    dlg.appendChild(el("div", "dlg-title", t("set.title")));
    var body = el("div", "set-body");
    dlg.appendChild(body);

    // Assistant + its key / address / model
    var secA = section(body, t("set.provider"));
    var sel = el("select", "dlg-input");
    sel.id = "as-prov";
    sel.setAttribute("aria-label", t("set.provider"));
    var o0 = el("option", "", t("set.choose"));
    o0.value = "";
    sel.appendChild(o0);
    C.PROV_IDS.forEach(function (pid) {
      var o = el("option", "", C.PROVIDERS[pid].name);
      o.value = pid;
      sel.appendChild(o);
    });
    sel.value = curProv();
    secA.appendChild(sel);
    var provBox = el("div", "prov-box");
    secA.appendChild(provBox);
    sel.addEventListener("change", function () {
      setSetting({ prov: sel.value });
      drawProv();
      renderAll();
    });

    function drawProv() {
      provBox.textContent = "";
      var pid = sel.value;
      if (!pid) return;
      var P = C.PROVIDERS[pid];
      if (P.local) {
        var bl = label(provBox, "as-base", t("set.base"));
        var base = el("input", "dlg-input");
        base.id = "as-base";
        base.type = "url";
        base.maxLength = 300;
        base.autocapitalize = "off";
        base.spellcheck = false;
        base.placeholder = P.defaultBase;
        base.value = provConf(pid).base;
        base.addEventListener("change", function () {
          var v = C.normBase(base.value);
          if (base.value.trim() && !v) { base.setCustomValidity("x"); base.reportValidity(); return; }
          base.setCustomValidity("");
          setProvConf(pid, { base: v });
          renderAll();
        });
        bl.after(base);
        provBox.appendChild(el("p", "dlg-hint", t("set.baseHint")));
      }
      // Key
      label(provBox, "as-key", P.key === "opt" ? t("set.keyOpt") : t("set.key"));
      var status = el("p", "key-status");
      provBox.appendChild(status);
      var row = el("div", "row");
      var key = el("input", "dlg-input");
      key.id = "as-key";
      key.type = "password";
      key.maxLength = 500;
      key.autocomplete = "off";
      key.spellcheck = false;
      row.appendChild(key);
      var save = button(t("set.keySave"), "small", function () {
        var v = key.value.trim();
        if (!v) { key.focus(); return; }
        save.disabled = true;
        storeKey(pid, v).then(function () {
          key.value = "";
          showToast(t("toast.saved"));
          drawKey();
          renderAll();
          loadModels();
        }, function () { showToast(t("toast.storage")); }).then(function () { save.disabled = false; });
      });
      row.appendChild(save);
      provBox.appendChild(row);
      var keyActs = el("div", "row links");
      var rm = button(t("set.keyRemove"), "small danger", function () {
        removeKey(pid).then(function () { showToast(t("toast.keyRemoved")); drawKey(); renderAll(); });
      });
      keyActs.appendChild(rm);
      if (P.keyUrl) {
        var get = el("a", "dlg-link", t("set.keyGet"));
        get.href = P.keyUrl;
        get.target = "_blank";
        get.rel = "noopener noreferrer";
        keyActs.appendChild(get);
      }
      provBox.appendChild(keyActs);
      if (!P.local) provBox.appendChild(el("p", "dlg-hint", t("set.keyHint", { host: hostOf(P.base), name: P.name })));
      function drawKey() {
        loadKey(pid).then(function (k) {
          var has = !!(k && k.key);
          status.textContent = has ? t("set.keySaved", { tail: k.key.slice(-4) }) : t("set.keyNone");
          status.classList.toggle("ok", has);
          rm.hidden = !has;
          renderAll();
        });
      }
      drawKey();
      // Model
      label(provBox, "as-model", t("set.model"));
      var mrow = el("div", "row");
      var model = el("input", "dlg-input");
      model.id = "as-model";
      model.maxLength = 200;
      model.autocapitalize = "off";
      model.spellcheck = false;
      model.setAttribute("list", "as-models");
      model.value = modelOf(pid);
      var dl = el("datalist");
      dl.id = "as-models";
      model.addEventListener("change", function () {
        setProvConf(pid, { model: model.value.trim().slice(0, 200) });
        renderAll();
      });
      mrow.appendChild(model);
      var lm = button(t("set.models"), "small", loadModels);
      mrow.appendChild(lm);
      provBox.appendChild(mrow);
      provBox.appendChild(dl);
      var mstat = el("p", "dlg-hint");
      mstat.setAttribute("role", "status");
      provBox.appendChild(mstat);
      function loadModels() {
        lm.disabled = true;
        mstat.classList.remove("err");
        mstat.textContent = t("set.modelsBusy");
        loadKey(pid).then(function (k) {
          if (P.key === "yes" && !(k && k.key)) throw new C.ProviderError("nokey");
          var req = C.modelsRequest(pid, { key: k ? k.key : "", base: provConf(pid).base });
          return fetch(req.url, { headers: req.headers, credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" })
            .catch(function () { throw new C.ProviderError("net"); });
        }).then(function (res) {
          return res.text().then(function (txt) {
            if (!res.ok) throw C.errorFrom(res.status, txt);
            var j;
            try { j = JSON.parse(txt); } catch (e) { throw new C.ProviderError("server", "bad JSON", res.status); }
            return C.parseModels(pid, j);
          });
        }).then(function (list) {
          dl.textContent = "";
          list.forEach(function (m) {
            var o = el("option");
            o.value = m.id;
            if (m.name !== m.id) o.label = m.name;
            dl.appendChild(o);
          });
          mstat.textContent = list.length ? t("set.modelsOk", { n: list.length }) : t("set.modelsNone");
          if (!model.value && list.length) {
            var pick = P.model && list.some(function (m) { return m.id === P.model; }) ? P.model : "";
            if (pick) { model.value = pick; setProvConf(pid, { model: pick }); renderAll(); }
          }
        }, function (e) {
          mstat.textContent = errText(e, pid);
          mstat.classList.add("err");
        }).then(function () { lm.disabled = false; });
      }
    }
    drawProv();

    // Data access
    var secD = section(body, t("set.data"));
    var co = checkbox(secD, "as-chat", t("set.chatOnly"), !!data.set.chat, function (on) {
      setSetting({ chat: on ? 1 : 0 });
      list.hidden = !!on;
      renderAll();
    });
    co.parentNode.classList.add("check");
    var list = el("div", "perm-list");
    list.hidden = !!data.set.chat;
    list.appendChild(el("p", "dlg-hint", t("set.dataHint")));
    var apps = appList();
    if (!apps.length) list.appendChild(el("p", "dlg-hint", t("set.noApps")));
    apps.forEach(function (a) {
      var r = el("div", "perm-row");
      var id = "as-perm-" + a.id;
      var l = el("label", "perm-name", a.name);
      l.htmlFor = id;
      var s = el("select", "dlg-input small");
      s.id = id;
      ["ask", "always", "never"].forEach(function (v) {
        var o = el("option", "", t("perm." + v));
        o.value = v;
        s.appendChild(o);
      });
      s.value = a.perm;
      s.addEventListener("change", function () { setPerm(a.id, s.value); });
      r.appendChild(l);
      r.appendChild(s);
      list.appendChild(r);
    });
    secD.appendChild(list);

    // Key sync
    var secS = section(body, t("set.sync"));
    var can = !!sealer();
    var ks = checkbox(secS, "as-ks", t("set.syncKeys"), !!data.ks.on, function (on) { setKeySync(on); });
    ks.parentNode.classList.add("check");
    ks.disabled = !can && !data.ks.on;
    secS.appendChild(el("p", "dlg-hint", can || data.ks.on ? t("set.syncHint") : t("set.syncNeeds")));
    var csHint = el("p", "dlg-hint");
    var cs = checkbox(secS, "as-cs", t("set.syncChats"), !!data.cs.on, function (on) {
      setChatSync(on);
      drawCsHint();
    });
    cs.parentNode.classList.add("check");
    cs.disabled = !fsApi() || (!prefs.keep && !data.cs.on);
    secS.appendChild(csHint);
    function drawCsHint() {
      var txt = !prefs.keep ? t("set.syncChatsKeep") : t("set.syncChatsHint");
      if (prefs.keep && data.cs.on && !vaultUsable()) txt += " " + t("set.syncChatsWait");
      csHint.textContent = txt;
    }
    drawCsHint();

    // This device
    var secV = section(body, t("set.device"));
    var keep = checkbox(secV, "as-keep", t("set.keep"), !!prefs.keep, function (on) {
      if (on) {
        prefs.keep = 1;
        savePrefs();
        chats.forEach(function (c) { idbPut("chats", c.id, c).catch(function () {}); });
        renderChats();
        cs.disabled = !fsApi();
        drawCsHint();
        reconcile();
        return;
      }
      keep.checked = true;
      confirmDialog(t("set.keep"), t("set.keepOffQ"), t("btn.delete"), function () {
        keep.checked = false;
        prefs.keep = 0;
        savePrefs();
        idbClear("chats").catch(function () {});
        renderChats();
        cs.disabled = !data.cs.on;
        drawCsHint();
      });
    });
    keep.parentNode.classList.add("check");
    var wrow = el("div", "row");
    wrow.appendChild(button(t("set.wipe"), "small danger", function () {
      confirmDialog(t("set.wipe"), chatSyncOn() ? t("set.wipeQAll") : t("set.wipeQ"), t("btn.delete"), function () {
        if (busy) stop();
        chats.forEach(function (c) { dropChatFile(c.id); });
        chats = [];
        chat = null;
        prefs.open = "";
        savePrefs();
        idbClear("chats").catch(function () {});
        renderAll();
        showToast(t("toast.deleted"));
      });
    }));
    secV.appendChild(wrow);
    secV.appendChild(el("h4", "set-sub", t("set.usage")));
    var month = prefs.usage[C.monthKey(Date.now())] || {};
    var rows = Object.keys(month);
    if (!rows.length) secV.appendChild(el("p", "dlg-hint", t("set.usageNone")));
    rows.forEach(function (pid) {
      secV.appendChild(el("p", "dlg-hint", t("set.usageRow", { name: provName(pid), i: fmtNum(month[pid].i), o: fmtNum(month[pid].o) })));
    });

    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("btn.close"), "primary", function () { dlg.close(); }));
    dlg.appendChild(acts);
    dlg.addEventListener("close", function () { renderAll(); });
    document.body.appendChild(dlg);
    dlg.showModal();
    sel.focus();
  }

  function section(host, title) {
    var s = el("section", "set-sec");
    s.appendChild(el("h3", "set-head", title));
    host.appendChild(s);
    return s;
  }
  function label(host, forId, text) {
    var l = el("label", "dlg-lbl", text);
    l.htmlFor = forId;
    host.appendChild(l);
    return l;
  }
  function checkbox(host, id, text, checked, onChange) {
    var l = el("label", "dlg-check");
    var cb = el("input");
    cb.type = "checkbox";
    cb.id = id;
    cb.checked = checked;
    cb.addEventListener("change", function () { onChange(cb.checked); });
    l.appendChild(cb);
    l.appendChild(el("span", "", text));
    host.appendChild(l);
    return cb;
  }

  // ---------- 10. Dialogs + toasts ----------
  function button(text, cls, onClick) {
    var b = el("button", "dlg-btn" + (cls ? " " + cls : ""), text);
    b.type = "button";
    if (onClick) b.addEventListener("click", onClick);
    return b;
  }
  function makeDialog(id) {
    var old = document.getElementById(id);
    if (old) old.remove();
    var dlg = el("dialog", "as-dlg");
    dlg.id = id;
    dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener("close", function () {
      parkToast();
      setTimeout(function () { dlg.remove(); }, 0);
    });
    return dlg;
  }
  function confirmDialog(title, text, okText, onOk) {
    var dlg = makeDialog("as-confirm");
    dlg.appendChild(el("div", "dlg-title", title));
    dlg.appendChild(el("p", "dlg-text", text));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("btn.cancel"), "", function () { dlg.close(); }));
    acts.appendChild(button(okText, "danger", function () { dlg.close(); onOk(); }));
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  function showToast(text) {
    try {
      var n = (window.parent && window.parent !== window && window.parent.orosNotifs) || null;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "assistant", title: String(text) })) return;
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

  // ---------- 11. Keyboard ----------
  function wireKeyboard() {
    // Contract Β: forward Ctrl+Alt+Shift shortcuts to the shell (capture)
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
      var p = null;
      try { p = window.parent; } catch (err) { return; }
      if (!(p && p !== window && p.orosShortcuts &&
            typeof p.orosShortcuts.handle === "function")) return;
      if (p.orosShortcuts.handle(e)) e.stopPropagation();
    }, true);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && busy && !document.querySelector("dialog[open]")) { e.preventDefault(); stop(); return; }
      if (e.key === "Escape" && sideOpen) { e.preventDefault(); setSide(false); }
    });
  }

  // ---------- 12. Sync slice + palette ----------
  var PAL_VARS = ["--bg", "--bg-desktop", "--bar-bg", "--text", "--text-dim",
                  "--accent", "--accent-hover", "--accent-soft",
                  "--panel-bg", "--border", "--shadow", "--danger"];

  function inheritPalette() {
    try {
      var pRoot = window.parent.document.documentElement;
      document.documentElement.setAttribute("data-theme",
        pRoot.getAttribute("data-theme") || "dark");
      var cs = window.parent.getComputedStyle(pRoot);
      PAL_VARS.forEach(function (v) {
        var val = cs.getPropertyValue(v).trim();
        if (val) document.documentElement.style.setProperty(v, val);
      });
    } catch (e) { /* standalone */ }
  }

  function watchPalette() {
    try {
      new MutationObserver(inheritPalette).observe(
        window.parent.document.documentElement,
        { attributes: true, attributeFilter: ["data-skin", "data-theme"] }
      );
    } catch (e) { /* standalone */ }
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
    api.registerSlice("assistant", sliceGet, sliceSet, STORAGE_KEY, C.mergeAssist);
  }

  function sliceGet() { return C.mergeAssist(data, null); }   // canonical copy (R26)

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object") return;
    var before = JSON.stringify(data);
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = C.mergeAssist(incoming, null);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    if (JSON.stringify(data) === before) return;
    syncKeys();
    renderChats();
    if (chatSyncOn()) scheduleReconcile();
  }

  // ---------- 13. Wiring & boot ----------
  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
    document.documentElement.lang = LANG;
    document.title = t("app") + " · orOS";
    [["nav-btn", "menu", "btn.chats"], ["new-btn", "plus", "btn.new"], ["settings-btn", "gear", "btn.settings"]]
      .forEach(function (x) {
        var b = $(x[0]);
        b.innerHTML = ICON[x[1]];
        b.setAttribute("aria-label", t(x[2]));
        b.title = t(x[2]);
      });
    $("side-new").textContent = t("btn.new");
    $("side").setAttribute("aria-label", t("btn.chats"));
    $("wel-icon").innerHTML = ICON.spark;
    $("input").setAttribute("aria-label", t("ph.input"));
  }

  function wire() {
    $("nav-btn").addEventListener("click", function () { setSide(!sideOpen); });
    $("scrim").addEventListener("click", function () { setSide(false); });
    $("new-btn").addEventListener("click", newChat);
    $("side-new").addEventListener("click", function () { setSide(false); newChat(); });
    $("settings-btn").addEventListener("click", settingsDialog);
    $("wel-setup").addEventListener("click", settingsDialog);
    $("send-btn").addEventListener("click", function () { if (busy) stop(); else send(); });
    var box = $("input");
    box.addEventListener("input", autosize);
    box.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        if (!busy) send();
      }
    });
    window.addEventListener("online", renderBar);
    window.addEventListener("offline", renderBar);
    window.addEventListener("resize", function () { if (!narrow() && sideOpen) setSide(false); });
    wireKeyboard();
  }

  // Deep link (shell __orosOpenAt / __orosTakeTarget): { ask: "text" }
  // puts the text in the message box, ready to send. Nothing is sent
  // by itself. A dialog open or an answer running → ignored.
  function openTarget(tg) {
    if (!tg || typeof tg.ask !== "string" || busy || document.querySelector("dialog[open]")) return false;
    var text = tg.ask.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").slice(0, 2000);
    if (!text.trim()) return false;
    newChat();
    var box = $("input");
    box.value = text;
    autosize();
    box.focus();
    return true;
  }
  window.__orosOpenAt = openTarget;

  function boot() {
    load();
    loadPrefs();
    applyI18n();
    wire();
    registerSync();
    inheritPalette();
    watchPalette();
    setSide(false);
    renderAll();
    var pending = null;
    try {
      var p = shell();
      if (p && typeof p.__orosTakeTarget === "function") pending = p.__orosTakeTarget("assistant");
    } catch (e) {}
    Promise.all([loadChats(), loadKey(curProv() || "anthropic")]).then(function () {
      renderAll();
      scrollEnd();
      if (pending) openTarget(pending);
      watchVault();
      document.addEventListener("visibilitychange", function () {
        if (document.visibilityState === "visible") scheduleReconcile();
      });
      return Promise.all([syncKeys(), reconcile()]);
    });
  }

  boot();
})();
