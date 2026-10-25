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
  // orosI18n (../i18n.js): the full language code, a pack language included.
  var LANG = window.orosI18n ? window.orosI18n.lang() : appLang();
  function loc() { return window.orosI18n ? window.orosI18n.locale(LANG) : (LANG === "el" ? "el-GR" : "en-GB"); }
  // "el" or "en": for the list / subscriber language (e-mails exist in
  // these two) and for shared modules that pick between them.
  var LANG2 = LANG === "el" ? "el" : "en";

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
      "as.title": "Add to an issue", "as.text": "{n} blocks from the Assistant. Pick the draft they go into, or start a new one.",
      "as.text1": "One block from the Assistant. Pick the draft it goes into, or start a new one.",
      "as.drafts": "Drafts", "as.newDraft": "Or a new draft", "as.list": "List", "as.create": "New draft",
      "as.noList": "Make a list first: an issue belongs to a list.", "as.newList": "New list",
      "as.added": "{n} blocks added", "as.added1": "1 block added", "as.cut": "({n} more did not fit: an issue holds 60 blocks.)",
      "as.none": "Nothing to add: the blocks were empty.",
      "as.pic1": "One picture could not be copied from its site: pick it in its block.", "as.pics": "{n} pictures could not be copied from their sites: pick them in their blocks.",
      "tpl.new": "New issue", "tpl.blank": "Blank issue", "tpl.from": "Or start from a template", "tpl.delete": "Delete template",
      "sd.now": "Now", "sd.later": "Later", "sd.when": "Send on", "sd.schedule": "Schedule", "sd.whenBad": "Pick a time in the future",
      "sd.whenHint": "orOS sends it from this device: if orOS isn't open then, it starts the next time you open it here.",
      "vw.sched": "Goes out {t}.", "vw.schedOther": "Scheduled on another device: it goes out from there.",
      "vw.unsched": "Cancel the schedule", "vw.sendNow": "Send now", "toast.sched": "Scheduled for {t}", "toast.unsched": "Back to drafts",
      "subs.crm": "From CRM", "imp.crm": "From CRM", "imp.crmNone": "No CRM customers with an e-mail address.",
      "imp.crmHint": "Pick the customers who should get the newsletter. If you pick only customers (now or past) they count as \"Existing customer\"; with leads among them, everyone confirms by e-mail.",
      "imp.crmTags": "Their CRM status and tags become tags", "crm.lead": "lead", "crm.active": "customer", "crm.past": "past customer",
      "src.crm": "CRM", "src.platform": "Email platform", "pv.lang": "Language", "ts.lang": "Version",
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
      "subs.enrich": "Fill in names online", "en.none": "Every subscriber shown already has a name.",
      "en.done": "Names added: {n}",
      "subs.export": "Export CSV", "subs.inbox": "Check Inbox", "subs.invite": "Send confirmation requests ({n})",
      "subs.clean": "Clean up…", "cl.title": "Clean up the list",
      "cl.text": "Keeps the list from growing with people who will never read it. Newsletter doesn't track opens, so it deletes only people who never confirmed or who already left, and asks those with no sign of life for a long time whether they want to stay.",
      "cl.pend": "Delete people who did not confirm", "cl.pendN": "{n} days after the request",
      "cl.gone": "Delete people who left (unsubscribed, bounced, spam)", "cl.goneN": "{n} days after they left",
      "cl.goneHint": "A fingerprint of the address stays, so an import can't add them again. If they sign up again themselves, they are welcome.",
      "cl.idle": "Ask “Do you still want it?” after", "cl.idleN": "{n} months without a sign of life",
      "cl.idleHint": "A sign of life is signing up or confirming; Newsletter counts no opens. Whoever doesn't answer within 30 days is unsubscribed. At most 20 a day (or 5% of the list), oldest first.",
      "cl.idleNow": "{n} would be asked whether they want to stay.", "bar.ask": "Sending “Do you still want it?”: {n} left",
      "cl.never": "Never", "cl.devHere": "Runs once a day on this device while orOS is open.",
      "cl.devOther": "Runs once a day on another of your devices.", "cl.devNone": "Starts on the device that sends this list.",
      "cl.here": "Run it on this device", "cl.now": "Now: {p} unconfirmed and {g} who left would be deleted.", "cl.nobody": "Nobody to delete now.",
      "cl.wait": "That is more than Newsletter deletes on its own in one day ({max}, or a fifth of the list), so it waits for you.",
      "cl.csv": "Export them (CSV)", "cl.go": "Clean up now", "cl.goText": "Delete {n} people from “{l}” for good? This can't be undone.",
      "cl.done": "Deleted: {n}",
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
      "bk.noImgBtn": "Remove picture", "bk.imgtxt": "Picture + text", "bk.cols3": "3 columns", "bk.gallery": "Gallery", "bk.video": "Video", "bk.table": "Table", "bk.event": "Event", "bk.more": "More blocks", "bk.moreTitle": "Add a block", "bk.saved": "Saved blocks", "bk.savedNone": "No saved blocks yet. Open a block's settings (the gear) and choose Save block.", "bk.save": "Save block", "bk.saveName": "Name", "bk.savedDone": "Block saved: find it under More blocks", "bk.savedFull": "You have 100 saved blocks: delete one first", "bk.savedDel": "Delete saved block", "bk.side": "Picture", "bk.sideL": "On the left", "bk.sideR": "On the right", "bk.hd": "Title", "bk.colN": "Column {n}", "bk.per": "Per row", "bk.galAdd": "Picture", "bk.galRemove": "Remove this picture", "bk.galEmpty": "No pictures yet", "bk.videoUrl": "Video link (YouTube, Vimeo, PeerTube…)", "bk.videoCap": "Caption (optional)", "bk.videoHint": "Choose a picture from the video: a play mark is drawn on it and it opens the link. orOS fetches nothing from the video site. Without a picture a button opens the link.", "bk.tblHead": "First row is a header", "bk.tblRow": "Row", "bk.tblCol": "Column", "bk.tblRowDel": "Remove the last row", "bk.tblColDel": "Remove the last column", "bk.cell": "Row {r}, column {c}", "bk.evT": "Event name", "bk.evD": "Day", "bk.evTm": "Starts (optional)", "bk.evTe": "Ends (optional)", "bk.evLoc": "Place (optional)", "bk.evSub": "Details (optional)", "bk.evIcs": "Attach a calendar file (.ics)", "bk.evBtn": "Button (optional)", "tpl.layouts": "Or start from a ready layout", "lay.weekly": "Weekly news", "lay.announce": "Announcement", "lay.offer": "Product offer", "lay.w.title": "This week", "lay.w.intro": "Hello! Here is what happened this week.", "lay.w.s1": "The main story", "lay.w.s1t": "A few lines about it. Add a picture on the side.", "lay.w.s2": "Also new", "lay.w.s2t": "Another story, with its picture on the right.", "lay.w.links": "Worth reading", "lay.w.list": "First link\nSecond link\nThird link", "lay.w.more": "Read more", "lay.a.title": "Big news", "lay.a.intro": "Hello! We have something to tell you.", "lay.a.body": "Say what is new, why it matters and what to do next.", "lay.a.btn": "Find out more", "lay.a.quote": "A sentence from someone who tried it.", "lay.a.by": "Their name", "lay.o.title": "This week's offer", "lay.o.intro": "Hand-picked for you, while stocks last.", "lay.o.p1": "First product", "lay.o.p1t": "What makes it special. Was €40, now **€29**", "lay.o.p2": "Second product", "lay.o.p2t": "One or two lines about it. **€19**", "lay.o.buy": "Buy now", "lay.o.all": "See every offer",
      "bk.head": "Header", "bk.foot": "Footer", "bk.social": "Social icons", "bk.noLogo": "No logo", "bk.pickLogo": "Choose logo", "bk.noLogoBtn": "Remove logo", "bk.logoW": "Logo width", "bk.headT": "Name", "bk.headSub": "Line under the name (optional)", "bk.linkText": "Link text", "bk.linkRemove": "Remove this link", "bk.linkAdd": "Link", "bk.iconStyle": "Icons", "bk.ist.c": "Brand colours", "bk.ist.d": "Dark", "bk.ist.l": "Light (for dark backgrounds)", "bk.iconSize": "Size", "bk.network": "Network", "bk.netRemove": "Remove this network", "bk.netAdd": "Network", "bk.footHint": "Your address and the unsubscribe link are always added below the footer.", "bk.makeDefault": "Use in every new issue of this list", "bk.isDefault": "Used in every new issue of this list", "bk.defHeadDone": "New issues of this list start with this header", "bk.defFootDone": "New issues of this list end with this footer",
      "ed.undo": "Undo", "ed.redo": "Redo", "bk.list": "List", "bk.quote": "Quote", "bk.sp": "Space", "bk.drag": "Drag to move (or use the arrow keys)", "bk.newer": "Newer block", "bk.newerHint": "This block was made in a newer orOS. Update orOS on this device to see and edit it; it is kept as it is.", "bk.settings": "Block settings", "bk.dup": "Duplicate", "bk.full": "Too many blocks: remove one first", "bk.moved": "Moved to position {n}", "bk.level": "Size", "bk.listPh": "One item per line", "bk.listKind": "Kind", "bk.bullets": "Bullets", "bk.numbers": "Numbers", "bk.by": "Who said it (optional)", "bk.height": "Height", "bk.lineStyle": "Style", "bk.hr.solid": "Solid", "bk.hr.dashed": "Dashed", "bk.hr.dotted": "Dotted", "bk.thick": "Thickness", "bk.width": "Width", "bk.lineColor": "Own line colour", "bk.btnN": "Button {n}", "bk.btnRemove": "Remove this button", "bk.btnStyle": "Style", "bk.fill": "Filled", "bk.outline": "Outline", "bk.full100": "Full width", "bk.btnAdd": "Button next to it", "bk.align": "Alignment", "bk.al.left": "Left", "bk.al.center": "Centre", "bk.al.right": "Right", "bk.pad": "Space above and below", "bk.bg": "Background colour", "sty.font": "Font", "sty.font.sans": "Sans serif", "sty.font.serif": "Serif", "sty.font.mono": "Monospace", "sty.hs": "Headings", "sty.hs.s": "Small", "sty.hs.m": "Medium", "sty.hs.l": "Large", "sty.btn": "Buttons", "sty.btn.round": "Rounded", "sty.btn.square": "Square", "sty.btn.pill": "Pill", "sty.link": "Own link colour", "sty.bg": "Own e-mail background", "ck.newerBlock": "This issue has a block made in a newer orOS. Update orOS on this device before sending it.",
      "lists.rss": "RSS to e-mail",
      "rss.title": "RSS to e-mail", "rss.none": "No feeds yet. Pick one of your Reader feeds or any feed address, and orOS makes an issue from its new articles on the day you choose.",
      "rss.add": "Add a feed", "rss.edit": "RSS to e-mail", "rss.src": "Feed", "rss.other": "Another address…",
      "rss.noReader": "You have no feeds in Reader: type the feed address.", "rss.url": "Feed address", "rss.name": "Name (used in the subject)",
      "rss.every": "How often", "rss.day": "Every day", "rss.week": "Every week", "rss.month": "Every month (on the 1st)",
      "rss.wd": "Day", "rss.hour": "Time", "rss.mode": "What to do", "rss.draft": "Make a draft for me to check", "rss.send": "Send it by itself",
      "rss.sendHint": "It sends only if the check before sending finds no errors; otherwise it leaves a draft and tells you.",
      "rss.draftShort": "draft", "rss.sendShort": "sends", "rss.aud": "Send to", "rss.max": "Most articles per issue", "rss.on": "On",
      "rss.hint": "Only articles newer than the last issue go in. It runs on this device while orOS is open; if orOS is closed it runs the next time it opens.",
      "rss.now": "Make one now", "rss.reading": "Reading the feed…", "rss.nothing": "The feed has no articles",
      "rss.made": "Draft made from the feed", "rss.fail": "Couldn't read the feed ({e})", "rss.full": "You have the most feeds allowed",
      "rss.badUrl": "Type a feed address that starts with https://", "rss.next": "next {t}", "rss.off": "off", "rss.otherDev": "runs on another device",
      "wd.0": "Sunday", "wd.1": "Monday", "wd.2": "Tuesday", "wd.3": "Wednesday", "wd.4": "Thursday", "wd.5": "Friday", "wd.6": "Saturday",
      "set.archive": "Past issues", "set.archiveText": "Bring in the issues you sent with Substack, Buttondown, MailerLite or another service: a .zip export, or Markdown, HTML, CSV or JSON files. Pictures stay at their web address.",
      "set.archiveBtn": "Import past issues…",
      "arc.title": "Import past issues", "arc.none": "No issues found in this file.", "arc.found": "Found {n} issues.", "arc.list": "Into list",
      "arc.mode": "Import as", "arc.modeHint": "Past issues show among the issues as already sent, ready to save as a web page or copy; nobody gets an e-mail.",
      "arc.archive": "Past issues (already sent)", "arc.drafts": "Drafts", "arc.do": "Import {n}", "arc.done": "Imported {n} issues",
      "arc.full": "Imported {n} issues: there is no room for more", "arc.bad": "This file can't be read",
      "i2.title": "Import from {s}", "i2.hint": "Subscribers join the list you pick, with the basis you choose. Posts become past issues (already sent, nobody gets an e-mail) or drafts; pictures stay at their web address.",
      "i2.subs": "Subscribers: {n}", "i2.pSkip": "{n} left out: unsubscribed, not confirmed or no longer active there.", "i2.pSkipShop": "{n} left out: they don't accept e-mail marketing in Shopify.",
      "i2.iss": "Past issues: {n}", "i2.iSkip": "{n} drafts or unpublished posts left out", "i2.iNoBody": "{n} without text",
      "i2.issSum": "{n} new issues · {h} already here", "i2.full": "no room for the rest",
      "i2.do": "Import", "i2.done": "Imported {s} subscribers and {i} issues",
      "iss.imported": "imported", "vw.imported": "Imported from another service; sent {t}.",
      "err.nofeed": "it isn't a feed", "err.nofeeds": "the feed reader isn't loaded",
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
      "fm.title": "Sign-up form for your site", "fm.text": "A form people fill in on your own site, and a one-click unsubscribe link in every issue. orOS's relay holds sign-ups, encrypted for this list, until orOS collects them (every few minutes while it is open); then each one gets a confirmation request.",
      "fm.on": "Set up the form", "fm.ready": "The form is ready: copy its HTML to your site", "fm.html": "Form HTML",
      "fm.htmlHint": "Paste it into any page of your site. It needs no script; style it as you like.",
      "fm.email": "Your e-mail", "fm.name": "Your name", "fm.back": "Thank-you page (optional)",
      "fm.backHint": "Where people land after signing up. Empty: a short page from orOS.", "fm.badBack": "The address must start with https://",
      "fm.saved": "Saved", "fm.here": "Sign-ups are collected on this device.", "fm.there": "Sign-ups are collected on another device.",
      "fm.collectHere": "Collect here", "fm.off": "Turn the form off",
      "fm.offText": "The form and the one-click links in issues already sent stop working, and sign-ups not yet collected are lost. The e-mail way keeps working.",
      "fm.nostore": "The relay doesn't offer sign-up forms yet", "fm.fail": "Couldn't reach the relay ({e})",
      "src.form": "Web form",
      "lk.link": "Link", "lk.html": "HTML for your site", "lk.copy": "Copy", "lk.copied": "Copied", "lk.btn": "Subscribe",
      "ch.title": "Sending account", "ch.kind": "Send through", "ch.acct": "Mail account", "ch.noAcct": "Add an e-mail account in Mail first (with its outgoing server).",
      "ch.preset": "Provider", "ch.host": "SMTP server", "ch.port": "Port", "ch.user": "User name",
      "ch.pass": "Password or API key", "ch.passKeep": "Saved on this device: leave empty to keep it",
      "ch.passHint": "Stays sealed on this device and is never synced: enter it once on each device that sends.",
      "ch.inbox": "Inbox for requests and bounces", "ch.inboxNone": "None", "ch.inboxHint": "The Mail account that receives replies to your From address.",
      "ch.rate": "Seconds between messages", "ch.cap": "Messages a day (at most)",
      "ch.capHint": "Keep it under your provider's daily limit: an ordinary mailbox often allows about 500 a day, a sending provider says it in your plan.",
      "ch.presetHint": "Starting values: check the server and your plan's limits in the provider's own guide.",
      "ch.via": "Connection", "ch.viaSmtp": "SMTP", "ch.viaApi": "HTTP API",
      "ch.viaHint": "With the API, up to 10 messages go in one call, and the provider's bounces, complaints and unsubscribes come back to your list.",
      "ch.key": "API key", "ch.dom": "Mailgun sending domain", "ch.domHint": "The domain as it appears in Mailgun, for example mg.example.com.",
      "ch.test": "Test login", "ch.testOk": "Login works", "ch.delete": "Remove account",
      "ch.inUse": "Lists use this account: choose another account for them first.",
      "p.other": "Other", "p.brevo": "Brevo", "p.ses": "Amazon SES", "p.mailgun": "Mailgun (US)", "p.mailgun-eu": "Mailgun (EU)",
      "p.postmark": "Postmark (broadcast stream)", "p.sendgrid": "SendGrid", "p.smtp2go": "SMTP2GO", "p.mailersend": "MailerSend (MailerLite)", "p.gmail": "Gmail",
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
      "ck.apiImg": "Brevo's API can't carry pictures inside a message: remove the pictures, or send this list through Brevo's SMTP.",
      "ck.bigImgs": "The pictures add up to more than 400 KB: every subscriber downloads them.",
      "ck.badBlock": "A button without text or link, or a picture block without a picture.",
      "ck.placeholder": "Something in braces isn't {first}, {name} or {first|…}.",
      "ck.noAudience": "Nobody to send to: no active subscriber matches.",
      "ck.oldPrices": "Product prices were read from the shop more than a day ago: use Refresh prices in the product block.", "bk.prod": "Products",
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
      "err.apikey": "the provider refused the API key: check it and its permissions", "err.nodom": "the Mailgun domain is missing",
      "set.title": "Settings", "set.backup": "Back up (JSON)", "set.restore": "Restore from backup", "set.data": "Data",
      "set.osave": "orOS file (.orosnewsletter)", "set.oopen": "Open orOS file…", "set.ofolder": "Unzipped orOS folder…",
      "set.oText": "Lists, subscribers, issues and pictures in one file. Passwords, keys and the web form stay on this device.",
      "set.about": "About", "set.aboutText": "Newsletter sends one e-mail per subscriber through the orOS mail relay, from your own account or a provider's SMTP, while orOS is open. Nothing is tracked: no open or click counting. Subscribe, confirm and unsubscribe requests are e-mails it reads from your Inbox.",
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
      "live.saved": "Saved", "time.now": "just now",
      "seed.hi": "Hi {first|there},"
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
      "as.title": "Προσθήκη σε τεύχος", "as.text": "{n} blocks από τον Βοηθό. Διάλεξε το πρόχειρο όπου θα μπουν ή ξεκίνα νέο.",
      "as.text1": "Ένα block από τον Βοηθό. Διάλεξε το πρόχειρο όπου θα μπει ή ξεκίνα νέο.",
      "as.drafts": "Πρόχειρα", "as.newDraft": "Ή νέο πρόχειρο", "as.list": "Λίστα", "as.create": "Νέο πρόχειρο",
      "as.noList": "Φτιάξε πρώτα μια λίστα: κάθε τεύχος ανήκει σε λίστα.", "as.newList": "Νέα λίστα",
      "as.added": "Προστέθηκαν {n} blocks", "as.added1": "Προστέθηκε 1 block", "as.cut": "({n} ακόμα δεν χώρεσαν: ένα τεύχος έχει έως 60 blocks.)",
      "as.none": "Τίποτα για προσθήκη: τα blocks ήταν κενά.",
      "as.pic1": "Μία εικόνα δεν αντιγράφηκε από τη σελίδα της: διάλεξέ τη στο block της.", "as.pics": "{n} εικόνες δεν αντιγράφηκαν από τις σελίδες τους: διάλεξέ τες στα blocks τους.",
      "tpl.new": "Νέο τεύχος", "tpl.blank": "Κενό τεύχος", "tpl.from": "Ή ξεκίνα από πρότυπο", "tpl.delete": "Διαγραφή προτύπου",
      "sd.now": "Τώρα", "sd.later": "Αργότερα", "sd.when": "Αποστολή στις", "sd.schedule": "Προγραμματισμός", "sd.whenBad": "Διάλεξε μια μελλοντική ώρα",
      "sd.whenHint": "Το στέλνει το orOS από αυτή τη συσκευή: αν δεν είναι ανοιχτό τότε, ξεκινά μόλις το ανοίξεις εδώ.",
      "vw.sched": "Φεύγει {t}.", "vw.schedOther": "Προγραμματίστηκε σε άλλη συσκευή: θα φύγει από εκεί.",
      "vw.unsched": "Ακύρωση προγραμματισμού", "vw.sendNow": "Αποστολή τώρα", "toast.sched": "Προγραμματίστηκε για {t}", "toast.unsched": "Επέστρεψε στα πρόχειρα",
      "subs.crm": "Από το CRM", "imp.crm": "Από το CRM", "imp.crmNone": "Κανένας πελάτης του CRM με email.",
      "imp.crmHint": "Διάλεξε τους πελάτες που θα παίρνουν το δελτίο. Αν διαλέξεις μόνο πελάτες (τωρινούς ή πρώην) μετράνε ως «Υπάρχων πελάτης»· αν υπάρχουν και υποψήφιοι, όλοι επιβεβαιώνουν με email.",
      "imp.crmTags": "Η κατάσταση και οι ετικέτες τους στο CRM γίνονται ετικέτες", "crm.lead": "υποψήφιος", "crm.active": "πελάτης", "crm.past": "πρώην πελάτης",
      "src.crm": "CRM", "src.platform": "Πλατφόρμα email", "pv.lang": "Γλώσσα", "ts.lang": "Έκδοση",
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
      "subs.enrich": "Συμπλήρωση ονομάτων online", "en.none": "Όλοι οι συνδρομητές της λίστας έχουν ήδη όνομα.",
      "en.done": "Προστέθηκαν ονόματα: {n}",
      "subs.export": "Εξαγωγή CSV", "subs.inbox": "Έλεγχος Εισερχομένων", "subs.invite": "Αποστολή αιτημάτων επιβεβαίωσης ({n})",
      "subs.clean": "Καθαρισμός…", "cl.title": "Καθαρισμός της λίστας",
      "cl.text": "Για να μη μεγαλώνει η λίστα με ανθρώπους που δεν θα τη διαβάσουν ποτέ. Το Ενημερωτικό δελτίο δεν μετρά ανοίγματα, οπότε διαγράφει μόνο όσους δεν επιβεβαίωσαν ποτέ ή έχουν ήδη φύγει, και ρωτά όσους δεν έδωσαν σημάδι ζωής για καιρό αν θέλουν να μείνουν.",
      "cl.pend": "Διαγραφή όσων δεν επιβεβαίωσαν", "cl.pendN": "{n} ημέρες μετά το αίτημα",
      "cl.gone": "Διαγραφή όσων έφυγαν (απεγγραφή, επιστροφή, spam)", "cl.goneN": "{n} ημέρες αφού έφυγαν",
      "cl.goneHint": "Μένει ένα αποτύπωμα της διεύθυνσης, ώστε μια εισαγωγή να μην τους ξαναβάλει. Αν ξαναγραφτούν μόνοι τους, είναι ευπρόσδεκτοι.",
      "cl.idle": "Ερώτηση «Θέλεις να συνεχίσεις;» μετά από", "cl.idleN": "{n} μήνες χωρίς σημάδι ζωής",
      "cl.idleHint": "Σημάδι ζωής είναι η εγγραφή ή η επιβεβαίωση· το Ενημερωτικό δελτίο δεν μετρά ανοίγματα. Όποιος δεν απαντήσει σε 30 ημέρες απεγγράφεται. Έως 20 τη μέρα (ή το 5% της λίστας), οι παλαιότεροι πρώτα.",
      "cl.idleNow": "Θα ρωτηθούν {n} αν θέλουν να μείνουν.", "bar.ask": "Αποστολή «Θέλεις να συνεχίσεις;»: απομένουν {n}",
      "cl.never": "Ποτέ", "cl.devHere": "Γίνεται μία φορά τη μέρα σε αυτή τη συσκευή, όσο είναι ανοιχτό το orOS.",
      "cl.devOther": "Γίνεται μία φορά τη μέρα σε άλλη συσκευή σου.", "cl.devNone": "Ξεκινά στη συσκευή που στέλνει αυτή τη λίστα.",
      "cl.here": "Να γίνεται σε αυτή τη συσκευή", "cl.now": "Τώρα θα διαγράφονταν {p} που δεν επιβεβαίωσαν και {g} που έφυγαν.", "cl.nobody": "Κανείς για διαγραφή τώρα.",
      "cl.wait": "Είναι περισσότεροι από όσους διαγράφει μόνο του το Ενημερωτικό δελτίο σε μία μέρα ({max} ή το ένα πέμπτο της λίστας), οπότε περιμένει εσένα.",
      "cl.csv": "Εξαγωγή τους (CSV)", "cl.go": "Καθαρισμός τώρα", "cl.goText": "Να διαγραφούν οριστικά {n} άτομα από τη λίστα «{l}»; Δεν αναιρείται.",
      "cl.done": "Διαγράφηκαν: {n}",
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
      "bk.noImgBtn": "Αφαίρεση εικόνας", "bk.imgtxt": "Εικόνα + κείμενο", "bk.cols3": "3 στήλες", "bk.gallery": "Γκαλερί", "bk.video": "Βίντεο", "bk.table": "Πίνακας", "bk.event": "Εκδήλωση", "bk.more": "Περισσότερα blocks", "bk.moreTitle": "Προσθήκη block", "bk.saved": "Αποθηκευμένα blocks", "bk.savedNone": "Δεν υπάρχουν αποθηκευμένα blocks ακόμα. Άνοιξε τις ρυθμίσεις ενός block (το γρανάζι) και διάλεξε Αποθήκευση block.", "bk.save": "Αποθήκευση block", "bk.saveName": "Όνομα", "bk.savedDone": "Το block αποθηκεύτηκε: θα το βρεις στα Περισσότερα blocks", "bk.savedFull": "Έχεις 100 αποθηκευμένα blocks: διάγραψε πρώτα ένα", "bk.savedDel": "Διαγραφή αποθηκευμένου block", "bk.side": "Εικόνα", "bk.sideL": "Αριστερά", "bk.sideR": "Δεξιά", "bk.hd": "Τίτλος", "bk.colN": "Στήλη {n}", "bk.per": "Ανά σειρά", "bk.galAdd": "Εικόνα", "bk.galRemove": "Αφαίρεση αυτής της εικόνας", "bk.galEmpty": "Δεν υπάρχουν εικόνες ακόμα", "bk.videoUrl": "Σύνδεσμος βίντεο (YouTube, Vimeo, PeerTube…)", "bk.videoCap": "Λεζάντα (προαιρετικά)", "bk.videoHint": "Διάλεξε μια εικόνα από το βίντεο: σχεδιάζεται πάνω της ένα σήμα αναπαραγωγής και ανοίγει τον σύνδεσμο. Το orOS δεν φέρνει τίποτα από τη σελίδα του βίντεο. Χωρίς εικόνα, ένα κουμπί ανοίγει τον σύνδεσμο.", "bk.tblHead": "Η πρώτη γραμμή είναι επικεφαλίδα", "bk.tblRow": "Γραμμή", "bk.tblCol": "Στήλη", "bk.tblRowDel": "Αφαίρεση της τελευταίας γραμμής", "bk.tblColDel": "Αφαίρεση της τελευταίας στήλης", "bk.cell": "Γραμμή {r}, στήλη {c}", "bk.evT": "Όνομα εκδήλωσης", "bk.evD": "Ημέρα", "bk.evTm": "Έναρξη (προαιρετικά)", "bk.evTe": "Λήξη (προαιρετικά)", "bk.evLoc": "Τόπος (προαιρετικά)", "bk.evSub": "Λεπτομέρειες (προαιρετικά)", "bk.evIcs": "Συνημμένο αρχείο ημερολογίου (.ics)", "bk.evBtn": "Κουμπί (προαιρετικά)", "tpl.layouts": "Ή ξεκίνα από έτοιμη διάταξη", "lay.weekly": "Εβδομαδιαία νέα", "lay.announce": "Ανακοίνωση", "lay.offer": "Προσφορά προϊόντων", "lay.w.title": "Αυτή την εβδομάδα", "lay.w.intro": "Γεια σου! Να τι έγινε αυτή την εβδομάδα.", "lay.w.s1": "Το κύριο θέμα", "lay.w.s1t": "Λίγες γραμμές γι' αυτό. Πρόσθεσε μια εικόνα στο πλάι.", "lay.w.s2": "Επίσης νέο", "lay.w.s2t": "Ένα ακόμα θέμα, με την εικόνα του δεξιά.", "lay.w.links": "Αξίζει να διαβάσεις", "lay.w.list": "Πρώτος σύνδεσμος\nΔεύτερος σύνδεσμος\nΤρίτος σύνδεσμος", "lay.w.more": "Διάβασε περισσότερα", "lay.a.title": "Μεγάλα νέα", "lay.a.intro": "Γεια σου! Έχουμε κάτι να σου πούμε.", "lay.a.body": "Πες τι είναι νέο, γιατί έχει σημασία και τι να κάνει κανείς μετά.", "lay.a.btn": "Μάθε περισσότερα", "lay.a.quote": "Μια φράση από κάποιον που το δοκίμασε.", "lay.a.by": "Το όνομά του", "lay.o.title": "Η προσφορά της εβδομάδας", "lay.o.intro": "Διαλεγμένα για σένα, μέχρι εξαντλήσεως.", "lay.o.p1": "Πρώτο προϊόν", "lay.o.p1t": "Τι το κάνει ξεχωριστό. Από 40 €, τώρα **29 €**", "lay.o.p2": "Δεύτερο προϊόν", "lay.o.p2t": "Μία ή δύο γραμμές γι' αυτό. **19 €**", "lay.o.buy": "Αγόρασέ το", "lay.o.all": "Όλες οι προσφορές",
      "bk.head": "Κεφαλίδα", "bk.foot": "Υποσέλιδο", "bk.social": "Εικονίδια social", "bk.noLogo": "Χωρίς λογότυπο", "bk.pickLogo": "Επιλογή λογοτύπου", "bk.noLogoBtn": "Αφαίρεση λογοτύπου", "bk.logoW": "Πλάτος λογοτύπου", "bk.headT": "Όνομα", "bk.headSub": "Γραμμή κάτω από το όνομα (προαιρετικά)", "bk.linkText": "Κείμενο συνδέσμου", "bk.linkRemove": "Αφαίρεση αυτού του συνδέσμου", "bk.linkAdd": "Σύνδεσμος", "bk.iconStyle": "Εικονίδια", "bk.ist.c": "Χρώματα του κάθε δικτύου", "bk.ist.d": "Σκούρα", "bk.ist.l": "Ανοιχτά (για σκούρο φόντο)", "bk.iconSize": "Μέγεθος", "bk.network": "Δίκτυο", "bk.netRemove": "Αφαίρεση αυτού του δικτύου", "bk.netAdd": "Δίκτυο", "bk.footHint": "Η διεύθυνσή σου και ο σύνδεσμος κατάργησης εγγραφής μπαίνουν πάντα κάτω από το υποσέλιδο.", "bk.makeDefault": "Χρήση σε κάθε νέο τεύχος της λίστας", "bk.isDefault": "Μπαίνει σε κάθε νέο τεύχος της λίστας", "bk.defHeadDone": "Τα νέα τεύχη της λίστας θα ξεκινούν με αυτή την κεφαλίδα", "bk.defFootDone": "Τα νέα τεύχη της λίστας θα τελειώνουν με αυτό το υποσέλιδο",
      "ed.undo": "Αναίρεση", "ed.redo": "Επανάληψη", "bk.list": "Λίστα", "bk.quote": "Παράθεση", "bk.sp": "Κενό", "bk.drag": "Σύρε για μετακίνηση (ή με τα βελάκια)", "bk.newer": "Νεότερο block", "bk.newerHint": "Αυτό το block φτιάχτηκε σε νεότερο orOS. Ενημέρωσε το orOS σε αυτή τη συσκευή για να το δεις και να το αλλάξεις· μένει όπως είναι.", "bk.settings": "Ρυθμίσεις block", "bk.dup": "Διπλασιασμός", "bk.full": "Πάρα πολλά blocks: αφαίρεσε πρώτα ένα", "bk.moved": "Μετακινήθηκε στη θέση {n}", "bk.level": "Μέγεθος", "bk.listPh": "Ένα στοιχείο σε κάθε γραμμή", "bk.listKind": "Είδος", "bk.bullets": "Κουκκίδες", "bk.numbers": "Αριθμοί", "bk.by": "Ποιος το είπε (προαιρετικά)", "bk.height": "Ύψος", "bk.lineStyle": "Στυλ", "bk.hr.solid": "Συνεχής", "bk.hr.dashed": "Διακεκομμένη", "bk.hr.dotted": "Με τελείες", "bk.thick": "Πάχος", "bk.width": "Πλάτος", "bk.lineColor": "Δικό της χρώμα γραμμής", "bk.btnN": "Κουμπί {n}", "bk.btnRemove": "Αφαίρεση αυτού του κουμπιού", "bk.btnStyle": "Στυλ", "bk.fill": "Γεμάτο", "bk.outline": "Περίγραμμα", "bk.full100": "Σε όλο το πλάτος", "bk.btnAdd": "Κουμπί δίπλα", "bk.align": "Στοίχιση", "bk.al.left": "Αριστερά", "bk.al.center": "Κέντρο", "bk.al.right": "Δεξιά", "bk.pad": "Κενό πάνω και κάτω", "bk.bg": "Χρώμα φόντου", "sty.font": "Γραμματοσειρά", "sty.font.sans": "Χωρίς πατούρες", "sty.font.serif": "Με πατούρες", "sty.font.mono": "Σταθερού πλάτους", "sty.hs": "Επικεφαλίδες", "sty.hs.s": "Μικρές", "sty.hs.m": "Μεσαίες", "sty.hs.l": "Μεγάλες", "sty.btn": "Κουμπιά", "sty.btn.round": "Στρογγυλεμένα", "sty.btn.square": "Τετράγωνα", "sty.btn.pill": "Χάπι", "sty.link": "Δικό τους χρώμα συνδέσμων", "sty.bg": "Δικό του φόντο email", "ck.newerBlock": "Το τεύχος έχει block από νεότερο orOS. Ενημέρωσε το orOS σε αυτή τη συσκευή πριν το στείλεις.",
      "lists.rss": "RSS σε email",
      "rss.title": "RSS σε email", "rss.none": "Δεν υπάρχουν ροές ακόμα. Διάλεξε μια ροή από τον Αναγνώστη ή οποιαδήποτε διεύθυνση ροής, και το orOS φτιάχνει τεύχος από τα νέα άρθρα της τη μέρα που θέλεις.",
      "rss.add": "Προσθήκη ροής", "rss.edit": "RSS σε email", "rss.src": "Ροή", "rss.other": "Άλλη διεύθυνση…",
      "rss.noReader": "Δεν έχεις ροές στον Αναγνώστη: γράψε τη διεύθυνση της ροής.", "rss.url": "Διεύθυνση ροής", "rss.name": "Όνομα (μπαίνει στο θέμα)",
      "rss.every": "Κάθε πότε", "rss.day": "Κάθε μέρα", "rss.week": "Κάθε εβδομάδα", "rss.month": "Κάθε μήνα (την 1η)",
      "rss.wd": "Μέρα", "rss.hour": "Ώρα", "rss.mode": "Τι να γίνει", "rss.draft": "Πρόχειρο για να το ελέγξω", "rss.send": "Να σταλεί μόνο του",
      "rss.sendHint": "Στέλνεται μόνο αν ο έλεγχος πριν την αποστολή δεν βρει σφάλματα· αλλιώς μένει πρόχειρο και σε ειδοποιεί.",
      "rss.draftShort": "πρόχειρο", "rss.sendShort": "στέλνεται", "rss.aud": "Αποστολή σε", "rss.max": "Το πολύ άρθρα ανά τεύχος", "rss.on": "Ενεργό",
      "rss.hint": "Μπαίνουν μόνο άρθρα νεότερα από το προηγούμενο τεύχος. Τρέχει σε αυτή τη συσκευή όσο το orOS είναι ανοιχτό· αν είναι κλειστό, τρέχει την επόμενη φορά που θα ανοίξει.",
      "rss.now": "Φτιάξε ένα τώρα", "rss.reading": "Διαβάζω τη ροή…", "rss.nothing": "Η ροή δεν έχει άρθρα",
      "rss.made": "Έγινε πρόχειρο από τη ροή", "rss.fail": "Δεν διαβάστηκε η ροή ({e})", "rss.full": "Έχεις τις περισσότερες ροές που επιτρέπονται",
      "rss.badUrl": "Γράψε διεύθυνση ροής που αρχίζει με https://", "rss.next": "επόμενο {t}", "rss.off": "ανενεργό", "rss.otherDev": "τρέχει σε άλλη συσκευή",
      "wd.0": "Κυριακή", "wd.1": "Δευτέρα", "wd.2": "Τρίτη", "wd.3": "Τετάρτη", "wd.4": "Πέμπτη", "wd.5": "Παρασκευή", "wd.6": "Σάββατο",
      "set.archive": "Παλιά τεύχη", "set.archiveText": "Φέρε τα τεύχη που έστειλες με το Substack, το Buttondown, το MailerLite ή άλλη υπηρεσία: ένα .zip εξαγωγής ή αρχεία Markdown, HTML, CSV ή JSON. Οι εικόνες μένουν στη διεύθυνσή τους στο διαδίκτυο.",
      "set.archiveBtn": "Εισαγωγή παλιών τευχών…",
      "arc.title": "Εισαγωγή παλιών τευχών", "arc.none": "Δεν βρέθηκαν τεύχη σε αυτό το αρχείο.", "arc.found": "Βρέθηκαν {n} τεύχη.", "arc.list": "Στη λίστα",
      "arc.mode": "Εισαγωγή ως", "arc.modeHint": "Τα παλιά τεύχη φαίνονται στα τεύχη ως ήδη σταλμένα, έτοιμα για αποθήκευση ως ιστοσελίδα ή αντιγραφή· δεν στέλνεται κανένα email.",
      "arc.archive": "Παλιά τεύχη (ήδη σταλμένα)", "arc.drafts": "Πρόχειρα", "arc.do": "Εισαγωγή {n}", "arc.done": "Εισήχθησαν {n} τεύχη",
      "arc.full": "Εισήχθησαν {n} τεύχη: δεν χωράνε άλλα", "arc.bad": "Αυτό το αρχείο δεν διαβάζεται",
      "i2.title": "Εισαγωγή από {s}", "i2.hint": "Οι συνδρομητές μπαίνουν στη λίστα που διαλέγεις, με τη βάση που ορίζεις. Οι αναρτήσεις γίνονται παλιά τεύχη (ήδη σταλμένα, δεν φεύγει κανένα email) ή πρόχειρα· οι εικόνες μένουν στη διεύθυνσή τους στο διαδίκτυο.",
      "i2.subs": "Συνδρομητές: {n}", "i2.pSkip": "{n} έμειναν έξω: διαγράφηκαν, δεν επιβεβαίωσαν ή δεν είναι πια ενεργοί εκεί.", "i2.pSkipShop": "{n} έμειναν έξω: δεν δέχονται email μάρκετινγκ στο Shopify.",
      "i2.iss": "Παλιά τεύχη: {n}", "i2.iSkip": "{n} πρόχειρα ή αδημοσίευτα έμειναν έξω", "i2.iNoBody": "{n} χωρίς κείμενο",
      "i2.issSum": "{n} νέα τεύχη · {h} υπάρχουν ήδη", "i2.full": "δεν χωράνε τα υπόλοιπα",
      "i2.do": "Εισαγωγή", "i2.done": "Εισήχθησαν {s} συνδρομητές και {i} τεύχη",
      "iss.imported": "εισαγωγή", "vw.imported": "Εισαγωγή από άλλη υπηρεσία· στάλθηκε {t}.",
      "err.nofeed": "δεν είναι ροή", "err.nofeeds": "ο αναγνώστης ροών δεν φορτώθηκε",
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
      "fm.title": "Φόρμα εγγραφής για το site σου", "fm.text": "Μια φόρμα που συμπληρώνουν στο δικό σου site, και σύνδεσμος διαγραφής με ένα κλικ σε κάθε τεύχος. Το relay του orOS κρατά τις εγγραφές, κρυπτογραφημένες για αυτή τη λίστα, μέχρι να τις μαζέψει το orOS (κάθε λίγα λεπτά όσο είναι ανοιχτό)· τότε ο καθένας παίρνει αίτημα επιβεβαίωσης.",
      "fm.on": "Δημιουργία φόρμας", "fm.ready": "Η φόρμα είναι έτοιμη: αντίγραψε το HTML της στο site σου", "fm.html": "HTML της φόρμας",
      "fm.htmlHint": "Επικόλλησέ το σε οποιαδήποτε σελίδα του site σου. Δεν θέλει script· μορφοποίησέ το όπως θέλεις.",
      "fm.email": "Το email σου", "fm.name": "Το όνομά σου", "fm.back": "Σελίδα ευχαριστίας (προαιρετικά)",
      "fm.backHint": "Πού καταλήγουν μετά την εγγραφή. Κενό: μια μικρή σελίδα του orOS.", "fm.badBack": "Η διεύθυνση πρέπει να αρχίζει με https://",
      "fm.saved": "Αποθηκεύτηκε", "fm.here": "Οι εγγραφές μαζεύονται σε αυτή τη συσκευή.", "fm.there": "Οι εγγραφές μαζεύονται σε άλλη συσκευή.",
      "fm.collectHere": "Να μαζεύονται εδώ", "fm.off": "Απενεργοποίηση φόρμας",
      "fm.offText": "Η φόρμα και οι σύνδεσμοι διαγραφής με ένα κλικ στα τεύχη που έχουν σταλεί σταματούν να δουλεύουν, και χάνονται όσες εγγραφές δεν έχουν μαζευτεί. Ο τρόπος με email συνεχίζει να δουλεύει.",
      "fm.nostore": "Το relay δεν προσφέρει ακόμα φόρμες εγγραφής", "fm.fail": "Δεν βρέθηκε το relay ({e})",
      "src.form": "Φόρμα στο site",
      "lk.link": "Σύνδεσμος", "lk.html": "HTML για το site σου", "lk.copy": "Αντιγραφή", "lk.copied": "Αντιγράφηκε", "lk.btn": "Εγγραφή",
      "ch.title": "Λογαριασμός αποστολής", "ch.kind": "Αποστολή μέσω", "ch.acct": "Λογαριασμός Mail", "ch.noAcct": "Πρόσθεσε πρώτα έναν λογαριασμό email στο Mail (με τον διακομιστή εξερχομένων).",
      "ch.preset": "Πάροχος", "ch.host": "Διακομιστής SMTP", "ch.port": "Θύρα", "ch.user": "Όνομα χρήστη",
      "ch.pass": "Κωδικός ή κλειδί API", "ch.passKeep": "Αποθηκευμένος σε αυτή τη συσκευή: άφησέ το κενό για να μείνει",
      "ch.passHint": "Μένει σφραγισμένος σε αυτή τη συσκευή και δεν συγχρονίζεται ποτέ: γράψ' τον μία φορά σε κάθε συσκευή που στέλνει.",
      "ch.inbox": "Εισερχόμενα για αιτήματα και επιστροφές", "ch.inboxNone": "Κανένα", "ch.inboxHint": "Ο λογαριασμός του Mail που δέχεται τις απαντήσεις στη διεύθυνση αποστολέα.",
      "ch.rate": "Δευτερόλεπτα ανάμεσα στα μηνύματα", "ch.cap": "Μηνύματα τη μέρα (το πολύ)",
      "ch.capHint": "Κράτα το κάτω από το ημερήσιο όριο του παρόχου σου: ένα απλό γραμματοκιβώτιο συχνά επιτρέπει περίπου 500 τη μέρα, ένας πάροχος αποστολής το γράφει στο πακέτο σου.",
      "ch.presetHint": "Αρχικές τιμές: έλεγξε τον διακομιστή και τα όρια του πακέτου σου στον οδηγό του παρόχου.",
      "ch.via": "Σύνδεση", "ch.viaSmtp": "SMTP", "ch.viaApi": "HTTP API",
      "ch.viaHint": "Με το API φεύγουν έως 10 μηνύματα σε μία κλήση και οι επιστροφές, οι καταγγελίες και οι διαγραφές του παρόχου γυρίζουν στη λίστα σου.",
      "ch.key": "Κλειδί API", "ch.dom": "Domain αποστολής στο Mailgun", "ch.domHint": "Το domain όπως φαίνεται στο Mailgun, για παράδειγμα mg.example.com.",
      "ch.test": "Δοκιμή σύνδεσης", "ch.testOk": "Η σύνδεση δουλεύει", "ch.delete": "Αφαίρεση λογαριασμού",
      "ch.inUse": "Τον χρησιμοποιούν λίστες: διάλεξε πρώτα άλλον λογαριασμό για αυτές.",
      "p.other": "Άλλος", "p.brevo": "Brevo", "p.ses": "Amazon SES", "p.mailgun": "Mailgun (ΗΠΑ)", "p.mailgun-eu": "Mailgun (ΕΕ)",
      "p.postmark": "Postmark (broadcast stream)", "p.sendgrid": "SendGrid", "p.smtp2go": "SMTP2GO", "p.mailersend": "MailerSend (MailerLite)", "p.gmail": "Gmail",
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
      "ck.apiImg": "Το API του Brevo δεν μεταφέρει εικόνες μέσα στο μήνυμα: βγάλε τις εικόνες ή στείλε αυτή τη λίστα μέσω του SMTP του Brevo.",
      "ck.bigImgs": "Οι εικόνες ξεπερνούν τα 400 KB: τις κατεβάζει κάθε συνδρομητής.",
      "ck.badBlock": "Ένα κουμπί χωρίς κείμενο ή σύνδεσμο, ή block εικόνας χωρίς εικόνα.",
      "ck.placeholder": "Κάτι μέσα σε άγκιστρα δεν είναι {first}, {name} ή {first|…}.",
      "ck.noAudience": "Δεν υπάρχει παραλήπτης: κανένας ενεργός συνδρομητής δεν ταιριάζει.",
      "ck.oldPrices": "Οι τιμές των προϊόντων διαβάστηκαν από το κατάστημα πριν από πάνω από μία μέρα: πάτα Ανανέωση τιμών στο block προϊόντων.", "bk.prod": "Προϊόντα",
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
      "err.apikey": "ο πάροχος απέρριψε το κλειδί API: έλεγξέ το και τα δικαιώματά του", "err.nodom": "λείπει το domain του Mailgun",
      "set.title": "Ρυθμίσεις", "set.backup": "Αντίγραφο ασφαλείας (JSON)", "set.restore": "Επαναφορά από αντίγραφο", "set.data": "Δεδομένα",
      "set.osave": "Αρχείο orOS (.orosnewsletter)", "set.oopen": "Άνοιγμα αρχείου orOS…", "set.ofolder": "Αποσυμπιεσμένος φάκελος orOS…",
      "set.oText": "Λίστες, συνδρομητές, τεύχη και εικόνες σε ένα αρχείο. Οι κωδικοί, τα κλειδιά και η φόρμα του ιστότοπου μένουν σε αυτή τη συσκευή.",
      "set.about": "Σχετικά", "set.aboutText": "Το Ενημερωτικό δελτίο στέλνει ένα email σε κάθε συνδρομητή μέσω του relay του orOS, από τον δικό σου λογαριασμό ή το SMTP ενός παρόχου, όσο το orOS είναι ανοιχτό. Δεν παρακολουθεί τίποτα: δεν μετρά ανοίγματα ή κλικ. Τα αιτήματα εγγραφής, επιβεβαίωσης και διαγραφής είναι email που διαβάζει από τα Εισερχόμενά σου.",
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
      "live.saved": "Αποθηκεύτηκε", "time.now": "μόλις τώρα",
      "seed.hi": "Γεια σου {first|φίλε},"
    }
  };
  if (window.orosI18n) window.orosI18n.table(STRINGS, "newsletter", LANG);

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
      return new Date(ms).toLocaleString(loc(),
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
    x:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    grip:  '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>',
    copy:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>',
    undo:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg>',
    redo:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/></svg>'
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
  function put(coll, rec) { rec.m = stamp(rec.m); if (!data[coll]) data[coll] = []; replaceIn(data[coll], rec); saveNow(); }
  function copy(x) { return JSON.parse(JSON.stringify(x)); }
  function remove(coll, id) {
    var cur = null;
    (data[coll] || []).forEach(function (x) { if (x.id === id) cur = x; });
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
      var sub = x.imp ? [when(x.done), t("iss.imported")]
              : x.st === "sent" ? [when(x.done), p.sent === 1 ? t("iss.sentTo1") : t("iss.sentTo", { n: p.sent })]
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
    if (Sh && Sh.hasWoo()) acts.appendChild(mini(shopT("shop.cust"), Sh.customers));
    if (P && P.has()) acts.appendChild(mini(P.label(), P.open));
    acts.appendChild(mini(t("subs.enrich"), function () { enrichNames(shownSubs); }));
    acts.appendChild(mini(t("subs.export"), exportCsv));
    acts.appendChild(mini(t("subs.clean"), function () { cleanDialog(l.id); }));
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
    shownSubs = rows;
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
  // Fill in missing names from the profile people set for their own
  // e-mail on Gravatar (../enrich.js + ../enrichui.js): only the
  // subscribers shown that have no name; reviewed, one write, Undo.
  var shownSubs = [];
  function enrichNames(subs) {
    var items = subs.filter(function (s) { return !s.name; }).map(function (s) {
      return { id: s.id, name: s.email, rec: { names: [], emails: [s.email], phones: [], sites: [],
        has: { photo: true, birthday: true, job: true, org: true, address: true, name: false } } };
    });
    if (!items.length) { localToast(t("en.none")); return; }
    function go() {
      window.OrosEnrichUI.open({ lang: LANG2, items: items, kinds: ["name"], apply: function (picks) {
        var before = [];
        picks.forEach(function (p) {
          var cur = null;
          data.subs.forEach(function (x) { if (x.id === p.id && !x.del) cur = x; });
          var nm = p.list[0] && String(p.list[0].v).slice(0, 120);
          if (!cur || cur.name || !nm) return;
          before.push(copy(cur));
          var r = copy(cur);
          r.name = nm;
          put("subs", r);
        });
        if (!before.length) return 0;
        renderAll();
        undoToast(t("en.done", { n: before.length }), function () {
          before.forEach(function (b) { restore("subs", b); });
          renderAll();
        });
        return before.length;
      } });
    }
    if (window.OrosEnrichUI) { go(); return; }
    var sc = document.createElement("script");
    sc.src = "../enrichui.js";
    sc.onload = go;
    document.head.appendChild(sc);
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
      acts.appendChild(mini(t("lists.rss") + (rssOf(l.id).length ? " (" + rssOf(l.id).length + ")" : ""), function () { rssListDialog(l.id); }));
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
      var note = el("span", "row-sub", [ch.kind === "mail" ? t("chans.mail") : (t("p." + ch.preset) + " · " + (C.isApi(ch) ? t("ch.viaApi") : ch.host)),
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
    // ready layouts (wave E3), written in the app's language
    dlg.appendChild(el("p", "dlg-h", t("tpl.layouts")));
    ul = el("ul", "plain tpl-list");
    LAYOUTS.forEach(function (k) {
      row(t("lay." + k), function () { createIssue(l, { subj: "", pre: "", fmt: "blocks", blocks: layoutBlocks(k, l), md: "" }); });
    });
    dlg.appendChild(ul);
    if (tpls.length) {
      dlg.appendChild(el("p", "dlg-h", t("tpl.from")));
      ul = el("ul", "plain tpl-list");
      tpls.sort(function (a, b) { return C.fold(a.name) < C.fold(b.name) ? -1 : 1; })
        .forEach(function (tp) { row(tp.name || shownSubj(tp), function () { createIssue(l, tp); }, tp); });
      dlg.appendChild(ul);
    }
    actionsRow(dlg, [], "", null);
    openDialog(dlg);
  }
  // The built-in layouts: the list's own header and footer (or new
  // ones) around blocks to fill in.
  var LAYOUTS = ["weekly", "announce", "offer"];
  function layoutBlocks(k, l) {
    var head = l.hf && l.hf.head ? copy(l.hf.head) : newBlock("head", l);
    var foot = l.hf && l.hf.foot ? copy(l.hf.foot) : newBlock("foot", l);
    var it = function (hd, tx, side, bt) {
      var b = newBlock("imgtxt", l);
      b.hd = t(hd); b.t = t(tx);
      if (side) b.side = "r";
      if (bt) b.bt = t(bt);
      return b;
    };
    var mid;
    if (k === "weekly") {
      mid = [{ k: "h", t: t("lay.w.title"), lv: 1 }, { k: "p", t: t("lay.w.intro") }, { k: "hr" },
             it("lay.w.s1", "lay.w.s1t"), it("lay.w.s2", "lay.w.s2t", true), { k: "hr" },
             { k: "h", t: t("lay.w.links"), lv: 3 }, { k: "list", t: t("lay.w.list") }, { k: "btn", t: t("lay.w.more"), href: "" }];
    } else if (k === "announce") {
      mid = [{ k: "h", t: t("lay.a.title"), lv: 1, al: "center" }, { k: "p", t: t("lay.a.intro") }, newBlock("img", l),
             { k: "p", t: t("lay.a.body") }, { k: "btn", t: t("lay.a.btn"), href: "", al: "center" },
             { k: "quote", t: t("lay.a.quote"), by: t("lay.a.by") }];
    } else {
      mid = [{ k: "h", t: t("lay.o.title"), lv: 1, al: "center" }, { k: "p", t: t("lay.o.intro"), al: "center" },
             it("lay.o.p1", "lay.o.p1t", false, "lay.o.buy"), it("lay.o.p2", "lay.o.p2t", true, "lay.o.buy"),
             { k: "btn", t: t("lay.o.all"), href: "", al: "center", st: "line" }];
    }
    return [head].concat(mid, [foot]);
  }
  function createIssue(l, tpl) {
    var x = C.normIssue(tpl ? { id: C.randomId("i", null), m: 0, list: l.id, subj: tpl.subj, pre: tpl.pre, fmt: tpl.fmt,
                                blocks: copy(tpl.blocks), md: tpl.md, l2: tpl.l2 ? copy(tpl.l2) : null }
      : { id: C.randomId("i", null), m: 0, list: l.id, fmt: "blocks",
          blocks: [].concat(l.hf && l.hf.head ? [copy(l.hf.head)] : [], [{ k: "h", t: "" }, { k: "p", t: t("seed.hi") }],
                            l.hf && l.hf.foot ? [copy(l.hf.foot)] : []) });
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
  // A list's / subscriber's language, each in its own name (e-mails
  // exist in English and Greek).
  var LANG_OWN = [["en", "English"], ["el", "Ελληνικά"]];
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
    subj.addEventListener("input", function () { typed(x); cx.subj = subj.value; $("ed-title").textContent = x.subj || t("ed.new"); touchIssue(x); });
    c1.appendChild(field(t("ed.subj"), subj));
    var pre = inp("text", cx.pre, C.LIM.pre);
    pre.addEventListener("input", function () { typed(x); cx.pre = pre.value; touchIssue(x); });
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
        snap(x);
        cx.fmt = o[0];
        put("issues", x);
        renderEditor();
      });
      seg.appendChild(b);
    });
    var hc = el("div", "card-head");
    hc.appendChild(el("h3", "sec-h", t("ed.content")));
    hc.appendChild(histButtons(x));
    hc.appendChild(seg);
    c2.appendChild(hc);
    if (cx.fmt === "md") {
      var ta = el("textarea", "md-area");
      ta.value = cx.md;
      ta.maxLength = C.LIM.md;
      ta.rows = 16;
      ta.spellcheck = true;
      ta.addEventListener("input", function () { typed(x); cx.md = ta.value; touchIssue(x); });
      c2.appendChild(ta);
      c2.appendChild(el("p", "hint", t("ed.mdHint")));
    } else {
      var box = el("div", "blocks");
      box.id = "blocks";
      c2.appendChild(box);
      renderBlocks(x, box);
      var add = el("div", "acts add-blocks");
      ADD_KINDS.forEach(function (k) {
        add.appendChild(mini("+ " + t("bk." + k), function () { addBlock(x, newBlock(k, l)); }));
      });
      add.appendChild(mini("+ " + t("bk.more") + "\u2026", function () { moreBlocks(x, l); }));
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
  // A new block at the end (a header at the top); a picture block asks
  // for its picture at once.
  function addBlock(x, b) {
    var cx = side(x);
    if (cx.blocks.length >= C.LIM.blocks) { showToast(t("bk.full")); return; }
    snap(x);
    var at = b.k === "head" ? 0 : cx.blocks.length;
    cx.blocks.splice(at, 0, b);
    put("issues", x);
    renderBlocks(x, $("blocks"));
    if ((b.k === "img" || b.k === "imgtxt" || b.k === "gallery") && !(C.picRefs(b)[0] || {}).f) pickImage(x, at);
    else if (b.k === "prod" && !b.items.length && Sh) shopPick(x, at);
    else focusBlock(at);
  }
  // The other block kinds and the saved blocks (wave E3)
  function moreBlocks(x, l) {
    var dlg = makeDialog("nl-more", t("bk.moreTitle"));
    var grid = el("div", "acts add-blocks");
    MORE_KINDS.forEach(function (k) {
      grid.appendChild(mini("+ " + t("bk." + k), function () { dlg.close(); addBlock(x, newBlock(k, l)); }));
    });
    dlg.appendChild(grid);
    dlg.appendChild(el("p", "dlg-h", t("bk.saved")));
    var saved = C.live(data.blks || []).sort(function (a, b) { return C.fold(a.name) < C.fold(b.name) ? -1 : 1; });
    if (!saved.length) dlg.appendChild(el("p", "hint", t("bk.savedNone")));
    var ul = el("ul", "plain tpl-list");
    saved.forEach(function (sb) {
      var li = el("li", "tpl-row");
      var kind = C.knownBlock(sb.b) ? t("bk." + sb.b.k) : t("bk.newer");
      var b = el("button", "row", (sb.name || kind) + " \u00b7 " + kind);
      b.type = "button";
      b.addEventListener("click", function () { dlg.close(); addBlock(x, copy(sb.b)); });
      li.appendChild(b);
      li.appendChild(iconBtn(UI.x, t("bk.savedDel") + ": " + (sb.name || kind), function () {
        var before = remove("blks", sb.id);
        li.remove();
        undoToast(t("toast.deleted"), function () { if (before) restore("blks", before); });
      }));
      ul.appendChild(li);
    });
    dlg.appendChild(ul);
    actionsRow(dlg, [], "", null);
    openDialog(dlg);
  }
  function saveBlock(b) {
    if (C.live(data.blks || []).length >= C.LIM.blks) { showToast(t("bk.savedFull")); return; }
    var dlg = makeDialog("nl-blk", t("bk.save"));
    var first = [b.hd, b.t].filter(function (v) { return typeof v === "string" && v.trim(); })[0];
    var name = inp("text", first ? first.split("\n")[0].slice(0, 60) : t("bk." + b.k), C.LIM.name);
    dlg.appendChild(field(t("bk.saveName"), name));
    actionsRow(dlg, [], t("dlg.save"), function () {
      var nm = name.value.trim();
      name.classList.toggle("bad", !nm);
      if (!nm) return;
      var rec = C.normBlk({ id: C.randomId("b", null), m: 0, name: nm, b: copy(b) });
      if (!rec) return;
      put("blks", rec);
      dlg.close();
      showToast(t("bk.savedDone"));
    });
    openDialog(dlg, name);
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
  // ---------- the block editor (wave E1) ----------
  var ADD_KINDS = ["h", "p", "img", "btn", "list", "quote", "hr", "sp", "cols"];
  // under "More blocks", with the saved blocks (wave E3)
  var MORE_KINDS = ["head", "imgtxt", "gallery", "prod", "video", "cols3", "table", "event", "social", "foot"];
  var SO = window.OrosNewsletterSocial;
  function newBlock(k, l) {
    switch (k) {
      case "head": return { k: "head", f: "", w: 600, h: 200, b: 0, lw: 140, t: l ? l.name : "", sub: "", links: [] };
      case "foot": return { k: "foot", t: "\u00a9 " + new Date().getFullYear() + " " + (l ? (l.fromName || l.name) : ""), items: [], st: "c" };
      case "social": return { k: "social", items: [{ n: "facebook", href: "" }, { n: "instagram", href: "" }], st: "c", sz: 32 };
      case "hr": return { k: "hr" };
      case "sp": return { k: "sp", h: 24 };
      case "cols": return { k: "cols", a: "", b: "" };
      case "img": return { k: "img", f: "", alt: "", href: "", w: 600, h: 400, b: 0 };
      case "quote": return { k: "quote", t: "", by: "" };
      case "list": return { k: "list", t: "" };
      case "btn": return { k: "btn", t: "", href: "" };
      case "imgtxt": return { k: "imgtxt", f: "", w: 600, h: 400, b: 0, alt: "", href: "", hd: "", t: "", bt: "", bh: "" };
      case "cols3": return { k: "cols3", a: "", b: "", c: "" };
      case "gallery": return { k: "gallery", items: [] };
      case "prod": return { k: "prod", items: [], bt: "" };
      case "video": return { k: "video", f: "", w: 600, h: 400, b: 0, url: "", alt: "", t: "" };
      case "table": return { k: "table", rows: [["", ""], ["", ""]], hd: 1 };
      case "event": {
        var d = new Date(Date.now() + 7 * 86400000);
        var day = d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
        return { k: "event", t: "", d: day, tm: "", te: "", loc: "", sub: "", bt: "", bh: "", ics: 1 };
      }
    }
    return { k: k, t: "" };
  }
  // Undo / redo of the issue being edited: snapshots of its written
  // part (both language versions), taken before each change; typing
  // makes one snapshot per pause, not one per letter.
  var hist = { id: "", past: [], future: [], at: 0 };
  var HIST_MAX = 60;
  function contentOf(x) {
    return JSON.stringify({ subj: x.subj, pre: x.pre, fmt: x.fmt, blocks: x.blocks, md: x.md, l2: x.l2 });
  }
  function histFor(x) {
    if (hist.id !== x.id) hist = { id: x.id, past: [], future: [], at: 0 };
    return hist;
  }
  function snap(x) {
    var h = histFor(x), c = contentOf(x);
    if (h.past[h.past.length - 1] !== c) h.past.push(c);
    if (h.past.length > HIST_MAX) h.past.shift();
    h.future = [];
    h.at = Date.now();
    paintHist();
  }
  function typed(x) {
    var h = histFor(x);
    if (Date.now() - h.at > 1200) snap(x);
    h.at = Date.now();
  }
  function stepHist(back) {
    var x = edIssue;
    if (!x || view !== "edit") return false;
    var h = histFor(x), from = back ? h.past : h.future, to = back ? h.future : h.past;
    if (!from.length) return false;
    clearTimeout(saveTimer);
    saveTimer = null;
    to.push(contentOf(x));
    var c = JSON.parse(from.pop());
    ["subj", "pre", "fmt", "blocks", "md", "l2"].forEach(function (k) { x[k] = c[k]; });
    var cur = C.issue(data, x.id);
    if (!cur || cur.st !== "draft") return false;
    put("issues", x);
    h.at = 0;
    renderEditor();
    return true;
  }
  var histBtns = null;
  function histButtons(x) {
    histFor(x);
    var w = el("div", "hist");
    histBtns = [];
    [[true, UI.undo, t("ed.undo")], [false, UI.redo, t("ed.redo")]].forEach(function (a) {
      var b = el("button", "icon-btn sm");
      b.type = "button";
      b.innerHTML = a[1];
      b.title = a[2];
      b.setAttribute("aria-label", a[2]);
      b.addEventListener("click", function () { flushIssue(); stepHist(a[0]); });
      histBtns.push(b);
      w.appendChild(b);
    });
    paintHist();
    return w;
  }
  function paintHist() {
    if (!histBtns) return;
    histBtns[0].disabled = !hist.past.length;
    histBtns[1].disabled = !hist.future.length;
  }
  function focusBlock(i) {
    var card = $("blocks") && $("blocks").children[i];
    var f = card && card.querySelector("input:not([type=color]):not([type=checkbox]),textarea");
    if (f) { f.focus(); card.scrollIntoView({ block: "nearest" }); }
  }
  function moveBlock(x, from, to) {
    var cx = side(x);
    if (to < 0 || to >= cx.blocks.length || to === from) return;
    snap(x);
    var b = cx.blocks.splice(from, 1)[0];
    cx.blocks.splice(to, 0, b);
    put("issues", x);
    renderBlocks(x, $("blocks"));
    var h = $("blocks").children[to] && $("blocks").children[to].querySelector(".blk-drag");
    if (h) h.focus();
    $("live").textContent = t("bk.moved", { n: to + 1 });
  }
  // Drag by the handle (mouse, pen or finger); the arrow keys move a
  // block too while the handle has focus.
  function wireDrag(x, box, handle, i) {
    handle.addEventListener("keydown", function (e) {
      if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); moveBlock(x, i, i + (e.key === "ArrowUp" ? -1 : 1)); }
    });
    handle.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      var cards = Array.prototype.slice.call(box.children), card = cards[i];
      var target = i, startY = e.clientY;
      try { handle.setPointerCapture(e.pointerId); } catch (err) {}
      card.classList.add("dragging");
      var mark = function () {
        cards.forEach(function (c, j) {
          c.classList.toggle("drop-above", j === target && target < i);
          c.classList.toggle("drop-below", j === target && target > i);
        });
      };
      var onMove = function (ev) {
        card.style.transform = "translateY(" + (ev.clientY - startY) + "px)";
        target = i;
        cards.forEach(function (c, j) {
          if (j === i) return;
          var r = c.getBoundingClientRect(), mid = r.top + r.height / 2;
          if (j < i && ev.clientY < mid && j < target) target = j;
          if (j > i && ev.clientY > mid && j > target) target = j;
        });
        mark();
      };
      var onUp = function () {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
        card.classList.remove("dragging");
        card.style.transform = "";
        cards.forEach(function (c) { c.classList.remove("drop-above", "drop-below"); });
        if (target !== i) moveBlock(x, i, target);
      };
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
    });
  }
  function iconBtn(icon, label, fn, on) {
    var ib = el("button", "icon-btn sm");
    ib.type = "button";
    ib.innerHTML = icon;
    ib.title = label;
    ib.setAttribute("aria-label", label);
    ib.disabled = on === false;
    ib.addEventListener("click", fn);
    return ib;
  }
  // a colour that may be "the theme's" (empty): a checkbox + a picker
  function colorPick(label, value, dflt, onSet) {
    var w = el("div", "fld color-opt");
    var lb = el("label", "check");
    var cb = el("input");
    cb.type = "checkbox";
    cb.checked = !!value;
    lb.appendChild(cb);
    lb.appendChild(el("span", "", label));
    var ci = inp("color", value || dflt);
    ci.className = "color-in";
    ci.disabled = !value;
    ci.setAttribute("aria-label", label);
    cb.addEventListener("change", function () { ci.disabled = !cb.checked; onSet(cb.checked ? ci.value : ""); });
    ci.addEventListener("input", function () { if (cb.checked) onSet(ci.value); });
    w.appendChild(lb);
    w.appendChild(ci);
    return w;
  }
  function renderBlocks(x, box) {
    box.innerHTML = "";
    var cx = side(x);
    var l = C.list(data, x.list);
    var accent = (l && l.color) || "#2f6fde";
    var redraw = function () { put("issues", x); renderBlocks(x, box); };
    // up to 4 links under a header
    var linksEditor = function (b, card) {
      (b.links || []).forEach(function (lk, j) {
        var lr = el("div", "link-row");
        var lt = inp("text", lk.t, 60);
        lt.placeholder = t("bk.linkText");
        lt.setAttribute("aria-label", t("bk.linkText"));
        lt.addEventListener("input", function () { typed(x); lk.t = lt.value; touchIssue(x); });
        var lu = inp("url", lk.href, 2000);
        lu.placeholder = "https://…";
        lu.setAttribute("aria-label", t("bk.link"));
        lu.addEventListener("input", function () { typed(x); lk.href = lu.value; touchIssue(x); });
        lr.appendChild(lt); lr.appendChild(lu);
        lr.appendChild(iconBtn(UI.x, t("bk.linkRemove"), function () { snap(x); b.links.splice(j, 1); redraw(); }));
        card.appendChild(lr);
      });
      if ((b.links || []).length < 4) {
        card.appendChild(mini("+ " + t("bk.linkAdd"), function () { snap(x); b.links = (b.links || []).concat([{ t: "", href: "" }]); redraw(); }));
      }
    };
    // social links: one row per network
    var socialEditor = function (b, card) {
      var used = (b.items || []).map(function (it) { return it.n; });
      (b.items || []).forEach(function (it, j) {
        var sr = el("div", "link-row");
        var ns = sel(SO.ORDER.filter(function (n) { return n === it.n || used.indexOf(n) < 0; }).map(function (n) { return [n, SO.NETS[n].name]; }), it.n);
        ns.setAttribute("aria-label", t("bk.network"));
        ns.addEventListener("change", function () { snap(x); it.n = ns.value; redraw(); });
        var nu = inp(it.n === "email" ? "email" : "url", String(it.href || "").replace(/^mailto:/i, ""), 2000);
        nu.placeholder = it.n === "email" ? "name@example.com" : "https://…";
        nu.setAttribute("aria-label", t("bk.link") + ": " + SO.NETS[it.n].name);
        nu.addEventListener("input", function () {
          typed(x);
          var v = nu.value.trim();
          it.href = it.n === "email" && v && !/^mailto:/i.test(v) ? "mailto:" + v : v;
          touchIssue(x);
        });
        sr.appendChild(ns); sr.appendChild(nu);
        sr.appendChild(iconBtn(UI.x, t("bk.netRemove"), function () { snap(x); b.items.splice(j, 1); redraw(); }));
        card.appendChild(sr);
      });
      var free = SO.ORDER.filter(function (n) { return used.indexOf(n) < 0; });
      if (free.length) {
        card.appendChild(mini("+ " + t("bk.netAdd"), function () { snap(x); b.items = (b.items || []).concat([{ n: free[0], href: "" }]); redraw(); }));
      }
    };
    cx.blocks.forEach(function (b, i) {
      var card = el("div", "blk");
      var head = el("div", "blk-head");
      var known = C.knownBlock(b);
      var handle = el("button", "icon-btn sm blk-drag");
      handle.type = "button";
      handle.innerHTML = UI.grip;
      handle.title = t("bk.drag");
      handle.setAttribute("aria-label", t("bk.drag") + ": " + (known ? t("bk." + b.k) : t("bk.newer")));
      wireDrag(x, box, handle, i);
      head.appendChild(handle);
      head.appendChild(el("span", "blk-k", known ? t("bk." + b.k) : t("bk.newer")));
      var setBox = null;
      if (known) {
        var gear = iconBtn(UI.gear, t("bk.settings"), function () {
          var open = setBox.hidden;
          setBox.hidden = !open;
          gear.setAttribute("aria-expanded", open ? "true" : "false");
        });
        gear.setAttribute("aria-expanded", "false");
        head.appendChild(gear);
        head.appendChild(iconBtn(UI.copy, t("bk.dup"), function () {
          if (cx.blocks.length >= C.LIM.blocks) { showToast(t("bk.full")); return; }
          snap(x);
          cx.blocks.splice(i + 1, 0, copy(b));
          put("issues", x);
          renderBlocks(x, box);
          focusBlock(i + 1);
        }));
      }
      head.appendChild(iconBtn(UI.up, t("bk.up"), function () { moveBlock(x, i, i - 1); }, i > 0));
      head.appendChild(iconBtn(UI.down, t("bk.down"), function () { moveBlock(x, i, i + 1); }, i < cx.blocks.length - 1));
      head.appendChild(iconBtn(UI.x, t("bk.remove"), function () {
        snap(x);
        var gone = cx.blocks.splice(i, 1)[0];
        put("issues", x);
        renderBlocks(x, box);
        undoToast(t("toast.deleted"), function () {
          cx.blocks.splice(Math.min(i, cx.blocks.length), 0, gone);
          put("issues", x);
          renderBlocks(x, box);
        });
      }));
      card.appendChild(head);
      if (!known) {
        card.appendChild(el("p", "hint", t("bk.newerHint")));
        box.appendChild(card);
        return;
      }
      var bind = function (ctl, key, obj) {
        ctl.addEventListener("input", function () { typed(x); (obj || b)[key] = ctl.value; touchIssue(x); });
        return ctl;
      };
      // a setting that changes at once (select, checkbox, colour)
      var setNow = function (key, v, obj) {
        snap(x);
        var o = obj || b;
        if (v === "" || v === null || v === undefined) delete o[key]; else o[key] = v;
        touchIssue(x);
      };
      var selCtl = function (opts, value, onSel) {
        var s = sel(opts, String(value));
        s.addEventListener("change", function () { onSel(s.value); });
        return s;
      };
      var row = function () { return el("div", "fld-row"); };
      if (b.k === "h") {
        card.appendChild(bind(inp("text", b.t, 300), "t"));
        var r1 = row();
        r1.appendChild(field(t("bk.level"), selCtl([["1", "H1"], ["2", "H2"], ["3", "H3"]], b.lv || 2, function (v) {
          setNow("lv", v === "2" ? "" : Number(v));
        })));
        card.appendChild(r1);
      } else if (b.k === "p") card.appendChild(bind(area(b.t, 5), "t"));
      else if (b.k === "list") {
        var la = bind(area(b.t, 4), "t");
        la.placeholder = t("bk.listPh");
        card.appendChild(la);
        var r2 = row();
        r2.appendChild(field(t("bk.listKind"), selCtl([["0", t("bk.bullets")], ["1", t("bk.numbers")]], b.ord ? 1 : 0, function (v) {
          setNow("ord", v === "1" ? 1 : "");
        })));
        card.appendChild(r2);
      } else if (b.k === "quote") {
        card.appendChild(bind(area(b.t, 3), "t"));
        card.appendChild(field(t("bk.by"), bind(inp("text", b.by, 200), "by")));
      } else if (b.k === "sp") {
        card.appendChild(field(t("bk.height"), selCtl([8, 16, 24, 32, 48, 64, 96].map(function (n) { return [String(n), n + " px"]; }), b.h || 24,
          function (v) { setNow("h", Number(v)); })));
      } else if (b.k === "hr") {
        var r3 = row();
        r3.appendChild(field(t("bk.lineStyle"), selCtl(C.HR_STYLES.map(function (k) { return [k, t("bk.hr." + k)]; }), b.st || "solid",
          function (v) { setNow("st", v === "solid" ? "" : v); })));
        r3.appendChild(field(t("bk.thick"), selCtl([1, 2, 3, 4, 6, 8].map(function (n) { return [String(n), n + " px"]; }), b.w || 1,
          function (v) { setNow("w", v === "1" ? "" : Number(v)); })));
        r3.appendChild(field(t("bk.width"), selCtl([100, 75, 50, 25].map(function (n) { return [String(n), n + "%"]; }), b.wd || 100,
          function (v) { setNow("wd", v === "100" ? "" : Number(v)); })));
        card.appendChild(r3);
        card.appendChild(colorPick(t("bk.lineColor"), b.c || "", "#999999", function (v) { setNow("c", v); }));
      } else if (b.k === "cols") {
        var r = el("div", "cols-ed");
        r.appendChild(field(t("bk.left"), bind(area(b.a, 4), "a")));
        r.appendChild(field(t("bk.right"), bind(area(b.b, 4), "b")));
        card.appendChild(r);
      } else if (b.k === "btn") {
        card.appendChild(field(t("bk.btnText"), bind(inp("text", b.t, 80), "t")));
        card.appendChild(field(t("bk.link"), bind(inp("url", b.href, 2000), "href")));
        (b.more || []).forEach(function (m, j) {
          var mb = el("div", "btn-more");
          var mh = el("div", "blk-head");
          mh.appendChild(el("span", "blk-k", t("bk.btnN", { n: j + 2 })));
          mh.appendChild(iconBtn(UI.x, t("bk.btnRemove"), function () {
            snap(x);
            b.more.splice(j, 1);
            if (!b.more.length) delete b.more;
            put("issues", x);
            renderBlocks(x, box);
          }));
          mb.appendChild(mh);
          mb.appendChild(field(t("bk.btnText"), bind(inp("text", m.t, 80), "t", m)));
          mb.appendChild(field(t("bk.link"), bind(inp("url", m.href, 2000), "href", m)));
          card.appendChild(mb);
        });
        var r4 = row();
        r4.appendChild(field(t("bk.btnStyle"), selCtl([["fill", t("bk.fill")], ["line", t("bk.outline")]], b.st || "fill",
          function (v) { setNow("st", v === "line" ? "line" : ""); })));
        if (!b.more) {
          var fl = el("label", "check");
          var fc = el("input");
          fc.type = "checkbox";
          fc.checked = b.full === 1;
          fc.addEventListener("change", function () { setNow("full", fc.checked ? 1 : ""); });
          fl.appendChild(fc);
          fl.appendChild(el("span", "", t("bk.full100")));
          r4.appendChild(fl);
        }
        card.appendChild(r4);
        if (!b.more || b.more.length < 2) {
          card.appendChild(mini("+ " + t("bk.btnAdd"), function () {
            snap(x);
            b.more = (b.more || []).concat([{ t: "", href: "" }]);
            delete b.full;
            put("issues", x);
            renderBlocks(x, box);
          }));
        }
      } else if (b.k === "img") {
        var ir = el("div", "img-row");
        var im = el("img", "img-thumb");
        im.alt = "";
        if (b.f) {
          showThumb(b.f, im, ir);
        } else ir.appendChild(el("span", "hint", t("bk.noImg")));
        ir.insertBefore(im, ir.firstChild);
        ir.appendChild(mini(t("bk.pick"), function () { pickImage(x, i); }));
        card.appendChild(ir);
        card.appendChild(field(t("bk.alt"), bind(inp("text", b.alt, 300), "alt")));
        card.appendChild(field(t("bk.link"), bind(inp("url", b.href, 2000), "href")));
      } else if (b.k === "head") {
        var hr = el("div", "img-row");
        var him = el("img", "img-thumb");
        him.alt = "";
        if (b.f) showThumb(b.f, him, hr); else hr.appendChild(el("span", "hint", t("bk.noLogo")));
        hr.insertBefore(him, hr.firstChild);
        hr.appendChild(mini(t("bk.pickLogo"), function () { pickImage(x, i); }));
        if (b.f) hr.appendChild(mini(t("bk.noLogoBtn"), function () { snap(x); b.f = ""; b.b = 0; put("issues", x); renderBlocks(x, box); }));
        card.appendChild(hr);
        if (b.f) {
          card.appendChild(field(t("bk.logoW"), selCtl([80, 100, 120, 140, 180, 240, 300].map(function (n) { return [String(n), n + " px"]; }), b.lw || 140,
            function (v) { setNow("lw", Number(v)); })));
        }
        card.appendChild(field(t("bk.headT"), bind(inp("text", b.t, 120), "t")));
        card.appendChild(field(t("bk.headSub"), bind(inp("text", b.sub, 200), "sub")));
        linksEditor(b, card);
      } else if (b.k === "social") {
        var r6 = row();
        r6.appendChild(field(t("bk.iconStyle"), selCtl(SO.STYLES.map(function (k) { return [k, t("bk.ist." + k)]; }), b.st || "c",
          function (v) { setNow("st", v); })));
        r6.appendChild(field(t("bk.iconSize"), selCtl(SO.SIZES.map(function (n) { return [String(n), n + " px"]; }), b.sz || 32,
          function (v) { setNow("sz", Number(v)); })));
        card.appendChild(r6);
        socialEditor(b, card);
      } else if (b.k === "foot") {
        card.appendChild(bind(area(b.t, 3), "t"));
        card.appendChild(el("p", "hint", t("bk.footHint")));
        card.appendChild(field(t("bk.iconStyle"), selCtl(SO.STYLES.map(function (k) { return [k, t("bk.ist." + k)]; }), b.st || "c",
          function (v) { setNow("st", v); })));
        socialEditor(b, card);
      }
      else if (b.k === "imgtxt") {
        picRow(b, card, function () { pickImage(x, i); }, null);
        card.appendChild(field(t("bk.side"), selCtl([["l", t("bk.sideL")], ["r", t("bk.sideR")]], b.side === "r" ? "r" : "l",
          function (v) { setNow("side", v === "r" ? "r" : ""); })));
        card.appendChild(field(t("bk.alt"), bind(inp("text", b.alt, 300), "alt")));
        card.appendChild(field(t("bk.link"), bind(inp("url", b.href, 2000), "href")));
        card.appendChild(field(t("bk.hd"), bind(inp("text", b.hd, 200), "hd")));
        card.appendChild(bind(area(b.t, 4), "t"));
        var r7 = row();
        r7.appendChild(field(t("bk.btnText"), bind(inp("text", b.bt, 80), "bt")));
        r7.appendChild(field(t("bk.link"), bind(inp("url", b.bh, 2000), "bh")));
        card.appendChild(el("p", "dlg-h", t("bk.evBtn")));
        card.appendChild(r7);
      } else if (b.k === "cols3") {
        var c3 = el("div", "cols-ed cols3-ed");
        ["a", "b", "c"].forEach(function (key, n) { c3.appendChild(field(t("bk.colN", { n: n + 1 }), bind(area(b[key], 4), key))); });
        card.appendChild(c3);
      } else if (b.k === "gallery") {
        card.appendChild(field(t("bk.per"), selCtl([["2", "2"], ["3", "3"]], b.per === 3 ? 3 : 2, function (v) { setNow("per", v === "3" ? 3 : ""); })));
        if (!(b.items || []).length) card.appendChild(el("p", "hint", t("bk.galEmpty")));
        (b.items || []).forEach(function (g, j) {
          var gb = el("div", "btn-more");
          picRow(g, gb, function () { pickImage(x, i, j); }, function () { snap(x); b.items.splice(j, 1); redraw(); }, t("bk.galRemove"));
          var gr = row();
          gr.appendChild(field(t("bk.alt"), bind(inp("text", g.alt, 300), "alt", g)));
          gr.appendChild(field(t("bk.link"), bind(inp("url", g.href, 2000), "href", g)));
          gb.appendChild(gr);
          card.appendChild(gb);
        });
        if ((b.items || []).length < 9) card.appendChild(mini("+ " + t("bk.galAdd"), function () { pickImage(x, i, -1); }));
      } else if (b.k === "prod") {
        // wave E4: products from a connected shop (newsletter/shop.js)
        var pr = row();
        pr.appendChild(field(t("bk.per"), selCtl([["1", "1"], ["2", "2"], ["3", "3"]], b.per === 1 || b.per === 3 ? b.per : 2, function (v) { setNow("per", v === "2" ? "" : +v); })));
        var btIn = bind(inp("text", b.bt, 40), "bt");
        btIn.placeholder = shopT("shop.btPh");
        pr.appendChild(field(shopT("shop.bt"), btIn));
        card.appendChild(pr);
        if (!b.items.length) card.appendChild(el("p", "hint", shopT("shop.noItems")));
        b.items.forEach(function (p, j) {
          var pb = el("div", "btn-more prod-ed");
          picRow(p, pb, function () { pickImage(x, i, j); }, function () {
            snap(x);
            b.items.splice(j, 1);
            if (!b.items.length) { delete b.sh; delete b.acct; delete b.at; }
            redraw();
          }, shopT("shop.remove"));
          pb.appendChild(el("p", "prod-line", p.name + (p.out ? " · " + shopT("shop.out") : p.price >= 0 ? " · " + money(p.price, p.cur) : "")));
          card.appendChild(pb);
        });
        var pa = el("div", "prod-acts");
        if (Sh && b.items.length < Sh.MAX) pa.appendChild(mini("+ " + shopT("shop.btn"), function () { flushIssue(); shopPick(x, i); }));
        if (Sh && b.sh && b.items.length) pa.appendChild(mini(shopT("shop.refresh"), function () { flushIssue(); shopRefresh(x, i); }));
        card.appendChild(pa);
        if (b.sh && b.items.length) card.appendChild(el("p", "hint", b.at ? shopT("shop.at", { t: when(b.at) }) : shopT("shop.never")));
      } else if (b.k === "video") {
        card.appendChild(field(t("bk.videoUrl"), bind(inp("url", b.url, 2000), "url")));
        picRow(b, card, function () { pickImage(x, i); }, b.f ? function () { snap(x); b.f = ""; b.b = 0; redraw(); } : null, t("bk.noImgBtn"));
        card.appendChild(el("p", "hint", t("bk.videoHint")));
        card.appendChild(field(t("bk.videoCap"), bind(inp("text", b.t, 300), "t")));
        if (b.f) card.appendChild(field(t("bk.alt"), bind(inp("text", b.alt, 300), "alt")));
      } else if (b.k === "table") {
        var tw = el("div", "tbl-ed");
        var nc = (b.rows[0] || []).length;
        b.rows.forEach(function (r, ri) {
          var tr = el("div", "tbl-row");
          tr.style.gridTemplateColumns = "repeat(" + Math.max(nc, 1) + ", minmax(0, 1fr))";
          r.forEach(function (c, ci) {
            var ci2 = bind(inp("text", c, 200), ci, r);
            ci2.setAttribute("aria-label", t("bk.cell", { r: ri + 1, c: ci + 1 }));
            if (ri === 0 && b.hd === 1) ci2.classList.add("tbl-h");
            tr.appendChild(ci2);
          });
          tw.appendChild(tr);
        });
        card.appendChild(tw);
        var ta2 = el("div", "acts");
        if (b.rows.length < 20) ta2.appendChild(mini("+ " + t("bk.tblRow"), function () { snap(x); b.rows.push(new Array(nc).join(".").split(".").map(function () { return ""; })); redraw(); }));
        if (nc < 6) ta2.appendChild(mini("+ " + t("bk.tblCol"), function () { snap(x); b.rows.forEach(function (r) { r.push(""); }); redraw(); }));
        if (b.rows.length > 1) ta2.appendChild(mini(t("bk.tblRowDel"), function () { snap(x); b.rows.pop(); redraw(); }));
        if (nc > 1) ta2.appendChild(mini(t("bk.tblColDel"), function () { snap(x); b.rows.forEach(function (r) { r.pop(); }); redraw(); }));
        card.appendChild(ta2);
        var hl = el("label", "check");
        var hc = el("input");
        hc.type = "checkbox";
        hc.checked = b.hd === 1;
        hc.addEventListener("change", function () { setNow("hd", hc.checked ? 1 : ""); redraw(); });
        hl.appendChild(hc);
        hl.appendChild(el("span", "", t("bk.tblHead")));
        card.appendChild(hl);
      } else if (b.k === "event") {
        card.appendChild(field(t("bk.evT"), bind(inp("text", b.t, 200), "t")));
        var r8 = row();
        var dIn = inp("date", b.d, 10);
        dIn.addEventListener("change", function () { setNow("d", dIn.value); });
        r8.appendChild(field(t("bk.evD"), dIn));
        var tmIn = inp("time", b.tm, 5), teIn = inp("time", b.te, 5);
        tmIn.addEventListener("change", function () { setNow("tm", tmIn.value); if (!tmIn.value) { setNow("te", ""); teIn.value = ""; } teIn.disabled = !tmIn.value; });
        teIn.addEventListener("change", function () { setNow("te", teIn.value); });
        teIn.disabled = !b.tm;
        r8.appendChild(field(t("bk.evTm"), tmIn));
        r8.appendChild(field(t("bk.evTe"), teIn));
        card.appendChild(r8);
        card.appendChild(field(t("bk.evLoc"), bind(inp("text", b.loc, 200), "loc")));
        card.appendChild(field(t("bk.evSub"), bind(area(b.sub, 3), "sub")));
        var r9 = row();
        r9.appendChild(field(t("bk.btnText"), bind(inp("text", b.bt, 80), "bt")));
        r9.appendChild(field(t("bk.link"), bind(inp("url", b.bh, 2000), "bh")));
        card.appendChild(el("p", "dlg-h", t("bk.evBtn")));
        card.appendChild(r9);
        var il = el("label", "check");
        var ic = el("input");
        ic.type = "checkbox";
        ic.checked = b.ics === 1;
        ic.addEventListener("change", function () { setNow("ics", ic.checked ? 1 : ""); });
        il.appendChild(ic);
        il.appendChild(el("span", "", t("bk.evIcs")));
        card.appendChild(il);
      }
      if ((b.k === "head" || b.k === "foot") && l) {
        var isDef = l.hf && l.hf[b.k] && JSON.stringify(l.hf[b.k]) === JSON.stringify(C.normBlock(b));
        var defBtn = mini(isDef ? t("bk.isDefault") : t("bk.makeDefault"), function () {
          var cur = C.list(data, l.id);
          if (!cur) return;
          var rec = copy(cur);
          rec.hf = copy(cur.hf || {});
          rec.hf[b.k] = C.normBlock(b);
          put("lists", C.normList(rec));
          l = C.list(data, l.id);
          defBtn.textContent = t("bk.isDefault");
          showToast(t(b.k === "head" ? "bk.defHeadDone" : "bk.defFootDone"));
        });
        card.appendChild(defBtn);
      }
      // alignment, padding, background: any block
      setBox = el("div", "blk-set");
      setBox.hidden = true;
      var r5 = row();
      // header, footer, social icons are centred unless told otherwise
      var alDef = C.alignOf({ k: b.k });
      r5.appendChild(field(t("bk.align"), selCtl(C.ALIGNS.map(function (k) { return [k, t("bk.al." + k)]; }), C.alignOf(b),
        function (v) { setNow("al", v === alDef ? "" : v); })));
      r5.appendChild(field(t("bk.pad"), selCtl([0, 8, 16, 24, 32, 48].map(function (n) { return [String(n), n + " px"]; }), b.pad || 0,
        function (v) { setNow("pad", v === "0" ? "" : Number(v)); })));
      setBox.appendChild(r5);
      setBox.appendChild(colorPick(t("bk.bg"), b.bg || "", accent, function (v) { setNow("bg", v); }));
      setBox.appendChild(mini(t("bk.save"), function () { flushIssue(); saveBlock(b); }));
      card.appendChild(setBox);
      box.appendChild(card);
    });
  }
  // a picture's thumbnail with Choose (and, given onRemove, Remove)
  function picRow(ref, box, onPick, onRemove, removeLabel) {
    var r = el("div", "img-row");
    var im = el("img", "img-thumb");
    im.alt = "";
    r.appendChild(im);
    if (ref.f) showThumb(ref.f, im, r); else r.appendChild(el("span", "hint", t("bk.noImg")));
    r.appendChild(mini(t("bk.pick"), onPick));
    if (onRemove) r.appendChild(iconBtn(UI.x, removeLabel || t("bk.remove"), onRemove));
    box.appendChild(r);
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
    if (x.imp) {
      body.appendChild(el("div", "banner info", t("vw.imported", { t: when(x.done) })));
      var ia = el("div", "acts");
      ia.appendChild(btn(t("ed.preview"), "", function () { previewDialog(x); }));
      ia.appendChild(btn(t("vw.web"), "", function () { saveWebPage(x); }));
      ia.appendChild(btn(t("ed.dup"), "", function () { duplicateIssue(x); }));
      body.appendChild(ia);
      return;
    }
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
    y.m = 0; y.st = "draft"; y.when = 0; y.imp = 0; y.lock = null; y.start = 0; y.done = 0; y.n = 0; y.err = ""; y.fail = {};
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
    var src = l || { name: "", chan: chans[0].id, from: "", fromName: "", reply: "", lang: LANG2, addr: "", why: "", theme: "classic", color: "#2f6fde" };
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
    f.lang = sel(LANG_OWN, src.lang);
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
    // the look beyond theme + colour (wave E1)
    var sty = copy(src.sty || {});
    var r2 = el("div", "fld-row");
    f.font = sel(C.FONTS.map(function (k) { return [k, t("sty.font." + k)]; }), sty.font || "sans");
    r2.appendChild(field(t("sty.font"), f.font));
    f.hs = sel(C.HEAD_SIZES.map(function (k) { return [k, t("sty.hs." + k)]; }), sty.hs || "m");
    r2.appendChild(field(t("sty.hs"), f.hs));
    f.btn = sel(C.BTN_SHAPES.map(function (k) { return [k, t("sty.btn." + k)]; }), sty.btn || "round");
    r2.appendChild(field(t("sty.btn"), f.btn));
    dlg.appendChild(r2);
    var r3 = el("div", "fld-row");
    r3.appendChild(colorPick(t("sty.link"), sty.link || "", src.color, function (v) { sty.link = v; }));
    r3.appendChild(colorPick(t("sty.bg"), sty.bg || "", "#f2f3f5", function (v) { sty.bg = v; }));
    dlg.appendChild(r3);
    var left = [];
    if (l) {
      left.push(btn(t("l.delete"), "danger", function () {
        var n = C.subsOf(data, l.id).length;
        dlg.close();
        confirmDialog(t("l.delete"), t("l.delText", { l: l.name, n: n }), t("dlg.delete"), function () {
          if (l.form) E.formOff(l.id)["catch"](function () {});      // the relay forgets it (best effort)
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
      // start from the stored record, so fields a newer orOS added stay
      var base = l ? copy(l) : {};
      [["id", l ? l.id : C.randomId("l", null)], ["m", l ? l.m : 0], ["name", f.name.value], ["chan", f.chan.value],
       ["from", from], ["fromName", f.fromName.value], ["reply", f.reply.value], ["lang", f.lang.value], ["addr", f.addr.value],
       ["why", f.why.value], ["theme", f.theme.value], ["color", f.color.value], ["salt", l ? l.salt : C.randomId("", null)],
       ["form", l ? l.form : null],
       ["sty", { font: f.font.value, hs: f.hs.value, btn: f.btn.value, link: sty.link, bg: sty.bg }]].forEach(function (kv) { base[kv[0]] = kv[1]; });
      var rec = C.normList(base);
      put("lists", rec);
      prefs.list = rec.id;
      savePrefs();
      dlg.close();
      renderAll();
    });
    openDialog(dlg, f.name);
  }

  // Clean-up of inactive subscribers (core cleanPlan / cleanApply; the
  // shell runner does it once a day on the list's clean-up device).
  function cleanDialog(id) {
    var l = C.list(data, id);
    if (!l) return;
    var c = C.cleanOf(l), dev = E.devState().dev;
    var dlg = makeDialog("nl-clean", t("cl.title"), true);
    dlg.appendChild(el("p", "dlg-text", t("cl.text")));
    var opts = function (days, key) {
      return days.map(function (n) { return [String(n), t(key, { n: n })]; }).concat([["0", t("cl.never")]]);
    };
    var fp = sel(opts(C.CLEAN_PEND, "cl.pendN"), String(c.pend));
    dlg.appendChild(field(t("cl.pend"), fp));
    var fg = sel(opts(C.CLEAN_GONE, "cl.goneN"), String(c.gone));
    dlg.appendChild(field(t("cl.gone"), fg, t("cl.goneHint")));
    var fi = sel(C.CLEAN_IDLE.map(function (n) { return [String(n), t("cl.idleN", { n: n })]; }).concat([["0", t("cl.never")]]), String(c.idle));
    dlg.appendChild(field(t("cl.idle"), fi, t("cl.idleHint")));
    var devP = el("p", "hint");
    dlg.appendChild(devP);
    var here = btn(t("cl.here"), "", function () { c.dev = dev; showDev(); });
    dlg.appendChild(here);
    var now = el("p", "dlg-text");
    dlg.appendChild(now);
    var plan = null;
    var csv = btn(t("cl.csv"), "", function () {
      var only = {};
      plan.pend.concat(plan.gone).forEach(function (s) { only[s.id] = 1; });
      var heads = [t("s.email"), t("s.name"), t("s.lang"), t("s.tags"), t("s.status"), "source", t("s.basis"),
                   t("s.since", { t: "" }).trim(), t("s.conf", { t: "" }).trim(), t("s.left", { t: "" }).trim()];
      saveText(C.subsCsv(data, l.id, heads, function (st) { return t("sst." + st); }, function (b) { return t("basis." + b); }, only),
               "oros-newsletter-" + C.slug(l.name) + "-cleanup.csv", "text/csv", ".csv", "CSV");
    });
    var go = btn(t("cl.go"), "danger", function () {
      var p = plan;
      confirmDialog(t("cl.go"), t("cl.goText", { n: p.n, l: l.name }), t("dlg.delete"), function () {
        dlg.close();
        save();
        var n = C.cleanApply(data, p, Date.now());
        saveNow();
        renderAll();
        showToast(t("cl.done", { n: n.pend + n.gone }));
      }, true);
    });
    var row = el("div", "fld-row");
    row.appendChild(csv);
    row.appendChild(go);
    dlg.appendChild(row);
    function set() { return { pend: +fp.value, gone: +fg.value, idle: +fi.value }; }
    function showDev() {
      devP.textContent = t(c.dev === dev ? "cl.devHere" : c.dev ? "cl.devOther" : "cl.devNone");
      here.hidden = c.dev === dev;
    }
    function preview() {
      plan = C.cleanPlan(data, l.id, Date.now(), set());
      var asks = C.idleCount(data, l.id, Date.now(), +fi.value);
      now.textContent = (plan.n ? t("cl.now", { p: plan.pend.length, g: plan.gone.length }) + (plan.ok ? "" : " " + t("cl.wait", { max: C.CLEAN_MAX }))
                                : t("cl.nobody")) + (asks ? " " + t("cl.idleNow", { n: asks }) : "");
      csv.disabled = go.disabled = !plan.n;
    }
    // the settings onto the stored record (fields a newer orOS added stay)
    function save() {
      var cur = C.list(data, l.id);
      if (!cur) return;
      var base = copy(cur), v = set();
      base.clnPend = v.pend; base.clnGone = v.gone; base.clnIdle = v.idle;
      if (c.dev) base.clnDev = c.dev;
      var rec = C.normList(base);
      if (JSON.stringify(rec) !== JSON.stringify(C.normList(cur))) put("lists", rec);
    }
    fp.addEventListener("change", preview);
    fg.addEventListener("change", preview);
    fi.addEventListener("change", preview);
    showDev();
    preview();
    actionsRow(dlg, [], t("dlg.save"), function () { save(); dlg.close(); renderAll(); });
    openDialog(dlg, fp);
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
    dlg.appendChild(formCard(l, dlg));
    actionsRow(dlg, [], "", null);
    openDialog(dlg);
  }
  // The web sign-up form (kept by the relay until orOS collects it).
  function formCard(l, dlg) {
    var c = el("div", "card form-card");
    c.appendChild(el("h3", "sec-h", t("fm.title")));
    var busyBtn = function (b, p) {
      b.disabled = true;
      return p.then(function (r) { b.disabled = false; return r; }, function (e) {
        b.disabled = false;
        showToast(e && e.code === "nostore" ? t("fm.nostore") : t("fm.fail", { e: errText(e) }));
        throw e;
      });
    };
    var reopen = function () { dlg.close(); data = E.read(); renderAll(); linkDialog(l.id); };
    if (!l.form) {
      c.appendChild(el("p", "dlg-text", t("fm.text")));
      var a = el("div", "acts");
      var on = btn(t("fm.on"), "primary", function () {
        busyBtn(on, E.formOn(l.id, "")).then(function () { showToast(t("fm.ready")); reopen(); }, function () {});
      });
      a.appendChild(on);
      c.appendChild(a);
      return c;
    }
    var html = C.formHtml(l, E.relayUrl(), { email: t("fm.email"), name: t("fm.name"), btn: t("lk.btn") });
    var ta = area(html, 7);
    ta.readOnly = true;
    var w = field(t("fm.html"), ta, t("fm.htmlHint"));
    w.appendChild(mini(t("lk.copy"), function () {
      var done = function () { showToast(t("lk.copied")); };
      try { navigator.clipboard.writeText(html).then(done, function () { ta.select(); }); } catch (e) { ta.select(); }
    }));
    c.appendChild(w);
    var back = inp("url", l.form.back, 300);
    back.placeholder = "https://…";
    var bw = field(t("fm.back"), back, t("fm.backHint"));
    var save = mini(t("dlg.save"), function () {
      var v = back.value.trim();
      if (v && !/^https:\/\/[^\s]+$/i.test(v)) { back.classList.add("bad"); showToast(t("fm.badBack")); return; }
      busyBtn(save, E.formOn(l.id, v)).then(function () { showToast(t("fm.saved")); reopen(); }, function () {});
    });
    bw.appendChild(save);
    c.appendChild(bw);
    var here = !l.form.dev || l.form.dev === E.devState().dev;
    c.appendChild(el("p", "hint", here ? t("fm.here") : t("fm.there")));
    var acts = el("div", "acts");
    if (!here) acts.appendChild(btn(t("fm.collectHere"), "", function () { E.formHere(l.id); reopen(); }));
    var off = btn(t("fm.off"), "danger", function () {
      confirmDialog(t("fm.off"), t("fm.offText"), t("fm.off"), function () {
        busyBtn(off, E.formOff(l.id)).then(reopen, function () {});
      }, true);
    });
    acts.appendChild(off);
    c.appendChild(acts);
    return c;
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
    // a provider's HTTP API instead of SMTP (phase 3C)
    f.via = sel([["smtp", t("ch.viaSmtp")], ["api", t("ch.viaApi")]], src.via || "smtp");
    var viaF = field(t("ch.via"), f.via, t("ch.viaHint"));
    smtpBox.appendChild(viaF);
    f.dom = inp("text", src.dom || "", 253);
    f.dom.autocapitalize = "off";
    f.dom.spellcheck = false;
    f.dom.placeholder = "mg.example.com";
    var domF = field(t("ch.dom"), f.dom, t("ch.domHint"));
    smtpBox.appendChild(domF);
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
    var userF = field(t("ch.user"), f.user);
    smtpBox.appendChild(userF);
    f.pass = inp("password", "", 512);
    f.pass.autocomplete = "new-password";
    var passF = field(t("ch.pass"), f.pass, t("ch.passHint"));
    var passLbl = passF.querySelector(".dlg-lbl");
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
      var canApi = !!C.API_PROVS[f.preset.value], api = canApi && f.via.value === "api";
      viaF.hidden = !canApi;
      domF.hidden = !api || !/^mailgun/.test(f.preset.value);
      r1.hidden = api;
      userF.hidden = api;
      passLbl.textContent = api ? t("ch.key") : t("ch.pass");
    };
    f.via.addEventListener("change", sync);
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
      sync();
    });
    sync();
    var collect = function () {
      var kind = f.kind.value;
      var rec = C.normChan({
        id: ch ? ch.id : C.randomId("c", null), m: ch ? ch.m : 0, kind: kind, acct: f.acct ? f.acct.value : "",
        preset: f.preset.value, host: f.host.value, port: +f.port.value, user: f.user.value, inbox: f.inbox.value,
        via: f.via.value, dom: f.dom.value,
        rate: Math.round(+f.rate.value), cap: Math.round(+f.cap.value), name: ""
      });
      if (kind === "mail" && !rec.acct) return null;
      if (C.isApi(rec)) {
        var needDom = /^mailgun/.test(rec.preset);
        f.dom.classList.toggle("bad", needDom && !rec.dom);
        if (needDom && !rec.dom) return null;
        // the SMTP fields stay as they were (switching back keeps them)
        if (!rec.host) rec.host = (C.PRESETS[rec.preset] || {}).host || "";
      } else if (kind === "smtp") {
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
      withPass(rec).then(function () {
        if (C.isApi(rec)) return E.apiCheck(rec);
        return sendCreds(rec).then(function (cr) { return relay({ op: "smtpcheck", acct: cr.acct, smtp: cr.smtp }); });
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
    f.lang = sel([["", t("s.langAny")]].concat(LANG_OWN), s ? s.lang : "");
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
    var n = 0;
    C.picsOf(R.blocksOf(x).concat(x.l2 ? R.blocksOf(x.l2) : [])).forEach(function (q) { n += q.b || 2500; });   // an icon ≈ 2.5 KB
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
  function sendingHere() { var k = sendState().k; return !runner && (k === "issue" || k === "inv" || k === "ask"); }
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
        else if (kind === "invfail" || kind === "askfail") showToast(errStored(info.err));
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
    else if (s.k === "ask") txt = t("bar.ask", { n: s.left });
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
  // j: a gallery's picture (none or past the end: a new one)
  function pickImage(x, i, j) {
    var fs = orosFS(), onL2 = side(x) !== x;
    if (!fs) { showToast(t("toast.noDisk")); return; }
    var host = dialogHost(), acc = "image/png,image/jpeg,image/webp,image/gif";
    var pick = host && typeof host.openFile === "function" ? host.openFile(acc) : localPickFile(acc);
    pick.then(function (file) {
      if (!file) return;
      return storeImage(file).then(function (r) {
        var cur = C.issue(data, x.id), cb = cur && (onL2 ? cur.l2 : cur), xb = onL2 ? x.l2 : x;
        var blk = xb && xb.blocks[i];
        if (!cb || !blk || !cb.blocks[i] || cb.blocks[i].k !== blk.k || !(C.picRefs(blk).length || blk.k === "gallery")) return;
        var ref = blk;
        if (blk.k === "gallery" || blk.k === "prod") {
          if (typeof j === "number" && j >= 0 && j < blk.items.length) ref = blk.items[j];
          else if (blk.k === "gallery" && blk.items.length < 9) { ref = { alt: "", href: "" }; blk.items.push(ref); }
          else return;
        }
        ref.f = r.path; ref.w = r.w; ref.h = r.h; ref.b = r.b;
        put("issues", x);
        if (view === "edit") renderBlocks(x, $("blocks"));
      });
    })["catch"](function () { showToast(t("toast.imgBad")); });
  }
  // A picture (a picked file or a shop's product picture) shrunk and
  // stored with the issues' pictures → { path, w, h, b }
  function storeImage(blob) {
    var fs = orosFS();
    if (!fs) return Promise.reject(new Error("nodisk"));
    return shrink(blob).then(function (r) {
      var path = "/internal/Newsletter/img-" + C.randomId("", null) + ".jpg";
      return fs.write(path, r.blob).then(function () { return { path: path, w: r.w, h: r.h, b: r.blob.size }; });
    });
  }
  // ---------- products from a shop (wave E4, newsletter/shop.js) ----------
  var Sh = window.OrosNewsletterShop || null;
  function shopT(k, p) { return Sh ? Sh.t(k, p) : k; }
  function money(c, cur) {
    if (!(c >= 0)) return "";
    try { return new Intl.NumberFormat(loc(), { style: "currency", currency: cur || "EUR" }).format(c / 100); }
    catch (e) { return (c / 100).toFixed(2) + " " + (cur || ""); }
  }
  // the product block at index i of the version being edited, if it is still there
  function liveProd(x, i) {
    var cx = side(x), b = cx && cx.blocks[i];
    return C.issue(data, x.id) && b && b.k === "prod" ? b : null;
  }
  function shopPick(x, i) {
    var b = liveProd(x, i);
    if (!b || !Sh) return;
    Sh.pick(b, function (items, sh, acct) {
      var cur = liveProd(x, i);
      if (!cur || !items.length) return;
      snap(x);
      if (!cur.items.length || cur.acct !== acct) cur.items = [];
      cur.items = cur.items.concat(items).slice(0, Sh.MAX);
      cur.sh = sh; cur.acct = acct; cur.at = Date.now();
      put("issues", x);
      if (view === "edit") renderBlocks(x, $("blocks"));
    });
  }
  function shopRefresh(x, i) {
    var b = liveProd(x, i);
    if (!b || !Sh) return;
    Sh.refresh(b, function (items) {
      var cur = liveProd(x, i);
      if (!cur || cur.acct !== b.acct) return;
      snap(x);
      // a product removed meanwhile stays removed: only the ones still here change
      var byId = {};
      items.forEach(function (p) { byId[p.id] = p; });
      cur.items = cur.items.map(function (p) { return p.id && byId[p.id] ? byId[p.id] : p; });
      cur.at = Date.now();
      put("issues", x);
      if (view === "edit") renderBlocks(x, $("blocks"));
    });
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
    var host = dialogHost(), acc = ".csv,.zip,text/csv,text/plain,application/zip";
    var pick = host && typeof host.openFile === "function" ? host.openFile(acc) : localPickFile(acc);
    pick.then(function (file) {
      if (!file) return;
      // a Substack / Buttondown export first (import2.js), else a plain CSV
      return tryImport2(file, "subs").then(function (done) {
        if (done) return;
        if (file.size > 5 * 1024 * 1024 || /\.zip$/i.test(file.name || "")) { showToast(t("toast.noCsv")); return; }
        return file.text().then(function (text) {
          var r = C.peopleFromRows(C.parseCsv(text));
          importDialog(r.people, r.bad, "csv", "consent");
        });
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

  // ---------- 15a. orOS file (.orosnewsletter, ../recordpkg.js + package.js) ----------
  // Every list, subscriber, issue, segment, template, RSS feed and
  // sending account as one orOS file, the pictures in media/ by
  // <sha256>.jpg|png. Passwords, API keys, the web form's keys, the
  // lists' salts (the unsubscribe and confirm codes), SMTP user names,
  // the sending progress and the email-platform links never go in it.
  // Opening ADDS what this device lacks, with its ids; a record already
  // here (or deleted here) is kept as it is unless "Update with newer
  // versions" is ticked. The result goes through saveNow (merge-on-write
  // + the sync mark); Undo deletes the added records the way
  // import2Undo does (tombstones, so the deletion syncs).
  var RP = window.OrosRecordPkg || null, NPK = window.OrosNewsletterPackage || null;
  var IMG_IN_MAX = 20 * 1024 * 1024;     // a picture in a file larger than this is skipped
  var fileAdded = null, fileWrote = [];
  // One picture of the file → /internal/Newsletter/, only when that
  // path is not on the disk yet, through the picker's own checks
  // (shrink: re-drawn as a JPEG, at most 1200 px wide).
  // → Promise<"there" | "none" | "bad" | { f, w, h, b }>
  function storeImg(path, key, media, memo) {
    if (memo[path]) return memo[path];
    var fs = orosFS();
    memo[path] = Promise.resolve().then(function () { return fs.readBlob(path); })
      .then(function (b) { return !!(b && b.size); }, function () { return false; })
      .then(function (there) {
        if (there) return "there";
        var item = key && Object.prototype.hasOwnProperty.call(media, key) ? media[key] : null;
        if (!item || !(item.blob || item.bytes)) return "none";
        if (!/^image\/(jpeg|png)$/.test(item.type || "")) return "bad";
        var blob = item.blob ? item.blob.slice(0, item.blob.size, item.type) : new Blob([item.bytes], { type: item.type });
        if (blob.size > IMG_IN_MAX) return "bad";
        return shrink(blob).then(function (r) {
          var p = /\.jpg$/.test(path) ? path : "/internal/Newsletter/img-" + C.randomId("", null) + ".jpg";
          return Promise.resolve(fs.write(p, r.blob)).then(function () {
            fileWrote.push(p);
            return { f: p, w: r.w, h: r.h, b: r.blob.size };
          }, function () { return "none"; });
        }, function () { return "bad"; });
      })["catch"](function () { return "bad"; });
    return memo[path];
  }
  var recFile = RP && NPK && window.OrosBundle ? RP.ui(NPK.DESC, {
    lang: function () { return LANG2; },
    get: function () { return C.normalize(data); },
    title: function () { return t("app"); },
    // media/: every picture the issues and templates name, read from
    // the orOS disk; state.imgs = { "<path>": "<media key>" } goes into
    // content.json
    files: function (state) {
      var fs = orosFS(), B = window.OrosBundle, out = [], imgs = {}, chain = Promise.resolve();
      if (!fs) return out;
      NPK.imgPaths(state).forEach(function (p) {
        chain = chain.then(function () {
          return Promise.resolve(fs.readBlob(p)).then(function (blob) {
            if (!blob || !blob.size) return;
            return B.digest(blob).then(function (dg) {
              var ext = p.slice(-3), key = dg.sha + "." + ext;
              imgs[p] = key;
              if (!out.some(function (f) { return f.key === key; })) out.push({ key: key, blob: blob, type: ext === "png" ? "image/png" : "image/jpeg" });
            });
          })["catch"](function () {});
        });
      });
      return chain.then(function () { state.imgs = imgs; return out; });
    },
    // the pictures of the issues and templates this open adds (or
    // updates); a picture whose bytes fail the checks leaves its block
    // empty; one the file has no bytes for keeps its path ("missing")
    media: function (read, res) {
      var fs = orosFS(), next = res.next, src = read && read.content && read.content.data;
      var imgs = NPK.normImgs(src && src.imgs), media = (read && read.media) || {}, memo = {}, ids = {};
      var chain = Promise.resolve();
      fileWrote = [];
      if (!fs) return Promise.resolve(next);
      res.addedIds.concat(res.updatedIds).forEach(function (id) { ids[id] = 1; });
      function fix(blocks) {
        (Array.isArray(blocks) ? blocks : []).forEach(function (b) {
          C.picRefs(b).forEach(function (q) {
            if (!q.f) return;
            chain = chain.then(function () { return storeImg(q.f, imgs[q.f] || "", media, memo); }).then(function (r) {
              if (r === "bad") q.f = "";
              else if (r && typeof r === "object") { q.f = r.f; q.w = r.w; q.h = r.h; q.b = r.b; }
            });
          });
        });
      }
      (next.issues || []).concat(next.tpls || []).forEach(function (x) {
        if (!x || x.del || !ids[x.id]) return;
        fix(x.blocks);
        if (x.l2) fix(x.l2.blocks);
      });
      (next.blks || []).forEach(function (x) { if (x && !x.del && ids[x.id] && x.b) fix([x.b]); });
      (next.lists || []).forEach(function (x) { if (x && !x.del && ids[x.id] && x.hf && x.hf.head) fix([x.hf.head]); });
      return chain.then(function () { return next; });
    },
    set: function (next, info) {
      if (!next || typeof next !== "object" || !Array.isArray(next.subs)) return;
      flushIssue();
      var n = copy(next), added = {}, upd = {}, got = [], supp = {};
      (info && info.addedIds || []).forEach(function (id) { added[id] = 1; });
      (info && info.updatedIds || []).forEach(function (id) { upd[id] = 1; });
      // a list from a file gets a new salt of its own (new unsubscribe
      // and confirm codes) and no web form; a list or account updated
      // from a file keeps this device's salt, form and SMTP user
      (n.lists || []).forEach(function (l) {
        var o = C.list(data, l.id);
        if (added[l.id]) { l.salt = C.randomId("", null); l.form = null; }
        else if (upd[l.id] && o) { l.salt = o.salt; l.form = o.form; }
      });
      (n.chans || []).forEach(function (ch) {
        var o = C.chan(data, ch.id);
        if (upd[ch.id] && o) ch.user = o.user;
      });
      // an address deleted for good here stays out; the app's limits hold
      (data.supp || []).forEach(function (h) { supp[h] = 1; });
      NPK.COLLS.forEach(function (k) {
        var room = (C.LIM[k] || 0) - C.live(data[k]).length;
        n[k] = (n[k] || []).filter(function (x) {
          if (!x || !added[x.id] || x.del) return true;
          if (k === "subs" && supp[C.suppHash(x.email)]) return false;
          if (room <= 0) return false;
          room--;
          got.push(x.id);
          return true;
        });
      });
      fileAdded = got;
      data = n;
      saveNow();
      renderAll();
    },
    // Undo: the added records become tombstones (so the deletion
    // syncs); pictures written for them leave the disk when nothing
    // names them any more
    deleteIds: function (ids) {
      var mine = {}, wrote = fileWrote.slice(), any = false;
      (fileAdded || []).forEach(function (id) { mine[id] = 1; });
      fileAdded = null;
      fileWrote = [];
      flushIssue();
      ids.forEach(function (id) {
        var k = mine[id] ? NPK.kindOf(id, data) : "", cur = null;
        if (!k) return;
        data[k].forEach(function (x) { if (x.id === id) cur = x; });
        if (!cur || cur.del) return;
        replaceIn(data[k], { id: id, m: stamp(cur.m), del: 1 });
        any = true;
      });
      if (!any) return;
      saveNow();
      renderAll();
      var fs = orosFS(), still = {};
      NPK.imgPaths(data).forEach(function (p) { still[p] = 1; });
      if (fs && typeof fs.rm === "function") wrote.forEach(function (p) {
        if (!still[p]) Promise.resolve().then(function () { return fs.rm(p); })["catch"](function () {});
      });
    },
    toast: function (text, undo) { if (undo) undoToast(text, undo); else showToast(text); }
  }) : null;

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

  // ---------- 15b. RSS to e-mail ----------
  // A feed (usually one of the Reader's) becomes an issue on a schedule:
  // the shell checks it while orOS is open on the device that set it up.
  function readerFeeds() {
    try {
      var d = JSON.parse(localStorage.getItem("oros-feeds-data") || "null");
      var tombs = d && d.tombs || {};
      return (d && Array.isArray(d.feeds) ? d.feeds : []).filter(function (f) {
        return f && typeof f.url === "string" && /^https?:\/\//.test(f.url) && !(tombs[f.id] >= f.m);
      }).map(function (f) { return { url: f.url, title: C.oneLine(f.title || f.url, 120) }; })
        .sort(function (a, b) { return C.fold(a.title) < C.fold(b.title) ? -1 : 1; });
    } catch (e) { return []; }
  }
  function rssOf(listId) { return C.live(data.rss).filter(function (r) { return r.list === listId; }); }
  var WDS = [1, 2, 3, 4, 5, 6, 0];
  function rssWhen(r) {
    var parts = [r.every === "day" ? t("rss.day") : r.every === "month" ? t("rss.month") : t("rss.week") + " · " + t("wd." + r.wd),
                 ("0" + r.hour).slice(-2) + ":00", r.mode === "send" ? t("rss.sendShort") : t("rss.draftShort")];
    if (!r.on) parts.push(t("rss.off"));
    else if (r.dev && r.dev !== E.devState().dev) parts.push(t("rss.otherDev"));
    else parts.push(t("rss.next", { t: when(C.rssNext(r, r.ran || r.m)) }));
    return parts.join(" · ");
  }
  function rssListDialog(listId) {
    var dlg = makeDialog("nl-rss-list", t("rss.title"), true);
    var all = rssOf(listId);
    dlg.appendChild(el("p", "hint", all.length ? t("rss.hint") : t("rss.none")));
    var ul = el("ul", "plain tpl-list");
    all.forEach(function (r) {
      var li = el("li", "tpl-row");
      var b = el("button", "row");
      b.type = "button";
      var tx = el("span", "row-txt");
      tx.appendChild(el("span", "row-no", r.name || r.url.replace(/^https?:\/\//, "")));
      tx.appendChild(el("span", "row-sub", rssWhen(r)));
      b.appendChild(tx);
      b.addEventListener("click", function () { dlg.close(); rssDialog(listId, r); });
      li.appendChild(b);
      ul.appendChild(li);
    });
    dlg.appendChild(ul);
    actionsRow(dlg, [], t("rss.add"), function () {
      if (C.live(data.rss).length >= C.LIM.rss) { showToast(t("rss.full")); return; }
      dlg.close();
      rssDialog(listId, null);
    });
    openDialog(dlg);
  }
  function rssDialog(listId, r0) {
    var now = Date.now();
    var src = r0 ? copy(r0) : { id: C.randomId("r", null), m: 0, list: listId, url: "", name: "", every: "week", wd: 1, hour: 9,
                                mode: "draft", max: 10, seg: "", last: 0, ran: now, dev: E.devState().dev, on: 1 };
    var dlg = makeDialog("nl-rss", t("rss.edit"), true);
    var feeds = readerFeeds();
    var f = {};
    var opts = feeds.map(function (x) { return [x.url, x.title]; });
    var known = feeds.some(function (x) { return x.url === src.url; });
    opts.push(["", t("rss.other")]);
    f.src = sel(opts, known ? src.url : (feeds.length && !src.url ? feeds[0].url : ""));
    dlg.appendChild(field(t("rss.src"), f.src, feeds.length ? "" : t("rss.noReader")));
    f.url = inp("url", known ? "" : src.url, 2000);
    f.url.placeholder = "https://…";
    var urlF = field(t("rss.url"), f.url);
    dlg.appendChild(urlF);
    f.name = inp("text", src.name, C.LIM.name);
    dlg.appendChild(field(t("rss.name"), f.name));
    f.every = sel([["day", t("rss.day")], ["week", t("rss.week")], ["month", t("rss.month")]], src.every);
    dlg.appendChild(field(t("rss.every"), f.every));
    f.wd = sel(WDS.map(function (d) { return [String(d), t("wd." + d)]; }), String(src.wd));
    var wdF = field(t("rss.wd"), f.wd);
    dlg.appendChild(wdF);
    var hours = [];
    for (var h = 0; h < 24; h++) hours.push([String(h), ("0" + h).slice(-2) + ":00"]);
    f.hour = sel(hours, String(src.hour));
    dlg.appendChild(field(t("rss.hour"), f.hour));
    f.mode = sel([["draft", t("rss.draft")], ["send", t("rss.send")]], src.mode);
    var modeHint = el("p", "hint", "");
    var modeF = field(t("rss.mode"), f.mode);
    modeF.appendChild(modeHint);
    dlg.appendChild(modeF);
    f.seg = sel([["", t("aud.all")]].concat(C.segsOf(data, listId).map(function (g) { return [g.id, t("aud.seg", { n: g.name || t("seg.unnamed") })]; })), src.seg);
    dlg.appendChild(field(t("rss.aud"), f.seg));
    f.max = inp("number", src.max, 2);
    f.max.min = 1; f.max.max = 20;
    dlg.appendChild(field(t("rss.max"), f.max));
    var onL = el("label", "check");
    f.on = el("input");
    f.on.type = "checkbox";
    f.on.checked = !!src.on;
    onL.appendChild(f.on);
    onL.appendChild(el("span", "", t("rss.on")));
    dlg.appendChild(onL);
    dlg.appendChild(el("p", "hint", t("rss.hint")));
    function sync() {
      urlF.hidden = !!f.src.value;
      wdF.hidden = f.every.value !== "week";
      modeHint.textContent = f.mode.value === "send" ? t("rss.sendHint") : "";
    }
    [f.src, f.every, f.mode].forEach(function (s) { s.addEventListener("change", sync); });
    sync();
    function collect() {
      var url = f.src.value || f.url.value.trim();
      if (url && !/^[a-z]+:/i.test(url)) url = "https://" + url;
      var rec = copy(src);
      rec.url = url;
      rec.name = f.name.value || (f.src.value ? f.src.options[f.src.selectedIndex].textContent : "");
      rec.every = f.every.value; rec.wd = +f.wd.value; rec.hour = +f.hour.value;
      rec.mode = f.mode.value; rec.seg = f.seg.value; rec.max = +f.max.value || 10; rec.on = f.on.checked ? 1 : 0;
      if (!rec.dev) rec.dev = E.devState().dev;
      var n = C.normRss(rec);
      f.url.classList.toggle("bad", !n);
      if (!n) showToast(t("rss.badUrl"));
      return n;
    }
    var left = [btn(t("rss.now"), "", function () {
      var rec = collect();
      if (!rec) return;
      put("rss", rec);
      dlg.close();
      rssNow(rec);
    })];
    if (r0) {
      left.unshift(btn(t("ed.delete"), "danger", function () {
        var before = remove("rss", r0.id);
        dlg.close();
        renderAll();
        undoToast(t("toast.deleted"), function () { if (before) restore("rss", before); renderAll(); });
      }));
    }
    actionsRow(dlg, left, t("dlg.save"), function () {
      var rec = collect();
      if (!rec) return;
      put("rss", rec);
      dlg.close();
      renderAll();
    });
    openDialog(dlg, f.src);
  }
  // Fetch, parse with the Reader's own code, and use the shell's fetch
  // when there is one (the same way the scheduled runs read it).
  function fetchItems(url) {
    if (runner && typeof runner.fetchItems === "function") return runner.fetchItems(url);
    var F = window.orosFeedsFetch, FC = window.orosFeedsCore;
    if (!F || !FC) return Promise.reject({ code: "nofeed" });
    return F.fetchOne(url, { accept: "application/rss+xml, application/atom+xml, application/feed+json, application/xml;q=0.9, */*;q=0.8" })
      .then(function (r) {
        var fd = r.status >= 200 && r.status < 300 ? FC.parseFeed(r.text, r.finalUrl || url, Date.now()) : null;
        if (!fd) throw { code: "nofeed" };
        return fd.items;
      });
  }
  function rssNow(r) {
    showToast(t("rss.reading"));
    fetchItems(r.url).then(function (items) {
      var res = E.issueFromFeed(r.id, items, true);
      if (!res) { showToast(t("rss.nothing")); return; }
      dirty();
      data = E.read();
      viewId = res.issue.id;
      showView("edit");
      showToast(t("rss.made"));
    }, function (e) { showToast(t("rss.fail", { e: errText(e) })); });
  }

  // ---------- 15c. Past issues from other services ----------
  function importArchive() {
    var host = dialogHost(), acc = ".zip,.md,.markdown,.txt,.html,.htm,.csv,.json,application/zip,text/plain,text/html,text/csv,application/json";
    var pick = host && typeof host.openFile === "function" ? host.openFile(acc) : localPickFile(acc);
    pick.then(function (file) {
      if (!file) return;
      if (file.size > 60 * 1024 * 1024) throw new Error("big");
      return tryImport2(file, "issues").then(function (done) { return done ? null : readArchive(file); });
    }).then(function (items) {
      if (items) archiveDialog(items);
    })["catch"](function () { showToast(t("arc.bad")); });
  }
  function readArchive(file) {
    var A = window.OrosNewsletterArchive;
    if (/\.zip$/i.test(file.name)) {
      return file.arrayBuffer().then(function (buf) {
        var z = window.AtelierZip.open(new Uint8Array(buf));
        var names = z.names.filter(A.supported).slice(0, 2000);
        var items = [];
        return names.reduce(function (p, n) {
          return p.then(function () { return z.text(n, 5 * 1024 * 1024); }).then(function (txt) {
            items = items.concat(A.parseFile(n, txt));
          }, function () {});
        }, Promise.resolve()).then(function () { return items; });
      });
    }
    if (!A.supported(file.name) || file.size > 5 * 1024 * 1024) throw new Error("type");
    return file.text().then(function (txt) { return A.parseFile(file.name, txt); });
  }
  function archiveDialog(items) {
    var dlg = makeDialog("nl-archive", t("arc.title"), true);
    if (!items.length) {
      dlg.appendChild(el("p", "dlg-text", t("arc.none")));
      actionsRow(dlg, [], "", null);
      openDialog(dlg);
      return;
    }
    var lists = C.live(data.lists);
    if (!lists.length) { showToast(t("lists.none")); return; }
    dlg.appendChild(el("p", "dlg-text", t("arc.found", { n: items.length })));
    var listSel = sel(lists.map(function (l) { return [l.id, l.name]; }), (curList() || lists[0]).id);
    dlg.appendChild(field(t("arc.list"), listSel));
    var mode = sel([["archive", t("arc.archive")], ["draft", t("arc.drafts")]], "archive");
    dlg.appendChild(field(t("arc.mode"), mode, t("arc.modeHint")));
    var ul = el("ul", "plain arc-list");
    items.slice(0, 8).forEach(function (it) {
      ul.appendChild(el("li", "hint", (it.date ? when(it.date) + " · " : "") + (it.subj || t("iss.noSubj"))));
    });
    if (items.length > 8) ul.appendChild(el("li", "hint", "…"));
    dlg.appendChild(ul);
    actionsRow(dlg, [], t("arc.do", { n: items.length }), function () {
      var room = C.LIM.archive - C.live(data.issues).length;
      var xs = window.OrosNewsletterArchive.toIssues(items, listSel.value, mode.value, Date.now())
        .filter(function (x) { return !C.issue(data, x.id); });
      // Storage budget: the whole slice lives in localStorage and sync,
      // so past issues stop at about 2.5 MB of data in all.
      var size = JSON.stringify(data).length, keep = [];
      xs.forEach(function (x) {
        var n = JSON.stringify(x).length;
        if (keep.length < room && size + n <= C.LIM.dataChars) { keep.push(x); size += n; }
      });
      var full = keep.length < xs.length;
      xs = keep;
      xs.forEach(function (x) { x.m = stamp(0); replaceIn(data.issues, x); });
      saveNow();
      dlg.close();
      prefs.list = listSel.value;
      savePrefs();
      showView("issues");
      showToast(t(full ? "arc.full" : "arc.done", { n: xs.length }));
    });
    openDialog(dlg, listSel);
  }

  // ---------- 15d. Substack and Buttondown exports (import2.js) ----------
  // Both "Import CSV" and "Import past issues…" try these first: a file
  // import2.js claims opens one preview (subscribers and past issues
  // side by side); anything else goes the old way. Subscribers pass
  // through core.planImport, the same rules as every other import.
  // ONE write (saveNow: one merge, one dirty mark) and an Undo that
  // writes newer tombstones, so another device drops them too.
  var I2_SRC = { substack: "Substack", buttondown: "Buttondown", shopify: "Shopify" };
  function tryImport2(file) {
    var I2 = window.OrosNewsletterImport, K = window.OrosImportKit;
    if (!I2 || !K || !file) return Promise.resolve(false);
    return K.readFile(file, I2.MAX_FILE).then(function (r) { return I2.read(r.name, r.bytes); }).then(function (res) {
      if (!res) return false;
      import2Dialog(res);
      return true;
    });
  }
  function import2Dialog(res) {
    var I2 = window.OrosNewsletterImport;
    var lists = C.live(data.lists);
    if (!lists.length) { showToast(t("lists.none")); return; }
    var dlg = makeDialog("nl-import2", t("i2.title", { s: I2_SRC[res.source] || "" }), true);
    dlg.appendChild(el("p", "hint", t("i2.hint")));
    var f = {};
    f.list = sel(lists.map(function (l) { return [l.id, l.name]; }), (curList() || lists[0]).id);
    dlg.appendChild(field(t("arc.list"), f.list));
    function part(on, show, label) {
      var w = el("label", "check i2-part");
      var cb = el("input");
      cb.type = "checkbox";
      cb.checked = on;
      cb.disabled = !on;
      w.appendChild(cb);
      w.appendChild(el("span", "", label));
      w.hidden = !show;
      dlg.appendChild(w);
      return cb;
    }
    // subscribers
    f.subs = part(res.people.length > 0, res.people.length + res.pSkip + res.pBad > 0, t("i2.subs", { n: res.people.length }));
    if (res.pSkip) dlg.appendChild(el("p", "hint", t(res.source === "shopify" ? "i2.pSkipShop" : "i2.pSkip", { n: res.pSkip })));
    f.basis = sel(C.BASES.map(function (b) { return [b, t("basis." + b)]; }), "consent");
    var bh = el("p", "hint", "");
    var bw = field(t("imp.basis"), f.basis);
    bw.appendChild(bh);
    bw.hidden = !res.people.length;
    dlg.appendChild(bw);
    // past issues
    var rg = I2.range(res.items);
    var day = function (ms) { try { return new Date(ms).toLocaleDateString(loc()); } catch (e) { return ""; } };
    var span = rg.from ? " · " + day(rg.from) + (day(rg.to) !== day(rg.from) ? " – " + day(rg.to) : "") : "";
    f.iss = part(res.items.length > 0, res.items.length + res.iSkip + res.iNoBody > 0, t("i2.iss", { n: res.items.length }) + span);
    var gone = [];
    if (res.iSkip) gone.push(t("i2.iSkip", { n: res.iSkip }));
    if (res.iNoBody) gone.push(t("i2.iNoBody", { n: res.iNoBody }));
    if (gone.length) dlg.appendChild(el("p", "hint", gone.join(" · ")));
    f.mode = sel([["archive", t("arc.archive")], ["draft", t("arc.drafts")]], "archive");
    var mw = field(t("arc.mode"), f.mode, t("arc.modeHint"));
    mw.hidden = !res.items.length;
    dlg.appendChild(mw);
    var sum = el("p", "dlg-text i2-sum");
    dlg.appendChild(sum);
    var plan = null, okBtn = null;
    var update = function () {
      bh.textContent = t("basis." + f.basis.value + "Hint");
      plan = I2.plan(data, f.list.value, res, { basis: f.basis.value, mode: f.mode.value, subs: f.subs.checked, issues: f.iss.checked });
      var lines = [];
      if (f.subs.checked) {
        var p = plan.subs;
        lines.push(t("imp.sum", { a: p.add.length, d: p.dup, l: p.left, s: p.supp, b: p.bad, o: p.over }));
      }
      if (f.iss.checked) lines.push(t("i2.issSum", { n: plan.issues.length, h: plan.have }) + (plan.full ? " · " + t("i2.full") : ""));
      sum.textContent = lines.join("\n");
      if (okBtn) okBtn.disabled = !plan.subs.add.length && !plan.issues.length;
    };
    [f.list, f.basis, f.mode, f.subs, f.iss].forEach(function (c) { c.addEventListener("change", update); });
    var acts = actionsRow(dlg, [], t("i2.do"), function () {
      update();
      if (!plan.subs.add.length && !plan.issues.length) return;
      var sIds = [], iIds = [];
      plan.subs.add.forEach(function (x) { sIds.push(x.id); replaceIn(data.subs, x); });
      plan.issues.forEach(function (x) { x.m = stamp(0); iIds.push(x.id); replaceIn(data.issues, x); });
      saveNow();
      dlg.close();
      prefs.list = f.list.value;
      savePrefs();
      renderAll();
      undoToast(t("i2.done", { s: sIds.length, i: iIds.length }), function () { import2Undo(sIds, iIds); });
      if (sIds.length && f.basis.value === "optin") kick();
    });
    okBtn = acts.lastChild;
    update();
    openDialog(dlg, f.list);
  }
  function import2Undo(sIds, iIds) {
    [["subs", sIds], ["issues", iIds]].forEach(function (pr) {
      pr[1].forEach(function (id) {
        var cur = null;
        data[pr[0]].forEach(function (x) { if (x.id === id) cur = x; });
        if (cur && !cur.del) replaceIn(data[pr[0]], { id: id, m: stamp(cur.m), del: 1 });
      });
    });
    saveNow();
    renderAll();
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
    // .orosnewsletter: Save, Open, unzipped folder (section 15a)
    if (recFile) {
      c1.appendChild(el("p", "hint", t("set.oText")));
      var a4 = el("div", "acts");
      [["nl-osave", "set.osave", function () { recFile.save(); }],
       ["nl-oopen", "set.oopen", function () { recFile.open(); }],
       ["nl-ofolder", "set.ofolder", function () { recFile.openFolder(); }]].forEach(function (o) {
        var b4 = btn(t(o[1]), "", o[2]);
        b4.id = o[0];
        a4.appendChild(b4);
      });
      c1.appendChild(a4);
    }
    var today = 0, k = dayKey(), used = E.devState().used;
    Object.keys(used).forEach(function (id) { if (used[id] && used[id].d === k) today += used[id].n; });
    c1.appendChild(el("p", "hint", t("set.dev", { n: today })));
    b.appendChild(c1);
    var c3 = el("div", "card");
    c3.appendChild(el("h3", "sec-h", t("set.archive")));
    c3.appendChild(el("p", "dlg-text", t("set.archiveText")));
    var a3 = el("div", "acts");
    a3.appendChild(btn(t("set.archiveBtn"), "", importArchive));
    c3.appendChild(a3);
    b.appendChild(c3);
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
        else if (view === "edit") { e.preventDefault(); flushIssue(); stepHist(true); }
        return;
      }
      // redo in the editor: Ctrl+Y or Ctrl+Shift+Z
      if (view === "edit" && (e.ctrlKey || e.metaKey) && !e.altKey &&
          ((!e.shiftKey && (e.key === "y" || e.key === "Y")) || (e.shiftKey && (e.key === "z" || e.key === "Z")))) {
        e.preventDefault(); flushIssue(); stepHist(false);
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

  // Email platforms (newsletter/platforms.js): the app's helpers
  var P = window.OrosNewsletterPlatforms || null;
  function initPlatforms() {
    if (!P) return;
    P.init({
      get lang() { return LANG; },
      data: function () { return data; },
      save: function () { saveNow(); },
      curList: curList, el: el, makeDialog: makeDialog, openDialog: openDialog, field: field, sel: sel,
      btn: btn, actionsRow: actionsRow, replaceIn: replaceIn, when: when, confirm: confirmDialog,
      renderAll: function () { renderAll(); }
    });
  }
  function initShop() {
    if (!Sh) return;
    Sh.init({
      get lang() { return LANG; },
      el: el, makeDialog: makeDialog, openDialog: openDialog, field: field, sel: sel, btn: btn, actionsRow: actionsRow,
      toast: function (m) { showToast(m); }, money: money, storeImage: storeImage, pickPeople: pickPeople
    });
  }
  function boot() {
    findRunner();
    load();
    initPlatforms();
    initShop();
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

  // ---------- Blocks from the Assistant (chat compose N1) ----------
  // The Assistant's "Add to the newsletter" card. A dialog that is
  // open is left alone: the blocks wait until it closes.
  function asAddTarget(raw) {
    var v = C.asAdd(raw);
    if (!v) { showToast(t("as.none")); return; }
    var open = document.querySelector("dialog[open]");
    if (open) { open.addEventListener("close", function () { setTimeout(function () { asAddTarget(raw); }, 0); }, { once: true }); return; }
    var drafts = C.live(data.issues).filter(function (x) { return x.st === "draft" && x.fmt === "blocks" && !x.imp; });
    var target = v.issue ? C.issue(data, v.issue) : null;
    if (target && (target.st !== "draft" || target.fmt !== "blocks")) target = null;
    if (!target && view === "edit" && edIssue) {
      var cur = C.issue(data, edIssue.id);
      if (cur && cur.st === "draft" && cur.fmt === "blocks") target = cur;
    }
    if (target) { addAsBlocks(target.id, v.blocks, v.pics); return; }
    asAddDialog(v, drafts);
  }
  function asAddDialog(v, drafts) {
    var lists = C.live(data.lists);
    var dlg = makeDialog("nl-asadd", t("as.title"));
    dlg.appendChild(el("p", "dlg-text", v.blocks.length === 1 ? t("as.text1") : t("as.text", { n: v.blocks.length })));
    if (drafts.length) {
      dlg.appendChild(el("p", "dlg-h", t("as.drafts")));
      var ul = el("ul", "plain tpl-list");
      drafts.sort(function (a, b) { return b.m - a.m; }).slice(0, 8).forEach(function (x) {
        var l = C.list(data, x.list);
        var li = el("li", "tpl-row");
        var b = el("button", "row");
        b.type = "button";
        var txt = el("span", "row-txt");
        txt.appendChild(el("span", "row-no", shownSubj(x)));
        txt.appendChild(el("span", "row-sub", [l ? l.name : "", when(x.m)].filter(Boolean).join(" · ")));
        b.appendChild(txt);
        b.addEventListener("click", function () { dlg.close(); addAsBlocks(x.id, v.blocks, v.pics); });
        li.appendChild(b);
        ul.appendChild(li);
      });
      dlg.appendChild(ul);
    }
    if (!lists.length) {
      dlg.appendChild(el("p", "hint", t("as.noList")));
      actionsRow(dlg, [], t("as.newList"), function () { dlg.close(); listDialog(null); });
      openDialog(dlg);
      return;
    }
    dlg.appendChild(el("p", "dlg-h", t("as.newDraft")));
    var cl = curList() || lists[0];
    var pick = sel(lists.map(function (l) { return [l.id, l.name || "—"]; }), cl.id);
    if (lists.length > 1) dlg.appendChild(field(t("as.list"), pick));
    var subj = inp("text", v.subj, C.LIM.subj);
    dlg.appendChild(field(t("ed.subj"), subj));
    actionsRow(dlg, [], t("as.create"), function () {
      var l = C.list(data, pick.value) || cl;
      dlg.close();
      var x = C.normIssue({ id: C.randomId("i", null), m: 0, list: l.id, fmt: "blocks", subj: subj.value,
                            blocks: [].concat(l.hf && l.hf.head ? [copy(l.hf.head)] : [], l.hf && l.hf.foot ? [copy(l.hf.foot)] : []) });
      put("issues", x);
      addAsBlocks(x.id, v.blocks, v.pics);
    });
    openDialog(dlg, drafts.length ? null : subj);
  }
  // Adds the blocks to that draft (the version being edited, when it is
  // the open one) before its footer, opens it, and offers Undo; then
  // copies the pictures (pics) into their blocks.
  function addAsBlocks(id, blocks, pics) {
    flushIssue();
    var x0 = C.issue(data, id);
    if (!x0 || x0.st !== "draft") return;
    var x = copy(x0), cx = side(x);
    var room = C.LIM.blocks - cx.blocks.length;
    if (room <= 0) { showToast(t("bk.full")); return; }
    var add = copy(blocks).slice(0, room);
    snap(x);
    var before = copy(cx.blocks);
    var at = C.insertAt(cx.blocks);
    Array.prototype.splice.apply(cx.blocks, [at, 0].concat(add));
    put("issues", x);
    prefs.list = x.list;
    savePrefs();
    viewId = x.id;
    showView("edit");
    focusBlock(at);
    var msg = add.length === 1 ? t("as.added1") : t("as.added", { n: add.length });
    if (add.length < blocks.length) msg += " " + t("as.cut", { n: blocks.length - add.length });
    undoToast(msg, function () {
      var c0 = C.issue(data, id);
      if (!c0 || c0.st !== "draft") return;
      var c1 = copy(c0);
      side(c1).blocks = before;
      put("issues", c1);
      if (view === "edit" && viewId === id) renderEditor();
    });
    var todo = (pics || []).filter(function (p) { return p.i < add.length; });
    if (todo.length) asPics(id, side(x) !== x, add, at, todo);
  }
  // The blocks' pictures, copied one after another from their web
  // addresses (only sites that allow it: CORS). A block that was moved,
  // removed or given a picture meanwhile is left alone.
  var PIC_WAIT = 15000, PIC_MAX = 15 * 1024 * 1024;
  function fetchPic(src) {
    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, PIC_WAIT) : 0;
    return fetch(src, { mode: "cors", credentials: "omit", referrerPolicy: "no-referrer", signal: ctl ? ctl.signal : undefined }).then(function (res) {
      if (!res.ok) throw new Error("http");
      return res.blob();
    }).then(function (b) {
      clearTimeout(timer);
      if (!/^image\/(jpeg|png|webp|gif)$/i.test(b.type || "") || b.size > PIC_MAX) throw new Error("type");
      return b;
    }, function (e) { clearTimeout(timer); throw e; });
  }
  function asPics(id, onL2, added, at, todo) {
    var fails = 0, k = 0, was = added.map(function (b) { return JSON.stringify(b); });
    function next() {
      if (k >= todo.length) {
        if (fails) showToast(fails === 1 ? t("as.pic1") : t("as.pics", { n: fails }));
        return;
      }
      var p = todo[k++], want = added[p.i].k, wj = was[p.i];
      fetchPic(p.src).then(storeImage).then(function (r) {
        var cur = C.issue(data, id);
        if (!cur || cur.st !== "draft") return;
        var x = copy(cur), cx = onL2 && x.l2 ? x.l2 : x, i = -1;
        cx.blocks.forEach(function (b, j) {
          if (i < 0 && j >= at && b.k === want && !b.f && JSON.stringify(b) === wj) i = j;
        });
        if (i < 0) return;
        cx.blocks[i].f = r.path; cx.blocks[i].w = r.w; cx.blocks[i].h = r.h; cx.blocks[i].b = r.b;
        put("issues", x);
        if (view === "edit" && viewId === id) renderEditor();
      }, function () { fails++; }).then(next, next);
    }
    if (!orosFS()) { showToast(t("toast.noDisk")); return; }
    next();
  }

  // Deep links (shell __orosOpenAt / __orosTakeTarget):
  //   { issue: id }   open that issue (universal search)
  //   { list: id }    show that list's issues
  //   { openFile: { token } }  "Open with" an .orosnewsletter file
  //                   (fileopen.js): the File taken once with
  //                   window.parent.__orosTakeFile(token)
  //   { asAdd: { blocks, subj?, issue? } }  blocks from the Assistant
  //                   (chat compose N1): added to a draft only after the
  //                   user picks it (or the open draft); Undo in the toast
  function openTarget(tg) {
    if (tg && tg.openFile) { if (recFile) recFile.openTarget(tg.openFile); return; }
    if (tg && tg.asAdd) { asAddTarget(tg.asAdd); return; }
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
