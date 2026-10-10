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
  var LEN = { name: 80, dest: 100, notes: 20000, person: 30, item: 80, grp: 30, note: 300,
              title: 100, place: 150, stop: 60, ref: 60, pnote: 1000, tpl: 50 };
  var GROUPS = ["clothes", "toilet", "health", "tech", "docs", "baby", "gear", "food", "misc", "before"];
  var KINDS  = ["flight", "train", "bus", "ferry", "car", "stay", "activity", "food", "other"];
  var MOVES  = { flight: 1, train: 1, bus: 1, ferry: 1, car: 1 };
  var TRIP_F = ["name", "dest", "start", "end", "people", "notes"];
  var PACK_F = ["name", "qty", "rule", "grp", "who", "note", "done"];
  var PLAN_F = ["kind", "title", "day", "t1", "day2", "t2", "place", "from", "to", "ref", "note", "pos"];
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
      "wx.c.rain": "Rain", "wx.c.snow": "Snow", "wx.c.storm": "Thunderstorm", "wx.pp": "Chance of rain {n}%"
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
      "wx.c.rain": "Βροχή", "wx.c.snow": "Χιόνι", "wx.c.storm": "Καταιγίδα", "wx.pp": "Πιθανότητα βροχής {n}%"
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

  var NORM = {
    trip: {
      name: lineOf(LEN.name), dest: lineOf(LEN.dest), start: normDate, end: normDate,
      people: normPeople, notes: function (v) { return text(v, LEN.notes); }
    },
    pack: {
      name: lineOf(LEN.item), qty: normQty, rule: normRule, grp: normGrp,
      who: lineOf(LEN.person), note: lineOf(LEN.note), done: function (v) { return v === true; }
    },
    plan: {
      kind: function (v) { return KINDS.indexOf(v) >= 0 ? v : "other"; },
      title: lineOf(LEN.title), day: normDate, t1: normHm, day2: normDate, t2: normHm,
      place: lineOf(LEN.place), from: lineOf(LEN.stop), to: lineOf(LEN.stop), ref: lineOf(LEN.ref),
      note: function (v) { return text(v, LEN.pnote); }, pos: normPos
    }
  };

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
    var heads = {}, packs = {}, plans = {};
    [a.trips, b.trips].forEach(function (list) {
      if (!Array.isArray(list)) return;
      list.forEach(function (raw) {
        var x = normEnt(raw, TRIP_F, NORM.trip);
        if (!x) return;
        if (heads[x.id]) heads[x.id] = mergeFields(heads[x.id], x, TRIP_F);
        else { heads[x.id] = x; packs[x.id] = []; plans[x.id] = []; }
        packs[x.id].push(raw.pack);
        plans[x.id].push(raw.plan);
      });
    });
    var newest = 0;
    function seen(s) { if (s > newest) newest = s; }
    var trips = [];
    Object.keys(heads).sort(cmpStr).forEach(function (id) {
      var h = heads[id];
      if (id in tombs && tombs[id] >= life(h)) return;
      h.pack = unionEnts(packs[id], PACK_F, NORM.pack, tombs);
      h.plan = unionEnts(plans[id], PLAN_F, NORM.plan, tombs);
      seen(life(h));
      h.pack.forEach(function (e) { seen(life(e)); });
      h.plan.forEach(function (e) { seen(life(e)); });
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
    if (p.place) sub.push(p.place);
    if (p.ref) sub.push(t("txt.ref") + " " + p.ref);
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
      var desc = [p.ref ? t("f.ref") + ": " + p.ref : "", p.note].filter(Boolean).join("\n");
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
      tab: p.tab === "plan" || p.tab === "notes" ? p.tab : "pack",
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
    e.pack = [];
    e.plan = [];
    return e;
  }
  function newItem(vals) { return newEnt(PACK_F, NORM.pack, vals); }
  function newEntry(vals) { return newEnt(PLAN_F, NORM.plan, vals); }

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
    undoToast(t("toast.tripDel"), function () {
      snap.f.name = Math.max(Date.now(), (data.tombs[id] || 0) + 1);   // R17: a newer edit resurrects
      data.trips.push(snap);
      commit();
    });
  }
  function deleteItem(tripId, list, id, msg) {
    var trip = findTrip(tripId), e = trip && findIn(trip[list], id);
    if (!e) return;
    var snap = clone(e);
    data.tombs[id] = Math.max(Date.now(), life(e));
    commit();
    undoToast(t(msg), function () {
      var tr = findTrip(tripId);
      if (!tr) return;
      snap.f[list === "pack" ? "name" : "title"] = Math.max(Date.now(), (data.tombs[id] || 0) + 1);
      tr[list].push(snap);
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
    kind: {
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
  function openMaps(query, label) {
    var p = mapsBridge();
    if (p && query) p.__orosOpenMapsQuery(query, label || query);
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
    var both = wide && tab !== "notes";
    $("tab-pack").textContent = wide ? t("tab.both") : t("tab.pack");
    $("tab-plan").hidden = wide;
    [["pack", both || tab === "pack"], ["plan", !wide && tab === "plan"], ["notes", tab === "notes"]].forEach(function (x) {
      var b = $("tab-" + x[0]);
      b.classList.toggle("on", x[1]);
      b.setAttribute("aria-selected", x[1] ? "true" : "false");
    });
    $("panes").classList.toggle("both", both);
    $("p-pack").hidden = !(both || tab === "pack");
    $("p-plan").hidden = !(both || tab === "plan");
    $("p-notes").hidden = tab !== "notes";
    if (!$("p-pack").hidden) renderPack(trip);
    if (!$("p-plan").hidden) renderPlan(trip);
    if (!$("p-notes").hidden) renderNotes(trip);
  }

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
    if (p.place) sub.push(p.place);
    if (p.ref) sub.push("#" + p.ref);
    if (sub.length) tx.appendChild(el("span", "er-sub", sub.join(" · ")));
    b.appendChild(tx);
    b.addEventListener("click", function () { planDialog(p.id); });
    li.appendChild(b);
    var q = p.place || (MOVES[p.kind] ? p.to : "");
    if (q && mapsBridge()) li.appendChild(iconBtn("mini", UI.pin, t("plan.maps"), function () { openMaps(q, entryTitle(p)); }));
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
    var v = p || { kind: "activity", title: "", day: day || "", t1: "", day2: "", t2: "", place: "", from: "", to: "", ref: "", note: "" };
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
    var fRef = input("text", LEN.ref, v.ref);
    var fNote = el("textarea");
    fNote.id = "tf-" + (++fieldSeq);
    fNote.maxLength = LEN.pnote;
    fNote.rows = 3;
    fNote.value = v.note;
    var wTitle = field(t("f.title"), fTitle), wFromTo = row(field(t("f.from"), fFrom), field(t("f.to"), fTo));
    var wDay = field(t("f.day"), fDay), wT1 = field(t("f.time"), fT1, "narrow");
    var wDay2 = field(t("f.arrDay"), fDay2), wT2 = field(t("f.ends"), fT2, "narrow");
    var wPlace = field(t("f.place"), fPlace);
    form.appendChild(field(t("f.kind"), fKind));
    form.appendChild(wFromTo);
    form.appendChild(wTitle);
    form.appendChild(row(wDay, wT1));
    form.appendChild(row(wDay2, wT2));
    form.appendChild(wPlace);
    form.appendChild(field(t("f.ref"), fRef));
    form.appendChild(field(t("f.pnote"), fNote));
    function lab(w, key) { w.querySelector("label").textContent = t(key); }
    function layout() {
      var k = fKind.value, move = !!MOVES[k], stay = k === "stay";
      wFromTo.hidden = !move;
      wPlace.hidden = move;
      wDay2.hidden = !(move || stay);
      lab(wTitle, stay ? "f.titleStay" : "f.title");
      lab(wDay, stay ? "f.in" : "f.day");
      lab(wT1, stay ? "f.inTime" : (move ? "f.dep" : "f.time"));
      lab(wDay2, stay ? "f.out" : "f.arrDay");
      lab(wT2, stay ? "f.outTime" : (move ? "f.arr" : "f.ends"));
      if (fDay2.tagName === "SELECT") fDay2.options[0].textContent = stay ? t("f.noday") : t("f.sameDay");
    }
    fKind.addEventListener("change", layout);
    layout();
    var del = p ? button(t("dlg.delete"), "danger", function () { dlg.close(); deleteItem(trip.id, "plan", id, "toast.planDel"); }) : null;
    form.appendChild(actions(dlg, t(p ? "dlg.save" : "dlg.add"), del));
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var k = fKind.value, move = !!MOVES[k];
      var vals = {
        kind: k, title: line(fTitle.value, LEN.title), day: normDate(fDay.value), t1: normHm(fT1.value),
        day2: wDay2.hidden ? v.day2 : normDate(fDay2.value), t2: normHm(fT2.value),
        place: wPlace.hidden ? v.place : line(fPlace.value, LEN.place),
        from: move ? line(fFrom.value, LEN.stop) : v.from, to: move ? line(fTo.value, LEN.stop) : v.to,
        ref: line(fRef.value, LEN.ref), note: text(fNote.value, LEN.pnote)
      };
      if (!vals.title && !(move && (vals.from || vals.to)) && !vals.place) { showToast(t("toast.needName")); fTitle.focus(); return; }
      var tr = curTrip();
      dlg.close();
      if (!tr) return;
      if (!p) {
        vals.pos = nextPos(tr, vals.day);
        tr.plan.push(newEntry(vals));
      } else {
        var x = findIn(tr.plan, id);
        if (!x) return;
        Object.keys(vals).forEach(function (key) { setField(x, key, NORM.plan[key](vals[key])); });
      }
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
    ["pack", "plan", "notes"].forEach(function (k) {
      $("tab-" + k).addEventListener("click", function () { setTab(k); });
    });
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
