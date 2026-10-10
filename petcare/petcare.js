// ============================================================
// orOS Pet Health Book — App logic (v1.0.0)
// The health book of your real animals (not Pet World):
//   - "Upcoming": late, today, the next 30 days for every pet:
//     vaccines, deworming, rechecks, the end of a course of
//     medicine, routine care, food running out; birthdays banner
//   - one page per pet: overview (next dates, profile, vet with a
//     call button, routine care), health book (vaccines,
//     deworming, visits, medicine), weight chart, food + stock
//   - printable card for the vet or a trip (window.print)
//   - daily reminder from the shell engine (petcareCheckTick) and
//     a Calendar feed; both use core.js, like this app
// Data:
//   - synced slice "petcare" (oros-petcare-data): pets + records
//     LWW, tombstones; merge = OrosPetcareCore.merge (R5, R26)
//   - device-local (R10): oros-petcare-prefs (reminder hour, days
//     of warning, tab, open pet, sub-tab, record filter)
// Sections:
//   1. Constants, i18n, helpers
//   2. Storage + prefs
//   3. Mutations (Undo)
//   4. Upcoming view
//   5. Pets view
//   6. One pet: overview, health, weight, food
//   7. Editors: pet, record, food, new bag
//   8. Photos, print card
//   9. Settings, export / import
//  10. Dialogs + toasts
//  11. Keyboard (Contract Β) + deep link
//  12. Sync slice + palette
//  13. Wiring & boot
// ============================================================
(function () {
  "use strict";

  var C = window.OrosPetcareCore;
  var STORAGE_KEY = "oros-petcare-data";
  var PREFS_KEY   = "oros-petcare-prefs";
  var OPEN_KEY    = "oros-petcare-open";
  var HORIZON     = 30;
  var SMALL       = { bird: 1, rodent: 1, fish: 1, reptile: 1 };   // weighed in grams
  var KIND_COLOR  = { vacc: "#4dabf7", deworm: "#8bc34a", visit: "#f29e4c", med: "#e06c75",
                      weight: "#a78bfa", care: "#2ec4b6", food: "#c8a96e" };
  var SUBS = ["info", "health", "weight", "food"];
  var FILTERS = ["all", "vacc", "deworm", "visit", "med", "care"];

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
      "app": "Pet Health Book",
      "tab.up": "Upcoming", "tab.pets": "My pets", "btn.add": "Pet", "btn.addAria": "Add a pet",
      "btn.settings": "Settings", "btn.back": "Back to my pets",
      "grp.late": "Late", "grp.today": "Today", "grp.soon": "Next 30 days", "grp.gone": "In memory",
      "due.today": "today", "due.tomorrow": "tomorrow", "due.in": "in {n} days",
      "due.late1": "1 day late", "due.late": "{n} days late",
      "kind.vacc": "Vaccine", "kind.deworm": "Deworming", "kind.visit": "Vet visit", "kind.med": "Medicine",
      "kind.weight": "Weight", "kind.care": "Care", "kind.food": "Food",
      "dw.int": "Internal deworming", "dw.ext": "External parasites", "dw.both": "Internal + external deworming",
      "dwS.int": "Internal", "dwS.ext": "External", "dwS.both": "Both",
      "care.bath": "Bath", "care.nails": "Nail trim", "care.brush": "Brushing / grooming", "care.teeth": "Teeth",
      "care.ears": "Ear cleaning", "care.litter": "Litter change", "care.cage": "Cage cleaning", "care.tank": "Tank water change",
      "item.recheck": "Recheck", "item.medEnd": "{name}: last day", "item.food": "Food runs out",
      "act.log": "Log", "act.done": "Done", "act.bag": "New bag", "act.open": "Open {name}",
      "act.logAria": "Log {what} for {name}", "act.doneAria": "{what} for {name}: done",
      "empty.first": "No pets yet. Add your first one and orOS will keep its health book and remind you of vaccines, deworming and vet visits.",
      "empty.first.btn": "Add a pet",
      "empty.calm": "All good. Nothing is due in the next 30 days.",
      "bday": "🎂 Happy birthday, {name}! {n} today.",
      "card.next": "Next: {what} {when}", "card.nothing": "Nothing scheduled",
      "age.y": "{n} y", "age.ym": "{y} y {m} m", "age.m": "{n} months", "age.new": "newborn", "age.approx": "about {age}",
      "sub.info": "Overview", "sub.health": "Health book", "sub.weight": "Weight", "sub.food": "Food",
      "ph.edit": "Edit", "ph.print": "Print card", "ph.delete": "Delete",
      "sec.next": "Next", "sec.profile": "Profile", "sec.vet": "Vet", "sec.care": "Routine care", "sec.notes": "Notes",
      "next.none": "Nothing scheduled. Log a vaccine or deworming with a next date and it shows up here.",
      "f.species": "Species", "f.breed": "Breed", "f.sex": "Sex", "f.birth": "Born", "f.age": "Age",
      "f.color": "Colour / markings", "f.chip": "Microchip", "f.pass": "Passport no.", "f.ins": "Insurance",
      "f.alg": "Allergies", "f.weight": "Ideal weight", "f.gone": "In memory since",
      "sex.f": "Female", "sex.m": "Male", "sex.none": "—", "neut.f": "spayed", "neut.m": "neutered",
      "vet.call": "Call", "vet.emerg": "Emergency", "vet.none": "No vet saved yet. Add one with Edit.",
      "care.every": "every {n} days", "care.none": "No routine care set. Turn some on with Edit (bath, nails, litter…).",
      "h.cost": "Vet costs in {y}: {sum}",
      "h.add.vacc": "Vaccine", "h.add.deworm": "Deworming", "h.add.visit": "Visit", "h.add.med": "Medicine",
      "flt.all": "All", "flt.vacc": "Vaccines", "flt.deworm": "Deworming", "flt.visit": "Visits", "flt.med": "Medicine", "flt.care": "Care",
      "h.empty": "Nothing in the health book yet.",
      "r.next": "next {d}", "r.recheck": "recheck {d}", "r.until": "until {d}", "r.batch": "batch {b}", "r.cost": "{sum}",
      "w.add": "Weight", "w.empty": "No weights yet. Weigh your pet now and then to follow its health.",
      "w.delta": "{sign}{v} in the last 30+ days", "w.range": "Ideal: {min} – {max}", "w.out": "outside the ideal range",
      "fd.none": "No food saved yet.", "fd.edit": "Edit food", "fd.bag": "New bag opened",
      "fd.daily": "{g} a day", "fd.meals": "{n} meals", "fd.bagInfo": "Bag of {b}, opened {d}",
      "fd.out": "Runs out around {d} ({when})", "fd.hist": "Food history", "fd.histEmpty": "No food changes logged.",
      "fd.change": "Started: {n}",
      "ed.addTitle": "New pet", "ed.editTitle": "Edit pet", "ed.name": "Name", "ed.photo": "Photo",
      "ed.photoAdd": "Choose photo", "ed.photoDel": "Remove photo", "ed.species": "Species", "ed.breed": "Breed",
      "ed.sex": "Sex", "ed.neut": "Spayed / neutered", "ed.birth": "Date of birth", "ed.approx": "I only know it roughly",
      "ed.year": "Year", "ed.month": "Month", "ed.monthAny": "—", "ed.color": "Colour / markings",
      "ed.ids": "Microchip, passport, insurance", "ed.chip": "Microchip number", "ed.pass": "Passport number",
      "ed.ins": "Insurance (company, policy)", "ed.health": "Health", "ed.alg": "Allergies / sensitivities",
      "ed.wmin": "Ideal weight from", "ed.wmax": "to", "ed.vet": "Vet", "ed.vetN": "Vet's name", "ed.vetC": "Clinic",
      "ed.vetPh": "Phone", "ed.eph": "Emergency / on-call phone", "ed.care": "Routine care (every … days, 0 = off)",
      "ed.notes": "Notes", "ed.gone": "No longer with me", "ed.goneHint": "The health book stays; reminders stop.",
      "ed.goneD": "Since", "ed.save": "Save", "ed.cancel": "Cancel", "ed.delete": "Delete",
      "ed.kg": "kg", "ed.g": "g",
      "rd.vacc": "Vaccine", "rd.deworm": "Deworming", "rd.visit": "Vet visit", "rd.med": "Medicine", "rd.weight": "Weight",
      "rd.care": "Routine care", "rd.food": "Food change",
      "rf.name": "Vaccine", "rf.namePh": "Rabies, DHPPi…", "rf.date": "Date", "rf.next": "Next dose",
      "rf.nextNone": "None", "rf.batch": "Batch / lot", "rf.vet": "Vet", "rf.notes": "Notes",
      "rf.type": "Type", "rf.product": "Product", "rf.reason": "Reason", "rf.diag": "Diagnosis",
      "rf.treat": "Treatment", "rf.cost": "Cost (€)", "rf.recheck": "Recheck", "rf.medName": "Medicine",
      "rf.dose": "Dose", "rf.freq": "How often", "rf.freqPh": "twice a day", "rf.from": "From", "rf.until": "Until (last day)",
      "rf.weight": "Weight", "rf.foodN": "Food",
      "q.d7": "+1 week", "q.d14": "+2 weeks", "q.m1": "+1 month", "q.m3": "+3 months", "q.m6": "+6 months", "q.y1": "+1 year", "q.y3": "+3 years",
      "fe.title": "Food", "fe.n": "Food (brand, type)", "fe.g": "Grams a day", "fe.ml": "Meals a day",
      "fe.bag": "Bag size (kg)", "fe.open": "Bag opened on",
      "nb.title": "New bag opened today", "nb.bag": "Bag size (kg)",
      "disclaimer": "Suggested intervals are a starting point only. Your vet's advice always wins.",
      "set.title": "Settings", "set.remind": "Daily reminder", "set.off": "Off",
      "set.remindHint": "Reminders appear while orOS is open (also with this app closed). With orOS closed they wait for the next time you open it.",
      "set.lead": "Warn me before vaccines, deworming and rechecks", "set.lead0": "Only on the day",
      "set.leadN": "{n} days before", "set.lead1": "1 day before",
      "set.data": "Your pets", "set.export": "Export", "set.import": "Import", "set.close": "Close",
      "toast.undo": "Undo", "toast.added": "{name} added", "toast.saved": "Saved", "toast.deleted": "{name} deleted",
      "toast.recAdded": "Added to the health book", "toast.recDeleted": "Entry removed", "toast.careDone": "{what}: {name}",
      "toast.bag": "New bag: {name}", "toast.save": "Could not save: storage is full",
      "toast.needName": "Give your pet a name", "toast.needRec": "Fill in the name", "toast.needWeight": "Enter a weight",
      "toast.badDate": "Check the dates", "toast.max": "Up to {n} pets",
      "toast.exported": "Exported", "toast.imported": "Imported: {n} pets", "toast.badFile": "This is not a Pet Health Book file",
      "toast.photoBad": "This image could not be used", "toast.photoFull": "No room for more photos",
      "toast.print": "Nothing to print",
      "at.title": "Attachments", "at.add": "Add a photo or PDF", "at.open": "Attachment {n}", "at.pdf": "PDF",
      "at.missing": "Not on this device", "at.missingLong": "This file is not on this device yet. It arrives with Vault Drive sync.",
      "at.where": "Kept in Files, folder Pet Health Book.", "at.remove": "Remove", "at.close": "Close",
      "at.openPdf": "Open", "at.save": "Save a copy", "at.bad": "That file could not be read (photos, or PDF up to 10 MB)",
      "at.noDisk": "The file could not be saved", "at.hint": "Prescriptions, test results, certificates. Photos are shrunk and lose their location data.",
      "at.count": "📎 {n}",
      "rf.times": "Remind me at", "rf.addTime": "Add a time", "rf.delTime": "Remove {t}",
      "rf.timesHint": "One reminder at each time, every day of the course.",
      "r.times": "at {t}", "grp.doses": "Doses today",
      "set.doses": "Remind me at each medicine dose",
      "fd.todo": "Add to shopping list", "todo.item": "{food} for {name}", "todo.plain": "Food for {name}",
      "toast.needCost": "Enter the cost first", "bud.add": "Add to Budget", "bud.note": "{name}: {what}",
      "toast.noBridge": "Could not open the other app",
      "confirm.del": "Delete {name} and the whole health book?", "confirm.yes": "Delete",
      "confirm.delRec": "Remove this entry?",
      "pr.title": "Health card", "pr.vacc": "Vaccines in force", "pr.dw": "Deworming", "pr.meds": "Current medicine",
      "pr.none": "—", "pr.made": "Printed {d} from orOS · Pet Health Book", "pr.last": "Last weight",
      "live.done": "{what} done for {name}"
    },
    el: {
      "app": "Βιβλιάριο κατοικιδίου",
      "tab.up": "Επόμενα", "tab.pets": "Τα ζώα μου", "btn.add": "Ζώο", "btn.addAria": "Νέο ζώο",
      "btn.settings": "Ρυθμίσεις", "btn.back": "Πίσω στα ζώα μου",
      "grp.late": "Καθυστερούν", "grp.today": "Σήμερα", "grp.soon": "Επόμενες 30 μέρες", "grp.gone": "Στη μνήμη μας",
      "due.today": "σήμερα", "due.tomorrow": "αύριο", "due.in": "σε {n} μέρες",
      "due.late1": "1 μέρα πίσω", "due.late": "{n} μέρες πίσω",
      "kind.vacc": "Εμβόλιο", "kind.deworm": "Αποπαρασίτωση", "kind.visit": "Επίσκεψη", "kind.med": "Φάρμακο",
      "kind.weight": "Βάρος", "kind.care": "Φροντίδα", "kind.food": "Τροφή",
      "dw.int": "Εσωτερική αποπαρασίτωση", "dw.ext": "Εξωτερικά παράσιτα", "dw.both": "Εσωτερική + εξωτερική αποπαρασίτωση",
      "dwS.int": "Εσωτερική", "dwS.ext": "Εξωτερική", "dwS.both": "Και οι δύο",
      "care.bath": "Μπάνιο", "care.nails": "Κόψιμο νυχιών", "care.brush": "Βούρτσισμα / καλλωπισμός", "care.teeth": "Δόντια",
      "care.ears": "Καθαρισμός αυτιών", "care.litter": "Αλλαγή άμμου", "care.cage": "Καθαρισμός κλουβιού", "care.tank": "Αλλαγή νερού ενυδρείου",
      "item.recheck": "Επανεξέταση", "item.medEnd": "{name}: τελευταία μέρα", "item.food": "Τελειώνει η τροφή",
      "act.log": "Καταγραφή", "act.done": "Έγινε", "act.bag": "Νέο σακί", "act.open": "Άνοιγμα: {name}",
      "act.logAria": "Καταγραφή: {what} για {name}", "act.doneAria": "{what} για {name}: έγινε",
      "empty.first": "Δεν έχεις προσθέσει ζώο ακόμα. Πρόσθεσε το πρώτο και το orOS θα κρατά το βιβλιάριό του και θα σου θυμίζει εμβόλια, αποπαρασιτώσεις και κτηνίατρο.",
      "empty.first.btn": "Νέο ζώο",
      "empty.calm": "Όλα καλά. Τίποτα δεν πλησιάζει τις επόμενες 30 μέρες.",
      "bday": "🎂 Χρόνια πολλά, {name}! Σήμερα κλείνει τα {n}.",
      "card.next": "Επόμενο: {what} {when}", "card.nothing": "Τίποτα προγραμματισμένο",
      "age.y": "{n} ετών", "age.ym": "{y} ετών και {m} μηνών", "age.m": "{n} μηνών", "age.new": "νεογέννητο", "age.approx": "περίπου {age}",
      "sub.info": "Επισκόπηση", "sub.health": "Βιβλιάριο", "sub.weight": "Βάρος", "sub.food": "Τροφή",
      "ph.edit": "Επεξεργασία", "ph.print": "Εκτύπωση κάρτας", "ph.delete": "Διαγραφή",
      "sec.next": "Επόμενα", "sec.profile": "Στοιχεία", "sec.vet": "Κτηνίατρος", "sec.care": "Φροντίδα ρουτίνας", "sec.notes": "Σημειώσεις",
      "next.none": "Τίποτα προγραμματισμένο. Κατέγραψε ένα εμβόλιο ή μια αποπαρασίτωση με επόμενη ημερομηνία και θα εμφανιστεί εδώ.",
      "f.species": "Είδος", "f.breed": "Ράτσα", "f.sex": "Φύλο", "f.birth": "Γέννηση", "f.age": "Ηλικία",
      "f.color": "Χρώμα / σημάδια", "f.chip": "Microchip", "f.pass": "Αρ. διαβατηρίου", "f.ins": "Ασφάλεια",
      "f.alg": "Αλλεργίες", "f.weight": "Ιδανικό βάρος", "f.gone": "Στη μνήμη μας από",
      "sex.f": "Θηλυκό", "sex.m": "Αρσενικό", "sex.none": "—", "neut.f": "στειρωμένο", "neut.m": "στειρωμένο",
      "vet.call": "Κλήση", "vet.emerg": "Εφημερία", "vet.none": "Δεν έχεις αποθηκεύσει κτηνίατρο. Πρόσθεσέ τον από την Επεξεργασία.",
      "care.every": "κάθε {n} μέρες", "care.none": "Δεν έχεις ορίσει φροντίδα ρουτίνας. Άνοιξέ τη από την Επεξεργασία (μπάνιο, νύχια, άμμος…).",
      "h.cost": "Κτηνιατρικά έξοδα {y}: {sum}",
      "h.add.vacc": "Εμβόλιο", "h.add.deworm": "Αποπαρασίτωση", "h.add.visit": "Επίσκεψη", "h.add.med": "Φάρμακο",
      "flt.all": "Όλα", "flt.vacc": "Εμβόλια", "flt.deworm": "Αποπαρασίτωση", "flt.visit": "Επισκέψεις", "flt.med": "Φάρμακα", "flt.care": "Φροντίδα",
      "h.empty": "Το βιβλιάριο είναι ακόμα άδειο.",
      "r.next": "επόμενη {d}", "r.recheck": "επανεξέταση {d}", "r.until": "έως {d}", "r.batch": "παρτίδα {b}", "r.cost": "{sum}",
      "w.add": "Βάρος", "w.empty": "Δεν υπάρχει καταγραφή βάρους. Ζύγιζε το ζώο σου πού και πού για να παρακολουθείς την υγεία του.",
      "w.delta": "{sign}{v} τις τελευταίες 30+ μέρες", "w.range": "Ιδανικό: {min} – {max}", "w.out": "εκτός ιδανικού εύρους",
      "fd.none": "Δεν έχεις αποθηκεύσει τροφή.", "fd.edit": "Επεξεργασία τροφής", "fd.bag": "Άνοιξα νέο σακί",
      "fd.daily": "{g} τη μέρα", "fd.meals": "{n} γεύματα", "fd.bagInfo": "Σακί {b}, ανοίχτηκε {d}",
      "fd.out": "Τελειώνει γύρω στις {d} ({when})", "fd.hist": "Ιστορικό τροφής", "fd.histEmpty": "Καμία αλλαγή τροφής ακόμα.",
      "fd.change": "Ξεκίνησε: {n}",
      "ed.addTitle": "Νέο ζώο", "ed.editTitle": "Επεξεργασία", "ed.name": "Όνομα", "ed.photo": "Φωτογραφία",
      "ed.photoAdd": "Επιλογή φωτογραφίας", "ed.photoDel": "Αφαίρεση", "ed.species": "Είδος", "ed.breed": "Ράτσα",
      "ed.sex": "Φύλο", "ed.neut": "Στειρωμένο", "ed.birth": "Ημερομηνία γέννησης", "ed.approx": "Την ξέρω μόνο κατά προσέγγιση",
      "ed.year": "Έτος", "ed.month": "Μήνας", "ed.monthAny": "—", "ed.color": "Χρώμα / σημάδια",
      "ed.ids": "Microchip, διαβατήριο, ασφάλεια", "ed.chip": "Αριθμός microchip", "ed.pass": "Αριθμός διαβατηρίου",
      "ed.ins": "Ασφάλεια (εταιρεία, συμβόλαιο)", "ed.health": "Υγεία", "ed.alg": "Αλλεργίες / ευαισθησίες",
      "ed.wmin": "Ιδανικό βάρος από", "ed.wmax": "έως", "ed.vet": "Κτηνίατρος", "ed.vetN": "Όνομα κτηνιάτρου", "ed.vetC": "Ιατρείο",
      "ed.vetPh": "Τηλέφωνο", "ed.eph": "Τηλέφωνο εφημερίας / έκτακτης ανάγκης", "ed.care": "Φροντίδα ρουτίνας (κάθε … μέρες, 0 = όχι)",
      "ed.notes": "Σημειώσεις", "ed.gone": "Δεν είναι πια μαζί μου", "ed.goneHint": "Το βιβλιάριο μένει· οι υπενθυμίσεις σταματούν.",
      "ed.goneD": "Από", "ed.save": "Αποθήκευση", "ed.cancel": "Άκυρο", "ed.delete": "Διαγραφή",
      "ed.kg": "kg", "ed.g": "g",
      "rd.vacc": "Εμβόλιο", "rd.deworm": "Αποπαρασίτωση", "rd.visit": "Επίσκεψη στον κτηνίατρο", "rd.med": "Φάρμακο", "rd.weight": "Βάρος",
      "rd.care": "Φροντίδα ρουτίνας", "rd.food": "Αλλαγή τροφής",
      "rf.name": "Εμβόλιο", "rf.namePh": "Λύσσα, πολυδύναμο…", "rf.date": "Ημερομηνία", "rf.next": "Επόμενη δόση",
      "rf.nextNone": "Καμία", "rf.batch": "Παρτίδα", "rf.vet": "Κτηνίατρος", "rf.notes": "Σημειώσεις",
      "rf.type": "Τύπος", "rf.product": "Σκεύασμα", "rf.reason": "Λόγος", "rf.diag": "Διάγνωση",
      "rf.treat": "Θεραπεία", "rf.cost": "Κόστος (€)", "rf.recheck": "Επανεξέταση", "rf.medName": "Φάρμακο",
      "rf.dose": "Δόση", "rf.freq": "Συχνότητα", "rf.freqPh": "δύο φορές τη μέρα", "rf.from": "Από", "rf.until": "Έως (τελευταία μέρα)",
      "rf.weight": "Βάρος", "rf.foodN": "Τροφή",
      "q.d7": "+1 εβδομάδα", "q.d14": "+2 εβδομάδες", "q.m1": "+1 μήνας", "q.m3": "+3 μήνες", "q.m6": "+6 μήνες", "q.y1": "+1 χρόνος", "q.y3": "+3 χρόνια",
      "fe.title": "Τροφή", "fe.n": "Τροφή (μάρκα, τύπος)", "fe.g": "Γραμμάρια τη μέρα", "fe.ml": "Γεύματα τη μέρα",
      "fe.bag": "Μέγεθος σακιού (kg)", "fe.open": "Το σακί άνοιξε στις",
      "nb.title": "Άνοιξα νέο σακί σήμερα", "nb.bag": "Μέγεθος σακιού (kg)",
      "disclaimer": "Τα προτεινόμενα διαστήματα είναι μόνο αφετηρία. Ισχύει πάντα ό,τι πει ο κτηνίατρός σου.",
      "set.title": "Ρυθμίσεις", "set.remind": "Καθημερινή υπενθύμιση", "set.off": "Κλειστή",
      "set.remindHint": "Οι υπενθυμίσεις εμφανίζονται όσο το orOS είναι ανοιχτό (και με κλειστή αυτή την εφαρμογή). Με κλειστό το orOS περιμένουν το επόμενο άνοιγμα.",
      "set.lead": "Ειδοποίηση πριν από εμβόλια, αποπαρασιτώσεις και επανεξετάσεις", "set.lead0": "Μόνο την ίδια μέρα",
      "set.leadN": "{n} μέρες πριν", "set.lead1": "1 μέρα πριν",
      "set.data": "Τα ζώα σου", "set.export": "Εξαγωγή", "set.import": "Εισαγωγή", "set.close": "Κλείσιμο",
      "toast.undo": "Αναίρεση", "toast.added": "Προστέθηκε: {name}", "toast.saved": "Αποθηκεύτηκε", "toast.deleted": "Διαγράφηκε: {name}",
      "toast.recAdded": "Προστέθηκε στο βιβλιάριο", "toast.recDeleted": "Η εγγραφή αφαιρέθηκε", "toast.careDone": "{what}: {name}",
      "toast.bag": "Νέο σακί: {name}", "toast.save": "Δεν αποθηκεύτηκε: ο χώρος είναι γεμάτος",
      "toast.needName": "Δώσε ένα όνομα στο ζώο σου", "toast.needRec": "Συμπλήρωσε το όνομα", "toast.needWeight": "Γράψε το βάρος",
      "toast.badDate": "Έλεγξε τις ημερομηνίες", "toast.max": "Έως {n} ζώα",
      "toast.exported": "Η εξαγωγή έγινε", "toast.imported": "Εισαγωγή: {n} ζώα", "toast.badFile": "Αυτό δεν είναι αρχείο Βιβλιαρίου κατοικιδίου",
      "toast.photoBad": "Αυτή η εικόνα δεν μπορεί να χρησιμοποιηθεί", "toast.photoFull": "Δεν χωρούν άλλες φωτογραφίες",
      "toast.print": "Δεν υπάρχει κάτι για εκτύπωση",
      "at.title": "Συνημμένα", "at.add": "Προσθήκη φωτογραφίας ή PDF", "at.open": "Συνημμένο {n}", "at.pdf": "PDF",
      "at.missing": "Όχι σε αυτή τη συσκευή", "at.missingLong": "Το αρχείο δεν έχει έρθει ακόμα σε αυτή τη συσκευή. Έρχεται με τον συγχρονισμό του Vault Drive.",
      "at.where": "Φυλάσσεται στα Αρχεία, φάκελος Pet Health Book.", "at.remove": "Αφαίρεση", "at.close": "Κλείσιμο",
      "at.openPdf": "Άνοιγμα", "at.save": "Αποθήκευση αντιγράφου", "at.bad": "Δεν ήταν δυνατό να διαβαστεί το αρχείο (φωτογραφίες, ή PDF έως 10 MB)",
      "at.noDisk": "Δεν ήταν δυνατό να αποθηκευτεί το αρχείο", "at.hint": "Συνταγές, εξετάσεις, πιστοποιητικά. Οι φωτογραφίες μικραίνουν και χάνουν τα στοιχεία τοποθεσίας.",
      "at.count": "📎 {n}",
      "rf.times": "Υπενθύμιση στις", "rf.addTime": "Προσθήκη ώρας", "rf.delTime": "Αφαίρεση {t}",
      "rf.timesHint": "Μία υπενθύμιση σε κάθε ώρα, κάθε μέρα της θεραπείας.",
      "r.times": "στις {t}", "grp.doses": "Δόσεις σήμερα",
      "set.doses": "Υπενθύμιση σε κάθε δόση φαρμάκου",
      "fd.todo": "Στη λίστα για ψώνια", "todo.item": "{food} για {name}", "todo.plain": "Τροφή για {name}",
      "toast.needCost": "Συμπλήρωσε πρώτα το κόστος", "bud.add": "Προσθήκη στα Έσοδα & Έξοδα", "bud.note": "{name}: {what}",
      "toast.noBridge": "Η άλλη εφαρμογή δεν άνοιξε",
      "confirm.del": "Διαγραφή του «{name}» και όλου του βιβλιαρίου;", "confirm.yes": "Διαγραφή",
      "confirm.delRec": "Να αφαιρεθεί αυτή η εγγραφή;",
      "pr.title": "Κάρτα υγείας", "pr.vacc": "Εμβόλια σε ισχύ", "pr.dw": "Αποπαρασίτωση", "pr.meds": "Τρέχοντα φάρμακα",
      "pr.none": "—", "pr.made": "Εκτύπωση {d} από το orOS · Βιβλιάριο κατοικιδίου", "pr.last": "Τελευταίο βάρος",
      "live.done": "{what} έγινε για {name}"
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

  var S = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  var UI = {
    plus:   '<svg ' + S + ' stroke-width="2.2"><path d="M12 5v14M5 12h14"/></svg>',
    back:   '<svg ' + S + ' stroke-width="2.2"><path d="M15 18l-6-6 6-6"/></svg>',
    gear:   '<svg ' + S + '><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    check:  '<svg ' + S + ' stroke-width="2.4"><path d="M20 6 9 17l-5-5"/></svg>',
    phone:  '<svg ' + S + '><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.8 2z"/></svg>',
    print:  '<svg ' + S + '><path d="M6 9V2h12v7"/><rect x="6" y="14" width="12" height="8"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/></svg>',
    edit:   '<svg ' + S + '><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    vacc:   '<svg ' + S + '><path d="m18 2 4 4M17 7l3-3M19 9 8.7 19.3a1 1 0 0 1-1.4 0l-2.6-2.6a1 1 0 0 1 0-1.4L15 5M9 11l4 4M5 19l-3 3M14 4l6 6"/></svg>',
    deworm: '<svg ' + S + '><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>',
    visit:  '<svg ' + S + '><path d="M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6 6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3"/><path d="M8 15v1a6 6 0 0 0 6 6 6 6 0 0 0 6-6v-4"/><circle cx="20" cy="10" r="2"/></svg>',
    med:    '<svg ' + S + '><path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7z"/><path d="m8.5 8.5 7 7"/></svg>',
    weight: '<svg ' + S + '><path d="M6 7h12l2 13H4z"/><circle cx="12" cy="4.5" r="2"/><path d="M12 11v3"/></svg>',
    care:   '<svg ' + S + '><circle cx="5.5" cy="10" r="2"/><circle cx="9.5" cy="5.5" r="2"/><circle cx="14.5" cy="5.5" r="2"/><circle cx="18.5" cy="10" r="2"/><path d="M12 12c-3 0-5.5 3.5-5.5 6 0 1.7 1.3 2.5 3 2.5 1 0 1.6-.5 2.5-.5s1.5.5 2.5.5c1.7 0 3-.8 3-2.5 0-2.5-2.5-6-5.5-6z"/></svg>',
    food:   '<svg ' + S + '><path d="M3 11h18a9 9 0 0 1-18 0z"/><path d="M7 7c0-1.5 1-2 1-3.5M12 7c0-1.5 1-2 1-3.5M17 7c0-1.5 1-2 1-3.5"/></svg>'
  };

  function $(id) { return document.getElementById(id); }
  function cmpStr(x, y) { return x < y ? -1 : (x > y ? 1 : 0); }
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
  function spName(sp) { var s = C.SPECIES[sp] || C.SPECIES.other; return s[LANG] || s.en; }
  function spEm(sp) { return (C.SPECIES[sp] || C.SPECIES.other).em; }
  function isSmall(p) { return !!SMALL[p.sp]; }
  function nf(v, max) {
    try { return v.toLocaleString(LOCALE, { maximumFractionDigits: max }); } catch (e) { return String(v); }
  }
  function fmtWeight(g, p) { return isSmall(p) ? nf(g, 0) + " g" : nf(g / 1000, 2) + " kg"; }
  function fmtGrams(g) { return g >= 1000 ? nf(g / 1000, 2) + " kg" : nf(g, 0) + " g"; }
  function fmtMoney(cents) {
    try { return (cents / 100).toLocaleString(LOCALE, { style: "currency", currency: "EUR" }); }
    catch (e) { return (cents / 100).toFixed(2) + " €"; }
  }
  function fmtDate(ymd) {
    if (!ymd) return "";
    if (ymd.length === 4) return ymd;
    if (ymd.length === 7) return ymd.slice(5, 7) + "/" + ymd.slice(0, 4);
    return ymd.slice(8, 10) + "/" + ymd.slice(5, 7) + "/" + ymd.slice(0, 4);   // dd/mm/yyyy (Bible)
  }
  function whenText(due, today) {
    var diff = C.dayNum(due) - C.dayNum(today);
    if (diff === 0) return t("due.today");
    if (diff === 1) return t("due.tomorrow");
    if (diff === -1) return t("due.late1");
    if (diff < 0) return t("due.late", { n: -diff });
    if (diff < 7) return t("due.in", { n: diff });
    return fmtDate(due);
  }
  function ageText(p, today) {
    var a = C.age(p.birth, today || todayYmd());
    if (!a) return "";
    var s;
    if (a.y === 0 && a.mo === 0) s = t("age.new");
    else if (a.y === 0) s = t("age.m", { n: a.mo });
    else if (a.y < 3 && a.mo) s = t("age.ym", { y: a.y, m: a.mo });
    else s = t("age.y", { n: a.y });
    return a.approx ? t("age.approx", { age: s }) : s;
  }
  // Calendar months, clamped to the month's last day.
  function addMonths(ymd, n) {
    var y = +ymd.slice(0, 4), m = +ymd.slice(5, 7) - 1 + n, d = +ymd.slice(8, 10);
    y += Math.floor(m / 12);
    m = ((m % 12) + 12) % 12;
    var last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    if (d > last) d = last;
    return y + "-" + (m < 9 ? "0" : "") + (m + 1) + "-" + (d < 10 ? "0" : "") + d;
  }
  function itemTitle(it) {
    if (it.kind === "vacc") return it.label;
    if (it.kind === "deworm") return t("dw." + it.sub) + (it.label ? " · " + it.label : "");
    if (it.kind === "visit") return t("item.recheck") + (it.label ? ": " + it.label : "");
    if (it.kind === "med") return t("item.medEnd", { name: it.label });
    if (it.kind === "care") return t("care." + it.sub);
    return t("item.food") + (it.label ? " · " + it.label : "");
  }
  function kindIcon(kind) {
    var s = el("span", "kind");
    s.innerHTML = UI[kind];
    return s;
  }

  // BOOT MARKER
  (function () {
    var m = ((document.currentScript && document.currentScript.src) || "")
      .match(/[?&]v=([^&#]+)/);
    document.documentElement.lang = LANG;
    console.log("petcare.js v" + (m ? m[1] : "?") + " boot");
  })();

  // ---------- 2. Storage + prefs ----------
  var data = null, prefs = null;

  function emptyData() { return { ver: C.DATA_VER, pets: [], recs: [], tombs: {} }; }
  function canonical(d) { return C.merge(d, d); }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.pets)) {
          data = canonical(parsed);
          return;
        }
      } catch (e) {}
      try { localStorage.setItem(STORAGE_KEY + "-broken", raw); } catch (e) {}
      try { console.error("[orOS] petcare: unreadable data copied to " + STORAGE_KEY + "-broken"); } catch (e) {}
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
    var base = C.readPrefs(p);
    p = (p && typeof p === "object") ? p : {};
    prefs = {
      remind: base.remind,
      lead: base.lead,
      doses: base.doses,
      tab: p.tab === "pets" ? "pets" : "up",
      pet: typeof p.pet === "string" && C.ID_RE.test(p.pet) ? p.pet : null,
      sub: SUBS.indexOf(p.sub) >= 0 ? p.sub : "info",
      filter: FILTERS.indexOf(p.filter) >= 0 ? p.filter : "all"
    };
  }
  var prefsTimer = null;
  function savePrefs() { clearTimeout(prefsTimer); prefsTimer = setTimeout(savePrefsNow, 300); }
  function savePrefsNow() {
    clearTimeout(prefsTimer); prefsTimer = null;
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  function petById(id) {
    for (var i = 0; i < data.pets.length; i++) if (data.pets[i].id === id) return data.pets[i];
    return null;
  }
  function recById(id) {
    for (var i = 0; i < data.recs.length; i++) if (data.recs[i].id === id) return data.recs[i];
    return null;
  }
  function recsOf(petId, kind) {
    return data.recs.filter(function (r) { return r.p === petId && (!kind || r.k === kind); })
      .sort(function (a, b) { return cmpStr(b.d, a.d) || cmpStr(b.id, a.id); });
  }
  function stamp(x) { x.m = Math.max(Date.now(), x.m + 1); }
  // Edit a pet: `change` gets a copy and returns it changed. Only the
  // field groups that really changed get a new mtime (core touch,
  // R27). Returns the stored pet, or null when nothing changed.
  function updatePet(id, change) {
    var cur = petById(id);
    if (!cur) return null;
    var draft = C.normPet(change(JSON.parse(JSON.stringify(cur))));
    if (!draft || !C.touch(draft, cur)) return null;
    data.pets = data.pets.map(function (x) { return x.id === id ? draft : x; });
    return draft;
  }
  function photoBytes(exceptId) {
    var n = 0;
    data.pets.forEach(function (p) { if (p.id !== exceptId && p.ph) n += p.ph.length; });
    return n;
  }

  // ---------- 3. Mutations ----------
  function addRec(r, toastText) {
    var clean = C.normRec(r);
    if (!clean) return null;
    data.recs.push(clean);
    save();
    render();
    undoToast(toastText || t("toast.recAdded"), function () {
      data.tombs[clean.id] = Math.max(Date.now(), clean.m);
      save();
      render();
      dropFilesLater(clean.sc || []);
    });
    return clean;
  }

  function careDone(pet, kind) {
    var name = t("care." + kind);
    addRec({ id: newId(), p: pet.id, k: "care", d: todayYmd(), m: Date.now(), c: kind },
           t("toast.careDone", { what: name, name: pet.name }));
    live(t("live.done", { what: name, name: pet.name }));
  }

  function removeRec(r) {
    data.tombs[r.id] = Math.max(Date.now(), r.m);
    save();
    render();
    dropFilesLater(r.sc || []);
    undoToast(t("toast.recDeleted"), function () {
      delete data.tombs[r.id];
      var back = Object.assign({}, r, { m: Date.now() });
      data.recs = data.recs.filter(function (y) { return y.id !== r.id; });
      data.recs.push(back);
      save();
      render();
    });
  }

  function deletePet(p) {
    var snapshot = JSON.parse(JSON.stringify(p));
    var recs = data.recs.filter(function (x) { return x.p === p.id; }).map(function (x) { return Object.assign({}, x); });
    data.tombs[p.id] = Math.max(Date.now(), p.m);
    data.pets = data.pets.filter(function (x) { return x.id !== p.id; });
    if (prefs.pet === p.id) { prefs.pet = null; prefs.tab = "pets"; savePrefs(); }
    save();
    render();
    var names = [];
    recs.forEach(function (x) { names = names.concat(x.sc || []); });
    dropFilesLater(names);
    undoToast(t("toast.deleted", { name: p.name }), function () {
      // a newer edit resurrects (R17): m above the tombstone, which
      // may already have travelled
      snapshot.m = Math.max(Date.now(), (data.tombs[p.id] || 0) + 1, snapshot.m + 1);
      data.pets.push(snapshot);
      recs.forEach(function (x) { if (!recById(x.id)) data.recs.push(x); });
      save();
      render();
    });
  }

  // ---------- 4. Upcoming view ----------
  function avatar(p, cls) {
    if (p.ph) {
      var img = el("img", "p-ico" + (cls ? " " + cls : ""));
      img.src = p.ph;                 // validated jpeg data URI (core PHOTO_RE)
      img.alt = "";
      return img;
    }
    var s = el("span", "p-ico" + (cls ? " " + cls : ""), spEm(p.sp));
    s.setAttribute("aria-hidden", "true");
    return s;
  }

  function emptyFirst(box) {
    box.hidden = false;
    box.appendChild(el("div", "empty-ico", "🐾"));
    box.appendChild(el("p", "", t("empty.first")));
    var b = el("button", "txt-btn primary", t("empty.first.btn"));
    b.type = "button";
    b.addEventListener("click", function () { petEditor(null); });
    box.appendChild(b);
  }

  function renderUp() {
    var list = $("up-list"), empty = $("up-empty"), banner = $("bday-banner");
    list.innerHTML = "";
    empty.innerHTML = "";
    banner.innerHTML = "";
    banner.hidden = true;
    if (!data.pets.length) { emptyFirst(empty); return; }
    var today = todayYmd();
    var bdays = data.pets.filter(function (p) { return !p.gone && C.birthdayOn(p, today); });
    if (bdays.length) {
      banner.hidden = false;
      bdays.forEach(function (p) { banner.appendChild(el("span", "", t("bday", { name: p.name, n: C.birthdayOn(p, today) }))); });
    }
    var all = C.items(data, today).filter(function (it) { return it.diff <= HORIZON; });
    var doses = dosesToday(today);
    if (doses.length) list.appendChild(dosesSection(doses));
    if (!all.length && doses.length) { empty.hidden = true; return; }
    if (!all.length) {
      empty.hidden = false;
      empty.appendChild(el("div", "empty-ico", "🐾"));
      empty.appendChild(el("p", "", t("empty.calm")));
      return;
    }
    empty.hidden = true;
    [
      { key: "late", items: all.filter(function (it) { return it.diff < 0; }) },
      { key: "today", items: all.filter(function (it) { return it.diff === 0; }) },
      { key: "soon", items: all.filter(function (it) { return it.diff > 0; }) }
    ].forEach(function (g) {
      if (!g.items.length) return;
      var sec = el("section", "grp grp-" + g.key);
      var head = el("div", "grp-head");
      head.appendChild(el("h2", "", t("grp." + g.key)));
      head.appendChild(el("span", "count", String(g.items.length)));
      sec.appendChild(head);
      var ul = el("ul", "tasks");
      g.items.forEach(function (it) { ul.appendChild(itemRow(it, today, true)); });
      sec.appendChild(ul);
      list.appendChild(sec);
    });
  }

  // Today's medicine doses (courses with dose times), by time.
  function dosesToday(today) {
    var pets = {}, out = [];
    data.pets.forEach(function (p) { if (!p.gone) pets[p.id] = p; });
    data.recs.forEach(function (r) {
      if (r.k !== "med" || !r.tm || !pets[r.p] || r.d > today || (r.u && r.u < today)) return;
      r.tm.forEach(function (hm) { out.push({ tm: hm, pet: pets[r.p], rec: r }); });
    });
    return out.sort(function (x, y) { return cmpStr(x.tm, y.tm) || cmpStr(x.pet.name, y.pet.name) || cmpStr(x.rec.id, y.rec.id); });
  }
  function dosesSection(doses) {
    var sec = el("section", "grp grp-doses");
    var head = el("div", "grp-head");
    head.appendChild(el("h2", "", t("grp.doses")));
    head.appendChild(el("span", "count", String(doses.length)));
    sec.appendChild(head);
    var ul = el("ul", "recs");
    doses.forEach(function (x) {
      var li = el("li");
      var b = el("button", "rec");
      b.type = "button";
      b.style.setProperty("--kind", KIND_COLOR.med);
      var ic = el("span", "rec-ico");
      ic.innerHTML = UI.med;
      b.appendChild(ic);
      var bd = el("span", "rec-body");
      var tt = el("span", "rec-title", x.pet.name + ": " + x.rec.n);
      tt.style.display = "block";
      bd.appendChild(tt);
      if (x.rec.ds) { var sb = el("span", "rec-sub", x.rec.ds); sb.style.display = "block"; bd.appendChild(sb); }
      b.appendChild(bd);
      b.appendChild(el("span", "rec-d", x.tm));
      b.addEventListener("click", function () { openPet(x.pet.id); });
      li.appendChild(b);
      ul.appendChild(li);
    });
    sec.appendChild(ul);
    return sec;
  }

  // One due date. showPet: the avatar + pet name (Upcoming); on a
  // pet's own page they are left out.
  function itemRow(it, today, showPet) {
    var p = it.pet;
    var li = el("li", "task" + (it.diff < 0 ? " late" : ""));
    li.style.setProperty("--kind", KIND_COLOR[it.kind]);
    if (showPet) {
      var ico = el("button", "p-ico");
      ico.type = "button";
      ico.setAttribute("aria-label", t("act.open", { name: p.name }));
      if (p.ph) { ico.textContent = ""; ico.appendChild(avatar(p)); ico.style.padding = "0"; ico.style.overflow = "hidden"; }
      else ico.textContent = spEm(p.sp);
      ico.addEventListener("click", function () { openPet(p.id); });
      li.appendChild(ico);
    }
    var body = el("div", "t-body" + (showPet ? " tap" : ""));
    var nm = el("div", "t-name");
    if (showPet) { nm.appendChild(el("span", "pet", p.name + " · ")); }
    nm.appendChild(document.createTextNode(itemTitle(it)));
    body.appendChild(nm);
    var sub = el("div", "t-sub");
    var kb = kindIcon(it.kind);
    kb.appendChild(el("span", "", t("kind." + it.kind)));
    sub.appendChild(kb);
    sub.appendChild(el("span", "when", whenText(it.due, today)));
    body.appendChild(sub);
    if (showPet) body.addEventListener("click", function () { openPet(p.id); });
    li.appendChild(body);
    var act = actionFor(it);
    if (act) li.appendChild(act);
    return li;
  }

  function actionFor(it) {
    var p = it.pet, what = itemTitle(it), b = el("button", "done-btn");
    b.type = "button";
    if (it.kind === "care") {
      b.innerHTML = UI.check;
      b.appendChild(el("span", "", t("act.done")));
      b.setAttribute("aria-label", t("act.doneAria", { what: what, name: p.name }));
      b.addEventListener("click", function () { careDone(p, it.sub); });
      return b;
    }
    if (it.kind === "med") return null;
    b.classList.add("ghost");
    if (it.kind === "food") {
      b.textContent = t("act.bag");
      b.addEventListener("click", function () { newBag(p); });
      return b;
    }
    b.innerHTML = UI.plus;
    b.appendChild(el("span", "", t("act.log")));
    b.setAttribute("aria-label", t("act.logAria", { what: what, name: p.name }));
    b.addEventListener("click", function () { logFromItem(it); });
    return b;
  }

  // "Log" on a due vaccine / deworming / recheck: a new record of
  // the same kind, dated today, with the next date one gap later
  // (the gap of the dose it replaces).
  function logFromItem(it) {
    var r = it.rec, today = todayYmd(), pre = { d: today };
    if (it.kind === "vacc" || it.kind === "deworm") {
      pre.n = r.n;
      if (it.kind === "deworm") pre.t = r.t;
      var gap = r.nx ? C.dayNum(r.nx) - C.dayNum(r.d) : 0;
      if (gap > 0) pre.nx = C.addDays(today, gap);
      if (it.kind === "vacc") pre.v = r.v || it.pet.vet.n;
      recEditor(it.pet, it.kind, null, pre);
    } else if (it.kind === "visit") {
      pre.n = t("item.recheck") + (r.n ? ": " + r.n : "");
      pre.v = r.v || it.pet.vet.n;
      recEditor(it.pet, "visit", null, pre);
    }
  }

  // ---------- 5. Pets view ----------
  function renderPets() {
    var grid = $("pet-grid"), empty = $("pets-empty");
    grid.innerHTML = "";
    empty.innerHTML = "";
    if (!data.pets.length) { emptyFirst(empty); return; }
    empty.hidden = true;
    var today = todayYmd(), its = C.items(data, today), nextOf = {};
    its.forEach(function (it) { if (!nextOf[it.pet.id]) nextOf[it.pet.id] = it; });
    var sorted = data.pets.slice().sort(function (a, b) {
      var na = nextOf[a.id], nb = nextOf[b.id];
      if (!!a.gone !== !!b.gone) return a.gone ? 1 : -1;
      if (na && nb && na.diff !== nb.diff) return na.diff - nb.diff;
      if (!!na !== !!nb) return na ? -1 : 1;
      return a.name.localeCompare(b.name, LOCALE) || cmpStr(a.id, b.id);
    });
    var alive = sorted.filter(function (p) { return !p.gone; });
    var gone = sorted.filter(function (p) { return p.gone; });
    alive.forEach(function (p) { grid.appendChild(petCard(p, nextOf[p.id], today)); });
    if (gone.length) {
      var head = el("div", "grp-head grp-gone");
      head.appendChild(el("h2", "", t("grp.gone")));
      grid.parentNode.insertBefore(head, grid.nextSibling);
      var g2 = el("div", "");
      g2.id = "pet-grid-gone";
      g2.style.display = "grid";
      g2.style.gridTemplateColumns = "repeat(auto-fill, minmax(250px, 1fr))";
      g2.style.gap = "8px";
      gone.forEach(function (p) { g2.appendChild(petCard(p, null, today)); });
      head.parentNode.insertBefore(g2, head.nextSibling);
    }
  }

  function petCard(p, next, today) {
    var card = el("button", "card" + (p.gone ? " gone" : ""));
    card.type = "button";
    card.appendChild(avatar(p));
    var body = el("span", "c-body");
    body.appendChild(el("span", "c-name", p.name));
    body.appendChild(el("span", "c-sub", [spName(p.sp), p.breed, ageText(p, today)].filter(Boolean).join(" · ")));
    if (p.gone) body.appendChild(el("span", "in-memory", t("grp.gone")));
    else {
      var nx = el("span", "c-next" + (next && next.diff < 0 ? " late" : ""));
      if (next) {
        nx.style.setProperty("--kind", KIND_COLOR[next.kind]);
        nx.innerHTML = UI[next.kind];
        nx.appendChild(el("span", "", itemTitle(next) + " · " + whenText(next.due, today)));
      } else {
        nx.style.setProperty("--kind", "var(--text-dim)");
        nx.appendChild(el("span", "", t("card.nothing")));
      }
      body.appendChild(nx);
    }
    card.appendChild(body);
    card.addEventListener("click", function () { openPet(p.id); });
    return card;
  }

  // ---------- 6. One pet ----------
  function openPet(id) {
    if (!petById(id)) return;
    if (prefs.pet !== id) prefs.sub = "info";
    prefs.pet = id;
    savePrefs();
    render();
    try { $("main").scrollTop = 0; } catch (e) {}
  }
  function closePet() {
    prefs.pet = null;
    prefs.tab = "pets";
    savePrefs();
    render();
  }

  function renderPet() {
    var p = petById(prefs.pet);
    if (!p) { closePet(); return; }
    var today = todayYmd();
    $("bar-title").textContent = p.name;
    var head = $("pet-head");
    head.innerHTML = "";
    var ph = el("div", "pet-head" + (p.gone ? " gone" : ""));
    ph.appendChild(avatar(p, "huge"));
    var hb = el("div", "ph-body");
    hb.appendChild(el("div", "ph-name", p.name));
    hb.appendChild(el("div", "ph-sub", [spEm(p.sp) + " " + spName(p.sp), p.breed, ageText(p, today)].filter(Boolean).join(" · ")));
    if (p.gone) hb.appendChild(el("div", "in-memory", t("f.gone") + " " + fmtDate(p.gone)));
    var acts = el("div", "ph-acts");
    acts.appendChild(iconTxt(UI.edit, t("ph.edit"), function () { petEditor(p.id); }));
    acts.appendChild(iconTxt(UI.print, t("ph.print"), function () { printCard(p); }));
    hb.appendChild(acts);
    ph.appendChild(hb);
    head.appendChild(ph);

    var tabs = $("subtabs");
    tabs.innerHTML = "";
    SUBS.forEach(function (s) {
      var b = el("button", "subtab" + (prefs.sub === s ? " on" : ""), t("sub." + s));
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", prefs.sub === s ? "true" : "false");
      b.addEventListener("click", function () { prefs.sub = s; savePrefs(); renderPet(); });
      tabs.appendChild(b);
    });
    var body = $("pet-body");
    body.innerHTML = "";
    if (prefs.sub === "health") renderHealth(p, body, today);
    else if (prefs.sub === "weight") renderWeight(p, body, today);
    else if (prefs.sub === "food") renderFood(p, body, today);
    else renderInfo(p, body, today);
  }

  function iconTxt(svg, label, fn) {
    var b = el("button", "txt-btn");
    b.type = "button";
    b.innerHTML = svg;
    b.appendChild(el("span", "", label));
    b.addEventListener("click", fn);
    return b;
  }
  function section(box, title) {
    var sec = el("section", "sec");
    var h = el("div", "sec-head");
    h.appendChild(el("h2", "", title));
    sec.appendChild(h);
    box.appendChild(sec);
    return sec;
  }
  function fact(dl, label, value, warn) {
    if (!value) return;
    var d = el("div", "fact" + (warn ? " warn" : ""));
    d.appendChild(el("dt", "", label));
    d.appendChild(el("dd", "", value));
    dl.appendChild(d);
  }
  function telLink(num, label) {
    var a = el("a", "txt-btn");
    a.href = "tel:" + num.replace(/[^0-9+]/g, "");       // cleanPhone already ran (core)
    a.innerHTML = UI.phone;
    a.appendChild(el("span", "", label));
    return a;
  }

  function renderInfo(p, box, today) {
    // Next dates (routine care has its own section below)
    if (!p.gone) {
      var its = C.items(data, today).filter(function (it) { return it.pet.id === p.id && it.kind !== "care"; });
      var sn = section(box, t("sec.next"));
      if (!its.length) sn.appendChild(el("p", "muted", t("next.none")));
      else {
        var ul = el("ul", "tasks");
        its.forEach(function (it) { ul.appendChild(itemRow(it, today, false)); });
        sn.appendChild(ul);
      }
    }
    // Profile
    var sp = section(box, t("sec.profile"));
    var dl = el("dl", "facts");
    var sex = p.sex ? t("sex." + p.sex) + (p.neut ? ", " + t("neut." + p.sex) : "") : (p.neut ? t("neut.m") : "");
    fact(dl, t("f.sex"), sex);
    fact(dl, t("f.birth"), p.birth ? fmtDate(p.birth) : "");
    fact(dl, t("f.age"), p.gone ? "" : ageText(p, today));
    fact(dl, t("f.color"), p.color);
    fact(dl, t("f.chip"), p.chip);
    fact(dl, t("f.pass"), p.pass);
    fact(dl, t("f.ins"), p.ins);
    fact(dl, t("f.alg"), p.alg, true);
    if (p.wmin || p.wmax) fact(dl, t("f.weight"), (p.wmin ? fmtWeight(p.wmin, p) : "…") + " – " + (p.wmax ? fmtWeight(p.wmax, p) : "…"));
    if (dl.children.length) sp.appendChild(dl);
    else sp.appendChild(el("p", "muted", spEm(p.sp) + " " + spName(p.sp)));
    // Vet
    var sv = section(box, t("sec.vet"));
    if (!p.vet.n && !p.vet.c && !p.vet.ph && !p.eph) sv.appendChild(el("p", "muted", t("vet.none")));
    else {
      var v = el("div", "vet");
      var vb = el("div", "vet-body");
      vb.appendChild(el("div", "vet-name", p.vet.n || p.vet.c));
      var vsub = [p.vet.n ? p.vet.c : "", p.vet.ph].filter(Boolean).join(" · ");
      if (vsub) vb.appendChild(el("div", "vet-sub", vsub));
      if (p.eph) vb.appendChild(el("div", "vet-sub", t("vet.emerg") + ": " + p.eph));
      v.appendChild(vb);
      if (p.vet.ph) v.appendChild(telLink(p.vet.ph, t("vet.call")));
      if (p.eph) v.appendChild(telLink(p.eph, t("vet.emerg")));
      sv.appendChild(v);
    }
    // Routine care
    var sc = section(box, t("sec.care"));
    var kinds = C.CARE_KINDS.filter(function (k) { return p.care[k]; });
    if (!kinds.length) sc.appendChild(el("p", "muted", t("care.none")));
    else {
      var careIts = {};
      C.items(data, today).forEach(function (it) { if (it.pet.id === p.id && it.kind === "care") careIts[it.sub] = it; });
      kinds.forEach(function (k) {
        var row = el("div", "care-row");
        row.style.setProperty("--kind", KIND_COLOR.care);
        var cb = el("div", "care-body");
        cb.appendChild(el("div", "care-name", t("care." + k)));
        var it = careIts[k];
        var late = it && it.diff < 0;
        cb.appendChild(el("div", "care-sub" + (late ? " late" : ""),
          t("care.every", { n: p.care[k] }) + (it && !p.gone ? " · " + whenText(it.due, today) : "")));
        row.appendChild(cb);
        if (!p.gone) {
          var b = el("button", "done-btn");
          b.type = "button";
          b.innerHTML = UI.check;
          b.appendChild(el("span", "", t("act.done")));
          b.setAttribute("aria-label", t("act.doneAria", { what: t("care." + k), name: p.name }));
          b.addEventListener("click", function () { careDone(p, k); });
          row.appendChild(b);
        }
        sc.appendChild(row);
      });
    }
    if (p.notes) {
      var so = section(box, t("sec.notes"));
      so.appendChild(el("p", "notes-box", p.notes));
    }
  }

  function recTitle(r, p) {
    if (r.k === "vacc" || r.k === "med") return r.n;
    if (r.k === "deworm") return t("dw." + r.t) + (r.n ? " · " + r.n : "");
    if (r.k === "visit") return r.n || t("kind.visit");
    if (r.k === "care") return t("care." + r.c);
    if (r.k === "food") return t("fd.change", { n: r.n });
    return fmtWeight(r.g, p);
  }
  function recSub(r, p) {
    var bits = [];
    if (r.k === "vacc") { if (r.nx) bits.push(t("r.next", { d: fmtDate(r.nx) })); if (r.b) bits.push(t("r.batch", { b: r.b })); if (r.v) bits.push(r.v); }
    if (r.k === "deworm" && r.nx) bits.push(t("r.next", { d: fmtDate(r.nx) }));
    if (r.k === "visit") {
      if (r.dg) bits.push(r.dg);
      if (r.tr) bits.push(r.tr);
      if (r.c) bits.push(fmtMoney(r.c));
      if (r.nx) bits.push(t("r.recheck", { d: fmtDate(r.nx) }));
      if (r.v) bits.push(r.v);
    }
    if (r.k === "med") { if (r.ds) bits.push(r.ds); if (r.fq) bits.push(r.fq); if (r.u) bits.push(t("r.until", { d: fmtDate(r.u) })); if (r.tm) bits.push(t("r.times", { t: r.tm.join(", ") })); }
    if (r.sc) bits.push(t("at.count", { n: r.sc.length }));
    if (r.nt) bits.push(r.nt);
    return bits.join(" · ");
  }
  function recRow(r, p) {
    var li = el("li");
    var b = el("button", "rec");
    b.type = "button";
    b.style.setProperty("--kind", KIND_COLOR[r.k]);
    var ic = el("span", "rec-ico");
    ic.innerHTML = UI[r.k];
    b.appendChild(ic);
    var bd = el("span", "rec-body");
    bd.appendChild(el("span", "rec-title", recTitle(r, p)));
    var sub = recSub(r, p);
    if (sub) bd.appendChild(el("span", "rec-sub", sub));
    bd.firstChild.style.display = "block";
    if (bd.children[1]) bd.children[1].style.display = "block";
    b.appendChild(bd);
    b.appendChild(el("span", "rec-d", fmtDate(r.d)));
    b.addEventListener("click", function () { recEditor(p, r.k, r.id, null); });
    li.appendChild(b);
    return li;
  }

  function renderHealth(p, box, today) {
    var add = el("div", "add-row");
    ["vacc", "deworm", "visit", "med"].forEach(function (k) {
      var b = iconTxt(UI.plus, t("h.add." + k), function () {
        var pre = { d: todayYmd() };
        if (k === "vacc" || k === "visit") pre.v = p.vet.n;
        recEditor(p, k, null, pre);
      });
      b.style.setProperty("--kind", KIND_COLOR[k]);
      add.appendChild(b);
    });
    box.appendChild(add);
    var y = +today.slice(0, 4), cost = C.costYear(data, p.id, y);
    if (cost) box.appendChild(el("p", "muted", t("h.cost", { y: y, sum: fmtMoney(cost) })));
    var chips = el("div", "chips");
    FILTERS.forEach(function (f) {
      var c = el("button", "chip" + (prefs.filter === f ? " on" : ""), t("flt." + f));
      c.type = "button";
      c.setAttribute("aria-pressed", prefs.filter === f ? "true" : "false");
      c.addEventListener("click", function () { prefs.filter = f; savePrefs(); renderPet(); });
      chips.appendChild(c);
    });
    box.appendChild(chips);
    var list = recsOf(p.id).filter(function (r) {
      if (r.k === "weight" || r.k === "food") return false;
      return prefs.filter === "all" || r.k === prefs.filter;
    });
    if (!list.length) { box.appendChild(el("p", "muted", t("h.empty"))); }
    else {
      var ul = el("ul", "recs");
      list.forEach(function (r) { ul.appendChild(recRow(r, p)); });
      box.appendChild(ul);
    }
    box.appendChild(el("p", "disclaimer", t("disclaimer")));
  }

  // ----- Weight -----
  function renderWeight(p, box, today) {
    var list = C.weights(data, p.id);
    var add = el("div", "add-row");
    var ab = iconTxt(UI.plus, t("w.add"), function () { recEditor(p, "weight", null, { d: todayYmd() }); });
    ab.style.setProperty("--kind", KIND_COLOR.weight);
    add.appendChild(ab);
    box.appendChild(add);
    if (!list.length) { box.appendChild(el("p", "muted", t("w.empty"))); return; }
    var last = list[list.length - 1];
    var stat = el("div", "stat-row");
    stat.appendChild(el("span", "big-num", fmtWeight(last.g, p)));
    var out = (p.wmin && last.g < p.wmin) || (p.wmax && last.g > p.wmax);
    var dlt = C.weightDelta(list);
    if (dlt !== null && dlt !== 0) {
      stat.appendChild(el("span", "delta", t("w.delta", { sign: dlt > 0 ? "+" : "−", v: fmtWeight(Math.abs(dlt), p) })));
    }
    if (p.wmin || p.wmax) {
      stat.appendChild(el("span", "delta" + (out ? " out" : ""),
        t("w.range", { min: p.wmin ? fmtWeight(p.wmin, p) : "…", max: p.wmax ? fmtWeight(p.wmax, p) : "…" }) +
        (out ? " · " + t("w.out") : "")));
    }
    box.appendChild(stat);
    if (list.length >= 2) box.appendChild(weightChart(list, p));
    var ul = el("ul", "recs");
    list.slice().reverse().forEach(function (r) { ul.appendChild(recRow(r, p)); });
    box.appendChild(ul);
  }

  var SVGNS = "http://www.w3.org/2000/svg";
  function svgEl(tag, attrs) {
    var n = document.createElementNS(SVGNS, tag);
    Object.keys(attrs).forEach(function (k) { n.setAttribute(k, String(attrs[k])); });
    return n;
  }
  function weightChart(list, p) {
    var W = 600, H = 200, L = 52, R = 14, T = 14, B = 26;
    var x0 = C.dayNum(list[0].d), x1 = C.dayNum(list[list.length - 1].d);
    if (x1 === x0) x1 = x0 + 1;
    var lo = Infinity, hi = -Infinity;
    list.forEach(function (r) { lo = Math.min(lo, r.g); hi = Math.max(hi, r.g); });
    if (p.wmin) lo = Math.min(lo, p.wmin);
    if (p.wmax) hi = Math.max(hi, p.wmax);
    var pad = Math.max((hi - lo) * 0.12, hi * 0.02, 1);
    lo = Math.max(0, lo - pad); hi += pad;
    function X(d) { return L + (C.dayNum(d) - x0) / (x1 - x0) * (W - L - R); }
    function Y(g) { return T + (1 - (g - lo) / (hi - lo)) * (H - T - B); }
    var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, "class": "chart", role: "img",
                             "aria-label": t("sub.weight") });
    if (p.wmin || p.wmax) {
      var top = Y(p.wmax || hi), bot = Y(p.wmin || lo);
      svg.appendChild(svgEl("rect", { x: L, y: top, width: W - L - R, height: Math.max(0, bot - top), "class": "band" }));
    }
    [lo, (lo + hi) / 2, hi].forEach(function (g) {
      var y = Y(g);
      svg.appendChild(svgEl("line", { x1: L, x2: W - R, y1: y, y2: y, "class": "grid" }));
      var tx = svgEl("text", { x: L - 6, y: y + 4, "text-anchor": "end" });
      tx.textContent = fmtWeight(Math.round(g), p);
      svg.appendChild(tx);
    });
    var pts = list.map(function (r) { return X(r.d).toFixed(1) + "," + Y(r.g).toFixed(1); }).join(" ");
    svg.appendChild(svgEl("polyline", { points: pts, "class": "line" }));
    list.forEach(function (r) {
      var out = (p.wmin && r.g < p.wmin) || (p.wmax && r.g > p.wmax);
      svg.appendChild(svgEl("circle", { cx: X(r.d).toFixed(1), cy: Y(r.g).toFixed(1), r: 4, "class": "dot" + (out ? " out" : "") }));
    });
    var a = svgEl("text", { x: L, y: H - 6, "text-anchor": "start" });
    a.textContent = fmtDate(list[0].d);
    var b = svgEl("text", { x: W - R, y: H - 6, "text-anchor": "end" });
    b.textContent = fmtDate(list[list.length - 1].d);
    svg.appendChild(a);
    svg.appendChild(b);
    return svg;
  }

  // ----- Food -----
  function renderFood(p, box, today) {
    var f = p.food;
    var card = el("div", "food-card");
    card.style.setProperty("--kind", KIND_COLOR.food);
    if (!f.n && !f.g && !f.bag) card.appendChild(el("p", "muted", t("fd.none")));
    else {
      if (f.n) card.appendChild(el("div", "food-name", f.n));
      var bits = [];
      if (f.g) bits.push(t("fd.daily", { g: fmtGrams(f.g) }));
      if (f.ml) bits.push(t("fd.meals", { n: f.ml }));
      if (bits.length) card.appendChild(el("div", "muted", bits.join(" · ")));
      if (f.bag && f.open) card.appendChild(el("div", "muted", t("fd.bagInfo", { b: fmtGrams(f.bag), d: fmtDate(f.open) })));
      var outD = C.foodOut(p);
      if (outD) {
        var total = Math.max(1, Math.floor(f.bag / f.g));
        var left = Math.max(0, C.dayNum(outD) - C.dayNum(today));
        var bar = el("div", "bar" + (left <= C.FOOD_LEAD ? " low" : ""));
        var fill = el("span");
        fill.style.width = Math.min(100, Math.round(left / total * 100)) + "%";
        bar.appendChild(fill);
        card.appendChild(bar);
        card.appendChild(el("div", "muted", t("fd.out", { d: fmtDate(outD), when: whenText(outD, today) })));
      }
    }
    var acts = el("div", "ph-acts");
    acts.appendChild(iconTxt(UI.edit, t("fd.edit"), function () { foodEditor(p); }));
    if (!p.gone) acts.appendChild(iconTxt(UI.food, t("fd.bag"), function () { newBag(p); }));
    // "Send to To-Do" (BR-TD-ADD, owner To-Do): a prefill; To-Do asks
    // which list and adds nothing until the user confirms.
    var openAt = bridge("__orosOpenAt");
    if (openAt && !p.gone) acts.appendChild(iconTxt(UI.plus, t("fd.todo"), function () {
      var text = f.n ? t("todo.item", { food: f.n, name: p.name }) : t("todo.plain", { name: p.name });
      try {
        openAt("todo", { addItems: { list: "tdl-groceries", from: t("app"), items: [{ text: text.slice(0, 300) }] } });
      } catch (e) { showToast(t("toast.noBridge")); }
    }));
    card.appendChild(acts);
    box.appendChild(card);
    var sh = section(box, t("fd.hist"));
    var hist = recsOf(p.id, "food");
    if (!hist.length) sh.appendChild(el("p", "muted", t("fd.histEmpty")));
    else {
      var ul = el("ul", "recs");
      hist.forEach(function (r) { ul.appendChild(recRow(r, p)); });
      sh.appendChild(ul);
    }
  }

  // ---------- 7. Editors ----------
  function field(label, input, id) {
    var wrap = el("div", "fld");
    var lab = el("label", "dlg-lbl", label);
    lab.setAttribute("for", id);
    input.id = id;
    wrap.appendChild(lab);
    wrap.appendChild(input);
    return wrap;
  }
  function textInput(v, max, ph) {
    var i = el("input");
    i.maxLength = max;
    i.autocomplete = "off";
    i.value = v || "";
    if (ph) i.placeholder = ph;
    return i;
  }
  // Decimal fields are text + inputmode=decimal: a Greek keyboard
  // types "12,5", which a number input would reject (readDec parses
  // both separators).
  function numInput(v, min, max, step) {
    var i = el("input");
    var dec = !!(step && step < 1);
    i.type = dec ? "text" : "number";
    i.inputMode = dec ? "decimal" : "numeric";
    i.autocomplete = "off";
    if (!dec) { i.min = String(min); i.max = String(max); i.step = String(step || 1); }
    i.value = v === null || v === undefined || v === "" ? "" : String(v);
    return i;
  }
  function dateInput(v) {
    var i = el("input");
    i.type = "date";
    i.value = v || "";
    return i;
  }
  // "12,5" or "12.5" → number, or null
  function readDec(inp) {
    var s = String(inp.value || "").trim().replace(",", ".");
    if (!s) return null;
    var v = Number(s);
    return isFinite(v) && v >= 0 ? v : null;
  }
  function seg(options, cur, onPick, label) {
    var box = el("div", "seg");
    box.setAttribute("role", "radiogroup");
    if (label) box.setAttribute("aria-label", label);
    function paint() {
      [].forEach.call(box.children, function (b, i) {
        var on = options[i][0] === cur;
        b.classList.toggle("on", on);
        b.setAttribute("aria-checked", on ? "true" : "false");
      });
    }
    options.forEach(function (o) {
      var b = el("button", "", o[1]);
      b.type = "button";
      b.setAttribute("role", "radio");
      b.addEventListener("click", function () { cur = o[0]; paint(); onPick(cur); });
      box.appendChild(b);
    });
    paint();
    return box;
  }
  function quickDates(target, fromInput, list) {
    var q = el("div", "quick");
    list.forEach(function (x) {
      var c = el("button", "chip", t(x[0]));
      c.type = "button";
      c.addEventListener("click", function () {
        var base = C.isYmd(fromInput.value) ? fromInput.value : todayYmd();
        target.value = x[1] === "none" ? "" : (x[2] === "m" ? addMonths(base, x[1]) : C.addDays(base, x[1]));
      });
      q.appendChild(c);
    });
    return q;
  }
  // A shell bridge (window.parent.__oros…), or null when this shell
  // does not have it (older bundle, app opened on its own): the
  // button that needs it is then simply not shown (BR-B1-5).
  function bridge(name) {
    try {
      var p = window.parent;
      return p && p !== window && typeof p[name] === "function" ? p[name] : null;
    } catch (e) { return null; }
  }

  // ----- Attachments: files on the orOS disk -----
  // The record keeps names only (core normAt); each file sits in Files
  // under "Pet Health Book" and syncs through Vault Drive when the user
  // runs it, never through the localStorage slice. Photos are re-drawn
  // on a canvas (long side 1600 px, JPEG): no EXIF / location kept.
  // PDFs (≤ 10 MB) are kept as they are.
  var AT_MAX_IN = 40 * 1024 * 1024, PDF_MAX = 10 * 1024 * 1024;
  function fsApi() {
    try {
      var f = window.parent && window.parent !== window ? window.parent.orosFS : null;
      return f && typeof f.writeBlob === "function" && typeof f.readBlob === "function" && typeof f.rm === "function" ? f : null;
    } catch (e) { return null; }
  }
  function atRandom() {
    var a = new Uint8Array(6), out = "";
    try { crypto.getRandomValues(a); } catch (e) { for (var i = 0; i < 6; i++) a[i] = Math.floor(Math.random() * 256); }
    for (var j = 0; j < a.length; j++) out += (a[j] % 36).toString(36);
    return out;
  }
  function isPdf(file) {
    return !!file && (file.type === "application/pdf" || /\.pdf$/i.test(file.name || ""));
  }
  // → Promise<{ blob, ext } | null>
  function encodeAttachment(file) {
    if (!file) return Promise.resolve(null);
    if (isPdf(file)) {
      if (file.size > PDF_MAX || !file.size) return Promise.resolve(null);
      return Promise.resolve(file.slice(0, 5).text ? file.slice(0, 5).text() : "%PDF-").then(function (head) {
        return head === "%PDF-" ? { blob: file.slice(0, file.size, "application/pdf"), ext: "pdf" } : null;
      }).catch(function () { return null; });
    }
    if (file.size > AT_MAX_IN) return Promise.resolve(null);
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
        cv.toBlob(function (b) { resolve(b && b.size ? { blob: b, ext: "jpg" } : null); }, "image/jpeg", 0.8);
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }
  function rmFile(name) {
    var fs = fsApi(), path = C.atPath(name);
    if (!fs || !path) return Promise.resolve();
    return Promise.resolve(fs.rm(path)).catch(function () {});
  }
  // A deleted record (or pet) keeps its files through the Undo
  // window; then any name no record points at any more leaves the disk.
  function dropFilesLater(names) {
    if (!names || !names.length || !fsApi()) return;
    var list = names.slice();
    setTimeout(function () {
      var used = C.attachmentsOf(data);
      list.forEach(function (n) { if (used.indexOf(n) < 0) rmFile(n); });
    }, 12000);
  }
  // The attachments field of a record editor. Files added while it is
  // open are written at once and removed again if the editor closes
  // without saving; files taken off a record leave the disk on save.
  function attachBox(dlg, r, recId, dateIn) {
    var fs = fsApi();
    var cur = r && r.sc ? r.sc.slice() : [];
    var orig = cur.slice(), added = [], urls = [], done = false;
    if (!fs && !cur.length) return { wrap: null, names: function () { return cur.slice(); }, commit: function () {} };
    var wrap = el("div", "fld");
    wrap.appendChild(el("div", "dlg-lbl", t("at.title")));
    var grid = el("div", "at-grid");
    grid.id = "pr-at";
    wrap.appendChild(grid);
    wrap.appendChild(el("p", "dlg-sub", t("at.hint")));
    function paint() {
      urls.forEach(function (u) { URL.revokeObjectURL(u); });
      urls = [];
      grid.innerHTML = "";
      cur.forEach(function (name, i) {
        var b = el("button", "at-th");
        b.type = "button";
        b.setAttribute("aria-label", t("at.open", { n: i + 1 }));
        b.addEventListener("click", function () { viewer(name); });
        grid.appendChild(b);
        if (/\.pdf$/.test(name)) { b.appendChild(el("span", "at-pdf", t("at.pdf"))); return; }
        if (!fs) { b.appendChild(el("span", "at-miss", t("at.missing"))); return; }
        Promise.resolve(fs.readBlob(C.atPath(name))).then(function (blob) {
          if (!blob) throw new Error("ENOENT");
          var u = URL.createObjectURL(blob);
          urls.push(u);
          var im = el("img");
          im.alt = "";
          im.src = u;
          b.appendChild(im);
        }).catch(function () { b.appendChild(el("span", "at-miss", t("at.missing"))); });
      });
      if (fs && cur.length < C.MAX_AT) {
        var add = el("button", "at-th at-add", "+");
        add.type = "button";
        add.setAttribute("aria-label", t("at.add"));
        add.title = t("at.add");
        add.addEventListener("click", pick);
        grid.appendChild(add);
      }
    }
    function pick() {
      var host = dialogHost();
      var accept = "image/*,application/pdf,.pdf";
      var p = host && typeof host.openFile === "function" ? host.openFile(accept) : localPickFile(accept);
      Promise.resolve(p).then(function (file) {
        if (!file) return;
        return encodeAttachment(file).then(function (enc) {
          if (!enc) { showToast(t("at.bad")); return; }
          var name = C.atName(C.isYmd(dateIn.value) ? dateIn.value : todayYmd(), recId, atRandom(), enc.ext);
          if (!name) return;
          return Promise.resolve(fs.writeBlob(C.atPath(name), enc.blob)).then(function () {
            if (done) { rmFile(name); return; }
            added.push(name);
            cur.push(name);
            cur.sort(cmpStr);
            paint();
          });
        });
      }).catch(function () { showToast(t("at.noDisk")); });
    }
    function viewer(name) {
      var v = makeDialog("pc-at-view");
      v.appendChild(el("div", "dlg-title", t("at.title")));
      var box = el("div", "at-view");
      v.appendChild(box);
      var u = null, blobNow = null, pdf = /\.pdf$/.test(name);
      var acts = el("div", "dlg-actions");
      var openB = pdf ? button(t("at.openPdf"), "", function () {
        if (!u) return;
        var a = document.createElement("a");
        a.href = u;
        a.target = "_blank";
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
      }) : null;
      var saveB = button(t("at.save"), "", function () {
        if (!blobNow) return;
        var host = dialogHost();
        if (host && typeof host.saveFile === "function") host.saveFile({ blob: blobNow, filename: name, mime: pdf ? "application/pdf" : "image/jpeg" });
      });
      if (openB) { openB.disabled = true; acts.appendChild(openB); }
      saveB.disabled = true;
      acts.appendChild(saveB);
      if (fs) Promise.resolve(fs.readBlob(C.atPath(name))).then(function (blob) {
        if (!blob) throw new Error("ENOENT");
        blobNow = pdf ? blob.slice(0, blob.size, "application/pdf") : blob;
        u = URL.createObjectURL(blobNow);
        if (pdf) box.appendChild(el("div", "at-pdf big", t("at.pdf")));
        else { var im = el("img"); im.alt = t("at.title"); im.src = u; box.appendChild(im); }
        if (openB) openB.disabled = false;
        saveB.disabled = false;
      }).catch(function () { box.appendChild(el("p", "dlg-sub", t("at.missingLong"))); });
      else box.appendChild(el("p", "dlg-sub", t("at.missingLong")));
      v.appendChild(el("p", "dlg-sub", t("at.where")));
      acts.appendChild(button(t("at.remove"), "danger", function () {
        v.close();
        cur = cur.filter(function (n) { return n !== name; });
        if (added.indexOf(name) >= 0) { added = added.filter(function (n) { return n !== name; }); rmFile(name); }
        paint();
      }));
      acts.appendChild(button(t("at.close"), "primary", function () { v.close(); }));
      v.appendChild(acts);
      v.addEventListener("close", function () { if (u) setTimeout(function () { URL.revokeObjectURL(u); }, 60000); });
      document.body.appendChild(v);
      v.showModal();
    }
    dlg.addEventListener("close", function () {
      urls.forEach(function (u) { URL.revokeObjectURL(u); });
      if (!done) { done = true; added.forEach(rmFile); }
    });
    paint();
    return {
      wrap: wrap,
      names: function () { return cur.slice(); },
      // after a successful save: files taken off the record leave the disk
      commit: function () {
        done = true;
        var gone = orig.filter(function (n) { return cur.indexOf(n) < 0; });
        if (gone.length) setTimeout(function () {
          var used = C.attachmentsOf(data);
          gone.forEach(function (n) { if (used.indexOf(n) < 0) rmFile(n); });
        }, 0);
      }
    };
  }

  // Dose times of a medicine: a row of time inputs, + to add one.
  function timesField(list, f) {
    var wrap = el("div", "fld");
    wrap.appendChild(el("div", "dlg-lbl", t("rf.times")));
    var box = el("div", "times");
    box.id = "pr-tm";
    wrap.appendChild(box);
    var add = button("+ " + t("rf.addTime"), "chip", function () { addRow("", true); });
    function paint() { add.hidden = box.querySelectorAll("input").length >= C.MAX_TIMES; }
    function addRow(v, focus) {
      if (box.querySelectorAll("input").length >= C.MAX_TIMES) return;
      var row = el("span", "time-row");
      var inp = el("input");
      inp.type = "time";
      inp.value = v || (box.children.length ? "" : "08:00");
      var x = el("button", "time-del", "×");
      x.type = "button";
      x.setAttribute("aria-label", t("rf.delTime", { t: inp.value }));
      x.addEventListener("click", function () { row.remove(); paint(); });
      row.appendChild(inp);
      row.appendChild(x);
      box.appendChild(row);
      paint();
      if (focus) inp.focus();
    }
    list.forEach(function (v) { addRow(v, false); });
    wrap.appendChild(add);
    wrap.appendChild(el("p", "dlg-sub", t("rf.timesHint")));
    paint();
    f.getTm = function () {
      return C.cleanTimes([].map.call(box.querySelectorAll("input"), function (i) { return i.value; }));
    };
    return wrap;
  }

  function chk(label, on) {
    var l = el("label", "chk");
    var i = el("input");
    i.type = "checkbox";
    i.checked = !!on;
    l.appendChild(i);
    l.appendChild(el("span", "", label));
    return { wrap: l, input: i };
  }

  // ----- Pet editor -----
  function petEditor(id) {
    var p = id ? petById(id) : null;
    if (!p && data.pets.length >= C.MAX_PETS) { showToast(t("toast.max", { n: C.MAX_PETS })); return; }
    var today = todayYmd();
    var dlg = makeDialog("pc-edit");
    dlg.classList.add("wide");
    dlg.appendChild(el("div", "dlg-title", t(p ? "ed.editTitle" : "ed.addTitle")));
    var form = el("form");
    form.method = "dialog";
    form.noValidate = true;

    var name = textInput(p ? p.name : "", C.NAME_LEN);
    form.appendChild(field(t("ed.name"), name, "pc-name"));

    // Photo
    var photo = p ? p.ph : "";
    var pw = el("div", "fld");
    pw.appendChild(el("div", "dlg-lbl", t("ed.photo")));
    var prow = el("div", "photo-row");
    var pv = el("span", "");
    var bAdd = button(t("ed.photoAdd"), "", null), bDel = button(t("ed.photoDel"), "danger", null);
    bAdd.style.flex = "none"; bDel.style.flex = "none";
    function paintPhoto() {
      pv.innerHTML = "";
      pv.appendChild(avatar({ ph: photo, sp: spSel.value }, "big"));
      bDel.hidden = !photo;
    }
    bAdd.addEventListener("click", function () {
      pickPhoto().then(function (uri) {
        if (!uri) return;
        if (photoBytes(p ? p.id : null) + uri.length > C.PHOTO_BUDGET) { showToast(t("toast.photoFull")); return; }
        photo = uri;
        paintPhoto();
      });
    });
    bDel.addEventListener("click", function () { photo = ""; paintPhoto(); });
    prow.appendChild(pv); prow.appendChild(bAdd); prow.appendChild(bDel);
    pw.appendChild(prow);

    var spSel = el("select");
    C.SPECIES_IDS.forEach(function (k) {
      var o = el("option", "", spEm(k) + " " + spName(k));
      o.value = k;
      spSel.appendChild(o);
    });
    spSel.value = p ? p.sp : "dog";
    spSel.addEventListener("change", function () { paintPhoto(); paintUnits(); });
    var r1 = el("div", "fld-row");
    r1.appendChild(field(t("ed.species"), spSel, "pc-sp"));
    var breed = textInput(p ? p.breed : "", C.NAME_LEN);
    r1.appendChild(field(t("ed.breed"), breed, "pc-breed"));
    form.appendChild(r1);
    form.appendChild(pw);

    var sex = p ? p.sex : "";
    var sw = el("div", "fld");
    sw.appendChild(el("div", "dlg-lbl", t("ed.sex")));
    sw.appendChild(seg([["", t("sex.none")], ["f", t("sex.f")], ["m", t("sex.m")]], sex, function (v) { sex = v; }, t("ed.sex")));
    form.appendChild(sw);
    var neut = chk(t("ed.neut"), p && p.neut);
    form.appendChild(neut.wrap);

    // Birth: exact date, or year (+ month) when only roughly known
    var b0 = p ? p.birth : "";
    var approx = chk(t("ed.approx"), b0 && b0.length < 10);
    var bDate = dateInput(b0.length === 10 ? b0 : "");
    bDate.max = today;
    var bDateF = field(t("ed.birth"), bDate, "pc-birth");
    var bYear = numInput(b0 ? +b0.slice(0, 4) : "", 1950, +today.slice(0, 4));
    var bMonth = el("select");
    var om = el("option", "", t("ed.monthAny"));
    om.value = "";
    bMonth.appendChild(om);
    for (var mi = 1; mi <= 12; mi++) {
      var mo = el("option", "");
      try { mo.textContent = new Date(2000, mi - 1, 1).toLocaleDateString(LOCALE, { month: "long" }); }
      catch (e) { mo.textContent = String(mi); }
      mo.value = (mi < 10 ? "0" : "") + mi;
      bMonth.appendChild(mo);
    }
    bMonth.value = b0.length >= 7 ? b0.slice(5, 7) : "";
    var bRough = el("div", "fld-row");
    bRough.appendChild(field(t("ed.year"), bYear, "pc-by"));
    bRough.appendChild(field(t("ed.month"), bMonth, "pc-bm"));
    function paintBirth() { bDateF.hidden = approx.input.checked; bRough.hidden = !approx.input.checked; }
    approx.input.addEventListener("change", paintBirth);
    form.appendChild(bDateF);
    form.appendChild(bRough);
    form.appendChild(approx.wrap);
    paintBirth();

    var color = textInput(p ? p.color : "", C.NAME_LEN);
    form.appendChild(field(t("ed.color"), color, "pc-color"));

    // Vet
    var dv = el("details", "more-care");
    dv.appendChild(el("summary", "", t("ed.vet")));
    var vetN = textInput(p ? p.vet.n : "", C.TEXT_LEN), vetC = textInput(p ? p.vet.c : "", C.TEXT_LEN);
    var vetPh = textInput(p ? p.vet.ph : "", C.PHONE_LEN), eph = textInput(p ? p.eph : "", C.PHONE_LEN);
    vetPh.type = "tel"; eph.type = "tel";
    var rv = el("div", "fld-row");
    rv.appendChild(field(t("ed.vetN"), vetN, "pc-vn"));
    rv.appendChild(field(t("ed.vetC"), vetC, "pc-vc"));
    dv.appendChild(rv);
    var rv2 = el("div", "fld-row");
    rv2.appendChild(field(t("ed.vetPh"), vetPh, "pc-vp"));
    rv2.appendChild(field(t("ed.eph"), eph, "pc-ep"));
    dv.appendChild(rv2);
    if (!p) dv.open = true;
    form.appendChild(dv);

    // Ids
    var di = el("details", "more-care");
    di.appendChild(el("summary", "", t("ed.ids")));
    var chip = textInput(p ? p.chip : "", 30), pass = textInput(p ? p.pass : "", 30), ins = textInput(p ? p.ins : "", C.TEXT_LEN);
    chip.inputMode = "numeric";
    var ri = el("div", "fld-row");
    ri.appendChild(field(t("ed.chip"), chip, "pc-chip"));
    ri.appendChild(field(t("ed.pass"), pass, "pc-pass"));
    di.appendChild(ri);
    di.appendChild(field(t("ed.ins"), ins, "pc-ins"));
    if (p && (p.chip || p.pass || p.ins)) di.open = true;
    form.appendChild(di);

    // Health: allergies + ideal weight
    var dh = el("details", "more-care");
    dh.appendChild(el("summary", "", t("ed.health")));
    var alg = textInput(p ? p.alg : "", C.LONG_LEN);
    dh.appendChild(field(t("ed.alg"), alg, "pc-alg"));
    var wmin = numInput("", 0, 2000, 0.01), wmax = numInput("", 0, 2000, 0.01);
    var rw = el("div", "fld-row");
    var lMin = field(t("ed.wmin"), wmin, "pc-wmin"), lMax = field(t("ed.wmax"), wmax, "pc-wmax");
    rw.appendChild(lMin); rw.appendChild(lMax);
    dh.appendChild(rw);
    function small() { return !!SMALL[spSel.value]; }
    var unitWasSmall = null;
    function paintUnits() {
      var sm = small(), u = sm ? t("ed.g") : t("ed.kg");
      lMin.firstChild.textContent = t("ed.wmin") + " (" + u + ")";
      lMax.firstChild.textContent = t("ed.wmax") + " (" + u + ")";
      if (unitWasSmall === null) {
        if (p && p.wmin) wmin.value = String(sm ? p.wmin : p.wmin / 1000);
        if (p && p.wmax) wmax.value = String(sm ? p.wmax : p.wmax / 1000);
      } else if (unitWasSmall !== sm) {
        [wmin, wmax].forEach(function (i) {
          var v = readDec(i);
          if (v !== null) i.value = String(sm ? Math.round(v * 1000) : v / 1000);
        });
      }
      unitWasSmall = sm;
    }
    paintUnits();
    if (p && (p.alg || p.wmin || p.wmax)) dh.open = true;
    form.appendChild(dh);

    // Routine care
    var dc = el("details", "more-care");
    dc.appendChild(el("summary", "", t("ed.care")));
    var cg = el("div", "care-grid"), careIn = {};
    C.CARE_KINDS.forEach(function (k) {
      careIn[k] = numInput(p && p.care[k] ? p.care[k] : 0, 0, 365);
      cg.appendChild(field(t("care." + k), careIn[k], "pc-c-" + k));
    });
    dc.appendChild(cg);
    if (p && Object.keys(p.care).length) dc.open = true;
    form.appendChild(dc);

    var notes = el("textarea");
    notes.maxLength = C.NOTES_LEN;
    notes.rows = 3;
    notes.value = p ? p.notes : "";
    form.appendChild(field(t("ed.notes"), notes, "pc-notes"));

    // Passed away / rehomed
    var gone = null, goneD = null;
    if (p) {
      var dg = el("details", "more-care");
      dg.appendChild(el("summary", "", t("ed.gone")));
      gone = chk(t("ed.gone"), !!p.gone);
      dg.appendChild(gone.wrap);
      goneD = dateInput(p.gone || today);
      goneD.max = today;
      dg.appendChild(field(t("ed.goneD"), goneD, "pc-gone"));
      dg.appendChild(el("p", "dlg-sub", t("ed.goneHint")));
      if (p.gone) dg.open = true;
      form.appendChild(dg);
    }

    var acts = el("div", "dlg-actions");
    if (p) acts.appendChild(button(t("ed.delete"), "danger", function () { confirmDelete(p, dlg); }));
    acts.appendChild(button(t("ed.cancel"), "", function () { dlg.close(); }));
    var ok = button(t("ed.save"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var nm = C.cleanText(name.value, C.NAME_LEN, false);
      if (!nm) { showToast(t("toast.needName")); name.focus(); return; }
      var birth = "";
      if (approx.input.checked) {
        var yv = Number(bYear.value);
        if (bYear.value && Math.floor(yv) === yv) birth = String(yv) + (bMonth.value ? "-" + bMonth.value : "");
      } else if (C.isYmd(bDate.value)) birth = bDate.value;
      if (birth && (!C.isBirth(birth) || birth > today.slice(0, birth.length))) { showToast(t("toast.badDate")); return; }
      var sm = small();
      function grams(inp) { var v = readDec(inp); return v === null ? 0 : Math.round(sm ? v : v * 1000); }
      var care = {}, cs = {};
      C.CARE_KINDS.forEach(function (k) {
        var n = Number(careIn[k].value);
        if (isFinite(n) && Math.floor(n) === n && n >= 1 && n <= 365) {
          care[k] = n;
          cs[k] = p && p.care[k] && p.cs[k] ? p.cs[k] : today;   // a new routine starts today
        }
      });
      var vals = {
        name: nm, sp: spSel.value, breed: breed.value, sex: sex, neut: neut.input.checked ? 1 : 0,
        birth: birth, color: color.value, chip: chip.value, pass: pass.value, ins: ins.value, alg: alg.value,
        vet: { n: vetN.value, c: vetC.value, ph: vetPh.value }, eph: eph.value,
        wmin: grams(wmin), wmax: grams(wmax), care: care, cs: cs, ph: photo, notes: notes.value,
        gone: gone && gone.input.checked && C.isYmd(goneD.value) && goneD.value <= today ? goneD.value : ""
      };
      if (p) {
        if (!petById(p.id)) { dlg.close(); return; }
        if (updatePet(p.id, function (x) { return Object.assign(x, vals); })) {
          save();
          showToast(t("toast.saved"));
        }
      } else {
        var draft = C.normPet(Object.assign({ id: newId(), m: 0, food: {} }, vals));
        if (!draft) { showToast(t("toast.needName")); return; }
        C.touch(draft, null);
        data.pets.push(draft);
        save();
        showToast(t("toast.added", { name: nm }));
        prefs.pet = draft.id;
        prefs.sub = "info";
        savePrefs();
      }
      dlg.close();
      render();
    });
    dlg.appendChild(form);
    document.body.appendChild(dlg);
    paintPhoto();
    dlg.showModal();
    name.focus();
  }

  function confirmDelete(p, parent) {
    confirmBox(t("confirm.del", { name: p.name }), function () {
      if (parent && parent.open) parent.close();
      deletePet(p);
    });
  }
  function confirmBox(msg, onYes) {
    var dlg = makeDialog("pc-confirm");
    dlg.appendChild(el("p", "confirm-msg", msg));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("ed.cancel"), "", function () { dlg.close(); }));
    acts.appendChild(button(t("confirm.yes"), "danger-fill", function () { dlg.close(); onYes(); }));
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  // ----- Record editor (one form per kind) -----
  // id = an existing record (edit) or null (new, prefilled by `pre`).
  function recEditor(pet, kind, id, pre) {
    var r = id ? recById(id) : null;
    var v = r || pre || {};
    var today = todayYmd();
    var dlg = makeDialog("pc-rec");
    dlg.classList.add("wide");
    dlg.style.setProperty("--kind", KIND_COLOR[kind]);
    var title = el("div", "dlg-title", t("rd." + kind) + " · " + pet.name);
    dlg.appendChild(title);
    var form = el("form");
    form.method = "dialog";
    form.noValidate = true;
    var f = {};

    f.d = dateInput(v.d || today);
    function nameField(labelKey, ph, list) {
      f.n = textInput(v.n || "", C.TEXT_LEN, ph);
      var wrap = field(t(labelKey), f.n, "pr-n");
      if (list && list.length) {
        var dl = el("datalist");
        dl.id = "pr-n-list";
        list.forEach(function (x) { var o = el("option"); o.value = x; dl.appendChild(o); });
        f.n.setAttribute("list", "pr-n-list");
        wrap.appendChild(dl);
      }
      return wrap;
    }

    if (kind === "vacc") {
      var vs = C.VACCINES[pet.sp] || [];
      form.appendChild(nameField("rf.name", t("rf.namePh"), vs.map(function (x) { return x[LANG] || x.en; })));
      var row = el("div", "fld-row");
      row.appendChild(field(t("rf.date"), f.d, "pr-d"));
      f.nx = dateInput(v.nx || "");
      var nxF = field(t("rf.next"), f.nx, "pr-nx");
      row.appendChild(nxF);
      form.appendChild(row);
      form.appendChild(quickDates(f.nx, f.d, [["q.m1", 1, "m"], ["q.y1", 12, "m"], ["q.y3", 36, "m"], ["rf.nextNone", "none"]]));
      // A ready vaccine name → its usual gap (only when no next date yet)
      f.n.addEventListener("change", function () {
        var hit = null;
        vs.forEach(function (x) { if ((x[LANG] || x.en) === f.n.value) hit = x; });
        if (hit && !f.nx.value) f.nx.value = C.addDays(C.isYmd(f.d.value) ? f.d.value : today, hit.days);
      });
      var row2 = el("div", "fld-row");
      f.b = textInput(v.b || "", C.NAME_LEN);
      f.v = textInput(v.v || "", C.TEXT_LEN);
      row2.appendChild(field(t("rf.batch"), f.b, "pr-b"));
      row2.appendChild(field(t("rf.vet"), f.v, "pr-v"));
      form.appendChild(row2);
    } else if (kind === "deworm") {
      var dt = v.t || "int";
      var tw = el("div", "fld");
      tw.appendChild(el("div", "dlg-lbl", t("rf.type")));
      tw.appendChild(seg(C.DEWORM_TYPES.map(function (x) { return [x, t("dwS." + x)]; }), dt, function (x) {
        dt = x;
        if (!r && !f.nx.value) f.nx.value = C.addDays(C.isYmd(f.d.value) ? f.d.value : today, C.DEWORM_DAYS[x]);
      }, t("rf.type")));
      form.appendChild(tw);
      form.appendChild(nameField("rf.product", ""));
      var rowd = el("div", "fld-row");
      rowd.appendChild(field(t("rf.date"), f.d, "pr-d"));
      f.nx = dateInput(v.nx !== undefined ? v.nx : (r ? "" : C.addDays(v.d || today, C.DEWORM_DAYS[dt])));
      rowd.appendChild(field(t("rf.next"), f.nx, "pr-nx"));
      form.appendChild(rowd);
      form.appendChild(quickDates(f.nx, f.d, [["q.m1", 1, "m"], ["q.m3", 3, "m"], ["q.m6", 6, "m"], ["rf.nextNone", "none"]]));
      f.getT = function () { return dt; };
    } else if (kind === "visit") {
      form.appendChild(field(t("rf.date"), f.d, "pr-d"));
      form.appendChild(nameField("rf.reason", ""));
      f.dg = textInput(v.dg || "", C.LONG_LEN);
      f.tr = textInput(v.tr || "", C.LONG_LEN);
      form.appendChild(field(t("rf.diag"), f.dg, "pr-dg"));
      form.appendChild(field(t("rf.treat"), f.tr, "pr-tr"));
      var rowv = el("div", "fld-row");
      f.c = numInput(v.c ? v.c / 100 : "", 0, 1000000, 0.01);
      f.v = textInput(v.v || "", C.TEXT_LEN);
      rowv.appendChild(field(t("rf.cost"), f.c, "pr-c"));
      rowv.appendChild(field(t("rf.vet"), f.v, "pr-v"));
      form.appendChild(rowv);
      f.nx = dateInput(v.nx || "");
      form.appendChild(field(t("rf.recheck"), f.nx, "pr-nx"));
      form.appendChild(quickDates(f.nx, f.d, [["q.d7", 7], ["q.d14", 14], ["q.m1", 1, "m"], ["rf.nextNone", "none"]]));
    } else if (kind === "med") {
      form.appendChild(nameField("rf.medName", ""));
      var rowm = el("div", "fld-row");
      f.ds = textInput(v.ds || "", C.TEXT_LEN);
      f.fq = textInput(v.fq || "", C.TEXT_LEN, t("rf.freqPh"));
      rowm.appendChild(field(t("rf.dose"), f.ds, "pr-ds"));
      rowm.appendChild(field(t("rf.freq"), f.fq, "pr-fq"));
      form.appendChild(rowm);
      var rowm2 = el("div", "fld-row");
      f.u = dateInput(v.u || "");
      rowm2.appendChild(field(t("rf.from"), f.d, "pr-d"));
      rowm2.appendChild(field(t("rf.until"), f.u, "pr-u"));
      form.appendChild(rowm2);
      form.appendChild(quickDates(f.u, f.d, [["q.d7", 6], ["q.d14", 13], ["q.m1", 1, "m"], ["rf.nextNone", "none"]]));
      form.appendChild(timesField(v.tm || [], f));
    } else if (kind === "weight") {
      var sm = isSmall(pet);
      var roww = el("div", "fld-row");
      roww.appendChild(field(t("rf.date"), f.d, "pr-d"));
      f.g = numInput(v.g ? (sm ? v.g : v.g / 1000) : "", 0, sm ? 200000 : 2000, sm ? 1 : 0.01);
      roww.appendChild(field(t("rf.weight") + " (" + (sm ? t("ed.g") : t("ed.kg")) + ")", f.g, "pr-g"));
      form.appendChild(roww);
    } else if (kind === "care") {
      form.appendChild(el("p", "confirm-msg", t("care." + v.c)));
      form.appendChild(field(t("rf.date"), f.d, "pr-d"));
    } else if (kind === "food") {
      form.appendChild(nameField("rf.foodN", ""));
      form.appendChild(field(t("rf.date"), f.d, "pr-d"));
    }
    if (kind !== "weight" && kind !== "care") {
      f.nt = el("textarea");
      f.nt.maxLength = C.REC_NOTES;
      f.nt.rows = 2;
      f.nt.value = v.nt || "";
      form.appendChild(field(t("rf.notes"), f.nt, "pr-nt"));
    }
    var recId = r ? r.id : newId();
    var att = C.AT_KINDS.indexOf(kind) >= 0 ? attachBox(dlg, r, recId, f.d) : null;
    if (att && att.wrap) form.appendChild(att.wrap);
    if (kind === "vacc" || kind === "deworm") form.appendChild(el("p", "disclaimer", t("disclaimer")));

    var acts = el("div", "dlg-actions");
    if (r) acts.appendChild(button(t("ed.delete"), "danger", function () {
      confirmBox(t("confirm.delRec"), function () { dlg.close(); removeRec(r); });
    }));
    var budNew = kind === "visit" ? bridge("__orosOpenBudgetNew") : null;
    if (budNew) {
      var bb = button(t("bud.add"), "", function () {
        var cv = readDec(f.c);
        if (cv === null || cv <= 0) { showToast(t("toast.needCost")); f.c.focus(); return; }
        var ok2 = false;
        try {
          ok2 = budNew({
            k: "o", a: Math.round(cv * 100),
            d: C.isYmd(f.d.value) ? f.d.value : todayYmd(),
            n: t("bud.note", { name: pet.name, what: f.n.value.trim() || t("kind.visit") }).slice(0, 140),
            c: "o-health", src: "petcare"
          }) === true;
        } catch (e) {}
        if (!ok2) showToast(t("toast.noBridge"));
      });
      bb.id = "pr-bud";
      acts.appendChild(bb);
    }
    acts.appendChild(button(t("ed.cancel"), "", function () { dlg.close(); }));
    var ok = button(t("ed.save"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!C.isYmd(f.d.value)) { showToast(t("toast.badDate")); f.d.focus(); return; }
      var out = { id: recId, p: pet.id, k: kind, d: f.d.value, m: r ? r.m : Date.now() };
      if (att) out.sc = att.names();
      if (f.n) out.n = f.n.value;
      if (f.nx) {
        if (f.nx.value && (!C.isYmd(f.nx.value) || f.nx.value <= f.d.value)) { showToast(t("toast.badDate")); f.nx.focus(); return; }
        out.nx = f.nx.value;
      }
      if (f.b) out.b = f.b.value;
      if (f.v) out.v = f.v.value;
      if (f.getT) out.t = f.getT();
      if (f.dg) out.dg = f.dg.value;
      if (f.tr) out.tr = f.tr.value;
      if (f.c) { var cv = readDec(f.c); out.c = cv === null ? 0 : Math.round(cv * 100); }
      if (f.ds) out.ds = f.ds.value;
      if (f.getTm) out.tm = f.getTm();
      if (f.fq) out.fq = f.fq.value;
      if (f.u) {
        if (f.u.value && (!C.isYmd(f.u.value) || f.u.value < f.d.value)) { showToast(t("toast.badDate")); f.u.focus(); return; }
        out.u = f.u.value;
      }
      if (f.g) {
        var gv = readDec(f.g);
        if (gv === null || gv <= 0) { showToast(t("toast.needWeight")); f.g.focus(); return; }
        out.g = Math.round(isSmall(pet) ? gv : gv * 1000);
        if (out.g < 1) { showToast(t("toast.needWeight")); return; }
      }
      if (kind === "care") out.c = v.c;
      if (f.nt) out.nt = f.nt.value;
      var clean = C.normRec(out);
      if (!clean) { showToast(t("toast.needRec")); if (f.n) f.n.focus(); return; }
      if (att) att.commit();
      dlg.close();
      if (r) {
        var cur = recById(r.id);
        if (!cur) return;
        clean.m = cur.m;
        if (JSON.stringify(clean) !== JSON.stringify(cur)) {      // R27
          stamp(clean);
          data.recs = data.recs.map(function (x) { return x.id === cur.id ? clean : x; });
          save();
          render();
          showToast(t("toast.saved"));
        }
      } else addRec(clean);
    });
    dlg.appendChild(form);
    document.body.appendChild(dlg);
    dlg.showModal();
    if (f.n && !f.n.value) f.n.focus();
    else if (f.g) f.g.focus();
  }

  // ----- Food editor + new bag -----
  function foodEditor(p) {
    var dlg = makeDialog("pc-food");
    dlg.appendChild(el("div", "dlg-title", t("fe.title") + " · " + p.name));
    var form = el("form");
    form.method = "dialog";
    form.noValidate = true;
    var fd = p.food;
    var n = textInput(fd.n, C.TEXT_LEN);
    form.appendChild(field(t("fe.n"), n, "fe-n"));
    var row = el("div", "fld-row");
    var g = numInput(fd.g || "", 0, 20000), ml = numInput(fd.ml || "", 0, 12);
    row.appendChild(field(t("fe.g"), g, "fe-g"));
    row.appendChild(field(t("fe.ml"), ml, "fe-ml"));
    form.appendChild(row);
    var row2 = el("div", "fld-row");
    var bag = numInput(fd.bag ? fd.bag / 1000 : "", 0, 100, 0.1), open = dateInput(fd.open || "");
    open.max = todayYmd();
    row2.appendChild(field(t("fe.bag"), bag, "fe-bag"));
    row2.appendChild(field(t("fe.open"), open, "fe-open"));
    form.appendChild(row2);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("ed.cancel"), "", function () { dlg.close(); }));
    var ok = button(t("ed.save"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var cur = petById(p.id);
      if (!cur) { dlg.close(); return; }
      var bv = readDec(bag);
      var food = {
        n: C.cleanText(n.value, C.TEXT_LEN, false),
        g: Math.round(readDec(g) || 0), ml: Math.round(readDec(ml) || 0),
        bag: bv === null ? 0 : Math.round(bv * 1000), open: C.isYmd(open.value) ? open.value : ""
      };
      dlg.close();
      var oldName = cur.food.n;
      var next = updatePet(cur.id, function (x) { x.food = food; return x; });
      if (!next) return;
      // A different food starts a line in the food history.
      if (next.food.n && lowName(next.food.n) !== lowName(oldName)) {
        data.recs.push({ id: newId(), p: cur.id, k: "food", d: todayYmd(), m: Date.now(), n: next.food.n, nt: "" });
      }
      save();
      render();
      showToast(t("toast.saved"));
    });
    dlg.appendChild(form);
    document.body.appendChild(dlg);
    dlg.showModal();
    n.focus();
  }
  function lowName(s) { return String(s || "").toLowerCase().trim(); }

  function newBag(p) {
    var dlg = makeDialog("pc-bag");
    dlg.appendChild(el("div", "dlg-title", t("nb.title") + " · " + p.name));
    var form = el("form");
    form.method = "dialog";
    form.noValidate = true;
    var bag = numInput(p.food.bag ? p.food.bag / 1000 : "", 0, 100, 0.1);
    form.appendChild(field(t("nb.bag"), bag, "nb-bag"));
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("ed.cancel"), "", function () { dlg.close(); }));
    var ok = button(t("ed.save"), "primary", null);
    ok.type = "submit";
    acts.appendChild(ok);
    form.appendChild(acts);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var cur = petById(p.id);
      var bv = readDec(bag);
      dlg.close();
      if (!cur) return;
      var old = JSON.parse(JSON.stringify(cur.food));
      updatePet(cur.id, function (x) {
        x.food.open = todayYmd();
        if (bv !== null && bv > 0) x.food.bag = Math.min(100000, Math.round(bv * 1000));
        return x;
      });
      save();
      render();
      undoToast(t("toast.bag", { name: cur.name }), function () {
        if (!updatePet(cur.id, function (x) { x.food = old; return x; })) return;
        save();
        render();
      });
    });
    dlg.appendChild(form);
    document.body.appendChild(dlg);
    dlg.showModal();
    bag.focus();
  }

  // ---------- 8. Photos, print card ----------
  // Every stored photo is pixels WE drew: the file is decoded into a
  // canvas and re-encoded as a small square JPEG (≤ PHOTO_MAX).
  function reencode(file) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file), im = new Image();
      im.onload = function () {
        try {
          var SZ = 128, cv = document.createElement("canvas");
          cv.width = cv.height = SZ;
          var g = cv.getContext("2d");
          var w = im.naturalWidth, h = im.naturalHeight, m = Math.min(w, h);
          if (!m) { resolve(null); return; }
          g.fillStyle = "#ffffff";
          g.fillRect(0, 0, SZ, SZ);
          g.drawImage(im, (w - m) / 2, (h - m) / 2, m, m, 0, 0, SZ, SZ);
          var out = null;
          [0.85, 0.7, 0.55, 0.4].some(function (q) { out = cv.toDataURL("image/jpeg", q); return out.length <= C.PHOTO_MAX; });
          resolve(out && out.length <= C.PHOTO_MAX && C.PHOTO_RE.test(out) ? out : null);
        } catch (e) { resolve(null); }
        URL.revokeObjectURL(url);
      };
      im.onerror = function () { URL.revokeObjectURL(url); resolve(null); };
      im.src = url;
    });
  }
  function pickPhoto() {
    var host = dialogHost();
    var pick = host && typeof host.openFile === "function" ? host.openFile("image/*") : localPickFile("image/*");
    return Promise.resolve(pick).then(function (file) {
      if (!file) return null;                  // cancel — silent exit
      if (file.size > 15 * 1024 * 1024) { showToast(t("toast.photoBad")); return null; }
      return reencode(file).then(function (uri) { if (!uri) showToast(t("toast.photoBad")); return uri; });
    }).catch(function () { showToast(t("toast.photoBad")); return null; });
  }

  // A one-page card for the vet or a trip: built with textContent
  // into #print-area (only that prints, see the CSS) → window.print.
  function printCard(p) {
    var box = $("print-area"), today = todayYmd();
    box.innerHTML = "";
    var head = el("div", "pr-head");
    if (p.ph) { var im = el("img"); im.src = p.ph; im.alt = ""; head.appendChild(im); }
    var hb = el("div");
    hb.appendChild(el("h1", "", p.name));
    hb.appendChild(el("div", "", t("pr.title") + " · " + [spName(p.sp), p.breed].filter(Boolean).join(" · ")));
    head.appendChild(hb);
    box.appendChild(head);
    function table(rows) {
      var tb = el("table");
      rows.forEach(function (r) {
        if (!r[1]) return;
        var tr = el("tr");
        tr.appendChild(el("th", "", r[0]));
        tr.appendChild(el("td", "", r[1]));
        tb.appendChild(tr);
      });
      return tb;
    }
    var w = C.weights(data, p.id), lw = w.length ? w[w.length - 1] : null;
    var sex = p.sex ? t("sex." + p.sex) + (p.neut ? ", " + t("neut." + p.sex) : "") : "";
    box.appendChild(el("h2", "", t("sec.profile")));
    box.appendChild(table([
      [t("f.birth"), p.birth ? fmtDate(p.birth) + (p.gone ? "" : " (" + ageText(p, today) + ")") : ""],
      [t("f.sex"), sex], [t("f.color"), p.color], [t("f.chip"), p.chip], [t("f.pass"), p.pass],
      [t("f.ins"), p.ins], [t("f.alg"), p.alg],
      [t("pr.last"), lw ? fmtWeight(lw.g, p) + " (" + fmtDate(lw.d) + ")" : ""],
      [t("fe.title"), [p.food.n, p.food.g ? t("fd.daily", { g: fmtGrams(p.food.g) }) : ""].filter(Boolean).join(" · ")],
      [t("sec.vet"), [p.vet.n, p.vet.c, p.vet.ph].filter(Boolean).join(" · ")],
      [t("vet.emerg"), p.eph]
    ]));
    // Vaccines in force: the newest dose of each name
    var seen = {}, vac = [];
    recsOf(p.id, "vacc").forEach(function (r) {
      var k = lowName(r.n);
      if (seen[k]) return;
      seen[k] = true;
      vac.push([r.n, fmtDate(r.d) + (r.nx ? " → " + fmtDate(r.nx) : "") + (r.b ? " · " + t("r.batch", { b: r.b }) : "")]);
    });
    box.appendChild(el("h2", "", t("pr.vacc")));
    if (vac.length) box.appendChild(table(vac)); else box.appendChild(el("p", "", t("pr.none")));
    var dw = recsOf(p.id, "deworm").slice(0, 3).map(function (r) {
      return [t("dw." + r.t), [r.n, fmtDate(r.d) + (r.nx ? " → " + fmtDate(r.nx) : "")].filter(Boolean).join(" · ")];
    });
    box.appendChild(el("h2", "", t("pr.dw")));
    if (dw.length) box.appendChild(table(dw)); else box.appendChild(el("p", "", t("pr.none")));
    var meds = recsOf(p.id, "med").filter(function (r) { return !r.u || r.u >= today; }).map(function (r) {
      return [r.n, [r.ds, r.fq, r.u ? t("r.until", { d: fmtDate(r.u) }) : "", r.tm ? t("r.times", { t: r.tm.join(", ") }) : ""].filter(Boolean).join(" · ")];
    });
    if (meds.length) { box.appendChild(el("h2", "", t("pr.meds"))); box.appendChild(table(meds)); }
    box.appendChild(el("p", "pr-foot", t("pr.made", { d: fmtDate(today) })));
    try { window.print(); } catch (e) { showToast(t("toast.print")); }
  }

  // ---------- 9. Settings, export / import ----------
  function settings() {
    var dlg = makeDialog("pc-set");
    dlg.appendChild(el("div", "dlg-title", t("set.title")));
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
    dlg.appendChild(field(t("set.remind"), rem, "pc-rem"));
    dlg.appendChild(el("p", "dlg-sub", t("set.remindHint")));
    var lead = el("select");
    [0, 1, 3, 7, 14, 30].forEach(function (n) {
      var o = el("option", "", n === 0 ? t("set.lead0") : (n === 1 ? t("set.lead1") : t("set.leadN", { n: n })));
      o.value = String(n);
      lead.appendChild(o);
    });
    lead.value = String(prefs.lead);
    if (lead.value !== String(prefs.lead)) {
      var ol = el("option", "", t("set.leadN", { n: prefs.lead }));
      ol.value = String(prefs.lead);
      lead.appendChild(ol);
      lead.value = String(prefs.lead);
    }
    lead.addEventListener("change", function () { prefs.lead = Number(lead.value); savePrefsNow(); });
    dlg.appendChild(field(t("set.lead"), lead, "pc-lead"));
    var dz = chk(t("set.doses"), prefs.doses);
    dz.input.id = "pc-doses";
    dz.input.addEventListener("change", function () { prefs.doses = dz.input.checked; savePrefsNow(); });
    dlg.appendChild(dz.wrap);
    dlg.appendChild(el("div", "dlg-lbl", t("set.data")));
    var io = el("div", "dlg-actions tight");
    io.appendChild(button(t("set.export"), "", exportData));
    io.appendChild(button(t("set.import"), "", importData));
    dlg.appendChild(io);
    var acts = el("div", "dlg-actions");
    acts.appendChild(button(t("set.close"), "primary", function () { dlg.close(); }));
    dlg.appendChild(acts);
    document.body.appendChild(dlg);
    dlg.showModal();
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

  function exportData() {
    var payload = { app: "oros-petcare", ver: C.DATA_VER, exported: new Date().toISOString(), data: canonical(data) };
    var text = JSON.stringify(payload, null, 2);
    var filename = "orOS-pets-" + todayYmd() + ".json";
    var host = dialogHost();
    if (host && typeof host.saveFile === "function") {
      host.saveFile({ text: text, filename: filename, mime: "application/json",
        types: [{ description: "JSON", accept: { "application/json": [".json"] } }] })
        .then(function (r) { if (r && r.ok) showToast(t("toast.exported")); });
      return;
    }
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 40000);
    showToast(t("toast.exported"));
  }

  // A restore is a merge, never an overwrite (App-level import rule).
  function importData() {
    var host = dialogHost();
    var pick = host && typeof host.openFile === "function" ? host.openFile(".json,application/json") : localPickFile(".json,application/json");
    Promise.resolve(pick).then(function (file) {
      if (!file) return;
      if (file.size > 8 * 1024 * 1024) { showToast(t("toast.badFile")); return; }
      return file.text().then(function (txt) {
        var parsed = null;
        try { parsed = JSON.parse(txt); } catch (e) {}
        var incoming = parsed && parsed.app === "oros-petcare" ? parsed.data : parsed;
        if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.pets)) { showToast(t("toast.badFile")); return; }
        var clean = C.merge(incoming, null);
        data = C.merge(data, clean);
        save();
        render();
        showToast(t("toast.imported", { n: clean.pets.length }));
      });
    }).catch(function () { showToast(t("toast.badFile")); });
  }

  // ---------- 10. Dialogs + toasts ----------
  function button(label, cls, fn) {
    var b = el("button", "dlg-btn" + (cls ? " " + cls : ""), label);
    b.type = "button";
    if (fn) b.addEventListener("click", fn);
    return b;
  }
  function makeDialog(id) {
    var stale = document.getElementById(id);
    if (stale) { try { stale.close(); } catch (e) {} stale.remove(); }
    var dlg = document.createElement("dialog");
    dlg.id = id;
    dlg.className = "pc-dlg";
    dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
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
          n.transient({ ns: "petcare", title: String(text) })) return;
    } catch (e) {}
    localToast(text, null);
  }
  // Undo toasts stay local (the closure never leaves the frame), 8 s.
  function undoToast(text, onUndo) { localToast(text, onUndo); }

  var toastTimer = null;
  function localToast(text, onUndo) {
    var box = $("toast");
    if (!box) return;
    hostToast();
    box.innerHTML = "";
    box.classList.remove("show");
    box.appendChild(el("span", "", text));
    if (onUndo) {
      var b = el("button", "", t("toast.undo"));
      b.type = "button";
      b.addEventListener("click", function () {
        box.classList.remove("show");
        clearTimeout(toastTimer);
        onUndo();
      }, { once: true });
      box.appendChild(b);
    }
    void box.offsetWidth;
    box.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.classList.remove("show"); box.innerHTML = ""; }, onUndo ? 8000 : 4000);
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

  // ---------- 11. Keyboard (Contract Β) + deep link ----------
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

  // "today" → Upcoming; a pet id → its page. Called live by the
  // shell (__orosOpenPetcare) or from the staged key at boot.
  window.__orosPetcareOpen = function (target) {
    if (typeof target !== "string" || !target) return;
    if (target === "today") { prefs.pet = null; setTab("up"); return; }
    if (C.ID_RE.test(target) && petById(target)) openPet(target);
  };
  function takeStaged() {
    var v = null;
    try {
      v = sessionStorage.getItem(OPEN_KEY);
      if (v) sessionStorage.removeItem(OPEN_KEY);
    } catch (e) {}
    if (v) window.__orosPetcareOpen(v);
  }

  // Universal search deep link (shell __orosOpenAt / __orosTakeTarget):
  // target { pet, rec }. Opens the pet's health book and the record's
  // editor, as a record row click does. Unknown record → no-op; an
  // open dialog (unsaved edits) wins → no-op.
  function openSearchTarget(t) {
    var r = t && typeof t.rec === "string" ? recById(t.rec) : null;
    var p = r ? petById(r.p) : null;
    if (!p || document.querySelector("dialog[open]")) return;
    openPet(p.id);
    prefs.sub = "health";
    savePrefs();
    render();
    recEditor(p, r.k, r.id, null);
  }
  window.__orosOpenAt = openSearchTarget;
  function takeSearchTarget() {
    try {
      if (window.parent && window.parent !== window &&
          typeof window.parent.__orosTakeTarget === "function") {
        var pendingTarget = window.parent.__orosTakeTarget("petcare");
        if (pendingTarget) openSearchTarget(pendingTarget);
      }
    } catch (e) {}
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
    api.registerSlice("petcare", sliceGet, sliceSet, STORAGE_KEY, mergeFn);
  }

  function sliceGet() { return canonical(data); }   // canonical copy (R26)

  function sliceSet(incoming) {
    if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.pets)) return;
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
    if (!document.querySelector("dialog[open]")) render();   // never yank an open form
    else pendingRender = true;
  }
  var pendingRender = false;

  // ---------- 13. Wiring & boot ----------
  function setTab(tab) {
    prefs.tab = tab === "pets" ? "pets" : "up";
    prefs.pet = null;
    savePrefs();
    render();
  }

  var renderedDay = null;
  function render() {
    renderedDay = todayYmd();
    pendingRender = false;
    var onPet = !!(prefs.pet && petById(prefs.pet));
    if (!onPet && prefs.pet) { prefs.pet = null; savePrefs(); }
    var tab = prefs.tab;
    document.querySelector(".tabs").hidden = onPet;
    $("back-btn").hidden = !onPet;
    $("bar-title").hidden = !onPet;
    $("add-btn").hidden = onPet;
    $("view-pet").hidden = !onPet;
    ["up", "pets"].forEach(function (v) {
      var on = !onPet && v === tab;
      $("view-" + v).hidden = !on;
      var b = $("tab-" + v);
      b.classList.toggle("on", v === tab);
      b.setAttribute("aria-selected", v === tab ? "true" : "false");
      b.tabIndex = v === tab ? 0 : -1;
    });
    var gh = document.querySelector(".grp-gone");
    if (gh) gh.remove();
    var gg = $("pet-grid-gone");
    if (gg) gg.remove();
    if (onPet) renderPet();
    else if (tab === "up") renderUp();
    else renderPets();
  }

  function applyI18n() {
    $("tab-up").textContent = t("tab.up");
    $("tab-pets").textContent = t("tab.pets");
    var sb = $("settings-btn");
    sb.innerHTML = UI.gear;
    sb.setAttribute("aria-label", t("btn.settings"));
    sb.title = t("btn.settings");
    var bb = $("back-btn");
    bb.innerHTML = UI.back;
    bb.setAttribute("aria-label", t("btn.back"));
    bb.title = t("btn.back");
    var ab = $("add-btn");
    ab.innerHTML = UI.plus + "<span></span>";
    ab.lastChild.textContent = t("btn.add");
    ab.setAttribute("aria-label", t("btn.addAria"));
    ab.title = t("btn.addAria");
    document.title = t("app") + " · orOS";
  }

  function wire() {
    $("tab-up").addEventListener("click", function () { setTab("up"); });
    $("tab-pets").addEventListener("click", function () { setTab("pets"); });
    document.querySelector(".tabs").addEventListener("keydown", function (e) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      setTab(prefs.tab === "up" ? "pets" : "up");
      $("tab-" + prefs.tab).focus();
    });
    $("back-btn").addEventListener("click", closePet);
    $("add-btn").addEventListener("click", function () { petEditor(null); });
    $("settings-btn").addEventListener("click", settings);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && prefs.pet && !document.querySelector("dialog[open]")) closePet();
    });
    // A dialog closed after a sync pull arrived → catch up now
    document.addEventListener("close", function () {
      if (pendingRender) setTimeout(function () { if (!document.querySelector("dialog[open]")) render(); }, 0);
    }, true);
    // A new day (app left open overnight, or back from the background)
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") savePrefsNow();
      else if (renderedDay !== todayYmd()) render();
    });
    setInterval(function () {
      if (document.visibilityState !== "hidden" && renderedDay !== todayYmd() &&
          !document.querySelector("dialog[open]")) render();
    }, 60000);
    window.addEventListener("pagehide", savePrefsNow);
    window.addEventListener("afterprint", function () { $("print-area").innerHTML = ""; });
    wireKeyboard();
  }

  function boot() {
    if (!C) { document.body.textContent = "Pet Health Book: core.js missing"; return; }
    load();
    loadPrefs();
    applyI18n();
    wire();
    registerSync();
    inheritPalette();
    watchPalette();
    render();
    takeStaged();
    takeSearchTarget();
  }

  boot();
})();
