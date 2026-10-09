// ============================================================
// orOS Garage — App logic (v1.0.0)
// Every vehicle you own, from a car to a bicycle:
//   - fuel and charging with full-to-full consumption
//   - service log + service plans by km and/or months
//   - renewals (KTEO, insurance, road tax, emissions card,
//     roadside assistance, licence…) with "Renewed" in one tap
//   - tyre sets (season, DOT age, tread, km per set, swap)
//   - other costs, odometer readings, stats with charts
//   - "Send to Budget" (prefilled new expense, nothing written
//     until you save it there; shown only when Budget offers the
//     bridge), Calendar feed, CSV / JSON export, JSON import
//   - reminders come from the shell engine (garageCheckTick),
//     which uses core.js too
// Data:
//   - synced slice "garage" (oros-garage-data): every list LWW per
//     id + tombstones; merge = OrosGarageCore.merge (R5, R26)
//   - device-local (R10): oros-garage-prefs (reminder hour, unit,
//     tyre thresholds, tab, vehicle, log filter, stats range)
// Sections:
//   1. Constants, i18n, helpers
//   2. Storage + prefs
//   3. Mutations: upsert, remove (Undo), Budget bridge
//   4. Vehicle bar + Overview
//   5. Log
//   6. Stats + charts
//   7. Editors: vehicle, fuel, service, cost, km, plan,
//      renewal (+ Renewed), tyres (+ mount)
//   8. Settings, export / import
//   9. Dialogs + toasts
//  10. Keyboard (Contract Β) + deep link
//  11. Sync slice + palette
//  12. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var C = window.OrosGarageCore;
  var STORAGE_KEY = "oros-garage-data";
  var PREFS_KEY   = "oros-garage-prefs";
  var OPEN_KEY    = "oros-garage-open";
  var COLORS = ["#e06c75", "#ecc75f", "#87cf3e", "#4fc4cf", "#6d4aff", "#e09ecf", "#f28c5a", "#9aa4b0"];
  var WARN_STEPS = [60, 30, 14, 7, 1];
  var CUR_SYM = { EUR: "€", USD: "$", GBP: "£", JPY: "¥" };

  // ---------- 1. Constants, i18n, helpers ----------
  function appLang() {
    try {
      var l = localStorage.getItem("oros-lang") ||
              (window.parent && window.parent.orosLang) || "en";
      return l === "el" ? "el" : "en";
    } catch (e) { return "en"; }
  }
  var LANG = appLang();
  var LOCALE = LANG === "el" ? "el-GR" : "en-GB";

  var STRINGS = {
    en: {
      "app": "Garage",
      "tab.home": "Overview", "tab.log": "Log", "tab.stats": "Stats",
      "btn.add": "Add", "btn.addAria": "Add an entry", "btn.settings": "Settings", "btn.vehicles": "All vehicles",
      "empty.first": "Keep fuel, service, tyres and renewals for every vehicle you own, from a car to a bicycle. orOS reminds you before KTEO, insurance or the next service.",
      "empty.first.btn": "Add a vehicle",
      "type.car": "Car", "type.moto": "Motorcycle", "type.scooter": "Scooter", "type.van": "Van", "type.truck": "Truck",
      "type.camper": "Camper", "type.tractor": "Tractor", "type.boat": "Boat", "type.bike": "Bicycle",
      "type.ebike": "E-bike", "type.escooter": "E-scooter", "type.other": "Other",
      "fuel.petrol": "Petrol", "fuel.diesel": "Diesel", "fuel.lpg": "LPG", "fuel.cng": "CNG", "fuel.hybrid": "Hybrid",
      "fuel.phev": "Plug-in hybrid", "fuel.ev": "Electric", "fuel.none": "No fuel",
      "cat.toll": "Tolls", "cat.park": "Parking", "cat.wash": "Wash", "cat.fine": "Fines", "cat.parts": "Parts",
      "cat.acc": "Accessories", "cat.kteo": "KTEO", "cat.ins": "Insurance", "cat.tax": "Road tax", "cat.kek": "Emissions card",
      "cat.road": "Roadside assistance", "cat.lic": "Driving licence", "cat.rent": "Rental", "cat.other": "Other",
      "season.s": "Summer", "season.w": "Winter", "season.a": "All-season",
      "kind.fuel": "Fuel", "kind.charge": "Charging", "kind.service": "Service", "kind.cost": "Expense", "kind.odo": "Km reading",
      "q.fuel": "Fuel", "q.charge": "Charge", "q.service": "Service", "q.cost": "Expense", "q.odo": "Km",
      "v.km": "{km} km", "v.noKm": "No km yet", "v.edit": "Edit", "v.updKm": "Update km", "v.archived": "Archived (no reminders)",
      "sec.next": "Coming up", "sec.renewals": "Renewals", "sec.plans": "Service plan", "sec.tyres": "Tyres", "sec.notes": "Notes",
      "sec.add": "+ Add", "next.none": "Nothing is coming up.",
      "renewed": "Renewed", "serviced": "Done", "mount": "Mount",
      "exp.in": "expires {when}", "exp.today": "expires today", "exp.ago": "expired {n} days ago", "exp.ago1": "expired yesterday",
      "plan.every": "every {what}", "plan.km": "{n} km", "plan.mo1": "month", "plan.mo": "{n} months",
      "plan.or": " or ", "plan.at": "at {km} km", "plan.left": "{n} km left", "plan.over": "{n} km over",
      "plan.dueOn": "by {date}", "plan.est": "≈ {date}", "plan.unknown": "log the km to see when",
      "due.today": "today", "due.tomorrow": "tomorrow", "due.in": "in {n} days", "due.late1": "1 day late", "due.late": "{n} days late",
      "tyre.mounted": "Mounted", "tyre.km": "{n} km", "tyre.age": "{n} years old", "tyre.old": "old", "tyre.worn": "worn",
      "tyre.tread": "{n} mm",
      "tile.cons": "Consumption", "tile.consLast": "last {v}", "tile.month": "This month", "tile.perKm": "Cost per km",
      "tile.perKmSub": "last 12 months", "tile.kmMonth": "Km per month", "tile.kmMonthSub": "recent average",
      "unit.l100": "L/100 km", "unit.kmpl": "km/L", "unit.kwh100": "kWh/100 km", "unit.kg100": "kg/100 km", "unit.kmkg": "km/kg",
      "u.l": "L", "u.kg": "kg", "u.kwh": "kWh",
      "log.all": "All", "log.empty": "Nothing logged yet.", "log.emptyF": "Nothing of this kind yet.",
      "log.full": "full", "log.partial": "partial", "log.missed": "after a missed fill", "log.cons": "{v}",
      "log.sent": "sent to Budget",
      "st.12m": "12 months", "st.year": "This year", "st.all": "All time",
      "st.total": "Total cost", "st.km": "Km driven", "st.perKm": "Cost per km", "st.cons": "Average consumption",
      "st.price": "Average price", "st.none": "Log a few entries to see stats.",
      "ch.costs": "Costs per month", "ch.costsSub": "Fuel, service and other expenses", "ch.cons": "Consumption",
      "ch.consSub": "Per full fill, {unit}", "ch.price": "Price per {u}", "ch.priceSub": "Per fill",
      "ch.byCat": "Where the money goes", "ch.table": "Show as table",
      "ch.fuel": "Fuel", "ch.service": "Service", "ch.other": "Other", "ch.month": "Month", "ch.total": "Total", "ch.date": "Date",
      "f.date": "Date", "f.km": "Odometer (km)", "f.qty": "Quantity ({u})", "f.price": "Price per {u}", "f.total": "Total ({c})",
      "f.full": "Full tank", "f.full.e": "Charged to full", "f.missed": "I missed logging the previous fill",
      "f.station": "Station", "f.notes": "Notes", "f.energy": "Energy", "f.kmWarn": "Lower than an earlier reading ({km} km). Save anyway if it is right.",
      "f.items": "What was done", "f.cost": "Cost ({c})", "f.shop": "Garage / shop", "f.cat": "Category", "f.amount": "Amount ({c})",
      "f.kmOpt": "Odometer (km, optional)",
      "ed.fuel": "Fuel", "ed.charge": "Charging", "ed.service": "Service", "ed.cost": "Expense", "ed.odo": "Km reading",
      "ed.save": "Save", "ed.cancel": "Cancel", "ed.delete": "Delete", "ed.budget": "Send to Budget",
      "ed.vehicleNew": "New vehicle", "ed.vehicleEdit": "Edit vehicle", "ed.type": "Type", "ed.name": "Name",
      "ed.make": "Make", "ed.model": "Model", "ed.year": "Year", "ed.plate": "Plate", "ed.fuelType": "Fuel",
      "ed.tank": "Tank or battery ({u})", "ed.color": "Colour", "ed.startKm": "Odometer now (km)", "ed.plans": "Add the usual service plan (you can change it)",
      "ed.archive": "Archive", "ed.unarchive": "Bring back", "ed.namePh": "My car, Blue bike…",
      "ed.planNew": "New service plan", "ed.planEdit": "Service plan", "ed.item": "Item", "ed.label": "Label",
      "ed.everyKm": "Every (km, 0 = no)", "ed.everyMo": "Every (months, 0 = no)", "ed.from": "Counting from", "ed.fromKm": "At km",
      "ed.planHint": "Usual intervals. Your vehicle's manual comes first.",
      "ed.renNew": "New renewal", "ed.renEdit": "Renewal", "ed.kind": "What", "ed.exp": "Expires on", "ed.every": "Renew every (months, 0 = once)",
      "ed.prov": "Provider", "ed.ref": "Policy / number", "ed.warn": "Remind me before (days)", "ed.expected": "Usual cost ({c})",
      "ed.renew": "Renewed", "ed.paid": "Paid ({c})", "ed.paidOn": "Paid on", "ed.newExp": "New expiry",
      "ed.tyreNew": "New tyre set", "ed.tyreEdit": "Tyre set", "ed.season": "Season", "ed.size": "Size", "ed.brand": "Brand",
      "ed.dot": "DOT (week + year, e.g. 0324)", "ed.tread": "Tread depth (mm)", "ed.kmRun": "Km already run on this set",
      "ed.mountNow": "Mounted now", "ed.mountKm": "Odometer when mounted (km)", "ed.mountTitle": "Mount {name}",
      "ed.odoNow": "Odometer now (km)",
      "set.title": "Settings", "set.vehicles": "Vehicles", "set.addVehicle": "Add a vehicle", "set.cur": "Currency",
      "set.unit": "Consumption", "set.remind": "Daily reminder", "set.off": "Off",
      "set.remindHint": "Reminders for renewals and service appear while orOS is open (also with this app closed). With orOS closed they wait for the next time you open it.",
      "set.tyreAge": "Tyres are old after (years)", "set.tread": "Tyres are worn below (mm)",
      "set.data": "Your data", "set.csv": "Export CSV", "set.json": "Export backup", "set.import": "Import backup", "set.close": "Close",
      "toast.added": "Added", "toast.saved": "Saved", "toast.deleted": "Deleted", "toast.undo": "Undo", "toast.budget": "Budget",
      "toast.save": "Could not save: storage is full", "toast.needName": "Give the vehicle a name",
      "toast.needKm": "Enter the odometer reading", "toast.needQty": "Enter the quantity", "toast.needItems": "Pick at least one item",
      "toast.needAmount": "Enter the amount", "toast.needDate": "Pick a date", "toast.needEvery": "Set km or months",
      "toast.needLabel": "Give it a label", "toast.max": "Up to {n} vehicles", "toast.renewed": "{name}: next expiry {date}",
      "toast.mounted": "{name} mounted", "toast.exported": "Exported", "toast.imported": "Imported: {n} vehicles",
      "toast.badFile": "This is not a Garage backup", "toast.archived": "{name} archived", "toast.unarchived": "{name} is back",
      "toast.sent": "Opened in Budget: check and save it there",
      "confirm.delVehicle": "Delete {name} and everything logged for it?", "confirm.del": "Delete this entry?",
      "confirm.yes": "Delete", "confirm.resend": "This was already sent to Budget. Send it again?", "confirm.send": "Send",
      "budget.note": "{vehicle} · {what}",
      "live.added": "{what} added"
    },
    el: {
      "app": "Γκαράζ",
      "tab.home": "Επισκόπηση", "tab.log": "Ιστορικό", "tab.stats": "Στατιστικά",
      "btn.add": "Νέο", "btn.addAria": "Νέα καταχώριση", "btn.settings": "Ρυθμίσεις", "btn.vehicles": "Όλα τα οχήματα",
      "empty.first": "Κράτα καύσιμα, σέρβις, λάστιχα και ανανεώσεις για κάθε όχημα που έχεις, από αυτοκίνητο μέχρι ποδήλατο. Το orOS σου θυμίζει πριν το ΚΤΕΟ, την ασφάλεια ή το επόμενο σέρβις.",
      "empty.first.btn": "Νέο όχημα",
      "type.car": "Αυτοκίνητο", "type.moto": "Μοτοσικλέτα", "type.scooter": "Σκούτερ", "type.van": "Βαν", "type.truck": "Φορτηγό",
      "type.camper": "Τροχόσπιτο", "type.tractor": "Τρακτέρ", "type.boat": "Σκάφος", "type.bike": "Ποδήλατο",
      "type.ebike": "Ηλεκτρικό ποδήλατο", "type.escooter": "Ηλεκτρικό πατίνι", "type.other": "Άλλο",
      "fuel.petrol": "Βενζίνη", "fuel.diesel": "Πετρέλαιο", "fuel.lpg": "Υγραέριο", "fuel.cng": "Φυσικό αέριο", "fuel.hybrid": "Υβριδικό",
      "fuel.phev": "Plug-in υβριδικό", "fuel.ev": "Ηλεκτρικό", "fuel.none": "Χωρίς καύσιμο",
      "cat.toll": "Διόδια", "cat.park": "Στάθμευση", "cat.wash": "Πλύσιμο", "cat.fine": "Πρόστιμα", "cat.parts": "Ανταλλακτικά",
      "cat.acc": "Αξεσουάρ", "cat.kteo": "ΚΤΕΟ", "cat.ins": "Ασφάλεια", "cat.tax": "Τέλη κυκλοφορίας", "cat.kek": "Κάρτα καυσαερίων",
      "cat.road": "Οδική βοήθεια", "cat.lic": "Δίπλωμα οδήγησης", "cat.rent": "Ενοικίαση", "cat.other": "Άλλο",
      "season.s": "Καλοκαιρινά", "season.w": "Χειμερινά", "season.a": "4 εποχών",
      "kind.fuel": "Καύσιμα", "kind.charge": "Φόρτιση", "kind.service": "Σέρβις", "kind.cost": "Έξοδο", "kind.odo": "Χιλιόμετρα",
      "q.fuel": "Καύσιμα", "q.charge": "Φόρτιση", "q.service": "Σέρβις", "q.cost": "Έξοδο", "q.odo": "Χιλιόμ.",
      "v.km": "{km} km", "v.noKm": "Χωρίς χιλιόμετρα ακόμα", "v.edit": "Επεξεργασία", "v.updKm": "Χιλιόμετρα", "v.archived": "Στο αρχείο (χωρίς υπενθυμίσεις)",
      "sec.next": "Έρχονται", "sec.renewals": "Ανανεώσεις", "sec.plans": "Πρόγραμμα σέρβις", "sec.tyres": "Λάστιχα", "sec.notes": "Σημειώσεις",
      "sec.add": "+ Νέο", "next.none": "Τίποτα δεν πλησιάζει.",
      "renewed": "Ανανεώθηκε", "serviced": "Έγινε", "mount": "Τοποθέτηση",
      "exp.in": "λήγει {when}", "exp.today": "λήγει σήμερα", "exp.ago": "έληξε πριν {n} μέρες", "exp.ago1": "έληξε χθες",
      "plan.every": "κάθε {what}", "plan.km": "{n} km", "plan.mo1": "μήνα", "plan.mo": "{n} μήνες",
      "plan.or": " ή ", "plan.at": "στα {km} km", "plan.left": "απομένουν {n} km", "plan.over": "πέρασαν {n} km",
      "plan.dueOn": "έως {date}", "plan.est": "≈ {date}", "plan.unknown": "γράψε χιλιόμετρα για να φανεί πότε",
      "due.today": "σήμερα", "due.tomorrow": "αύριο", "due.in": "σε {n} μέρες", "due.late1": "1 μέρα πίσω", "due.late": "{n} μέρες πίσω",
      "tyre.mounted": "Τοποθετημένα", "tyre.km": "{n} km", "tyre.age": "{n} χρόνια", "tyre.old": "παλιά", "tyre.worn": "φαγωμένα",
      "tyre.tread": "{n} mm",
      "tile.cons": "Κατανάλωση", "tile.consLast": "τελευταία {v}", "tile.month": "Αυτόν τον μήνα", "tile.perKm": "Κόστος ανά km",
      "tile.perKmSub": "τελευταίοι 12 μήνες", "tile.kmMonth": "Km τον μήνα", "tile.kmMonthSub": "πρόσφατος μέσος όρος",
      "unit.l100": "L/100 km", "unit.kmpl": "km/L", "unit.kwh100": "kWh/100 km", "unit.kg100": "kg/100 km", "unit.kmkg": "km/kg",
      "u.l": "L", "u.kg": "kg", "u.kwh": "kWh",
      "log.all": "Όλα", "log.empty": "Τίποτα καταγεγραμμένο ακόμα.", "log.emptyF": "Τίποτα από αυτό το είδος ακόμα.",
      "log.full": "γέμισμα", "log.partial": "μερικό", "log.missed": "μετά από χαμένο γέμισμα", "log.cons": "{v}",
      "log.sent": "στάλθηκε στο Budget",
      "st.12m": "12 μήνες", "st.year": "Φέτος", "st.all": "Όλα",
      "st.total": "Συνολικό κόστος", "st.km": "Χιλιόμετρα", "st.perKm": "Κόστος ανά km", "st.cons": "Μέση κατανάλωση",
      "st.price": "Μέση τιμή", "st.none": "Γράψε μερικές καταχωρίσεις για να δεις στατιστικά.",
      "ch.costs": "Κόστος ανά μήνα", "ch.costsSub": "Καύσιμα, σέρβις και λοιπά έξοδα", "ch.cons": "Κατανάλωση",
      "ch.consSub": "Ανά γέμισμα, {unit}", "ch.price": "Τιμή ανά {u}", "ch.priceSub": "Ανά ανεφοδιασμό",
      "ch.byCat": "Πού πάνε τα χρήματα", "ch.table": "Προβολή ως πίνακας",
      "ch.fuel": "Καύσιμα", "ch.service": "Σέρβις", "ch.other": "Λοιπά", "ch.month": "Μήνας", "ch.total": "Σύνολο", "ch.date": "Ημερομηνία",
      "f.date": "Ημερομηνία", "f.km": "Χιλιομετρητής (km)", "f.qty": "Ποσότητα ({u})", "f.price": "Τιμή ανά {u}", "f.total": "Σύνολο ({c})",
      "f.full": "Γέμισμα ρεζερβουάρ", "f.full.e": "Φόρτιση μέχρι πάνω", "f.missed": "Δεν έγραψα το προηγούμενο γέμισμα",
      "f.station": "Πρατήριο", "f.notes": "Σημειώσεις", "f.energy": "Ενέργεια", "f.kmWarn": "Μικρότερο από προηγούμενη ένδειξη ({km} km). Αποθήκευσε αν είναι σωστό.",
      "f.items": "Τι έγινε", "f.cost": "Κόστος ({c})", "f.shop": "Συνεργείο / κατάστημα", "f.cat": "Κατηγορία", "f.amount": "Ποσό ({c})",
      "f.kmOpt": "Χιλιομετρητής (km, προαιρετικά)",
      "ed.fuel": "Καύσιμα", "ed.charge": "Φόρτιση", "ed.service": "Σέρβις", "ed.cost": "Έξοδο", "ed.odo": "Χιλιόμετρα",
      "ed.save": "Αποθήκευση", "ed.cancel": "Άκυρο", "ed.delete": "Διαγραφή", "ed.budget": "Στείλε στο Budget",
      "ed.vehicleNew": "Νέο όχημα", "ed.vehicleEdit": "Επεξεργασία οχήματος", "ed.type": "Τύπος", "ed.name": "Όνομα",
      "ed.make": "Μάρκα", "ed.model": "Μοντέλο", "ed.year": "Έτος", "ed.plate": "Πινακίδα", "ed.fuelType": "Καύσιμο",
      "ed.tank": "Ρεζερβουάρ ή μπαταρία ({u})", "ed.color": "Χρώμα", "ed.startKm": "Χιλιόμετρα τώρα (km)", "ed.plans": "Βάλε το συνηθισμένο πρόγραμμα σέρβις (αλλάζει)",
      "ed.archive": "Στο αρχείο", "ed.unarchive": "Επαναφορά", "ed.namePh": "Το αμάξι μου, Μπλε ποδήλατο…",
      "ed.planNew": "Νέο στοιχείο σέρβις", "ed.planEdit": "Στοιχείο σέρβις", "ed.item": "Εργασία", "ed.label": "Ετικέτα",
      "ed.everyKm": "Κάθε (km, 0 = όχι)", "ed.everyMo": "Κάθε (μήνες, 0 = όχι)", "ed.from": "Μέτρηση από", "ed.fromKm": "Στα km",
      "ed.planHint": "Συνηθισμένα διαστήματα. Προηγείται το βιβλίο του οχήματός σου.",
      "ed.renNew": "Νέα ανανέωση", "ed.renEdit": "Ανανέωση", "ed.kind": "Τι", "ed.exp": "Λήγει στις", "ed.every": "Ανανέωση κάθε (μήνες, 0 = μία φορά)",
      "ed.prov": "Πάροχος", "ed.ref": "Συμβόλαιο / αριθμός", "ed.warn": "Υπενθύμιση πριν (μέρες)", "ed.expected": "Συνηθισμένο κόστος ({c})",
      "ed.renew": "Ανανεώθηκε", "ed.paid": "Πληρώθηκαν ({c})", "ed.paidOn": "Πληρωμή στις", "ed.newExp": "Νέα λήξη",
      "ed.tyreNew": "Νέο σετ λάστιχων", "ed.tyreEdit": "Σετ λάστιχων", "ed.season": "Εποχή", "ed.size": "Διάσταση", "ed.brand": "Μάρκα",
      "ed.dot": "DOT (εβδομάδα + έτος, π.χ. 0324)", "ed.tread": "Βάθος πέλματος (mm)", "ed.kmRun": "Km που έχει ήδη κάνει το σετ",
      "ed.mountNow": "Τοποθετημένα τώρα", "ed.mountKm": "Χιλιόμετρα κατά την τοποθέτηση", "ed.mountTitle": "Τοποθέτηση: {name}",
      "ed.odoNow": "Χιλιόμετρα τώρα (km)",
      "set.title": "Ρυθμίσεις", "set.vehicles": "Οχήματα", "set.addVehicle": "Νέο όχημα", "set.cur": "Νόμισμα",
      "set.unit": "Κατανάλωση", "set.remind": "Καθημερινή υπενθύμιση", "set.off": "Κλειστή",
      "set.remindHint": "Οι υπενθυμίσεις για ανανεώσεις και σέρβις εμφανίζονται όσο το orOS είναι ανοιχτό (και με κλειστή αυτή την εφαρμογή). Με κλειστό το orOS περιμένουν το επόμενο άνοιγμα.",
      "set.tyreAge": "Λάστιχα παλιά μετά από (χρόνια)", "set.tread": "Λάστιχα φαγωμένα κάτω από (mm)",
      "set.data": "Τα δεδομένα σου", "set.csv": "Εξαγωγή CSV", "set.json": "Αντίγραφο ασφαλείας", "set.import": "Επαναφορά αντιγράφου", "set.close": "Κλείσιμο",
      "toast.added": "Προστέθηκε", "toast.saved": "Αποθηκεύτηκε", "toast.deleted": "Διαγράφηκε", "toast.undo": "Αναίρεση", "toast.budget": "Budget",
      "toast.save": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος", "toast.needName": "Δώσε ένα όνομα στο όχημα",
      "toast.needKm": "Γράψε τα χιλιόμετρα", "toast.needQty": "Γράψε την ποσότητα", "toast.needItems": "Διάλεξε τουλάχιστον μία εργασία",
      "toast.needAmount": "Γράψε το ποσό", "toast.needDate": "Διάλεξε ημερομηνία", "toast.needEvery": "Βάλε km ή μήνες",
      "toast.needLabel": "Δώσε μια ετικέτα", "toast.max": "Έως {n} οχήματα", "toast.renewed": "{name}: νέα λήξη {date}",
      "toast.mounted": "Τοποθετήθηκαν: {name}", "toast.exported": "Η εξαγωγή έγινε", "toast.imported": "Εισαγωγή: {n} οχήματα",
      "toast.badFile": "Αυτό δεν είναι αντίγραφο του Γκαράζ", "toast.archived": "Στο αρχείο: {name}", "toast.unarchived": "Επέστρεψε: {name}",
      "toast.sent": "Άνοιξε στο Budget: έλεγξε και αποθήκευσε εκεί",
      "confirm.delVehicle": "Διαγραφή του «{name}» και όλων των καταχωρίσεών του;", "confirm.del": "Διαγραφή αυτής της καταχώρισης;",
      "confirm.yes": "Διαγραφή", "confirm.resend": "Αυτό έχει ήδη σταλεί στο Budget. Να σταλεί ξανά;", "confirm.send": "Αποστολή",
      "budget.note": "{vehicle} · {what}",
      "live.added": "Προστέθηκε: {what}"
    }
  };

  function t(key, params) {
    if (key.indexOf("item.") === 0) return C.itemName(key.slice(5), LANG);   // names live in core.js
    if (key.indexOf("ren.") === 0) return C.renewalName(key.slice(4), LANG);
    var p = STRINGS[LANG] || STRINGS.en;
    var s = p[key] !== undefined ? p[key] : (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
    if (params) {
      Object.keys(params).forEach(function (k) {
        s = s.split("{" + k + "}").join(String(params[k]));
      });
    }
    return s;
  }

  var UI = {
    plus:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    gear:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    list:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>'
  };
  var Q_ICON = { fuel: "⛽", charge: "🔌", service: "🔧", cost: "🧾", odo: "📏" };
  var R_ICON = { kteo: "🛠️", ins: "🛡️", tax: "🏛️", kek: "💨", road: "🆘", lic: "🪪", other: "📄" };

  function $(id) { return document.getElementById(id); }
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
  function todayYmd() { return C.ymdOf(new Date()); }
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }

  var NF = {};
  function nf(dec) {
    var k = String(dec);
    if (!NF[k]) {
      try { NF[k] = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: dec, maximumFractionDigits: dec }); }
      catch (e) { NF[k] = { format: function (n) { return n.toFixed(dec); } }; }
    }
    return NF[k];
  }
  function fmtN(n, dec) { return nf(dec || 0).format(n); }
  function fmtKm(km) { return fmtN(km, 0); }
  var MF = {};
  function money(cents) {
    var cur = (data && data.settings && data.settings.cur) || "EUR";
    if (!MF[cur]) {
      try { MF[cur] = new Intl.NumberFormat(LOCALE, { style: "currency", currency: cur }); }
      catch (e) { MF[cur] = { format: function (n) { return n.toFixed(2) + " " + cur; } }; }
    }
    return MF[cur].format(cents / 100);
  }
  function curSym() {
    var cur = (data && data.settings && data.settings.cur) || "EUR";
    return CUR_SYM[cur] || cur;
  }
  function fmtDay(ymd, withYear) {
    var d = new Date(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10));
    var o = { day: "numeric", month: "short" };
    if (withYear || ymd.slice(0, 4) !== todayYmd().slice(0, 4)) o.year = "numeric";
    try { return d.toLocaleDateString(LOCALE, o); } catch (e) { return ymd; }
  }
  function fmtMonth(ym, short) {
    var d = new Date(+ym.slice(0, 4), +ym.slice(5, 7) - 1, 1);
    try { return d.toLocaleDateString(LOCALE, short ? { month: "short" } : { month: "long", year: "numeric" }); }
    catch (e) { return ym; }
  }
  function whenText(ymd) {
    var diff = C.dayNum(ymd) - C.dayNum(todayYmd());
    if (diff === 0) return t("due.today");
    if (diff === 1) return t("due.tomorrow");
    if (diff === -1) return t("due.late1");
    if (diff < 0) return t("due.late", { n: -diff });
    if (diff < 14) return t("due.in", { n: diff });
    return fmtDay(ymd);
  }
  function typeName(type) { return t("type." + type); }
  function itemName(it, plan) { return it === "other" && plan && plan.label ? plan.label : t("item." + it); }
  function renName(r) { return r.kind === "other" && r.label ? r.label : (r.label ? t("ren." + r.kind) + " · " + r.label : t("ren." + r.kind)); }
  function vIcon(v) { return (C.TYPES[v.type] || C.TYPES.other).em; }
  // unit label of an energy for a vehicle: f → L (CNG: kg), e → kWh
  function uLabel(v, e) { return e === "e" ? t("u.kwh") : (v && v.fuel === "cng" ? t("u.kg") : t("u.l")); }
  function consText(v, e, per100) {
    if (per100 === null || per100 === undefined || !isFinite(per100) || per100 <= 0) return "—";
    if (e === "e") return fmtN(per100, 1) + " " + t("unit.kwh100");
    var cng = v && v.fuel === "cng";
    if (prefs.unit === "kmpl") return fmtN(100 / per100, 1) + " " + t(cng ? "unit.kmkg" : "unit.kmpl");
    return fmtN(per100, 1) + " " + t(cng ? "unit.kg100" : "unit.l100");
  }
  function consUnit(v, e) {
    if (e === "e") return t("unit.kwh100");
    var cng = v && v.fuel === "cng";
    return prefs.unit === "kmpl" ? t(cng ? "unit.kmkg" : "unit.kmpl") : t(cng ? "unit.kg100" : "unit.l100");
  }
  function consVal(e, per100) { return e !== "e" && prefs.unit === "kmpl" ? 100 / per100 : per100; }

  // BOOT MARKER
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    document.documentElement.lang = LANG;
    console.log("garage.js v" + (m ? m[1] : "?") + " boot");
  })();

  // ---------- 2. Storage + prefs ----------
  var data = null, prefs = null;

  function emptyData() { return C.merge(null, null); }
  function canonical(d) { return C.merge(d, d); }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.vehicles)) {
          data = canonical(parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] garage: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
    }
    data = emptyData();
  }

  var saveFailShown = false;
  function save() {
    data = canonical(data);
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
    var b = C.readPrefs(p);
    p = (p && typeof p === "object") ? p : {};
    prefs = {
      remind: b.remind, unit: b.unit, tyreAge: b.tyreAge, tyreTread: b.tyreTread,
      tab: ["home", "log", "stats"].indexOf(p.tab) >= 0 ? p.tab : "home",
      vid: typeof p.vid === "string" && C.ID_RE.test(p.vid) ? p.vid : null,
      logF: ["all", "fuel", "service", "cost", "odo"].indexOf(p.logF) >= 0 ? p.logF : "all",
      range: ["12m", "year", "all"].indexOf(p.range) >= 0 ? p.range : "12m"
    };
  }
  var prefsTimer = null;
  function savePrefs() { clearTimeout(prefsTimer); prefsTimer = setTimeout(savePrefsNow, 300); }
  function savePrefsNow() {
    clearTimeout(prefsTimer); prefsTimer = null;
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  function byId(list, id) {
    var arr = data[list] || [];
    for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
    return null;
  }
  function liveVehicles() { return data.vehicles.filter(function (v) { return !v.arch; }); }
  function sortedVehicles(list) {
    return list.slice().sort(function (a, b) { return a.name.localeCompare(b.name, LOCALE) || cmpStr(a.id, b.id); });
  }
  // The selected vehicle: the saved one when it still exists, else
  // the first live one, else the first archived one.
  function curVehicle() {
    var v = prefs.vid ? byId("vehicles", prefs.vid) : null;
    if (!v) {
      var live = sortedVehicles(liveVehicles());
      v = live[0] || sortedVehicles(data.vehicles)[0] || null;
      prefs.vid = v ? v.id : null;
    }
    return v;
  }
  function rowsOf(list, vid) { return data[list].filter(function (x) { return x.v === vid; }); }
  function stamp(x) { x.m = Math.max(Date.now(), x.m + 1); }

  // ---------- 3. Mutations ----------
  // Insert or update one row. An edit stamps only on a real change
  // (R27). Returns "added" | "saved" | null (nothing changed).
  function upsert(list, row) {
    var cur = byId(list, row.id);
    if (!cur) {
      row.m = Date.now();
      data[list].push(row);
      return "added";
    }
    var changed = Object.keys(row).some(function (k) {
      return k !== "m" && JSON.stringify(cur[k]) !== JSON.stringify(row[k]);
    });
    if (!changed) return null;
    Object.keys(row).forEach(function (k) { if (k !== "m") cur[k] = row[k]; });
    stamp(cur);
    return "saved";
  }

  function removeRow(list, row, onDone) {
    var snapshot = JSON.parse(JSON.stringify(row));
    data.tombs[row.id] = Math.max(Date.now(), row.m);
    data[list] = data[list].filter(function (x) { return x.id !== row.id; });
    save();
    render();
    if (onDone) onDone();
    undoToast(t("toast.deleted"), function () {
      // a newer edit resurrects (R17): m above the tombstone, which
      // may already have travelled
      snapshot.m = Math.max(Date.now(), (data.tombs[row.id] || 0) + 1, snapshot.m + 1);
      data[list] = data[list].filter(function (x) { return x.id !== row.id; });
      data[list].push(snapshot);
      save();
      render();
    });
  }

  function deleteVehicle(v) {
    var snap = JSON.parse(JSON.stringify(v));
    var kids = {};
    C.LIST_KEYS.forEach(function (k) { kids[k] = JSON.parse(JSON.stringify(rowsOf(k, v.id))); });
    data.tombs[v.id] = Math.max(Date.now(), v.m);
    data.vehicles = data.vehicles.filter(function (x) { return x.id !== v.id; });
    if (prefs.vid === v.id) { prefs.vid = null; savePrefs(); }
    save();          // the merge drops the rows of a vehicle that is gone
    render();
    undoToast(t("toast.deleted"), function () {
      snap.m = Math.max(Date.now(), (data.tombs[v.id] || 0) + 1, snap.m + 1);
      data.vehicles.push(snap);
      C.LIST_KEYS.forEach(function (k) {
        kids[k].forEach(function (x) { if (!byId(k, x.id)) data[k].push(x); });
      });
      prefs.vid = v.id;
      savePrefs();
      save();
      render();
    });
  }

  // Budget bridge (BR-W8 shape): the Budget app opens its New Entry
  // form PREFILLED; nothing is written until the user saves there.
  // Offered only when the shell exposes the bridge.
  function budgetBridge() {
    try {
      var p = window.parent;
      return p && p !== window && typeof p.__orosOpenBudgetNew === "function" ? p.__orosOpenBudgetNew : null;
    } catch (e) { return null; }
  }
  function budgetWhat(list, row) {
    if (list === "fuel") return t(row.e === "e" ? "kind.charge" : "kind.fuel") + " " + fmtN(row.q / 1000, 2) + " " + uLabel(byId("vehicles", row.v), row.e);
    if (list === "service") return t("kind.service") + ": " + row.items.map(function (it) { return t("item." + it); }).join(", ");
    return t("cat." + row.cat);
  }
  function sendToBudget(list, row) {
    var open = budgetBridge();
    if (!open || !row || !(row.c > 0)) return;
    function go() {
      var v = byId("vehicles", row.v);
      try {
        open({
          kind: "out", date: row.d, amount: row.c, cat: "o-trans",
          note: t("budget.note", { vehicle: v ? v.name : "", what: budgetWhat(list, row) }).slice(0, 200)
        });
      } catch (e) { return; }
      var cur = byId(list, row.id);
      if (cur && !cur.bud) { cur.bud = 1; stamp(cur); save(); render(); }
      showToast(t("toast.sent"));
    }
    if (row.bud) confirmDialog(t("confirm.resend"), t("confirm.send"), false, go);
    else go();
  }

  // ---------- 4. Vehicle bar + Overview ----------
  function renderVbar() {
    var bar = $("vbar");
    bar.innerHTML = "";
    var list = sortedVehicles(liveVehicles());
    var cur = curVehicle();
    if (cur && cur.arch) list.push(cur);
    if (!data.vehicles.length) { bar.hidden = true; return; }
    bar.hidden = false;
    bar.setAttribute("aria-label", t("set.vehicles"));
    list.forEach(function (v) {
      var b = el("button", "vchip" + (cur && v.id === cur.id ? " on" : ""));
      b.type = "button";
      b.setAttribute("aria-pressed", cur && v.id === cur.id ? "true" : "false");
      var dot = el("span", "dot");
      dot.style.background = COLORS[v.col];
      b.appendChild(dot);
      b.appendChild(el("span", "", vIcon(v)));
      b.appendChild(el("span", "", v.name));
      b.addEventListener("click", function () { prefs.vid = v.id; savePrefs(); render(); });
      bar.appendChild(b);
    });
    var all = el("button", "icon-btn mini");
    all.type = "button";
    all.innerHTML = UI.list;
    all.setAttribute("aria-label", t("btn.vehicles"));
    all.title = t("btn.vehicles");
    all.addEventListener("click", vehiclesDialog);
    bar.appendChild(all);
  }

  function renderEmpty() {
    var box = $("empty");
    box.innerHTML = "";
    box.appendChild(el("div", "empty-ico", "🚗🏍️🚲"));
    box.appendChild(el("p", "", t("empty.first")));
    var b = el("button", "txt-btn primary", t("empty.first.btn"));
    b.type = "button";
    b.addEventListener("click", function () { vehicleEditor(null); });
    box.appendChild(b);
  }

  function section(title, onAdd) {
    var s = el("section", "sec");
    var h = el("div", "sec-head");
    h.appendChild(el("h2", "", title));
    if (onAdd) {
      var a = el("button", "link-btn", t("sec.add"));
      a.type = "button";
      a.setAttribute("aria-label", title + ": " + t("sec.add").replace("+ ", ""));
      a.addEventListener("click", onAdd);
      h.appendChild(a);
    }
    s.appendChild(h);
    return s;
  }
  // A row: icon, name, sub parts [{ text, cls }], value, action.
  function rowEl(o) {
    var li = el("li", "row" + (o.cls ? " " + o.cls : ""));
    var main = o.onOpen ? el("button", "row-btn") : el("div");
    if (o.onOpen) {
      main.type = "button";
      main.style.cssText = "display:flex;align-items:center;gap:10px;flex:1 1 auto;min-width:0;background:none;border:none;padding:0;color:inherit;font:inherit;";
      main.addEventListener("click", o.onOpen);
    } else main.style.cssText = "display:flex;align-items:center;gap:10px;flex:1 1 auto;min-width:0;";
    if (o.icon) main.appendChild(el("span", "r-ico", o.icon));
    var body = el("span", "r-body");
    body.style.display = "block";
    var nm = el("span", "r-name", o.name);
    nm.style.display = "block";
    body.appendChild(nm);
    if (o.sub && o.sub.length) {
      var sub = el("span", "r-sub");
      o.sub.forEach(function (p) { if (p && p.text) sub.appendChild(el("span", p.cls || "", p.text)); });
      body.appendChild(sub);
    }
    main.appendChild(body);
    if (o.value) {
      var val = el("span", "r-val", o.value);
      if (o.valueSub) val.appendChild(el("small", "", o.valueSub));
      main.appendChild(val);
    }
    li.appendChild(main);
    if (o.action) {
      var b = el("button", "act-btn", o.action.label);
      b.type = "button";
      if (o.action.aria) b.setAttribute("aria-label", o.action.aria);
      b.addEventListener("click", o.action.fn);
      li.appendChild(b);
    }
    return li;
  }

  function renewalSub(r) {
    var st = C.renewalStatus(r, todayYmd());
    var txt, cls = "";
    if (st.daysLeft < -1) { txt = t("exp.ago", { n: -st.daysLeft }); cls = "bad"; }
    else if (st.daysLeft === -1) { txt = t("exp.ago1"); cls = "bad"; }
    else if (st.daysLeft === 0) { txt = t("exp.today"); cls = "bad"; }
    else { txt = t("exp.in", { when: whenText(r.exp) }); cls = st.step !== null ? "warn" : ""; }
    return { st: st, parts: [{ text: txt, cls: cls }, { text: fmtDay(r.exp, true) }, { text: r.prov }] };
  }
  function planEvery(pl) {
    var parts = [];
    if (pl.km) parts.push(t("plan.km", { n: fmtKm(pl.km) }));
    if (pl.mo) parts.push(pl.mo === 1 ? t("plan.mo1") : t("plan.mo", { n: pl.mo }));
    return t("plan.every", { what: parts.join(t("plan.or")) });
  }
  function planSub(pl) {
    var st = C.planStatus(pl, data, todayYmd());
    var parts = [];
    var cls = st.level === "due" ? "bad" : (st.level === "soon" ? "warn" : "");
    if (st.leftKm !== null) parts.push({ text: st.leftKm >= 0 ? t("plan.left", { n: fmtKm(st.leftKm) }) : t("plan.over", { n: fmtKm(-st.leftKm) }), cls: cls });
    if (st.dueDate) parts.push({ text: t("plan.dueOn", { date: fmtDay(st.dueDate) }), cls: st.leftDays !== null && st.leftDays < 0 ? "bad" : (st.leftDays !== null && st.leftDays <= C.SOON_DAYS ? "warn" : "") });
    if (st.estDate && st.leftKm > 0 && st.estDate !== st.dueDate && (!st.dueDate || st.estDate < st.dueDate)) parts.push({ text: t("plan.est", { date: fmtDay(st.estDate) }) });
    if (st.dueKm === null && pl.km && !pl.mo) parts.push({ text: t("plan.unknown") });
    parts.push({ text: planEvery(pl) });
    return { st: st, parts: parts };
  }
  function tyreSub(ty) {
    var st = C.tyreStatus(ty, data, todayYmd(), prefs);
    var parts = [{ text: t("season." + ty.season) }];
    if (ty.on) parts.push({ text: t("tyre.mounted"), cls: "warn" });
    parts.push({ text: t("tyre.km", { n: fmtKm(st.km) }) });
    if (st.ageY !== null) parts.push({ text: t("tyre.age", { n: fmtN(st.ageY, 1) }) + (st.old ? " · " + t("tyre.old") : ""), cls: st.old ? "warn" : "" });
    if (ty.tread) parts.push({ text: t("tyre.tread", { n: fmtN(ty.tread / 10, 1) }) + (st.worn ? " · " + t("tyre.worn") : ""), cls: st.worn ? "bad" : "" });
    if (ty.size) parts.push({ text: ty.size });
    return { st: st, parts: parts };
  }

  function renderHome() {
    var box = $("view-home");
    box.innerHTML = "";
    var v = curVehicle();
    if (!v) return;
    var today = todayYmd();
    var km = C.currentKm(data, v.id);

    // Vehicle card
    var card = el("div", "vcard");
    card.style.setProperty("--vcol", COLORS[v.col]);
    card.appendChild(el("div", "v-ico", vIcon(v)));
    var body = el("div", "v-body");
    body.appendChild(el("div", "v-name", v.name));
    var sub = el("div", "v-sub");
    var desc = [v.make, v.model, v.year ? String(v.year) : ""].filter(Boolean).join(" ");
    sub.appendChild(el("span", "", desc || typeName(v.type)));
    if (v.fuel !== "none") sub.appendChild(el("span", "", t("fuel." + v.fuel)));
    if (v.plate) sub.appendChild(el("span", "plate", v.plate));
    body.appendChild(sub);
    body.appendChild(el("div", "v-km", km !== null ? t("v.km", { km: fmtKm(km) }) : t("v.noKm")));
    if (v.arch) body.appendChild(el("div", "archived-note", t("v.archived")));
    card.appendChild(body);
    var acts = el("div", "v-acts");
    var eb = el("button", "txt-btn", t("v.edit"));
    eb.type = "button";
    eb.addEventListener("click", function () { vehicleEditor(v); });
    acts.appendChild(eb);
    card.appendChild(acts);
    box.appendChild(card);

    // Quick add
    var quick = el("div", "quick");
    var qs = [];
    C.energies(v).forEach(function (e) { qs.push(e === "e" ? "charge" : "fuel"); });
    qs.push("service", "cost", "odo");
    if (qs.length > 4) quick.style.gridTemplateColumns = "repeat(" + qs.length + ", 1fr)";
    else quick.style.gridTemplateColumns = "repeat(" + qs.length + ", 1fr)";
    qs.forEach(function (q) {
      var b = el("button", "txt-btn");
      b.type = "button";
      b.appendChild(el("span", "q-ico", Q_ICON[q]));
      b.appendChild(el("span", "", t("q." + q)));
      b.addEventListener("click", function () { openNew(q); });
      quick.appendChild(b);
    });
    box.appendChild(quick);

    // Coming up: every alert of this vehicle, then the next items
    var al = C.alerts(data, today, prefs).filter(function (a) { return a.v === v.id; });
    var up = section(t("sec.next"));
    var ul = el("ul", "rows");
    var shown = {};
    al.forEach(function (a) {
      shown[a.id] = true;
      ul.appendChild(upcomingRow(a.type, a.id));
    });
    // fill to five with what comes next (renewals by date, plans by when)
    var next = [];
    rowsOf("renewals", v.id).forEach(function (r) { if (!shown[r.id]) next.push({ type: "renewal", id: r.id, when: r.exp }); });
    rowsOf("plans", v.id).forEach(function (p) {
      if (shown[p.id]) return;
      var st = C.planStatus(p, data, today);
      if (st.when) next.push({ type: "service", id: p.id, when: st.when });
    });
    next.sort(function (x, y) { return cmpStr(x.when, y.when); });
    next.slice(0, Math.max(0, 5 - al.length)).forEach(function (n) { ul.appendChild(upcomingRow(n.type, n.id)); });
    if (!ul.children.length) up.appendChild(el("p", "muted", t("next.none")));
    else up.appendChild(ul);
    box.appendChild(up);

    // Tiles
    var tiles = el("div", "tiles");
    C.energies(v).forEach(function (e) {
      var c = C.consumption(data, v.id, e);
      if (c.avg === null) return;
      tiles.appendChild(tile(t("tile.cons") + (C.energies(v).length > 1 ? " · " + uLabel(v, e) : ""), consText(v, e, c.avg),
        c.last !== null ? t("tile.consLast", { v: consText(v, e, c.last) }) : ""));
    });
    var mStart = today.slice(0, 7) + "-01";
    tiles.appendChild(tile(t("tile.month"), money(C.costs(data, v.id, mStart, today).total), fmtMonth(today.slice(0, 7))));
    var from12 = C.addMonths(today, -12);
    var cost12 = C.costs(data, v.id, from12, today).total;
    var dist12 = kmDriven(v.id, from12, today);
    if (dist12 > 0 && cost12 > 0) tiles.appendChild(tile(t("tile.perKm"), money(Math.round(cost12 / dist12)), t("tile.perKmSub")));
    var rate = C.kmPerDay(data, v.id, today);
    if (rate) tiles.appendChild(tile(t("tile.kmMonth"), fmtKm(Math.round(rate * 30.44)) + " km", t("tile.kmMonthSub")));
    box.appendChild(tiles);

    // Renewals
    var sr = section(t("sec.renewals"), function () { renewalEditor(null, v.id); });
    var rl = el("ul", "rows");
    rowsOf("renewals", v.id).sort(function (a, b) { return cmpStr(a.exp, b.exp); }).forEach(function (r) {
      rl.appendChild(renewalRow(r));
    });
    if (rl.children.length) sr.appendChild(rl);
    box.appendChild(sr);

    // Service plan
    var sp = section(t("sec.plans"), function () { planEditor(null, v.id); });
    var pl = el("ul", "rows");
    rowsOf("plans", v.id).map(function (p) { return { p: p, st: C.planStatus(p, data, today) }; })
      .sort(function (a, b) { return cmpStr(a.st.when || "9999", b.st.when || "9999") || cmpStr(a.p.item, b.p.item); })
      .forEach(function (x) { pl.appendChild(planRow(x.p)); });
    if (pl.children.length) sp.appendChild(pl);
    box.appendChild(sp);

    // Tyres
    var stz = section(t("sec.tyres"), function () { tyreEditor(null, v.id); });
    var tl = el("ul", "rows");
    rowsOf("tyres", v.id).sort(function (a, b) { return (b.on - a.on) || a.label.localeCompare(b.label, LOCALE); })
      .forEach(function (ty) { tl.appendChild(tyreRow(ty)); });
    if (tl.children.length) stz.appendChild(tl);
    box.appendChild(stz);

    if (v.notes) {
      var sn = section(t("sec.notes"));
      sn.appendChild(el("div", "notes", v.notes));
      box.appendChild(sn);
    }
  }

  function tile(label, value, sub) {
    var d = el("div", "tile");
    d.appendChild(el("div", "tile-lbl", label));
    d.appendChild(el("div", "tile-val", value));
    if (sub) d.appendChild(el("div", "tile-sub", sub));
    return d;
  }
  function kmDriven(vid, from, to) {
    var rs = C.readings(data, vid).filter(function (r) { return r.d >= from && r.d <= to; });
    if (rs.length < 2) return 0;
    var lo = Infinity, hi = -Infinity;
    rs.forEach(function (r) { lo = Math.min(lo, r.km); hi = Math.max(hi, r.km); });
    return hi - lo;
  }

  function upcomingRow(type, id) {
    if (type === "renewal") return renewalRow(byId("renewals", id));
    if (type === "service") return planRow(byId("plans", id));
    return tyreRow(byId("tyres", id));
  }
  function renewalRow(r) {
    var s = renewalSub(r);
    var lvl = s.st.daysLeft <= 0 ? "expired" : (s.st.step !== null ? "soon" : "ok");
    return rowEl({
      cls: "lvl-" + lvl, icon: R_ICON[r.kind], name: renName(r), sub: s.parts,
      onOpen: function () { renewalEditor(r, r.v); },
      action: { label: t("renewed"), aria: renName(r) + ": " + t("renewed"), fn: function () { renewDialog(r); } }
    });
  }
  function planRow(p) {
    var s = planSub(p);
    return rowEl({
      cls: "lvl-" + s.st.level, icon: "🔧", name: itemName(p.item, p), sub: s.parts,
      onOpen: function () { planEditor(p, p.v); },
      action: { label: t("serviced"), aria: itemName(p.item, p) + ": " + t("serviced"), fn: function () { serviceEditor(null, p.v, [p.item]); } }
    });
  }
  function tyreRow(ty) {
    var s = tyreSub(ty);
    var lvl = s.st.worn ? "worn" : (s.st.old ? "old" : "ok");
    return rowEl({
      cls: "lvl-" + lvl, icon: ty.season === "w" ? "❄️" : (ty.season === "a" ? "🌦️" : "☀️"),
      name: ty.label + (ty.brand ? " · " + ty.brand : ""), sub: s.parts,
      onOpen: function () { tyreEditor(ty, ty.v); },
      action: ty.on ? null : { label: t("mount"), aria: ty.label + ": " + t("mount"), fn: function () { mountDialog(ty); } }
    });
  }

  // ---------- 5. Log ----------
  function renderLog() {
    var v = curVehicle();
    if (!v) return;
    var fbox = $("log-filter");
    fbox.innerHTML = "";
    var kinds = ["all"];
    if (C.hasFuel(v) || rowsOf("fuel", v.id).length) kinds.push("fuel");
    kinds.push("service", "cost", "odo");
    if (kinds.indexOf(prefs.logF) < 0) prefs.logF = "all";
    kinds.forEach(function (k) {
      var b = el("button", "chip" + (prefs.logF === k ? " on" : ""), k === "all" ? t("log.all") : t("kind." + k));
      b.type = "button";
      b.setAttribute("aria-pressed", prefs.logF === k ? "true" : "false");
      b.addEventListener("click", function () { prefs.logF = k; savePrefs(); renderLog(); });
      fbox.appendChild(b);
    });

    var segs = {};
    C.energies(v).forEach(function (e) { C.consumption(data, v.id, e).segs.forEach(function (s) { segs[s.id] = s; }); });
    var items = [];
    function add(list, kind) {
      if (prefs.logF !== "all" && prefs.logF !== kind) return;
      rowsOf(list, v.id).forEach(function (x) { items.push({ list: list, kind: kind, x: x }); });
    }
    add("fuel", "fuel"); add("service", "service"); add("costs", "cost"); add("odo", "odo");
    items.sort(function (a, b) {
      return cmpStr(b.x.d, a.x.d) || ((b.x.km || 0) - (a.x.km || 0)) || cmpStr(b.x.id, a.x.id);
    });
    var box = $("log-list");
    box.innerHTML = "";
    if (!items.length) {
      box.appendChild(el("div", "empty", t(prefs.logF === "all" ? "log.empty" : "log.emptyF")));
      return;
    }
    var month = null, ul = null, sum = 0, sumEl = null;
    function close() { if (sumEl) sumEl.textContent = sum ? money(sum) : ""; }
    items.forEach(function (it) {
      var ym = it.x.d.slice(0, 7);
      if (ym !== month) {
        close();
        month = ym; sum = 0;
        var sec = el("section", "month");
        var h = el("div", "month-head");
        h.appendChild(el("h2", "", fmtMonth(ym)));
        sumEl = el("span", "sum");
        h.appendChild(sumEl);
        sec.appendChild(h);
        ul = el("ul", "rows");
        sec.appendChild(ul);
        box.appendChild(sec);
      }
      sum += it.x.c || 0;
      ul.appendChild(logRow(v, it, segs));
    });
    close();
  }

  function logRow(v, it, segs) {
    var x = it.x, o = { cls: "k-" + it.kind };
    var parts = [{ text: fmtDay(x.d) }];
    if (x.km !== null && x.km !== undefined) parts.push({ text: fmtKm(x.km) + " km" });
    if (it.list === "fuel") {
      var e = x.e;
      o.icon = Q_ICON[e === "e" ? "charge" : "fuel"];
      o.name = t(e === "e" ? "kind.charge" : "kind.fuel") + " · " + fmtN(x.q / 1000, 2) + " " + uLabel(v, e);
      parts.push({ text: x.mis ? t("log.missed") : (x.full ? t("log.full") : t("log.partial")) });
      if (segs[x.id]) parts.push({ text: consText(v, e, segs[x.id].per100), cls: "warn" });
      if (x.st) parts.push({ text: x.st });
      if (x.c && x.q) o.valueSub = money(Math.round(x.c * 1000 / x.q)) + "/" + uLabel(v, e);
      o.onOpen = function () { fuelEditor(x, v.id, e); };
    } else if (it.list === "service") {
      o.icon = Q_ICON.service;
      o.name = x.items.map(function (i) { return t("item." + i); }).join(", ");
      if (x.shop) parts.push({ text: x.shop });
      o.onOpen = function () { serviceEditor(x, v.id); };
    } else if (it.list === "costs") {
      o.icon = Q_ICON.cost;
      o.name = t("cat." + x.cat);
      if (x.n) parts.push({ text: x.n.split("\n")[0].slice(0, 60) });
      o.onOpen = function () { costEditor(x, v.id); };
    } else {
      o.icon = Q_ICON.odo;
      o.name = t("kind.odo");
      o.onOpen = function () { odoEditor(x, v.id); };
    }
    if (x.bud) parts.push({ text: t("log.sent") });
    o.sub = parts;
    if (x.c) o.value = money(x.c);
    return rowEl(o);
  }

  // ---------- 6. Stats + charts ----------
  function rangeFrom(today) {
    if (prefs.range === "12m") return C.addDays(C.addMonths(today, -12), 1);
    if (prefs.range === "year") return today.slice(0, 4) + "-01-01";
    return "1900-01-01";
  }
  function renderStats() {
    var v = curVehicle();
    if (!v) return;
    var rbox = $("stats-range");
    rbox.innerHTML = "";
    ["12m", "year", "all"].forEach(function (k) {
      var b = el("button", "chip" + (prefs.range === k ? " on" : ""), t("st." + k));
      b.type = "button";
      b.setAttribute("aria-pressed", prefs.range === k ? "true" : "false");
      b.addEventListener("click", function () { prefs.range = k; savePrefs(); renderStats(); });
      rbox.appendChild(b);
    });
    var box = $("stats-body");
    box.innerHTML = "";
    var today = todayYmd(), from = rangeFrom(today);
    var tot = C.costs(data, v.id, from, today);
    var dist = kmDriven(v.id, from, today);
    var any = tot.total > 0 || dist > 0;
    if (!any) { box.appendChild(el("div", "empty", t("st.none"))); return; }

    var tiles = el("div", "tiles");
    tiles.appendChild(tile(t("st.total"), money(tot.total)));
    if (dist > 0) tiles.appendChild(tile(t("st.km"), fmtKm(dist) + " km"));
    if (dist > 0 && tot.total > 0) tiles.appendChild(tile(t("st.perKm"), money(Math.round(tot.total / dist))));
    C.energies(v).forEach(function (e) {
      var segs = C.consumption(data, v.id, e).segs.filter(function (s) { return s.d >= from && s.d <= today; });
      var sd = 0, sq = 0;
      segs.forEach(function (s) { sd += s.dist; sq += s.q; });
      if (sd > 0) tiles.appendChild(tile(t("st.cons") + (C.energies(v).length > 1 ? " · " + uLabel(v, e) : ""), consText(v, e, sq / 10 / sd)));
      var fills = rowsOf("fuel", v.id).filter(function (x) { return x.e === e && x.c > 0 && x.d >= from && x.d <= today; });
      var fc = 0, fq = 0;
      fills.forEach(function (x) { fc += x.c; fq += x.q; });
      if (fq > 0) tiles.appendChild(tile(t("st.price") + " · " + uLabel(v, e), money(Math.round(fc * 1000 / fq))));
    });
    box.appendChild(tiles);

    // Costs per month (stacked: fuel, service, other)
    var months;
    if (prefs.range === "12m") months = 12;
    else if (prefs.range === "year") months = +today.slice(5, 7);
    else {
      var first = today;
      ["fuel", "service", "costs"].forEach(function (k) { rowsOf(k, v.id).forEach(function (x) { if (x.d < first) first = x.d; }); });
      months = (+today.slice(0, 4) - +first.slice(0, 4)) * 12 + (+today.slice(5, 7) - +first.slice(5, 7)) + 1;
      months = Math.max(1, Math.min(months, 120));
    }
    var mo = C.monthly(data, v.id, months, today);
    box.appendChild(costChart(mo));

    // Consumption and price lines
    C.energies(v).forEach(function (e) {
      var segs = C.consumption(data, v.id, e).segs.filter(function (s) { return s.d >= from && s.d <= today; });
      if (segs.length >= 2) {
        box.appendChild(lineChart(t("ch.cons") + (C.energies(v).length > 1 ? " · " + uLabel(v, e) : ""),
          t("ch.consSub", { unit: consUnit(v, e) }),
          segs.map(function (s) { return { d: s.d, y: consVal(e, s.per100), label: consText(v, e, s.per100) }; }), 1));
      }
      var fills = rowsOf("fuel", v.id).filter(function (x) { return x.e === e && x.c > 0 && x.d >= from && x.d <= today; })
        .sort(function (a, b) { return cmpStr(a.d, b.d) || (a.km - b.km); });
      if (fills.length >= 2) {
        box.appendChild(lineChart(t("ch.price", { u: uLabel(v, e) }), t("ch.priceSub"),
          fills.map(function (x) {
            var p = x.c * 1000 / x.q;
            return { d: x.d, y: p / 100, label: money(Math.round(p)) + "/" + uLabel(v, e) };
          }), 3));
      }
    });

    // Where the money goes (ranked)
    var cats = [{ k: "ch.fuel", c: tot.fuel }, { k: "ch.service", c: tot.service }];
    var byCat = {};
    rowsOf("costs", v.id).forEach(function (x) { if (x.d >= from && x.d <= today) byCat[x.cat] = (byCat[x.cat] || 0) + x.c; });
    Object.keys(byCat).forEach(function (k) { cats.push({ label: t("cat." + k), c: byCat[k] }); });
    cats = cats.filter(function (x) { return x.c > 0; }).sort(function (a, b) { return b.c - a.c; });
    if (cats.length) {
      var cb = el("div", "chart-box");
      cb.appendChild(el("h3", "", t("ch.byCat")));
      var ul = el("ul", "rows");
      ul.style.marginTop = "8px";
      cats.forEach(function (x) {
        var pct = tot.total ? Math.round(x.c * 100 / tot.total) : 0;
        var li = rowEl({ name: x.label || t(x.k), value: money(x.c), valueSub: pct + "%" });
        li.style.background = "linear-gradient(90deg, var(--accent-soft) " + pct + "%, transparent " + pct + "%)";
        ul.appendChild(li);
      });
      cb.appendChild(ul);
      box.appendChild(cb);
    }
  }

  var SVGNS = "http://www.w3.org/2000/svg";
  function svg(tag, attrs) {
    var n = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }
  // Axis ticks: a round step (1, 2, 2.5, 5 × 10ⁿ) and 3–5 ticks up to the top.
  function niceScale(lo, hi) {
    if (!(hi > lo)) hi = lo + 1;
    var raw = (hi - lo) / 4, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
    var step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
    var a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step;
    return { lo: a, hi: b, step: step, n: Math.round((b - a) / step) };
  }
  function decFor(step) { return step >= 1 ? 0 : (step >= 0.1 ? 1 : (step >= 0.01 ? 2 : 3)); }
  // Charts are drawn at the box's real width, so 11px text stays 11px.
  function chartW() { return Math.max(280, Math.min(840, ($("stats-body").clientWidth || 600) - 26)); }
  function showTip(boxEl, tipEl, x, y, html) {
    tipEl.innerHTML = "";
    html.forEach(function (n) { tipEl.appendChild(n); });
    tipEl.hidden = false;
    var bw = boxEl.clientWidth, tw = tipEl.offsetWidth;
    var left = Math.min(Math.max(4, x - tw / 2), bw - tw - 4);
    tipEl.style.left = left + "px";
    tipEl.style.top = Math.max(4, y - tipEl.offsetHeight - 10) + "px";
  }
  function tipLine(color, label, value) {
    var d = el("div");
    if (color) { var i = el("i"); i.style.background = color; d.appendChild(i); }
    d.appendChild(document.createTextNode(label + ": " + value));
    return d;
  }
  function seriesColor(name) {
    var cs = getComputedStyle(document.documentElement);
    return cs.getPropertyValue("--s-" + name).trim() || "#888";
  }

  function costChart(mo) {
    var box = el("div", "chart-box");
    box.appendChild(el("h3", "", t("ch.costs")));
    box.appendChild(el("div", "muted", t("ch.costsSub")));
    var SER = [["fuel", "ch.fuel"], ["service", "ch.service"], ["other", "ch.other"]];
    var leg = el("div", "legend");
    SER.forEach(function (s) {
      var sp = el("span");
      var i = el("i");
      i.style.background = "var(--s-" + s[0] + ")";
      sp.appendChild(i);
      sp.appendChild(document.createTextNode(t(s[1])));
      leg.appendChild(sp);
    });
    box.appendChild(leg);
    var W = chartW(), H = 200, L = 44, R = 6, T = 8, B = 22;
    var sc = niceScale(0, Math.max.apply(null, mo.map(function (m) { return m.fuel + m.service + m.other; })) / 100);
    var max = sc.hi;
    var s = svg("svg", { viewBox: "0 0 " + W + " " + H, width: W, height: H, class: "chart", role: "img", "aria-label": t("ch.costs") });
    for (var g = 0; g <= sc.n; g++) {
      var gy = T + (H - T - B) * (1 - g / sc.n);
      s.appendChild(svg("line", { x1: L, x2: W - R, y1: gy, y2: gy, class: "grid" }));
      var lab = svg("text", { x: L - 6, y: gy + 4, "text-anchor": "end", class: "axis" });
      lab.textContent = fmtN(sc.step * g, decFor(sc.step));
      s.appendChild(lab);
    }
    var n = mo.length, slot = (W - L - R) / n, bw = Math.max(2, Math.min(28, slot * 0.62));
    var tipEl = el("div", "tip");
    tipEl.hidden = true;
    var every = Math.ceil(n / Math.max(3, Math.floor((W - L - R) / 40)));
    mo.forEach(function (m, i) {
      var x = L + slot * i + (slot - bw) / 2, y = H - B;
      var stackTop = y;
      SER.forEach(function (sr) {
        var val = m[sr[0]] / 100;
        if (val <= 0) return;
        var h = (H - T - B) * val / max;
        var hh = Math.max(1, h - 2);            // 2px surface gap between segments
        stackTop = y - h;
        s.appendChild(svg("rect", { x: x, y: y - h + (y === H - B ? 0 : 0), width: bw, height: hh, rx: 2, fill: "var(--s-" + sr[0] + ")" }));
        y -= h;
      });
      if ((n - 1 - i) % every === 0) {           // the current month always has a label
        var tx = svg("text", { x: x + bw / 2, y: H - 6, "text-anchor": "middle", class: "axis" });
        tx.textContent = fmtMonth(m.ym, true);
        s.appendChild(tx);
      }
      var hit = svg("rect", { x: L + slot * i, y: T, width: slot, height: H - T - B, class: "hit" });
      hit.addEventListener("pointerenter", function (ev) { tipFor(ev); });
      hit.addEventListener("pointermove", function (ev) { tipFor(ev); });
      hit.addEventListener("pointerleave", function () { tipEl.hidden = true; });
      function tipFor() {
        var r = s.getBoundingClientRect(), br = box.getBoundingClientRect();
        var px = (L + slot * i + slot / 2) / W * r.width + r.left - br.left;
        var py = stackTop / H * r.height + r.top - br.top;
        var head = el("b", "", fmtMonth(m.ym));
        var lines = [head];
        SER.forEach(function (sr) { lines.push(tipLine(seriesColor(sr[0]), t(sr[1]), money(m[sr[0]]))); });
        lines.push(tipLine(null, t("ch.total"), money(m.fuel + m.service + m.other)));
        showTip(box, tipEl, px, py, lines);
      }
      s.appendChild(hit);
    });
    box.appendChild(s);
    box.appendChild(tipEl);
    // table view (identity never by colour alone; screen readers)
    var det = el("details", "table-view");
    det.appendChild(el("summary", "", t("ch.table")));
    var wrap = el("div", "tbl-wrap");
    var tb = el("table", "data");
    var hr = el("tr");
    [t("ch.month"), t("ch.fuel"), t("ch.service"), t("ch.other"), t("ch.total")].forEach(function (h) { hr.appendChild(el("th", "", h)); });
    var thead = el("thead"); thead.appendChild(hr); tb.appendChild(thead);
    var tbody = el("tbody");
    mo.slice().reverse().forEach(function (m) {
      var tr = el("tr");
      [fmtMonth(m.ym), money(m.fuel), money(m.service), money(m.other), money(m.fuel + m.service + m.other)]
        .forEach(function (c) { tr.appendChild(el("td", "", c)); });
      tbody.appendChild(tr);
    });
    tb.appendChild(tbody);
    wrap.appendChild(tb);
    det.appendChild(wrap);
    box.appendChild(det);
    return box;
  }

  // One series over time (x = days, so gaps keep their width).
  function lineChart(title, subtitle, pts, dec) {
    var box = el("div", "chart-box");
    box.appendChild(el("h3", "", title));
    box.appendChild(el("div", "muted", subtitle));
    var W = chartW(), H = 180, L = 44, R = 10, T = 10, B = 22;
    var ys = pts.map(function (p) { return p.y; });
    var lo = Math.min.apply(null, ys), hi = Math.max.apply(null, ys);
    var pad = (hi - lo) * 0.15 || hi * 0.1 || 1;
    var sc = niceScale(Math.max(0, lo - pad), hi + pad);
    lo = sc.lo; hi = sc.hi;
    var d0 = C.dayNum(pts[0].d), d1 = C.dayNum(pts[pts.length - 1].d);
    var span = Math.max(1, d1 - d0);
    function X(p) { return L + (W - L - R) * (C.dayNum(p.d) - d0) / span; }
    function Y(v) { return T + (H - T - B) * (1 - (v - lo) / (hi - lo)); }
    var s = svg("svg", { viewBox: "0 0 " + W + " " + H, width: W, height: H, class: "chart", role: "img", "aria-label": title });
    for (var g = 0; g <= sc.n; g++) {
      var v = lo + sc.step * g, gy = Y(v);
      s.appendChild(svg("line", { x1: L, x2: W - R, y1: gy, y2: gy, class: "grid" }));
      var lab = svg("text", { x: L - 6, y: gy + 4, "text-anchor": "end", class: "axis" });
      lab.textContent = fmtN(v, Math.max(decFor(sc.step), dec > 1 && sc.step < 0.1 ? 2 : 0));
      s.appendChild(lab);
    }
    [pts[0], pts[pts.length - 1]].forEach(function (p, i) {
      var tx = svg("text", { x: X(p), y: H - 6, "text-anchor": i ? "end" : "start", class: "axis" });
      tx.textContent = fmtDay(p.d, true);
      s.appendChild(tx);
    });
    s.appendChild(svg("polyline", { class: "line", points: pts.map(function (p) { return X(p).toFixed(1) + "," + Y(p.y).toFixed(1); }).join(" ") }));
    if (pts.length <= 40) pts.forEach(function (p) { s.appendChild(svg("circle", { cx: X(p), cy: Y(p.y), r: 4, class: "pt" })); });
    var cross = svg("line", { y1: T, y2: H - B, class: "cross", visibility: "hidden" });
    s.appendChild(cross);
    var tipEl = el("div", "tip");
    tipEl.hidden = true;
    var hit = svg("rect", { x: L, y: T, width: W - L - R, height: H - T - B, class: "hit" });
    function nearest(ev) {
      var r = s.getBoundingClientRect();
      var vx = (ev.clientX - r.left) / r.width * W, best = pts[0], bd = Infinity;
      pts.forEach(function (p) { var dd = Math.abs(X(p) - vx); if (dd < bd) { bd = dd; best = p; } });
      var br = box.getBoundingClientRect();
      cross.setAttribute("x1", X(best)); cross.setAttribute("x2", X(best));
      cross.setAttribute("visibility", "visible");
      showTip(box, tipEl, X(best) / W * r.width + r.left - br.left, Y(best.y) / H * r.height + r.top - br.top,
        [el("b", "", fmtDay(best.d, true)), el("div", "", best.label)]);
    }
    hit.addEventListener("pointermove", nearest);
    hit.addEventListener("pointerenter", nearest);
    hit.addEventListener("pointerleave", function () { tipEl.hidden = true; cross.setAttribute("visibility", "hidden"); });
    s.appendChild(hit);
    box.appendChild(s);
    box.appendChild(tipEl);
    var det = el("details", "table-view");
    det.appendChild(el("summary", "", t("ch.table")));
    var wrap = el("div", "tbl-wrap");
    var tb = el("table", "data");
    var thead = el("thead"), hr = el("tr");
    hr.appendChild(el("th", "", t("ch.date"))); hr.appendChild(el("th", "", title));
    thead.appendChild(hr); tb.appendChild(thead);
    var tbody = el("tbody");
    pts.slice().reverse().forEach(function (p) {
      var tr = el("tr");
      tr.appendChild(el("td", "", fmtDay(p.d, true)));
      tr.appendChild(el("td", "", p.label));
      tbody.appendChild(tr);
    });
    tb.appendChild(tbody);
    wrap.appendChild(tb);
    det.appendChild(wrap);
    box.appendChild(det);
    return box;
  }

  // ---------- 7. Editors ----------
  function field(label, input, id) {
    var w = el("div", "fld");
    var l = el("label", "dlg-lbl", label);
    if (id) { input.id = id; l.htmlFor = id; }
    w.appendChild(l);
    w.appendChild(input);
    return w;
  }
  function textInput(value, max, ph) {
    var i = el("input");
    i.type = "text";
    i.autocomplete = "off";
    if (max) i.maxLength = max;
    if (ph) i.placeholder = ph;
    i.value = value || "";
    return i;
  }
  // Numbers are typed as text (comma or dot), parsed by core.parseNum.
  function numInput(value, dec) {
    var i = el("input");
    i.type = "text";
    i.inputMode = dec ? "decimal" : "numeric";
    i.autocomplete = "off";
    i.value = value === null || value === undefined || value === "" ? "" : (dec ? fmtN(value, dec).replace(/[\s  ]/g, "") : String(value));
    return i;
  }
  function readNum(input) { return C.parseNum(input.value, LANG); }
  function readInt(input, lo, hi) {
    var n = readNum(input);
    if (n === null) return null;
    n = Math.round(n);
    return n >= lo && n <= hi ? n : null;
  }
  function readCents(input) {
    var n = readNum(input);
    if (n === null || n < 0) return null;
    var c = Math.round(n * 100);
    return c <= C.C_MAX ? c : null;
  }
  function dateInput(value, max) {
    var i = el("input");
    i.type = "date";
    i.value = value || todayYmd();
    if (max) i.max = max;
    return i;
  }
  function selectInput(options, value) {
    var s = el("select");
    options.forEach(function (o) {
      var op = el("option", "", o[1]);
      op.value = o[0];
      s.appendChild(op);
    });
    s.value = value;
    return s;
  }
  function textarea(value) {
    var a = el("textarea");
    a.maxLength = C.NOTES_LEN;
    a.rows = 2;
    a.value = value || "";
    return a;
  }
  function checkRow(label, checked) {
    var w = el("label", "check-row");
    var c = el("input");
    c.type = "checkbox";
    c.checked = !!checked;
    w.appendChild(c);
    w.appendChild(el("span", "", label));
    return { wrap: w, input: c };
  }
  function datalist(id, values) {
    var dl = el("datalist");
    dl.id = id;
    values.forEach(function (v) { var o = el("option"); o.value = v; dl.appendChild(o); });
    return dl;
  }
  function recent(list, key, vid) {
    var seen = {}, out = [];
    data[list].slice().sort(function (a, b) { return cmpStr(b.d, a.d); }).forEach(function (x) {
      if (vid && x.v !== vid) return;
      var s = x[key];
      if (s && !seen[s]) { seen[s] = true; out.push(s); }
    });
    return out.slice(0, 12);
  }
  // Highest km logged on or before the day, other than the row itself.
  function kmBefore(vid, d, exceptId) {
    var best = null;
    ["fuel", "service", "costs", "odo"].forEach(function (k) {
      rowsOf(k, vid).forEach(function (x) {
        if (x.id === exceptId || x.km === null || x.km === undefined || x.d > d) return;
        if (best === null || x.km > best) best = x.km;
      });
    });
    return best;
  }
  function kmHint(kmIn, dateIn, vid, exceptId) {
    var h = el("div", "hint warn");
    h.hidden = true;
    function check() {
      var k = readInt(kmIn, 0, C.KM_MAX), prev = kmBefore(vid, dateIn.value || todayYmd(), exceptId);
      if (k !== null && prev !== null && k < prev) { h.textContent = t("f.kmWarn", { km: fmtKm(prev) }); h.hidden = false; }
      else h.hidden = true;
    }
    kmIn.addEventListener("input", check);
    dateIn.addEventListener("change", check);
    check();
    return h;
  }
  function actions(dlg, onDelete, extra) {
    var acts = el("div", "dlg-actions");
    if (onDelete) acts.appendChild(button(t("ed.delete"), "danger", onDelete));
    (extra || []).forEach(function (b) { acts.appendChild(b); });
    acts.appendChild(button(t("ed.cancel"), "", function () { dlg.close(); }));
    var ok = button(t("ed.save"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    return acts;
  }
  function budgetButton(dlg, list, row) {
    if (!row || !(row.c > 0) || !budgetBridge()) return [];
    return [button(t("ed.budget"), "", function () { dlg.close(); sendToBudget(list, byId(list, row.id) || row); })];
  }
  function afterSave(res, list, row, what) {
    if (!res) return;
    save();
    render();
    if (res === "added") {
      live(t("live.added", { what: what }));
      if (row.c > 0 && budgetBridge()) {
        actionToast(t("toast.added"), t("toast.budget"), function () { sendToBudget(list, byId(list, row.id)); });
      } else showToast(t("toast.added"));
    } else showToast(t("toast.saved"));
  }

  function openNew(kind) {
    var v = curVehicle();
    if (!v) { vehicleEditor(null); return; }
    if (kind === "fuel") fuelEditor(null, v.id, "f");
    else if (kind === "charge") fuelEditor(null, v.id, "e");
    else if (kind === "service") serviceEditor(null, v.id);
    else if (kind === "cost") costEditor(null, v.id);
    else odoEditor(null, v.id);
  }
  function addMenu() {
    var v = curVehicle();
    if (!v) { vehicleEditor(null); return; }
    var dlg = makeDialog("gr-add");
    dlg.appendChild(el("div", "dlg-title", t("btn.addAria")));
    var list = el("div", "sheet-list");
    var qs = [];
    C.energies(v).forEach(function (e) { qs.push(e === "e" ? "charge" : "fuel"); });
    qs.push("service", "cost", "odo");
    qs.forEach(function (q) {
      list.appendChild(button(Q_ICON[q] + "  " + t("kind." + (q === "charge" ? "charge" : q)), "sheet-btn", function () { dlg.close(); openNew(q); }));
    });
    list.appendChild(button("🛡️  " + t("ed.renNew"), "sheet-btn", function () { dlg.close(); renewalEditor(null, v.id); }));
    list.appendChild(button("🔧  " + t("ed.planNew"), "sheet-btn", function () { dlg.close(); planEditor(null, v.id); }));
    list.appendChild(button("🛞  " + t("ed.tyreNew"), "sheet-btn", function () { dlg.close(); tyreEditor(null, v.id); }));
    list.appendChild(button("🚗  " + t("ed.vehicleNew"), "sheet-btn", function () { dlg.close(); vehicleEditor(null); }));
    dlg.appendChild(list);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("ed.cancel"), "", function () { dlg.close(); }));
    dlg.appendChild(acts);
    showDialog(dlg);
  }

  // ----- Vehicle -----
  function vehicleEditor(v) {
    if (!v && data.vehicles.length >= C.MAX_VEHICLES) { showToast(t("toast.max", { n: C.MAX_VEHICLES })); return; }
    var dlg = makeDialog("gr-veh", true);
    dlg.appendChild(el("div", "dlg-title", t(v ? "ed.vehicleEdit" : "ed.vehicleNew")));
    var form = el("form");
    form.noValidate = true;

    var type = v ? v.type : "car";
    var tw = el("div", "fld");
    tw.appendChild(el("div", "dlg-lbl", t("ed.type")));
    var grid = el("div", "types");
    grid.setAttribute("role", "radiogroup");
    grid.setAttribute("aria-label", t("ed.type"));
    C.TYPE_IDS.forEach(function (ty) {
      var b = el("button", "type-btn");
      b.type = "button";
      b.dataset.type = ty;
      b.setAttribute("role", "radio");
      b.appendChild(el("span", "", C.TYPES[ty].em));
      b.appendChild(el("span", "", typeName(ty)));
      b.addEventListener("click", function () { setType(ty); });
      grid.appendChild(b);
    });
    tw.appendChild(grid);
    form.appendChild(tw);

    var name = textInput(v ? v.name : "", C.NAME_LEN, t("ed.namePh"));
    form.appendChild(field(t("ed.name"), name, "gr-v-name"));
    var r1 = el("div", "fld-row");
    var make = textInput(v ? v.make : "", C.SHORT_LEN);
    var model = textInput(v ? v.model : "", C.SHORT_LEN);
    r1.appendChild(field(t("ed.make"), make, "gr-v-make"));
    r1.appendChild(field(t("ed.model"), model, "gr-v-model"));
    form.appendChild(r1);
    var r2 = el("div", "fld-row");
    var year = numInput(v && v.year ? v.year : "", 0);
    var plate = textInput(v ? v.plate : "", C.PLATE_LEN);
    plate.style.textTransform = "uppercase";
    r2.appendChild(field(t("ed.year"), year, "gr-v-year"));
    r2.appendChild(field(t("ed.plate"), plate, "gr-v-plate"));
    form.appendChild(r2);
    var r3 = el("div", "fld-row");
    var fuel = selectInput(C.FUEL_IDS.map(function (f) { return [f, t("fuel." + f)]; }), v ? v.fuel : C.TYPES[type].fuel);
    var fuelTouched = !!v;
    fuel.addEventListener("change", function () { fuelTouched = true; paintTank(); });
    var tank = numInput(v && v.tank ? v.tank : "", 0);
    var tankF = field("", tank, "gr-v-tank");
    r3.appendChild(field(t("ed.fuelType"), fuel, "gr-v-fuel"));
    r3.appendChild(tankF);
    form.appendChild(r3);
    function paintTank() {
      tankF.hidden = fuel.value === "none";
      tankF.firstChild.textContent = t("ed.tank", { u: fuel.value === "ev" ? t("u.kwh") : (fuel.value === "cng" ? t("u.kg") : t("u.l")) });
    }

    var col = v ? v.col : (data.vehicles.length % COLORS.length);
    var cw = el("div", "fld");
    cw.appendChild(el("div", "dlg-lbl", t("ed.color")));
    var cols = el("div", "colors");
    cols.setAttribute("role", "radiogroup");
    cols.setAttribute("aria-label", t("ed.color"));
    COLORS.forEach(function (c, i) {
      var b = el("button", "col-btn");
      b.type = "button";
      b.style.background = c;
      b.setAttribute("role", "radio");
      b.setAttribute("aria-label", t("ed.color") + " " + (i + 1));
      b.addEventListener("click", function () { col = i; paintCol(); });
      cols.appendChild(b);
    });
    function paintCol() {
      [].forEach.call(cols.children, function (b, i) {
        b.classList.toggle("on", i === col);
        b.setAttribute("aria-checked", i === col ? "true" : "false");
      });
    }
    cw.appendChild(cols);
    form.appendChild(cw);

    var startKm = null, plansChk = null;
    if (!v) {
      startKm = numInput("", 0);
      form.appendChild(field(t("ed.startKm"), startKm, "gr-v-km"));
      plansChk = checkRow(t("ed.plans"), true);
      form.appendChild(plansChk.wrap);
    }
    var notes = textarea(v ? v.notes : "");
    form.appendChild(field(t("f.notes"), notes, "gr-v-notes"));

    var lastTypeName = v ? "" : typeName(type);
    function setType(ty) {
      type = ty;
      [].forEach.call(grid.children, function (b) {
        var on = b.dataset.type === ty;
        b.classList.toggle("on", on);
        b.setAttribute("aria-checked", on ? "true" : "false");
      });
      if (!fuelTouched) fuel.value = C.TYPES[ty].fuel;
      if (!v && (!name.value.trim() || name.value.trim() === lastTypeName)) { name.value = typeName(ty); lastTypeName = name.value; }
      paintTank();
    }
    setType(type);
    paintCol();

    var extra = [];
    if (v) extra.push(button(t(v.arch ? "ed.unarchive" : "ed.archive"), "", function () {
      var cur = byId("vehicles", v.id);
      if (!cur) return;
      cur.arch = cur.arch ? 0 : 1;
      stamp(cur);
      save();
      dlg.close();
      render();
      showToast(t(cur.arch ? "toast.archived" : "toast.unarchived", { name: cur.name }));
    }));
    form.appendChild(actions(dlg, v ? function () {
      confirmDialog(t("confirm.delVehicle", { name: v.name }), t("confirm.yes"), true, function () { dlg.close(); deleteVehicle(v); });
    } : null, extra));

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var nm = C.cleanText(name.value, C.NAME_LEN, false);
      if (!nm) { showToast(t("toast.needName")); name.focus(); return; }
      var row = {
        id: v ? v.id : newId(), m: v ? v.m : 0, name: nm, type: type, fuel: fuel.value,
        make: C.cleanText(make.value, C.SHORT_LEN, false), model: C.cleanText(model.value, C.SHORT_LEN, false),
        year: readInt(year, 1900, 2200) || 0,
        plate: C.cleanText(plate.value.toUpperCase(), C.PLATE_LEN, false),
        tank: fuel.value === "none" ? 0 : (readInt(tank, 0, 999) || 0),
        col: col, arch: v ? v.arch : 0, notes: C.cleanText(notes.value, C.NOTES_LEN, true)
      };
      var res = upsert("vehicles", row);
      if (!v) {
        var today = todayYmd(), km0 = startKm ? readInt(startKm, 0, C.KM_MAX) : null;
        if (km0 !== null) data.odo.push({ id: newId(), m: Date.now(), v: row.id, d: today, km: km0 });
        if (plansChk && plansChk.input.checked) {
          C.defaultPlans(type, fuel.value).forEach(function (p) {
            data.plans.push({ id: newId(), m: Date.now(), v: row.id, item: p.item, km: p.km, mo: p.mo,
                              sd: today, skm: km0, label: "" });
          });
        }
        prefs.vid = row.id;
        prefs.tab = "home";
        savePrefs();
      }
      dlg.close();
      if (res) { save(); render(); showToast(t(res === "added" ? "toast.added" : "toast.saved")); }
    });
    dlg.appendChild(form);
    showDialog(dlg);
    if (!v) grid.querySelector(".on").focus(); else name.focus();
  }

  function vehiclesDialog() {
    var dlg = makeDialog("gr-vlist");
    dlg.appendChild(el("div", "dlg-title", t("set.vehicles")));
    var ul = el("ul", "rows");
    ul.style.marginBottom = "8px";
    sortedVehicles(liveVehicles()).concat(sortedVehicles(data.vehicles.filter(function (v) { return v.arch; }))).forEach(function (v) {
      var km = C.currentKm(data, v.id);
      ul.appendChild(rowEl({
        icon: vIcon(v), name: v.name,
        sub: [{ text: typeName(v.type) }, { text: v.plate }, { text: km !== null ? fmtKm(km) + " km" : "" }, { text: v.arch ? t("v.archived") : "", cls: "warn" }],
        onOpen: function () { prefs.vid = v.id; savePrefs(); dlg.close(); render(); }
      }));
    });
    dlg.appendChild(ul);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("set.addVehicle"), "", function () { dlg.close(); vehicleEditor(null); }));
    acts.appendChild(button(t("set.close"), "primary", function () { dlg.close(); }));
    dlg.appendChild(acts);
    showDialog(dlg);
  }

  // ----- Fuel / charging -----
  function fuelEditor(x, vid, energy) {
    var v = byId("vehicles", vid);
    if (!v) return;
    var e = x ? x.e : energy;
    var u = uLabel(v, e);
    var dlg = makeDialog("gr-fuel");
    dlg.appendChild(el("div", "dlg-title", (e === "e" ? Q_ICON.charge + " " + t("ed.charge") : Q_ICON.fuel + " " + t("ed.fuel")) + " · " + v.name));
    var form = el("form");
    form.noValidate = true;
    var r1 = el("div", "fld-row");
    var date = dateInput(x ? x.d : todayYmd(), todayYmd());
    var cur = C.currentKm(data, vid);
    var km = numInput(x ? x.km : "", 0);
    if (!x && cur !== null) km.placeholder = fmtKm(cur);
    r1.appendChild(field(t("f.date"), date, "gr-f-date"));
    r1.appendChild(field(t("f.km"), km, "gr-f-km"));
    form.appendChild(r1);
    form.appendChild(kmHint(km, date, vid, x && x.id));
    var r2 = el("div", "fld-row three");
    var qty = numInput(x ? x.q / 1000 : "", 2);
    var lastPrice = null;
    rowsOf("fuel", vid).filter(function (y) { return y.e === e && y.c > 0; })
      .sort(function (a, b) { return cmpStr(b.d, a.d); }).slice(0, 1)
      .forEach(function (y) { lastPrice = y.c * 10 / y.q; });   // per unit, in currency
    var price = numInput(x && x.c && x.q ? x.c * 10 / x.q : "", 3);
    if (!x && lastPrice) price.placeholder = fmtN(lastPrice, 3);
    var total = numInput(x && x.c ? x.c / 100 : "", 2);
    r2.appendChild(field(t("f.qty", { u: u }), qty, "gr-f-q"));
    r2.appendChild(field(t("f.price", { u: u }), price, "gr-f-p"));
    r2.appendChild(field(t("f.total", { c: curSym() }), total, "gr-f-t"));
    form.appendChild(r2);
    // two of three: the third follows the one you did not type last
    var edited = [];
    function touch(w) { edited = edited.filter(function (z) { return z !== w; }); edited.push(w); }
    function calc(w) {
      touch(w);
      var q = readNum(qty), p = readNum(price), tt = readNum(total);
      var other = ["q", "p", "t"].filter(function (z) { return edited.slice(-2).indexOf(z) < 0; })[0];
      if (edited.length < 2) other = w === "t" ? "p" : "t";
      if (other === "t" && q > 0 && p > 0) total.value = fmtN(q * p, 2).replace(/[\s  ]/g, "");
      else if (other === "p" && q > 0 && tt > 0) price.value = fmtN(tt / q, 3).replace(/[\s  ]/g, "");
      else if (other === "q" && p > 0 && tt > 0) qty.value = fmtN(tt / p, 2).replace(/[\s  ]/g, "");
    }
    qty.addEventListener("input", function () { calc("q"); });
    price.addEventListener("input", function () { calc("p"); });
    total.addEventListener("input", function () { calc("t"); });
    price.addEventListener("focus", function () { if (!price.value && price.placeholder && lastPrice) { price.value = price.placeholder.replace(/[\s  ]/g, ""); calc("p"); } });

    var full = checkRow(t(e === "e" ? "f.full.e" : "f.full"), x ? !!x.full : true);
    form.appendChild(full.wrap);
    var mis = checkRow(t("f.missed"), x ? !!x.mis : false);
    form.appendChild(mis.wrap);
    var st = textInput(x ? x.st : "", C.SHORT_LEN);
    st.setAttribute("list", "gr-stations");
    var stF = field(t("f.station"), st, "gr-f-st");
    stF.appendChild(datalist("gr-stations", recent("fuel", "st")));
    form.appendChild(stF);
    var notes = textarea(x ? x.n : "");
    form.appendChild(field(t("f.notes"), notes, "gr-f-n"));
    form.appendChild(actions(dlg, x ? function () { dlg.close(); removeRow("fuel", byId("fuel", x.id) || x); } : null, budgetButton(dlg, "fuel", x)));
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var k = readInt(km, 0, C.KM_MAX);
      if (k === null) { showToast(t("toast.needKm")); km.focus(); return; }
      var q = readNum(qty);
      if (!(q > 0) || Math.round(q * 1000) > C.Q_MAX) { showToast(t("toast.needQty")); qty.focus(); return; }
      if (!C.isYmd(date.value)) { showToast(t("toast.needDate")); date.focus(); return; }
      var c = readCents(total);
      if (c === null) { var p = readNum(price); c = p > 0 ? Math.round(p * q * 100) : 0; }
      var row = {
        id: x ? x.id : newId(), m: x ? x.m : 0, v: vid, d: date.value, km: k, q: Math.round(q * 1000), c: Math.min(c, C.C_MAX),
        e: e, full: full.input.checked ? 1 : 0, mis: mis.input.checked ? 1 : 0,
        st: C.cleanText(st.value, C.SHORT_LEN, false), n: C.cleanText(notes.value, C.NOTES_LEN, true), bud: x ? x.bud : 0
      };
      dlg.close();
      afterSave(upsert("fuel", row), "fuel", row, t(e === "e" ? "kind.charge" : "kind.fuel"));
    });
    dlg.appendChild(form);
    showDialog(dlg);
    (x ? qty : km).focus();
  }

  // ----- Service -----
  function serviceEditor(x, vid, preset) {
    var v = byId("vehicles", vid);
    if (!v) return;
    var dlg = makeDialog("gr-svc", true);
    dlg.appendChild(el("div", "dlg-title", Q_ICON.service + " " + t("ed.service") + " · " + v.name));
    var form = el("form");
    form.noValidate = true;
    var r1 = el("div", "fld-row");
    var date = dateInput(x ? x.d : todayYmd(), todayYmd());
    var km = numInput(x && x.km !== null ? x.km : "", 0);
    var cur = C.currentKm(data, vid);
    if (!x && cur !== null) km.placeholder = fmtKm(cur);
    r1.appendChild(field(t("f.date"), date, "gr-s-date"));
    r1.appendChild(field(t("f.kmOpt"), km, "gr-s-km"));
    form.appendChild(r1);
    form.appendChild(kmHint(km, date, vid, x && x.id));
    var picked = (x ? x.items : (preset || [])).slice();
    var iw = el("div", "fld");
    iw.appendChild(el("div", "dlg-lbl", t("f.items")));
    var chips = el("div", "checks");
    chips.setAttribute("role", "group");
    chips.setAttribute("aria-label", t("f.items"));
    var avail = C.itemsFor(v.type);
    picked.forEach(function (it) { if (avail.indexOf(it) < 0) avail.push(it); });
    avail.forEach(function (it) {
      var b = el("button", "chip", t("item." + it));
      b.type = "button";
      b.addEventListener("click", function () {
        var i = picked.indexOf(it);
        if (i >= 0) picked.splice(i, 1); else picked.push(it);
        paint();
      });
      b.dataset.item = it;
      chips.appendChild(b);
    });
    function paint() {
      [].forEach.call(chips.children, function (b) {
        var on = picked.indexOf(b.dataset.item) >= 0;
        b.classList.toggle("on", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      });
    }
    paint();
    iw.appendChild(chips);
    form.appendChild(iw);
    var r2 = el("div", "fld-row");
    var cost = numInput(x && x.c ? x.c / 100 : "", 2);
    var shop = textInput(x ? x.shop : "", C.SHORT_LEN);
    shop.setAttribute("list", "gr-shops");
    r2.appendChild(field(t("f.cost", { c: curSym() }), cost, "gr-s-c"));
    var shopF = field(t("f.shop"), shop, "gr-s-shop");
    shopF.appendChild(datalist("gr-shops", recent("service", "shop")));
    r2.appendChild(shopF);
    form.appendChild(r2);
    var notes = textarea(x ? x.n : "");
    form.appendChild(field(t("f.notes"), notes, "gr-s-n"));
    form.appendChild(actions(dlg, x ? function () { dlg.close(); removeRow("service", byId("service", x.id) || x); } : null, budgetButton(dlg, "service", x)));
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (!picked.length) { showToast(t("toast.needItems")); return; }
      if (!C.isYmd(date.value)) { showToast(t("toast.needDate")); date.focus(); return; }
      var k = km.value.trim() ? readInt(km, 0, C.KM_MAX) : null;
      if (km.value.trim() && k === null) { showToast(t("toast.needKm")); km.focus(); return; }
      var row = {
        id: x ? x.id : newId(), m: x ? x.m : 0, v: vid, d: date.value, km: k,
        items: C.ITEM_IDS.filter(function (it) { return picked.indexOf(it) >= 0; }),
        c: readCents(cost) || 0, shop: C.cleanText(shop.value, C.SHORT_LEN, false),
        n: C.cleanText(notes.value, C.NOTES_LEN, true), bud: x ? x.bud : 0
      };
      dlg.close();
      afterSave(upsert("service", row), "service", row, t("kind.service"));
    });
    dlg.appendChild(form);
    showDialog(dlg);
    date.focus();
  }

  // ----- Other cost -----
  function costEditor(x, vid, preset) {
    var v = byId("vehicles", vid);
    if (!v) return;
    var dlg = makeDialog("gr-cost");
    dlg.appendChild(el("div", "dlg-title", Q_ICON.cost + " " + t("ed.cost") + " · " + v.name));
    var form = el("form");
    form.noValidate = true;
    var r1 = el("div", "fld-row");
    var date = dateInput(x ? x.d : todayYmd());
    var cat = selectInput(C.COST_CATS.map(function (c) { return [c, t("cat." + c)]; }), x ? x.cat : (preset || "toll"));
    r1.appendChild(field(t("f.date"), date, "gr-c-date"));
    r1.appendChild(field(t("f.cat"), cat, "gr-c-cat"));
    form.appendChild(r1);
    var r2 = el("div", "fld-row");
    var amount = numInput(x ? x.c / 100 : "", 2);
    var km = numInput(x && x.km !== null ? x.km : "", 0);
    r2.appendChild(field(t("f.amount", { c: curSym() }), amount, "gr-c-a"));
    r2.appendChild(field(t("f.kmOpt"), km, "gr-c-km"));
    form.appendChild(r2);
    var notes = textarea(x ? x.n : "");
    form.appendChild(field(t("f.notes"), notes, "gr-c-n"));
    form.appendChild(actions(dlg, x ? function () { dlg.close(); removeRow("costs", byId("costs", x.id) || x); } : null, budgetButton(dlg, "costs", x)));
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var c = readCents(amount);
      if (!c) { showToast(t("toast.needAmount")); amount.focus(); return; }
      if (!C.isYmd(date.value)) { showToast(t("toast.needDate")); date.focus(); return; }
      var k = km.value.trim() ? readInt(km, 0, C.KM_MAX) : null;
      var row = { id: x ? x.id : newId(), m: x ? x.m : 0, v: vid, d: date.value, cat: cat.value, c: c, km: k,
                  n: C.cleanText(notes.value, C.NOTES_LEN, true), bud: x ? x.bud : 0 };
      dlg.close();
      afterSave(upsert("costs", row), "costs", row, t("cat." + cat.value));
    });
    dlg.appendChild(form);
    showDialog(dlg);
    amount.focus();
  }

  // ----- Km reading -----
  function odoEditor(x, vid) {
    var v = byId("vehicles", vid);
    if (!v) return;
    var dlg = makeDialog("gr-odo");
    dlg.appendChild(el("div", "dlg-title", Q_ICON.odo + " " + t("ed.odo") + " · " + v.name));
    var form = el("form");
    form.noValidate = true;
    var r1 = el("div", "fld-row");
    var date = dateInput(x ? x.d : todayYmd(), todayYmd());
    var km = numInput(x ? x.km : "", 0);
    var cur = C.currentKm(data, vid);
    if (!x && cur !== null) km.placeholder = fmtKm(cur);
    r1.appendChild(field(t("f.date"), date, "gr-o-date"));
    r1.appendChild(field(t("f.km"), km, "gr-o-km"));
    form.appendChild(r1);
    form.appendChild(kmHint(km, date, vid, x && x.id));
    form.appendChild(actions(dlg, x ? function () { dlg.close(); removeRow("odo", byId("odo", x.id) || x); } : null));
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var k = readInt(km, 0, C.KM_MAX);
      if (k === null) { showToast(t("toast.needKm")); km.focus(); return; }
      if (!C.isYmd(date.value)) { showToast(t("toast.needDate")); return; }
      var row = { id: x ? x.id : newId(), m: x ? x.m : 0, v: vid, d: date.value, km: k };
      dlg.close();
      afterSave(upsert("odo", row), "odo", row, t("kind.odo"));
    });
    dlg.appendChild(form);
    showDialog(dlg);
    km.focus();
  }

  // ----- Service plan -----
  function planEditor(p, vid) {
    var v = byId("vehicles", vid);
    if (!v) return;
    var dlg = makeDialog("gr-plan");
    dlg.appendChild(el("div", "dlg-title", t(p ? "ed.planEdit" : "ed.planNew") + " · " + v.name));
    var form = el("form");
    form.noValidate = true;
    var avail = C.itemsFor(v.type);
    if (p && avail.indexOf(p.item) < 0) avail.push(p.item);
    var item = selectInput(avail.map(function (it) { return [it, t("item." + it)]; }), p ? p.item : avail[0]);
    form.appendChild(field(t("ed.item"), item, "gr-p-item"));
    var label = textInput(p ? p.label : "", C.SHORT_LEN);
    var labelF = field(t("ed.label"), label, "gr-p-label");
    form.appendChild(labelF);
    var r1 = el("div", "fld-row");
    var everyKm = numInput(p ? p.km : C.ITEMS[item.value].km, 0);
    var everyMo = numInput(p ? p.mo : C.ITEMS[item.value].mo, 0);
    r1.appendChild(field(t("ed.everyKm"), everyKm, "gr-p-km"));
    r1.appendChild(field(t("ed.everyMo"), everyMo, "gr-p-mo"));
    form.appendChild(r1);
    form.appendChild(el("div", "hint", t("ed.planHint")));
    var r2 = el("div", "fld-row");
    var last = C.lastService(data, vid, item.value);
    var sd = dateInput(p ? p.sd : (last ? last.d : todayYmd()), todayYmd());
    var cur = C.currentKm(data, vid);
    var skm = numInput(p ? p.skm : (last && last.km !== null ? last.km : cur), 0);
    r2.appendChild(field(t("ed.from"), sd, "gr-p-sd"));
    r2.appendChild(field(t("ed.fromKm"), skm, "gr-p-skm"));
    form.appendChild(r2);
    var kmTouched = !!p, sdTouched = !!p;
    everyKm.addEventListener("input", function () { kmTouched = true; });
    everyMo.addEventListener("input", function () { kmTouched = true; });
    sd.addEventListener("change", function () { sdTouched = true; });
    skm.addEventListener("input", function () { sdTouched = true; });
    function paintLabel() { labelF.hidden = item.value !== "other"; }
    item.addEventListener("change", function () {
      paintLabel();
      if (!kmTouched) { everyKm.value = String(C.ITEMS[item.value].km); everyMo.value = String(C.ITEMS[item.value].mo); }
      if (!sdTouched) {
        var ls = C.lastService(data, vid, item.value);
        sd.value = ls ? ls.d : todayYmd();
        skm.value = ls && ls.km !== null ? String(ls.km) : (cur !== null ? String(cur) : "");
      }
    });
    paintLabel();
    form.appendChild(actions(dlg, p ? function () { dlg.close(); removeRow("plans", byId("plans", p.id) || p); } : null));
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var k = readInt(everyKm, 0, 1000000) || 0, mo = readInt(everyMo, 0, 240) || 0;
      if (!k && !mo) { showToast(t("toast.needEvery")); everyKm.focus(); return; }
      if (item.value === "other" && !C.cleanText(label.value, C.SHORT_LEN, false)) { showToast(t("toast.needLabel")); label.focus(); return; }
      if (!C.isYmd(sd.value)) { showToast(t("toast.needDate")); sd.focus(); return; }
      var row = { id: p ? p.id : newId(), m: p ? p.m : 0, v: vid, item: item.value, km: k, mo: mo, sd: sd.value,
                  skm: skm.value.trim() ? readInt(skm, 0, C.KM_MAX) : null,
                  label: item.value === "other" ? C.cleanText(label.value, C.SHORT_LEN, false) : "" };
      dlg.close();
      var res = upsert("plans", row);
      if (res) { save(); render(); showToast(t(res === "added" ? "toast.added" : "toast.saved")); }
    });
    dlg.appendChild(form);
    showDialog(dlg);
    item.focus();
  }

  // ----- Renewal -----
  function renewalEditor(r, vid) {
    var v = byId("vehicles", vid);
    if (!v) return;
    var dlg = makeDialog("gr-ren");
    dlg.appendChild(el("div", "dlg-title", t(r ? "ed.renEdit" : "ed.renNew") + " · " + v.name));
    var form = el("form");
    form.noValidate = true;
    var used = {};
    rowsOf("renewals", vid).forEach(function (x) { used[x.kind] = true; });
    var firstFree = C.RENEWAL_IDS.filter(function (k) { return !used[k]; })[0] || "other";
    if (!r && !C.TYPES[v.type].motor && firstFree === "kteo") firstFree = "ins";
    var kind = selectInput(C.RENEWAL_IDS.map(function (k) { return [k, t("ren." + k)]; }), r ? r.kind : firstFree);
    form.appendChild(field(t("ed.kind"), kind, "gr-r-kind"));
    var label = textInput(r ? r.label : "", C.SHORT_LEN);
    form.appendChild(field(t("ed.label"), label, "gr-r-label"));
    var r1 = el("div", "fld-row");
    var exp = dateInput(r ? r.exp : C.addMonths(todayYmd(), 1));
    var every = numInput(r ? r.every : C.RENEWALS[kind.value].every, 0);
    r1.appendChild(field(t("ed.exp"), exp, "gr-r-exp"));
    r1.appendChild(field(t("ed.every"), every, "gr-r-every"));
    form.appendChild(r1);
    var everyTouched = !!r;
    every.addEventListener("input", function () { everyTouched = true; });
    kind.addEventListener("change", function () { if (!everyTouched) every.value = String(C.RENEWALS[kind.value].every); });
    var r2 = el("div", "fld-row three");
    var cost = numInput(r && r.c ? r.c / 100 : "", 2);
    var prov = textInput(r ? r.prov : "", C.SHORT_LEN);
    var ref = textInput(r ? r.ref : "", C.SHORT_LEN);
    r2.appendChild(field(t("ed.expected", { c: curSym() }), cost, "gr-r-c"));
    r2.appendChild(field(t("ed.prov"), prov, "gr-r-prov"));
    r2.appendChild(field(t("ed.ref"), ref, "gr-r-ref"));
    form.appendChild(r2);
    var warn = (r ? r.warn : C.WARN_DEFAULT).slice();
    var ww = el("div", "fld");
    ww.appendChild(el("div", "dlg-lbl", t("ed.warn")));
    var chips = el("div", "checks");
    chips.setAttribute("role", "group");
    chips.setAttribute("aria-label", t("ed.warn"));
    WARN_STEPS.forEach(function (d) {
      var b = el("button", "chip", String(d));
      b.type = "button";
      b.addEventListener("click", function () {
        var i = warn.indexOf(d);
        if (i >= 0) warn.splice(i, 1); else warn.push(d);
        paintW();
      });
      b.dataset.d = d;
      chips.appendChild(b);
    });
    function paintW() {
      [].forEach.call(chips.children, function (b) {
        var on = warn.indexOf(+b.dataset.d) >= 0;
        b.classList.toggle("on", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      });
    }
    paintW();
    ww.appendChild(chips);
    form.appendChild(ww);
    var notes = textarea(r ? r.n : "");
    form.appendChild(field(t("f.notes"), notes, "gr-r-n"));
    form.appendChild(actions(dlg, r ? function () { dlg.close(); removeRow("renewals", byId("renewals", r.id) || r); } : null));
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (!C.isYmd(exp.value)) { showToast(t("toast.needDate")); exp.focus(); return; }
      if (kind.value === "other" && !C.cleanText(label.value, C.SHORT_LEN, false)) { showToast(t("toast.needLabel")); label.focus(); return; }
      var row = {
        id: r ? r.id : newId(), m: r ? r.m : 0, v: vid, kind: kind.value, exp: exp.value,
        every: readInt(every, 0, 240) || 0, label: C.cleanText(label.value, C.SHORT_LEN, false),
        c: readCents(cost) || 0, prov: C.cleanText(prov.value, C.SHORT_LEN, false),
        ref: C.cleanText(ref.value, C.SHORT_LEN, false),
        warn: warn.slice().sort(function (a, b) { return b - a; }), n: C.cleanText(notes.value, C.NOTES_LEN, true)
      };
      dlg.close();
      var res = upsert("renewals", row);
      if (res) { save(); render(); showToast(t(res === "added" ? "toast.added" : "toast.saved")); }
    });
    dlg.appendChild(form);
    showDialog(dlg);
    kind.focus();
  }

  // "Renewed": the cost (fixed id, one per expiry) + the new expiry.
  function renewDialog(r) {
    var dlg = makeDialog("gr-renew");
    dlg.appendChild(el("div", "dlg-title", t("ed.renew") + " · " + renName(r)));
    var form = el("form");
    form.noValidate = true;
    var k = C.renewal(r);
    var r1 = el("div", "fld-row");
    var paid = numInput(r.c ? r.c / 100 : "", 2);
    var on = dateInput(todayYmd());
    r1.appendChild(field(t("ed.paid", { c: curSym() }), paid, "gr-rn-c"));
    r1.appendChild(field(t("ed.paidOn"), on, "gr-rn-d"));
    form.appendChild(r1);
    var next = dateInput(k.next || "");
    if (!k.next) next.value = "";
    form.appendChild(field(t("ed.newExp"), next, "gr-rn-next"));
    form.appendChild(actions(dlg, null));
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (!C.isYmd(next.value)) { showToast(t("toast.needDate")); next.focus(); return; }
      if (!C.isYmd(on.value)) { showToast(t("toast.needDate")); on.focus(); return; }
      var c = readCents(paid) || 0;
      var cur = byId("renewals", r.id);
      if (!cur) { dlg.close(); return; }
      var snap = JSON.parse(JSON.stringify(cur));
      var costRow = null;
      if (c > 0) {
        costRow = { id: k.costId, m: Date.now(), v: r.v, d: on.value, cat: r.kind === "other" ? "other" : r.kind, c: c, km: null,
                    n: renName(r) + (r.prov ? " · " + r.prov : "") + " · " + fmtDay(r.exp, true) + " → " + fmtDay(next.value, true), bud: 0 };
        var had = byId("costs", k.costId);
        if (had) { Object.assign(had, costRow, { m: Math.max(Date.now(), had.m + 1), bud: had.bud }); costRow = had; }
        else {
          costRow.m = Math.max(Date.now(), (data.tombs[k.costId] || 0) + 1);
          data.costs.push(costRow);
        }
      }
      cur.exp = next.value;
      if (c > 0) cur.c = c;
      stamp(cur);
      save();
      dlg.close();
      render();
      var undo = function () {
        var now = byId("renewals", r.id);
        if (now) { Object.keys(snap).forEach(function (kk) { if (kk !== "m") now[kk] = snap[kk]; }); stamp(now); }
        if (costRow) data.tombs[costRow.id] = Math.max(Date.now(), costRow.m);
        save();
        render();
      };
      var msg = t("toast.renewed", { name: renName(r), date: fmtDay(next.value, true) });
      if (costRow && budgetBridge()) {
        actionToast(msg, t("toast.budget"), function () { sendToBudget("costs", byId("costs", costRow.id)); }, undo);
      } else undoToast(msg, undo);
    });
    dlg.appendChild(form);
    showDialog(dlg);
    paid.focus();
  }

  // ----- Tyres -----
  function tyreEditor(ty, vid) {
    var v = byId("vehicles", vid);
    if (!v) return;
    var dlg = makeDialog("gr-tyre");
    dlg.appendChild(el("div", "dlg-title", t(ty ? "ed.tyreEdit" : "ed.tyreNew") + " · " + v.name));
    var form = el("form");
    form.noValidate = true;
    var season = ty ? ty.season : "s";
    var label = textInput(ty ? ty.label : t("season.s"), C.SHORT_LEN);
    var labelAuto = !ty;
    label.addEventListener("input", function () { labelAuto = false; });
    form.appendChild(field(t("ed.label"), label, "gr-t-label"));
    var sw = el("div", "fld");
    sw.appendChild(el("div", "dlg-lbl", t("ed.season")));
    var seg = el("div", "seg");
    seg.setAttribute("role", "radiogroup");
    seg.setAttribute("aria-label", t("ed.season"));
    ["s", "w", "a"].forEach(function (s) {
      var b = el("button", "", t("season." + s));
      b.type = "button";
      b.dataset.s = s;
      b.setAttribute("role", "radio");
      b.addEventListener("click", function () { season = s; if (labelAuto) label.value = t("season." + s); paintS(); });
      seg.appendChild(b);
    });
    function paintS() {
      [].forEach.call(seg.children, function (b) {
        var on = b.dataset.s === season;
        b.classList.toggle("on", on);
        b.setAttribute("aria-checked", on ? "true" : "false");
      });
    }
    paintS();
    sw.appendChild(seg);
    form.appendChild(sw);
    var r1 = el("div", "fld-row");
    var size = textInput(ty ? ty.size : "", 24, "205/55 R16");
    var brand = textInput(ty ? ty.brand : "", C.SHORT_LEN);
    r1.appendChild(field(t("ed.size"), size, "gr-t-size"));
    r1.appendChild(field(t("ed.brand"), brand, "gr-t-brand"));
    form.appendChild(r1);
    var r2 = el("div", "fld-row three");
    var dot = textInput(ty ? ty.dot : "", 4, "0324");
    dot.inputMode = "numeric";
    var tread = numInput(ty && ty.tread ? ty.tread / 10 : "", 1);
    var kmRun = numInput(ty ? ty.km : 0, 0);
    r2.appendChild(field(t("ed.dot"), dot, "gr-t-dot"));
    r2.appendChild(field(t("ed.tread"), tread, "gr-t-tread"));
    r2.appendChild(field(t("ed.kmRun"), kmRun, "gr-t-km"));
    form.appendChild(r2);
    var mountChk = null, mountKm = null;
    if (!ty) {
      var hasMounted = rowsOf("tyres", vid).some(function (x) { return x.on; });
      mountChk = checkRow(t("ed.mountNow"), !hasMounted);
      form.appendChild(mountChk.wrap);
      mountKm = numInput(C.currentKm(data, vid), 0);
      var mf = field(t("ed.mountKm"), mountKm, "gr-t-mkm");
      form.appendChild(mf);
      mf.hidden = !mountChk.input.checked;
      mountChk.input.addEventListener("change", function () { mf.hidden = !mountChk.input.checked; });
    }
    var notes = textarea(ty ? ty.n : "");
    form.appendChild(field(t("f.notes"), notes, "gr-t-n"));
    form.appendChild(actions(dlg, ty ? function () { dlg.close(); removeRow("tyres", byId("tyres", ty.id) || ty); } : null));
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var lb = C.cleanText(label.value, C.SHORT_LEN, false);
      if (!lb) { showToast(t("toast.needLabel")); label.focus(); return; }
      var tr = readNum(tread);
      var row = {
        id: ty ? ty.id : newId(), m: ty ? ty.m : 0, v: vid, label: lb, season: season,
        size: C.cleanText(size.value, 24, false), brand: C.cleanText(brand.value, C.SHORT_LEN, false),
        dot: /^\d{4}$/.test(dot.value.trim()) ? dot.value.trim() : "",
        tread: tr !== null && tr >= 0 && tr <= 20 ? Math.round(tr * 10) : 0,
        km: readInt(kmRun, 0, C.KM_MAX) || 0,
        on: ty ? ty.on : 0, okm: ty ? ty.okm : null, n: C.cleanText(notes.value, C.NOTES_LEN, true)
      };
      dlg.close();
      var res = upsert("tyres", row);
      if (!ty && mountChk && mountChk.input.checked) {
        mountSet(byId("tyres", row.id), mountKm.value.trim() ? readInt(mountKm, 0, C.KM_MAX) : C.currentKm(data, vid));
        res = "added";
      }
      if (res) { save(); render(); showToast(t(res === "added" ? "toast.added" : "toast.saved")); }
    });
    dlg.appendChild(form);
    showDialog(dlg);
    label.focus();
  }

  // Mount a set at odometer km: the mounted one comes off and keeps
  // the km it ran (km += km now − km when mounted).
  function mountSet(ty, km) {
    rowsOf("tyres", ty.v).forEach(function (x) {
      if (!x.on || x.id === ty.id) return;
      if (x.okm !== null && km !== null && km > x.okm) x.km += km - x.okm;
      x.on = 0; x.okm = null;
      stamp(x);
    });
    ty.on = 1;
    ty.okm = km;
    stamp(ty);
  }
  function mountDialog(ty) {
    var dlg = makeDialog("gr-mount");
    dlg.appendChild(el("div", "dlg-title", t("ed.mountTitle", { name: ty.label })));
    var form = el("form");
    form.noValidate = true;
    var km = numInput(C.currentKm(data, ty.v), 0);
    form.appendChild(field(t("ed.odoNow"), km, "gr-m-km"));
    form.appendChild(actions(dlg, null));
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var k = km.value.trim() ? readInt(km, 0, C.KM_MAX) : null;
      if (km.value.trim() && k === null) { showToast(t("toast.needKm")); km.focus(); return; }
      var before = rowsOf("tyres", ty.v).map(function (x) { return JSON.parse(JSON.stringify(x)); });
      var cur = byId("tyres", ty.id);
      if (!cur) { dlg.close(); return; }
      if (k !== null && (C.currentKm(data, ty.v) === null || k > C.currentKm(data, ty.v))) {
        data.odo.push({ id: newId(), m: Date.now(), v: ty.v, d: todayYmd(), km: k });
      }
      mountSet(cur, k);
      save();
      dlg.close();
      render();
      undoToast(t("toast.mounted", { name: ty.label }), function () {
        before.forEach(function (b) {
          var x = byId("tyres", b.id);
          if (!x) return;
          Object.keys(b).forEach(function (kk) { if (kk !== "m") x[kk] = b[kk]; });
          stamp(x);
        });
        save();
        render();
      });
    });
    dlg.appendChild(form);
    showDialog(dlg);
    km.focus();
  }

  // ---------- 8. Settings, export / import ----------
  function settings() {
    var dlg = makeDialog("gr-set");
    dlg.appendChild(el("div", "dlg-title", t("set.title")));
    var r1 = el("div", "fld-row");
    var cur = selectInput(C.CURRENCIES.map(function (c) { return [c, c]; }), data.settings.cur);
    cur.addEventListener("change", function () {
      if (data.settings.cur === cur.value) return;
      data.settings = { m: Math.max(Date.now(), data.settings.m + 1), cur: cur.value };
      save();
      render();
    });
    var unit = selectInput([["l100", t("unit.l100")], ["kmpl", t("unit.kmpl")]], prefs.unit);
    unit.addEventListener("change", function () { prefs.unit = unit.value === "kmpl" ? "kmpl" : "l100"; savePrefsNow(); render(); });
    r1.appendChild(field(t("set.cur"), cur, "gr-set-cur"));
    r1.appendChild(field(t("set.unit"), unit, "gr-set-unit"));
    dlg.appendChild(r1);
    var rem = el("select");
    var off = el("option", "", t("set.off"));
    off.value = "-1";
    rem.appendChild(off);
    for (var h = 5; h <= 22; h++) {
      var o = el("option", "", (h < 10 ? "0" : "") + h + ":00");
      o.value = String(h);
      rem.appendChild(o);
    }
    rem.value = String(prefs.remind);
    if (rem.value !== String(prefs.remind)) {
      var ox = el("option", "", (prefs.remind < 10 ? "0" : "") + prefs.remind + ":00");
      ox.value = String(prefs.remind);
      rem.appendChild(ox);
      rem.value = String(prefs.remind);
    }
    rem.addEventListener("change", function () { prefs.remind = Number(rem.value); savePrefsNow(); });
    dlg.appendChild(field(t("set.remind"), rem, "gr-set-rem"));
    dlg.appendChild(el("p", "dlg-sub", t("set.remindHint")));
    var r2 = el("div", "fld-row");
    var age = numInput(prefs.tyreAge, 0);
    var tread = numInput(prefs.tyreTread / 10, 1);
    age.addEventListener("change", function () {
      var n = readInt(age, 1, 20);
      if (n !== null) { prefs.tyreAge = n; savePrefsNow(); render(); }
    });
    tread.addEventListener("change", function () {
      var n = readNum(tread);
      if (n !== null && n >= 0.5 && n <= 10) { prefs.tyreTread = Math.round(n * 10); savePrefsNow(); render(); }
    });
    r2.appendChild(field(t("set.tyreAge"), age, "gr-set-age"));
    r2.appendChild(field(t("set.tread"), tread, "gr-set-tread"));
    dlg.appendChild(r2);
    dlg.appendChild(el("div", "dlg-lbl", t("set.vehicles")));
    var va = el("div", "dlg-actions tight");
    va.appendChild(button(t("btn.vehicles"), "", function () { dlg.close(); vehiclesDialog(); }));
    va.appendChild(button(t("set.addVehicle"), "", function () { dlg.close(); vehicleEditor(null); }));
    dlg.appendChild(va);
    dlg.appendChild(el("div", "dlg-lbl", t("set.data")));
    var io = el("div", "dlg-actions tight");
    io.style.flexWrap = "wrap";
    io.appendChild(button(t("set.csv"), "", exportCsv));
    io.appendChild(button(t("set.json"), "", exportData));
    io.appendChild(button(t("set.import"), "", importData));
    dlg.appendChild(io);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("set.close"), "primary", function () { dlg.close(); }));
    dlg.appendChild(acts);
    showDialog(dlg);
  }

  function dialogHost() {
    if (window.orosDialog) return window.orosDialog;
    try { return window.parent.orosDialog || null; } catch (e) { return null; }
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
  function saveText(text, filename, mime, desc, ext) {
    var host = dialogHost();
    if (host && typeof host.saveFile === "function") {
      var types = [{ description: desc, accept: {} }];
      types[0].accept[mime] = [ext];
      host.saveFile({ text: text, filename: filename, mime: mime, types: types })
        .then(function (r) { if (r && r.ok) showToast(t("toast.exported")); });
      return;
    }
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: mime }));
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 40000);
    showToast(t("toast.exported"));
  }
  function exportData() {
    var payload = { app: "oros-garage", ver: C.DATA_VER, exported: new Date().toISOString(), data: canonical(data) };
    saveText(JSON.stringify(payload, null, 2), "orOS-garage-" + todayYmd() + ".json", "application/json", "JSON", ".json");
  }
  function exportCsv() {
    var names = { fuel: t("kind.fuel"), charge: t("kind.charge"), service: t("kind.service"), cost: t("kind.cost"), odo: t("kind.odo") };
    C.ITEM_IDS.forEach(function (it) { names[it] = t("item." + it); });
    C.COST_CATS.forEach(function (c) { names[c] = t("cat." + c); });
    var sep = LANG === "el" ? ";" : ",";
    var head = LANG === "el"
      ? ["Ημερομηνία", "Όχημα", "Είδος", "Λεπτομέρειες", "Km", "Ποσότητα", "Κόστος (" + data.settings.cur + ")", "Σημειώσεις"]
      : ["Date", "Vehicle", "Kind", "Details", "Km", "Quantity", "Cost (" + data.settings.cur + ")", "Notes"];
    var lines = [head.map(C.csvCell).join(sep)];
    C.csvRows(data, names).forEach(function (r) {
      lines.push(r.map(function (v) {
        if (typeof v === "number" && LANG === "el") return String(v).replace(".", ",");
        return C.csvCell(v);
      }).join(sep));
    });
    saveText("﻿" + lines.join("\r\n") + "\r\n", "orOS-garage-" + todayYmd() + ".csv", "text/csv", "CSV", ".csv");
  }
  // A restore is a merge, never an overwrite (App-level import rule).
  function importData() {
    var host = dialogHost();
    var pick = host && typeof host.openFile === "function" ? host.openFile(".json,application/json") : localPickFile(".json,application/json");
    Promise.resolve(pick).then(function (file) {
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) { showToast(t("toast.badFile")); return; }
      return file.text().then(function (txt) {
        var parsed = null;
        try { parsed = JSON.parse(txt); } catch (e) {}
        var incoming = parsed && parsed.app === "oros-garage" ? parsed.data : parsed;
        if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.vehicles)) { showToast(t("toast.badFile")); return; }
        var clean = C.merge(incoming, null);
        data = C.merge(data, clean);
        save();
        render();
        showToast(t("toast.imported", { n: clean.vehicles.length }));
      });
    }).catch(function () { showToast(t("toast.badFile")); });
  }

  // ---------- 9. Dialogs + toasts ----------
  function button(label, cls, fn) {
    var b = el("button", "dlg-btn" + (cls ? " " + cls : ""), label);
    b.type = "button";
    if (fn) b.addEventListener("click", fn);
    return b;
  }
  function makeDialog(id, wide) {
    var stale = document.getElementById(id);
    if (stale) { try { stale.close(); } catch (e) {} stale.remove(); }
    var dlg = document.createElement("dialog");
    dlg.id = id;
    dlg.className = "pc-dlg" + (wide ? " wide" : "");
    dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener("close", function () {
      parkToast();
      setTimeout(function () { dlg.remove(); }, 0);
    });
    return dlg;
  }
  function showDialog(dlg) {
    document.body.appendChild(dlg);
    dlg.showModal();
  }
  function confirmDialog(msg, yes, danger, onYes) {
    var dlg = makeDialog("gr-confirm");
    dlg.appendChild(el("p", "confirm-msg", msg));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("ed.cancel"), "", function () { dlg.close(); }));
    acts.appendChild(button(yes, danger ? "danger-fill" : "primary", function () { dlg.close(); onYes(); }));
    dlg.appendChild(acts);
    showDialog(dlg);
    acts.lastChild.focus();
  }

  function showToast(text) {
    try {
      var n = (window.parent && window.parent !== window && window.parent.orosNotifs) || null;
      if (n && typeof n.transient === "function" &&
          n.transient({ ns: "garage", title: String(text) })) return;
    } catch (e) {}
    localToast(text, null);
  }
  // Undo / action toasts stay local (the closure never leaves the frame), 8 s.
  function undoToast(text, onUndo) { localToast(text, [[t("toast.undo"), onUndo]]); }
  function actionToast(text, label, fn, onUndo) {
    var acts = [[label, fn]];
    if (onUndo) acts.push([t("toast.undo"), onUndo]);
    localToast(text, acts);
  }

  var toastTimer = null;
  function localToast(text, acts) {
    var box = $("toast");
    if (!box) return;
    hostToast();
    box.innerHTML = "";
    box.classList.remove("show");
    box.appendChild(el("span", "", text));
    (acts || []).forEach(function (a) {
      var b = el("button", "", a[0]);
      b.type = "button";
      b.addEventListener("click", function () {
        box.classList.remove("show");
        clearTimeout(toastTimer);
        a[1]();
      }, { once: true });
      box.appendChild(b);
    });
    void box.offsetWidth;
    box.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.classList.remove("show"); box.innerHTML = ""; }, acts && acts.length ? 8000 : 4000);
  }
  function hostToast() {
    var box = $("toast"), d = document.querySelector("dialog[open]");
    if (box && d && box.parentNode !== d) d.appendChild(box);
  }
  function parkToast() {
    var box = $("toast");
    if (box && box.parentNode !== document.body) document.body.appendChild(box);
  }
  function live(msg) {
    var n = $("live");
    if (!n) return;
    n.textContent = "";
    setTimeout(function () { n.textContent = msg; }, 30);
  }

  // ---------- 10. Keyboard (Contract Β) + deep link ----------
  function wireKeyboard() {
    document.addEventListener("keydown", function (e) {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || !e.shiftKey) return;
      var p = null;
      try { p = window.parent; } catch (err) { return; }
      if (!(p && p !== window && p.orosShortcuts &&
            typeof p.orosShortcuts.handle === "function")) return;
      if (p.orosShortcuts.handle(e)) e.stopPropagation();
    }, true);
  }

  // "upcoming" → Overview; a vehicle id → that vehicle; a renewal,
  // plan or tyre id → its vehicle's Overview + its editor. Called
  // live by the shell (__orosOpenGarage) or from the staged key.
  window.__orosGarageOpen = function (target) {
    if (typeof target !== "string" || !target) return;
    if (target === "upcoming" || target === "home") { setTab("home"); return; }
    if (!C.ID_RE.test(target)) return;
    if (byId("vehicles", target)) { prefs.vid = target; setTab("home"); return; }
    var map = [["renewals", renewalEditor], ["plans", planEditor], ["tyres", tyreEditor]];
    for (var i = 0; i < map.length; i++) {
      var row = byId(map[i][0], target);
      if (row) { prefs.vid = row.v; setTab("home"); map[i][1](row, row.v); return; }
    }
  };
  function takeStaged() {
    var v = null;
    try {
      v = sessionStorage.getItem(OPEN_KEY);
      if (v) sessionStorage.removeItem(OPEN_KEY);
    } catch (e) {}
    if (v) window.__orosGarageOpen(v);
  }

  // ---------- 11. Sync slice + palette ----------
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
      new MutationObserver(function () { inheritPalette(); if (prefs.tab === "stats") renderStats(); }).observe(
        window.parent.document.documentElement,
        { attributes: true, attributeFilter: ["data-skin", "data-theme"] }
      );
    } catch (e) { /* standalone */ }
  }

  function syncApi() {
    try { return (window.parent && window.parent.orosSync) || window.orosSync || null; }
    catch (e) { return window.orosSync || null; }
  }
  function mergeFn(a, b) { return C.merge(a, b); }

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
    api.registerSlice("garage", sliceGet, sliceSet, STORAGE_KEY, mergeFn);
  }

  function sliceGet() { return canonical(data); }   // canonical copy (R26)

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.vehicles)) return;
    var before = JSON.stringify(data);
    window.__orosSyncApi._suppress = true;   // R6: a pull never marks dirty
    try {
      data = canonical(incoming);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
    } finally {
      window.__orosSyncApi._suppress = false;
    }
    if (JSON.stringify(data) === before) return;   // no toast (sync feedback = taskbar dot)
    render();
  }

  // ---------- 12. Wiring & boot ----------
  var TABS = ["home", "log", "stats"];
  function setTab(tab) {
    prefs.tab = TABS.indexOf(tab) >= 0 ? tab : "home";
    savePrefs();
    render();
  }

  var renderedDay = null;
  function render() {
    renderedDay = todayYmd();
    var has = data.vehicles.length > 0;
    curVehicle();
    $("empty").hidden = has;
    $("toolbar").querySelector(".tabs").hidden = !has;
    renderVbar();
    TABS.forEach(function (v) {
      var on = has && v === prefs.tab;
      $("view-" + v).hidden = !on;
      var b = $("tab-" + v);
      b.classList.toggle("on", v === prefs.tab);
      b.setAttribute("aria-selected", v === prefs.tab ? "true" : "false");
      b.tabIndex = v === prefs.tab ? 0 : -1;
    });
    if (!has) { renderEmpty(); return; }
    if (prefs.tab === "home") renderHome();
    else if (prefs.tab === "log") renderLog();
    else renderStats();
  }

  function applyI18n() {
    TABS.forEach(function (v) { $("tab-" + v).textContent = t("tab." + v); });
    var sb = $("settings-btn");
    sb.innerHTML = UI.gear;
    sb.setAttribute("aria-label", t("btn.settings"));
    sb.title = t("btn.settings");
    var ab = $("add-btn");
    ab.innerHTML = UI.plus + "<span></span>";
    ab.lastChild.textContent = t("btn.add");
    ab.setAttribute("aria-label", t("btn.addAria"));
    ab.title = t("btn.addAria");
    document.title = t("app") + " · orOS";
  }

  function wire() {
    TABS.forEach(function (v) { $("tab-" + v).addEventListener("click", function () { setTab(v); }); });
    $("toolbar").querySelector(".tabs").addEventListener("keydown", function (e) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      var i = TABS.indexOf(prefs.tab) + (e.key === "ArrowRight" ? 1 : -1);
      setTab(TABS[(i + TABS.length) % TABS.length]);
      $("tab-" + prefs.tab).focus();
    });
    $("add-btn").addEventListener("click", addMenu);
    $("settings-btn").addEventListener("click", settings);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") savePrefsNow();
      else if (renderedDay !== todayYmd()) render();
    });
    setInterval(function () {
      if (document.visibilityState !== "hidden" && renderedDay !== todayYmd()) render();
    }, 60000);
    window.addEventListener("pagehide", savePrefsNow);
    wireKeyboard();
  }

  function boot() {
    if (!C) { document.body.textContent = "Garage: core.js missing"; return; }
    load();
    loadPrefs();
    applyI18n();
    wire();
    registerSync();
    inheritPalette();
    watchPalette();
    render();
    takeStaged();
  }

  boot();
})();
