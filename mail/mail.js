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
//   - deep link: __orosOpenAt("mail", { compose:{ to?, subject, body,
//     attach?: [{ name?, path } | { name, type?, b64 }] } }) opens a
//     prefilled draft (never sends by itself); path = a file on the
//     orOS disk (/internal/…), b64 = the file's bytes in base64
//   - deep link: __orosOpenAt("mail", { signature:{ html, text, name } })
//     from Email Signature: asks which account gets it (BR-MAIL-SIG)

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
  var DEFAULT_RELAY = "https://oros-mail-relay.koulaxizis.workers.dev";
  var PAGE          = 50;
  var KEEP_HEADS    = 500;              // per folder
  var KEEP_BODIES   = 200;              // messages
  var BODY_BUDGET   = 60 * 1024 * 1024; // bytes of cached sources
  var REFRESH_MS    = 2 * 60 * 1000;
  var BACKOFF_MAX   = 30 * 60 * 1000;
  var CALL_TIMEOUT  = 45000;
  var SEND_TIMEOUT  = 120000;
  var MAX_ACCTS     = 10;
  var MAX_TOMBS     = 200;
  var MAX_IMGOK     = 500;
  var MAX_RCPT      = 50;               // relay limit (SMTP_LIMITS.rcpts)
  var MSG_MAX       = 10 * 1024 * 1024 - 64 * 1024;   // built message bytes (relay takes 10 MB)
  var ATT_MAX       = 7 * 1024 * 1024;  // attached files together (base64 makes them ~1.37×)
  var OUT_MAX       = 50;               // outbox entries
  var MAX_SIG       = 1000;
  var M = window.orosMailMime;
  var TR = window.orosMailTrust;
  var R = window.orosMailRules;
  var RT = window.orosMailRich;
  var TH = window.orosMailThreads;
  var OB = window.orosMailOutbox;
  var PP = window.orosMailPeople;
  var SV = window.orosMailSieve;
  var SN = window.orosMailSnooze;
  var US = window.orosMailUnsub;
  var PM = window.orosMailPgpMime;
  var PG = window.orosMailPgp;
  var MAX_SIG_HTML = 60000;           // stored signature HTML (pictures as data:)

  // ---------- 1. Constants, i18n, helpers ----------
  function appLang() {
    // orosI18n (../i18n.js): the full language code, a pack language included.
    if (window.orosI18n) return window.orosI18n.lang();
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
      "tpl.btn": "Templates", "tpl.title": "Templates", "tpl.none": "No templates yet. Write a message, then save it here as a template.",
      "tpl.saveAs": "Save this message as a template", "tpl.namePh": "Name, e.g. Thank you", "tpl.save": "Save template", "tpl.del": "Delete template",
      "tpl.noName": "Give the template a name.", "tpl.empty": "Write something first.", "tpl.long": "Too long for a template (pictures cannot go in one).",
      "tpl.many": "Up to {n} templates.", "tpl.saved": "Template saved: {name}",
      "blk.btn": "Block sender", "blk.q": "Block {addr}? Their next messages go straight to Spam, and this one goes there now. A rule does it; remove it under Settings › Rules to unblock.",
      "blk.do": "Block", "blk.done": "Blocked: {addr}",
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
      "att.title": "Attachments", "att.save": "Save {name}", "att.open": "Open {name}", "att.download": "Save to device", "att.toFiles": "Save to Files",
      "att.savedFiles": "Saved in Files › Mail: {name}", "att.noPreview": "No preview for this file.", "att.page": "Page {n} of {of}", "att.more": "{n} more pages: save the file to see them.",
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
      "sigIn.title": "Use this signature?", "sigIn.text": "The signature \"{name}\" from Email Signature replaces the signature of the account you pick, on all your devices.", "sigIn.acct": "Account", "sigIn.ok": "Use", "sigIn.none": "Add a mail account first, then use the signature again.", "sigIn.done": "Signature saved for {email}",
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
      "drf.save": "Save draft", "drf.saving": "Saving…", "drf.saved": "Draft saved in Drafts", "drf.failed": "The draft was not saved.", "drf.edit": "Continue writing",
      "cmp.discardQ": "Discard this message?", "cmp.keep": "Keep writing",
      "cmp.hint": "Formatting is sent with a plain-text copy for those who don't see it.",
      "cmp.attach": "Attach files", "cmp.fromFiles": "From Files", "cmp.unattach": "Remove {name}", "cmp.attTotal": "Together {size} (up to {max})",
      "cmp.attBig": "Attached files can be up to {max} together.", "cmp.attFail": "The file could not be read.",
      "cmp.attHanded": "{n} of the files could not be attached (missing, or over {max} together).",
      "files.title": "orOS Files", "files.up": "Up", "files.empty": "This folder is empty.", "files.err": "Files could not be read.",
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
      "to.btn": "Other apps", "to.title": "Use this message in…", "to.app": "Mail", "to.from": "From:", "to.date": "Date:", "to.subj": "Subject:",
      "to.todo": "A To-Do task", "to.todoHint": "The subject as the task, the message as its note.",
      "to.note": "A note", "to.noteHint": "Saves the message's text as a new page in Notes.",
      "to.other": "Another app…", "to.otherHint": "Writer, Wiki, Text Tools and the other apps that take text.",
      "to.link": "A bookmark", "to.linkHint": "Pick one of its {n} links.", "to.nolinks": "This message has no links.", "to.pick": "Pick a link",
      "to.travel": "Booking to Travel", "to.travelHint": "Flights, hotels, trains, car hire or tickets found in this e-mail.",
      "to.contact": "Sender to Contacts", "to.crm": "Log in CRM", "to.sum": "Summary by the Assistant", "to.reply": "Reply drafted by the Assistant",
      "to.aiHint": "Opens the Assistant with the question ready (long messages are cut); you send it.",
      "ai.sum": "Summarise this e-mail in a few sentences, in the language it is written in.",
      "ai.reply": "Write a short, polite reply to this e-mail, in its language. I will edit it before sending.",
      "snd.sending": "Sending…", "snd.late": "Too late: it is already being sent.", "snd.later": "Send later",
      "snd.inHour": "In an hour", "snd.tomorrow": "Tomorrow morning ({when})", "snd.monday": "Monday morning ({when})",
      "snd.at": "Date and time", "snd.schedule": "Schedule", "snd.past": "Pick a time in the future.", "snd.far": "Up to a year ahead.",
      "snd.hint": "It goes out at that time while orOS is open on this device (with Mail closed too); otherwise as soon as orOS opens.",
      "snd.scheduled": "Scheduled for {when}", "snd.at2": "Sends {when}", "snd.now": "Being sent…",
      "set.undo": "Undo send", "set.undoOff": "Off (send at once)", "set.undoSec": "{n} seconds to undo",
      "srv.lbl": "On the mail server", "srv.btn": "Set up", "srv.title": "Server rules and out of office",
      "srv.hint": "Some mail servers run your rules and an out-of-office reply themselves, even with orOS closed on every device.",
      "srv.on": "Rules on the server", "srv.off": "Rules on your devices", "srv.away": "out-of-office reply on",
      "srv.checking": "Asking the mail server what it can do…",
      "srv.yes": "This server can run your rules and reply for you.",
      "srv.use": "Run my rules and the out-of-office reply on the server",
      "srv.other": "Another set of filters, “{name}”, is active on the server (made in webmail, for example). Turning this on replaces it; turning it off brings it back.",
      "srv.skip": "{n} of your rules cannot run on this server; they keep running on your devices.",
      "srv.no": "This server does not offer server rules (ManageSieve). Gmail, Outlook and Yahoo don't. Your rules keep running on your devices while orOS is open; an out-of-office reply is set on the provider's own web page.",
      "srv.noAuth": "The server refused the login for server rules.",
      "srv.host": "Rules server (optional)", "srv.hostHint": "Only if your provider gives another address for Sieve / ManageSieve, for example sieve.example.com (port 4190).",
      "srv.retry": "Check again", "srv.local": "Run the rules on my devices again",
      "srv.saved": "Saved on the mail server.", "srv.offDone": "Your rules run on your devices again.",
      "srv.fail": "The rules on the mail server were not updated: {msg}", "srv.hintRules": "Rules of {email} run on the mail server.",
      "away.title": "Out-of-office reply", "away.on": "Send an automatic reply", "away.subj": "Subject (optional)",
      "away.text": "Message", "away.from": "From", "away.to": "Until", "away.days": "To the same sender",
      "away.days1": "at most once a day", "away.daysN": "at most once every {n} days",
      "away.noVac": "This server cannot send automatic replies.",
      "away.noDates": "This server ignores the dates: turn the reply off when you are back.",
      "away.needOn": "The reply works only when the rules run on the server.", "away.needText": "Write the reply's message.",
      "err.script": "The server did not accept the rules: {msg}",
      "out.text": "Messages written offline. They go out by themselves when you are online.",
      "out.send": "Send now", "out.edit": "Edit", "out.del": "Delete", "out.failed": "Not sent: {msg}",
      "out.empty": "The Outbox is empty.", "out.nosubj": "(no subject)",
      "org.archive": "Archive", "org.trash": "Delete", "org.erase": "Delete for good", "org.spamBtn": "Spam",
      "org.notspamBtn": "Not spam", "org.star": "Star", "org.unstar": "Remove star", "org.read": "Mark as read",
      "org.unread": "Mark as unread", "org.move": "Move to…", "org.moveTitle": "Move to folder",
      "org.select": "Select", "org.all": "Select all", "org.selected": "{n} selected", "org.done": "Done",
      "org.archived": "Archived: {n}", "org.spammed": "Moved to Spam: {n}", "org.notspam": "Back in Inbox: {n}",
      "org.trashed": "Moved to Trash: {n}", "org.moved": "Moved: {n}", "org.undo": "Undo",
      "org.eraseQ": "Delete {n} message(s) for good? This cannot be undone.", "org.erased": "Deleted: {n}",
      "f.snoozed": "Snoozed", "snz.btn": "Snooze", "snz.title": "Snooze until…", "snz.again": "Snooze until another time",
      "snz.later": "Later today ({when})", "snz.tomorrow": "Tomorrow ({when})", "snz.monday": "Next Monday ({when})",
      "snz.pick": "Date and time", "snz.ok": "Snooze",
      "snz.hint": "It leaves the Inbox on all your devices and comes back, unread, at that time while orOS is open on one of them (otherwise as soon as orOS opens).",
      "snz.done": "Snoozed until {when}: {n}", "snz.moved": "New time {when}: {n}", "snz.until": "Until {when}",
      "snz.back": "Unsnooze", "snz.backDone": "Back from snooze: {n}", "snz.woke": "Back from snooze: {n}",
      "snz.nokey": "This message cannot be snoozed: it has no Message-ID and no date.",
      "uni.moveOne": "Moving to a folder works on messages of one account at a time.",
      "uns.bar": "Mailing list", "uns.btn": "Unsubscribe", "uns.title": "Unsubscribe",
      "uns.mail": "Mail sends an unsubscribe e-mail to {to} from {from}.", "uns.send": "Send the unsubscribe e-mail",
      "uns.web": "The sender's unsubscribe page:", "uns.open": "Open the page",
      "uns.webHint": "It opens in a new tab; you may have to confirm there.", "uns.http": "This page is not secure (http).",
      "uns.warn": "Unsubscribe only from lists you signed up for: with spam, it just tells the sender that your address works.",
      "uns.sent": "Unsubscribe e-mail sent to {to}",
      "pgp.lbl": "Encryption (OpenPGP)", "pgp.hint": "Sign and encrypt mail with OpenPGP keys, as Thunderbird, Proton and GnuPG do. Your keys stay on this device.",
      "pgp.keys": "Keys", "pgp.keysN": "Yours: {own} · of others: {pub}", "pgp.title": "OpenPGP keys",
      "pgp.own": "My keys", "pgp.others": "Keys of others", "pgp.none": "No keys yet.",
      "pgp.new": "Create my key", "pgp.import": "Import a key", "pgp.fpr": "Fingerprint {fpr}",
      "pgp.exportPub": "Save public key", "pgp.exportSec": "Back up private key", "pgp.del": "Delete key",
      "pgp.delQ": "Delete the key of {who}?",
      "pgp.delOwnQ": "Delete your private key {fpr}? Without it, or a backup, mail locked for it can never be opened again.",
      "pgp.secQ": "The backup is your private key, still locked with your passphrase. Keep it somewhere safe and never send it to anyone.",
      "pgp.newTitle": "Create my OpenPGP key", "pgp.acct": "For", "pgp.pass": "Passphrase", "pgp.pass2": "Passphrase again",
      "pgp.passHint": "It locks the key on this device. Nobody can recover it for you: write it down somewhere safe.",
      "pgp.passShort": "At least 8 characters.", "pgp.passDiff": "The two passphrases are not the same.",
      "pgp.making": "Creating…", "pgp.made": "Key created for {email}",
      "pgp.impTitle": "Import an OpenPGP key",
      "pgp.impHint": "Paste a key block (-----BEGIN PGP …) or pick an .asc file: the public keys of the people you write to, or your own private key.",
      "pgp.impFile": "Pick a file", "pgp.impText": "Key", "pgp.impDo": "Import", "pgp.impDone": "Keys added: {n}, updated: {u}",
      "pgp.impBad": "No OpenPGP key could be read from it.", "pgp.impLock": "This private key has no passphrase. Choose one to lock it on this device.",
      "pgp.unlockText": "The passphrase of your key for {email} ({fpr}).", "pgp.unlock": "Unlock", "pgp.wrong": "Wrong passphrase.",
      "pgp.loadFail": "OpenPGP could not be loaded. Check the connection and try again.",
      "pgp.sign": "Sign", "pgp.enc": "Encrypt", "pgp.cmpLbl": "OpenPGP",
      "pgp.noOwn": "Create or import your own key for {email} first (Settings › Encryption).",
      "pgp.missing": "No OpenPGP key for: {list}. Import their public key, or send without encryption.",
      "pgp.working": "Encrypting…", "pgp.subjHint": "The subject and the addresses are not encrypted.",
      "pgp.failed": "OpenPGP failed: {msg}",
      "pgp.encMsg": "This message is encrypted with OpenPGP.", "pgp.decrypt": "Decrypt",
      "pgp.noKeyFor": "None of your keys on this device can open it.", "pgp.decrypted": "Decrypted with your OpenPGP key. It stays encrypted on the server.",
      "pgp.decFail": "It could not be decrypted: {msg}",
      "pgp.sigOk": "Signed with OpenPGP by {who}: the signature is valid.",
      "pgp.sigBad": "The OpenPGP signature does not match: the message may have been changed on the way.",
      "pgp.sigUnknown": "Signed with OpenPGP by a key that is not on this device ({id}).",
      "pgp.sigOther": "Signed with OpenPGP by {who}, whose key is not for {addr}.",
      "pgp.sigCheck": "Check signature", "pgp.sigChecking": "Checking the OpenPGP signature…", "pgp.signed": "Signed with OpenPGP.",
      "pgp.keyAtt": "This message carries an OpenPGP key.", "pgp.keyAdd": "Add to my keys"
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
      "tpl.btn": "Πρότυπα", "tpl.title": "Πρότυπα", "tpl.none": "Δεν υπάρχουν πρότυπα ακόμα. Γράψε ένα μήνυμα και αποθήκευσέ το εδώ ως πρότυπο.",
      "tpl.saveAs": "Αποθήκευση αυτού του μηνύματος ως πρότυπο", "tpl.namePh": "Όνομα, π.χ. Ευχαριστώ", "tpl.save": "Αποθήκευση προτύπου", "tpl.del": "Διαγραφή προτύπου",
      "tpl.noName": "Δώσε ένα όνομα στο πρότυπο.", "tpl.empty": "Γράψε κάτι πρώτα.", "tpl.long": "Πολύ μεγάλο για πρότυπο (οι εικόνες δεν χωρούν σε πρότυπο).",
      "tpl.many": "Έως {n} πρότυπα.", "tpl.saved": "Το πρότυπο αποθηκεύτηκε: {name}",
      "blk.btn": "Φραγή αποστολέα", "blk.q": "Φραγή του {addr}; Τα επόμενα μηνύματά του θα πηγαίνουν κατευθείαν στα Ανεπιθύμητα, και αυτό πηγαίνει εκεί τώρα. Το κάνει ένας κανόνας· για να αρθεί η φραγή, διάγραψέ τον από Ρυθμίσεις › Κανόνες.",
      "blk.do": "Φραγή", "blk.done": "Φραγή: {addr}",
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
      "att.title": "Συνημμένα", "att.save": "Αποθήκευση: {name}", "att.open": "Άνοιγμα: {name}", "att.download": "Αποθήκευση στη συσκευή", "att.toFiles": "Αποθήκευση στα Αρχεία",
      "att.savedFiles": "Αποθηκεύτηκε στα Αρχεία › Mail: {name}", "att.noPreview": "Δεν υπάρχει προεπισκόπηση για αυτό το αρχείο.", "att.page": "Σελίδα {n} από {of}", "att.more": "Ακόμα {n} σελίδες: αποθήκευσε το αρχείο για να τις δεις.",
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
      "sigIn.title": "Χρήση αυτής της υπογραφής;", "sigIn.text": "Η υπογραφή «{name}» από την Υπογραφή email αντικαθιστά την υπογραφή του λογαριασμού που θα διαλέξεις, σε όλες τις συσκευές σου.", "sigIn.acct": "Λογαριασμός", "sigIn.ok": "Χρήση", "sigIn.none": "Πρόσθεσε πρώτα έναν λογαριασμό email και μετά χρησιμοποίησε ξανά την υπογραφή.", "sigIn.done": "Η υπογραφή αποθηκεύτηκε για το {email}",
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
      "drf.save": "Αποθήκευση πρόχειρου", "drf.saving": "Αποθήκευση…", "drf.saved": "Το πρόχειρο αποθηκεύτηκε στα Πρόχειρα", "drf.failed": "Το πρόχειρο δεν αποθηκεύτηκε.", "drf.edit": "Συνέχεια γραψίματος",
      "cmp.discardQ": "Να απορριφθεί το μήνυμα;", "cmp.keep": "Συνέχεια γραψίματος",
      "cmp.hint": "Η μορφοποίηση στέλνεται μαζί με αντίγραφο σε απλό κείμενο για όσους δεν τη βλέπουν.",
      "cmp.attach": "Επισύναψη αρχείων", "cmp.fromFiles": "Από τα Αρχεία", "cmp.unattach": "Αφαίρεση: {name}", "cmp.attTotal": "Μαζί {size} (έως {max})",
      "cmp.attBig": "Τα συνημμένα μπορούν να είναι έως {max} μαζί.", "cmp.attFail": "Το αρχείο δεν διαβάστηκε.",
      "cmp.attHanded": "{n} από τα αρχεία δεν επισυνάφθηκαν (λείπουν ή ξεπερνούν μαζί τα {max}).",
      "files.title": "Αρχεία orOS", "files.up": "Πάνω", "files.empty": "Ο φάκελος είναι άδειος.", "files.err": "Τα Αρχεία δεν διαβάστηκαν.",
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
      "to.btn": "Άλλες εφαρμογές", "to.title": "Χρήση του μηνύματος σε…", "to.app": "Αλληλογραφία", "to.from": "Από:", "to.date": "Ημερομηνία:", "to.subj": "Θέμα:",
      "to.todo": "Εργασία στο To-Do", "to.todoHint": "Το θέμα γίνεται εργασία, το μήνυμα σημείωσή της.",
      "to.note": "Σημείωση", "to.noteHint": "Αποθηκεύει το κείμενο του μηνύματος ως νέα σελίδα στις Σημειώσεις.",
      "to.other": "Άλλη εφαρμογή…", "to.otherHint": "Writer, Wiki, Εργαλεία κειμένου και οι άλλες εφαρμογές που δέχονται κείμενο.",
      "to.link": "Σελιδοδείκτης", "to.linkHint": "Διάλεξε έναν από τους {n} συνδέσμους του.", "to.nolinks": "Το μήνυμα δεν έχει συνδέσμους.", "to.pick": "Διάλεξε σύνδεσμο",
      "to.travel": "Κράτηση στα Ταξίδια", "to.travelHint": "Πτήσεις, ξενοδοχεία, τρένα, ενοικιάσεις ή εισιτήρια που βρέθηκαν στο μήνυμα.",
      "to.contact": "Αποστολέας στις Επαφές", "to.crm": "Καταγραφή στους Πελάτες", "to.sum": "Περίληψη από τον Βοηθό", "to.reply": "Πρόχειρη απάντηση από τον Βοηθό",
      "to.aiHint": "Ανοίγει τον Βοηθό με την ερώτηση έτοιμη (τα μεγάλα μηνύματα κόβονται)· τη στέλνεις εσύ.",
      "ai.sum": "Κάνε περίληψη αυτού του email σε λίγες προτάσεις, στη γλώσσα που είναι γραμμένο.",
      "ai.reply": "Γράψε μια σύντομη, ευγενική απάντηση σε αυτό το email, στη γλώσσα του. Θα τη διορθώσω πριν τη στείλω.",
      "snd.sending": "Αποστολή…", "snd.late": "Πολύ αργά: στέλνεται ήδη.", "snd.later": "Αποστολή αργότερα",
      "snd.inHour": "Σε μία ώρα", "snd.tomorrow": "Αύριο το πρωί ({when})", "snd.monday": "Δευτέρα πρωί ({when})",
      "snd.at": "Ημερομηνία και ώρα", "snd.schedule": "Προγραμματισμός", "snd.past": "Διάλεξε μια μελλοντική ώρα.", "snd.far": "Έως έναν χρόνο μπροστά.",
      "snd.hint": "Φεύγει εκείνη την ώρα όσο το orOS είναι ανοιχτό σε αυτή τη συσκευή (και με κλειστή την Αλληλογραφία)· αλλιώς μόλις ανοίξει το orOS.",
      "snd.scheduled": "Προγραμματίστηκε για {when}", "snd.at2": "Στέλνεται {when}", "snd.now": "Στέλνεται…",
      "set.undo": "Αναίρεση αποστολής", "set.undoOff": "Όχι (αποστολή αμέσως)", "set.undoSec": "{n} δευτερόλεπτα για αναίρεση",
      "srv.lbl": "Στον διακομιστή αλληλογραφίας", "srv.btn": "Ρύθμιση", "srv.title": "Κανόνες στον διακομιστή και μήνυμα απουσίας",
      "srv.hint": "Κάποιοι διακομιστές αλληλογραφίας τρέχουν οι ίδιοι τους κανόνες σου και ένα αυτόματο μήνυμα απουσίας, ακόμα κι όταν το orOS είναι κλειστό σε όλες τις συσκευές.",
      "srv.on": "Κανόνες στον διακομιστή", "srv.off": "Κανόνες στις συσκευές σου", "srv.away": "μήνυμα απουσίας ενεργό",
      "srv.checking": "Ρωτάω τον διακομιστή τι υποστηρίζει…",
      "srv.yes": "Αυτός ο διακομιστής μπορεί να τρέχει τους κανόνες σου και να απαντά για σένα.",
      "srv.use": "Οι κανόνες και το μήνυμα απουσίας να τρέχουν στον διακομιστή",
      "srv.other": "Στον διακομιστή είναι ενεργό άλλο σύνολο φίλτρων, «{name}» (π.χ. από το webmail). Αν το ενεργοποιήσεις, θα το αντικαταστήσει· αν το απενεργοποιήσεις, θα επανέλθει.",
      "srv.skip": "{n} από τους κανόνες σου δεν μπορούν να τρέξουν σε αυτόν τον διακομιστή· συνεχίζουν στις συσκευές σου.",
      "srv.no": "Αυτός ο διακομιστής δεν προσφέρει κανόνες διακομιστή (ManageSieve). Το Gmail, το Outlook και το Yahoo δεν το προσφέρουν. Οι κανόνες σου συνεχίζουν να τρέχουν στις συσκευές σου όσο το orOS είναι ανοιχτό· το μήνυμα απουσίας ρυθμίζεται στη σελίδα του παρόχου.",
      "srv.noAuth": "Ο διακομιστής δεν δέχτηκε τη σύνδεση για τους κανόνες.",
      "srv.host": "Διακομιστής κανόνων (προαιρετικό)", "srv.hostHint": "Μόνο αν ο πάροχος δίνει άλλη διεύθυνση για Sieve / ManageSieve, π.χ. sieve.example.com (θύρα 4190).",
      "srv.retry": "Έλεγχος ξανά", "srv.local": "Οι κανόνες να τρέχουν ξανά στις συσκευές μου",
      "srv.saved": "Αποθηκεύτηκε στον διακομιστή.", "srv.offDone": "Οι κανόνες σου τρέχουν ξανά στις συσκευές σου.",
      "srv.fail": "Οι κανόνες στον διακομιστή δεν ενημερώθηκαν: {msg}", "srv.hintRules": "Οι κανόνες του {email} τρέχουν στον διακομιστή.",
      "away.title": "Μήνυμα απουσίας", "away.on": "Αυτόματη απάντηση", "away.subj": "Θέμα (προαιρετικό)",
      "away.text": "Μήνυμα", "away.from": "Από", "away.to": "Έως", "away.days": "Στον ίδιο αποστολέα",
      "away.days1": "το πολύ μία φορά την ημέρα", "away.daysN": "το πολύ μία φορά κάθε {n} ημέρες",
      "away.noVac": "Αυτός ο διακομιστής δεν μπορεί να στέλνει αυτόματες απαντήσεις.",
      "away.noDates": "Αυτός ο διακομιστής αγνοεί τις ημερομηνίες: σταμάτησε την απάντηση όταν γυρίσεις.",
      "away.needOn": "Η απάντηση λειτουργεί μόνο όταν οι κανόνες τρέχουν στον διακομιστή.", "away.needText": "Γράψε το κείμενο της απάντησης.",
      "err.script": "Ο διακομιστής δεν δέχτηκε τους κανόνες: {msg}",
      "out.text": "Μηνύματα που γράφτηκαν χωρίς σύνδεση. Στέλνονται μόνα τους μόλις συνδεθείς.",
      "out.send": "Αποστολή τώρα", "out.edit": "Επεξεργασία", "out.del": "Διαγραφή", "out.failed": "Δεν στάλθηκε: {msg}",
      "out.empty": "Τα Εξερχόμενα είναι άδεια.", "out.nosubj": "(χωρίς θέμα)",
      "org.archive": "Αρχειοθέτηση", "org.trash": "Διαγραφή", "org.erase": "Οριστική διαγραφή", "org.spamBtn": "Ανεπιθύμητο",
      "org.notspamBtn": "Δεν είναι ανεπιθύμητο", "org.star": "Αστέρι", "org.unstar": "Χωρίς αστέρι", "org.read": "Σήμανση ως διαβασμένο",
      "org.unread": "Σήμανση ως αδιάβαστο", "org.move": "Μετακίνηση σε…", "org.moveTitle": "Μετακίνηση σε φάκελο",
      "org.select": "Επιλογή", "org.all": "Επιλογή όλων", "org.selected": "Επιλεγμένα: {n}", "org.done": "Τέλος",
      "org.archived": "Αρχειοθετήθηκαν: {n}", "org.spammed": "Στα Ανεπιθύμητα: {n}", "org.notspam": "Πίσω στα Εισερχόμενα: {n}",
      "org.trashed": "Στον Κάδο: {n}", "org.moved": "Μετακινήθηκαν: {n}", "org.undo": "Αναίρεση",
      "org.eraseQ": "Οριστική διαγραφή {n} μηνυμάτων; Δεν αναιρείται.", "org.erased": "Διαγράφηκαν: {n}",
      "f.snoozed": "Σε αναβολή", "snz.btn": "Αναβολή", "snz.title": "Αναβολή έως…", "snz.again": "Αναβολή για άλλη ώρα",
      "snz.later": "Αργότερα σήμερα ({when})", "snz.tomorrow": "Αύριο ({when})", "snz.monday": "Την επόμενη Δευτέρα ({when})",
      "snz.pick": "Ημερομηνία και ώρα", "snz.ok": "Αναβολή",
      "snz.hint": "Φεύγει από τα Εισερχόμενα σε όλες τις συσκευές σου και επιστρέφει, αδιάβαστο, εκείνη την ώρα όσο το orOS είναι ανοιχτό σε κάποια από αυτές (αλλιώς μόλις ανοίξει το orOS).",
      "snz.done": "Σε αναβολή έως {when}: {n}", "snz.moved": "Νέα ώρα {when}: {n}", "snz.until": "Έως {when}",
      "snz.back": "Κατάργηση αναβολής", "snz.backDone": "Επέστρεψαν από την αναβολή: {n}", "snz.woke": "Επέστρεψαν από την αναβολή: {n}",
      "snz.nokey": "Αυτό το μήνυμα δεν μπορεί να αναβληθεί: δεν έχει Message-ID ούτε ημερομηνία.",
      "uni.moveOne": "Η μετακίνηση σε φάκελο γίνεται σε μηνύματα ενός λογαριασμού τη φορά.",
      "uns.bar": "Λίστα αλληλογραφίας", "uns.btn": "Απεγγραφή", "uns.title": "Απεγγραφή",
      "uns.mail": "Η Αλληλογραφία θα στείλει email απεγγραφής στο {to} από το {from}.", "uns.send": "Αποστολή email απεγγραφής",
      "uns.web": "Η σελίδα απεγγραφής του αποστολέα:", "uns.open": "Άνοιγμα της σελίδας",
      "uns.webHint": "Ανοίγει σε νέα καρτέλα· ίσως χρειαστεί να επιβεβαιώσεις εκεί.", "uns.http": "Η σελίδα δεν είναι ασφαλής (http).",
      "uns.warn": "Κάνε απεγγραφή μόνο από λίστες που γράφτηκες εσύ: στα ανεπιθύμητα, απλώς δείχνει στον αποστολέα ότι η διεύθυνσή σου υπάρχει.",
      "uns.sent": "Στάλθηκε email απεγγραφής στο {to}",
      "pgp.lbl": "Κρυπτογράφηση (OpenPGP)", "pgp.hint": "Υπογραφή και κρυπτογράφηση μηνυμάτων με κλειδιά OpenPGP, όπως στο Thunderbird, το Proton και το GnuPG. Τα κλειδιά σου μένουν σε αυτή τη συσκευή.",
      "pgp.keys": "Κλειδιά", "pgp.keysN": "Δικά σου: {own} · άλλων: {pub}", "pgp.title": "Κλειδιά OpenPGP",
      "pgp.own": "Τα κλειδιά μου", "pgp.others": "Κλειδιά άλλων", "pgp.none": "Κανένα κλειδί ακόμα.",
      "pgp.new": "Δημιουργία κλειδιού", "pgp.import": "Εισαγωγή κλειδιού", "pgp.fpr": "Αποτύπωμα {fpr}",
      "pgp.exportPub": "Αποθήκευση δημόσιου κλειδιού", "pgp.exportSec": "Αντίγραφο ιδιωτικού κλειδιού", "pgp.del": "Διαγραφή κλειδιού",
      "pgp.delQ": "Διαγραφή του κλειδιού του/της {who};",
      "pgp.delOwnQ": "Διαγραφή του ιδιωτικού σου κλειδιού {fpr}; Χωρίς αυτό, ή ένα αντίγραφό του, τα μηνύματα που κλειδώθηκαν γι' αυτό δεν θα ανοίξουν ποτέ ξανά.",
      "pgp.secQ": "Το αντίγραφο είναι το ιδιωτικό σου κλειδί, κλειδωμένο με τη φράση πρόσβασης. Φύλαξέ το σε ασφαλές μέρος και μην το στείλεις ποτέ σε κανέναν.",
      "pgp.newTitle": "Δημιουργία κλειδιού OpenPGP", "pgp.acct": "Για", "pgp.pass": "Φράση πρόσβασης", "pgp.pass2": "Ξανά η φράση πρόσβασης",
      "pgp.passHint": "Κλειδώνει το κλειδί σε αυτή τη συσκευή. Κανείς δεν μπορεί να την ανακτήσει για σένα: γράψ' την κάπου ασφαλές.",
      "pgp.passShort": "Τουλάχιστον 8 χαρακτήρες.", "pgp.passDiff": "Οι δύο φράσεις δεν είναι ίδιες.",
      "pgp.making": "Δημιουργία…", "pgp.made": "Το κλειδί δημιουργήθηκε για {email}",
      "pgp.impTitle": "Εισαγωγή κλειδιού OpenPGP",
      "pgp.impHint": "Επικόλλησε ένα κλειδί (-----BEGIN PGP …) ή διάλεξε αρχείο .asc: τα δημόσια κλειδιά όσων σου γράφουν, ή το δικό σου ιδιωτικό κλειδί.",
      "pgp.impFile": "Επιλογή αρχείου", "pgp.impText": "Κλειδί", "pgp.impDo": "Εισαγωγή", "pgp.impDone": "Νέα κλειδιά: {n}, ενημερωμένα: {u}",
      "pgp.impBad": "Δεν βρέθηκε κλειδί OpenPGP εκεί.", "pgp.impLock": "Αυτό το ιδιωτικό κλειδί δεν έχει φράση πρόσβασης. Διάλεξε μία για να κλειδωθεί σε αυτή τη συσκευή.",
      "pgp.unlockText": "Η φράση πρόσβασης του κλειδιού σου για {email} ({fpr}).", "pgp.unlock": "Ξεκλείδωμα", "pgp.wrong": "Λάθος φράση πρόσβασης.",
      "pgp.loadFail": "Το OpenPGP δεν φορτώθηκε. Έλεγξε τη σύνδεση και δοκίμασε ξανά.",
      "pgp.sign": "Υπογραφή", "pgp.enc": "Κρυπτογράφηση", "pgp.cmpLbl": "OpenPGP",
      "pgp.noOwn": "Δημιούργησε ή εισήγαγε πρώτα το δικό σου κλειδί για {email} (Ρυθμίσεις › Κρυπτογράφηση).",
      "pgp.missing": "Δεν υπάρχει κλειδί OpenPGP για: {list}. Εισήγαγε το δημόσιο κλειδί τους ή στείλε χωρίς κρυπτογράφηση.",
      "pgp.working": "Κρυπτογράφηση…", "pgp.subjHint": "Το θέμα και οι διευθύνσεις δεν κρυπτογραφούνται.",
      "pgp.failed": "Το OpenPGP απέτυχε: {msg}",
      "pgp.encMsg": "Αυτό το μήνυμα είναι κρυπτογραφημένο με OpenPGP.", "pgp.decrypt": "Αποκρυπτογράφηση",
      "pgp.noKeyFor": "Κανένα από τα κλειδιά σου σε αυτή τη συσκευή δεν μπορεί να το ανοίξει.", "pgp.decrypted": "Αποκρυπτογραφήθηκε με το κλειδί σου OpenPGP. Στον διακομιστή μένει κρυπτογραφημένο.",
      "pgp.decFail": "Δεν αποκρυπτογραφήθηκε: {msg}",
      "pgp.sigOk": "Υπογραφή OpenPGP από {who}: η υπογραφή είναι έγκυρη.",
      "pgp.sigBad": "Η υπογραφή OpenPGP δεν ταιριάζει: το μήνυμα ίσως άλλαξε στη διαδρομή.",
      "pgp.sigUnknown": "Υπογραφή OpenPGP από κλειδί που δεν υπάρχει σε αυτή τη συσκευή ({id}).",
      "pgp.sigOther": "Υπογραφή OpenPGP από {who}, που το κλειδί του/της δεν είναι για το {addr}.",
      "pgp.sigCheck": "Έλεγχος υπογραφής", "pgp.sigChecking": "Έλεγχος της υπογραφής OpenPGP…", "pgp.signed": "Υπογεγραμμένο με OpenPGP.",
      "pgp.keyAtt": "Αυτό το μήνυμα έχει μαζί ένα κλειδί OpenPGP.", "pgp.keyAdd": "Προσθήκη στα κλειδιά μου"
    }
  };

  if (window.orosI18n) window.orosI18n.table(STRINGS, "mail", LANG);

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
  function locale() { return window.orosI18n ? window.orosI18n.locale(LANG) : (LANG === "el" ? "el-GR" : "en-GB"); }
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
  // a snooze's wake time in a list row: 18:00 · Tue 08:00 · 3 Nov
  function fmtListWhen(ms) {
    var d = new Date(ms), now = new Date();
    var hm = d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
    if (d.toDateString() === now.toDateString()) return hm;
    if (ms - now.getTime() < 6 * 86400000) return d.toLocaleDateString(locale(), { weekday: "short" }) + " " + hm;
    return d.toLocaleDateString(locale(), { day: "numeric", month: "short" });
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
    eye: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
    clip: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>',
    star: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    down: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    pen: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>',
    out: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
    shield: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>',
    archive: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>',
    trash: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>',
    block: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>',
    spam: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
    inbox: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>',
    starOff: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    open: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-6 9 6v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><polyline points="3 9 12 15 21 9"/></svg>',
    unread: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="22 6 12 13 2 6"/></svg>',
    filter: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>',
    folder: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
    search: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    close: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>',
    key: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>',
    clock: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><polyline points="12 9 12 13 14.5 15"/><line x1="5" y1="3" x2="2" y2="6"/><line x1="19" y1="3" x2="22" y2="6"/></svg>',
    lock: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>'
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
    return /^[^\s@<>()\x22,;]+@[^\s@<>()\x22,;]+\.[^\s@<>()\x22,;]+$/.test(e) && e.length <= 254 ? e : "";
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
    // rules + out-of-office reply on the mail server (sieve.js)
    var sv = normSieve(a.sieve);
    if (sv) out.sieve = sv;
    var aw = SV.normAway(a.away);
    if (aw && (aw.on || aw.text)) out.away = aw;
    return out;
  }
  // { on, host: "" = the incoming server, prev: the script that was
  //   active before ours, ext: what the server offers (sieve.js normExt) }
  function normSieve(v) {
    if (!v || typeof v !== "object") return null;
    var o = { on: v.on === true, host: normHost(v.host), ext: SV.normExt(v.ext),
              prev: typeof v.prev === "string" && v.prev.length <= 200 && !/[\x00-\x1f\x7f]/.test(v.prev) ? v.prev : "" };
    return o.on || o.host || o.prev ? o : null;
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

  function emptyData() { return { ver: DATA_VER, accounts: [], relay: { url: "", m: 0 }, imgOk: {}, tombs: {}, rules: [], templates: [], snoozes: [] }; }
  // A message template (synced): { id, m, name ≤ 60, subject ≤ 300,
  // html ≤ MAX_TPL_HTML }. The HTML is cleaned (rich.js) when it is
  // put into a message, never shown raw.
  var MAX_TPLS = 30, MAX_TPL_HTML = 8000;
  function normTpl(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !/^[a-z0-9]{6,40}$/.test(x.id)) return null;
    if (!isInt(x.m) || x.m < 0) return null;
    var name = typeof x.name === "string" ? x.name.replace(/\s+/g, " ").trim().slice(0, 60) : "";
    var html = typeof x.html === "string" ? x.html : "";
    if (!name || !html || html.length > MAX_TPL_HTML) return null;
    var subject = typeof x.subject === "string" ? x.subject.replace(/\s+/g, " ").trim().slice(0, 300) : "";
    return { id: x.id, m: x.m, name: name, subject: subject, html: html };
  }

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
  // tombstones; rules of a removed account go with it); snoozes
  // (snooze.js) the same way. Canonical output (R26).
  function mergeMail(a, b) {
    var res = emptyData();
    var tombs = {}, byId = {}, img = {}, rules = {}, tpls = {}, snz = {};
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
      (Array.isArray(d.snoozes) ? d.snoozes : []).forEach(function (x) {
        var n = SN.norm(x);
        if (!n) return;
        var cur = snz[n.id];
        if (!cur || n.m > cur.m || (n.m === cur.m && cmpStr(JSON.stringify(n), JSON.stringify(cur)) > 0)) snz[n.id] = n;
      });
      (Array.isArray(d.templates) ? d.templates : []).forEach(function (x) {
        var n = normTpl(x);
        if (!n) return;
        var cur = tpls[n.id];
        if (!cur || n.m > cur.m || (n.m === cur.m && cmpStr(JSON.stringify(n), JSON.stringify(cur)) > 0)) tpls[n.id] = n;
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
    res.snoozes = Object.keys(snz).filter(function (id) {
      var x = snz[id];
      return !(tombs[id] >= x.m) && !(tombs[x.acct] && !live[x.acct]);
    }).sort(function (x, y) { return (snz[x].until - snz[y].until) || cmpStr(x, y); })
      .slice(0, SN.MAX).map(function (id) { return snz[id]; });
    res.templates = Object.keys(tpls).filter(function (id) { return !(tombs[id] >= tpls[id].m); })
      .sort(function (x, y) { return cmpStr(tpls[x].name.toLowerCase(), tpls[y].name.toLowerCase()) || cmpStr(x, y); })
      .slice(0, MAX_TPLS).map(function (id) { return tpls[id]; });
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
  var SPECIAL_ORDER = ["inbox", "snoozed", "drafts", "sent", "archive", "junk", "trash", "all", "flagged"];
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
    if (SN.isFolder(f)) return "snoozed";
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
    if (/[\x00-\x1f\x7f*%\x22\\]/.test(leaf) || (delim && leaf.indexOf(delim) >= 0) || /^inbox$/i.test(leaf)) return "fold.errChars";
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
        var req = indexedDB.open(DB_NAME, 3);   // 2: + outbox, 3: + pgp (OpenPGP keys)
        req.onupgradeneeded = function () {
          var d = req.result;
          ["keys", "creds", "folders", "heads", "bodies", "outbox", "pgp"].forEach(function (n) {
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
      // a large message takes longer to upload, send and file in Sent
      var timer = setTimeout(function () { ctl.abort(); }, (op === "send" || op === "draft") ? SEND_TIMEOUT : CALL_TIMEOUT);
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
  var prefs = { acct: null, folder: "INBOX", plain: 0, threads: 1, uni: 0, undo: 10 };
  var UNDO_SECS = [0, 5, 10, 20];
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
      if (sel) {
        var live = {};
        uniKeys().forEach(function (k) { live[k] = 1; });
        Object.keys(sel).forEach(function (k) { if (!live[k]) delete sel[k]; });
      }
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
    if (role === "snoozed") {
      var at = function (m) { var r = cur ? snoozeOf(cur.acct, m) : null; return r ? r.until : Infinity; };
      list.slice().sort(function (a, b) { return (at(a) - at(b)) || (b.uid - a.uid); })
        .forEach(function (m) { ul.appendChild(listRow(m, { snz: true })); });
      return;
    }
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
    var rowKey = function (x) { return o.acct ? o.acct + ":" + x.uid : x.uid; };
    var gUids = (g && !o.open ? g.msgs : [m]).map(rowKey);
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
    if (ua) {
      var badge = el("span", "row-badge", ua.name && data.accounts.filter(function (x) { return x.name === ua.name; }).length === 1 ? ua.name : ua.email);
      badge.style.color = "hsl(" + hue(ua.email) + " 60% 50%)";
      badge.setAttribute("aria-hidden", "true");
      top.appendChild(badge);
    }
    var sz = o.snz && cur ? snoozeOf(cur.acct, m) : null;
    if (sz) {
      var when = el("time", "row-date snz");
      when.innerHTML = UI.clock;
      when.appendChild(document.createTextNode(fmtListWhen(sz.until)));
      when.title = t("snz.until", { when: fmtWhen(sz.until) });
      top.appendChild(when);
    } else top.appendChild(el("time", "row-date", fmtListDate(m.date)));
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
        } else toggleSel(rowKey(m));
        return;
      }
      if (g) {
        // first click opens the newest and shows the rest; again: folds it
        if (o.open && isOpen) { toggleThread(g, false); renderList(); return; }
        toggleThread(g, true);
      }
      if (o.acct) uniOpen(o.acct, m.uid); else openMessage(m.uid);
    });
    wireSwipe(b, rowKey(m));
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
    return TH.unify(data.accounts.filter(function (a) { return uni.recs[a.id]; }).map(function (a) {
      return { acct: a.id, msgs: uni.recs[a.id].msgs, threads: !!prefs.threads };
    }), UNI_MAX);
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
      var bin = M.b64ToBin(raw);
      openMsg.parsed = M.parseMessage(bin);
      openMsg.pgp = pgpInfo(bin, openMsg.parsed);
      openMsg.loading = false;
      markSeen(acct, rec, m);
      renderList();
      renderReader();
      pgpAuto();
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
    renderPgp(m, bars);
    renderUnsub(p, m, bars);
    acts.hidden = false;
    if (folderRole(currentFolder() || {}) === "drafts") {
      acts.appendChild(button(t("drf.edit"), "small primary", editDraft));
    } else {
      [["reply", "act.reply"], ["all", "act.all"], ["forward", "act.fwd"]].forEach(function (a) {
        acts.appendChild(button(t(a[1]), "small", function () { replyTo(a[0]); }));
      });
    }
    if (shellApps()) acts.appendChild(button(t("to.btn"), "small", function () { appsDialog(m, p); }));
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
    var list = p.attachments.filter(function (a) { return !(a.inline && a.cid && /^image\//.test(a.type)) && !pgpPart(a); });
    if (!list.length) return;
    box.hidden = false;
    box.appendChild(el("div", "atts-title", t("att.title")));
    var row = el("div", "atts");
    list.forEach(function (a) {
      var b = el("button", "att");
      b.type = "button";
      b.title = t("att.open", { name: a.name });
      b.setAttribute("aria-label", b.title);
      var ic = el("span", "att-ic");
      ic.innerHTML = previewKind(a) ? UI.eye : UI.down;
      b.appendChild(ic);
      var tx = el("span", "att-tx");
      tx.appendChild(el("span", "att-name", a.name));
      tx.appendChild(el("span", "att-size", fmtSize(a.size)));
      b.appendChild(tx);
      b.addEventListener("click", function () { attDialog(a); });
      row.appendChild(b);
    });
    box.appendChild(row);
  }

  // the message's files (not its inline pictures) for the composer
  function fileAtts(p) {
    return (p.attachments || []).filter(function (a) { return !(a.inline && a.cid && /^image\//.test(a.type)) && typeof a.data === "string"; })
      .map(function (a) { return { name: a.name, type: a.type, bin: a.data }; });
  }
  function blobBin(blob) {
    return blob.arrayBuffer().then(function (buf) {
      var u8 = new Uint8Array(buf), out = "";
      for (var i = 0; i < u8.length; i += 0x8000) out += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
      return out;
    });
  }
  function binBlob(bin, type) {
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) & 0xff;
    return new Blob([bytes], { type: type || "application/octet-stream" });
  }
  function localPickFiles() {
    return new Promise(function (resolve) {
      var inp = document.createElement("input");
      inp.type = "file";
      inp.multiple = true;
      inp.style.display = "none";
      inp.addEventListener("change", function () {
        var list = inp.files ? Array.prototype.slice.call(inp.files) : [];
        inp.remove();
        resolve(list);
      });
      inp.addEventListener("cancel", function () { inp.remove(); resolve(null); });
      document.body.appendChild(inp);
      inp.click();
    });
  }
  // orOS Files (the shell's disk), when this runs inside orOS
  function filesApi() {
    try {
      var fs = window.parent && window.parent !== window ? window.parent.orosFS : null;
      return fs && typeof fs.ls === "function" && typeof fs.readBlob === "function" && typeof fs.writeBlob === "function" ? fs : null;
    } catch (e) { return null; }
  }
  // A small browser of the Files disk; done(blob with .name) on a pick.
  function filesPicker(done) {
    var fs = filesApi();
    if (!fs) return;
    var dlg = makeDialog("ml-files");
    dlg.appendChild(el("div", "dlg-title", t("files.title")));
    var bar = el("div", "fl-bar");
    var up = el("button", "org-btn");
    up.type = "button";
    up.innerHTML = UI.back;
    up.title = t("files.up");
    up.setAttribute("aria-label", t("files.up"));
    var where = el("span", "fl-path", "");
    bar.appendChild(up);
    bar.appendChild(where);
    dlg.appendChild(bar);
    var list = el("ul", "set-accts fl-list");
    dlg.appendChild(list);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    dlg.appendChild(acts);
    var ROOT = "/internal", cwd = ROOT, gen = 0;
    up.addEventListener("click", function () { if (cwd !== ROOT) go(cwd.replace(/\/[^\/]+$/, "") || ROOT); });
    function go(path) {
      cwd = path;
      var my = ++gen;
      up.disabled = path === ROOT;
      where.textContent = path === ROOT ? "/" : path.slice(ROOT.length);
      list.innerHTML = "";
      list.appendChild(el("li", "fl-note", t("list.loading")));
      Promise.resolve(typeof fs.ready === "function" ? fs.ready() : null).then(function () { return fs.ls(path); }).then(function (entries) {
        if (my !== gen) return;
        list.innerHTML = "";
        var items = (entries || []).filter(function (en) { return en && typeof en.name === "string"; });
        items.sort(function (a, b) { return (b.dir ? 1 : 0) - (a.dir ? 1 : 0) || cmpStr(a.name.toLowerCase(), b.name.toLowerCase()); });
        if (!items.length) list.appendChild(el("li", "fl-note", t("files.empty")));
        items.forEach(function (en) {
          var li = el("li");
          var b = el("button", "folder");
          b.type = "button";
          b.innerHTML = en.dir ? UI.folder : UI.clip;
          b.appendChild(el("span", "folder-name", en.name));
          if (!en.dir && en.size >= 0) b.appendChild(el("span", "att-size", fmtSize(en.size)));
          b.addEventListener("click", function () {
            var p = path + "/" + en.name;
            if (en.dir) { go(p); return; }
            fs.readBlob(p).then(function (blob) {
              dlg.close();
              var f = blob.slice(0, blob.size, blob.type || mimeOf(en.name));
              f.name = en.name;
              done(f);
            }, function () { showToast(t("files.err")); });
          });
          li.appendChild(b);
          list.appendChild(li);
        });
      }, function () {
        if (my !== gen) return;
        list.innerHTML = "";
        list.appendChild(el("li", "fl-note", t("files.err")));
      });
    }
    document.body.appendChild(dlg);
    dlg.showModal();
    go(ROOT);
  }
  var EXT_TYPES = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
    webp: "image/webp", txt: "text/plain", csv: "text/csv", zip: "application/zip", json: "application/json",
    doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    odt: "application/vnd.oasis.opendocument.text", ods: "application/vnd.oasis.opendocument.spreadsheet",
    mp3: "audio/mpeg", mp4: "video/mp4", ics: "text/calendar", vcf: "text/vcard", html: "text/html", svg: "image/svg+xml" };
  // Files another app hands to compose (deep link `attach`, JSON):
  // { name?, path } a file on the orOS disk under /internal, or
  // { name, type?, b64 } its bytes. Up to 10, ATT_MAX together.
  // → Promise of { files: [{ name, type, bin }], failed }
  var MAX_HANDED = 10;
  function diskPath(p) {
    if (typeof p !== "string" || p.length > 1000 || p.indexOf("/internal/") !== 0) return false;
    return p.split("/").slice(2).every(function (seg) { return seg && seg !== "." && seg !== ".." && !/[\x00-\x1f]/.test(seg); });
  }
  function handedFiles(list) {
    list = Array.isArray(list) ? list : [];
    var fs = filesApi(), total = 0, failed = Math.max(0, list.length - MAX_HANDED);
    return list.slice(0, MAX_HANDED).reduce(function (p, a) {
      return p.then(function (out) {
        var name = a && typeof a.name === "string" ? a.name.replace(/[\x00-\x1f\/\\]/g, "").trim().slice(0, 200) : "";
        var get = null;
        if (a && typeof a.b64 === "string" && a.b64.length <= Math.ceil(ATT_MAX / 3) * 4 + 4) {
          get = Promise.resolve().then(function () { return atob(a.b64.replace(/\s+/g, "")); });
        } else if (a && fs && diskPath(a.path)) {
          if (!name) name = a.path.replace(/^.*\//, "").slice(0, 200);
          get = fs.readBlob(a.path).then(function (b) { return b && b.size <= ATT_MAX ? blobBin(b) : null; });
        }
        if (!get) { failed++; return out; }
        return get.then(function (bin) {
          if (typeof bin !== "string" || total + bin.length > ATT_MAX) { failed++; return out; }
          total += bin.length;
          var type = a.type && typeof a.type === "string" && /^[\w.+-]+\/[\w.+-]+$/.test(a.type) ? a.type.toLowerCase() : mimeOf(name);
          out.push({ name: name || "attachment", type: type, bin: bin });
          return out;
        }, function () { failed++; return out; });
      });
    }, Promise.resolve([])).then(function (files) { return { files: files, failed: failed }; });
  }
  function mimeOf(name) {
    var ext = (/\.([a-z0-9]{1,5})$/i.exec(name || "") || ["", ""])[1].toLowerCase();
    return EXT_TYPES[ext] || "application/octet-stream";
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

  // ---------- attachment: preview, save, save to Files ----------
  // Pictures show as data: images (raster only, never SVG); PDFs are
  // drawn page by page by PDF.js (vendor/pdfjs, loaded on first use,
  // eval and XFA off: the file's scripts, forms and links never run).
  var PDF_LIB = "../vendor/pdfjs/pdf.min.js", PDF_WORKER = "../vendor/pdfjs/pdf.worker.min.js", PDF_PAGES = 20;
  function previewKind(a) {
    var type = String(a.type || "").toLowerCase();
    if (/^image\/(png|jpe?g|gif|webp|bmp)$/.test(type) && a.data.length <= 5 * 1024 * 1024) return "image";
    if ((type === "application/pdf" || /\.pdf$/i.test(a.name || "")) && a.data.length <= 20 * 1024 * 1024) return "pdf";
    return "";
  }
  var pdfLib = null;
  function loadPdf() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (pdfLib) return pdfLib;
    pdfLib = new Promise(function (res, rej) {
      var sc = document.createElement("script");
      sc.type = "module";
      sc.src = PDF_LIB;
      sc.onload = function () { if (window.pdfjsLib) res(window.pdfjsLib); else rej(new Error("pdfjs")); };
      sc.onerror = function () { rej(new Error("pdfjs")); };
      document.head.appendChild(sc);
    });
    pdfLib.catch(function () { pdfLib = null; });
    return pdfLib;
  }
  function renderPdf(a, box) {
    var note = el("p", "hint pad", t("read.loading"));
    box.appendChild(note);
    var bytes = new Uint8Array(a.data.length);
    for (var i = 0; i < a.data.length; i++) bytes[i] = a.data.charCodeAt(i) & 0xff;
    loadPdf().then(function (lib) {
      lib.GlobalWorkerOptions.workerSrc = PDF_WORKER;
      return lib.getDocument({ data: bytes, isEvalSupported: false, enableXfa: false, disableAutoFetch: true,
                               disableStream: true }).promise;
    }).then(function (pdf) {
      note.remove();
      var n = Math.min(pdf.numPages, PDF_PAGES), chain = Promise.resolve();
      var width = Math.max(240, Math.min(900, box.clientWidth || 600));
      for (var k = 1; k <= n; k++) (function (k) {
        chain = chain.then(function () { return pdf.getPage(k); }).then(function (page) {
          if (!box.isConnected) return null;
          var v1 = page.getViewport({ scale: 1 });
          var dpr = Math.min(2, window.devicePixelRatio || 1);
          var vp = page.getViewport({ scale: width / v1.width * dpr });
          var c = document.createElement("canvas");
          c.width = Math.round(vp.width);
          c.height = Math.round(vp.height);
          c.className = "att-page";
          c.setAttribute("aria-label", t("att.page", { n: k, of: pdf.numPages }));
          box.appendChild(c);
          return page.render({ canvasContext: c.getContext("2d"), viewport: vp, background: "#ffffff" }).promise;
        });
      })(k);
      return chain.then(function () {
        if (pdf.numPages > n) box.appendChild(el("p", "hint pad", t("att.more", { n: pdf.numPages - n })));
      });
    }).catch(function () {
      note.textContent = t("att.noPreview");
    });
  }
  function attDialog(a) {
    var dlg = makeDialog("ml-att");
    dlg.classList.add("wide");
    dlg.appendChild(el("div", "dlg-title att-dtitle", a.name));
    dlg.appendChild(el("p", "dlg-hint", (a.type || "") + " · " + fmtSize(a.size)));
    var kind = previewKind(a);
    var box = el("div", "att-view");
    if (kind === "image") {
      var img = el("img");
      img.alt = a.name;
      img.src = dataUrl(a);
      box.appendChild(img);
    }
    if (kind) dlg.appendChild(box);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("set.close"), "", function () { dlg.close(); }));
    if (filesApi()) acts.appendChild(button(t("att.toFiles"), "", function () { saveToFiles(a); }));
    acts.appendChild(button(t("att.download"), "primary", function () { saveAttachment(a); }));
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
    if (kind === "pdf") renderPdf(a, box);
  }
  // into Files › Mail, never over another file: "name (2).pdf"
  function saveToFiles(a) {
    var fs = filesApi();
    if (!fs) return;
    var dir = "/internal/Mail";
    var name = String(a.name || "attachment").replace(/[\/\\\x00-\x1f]+/g, "_").slice(0, 200) || "attachment";
    Promise.resolve(typeof fs.ready === "function" ? fs.ready() : null).then(function () {
      return Promise.resolve(fs.mkdir(dir)).catch(function () {});
    }).then(function () {
      return fs.ls(dir).catch(function () { return []; });
    }).then(function (entries) {
      var taken = {};
      (entries || []).forEach(function (en) { if (en && en.name) taken[en.name.toLowerCase()] = 1; });
      var dot = name.lastIndexOf("."), stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : "";
      var pick = name;
      for (var i = 2; taken[pick.toLowerCase()] && i < 1000; i++) pick = stem + " (" + i + ")" + ext;
      return fs.writeBlob(dir + "/" + pick, binBlob(a.data, a.type)).then(function () { return pick; });
    }).then(function (pick) {
      showToast(t("att.savedFiles", { name: pick }));
    }, function () { showToast(t("files.err")); });
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
      if (existing && existing.sieve) acct.sieve = existing.sieve;
      if (existing && existing.away) acct.away = existing.away;
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

  // A signature handed over by Email Signature (BR-MAIL-SIG): the
  // person picks the account; Use replaces its signature.
  function signatureDialog(sg) {
    if (!data.accounts.length) { showToast(t("sigIn.none")); return; }
    var html = typeof sg.html === "string" && sg.html.length <= 400000 ? sg.html : "";
    var cl = RT.clean(html, { cid: false });
    var text = typeof sg.text === "string" ? sg.text.replace(/\r\n?/g, "\n").slice(0, MAX_SIG) : cl.text.slice(0, MAX_SIG);
    if (!cl.html && !text) return;
    var name = typeof sg.name === "string" ? sg.name.replace(/\s+/g, " ").trim().slice(0, 60) : "";
    var dlg = makeDialog("ml-sig-in");
    dlg.appendChild(el("div", "dlg-title", t("sigIn.title")));
    dlg.appendChild(el("p", "dlg-text", t("sigIn.text", { name: name })));
    var form = el("form");
    form.method = "dialog";
    var cur = curAcct();
    var sel = portSelect(form, "ml-sig-acct", t("sigIn.acct"), data.accounts.map(function (a) {
      return [a.id, a.name ? a.name + " <" + a.email + ">" : a.email];
    }), cur ? cur.id : data.accounts[0].id);
    var pv = el("div", "ml-sig-pv");
    pv.innerHTML = cl.html || RT.fromText(text);   // cleaned by rich.js
    form.appendChild(pv);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    var ok = button(t("sigIn.ok"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var a = acctById(sel.value);
      if (!a) { dlg.close(); return; }
      var next = JSON.parse(JSON.stringify(a));
      next.m = Math.max(Date.now(), a.m + 1);
      next.sig = text;
      if (cl.rich && cl.html.length <= MAX_SIG_HTML) next.sigHtml = cl.html; else delete next.sigHtml;
      var n = normAccount(next);
      if (!n) { dlg.close(); return; }
      data.accounts = data.accounts.filter(function (x) { return x.id !== n.id; }).concat([n]);
      data = mergeMail(data, data);
      saveData();
      dlg.close();
      showToast(t("sigIn.done", { email: n.email }));
      renderAll();
    });
    dlg.appendChild(form);
    document.body.appendChild(dlg);
    dlg.showModal();
    sel.focus();
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
      dlg.appendChild(el("div", "dlg-lbl", t("srv.lbl")));
      dlg.appendChild(el("p", "dlg-hint", t("srv.hint")));
      var sul = el("ul", "set-accts");
      data.accounts.forEach(function (a) {
        var li = el("li");
        var tx = el("div", "set-acct");
        tx.appendChild(el("div", "set-acct-name", a.name || a.email));
        var on = a.sieve && a.sieve.on;
        tx.appendChild(el("div", "set-acct-mail", t(on ? "srv.on" : "srv.off") + (on && a.away && a.away.on ? " · " + t("srv.away") : "")));
        li.appendChild(tx);
        li.appendChild(button(t("srv.btn"), "small", function () { dlg.close(); serverDialog(a); }));
        sul.appendChild(li);
      });
      dlg.appendChild(sul);
    }
    if (PG && data.accounts.length) {
      dlg.appendChild(el("div", "dlg-lbl", t("pgp.lbl")));
      var kul = el("ul", "set-accts");
      var kli = el("li");
      var ktx = el("div", "set-acct");
      ktx.appendChild(el("div", "set-acct-name", t("pgp.keys")));
      var kn = el("div", "set-acct-mail", "");
      ktx.appendChild(kn);
      pgpInit().then(function () {
        var ks = PG.list();
        kn.textContent = t("pgp.keysN", { own: ks.filter(function (k) { return k.own; }).length, pub: ks.filter(function (k) { return !k.own; }).length });
      });
      kli.appendChild(ktx);
      kli.appendChild(button(t("set.edit"), "small", function () { dlg.close(); keysDialog(); }));
      kul.appendChild(kli);
      dlg.appendChild(kul);
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
    var fUndo = portSelect(form, "ml-undo", t("set.undo"), UNDO_SECS.map(function (n) {
      return [n, n ? t("set.undoSec", { n: n }) : t("set.undoOff")];
    }), prefs.undo);
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
      prefs.undo = +fUndo.value || 0;
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
    }).catch(function () { outbox = []; }).then(armTimed);
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
  // → { acct, msg } or throws MailError
  function buildMsg(d) {
    var acct = acctById(d.acct);
    if (!acct) throw new MailError("noacct");
    if (!acct.smtp) throw new MailError("nosmtp");
    var rich = d.html && !d.part ? RT.clean(d.html, { cid: true }) : null;   // data: pictures → inline parts
    var msg = C.build({ from: { name: acct.name, addr: acct.email }, to: d.to, cc: d.cc, bcc: d.bcc,
                        subject: d.subject, text: d.text, html: rich ? rich.html : "", inline: rich ? rich.inline : [],
                        attachments: d.atts || [], inReplyTo: d.inReplyTo, references: d.references,
                        part: d.part || null });   // OpenPGP: signed / encrypted already (pgpPrepare)
    if (msg.bin.length > MSG_MAX) throw new MailError("big");
    return { acct: acct, msg: msg };
  }
  function sendDraft(d) {
    var b;
    try { b = buildMsg(d); } catch (e) { return Promise.reject(e); }
    var acct = b.acct, msg = b.msg;
    var sent = sentFolder(acct);
    var args = { smtp: true, from: acct.email, rcpt: msg.rcpt, raw: C.b64(msg.bin) };
    if (sent) args.sent = sent;
    return call("send", acct, args).then(function (res) {
      if (sent && cur && cur.acct === acct.id && cur.folder === sent) refreshCurrent(false);
      if (d.serverDraft) dropServerDraft(d.serverDraft);
      return { copyFailed: !!sent && !(res && res.appended) };
    });
  }
  // ---------- server drafts ----------
  // "Save draft" files the message in the account's Drafts folder
  // (created when missing), so it can be finished on another device or
  // in webmail; saving again replaces that copy, sending erases it.
  // "Continue writing" on a message in Drafts opens it in the composer.
  function draftsFolder(acct) {
    var name = roleFolder(acct, "drafts");
    if (name) return Promise.resolve(name);
    name = newFolderName(acct, "Drafts");
    return call("create", acct, { folder: name }).then(function () {
      return refreshFolders(acct).catch(function () {});
    }).then(function () { return name; });
  }
  // ref: { acct, folder, uid }; best effort (an old copy may stay)
  function dropServerDraft(ref) {
    var a = acctById(ref.acct);
    if (!a || !(ref.uid > 0)) return Promise.resolve();
    return call("expunge", a, { folder: ref.folder, uids: [ref.uid] }).then(function () {
      if (cur && cur.acct === a.id && cur.folder === ref.folder) refreshCurrent(false);
    }, function () {});
  }
  // d: as sendDraft; ref: the copy it replaces, or null → new ref
  function saveServerDraft(d, ref) {
    var acct = acctById(d.acct);
    if (!acct) return Promise.reject(new MailError("noacct"));
    if (!navigator.onLine) return Promise.reject(new MailError("offline"));
    var rich = d.html ? RT.clean(d.html, { cid: true }) : null;
    var msg = C.build({ from: { name: acct.name, addr: acct.email }, to: d.to, cc: d.cc, bcc: d.bcc, keepBcc: true,
                        subject: d.subject, text: d.text, html: rich ? rich.html : "", inline: rich ? rich.inline : [],
                        attachments: d.atts || [], inReplyTo: d.inReplyTo, references: d.references });
    if (msg.bin.length > MSG_MAX) return Promise.reject(new MailError("big"));
    return draftsFolder(acct).then(function (folder) {
      var same = ref && ref.acct === acct.id && ref.folder === folder && ref.uid > 0;
      var args = { folder: folder, raw: C.b64(msg.bin), mid: msg.messageId };
      if (same) args.replace = ref.uid;
      return call("draft", acct, args).then(function (res) {
        if (ref && !same) dropServerDraft(ref);
        if (cur && cur.acct === acct.id && cur.folder === folder) refreshCurrent(false);
        return { acct: acct.id, folder: folder, uid: res && res.uid > 0 ? res.uid : 0 };
      });
    });
  }
  function editDraft() {
    var acct = curAcct();
    if (!acct || !cur || !openMsg || !openMsg.parsed) return;
    var p = openMsg.parsed, m = openMsg.sum, h = p.headers || {};
    var bcc = [];
    (h.bcc || []).forEach(function (v) { bcc = bcc.concat(M.parseAddresses(M.decodeWords(v))); });
    var html = "";
    if (p.html !== null) {
      // inline pictures back to data: so the editor shows (and keeps) them
      html = String(p.html).replace(/cid:([^\x22\x27\s)>]+)/gi, function (all, id) {
        var a = p.cids[id];
        try { a = a || p.cids[decodeURIComponent(id)]; } catch (e) {}
        return (a && dataUrl(a)) || all;
      });
    }
    openCompose({ acct: acct.id, to: m.to, cc: m.cc, bcc: bcc, subject: m.subj,
                  text: p.html === null ? String(p.text || "") : "", html: html,
                  inReplyTo: ((h["in-reply-to"] || [])[0] || "").trim(), references: (h.references || []).join(" "),
                  attachments: fileAtts(p), noSig: true, draft: { acct: acct.id, folder: cur.folder, uid: openMsg.uid } });
  }

  function sendErrText(e) {
    if (e && e.code === "pgp") return e.msg;
    if (e && (e.code === "too-big" || e.code === "big")) return t("err.big");
    if (e && e.code === "timeout") return t("cmp.timeout");
    return errText(e);
  }
  // Only "could not reach the relay" waits for the network; anything
  // else (refused, timed out: maybe sent) needs the person.
  function waitsForNet(e) { return e && (e.code === "offline" || e.code === "network"); }

  function flushOutbox() {
    if (flushing || !navigator.onLine) return Promise.resolve();
    var list = outbox.filter(function (r) { return !r.err && r.id !== editingOut && !OB.timed(r); });
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

  // ---------- timed sends: Undo send, Send later (outbox.js) ----------
  var TAB = newId();          // this window, in outbox claims
  var timedTimer = null;
  function queueTimed(d, due) {
    var b = buildMsg(d);      // throws "big" / "nosmtp" before anything is queued
    if (outbox.length >= OUT_MAX) throw new MailError("outfull");
    var job = { acct: b.acct.id, from: b.acct.email, rcpt: b.msg.rcpt, raw: C.b64(b.msg.bin), subj: d.subject || "" };
    var sent = sentFolder(b.acct);
    if (sent) job.sent = sent;
    if (d.serverDraft) job.serverDraft = d.serverDraft;
    var rec = { id: newId(), at: Date.now(), draft: d, err: "", due: due, job: job };
    return idbPut("outbox", rec.id, rec).then(function () {
      outbox.push(rec);
      renderSide();
      armTimed();
      return rec;
    });
  }
  function armTimed() {
    clearTimeout(timedTimer);
    var now = Date.now(), n = OB.nextDue(outbox, now);
    if (!n) return;
    try { parent.__orosMailNotify.due(n); } catch (e) {}     // the shell sends it should Mail close
    // at most a minute: the shell's checker may send (or a tab claim) meanwhile
    timedTimer = setTimeout(runTimed, Math.min(60000, Math.max(200, n - now + 100)));
  }
  function runTimed() {
    if (!navigator.onLine) { armTimed(); return Promise.resolve(); }
    return loadOutbox().then(function () {
      var now = Date.now();
      var due = outbox.filter(function (r) { return OB.isDue(r, now); });
      return due.reduce(function (p, r) {
        return p.then(function () { return sendTimed(r.id); });
      }, Promise.resolve());
    }).then(function () { return loadOutbox(); }).then(function () {
      renderSide();
      if ($("ml-out")) outboxDialog();
    }, function () { armTimed(); });
  }
  function sendTimed(id) {
    return db().then(function (d) { return OB.claim(d, id, TAB, Date.now()); }).then(function (rec) {
      if (!rec) return;
      var acct = acctById(rec.job.acct);
      if (!acct) return db().then(function (d) { return OB.release(d, id, errText(new MailError("noacct"))); });
      var args = { smtp: true, from: rec.job.from, rcpt: rec.job.rcpt, raw: rec.job.raw };
      if (rec.job.sent) args.sent = rec.job.sent;
      return call("send", acct, args).then(function (res) {
        return db().then(function (d) { return OB.finish(d, id); }).then(function () {
          if (rec.job.serverDraft) dropServerDraft(rec.job.serverDraft);
          if (rec.job.sent && cur && cur.acct === acct.id && cur.folder === rec.job.sent) refreshCurrent(false);
          showToast(rec.job.sent && !(res && res.appended) ? t("toast.sentNoCopy") : t("toast.sent") + (rec.job.subj ? ": " + rec.job.subj : ""));
        });
      }, function (e) {
        return db().then(function (d) { return OB.release(d, id, waitsForNet(e) ? "" : sendErrText(e)); });
      });
    }).catch(function () {});
  }
  // Undo / Edit / Delete: only while nobody is sending it
  function takeBack(id) {
    return db().then(function (d) { return OB.takeBack(d, id, Date.now()); }).then(function (rec) {
      outbox = outbox.filter(function (r) { return r.id !== id; });
      renderSide();
      armTimed();
      if (!rec) showToast(t("snd.late"));
      return rec;
    }, function () { showToast(t("snd.late")); return null; });
  }
  function composeFrom(rec) {
    var d = rec.draft;
    openCompose({ acct: d.acct, to: d.to, cc: d.cc, bcc: d.bcc, subject: d.subject, text: d.text, html: d.html || "",
                  inReplyTo: d.inReplyTo, references: d.references, attachments: d.atts || [],
                  draft: d.serverDraft || null, noSig: true, pgp: d.pgp || null });
  }
  function undoSendToast(rec, secs) {
    localToast(t("snd.sending"), { label: t("org.undo"), fn: function () {
      takeBack(rec.id).then(function (r) { if (r) composeFrom(r); });
    } }, secs * 1000);
  }
  function fmtWhen(ms) {
    var d = new Date(ms);
    return d.toLocaleString(locale(), { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }
  // the date-time picker for "Send later"; done(ms)
  function laterDialog(done) {
    var dlg = makeDialog("ml-later");
    dlg.appendChild(el("div", "dlg-title", t("snd.later")));
    var now = new Date();
    function at(days, h, m) { var d = new Date(now); d.setDate(d.getDate() + days); d.setHours(h, m || 0, 0, 0); return d.getTime(); }
    var tom = at(1, 8), mon = at(((8 - now.getDay()) % 7) || 7, 8);
    var quick = el("div", "later-quick");
    [[t("snd.inHour"), now.getTime() + 3600000], [t("snd.tomorrow", { when: fmtWhen(tom) }), tom], [t("snd.monday", { when: fmtWhen(mon) }), mon]].forEach(function (q) {
      quick.appendChild(button(q[0], "small", function () { dlg.close(); done(q[1]); }));
    });
    dlg.appendChild(quick);
    var form = el("form");
    form.noValidate = true;
    var p2 = function (n) { return (n < 10 ? "0" : "") + n; };
    var loc = function (ms) { var d = new Date(ms); return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()) + "T" + p2(d.getHours()) + ":" + p2(d.getMinutes()); };
    var fAt = field(form, "ml-later-at", t("snd.at"), "datetime-local", loc(now.getTime() + 3600000), { min: loc(now.getTime()) });
    form.appendChild(el("p", "dlg-hint", t("snd.hint")));
    var errP = el("p", "dlg-err");
    errP.setAttribute("role", "alert");
    form.appendChild(errP);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    var ok = button(t("snd.schedule"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var ms = new Date(fAt.value).getTime();
      if (!(ms > Date.now() + 30000)) { errP.textContent = t("snd.past"); return; }
      if (ms > Date.now() + 366 * 86400000) { errP.textContent = t("snd.far"); return; }
      dlg.close();
      done(ms);
    });
    dlg.appendChild(form);
    document.body.appendChild(dlg);
    dlg.showModal();
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
      else if (OB.timed(r)) tx.appendChild(el("div", "set-acct-mail out-when", OB.claimed(r, Date.now()) ? t("snd.now") : t("snd.at2", { when: fmtWhen(r.due) })));
      li.appendChild(tx);
      var acts = el("div", "out-acts");
      if (OB.timed(r)) {
        acts.appendChild(button(t("out.send"), "small", function () {
          takeBack(r.id).then(function (rec) {
            if (!rec) return;
            rec.due = Date.now();
            rec.err = "";
            return idbPut("outbox", rec.id, rec).then(function () { outbox.push(rec); return runTimed(); });
          });
        }));
        acts.appendChild(button(t("out.edit"), "small", function () {
          takeBack(r.id).then(function (rec) { if (rec) { dlg.close(); composeFrom(rec); } });
        }));
        acts.appendChild(button(t("out.del"), "small danger", function () {
          takeBack(r.id).then(function () { outboxDialog(); });
        }));
        li.appendChild(acts);
        ul.appendChild(li);
        return;
      }
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
                      references: r.draft.references, attachments: r.draft.atts || [], outId: r.id, noSig: true, pgp: r.draft.pgp || null });
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

  // ---------- recipients from Contacts ----------
  var CONTACTS_KEY = "oros-contacts-data";      // the Contacts app's data (read-only here)
  function contactPeople() {
    try { return PP.fromContacts(JSON.parse(localStorage.getItem(CONTACTS_KEY) || "null")); } catch (e) { return []; }
  }
  // A list of matching contacts under an address field while typing:
  // arrows move, Enter / Tab / click picks, Esc closes.
  var acSeq = 0;
  function addrSuggest(inp, people, changed) {
    var box = el("div", "ac-list");
    box.id = "ac-" + (++acSeq);
    box.setAttribute("role", "listbox");
    box.hidden = true;
    inp.insertAdjacentElement("afterend", box);
    inp.setAttribute("role", "combobox");
    inp.setAttribute("aria-autocomplete", "list");
    inp.setAttribute("aria-controls", box.id);
    inp.setAttribute("aria-expanded", "false");
    var hits = [], at = -1, tok = null;
    function close() {
      box.hidden = true;
      box.textContent = "";
      hits = [];
      at = -1;
      inp.setAttribute("aria-expanded", "false");
      inp.removeAttribute("aria-activedescendant");
    }
    function mark(i) {
      at = i;
      [].forEach.call(box.children, function (o, j) { o.setAttribute("aria-selected", j === i ? "true" : "false"); });
      if (i >= 0) { inp.setAttribute("aria-activedescendant", box.children[i].id); box.children[i].scrollIntoView({ block: "nearest" }); }
      else inp.removeAttribute("aria-activedescendant");
    }
    function pick(i) {
      var p = hits[i];
      if (!p) return;
      inp.value = PP.put(inp.value, tok, C.fmtInput(p));
      var end = inp.value.length;
      inp.setSelectionRange(end, end);
      close();
      changed();
    }
    function update() {
      tok = PP.token(inp.value, inp.selectionStart);
      var taken = C.parseList(inp.value).list.map(function (x) { return x.addr; });
      hits = tok.text ? PP.suggest(people, tok.text, taken, 6) : [];
      if (!hits.length) { close(); return; }
      box.textContent = "";
      hits.forEach(function (p, i) {
        var o = el("div", "ac-opt");
        o.id = box.id + "-" + i;
        o.setAttribute("role", "option");
        if (p.name) o.appendChild(el("span", "ac-name", p.name));
        o.appendChild(el("span", "ac-addr", p.addr));
        // mousedown: before the field loses focus
        o.addEventListener("mousedown", function (e) { e.preventDefault(); pick(i); });
        box.appendChild(o);
      });
      box.hidden = false;
      inp.setAttribute("aria-expanded", "true");
      mark(-1);
    }
    inp.addEventListener("input", update);
    inp.addEventListener("blur", function () { setTimeout(close, 150); });
    inp.addEventListener("keydown", function (e) {
      if (box.hidden) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        var n = hits.length;
        mark(e.key === "ArrowDown" ? (at + 1) % n : (at <= 0 ? n - 1 : at - 1));
      } else if ((e.key === "Enter" || e.key === "Tab") && (at >= 0 || e.key === "Enter" || hits.length === 1)) {
        e.preventDefault();
        pick(at >= 0 ? at : 0);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    });
  }

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
    var wasEnc = openMsg.pgp && (openMsg.pgp.kind === "encrypted" || openMsg.pgp.kind === "inline-enc") && openMsg.pgp.state === "ok";
    openCompose({ acct: acct.id, to: d.to, cc: d.cc, subject: d.subject, quote: d.text,
                  inReplyTo: d.inReplyTo, references: d.references,
                  attachments: mode === "forward" ? fileAtts(p) : [],
                  pgp: wasEnc ? { sign: PG.hasOwn(acct.email), encrypt: true } : null });
  }

  // init: { acct?, to[], cc[], bcc[], subject, text (above the
  // signature), html? (instead of text), quote (below it), inReplyTo,
  // references, outId?, noSig?, draft? ({ acct, folder, uid } in Drafts) }
  function openCompose(init) {
    init = init || {};
    if (!data.accounts.length) { showToast(t("cmp.noacct")); acctDialog(null); return; }
    var acct = acctById(init.acct) || curAcct();
    var dirty = !!init.outId || !!init.handed;
    var draftRef = init.draft || null;   // its copy in Drafts on the server
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
    var people = contactPeople();
    if (people.length) [fTo, fCc, fBcc].forEach(function (f) { addrSuggest(f, people, function () { dirty = true; }); });
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
        qd.setAttribute("data-quote", "1");
        qd.innerHTML = "<br>" + RT.clean(RT.quoteHtml(init.quote), { cid: false }).html;
        fBody.appendChild(qd);
      }
    }
    bLab.addEventListener("click", function () { fBody.focus(); });
    form.appendChild(bLab);
    form.appendChild(ed.box);
    // attached files: { name, type, bin, size }
    var files = (init.attachments || []).filter(function (a) { return a && typeof a.bin === "string"; }).map(function (a) {
      return { name: String(a.name || "attachment"), type: a.type || "application/octet-stream", bin: a.bin, size: a.bin.length };
    });
    var attRow = el("div", "cmp-attbar");
    var attB = el("button", "link-btn cmp-attach");
    attB.type = "button";
    attB.innerHTML = UI.clip;
    attB.appendChild(el("span", "", t("cmp.attach")));
    attB.addEventListener("click", function () { pickDevice(); });
    attRow.appendChild(attB);
    if (filesApi()) {
      var attF = el("button", "link-btn cmp-attach", t("cmp.fromFiles"));
      attF.type = "button";
      attF.addEventListener("click", function () { filesPicker(function (f) { addFiles([f]); }); });
      attRow.appendChild(attF);
    }
    var tplB = el("button", "link-btn cmp-attach", t("tpl.btn"));
    tplB.type = "button";
    tplB.addEventListener("click", function () {
      templatesDialog({
        // the message without its signature and quoted part
        current: function () {
          var c = fBody.cloneNode(true);
          [].forEach.call(c.querySelectorAll("[data-sig], [data-quote]"), function (n) { n.remove(); });
          return { subject: fSubj.value, html: RT.clean(c, { cid: false }).html };
        },
        use: function (tp) {
          ed.insert(tp.html);
          if (tp.subject && !fSubj.value.trim()) fSubj.value = tp.subject;
          dirty = true;
        }
      });
    });
    attRow.appendChild(tplB);
    var laterB = el("button", "link-btn cmp-attach", t("snd.later"));
    laterB.type = "button";
    laterB.addEventListener("click", function () {
      var d = collect(true);
      if (!d) return;
      if (!acctById(d.acct).smtp) { errP.textContent = t("err.nosmtp"); return; }
      laterDialog(function (ms) {
        var d2 = collect(true);
        if (!d2) return;
        if (draftRef) d2.serverDraft = draftRef;
        withPgp(d2, function (d3) {
          var q;
          try { q = queueTimed(d3, ms); } catch (er) { errP.textContent = sendErrText(er); return; }
          q.then(function () {
            if (init.outId) dropOut(init.outId);
            finish(t("snd.scheduled", { when: fmtWhen(ms) }));
          }, function (er) { errP.textContent = sendErrText(er); });
        });
      });
    });
    attRow.appendChild(laterB);
    form.appendChild(attRow);
    // OpenPGP: shown once this device has keys
    var pgpBox = null, cbSign = null, cbEnc = null;
    if (PG && PM) {
      pgpBox = el("div", "cmp-pgp");
      pgpBox.hidden = true;
      var pl = el("span", "cmp-pgp-lbl");
      pl.innerHTML = UI.lock;
      pl.appendChild(el("span", "", t("pgp.cmpLbl")));
      pgpBox.appendChild(pl);
      cbSign = checkBox(pgpBox, t("pgp.sign"), !!(init.pgp && init.pgp.sign));
      cbEnc = checkBox(pgpBox, t("pgp.enc"), !!(init.pgp && init.pgp.encrypt));
      var encHint = el("span", "dlg-hint pgp-hint", t("pgp.subjHint"));
      encHint.hidden = !cbEnc.checked;
      cbEnc.addEventListener("change", function () { encHint.hidden = !cbEnc.checked; });
      pgpBox.appendChild(encHint);
      form.appendChild(pgpBox);
      pgpInit().then(function () { pgpBox.hidden = !PG.list().length; });
    }
    // d → done(d with the OpenPGP part) when Sign / Encrypt is on, else as is
    function withPgp(d, done) {
      var o = pgpBox && !pgpBox.hidden && (cbSign.checked || cbEnc.checked) ? { sign: cbSign.checked, encrypt: cbEnc.checked } : null;
      if (!o) { done(d); return; }
      ok.disabled = true;
      ok.textContent = t("pgp.working");
      pgpPrepare(d, o).then(function (d2) {
        ok.disabled = false;
        ok.textContent = t("cmp.send");
        if (d2) done(d2);
      }, function (e) {
        ok.disabled = false;
        ok.textContent = t("cmp.send");
        errP.textContent = sendErrText(e);
      });
    }
    var chips = el("ul", "cmp-atts");
    form.appendChild(chips);
    function filesTotal() { return files.reduce(function (n, f) { return n + f.size; }, 0); }
    function renderChips() {
      chips.innerHTML = "";
      chips.hidden = !files.length;
      files.forEach(function (f, i) {
        var li = el("li", "cmp-att");
        var ic = el("span", "att-ic");
        ic.innerHTML = UI.clip;
        li.appendChild(ic);
        li.appendChild(el("span", "att-name", f.name));
        li.appendChild(el("span", "att-size", fmtSize(f.size)));
        var x = el("button", "org-btn");
        x.type = "button";
        x.innerHTML = UI.close;
        x.title = t("cmp.unattach", { name: f.name });
        x.setAttribute("aria-label", x.title);
        x.addEventListener("click", function () { files.splice(i, 1); dirty = true; renderChips(); });
        li.appendChild(x);
        chips.appendChild(li);
      });
      if (files.length > 1) chips.appendChild(el("li", "cmp-att-sum", t("cmp.attTotal", { size: fmtSize(filesTotal()), max: fmtSize(ATT_MAX) })));
    }
    // list: File / Blob objects (with .name)
    function addFiles(list) {
      errP.textContent = "";
      var all = Array.prototype.slice.call(list || []).filter(Boolean);
      var size = all.reduce(function (n, f) { return n + (f.size || 0); }, filesTotal());
      if (size > ATT_MAX) { errP.textContent = t("cmp.attBig", { max: fmtSize(ATT_MAX) }); return; }
      Promise.all(all.map(function (f) {
        return blobBin(f).then(function (bin) {
          return { name: String(f.name || "attachment").slice(0, 200), type: f.type || "application/octet-stream", bin: bin, size: bin.length };
        });
      })).then(function (got) {
        if (filesTotal() + got.reduce(function (n, f) { return n + f.size; }, 0) > ATT_MAX) { errP.textContent = t("cmp.attBig", { max: fmtSize(ATT_MAX) }); return; }
        files = files.concat(got);
        dirty = true;
        renderChips();
      }, function () { errP.textContent = t("cmp.attFail"); });
    }
    function pickDevice() {
      var host = dialogHost();
      var pick = host && typeof host.openFiles === "function" ? host.openFiles("") : localPickFiles();
      pick.then(function (list) { if (list && list.length) addFiles(list); });
    }
    renderChips();
    dlg.addEventListener("dragover", function (e) {
      if (e.dataTransfer && [].indexOf.call(e.dataTransfer.types || [], "Files") >= 0) e.preventDefault();
    });
    dlg.addEventListener("drop", function (e) {
      if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
      e.preventDefault();
      addFiles(e.dataTransfer.files);
    });
    form.appendChild(el("p", "dlg-hint dim", t("cmp.hint")));
    var errP = el("p", "dlg-err");
    errP.setAttribute("role", "alert");
    form.appendChild(errP);
    if (init.handedFailed) errP.textContent = t("cmp.attHanded", { n: init.handedFailed, max: fmtSize(ATT_MAX) });

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
    var saveB = button(t("drf.save"), "", function () { saveNow(false); });
    acts.appendChild(saveB);
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
      }, function () { saveNow(true); });
    }
    // the form as a draft { acct, to, cc, bcc, subject, text, html, … },
    // or null after showing what is wrong
    function collect(needRcpt) {
      errP.textContent = "";
      var a = fFrom ? acctById(fFrom.value) : acct;
      if (!a) return null;
      var to = C.parseList(fTo.value), cc = C.parseList(fCc.value), bcc = C.parseList(fBcc.value);
      var bad = to.bad.concat(cc.bad, bcc.bad);
      if (bad.length) { errP.textContent = t("cmp.bad", { list: bad.join(", ").slice(0, 200) }); return null; }
      var count = to.list.length + cc.list.length + bcc.list.length;
      if (needRcpt && !count) { errP.textContent = t("cmp.noRcpt"); fTo.focus(); return null; }
      if (count > MAX_RCPT) { errP.textContent = t("cmp.many", { n: MAX_RCPT }); return null; }
      if (filesTotal() > ATT_MAX) { errP.textContent = t("cmp.attBig", { max: fmtSize(ATT_MAX) }); return null; }
      var body = ed.get(false);
      return { acct: a.id, to: to.list, cc: cc.list, bcc: bcc.list,
               subject: fSubj.value.replace(/\s+/g, " ").trim().slice(0, 300), text: body.text.slice(0, 200000),
               html: body.rich ? body.html : "",
               inReplyTo: init.inReplyTo || "", references: init.references || "",
               atts: files.map(function (f) { return { name: f.name, type: f.type, bin: f.bin }; }) };
    }
    // Save draft; close: also close the composer once saved
    function saveNow(close) {
      var d = collect(false);
      if (!d) return;
      saveB.disabled = true;
      saveB.textContent = t("drf.saving");
      saveServerDraft(d, draftRef).then(function (ref) {
        draftRef = ref;
        dirty = false;
        saveB.disabled = false;
        saveB.textContent = t("drf.save");
        if (close) finish(t("drf.saved"));
        else showToast(t("drf.saved"));
      }, function (e) {
        saveB.disabled = false;
        saveB.textContent = t("drf.save");
        errP.textContent = t("drf.failed") + " " + sendErrText(e);
      });
    }
    // Esc: same as Discard (asks when something was written)
    dlg.addEventListener("cancel", function (e) { e.preventDefault(); leave(); });
    dlg.addEventListener("close", function () { if (editingOut === init.outId) editingOut = null; });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var d0 = collect(true);
      if (!d0) return;
      if (!acctById(d0.acct).smtp) { errP.textContent = t("err.nosmtp"); return; }
      if (draftRef) d0.serverDraft = draftRef;
      withPgp(d0, go);
    });
    function go(d) {
      // Undo send: built now, waits in the Outbox for a few seconds
      if (navigator.onLine && prefs.undo > 0) {
        var secs = prefs.undo, rec;
        try {
          rec = queueTimed(d, Date.now() + secs * 1000);
        } catch (er) { errP.textContent = sendErrText(er); return; }
        rec.then(function (r) {
          if (init.outId) dropOut(init.outId);
          dirty = false;
          dlg.close();
          undoSendToast(r, secs);
        }, function (er) { errP.textContent = sendErrText(er); });
        return;
      }
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
    }
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

  function confirmDiscard(yes, save) {
    var dlg = makeDialog("ml-discard");
    dlg.appendChild(el("p", "dlg-text", t("cmp.discardQ")));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("cmp.keep"), "", function () { dlg.close(); }));
    if (save) acts.appendChild(button(t("drf.save"), "primary", function () { dlg.close(); save(); }));
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
  // The messages an action is for, by account: [{ acct, rec, uids }].
  // keys: UIDs of the open folder; in All inboxes "acctId:uid" (a bare
  // UID there is the open message's, in its account's Inbox = cur).
  function groupsOf(keys) {
    var by = {}, out = [];
    (keys || []).forEach(function (k) {
      var s = String(k), i = s.indexOf(":"), aid, uid, rec;
      if (i > 0) { aid = s.slice(0, i); uid = +s.slice(i + 1); rec = uni ? uni.recs[aid] : null; }
      else { aid = cur && cur.acct; uid = +s; rec = cur; }
      var acct = aid ? acctById(aid) : null;
      if (!acct || !rec || !(uid > 0)) return;
      if (!by[aid]) { by[aid] = { acct: acct, rec: rec, uids: [] }; out.push(by[aid]); }
      if (by[aid].uids.indexOf(uid) < 0) by[aid].uids.push(uid);
    });
    return out;
  }
  function keyOf(g, uid) { return uni ? g.acct.id + ":" + uid : uid; }
  function groupMsgs(g) {
    var out = [];
    g.uids.forEach(function (u) {
      var m = null, i;
      for (i = 0; i < g.rec.msgs.length && !m; i++) if (g.rec.msgs[i].uid === u) m = g.rec.msgs[i];
      if (!m && g.rec === cur && srchOn()) for (i = 0; i < srch.msgs.length && !m; i++) if (srch.msgs[i].uid === u) m = srch.msgs[i];
      if (m) out.push(m);
    });
    return out;
  }
  function allMsgs(gs) { return gs.reduce(function (a, g) { return a.concat(groupMsgs(g)); }, []); }
  function roleOf(g) { return folderRole(findFolder(g.acct, g.rec.folder) || { name: g.rec.folder, delim: "", flags: [] }); }
  function msgsByUid(keys) { return allMsgs(groupsOf(keys)); }

  // kind: "star" | "unstar" | "read" | "unread"
  function setFlags(keys, kind) {
    var gs = groupsOf(keys);
    if (!gs.length || !online()) return;
    var flag = kind === "star" || kind === "unstar" ? "\\Flagged" : "\\Seen";
    var on = kind === "star" || kind === "read";
    gs.forEach(function (g) {
      var acct = g.acct, rec = g.rec, uids = g.uids;
      var before = {};
      var seenDelta = 0;
      groupMsgs(g).forEach(function (m) {
        before[m.uid] = m.flags.slice();
        var has = hasFlag(m, flag);
        if (on && !has) { m.flags = m.flags.concat(flag); if (flag === "\\Seen") seenDelta--; }
        if (!on && has) { m.flags = m.flags.filter(function (f) { return f !== flag; }); if (flag === "\\Seen") seenDelta++; }
        if (flag === "\\Seen" && rec.pend) delete rec.pend[m.uid];   // no stale "read" mark going up later
      });
      if (seenDelta) adjustUnseen(acct.id, rec.folder, seenDelta);
      saveHeads(rec);
      call("flag", acct, { folder: rec.folder, uids: uids.slice(0, 500), add: on ? [flag] : [], remove: on ? [] : [flag] })
        .catch(function (e) {
          groupMsgs(g).forEach(function (m) { if (before[m.uid]) m.flags = before[m.uid]; });
          if (seenDelta) adjustUnseen(acct.id, rec.folder, -seenDelta);
          saveHeads(rec);
          renderList();
          if (openMsg) renderReader();
          showToast(errText(e));
        });
    });
    renderList();
    if (openMsg) renderReader();
  }

  // kind: "archive" | "spam" | "notspam" | "trash" | "move" (to) |
  // "snooze" (to the account's Snoozed folder) | "unsnooze" (hooks.destOf)
  // hooks: { label, destOf(acct, uid) → folder, undo(), fail(part), done(part) }
  // One part per account and target folder; each is one relay "move".
  function moveMsgs(keys, kind, to, hooks) {
    hooks = hooks || {};
    var gs = groupsOf(keys);
    if (!gs.length || !online()) return;
    var parts = [], erase = [];
    gs.forEach(function (g) {
      var acct = g.acct, role = roleOf(g), dest = to, create = "";
      if (kind === "spam") dest = roleFolder(acct, "junk");
      if (kind === "notspam") dest = "INBOX";
      if (kind === "trash") dest = roleFolder(acct, "trash");
      if (kind === "archive" || kind === "snooze") {
        dest = roleFolder(acct, kind === "archive" ? "archive" : "snoozed");
        if (!dest) { dest = newFolderName(acct, kind === "archive" ? "Archive" : SN.FOLDER); create = dest; }
      }
      if (kind === "trash" && (!dest || role === "trash" || role === "junk")) { erase.push(g); return; }
      if (hooks.destOf) {
        var by = {};
        g.uids.forEach(function (u) { var d = hooks.destOf(acct, u) || "INBOX"; (by[d] = by[d] || []).push(u); });
        Object.keys(by).forEach(function (d) { if (d !== g.rec.folder) parts.push({ g: g, dest: d, create: "", uids: by[d] }); });
        return;
      }
      if (!dest || dest === g.rec.folder) return;
      parts.push({ g: g, dest: dest, create: create, uids: g.uids.slice() });
    });
    if (erase.length) eraseDialog(erase);
    if (!parts.length) return;
    var sr = srchOn() ? srch : null;
    var total = 0;
    parts.forEach(function (p) {
      var rec = p.g.rec, acct = p.g.acct;
      p.folder = rec.folder;
      p.moved = groupMsgs({ rec: rec, uids: p.uids });
      p.unseen = p.moved.filter(function (m) { return !hasFlag(m, "\\Seen"); }).length;
      p.inRec = p.moved.filter(function (m) { return rec.msgs.indexOf(m) >= 0; });
      p.inSr = sr && rec === cur ? p.moved.filter(function (m) { return sr.msgs.indexOf(m) >= 0; }) : [];
      rec.msgs = rec.msgs.filter(function (m) { return p.uids.indexOf(m.uid) < 0; });
      if (p.inSr.length) sr.msgs = sr.msgs.filter(function (m) { return p.uids.indexOf(m.uid) < 0; });
      if (p.unseen) { adjustUnseen(acct.id, p.folder, -p.unseen); adjustUnseen(acct.id, p.dest, p.unseen); }
      if (openMsg && openMsg.acct === acct.id && p.uids.indexOf(openMsg.uid) >= 0) {
        openMsg = null;
        if (phone()) setView("list");
      }
      total += p.moved.length;
      saveHeads(rec);
    });
    sel = null;
    renderList();
    renderReader();
    if (!total) return;
    var done = false;
    function back(list, add) {
      return list.concat(add.filter(function (m) {
        return !list.some(function (x) { return x.uid === m.uid; });
      })).sort(function (a, b) { return b.uid - a.uid; });
    }
    function restore(p) {
      var rec = p.g.rec, acct = p.g.acct;
      rec.msgs = back(rec.msgs, p.inRec);
      if (p.inSr.length && sr) sr.msgs = back(sr.msgs, p.inSr);
      if (p.unseen) { adjustUnseen(acct.id, p.folder, p.unseen); adjustUnseen(acct.id, p.dest, -p.unseen); }
      saveHeads(rec);
    }
    var job = {
      commit: function () {
        if (done) return;
        done = true;
        clearTimeout(timer);
        pendingMoves = pendingMoves.filter(function (j) { return j !== job; });
        parts.forEach(function (p) {
          var acct = p.g.acct;
          (p.create ? call("create", acct, { folder: p.create }) : Promise.resolve()).then(function () {
            return call("move", acct, { folder: p.folder, uids: p.uids.slice(0, 500), to: p.dest });
          }).then(function () {
            if (p.create) refreshFolders(acct).catch(function () {});
            if (hooks.done) hooks.done(p);
          }, function (e) {
            restore(p);
            renderList();
            showToast(errText(e));
            if (hooks.fail) hooks.fail(p);
          });
        });
      }
    };
    var timer = setTimeout(job.commit, UNDO_MS);
    pendingMoves.push(job);
    var label = { archive: "org.archived", spam: "org.spammed", notspam: "org.notspam", trash: "org.trashed", move: "org.moved",
                  snooze: "snz.done", unsnooze: "snz.backDone" }[kind];
    undoToast(hooks.label || t(label, { n: total }), function () {
      if (done) return;
      done = true;
      clearTimeout(timer);
      pendingMoves = pendingMoves.filter(function (j) { return j !== job; });
      parts.forEach(restore);
      renderList();
      if (hooks.undo) hooks.undo();
    });
  }
  function flushMoves() { pendingMoves.slice().forEach(function (j) { j.commit(); }); }

  // gs: groupsOf() of the messages to erase (in Trash / Spam, or with no Trash)
  function eraseDialog(gs) {
    var n = gs.reduce(function (a, g) { return a + g.uids.length; }, 0);
    if (!n) return;
    var dlg = makeDialog("ml-erase");
    dlg.appendChild(el("p", "dlg-text", t("org.eraseQ", { n: n })));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    acts.appendChild(button(t("org.erase"), "danger", function () {
      dlg.close();
      if (!online()) return;
      gs.forEach(function (g) {
        var acct = g.acct, rec = g.rec, uids = g.uids, folder = rec.folder;
        call("expunge", acct, { folder: folder, uids: uids.slice(0, 500) }).then(function () {
          var gone = groupMsgs(g);
          var unseen = gone.filter(function (m) { return !hasFlag(m, "\\Seen"); }).length;
          rec.msgs = rec.msgs.filter(function (m) { return uids.indexOf(m.uid) < 0; });
          if (rec === cur && srchOn()) srch.msgs = srch.msgs.filter(function (m) { return uids.indexOf(m.uid) < 0; });
          if (unseen) adjustUnseen(acct.id, folder, -unseen);
          if (openMsg && openMsg.acct === acct.id && uids.indexOf(openMsg.uid) >= 0) { openMsg = null; if (phone()) setView("list"); }
          sel = null;
          saveHeads(rec);
          renderList();
          renderReader();
          showToast(t("org.erased", { n: gone.length }));
        }, function (e) { showToast(errText(e)); });
      });
    }));
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  function moveDialog(keys) {
    var gs = groupsOf(keys);
    if (!gs.length) return;
    if (gs.length > 1) { showToast(t("uni.moveOne")); return; }
    var acct = gs[0].acct, from = gs[0].rec.folder;
    var dlg = makeDialog("ml-move");
    dlg.appendChild(el("div", "dlg-title", t("org.moveTitle")));
    var ul = el("ul", "move-list");
    (folders[acct.id] || []).forEach(function (f) {
      if (f.name === from || folderRole(f) === "snoozed") return;
      var li = el("li");
      var b = el("button", "folder", folderLabel(f));
      b.type = "button";
      b.style.paddingLeft = (12 + folderDepth(f) * 14) + "px";
      b.addEventListener("click", function () { dlg.close(); moveMsgs(keys, "move", f.name); });
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

  // ---------- snooze (snooze.js) ----------
  // Snoozing moves the messages to the account's Snoozed folder and
  // keeps their wake time in the synced slice (data.snoozes). Whoever
  // is running when one is due (this window, or the shell's checker
  // with Mail closed) marks it unread and moves it back.
  function snoozeOf(acctId, m) {
    var k = SN.keyOf(m);
    if (!k) return null;
    var list = data.snoozes || [];
    for (var i = 0; i < list.length; i++) if (list[i].acct === acctId && list[i].key === k) return list[i];
    return null;
  }
  function putSnoozes(recs) {
    var ids = {};
    recs.forEach(function (r) { ids[r.id] = 1; });
    data.snoozes = (data.snoozes || []).filter(function (r) { return !ids[r.id]; }).concat(recs);
    data = mergeMail(data, data);
    saveData();
    armSnooze();
  }
  function dropSnoozes(recs) {
    if (!recs.length) return;
    var now = Date.now(), ids = {};
    recs.forEach(function (r) { ids[r.id] = 1; data.tombs[r.id] = Math.max(now, r.m); });
    data.snoozes = (data.snoozes || []).filter(function (r) { return !ids[r.id]; });
    data = mergeMail(data, data);
    saveData();
    armSnooze();
  }
  function snoozeDialog(keys) {
    var gs = groupsOf(keys);
    if (!gs.length) return;
    var dlg = makeDialog("ml-snooze");
    dlg.appendChild(el("div", "dlg-title", t("snz.title")));
    var now = Date.now(), tm = SN.times(now);
    var quick = el("div", "later-quick");
    var opts = [];
    if (tm.later) opts.push([t("snz.later", { when: fmtWhen(tm.later) }), tm.later]);
    opts.push([t("snz.tomorrow", { when: fmtWhen(tm.tomorrow) }), tm.tomorrow]);
    opts.push([t("snz.monday", { when: fmtWhen(tm.monday) }), tm.monday]);
    opts.forEach(function (q) {
      quick.appendChild(button(q[0], "small", function () { dlg.close(); snoozeMsgs(keys, q[1]); }));
    });
    dlg.appendChild(quick);
    var form = el("form");
    form.noValidate = true;
    var p2 = function (n) { return (n < 10 ? "0" : "") + n; };
    var loc = function (ms) { var d = new Date(ms); return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()) + "T" + p2(d.getHours()) + ":" + p2(d.getMinutes()); };
    var fAt = field(form, "ml-snz-at", t("snz.pick"), "datetime-local", loc(tm.tomorrow), { min: loc(now) });
    form.appendChild(el("p", "dlg-hint", t("snz.hint")));
    var errP = el("p", "dlg-err");
    errP.setAttribute("role", "alert");
    form.appendChild(errP);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    var ok = button(t("snz.ok"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var ms = new Date(fAt.value).getTime();
      var bad = SN.pickOk(ms, Date.now());
      if (bad) { errP.textContent = t(bad === "far" ? "snd.far" : "snd.past"); return; }
      dlg.close();
      snoozeMsgs(keys, ms);
    });
    dlg.appendChild(form);
    document.body.appendChild(dlg);
    dlg.showModal();
  }
  function snoozeMsgs(keys, until) {
    var gs = groupsOf(keys);
    if (!gs.length || !online()) return;
    var now = Date.now(), recs = [], fresh = [], move = [], again = 0;
    gs.forEach(function (g) {
      var inSnz = roleOf(g) === "snoozed";
      groupMsgs(g).forEach(function (m) {
        var key = SN.keyOf(m);
        if (!key) return;
        var old = snoozeOf(g.acct.id, m);
        var r = { id: old ? old.id : newId(), m: Math.max(now, old ? old.m + 1 : 0), acct: g.acct.id, key: key,
                  until: until, from: old && inSnz ? old.from : (inSnz ? "INBOX" : g.rec.folder) };
        recs.push(r);
        if (inSnz) again++; else { move.push(keyOf(g, m.uid)); fresh.push(r); }
      });
    });
    if (!recs.length) { showToast(t("snz.nokey")); return; }
    putSnoozes(recs);
    if (!move.length) {
      renderList();
      showToast(t("snz.moved", { when: fmtWhen(until), n: again }));
      return;
    }
    moveMsgs(move, "snooze", null, {
      label: t("snz.done", { when: fmtWhen(until), n: move.length }),
      undo: function () { dropSnoozes(fresh); },
      fail: function (p) { dropSnoozes(fresh.filter(function (r) { return r.acct === p.g.acct.id; })); }
    });
  }
  // back now, to the folder it came from
  function unsnooze(keys) {
    var gs = groupsOf(keys);
    if (!gs.length || !online()) return;
    var recs = [], byUid = {};
    gs.forEach(function (g) {
      groupMsgs(g).forEach(function (m) {
        var r = snoozeOf(g.acct.id, m);
        byUid[g.acct.id + ":" + m.uid] = r ? r.from : "INBOX";
        if (r) recs.push(r);
      });
    });
    dropSnoozes(recs);
    moveMsgs(keys, "unsnooze", null, {
      destOf: function (acct, uid) { return byUid[acct.id + ":" + uid] || "INBOX"; },
      undo: function () {
        var m = Date.now() + 1;
        putSnoozes(recs.map(function (r) { return Object.assign({}, r, { m: m }); }));
      }
    });
  }

  var snzTimer = null, waking = false, snzTried = 0;
  function armSnooze() {
    clearTimeout(snzTimer);
    var now = Date.now(), list = data.snoozes || [];
    if (!list.length) return;
    // due ones that could not be woken (offline, no password…): a minute on
    if (SN.due(list, now).length) { snzTimer = setTimeout(wakeSnoozed, Math.max(1500, snzTried + 60000 - now)); return; }
    var n = SN.next(list, now);
    if (!n) return;
    try { parent.__orosMailNotify.due(n); } catch (e) {}     // the shell wakes it should Mail close
    snzTimer = setTimeout(wakeSnoozed, Math.min(3600000, Math.max(1000, n - now + 500)));
  }
  // the whole folder's headers (up to KEEP_HEADS), or as many as came
  function listAll(acct, folder) {
    return refreshFolder(acct, folder, false).then(function next(rec, n) {
      n = n || 0;
      if (!rec.more || n >= 9) return rec;
      return refreshFolder(acct, folder, true).then(function (r2) { return next(r2, n + 1); });
    });
  }
  function wakeSnoozed() {
    if (waking) return Promise.resolve();
    var now = Date.now();
    var due = SN.due(data.snoozes, now);
    if (!due.length) { armSnooze(); return Promise.resolve(); }
    snzTried = now;
    if (!navigator.onLine || !relayUrl()) { armSnooze(); return Promise.resolve(); }
    waking = true;
    var ids = [];
    due.forEach(function (r) { if (ids.indexOf(r.acct) < 0) ids.push(r.acct); });
    var woke = 0;
    return ids.reduce(function (p, id) {
      return p.then(function () {
        var acct = acctById(id);
        if (!acct || needPass[acct.id] || !folders[acct.id]) return;
        var fname = roleFolder(acct, "snoozed");
        if (!fname) { dropSnoozes(SN.due(SN.forAcct(data.snoozes, acct.id), now)); return; }
        return listAll(acct, fname).then(function (rec) {
          var plan = SN.plan(data.snoozes, acct.id, rec.msgs.map(function (m) { return { uid: m.uid, key: SN.keyOf(m) }; }), now, !rec.more);
          var gone = plan.gone.slice();
          if (!plan.wake.length) { dropSnoozes(gone); return; }
          var uids = plan.wake.map(function (w) { return w.uid; });
          var byDest = {};
          plan.wake.forEach(function (w) { (byDest[w.rec.from] = byDest[w.rec.from] || []).push(w); });
          return call("flag", acct, { folder: fname, uids: uids.slice(0, 500), add: [], remove: ["\\Seen"] }).catch(function () {}).then(function () {
            return Object.keys(byDest).reduce(function (q, dest) {
              return q.then(function () {
                var ws = byDest[dest], us = ws.map(function (w) { return w.uid; });
                function ok() { woke += us.length; ws.forEach(function (w) { if (gone.indexOf(w.rec) < 0) gone.push(w.rec); }); }
                return call("move", acct, { folder: fname, uids: us.slice(0, 500), to: dest }).then(ok, function () {
                  // the folder it came from is gone: the Inbox then
                  if (dest === "INBOX") return;
                  return call("move", acct, { folder: fname, uids: us.slice(0, 500), to: "INBOX" }).then(ok, function () {});
                });
              });
            }, Promise.resolve());
          }).then(function () {
            dropSnoozes(gone);
            rec.msgs = rec.msgs.filter(function (m) { return uids.indexOf(m.uid) < 0; });
            return saveHeads(rec);
          });
        }, function () {});
      });
    }, Promise.resolve()).then(function () {
      waking = false;
      armSnooze();
      if (woke) {
        showToast(t("snz.woke", { n: woke }));
        if (curAcct()) refreshFolders(curAcct()).catch(function () {});
        refreshCurrent(false);
      }
    });
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
      sieveSoon(acct.id);
      data.rules = rr.rules;
      data = mergeMail(data, data);
      saveData();
    }
    var open = curAcct() && curAcct().id === acct.id && !uni ? renamedPath(prefs.folder, from, to === null ? from : to, delim) : null;
    if (open !== null) openFolder(acct.id, to === null ? "INBOX" : open);
  }

  // The organise buttons for `keys` (reader bar and selection bar);
  // in All inboxes they may span accounts (see groupsOf).
  function orgButtons(box, keys, compact) {
    var gs = groupsOf(keys);
    if (!gs.length) return;
    var roles = gs.map(roleOf);
    var role = roles.every(function (r) { return r === roles[0]; }) ? roles[0] : "";
    var ms = allMsgs(gs);
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
    if (role !== "archive") ib("archive", t("org.archive") + " (e)", function () { moveMsgs(keys, "archive"); });
    var erase = gs.every(function (g, i) { return roles[i] === "trash" || roles[i] === "junk" || !roleFolder(g.acct, "trash"); });
    ib("trash", t(erase ? "org.erase" : "org.trash") + " (Del)", function () { moveMsgs(keys, "trash"); }, erase ? "danger" : "");
    if (role === "junk") ib("inbox", t("org.notspamBtn"), function () { moveMsgs(keys, "notspam"); });
    else if (gs.some(function (g) { return roleFolder(g.acct, "junk"); })) ib("spam", t("org.spamBtn") + " (!)", function () { moveMsgs(keys, "spam"); });
    if (role === "snoozed") {
      ib("inbox", t("snz.back"), function () { unsnooze(keys); });
      ib("clock", t("snz.again") + " (b)", function () { snoozeDialog(keys); });
    } else if (role !== "drafts" && role !== "trash" && role !== "junk" && role !== "sent") {
      ib("clock", t("snz.btn") + " (b)", function () { snoozeDialog(keys); });
    }
    ib(allStar ? "star" : "starOff", t(allStar ? "org.unstar" : "org.star") + " (s)", function () { setFlags(keys, allStar ? "unstar" : "star"); }, allStar ? "on" : "");
    ib(anyUnread ? "open" : "unread", t(anyUnread ? "org.read" : "org.unread") + " (u)", function () { setFlags(keys, anyUnread ? "read" : "unread"); });
    if (gs.length === 1) ib("folder", t("org.move") + " (v)", function () { moveDialog(keys); });
    if (ms.length === 1 && ms[0].from && ms[0].from.addr) {
      var acct = gs[0].acct;
      ib("filter", t("rule.make"), function () { ruleDialog(null, { field: "from", has: lowerAddr(ms[0].from.addr), acct: acct.id }); });
      if (lowerAddr(ms[0].from.addr) !== lowerAddr(acct.email)) ib("block", t("blk.btn"), function () { blockDialog(ms[0], acct); });
    }
  }

  // ---------- this message in other orOS apps ----------
  // Shell deep links (__orosOpenAt); every one is a prefill the person
  // confirms there, except Notes, whose contract makes the page at once.
  //   todo      { addItems: { from, items: [{ text, note }] } }
  //   notes     { add: { title, text } }
  //   bookmarks { add: { url, title } }
  //   contacts  { add: { email, name } }
  //   crm       { log: { email, name?, subject?, text?, at? } } (BR-CRM-MAIL)
  //   assistant { ask } (≤ 2000 characters; never sent by itself)
  // Is that app installed? (shell list; unknown → assume yes)
  function appThere(id) {
    try {
      var f = window.parent.orosAssistInstalled;
      if (typeof f !== "function") return true;
      return f().some(function (a) { return a && a.id === id; });
    } catch (e) { return true; }
  }
  function shellApps() {
    try { return window.parent !== window && typeof window.parent.__orosOpenAt === "function" ? window.parent : null; }
    catch (e) { return null; }
  }
  function msgText(p) {
    var s = p.text !== null ? p.text : (p.html !== null ? htmlText(p.html) : "");
    return String(s || "").replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  // http(s) links of the message, text first seen as their title
  function msgLinks(p) {
    var out = [], seen = {};
    function add(url, title) {
      url = String(url || "").trim();
      if (!/^https?:\/\/[^\s]+$/i.test(url) || seen[url] || out.length >= 30 || url.length > 2000) return;
      seen[url] = 1;
      out.push({ url: url, title: String(title || "").replace(/\s+/g, " ").trim().slice(0, 200) });
    }
    if (p.html !== null) {
      // DOMParser documents run no scripts and load nothing
      var doc = new DOMParser().parseFromString(String(p.html), "text/html");
      [].forEach.call(doc.querySelectorAll("a[href]"), function (a) { add(a.getAttribute("href"), a.textContent); });
    }
    if (p.text !== null) M.splitLinks(p.text).forEach(function (seg) { if (seg.href) add(seg.href, ""); });
    return out;
  }
  function msgHead(m) {
    return t("to.from") + " " + C.fmtInput(m.from || { addr: "" }) + "\n" + t("to.date") + " " + fmtFullDate(m.date);
  }
  function appsDialog(m, p) {
    var sh = shellApps();
    if (!sh) return;
    var dlg = makeDialog("ml-apps");
    dlg.appendChild(el("div", "dlg-title", t("to.title")));
    var subj = m.subj || t("read.nosubj");
    var body = msgText(p);
    var ul = el("ul", "set-accts apps-list");
    function item(label, hint, fn) {
      var li = el("li");
      var b = el("button", "tpl-use");
      b.type = "button";
      b.appendChild(el("span", "set-acct-name", label));
      if (hint) b.appendChild(el("span", "set-acct-mail", hint));
      b.addEventListener("click", fn);
      li.appendChild(b);
      ul.appendChild(li);
    }
    function go(app, target) { dlg.close(); sh.__orosOpenAt(app, target); }
    item(t("to.todo"), t("to.todoHint"), function () {
      go("todo", { addItems: { from: t("to.app"), items: [{ text: subj.slice(0, 300), note: (msgHead(m) + "\n\n" + body).slice(0, 1000) }] } });
    });
    item(t("to.note"), t("to.noteHint"), function () {
      go("notes", { add: { title: subj.slice(0, 200), text: (msgHead(m) + "\n" + t("to.subj") + " " + subj + "\n\n" + body).slice(0, 20000) } });
    });
    var links = msgLinks(p);
    item(t("to.link"), links.length ? t("to.linkHint", { n: links.length }) : t("to.nolinks"), function () {
      if (!links.length) return;
      if (links.length === 1) { go("bookmarks", { add: { url: links[0].url, title: links[0].title || subj.slice(0, 200) } }); return; }
      linksDialog(links, function (x) { sh.__orosOpenAt("bookmarks", { add: { url: x.url, title: x.title || subj.slice(0, 200) } }); });
    });
    // BR-TRAVEL-MAIL (owner Travel, wave 31): a message carrying schema.org
    // booking data goes to Travel, which parses it in an inert document
    // and asks before adding anything. Only the message's own HTML / text
    // travels (≤ 1 MB); nothing is written here.
    if (travelBooking(p) && appThere("travel")) {
      item(t("to.travel"), t("to.travelHint"), function () {
        go("travel", { importMail: { subject: subj.slice(0, 200), html: String(p.html || "").slice(0, 1000000),
                                     text: p.html ? "" : String(p.text || "").slice(0, 1000000) } });
      });
    }
    var from = m.from || {};
    var acct = curAcct();
    if (from.addr && !(acct && lowerAddr(acct.email) === lowerAddr(from.addr))) {
      item(t("to.contact"), from.name ? from.name + " <" + from.addr + ">" : from.addr, function () {
        go("contacts", { add: { email: from.addr, name: from.name || "" } });
      });
    }
    function ask(lead) {
      var head = lead + "\n\n" + msgHead(m) + "\n" + t("to.subj") + " " + subj + "\n\n";
      var room = 2000 - head.length;
      return head + (body.length > room ? body.slice(0, Math.max(0, room - 1)) + "\u2026" : body);
    }
    // CRM (BR-CRM-MAIL): the other person — the sender, or the first
    // recipient of a message we sent. Prefills a log entry there.
    var mine = function (x) { return x && x.addr && data.accounts.some(function (a) { return lowerAddr(a.email) === lowerAddr(x.addr); }); };
    var who = mine(from) ? (m.to || []).filter(function (x) { return x && x.addr && !mine(x); })[0] : (from.addr ? from : null);
    if (who && appThere("crm")) {
      item(t("to.crm"), who.name ? who.name + " <" + who.addr + ">" : who.addr, function () {
        var log = { email: lowerAddr(who.addr), subject: subj.slice(0, 200), text: body.slice(0, 1800) };
        if (who.name) log.name = String(who.name).slice(0, 120);
        if (typeof m.date === "number" && isFinite(m.date)) log.at = m.date;
        go("crm", { log: log });
      });
    }
    item(t("to.sum"), t("to.aiHint"), function () { go("assistant", { ask: ask(t("ai.sum")) }); });
    item(t("to.reply"), t("to.aiHint"), function () { go("assistant", { ask: ask(t("ai.reply")) }); });
    // "Send to an app" (shell send/, BR-SEND): every other app that takes text.
    if (sh.orosSend && typeof sh.orosSend.open === "function") {
      item(t("to.other"), t("to.otherHint"), function () {
        dlg.close();
        sh.orosSend.open({ kind: "text", data: { title: subj.slice(0, 200), text: msgHead(m) + "\n" + t("to.subj") + " " + subj + "\n\n" + body } });
      });
    }
    dlg.appendChild(ul);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
  }
  function travelBooking(p) {
    var s = String(p.html !== null && p.html !== undefined ? p.html : (p.text || ""));
    return s.length <= 4000000 && /schema\.org/i.test(s) && /Reservation/.test(s);
  }
  function linksDialog(links, done) {
    var dlg = makeDialog("ml-links");
    dlg.appendChild(el("div", "dlg-title", t("to.pick")));
    var ul = el("ul", "set-accts apps-list");
    links.forEach(function (x) {
      var li = el("li");
      var b = el("button", "tpl-use");
      b.type = "button";
      if (x.title) b.appendChild(el("span", "set-acct-name", x.title));
      b.appendChild(el("span", "set-acct-mail", x.url));
      b.addEventListener("click", function () { dlg.close(); done(x); });
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

  // ---------- templates (synced) ----------
  // o: { current() → { subject, html }, use(template) }
  function putTpl(x) {
    data.templates = (data.templates || []).filter(function (y) { return y.id !== x.id; }).concat([x]);
    data = mergeMail(data, data);
    saveData();
  }
  function dropTpl(x) {
    data.tombs[x.id] = Math.max(Date.now(), x.m + 1);
    data = mergeMail(data, data);
    saveData();
  }
  function templatesDialog(o) {
    var dlg = makeDialog("ml-tpl");
    dlg.appendChild(el("div", "dlg-title", t("tpl.title")));
    var list = data.templates || [];
    if (!list.length) dlg.appendChild(el("p", "dlg-hint", t("tpl.none")));
    var ul = el("ul", "set-accts tpl-list");
    list.forEach(function (x) {
      var li = el("li");
      var b = el("button", "tpl-use");
      b.type = "button";
      b.appendChild(el("span", "set-acct-name", x.name));
      var prev = RT.clean(x.html, { cid: false }).text.replace(/\s+/g, " ").trim().slice(0, 90);
      if (prev) b.appendChild(el("span", "set-acct-mail", prev));
      b.addEventListener("click", function () { dlg.close(); o.use(x); });
      li.appendChild(b);
      var del = el("button", "icon-btn small");
      del.type = "button";
      del.innerHTML = UI.trash;
      del.title = t("tpl.del");
      del.setAttribute("aria-label", t("tpl.del") + ": " + x.name);
      del.addEventListener("click", function () { dropTpl(x); dlg.close(); templatesDialog(o); });
      li.appendChild(del);
      ul.appendChild(li);
    });
    if (list.length) dlg.appendChild(ul);
    var form = el("form");
    form.noValidate = true;
    var fName = field(form, "ml-tpl-name", t("tpl.saveAs"), "text", "", { maxlength: "60", placeholder: t("tpl.namePh") });
    var errP = el("p", "dlg-err");
    errP.setAttribute("role", "alert");
    form.appendChild(errP);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("set.close"), "", function () { dlg.close(); }));
    var ok = button(t("tpl.save"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = fName.value.replace(/\s+/g, " ").trim();
      if (!name) { errP.textContent = t("tpl.noName"); fName.focus(); return; }
      var cur = o.current();
      if (!RT.clean(cur.html, { cid: false }).text.trim()) { errP.textContent = t("tpl.empty"); return; }
      if (cur.html.length > MAX_TPL_HTML) { errP.textContent = t("tpl.long"); return; }
      if ((data.templates || []).length >= MAX_TPLS) { errP.textContent = t("tpl.many", { n: MAX_TPLS }); return; }
      var same = (data.templates || []).filter(function (x) { return x.name.toLowerCase() === name.toLowerCase(); })[0];
      putTpl({ id: same ? same.id : newId(), m: Math.max(Date.now(), same ? same.m + 1 : 0), name: name,
               subject: cur.subject.replace(/\s+/g, " ").trim().slice(0, 300), html: cur.html });
      dlg.close();
      showToast(t("tpl.saved", { name: name }));
    });
    dlg.appendChild(form);
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  // ---------- block sender ----------
  // A rule (from contains <address> → move to Spam) plus this message
  // to Spam now. Unblocking = removing the rule in Settings › Rules.
  function junkFolder(acct) {
    var name = roleFolder(acct, "junk");
    if (name) return Promise.resolve(name);
    name = newFolderName(acct, "Junk");
    return call("create", acct, { folder: name }).then(function () {
      return refreshFolders(acct).catch(function () {});
    }).then(function () { return name; });
  }
  function blockDialog(m, acct0) {
    var acct = acct0 || curAcct();
    var addr = m && m.from && lowerAddr(m.from.addr);
    if (!acct || !addr || !cur) return;
    var key = uni ? acct.id + ":" + m.uid : m.uid;
    var dlg = makeDialog("ml-block");
    dlg.appendChild(el("p", "dlg-text", t("blk.q", { addr: addr })));
    var errP = el("p", "dlg-err");
    errP.setAttribute("role", "alert");
    dlg.appendChild(errP);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    var go = button(t("blk.do"), "danger", function () {
      if (!online()) return;
      go.disabled = true;
      var g0 = groupsOf([key])[0] || null;
      junkFolder(acct).then(function (folder) {
        var has = "<" + addr + ">";
        var exists = (data.rules || []).some(function (r) { return r.acct === acct.id && r.field === "from" && r.act === "move" && r.has === has; });
        if (!exists) {
          var r = R.norm({ id: newId(), m: Date.now(), on: true, acct: acct.id, field: "from", has: has, act: "move", to: folder });
          if (r) putRule(r);
        }
        dlg.close();
        var g1 = groupsOf([key])[0] || null;
        if (g0 && g1 && g1.rec === g0.rec && g1.rec.folder !== folder) moveMsgs([key], "move", folder);
        else showToast(t("blk.done", { addr: addr }));
      }, function (e) { go.disabled = false; errP.textContent = errText(e); });
    });
    acts.appendChild(go);
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
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
    (data.rules || []).forEach(function (x) { if (x.id === r.id && x.acct !== r.acct) sieveSoon(x.acct); });
    sieveSoon(r.acct);
    data.rules = (data.rules || []).filter(function (x) { return x.id !== r.id; }).concat([r]);
    data = mergeMail(data, data);
    saveData();
  }
  function dropRule(r) {
    sieveSoon(r.acct);
    data.tombs[r.id] = Math.max(Date.now(), r.m + 1);
    data = mergeMail(data, data);
    saveData();
  }
  function rulesList(box) {
    box.innerHTML = "";
    var list = data.rules || [];
    data.accounts.forEach(function (a) {
      if (a.sieve && a.sieve.on) box.appendChild(el("p", "dlg-hint", t("srv.hintRules", { email: a.email })));
    });
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
    var acct0 = (rule && acctById(rule.acct)) || (prefill && prefill.acct && acctById(prefill.acct)) || curAcct() || data.accounts[0];
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

  // ---------- 9d2. Rules and out-of-office reply on the server ----------
  // Servers with ManageSieve (Dovecot / Cyrus based hosts) keep the
  // account's rules and the reply as one Sieve script (sieve.js) that
  // the relay uploads (op "sieve"). Then the server runs them with orOS
  // closed, and the device leaves those rules to it (notify.js). Gmail,
  // Outlook, Yahoo: no ManageSieve, the rules stay on the devices.
  var sieveDue = {}, sieveTimer = null, sieveSent = {};
  function sieveArgs(sv, args) {
    if (sv && sv.host) args.host = sv.host;
    return args;
  }
  function sieveScript(acct, ext, away) {
    return SV.build({ ext: ext, away: away, folder: function (f) { return M.utf7Decode(f); },
                      rules: (data.rules || []).filter(function (r) { return r.acct === acct.id; }) });
  }
  // A rule changed: re-upload the scripts of the accounts it touches.
  function sieveSoon(acctId) {
    var a = acctById(acctId);
    if (!a || !a.sieve || !a.sieve.on) return;
    sieveDue[acctId] = 1;
    clearTimeout(sieveTimer);
    sieveTimer = setTimeout(sieveFlush, 1500);
  }
  function sieveFlush() {
    var ids = Object.keys(sieveDue);
    sieveDue = {};
    ids.forEach(function (id) {
      var a = acctById(id);
      if (!a || !a.sieve || !a.sieve.on) return;
      var script = sieveScript(a, a.sieve.ext, a.away).script;
      if (sieveSent[id] === script) return;
      call("sieve", a, sieveArgs(a.sieve, { act: "put", script: script })).then(function () {
        sieveSent[id] = script;
      }, function (e) {
        showToast(t("srv.fail", { msg: errText(e) }));
      });
    });
  }
  function patchAcct(id, part) {
    var a = acctById(id);
    if (!a) return null;
    var n = normAccount(Object.assign({}, a, part, { m: Math.max(Date.now(), a.m + 1) }));
    if (!n) return null;
    data.accounts = data.accounts.filter(function (x) { return x.id !== id; }).concat([n]);
    data = mergeMail(data, data);
    saveData();
    return n;
  }
  function checkBox(box, label, on) {
    var lab = el("label", "check");
    var cb = el("input");
    cb.type = "checkbox";
    cb.checked = !!on;
    lab.appendChild(cb);
    lab.appendChild(el("span", "", label));
    box.appendChild(lab);
    return cb;
  }

  function serverDialog(acct0) {
    var acct = acctById(acct0.id) || acct0;
    var sv = acct.sieve || { on: false, host: "", prev: "", ext: [] };
    var aw = acct.away || SV.normAway({});
    var dlg = makeDialog("ml-srv", true);
    dlg.classList.add("wide");
    dlg.appendChild(el("div", "dlg-title", t("srv.title")));
    dlg.appendChild(el("p", "dlg-hint", acct.email));
    var state = el("p", "dlg-text", t("srv.checking"));
    state.setAttribute("role", "status");
    dlg.appendChild(state);
    var local = button(t("srv.local"), "small", function () {
      patchAcct(acct.id, { sieve: Object.assign({}, sv, { on: false, prev: "" }) });
      dlg.close();
      showToast(t("srv.offDone"));
    });
    local.hidden = true;
    dlg.appendChild(local);

    var form = el("form");
    form.method = "dialog";
    form.noValidate = true;
    form.hidden = true;
    var cbUse = checkBox(form, t("srv.use"), sv.on);
    var otherP = el("p", "dlg-hint");
    form.appendChild(otherP);
    var skipP = el("p", "dlg-hint");
    form.appendChild(skipP);
    form.appendChild(el("div", "dlg-lbl srv-sec", t("away.title")));
    var cbAway = checkBox(form, t("away.on"), aw.on);
    var fSubj = field(form, "ml-aw-subj", t("away.subj"), "text", aw.subject, { maxlength: "200" });
    var txLab = el("label", "dlg-lbl", t("away.text"));
    txLab.setAttribute("for", "ml-aw-text");
    form.appendChild(txLab);
    var fText = el("textarea");
    fText.id = "ml-aw-text";
    fText.rows = 5;
    fText.maxLength = 4000;
    fText.value = aw.text;
    form.appendChild(fText);
    var dates = el("div", "aw-dates");
    var dFrom = el("div"), dTo = el("div");
    var fFrom = field(dFrom, "ml-aw-from", t("away.from"), "date", aw.start, {});
    var fTo = field(dTo, "ml-aw-to", t("away.to"), "date", aw.end, {});
    dates.appendChild(dFrom);
    dates.appendChild(dTo);
    form.appendChild(dates);
    var fDays = portSelect(form, "ml-aw-days", t("away.days"), [1, 3, 7, 14, 30].map(function (n) {
      return [n, n === 1 ? t("away.days1") : t("away.daysN", { n: n })];
    }), aw.days);
    var noteP = el("p", "dlg-hint");
    form.appendChild(noteP);
    var errP = el("p", "dlg-err");
    errP.setAttribute("role", "alert");
    form.appendChild(errP);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    var ok = button(t("dlg.save"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);
    dlg.appendChild(form);

    // another address for ManageSieve (rare)
    var adv = el("details", "srv");
    adv.appendChild(el("summary", "", t("srv.host")));
    var advForm = el("div");
    var fHost = field(advForm, "ml-srv-host", t("srv.host"), "text", sv.host, { maxlength: "253", autocapitalize: "off", spellcheck: "false", placeholder: acct.imap.host });
    advForm.appendChild(el("p", "dlg-hint", t("srv.hostHint")));
    advForm.appendChild(button(t("srv.retry"), "small", function () { probe(); }));
    adv.appendChild(advForm);
    if (sv.host) adv.open = true;
    dlg.appendChild(adv);
    var close = el("div", "dlg-actions");
    close.appendChild(button(t("set.close"), "", function () { dlg.close(); }));
    dlg.appendChild(close);

    var ext = sv.ext, host = sv.host, other = "";
    function notes() {
      var can = ext.indexOf("vacation") >= 0;
      cbAway.disabled = !can;
      var n = [];
      if (!can) n.push(t("away.noVac"));
      else if (!cbUse.checked && cbAway.checked) n.push(t("away.needOn"));
      else if ((fFrom.value || fTo.value) && !(ext.indexOf("date") >= 0 && ext.indexOf("relational") >= 0)) n.push(t("away.noDates"));
      noteP.textContent = n.join(" ");
      [fSubj, fText, fFrom, fTo, fDays].forEach(function (x) { x.disabled = !can || !cbAway.checked; });
      otherP.textContent = other && cbUse.checked && !sv.on ? t("srv.other", { name: other }) : "";
      var skip = (data.rules || []).filter(function (r) { return r.acct === acct.id && r.on !== false && !SV.runs(r, ext); }).length;
      skipP.textContent = skip && cbUse.checked ? t("srv.skip", { n: skip }) : "";
    }
    [cbUse, cbAway, fFrom, fTo].forEach(function (x) { x.addEventListener("change", notes); });

    function probe() {
      var h = fHost.value.trim();
      var nh = h ? normHost(h) : "";
      if (h && !nh) { state.textContent = t("err.host"); return; }
      state.textContent = t("srv.checking");
      form.hidden = true;
      close.hidden = false;
      local.hidden = true;
      call("sieve", acct, sieveArgs({ host: nh }, { act: "check" })).then(function (d) {
        host = nh;
        ext = SV.normExt(d && d.ext);
        other = d && d.active && d.active !== "orOS" ? String(d.active) : "";
        state.textContent = t("srv.yes");
        form.hidden = false;
        close.hidden = true;
        notes();
      }, function (e) {
        var code = e && e.code;
        state.textContent = code === "auth" ? t("srv.noAuth") :
          ["connect", "timeout", "closed", "tls", "proto"].indexOf(code) >= 0 ? t("srv.no") : errText(e);
        local.hidden = !sv.on;
      });
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      errP.textContent = "";
      var away = SV.normAway({ on: cbAway.checked, subject: fSubj.value, text: fText.value, days: +fDays.value,
                               start: fFrom.value, end: fTo.value, m: Date.now() });
      if (cbAway.checked && !away.text) { errP.textContent = t("away.needText"); return; }
      if (cbAway.checked && !cbUse.checked) { errP.textContent = t("away.needOn"); return; }
      ok.disabled = true;
      var step;
      if (cbUse.checked) {
        var script = sieveScript(acct, ext, away).script;
        step = call("sieve", acct, sieveArgs({ host: host }, { act: "put", script: script })).then(function (r) {
          sieveSent[acct.id] = script;
          return { on: true, host: host, ext: ext, prev: (r && r.prev) || (sv.on && sv.prev) || "" };
        });
      } else if (sv.on) {
        step = call("sieve", acct, sieveArgs({ host: host }, { act: "off", prev: sv.prev || "" })).then(function () {
          delete sieveSent[acct.id];
          return { on: false, host: host, ext: ext, prev: "" };
        });
      } else step = Promise.resolve({ on: false, host: host, ext: ext, prev: "" });
      step.then(function (nsv) {
        patchAcct(acct.id, { sieve: nsv, away: away });
        dlg.close();
        showToast(t(nsv.on ? "srv.saved" : sv.on ? "srv.offDone" : "toast.saved"));
      }, function (err) {
        ok.disabled = false;
        errP.textContent = errText(err);
      });
    });
    document.body.appendChild(dlg);
    dlg.showModal();
    probe();
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
  // selected keys: UIDs, or "acctId:uid" in All inboxes
  function selUids() { return sel ? Object.keys(sel).map(function (k) { return uni ? k : Number(k); }) : []; }
  // every row's key in All inboxes (conversations: all their messages)
  function uniKeys() {
    var out = [];
    if (uni) uniGroups().forEach(function (g) { g.msgs.forEach(function (m) { out.push(g.acct + ":" + m.uid); }); });
    return out;
  }
  function toggleSel(uid) {
    if (!sel) sel = {};
    if (sel[uid]) delete sel[uid]; else sel[uid] = 1;
    renderList();
  }
  function renderSelBar() {
    var bar = $("sel-bar");
    bar.innerHTML = "";
    bar.hidden = !sel;
    var every = uni ? uniKeys() : (cur ? shown().map(function (m) { return m.uid; }) : []);
    $("sel-btn").hidden = !!sel || !every.length;
    $("sel-btn").textContent = t("org.select");
    if (!sel) return;
    var uids = selUids();
    var all = el("input");
    all.type = "checkbox";
    all.className = "sel-all";
    all.checked = !!(every.length && uids.length === every.length);
    all.setAttribute("aria-label", t("org.all"));
    all.addEventListener("change", function () {
      sel = {};
      if (all.checked) every.forEach(function (k) { sel[k] = 1; });
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
  function wireSwipe(btn, key) {
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
        moveMsgs([key], dx > 0 ? "archive" : "trash");
      }
    }
    btn.addEventListener("pointerup", end);
    btn.addEventListener("pointercancel", function () { x0 = null; btn.style.transform = ""; btn.classList.remove("swipe-r", "swipe-l"); });
  }

  // ---------- 9e. List-Unsubscribe (unsub.js) ----------
  // A bar on mailing-list mail. mailto: sends the unsubscribe message
  // through the normal send path after a question; http(s): shows the
  // address, then opens it in a new tab. The RFC 8058 one-click POST
  // would need the relay (a page cannot POST to another site), so it
  // is not made.
  function renderUnsub(p, m, bars) {
    if (!US || !p || !p.headers) return;
    var role = folderRole(currentFolder() || {});
    if (role === "sent" || role === "drafts") return;
    var u = US.parse(p.headers);
    if (!u) return;
    var bar = el("div", "bar unsub");
    bar.appendChild(el("span", "", t("uns.bar") + (m.from && (m.from.name || m.from.addr) ? " · " + (m.from.name || m.from.addr) : "")));
    var acts = el("span", "bar-acts");
    var b = el("button", "link-btn", t("uns.btn"));
    b.type = "button";
    b.addEventListener("click", function () { unsubDialog(u); });
    acts.appendChild(b);
    bar.appendChild(acts);
    bars.appendChild(bar);
  }
  function unsubDialog(u) {
    var acct = (openMsg && acctById(openMsg.acct)) || curAcct();
    if (!acct) return;
    var dlg = makeDialog("ml-unsub");
    dlg.appendChild(el("div", "dlg-title", t("uns.title")));
    dlg.appendChild(el("p", "dlg-hint", t("uns.warn")));
    var errP = el("p", "dlg-err");
    errP.setAttribute("role", "alert");
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    if (u.web) {
      dlg.appendChild(el("p", "dlg-text", t("uns.web")));
      dlg.appendChild(el("p", "uns-url", u.web));
      if (/^http:/i.test(u.web)) dlg.appendChild(el("p", "dlg-err", t("uns.http")));
      dlg.appendChild(el("p", "dlg-hint", t("uns.webHint")));
      acts.appendChild(button(t("uns.open"), u.mailto ? "" : "primary", function () {
        dlg.close();
        try { window.open(u.web, "_blank", "noopener,noreferrer"); } catch (e) {}
      }));
    }
    if (u.mailto) {
      dlg.appendChild(el("p", "dlg-text", t("uns.mail", { to: u.mailto.to, from: acct.email })));
      var sb = button(t("uns.send"), "primary", function () {
        if (!acct.smtp) { errP.textContent = t("err.nosmtp"); return; }
        var d = { acct: acct.id, to: [{ name: "", addr: u.mailto.to }], cc: [], bcc: [],
                  subject: u.mailto.subject || "unsubscribe", text: u.mailto.body || "unsubscribe", html: "",
                  inReplyTo: "", references: "", atts: [] };
        sb.disabled = true;
        function queue() {
          return queueDraft(d).then(function () { dlg.close(); showToast(t("toast.queued")); },
            function (e) { sb.disabled = false; errP.textContent = sendErrText(e); });
        }
        if (!navigator.onLine) { queue(); return; }
        sendDraft(d).then(function () {
          dlg.close();
          showToast(t("uns.sent", { to: u.mailto.to }));
        }, function (e) {
          if (waitsForNet(e)) { queue(); return; }
          sb.disabled = false;
          errP.textContent = sendErrText(e);
        });
      });
      acts.appendChild(sb);
    }
    dlg.appendChild(errP);
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  // ---------- 9f. OpenPGP (pgp.js + pgpmime.js) ----------
  // Keys: device-local (IndexedDB store "pgp"); the library loads on
  // first use. Sending: the message's content is built as one MIME
  // part, then signed (multipart/signed) and / or encrypted
  // (multipart/encrypted, to every recipient and to the sender, signed
  // inside) and handed to compose.js build() as o.part, so the Outbox,
  // Undo send and Send later keep the finished, locked message.
  // Reading: PGP/MIME and inline armor. A decrypted message lives only
  // in memory (openMsg), never in the cache.
  var pgpReady = null;
  function pgpInit() {
    if (!PG) return Promise.resolve([]);
    if (!pgpReady) {
      pgpReady = PG.init({
        all: function () { return idb("pgp", "readonly", function (s) { return s.getAll(); }); },
        put: function (k, v) { return idbPut("pgp", k, v); },
        del: function (k) { return idbDel("pgp", k); }
      });
    }
    return pgpReady;
  }
  function pgpErr(e) {
    var msg = e && e.message ? String(e.message) : String(e || "");
    if (msg === "lib") return t("pgp.loadFail");
    return msg.replace(/^Error[^:]*:\s*/, "").slice(0, 200);
  }
  function keyWho(k) { return k ? (k.name ? k.name + (k.emails[0] ? " <" + k.emails[0] + ">" : "") : (k.emails[0] || PG.short(k.fpr))) : ""; }

  // Asks the passphrase of one of `metas` (own keys) unless one is
  // still unlocked. → Promise<unlocked key | null (cancelled)>
  function unlockKey(metas) {
    for (var i = 0; i < metas.length; i++) {
      var c = PG.cached(metas[i].fpr);
      if (c) return Promise.resolve(c);
    }
    var meta = metas[0];
    return new Promise(function (resolve) {
      var done = false;
      var dlg = makeDialog("ml-unlock", true);
      dlg.appendChild(el("div", "dlg-title", t("pgp.pass")));
      dlg.appendChild(el("p", "dlg-text", t("pgp.unlockText", { email: meta.emails[0] || meta.name, fpr: PG.short(meta.fpr) })));
      var form = el("form");
      form.noValidate = true;
      var inp = field(form, "ml-unlock-pw", t("pgp.pass"), "password", "", { autocomplete: "current-password", maxlength: "500" });
      var errP = el("p", "dlg-err");
      errP.setAttribute("role", "alert");
      form.appendChild(errP);
      var acts = el("div", "dlg-actions");
      acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
      var ok = button(t("pgp.unlock"), "primary", null);
      ok.type = "submit";
      acts.appendChild(ok);
      form.appendChild(acts);
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        if (!inp.value) return;
        ok.disabled = true;
        errP.textContent = "";
        PG.unlock(meta, inp.value).then(function (k) {
          done = true;
          dlg.close();
          resolve(k);
        }, function (er) {
          ok.disabled = false;
          errP.textContent = er && er.message === "lib" ? t("pgp.loadFail") : t("pgp.wrong");
          inp.select();
        });
      });
      dlg.addEventListener("cancel", function (e) { e.preventDefault(); dlg.close(); });
      dlg.addEventListener("close", function () { if (!done) resolve(null); });
      dlg.appendChild(form);
      document.body.appendChild(dlg);
      dlg.showModal();
      inp.focus();
    });
  }

  // d: a draft from the composer; o: { sign, encrypt } → Promise<d with
  // d.part> or rejects with MailError("pgp", text) / null (cancelled)
  function pgpPrepare(d, o) {
    var acct = acctById(d.acct);
    if (!acct) return Promise.reject(new MailError("noacct"));
    return pgpInit().then(function () {
      var own = PG.forEmail(acct.email, true);
      if (!own.length) throw new MailError("pgp", t("pgp.noOwn", { email: acct.email }));
      var keys = [];
      if (o.encrypt) {
        var missing = [];
        [].concat(d.to, d.cc, d.bcc).forEach(function (p) {
          var k = PG.forEmail(p.addr, false);
          if (!k.length) { if (missing.indexOf(p.addr) < 0) missing.push(p.addr); }
          else if (keys.indexOf(k[0]) < 0) keys.push(k[0]);
        });
        if (missing.length) throw new MailError("pgp", t("pgp.missing", { list: missing.join(", ") }));
        if (keys.indexOf(own[0]) < 0) keys.push(own[0]);   // the copy in Sent stays readable
      }
      var rich = d.html ? RT.clean(d.html, { cid: true }) : null;
      var part = C.content({ text: d.text, html: rich ? rich.html : "", inline: rich ? rich.inline : [],
                             attachments: d.atts || [], safe: true });
      var entity = PM.entity(part);
      return (o.sign ? unlockKey(own) : Promise.resolve(null)).then(function (priv) {
        if (o.sign && !priv) return null;
        var job = o.encrypt ? PG.encrypt(entity, keys, priv).then(PM.encrypted)
          : PG.sign(entity, priv).then(function (s) { return PM.signed(part, s.armored, s.micalg); });
        return job.then(function (wrapped) {
          var out = Object.assign({}, d);
          out.part = wrapped;
          out.pgp = { sign: !!o.sign, encrypt: !!o.encrypt };
          if (out.part.body.length > MSG_MAX) throw new MailError("big");
          return out;
        });
      }, function (e) { throw e; });
    }).catch(function (e) {
      if (e instanceof MailError) throw e;
      throw new MailError("pgp", t("pgp.failed", { msg: pgpErr(e) }));
    });
  }

  // what the open message carries: PGP/MIME, inline armor, or nothing
  function pgpInfo(bin, p) {
    if (!PM) return null;
    var f = null;
    try { f = PM.find(bin); } catch (e) {}
    if (f) return { kind: f.kind, armored: f.armored || "", entity: f.entity || "", sig: f.sig || "", state: "" };
    var il = p && p.text !== null ? PM.inline(p.text) : null;
    if (il) return { kind: il.kind, armored: il.armored, before: il.before, after: il.after, state: "" };
    return null;
  }
  // after the message is parsed: check a signature when this device
  // has keys (else on request: it loads the library)
  function pgpAuto() {
    var info = openMsg && openMsg.pgp;
    if (!info || !PG) return;
    pgpInit().then(function () {
      if ((info.kind === "signed" || info.kind === "inline-signed") && PG.list().length) pgpVerify();
    });
  }
  function pgpVerify() {
    var info = openMsg && openMsg.pgp, uid = openMsg && openMsg.uid;
    if (!info || info.state === "busy") return;
    info.state = "busy";
    renderReader();
    var job = info.kind === "signed" ? PG.verifyDetached(PM.crlf(info.entity), info.sig)
      : PG.verifyClear(info.armored).then(function (r) {
          if (openMsg && openMsg.uid === uid && openMsg.parsed) {
            openMsg.parsed = Object.assign({}, openMsg.parsed, { text: (info.before || "") + r.text + (info.after || ""), html: null });
          }
          return r.sig;
        });
    job.then(function (st) {
      if (!openMsg || openMsg.uid !== uid) return;
      info.state = "ok";
      info.result = st;
      renderReader();
    }, function (e) {
      if (!openMsg || openMsg.uid !== uid) return;
      info.state = "err";
      info.err = pgpErr(e);
      renderReader();
    });
  }
  function pgpDecrypt() {
    var info = openMsg && openMsg.pgp, uid = openMsg && openMsg.uid;
    if (!info || info.state === "busy") return;
    info.state = "busy";
    renderReader();
    function fail(e) {
      if (!openMsg || openMsg.uid !== uid) return;
      info.state = "err";
      info.err = pgpErr(e);
      renderReader();
    }
    pgpInit().then(function () { return PG.keysFor(info.armored); }).then(function (ks) {
      if (!openMsg || openMsg.uid !== uid) return;
      if (!ks.length) { info.state = "nokey"; renderReader(); return; }
      return unlockKey(ks).then(function (priv) {
        if (!openMsg || openMsg.uid !== uid) return;
        if (!priv) { info.state = ""; renderReader(); return; }
        return PG.decrypt(info.armored, [priv]).then(function (res) {
          if (!openMsg || openMsg.uid !== uid) return;
          var outer = openMsg.parsed;
          if (info.kind === "inline-enc") {
            var txt = M.decodeCharset(res.bin, "utf-8").replace(/\r\n?/g, "\n");
            openMsg.parsed = Object.assign({}, outer, { text: (info.before || "") + txt + (info.after || ""), html: null });
            info.result = res.sig;
            info.state = "ok";
            renderReader();
            return;
          }
          // PGP/MIME: a MIME entity, maybe signed inside (RFC 3156 §6.1)
          var inner = res.bin, sub = null;
          try { sub = PM.find(inner); } catch (e) {}
          var show = function (st) {
            var np = M.parseMessage(sub && sub.kind === "signed" ? sub.entity : inner);
            np.headers = outer.headers;
            openMsg.parsed = np;
            info.result = st;
            info.state = "ok";
            renderReader();
          };
          if (sub && sub.kind === "signed") {
            return PG.verifyDetached(PM.crlf(sub.entity), sub.sig).then(show, function () { show({ state: "bad", signer: null, keyId: "" }); });
          }
          show(res.sig);
        });
      });
    }).catch(fail);
  }
  // the bar(s) above the message
  function renderPgp(m, bars) {
    var info = openMsg && openMsg.pgp;
    if (info) {
      var enc = info.kind === "encrypted" || info.kind === "inline-enc";
      var bar = el("div", "bar pgp");
      var lead = el("span", "pgp-lead");
      lead.innerHTML = UI.lock;
      bar.appendChild(lead);
      var tx = el("span", "pgp-tx");
      bar.appendChild(tx);
      var acts = el("span", "bar-acts");
      if (info.state === "busy") tx.textContent = enc ? t("pgp.working") : t("pgp.sigChecking");
      else if (info.state === "err") {
        bar.classList.add("warn");
        tx.textContent = enc ? t("pgp.decFail", { msg: info.err || "" }) : t("pgp.failed", { msg: info.err || "" });
        acts.appendChild(retryBtn(enc ? pgpDecrypt : pgpVerify));
      } else if (info.state === "nokey") {
        tx.textContent = t("pgp.encMsg") + " " + t("pgp.noKeyFor");
      } else if (info.state === "ok") {
        tx.textContent = enc ? t("pgp.decrypted") : "";
      } else if (enc) {
        tx.textContent = t("pgp.encMsg");
        var db = el("button", "link-btn", t("pgp.decrypt"));
        db.type = "button";
        db.addEventListener("click", pgpDecrypt);
        acts.appendChild(db);
      } else {
        tx.textContent = t("pgp.signed");
        var vb = el("button", "link-btn", t("pgp.sigCheck"));
        vb.type = "button";
        vb.addEventListener("click", pgpVerify);
        acts.appendChild(vb);
      }
      if (acts.children.length) bar.appendChild(acts);
      if (tx.textContent) bars.appendChild(bar);
      var st = info.state === "ok" ? info.result : null;
      if (st && st.state !== "none") {
        var sb = el("div", "bar pgp");
        var who = keyWho(st.signer);
        var mine = st.signer && m.from && st.signer.emails.indexOf(lowerAddr(m.from.addr)) >= 0;
        if (st.state === "ok" && mine) sb.classList.add("ok");
        else sb.classList.add("warn");
        if (st.state !== "ok" || !mine) sb.setAttribute("role", "alert");
        sb.appendChild(el("span", "", st.state === "ok" ? (mine ? t("pgp.sigOk", { who: who }) : t("pgp.sigOther", { who: who, addr: m.from.addr }))
          : (st.state === "bad" ? t("pgp.sigBad") : t("pgp.sigUnknown", { id: String(st.keyId || "").toUpperCase() }))));
        bars.appendChild(sb);
      }
    }
    // an OpenPGP public key sent along: offer to keep it
    var p = openMsg && openMsg.parsed;
    var keyAtt = p && PG ? (p.attachments || []).filter(function (a) {
      return typeof a.data === "string" && a.data.length < 512 * 1024 &&
        (a.type === "application/pgp-keys" || /\.(asc|pub|gpg|key)$/i.test(a.name)) && PM.isKey(a.data);
    })[0] : null;
    if (keyAtt) {
      var kb = el("div", "bar");
      kb.appendChild(el("span", "", t("pgp.keyAtt")));
      var ka = el("span", "bar-acts");
      var ab = el("button", "link-btn", t("pgp.keyAdd"));
      ab.type = "button";
      ab.addEventListener("click", function () {
        ab.disabled = true;
        pgpInit().then(function () { return PG.importText(keyAtt.data, function () { return Promise.resolve(""); }); }).then(function (r) {
          showToast(t("pgp.impDone", { n: r.added.length, u: r.updated.length }));
        }, function (e) { ab.disabled = false; showToast(e && e.message === "lib" ? t("pgp.loadFail") : t("pgp.impBad")); });
      });
      ka.appendChild(ab);
      kb.appendChild(ka);
      bars.appendChild(kb);
    }
  }
  // OpenPGP's own parts are not shown as attachments
  function pgpPart(a) {
    if (!openMsg || !openMsg.pgp) return false;
    if (a.type === "application/pgp-signature" || a.type === "application/pgp-encrypted") return true;
    return openMsg.pgp.kind === "encrypted" && openMsg.pgp.state !== "ok" && a.type === "application/octet-stream";
  }

  // ---------- OpenPGP keys (Settings) ----------
  function saveText(name, text) {
    saveAttachment({ name: name, data: C.utf8Bin(text) });
  }
  function keyFileName(k, sec) {
    var who = (k.emails[0] || k.fpr.slice(-16)).replace(/[^A-Za-z0-9@._-]+/g, "_");
    return who + (sec ? "-private" : "") + "-" + k.fpr.slice(-8).toUpperCase() + ".asc";
  }
  function keysDialog() {
    pgpInit().then(function () {
      var dlg = makeDialog("ml-keys");
      dlg.classList.add("wide");
      dlg.appendChild(el("div", "dlg-title", t("pgp.title")));
      dlg.appendChild(el("p", "dlg-hint", t("pgp.hint")));
      var all = PG.list();
      [[true, "pgp.own"], [false, "pgp.others"]].forEach(function (sec) {
        dlg.appendChild(el("div", "dlg-lbl", t(sec[1])));
        var ks = all.filter(function (k) { return k.own === sec[0]; });
        if (!ks.length) { dlg.appendChild(el("p", "dlg-hint", t("pgp.none"))); return; }
        var ul = el("ul", "set-accts key-list");
        ks.forEach(function (k) {
          var li = el("li");
          var tx = el("div", "set-acct");
          tx.appendChild(el("div", "set-acct-name", k.name || k.emails[0] || PG.short(k.fpr)));
          if (k.emails.length) tx.appendChild(el("div", "set-acct-mail", k.emails.join(", ")));
          tx.appendChild(el("div", "set-acct-mail key-fpr", t("pgp.fpr", { fpr: PG.short(k.fpr) })));
          li.appendChild(tx);
          var acts = el("div", "out-acts");
          acts.appendChild(button(t("pgp.exportPub"), "small", function () { saveText(keyFileName(k, false), k.pub); }));
          if (k.own) acts.appendChild(button(t("pgp.exportSec"), "small", function () { keyAsk(t("pgp.secQ"), t("pgp.exportSec"), "", function () { saveText(keyFileName(k, true), k.sec); }); }));
          acts.appendChild(button(t("pgp.del"), "small danger", function () {
            keyAsk(k.own ? t("pgp.delOwnQ", { fpr: PG.short(k.fpr) }) : t("pgp.delQ", { who: keyWho(k) }), t("pgp.del"), "danger", function () {
              PG.remove(k.fpr).then(keysDialog);
            });
          }));
          li.appendChild(acts);
          ul.appendChild(li);
        });
        dlg.appendChild(ul);
      });
      var foot = el("div", "dlg-actions");
      foot.appendChild(button(t("set.close"), "", function () { dlg.close(); }));
      foot.appendChild(button(t("pgp.import"), "", function () { importKeyDialog(); }));
      foot.appendChild(button(t("pgp.new"), "primary", function () { newKeyDialog(); }));
      dlg.appendChild(foot);
      document.body.appendChild(dlg);
      dlg.showModal();
    });
  }
  function keyAsk(text, okLabel, cls, yes) {
    var dlg = makeDialog("ml-keyask");
    dlg.appendChild(el("p", "dlg-text", text));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); keysDialog(); }));
    acts.appendChild(button(okLabel, cls || "primary", function () { dlg.close(); yes(); if (cls !== "danger") keysDialog(); }));
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
  }
  function passFields(form) {
    var p1 = field(form, "ml-pgp-p1", t("pgp.pass"), "password", "", { autocomplete: "new-password", maxlength: "500" });
    var p2 = field(form, "ml-pgp-p2", t("pgp.pass2"), "password", "", { autocomplete: "new-password", maxlength: "500" });
    form.appendChild(el("p", "dlg-hint", t("pgp.passHint")));
    return function () {
      if (p1.value.length < 8) return { err: t("pgp.passShort") };
      if (p1.value !== p2.value) return { err: t("pgp.passDiff") };
      return { pass: p1.value };
    };
  }
  function newKeyDialog() {
    if (!data.accounts.length) return;
    var dlg = makeDialog("ml-keynew", true);
    dlg.appendChild(el("div", "dlg-title", t("pgp.newTitle")));
    var form = el("form");
    form.noValidate = true;
    var fAcct = portSelect(form, "ml-pgp-acct", t("pgp.acct"), data.accounts.map(function (a) {
      return [a.id, a.name ? a.name + " <" + a.email + ">" : a.email];
    }), (curAcct() || data.accounts[0]).id);
    var pass = passFields(form);
    var errP = el("p", "dlg-err");
    errP.setAttribute("role", "alert");
    form.appendChild(errP);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); keysDialog(); }));
    var ok = button(t("pgp.new"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var pw = pass();
      if (pw.err) { errP.textContent = pw.err; return; }
      var a = acctById(fAcct.value);
      if (!a) return;
      ok.disabled = true;
      ok.textContent = t("pgp.making");
      errP.textContent = "";
      PG.generate({ name: a.name, email: a.email, pass: pw.pass }).then(function () {
        dlg.close();
        showToast(t("pgp.made", { email: a.email }));
        keysDialog();
      }, function (er) {
        ok.disabled = false;
        ok.textContent = t("pgp.new");
        errP.textContent = t("pgp.failed", { msg: pgpErr(er) });
      });
    });
    dlg.addEventListener("cancel", function (e) { e.preventDefault(); dlg.close(); });
    dlg.appendChild(form);
    document.body.appendChild(dlg);
    dlg.showModal();
  }
  function importKeyDialog() {
    var dlg = makeDialog("ml-keyimp", true);
    dlg.appendChild(el("div", "dlg-title", t("pgp.impTitle")));
    dlg.appendChild(el("p", "dlg-hint", t("pgp.impHint")));
    var form = el("form");
    form.noValidate = true;
    var lab = el("label", "dlg-lbl", t("pgp.impText"));
    lab.setAttribute("for", "ml-pgp-text");
    form.appendChild(lab);
    var ta = el("textarea", "key-text");
    ta.id = "ml-pgp-text";
    ta.rows = 6;
    ta.spellcheck = false;
    ta.setAttribute("autocapitalize", "off");
    form.appendChild(ta);
    var fb = el("button", "link-btn", t("pgp.impFile"));
    fb.type = "button";
    fb.addEventListener("click", function () {
      var host = dialogHost();
      var pick = host && typeof host.openFiles === "function" ? host.openFiles("") : localPickFiles();
      pick.then(function (list) {
        var f = list && list[0];
        if (!f || f.size > 1024 * 1024) return;
        blobBin(f).then(function (bin) { ta.value = M.decodeCharset(bin, "utf-8"); });
      });
    });
    form.appendChild(fb);
    // a private key without a passphrase gets one here
    var lockBox = el("div");
    lockBox.hidden = true;
    lockBox.appendChild(el("p", "dlg-text", t("pgp.impLock")));
    var pass = passFields(lockBox);
    form.appendChild(lockBox);
    var errP = el("p", "dlg-err");
    errP.setAttribute("role", "alert");
    form.appendChild(errP);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); keysDialog(); }));
    var ok = button(t("pgp.impDo"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      errP.textContent = "";
      var text = ta.value;
      if (!/-----BEGIN PGP (PUBLIC|PRIVATE) KEY BLOCK-----/.test(text)) { errP.textContent = t("pgp.impBad"); return; }
      ok.disabled = true;
      var askedLock = false;
      pgpInit().then(function () {
        return PG.importText(text, function () {
          askedLock = true;
          if (lockBox.hidden) { lockBox.hidden = false; return Promise.resolve(""); }
          var pw = pass();
          if (pw.err) { errP.textContent = pw.err; return Promise.resolve(""); }
          return Promise.resolve(pw.pass);
        });
      }).then(function (r) {
        dlg.close();
        showToast(t("pgp.impDone", { n: r.added.length, u: r.updated.length }));
        keysDialog();
      }, function (er) {
        ok.disabled = false;
        if (er && er.message === "nopass" && askedLock) return;   // the passphrase fields are open now
        errP.textContent = er && er.message === "lib" ? t("pgp.loadFail") : t("pgp.impBad");
      });
    });
    dlg.addEventListener("cancel", function (e) { e.preventDefault(); dlg.close(); });
    dlg.appendChild(form);
    document.body.appendChild(dlg);
    dlg.showModal();
    ta.focus();
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
  function localToast(text, action, ms) {
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
    toastTimer = setTimeout(function () { box.classList.remove("show"); }, ms || 4000);
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
        var gk = groupsOf(tgt);
        if (k === "!" && gk.some(function (g) { return roleFolder(g.acct, "junk"); })) { e.preventDefault(); moveMsgs(tgt, gk.every(function (g) { return roleOf(g) === "junk"; }) ? "notspam" : "spam"); return; }
        if (k === "b" && gk.length && gk.every(function (g) { var r = roleOf(g); return r !== "drafts" && r !== "trash" && r !== "junk" && r !== "sent"; })) { e.preventDefault(); snoozeDialog(tgt); return; }
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
    armSnooze();       // snoozes from another device
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
        if (UNDO_SECS.indexOf(p.undo) >= 0) prefs.undo = p.undo;
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
  //  - the Today summary: { acct, folder } (no uid) opens that folder.
  //  - other apps (Reader, Invoices…): { compose:{ to?, subject?, body?,
  //    attach? } } opens a prefilled draft, plain text, with the files
  //    (handedFiles); the person presses Send.
  //  - Email Signature (BR-MAIL-SIG): { signature:{ html, text, name } }
  //    asks which account gets it; nothing changes before Use. The
  //    HTML goes through rich.js clean() like a typed signature.
  // A dialog open (maybe with unsaved edits) → no-op (returns false).
  function openSearchTarget(target) {
    if (!target || typeof target !== "object" || document.querySelector("dialog[open]")) return false;
    var sg = target.signature;
    if (sg && typeof sg === "object") { signatureDialog(sg); return true; }
    var c = target.compose;
    if (c && typeof c === "object") {
      var init = {
        to: C.parseList(typeof c.to === "string" ? c.to.slice(0, 2000) : "").list.slice(0, MAX_RCPT),
        subject: typeof c.subject === "string" ? c.subject.replace(/\s+/g, " ").trim().slice(0, 300) : "",
        text: typeof c.body === "string" ? c.body.slice(0, 20000) : ""
      };
      if (!Array.isArray(c.attach) || !c.attach.length) { openCompose(init); return true; }
      handedFiles(c.attach).then(function (r) {
        if (document.querySelector("dialog[open]")) return;
        init.attachments = r.files;
        init.handedFailed = r.failed;
        init.handed = r.files.length > 0;
        openCompose(init);
      });
      return true;
    }
    if (typeof target.acct !== "string" || typeof target.folder !== "string" || !target.folder) return false;
    if (!acctById(target.acct)) return false;
    // No uid (the Today summary's unread line): just that folder.
    if (target.uid === undefined) { openFolder(target.acct, target.folder); return true; }
    if (typeof target.uid !== "number") return false;
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
    }).concat([loadOutbox(), pgpInit().catch(function () {})])).then(function () {
      renderSide();
      flushOutbox();
      armSnooze();
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
