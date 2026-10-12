// ============================================================
// orOS Newsletter — App logic (v1.0.0)
// Lists of subscribers, issues written with blocks or Markdown, and
// sending one message per subscriber through the orOS mail relay
// (the existing "send" operation): from one of your Mail accounts or
// from a sending provider's SMTP (Brevo, Amazon SES, Mailgun, …),
// paced, with a daily limit, resumable, never twice to the same
// person. Subscribe / confirm / unsubscribe requests and delivery
// failures arrive as e-mails in an Inbox and are read here with the
// relay's "search" / "fetch" / "move" operations: no public server.
// The model lives in core.js, the e-mail itself in render.js.
// Data:
//   - synced slice "newsletter" (oros-newsletter-data), see core.js
//   - device-local (R10): oros-newsletter-prefs { tab, list, dev,
//     used{}, inbox{}, f{} } and IndexedDB "oros-newsletter"
//     (keys + creds: provider passwords sealed with a non-extractable
//     device key, as Mail does; never synced)
//   - pictures: orOS disk /internal/Newsletter/ (synced per file)
// Reads (never writes): oros-mail-data + IndexedDB "oros-mail"
// (a Mail account's servers and its sealed password), oros-contacts-data.
// Sections:
//   1. i18n + helpers
//   2. Storage + prefs
//   3. Edits
//   4. Mail accounts, passwords, relay
//   5. Render: issues
//   6. Render: subscribers
//   7. Render: lists + sending accounts
//   8. Issue editor
//   9. Issue view
//  10. Dialogs
//  11. Preview, test, check, send
//  12. Sending engine
//  13. Inbox: requests and delivery failures
//  14. Pictures
//  15. Files: CSV, backup, web page; domain check
//  16. Settings
//  17. Toasts, keyboard, sync slice, palette
//  18. Wiring, boot, deep links
// ============================================================
(function () {
  "use strict";

  var C = window.OrosNewsletterCore;
  var R = window.OrosNewsletterRender;
  var STORAGE_KEY = C.STORAGE_KEY;
  var E = window.OrosNewsletterEngine;
  var PREFS_KEY = "oros-newsletter-prefs";
  var SCRIPT_V = (function () {
    var m = ((document.currentScript && document.currentScript.src) || "").match(/[?&]v=([^&#]+)/);
    return m ? m[1] : "";
  })();

  // ---------- 1. i18n + helpers ----------
  function appLang() {
    try {
      var l = localStorage.getItem("oros-lang") || (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  var LANG = appLang();

  var STRINGS = {
    en: {
      "app": "Newsletter", "settings": "Settings", "back": "Back", "new": "New",
      "tab.issues": "Issues", "tab.subs": "Subscribers", "tab.lists": "Lists",
      "setup.noList": "Start with a list: who it is for, the account it sends from and the address in its footer.",
      "setup.go": "New list", "setup.noChan": "First add the account your lists send from.", "setup.goChan": "Add account",
      "sum.on": "{n} active", "sum.on1": "1 active", "sum.pend": "{n} waiting to confirm",
      "iss.empty": "No issues yet.", "iss.emptyHint": "Write your first one with New.",
      "iss.noSubj": "(no subject)", "iss.prog": "{a} of {b} sent", "iss.sentTo": "sent to {n}", "iss.sentTo1": "sent to 1",
      "iss.failed": "{n} failed",
      "st.sched": "Scheduled", "iss.sched": "goes out {t}",
      "aud.all": "Everyone active", "aud.tags": "Subscribers with some tags", "aud.seg": "Segment: {n}",
      "ed.audSeg": "Segment", "seg.manage": "Segments…", "seg.title": "Segments",
      "seg.none": "No segments yet. A segment is a saved group: subscribers with some tags, a language, or both.",
      "seg.add": "New segment", "seg.edit": "Segment", "seg.name": "Name", "seg.unnamed": "(no name)", "seg.tags": "Tags",
      "seg.noTags": "This list has no tags yet: the segment can still pick a language.",
      "seg.match": "Match", "seg.any": "Any of these tags", "seg.all": "All of these tags", "seg.lang": "Language", "seg.anyLang": "Any language",
      "seg.count": "{n} active subscribers match", "seg.inUse": "An issue that is scheduled or being sent uses this segment.",
      "seg.full": "Too many segments", "ck.segGone": "The issue's segment was deleted: pick the audience again.",
      "lang.en": "English", "lang.el": "Greek", "ed.version": "Version",
      "ed.l2Add": "+ {l} version", "ed.l2Remove": "Remove the {l} version", "ed.l2Removed": "Version removed",
      "ed.l2Hint": "Subscribers who read {b} get the {b} version; everyone else gets the {a} one.",
      "tpl.save": "Save as template", "tpl.name": "Template name", "tpl.saved": "Template saved", "tpl.full": "Too many templates: delete one first",
      "tpl.new": "New issue", "tpl.blank": "Blank issue", "tpl.from": "Or start from a template", "tpl.delete": "Delete template",
      "sd.now": "Now", "sd.later": "Later", "sd.when": "Send on", "sd.schedule": "Schedule", "sd.whenBad": "Pick a time in the future",
      "sd.whenHint": "orOS sends it from this device: if orOS isn't open then, it starts the next time you open it here.",
      "vw.sched": "Goes out {t}.", "vw.schedOther": "Scheduled on another device: it goes out from there.",
      "vw.unsched": "Cancel the schedule", "vw.sendNow": "Send now", "toast.sched": "Scheduled for {t}", "toast.unsched": "Back to drafts",
      "subs.crm": "From CRM", "imp.crm": "From CRM", "imp.crmNone": "No CRM customers with an e-mail address.",
      "imp.crmHint": "Pick the customers who should get the newsletter. If you pick only customers (now or past) they count as \"Existing customer\"; with leads among them, everyone confirms by e-mail.",
      "imp.crmTags": "Their CRM status and tags become tags", "crm.lead": "lead", "crm.active": "customer", "crm.past": "past customer",
      "src.crm": "CRM", "pv.lang": "Language", "ts.lang": "Version",
      "st.draft": "Draft", "st.sending": "Sending", "st.paused": "Paused", "st.sent": "Sent",
      "sst.on": "Active", "sst.pend": "Waiting to confirm", "sst.off": "Unsubscribed", "sst.bounce": "Bounced", "sst.spam": "Complained",
      "basis.consent": "Gave consent", "basis.customer": "Existing customer", "basis.optin": "Confirms by e-mail",
      "basis.consentHint": "They agreed to receive it (for example on a form). Keep that proof.",
      "basis.customerHint": "Your customers, for news about similar products or services. Every issue lets them unsubscribe.",
      "basis.optinHint": "They get an e-mail asking them to confirm; only those who confirm receive issues.",
      "src.manual": "Added by hand", "src.paste": "Pasted", "src.csv": "CSV file", "src.contacts": "Contacts", "src.mail": "By e-mail",
      "subs.empty": "No subscribers yet.", "subs.emptyHint": "Add them one by one, paste a list, import a CSV file or pick them from Contacts.",
      "subs.search": "Search address, name, tag…", "subs.allSt": "Every status", "subs.allTags": "Every tag",
      "subs.add": "Add", "subs.paste": "Paste addresses", "subs.csv": "Import CSV", "subs.contacts": "From Contacts",
      "subs.export": "Export CSV", "subs.inbox": "Check Inbox", "subs.invite": "Send confirmation requests ({n})",
      "subs.more": "Showing {a} of {b}. Search to find the others.", "subs.none": "Nothing matches.",
      "inbox.never": "The Inbox has not been checked on this device yet.",
      "inbox.at": "Inbox checked {t}.", "inbox.no": "This list's sending account has no Inbox here: unsubscribe and subscribe e-mails can't be read automatically. Set one in Lists › Sending accounts.",
      "inbox.result": "Inbox: {u} unsubscribed, {s} new, {c} confirmed, {b} bounced",
      "inbox.nothing": "Inbox: nothing new", "inbox.fail": "Couldn't read the Inbox ({e})", "inbox.wait": "orOS is still syncing: try again in a minute",
      "lists.h": "Lists", "lists.none": "No lists yet.", "lists.new": "New list", "lists.edit": "Edit",
      "lists.subLink": "Subscribe link", "lists.check": "Check domain", "lists.via": "via {c}", "lists.noChan": "no sending account",
      "chans.h": "Sending accounts", "chans.hint": "The account each list sends from: one of your Mail accounts, or a sending provider (Brevo, Amazon SES, Mailgun, Postmark, SendGrid…) for bigger lists.", "chans.add": "Add sending account", "chans.none": "No sending accounts yet.",
      "chans.mail": "Mail account", "chans.smtp": "Provider (SMTP)", "chans.limit": "every {s} s · up to {n} a day",
      "chans.noPass": "password not on this device", "chans.gone": "Mail account removed",
      "ed.new": "New issue", "ed.title": "Issue", "ed.saved": "Saved", "ed.subj": "Subject", "ed.pre": "Preview text",
      "ed.preHint": "Shown next to the subject in most inboxes.", "ed.aud": "Goes to",
      "ed.audAll": "Everyone active ({n})", "ed.audTags": "Only subscribers with these tags",
      "ed.audN": "{n} subscribers", "ed.audN1": "1 subscriber", "ed.content": "Content",
      "ed.blocks": "Blocks", "ed.md": "Markdown",
      "ed.mdHint": "# Heading, **bold**, *italic*, [link](https://…), - lists, --- line, ![picture](https://…), [[Button](https://…)]. Each format keeps its own text.",
      "ed.phHint": "{first} is the first name, {name} the full name; {first|friend} uses \"friend\" when there is no name.",
      "ed.add": "Add", "ed.preview": "Preview", "ed.test": "Send a test", "ed.check": "Check", "ed.send": "Send…",
      "ed.delete": "Delete", "ed.dup": "Duplicate",
      "bk.h": "Heading", "bk.p": "Text", "bk.img": "Picture", "bk.btn": "Button", "bk.hr": "Line", "bk.cols": "Two columns",
      "bk.text": "Text", "bk.left": "Left", "bk.right": "Right", "bk.btnText": "Button text", "bk.link": "Link (https://…)",
      "bk.alt": "Description (for people who can't see it)", "bk.pick": "Choose picture", "bk.noImg": "No picture yet",
      "bk.imgMissing": "This picture isn't on this device yet (it syncs with the orOS disk).",
      "bk.up": "Move up", "bk.down": "Move down", "bk.remove": "Remove",
      "vw.started": "Started {t}", "vw.done": "Finished {t}", "vw.sent": "Sent", "vw.failed": "Failed", "vw.left": "Left",
      "vw.unsubs": "Unsubscribed since", "vw.pause": "Pause", "vw.resume": "Resume", "vw.stop": "Stop for good",
      "vw.web": "Save as web page", "vw.other": "Being sent from another device.", "vw.take": "Send from here",
      "vw.err": "Paused: {e}", "vw.failList": "Not delivered",
      "dlg.cancel": "Cancel", "dlg.save": "Save", "dlg.close": "Close", "dlg.delete": "Delete",
      "dlg.leaveTitle": "Discard?", "dlg.ok": "OK",
      "l.title": "List", "l.name": "Name", "l.namePh": "e.g. Shop news", "l.chan": "Sends from",
      "l.from": "From address", "l.fromHint": "The address subscribers see. With a provider it must be a sender you verified there.",
      "l.fromName": "From name", "l.reply": "Replies go to (optional)", "l.lang": "Language of the footer and requests",
      "l.addr": "Your name and postal address (footer)", "l.addrHint": "Required: the law asks every newsletter to say who sends it.",
      "l.why": "Why they receive it (footer)", "l.whyDflt": "You receive this because you subscribed to {l}.",
      "l.theme": "Look", "l.color": "Colour", "th.classic": "Classic", "th.warm": "Warm", "th.dark": "Dark", "th.plain": "Plain",
      "l.delete": "Delete list", "l.delText": "Delete the list \"{l}\" with its {n} subscribers and its issues on all your devices?",
      "l.needChan": "Add a sending account first.",
      "lk.title": "Subscribe link", "lk.text": "People subscribe by sending an e-mail. Put this link on your site or in your profile: it opens an e-mail with everything filled in. Newsletter reads it from the Inbox, sends a confirmation request, and adds them once they confirm.",
      "lk.link": "Link", "lk.html": "HTML for your site", "lk.copy": "Copy", "lk.copied": "Copied", "lk.btn": "Subscribe",
      "ch.title": "Sending account", "ch.kind": "Send through", "ch.acct": "Mail account", "ch.noAcct": "Add an e-mail account in Mail first (with its outgoing server).",
      "ch.preset": "Provider", "ch.host": "SMTP server", "ch.port": "Port", "ch.user": "User name",
      "ch.pass": "Password or API key", "ch.passKeep": "Saved on this device: leave empty to keep it",
      "ch.passHint": "Stays sealed on this device and is never synced: enter it once on each device that sends.",
      "ch.inbox": "Inbox for requests and bounces", "ch.inboxNone": "None", "ch.inboxHint": "The Mail account that receives replies to your From address.",
      "ch.rate": "Seconds between messages", "ch.cap": "Messages a day (at most)",
      "ch.capHint": "Keep it under your provider's daily limit: an ordinary mailbox often allows about 500 a day, a sending provider says it in your plan.",
      "ch.presetHint": "Starting values: check the server and your plan's limits in the provider's own guide.",
      "ch.test": "Test login", "ch.testOk": "Login works", "ch.delete": "Remove account",
      "ch.inUse": "Lists use this account: choose another account for them first.",
      "p.other": "Other", "p.brevo": "Brevo", "p.ses": "Amazon SES", "p.mailgun": "Mailgun (US)", "p.mailgun-eu": "Mailgun (EU)",
      "p.postmark": "Postmark (broadcast stream)", "p.sendgrid": "SendGrid", "p.smtp2go": "SMTP2GO", "p.gmail": "Gmail",
      "s.title": "Subscriber", "s.email": "E-mail", "s.name": "Name", "s.tags": "Tags", "s.tagsHint": "Separate with commas.",
      "s.lang": "Language", "s.langAny": "Like the list", "s.basis": "On what basis", "s.status": "Status",
      "s.since": "Subscribed {t}", "s.conf": "Confirmed {t}", "s.left": "Left {t}", "s.inv": "Confirmation request sent {t}",
      "s.src": "Source: {s}", "s.unsub": "Unsubscribe", "s.resub": "Subscribe again", "s.resubHint": "Only when they asked you to.",
      "s.export": "Their data (JSON)", "s.forget": "Delete for good",
      "s.forgetText": "Delete {e} from this list for good? Only a fingerprint of the address stays, so an import can't add it again by mistake.",
      "s.dup": "That address is already on this list.", "s.left1": "That address unsubscribed or bounced: only they can subscribe again.",
      "s.suppressed": "That address was deleted for good earlier.", "s.full": "The limit of {n} subscribers is reached.",
      "imp.title": "Import", "imp.paste": "Addresses", "imp.pasteHint": "One per line, or separated by commas: name@example.com or Name <name@example.com>.",
      "imp.tags": "Add these tags", "imp.basis": "On what basis", "imp.next": "Next", "imp.do": "Add {n}",
      "imp.sum": "{a} new · {d} already there · {l} left earlier (not added) · {s} deleted for good · {b} not valid · {o} over the limit",
      "imp.none": "No addresses found.", "imp.done": "Added {n}", "imp.done1": "Added 1",
      "imp.contacts": "From Contacts", "imp.cFilter": "Find…", "imp.cAll": "Select all shown", "imp.cNone": "No contacts with an e-mail address.",
      "imp.cHint": "A contact is not consent: unless they already agreed, choose \"Confirms by e-mail\".",
      "imp.labelsTags": "Their Contacts labels become tags",
      "pv.title": "Preview", "pv.phone": "Phone", "pv.desktop": "Desktop", "pv.as": "As {n}", "pv.sample": "a subscriber without a name",
      "ts.title": "Send a test", "ts.to": "To", "ts.sent": "Test sent to {a}",
      "ck.title": "Check", "ck.ok": "Ready to send.", "ck.err": "Must fix", "ck.warn": "Worth a look",
      "ck.noSubj": "The subject is empty.", "ck.longSubj": "The subject is long: phones show about 40 characters.",
      "ck.shouty": "Capitals or !!! in the subject look like spam to filters.", "ck.noBody": "The issue is empty.",
      "ck.noAddr": "The list has no postal address for the footer (Lists › Edit).", "ck.noFrom": "The list has no From address.",
      "ck.noChan": "The list's sending account is missing or has no password on this device.",
      "ck.noInbox": "No Inbox for this list: unsubscribe e-mails won't be read automatically.",
      "ck.bigImgs": "The pictures add up to more than 400 KB: every subscriber downloads them.",
      "ck.badBlock": "A button without text or link, or a picture block without a picture.",
      "ck.placeholder": "Something in braces isn't {first}, {name} or {first|…}.",
      "ck.noAudience": "Nobody to send to: no active subscriber matches.",
      "sd.title": "Send", "sd.text": "{n} messages from {f} through {c}.",
      "sd.time": "At one message every {s} s it takes about {m} minutes; with up to {cap} a day it needs {d} days.",
      "sd.time1": "At one message every {s} s it takes about {m} minutes.",
      "sd.keep": "orOS goes on sending while it is open on this device, even with Newsletter closed. A tab in the background sends more slowly.",
      "sd.type": "Type {n} to confirm", "sd.go": "Send now",
      "bar.sending": "Sending \"{s}\": {a} of {b}", "bar.inv": "Sending confirmation requests: {n} left",
      "bar.cap": "Daily limit of {c} reached: sending goes on tomorrow.", "bar.offline": "Offline: sending waits for the connection.",
      "bar.wait": "The server asked to slow down: trying again in a few minutes.", "bar.paused": "Paused: \"{s}\"",
      "bar.other": "\"{s}\" is being sent from another device.", "bar.here": "Another orOS window on this device is sending.", "bar.pause": "Pause", "bar.resume": "Resume", "bar.open": "Open",
      "err.offline": "you are offline", "err.network": "no connection to the relay", "err.timeout": "the server didn't answer in time",
      "err.auth": "the server refused the login: check the password", "err.nopass": "the password isn't on this device",
      "err.noacct": "the Mail account is gone", "err.nosmtp": "the Mail account has no outgoing server",
      "err.nochan": "the list has no sending account", "err.noImg": "a picture isn't on this device yet",
      "err.too-big": "the message is too large", "err.rate": "too many requests: wait a minute", "err.relay": "the relay didn't answer properly",
      "err.no": "the server refused the message ({m})", "err.rcpt": "the server refused the address", "err.connect": "couldn't reach the server",
      "err.tls": "secure connection failed", "err.proto": "the server answered unexpectedly", "err.closed": "the server closed the connection",
      "err.origin": "this page may not use the relay", "err.bad-request": "the relay refused the request",
      "set.title": "Settings", "set.backup": "Back up (JSON)", "set.restore": "Restore from backup", "set.data": "Data",
      "set.about": "About", "set.aboutText": "Newsletter sends one e-mail per subscriber through the orOS mail relay, from your own account or a provider's SMTP, while it is open. Nothing is tracked: no open or click counting. Subscribe, confirm and unsubscribe requests are e-mails it reads from your Inbox.",
      "set.dev": "Sent from this device today: {n}",
      "dom.title": "Domain check: {d}", "dom.spf": "SPF", "dom.dkim": "DKIM", "dom.dmarc": "DMARC",
      "dom.spfOk": "Found: {v}", "dom.spfNo": "Not found: ask your e-mail provider for the SPF record of your domain.",
      "dom.dkimOk": "Found (selector \"{s}\").", "dom.dkimNo": "Not found under the usual names. Your provider may use another name: their guide says.",
      "dom.dmarcOk": "Found: {v}", "dom.dmarcNo": "Not found: add a TXT record _dmarc with at least v=DMARC1; p=none.",
      "dom.public": "{d} is a public mail service: it takes care of these itself.", "dom.fail": "The check needs a connection.",
      "dom.wait": "Checking…", "dom.hint": "These records tell inboxes that your mail really comes from you; without them newsletters often land in spam.",
      "toast.undo": "Undo", "toast.save": "Couldn't save: the browser storage is full", "toast.deleted": "Deleted",
      "toast.badFile": "That file isn't a Newsletter backup", "toast.restored": "Restored and merged", "toast.exported": "Saved",
      "toast.noDisk": "The orOS disk isn't available here", "toast.imgBad": "Couldn't read that picture",
      "toast.sentAll": "\"{s}\" went out to {n}", "toast.noCsv": "No addresses found in that file", "toast.invSent": "Confirmation requests sent",
      "toast.testFail": "The test wasn't sent: {e}", "toast.chanFail": "Login failed: {e}", "toast.opened": "Opened from {a}",
      "live.saved": "Saved", "time.now": "just now"
    },
    el: {
      "app": "Ενημερωτικό δελτίο", "settings": "Ρυθμίσεις", "back": "Πίσω", "new": "Νέο",
      "tab.issues": "Τεύχη", "tab.subs": "Συνδρομητές", "tab.lists": "Λίστες",
      "setup.noList": "Ξεκίνα με μια λίστα: σε ποιους απευθύνεται, από ποιον λογαριασμό στέλνει και ποια διεύθυνση γράφει στο κάτω μέρος.",
      "setup.go": "Νέα λίστα", "setup.noChan": "Πρόσθεσε πρώτα τον λογαριασμό από τον οποίο θα στέλνουν οι λίστες σου.", "setup.goChan": "Προσθήκη λογαριασμού",
      "sum.on": "{n} ενεργοί", "sum.on1": "1 ενεργός", "sum.pend": "{n} περιμένουν επιβεβαίωση",
      "iss.empty": "Δεν υπάρχουν τεύχη ακόμα.", "iss.emptyHint": "Γράψε το πρώτο με το Νέο.",
      "iss.noSubj": "(χωρίς θέμα)", "iss.prog": "στάλθηκαν {a} από {b}", "iss.sentTo": "στάλθηκε σε {n}", "iss.sentTo1": "στάλθηκε σε 1",
      "iss.failed": "{n} απέτυχαν",
      "st.sched": "Προγραμματισμένο", "iss.sched": "φεύγει {t}",
      "aud.all": "Όλοι οι ενεργοί", "aud.tags": "Συνδρομητές με κάποιες ετικέτες", "aud.seg": "Τμήμα: {n}",
      "ed.audSeg": "Τμήμα", "seg.manage": "Τμήματα…", "seg.title": "Τμήματα",
      "seg.none": "Δεν υπάρχουν τμήματα ακόμα. Ένα τμήμα είναι μια αποθηκευμένη ομάδα: συνδρομητές με κάποιες ετικέτες, μια γλώσσα ή και τα δύο.",
      "seg.add": "Νέο τμήμα", "seg.edit": "Τμήμα", "seg.name": "Όνομα", "seg.unnamed": "(χωρίς όνομα)", "seg.tags": "Ετικέτες",
      "seg.noTags": "Η λίστα δεν έχει ακόμα ετικέτες: το τμήμα μπορεί πάντως να διαλέξει γλώσσα.",
      "seg.match": "Ταίριασμα", "seg.any": "Οποιαδήποτε από αυτές", "seg.all": "Όλες αυτές", "seg.lang": "Γλώσσα", "seg.anyLang": "Οποιαδήποτε γλώσσα",
      "seg.count": "Ταιριάζουν {n} ενεργοί συνδρομητές", "seg.inUse": "Αυτό το τμήμα το χρησιμοποιεί τεύχος που είναι προγραμματισμένο ή στέλνεται.",
      "seg.full": "Πάρα πολλά τμήματα", "ck.segGone": "Το τμήμα του τεύχους διαγράφηκε: διάλεξε ξανά παραλήπτες.",
      "lang.en": "Αγγλικά", "lang.el": "Ελληνικά", "ed.version": "Έκδοση",
      "ed.l2Add": "+ Έκδοση στα {l}", "ed.l2Remove": "Αφαίρεση της έκδοσης στα {l}", "ed.l2Removed": "Η έκδοση αφαιρέθηκε",
      "ed.l2Hint": "Όσοι διαβάζουν {b} παίρνουν την έκδοση στα {b}· όλοι οι άλλοι αυτή στα {a}.",
      "tpl.save": "Αποθήκευση ως πρότυπο", "tpl.name": "Όνομα προτύπου", "tpl.saved": "Το πρότυπο αποθηκεύτηκε", "tpl.full": "Πάρα πολλά πρότυπα: διάγραψε πρώτα ένα",
      "tpl.new": "Νέο τεύχος", "tpl.blank": "Κενό τεύχος", "tpl.from": "Ή ξεκίνα από πρότυπο", "tpl.delete": "Διαγραφή προτύπου",
      "sd.now": "Τώρα", "sd.later": "Αργότερα", "sd.when": "Αποστολή στις", "sd.schedule": "Προγραμματισμός", "sd.whenBad": "Διάλεξε μια μελλοντική ώρα",
      "sd.whenHint": "Το στέλνει το orOS από αυτή τη συσκευή: αν δεν είναι ανοιχτό τότε, ξεκινά μόλις το ανοίξεις εδώ.",
      "vw.sched": "Φεύγει {t}.", "vw.schedOther": "Προγραμματίστηκε σε άλλη συσκευή: θα φύγει από εκεί.",
      "vw.unsched": "Ακύρωση προγραμματισμού", "vw.sendNow": "Αποστολή τώρα", "toast.sched": "Προγραμματίστηκε για {t}", "toast.unsched": "Επέστρεψε στα πρόχειρα",
      "subs.crm": "Από το CRM", "imp.crm": "Από το CRM", "imp.crmNone": "Κανένας πελάτης του CRM με email.",
      "imp.crmHint": "Διάλεξε τους πελάτες που θα παίρνουν το δελτίο. Αν διαλέξεις μόνο πελάτες (τωρινούς ή πρώην) μετράνε ως «Υπάρχων πελάτης»· αν υπάρχουν και υποψήφιοι, όλοι επιβεβαιώνουν με email.",
      "imp.crmTags": "Η κατάσταση και οι ετικέτες τους στο CRM γίνονται ετικέτες", "crm.lead": "υποψήφιος", "crm.active": "πελάτης", "crm.past": "πρώην πελάτης",
      "src.crm": "CRM", "pv.lang": "Γλώσσα", "ts.lang": "Έκδοση",
      "st.draft": "Πρόχειρο", "st.sending": "Αποστέλλεται", "st.paused": "Σε παύση", "st.sent": "Στάλθηκε",
      "sst.on": "Ενεργός", "sst.pend": "Περιμένει επιβεβαίωση", "sst.off": "Διαγράφηκε", "sst.bounce": "Επιστροφή (bounce)", "sst.spam": "Παράπονο",
      "basis.consent": "Έδωσε συναίνεση", "basis.customer": "Υπάρχων πελάτης", "basis.optin": "Επιβεβαιώνει με email",
      "basis.consentHint": "Συμφώνησαν να το λαμβάνουν (π.χ. σε φόρμα). Κράτα την απόδειξη.",
      "basis.customerHint": "Πελάτες σου, για νέα για παρόμοια προϊόντα ή υπηρεσίες. Κάθε τεύχος τους δίνει δυνατότητα διαγραφής.",
      "basis.optinHint": "Λαμβάνουν email που ζητά επιβεβαίωση· τεύχη παίρνουν μόνο όσοι επιβεβαιώσουν.",
      "src.manual": "Με το χέρι", "src.paste": "Επικόλληση", "src.csv": "Αρχείο CSV", "src.contacts": "Επαφές", "src.mail": "Με email",
      "subs.empty": "Δεν υπάρχουν συνδρομητές ακόμα.", "subs.emptyHint": "Πρόσθεσέ τους έναν έναν, επικόλλησε μια λίστα, φέρε ένα αρχείο CSV ή διάλεξέ τους από τις Επαφές.",
      "subs.search": "Αναζήτηση διεύθυνσης, ονόματος, ετικέτας…", "subs.allSt": "Κάθε κατάσταση", "subs.allTags": "Κάθε ετικέτα",
      "subs.add": "Προσθήκη", "subs.paste": "Επικόλληση διευθύνσεων", "subs.csv": "Εισαγωγή CSV", "subs.contacts": "Από τις Επαφές",
      "subs.export": "Εξαγωγή CSV", "subs.inbox": "Έλεγχος Εισερχομένων", "subs.invite": "Αποστολή αιτημάτων επιβεβαίωσης ({n})",
      "subs.more": "Φαίνονται {a} από {b}. Αναζήτησε για τους υπόλοιπους.", "subs.none": "Δεν ταιριάζει κανείς.",
      "inbox.never": "Τα Εισερχόμενα δεν έχουν ελεγχθεί ακόμα σε αυτή τη συσκευή.",
      "inbox.at": "Τα Εισερχόμενα ελέγχθηκαν {t}.", "inbox.no": "Ο λογαριασμός αποστολής αυτής της λίστας δεν έχει Εισερχόμενα εδώ: τα email εγγραφής και διαγραφής δεν διαβάζονται αυτόματα. Όρισέ τα στις Λίστες › Λογαριασμοί αποστολής.",
      "inbox.result": "Εισερχόμενα: {u} διαγραφές, {s} νέοι, {c} επιβεβαιώσεις, {b} επιστροφές",
      "inbox.nothing": "Εισερχόμενα: τίποτα νέο", "inbox.fail": "Δεν διαβάστηκαν τα Εισερχόμενα ({e})", "inbox.wait": "Το orOS συγχρονίζει ακόμα: δοκίμασε ξανά σε ένα λεπτό",
      "lists.h": "Λίστες", "lists.none": "Δεν υπάρχουν λίστες ακόμα.", "lists.new": "Νέα λίστα", "lists.edit": "Επεξεργασία",
      "lists.subLink": "Σύνδεσμος εγγραφής", "lists.check": "Έλεγχος domain", "lists.via": "μέσω {c}", "lists.noChan": "χωρίς λογαριασμό αποστολής",
      "chans.h": "Λογαριασμοί αποστολής", "chans.hint": "Ο λογαριασμός από τον οποίο στέλνει κάθε λίστα: ένας από τους λογαριασμούς σου στο Mail ή ένας πάροχος αποστολής (Brevo, Amazon SES, Mailgun, Postmark, SendGrid…) για μεγαλύτερες λίστες.", "chans.add": "Προσθήκη λογαριασμού αποστολής", "chans.none": "Δεν υπάρχουν λογαριασμοί αποστολής ακόμα.",
      "chans.mail": "Λογαριασμός Mail", "chans.smtp": "Πάροχος (SMTP)", "chans.limit": "κάθε {s} δλ. · έως {n} τη μέρα",
      "chans.noPass": "χωρίς κωδικό σε αυτή τη συσκευή", "chans.gone": "Ο λογαριασμός του Mail διαγράφηκε",
      "ed.new": "Νέο τεύχος", "ed.title": "Τεύχος", "ed.saved": "Αποθηκεύτηκε", "ed.subj": "Θέμα", "ed.pre": "Κείμενο προεπισκόπησης",
      "ed.preHint": "Φαίνεται δίπλα στο θέμα στα περισσότερα Εισερχόμενα.", "ed.aud": "Πηγαίνει σε",
      "ed.audAll": "Όλους τους ενεργούς ({n})", "ed.audTags": "Μόνο σε συνδρομητές με αυτές τις ετικέτες",
      "ed.audN": "{n} συνδρομητές", "ed.audN1": "1 συνδρομητή", "ed.content": "Περιεχόμενο",
      "ed.blocks": "Blocks", "ed.md": "Markdown",
      "ed.mdHint": "# Επικεφαλίδα, **έντονα**, *πλάγια*, [σύνδεσμος](https://…), - λίστες, --- γραμμή, ![εικόνα](https://…), [[Κουμπί](https://…)]. Κάθε μορφή κρατά το δικό της κείμενο.",
      "ed.phHint": "Το {first} είναι το μικρό όνομα, το {name} ολόκληρο· το {first|φίλε} γράφει «φίλε» όταν δεν υπάρχει όνομα.",
      "ed.add": "Προσθήκη", "ed.preview": "Προεπισκόπηση", "ed.test": "Δοκιμαστική αποστολή", "ed.check": "Έλεγχος", "ed.send": "Αποστολή…",
      "ed.delete": "Διαγραφή", "ed.dup": "Αντίγραφο",
      "bk.h": "Επικεφαλίδα", "bk.p": "Κείμενο", "bk.img": "Εικόνα", "bk.btn": "Κουμπί", "bk.hr": "Γραμμή", "bk.cols": "Δύο στήλες",
      "bk.text": "Κείμενο", "bk.left": "Αριστερά", "bk.right": "Δεξιά", "bk.btnText": "Κείμενο κουμπιού", "bk.link": "Σύνδεσμος (https://…)",
      "bk.alt": "Περιγραφή (για όσους δεν τη βλέπουν)", "bk.pick": "Επιλογή εικόνας", "bk.noImg": "Δεν έχει μπει εικόνα",
      "bk.imgMissing": "Αυτή η εικόνα δεν υπάρχει ακόμα σε αυτή τη συσκευή (συγχρονίζεται με τον δίσκο του orOS).",
      "bk.up": "Μετακίνηση πάνω", "bk.down": "Μετακίνηση κάτω", "bk.remove": "Αφαίρεση",
      "vw.started": "Ξεκίνησε {t}", "vw.done": "Ολοκληρώθηκε {t}", "vw.sent": "Στάλθηκαν", "vw.failed": "Απέτυχαν", "vw.left": "Απομένουν",
      "vw.unsubs": "Διαγραφές από τότε", "vw.pause": "Παύση", "vw.resume": "Συνέχεια", "vw.stop": "Οριστική διακοπή",
      "vw.web": "Αποθήκευση ως ιστοσελίδα", "vw.other": "Στέλνεται από άλλη συσκευή.", "vw.take": "Αποστολή από εδώ",
      "vw.err": "Σε παύση: {e}", "vw.failList": "Δεν παραδόθηκαν",
      "dlg.cancel": "Άκυρο", "dlg.save": "Αποθήκευση", "dlg.close": "Κλείσιμο", "dlg.delete": "Διαγραφή",
      "dlg.leaveTitle": "Απόρριψη;", "dlg.ok": "OK",
      "l.title": "Λίστα", "l.name": "Όνομα", "l.namePh": "π.χ. Νέα του καταστήματος", "l.chan": "Στέλνει από",
      "l.from": "Διεύθυνση αποστολέα", "l.fromHint": "Η διεύθυνση που βλέπουν οι συνδρομητές. Με πάροχο πρέπει να είναι αποστολέας που έχεις επαληθεύσει εκεί.",
      "l.fromName": "Όνομα αποστολέα", "l.reply": "Οι απαντήσεις πάνε στο (προαιρετικό)", "l.lang": "Γλώσσα του κάτω μέρους και των αιτημάτων",
      "l.addr": "Όνομα και ταχυδρομική διεύθυνση (κάτω μέρος)", "l.addrHint": "Υποχρεωτικό: ο νόμος ζητά κάθε newsletter να λέει ποιος το στέλνει.",
      "l.why": "Γιατί το λαμβάνουν (κάτω μέρος)", "l.whyDflt": "Το λαμβάνεις επειδή έχεις εγγραφεί στο {l}.",
      "l.theme": "Εμφάνιση", "l.color": "Χρώμα", "th.classic": "Κλασικό", "th.warm": "Ζεστό", "th.dark": "Σκούρο", "th.plain": "Λιτό",
      "l.delete": "Διαγραφή λίστας", "l.delText": "Να διαγραφεί η λίστα «{l}» με τους {n} συνδρομητές και τα τεύχη της σε όλες τις συσκευές σου;",
      "l.needChan": "Πρόσθεσε πρώτα λογαριασμό αποστολής.",
      "lk.title": "Σύνδεσμος εγγραφής", "lk.text": "Η εγγραφή γίνεται με email. Βάλε αυτόν τον σύνδεσμο στο site ή στο προφίλ σου: ανοίγει ένα email έτοιμο. Το Ενημερωτικό δελτίο το διαβάζει από τα Εισερχόμενα, στέλνει αίτημα επιβεβαίωσης και προσθέτει τον συνδρομητή μόλις επιβεβαιώσει.",
      "lk.link": "Σύνδεσμος", "lk.html": "HTML για το site σου", "lk.copy": "Αντιγραφή", "lk.copied": "Αντιγράφηκε", "lk.btn": "Εγγραφή",
      "ch.title": "Λογαριασμός αποστολής", "ch.kind": "Αποστολή μέσω", "ch.acct": "Λογαριασμός Mail", "ch.noAcct": "Πρόσθεσε πρώτα έναν λογαριασμό email στο Mail (με τον διακομιστή εξερχομένων).",
      "ch.preset": "Πάροχος", "ch.host": "Διακομιστής SMTP", "ch.port": "Θύρα", "ch.user": "Όνομα χρήστη",
      "ch.pass": "Κωδικός ή κλειδί API", "ch.passKeep": "Αποθηκευμένος σε αυτή τη συσκευή: άφησέ το κενό για να μείνει",
      "ch.passHint": "Μένει σφραγισμένος σε αυτή τη συσκευή και δεν συγχρονίζεται ποτέ: γράψ' τον μία φορά σε κάθε συσκευή που στέλνει.",
      "ch.inbox": "Εισερχόμενα για αιτήματα και επιστροφές", "ch.inboxNone": "Κανένα", "ch.inboxHint": "Ο λογαριασμός του Mail που δέχεται τις απαντήσεις στη διεύθυνση αποστολέα.",
      "ch.rate": "Δευτερόλεπτα ανάμεσα στα μηνύματα", "ch.cap": "Μηνύματα τη μέρα (το πολύ)",
      "ch.capHint": "Κράτα το κάτω από το ημερήσιο όριο του παρόχου σου: ένα απλό γραμματοκιβώτιο συχνά επιτρέπει περίπου 500 τη μέρα, ένας πάροχος αποστολής το γράφει στο πακέτο σου.",
      "ch.presetHint": "Αρχικές τιμές: έλεγξε τον διακομιστή και τα όρια του πακέτου σου στον οδηγό του παρόχου.",
      "ch.test": "Δοκιμή σύνδεσης", "ch.testOk": "Η σύνδεση δουλεύει", "ch.delete": "Αφαίρεση λογαριασμού",
      "ch.inUse": "Τον χρησιμοποιούν λίστες: διάλεξε πρώτα άλλον λογαριασμό για αυτές.",
      "p.other": "Άλλος", "p.brevo": "Brevo", "p.ses": "Amazon SES", "p.mailgun": "Mailgun (ΗΠΑ)", "p.mailgun-eu": "Mailgun (ΕΕ)",
      "p.postmark": "Postmark (broadcast stream)", "p.sendgrid": "SendGrid", "p.smtp2go": "SMTP2GO", "p.gmail": "Gmail",
      "s.title": "Συνδρομητής", "s.email": "Email", "s.name": "Όνομα", "s.tags": "Ετικέτες", "s.tagsHint": "Χώρισέ τες με κόμμα.",
      "s.lang": "Γλώσσα", "s.langAny": "Όπως η λίστα", "s.basis": "Με ποια βάση", "s.status": "Κατάσταση",
      "s.since": "Εγγραφή {t}", "s.conf": "Επιβεβαίωση {t}", "s.left": "Αποχώρηση {t}", "s.inv": "Αίτημα επιβεβαίωσης στάλθηκε {t}",
      "s.src": "Πηγή: {s}", "s.unsub": "Κατάργηση εγγραφής", "s.resub": "Ξανά εγγραφή", "s.resubHint": "Μόνο αν σου το ζήτησε ο ίδιος.",
      "s.export": "Τα δεδομένα του (JSON)", "s.forget": "Οριστική διαγραφή",
      "s.forgetText": "Να διαγραφεί οριστικά το {e} από αυτή τη λίστα; Μένει μόνο ένα αποτύπωμα της διεύθυνσης, ώστε μια εισαγωγή να μην την ξαναβάλει κατά λάθος.",
      "s.dup": "Αυτή η διεύθυνση υπάρχει ήδη στη λίστα.", "s.left1": "Αυτή η διεύθυνση διαγράφηκε ή επέστρεψε: μόνο ο ίδιος μπορεί να ξαναεγγραφεί.",
      "s.suppressed": "Αυτή η διεύθυνση είχε διαγραφεί οριστικά.", "s.full": "Έφτασες το όριο των {n} συνδρομητών.",
      "imp.title": "Εισαγωγή", "imp.paste": "Διευθύνσεις", "imp.pasteHint": "Μία ανά γραμμή ή χωρισμένες με κόμμα: name@example.com ή Όνομα <name@example.com>.",
      "imp.tags": "Πρόσθεσε αυτές τις ετικέτες", "imp.basis": "Με ποια βάση", "imp.next": "Επόμενο", "imp.do": "Προσθήκη {n}",
      "imp.sum": "{a} νέοι · {d} υπάρχουν ήδη · {l} είχαν αποχωρήσει (δεν μπαίνουν) · {s} οριστικά διαγραμμένοι · {b} μη έγκυρες · {o} πάνω από το όριο",
      "imp.none": "Δεν βρέθηκαν διευθύνσεις.", "imp.done": "Προστέθηκαν {n}", "imp.done1": "Προστέθηκε 1",
      "imp.contacts": "Από τις Επαφές", "imp.cFilter": "Εύρεση…", "imp.cAll": "Επιλογή όλων όσων φαίνονται", "imp.cNone": "Καμία επαφή με email.",
      "imp.cHint": "Μια επαφή δεν είναι συναίνεση: αν δεν έχουν ήδη συμφωνήσει, διάλεξε «Επιβεβαιώνει με email».",
      "imp.labelsTags": "Οι ετικέτες τους στις Επαφές γίνονται ετικέτες",
      "pv.title": "Προεπισκόπηση", "pv.phone": "Κινητό", "pv.desktop": "Υπολογιστής", "pv.as": "Ως {n}", "pv.sample": "συνδρομητής χωρίς όνομα",
      "ts.title": "Δοκιμαστική αποστολή", "ts.to": "Προς", "ts.sent": "Η δοκιμή στάλθηκε στο {a}",
      "ck.title": "Έλεγχος", "ck.ok": "Έτοιμο για αποστολή.", "ck.err": "Πρέπει να διορθωθεί", "ck.warn": "Αξίζει μια ματιά",
      "ck.noSubj": "Το θέμα είναι κενό.", "ck.longSubj": "Το θέμα είναι μεγάλο: τα κινητά δείχνουν περίπου 40 χαρακτήρες.",
      "ck.shouty": "Κεφαλαία ή !!! στο θέμα μοιάζουν με spam στα φίλτρα.", "ck.noBody": "Το τεύχος είναι κενό.",
      "ck.noAddr": "Η λίστα δεν έχει ταχυδρομική διεύθυνση για το κάτω μέρος (Λίστες › Επεξεργασία).", "ck.noFrom": "Η λίστα δεν έχει διεύθυνση αποστολέα.",
      "ck.noChan": "Ο λογαριασμός αποστολής της λίστας λείπει ή δεν έχει κωδικό σε αυτή τη συσκευή.",
      "ck.noInbox": "Η λίστα δεν έχει Εισερχόμενα: τα email διαγραφής δεν θα διαβάζονται αυτόματα.",
      "ck.bigImgs": "Οι εικόνες ξεπερνούν τα 400 KB: τις κατεβάζει κάθε συνδρομητής.",
      "ck.badBlock": "Ένα κουμπί χωρίς κείμενο ή σύνδεσμο, ή block εικόνας χωρίς εικόνα.",
      "ck.placeholder": "Κάτι μέσα σε άγκιστρα δεν είναι {first}, {name} ή {first|…}.",
      "ck.noAudience": "Δεν υπάρχει παραλήπτης: κανένας ενεργός συνδρομητής δεν ταιριάζει.",
      "sd.title": "Αποστολή", "sd.text": "{n} μηνύματα από {f} μέσω {c}.",
      "sd.time": "Με ένα μήνυμα κάθε {s} δλ. θέλει περίπου {m} λεπτά· με έως {cap} τη μέρα χρειάζεται {d} μέρες.",
      "sd.time1": "Με ένα μήνυμα κάθε {s} δλ. θέλει περίπου {m} λεπτά.",
      "sd.keep": "Το orOS συνεχίζει την αποστολή όσο είναι ανοιχτό σε αυτή τη συσκευή, ακόμα κι αν κλείσεις το Ενημερωτικό δελτίο. Σε καρτέλα στο παρασκήνιο στέλνει πιο αργά.",
      "sd.type": "Γράψε {n} για επιβεβαίωση", "sd.go": "Αποστολή τώρα",
      "bar.sending": "Αποστολή «{s}»: {a} από {b}", "bar.inv": "Αποστολή αιτημάτων επιβεβαίωσης: απομένουν {n}",
      "bar.cap": "Έφτασε το ημερήσιο όριο των {c}: η αποστολή συνεχίζει αύριο.", "bar.offline": "Εκτός σύνδεσης: η αποστολή περιμένει τη σύνδεση.",
      "bar.wait": "Ο διακομιστής ζήτησε πιο αργό ρυθμό: νέα προσπάθεια σε λίγα λεπτά.", "bar.paused": "Σε παύση: «{s}»",
      "bar.other": "Το «{s}» στέλνεται από άλλη συσκευή.", "bar.here": "Στέλνει ένα άλλο παράθυρο του orOS σε αυτή τη συσκευή.", "bar.pause": "Παύση", "bar.resume": "Συνέχεια", "bar.open": "Άνοιγμα",
      "err.offline": "είσαι εκτός σύνδεσης", "err.network": "δεν υπάρχει σύνδεση με το relay", "err.timeout": "ο διακομιστής δεν απάντησε εγκαίρως",
      "err.auth": "ο διακομιστής δεν δέχτηκε τη σύνδεση: έλεγξε τον κωδικό", "err.nopass": "ο κωδικός δεν υπάρχει σε αυτή τη συσκευή",
      "err.noacct": "ο λογαριασμός του Mail δεν υπάρχει πια", "err.nosmtp": "ο λογαριασμός του Mail δεν έχει διακομιστή εξερχομένων",
      "err.nochan": "η λίστα δεν έχει λογαριασμό αποστολής", "err.noImg": "μια εικόνα δεν υπάρχει ακόμα σε αυτή τη συσκευή",
      "err.too-big": "το μήνυμα είναι πολύ μεγάλο", "err.rate": "πάρα πολλά αιτήματα: περίμενε ένα λεπτό", "err.relay": "το relay δεν απάντησε σωστά",
      "err.no": "ο διακομιστής δεν δέχτηκε το μήνυμα ({m})", "err.rcpt": "ο διακομιστής δεν δέχτηκε τη διεύθυνση", "err.connect": "δεν βρέθηκε ο διακομιστής",
      "err.tls": "απέτυχε η ασφαλής σύνδεση", "err.proto": "ο διακομιστής απάντησε απρόσμενα", "err.closed": "ο διακομιστής έκλεισε τη σύνδεση",
      "err.origin": "αυτή η σελίδα δεν επιτρέπεται να χρησιμοποιεί το relay", "err.bad-request": "το relay απέρριψε το αίτημα",
      "set.title": "Ρυθμίσεις", "set.backup": "Αντίγραφο ασφαλείας (JSON)", "set.restore": "Επαναφορά από αντίγραφο", "set.data": "Δεδομένα",
      "set.about": "Σχετικά", "set.aboutText": "Το Ενημερωτικό δελτίο στέλνει ένα email σε κάθε συνδρομητή μέσω του relay του orOS, από τον δικό σου λογαριασμό ή το SMTP ενός παρόχου, όσο είναι ανοιχτό. Δεν παρακολουθεί τίποτα: δεν μετρά ανοίγματα ή κλικ. Τα αιτήματα εγγραφής, επιβεβαίωσης και διαγραφής είναι email που διαβάζει από τα Εισερχόμενά σου.",
      "set.dev": "Στάλθηκαν από αυτή τη συσκευή σήμερα: {n}",
      "dom.title": "Έλεγχος domain: {d}", "dom.spf": "SPF", "dom.dkim": "DKIM", "dom.dmarc": "DMARC",
      "dom.spfOk": "Βρέθηκε: {v}", "dom.spfNo": "Δεν βρέθηκε: ζήτα από τον πάροχο email σου την εγγραφή SPF του domain σου.",
      "dom.dkimOk": "Βρέθηκε (selector «{s}»).", "dom.dkimNo": "Δεν βρέθηκε στα συνηθισμένα ονόματα. Ο πάροχός σου μπορεί να χρησιμοποιεί άλλο: το λέει ο οδηγός του.",
      "dom.dmarcOk": "Βρέθηκε: {v}", "dom.dmarcNo": "Δεν βρέθηκε: πρόσθεσε εγγραφή TXT _dmarc με τουλάχιστον v=DMARC1; p=none.",
      "dom.public": "Το {d} είναι δημόσια υπηρεσία email: τα φροντίζει η ίδια.", "dom.fail": "Ο έλεγχος θέλει σύνδεση.",
      "dom.wait": "Έλεγχος…", "dom.hint": "Αυτές οι εγγραφές λένε στα Εισερχόμενα ότι τα email σου είναι όντως δικά σου· χωρίς αυτές τα newsletter συχνά πάνε στα spam.",
      "toast.undo": "Αναίρεση", "toast.save": "Δεν αποθηκεύτηκε: ο χώρος του browser γέμισε", "toast.deleted": "Διαγράφηκε",
      "toast.badFile": "Αυτό το αρχείο δεν είναι αντίγραφο του Ενημερωτικού δελτίου", "toast.restored": "Επαναφέρθηκε και συγχωνεύτηκε", "toast.exported": "Αποθηκεύτηκε",
      "toast.noDisk": "Ο δίσκος του orOS δεν είναι διαθέσιμος εδώ", "toast.imgBad": "Δεν διαβάστηκε αυτή η εικόνα",
      "toast.sentAll": "Το «{s}» στάλθηκε σε {n}", "toast.noCsv": "Δεν βρέθηκαν διευθύνσεις σε αυτό το αρχείο", "toast.invSent": "Τα αιτήματα επιβεβαίωσης στάλθηκαν",
      "toast.testFail": "Η δοκιμή δεν στάλθηκε: {e}", "toast.chanFail": "Η σύνδεση απέτυχε: {e}", "toast.opened": "Άνοιξε από {a}",
      "live.saved": "Αποθηκεύτηκε", "time.now": "μόλις τώρα"
    }
  };

  function fill(s, params) {
    if (params) Object.keys(params).forEach(function (k) { s = s.split("{" + k + "}").join(String(params[k])); });
    return s;
  }
  function t(key, params) {
    var p = STRINGS[LANG] || STRINGS.en;
    var s = p[key] !== undefined ? p[key] : (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
    return fill(s, params);
  }
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  var stamp = E.stamp, dayKey = E.dayKey;
  function when(ms) {
    if (!ms) return "";
    var ago = Date.now() - ms;
    if (ago >= 0 && ago < 60000) return t("time.now");
    try {
      return new Date(ms).toLocaleString(LANG === "el" ? "el-GR" : "en-GB",
        { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch (e) { return new Date(ms).toISOString().slice(0, 16).replace("T", " "); }
  }
  function errText(e) {
    var code = e && e.code ? e.code : "relay";
    var key = "err." + code;
    var s = t(key, { m: String(e && e.msg || "").slice(0, 120) });
    return s === key ? t("err.relay") : s;
  }
  // A paused issue's stored reason: a code ("auth", "no:<server text>"),
  // or phase 1's already translated text.
  function errStored(v) {
    v = String(v || "");
    var m = /^no:([\s\S]*)$/.exec(v);
    if (m) return errText({ code: "no", msg: m[1] });
    return /^[a-z-]{1,20}$/.test(v) ? errText({ code: v }) : v;
  }

  var UI = {
    left:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 6 9 12 15 18"/></svg>',
    gear:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    plus:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    mail:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/></svg>',
    list:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
    up:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 15 12 9 18 15"/></svg>',
    down:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
    x:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>'
  };

  // BOOT MARKER
  (function () {
    document.documentElement.lang = LANG;
    console.log("newsletter.js v" + (SCRIPT_V || "?") + " boot");
  })();

  // ---------- 2. Storage + prefs ----------
  var data = null, prefs = null;
  var view = "issues";        // issues | subs | lists | edit | view | set
  var viewId = "";            // the issue in the editor / viewer

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    data = C.parse(raw);
    if (data) return;
    try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
    data = C.empty();
  }
  var saveFailShown = false;
  // Merge-on-write: what orOS (sending with this window closed), another
  // tab or a sync pull wrote meanwhile is kept, never undone.
  function saveNow() {
    var out = E.write(data);
    if (out) { data = out; saveFailShown = false; }
    else {
      data = C.normalize(data);
      if (!saveFailShown) { saveFailShown = true; showToast(t("toast.save")); }   // R30
    }
    dirty();
  }
  function dirty() { if (window.__orosSyncApi) window.__orosSyncApi.dirty(); }
  // Someone else wrote (orOS sending, another tab): take it in quietly.
  function reloadQuiet() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    var d = C.parse(raw);
    if (!d || JSON.stringify(d) === JSON.stringify(data)) return;
    data = d;
    refreshQuiet();
  }
  var TABS = ["issues", "subs", "lists"];
  function loadPrefs() {
    var v = null;
    try { v = JSON.parse(localStorage.getItem(PREFS_KEY) || "null"); } catch (e) {}
    v = v && typeof v === "object" ? v : {};
    var f = v.f && typeof v.f === "object" ? v.f : {};
    prefs = {
      tab: TABS.indexOf(v.tab) >= 0 ? v.tab : "issues",
      list: typeof v.list === "string" ? v.list.slice(0, 40) : "",
      f: { st: typeof f.st === "string" ? f.st.slice(0, 10) : "", tag: typeof f.tag === "string" ? f.tag.slice(0, 40) : "" }
    };
    E.devState();                 // moves phase 1's device fields out of prefs first
    savePrefs();
  }
  function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {} }
  function curList() {
    var l = C.list(data, prefs.list);
    if (l) return l;
    var all = C.live(data.lists);
    return all.length ? all[0] : null;
  }

  // ---------- 3. Edits ----------
  function replaceIn(arr, rec) {
    for (var i = 0; i < arr.length; i++) if (arr[i].id === rec.id) { arr[i] = rec; return; }
    arr.push(rec);
  }
  function put(coll, rec) { rec.m = stamp(rec.m); replaceIn(data[coll], rec); saveNow(); }
  function copy(x) { return JSON.parse(JSON.stringify(x)); }
  function remove(coll, id) {
    var cur = null;
    data[coll].forEach(function (x) { if (x.id === id) cur = x; });
    if (!cur) return null;
    var before = copy(cur);
    replaceIn(data[coll], { id: id, m: stamp(cur.m), del: 1 });
    saveNow();
    return before;
  }
  function restore(coll, rec) { put(coll, rec); }

  // ---------- 4. Mail accounts, passwords, relay (engine.js) ----------
  var mailAccounts = E.mailAccounts, mailAccount = E.mailAccount, inboxAccount = E.inboxAccount;
  var savePass = E.savePass, sendCreds = E.sendCreds, relay = E.relay;
  function hasOwnPass(chanId) { return E.ownPass(chanId).then(function (p) { return !!p; }); }

  // ---------- 5. Render: issues ----------
  function chanName(ch) {
    if (!ch) return "";
    if (ch.kind === "mail") { var a = mailAccount(ch.acct); return a ? a.email : t("chans.gone"); }
    return ch.name || t("p." + ch.preset) || ch.host;
  }
  function listOptions(sel) {
    sel.innerHTML = "";
    var cur = curList();
    C.live(data.lists).forEach(function (l) {
      var o = el("option", "", l.name || "—");
      o.value = l.id;
      if (cur && l.id === cur.id) o.selected = true;
      sel.appendChild(o);
    });
    sel.hidden = !C.live(data.lists).length;
  }
  function listSummary(node) {
    var l = curList();
    if (!l) { node.textContent = ""; return; }
    var c = C.counts(data, l.id);
    var parts = [c.on === 1 ? t("sum.on1") : t("sum.on", { n: c.on })];
    if (c.pend) parts.push(t("sum.pend", { n: c.pend }));
    node.textContent = parts.join(" · ");
  }
  function renderSetup() {
    var b = $("setup");
    var hasChan = C.live(data.chans).length > 0, hasList = C.live(data.lists).length > 0;
    b.hidden = hasList;
    if (hasList) return;
    $("setup-text").textContent = hasChan ? t("setup.noList") : t("setup.noChan");
    $("setup-go").textContent = hasChan ? t("setup.go") : t("setup.goChan");
  }
  function renderIssues() {
    listOptions($("list-pick-i"));
    listSummary($("sum-i"));
    renderSetup();
    var l = curList(), ol = $("issues");
    ol.innerHTML = "";
    var items = l ? C.live(data.issues).filter(function (x) { return x.list === l.id; }) : [];
    var order = { sending: 0, paused: 1, sched: 2, draft: 3, sent: 4 };
    items.sort(function (a, b) {
      if (order[a.st] !== order[b.st]) return order[a.st] - order[b.st];
      return (b.done || b.m) - (a.done || a.m);
    });
    items.forEach(function (x) {
      var li = el("li");
      var b = el("button", "row");
      b.type = "button";
      var txt = el("span", "row-txt");
      var top = el("span", "row-top");
      top.appendChild(el("span", "row-no", shownSubj(x)));
      txt.appendChild(top);
      var p = C.progress(data, x);
      var sub = x.st === "sent" ? [when(x.done), p.sent === 1 ? t("iss.sentTo1") : t("iss.sentTo", { n: p.sent })]
              : x.st === "draft" ? [when(x.m)] : x.st === "sched" ? [t("iss.sched", { t: when(x.when) })]
              : [t("iss.prog", { a: p.sent, b: p.total })];
      if (p.failed) sub.push(t("iss.failed", { n: p.failed }));
      txt.appendChild(el("span", "row-sub", sub.filter(Boolean).join(" · ")));
      b.appendChild(txt);
      b.appendChild(el("span", "chip st-" + x.st, t("st." + x.st)));
      b.addEventListener("click", function () { openIssue(x.id); });
      li.appendChild(b);
      ol.appendChild(li);
    });
    $("issues-empty").hidden = !!items.length || !l;
  }
  // The subject as people without a name see it ({first|you} → you).
  function shownSubj(x) { return x.subj ? R.personalize(x.subj, null) : t("iss.noSubj"); }
  function openIssue(id) {
    var x = C.issue(data, id);
    if (!x) return;
    viewId = id;
    showView(x.st === "draft" ? "edit" : "view");
  }

  // ---------- 6. Render: subscribers ----------
  var SUB_ROWS = 300;
  function renderSubs() {
    listOptions($("list-pick-s"));
    listSummary($("sum-s"));
    var l = curList();
    var stSel = $("f-st"), tagSel = $("f-tag");
    stSel.innerHTML = "";
    [["", t("subs.allSt")], ["on", t("sst.on")], ["pend", t("sst.pend")], ["off", t("sst.off")], ["bounce", t("sst.bounce")]]
      .forEach(function (o) { var op = el("option", "", o[1]); op.value = o[0]; stSel.appendChild(op); });
    stSel.value = prefs.f.st;
    tagSel.innerHTML = "";
    var o0 = el("option", "", t("subs.allTags")); o0.value = ""; tagSel.appendChild(o0);
    var tags = l ? C.allTags(data, l.id) : [];
    tags.forEach(function (tg) { var op = el("option", "", tg); op.value = tg; tagSel.appendChild(op); });
    tagSel.value = tags.indexOf(prefs.f.tag) >= 0 ? prefs.f.tag : "";
    tagSel.hidden = !tags.length;
    var acts = $("subs-acts");
    acts.innerHTML = "";
    $("subs").innerHTML = "";
    $("subs-more").hidden = true;
    $("inbox-note").textContent = "";
    if (!l) { $("subs-empty").hidden = true; acts.hidden = true; return; }
    acts.hidden = false;
    acts.appendChild(mini(t("subs.add"), function () { subDialog(null); }));
    acts.appendChild(mini(t("subs.paste"), pasteDialog));
    acts.appendChild(mini(t("subs.csv"), importCsv));
    acts.appendChild(mini(t("subs.contacts"), contactsDialog));
    if (crmPeople()) acts.appendChild(mini(t("subs.crm"), crmDialog));
    acts.appendChild(mini(t("subs.export"), exportCsv));
    var ch = C.chan(data, l.chan), inbox = inboxAccount(ch);
    if (inbox) acts.appendChild(mini(t("subs.inbox"), inboxNow));
    var due = C.invitesDue(data, l.id).length;
    if (due) acts.appendChild(mini(t("subs.invite", { n: due }), kick));
    var at = E.devState().inbox.at || 0;
    $("inbox-note").textContent = !inbox ? t("inbox.no") : (at ? t("inbox.at", { t: when(at) }) : t("inbox.never"));

    var q = C.fold($("sq").value.trim());
    var all = C.subsOf(data, l.id);
    var rows = all.filter(function (s) {
      var st = C.status(s);
      if (prefs.f.st && (prefs.f.st === "off" ? (st !== "off" && st !== "spam") : st !== prefs.f.st)) return false;
      if (tagSel.value && s.tags.indexOf(tagSel.value) < 0) return false;
      if (q && C.fold(s.email + " " + s.name + " " + s.tags.join(" ")).indexOf(q) < 0) return false;
      return true;
    }).sort(function (a, b) { return a.email < b.email ? -1 : 1; });
    var ol = $("subs");
    rows.slice(0, SUB_ROWS).forEach(function (s) {
      var li = el("li");
      var b = el("button", "row");
      b.type = "button";
      var txt = el("span", "row-txt");
      var top = el("span", "row-top");
      top.appendChild(el("span", "row-no", s.name || s.email));
      txt.appendChild(top);
      txt.appendChild(el("span", "row-sub", [s.name ? s.email : "", s.tags.join(", ")].filter(Boolean).join(" · ") || " "));
      b.appendChild(txt);
      var st = C.status(s);
      b.appendChild(el("span", "chip sst-" + st, t("sst." + st)));
      b.addEventListener("click", function () { subDialog(s.id); });
      li.appendChild(b);
      ol.appendChild(li);
    });
    if (rows.length > SUB_ROWS) {
      $("subs-more").hidden = false;
      $("subs-more").textContent = t("subs.more", { a: SUB_ROWS, b: rows.length });
    }
    $("subs-empty").hidden = !!all.length;
    if (all.length && !rows.length) { $("subs-more").hidden = false; $("subs-more").textContent = t("subs.none"); }
  }
  function mini(label, fn) {
    var b = el("button", "mini-btn", label);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }

  // ---------- 7. Render: lists + sending accounts ----------
  function renderLists() {
    var box = $("lists");
    box.innerHTML = "";
    var lists = C.live(data.lists);
    if (!lists.length) box.appendChild(el("p", "hint", t("lists.none")));
    lists.forEach(function (l) {
      var card = el("div", "card list-card");
      var head = el("div", "lc-head");
      var dot = el("span", "dot");
      dot.style.background = l.color;
      head.appendChild(dot);
      head.appendChild(el("span", "lc-name", l.name || "—"));
      card.appendChild(head);
      var ch = C.chan(data, l.chan);
      var c = C.counts(data, l.id);
      card.appendChild(el("p", "row-sub", [l.from, ch ? t("lists.via", { c: chanName(ch) }) : t("lists.noChan")].filter(Boolean).join(" · ")));
      card.appendChild(el("p", "row-sub", [c.on === 1 ? t("sum.on1") : t("sum.on", { n: c.on }), c.pend ? t("sum.pend", { n: c.pend }) : ""].filter(Boolean).join(" · ")));
      var acts = el("div", "acts");
      acts.appendChild(mini(t("lists.edit"), function () { listDialog(l.id); }));
      acts.appendChild(mini(t("lists.subLink"), function () { linkDialog(l.id); }));
      if (l.from) acts.appendChild(mini(t("lists.check"), function () { domainDialog(l.from); }));
      card.appendChild(acts);
      box.appendChild(card);
    });
    $("add-list").innerHTML = UI.plus + "<span></span>";
    $("add-list").lastChild.textContent = t("lists.new");
    $("add-chan").innerHTML = UI.plus + "<span></span>";
    $("add-chan").lastChild.textContent = t("chans.add");
    var ol = $("chans");
    ol.innerHTML = "";
    var chans = C.live(data.chans);
    if (!chans.length) { var li0 = el("li"); li0.appendChild(el("p", "hint", t("chans.none"))); ol.appendChild(li0); }
    chans.forEach(function (ch) {
      var li = el("li");
      var b = el("button", "row");
      b.type = "button";
      var txt = el("span", "row-txt");
      txt.appendChild(el("span", "row-no", chanName(ch)));
      var note = el("span", "row-sub", [ch.kind === "mail" ? t("chans.mail") : (t("p." + ch.preset) + " · " + ch.host),
                                        t("chans.limit", { s: ch.rate, n: ch.cap })].join(" · "));
      txt.appendChild(note);
      b.appendChild(txt);
      if (ch.kind === "smtp") {
        hasOwnPass(ch.id).then(function (ok) { if (!ok) note.textContent += " · " + t("chans.noPass"); });
      }
      b.addEventListener("click", function () { chanDialog(ch.id); });
      li.appendChild(b);
      ol.appendChild(li);
    });
  }

  // ---------- 8. Issue editor ----------
  var saveTimer = null;
  function touchIssue(x, rerenderAud) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      var cur = C.issue(data, x.id);
      if (!cur || cur.st !== "draft") return;
      put("issues", x);
      $("ed-sub").textContent = t("ed.saved");
      $("live").textContent = t("live.saved");
    }, 500);
    if (rerenderAud) audienceNote(x);
  }
  function flushIssue() {
    if (!saveTimer) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    var x = edIssue;
    if (x && C.issue(data, x.id) && C.issue(data, x.id).st === "draft") put("issues", x);
  }
  var edIssue = null;
  function newIssue() {
    var l = curList();
    if (!l) { listDialog(null); return; }
    var tpls = C.live(data.tpls);
    if (!tpls.length) { createIssue(l, null); return; }
    var dlg = makeDialog("nl-new", t("tpl.new"));
    var ul = el("ul", "plain tpl-list");
    var row = function (label, fn, tpl) {
      var li = el("li", "tpl-row");
      var b = el("button", "row", label);
      b.type = "button";
      b.addEventListener("click", function () { dlg.close(); fn(); });
      li.appendChild(b);
      if (tpl) {
        var ib = el("button", "icon-btn sm");
        ib.type = "button";
        ib.innerHTML = UI.x;
        ib.title = t("tpl.delete");
        ib.setAttribute("aria-label", t("tpl.delete") + ": " + tpl.name);
        ib.addEventListener("click", function () {
          var before = remove("tpls", tpl.id);
          li.remove();
          undoToast(t("toast.deleted"), function () { if (before) restore("tpls", before); });
        });
        li.appendChild(ib);
      }
      ul.appendChild(li);
    };
    row(t("tpl.blank"), function () { createIssue(l, null); });
    dlg.appendChild(ul);
    dlg.appendChild(el("p", "dlg-h", t("tpl.from")));
    var ul2 = el("ul", "plain tpl-list");
    ul = ul2;
    tpls.sort(function (a, b) { return C.fold(a.name) < C.fold(b.name) ? -1 : 1; })
      .forEach(function (tp) { row(tp.name || shownSubj(tp), function () { createIssue(l, tp); }, tp); });
    dlg.appendChild(ul2);
    actionsRow(dlg, [], "", null);
    openDialog(dlg);
  }
  function createIssue(l, tpl) {
    var x = C.normIssue(tpl ? { id: C.randomId("i", null), m: 0, list: l.id, subj: tpl.subj, pre: tpl.pre, fmt: tpl.fmt,
                                blocks: copy(tpl.blocks), md: tpl.md, l2: tpl.l2 ? copy(tpl.l2) : null }
      : { id: C.randomId("i", null), m: 0, list: l.id, fmt: "blocks",
          blocks: [{ k: "h", t: "" }, { k: "p", t: LANG === "el" ? "Γεια σου {first|φίλε}," : "Hi {first|there}," }] });
    put("issues", x);
    viewId = x.id;
    showView("edit");
  }
  function saveTemplate(x) {
    if (C.live(data.tpls).length >= C.LIM.tpls) { showToast(t("tpl.full")); return; }
    var dlg = makeDialog("nl-tpl", t("tpl.save"));
    var name = inp("text", shownSubj(x) === t("iss.noSubj") ? "" : shownSubj(x), C.LIM.name);
    dlg.appendChild(field(t("tpl.name"), name));
    actionsRow(dlg, [], t("dlg.save"), function () {
      var nm = name.value.trim();
      name.classList.toggle("bad", !nm);
      if (!nm) return;
      put("tpls", C.normTpl({ id: C.randomId("t", null), m: 0, name: nm, subj: x.subj, pre: x.pre, fmt: x.fmt,
                              blocks: copy(x.blocks), md: x.md, l2: x.l2 ? copy(x.l2) : null }));
      dlg.close();
      showToast(t("tpl.saved"));
    });
    openDialog(dlg, name);
  }
  // The editor shows the main version or the other language's (x.l2).
  var edSide = { id: "", l2: false };
  function side(x) { return edSide.id === x.id && edSide.l2 && x.l2 ? x.l2 : x; }
  function langName(k) { return t("lang." + (k === "el" ? "el" : "en")); }
  // The main version's language: the other one when there is a second
  // version, else the list's.
  function mainLang(x, l) { return x.l2 ? (x.l2.lang === "el" ? "en" : "el") : ((l && l.lang) || "en"); }
  function renderEditor() {
    var x0 = C.issue(data, viewId);
    if (!x0 || x0.st !== "draft") { showView(x0 ? "view" : "issues"); return; }
    var x = edIssue = copy(x0);
    var l = C.list(data, x.list);
    var cx = side(x);
    $("ed-title").textContent = x.subj || t("ed.new");
    $("ed-sub").textContent = l ? l.name : "";
    var form = $("ed-form");
    form.innerHTML = "";

    var c1 = el("div", "card");
    c1.appendChild(versionBar(x, l));
    var subj = inp("text", cx.subj, C.LIM.subj);
    subj.addEventListener("input", function () { cx.subj = subj.value; $("ed-title").textContent = x.subj || t("ed.new"); touchIssue(x); });
    c1.appendChild(field(t("ed.subj"), subj));
    var pre = inp("text", cx.pre, C.LIM.pre);
    pre.addEventListener("input", function () { cx.pre = pre.value; touchIssue(x); });
    c1.appendChild(field(t("ed.pre"), pre, t("ed.preHint")));
    c1.appendChild(audienceField(x));
    form.appendChild(c1);

    var c2 = el("div", "card");
    var seg = el("div", "seg");
    [["blocks", t("ed.blocks")], ["md", t("ed.md")]].forEach(function (o) {
      var b = el("button", "seg-btn" + (cx.fmt === o[0] ? " on" : ""), o[1]);
      b.type = "button";
      b.setAttribute("aria-pressed", cx.fmt === o[0] ? "true" : "false");
      b.addEventListener("click", function () {
        if (cx.fmt === o[0]) return;
        cx.fmt = o[0];
        put("issues", x);
        renderEditor();
      });
      seg.appendChild(b);
    });
    var hc = el("div", "card-head");
    hc.appendChild(el("h3", "sec-h", t("ed.content")));
    hc.appendChild(seg);
    c2.appendChild(hc);
    if (cx.fmt === "md") {
      var ta = el("textarea", "md-area");
      ta.value = cx.md;
      ta.maxLength = C.LIM.md;
      ta.rows = 16;
      ta.spellcheck = true;
      ta.addEventListener("input", function () { cx.md = ta.value; touchIssue(x); });
      c2.appendChild(ta);
      c2.appendChild(el("p", "hint", t("ed.mdHint")));
    } else {
      var box = el("div", "blocks");
      box.id = "blocks";
      c2.appendChild(box);
      renderBlocks(x, box);
      var add = el("div", "acts");
      ["h", "p", "img", "btn", "hr", "cols"].forEach(function (k) {
        add.appendChild(mini("+ " + t("bk." + k), function () {
          if (cx.blocks.length >= C.LIM.blocks) return;
          cx.blocks.push(k === "hr" ? { k: "hr" } : (k === "cols" ? { k: "cols", a: "", b: "" } :
                        (k === "img" ? { k: "img", f: "", alt: "", href: "", w: 600, h: 400, b: 0 } : { k: k, t: "", href: "" })));
          put("issues", x);
          renderBlocks(x, $("blocks"));
          if (k === "img") pickImage(x, cx.blocks.length - 1);
        }));
      });
      c2.appendChild(add);
    }
    c2.appendChild(el("p", "hint", t("ed.phHint")));
    form.appendChild(c2);

    var bar = el("div", "ed-bar");
    var actsB = el("div", "ed-acts");
    actsB.appendChild(btn(t("ed.preview"), "", function () { flushIssue(); previewDialog(C.issue(data, x.id)); }));
    actsB.appendChild(btn(t("ed.test"), "", function () { flushIssue(); testDialog(C.issue(data, x.id)); }));
    actsB.appendChild(btn(t("ed.check"), "", function () { flushIssue(); checkDialog(C.issue(data, x.id), false); }));
    actsB.appendChild(btn(t("tpl.save"), "", function () { flushIssue(); saveTemplate(C.issue(data, x.id)); }));
    actsB.appendChild(el("span", "spacer"));
    actsB.appendChild(btn(t("ed.delete"), "danger", function () {
      flushIssue();
      var before = remove("issues", x.id);
      showView("issues");
      undoToast(t("toast.deleted"), function () { if (before) restore("issues", before); renderAll(); });
    }));
    actsB.appendChild(btn(t("ed.send"), "primary", function () { flushIssue(); checkDialog(C.issue(data, x.id), true); }));
    bar.appendChild(actsB);
    form.appendChild(bar);
    audienceNote(x);
  }
  // Main version | other language, and adding / removing the second one.
  function versionBar(x, l) {
    var w = el("div", "ver-bar");
    var a = mainLang(x, l), b = a === "el" ? "en" : "el";
    if (!x.l2) {
      w.appendChild(mini(t("ed.l2Add", { l: langName(b) }), function () {
        flushIssue();
        x.l2 = C.normL2({ lang: b, subj: x.subj, pre: x.pre, fmt: x.fmt, blocks: copy(x.blocks), md: x.md });
        edSide = { id: x.id, l2: true };
        put("issues", x);
        renderEditor();
      }));
      return w;
    }
    var seg = el("div", "seg");
    seg.setAttribute("role", "group");
    seg.setAttribute("aria-label", t("ed.version"));
    [[false, a], [true, b]].forEach(function (o) {
      var on = (side(x) !== x) === o[0];
      var bt = el("button", "seg-btn" + (on ? " on" : ""), langName(o[1]));
      bt.type = "button";
      bt.setAttribute("aria-pressed", on ? "true" : "false");
      bt.addEventListener("click", function () {
        if (on) return;
        flushIssue();
        edSide = { id: x.id, l2: o[0] };
        renderEditor();
      });
      seg.appendChild(bt);
    });
    w.appendChild(seg);
    if (side(x) !== x) {
      w.appendChild(mini(t("ed.l2Remove", { l: langName(b) }), function () {
        flushIssue();
        var gone = copy(x.l2);
        x.l2 = null;
        edSide = { id: x.id, l2: false };
        put("issues", x);
        renderEditor();
        undoToast(t("ed.l2Removed"), function () {
          var cur = C.issue(data, x.id);
          if (!cur || cur.st !== "draft") return;
          var y = copy(cur); y.l2 = gone; put("issues", y);
          if (view === "edit" && viewId === x.id) renderEditor();
        });
      }));
    }
    w.appendChild(el("p", "hint", t("ed.l2Hint", { a: langName(a), b: langName(b) })));
    return w;
  }
  // Everyone, some tags, or a saved segment.
  function audienceField(x) {
    var w = el("div", "fld");
    w.appendChild(el("span", "dlg-lbl", t("ed.aud")));
    var tags = C.allTags(data, x.list), segs = C.segsOf(data, x.list);
    var mode = x.seg ? "g:" + x.seg : (x.tags.length ? "tags" : "all");
    var opts = [["all", t("aud.all")]];
    if (tags.length || mode === "tags") opts.push(["tags", t("aud.tags")]);
    segs.forEach(function (g) { opts.push(["g:" + g.id, t("aud.seg", { n: g.name || t("seg.unnamed") })]); });
    if (x.seg && !segs.some(function (g) { return g.id === x.seg; })) opts.push([mode, t("ck.segGone")]);
    var pick = sel(opts, mode);
    pick.setAttribute("aria-label", t("ed.aud"));
    var row = el("div", "aud-row");
    row.appendChild(pick);
    row.appendChild(mini(t("seg.manage"), function () { flushIssue(); segmentsDialog(x.list); }));
    w.appendChild(row);
    var chips = el("div", "chips");
    tags.forEach(function (tg) {
      var lab = el("label", "tag-chip");
      var cb = el("input");
      cb.type = "checkbox";
      cb.checked = x.tags.indexOf(tg) >= 0;
      cb.addEventListener("change", function () {
        x.tags = x.tags.filter(function (y) { return y !== tg; });
        if (cb.checked) x.tags.push(tg);
        x.tags.sort();
        touchIssue(x, true);
      });
      lab.appendChild(cb);
      lab.appendChild(el("span", "", tg));
      chips.appendChild(lab);
    });
    chips.hidden = mode !== "tags";
    w.appendChild(chips);
    pick.addEventListener("change", function () {
      var v = pick.value;
      x.seg = v.indexOf("g:") === 0 ? v.slice(2) : "";
      if (v !== "tags") {
        x.tags = [];
        [].forEach.call(chips.querySelectorAll("input"), function (c) { c.checked = false; });
      }
      chips.hidden = v !== "tags";
      touchIssue(x, true);
    });
    var note = el("p", "hint", "");
    note.id = "aud-note";
    w.appendChild(note);
    return w;
  }
  function audienceNote(x) {
    var n = $("aud-note");
    if (!n) return;
    var count = C.audience(data, x).length;
    var cnt = count === 1 ? t("ed.audN1") : t("ed.audN", { n: count });
    n.textContent = x.seg ? t("ed.audSeg") + ": " + cnt
                  : x.tags.length ? t("ed.audTags") + ": " + cnt : t("ed.audAll", { n: count });
  }
  // ---------- segments ----------
  function segmentsDialog(listId) {
    var dlg = makeDialog("nl-segs", t("seg.title"), true);
    var segs = C.segsOf(data, listId);
    if (!segs.length) dlg.appendChild(el("p", "hint", t("seg.none")));
    var ul = el("ul", "plain tpl-list");
    segs.forEach(function (g) {
      var li = el("li", "tpl-row");
      var b = el("button", "row");
      b.type = "button";
      var tx = el("span", "row-txt");
      tx.appendChild(el("span", "row-no", g.name || t("seg.unnamed")));
      tx.appendChild(el("span", "row-sub", segText(g, listId)));
      b.appendChild(tx);
      b.addEventListener("click", function () { dlg.close(); segDialog(listId, g); });
      li.appendChild(b);
      ul.appendChild(li);
    });
    dlg.appendChild(ul);
    actionsRow(dlg, [], t("seg.add"), function () {
      if (C.live(data.segs).length >= C.LIM.segs) { showToast(t("seg.full")); return; }
      dlg.close();
      segDialog(listId, null);
    });
    openDialog(dlg);
  }
  function segCount(g, listId) {
    var l = C.list(data, listId);
    return C.subsOf(data, listId).filter(function (s) { return C.status(s) === "on" && C.segMatch(g, s, l); }).length;
  }
  function segText(g, listId) {
    var parts = [];
    if (g.tags.length) parts.push((g.match === "all" ? t("seg.all") : t("seg.any")) + ": " + g.tags.join(", "));
    if (g.lang) parts.push(langName(g.lang));
    parts.push(t("seg.count", { n: segCount(g, listId) }));
    return parts.join(" · ");
  }
  function segDialog(listId, g) {
    var src = g ? copy(g) : { id: C.randomId("g", null), m: 0, list: listId, name: "", tags: [], match: "any", lang: "" };
    var dlg = makeDialog("nl-seg", t("seg.edit"), true);
    var name = inp("text", src.name, C.LIM.name);
    dlg.appendChild(field(t("seg.name"), name));
    var tags = C.allTags(data, listId);
    src.tags.forEach(function (tg) { if (tags.indexOf(tg) < 0) tags.push(tg); });
    var tw = el("div", "fld");
    tw.appendChild(el("span", "dlg-lbl", t("seg.tags")));
    if (!tags.length) tw.appendChild(el("p", "hint", t("seg.noTags")));
    var chips = el("div", "chips");
    tags.forEach(function (tg) {
      var lab = el("label", "tag-chip");
      var cb = el("input");
      cb.type = "checkbox";
      cb.value = tg;
      cb.checked = src.tags.indexOf(tg) >= 0;
      cb.addEventListener("change", update);
      lab.appendChild(cb);
      lab.appendChild(el("span", "", tg));
      chips.appendChild(lab);
    });
    tw.appendChild(chips);
    dlg.appendChild(tw);
    var match = sel([["any", t("seg.any")], ["all", t("seg.all")]], src.match);
    match.addEventListener("change", update);
    dlg.appendChild(field(t("seg.match"), match));
    var lang = sel([["", t("seg.anyLang")], ["en", langName("en")], ["el", langName("el")]], src.lang);
    lang.addEventListener("change", update);
    dlg.appendChild(field(t("seg.lang"), lang));
    var count = el("p", "dlg-text");
    dlg.appendChild(count);
    function collect() {
      var r = copy(src);
      r.name = name.value;
      r.tags = [].filter.call(chips.querySelectorAll("input"), function (c) { return c.checked; }).map(function (c) { return c.value; });
      r.match = match.value;
      r.lang = lang.value;
      return C.normSeg(r);
    }
    function update() { var r = collect(); if (r) count.textContent = t("seg.count", { n: segCount(r, listId) }); }
    var left = [];
    if (g) {
      left.push(btn(t("ed.delete"), "danger", function () {
        var busy = C.live(data.issues).some(function (x) { return x.seg === g.id && x.st !== "draft" && x.st !== "sent"; });
        if (busy) { showToast(t("seg.inUse")); return; }
        var before = remove("segs", g.id);
        dlg.close();
        segsChanged();
        undoToast(t("toast.deleted"), function () { if (before) restore("segs", before); segsChanged(); });
      }));
    }
    actionsRow(dlg, left, t("dlg.save"), function () {
      var r = collect();
      if (!r || !r.name.trim()) { name.classList.add("bad"); return; }
      put("segs", r);
      dlg.close();
      segsChanged();
    });
    update();
    openDialog(dlg, name);
  }
  // the editor's audience picker lists segments: draw it again
  function segsChanged() {
    if (view === "edit") { flushIssue(); renderEditor(); }
    else renderAll();
  }
  var thumbs = {};      // path → object URL (this session)
  function renderBlocks(x, box) {
    box.innerHTML = "";
    var cx = side(x);
    cx.blocks.forEach(function (b, i) {
      var card = el("div", "blk");
      var head = el("div", "blk-head");
      head.appendChild(el("span", "blk-k", t("bk." + b.k)));
      head.appendChild(el("span", "spacer"));
      [["up", UI.up, t("bk.up"), i > 0], ["down", UI.down, t("bk.down"), i < cx.blocks.length - 1], ["x", UI.x, t("bk.remove"), true]]
        .forEach(function (a) {
          var ib = el("button", "icon-btn sm");
          ib.type = "button";
          ib.innerHTML = a[1];
          ib.title = a[2];
          ib.setAttribute("aria-label", a[2]);
          ib.disabled = !a[3];
          ib.addEventListener("click", function () {
            if (a[0] === "x") {
              var gone = cx.blocks.splice(i, 1)[0];
              put("issues", x);
              renderBlocks(x, box);
              undoToast(t("toast.deleted"), function () {
                cx.blocks.splice(Math.min(i, cx.blocks.length), 0, gone);
                put("issues", x);
                renderBlocks(x, box);
              });
              return;
            }
            var j = a[0] === "up" ? i - 1 : i + 1;
            var tmp = cx.blocks[i]; cx.blocks[i] = cx.blocks[j]; cx.blocks[j] = tmp;
            put("issues", x);
            renderBlocks(x, box);
          });
          head.appendChild(ib);
        });
      card.appendChild(head);
      var bind = function (ctl, key) {
        ctl.addEventListener("input", function () { b[key] = ctl.value; touchIssue(x); });
        return ctl;
      };
      if (b.k === "h") card.appendChild(bind(inp("text", b.t, 300), "t"));
      else if (b.k === "p") card.appendChild(bind(area(b.t, 5), "t"));
      else if (b.k === "cols") {
        var r = el("div", "cols-ed");
        r.appendChild(field(t("bk.left"), bind(area(b.a, 4), "a")));
        r.appendChild(field(t("bk.right"), bind(area(b.b, 4), "b")));
        card.appendChild(r);
      } else if (b.k === "btn") {
        card.appendChild(field(t("bk.btnText"), bind(inp("text", b.t, 80), "t")));
        card.appendChild(field(t("bk.link"), bind(inp("url", b.href, 2000), "href")));
      } else if (b.k === "img") {
        var row = el("div", "img-row");
        var im = el("img", "img-thumb");
        im.alt = "";
        if (b.f) {
          showThumb(b.f, im, row);
        } else row.appendChild(el("span", "hint", t("bk.noImg")));
        row.insertBefore(im, row.firstChild);
        row.appendChild(mini(t("bk.pick"), function () { pickImage(x, i); }));
        card.appendChild(row);
        card.appendChild(field(t("bk.alt"), bind(inp("text", b.alt, 300), "alt")));
        card.appendChild(field(t("bk.link"), bind(inp("url", b.href, 2000), "href")));
      }
      box.appendChild(card);
    });
  }
  function showThumb(path, im, row) {
    if (thumbs[path]) { im.src = thumbs[path]; return; }
    var fs = orosFS();
    if (!fs) return;
    fs.readBlob(path).then(function (blob) {
      thumbs[path] = URL.createObjectURL(blob);
      im.src = thumbs[path];
    })["catch"](function () { row.appendChild(el("span", "hint", t("bk.imgMissing"))); });
  }

  // ---------- 9. Issue view ----------
  function renderViewer() {
    var x = C.issue(data, viewId);
    if (!x) { showView("issues"); return; }
    if (x.st === "draft") { showView("edit"); return; }
    var l = C.list(data, x.list);
    $("vw-title").textContent = shownSubj(x);
    $("vw-sub").textContent = [l ? l.name : "", x.start ? t("vw.started", { t: when(x.start) }) : "",
                               x.done ? t("vw.done", { t: when(x.done) }) : ""].filter(Boolean).join(" · ");
    var chip = $("vw-chip");
    chip.className = "chip st-" + x.st;
    chip.textContent = t("st." + x.st);
    var body = $("vw-body");
    body.innerHTML = "";
    if (x.st === "sched") { renderScheduled(x, body); return; }
    var p = C.progress(data, x);
    var tiles = el("div", "tiles");
    var tile = function (lbl, v, cls) {
      var d = el("div", "tile" + (cls ? " " + cls : ""));
      d.appendChild(el("span", "tile-l", lbl));
      d.appendChild(el("span", "tile-v", String(v)));
      tiles.appendChild(d);
    };
    tile(t("vw.sent"), p.sent, "good");
    tile(t("vw.failed"), p.failed, p.failed ? "bad" : "");
    if (x.st !== "sent") tile(t("vw.left"), p.left);
    var unsubs = l ? C.subsOf(data, l.id).filter(function (s) { return s.off && s.off >= x.start && s.offSt === "off"; }).length : 0;
    tile(t("vw.unsubs"), unsubs);
    body.appendChild(tiles);
    if (x.st !== "sent" && p.total) {
      var bar = el("div", "prog");
      var fillB = el("span", "prog-fill");
      fillB.style.width = Math.round(100 * (p.sent + p.failed) / p.total) + "%";
      bar.appendChild(fillB);
      body.appendChild(bar);
    }
    if (x.err && x.st === "paused") body.appendChild(el("div", "banner", t("vw.err", { e: errStored(x.err) })));
    var now = Date.now(), dev = E.devState().dev;
    if (x.st === "sending" && !C.canSend(x, dev, now)) body.appendChild(el("div", "banner info", t("vw.other")));
    var acts = el("div", "acts");
    if (x.st === "sending") {
      if (C.canSend(x, dev, now)) acts.appendChild(btn(t("vw.pause"), "", function () { pauseIssue(x.id, ""); }));
    }
    if (x.st === "paused") {
      acts.appendChild(btn(t("vw.resume"), "primary", function () { resumeIssue(x.id); }));
      acts.appendChild(btn(t("vw.stop"), "danger", function () { finishIssue(x.id); }));
    }
    acts.appendChild(btn(t("ed.preview"), "", function () { previewDialog(x); }));
    acts.appendChild(btn(t("vw.web"), "", function () { saveWebPage(x); }));
    acts.appendChild(btn(t("ed.dup"), "", function () { duplicateIssue(x); }));
    body.appendChild(acts);
    var fails = Object.keys(x.fail || {});
    if (fails.length) {
      var det = el("details", "card");
      det.appendChild(el("summary", "", t("vw.failList") + " (" + fails.length + ")"));
      var ul = el("ul", "plain");
      fails.slice(0, 200).forEach(function (id) {
        var s = C.sub(data, id);
        ul.appendChild(el("li", "fail-row", (s ? s.email : id) + " · " + x.fail[id]));
      });
      det.appendChild(ul);
      body.appendChild(det);
    }
  }
  function renderScheduled(x, body) {
    var mine = C.schedMine(x, E.devState().dev);
    body.appendChild(el("div", "banner info", t("vw.sched", { t: when(x.when) }) + " " +
                                          (C.audience(data, x).length === 1 ? t("ed.audN1") : t("ed.audN", { n: C.audience(data, x).length }))));
    if (!mine) body.appendChild(el("div", "banner", t("vw.schedOther")));
    var acts = el("div", "acts");
    acts.appendChild(btn(t("vw.unsched"), "", function () { unschedule(x.id); }));
    if (mine) acts.appendChild(btn(t("vw.sendNow"), "primary", function () { sendScheduledNow(x.id); }));
    acts.appendChild(btn(t("ed.preview"), "", function () { previewDialog(x); }));
    acts.appendChild(btn(t("ed.dup"), "", function () { duplicateIssue(x); }));
    body.appendChild(acts);
  }
  function unschedule(id) {
    var out = E.change(function (d) {
      var c = C.issue(d, id);
      if (!c || c.st !== "sched") return false;
      var y = copy(c);
      y.st = "draft"; y.when = 0; y.lock = null;
      E.put(d, "issues", y);
    });
    if (out) showToast(t("toast.unsched"));
    changed(out);
  }
  function sendScheduledNow(id) {
    var now = Date.now();
    changed(E.change(function (d) {
      var c = C.issue(d, id);
      if (!c || c.st !== "sched") return false;
      var y = copy(c);
      y.st = "sending"; y.start = now; y.when = 0; y.lock = { dev: E.devState().dev, at: now }; y.err = ""; y.fail = {}; y.n = 0;
      E.put(d, "issues", y);
    }));
  }
  function duplicateIssue(x) {
    var y = copy(x);
    y.id = C.randomId("i", null);
    y.m = 0; y.st = "draft"; y.when = 0; y.lock = null; y.start = 0; y.done = 0; y.n = 0; y.err = ""; y.fail = {};
    put("issues", C.normIssue(y));
    viewId = y.id;
    showView("edit");
  }

  // ---------- 10. Dialogs ----------
  function makeDialog(id, title, wide) {
    var stale = document.getElementById(id);
    if (stale) stale.remove();
    var dlg = document.createElement("dialog");
    dlg.id = id;
    dlg.className = "mm-dlg" + (wide ? " wide" : "");
    dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener("close", function () { parkToast(); setTimeout(function () { dlg.remove(); }, 0); });
    dlg.appendChild(el("div", "dlg-title", title));
    return dlg;
  }
  function openDialog(dlg, focus) {
    document.body.appendChild(dlg);
    dlg.showModal();
    if (focus) try { focus.focus(); } catch (e) {}
  }
  function btn(label, cls, fn) {
    var b = el("button", "dlg-btn" + (cls ? " " + cls : ""), label);
    b.type = "button";
    if (fn) b.addEventListener("click", fn);
    return b;
  }
  function inp(type, value, max) {
    var i = el("input");
    i.type = type;
    i.value = value === undefined || value === null ? "" : String(value);
    if (max) i.maxLength = max;
    if (type === "email" || type === "url") { i.autocapitalize = "off"; i.spellcheck = false; }
    return i;
  }
  function area(value, rows) {
    var a = el("textarea");
    a.value = value || "";
    a.rows = rows || 3;
    return a;
  }
  function sel(options, value) {
    var s = el("select");
    options.forEach(function (o) {
      var op = el("option", "", o[1]);
      op.value = o[0];
      if (o[0] === value) op.selected = true;
      s.appendChild(op);
    });
    return s;
  }
  function field(label, ctl, note) {
    var w = el("label", "fld");
    w.appendChild(el("span", "dlg-lbl", label));
    w.appendChild(ctl);
    if (note) w.appendChild(el("p", "hint", note));
    return w;
  }
  function actionsRow(dlg, left, okLabel, onOk, okCls) {
    var acts = el("div", "dlg-actions");
    (left || []).forEach(function (b) { acts.appendChild(b); });
    acts.appendChild(el("span", "spacer"));
    acts.appendChild(btn(okLabel ? t("dlg.cancel") : t("dlg.close"), "", function () { dlg.close(); }));
    if (okLabel) acts.appendChild(btn(okLabel, okCls || "primary", onOk));
    dlg.appendChild(acts);
    return acts;
  }
  function confirmDialog(title, text, okLabel, onOk, danger) {
    var dlg = makeDialog("nl-confirm", title);
    dlg.appendChild(el("p", "dlg-text", text));
    actionsRow(dlg, [], okLabel, function () { dlg.close(); onOk(); }, danger ? "danger-fill" : "primary");
    openDialog(dlg, dlg.querySelector(".dlg-actions .dlg-btn:last-child"));
  }

  // A list: new (id null) or existing.
  function listDialog(id) {
    var l = id ? C.list(data, id) : null;
    if (id && !l) return;
    var chans = C.live(data.chans);
    if (!chans.length) { showToast(t("l.needChan")); chanDialog(null); return; }
    var dlg = makeDialog("nl-list", t("l.title"), true);
    var src = l || { name: "", chan: chans[0].id, from: "", fromName: "", reply: "", lang: LANG, addr: "", why: "", theme: "classic", color: "#2f6fde" };
    var f = {};
    f.name = inp("text", src.name, C.LIM.name);
    f.name.placeholder = t("l.namePh");
    dlg.appendChild(field(t("l.name"), f.name));
    f.chan = sel(chans.map(function (c) { return [c.id, chanName(c)]; }), src.chan);
    dlg.appendChild(field(t("l.chan"), f.chan));
    f.from = inp("email", src.from, 254);
    var defFrom = function () {
      var ch = C.chan(data, f.chan.value);
      var a = ch && ch.kind === "mail" ? mailAccount(ch.acct) : null;
      if (a && !f.from.value) f.from.value = a.email;
      if (a && !f.fromName.value && a.name) f.fromName.value = a.name;
    };
    dlg.appendChild(field(t("l.from"), f.from, t("l.fromHint")));
    f.fromName = inp("text", src.fromName, C.LIM.name);
    dlg.appendChild(field(t("l.fromName"), f.fromName));
    f.chan.addEventListener("change", defFrom);
    defFrom();
    f.reply = inp("email", src.reply, 254);
    dlg.appendChild(field(t("l.reply"), f.reply));
    f.lang = sel([["en", "English"], ["el", "Ελληνικά"]], src.lang);
    dlg.appendChild(field(t("l.lang"), f.lang));
    f.addr = area(src.addr, 3);
    f.addr.maxLength = C.LIM.addr;
    dlg.appendChild(field(t("l.addr"), f.addr, t("l.addrHint")));
    f.why = area(src.why, 2);
    f.why.maxLength = C.LIM.why;
    f.why.placeholder = t("l.whyDflt", { l: src.name || "…" });
    dlg.appendChild(field(t("l.why"), f.why));
    var r = el("div", "fld-row");
    f.theme = sel(C.THEMES.map(function (k) { return [k, t("th." + k)]; }), src.theme);
    r.appendChild(field(t("l.theme"), f.theme));
    f.color = inp("color", src.color);
    f.color.className = "color-in";
    r.appendChild(field(t("l.color"), f.color));
    dlg.appendChild(r);
    var left = [];
    if (l) {
      left.push(btn(t("l.delete"), "danger", function () {
        var n = C.subsOf(data, l.id).length;
        dlg.close();
        confirmDialog(t("l.delete"), t("l.delText", { l: l.name, n: n }), t("dlg.delete"), function () {
          remove("lists", l.id);
          renderAll();
        }, true);
      }));
    }
    actionsRow(dlg, left, t("dlg.save"), function () {
      var from = C.normEmail(f.from.value);
      f.from.classList.toggle("bad", !from);
      f.addr.classList.toggle("bad", !f.addr.value.trim());
      f.name.classList.toggle("bad", !f.name.value.trim());
      if (!from || !f.addr.value.trim() || !f.name.value.trim()) return;
      var rec = C.normList({
        id: l ? l.id : C.randomId("l", null), m: l ? l.m : 0, name: f.name.value, chan: f.chan.value,
        from: from, fromName: f.fromName.value, reply: f.reply.value, lang: f.lang.value, addr: f.addr.value, why: f.why.value,
        theme: f.theme.value, color: f.color.value, salt: l ? l.salt : C.randomId("", null)
      });
      put("lists", rec);
      prefs.list = rec.id;
      savePrefs();
      dlg.close();
      renderAll();
    });
    openDialog(dlg, f.name);
  }

  function linkDialog(id) {
    var l = C.list(data, id);
    if (!l) return;
    var dlg = makeDialog("nl-link", t("lk.title"), true);
    var box = l.reply || l.from;
    var link = R.mailto(box, "subscribe " + C.listCode(l));
    var html = "<a href=\"" + link + "\">" + t("lk.btn") + ": " + l.name.replace(/[<>&"]/g, "") + "</a>";
    dlg.appendChild(el("p", "dlg-text", t("lk.text")));
    [[t("lk.link"), link], [t("lk.html"), html]].forEach(function (p) {
      var ta = area(p[1], 2);
      ta.readOnly = true;
      var w = field(p[0], ta);
      var cb = mini(t("lk.copy"), function () {
        var done = function () { showToast(t("lk.copied")); };
        try { navigator.clipboard.writeText(p[1]).then(done, function () { ta.select(); }); } catch (e) { ta.select(); }
      });
      w.appendChild(cb);
      dlg.appendChild(w);
    });
    var ch = C.chan(data, l.chan);
    if (!inboxAccount(ch)) dlg.appendChild(el("p", "banner", t("inbox.no")));
    actionsRow(dlg, [], "", null);
    openDialog(dlg);
  }

  // A sending account: new (id null) or existing.
  function chanDialog(id) {
    var ch = id ? C.chan(data, id) : null;
    if (id && !ch) return;
    var dlg = makeDialog("nl-chan", t("ch.title"), true);
    var src = ch || { kind: mailAccounts().some(function (a) { return a.smtp; }) ? "mail" : "smtp", acct: "", preset: "brevo",
                      host: C.PRESETS.brevo.host, port: 587, user: "", inbox: "", rate: C.MAIL_DEFAULTS.rate, cap: C.MAIL_DEFAULTS.cap };
    var f = {};
    f.kind = sel([["mail", t("chans.mail")], ["smtp", t("chans.smtp")]], src.kind);
    dlg.appendChild(field(t("ch.kind"), f.kind));
    var accts = mailAccounts().filter(function (a) { return a.smtp; });
    var mailBox = el("div");
    if (accts.length) {
      f.acct = sel(accts.map(function (a) { return [a.id, a.email]; }), src.acct || accts[0].id);
      mailBox.appendChild(field(t("ch.acct"), f.acct));
    } else mailBox.appendChild(el("p", "banner info", t("ch.noAcct")));
    dlg.appendChild(mailBox);
    var smtpBox = el("div");
    var presets = Object.keys(C.PRESETS).filter(function (k) { return k !== "other"; }).concat(["other"]);
    f.preset = sel(presets.map(function (k) { return [k, t("p." + k)]; }), src.preset || "brevo");
    smtpBox.appendChild(field(t("ch.preset"), f.preset, t("ch.presetHint")));
    var r1 = el("div", "fld-row");
    f.host = inp("text", src.host, 253);
    f.host.autocapitalize = "off";
    f.host.spellcheck = false;
    r1.appendChild(field(t("ch.host"), f.host));
    f.port = sel([["587", "587 (STARTTLS)"], ["465", "465 (TLS)"]], String(src.port || 587));
    var pw = field(t("ch.port"), f.port);
    pw.classList.add("narrow");
    r1.appendChild(pw);
    smtpBox.appendChild(r1);
    f.user = inp("text", src.user, 320);
    f.user.autocapitalize = "off";
    f.user.spellcheck = false;
    f.user.autocomplete = "off";
    smtpBox.appendChild(field(t("ch.user"), f.user));
    f.pass = inp("password", "", 512);
    f.pass.autocomplete = "new-password";
    var passF = field(t("ch.pass"), f.pass, t("ch.passHint"));
    smtpBox.appendChild(passF);
    if (ch && ch.kind === "smtp") hasOwnPass(ch.id).then(function (ok) { if (ok) f.pass.placeholder = t("ch.passKeep"); });
    var all = mailAccounts();
    f.inbox = sel([["", t("ch.inboxNone")]].concat(all.map(function (a) { return [a.id, a.email]; })), src.inbox || "");
    smtpBox.appendChild(field(t("ch.inbox"), f.inbox, t("ch.inboxHint")));
    dlg.appendChild(smtpBox);
    var r2 = el("div", "fld-row");
    f.rate = inp("number", src.rate);
    f.rate.min = 1; f.rate.max = 600;
    r2.appendChild(field(t("ch.rate"), f.rate));
    f.cap = inp("number", src.cap);
    f.cap.min = 1; f.cap.max = 100000;
    r2.appendChild(field(t("ch.cap"), f.cap));
    dlg.appendChild(r2);
    dlg.appendChild(el("p", "hint", t("ch.capHint")));
    var sync = function () {
      mailBox.hidden = f.kind.value !== "mail";
      smtpBox.hidden = f.kind.value !== "smtp";
    };
    f.kind.addEventListener("change", function () {
      sync();
      var d = f.kind.value === "mail" ? C.MAIL_DEFAULTS : C.PRESETS[f.preset.value];
      f.rate.value = d.rate; f.cap.value = d.cap;
    });
    f.preset.addEventListener("change", function () {
      var p = C.PRESETS[f.preset.value];
      if (p.host || f.preset.value === "other") f.host.value = p.host;
      f.port.value = String(p.port);
      if (p.user) f.user.value = p.user;
      f.rate.value = p.rate; f.cap.value = p.cap;
    });
    sync();
    var collect = function () {
      var kind = f.kind.value;
      var rec = C.normChan({
        id: ch ? ch.id : C.randomId("c", null), m: ch ? ch.m : 0, kind: kind, acct: f.acct ? f.acct.value : "",
        preset: f.preset.value, host: f.host.value, port: +f.port.value, user: f.user.value, inbox: f.inbox.value,
        rate: Math.round(+f.rate.value), cap: Math.round(+f.cap.value), name: ""
      });
      if (kind === "mail" && !rec.acct) return null;
      if (kind === "smtp") {
        f.host.classList.toggle("bad", !rec.host);
        f.user.classList.toggle("bad", !rec.user);
        if (!rec.host || !rec.user) return null;
      }
      return rec;
    };
    var withPass = function (rec) {
      if (rec.kind !== "smtp" || !f.pass.value) return Promise.resolve();
      return savePass(rec.id, f.pass.value);
    };
    var left = [btn(t("ch.test"), "", function () {
      var rec = collect();
      if (!rec) return;
      withPass(rec).then(function () { return sendCreds(rec); }).then(function (cr) {
        return relay({ op: "smtpcheck", acct: cr.acct, smtp: cr.smtp });
      }).then(function () { showToast(t("ch.testOk")); }, function (e) { showToast(t("toast.chanFail", { e: errText(e) })); });
    })];
    if (ch) {
      left.push(btn(t("ch.delete"), "danger", function () {
        if (C.live(data.lists).some(function (l) { return l.chan === ch.id; })) { showToast(t("ch.inUse")); return; }
        remove("chans", ch.id);
        E.delPass(ch.id);
        dlg.close();
        renderAll();
      }));
    }
    actionsRow(dlg, left, t("dlg.save"), function () {
      var rec = collect();
      if (!rec) return;
      withPass(rec).then(function () {
        put("chans", rec);
        dlg.close();
        renderAll();
      }, function () { showToast(t("toast.save")); });
    });
    openDialog(dlg, f.kind);
  }

  // A subscriber: new (id null) or existing.
  function subDialog(id) {
    var l = curList();
    if (!l) return;
    var s = id ? C.sub(data, id) : null;
    if (id && !s) return;
    var dlg = makeDialog("nl-sub", t("s.title"), true);
    var f = {};
    f.email = inp("email", s ? s.email : "", 254);
    if (s) f.email.readOnly = true;
    dlg.appendChild(field(t("s.email"), f.email));
    f.name = inp("text", s ? s.name : "", C.LIM.name);
    dlg.appendChild(field(t("s.name"), f.name));
    f.tags = inp("text", s ? s.tags.join(", ") : "", 400);
    dlg.appendChild(field(t("s.tags"), f.tags, t("s.tagsHint")));
    f.lang = sel([["", t("s.langAny")], ["en", "English"], ["el", "Ελληνικά"]], s ? s.lang : "");
    dlg.appendChild(field(t("s.lang"), f.lang));
    if (!s) {
      f.basis = sel(C.BASES.map(function (b) { return [b, t("basis." + b)]; }), "optin");
      var bh = el("p", "hint", t("basis.optinHint"));
      f.basis.addEventListener("change", function () { bh.textContent = t("basis." + f.basis.value + "Hint"); });
      var bw = field(t("s.basis"), f.basis);
      bw.appendChild(bh);
      dlg.appendChild(bw);
    } else {
      var st = C.status(s);
      var info = el("div", "card info-card");
      info.appendChild(el("p", "", t("s.status") + ": " + t("sst." + st)));
      [["s.since", s.at], ["s.conf", s.conf], ["s.inv", s.inv], ["s.left", s.off]].forEach(function (p) {
        if (p[1]) info.appendChild(el("p", "row-sub", t(p[0], { t: when(p[1]) })));
      });
      info.appendChild(el("p", "row-sub", t("s.src", { s: t("src." + s.src) }) + " · " + t("basis." + s.basis)));
      dlg.appendChild(info);
    }
    var left = [];
    if (s) {
      var st2 = C.status(s);
      if (st2 === "on" || st2 === "pend") {
        left.push(btn(t("s.unsub"), "", function () {
          var x = copy(s); x.off = Date.now(); x.offSt = "off";
          put("subs", x); dlg.close(); renderAll();
        }));
      } else {
        var rb = btn(t("s.resub"), "", function () {
          var x = copy(s); var now = Date.now(); x.at = now; x.conf = now; x.bnc = 0;
          put("subs", x); dlg.close(); renderAll();
        });
        rb.title = t("s.resubHint");
        left.push(rb);
      }
      left.push(btn(t("s.export"), "", function () {
        saveText(JSON.stringify(C.personData(data, s.email), null, 2), "oros-newsletter-" + C.slug(s.email) + ".json",
                 "application/json", ".json", "JSON");
      }));
      left.push(btn(t("s.forget"), "danger", function () {
        dlg.close();
        confirmDialog(t("s.forget"), t("s.forgetText", { e: s.email }), t("dlg.delete"), function () {
          data.supp.push(C.suppHash(s.email));
          remove("subs", s.id);
          renderAll();
        }, true);
      }));
    }
    actionsRow(dlg, left, t("dlg.save"), function () {
      var tags = f.tags.value.split(",");
      if (s) {
        var x = copy(s);
        x.name = f.name.value; x.tags = tags; x.lang = f.lang.value;
        var nx = C.normSub(x);
        if (JSON.stringify(nx) !== JSON.stringify(C.normSub(s))) put("subs", nx);
        dlg.close();
        renderAll();
        return;
      }
      var email = C.normEmail(f.email.value);
      f.email.classList.toggle("bad", !email);
      if (!email) return;
      var plan = C.planImport(data, l.id, [{ email: email, name: f.name.value, tags: C.normSub({ email: email, list: l.id, tags: tags }).tags,
                                             lang: f.lang.value }], { basis: f.basis.value, src: "manual" });
      if (!plan.add.length) {
        showToast(plan.dup ? t("s.dup") : (plan.left ? t("s.left1") : (plan.supp ? t("s.suppressed") : t("s.full", { n: C.LIM.subs }))));
        return;
      }
      plan.add.forEach(function (x) { replaceIn(data.subs, x); });
      saveNow();
      dlg.close();
      renderAll();
      if (f.basis.value === "optin") kick();
    });
    openDialog(dlg, s ? f.name : f.email);
  }

  // Import step 2: what will happen, the basis, extra tags → add.
  function importDialog(people, bad, src, defBasis) {
    var l = curList();
    if (!l) return;
    if (!people.length) { showToast(src === "csv" ? t("toast.noCsv") : t("imp.none")); return; }
    var dlg = makeDialog("nl-import", t("imp.title"), true);
    var f = {};
    f.basis = sel(C.BASES.map(function (b) { return [b, t("basis." + b)]; }), defBasis || "optin");
    var bh = el("p", "hint", t("basis." + f.basis.value + "Hint"));
    var bw = field(t("imp.basis"), f.basis);
    bw.appendChild(bh);
    dlg.appendChild(bw);
    f.tags = inp("text", "", 400);
    dlg.appendChild(field(t("imp.tags"), f.tags, t("s.tagsHint")));
    var sum = el("p", "dlg-text");
    dlg.appendChild(sum);
    var okBtn = null;
    var plan = null;
    var update = function () {
      bh.textContent = t("basis." + f.basis.value + "Hint");
      plan = C.planImport(data, l.id, people, { basis: f.basis.value, src: src, bad: bad, tags: f.tags.value.split(",") });
      sum.textContent = t("imp.sum", { a: plan.add.length, d: plan.dup, l: plan.left, s: plan.supp, b: plan.bad, o: plan.over });
      if (okBtn) { okBtn.textContent = t("imp.do", { n: plan.add.length }); okBtn.disabled = !plan.add.length; }
    };
    f.basis.addEventListener("change", update);
    f.tags.addEventListener("input", update);
    var acts = actionsRow(dlg, [], t("imp.do", { n: 0 }), function () {
      if (!plan || !plan.add.length) return;
      plan.add.forEach(function (x) { replaceIn(data.subs, x); });
      saveNow();
      dlg.close();
      renderAll();
      showToast(plan.add.length === 1 ? t("imp.done1") : t("imp.done", { n: plan.add.length }));
      if (f.basis.value === "optin") kick();
    });
    okBtn = acts.lastChild;
    update();
    openDialog(dlg, f.basis);
  }
  function pasteDialog() {
    var dlg = makeDialog("nl-paste", t("subs.paste"), true);
    var ta = area("", 8);
    dlg.appendChild(field(t("imp.paste"), ta, t("imp.pasteHint")));
    actionsRow(dlg, [], t("imp.next"), function () {
      var r = C.peopleFromText(ta.value);
      dlg.close();
      importDialog(r.people, r.bad, "paste", "optin");
    });
    openDialog(dlg, ta);
  }
  function contactsDialog() {
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem("oros-contacts-data") || "null"); } catch (e) {}
    var labels = {};
    var gone = {};
    if (raw && Array.isArray(raw.labels)) raw.labels.forEach(function (lb) { if (lb && lb.id) labels[lb.id] = String(lb.name || ""); });
    if (raw && Array.isArray(raw.deleted)) raw.deleted.forEach(function (d) { if (d && d.id) gone[d.id] = d.mtime || 1; });
    var people = [];
    (raw && Array.isArray(raw.contacts) ? raw.contacts : []).forEach(function (c) {
      if (!c || !c.id || (gone[c.id] && gone[c.id] >= (c.mtime || 0))) return;
      var email = Array.isArray(c.emails) && c.emails[0] ? C.normEmail(c.emails[0].v) : "";
      if (!email) return;
      var name = [c.given, c.family].filter(Boolean).join(" ").trim() || String(c.nickname || c.org || "");
      people.push({ email: email, name: C.oneLine(name, C.LIM.name), c: String(c.id).slice(0, 60),
                    lt: (Array.isArray(c.labelIds) ? c.labelIds : []).map(function (id) { return labels[id]; }).filter(Boolean) });
    });
    pickPeople({ id: "nl-contacts", title: t("imp.contacts"), none: t("imp.cNone"), hint: t("imp.cHint"),
                 tags: t("imp.labelsTags"), people: people, src: "contacts", basis: "optin" });
  }
  // People with an e-mail from the CRM (customers; their status and
  // tags as tags). Read only: crm/ belongs to the CRM app.
  function crmPeople() {
    var K = null;
    try { K = window.parent && window.parent !== window ? window.parent.OrosCrmCore : null; } catch (e) {}
    if (!K || typeof K.norm !== "function") return null;
    var d = null;
    try { d = K.norm(JSON.parse(localStorage.getItem("oros-crm-data") || "null")); } catch (e) { return null; }
    if (!d || !Array.isArray(d.cust)) return null;
    var tagName = {};
    (d.tags || []).forEach(function (tg) { if (tg && tg.id) tagName[tg.id] = String(tg.name || ""); });
    var out = [];
    d.cust.forEach(function (c) {
      var email = C.normEmail(c.email);
      if (!email) return;
      var lt = [t("crm." + (c.st === "active" || c.st === "past" ? c.st : "lead"))]
        .concat((c.tags || []).map(function (id) { return tagName[id]; }).filter(Boolean));
      out.push({ email: email, name: C.oneLine(c.name, C.LIM.name), c: "", lt: lt, st: c.st });
    });
    return out.length ? out : null;
  }
  function crmDialog() {
    var people = crmPeople() || [];
    pickPeople({ id: "nl-crm", title: t("imp.crm"), none: t("imp.crmNone"), hint: t("imp.crmHint"),
                 tags: t("imp.crmTags"), people: people, src: "crm",
                 basis: function (chosen) {     // leads aren't customers: they confirm by e-mail
                   return chosen.every(function (p) { return p.st === "active" || p.st === "past"; }) ? "customer" : "optin";
                 } });
  }
  function pickPeople(o) {
    var people = o.people;
    people.sort(function (a, b) { return C.fold(a.name || a.email) < C.fold(b.name || b.email) ? -1 : 1; });
    var dlg = makeDialog(o.id, o.title, true);
    if (!people.length) {
      dlg.appendChild(el("p", "dlg-text", o.none));
      actionsRow(dlg, [], "", null);
      openDialog(dlg);
      return;
    }
    dlg.appendChild(el("p", "banner info", o.hint));
    var q = inp("search", "", 100);
    q.placeholder = t("imp.cFilter");
    dlg.appendChild(q);
    var lt = el("label", "check");
    var ltc = el("input");
    ltc.type = "checkbox";
    ltc.checked = true;
    lt.appendChild(ltc);
    lt.appendChild(el("span", "", o.tags));
    dlg.appendChild(lt);
    var all = mini(t("imp.cAll"), function () {
      [].forEach.call(listBox.querySelectorAll("input[type=checkbox]"), function (cb) { if (!cb.closest("[hidden]")) { cb.checked = true; picked[cb.value] = true; } });
    });
    dlg.appendChild(all);
    var listBox = el("div", "pick-list");
    var picked = {};
    people.forEach(function (p, i) {
      var row = el("label", "pick-row");
      var cb = el("input");
      cb.type = "checkbox";
      cb.value = String(i);
      cb.addEventListener("change", function () { picked[i] = cb.checked; });
      row.appendChild(cb);
      var tx = el("span", "pick-t");
      tx.appendChild(el("span", "", p.name || p.email));
      tx.appendChild(el("small", "", p.name ? p.email : ""));
      row.appendChild(tx);
      row.dataset.k = C.fold(p.name + " " + p.email + " " + p.lt.join(" "));
      listBox.appendChild(row);
    });
    q.addEventListener("input", function () {
      var k = C.fold(q.value.trim());
      [].forEach.call(listBox.children, function (r) { r.hidden = !!k && r.dataset.k.indexOf(k) < 0; });
    });
    dlg.appendChild(listBox);
    actionsRow(dlg, [], t("imp.next"), function () {
      var chosen = people.filter(function (p, i) { return picked[i]; }).map(function (p) {
        return { email: p.email, name: p.name, c: p.c, tags: ltc.checked ? p.lt : [], lang: "", st: p.st };
      });
      if (!chosen.length) return;
      dlg.close();
      importDialog(chosen, 0, o.src, typeof o.basis === "function" ? o.basis(chosen) : o.basis);
    });
    openDialog(dlg, q);
  }

  // ---------- 11. Preview, test, check, send ----------
  var imgData = E.images;   // path → { bin, type, url (data:) } this window
  function loadImages(x) { return E.loadImages(x, orosFS()); }
  // [lang, label] for an issue's versions (one entry without a second version)
  function versionsOf(x, l) {
    var a = mainLang(x, l);
    return x.l2 ? [[a, langName(a)], [x.l2.lang, langName(x.l2.lang)]] : [[a, langName(a)]];
  }
  function previewDialog(x) {
    if (!x) return;
    var l = C.list(data, x.list);
    if (!l) return;
    var dlg = makeDialog("nl-preview", t("pv.title"), true);
    dlg.classList.add("xwide");
    var aud = C.audience(data, x);
    var vers = versionsOf(x, l), lang = vers[0][0];
    var frame = el("iframe", "pv-frame");
    frame.setAttribute("sandbox", "");
    frame.setAttribute("referrerpolicy", "no-referrer");
    frame.title = t("pv.title");
    var top = el("div", "pv-top");
    var segBar = function (opts, cur, label, fn) {
      var seg = el("div", "seg");
      seg.setAttribute("role", "group");
      seg.setAttribute("aria-label", label);
      opts.forEach(function (o) {
        var b = el("button", "seg-btn" + (o[0] === cur ? " on" : ""), o[1]);
        b.type = "button";
        b.addEventListener("click", function () {
          [].forEach.call(seg.children, function (c) { c.classList.toggle("on", c === b); });
          fn(o[0]);
        });
        seg.appendChild(b);
      });
      top.appendChild(seg);
    };
    segBar([["phone", t("pv.phone")], ["desktop", t("pv.desktop")]], "phone", t("pv.title"), function (m) {
      frame.classList.toggle("phone", m === "phone");
    });
    if (vers.length > 1) segBar(vers, lang, t("pv.lang"), function (k) { lang = k; draw(); });
    dlg.appendChild(top);
    var who = el("p", "hint");
    dlg.appendChild(who);
    var subj = el("p", "pv-subj");
    dlg.appendChild(subj);
    frame.classList.add("phone");
    dlg.appendChild(frame);
    actionsRow(dlg, [], "", null);
    openDialog(dlg);
    function draw() {
      // a subscriber who reads this version, if there is one
      var sample = null;
      if (vers.length > 1) {
        for (var i = 0; i < aud.length && !sample; i++) if (C.langOf(aud[i], l) === lang) sample = aud[i];
      } else sample = aud[0] || null;
      who.textContent = t("pv.as", { n: sample ? (sample.name || sample.email) : t("pv.sample") });
      var tok = sample ? C.token(l, sample.id) : "nl-preview";
      var e = R.email({ issue: x, list: l, sub: sample, lang: vers.length > 1 ? lang : C.langOf(sample, l),
                        img: function (b) { return imgData[b.f] ? imgData[b.f].url : ""; },
                        unsub: R.mailto(l.reply || l.from, "unsubscribe " + tok), tok: tok, mailbox: l.reply || l.from });
      subj.textContent = e.subject;
      frame.srcdoc = "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"></head><body style=\"margin:0;background:" + (R.THEMES[l.theme] || R.THEMES.classic).bg + "\">" +
                     e.html + "</body></html>";
    }
    loadImages(x).then(draw);
  }
  function testDialog(x) {
    if (!x) return;
    var l = C.list(data, x.list);
    if (!l) return;
    var dlg = makeDialog("nl-test", t("ts.title"));
    var to = inp("email", l.from, 254);
    dlg.appendChild(field(t("ts.to"), to));
    var vers = versionsOf(x, l), ver = null;
    if (vers.length > 1) {
      ver = sel(vers, vers[0][0]);
      dlg.appendChild(field(t("ts.lang"), ver));
    }
    actionsRow(dlg, [], t("ts.title"), function () {
      var addr = C.normEmail(to.value);
      to.classList.toggle("bad", !addr);
      if (!addr) return;
      dlg.close();
      var ch = C.chan(data, l.chan);
      loadImages(x).then(function (ok) {
        if (!ok) throw { code: "noImg" };
        return sendCreds(ch);
      }).then(function (cr) {
        var sample = C.audience(data, x)[0] || null;
        var msg = E.buildFor(x, l, sample, { test: true, to: addr, hdr: cr.hdr, lang: ver ? ver.value : mainLang(x, l) });
        return E.sendBin(ch, l.from, addr, msg.bin);
      }).then(function () {
        E.countUsed(ch.id);
        showToast(t("ts.sent", { a: addr }));
      }, function (e) { showToast(t("toast.testFail", { e: errText(e) })); });
    });
    openDialog(dlg, to);
  }
  function imgBytes(x) {
    var seen = {}, n = 0;
    R.blocksOf(x).concat(x.l2 ? R.blocksOf(x.l2) : []).forEach(function (b) {
      if (b.k === "img" && b.f && !seen[b.f]) { seen[b.f] = 1; n += b.b || 0; }
    });
    return n;
  }
  // The pre-send check; with `send` it continues to the send dialog.
  function checkDialog(x, send) {
    if (!x) return;
    var l = C.list(data, x.list);
    var ch = l ? C.chan(data, l.chan) : null;
    var credsP = ch ? sendCreds(ch).then(function () { return true; }, function () { return false; }) : Promise.resolve(false);
    credsP.then(function (chanOk) {
      var aud = C.audience(data, x).length;
      var res = C.preflight(data, x, { chan: chanOk ? ch : null, inbox: !!inboxAccount(ch), imgBytes: imgBytes(x), aud: aud });
      var errs = res.filter(function (r) { return r.lvl === "err"; });
      if (send && !errs.length) { sendDialog(x, l, ch, aud, res); return; }
      var dlg = makeDialog("nl-check", t("ck.title"), true);
      if (!res.length) dlg.appendChild(el("p", "banner info", t("ck.ok")));
      [["err", t("ck.err")], ["warn", t("ck.warn")]].forEach(function (g) {
        var items = res.filter(function (r) { return r.lvl === g[0]; });
        if (!items.length) return;
        dlg.appendChild(el("p", "dlg-h", g[1]));
        var ul = el("ul", "ck-list " + g[0]);
        var seen = {};
        items.forEach(function (r) { if (!seen[r.k]) { seen[r.k] = 1; ul.appendChild(el("li", "", t("ck." + r.k))); } });
        dlg.appendChild(ul);
      });
      actionsRow(dlg, [], "", null);
      openDialog(dlg);
    });
  }
  // <input type=datetime-local> works in local time "YYYY-MM-DDTHH:MM"
  function localInput(ms) {
    var d = new Date(ms), z = function (n) { return ("0" + n).slice(-2); };
    return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate()) + "T" + z(d.getHours()) + ":" + z(d.getMinutes());
  }
  function fromLocalInput(v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(v || ""));
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime() : 0;
  }
  function nextMorning() {
    var d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d.getTime();
  }
  function sendDialog(x, l, ch, aud, res) {
    var dlg = makeDialog("nl-send", t("sd.title"), true);
    var warns = res.filter(function (r) { return r.lvl === "warn"; });
    if (warns.length) {
      var ul = el("ul", "ck-list warn");
      warns.forEach(function (r) { ul.appendChild(el("li", "", t("ck." + r.k))); });
      dlg.appendChild(ul);
    }
    dlg.appendChild(el("p", "dlg-text", t("sd.text", { n: aud, f: l.from, c: chanName(ch) })));
    var mins = Math.max(1, Math.ceil(aud * ch.rate / 60));
    var days = Math.ceil(aud / ch.cap);
    dlg.appendChild(el("p", "dlg-text", days > 1 ? t("sd.time", { s: ch.rate, m: mins, cap: ch.cap, d: days }) : t("sd.time1", { s: ch.rate, m: mins })));
    // now, or at a time (this device starts it then)
    var later = false;
    var mode = el("div", "seg");
    mode.setAttribute("role", "group");
    mode.setAttribute("aria-label", t("sd.when"));
    var whenIn = inp("datetime-local", localInput(nextMorning()), 0);
    whenIn.min = localInput(Date.now());
    var whenF = field(t("sd.when"), whenIn, t("sd.whenHint"));
    whenF.hidden = true;
    var keep = el("p", "banner info", t("sd.keep"));
    [[false, t("sd.now")], [true, t("sd.later")]].forEach(function (o) {
      var b = el("button", "seg-btn" + (o[0] === later ? " on" : ""), o[1]);
      b.type = "button";
      b.addEventListener("click", function () {
        later = o[0];
        [].forEach.call(mode.children, function (c) { c.classList.toggle("on", c === b); });
        whenF.hidden = !later;
        keep.hidden = later;
        go.textContent = later ? t("sd.schedule") : t("sd.go");
      });
      mode.appendChild(b);
    });
    dlg.appendChild(mode);
    dlg.appendChild(whenF);
    dlg.appendChild(keep);
    var typed = inp("text", "", 10);
    typed.inputMode = "numeric";
    dlg.appendChild(field(t("sd.type", { n: aud }), typed));
    var acts = actionsRow(dlg, [], t("sd.go"), function () {
      if (typed.value.trim() !== String(aud)) { typed.classList.add("bad"); return; }
      var now = Date.now(), at = later ? fromLocalInput(whenIn.value) : 0;
      if (later && !(at > now + 30000 && at < now + 366 * 864e5)) { whenIn.classList.add("bad"); showToast(t("sd.whenBad")); return; }
      var y = copy(C.issue(data, x.id));
      if (!y || y.st !== "draft") { dlg.close(); return; }
      y.lock = { dev: E.devState().dev, at: now }; y.err = ""; y.fail = {}; y.n = 0;
      if (later) { y.st = "sched"; y.when = at; }
      else { y.st = "sending"; y.start = now; }
      put("issues", y);
      dlg.close();
      viewId = y.id;
      showView("view");
      if (later) showToast(t("toast.sched", { t: when(at) }));
      kick();
    });
    var go = acts.lastChild;
    go.disabled = true;
    typed.addEventListener("input", function () { go.disabled = typed.value.trim() !== String(aud); typed.classList.remove("bad"); });
    openDialog(dlg, typed);
  }
  // Issue state changes go through engine.js (re-read, change, merge-write).
  function changed(out) {
    if (out) { data = out; dirty(); }
    renderAll();
    kick();
  }
  function pauseIssue(id) { changed(E.pause(id, "")); }
  function resumeIssue(id) { changed(E.resume(id, E.devState().dev)); }
  function finishIssue(id) { changed(E.finish(id) ? E.read() : null); }

  // ---------- 12. Sending ----------
  // engine.js does the sending. Inside orOS the shell runs it
  // (newsletter/runner.js), so an issue goes on, a scheduled issue
  // starts and the Inbox is read with this window closed; this window
  // only shows the state and kicks it after a change. Opened on its
  // own (no runner), the window runs its own engine as in phase 1.
  var runner = null, engine = null;
  function findRunner() {
    try {
      var r = window.parent && window.parent !== window ? window.parent.orosNewsletterRunner : null;
      if (r && r.v >= 1 && typeof r.kick === "function") runner = r;
    } catch (e) {}
  }
  function kick() { if (runner) runner.kick(); else if (engine) engine.kick(); }
  function sendState() {
    try { return (runner ? runner.state() : engine ? engine.state() : null) || { k: "" }; } catch (e) { return { k: "" }; }
  }
  function inboxNow() {
    var p = runner ? runner.checkInbox() : engine ? engine.checkInbox() : null;
    if (!p) return;
    p.then(function (tally) {
      reloadQuiet();
      if (tally.err && tally.err.code === "wait-sync") showToast(t("inbox.wait"));
      else if (tally.err) showToast(t("inbox.fail", { e: errText(tally.err) }));
      else showToast(tally.u + tally.s + tally.c + tally.b ? t("inbox.result", tally) : t("inbox.nothing"));
      renderAll();
    });
  }
  var wakeLock = null;
  function holdAwake(on) {
    try {
      if (on && !wakeLock && navigator.wakeLock && document.visibilityState === "visible") {
        navigator.wakeLock.request("screen").then(function (w) {
          wakeLock = w;
          w.addEventListener("release", function () { wakeLock = null; });
        }, function () {});
      } else if (!on && wakeLock) { wakeLock.release(); wakeLock = null; }
    } catch (e) {}
  }
  function sendingHere() { var k = sendState().k; return !runner && (k === "issue" || k === "inv"); }
  function startSending() {
    if (runner) {
      var off = runner.on(function (kind) { if (kind === "data") reloadQuiet(); else refreshQuiet(); });
      window.addEventListener("pagehide", function () { if (off) off(); off = null; });
      kick();
      return;
    }
    engine = E.create({
      fs: orosFS,
      dirty: dirty,
      onState: function () { holdAwake(sendingHere()); refreshQuiet(); },
      onChange: reloadQuiet,
      notify: function (kind, info) {
        if (kind === "done") showToast(t("toast.sentAll", { s: shownSubj(info.issue), n: info.issue.n }));
        else if (kind === "paused") showToast(t("vw.err", { e: errStored(info.err) }));
        else if (kind === "invfail") showToast(errStored(info.err));
      }
    });
  }
  // Light refresh while sending: the bar always, the visible list/viewer.
  function refreshQuiet() {
    renderBar();
    if (document.querySelector("dialog[open]")) return;
    if (view === "view") renderViewer();
    else if (view === "issues") renderIssues();
  }
  function renderBar() {
    var s = sendState(), bar = $("sendbar"), b = $("sendbar-btn");
    var txt = "", label = "", fn = null;
    if (s.k === "issue") {
      txt = t("bar.sending", { s: shownSubj(s.issue), a: s.prog.sent + 1, b: s.prog.total });
      label = t("bar.pause"); fn = function () { pauseIssue(s.issue.id); };
    } else if (s.k === "inv") txt = t("bar.inv", { n: s.left });
    else if (s.k === "cap") { txt = t("bar.cap", { c: s.chan.cap }); }
    else if (s.k === "offline") txt = t("bar.offline");
    else if (s.k === "wait") txt = t("bar.wait");
    else if (s.k === "paused") { txt = t("bar.paused", { s: shownSubj(s.issue) }); label = t("bar.open"); fn = function () { viewId = s.issue.id; showView("view"); }; }
    else if (s.k === "other") { txt = t("bar.other", { s: shownSubj(s.issue) }); }
    else if (s.k === "here") txt = t("bar.here");
    bar.hidden = !txt;
    $("sendbar-text").textContent = txt;
    b.hidden = !fn;
    b.textContent = label;
    b.onclick = fn;
  }

  // ---------- 14. Pictures ----------
  function orosFS() {
    try { return window.parent && window.parent !== window ? window.parent.orosFS || null : null; } catch (e) { return null; }
  }
  function dialogHost() {
    if (window.orosDialog) return window.orosDialog;
    try { return window.parent.orosDialog || null; } catch (e) { return null; }
  }
  // A picture → at most 1200 px wide JPEG (PNG kept when small and
  // transparent-looking is not worth the bytes), on the orOS disk.
  function pickImage(x, i) {
    var fs = orosFS(), onL2 = side(x) !== x;
    if (!fs) { showToast(t("toast.noDisk")); return; }
    var host = dialogHost(), acc = "image/png,image/jpeg,image/webp,image/gif";
    var pick = host && typeof host.openFile === "function" ? host.openFile(acc) : localPickFile(acc);
    pick.then(function (file) {
      if (!file) return;
      return shrink(file).then(function (r) {
        var path = "/internal/Newsletter/img-" + C.randomId("", null) + ".jpg";
        return fs.write(path, r.blob).then(function () {
          var cur = C.issue(data, x.id), cb = cur && (onL2 ? cur.l2 : cur), xb = onL2 ? x.l2 : x;
          if (!cb || !xb || !cb.blocks[i] || cb.blocks[i].k !== "img" || !xb.blocks[i]) return;
          xb.blocks[i].f = path; xb.blocks[i].w = r.w; xb.blocks[i].h = r.h; xb.blocks[i].b = r.blob.size;
          put("issues", x);
          if (view === "edit") renderBlocks(x, $("blocks"));
        });
      });
    })["catch"](function () { showToast(t("toast.imgBad")); });
  }
  function shrink(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h) { URL.revokeObjectURL(url); reject(); return; }
        var k = Math.min(1, 1200 / w);
        var cw = Math.max(1, Math.round(w * k)), chh = Math.max(1, Math.round(h * k));
        var cv = document.createElement("canvas");
        cv.width = cw; cv.height = chh;
        var ctx = cv.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, cw, chh);
        ctx.drawImage(img, 0, 0, cw, chh);
        URL.revokeObjectURL(url);
        cv.toBlob(function (blob) {
          if (!blob) { reject(); return; }
          resolve({ blob: blob, w: Math.min(600, cw), h: Math.round(Math.min(600, cw) * chh / cw) });
        }, "image/jpeg", 0.82);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(); };
      img.src = url;
    });
  }
  function localPickFile(accept) {
    return new Promise(function (resolve) {
      var i = document.createElement("input");
      i.type = "file";
      if (accept) i.accept = accept;
      i.style.display = "none";
      i.addEventListener("change", function () { var f = i.files && i.files[0] ? i.files[0] : null; i.remove(); resolve(f); });
      i.addEventListener("cancel", function () { i.remove(); resolve(null); });
      document.body.appendChild(i);
      i.click();
    });
  }

  // ---------- 15. Files: CSV, backup, web page; domain check ----------
  function saveBlob(blob, name, mime, ext, desc) {
    var host = dialogHost();
    var types = [{ description: desc }];
    types[0].accept = {};
    types[0].accept[mime] = [ext];
    if (host && typeof host.saveFile === "function") {
      host.saveFile({ blob: blob, filename: name, mime: mime, types: types })
        .then(function (r) { if (r && r.ok) showToast(t("toast.exported")); });
      return;
    }
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 40000);
  }
  function saveText(text, name, mime, ext, desc) { saveBlob(new Blob([text], { type: mime }), name, mime, ext, desc); }
  function exportCsv() {
    var l = curList();
    if (!l) return;
    var heads = [t("s.email"), t("s.name"), t("s.lang"), t("s.tags"), t("s.status"), "source", t("s.basis"),
                 t("s.since", { t: "" }).trim(), t("s.conf", { t: "" }).trim(), t("s.left", { t: "" }).trim()];
    saveText(C.subsCsv(data, l.id, heads, function (s) { return t("sst." + s); }, function (b) { return t("basis." + b); }),
             "oros-newsletter-" + C.slug(l.name) + ".csv", "text/csv", ".csv", "CSV");
  }
  function importCsv() {
    var host = dialogHost(), acc = ".csv,text/csv,text/plain";
    var pick = host && typeof host.openFile === "function" ? host.openFile(acc) : localPickFile(acc);
    pick.then(function (file) {
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) { showToast(t("toast.noCsv")); return; }
      return file.text().then(function (text) {
        var r = C.peopleFromRows(C.parseCsv(text));
        importDialog(r.people, r.bad, "csv", "consent");
      });
    })["catch"](function () { showToast(t("toast.noCsv")); });
  }
  function saveWebPage(x) {
    var l = C.list(data, x.list);
    if (!l) return;
    loadImages(x).then(function () {
      var html = R.webPage({ issue: x, list: l, lang: l.lang, img: function (b) { return imgData[b.f] ? imgData[b.f].url : ""; } });
      saveText(html, C.slug(R.personalize(x.subj, null) || "issue") + ".html", "text/html", ".html", "HTML");
    });
  }
  function exportBackup() {
    saveText(C.toBackup(data), "oros-newsletter-backup-" + dayKey() + ".json", "application/json", ".json", "JSON");
  }
  function restoreBackup() {
    var host = dialogHost(), acc = ".json,application/json";
    var pick = host && typeof host.openFile === "function" ? host.openFile(acc) : localPickFile(acc);
    pick.then(function (file) {
      if (!file) return;
      return file.text().then(function (text) {
        var incoming = C.fromBackup(text);
        if (!incoming) { showToast(t("toast.badFile")); return; }
        data = C.mergeNewsletter(data, incoming);
        saveNow();
        renderAll();
        showToast(t("toast.restored"));
      });
    })["catch"](function () { showToast(t("toast.badFile")); });
  }

  var PUBLIC_MAIL = /^(gmail\.com|googlemail\.com|outlook\.com|hotmail\.com|live\.com|yahoo\.[a-z.]+|icloud\.com|me\.com|gmx\.[a-z]+|zoho\.com|proton\.me|protonmail\.com)$/i;
  var DKIM_SELECTORS = ["default", "mail", "dkim", "google", "selector1", "selector2", "k1", "k2", "s1", "s2", "smtp", "mx",
                        "mta", "sib", "mailjet", "pm", "mandrill", "smtpapi", "krs", "everlytickey1"];
  function dnsTxt(name) {
    return fetch("https://cloudflare-dns.com/dns-query?name=" + encodeURIComponent(name) + "&type=TXT", {
      headers: { accept: "application/dns-json" }, credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer"
    }).then(function (r) { return r.json(); }).then(function (j) {
      return (j && Array.isArray(j.Answer) ? j.Answer : []).filter(function (a) { return a.type === 16; })
        .map(function (a) { return String(a.data || "").replace(/"\s*"/g, "").replace(/^"|"$/g, ""); });
    });
  }
  function domainDialog(from) {
    var dom = String(from).split("@")[1] || "";
    var dlg = makeDialog("nl-domain", t("dom.title", { d: dom }), true);
    dlg.appendChild(el("p", "hint", t("dom.hint")));
    var out = el("div", "dom-res");
    dlg.appendChild(out);
    actionsRow(dlg, [], "", null);
    openDialog(dlg);
    if (PUBLIC_MAIL.test(dom)) { out.appendChild(el("p", "dlg-text", t("dom.public", { d: dom }))); return; }
    if (!navigator.onLine) { out.appendChild(el("p", "dlg-text", t("dom.fail"))); return; }
    out.appendChild(el("p", "hint", t("dom.wait")));
    var line = function (lbl, ok, text) {
      var r = el("div", "dom-row " + (ok ? "ok" : "no"));
      r.appendChild(el("span", "dom-k", (ok ? "✓ " : "✗ ") + lbl));
      r.appendChild(el("span", "dom-v", text));
      return r;
    };
    Promise.all([
      dnsTxt(dom).then(function (a) { return a.filter(function (v) { return /^v=spf1/i.test(v); })[0] || ""; }),
      dnsTxt("_dmarc." + dom).then(function (a) { return a.filter(function (v) { return /^v=DMARC1/i.test(v); })[0] || ""; }),
      Promise.all(DKIM_SELECTORS.map(function (s) {
        return dnsTxt(s + "._domainkey." + dom).then(function (a) { return a.some(function (v) { return /p=/.test(v); }) ? s : ""; }, function () { return ""; });
      })).then(function (r) { return r.filter(Boolean)[0] || ""; })
    ]).then(function (r) {
      out.innerHTML = "";
      out.appendChild(line(t("dom.spf"), !!r[0], r[0] ? t("dom.spfOk", { v: r[0].slice(0, 200) }) : t("dom.spfNo")));
      out.appendChild(line(t("dom.dkim"), !!r[2], r[2] ? t("dom.dkimOk", { s: r[2] }) : t("dom.dkimNo")));
      out.appendChild(line(t("dom.dmarc"), !!r[1], r[1] ? t("dom.dmarcOk", { v: r[1].slice(0, 200) }) : t("dom.dmarcNo")));
    }, function () {
      out.innerHTML = "";
      out.appendChild(el("p", "dlg-text", t("dom.fail")));
    });
  }

  // ---------- 16. Settings ----------
  function renderSettings() {
    var b = $("set-body");
    b.innerHTML = "";
    var c1 = el("div", "card");
    c1.appendChild(el("h3", "sec-h", t("set.data")));
    var a1 = el("div", "acts");
    a1.appendChild(btn(t("set.backup"), "", exportBackup));
    a1.appendChild(btn(t("set.restore"), "", restoreBackup));
    c1.appendChild(a1);
    var today = 0, k = dayKey(), used = E.devState().used;
    Object.keys(used).forEach(function (id) { if (used[id] && used[id].d === k) today += used[id].n; });
    c1.appendChild(el("p", "hint", t("set.dev", { n: today })));
    b.appendChild(c1);
    var c2 = el("div", "card");
    c2.appendChild(el("h3", "sec-h", t("set.about")));
    c2.appendChild(el("p", "dlg-text", t("set.aboutText")));
    b.appendChild(c2);
  }

  // ---------- 17. Toasts, keyboard, sync slice, palette ----------
  function showToast(text) {
    try {
      var n = (window.parent && window.parent !== window && window.parent.orosNotifs) || null;
      if (n && typeof n.transient === "function" && n.transient({ ns: "newsletter", title: String(text) })) return;
    } catch (e) {}
    localToast(text, null);
  }
  function undoToast(text, onUndo) { localToast(text, onUndo); }
  var toastTimer = null, undoFn = null;
  function localToast(text, onUndo) {
    var box = $("toast");
    if (!box) return;
    hostToast();
    box.innerHTML = "";
    box.classList.remove("show");
    box.appendChild(el("span", "", text));
    undoFn = onUndo || null;
    if (onUndo) {
      var b = el("button", "", t("toast.undo"));
      b.type = "button";
      b.addEventListener("click", runUndo);
      box.appendChild(b);
    }
    void box.offsetWidth;
    box.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.classList.remove("show"); undoFn = null; }, onUndo ? 8000 : 4000);
  }
  function runUndo() {
    var fn = undoFn;
    undoFn = null;
    $("toast").classList.remove("show");
    clearTimeout(toastTimer);
    if (fn) fn();
  }
  function hostToast() {
    var box = $("toast"), d = document.querySelector("dialog[open]");
    if (box && d && box.parentNode !== d) d.appendChild(box);
  }
  function parkToast() {
    var box = $("toast");
    if (box && box.parentNode !== document.body) document.body.appendChild(box);
  }
  function wireKeyboard() {
    // Contract Β: forward Ctrl+Alt+Shift shortcuts to the shell (capture)
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
      var p = null;
      try { p = window.parent; } catch (err) { return; }
      if (!(p && p !== window && p.orosShortcuts && typeof p.orosShortcuts.handle === "function")) return;
      if (p.orosShortcuts.handle(e)) e.stopPropagation();
    }, true);
    document.addEventListener("keydown", function (e) {
      var tg = e.target, tag = tg && tg.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (document.querySelector("dialog[open]")) return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === "z" || e.key === "Z")) {
        if (undoFn) { e.preventDefault(); runUndo(); }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (e.key === "Escape" && (view === "edit" || view === "view")) { e.preventDefault(); flushIssue(); showView("issues"); return; }
      if (e.key === "Escape" && view === "set") { e.preventDefault(); showView(prefs.tab); return; }
      if (view === "edit") return;
      if (e.code === "KeyN") { e.preventDefault(); newThing(); }
      else if (e.key === "/" && view === "subs") { e.preventDefault(); $("sq").focus(); }
    });
  }
  var PAL_VARS = ["--bg", "--bg-desktop", "--bar-bg", "--text", "--text-dim", "--accent", "--accent-hover", "--accent-soft",
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
    var api = syncApi();
    window.__orosSyncApi = {
      _suppress: false,
      dirty: function () {
        if (this._suppress) return;
        if (api && typeof api.markDirty === "function") api.markDirty();
      }
    };
    if (runner) return;          // orOS owns the slice (newsletter/runner.js)
    if (!api || typeof api.registerSlice !== "function") return;
    api.registerSlice("newsletter", sliceGet, sliceSet, STORAGE_KEY, C.mergeNewsletter);
  }
  function sliceGet() { return C.normalize(data); }   // canonical copy (R26)
  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.subs)) return;
    var before = JSON.stringify(data);
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = C.mergeNewsletter(data, incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    if (JSON.stringify(data) === before) return;
    kick();
    if (document.querySelector("dialog[open]") || view === "edit") return;
    renderAll();
  }

  // ---------- 18. Wiring, boot, deep links ----------
  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) { n.textContent = t(n.getAttribute("data-i18n")); });
    document.title = t("app") + " · orOS";
    var icons = { issues: UI.mail, subs: UI.users, lists: UI.list };
    TABS.forEach(function (k) {
      var b = $("tab-" + k);
      b.innerHTML = icons[k] + "<span></span>";
      b.lastChild.textContent = t("tab." + k);
      b.title = t("tab." + k);
    });
    $("set-btn").innerHTML = UI.gear;
    $("set-btn").title = t("settings");
    $("set-btn").setAttribute("aria-label", t("settings"));
    $("new-btn").innerHTML = UI.plus + "<span></span>";
    $("new-btn").lastChild.textContent = t("new");
    $("new-btn").title = t("new");
    ["ed-back", "vw-back", "set-back"].forEach(function (id) {
      $(id).innerHTML = UI.left;
      $(id).title = t("back");
      $(id).setAttribute("aria-label", t("back"));
    });
    $("sq").placeholder = t("subs.search");
    $("sq").setAttribute("aria-label", t("subs.search"));
    $("f-st").setAttribute("aria-label", t("subs.allSt"));
    $("f-tag").setAttribute("aria-label", t("subs.allTags"));
    $("list-pick-i").setAttribute("aria-label", t("lists.h"));
    $("list-pick-s").setAttribute("aria-label", t("lists.h"));
  }
  function showView(v) {
    if (view === "edit" && v !== "edit") flushIssue();
    view = v;
    if (TABS.indexOf(v) >= 0) { prefs.tab = v; savePrefs(); }
    ["issues", "subs", "lists", "edit", "view", "set"].forEach(function (k) { $("v-" + k).hidden = k !== v; });
    TABS.forEach(function (k) {
      var on = k === v || (k === "issues" && (v === "edit" || v === "view"));
      $("tab-" + k).classList.toggle("on", on);
      $("tab-" + k).setAttribute("aria-selected", on ? "true" : "false");
    });
    $("new-btn").hidden = v === "edit" || v === "set";
    renderCurrent();
    $("main").scrollTop = 0;
  }
  function renderCurrent() {
    if (view === "issues") renderIssues();
    else if (view === "subs") renderSubs();
    else if (view === "lists") renderLists();
    else if (view === "edit") renderEditor();
    else if (view === "view") renderViewer();
    else if (view === "set") renderSettings();
    renderBar();
  }
  function renderAll() { if (view !== "edit") renderCurrent(); else renderBar(); }
  function newThing() {
    if (view === "subs") { subDialog(null); return; }
    if (view === "lists") { listDialog(null); return; }
    if (!C.live(data.lists).length) { listDialog(null); return; }
    newIssue();
  }
  function wire() {
    TABS.forEach(function (k) { $("tab-" + k).addEventListener("click", function () { showView(k); }); });
    $("set-btn").addEventListener("click", function () { showView("set"); });
    $("new-btn").addEventListener("click", newThing);
    $("ed-back").addEventListener("click", function () { flushIssue(); showView("issues"); });
    $("vw-back").addEventListener("click", function () { showView("issues"); });
    $("set-back").addEventListener("click", function () { showView(prefs.tab); });
    $("setup-go").addEventListener("click", function () { if (C.live(data.chans).length) listDialog(null); else chanDialog(null); });
    $("add-list").addEventListener("click", function () { listDialog(null); });
    $("add-chan").addEventListener("click", function () { chanDialog(null); });
    ["list-pick-i", "list-pick-s"].forEach(function (id) {
      $(id).addEventListener("change", function () { prefs.list = $(id).value; prefs.f.tag = ""; savePrefs(); renderCurrent(); });
    });
    $("sq").addEventListener("input", renderSubs);
    $("f-st").addEventListener("change", function () { prefs.f.st = $("f-st").value; savePrefs(); renderSubs(); });
    $("f-tag").addEventListener("change", function () { prefs.f.tag = $("f-tag").value; savePrefs(); renderSubs(); });
    $("ed-form").addEventListener("submit", function (e) { e.preventDefault(); });
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) { flushIssue(); holdAwake(false); return; }
      if (sendingHere()) holdAwake(true);
      if (!document.querySelector("dialog[open]") && view !== "edit") renderAll();
    });
    window.addEventListener("pagehide", flushIssue);
    window.addEventListener("online", function () { kick(); });
    window.addEventListener("storage", function (e) { if (e.key === STORAGE_KEY) reloadQuiet(); });
    wireKeyboard();
  }

  function boot() {
    findRunner();
    load();
    loadPrefs();
    applyI18n();
    wire();
    registerSync();
    inheritPalette();
    watchPalette();
    showView(prefs.tab);
    startSending();               // the engine reads the Inbox when it is due
  }

  boot();

  // Deep links (shell __orosOpenAt / __orosTakeTarget):
  //   { issue: id }   open that issue (universal search)
  //   { list: id }    show that list's issues
  function openTarget(tg) {
    if (!tg || typeof tg !== "object" || document.querySelector("dialog[open]")) return;
    if (typeof tg.issue === "string" && C.issue(data, tg.issue)) {
      var x = C.issue(data, tg.issue);
      prefs.list = x.list;
      savePrefs();
      openIssue(x.id);
      return;
    }
    if (typeof tg.list === "string" && C.list(data, tg.list)) {
      prefs.list = tg.list;
      savePrefs();
      showView("issues");
    }
  }
  window.__orosOpenAt = openTarget;
  try {
    if (window.parent && window.parent !== window && typeof window.parent.__orosTakeTarget === "function") {
      var pendingTarget = window.parent.__orosTakeTarget("newsletter");
      if (pendingTarget) openTarget(pendingTarget);
    }
  } catch (e) {}
})();
