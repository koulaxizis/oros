// ============================================================
// orOS Travel — App logic (v1.0.0)
// Trips with a packing list, templates and an itinerary.
//   - trips: destination, dates, travellers, notes; countdown
//   - packing list in groups, quantities that follow the trip's
//     days ("1 per day", "1 every 2 days"), "Before I leave" list
//   - templates: 10 ready ones (bilingual, combinable) + your own
//     ("save trip as template"); a ready one can be edited or hidden
//   - itinerary per day: flights, trains, ferries, stays (nights
//     without a stay are flagged), activities, food
//   - export / import (JSON, merge), text, .ics, print
//   - places open in Maps through the shell bridge
// Data:
//   - synced slice "travel" (oros-travel-data): trips, their packing
//     items and itinerary entries carry one stamp PER FIELD (`f`,
//     the To-Do pattern): the newer stamp wins each field, so a tick
//     on the phone and a quantity changed on the desktop both stay.
//     Templates: whole-entity LWW. Tombstones max-merged, delete wins
//     ties, a newer edit resurrects (R5, R17, R26, R27).
//   - device-local (R10): oros-travel-prefs (open trip, tab, filters)
// Sections:
//   1. Constants, i18n, helpers
//   2. Model: normalize, merge, templates, days
//   3. Text + iCalendar builders
//   4. Storage + prefs
//   5. Mutations
//   6. Rendering: toolbar, trip list, trip view, templates view
//   7. Dialogs
//   8. Menus, export / import, share, print
//   9. Toasts + keyboard (Contract Β)
//  10. Sync slice + palette
//  11. Wiring & boot
// ============================================================
(function () {
  "use strict";

  function appLang() {
    try {
      var l = localStorage.getItem("oros-lang") ||
              (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  var LANG = appLang();

  // ---------- 1. Constants, i18n, helpers ----------
  var STORAGE_KEY  = "oros-travel-data";
  var PREFS_KEY    = "oros-travel-prefs";
  var DATA_VER     = 1;
  var DAY_MS       = 86400000;
  var TOMB_TTL     = 180 * DAY_MS;      // pruned against the newest stamp in the data, never the clock
  var NO_DATE_DAYS = 3;                 // quantities of a trip without dates
  var MAX_TRIPS = 200, MAX_PACK = 500, MAX_PLAN = 300, MAX_TPLS = 60, MAX_TPL_ITEMS = 200;
  var MAX_PEOPLE = 8, MAX_DAYS = 90, MAX_QTY = 99;
  var MAX_DOCS = 300, MAX_DOCS_PER = 10, MAX_SPEND = 1000, MAX_CENTS = 100000000000;
  var LEN = { name: 80, dest: 100, notes: 20000, person: 30, item: 80, grp: 30, note: 300,
              title: 100, place: 150, stop: 60, ref: 60, pnote: 1000, tpl: 50,
              num: 20, prov: 60, what: 80, jtext: 5000, fname: 80 };
  var GROUPS = ["clothes", "toilet", "health", "tech", "docs", "baby", "gear", "food", "misc", "before"];
  var KINDS  = ["flight", "train", "bus", "ferry", "car", "rental", "stay", "ticket", "activity", "food", "other"];
  var MOVES  = { flight: 1, train: 1, bus: 1, ferry: 1, car: 1 };
  // Wave 31: currency + planned budget + destination point on the trip;
  // number, company, price, map points on an entry; three new lists per
  // trip (attachments, expenses, journal days), each item with its own
  // field stamps like the packing items (old trips load with defaults).
  var TRIP_F = ["name", "dest", "start", "end", "people", "notes", "cur", "bplan", "geo"];
  var PACK_F = ["name", "qty", "rule", "grp", "who", "note", "done"];
  var PLAN_F = ["kind", "title", "day", "t1", "day2", "t2", "place", "from", "to", "ref", "note", "pos",
                "num", "prov", "cost", "ccur", "geo", "geo0"];
  var DOC_F  = ["of", "file", "name"];
  var SPEND_F = ["cat", "amt", "cur", "day", "what", "who"];
  var JRNL_F = ["day", "text", "trk"];
  var LISTS  = ["pack", "plan", "docs", "spend", "jrnl"];
  var BUD_CATS = ["transport", "stay", "food", "fun", "shop", "other"];
  var CURRENCIES = ["EUR", "USD", "GBP", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK",
                    "HUF", "RON", "BGN", "TRY", "CAD", "AUD", "JPY"];
  var FILE_DIR = "/internal/Travel";
  var FILE_RE = /^[a-z0-9][a-z0-9-]{3,40}\.(jpg|pdf)$/;
  var TRK_RE = /^[a-z0-9]{6,40}$/;                 // a Maps track id (maps/tracks-core.js)
  var ID_RE  = /^[a-z0-9][a-z0-9-]{3,40}$/;
  var YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  var HM_RE  = /^([01]\d|2[0-3]):[0-5]\d$/;

  var STRINGS = {
    en: {
      "app": "Travel", "btn.new": "New trip", "btn.tpls": "Templates", "btn.back": "Back", "btn.more": "More",
      "btn.newTpl": "New template",
      "list.now": "Travelling now", "list.next": "Upcoming", "list.idea": "No dates yet", "list.past": "Past trips ({n})",
      "list.empty": "No trips yet. Plan your first one: dates, packing list and itinerary in one place.",
      "cd.today": "Leaving today", "cd.tomorrow": "Tomorrow", "cd.in": "In {n} days", "cd.day": "Day {d} of {n}",
      "cd.ended": "Ended", "cd.nodate": "No dates",
      "nights.0": "Day trip", "nights.1": "1 night", "nights.n": "{n} nights",
      "pack.count": "{d}/{n} packed", "pack.none": "Empty list",
      "tab.pack": "Packing", "tab.plan": "Itinerary", "tab.notes": "Notes", "tab.both": "Packing & itinerary",
      "pack.add": "Add an item…", "pack.addBtn": "Add item", "pack.missing": "Still to pack", "pack.everyone": "Everyone",
      "pack.uncheck": "Uncheck all", "pack.fromTpl": "From a template",
      "pack.empty": "The list is empty. Add items above or start from a template.",
      "pack.done": "All packed. Have a great trip!", "pack.filtered": "Nothing left to pack here.",
      "pack.check": "Packed: {name}", "pack.edit": "Edit {name}", "pack.grpSel": "Group of the new item",
      "pack.whoSel": "Show the items of",
      "grp.clothes": "Clothes", "grp.toilet": "Toiletries", "grp.health": "Health", "grp.tech": "Electronics",
      "grp.docs": "Documents & money", "grp.baby": "Baby", "grp.gear": "Gear", "grp.food": "Food & drinks",
      "grp.misc": "Other", "grp.before": "Before I leave", "grp.custom": "New group…",
      "plan.add": "Add to the itinerary", "plan.addDay": "Add to {day}", "plan.undated": "No day yet",
      "plan.other": "Other dates", "plan.dayN": "Day {n}",
      "plan.empty": "Nothing planned yet. Add flights, stays and the things you want to do.",
      "plan.gap1": "No stay for the night of {days}", "plan.gapN": "No stay for {n} nights: {days}",
      "plan.night": "Night: {name}", "plan.checkout": "Check-out: {name}", "plan.maps": "Open in Maps",
      "plan.up": "Move up", "plan.down": "Move down",
      "kind.flight": "Flight", "kind.train": "Train", "kind.bus": "Bus", "kind.ferry": "Ferry", "kind.car": "Car",
      "kind.stay": "Stay", "kind.activity": "Activity", "kind.food": "Food", "kind.other": "Other",
      "notes.ph": "Addresses, phone numbers, the embassy, the Wi-Fi password…",
      "head.people": "Travellers: {list}", "head.maps": "Destination in Maps",
      "dlg.newTrip": "New trip", "dlg.editTrip": "Edit trip", "dlg.editItem": "Edit item",
      "dlg.newPlan": "Add to the itinerary", "dlg.editPlan": "Itinerary entry", "dlg.applyTpl": "Add from a template",
      "dlg.applyHint": "Only what is missing is added; ticks stay as they are.",
      "dlg.dup": "Copy trip", "dlg.dupHint": "The copy starts with nothing packed; the itinerary moves with the new dates.",
      "dlg.saveTpl": "Save as template", "dlg.newTpl": "New template", "dlg.editTpl": "Template",
      "dlg.import": "Import", "dlg.save": "Save", "dlg.cancel": "Cancel", "dlg.delete": "Delete", "dlg.hide": "Hide",
      "dlg.add": "Add", "dlg.create": "Create",
      "f.name": "Name", "f.namePh": "e.g. Rome 2026", "f.dest": "Destination", "f.destPh": "City, country",
      "f.start": "From", "f.end": "To", "f.people": "Travellers (comma-separated)", "f.peoplePh": "e.g. Chris, Maria",
      "f.tpls": "Start the packing list from", "f.qty": "Quantity", "f.grp": "Group", "f.grpName": "Group name",
      "f.who": "Who takes it", "f.anyone": "Anyone", "f.note": "Note", "f.kind": "Type", "f.title": "Title",
      "f.titleStay": "Hotel or place to stay", "f.day": "Day", "f.noday": "No day", "f.time": "Time", "f.ends": "Ends",
      "f.dep": "Departs", "f.arr": "Arrives", "f.arrDay": "Arrival day", "f.sameDay": "Same day",
      "f.in": "Check-in", "f.out": "Check-out", "f.inTime": "Check-in time", "f.outTime": "Check-out time",
      "f.place": "Place or address", "f.from": "From", "f.to": "To", "f.ref": "Booking code", "f.pnote": "Notes",
      "f.newStart": "New start date", "f.item": "Item", "f.qtyMode": "Quantity",
      "rule.fix": "Fixed", "rule.day": "Per day", "rule.every": "One every N days",
      "rule.hintDay": "{n} per day: follows the trip's days", "rule.hintEvery": "1 every {n} days: follows the trip's days",
      "rule.nodate": "Without dates, quantities count {n} days.",
      "tpl.items": "{n} items", "tpl.items1": "1 item", "tpl.edited": "edited", "tpl.restore": "Restore ready templates",
      "tpl.ready": "Ready templates", "tpl.mine": "My templates", "tpl.add": "Add item",
      "tpl.mineEmpty": "Save a trip as a template, or make a new one.",
      "tpl.hint": "A ready template can be edited or hidden; restoring brings it back as shipped.",
      "tpl.none": "No templates", "tpl.row": "Item {n}", "tpl.del": "Remove item {n}",
      "import.found": "In the file: trips {trips}, templates {tpls}. They are merged with yours; nothing is overwritten.",
      "menu.export": "Export all (JSON)", "menu.import": "Import (JSON)", "menu.edit": "Edit trip",
      "menu.text": "Copy as text", "menu.share": "Share as text", "menu.ics": "Export for a calendar (.ics)",
      "menu.print": "Print", "menu.dup": "Copy trip", "menu.tpl": "Save as template", "menu.del": "Delete trip",
      "toast.undo": "Undo", "toast.tripDel": "Trip deleted", "toast.itemDel": "Item deleted",
      "toast.planDel": "Entry deleted", "toast.tplDel": "Template deleted", "toast.tplHid": "Template hidden",
      "toast.unchecked": "Everything unchecked", "toast.copied": "Copied to clipboard", "toast.copyFail": "Could not copy",
      "toast.exported": "Exported", "toast.imported": "Imported: trips {trips}, templates {tpls}",
      "toast.importBad": "This file is not an orOS Travel export", "toast.save": "Could not save: storage is full",
      "toast.needName": "Give it a name", "toast.dates": "The end date is before the start",
      "toast.tplSaved": "Template saved", "toast.added": "Items added: {n}",
      "toast.addedNone": "Nothing new: everything is already on the list", "toast.max": "Limit reached ({n})",
      "toast.restored": "Ready templates restored", "toast.gone": "This trip was deleted on another device",
      "toast.pickTpl": "Pick at least one template", "toast.tplEmpty": "A template needs at least one item",
      "copy.suffix": "{name} (copy)",
      "txt.dest": "Destination", "txt.people": "Travellers", "txt.pack": "PACKING", "txt.plan": "ITINERARY",
      "txt.notes": "NOTES", "txt.ref": "booking", "txt.undated": "No day", "txt.packed": "{d}/{n} packed",
      "menu.todoBefore": "Send \u201cBefore I leave\u201d to To-Do", "menu.todoPack": "Send \u201cStill to pack\u201d to To-Do",
      "todo.before": "{trip} · before I leave", "todo.pack": "{trip} · to pack", "todo.qty": "{n} × {name}",
      "menu.fuel": "Fuel cost by car", "fuel.title": "Fuel cost by car", "fuel.car": "Vehicle (from Garage)",
      "fuel.manual": "Other / enter by hand", "fuel.km": "Distance one way (km)", "fuel.round": "Round trip",
      "fuel.per100.f": "Consumption (L/100 km)", "fuel.per100.e": "Consumption (kWh/100 km)",
      "fuel.price.f": "Price per litre", "fuel.price.e": "Price per kWh",
      "fuel.fromGarage": "Consumption and price come from your Garage log; you can change them.",
      "fuel.noGarage": "Tip: log fill-ups in Garage and the consumption and price are filled in for you.",
      "fuel.result": "{dist} km · about {units} · about {cost}", "fuel.each": "{cost} per person ({n})",
      "fuel.need": "Enter the distance, the consumption and the price", "fuel.save": "Add to notes",
      "fuel.line": "Fuel ({car}): {dist} km, about {units}, about {cost}", "fuel.saved": "Added to the trip notes",
      "unit.f": "{n} L", "unit.e": "{n} kWh",
      "menu.remOff": "Turn reminders off", "menu.remOn": "Turn reminders on",
      "toast.remOff": "Reminders off on this device", "toast.remOn": "Reminders on: the evening before you leave and before departures",
      "wx.title": "Forecast for {place}", "wx.at": "updated {time}", "wx.later": "The forecast shows up 7 days before the trip.",
      "wx.nf": "No forecast: the destination was not found.", "wx.fail": "No forecast right now.",
      "wx.rain": "Rain likely on {day}. Add an umbrella?", "wx.add": "Add", "wx.no": "No thanks", "wx.umbrella": "Umbrella",
      "wx.c.clear": "Clear", "wx.c.part": "Partly cloudy", "wx.c.cloud": "Cloudy", "wx.c.fog": "Fog",
      "wx.c.rain": "Rain", "wx.c.snow": "Snow", "wx.c.storm": "Thunderstorm", "wx.pp": "Chance of rain {n}%",
      "kind.rental": "Car hire", "kind.ticket": "Ticket",
      "tab.map": "Map", "tab.budget": "Budget", "tab.journal": "Journal",
      "f.ret": "Return", "f.pick": "Pick-up", "f.pickTime": "Pick-up time", "f.retDay": "Return day", "f.retTime": "Return time",
      "f.pickPlace": "Pick-up place", "f.num": "Flight or train number", "f.prov": "Company", "f.cost": "Price", "f.ccur": "Currency",
      "f.geo": "On the map", "geo.at": "Point saved", "geo.clear": "Remove the point",
      "ics.files": "Attached: {list}",
      "at.title": "Tickets and documents", "at.add": "Attach a PDF or photo", "at.bad": "Only PDF files and photos can be attached",
      "at.big": "That file is too big (20 MB at most)", "at.noDisk": "The orOS disk is not available here",
      "at.missing": "Not on this device yet", "at.missingLong": "This file is not on this device yet. Vault Drive brings it from your other devices.",
      "at.open": "Open", "at.save": "Save a copy", "at.remove": "Remove", "at.close": "Close", "at.pdf": "PDF",
      "at.where": "Kept in Files, folder Travel.", "at.max": "Up to {n} files here", "at.n": "{n} attached", "at.item": "Attachment {n}",
      "imp.btn": "Import a booking", "imp.title": "Import a booking",
      "imp.hint": "Booking e-mails from airlines, hotels, rail, car hire and ticket sites usually carry the booking in a form apps can read. Open the e-mail as a file (.eml) or paste its HTML. From Mail: Other apps › Booking to Travel.",
      "imp.file": "Open an e-mail file", "imp.paste": "Or paste the e-mail (HTML)", "imp.read": "Read",
      "imp.none": "No booking found in this e-mail. Only e-mails with booking data (schema.org) can be read; add it by hand instead.",
      "imp.found": "{n} bookings found", "imp.found1": "1 booking found", "imp.have": "Already in the itinerary",
      "imp.cancel": "Cancelled", "imp.add": "Add ({n})", "imp.trip": "Add to the trip", "imp.newTrip": "A new trip",
      "imp.added": "Added to {trip}: {n}", "imp.pick": "Pick at least one booking", "imp.bad": "This file could not be read",
      "imp.mail": "From Mail: {subj}", "imp.outside": "outside the trip's dates",
      "map.find": "Find on the map ({n})", "map.finding": "Finding {i} of {n}…", "map.found": "Found on the map: {n} of {m}",
      "map.offline": "Finding places needs a connection", "map.all": "All days",
      "map.empty": "No places on the map yet. Add places to the itinerary, then press Find on the map.",
      "map.hint": "Places are looked up on OpenStreetMap (Photon) only when you press Find; the points are saved with the trip.",
      "map.gpx": "Export GPX", "map.open": "Save to Maps as a track", "map.sent": "Maps opens the route as a track in My tracks",
      "map.nf": "Not found: {list}", "map.noPts": "No places with a point on this day", "map.fail": "The map could not be loaded",
      "map.need2": "A route needs at least two places with a point", "map.legend": "Day {n}",
      "bud.cur": "Currency", "bud.plan": "Planned", "bud.spent": "Spent", "bud.left": "{v} left", "bud.over": "{v} over",
      "bud.total": "Total", "bud.set": "Set the budget", "bud.add": "Add expense",
      "bud.other": "Also spent in other currencies (not converted): {list}", "bud.each": "{v} per traveller ({n})",
      "bud.list": "Expenses", "bud.none": "No expenses yet. Bookings with a price count here too.", "bud.booking": "booking",
      "bud.split": "Share with Split", "bud.splitHint": "Split opens a new group with this trip's travellers; nothing is saved there until you press Save.",
      "bud.hint": "Planned amounts in {cur}. Leave a category empty if you don't plan it.",
      "cat.transport": "Transport", "cat.stay": "Accommodation", "cat.food": "Food & drinks", "cat.fun": "Activities & tickets",
      "cat.shop": "Shopping", "cat.other": "Other",
      "dlg.expense": "Expense", "dlg.newExp": "New expense", "dlg.budget": "Budget", "f.what": "What", "f.amt": "Amount",
      "f.cat": "Category", "f.paid": "Paid by", "f.nobody": "—", "toast.expDel": "Expense deleted", "toast.amt": "Enter an amount",
      "jr.write": "Write", "jr.edit": "Edit", "jr.empty": "Nothing written yet", "jr.hideEmpty": "Only days with entries",
      "jr.nodates": "Give the trip dates to keep a journal day by day.", "jr.title": "Journal · {day}",
      "jr.text": "How was the day?", "jr.photos": "Photos", "jr.addPhoto": "Add photos", "jr.track": "Track from Maps",
      "jr.noTrack": "No track", "jr.noTracks": "No tracks in Maps yet. Record or import one in Maps › My tracks.",
      "jr.trackGone": "This track is no longer in Maps", "jr.showTrack": "Show in Maps", "jr.plan": "Planned",
      "jr.photoN": "Photo {n}", "jr.photoBad": "Some files were not photos and were skipped", "toast.jrDel": "Journal day cleared",
      "jr.clear": "Clear the day", "menu.gpx": "Export the itinerary (GPX)", "menu.split": "Share with Split",
      "menu.importOther": "Import from Polarsteps or TripIt", "impx.title": "Import from {s}",
      "impx.hintPs": "Each trip comes with its steps as itinerary entries (with their place on the map) and the step texts in the journal. Photos and the recorded route stay in Polarsteps.",
      "impx.hintTi": "The whole-trip event becomes the trip; flights, hotels, trains, car hire and restaurants become itinerary entries, and anything else an \u201cOther\u201d entry with its text as a note.",
      "impx.row": "{n} entries and {j} journal days to add", "impx.have": "already here: {n}", "impx.over": "no room for {n}",
      "impx.left": "Left out: {list}.", "impx.photos": "{n} photos and videos", "impx.points": "{n} route points",
      "impx.outside": "{n} events outside any trip", "impx.cancelled": "{n} cancelled",
      "impx.do": "Import", "impx.pick": "Pick at least one trip", "impx.nothing": "Everything in this file is already here",
      "impx.done": "Imported: trips {t}, entries {e}, journal days {j}",
      "impx.none": "No Polarsteps or TripIt trip found in this file", "impx.big": "This file is too big to import"
    },
    el: {
      "app": "Ταξίδια", "btn.new": "Νέο ταξίδι", "btn.tpls": "Πρότυπα", "btn.back": "Πίσω", "btn.more": "Περισσότερα",
      "btn.newTpl": "Νέο πρότυπο",
      "list.now": "Ταξιδεύεις τώρα", "list.next": "Επόμενα", "list.idea": "Χωρίς ημερομηνίες", "list.past": "Περασμένα ({n})",
      "list.empty": "Κανένα ταξίδι ακόμα. Οργάνωσε το πρώτο σου: ημερομηνίες, βαλίτσα και πρόγραμμα σε ένα μέρος.",
      "cd.today": "Φεύγεις σήμερα", "cd.tomorrow": "Αύριο", "cd.in": "Σε {n} μέρες", "cd.day": "Μέρα {d} από {n}",
      "cd.ended": "Ολοκληρώθηκε", "cd.nodate": "Χωρίς ημερομηνίες",
      "nights.0": "Ημερήσιο", "nights.1": "1 νύχτα", "nights.n": "{n} νύχτες",
      "pack.count": "{d}/{n} στη βαλίτσα", "pack.none": "Άδεια λίστα",
      "tab.pack": "Βαλίτσα", "tab.plan": "Πρόγραμμα", "tab.notes": "Σημειώσεις", "tab.both": "Βαλίτσα & πρόγραμμα",
      "pack.add": "Πρόσθεσε είδος…", "pack.addBtn": "Προσθήκη είδους", "pack.missing": "Όσα λείπουν", "pack.everyone": "Όλοι",
      "pack.uncheck": "Ξετσέκαρε όλα", "pack.fromTpl": "Από πρότυπο",
      "pack.empty": "Η λίστα είναι άδεια. Πρόσθεσε είδη από πάνω ή ξεκίνα από ένα πρότυπο.",
      "pack.done": "Όλα μέσα. Καλό ταξίδι!", "pack.filtered": "Δεν λείπει τίποτα εδώ.",
      "pack.check": "Στη βαλίτσα: {name}", "pack.edit": "Επεξεργασία: {name}", "pack.grpSel": "Ομάδα του νέου είδους",
      "pack.whoSel": "Δείξε τα είδη του",
      "grp.clothes": "Ρούχα", "grp.toilet": "Νεσεσέρ", "grp.health": "Υγεία", "grp.tech": "Ηλεκτρονικά",
      "grp.docs": "Έγγραφα & χρήματα", "grp.baby": "Μωρό", "grp.gear": "Εξοπλισμός", "grp.food": "Φαγητό & νερό",
      "grp.misc": "Διάφορα", "grp.before": "Πριν φύγω", "grp.custom": "Νέα ομάδα…",
      "plan.add": "Προσθήκη στο πρόγραμμα", "plan.addDay": "Προσθήκη στις {day}", "plan.undated": "Χωρίς ημέρα",
      "plan.other": "Άλλες ημερομηνίες", "plan.dayN": "Μέρα {n}",
      "plan.empty": "Τίποτα ακόμα. Πρόσθεσε πτήσεις, διαμονή και όσα θέλεις να κάνεις.",
      "plan.gap1": "Δεν υπάρχει διαμονή για τη νύχτα της {days}", "plan.gapN": "Δεν υπάρχει διαμονή για {n} νύχτες: {days}",
      "plan.night": "Διανυκτέρευση: {name}", "plan.checkout": "Check-out: {name}", "plan.maps": "Άνοιγμα στους Χάρτες",
      "plan.up": "Πιο πάνω", "plan.down": "Πιο κάτω",
      "kind.flight": "Πτήση", "kind.train": "Τρένο", "kind.bus": "Λεωφορείο", "kind.ferry": "Πλοίο", "kind.car": "Αυτοκίνητο",
      "kind.stay": "Διαμονή", "kind.activity": "Δραστηριότητα", "kind.food": "Φαγητό", "kind.other": "Άλλο",
      "notes.ph": "Διευθύνσεις, τηλέφωνα, η πρεσβεία, ο κωδικός του Wi-Fi…",
      "head.people": "Ταξιδιώτες: {list}", "head.maps": "Ο προορισμός στους Χάρτες",
      "dlg.newTrip": "Νέο ταξίδι", "dlg.editTrip": "Επεξεργασία ταξιδιού", "dlg.editItem": "Επεξεργασία είδους",
      "dlg.newPlan": "Προσθήκη στο πρόγραμμα", "dlg.editPlan": "Στοιχείο προγράμματος", "dlg.applyTpl": "Προσθήκη από πρότυπο",
      "dlg.applyHint": "Μπαίνουν μόνο όσα λείπουν· τα τσεκ μένουν όπως είναι.",
      "dlg.dup": "Αντίγραφο ταξιδιού", "dlg.dupHint": "Το αντίγραφο ξεκινά με άδεια βαλίτσα· το πρόγραμμα μετακινείται με τις νέες ημερομηνίες.",
      "dlg.saveTpl": "Αποθήκευση ως πρότυπο", "dlg.newTpl": "Νέο πρότυπο", "dlg.editTpl": "Πρότυπο",
      "dlg.import": "Εισαγωγή", "dlg.save": "Αποθήκευση", "dlg.cancel": "Άκυρο", "dlg.delete": "Διαγραφή", "dlg.hide": "Απόκρυψη",
      "dlg.add": "Προσθήκη", "dlg.create": "Δημιουργία",
      "f.name": "Όνομα", "f.namePh": "π.χ. Ρώμη 2026", "f.dest": "Προορισμός", "f.destPh": "Πόλη, χώρα",
      "f.start": "Από", "f.end": "Έως", "f.people": "Ταξιδιώτες (χωρισμένοι με κόμμα)", "f.peoplePh": "π.χ. Χρήστος, Μαρία",
      "f.tpls": "Ξεκίνα τη βαλίτσα από", "f.qty": "Ποσότητα", "f.grp": "Ομάδα", "f.grpName": "Όνομα ομάδας",
      "f.who": "Ποιος το παίρνει", "f.anyone": "Οποιοσδήποτε", "f.note": "Σημείωση", "f.kind": "Τύπος", "f.title": "Τίτλος",
      "f.titleStay": "Ξενοδοχείο ή κατάλυμα", "f.day": "Ημέρα", "f.noday": "Χωρίς ημέρα", "f.time": "Ώρα", "f.ends": "Λήξη",
      "f.dep": "Αναχώρηση", "f.arr": "Άφιξη", "f.arrDay": "Ημέρα άφιξης", "f.sameDay": "Την ίδια μέρα",
      "f.in": "Check-in", "f.out": "Check-out", "f.inTime": "Ώρα check-in", "f.outTime": "Ώρα check-out",
      "f.place": "Τόπος ή διεύθυνση", "f.from": "Από", "f.to": "Προς", "f.ref": "Κωδικός κράτησης", "f.pnote": "Σημειώσεις",
      "f.newStart": "Νέα ημερομηνία αναχώρησης", "f.item": "Είδος", "f.qtyMode": "Ποσότητα",
      "rule.fix": "Σταθερή", "rule.day": "Ανά μέρα", "rule.every": "Μία κάθε Ν μέρες",
      "rule.hintDay": "{n} τη μέρα: ακολουθεί τις μέρες του ταξιδιού", "rule.hintEvery": "1 κάθε {n} μέρες: ακολουθεί τις μέρες του ταξιδιού",
      "rule.nodate": "Χωρίς ημερομηνίες, οι ποσότητες υπολογίζονται για {n} μέρες.",
      "tpl.items": "{n} είδη", "tpl.items1": "1 είδος", "tpl.edited": "επεξεργασμένο", "tpl.restore": "Επαναφορά έτοιμων προτύπων",
      "tpl.ready": "Έτοιμα πρότυπα", "tpl.mine": "Τα πρότυπά μου", "tpl.add": "Προσθήκη είδους",
      "tpl.mineEmpty": "Αποθήκευσε ένα ταξίδι ως πρότυπο ή φτιάξε καινούργιο.",
      "tpl.hint": "Ένα έτοιμο πρότυπο αλλάζει ή κρύβεται· η επαναφορά το φέρνει όπως ήταν.",
      "tpl.none": "Κανένα πρότυπο", "tpl.row": "Είδος {n}", "tpl.del": "Αφαίρεση είδους {n}",
      "import.found": "Στο αρχείο: ταξίδια {trips}, πρότυπα {tpls}. Ενώνονται με τα δικά σου· τίποτα δεν αντικαθίσταται.",
      "menu.export": "Εξαγωγή όλων (JSON)", "menu.import": "Εισαγωγή (JSON)", "menu.edit": "Επεξεργασία ταξιδιού",
      "menu.text": "Αντιγραφή ως κείμενο", "menu.share": "Κοινοποίηση ως κείμενο", "menu.ics": "Εξαγωγή για ημερολόγιο (.ics)",
      "menu.print": "Εκτύπωση", "menu.dup": "Αντίγραφο ταξιδιού", "menu.tpl": "Αποθήκευση ως πρότυπο", "menu.del": "Διαγραφή ταξιδιού",
      "toast.undo": "Αναίρεση", "toast.tripDel": "Το ταξίδι διαγράφηκε", "toast.itemDel": "Το είδος διαγράφηκε",
      "toast.planDel": "Το στοιχείο διαγράφηκε", "toast.tplDel": "Το πρότυπο διαγράφηκε", "toast.tplHid": "Το πρότυπο κρύφτηκε",
      "toast.unchecked": "Όλα ξετσεκαρίστηκαν", "toast.copied": "Αντιγράφηκε στο πρόχειρο", "toast.copyFail": "Η αντιγραφή απέτυχε",
      "toast.exported": "Η εξαγωγή έγινε", "toast.imported": "Εισαγωγή: ταξίδια {trips}, πρότυπα {tpls}",
      "toast.importBad": "Αυτό το αρχείο δεν είναι εξαγωγή των Ταξιδιών του orOS", "toast.save": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος",
      "toast.needName": "Δώσε ένα όνομα", "toast.dates": "Η επιστροφή είναι πριν από την αναχώρηση",
      "toast.tplSaved": "Το πρότυπο αποθηκεύτηκε", "toast.added": "Μπήκαν είδη: {n}",
      "toast.addedNone": "Τίποτα καινούργιο: όλα είναι ήδη στη λίστα", "toast.max": "Έφτασες το όριο ({n})",
      "toast.restored": "Τα έτοιμα πρότυπα επανήλθαν", "toast.gone": "Το ταξίδι διαγράφηκε σε άλλη συσκευή",
      "toast.pickTpl": "Διάλεξε τουλάχιστον ένα πρότυπο", "toast.tplEmpty": "Το πρότυπο θέλει τουλάχιστον ένα είδος",
      "copy.suffix": "{name} (αντίγραφο)",
      "txt.dest": "Προορισμός", "txt.people": "Ταξιδιώτες", "txt.pack": "ΒΑΛΙΤΣΑ", "txt.plan": "ΠΡΟΓΡΑΜΜΑ",
      "txt.notes": "ΣΗΜΕΙΩΣΕΙΣ", "txt.ref": "κράτηση", "txt.undated": "Χωρίς ημέρα", "txt.packed": "{d}/{n} στη βαλίτσα",
      "menu.todoBefore": "Το «Πριν φύγω» στις Εργασίες", "menu.todoPack": "Όσα λείπουν από τη βαλίτσα στις Εργασίες",
      "todo.before": "{trip} · πριν φύγω", "todo.pack": "{trip} · βαλίτσα", "todo.qty": "{n} × {name}",
      "menu.fuel": "Κόστος καυσίμων με αυτοκίνητο", "fuel.title": "Κόστος καυσίμων με αυτοκίνητο", "fuel.car": "Όχημα (από το Γκαράζ)",
      "fuel.manual": "Άλλο / με το χέρι", "fuel.km": "Απόσταση μονής διαδρομής (km)", "fuel.round": "Με επιστροφή",
      "fuel.per100.f": "Κατανάλωση (L/100 km)", "fuel.per100.e": "Κατανάλωση (kWh/100 km)",
      "fuel.price.f": "Τιμή ανά λίτρο", "fuel.price.e": "Τιμή ανά kWh",
      "fuel.fromGarage": "Η κατανάλωση και η τιμή έρχονται από το Γκαράζ σου· μπορείς να τις αλλάξεις.",
      "fuel.noGarage": "Συμβουλή: αν καταγράφεις τα γεμίσματα στο Γκαράζ, η κατανάλωση και η τιμή συμπληρώνονται μόνες τους.",
      "fuel.result": "{dist} km · περίπου {units} · περίπου {cost}", "fuel.each": "{cost} ανά άτομο ({n})",
      "fuel.need": "Συμπλήρωσε απόσταση, κατανάλωση και τιμή", "fuel.save": "Προσθήκη στις σημειώσεις",
      "fuel.line": "Καύσιμα ({car}): {dist} km, περίπου {units}, περίπου {cost}", "fuel.saved": "Μπήκε στις σημειώσεις του ταξιδιού",
      "unit.f": "{n} L", "unit.e": "{n} kWh",
      "menu.remOff": "Απενεργοποίηση υπενθυμίσεων", "menu.remOn": "Ενεργοποίηση υπενθυμίσεων",
      "toast.remOff": "Οι υπενθυμίσεις σβήστηκαν σε αυτή τη συσκευή", "toast.remOn": "Υπενθυμίσεις: το βράδυ πριν φύγεις και πριν από τις αναχωρήσεις",
      "wx.title": "Πρόγνωση για {place}", "wx.at": "ενημέρωση {time}", "wx.later": "Η πρόγνωση εμφανίζεται 7 μέρες πριν το ταξίδι.",
      "wx.nf": "Χωρίς πρόγνωση: ο προορισμός δεν βρέθηκε.", "wx.fail": "Η πρόγνωση δεν είναι διαθέσιμη τώρα.",
      "wx.rain": "Πιθανή βροχή {day}. Να μπει ομπρέλα;", "wx.add": "Προσθήκη", "wx.no": "Όχι, ευχαριστώ", "wx.umbrella": "Ομπρέλα",
      "wx.c.clear": "Αίθριος", "wx.c.part": "Λίγα σύννεφα", "wx.c.cloud": "Συννεφιά", "wx.c.fog": "Ομίχλη",
      "wx.c.rain": "Βροχή", "wx.c.snow": "Χιόνι", "wx.c.storm": "Καταιγίδα", "wx.pp": "Πιθανότητα βροχής {n}%",
      "kind.rental": "Ενοικίαση αυτοκινήτου", "kind.ticket": "Εισιτήριο",
      "tab.map": "Χάρτης", "tab.budget": "Προϋπολογισμός", "tab.journal": "Ημερολόγιο",
      "f.ret": "Επιστροφή", "f.pick": "Παραλαβή", "f.pickTime": "Ώρα παραλαβής", "f.retDay": "Ημέρα επιστροφής", "f.retTime": "Ώρα επιστροφής",
      "f.pickPlace": "Σημείο παραλαβής", "f.num": "Αριθμός πτήσης ή δρομολογίου", "f.prov": "Εταιρεία", "f.cost": "Τιμή", "f.ccur": "Νόμισμα",
      "f.geo": "Στον χάρτη", "geo.at": "Το σημείο αποθηκεύτηκε", "geo.clear": "Αφαίρεση σημείου",
      "ics.files": "Συνημμένα: {list}",
      "at.title": "Εισιτήρια και έγγραφα", "at.add": "Επισύναψη PDF ή φωτογραφίας", "at.bad": "Επισυνάπτονται μόνο αρχεία PDF και φωτογραφίες",
      "at.big": "Το αρχείο είναι πολύ μεγάλο (έως 20 MB)", "at.noDisk": "Ο δίσκος του orOS δεν είναι διαθέσιμος εδώ",
      "at.missing": "Δεν υπάρχει ακόμα εδώ", "at.missingLong": "Το αρχείο δεν υπάρχει ακόμα σε αυτή τη συσκευή. Το Vault Drive το φέρνει από τις άλλες συσκευές σου.",
      "at.open": "Άνοιγμα", "at.save": "Αποθήκευση αντιγράφου", "at.remove": "Αφαίρεση", "at.close": "Κλείσιμο", "at.pdf": "PDF",
      "at.where": "Φυλάσσεται στα Αρχεία, φάκελος Travel.", "at.max": "Έως {n} αρχεία εδώ", "at.n": "{n} συνημμένα", "at.item": "Συνημμένο {n}",
      "imp.btn": "Εισαγωγή κράτησης", "imp.title": "Εισαγωγή κράτησης",
      "imp.hint": "Τα email κρατήσεων από αεροπορικές, ξενοδοχεία, σιδηρόδρομο, ενοικιάσεις αυτοκινήτων και εισιτήρια συνήθως περιέχουν την κράτηση σε μορφή που διαβάζουν οι εφαρμογές. Άνοιξε το email ως αρχείο (.eml) ή επικόλλησε το HTML του. Από την Αλληλογραφία: Άλλες εφαρμογές › Κράτηση στα Ταξίδια.",
      "imp.file": "Άνοιγμα αρχείου email", "imp.paste": "Ή επικόλλησε το email (HTML)", "imp.read": "Ανάγνωση",
      "imp.none": "Δεν βρέθηκε κράτηση σε αυτό το email. Διαβάζονται μόνο email με δεδομένα κράτησης (schema.org)· πρόσθεσέ την με το χέρι.",
      "imp.found": "Βρέθηκαν {n} κρατήσεις", "imp.found1": "Βρέθηκε 1 κράτηση", "imp.have": "Υπάρχει ήδη στο πρόγραμμα",
      "imp.cancel": "Ακυρωμένη", "imp.add": "Προσθήκη ({n})", "imp.trip": "Προσθήκη στο ταξίδι", "imp.newTrip": "Νέο ταξίδι",
      "imp.added": "Μπήκαν στο «{trip}»: {n}", "imp.pick": "Διάλεξε τουλάχιστον μία κράτηση", "imp.bad": "Το αρχείο δεν διαβάστηκε",
      "imp.mail": "Από την Αλληλογραφία: {subj}", "imp.outside": "εκτός ημερομηνιών του ταξιδιού",
      "map.find": "Εύρεση στον χάρτη ({n})", "map.finding": "Εύρεση {i} από {n}…", "map.found": "Βρέθηκαν στον χάρτη: {n} από {m}",
      "map.offline": "Η εύρεση θέσεων θέλει σύνδεση", "map.all": "Όλες οι μέρες",
      "map.empty": "Δεν υπάρχουν ακόμα θέσεις στον χάρτη. Πρόσθεσε μέρη στο πρόγραμμα και πάτα Εύρεση στον χάρτη.",
      "map.hint": "Τα μέρη αναζητούνται στο OpenStreetMap (Photon) μόνο όταν πατάς Εύρεση· τα σημεία αποθηκεύονται με το ταξίδι.",
      "map.gpx": "Εξαγωγή GPX", "map.open": "Αποθήκευση στους Χάρτες ως διαδρομή", "map.sent": "Οι Χάρτες ανοίγουν τη διαδρομή στις Διαδρομές μου",
      "map.nf": "Δεν βρέθηκαν: {list}", "map.noPts": "Καμία θέση με σημείο αυτή τη μέρα", "map.fail": "Ο χάρτης δεν φορτώθηκε",
      "map.need2": "Μια διαδρομή θέλει τουλάχιστον δύο μέρη με σημείο", "map.legend": "Μέρα {n}",
      "bud.cur": "Νόμισμα", "bud.plan": "Προϋπολογισμός", "bud.spent": "Ξοδεύτηκαν", "bud.left": "απομένουν {v}", "bud.over": "υπέρβαση {v}",
      "bud.total": "Σύνολο", "bud.set": "Ορισμός προϋπολογισμού", "bud.add": "Νέο έξοδο",
      "bud.other": "Και σε άλλα νομίσματα (χωρίς μετατροπή): {list}", "bud.each": "{v} ανά ταξιδιώτη ({n})",
      "bud.list": "Έξοδα", "bud.none": "Κανένα έξοδο ακόμα. Μετράνε κι οι κρατήσεις με τιμή.", "bud.booking": "κράτηση",
      "bud.split": "Κοινοποίηση στη Μοιρασιά", "bud.splitHint": "Η Μοιρασιά ανοίγει νέα ομάδα με τους ταξιδιώτες· τίποτα δεν αποθηκεύεται εκεί πριν πατήσεις Αποθήκευση.",
      "bud.hint": "Ποσά σε {cur}. Άφησε κενή μια κατηγορία αν δεν την προϋπολογίζεις.",
      "cat.transport": "Μετακινήσεις", "cat.stay": "Διαμονή", "cat.food": "Φαγητό & ποτό", "cat.fun": "Δραστηριότητες & εισιτήρια",
      "cat.shop": "Ψώνια", "cat.other": "Άλλα",
      "dlg.expense": "Έξοδο", "dlg.newExp": "Νέο έξοδο", "dlg.budget": "Προϋπολογισμός", "f.what": "Τι", "f.amt": "Ποσό",
      "f.cat": "Κατηγορία", "f.paid": "Πλήρωσε", "f.nobody": "—", "toast.expDel": "Το έξοδο διαγράφηκε", "toast.amt": "Γράψε ένα ποσό",
      "jr.write": "Γράψε", "jr.edit": "Επεξεργασία", "jr.empty": "Τίποτα γραμμένο ακόμα", "jr.hideEmpty": "Μόνο μέρες με εγγραφές",
      "jr.nodates": "Βάλε ημερομηνίες στο ταξίδι για να κρατάς ημερολόγιο μέρα με τη μέρα.", "jr.title": "Ημερολόγιο · {day}",
      "jr.text": "Πώς ήταν η μέρα;", "jr.photos": "Φωτογραφίες", "jr.addPhoto": "Προσθήκη φωτογραφιών", "jr.track": "Διαδρομή από τους Χάρτες",
      "jr.noTrack": "Χωρίς διαδρομή", "jr.noTracks": "Δεν υπάρχουν ακόμα διαδρομές στους Χάρτες. Κατέγραψε ή εισήγαγε μία στους Χάρτες › Οι διαδρομές μου.",
      "jr.trackGone": "Αυτή η διαδρομή δεν υπάρχει πια στους Χάρτες", "jr.showTrack": "Εμφάνιση στους Χάρτες", "jr.plan": "Στο πρόγραμμα",
      "jr.photoN": "Φωτογραφία {n}", "jr.photoBad": "Κάποια αρχεία δεν ήταν φωτογραφίες και παραλείφθηκαν", "toast.jrDel": "Η μέρα του ημερολογίου καθαρίστηκε",
      "jr.clear": "Καθάρισμα της μέρας", "menu.gpx": "Εξαγωγή προγράμματος (GPX)", "menu.split": "Κοινοποίηση στη Μοιρασιά",
      "menu.importOther": "Εισαγωγή από Polarsteps ή TripIt", "impx.title": "Εισαγωγή από {s}",
      "impx.hintPs": "Κάθε ταξίδι έρχεται με τις στάσεις του ως καταχωρίσεις στο πρόγραμμα (με το σημείο τους στον χάρτη) και τα κείμενα των στάσεων στο ημερολόγιο. Οι φωτογραφίες και η καταγεγραμμένη διαδρομή μένουν στο Polarsteps.",
      "impx.hintTi": "Το γεγονός όλου του ταξιδιού γίνεται το ταξίδι· πτήσεις, ξενοδοχεία, τρένα, ενοικιάσεις αυτοκινήτων και εστιατόρια γίνονται καταχωρίσεις στο πρόγραμμα, και όλα τα άλλα καταχωρίσεις «Άλλο» με το κείμενό τους ως σημείωση.",
      "impx.row": "{n} καταχωρίσεις και {j} μέρες ημερολογίου για προσθήκη", "impx.have": "υπάρχουν ήδη: {n}", "impx.over": "δεν χωράνε {n}",
      "impx.left": "Έμειναν έξω: {list}.", "impx.photos": "{n} φωτογραφίες και βίντεο", "impx.points": "{n} σημεία διαδρομής",
      "impx.outside": "{n} γεγονότα εκτός ταξιδιού", "impx.cancelled": "{n} ακυρωμένα",
      "impx.do": "Εισαγωγή", "impx.pick": "Διάλεξε τουλάχιστον ένα ταξίδι", "impx.nothing": "Όλα όσα έχει αυτό το αρχείο υπάρχουν ήδη",
      "impx.done": "Εισαγωγή: ταξίδια {t}, καταχωρίσεις {e}, μέρες ημερολογίου {j}",
      "impx.none": "Δεν βρέθηκε ταξίδι Polarsteps ή TripIt σε αυτό το αρχείο", "impx.big": "Αυτό το αρχείο είναι πολύ μεγάλο για εισαγωγή"
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
  function locale() { return LANG === "el" ? "el-GR" : "en-GB"; }

  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  function newId() {
    var r = new Uint32Array(2);
    crypto.getRandomValues(r);
    return Date.now().toString(36) + r[0].toString(36) + r[1].toString(36).slice(0, 4);
  }

  // One line of text: control characters out, spaces collapsed, capped.
  function line(v, max) {
    return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
  }
  // Free text (notes): keeps line breaks and tabs, drops other control characters.
  function text(v, max) {
    return typeof v === "string" ? v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").slice(0, max) : "";
  }

  // Dates are local calendar days "YYYY-MM-DD" (Part IV), walked at noon.
  function isYmd(s) {
    var m = typeof s === "string" && YMD_RE.exec(s);
    if (!m) return false;
    var d = new Date(+m[1], +m[2] - 1, +m[3], 12);
    return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3];
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function parseYmd(s) { var m = YMD_RE.exec(s); return new Date(+m[1], +m[2] - 1, +m[3], 12); }
  function addDays(s, n) { var d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }
  function dayDiff(a, b) { return Math.round((parseYmd(b) - parseYmd(a)) / DAY_MS); }
  function todayYmd() { return ymd(new Date()); }

  // ---------- 2. Model ----------
  // data = { ver: 1, trips: [trip…], tpls: [tpl…], tombs: { id: deletedAt } }
  // trip = { id, name, dest, start, end, people[], notes, f{…}, pack[item…], plan[entry…] }
  // item = { id, name, qty, rule, grp, who, note, done, f{…} }
  //   rule: null | { m: "day", n } (n per day) | { m: "every", n } (1 every n days)
  //   grp: "@<built-in group>" or a custom group name
  // entry = { id, kind, title, day, t1, day2, t2, place, from, to, ref, note, pos, f{…} }
  //   transport: t1 departs (day), t2 arrives (day2 or day); stay: check-in day / check-out day2
  // tpl = { id, m, name, items[{ name, grp, qty, rule }] } | { id, m, seed: 1 } (a ready template restored)
  // f = { field: stamp }: one stamp per field; the entity's life is the newest of them.
  function normDate(v) { return isYmd(v) ? v : ""; }
  function normHm(v) { return typeof v === "string" && HM_RE.test(v) ? v : ""; }
  function normQty(v) { return isInt(v) && v >= 1 ? Math.min(v, MAX_QTY) : 1; }
  function normPos(v) { return isInt(v) && Math.abs(v) <= 1e9 ? v : 0; }
  function normRule(v) {
    if (!v || typeof v !== "object" || !isInt(v.n)) return null;
    if (v.m === "day" && v.n >= 1 && v.n <= 20) return { m: "day", n: v.n };
    if (v.m === "every" && v.n >= 2 && v.n <= 14) return { m: "every", n: v.n };
    return null;
  }
  function normGrp(v) {
    if (typeof v === "string" && v.charAt(0) === "@" && GROUPS.indexOf(v.slice(1)) >= 0) return v;
    var s = line(v, LEN.grp).replace(/^@+/, "").trim();
    return s || "@misc";
  }
  function normPeople(v) {
    var out = [], seen = {};
    (Array.isArray(v) ? v : []).forEach(function (p) {
      var s = line(p, LEN.person), k = s.toLowerCase();
      if (!s || seen[k] || out.length >= MAX_PEOPLE) return;
      seen[k] = 1;
      out.push(s);
    });
    return out;
  }
  function lineOf(max) { return function (v) { return line(v, max); }; }
  function normCur(v) { return typeof v === "string" && CURRENCIES.indexOf(v) >= 0 ? v : ""; }
  function normCents(v) { return isInt(v) && v >= 0 && v <= MAX_CENTS ? v : 0; }
  // A point on the map: { lat, lon } (6 decimals) or null.
  function normGeo(v) {
    if (!v || typeof v !== "object") return null;
    var la = v.lat, lo = v.lon;
    if (typeof la !== "number" || typeof lo !== "number" || !isFinite(la) || !isFinite(lo) ||
        la < -90 || la > 90 || lo < -180 || lo > 180) return null;
    return { lat: Math.round(la * 1e6) / 1e6, lon: Math.round(lo * 1e6) / 1e6 };
  }
  // Planned budget per category, in cents of the trip's currency; keys in a fixed order.
  function normBplan(v) {
    var out = {};
    if (!v || typeof v !== "object") return out;
    BUD_CATS.forEach(function (c) { if (isInt(v[c]) && v[c] > 0 && v[c] <= MAX_CENTS) out[c] = v[c]; });
    return out;
  }
  function normOwner(v) { return typeof v === "string" && ID_RE.test(v) ? v : ""; }

  var NORM = {
    trip: {
      name: lineOf(LEN.name), dest: lineOf(LEN.dest), start: normDate, end: normDate,
      people: normPeople, notes: function (v) { return text(v, LEN.notes); },
      cur: normCur, bplan: normBplan, geo: normGeo
    },
    docs: {
      of: normOwner, file: function (v) { return typeof v === "string" && FILE_RE.test(v) ? v : ""; },
      name: lineOf(LEN.fname)
    },
    spend: {
      cat: function (v) { return BUD_CATS.indexOf(v) >= 0 ? v : "other"; }, amt: normCents, cur: normCur,
      day: normDate, what: lineOf(LEN.what), who: lineOf(LEN.person)
    },
    jrnl: {
      day: normDate, text: function (v) { return text(v, LEN.jtext); },
      trk: function (v) { return typeof v === "string" && TRK_RE.test(v) ? v : ""; }
    },
    pack: {
      name: lineOf(LEN.item), qty: normQty, rule: normRule, grp: normGrp,
      who: lineOf(LEN.person), note: lineOf(LEN.note), done: function (v) { return v === true; }
    },
    plan: {
      kind: function (v) { return KINDS.indexOf(v) >= 0 ? v : "other"; },
      title: lineOf(LEN.title), day: normDate, t1: normHm, day2: normDate, t2: normHm,
      place: lineOf(LEN.place), from: lineOf(LEN.stop), to: lineOf(LEN.stop), ref: lineOf(LEN.ref),
      note: function (v) { return text(v, LEN.pnote); }, pos: normPos,
      num: lineOf(LEN.num), prov: lineOf(LEN.prov), cost: normCents, ccur: normCur, geo: normGeo, geo0: normGeo
    }
  };
  var LIST_F = { pack: PACK_F, plan: PLAN_F, docs: DOC_F, spend: SPEND_F, jrnl: JRNL_F };

  // A strict copy with every field and stamp spelled out, in a fixed key order (R26).
  function normEnt(x, fields, norms) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !ID_RE.test(x.id)) return null;
    var f = (x.f && typeof x.f === "object") ? x.f : {};
    var out = { id: x.id }, of = {};
    fields.forEach(function (k) {
      out[k] = norms[k](x[k]);
      of[k] = isInt(f[k]) && f[k] >= 0 ? f[k] : 0;
    });
    out.f = of;
    return out;
  }
  function life(e) {
    var m = 0;
    Object.keys(e.f).forEach(function (k) { if (e.f[k] > m) m = e.f[k]; });
    return m;
  }
  // Field by field: the newer stamp wins; equal stamps: the larger
  // serialization (symmetric, associative: a join per field).
  function mergeFields(a, b, fields) {
    var out = { id: a.id }, of = {};
    fields.forEach(function (k) {
      var pick;
      if (a.f[k] !== b.f[k]) pick = a.f[k] > b.f[k] ? a : b;
      else pick = JSON.stringify(a[k]) >= JSON.stringify(b[k]) ? a : b;
      out[k] = pick[k];
      of[k] = pick.f[k];
    });
    out.f = of;
    return out;
  }
  function unionEnts(lists, fields, norms, tombs) {
    var best = {};
    lists.forEach(function (list) {
      if (!Array.isArray(list)) return;
      list.forEach(function (raw) {
        var x = normEnt(raw, fields, norms);
        if (!x) return;
        best[x.id] = best[x.id] ? mergeFields(best[x.id], x, fields) : x;
      });
    });
    return Object.keys(best).sort(cmpStr).filter(function (id) {
      return !(id in tombs && tombs[id] >= life(best[id]));
    }).map(function (id) { return best[id]; });
  }

  function normTplItems(list) {
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (it) {
      if (!it || typeof it !== "object" || out.length >= MAX_TPL_ITEMS) return;
      var name = line(it.name, LEN.item);
      if (!name) return;
      out.push({ name: name, grp: normGrp(it.grp), qty: normQty(it.qty), rule: normRule(it.rule) });
    });
    return out;
  }
  function normTpl(x) {
    if (!x || typeof x !== "object" || typeof x.id !== "string" || !ID_RE.test(x.id) ||
        !isInt(x.m) || x.m < 0) return null;
    if (x.seed === 1 && SEED_IDS.indexOf(x.id) >= 0) return { id: x.id, m: x.m, seed: 1 };
    var name = line(x.name, LEN.tpl), items = normTplItems(x.items);
    if (!name || !items.length) return null;
    return { id: x.id, m: x.m, name: name, items: items };
  }

  function mergeTravel(A, B) {
    var a = A || {}, b = B || {};
    var tombs = {};
    [a.tombs, b.tombs].forEach(function (tm) {
      if (!tm || typeof tm !== "object") return;
      Object.keys(tm).forEach(function (id) {
        if (!ID_RE.test(id) || !isInt(tm[id]) || tm[id] < 0) return;
        if (!(id in tombs) || tm[id] > tombs[id]) tombs[id] = tm[id];
      });
    });
    // trips: head fields + the raw item lists of every copy, unioned below
    var heads = {}, raws = {};
    [a.trips, b.trips].forEach(function (list) {
      if (!Array.isArray(list)) return;
      list.forEach(function (raw) {
        var x = normEnt(raw, TRIP_F, NORM.trip);
        if (!x) return;
        if (heads[x.id]) heads[x.id] = mergeFields(heads[x.id], x, TRIP_F);
        else { heads[x.id] = x; raws[x.id] = {}; LISTS.forEach(function (k) { raws[x.id][k] = []; }); }
        LISTS.forEach(function (k) { raws[x.id][k].push(raw[k]); });
      });
    });
    var newest = 0;
    function seen(s) { if (s > newest) newest = s; }
    var trips = [];
    Object.keys(heads).sort(cmpStr).forEach(function (id) {
      var h = heads[id];
      if (id in tombs && tombs[id] >= life(h)) return;
      seen(life(h));
      LISTS.forEach(function (k) {
        h[k] = unionEnts(raws[id][k], LIST_F[k], NORM[k], tombs);
        h[k].forEach(function (e) { seen(life(e)); });
      });
      trips.push(h);
    });
    var best = {};
    [a.tpls, b.tpls].forEach(function (list) {
      if (!Array.isArray(list)) return;
      list.forEach(function (raw) {
        var x = normTpl(raw);
        if (!x) return;
        var cur = best[x.id];
        if (!cur || x.m > cur.m || (x.m === cur.m && JSON.stringify(x) > JSON.stringify(cur))) best[x.id] = x;
      });
    });
    var tpls = [];
    Object.keys(best).sort(cmpStr).forEach(function (id) {
      if (id in tombs && tombs[id] >= best[id].m) return;
      seen(best[id].m);
      tpls.push(best[id]);
    });
    Object.keys(tombs).forEach(function (id) { seen(tombs[id]); });
    // Old tombstones are pruned against the newest stamp in the DATA
    // (never the device clock: R26). A hidden ready template keeps its
    // tombstone forever, or it would come back.
    var sortedTombs = {};
    Object.keys(tombs).sort(cmpStr).forEach(function (id) {
      if (tombs[id] < newest - TOMB_TTL && SEED_IDS.indexOf(id) < 0) return;
      sortedTombs[id] = tombs[id];
    });
    return { ver: DATA_VER, trips: trips, tpls: tpls, tombs: sortedTombs };
  }
  function emptyData() { return { ver: DATA_VER, trips: [], tpls: [], tombs: {} }; }

  // ----- Ready templates (R15 bilingual, R16 fixed ids; never stored until changed) -----
  // item: [en, el, group, qty, rule mode, rule n]
  var SEEDS = {
    "tpl-basic": { en: "Essentials", el: "Τα βασικά", items: [
      ["Underwear", "Εσώρουχα", "clothes", 1, "day", 1], ["Socks", "Κάλτσες", "clothes", 1, "day", 1],
      ["T-shirts", "Μπλουζάκια", "clothes", 1, "every", 2], ["Trousers", "Παντελόνια", "clothes", 1, "every", 4],
      ["Sleepwear", "Πιτζάμες", "clothes", 1], ["Sweater or light jacket", "Ζακέτα ή ελαφρύ μπουφάν", "clothes", 1],
      ["Comfortable shoes", "Άνετα παπούτσια", "clothes", 1],
      ["Toothbrush and toothpaste", "Οδοντόβουρτσα και οδοντόκρεμα", "toilet", 1], ["Deodorant", "Αποσμητικό", "toilet", 1],
      ["Shampoo and shower gel", "Σαμπουάν και αφρόλουτρο", "toilet", 1], ["Comb or hairbrush", "Χτένα ή βούρτσα", "toilet", 1],
      ["My medicines", "Τα φάρμακά μου", "health", 1], ["Painkillers", "Παυσίπονα", "health", 1],
      ["Phone charger", "Φορτιστής κινητού", "tech", 1], ["Power bank", "Powerbank", "tech", 1], ["Headphones", "Ακουστικά", "tech", 1],
      ["ID card or passport", "Ταυτότητα ή διαβατήριο", "docs", 1], ["Wallet and cards", "Πορτοφόλι και κάρτες", "docs", 1],
      ["Some cash", "Λίγα μετρητά", "docs", 1], ["Tickets and bookings", "Εισιτήρια και κρατήσεις", "docs", 1],
      ["House keys", "Κλειδιά του σπιτιού", "misc", 1], ["Sunglasses", "Γυαλιά ηλίου", "misc", 1],
      ["Water bottle", "Παγούρι", "misc", 1]
    ] },
    "tpl-beach": { en: "Beach", el: "Παραλία", items: [
      ["Swimsuit", "Μαγιό", "clothes", 2], ["Shorts", "Σορτσάκια", "clothes", 1, "every", 3],
      ["Flip-flops", "Σαγιονάρες", "clothes", 1], ["Sun hat", "Καπέλο", "clothes", 1],
      ["Sunscreen", "Αντηλιακό", "toilet", 1], ["After-sun", "Ενυδατική για μετά τον ήλιο", "toilet", 1],
      ["Insect repellent", "Εντομοαπωθητικό", "health", 1], ["Beach towel", "Πετσέτα θαλάσσης", "gear", 1],
      ["Beach bag", "Τσάντα θαλάσσης", "gear", 1], ["Mask and snorkel", "Μάσκα και αναπνευστήρας", "gear", 1],
      ["Waterproof phone pouch", "Αδιάβροχη θήκη κινητού", "tech", 1], ["A book", "Ένα βιβλίο", "misc", 1]
    ] },
    "tpl-city": { en: "City break", el: "City break", items: [
      ["Walking shoes", "Παπούτσια για περπάτημα", "clothes", 1], ["Outfit for a night out", "Ρούχα για έξοδο", "clothes", 1],
      ["Day backpack", "Σακίδιο ημέρας", "gear", 1], ["Compact umbrella", "Μικρή ομπρέλα", "gear", 1],
      ["Travel adapter", "Αντάπτορας πρίζας", "tech", 1], ["Camera", "Φωτογραφική μηχανή", "tech", 1],
      ["Museum and transport passes", "Κάρτες μουσείων και συγκοινωνιών", "docs", 1]
    ] },
    "tpl-business": { en: "Business", el: "Επαγγελματικό", items: [
      ["Suit or smart outfit", "Κοστούμι ή επίσημο ντύσιμο", "clothes", 1], ["Shirts", "Πουκάμισα", "clothes", 1, "day", 1],
      ["Formal shoes", "Επίσημα παπούτσια", "clothes", 1], ["Belt", "Ζώνη", "clothes", 1],
      ["Laptop and charger", "Laptop και φορτιστής", "tech", 1], ["Presentation adapter (HDMI / USB-C)", "Αντάπτορας για παρουσίαση (HDMI / USB-C)", "tech", 1],
      ["Business cards", "Επαγγελματικές κάρτες", "docs", 1], ["Notebook and pen", "Σημειωματάριο και στυλό", "misc", 1]
    ] },
    "tpl-hiking": { en: "Hiking & camping", el: "Πεζοπορία & κάμπινγκ", items: [
      ["Hiking boots", "Ορειβατικά παπούτσια", "clothes", 1], ["Rain jacket", "Αδιάβροχο μπουφάν", "clothes", 1],
      ["Fleece", "Fleece", "clothes", 1], ["Quick-dry shirts", "Μπλούζες που στεγνώνουν γρήγορα", "clothes", 1, "every", 2],
      ["Hiking socks", "Κάλτσες πεζοπορίας", "clothes", 1, "day", 1], ["Backpack", "Σακίδιο", "gear", 1],
      ["Tent", "Σκηνή", "gear", 1], ["Sleeping bag", "Υπνόσακος", "gear", 1], ["Sleeping mat", "Υπόστρωμα", "gear", 1],
      ["Headlamp", "Φακός κεφαλής", "gear", 1], ["Map and compass", "Χάρτης και πυξίδα", "gear", 1],
      ["Pocket knife", "Σουγιάς", "gear", 1], ["Rubbish bags", "Σακούλες σκουπιδιών", "gear", 2],
      ["First aid kit", "Φαρμακείο πρώτων βοηθειών", "health", 1], ["Water (litres)", "Νερό (λίτρα)", "food", 2, "day", 2],
      ["Energy snacks", "Σνακ ενέργειας", "food", 1, "day", 2]
    ] },
    "tpl-ski": { en: "Ski", el: "Σκι", items: [
      ["Ski jacket", "Μπουφάν σκι", "clothes", 1], ["Ski trousers", "Παντελόνι σκι", "clothes", 1],
      ["Thermal base layers", "Ισοθερμικά", "clothes", 1, "every", 2], ["Ski socks", "Κάλτσες σκι", "clothes", 1, "day", 1],
      ["Gloves", "Γάντια", "clothes", 1], ["Beanie", "Σκούφος", "clothes", 1], ["Neck warmer", "Περιλαίμιο", "clothes", 1],
      ["Goggles", "Μάσκα σκι", "gear", 1], ["Helmet", "Κράνος", "gear", 1], ["Hand warmers", "Θερμαντικά χεριών", "gear", 2],
      ["Sunscreen", "Αντηλιακό", "toilet", 1], ["Lip balm", "Βάλσαμο για τα χείλη", "toilet", 1],
      ["Ski pass", "Ski pass", "docs", 1]
    ] },
    "tpl-baby": { en: "With a baby", el: "Με μωρό", items: [
      ["Diapers", "Πάνες", "baby", 1, "day", 6], ["Wipes (packs)", "Μωρομάντηλα (πακέτα)", "baby", 1, "every", 3],
      ["Bodysuits", "Φορμάκια", "baby", 1, "day", 2], ["Baby sleepwear", "Πιτζαμάκια", "baby", 1, "every", 2],
      ["Bibs", "Σαλιάρες", "baby", 3], ["Bottles", "Μπιμπερό", "baby", 2], ["Formula or baby food", "Γάλα ή βρεφικές τροφές", "baby", 1],
      ["Pacifier", "Πιπίλα", "baby", 2], ["Changing mat", "Αλλαξιέρα", "baby", 1], ["Favourite toy", "Το αγαπημένο παιχνίδι", "baby", 1],
      ["Stroller", "Καρότσι", "baby", 1], ["Baby carrier", "Μάρσιπος", "baby", 1], ["Car seat", "Κάθισμα αυτοκινήτου", "baby", 1],
      ["Thermometer", "Θερμόμετρο", "health", 1], ["Baby fever medicine", "Αντιπυρετικό για μωρά", "health", 1],
      ["Baby sunscreen", "Παιδικό αντηλιακό", "toilet", 1]
    ] },
    "tpl-carryon": { en: "Carry-on only", el: "Μόνο χειραποσκευή", items: [
      ["Liquids bag (100 ml bottles)", "Σακουλάκι υγρών (μπουκαλάκια 100 ml)", "toilet", 1],
      ["Travel-size toiletries", "Καλλυντικά σε μικρή συσκευασία", "toilet", 1], ["Neck pillow", "Μαξιλάρι λαιμού", "gear", 1],
      ["Earplugs and eye mask", "Ωτοασπίδες και μάσκα ύπνου", "gear", 1], ["Boarding pass", "Κάρτα επιβίβασης", "docs", 1],
      ["Pen (for forms)", "Στυλό (για έντυπα)", "misc", 1], ["Snacks for the trip", "Σνακ για τη διαδρομή", "food", 1]
    ] },
    "tpl-road": { en: "Road trip", el: "Οδικό ταξίδι", items: [
      ["Driving licence", "Δίπλωμα οδήγησης", "docs", 1], ["Car documents and insurance", "Άδεια κυκλοφορίας και ασφάλεια", "docs", 1],
      ["Cash for tolls", "Μετρητά για διόδια", "docs", 1], ["Phone holder", "Βάση κινητού", "tech", 1],
      ["Car charger", "Φορτιστής αυτοκινήτου", "tech", 1], ["Reflective vest and warning triangle", "Γιλέκο και τρίγωνο", "gear", 1],
      ["First aid kit", "Φαρμακείο πρώτων βοηθειών", "health", 1], ["Motion sickness tablets", "Χάπια για τη ναυτία", "health", 1],
      ["Water and snacks", "Νερό και σνακ", "food", 1]
    ] },
    "tpl-before": { en: "Before I leave", el: "Πριν φύγω", items: [
      ["Online check-in", "Online check-in", "before", 1], ["Download offline maps and tickets", "Κατέβασε χάρτες και εισιτήρια για χρήση εκτός σύνδεσης", "before", 1],
      ["Charge phone and power bank", "Φόρτισε κινητό και powerbank", "before", 1], ["Water the plants", "Πότισε τα φυτά", "before", 1],
      ["Arrange care for pets", "Κανόνισε ποιος θα προσέχει τα ζώα", "before", 1], ["Empty the fridge", "Άδειασε το ψυγείο", "before", 1],
      ["Take out the rubbish", "Βγάλε τα σκουπίδια", "before", 1], ["Unplug appliances", "Βγάλε τις συσκευές από την πρίζα", "before", 1],
      ["Turn off the water", "Κλείσε τον γενικό του νερού", "before", 1], ["Lock windows and doors", "Κλείδωσε πόρτες και παράθυρα", "before", 1],
      ["Set an out-of-office reply", "Βάλε αυτόματη απάντηση στο email", "before", 1]
    ] }
  };
  var SEED_IDS = ["tpl-basic", "tpl-before", "tpl-beach", "tpl-city", "tpl-business", "tpl-hiking", "tpl-ski",
                  "tpl-baby", "tpl-carryon", "tpl-road"];
  var DEFAULT_TPLS = ["tpl-basic", "tpl-before"];

  function seedTpl(id) {
    var s = SEEDS[id];
    return {
      id: id, kind: "seed", name: s[LANG] || s.en,
      items: s.items.map(function (it) {
        return { name: LANG === "el" ? it[1] : it[0], grp: "@" + it[2], qty: it[3], rule: it[4] ? { m: it[4], n: it[5] } : null };
      })
    };
  }
  // Every template the user can pick: the ready ones (unless hidden),
  // a changed ready one in its stored form, then the user's own by name.
  function tplList(d) {
    var stored = {};
    d.tpls.forEach(function (x) { stored[x.id] = x; });
    var out = [];
    SEED_IDS.forEach(function (id) {
      var x = stored[id];
      if (!x && id in d.tombs) return;                    // hidden ready template
      if (!x || x.seed) { out.push(seedTpl(id)); return; }
      out.push({ id: id, kind: "edited", name: x.name, items: x.items });
    });
    var mine = d.tpls.filter(function (x) { return SEED_IDS.indexOf(x.id) < 0; }).map(function (x) {
      return { id: x.id, kind: "mine", name: x.name, items: x.items };
    });
    mine.sort(function (x, y) { return x.name.localeCompare(y.name, locale()) || cmpStr(x.id, y.id); });
    return out.concat(mine);
  }

  // ----- Days and quantities -----
  function datesKnown(trip) { return isYmd(trip.start) && isYmd(trip.end) && trip.end >= trip.start; }
  function tripDays(trip) {
    if (!datesKnown(trip)) return isYmd(trip.start) && !trip.end ? 1 : NO_DATE_DAYS;
    return Math.min(dayDiff(trip.start, trip.end) + 1, 3650);
  }
  function tripNights(trip) { return datesKnown(trip) ? tripDays(trip) - 1 : -1; }
  function ruleQty(rule, days) {
    var q = rule.m === "day" ? rule.n * days : Math.ceil(days / rule.n);
    return Math.max(1, Math.min(MAX_QTY, q));
  }
  function itemKey(name, grp) { return grp + "|" + name.toLocaleLowerCase(); }

  // Several templates into one list: same name + group join, the larger quantity wins.
  function combineTpls(tpls, days) {
    var out = [], at = {};
    tpls.forEach(function (tp) {
      tp.items.forEach(function (it) {
        var q = it.rule ? ruleQty(it.rule, days) : it.qty;
        var k = itemKey(it.name, it.grp);
        if (k in at) {
          var o = out[at[k]];
          if (q > o.qty) { o.qty = q; o.rule = it.rule ? { m: it.rule.m, n: it.rule.n } : null; }
          return;
        }
        at[k] = out.length;
        out.push({ name: it.name, grp: it.grp, qty: q, rule: it.rule ? { m: it.rule.m, n: it.rule.n } : null });
      });
    });
    return out;
  }
  // What a template would add to a trip: only the items it does not have yet.
  function missingFrom(trip, items) {
    var have = {};
    trip.pack.forEach(function (p) { have[itemKey(p.name, p.grp)] = 1; });
    return items.filter(function (it) { return !have[itemKey(it.name, it.grp)]; });
  }

  // The trip's days (≤ 90 shown), and the nights no stay covers.
  function tripDayList(trip) {
    if (!datesKnown(trip)) return [];
    var out = [], d = trip.start;
    for (var i = 0; i < MAX_DAYS && d <= trip.end; i++) { out.push(d); d = addDays(d, 1); }
    return out;
  }
  function stayGaps(trip) {
    var days = tripDayList(trip);
    if (days.length < 2) return [];
    var covered = {};
    trip.plan.forEach(function (p) {
      if (!(p.kind === "stay" || MOVES[p.kind]) || !isYmd(p.day)) return;
      var end = isYmd(p.day2) && p.day2 > p.day ? p.day2 : (p.kind === "stay" ? addDays(p.day, 1) : p.day);
      var d = p.day;
      for (var i = 0; i < MAX_DAYS && d < end; i++) { covered[d] = 1; d = addDays(d, 1); }
    });
    return days.slice(0, -1).filter(function (d) { return !covered[d]; });
  }
  // Entries of one day: timed by time, then the untimed in their order.
  // Fuel for a car trip: km one way, round trip doubles it, per100 =
  // litres (or kWh) per 100 km, price per litre (or kWh). null when
  // something is missing or out of range; cost per person when people > 1.
  function fuelCost(km, round, per100, price, people) {
    var ok = function (v, max) { return typeof v === "number" && isFinite(v) && v > 0 && v <= max; };
    if (!ok(km, 50000) || !ok(per100, 200) || !ok(price, 1000)) return null;
    var dist = Math.round(km * (round ? 2 : 1));
    var units = Math.round(dist * per100) / 100;
    var cost = Math.round(units * price * 100) / 100;
    var n = isInt(people) && people > 1 ? people : 1;
    return { dist: dist, units: units, cost: cost, each: n > 1 ? Math.round(cost / n * 100) / 100 : null };
  }
  function parseDec(v) {
    var x = parseFloat(String(v || "").trim().replace(",", "."));
    return isFinite(x) ? x : NaN;
  }
  function sortEntries(list) {
    return list.slice().sort(function (x, y) {
      if (!!x.t1 !== !!y.t1) return x.t1 ? -1 : 1;
      return cmpStr(x.t1, y.t1) || (x.pos - y.pos) || cmpStr(x.id, y.id);
    });
  }
  function entryTitle(p) {
    if (p.title) return p.title;
    if (MOVES[p.kind] && (p.from || p.to)) return t("kind." + p.kind) + " " + (p.from || "…") + " → " + (p.to || "…");
    return t("kind." + p.kind);
  }
  function itemsText(n) { return n === 1 ? t("tpl.items1") : t("tpl.items", { n: n }); }
  function grpName(g) { return g.charAt(0) === "@" ? t("grp." + g.slice(1)) : g; }
  // Built-in groups in their order ("Before I leave" last), then custom ones by name.
  function grpOrder(g) {
    if (g === "@before") return "2";
    if (g.charAt(0) === "@") return "0" + pad(GROUPS.indexOf(g.slice(1)));
    return "1" + g.toLocaleLowerCase();
  }
  function packGroups(items) {
    var by = {};
    items.forEach(function (p) { (by[p.grp] = by[p.grp] || []).push(p); });
    return Object.keys(by).sort(function (x, y) { return cmpStr(grpOrder(x), grpOrder(y)); }).map(function (g) {
      return { grp: g, items: by[g].sort(function (x, y) { return x.name.localeCompare(y.name, locale()) || cmpStr(x.id, y.id); }) };
    });
  }
  // upcoming | now | past | idea, and the countdown text.
  function tripPhase(trip, today) {
    if (!isYmd(trip.start)) return "idea";
    var end = datesKnown(trip) ? trip.end : trip.start;
    if (today < trip.start) return "next";
    if (today > end) return "past";
    return "now";
  }
  function countdown(trip, today) {
    var ph = tripPhase(trip, today);
    if (ph === "idea") return t("cd.nodate");
    if (ph === "past") return t("cd.ended");
    if (ph === "now") {
      if (today === trip.start) return t("cd.today");
      return t("cd.day", { d: dayDiff(trip.start, today) + 1, n: tripDays(trip) });
    }
    var n = dayDiff(today, trip.start);
    return n === 1 ? t("cd.tomorrow") : t("cd.in", { n: n });
  }
  function nightsText(trip) {
    var n = tripNights(trip);
    if (n < 0) return "";
    return n === 0 ? t("nights.0") : (n === 1 ? t("nights.1") : t("nights.n", { n: n }));
  }
  function fmtDate(s) { var m = YMD_RE.exec(s); return m ? m[3] + "/" + m[2] + "/" + m[1] : ""; }
  function fmtDay(s) {
    var wd = "";
    try { wd = parseYmd(s).toLocaleDateString(locale(), { weekday: "short" }); } catch (e) {}
    var m = YMD_RE.exec(s);
    return (wd ? wd + " " : "") + m[3] + "/" + m[2];
  }
  function fmtRange(trip) {
    if (!isYmd(trip.start)) return "";
    if (!datesKnown(trip) || trip.end === trip.start) return fmtDate(trip.start);
    return fmtDate(trip.start) + " – " + fmtDate(trip.end);
  }

  function fmtMoney(cents, cur) {
    var v = cents / 100;
    try { return new Intl.NumberFormat(locale(), { style: "currency", currency: cur }).format(v); }
    catch (e) { return v.toFixed(2) + " " + cur; }
  }
  // ----- Budget (wave 31) -----
  // Planned per category (trip.bplan, cents of the trip's currency) and
  // spent = expenses + the prices of bookings. Amounts in another
  // currency are never converted: they are totalled apart.
  var KIND_CAT = { flight: "transport", train: "transport", bus: "transport", ferry: "transport", car: "transport",
                   rental: "transport", stay: "stay", food: "food", activity: "fun", ticket: "fun", other: "other" };
  function tripCur(trip) { return trip.cur || "EUR"; }
  function budget(trip) {
    var cur = tripCur(trip), rows = {}, other = {}, tot = { plan: 0, spent: 0 };
    BUD_CATS.forEach(function (c) { rows[c] = { cat: c, plan: trip.bplan[c] || 0, spent: 0, n: 0 }; tot.plan += rows[c].plan; });
    function add(cat, amt, c) {
      if (!amt) return;
      c = c || cur;
      if (c !== cur) { other[c] = (other[c] || 0) + amt; return; }
      rows[cat].spent += amt;
      rows[cat].n++;
      tot.spent += amt;
    }
    trip.spend.forEach(function (x) { add(x.cat, x.amt, x.cur); });
    trip.plan.forEach(function (p) { add(KIND_CAT[p.kind] || "other", p.cost, p.ccur); });
    return { cur: cur, rows: BUD_CATS.map(function (c) { return rows[c]; }), total: tot,
             other: Object.keys(other).sort(cmpStr).map(function (c) { return { cur: c, amt: other[c] }; }) };
  }
  // "12,50" / "1.234,5" / "12.5" → cents, or -1 when it is not an amount.
  function parseCents(v) {
    var x = String(v === undefined || v === null ? "" : v).replace(/\s+/g, "");
    if (!x) return 0;
    if (!/^\d[\d.,]*$/.test(x)) return -1;
    var c = x.lastIndexOf(","), d = x.lastIndexOf(".");
    if (c >= 0 && d >= 0) x = c > d ? x.replace(/\./g, "").replace(",", ".") : x.replace(/,/g, "");
    else if (c >= 0) x = x.replace(",", ".");
    if ((x.match(/\./g) || []).length > 1) return -1;
    var n = Math.round(parseFloat(x) * 100);
    return isFinite(n) && n >= 0 && n <= MAX_CENTS ? n : -1;
  }

  // ----- Map points + GPX (wave 31) -----
  // The points of one day (or of the whole trip, day ""), in the order
  // of the itinerary: a journey adds its start (geo0) and its end (geo).
  function dayPoints(trip, day) {
    var out = [];
    planSections(trip).forEach(function (s) {
      if (day && s.day !== day) return;
      if (!s.day) return;
      s.items.forEach(function (p) {
        var name = entryTitle(p);
        if (MOVES[p.kind] && p.geo0) out.push({ lat: p.geo0.lat, lon: p.geo0.lon, name: p.from || name, id: p.id, day: s.day, kind: p.kind, end: 0 });
        if (p.geo) out.push({ lat: p.geo.lat, lon: p.geo.lon, name: MOVES[p.kind] ? (p.to || name) : name, id: p.id, day: s.day, kind: p.kind, end: 1 });
      });
    });
    return out;
  }
  // Entries that name a place but have no point yet ("Find on the map").
  function needsGeo(trip) {
    var out = [];
    trip.plan.forEach(function (p) {
      if (MOVES[p.kind]) {
        if (!p.geo0 && p.from) out.push({ id: p.id, which: "geo0", q: p.from, kind: p.kind });
        if (!p.geo && p.to) out.push({ id: p.id, which: "geo", q: p.to, kind: p.kind });
      } else if (!p.geo && (p.place || p.title)) out.push({ id: p.id, which: "geo", q: p.place || p.title, kind: p.kind });
    });
    return out;
  }
  // Photon query for a place: an airport code gets "airport".
  function geoQuery(q, kind) {
    var s = line(q, LEN.place);
    if (kind === "flight" && /^[A-Za-z]{3}$/.test(s)) return s.toUpperCase() + " airport";
    return s;
  }
  function xmlEsc(v) {
    return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  }
  // GPX 1.1: every point as a waypoint, each day as one track segment
  // joining its points in order (straight lines: the plan, not a road route).
  function tripGpx(trip, day) {
    var pts = dayPoints(trip, day || "");
    if (!pts.length) return "";
    var L = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<gpx version="1.1" creator="orOS Travel" xmlns="http://www.topografix.com/GPX/1/1">',
             "<metadata><name>" + xmlEsc(trip.name + (day ? " · " + fmtDay(day) : "")) + "</name></metadata>"];
    pts.forEach(function (p) {
      L.push('<wpt lat="' + p.lat + '" lon="' + p.lon + '"><name>' + xmlEsc(p.name) + "</name><desc>" + xmlEsc(fmtDay(p.day)) + "</desc></wpt>");
    });
    var byDay = {};
    pts.forEach(function (p) { (byDay[p.day] = byDay[p.day] || []).push(p); });
    var segs = Object.keys(byDay).sort(cmpStr).filter(function (d) { return byDay[d].length > 1; });
    if (segs.length) {
      L.push("<trk><name>" + xmlEsc(trip.name + (day ? " · " + fmtDay(day) : "")) + "</name>");
      segs.forEach(function (d) {
        L.push("<trkseg>" + byDay[d].map(function (p) { return '<trkpt lat="' + p.lat + '" lon="' + p.lon + '"></trkpt>'; }).join("") + "</trkseg>");
      });
      L.push("</trk>");
    }
    L.push("</gpx>");
    return L.join("\n") + "\n";
  }
  // Google polyline (precision 5), the preview line Maps keeps per track.
  function decodePoly(str) {
    var out = [], i = 0, lat = 0, lon = 0;
    str = typeof str === "string" ? str : "";
    while (i < str.length && out.length < 2000) {
      var vals = [0, 0];
      for (var k = 0; k < 2; k++) {
        var shift = 0, res = 0, b;
        do {
          if (i >= str.length) return out;
          b = str.charCodeAt(i++) - 63;
          res |= (b & 0x1f) << shift;
          shift += 5;
        } while (b >= 0x20 && shift < 35);
        vals[k] = (res & 1) ? ~(res >> 1) : (res >> 1);
      }
      lat += vals[0]; lon += vals[1];
      out.push([lat / 1e5, lon / 1e5]);
    }
    return out;
  }
  // An SVG path of [[lat, lon]…] fitted in w × h (north up, equal scale).
  function sketchPath(pts, w, h) {
    if (!pts || pts.length < 2) return "";
    var k = Math.cos((pts[0][0] || 0) * Math.PI / 180) || 1;
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    pts.forEach(function (p) {
      var x = p[1] * k, y = -p[0];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    });
    var span = Math.max(maxX - minX, maxY - minY) || 1, pad = 4;
    var sc = Math.min((w - 2 * pad) / ((maxX - minX) || span), (h - 2 * pad) / ((maxY - minY) || span));
    var ox = (w - (maxX - minX) * sc) / 2, oy = (h - (maxY - minY) * sc) / 2;
    return pts.map(function (p, i) {
      return (i ? "L" : "M") + (Math.round(((p[1] * k) - minX) * sc + ox) ) + " " + (Math.round((-p[0] - minY) * sc + oy));
    }).join("");
  }
  // The journal of a day has a fixed id per trip and day, so two devices
  // writing the same day join into one entry.
  function jrnlId(tripId, day) { return "j" + day.replace(/-/g, "") + "-" + tripId.slice(0, 31); }
  // What Split's "new group" deep link gets (split/split.js, BR-SPLIT-NEW).
  function splitTarget(trip) {
    return { newGroup: { name: line(trip.name || trip.dest, 40), cur: tripCur(trip),
                         people: trip.people.slice(0, 8), from: t("app") } };
  }

  // ---------- 3. Text + iCalendar builders ----------
  function entryLine(p) {
    var parts = [];
    var time = p.t1 + (p.t2 && p.kind !== "stay" && !(isYmd(p.day2) && p.day2 !== p.day) ? "–" + p.t2 : "");
    if (time) parts.push(time);
    parts.push(entryTitle(p));
    var sub = [];
    if (p.title && MOVES[p.kind] && (p.from || p.to)) sub.push((p.from || "…") + " → " + (p.to || "…"));
    if (MOVES[p.kind] && isYmd(p.day2) && p.day2 !== p.day) sub.push(t("f.arr") + " " + fmtDay(p.day2) + (p.t2 ? " " + p.t2 : ""));
    if (p.kind === "stay" && isYmd(p.day2)) sub.push(t("f.out") + " " + fmtDay(p.day2) + (p.t2 ? " " + p.t2 : ""));
    if (p.kind === "rental" && isYmd(p.day2) && p.day2 !== p.day) sub.push(t("f.ret") + " " + fmtDay(p.day2) + (p.t2 ? " " + p.t2 : ""));
    var who = [p.prov, p.num].filter(Boolean).join(" ");
    if (who) sub.push(who);
    if (p.place) sub.push(p.place);
    if (p.ref) sub.push(t("txt.ref") + " " + p.ref);
    if (p.cost) sub.push(fmtMoney(p.cost, p.ccur || "EUR"));
    return parts.join(" ") + (sub.length ? " · " + sub.join(" · ") : "");
  }
  function tripText(trip) {
    var L = [];
    L.push(trip.name);
    var dates = [fmtRange(trip), nightsText(trip)].filter(Boolean).join(" · ");
    if (dates) L.push(dates);
    if (trip.dest) L.push(t("txt.dest") + ": " + trip.dest);
    if (trip.people.length) L.push(t("txt.people") + ": " + trip.people.join(", "));
    if (trip.pack.length) {
      var done = trip.pack.filter(function (p) { return p.done; }).length;
      L.push("", t("txt.pack") + " · " + t("txt.packed", { d: done, n: trip.pack.length }));
      packGroups(trip.pack).forEach(function (g) {
        L.push("", grpName(g.grp));
        g.items.forEach(function (p) {
          L.push((p.done ? "☑ " : "☐ ") + (p.qty > 1 ? p.qty + " × " : "") + p.name +
                 (p.who ? " (" + p.who + ")" : "") + (p.note ? " · " + p.note : ""));
        });
      });
    }
    if (trip.plan.length) {
      L.push("", t("txt.plan"));
      planSections(trip).forEach(function (s) {
        if (!s.items.length) return;
        L.push("", s.label);
        s.items.forEach(function (p) {
          L.push("  " + entryLine(p));
          if (p.note) p.note.split("\n").forEach(function (n) { if (n.trim()) L.push("    " + n.trim()); });
        });
      });
    }
    if (trip.notes.trim()) L.push("", t("txt.notes"), trip.notes.trim());
    return L.join("\n") + "\n";
  }
  // Day sections for the itinerary: each trip day, then other dates, then no day.
  function planSections(trip) {
    var days = tripDayList(trip), inDays = {}, out = [];
    days.forEach(function (d, i) { inDays[d] = i; out.push({ day: d, label: fmtDay(d) + " · " + t("plan.dayN", { n: i + 1 }), items: [] }); });
    var other = {}, undated = [];
    trip.plan.forEach(function (p) {
      if (!isYmd(p.day)) undated.push(p);
      else if (p.day in inDays) out[inDays[p.day]].items.push(p);
      else (other[p.day] = other[p.day] || []).push(p);
    });
    out.forEach(function (s) { s.items = sortEntries(s.items); });
    Object.keys(other).sort(cmpStr).forEach(function (d) {
      out.push({ day: d, label: fmtDay(d) + " " + d.slice(0, 4), items: sortEntries(other[d]), other: true });
    });
    out.push({ day: "", label: t("plan.undated"), items: sortEntries(undated), undated: true });
    return out;
  }

  function icsEsc(s) {
    return String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
  }
  // RFC 5545 §3.1: lines longer than 75 octets fold with CRLF + space.
  function icsFold(s) {
    var out = "", n = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i), ch = s.charAt(i), b;
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) { ch = s.substr(i, 2); i++; b = 4; }
      else b = c < 0x80 ? 1 : (c < 0x800 ? 2 : 3);
      if (n + b > 75) { out += "\r\n "; n = 1; }
      out += ch;
      n += b;
    }
    return out;
  }
  function icsDate(s) { return s.replace(/-/g, ""); }
  function icsDT(day, hm) { return icsDate(day) + "T" + hm.replace(":", "") + "00"; }
  function icsStamp(ms) { return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z"); }
  // Times are the destination's local times, as on the ticket: they
  // are written "floating" (no time zone), which calendars show as is.
  function tripIcs(trip, now) {
    var L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//orOS//Travel 1.0//" + (LANG === "el" ? "EL" : "EN"),
             "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
    function ev(uid, start, end, summary, loc, desc) {
      L.push("BEGIN:VEVENT", "UID:" + uid + "@useoros.online", "DTSTAMP:" + icsStamp(now));
      L.push(start, end);
      L.push("SUMMARY:" + icsEsc(summary));
      if (loc) L.push("LOCATION:" + icsEsc(loc));
      if (desc) L.push("DESCRIPTION:" + icsEsc(desc));
      L.push("END:VEVENT");
    }
    if (datesKnown(trip)) {
      ev(trip.id, "DTSTART;VALUE=DATE:" + icsDate(trip.start), "DTEND;VALUE=DATE:" + icsDate(addDays(trip.end, 1)),
         trip.name, trip.dest, "");
    }
    trip.plan.forEach(function (p) {
      if (!isYmd(p.day)) return;
      var files = (trip.docs || []).filter(function (x) { return x.of === p.id; }).map(function (x) { return x.name || x.file; });
      var desc = [[p.prov, p.num].filter(Boolean).join(" "), p.ref ? t("f.ref") + ": " + p.ref : "",
                  p.cost ? t("f.cost") + ": " + fmtMoney(p.cost, p.ccur || tripCur(trip)) : "",
                  p.kind === "rental" && p.place ? t("f.pick") + ": " + p.place : "",
                  files.length ? t("ics.files", { list: files.join(", ") }) : "", p.note].filter(Boolean).join("\n");
      var last = isYmd(p.day2) && p.day2 >= p.day ? p.day2 : p.day;
      var start, end;
      if (p.kind === "stay") {
        start = "DTSTART;VALUE=DATE:" + icsDate(p.day);
        end = "DTEND;VALUE=DATE:" + icsDate(last > p.day ? last : addDays(p.day, 1));
        var times = [p.t1 ? t("f.in") + " " + p.t1 : "", p.t2 ? t("f.out") + " " + p.t2 : ""].filter(Boolean).join(" · ");
        if (times) desc = times + (desc ? "\n" + desc : "");
      } else if (p.t1) {
        start = "DTSTART:" + icsDT(p.day, p.t1);
        var e = p.t2 ? icsDT(last, p.t2) : "";
        end = e && e > icsDT(p.day, p.t1) ? "DTEND:" + e : "DURATION:PT1H";
      } else {
        start = "DTSTART;VALUE=DATE:" + icsDate(p.day);
        end = "DTEND;VALUE=DATE:" + icsDate(addDays(last, 1));
      }
      ev(p.id, start, end, entryTitle(p), p.place || (MOVES[p.kind] ? p.from : ""), desc);
    });
    L.push("END:VCALENDAR");
    return L.map(icsFold).join("\r\n") + "\r\n";
  }

  // ---------- 4. Storage + prefs ----------
  // BOOT MARKER
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    document.documentElement.lang = LANG;
    console.log("travel.js v" + (m ? m[1] : "?") + " boot");
  })();

  var data = null, prefs = null;
  var APP_V = (function () {
    var m = ((document.currentScript && document.currentScript.src) || "").match(/[?&]v=([^&#]+)/);
    return m ? m[1] : "1";
  })();

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.trips)) {
          data = mergeTravel(parsed, parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] travel: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
    }
    data = emptyData();
  }

  var saveFailShown = false;
  function saveNow() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      saveFailShown = false;
    } catch (e) {
      if (!saveFailShown) { saveFailShown = true; showToast(t("toast.save")); }   // R30
    }
    if (window.__orosSyncApi) window.__orosSyncApi.dirty();
  }

  function loadPrefs() {
    var p = null;
    try { p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null"); } catch (e) {}
    p = (p && typeof p === "object") ? p : {};
    prefs = {
      view: p.view === "trip" || p.view === "tpls" ? p.view : "list",
      trip: typeof p.trip === "string" && ID_RE.test(p.trip) ? p.trip : null,
      tab: ["plan", "notes", "map", "budget", "journal"].indexOf(p.tab) >= 0 ? p.tab : "pack",
      mapDay: isYmd(p.mapDay) ? p.mapDay : "",        // the day shown on the map ("" = all)
      jempty: p.jempty === 1 ? 1 : 0,                 // journal: only days with entries
      missing: p.missing === 1 ? 1 : 0,
      who: line(p.who, LEN.person),
      grp: normGrp(p.grp),
      past: p.past === 1 ? 1 : 0,
      rem: p.rem === 0 ? 0 : 1,                // reminders on this device (read by the shell engine)
      rain: (Array.isArray(p.rain) ? p.rain : []).filter(function (x) {
        return typeof x === "string" && ID_RE.test(x);
      }).slice(-30)                            // trips whose umbrella suggestion was dismissed
    };
  }
  var prefsTimer = null;
  function savePrefs() { clearTimeout(prefsTimer); prefsTimer = setTimeout(savePrefsNow, 300); }
  function savePrefsNow() {
    clearTimeout(prefsTimer); prefsTimer = null;
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  // ---------- 5. Mutations ----------
  // R27: a stamp moves only on a real change, at the mutation site.
  function stamp(e, k) { e.f[k] = Math.max(Date.now(), (e.f[k] || 0) + 1); }
  function setField(e, k, v) {
    if (JSON.stringify(e[k]) === JSON.stringify(v)) return false;
    e[k] = v;
    stamp(e, k);
    return true;
  }
  function newEnt(fields, norms, vals) {
    var e = { id: newId() }, f = {}, now = Date.now();
    fields.forEach(function (k) { e[k] = norms[k](vals[k]); f[k] = now; });
    e.f = f;
    return e;
  }
  function newTrip(vals) {
    var e = newEnt(TRIP_F, NORM.trip, vals);
    LISTS.forEach(function (k) { e[k] = []; });
    return e;
  }
  function newItem(vals) { return newEnt(PACK_F, NORM.pack, vals); }
  function newEntry(vals, id) { var e = newEnt(PLAN_F, NORM.plan, vals); if (id) e.id = id; return e; }

  function findTrip(id) {
    for (var i = 0; i < data.trips.length; i++) if (data.trips[i].id === id) return data.trips[i];
    return null;
  }
  function findIn(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function curTrip() { return prefs.trip ? findTrip(prefs.trip) : null; }

  // Every change: canonical copy, save (+ dirty), redraw.
  function commit(noRender) {
    data = mergeTravel(data, data);
    saveNow();
    if (!noRender) render();
  }

  function addPackItems(trip, items) {
    var room = MAX_PACK - trip.pack.length, n = 0;
    items.forEach(function (it) {
      if (n >= room) return;
      trip.pack.push(newItem({ name: it.name, qty: it.qty, rule: it.rule, grp: it.grp, who: it.who || "", note: it.note || "", done: false }));
      n++;
    });
    if (n < items.length) showToast(t("toast.max", { n: MAX_PACK }));
    return n;
  }

  // New dates: quantities that follow the days are counted again.
  function recountQty(trip) {
    var days = tripDays(trip);
    trip.pack.forEach(function (p) { if (p.rule) setField(p, "qty", ruleQty(p.rule, days)); });
  }

  function deleteTrip(id) {
    var trip = findTrip(id);
    if (!trip) return;
    var snap = clone(trip);
    data.tombs[id] = Math.max(Date.now(), life(trip));
    if (prefs.trip === id) { prefs.view = "list"; prefs.trip = null; savePrefs(); }
    commit();
    dropFilesLater(trip.docs.map(function (x) { return x.file; }));
    undoToast(t("toast.tripDel"), function () {
      snap.f.name = Math.max(Date.now(), (data.tombs[id] || 0) + 1);   // R17: a newer edit resurrects
      data.trips.push(snap);
      commit();
    });
  }
  // A deleted itinerary entry or journal day takes its attachments with it
  // (and Undo brings them back); files leave the disk after the Undo window.
  var REVIVE_F = { pack: "name", plan: "title", docs: "name", spend: "what", jrnl: "text" };
  function deleteItem(tripId, list, id, msg) {
    var trip = findTrip(tripId), e = trip && findIn(trip[list], id);
    if (!e) return;
    var snap = clone(e), now = Date.now();
    var kids = trip.docs.filter(function (x) { return x.of === id; }).map(clone);
    data.tombs[id] = Math.max(now, life(e));
    kids.forEach(function (x) { data.tombs[x.id] = Math.max(now, life(x)); });
    commit();
    dropFilesLater(kids.map(function (x) { return x.file; }));
    undoToast(t(msg), function () {
      var tr = findTrip(tripId);
      if (!tr) return;
      snap.f[REVIVE_F[list]] = Math.max(Date.now(), (data.tombs[id] || 0) + 1);
      tr[list].push(snap);
      kids.forEach(function (x) { x.f.name = Math.max(Date.now(), (data.tombs[x.id] || 0) + 1); tr.docs.push(x); });
      commit();
    });
  }

  function toggleDone(id) {
    var trip = curTrip(), p = trip && findIn(trip.pack, id);
    if (!p) return;
    setField(p, "done", !p.done);
    commit();
  }
  function uncheckAll() {
    var trip = curTrip();
    if (!trip) return;
    var ids = [];
    trip.pack.forEach(function (p) { if (p.done) { setField(p, "done", false); ids.push(p.id); } });
    if (!ids.length) return;
    commit();
    undoToast(t("toast.unchecked"), function () {
      var tr = curTrip();
      if (!tr) return;
      ids.forEach(function (id) { var p = findIn(tr.pack, id); if (p) setField(p, "done", true); });
      commit();
    });
  }

  // "3 socks" / "3x socks" / "3 × socks": a leading number is the quantity.
  function parseQuick(s) {
    var v = line(s, LEN.item + 4), m = /^(\d{1,2})\s*[x×]?\s+(.+)$/i.exec(v);
    if (m && +m[1] >= 1) return { name: line(m[2], LEN.item), qty: Math.min(+m[1], MAX_QTY) };
    return { name: line(v, LEN.item), qty: 1 };
  }
  function quickAdd() {
    var trip = curTrip(), inp = $("pack-in");
    if (!trip) return;
    var q = parseQuick(inp.value);
    if (!q.name) return;
    if (trip.pack.length >= MAX_PACK) { showToast(t("toast.max", { n: MAX_PACK })); return; }
    trip.pack.push(newItem({ name: q.name, qty: q.qty, rule: null, grp: prefs.grp, who: "", note: "", done: false }));
    inp.value = "";
    commit();
    inp.focus();
  }

  function moveEntry(id, dir) {
    var trip = curTrip(), p = trip && findIn(trip.plan, id);
    if (!p) return;
    var sec = null;
    planSections(trip).forEach(function (s) { if (s.items.indexOf(p) >= 0) sec = s; });
    if (!sec) return;
    var untimed = sec.items.filter(function (x) { return !x.t1; });
    var i = untimed.indexOf(p), j = i + dir;
    if (i < 0 || j < 0 || j >= untimed.length) return;
    untimed.forEach(function (x, k) { if (x.pos !== k) setField(x, "pos", k); });   // settle the order once
    var other = untimed[j];
    setField(p, "pos", j);
    setField(other, "pos", i);
    commit();
  }
  function nextPos(trip, day) {
    var m = -1;
    trip.plan.forEach(function (p) { if (p.day === day && p.pos > m) m = p.pos; });
    return m + 1;
  }

  // ---------- 6. Rendering ----------
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, txt) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt !== undefined) n.textContent = txt;
    return n;
  }
  function svg(path, fill) {
    return '<svg viewBox="0 0 24 24" fill="' + (fill ? "currentColor" : "none") +
           '" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + path + '</svg>';
  }
  var UI = {
    back:  svg('<path d="M15 18l-6-6 6-6"/>'),
    more:  svg('<circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/>', true),
    plus:  svg('<path d="M12 5v14M5 12h14"/>'),
    tpl:   svg('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>'),
    check: svg('<path d="M5 12l5 5 9-10"/>'),
    pin:   svg('<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>'),
    up:    svg('<path d="M6 15l6-6 6 6"/>'),
    down:  svg('<path d="M6 9l6 6 6-6"/>'),
    x:     svg('<path d="M18 6L6 18M6 6l12 12"/>'),
    edit:  svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
    bag:   svg('<rect x="4" y="7" width="16" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M4 12h16"/>'),
    coin:  svg('<circle cx="12" cy="12" r="8"/><path d="M14.5 9.5a2.5 2 0 0 0-2.5-1.5c-1.4 0-2.5.8-2.5 2s1.1 1.6 2.5 2 2.5.8 2.5 2-1.1 2-2.5 2a2.5 2 0 0 1-2.5-1.5M12 6.5v11"/>'),
    clip:  svg('<path d="M21 11.5l-8.6 8.6a5 5 0 0 1-7.1-7.1l8.6-8.6a3.3 3.3 0 0 1 4.7 4.7l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9"/>'),
    imp:   svg('<path d="M4 6h16v12H4z"/><path d="M4 7l8 6 8-6M12 15v6M9 18l3 3 3-3"/>'),
    kind: {
      rental:   svg('<path d="M5 16V11l2-5h10l2 5v5z"/><path d="M5 11h14"/><circle cx="8" cy="16.5" r="1.5"/><circle cx="16" cy="16.5" r="1.5"/><circle cx="18.5" cy="4.5" r="2"/><path d="M17 6l-2 2"/>'),
      ticket:   svg('<path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4z"/><path d="M14 6v12" stroke-dasharray="2 2"/>'),
      flight:   svg('<path d="M10.5 13.5L3 11l1.5-1.5 7 1L16 6a2 2 0 0 1 3 3l-4.5 4.5 1 7L14 22l-2.5-7.5-3 3V20l-1.5 1-1-3.5L2.5 16.5 4 15h2.5z"/>'),
      train:    svg('<rect x="5" y="3" width="14" height="14" rx="3"/><path d="M5 11h14M9 21l1.5-4M15 21l-1.5-4"/><circle cx="9" cy="14" r="0.6"/><circle cx="15" cy="14" r="0.6"/>'),
      bus:      svg('<rect x="4" y="3" width="16" height="15" rx="2"/><path d="M4 10h16M7 21v-3M17 21v-3"/><circle cx="8" cy="14.5" r="0.6"/><circle cx="16" cy="14.5" r="0.6"/>'),
      ferry:    svg('<path d="M3 17l2 3h14l2-3-9-3z"/><path d="M6 15V9h12v6M12 9V4M9 6h6"/>'),
      car:      svg('<path d="M5 16V11l2-5h10l2 5v5z"/><path d="M5 11h14"/><circle cx="8" cy="16.5" r="1.5"/><circle cx="16" cy="16.5" r="1.5"/>'),
      stay:     svg('<path d="M3 19V7M3 14h18v5M21 14v-2a3 3 0 0 0-3-3h-7v5"/><circle cx="7" cy="11" r="2"/>'),
      activity: svg('<path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z"/>'),
      food:     svg('<path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 21V3c-2 1-3 4-3 7h3"/>'),
      other:    svg('<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>')
    }
  };
  function iconBtn(cls, html, label, fn) {
    var b = el("button", cls);
    b.type = "button";
    b.innerHTML = html;
    b.setAttribute("aria-label", label);
    b.title = label;
    if (fn) b.addEventListener("click", fn);
    return b;
  }

  function mapsBridge() {
    try {
      var p = window.parent;
      return p && p !== window && typeof p.__orosOpenMapsQuery === "function" ? p : null;
    } catch (e) { return null; }
  }
  // With a saved point the exact place opens (__orosOpenMaps), else Maps geocodes the text.
  function openMaps(query, label, geo) {
    var p = mapsBridge();
    if (!p) return;
    if (geo && typeof p.__orosOpenMaps === "function") { p.__orosOpenMaps(geo.lat, geo.lon, label || query); return; }
    if (query) p.__orosOpenMapsQuery(query, label || query);
  }

  function isWide() {
    try { return window.matchMedia("(min-width: 900px)").matches; } catch (e) { return false; }
  }

  function render() {
    var trip = curTrip();
    if (prefs.view === "trip" && !trip) prefs.view = "list";
    renderToolbar(trip);
    $("v-list").hidden = prefs.view !== "list";
    $("v-trip").hidden = prefs.view !== "trip";
    $("v-tpls").hidden = prefs.view !== "tpls";
    if (prefs.view === "list") renderList();
    else if (prefs.view === "trip") renderTrip(trip);
    else renderTpls();
  }

  function renderToolbar(trip) {
    var v = prefs.view;
    $("back-btn").hidden = v === "list";
    $("title").textContent = v === "trip" && trip ? trip.name : (v === "tpls" ? t("btn.tpls") : t("app"));
    $("tpl-btn").hidden = v !== "list";
    $("new-btn").hidden = v !== "list";
    $("newtpl-btn").hidden = v !== "tpls";
    $("more-btn").hidden = v === "tpls";
  }

  function packCount(trip) {
    var d = 0;
    trip.pack.forEach(function (p) { if (p.done) d++; });
    return { d: d, n: trip.pack.length };
  }

  function tripCard(trip, today) {
    var b = el("button", "card");
    b.type = "button";
    b.addEventListener("click", function () { openTrip(trip.id); });
    var top = el("div", "card-top");
    top.appendChild(el("span", "card-name", trip.name));
    var ph = tripPhase(trip, today);
    top.appendChild(el("span", "badge badge-" + ph, countdown(trip, today)));
    b.appendChild(top);
    var sub = [trip.dest, fmtRange(trip), nightsText(trip)].filter(Boolean).join(" · ");
    if (sub) b.appendChild(el("div", "card-sub", sub));
    var c = packCount(trip);
    var bar = el("div", "card-bar");
    var prog = el("div", "prog");
    var fill = el("i");
    fill.style.width = (c.n ? Math.round(100 * c.d / c.n) : 0) + "%";
    prog.appendChild(fill);
    bar.appendChild(prog);
    bar.appendChild(el("span", "prog-txt", c.n ? t("pack.count", c) : t("pack.none")));
    b.appendChild(bar);
    return b;
  }

  function renderList() {
    var today = todayYmd(), groups = { now: [], next: [], idea: [], past: [] };
    data.trips.forEach(function (tr) { groups[tripPhase(tr, today)].push(tr); });
    function byStart(x, y) { return cmpStr(x.start, y.start) || x.name.localeCompare(y.name, locale()) || cmpStr(x.id, y.id); }
    groups.now.sort(byStart);
    groups.next.sort(byStart);
    groups.idea.sort(function (x, y) { return x.name.localeCompare(y.name, locale()) || cmpStr(x.id, y.id); });
    groups.past.sort(function (x, y) { return -byStart(x, y); });
    var host = $("trips");
    host.innerHTML = "";
    $("list-empty").hidden = data.trips.length > 0;
    [["now", "list.now"], ["next", "list.next"], ["idea", "list.idea"]].forEach(function (g) {
      if (!groups[g[0]].length) return;
      var sec = el("section", "tsec");
      sec.appendChild(el("h2", "", t(g[1])));
      var grid = el("div", "cards");
      groups[g[0]].forEach(function (tr) { grid.appendChild(tripCard(tr, today)); });
      sec.appendChild(grid);
      host.appendChild(sec);
    });
    if (groups.past.length) {
      var det = el("details", "tsec past");
      det.open = !!prefs.past;
      det.appendChild(el("summary", "", t("list.past", { n: groups.past.length })));
      var grid = el("div", "cards");
      groups.past.forEach(function (tr) { grid.appendChild(tripCard(tr, today)); });
      det.appendChild(grid);
      det.addEventListener("toggle", function () { prefs.past = det.open ? 1 : 0; savePrefs(); });
      host.appendChild(det);
    }
  }

  function openTrip(id) {
    prefs.view = "trip";
    prefs.trip = id;
    if (prefs.who) prefs.who = "";
    savePrefs();
    render();
    $("main").scrollTop = 0;
  }
  function goBack() {
    commitNotes();
    prefs.view = "list";
    savePrefs();
    render();
  }

  // ----- Trip view -----
  function renderTrip(trip) {
    var today = todayYmd();
    var head = $("trip-head");
    head.innerHTML = "";
    var l1 = el("div", "th-row");
    l1.appendChild(el("span", "badge badge-" + tripPhase(trip, today), countdown(trip, today)));
    var dates = [fmtRange(trip), nightsText(trip)].filter(Boolean).join(" · ");
    if (dates) l1.appendChild(el("span", "th-dates", dates));
    head.appendChild(l1);
    if (trip.dest) {
      var l2 = el("div", "th-row");
      l2.appendChild(el("span", "th-dest", trip.dest));
      if (mapsBridge()) {
        l2.appendChild(iconBtn("mini", UI.pin, t("head.maps"), function () { openMaps(trip.dest, trip.dest); }));
      }
      head.appendChild(l2);
    }
    if (trip.people.length) head.appendChild(el("div", "th-people", t("head.people", { list: trip.people.join(", ") })));
    renderWx(trip, today, head);

    var wide = isWide();
    var tab = prefs.tab;
    var both = wide && (tab === "pack" || tab === "plan");
    $("tab-pack").textContent = wide ? t("tab.both") : t("tab.pack");
    $("tab-plan").hidden = wide;
    var on = { pack: both || tab === "pack", plan: !wide && tab === "plan" };
    PANES.forEach(function (k) {
      var x = k in on ? on[k] : tab === k;
      var b = $("tab-" + k);
      b.classList.toggle("on", x);
      b.setAttribute("aria-selected", x ? "true" : "false");
    });
    $("panes").classList.toggle("both", both);
    $("p-pack").hidden = !(both || tab === "pack");
    $("p-plan").hidden = !(both || tab === "plan");
    ["notes", "map", "budget", "journal"].forEach(function (k) { $("p-" + k).hidden = tab !== k; });
    if (!$("p-pack").hidden) renderPack(trip);
    if (!$("p-plan").hidden) renderPlan(trip);
    if (!$("p-notes").hidden) renderNotes(trip);
    if (!$("p-map").hidden) renderMapPane(trip);
    if (!$("p-budget").hidden) renderBudget(trip);
    if (!$("p-journal").hidden) renderJournal(trip);
  }
  var PANES = ["pack", "plan", "map", "budget", "journal", "notes"];

  function setTab(tab) {
    if (prefs.tab === "notes" && tab !== "notes") commitNotes();
    prefs.tab = tab;
    savePrefs();
    render();
  }

  function grpOptions(sel, trip, current, withNew) {
    sel.innerHTML = "";
    var seen = {};
    GROUPS.forEach(function (g) {
      var o = el("option", "", t("grp." + g));
      o.value = "@" + g;
      sel.appendChild(o);
      seen["@" + g] = 1;
    });
    var custom = [];
    if (trip) trip.pack.forEach(function (p) { if (!seen[p.grp]) { seen[p.grp] = 1; custom.push(p.grp); } });
    if (current && !seen[current]) custom.push(current);
    custom.sort(function (x, y) { return x.localeCompare(y, locale()); }).forEach(function (g) {
      var o = el("option", "", g);
      o.value = g;
      sel.appendChild(o);
    });
    if (withNew) {
      var n = el("option", "", t("grp.custom"));
      n.value = "+";
      sel.appendChild(n);
    }
    sel.value = current || "@misc";
  }

  function renderPack(trip) {
    var c = packCount(trip);
    $("pack-prog-fill").style.width = (c.n ? Math.round(100 * c.d / c.n) : 0) + "%";
    $("pack-prog-txt").textContent = c.n ? t("pack.count", c) : t("pack.none");
    grpOptions($("pack-grp"), trip, prefs.grp, false);
    var mb = $("pack-missing");
    mb.classList.toggle("on", !!prefs.missing);
    mb.setAttribute("aria-pressed", prefs.missing ? "true" : "false");
    var ws = $("pack-who");
    ws.hidden = trip.people.length < 2;
    if (!ws.hidden) {
      ws.innerHTML = "";
      var all = el("option", "", t("pack.everyone"));
      all.value = "";
      ws.appendChild(all);
      trip.people.forEach(function (p) { var o = el("option", "", p); o.value = p; ws.appendChild(o); });
      ws.value = trip.people.indexOf(prefs.who) >= 0 ? prefs.who : "";
    }
    $("pack-uncheck").hidden = c.d === 0;
    var who = ws.hidden ? "" : ws.value;
    var items = trip.pack.filter(function (p) {
      if (prefs.missing && p.done) return false;
      if (who && p.who && p.who !== who) return false;
      return true;
    });
    var host = $("pack-list");
    host.innerHTML = "";
    var msg = $("pack-msg");
    if (!trip.pack.length) msg.textContent = t("pack.empty");
    else if (c.d === c.n) msg.textContent = t("pack.done");
    else if (!items.length) msg.textContent = t("pack.filtered");
    else msg.textContent = "";
    msg.hidden = !msg.textContent;
    packGroups(items).forEach(function (g) {
      var sec = el("section", "pgrp" + (g.grp === "@before" ? " before" : ""));
      var all = trip.pack.filter(function (p) { return p.grp === g.grp; });
      var dn = all.filter(function (p) { return p.done; }).length;
      var h = el("h3", "");
      h.appendChild(el("span", "", grpName(g.grp)));
      h.appendChild(el("span", "count", dn + "/" + all.length));
      sec.appendChild(h);
      var ul = el("ul", "plist");
      g.items.forEach(function (p) { ul.appendChild(packRow(p)); });
      sec.appendChild(ul);
      host.appendChild(sec);
    });
  }

  function packRow(p) {
    var li = el("li", "pi" + (p.done ? " done" : ""));
    var chk = iconBtn("chk", p.done ? UI.check : "", t("pack.check", { name: p.name }), function () { toggleDone(p.id); });
    chk.setAttribute("aria-pressed", p.done ? "true" : "false");
    li.appendChild(chk);
    var body = el("button", "pi-body");
    body.type = "button";
    body.setAttribute("aria-label", t("pack.edit", { name: p.name }));
    if (p.qty > 1) body.appendChild(el("span", "pi-qty", p.qty + "×"));
    body.appendChild(el("span", "pi-name", p.name));
    if (p.who) body.appendChild(el("span", "pi-who", p.who));
    if (p.note) body.appendChild(el("span", "pi-note", p.note));
    body.addEventListener("click", function () { itemDialog(p.id); });
    li.appendChild(body);
    return li;
  }

  function renderPlan(trip) {
    var host = $("plan-days");
    host.innerHTML = "";
    var gaps = stayGaps(trip), gap = $("plan-gap");
    gap.hidden = !gaps.length;
    if (gaps.length) {
      var list = gaps.map(fmtDay).join(", ");
      gap.textContent = gaps.length === 1 ? t("plan.gap1", { days: list }) : t("plan.gapN", { n: gaps.length, days: list });
    }
    $("plan-msg").hidden = trip.plan.length > 0;
    var stays = trip.plan.filter(function (p) { return p.kind === "stay" && isYmd(p.day); });
    planSections(trip).forEach(function (s) {
      var marks = [];
      if (s.day) {
        stays.forEach(function (st) {
          if (st.day < s.day && isYmd(st.day2) && s.day < st.day2) marks.push({ st: st, txt: t("plan.night", { name: entryTitle(st) }) });
          if (isYmd(st.day2) && st.day2 === s.day && st.day2 > st.day) {
            marks.push({ st: st, txt: t("plan.checkout", { name: entryTitle(st) }) + (st.t2 ? " · " + st.t2 : "") });
          }
        });
      }
      if ((s.other || s.undated) && !s.items.length) return;
      var sec = el("section", "pday" + (s.day === todayYmd() ? " today" : ""));
      var h = el("div", "pday-h");
      h.appendChild(el("h3", "", s.label));
      h.appendChild(iconBtn("mini", UI.plus, s.undated ? t("plan.add") : t("plan.addDay", { day: fmtDay(s.day) }),
        function () { planDialog(null, s.undated ? "" : s.day); }));
      sec.appendChild(h);
      var ul = el("ul", "elist");
      marks.forEach(function (m) {
        var li = el("li", "emark");
        var b = el("button", "emark-b");
        b.type = "button";
        b.innerHTML = UI.kind.stay;
        b.appendChild(el("span", "", m.txt));
        b.addEventListener("click", function () { planDialog(m.st.id); });
        li.appendChild(b);
        ul.appendChild(li);
      });
      var untimed = s.items.filter(function (x) { return !x.t1; });
      s.items.forEach(function (p) { ul.appendChild(entryRow(trip, p, untimed)); });
      sec.appendChild(ul);
      host.appendChild(sec);
    });
  }

  function entryRow(trip, p, untimed) {
    var li = el("li", "er er-" + p.kind);
    var b = el("button", "er-body");
    b.type = "button";
    var ic = el("span", "er-ic");
    ic.innerHTML = UI.kind[p.kind];
    b.appendChild(ic);
    var tm = el("span", "er-time", p.t1 ? p.t1 + (p.t2 && p.kind !== "stay" && !(isYmd(p.day2) && p.day2 !== p.day) ? "–" + p.t2 : "") : "");
    b.appendChild(tm);
    var tx = el("span", "er-txt");
    tx.appendChild(el("span", "er-title", entryTitle(p)));
    var sub = [];
    if (p.title && MOVES[p.kind] && (p.from || p.to)) sub.push((p.from || "…") + " → " + (p.to || "…"));
    if (MOVES[p.kind] && isYmd(p.day2) && p.day2 !== p.day) sub.push(t("f.arr") + " " + fmtDay(p.day2) + (p.t2 ? " " + p.t2 : ""));
    if (p.kind === "stay" && isYmd(p.day2)) sub.push(t("f.out") + " " + fmtDay(p.day2));
    if (p.kind === "rental" && isYmd(p.day2) && p.day2 !== p.day) sub.push(t("f.ret") + " " + fmtDay(p.day2) + (p.t2 ? " " + p.t2 : ""));
    var who = [p.prov, p.num].filter(Boolean).join(" ");
    if (who) sub.push(who);
    if (p.place) sub.push(p.place);
    if (p.ref) sub.push("#" + p.ref);
    if (p.cost) sub.push(fmtMoney(p.cost, p.ccur || tripCur(trip)));
    if (sub.length) tx.appendChild(el("span", "er-sub", sub.join(" · ")));
    var nDocs = docsOf(trip, p.id).length;
    if (nDocs) {
      var clip = el("span", "er-clip");
      clip.innerHTML = UI.clip;
      clip.appendChild(el("span", "", String(nDocs)));
      clip.setAttribute("aria-label", t("at.n", { n: nDocs }));
      clip.title = t("at.n", { n: nDocs });
      tx.appendChild(clip);
    }
    b.appendChild(tx);
    b.addEventListener("click", function () { planDialog(p.id); });
    li.appendChild(b);
    var q = p.place || (MOVES[p.kind] ? p.to : "");
    if (q && mapsBridge()) li.appendChild(iconBtn("mini", UI.pin, t("plan.maps"), function () { openMaps(q, entryTitle(p), p.geo); }));
    if (!p.t1 && untimed.length > 1) {
      var i = untimed.indexOf(p);
      var upb = iconBtn("mini", UI.up, t("plan.up"), function () { moveEntry(p.id, -1); });
      var dnb = iconBtn("mini", UI.down, t("plan.down"), function () { moveEntry(p.id, 1); });
      upb.disabled = i === 0;
      dnb.disabled = i === untimed.length - 1;
      li.appendChild(upb);
      li.appendChild(dnb);
    }
    return li;
  }

  var notesTimer = null;
  function renderNotes(trip) {
    var ta = $("notes");
    if (document.activeElement !== ta || notesTimer === null) {
      if (ta.value !== trip.notes) ta.value = trip.notes;
    }
    ta.setAttribute("data-trip", trip.id);
  }
  function commitNotes() {
    clearTimeout(notesTimer);
    notesTimer = null;
    var ta = $("notes"), trip = findTrip(ta.getAttribute("data-trip") || "");
    if (!trip) return;
    if (setField(trip, "notes", text(ta.value, LEN.notes))) commit(true);
  }

  // ----- Templates view -----
  function renderTpls() {
    var all = tplList(data);
    var ready = $("tpl-ready"), mine = $("tpl-mine");
    ready.innerHTML = "";
    mine.innerHTML = "";
    all.forEach(function (tp) {
      var b = el("button", "tpl-row");
      b.type = "button";
      b.appendChild(el("span", "tpl-name", tp.name));
      var meta = itemsText(tp.items.length) + (tp.kind === "edited" ? " · " + t("tpl.edited") : "");
      b.appendChild(el("span", "tpl-meta", meta));
      b.addEventListener("click", function () { tplDialog(tp); });
      (tp.kind === "mine" ? mine : ready).appendChild(b);
    });
    $("tpl-mine-empty").hidden = mine.children.length > 0;
    $("tpl-ready-empty").hidden = ready.children.length > 0;
    $("tpl-restore").hidden = !needsRestore();
  }
  function needsRestore() {
    var stored = {};
    data.tpls.forEach(function (x) { stored[x.id] = x; });
    return SEED_IDS.some(function (id) {
      var x = stored[id];
      return x ? !x.seed : (id in data.tombs);
    });
  }
  function restoreSeeds() {
    var now = Date.now(), stored = {};
    data.tpls.forEach(function (x) { stored[x.id] = x; });
    SEED_IDS.forEach(function (id) {
      var x = stored[id];
      if (x && x.seed) return;
      if (!x && !(id in data.tombs)) return;
      var m = Math.max(now, x ? x.m + 1 : 0, (data.tombs[id] || 0) + 1);
      data.tpls = data.tpls.filter(function (y) { return y.id !== id; });
      data.tpls.push({ id: id, m: m, seed: 1 });
    });
    commit();
    showToast(t("toast.restored"));
  }

  // ----- Destination forecast -----
  // Open-Meteo, the same endpoint and numbers as the Weather app. Shown
  // when the trip overlaps the next 7 days. The destination text is
  // geocoded once; the result and the forecast live in a device-local
  // cache (oros-travel-wx, never synced), refreshed at most every 3 h
  // and only online. Offline: the last forecast with its time.
  var WX_KEY = "oros-travel-wx", WX_TTL = 3 * 3600000, WX_DAYS = 7, WX_KEEP = 12, WX_RAIN = 60;
  var wxBusy = {};
  function wxQuery(trip) { return trip.dest.toLocaleLowerCase(); }
  function wxLoad() {
    var c = null;
    try { c = JSON.parse(localStorage.getItem(WX_KEY) || "null"); } catch (e) {}
    return c && typeof c === "object" && c.by && typeof c.by === "object" ? c : { by: {} };
  }
  function wxStore(q, entry) {
    var c = wxLoad();
    c.by[q] = entry;
    var keys = Object.keys(c.by).sort(function (a, b) { return (c.by[b].at || 0) - (c.by[a].at || 0); });
    keys.slice(WX_KEEP).forEach(function (k) { delete c.by[k]; });
    try { localStorage.setItem(WX_KEY, JSON.stringify(c)); } catch (e) {}
  }
  function wxWanted(trip, today) {
    return !!trip.dest && datesKnown(trip) && trip.end >= today && trip.start <= addDays(today, WX_DAYS - 1);
  }
  function wxNum(v) { return typeof v === "number" && isFinite(v) ? v : null; }
  function wxFetch(trip) {
    var q = wxQuery(trip);
    if (wxBusy[q] || !navigator.onLine || typeof fetch !== "function") return;
    var old = wxLoad().by[q];
    if (old && Date.now() - (old.at || 0) < WX_TTL) return;
    wxBusy[q] = true;
    var lang = LANG === "el" ? "el" : "en";
    var geo = old && wxNum(old.lat) !== null && wxNum(old.lon) !== null ? Promise.resolve(old) :
      fetch("https://geocoding-api.open-meteo.com/v1/search?count=1&language=" + lang +
            "&name=" + encodeURIComponent(trip.dest.split(",")[0].trim()))
        .then(function (r) { if (!r.ok) throw new Error("http " + r.status); return r.json(); })
        .then(function (d) {
          var g = d && d.results && d.results[0];
          if (!g || wxNum(g.latitude) === null || wxNum(g.longitude) === null) return null;
          return { lat: g.latitude, lon: g.longitude,
                   place: line([g.name, g.country].filter(function (x) { return typeof x === "string" && x; }).join(", "), 100) };
        });
    geo.then(function (g) {
      if (!g) { wxStore(q, { at: Date.now(), nf: 1 }); return null; }
      return fetch("https://api.open-meteo.com/v1/forecast?latitude=" + g.lat + "&longitude=" + g.lon +
                   "&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max" +
                   "&timezone=auto&forecast_days=" + WX_DAYS)
        .then(function (r) { if (!r.ok) throw new Error("http " + r.status); return r.json(); })
        .then(function (d) {
          var dl = d && d.daily, days = [];
          if (!dl || !Array.isArray(dl.time)) throw new Error("bad");
          dl.time.forEach(function (day, i) {
            if (!isYmd(day)) return;
            days.push({ d: day, c: wxNum((dl.weathercode || [])[i]),
                        hi: wxNum((dl.temperature_2m_max || [])[i]), lo: wxNum((dl.temperature_2m_min || [])[i]),
                        pp: wxNum((dl.precipitation_probability_max || [])[i]) });
          });
          wxStore(q, { at: Date.now(), lat: g.lat, lon: g.lon, place: g.place, days: days });
        });
    }).catch(function () {
      if (old) { old.err = 1; wxStore(q, old); }        // keep the last good forecast, retry after the TTL
      else wxStore(q, { at: Date.now(), err: 1 });
    }).then(function () {
      wxBusy[q] = false;
      var cur = curTrip();
      if (prefs.view === "trip" && cur && wxQuery(cur) === q && !document.querySelector("dialog[open]")) render();
    });
  }
  function wxKind(c) {
    if (c === null) return "";
    if (c === 0) return "clear";
    if (c <= 2) return "part";
    if (c === 3) return "cloud";
    if (c === 45 || c === 48) return "fog";
    if ((c >= 71 && c <= 77) || c === 85 || c === 86) return "snow";
    if (c >= 95) return "storm";
    return "rain";
  }
  var WX_ICON = { clear: "\u2600\ufe0f", part: "\u26c5", cloud: "\u2601\ufe0f", fog: "\ud83c\udf2b\ufe0f",
                  rain: "\ud83c\udf27\ufe0f", snow: "\ud83c\udf28\ufe0f", storm: "\u26c8\ufe0f" };
  function wxDayName(s) {
    try { return parseYmd(s).toLocaleDateString(locale(), { weekday: "short", day: "numeric" }); }
    catch (e) { return fmtDate(s); }
  }
  function wxBtn(label, cls, fn) {
    var b = el("button", cls, label);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }
  function hasUmbrella(trip) {
    return trip.pack.some(function (p) { return /umbrella|ομπρέλα|ομπρελα/i.test(p.name); });
  }
  function renderWx(trip, today, head) {
    if (!trip.dest || !datesKnown(trip) || trip.end < today) return;
    if (!wxWanted(trip, today)) { head.appendChild(el("div", "hint wx-hint", t("wx.later"))); return; }
    wxFetch(trip);
    var c = wxLoad().by[wxQuery(trip)];
    if (!c) return;
    if (c.nf) { head.appendChild(el("div", "hint wx-hint", t("wx.nf"))); return; }
    var days = (c.days || []).filter(function (d) { return d.d >= trip.start && d.d <= trip.end && d.d >= today; });
    if (!days.length) { if (c.err) head.appendChild(el("div", "hint wx-hint", t("wx.fail"))); return; }
    var box = el("div", "wx");
    var at = new Date(c.at);
    box.appendChild(el("div", "hint wx-hint", t("wx.title", { place: c.place || trip.dest }) + " · " +
      t("wx.at", { time: fmtDate(ymd(at)) === fmtDate(today) ? pad(at.getHours()) + ":" + pad(at.getMinutes()) : fmtDate(ymd(at)) })));
    var strip = el("div", "wx-strip");
    days.forEach(function (d) {
      var k = wxKind(d.c);
      var cell = el("div", "wx-day");
      cell.appendChild(el("span", "wx-dn", wxDayName(d.d)));
      var ic = el("span", "wx-ic", k ? WX_ICON[k] : "");
      if (k) { ic.setAttribute("role", "img"); ic.setAttribute("aria-label", t("wx.c." + k)); ic.title = t("wx.c." + k); }
      cell.appendChild(ic);
      if (d.hi !== null && d.lo !== null) cell.appendChild(el("span", "wx-t", Math.round(d.hi) + "° / " + Math.round(d.lo) + "°"));
      if (d.pp !== null && d.pp >= 20) {
        var pp = el("span", "wx-pp", d.pp + "%");
        pp.title = t("wx.pp", { n: d.pp });
        cell.appendChild(pp);
      }
      strip.appendChild(cell);
    });
    box.appendChild(strip);
    head.appendChild(box);
    // One-tap suggestion, never automatic.
    var wet = days.filter(function (d) { return d.pp !== null && d.pp >= WX_RAIN; })[0];
    if (wet && !hasUmbrella(trip) && prefs.rain.indexOf(trip.id) < 0) {
      var sug = el("div", "warn wx-rain");
      sug.appendChild(el("span", "wx-rain-t", t("wx.rain", { day: wxDayName(wet.d) })));
      var tripId = trip.id;
      sug.appendChild(wxBtn(t("wx.add"), "txt-btn small primary", function () {
        var tr = findTrip(tripId);
        if (!tr) return;
        addPackItems(tr, [{ name: t("wx.umbrella"), grp: "@gear", qty: 1, rule: null }]);
        commit();
      }));
      sug.appendChild(wxBtn(t("wx.no"), "link-btn", function () {
        prefs.rain = prefs.rain.concat([tripId]).slice(-30);
        savePrefs();
        render();
      }));
      head.appendChild(sug);
    }
  }

  // ---------- 7. Dialogs ----------
  function makeDialog(id, wide) {
    var stale = document.getElementById(id);
    if (stale) stale.remove();
    closeMenu();
    var dlg = document.createElement("dialog");
    dlg.id = id;
    dlg.className = "mm-dlg" + (wide ? " wide" : "");
    dlg.addEventListener("close", function () {
      parkToast();
      setTimeout(function () { dlg.remove(); }, 0);
    });
    return dlg;
  }
  function button(label, cls, fn) {
    var b = el("button", "dlg-btn" + (cls ? " " + cls : ""), label);
    b.type = "button";
    if (fn) b.addEventListener("click", fn);
    return b;
  }
  var fieldSeq = 0;
  function input(type, max, value, ph) {
    var i = el("input");
    i.type = type;
    i.id = "tf-" + (++fieldSeq);
    if (max) i.maxLength = max;
    i.value = value || "";
    if (ph) i.placeholder = ph;
    i.autocomplete = "off";
    return i;
  }
  function select(opts, value) {
    var s = el("select");
    s.id = "tf-" + (++fieldSeq);
    opts.forEach(function (o) { var x = el("option", "", o[1]); x.value = o[0]; s.appendChild(x); });
    s.value = value;
    return s;
  }
  function field(label, ctl, cls) {
    var w = el("div", "fld" + (cls ? " " + cls : ""));
    var l = el("label", "dlg-lbl", label);
    l.setAttribute("for", ctl.id);
    w.appendChild(l);
    w.appendChild(ctl);
    return w;
  }
  function row() {
    var r = el("div", "frow");
    [].slice.call(arguments).forEach(function (x) { r.appendChild(x); });
    return r;
  }
  function actions(dlg, okLabel, leftBtn) {
    var acts = el("div", "dlg-actions");
    if (leftBtn) { acts.appendChild(leftBtn); acts.appendChild(el("span", "spacer")); }
    acts.appendChild(button(t("dlg.cancel"), "", function () { dlg.close(); }));
    var ok = button(okLabel, "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    return acts;
  }
  function show(dlg, focus) {
    document.body.appendChild(dlg);
    dlg.showModal();
    if (focus) { focus.focus(); if (focus.select && focus.type === "text") focus.select(); }
  }

  // Template checkboxes (new trip, add from template).
  function tplChecks(checked) {
    var box = el("div", "tchecks"), list = [];
    tplList(data).forEach(function (tp) {
      var lab = el("label", "tcheck");
      var cb = el("input");
      cb.type = "checkbox";
      cb.checked = checked.indexOf(tp.id) >= 0;
      lab.appendChild(cb);
      lab.appendChild(el("span", "tc-name", tp.name));
      lab.appendChild(el("span", "tc-n", String(tp.items.length)));
      box.appendChild(lab);
      list.push({ cb: cb, tp: tp });
    });
    if (!list.length) box.appendChild(el("p", "hint", t("tpl.none")));
    return { box: box, picked: function () { return list.filter(function (x) { return x.cb.checked; }).map(function (x) { return x.tp; }); } };
  }

  function tripDialog(tripId) {
    var trip = tripId ? findTrip(tripId) : null;
    if (!trip && data.trips.length >= MAX_TRIPS) { showToast(t("toast.max", { n: MAX_TRIPS })); return; }
    var dlg = makeDialog("tr-trip");
    dlg.appendChild(el("div", "dlg-title", t(trip ? "dlg.editTrip" : "dlg.newTrip")));
    var form = el("form");
    form.method = "dialog";
    var fName = input("text", LEN.name, trip ? trip.name : "", t("f.namePh"));
    var fDest = input("text", LEN.dest, trip ? trip.dest : "", t("f.destPh"));
    var fStart = input("date", 0, trip ? trip.start : "");
    var fEnd = input("date", 0, trip ? trip.end : "");
    fEnd.min = fStart.value;
    fStart.addEventListener("change", function () {
      fEnd.min = fStart.value;
      if (fStart.value && (!fEnd.value || fEnd.value < fStart.value)) fEnd.value = fStart.value;
    });
    var fPeople = input("text", 300, trip ? trip.people.join(", ") : "", t("f.peoplePh"));
    form.appendChild(field(t("f.name"), fName));
    form.appendChild(field(t("f.dest"), fDest));
    form.appendChild(row(field(t("f.start"), fStart), field(t("f.end"), fEnd)));
    form.appendChild(field(t("f.people"), fPeople));
    var checks = null;
    if (!trip) {
      form.appendChild(el("div", "dlg-lbl", t("f.tpls")));
      checks = tplChecks(DEFAULT_TPLS);
      form.appendChild(checks.box);
    }
    form.appendChild(actions(dlg, t(trip ? "dlg.save" : "dlg.create")));
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = line(fName.value, LEN.name) || line(fDest.value, LEN.name);
      if (!name) { showToast(t("toast.needName")); fName.focus(); return; }
      var start = normDate(fStart.value), end = normDate(fEnd.value);
      if (!start) end = "";
      else if (!end) end = start;
      if (end < start) { showToast(t("toast.dates")); fEnd.focus(); return; }
      var vals = { name: name, dest: line(fDest.value, LEN.dest), start: start, end: end,
                   people: normPeople(fPeople.value.split(",")) };
      if (trip) {
        var tr = findTrip(trip.id);
        if (!tr) { dlg.close(); showToast(t("toast.gone")); render(); return; }
        var datesBefore = tripDays(tr);
        ["name", "dest", "start", "end", "people"].forEach(function (k) { setField(tr, k, vals[k]); });
        if (tripDays(tr) !== datesBefore) recountQty(tr);
        dlg.close();
        commit();
        return;
      }
      vals.notes = "";
      var nt = newTrip(vals);
      var picked = checks.picked();
      if (picked.length) addPackItems(nt, combineTpls(picked, tripDays(nt)));
      data.trips.push(nt);
      dlg.close();
      commit(true);
      openTrip(nt.id);
    });
    dlg.appendChild(form);
    show(dlg, fName);
  }

  // Quantity: fixed, N per day, or one every N days (follows the trip's days).
  function qtyControls(qty, rule, days) {
    var mode = select([["fix", t("rule.fix")], ["day", t("rule.day")], ["every", t("rule.every")]], rule ? rule.m : "fix");
    var num = input("number", 0, String(rule ? rule.n : qty));
    num.inputMode = "numeric";
    var hint = el("p", "hint qty-hint");
    function lim() {
      var m = mode.value;
      num.min = m === "every" ? 2 : 1;
      num.max = m === "fix" ? MAX_QTY : (m === "day" ? 20 : 14);
    }
    function read() {
      var n = parseInt(num.value, 10), m = mode.value;
      if (!isFinite(n)) n = m === "every" ? 2 : 1;
      var r = m === "fix" ? null : normRule({ m: m, n: n });
      if (m !== "fix" && !r) r = { m: m, n: m === "every" ? Math.max(2, Math.min(14, n)) : Math.max(1, Math.min(20, n)) };
      return { rule: r, qty: r ? ruleQty(r, days) : normQty(n) };
    }
    function upd() {
      lim();
      var v = read();
      hint.textContent = v.rule ? "= " + v.qty + " · " +
        (v.rule.m === "day" ? t("rule.hintDay", { n: v.rule.n }) : t("rule.hintEvery", { n: v.rule.n })) : "";
      hint.hidden = !v.rule;
    }
    mode.addEventListener("change", function () {
      if (mode.value === "every" && parseInt(num.value, 10) < 2) num.value = "2";
      upd();
    });
    num.addEventListener("input", upd);
    upd();
    return { mode: mode, num: num, hint: hint, read: read };
  }

  function itemDialog(id) {
    var trip = curTrip(), p = trip && findIn(trip.pack, id);
    if (!p) return;
    var dlg = makeDialog("tr-item");
    dlg.appendChild(el("div", "dlg-title", t("dlg.editItem")));
    var form = el("form");
    form.method = "dialog";
    var fName = input("text", LEN.item, p.name);
    var q = qtyControls(p.qty, p.rule, tripDays(trip));
    var fGrp = el("select");
    fGrp.id = "tf-" + (++fieldSeq);
    grpOptions(fGrp, trip, p.grp, true);
    var fNew = input("text", LEN.grp, "");
    var newWrap = field(t("f.grpName"), fNew);
    newWrap.hidden = true;
    fGrp.addEventListener("change", function () { newWrap.hidden = fGrp.value !== "+"; if (!newWrap.hidden) fNew.focus(); });
    var people = trip.people.slice();
    if (p.who && people.indexOf(p.who) < 0) people.push(p.who);
    var fWho = select([["", t("f.anyone")]].concat(people.map(function (x) { return [x, x]; })), p.who);
    var fNote = input("text", LEN.note, p.note);
    form.appendChild(field(t("f.item"), fName));
    form.appendChild(row(field(t("f.qtyMode"), q.mode), field(t("f.qty"), q.num, "narrow")));
    form.appendChild(q.hint);
    if (!datesKnown(trip)) form.appendChild(el("p", "hint", t("rule.nodate", { n: tripDays(trip) })));
    form.appendChild(field(t("f.grp"), fGrp));
    form.appendChild(newWrap);
    if (people.length) form.appendChild(field(t("f.who"), fWho));
    form.appendChild(field(t("f.note"), fNote));
    var del = button(t("dlg.delete"), "danger", function () { dlg.close(); deleteItem(trip.id, "pack", id, "toast.itemDel"); });
    form.appendChild(actions(dlg, t("dlg.save"), del));
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = line(fName.value, LEN.item);
      if (!name) { showToast(t("toast.needName")); fName.focus(); return; }
      var grp = fGrp.value === "+" ? normGrp(fNew.value) : normGrp(fGrp.value);
      var tr = curTrip(), x = tr && findIn(tr.pack, id);
      dlg.close();
      if (!x) return;
      var v = q.read();
      setField(x, "name", name);
      setField(x, "qty", v.qty);
      setField(x, "rule", v.rule);
      setField(x, "grp", grp);
      setField(x, "who", line(fWho.value, LEN.person));
      setField(x, "note", line(fNote.value, LEN.note));
      commit();
    });
    dlg.appendChild(form);
    show(dlg, null);
  }

  function dayControl(trip, value, emptyLabel) {
    var days = tripDayList(trip);
    if (!days.length) return input("date", 0, value);
    var opts = [["", emptyLabel]];
    days.forEach(function (d, i) { opts.push([d, fmtDay(d) + " · " + t("plan.dayN", { n: i + 1 })]); });
    if (value && days.indexOf(value) < 0) opts.push([value, fmtDate(value)]);
    return select(opts, value || "");
  }

  function planDialog(id, day) {
    var trip = curTrip();
    if (!trip) return;
    var p = id ? findIn(trip.plan, id) : null;
    if (id && !p) return;
    if (!p && trip.plan.length >= MAX_PLAN) { showToast(t("toast.max", { n: MAX_PLAN })); return; }
    var v = p || { kind: "activity", title: "", day: day || "", t1: "", day2: "", t2: "", place: "", from: "", to: "", ref: "", note: "",
                   num: "", prov: "", cost: 0, ccur: "", geo: null, geo0: null };
    var entId = p ? p.id : newId();          // known up front: attachments are written while the editor is open
    var dlg = makeDialog("tr-plan");
    dlg.appendChild(el("div", "dlg-title", t(p ? "dlg.editPlan" : "dlg.newPlan")));
    var form = el("form");
    form.method = "dialog";
    var fKind = select(KINDS.map(function (k) { return [k, t("kind." + k)]; }), v.kind);
    var fTitle = input("text", LEN.title, v.title);
    var fFrom = input("text", LEN.stop, v.from), fTo = input("text", LEN.stop, v.to);
    var fDay = dayControl(trip, v.day, t("f.noday"));
    var fT1 = input("time", 0, v.t1), fT2 = input("time", 0, v.t2);
    var fDay2 = dayControl(trip, v.day2, t("f.sameDay"));
    var fPlace = input("text", LEN.place, v.place);
    var fNum = input("text", LEN.num, v.num), fProv = input("text", LEN.prov, v.prov);
    var fRef = input("text", LEN.ref, v.ref);
    var fCost = input("text", 14, centsTxt(v.cost));
    fCost.inputMode = "decimal";
    var fCcur = curSelect(v.ccur || tripCur(trip));
    var fNote = el("textarea");
    fNote.id = "tf-" + (++fieldSeq);
    fNote.maxLength = LEN.pnote;
    fNote.rows = 3;
    fNote.value = v.note;
    var wTitle = field(t("f.title"), fTitle), wFromTo = row(field(t("f.from"), fFrom), field(t("f.to"), fTo));
    var wDay = field(t("f.day"), fDay), wT1 = field(t("f.time"), fT1, "narrow");
    var wDay2 = field(t("f.arrDay"), fDay2), wT2 = field(t("f.ends"), fT2, "narrow");
    var wPlace = field(t("f.place"), fPlace);
    var wNum = field(t("f.num"), fNum), wProv = field(t("f.prov"), fProv);
    form.appendChild(field(t("f.kind"), fKind));
    form.appendChild(wFromTo);
    form.appendChild(wTitle);
    form.appendChild(row(wProv, wNum));
    form.appendChild(row(wDay, wT1));
    form.appendChild(row(wDay2, wT2));
    form.appendChild(wPlace);
    // The saved map point(s): kept while the place text stays the same.
    var geoGone = false, wGeo = null;
    if (v.geo || v.geo0) {
      wGeo = el("div", "geo-row");
      var gp = v.geo || v.geo0;
      wGeo.appendChild(el("span", "hint", t("f.geo") + ": " + gp.lat.toFixed(4) + ", " + gp.lon.toFixed(4)));
      wGeo.appendChild(wxBtn(t("geo.clear"), "link-btn", function () { geoGone = true; wGeo.hidden = true; }));
      form.appendChild(wGeo);
    }
    form.appendChild(field(t("f.ref"), fRef));
    form.appendChild(row(field(t("f.cost"), fCost), field(t("f.ccur"), fCcur, "narrow")));
    form.appendChild(field(t("f.pnote"), fNote));
    var box = attachBox(dlg, trip, entId, null);
    if (box.wrap) form.appendChild(box.wrap);
    function lab(w, key) { w.querySelector("label").textContent = t(key); }
    function layout() {
      var k = fKind.value, move = !!MOVES[k], stay = k === "stay", rent = k === "rental";
      wFromTo.hidden = !move;
      wPlace.hidden = move;
      wDay2.hidden = !(move || stay || rent);
      wNum.hidden = !(move && k !== "car");
      wProv.hidden = !(move || stay || rent || k === "ticket");
      lab(wTitle, stay ? "f.titleStay" : "f.title");
      lab(wDay, stay ? "f.in" : (rent ? "f.pick" : "f.day"));
      lab(wT1, stay ? "f.inTime" : (rent ? "f.pickTime" : (move ? "f.dep" : "f.time")));
      lab(wDay2, stay ? "f.out" : (rent ? "f.retDay" : "f.arrDay"));
      lab(wT2, stay ? "f.outTime" : (rent ? "f.retTime" : (move ? "f.arr" : "f.ends")));
      lab(wPlace, rent ? "f.pickPlace" : "f.place");
      if (fDay2.tagName === "SELECT") fDay2.options[0].textContent = stay || rent ? t("f.noday") : t("f.sameDay");
    }
    fKind.addEventListener("change", layout);
    layout();
    var del = p ? button(t("dlg.delete"), "danger", function () { box.keep(); dlg.close(); deleteItem(trip.id, "plan", id, "toast.planDel"); }) : null;
    form.appendChild(actions(dlg, t(p ? "dlg.save" : "dlg.add"), del));
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var k = fKind.value, move = !!MOVES[k];
      var cost = parseCents(fCost.value);
      if (cost < 0) { showToast(t("toast.amt")); fCost.focus(); return; }
      var vals = {
        kind: k, title: line(fTitle.value, LEN.title), day: normDate(fDay.value), t1: normHm(fT1.value),
        day2: wDay2.hidden ? v.day2 : normDate(fDay2.value), t2: normHm(fT2.value),
        place: wPlace.hidden ? v.place : line(fPlace.value, LEN.place),
        from: move ? line(fFrom.value, LEN.stop) : v.from, to: move ? line(fTo.value, LEN.stop) : v.to,
        ref: line(fRef.value, LEN.ref), note: text(fNote.value, LEN.pnote),
        num: wNum.hidden ? v.num : line(fNum.value, LEN.num), prov: wProv.hidden ? v.prov : line(fProv.value, LEN.prov),
        cost: cost, ccur: cost ? normCur(fCcur.value) : ""
      };
      if (vals.ccur === tripCur(trip) && !trip.cur) vals.ccur = "";
      if (!vals.title && !(move && (vals.from || vals.to)) && !vals.place) { showToast(t("toast.needName")); fTitle.focus(); return; }
      // A point follows its text: a new place (or a new kind) forgets it.
      var q0 = MOVES[v.kind] ? v.to : (v.place || v.title), q1 = move ? vals.to : (vals.place || vals.title);
      vals.geo = geoGone || q0 !== q1 || !!MOVES[v.kind] !== move ? null : v.geo;
      vals.geo0 = geoGone || !move || v.from !== vals.from || !MOVES[v.kind] ? null : v.geo0;
      box.keep();
      var tr = curTrip();
      dlg.close();
      if (!tr) return;
      if (!p) {
        vals.pos = nextPos(tr, vals.day);
        tr.plan.push(newEntry(vals, entId));
      } else {
        var x = findIn(tr.plan, id);
        if (!x) return;
        Object.keys(vals).forEach(function (key) { setField(x, key, NORM.plan[key](vals[key])); });
      }
      box.commit(tr);
      commit();
    });
    dlg.appendChild(form);
    show(dlg, p ? null : fTitle);
  }

  function applyTplDialog() {
    var trip = curTrip();
    if (!trip) return;
    var dlg = makeDialog("tr-apply");
    dlg.appendChild(el("div", "dlg-title", t("dlg.applyTpl")));
    var form = el("form");
    form.method = "dialog";
    form.appendChild(el("p", "hint", t("dlg.applyHint")));
    var checks = tplChecks([]);
    form.appendChild(checks.box);
    form.appendChild(actions(dlg, t("dlg.add")));
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var picked = checks.picked();
      if (!picked.length) { showToast(t("toast.pickTpl")); return; }
      var tr = curTrip();
      dlg.close();
      if (!tr) return;
      var add = missingFrom(tr, combineTpls(picked, tripDays(tr)));
      if (!add.length) { showToast(t("toast.addedNone")); return; }
      var n = addPackItems(tr, add);
      commit();
      showToast(t("toast.added", { n: n }));
    });
    dlg.appendChild(form);
    show(dlg, null);
  }

  function dupDialog(tripId) {
    var trip = findTrip(tripId);
    if (!trip) return;
    if (data.trips.length >= MAX_TRIPS) { showToast(t("toast.max", { n: MAX_TRIPS })); return; }
    var dlg = makeDialog("tr-dup");
    dlg.appendChild(el("div", "dlg-title", t("dlg.dup")));
    var form = el("form");
    form.method = "dialog";
    form.appendChild(el("p", "hint", t("dlg.dupHint")));
    var fName = input("text", LEN.name, line(t("copy.suffix", { name: trip.name }), LEN.name));
    var fStart = input("date", 0, trip.start);
    form.appendChild(field(t("f.name"), fName));
    form.appendChild(field(t("f.newStart"), fStart));
    form.appendChild(actions(dlg, t("dlg.create")));
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = line(fName.value, LEN.name);
      if (!name) { showToast(t("toast.needName")); fName.focus(); return; }
      var src = findTrip(tripId);
      dlg.close();
      if (!src) return;
      var start = normDate(fStart.value);
      var shift = start && isYmd(src.start) ? dayDiff(src.start, start) : 0;
      function mv(d) { return isYmd(d) && shift ? addDays(d, shift) : d; }
      var nt = newTrip({ name: name, dest: src.dest, start: start || src.start,
                         end: start && !isYmd(src.start) ? start : mv(src.end), people: src.people, notes: src.notes });
      src.pack.forEach(function (p) {
        nt.pack.push(newItem({ name: p.name, qty: p.qty, rule: p.rule, grp: p.grp, who: p.who, note: p.note, done: false }));
      });
      src.plan.forEach(function (p) {
        var c = {};
        PLAN_F.forEach(function (k) { c[k] = p[k]; });
        c.day = mv(p.day);
        c.day2 = mv(p.day2);
        nt.plan.push(newEntry(c));
      });
      recountQty(nt);
      data.trips.push(nt);
      commit(true);
      openTrip(nt.id);
    });
    dlg.appendChild(form);
    show(dlg, fName);
  }

  function saveTplDialog(tripId) {
    var trip = findTrip(tripId);
    if (!trip) return;
    if (!trip.pack.length) { showToast(t("toast.tplEmpty")); return; }
    if (data.tpls.length >= MAX_TPLS) { showToast(t("toast.max", { n: MAX_TPLS })); return; }
    var dlg = makeDialog("tr-savetpl");
    dlg.appendChild(el("div", "dlg-title", t("dlg.saveTpl")));
    var form = el("form");
    form.method = "dialog";
    var fName = input("text", LEN.tpl, line(trip.name, LEN.tpl));
    form.appendChild(field(t("f.name"), fName));
    form.appendChild(el("p", "hint", itemsText(Math.min(trip.pack.length, MAX_TPL_ITEMS))));
    form.appendChild(actions(dlg, t("dlg.save")));
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = line(fName.value, LEN.tpl);
      if (!name) { showToast(t("toast.needName")); fName.focus(); return; }
      var tr = findTrip(tripId);
      dlg.close();
      if (!tr) return;
      var items = packGroups(tr.pack).reduce(function (acc, g) { return acc.concat(g.items); }, []).map(function (p) {
        return { name: p.name, grp: p.grp, qty: p.qty, rule: p.rule };
      });
      data.tpls.push({ id: newId(), m: Date.now(), name: name, items: normTplItems(items) });
      commit();
      showToast(t("toast.tplSaved"));
    });
    dlg.appendChild(form);
    show(dlg, fName);
  }

  // Fuel cost by car. Vehicles, average consumption (full to full)
  // and the last price paid come from the Garage log, read-only
  // through garage/core.js (same math as the Garage app); everything
  // stays editable and works without Garage too. Nothing is stored
  // unless "Add to notes" is pressed.
  function garageCars() {
    var G = window.OrosGarageCore, out = { cars: [], cur: "EUR" };
    if (!G) return out;
    try {
      var raw = JSON.parse(localStorage.getItem("oros-garage-data") || "null");
      if (!raw || !Array.isArray(raw.vehicles)) return out;
      var d = G.merge(raw, raw, Date.now());
      out.cur = d.settings && d.settings.cur ? d.settings.cur : "EUR";
      d.vehicles.forEach(function (v) {
        if (v.arch || !G.hasFuel(v)) return;
        var e = G.energies(v)[0], last = null;
        d.fuel.forEach(function (x) {
          if (x.v !== v.id || x.e !== e || !(x.q > 0) || !(x.c > 0)) return;
          if (!last || x.d > last.d || (x.d === last.d && x.km > last.km)) last = x;
        });
        out.cars.push({ id: v.id, name: v.name, e: e, per100: G.consumption(d, v.id, e).avg,
                        price: last ? last.c / 100 / (last.q / 1000) : null });
      });
    } catch (e) {}
    return out;
  }
  function money(v, cur) {
    try { return new Intl.NumberFormat(locale(), { style: "currency", currency: cur }).format(v); }
    catch (e) { return v.toFixed(2) + " " + cur; }
  }
  function decTxt(v, digits) {
    return v === null || v === undefined || !isFinite(v) ? "" :
      new Intl.NumberFormat(locale(), { maximumFractionDigits: digits, useGrouping: false }).format(v);
  }
  function fuelDialog(tripId) {
    var trip = findTrip(tripId);
    if (!trip) return;
    var g = garageCars();
    var dlg = makeDialog("tr-fuel");
    dlg.appendChild(el("div", "dlg-title", t("fuel.title")));
    var form = el("form");
    form.method = "dialog";
    var opts = g.cars.map(function (c) { return [c.id, c.name]; }).concat([["", t("fuel.manual")]]);
    var fCar = select(opts, g.cars.length ? g.cars[0].id : "");
    var fKm = input("text", 8, "");
    fKm.inputMode = "decimal";
    var fRound = el("input");
    fRound.type = "checkbox";
    fRound.id = "tf-" + (++fieldSeq);
    fRound.checked = true;
    var fPer = input("text", 6, ""), fPrice = input("text", 8, "");
    fPer.inputMode = fPrice.inputMode = "decimal";
    var lPer = el("label", "dlg-lbl"), lPrice = el("label", "dlg-lbl");
    var hint = el("p", "hint"), res = el("p", "fuel-res");
    res.setAttribute("aria-live", "polite");
    function car() {
      for (var i = 0; i < g.cars.length; i++) if (g.cars[i].id === fCar.value) return g.cars[i];
      return null;
    }
    function energy() { var c = car(); return c ? c.e : "f"; }
    function fill() {
      var c = car(), e = energy();
      lPer.textContent = t("fuel.per100." + e);
      lPrice.textContent = t("fuel.price." + e);
      fPer.value = c && c.per100 ? decTxt(c.per100, 1) : "";
      fPrice.value = c && c.price ? decTxt(c.price, 3) : "";
      hint.textContent = t(c ? "fuel.fromGarage" : "fuel.noGarage");
      calc();
    }
    function result() {
      return fuelCost(parseDec(fKm.value), fRound.checked, parseDec(fPer.value), parseDec(fPrice.value), trip.people.length);
    }
    function calc() {
      var r = result(), e = energy();
      if (!r) { res.textContent = ""; return; }
      var txt = t("fuel.result", { dist: r.dist, units: t("unit." + e, { n: decTxt(r.units, 1) }), cost: money(r.cost, g.cur) });
      if (r.each !== null) txt += " · " + t("fuel.each", { cost: money(r.each, g.cur), n: trip.people.length });
      res.textContent = txt;
    }
    if (g.cars.length) form.appendChild(field(t("fuel.car"), fCar));
    form.appendChild(field(t("fuel.km"), fKm));
    var rw = el("label", "chk-row");
    rw.appendChild(fRound);
    rw.appendChild(el("span", "", t("fuel.round")));
    form.appendChild(rw);
    var wPer = el("div", "fld"), wPrice = el("div", "fld");
    lPer.setAttribute("for", fPer.id); lPrice.setAttribute("for", fPrice.id);
    wPer.appendChild(lPer); wPer.appendChild(fPer);
    wPrice.appendChild(lPrice); wPrice.appendChild(fPrice);
    form.appendChild(row(wPer, wPrice));
    form.appendChild(hint);
    form.appendChild(res);
    form.appendChild(actions(dlg, t("fuel.save")));
    fCar.addEventListener("change", fill);
    [fKm, fPer, fPrice].forEach(function (x) { x.addEventListener("input", calc); });
    fRound.addEventListener("change", calc);
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var r = result();
      if (!r) { showToast(t("fuel.need")); (fKm.value ? fPer : fKm).focus(); return; }
      var c = car(), tr = findTrip(tripId);
      var ln = t("fuel.line", { car: c ? c.name : t("kind.car"), dist: r.dist,
        units: t("unit." + energy(), { n: decTxt(r.units, 1) }), cost: money(r.cost, g.cur) });
      dlg.close();
      if (!tr) return;
      commitNotes();
      setField(tr, "notes", text(tr.notes ? tr.notes.replace(/\s+$/, "") + "\n" + ln : ln, LEN.notes));
      commit();
      showToast(t("fuel.saved"));
    });
    dlg.appendChild(form);
    fill();
    show(dlg, fKm);
  }

  // Template editor: a ready template saved here becomes the user's
  // (stored under the same id); "Hide" / "Delete" leave a tombstone.
  function tplDialog(tp) {
    if (!tp && data.tpls.length >= MAX_TPLS) { showToast(t("toast.max", { n: MAX_TPLS })); return; }
    var dlg = makeDialog("tr-tpl", true);
    dlg.appendChild(el("div", "dlg-title", t(tp ? "dlg.editTpl" : "dlg.newTpl")));
    var form = el("form");
    form.method = "dialog";
    var fName = input("text", LEN.tpl, tp ? tp.name : "");
    form.appendChild(field(t("f.name"), fName));
    if (tp && tp.kind !== "mine") form.appendChild(el("p", "hint", t("tpl.hint")));
    var list = el("ol", "trows");
    form.appendChild(list);
    var rows = [];
    function renumber() {
      rows.forEach(function (r, i) {
        r.name.setAttribute("aria-label", t("tpl.row", { n: i + 1 }));
        r.del.setAttribute("aria-label", t("tpl.del", { n: i + 1 }));
        r.del.title = t("tpl.del", { n: i + 1 });
      });
    }
    function addRow(it) {
      if (rows.length >= MAX_TPL_ITEMS) { showToast(t("toast.max", { n: MAX_TPL_ITEMS })); return null; }
      var li = el("li", "trow");
      var r = { li: li };
      r.name = input("text", LEN.item, it ? it.name : "", t("f.item"));
      r.grp = el("select");
      grpOptions(r.grp, null, it ? it.grp : "@misc", false);
      r.grp.setAttribute("aria-label", t("f.grp"));
      r.mode = select([["fix", t("rule.fix")], ["day", t("rule.day")], ["every", t("rule.every")]], it && it.rule ? it.rule.m : "fix");
      r.mode.setAttribute("aria-label", t("f.qtyMode"));
      r.num = input("number", 0, String(it ? (it.rule ? it.rule.n : it.qty) : 1));
      r.num.min = 1;
      r.num.max = MAX_QTY;
      r.num.setAttribute("aria-label", t("f.qty"));
      r.del = iconBtn("mini danger", UI.x, "", function () {
        rows.splice(rows.indexOf(r), 1);
        li.remove();
        renumber();
      });
      li.appendChild(r.name);
      li.appendChild(r.del);
      li.appendChild(r.grp);
      li.appendChild(r.mode);
      li.appendChild(r.num);
      list.appendChild(li);
      rows.push(r);
      renumber();
      return r;
    }
    (tp ? tp.items : [null]).forEach(addRow);
    var add = button(t("tpl.add"), "", function () {
      var last = rows[rows.length - 1];
      var r = addRow(last ? { name: "", grp: last.grp.value, qty: 1, rule: null } : null);
      if (r) r.name.focus();
    });
    add.classList.add("add-row-btn");
    form.appendChild(add);
    var left = null;
    if (tp) {
      left = button(t(tp.kind === "mine" ? "dlg.delete" : "dlg.hide"), "danger", function () { dlg.close(); removeTpl(tp.id); });
    }
    form.appendChild(actions(dlg, t("dlg.save"), left));
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = line(fName.value, LEN.tpl);
      if (!name) { showToast(t("toast.needName")); fName.focus(); return; }
      var items = normTplItems(rows.map(function (r) {
        var n = parseInt(r.num.value, 10), m = r.mode.value;
        return { name: r.name.value, grp: r.grp.value, qty: n, rule: m === "fix" ? null : { m: m, n: n } };
      }));
      if (!items.length) { showToast(t("toast.tplEmpty")); return; }
      dlg.close();
      var id = tp ? tp.id : newId(), old = null;
      data.tpls.forEach(function (x) { if (x.id === id) old = x; });
      var m = Math.max(Date.now(), old ? old.m + 1 : 0, (data.tombs[id] || 0) + 1);
      data.tpls = data.tpls.filter(function (x) { return x.id !== id; });
      data.tpls.push({ id: id, m: m, name: name, items: items });
      commit();
      showToast(t("toast.tplSaved"));
    });
    dlg.appendChild(form);
    show(dlg, tp ? null : fName);
  }

  function removeTpl(id) {
    var old = null;
    data.tpls.forEach(function (x) { if (x.id === id) old = x; });
    var seed = SEED_IDS.indexOf(id) >= 0;
    data.tombs[id] = Math.max(Date.now(), old ? old.m : 0, (data.tombs[id] || 0) + 1);
    data.tpls = data.tpls.filter(function (x) { return x.id !== id; });
    commit();
    undoToast(t(seed ? "toast.tplHid" : "toast.tplDel"), function () {
      var back = old ? clone(old) : { id: id, m: 0, seed: 1 };
      back.m = Math.max(Date.now(), (data.tombs[id] || 0) + 1);
      data.tpls = data.tpls.filter(function (x) { return x.id !== id; });
      data.tpls.push(back);
      commit();
    });
  }

  // ---------- 7b. Wave 31: files, bookings, import, map, budget, journal ----------

  // ----- Files on the orOS disk (attachments, journal photos) -----
  // A doc = { id, of, file, name, f } in trip.docs; the bytes live in
  // /internal/Travel/<id>.<jpg|pdf> (Files; Vault Drive syncs them). A
  // PDF must start with "%PDF-"; a photo is re-drawn on a canvas (long
  // side ≤ 1600 px, JPEG): no EXIF / location, no foreign bytes.
  var FILE_MAX_IN = 20 * 1024 * 1024;
  function fsApi() {
    try {
      var f = window.parent && window.parent !== window ? window.parent.orosFS : null;
      return f && typeof f.writeBlob === "function" && typeof f.readBlob === "function" && typeof f.rm === "function" ? f : null;
    } catch (e) { return null; }
  }
  function filePath(name) { return typeof name === "string" && FILE_RE.test(name) ? FILE_DIR + "/" + name : null; }
  function isPdfFile(f) { return f.type === "application/pdf" || /\.pdf$/i.test(f.name || ""); }
  function pdfMagic(file) {
    var head = file.slice(0, 5);
    var read = typeof head.arrayBuffer === "function" ? head.arrayBuffer() : new Response(head).arrayBuffer();
    return Promise.resolve(read).then(function (buf) {
      var b = new Uint8Array(buf);
      return b.length === 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d;
    }).catch(function () { return false; });
  }
  function reencodePhoto(file) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h) { URL.revokeObjectURL(url); resolve(null); return; }
        var k = Math.min(1, 1600 / Math.max(w, h));
        var cv = document.createElement("canvas");
        cv.width = Math.max(1, Math.round(w * k));
        cv.height = Math.max(1, Math.round(h * k));
        var g = cv.getContext("2d");
        g.fillStyle = "#fff";
        g.fillRect(0, 0, cv.width, cv.height);
        g.drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        cv.toBlob(function (b) { resolve(b && b.size ? b : null); }, "image/jpeg", 0.82);
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }
  // → Promise<{ id, file, name } | "big" | "bad">, the file already written.
  function storeFile(file, photosOnly) {
    var fs = fsApi();
    if (!fs || !file) return Promise.reject(new Error("nodisk"));
    if (file.size > FILE_MAX_IN) return Promise.resolve("big");
    var pdf = isPdfFile(file);
    if (pdf && photosOnly) return Promise.resolve("bad");
    var enc = pdf ? pdfMagic(file).then(function (ok) { return ok ? { blob: file.slice(0, file.size, "application/pdf"), ext: "pdf" } : null; })
                  : reencodePhoto(file).then(function (b) { return b ? { blob: b, ext: "jpg" } : null; });
    return enc.then(function (r) {
      if (!r) return "bad";
      var id = newId(), name = id + "." + r.ext;
      var label = line(String(file.name || "").replace(/\.[a-z0-9]{1,5}$/i, ""), LEN.fname - 4) || id;
      return Promise.resolve(fs.writeBlob(FILE_DIR + "/" + name, r.blob)).then(function () {
        return { id: id, file: name, name: line(label + "." + r.ext, LEN.fname) };
      });
    });
  }
  function rmFile(name) {
    var fs = fsApi(), path = filePath(name);
    if (!fs || !path) return Promise.resolve();
    return Promise.resolve(fs.rm(path)).catch(function () {});
  }
  function filesInUse() {
    var used = {};
    data.trips.forEach(function (tr) { tr.docs.forEach(function (x) { if (x.file) used[x.file] = 1; }); });
    return used;
  }
  // After the Undo window, files no live doc points at leave the disk.
  function dropFilesLater(names) {
    names = (names || []).filter(Boolean);
    if (!names.length || !fsApi()) return;
    setTimeout(function () {
      var used = filesInUse();
      names.forEach(function (n) { if (!used[n]) rmFile(n); });
    }, 12000);
  }
  function docsOf(trip, owner) {
    return trip.docs.filter(function (x) { return x.of === owner && x.file; })
      .sort(function (a, b) { return cmpStr(a.name, b.name) || cmpStr(a.id, b.id); });
  }
  function openBlobUrl(u) {
    var a = document.createElement("a");
    a.href = u;
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  // One attachment: picture, Open (PDF), Save a copy, Remove.
  function fileViewer(doc, onRemove) {
    var fs = fsApi();
    var v = makeDialog("tr-view");
    v.appendChild(el("div", "dlg-title", doc.name || t("at.title")));
    var box = el("div", "at-view");
    v.appendChild(box);
    var u = null, blobNow = null, pdf = /\.pdf$/.test(doc.file);
    var acts = el("div", "dlg-actions");
    var openB = pdf ? button(t("at.open"), "", function () { if (u) openBlobUrl(u); }) : null;
    var saveB = button(t("at.save"), "", function () {
      if (blobNow) downloadBlob(blobNow, doc.name || doc.file, pdf ? "application/pdf" : "image/jpeg",
        [{ description: pdf ? "PDF" : "JPEG", accept: pdf ? { "application/pdf": [".pdf"] } : { "image/jpeg": [".jpg"] } }]);
    });
    if (openB) { openB.disabled = true; acts.appendChild(openB); }
    saveB.disabled = true;
    acts.appendChild(saveB);
    if (onRemove) {
      acts.appendChild(el("span", "spacer"));
      acts.appendChild(button(t("at.remove"), "danger", function () { v.close(); onRemove(); }));
    }
    acts.appendChild(button(t("at.close"), "primary", function () { v.close(); }));
    if (fs) Promise.resolve(fs.readBlob(filePath(doc.file))).then(function (blob) {
      if (!blob) throw new Error("ENOENT");
      blobNow = pdf ? blob.slice(0, blob.size, "application/pdf") : blob;
      u = URL.createObjectURL(blobNow);
      if (pdf) box.appendChild(el("div", "at-pdf big", t("at.pdf")));
      else { var im = el("img"); im.alt = doc.name || ""; im.src = u; box.appendChild(im); }
      if (openB) openB.disabled = false;
      saveB.disabled = false;
    }).catch(function () { box.appendChild(el("p", "hint", t("at.missingLong"))); });
    else box.appendChild(el("p", "hint", t("at.missingLong")));
    v.appendChild(el("p", "hint", t("at.where")));
    v.appendChild(acts);
    v.addEventListener("close", function () { if (u) { var x = u; setTimeout(function () { URL.revokeObjectURL(x); }, 60000); } });
    document.body.appendChild(v);
    v.showModal();
  }
  // A thumbnail button: the photo, or a "PDF" tile.
  function thumbInto(b, doc, urls) {
    var fs = fsApi();
    if (/\.pdf$/.test(doc.file)) { b.appendChild(el("span", "at-pdf", t("at.pdf"))); return; }
    if (!fs) { b.appendChild(el("span", "at-miss", t("at.missing"))); return; }
    Promise.resolve(fs.readBlob(filePath(doc.file))).then(function (blob) {
      if (!blob) throw new Error("ENOENT");
      var u = URL.createObjectURL(blob);
      urls.push(u);
      var im = el("img");
      im.alt = "";
      im.src = u;
      b.appendChild(im);
    }).catch(function () { b.appendChild(el("span", "at-miss", t("at.missing"))); });
  }
  // The attachments field of an editor (entry or journal day). Files
  // picked while it is open are written at once and removed again if
  // the editor is left without saving; the docs are created on save.
  function attachBox(dlg, trip, owner, opts) {
    opts = opts || {};
    var fs = fsApi();
    var cur = docsOf(trip, owner).map(function (x) { return { id: x.id, file: x.file, name: x.name, live: 1 }; });
    var added = [], removed = [], urls = [], done = false;
    var wrap = el("div", "fld");
    if (!fs && !cur.length) return { wrap: null, keep: function () { done = true; }, commit: function () {}, count: function () { return 0; } };
    wrap.appendChild(el("div", "dlg-lbl", opts.label || t("at.title")));
    var grid = el("div", "at-grid");
    wrap.appendChild(grid);
    var max = opts.max || MAX_DOCS_PER;
    function paint() {
      urls.forEach(function (u) { URL.revokeObjectURL(u); });
      urls = [];
      grid.innerHTML = "";
      cur.forEach(function (d, i) {
        var b = el("button", "at-th");
        b.type = "button";
        b.setAttribute("aria-label", (d.name || t("at.item", { n: i + 1 })));
        b.title = d.name || "";
        b.addEventListener("click", function () {
          fileViewer(d, function () {
            cur = cur.filter(function (x) { return x !== d; });
            if (d.live) removed.push(d);
            else { added = added.filter(function (x) { return x !== d; }); rmFile(d.file); }
            paint();
          });
        });
        thumbInto(b, d, urls);
        grid.appendChild(b);
      });
      if (fs && cur.length < max) {
        var add = el("button", "at-th at-add");
        add.type = "button";
        add.innerHTML = UI.plus;
        add.setAttribute("aria-label", opts.add || t("at.add"));
        add.title = opts.add || t("at.add");
        add.addEventListener("click", pick);
        grid.appendChild(add);
      }
    }
    function pick() {
      var host = dialogHost();
      var accept = opts.photos ? "image/*" : "application/pdf,.pdf,image/*";
      var p = host && typeof host.openFiles === "function" ? host.openFiles(accept)
        : (host && typeof host.openFile === "function" ? host.openFile(accept) : localPickFile(accept));
      Promise.resolve(p).then(function (files) {
        files = !files ? [] : (Array.isArray(files) ? files : [files]);
        files = files.slice(0, Math.max(0, max - cur.length));
        var bad = 0;
        return files.reduce(function (chain, file) {
          return chain.then(function () {
            return storeFile(file, opts.photos).then(function (r) {
              if (r === "big") { showToast(t("at.big")); return; }
              if (r === "bad" || !r) { bad++; return; }
              if (done) { rmFile(r.file); return; }
              added.push(r);
              cur.push(r);
              paint();
            });
          });
        }, Promise.resolve()).then(function () {
          if (bad) showToast(opts.photos ? t("jr.photoBad") : t("at.bad"));
        });
      }).catch(function () { showToast(t("at.noDisk")); });
    }
    dlg.addEventListener("close", function () {
      urls.forEach(function (u) { URL.revokeObjectURL(u); });
      if (!done) { done = true; added.forEach(function (d) { rmFile(d.file); }); }
    });
    paint();
    return {
      wrap: wrap,
      count: function () { return cur.length; },
      keep: function () { done = true; },
      // after a save: new docs in, removed ones tombstoned (files leave later)
      commit: function (tr) {
        var now = Date.now();
        added.forEach(function (d) {
          if (tr.docs.length >= MAX_DOCS) { rmFile(d.file); return; }
          var x = newEnt(DOC_F, NORM.docs, { of: owner, file: d.file, name: d.name });
          x.id = d.id;
          tr.docs.push(x);
        });
        removed.forEach(function (d) {
          var x = findIn(tr.docs, d.id);
          if (x) data.tombs[d.id] = Math.max(now, life(x));
        });
        dropFilesLater(removed.map(function (d) { return d.file; }));
      }
    };
  }

  // ----- Import a booking (schema.org Reservation in an e-mail) -----
  var scriptsLoading = {};
  function loadScript(src) {
    if (scriptsLoading[src]) return scriptsLoading[src];
    scriptsLoading[src] = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      s.onload = function () { resolve(); };
      s.onerror = function () { delete scriptsLoading[src]; reject(new Error("load")); };
      document.head.appendChild(s);
    });
    return scriptsLoading[src];
  }
  function booking() { return window.OrosTravelBooking || null; }
  // .eml → its HTML (or text) with Mail's MIME decoder (mail/mime.js,
  // pure, loaded on first use); .html / .txt are read as they are.
  function readMailFile(file) {
    if (!file) return Promise.resolve(null);
    if (file.size > 10 * 1024 * 1024) return Promise.reject(new Error("big"));
    var eml = /\.(eml|msg|mht|mhtml)$/i.test(file.name || "") || /message\/rfc822/i.test(file.type || "");
    if (!eml) return file.text();
    return Promise.all([file.arrayBuffer(), loadScript("../mail/mime.js?v=" + APP_V)]).then(function (r) {
      var bytes = new Uint8Array(r[0]), bin = "";
      for (var i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
      var M = window.orosMailMime;
      if (!M || typeof M.parseMessage !== "function") throw new Error("mime");
      var msg = M.parseMessage(bin);
      return msg.html !== null && msg.html !== undefined ? msg.html : (msg.text || "");
    });
  }
  function parseBookings(html) {
    var B = booking();
    if (!B) return [];
    try { return B.parseHtml(String(html || ""), LANG); } catch (e) { return []; }
  }
  function sameBooking(p, r) {
    if (p.kind !== r.kind) return false;
    if (r.ref && p.ref && p.ref.toLowerCase() === r.ref.toLowerCase() && p.day === r.day) return true;
    return !!r.day && p.day === r.day && p.t1 === r.t1 && (p.num || "").replace(/\s+/g, "").toLowerCase() === r.num.replace(/\s+/g, "").toLowerCase() &&
      (p.from || "") === r.from && (p.title || "") === (r.title || p.title || "");
  }
  // The trip a booking most likely belongs to: one whose dates hold its day.
  function tripFor(found) {
    var day = "";
    found.forEach(function (r) { if (r.day && (!day || r.day < day)) day = r.day; });
    var hit = null;
    if (day) data.trips.forEach(function (tr) { if (!hit && datesKnown(tr) && tr.start <= day && day <= tr.end) hit = tr; });
    if (!hit && prefs.view === "trip" && curTrip()) hit = curTrip();
    return hit;
  }
  function importStart(tripId) {
    var dlg = makeDialog("tr-imp", true);
    dlg.appendChild(el("div", "dlg-title", t("imp.title")));
    var form = el("form");
    form.method = "dialog";
    form.appendChild(el("p", "hint", t("imp.hint")));
    var fileB = button(t("imp.file"), "", function () {
      var host = dialogHost();
      var accept = ".eml,.html,.htm,.txt,.json,message/rfc822,text/html";
      var p = host && typeof host.openFile === "function" ? host.openFile(accept) : localPickFile(accept);
      Promise.resolve(p).then(readMailFile).then(function (txt) {
        if (txt === null || txt === undefined) return;
        dlg.close();
        importResults(parseBookings(txt), { trip: tripId });
      }).catch(function () { showToast(t("imp.bad")); });
    });
    fileB.classList.add("wide-btn");
    form.appendChild(fileB);
    var ta = el("textarea");
    ta.id = "tf-" + (++fieldSeq);
    ta.rows = 5;
    ta.maxLength = 2000000;
    ta.spellcheck = false;
    form.appendChild(field(t("imp.paste"), ta));
    form.appendChild(actions(dlg, t("imp.read")));
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!ta.value.trim()) { ta.focus(); return; }
      var found = parseBookings(ta.value);
      dlg.close();
      importResults(found, { trip: tripId });
    });
    dlg.appendChild(form);
    show(dlg, null);
  }
  // From Mail (Other apps › Travel): { html, text, subject } (≤ 1 MB).
  function importFromMail(m) {
    if (!m || typeof m !== "object") return;
    var html = typeof m.html === "string" ? m.html.slice(0, 2000000) : "";
    var found = html ? parseBookings(html) : [];
    if (!found.length && typeof m.text === "string" && booking()) {
      try { found = booking().parseText(m.text.slice(0, 2000000), LANG); } catch (e) { found = []; }
    }
    importResults(found, { subject: line(m.subject, 120) });
  }
  function importResults(found, opts) {
    if (!found.length) { showToast(t("imp.none")); return; }
    var dlg = makeDialog("tr-impres", true);
    dlg.appendChild(el("div", "dlg-title", t("imp.title")));
    var form = el("form");
    form.method = "dialog";
    if (opts.subject) form.appendChild(el("p", "hint imp-subj", t("imp.mail", { subj: opts.subject })));
    form.appendChild(el("p", "dlg-text", found.length === 1 ? t("imp.found1") : t("imp.found", { n: found.length })));
    var guess = (opts.trip && findTrip(opts.trip)) || tripFor(found);
    var list = data.trips.slice().sort(function (a, b) { return cmpStr(b.start || "0", a.start || "0") || cmpStr(a.id, b.id); });
    var fTrip = select([["", t("imp.newTrip")]].concat(list.map(function (tr) {
      return [tr.id, tr.name + (fmtRange(tr) ? " · " + fmtRange(tr) : "")];
    })), guess ? guess.id : "");
    form.appendChild(field(t("imp.trip"), fTrip));
    var ul = el("ul", "imp-list"), rows = [];
    function paint() {
      ul.innerHTML = "";
      rows = [];
      var tr = findTrip(fTrip.value);
      found.forEach(function (r) {
        var have = tr ? tr.plan.some(function (p) { return sameBooking(p, r); }) : false;
        var li = el("li", "imp-row");
        var lab = el("label", "imp-lab");
        var cb = el("input");
        cb.type = "checkbox";
        cb.checked = !have && !r.cancelled;
        lab.appendChild(cb);
        var ic = el("span", "er-ic");
        ic.innerHTML = UI.kind[r.kind] || UI.kind.other;
        lab.appendChild(ic);
        var tx = el("span", "er-txt");
        tx.appendChild(el("span", "er-title", entryTitle(r)));
        var sub = [r.day ? fmtDay(r.day) + (r.t1 ? " " + r.t1 : "") : t("f.noday"), [r.prov, r.num].filter(Boolean).join(" "),
                   r.ref ? "#" + r.ref : "", r.cost ? fmtMoney(r.cost, r.ccur || "EUR") : ""].filter(Boolean);
        tx.appendChild(el("span", "er-sub", sub.join(" · ")));
        var flags = [];
        if (have) flags.push(t("imp.have"));
        if (r.cancelled) flags.push(t("imp.cancel"));
        if (tr && datesKnown(tr) && r.day && (r.day < tr.start || r.day > tr.end)) flags.push(t("imp.outside"));
        if (flags.length) tx.appendChild(el("span", "er-sub imp-flag", flags.join(" · ")));
        lab.appendChild(tx);
        li.appendChild(lab);
        ul.appendChild(li);
        rows.push({ cb: cb, r: r });
      });
      okBtn();
    }
    form.appendChild(ul);
    var acts = actions(dlg, t("imp.add", { n: 0 }));
    var ok = acts.querySelector('button[type="submit"]');
    function okBtn() { ok.textContent = t("imp.add", { n: rows.filter(function (x) { return x.cb.checked; }).length }); }
    ul.addEventListener("change", okBtn);
    fTrip.addEventListener("change", paint);
    form.appendChild(acts);
    paint();
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var picked = rows.filter(function (x) { return x.cb.checked; }).map(function (x) { return x.r; });
      if (!picked.length) { showToast(t("imp.pick")); return; }
      var tr = findTrip(fTrip.value);
      if (!tr) {
        if (data.trips.length >= MAX_TRIPS) { showToast(t("toast.max", { n: MAX_TRIPS })); return; }
        var days = [];
        picked.forEach(function (r) { if (r.day) days.push(r.day); if (r.day2) days.push(r.day2); });
        days.sort(cmpStr);
        var dest = "";
        picked.forEach(function (r) { if (!dest && r.kind === "stay") dest = r.place || r.title; });
        picked.forEach(function (r) { if (!dest && MOVES[r.kind]) dest = r.to; });
        dest = line(dest || picked[0].place || picked[0].title, LEN.dest);
        tr = newTrip({ name: line(dest, LEN.name) || t("imp.title"), dest: dest, start: days[0] || "",
                       end: days[days.length - 1] || "", people: [], notes: "", cur: "", bplan: {}, geo: null });
        data.trips.push(tr);
      }
      var n = 0;
      picked.forEach(function (r) {
        if (tr.plan.length >= MAX_PLAN) return;
        var vals = {};
        PLAN_F.forEach(function (k) { vals[k] = r[k]; });
        vals.pos = nextPos(tr, r.day);
        vals.geo = null;
        vals.geo0 = null;
        tr.plan.push(newEntry(vals));
        n++;
      });
      dlg.close();
      commit(true);
      openTrip(tr.id);
      if (prefs.tab !== "plan" && !isWide()) setTab("plan");
      showToast(t("imp.added", { trip: tr.name, n: n }));
    });
    dlg.appendChild(form);
    show(dlg, null);
  }

  // ----- Map (Leaflet, vendored; OpenStreetMap tiles like Maps) -----
  var DAY_COLORS = ["#e06c75", "#61afef", "#98c379", "#e5c07b", "#c678dd", "#56b6c2", "#d19a66", "#ff7eb6"];
  var lmap = null, lLayer = null, leafletP = null;
  function ensureLeaflet() {
    if (window.L && window.L.map) return Promise.resolve(window.L);
    if (leafletP) return leafletP;
    var css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "../vendor/leaflet.css?v=" + APP_V;
    document.head.appendChild(css);
    leafletP = loadScript("../vendor/leaflet.js?v=" + APP_V).then(function () {
      if (!window.L) throw new Error("leaflet");
      return window.L;
    }, function (e) { leafletP = null; throw e; });
    return leafletP;
  }
  function dayIndex(trip, day) { return tripDayList(trip).indexOf(day); }
  function dayColor(trip, day) { var i = dayIndex(trip, day); return DAY_COLORS[(i < 0 ? 7 : i) % DAY_COLORS.length]; }
  function mapsTracks() {
    var raw = null, out = [];
    try { raw = JSON.parse(localStorage.getItem("oros-maps-tracks-data") || "null"); } catch (e) {}
    if (!raw || typeof raw !== "object" || !raw.tracks || typeof raw.tracks !== "object") return out;
    var tombs = raw.tombs && typeof raw.tombs === "object" ? raw.tombs : {};
    Object.keys(raw.tracks).forEach(function (id) {
      var x = raw.tracks[id];
      if (!x || typeof x !== "object" || !TRK_RE.test(id) || !isInt(x.m)) return;
      if (isInt(tombs[id]) && tombs[id] >= x.m) return;
      out.push({ id: id, name: line(x.name, 120) || id, start: isInt(x.start) ? x.start : 0,
                 dist: typeof x.dist === "number" && isFinite(x.dist) ? x.dist : 0,
                 prev: typeof x.prev === "string" && /^[\x3f-\x7e]*$/.test(x.prev) ? x.prev.slice(0, 8000) : "" });
    });
    return out.sort(function (a, b) { return b.start - a.start || cmpStr(a.id, b.id); });
  }
  function trackById(id) {
    var list = mapsTracks();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function kmText(m) { return decTxt(Math.round(m / 100) / 10, 1) + " km"; }
  function mapDays(trip) {
    var days = tripDayList(trip);
    trip.plan.forEach(function (p) { if (isYmd(p.day) && days.indexOf(p.day) < 0) days.push(p.day); });
    return days.sort(cmpStr);
  }
  function renderMapPane(trip) {
    var days = mapDays(trip);
    if (prefs.mapDay && days.indexOf(prefs.mapDay) < 0) prefs.mapDay = "";
    var chips = $("map-days");
    chips.innerHTML = "";
    [""].concat(days).forEach(function (d) {
      var i = dayIndex(trip, d);
      var b = el("button", "chip" + (prefs.mapDay === d ? " on" : ""),
                 d ? (i >= 0 ? t("map.legend", { n: i + 1 }) : fmtDay(d)) : t("map.all"));
      b.type = "button";
      b.setAttribute("aria-pressed", prefs.mapDay === d ? "true" : "false");
      if (d) { var dot = el("i", "dot"); dot.style.background = dayColor(trip, d); b.insertBefore(dot, b.firstChild); b.title = fmtDay(d); }
      b.addEventListener("click", function () { prefs.mapDay = d; savePrefs(); renderMapPane(trip); });
      chips.appendChild(b);
    });
    var need = needsGeo(trip);
    var fb = $("map-find");
    fb.textContent = t("map.find", { n: need.length });
    fb.disabled = !need.length || geoBusy;
    var pts = dayPoints(trip, prefs.mapDay);
    $("map-gpx").disabled = !pts.length;
    $("map-open").disabled = pts.length < 2 || !fileOpenBridge();
    $("map-open").hidden = !fileOpenBridge();
    var list = $("map-list");
    list.innerHTML = "";
    pts.forEach(function (p, i) {
      var li = el("li", "ml-row");
      var n = el("span", "ml-n", String(i + 1));
      n.style.background = dayColor(trip, p.day);
      li.appendChild(n);
      var b = el("button", "ml-b", p.name);
      b.type = "button";
      b.addEventListener("click", function () { if (lmap) lmap.setView([p.lat, p.lon], Math.max(lmap.getZoom(), 14)); });
      li.appendChild(b);
      if (!prefs.mapDay) li.appendChild(el("span", "ml-d", fmtDay(p.day)));
      list.appendChild(li);
    });
    var msg = $("map-msg");
    if (!geoBusy) {
      msg.textContent = pts.length ? t("map.hint") : (prefs.mapDay ? t("map.noPts") : t("map.empty"));
    }
    ensureLeaflet().then(function (L) { drawMap(L, trip, pts); }, function () { msg.textContent = t("map.fail"); });
  }
  function drawMap(L, trip, pts) {
    var box = $("map-box");
    if (!box || $("p-map").hidden) return;
    if (!lmap) {
      lmap = L.map(box, { zoomControl: true, attributionControl: true, worldCopyJump: true });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19, attribution: "&copy; OpenStreetMap"
      }).addTo(lmap);
      lLayer = L.layerGroup().addTo(lmap);
    }
    lLayer.clearLayers();
    var bounds = [];
    var byDay = {};
    pts.forEach(function (p, i) {
      (byDay[p.day] = byDay[p.day] || []).push([p.lat, p.lon]);
      var color = dayColor(trip, p.day);
      var icon = L.divIcon({ className: "tmk", iconSize: [26, 26], iconAnchor: [13, 13],
        html: '<span style="background:' + color + '">' + (i + 1) + "</span>" });
      var pop = el("div", "tmk-pop");
      pop.appendChild(el("strong", "", p.name));
      pop.appendChild(el("div", "", fmtDay(p.day)));
      L.marker([p.lat, p.lon], { icon: icon, keyboard: true, title: p.name }).bindPopup(pop).addTo(lLayer);
      bounds.push([p.lat, p.lon]);
    });
    Object.keys(byDay).forEach(function (d) {
      if (byDay[d].length > 1) L.polyline(byDay[d], { color: dayColor(trip, d), weight: 3, opacity: 0.85, dashArray: "6 6" }).addTo(lLayer);
    });
    // The journal's tracks from Maps, in the day's colour.
    trip.jrnl.forEach(function (j) {
      if (!j.trk || (prefs.mapDay && j.day !== prefs.mapDay)) return;
      var tk = trackById(j.trk), line2 = tk ? decodePoly(tk.prev) : [];
      if (line2.length < 2) return;
      L.polyline(line2, { color: dayColor(trip, j.day), weight: 4, opacity: 0.9 }).addTo(lLayer);
      line2.forEach(function (q) { bounds.push(q); });
    });
    setTimeout(function () {
      if (!lmap) return;
      lmap.invalidateSize();
      if (bounds.length > 1) lmap.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
      else if (bounds.length === 1) lmap.setView(bounds[0], 14);
      else if (trip.geo) lmap.setView([trip.geo.lat, trip.geo.lon], 11);
      else lmap.setView([38, 15], 3);
    }, 0);
  }
  // Photon (komoot), the geocoder Maps uses. Only on "Find on the map",
  // one place a second; the destination first, as a bias for the rest.
  var geoBusy = false, photonLang = true;
  function photon(q, near) {
    function url(withLang) {
      return "https://photon.komoot.io/api/?limit=1&q=" + encodeURIComponent(q) +
        (near ? "&lat=" + near.lat.toFixed(4) + "&lon=" + near.lon.toFixed(4) : "") + (withLang ? "&lang=" + LANG : "");
    }
    return fetch(url(photonLang)).then(function (r) {
      if (r.status === 400 && photonLang) { photonLang = false; return fetch(url(false)); }
      return r;
    }).then(function (r) { if (!r.ok) throw new Error("http"); return r.json(); }).then(function (j) {
      var f = j && j.features && j.features[0], c = f && f.geometry && f.geometry.coordinates;
      return Array.isArray(c) ? normGeo({ lat: c[1], lon: c[0] }) : null;
    });
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function findOnMap(tripId) {
    if (geoBusy) return;
    if (!navigator.onLine || typeof fetch !== "function") { showToast(t("map.offline")); return; }
    var trip = findTrip(tripId);
    if (!trip) return;
    var jobs = needsGeo(trip).slice(0, 60), found = 0, miss = [];
    if (!jobs.length) return;
    geoBusy = true;
    var msg = $("map-msg");
    function progress(i) { if (msg && prefs.trip === tripId) msg.textContent = t("map.finding", { i: i, n: jobs.length }); }
    var chain = Promise.resolve();
    if (!trip.geo && trip.dest) {
      chain = photon(trip.dest, null).then(function (g) {
        var tr = findTrip(tripId);
        if (g && tr) setField(tr, "geo", g);
      }).catch(function () {}).then(function () { return wait(1000); });
    }
    jobs.forEach(function (job, i) {
      chain = chain.then(function () {
        var tr = findTrip(tripId);
        if (!tr) throw new Error("gone");
        progress(i + 1);
        return photon(geoQuery(job.q, job.kind), MOVES[job.kind] ? null : tr.geo).then(function (g) {
          var tr2 = findTrip(tripId), p = tr2 && findIn(tr2.plan, job.id);
          if (g && p) { setField(p, job.which, g); found++; } else miss.push(job.q);
        }, function () { miss.push(job.q); }).then(function () { return i < jobs.length - 1 ? wait(1000) : null; });
      });
    });
    chain.catch(function () {}).then(function () {
      geoBusy = false;
      if (findTrip(tripId)) commit(prefs.view === "trip" && prefs.trip === tripId && !!document.querySelector("dialog[open]"));
      showToast(t("map.found", { n: found, m: jobs.length }));
      if (miss.length && msg && prefs.trip === tripId) msg.textContent = t("map.nf", { list: miss.slice(0, 8).join(", ") });
    });
  }
  function fileOpenBridge() {
    try {
      var fo = window.parent !== window ? window.parent.orosFileOpen : null;
      return fo && typeof fo.open === "function" ? fo : null;
    } catch (e) { return null; }
  }
  // "Save to Maps as a track": the GPX goes through the shell's file
  // hand-over (fileopen.js, the "Open with" path): Maps imports it into
  // My tracks and shows it. Nothing else is written.
  function sendToMaps(tripId) {
    var trip = findTrip(tripId), fo = fileOpenBridge();
    if (!trip || !fo) return;
    if (dayPoints(trip, prefs.mapDay).length < 2) { showToast(t("map.need2")); return; }
    var gpx = tripGpx(trip, prefs.mapDay);
    var name = fileBase(trip.name) + (prefs.mapDay ? "-" + prefs.mapDay : "") + ".gpx";
    try {
      // The File is made in the shell's realm: this frame is unloaded
      // when Maps opens, and a Blob from a gone frame cannot be read.
      var PF = window.parent.File || File;
      fo.open([new PF([gpx], name, { type: "application/gpx+xml" })]);
      showToast(t("map.sent"));
    } catch (e) {}
  }
  function exportGpx(tripId, day) {
    var trip = findTrip(tripId);
    if (!trip) return;
    var gpx = tripGpx(trip, day || "");
    if (!gpx) { showToast(t("map.noPts")); return; }
    downloadBlob(new Blob([gpx], { type: "application/gpx+xml" }), fileBase(trip.name) + (day ? "-" + day : "") + ".gpx",
      "application/gpx+xml", [{ description: "GPX", accept: { "application/gpx+xml": [".gpx"] } }]);
  }

  // ----- Budget -----
  function curSelect(value) {
    return select(CURRENCIES.map(function (c) { return [c, c]; }), value || "EUR");
  }
  function renderBudget(trip) {
    var host = $("bud-box");
    host.innerHTML = "";
    var b = budget(trip);
    var tools = el("div", "tools");
    var cs = curSelect(b.cur);
    cs.className = "chip-sel";
    cs.setAttribute("aria-label", t("bud.cur"));
    cs.title = t("bud.cur");
    cs.addEventListener("change", function () {
      var tr = curTrip();
      if (tr && setField(tr, "cur", normCur(cs.value))) commit();
    });
    tools.appendChild(cs);
    tools.appendChild(wxBtn(t("bud.set"), "txt-btn small", function () { budgetDialog(trip.id); }));
    var addB = el("button", "txt-btn small primary");
    addB.type = "button";
    addB.innerHTML = UI.plus + "<span>" + t("bud.add") + "</span>";
    addB.addEventListener("click", function () { expDialog(null); });
    tools.appendChild(addB);
    tools.appendChild(el("span", "spacer"));
    if (splitBridge()) {
      var sb = wxBtn(t("bud.split"), "link-btn", function () { sendToSplit(trip.id); });
      sb.title = t("bud.splitHint");
      tools.appendChild(sb);
    }
    host.appendChild(tools);
    var table = el("div", "bud-table");
    b.rows.forEach(function (r) {
      if (!r.plan && !r.spent) return;
      table.appendChild(budRow(t("cat." + r.cat), r.plan, r.spent, b.cur, false));
    });
    if (b.total.plan || b.total.spent) table.appendChild(budRow(t("bud.total"), b.total.plan, b.total.spent, b.cur, true));
    host.appendChild(table);
    if (b.other.length) {
      host.appendChild(el("p", "hint", t("bud.other", { list: b.other.map(function (o) { return fmtMoney(o.amt, o.cur); }).join(", ") })));
    }
    if (trip.people.length > 1 && b.total.spent) {
      host.appendChild(el("p", "hint", t("bud.each", { v: fmtMoney(Math.round(b.total.spent / trip.people.length), b.cur), n: trip.people.length })));
    }
    var h = el("h3", "bud-h", t("bud.list"));
    host.appendChild(h);
    var rows = [];
    trip.spend.forEach(function (x) { rows.push({ day: x.day, x: x }); });
    trip.plan.forEach(function (p) { if (p.cost) rows.push({ day: p.day, p: p }); });
    rows.sort(function (a, c) { return cmpStr(c.day || "", a.day || "") || cmpStr((a.x || a.p).id, (c.x || c.p).id); });
    if (!rows.length) { host.appendChild(el("p", "hint", t("bud.none"))); return; }
    var ul = el("ul", "elist");
    rows.forEach(function (r) {
      var li = el("li", "er");
      var bt = el("button", "er-body");
      bt.type = "button";
      var ic = el("span", "er-ic");
      ic.innerHTML = r.p ? (UI.kind[r.p.kind] || UI.kind.other) : UI.coin;
      bt.appendChild(ic);
      var tx = el("span", "er-txt");
      tx.appendChild(el("span", "er-title", r.p ? entryTitle(r.p) : (r.x.what || t("cat." + r.x.cat))));
      var sub = [r.day ? fmtDay(r.day) : "", r.p ? t("bud.booking") : t("cat." + r.x.cat), r.x && r.x.who ? r.x.who : ""].filter(Boolean);
      tx.appendChild(el("span", "er-sub", sub.join(" · ")));
      bt.appendChild(tx);
      bt.appendChild(el("span", "er-amt", r.p ? fmtMoney(r.p.cost, r.p.ccur || b.cur) : fmtMoney(r.x.amt, r.x.cur || b.cur)));
      bt.addEventListener("click", function () { if (r.p) planDialog(r.p.id); else expDialog(r.x.id); });
      li.appendChild(bt);
      ul.appendChild(li);
    });
    host.appendChild(ul);
  }
  function budRow(name, plan, spent, cur, total) {
    var row = el("div", "bud-row" + (total ? " total" : ""));
    var top = el("div", "bud-top");
    top.appendChild(el("span", "bud-name", name));
    top.appendChild(el("span", "bud-nums", fmtMoney(spent, cur) + (plan ? " / " + fmtMoney(plan, cur) : "")));
    row.appendChild(top);
    if (plan) {
      var prog = el("div", "prog" + (spent > plan ? " over" : ""));
      var fill = el("i");
      fill.style.width = Math.min(100, Math.round(100 * spent / plan)) + "%";
      prog.appendChild(fill);
      row.appendChild(prog);
      row.appendChild(el("div", "bud-left" + (spent > plan ? " over" : ""),
        spent > plan ? t("bud.over", { v: fmtMoney(spent - plan, cur) }) : t("bud.left", { v: fmtMoney(plan - spent, cur) })));
    }
    return row;
  }
  function centsTxt(c) { return c ? decTxt(c / 100, 2) : ""; }
  function budgetDialog(tripId) {
    var trip = findTrip(tripId);
    if (!trip) return;
    var dlg = makeDialog("tr-bud");
    dlg.appendChild(el("div", "dlg-title", t("dlg.budget")));
    var form = el("form");
    form.method = "dialog";
    form.appendChild(el("p", "hint", t("bud.hint", { cur: tripCur(trip) })));
    var ins = {};
    BUD_CATS.forEach(function (c) {
      var i = input("text", 14, centsTxt(trip.bplan[c] || 0));
      i.inputMode = "decimal";
      ins[c] = i;
      form.appendChild(field(t("cat." + c), i));
    });
    form.appendChild(actions(dlg, t("dlg.save")));
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var out = {};
      for (var k = 0; k < BUD_CATS.length; k++) {
        var c = BUD_CATS[k], v = parseCents(ins[c].value);
        if (v < 0) { showToast(t("toast.amt")); ins[c].focus(); return; }
        if (v) out[c] = v;
      }
      var tr = findTrip(tripId);
      dlg.close();
      if (tr && setField(tr, "bplan", normBplan(out))) commit();
    });
    dlg.appendChild(form);
    show(dlg, ins.transport);
  }
  function expDialog(id) {
    var trip = curTrip();
    if (!trip) return;
    var x = id ? findIn(trip.spend, id) : null;
    if (id && !x) return;
    if (!x && trip.spend.length >= MAX_SPEND) { showToast(t("toast.max", { n: MAX_SPEND })); return; }
    var today = todayYmd();
    var v = x || { what: "", amt: 0, cur: "", cat: "food", day: tripDayList(trip).indexOf(today) >= 0 ? today : "", who: "" };
    var dlg = makeDialog("tr-exp");
    dlg.appendChild(el("div", "dlg-title", t(x ? "dlg.expense" : "dlg.newExp")));
    var form = el("form");
    form.method = "dialog";
    var fWhat = input("text", LEN.what, v.what);
    var fAmt = input("text", 14, centsTxt(v.amt));
    fAmt.inputMode = "decimal";
    var fCur = curSelect(v.cur || tripCur(trip));
    var fCat = select(BUD_CATS.map(function (c) { return [c, t("cat." + c)]; }), v.cat);
    var fDay = dayControl(trip, v.day, t("f.noday"));
    var people = trip.people.slice();
    if (v.who && people.indexOf(v.who) < 0) people.push(v.who);
    var fWho = select([["", t("f.nobody")]].concat(people.map(function (p) { return [p, p]; })), v.who);
    form.appendChild(field(t("f.what"), fWhat));
    form.appendChild(row(field(t("f.amt"), fAmt), field(t("f.ccur"), fCur, "narrow")));
    form.appendChild(field(t("f.cat"), fCat));
    form.appendChild(field(t("f.day"), fDay));
    if (people.length) form.appendChild(field(t("f.paid"), fWho));
    var del = x ? button(t("dlg.delete"), "danger", function () { dlg.close(); deleteItem(trip.id, "spend", id, "toast.expDel"); }) : null;
    form.appendChild(actions(dlg, t(x ? "dlg.save" : "dlg.add"), del));
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var amt = parseCents(fAmt.value);
      if (amt <= 0) { showToast(t("toast.amt")); fAmt.focus(); return; }
      var vals = { what: line(fWhat.value, LEN.what), amt: amt, cur: normCur(fCur.value), cat: fCat.value,
                   day: normDate(fDay.value), who: line(fWho.value, LEN.person) };
      if (vals.cur === tripCur(trip) && !trip.cur) vals.cur = "";
      var tr = curTrip();
      dlg.close();
      if (!tr) return;
      if (!x) tr.spend.push(newEnt(SPEND_F, NORM.spend, vals));
      else {
        var y = findIn(tr.spend, id);
        if (!y) return;
        Object.keys(vals).forEach(function (k) { setField(y, k, NORM.spend[k](vals[k])); });
      }
      commit();
    });
    dlg.appendChild(form);
    show(dlg, x ? null : fWhat);
  }
  // BR-SPLIT-NEW (owner Split): a prefilled "new group" (name, currency,
  // travellers). Split writes nothing until the person presses Save.
  function openAtBridge() {
    try { return window.parent !== window && typeof window.parent.__orosOpenAt === "function"; } catch (e) { return false; }
  }
  // Installed in this orOS? (the shell's list; unknown → assume yes, as Mail does)
  function appThere(id) {
    try {
      var f = window.parent.orosAssistInstalled;
      if (typeof f !== "function") return true;
      return f().some(function (a) { return a && a.id === id; });
    } catch (e) { return true; }
  }
  function splitBridge() { return openAtBridge() && appThere("split"); }
  function sendToSplit(tripId) {
    var trip = findTrip(tripId);
    if (!trip || !splitBridge()) return;
    try { window.parent.__orosOpenAt("split", splitTarget(trip)); } catch (e) {}
  }

  // ----- Journal -----
  var jrUrls = [];
  function jrnlOf(trip, day) {
    var id = jrnlId(trip.id, day), hit = findIn(trip.jrnl, id);
    if (hit) return hit;
    for (var i = 0; i < trip.jrnl.length; i++) if (trip.jrnl[i].day === day) return trip.jrnl[i];
    return null;
  }
  function renderJournal(trip) {
    jrUrls.forEach(function (u) { URL.revokeObjectURL(u); });
    jrUrls = [];
    var host = $("jr-list");
    host.innerHTML = "";
    var days = tripDayList(trip);
    var eb = $("jr-empty");
    eb.classList.toggle("on", !!prefs.jempty);
    eb.setAttribute("aria-pressed", prefs.jempty ? "true" : "false");
    eb.hidden = !days.length;
    if (!days.length) { host.appendChild(el("p", "hint center", t("jr.nodates"))); return; }
    var today = todayYmd(), shown = 0;
    var secs = {};
    planSections(trip).forEach(function (s) { if (s.day) secs[s.day] = s.items; });
    days.forEach(function (d, i) {
      var j = jrnlOf(trip, d);
      var owner = j ? j.id : jrnlId(trip.id, d);
      var photos = docsOf(trip, owner);
      var tk = j && j.trk ? trackById(j.trk) : null;
      var has = !!(j && (j.text.trim() || j.trk || photos.length));
      if (prefs.jempty && !has) return;
      shown++;
      var card = el("section", "jday" + (has ? "" : " jday-empty") + (d === today ? " today" : ""));
      var dot = el("i", "jdot");
      dot.style.background = dayColor(trip, d);
      card.appendChild(dot);
      var h = el("div", "jday-h");
      h.appendChild(el("h3", "", fmtDay(d) + " · " + t("plan.dayN", { n: i + 1 })));
      var eb2 = el("button", "txt-btn small", t(has ? "jr.edit" : "jr.write"));
      eb2.type = "button";
      eb2.addEventListener("click", function () { journalDialog(trip.id, d); });
      h.appendChild(eb2);
      card.appendChild(h);
      var plan = (secs[d] || []).slice(0, 5).map(function (p) { return entryTitle(p); });
      if (plan.length) card.appendChild(el("div", "jplan", t("jr.plan") + ": " + plan.join(" · ")));
      if (j && j.text.trim()) card.appendChild(el("p", "jtext", j.text.trim()));
      if (photos.length) {
        var grid = el("div", "at-grid jphotos");
        photos.forEach(function (doc, k) {
          var b = el("button", "at-th");
          b.type = "button";
          b.setAttribute("aria-label", t("jr.photoN", { n: k + 1 }));
          b.addEventListener("click", function () { fileViewer(doc, null); });
          thumbInto(b, doc, jrUrls);
          grid.appendChild(b);
        });
        card.appendChild(grid);
      }
      if (j && j.trk) card.appendChild(trackBlock(trip, d, j.trk, tk));
      if (!has) card.appendChild(el("p", "hint jnone", t("jr.empty")));
      host.appendChild(card);
    });
    if (!shown) host.appendChild(el("p", "hint center", t("jr.empty")));
  }
  function trackBlock(trip, day, id, tk) {
    var box = el("div", "jtrk");
    if (!tk) { box.appendChild(el("span", "hint", t("jr.trackGone"))); return box; }
    var path = sketchPath(decodePoly(tk.prev), 96, 64);
    if (path) {
      var sv = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      sv.setAttribute("viewBox", "0 0 96 64");
      sv.setAttribute("class", "jsk");
      sv.setAttribute("aria-hidden", "true");
      var pe = document.createElementNS("http://www.w3.org/2000/svg", "path");
      pe.setAttribute("d", path);
      pe.setAttribute("stroke", dayColor(trip, day));
      sv.appendChild(pe);
      box.appendChild(sv);
    }
    var tx = el("span", "er-txt");
    tx.appendChild(el("span", "er-title", tk.name));
    if (tk.dist) tx.appendChild(el("span", "er-sub", kmText(tk.dist)));
    box.appendChild(tx);
    if (openAtBridge() && appThere("maps")) box.appendChild(wxBtn(t("jr.showTrack"), "link-btn", function () {
      try { window.parent.__orosOpenAt("maps", { track: id }); } catch (e) {}
    }));
    return box;
  }
  function journalDialog(tripId, day) {
    var trip = findTrip(tripId);
    if (!trip || !isYmd(day)) return;
    var j = jrnlOf(trip, day);
    var owner = j ? j.id : jrnlId(trip.id, day);
    var dlg = makeDialog("tr-jr", true);
    dlg.appendChild(el("div", "dlg-title", t("jr.title", { day: fmtDay(day) })));
    var form = el("form");
    form.method = "dialog";
    var ta = el("textarea");
    ta.id = "tf-" + (++fieldSeq);
    ta.rows = 7;
    ta.maxLength = LEN.jtext;
    ta.value = j ? j.text : "";
    ta.placeholder = t("jr.text");
    form.appendChild(field(t("jr.text"), ta));
    var box = attachBox(dlg, trip, owner, { photos: true, max: 24, label: t("jr.photos"), add: t("jr.addPhoto") });
    if (box.wrap) form.appendChild(box.wrap);
    var tracks = mapsTracks();
    var cur = j ? j.trk : "";
    var dayTracks = tracks.filter(function (x) { return x.start && ymd(new Date(x.start)) === day; });
    var rest = tracks.filter(function (x) { return dayTracks.indexOf(x) < 0; }).slice(0, 60);
    var opts = [["", t("jr.noTrack")]];
    dayTracks.concat(rest).forEach(function (x) {
      opts.push([x.id, x.name + (x.start ? " · " + fmtDate(ymd(new Date(x.start))) : "") + (x.dist ? " · " + kmText(x.dist) : "")]);
    });
    if (cur && !trackById(cur)) opts.push([cur, t("jr.trackGone")]);
    var fTrk = select(opts, cur);
    form.appendChild(field(t("jr.track"), fTrk));
    if (!tracks.length) form.appendChild(el("p", "hint", t("jr.noTracks")));
    var del = j ? button(t("jr.clear"), "danger", function () { box.keep(); dlg.close(); deleteItem(tripId, "jrnl", j.id, "toast.jrDel"); }) : null;
    form.appendChild(actions(dlg, t("dlg.save"), del));
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      box.keep();
      dlg.close();
      var tr = findTrip(tripId);
      if (!tr) return;
      var vals = { day: day, text: text(ta.value, LEN.jtext), trk: NORM.jrnl.trk(fTrk.value) };
      var x = jrnlOf(tr, day);
      if (!x) {
        if (!vals.text.trim() && !vals.trk && !box.count()) { box.commit(tr); return; }
        x = newEnt(JRNL_F, NORM.jrnl, vals);
        x.id = owner;
        if (data.tombs[owner] !== undefined) {           // a day cleared before: write over its tombstone
          JRNL_F.forEach(function (k) { x.f[k] = Math.max(x.f[k], data.tombs[owner] + 1); });
        }
        tr.jrnl.push(x);
      } else {
        JRNL_F.forEach(function (k) { setField(x, k, vals[k]); });
      }
      box.commit(tr);
      commit();
    });
    dlg.appendChild(form);
    show(dlg, null);
  }

  // ---------- 8. Menus, export / import, share, print ----------
  var menuEl = null;
  function closeMenu() {
    if (!menuEl) return;
    var m = menuEl;
    menuEl = null;
    m.cleanup();
    m.remove();
  }
  function openMenu(btn, items) {
    if (menuEl) { closeMenu(); return; }
    var m = el("div", "menu");
    m.setAttribute("role", "menu");
    items.forEach(function (it) {
      if (!it) return;
      var b = el("button", "menu-it" + (it.danger ? " danger" : ""), it.label);
      b.type = "button";
      b.setAttribute("role", "menuitem");
      b.addEventListener("click", function () { closeMenu(); it.fn(); });
      m.appendChild(b);
    });
    document.body.appendChild(m);
    var r = btn.getBoundingClientRect();
    m.style.top = Math.round(r.bottom + 6) + "px";
    m.style.right = Math.max(8, Math.round(window.innerWidth - r.right)) + "px";
    function onDown(e) { if (!m.contains(e.target) && !btn.contains(e.target)) closeMenu(); }
    function onKey(e) {
      if (e.key === "Escape") { e.stopPropagation(); closeMenu(); btn.focus(); }
    }
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", closeMenu);
    m.cleanup = function () {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", closeMenu);
    };
    menuEl = m;
    btn.setAttribute("aria-expanded", "true");
    var first = m.querySelector("button");
    if (first) first.focus();
  }
  function moreMenu() {
    var btn = $("more-btn");
    btn.setAttribute("aria-expanded", "false");
    if (prefs.view === "trip") {
      var id = prefs.trip;
      openMenu(btn, [
        { label: t("menu.edit"), fn: function () { tripDialog(id); } },
        { label: t(shareOnMobile() ? "menu.share" : "menu.text"), fn: function () { shareTrip(id); } },
        { label: t("menu.ics"), fn: function () { exportIcs(id); } },
        { label: t("menu.fuel"), fn: function () { fuelDialog(id); } },
        { label: t("menu.gpx"), fn: function () { exportGpx(id, ""); } },
        splitBridge() ? { label: t("menu.split"), fn: function () { sendToSplit(id); } } : null,
        todoItems(id, true).length ? { label: t("menu.todoBefore"), fn: function () { sendToTodo(id, true); } } : null,
        todoItems(id, false).length ? { label: t("menu.todoPack"), fn: function () { sendToTodo(id, false); } } : null,
        { label: t("menu.print"), fn: function () { printTrip(id); } },
        { label: t("menu.dup"), fn: function () { dupDialog(id); } },
        { label: t("menu.tpl"), fn: function () { saveTplDialog(id); } },
        { label: t("menu.del"), danger: true, fn: function () { deleteTrip(id); } }
      ]);
    } else {
      openMenu(btn, [
        { label: t("menu.export"), fn: exportAll },
        { label: t("menu.import"), fn: importFlow },
        window.OrosTravelImport ? { label: t("menu.importOther"), fn: importOther } : null,
        { label: t(prefs.rem ? "menu.remOff" : "menu.remOn"), fn: function () {
          prefs.rem = prefs.rem ? 0 : 1;
          savePrefsNow();
          showToast(t(prefs.rem ? "toast.remOn" : "toast.remOff"));
        } }
      ]);
    }
  }

  // BR-TD-ADD (owner To-Do): the open "Before I leave" items, or
  // what is still to pack, become a prefilled new To-Do list. To-Do
  // writes only after the user presses Add; Travel never touches its
  // data, and nothing here changes (a copy, not a live link).
  function todoBridge() {
    try { return typeof window.parent.__orosOpenAt === "function" && window.parent !== window; } catch (e) { return false; }
  }
  function todoItems(tripId, before) {
    var trip = findTrip(tripId);
    if (!trip || !todoBridge()) return [];
    return packGroups(trip.pack).reduce(function (acc, g) { return acc.concat(g.items); }, []).filter(function (p) {
      return !p.done && (p.grp === "@before") === before;
    }).slice(0, 200).map(function (p) {
      var it = { text: p.qty > 1 ? t("todo.qty", { n: p.qty, name: p.name }) : p.name };
      var note = [p.who, p.note].filter(Boolean).join(" · ");
      if (note) it.note = note;
      return it;
    });
  }
  function sendToTodo(tripId, before) {
    var trip = findTrip(tripId), items = todoItems(tripId, before);
    if (!trip || !items.length) return;
    try {
      window.parent.__orosOpenAt("todo", { addItems: {
        newList: line(t(before ? "todo.before" : "todo.pack", { trip: trip.name || trip.dest }), 60),
        from: t("app"), items: items } });
    } catch (e) {}
  }

  // R33: every file goes through orosDialog (local fallback when standalone).
  function dialogHost() {
    try { return window.orosDialog || (window.parent && window.parent.orosDialog) || null; }
    catch (e) { return window.orosDialog || null; }
  }
  function downloadBlob(blob, fileName, mime, types) {
    var dlg = dialogHost();
    if (dlg && typeof dlg.saveFile === "function") {
      dlg.saveFile({ blob: blob, filename: fileName, mime: mime, types: types })
        .then(function (r) { if (r && r.ok) showToast(t("toast.exported")); });
      return;                         // cancel (ok=false) = silent exit
    }
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
    showToast(t("toast.exported"));
  }
  function localPickFile(accept) {
    return new Promise(function (resolve) {
      var inp = document.createElement("input");
      inp.type = "file";
      if (accept) inp.accept = accept;
      inp.style.display = "none";
      inp.addEventListener("change", function () {
        var f = inp.files && inp.files[0] ? inp.files[0] : null;
        inp.remove();
        resolve(f);
      });
      inp.addEventListener("cancel", function () { inp.remove(); resolve(null); });
      document.body.appendChild(inp);
      inp.click();
    });
  }
  function fileBase(name) {
    var s = String(name || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9Ͱ-Ͽ]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
    return s || "trip";
  }

  function exportAll() {
    commitNotes();
    var payload = { app: "oros-travel", ver: DATA_VER, exported: new Date().toISOString(), data: mergeTravel(data, data) };
    downloadBlob(new Blob([JSON.stringify(payload, null, 1)], { type: "application/json" }),
      "orOS-travel-" + todayYmd() + ".json", "application/json",
      [{ description: "JSON", accept: { "application/json": [".json"] } }]);
  }
  function exportIcs(id) {
    commitNotes();
    var trip = findTrip(id);
    if (!trip) return;
    downloadBlob(new Blob([tripIcs(trip, Date.now())], { type: "text/calendar" }), fileBase(trip.name) + ".ics",
      "text/calendar", [{ description: "iCalendar", accept: { "text/calendar": [".ics"] } }]);
  }

  // Import = merge through the sync merge (never an overwrite).
  function importFlow() {
    var dlgHost = dialogHost();
    var pick = dlgHost && typeof dlgHost.openFile === "function"
      ? dlgHost.openFile(".json,application/json") : localPickFile(".json,application/json");
    Promise.resolve(pick).then(function (file) {
      if (!file) return null;
      if (file.size > 5 * 1024 * 1024) { showToast(t("toast.importBad")); return null; }
      return file.text();
    }).then(function (txt) {
      if (txt === null || txt === undefined) return;
      var obj = null;
      try { obj = JSON.parse(txt); } catch (e) {}
      var payload = obj && obj.app === "oros-travel" ? obj.data : obj;
      if (!payload || typeof payload !== "object" || !(Array.isArray(payload.trips) || Array.isArray(payload.tpls))) {
        showToast(t("toast.importBad"));
        return;
      }
      var clean = mergeTravel(payload, payload);
      var nTrips = clean.trips.length, nTpls = clean.tpls.filter(function (x) { return !x.seed; }).length;
      if (!nTrips && !nTpls) { showToast(t("toast.importBad")); return; }
      confirmImport(clean, nTrips, nTpls);
    }).catch(function () { showToast(t("toast.importBad")); });
  }
  function confirmImport(clean, nTrips, nTpls) {
    var dlg = makeDialog("tr-import");
    dlg.appendChild(el("div", "dlg-title", t("dlg.import")));
    var form = el("form");
    form.method = "dialog";
    form.appendChild(el("p", "dlg-text", t("import.found", { trips: nTrips, tpls: nTpls })));
    form.appendChild(actions(dlg, t("dlg.import")));
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      dlg.close();
      commitNotes();
      data = mergeTravel(data, clean);
      commit();
      showToast(t("toast.imported", { trips: nTrips, tpls: nTpls }));
    });
    dlg.appendChild(form);
    show(dlg, null);
  }

  // ----- Trips from other apps (import.js: Polarsteps, TripIt) -----
  // File → OrosTravelImport.read (pure) → preview with a checkbox per
  // trip (what is new, what is already here, what is left out) → ONE
  // commit (one write, one dirty mark) → a toast with Undo. Undo writes
  // tombstones newer than what the import made, so other devices drop
  // it too. Ids are stable ("imp-…"): a second import adds only what is
  // missing, and nothing of an existing trip is changed.
  var IMPX_SRC = { polarsteps: "Polarsteps", tripit: "TripIt" };
  function importOther() {
    var X = window.OrosTravelImport, K = window.OrosImportKit;
    if (!X || !K) return;
    var host = dialogHost();
    var pick = host && typeof host.openFile === "function" ? host.openFile(X.ACCEPT) : localPickFile(X.ACCEPT);
    Promise.resolve(pick).then(function (file) {
      if (!file) return null;
      return K.readFile(file, X.MAX_FILE).then(function (r) { return X.read(r.name, r.bytes); }).then(function (res) {
        if (!res || !res.trips.length) { showToast(t("impx.none")); return; }
        importOtherPreview(res);
      });
    }).catch(function (e) { showToast(t(e && e.message === "toobig" ? "impx.big" : "impx.none")); });
  }
  function importOtherPreview(res) {
    commitNotes();
    var plans = window.OrosTravelImport.plan(data, res);
    var dlg = makeDialog("tr-impx", true);
    dlg.appendChild(el("div", "dlg-title", t("impx.title", { s: IMPX_SRC[res.source] || "" })));
    var form = el("form");
    form.method = "dialog";
    form.appendChild(el("p", "hint", t(res.source === "polarsteps" ? "impx.hintPs" : "impx.hintTi")));
    var ul = el("ul", "imp-list"), rows = [];
    plans.forEach(function (p) {
      var tr = p.trip, li = el("li", "imp-row"), lab = el("label", "imp-lab"), cb = el("input");
      cb.type = "checkbox";
      cb.checked = !p.cur || p.add.length > 0 || p.jrnl.length > 0;
      lab.appendChild(cb);
      var tx = el("span", "er-txt");
      tx.appendChild(el("span", "er-title", tr.name));
      tx.appendChild(el("span", "er-sub", [fmtRange(tr), tr.dest].filter(Boolean).join(" · ")));
      var bits = [t("impx.row", { n: p.add.length, j: p.jrnl.length })];
      if (p.cur) bits.push(t("impx.have", { n: p.have }));
      if (p.over) bits.push(t("impx.over", { n: p.over }));
      tx.appendChild(el("span", "er-sub", bits.join(" · ")));
      lab.appendChild(tx);
      li.appendChild(lab);
      ul.appendChild(li);
      rows.push({ cb: cb, p: p });
    });
    form.appendChild(ul);
    var sk = res.skip || {}, left = [];
    if (sk.photos) left.push(t("impx.photos", { n: sk.photos }));
    if (sk.points) left.push(t("impx.points", { n: sk.points }));
    if (sk.outside) left.push(t("impx.outside", { n: sk.outside }));
    if (sk.cancelled) left.push(t("impx.cancelled", { n: sk.cancelled }));
    if (left.length) form.appendChild(el("p", "hint", t("impx.left", { list: left.join(", ") })));
    var acts = actions(dlg, t("impx.do"));
    if (plans.every(function (p) { return p.cur && !p.add.length && !p.jrnl.length; })) {
      form.appendChild(el("p", "dlg-text", t("impx.nothing")));
      acts.querySelector('button[type="submit"]').disabled = true;
    }
    form.appendChild(acts);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var picked = rows.filter(function (x) { return x.cb.checked; }).map(function (x) { return x.p; });
      if (!picked.length) { showToast(t("impx.pick")); return; }
      dlg.close();
      importOtherApply(picked);
    });
    dlg.appendChild(form);
    show(dlg, null);
  }
  function importOtherApply(picked) {
    var undo = { trips: [], ents: [] }, nT = 0, nE = 0, nJ = 0, last = null;
    picked.forEach(function (p) {
      var T = p.trip, tr = findTrip(T.id);
      if (!tr) {
        if (data.trips.length >= MAX_TRIPS) return;
        tr = newTrip({ name: T.name, dest: T.dest, start: T.start, end: T.end, people: [], notes: T.notes,
                       cur: "", bplan: {}, geo: null });
        tr.id = T.id;
        data.trips.push(tr);
        undo.trips.push(tr.id);
        nT++;
      }
      last = tr;
      p.add.forEach(function (x) {
        if (tr.plan.length >= MAX_PLAN || findIn(tr.plan, x.id)) return;
        var vals = {};
        PLAN_F.forEach(function (k) { vals[k] = x[k]; });
        vals.pos = nextPos(tr, x.day);
        vals.geo0 = null;
        tr.plan.push(newEntry(vals, x.id));
        undo.ents.push([tr.id, x.id]);
        nE++;
      });
      p.jrnl.forEach(function (j) {
        if (jrnlOf(tr, j.day)) return;
        var x = newEnt(JRNL_F, NORM.jrnl, { day: j.day, text: j.text, trk: "" });
        x.id = jrnlId(tr.id, j.day);
        tr.jrnl.push(x);
        undo.ents.push([tr.id, x.id]);
        nJ++;
      });
    });
    if (!nT && !nE && !nJ) { showToast(t("impx.nothing")); return; }
    commit(true);
    if (picked.length === 1 && last) openTrip(last.id); else render();
    undoToast(t("impx.done", { t: nT, e: nE, j: nJ }), function () { importOtherUndo(undo); });
  }
  function importOtherUndo(u) {
    var now = Date.now();
    u.ents.forEach(function (pair) {
      var tr = findTrip(pair[0]), x = tr ? (findIn(tr.plan, pair[1]) || findIn(tr.jrnl, pair[1])) : null;
      if (x) data.tombs[pair[1]] = Math.max(now, life(x));
    });
    u.trips.forEach(function (id) {
      var tr = findTrip(id);
      if (tr) data.tombs[id] = Math.max(now, life(tr));
    });
    if (prefs.view === "trip" && u.trips.indexOf(prefs.trip) >= 0) { prefs.view = "list"; savePrefs(); }
    commit();
  }

  // Mobile → share sheet; desktop → clipboard (the Contacts rule).
  function shareOnMobile() {
    if (!navigator.share) return false;
    if (/Windows NT|Macintosh|X11|CrOS/.test(navigator.userAgent)) return false;
    if (navigator.maxTouchPoints === 0 && !/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)) return false;
    return true;
  }
  function legacyCopy(txt) {
    var ta = document.createElement("textarea"), ok = false;
    ta.value = txt;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { ok = document.execCommand("copy"); } catch (e) {}
    document.body.removeChild(ta);
    return ok;
  }
  function shareTrip(id) {
    commitNotes();
    var trip = findTrip(id);
    if (!trip) return;
    var txt = tripText(trip);
    if (shareOnMobile()) {
      navigator.share({ title: trip.name, text: txt }).catch(function () {});
      return;
    }
    var done = function () { showToast(t("toast.copied")); };
    var fail = function () { showToast(t("toast.copyFail")); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(done, function () { if (legacyCopy(txt)) done(); else fail(); });
      return;
    }
    if (legacyCopy(txt)) done(); else fail();
  }

  // Print: a plain sheet built for paper (checkboxes, one column).
  function printTrip(id) {
    commitNotes();
    var trip = findTrip(id);
    if (!trip) return;
    var host = $("print");
    host.innerHTML = "";
    host.appendChild(el("h1", "", trip.name));
    var sub = [trip.dest, fmtRange(trip), nightsText(trip)].filter(Boolean).join(" · ");
    if (sub) host.appendChild(el("p", "pr-sub", sub));
    if (trip.people.length) host.appendChild(el("p", "pr-sub", t("txt.people") + ": " + trip.people.join(", ")));
    if (trip.pack.length) {
      host.appendChild(el("h2", "", t("tab.pack")));
      var cols = el("div", "pr-cols");
      packGroups(trip.pack).forEach(function (g) {
        var sec = el("section", "pr-grp");
        sec.appendChild(el("h3", "", grpName(g.grp)));
        var ul = el("ul", "");
        g.items.forEach(function (p) {
          ul.appendChild(el("li", p.done ? "on" : "", (p.qty > 1 ? p.qty + " × " : "") + p.name +
            (p.who ? " (" + p.who + ")" : "") + (p.note ? " · " + p.note : "")));
        });
        sec.appendChild(ul);
        cols.appendChild(sec);
      });
      host.appendChild(cols);
    }
    if (trip.plan.length) {
      host.appendChild(el("h2", "", t("tab.plan")));
      planSections(trip).forEach(function (s) {
        if (!s.items.length) return;
        host.appendChild(el("h3", "", s.label));
        var ul = el("ul", "pr-plan");
        s.items.forEach(function (p) { ul.appendChild(el("li", "", entryLine(p) + (p.note ? " · " + p.note.replace(/\n+/g, " ") : ""))); });
        host.appendChild(ul);
      });
    }
    if (trip.notes.trim()) {
      host.appendChild(el("h2", "", t("tab.notes")));
      host.appendChild(el("p", "pr-notes", trip.notes.trim()));
    }
    setTimeout(function () { window.print(); }, 50);
  }

  // ---------- 9. Toasts + keyboard ----------
  function showToast(msg) {
    try {
      var n = (window.parent && window.parent !== window && window.parent.orosNotifs) || null;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "travel", title: String(msg) })) return;
    } catch (e) {}
    localToast(msg, null);
  }
  // Undo toasts stay local (the closure never leaves the frame), 8 s.
  function undoToast(msg, onUndo) { localToast(msg, onUndo); }

  var toastTimer = null;
  function localToast(msg, onUndo) {
    var box = $("toast");
    if (!box) return;
    hostToast();
    box.innerHTML = "";
    box.classList.remove("show");
    box.appendChild(el("span", "", msg));
    if (onUndo) {
      var b = el("button", "", t("toast.undo"));
      b.type = "button";
      b.addEventListener("click", function () {
        box.classList.remove("show");
        clearTimeout(toastTimer);
        onUndo();
      });
      box.appendChild(b);
    }
    void box.offsetWidth;
    box.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.classList.remove("show"); }, onUndo ? 8000 : 4000);
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
      if (!(p && p !== window && p.orosShortcuts &&
            typeof p.orosShortcuts.handle === "function")) return;
      if (p.orosShortcuts.handle(e)) e.stopPropagation();
    }, true);
    // Escape: back to the list (not while a dialog or a menu is open)
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape" || e.defaultPrevented || menuEl || document.querySelector("dialog[open]")) return;
      if (prefs.view !== "list") { e.preventDefault(); goBack(); }
    });
  }

  // ---------- 10. Sync slice + palette ----------
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
    api.registerSlice("travel", sliceGet, sliceSet, STORAGE_KEY, mergeTravel);
  }

  function sliceGet() {
    if (notesTimer !== null) commitNotes();
    return mergeTravel(data, data);   // canonical copy (R26)
  }

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.trips)) return;
    var next = mergeTravel(incoming, incoming);
    if (JSON.stringify(next) === JSON.stringify(data)) return;   // nothing new: keep the live objects
    var wasOpen = prefs.view === "trip" && curTrip();
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = next;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    if (wasOpen && !curTrip()) {
      prefs.view = "list";
      savePrefs();
      showToast(t("toast.gone"));
    }
    render();                                // no toast on merge (sync feedback = taskbar dot)
  }

  // ---------- 11. Wiring & boot ----------
  function applyI18n() {
    [].forEach.call(document.querySelectorAll("[data-i18n]"), function (n) {
      n.textContent = t(n.getAttribute("data-i18n"));
    });
    document.title = t("app") + " · orOS";
    function ib(id, html, key) {
      var b = $(id);
      b.innerHTML = html;
      b.setAttribute("aria-label", t(key));
      b.title = t(key);
    }
    ib("back-btn", UI.back, "btn.back");
    ib("more-btn", UI.more, "btn.more");
    ib("pack-add", UI.plus, "pack.addBtn");
    $("tpl-btn").innerHTML = UI.tpl + "<span>" + t("btn.tpls") + "</span>";
    $("new-btn").innerHTML = UI.plus + "<span>" + t("btn.new") + "</span>";
    $("newtpl-btn").innerHTML = UI.plus + "<span>" + t("btn.newTpl") + "</span>";
    $("list-new").innerHTML = UI.plus + "<span>" + t("btn.new") + "</span>";
    $("plan-add").innerHTML = UI.plus + "<span>" + t("plan.add") + "</span>";
    $("plan-imp").innerHTML = UI.imp + "<span>" + t("imp.btn") + "</span>";
    $("map-gpx").textContent = t("map.gpx");
    $("map-open").textContent = t("map.open");
    $("map-days").setAttribute("aria-label", t("tab.map"));
    $("pack-tpl").innerHTML = UI.tpl + "<span>" + t("pack.fromTpl") + "</span>";
    $("pack-in").placeholder = t("pack.add");
    $("pack-in").setAttribute("aria-label", t("pack.add"));
    $("pack-grp").setAttribute("aria-label", t("pack.grpSel"));
    $("pack-who").setAttribute("aria-label", t("pack.whoSel"));
    $("notes").placeholder = t("notes.ph");
    $("notes").setAttribute("aria-label", t("tab.notes"));
    $("list-empty-art").innerHTML = UI.bag;
  }

  function wire() {
    $("back-btn").addEventListener("click", goBack);
    $("more-btn").addEventListener("click", moreMenu);
    $("new-btn").addEventListener("click", function () { tripDialog(null); });
    $("list-new").addEventListener("click", function () { tripDialog(null); });
    $("tpl-btn").addEventListener("click", function () { prefs.view = "tpls"; savePrefs(); render(); });
    $("newtpl-btn").addEventListener("click", function () { tplDialog(null); });
    $("tpl-restore").addEventListener("click", restoreSeeds);
    PANES.forEach(function (k) {
      $("tab-" + k).addEventListener("click", function () { setTab(k); });
    });
    $("plan-imp").addEventListener("click", function () { importStart(prefs.trip); });
    $("map-find").addEventListener("click", function () { findOnMap(prefs.trip); });
    $("map-open").addEventListener("click", function () { sendToMaps(prefs.trip); });
    $("map-gpx").addEventListener("click", function () { exportGpx(prefs.trip, prefs.mapDay); });
    $("jr-empty").addEventListener("click", function () { prefs.jempty = prefs.jempty ? 0 : 1; savePrefs(); render(); });
    $("pack-in").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); quickAdd(); }
    });
    $("pack-add").addEventListener("click", quickAdd);
    $("pack-grp").addEventListener("change", function () { prefs.grp = normGrp($("pack-grp").value); savePrefs(); });
    $("pack-missing").addEventListener("click", function () { prefs.missing = prefs.missing ? 0 : 1; savePrefs(); render(); });
    $("pack-who").addEventListener("change", function () { prefs.who = $("pack-who").value; savePrefs(); render(); });
    $("pack-uncheck").addEventListener("click", uncheckAll);
    $("pack-tpl").addEventListener("click", applyTplDialog);
    $("plan-add").addEventListener("click", function () {
      var trip = curTrip(), today = todayYmd();
      planDialog(null, trip && tripDayList(trip).indexOf(today) >= 0 ? today : "");
    });
    $("notes").addEventListener("input", function () {
      clearTimeout(notesTimer);
      notesTimer = setTimeout(commitNotes, 700);
    });
    $("notes").addEventListener("blur", function () { if (notesTimer !== null) commitNotes(); });
    try {
      var mq = window.matchMedia("(min-width: 900px)"), last = mq.matches;
      var onMq = function () { if (mq.matches !== last) { last = mq.matches; if (prefs.view === "trip") render(); } };
      if (mq.addEventListener) mq.addEventListener("change", onMq); else mq.addListener(onMq);
    } catch (e) {}
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") { commitNotes(); savePrefsNow(); }
    });
    window.addEventListener("pagehide", function () { commitNotes(); savePrefsNow(); });
    // A new day moves countdowns and phases.
    var lastDay = todayYmd();
    setInterval(function () {
      var d = todayYmd();
      if (d !== lastDay && !document.querySelector("dialog[open]")) { lastDay = d; render(); }
    }, 60000);
    wireKeyboard();
  }

  // Deep link from the shell (__orosOpenTravel): Calendar rows and
  // reminders. Live push, or the staged "id" / "id plan" at boot.
  window.__orosTravelOpen = function (tripId, tab) {
    if (typeof tripId !== "string" || !ID_RE.test(tripId) || !findTrip(tripId)) return;
    var dlg = document.querySelector("dialog[open]");
    if (dlg) return;                          // never throw away an open edit
    commitNotes();
    if (tab === "pack" || tab === "plan") prefs.tab = tab;
    openTrip(tripId);
  };
  function takeStaged() {
    var v = null;
    try {
      v = sessionStorage.getItem("oros-travel-open");
      if (v) sessionStorage.removeItem("oros-travel-open");
    } catch (e) {}
    if (v) {
      var parts = String(v).split(" ");
      window.__orosTravelOpen(parts[0], parts[1]);
    }
  }

  function boot() {
    load();
    loadPrefs();
    applyI18n();
    wire();
    registerSync();
    inheritPalette();
    watchPalette();
    render();
    takeStaged();
    try {
      if (window.parent && window.parent !== window &&
          typeof window.parent.__orosTakeTarget === "function") {
        var pendingTarget = window.parent.__orosTakeTarget("travel");
        if (pendingTarget) openSearchTarget(pendingTarget);
      }
    } catch (e) {}
  }

  // Universal search deep link (shell __orosOpenAt / __orosTakeTarget):
  // target { trip, tab, item }. Opens the trip (tab "pack" | "plan"
  // when given) and the packing item's or itinerary entry's editor.
  // Unknown trip → no-op; an open dialog → no-op (unsaved edits win).
  function openSearchTarget(t) {
    if (document.querySelector("dialog[open]")) return;
    if (t && t.importMail) { closeMenu(); commitNotes(); importFromMail(t.importMail); return; }
    var trip = t && typeof t.trip === "string" ? findTrip(t.trip) : null;
    if (!trip) return;
    closeMenu();
    commitNotes();
    if (t.tab === "pack" || t.tab === "plan") prefs.tab = t.tab;
    openTrip(trip.id);
    if (typeof t.item !== "string") return;
    if (t.tab === "pack" && findIn(trip.pack, t.item)) itemDialog(t.item);
    else if (t.tab === "plan" && findIn(trip.plan, t.item)) planDialog(t.item);
  }
  window.__orosOpenAt = openSearchTarget;

  boot();
})();
