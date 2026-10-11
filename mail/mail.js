// ============================================================
// orOS Mail — App logic (v1.1.0, phase 2: compose + send)
// An IMAP mail reader. The browser cannot speak IMAP, so every
// server call goes through the orOS mail relay (relay/, a small
// stateless Cloudflare Worker): HTTPS in, IMAP out, nothing kept.
//   - accounts with presets by domain (any IMAP server; Gmail /
//     iCloud / Yahoo need an app password)
//   - folders with unread counts, message list (newest first,
//     "older" paging), reading pane
//   - HTML mail: sanitized (sanitize.js) AND shown in a sandboxed
//     iframe without scripts or origin; remote images off until
//     asked ("always for this sender" syncs)
//   - offline: what was opened or listed stays readable
//   - attachments download (orosDialog, R33); invitations (.ics)
//     go to Calendar, their place to Maps
//   - compose / reply / reply all / forward in plain text (compose.js
//     builds the message, the relay hands it to the SMTP server and
//     files a copy in Sent); per-account signature; written offline →
//     device-local Outbox, sent when back online
//   - organise: star, read / unread, archive, spam / not spam, move,
//     delete (to Trash with Undo; erase in Trash / Spam), selection
//     of many messages, swipe on touch (right archive, left delete)
//   - deep link: __orosOpenAt("mail", { compose:{ to?, subject, body } })
//     opens a prefilled draft (never sends by itself)
// Data:
//   - synced slice "mail" (oros-mail-data): accounts WITHOUT
//     passwords, relay address, senders with images allowed;
//     LWW + tombstones (R5, R17, R26)
//   - device-local (R10): oros-mail-prefs (open account / folder,
//     plain-text mode); IndexedDB "oros-mail": non-extractable
//     device key, sealed passwords, folder lists, message headers
//     and bodies (cache), outbox. Never synced, never exported.
// Sections:
//   1. Constants, i18n, helpers
//   2. Data model: accounts, merge
//   3. Device store (IndexedDB)
//   4. Passwords (sealed with the device key)
//   5. Relay client
//   6. Folders + message cache
//   7. UI: toolbar, side, list
//   8. UI: reader
//   9. Account dialog + settings
//  9b. Compose, send, outbox
//  9c. Organise: flags, move, archive, spam, delete
//  10. Dialogs + toasts
//  11. Keyboard
//  12. Sync slice + palette
//  13. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var STORAGE_KEY   = "oros-mail-data";
  var PREFS_KEY     = "oros-mail-prefs";
  var DB_NAME       = "oros-mail";
  var DATA_VER      = 1;
  // The orOS relay (Christos's Worker, relay/). Settings can override
  // it per user (synced); an empty override falls back to this.
  var DEFAULT_RELAY = "https://oros-mail-relay.koulaxizis-25b.workers.dev";
  var PAGE          = 50;
  var KEEP_HEADS    = 500;              // per folder
  var KEEP_BODIES   = 200;              // messages
  var BODY_BUDGET   = 60 * 1024 * 1024; // bytes of cached sources
  var REFRESH_MS    = 2 * 60 * 1000;
  var BACKOFF_MAX   = 30 * 60 * 1000;
  var CALL_TIMEOUT  = 45000;
  var MAX_ACCTS     = 10;
  var MAX_TOMBS     = 200;
  var MAX_IMGOK     = 500;
  var MAX_RCPT      = 50;               // relay limit (SMTP_LIMITS.rcpts)
  var MSG_MAX       = 360 * 1024;       // built message bytes (relay takes 380 KB)
  var OUT_MAX       = 50;               // outbox entries
  var MAX_SIG       = 1000;
  var M = window.orosMailMime;
  var TR = window.orosMailTrust;
  var R = window.orosMailRules;
  var RT = window.orosMailRich;
  var TH = window.orosMailThreads;
  var MAX_SIG_HTML = 60000;           // stored signature HTML (pictures as data:)

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
      "app": "Mail", "nav.folders": "Folders", "nav.back": "Back", "btn.refresh": "Check for new mail",
      "btn.settings": "Settings", "acct.add": "Add account",
      "wel.title": "Your e-mail, inside orOS", "wel.text": "Add an account to read your mail here, also offline.",
      "f.inbox": "Inbox", "f.sent": "Sent", "f.drafts": "Drafts", "f.trash": "Trash", "f.junk": "Spam",
      "f.archive": "Archive", "f.all": "All mail", "f.flagged": "Starred",
      "list.empty": "No messages here.", "list.loading": "Loading…", "list.older": "Load older messages",
      "list.end": "That's all.", "list.count": "{n} unread", "list.never": "Not checked yet.",
      "read.none": "Choose a message to read it.", "read.loading": "Opening the message…",
      "read.offline": "This message is not saved on this device yet. Connect to the internet to open it.",
      "read.failed": "The message could not be opened.", "read.retry": "Try again",
      "read.to": "To: {list}", "read.cc": "Cc: {list}", "read.me": "me", "read.nosubj": "(no subject)",
      "read.nosender": "(unknown sender)",
      "img.blocked": "Pictures from the internet are hidden, so the sender cannot tell you opened this.",
      "srch.btn": "Search", "srch.ph": "Search this folder", "srch.close": "Close search",
      "srch.all": "Everywhere", "srch.from": "Sender", "srch.subject": "Subject",
      "srch.local": "Loaded messages: {n}", "srch.server": "Search the whole folder on the server",
      "srch.busy": "Searching on the server…", "srch.found": "Found on the server: {n}", "srch.more": "Showing the newest {shown} of {n}.",
      "srch.none": "Nothing found.", "srch.offline": "Offline: only the messages on this device were searched.",
      "rule.title": "Rules", "rule.hint": "Rules sort new Inbox mail while orOS is open on any of your devices, also with Mail closed.",
      "fold.title": "Folders", "fold.new": "New folder", "fold.create": "Create", "fold.rename": "Rename", "fold.delete": "Delete folder",
      "fold.name": "Name", "fold.in": "Inside", "fold.top": "Top level", "fold.count": "{n} messages",
      "fold.deleteQ": "Delete the folder \u201c{name}\u201d?", "fold.deleteQn": "Delete the folder \u201c{name}\u201d and the {n} messages in it for good?",
      "fold.kids": "\u201c{name}\u201d has subfolders. Delete or move them first.",
      "fold.errEmpty": "Type a name.", "fold.errLong": "The name is too long (up to 100 characters).",
      "fold.errChars": "The name cannot be Inbox or contain {d} * % \" \\ or line breaks.", "fold.exists": "There is already a folder with this name.",
      "fold.created": "Folder created: {name}", "fold.renamed": "Folder renamed: {name}", "fold.deleted": "Folder deleted: {name}",
      "rule.add": "Add rule", "rule.new": "New rule", "rule.edit": "Edit rule", "rule.none": "No rules yet.",
      "rule.acct": "Account", "rule.if": "If", "rule.has": "contains", "rule.hasHint": "Several words separated by commas: any of them.",
      "rule.then": "Then", "rule.folder": "Folder", "rule.run": "Also run it on the Inbox now", "rule.on": "On",
      "rule.del": "Delete rule", "rule.saved": "Rule saved", "rule.deleted": "Rule deleted", "rule.ran": "Rule applied: {n}",
      "rule.make": "Create a rule…", "rule.needHas": "Write what to look for.", "rule.needFolder": "Choose a folder.",
      "rf.from": "the sender", "rf.to": "a recipient", "rf.subject": "the subject", "rf.any": "sender, recipients or subject",
      "ra.spam": "move to Spam", "ra.trash": "move to Trash", "ra.archive": "move to Archive", "ra.move": "move to folder…",
      "ra.read": "mark as read", "ra.star": "star it",
      "rule.sum": "If {field} contains “{has}”: {act}", "rule.sumTo": "If {field} contains “{has}”: move to {folder}",
      "trust.ok": "Verified sender", "trust.okTip": "The receiving server checked that this message really comes from {dom} (SPF, DKIM, DMARC).",
      "trust.warn": "Careful: this message may not come from {dom}.",
      "trust.dmarc": "{dom} says messages like this one are fake (DMARC failed).", "trust.dkim": "Its signature does not match (DKIM failed).",
      "trust.spf": "It was sent from a server {dom} does not use (SPF failed).", "trust.name": "The name shows another address than the real sender, {addr}.",
      "trust.after": "Don't open links or attachments, and never enter a password, unless you are sure.",
      "link.title": "Links that may mislead: {n}", "link.mismatch": "shows {shown}, opens {host}",
      "link.lookalike": "{host} imitates a known name", "link.puny": "{host} uses look-alike letters",
      "link.ip": "opens a bare address, {host}", "link.userinfo": "really opens {host}", "link.more": "Show all",
      "img.show": "Show pictures", "img.always": "Always for {who}",
      "read.plainOnly": "Shown as plain text (Settings).", "read.html": "Show the formatted version",
      "att.title": "Attachments", "att.save": "Save {name}",
      "ics.title": "Invitation", "ics.cal": "Add to Calendar", "ics.map": "Show on the map",
      "ics.allday": "all day",
      "net.offline": "Offline: showing mail saved on this device.",
      "net.norelay": "Set the relay address in Settings to connect.",
      "dlg.acctTitle": "Add account", "dlg.editTitle": "Account", "dlg.name": "Your name",
      "dlg.email": "E-mail address", "dlg.pass": "Password", "dlg.passKeep": "Leave empty to keep the saved one",
      "dlg.server": "Server settings", "dlg.imap": "Incoming (IMAP) server", "dlg.port": "Port / security",
      "dlg.user": "Username", "dlg.smtp": "Outgoing (SMTP) server", "dlg.smtpNote": "Used for sending, with the same username and password.",
      "dlg.relay": "Relay address", "dlg.relayHint": "The orOS mail relay (https://…). It passes your mail through and keeps nothing.",
      "dlg.connect": "Connect", "dlg.save": "Save", "dlg.cancel": "Cancel", "dlg.checking": "Checking…",
      "dlg.appPass": "{svc} needs an app password: create one in your {svc} account security settings and use it here.",
      "dlg.oauth": "Outlook.com / Hotmail no longer accept passwords from other apps. Support needs a later update.",
      "dlg.generic": "Most providers (Papaki among them) use mail.{domain}. If the connection fails, check the server name in your provider's panel.",
      "dlg.passDevice": "The password stays sealed on this device and is never synced. Enter it once on each device.",
      "dlg.remove": "Remove account", "dlg.removeQ": "Remove {name} from orOS on all your devices? Your mail stays on the server.",
      "dlg.removeOk": "Remove",
      "set.title": "Mail settings", "set.accounts": "Accounts", "set.plain": "Always show plain text", "set.threads": "Group messages by conversation", "uni.title": "All inboxes", "uni.older": "Older messages are in each account's Inbox.", "thr.count": "{n} messages in this conversation",
      "set.relay": "Relay address", "set.edit": "Edit", "set.close": "Close",
      "pass.title": "Password for {email}", "pass.text": "This account came from another device. Enter its password once on this device.",
      "pass.need": "Password needed on this device", "pass.set": "Enter password",
      "err.offline": "You are offline.", "err.norelay": "Set the relay address first.",
      "err.nopass": "The password is not saved on this device.", "err.auth": "The server refused the login. Check the e-mail address and password.",
      "err.connect": "Could not reach the mail server. Check its address and port.",
      "err.tls": "The server's secure connection failed.", "err.timeout": "The server did not answer in time.",
      "err.network": "Could not reach the relay.", "err.relay": "The relay sent an unexpected answer.",
      "err.origin": "The relay does not accept this page.", "err.rate": "Too many requests, wait a minute.",
      "err.bad-request": "The relay rejected the request ({msg}).", "err.too-big": "The message is too large to open here.",
      "err.gone": "The message no longer exists on the server.", "err.proto": "Unexpected answer from the mail server.",
      "err.closed": "The mail server closed the connection.", "err.no": "The server refused: {msg}",
      "err.fields": "Fill in the e-mail address, password and server.", "err.host": "The server address is not valid.",
      "err.relayUrl": "The relay address must start with https://",
      "err.max": "Up to {n} accounts.", "err.dup": "This account is already added.",
      "toast.added": "Account added", "toast.saved": "Saved", "toast.removed": "Account removed",
      "toast.storage": "Could not save: storage is full", "toast.saveFail": "The attachment could not be saved",
      "toast.updated": "Up to date", "toast.cal": "Calendar is not available", "time.yesterday": "Yesterday",
      "btn.compose": "New message", "act.reply": "Reply", "act.all": "Reply all", "act.fwd": "Forward",
      "cmp.title": "New message", "cmp.from": "From", "cmp.to": "To", "cmp.cc": "Cc", "cmp.bcc": "Bcc",
      "cmp.ccbcc": "Cc / Bcc", "cmp.subject": "Subject", "cmp.body": "Message", "cmp.date": "Date",
      "cmp.send": "Send", "cmp.sending": "Sending…", "cmp.discard": "Discard",
      "cmp.discardQ": "Discard this message?", "cmp.keep": "Keep writing",
      "cmp.hint": "Formatting is sent with a plain-text copy for those who don't see it. No attachments yet.",
      "rte.bar": "Formatting", "rte.b": "Bold (Ctrl+B)", "rte.i": "Italic (Ctrl+I)", "rte.u": "Underline (Ctrl+U)",
      "rte.ul": "Bulleted list", "rte.ol": "Numbered list", "rte.link": "Link (Ctrl+K)", "rte.linkAsk": "Link address (web or e-mail):",
      "rte.color": "Text colour", "rte.clear": "Clear formatting", "rte.img": "Picture or logo",
      "rte.imgBig": "This picture is too big or not PNG, JPEG or GIF.",
      "cmp.wrote": "On {date}, {who} wrote:", "cmp.fwd": "---------- Forwarded message ----------",
      "cmp.noRcpt": "Add at least one recipient.", "cmp.bad": "Not an e-mail address: {list}",
      "cmp.many": "Up to {n} recipients.", "cmp.noacct": "Add an account to send mail.",
      "cmp.timeout": "The server did not answer in time. The message may have gone out: check Sent before sending it again.",
      "dlg.sig": "Signature", "dlg.sigHint": "Added under each new message and reply, with its formatting, links and a small picture (a logo). Synced with the account.",
      "err.nosmtp": "This account has no outgoing (SMTP) server. Add it in the account's server settings.",
      "err.smtpfail": "Incoming mail works, but the outgoing server failed: {msg}",
      "err.rcpt": "The server did not accept a recipient: {msg}", "err.big": "The message is too long to send.",
      "err.noacct": "The account of this message was removed.", "err.outfull": "The Outbox is full.",
      "toast.sent": "Sent", "toast.sentNoCopy": "Sent. A copy could not be filed in Sent.",
      "toast.queued": "In the Outbox: it goes out when you are online.", "toast.outSent": "Sent from the Outbox: {n}",
      "out.bar": "Outbox: {n}", "out.title": "Outbox",
      "out.text": "Messages written offline. They go out by themselves when you are online.",
      "out.send": "Send now", "out.edit": "Edit", "out.del": "Delete", "out.failed": "Not sent: {msg}",
      "out.empty": "The Outbox is empty.", "out.nosubj": "(no subject)",
      "org.archive": "Archive", "org.trash": "Delete", "org.erase": "Delete for good", "org.spamBtn": "Spam",
      "org.notspamBtn": "Not spam", "org.star": "Star", "org.unstar": "Remove star", "org.read": "Mark as read",
      "org.unread": "Mark as unread", "org.move": "Move to…", "org.moveTitle": "Move to folder",
      "org.select": "Select", "org.all": "Select all", "org.selected": "{n} selected", "org.done": "Done",
      "org.archived": "Archived: {n}", "org.spammed": "Moved to Spam: {n}", "org.notspam": "Back in Inbox: {n}",
      "org.trashed": "Moved to Trash: {n}", "org.moved": "Moved: {n}", "org.undo": "Undo",
      "org.eraseQ": "Delete {n} message(s) for good? This cannot be undone.", "org.erased": "Deleted: {n}"
    },
    el: {
      "app": "Αλληλογραφία", "nav.folders": "Φάκελοι", "nav.back": "Πίσω", "btn.refresh": "Έλεγχος για νέα μηνύματα",
      "btn.settings": "Ρυθμίσεις", "acct.add": "Προσθήκη λογαριασμού",
      "wel.title": "Το email σου, μέσα στο orOS", "wel.text": "Πρόσθεσε έναν λογαριασμό για να διαβάζεις την αλληλογραφία σου εδώ, και χωρίς σύνδεση.",
      "f.inbox": "Εισερχόμενα", "f.sent": "Απεσταλμένα", "f.drafts": "Πρόχειρα", "f.trash": "Κάδος", "f.junk": "Ανεπιθύμητα",
      "f.archive": "Αρχειοθήκη", "f.all": "Όλα τα μηνύματα", "f.flagged": "Με αστέρι",
      "list.empty": "Δεν υπάρχουν μηνύματα εδώ.", "list.loading": "Φόρτωση…", "list.older": "Παλαιότερα μηνύματα",
      "list.end": "Αυτά ήταν όλα.", "list.count": "{n} αδιάβαστα", "list.never": "Δεν έχει ελεγχθεί ακόμα.",
      "read.none": "Διάλεξε ένα μήνυμα για να το διαβάσεις.", "read.loading": "Άνοιγμα μηνύματος…",
      "read.offline": "Αυτό το μήνυμα δεν έχει αποθηκευτεί ακόμα σε αυτή τη συσκευή. Συνδέσου στο internet για να το ανοίξεις.",
      "read.failed": "Το μήνυμα δεν άνοιξε.", "read.retry": "Δοκίμασε ξανά",
      "read.to": "Προς: {list}", "read.cc": "Κοιν.: {list}", "read.me": "εμένα", "read.nosubj": "(χωρίς θέμα)",
      "read.nosender": "(άγνωστος αποστολέας)",
      "img.blocked": "Οι εικόνες από το internet είναι κρυμμένες, για να μη μαθαίνει ο αποστολέας ότι το άνοιξες.",
      "srch.btn": "Αναζήτηση", "srch.ph": "Αναζήτηση σε αυτόν τον φάκελο", "srch.close": "Κλείσιμο αναζήτησης",
      "srch.all": "Παντού", "srch.from": "Αποστολέας", "srch.subject": "Θέμα",
      "srch.local": "Στα φορτωμένα μηνύματα: {n}", "srch.server": "Αναζήτηση σε όλο τον φάκελο στον διακομιστή",
      "srch.busy": "Αναζήτηση στον διακομιστή…", "srch.found": "Βρέθηκαν στον διακομιστή: {n}", "srch.more": "Εμφανίζονται τα {shown} νεότερα από {n}.",
      "srch.none": "Δεν βρέθηκε τίποτα.", "srch.offline": "Χωρίς σύνδεση: έγινε αναζήτηση μόνο στα μηνύματα της συσκευής.",
      "rule.title": "Κανόνες", "rule.hint": "Οι κανόνες ταξινομούν τα νέα μηνύματα των Εισερχομένων όσο το orOS είναι ανοιχτό σε κάποια συσκευή σου, και με την Αλληλογραφία κλειστή.",
      "fold.title": "Φάκελοι", "fold.new": "Νέος φάκελος", "fold.create": "Δημιουργία", "fold.rename": "Μετονομασία", "fold.delete": "Διαγραφή φακέλου",
      "fold.name": "Όνομα", "fold.in": "Μέσα σε", "fold.top": "Στο πρώτο επίπεδο", "fold.count": "{n} μηνύματα",
      "fold.deleteQ": "Διαγραφή του φακέλου «{name}»;", "fold.deleteQn": "Διαγραφή του φακέλου «{name}» και των {n} μηνυμάτων του οριστικά;",
      "fold.kids": "Ο φάκελος «{name}» έχει υποφακέλους. Διάγραψέ τους ή μετακίνησέ τους πρώτα.",
      "fold.errEmpty": "Γράψε ένα όνομα.", "fold.errLong": "Το όνομα είναι πολύ μεγάλο (έως 100 χαρακτήρες).",
      "fold.errChars": "Το όνομα δεν μπορεί να είναι Inbox ούτε να έχει {d} * % \" \\ ή αλλαγή γραμμής.", "fold.exists": "Υπάρχει ήδη φάκελος με αυτό το όνομα.",
      "fold.created": "Ο φάκελος δημιουργήθηκε: {name}", "fold.renamed": "Ο φάκελος μετονομάστηκε: {name}", "fold.deleted": "Ο φάκελος διαγράφηκε: {name}",
      "rule.add": "Νέος κανόνας", "rule.new": "Νέος κανόνας", "rule.edit": "Επεξεργασία κανόνα", "rule.none": "Δεν υπάρχουν κανόνες ακόμα.",
      "rule.acct": "Λογαριασμός", "rule.if": "Αν", "rule.has": "περιέχει", "rule.hasHint": "Πολλές λέξεις χωρισμένες με κόμμα: οποιαδήποτε από αυτές.",
      "rule.then": "Τότε", "rule.folder": "Φάκελος", "rule.run": "Εφάρμοσέ τον και τώρα στα Εισερχόμενα", "rule.on": "Ενεργός",
      "rule.del": "Διαγραφή κανόνα", "rule.saved": "Ο κανόνας αποθηκεύτηκε", "rule.deleted": "Ο κανόνας διαγράφηκε", "rule.ran": "Εφαρμόστηκε σε: {n}",
      "rule.make": "Δημιουργία κανόνα…", "rule.needHas": "Γράψε τι να αναζητηθεί.", "rule.needFolder": "Διάλεξε φάκελο.",
      "rf.from": "ο αποστολέας", "rf.to": "ένας παραλήπτης", "rf.subject": "το θέμα", "rf.any": "αποστολέας, παραλήπτες ή θέμα",
      "ra.spam": "μετακίνηση στα Ανεπιθύμητα", "ra.trash": "μετακίνηση στον Κάδο", "ra.archive": "μετακίνηση στο Αρχείο", "ra.move": "μετακίνηση σε φάκελο…",
      "ra.read": "σήμανση ως διαβασμένο", "ra.star": "αστέρι",
      "rule.sum": "Αν {field} περιέχει «{has}»: {act}", "rule.sumTo": "Αν {field} περιέχει «{has}»: μετακίνηση σε {folder}",
      "trust.ok": "Επαληθευμένος αποστολέας", "trust.okTip": "Ο διακομιστής παραλαβής έλεγξε ότι το μήνυμα έρχεται πράγματι από το {dom} (SPF, DKIM, DMARC).",
      "trust.warn": "Προσοχή: το μήνυμα ίσως δεν έρχεται από το {dom}.",
      "trust.dmarc": "Το {dom} δηλώνει ότι τέτοια μηνύματα είναι πλαστά (ο έλεγχος DMARC απέτυχε).", "trust.dkim": "Η υπογραφή του δεν ταιριάζει (ο έλεγχος DKIM απέτυχε).",
      "trust.spf": "Στάλθηκε από διακομιστή που δεν χρησιμοποιεί το {dom} (ο έλεγχος SPF απέτυχε).", "trust.name": "Το όνομα δείχνει άλλη διεύθυνση από τον πραγματικό αποστολέα, {addr}.",
      "trust.after": "Μην ανοίγεις συνδέσμους ή συνημμένα και μη δίνεις ποτέ κωδικό, αν δεν είσαι σίγουρος.",
      "link.title": "Σύνδεσμοι που ίσως παραπλανούν: {n}", "link.mismatch": "γράφει {shown}, ανοίγει {host}",
      "link.lookalike": "το {host} μιμείται γνωστό όνομα", "link.puny": "το {host} έχει γράμματα που μοιάζουν με άλλα",
      "link.ip": "ανοίγει σκέτη διεύθυνση, {host}", "link.userinfo": "στην πραγματικότητα ανοίγει το {host}", "link.more": "Όλοι",
      "img.show": "Εμφάνιση εικόνων", "img.always": "Πάντα για {who}",
      "read.plainOnly": "Εμφανίζεται ως απλό κείμενο (Ρυθμίσεις).", "read.html": "Εμφάνιση με μορφοποίηση",
      "att.title": "Συνημμένα", "att.save": "Αποθήκευση: {name}",
      "ics.title": "Πρόσκληση", "ics.cal": "Προσθήκη στο Ημερολόγιο", "ics.map": "Στον χάρτη",
      "ics.allday": "όλη μέρα",
      "net.offline": "Χωρίς σύνδεση: βλέπεις όσα είναι αποθηκευμένα σε αυτή τη συσκευή.",
      "net.norelay": "Βάλε τη διεύθυνση του relay στις Ρυθμίσεις για να συνδεθείς.",
      "dlg.acctTitle": "Προσθήκη λογαριασμού", "dlg.editTitle": "Λογαριασμός", "dlg.name": "Το όνομά σου",
      "dlg.email": "Διεύθυνση email", "dlg.pass": "Κωδικός", "dlg.passKeep": "Άφησέ το κενό για να μείνει ο αποθηκευμένος",
      "dlg.server": "Ρυθμίσεις διακομιστή", "dlg.imap": "Διακομιστής εισερχομένων (IMAP)", "dlg.port": "Θύρα / ασφάλεια",
      "dlg.user": "Όνομα χρήστη", "dlg.smtp": "Διακομιστής εξερχομένων (SMTP)", "dlg.smtpNote": "Για την αποστολή, με το ίδιο όνομα χρήστη και κωδικό.",
      "dlg.relay": "Διεύθυνση relay", "dlg.relayHint": "Το relay αλληλογραφίας του orOS (https://…). Μεταφέρει τα μηνύματα και δεν κρατά τίποτα.",
      "dlg.connect": "Σύνδεση", "dlg.save": "Αποθήκευση", "dlg.cancel": "Άκυρο", "dlg.checking": "Έλεγχος…",
      "dlg.appPass": "Το {svc} θέλει κωδικό εφαρμογής: φτιάξε έναν στις ρυθμίσεις ασφαλείας του λογαριασμού σου στο {svc} και βάλ' τον εδώ.",
      "dlg.oauth": "Το Outlook.com / Hotmail δεν δέχεται πια κωδικούς από άλλες εφαρμογές. Θα υποστηριχτεί σε επόμενη ενημέρωση.",
      "dlg.generic": "Οι περισσότεροι πάροχοι (και το Papaki) χρησιμοποιούν mail.{domain}. Αν η σύνδεση αποτύχει, δες το όνομα του διακομιστή στο panel του παρόχου σου.",
      "dlg.passDevice": "Ο κωδικός μένει σφραγισμένος σε αυτή τη συσκευή και δεν συγχρονίζεται. Τον δίνεις μία φορά σε κάθε συσκευή.",
      "dlg.remove": "Αφαίρεση λογαριασμού", "dlg.removeQ": "Να αφαιρεθεί το {name} από το orOS σε όλες τις συσκευές σου; Τα μηνύματα μένουν στον διακομιστή.",
      "dlg.removeOk": "Αφαίρεση",
      "set.title": "Ρυθμίσεις αλληλογραφίας", "set.accounts": "Λογαριασμοί", "set.plain": "Πάντα ως απλό κείμενο", "set.threads": "Ομαδοποίηση μηνυμάτων ανά συζήτηση", "uni.title": "Όλα τα Εισερχόμενα", "uni.older": "Τα παλαιότερα μηνύματα είναι στα Εισερχόμενα κάθε λογαριασμού.", "thr.count": "{n} μηνύματα σε αυτή τη συζήτηση",
      "set.relay": "Διεύθυνση relay", "set.edit": "Επεξεργασία", "set.close": "Κλείσιμο",
      "pass.title": "Κωδικός για {email}", "pass.text": "Ο λογαριασμός ήρθε από άλλη συσκευή. Δώσε τον κωδικό του μία φορά σε αυτή τη συσκευή.",
      "pass.need": "Χρειάζεται κωδικός σε αυτή τη συσκευή", "pass.set": "Βάλε κωδικό",
      "err.offline": "Δεν υπάρχει σύνδεση.", "err.norelay": "Βάλε πρώτα τη διεύθυνση του relay.",
      "err.nopass": "Ο κωδικός δεν είναι αποθηκευμένος σε αυτή τη συσκευή.", "err.auth": "Ο διακομιστής δεν δέχτηκε τη σύνδεση. Έλεγξε τη διεύθυνση email και τον κωδικό.",
      "err.connect": "Ο διακομιστής αλληλογραφίας δεν απάντησε. Έλεγξε τη διεύθυνση και τη θύρα του.",
      "err.tls": "Η ασφαλής σύνδεση με τον διακομιστή απέτυχε.", "err.timeout": "Ο διακομιστής δεν απάντησε εγκαίρως.",
      "err.network": "Το relay δεν απάντησε.", "err.relay": "Το relay έδωσε απρόσμενη απάντηση.",
      "err.origin": "Το relay δεν δέχεται αυτή τη σελίδα.", "err.rate": "Πολλά αιτήματα, περίμενε ένα λεπτό.",
      "err.bad-request": "Το relay απέρριψε το αίτημα ({msg}).", "err.too-big": "Το μήνυμα είναι πολύ μεγάλο για να ανοίξει εδώ.",
      "err.gone": "Το μήνυμα δεν υπάρχει πια στον διακομιστή.", "err.proto": "Απρόσμενη απάντηση από τον διακομιστή.",
      "err.closed": "Ο διακομιστής έκλεισε τη σύνδεση.", "err.no": "Ο διακομιστής αρνήθηκε: {msg}",
      "err.fields": "Συμπλήρωσε email, κωδικό και διακομιστή.", "err.host": "Η διεύθυνση του διακομιστή δεν είναι έγκυρη.",
      "err.relayUrl": "Η διεύθυνση του relay πρέπει να ξεκινά με https://",
      "err.max": "Έως {n} λογαριασμοί.", "err.dup": "Αυτός ο λογαριασμός υπάρχει ήδη.",
      "toast.added": "Ο λογαριασμός προστέθηκε", "toast.saved": "Αποθηκεύτηκε", "toast.removed": "Ο λογαριασμός αφαιρέθηκε",
      "toast.storage": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος", "toast.saveFail": "Το συνημμένο δεν αποθηκεύτηκε",
      "toast.updated": "Όλα ενημερωμένα", "toast.cal": "Το Ημερολόγιο δεν είναι διαθέσιμο", "time.yesterday": "Χθες",
      "btn.compose": "Νέο μήνυμα", "act.reply": "Απάντηση", "act.all": "Απάντηση σε όλους", "act.fwd": "Προώθηση",
      "cmp.title": "Νέο μήνυμα", "cmp.from": "Από", "cmp.to": "Προς", "cmp.cc": "Κοιν.", "cmp.bcc": "Κρυφή κοιν.",
      "cmp.ccbcc": "Κοιν. / Κρυφή κοιν.", "cmp.subject": "Θέμα", "cmp.body": "Μήνυμα", "cmp.date": "Ημερομηνία",
      "cmp.send": "Αποστολή", "cmp.sending": "Αποστολή…", "cmp.discard": "Απόρριψη",
      "cmp.discardQ": "Να απορριφθεί το μήνυμα;", "cmp.keep": "Συνέχεια γραψίματος",
      "cmp.hint": "Η μορφοποίηση στέλνεται μαζί με αντίγραφο σε απλό κείμενο για όσους δεν τη βλέπουν. Χωρίς συνημμένα προς το παρόν.",
      "rte.bar": "Μορφοποίηση", "rte.b": "Έντονα (Ctrl+B)", "rte.i": "Πλάγια (Ctrl+I)", "rte.u": "Υπογράμμιση (Ctrl+U)",
      "rte.ul": "Λίστα με κουκκίδες", "rte.ol": "Αριθμημένη λίστα", "rte.link": "Σύνδεσμος (Ctrl+K)", "rte.linkAsk": "Διεύθυνση συνδέσμου (web ή email):",
      "rte.color": "Χρώμα κειμένου", "rte.clear": "Καθαρισμός μορφοποίησης", "rte.img": "Εικόνα ή λογότυπο",
      "rte.imgBig": "Η εικόνα είναι πολύ μεγάλη ή δεν είναι PNG, JPEG ή GIF.",
      "cmp.wrote": "Στις {date}, {who} έγραψε:", "cmp.fwd": "---------- Προωθημένο μήνυμα ----------",
      "cmp.noRcpt": "Πρόσθεσε τουλάχιστον έναν παραλήπτη.", "cmp.bad": "Δεν είναι διεύθυνση email: {list}",
      "cmp.many": "Έως {n} παραλήπτες.", "cmp.noacct": "Πρόσθεσε έναν λογαριασμό για να στέλνεις μηνύματα.",
      "cmp.timeout": "Ο διακομιστής δεν απάντησε εγκαίρως. Το μήνυμα ίσως έφυγε: δες τα Απεσταλμένα πριν το ξαναστείλεις.",
      "dlg.sig": "Υπογραφή", "dlg.sigHint": "Μπαίνει κάτω από κάθε νέο μήνυμα και απάντηση, με τη μορφοποίηση, τους συνδέσμους και μια μικρή εικόνα (λογότυπο). Συγχρονίζεται με τον λογαριασμό.",
      "err.nosmtp": "Ο λογαριασμός δεν έχει διακομιστή εξερχομένων (SMTP). Πρόσθεσέ τον στις ρυθμίσεις διακομιστή του λογαριασμού.",
      "err.smtpfail": "Τα εισερχόμενα δουλεύουν, αλλά ο διακομιστής εξερχομένων απέτυχε: {msg}",
      "err.rcpt": "Ο διακομιστής δεν δέχτηκε παραλήπτη: {msg}", "err.big": "Το μήνυμα είναι πολύ μεγάλο για αποστολή.",
      "err.noacct": "Ο λογαριασμός αυτού του μηνύματος αφαιρέθηκε.", "err.outfull": "Τα Εξερχόμενα είναι γεμάτα.",
      "toast.sent": "Στάλθηκε", "toast.sentNoCopy": "Στάλθηκε. Δεν μπήκε αντίγραφο στα Απεσταλμένα.",
      "toast.queued": "Μπήκε στα Εξερχόμενα: θα σταλεί μόλις συνδεθείς.", "toast.outSent": "Στάλθηκαν από τα Εξερχόμενα: {n}",
      "out.bar": "Εξερχόμενα: {n}", "out.title": "Εξερχόμενα",
      "out.text": "Μηνύματα που γράφτηκαν χωρίς σύνδεση. Στέλνονται μόνα τους μόλις συνδεθείς.",
      "out.send": "Αποστολή τώρα", "out.edit": "Επεξεργασία", "out.del": "Διαγραφή", "out.failed": "Δεν στάλθηκε: {msg}",
      "out.empty": "Τα Εξερχόμενα είναι άδεια.", "out.nosubj": "(χωρίς θέμα)",
      "org.archive": "Αρχειοθέτηση", "org.trash": "Διαγραφή", "org.erase": "Οριστική διαγραφή", "org.spamBtn": "Ανεπιθύμητο",
      "org.notspamBtn": "Δεν είναι ανεπιθύμητο", "org.star": "Αστέρι", "org.unstar": "Χωρίς αστέρι", "org.read": "Σήμανση ως διαβασμένο",
      "org.unread": "Σήμανση ως αδιάβαστο", "org.move": "Μετακίνηση σε…", "org.moveTitle": "Μετακίνηση σε φάκελο",
      "org.select": "Επιλογή", "org.all": "Επιλογή όλων", "org.selected": "Επιλεγμένα: {n}", "org.done": "Τέλος",
      "org.archived": "Αρχειοθετήθηκαν: {n}", "org.spammed": "Στα Ανεπιθύμητα: {n}", "org.notspam": "Πίσω στα Εισερχόμενα: {n}",
      "org.trashed": "Στον Κάδο: {n}", "org.moved": "Μετακινήθηκαν: {n}", "org.undo": "Αναίρεση",
      "org.eraseQ": "Οριστική διαγραφή {n} μηνυμάτων; Δεν αναιρείται.", "org.erased": "Διαγράφηκαν: {n}"
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
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function newId() {
    var r = new Uint32Array(2);
    crypto.getRandomValues(r);
    return Date.now().toString(36) + r[0].toString(36) + r[1].toString(36).slice(0, 4);
  }
  function fmtSize(n) {
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return Math.round(n / 1024) + " KB";
    return (n / 1048576).toFixed(1) + " MB";
  }
  function locale() { return LANG === "el" ? "el-GR" : "en-GB"; }
  function fmtListDate(ms) {
    if (!ms) return "";
    var d = new Date(ms), now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
    }
    var y = new Date(now.getTime() - 86400000);
    if (d.toDateString() === y.toDateString()) return t("time.yesterday");
    if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString(locale(), { day: "numeric", month: "short" });
    return d.toLocaleDateString(locale(), { day: "numeric", month: "numeric", year: "numeric" });
  }
  function fmtFullDate(ms) {
    if (!ms) return "";
    return new Date(ms).toLocaleString(locale(), { weekday: "short", day: "numeric", month: "short",
      year: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  function hue(s) {
    var h = 0;
    s = String(s || "");
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return h;
  }
  function initial(p) {
    var s = (p && (p.name || p.addr)) || "?";
    var m = /[\p{L}\p{N}]/u.exec(s);
    return (m ? m[0] : "?").toUpperCase();
  }
  function who(p) { return p ? (p.name || p.addr || "") : ""; }
  function lowerAddr(a) { return String(a || "").trim().toLowerCase(); }

  // UID sets "1:5,9" (the relay's compact form)
  function compressUids(uids) {
    var a = uids.slice().sort(function (x, y) { return x - y; });
    var parts = [], i = 0;
    while (i < a.length) {
      var j = i;
      while (j + 1 < a.length && a[j + 1] === a[j] + 1) j++;
      parts.push(i === j ? String(a[i]) : a[i] + ":" + a[j]);
      i = j + 1;
    }
    return parts.join(",");
  }
  function uidSetHas(set) {
    var out = {};
    String(set || "").split(",").forEach(function (p) {
      if (!p) return;
      var m = p.split(":"), a = +m[0], b = m.length > 1 ? +m[1] : a;
      if (!(a > 0 && b > 0) || Math.abs(b - a) > 2000000) return;
      for (var k = Math.min(a, b); k <= Math.max(a, b); k++) out[k] = 1;
    });
    return out;
  }

  var UI = {
    menu: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>',
    back: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>',
    refresh: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>',
    gear: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    plus: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    mail: '<svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="22 6 12 13 2 6"/></svg>',
    clip: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>',
    star: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    down: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    pen: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>',
    out: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
    shield: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>',
    archive: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>',
    trash: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>',
    spam: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
    inbox: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>',
    starOff: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    open: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-6 9 6v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><polyline points="3 9 12 15 21 9"/></svg>',
    unread: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="22 6 12 13 2 6"/></svg>',
    filter: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>',
    folder: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
    search: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    close: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>',
    key: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>'
  };

  // BOOT MARKER
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    document.documentElement.lang = LANG;
    console.log("mail.js v" + (m ? m[1] : "?") + " boot");
  })();

  // ---------- 2. Data model: accounts, merge ----------
  var SECS = { 993: "tls", 143: "starttls", 465: "tls", 587: "starttls" };

  function normHost(h) {
    h = String(h || "").trim().toLowerCase().replace(/\.$/, "");
    if (h.length < 4 || h.length > 253) return "";
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(h)) return "";
    if (/^[0-9.]+$/.test(h)) return "";
    return h;
  }
  function normServer(s, ports) {
    if (!s || typeof s !== "object") return null;
    var host = normHost(s.host), port = +s.port;
    if (!host || ports.indexOf(port) < 0) return null;
    var user = typeof s.user === "string" ? s.user.trim().slice(0, 320) : "";
    return { host: host, port: port, sec: SECS[port], user: user };
  }
  function normEmail(e) {
    e = String(e || "").trim();
    return /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/.test(e) && e.length <= 254 ? e : "";
  }
  function normAccount(a) {
    if (!a || typeof a !== "object" || typeof a.id !== "string" || !/^[a-z0-9]{6,40}$/.test(a.id)) return null;
    if (!isInt(a.m) || a.m < 0) return null;
    var email = normEmail(a.email);
    var imap = normServer(a.imap, [993, 143]);
    if (!email || !imap) return null;
    if (!imap.user) imap.user = email;
    var out = { id: a.id, m: a.m, name: String(a.name || "").replace(/\s+/g, " ").trim().slice(0, 80),
                email: email, imap: imap };
    var smtp = normServer(a.smtp, [465, 587]);
    if (smtp) { if (!smtp.user) smtp.user = imap.user; out.smtp = smtp; }
    var sig = normSig(a.sig);
    if (sig) out.sig = sig;
    // The formatted signature: kept as written by rich.js clean() and
    // only ever shown after passing through clean() again (never as is).
    if (typeof a.sigHtml === "string" && a.sigHtml && a.sigHtml.length <= MAX_SIG_HTML) out.sigHtml = a.sigHtml;
    return out;
  }
  function normSig(v) {
    if (typeof v !== "string") return "";
    return v.replace(/\r\n?/g, "\n").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "").replace(/\s+$/, "").slice(0, MAX_SIG);
  }
  function normRelayUrl(u) {
    u = String(u || "").trim().replace(/\/+$/, "");
    if (!u) return "";
    if (/^https:\/\/[a-z0-9.-]+(:\d+)?(\/[\w.~-]*)*$/i.test(u)) return u;
    if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(u)) return u;   // local relay (development)
    return null;
  }

  function emptyData() { return { ver: DATA_VER, accounts: [], relay: { url: "", m: 0 }, imgOk: {}, tombs: {}, rules: [] }; }

  function sortedObj(src, maxN) {
    var keys = Object.keys(src);
    if (maxN && keys.length > maxN) {
      keys.sort(function (x, y) { return (src[y] - src[x]) || cmpStr(x, y); });
      keys = keys.slice(0, maxN);
    }
    keys.sort(cmpStr);
    var out = {};
    keys.forEach(function (k) { out[k] = src[k]; });
    return out;
  }

  // Symmetric merge (R5): accounts LWW by m (tie: JSON order), tombstones
  // max-ts and delete wins ties (R17), relay LWW, allowed-image senders
  // union of the latest stamp, rules LWW by m like accounts (same
  // tombstones; rules of a removed account go with it). Canonical
  // output (R26).
  function mergeMail(a, b) {
    var res = emptyData();
    var tombs = {}, byId = {}, img = {}, rules = {};
    [a, b].forEach(function (d) {
      if (!d || typeof d !== "object") return;
      if (d.tombs && typeof d.tombs === "object") {
        Object.keys(d.tombs).forEach(function (k) {
          var v = d.tombs[k];
          if (/^[a-z0-9]{6,40}$/.test(k) && isInt(v) && v > 0 && !(tombs[k] >= v)) tombs[k] = v;
        });
      }
      (Array.isArray(d.accounts) ? d.accounts : []).forEach(function (x) {
        var n = normAccount(x);
        if (!n) return;
        var cur = byId[n.id];
        if (!cur || n.m > cur.m || (n.m === cur.m && cmpStr(JSON.stringify(n), JSON.stringify(cur)) > 0)) byId[n.id] = n;
      });
      (Array.isArray(d.rules) ? d.rules : []).forEach(function (x) {
        var n = R.norm(x);
        if (!n) return;
        var cur = rules[n.id];
        if (!cur || n.m > cur.m || (n.m === cur.m && cmpStr(JSON.stringify(n), JSON.stringify(cur)) > 0)) rules[n.id] = n;
      });
      var r = d.relay;
      if (r && typeof r === "object" && isInt(r.m) && r.m >= 0) {
        var url = normRelayUrl(r.url);
        if (url !== null) {
          var cand = { url: url, m: r.m };
          if (cand.m > res.relay.m || (cand.m === res.relay.m && cmpStr(cand.url, res.relay.url) > 0)) res.relay = cand;
        }
      }
      if (d.imgOk && typeof d.imgOk === "object") {
        Object.keys(d.imgOk).forEach(function (k) {
          var v = d.imgOk[k], key = lowerAddr(k);
          if (key && key.length <= 254 && /@/.test(key) && isInt(v) && v > 0 && !(img[key] >= v)) img[key] = v;
        });
      }
    });
    Object.keys(byId).sort(cmpStr).forEach(function (id) {
      if (tombs[id] >= byId[id].m) return;
      res.accounts.push(byId[id]);
    });
    var live = {};
    res.accounts.forEach(function (x) { live[x.id] = 1; });
    res.rules = Object.keys(rules).sort(cmpStr).filter(function (id) {
      var x = rules[id];
      return !(tombs[id] >= x.m) && !(tombs[x.acct] && !live[x.acct]);
    }).slice(0, R.MAX_RULES).map(function (id) { return rules[id]; });
    res.tombs = sortedObj(tombs, MAX_TOMBS);
    res.imgOk = sortedObj(img, MAX_IMGOK);
    return res;
  }

  // Server presets by e-mail domain.
  var PRESETS = [
    { d: ["gmail.com", "googlemail.com"], imap: "imap.gmail.com", smtp: "smtp.gmail.com", sp: 465, svc: "Google" },
    { d: ["icloud.com", "me.com", "mac.com"], imap: "imap.mail.me.com", smtp: "smtp.mail.me.com", sp: 587, svc: "Apple" },
    { d: ["yahoo.com", "yahoo.gr", "ymail.com", "rocketmail.com"], imap: "imap.mail.yahoo.com", smtp: "smtp.mail.yahoo.com", sp: 465, svc: "Yahoo" },
    { d: ["gmx.com", "gmx.net", "gmx.de"], imap: "imap.gmx.com", smtp: "mail.gmx.com", sp: 587 },
    { d: ["zoho.com", "zohomail.com"], imap: "imap.zoho.com", smtp: "smtp.zoho.com", sp: 465 },
    { d: ["outlook.com", "hotmail.com", "live.com", "msn.com", "hotmail.gr", "outlook.com.gr", "live.gr"], oauth: true }
  ];
  function presetFor(email) {
    var dom = (String(email || "").split("@")[1] || "").trim().toLowerCase();
    if (!dom) return null;
    for (var i = 0; i < PRESETS.length; i++) {
      if (PRESETS[i].d.indexOf(dom) >= 0) return PRESETS[i];
    }
    return { imap: "mail." + dom, smtp: "mail." + dom, sp: 465, generic: dom };
  }

  // Special folders: \Sent etc. (RFC 6154), else well-known names.
  var SPECIAL_ORDER = ["inbox", "drafts", "sent", "archive", "junk", "trash", "all", "flagged"];
  var SPECIAL_NAMES = {
    sent: /^(sent|sent items|sent messages|sent mail|απεσταλμένα)$/i,
    drafts: /^(drafts?|πρόχειρα)$/i,
    trash: /^(trash|deleted|deleted items|deleted messages|bin|κάδος|διαγραμμένα)$/i,
    junk: /^(junk|spam|junk e-mail|bulk mail|ανεπιθύμητα)$/i,
    archive: /^(archive|archives|αρχειοθήκη)$/i
  };
  function folderRole(f) {
    if (/^inbox$/i.test(f.name)) return "inbox";
    var fl = (f.flags || []).join(" ").toLowerCase();
    var roles = ["sent", "drafts", "trash", "junk", "archive", "all", "flagged"];
    for (var i = 0; i < roles.length; i++) if (fl.indexOf("\\" + roles[i]) >= 0) return roles[i];
    var leaf = folderLeaf(f);
    for (var k in SPECIAL_NAMES) if (SPECIAL_NAMES[k].test(leaf)) return k;
    return "";
  }
  function folderLeaf(f) {
    var name = M.utf7Decode(f.name);
    if (f.delim && name.indexOf(f.delim) >= 0) name = name.slice(name.lastIndexOf(f.delim) + 1);
    return name;
  }
  function folderDepth(f) {
    if (!f.delim) return 0;
    var parts = f.name.split(f.delim).length - 1;
    if (/^inbox$/i.test(f.name.split(f.delim)[0]) && parts > 0) parts--;   // INBOX.Sent shows at top level
    return Math.min(parts, 4);
  }
  function folderLabel(f) {
    var role = folderRole(f);
    return role ? t("f." + role) : folderLeaf(f);
  }
  function sortFolders(list) {
    var seenRole = {};
    return list.filter(function (f) {
      return !(f.flags || []).some(function (x) { return /^\\(noselect|nonexistent)$/i.test(x); });
    }).map(function (f) {
      var r = folderRole(f);
      var rank = r && !seenRole[r] ? SPECIAL_ORDER.indexOf(r) : 99;
      if (r) seenRole[r] = 1;
      return { f: f, rank: rank, key: M.utf7Decode(f.name).toLowerCase() };
    }).sort(function (x, y) {
      return (x.rank - y.rank) || cmpStr(x.key, y.key);
    }).map(function (x) { return x.f; });
  }

  // Folder management (pure). A leaf is one folder name as typed; on
  // the server it is modified UTF-7 under its parent.
  function leafError(leaf, delim) {
    leaf = String(leaf || "").trim();
    if (!leaf) return "fold.errEmpty";
    if (leaf.length > 100) return "fold.errLong";
    if (/[\x00-\x1f\x7f*%"\\]/.test(leaf) || (delim && leaf.indexOf(delim) >= 0) || /^inbox$/i.test(leaf)) return "fold.errChars";
    return "";
  }
  function childName(parent, delim, leaf) {
    var enc = M.utf7Encode(String(leaf || "").trim());
    return parent ? parent + (delim || "") + enc : enc;
  }
  // the server name of `f` with its last part replaced by `leaf`
  function siblingName(f, leaf) {
    var cut = f.delim ? f.name.lastIndexOf(f.delim) : -1;
    return childName(cut >= 0 ? f.name.slice(0, cut) : "", f.delim, leaf);
  }
  // the name `name` has after `from` became `to` (subfolders follow), or null
  function renamedPath(name, from, to, delim) {
    if (name === from) return to;
    if (delim && name.indexOf(from + delim) === 0) return to + name.slice(from.length);
    return null;
  }
  // Rules of the account that move mail into a renamed folder follow it;
  // into a deleted one (to = null) they are turned off. → { rules, n }
  function retargetRules(rules, acctId, from, to, delim, now) {
    var n = 0;
    var out = (rules || []).map(function (r) {
      if (!r || r.acct !== acctId || r.act !== "move" || typeof r.to !== "string") return r;
      var np = renamedPath(r.to, from, to === null ? from : to, delim);
      if (np === null) return r;
      n++;
      var m = Math.max(now, r.m + 1);
      return to === null ? Object.assign({}, r, { on: false, m: m }) : Object.assign({}, r, { to: np, m: m });
    });
    return { rules: out, n: n };
  }

  // ---------- 3. Device store (IndexedDB) ----------
  var dbPromise = null;
  function db() {
    if (!dbPromise) {
      dbPromise = new Promise(function (resolve, reject) {
        var req = indexedDB.open(DB_NAME, 2);   // 2: + outbox
        req.onupgradeneeded = function () {
          var d = req.result;
          ["keys", "creds", "folders", "heads", "bodies", "outbox"].forEach(function (n) {
            if (!d.objectStoreNames.contains(n)) d.createObjectStore(n);
          });
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
  // Deletes every key starting with prefix (one account's cache).
  function idbDelPrefix(store, prefix) {
    return idb(store, "readwrite", function (s) {
      s.delete(IDBKeyRange.bound(prefix, prefix + "\uffff"));
    });
  }

  // ---------- 4. Passwords (sealed with the device key) ----------
  // A non-extractable AES-GCM key lives in this app's own IndexedDB:
  // the raw bytes can never be read, not even by script (A65c).
  var passCache = {};
  function deviceKey() {
    return idbGet("keys", "device").then(function (k) {
      if (k) return k;
      return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"])
        .then(function (nk) { return idbPut("keys", "device", nk).then(function () { return nk; }); });
    });
  }
  function savePass(acctId, pass) {
    return deviceKey().then(function (key) {
      var iv = crypto.getRandomValues(new Uint8Array(12));
      return crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, new TextEncoder().encode(pass))
        .then(function (sealed) { return idbPut("creds", acctId, { iv: iv.buffer, data: sealed }); })
        .then(function () { passCache[acctId] = pass; });
    });
  }
  function loadPass(acctId) {
    if (passCache[acctId] !== undefined) return Promise.resolve(passCache[acctId]);
    return idbGet("creds", acctId).then(function (rec) {
      if (!rec) return null;
      return deviceKey().then(function (key) {
        return crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(rec.iv) }, key, rec.data);
      }).then(function (plain) {
        var p = new TextDecoder().decode(plain);
        passCache[acctId] = p;
        return p;
      });
    }).catch(function () { return null; });
  }
  function dropPass(acctId) {
    delete passCache[acctId];
    return idbDel("creds", acctId).catch(function () {});
  }

  // ---------- 5. Relay client ----------
  function relayUrl() { return data.relay.url || DEFAULT_RELAY; }

  function MailError(code, msg) { this.code = code; this.msg = msg || ""; }
  function errText(e) {
    var code = e && e.code ? e.code : "relay";
    var s = t("err." + code, { msg: (e && e.msg) || code });
    return s === "err." + code ? t("err.relay") : s;
  }

  // One relay call. `pass` given = a login test before the account is saved.
  // args.smtp === true → the account's outgoing server goes along (same password).
  function call(op, acct, args, pass) {
    if (!navigator.onLine) return Promise.reject(new MailError("offline"));
    var url = relayUrl();
    if (!url) return Promise.reject(new MailError("norelay"));
    var pp = pass !== undefined ? Promise.resolve(pass) : loadPass(acct.id);
    return pp.then(function (pw) {
      if (!pw) throw new MailError("nopass");
      var body = { op: op, acct: { host: acct.imap.host, port: acct.imap.port, sec: acct.imap.sec,
                                   user: acct.imap.user || acct.email, pass: pw } };
      Object.keys(args || {}).forEach(function (k) { body[k] = args[k]; });
      if (body.smtp === true) {
        if (!acct.smtp) throw new MailError("nosmtp");
        body.smtp = { host: acct.smtp.host, port: acct.smtp.port, sec: acct.smtp.sec,
                      user: acct.smtp.user || body.acct.user, pass: pw };
      }
      var ctl = new AbortController();
      var timer = setTimeout(function () { ctl.abort(); }, CALL_TIMEOUT);
      return fetch(url + "/v1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctl.signal,
        keepalive: op === "move" || op === "flag" || op === "expunge",   // survives leaving the page
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer"
      }).then(function (r) {
        return r.json().catch(function () { return null; });
      }, function () {
        throw new MailError(ctl.signal.aborted ? "timeout" : "network");
      }).then(function (j) {
        clearTimeout(timer);
        if (!j || typeof j !== "object") throw new MailError("relay");
        if (!j.ok) throw new MailError((j.error && j.error.code) || "relay", j.error && j.error.msg);
        return j.data;
      }, function (e) {
        clearTimeout(timer);
        throw e;
      });
    });
  }

  // ---------- 6. Folders + message cache ----------
  var data = emptyData();
  var prefs = { acct: null, folder: "INBOX", plain: 0, threads: 1, uni: 0 };
  var openThreads = {};    // conversation key → 1 while its older messages show
  var folders = {};        // acctId → [folder] (sorted)
  var needPass = {};       // acctId → 1 when no password on this device
  var cur = null;          // heads record of the open folder
  var uni = null;          // "All inboxes": { recs: { acctId: Inbox heads }, err, at }
  var openMsg = null;      // { uid, sum, parsed, blocked, remote }
  var busy = {};           // key → promise (de-dup)
  var lastErr = null;
  var showImgFor = {};     // uid → 1 (this session)
  var view = "list";       // mobile pane: side | list | read
  var refreshTimer = null, backoff = REFRESH_MS, tick = 0;

  function acctById(id) {
    for (var i = 0; i < data.accounts.length; i++) if (data.accounts[i].id === id) return data.accounts[i];
    return null;
  }
  function curAcct() { return acctById(prefs.acct) || data.accounts[0] || null; }
  function headKey(acctId, folder) { return acctId + "|" + folder; }
  function bodyKey(acctId, folder, uidv, uid) { return acctId + "|" + folder + "|" + uidv + "|" + uid; }

  function loadFolders(acct) {
    return idbGet("folders", acct.id).then(function (rec) {
      if (rec && Array.isArray(rec.list)) folders[acct.id] = rec.list;
    }).catch(function () {});
  }
  function refreshFolders(acct) {
    var k = "f|" + acct.id;
    if (busy[k]) return busy[k];
    busy[k] = call("folders", acct, {}).then(function (res) {
      var list = sortFolders(Array.isArray(res.folders) ? res.folders : []);
      folders[acct.id] = list;
      delete needPass[acct.id];
      return idbPut("folders", acct.id, { list: list, at: Date.now() });
    }).then(function () { renderSide(); }, function (e) {
      if (e.code === "nopass") { needPass[acct.id] = 1; renderSide(); }
      throw e;
    });
    busy[k].then(clearBusy, clearBusy);
    function clearBusy() { delete busy[k]; }
    return busy[k];
  }

  function emptyHeads(acctId, folder) {
    return { acct: acctId, folder: folder, uidv: 0, msgs: [], more: false, at: 0, pend: {} };
  }
  function loadHeads(acctId, folder) {
    return idbGet("heads", headKey(acctId, folder)).then(function (rec) {
      return rec && Array.isArray(rec.msgs) ? rec : emptyHeads(acctId, folder);
    }, function () { return emptyHeads(acctId, folder); });
  }
  function saveHeads(rec) { return idbPut("heads", headKey(rec.acct, rec.folder), rec).catch(function () {}); }

  function summarize(x) {
    var s = M.summary(M.b64ToBin(x.hdr || ""));
    return { uid: x.uid, flags: Array.isArray(x.flags) ? x.flags : [], size: x.size || 0,
             date: s.date || M.parseDate(x.date), from: s.from, to: s.to, cc: s.cc,
             subj: s.subject, att: s.att, mid: s.messageId, irt: (/<[^<>\s]+>/.exec(s.inReplyTo || "") || [""])[0] };
  }
  function hasFlag(m, f) { return m.flags.indexOf(f) >= 0; }

  // Applies one "list" answer to the cache: drops what the server no
  // longer has, refreshes flags, adds the new headers, and keeps the
  // cached run contiguous (a gap of unseen UIDs cuts the older part,
  // "older" paging brings it back).
  function applyList(rec, res, older) {
    if (rec.uidv && res.uidvalidity !== rec.uidv) { rec.msgs = []; rec.pend = {}; }
    rec.uidv = res.uidvalidity;
    var alive = uidSetHas(res.uids);
    var byUid = {};
    rec.msgs.forEach(function (m) { if (alive[m.uid]) byUid[m.uid] = m; });
    Object.keys(res.flags || {}).forEach(function (u) {
      if (byUid[u]) byUid[u].flags = res.flags[u];
    });
    (res.msgs || []).forEach(function (x) { if (x && x.uid > 0) byUid[x.uid] = summarize(x); });
    // re-apply local changes not yet on the server
    Object.keys(rec.pend || {}).forEach(function (u) {
      if (byUid[u] && !hasFlag(byUid[u], "\\Seen")) byUid[u].flags = byUid[u].flags.concat("\\Seen");
      if (!alive[u]) delete rec.pend[u];
    });
    var aliveDesc = Object.keys(alive).map(Number).sort(function (a, b) { return b - a; });
    var cut = 0;
    if (!older) {
      for (var i = 0; i < aliveDesc.length; i++) { if (!byUid[aliveDesc[i]]) { cut = aliveDesc[i]; break; } }
    }
    var list = Object.keys(byUid).map(function (u) { return byUid[u]; })
      .filter(function (m) { return !cut || m.uid > cut; })
      .sort(function (a, b) { return b.uid - a.uid; })
      .slice(0, KEEP_HEADS);
    rec.msgs = list;
    var minUid = list.length ? list[list.length - 1].uid : Infinity;
    rec.more = aliveDesc.some(function (u) { return u < minUid; });
    rec.at = Date.now();
    return rec;
  }

  function refreshFolder(acct, folder, older) {
    var k = "l|" + acct.id + "|" + folder + (older ? "|o" : "");
    if (busy[k]) return busy[k];
    busy[k] = loadHeads(acct.id, folder).then(function (rec) {
      return flushPend(acct, rec).then(function () {
        var known = rec.msgs.map(function (m) { return m.uid; });
        var args = { folder: folder, limit: PAGE };
        if (known.length) args.known = compressUids(known);
        if (older && known.length) args.beforeUid = known[known.length - 1];
        return call("list", acct, args).then(function (res) {
          applyList(rec, res, older);
          return saveHeads(rec).then(function () { return rec; });
        });
      });
    });
    busy[k].then(clearBusy, clearBusy);
    function clearBusy() { delete busy[k]; }
    return busy[k];
  }

  // Read marks made offline (or that failed) go up with the next call.
  function flushPend(acct, rec) {
    var uids = Object.keys(rec.pend || {}).map(Number).filter(function (u) { return u > 0; });
    if (!uids.length || !navigator.onLine) return Promise.resolve();
    return call("flag", acct, { folder: rec.folder, uids: uids.slice(0, 500), add: ["\\Seen"], remove: [] })
      .then(function () { uids.forEach(function (u) { delete rec.pend[u]; }); return saveHeads(rec); },
            function () {});
  }

  // Message source: cache first, then the relay. Kept as base64.
  function getSource(acct, folder, uidv, uid) {
    var key = bodyKey(acct.id, folder, uidv, uid);
    return idbGet("bodies", key).catch(function () { return null; }).then(function (rec) {
      if (rec && typeof rec.raw === "string") {
        rec.at = Date.now();
        idbPut("bodies", key, rec).catch(function () {});
        return rec.raw;
      }
      if (!navigator.onLine) throw new MailError("offline-body");
      return call("fetch", acct, { folder: folder, uid: uid }).then(function (res) {
        var raw = res.raw || "";
        var val = { raw: raw, at: Date.now(), size: raw.length };
        return idbPut("bodies", key, val).catch(function () {}).then(function () {
          pruneBodies();
          return raw;
        });
      });
    });
  }
  var pruning = false;
  function pruneBodies() {
    if (pruning) return;
    pruning = true;
    var rows = [];
    db().then(function (d) {
      return new Promise(function (resolve) {
        var tx = d.transaction("bodies", "readonly");
        var req = tx.objectStore("bodies").openCursor();
        req.onsuccess = function () {
          var c = req.result;
          if (!c) return;
          rows.push({ k: c.key, at: c.value.at || 0, size: c.value.size || 0 });
          c.continue();
        };
        tx.oncomplete = resolve;
        tx.onerror = resolve;
      });
    }).then(function () {
      rows.sort(function (a, b) { return b.at - a.at; });
      var total = 0, drop = [];
      rows.forEach(function (r, i) {
        total += r.size;
        if (i >= KEEP_BODIES || total > BODY_BUDGET) drop.push(r.k);
      });
      if (!drop.length) return;
      return idb("bodies", "readwrite", function (s) { drop.forEach(function (k) { s.delete(k); }); });
    }).catch(function () {}).then(function () { pruning = false; });
  }

  function markSeen(acct, rec, m) {
    if (hasFlag(m, "\\Seen")) return;
    m.flags = m.flags.concat("\\Seen");
    rec.pend = rec.pend || {};
    rec.pend[m.uid] = 1;
    adjustUnseen(acct.id, rec.folder, -1);
    saveHeads(rec).then(function () { return flushPend(acct, rec); });
  }
  function adjustUnseen(acctId, folder, d) {
    (folders[acctId] || []).forEach(function (f) {
      if (f.name === folder && isInt(f.unseen)) f.unseen = Math.max(0, f.unseen + d);
    });
    renderSide();
  }

  // ---------- 7. UI: toolbar, side, list ----------
  function setView(v) {
    view = v;
    document.body.setAttribute("data-view", v);
    $("scrim").hidden = v !== "side";
    renderBar();
  }
  function narrow() { return window.matchMedia("(max-width: 899px)").matches; }
  function phone() { return window.matchMedia("(max-width: 639px)").matches; }

  function renderBar() {
    var nav = $("nav-btn");
    var back = phone() && view === "read";
    nav.innerHTML = back ? UI.back : UI.menu;
    nav.setAttribute("aria-label", back ? t("nav.back") : t("nav.folders"));
    nav.title = nav.getAttribute("aria-label");
    nav.hidden = !narrow() && !back;
    var acct = curAcct();
    var f = acct && currentFolder();
    $("bar-title").textContent = uni ? t("uni.title") : (f ? folderLabel(f) : t("app"));
    var spin = Object.keys(busy).length > 0;
    $("refresh-btn").classList.toggle("spin", spin);
    $("refresh-btn").disabled = !acct;
    var net = $("net");
    var msg = !navigator.onLine ? t("net.offline") : (data.accounts.length && !relayUrl() ? t("net.norelay") : "");
    net.textContent = msg;
    net.hidden = !msg;
  }

  function currentFolder() {
    var acct = curAcct();
    if (!acct) return null;
    var list = folders[acct.id] || [];
    for (var i = 0; i < list.length; i++) if (list[i].name === prefs.folder) return list[i];
    return { name: prefs.folder, delim: "", flags: [] };
  }

  function renderSide() {
    var box = $("accts");
    box.innerHTML = "";
    if (uniOk()) {
      var ub = el("button", "folder uni-btn" + (uni ? " on" : ""));
      ub.type = "button";
      if (uni) ub.setAttribute("aria-current", "true");
      ub.appendChild(el("span", "folder-name", t("uni.title")));
      var un = uniUnseen();
      if (un > 0) ub.appendChild(el("span", "badge", un > 999 ? "999+" : String(un)));
      ub.addEventListener("click", openUnified);
      box.appendChild(ub);
    }
    data.accounts.forEach(function (acct) {
      var sec = el("section", "acct");
      var head = el("div", "acct-head");
      var av = el("span", "av sm", initial({ name: acct.name, addr: acct.email }));
      av.style.background = "hsl(" + hue(acct.email) + " 45% 42%)";
      head.appendChild(av);
      var nm = el("div", "acct-name");
      nm.appendChild(el("div", "acct-title", acct.name || acct.email));
      if (acct.name) nm.appendChild(el("div", "acct-mail", acct.email));
      head.appendChild(nm);
      var fb = el("button", "icon-btn small acct-fold");
      fb.type = "button";
      fb.innerHTML = UI.folder;
      fb.title = t("fold.title");
      fb.setAttribute("aria-label", t("fold.title") + ": " + acct.email);
      fb.addEventListener("click", function () { foldersDialog(acct); });
      head.appendChild(fb);
      sec.appendChild(head);
      if (needPass[acct.id]) {
        var pb = el("button", "pass-need");
        pb.type = "button";
        pb.innerHTML = UI.key;
        pb.appendChild(el("span", "", t("pass.need")));
        pb.addEventListener("click", function () { passDialog(acct); });
        sec.appendChild(pb);
      }
      var ul = el("ul", "folders");
      var list = folders[acct.id] || [{ name: "INBOX", delim: "", flags: [] }];
      list.forEach(function (f) {
        var li = el("li");
        var b = el("button", "folder");
        b.type = "button";
        var active = !uni && acct.id === (curAcct() && curAcct().id) && f.name === prefs.folder;
        if (active) { b.classList.add("on"); b.setAttribute("aria-current", "true"); }
        b.style.paddingLeft = (12 + folderDepth(f) * 14) + "px";
        b.appendChild(el("span", "folder-name", folderLabel(f)));
        if (f.unseen > 0) b.appendChild(el("span", "badge", f.unseen > 999 ? "999+" : String(f.unseen)));
        b.addEventListener("click", function () { openFolder(acct.id, f.name); });
        li.appendChild(b);
        ul.appendChild(li);
      });
      sec.appendChild(ul);
      box.appendChild(sec);
    });
    if (outbox.length) {
      var ob = el("button", "out-btn" + (outbox.some(function (r) { return r.err; }) ? " err" : ""));
      ob.type = "button";
      ob.innerHTML = UI.out;
      ob.appendChild(el("span", "", t("out.bar", { n: outbox.length })));
      ob.addEventListener("click", outboxDialog);
      box.appendChild(ob);
    }
    var add = $("add-acct");
    add.innerHTML = UI.plus;
    add.appendChild(el("span", "", t("acct.add")));
    add.hidden = data.accounts.length >= MAX_ACCTS;
  }

  function renderList() {
    var ul = $("list");
    var foot = $("list-foot");
    var acct = curAcct();
    ul.innerHTML = "";
    foot.innerHTML = "";
    var f = currentFolder();
    $("list-title").textContent = f ? folderLabel(f) : "";
    $("list-count").textContent = f && f.unseen > 0 ? t("list.count", { n: f.unseen }) : "";
    if (uni && !uniOk()) { uni = null; prefs.uni = 0; savePrefs(); }
    $("srch-btn").hidden = !!uni || !$("srch-bar").hidden;
    if (uni) {
      $("list-title").textContent = t("uni.title");
      var un = uniUnseen();
      $("list-count").textContent = un > 0 ? t("list.count", { n: un }) : "";
      sel = null;
      renderSelBar();
      renderUniList(ul, foot);
      return;
    }
    if (sel && cur) Object.keys(sel).forEach(function (u) { if (!findMsg(+u)) delete sel[u]; });
    renderSelBar();
    if (!acct || !cur) return;
    if (srchOn()) { renderSearchList(ul, foot); return; }
    var loading = !!busy["l|" + acct.id + "|" + cur.folder];
    if (!cur.msgs.length) {
      foot.appendChild(el("p", "hint", loading ? t("list.loading") :
        (lastErr ? errText(lastErr) : (cur.at ? t("list.empty") : t("list.never")))));
      if (!loading && lastErr) foot.appendChild(retryBtn(function () { refreshCurrent(true); }));
      return;
    }
    renderRows(ul, cur.msgs);
    if (lastErr && !loading) {
      var p = el("p", "hint err", errText(lastErr));
      foot.appendChild(p);
    }
    if (cur.more) {
      var ob = el("button", "older-btn", busy["l|" + acct.id + "|" + cur.folder + "|o"] ? t("list.loading") : t("list.older"));
      ob.type = "button";
      ob.addEventListener("click", loadOlder);
      foot.appendChild(ob);
    } else if (cur.msgs.length > 10) {
      foot.appendChild(el("p", "hint", t("list.end")));
    }
  }

  // Rows of a list; with "Group by conversation" one row per
  // conversation (its newest message, how many, unread when any is),
  // its older messages under it while it is open.
  function renderRows(ul, list) {
    var role = folderRole(currentFolder() || {});
    if (!prefs.threads || !TH || role === "drafts") { list.forEach(function (m) { ul.appendChild(listRow(m)); }); return; }
    TH.group(list).forEach(function (g) {
      if (g.msgs.length === 1) { ul.appendChild(listRow(g.msgs[0])); return; }
      var inIt = openMsg && g.msgs.some(function (m) { return m.uid === openMsg.uid; });
      var open = !!openThreads[g.key];
      ul.appendChild(listRow(g.msgs[0], { thread: g, open: open, active: inIt }));
      if (open) g.msgs.slice(1).forEach(function (m) { ul.appendChild(listRow(m, { child: true })); });
    });
  }
  function toggleThread(g, force) {
    var on = force !== undefined ? force : !openThreads[g.key];
    if (on) openThreads[g.key] = 1; else delete openThreads[g.key];
  }

  function listRow(m, o) {
    o = o || {};
    var g = o.thread || null;
    var li = el("li");
    var b = el("button", "row" + (o.child ? " child" : "") + (g ? " thread" : ""));
    b.type = "button";
    b.setAttribute("data-uid", String(m.uid));
    if (o.acct) b.setAttribute("data-acct", o.acct);
    var unseen = g ? g.msgs.some(function (x) { return !hasFlag(x, "\\Seen"); }) : !hasFlag(m, "\\Seen");
    if (g) b.setAttribute("aria-expanded", o.open ? "true" : "false");
    if (unseen) b.classList.add("unseen");
    var isOpen = openMsg && openMsg.uid === m.uid && (!o.acct || openMsg.acct === o.acct);
    if (isOpen) { b.classList.add("on"); b.setAttribute("aria-current", "true"); }
    var role = folderRole(currentFolder() || {});
    var person = (role === "sent" || role === "drafts") ? (m.to[0] || m.from) : m.from;
    var gUids = g && !o.open ? g.msgs.map(function (x) { return x.uid; }) : [m.uid];
    var picked = sel && gUids.every(function (u) { return sel[u]; });
    if (sel) {
      var ck = el("span", "row-check" + (picked ? " on" : ""));
      ck.setAttribute("aria-hidden", "true");
      b.appendChild(ck);
      b.setAttribute("aria-pressed", picked ? "true" : "false");
    } else {
      var av = el("span", "av", initial(person));
      av.style.background = "hsl(" + hue(person && person.addr) + " 45% 42%)";
      av.setAttribute("aria-hidden", "true");
      b.appendChild(av);
    }
    var mid = el("span", "row-mid");
    var ua = o.acct && acctById(o.acct);
    if (ua) {
      var stripe = el("span", "row-acct");
      stripe.style.background = "hsl(" + hue(ua.email) + " 60% 50%)";
      stripe.setAttribute("aria-hidden", "true");
      b.appendChild(stripe);
      b.title = ua.email;
      mid.appendChild(el("span", "sr-only", ua.email + ": "));
    }
    var top = el("span", "row-top");
    top.appendChild(el("span", "row-from", who(person) || t("read.nosender")));
    if (g) {
      var cnt = el("span", "row-count", String(g.msgs.length));
      cnt.title = t("thr.count", { n: g.msgs.length });
      top.appendChild(cnt);
    }
    top.appendChild(el("time", "row-date", fmtListDate(m.date)));
    mid.appendChild(top);
    var bot = el("span", "row-bot");
    bot.appendChild(el("span", "row-subj", m.subj || t("read.nosubj")));
    if (m.att) { var ic = el("span", "row-ic"); ic.innerHTML = UI.clip; bot.appendChild(ic); }
    if (hasFlag(m, "\\Flagged")) { var st = el("span", "row-ic star"); st.innerHTML = UI.star; bot.appendChild(st); }
    mid.appendChild(bot);
    b.appendChild(mid);
    if (unseen) b.appendChild(el("span", "dot", ""));
    b.addEventListener("click", function () {
      if (b.dataset.swiped) { delete b.dataset.swiped; return; }
      if (sel) {
        if (gUids.length > 1) {
          if (!sel) sel = {};
          gUids.forEach(function (u) { if (picked) delete sel[u]; else sel[u] = 1; });
          renderList();
        } else toggleSel(m.uid);
        return;
      }
      if (g) {
        // first click opens the newest and shows the rest; again: folds it
        if (o.open && isOpen) { toggleThread(g, false); renderList(); return; }
        toggleThread(g, true);
      }
      if (o.acct) uniOpen(o.acct, m.uid); else openMessage(m.uid);
    });
    if (!o.acct) wireSwipe(b, m);
    li.appendChild(b);
    return li;
  }

  function retryBtn(fn) {
    var b = el("button", "link-btn", t("read.retry"));
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }

  function showWelcome() {
    var none = !data.accounts.length;
    $("welcome").hidden = !none;
    $("side").hidden = none;
    $("listp").hidden = none;
    $("read").hidden = none;
    $("settings-btn").hidden = none;
    $("refresh-btn").hidden = none;
    $("compose-btn").hidden = none;
  }

  function renderAll() {
    showWelcome();
    renderSide();
    renderList();
    renderReader();
    renderBar();
  }

  // ---------- All inboxes (2+ accounts) ----------
  // One list of every account's Inbox, from the heads each keeps on the
  // device, newest first, a stripe in the account's colour on each row.
  // Opening a message points cur at its account's Inbox, so the reader
  // and its buttons work as in that Inbox. Selection, swipe, search and
  // older pages stay in each account's own Inbox.
  var UNI_MAX = 300;
  function uniOk() { return data.accounts.length >= 2; }
  function uniUnseen() {
    var n = 0;
    data.accounts.forEach(function (a) {
      (folders[a.id] || []).forEach(function (f) { if (f.name === "INBOX" && f.unseen > 0) n += f.unseen; });
    });
    return n;
  }
  function uniGroups() {
    if (!uni) return [];
    if (cur && cur.folder === "INBOX" && uni.recs[cur.acct]) uni.recs[cur.acct] = cur;
    var out = [];
    data.accounts.forEach(function (a) {
      var rec = uni.recs[a.id];
      if (!rec) return;
      var gs = prefs.threads && TH ? TH.group(rec.msgs) :
        rec.msgs.map(function (m) { return { key: "t" + m.uid, msgs: [m] }; });
      gs.forEach(function (g) { out.push({ key: a.id + ":" + g.key, msgs: g.msgs, acct: a.id }); });
    });
    out.sort(function (x, y) { return (y.msgs[0].date || 0) - (x.msgs[0].date || 0); });
    return out.slice(0, UNI_MAX);
  }
  function renderUniList(ul, foot) {
    var gs = uniGroups();
    var loading = data.accounts.some(function (a) { return busy["l|" + a.id + "|INBOX"]; });
    gs.forEach(function (g) {
      if (g.msgs.length === 1) { ul.appendChild(listRow(g.msgs[0], { acct: g.acct })); return; }
      var open = !!openThreads[g.key];
      ul.appendChild(listRow(g.msgs[0], { thread: g, open: open, acct: g.acct }));
      if (open) g.msgs.slice(1).forEach(function (m) { ul.appendChild(listRow(m, { child: true, acct: g.acct })); });
    });
    if (!gs.length) foot.appendChild(el("p", "hint", loading ? t("list.loading") : (uni.err ? errText(uni.err) : t("list.empty"))));
    else if (uni.err && !loading) foot.appendChild(el("p", "hint err", errText(uni.err)));
    if (gs.length && data.accounts.some(function (a) { return uni.recs[a.id] && uni.recs[a.id].more; })) {
      foot.appendChild(el("p", "hint", t("uni.older")));
    }
  }
  function openUnified() {
    if (!uniOk()) return Promise.resolve();
    prefs.uni = 1;
    prefs.folder = "INBOX";
    savePrefs();
    openMsg = null;
    lastErr = null;
    cur = null;
    sel = null;
    flushMoves();
    if (srch || !$("srch-bar").hidden) closeSearch();
    var mine = uni = { recs: {}, err: null, at: 0 };
    if (narrow()) setView("list");
    renderAll();
    return Promise.all(data.accounts.map(function (a) {
      return loadHeads(a.id, "INBOX").then(function (rec) { mine.recs[a.id] = rec; });
    })).then(function () {
      if (uni !== mine) return;
      var a = curAcct();
      cur = a ? mine.recs[a.id] || null : null;
      renderList();
      renderBar();
      return refreshUni(false);
    });
  }
  // the message's account becomes the current one (its Inbox)
  function uniOpen(acctId, uid) {
    if (!uni || !uni.recs[acctId]) return;
    prefs.acct = acctId;
    prefs.folder = "INBOX";
    savePrefs();
    cur = uni.recs[acctId];
    openMessage(uid);
  }
  function refreshUni(manual) {
    var mine = uni;
    if (!navigator.onLine || !relayUrl()) {
      if (manual) showToast(errText(new MailError(navigator.onLine ? "norelay" : "offline")));
      renderBar();
      return Promise.resolve();
    }
    mine.at = Date.now();
    var accts = data.accounts.filter(function (a) { return !needPass[a.id]; });
    var jobs = accts.map(function (a) {
      var before = (mine.recs[a.id] ? mine.recs[a.id].msgs : []).reduce(function (x, m) { return Math.max(x, m.uid); }, 0);
      return refreshFolder(a, "INBOX", false).then(function (rec) {
        if (uni !== mine) return null;
        mine.recs[a.id] = rec;
        if (cur && cur.acct === a.id && cur.folder === "INBOX") cur = rec;
        if (before && rec.msgs.some(function (m) { return m.uid > before; })) rulesSoon(a);
        renderList();
        return null;
      }, function (e) {
        if (e.code === "nopass") needPass[a.id] = 1;
        return e;
      });
    });
    renderList();
    renderBar();
    return Promise.all(jobs).then(function (errs) {
      errs = errs.filter(Boolean);
      if (uni !== mine) return;
      mine.err = errs[0] || null;
      backoff = jobs.length && errs.length === jobs.length ? Math.min(BACKOFF_MAX, backoff * 2) : REFRESH_MS;
      keepOpenValid();
      renderSide();
      renderList();
      renderBar();
      if (manual) showToast(errs.length ? errText(errs[0]) : t("toast.updated"));
    });
  }

  function openFolder(acctId, folder) {
    uni = null;
    prefs.uni = 0;
    prefs.acct = acctId;
    prefs.folder = folder;
    savePrefs();
    openMsg = null;
    lastErr = null;
    cur = null;
    sel = null;
    flushMoves();
    if (srch || !$("srch-bar").hidden) closeSearch();
    if (narrow()) setView("list");
    renderAll();
    var acct = acctById(acctId);
    return loadHeads(acctId, folder).then(function (rec) {
      if (prefs.acct !== acctId || prefs.folder !== folder) return;
      cur = rec;
      renderList();
      return refreshCurrent(false);   // resolves once the list is fresh (deep links wait for it)
    });
  }

  function refreshCurrent(manual) {
    if (uni) return refreshUni(manual);
    var acct = curAcct();
    if (!acct || !cur) return Promise.resolve();
    var folder = cur.folder;
    if (!navigator.onLine || !relayUrl()) {
      if (manual) showToast(errText(new MailError(navigator.onLine ? "norelay" : "offline")));
      renderBar();
      return Promise.resolve();
    }
    var topBefore = cur.msgs.reduce(function (a, m) { return Math.max(a, m.uid); }, 0);
    var p = refreshFolder(acct, folder, false);
    renderList();
    renderBar();
    return p.then(function (rec) {
      lastErr = null;
      if (topBefore && folder.toUpperCase() === "INBOX" && rec.msgs.some(function (m) { return m.uid > topBefore; })) rulesSoon(acct);
      backoff = REFRESH_MS;
      if (cur && cur.acct === acct.id && cur.folder === folder) {
        cur = rec;
        if (srchOn() && !srch.server) srch.msgs = localMatches(srch.q, srch.where);
        keepOpenValid();
      }
      renderList();
      renderBar();
      if (manual) showToast(t("toast.updated"));
    }, function (e) {
      lastErr = e;
      if (e.code === "nopass") needPass[acct.id] = 1;
      backoff = Math.min(BACKOFF_MAX, backoff * 2);
      renderSide();
      renderList();
      renderBar();
      if (manual) showToast(errText(e));
    });
  }

  // New Inbox mail and rules for this account: let the shell checker
  // (notify.js) run them now instead of at its next round, then show
  // the result. It only acts on mail above its own mark, so this ends.
  function rulesSoon(acct) {
    if (!(data.rules || []).some(function (r) { return r.on && r.acct === acct.id; })) return;
    var N = null;
    try { N = window.parent !== window ? window.parent.__orosMailNotify : null; } catch (e) {}
    if (!N || typeof N.check !== "function") return;
    N.check().then(function () {
      if (cur && cur.acct === acct.id && cur.folder.toUpperCase() === "INBOX") refreshCurrent(false);
    }, function () {});
  }

  function keepOpenValid() {
    if (!openMsg || !cur) return;
    var still = shown().some(function (m) { return m.uid === openMsg.uid; });
    if (!still && !openMsg.parsed) { openMsg = null; renderReader(); }
  }

  function loadOlder() {
    var acct = curAcct();
    if (!acct || !cur) return;
    var folder = cur.folder;
    var p = refreshFolder(acct, folder, true);
    renderList();
    p.then(function (rec) {
      if (cur && cur.acct === acct.id && cur.folder === folder) cur = rec;
      renderList();
    }, function (e) { showToast(errText(e)); renderList(); });
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(function () {
      if (document.visibilityState === "visible" && navigator.onLine && curAcct()) {
        tick++;
        if (tick % 5 === 0) refreshFolders(curAcct()).catch(function () {});
        flushOutbox();
        refreshCurrent(false);
      }
      scheduleRefresh();
    }, backoff);
  }

  // ---------- 8. UI: reader ----------
  function findMsg(uid) {
    if (!cur) return null;
    for (var i = 0; i < cur.msgs.length; i++) if (cur.msgs[i].uid === uid) return cur.msgs[i];
    if (srchOn()) for (var j = 0; j < srch.msgs.length; j++) if (srch.msgs[j].uid === uid) return srch.msgs[j];
    return null;
  }

  function openMessage(uid) {
    var acct = curAcct(), m = findMsg(uid);
    if (!acct || !m || !cur) return;
    var rec = cur;
    openMsg = { uid: uid, acct: acct.id, sum: m, parsed: null, err: null, loading: true };
    if (phone()) setView("read");
    renderList();
    renderReader();
    getSource(acct, rec.folder, rec.uidv, uid).then(function (raw) {
      if (!openMsg || openMsg.uid !== uid) return;
      openMsg.parsed = M.parseMessage(M.b64ToBin(raw));
      openMsg.loading = false;
      markSeen(acct, rec, m);
      renderList();
      renderReader();
    }, function (e) {
      if (!openMsg || openMsg.uid !== uid) return;
      openMsg.loading = false;
      openMsg.err = e;
      renderReader();
    });
  }

  function renderReader() {
    var empty = $("read-empty"), art = $("msg");
    if (!openMsg) {
      art.hidden = true;
      empty.hidden = false;
      empty.textContent = t("read.none");
      return;
    }
    empty.hidden = true;
    art.hidden = false;
    var m = openMsg.sum;
    $("msg-subj").textContent = m.subj || t("read.nosubj");
    var av = $("msg-av");
    av.textContent = initial(m.from);
    av.style.background = "hsl(" + hue(m.from.addr) + " 45% 42%)";
    var sender = $("msg-sender");
    sender.innerHTML = "";
    sender.appendChild(el("span", "who", m.from.name || m.from.addr || t("read.nosender")));
    if (m.from.name && m.from.addr) sender.appendChild(el("span", "addr", m.from.addr));
    var acct = curAcct();
    var mine = acct ? lowerAddr(acct.email) : "";
    function names(list) {
      return list.map(function (p) { return lowerAddr(p.addr) === mine ? t("read.me") : who(p); }).join(", ");
    }
    var to = $("msg-to");
    to.textContent = [m.to.length ? t("read.to", { list: names(m.to) }) : "",
                      m.cc.length ? t("read.cc", { list: names(m.cc) }) : ""].filter(Boolean).join(" · ");
    $("msg-date").textContent = fmtFullDate(m.date);
    $("msg-date").setAttribute("datetime", m.date ? new Date(m.date).toISOString() : "");
    var bars = $("msg-bars"), body = $("msg-body"), atts = $("msg-atts"), acts = $("msg-acts");
    acts.innerHTML = "";
    acts.hidden = true;
    bars.innerHTML = "";
    body.innerHTML = "";
    atts.innerHTML = "";
    atts.hidden = true;
    if (openMsg.loading) { body.appendChild(el("p", "hint pad", t("read.loading"))); return; }
    if (openMsg.err) {
      var off = openMsg.err.code === "offline-body";
      body.appendChild(el("p", "hint pad", off ? t("read.offline") : t("read.failed") + " " + errText(openMsg.err)));
      if (!off) body.appendChild(retryBtn(function () { openMessage(openMsg.uid); }));
      return;
    }
    var p = openMsg.parsed;
    renderTrust(p, m, sender, bars);
    acts.hidden = false;
    [["reply", "act.reply"], ["all", "act.all"], ["forward", "act.fwd"]].forEach(function (a) {
      acts.appendChild(button(t(a[1]), "small", function () { replyTo(a[0]); }));
    });
    var org = el("span", "org-acts");
    orgButtons(org, [openMsg.uid], true);
    acts.appendChild(org);
    renderIcs(p, bars);
    var useHtml = p.html !== null && !(prefs.plain && p.text !== null && !openMsg.forceHtml);
    var flagged = [];
    if (useHtml) flagged = renderHtml(p, m, bars, body);
    else {
      if (p.html !== null && prefs.plain) {
        var pb = el("div", "bar");
        pb.appendChild(el("span", "", t("read.plainOnly")));
        var hb = el("button", "link-btn", t("read.html"));
        hb.type = "button";
        hb.addEventListener("click", function () { openMsg.forceHtml = true; renderReader(); });
        pb.appendChild(hb);
        bars.appendChild(pb);
      }
      flagged = renderText(p.text !== null ? p.text : "", body);
    }
    renderLinkWarn(flagged || [], bars);
    renderAtts(p, atts);
  }

  // Sender check (trust.js): a badge when the receiving server verified
  // the sender, a warning bar when a check failed. Reads only headers.
  function renderTrust(p, m, sender, bars) {
    if (!TR || !p) return;
    var acct = curAcct();
    var v = TR.sender(p.headers, m.from, { hosts: acct ? [acct.imap && acct.imap.host, acct.smtp && acct.smtp.host] : [] });
    if (v.level === "ok") {
      var b = el("span", "trust-ok", "");
      b.innerHTML = UI.shield;
      b.appendChild(el("span", "", t("trust.ok")));
      b.title = t("trust.okTip", { dom: v.domain });
      sender.appendChild(b);
      return;
    }
    if (v.level !== "warn") return;
    var bar = el("div", "bar warn");
    bar.setAttribute("role", "alert");
    bar.appendChild(el("strong", "", t("trust.warn", { dom: v.claimed || v.domain || m.from.addr })));
    v.why.forEach(function (w) { bar.appendChild(el("span", "", t("trust." + w, { dom: v.domain, addr: m.from.addr }))); });
    bar.appendChild(el("span", "", t("trust.after")));
    bars.appendChild(bar);
  }

  function linkWhy(l) { return t("link." + l.code, { shown: l.shown, host: l.host }); }
  function renderLinkWarn(list, bars) {
    if (!list.length) return;
    var bar = el("div", "bar warn");
    bar.appendChild(el("strong", "", t("link.title", { n: list.length })));
    var ul = el("ul", "sus-list");
    list.forEach(function (l, i) {
      var li = el("li", "", linkWhy(l));
      if (i >= 3) li.hidden = true;
      ul.appendChild(li);
    });
    bar.appendChild(ul);
    if (list.length > 3) {
      var mb = el("button", "link-btn", t("link.more"));
      mb.type = "button";
      mb.addEventListener("click", function () {
        [].forEach.call(ul.children, function (li) { li.hidden = false; });
        mb.remove();
      });
      bar.appendChild(mb);
    }
    bars.appendChild(bar);
  }

  function renderText(text, box) {
    var pre = el("div", "plain"), flagged = [];
    M.splitLinks(text).forEach(function (seg) {
      if (!seg.href) { pre.appendChild(document.createTextNode(seg.t)); return; }
      var a = el("a", "", seg.t);
      a.href = seg.href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      pre.appendChild(a);
      var bad = TR ? TR.link(seg.t, seg.href) : null;
      if (bad) {
        a.className = "sus";
        a.title = linkWhy(bad);
        if (flagged.length < 50) flagged.push(bad);
      }
    });
    box.appendChild(pre);
    return flagged;
  }

  function dataUrl(att) {
    if (!/^image\/(png|jpe?g|gif|webp|bmp)$/.test(att.type)) return null;
    if (att.data.length > 5 * 1024 * 1024) return null;
    return "data:" + att.type + ";base64," + M.binToB64(att.data);
  }

  // Second wall: an iframe with sandbox (no scripts, opaque origin, no
  // forms) and a CSP that allows only inline style and data: images —
  // plus http(s) images once the reader allows them.
  function renderHtml(p, m, bars, body) {
    var cids = {};
    Object.keys(p.cids).forEach(function (c) { var u = dataUrl(p.cids[c]); if (u) cids[c] = u; });
    var sender = lowerAddr(m.from.addr);
    var remote = !!showImgFor[m.uid] || !!(sender && data.imgOk[sender]);
    var clean = window.orosMailSanitize(p.html, { remote: remote, cids: cids, linkCheck: TR ? TR.link : null });
    if (clean.blocked > 0 && !remote) {
      var bar = el("div", "bar");
      bar.appendChild(el("span", "", t("img.blocked")));
      var acts = el("span", "bar-acts");
      var b1 = el("button", "link-btn", t("img.show"));
      b1.type = "button";
      b1.addEventListener("click", function () { showImgFor[m.uid] = 1; renderReader(); });
      acts.appendChild(b1);
      if (sender) {
        var b2 = el("button", "link-btn", t("img.always", { who: m.from.name || sender }));
        b2.type = "button";
        b2.addEventListener("click", function () {
          data.imgOk[sender] = Date.now();
          data = mergeMail(data, data);
          saveData();
          renderReader();
        });
        acts.appendChild(b2);
      }
      bar.appendChild(acts);
      bars.appendChild(bar);
    }
    var csp = "default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:" +
              (remote ? " https: http:" : "") + "; form-action 'none'; frame-src 'none'";
    var doc = "<!DOCTYPE html><html><head><meta charset=\"utf-8\">" +
      "<meta http-equiv=\"Content-Security-Policy\" content=\"" + csp + "\">" +
      "<meta name=\"referrer\" content=\"no-referrer\"><base target=\"_blank\">" +
      "<style>html{background:#fff}body{margin:0;padding:14px 16px;font:15px/1.5 -apple-system,'Segoe UI',Roboto,Arial,sans-serif;" +
      "color:#1b1b1b;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}" +
      "pre{white-space:pre-wrap}blockquote{margin:0 0 0 8px;padding-left:10px;border-left:3px solid #ccc}</style>" +
      "</head><body>" + clean.html + "</body></html>";
    var fr = document.createElement("iframe");
    fr.className = "html-frame";
    fr.setAttribute("sandbox", "allow-popups allow-popups-to-escape-sandbox");
    fr.setAttribute("referrerpolicy", "no-referrer");
    fr.setAttribute("title", m.subj || t("read.nosubj"));
    fr.srcdoc = doc;
    body.appendChild(fr);
    return clean.links || [];
  }

  function renderAtts(p, box) {
    var list = p.attachments.filter(function (a) { return !(a.inline && a.cid && /^image\//.test(a.type)); });
    if (!list.length) return;
    box.hidden = false;
    box.appendChild(el("div", "atts-title", t("att.title")));
    var row = el("div", "atts");
    list.forEach(function (a) {
      var b = el("button", "att");
      b.type = "button";
      b.title = t("att.save", { name: a.name });
      b.setAttribute("aria-label", b.title);
      var ic = el("span", "att-ic");
      ic.innerHTML = UI.down;
      b.appendChild(ic);
      var tx = el("span", "att-tx");
      tx.appendChild(el("span", "att-name", a.name));
      tx.appendChild(el("span", "att-size", fmtSize(a.size)));
      b.appendChild(tx);
      b.addEventListener("click", function () { saveAttachment(a); });
      row.appendChild(b);
    });
    box.appendChild(row);
  }

  function dialogHost() {
    try {
      var d = window.parent && window.parent !== window ? window.parent.orosDialog : null;
      if (d && typeof d.saveFile === "function") return d;
    } catch (e) {}
    return null;
  }
  function saveAttachment(a) {
    var bytes = new Uint8Array(a.data.length);
    for (var i = 0; i < a.data.length; i++) bytes[i] = a.data.charCodeAt(i) & 0xff;
    var blob = new Blob([bytes], { type: "application/octet-stream" });
    var host = dialogHost();
    if (host) {
      host.saveFile({ blob: blob, filename: a.name, mime: "application/octet-stream" }).then(function (r) {
        if (!r || (!r.ok && r.mode !== "native")) showToast(t("toast.saveFail"));
      });
      return;
    }
    // Standalone run (no shell): plain download.
    var url = URL.createObjectURL(blob);
    var link = el("a");
    link.href = url;
    link.download = a.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 40000);
  }

  // Invitations (.ics): one card per event; Calendar gets a PREFILL
  // (BR-W8-6), Maps the place.
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function icsLocal(d) {
    if (!d) return null;
    if (d.allDay || !d.utc) return { ymd: d.y + "-" + pad2(d.mo) + "-" + pad2(d.d), hm: d.allDay ? "" : pad2(d.h) + ":" + pad2(d.mi), ms: new Date(d.y, d.mo - 1, d.d, d.h, d.mi).getTime() };
    var x = new Date(Date.UTC(d.y, d.mo - 1, d.d, d.h, d.mi));
    return { ymd: x.getFullYear() + "-" + pad2(x.getMonth() + 1) + "-" + pad2(x.getDate()),
             hm: pad2(x.getHours()) + ":" + pad2(x.getMinutes()), ms: x.getTime() };
  }
  function renderIcs(p, bars) {
    p.ics.forEach(function (text) {
      M.parseIcs(text).slice(0, 3).forEach(function (ev) {
        var st = icsLocal(ev.dtstart);
        if (!st) return;
        var card = el("div", "ics");
        card.appendChild(el("div", "ics-k", t("ics.title")));
        card.appendChild(el("div", "ics-title", ev.summary || t("read.nosubj")));
        var when = new Date(st.ms).toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long", year: "numeric" }) +
                   (st.hm ? " · " + st.hm : " · " + t("ics.allday"));
        card.appendChild(el("div", "ics-when", when));
        if (ev.location) card.appendChild(el("div", "ics-loc", ev.location));
        var acts = el("div", "ics-acts");
        var parent = null;
        try { parent = window.parent !== window ? window.parent : null; } catch (e) {}
        if (parent && typeof parent.__orosOpenCalendarNew === "function") {
          var cb = el("button", "dlg-btn primary", t("ics.cal"));
          cb.type = "button";
          cb.addEventListener("click", function () {
            var pay = { date: st.ymd, title: String(ev.summary || "").slice(0, 200) };
            if (st.hm) pay.start = st.hm;
            if (ev.location) pay.location = ev.location;
            if (ev.description) pay.note = ev.description;
            parent.__orosOpenCalendarNew(pay);
          });
          acts.appendChild(cb);
        }
        if (ev.location && parent && typeof parent.__orosOpenMapsQuery === "function") {
          var mb = el("button", "dlg-btn", t("ics.map"));
          mb.type = "button";
          mb.addEventListener("click", function () { parent.__orosOpenMapsQuery(ev.location, ev.summary || ""); });
          acts.appendChild(mb);
        }
        if (acts.firstChild) card.appendChild(acts);
        bars.appendChild(card);
      });
    });
  }

  // ---------- 9. Account dialog + settings ----------
  function field(form, id, label, type, value, attrs) {
    var lab = el("label", "dlg-lbl", label);
    lab.setAttribute("for", id);
    var inp = el("input");
    inp.id = id;
    inp.type = type || "text";
    inp.value = value || "";
    Object.keys(attrs || {}).forEach(function (k) { inp.setAttribute(k, attrs[k]); });
    form.appendChild(lab);
    form.appendChild(inp);
    return inp;
  }
  function portSelect(form, id, label, opts, value) {
    var lab = el("label", "dlg-lbl", label);
    lab.setAttribute("for", id);
    var sel = el("select");
    sel.id = id;
    opts.forEach(function (o) {
      var op = el("option", "", o[1]);
      op.value = String(o[0]);
      sel.appendChild(op);
    });
    sel.value = String(value);
    form.appendChild(lab);
    form.appendChild(sel);
    return sel;
  }

  function acctDialog(existing) {
    if (!existing && data.accounts.length >= MAX_ACCTS) { showToast(t("err.max", { n: MAX_ACCTS })); return; }
    var dlg = makeDialog("ml-acct");
    dlg.classList.add("wide");
    dlg.appendChild(el("div", "dlg-title", t(existing ? "dlg.editTitle" : "dlg.acctTitle")));
    var form = el("form");
    form.method = "dialog";
    form.noValidate = true;
    var fName = field(form, "ml-name", t("dlg.name"), "text", existing ? existing.name : "", { maxlength: "80", autocomplete: "name" });
    var fMail = field(form, "ml-email", t("dlg.email"), "email", existing ? existing.email : "", { maxlength: "254", autocomplete: "email", inputmode: "email" });
    var fPass = field(form, "ml-pass", t("dlg.pass"), "password", "", { maxlength: "512", autocomplete: "current-password" });
    if (existing) fPass.placeholder = t("dlg.passKeep");
    var hint = el("p", "dlg-hint");
    form.appendChild(hint);
    var sigLab = el("div", "dlg-lbl", t("dlg.sig"));
    sigLab.id = "ml-sig-lbl";
    var sigEd = richEditor(existing ? sigHtmlOf(existing) : "", "ml-sig", t("dlg.sig"), true);
    sigEd.area.classList.add("sig");
    form.appendChild(sigLab);
    form.appendChild(sigEd.box);
    form.appendChild(el("p", "dlg-hint", t("dlg.sigHint")));

    var det = el("details", "srv");
    det.appendChild(el("summary", "", t("dlg.server")));
    var fImap = field(det, "ml-imap", t("dlg.imap"), "text", existing ? existing.imap.host : "", { maxlength: "253", autocapitalize: "off", spellcheck: "false" });
    var fPort = portSelect(det, "ml-port", t("dlg.port"), [[993, "993 · SSL/TLS"], [143, "143 · STARTTLS"]], existing ? existing.imap.port : 993);
    var fUser = field(det, "ml-user", t("dlg.user"), "text", existing ? existing.imap.user : "", { maxlength: "320", autocapitalize: "off", spellcheck: "false" });
    var fSmtp = field(det, "ml-smtp", t("dlg.smtp"), "text", existing && existing.smtp ? existing.smtp.host : "", { maxlength: "253", autocapitalize: "off", spellcheck: "false" });
    var fSport = portSelect(det, "ml-sport", t("dlg.port"), [[465, "465 · SSL/TLS"], [587, "587 · STARTTLS"]], existing && existing.smtp ? existing.smtp.port : 465);
    det.appendChild(el("p", "dlg-hint", t("dlg.smtpNote")));
    form.appendChild(det);

    var fRelay = null;
    if (!relayUrl()) {
      fRelay = field(form, "ml-relay", t("dlg.relay"), "url", "", { maxlength: "300", placeholder: "https://", autocapitalize: "off", spellcheck: "false" });
      form.appendChild(el("p", "dlg-hint", t("dlg.relayHint")));
    }
    form.appendChild(el("p", "dlg-hint dim", t("dlg.passDevice")));
    var errP = el("p", "dlg-err");
    errP.setAttribute("role", "alert");
    form.appendChild(errP);

    var touched = { imap: !!existing, user: !!existing, smtp: !!existing };
    fImap.addEventListener("input", function () { touched.imap = true; });
    fUser.addEventListener("input", function () { touched.user = true; });
    fSmtp.addEventListener("input", function () { touched.smtp = true; });
    function applyPreset() {
      var pre = presetFor(fMail.value);
      hint.textContent = "";
      if (!pre) return;
      if (pre.oauth) { hint.textContent = t("dlg.oauth"); return; }
      if (!touched.imap) { fImap.value = pre.imap; fPort.value = "993"; }
      if (!touched.smtp) { fSmtp.value = pre.smtp; fSport.value = String(pre.sp); }
      if (!touched.user) fUser.value = fMail.value.trim();
      if (pre.svc) hint.textContent = t("dlg.appPass", { svc: pre.svc });
      else if (pre.generic) hint.textContent = t("dlg.generic", { domain: pre.generic });
    }
    fMail.addEventListener("input", applyPreset);
    if (!existing) applyPreset();

    var acts = el("div", "dlg-actions");
    if (existing) {
      var rm = button(t("dlg.remove"), "danger", function () { dlg.close(); removeDialog(existing); });
      acts.appendChild(rm);
    }
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    var ok = button(t(existing ? "dlg.save" : "dlg.connect"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      errP.textContent = "";
      var email = normEmail(fMail.value);
      var host = normHost(fImap.value);
      var pass = fPass.value;
      if (!email || (!pass && !existing) || !fImap.value.trim()) { errP.textContent = t("err.fields"); return; }
      if (!host) { errP.textContent = t("err.host"); return; }
      var dup = data.accounts.some(function (a) {
        return (!existing || a.id !== existing.id) && lowerAddr(a.email) === lowerAddr(email) && a.imap.host === host;
      });
      if (dup) { errP.textContent = t("err.dup"); return; }
      if (fRelay) {
        var ru = normRelayUrl(fRelay.value);
        if (!ru) { errP.textContent = t("err.relayUrl"); return; }
        data.relay = { url: ru, m: Math.max(Date.now(), data.relay.m + 1) };
      }
      var acct = {
        id: existing ? existing.id : newId(),
        m: existing ? Math.max(Date.now(), existing.m + 1) : Date.now(),
        name: fName.value, email: email,
        imap: { host: host, port: +fPort.value, user: fUser.value.trim() || email },
        sig: "", sigHtml: ""
      };
      var sg = sigEd.get(false);
      acct.sig = sg.text.slice(0, MAX_SIG);
      if (sg.rich && sg.html.length <= MAX_SIG_HTML) acct.sigHtml = sg.html;
      var smtpHost = normHost(fSmtp.value);
      if (smtpHost) acct.smtp = { host: smtpHost, port: +fSport.value, user: fUser.value.trim() || email };
      var n = normAccount(acct);
      if (!n) { errP.textContent = t("err.host"); return; }
      var serverChanged = !existing || existing.imap.host !== n.imap.host || existing.imap.port !== n.imap.port ||
                          existing.imap.user !== n.imap.user;
      var needCheck = !!pass || serverChanged;
      var es = existing && existing.smtp;
      var smtpChanged = !!n.smtp && (!es || es.host !== n.smtp.host || es.port !== n.smtp.port || es.user !== n.smtp.user);
      var needSmtp = !!n.smtp && (!!pass || smtpChanged);
      ok.disabled = true;
      ok.textContent = t("dlg.checking");
      // IMAP login first, then (when it is new or changed) the SMTP login.
      var check = needCheck || needSmtp
        ? (pass ? Promise.resolve(pass) : loadPass(n.id)).then(function (pw) {
            if (!pw) throw new MailError("nopass");
            return (needCheck ? call("check", n, {}, pw) : Promise.resolve()).then(function () {
              if (!needSmtp) return;
              return call("smtpcheck", n, { smtp: true }, pw).catch(function (e) {
                throw new MailError("smtpfail", errText(e));
              });
            }).then(function () { return pw; });
          })
        : Promise.resolve(null);
      check.then(function (pw) {
        return (pw && pass ? savePass(n.id, pw) : Promise.resolve()).then(function () {
          data.accounts = data.accounts.filter(function (a) { return a.id !== n.id; }).concat([n]);
          data = mergeMail(data, data);
          saveData();
          delete needPass[n.id];
          dlg.close();
          showToast(t(existing ? "toast.saved" : "toast.added"));
          if (!existing || serverChanged) {
            if (existing) { delete folders[n.id]; idbDelPrefix("heads", n.id + "|").catch(function () {}); }
            refreshFolders(n).catch(function () {});
            openFolder(n.id, "INBOX");
          } else renderAll();
        });
      }).catch(function (err) {
        ok.disabled = false;
        ok.textContent = t(existing ? "dlg.save" : "dlg.connect");
        errP.textContent = errText(err);
      });
    });
    dlg.appendChild(form);
    document.body.appendChild(dlg);
    dlg.showModal();
    (existing ? fPass : fMail).focus();
  }

  function passDialog(acct) {
    var dlg = makeDialog("ml-pass-dlg");
    dlg.appendChild(el("div", "dlg-title", t("pass.title", { email: acct.email })));
    dlg.appendChild(el("p", "dlg-hint", t("pass.text")));
    var form = el("form");
    form.method = "dialog";
    var inp = field(form, "ml-pass2", t("dlg.pass"), "password", "", { maxlength: "512", autocomplete: "current-password" });
    var errP = el("p", "dlg-err");
    errP.setAttribute("role", "alert");
    form.appendChild(errP);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    var ok = button(t("dlg.connect"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var pw = inp.value;
      if (!pw) { errP.textContent = t("err.fields"); return; }
      ok.disabled = true;
      ok.textContent = t("dlg.checking");
      call("check", acct, {}, pw).then(function () { return savePass(acct.id, pw); }).then(function () {
        delete needPass[acct.id];
        dlg.close();
        if (narrow()) setView("list");
        refreshFolders(acct).catch(function () {});
        if (curAcct() && curAcct().id === acct.id) refreshCurrent(false);
        renderSide();
      }, function (err) {
        ok.disabled = false;
        ok.textContent = t("dlg.connect");
        errP.textContent = errText(err);
      });
    });
    dlg.appendChild(form);
    document.body.appendChild(dlg);
    dlg.showModal();
    inp.focus();
  }

  function removeDialog(acct) {
    var dlg = makeDialog("ml-rm");
    dlg.appendChild(el("div", "dlg-title", t("dlg.remove")));
    dlg.appendChild(el("p", "dlg-text", t("dlg.removeQ", { name: acct.email })));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    acts.appendChild(button(t("dlg.removeOk"), "danger", function () {
      dlg.close();
      data.tombs[acct.id] = Math.max(Date.now(), acct.m);
      data = mergeMail(data, data);
      saveData();
      forgetAccount(acct.id);
      showToast(t("toast.removed"));
      afterAccountsChanged();
    }));
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  // Drops this device's password and cache of an account.
  function forgetAccount(id) {
    dropPass(id);
    delete folders[id];
    delete needPass[id];
    idbDel("folders", id).catch(function () {});
    idbDelPrefix("heads", id + "|").catch(function () {});
    idbDelPrefix("bodies", id + "|").catch(function () {});
    outbox.filter(function (r) { return r.draft.acct === id; }).forEach(function (r) { dropOut(r.id); });
  }

  function afterAccountsChanged() {
    if (!acctById(prefs.acct)) {
      var first = data.accounts[0];
      if (first) { openFolder(first.id, "INBOX"); return; }
      prefs.acct = null;
      prefs.folder = "INBOX";
      savePrefs();
      cur = null;
      openMsg = null;
    }
    renderAll();
  }

  function settingsDialog() {
    var dlg = makeDialog("ml-set");
    dlg.classList.add("wide");
    dlg.appendChild(el("div", "dlg-title", t("set.title")));
    dlg.appendChild(el("div", "dlg-lbl", t("set.accounts")));
    var ul = el("ul", "set-accts");
    data.accounts.forEach(function (a) {
      var li = el("li");
      var tx = el("div", "set-acct");
      tx.appendChild(el("div", "set-acct-name", a.name || a.email));
      tx.appendChild(el("div", "set-acct-mail", a.email + " · " + a.imap.host));
      li.appendChild(tx);
      li.appendChild(button(t("set.edit"), "small", function () { dlg.close(); acctDialog(a); }));
      ul.appendChild(li);
    });
    dlg.appendChild(ul);
    if (data.accounts.length < MAX_ACCTS) {
      dlg.appendChild(button(t("acct.add"), "small", function () { dlg.close(); acctDialog(null); }));
    }
    if (data.accounts.length) {
      dlg.appendChild(el("div", "dlg-lbl", t("rule.title")));
      dlg.appendChild(el("p", "dlg-hint", t("rule.hint")));
      var rbox = el("div");
      rulesList(rbox);
      dlg.appendChild(rbox);
      if ((data.rules || []).length < R.MAX_RULES) {
        dlg.appendChild(button(t("rule.add"), "small", function () { dlg.close(); ruleDialog(null); }));
      }
    }
    var form = el("form");
    form.method = "dialog";
    form.noValidate = true;
    var fRelay = field(form, "ml-relay2", t("set.relay"), "url", data.relay.url, { maxlength: "300", placeholder: DEFAULT_RELAY || "https://", autocapitalize: "off", spellcheck: "false" });
    form.appendChild(el("p", "dlg-hint", t("dlg.relayHint")));
    var lab = el("label", "check");
    var cb = el("input");
    cb.type = "checkbox";
    cb.checked = !!prefs.plain;
    lab.appendChild(cb);
    lab.appendChild(el("span", "", t("set.plain")));
    form.appendChild(lab);
    var labT = el("label", "check");
    var cbT = el("input");
    cbT.type = "checkbox";
    cbT.checked = !!prefs.threads;
    labT.appendChild(cbT);
    labT.appendChild(el("span", "", t("set.threads")));
    form.appendChild(labT);
    var errP = el("p", "dlg-err");
    errP.setAttribute("role", "alert");
    form.appendChild(errP);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("set.close"), "", function () { dlg.close(); }));
    var ok = button(t("dlg.save"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var ru = normRelayUrl(fRelay.value);
      if (ru === null || (!ru && !DEFAULT_RELAY && data.accounts.length)) { errP.textContent = t("err.relayUrl"); return; }
      if (ru !== data.relay.url) {
        data.relay = { url: ru, m: Math.max(Date.now(), data.relay.m + 1) };
        data = mergeMail(data, data);
        saveData();
      }
      prefs.plain = cb.checked ? 1 : 0;
      prefs.threads = cbT.checked ? 1 : 0;
      savePrefs();
      dlg.close();
      showToast(t("toast.saved"));
      renderAll();
      refreshCurrent(false);
    });
    dlg.appendChild(form);
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  // ---------- 9b. Compose, send, outbox ----------
  // compose.js builds the message in the browser; the relay only
  // passes it to the account's SMTP server and files a copy in Sent.
  // Written offline (or the relay unreachable) → the Outbox: device-
  // local IndexedDB, never synced, sent by itself when online. A send
  // that failed for another reason stays there until "Send now".
  var C = window.orosMailCompose;
  var outbox = [];          // [{ id, at, draft, err }] oldest first
  var editingOut = null;    // outbox id open in the compose dialog
  var flushing = false;

  function loadOutbox() {
    return idb("outbox", "readonly", function (s) { return s.getAll(); }).then(function (rows) {
      outbox = (rows || []).filter(function (r) { return r && typeof r.id === "string" && r.draft; })
        .sort(function (a, b) { return a.at - b.at; });
    }).catch(function () { outbox = []; });
  }
  function dropOut(id) {
    outbox = outbox.filter(function (r) { return r.id !== id; });
    renderSide();
    return idbDel("outbox", id).catch(function () {});
  }
  function queueDraft(d) {
    if (outbox.length >= OUT_MAX) return Promise.reject(new MailError("outfull"));
    var rec = { id: newId(), at: Date.now(), draft: d, err: "" };
    return idbPut("outbox", rec.id, rec).then(function () { outbox.push(rec); renderSide(); });
  }

  // The account's Sent folder, by role. Gmail files sent mail by
  // itself, so no copy there (it would show twice).
  function sentFolder(acct) {
    if (/(^|\.)gmail\.com$/.test(acct.smtp.host)) return "";
    var list = folders[acct.id] || [];
    for (var i = 0; i < list.length; i++) if (folderRole(list[i]) === "sent") return list[i].name;
    return "";
  }

  // draft: { acct, to[], cc[], bcc[], subject, text, inReplyTo, references }
  // → { copyFailed }
  function sendDraft(d) {
    var acct = acctById(d.acct);
    if (!acct) return Promise.reject(new MailError("noacct"));
    if (!acct.smtp) return Promise.reject(new MailError("nosmtp"));
    var rich = d.html ? RT.clean(d.html, { cid: true }) : null;   // data: pictures → inline parts
    var msg = C.build({ from: { name: acct.name, addr: acct.email }, to: d.to, cc: d.cc, bcc: d.bcc,
                        subject: d.subject, text: d.text, html: rich ? rich.html : "", inline: rich ? rich.inline : [],
                        inReplyTo: d.inReplyTo, references: d.references });
    if (msg.bin.length > MSG_MAX) return Promise.reject(new MailError("big"));
    var sent = sentFolder(acct);
    var args = { smtp: true, from: acct.email, rcpt: msg.rcpt, raw: C.b64(msg.bin) };
    if (sent) args.sent = sent;
    return call("send", acct, args).then(function (res) {
      if (sent && cur && cur.acct === acct.id && cur.folder === sent) refreshCurrent(false);
      return { copyFailed: !!sent && !(res && res.appended) };
    });
  }
  function sendErrText(e) {
    if (e && (e.code === "too-big" || e.code === "big")) return t("err.big");
    if (e && e.code === "timeout") return t("cmp.timeout");
    return errText(e);
  }
  // Only "could not reach the relay" waits for the network; anything
  // else (refused, timed out: maybe sent) needs the person.
  function waitsForNet(e) { return e && (e.code === "offline" || e.code === "network"); }

  function flushOutbox() {
    if (flushing || !navigator.onLine) return Promise.resolve();
    var list = outbox.filter(function (r) { return !r.err && r.id !== editingOut; });
    if (!list.length) return Promise.resolve();
    flushing = true;
    var n = 0;
    return list.reduce(function (p, r) {
      return p.then(function () {
        return sendDraft(r.draft).then(function () { n++; return dropOut(r.id); }, function (e) {
          if (waitsForNet(e)) throw e;   // stop; the next "online" / timer tries again
          r.err = sendErrText(e);
          return idbPut("outbox", r.id, r).catch(function () {});
        });
      });
    }, Promise.resolve()).catch(function () {}).then(function () {
      flushing = false;
      renderSide();
      if (n) showToast(t("toast.outSent", { n: n }));
      if ($("ml-out")) outboxDialog();
    });
  }

  function outboxDialog() {
    var dlg = makeDialog("ml-out");
    dlg.classList.add("wide");
    dlg.appendChild(el("div", "dlg-title", t("out.title")));
    dlg.appendChild(el("p", "dlg-hint", t("out.text")));
    var ul = el("ul", "set-accts out-list");
    outbox.forEach(function (r) {
      var li = el("li");
      var tx = el("div", "set-acct");
      tx.appendChild(el("div", "set-acct-name", r.draft.subject || t("out.nosubj")));
      var to = [].concat(r.draft.to, r.draft.cc, r.draft.bcc).map(who).join(", ");
      tx.appendChild(el("div", "set-acct-mail", to));
      if (r.err) tx.appendChild(el("div", "dlg-err", t("out.failed", { msg: r.err })));
      li.appendChild(tx);
      var acts = el("div", "out-acts");
      acts.appendChild(button(t("out.send"), "small", function (ev) {
        var b = ev.currentTarget;
        b.disabled = true;
        sendDraft(r.draft).then(function (res) {
          dropOut(r.id);
          showToast(res.copyFailed ? t("toast.sentNoCopy") : t("toast.sent"));
          outboxDialog();
        }, function (e) {
          r.err = sendErrText(e);
          idbPut("outbox", r.id, r).catch(function () {});
          renderSide();
          outboxDialog();
        });
      }));
      acts.appendChild(button(t("out.edit"), "small", function () {
        dlg.close();
        openCompose({ acct: r.draft.acct, to: r.draft.to, cc: r.draft.cc, bcc: r.draft.bcc,
                      subject: r.draft.subject, text: r.draft.text, html: r.draft.html || "", inReplyTo: r.draft.inReplyTo,
                      references: r.draft.references, outId: r.id, noSig: true });
      }));
      acts.appendChild(button(t("out.del"), "small danger", function () { dropOut(r.id); outboxDialog(); }));
      li.appendChild(acts);
      ul.appendChild(li);
    });
    if (outbox.length) dlg.appendChild(ul);
    else dlg.appendChild(el("p", "dlg-text", t("out.empty")));
    var foot = el("div", "dlg-actions");
    foot.appendChild(button(t("set.close"), "", function () { dlg.close(); }));
    dlg.appendChild(foot);
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  function sigBlock(acct) { return acct && acct.sig ? "\n\n-- \n" + acct.sig : ""; }
  function sigHtmlOf(acct) { return acct ? (acct.sigHtml || RT.fromText(acct.sig || "")) : ""; }
  function richEditor(html, id, label, pictures) {
    var L = {};
    ["bar", "b", "i", "u", "ul", "ol", "link", "linkAsk", "color", "clear", "img", "imgBig"].forEach(function (k) { L[k] = t("rte." + k); });
    return RT.editor({ html: html, id: id, label: label, pictures: pictures, labels: L, onError: function (m) { showToast(m); } });
  }
  // The signature inside a message being written: its own block, so a
  // change of "From" can swap it. Contents always via clean().
  function sigNode(acct) {
    var d = document.createElement("div");
    d.setAttribute("data-sig", "1");
    d.innerHTML = RT.clean("-- <br>" + sigHtmlOf(acct), { cid: false }).html;
    return d;
  }
  function listText(list) { return (list || []).map(C.fmtInput).join(", "); }

  // HTML-only mail → text for quoting. DOMParser documents run no
  // scripts and load nothing.
  function htmlText(html) {
    var doc = new DOMParser().parseFromString(String(html || ""), "text/html");
    [].forEach.call(doc.querySelectorAll("script,style,head,title"), function (n) { n.remove(); });
    [].forEach.call(doc.querySelectorAll("br"), function (n) { n.replaceWith("\n"); });
    [].forEach.call(doc.querySelectorAll("p,div,li,tr,h1,h2,h3,h4,h5,h6,blockquote,pre,table"), function (n) { n.append("\n"); });
    return (doc.body ? doc.body.textContent : "").replace(/[ \t ]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  function replyTo(mode) {
    var acct = curAcct();
    if (!acct || !openMsg || !openMsg.parsed) return;
    var m = openMsg.sum, p = openMsg.parsed, h = p.headers || {};
    var rt = [];
    (h["reply-to"] || []).forEach(function (v) { rt = rt.concat(M.parseAddresses(M.decodeWords(v))); });
    var d = C.draftFrom({
      from: m.from, to: m.to, cc: m.cc, replyTo: rt, subject: m.subj, messageId: m.mid,
      references: (h.references || []).join(" "), date: m.date,
      text: p.text !== null ? p.text : htmlText(p.html)
    }, mode, acct.email, {
      wrote: function (date, w) { return t("cmp.wrote", { date: fmtFullDate(date), who: w }); },
      fwd: t("cmp.fwd"), from: t("cmp.from"), date: t("cmp.date"), subject: t("cmp.subject"), to: t("cmp.to"),
      fmtDate: fmtFullDate
    });
    openCompose({ acct: acct.id, to: d.to, cc: d.cc, subject: d.subject, quote: d.text,
                  inReplyTo: d.inReplyTo, references: d.references });
  }

  // init: { acct?, to[], cc[], bcc[], subject, text (above the
  // signature), quote (below it), inReplyTo, references, outId?, noSig? }
  function openCompose(init) {
    init = init || {};
    if (!data.accounts.length) { showToast(t("cmp.noacct")); acctDialog(null); return; }
    var acct = acctById(init.acct) || curAcct();
    var dirty = !!init.outId;
    editingOut = init.outId || null;
    var dlg = makeDialog("ml-compose", true);
    dlg.classList.add("wide", "compose");
    dlg.appendChild(el("div", "dlg-title", t("cmp.title")));
    var form = el("form");
    form.method = "dialog";
    form.noValidate = true;
    var fFrom = null;
    if (data.accounts.length > 1) {
      fFrom = portSelect(form, "mc-from", t("cmp.from"), data.accounts.map(function (a) {
        return [a.id, a.name ? a.name + " <" + a.email + ">" : a.email];
      }), acct.id);
    }
    var addrAttrs = { maxlength: "4000", inputmode: "email", autocomplete: "email", autocapitalize: "off", spellcheck: "false" };
    var fTo = field(form, "mc-to", t("cmp.to"), "text", listText(init.to), addrAttrs);
    var showCc = !!((init.cc && init.cc.length) || (init.bcc && init.bcc.length));
    var ccBtn = el("button", "link-btn cc-toggle", t("cmp.ccbcc"));
    ccBtn.type = "button";
    ccBtn.hidden = showCc;
    form.appendChild(ccBtn);
    var ccBox = el("div", "cc-box");
    ccBox.hidden = !showCc;
    var fCc = field(ccBox, "mc-cc", t("cmp.cc"), "text", listText(init.cc), addrAttrs);
    var fBcc = field(ccBox, "mc-bcc", t("cmp.bcc"), "text", listText(init.bcc), addrAttrs);
    form.appendChild(ccBox);
    ccBtn.addEventListener("click", function () { ccBox.hidden = false; ccBtn.hidden = true; fCc.focus(); });
    var fSubj = field(form, "mc-subj", t("cmp.subject"), "text", init.subject || "", { maxlength: "300" });
    var bLab = el("div", "dlg-lbl", t("cmp.body"));
    var ed = richEditor(init.html || "", "mc-body", t("cmp.body"), false);
    var fBody = ed.area;
    fBody.classList.add("cmp-body");
    if (!init.html) {
      // what to write, then the signature, then the quoted message
      fBody.innerHTML = RT.clean(RT.fromText(String(init.text || "").replace(/\n+$/, "")) || "<br>", { cid: false }).html;
      if (!init.noSig && (acct.sig || acct.sigHtml)) { fBody.appendChild(el("br")); fBody.appendChild(sigNode(acct)); }
      if (init.quote) {
        var qd = el("div");
        qd.innerHTML = "<br>" + RT.clean(RT.quoteHtml(init.quote), { cid: false }).html;
        fBody.appendChild(qd);
      }
    }
    bLab.addEventListener("click", function () { fBody.focus(); });
    form.appendChild(bLab);
    form.appendChild(ed.box);
    form.appendChild(el("p", "dlg-hint dim", t("cmp.hint")));
    var errP = el("p", "dlg-err");
    errP.setAttribute("role", "alert");
    form.appendChild(errP);

    form.addEventListener("input", function () { dirty = true; });
    if (fFrom) fFrom.addEventListener("change", function () {
      // swap the signature block for the new account's
      var a2 = acctById(fFrom.value);
      var old = fBody.querySelector("[data-sig]");
      var has = a2 && (a2.sig || a2.sigHtml);
      if (old && has) old.replaceWith(sigNode(a2));
      else if (old) old.remove();
      else if (has && !init.quote && !RT.toText(fBody).trim()) { fBody.appendChild(el("br")); fBody.appendChild(sigNode(a2)); }
    });

    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("cmp.discard"), "", function () { leave(); }));
    var ok = button(t("cmp.send"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);

    function finish(msg) {
      if (init.outId) dropOut(init.outId);
      dirty = false;
      dlg.close();
      showToast(msg);
    }
    function leave() {
      if (!dirty) { dlg.close(); return; }
      confirmDiscard(function () {
        if (init.outId) dropOut(init.outId);
        dirty = false;
        dlg.close();
      });
    }
    // Esc: same as Discard (asks when something was written)
    dlg.addEventListener("cancel", function (e) { e.preventDefault(); leave(); });
    dlg.addEventListener("close", function () { if (editingOut === init.outId) editingOut = null; });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      errP.textContent = "";
      var a = fFrom ? acctById(fFrom.value) : acct;
      if (!a) return;
      if (!a.smtp) { errP.textContent = t("err.nosmtp"); return; }
      var to = C.parseList(fTo.value), cc = C.parseList(fCc.value), bcc = C.parseList(fBcc.value);
      var bad = to.bad.concat(cc.bad, bcc.bad);
      if (bad.length) { errP.textContent = t("cmp.bad", { list: bad.join(", ").slice(0, 200) }); return; }
      var count = to.list.length + cc.list.length + bcc.list.length;
      if (!count) { errP.textContent = t("cmp.noRcpt"); fTo.focus(); return; }
      if (count > MAX_RCPT) { errP.textContent = t("cmp.many", { n: MAX_RCPT }); return; }
      var body = ed.get(false);
      var d = { acct: a.id, to: to.list, cc: cc.list, bcc: bcc.list,
                subject: fSubj.value.replace(/\s+/g, " ").trim().slice(0, 300), text: body.text.slice(0, 200000),
                html: body.rich ? body.html : "",
                inReplyTo: init.inReplyTo || "", references: init.references || "" };
      ok.disabled = true;
      ok.textContent = t("cmp.sending");
      function failed(err) {
        ok.disabled = false;
        ok.textContent = t("cmp.send");
        errP.textContent = sendErrText(err);
      }
      function queue() { return queueDraft(d).then(function () { finish(t("toast.queued")); }, failed); }
      if (!navigator.onLine) { queue(); return; }
      sendDraft(d).then(function (res) {
        finish(res.copyFailed ? t("toast.sentNoCopy") : t("toast.sent"));
      }, function (err) {
        if (waitsForNet(err)) queue();
        else failed(err);
      });
    });
    dlg.appendChild(form);
    document.body.appendChild(dlg);
    dlg.showModal();
    var first = !fTo.value ? fTo : (!fSubj.value ? fSubj : fBody);
    first.focus();
    if (first === fBody) {
      var rg = document.createRange();
      rg.setStart(fBody, 0);
      rg.collapse(true);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(rg);
    }
  }

  function confirmDiscard(yes) {
    var dlg = makeDialog("ml-discard");
    dlg.appendChild(el("p", "dlg-text", t("cmp.discardQ")));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("cmp.keep"), "", function () { dlg.close(); }));
    acts.appendChild(button(t("cmp.discard"), "danger", function () { dlg.close(); yes(); }));
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  // ---------- 9c. Organise: flags, move, archive, spam, delete ----------
  // Flags (star, read / unread) change the list at once and go to the
  // server; a failure puts them back. Moves (archive, spam, trash,
  // "Move to…") leave the list at once and reach the server after
  // UNDO_MS, so "Undo" just puts them back; leaving the page sends
  // them right away. Deleting in Trash / Spam (or with no Trash)
  // erases for good, after a question, without Undo. Moves need the
  // network: offline they are refused with a notice, never queued.
  var UNDO_MS = 6000;
  var pendingMoves = [];    // { commit } waiting for their Undo time
  var sel = null;           // selection mode: { uid: 1 }

  function roleFolder(acct, role) {
    var list = folders[acct.id] || [];
    for (var i = 0; i < list.length; i++) if (folderRole(list[i]) === role) return list[i].name;
    return "";
  }
  // Where a new top-level folder goes: under INBOX when the server
  // keeps its folders there (INBOX.Sent), else at the root.
  function newFolderName(acct, leaf) {
    var list = folders[acct.id] || [];
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      if (f.delim && f.name.toUpperCase().indexOf("INBOX" + f.delim) === 0) return "INBOX" + f.delim + leaf;
    }
    return leaf;
  }
  function online() {
    if (!navigator.onLine) { showToast(t("err.offline")); return false; }
    return true;
  }
  function msgsByUid(uids) {
    var out = [];
    uids.forEach(function (u) { var m = findMsg(u); if (m) out.push(m); });
    return out;
  }

  // kind: "star" | "unstar" | "read" | "unread"
  function setFlags(uids, kind) {
    var acct = curAcct(), rec = cur;
    if (!acct || !rec || !uids.length || !online()) return;
    var flag = kind === "star" || kind === "unstar" ? "\\Flagged" : "\\Seen";
    var on = kind === "star" || kind === "read";
    var before = {};
    var seenDelta = 0;
    msgsByUid(uids).forEach(function (m) {
      before[m.uid] = m.flags.slice();
      var has = hasFlag(m, flag);
      if (on && !has) { m.flags = m.flags.concat(flag); if (flag === "\\Seen") seenDelta--; }
      if (!on && has) { m.flags = m.flags.filter(function (f) { return f !== flag; }); if (flag === "\\Seen") seenDelta++; }
      if (flag === "\\Seen" && rec.pend) delete rec.pend[m.uid];   // no stale "read" mark going up later
    });
    if (seenDelta) adjustUnseen(acct.id, rec.folder, seenDelta);
    saveHeads(rec);
    renderList();
    if (openMsg) renderReader();
    call("flag", acct, { folder: rec.folder, uids: uids.slice(0, 500), add: on ? [flag] : [], remove: on ? [] : [flag] })
      .catch(function (e) {
        msgsByUid(uids).forEach(function (m) { if (before[m.uid]) m.flags = before[m.uid]; });
        if (seenDelta) adjustUnseen(acct.id, rec.folder, -seenDelta);
        saveHeads(rec);
        renderList();
        if (openMsg) renderReader();
        showToast(errText(e));
      });
  }

  // kind: "archive" | "spam" | "notspam" | "trash" | "move" (to)
  function moveMsgs(uids, kind, to) {
    var acct = curAcct(), rec = cur;
    if (!acct || !rec || !uids.length || !online()) return;
    var folder = rec.folder;
    var role = folderRole(currentFolder() || {});
    var dest = to;
    if (kind === "spam") dest = roleFolder(acct, "junk");
    if (kind === "notspam") dest = "INBOX";
    if (kind === "trash") dest = roleFolder(acct, "trash");
    var create = "";
    if (kind === "archive") {
      dest = roleFolder(acct, "archive");
      if (!dest) { dest = newFolderName(acct, "Archive"); create = dest; }
    }
    if (kind === "trash" && (!dest || role === "trash" || role === "junk")) { eraseDialog(uids); return; }
    if (!dest || dest === folder) return;
    var moved = msgsByUid(uids);
    if (!moved.length) return;
    var unseen = moved.filter(function (m) { return !hasFlag(m, "\\Seen"); }).length;
    var inRec = moved.filter(function (m) { return rec.msgs.indexOf(m) >= 0; });
    var sr = srchOn() ? srch : null;
    var inSr = sr ? moved.filter(function (m) { return sr.msgs.indexOf(m) >= 0; }) : [];
    rec.msgs = rec.msgs.filter(function (m) { return uids.indexOf(m.uid) < 0; });
    if (sr) sr.msgs = sr.msgs.filter(function (m) { return uids.indexOf(m.uid) < 0; });
    if (unseen) { adjustUnseen(acct.id, folder, -unseen); adjustUnseen(acct.id, dest, unseen); }
    if (openMsg && uids.indexOf(openMsg.uid) >= 0) {
      openMsg = null;
      if (phone()) setView("list");
    }
    sel = null;
    saveHeads(rec);
    renderList();
    renderReader();
    var done = false;
    function restore() {
      function back(list, add) {
        return list.concat(add.filter(function (m) {
          return !list.some(function (x) { return x.uid === m.uid; });
        })).sort(function (a, b) { return b.uid - a.uid; });
      }
      rec.msgs = back(rec.msgs, inRec);
      if (sr) sr.msgs = back(sr.msgs, inSr);
      if (unseen) { adjustUnseen(acct.id, folder, unseen); adjustUnseen(acct.id, dest, -unseen); }
      saveHeads(rec);
      renderList();
    }
    var job = {
      commit: function () {
        if (done) return;
        done = true;
        clearTimeout(timer);
        pendingMoves = pendingMoves.filter(function (j) { return j !== job; });
        (create ? call("create", acct, { folder: create }) : Promise.resolve()).then(function () {
          return call("move", acct, { folder: folder, uids: uids.slice(0, 500), to: dest });
        }).then(function () {
          if (create) refreshFolders(acct).catch(function () {});
        }, function (e) {
          restore();
          showToast(errText(e));
        });
      }
    };
    var timer = setTimeout(job.commit, UNDO_MS);
    pendingMoves.push(job);
    var label = { archive: "org.archived", spam: "org.spammed", notspam: "org.notspam", trash: "org.trashed", move: "org.moved" }[kind];
    undoToast(t(label, { n: moved.length }), function () {
      if (done) return;
      done = true;
      clearTimeout(timer);
      pendingMoves = pendingMoves.filter(function (j) { return j !== job; });
      restore();
    });
  }
  function flushMoves() { pendingMoves.slice().forEach(function (j) { j.commit(); }); }

  function eraseDialog(uids) {
    var acct = curAcct(), rec = cur;
    if (!acct || !rec) return;
    var dlg = makeDialog("ml-erase");
    dlg.appendChild(el("p", "dlg-text", t("org.eraseQ", { n: uids.length })));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    acts.appendChild(button(t("org.erase"), "danger", function () {
      dlg.close();
      if (!online()) return;
      var folder = rec.folder;
      call("expunge", acct, { folder: folder, uids: uids.slice(0, 500) }).then(function () {
        var gone = msgsByUid(uids);
        var unseen = gone.filter(function (m) { return !hasFlag(m, "\\Seen"); }).length;
        rec.msgs = rec.msgs.filter(function (m) { return uids.indexOf(m.uid) < 0; });
        if (srchOn()) srch.msgs = srch.msgs.filter(function (m) { return uids.indexOf(m.uid) < 0; });
        if (unseen) adjustUnseen(acct.id, folder, -unseen);
        if (openMsg && uids.indexOf(openMsg.uid) >= 0) { openMsg = null; if (phone()) setView("list"); }
        sel = null;
        saveHeads(rec);
        renderList();
        renderReader();
        showToast(t("org.erased", { n: gone.length }));
      }, function (e) { showToast(errText(e)); });
    }));
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  function moveDialog(uids) {
    var acct = curAcct();
    if (!acct || !cur) return;
    var dlg = makeDialog("ml-move");
    dlg.appendChild(el("div", "dlg-title", t("org.moveTitle")));
    var ul = el("ul", "move-list");
    (folders[acct.id] || []).forEach(function (f) {
      if (f.name === cur.folder) return;
      var li = el("li");
      var b = el("button", "folder", folderLabel(f));
      b.type = "button";
      b.style.paddingLeft = (12 + folderDepth(f) * 14) + "px";
      b.addEventListener("click", function () { dlg.close(); moveMsgs(uids, "move", f.name); });
      li.appendChild(b);
      ul.appendChild(li);
    });
    dlg.appendChild(ul);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  // ---------- folders: new, rename, delete ----------
  // Special folders (Inbox, Sent, Drafts, Trash, Spam, Archive…) stay
  // as they are. Renaming takes the subfolders along; deleting erases
  // the messages inside, after a question, and is refused while the
  // folder has subfolders. Rules that moved mail there follow a rename
  // and are turned off by a delete.
  function folderManaged(f) { return !folderRole(f); }
  function hasKids(acct, f) {
    return !!f.delim && (folders[acct.id] || []).some(function (x) { return x.name.indexOf(f.name + f.delim) === 0; });
  }
  function acctDelim(acct) {
    var list = folders[acct.id] || [];
    for (var i = 0; i < list.length; i++) if (list[i].delim) return list[i].delim;
    return "";
  }
  function foldersDialog(acct, mode, target) {
    var dlg = makeDialog("ml-folders");
    dlg.appendChild(el("div", "dlg-title", t("fold.title")));
    if (data.accounts.length > 1) dlg.appendChild(el("p", "dlg-hint", acct.email));
    var errP = el("p", "dlg-err");
    errP.setAttribute("role", "alert");
    var acts = el("div", "dlg-actions");
    function back() { foldersDialog(acct); }
    function run(op, args, after) {
      if (!online()) return;
      errP.textContent = "";
      [].forEach.call(dlg.querySelectorAll("button, input, select"), function (n) { n.disabled = true; });
      call(op, acct, args).then(function () {
        return refreshFolders(acct).catch(function () {});
      }).then(function () {
        after();
        renderSide();
        back();
      }, function (e) {
        [].forEach.call(dlg.querySelectorAll("button, input, select"), function (n) { n.disabled = false; });
        errP.textContent = errText(e);
      });
    }
    var list = folders[acct.id] || [];
    if (!mode) {
      var ul = el("ul", "set-accts fold-list");
      list.forEach(function (f) {
        var li = el("li");
        var tx = el("div", "set-acct");
        tx.style.paddingLeft = (folderDepth(f) * 14) + "px";
        tx.appendChild(el("div", "set-acct-name", folderLabel(f)));
        if (isInt(f.total)) tx.appendChild(el("div", "set-acct-mail", t("fold.count", { n: f.total })));
        li.appendChild(tx);
        if (folderManaged(f)) {
          [["pen", "fold.rename", "rename"], ["trash", "fold.delete", "delete"]].forEach(function (o) {
            var b = el("button", "icon-btn small");
            b.type = "button";
            b.innerHTML = UI[o[0]];
            b.title = t(o[1]);
            b.setAttribute("aria-label", t(o[1]) + ": " + folderLabel(f));
            b.addEventListener("click", function () { foldersDialog(acct, o[2], f); });
            li.appendChild(b);
          });
        }
        ul.appendChild(li);
      });
      dlg.appendChild(ul);
      acts.appendChild(button(t("set.close"), "", function () { dlg.close(); }));
      acts.appendChild(button(t("fold.new"), "primary", function () { foldersDialog(acct, "new"); }));
    } else if (mode === "delete") {
      var f0 = target;
      var kids = hasKids(acct, f0);
      dlg.appendChild(el("p", "dlg-text", kids ? t("fold.kids", { name: folderLabel(f0) }) :
        t(isInt(f0.total) && f0.total > 0 ? "fold.deleteQn" : "fold.deleteQ", { name: folderLabel(f0), n: f0.total })));
      acts.appendChild(button(t("dlg.cancel"), "", back));
      if (!kids) {
        acts.appendChild(button(t("fold.delete"), "danger", function () {
          run("delete", { folder: f0.name }, function () {
            afterFolderChange(acct, f0.name, null, f0.delim);
            showToast(t("fold.deleted", { name: folderLabel(f0) }));
          });
        }));
      }
    } else {
      var form = el("form");
      form.noValidate = true;
      var isNew = mode === "new";
      var inp = field(form, "ml-fold-name", t("fold.name"), "text", isNew ? "" : folderLeaf(target),
        { maxlength: "100", autocomplete: "off" });
      var where = null;
      if (isNew) {
        where = portSelect(form, "ml-fold-in", t("fold.in"), [["", t("fold.top")]].concat(list.filter(function (f) {
          return !(f.flags || []).some(function (x) { return /^\\noinferiors$/i.test(x); });
        }).map(function (f) { return [f.name, folderLabel(f)]; })), "");
      }
      form.appendChild(errP);
      var fa = el("div", "dlg-actions");
      fa.appendChild(button(t("dlg.cancel"), "", back));
      var ok = button(t(isNew ? "fold.create" : "fold.rename"), "primary", null);
      ok.type = "submit";
      fa.appendChild(ok);
      form.appendChild(fa);
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var leaf = inp.value.trim();
        var name, delim;
        if (isNew) {
          var parent = where.value ? findFolder(acct, where.value) : null;
          delim = parent ? parent.delim : acctDelim(acct);
          var bad = leafError(leaf, delim);
          if (bad) { errP.textContent = t(bad, { d: delim }); return; }
          name = parent ? childName(parent.name, parent.delim, leaf) : newFolderName(acct, M.utf7Encode(leaf));
        } else {
          delim = target.delim;
          var bad2 = leafError(leaf, delim);
          if (bad2) { errP.textContent = t(bad2, { d: delim }); return; }
          name = siblingName(target, leaf);
          if (name === target.name) { back(); return; }
        }
        if (findFolder(acct, name)) { errP.textContent = t("fold.exists"); return; }
        if (isNew) {
          run("create", { folder: name }, function () { showToast(t("fold.created", { name: leaf })); });
        } else {
          run("rename", { folder: target.name, to: name }, function () {
            afterFolderChange(acct, target.name, name, target.delim);
            showToast(t("fold.renamed", { name: leaf }));
          });
        }
      });
      dlg.appendChild(el("div", "dlg-title sub", isNew ? t("fold.new") : t("fold.rename") + ": " + folderLabel(target)));
      dlg.appendChild(form);
      document.body.appendChild(dlg);
      dlg.showModal();
      inp.focus();
      return;
    }
    dlg.appendChild(errP);
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
  }
  // after a rename (to) or a delete (to = null) of `from`
  function afterFolderChange(acct, from, to, delim) {
    var rr = retargetRules(data.rules, acct.id, from, to, delim, Date.now());
    if (rr.n) {
      data.rules = rr.rules;
      data = mergeMail(data, data);
      saveData();
    }
    var open = curAcct() && curAcct().id === acct.id && !uni ? renamedPath(prefs.folder, from, to === null ? from : to, delim) : null;
    if (open !== null) openFolder(acct.id, to === null ? "INBOX" : open);
  }

  // The organise buttons for `uids` (reader bar and selection bar).
  function orgButtons(box, uids, compact) {
    var acct = curAcct();
    if (!acct || !cur) return;
    var role = folderRole(currentFolder() || {});
    var ms = msgsByUid(uids);
    var anyUnread = ms.some(function (m) { return !hasFlag(m, "\\Seen"); });
    var allStar = ms.length && ms.every(function (m) { return hasFlag(m, "\\Flagged"); });
    function ib(icon, label, fn, cls) {
      var b = el("button", "org-btn" + (cls ? " " + cls : ""));
      b.type = "button";
      b.innerHTML = UI[icon];
      b.title = label;
      b.setAttribute("aria-label", label);
      if (!compact) b.appendChild(el("span", "org-lbl", label));
      b.addEventListener("click", fn);
      box.appendChild(b);
      return b;
    }
    if (role !== "archive") ib("archive", t("org.archive") + " (e)", function () { moveMsgs(uids, "archive"); });
    var erase = role === "trash" || role === "junk" || !roleFolder(acct, "trash");
    ib("trash", t(erase ? "org.erase" : "org.trash") + " (Del)", function () { moveMsgs(uids, "trash"); }, erase ? "danger" : "");
    if (role === "junk") ib("inbox", t("org.notspamBtn"), function () { moveMsgs(uids, "notspam"); });
    else if (roleFolder(acct, "junk")) ib("spam", t("org.spamBtn") + " (!)", function () { moveMsgs(uids, "spam"); });
    ib(allStar ? "star" : "starOff", t(allStar ? "org.unstar" : "org.star") + " (s)", function () { setFlags(uids, allStar ? "unstar" : "star"); }, allStar ? "on" : "");
    ib(anyUnread ? "open" : "unread", t(anyUnread ? "org.read" : "org.unread") + " (u)", function () { setFlags(uids, anyUnread ? "read" : "unread"); });
    ib("folder", t("org.move") + " (v)", function () { moveDialog(uids); });
    if (uids.length === 1 && ms[0] && ms[0].from && ms[0].from.addr) {
      ib("filter", t("rule.make"), function () { ruleDialog(null, { field: "from", has: lowerAddr(ms[0].from.addr) }); });
    }
  }

  // ---------- 9d. Rules (device filters) ----------
  // Stored in data.rules (synced); applied to new Inbox mail by the
  // shell checker (notify.js), so they run while orOS is open on any
  // device, Mail window or not. "Run now" applies one rule to the
  // loaded Inbox here, through the normal moves (with Undo).
  function ruleSummary(r) {
    var acct = acctById(r.acct);
    var f = acct ? findFolder(acct, r.to) : null;
    var field = t("rf." + r.field);
    if (r.act === "move") return t("rule.sumTo", { field: field, has: r.has, folder: f ? folderLabel(f) : r.to });
    return t("rule.sum", { field: field, has: r.has, act: t("ra." + r.act) });
  }
  function findFolder(acct, name) {
    var list = folders[acct.id] || [];
    for (var i = 0; i < list.length; i++) if (list[i].name === name) return list[i];
    return null;
  }
  function putRule(r) {
    data.rules = (data.rules || []).filter(function (x) { return x.id !== r.id; }).concat([r]);
    data = mergeMail(data, data);
    saveData();
  }
  function dropRule(r) {
    data.tombs[r.id] = Math.max(Date.now(), r.m + 1);
    data = mergeMail(data, data);
    saveData();
  }
  function rulesList(box) {
    box.innerHTML = "";
    var list = data.rules || [];
    if (!list.length) { box.appendChild(el("p", "dlg-hint", t("rule.none"))); return; }
    var ul = el("ul", "set-accts rule-list");
    list.forEach(function (r) {
      var li = el("li");
      var lab = el("label", "rule-on");
      var cb = el("input");
      cb.type = "checkbox";
      cb.checked = r.on;
      cb.setAttribute("aria-label", t("rule.on"));
      cb.addEventListener("change", function () {
        putRule(Object.assign({}, r, { on: cb.checked, m: Math.max(Date.now(), r.m + 1) }));
      });
      lab.appendChild(cb);
      li.appendChild(lab);
      var tx = el("div", "set-acct");
      tx.appendChild(el("div", "set-acct-name", ruleSummary(r)));
      var acct = acctById(r.acct);
      if (acct && data.accounts.length > 1) tx.appendChild(el("div", "set-acct-mail", acct.email));
      li.appendChild(tx);
      li.appendChild(button(t("set.edit"), "small", function () { closeDlg("ml-set"); ruleDialog(r); }));
      ul.appendChild(li);
    });
    box.appendChild(ul);
  }
  function closeDlg(id) { var d = $(id); if (d && d.open) d.close(); }

  // The editor. prefill: { field, has } (from "Create a rule…").
  function ruleDialog(rule, prefill) {
    if (!data.accounts.length) return;
    var acct0 = (rule && acctById(rule.acct)) || curAcct() || data.accounts[0];
    var dlg = makeDialog("ml-rule", true);
    dlg.appendChild(el("div", "dlg-title", t(rule ? "rule.edit" : "rule.new")));
    var form = el("form");
    form.method = "dialog";
    form.noValidate = true;
    var fAcct = null;
    if (data.accounts.length > 1) {
      fAcct = portSelect(form, "ml-r-acct", t("rule.acct"), data.accounts.map(function (a) { return [a.id, a.email]; }), acct0.id);
    }
    var fField = portSelect(form, "ml-r-field", t("rule.if"),
      ["from", "to", "subject", "any"].map(function (k) { return [k, t("rf." + k)]; }), rule ? rule.field : (prefill && prefill.field) || "from");
    var fHas = field(form, "ml-r-has", t("rule.has"), "text", rule ? rule.has : (prefill && prefill.has) || "",
      { maxlength: "200", autocapitalize: "off", spellcheck: "false" });
    form.appendChild(el("p", "dlg-hint", t("rule.hasHint")));
    var actLab = el("label", "dlg-lbl", t("rule.then"));
    actLab.setAttribute("for", "ml-r-act");
    form.appendChild(actLab);
    var fAct = el("select");
    fAct.id = "ml-r-act";
    form.appendChild(fAct);
    var folderLab = el("label", "dlg-lbl", t("rule.folder"));
    folderLab.setAttribute("for", "ml-r-to");
    form.appendChild(folderLab);
    var fTo = el("select");
    fTo.id = "ml-r-to";
    form.appendChild(fTo);
    var runLab = el("label", "check");
    var fRun = el("input");
    fRun.type = "checkbox";
    fRun.checked = !rule;
    runLab.appendChild(fRun);
    runLab.appendChild(el("span", "", t("rule.run")));
    form.appendChild(runLab);
    function acctNow() { return fAcct ? acctById(fAcct.value) : acct0; }
    // Act options for the chosen account: role folders become their own choices.
    function fillActs(keep) {
      var a = acctNow();
      fAct.innerHTML = "";
      var opts = [];
      ["junk", "trash", "archive"].forEach(function (role) {
        var name = roleFolder(a, role);
        if (name) opts.push(["to:" + name, t("ra." + (role === "junk" ? "spam" : role))]);
      });
      opts.push(["move", t("ra.move")], ["read", t("ra.read")], ["star", t("ra.star")]);
      opts.forEach(function (o) { var op = el("option", "", o[1]); op.value = o[0]; fAct.appendChild(op); });
      fTo.innerHTML = "";
      (folders[a.id] || []).forEach(function (f) {
        if (f.name.toUpperCase() === "INBOX") return;
        var op = el("option", "", "\u00a0".repeat(folderDepth(f) * 2) + folderLabel(f));
        op.value = f.name;
        fTo.appendChild(op);
      });
      if (keep && keep.act === "move") {
        var roleOpt = [].some.call(fAct.options, function (o) { return o.value === "to:" + keep.to; });
        fAct.value = roleOpt ? "to:" + keep.to : "move";
        fTo.value = keep.to;
      } else if (keep) fAct.value = keep.act;
      else fAct.value = fAct.options[0].value;
      syncTo();
    }
    function syncTo() {
      var show = fAct.value === "move";
      folderLab.hidden = fTo.hidden = !show;
    }
    fAct.addEventListener("change", syncTo);
    if (fAcct) fAcct.addEventListener("change", function () { fillActs(null); });
    fillActs(rule);
    var errP = el("p", "dlg-err");
    errP.setAttribute("role", "alert");
    form.appendChild(errP);
    var acts = el("div", "dlg-actions");
    if (rule) {
      acts.appendChild(button(t("rule.del"), "danger", function () {
        dropRule(rule);
        dlg.close();
        showToast(t("rule.deleted"));
      }));
    }
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    var ok = button(t("dlg.save"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var a = acctNow();
      var act = fAct.value, to;
      if (act.indexOf("to:") === 0) { to = act.slice(3); act = "move"; }
      else if (act === "move") to = fTo.value;
      var r = R.norm({ id: rule ? rule.id : newId(), m: Math.max(Date.now(), rule ? rule.m + 1 : 0), on: rule ? rule.on : true,
                       acct: a.id, field: fField.value, has: fHas.value, act: act, to: to });
      if (!r) { errP.textContent = t(fHas.value.trim() ? "rule.needFolder" : "rule.needHas"); return; }
      putRule(r);
      dlg.close();
      showToast(t("rule.saved"));
      if (fRun.checked) runRuleNow(r);
    });
    dlg.appendChild(form);
    document.body.appendChild(dlg);
    dlg.showModal();
    if (!fHas.value) fHas.focus();
  }

  // One rule on the loaded Inbox of its account (opens it first).
  function runRuleNow(r) {
    var acct = acctById(r.acct);
    if (!acct || !online()) return;
    var go = function () {
      if (!cur || cur.acct !== acct.id || cur.folder.toUpperCase() !== "INBOX") return;
      var p = R.plan([r], cur.msgs.map(function (m) { return { uid: m.uid, flags: m.flags, sum: m }; }), acct.id);
      var n = 0;
      if (p.flags["\\Seen"].length) { setFlags(p.flags["\\Seen"], "read"); n += p.flags["\\Seen"].length; }
      if (p.flags["\\Flagged"].length) { setFlags(p.flags["\\Flagged"], "star"); n += p.flags["\\Flagged"].length; }
      Object.keys(p.moves).forEach(function (to) { moveMsgs(p.moves[to], "move", to); n += p.moves[to].length; });
      if (!Object.keys(p.moves).length) showToast(t("rule.ran", { n: n }));
    };
    if (cur && cur.acct === acct.id && cur.folder.toUpperCase() === "INBOX") go();
    else openFolder(acct.id, "INBOX").then(go);
  }

  // ---------- 9e. Search ----------
  // Typing filters the loaded messages at once (device only). Enter or
  // "Search the whole folder on the server" asks the relay ("search":
  // IMAP UID SEARCH, so also the body with "Everywhere") and shows the
  // newest 100 hits. Results are not cached; the list's actions work on
  // them as on any message. Esc or × leaves search.
  var srch = null;   // { acct, folder, q, where, msgs, server: bool, total, busy, err }
  function srchOn() { return !!(srch && cur && srch.acct === cur.acct && srch.folder === cur.folder); }
  function shown() { return !cur ? [] : (srchOn() ? srch.msgs : cur.msgs); }
  // lower case without accents: "μαρια" finds "Μαρία"
  function fold(s) { return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }
  function localMatches(q, where) {
    var words = fold(q).split(/\s+/).filter(Boolean);
    return cur.msgs.filter(function (m) {
      var from = (m.from.name || "") + " " + (m.from.addr || "");
      var h = where === "from" ? from : (where === "subject" ? (m.subj || "") :
              from + " " + (m.subj || "") + " " + m.to.concat(m.cc).map(function (p) { return (p.name || "") + " " + p.addr; }).join(" "));
      h = fold(h);
      return words.every(function (w) { return h.indexOf(w) >= 0; });
    });
  }
  function openSearch() {
    var bar = $("srch-bar");
    if (!cur) return;
    sel = null;
    bar.hidden = false;
    $("srch-btn").hidden = true;
    $("srch-q").focus();
    $("srch-q").select();
  }
  function closeSearch() {
    srch = null;
    $("srch-bar").hidden = true;
    $("srch-btn").hidden = false;
    $("srch-q").value = "";
    keepOpenValid();
    renderList();
  }
  function runLocal() {
    var q = $("srch-q").value.trim(), where = $("srch-where").value;
    if (!q || !cur) { srch = null; renderList(); return; }
    srch = { acct: cur.acct, folder: cur.folder, q: q, where: where, msgs: localMatches(q, where), server: false, total: 0 };
    renderList();
  }
  function runServer() {
    var acct = curAcct();
    runLocal();
    if (!srch || !acct) return;
    if (!navigator.onLine || !relayUrl()) { srch.err = new MailError("offline"); renderList(); return; }
    var mine = srch;
    mine.busy = true;
    renderList();
    call("search", acct, { folder: mine.folder, q: mine.q.slice(0, 200), where: mine.where === "all" ? "text" : mine.where, limit: 100 })
      .then(function (res) {
        if (srch !== mine) return;
        mine.busy = false;
        mine.server = true;
        mine.total = res.total || 0;
        mine.msgs = (res.msgs || []).map(summarize).sort(function (a, b) { return b.uid - a.uid; })
          .map(function (m) { return findIn(cur.msgs, m.uid) || m; });   // the cached object when there is one
        renderList();
      }, function (e) {
        if (srch !== mine) return;
        mine.busy = false;
        mine.err = e;
        renderList();
      });
  }
  function findIn(list, uid) {
    for (var i = 0; i < list.length; i++) if (list[i].uid === uid) return list[i];
    return null;
  }
  function renderSearchList(ul, foot) {
    srch.msgs.forEach(function (m) { ul.appendChild(listRow(m)); });
    var info = el("div", "srch-info");
    if (srch.busy) info.appendChild(el("p", "hint", t("srch.busy")));
    else if (srch.server) {
      info.appendChild(el("p", "hint", srch.total ? t("srch.found", { n: srch.total }) : t("srch.none")));
      if (srch.total > srch.msgs.length) info.appendChild(el("p", "hint", t("srch.more", { shown: srch.msgs.length, n: srch.total })));
    } else {
      info.appendChild(el("p", "hint", srch.msgs.length ? t("srch.local", { n: srch.msgs.length }) : t("srch.none")));
      if (srch.err) info.appendChild(el("p", "hint err", srch.err.code === "offline" ? t("srch.offline") : errText(srch.err)));
      else {
        var b = el("button", "older-btn", t("srch.server"));
        b.type = "button";
        b.addEventListener("click", runServer);
        info.appendChild(b);
      }
    }
    if (srch.server && srch.err) info.appendChild(el("p", "hint err", errText(srch.err)));
    foot.appendChild(info);
  }
  function wireSearch() {
    var btn = $("srch-btn");
    btn.innerHTML = UI.search;
    btn.title = t("srch.btn") + " (/)";
    btn.setAttribute("aria-label", t("srch.btn"));
    btn.addEventListener("click", openSearch);
    var q = $("srch-q");
    q.placeholder = t("srch.ph");
    q.setAttribute("aria-label", t("srch.ph"));
    var wsel = $("srch-where");
    wsel.setAttribute("aria-label", t("srch.btn"));
    [["all", "srch.all"], ["from", "srch.from"], ["subject", "srch.subject"]].forEach(function (o) {
      var op = el("option", "", t(o[1]));
      op.value = o[0];
      wsel.appendChild(op);
    });
    var x = $("srch-x");
    x.innerHTML = UI.close;
    x.title = t("srch.close");
    x.setAttribute("aria-label", t("srch.close"));
    x.addEventListener("click", closeSearch);
    var deb = null;
    q.addEventListener("input", function () { clearTimeout(deb); deb = setTimeout(runLocal, 150); });
    wsel.addEventListener("change", function () { if (srch && srch.server) runServer(); else runLocal(); });
    q.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); clearTimeout(deb); runServer(); }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeSearch(); }
    });
  }

  // ---------- selection mode ----------
  function selUids() { return sel ? Object.keys(sel).map(Number) : []; }
  function toggleSel(uid) {
    if (!sel) sel = {};
    if (sel[uid]) delete sel[uid]; else sel[uid] = 1;
    renderList();
  }
  function renderSelBar() {
    var bar = $("sel-bar");
    bar.innerHTML = "";
    bar.hidden = !sel;
    $("sel-btn").hidden = !!sel || !!uni || !cur || !shown().length;
    $("sel-btn").textContent = t("org.select");
    if (!sel) return;
    var uids = selUids();
    var all = el("input");
    all.type = "checkbox";
    all.className = "sel-all";
    all.checked = !!(cur && shown().length && uids.length === shown().length);
    all.setAttribute("aria-label", t("org.all"));
    all.addEventListener("change", function () {
      sel = {};
      if (all.checked && cur) shown().forEach(function (m) { sel[m.uid] = 1; });
      renderList();
    });
    bar.appendChild(all);
    bar.appendChild(el("span", "sel-count", t("org.selected", { n: uids.length })));
    var acts = el("span", "sel-acts");
    if (uids.length) orgButtons(acts, uids, true);
    bar.appendChild(acts);
    var x = el("button", "org-btn");
    x.type = "button";
    x.innerHTML = UI.close;
    x.title = t("org.done");
    x.setAttribute("aria-label", t("org.done"));
    x.addEventListener("click", function () { sel = null; renderList(); });
    bar.appendChild(x);
  }

  // ---------- swipe (touch): right = archive, left = delete ----------
  function wireSwipe(btn, m) {
    var x0 = null, y0 = 0, dx = 0, id = null;
    btn.addEventListener("pointerdown", function (e) {
      if (e.pointerType !== "touch" || sel) return;
      x0 = e.clientX; y0 = e.clientY; dx = 0; id = e.pointerId;
    });
    btn.addEventListener("pointermove", function (e) {
      if (x0 === null || e.pointerId !== id) return;
      dx = e.clientX - x0;
      if (Math.abs(e.clientY - y0) > 30 && Math.abs(dx) < 30) { x0 = null; btn.style.transform = ""; return; }
      if (Math.abs(dx) > 12) btn.style.transform = "translateX(" + dx + "px)";
      btn.classList.toggle("swipe-r", dx > 80);
      btn.classList.toggle("swipe-l", dx < -80);
    });
    function end() {
      if (x0 === null) return;
      x0 = null;
      btn.style.transform = "";
      btn.classList.remove("swipe-r", "swipe-l");
      if (Math.abs(dx) > 80) {
        btn.dataset.swiped = "1";
        moveMsgs([m.uid], dx > 0 ? "archive" : "trash");
      }
    }
    btn.addEventListener("pointerup", end);
    btn.addEventListener("pointercancel", function () { x0 = null; btn.style.transform = ""; btn.classList.remove("swipe-r", "swipe-l"); });
  }

  // ---------- 10. Dialogs + toasts ----------
  function button(label, cls, fn) {
    var b = el("button", "dlg-btn" + (cls ? " " + cls : ""), label);
    b.type = "button";
    if (fn) b.addEventListener("click", fn);
    return b;
  }
  // keep: a click outside does not close it (compose: unsent text).
  function makeDialog(id, keep) {
    var stale = document.getElementById(id);
    if (stale) { parkToast(); stale.remove(); }
    var dlg = document.createElement("dialog");
    dlg.id = id;
    dlg.className = "mm-dlg";
    if (!keep) dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener("close", function () {
      parkToast();
      setTimeout(function () { dlg.remove(); }, 0);
    });
    return dlg;
  }

  function showToast(text) {
    try {
      var n = (window.parent && window.parent !== window && window.parent.orosNotifs) || null;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "mail", title: String(text) })) return;
    } catch (e) {}
    localToast(text);
  }

  // A notice with an Undo button (shell toast action, else our own).
  function undoToast(text, undo) {
    try {
      var n = (window.parent && window.parent !== window && window.parent.orosNotifs) || null;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "mail", title: String(text), action: { label: t("org.undo"), fn: undo } })) return;
    } catch (e) {}
    localToast(text, { label: t("org.undo"), fn: undo });
  }

  var toastTimer = null;
  function localToast(text, action) {
    var box = $("toast");
    if (!box) return;
    hostToast();
    box.textContent = text;
    box.classList.toggle("act", !!action);
    if (action) {
      var ub = el("button", "link-btn", action.label);
      ub.type = "button";
      ub.addEventListener("click", function () { box.classList.remove("show"); action.fn(); });
      box.appendChild(ub);
    }
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
    // j / k or arrows: next / previous message; Esc: back (phone)
    document.addEventListener("keydown", function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var tag = e.target && e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (document.querySelector("dialog[open]")) return;
      if (e.key === "Escape" && view !== "list" && narrow()) { e.preventDefault(); setView("list"); return; }
      // c: new message; r / a / f: reply, reply all, forward
      if (e.key === "c" && data.accounts.length) { e.preventDefault(); openCompose({}); return; }
      var act = { r: "reply", a: "all", f: "forward" }[e.key];
      if (act && openMsg && openMsg.parsed) { e.preventDefault(); replyTo(act); return; }
      // e archive, Del / # delete, ! spam, s star, u read / unread, v move
      var tgt = sel && selUids().length ? selUids() : (openMsg ? [openMsg.uid] : null);
      if (tgt) {
        var one = msgsByUid(tgt);
        var k = e.key;
        if (k === "e") { e.preventDefault(); moveMsgs(tgt, "archive"); return; }
        if (k === "Delete" || k === "#") { e.preventDefault(); moveMsgs(tgt, "trash"); return; }
        if (k === "!" && curAcct() && roleFolder(curAcct(), "junk")) { e.preventDefault(); moveMsgs(tgt, folderRole(currentFolder() || {}) === "junk" ? "notspam" : "spam"); return; }
        if (k === "s") { e.preventDefault(); setFlags(tgt, one.length && one.every(function (m) { return hasFlag(m, "\\Flagged"); }) ? "unstar" : "star"); return; }
        if (k === "u") { e.preventDefault(); setFlags(tgt, one.some(function (m) { return !hasFlag(m, "\\Seen"); }) ? "read" : "unread"); return; }
        if (k === "v") { e.preventDefault(); moveDialog(tgt); return; }
      }
      var dir = (e.key === "j" || e.key === "ArrowDown") ? 1 : ((e.key === "k" || e.key === "ArrowUp") ? -1 : 0);
      if (e.key === "/" && cur && !uni) { e.preventDefault(); openSearch(); return; }
      if (uni && dir) {
        e.preventDefault();
        var rows = [].slice.call(document.querySelectorAll("#list .row"));
        var at = -1;
        rows.forEach(function (r, i) { if (r.classList.contains("on")) at = i; });
        var nx = rows[Math.max(0, Math.min(rows.length - 1, at + dir))];
        if (nx && at !== rows.indexOf(nx)) {
          uniOpen(nx.getAttribute("data-acct"), +nx.getAttribute("data-uid"));
          var nr = document.querySelector('.row[data-acct="' + nx.getAttribute("data-acct") + '"][data-uid="' + nx.getAttribute("data-uid") + '"]');
          if (nr) { nr.focus(); nr.scrollIntoView({ block: "nearest" }); }
        }
        return;
      }
      var list = shown();
      if (!dir || !cur || !list.length) return;
      e.preventDefault();
      var idx = -1;
      if (openMsg) list.forEach(function (m, i) { if (m.uid === openMsg.uid) idx = i; });
      var next = list[Math.max(0, Math.min(list.length - 1, idx + dir))];
      if (next && (!openMsg || next.uid !== openMsg.uid)) {
        openMessage(next.uid);
        var row = document.querySelector('.row[data-uid="' + next.uid + '"]');
        if (row) { row.focus(); row.scrollIntoView({ block: "nearest" }); }
      }
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
    api.registerSlice("mail", sliceGet, sliceSet, STORAGE_KEY, mergeMail);
  }

  function sliceGet() { return mergeMail(data, data); }   // canonical copy (R26)

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.accounts)) return;
    var before = JSON.stringify(data);
    var hadIds = data.accounts.map(function (a) { return a.id; });
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = mergeMail(incoming, incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    if (JSON.stringify(data) === before) return;
    hadIds.forEach(function (id) { if (!acctById(id)) forgetAccount(id); });   // removed elsewhere
    data.accounts.forEach(function (a) {
      if (hadIds.indexOf(a.id) < 0) {
        loadPass(a.id).then(function (pw) { if (!pw) { needPass[a.id] = 1; renderSide(); } });
      }
    });
    afterAccountsChanged();
    if (openMsg) renderReader();
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      data = raw ? mergeMail(JSON.parse(raw), JSON.parse(raw)) : emptyData();
    } catch (e) { data = emptyData(); }
  }
  function saveData() {
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
        if (typeof p.acct === "string") prefs.acct = p.acct;
        if (typeof p.folder === "string" && p.folder.length <= 1000) prefs.folder = p.folder;
        prefs.plain = p.plain ? 1 : 0;
        prefs.threads = p.threads === 0 ? 0 : 1;
        prefs.uni = p.uni ? 1 : 0;
      }
    } catch (e) {}
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // ---------- 13. Wiring & boot ----------
  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
    document.title = t("app") + " · orOS";
    $("side").setAttribute("aria-label", t("nav.folders"));
    var rb = $("refresh-btn");
    rb.innerHTML = UI.refresh;
    rb.setAttribute("aria-label", t("btn.refresh"));
    rb.title = t("btn.refresh");
    var cb = $("compose-btn");
    cb.innerHTML = UI.pen;
    cb.setAttribute("aria-label", t("btn.compose"));
    cb.title = t("btn.compose") + " (c)";
    var sb = $("settings-btn");
    sb.innerHTML = UI.gear;
    sb.setAttribute("aria-label", t("btn.settings"));
    sb.title = t("btn.settings");
    $("wel-icon").innerHTML = UI.mail;
  }

  function wire() {
    $("nav-btn").addEventListener("click", function () {
      if (phone() && view === "read") setView("list");
      else setView(view === "side" ? "list" : "side");
    });
    $("scrim").addEventListener("click", function () { setView("list"); });
    $("refresh-btn").addEventListener("click", function () {
      var a = curAcct();
      if (a) refreshFolders(a).catch(function () {});
      refreshCurrent(true);
    });
    $("settings-btn").addEventListener("click", settingsDialog);
    $("compose-btn").addEventListener("click", function () { openCompose({}); });
    $("add-acct").addEventListener("click", function () { acctDialog(null); });
    $("wel-add").addEventListener("click", function () { acctDialog(null); });
    window.addEventListener("online", function () { renderBar(); flushOutbox(); refreshCurrent(false); });
    window.addEventListener("pagehide", flushMoves);
    $("sel-btn").addEventListener("click", function () { sel = {}; renderList(); });
    window.addEventListener("offline", renderBar);
    window.addEventListener("resize", function () {
      if (!narrow() && view === "side") setView("list");
      renderBar();
    });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible" && (uni ? Date.now() - uni.at > REFRESH_MS : cur && Date.now() - (cur.at || 0) > REFRESH_MS)) refreshCurrent(false);
    });
    wireKeyboard();
    wireSearch();
  }

  // Deep links (shell __orosOpenAt / __orosTakeTarget), one receiver:
  //  - universal search: { acct, folder, uid }. Opens the folder and,
  //    when the message is in its cached list, the message. Unknown
  //    account → no-op (returns false).
  //  - other apps (Reader…): { compose:{ to?, subject?, body? } } opens
  //    a prefilled draft, plain text; the person presses Send.
  // A dialog open (maybe with unsaved edits) → no-op (returns false).
  function openSearchTarget(target) {
    if (!target || typeof target !== "object" || document.querySelector("dialog[open]")) return false;
    var c = target.compose;
    if (c && typeof c === "object") {
      openCompose({
        to: C.parseList(typeof c.to === "string" ? c.to.slice(0, 2000) : "").list.slice(0, MAX_RCPT),
        subject: typeof c.subject === "string" ? c.subject.replace(/\s+/g, " ").trim().slice(0, 300) : "",
        text: typeof c.body === "string" ? c.body.slice(0, 20000) : ""
      });
      return true;
    }
    if (typeof target.acct !== "string" || typeof target.folder !== "string" || !target.folder ||
        typeof target.uid !== "number") return false;
    if (!acctById(target.acct)) return false;
    openFolder(target.acct, target.folder).then(function () {
      if (cur && cur.acct === target.acct && cur.folder === target.folder && findMsg(target.uid)) openMessage(target.uid);
    });
    return true;
  }
  window.__orosOpenAt = openSearchTarget;

  function boot() {
    load();
    loadPrefs();
    applyI18n();
    wire();
    registerSync();
    inheritPalette();
    watchPalette();
    setView("list");
    renderAll();
    var acct = curAcct();
    var pendingTarget = null;
    try {
      if (window.parent && window.parent !== window &&
          typeof window.parent.__orosTakeTarget === "function") {
        pendingTarget = window.parent.__orosTakeTarget("mail");
      }
    } catch (e) {}
    if (!acct) {
      if (pendingTarget && pendingTarget.compose) openSearchTarget(pendingTarget);   // → "add an account"
      return;
    }
    Promise.all(data.accounts.map(function (a) {
      return Promise.all([loadFolders(a), loadPass(a.id).then(function (pw) { if (!pw) needPass[a.id] = 1; })]);
    }).concat([loadOutbox()])).then(function () {
      renderSide();
      flushOutbox();
      data.accounts.forEach(function (a) { if (!needPass[a.id]) refreshFolders(a).catch(function () {}); });
      if (!(pendingTarget && openSearchTarget(pendingTarget))) {
        if (prefs.uni && uniOk()) openUnified();
        else openFolder(acct.id, prefs.acct === acct.id ? prefs.folder : "INBOX");
      }
      scheduleRefresh();
    });
  }

  boot();
})();
