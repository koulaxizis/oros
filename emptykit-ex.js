// ============================================================
// orOS — emptykit-ex.js: "Show me an example" (EXAMPLE-1, new users
// wave 3, 2026-11-11).
// ------------------------------------------------------------
// Made-up sample rows for the friendly empty screen (emptykit.js).
// emptykit.js loads this file only when someone taps "Show me an
// example", then paints the rows as a read-only preview inside the
// empty screen. The preview never touches the app: no app state, no
// save, no sync. Close it and the empty app is exactly as it was.
//
//   orosExamples.get("todo", "el") → { rows: [{ t, m, g? }] }
//     t = the row's text, m = a short line under it,
//     g = an optional group heading (a Kanban column, a Budget type).
//
// get() is pure and returns a fresh copy every time. Text only;
// emptykit.js puts it on screen through textContent.
// Tests: tests/emptykit-ex.test.js.
// i18n-inline-ok: made-up sample rows, one set per language (EN, EL,
// DE); any other language shows the English set.
// ============================================================
(function (root) {
  "use strict";

  var VER = "1.0.0";

  function R(t, m, g) { var r = { t: t, m: m }; if (g) r.g = g; return r; }

  var DATA = {
    todo: {
      en: [R("Buy milk and bread", "Today · Shopping"), R("Call the dentist", "Tomorrow · Health"), R("Pay the electricity bill", "Friday · Home"), R("Finish the slides for Monday", "Next week · Work")],
      el: [R("Γάλα και ψωμί", "Σήμερα · Ψώνια"), R("Τηλέφωνο στον οδοντίατρο", "Αύριο · Υγεία"), R("Λογαριασμός ρεύματος", "Παρασκευή · Σπίτι"), R("Διαφάνειες για τη Δευτέρα", "Επόμενη εβδομάδα · Δουλειά")],
      de: [R("Milch und Brot kaufen", "Heute · Einkauf"), R("Zahnarzt anrufen", "Morgen · Gesundheit"), R("Stromrechnung bezahlen", "Freitag · Zuhause"), R("Folien für Montag fertig machen", "Nächste Woche · Arbeit")]
    },
    kanban: {
      en: [R("Book the flights", "2 checklist items", "To do"), R("Find a place to stay", "Due Friday", "To do"), R("Pack the bags", "Started today", "Doing"), R("Renew the passport", "Done last week", "Done")],
      el: [R("Κράτηση πτήσεων", "2 στοιχεία λίστας", "Να γίνουν"), R("Κατάλυμα", "Έως Παρασκευή", "Να γίνουν"), R("Βαλίτσες", "Ξεκίνησε σήμερα", "Σε εξέλιξη"), R("Ανανέωση διαβατηρίου", "Έγινε την προηγούμενη εβδομάδα", "Έγιναν")],
      de: [R("Flüge buchen", "2 Punkte auf der Liste", "Zu tun"), R("Unterkunft finden", "Bis Freitag", "Zu tun"), R("Koffer packen", "Heute begonnen", "In Arbeit"), R("Reisepass verlängern", "Letzte Woche erledigt", "Erledigt")]
    },
    bookmarks: {
      en: [R("A recipe for lentil soup", "example.com · Cooking"), R("Train times to the coast", "example.org · Travel"), R("How to repot a plant", "example.net · Garden"), R("The town library", "example.com · Reading")],
      el: [R("Συνταγή για φακές", "example.com · Μαγειρική"), R("Δρομολόγια τρένων για τη θάλασσα", "example.org · Ταξίδια"), R("Πώς αλλάζω γλάστρα", "example.net · Κήπος"), R("Η δημοτική βιβλιοθήκη", "example.com · Διάβασμα")],
      de: [R("Ein Rezept für Linsensuppe", "example.com · Kochen"), R("Zugzeiten an die Küste", "example.org · Reisen"), R("Eine Pflanze umtopfen", "example.net · Garten"), R("Die Stadtbibliothek", "example.com · Lesen")]
    },
    invoices: {
      en: [R("Invoice 001 · Sample Bakery", "€ 240.00 · Paid"), R("Invoice 002 · Sample Studio", "€ 1,150.00 · Sent, due in 14 days"), R("Quote 003 · Sample Shop", "€ 480.00 · Draft"), R("Invoice 004 · Sample Café", "€ 95.00 · Late by 3 days")],
      el: [R("Τιμολόγιο 001 · Φούρνος Δείγμα", "240,00 € · Εξοφλήθηκε"), R("Τιμολόγιο 002 · Στούντιο Δείγμα", "1.150,00 € · Στάλθηκε, λήγει σε 14 ημέρες"), R("Προσφορά 003 · Κατάστημα Δείγμα", "480,00 € · Πρόχειρο"), R("Τιμολόγιο 004 · Καφέ Δείγμα", "95,00 € · Καθυστέρηση 3 ημερών")],
      de: [R("Rechnung 001 · Beispiel-Bäckerei", "240,00 € · Bezahlt"), R("Rechnung 002 · Beispiel-Studio", "1.150,00 € · Gesendet, fällig in 14 Tagen"), R("Angebot 003 · Beispiel-Laden", "480,00 € · Entwurf"), R("Rechnung 004 · Beispiel-Café", "95,00 € · 3 Tage überfällig")]
    },
    contacts: {
      en: [R("Anna Example", "Mobile · Birthday 12 March"), R("Ben Sample", "Work · Sample Studio"), R("Dr. Clara Test", "Dentist · Tuesdays and Thursdays"), R("The plumber", "Home · Call before 9")],
      el: [R("Άννα Παράδειγμα", "Κινητό · Γενέθλια 12 Μαρτίου"), R("Βασίλης Δείγμα", "Δουλειά · Στούντιο Δείγμα"), R("Δρ. Κλαίρη Δοκιμή", "Οδοντίατρος · Τρίτη και Πέμπτη"), R("Ο υδραυλικός", "Σπίτι · Τηλέφωνο πριν τις 9")],
      de: [R("Anna Beispiel", "Mobil · Geburtstag 12. März"), R("Ben Muster", "Arbeit · Beispiel-Studio"), R("Dr. Clara Probe", "Zahnärztin · Dienstag und Donnerstag"), R("Der Installateur", "Zuhause · Vor 9 Uhr anrufen")]
    },
    budget: {
      en: [R("Salary", "+ € 1,600.00 · 1st of the month", "Income"), R("Rent", "− € 550.00 · Home", "Spending"), R("Groceries", "− € 62.40 · Food", "Spending"), R("Bus pass", "− € 30.00 · Transport", "Spending")],
      el: [R("Μισθός", "+ 1.600,00 € · 1η του μήνα", "Έσοδα"), R("Ενοίκιο", "− 550,00 € · Σπίτι", "Έξοδα"), R("Σούπερ μάρκετ", "− 62,40 € · Φαγητό", "Έξοδα"), R("Κάρτα λεωφορείου", "− 30,00 € · Μετακινήσεις", "Έξοδα")],
      de: [R("Gehalt", "+ 1.600,00 € · Am 1. des Monats", "Einnahmen"), R("Miete", "− 550,00 € · Wohnen", "Ausgaben"), R("Lebensmittel", "− 62,40 € · Essen", "Ausgaben"), R("Busfahrkarte", "− 30,00 € · Verkehr", "Ausgaben")]
    },
    notes: {
      en: [R("Ideas for the garden", "Tomatoes by the wall, herbs in pots, a bench under the tree."), R("Meeting notes", "Next steps: send the plan, fix a date, ask about the budget."), R("Books to read", "Three novels and one about bread."), R("Packing list", "Charger, passport, sunglasses, a warm jumper.")],
      el: [R("Ιδέες για τον κήπο", "Ντομάτες στον τοίχο, μυρωδικά σε γλάστρες, ένα παγκάκι κάτω από το δέντρο."), R("Σημειώσεις συνάντησης", "Επόμενα βήματα: να σταλεί το σχέδιο, να κλειστεί ημερομηνία, ερώτηση για τον προϋπολογισμό."), R("Βιβλία για διάβασμα", "Τρία μυθιστορήματα και ένα για το ψωμί."), R("Λίστα για βαλίτσα", "Φορτιστής, διαβατήριο, γυαλιά ηλίου, ένα ζεστό πουλόβερ.")],
      de: [R("Ideen für den Garten", "Tomaten an der Mauer, Kräuter in Töpfen, eine Bank unter dem Baum."), R("Notizen zum Treffen", "Nächste Schritte: Plan senden, Termin festlegen, nach dem Budget fragen."), R("Bücher zum Lesen", "Drei Romane und eines über Brot."), R("Packliste", "Ladegerät, Reisepass, Sonnenbrille, ein warmer Pullover.")]
    },
    meals: {
      en: [R("Lentil soup", "4 servings · 45 min"), R("Greek salad", "2 servings · 10 min"), R("Oven-baked chicken with potatoes", "4 servings · 1 h 15 min"), R("Yoghurt with honey and walnuts", "1 serving · 2 min")],
      el: [R("Φακές σούπα", "4 μερίδες · 45 λεπτά"), R("Χωριάτικη σαλάτα", "2 μερίδες · 10 λεπτά"), R("Κοτόπουλο με πατάτες στον φούρνο", "4 μερίδες · 1 ώρα 15 λεπτά"), R("Γιαούρτι με μέλι και καρύδια", "1 μερίδα · 2 λεπτά")],
      de: [R("Linsensuppe", "4 Portionen · 45 Min."), R("Griechischer Salat", "2 Portionen · 10 Min."), R("Ofenhähnchen mit Kartoffeln", "4 Portionen · 1 Std. 15 Min."), R("Joghurt mit Honig und Walnüssen", "1 Portion · 2 Min.")]
    }
  };

  var APPS = Object.keys(DATA);

  function get(app, lang) {
    var d = Object.prototype.hasOwnProperty.call(DATA, app) ? DATA[app] : null;
    if (!d) return null;
    var rows = d[lang === "el" || lang === "de" ? lang : "en"];
    return { rows: rows.map(function (r) { var c = { t: r.t, m: r.m }; if (r.g) c.g = r.g; return c; }) };
  }

  var api = { VER: VER, APPS: APPS, get: get };
  root.orosExamples = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
