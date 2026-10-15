// ============================================================
// orOS Settings — pure helpers (settings/core.js)
// No DOM, no storage: strings, the section list, which settings
// travel to every device, and small formatters. Shared by the app
// (window.SettingsCore) and node tests (module.exports).
// ============================================================
(function (root) {
  "use strict";

  // The groups, in the order shown. A deep link names one of these.
  var SECTIONS = ["appearance", "menu", "notifications", "sync", "backup", "language", "files", "solo", "services", "system"];

  // Where each setting lives: "all" = travels to every device through
  // sync, "device" = this device only. Mirrors the shell: lang, theme,
  // skin, wallpaper, syncInterval, autoexport ride in the shell slice;
  // the pet switch in the pet slice; notifications in the notifs slice;
  // search switches, backup folder and passphrase stay on the device.
  // The menu's app list rides in the launcher's "menu" slice.
  var SCOPE = {
    theme: "all", skin: "all", wallpaper: "all", pet: "all", seasonal: "all",
    notifications: "all", syncInterval: "all", autoexport: "all", lang: "all", menu: "all",
    folder: "device", search: "device", passphrase: "device", dock: "device", files: "device"
  };

  var POSITIONS = ["top-left", "top", "top-right", "right",
                   "bottom-right", "bottom", "bottom-left", "left"];
  var STYLES = ["oros", "dunst", "plasma", "gnome"];
  var SOUNDS = ["none", "bell", "ding", "chime"];
  var DURATIONS = [2000, 5000, 8000, 12000];

  var STRINGS = {
    en: {
      "app": "Settings", "back": "Back", "sections": "Settings sections",
      "scope.all": "All devices", "scope.device": "This device",
      "scope.all.title": "Syncs to all your devices",
      "scope.device.title": "Applies to this device only",
      "on": "On", "off": "Off",
      "noShell": "Open Settings from the orOS menu: it needs the orOS desktop around it.",

      "s.appearance": "Appearance", "s.notifications": "Notifications", "s.sync": "Sync",
      "s.backup": "Backups", "s.language": "Language & search", "s.system": "System",
      "s.menu": "Menu",
      "d.appearance": "Theme, colours, wallpaper, decorations, Dock, screen pet",
      "d.menu": "Which apps the menu shows",
      "d.notifications": "Pop-ups, sound, quiet hours, per app",
      "d.sync": "Encrypted sync through Dropbox",
      "d.backup": "Backup files and the backup folder",
      "d.language": "Language and what the menu search looks in",
      "d.system": "Version, shortcuts, about, factory reset",

      "a.theme": "Theme", "a.dark": "Dark", "a.light": "Light",
      "a.skin": "System colour", "a.wallpaper": "Wallpaper",
      "a.wallpaper.make": "Make your own in Wallpaper Generator",
      "a.pet": "Screen pet",
      "a.pet.hint": "A tiny companion on your desktop. Feed it, pet it, let it sleep.",
      "z.title": "Seasonal decorations", "z.on": "Decorate the desktop in season",
      "z.hint": "Snow and lights at Christmas, fireworks at New Year, red eggs at Easter, flags on the national days, pumpkins at Halloween. They sit behind your icons and never get in the way.",
      "z.motion": "Motion", "z.motion.auto": "Moving", "z.motion.still": "Still only",
      "z.reduced": "Your device asks for less motion, so only the still pieces show.",
      "z.battery": "Battery is low, so only the still pieces show for now.",
      "z.amount": "Amount", "z.amount.low": "A little", "z.amount.mid": "Normal", "z.amount.high": "Lots",
      "z.xmas": "At Christmas", "z.xmas.tree": "Tree", "z.xmas.boat": "Boat",
      "z.today": "Today: {name}", "z.hidden": "Hidden for today",
      "z.hideToday": "Hide for today", "z.showToday": "Show again",
      "z.events": "Events", "z.try": "Try it now", "z.now": "Showing in this period",
      "z.previewing": "Preview: {name}", "z.kept": "{name} stays until {until}",
      "z.keep": "Keep it", "z.stop": "Stop",
      "k.dock": "Dock", "k.on": "Show the Dock", "k.size": "Size",
      "k.size.s": "Small", "k.size.m": "Medium", "k.size.l": "Large",
      "k.magnify": "Magnify on hover", "k.autohide": "Hide automatically",
      "k.over": "Show over open apps",
      "k.style": "Style", "k.style.classic": "Classic", "k.style.glass": "Glass",
      "k.style.frosted": "Frosted", "k.style.smoke": "Smoke", "k.style.transparent": "Transparent",
      "k.style.solid": "Solid", "k.style.3d": "3D shelf", "k.style.neon": "Neon",
      "k.hover": "Hover effect", "k.hover.magnify": "Magnify", "k.hover.bounce": "Bounce",
      "k.hover.pulse": "Pulse", "k.hover.frame": "Frame", "k.hover.glow": "Glow",
      "k.hover.lift": "Lift", "k.hover.wiggle": "Wiggle", "k.hover.none": "None",
      "k.empty": "Add apps with the ☆ next to each app in the menu.",

      "m.apps": "Apps in the menu",
      "m.hint": "Untick an app to hide it from the menu. Hidden apps still open from the menu search, links from other apps, the desktop and the Dock.",
      "m.showAll": "Show all", "m.hideAll": "Hide all",
      "m.count": "{n} of {total} shown",
      "m.filter": "Find an app", "m.filter.none": "No app matches.",
      "m.none": "This orOS version cannot hide apps from the menu yet.",

      "n.enabled": "Notifications", "n.test": "Send a test",
      "n.test.title": "Test notification", "n.test.body": "This is how notifications look.",
      "n.position": "Position on screen", "n.style": "Style", "n.sound": "Sound",
      "n.volume": "Volume", "n.duration": "Stays on screen",
      "n.quiet": "Quiet hours", "n.quiet.hint": "No pop-ups or sounds in these hours. Notifications still wait in the bell.",
      "n.phone": "Reminders through the Android app",
      "n.phone.hint": "Clock alarms, Water reminders and due To-Do tasks ring on this phone even when orOS is closed.",
      "n.phone.allow": "Allow",
      "n.phone.exact": "Android may ring them a few minutes late. Allow alarms for exact times.",
      "v.hc": "Health Connect",
      "v.hc.hint": "orOS Water and Workouts go to Health Connect on this phone. Steps, weight, resting heart rate, sleep, blood pressure, blood sugar and oxygen, water and workouts from your other health apps and watch come into orOS Health, Water and Workouts. The last 30 days, both ways.",
      "v.hc.allow": "Allow",
      "v.hc.some": "Some of the data is not allowed. Tap Allow to choose again.",
      "v.hc.update": "Health Connect needs to be installed or updated on this phone.",
      "v.hc.install": "Get Health Connect",
      "v.hc.none": "This phone does not have Health Connect.",
      "v.hc.last": "Last update {when}. From other apps: days with steps {steps} · drinks {water} · workouts {wo}",
      "n.from": "From", "n.to": "To", "n.apps": "Which apps may notify",
      "n.pos.top-left": "Top left", "n.pos.top": "Top", "n.pos.top-right": "Top right",
      "n.pos.right": "Right", "n.pos.bottom-right": "Bottom right", "n.pos.bottom": "Bottom",
      "n.pos.bottom-left": "Bottom left", "n.pos.left": "Left",
      "n.sound.none": "None", "n.sound.bell": "Bell", "n.sound.ding": "Ding", "n.sound.chime": "Chime",
      "n.none": "Notifications are not available in this orOS version.",

      "y.status.off": "Not connected. Your data lives only on this device.",
      "y.status.locked": "Connected, locked. Enter your passphrase to sync this device.",
      "y.status.on": "Connected and syncing",
      "y.status.dirty": "Changes waiting to upload",
      "y.connect": "Connect to Dropbox",
      "y.connect.hint": "Everything is encrypted on this device with your passphrase before it leaves. Dropbox sees only unreadable files.",
      "y.pass": "Passphrase", "y.pass.ph": "Your sync passphrase",
      "y.pass.show": "Show passphrase", "y.pass.hide": "Hide passphrase",
      "y.pass.hint": "First time? Pick one of at least {n} characters and keep it safe: nobody can recover it.",
      "y.remember": "Remember on this device", "y.unlock": "Unlock",
      "y.pull": "Get from cloud", "y.push": "Send to cloud",
      "y.interval": "Sync automatically", "y.interval.off": "Off", "y.interval.min": "every {n} min", "y.interval.one": "every minute",
      "y.changePass": "Change passphrase",
      "y.forget": "Forget passphrase here", "y.forgetVault": "Forget this device",
      "y.disconnect": "Disconnect",
      "y.disconnect.confirm": "Tap again to disconnect",

      "b.auto": "Automatic backup", "b.auto.off": "Off", "b.auto.daily": "Daily",
      "b.auto.weekly": "Weekly", "b.auto.monthly": "Monthly",
      "b.folder": "Backup folder", "b.folder.none": "No folder chosen",
      "b.folder.choose": "Choose folder", "b.folder.stop": "Stop using it",
      "b.folder.reconnect": "Allow again", "b.folder.lapsed": "The browser needs your permission again.",
      "b.folder.hint": "orOS writes a backup file into this folder on the schedule above.",
      "b.noFolder": "This browser cannot save to a folder by itself. Export a backup file now and then.",
      "b.now": "Back up now", "b.export": "Export backup file", "b.import": "Import backup file",
      "b.hint": "A backup file is NOT encrypted. Keep it somewhere safe.",

      "l.lang": "Language", "l.search": "Menu search looks in",
      "l.search.hint": "The search field at the top of the menu also finds text inside these apps.",
      "l.search.none": "No app offers search yet.",

      "s.files": "Opening files", "d.files": "Which orOS app opens which file type",
      "f.status": "Open with orOS",
      "f.ready": "orOS is in your system's “Open with” for the file types below. Pick orOS there for a file, or make it the default (how, below).",
      "f.install": "Install orOS as an app first (System › Install orOS as an app). Then it appears in your system's “Open with” for these file types.",
      "f.unsupported": "This browser cannot hand files from your device to orOS. Use Chrome or Edge on Windows, Linux or Mac, with orOS installed. On Android, share the file to orOS (Share › orOS).",
      "f.none": "Opening files is not available in this orOS version.",
      "f.apps": "Which app opens what",
      "f.choose": "Types more than one app opens",
      "f.choose.hint": "orOS asks each time, unless you pick an app here (or tick “Always” when it asks).",
      "f.ask": "Ask each time",
      "f.how": "Make orOS the default",
      "f.how.hint": "Only you can make an app the default, in your system's settings. orOS cannot do it by itself.",
      "f.how.win": "Windows: right-click a file › Open with › Choose another app › orOS, tick “Always use this app”.",
      "f.how.linux": "Linux: right-click a file › Properties › Open With › orOS › Set as default.",
      "f.how.mac": "Mac: select a file › Get Info › Open with › orOS › Change All.",
      "f.how.android": "Android: in Files, Gmail or any app, Share › orOS opens the file in the matching orOS app (orOS installed from Chrome). It cannot be the default for opening files yet.",

      "s.solo": "Single apps", "d.solo": "Notes, Calendar and more, each as its own app",
      "so.intro": "Install an orOS app on its own. It gets its own icon and window, opens straight into the app and works offline. On this device it shares its data with orOS. On another device, turn on sync inside it (app menu › Sync and cloud) to join your encrypted orOS cloud.",
      "so.apps": "Available single apps",
      "so.open": "Install",
      "so.open.title": "Opens the app's page in a new tab, ready to install",
      "so.how": "How to install",
      "so.how.desktop": "Windows and Linux: in the new tab, choose Install in the address bar of Chrome or Edge. The app then appears in your Start menu or app list.",
      "so.how.android": "Android: Install opens the app in Chrome; from the orOS app, in your default browser (Chrome if none is set). Press Install on the bar at the bottom, or open the browser menu and choose Add to Home screen › Install.",
      "so.how.iphone": "iPhone: in Safari, Share › Add to Home Screen.",
      "so.none": "Single apps are not available in this orOS version.",

      "s.services": "Connected services", "d.services": "Your shop and other platforms orOS works with",
      "v.intro": "Link orOS to platforms you already use. Their keys stay sealed on this device: apps ask the system, never see them.",
      "v.none": "Nothing connected yet.", "v.unsupported": "This orOS version has no connected services yet.",
      "v.add": "Connect a service", "v.platform": "Platform", "v.name": "Name", "v.name.ph": "My shop",
      "v.site": "Shop address", "v.site.ph": "shop.example.com",
      "v.ck": "Consumer key", "v.cs": "Consumer secret",
      "v.keys.hint": "In WordPress: WooCommerce › Settings › Advanced › REST API › Add key, permissions Read/Write. Copy both keys here.",
      "v.save": "Connect", "v.cancel": "Cancel", "v.checking": "Checking…",
      "v.test": "Check connection", "v.ok": "Connected: the shop answers.",
      "v.via": "Route", "v.via.direct": "Straight from this browser", "v.via.query": "Straight from this browser (keys in the address)",
      "v.via.relay": "Through the orOS relay", "v.via.none": "Not used yet on this device",
      "v.used": "Used by", "v.keysHere": "Keys on this device", "v.keysMissing": "The keys are not on this device yet",
      "v.newKeys": "Enter the keys", "v.saveKeys": "Save keys",
      "v.ks": "Use these keys on all my devices",
      "v.ks.hint": "The keys travel inside your encrypted sync, sealed with your sync passphrase. Anyone who knows that passphrase can use them.",
      "v.ks.needSync": "Connect and unlock sync first.",
      "v.rename": "Rename", "v.remove": "Disconnect", "v.remove.confirm": "Tap again to disconnect",
      "v.remove.hint": "Disconnecting removes the account and its keys from every device. Nothing in your apps is deleted.",
      "v.open": "Open {app}",
      "v.err.offline": "You are offline.", "v.err.auth": "The shop refused the keys. Check them and that they have Read/Write permission.",
      "v.err.notfound": "No WooCommerce REST API at this address.", "v.err.network": "The shop could not be reached, not even through the orOS relay.",
      "v.err.relay": "The shop does not answer this browser and the orOS relay did not answer either.", "v.err.server": "The shop answered with an error.",
      "v.err.busy": "The shop asks to wait a little. Try again in a minute.", "v.err.keys": "The keys are not on this device. Enter them again.",
      "v.err.site": "Enter the https address of a public site.", "v.err.badkeys": "Check the keys: they start with ck_ and cs_, 43 characters each.",
      "v.err.full": "You have connected as many services as orOS keeps.", "v.err.save": "Not saved: this device's storage is full.",
      "v.err.denied": "orOS does not allow that call.", "v.err.gone": "This account was disconnected.",
      "v.plat.woo": "WooCommerce shop (Stock)", "v.plat.tol": "timologisi.online (Invoices → myDATA)",
      "v.plat.tol.hint": "A certified Greek e-invoicing provider: Invoices sends your invoices, receipts and credit notes through it to myDATA (AADE). It charges credits per document.",
      "v.env": "Environment", "v.env.test": "Test (sandbox)", "v.env.live": "Live (real documents)",
      "v.vat": "Issuer's ΑΦΜ", "v.vat.ph": "9 digits", "v.key": "API key",
      "v.keys.hint.tol": "In the timologisi.online portal copy your API key here: developer.portal.timologisi.online for tests, portal.timologisi.online for real documents. Test and live keys are different.",
      "v.ok.tol": "Connected. Credits left: {n}", "v.err.vat": "Enter the 9-digit ΑΦΜ this account issues for.",
      "v.err.badkeys.tol": "Check the API key: copy it whole, without spaces.",
      "v.err.auth.tol": "timologisi.online refused the key. Check that it belongs to this environment (test or live).",
      "v.err.notfound.tol": "timologisi.online answered with “not found”.", "v.err.network.tol": "timologisi.online could not be reached, not even through the orOS relay.",
      "v.err.relay.tol": "timologisi.online does not answer this browser and the orOS relay did not answer either.", "v.err.server.tol": "timologisi.online answered with an error.",
      "v.plat.mlite": "MailerLite (Newsletter)", "v.plat.mchimp": "Mailchimp (Newsletter)", "v.plat.brevo": "Brevo contacts (Newsletter)",
      "v.plat.mlite.hint": "Newsletter syncs a list with a MailerLite group: subscribers both ways, unsubscribes both ways.",
      "v.plat.mchimp.hint": "Newsletter syncs a list with a Mailchimp audience: subscribers both ways, unsubscribes both ways. Mailchimp only answers servers, so it always goes through the orOS relay.",
      "v.plat.brevo.hint": "Newsletter syncs a list with a Brevo contact list: subscribers both ways, unsubscribes both ways. (Sending through Brevo stays in Newsletter › Sending accounts.)",
      "v.keys.hint.mlite": "In MailerLite: Integrations › API › Generate new token. Copy the whole token here.",
      "v.keys.hint.mchimp": "In Mailchimp: Profile › Extras › API keys › Create a key. It ends with your data centre, like -us21.",
      "v.keys.hint.brevo": "In Brevo: SMTP & API › API keys › Generate a new API key. It starts with xkeysib-.",
      "v.err.badkeys.mchimp": "Check the API key: 32 letters and digits, a dash and the data centre (like -us21).",
      "v.err.badkeys.brevo": "Check the API key: it starts with xkeysib-.", "v.err.badkeys.mlite": "Check the token: copy it whole, without spaces.",
      "v.plat.hubspot": "HubSpot (CRM)", "v.plat.pdrive": "Pipedrive (CRM)",
      "v.plat.hubspot.hint": "CRM brings in HubSpot's companies, contacts and deals. orOS only reads: nothing changes in HubSpot. HubSpot only answers servers, so it always goes through the orOS relay.",
      "v.plat.pdrive.hint": "CRM brings in Pipedrive's organizations, people, deals and open activities. orOS only reads: nothing changes in Pipedrive.",
      "v.keys.hint.hubspot": "In HubSpot: Settings › Integrations › Private apps › Create a private app, with read scopes for contacts, companies and deals. Copy its access token (it starts with pat-).",
      "v.keys.hint.pdrive": "In Pipedrive: your profile › Personal preferences › API. Copy your personal API token (40 characters).",
      "v.err.badkeys.hubspot": "Check the token: it starts with pat- (a private app's access token).", "v.err.badkeys.pdrive": "Check the API token: 40 letters and digits.",
      "v.plat.odoo": "Odoo (CRM)", "v.site.odoo": "Odoo address", "v.site.ph.odoo": "yourcompany.odoo.com or your own address",
      "v.db": "Database", "v.db.ph": "Only if the server has several", "v.err.db": "Check the database name: letters, digits, dots, dashes and underscores.",
      "v.plat.odoo.hint": "CRM brings in Odoo's contacts (companies with their people, VAT ID) and opportunities as deals. orOS only reads: nothing changes in Odoo. It needs Odoo 19 or Odoo Online (the JSON-2 API).",
      "v.keys.hint.odoo": "In Odoo: your avatar › My Preferences › Account Security › New API Key (turn on developer mode if you don't see it). Copy the key here; it can read what your Odoo user can.",
      "v.err.badkeys.odoo": "Check the API key: letters and digits, copied whole.",
      "v.plat.ininja": "Invoice Ninja (CRM, Budget)", "v.site.ininja": "Invoice Ninja address", "v.site.ph.ininja": "invoicing.co or your own address",
      "v.plat.ininja.hint": "CRM brings in its clients (with their contacts and VAT ID), Budget its payments. orOS only reads: nothing changes in Invoice Ninja. Use invoicing.co for the hosted service, or your own install's address.",
      "v.keys.hint.ininja": "In Invoice Ninja: Settings › Account management › Integrations › API tokens › New token. Copy the token here.",
      "v.err.badkeys.ininja": "Check the API token: letters and digits only, copied whole.",
      "v.plat.stripe": "Stripe (Budget)",
      "v.plat.stripe.hint": "Budget brings in your Stripe payments: charges as income, fees, refunds and disputes as expenses. orOS only reads: nothing changes in Stripe. It always goes through the orOS relay.",
      "v.keys.hint.stripe": "In Stripe: Developers › API keys › Create restricted key, with Read access to Balance only. It starts with rk_live_ (or rk_test_). orOS doesn't take your secret key (sk_).",
      "v.err.badkeys.stripe": "Use a restricted key: it starts with rk_live_ or rk_test_. A secret key (sk_) is not accepted.",
      "v.plat.todoist": "Todoist (To-Do)",
      "v.plat.todoist.hint": "To-Do brings in your Todoist projects and open tasks (due dates, descriptions, labels, priority). orOS only reads: nothing changes in Todoist.",
      "v.keys.hint.todoist": "In Todoist: Settings › Integrations › Developer › API token. Copy the token here (40 characters). It can read and change everything in your Todoist; orOS only reads.",
      "v.err.badkeys.todoist": "Check the API token: 40 letters (a–f) and digits.",
      "v.plat.trello": "Trello (Kanban)", "v.plat.github": "GitHub (Kanban, To-Do)", "v.token": "Token",
      "v.plat.trello.hint": "Kanban reads your Trello boards (lists, cards, labels, checklists) when you import one. orOS only reads: nothing changes in Trello.",
      "v.keys.hint.trello": "In Trello: trello.com/power-ups/admin › New (a Power-Up for yourself) › API key. Copy the API key here, then open the Token link next to it, allow it, and copy the token too.",
      "v.err.badkeys.trello": "Check both: the API key is 32 letters (a–f) and digits, the token 64 or more letters and digits.",
      "v.plat.github.hint": "Kanban reads a repository's issues (open and closed, labels, milestone dates, task lists) when you import it; To-Do reads the open issues assigned to you. orOS only reads: nothing changes on GitHub.",
      "v.keys.hint.github": "On GitHub: Settings › Developer settings › Personal access tokens › Fine-grained tokens › Generate new token, with read-only access to Issues (and Metadata) of the repositories you want. Copy the token here (it starts with github_pat_).",
      "v.err.badkeys.github": "Check the token: it starts with github_pat_ (or ghp_ for a classic token).",
      "v.plat.raindrop": "Raindrop.io (Bookmarks)",
      "v.plat.raindrop.hint": "Bookmarks brings in your Raindrop.io collections and bookmarks (titles, notes, tags, favourites). orOS only reads: nothing changes in Raindrop.",
      "v.keys.hint.raindrop": "In Raindrop.io: Settings › Integrations › For developers › Create new app (any name) › open it › Create test token. Copy the test token here.",
      "v.err.badkeys.raindrop": "Check the test token: letters, digits and dashes, like 1a2b3c4d-….",
      "v.plat.notion": "Notion (Notes, Spreadsheet, Kanban)",
      "v.plat.notion.hint": "Notes brings in the Notion pages you share with your integration, as a notebook; Spreadsheet brings in its databases, one sheet each, and Kanban one database as a board. orOS only reads: nothing changes in Notion. Notion doesn't answer browsers, so it always goes through the orOS relay (which keeps nothing).",
      "v.keys.hint.notion": "In Notion: notion.so/profile/integrations › New integration (Internal, read content only) › copy the Internal Integration Secret here (it starts with ntn_ or secret_). Then in Notion open each page or database you want, ••• › Connections › add the integration (what is inside it comes along).",
      "v.err.badkeys.notion": "Check the secret: it starts with ntn_ (or secret_ for older ones).",
      "v.ok.svc": "Connected: {name} answers.",
      "v.err.auth.svc": "{name} refused the key. Check it and that it hasn't been deleted there.",
      "v.err.notfound.svc": "{name} answered with “not found”.", "v.err.network.svc": "{name} could not be reached, not even through the orOS relay.",
      "v.err.relay.svc": "{name} does not answer this browser and the orOS relay did not answer either.", "v.err.server.svc": "{name} answered with an error.",
      "v.err.busy.svc": "{name} asks to slow down. Try again in a minute.",
      "v.err.busy.tol": "timologisi.online asks to wait a little. Try again in a minute.",

      "x.version": "orOS version", "x.updates": "Check for updates",
      "x.install": "Install orOS as an app", "x.install.hint": "Opens in its own window, works offline, starts from your home screen.",
      "x.shortcuts": "Keyboard shortcuts", "x.more": "More",
      "x.device": "Device info", "x.about": "About orOS, credits and licences",
      "x.apps": "Settings inside apps", "x.weather": "Weather on the taskbar",
      "x.wallgen": "Wallpaper Generator",
      "x.reset": "Factory reset", "x.reset.confirm": "Tap again to erase everything",
      "x.reset.hint": "Permanent: erases all orOS data and settings on this device, the backups in the backup folder, all cloud data and cloud backups, and this device's Dropbox sign-in, then starts orOS like new. Repeat on your other devices. Export a backup file first if you may need anything.",
      "x.reset.working": "Erasing…"
    },
    el: {
      "app": "Ρυθμίσεις", "back": "Πίσω", "sections": "Ενότητες ρυθμίσεων",
      "scope.all": "Όλες οι συσκευές", "scope.device": "Αυτή η συσκευή",
      "scope.all.title": "Συγχρονίζεται σε όλες τις συσκευές σου",
      "scope.device.title": "Ισχύει μόνο σε αυτή τη συσκευή",
      "on": "Ναι", "off": "Όχι",
      "noShell": "Άνοιξε τις Ρυθμίσεις από το μενού του orOS: χρειάζονται την επιφάνεια εργασίας του orOS γύρω τους.",

      "s.appearance": "Εμφάνιση", "s.notifications": "Ειδοποιήσεις", "s.sync": "Συγχρονισμός",
      "s.backup": "Αντίγραφα ασφαλείας", "s.language": "Γλώσσα και αναζήτηση", "s.system": "Σύστημα",
      "s.menu": "Μενού",
      "d.appearance": "Θέμα, χρώματα, ταπετσαρία, διακόσμηση, Dock, συντροφάκι",
      "d.menu": "Ποιες εφαρμογές δείχνει το μενού",
      "d.notifications": "Αναδυόμενα, ήχος, ώρες ησυχίας, ανά εφαρμογή",
      "d.sync": "Κρυπτογραφημένος συγχρονισμός μέσω Dropbox",
      "d.backup": "Αρχεία αντιγράφων και φάκελος αντιγράφων",
      "d.language": "Γλώσσα και πού ψάχνει η αναζήτηση του μενού",
      "d.system": "Έκδοση, συντομεύσεις, σχετικά, επαναφορά",

      "a.theme": "Θέμα", "a.dark": "Σκοτεινό", "a.light": "Φωτεινό",
      "a.skin": "Χρώμα συστήματος", "a.wallpaper": "Ταπετσαρία",
      "a.wallpaper.make": "Φτιάξε τη δική σου στη Γεννήτρια ταπετσαρίας",
      "a.pet": "Συντροφάκι",
      "a.pet.hint": "Ένας μικρός σύντροφος στην επιφάνεια εργασίας. Τάισέ το, χάιδεψέ το, άφησέ το να κοιμηθεί.",
      "z.title": "Θεματική διακόσμηση", "z.on": "Διακόσμηση του desktop στις γιορτές",
      "z.hint": "Χιόνι και λαμπάκια τα Χριστούγεννα, πυροτεχνήματα την Πρωτοχρονιά, κόκκινα αυγά το Πάσχα, σημαίες στις εθνικές επετείους, κολοκύθες το Halloween. Μένουν πίσω από τα εικονίδια και δεν σε εμποδίζουν.",
      "z.motion": "Κίνηση", "z.motion.auto": "Με κίνηση", "z.motion.still": "Μόνο στατικά",
      "z.reduced": "Η συσκευή σου ζητά λιγότερη κίνηση, οπότε φαίνονται μόνο τα στατικά στολίδια.",
      "z.battery": "Η μπαταρία είναι χαμηλή, οπότε προς το παρόν φαίνονται μόνο τα στατικά στολίδια.",
      "z.amount": "Ποσότητα", "z.amount.low": "Λίγο", "z.amount.mid": "Κανονικά", "z.amount.high": "Πολύ",
      "z.xmas": "Τα Χριστούγεννα", "z.xmas.tree": "Δέντρο", "z.xmas.boat": "Καραβάκι",
      "z.today": "Σήμερα: {name}", "z.hidden": "Κρυμμένη για σήμερα",
      "z.hideToday": "Απόκρυψη για σήμερα", "z.showToday": "Εμφάνιση ξανά",
      "z.events": "Γιορτές", "z.try": "Δοκίμασέ το τώρα", "z.now": "Εμφανίζεται αυτή την περίοδο",
      "z.previewing": "Προεπισκόπηση: {name}", "z.kept": "{name}: μένει μέχρι {until}",
      "z.keep": "Κράτα το", "z.stop": "Τέλος",
      "k.dock": "Dock", "k.on": "Εμφάνιση του Dock", "k.size": "Μέγεθος",
      "k.size.s": "Μικρό", "k.size.m": "Μεσαίο", "k.size.l": "Μεγάλο",
      "k.magnify": "Μεγέθυνση στο πέρασμα του ποντικιού", "k.autohide": "Αυτόματη απόκρυψη",
      "k.over": "Εμφάνιση πάνω από ανοιχτές εφαρμογές",
      "k.style": "Στυλ", "k.style.classic": "Κλασικό", "k.style.glass": "Γυαλί",
      "k.style.frosted": "Θαμπό γυαλί", "k.style.smoke": "Καπνός", "k.style.transparent": "Διάφανο",
      "k.style.solid": "Συμπαγές", "k.style.3d": "Τρισδιάστατο ράφι", "k.style.neon": "Νέον",
      "k.hover": "Εφέ στο πέρασμα του ποντικιού", "k.hover.magnify": "Μεγέθυνση", "k.hover.bounce": "Αναπήδηση",
      "k.hover.pulse": "Παλμός", "k.hover.frame": "Πλαίσιο", "k.hover.glow": "Λάμψη",
      "k.hover.lift": "Ανύψωση", "k.hover.wiggle": "Κούνημα", "k.hover.none": "Κανένα",
      "k.empty": "Πρόσθεσε εφαρμογές με το ☆ δίπλα σε κάθε εφαρμογή στο μενού.",

      "m.apps": "Εφαρμογές στο μενού",
      "m.hint": "Βγάλε το τικ από μια εφαρμογή για να κρυφτεί από το μενού. Οι κρυφές εφαρμογές ανοίγουν ακόμα από την αναζήτηση του μενού, από συνδέσμους άλλων εφαρμογών, από την επιφάνεια εργασίας και από το Dock.",
      "m.showAll": "Εμφάνιση όλων", "m.hideAll": "Απόκρυψη όλων",
      "m.count": "Φαίνονται {n} από {total}",
      "m.filter": "Βρες εφαρμογή", "m.filter.none": "Καμία εφαρμογή δεν ταιριάζει.",
      "m.none": "Αυτή η έκδοση του orOS δεν μπορεί ακόμα να κρύβει εφαρμογές από το μενού.",

      "n.enabled": "Ειδοποιήσεις", "n.test": "Δοκιμαστική",
      "n.test.title": "Δοκιμαστική ειδοποίηση", "n.test.body": "Έτσι φαίνονται οι ειδοποιήσεις.",
      "n.position": "Θέση στην οθόνη", "n.style": "Στυλ", "n.sound": "Ήχος",
      "n.volume": "Ένταση", "n.duration": "Μένει στην οθόνη",
      "n.quiet": "Ώρες ησυχίας", "n.quiet.hint": "Χωρίς αναδυόμενα και ήχους αυτές τις ώρες. Οι ειδοποιήσεις περιμένουν στο καμπανάκι.",
      "n.phone": "Υπενθυμίσεις μέσω της εφαρμογής Android",
      "n.phone.hint": "Τα ξυπνητήρια του Ρολογιού, οι υπενθυμίσεις του Νερού και οι εργασίες του To-Do που λήγουν χτυπούν σε αυτό το κινητό ακόμα κι όταν το orOS είναι κλειστό.",
      "n.phone.allow": "Να επιτραπεί",
      "n.phone.exact": "Το Android μπορεί να τις χτυπήσει λίγα λεπτά αργότερα. Επίτρεψε τα ξυπνητήρια για ακριβή ώρα.",
      "v.hc": "Health Connect",
      "v.hc.hint": "Το Νερό και οι Προπονήσεις του orOS πηγαίνουν στο Health Connect αυτού του κινητού. Βήματα, βάρος, σφυγμοί ηρεμίας, ύπνος, πίεση, σάκχαρο και οξυγόνο, νερό και προπονήσεις από τις άλλες εφαρμογές υγείας και το ρολόι σου έρχονται στην Υγεία, στο Νερό και στις Προπονήσεις του orOS. Οι τελευταίες 30 μέρες, και προς τις δύο μεριές.",
      "v.hc.allow": "Να επιτραπεί",
      "v.hc.some": "Κάποια δεδομένα δεν επιτρέπονται. Πάτα «Να επιτραπεί» για να διαλέξεις ξανά.",
      "v.hc.update": "Το Health Connect χρειάζεται εγκατάσταση ή ενημέρωση σε αυτό το κινητό.",
      "v.hc.install": "Λήψη του Health Connect",
      "v.hc.none": "Αυτό το κινητό δεν έχει Health Connect.",
      "v.hc.last": "Τελευταία ενημέρωση {when}. Από άλλες εφαρμογές: μέρες με βήματα {steps} · ποτά {water} · προπονήσεις {wo}",
      "n.from": "Από", "n.to": "Έως", "n.apps": "Ποιες εφαρμογές ειδοποιούν",
      "n.pos.top-left": "Πάνω αριστερά", "n.pos.top": "Πάνω", "n.pos.top-right": "Πάνω δεξιά",
      "n.pos.right": "Δεξιά", "n.pos.bottom-right": "Κάτω δεξιά", "n.pos.bottom": "Κάτω",
      "n.pos.bottom-left": "Κάτω αριστερά", "n.pos.left": "Αριστερά",
      "n.sound.none": "Κανένας", "n.sound.bell": "Καμπάνα", "n.sound.ding": "Ντινγκ", "n.sound.chime": "Κουδουνάκι",
      "n.none": "Οι ειδοποιήσεις δεν υπάρχουν σε αυτή την έκδοση του orOS.",

      "y.status.off": "Χωρίς σύνδεση. Τα δεδομένα σου υπάρχουν μόνο σε αυτή τη συσκευή.",
      "y.status.locked": "Συνδεδεμένο, κλειδωμένο. Γράψε το συνθηματικό για να συγχρονιστεί αυτή η συσκευή.",
      "y.status.on": "Συνδεδεμένο, συγχρονίζεται",
      "y.status.dirty": "Αλλαγές περιμένουν να ανέβουν",
      "y.connect": "Σύνδεση με Dropbox",
      "y.connect.hint": "Όλα κρυπτογραφούνται σε αυτή τη συσκευή με το συνθηματικό σου πριν φύγουν. Το Dropbox βλέπει μόνο αρχεία που δεν διαβάζονται.",
      "y.pass": "Συνθηματικό", "y.pass.ph": "Το συνθηματικό συγχρονισμού",
      "y.pass.show": "Εμφάνιση συνθηματικού", "y.pass.hide": "Απόκρυψη συνθηματικού",
      "y.pass.hint": "Πρώτη φορά; Διάλεξε ένα με τουλάχιστον {n} χαρακτήρες και φύλαξέ το: δεν ανακτάται από κανέναν.",
      "y.remember": "Να το θυμάται αυτή η συσκευή", "y.unlock": "Ξεκλείδωμα",
      "y.pull": "Λήψη από το cloud", "y.push": "Αποστολή στο cloud",
      "y.interval": "Αυτόματος συγχρονισμός", "y.interval.off": "Ανενεργός", "y.interval.min": "κάθε {n} λεπτά", "y.interval.one": "κάθε λεπτό",
      "y.changePass": "Αλλαγή συνθηματικού",
      "y.forget": "Ξέχασε εδώ το συνθηματικό", "y.forgetVault": "Ξέχασε αυτή τη συσκευή",
      "y.disconnect": "Αποσύνδεση",
      "y.disconnect.confirm": "Πάτα ξανά για αποσύνδεση",

      "b.auto": "Αυτόματο αντίγραφο", "b.auto.off": "Ανενεργό", "b.auto.daily": "Καθημερινά",
      "b.auto.weekly": "Κάθε εβδομάδα", "b.auto.monthly": "Κάθε μήνα",
      "b.folder": "Φάκελος αντιγράφων", "b.folder.none": "Δεν έχει επιλεγεί φάκελος",
      "b.folder.choose": "Επιλογή φακέλου", "b.folder.stop": "Διακοπή χρήσης",
      "b.folder.reconnect": "Νέα άδεια", "b.folder.lapsed": "Ο browser θέλει ξανά την άδειά σου.",
      "b.folder.hint": "Το orOS γράφει αρχείο αντιγράφου σε αυτόν τον φάκελο με τη συχνότητα που διάλεξες πάνω.",
      "b.noFolder": "Αυτός ο browser δεν μπορεί να γράφει μόνος του σε φάκελο. Κάνε πού και πού εξαγωγή αρχείου.",
      "b.now": "Αντίγραφο τώρα", "b.export": "Εξαγωγή αρχείου αντιγράφου", "b.import": "Εισαγωγή αρχείου αντιγράφου",
      "b.hint": "Το αρχείο αντιγράφου ΔΕΝ είναι κρυπτογραφημένο. Φύλαξέ το σε ασφαλές μέρος.",

      "l.lang": "Γλώσσα", "l.search": "Η αναζήτηση του μενού ψάχνει σε",
      "l.search.hint": "Το πεδίο αναζήτησης στην κορυφή του μενού βρίσκει και κείμενο μέσα σε αυτές τις εφαρμογές.",
      "l.search.none": "Καμία εφαρμογή δεν προσφέρει ακόμα αναζήτηση.",

      "s.files": "Άνοιγμα αρχείων", "d.files": "Ποια εφαρμογή του orOS ανοίγει κάθε τύπο αρχείου",
      "f.status": "Άνοιγμα με το orOS",
      "f.ready": "Το orOS υπάρχει στο «Άνοιγμα με» του συστήματός σου για τους τύπους αρχείων παρακάτω. Διάλεξε εκεί το orOS για ένα αρχείο ή κάν' το προεπιλογή (πώς, παρακάτω).",
      "f.install": "Εγκατάστησε πρώτα το orOS ως εφαρμογή (Σύστημα › Εγκατάσταση του orOS ως εφαρμογή). Μετά εμφανίζεται στο «Άνοιγμα με» του συστήματός σου για αυτούς τους τύπους αρχείων.",
      "f.unsupported": "Αυτός ο browser δεν μπορεί να δίνει αρχεία της συσκευής στο orOS. Χρησιμοποίησε Chrome ή Edge σε Windows, Linux ή Mac, με εγκατεστημένο το orOS. Στο Android, κοινοποίησε το αρχείο στο orOS (Κοινοποίηση › orOS).",
      "f.none": "Το άνοιγμα αρχείων δεν υπάρχει σε αυτή την έκδοση του orOS.",
      "f.apps": "Ποια εφαρμογή ανοίγει τι",
      "f.choose": "Τύποι που ανοίγουν σε πάνω από μία εφαρμογή",
      "f.choose.hint": "Το orOS ρωτά κάθε φορά, εκτός αν διαλέξεις εδώ εφαρμογή (ή τσεκάρεις το «Πάντα» όταν ρωτά).",
      "f.ask": "Ερώτηση κάθε φορά",
      "f.how": "Το orOS ως προεπιλογή",
      "f.how.hint": "Μόνο εσύ μπορείς να ορίσεις μια εφαρμογή ως προεπιλογή, από τις ρυθμίσεις του συστήματός σου. Το orOS δεν μπορεί να το κάνει μόνο του.",
      "f.how.win": "Windows: δεξί κλικ σε αρχείο › Άνοιγμα με › Επιλογή άλλης εφαρμογής › orOS, τσέκαρε το «Να χρησιμοποιείται πάντα αυτή η εφαρμογή».",
      "f.how.linux": "Linux: δεξί κλικ σε αρχείο › Ιδιότητες › Άνοιγμα με › orOS › Ορισμός ως προεπιλογή.",
      "f.how.mac": "Mac: επίλεξε αρχείο › Λήψη πληροφοριών › Άνοιγμα με › orOS › Αλλαγή όλων.",
      "f.how.android": "Android: στα Αρχεία, στο Gmail ή σε όποια εφαρμογή, το Κοινοποίηση › orOS ανοίγει το αρχείο στη σωστή εφαρμογή του orOS (με το orOS εγκατεστημένο από Chrome). Προεπιλογή για άνοιγμα αρχείων δεν γίνεται ακόμα.",

      "s.solo": "Μεμονωμένες εφαρμογές", "d.solo": "Σημειώσεις, Ημερολόγιο και άλλες, η καθεμία ως δική της εφαρμογή",
      "so.intro": "Εγκατέστησε μια εφαρμογή του orOS μόνη της. Παίρνει δικό της εικονίδιο και παράθυρο, ανοίγει κατευθείαν στην εφαρμογή και δουλεύει χωρίς σύνδεση. Σε αυτή τη συσκευή μοιράζεται τα δεδομένα της με το orOS. Σε άλλη συσκευή, άνοιξε τον συγχρονισμό μέσα της (μενού εφαρμογής › Συγχρονισμός και cloud) για να συνδεθεί στο κρυπτογραφημένο cloud του orOS σου.",
      "so.apps": "Διαθέσιμες μεμονωμένες εφαρμογές",
      "so.open": "Εγκατάσταση",
      "so.open.title": "Ανοίγει τη σελίδα της εφαρμογής σε νέα καρτέλα, έτοιμη για εγκατάσταση",
      "so.how": "Πώς εγκαθίσταται",
      "so.how.desktop": "Windows και Linux: στη νέα καρτέλα, πάτησε Εγκατάσταση στη γραμμή διευθύνσεων του Chrome ή του Edge. Η εφαρμογή εμφανίζεται μετά στο μενού Έναρξη ή στη λίστα εφαρμογών.",
      "so.how.android": "Android: η Εγκατάσταση ανοίγει την εφαρμογή στο Chrome· από την εφαρμογή orOS, στον προεπιλεγμένο σου browser (στο Chrome αν δεν έχεις ορίσει). Πάτησε Εγκατάσταση στη γραμμή κάτω, ή άνοιξε το μενού του browser και πάτησε Προσθήκη στην αρχική οθόνη › Εγκατάσταση.",
      "so.how.iphone": "iPhone: στο Safari, Κοινοποίηση › Προσθήκη στην οθόνη Αφετηρίας.",
      "so.none": "Οι μεμονωμένες εφαρμογές δεν υπάρχουν σε αυτή την έκδοση του orOS.",

      "s.services": "Συνδεδεμένες υπηρεσίες", "d.services": "Το κατάστημά σου και άλλες πλατφόρμες που δουλεύουν με το orOS",
      "v.intro": "Σύνδεσε το orOS με πλατφόρμες που ήδη χρησιμοποιείς. Τα κλειδιά τους μένουν κλειδωμένα σε αυτή τη συσκευή: οι εφαρμογές ζητούν από το σύστημα και δεν τα βλέπουν ποτέ.",
      "v.none": "Δεν έχεις συνδέσει τίποτα ακόμα.", "v.unsupported": "Αυτή η έκδοση του orOS δεν έχει ακόμα συνδεδεμένες υπηρεσίες.",
      "v.add": "Σύνδεση υπηρεσίας", "v.platform": "Πλατφόρμα", "v.name": "Όνομα", "v.name.ph": "Το κατάστημά μου",
      "v.site": "Διεύθυνση καταστήματος", "v.site.ph": "shop.example.gr",
      "v.ck": "Consumer key", "v.cs": "Consumer secret",
      "v.keys.hint": "Στο WordPress: WooCommerce › Ρυθμίσεις › Για προχωρημένους › REST API › Προσθήκη κλειδιού, δικαιώματα Ανάγνωση/Εγγραφή. Αντίγραψε εδώ και τα δύο κλειδιά.",
      "v.save": "Σύνδεση", "v.cancel": "Άκυρο", "v.checking": "Έλεγχος…",
      "v.test": "Έλεγχος σύνδεσης", "v.ok": "Συνδέθηκε: το κατάστημα απαντά.",
      "v.via": "Διαδρομή", "v.via.direct": "Απευθείας από αυτόν τον browser", "v.via.query": "Απευθείας από αυτόν τον browser (κλειδιά στη διεύθυνση)",
      "v.via.relay": "Μέσω του relay του orOS", "v.via.none": "Δεν έχει χρησιμοποιηθεί ακόμα σε αυτή τη συσκευή",
      "v.used": "Το χρησιμοποιεί", "v.keysHere": "Τα κλειδιά είναι σε αυτή τη συσκευή", "v.keysMissing": "Τα κλειδιά δεν είναι ακόμα σε αυτή τη συσκευή",
      "v.newKeys": "Πέρασε τα κλειδιά", "v.saveKeys": "Αποθήκευση κλειδιών",
      "v.ks": "Τα κλειδιά σε όλες τις συσκευές μου",
      "v.ks.hint": "Τα κλειδιά ταξιδεύουν μέσα στον κρυπτογραφημένο συγχρονισμό, κλειδωμένα με το συνθηματικό συγχρονισμού. Όποιος ξέρει το συνθηματικό μπορεί να τα χρησιμοποιήσει.",
      "v.ks.needSync": "Σύνδεσε και ξεκλείδωσε πρώτα τον συγχρονισμό.",
      "v.rename": "Μετονομασία", "v.remove": "Αποσύνδεση", "v.remove.confirm": "Πάτα ξανά για αποσύνδεση",
      "v.remove.hint": "Η αποσύνδεση σβήνει τον λογαριασμό και τα κλειδιά του από όλες τις συσκευές. Τίποτα στις εφαρμογές σου δεν σβήνεται.",
      "v.open": "Άνοιγμα: {app}",
      "v.err.offline": "Είσαι εκτός σύνδεσης.", "v.err.auth": "Το κατάστημα δεν δέχτηκε τα κλειδιά. Έλεγξέ τα και ότι έχουν δικαίωμα Ανάγνωση/Εγγραφή.",
      "v.err.notfound": "Δεν υπάρχει WooCommerce REST API σε αυτή τη διεύθυνση.", "v.err.network": "Το κατάστημα δεν απάντησε, ούτε μέσω του relay του orOS.",
      "v.err.relay": "Το κατάστημα δεν απαντά σε αυτόν τον browser και δεν απάντησε ούτε το relay του orOS.", "v.err.server": "Το κατάστημα απάντησε με σφάλμα.",
      "v.err.busy": "Το κατάστημα ζητά λίγη αναμονή. Δοκίμασε ξανά σε ένα λεπτό.", "v.err.keys": "Τα κλειδιά δεν είναι σε αυτή τη συσκευή. Πέρασέ τα ξανά.",
      "v.err.site": "Γράψε τη διεύθυνση https ενός δημόσιου site.", "v.err.badkeys": "Έλεγξε τα κλειδιά: αρχίζουν με ck_ και cs_ και έχουν 43 χαρακτήρες το καθένα.",
      "v.err.full": "Έχεις συνδέσει όσες υπηρεσίες κρατά το orOS.", "v.err.save": "Δεν αποθηκεύτηκε: ο χώρος της συσκευής γέμισε.",
      "v.err.denied": "Το orOS δεν επιτρέπει αυτή την κλήση.", "v.err.gone": "Αυτός ο λογαριασμός αποσυνδέθηκε.",
      "v.plat.woo": "Κατάστημα WooCommerce (Απόθεμα)", "v.plat.tol": "timologisi.online (Τιμολόγια → myDATA)",
      "v.plat.tol.hint": "Πιστοποιημένος πάροχος ηλεκτρονικής τιμολόγησης: τα Τιμολόγια στέλνουν μέσω αυτού τιμολόγια, αποδείξεις και πιστωτικά στο myDATA (ΑΑΔΕ). Χρεώνει μονάδες ανά παραστατικό.",
      "v.env": "Περιβάλλον", "v.env.test": "Δοκιμαστικό (sandbox)", "v.env.live": "Παραγωγής (πραγματικά παραστατικά)",
      "v.vat": "ΑΦΜ εκδότη", "v.vat.ph": "9 ψηφία", "v.key": "API key",
      "v.keys.hint.tol": "Αντίγραψε εδώ το API key από το portal του timologisi.online: developer.portal.timologisi.online για δοκιμές, portal.timologisi.online για πραγματικά παραστατικά. Τα κλειδιά δοκιμών και παραγωγής είναι διαφορετικά.",
      "v.ok.tol": "Συνδέθηκε. Υπόλοιπο μονάδων: {n}", "v.err.vat": "Γράψε το 9ψήφιο ΑΦΜ για το οποίο εκδίδει ο λογαριασμός.",
      "v.err.badkeys.tol": "Έλεγξε το API key: αντίγραψέ το ολόκληρο, χωρίς κενά.",
      "v.err.auth.tol": "Το timologisi.online δεν δέχτηκε το κλειδί. Έλεγξε ότι είναι του σωστού περιβάλλοντος (δοκιμαστικό ή παραγωγής).",
      "v.err.notfound.tol": "Το timologisi.online απάντησε «δεν βρέθηκε».", "v.err.network.tol": "Το timologisi.online δεν απάντησε, ούτε μέσω του relay του orOS.",
      "v.err.relay.tol": "Το timologisi.online δεν απαντά σε αυτόν τον browser και δεν απάντησε ούτε το relay του orOS.", "v.err.server.tol": "Το timologisi.online απάντησε με σφάλμα.",
      "v.plat.mlite": "MailerLite (Newsletter)", "v.plat.mchimp": "Mailchimp (Newsletter)", "v.plat.brevo": "Επαφές Brevo (Newsletter)",
      "v.plat.mlite.hint": "Το Newsletter συγχρονίζει μια λίστα με ένα group του MailerLite: συνδρομητές και διαγραφές και προς τις δύο μεριές.",
      "v.plat.mchimp.hint": "Το Newsletter συγχρονίζει μια λίστα με ένα audience του Mailchimp: συνδρομητές και διαγραφές και προς τις δύο μεριές. Το Mailchimp απαντά μόνο σε servers, οπότε περνά πάντα από το relay του orOS.",
      "v.plat.brevo.hint": "Το Newsletter συγχρονίζει μια λίστα με μια λίστα επαφών του Brevo: συνδρομητές και διαγραφές και προς τις δύο μεριές. (Η αποστολή μέσω Brevo μένει στο Newsletter › Λογαριασμοί αποστολής.)",
      "v.keys.hint.mlite": "Στο MailerLite: Integrations › API › Generate new token. Αντίγραψε εδώ ολόκληρο το token.",
      "v.keys.hint.mchimp": "Στο Mailchimp: Profile › Extras › API keys › Create a key. Τελειώνει με το data centre σου, π.χ. -us21.",
      "v.keys.hint.brevo": "Στο Brevo: SMTP & API › API keys › Generate a new API key. Αρχίζει με xkeysib-.",
      "v.err.badkeys.mchimp": "Έλεγξε το API key: 32 γράμματα και ψηφία, παύλα και το data centre (π.χ. -us21).",
      "v.err.badkeys.brevo": "Έλεγξε το API key: αρχίζει με xkeysib-.", "v.err.badkeys.mlite": "Έλεγξε το token: αντίγραψέ το ολόκληρο, χωρίς κενά.",
      "v.plat.hubspot": "HubSpot (CRM)", "v.plat.pdrive": "Pipedrive (CRM)",
      "v.plat.hubspot.hint": "Το CRM φέρνει τις εταιρείες, τις επαφές και τα deals του HubSpot. Το orOS μόνο διαβάζει: στο HubSpot δεν αλλάζει τίποτα. Το HubSpot απαντά μόνο σε servers, οπότε περνά πάντα από το relay του orOS.",
      "v.plat.pdrive.hint": "Το CRM φέρνει τους οργανισμούς, τα άτομα, τα deals και τις ανοιχτές δραστηριότητες του Pipedrive. Το orOS μόνο διαβάζει: στο Pipedrive δεν αλλάζει τίποτα.",
      "v.keys.hint.hubspot": "Στο HubSpot: Settings › Integrations › Private apps › Create a private app, με δικαιώματα ανάγνωσης (read) σε contacts, companies και deals. Αντίγραψε το access token του (αρχίζει με pat-).",
      "v.keys.hint.pdrive": "Στο Pipedrive: το προφίλ σου › Personal preferences › API. Αντίγραψε το προσωπικό API token (40 χαρακτήρες).",
      "v.err.badkeys.hubspot": "Έλεγξε το token: αρχίζει με pat- (το access token ενός private app).", "v.err.badkeys.pdrive": "Έλεγξε το API token: 40 γράμματα και ψηφία.",
      "v.plat.odoo": "Odoo (CRM)", "v.site.odoo": "Διεύθυνση Odoo", "v.site.ph.odoo": "yourcompany.odoo.com ή η δική σου διεύθυνση",
      "v.db": "Βάση δεδομένων", "v.db.ph": "Μόνο αν ο server έχει πολλές", "v.err.db": "Έλεγξε το όνομα της βάσης: γράμματα, ψηφία, τελείες, παύλες και κάτω παύλες.",
      "v.plat.odoo.hint": "Το CRM φέρνει τις επαφές του Odoo (εταιρείες με τα άτομά τους, ΑΦΜ) και τις ευκαιρίες ως deals. Το orOS μόνο διαβάζει: στο Odoo δεν αλλάζει τίποτα. Χρειάζεται Odoo 19 ή Odoo Online (το JSON-2 API).",
      "v.keys.hint.odoo": "Στο Odoo: το avatar σου › Οι προτιμήσεις μου › Ασφάλεια λογαριασμού › Νέο κλειδί API (άνοιξε τη λειτουργία προγραμματιστή αν δεν το βλέπεις). Αντίγραψε εδώ το κλειδί· διαβάζει ό,τι μπορεί ο χρήστης σου στο Odoo.",
      "v.err.badkeys.odoo": "Έλεγξε το κλειδί API: γράμματα και ψηφία, αντιγραμμένο ολόκληρο.",
      "v.plat.ininja": "Invoice Ninja (CRM, Έσοδα & Έξοδα)", "v.site.ininja": "Διεύθυνση Invoice Ninja", "v.site.ph.ininja": "invoicing.co ή η δική σου διεύθυνση",
      "v.plat.ininja.hint": "Το CRM φέρνει τους πελάτες του (με τις επαφές και το ΑΦΜ τους), τα Έσοδα & Έξοδα τις πληρωμές του. Το orOS μόνο διαβάζει: στο Invoice Ninja δεν αλλάζει τίποτα. Γράψε invoicing.co για την υπηρεσία τους ή τη διεύθυνση της δικής σου εγκατάστασης.",
      "v.keys.hint.ininja": "Στο Invoice Ninja: Settings › Account management › Integrations › API tokens › New token. Αντίγραψε εδώ το token.",
      "v.err.badkeys.ininja": "Έλεγξε το API token: μόνο γράμματα και ψηφία, αντιγραμμένο ολόκληρο.",
      "v.plat.stripe": "Stripe (Έσοδα & Έξοδα)",
      "v.plat.stripe.hint": "Τα Έσοδα & Έξοδα φέρνουν τις πληρωμές σου από το Stripe: οι χρεώσεις ως έσοδα, οι προμήθειες, οι επιστροφές και οι αμφισβητήσεις ως έξοδα. Το orOS μόνο διαβάζει: στο Stripe δεν αλλάζει τίποτα. Περνά πάντα από το relay του orOS.",
      "v.keys.hint.stripe": "Στο Stripe: Developers › API keys › Create restricted key, με δικαίωμα Read μόνο στο Balance. Αρχίζει με rk_live_ (ή rk_test_). Το orOS δεν δέχεται το secret key (sk_).",
      "v.err.badkeys.stripe": "Χρησιμοποίησε restricted key: αρχίζει με rk_live_ ή rk_test_. Το secret key (sk_) δεν γίνεται δεκτό.",
      "v.plat.todoist": "Todoist (To-Do)",
      "v.plat.todoist.hint": "Το To-Do φέρνει τα projects και τις ανοιχτές εργασίες σου από το Todoist (προθεσμίες, περιγραφές, ετικέτες, προτεραιότητα). Το orOS μόνο διαβάζει: στο Todoist δεν αλλάζει τίποτα.",
      "v.keys.hint.todoist": "Στο Todoist: Ρυθμίσεις › Ενσωματώσεις › Developer › API token. Αντίγραψε εδώ το token (40 χαρακτήρες). Μπορεί να διαβάσει και να αλλάξει τα πάντα στο Todoist σου· το orOS μόνο διαβάζει.",
      "v.err.badkeys.todoist": "Έλεγξε το API token: 40 γράμματα (a–f) και ψηφία.",
      "v.plat.trello": "Trello (Kanban)", "v.plat.github": "GitHub (Kanban, To-Do)", "v.token": "Token",
      "v.plat.trello.hint": "Το Kanban διαβάζει τους πίνακές σου στο Trello (λίστες, κάρτες, ετικέτες, checklists) όταν κάνεις εισαγωγή. Το orOS μόνο διαβάζει: στο Trello δεν αλλάζει τίποτα.",
      "v.keys.hint.trello": "Στο Trello: trello.com/power-ups/admin › New (ένα Power-Up για σένα) › API key. Αντίγραψε εδώ το API key, μετά άνοιξε τον σύνδεσμο Token δίπλα του, επίτρεψε την πρόσβαση και αντίγραψε και το token.",
      "v.err.badkeys.trello": "Έλεγξε και τα δύο: το API key έχει 32 γράμματα (a–f) και ψηφία, το token 64 ή περισσότερα γράμματα και ψηφία.",
      "v.plat.github.hint": "Το Kanban διαβάζει τα issues ενός αποθετηρίου (ανοιχτά και κλειστά, ετικέτες, ημερομηνίες milestone, λίστες εργασιών) όταν κάνεις εισαγωγή· το To-Do διαβάζει τα ανοιχτά issues που σου έχουν ανατεθεί. Το orOS μόνο διαβάζει: στο GitHub δεν αλλάζει τίποτα.",
      "v.keys.hint.github": "Στο GitHub: Settings › Developer settings › Personal access tokens › Fine-grained tokens › Generate new token, με πρόσβαση μόνο ανάγνωσης σε Issues (και Metadata) για τα αποθετήρια που θέλεις. Αντίγραψε εδώ το token (αρχίζει με github_pat_).",
      "v.err.badkeys.github": "Έλεγξε το token: αρχίζει με github_pat_ (ή ghp_ για κλασικό token).",
      "v.plat.raindrop": "Raindrop.io (Σελιδοδείκτες)",
      "v.plat.raindrop.hint": "Οι Σελιδοδείκτες φέρνουν τις συλλογές και τους σελιδοδείκτες σου από το Raindrop.io (τίτλους, σημειώσεις, ετικέτες, αγαπημένα). Το orOS μόνο διαβάζει: στο Raindrop δεν αλλάζει τίποτα.",
      "v.keys.hint.raindrop": "Στο Raindrop.io: Settings › Integrations › For developers › Create new app (όποιο όνομα) › άνοιξέ το › Create test token. Αντίγραψε εδώ το test token.",
      "v.err.badkeys.raindrop": "Έλεγξε το test token: γράμματα, ψηφία και παύλες, όπως 1a2b3c4d-….",
      "v.plat.notion": "Notion (Σημειώσεις, Υπολογιστικό φύλλο, Kanban)",
      "v.plat.notion.hint": "Οι Σημειώσεις φέρνουν τις σελίδες του Notion που μοιράζεσαι με την ενσωμάτωσή σου, ως σημειωματάριο· το Υπολογιστικό φύλλο φέρνει τις βάσεις δεδομένων της, ένα φύλλο για την καθεμία, και το Kanban μία βάση ως πίνακα. Το orOS μόνο διαβάζει: στο Notion δεν αλλάζει τίποτα. Το Notion δεν απαντά σε browsers, οπότε περνά πάντα από το relay του orOS (που δεν κρατά τίποτα).",
      "v.keys.hint.notion": "Στο Notion: notion.so/profile/integrations › New integration (Internal, μόνο Read content) › αντίγραψε εδώ το Internal Integration Secret (αρχίζει με ntn_ ή secret_). Μετά άνοιξε στο Notion κάθε σελίδα ή βάση δεδομένων που θέλεις, ••• › Connections › πρόσθεσε την ενσωμάτωση (έρχεται και ό,τι έχει μέσα).",
      "v.err.badkeys.notion": "Έλεγξε το secret: αρχίζει με ntn_ (ή secret_ για τα παλιότερα).",
      "v.ok.svc": "Συνδέθηκε: το {name} απαντά.",
      "v.err.auth.svc": "Το {name} δεν δέχτηκε το κλειδί. Έλεγξέ το και ότι δεν έχει διαγραφεί εκεί.",
      "v.err.notfound.svc": "Το {name} απάντησε «δεν βρέθηκε».", "v.err.network.svc": "Το {name} δεν απάντησε, ούτε μέσω του relay του orOS.",
      "v.err.relay.svc": "Το {name} δεν απαντά σε αυτόν τον browser και δεν απάντησε ούτε το relay του orOS.", "v.err.server.svc": "Το {name} απάντησε με σφάλμα.",
      "v.err.busy.svc": "Το {name} ζητά να πάμε πιο αργά. Δοκίμασε ξανά σε ένα λεπτό.",
      "v.err.busy.tol": "Το timologisi.online ζητά λίγη αναμονή. Δοκίμασε ξανά σε ένα λεπτό.",

      "x.version": "Έκδοση orOS", "x.updates": "Έλεγχος για ενημέρωση",
      "x.install": "Εγκατάσταση του orOS ως εφαρμογή", "x.install.hint": "Ανοίγει σε δικό του παράθυρο, δουλεύει offline, ξεκινά από την αρχική οθόνη.",
      "x.shortcuts": "Συντομεύσεις πληκτρολογίου", "x.more": "Περισσότερα",
      "x.device": "Πληροφορίες συσκευής", "x.about": "Σχετικά με το orOS, credits και άδειες",
      "x.apps": "Ρυθμίσεις μέσα σε εφαρμογές", "x.weather": "Ο καιρός στη γραμμή εργασιών",
      "x.wallgen": "Γεννήτρια ταπετσαρίας",
      "x.reset": "Επαναφορά εργοστασιακών", "x.reset.confirm": "Πάτα ξανά για να σβηστούν όλα",
      "x.reset.hint": "Οριστικό: σβήνει όλα τα δεδομένα και τις ρυθμίσεις του orOS σε αυτή τη συσκευή, τα αντίγραφα στον φάκελο αντιγράφων, όλα τα δεδομένα και τα αντίγραφα στο cloud, και τη σύνδεση Dropbox αυτής της συσκευής, και ξεκινά το orOS σαν καινούργιο. Επανάλαβε στις άλλες συσκευές σου. Κάνε πρώτα εξαγωγή αρχείου αν μπορεί να χρειαστείς κάτι.",
      "x.reset.working": "Σβήνονται…"
    }
  };

  function langOf(v) { return v === "el" ? "el" : "en"; }

  function t(lang, key, vars) {
    var s = STRINGS[langOf(lang)][key];
    if (s === undefined) s = STRINGS.en[key];
    if (s === undefined) return key;
    if (vars) {
      Object.keys(vars).forEach(function (k) {
        s = s.split("{" + k + "}").join(String(vars[k]));
      });
    }
    return s;
  }

  function isSection(id) { return SECTIONS.indexOf(id) !== -1; }

  // A deep-link target ({ section }) or a stored id → a known section,
  // else null. Never trusts the shape it is given.
  function sectionOf(target) {
    var id = (target && typeof target === "object") ? target.section : target;
    return (typeof id === "string" && isSection(id)) ? id : null;
  }

  function scopeOf(name) { return SCOPE[name] || "device"; }

  // Case-, accent- and final-ς-insensitive, like the menu search.
  function fold(v) {
    var s = String(v == null ? "" : v).toLowerCase();
    try { s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (e) {}
    return s.replace(/ς/g, "σ");
  }

  // Menu apps for the Settings list: filtered by `query` (name, id or
  // category), grouped by category, groups and apps sorted by their
  // shown names in the UI language.
  function menuGroups(apps, query, lang) {
    var q = fold(String(query || "").trim());
    var loc = langOf(lang);
    var cmp = function (a, b) {
      var r = 0;
      try { r = a.localeCompare(b, loc, { sensitivity: "base" }); } catch (e) { r = 0; }
      return r || (a < b ? -1 : a > b ? 1 : 0);
    };
    var byCat = {};
    (Array.isArray(apps) ? apps : []).forEach(function (a) {
      if (!a || typeof a.id !== "string") return;
      if (q && [a.name, a.id, a.catName].every(function (f) { return fold(f).indexOf(q) === -1; })) return;
      var c = String(a.cat || "other");
      (byCat[c] = byCat[c] || { cat: c, name: String(a.catName || c), apps: [] }).apps.push(a);
    });
    return Object.keys(byCat).map(function (c) {
      byCat[c].apps.sort(function (x, y) { return cmp(String(x.name), String(y.name)); });
      return byCat[c];
    }).sort(function (x, y) { return cmp(x.name, y.name); });
  }

  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function hourLabel(h) { return pad2(h) + ":00"; }

  // The same full shape the menu writes (isQuietHour reads the numbers,
  // from/to strings ride along for older consumers).
  function quietValue(enabled, start, end) {
    return { enabled: !!enabled, quietHoursStart: start, quietHoursEnd: end,
             from: hourLabel(start), to: hourLabel(end) };
  }
  function readQuiet(v) {
    v = (v && typeof v === "object") ? v : {};
    var s = (typeof v.quietHoursStart === "number" && v.quietHoursStart >= 0 && v.quietHoursStart <= 23) ? v.quietHoursStart : 22;
    var e = (typeof v.quietHoursEnd === "number" && v.quietHoursEnd >= 0 && v.quietHoursEnd <= 23) ? v.quietHoursEnd : 8;
    return { enabled: !!v.enabled, start: s, end: e };
  }

  function intervalLabel(lang, m) {
    if (m === 0) return t(lang, "y.interval.off");
    return t(lang, m === 1 ? "y.interval.one" : "y.interval.min", { n: m });
  }

  function syncState(sync) {
    if (!sync || !sync.available || !sync.connected) return "off";
    if (!sync.unlocked) return "locked";
    return sync.dirty ? "dirty" : "on";
  }

  var api = {
    SECTIONS: SECTIONS, SCOPE: SCOPE, STRINGS: STRINGS,
    POSITIONS: POSITIONS, STYLES: STYLES, SOUNDS: SOUNDS, DURATIONS: DURATIONS,
    t: t, langOf: langOf, isSection: isSection, sectionOf: sectionOf, scopeOf: scopeOf,
    hourLabel: hourLabel, quietValue: quietValue, readQuiet: readQuiet,
    intervalLabel: intervalLabel, syncState: syncState, fold: fold, menuGroups: menuGroups
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.SettingsCore = api;
})(typeof window !== "undefined" ? window : null);
